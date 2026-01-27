/**
 * @hermes/core - Core utilities and types for Hermes MQ
 */

// Connection Management
export { ConnectionManager } from './connection/ConnectionManager';
export type { ConnectionConfig, QueueAssertionOptions } from './connection/ConnectionManager';

// Channel Pool
export { ChannelPool } from './connection/ChannelPool';
export type { ChannelPoolConfig } from './connection/ChannelPool';

// Message Utilities
export { MessageParser } from './message/MessageParser';
export type { ParseResult } from './message/MessageParser';
export { MessageBuffer } from './message/MessageBuffer';
export type { MessageBufferOptions } from './message/MessageBuffer';
export { MessageDeduplicator } from './message/MessageDeduplicator';
export type { DeduplicationResult } from './message/MessageDeduplicator';

// Retry Policy
export { RetryPolicy } from './retry/RetryPolicy';
export type { RetryConfig } from './retry/RetryPolicy';

// Types
export type {
  MessageEnvelope,
  RequestEnvelope,
  ResponseEnvelope,
  Serializer,
  AckStrategy,
  DLQOptions,
  MessageValidationOptions,
  DeduplicationOptions,
  SlowThresholds,
  SlowMessageContext,
  SlowMessageDetectionOptions,
} from './types/Messages';

export { JsonSerializer } from './types/Messages';

export type { Logger } from './types/Logger';
export { SilentLogger, ConsoleLogger } from './types/Logger';

// AMQP Types
export type {
  ConnectionWithConfirm,
  ExtendedError,
  ChannelWithConnection,
  ExtendedConfirmChannel,
} from './types/Amqp';

export {
  isConnectionWithConfirm,
  isExtendedError,
  asConnectionWithConfirm,
  asChannelWithConnection,
  asExtendedConfirmChannel,
} from './types/Amqp';

// Errors
export {
  HermesError,
  ConnectionError,
  ChannelError,
  TimeoutError,
  ValidationError,
  MessageValidationError,
  MessageParsingError,
  StateError,
  RetryExhaustedError,
} from './types/Errors';

// Health Check
export { HealthChecker } from './health/HealthChecker';
export type {
  HealthCheckerConfig,
  HealthCheckResult,
  HealthStatus,
  ConnectionHealth,
  ChannelHealth,
  ConsumerHealth,
} from './health/HealthChecker';

// Metrics
export { MetricsCollector } from './metrics/MetricsCollector';
export type { Labels, MetricType, HistogramConfig } from './metrics/MetricsCollector';

// Utils
export { ConsumerReconnectionManager } from './utils/ConsumerReconnectionManager';
export type {
  ConsumerReconnectionConfig,
  ReconnectionResult,
  ReconnectCallback,
} from './utils/ConsumerReconnectionManager';

// Constants
export {
  TIME,
  LIMITS,
  RETRY,
  ACK_MODE,
  MALFORMED_MESSAGE_STRATEGY,
  EXCHANGE_TYPE,
  CONFIRM_MODE,
} from './constants';
