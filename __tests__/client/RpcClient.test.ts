import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { RpcClient } from '../../src/client/rpc/RpcClient';
import { TimeoutError, ValidationError, ConnectionManager } from '../../src/core';

// Mock amqplib
vi.mock('amqplib', () => {
  const mockChannel = {
    assertQueue: vi.fn().mockResolvedValue({}),
    consume: vi.fn().mockResolvedValue({ consumerTag: 'test-consumer' }),
    sendToQueue: vi.fn(),
    cancel: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue({}),
    on: vi.fn(),
  };

  const mockConnection = {
    createConfirmChannel: vi.fn().mockResolvedValue(mockChannel),
  };

  return {
    connect: vi.fn().mockResolvedValue(mockConnection),
  };
});

// Mock ConnectionManager
vi.mock('../../src/core', async () => {
  const actual = await vi.importActual('../../src/core');

  const mockConnection = new EventEmitter();
  (mockConnection as any).createConfirmChannel = vi.fn().mockResolvedValue({
    assertQueue: vi.fn().mockResolvedValue({}),
    consume: vi.fn().mockImplementation((_queue, callback, _options) => {
      (mockConnection as any)._consumeCallback = callback;
      return Promise.resolve({ consumerTag: 'test-consumer' });
    }),
    sendToQueue: vi.fn().mockImplementation((queue, content, options) => {
      (mockConnection as any)._lastMessage = { queue, content, options };
      return true;
    }),
    cancel: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue({}),
    on: vi.fn(),
  });

  return {
    ...actual,
    ConnectionManager: vi.fn(() => ({
      getConnection: vi.fn().mockResolvedValue(mockConnection),
    })),
  };
});

