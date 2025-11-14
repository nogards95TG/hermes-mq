import * as amqp from 'amqplib';
import {
  ConnectionManager,
  ConnectionConfig,
  ValidationError,
  Logger,
  SilentLogger,
  RequestEnvelope,
  ResponseEnvelope,
  Serializer,
  JsonSerializer,
  Middleware,
  Handler,
  isHandler,
  MessageContext,
  compose,
} from '../../core';

/**
 * RPC Server configuration
 */
export interface RpcServerConfig {
  connection: ConnectionConfig;
  queueName: string;
  prefetch?: number;
  serializer?: Serializer;
  logger?: Logger;
  assertQueue?: boolean;
  queueOptions?: amqp.Options.AssertQueue;
}

/**
 * RPC Handler function type
 */
export type RpcHandler<TRequest = any, TResponse = any> = (
  data: TRequest,
  metadata?: Record<string, any>
) => Promise<TResponse> | TResponse;

/**
 * Default RPC server configuration
 */
const DEFAULT_CONFIG = {
  prefetch: 10,
  assertQueue: true,
  queueOptions: {
    durable: true,
  },
};

/**
 * RpcServer handles incoming RPC requests and routes to registered handlers
 *
 * The RPC server listens for requests on a queue and routes them to appropriate handlers
 * based on the command name. It supports multiple handlers, error handling, and graceful shutdown.
 *
 * @example
 * ```typescript
 * import { RpcServer } from 'hermes-mq';
 *
 * const server = new RpcServer({
 *   connection: { url: 'amqp://localhost' },
 *   queueName: 'calculator'
 * });
 *
 * // Register handlers
 * server.registerHandler('ADD', (data) => data.a + data.b);
 * server.registerHandler('MULTIPLY', (data) => data.a * data.b);
 *
 * await server.start();
 * console.log('Server running...');
 *
 * // Later...
 * await server.stop();
 * ```
 */
export class RpcServer {
  private config: Required<Omit<RpcServerConfig, 'connection' | 'logger' | 'serializer'>>;
  private connectionManager: ConnectionManager;
  private channel: amqp.ConfirmChannel | null = null;
  private logger: Logger;
  private serializer: Serializer;
  // Store per-command composed handler (globalMiddlewares + per-handler middlewares + adapter)
  private handlers = new Map<string, Handler>();
  private globalMiddlewares: Middleware[] = [];
  private isRunning = false;
  private consumerTag: string | null = null;
  private inFlightMessages = new Set<string>();

  /**
   * Create a new RPC server instance
   *
   * @param config - Server configuration including connection and queue details
   */
  constructor(config: RpcServerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.connectionManager = ConnectionManager.getInstance(config.connection);
    this.logger = config.logger || new SilentLogger();
    this.serializer = config.serializer || new JsonSerializer();
  }

  /**
   * Add one or more global middleware that will be executed for every handler
   *
   * @example
   * server.use(middleware1)
   * server.use(middleware1, middleware2, middleware3)
   */
  use(...middlewares: Middleware[]): this {
    for (const m of middlewares) {
      if (typeof m !== 'function') {
        throw new ValidationError('Middleware must be a function');
      }
      this.globalMiddlewares.push(m);
    }

    return this;
  }

