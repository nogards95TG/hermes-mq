import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Publisher } from '../../src/client/pubsub/Publisher';
import { ValidationError, ConnectionManager } from '../../src/core';

// Mock ConnectionManager
vi.mock('../../src/core', async () => {
  const actual = await vi.importActual('../../src/core');

  const mockConnection = new EventEmitter();
  (mockConnection as any).createConfirmChannel = vi.fn().mockResolvedValue({
    assertExchange: vi.fn().mockResolvedValue({}),
    publish: vi.fn().mockReturnValue(true),
    waitForConfirms: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue({}),
    on: vi.fn(),
    once: vi.fn(),
  });

  return {
    ...actual,
    ConnectionManager: vi.fn(() => ({
      getConnection: vi.fn().mockResolvedValue(mockConnection),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe('Publisher', () => {
  let publisher: Publisher;
  let mockConnection: any;
  let mockConnectionManager: any;
  let mockChannel: any;

  beforeEach(async () => {
    const manager = new (ConnectionManager as any)();
    mockConnectionManager = manager;
    mockConnection = await manager.getConnection();
    mockChannel = await mockConnection.createConfirmChannel();
  });

  afterEach(async () => {
    if (publisher) {
      await publisher.close();
    }
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with valid config', () => {
      publisher = new Publisher({
        connection: mockConnectionManager,
        exchange: 'test-exchange',
      });

      expect(publisher).toBeDefined();
    });


    it('should use default exchange if not specified', () => {
      publisher = new Publisher({
        connection: mockConnectionManager,
      });

      expect(publisher).toBeDefined();
    });

    it('should accept multiple exchanges configuration', () => {
      publisher = new Publisher({
        connection: mockConnectionManager,
        exchanges: [
          { name: 'events', type: 'topic' },
          { name: 'logs', type: 'fanout' },
        ],
      });

      expect(publisher).toBeDefined();
    });
  });

  describe('publish()', () => {
    beforeEach(() => {
      publisher = new Publisher({
        connection: mockConnectionManager,
        exchange: 'test-exchange',
      });
    });

    it('should publish event successfully', async () => {
      await publisher.publish('user.created', { id: 1, name: 'John' });

      expect(mockChannel.assertExchange).toHaveBeenCalledWith(
        'test-exchange',
        'topic',
        expect.any(Object)
      );
      expect(mockChannel.publish).toHaveBeenCalledWith(
        'test-exchange',
        'user.created',
        expect.any(Buffer),
        expect.objectContaining({
          persistent: true,
          contentType: 'application/json',
        })
      );
      expect(mockChannel.waitForConfirms).toHaveBeenCalled();
    });

    it('should use custom routing key', async () => {
      await publisher.publish('user.created', { id: 1 }, { routingKey: 'custom.route' });

      expect(mockChannel.publish).toHaveBeenCalledWith(
        'test-exchange',
        'custom.route',
        expect.any(Buffer),
        expect.any(Object)
      );
    });

    it('should use custom exchange', async () => {
      await publisher.publish('log.info', { message: 'test' }, { exchange: 'logs' });

      expect(mockChannel.assertExchange).toHaveBeenCalledWith('logs', 'topic', expect.any(Object));
      expect(mockChannel.publish).toHaveBeenCalledWith(
        'logs',
        'log.info',
        expect.any(Buffer),
        expect.any(Object)
      );
    });

    it('should support non-persistent messages', async () => {
      await publisher.publish('temp.event', {}, { persistent: false });

      expect(mockChannel.publish).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Buffer),
        expect.objectContaining({
          persistent: false,
        })
      );
    });

    it('should include metadata in envelope', async () => {
      await publisher.publish('event', {}, { metadata: { userId: '123' } });

      const publishCall = mockChannel.publish.mock.calls[0];
      const payload = JSON.parse(publishCall[2].toString());

      expect(payload).toMatchObject({
        eventName: 'event',
        metadata: { userId: '123' },
      });
    });

    it('should throw ValidationError for invalid event name', async () => {
      await expect(publisher.publish('', {})).rejects.toThrow(ValidationError);
      await expect(publisher.publish(null as any, {})).rejects.toThrow(ValidationError);
    });

    it('should assert exchange only once', async () => {
      await publisher.publish('event1', {});
      await publisher.publish('event2', {});

      expect(mockChannel.assertExchange).toHaveBeenCalledTimes(1);
    });

    it('should handle publish backpressure', async () => {
      mockChannel.publish.mockReturnValueOnce(false);
      mockChannel.once.mockImplementation((event: string, callback: () => void) => {
        if (event === 'drain') {
          setTimeout(callback, 10);
        }
      });

      await publisher.publish('event', {});

      expect(mockChannel.once).toHaveBeenCalledWith('drain', expect.any(Function));
    });
  });

  describe('publishToMany()', () => {
    beforeEach(() => {
      publisher = new Publisher({
        connection: mockConnectionManager,
      });
    });

    it('should publish to multiple exchanges', async () => {
      await publisher.publishToMany(['exchange1', 'exchange2', 'exchange3'], 'event', {
        data: 'test',
      });

      expect(mockChannel.publish).toHaveBeenCalledTimes(3);
      expect(mockChannel.publish).toHaveBeenCalledWith(
        'exchange1',
        'event',
        expect.any(Buffer),
        expect.any(Object)
      );
      expect(mockChannel.publish).toHaveBeenCalledWith(
        'exchange2',
        'event',
        expect.any(Buffer),
        expect.any(Object)
      );
      expect(mockChannel.publish).toHaveBeenCalledWith(
        'exchange3',
        'event',
        expect.any(Buffer),
        expect.any(Object)
      );
    });

    it('should throw ValidationError for empty array', async () => {
      await expect(publisher.publishToMany([], 'event', {})).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for non-array', async () => {
      await expect(publisher.publishToMany(null as any, 'event', {})).rejects.toThrow(
        ValidationError
      );
    });

    it('should support custom routing key', async () => {
      await publisher.publishToMany(['ex1', 'ex2'], 'event', {}, { routingKey: 'custom' });

      expect(mockChannel.publish).toHaveBeenCalledWith(
        'ex1',
        'custom',
        expect.any(Buffer),
        expect.any(Object)
      );
      expect(mockChannel.publish).toHaveBeenCalledWith(
        'ex2',
        'custom',
        expect.any(Buffer),
        expect.any(Object)
      );
    });
  });

  describe('close()', () => {
    it('should close channel and connection', async () => {
      publisher = new Publisher({
        connection: mockConnectionManager,
      });

      await publisher.publish('event', {});
      await publisher.close();

      expect(mockChannel.close).toHaveBeenCalled();
    });

    it('should clear asserted exchanges on close', async () => {
      publisher = new Publisher({
        connection: mockConnectionManager,
      });

      await publisher.publish('event1', {});
      await publisher.close();

      // Recreate publisher and publish again
      publisher = new Publisher({
        connection: mockConnectionManager,
      });

      await publisher.publish('event2', {});

      // Should assert exchange again after close/recreate
      expect(mockChannel.assertExchange).toHaveBeenCalled();
    });
  });

  describe('pre-configured exchanges', () => {
    it('should assert all configured exchanges on first publish', async () => {
      publisher = new Publisher({
        connection: mockConnectionManager,
        exchanges: [
          { name: 'events', type: 'topic', options: { durable: true } },
          { name: 'logs', type: 'fanout', options: { durable: false } },
        ],
      });

      await publisher.publish('test', {});

      expect(mockChannel.assertExchange).toHaveBeenCalledWith('events', 'topic', { durable: true });
      expect(mockChannel.assertExchange).toHaveBeenCalledWith('logs', 'fanout', { durable: false });
    });
  });

  describe('metrics', () => {
    let mockMetrics: any;

    beforeEach(() => {
      mockMetrics = {
        incrementCounter: vi.fn(),
        observeHistogram: vi.fn(),
      };

      publisher = new Publisher({
        connection: mockConnectionManager,
        exchange: 'test-exchange',
        enableMetrics: true,
      });

      (publisher as any).config.metrics = mockMetrics;
    });

    it('should track successful publish', async () => {
      await publisher.publish('user.created', { id: 1 });

      expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
        'hermes_messages_published_total',
        {
          exchange: 'test-exchange',
          eventName: 'user.created',
          status: 'success',
        },
        1
      );
    });
  });

  describe('channel events', () => {
    let channelEventHandlers: Map<string, Function>;

    beforeEach(() => {
      channelEventHandlers = new Map();
      mockChannel.on = vi.fn((event: string, handler: Function) => {
        channelEventHandlers.set(event, handler);
        return mockChannel;
      });

      publisher = new Publisher({
        connection: mockConnectionManager,
        exchange: 'test-exchange',
      });
    });

    it('should handle channel close event', async () => {
      await publisher.publish('event', {});

      const closeHandler = channelEventHandlers.get('close');
      expect(closeHandler).toBeDefined();

      // Simulate channel close
      closeHandler!();

      // Channel should be undefined after close
      expect((publisher as any).channel).toBeUndefined();
    });

    it('should handle channel error event', async () => {
      await publisher.publish('event', {});

      const errorHandler = channelEventHandlers.get('error');
      expect(errorHandler).toBeDefined();

      // Simulate channel error
      const testError = new Error('Channel error');
      errorHandler!(testError);

      // Should log error but not throw
      expect(errorHandler).toBeDefined();
    });

    it('should handle returned messages', async () => {
      const onReturn = vi.fn();
      publisher = new Publisher({
        connection: mockConnectionManager,
        exchange: 'test-exchange',
        mandatory: true,
        onReturn,
      });

      await publisher.publish('event', {});

      const returnHandler = channelEventHandlers.get('return');
      expect(returnHandler).toBeDefined();

      // Simulate returned message
      const returnedMsg = {
        fields: {
          replyCode: 312,
          replyText: 'NO_ROUTE',
          exchange: 'test-exchange',
          routingKey: 'event',
        },
        content: Buffer.from('test'),
      };

      returnHandler!(returnedMsg);

      expect(onReturn).toHaveBeenCalledWith({
        replyCode: 312,
        replyText: 'NO_ROUTE',
        exchange: 'test-exchange',
        routingKey: 'event',
        message: returnedMsg.content,
      });
    });

    it('should handle drain event', async () => {
      const processBufferSpy = vi.spyOn(publisher as any, 'processWriteBuffer');

      await publisher.publish('event', {});

      const drainHandler = channelEventHandlers.get('drain');
      expect(drainHandler).toBeDefined();

      // Simulate drain event
      drainHandler!();

      expect(processBufferSpy).toHaveBeenCalled();
    });
  });

  describe('retry logic', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should retry failed publish with exponential backoff', async () => {
      publisher = new Publisher({
        connection: mockConnectionManager,
        exchange: 'test-exchange',
        retry: {
          enabled: true,
          maxAttempts: 3,
          initialDelay: 100,
        },
      });

      // First two attempts fail, third succeeds
      mockChannel.publish.mockReturnValueOnce(true);
      mockChannel.waitForConfirms
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(undefined);

      const publishPromise = publisher.publish('event', {});

      // Fast-forward through retries
      await vi.advanceTimersByTimeAsync(100); // First retry
      await vi.advanceTimersByTimeAsync(200); // Second retry

      await publishPromise;

      expect(mockChannel.waitForConfirms).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retry attempts', async () => {
      publisher = new Publisher({
        connection: mockConnectionManager,
        exchange: 'test-exchange',
        retry: {
          enabled: true,
          maxAttempts: 2,
          initialDelay: 100,
        },
      });

      mockChannel.publish.mockReturnValue(true);
      mockChannel.waitForConfirms.mockRejectedValue(new Error('Network error'));

      const publishPromise = publisher.publish('event', {}).catch((error) => error);

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(200);

      const error = await publishPromise;
      expect(error.message).toContain('Failed to publish after 2 attempts');
    });
  });

  describe('assert exchange errors', () => {
    it('should throw HermesError when exchange assertion fails', async () => {
      mockChannel.assertExchange.mockRejectedValueOnce(new Error('Exchange assertion failed'));

      await expect(publisher.publish('event', {})).rejects.toThrow('Failed to assert exchange');
    });
  });
});
