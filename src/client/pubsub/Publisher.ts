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
import { Middleware, Handler, MessageContext, compose } from '../../core/middleware';

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
  private config: Required<Omit<PublisherConfig, 'exchanges' | 'exchange' | 'exchangeType'>> & {
    exchanges?: PublisherConfig['exchanges'];
    exchange?: string;
    exchangeType?: 'topic' | 'fanout' | 'direct';
  };
  private assertedExchanges = new Set<string>();
  private exchangeTypes = new Map<string, 'topic' | 'fanout' | 'direct'>();
  private globalMiddlewares: Middleware[] = [];

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
   * Add one or more global middleware that will be executed for every publish
   *
   * @example
   * publisher.use(middleware1)
   * publisher.use(middleware1, middleware2, middleware3)
   */
  use(...middlewares: Middleware[]): this {
    for (const m of middlewares) {
      if (typeof m !== 'function') {
        throw new ValidationError('Middleware must be a function', {});
      }
      this.globalMiddlewares.push(m);
    }

    return this;
  }

  /**
   * Publish an event to an exchange (or the configured default exchange).
   *
   * @param eventName - Routing key or event name to publish
   * @param data - Payload for the event
   * @param middlewaresOrOptions - Either an array of per-publish middlewares or a `PublishOptions` object
   * @param options - Publish options when per-publish middlewares are provided in the third argument
   * @returns Promise<void>
   * @throws {ValidationError} When `eventName` is invalid or required args are missing
   * @throws {HermesError} When the underlying publish to the broker fails
   *
   * Supported overloads:
   * - `publish(eventName, data, options?)`
   * - `publish(eventName, data, middlewares, options?)`
   *
   * Middleware composition order:
   * 1. global middlewares registered with `publisher.use(...)`
   * 2. per-publish middlewares passed as the third argument
   * 3. internal publish handler which serializes and publishes to the broker
   *
   * Middleware signature: `(message, ctx, next) => Promise<any> | any`.
   * The `MessageContext` provided to middlewares contains fields such as
   * `messageId`, `timestamp`, `routingKey`, `eventName` and `headers`.
   *
   * Examples:
   * ```ts
   * // Simple publish
   * await publisher.publish('user.created', { userId: '123', email: 'a@b.com' });
   *```
   *
   * ```ts
   * // Publish with per-publish middleware and options
   * await publisher.publish(
   *   'user.created',
   *   { userId: '123' },
   *   [
   *     async (message, ctx, next) => {
   *       // add tracing header
   *       ctx.headers = { ...(ctx.headers || {}), 'x-trace-id': 'trace-1' };
   *       return next();
   *     },
   *   ],
   *   { persistent: true }
   * );
   *```
   */
  async publish<T = any>(eventName: string, data: T, options?: PublishOptions): Promise<void>;

  async publish<T = any>(
    eventName: string,
    data: T,
    middlewares: Middleware[],
    options?: PublishOptions
  ): Promise<void>;

  async publish<T = any>(
    eventName: string,
    data: T,
    middlewaresOrOptions?: Middleware[] | PublishOptions,
    options?: PublishOptions
  ): Promise<void> {
    if (!eventName || typeof eventName !== 'string') {
      throw new ValidationError('Event name must be a non-empty string', { eventName });
    }

    let requestMiddlewares: Middleware[] = [];
    let publishOptions: PublishOptions = {};

    if (Array.isArray(middlewaresOrOptions)) {
      requestMiddlewares = middlewaresOrOptions;
      publishOptions = options || {};
    } else {
      publishOptions = middlewaresOrOptions || {};
    }

    const publishHandler: Handler = async (message, context) => {
      const channel = await this.ensureChannel();
      const exchange = publishOptions.exchange ?? this.config.defaultExchange;
      const persistent = publishOptions.persistent ?? this.config.persistent;
      const routingKey = publishOptions.routingKey ?? eventName;

      // Ensure exchange exists with correct type
      const exchangeType = this.exchangeTypes.get(exchange) ?? this.config.exchangeType ?? 'topic';
      await this.assertExchange(channel, exchange, exchangeType);

      const envelope = {
        eventName,
        data: message,
        timestamp: Date.now(),
        metadata: publishOptions.metadata,
      };

      const payload = this.config.serializer.encode(envelope);

      try {
        const published = channel.publish(exchange, routingKey, payload, {
          persistent,
          contentType: 'application/json',
          timestamp: envelope.timestamp,
          messageId: context.messageId,
          headers: context.headers,
        });

        // Wait for channel to drain if needed
        if (!published) {
          await new Promise<void>((resolve) => channel.once('drain', resolve));
        }

        // Wait for broker confirmation
        await (channel as any).waitForConfirms();
        this.config.logger.debug(`Published event "${routingKey}" to ${exchange}/${routingKey}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new HermesError(`Failed to publish event: ${message}`, 'PUBLISH_ERROR');
      }
    };

    // Compone middleware globali + specifici + handler
    const stack = [...this.globalMiddlewares, ...requestMiddlewares, publishHandler] as [
      ...Middleware[],
      Handler,
    ];
    const composed = compose(...stack);

    // Crea context
    const context: MessageContext = {
      messageId:
        publishOptions.metadata?.messageId ||
        `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      routingKey: publishOptions.routingKey ?? eventName,
      eventName: eventName, // backward compatibility
      headers: {},
    };

    return composed(data, context);
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
