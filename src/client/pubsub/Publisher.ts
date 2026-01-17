import { Channel } from 'amqplib';
import { randomUUID } from 'crypto';
import {
  ConnectionManager,
  type Logger,
  type Serializer,
  JsonSerializer,
  SilentLogger,
  ValidationError,
  HermesError,
  type RetryConfig,
  MetricsCollector,
} from '../../core';

/**
 * Publisher configuration
 */
export interface PublisherConfig {
  connection: {
    url: string;
    reconnect?: boolean;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
    heartbeat?: number;
  };
  exchanges?: Array<{
    name: string;
    type?: 'topic' | 'fanout' | 'direct';
    options?: {
      durable?: boolean;
      autoDelete?: boolean;
      internal?: boolean;
      arguments?: Record<string, unknown>;
    };
  }>;
  exchange?: string;
  exchangeType?: 'topic' | 'fanout' | 'direct';
  defaultExchange?: string;
  persistent?: boolean;
  publisherConfirms?: boolean;
  confirmMode?: 'sync' | 'async';
  mandatory?: boolean;
  onReturn?: (msg: ReturnedMessage) => void;
  retry?: RetryConfig;
  serializer?: Serializer;
  logger?: Logger;
  /**
   * Enable metrics collection using the global MetricsCollector instance.
   * When enabled, metrics are automatically collected and aggregated with all other components.
   * Default: false
   */
  enableMetrics?: boolean;
}

/**
 * Returned message information
 */
export interface ReturnedMessage {
  replyCode: number;
  replyText: string;
  exchange: string;
  routingKey: string;
  message: Buffer;
}

interface PublishOptions {
  exchange?: string;
  routingKey?: string;
  persistent?: boolean;
  mandatory?: boolean;
  metadata?: Record<string, any>;
}

/**
 * Default publisher configuration
 */
const DEFAULT_CONFIG = {
  exchangeType: 'topic' as const,
  persistent: true,
  publisherConfirms: true,
  confirmMode: 'sync' as const,
  mandatory: false,
  enableMetrics: false,
  retry: { enabled: true, maxAttempts: 3, initialDelay: 1000 },
} as const;

/**
 * Required publisher configuration with defaults applied
 */
type RequiredPublisherConfig = Required<
  Omit<PublisherConfig, 'exchanges' | 'exchange' | 'exchangeType' | 'onReturn' | 'confirmMode'>
> & {
  exchanges?: PublisherConfig['exchanges'];
  exchange?: string;
  exchangeType?: 'topic' | 'fanout' | 'direct';
  onReturn?: (msg: ReturnedMessage) => void;
  confirmMode?: 'sync' | 'async';
  metrics?: MetricsCollector;
};

/**
 * Publisher for Pub/Sub pattern over RabbitMQ
 *
 * The Publisher allows you to publish events to exchanges that can be consumed by multiple subscribers.
 * It supports different exchange types (topic, fanout, direct) and handles connection management automatically.
 *
 * @example
 * ```typescript
 * import { Publisher } from 'hermes-mq';
 *
 * const publisher = new Publisher({
 *   connection: { url: 'amqp://localhost' },
 *   exchange: 'events'
 * });
 *
 * // Publish an event
 * await publisher.publish('user.created', { userId: '123', name: 'John' });
 *
 * await publisher.close();
 * ```
 */
export class Publisher {
  private connectionManager: ConnectionManager;
  private channel?: Channel;
  private config: RequiredPublisherConfig;
  private assertedExchanges = new Set<string>();
  private exchangeTypes = new Map<string, 'topic' | 'fanout' | 'direct'>();
  private writeBuffer: Array<() => Promise<void>> = [];
  private isWriting = false;

  /**
   * Create a new Publisher instance
   *
   * @param config - Publisher configuration including connection and exchange details
   * @throws {ValidationError} When connection URL is missing
   */
  constructor(config: PublisherConfig) {
    if (!config.connection?.url) {
      throw new ValidationError('Connection URL is required', {});
    }

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      connection: config.connection,
      defaultExchange: config.defaultExchange ?? config.exchange ?? 'amq.topic',
      serializer: config.serializer ?? new JsonSerializer(),
      logger: config.logger ?? new SilentLogger(),
      // Use global metrics if enabled
      metrics: config.enableMetrics ? MetricsCollector.global() : undefined,
    };

    this.connectionManager = ConnectionManager.getInstance({
      url: this.config.connection.url,
      reconnect: this.config.connection.reconnect,
      reconnectInterval: this.config.connection.reconnectInterval,
      maxReconnectAttempts: this.config.connection.maxReconnectAttempts,
      heartbeat: this.config.connection.heartbeat,
      logger: this.config.logger,
    });

