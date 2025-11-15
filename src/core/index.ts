/**
 * @hermes/core - Core utilities and types for Hermes MQ
 */

// Connection Management
export { ConnectionManager } from './connection/ConnectionManager';
export type { ConnectionConfig } from './connection/ConnectionManager';

// Channel Pool
export { ChannelPool } from './connection/ChannelPool';
export type { ChannelPoolConfig } from './connection/ChannelPool';

// Retry Policy
export { RetryPolicy } from './retry/RetryPolicy';
export type { RetryConfig } from './retry/RetryPolicy';

// Types
export type {
  MessageEnvelope,
  RequestEnvelope,
  ResponseEnvelope,
  Serializer,
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
} from './types/Errors';
export { TransientError, PermanentError, isTransientError } from './types/Errors';

// Middleware
export type { MessageContext, Middleware, Handler } from './middleware/types';
export { compose } from './middleware/compose';
export { isHandler, isMiddleware } from './middleware/guards';
export { getXDeathCount } from './utils/xDeath';
