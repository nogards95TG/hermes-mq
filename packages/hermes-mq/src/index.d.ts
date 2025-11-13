// Type definitions for hermes-mq
// This file manually re-exports all types from the sub-packages

// Core types
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

export {
  ConnectionManager,
  ChannelPool,
  RetryPolicy,
  HermesError,
  ConnectionError,
  TimeoutError,
  ChannelError,
  ValidationError,
  SilentLogger,
  ConsoleLogger,
  JsonSerializer,
} from '@hermes/core';

// Client types
export type {
  RpcClientConfig,
  PublisherConfig,
} from '@hermes/client';

export {
  RpcClient,
  Publisher,
} from '@hermes/client';

// Server types
export type {
  RpcServerConfig,
} from '@hermes/server';

export {
  RpcServer,
} from '@hermes/server';
