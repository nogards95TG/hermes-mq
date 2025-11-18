import { describe, it, expect } from 'vitest';
import { compose, createContext, RpcContext, Middleware } from '../../src/middleware';
import { SilentLogger } from '../../src/core';

describe('Middleware - compose', () => {
  describe('basic execution', () => {
    it('should execute middleware in correct order', async () => {
      const order: number[] = [];

      const mw1: Middleware = async (ctx, next) => {
        order.push(1);
        await next();
        order.push(1.5);
      };

      const mw2: Middleware = async (ctx, next) => {
        order.push(2);
        await next();
        order.push(2.5);
      };

      const handler = async (payload: any) => {
        order.push(3);
      };

      const composed = compose([mw1, mw2], handler);
      const ctx = createContext('TEST', {}, {}, new SilentLogger());

      await composed(ctx);

      expect(order).toEqual([1, 2, 3, 2.5, 1.5]);
    });

    it('should pass payload through middleware', async () => {
      const received: any[] = [];

      const mw1: Middleware = async (ctx, next) => {
        received.push(ctx.payload);
        ctx.payload = { ...ctx.payload, mw1: true };
        await next();
      };

      const mw2: Middleware = async (ctx, next) => {
        received.push(ctx.payload);
        ctx.payload = { ...ctx.payload, mw2: true };
        await next();
      };

      const handler = (payload: any) => {
        received.push(payload);
      };

      const composed = compose([mw1, mw2], handler);
      const ctx = createContext('TEST', { initial: true }, {}, new SilentLogger());

      await composed(ctx);

      expect(received).toHaveLength(3);
      expect(received[0]).toEqual({ initial: true });
      expect(received[1]).toEqual({ initial: true, mw1: true });
      expect(received[2]).toEqual({ initial: true, mw1: true, mw2: true });
    });

    it('should allow handler to return value', async () => {
      const handler = async (payload: any) => {
        return { result: 42 };
      };

      const composed = compose([], handler);
      const ctx = createContext('TEST', {}, {}, new SilentLogger());
      const result = await composed(ctx);

      expect(result).toEqual({ result: 42 });
      expect(ctx._replied).toBe(true);
    });
  });

  describe('short-circuit', () => {
    it('should short-circuit when middleware returns value', async () => {
      const executed: string[] = [];

      const mw1: Middleware = async (ctx, next) => {
        executed.push('mw1');
        return { error: 'forbidden' };
      };

      const mw2: Middleware = async (ctx, next) => {
        executed.push('mw2');
        await next();
      };

      const handler = async (payload: any) => {
        executed.push('handler');
        return { success: true };
      };

      const composed = compose([mw1, mw2], handler);
      const ctx = createContext('TEST', {}, {}, new SilentLogger());
      const result = await composed(ctx);

      expect(executed).toEqual(['mw1']);
      expect(result).toEqual({ error: 'forbidden' });
    });

    it('should allow ctx.reply to short-circuit', async () => {
      const executed: string[] = [];
      let repliedValue: any;

      const mw1: Middleware = async (ctx, next) => {
        executed.push('mw1');
        ctx._replied = true;
        await ctx.reply({ early: 'response' });
        repliedValue = { early: 'response' };
        // Explicitly NOT calling next()
      };

      const mw2: Middleware = async (ctx, next) => {
        executed.push('mw2');
        await next();
      };

      const handler = async () => {
        executed.push('handler');
      };

      const composed = compose([mw1, mw2], handler);
      const ctx = createContext('TEST', {}, {}, new SilentLogger(), {
        reply: async (value) => {
          repliedValue = value;
        },
      });

      await composed(ctx);
      expect(executed).toEqual(['mw1']);
      expect(repliedValue).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should propagate errors from middleware', async () => {
      const mw1: Middleware = async (ctx, next) => {
        throw new Error('Middleware error');
      };

      const composed = compose([mw1], async () => {});
      const ctx = createContext('TEST', {}, {}, new SilentLogger());

      await expect(composed(ctx)).rejects.toThrow('Middleware error');
    });

    it('should propagate errors from handler', async () => {
      const handler = async () => {
        throw new Error('Handler error');
      };

      const composed = compose([], handler);
      const ctx = createContext('TEST', {}, {}, new SilentLogger());

      await expect(composed(ctx)).rejects.toThrow('Handler error');
    });

    it('should throw on multiple next() calls', async () => {
      const mw1: Middleware = async (ctx, next) => {
        await next();
        await next(); // Should throw
      };

      const composed = compose([mw1], async () => {});
      const ctx = createContext('TEST', {}, {}, new SilentLogger());

      await expect(composed(ctx)).rejects.toThrow('next() called multiple times');
    });
  });

  describe('context', () => {
    it('should provide context to middleware and handler', async () => {
      const received: RpcContext[] = [];

      const mw: Middleware = async (ctx, next) => {
        received.push(ctx);
        await next();
      };

      const handler = (payload: any, ctx: RpcContext) => {
        received.push(ctx);
      };

      const composed = compose([mw], handler);
      const ctx = createContext('TEST_CMD', { data: 'test' }, { headers: {} }, new SilentLogger());

      await composed(ctx);

      expect(received).toHaveLength(2);
      expect(received[0].command).toBe('TEST_CMD');
      expect(received[0].payload).toEqual({ data: 'test' });
    });

    it('should allow middleware to store data in ctx.meta', async () => {
      const mw1: Middleware = async (ctx, next) => {
        ctx.meta.user = 'alice';
        await next();
      };

      const mw2: Middleware = async (ctx, next) => {
        ctx.meta.role = 'admin';
        await next();
      };

      let receivedMeta: any;

      const handler = (payload: any, ctx: RpcContext) => {
        receivedMeta = ctx.meta;
      };

      const composed = compose([mw1, mw2], handler);
      const ctx = createContext('TEST', {}, {}, new SilentLogger());

      await composed(ctx);

      expect(receivedMeta).toEqual({ user: 'alice', role: 'admin' });
    });
  });

  describe('async middleware', () => {
    it('should handle async middleware', async () => {
      const executed: string[] = [];

      const asyncMw: Middleware = async (ctx, next) => {
        executed.push('before');
        await new Promise((resolve) => setTimeout(resolve, 10));
        executed.push('awaited');
        await next();
        executed.push('after');
      };

      const handler = async () => {
        executed.push('handler');
        await new Promise((resolve) => setTimeout(resolve, 10));
      };

      const composed = compose([asyncMw], handler);
      const ctx = createContext('TEST', {}, {}, new SilentLogger());

      await composed(ctx);

      expect(executed).toEqual(['before', 'awaited', 'handler', 'after']);
    });
  });

  describe('sync middleware', () => {
    it('should support synchronous middleware', async () => {
      const executed: string[] = [];

      const syncMw: Middleware = (ctx, next) => {
        executed.push('sync');
        return next();
      };

      const handler = () => {
        executed.push('handler');
      };

      const composed = compose([syncMw], handler);
      const ctx = createContext('TEST', {}, {}, new SilentLogger());

      await composed(ctx);

      expect(executed).toEqual(['sync', 'handler']);
    });
  });

  describe('no next() call', () => {
    it('should handle middleware that does not call next()', async () => {
      const executed: string[] = [];

      const blockingMw: Middleware = async (ctx, next) => {
        executed.push('mw');
        // Intentionally not calling next()
      };

      const handler = async () => {
        executed.push('handler');
      };

      const composed = compose([blockingMw], handler);
      const ctx = createContext('TEST', {}, {}, new SilentLogger());

      await composed(ctx);

      // Handler should NOT be called
      expect(executed).toEqual(['mw']);
    });
  });
});
