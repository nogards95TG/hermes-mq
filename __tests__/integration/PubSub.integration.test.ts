import { describe, it, expect, afterEach } from 'vitest';
import { Publisher } from '../../src/client';
import { Subscriber } from '../../src/server';
import { setupRabbitMQSuite } from './testContainer';

describe('PubSub Integration Tests', () => {
  const { getUrl } = setupRabbitMQSuite();

  describe('Publisher → Subscriber flow', () => {
    let publisher: Publisher;
    let subscriber: Subscriber;

    afterEach(async () => {
      if (subscriber?.isRunning()) {
        await subscriber.stop();
      }
      if (publisher) {
        await publisher.close();
      }
    });

    it('should publish and receive event', async () => {
      const exchange = 'test-events';
      const eventName = 'user.created';
      const eventData = { id: 1, name: 'John Doe' };

      publisher = new Publisher({
        connection: { url: getUrl() },
        exchange,
      });

      const receivedEvents: any[] = [];

      subscriber = new Subscriber({
        connection: { url: getUrl() },
        exchange,
      });

      subscriber.on(eventName, (data: any) => {
        receivedEvents.push(data);
      });

      await subscriber.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      await publisher.publish(eventName, eventData);

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toEqual(eventData);
    });

    it('should match wildcard * pattern (one word)', async () => {
      const exchange = 'wildcard-test';

      publisher = new Publisher({
        connection: { url: getUrl() },
        exchange,
      });

      const receivedEvents: string[] = [];

      subscriber = new Subscriber({
        connection: { url: getUrl() },
        exchange,
      });

      subscriber.on('user.*', (_data: any, context: any) => {
        receivedEvents.push(context.eventName);
      });

      await subscriber.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      await publisher.publish('user.created', { id: 1 });
      await publisher.publish('user.updated', { id: 2 });
      await publisher.publish('user.deleted', { id: 3 });

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(receivedEvents).toHaveLength(3);
      expect(receivedEvents).toContain('user.created');
      expect(receivedEvents).toContain('user.updated');
      expect(receivedEvents).toContain('user.deleted');
    });

    it('should match wildcard # pattern (zero or more words)', async () => {
      const exchange = 'hash-wildcard-test';

      publisher = new Publisher({
        connection: { url: getUrl() },
        exchange,
      });

      const receivedEvents: string[] = [];

      subscriber = new Subscriber({
        connection: { url: getUrl() },
        exchange,
      });

      subscriber.on('order.#', (_data: any, context: any) => {
        receivedEvents.push(context.eventName);
      });

      await subscriber.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      await publisher.publish('order.created', {});
      await publisher.publish('order.shipped', {});
      await publisher.publish('order.shipped.express', {});
      await publisher.publish('order.delivered.success.confirmed', {});

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(receivedEvents).toHaveLength(4);
      expect(receivedEvents).toContain('order.created');
      expect(receivedEvents).toContain('order.shipped');
      expect(receivedEvents).toContain('order.shipped.express');
      expect(receivedEvents).toContain('order.delivered.success.confirmed');
    });

    it('should NOT receive events that do not match pattern', async () => {
      const exchange = 'pattern-mismatch-test';

      publisher = new Publisher({
        connection: { url: getUrl() },
        exchange,
      });

      const receivedEvents: string[] = [];

      subscriber = new Subscriber({
        connection: { url: getUrl() },
        exchange,
      });

      subscriber.on('user.*', (_data: any, context: any) => {
        receivedEvents.push(context.eventName);
      });

      await subscriber.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      await publisher.publish('user.created', {});
      await publisher.publish('order.created', {}); // Should NOT match
      await publisher.publish('product.updated', {}); // Should NOT match

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toBe('user.created');
    });

    it('should call multiple handlers for matching patterns', async () => {
      const exchange = 'multi-handler-test';

      publisher = new Publisher({
        connection: { url: getUrl() },
        exchange,
      });

      const handler1Events: string[] = [];
      const handler2Events: string[] = [];

      subscriber = new Subscriber({
        connection: { url: getUrl() },
        exchange,
      });

      subscriber.on('user.*', (_data: any, context: any) => {
        handler1Events.push(context.eventName);
      });

      subscriber.on('user.created', (_data: any, context: any) => {
        handler2Events.push(context.eventName);
      });

      await subscriber.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      await publisher.publish('user.created', {});

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(handler1Events).toHaveLength(1);
      expect(handler1Events[0]).toBe('user.created');

      expect(handler2Events).toHaveLength(1);
      expect(handler2Events[0]).toBe('user.created');
    });

    it('should preserve metadata in context', async () => {
      const exchange = 'metadata-test';

      publisher = new Publisher({
        connection: { url: getUrl() },
        exchange,
      });

      let receivedMetadata: any = null;

      subscriber = new Subscriber({
        connection: { url: getUrl() },
        exchange,
      });

      subscriber.on('test.event', (_data: any, context: any) => {
        receivedMetadata = context.metadata;
      });

      await subscriber.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      await publisher.publish(
        'test.event',
        {},
        {
          metadata: { userId: '123', traceId: 'abc-def' },
        }
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(receivedMetadata).toEqual({ userId: '123', traceId: 'abc-def' });
    });

    it('should handle publishToMany()', async () => {
      const exchange1 = 'multi-exchange-1';
      const exchange2 = 'multi-exchange-2';

      publisher = new Publisher({
        connection: { url: getUrl() },
      });

      const events1: any[] = [];
      const events2: any[] = [];

      const subscriber1 = new Subscriber({
        connection: { url: getUrl() },
        exchange: exchange1,
      });

      const subscriber2 = new Subscriber({
        connection: { url: getUrl() },
        exchange: exchange2,
      });

      subscriber1.on('test', (data: any) => {
        events1.push(data);
      });

      subscriber2.on('test', (data: any) => {
        events2.push(data);
      });

      await subscriber1.start();
      await subscriber2.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      await publisher.publishToMany([exchange1, exchange2], 'test', { value: 42 });

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(events1).toHaveLength(1);
      expect(events1[0]).toEqual({ value: 42 });

      expect(events2).toHaveLength(1);
      expect(events2[0]).toEqual({ value: 42 });

      await subscriber1.stop();
      await subscriber2.stop();
    });

    it('should handle high message throughput', async () => {
      const exchange = 'throughput-test';
      const messageCount = 100;

      publisher = new Publisher({
        connection: { url: getUrl() },
        exchange,
      });

      const receivedCount: number[] = [];

      subscriber = new Subscriber({
        connection: { url: getUrl() },
        exchange,
        prefetch: 50,
      });

      subscriber.on('test.throughput', (data: any) => {
        receivedCount.push(data.index);
      });

      await subscriber.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      for (let i = 0; i < messageCount; i++) {
        await publisher.publish('test.throughput', { index: i });
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      expect(receivedCount).toHaveLength(messageCount);
      expect(receivedCount.sort((a, b) => a - b)).toEqual(
        Array.from({ length: messageCount }, (_, i) => i)
      );
    });
  });

  describe('Multiple subscribers', () => {
    let publisher: Publisher;
    let subscriber1: Subscriber;
    let subscriber2: Subscriber;

    afterEach(async () => {
      if (subscriber1?.isRunning()) await subscriber1.stop();
      if (subscriber2?.isRunning()) await subscriber2.stop();
      if (publisher) await publisher.close();
    });

    it('should broadcast to multiple subscribers (fanout)', async () => {
      const exchange = 'fanout-test';

      publisher = new Publisher({
        connection: { url: getUrl() },
        exchange,
        exchangeType: 'fanout',
      });

      const events1: any[] = [];
      const events2: any[] = [];

      subscriber1 = new Subscriber({
        connection: { url: getUrl() },
        exchange,
        exchangeType: 'fanout',
      });

      subscriber2 = new Subscriber({
        connection: { url: getUrl() },
        exchange,
        exchangeType: 'fanout',
      });

      subscriber1.on('*', (data: any) => {
        events1.push(data);
      });

      subscriber2.on('*', (data: any) => {
        events2.push(data);
      });

      await subscriber1.start();
      await subscriber2.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      await publisher.publish('broadcast', { message: 'hello' });

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect(events1[0]).toEqual({ message: 'hello' });
      expect(events2[0]).toEqual({ message: 'hello' });
    });
  });
});
