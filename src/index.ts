/**
 * Hermes MQ - Modern RabbitMQ Client for Node.js
 * 
 * A production-ready RabbitMQ client library with RPC and Pub/Sub patterns.
 * Features connection pooling, automatic reconnection, request timeouts, and TypeScript support.
 */

// ============================================================================
// CORE - Connection Management, Retry Logic, Types, Errors
// ============================================================================

export {
  ConnectionManager,
  ChannelPool,
  RetryPolicy,
  JsonSerializer,
  SilentLogger,
  ConsoleLogger,
  HermesError,
  ConnectionError,
  ChannelError,
  TimeoutError,
  ValidationError,
} from './core';

export type {
  ConnectionConfig,
  ChannelPoolConfig,
  RetryConfig,
  MessageEnvelope,
  RequestEnvelope,
  ResponseEnvelope,
  Serializer,
  Logger,
} from './core';

// ============================================================================
// CLIENT - RPC Client & Publisher
// ============================================================================

export { RpcClient, Publisher } from './client';
export type { RpcClientConfig, PublisherConfig } from './client';

// ============================================================================
// SERVER - RPC Server & Subscriber
// ============================================================================

export { RpcServer, Subscriber } from './server';
export type { RpcServerConfig, SubscriberConfig, EventHandler } from './server';
