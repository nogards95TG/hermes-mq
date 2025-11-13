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
} from '@hermes/core';

/**
 * RPC Client configuration
 */
export interface RpcClientConfig {
  connection: ConnectionConfig;
  queueName: string;
  timeout?: number;
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
  abortController?: AbortController;
}

/**
 * Default RPC client configuration
 */
const DEFAULT_CONFIG = {
  timeout: 30000,
  assertQueue: true,
  queueOptions: {
    durable: true,
  },
};

/**
 * RpcClient implements request/response pattern over RabbitMQ
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

  constructor(config: RpcClientConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.connectionManager = ConnectionManager.getInstance(config.connection);
    this.logger = config.logger || new SilentLogger();
    this.serializer = config.serializer || new JsonSerializer();
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
   * Send RPC request
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

      // Track pending request
      this.pendingRequests.set(correlationId, {
        resolve,
        reject,
        timeout: timeoutHandle,
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
          persistent: false,
          contentType: 'application/json',
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
   * Check if client is ready
   */
  isClientReady(): boolean {
    return this.isReady;
  }

  /**
   * Close the RPC client
   */
  async close(): Promise<void> {
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
