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
  AckStrategy,
  MessageValidationOptions,
  DeduplicationOptions,
  SlowMessageDetectionOptions,
  MetricsCollector,
} from '../../core';
import { MessageParser } from '../../core/message/MessageParser';
import { MessageDeduplicator } from '../../core/message/MessageDeduplicator';

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
  ackStrategy?: AckStrategy;
  messageValidation?: MessageValidationOptions;
  deduplication?: DeduplicationOptions;
  slowMessageDetection?: SlowMessageDetectionOptions;
  /**
   * Enable metrics collection using the global MetricsCollector instance.
   * When enabled, metrics are automatically collected and aggregated with all other components.
   * Default: false
   */
  enableMetrics?: boolean;
}

/**
 * RPC Handler function type
 */
export type RpcHandler<TRequest = any, TResponse = any> = (
  data: TRequest,
  metadata?: Record<string, any>
) => Promise<TResponse> | TResponse;

/**
 * Required RPC server configuration with defaults applied
 */
type RequiredRpcServerConfig = Required<
  Omit<RpcServerConfig, 'connection' | 'logger' | 'serializer'>
> & {
  metrics?: MetricsCollector;
};

/**
 * Default RPC server configuration
 */
const DEFAULT_CONFIG = {
  prefetch: 10, // RabbitMQ recommends a value between 10-50 to balance throughput and fairness
  assertQueue: true,
  enableMetrics: false,
  queueOptions: {
    durable: true,
  },
  ackStrategy: {
    mode: 'auto' as const,
    requeue: true,
    maxRetries: 3,
  },
  messageValidation: {
    malformedMessageStrategy: 'dlq' as const,
  },
  deduplication: {
    enabled: false,
    cacheTTL: 300000,
    cacheSize: 10000,
  },
  slowMessageDetection: {
    slowThresholds: {},
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
  private config: RequiredRpcServerConfig;
  private connectionManager: ConnectionManager;
  private channel: amqp.ConfirmChannel | null = null;
  private logger: Logger;
  private serializer: Serializer;
  private handlers = new Map<string, RpcHandler>();
  private isRunning = false;
  private consumerTag: string | null = null;
  private inFlightMessages = new Set<string>();
  private messageParser: MessageParser;
  private deduplicator: MessageDeduplicator;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: NodeJS.Timeout | null = null;

  /**
   * Create a new RPC server instance
   *
   * @param config - Server configuration including connection and queue details
   */
  constructor(config: RpcServerConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      // Use global metrics if enabled
      metrics: config.enableMetrics ? MetricsCollector.global() : undefined,
    } as any;
    this.connectionManager = ConnectionManager.getInstance(config.connection);
    this.logger = config.logger || new SilentLogger();
    this.serializer = config.serializer || new JsonSerializer();
    this.messageParser = new MessageParser(this.config.messageValidation);
    this.deduplicator = new MessageDeduplicator(this.config.deduplication);
  }

  /**
   * Register a command handler
   *
   * @param command - The command name (case-insensitive)
   * @param handler - Function that processes the request and returns a response
   * @throws {ValidationError} When command or handler is invalid
   *
   * @example
   * ```typescript
   * server.registerHandler('CALCULATE', (data) => {
   *   return { result: data.a + data.b };
   * });
   *
   * server.registerHandler('GET_USER', async (data) => {
   *   const user = await db.getUser(data.userId);
   *   return user;
   * });
   * ```
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

      // Handle consumer cancellation (server-side cancel)
      this.channel.on('cancel', () => {
        this.logger.warn('Consumer was cancelled by server, attempting to re-register...');
        this.isRunning = false;

        // Attempt to re-register the consumer after a delay
        setTimeout(() => {
          this.reRegisterConsumer().catch((error) => {
            this.logger.error('Failed to re-register consumer after cancellation', error as Error);
          });
        }, 5000);
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
   * Re-register consumer after cancellation
   */
  private async reRegisterConsumer(): Promise<void> {
    if (this.isRunning) {
      return; // Already running
    }

    try {
      this.logger.info('Re-registering consumer...');

      // Get or recreate channel
      if (!this.channel || !(this.channel as any).connection) {
        const connection = await this.connectionManager.getConnection();
        this.channel = (await (connection as any).createConfirmChannel()) as amqp.ConfirmChannel;
      }

      // Set prefetch
      await this.channel.prefetch(this.config.prefetch);

      // Start consuming again
      const consumer = await this.channel.consume(
        this.config.queueName,
        (msg: amqp.ConsumeMessage | null) => this.handleRequest(msg),
        { noAck: false }
      );

      this.consumerTag = consumer.consumerTag;
      this.isRunning = true;

      this.logger.info('Consumer re-registered successfully');
    } catch (error) {
      this.logger.error('Failed to re-register consumer', error as Error);
      throw error;
    }
  }

  /**
   * Handle incoming request
   */
  private async handleRequest(msg: amqp.ConsumeMessage | null): Promise<void> {
    if (!msg) {
      await this.handleConsumerCancellation();
      return;
    }

    if (!this.channel) return;

    const { correlationId, replyTo } = msg.properties;
    this.trackInFlightMessage(correlationId);

    try {
      const request = await this.parseAndValidateMessage(msg);
      if (!request) return;

      const handler = this.findHandler(request.command);
      const startTime = Date.now();

      const { result } = await this.executeWithDeduplication(msg, request, handler);
      const duration = Date.now() - startTime;

      this.collectMetrics(request.command, duration, 'success', correlationId, request.metadata);

      await this.sendSuccessResponse(request, result, correlationId, replyTo);
      this.acknowledgeMessage(msg);
    } catch (error) {
      this.logger.error('Error handling request', error as Error);
      this.collectMetrics('unknown', 0, 'error');
      await this.handleRequestError(msg, error, correlationId, replyTo);
    } finally {
      this.untrackInFlightMessage(correlationId);
    }
  }

  /**
   * Handle consumer cancellation by server
   */
  private async handleConsumerCancellation(): Promise<void> {
    this.logger.warn('Consumer cancelled by server, attempting to re-register');
    this.isRunning = false;
    await this.scheduleConsumerReconnect();
  }

  /**
   * Track in-flight message
   */
  private trackInFlightMessage(correlationId: string | undefined): void {
    if (correlationId) {
      this.inFlightMessages.add(correlationId);
    }
  }

  /**
   * Remove message from in-flight tracking
   */
  private untrackInFlightMessage(correlationId: string | undefined): void {
    if (correlationId) {
      this.inFlightMessages.delete(correlationId);
    }
  }

  /**
   * Parse and validate incoming message
   * Returns null if message was handled (ACK/NACK already sent)
   */
  private async parseAndValidateMessage(
    msg: amqp.ConsumeMessage
  ): Promise<RequestEnvelope | null> {
    if (!this.channel) return null;

    const correlationId = msg.properties.correlationId;
    const parseResult = await this.messageParser.parse(msg);

    if (!parseResult.success) {
      this.logger.error('Received malformed message', parseResult.error, {
        correlationId,
        strategy: parseResult.strategy,
      });

      const strategy = parseResult.strategy || 'dlq';
      await this.handleMalformedMessage(msg, strategy);
      return null;
    }

    const request: RequestEnvelope = parseResult.data;

    if (!request.command) {
      throw new ValidationError('Command is required in request');
    }

    this.logger.debug('Received RPC request', {
      command: request.command,
      correlationId,
    });

    return request;
  }

  /**
   * Handle malformed message according to strategy
   */
  private async handleMalformedMessage(
    msg: amqp.ConsumeMessage,
    strategy: 'reject' | 'dlq' | 'ignore'
  ): Promise<void> {
    if (!this.channel) return;

    switch (strategy) {
      case 'reject':
      case 'dlq':
        await this.channel.nack(msg, false, false);
        break;
      case 'ignore':
        await this.channel.ack(msg);
        break;
    }
  }

  /**
   * Find handler for command
   */
  private findHandler(command: string): RpcHandler {
    const normalizedCommand = command.toUpperCase();
    const handler = this.handlers.get(normalizedCommand);

    if (!handler) {
      throw new Error(`No handler registered for command: ${command}`);
    }

    return handler;
  }

  /**
   * Execute handler with deduplication check
   */
  private async executeWithDeduplication(
    msg: amqp.ConsumeMessage,
    request: RequestEnvelope,
    handler: RpcHandler
  ): Promise<{ result: any; duplicate: boolean }> {
    const correlationId = msg.properties.correlationId;

    const deduplicationResult = await this.deduplicator.process(msg, async () => {
      return await handler(request.data, request.metadata);
    });

    if (deduplicationResult.duplicate) {
      this.logger.debug('Skipped duplicate request', {
        command: request.command,
        correlationId,
      });
    }

    return {
      result: deduplicationResult.result,
      duplicate: deduplicationResult.duplicate,
    };
  }

  /**
   * Collect metrics for message processing
   */
  private collectMetrics(
    command: string,
    duration: number,
    status: 'success' | 'error',
    correlationId?: string,
    metadata?: Record<string, any>
  ): void {
    if (this.config.metrics) {
      this.config.metrics.incrementCounter(
        'hermes_messages_consumed_total',
        {
          queue: this.config.queueName,
          command,
          status: status === 'success' ? 'ack' : 'error',
        },
        1
      );

      if (status === 'success') {
        this.config.metrics.observeHistogram(
          'hermes_message_processing_duration_seconds',
          {
            queue: this.config.queueName,
            command,
          },
          duration / 1000
        );
      }
    }

    // Check for slow messages regardless of metrics being enabled
    if (status === 'success') {
      this.checkSlowMessage(command, duration, correlationId, metadata);
    }
  }

  /**
   * Send success response to client
   */
  private async sendSuccessResponse(
    request: RequestEnvelope,
    result: any,
    correlationId: string | undefined,
    replyTo: string | undefined
  ): Promise<void> {
    if (!replyTo || !this.channel) return;

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

  /**
   * Acknowledge message if auto mode is enabled
   */
  private acknowledgeMessage(msg: amqp.ConsumeMessage): void {
    if (!this.channel) return;

    if (this.config.ackStrategy.mode === 'auto') {
      this.channel.ack(msg);
    }
  }

  /**
   * Handle request errors with configurable ACK strategy
   */
  private async handleRequestError(
    msg: amqp.ConsumeMessage,
    error: unknown,
    correlationId: string | undefined,
    replyTo: string | undefined
  ): Promise<void> {
    const strategy = this.config.ackStrategy;
    const maxRetries = strategy.maxRetries ?? 3;
    const attempts = (msg.properties.headers?.['x-retry-count'] as number) || 0;

    if (strategy.mode === 'manual') {
      // Let user handle via context (would need to be implemented with context pattern)
      // For now just NACK without requeue to send to DLQ
      if (this.channel) {
        this.channel.nack(msg, false, false);
      }
      return;
    }

    // Determine if we should requeue
    const shouldRequeue =
      typeof strategy.requeue === 'function'
        ? strategy.requeue(error as Error, attempts + 1)
        : (strategy.requeue ?? true);

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

    // Determine action based on retry count and strategy
    if (this.channel) {
      if (shouldRequeue && attempts < maxRetries) {
        // Calculate delay if configured
        let delay = 0;
        if (strategy.retryDelay) {
          delay =
            typeof strategy.retryDelay === 'function'
              ? strategy.retryDelay(attempts + 1)
              : strategy.retryDelay;
        }

        if (delay > 0) {
          // Schedule retry with delay
          // Note: This would require the RabbitMQ delayed message plugin
          // or implementation of a delay queue
          this.logger.debug('Scheduling retry with delay', {
            correlationId,
            delay,
            attempt: attempts + 1,
          });

          // For now, increment retry count and requeue
          msg.properties.headers = {
            ...msg.properties.headers,
            'x-retry-count': attempts + 1,
            'x-first-failure': msg.properties.headers?.['x-first-failure'] || Date.now(),
          };

          this.channel.nack(msg, false, true); // Requeue with delay (approximate)
        } else {
          // Requeue immediately
          msg.properties.headers = {
            ...msg.properties.headers,
            'x-retry-count': attempts + 1,
            'x-first-failure': msg.properties.headers?.['x-first-failure'] || Date.now(),
          };

          this.channel.nack(msg, false, true);
        }
      } else {
        // Max retries exceeded or should not requeue - send to DLQ
        this.logger.warn('Message sent to DLQ', {
          correlationId,
          attempts,
          maxRetries,
        });

        this.channel.nack(msg, false, false); // NACK without requeue - goes to DLQ
      }
    }
  }

  /**
   * Schedule consumer reconnection after cancellation
   */
  private async scheduleConsumerReconnect(): Promise<void> {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      this.logger.error('Max consumer reconnection attempts reached');
      return;
    }

    const baseDelay = 5000;
    const exponentialDelay = baseDelay * Math.pow(2, this.reconnectAttempts - 1);
    const delay = Math.min(exponentialDelay, 60000);

    this.logger.info(
      `Scheduling consumer reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`,
      {
        delay,
      }
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.reRegisterConsumer();
        this.reconnectAttempts = 0;
      } catch (error) {
        this.logger.error('Failed to reconnect consumer', error as Error);
        await this.scheduleConsumerReconnect();
      }
    }, delay);
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
   * Get number of active consumers
   *
   * @returns Number of active consumers (0 or 1 for RpcServer)
   */
  getConsumerCount(): number {
    return this.isRunning && this.consumerTag ? 1 : 0;
  }

  /**
   * Get number of in-flight messages
   *
   * @returns Number of messages currently being processed
   */
  getInFlightCount(): number {
    return this.inFlightMessages.size;
  }

  /**
   * Check if message processing was slow and trigger callback
   */
  private checkSlowMessage(
    command: string,
    duration: number,
    messageId?: string,
    metadata?: Record<string, any>
  ): void {
    const thresholds = this.config.slowMessageDetection?.slowThresholds;

    if (!thresholds || (!thresholds.warn && !thresholds.error)) {
      return;
    }

    let level: 'warn' | 'error' | null = null;
    let threshold = 0;

    if (thresholds.error && duration >= thresholds.error) {
      level = 'error';
      threshold = thresholds.error;
    } else if (thresholds.warn && duration >= thresholds.warn) {
      level = 'warn';
      threshold = thresholds.warn;
    }

    if (level) {
      const context = {
        command,
        duration,
        threshold,
        level,
        messageId,
        metadata,
      };

      // Call user callback if provided
      if (this.config.slowMessageDetection?.onSlowMessage) {
        this.config.slowMessageDetection.onSlowMessage(context);
      }

      // Log by default
      const logMessage = `Slow message detected: ${command} took ${duration}ms (threshold: ${threshold}ms)`;
      const logContext = {
        command,
        duration,
        threshold,
        messageId,
      };

      if (level === 'error') {
        this.logger.error(logMessage, undefined, logContext);
      } else {
        this.logger.warn(logMessage, logContext);
      }
    }
  }

  /**
   * Stop the RPC server
   *
   * Stops listening for new requests and waits for in-flight requests to complete.
   * After calling stop(), the server cannot be restarted.
   */
  async stop(options?: { timeout?: number; force?: boolean }): Promise<void> {
    const timeout = options?.timeout || 30000;

    if (!this.isRunning) {
      this.logger.warn('RpcServer is not running');
      return;
    }

    try {
      // Clear reconnect timer if exists
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
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
      if (!options?.force) {
        const startTime = Date.now();

        while (this.inFlightMessages.size > 0 && Date.now() - startTime < timeout) {
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
      }

      // Clear deduplication cache
      this.deduplicator.clear();

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
    } catch (error) {
      this.logger.error('Error during shutdown', error as Error);
      if (!options?.force) {
        throw error;
      }
    }
  }
}
