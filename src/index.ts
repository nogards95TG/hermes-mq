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
// MIDDLEWARE - Express/Koa-like middleware system
// ============================================================================

/**
 * Middleware system for request/response handling
 */
export {
  compose,
  createContext,
  validate,
  validateAdapter,
  retry,
} from './middleware';

export type {
  RpcContext,
  Middleware,
  Handler,
  ComposedMiddleware,
  ValidateAdapter,
  ValidationResult,
  ValidationErrorResponse,
  RetryPolicyOptions,
} from './middleware';

// ============================================================================
// CLIENT - RPC Client & Publisher
// ============================================================================

/**
 * Client components for making RPC calls and publishing events
 */
export { RpcClient, Publisher } from './client';
export type { RpcClientConfig, PublisherConfig, ClientMiddleware } from './client';

// ============================================================================
// SERVER - RPC Server & Subscriber
// ============================================================================

/**
 * Server components for handling RPC requests and subscribing to events
 */
export { RpcServer, Subscriber } from './server';
export type { RpcServerConfig, SubscriberConfig, EventHandler } from './server';
