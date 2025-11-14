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
    ConnectionManager: {
      getInstance: vi.fn().mockReturnValue({
        getConnection: vi.fn().mockResolvedValue(mockConnection),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    },
  };
});

describe('Subscriber', () => {
  let subscriber: Subscriber;
  let mockConnection: any;
  let mockChannel: any;

  beforeEach(async () => {
    const manager = (ConnectionManager as any).getInstance();
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
        connection: {
          url: 'amqp://localhost',
        },
        exchange: 'test-exchange',
      });

      expect(subscriber).toBeDefined();
      expect(subscriber.isRunning()).toBe(false);
    });

    it('should throw ValidationError without connection URL', () => {
      expect(() => {
        new Subscriber({
          connection: { url: '' },
          exchange: 'test',
        });
      }).toThrow(ValidationError);
    });

    it('should throw ValidationError without exchange', () => {
      expect(() => {
        new Subscriber({
          connection: { url: 'amqp://localhost' },
          exchange: '',
        });
      }).toThrow(ValidationError);
    });

    it('should accept custom queue name', () => {
      subscriber = new Subscriber({
        connection: {
          url: 'amqp://localhost',
        },
        exchange: 'test-exchange',
        queueName: 'custom-queue',
      });

      expect(subscriber).toBeDefined();
    });
  });

  describe('on()', () => {
    beforeEach(() => {
      subscriber = new Subscriber({
        connection: {
          url: 'amqp://localhost',
        },
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
        connection: {
          url: 'amqp://localhost',
        },
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
        connection: {
          url: 'amqp://localhost',
        },
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
        connection: {
          url: 'amqp://localhost',
        },
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
        connection: {
          url: 'amqp://localhost',
        },
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
        connection: {
          url: 'amqp://localhost',
        },
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
      };

      await consumeCallback(message);

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      subscriber = new Subscriber({
        connection: {
          url: 'amqp://localhost',
        },
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
      };

      await consumeCallback(message);

      expect(mockChannel.nack).toHaveBeenCalledWith(message, false, false);
    });
  });
});
