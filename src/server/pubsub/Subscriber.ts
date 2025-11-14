import { Channel, ConsumeMessage } from 'amqplib';
import { randomUUID } from 'crypto';
import {
  ConnectionManager,
  type Logger,
  type Serializer,
  JsonSerializer,
  SilentLogger,
  ValidationError,
  type RetryConfig,
} from '../../core';

/**
 * Subscriber configuration
 */
export interface SubscriberConfig {
  connection: {
    url: string;
    reconnect?: boolean;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
    heartbeat?: number;
  };
  exchange: string;
  exchangeType?: 'topic' | 'fanout' | 'direct';
  exchangeOptions?: {
    durable?: boolean;
    autoDelete?: boolean;
    internal?: boolean;
    arguments?: Record<string, unknown>;
  };
  queueName?: string;
  queueOptions?: {
    durable?: boolean;
    exclusive?: boolean;
    autoDelete?: boolean;
    arguments?: Record<string, unknown>;
  };
  prefetch?: number;
  retry?: RetryConfig;
  serializer?: Serializer;
  logger?: Logger;
}

/**
 * Event handler function signature
 */
export type EventHandler<T = any> = (
  data: T,
  context: {
    eventName: string;
    timestamp: number;
    metadata?: Record<string, any>;
    rawMessage: ConsumeMessage;
  }
) => Promise<void> | void;

/**
 * Internal handler registration
 */
interface HandlerRegistration<T = any> {
  pattern: string;
  handler: EventHandler<T>;
  regex: RegExp;
}

/**
 * Subscriber for Pub/Sub pattern over RabbitMQ
 *
 * The Subscriber listens for events on an exchange and routes them to registered handlers
 * based on routing patterns. Supports wildcards (* for one word, # for zero or more words).
 *
 * @example
 * ```typescript
 * import { Subscriber } from 'hermes-mq';
 *
 * const subscriber = new Subscriber({
 *   connection: { url: 'amqp://localhost' },
 *   exchange: 'events'
 * });
 *
 * // Register handlers with patterns
 * subscriber.on('user.created', (data) => {
 *   console.log('User created:', data);
 * });
 *
 * subscriber.on('order.*', (data, context) => {
 *   console.log('Order event:', context.eventName, data);
 * });
 *
 * await subscriber.start();
 * console.log('Subscriber running...');
 *
 * // Later...
 * await subscriber.stop();
 * ```
 */
export class Subscriber {
  private connectionManager: ConnectionManager;
  private channel?: Channel;
  private config: Required<
    Omit<SubscriberConfig, 'queueName' | 'queueOptions' | 'exchangeOptions'>
  > & {
    queueName?: string;
    queueOptions?: SubscriberConfig['queueOptions'];
    exchangeOptions?: SubscriberConfig['exchangeOptions'];
  };
  private handlers: HandlerRegistration[] = [];
  private consumerTag?: string;
  private running = false;
  private generatedQueueName?: string;

