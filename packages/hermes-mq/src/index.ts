// Re-export everything from core, client, and server packages
// This creates a unified API surface

// Note: We import from the built packages to avoid TypeScript compilation issues
// with monorepo structure. This requires packages to be built before this package.

// Core exports
export {
  // Connection Management
  ConnectionManager,
  ChannelPool,

  // Retry Logic
  RetryPolicy,

  // Error Types
  HermesError,
  ConnectionError,
  TimeoutError,
  ChannelError,
  ValidationError,

  // Logger
  SilentLogger,
  ConsoleLogger,

  // Serializer
  JsonSerializer,
} from '@hermes/core';

export type {
  Logger,
  Serializer,
  ConnectionConfig,
  ChannelPoolConfig,
  RetryConfig,
  MessageEnvelope,
  RequestEnvelope,
  ResponseEnvelope,
} from '@hermes/core';

// Client exports
export {
  // RPC Client
  RpcClient,

  // Publisher
  Publisher,
} from '@hermes/client';

export type { RpcClientConfig, PublisherConfig } from '@hermes/client';

// Server exports
export {
  // RPC Server
  RpcServer,
} from '@hermes/server';

export type { RpcServerConfig } from '@hermes/server';
