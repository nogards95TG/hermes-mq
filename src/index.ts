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

// ============================================================================
// CONTRACT - Type-Safe RPC with Validation
// ============================================================================

/**
 * Contract-based type-safe RPC with automatic validation
 */
export { defineContract } from './core/contract/Contract';
export { v } from './core/contract/validators';
export { createContractServer } from './server/rpc/ContractRpcServer';
export { createContractClient } from './client/rpc/ContractRpcClient';

export type {
  Contract,
  CommandDefinition,
  InferRequest,
  InferResponse,
} from './core/contract/Contract';

export type {
  Validator,
  ValidationResult,
  ValidationError as ContractValidationError,
  Infer,
} from './core/contract/Validator';

export type {
  StringValidator,
  NumberValidator,
  BooleanValidator,
  DateValidator,
  AnyValidator,
  ObjectValidator,
  ArrayValidator,
} from './core/contract/validators';
