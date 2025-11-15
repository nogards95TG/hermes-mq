import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RpcServer } from '../../src/server/rpc/RpcServer';
import { SilentLogger } from '../../src/core';
import { validate, retry } from '../../src/middleware';

describe('RpcServer - Middleware Support', () => {
  let server: RpcServer;

  beforeEach(() => {
    server = new RpcServer({
      connection: { url: 'amqp://localhost' },
      queueName: 'test-queue',
      logger: new SilentLogger(),
    });
  });

  describe('use() method', () => {
    it('should register global middleware', () => {
      const middleware = vi.fn();
      expect(() => {
        server.use(middleware);
      }).not.toThrow();
    });

    it('should register multiple middlewares', () => {
      const mw1 = vi.fn();
      const mw2 = vi.fn();

      expect(() => {
        server.use(mw1);
        server.use(mw2);
      }).not.toThrow();
    });

    it('should warn when use() called after registerHandler()', () => {
      const logger = new SilentLogger();
      const warnSpy = vi.spyOn(logger, 'warn');

      const serverWithLogger = new RpcServer({
        connection: { url: 'amqp://localhost' },
        queueName: 'test-queue',
        logger,
      });

      // Register a handler first
      serverWithLogger.registerHandler('TEST', async () => ({}));

      // Try to add middleware after
      const middleware = vi.fn();
      serverWithLogger.use(middleware);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('server.use() after handler registration ignored')
      );

      warnSpy.mockRestore();
    });
  });

  describe('registerHandler() with middleware', () => {
    it('should register handler without middleware (backward compatibility)', () => {
      const handler = vi.fn();
      expect(() => {
        server.registerHandler('SIMPLE', handler);
      }).not.toThrow();
    });

    it('should register handler with single middleware', () => {
      const middleware = vi.fn();
      const handler = vi.fn();

      expect(() => {
        server.registerHandler('WITH_MID', middleware, handler);
      }).not.toThrow();
    });

    it('should register handler with multiple middlewares', () => {
      const mw1 = vi.fn();
      const mw2 = vi.fn();
      const handler = vi.fn();

      expect(() => {
        server.registerHandler('MULTI_MID', mw1, mw2, handler);
      }).not.toThrow();
    });

    it('should throw if last argument is not a function', () => {
      expect(() => {
        server.registerHandler('BAD', {} as any);
      }).toThrow('Last argument must be a handler function');
    });

    it('should throw if middleware argument is not a function', () => {
      const handler = vi.fn();

      expect(() => {
        server.registerHandler('BAD', {} as any, handler);
      }).toThrow('must be a function');
    });
  });

  describe('handler override', () => {
    it('should allow overwriting handler with middleware', () => {
      const mw1 = vi.fn();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      server.registerHandler('CMD', handler1);
      expect(() => {
        server.registerHandler('CMD', mw1, handler2);
      }).not.toThrow();
    });
  });

  describe('composition at registration time', () => {
    it('should compose middleware at registerHandler() time', () => {
      const composeSpy = vi.fn();

      const middleware = async (ctx: any, next: any) => {
        composeSpy();
        await next();
      };

      const handler = async () => ({});

      server.registerHandler('COMPOSED', middleware, handler);

      // Compose should have been called during registration (spy was not called yet)
      expect(composeSpy).not.toHaveBeenCalled();

      // The spy would only be called during message handling, not during registration
    });
  });

  describe('unregisterHandler()', () => {
    it('should unregister handler and composed handler', () => {
      const mw = vi.fn();
      const handler = vi.fn();

      server.registerHandler('TO_DELETE', mw, handler);
      expect(() => {
        server.unregisterHandler('TO_DELETE');
      }).not.toThrow();
    });

    it('should warn when unregistering non-existent handler', () => {
      const logger = new SilentLogger();
      const warnSpy = vi.spyOn(logger, 'warn');

      const serverWithLogger = new RpcServer({
        connection: { url: 'amqp://localhost' },
        queueName: 'test-queue',
        logger,
      });

      serverWithLogger.unregisterHandler('NONEXISTENT');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No handler found')
      );

      warnSpy.mockRestore();
    });
  });

  describe('handler count', () => {
    it('should track handler count correctly', () => {
      expect(server.getHandlerCount()).toBe(0);

      server.registerHandler('CMD1', async () => ({}));
      expect(server.getHandlerCount()).toBe(1);

      server.registerHandler('CMD2', async () => ({}));
      expect(server.getHandlerCount()).toBe(2);

      server.unregisterHandler('CMD1');
      expect(server.getHandlerCount()).toBe(1);
    });
  });

  describe('command normalization', () => {
    it('should normalize command to uppercase', () => {
      const handler = vi.fn();
      server.registerHandler('lowercase', handler);

      // Both should work
      expect(() => {
        server.unregisterHandler('LOWERCASE');
      }).not.toThrow();

      expect(server.getHandlerCount()).toBe(0);
    });
  });

  describe('validation scenarios', () => {
    it('should reject empty command', () => {
      expect(() => {
        server.registerHandler('', vi.fn());
      }).toThrow('Command is required');
    });

    it('should reject missing handler', () => {
      expect(() => {
        server.registerHandler('TEST');
      }).toThrow('At least a handler function is required');
    });
  });

  describe('built-in middleware registration', () => {
    it('should work with validate middleware', () => {
      const schema = {
        safeParse: (data: any) => ({
          success: data.value !== undefined,
          data: data,
          error: data.value === undefined ? { errors: ['required'] } : null,
        }),
      };

      const validateMw = validate(schema);
      const handler = async () => ({ success: true });

      expect(() => {
        server.registerHandler('VALIDATED', validateMw, handler);
      }).not.toThrow();
    });

    it('should work with retry middleware', () => {
      const retryMw = retry({ maxAttempts: 3 });
      const handler = async () => ({ success: true });

      expect(() => {
        server.registerHandler('RETRIED', retryMw, handler);
      }).not.toThrow();
    });

    it('should work with validate and retry together', () => {
      const schema = {
        safeParse: (data: any) => ({ success: true, data }),
      };

      const validateMw = validate(schema);
      const retryMw = retry({ maxAttempts: 3 });
      const handler = async () => ({ success: true });

      expect(() => {
        server.registerHandler('FULL', validateMw, retryMw, handler);
      }).not.toThrow();
    });

    it('should work with global and handler middlewares together', () => {
      const globalMw = async (ctx: any, next: any) => next();
      const handlerMw = validate({
        safeParse: (data: any) => ({ success: true, data }),
      });
      const handler = async () => ({ success: true });

      server.use(globalMw);
      expect(() => {
        server.registerHandler('COMBINED', handlerMw, handler);
      }).not.toThrow();
    });
  });
});