describe('RpcClient', () => {
  let client: RpcClient;
  let mockConnection: any;
  let mockConnectionManager: any;

  beforeEach(async () => {
    const manager = new (ConnectionManager as any)();
    mockConnectionManager = manager;
    mockConnection = await manager.getConnection();
  });

  afterEach(async () => {
    if (client) {
      await client.close();
    }
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with valid config', async () => {
      client = new RpcClient({
        connection: mockConnectionManager,
        queueName: 'test-queue',
      });

      expect(client).toBeDefined();
      expect(client.isClientReady()).toBe(false);
    });

    it('should use custom timeout', async () => {
      client = new RpcClient({
        connection: mockConnectionManager,
        queueName: 'test-queue',
        timeout: 5000,
      });

      expect(client).toBeDefined();
    });
  });

  describe('send()', () => {
    beforeEach(() => {
      client = new RpcClient({
        connection: mockConnectionManager,
        queueName: 'test-queue',
      });
    });

    it('should throw ValidationError for empty command', async () => {
      await expect(client.send('', { data: 'test' })).rejects.toThrow(ValidationError);
    });

    it('should send request with correlation ID', async () => {
      const sendPromise = client.send('TEST_COMMAND', { data: 'test' });

      // Don't await yet, check that message was sent
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockConnection._lastMessage).toBeDefined();
      expect(mockConnection._lastMessage.options.correlationId).toBeDefined();
      expect(mockConnection._lastMessage.options.replyTo).toBe('amq.rabbitmq.reply-to');

      // Simulate response
      const correlationId = mockConnection._lastMessage.options.correlationId;
      const response = {
        id: correlationId,
        timestamp: Date.now(),
        success: true,
        data: { result: 'success' },
      };

      mockConnection._consumeCallback({
        content: Buffer.from(JSON.stringify(response)),
        properties: { correlationId },
      });

      const result = await sendPromise;
      expect(result).toEqual({ result: 'success' });
    });

    it('should normalize command to uppercase', async () => {
      const sendPromise = client.send('test_command', { data: 'test' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const content = JSON.parse(mockConnection._lastMessage.content.toString());
      expect(content.command).toBe('TEST_COMMAND');

      // Simulate response to prevent timeout
      const correlationId = mockConnection._lastMessage.options.correlationId;
      mockConnection._consumeCallback({
        content: Buffer.from(
          JSON.stringify({
            id: correlationId,
            timestamp: Date.now(),
            success: true,
            data: {},
          })
        ),
        properties: { correlationId },
      });

      await sendPromise;
    });

    it('should timeout if no response received', async () => {
      await expect(client.send('TEST_COMMAND', { data: 'test' }, { timeout: 100 })).rejects.toThrow(
        TimeoutError
      );
    });

    it('should handle error response', async () => {
      const sendPromise = client.send('TEST_COMMAND', { data: 'test' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const correlationId = mockConnection._lastMessage.options.correlationId;
      const response = {
        id: correlationId,
        timestamp: Date.now(),
        success: false,
        error: {
          code: 'TEST_ERROR',
          message: 'Test error message',
          details: { info: 'details' },
        },
      };

      mockConnection._consumeCallback({
        content: Buffer.from(JSON.stringify(response)),
        properties: { correlationId },
      });

      await expect(sendPromise).rejects.toThrow('Test error message');
    });

    it('should support AbortSignal', async () => {
      const abortController = new AbortController();

      const sendPromise = client.send(
        'TEST_COMMAND',
        { data: 'test' },
        {
          signal: abortController.signal,
        }
      );

      // Abort after 50ms
      setTimeout(() => abortController.abort(), 50);

      await expect(sendPromise).rejects.toThrow('Request aborted');
    });

    it('should include metadata in request', async () => {
      const metadata = { userId: '123', traceId: 'abc' };
      const sendPromise = client.send('TEST_COMMAND', { data: 'test' }, { metadata });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const content = JSON.parse(mockConnection._lastMessage.content.toString());
      expect(content.metadata).toEqual(metadata);

      // Simulate response
      const correlationId = mockConnection._lastMessage.options.correlationId;
      mockConnection._consumeCallback({
        content: Buffer.from(
          JSON.stringify({
            id: correlationId,
            timestamp: Date.now(),
            success: true,
            data: {},
          })
        ),
        properties: { correlationId },
      });

      await sendPromise;
    });
  });

  describe('close()', () => {
    beforeEach(() => {
      client = new RpcClient({
        connection: mockConnectionManager,
        queueName: 'test-queue',
      });
    });

    it('should reject pending requests on close', async () => {
      const sendPromise = client.send('TEST_COMMAND', { data: 'test' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await client.close();

      await expect(sendPromise).rejects.toThrow('Client is closing');
    });

    it('should cancel consumer on close', async () => {
      // Initialize client with short timeout
      const sendPromise = client
        .send('TEST_COMMAND', { data: 'test' }, { timeout: 100 })
        .catch(() => {});

      await sendPromise;

      const channel = await mockConnection.createConfirmChannel();

      await client.close();

      expect(channel.cancel).toHaveBeenCalledWith('test-consumer');
    });

    it('should handle consumer cancel errors', async () => {
      await client.send('TEST', {}, { timeout: 100 }).catch(() => {});

      const channel = await mockConnection.createConfirmChannel();
      channel.cancel = vi.fn().mockRejectedValueOnce(new Error('Cancel failed'));

      // Should not throw
      await expect(client.close()).resolves.not.toThrow();
    });

    it('should handle channel close errors', async () => {
      await client.send('TEST', {}, { timeout: 100 }).catch(() => {});

      const channel = await mockConnection.createConfirmChannel();
      channel.close = vi.fn().mockRejectedValueOnce(new Error('Close failed'));

      // Should not throw
      await expect(client.close()).resolves.not.toThrow();
    });
  });

  describe('channel events', () => {
    let channelEventHandlers: Map<string, Function>;

    beforeEach(() => {
      channelEventHandlers = new Map();
      const originalCreateChannel = mockConnection.createConfirmChannel;
      mockConnection.createConfirmChannel = vi.fn().mockImplementation(async () => {
        const channel = await originalCreateChannel();
        channel.on = vi.fn((event: string, handler: Function) => {
          channelEventHandlers.set(event, handler);
          return channel;
        });
        return channel;
      });

      client = new RpcClient({
        connection: mockConnectionManager,
        queueName: 'test-queue',
      });
    });

    it('should handle channel error event', async () => {
      await client.send('TEST', {}, { timeout: 100 }).catch(() => {});

      const errorHandler = channelEventHandlers.get('error');
      expect(errorHandler).toBeDefined();

      // Simulate channel error
      errorHandler!(new Error('Channel error'));

      expect(client.isClientReady()).toBe(false);
    });

    it('should handle channel close event', async () => {
      await client.send('TEST', {}, { timeout: 100 }).catch(() => {});

      const closeHandler = channelEventHandlers.get('close');
      expect(closeHandler).toBeDefined();

      // Simulate channel close
      closeHandler!();

      expect(client.isClientReady()).toBe(false);
    });
  });

  describe('initialization errors', () => {
    it('should throw error when initialization fails', async () => {
      mockConnection.createConfirmChannel = vi
        .fn()
        .mockRejectedValueOnce(new Error('Init failed'));

      client = new RpcClient({
        connection: mockConnectionManager,
        queueName: 'test-queue',
      });

      await expect(client.send('TEST', {})).rejects.toThrow();
    });
  });

  describe('reply handling edge cases', () => {
    beforeEach(() => {
      client = new RpcClient({
        connection: mockConnectionManager,
        queueName: 'test-queue',
      });
    });

    it('should ignore reply without correlationId', async () => {
      await client.send('TEST', {}, { timeout: 100 }).catch(() => {});

      // Simulate reply without correlationId
      mockConnection._consumeCallback({
        content: Buffer.from('{}'),
        properties: {},
      });

      // Should not crash or throw
      expect(true).toBe(true);
    });

    it('should ignore reply for unknown correlationId', async () => {
      await client.send('TEST', {}, { timeout: 100 }).catch(() => {});

      // Simulate reply with unknown correlationId
      mockConnection._consumeCallback({
        content: Buffer.from('{}'),
        properties: { correlationId: 'unknown-id' },
      });

      // Should not crash or throw
      expect(true).toBe(true);
    });
  });

  describe('cleanup of expired requests', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should cleanup expired pending requests', async () => {
      client = new RpcClient({
        connection: mockConnectionManager,
        queueName: 'test-queue',
        timeout: 1000,
      });

      // Start a request that will timeout and catch the error
      const sendPromise = client.send('TEST', {}).catch(() => {});

      // Advance time to trigger timeout
      await vi.advanceTimersByTimeAsync(1100);

      await sendPromise;

      // Advance time to trigger cleanup interval (30 seconds)
      await vi.advanceTimersByTimeAsync(30000);

      // Pending requests should be cleaned up
      expect((client as any).pendingRequests.size).toBe(0);
    });

    it('should run cleanup interval every 30 seconds', async () => {
      client = new RpcClient({
        connection: mockConnectionManager,
        queueName: 'test-queue',
      });

      const cleanupSpy = vi.spyOn(client as any, 'cleanupExpiredRequests');

      // Trigger initialization
      await client.send('TEST', {}, { timeout: 100 }).catch(() => {});

      // Advance time by 30 seconds
      await vi.advanceTimersByTimeAsync(30000);

      expect(cleanupSpy).toHaveBeenCalled();
    });
  });
});
