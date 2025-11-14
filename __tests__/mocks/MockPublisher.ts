import { ValidationError } from '../../src/core';

/**
 * Published event entry for tracking
 */
interface PublishedEvent {
  exchange: string;
  eventName: string;
  data: any;
  timestamp: number;
  options?: {
    routingKey?: string;
    persistent?: boolean;
    metadata?: Record<string, any>;
  };
}

/**
 * Mock implementation of Publisher for testing
 * Use this in your tests to avoid needing a real RabbitMQ connection.
 */
export class MockPublisher {
  private publishedEvents: PublishedEvent[] = [];
  private closed = false;
  private defaultExchange: string;

  constructor(defaultExchange = 'amq.topic') {
    this.defaultExchange = defaultExchange;
  }

  /**
   * Publish an event (mocked)
   */
  async publish<T = any>(
    eventName: string,
    data: T,
    options?: {
      exchange?: string;
      routingKey?: string;
      persistent?: boolean;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    if (this.closed) {
      throw new Error('Publisher is closed');
    }

    if (!eventName || typeof eventName !== 'string') {
      throw new ValidationError('Event name must be a non-empty string', {});
    }

    const exchange = options?.exchange ?? this.defaultExchange;

    // Record the published event
    this.publishedEvents.push({
      exchange,
      eventName,
      data,
      timestamp: Date.now(),
      options: options
        ? {
            routingKey: options.routingKey,
            persistent: options.persistent,
            metadata: options.metadata,
          }
        : undefined,
    });
  }

  /**
   * Publish to multiple exchanges (mocked)
   */
  async publishToMany<T = any>(
    exchanges: string[],
    eventName: string,
    data: T,
    options?: {
      routingKey?: string;
      persistent?: boolean;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    if (!Array.isArray(exchanges) || exchanges.length === 0) {
      throw new ValidationError('Exchanges must be a non-empty array', {});
    }

    // Publish to each exchange
    for (const exchange of exchanges) {
      await this.publish(eventName, data, { ...options, exchange });
    }
  }

  /**
   * Get all published events
   */
  getPublishedEvents(): PublishedEvent[] {
    return [...this.publishedEvents];
  }

  /**
   * Get events by name
   */
  getEventsByName(eventName: string): PublishedEvent[] {
    return this.publishedEvents.filter((event) => event.eventName === eventName);
  }

  /**
   * Get events by exchange
   */
  getEventsByExchange(exchange: string): PublishedEvent[] {
    return this.publishedEvents.filter((event) => event.exchange === exchange);
  }

  /**
   * Get the last published event
   */
  getLastEvent(): PublishedEvent | undefined {
    return this.publishedEvents[this.publishedEvents.length - 1];
  }

  /**
   * Clear all published events history
   */
  clear(): void {
    this.publishedEvents = [];
  }

  /**
   * Close the publisher (just marks as closed)
   */
  async close(): Promise<void> {
    this.closed = true;
  }
}
