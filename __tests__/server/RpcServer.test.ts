import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { RpcServer } from '../../src/server/rpc/RpcServer';
import { ConnectionManager, ValidationError } from '../../src/core';

// Mock ConnectionManager
vi.mock('../../src/core', async () => {
  const actual = await vi.importActual('../../src/core');

  const mockConnection = new EventEmitter();
  (mockConnection as any).createConfirmChannel = vi.fn().mockResolvedValue({
    assertQueue: vi.fn().mockResolvedValue({}),
    prefetch: vi.fn().mockResolvedValue({}),
    consume: vi.fn().mockImplementation((_queue, callback) => {
      (mockConnection as any)._consumeCallback = callback;
      return Promise.resolve({ consumerTag: 'test-consumer' });
    }),
    sendToQueue: vi.fn().mockImplementation((_queue, content, options) => {
      (mockConnection as any)._lastReply = { content, options };
      return true;
    }),
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
      }),
    },
  };
});

describe('RpcServer', () => {
  let server: RpcServer;
  let mockConnection: any;

  beforeEach(async () => {
    const manager = (ConnectionManager as any).getInstance();
    mockConnection = await manager.getConnection();
  });

  afterEach(async () => {
    if (server && server.isServerRunning()) {
      await server.stop();
    }
    vi.clearAllMocks();
  });

  describe('handler registration', () => {
    beforeEach(() => {
      server = new RpcServer({
        connection: {
          url: 'amqp://localhost',
        },
        queueName: 'test-queue',
      });
    });

    it('should register handler', () => {
      const handler = vi.fn();
      server.registerHandler('TEST_COMMAND', handler);

      expect(server.getHandlerCount()).toBe(1);
    });

    it('should normalize command to uppercase', () => {
      const handler = vi.fn();
      server.registerHandler('test_command', handler);

      expect(server.getHandlerCount()).toBe(1);
    });

    it('should throw ValidationError for empty command', () => {
      const handler = vi.fn();
      expect(() => server.registerHandler('', handler)).toThrow(ValidationError);
    });

    it('should throw ValidationError for non-function handler', () => {
      expect(() => server.registerHandler('TEST', 'not a function' as any)).toThrow(
        ValidationError
      );
    });

    it('should overwrite existing handler', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      server.registerHandler('TEST', handler1);
      server.registerHandler('TEST', handler2);

      expect(server.getHandlerCount()).toBe(1);
    });

    it('should unregister handler', () => {
      const handler = vi.fn();
      server.registerHandler('TEST', handler);

      expect(server.getHandlerCount()).toBe(1);

      server.unregisterHandler('TEST');

      expect(server.getHandlerCount()).toBe(0);
    });
  });

  describe('start()', () => {
    beforeEach(() => {
      server = new RpcServer({
        connection: {
          url: 'amqp://localhost',
        },
        queueName: 'test-queue',
      });
    });

    it('should start server', async () => {
      await server.start();

      expect(server.isServerRunning()).toBe(true);

      const channel = await mockConnection.createConfirmChannel();
      expect(channel.assertQueue).toHaveBeenCalledWith('test-queue', { durable: true });
      expect(channel.prefetch).toHaveBeenCalledWith(10);
      expect(channel.consume).toHaveBeenCalled();
    });

    it('should use custom prefetch', async () => {
      server = new RpcServer({
        connection: {
          url: 'amqp://localhost',
        },
        queueName: 'test-queue',
        prefetch: 5,
      });

      await server.start();

      const channel = await mockConnection.createConfirmChannel();
      expect(channel.prefetch).toHaveBeenCalledWith(5);
    });

    it('should not start twice', async () => {
      await server.start();
      await server.start();

      expect(mockConnection.createConfirmChannel).toHaveBeenCalledTimes(1);
    });
  });

  describe('message handling', () => {
    beforeEach(async () => {
      server = new RpcServer({
        connection: {
          url: 'amqp://localhost',
        },
        queueName: 'test-queue',
      });

      await server.start();
    });

    it('should handle request and send success response', async () => {
      const handler = vi.fn().mockResolvedValue({ result: 'success' });
      server.registerHandler('TEST_COMMAND', handler);

      const request = {
        id: 'test-id',
        command: 'TEST_COMMAND',
        timestamp: Date.now(),
        data: { input: 'test' },
      };

      const message = {
        content: Buffer.from(JSON.stringify(request)),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
        },
      };

      const channel = await mockConnection.createConfirmChannel();
      await mockConnection._consumeCallback(message);

      expect(handler).toHaveBeenCalledWith({ input: 'test' }, undefined);
      expect(channel.ack).toHaveBeenCalledWith(message);

      const reply = JSON.parse(mockConnection._lastReply.content.toString());
      expect(reply.success).toBe(true);
      expect(reply.data).toEqual({ result: 'success' });
    });

    it('should handle request with metadata', async () => {
      const handler = vi.fn().mockResolvedValue({ result: 'success' });
      server.registerHandler('TEST_COMMAND', handler);

      const request = {
        id: 'test-id',
        command: 'TEST_COMMAND',
        timestamp: Date.now(),
        data: { input: 'test' },
        metadata: { userId: '123' },
      };

      const message = {
        content: Buffer.from(JSON.stringify(request)),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
        },
      };

      const channel = await mockConnection.createConfirmChannel();
      await mockConnection._consumeCallback(message);

      expect(handler).toHaveBeenCalledWith({ input: 'test' }, { userId: '123' });
      expect(channel.ack).toHaveBeenCalledWith(message);
    });

    it('should send error response on handler failure', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Handler error'));
      server.registerHandler('TEST_COMMAND', handler);

      const request = {
        id: 'test-id',
        command: 'TEST_COMMAND',
        timestamp: Date.now(),
        data: { input: 'test' },
      };

      const message = {
        content: Buffer.from(JSON.stringify(request)),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
        },
      };

      const channel = await mockConnection.createConfirmChannel();
      await mockConnection._consumeCallback(message);

      // With new ACK strategy, errors on first attempt result in NACK with requeue=true
      expect(channel.nack).toHaveBeenCalledWith(message, false, true);

      const reply = JSON.parse(mockConnection._lastReply.content.toString());
      expect(reply.success).toBe(false);
      expect(reply.error.message).toBe('Handler error');
    });

    it('should send error response for unknown command', async () => {
      const request = {
        id: 'test-id',
        command: 'UNKNOWN_COMMAND',
        timestamp: Date.now(),
        data: { input: 'test' },
      };

      const message = {
        content: Buffer.from(JSON.stringify(request)),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
        },
      };

      const channel = await mockConnection.createConfirmChannel();
      await mockConnection._consumeCallback(message);

      // With new ACK strategy, errors on first attempt result in NACK with requeue=true
      expect(channel.nack).toHaveBeenCalledWith(message, false, true);

      const reply = JSON.parse(mockConnection._lastReply.content.toString());
      expect(reply.success).toBe(false);
      expect(reply.error.message).toContain('No handler registered');
    });

    it('should handle message without replyTo', async () => {
      const handler = vi.fn().mockResolvedValue({ result: 'success' });
      server.registerHandler('TEST_COMMAND', handler);

      const request = {
        id: 'test-id',
        command: 'TEST_COMMAND',
        timestamp: Date.now(),
        data: { input: 'test' },
      };

      const message = {
        content: Buffer.from(JSON.stringify(request)),
        properties: {
          correlationId: 'test-correlation-id',
        },
      };

      const channel = await mockConnection.createConfirmChannel();

      // Reset last reply
      mockConnection._lastReply = undefined;

      await mockConnection._consumeCallback(message);

      expect(handler).toHaveBeenCalled();
      expect(channel.ack).toHaveBeenCalledWith(message);
      expect(mockConnection._lastReply).toBeUndefined();
    });
  });

  describe('stop()', () => {
    beforeEach(async () => {
      server = new RpcServer({
        connection: {
          url: 'amqp://localhost',
        },
        queueName: 'test-queue',
      });

      await server.start();
    });

    it('should stop server', async () => {
      await server.stop();

      expect(server.isServerRunning()).toBe(false);

      const channel = await mockConnection.createConfirmChannel();
      expect(channel.cancel).toHaveBeenCalledWith('test-consumer');
      expect(channel.close).toHaveBeenCalled();
    });

    it('should wait for in-flight messages', async () => {
      const handler = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ result: 'success' }), 200))
        );
      server.registerHandler('TEST_COMMAND', handler);

      const request = {
        id: 'test-id',
        command: 'TEST_COMMAND',
        timestamp: Date.now(),
        data: { input: 'test' },
      };

      const message = {
        content: Buffer.from(JSON.stringify(request)),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
        },
      };

      // Start processing message
      mockConnection._consumeCallback(message);

      // Stop immediately (should wait)
      await server.stop();

      // Handler should have been called and completed
      expect(handler).toHaveBeenCalled();
    });

    it('should not stop twice', async () => {
      await server.stop();
      await server.stop();

      // Only called once (from first stop)
      const channel = await mockConnection.createConfirmChannel();
      expect(channel.cancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('configuration', () => {
    it('should have prefetch of 10 by default', async () => {
      server = new RpcServer({
        connection: {
          url: 'amqp://localhost',
        },
        queueName: 'test-queue',
      });

      await server.start();

      const channel = await mockConnection.createConfirmChannel();
      expect(channel.prefetch).toHaveBeenCalledWith(10);
    });

    it('should allow custom prefetch value', async () => {
      server = new RpcServer({
        connection: {
          url: 'amqp://localhost',
        },
        queueName: 'test-queue',
        prefetch: 20,
      });

      await server.start();

      const channel = await mockConnection.createConfirmChannel();
      expect(channel.prefetch).toHaveBeenCalledWith(20);
    });
  });

  describe('consumer cancellation', () => {
    beforeEach(() => {
      server = new RpcServer({
        connection: {
          url: 'amqp://localhost',
        },
        queueName: 'test-queue',
      });
    });

    it('should handle consumer cancellation gracefully', async () => {
      await server.start();
      expect(server.isServerRunning()).toBe(true);

      // Simulate consumer cancellation (msg = null)
      await mockConnection._consumeCallback(null);

      expect(server.isServerRunning()).toBe(false);
    });

    it('should attempt to reconnect after cancellation', async () => {
      vi.useFakeTimers();

      await server.start();

      // Simulate consumer cancellation
      await mockConnection._consumeCallback(null);

      expect(server.isServerRunning()).toBe(false);

      // Fast-forward time to trigger reconnection
      vi.advanceTimersByTime(5000);

      // Wait for async operations
      await vi.runAllTimersAsync();

      const channel = await mockConnection.createConfirmChannel();
      // Consume should be called again (initial + reconnect)
      expect(channel.consume).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe('slow message detection', () => {
    it('should trigger warn callback for slow messages', async () => {
      const onSlowMessage = vi.fn();
      server = new RpcServer({
        connection: {
          url: 'amqp://localhost',
        },
        queueName: 'test-queue',
        slowMessageDetection: {
          slowThresholds: {
            warn: 100,
          },
          onSlowMessage,
        },
      });

      await server.start();

      const handler = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ result: 'success' }), 150))
        );
      server.registerHandler('SLOW_COMMAND', handler);

      const request = {
        id: 'test-id',
        command: 'SLOW_COMMAND',
        timestamp: Date.now(),
        data: { input: 'test' },
      };

      const message = {
        content: Buffer.from(JSON.stringify(request)),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
        },
      };

      await mockConnection._consumeCallback(message);

      expect(onSlowMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'SLOW_COMMAND',
          level: 'warn',
          threshold: 100,
          duration: expect.any(Number),
        })
      );
    });

    it('should trigger error callback for very slow messages', async () => {
      const onSlowMessage = vi.fn();
      server = new RpcServer({
        connection: {
          url: 'amqp://localhost',
        },
        queueName: 'test-queue',
        slowMessageDetection: {
          slowThresholds: {
            warn: 100,
            error: 200,
          },
          onSlowMessage,
        },
      });

      await server.start();

      const handler = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ result: 'success' }), 250))
        );
      server.registerHandler('VERY_SLOW_COMMAND', handler);

      const request = {
        id: 'test-id',
        command: 'VERY_SLOW_COMMAND',
        timestamp: Date.now(),
        data: { input: 'test' },
      };

      const message = {
        content: Buffer.from(JSON.stringify(request)),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
        },
      };

      await mockConnection._consumeCallback(message);

      expect(onSlowMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'VERY_SLOW_COMMAND',
          level: 'error',
          threshold: 200,
          duration: expect.any(Number),
        })
      );
    });

    it('should not trigger callback for fast messages', async () => {
      const onSlowMessage = vi.fn();
      server = new RpcServer({
        connection: {
          url: 'amqp://localhost',
        },
        queueName: 'test-queue',
        slowMessageDetection: {
          slowThresholds: {
            warn: 100,
          },
          onSlowMessage,
        },
      });

      await server.start();

      const handler = vi.fn().mockResolvedValue({ result: 'success' });
      server.registerHandler('FAST_COMMAND', handler);

      const request = {
        id: 'test-id',
        command: 'FAST_COMMAND',
        timestamp: Date.now(),
        data: { input: 'test' },
      };

      const message = {
        content: Buffer.from(JSON.stringify(request)),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
        },
      };

      await mockConnection._consumeCallback(message);

      expect(onSlowMessage).not.toHaveBeenCalled();
    });

    it('should work without slow message detection config', async () => {
      server = new RpcServer({
        connection: {
          url: 'amqp://localhost',
        },
        queueName: 'test-queue',
      });

      await server.start();

      const handler = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ result: 'success' }), 150))
        );
      server.registerHandler('COMMAND', handler);

      const request = {
        id: 'test-id',
        command: 'COMMAND',
        timestamp: Date.now(),
        data: { input: 'test' },
      };

      const message = {
        content: Buffer.from(JSON.stringify(request)),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
        },
      };

      // Should not throw
      await expect(mockConnection._consumeCallback(message)).resolves.not.toThrow();
    });
  });
});