  /**
   * Register a command handler with optional middleware
   * Supports multiple signatures for flexibility
   *
   * @example
   * // Only handler
   * server.registerHandler('GET_USER', handler)
   *
   * // Handler with middleware
   * server.registerHandler('GET_USER', middleware1, middleware2, handler)
   */
  // Generic overload to allow any call shape; runtime validation will throw for invalid inputs
  registerHandler(command: string, handler: Handler): this;
  registerHandler(command: string, ...stack: any[]): this;
  registerHandler(command: string, ...stack: [...Middleware[], Handler]): this;
  registerHandler(command: string, ...stack: any[]): this {
    if (!command) {
      throw new ValidationError('Command is required');
    }

    // Validation: at least one element and the last must be a handler
    if (stack.length === 0) {
      throw new ValidationError('At least one handler is required');
    }

    const lastFn = stack[stack.length - 1];
    if (!isHandler(lastFn)) {
      throw new ValidationError('Last argument must be a handler (function with max 2 parameters)');
    }

    // Separate per-handler middlewares (all but last) and user handler (last)
    const perHandlerMiddlewares: Middleware[] = stack.slice(0, -1) as Middleware[];
    const userHandler = lastFn;

    const normalizedCommand = command.toUpperCase();

    if (this.handlers.has(normalizedCommand)) {
      this.logger.warn(`Overwriting existing handler for command: ${normalizedCommand}`);
    }

    // Adapter: at runtime the MessageContext will contain the request metadata (ctx['metadata']).
    // The adapter calls the legacy user handler with (data, metadata).
    const adapter: Handler = async (message: any, ctx: MessageContext) => {
      const metadata = (ctx as any).metadata;
      return await userHandler(message, metadata);
    };

    // Compose global middlewares + per-handler middlewares + adapter at registration time for runtime efficiency
    const fullStack = [...this.globalMiddlewares, ...perHandlerMiddlewares, adapter] as [
      ...Middleware[],
      Handler,
    ];
    const composed = compose(...fullStack);

    this.handlers.set(normalizedCommand, composed);
    this.logger.debug(`Handler registered for command: ${normalizedCommand}`);
    return this;
  }

  /**
   * Unregister a command handler
   */
  unregisterHandler(command: string): this {
    const normalizedCommand = command.toUpperCase();
    const deleted = this.handlers.delete(normalizedCommand);

    if (deleted) {
      this.logger.debug(`Handler unregistered for command: ${normalizedCommand}`);
    } else {
      this.logger.warn(`No handler found for command: ${normalizedCommand}`);
    }
    return this;
  }

