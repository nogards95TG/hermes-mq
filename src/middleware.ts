import { Logger, SilentLogger } from './core';

/**
 * RPC Context passed to middleware and handlers
 *
 * Contains the request data, metadata, and helpers for responding/acking messages.
 */
export interface RpcContext<Req = any, Res = any> {
  /** Command name */
  command: string;

  /** Request payload */
  payload: Req;

  /** AMQP message properties and headers */
  properties: Record<string, any>;

  /** Raw AMQP message (if available) */
  rawMessage?: any;

  /** Per-request metadata store for middleware */
  meta: Record<string, any>;

  /** Logger instance */
  logger: Logger;

  /** Current retry attempt number (0-based) */
  attempts?: number;

  /** Abort signal for request cancellation */
  abortSignal?: AbortSignal;

  /** Send reply helper */
  reply: (res: Res) => Promise<void>;

  /** ACK message */
  ack: () => void;

  /** NACK message */
  nack: (requeue?: boolean) => void;

  /** @internal Flag to prevent double-reply */
  _replied?: boolean;
}

/**
 * Middleware function type
 *
 * Middleware may return a value to short-circuit the chain.
 * A non-undefined returned value is treated as the final response.
 */
export type Middleware<Req = any, Res = any> = (
  ctx: RpcContext<Req, Res>,
  next: () => Promise<any>
) => Promise<any> | any;

/**
 * Handler function type
 *
 * Called after all middleware have executed.
 * May return a value which becomes the response.
 */
export type Handler<Req = any, Res = any> = (
  payload: Req,
  ctx: RpcContext<Req, Res>
) => Promise<Res | void> | Res | void;

/**
 * Composed middleware chain - single function that executes all middleware
 */
export type ComposedMiddleware<Req = any, Res = any> = (
  ctx: RpcContext<Req, Res>
) => Promise<any>;

/**
 * Compose an array of middleware and a handler into a single function
 *
 * Follows Express/Koa-like semantics:
 * - Middleware are executed in order
 * - next() advances to the next middleware
 * - Returning a non-undefined value short-circuits the chain
 * - The handler is always executed last (before returning)
 *
 * Supports both old and new handler signatures:
 * - Old: (data, metadata?) -> any
 * - New: (payload, ctx) -> any
 *
 * @param middlewares - Array of middleware functions
 * @param handler - Final handler function to execute
 * @returns A composed function that executes the entire chain
 *
 * @example
 * ```typescript
 * const composed = compose(
 *   [mw1, mw2],
 *   handler
 * );
 * await composed(ctx);
 * ```
 */
export const compose = <Req = any, Res = any>(
  middlewares: Middleware<Req, Res>[],
  handler: Handler<Req, Res>
): ComposedMiddleware<Req, Res> => {
  // Detect handler signature to support both old and new formats
  // Old: (data, metadata?) -> any
  // New: (payload, ctx) -> any
  // We can detect by checking the second parameter name or by trying the new format first
  const isNewFormat = handler.length > 1 && handler.toString().includes('ctx');

  // Create a wrapper around the final handler
  const handlerWrapper: Middleware<Req, Res> = async (ctx: RpcContext<Req, Res>) => {
    let result: any;

    if (isNewFormat) {
      // New format: pass (payload, ctx)
      result = await handler(ctx.payload, ctx);
    } else {
      // Old format: pass (data, metadata?) for backward compatibility
      // Only pass metadata if it exists and is not empty
      const metadata = Object.keys(ctx.meta).length > 0 ? ctx.meta : undefined;
      result = await handler(ctx.payload, metadata as any);
    }

    // If handler returned a value and ctx.reply wasn't called, mark as replied
    if (result !== undefined && !ctx._replied) {
      ctx._replied = true;
      if (ctx.reply) {
        await ctx.reply(result);
      }
    }

    return result;
  };

  // Combine all middleware with the handler
  const allMiddleware = [...middlewares, handlerWrapper];

  // Return the composed function
  return async (ctx: RpcContext<Req, Res>) => {
    let index = -1;
    let called = false;

    const dispatch = async (i: number): Promise<any> => {
      if (called) {
        throw new Error('next() called multiple times');
      }

      if (i <= index) {
        throw new Error('next() called multiple times');
      }

      index = i;

      if (i >= allMiddleware.length) {
        return;
      }

      const middleware = allMiddleware[i];

      try {
        const result = await middleware(ctx, async () => {
          called = false;
          return dispatch(i + 1);
        });

        called = false;

        // If middleware returned a value, short-circuit and return it
        if (result !== undefined && !ctx._replied) {
          ctx._replied = true;
          if (ctx.reply) {
            await ctx.reply(result);
          }
        }

        return result;
      } catch (error) {
        called = false;
        throw error;
      }
    };

    return dispatch(0);
  };
};

/**
 * Create an RpcContext object
 *
 * @internal Used by RpcServer to create context for each request
 */
export const createContext = <Req = any, Res = any>(
  command: string,
  payload: Req,
  properties: Record<string, any>,
  logger: Logger,
  options?: {
    rawMessage?: any;
    attempts?: number;
    abortSignal?: AbortSignal;
    reply?: (res: Res) => Promise<void>;
    ack?: () => void;
    nack?: (requeue?: boolean) => void;
    metadata?: Record<string, any>;
  }
): RpcContext<Req, Res> => {
  const silentLogger = new SilentLogger();

  return {
    command,
    payload,
    properties,
    meta: options?.metadata || {},
    logger: logger || silentLogger,
    rawMessage: options?.rawMessage,
    attempts: options?.attempts,
    abortSignal: options?.abortSignal,
    reply: options?.reply || (async () => {}),
    ack: options?.ack || (() => {}),
    nack: options?.nack || (() => {}),
    _replied: false,
  };
};

// Re-export built-in middleware for convenience
export { validate, validateAdapter } from './middleware/validate';
export type { ValidateAdapter, ValidationResult, ValidationErrorResponse } from './middleware/validate';

export { retry } from './middleware/retry';
export type { RetryPolicyOptions } from './middleware/retry';
