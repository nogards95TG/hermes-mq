import { EventEmitter } from 'events';
import { Logger, SilentLogger } from '../types/Logger';


export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Circuit breaker configuration
 *
 * @property failureThreshold - Number of consecutive failures before opening the circuit (default: 5)
 * @property resetTimeout - Time in milliseconds to wait before attempting to close the circuit (default: 60000)
 * @property halfOpenMaxAttempts - Maximum number of connection attempts in half-open state (default: 3)
 * @property logger - Optional logger for logging circuit breaker events
 */
export interface CircuitBreakerConfig {
  failureThreshold?: number;
  resetTimeout?: number;
  halfOpenMaxAttempts?: number;
  logger?: Logger;
}

/**
 * Circuit breaker statistics
 */
export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  halfOpenAttempts: number;
}

/**
 * Default circuit breaker configuration
 */
const DEFAULT_CONFIG: Required<Omit<CircuitBreakerConfig, 'logger'>> = {
  failureThreshold: 5,
  resetTimeout: 60_000, // 60 seconds
  halfOpenMaxAttempts: 3,
};

/**
 * CircuitBreaker implements the Circuit Breaker pattern for fault tolerance
 *
 * The circuit breaker prevents cascading failures by failing fast when a service
 * is experiencing issues. It has three states:
 *
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, requests fail immediately (fail-fast)
 * - HALF_OPEN: Testing if service has recovered, allows limited requests
 *
 * @example
 * ```typescript
 * import { CircuitBreaker } from 'hermes-mq/core';
 *
 * const breaker = new CircuitBreaker({
 *   failureThreshold: 5,
 *   resetTimeout: 60000,
 *   halfOpenMaxAttempts: 3
 * });
 *
 * breaker.on('stateChange', (state) => {
 *   console.log(`Circuit breaker state: ${state}`);
 * });
 *
 * try {
 *   const result = await breaker.execute(async () => {
 *     return await riskyOperation();
 *   });
 * } catch (error) {
 *   // Handle error (circuit open or operation failed)
 * }
 * ```
 */
export class CircuitBreaker extends EventEmitter {
  private state: CircuitBreakerState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private halfOpenAttempts = 0;
  private config: Required<Omit<CircuitBreakerConfig, 'logger'>>;
  private logger: Logger;

  constructor(config: CircuitBreakerConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = config.logger || new SilentLogger();
  }

  /**
   * Execute a function protected by the circuit breaker
   *
   * @param fn - The async function to execute
   * @returns Promise that resolves with the function result
   * @throws Error when circuit is OPEN or function execution fails
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is OPEN
    if (this.state === 'OPEN') {
      const timeSinceLastFailure = Date.now() - (this.lastFailureTime || 0);

      // If reset timeout has passed, transition to HALF_OPEN
      if (timeSinceLastFailure >= this.config.resetTimeout) {
        this.transitionTo('HALF_OPEN');
        this.halfOpenAttempts = 0;
      } else {
        const error = new Error(
          `Circuit breaker is OPEN. Wait ${Math.ceil(
            (this.config.resetTimeout - timeSinceLastFailure) / 1000
          )}s before retry`
        );
        this.logger.debug('Circuit breaker rejected request (OPEN state)', {
          state: this.state,
          failureCount: this.failureCount,
          timeSinceLastFailure,
        });
        throw error;
      }
    }

    // In HALF_OPEN state, limit the number of attempts
    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        const error = new Error(
          `Circuit breaker is HALF_OPEN and has reached max attempts (${this.config.halfOpenMaxAttempts})`
        );
        this.logger.debug('Circuit breaker rejected request (HALF_OPEN limit reached)', {
          state: this.state,
          halfOpenAttempts: this.halfOpenAttempts,
          maxAttempts: this.config.halfOpenMaxAttempts,
        });
        throw error;
      }
      this.halfOpenAttempts++;
    }

    // Execute the function
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error as Error);
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.successCount++;
    this.lastSuccessTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      // If all half-open attempts succeed, close the circuit
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        this.logger.info('Circuit breaker recovered - closing circuit', {
          halfOpenAttempts: this.halfOpenAttempts,
          successCount: this.successCount,
        });
        this.reset();
      }
    } else if (this.state === 'CLOSED') {
      // Reset failure count on success in CLOSED state
      if (this.failureCount > 0) {
        this.logger.debug('Circuit breaker: resetting failure count after success');
        this.failureCount = 0;
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(error: Error): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    this.logger.warn('Circuit breaker: operation failed', {
      error: error.message,
      state: this.state,
      failureCount: this.failureCount,
      threshold: this.config.failureThreshold,
    });

    if (this.state === 'HALF_OPEN') {
      // Any failure in HALF_OPEN state reopens the circuit
      this.logger.warn('Circuit breaker: failure in HALF_OPEN state - reopening circuit');
      this.transitionTo('OPEN');
      this.halfOpenAttempts = 0;
    } else if (this.state === 'CLOSED') {
      // Open circuit if failure threshold is reached
      if (this.failureCount >= this.config.failureThreshold) {
        this.logger.error(
          'Circuit breaker: failure threshold reached - opening circuit',
          undefined,
          {
            failureCount: this.failureCount,
            threshold: this.config.failureThreshold,
          }
        );
        this.transitionTo('OPEN');
      }
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitBreakerState): void {
    const oldState = this.state;
    this.state = newState;

    this.logger.info(`Circuit breaker state transition: ${oldState} -> ${newState}`, {
      failureCount: this.failureCount,
      successCount: this.successCount,
    });

    this.emit('stateChange', {
      oldState,
      newState,
      failureCount: this.failureCount,
      successCount: this.successCount,
    });
  }

  /**
   * Reset the circuit breaker to CLOSED state
   */
  private reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.halfOpenAttempts = 0;
    this.emit('reset');
  }

  /**
   * Force reset the circuit breaker to CLOSED state
   *
   * Use this method to manually reset the circuit breaker,
   * for example after fixing the underlying issue.
   */
  forceReset(): void {
    this.logger.info('Circuit breaker manually reset');
    this.reset();
  }

  /**
   * Get current circuit breaker state
   */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      halfOpenAttempts: this.halfOpenAttempts,
    };
  }

  /**
   * Check if circuit is currently open
   */
  isOpen(): boolean {
    return this.state === 'OPEN';
  }

  /**
   * Check if circuit is currently closed
   */
  isClosed(): boolean {
    return this.state === 'CLOSED';
  }

  /**
   * Check if circuit is currently half-open
   */
  isHalfOpen(): boolean {
    return this.state === 'HALF_OPEN';
  }
}
