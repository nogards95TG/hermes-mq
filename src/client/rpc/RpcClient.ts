import * as amqp from 'amqplib';
import { randomUUID } from 'crypto';
import {
  ConnectionManager,
  ConnectionConfig,
  TimeoutError,
  ValidationError,
  Logger,
  SilentLogger,
  RequestEnvelope,
  ResponseEnvelope,
  Serializer,
  JsonSerializer,
} from '../../core';

/**
 * RPC Client configuration
 */
export interface RpcClientConfig {
  connection: ConnectionConfig;
  queueName: string;
  timeout?: number;
  publisherConfirms?: boolean;
  persistent?: boolean;
  serializer?: Serializer;
  logger?: Logger;
  assertQueue?: boolean;
  queueOptions?: amqp.Options.AssertQueue;
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
  timeout: 30000,
  publisherConfirms: true,
  persistent: false,
  assertQueue: true,
  queueOptions: {
    durable: true,
  },
};

/**
 * RpcClient implements request/response pattern over RabbitMQ
 *
 * The RPC client allows you to send requests to a server and receive responses asynchronously.
 * It handles connection management, request correlation, timeouts, and error handling automatically.
 *
 * @example
 * ```typescript
 * import { RpcClient } from 'hermes-mq';
 *
 * const client = new RpcClient({
 *   connection: { url: 'amqp://localhost' },
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
  private config: Required<Omit<RpcClientConfig, 'connection' | 'logger' | 'serializer'>>;
  private connectionManager: ConnectionManager;
  private channel: amqp.ConfirmChannel | null = null;
  private logger: Logger;
  private serializer: Serializer;
  private pendingRequests = new Map<string, PendingRequest<any>>();
  private isReady = false;
  private replyQueue: string | null = null;
  private consumerTag: string | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Create a new RPC client instance
   *
   * @param config - Client configuration including connection details and queue name
   */
  constructor(config: RpcClientConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.connectionManager = ConnectionManager.getInstance(config.connection);
    this.logger = config.logger || new SilentLogger();
    this.serializer = config.serializer || new JsonSerializer();
    
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
      this.channel = (await (connection as any).createConfirmChannel()) as amqp.ConfirmChannel;

      // Setup channel error handlers
      this.channel.on('error', (error: Error) => {
        this.logger.error('Channel error', error);
        this.isReady = false;
      });

      this.channel.on('close', () => {
        this.logger.warn('Channel closed');
        this.isReady = false;
      });

      // Assert the request queue
      if (this.config.assertQueue) {
        await this.channel.assertQueue(this.config.queueName, this.config.queueOptions);
        this.logger.debug(`Queue "${this.config.queueName}" asserted`);
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

      this.logger.info('RpcClient initialized', {
        queueName: this.config.queueName,
        replyQueue: this.replyQueue,
      });
    } catch (error) {
      this.logger.error('Failed to initialize RpcClient', error as Error);
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
    }
  ): Promise<TResponse> {
    if (!command) {
      throw new ValidationError('Command is required');
    }

    await this.initialize();

    if (!this.channel || !this.isReady) {
      throw new Error('RpcClient is not ready');
    }

    const correlationId = randomUUID();
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
        const content = this.serializer.encode(request);

        this.channel!.sendToQueue(this.config.queueName, content, {
          correlationId,
          replyTo: this.replyQueue!,
          persistent: this.config.persistent,
          contentType: 'application/json',
          messageId,
          timestamp: request.timestamp,
        });

        this.logger.debug('RPC request sent', {
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
      this.logger.warn('Received reply without correlationId');
      return;
    }

    const pending = this.pendingRequests.get(correlationId);
    if (!pending) {
      this.logger.warn('Received reply for unknown correlationId', { correlationId });
      return;
    }

    // Clear timeout and remove from pending
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(correlationId);

    try {
      const response: ResponseEnvelope = this.serializer.decode(msg.content);

      if (response.success) {
        pending.resolve(response.data);
      } else {
        const error = new Error(response.error?.message || 'Unknown error');
        error.name = response.error?.code || 'RPC_ERROR';
        (error as any).details = response.error?.details;
        pending.reject(error);
      }
    } catch (error) {
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
    // Run cleanup every 30 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredRequests();
    }, 30000);
    
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
      this.logger.debug(`Cleaned up ${cleanedCount} expired pending requests`, {
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
    // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.consumerTag && this.channel) {
      try {
        await this.channel.cancel(this.consumerTag);
      } catch (error) {
        this.logger.warn('Error cancelling consumer', { error: (error as Error).message });
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
        this.logger.warn('Error closing channel', { error: (error as Error).message });
      }
      this.channel = null;
    }

    this.isReady = false;
    this.logger.info('RpcClient closed');
  }
}
