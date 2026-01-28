import { Logger, SilentLogger } from '../types/Logger';
import { RETRY } from '../constants';

/**
 * Retry configuration options
 */
export interface RetryConfig {
  enabled?: boolean;
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryableErrors?: Array<string | RegExp>;
  /**
   * Custom function to determine if an error should be retried
   * @param error - The error that occurred
   * @param attempt - Current attempt number (1-based)
   * @returns true to retry, false to stop
   */
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: Required<Omit<RetryConfig, 'shouldRetry' | 'retryableErrors'>> & {
  shouldRetry?: (error: Error, attempt: number) => boolean;
  retryableErrors?: Array<string | RegExp>;
} = {
  enabled: true,
  maxAttempts: RETRY.DEFAULT_MAX_ATTEMPTS,
  initialDelay: RETRY.DEFAULT_INITIAL_DELAY_MS,
  maxDelay: RETRY.DEFAULT_MAX_DELAY_MS,
  backoffMultiplier: 2,
};

/**
 * RetryPolicy implements exponential backoff retry logic
 */
export class RetryPolicy {
  private config: Required<Omit<RetryConfig, 'shouldRetry' | 'retryableErrors'>> & {
    shouldRetry?: (error: Error, attempt: number) => boolean;
    retryableErrors?: Array<string | RegExp>;
  };
  private logger: Logger;

  constructor(config?: RetryConfig, logger?: Logger) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
    this.logger = logger || new SilentLogger();
  }

  /**
   * Check if an error should be retried
   */
  shouldRetry(error: Error, attempt: number): boolean {
    if (!this.config.enabled) {
      return false;
    }

    if (attempt >= this.config.maxAttempts) {
      return false;
    }

    if (this.config.shouldRetry) {
      return this.config.shouldRetry(error, attempt);
    }

    return this.isRetryableError(error);
  }

  /**
   * Check if error matches retryable patterns
   */
  private isRetryableError(error: Error): boolean {
    const errorMessage = error.message || '';
    const errorName = error.name || '';
    if (!this.config.retryableErrors || this.config.retryableErrors.length === 0) {
      return true; // Retry all errors by default
    }
    return this.config.retryableErrors.some((pattern) => {
      if (pattern instanceof RegExp) {
        return pattern.test(errorMessage) || pattern.test(errorName);
      }
      return errorMessage.includes(pattern) || errorName.includes(pattern);
    });
  }

  /**
   * Calculate delay for given attempt number with exponential backoff
   */
  getDelay(attempt: number): number {
    // Cap exponential backoff to prevent overflow
    const delay = this.config.initialDelay * Math.pow(this.config.backoffMultiplier, attempt);
    return Math.min(delay, this.config.maxDelay);
  }

  /**
   * Execute function with retry logic
   */
  async execute<T>(fn: () => Promise<T>, context?: string): Promise<T> {
    let lastError: Error;
    let attempt = 0;

    while (attempt < this.config.maxAttempts) {
      try {
        const result = await fn();
        if (attempt > 0) {
          this.logger.info(`Operation succeeded after ${attempt} retries`, { context });
        }
        return result;
      } catch (error) {
        lastError = error as Error;
        attempt++;

        if (!this.shouldRetry(lastError, attempt)) {
          this.logger.error(`Operation failed, not retrying`, lastError, {
            context,
            attempt,
            reason: 'non-retryable error or max attempts reached',
          });
          throw lastError;
        }

        const delay = this.getDelay(attempt - 1);
        this.logger.warn(`Operation failed, retrying in ${delay}ms`, {
          context,
          attempt,
          maxAttempts: this.config.maxAttempts,
          error: lastError.message,
        });

        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
