import * as amqp from 'amqplib';
import {
  ConnectionManager,
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
  ConsumerReconnectionManager,
  TIME,
  LIMITS,
  RETRY,
  ACK_MODE,
  MALFORMED_MESSAGE_STRATEGY,
  MessageParser,
  MessageDeduplicator,
  asConnectionWithConfirm,
  asChannelWithConnection,
  ExtendedError,
} from '../../core';

/**
 * RPC Server configuration
 */
export interface RpcServerConfig {
  connection: ConnectionManager;
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
  enableMetrics?: boolean; // When enabled, metrics are collecterd using global MetricsCollector
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
type RequiredRpcServerConfig = Required<Omit<RpcServerConfig, 'connection'>> & {
  logger: Logger;
  serializer: Serializer;
  metrics?: MetricsCollector;
};

/**
 * Default RPC server configuration
 */
const DEFAULT_CONFIG = {
  prefetch: LIMITS.RPC_SERVER_DEFAULT_PREFETCH, // RabbitMQ recommends a value between 10-50 to balance throughput and fairness
  assertQueue: true,
  enableMetrics: false,
  queueOptions: {
    durable: true,
  },
  ackStrategy: {
    mode: ACK_MODE.AUTO,
    requeue: true,
    maxRetries: RETRY.DEFAULT_MAX_ATTEMPTS,
  },
  messageValidation: {
    malformedMessageStrategy: MALFORMED_MESSAGE_STRATEGY.DLQ,
  },
  deduplication: {
    enabled: false,
    cacheTTL: TIME.DEDUPLICATION_CACHE_TTL_MS,
    cacheSize: LIMITS.DEDUPLICATION_CACHE_SIZE,
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
 * import { RpcServer, ConnectionManager } from 'hermes-mq';
 *
 * const connection = new ConnectionManager({ url: 'amqp://localhost' });
 *
 * const server = new RpcServer({
 *   connection,
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
  private handlers = new Map<string, RpcHandler>();
  private isRunning = false;
  private consumerTag: string | null = null;
  private inFlightMessages = new Set<string>();
  private messageParser: MessageParser;
  private deduplicator: MessageDeduplicator;
  private reconnectionManager: ConsumerReconnectionManager;

  constructor(config: RpcServerConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      logger: config.logger ?? new SilentLogger(),
      serializer: config.serializer ?? new JsonSerializer(),
      metrics: config.enableMetrics ? MetricsCollector.global() : undefined,
    } as any;

    this.connectionManager = config.connection;

    this.messageParser = new MessageParser(this.config.messageValidation);
    this.deduplicator = new MessageDeduplicator(this.config.deduplication);
    this.reconnectionManager = new ConsumerReconnectionManager({
      logger: this.config.logger,
    });
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
      throw ValidationError.commandRequired('Command is required');
    }

    if (typeof handler !== 'function') {
      throw ValidationError.handlerRequired('Handler must be a function');
    }

    const normalizedCommand = command.toUpperCase();

    if (this.handlers.has(normalizedCommand)) {
      this.config.logger.warn(`Overwriting existing handler for command: ${normalizedCommand}`);
    }

    this.handlers.set(normalizedCommand, handler);
    this.config.logger.debug(`Handler registered for command: ${normalizedCommand}`);
  }

  /**
   * Unregister a command handler
   */
  unregisterHandler(command: string): void {
    const normalizedCommand = command.toUpperCase();
    const deleted = this.handlers.delete(normalizedCommand);

    if (deleted) {
      this.config.logger.debug(`Handler unregistered for command: ${normalizedCommand}`);
    } else {
      this.config.logger.warn(`No handler found for command: ${normalizedCommand}`);
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
      this.config.logger.warn('RpcServer is already running');
      return;
    }

    try {
      const connection = await this.connectionManager.getConnection();
      this.channel = await asConnectionWithConfirm(connection).createConfirmChannel();

      // Setup channel error handlers
      this.channel.on('error', (error: Error) => {
        // Channel error detected - log and mark server as not running
        // The channel will need to be recreated by calling start() again
        this.config.logger.error(
          'RpcServer channel error - server stopped, call start() to recover',
          error
        );
        this.isRunning = false;
        this.channel = null;
      });

      this.channel.on('close', () => {
        this.config.logger.warn('Channel closed');
        this.isRunning = false;
      });

      // Handle consumer cancellation (server-side cancel)
      this.channel.on('cancel', () => {
        this.config.logger.warn('Consumer was cancelled by server, attempting to re-register...');
        this.isRunning = false;

        // Attempt to re-register the consumer after a delay
        setTimeout(() => {
          this.reRegisterConsumer().catch((error) => {
            this.config.logger.error(
              'Failed to re-register consumer after cancellation',
              error as Error
            );
          });
        }, 5000);
      });

      // Assert the request queue
      if (this.config.assertQueue) {
        await this.channel.assertQueue(this.config.queueName, this.config.queueOptions);
        this.config.logger.debug(`Queue "${this.config.queueName}" asserted`);
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

      // Reset reconnection manager on successful start
      this.reconnectionManager.reset();

      this.config.logger.info('RpcServer started', {
        queueName: this.config.queueName,
        prefetch: this.config.prefetch,
        handlers: this.handlers.size,
      });
    } catch (error) {
      this.config.logger.error('Failed to start RpcServer', error as Error);
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
      this.config.logger.info('Re-registering consumer...');

      // Get or recreate channel
      if (!this.channel || !asChannelWithConnection(this.channel).connection) {
        const connection = await this.connectionManager.getConnection();
        this.channel = await asConnectionWithConfirm(connection).createConfirmChannel();
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

      // Reset reconnection manager on successful re-registration
      this.reconnectionManager.reset();

      this.config.logger.info('Consumer re-registered successfully');
    } catch (error) {
      this.config.logger.error('Failed to re-register consumer', error as Error);
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
      this.config.logger.error('Error handling request', error as Error);
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
    this.config.logger.warn('Consumer cancelled by server, attempting to re-register');
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
  private async parseAndValidateMessage(msg: amqp.ConsumeMessage): Promise<RequestEnvelope | null> {
    if (!this.channel) return null;

    const correlationId = msg.properties.correlationId;
    const parseResult = await this.messageParser.parse(msg);

    if (!parseResult.success) {
      this.config.logger.error('Received malformed message', parseResult.error, {
        correlationId,
        strategy: parseResult.strategy,
      });

      const strategy = parseResult.strategy || 'dlq';
      await this.handleMalformedMessage(msg, strategy);
      return null;
    }

    const request: RequestEnvelope = parseResult.data;

    if (!request.command) {
      throw ValidationError.commandRequired('Command is required in request');
    }

    this.config.logger.debug('Received RPC request', {
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
        this.safeNack(msg, false);
        break;
      case 'ignore':
        this.channel.ack(msg);
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
      throw ValidationError.handlerRequired(`No handler registered for command: ${command}`, {
        command,
        registeredCommands: Array.from(this.handlers.keys()),
      });
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

    const { result, duplicate } = await this.deduplicator.process(msg, async () => {
      return await handler(request.data, request.metadata);
    });

    if (duplicate) {
      this.config.logger.debug('Skipped duplicate request', {
        command: request.command,
        correlationId,
      });
    }

    return {
      result,
      duplicate,
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

    const content = this.config.serializer.encode(response);

    this.channel.sendToQueue(replyTo, content, {
      correlationId,
      contentType: 'application/json',
    });

    this.config.logger.debug('Sent success response', {
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
      try {
        this.channel.ack(msg);
      } catch (ackError) {
        // Channel might have been closed during execution
        this.config.logger.debug('Failed to ack message - channel closed');
      }
    }
  }

  /**
   * Send error response to client
   */
  private async sendErrorResponse(
    error: unknown,
    correlationId: string | undefined,
    replyTo: string
  ): Promise<void> {
    if (!this.channel) return;

    try {
      const extendedError = error as ExtendedError;
      const response: ResponseEnvelope = {
        id: correlationId || 'unknown',
        timestamp: Date.now(),
        success: false,
        error: {
          code: extendedError.name || 'HANDLER_ERROR',
          message: extendedError.message,
          details: extendedError.details,
        },
      };

      const content = this.config.serializer.encode(response);

      this.channel.sendToQueue(replyTo, content, {
        correlationId,
        contentType: 'application/json',
      });

      this.config.logger.debug('Sent error response', {
        correlationId,
        error: (error as Error).message,
      });
    } catch (replyError) {
      this.config.logger.error('Failed to send error response', replyError as Error);
    }
  }

  /**
   * Calculate retry delay based on strategy
   */
  private calculateRetryDelay(attempts: number): number {
    const retryDelay = this.config.ackStrategy.retryDelay;
    if (!retryDelay) return 0;

    return typeof retryDelay === 'function' ? retryDelay(attempts + 1) : retryDelay;
  }

  /**
   * Determine if message should be requeued
   */
  private shouldRequeueMessage(error: unknown, attempts: number): boolean {
    const strategy = this.config.ackStrategy;
    const maxRetries = strategy.maxRetries ?? 3;

    if (attempts >= maxRetries) return false;

    const requeue = strategy.requeue;
    return typeof requeue === 'function'
      ? requeue(error as Error, attempts + 1)
      : (requeue ?? true);
  }

  /**
   * Update message headers for retry
   */
  private updateRetryHeaders(msg: amqp.ConsumeMessage, attempts: number): void {
    msg.properties.headers = {
      ...msg.properties.headers,
      'x-retry-count': attempts + 1,
      'x-first-failure': msg.properties.headers?.['x-first-failure'] || Date.now(),
    };
  }

  /**
   * Safely NACK a message with error handling
   */
  private safeNack(msg: amqp.ConsumeMessage, requeue: boolean, correlationId?: string): void {
    if (!this.channel) return;

    try {
      this.channel.nack(msg, false, requeue);
    } catch (nackError) {
      this.config.logger.debug('Failed to nack message - channel closed', { correlationId });
    }
  }

  /**
   * Requeue message with retry logic
   */
  private requeueMessageWithRetry(
    msg: amqp.ConsumeMessage,
    attempts: number,
    delay: number,
    correlationId?: string
  ): void {
    this.updateRetryHeaders(msg, attempts);
    // Fake delay logic - RabbitMQ does not support delayed requeue natively
    // needs proper implementation with delayed exchanges or plugins
    if (delay > 0) {
      this.config.logger.debug('Scheduling retry with delay', {
        correlationId,
        delay,
        attempt: attempts + 1,
      });
    }

    this.safeNack(msg, true, correlationId);
  }

  /**
   * Send message to Dead Letter Queue
   */
  private sendToDeadLetterQueue(
    msg: amqp.ConsumeMessage,
    attempts: number,
    correlationId?: string
  ): void {
    const maxRetries = this.config.ackStrategy.maxRetries ?? 3;

    this.config.logger.warn('Message sent to DLQ', {
      correlationId,
      attempts,
      maxRetries,
    });

    this.safeNack(msg, false, correlationId);
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
    const attempts = (msg.properties.headers?.['x-retry-count'] as number) || 0;

    // Handle manual mode
    if (strategy.mode === 'manual') {
      this.safeNack(msg, false, correlationId);
      return;
    }

    // Send error response to client
    if (replyTo) {
      await this.sendErrorResponse(error, correlationId, replyTo);
    }

    // Determine retry or DLQ
    if (this.shouldRequeueMessage(error, attempts)) {
      const delay = this.calculateRetryDelay(attempts);
      this.requeueMessageWithRetry(msg, attempts, delay, correlationId);
    } else {
      this.sendToDeadLetterQueue(msg, attempts, correlationId);
    }
  }

  /**
   * Schedule consumer reconnection after cancellation
   */
  private async scheduleConsumerReconnect(): Promise<void> {
    await this.reconnectionManager.scheduleReconnect(async () => {
      await this.reRegisterConsumer();
    });
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

    if (!level) {
      return;
    }

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
      this.config.logger.error(logMessage, undefined, logContext);
    } else {
      this.config.logger.warn(logMessage, logContext);
    }
  }

  /**
   * Stop the RPC server
   *
   * Stops listening for new requests and waits for in-flight requests to complete.
   * After calling stop(), the server cannot be restarted.
   */
  async stop(options?: { timeout?: number; force?: boolean }): Promise<void> {
    const timeout = options?.timeout || TIME.DEFAULT_SHUTDOWN_TIMEOUT_MS;

    if (!this.isRunning) {
      this.config.logger.warn('RpcServer is not running');
      return;
    }

    try {
      // Cancel any pending reconnection attempts
      this.reconnectionManager.cancel();

      // Stop consuming new messages
      if (this.consumerTag && this.channel) {
        try {
          await this.channel.cancel(this.consumerTag);
          this.config.logger.debug('Consumer cancelled');
        } catch (error) {
          this.config.logger.warn('Error cancelling consumer', { error: (error as Error).message });
        }
      }

      // Wait for in-flight messages to complete
      if (!options?.force) {
        const startTime = Date.now();

        while (this.inFlightMessages.size > 0 && Date.now() - startTime < timeout) {
          this.config.logger.debug('Waiting for in-flight messages', {
            count: this.inFlightMessages.size,
          });
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        if (this.inFlightMessages.size > 0) {
          this.config.logger.warn('Stopping with in-flight messages', {
            count: this.inFlightMessages.size,
          });
        }
      }

      // Clear deduplication cache
      this.deduplicator.clear();

      // Close channel
      if (this.channel) {
        // Todo: safe close
        try {
          await this.channel.close();
        } catch (error) {
          this.config.logger.warn('Error closing channel', { error: (error as Error).message });
        }
        this.channel = null;
      }

      this.isRunning = false;
      this.config.logger.info('RpcServer stopped');
    } catch (error) {
      this.config.logger.error('Error during shutdown', error as Error);
      if (!options?.force) {
        throw error;
      }
    }
  }
}