    // Store default exchange type
    if (this.config.exchange) {
      this.exchangeTypes.set(this.config.exchange, this.config.exchangeType ?? 'topic');
    }
    if (this.config.defaultExchange) {
      this.exchangeTypes.set(this.config.defaultExchange, this.config.exchangeType ?? 'topic');
    }

    // Store configured exchange types
    if (this.config.exchanges) {
      for (const ex of this.config.exchanges) {
        this.exchangeTypes.set(ex.name, ex.type ?? 'topic');
      }
    }
  }

  /**
   * Publish an event to an exchange
   *
   * @param eventName - The event name (used as routing key by default)
   * @param data - The event payload
   * @param options - Publishing options
   * @param options.exchange - Target exchange (uses default if not specified)
   * @param options.routingKey - Custom routing key (uses eventName if not specified)
   * @param options.persistent - Whether to persist the message (default: true)
   * @param options.metadata - Additional metadata to include
   * @throws {ValidationError} When eventName is invalid
   * @throws {HermesError} When publishing fails
   *
   * @example
   * ```typescript
   * // Basic publish
   * await publisher.publish('user.created', { userId: '123' });
   *
   * // With custom routing key
   * await publisher.publish('order.placed', orderData, {
   *   routingKey: 'orders.high-priority'
   * });
   *
   * // To specific exchange
   * await publisher.publish('notification', data, {
   *   exchange: 'notifications'
   * });
   * ```
   */
  async publish<T = any>(eventName: string, data: T, options: PublishOptions = {}): Promise<void> {
    if (!eventName || typeof eventName !== 'string') {
      throw new ValidationError('Event name must be a non-empty string', {});
    }

    const channel = await this.ensureChannel();
    const exchange = options.exchange ?? this.config.defaultExchange;
    const routingKey = options.routingKey ?? eventName;
    const persistent = options.persistent ?? this.config.persistent;
    const mandatory = options.mandatory ?? this.config.mandatory;

    // Ensure exchange exists with correct type
    const exchangeType = this.exchangeTypes.get(exchange) ?? this.config.exchangeType ?? 'topic';
    await this.assertExchange(channel, exchange, exchangeType);

    const messageId = randomUUID();
    const timestamp = Date.now();

    const envelope = {
      eventName,
      data,
      timestamp,
      metadata: options.metadata,
    };

    const payload = this.config.serializer.encode(envelope);

    const publishOperation = async () => {
      try {
        const published = channel.publish(exchange, routingKey, payload, {
          persistent,
          contentType: 'application/json',
          timestamp,
          messageId,
          mandatory,
        });

        // Handle backpressure - wait for channel to drain if needed
        if (!published) {
          this.config.logger.debug('Channel buffer full, waiting for drain...');
          await new Promise<void>((resolve) => channel.once('drain', resolve));
        }

        // Wait for broker confirmation if enabled
        if (this.config.publisherConfirms) {
          if (this.config.confirmMode === 'sync') {
            await (channel as any).waitForConfirms();
          }
          // Async mode: confirmations handled via channel.on('ack'/'nack')
        }

        // Track successful publish
        if (this.config.metrics) {
          this.config.metrics.incrementCounter(
            'hermes_messages_published_total',
            {
              exchange,
              eventName,
              status: 'success',
            },
            1
          );
        }

        this.config.logger.debug(`Published event "${eventName}" to ${exchange}/${routingKey}`, {
          messageId,
        });
      } catch (error) {
        // Track failed publish
        if (this.config.metrics) {
          this.config.metrics.incrementCounter(
            'hermes_messages_published_total',
            {
              exchange,
              eventName,
              status: 'error',
            },
            1
          );
        }

        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new HermesError(`Failed to publish event: ${message}`, 'PUBLISH_ERROR');
      }
    };

    // Execute publish with retry if configured
    if (this.config.retry?.enabled) {
      await this.publishWithRetry(publishOperation);
    } else {
      await publishOperation();
    }
  }

  /**
   * Publish the same event to multiple exchanges
   *
   * @param exchanges - Array of exchange names to publish to
   * @param eventName - The event name
   * @param data - The event payload
   * @param options - Publishing options (same as publish method)
   * @throws {ValidationError} When exchanges array is invalid
   *
   * @example
   * ```typescript
   * await publisher.publishToMany(
   *   ['events', 'audit', 'notifications'],
   *   'user.deleted',
   *   { userId: '123' }
   * );
   * ```
   */
  async publishToMany<T = any>(
    exchanges: string[],
    eventName: string,
    data: T,
    options: Omit<PublishOptions, 'exchange'> = {}
  ): Promise<void> {
    if (!Array.isArray(exchanges) || exchanges.length === 0) {
      throw new ValidationError('Exchanges must be a non-empty array', {});
    }

    await Promise.all(
      exchanges.map((exchange) => this.publish(eventName, data, { ...options, exchange }))
    );
  }

  // Placeholder for future broadcast implementation
  // Should publish to all known subscribers/exchanges
  async broadcast(): Promise<void> {
    this.config.logger.warn('Broadcast method not implemented yet');
  }

  /**
   * Close publisher and cleanup resources
   *
   * Closes the channel and connection. After calling close(),
   * the publisher cannot be reused.
   */
  async close(): Promise<void> {
    this.assertedExchanges.clear();
    this.exchangeTypes.clear();
    if (this.channel) {
      try {
        await this.channel.close();
      } catch (error) {
        this.config.logger.warn('Error closing Publisher channel');
      }
      this.channel = undefined;
    }
    await this.connectionManager.close();
  }

  /**
   * Get or create channel with confirm mode
   */
  private async ensureChannel(): Promise<Channel> {
    if (this.channel) {
      return this.channel;
    }

    const connection = await this.connectionManager.getConnection();

    // Create confirm channel if publisher confirms are enabled, otherwise regular channel
    // Cast to any to access createChannel methods not defined in types but exist at runtime
    const channel = this.config.publisherConfirms
      ? await (connection as any).createConfirmChannel()
      : await (connection as any).createChannel();

    this.channel = channel;

    // Handle channel lifecycle
    channel.on('close', () => {
      this.config.logger.warn('Publisher channel closed');
      this.channel = undefined;
      this.assertedExchanges.clear();
    });

    channel.on('error', (error: Error) => {
      this.config.logger.error('Publisher channel error:', error);
    });

    // Handle returned messages (mandatory flag)
    channel.on('return', (msg: any) => {
      const returnedMsg: ReturnedMessage = {
        replyCode: msg.fields.replyCode,
        replyText: msg.fields.replyText,
        exchange: msg.fields.exchange,
        routingKey: msg.fields.routingKey,
        message: msg.content,
      };

      this.config.logger.warn('Message returned (not routed)', {
        exchange: returnedMsg.exchange,
        routingKey: returnedMsg.routingKey,
        replyText: returnedMsg.replyText,
      });

      if (this.config.onReturn) {
        this.config.onReturn(returnedMsg);
      }
    });

    // Handle drain event for backpressure
    channel.on('drain', () => {
      this.config.logger.debug('Channel drained, resuming writes');
      this.processWriteBuffer();
    });

    // Assert pre-configured exchanges
    if (this.config.exchanges) {
      for (const ex of this.config.exchanges) {
        await this.assertExchange(channel, ex.name, ex.type, ex.options);
      }
    }

    return channel;
  }

  /**
   * Process buffered write operations
   */
  private async processWriteBuffer(): Promise<void> {
    if (this.isWriting || this.writeBuffer.length === 0) {
      return;
    }

    this.isWriting = true;

    while (this.writeBuffer.length > 0) {
      const operation = this.writeBuffer.shift();
      if (operation) {
        try {
          await operation();
        } catch (error) {
          this.config.logger.error('Error processing buffered write', error as Error);
        }
      }
    }

    this.isWriting = false;
  }

  /**
   * Publish with retry logic
   */
  private async publishWithRetry(operation: () => Promise<void>): Promise<void> {
    const maxAttempts = this.config.retry?.maxAttempts ?? 3;
    const initialDelay = this.config.retry?.initialDelay ?? 1000;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await operation();
        return; // Success
      } catch (error) {
        lastError = error as Error;
        this.config.logger.warn(`Publish attempt ${attempt} failed`, {
          error: lastError.message,
          attempt,
          maxAttempts,
        });

        if (attempt < maxAttempts) {
          // Exponential backoff
          const delay = initialDelay * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed
    throw new HermesError(
      `Failed to publish after ${maxAttempts} attempts: ${lastError?.message}`,
      'PUBLISH_ERROR'
    );
  }

  /**
   * Assert exchange exists (cached to avoid repeated assertions)
   */
  private async assertExchange(
    channel: Channel,
    exchange: string,
    type: 'topic' | 'fanout' | 'direct' = 'topic',
    options: {
      durable?: boolean;
      autoDelete?: boolean;
      internal?: boolean;
      arguments?: Record<string, unknown>;
    } = { durable: true, autoDelete: false }
  ): Promise<void> {
    if (this.assertedExchanges.has(exchange)) {
      return;
    }

    try {
      await channel.assertExchange(exchange, type, options);
      this.assertedExchanges.add(exchange);
      this.config.logger.debug(`Asserted exchange: ${exchange} (${type})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HermesError(
        `Failed to assert exchange "${exchange}": ${message}`,
        'EXCHANGE_ERROR'
      );
    }
  }
}
