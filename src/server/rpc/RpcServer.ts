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
 */
export class RpcServer {
  private config: Required<Omit<RpcServerConfig, 'connection' | 'logger' | 'serializer'>>;
  private connectionManager: ConnectionManager;
  private channel: amqp.ConfirmChannel | null = null;
  private logger: Logger;
  private serializer: Serializer;
  private handlers = new Map<string, RpcHandler>();
  private isRunning = false;
  private consumerTag: string | null = null;
  private inFlightMessages = new Set<string>();

  constructor(config: RpcServerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.connectionManager = ConnectionManager.getInstance(config.connection);
    this.logger = config.logger || new SilentLogger();
    this.serializer = config.serializer || new JsonSerializer();
  }

  /**
   * Register a command handler
   */
  registerHandler<TRequest = any, TResponse = any>(
    command: string,
    handler: RpcHandler<TRequest, TResponse>
  ): void {
    if (!command) {
      throw new ValidationError('Command is required');
    }

    if (typeof handler !== 'function') {
      throw new ValidationError('Handler must be a function');
    }

    const normalizedCommand = command.toUpperCase();

    if (this.handlers.has(normalizedCommand)) {
      this.logger.warn(`Overwriting existing handler for command: ${normalizedCommand}`);
    }

    this.handlers.set(normalizedCommand, handler);
    this.logger.debug(`Handler registered for command: ${normalizedCommand}`);
  }

  /**
   * Unregister a command handler
   */
  unregisterHandler(command: string): void {
    const normalizedCommand = command.toUpperCase();
    const deleted = this.handlers.delete(normalizedCommand);

    if (deleted) {
      this.logger.debug(`Handler unregistered for command: ${normalizedCommand}`);
    } else {
      this.logger.warn(`No handler found for command: ${normalizedCommand}`);
    }
  }

  /**
   * Start the RPC server
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

      // Find handler
      const handler = this.handlers.get(request.command.toUpperCase());

      if (!handler) {
        throw new Error(`No handler registered for command: ${request.command}`);
      }

      // Execute handler
      const result = await handler(request.data, request.metadata);

      // Send success response
      if (replyTo) {
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

      // Acknowledge message
      this.channel.ack(msg);
    } catch (error) {
      this.logger.error('Error handling request', error as Error);

      // Send error response
      if (replyTo && this.channel) {
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
   */
  isServerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get number of registered handlers
   */
  getHandlerCount(): number {
    return this.handlers.size;
  }

  /**
   * Stop the RPC server
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
