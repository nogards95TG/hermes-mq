import * as amqp from 'amqplib';
import { randomUUID } from 'crypto';
import {
  ConnectionManager,
  TimeoutError,
  ValidationError,
  StateError,
  Logger,
  SilentLogger,
  RequestEnvelope,
  ResponseEnvelope,
  Serializer,
  JsonSerializer,
  MetricsCollector,
  RetryConfig,
  RetryPolicy,
  TIME,
  asConnectionWithConfirm,
  ExtendedError,
} from '../../core';
import { NETWORK_ERRORS } from '../../core/constants';

/**
 * RPC Client configuration
 */
export interface RpcClientConfig {
  connection: ConnectionManager;
  queueName: string;
  timeout?: number;
  publisherConfirms?: boolean;
  persistent?: boolean;
  serializer?: Serializer;
  logger?: Logger;
  assertQueue?: boolean;
  queueOptions?: amqp.Options.AssertQueue;
  retry?: RetryConfig;
  enableMetrics?: boolean; // When enabled, metrics are collecterd using global MetricsCollector
}

/**
 * Pending request tracker
 */
interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  timestamp: number;
  abortController?: AbortController;
}

/**
 * Default RPC client configuration
 */
const DEFAULT_CONFIG = {
  timeout: TIME.DEFAULT_RPC_TIMEOUT_MS,
  publisherConfirms: true,
  persistent: false,
  assertQueue: true,
  enableMetrics: false,
  queueOptions: {
    durable: true,
  },
};

/**
 * Required RPC client configuration with defaults applied
 */
type RequiredRpcClientConfig = Required<Omit<RpcClientConfig, 'connection'>> & {
  logger: Logger;
  serializer: Serializer;
  metrics?: MetricsCollector;
};

/**
 * RpcClient implements request/response pattern over RabbitMQ
 *
 * The RPC client allows you to send requests to a server and receive responses asynchronously.
 * It handles connection management, request correlation, timeouts, and error handling automatically.
 *
 * @example
 * ```typescript
 * import { RpcClient, ConnectionManager } from 'hermes-mq';
 *
 * const connection = new ConnectionManager({ url: 'amqp://localhost' });
 *
 * const client = new RpcClient({
 *   connection,
 *   queueName: 'my-service'
 * });
 *
 * // Send a request
 * const result = await client.send('CALCULATE', { a: 5, b: 3 });
 * console.log(result); // { sum: 8 }
 *
 * await client.close();
 * ```
 */
export class RpcClient {
  private connectionManager: ConnectionManager;
  private channel: amqp.ConfirmChannel | null = null;
  private config: RequiredRpcClientConfig;
  private pendingRequests = new Map<string, PendingRequest<any>>();
  private isReady = false;
  private replyQueue: string | null = null;
  private consumerTag: string | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private retryPolicy?: RetryPolicy;

  /**
   * @remarks
   * You can share the same ConnectionManager instance across multiple components
   * to reuse the same underlying RabbitMQ connection.
   */
  constructor(config: RpcClientConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      logger: config.logger ?? new SilentLogger(),
      serializer: config.serializer ?? new JsonSerializer(),
      metrics: config.enableMetrics ? MetricsCollector.global() : undefined,
    } as any;

    this.connectionManager = config.connection;

    // Initialize RetryPolicy if retry is configured
    // For RPC, retry only on TimeoutError — tutto il resto è un esito definitivo
    if (config.retry?.enabled !== false) {
      const retryConfig = {
        ...config.retry,
        shouldRetry:
          config.retry?.shouldRetry ??
          ((error: Error) => {
            // Retry on timeout
            if (error.name === 'TimeoutError') return true;
            // Retry on network errors
            return NETWORK_ERRORS.some((code) => error.message?.includes(code));
          }),
      };
      this.retryPolicy = new RetryPolicy(retryConfig, this.config.logger);
    }

