import { describe, it, expect, beforeEach } from 'vitest';
import { MockPublisher } from './MockPublisher';
import { ValidationError } from '@hermes/core';

describe('MockPublisher', () => {
  let mockPublisher: MockPublisher;

  beforeEach(() => {
    mockPublisher = new MockPublisher();
  });

  describe('publish', () => {
    it('should publish event and track it in history', async () => {
      await mockPublisher.publish('user.created', { userId: 123, name: 'John' });

      const events = mockPublisher.getPublishedEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe('user.created');
      expect(events[0].data).toEqual({ userId: 123, name: 'John' });
    });

    it('should use default exchange when not specified', async () => {
      await mockPublisher.publish('order.placed', { orderId: 456 });

      const events = mockPublisher.getPublishedEvents();
      expect(events[0].exchange).toBe('amq.topic');
    });

    it('should accept custom exchange in options', async () => {
      await mockPublisher.publish('payment.received', { amount: 100 }, {
        exchange: 'payments'
      });

      const events = mockPublisher.getPublishedEvents();
      expect(events[0].exchange).toBe('payments');
    });

    it('should validate event name is not empty', async () => {
      await expect(
        mockPublisher.publish('', { data: 'test' })
      ).rejects.toThrow(ValidationError);
    });

    it('should track metadata in options', async () => {
      await mockPublisher.publish('event.test', { id: 1 }, {
        metadata: { source: 'test', version: '1.0' }
      });

      const events = mockPublisher.getPublishedEvents();
      expect(events[0].options?.metadata).toEqual({ 
        source: 'test', 
        version: '1.0' 
      });
    });

    it('should track timestamp for each event', async () => {
      const before = Date.now();
      await mockPublisher.publish('test.event', { data: 'test' });
      const after = Date.now();

      const events = mockPublisher.getPublishedEvents();
      expect(events[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(events[0].timestamp).toBeLessThanOrEqual(after);
    });

    it('should handle publishing multiple events in order', async () => {
      await mockPublisher.publish('event.1', { id: 1 });
      await mockPublisher.publish('event.2', { id: 2 });
      await mockPublisher.publish('event.3', { id: 3 });

      const events = mockPublisher.getPublishedEvents();
      expect(events).toHaveLength(3);
      expect(events[0].eventName).toBe('event.1');
      expect(events[1].eventName).toBe('event.2');
      expect(events[2].eventName).toBe('event.3');
    });

    it('should accept persistent option', async () => {
      await mockPublisher.publish('durable.event', { id: 1 }, {
        persistent: true
      });

      const events = mockPublisher.getPublishedEvents();
      expect(events[0].options?.persistent).toBe(true);
    });
  });

  describe('publishToMany', () => {
    it('should publish same event to multiple exchanges', async () => {
      await mockPublisher.publishToMany(
        ['exchange1', 'exchange2', 'exchange3'],
        'multi.event',
        { data: 'shared' }
      );

      const events = mockPublisher.getPublishedEvents();
      expect(events).toHaveLength(3);
      expect(events[0].exchange).toBe('exchange1');
      expect(events[1].exchange).toBe('exchange2');
      expect(events[2].exchange).toBe('exchange3');
      expect(events.every(e => e.eventName === 'multi.event')).toBe(true);
      expect(events.every(e => e.data.data === 'shared')).toBe(true);
    });

    it('should validate exchanges array is not empty', async () => {
      await expect(
        mockPublisher.publishToMany([], 'event', {})
      ).rejects.toThrow(ValidationError);
    });

    it('should validate event name is not empty', async () => {
      await expect(
        mockPublisher.publishToMany(['exchange1'], '', {})
      ).rejects.toThrow(ValidationError);
    });

    it('should track metadata for multi-exchange events', async () => {
      await mockPublisher.publishToMany(
        ['ex1', 'ex2'],
        'test.event',
        { id: 1 },
        { metadata: { version: '2.0' } }
      );

      const events = mockPublisher.getPublishedEvents();
      expect(events).toHaveLength(2);
      expect(events[0].options?.metadata).toEqual({ version: '2.0' });
      expect(events[1].options?.metadata).toEqual({ version: '2.0' });
    });

    it('should handle single exchange in array', async () => {
      await mockPublisher.publishToMany(['single'], 'event', { test: true });

      const events = mockPublisher.getPublishedEvents();
      expect(events).toHaveLength(1);
      expect(events[0].exchange).toBe('single');
    });
  });

  describe('getPublishedEvents', () => {
    it('should return empty array when no events published', () => {
      expect(mockPublisher.getPublishedEvents()).toEqual([]);
    });

    it('should return all published events in order', async () => {
      await mockPublisher.publish('event.1', { n: 1 });
      await mockPublisher.publish('event.2', { n: 2 });
      await mockPublisher.publishToMany(['ex1', 'ex2'], 'event.3', { n: 3 });

      const events = mockPublisher.getPublishedEvents();
      expect(events).toHaveLength(4);
      expect(events[0].eventName).toBe('event.1');
      expect(events[1].eventName).toBe('event.2');
      expect(events[2].eventName).toBe('event.3');
      expect(events[3].eventName).toBe('event.3');
    });
  });

  describe('getEventsByName', () => {
    it('should return only events with matching name', async () => {
      await mockPublisher.publish('user.created', { id: 1 });
      await mockPublisher.publish('order.placed', { id: 2 });
      await mockPublisher.publish('user.created', { id: 3 });

      const userEvents = mockPublisher.getEventsByName('user.created');

      expect(userEvents).toHaveLength(2);
      expect(userEvents[0].data.id).toBe(1);
      expect(userEvents[1].data.id).toBe(3);
    });

    it('should return empty array for event name not published', () => {
      const events = mockPublisher.getEventsByName('never.published');
      expect(events).toEqual([]);
    });

    it('should be case-sensitive for event names', async () => {
      await mockPublisher.publish('Test.Event', { id: 1 });

      expect(mockPublisher.getEventsByName('test.event')).toHaveLength(0);
      expect(mockPublisher.getEventsByName('Test.Event')).toHaveLength(1);
    });
  });

  describe('getEventsByExchange', () => {
    it('should return only events for specified exchange', async () => {
      await mockPublisher.publish('event.1', { id: 1 }, { exchange: 'ex1' });
      await mockPublisher.publish('event.2', { id: 2 }, { exchange: 'ex2' });
      await mockPublisher.publish('event.3', { id: 3 }, { exchange: 'ex1' });

      const ex1Events = mockPublisher.getEventsByExchange('ex1');

      expect(ex1Events).toHaveLength(2);
      expect(ex1Events[0].data.id).toBe(1);
      expect(ex1Events[1].data.id).toBe(3);
    });

    it('should return events from default exchange', async () => {
      await mockPublisher.publish('event.1', { id: 1 });
      await mockPublisher.publish('event.2', { id: 2 }, { exchange: 'custom' });

      const defaultEvents = mockPublisher.getEventsByExchange('amq.topic');

      expect(defaultEvents).toHaveLength(1);
      expect(defaultEvents[0].data.id).toBe(1);
    });

    it('should return empty array for exchange with no events', () => {
      const events = mockPublisher.getEventsByExchange('unused.exchange');
      expect(events).toEqual([]);
    });
  });

  describe('getLastEvent', () => {
    it('should return the most recent event', async () => {
      await mockPublisher.publish('event.1', { id: 1 });
      await mockPublisher.publish('event.2', { id: 2 });
      await mockPublisher.publish('event.3', { id: 3 });

      const lastEvent = mockPublisher.getLastEvent();

      expect(lastEvent).toBeDefined();
      expect(lastEvent?.eventName).toBe('event.3');
      expect(lastEvent?.data.id).toBe(3);
    });

    it('should return undefined when no events published', () => {
      expect(mockPublisher.getLastEvent()).toBeUndefined();
    });

    it('should update as new events are published', async () => {
      await mockPublisher.publish('first', { n: 1 });
      expect(mockPublisher.getLastEvent()?.eventName).toBe('first');

      await mockPublisher.publish('second', { n: 2 });
      expect(mockPublisher.getLastEvent()?.eventName).toBe('second');
    });
  });

  describe('clear', () => {
    it('should clear all published events', async () => {
      await mockPublisher.publish('event.1', { id: 1 });
      await mockPublisher.publish('event.2', { id: 2 });

      expect(mockPublisher.getPublishedEvents()).toHaveLength(2);

      mockPublisher.clear();

      expect(mockPublisher.getPublishedEvents()).toEqual([]);
      expect(mockPublisher.getLastEvent()).toBeUndefined();
    });

    it('should allow publishing after clear', async () => {
      await mockPublisher.publish('before.clear', { id: 1 });
      mockPublisher.clear();

      await mockPublisher.publish('after.clear', { id: 2 });

      const events = mockPublisher.getPublishedEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe('after.clear');
    });
  });

  describe('close', () => {
    it('should resolve without error', async () => {
      await expect(mockPublisher.close()).resolves.toBeUndefined();
    });

    it('should allow calling close multiple times', async () => {
      await mockPublisher.close();
      await expect(mockPublisher.close()).resolves.toBeUndefined();
    });
  });

  describe('type safety', () => {
    it('should maintain type safety for event data', async () => {
      interface UserCreatedEvent {
        userId: number;
        email: string;
        timestamp: string;
      }

      const eventData: UserCreatedEvent = {
        userId: 123,
        email: 'user@example.com',
        timestamp: new Date().toISOString()
      };

      await mockPublisher.publish<UserCreatedEvent>('user.created', eventData);

      const events = mockPublisher.getEventsByName('user.created');
      expect(events[0].data.userId).toBe(123);
      expect(events[0].data.email).toBe('user@example.com');
    });
  });

  describe('integration scenarios', () => {
    it('should support testing event-driven flows', async () => {
      // Simulate a user registration flow
      await mockPublisher.publish('user.registered', {
        userId: 1,
        email: 'john@example.com'
      });

      await mockPublisher.publish('email.sent', {
        to: 'john@example.com',
        type: 'welcome'
      });

      await mockPublisher.publish('analytics.tracked', {
        event: 'registration',
        userId: 1
      });

      // Verify the sequence of events
      const events = mockPublisher.getPublishedEvents();
      expect(events).toHaveLength(3);
      expect(events[0].eventName).toBe('user.registered');
      expect(events[1].eventName).toBe('email.sent');
      expect(events[2].eventName).toBe('analytics.tracked');

      // Verify specific event types
      const emailEvents = mockPublisher.getEventsByName('email.sent');
      expect(emailEvents[0].data.type).toBe('welcome');
    });

    it('should support testing multi-exchange broadcasting', async () => {
      const orderData = { orderId: 999, total: 250 };

      await mockPublisher.publishToMany(
        ['orders', 'analytics', 'notifications'],
        'order.completed',
        orderData
      );

      // Verify each exchange received the event
      expect(mockPublisher.getEventsByExchange('orders')).toHaveLength(1);
      expect(mockPublisher.getEventsByExchange('analytics')).toHaveLength(1);
      expect(mockPublisher.getEventsByExchange('notifications')).toHaveLength(1);

      // Verify all have the same data
      const allEvents = mockPublisher.getPublishedEvents();
      expect(allEvents.every(e => e.data.orderId === 999)).toBe(true);
    });

    it('should support verifying event metadata', async () => {
      await mockPublisher.publish('critical.event', { error: 'Database down' }, {
        exchange: 'alerts',
        persistent: true,
        metadata: {
          severity: 'high',
          source: 'health-check',
          timestamp: Date.now()
        }
      });

      const alertEvents = mockPublisher.getEventsByExchange('alerts');
      expect(alertEvents[0].options?.persistent).toBe(true);
      expect(alertEvents[0].options?.metadata?.severity).toBe('high');
      expect(alertEvents[0].options?.metadata?.source).toBe('health-check');
    });

    it('should support testing idempotency', async () => {
      const eventData = { requestId: 'req-123', action: 'process' };

      // Publish same event multiple times
      await mockPublisher.publish('idempotent.action', eventData);
      await mockPublisher.publish('idempotent.action', eventData);
      await mockPublisher.publish('idempotent.action', eventData);

      const events = mockPublisher.getEventsByName('idempotent.action');
      expect(events).toHaveLength(3);

      // Verify all have same requestId (simulating idempotency key)
      expect(events.every(e => e.data.requestId === 'req-123')).toBe(true);
    });
  });
});
