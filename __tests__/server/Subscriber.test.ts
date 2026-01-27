import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Subscriber } from '../../src/server/pubsub/Subscriber';
import { ValidationError, ConnectionManager } from '../../src/core';

// Mock ConnectionManager
vi.mock('../../src/core', async () => {
  const actual = await vi.importActual('../../src/core');

  const mockConnection = new EventEmitter();
  (mockConnection as any).createChannel = vi.fn().mockResolvedValue({
    assertExchange: vi.fn().mockResolvedValue({}),
    assertQueue: vi.fn().mockResolvedValue({ queue: 'test-queue-123' }),
    bindQueue: vi.fn().mockResolvedValue({}),
    prefetch: vi.fn().mockResolvedValue({}),
    consume: vi.fn().mockResolvedValue({ consumerTag: 'test-consumer' }),
    ack: vi.fn(),
    nack: vi.fn(),
    cancel: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue({}),
    on: vi.fn(),
  });

  return {
    ...actual,
    ConnectionManager: vi.fn(() => ({
      getConnection: vi.fn().mockResolvedValue(mockConnection),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe('Subscriber', () => {
  let subscriber: Subscriber;
  let mockConnection: any;
  let mockConnectionManager: any;
  let mockChannel: any;

  beforeEach(async () => {
    const manager = new (ConnectionManager as any)();
    mockConnectionManager = manager;
    mockConnection = await manager.getConnection();
    mockChannel = await (mockConnection as any).createChannel();
  });

  afterEach(async () => {
    if (subscriber?.isRunning()) {
      await subscriber.stop();
    }
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with valid config', () => {
      subscriber = new Subscriber({
        connection: mockConnectionManager,
        exchange: 'test-exchange',
      });

      expect(subscriber).toBeDefined();
      expect(subscriber.isRunning()).toBe(false);
    });

    // Note: Connection validation is now handled by ConnectionManager constructor
    // Tests for invalid connection configs should be in ConnectionManager.test.ts

    it('should throw ValidationError without exchange', () => {
      expect(() => {
        new Subscriber({
          connection: mockConnectionManager,
          exchange: '',
        });
      }).toThrow(ValidationError);
    });

    it('should accept custom queue name', () => {
      subscriber = new Subscriber({
        connection: mockConnectionManager,
        exchange: 'test-exchange',
        queueName: 'custom-queue',
      });

      expect(subscriber).toBeDefined();
    });
  });

  describe('on()', () => {
    beforeEach(() => {
      subscriber = new Subscriber({
        connection: mockConnectionManager,
        exchange: 'events',
      });
    });

    it('should register event handler', () => {
      const handler = vi.fn();
      const result = subscriber.on('user.*', handler);

      expect(result).toBe(subscriber);
    });

    it('should throw ValidationError for invalid pattern', () => {
      expect(() => {
        subscriber.on('', vi.fn());
      }).toThrow(ValidationError);

      expect(() => {
        subscriber.on(null as any, vi.fn());
      }).toThrow(ValidationError);
    });

    it('should throw ValidationError for non-function handler', () => {
      expect(() => {
        subscriber.on('pattern', null as any);
      }).toThrow(ValidationError);
    });

    it('should allow multiple handlers for same pattern', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      subscriber.on('user.*', handler1);
      subscriber.on('user.*', handler2);

      expect(subscriber).toBeDefined();
    });

    it('should allow different patterns', () => {
      subscriber.on('user.*', vi.fn());
      subscriber.on('order.#', vi.fn());
      subscriber.on('log.info', vi.fn());

      expect(subscriber).toBeDefined();
    });
  });

  describe('start()', () => {
    beforeEach(() => {
      subscriber = new Subscriber({
        connection: mockConnectionManager,
        exchange: 'events',
      });
    });

    it('should start consuming successfully', async () => {
      subscriber.on('user.*', vi.fn());

      await subscriber.start();

      expect(mockChannel.assertExchange).toHaveBeenCalledWith(
        'events',
        'topic',
        expect.any(Object)
      );
      expect(mockChannel.assertQueue).toHaveBeenCalled();
      expect(mockChannel.bindQueue).toHaveBeenCalledWith('test-queue-123', 'events', 'user.*');
      expect(mockChannel.prefetch).toHaveBeenCalledWith(10);
      expect(mockChannel.consume).toHaveBeenCalled();
      expect(subscriber.isRunning()).toBe(true);
    });

    it('should throw ValidationError if no handlers registered', async () => {
      await expect(subscriber.start()).rejects.toThrow(ValidationError);
    });

    it('should bind multiple patterns', async () => {
      subscriber.on('user.*', vi.fn());
      subscriber.on('order.#', vi.fn());

      await subscriber.start();

      expect(mockChannel.bindQueue).toHaveBeenCalledWith('test-queue-123', 'events', 'user.*');
      expect(mockChannel.bindQueue).toHaveBeenCalledWith('test-queue-123', 'events', 'order.#');
    });

    it('should use custom prefetch', async () => {
      subscriber = new Subscriber({
        connection: mockConnectionManager,
        exchange: 'events',
        prefetch: 50,
      });

      subscriber.on('test', vi.fn());
      await subscriber.start();

      expect(mockChannel.prefetch).toHaveBeenCalledWith(50);
    });

    it('should not start twice', async () => {
      subscriber.on('test', vi.fn());
      await subscriber.start();
      await subscriber.start(); // Second call should be no-op

      expect(mockChannel.consume).toHaveBeenCalledTimes(1);
    });

    it('should use custom queue name if provided', async () => {
      subscriber = new Subscriber({
        connection: mockConnectionManager,
        exchange: 'events',
        queueName: 'my-queue',
      });

      subscriber.on('test', vi.fn());
      await subscriber.start();

      expect(mockChannel.assertQueue).toHaveBeenCalledWith('my-queue', expect.any(Object));
    });
  });

  describe('stop()', () => {
    beforeEach(() => {
      subscriber = new Subscriber({
        connection: mockConnectionManager,
        exchange: 'events',
      });
    });

    it('should stop consuming', async () => {
      subscriber.on('test', vi.fn());
      await subscriber.start();
      await subscriber.stop();

      expect(mockChannel.cancel).toHaveBeenCalledWith('test-consumer');
      expect(mockChannel.close).toHaveBeenCalled();
      expect(subscriber.isRunning()).toBe(false);
    });

    it('should be idempotent', async () => {
      await subscriber.stop();
      await subscriber.stop(); // Second call should be safe

      expect(mockChannel.cancel).not.toHaveBeenCalled();
    });
  });

  describe('pattern matching', () => {
    beforeEach(() => {
      subscriber = new Subscriber({
        connection: mockConnectionManager,
        exchange: 'events',
      });
    });

    it('should match exact pattern', async () => {
      const handler = vi.fn();
      let consumeCallback: any;

      mockChannel.consume.mockImplementation((_queue: any, callback: any) => {
        consumeCallback = callback;
        return Promise.resolve({ consumerTag: 'test' });
      });

      subscriber.on('user.created', handler);
      await subscriber.start();

      const message = {
        content: Buffer.from(
          JSON.stringify({
            eventName: 'user.created',
            data: { id: 1 },
            timestamp: Date.now(),
          })
        ),
        fields: { routingKey: 'user.created' },
        properties: { messageId: 'msg-1' },
      };

      await consumeCallback(message);

      expect(handler).toHaveBeenCalledWith(
        { id: 1 },
        expect.objectContaining({
          eventName: 'user.created',
        })
      );
      expect(mockChannel.ack).toHaveBeenCalledWith(message);
    });

    it('should match wildcard * (one word)', async () => {
      const handler = vi.fn();
      let consumeCallback: any;

      mockChannel.consume.mockImplementation((_queue: any, callback: any) => {
        consumeCallback = callback;
        return Promise.resolve({ consumerTag: 'test' });
      });

      subscriber.on('user.*', handler);
      await subscriber.start();

      // Should match
      const message1 = {
        content: Buffer.from(
          JSON.stringify({
            eventName: 'user.created',
            data: {},
            timestamp: Date.now(),
          })
        ),
        fields: { routingKey: 'user.created' },
        properties: { messageId: 'msg-1' },
      };
      await consumeCallback(message1);

      // Should match
      const message2 = {
        content: Buffer.from(
          JSON.stringify({
            eventName: 'user.updated',
            data: {},
            timestamp: Date.now(),
          })
        ),
        fields: { routingKey: 'user.updated' },
        properties: { messageId: 'msg-2' },
      };
      await consumeCallback(message2);

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should match wildcard # (zero or more words)', async () => {
      const handler = vi.fn();
      let consumeCallback: any;

      mockChannel.consume.mockImplementation((_queue: any, callback: any) => {
        consumeCallback = callback;
        return Promise.resolve({ consumerTag: 'test' });
      });

      subscriber.on('order.#', handler);
      await subscriber.start();

      // Should match - one word
      const message1 = {
        content: Buffer.from(
          JSON.stringify({
            eventName: 'order.created',
            data: {},
            timestamp: Date.now(),
          })
        ),
        fields: { routingKey: 'order.created' },
        properties: { messageId: 'msg-1' },
      };
      await consumeCallback(message1);

      // Should match - multiple words
      const message2 = {
        content: Buffer.from(
          JSON.stringify({
            eventName: 'order.shipped.express',
            data: {},
            timestamp: Date.now(),
          })
        ),
        fields: { routingKey: 'order.shipped.express' },
        properties: { messageId: 'msg-2' },
      };
      await consumeCallback(message2);

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should NOT match if pattern does not match', async () => {
      const handler = vi.fn();
      let consumeCallback: any;

      mockChannel.consume.mockImplementation((_queue: any, callback: any) => {
        consumeCallback = callback;
        return Promise.resolve({ consumerTag: 'test' });
      });

      subscriber.on('user.*', handler);
      await subscriber.start();

      // Should NOT match - wrong prefix
      const message = {
        content: Buffer.from(
          JSON.stringify({
            eventName: 'order.created',
            data: {},
            timestamp: Date.now(),
          })
        ),
        fields: { routingKey: 'order.created' },
        properties: { messageId: 'msg-1' },
      };
      await consumeCallback(message);

      expect(handler).not.toHaveBeenCalled();
      expect(mockChannel.ack).toHaveBeenCalledWith(message); // Still ack
    });

    it('should call multiple handlers for matching patterns', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      let consumeCallback: any;

      mockChannel.consume.mockImplementation((_queue: any, callback: any) => {
        consumeCallback = callback;
        return Promise.resolve({ consumerTag: 'test' });
      });

      subscriber.on('user.*', handler1);
      subscriber.on('user.created', handler2);
      await subscriber.start();

      const message = {
        content: Buffer.from(
          JSON.stringify({
            eventName: 'user.created',
            data: {},
            timestamp: Date.now(),
          })
        ),
        fields: { routingKey: 'user.created' },
        properties: { messageId: 'msg-1' },
      };

      await consumeCallback(message);

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      subscriber = new Subscriber({
        connection: mockConnectionManager,
        exchange: 'events',
      });
    });

    it('should nack message on handler error', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Handler failed'));
      let consumeCallback: any;

      mockChannel.consume.mockImplementation((_queue: any, callback: any) => {
        consumeCallback = callback;
        return Promise.resolve({ consumerTag: 'test' });
      });

      subscriber.on('user.created', handler);
      await subscriber.start();

      const message = {
        content: Buffer.from(
          JSON.stringify({
            eventName: 'user.created',
            data: {},
            timestamp: Date.now(),
          })
        ),
        fields: { routingKey: 'user.created' },
        properties: { messageId: 'msg-1' },
      };

      await consumeCallback(message);

      expect(mockChannel.nack).toHaveBeenCalledWith(message, false, false);
    });
  });

  describe('consumer cancellation', () => {
    beforeEach(() => {
      subscriber = new Subscriber({
        connection: mockConnectionManager,
        exchange: 'test-exchange',
      });

      // Register at least one handler
      subscriber.on('test.event', vi.fn());
    });

    it('should handle consumer cancellation gracefully', async () => {
      await subscriber.start();
      expect(subscriber.isRunning()).toBe(true);

      // Get the consume callback
      const consumeCall = mockChannel.consume.mock.calls[0];
      const consumeCallback = consumeCall[1];

      // Simulate consumer cancellation (msg = null)
      await consumeCallback(null);

      expect(subscriber.isRunning()).toBe(false);
    });

    it('should attempt to reconnect after cancellation', async () => {
      vi.useFakeTimers();

      await subscriber.start();

      const consumeCall = mockChannel.consume.mock.calls[0];
      const consumeCallback = consumeCall[1];

      // Simulate consumer cancellation
      await consumeCallback(null);

      expect(subscriber.isRunning()).toBe(false);

      // Fast-forward time to trigger reconnection
      vi.advanceTimersByTime(5000);

      // Wait for async operations
      await vi.runAllTimersAsync();

      // Consume should be called again (initial + reconnect)
      expect(mockChannel.consume).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe('slow message detection', () => {
    it('should trigger warn callback for slow handlers', async () => {
      const onSlowMessage = vi.fn();
      let consumeCallback: any;

      subscriber = new Subscriber({
        connection: mockConnectionManager,
        exchange: 'events',
        slowMessageDetection: {
          slowThresholds: {
            warn: 100,
          },
          onSlowMessage,
        },
      });

      mockChannel.consume.mockImplementation((_queue: any, callback: any) => {
        consumeCallback = callback;
        return Promise.resolve({ consumerTag: 'test' });
      });

      const handler = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(undefined), 150))
        );
      subscriber.on('user.created', handler);
      await subscriber.start();

      const message = {
        content: Buffer.from(
          JSON.stringify({
            eventName: 'user.created',
            data: {},
            timestamp: Date.now(),
          })
        ),
        fields: { routingKey: 'user.created' },
        properties: { messageId: 'msg-123' },
      };

      await consumeCallback(message);

      expect(onSlowMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'user.created',
          level: 'warn',
          threshold: 100,
          duration: expect.any(Number),
        })
      );
    });

    it('should trigger error callback for very slow handlers', async () => {
      const onSlowMessage = vi.fn();
      let consumeCallback: any;

      subscriber = new Subscriber({
        connection: mockConnectionManager,
        exchange: 'events',
        slowMessageDetection: {
          slowThresholds: {
            warn: 100,
            error: 200,
          },
          onSlowMessage,
        },
      });

      mockChannel.consume.mockImplementation((_queue: any, callback: any) => {
        consumeCallback = callback;
        return Promise.resolve({ consumerTag: 'test' });
      });

      const handler = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(undefined), 250))
        );
      subscriber.on('order.placed', handler);
      await subscriber.start();

      const message = {
        content: Buffer.from(
          JSON.stringify({
            eventName: 'order.placed',
            data: {},
            timestamp: Date.now(),
          })
        ),
        fields: { routingKey: 'order.placed' },
        properties: { messageId: 'msg-456' },
      };

      await consumeCallback(message);

      expect(onSlowMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'order.placed',
          level: 'error',
          threshold: 200,
          duration: expect.any(Number),
        })
      );
    });

    it('should not trigger callback for fast handlers', async () => {
      const onSlowMessage = vi.fn();
      let consumeCallback: any;

      subscriber = new Subscriber({
        connection: mockConnectionManager,
        exchange: 'events',
        slowMessageDetection: {
          slowThresholds: {
            warn: 100,
          },
          onSlowMessage,
        },
      });

      mockChannel.consume.mockImplementation((_queue: any, callback: any) => {
        consumeCallback = callback;
        return Promise.resolve({ consumerTag: 'test' });
      });

      const handler = vi.fn().mockResolvedValue(undefined);
      subscriber.on('product.updated', handler);
      await subscriber.start();

      const message = {
        content: Buffer.from(
          JSON.stringify({
            eventName: 'product.updated',
            data: {},
            timestamp: Date.now(),
          })
        ),
        fields: { routingKey: 'product.updated' },
        properties: { messageId: 'msg-789' },
      };

      await consumeCallback(message);

      expect(onSlowMessage).not.toHaveBeenCalled();
    });

    it('should detect slow messages even when handler fails', async () => {
      const onSlowMessage = vi.fn();
      let consumeCallback: any;

      subscriber = new Subscriber({
        connection: mockConnectionManager,
        exchange: 'events',
        slowMessageDetection: {
          slowThresholds: {
            warn: 100,
          },
          onSlowMessage,
        },
      });

      mockChannel.consume.mockImplementation((_queue: any, callback: any) => {
        consumeCallback = callback;
        return Promise.resolve({ consumerTag: 'test' });
      });

      const handler = vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Handler failed')), 150)
          )
      );
      subscriber.on('payment.failed', handler);
      await subscriber.start();

      const message = {
        content: Buffer.from(
          JSON.stringify({
            eventName: 'payment.failed',
            data: {},
            timestamp: Date.now(),
          })
        ),
        fields: { routingKey: 'payment.failed' },
        properties: { messageId: 'msg-error' },
      };

      await consumeCallback(message);

      expect(onSlowMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'payment.failed',
          level: 'warn',
          threshold: 100,
          duration: expect.any(Number),
        })
      );
    });
  });
});
