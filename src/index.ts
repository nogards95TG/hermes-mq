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

/**
 * Middleware system for processing messages through pipelines
 */
export type { MessageContext, Middleware, Handler } from './core';
export { compose } from './core';
export { isHandler, isMiddleware } from './core';

/**
 * Client components for making RPC calls and publishing events
 */
export { RpcClient, Publisher } from './client';
export type { RpcClientConfig, PublisherConfig } from './client';

/**
 * Server components for handling RPC requests and subscribing to events
 */
export { RpcServer, Subscriber } from './server';
export type { RpcServerConfig, SubscriberConfig, EventHandler } from './server';
