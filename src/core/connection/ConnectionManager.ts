import * as amqp from 'amqplib';
import { EventEmitter } from 'events';
import { Logger, SilentLogger } from '../types/Logger';
import { ConnectionError } from '../types/Errors';
import type { DLQOptions } from '../types/Messages';
import { TIME } from '../constants';
import { asConnectionWithConfirm } from '../types/Amqp';
import { CircuitBreaker } from '../resilience/CircuitBreaker';

/**
 * Connection configuration options
 */
export interface ConnectionConfig {
  url: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeat?: number;
  logger?: Logger;
  enableCircuitBreaker?: boolean; // default true
  circuitBreakerFailureThreshold?: number; // Number of consecutive failures before opening the circuit, default 5
  circuitBreakerResetTimeout?: number; // Time in milliseconds to wait before attempting to close the circuit, default 60000 (60 seconds)
  circuitBreakerHalfOpenMaxAttempts?: number; // Maximum number of connection attempts in half-open state, default 3
}

/**
 * Queue assertion options with DLQ support
 */
export interface QueueAssertionOptions {
  durable?: boolean;
  exclusive?: boolean;
  autoDelete?: boolean;
  arguments?: Record<string, any>;
  dlq?: DLQOptions;
  messageTtl?: number;
  maxLength?: number;
  overflow?: 'drop-head' | 'reject-publish' | 'reject-publish-dlx';
}

/**
 * Default connection configuration
 */
const DEFAULT_CONFIG: Required<Omit<ConnectionConfig, 'url' | 'logger'>> = {
  reconnect: true,
  reconnectInterval: TIME.CONNECTION_RECONNECT_BASE_DELAY_MS,
  maxReconnectAttempts: 10,
  heartbeat: 60,
  enableCircuitBreaker: true,
  circuitBreakerFailureThreshold: 5,
  circuitBreakerResetTimeout: 60_000,
  circuitBreakerHalfOpenMaxAttempts: 3,
};

/**
 * ConnectionManager manages RabbitMQ connections
 *
 * Manages RabbitMQ connections with automatic reconnection, connection pooling,
 * and graceful error handling.
 *
 * @example
 * ```typescript
 * import { ConnectionManager } from 'hermes-mq/core';
 *
 * const manager = new ConnectionManager({
 *   url: 'amqp://localhost',
 *   reconnect: true,
 *   heartbeat: 60
 * });
 *
 * const connection = await manager.getConnection();
 * // Use connection...
 *
 * await manager.close();
 * ```
 */
export class ConnectionManager extends EventEmitter {
  private connection: amqp.Connection | null = null;
  private isConnecting = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private config: Required<Omit<ConnectionConfig, 'logger'>>;
  private logger: Logger;
  private isClosed = false;
  private isClosing = false;
  private connectedAt: Date | null = null;
  private channelCount = 0;
  private circuitBreaker: CircuitBreaker | null = null;

  constructor(config: ConnectionConfig) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = config.logger || new SilentLogger();

