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

// Errors
export {
  HermesError,
  ConnectionError,
  ChannelError,
  TimeoutError,
  ValidationError,
  MessageValidationError,
  MessageParsingError,
} from './types/Errors';
