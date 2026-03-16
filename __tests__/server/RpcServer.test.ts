import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { RpcServer } from '../../src/server/rpc/RpcServer';
import { ConnectionManager } from '../../src/core';

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
    ConnectionManager: vi.fn(() => ({
      getConnection: vi.fn().mockResolvedValue(mockConnection),
    })),
  };
});

describe('RpcServer', () => {
  let server: RpcServer;
  let mockConnection: any;
  let mockConnectionManager: any;

  beforeEach(async () => {
    mockConnectionManager = new (ConnectionManager as any)();
    mockConnection = await mockConnectionManager.getConnection();
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
        connection: mockConnectionManager,
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
      expect(() => server.registerHandler('', handler)).toThrow('Command is required');
    });

    it('should throw ValidationError for non-function handler', () => {
      expect(() => server.registerHandler('TEST', 'not a function' as any)).toThrow(
        'Handler must be a function'
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
        connection: mockConnectionManager,
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
        connection: mockConnectionManager,
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
        connection: mockConnectionManager,
        queueName: 'test-queue',
      });

      await server.start();
    });

    it('should handle request and send success response', async () => {
      const handler = vi.fn().mockResolvedValue({ result: 'success' });
      server.registerHandler('TEST_COMMAND', handler);

      const message = {
        content: Buffer.from(JSON.stringify({ input: 'test' })),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
          type: 'TEST_COMMAND',
          timestamp: Date.now(),
        },
      };

      const channel = await mockConnection.createConfirmChannel();
      await mockConnection._consumeCallback(message);

      expect(handler).toHaveBeenCalledWith({ input: 'test' }, undefined);
      expect(channel.ack).toHaveBeenCalledWith(message);

      const reply = JSON.parse(mockConnection._lastReply.content.toString());
      expect(reply).toEqual({ result: 'success' });
    });

    it('should handle request with metadata', async () => {
      const handler = vi.fn().mockResolvedValue({ result: 'success' });
      server.registerHandler('TEST_COMMAND', handler);

      const message = {
        content: Buffer.from(JSON.stringify({ input: 'test' })),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
          type: 'TEST_COMMAND',
          timestamp: Date.now(),
          headers: { userId: '123' },
        },
      };

      const channel = await mockConnection.createConfirmChannel();
      await mockConnection._consumeCallback(message);

      expect(handler).toHaveBeenCalledWith({ input: 'test' }, { userId: '123' });
      expect(channel.ack).toHaveBeenCalledWith(message);
    });

    it('should requeue on handler failure without sending error response (first attempt)', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Handler error'));
      server.registerHandler('TEST_COMMAND', handler);

      const message = {
        content: Buffer.from(JSON.stringify({ input: 'test' })),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
          type: 'TEST_COMMAND',
          timestamp: Date.now(),
        },
      };

      const channel = await mockConnection.createConfirmChannel();
      await mockConnection._consumeCallback(message);

      // First attempt: NACK with requeue, no error response sent to client
      expect(channel.nack).toHaveBeenCalledWith(message, false, true);
      expect(channel.sendToQueue).not.toHaveBeenCalled();
    });

    it('should send error response on final failure (retries exhausted)', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Handler error'));
      server.registerHandler('TEST_COMMAND', handler);

      const message = {
        content: Buffer.from(JSON.stringify({ input: 'test' })),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
          type: 'TEST_COMMAND',
          timestamp: Date.now(),
          headers: { 'x-retry-count': 3 }, // maxRetries reached
        },
      };

      const channel = await mockConnection.createConfirmChannel();
      await mockConnection._consumeCallback(message);

      // Final failure: error response sent and NACK without requeue (DLQ)
      expect(channel.nack).toHaveBeenCalledWith(message, false, false);

      const reply = JSON.parse(mockConnection._lastReply.content.toString());
      expect(reply.error).toBeDefined();
      expect(reply.error.message).toBe('Handler error');
    });

    it('should requeue on unknown command without sending error response (first attempt)', async () => {
      const message = {
        content: Buffer.from(JSON.stringify({ input: 'test' })),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
          type: 'UNKNOWN_COMMAND',
          timestamp: Date.now(),
        },
      };

      const channel = await mockConnection.createConfirmChannel();
      await mockConnection._consumeCallback(message);

      // First attempt: NACK with requeue, no error response sent
      expect(channel.nack).toHaveBeenCalledWith(message, false, true);
      expect(channel.sendToQueue).not.toHaveBeenCalled();
    });

    it('should send error response for unknown command on final failure', async () => {
      const message = {
        content: Buffer.from(JSON.stringify({ input: 'test' })),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
          type: 'UNKNOWN_COMMAND',
          timestamp: Date.now(),
          headers: { 'x-retry-count': 3 },
        },
      };

      const channel = await mockConnection.createConfirmChannel();
      await mockConnection._consumeCallback(message);

      // Final failure: error response sent and NACK without requeue
      expect(channel.nack).toHaveBeenCalledWith(message, false, false);

      const reply = JSON.parse(mockConnection._lastReply.content.toString());
      expect(reply.error).toBeDefined();
      expect(reply.error.message).toContain('No handler registered');
    });

    it('should handle message without replyTo', async () => {
      const handler = vi.fn().mockResolvedValue({ result: 'success' });
      server.registerHandler('TEST_COMMAND', handler);

      // New format: raw payload, command in 'type'
      const message = {
        content: Buffer.from(JSON.stringify({ input: 'test' })),
        properties: {
          correlationId: 'test-correlation-id',
          type: 'TEST_COMMAND',
          timestamp: Date.now(),
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
        connection: mockConnectionManager,
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

      const message = {
        content: Buffer.from(JSON.stringify({ input: 'test' })),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
          type: 'TEST_COMMAND',
          timestamp: Date.now(),
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
        connection: mockConnectionManager,
        queueName: 'test-queue',
      });

      await server.start();

      const channel = await mockConnection.createConfirmChannel();
      expect(channel.prefetch).toHaveBeenCalledWith(10);
    });

    it('should allow custom prefetch value', async () => {
      server = new RpcServer({
        connection: mockConnectionManager,
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
        connection: mockConnectionManager,
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

  describe('ack strategy', () => {
    it('should nack without requeue in manual mode', async () => {
      server = new RpcServer({
        connection: mockConnectionManager,
        queueName: 'test-queue',
        ackStrategy: { mode: 'manual', requeue: false },
      });

      const handler = vi.fn().mockRejectedValue(new Error('fail'));
      server.registerHandler('TEST_COMMAND', handler);

      await server.start();

      const message = {
        content: Buffer.from(JSON.stringify({ input: 'test' })),
        properties: {
          correlationId: 'test-id',
          replyTo: 'reply-queue',
          type: 'TEST_COMMAND',
          timestamp: Date.now(),
        },
      };

      const channel = await mockConnection.createConfirmChannel();
      await mockConnection._consumeCallback(message);

      expect(channel.nack).toHaveBeenCalledWith(message, false, false);
      // In manual mode, no error response is sent
      expect(channel.sendToQueue).not.toHaveBeenCalled();
    });

    it('should support requeue as function', async () => {
      const requeueFn = vi.fn().mockReturnValue(false);
      server = new RpcServer({
        connection: mockConnectionManager,
        queueName: 'test-queue',
        ackStrategy: { mode: 'auto', requeue: requeueFn, maxRetries: 3 },
      });

      const handler = vi.fn().mockRejectedValue(new Error('fail'));
      server.registerHandler('TEST_COMMAND', handler);

      await server.start();

      const message = {
        content: Buffer.from(JSON.stringify({})),
        properties: {
          correlationId: 'test-id',
          replyTo: 'reply-queue',
          type: 'TEST_COMMAND',
          timestamp: Date.now(),
        },
      };

      const channel = await mockConnection.createConfirmChannel();
      await mockConnection._consumeCallback(message);

      expect(requeueFn).toHaveBeenCalled();
      // requeue returned false, so message goes to DLQ
      expect(channel.nack).toHaveBeenCalledWith(message, false, false);
    });

    it('should log warning when retryDelay is configured', async () => {
      const retryDelay = 1000;
      server = new RpcServer({
        connection: mockConnectionManager,
        queueName: 'test-queue',
        ackStrategy: { mode: 'auto', requeue: true, maxRetries: 3, retryDelay },
      });

      const handler = vi.fn().mockRejectedValue(new Error('fail'));
      server.registerHandler('TEST_COMMAND', handler);

      await server.start();

      const message = {
        content: Buffer.from(JSON.stringify({})),
        properties: {
          correlationId: 'test-id',
          replyTo: 'reply-queue',
          type: 'TEST_COMMAND',
          timestamp: Date.now(),
        },
      };

      await mockConnection._consumeCallback(message);

      // Message should still be requeued (nack with requeue=true)
      const channel = await mockConnection.createConfirmChannel();
      expect(channel.nack).toHaveBeenCalledWith(message, false, true);
    });

    it('should support retryDelay as function', async () => {
      const delayFn = vi.fn().mockReturnValue(500);
      server = new RpcServer({
        connection: mockConnectionManager,
        queueName: 'test-queue',
        ackStrategy: { mode: 'auto', requeue: true, maxRetries: 3, retryDelay: delayFn },
      });

      const handler = vi.fn().mockRejectedValue(new Error('fail'));
      server.registerHandler('TEST_COMMAND', handler);

      await server.start();

      const message = {
        content: Buffer.from(JSON.stringify({})),
        properties: {
          correlationId: 'test-id',
          replyTo: 'reply-queue',
          type: 'TEST_COMMAND',
          timestamp: Date.now(),
        },
      };

      await mockConnection._consumeCallback(message);

      expect(delayFn).toHaveBeenCalledWith(1);
    });
  });

  describe('stop() options', () => {
    beforeEach(async () => {
      server = new RpcServer({
        connection: mockConnectionManager,
        queueName: 'test-queue',
      });
      await server.start();
    });

    it('should force stop without waiting for in-flight', async () => {
      const handler = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ result: 'done' }), 5000))
        );
      server.registerHandler('SLOW', handler);

      const message = {
        content: Buffer.from(JSON.stringify({})),
        properties: {
          correlationId: 'test-id',
          replyTo: 'reply-queue',
          type: 'SLOW',
          timestamp: Date.now(),
        },
      };

      // Start processing (don't await)
      mockConnection._consumeCallback(message);

      // Force stop immediately
      await server.stop({ force: true });

      expect(server.isServerRunning()).toBe(false);
    });

    it('should handle channel close error during stop', async () => {
      const channel = await mockConnection.createConfirmChannel();
      channel.close.mockRejectedValueOnce(new Error('Close failed'));

      await expect(server.stop()).resolves.not.toThrow();
      expect(server.isServerRunning()).toBe(false);
    });

    it('should handle consumer cancel error during stop', async () => {
      const channel = await mockConnection.createConfirmChannel();
      channel.cancel.mockRejectedValueOnce(new Error('Cancel failed'));

      await expect(server.stop()).resolves.not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle message without type property', async () => {
      server = new RpcServer({
        connection: mockConnectionManager,
        queueName: 'test-queue',
      });

      await server.start();

      const message = {
        content: Buffer.from(JSON.stringify({})),
        properties: {
          correlationId: 'test-id',
          replyTo: 'reply-queue',
          timestamp: Date.now(),
          // no 'type' property
        },
      };

      const channel = await mockConnection.createConfirmChannel();
      await mockConnection._consumeCallback(message);

      // Should nack (command required error → requeue on first attempt)
      expect(channel.nack).toHaveBeenCalled();
    });

    it('should report consumer count correctly', async () => {
      server = new RpcServer({
        connection: mockConnectionManager,
        queueName: 'test-queue',
      });

      expect(server.getConsumerCount()).toBe(0);

      await server.start();
      expect(server.getConsumerCount()).toBe(1);

      await server.stop();
      expect(server.getConsumerCount()).toBe(0);
    });

    it('should report in-flight count', async () => {
      server = new RpcServer({
        connection: mockConnectionManager,
        queueName: 'test-queue',
      });

      expect(server.getInFlightCount()).toBe(0);
    });

    it('should skip assertQueue when disabled', async () => {
      server = new RpcServer({
        connection: mockConnectionManager,
        queueName: 'test-queue',
        assertQueue: false,
      });

      await server.start();

      const channel = await mockConnection.createConfirmChannel();
      // assertQueue should not be called for the main queue
      // (it may have been called in beforeEach setup, so we check the call count)
      const assertQueueCalls = channel.assertQueue.mock.calls.filter(
        (call: any[]) => call[0] === 'test-queue'
      );
      expect(assertQueueCalls).toHaveLength(0);
    });

    it('should handle error response send failure gracefully', async () => {
      server = new RpcServer({
        connection: mockConnectionManager,
        queueName: 'test-queue',
      });

      const handler = vi.fn().mockRejectedValue(new Error('fail'));
      server.registerHandler('TEST_COMMAND', handler);

      await server.start();

      const channel = await mockConnection.createConfirmChannel();
      // Make sendToQueue throw on error response
      channel.sendToQueue.mockImplementationOnce(() => {
        throw new Error('Send failed');
      });

      const message = {
        content: Buffer.from(JSON.stringify({})),
        properties: {
          correlationId: 'test-id',
          replyTo: 'reply-queue',
          type: 'TEST_COMMAND',
          timestamp: Date.now(),
          headers: { 'x-retry-count': 3 }, // final failure
        },
      };

      // Should not throw even if error response fails
      await expect(mockConnection._consumeCallback(message)).resolves.not.toThrow();
    });
  });

  describe('slow message detection', () => {
    it('should trigger warn callback for slow messages', async () => {
      const onSlowMessage = vi.fn();
      server = new RpcServer({
        connection: mockConnectionManager,
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

      const message = {
        content: Buffer.from(JSON.stringify({ input: 'test' })),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
          type: 'SLOW_COMMAND',
          timestamp: Date.now(),
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
        connection: mockConnectionManager,
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

      const message = {
        content: Buffer.from(JSON.stringify({ input: 'test' })),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
          type: 'VERY_SLOW_COMMAND',
          timestamp: Date.now(),
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
        connection: mockConnectionManager,
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

      const message = {
        content: Buffer.from(JSON.stringify({ input: 'test' })),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
          type: 'FAST_COMMAND',
          timestamp: Date.now(),
        },
      };

      await mockConnection._consumeCallback(message);

      expect(onSlowMessage).not.toHaveBeenCalled();
    });

    it('should work without slow message detection config', async () => {
      server = new RpcServer({
        connection: mockConnectionManager,
        queueName: 'test-queue',
      });

      await server.start();

      const handler = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ result: 'success' }), 150))
        );
      server.registerHandler('COMMAND', handler);

      const message = {
        content: Buffer.from(JSON.stringify({ input: 'test' })),
        properties: {
          correlationId: 'test-correlation-id',
          replyTo: 'reply-queue',
          type: 'COMMAND',
          timestamp: Date.now(),
        },
      };

      // Should not throw
      await expect(mockConnection._consumeCallback(message)).resolves.not.toThrow();
    });
  });
});
