import { describe, it, expect } from 'vitest';
import { compose } from '../../../src/core/middleware/compose';
import { Middleware, Handler, MessageContext } from '../../../src/core/middleware/types';

describe('compose', () => {
  it('should execute middlewares in order', async () => {
    const order: number[] = [];

    const middleware1: Middleware = async (_msg, _ctx, next) => {
      order.push(1);
      const result = await next();
      order.push(4);
      return result;
    };

    const middleware2: Middleware = async (_msg, _ctx, next) => {
      order.push(2);
      const result = await next();
      order.push(3);
      return result;
    };

    const handler: Handler = async (_msg, _ctx) => {
      order.push(3);
      return 'done';
    };

    const composed = compose(middleware1, middleware2, handler);
    const result = await composed('test', {} as MessageContext);

    expect(order).toEqual([1, 2, 3, 3, 4]);
    expect(result).toBe('done');
  });

  it('should handle errors in middleware', async () => {
    const middleware: Middleware = async (_msg, _ctx, _next) => {
      throw new Error('Middleware error');
    };

    const handler: Handler = async () => 'success';

    const composed = compose(middleware, handler);

    await expect(composed('test', {} as MessageContext)).rejects.toThrow('Middleware error');
  });

  it('should pass modified message through middleware chain', async () => {
    const transformer: Middleware = async (msg, ctx, next) => {
      const modified = { ...msg, transformed: true };
      return next(modified);
    };

    const handler: Handler = async (msg) => msg;

    const composed = compose(transformer, handler);
    const result = await composed({ value: 1 }, {} as MessageContext);

    expect(result).toEqual({ value: 1, transformed: true });
  });

  it('should detect and reject if no handler provided', () => {
    const middleware1: Middleware = async (_msg, _ctx, next) => next();
    const middleware2: Middleware = async (_msg, _ctx, next) => next();

    expect(() => compose(middleware1, middleware2)).toThrow('Last argument must be a handler');
  });

  it('should handle synchronous middlewares and handlers', async () => {
    const middleware: Middleware = (_msg, _ctx, next) => {
      return next();
    };

    const handler: Handler = (_msg, _ctx) => 'sync result';

    const composed = compose(middleware, handler);
    const result = await composed('test', {} as MessageContext);

    expect(result).toBe('sync result');
  });
});