  /**
   * Create a new Subscriber instance
   *
   * @param config - Subscriber configuration including connection and exchange details
   * @throws {ValidationError} When connection URL or exchange is missing
   */
  constructor(config: SubscriberConfig) {
    if (!config.connection?.url) {
      throw new ValidationError('Connection URL is required', {});
    }

    if (!config.exchange) {
      throw new ValidationError('Exchange is required', {});
    }

    this.config = {
      connection: config.connection,
      exchange: config.exchange,
      exchangeType: config.exchangeType ?? 'topic',
      exchangeOptions: config.exchangeOptions ?? { durable: true },
      queueName: config.queueName,
      queueOptions: config.queueOptions ?? { durable: true, exclusive: false, autoDelete: true },
      prefetch: config.prefetch ?? 10,
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
  }

  /**
   * Register an event handler for a routing pattern
   *
   * Supports wildcards: * (one word), # (zero or more words)
   *
   * @param eventPattern - Routing pattern to match (supports * and # wildcards)
   * @param handler - Function called when matching events are received
   * @returns This subscriber instance for chaining
   * @throws {ValidationError} When pattern or handler is invalid
   *
   * @example
   * ```typescript
   * // Exact match
   * subscriber.on('user.created', handler);
   *
   * // Single word wildcard
   * subscriber.on('order.*', handler); // matches 'order.placed', 'order.cancelled'
   *
   * // Multiple words wildcard
   * subscriber.on('user.#', handler); // matches 'user.created', 'user.profile.updated'
   * ```
   */
  on<T = any>(eventPattern: string, handler: EventHandler<T>): this {
    if (!eventPattern || typeof eventPattern !== 'string') {
      throw new ValidationError('Event pattern must be a non-empty string', {});
    }

    if (typeof handler !== 'function') {
      throw new ValidationError('Handler must be a function', {});
    }

    const regex = this.patternToRegex(eventPattern);

    this.handlers.push({
      pattern: eventPattern,
      handler: handler as EventHandler,
      regex,
    });

    this.config.logger.debug(`Registered handler for pattern: ${eventPattern}`);

    return this;
  }

  /**
   * Start consuming events from the exchange
   *
   * Creates the exchange and queue, binds routing patterns, and begins consuming messages.
   * At least one handler must be registered before calling start().
   *
   * @throws {ValidationError} When no handlers are registered
   */
  async start(): Promise<void> {
    if (this.running) {
      this.config.logger.warn('Subscriber is already running');
      return;
    }

    if (this.handlers.length === 0) {
      throw new ValidationError(
        'No handlers registered. Use .on() to register at least one handler',
        {}
      );
    }

    const channel = await this.ensureChannel();

    // Create exchange if needed
    await channel.assertExchange(
      this.config.exchange,
      this.config.exchangeType,
      this.config.exchangeOptions
    );

    // Create queue (auto-generated name if not specified)
    const queueName = this.config.queueName ?? `${this.config.exchange}.${randomUUID()}`;
    const queueResult = await channel.assertQueue(queueName, this.config.queueOptions);
    this.generatedQueueName = queueResult.queue;

    // Bind queue to all registered patterns
    for (const { pattern } of this.handlers) {
      await channel.bindQueue(this.generatedQueueName, this.config.exchange, pattern);
      this.config.logger.debug(
        `Bound queue ${this.generatedQueueName} to ${this.config.exchange} with pattern: ${pattern}`
      );
    }

    // Set prefetch
    await channel.prefetch(this.config.prefetch);

    // Start consuming messages
    const consumeResult = await channel.consume(
      this.generatedQueueName,
      (msg) => this.handleMessage(msg),
      { noAck: false }
    );

    this.consumerTag = consumeResult.consumerTag;
    this.running = true;

    this.config.logger.info(`Subscriber started on queue ${this.generatedQueueName}`);
  }

  /**
   * Stop consuming and cleanup
   *
   * Stops consuming messages and closes the channel.
   * After calling stop(), the subscriber cannot be restarted.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    if (this.channel && this.consumerTag) {
      try {
        await this.channel.cancel(this.consumerTag);
        this.consumerTag = undefined;
      } catch (error) {
        this.config.logger.warn('Error canceling consumer');
      }
    }

    if (this.channel) {
      try {
        await this.channel.close();
      } catch (error) {
        this.config.logger.warn('Error closing Subscriber channel');
      }
      this.channel = undefined;
    }

    this.running = false;
    this.config.logger.info('Subscriber stopped');
  }

  /**
   * Check if subscriber is currently running
   *
   * @returns true if subscriber is actively consuming messages
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get or create channel
   */
  private async ensureChannel(): Promise<Channel> {
    if (this.channel) {
      return this.channel;
    }

    const connection = await this.connectionManager.getConnection();
    const channel = await (connection as any).createChannel();
    this.channel = channel;

    // Handle channel lifecycle
    channel.on('close', () => {
      this.config.logger.warn('Subscriber channel closed');
      this.channel = undefined;
      this.running = false;
    });

    channel.on('error', (error: Error) => {
      this.config.logger.error('Subscriber channel error:', error);
    });

    return channel;
  }

  /**
   * Process incoming message and dispatch to matching handlers
   */
  private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg) {
      return;
    }

    const channel = this.channel;
    if (!channel) {
      return;
    }

    try {
      const envelope = this.config.serializer.decode(msg.content);
      const eventName = envelope.eventName || msg.fields.routingKey;
      const timestamp = envelope.timestamp || Date.now();
      const metadata = envelope.metadata;
      const data = envelope.data;

      this.config.logger.debug(`Received event: ${eventName}`);

      // Find handlers that match the event pattern
      const matchingHandlers = this.handlers.filter((h) => h.regex.test(eventName));

      if (matchingHandlers.length === 0) {
        this.config.logger.warn(`No handlers matched for event: ${eventName}`);
        await channel.ack(msg);
        return;
      }

      // Execute all matching handlers in parallel
      await Promise.all(
        matchingHandlers.map(({ handler }) =>
          handler(data, {
            eventName,
            timestamp,
            metadata,
            rawMessage: msg,
          })
        )
      );

      await channel.ack(msg);
      this.config.logger.debug(`Successfully processed event: ${eventName}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.config.logger.error(`Error handling message: ${errorMsg}`);
      // Reject without requeue (dead letter if configured)
      await channel.nack(msg, false, false);
    }
  }

  /**
   * Convert RabbitMQ pattern to regex
   * * = one word, # = zero or more words
   */
  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/\./g, '\\.').replace(/\*/g, '[^.]+').replace(/#/g, '.*');

    return new RegExp(`^${escaped}$`);
  }
}