  /**
   * Start the RPC server
   *
   * Begins listening for requests on the configured queue.
   * The server must be started before it can handle requests.
   *
   * @throws {Error} When connection fails or server is already running
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('RpcServer is already running');
      return;
    }

    try {
      const connection = await this.connectionManager.getConnection();
      this.channel = (await (connection as any).createConfirmChannel()) as amqp.ConfirmChannel;

      // Setup channel error handlers
      this.channel.on('error', (error: Error) => {
        this.logger.error('Channel error', error);
      });

      this.channel.on('close', () => {
        this.logger.warn('Channel closed');
        this.isRunning = false;
      });

      // Assert the request queue
      if (this.config.assertQueue) {
        await this.channel.assertQueue(this.config.queueName, this.config.queueOptions);
        this.logger.debug(`Queue "${this.config.queueName}" asserted`);
      }

      // Set prefetch
      await this.channel.prefetch(this.config.prefetch);

      // Start consuming
      const consumer = await this.channel.consume(
        this.config.queueName,
        (msg: amqp.ConsumeMessage | null) => this.handleRequest(msg),
        { noAck: false }
      );

      this.consumerTag = consumer.consumerTag;
      this.isRunning = true;

      this.logger.info('RpcServer started', {
        queueName: this.config.queueName,
        prefetch: this.config.prefetch,
        handlers: this.handlers.size,
      });
    } catch (error) {
      this.logger.error('Failed to start RpcServer', error as Error);
      throw error;
    }
  }

  /**
   * Handle incoming request
   */
  private async handleRequest(msg: amqp.ConsumeMessage | null): Promise<void> {
    if (!msg || !this.channel) return;

    const correlationId = msg.properties.correlationId;
    const replyTo = msg.properties.replyTo;
    let responseSent = false;

    // Track in-flight message
    if (correlationId) {
      this.inFlightMessages.add(correlationId);
    }

    try {
      // Decode request
      const request: RequestEnvelope = this.serializer.decode(msg.content);

      if (!request.command) {
        throw new ValidationError('Command is required in request');
      }

      this.logger.debug('Received RPC request', {
        command: request.command,
        correlationId,
      });

      // Find composed handler registered for this command
      const registeredHandler = this.handlers.get(request.command.toUpperCase());

      if (!registeredHandler) {
        throw new Error(`No handler registered for command: ${request.command}`);
      }

      // Create context
      const context: MessageContext = {
        messageId: msg.properties.messageId || correlationId || 'unknown',
        timestamp: new Date(msg.properties.timestamp || Date.now()),
        method: request.command,
        headers: msg.properties.headers || {},
        reply: async (data: any) => {
          if (responseSent) return;
          responseSent = true;
          const response: ResponseEnvelope = {
            id: request.id,
            timestamp: Date.now(),
            success: true,
            data,
          };
          const content = this.serializer.encode(response);
          if (replyTo) {
            this.channel!.sendToQueue(replyTo, content, {
              correlationId,
              contentType: 'application/json',
            });
          }
        },
        ack: async () => {
          if (this.channel) this.channel.ack(msg);
        },
        nack: async (requeue = true) => {
          if (this.channel) this.channel.nack(msg, false, requeue);
        },
      };
      // Attach request-specific metadata into the context so adapters can access it
      (context as any).metadata = request.metadata;

      // Execute the composed handler (already composed at registration time)
      const result = await registeredHandler(request.data, context as MessageContext);

      // Send response if not already sent by reply()
      if (!responseSent && replyTo) {
        const response: ResponseEnvelope = {
          id: request.id,
          timestamp: Date.now(),
          success: true,
          data: result,
        };

        const content = this.serializer.encode(response);

        this.channel.sendToQueue(replyTo, content, {
          correlationId,
          contentType: 'application/json',
        });

        this.logger.debug('Sent success response', {
          command: request.command,
          correlationId,
        });
      }

      // Acknowledge message if not already done
      if (this.channel && !responseSent) {
        this.channel.ack(msg);
      }
    } catch (error) {
      this.logger.error('Error handling request', error as Error);

      // Send error response
      if (replyTo && this.channel && !responseSent) {
        try {
          const response: ResponseEnvelope = {
            id: correlationId || 'unknown',
            timestamp: Date.now(),
            success: false,
            error: {
              code: (error as any).name || 'HANDLER_ERROR',
              message: (error as Error).message,
              details: (error as any).details,
            },
          };

          const content = this.serializer.encode(response);

          this.channel.sendToQueue(replyTo, content, {
            correlationId,
            contentType: 'application/json',
          });

          this.logger.debug('Sent error response', {
            correlationId,
            error: (error as Error).message,
          });
        } catch (replyError) {
          this.logger.error('Failed to send error response', replyError as Error);
        }
      }

      // Acknowledge message (we don't want to requeue errors)
      if (this.channel) {
        this.channel.ack(msg);
      }
    } finally {
      // Remove from in-flight
      if (correlationId) {
        this.inFlightMessages.delete(correlationId);
      }
    }
  }

  /**
   * Check if server is running
   *
   * @returns true if server is actively listening for requests
   */
  isServerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get number of registered handlers
   *
   * @returns Number of command handlers registered
   */
  getHandlerCount(): number {
    return this.handlers.size;
  }

  /**
   * Stop the RPC server
   *
   * Stops listening for new requests and waits for in-flight requests to complete.
   * After calling stop(), the server cannot be restarted.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('RpcServer is not running');
      return;
    }

    // Stop consuming new messages
    if (this.consumerTag && this.channel) {
      try {
        await this.channel.cancel(this.consumerTag);
        this.logger.debug('Consumer cancelled');
      } catch (error) {
        this.logger.warn('Error cancelling consumer', { error: (error as Error).message });
      }
    }

    // Wait for in-flight messages to complete
    const maxWait = 5000;
    const startTime = Date.now();

    while (this.inFlightMessages.size > 0 && Date.now() - startTime < maxWait) {
      this.logger.debug('Waiting for in-flight messages', {
        count: this.inFlightMessages.size,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.inFlightMessages.size > 0) {
      this.logger.warn('Stopping with in-flight messages', {
        count: this.inFlightMessages.size,
      });
    }

    // Close channel
    if (this.channel) {
      try {
        await this.channel.close();
      } catch (error) {
        this.logger.warn('Error closing channel', { error: (error as Error).message });
      }
      this.channel = null;
    }

    this.isRunning = false;
    this.logger.info('RpcServer stopped');
  }
}