    // Start periodic cleanup of expired callbacks
    this.startCleanupInterval();
  }

  /**
   * Initialize the RPC client
   */
  private async initialize(): Promise<void> {
    if (this.isReady) return;

    try {
      const connection = await this.connectionManager.getConnection();
      this.channel = await asConnectionWithConfirm(connection).createConfirmChannel();

      // Setup channel error handlers
      this.channel.on('error', (error: Error) => {
        this.config.logger.error('Channel error', error);
        this.isReady = false;
      });

      this.channel.on('close', () => {
        this.config.logger.warn('Channel closed');
        this.isReady = false;
      });

      // Assert the request queue
      if (this.config.assertQueue) {
        await this.channel.assertQueue(this.config.queueName, this.config.queueOptions);
        this.config.logger.debug(`Queue "${this.config.queueName}" asserted`);
      }

      // Setup reply-to queue (using direct reply-to)
      this.replyQueue = 'amq.rabbitmq.reply-to';

      // Start consuming replies
      const consumer = await this.channel.consume(
        this.replyQueue,
        (msg: amqp.ConsumeMessage | null) => this.handleReply(msg),
        { noAck: true }
      );

      this.consumerTag = consumer.consumerTag;
      this.isReady = true;

      this.config.logger.info('RpcClient initialized', {
        queueName: this.config.queueName,
        replyQueue: this.replyQueue,
      });
    } catch (error) {
      this.config.logger.error('Failed to initialize RpcClient', error as Error);
      throw error;
    }
  }

  /**
   * Send an RPC request and wait for response
   *
   * @param command - The command name (case-insensitive)
   * @param data - The request payload
   * @param options - Additional options for the request
   * @param options.timeout - Custom timeout for this request (overrides default)
   * @param options.metadata - Additional metadata to send with the request
   * @param options.signal - AbortSignal to cancel the request
   * @param options.correlationId - Custom correlation ID for request tracking (defaults to auto-generated UUID)
   * @returns Promise that resolves with the response data
   * @throws {TimeoutError} When request times out
   * @throws {ValidationError} When command is invalid
   * @throws {Error} When client is not ready or connection fails
   *
   * @example
   * ```typescript
   * // Basic usage
   * const result = await client.send('ADD', { a: 5, b: 3 });
   *
   * // With custom timeout
   * const result = await client.send('PROCESS', data, { timeout: 5000 });
   *
   * // With metadata
   * const result = await client.send('CREATE', data, {
   *   metadata: { userId: '123', traceId: 'abc' }
   * });
   *
   * // With custom correlationId for tracing
   * const result = await client.send('CREATE', data, {
   *   correlationId: req.headers['x-trace-id'],
   *   metadata: { userId: '123' }
   * });
   *
   * // With abort signal
   * const controller = new AbortController();
   * setTimeout(() => controller.abort(), 1000);
   * const result = await client.send('LONG_RUNNING', data, {
   *   signal: controller.signal
   * });
   * ```
   */
  async send<TRequest = any, TResponse = any>(
    command: string,
    data: TRequest,
    options?: {
      timeout?: number;
      metadata?: Record<string, any>;
      signal?: AbortSignal;
      correlationId?: string;
    }
  ): Promise<TResponse> {
    // Use RetryPolicy if enabled, otherwise execute directly
    if (this.retryPolicy) {
      return this.retryPolicy.execute(
        () => this.sendInternal<TRequest, TResponse>(command, data, options),
        `rpc.send:${command}`
      );
    }

    // No retry - execute directly
    return this.sendInternal<TRequest, TResponse>(command, data, options);
  }

  /**
   * Internal send method without retry logic
   */
  private async sendInternal<TRequest = any, TResponse = any>(
    command: string,
    data: TRequest,
    options?: {
      timeout?: number;
      metadata?: Record<string, any>;
      signal?: AbortSignal;
      correlationId?: string;
    }
  ): Promise<TResponse> {
    if (!command) {
      throw ValidationError.commandRequired('Command is required');
    }

    await this.initialize();

    if (!this.channel || !this.isReady) {
      throw new StateError('RpcClient is not ready', {
        isReady: this.isReady,
        hasChannel: !!this.channel,
      });
    }

    const correlationId = options?.correlationId || randomUUID();
    const timeout = options?.timeout || this.config.timeout;
    const messageId = randomUUID();

    // Create request envelope
    const request: RequestEnvelope<TRequest> = {
      id: correlationId,
      command: command.toUpperCase(),
      timestamp: Date.now(),
      data,
      metadata: options?.metadata,
    };

    return new Promise<TResponse>((resolve, reject) => {
      // Setup timeout
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(correlationId);

        // Track timeout
        if (this.config.metrics) {
          this.config.metrics.incrementCounter(
            'hermes_rpc_requests_total',
            {
              queue: this.config.queueName,
              status: 'timeout',
            },
            1
          );
        }

        reject(
          new TimeoutError(`RPC request timeout after ${timeout}ms`, {
            command,
            timeout,
            correlationId,
          })
        );
      }, timeout);

      // Track pending request with timestamp
      this.pendingRequests.set(correlationId, {
        resolve,
        reject,
        timeout: timeoutHandle,
        timestamp: Date.now(),
      });

      // Handle AbortSignal
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          const pending = this.pendingRequests.get(correlationId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(correlationId);
            reject(new Error('Request aborted'));
          }
        });
      }

      try {
        // Send request
        const content = this.config.serializer.encode(request);

        this.channel!.sendToQueue(this.config.queueName, content, {
          correlationId,
          replyTo: this.replyQueue!,
          persistent: this.config.persistent,
          contentType: 'application/json',
          messageId,
          timestamp: request.timestamp,
        });

        this.config.logger.debug('RPC request sent', {
          command,
          correlationId,
          queueName: this.config.queueName,
        });
      } catch (error) {
        clearTimeout(timeoutHandle);
        this.pendingRequests.delete(correlationId);
        reject(error);
      }
    });
  }

  /**
   * Handle reply message
   */
  private handleReply(msg: amqp.ConsumeMessage | null): void {
    if (!msg) return;

    const correlationId = msg.properties.correlationId;
    if (!correlationId) {
      this.config.logger.warn('Received reply without correlationId');
      return;
    }

    const pending = this.pendingRequests.get(correlationId);
    if (!pending) {
      this.config.logger.warn('Received reply for unknown correlationId', { correlationId });
      return;
    }

    const duration = (Date.now() - pending.timestamp) / 1000; // Convert to seconds

    // Clear timeout and remove from pending
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(correlationId);

    try {
      const response: ResponseEnvelope = this.config.serializer.decode(msg.content);

      if (response.success) {
        // Track successful RPC request
        if (this.config.metrics) {
          this.config.metrics.incrementCounter(
            'hermes_rpc_requests_total',
            {
              queue: this.config.queueName,
              status: 'success',
            },
            1
          );
          this.config.metrics.observeHistogram(
            'hermes_rpc_request_duration_seconds',
            {
              queue: this.config.queueName,
              status: 'success',
            },
            duration
          );
        }

        pending.resolve(response.data);
      } else {
        // Track failed RPC request
        if (this.config.metrics) {
          this.config.metrics.incrementCounter(
            'hermes_rpc_requests_total',
            {
              queue: this.config.queueName,
              status: 'error',
            },
            1
          );
          this.config.metrics.observeHistogram(
            'hermes_rpc_request_duration_seconds',
            {
              queue: this.config.queueName,
              status: 'error',
            },
            duration
          );
        }

        const error: ExtendedError = new Error(response.error?.message || 'Unknown error');
        error.name = response.error?.code || 'RPC_ERROR';
        error.details = response.error?.details;
        pending.reject(error);
      }
    } catch (error) {
      // Track decode error
      if (this.config.metrics) {
        this.config.metrics.incrementCounter(
          'hermes_rpc_requests_total',
          {
            queue: this.config.queueName,
            status: 'decode_error',
          },
          1
        );
      }

      pending.reject(new Error(`Failed to decode response: ${(error as Error).message}`));
    }
  }

  /**
   * Check if the client is ready to send requests
   *
   * @returns true if client is connected and initialized
   */
  isClientReady(): boolean {
    return this.isReady;
  }

  /**
   * Start periodic cleanup of expired pending requests
   */
  private startCleanupInterval(): void {
    // Run cleanup periodically to remove expired requests
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredRequests();
    }, TIME.RPC_CLIENT_CLEANUP_INTERVAL_MS);

    // Prevent the interval from keeping the process alive
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Cleanup expired pending requests to prevent memory leaks
   */
  private cleanupExpiredRequests(): void {
    const now = Date.now();
    const maxAge = this.config.timeout * 2; // Cleanup requests older than 2x timeout
    let cleanedCount = 0;

    for (const [correlationId, pending] of this.pendingRequests.entries()) {
      const age = now - pending.timestamp;
      if (age > maxAge) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(correlationId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.config.logger.debug(`Cleaned up ${cleanedCount} expired pending requests`, {
        remaining: this.pendingRequests.size,
      });
    }
  }

  /**
   * Close the RPC client and cleanup resources
   *
   * Cancels all pending requests and closes the connection.
   * After calling close(), the client cannot be reused.
   */
  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.consumerTag && this.channel) {
      try {
        await this.channel.cancel(this.consumerTag);
      } catch (error) {
        this.config.logger.warn('Error cancelling consumer', { error: (error as Error).message });
      }
    }

    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Client is closing'));
    }
    this.pendingRequests.clear();

    if (this.channel) {
      try {
        await this.channel.close();
      } catch (error) {
        this.config.logger.warn('Error closing channel', { error: (error as Error).message });
      }
      this.channel = null;
    }

    this.isReady = false;
    this.config.logger.info('RpcClient closed');
  }
}
