/**
 * Hermes MQ - Modern RabbitMQ Client for Node.js
 *
 * A production-ready RabbitMQ client library with RPC and Pub/Sub patterns.
 * Features connection pooling, automatic reconnection, request timeouts, and TypeScript support.
 *
 * @packageDocumentation
 */

// ============================================================================
// CORE - Connection Management, Retry Logic, Types, Errors
// ============================================================================

/**
 * Core utilities for connection management and error handling
 */
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
  HealthChecker,
  MetricsCollector,
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
  HealthCheckerConfig,
  HealthCheckResult,
  HealthStatus,
  ConnectionHealth,
  ChannelHealth,
  ConsumerHealth,
  Labels,
  MetricType,
  HistogramConfig,
} from './core';

// ============================================================================
// CLIENT - RPC Client & Publisher
// ============================================================================

/**
 * Client components for making RPC calls and publishing events
 */
export { RpcClient, Publisher } from './client';
export type { RpcClientConfig, PublisherConfig } from './client';

// ============================================================================
// SERVER - RPC Server & Subscriber
// ============================================================================

/**
 * Server components for handling RPC requests and subscribing to events
 */
export { RpcServer, Subscriber } from './server';
export type { RpcServerConfig, SubscriberConfig, EventHandler } from './server';