    // Initialize circuit breaker if enabled
    if (this.config.enableCircuitBreaker) {
      this.circuitBreaker = new CircuitBreaker({
        failureThreshold: this.config.circuitBreakerFailureThreshold,
        resetTimeout: this.config.circuitBreakerResetTimeout,
        halfOpenMaxAttempts: this.config.circuitBreakerHalfOpenMaxAttempts,
        logger: this.logger,
      });

      // Forward circuit breaker events
      this.circuitBreaker.on('stateChange', (event) => {
        this.emit('circuitBreakerStateChange', event);
      });

      this.circuitBreaker.on('reset', () => {
        this.emit('circuitBreakerReset');
      });
    }
  }

  /**
   * Get active connection, establishing if necessary
   *
   * Returns the current connection or establishes a new one if needed.
   * Waits for ongoing connection attempts to complete.
   *
   * @returns Promise that resolves to the RabbitMQ connection
   * @throws {ConnectionError} When connection fails
   */
  async getConnection(): Promise<amqp.Connection> {
    if (this.isClosed) {
      throw ConnectionError.closed('ConnectionManager has been closed');
    }

    if (this.connection && !this.isConnecting) {
      return this.connection;
    }

    if (this.isConnecting) {
      // Wait for ongoing connection attempt
      return new Promise((resolve, reject) => {
        const onConnected = () => {
          cleanup();
          resolve(this.connection!);
        };
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const cleanup = () => {
          this.removeListener('connected', onConnected);
          this.removeListener('error', onError);
        };

        this.once('connected', onConnected);
        this.once('error', onError);
      });
    }

    return this.connect();
  }

  /**
   * Establish connection to RabbitMQ
   */
  private async connect(): Promise<amqp.Connection> {
    this.isConnecting = true;

    const connectFn = async (): Promise<amqp.Connection> => {
      // Warn if heartbeat is disabled
      if (this.config.heartbeat === 0) {
        this.logger.warn(
          'Heartbeat is disabled (0). This is not recommended for production as it may lead to connection issues. Consider setting heartbeat to 60 or 30 seconds.'
        );
      }

      this.logger.info('Connecting to RabbitMQ', {
        url: this.maskUrl(this.config.url),
        heartbeat: this.config.heartbeat,
      });

      const connection = (await amqp.connect(this.config.url, {
        heartbeat: this.config.heartbeat,
      })) as unknown as amqp.Connection;

      return connection;
    };

    try {
      // Use circuit breaker if enabled, otherwise connect directly
      const connection = this.circuitBreaker
        ? await this.circuitBreaker.execute(connectFn)
        : await connectFn();

      this.connection = connection;
      this.setupConnectionHandlers();
      this.reconnectAttempts = 0;
      this.isConnecting = false;
      this.connectedAt = new Date();

      this.logger.info('Connected to RabbitMQ');
      this.emit('connected');

      return this.connection;
    } catch (error) {
      this.isConnecting = false;
      const connectionError = ConnectionError.failed('Failed to connect to RabbitMQ', {
        error: (error as Error).message,
      });

      this.logger.error('Connection failed', connectionError);
      this.emit('error', connectionError);

      if (this.config.reconnect && this.reconnectAttempts < this.config.maxReconnectAttempts) {
        this.scheduleReconnect();
      }

      throw connectionError;
    }
  }

  /**
   * Setup connection event handlers
   */
  private setupConnectionHandlers(): void {
    if (!this.connection) return;

    this.connection.on('error', (error: Error) => {
      // "Unexpected close" errors occur when connections are closed abruptly
      // (e.g., during test cleanup or when RabbitMQ restarts)
      // Log as warning but don't propagate to avoid crashing the application
      if (error.message === 'Unexpected close') {
        this.logger.warn('Connection closed unexpectedly', {
          message: error.message,
          reconnect: this.config.reconnect,
        });
        return;
      }

      this.logger.error('Connection error', error);
      this.emit('error', error);
    });

    this.connection.on('close', () => {
      this.logger.warn('Connection closed');
      this.connection = null;
      this.connectedAt = null;
      this.emit('disconnected');

      if (this.config.reconnect && !this.isClosed && !this.isClosing) {
        this.scheduleReconnect();
      }
    });
  }

  /**
   * Schedule reconnection attempt with exponential backoff.
   *
   * @remarks
   * Connection errors within this method are intentionally caught and suppressed
   * because they are already logged and emitted in the connect() method.
   * The catch handler prevents unhandled promise rejection warnings.
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isClosed) return;

    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.config.maxReconnectAttempts) {
      this.logger.error('Max reconnection attempts reached');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    // Exponential backoff: delay = baseInterval * 2^(attempt - 1)
    // Capped at maximum reconnect delay
    const baseInterval = this.config.reconnectInterval;
    const exponentialDelay = baseInterval * Math.pow(2, this.reconnectAttempts - 1);
    const delay = Math.min(exponentialDelay, TIME.CONNECTION_RECONNECT_MAX_DELAY_MS);

    this.logger.info(
      `Scheduling reconnection attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts}`,
      { delay, attempt: this.reconnectAttempts }
    );

    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((error) => {
        // Intentionally suppressed: errors are already logged and emitted in connect()
        // This catch prevents unhandled promise rejection warnings
        this.logger.debug('Reconnection attempt failed, will retry if attempts remain', {
          error: (error as Error).message,
        });
      });
    }, delay);
  }

  /**
   * Check if currently connected
   *
   * @returns true if connection exists and is not in connecting state
   */
  isConnected(): boolean {
    return this.connection !== null && !this.isConnecting;
  }

  /**
   * Get connection status for health checks
   *
   * @returns Connection status information
   */
  getConnectionStatus(): {
    connected: boolean;
    connectedAt: Date | null;
    url: string;
    circuitBreakerState?: string;
  } {
    return {
      connected: this.isConnected(),
      connectedAt: this.connectedAt,
      url: this.maskUrl(this.config.url),
      circuitBreakerState: this.circuitBreaker?.getState(),
    };
  }

  /**
   * Get circuit breaker statistics
   *
   * @returns Circuit breaker statistics or null if disabled
   */
  getCircuitBreakerStats() {
    return this.circuitBreaker?.getStats() || null;
  }

  /**
   * Force reset the circuit breaker to CLOSED state
   *
   * Use this method to manually reset the circuit breaker,
   * for example after fixing the underlying issue.
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker?.forceReset();
  }

  /**
   * Get channel count
   *
   * @returns Number of active channels
   */
  getChannelCount(): number {
    return this.channelCount;
  }

  /**
   * Increment channel count (called when a channel is created)
   * @internal
   */
  incrementChannelCount(): void {
    this.channelCount++;
  }

  /**
   * Decrement channel count (called when a channel is closed)
   * @internal
   */
  decrementChannelCount(): void {
    this.channelCount = Math.max(0, this.channelCount - 1);
  }

  /**
   * Close connection and cleanup
   *
   * Closes the connection, cancels reconnection timers, and removes the instance
   * from the singleton registry. After calling close(), the manager cannot be reused.
   */
  async close(): Promise<void> {
    this.isClosing = true;
    this.isClosed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.connection) {
      try {
        await asConnectionWithConfirm(this.connection).close();
        this.logger.info('Connection closed gracefully');
      } catch (error) {
        this.logger.error('Error closing connection', error as Error);
      }
      this.connection = null;
    }

    this.removeAllListeners();
  }

  /**
   * Mask sensitive information in URL for logging
   */
  private maskUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.password) {
        parsed.password = '****';
      }
      return parsed.toString();
    } catch {
      return url.replace(/\/\/[^:]+:[^@]+@/, '//****:****@');
    }
  }

  /**
   * Assert a queue with optional DLQ configuration
   *
   * Creates a queue with optional dead-letter exchange configuration for
   * handling messages that fail processing.
   *
   * @param queueName - Name of the queue to assert
   * @param options - Queue assertion options including DLQ config
   * @throws {ConnectionError} When assertion fails
   */
  async assertQueue(
    queueName: string,
    options?: QueueAssertionOptions
  ): Promise<amqp.Replies.AssertQueue> {
    const connection = await this.getConnection();
    const channel = await asConnectionWithConfirm(connection).createChannel();

    try {
      const queueArgs: Record<string, any> = options?.arguments ?? {};

      // Configure message TTL
      if (options?.messageTtl !== undefined) {
        queueArgs['x-message-ttl'] = options.messageTtl;
      }

      // Configure max length
      if (options?.maxLength !== undefined) {
        queueArgs['x-max-length'] = options.maxLength;
      }

      // Configure overflow behavior
      if (options?.overflow) {
        queueArgs['x-overflow'] = options.overflow;
      }

      // Configure DLQ if enabled
      if (options?.dlq?.enabled) {
        const dlqExchange = options.dlq.exchange || 'dlx';
        const dlqRoutingKey = options.dlq.routingKey || `${queueName}.dead`;

        // Assert DLQ exchange
        await channel.assertExchange(dlqExchange, 'direct', { durable: true });

        // Assert DLQ queue
        const dlqName = `${queueName}.dlq`;
        await channel.assertQueue(dlqName, {
          durable: true,
          arguments: {
            'x-message-ttl': options.dlq.ttl,
            'x-max-length': options.dlq.maxLength,
          },
        });

        // Bind DLQ
        await channel.bindQueue(dlqName, dlqExchange, dlqRoutingKey);

        // Set dead letter arguments on main queue
        queueArgs['x-dead-letter-exchange'] = dlqExchange;
        queueArgs['x-dead-letter-routing-key'] = dlqRoutingKey;

        // Setup DLQ processor if provided
        if (options.dlq.processHandler) {
          await this.consumeDLQ(channel, dlqName, options.dlq.processHandler);
        }
      }

      // Assert main queue
      const result = await channel.assertQueue(queueName, {
        durable: options?.durable ?? true,
        exclusive: options?.exclusive ?? false,
        autoDelete: options?.autoDelete ?? false,
        arguments: queueArgs,
      });

      return result;
    } finally {
      await channel.close();
    }
  }

  /**
   * Consume messages from DLQ
   */
  private async consumeDLQ(
    channel: amqp.Channel,
    queueName: string,
    handler: (msg: any) => Promise<void>
  ): Promise<void> {
    await channel.consume(queueName, async (msg) => {
      if (!msg) return;

      try {
        let content;
        try {
          content = JSON.parse(msg.content.toString());
        } catch (parseError) {
          this.logger.error('Failed to parse DLQ message JSON', parseError as Error, {
            queue: queueName,
            messageId: msg.properties.messageId,
          });
          await channel.nack(msg, false, false);
          return;
        }

        await handler(content);
        await channel.ack(msg);
      } catch (error) {
        this.logger.error('DLQ processing failed', error as Error, {
          queue: queueName,
        });
        await channel.nack(msg, false, false);
      }
    });
  }
}
