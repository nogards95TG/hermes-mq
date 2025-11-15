import { Middleware, RpcContext } from '../middleware';

/**
 * Retry policy configuration
 */
export interface RetryPolicyOptions {
  /** Maximum number of attempts (including the initial attempt) */
  maxAttempts?: number;

  /** Backoff strategy: 'fixed', 'exponential', or custom function */
  backoffStrategy?: 'fixed' | 'exponential' | ((attempt: number) => number);

  /** Base delay in milliseconds for 'fixed' strategy (default: 1000) */
  backoffDelay?: number;

  /** Whether to requeue on failure */
  requeueOnFail?: boolean;
}

/**
 * Built-in retry middleware
 *
 * Injects a retry policy into ctx.meta that influences downstream error/ack logic.
 * The middleware itself is a metadata injector that calls next() and doesn't reply.
 *
 * Central error handling logic should read ctx.meta.retryPolicy to determine:
 * - Whether to requeue the message
 * - How many times to retry
 * - What backoff strategy to use
 *
 * @param policy - Retry policy configuration
 * @returns Middleware function
 *
 * @example
 * ```typescript
 * import { retry } from 'hermes-mq';
 *
 * server.registerHandler(
 *   'CRITICAL_COMMAND',
 *   retry({
 *     maxAttempts: 5,
 *     backoffStrategy: 'exponential',
 *     backoffDelay: 1000
 *   }),
 *   async (payload) => {
 *     // ... handler logic
 *   }
 * );
 * ```
 */
export const retry = <Req = any, Res = any>(
  policy: RetryPolicyOptions
): Middleware<Req, Res> => {
  return async (ctx: RpcContext<Req, Res>, next) => {
    // Inject retry policy into context metadata
    ctx.meta.retryPolicy = {
      maxAttempts: policy.maxAttempts,
      backoffStrategy: policy.backoffStrategy || 'fixed',
      backoffDelay: policy.backoffDelay || 1000,
      requeueOnFail: policy.requeueOnFail !== false,
    };

    ctx.logger.debug('Retry middleware configured', {
      command: ctx.command,
      policy: ctx.meta.retryPolicy,
    });

    // Continue to next middleware - this middleware doesn't handle replies
    return await next();
  };
};
