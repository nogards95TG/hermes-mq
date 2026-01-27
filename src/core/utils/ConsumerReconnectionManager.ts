import { Logger, SilentLogger } from '../types/Logger';

/**
 * Configuration for consumer reconnection behavior
 */
export interface ConsumerReconnectionConfig {
  /**
   * Maximum number of reconnection attempts before giving up
   * @default 5
   */
  maxReconnectAttempts?: number;

  /**
   * Base delay in milliseconds for the first reconnection attempt
   * @default 5000
   */
  baseDelay?: number;

  /**
   * Maximum delay in milliseconds between reconnection attempts
   * @default 60000 (1 minute)
   */
  maxDelay?: number;

  /**
   * Logger instance for logging reconnection events
   */
  logger?: Logger;
}

/**
 * Result of a reconnection attempt
 */
export interface ReconnectionResult {
  success: boolean;
  attempt: number;
  error?: Error;
}

/**
 * Callback function that performs the actual consumer re-registration
 */
export type ReconnectCallback = () => Promise<void>;

/**
 * ConsumerReconnectionManager handles automatic reconnection logic for RabbitMQ consumers
 *
 * When a consumer is cancelled by the server (e.g., queue deleted, connection issues),
 * this manager handles the exponential backoff retry logic to re-register the consumer.
 *
 * @example
 * ```typescript
 * const reconnectionManager = new ConsumerReconnectionManager({
 *   maxReconnectAttempts: 5,
 *   baseDelay: 5000,
 *   logger: myLogger
 * });
 *
 * // In consumer cancel handler:
 * reconnectionManager.scheduleReconnect(async () => {
 *   await this.reRegisterConsumer();
 * });
 *
 * // On successful connection:
 * reconnectionManager.reset();
 *
 * // On shutdown:
 * reconnectionManager.cancel();
 * ```
 */
export class ConsumerReconnectionManager {
  private config: Required<ConsumerReconnectionConfig>;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isReconnecting = false;

  /**
   * Create a new ConsumerReconnectionManager instance
   *
   * @param config - Reconnection configuration
   */
  constructor(config: ConsumerReconnectionConfig = {}) {
    this.config = {
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
      baseDelay: config.baseDelay ?? 5000,
      maxDelay: config.maxDelay ?? 60000,
      logger: config.logger ?? new SilentLogger(),
    };
  }

  /**
   * Schedule a consumer reconnection attempt with exponential backoff
   *
   * @param reconnectCallback - Async function that performs the actual consumer re-registration
   * @returns Promise that resolves when reconnection scheduling is complete (not when reconnection succeeds)
   */
  async scheduleReconnect(reconnectCallback: ReconnectCallback): Promise<void> {
    // Prevent multiple concurrent reconnection attempts
    if (this.reconnectTimer) {
      this.config.logger.debug('Reconnection already scheduled, skipping');
      return;
    }

    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.config.maxReconnectAttempts) {
      this.config.logger.error(
        `Max consumer reconnection attempts (${this.config.maxReconnectAttempts}) reached. Giving up.`
      );
      return;
    }

    // Calculate delay with exponential backoff
    const exponentialDelay =
      this.config.baseDelay * Math.pow(2, this.reconnectAttempts - 1);
    const delay = Math.min(exponentialDelay, this.config.maxDelay);

    this.config.logger.info(
      `Scheduling consumer reconnection attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts}`,
      { delay }
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this.isReconnecting = true;

      try {
        await reconnectCallback();

        // Successful reconnection - reset attempts counter
        this.config.logger.info('Consumer reconnected successfully');
        this.reset();
      } catch (error) {
        this.config.logger.error('Failed to reconnect consumer', error as Error);
        this.isReconnecting = false;

        // Schedule next attempt
        await this.scheduleReconnect(reconnectCallback);
      }
    }, delay);
  }

  /**
   * Reset reconnection state after a successful connection
   *
   * Call this method when a consumer successfully connects or reconnects
   * to reset the retry counter.
   */
  reset(): void {
    this.reconnectAttempts = 0;
    this.isReconnecting = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.config.logger.debug('Reconnection manager reset');
  }

  /**
   * Cancel any pending reconnection attempts
   *
   * Call this method when shutting down the consumer to prevent
   * reconnection attempts during shutdown.
   */
  cancel(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.config.logger.debug('Reconnection cancelled');
    }

    this.isReconnecting = false;
  }

  /**
   * Check if a reconnection attempt is currently in progress
   *
   * @returns true if actively attempting to reconnect
   */
  isReconnectInProgress(): boolean {
    return this.isReconnecting;
  }

  /**
   * Get the current number of reconnection attempts made
   *
   * @returns Number of reconnection attempts
   */
  getAttemptCount(): number {
    return this.reconnectAttempts;
  }

  /**
   * Check if reconnection has been scheduled
   *
   * @returns true if a reconnection is scheduled
   */
  isScheduled(): boolean {
    return this.reconnectTimer !== null;
  }
}
