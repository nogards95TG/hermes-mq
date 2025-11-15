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
import {
  compose,
  type MessageContext,
  type Middleware,
  type Handler as CoreHandler,
} from '../../core';
import { isTransientError } from '../../core';
import { getXDeathCount } from '../../core';

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
  errorHandling?: {
    requeueTransientErrors?: boolean;
    maxRetries?: number;
  };
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
 * Stores the composed core handler so MessageContext can be created once at runtime.
 */
interface HandlerRegistration<T = any> {
  pattern: string;
  composedHandler: CoreHandler<T>;
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
  // Global middlewares applied to every registered handler (in registration order)
  private globalMiddlewares: Middleware[] = [];
  private consumerTag?: string;
  private running = false;
  private generatedQueueName?: string;

  /**
   * Add one or more global middleware that will be executed for every handler
   *
   * @example
   * server.use(middleware1)
   * server.use(middleware1, middleware2, middleware3)
   */
  use(...mws: Middleware[]): this {
    for (const m of mws) {
      if (typeof m !== 'function') {
        throw new ValidationError('Middleware must be a function', {});
      }
      this.globalMiddlewares.push(m);
    }

    return this;
  }

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
      errorHandling: config.errorHandling ?? { requeueTransientErrors: true, maxRetries: 3 },
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
  on<T = any>(eventPattern: string, handler: EventHandler<T>): this;
  on<T = any>(
    eventPattern: string,
    ...middlewaresAndHandler: [...Middleware[], EventHandler<T>]
  ): this;
  on(eventPattern: string, ...args: any[]): this {
    if (!eventPattern || typeof eventPattern !== 'string') {
      throw new ValidationError('Event pattern must be a non-empty string', {});
    }

    if (args.length === 0) {
      throw new ValidationError('Handler is required', {});
    }

    const last = args[args.length - 1];
    if (typeof last !== 'function') {
      throw new ValidationError('Handler must be a function', {});
    }

    const userHandler: EventHandler = last as EventHandler;
    const perHandlerMiddlewares: Middleware[] = args.slice(0, -1) as Middleware[];

    const regex = this.patternToRegex(eventPattern);

    // Compose the adapter with any global or per-handler middleware. Even when there
    // are no user middlewares, the adapter will be composed and stored as the
    // composedHandler so runtime always receives a CoreHandler.

    // Adapter: create a core Handler that calls the legacy EventHandler signature
    const adapter: CoreHandler = (message: any, ctx: MessageContext) => {
      const legacyCtx = {
        eventName: ctx.eventName ?? ctx.routingKey ?? '',
        timestamp: ctx.timestamp instanceof Date ? ctx.timestamp.getTime() : Date.now(),
        metadata: (ctx as any).metadata,
        rawMessage: (ctx as any).rawMessage,
      };

      return userHandler(message, legacyCtx as any);
    };

    const fullStack: [...Middleware[], CoreHandler] = [
      ...(this.globalMiddlewares as Middleware[]),
      ...(perHandlerMiddlewares as Middleware[]),
      adapter as CoreHandler,
    ];

    const composed = compose(...(fullStack as any));

    // Store composed handler directly; handleMessage will create MessageContext once
    this.handlers.push({ pattern: eventPattern, composedHandler: composed as CoreHandler, regex });

    this.config.logger.debug(`Registered handler with middleware for pattern: ${eventPattern}`);

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

  let eventName = msg.fields?.routingKey || 'unknown';
    try {
      const envelope = this.config.serializer.decode(msg.content);
      eventName = envelope.eventName || msg.fields.routingKey;
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

      // Create MessageContext ONCE and pass to composed handlers
      const context: MessageContext = {
        messageId: msg.properties?.messageId || randomUUID(),
        timestamp: new Date(timestamp),
        eventName,
        routingKey: msg.fields?.routingKey,
        headers: msg.properties?.headers || {},
        metadata,
        rawMessage: msg,
        ack: async () => {
          if (channel && msg) await channel.ack(msg);
        },
        nack: async (requeue = false) => {
          if (channel && msg) await channel.nack(msg, false, requeue);
        },
      } as MessageContext;

      // Execute all composed handlers in parallel
      await Promise.all(
        matchingHandlers.map(({ composedHandler }) => composedHandler(data, context))
      );

      await channel.ack(msg);
      this.config.logger.debug(`Successfully processed event: ${eventName}`);
    } catch (error) {
      const err = error as Error;
      this.config.logger.error(`Error handling message: ${err?.message ?? 'Unknown error'}`);

      try {
        const headers = msg.properties?.headers as Record<string, any> | undefined;
        const attempts = getXDeathCount(headers, { queue: this.generatedQueueName || this.config.queueName });
        const maxRetries = this.config.errorHandling?.maxRetries ?? 3;

        if (attempts >= maxRetries) {
          this.config.logger.warn('Max retry attempts exceeded, sending to DLQ', {
            eventName,
            attempts,
            maxRetries,
          });
          await channel.nack(msg, false, false);
          return;
        }

        const transient = isTransientError(err);
        if (transient) {
          const requeue = this.config.errorHandling?.requeueTransientErrors ?? true;
          this.config.logger.warn('Transient error, requeuing message', {
            eventName,
            requeue,
            error: err.message,
            attempts,
          });
          await channel.nack(msg, false, requeue);
        } else {
          this.config.logger.error('Permanent error, sending to DLQ (nack without requeue)', err, {
            eventName,
            attempts,
          });
          await channel.nack(msg, false, false);
        }
      } catch (ackErr) {
        this.config.logger.error('Failed to apply ack/nack for error handling', ackErr as Error);
      }
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
