import { Middleware, Handler, MessageContext } from './types';

/**
 * Composes multiple middleware and a final handler into a single function.
 *
 * Note: callers may pass only middleware functions — the runtime will validate that
 * the last function is a handler and throw if not. We provide a permissive type
 * overload so tests and consumers that intentionally call compose(...) without a
 * final handler still compile and rely on runtime validation.
 */
export const compose = <T = any>(...fns: Array<any>): Handler<T> => {
  // Validate that we have at least one function and the last one is a handler
  if (fns.length === 0) {
    throw new Error('At least one handler is required');
  }

  const lastFn = fns[fns.length - 1];
  // A handler should accept at most 2 args (message, context). If lastFn has >2 params,
  // it's not a handler. Don't rely on TypeScript here — perform a runtime check.
  if (typeof lastFn !== 'function' || lastFn.length > 2) {
    throw new Error('Last argument must be a handler (function with max 2 parameters)');
  }

  // Return a composed function that executes the middleware chain
  return async (message: T, context: MessageContext): Promise<any> => {
    let index = 0;

    const next = async (modifiedMessage?: any): Promise<any> => {
      if (index >= fns.length) {
        throw new Error('next() called too many times');
      }

      const fn = fns[index++];
      const currentMessage = modifiedMessage !== undefined ? modifiedMessage : message;

      if (index === fns.length) {
        // Last function is the handler, call it without next
        return (fn as Handler)(currentMessage, context);
      } else {
        // Middleware, call with next
        return (fn as Middleware)(currentMessage, context, next);
      }
    };

    return next();
  };
};
