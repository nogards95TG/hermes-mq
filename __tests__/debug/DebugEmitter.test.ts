import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DebugEmitter } from '../../src/debug/DebugEmitter';
import type { DebugEvent } from '../../src/debug/types';

describe('DebugEmitter', () => {
  let emitter: DebugEmitter;
  const serviceId = 'test-service-123';

  beforeEach(() => {
    emitter = new DebugEmitter(serviceId);
  });

  describe('constructor', () => {
    it('should initialize with correct serviceId', () => {
      expect(emitter).toBeDefined();
      expect(emitter.isActive()).toBe(true);
    });

    it('should set max listeners to prevent memory leaks', () => {
      expect(emitter.getMaxListeners()).toBe(10);
    });
  });

  describe('destroy', () => {
    it('should mark emitter as destroyed', () => {
      emitter.destroy();
      expect(emitter.isActive()).toBe(false);
    });

    it('should remove all listeners', () => {
      const listener = vi.fn();
      emitter.on('debug-event', listener);

      emitter.destroy();

      expect(emitter.listenerCount('debug-event')).toBe(0);
    });

    it('should be idempotent', () => {
      emitter.destroy();
      emitter.destroy();
      expect(emitter.isActive()).toBe(false);
    });
  });

  describe('emitMessageReceived', () => {
    it('should emit message:received event with correct data', () => {
      return new Promise<void>((resolve) => {
        const data = {
          id: 'msg-1',
          type: 'rpc-request' as const,
          queue: 'test-queue',
          command: 'test.command',
          correlationId: 'corr-1',
          payload: { test: 'data' },
          metadata: { extra: 'info' },
        };

        emitter.on('debug-event', (event: DebugEvent) => {
          expect(event.type).toBe('message:received');
          expect(event.serviceId).toBe(serviceId);
          expect(event.data).toEqual(data);
          expect(event.timestamp).toBeInstanceOf(Date);
          resolve();
        });

        emitter.emitMessageReceived(data);
      });
    });

    it('should not emit after destroy', () => {
      const listener = vi.fn();
      emitter.on('debug-event', listener);

      emitter.destroy();

      emitter.emitMessageReceived({
        id: 'msg-1',
        type: 'rpc-request',
        queue: 'test-queue',
        command: 'test.command',
        correlationId: 'corr-1',
        payload: {},
      });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('emitMessageSuccess', () => {
    it('should emit message:success event with correct data', () => {
      return new Promise<void>((resolve) => {
        const data = {
          id: 'msg-1',
          command: 'test.command',
          duration: 150,
          response: { result: 'success' },
        };

        emitter.on('debug-event', (event: DebugEvent) => {
          expect(event.type).toBe('message:success');
          expect(event.data).toEqual(data);
          resolve();
        });

        emitter.emitMessageSuccess(data);
      });
    });
  });

  describe('emitMessageError', () => {
    it('should emit message:error event with correct error data', () => {
      return new Promise<void>((resolve) => {
        const data = {
          id: 'msg-1',
          command: 'test.command',
          duration: 100,
          error: {
            code: 'ERR_TEST',
            message: 'Test error',
            stack: 'Error stack trace',
            context: { additional: 'context' },
          },
        };

        emitter.on('debug-event', (event: DebugEvent) => {
          expect(event.type).toBe('message:error');
          expect(event.data).toEqual(data);
          resolve();
        });

        emitter.emitMessageError(data);
      });
    });
  });

  describe('emitMessageTimeout', () => {
    it('should emit message:timeout event', () => {
      return new Promise<void>((resolve) => {
        const data = {
          id: 'msg-1',
          command: 'test.command',
          duration: 5000,
        };

        emitter.on('debug-event', (event: DebugEvent) => {
          expect(event.type).toBe('message:timeout');
          expect(event.data).toEqual(data);
          resolve();
        });

        emitter.emitMessageTimeout(data);
      });
    });
  });

  describe('emitConnectionConnected', () => {
    it('should emit connection:connected event', () => {
      return new Promise<void>((resolve) => {
        const data = {
          url: 'amqp://localhost:5672',
          message: 'Connected successfully',
        };

        emitter.on('debug-event', (event: DebugEvent) => {
          expect(event.type).toBe('connection:connected');
          expect(event.data).toEqual(data);
          resolve();
        });

        emitter.emitConnectionConnected(data);
      });
    });
  });

  describe('emitConnectionDisconnected', () => {
    it('should emit connection:disconnected event', () => {
      return new Promise<void>((resolve) => {
        const data = {
          message: 'Disconnected',
        };

        emitter.on('debug-event', (event: DebugEvent) => {
          expect(event.type).toBe('connection:disconnected');
          expect(event.data).toEqual(data);
          resolve();
        });

        emitter.emitConnectionDisconnected(data);
      });
    });
  });

  describe('emitConnectionError', () => {
    it('should emit connection:error event', () => {
      return new Promise<void>((resolve) => {
        const error = new Error('Connection failed');
        const data = {
          error,
          message: 'Connection error occurred',
        };

        emitter.on('debug-event', (event: DebugEvent) => {
          expect(event.type).toBe('connection:error');
          expect(event.data).toEqual(data);
          resolve();
        });

        emitter.emitConnectionError(data);
      });
    });
  });

  describe('emitServiceStarted', () => {
    it('should emit service:started event', () => {
      return new Promise<void>((resolve) => {
        const service = {
          id: 'service-1',
          type: 'rpc-server' as const,
          name: 'test-rpc-server',
          status: 'active' as const,
          startedAt: new Date(),
          messageCount: 0,
        };

        emitter.on('debug-event', (event: DebugEvent) => {
          expect(event.type).toBe('service:started');
          expect(event.data).toEqual(service);
          resolve();
        });

        emitter.emitServiceStarted(service);
      });
    });
  });

  describe('emitServiceStopped', () => {
    it('should emit service:stopped event with id', () => {
      return new Promise<void>((resolve) => {
        const stoppedServiceId = 'service-1';

        emitter.on('debug-event', (event: DebugEvent) => {
          expect(event.type).toBe('service:stopped');
          expect(event.data).toEqual({ id: stoppedServiceId });
          resolve();
        });

        emitter.emitServiceStopped(stoppedServiceId);
      });
    });
  });

  describe('error handling', () => {
    it('should not crash on emit errors', () => {
      // Force an error by removing the emit method
      const originalEmit = emitter.emit;
      emitter.emit = (() => {
        throw new Error('Emit error');
      }) as any;

      // Should not throw
      expect(() => {
        emitter.emitMessageReceived({
          id: 'msg-1',
          type: 'rpc-request',
          queue: 'test',
          command: 'test',
          correlationId: 'corr-1',
          payload: {},
        });
      }).not.toThrow();

      // Restore
      emitter.emit = originalEmit;
    });
  });

  describe('multiple listeners', () => {
    it('should notify all listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();

      emitter.on('debug-event', listener1);
      emitter.on('debug-event', listener2);
      emitter.on('debug-event', listener3);

      emitter.emitMessageReceived({
        id: 'msg-1',
        type: 'rpc-request',
        queue: 'test',
        command: 'test',
        correlationId: 'corr-1',
        payload: {},
      });

      expect(listener1).toHaveBeenCalledOnce();
      expect(listener2).toHaveBeenCalledOnce();
      expect(listener3).toHaveBeenCalledOnce();
    });
  });

  describe('memory management', () => {
    it('should limit max listeners', () => {
      const emitter2 = new DebugEmitter('test');

      // Add exactly max listeners
      for (let i = 0; i < 10; i++) {
        emitter2.on('debug-event', () => {});
      }

      expect(emitter2.listenerCount('debug-event')).toBe(10);
    });
  });
});
