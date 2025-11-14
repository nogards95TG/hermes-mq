import { Channel } from 'amqplib';
import {
  ConnectionManager,
  type Logger,
  type Serializer,
  JsonSerializer,
  SilentLogger,
  ValidationError,
  HermesError,
  type RetryConfig,
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
  retry?: RetryConfig;
  serializer?: Serializer;
  logger?: Logger;
}

interface PublishOptions {
  exchange?: string;
  routingKey?: string;
  persistent?: boolean;
  metadata?: Record<string, any>;
}

/**
 * Publisher for Pub/Sub pattern over RabbitMQ
 */
export class Publisher {
  private connectionManager: ConnectionManager;
  private channel?: Channel;
  private config: Required<Omit<PublisherConfig, 'exchanges' | 'exchange' | 'exchangeType'>> & {
    exchanges?: PublisherConfig['exchanges'];
    exchange?: string;
    exchangeType?: 'topic' | 'fanout' | 'direct';
  };
  private assertedExchanges = new Set<string>();
  private exchangeTypes = new Map<string, 'topic' | 'fanout' | 'direct'>();

  constructor(config: PublisherConfig) {
    if (!config.connection?.url) {
      throw new ValidationError('Connection URL is required', {});
    }

    this.config = {
      connection: config.connection,
      exchanges: config.exchanges,
      exchange: config.exchange,
      exchangeType: config.exchangeType ?? 'topic',
      defaultExchange: config.defaultExchange ?? config.exchange ?? 'amq.topic',
      persistent: config.persistent ?? true,
      retry: config.retry ?? { enabled: true, maxAttempts: 3, initialDelay: 1000 },
      serializer: config.serializer ?? new JsonSerializer(),
      logger: config.logger ?? new SilentLogger(),
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
   */
  async publish<T = any>(eventName: string, data: T, options: PublishOptions = {}): Promise<void> {
    if (!eventName || typeof eventName !== 'string') {
      throw new ValidationError('Event name must be a non-empty string', {});
    }

    const channel = await this.ensureChannel();
    const exchange = options.exchange ?? this.config.defaultExchange;
    const routingKey = options.routingKey ?? eventName;
    const persistent = options.persistent ?? this.config.persistent;

    // Ensure exchange exists with correct type
    const exchangeType = this.exchangeTypes.get(exchange) ?? this.config.exchangeType ?? 'topic';
    await this.assertExchange(channel, exchange, exchangeType);

    const envelope = {
      eventName,
      data,
      timestamp: Date.now(),
      metadata: options.metadata,
    };

    const payload = this.config.serializer.encode(envelope);

    try {
      const published = channel.publish(exchange, routingKey, payload, {
        persistent,
        contentType: 'application/json',
        timestamp: envelope.timestamp,
      });

      // Wait for channel to drain if needed
      if (!published) {
        await new Promise<void>((resolve) => channel.once('drain', resolve));
      }

      // Wait for broker confirmation
      await (channel as any).waitForConfirms();
      this.config.logger.debug(`Published event "${eventName}" to ${exchange}/${routingKey}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HermesError(`Failed to publish event: ${message}`, 'PUBLISH_ERROR');
    }
  }

  /**
   * Publish the same event to multiple exchanges
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

  /**
   * Close publisher and cleanup resources
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
    const channel = await (connection as any).createConfirmChannel();
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

    // Assert pre-configured exchanges
    if (this.config.exchanges) {
      for (const ex of this.config.exchanges) {
        await this.assertExchange(channel, ex.name, ex.type, ex.options);
      }
    }

    return channel;
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
    } = { durable: true }
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
