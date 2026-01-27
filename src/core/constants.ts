/**
 * Centralized constants for Hermes MQ
 *
 * This file contains all magic numbers and string constants used throughout the library.
 */

/**
 * Time intervals in milliseconds
 */
export const TIME = {
  /**
   * Default timeout for RPC requests (30 seconds)
   */
  DEFAULT_RPC_TIMEOUT_MS: 30_000,

  /**
   * Default timeout for graceful shutdown (30 seconds)
   */
  DEFAULT_SHUTDOWN_TIMEOUT_MS: 30_000,

  /**
   * Base delay for connection reconnection attempts (5 seconds)
   */
  CONNECTION_RECONNECT_BASE_DELAY_MS: 5_000,

  /**
   * Maximum delay between connection reconnection attempts (60 seconds)
   */
  CONNECTION_RECONNECT_MAX_DELAY_MS: 60_000,

  /**
   * Base delay for consumer reconnection attempts (5 seconds)
   */
  CONSUMER_RECONNECT_BASE_DELAY_MS: 5_000,

  /**
   * Maximum delay between consumer reconnection attempts (60 seconds)
   */
  CONSUMER_RECONNECT_MAX_DELAY_MS: 60_000,

  /**
   * Default channel pool acquisition timeout (5 seconds)
   */
  CHANNEL_POOL_ACQUIRE_TIMEOUT_MS: 5_000,

  /**
   * Interval for channel pool eviction (30 seconds)
   */
  CHANNEL_POOL_EVICTION_INTERVAL_MS: 30_000,

  /**
   * Maximum wait time for channel pool operations (30 seconds)
   */
  CHANNEL_POOL_MAX_WAIT_MS: 30_000,

  /**
   * Default retry policy maximum delay (30 seconds)
   */
  RETRY_MAX_DELAY_MS: 30_000,

  /**
   * Default message buffer TTL (30 seconds)
   */
  MESSAGE_BUFFER_TTL_MS: 30_000,

  /**
   * Default deduplication cache TTL (5 minutes)
   */
  DEDUPLICATION_CACHE_TTL_MS: 300_000,

  /**
   * Interval for RPC client cleanup of expired requests (30 seconds)
   */
  RPC_CLIENT_CLEANUP_INTERVAL_MS: 30_000,
} as const;

/**
 * Size limits and capacity constraints
 */
export const LIMITS = {
  /**
   * Default prefetch count for RPC Server (number of messages to prefetch)
   */
  RPC_SERVER_DEFAULT_PREFETCH: 10,

  /**
   * Default prefetch count for Subscriber (number of messages to prefetch)
   */
  SUBSCRIBER_DEFAULT_PREFETCH: 10,

  /**
   * Default deduplication cache size (number of message IDs to store)
   */
  DEDUPLICATION_CACHE_SIZE: 10_000,

  /**
   * Maximum number of consumer reconnection attempts
   */
  MAX_CONSUMER_RECONNECT_ATTEMPTS: 5,

  /**
   * Maximum number of connection reconnection attempts
   */
  MAX_CONNECTION_RECONNECT_ATTEMPTS: 5,
} as const;

/**
 * Default retry configuration values
 */
export const RETRY = {
  /**
   * Default maximum retry attempts
   */
  DEFAULT_MAX_ATTEMPTS: 3,

  /**
   * Default initial retry delay (1 second)
   */
  DEFAULT_INITIAL_DELAY_MS: 1_000,

  /**
   * Default maximum retry delay (30 seconds)
   */
  DEFAULT_MAX_DELAY_MS: 30_000,
} as const;

/**
 * ACK strategy mode constants
 */
export const ACK_MODE = {
  AUTO: 'auto',
  MANUAL: 'manual',
} as const;

/**
 * Malformed message strategy constants
 */
export const MALFORMED_MESSAGE_STRATEGY = {
  REJECT: 'reject',
  DLQ: 'dlq',
  IGNORE: 'ignore',
} as const;

/**
 * Exchange type constants
 */
export const EXCHANGE_TYPE = {
  TOPIC: 'topic',
  FANOUT: 'fanout',
  DIRECT: 'direct',
} as const;

/**
 * Confirm mode constants
 */
export const CONFIRM_MODE = {
  SYNC: 'sync',
  ASYNC: 'async',
} as const;
