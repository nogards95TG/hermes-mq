import { EventEmitter } from 'node:events';
import type { DebugEvent, DebugMessage, DebugServiceInfo } from './types';

/**
 * Debug Event Emitter
 *
 * Lightweight bridge between Hermes MQ components (RPC, Pub/Sub) and the DebugServer.
 * Each service instance (RpcClient, RpcServer, Publisher, Subscriber) creates its own
 * DebugEmitter to track and report events without coupling to the debug infrastructure.
 *
 * @example
 * ```typescript
 * // Create an emitter for a service
 * const emitter = new DebugEmitter('rpc-client-user-service');
 *
 * // Connect to debug server
 * emitter.on('debug-event', (event) => {
 *   debugServer.onEvent(event);
 * });
 *
 * // Emit events during operation
 * emitter.emitMessageReceived({
 *   id: 'msg-123',
 *   type: 'rpc-request',
 *   queue: 'user.service',
 *   command: 'user.create',
 *   correlationId: 'corr-456',
 *   payload: { name: 'John' }
 * });
 *
 * // Cleanup when service stops
 * emitter.destroy();
 * ```
 *
 * @remarks
 * - Each emitter has a max listener limit of 10 to prevent memory leaks
 * - Call `destroy()` when the service shuts down to clean up resources
 * - The emitter is safe to use after destruction (events are silently ignored)
 *
 * @public
 */
export class DebugEmitter extends EventEmitter {
  private serviceId: string;
  private isDestroyed = false;

  /**
   * Creates a new DebugEmitter instance
   *
   * @param serviceId - Unique identifier for the service (e.g., 'rpc-client-user-service')
   *
   * @example
   * ```typescript
   * const emitter = new DebugEmitter('rpc-server-orders');
   * ```
   */
  constructor(serviceId: string) {
    super();
    this.serviceId = serviceId;
    // Prevent memory leaks - set max listeners to reasonable value
    this.setMaxListeners(10);
  }

  /**
   * Cleanup resources and remove all event listeners
   *
   * Call this method when the service is shutting down to prevent memory leaks.
   * After calling destroy(), the emitter will silently ignore all emit calls.
   * This method is idempotent - safe to call multiple times.
   *
   * @example
   * ```typescript
   * // Service shutdown
   * await rpcClient.stop();
   * emitter.destroy(); // Cleanup debug resources
   * ```
   *
   * @public
   */
  destroy(): void {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;
    this.removeAllListeners();
  }

  /**
   * Check if the emitter is active (not destroyed)
   *
   * @returns `true` if the emitter is active, `false` if destroyed
   *
   * @example
   * ```typescript
   * if (emitter.isActive()) {
   *   emitter.emitMessageReceived(data);
   * }
   * ```
   *
   * @public
   */
  isActive(): boolean {
    return !this.isDestroyed;
  }

  /**
   * Emit a message received event
   *
   * Call this when a message is received from the message queue but before processing.
   * Useful for tracking incoming requests and debugging message flow.
   *
   * @param data - Message received data
   * @param data.id - Unique message identifier
   * @param data.type - Type of message (rpc-request, rpc-response, pubsub-publish, pubsub-consume)
   * @param data.queue - Queue or exchange name
   * @param data.command - Command or pattern name
   * @param data.correlationId - Correlation ID for request/response matching
   * @param data.payload - Message payload
   * @param data.metadata - Optional metadata
   *
   * @example
   * ```typescript
   * // In RpcServer, when receiving a request
   * emitter.emitMessageReceived({
   *   id: 'msg-123',
   *   type: 'rpc-request',
   *   queue: 'user.service',
   *   command: 'user.create',
   *   correlationId: msg.properties.correlationId,
   *   payload: JSON.parse(msg.content.toString())
   * });
   * ```
   *
   * @public
   */
  emitMessageReceived(data: {
    id: string;
    type: DebugMessage['type'];
    queue: string;
    command: string;
    correlationId: string;
    payload: unknown;
    metadata?: Record<string, unknown>;
  }): void {
    if (this.isDestroyed) {
      return;
    }
    this.emitEvent('message:received', data);
  }

  /**
   * Emit a message success event
   *
   * Call this when a message has been processed successfully.
   * Records the processing duration and optional response for performance tracking.
   *
   * @param data - Message success data
   * @param data.id - Message identifier (same as in emitMessageReceived)
   * @param data.command - Command name
   * @param data.duration - Processing duration in milliseconds
   * @param data.response - Optional response payload
   *
   * @example
   * ```typescript
   * const startTime = Date.now();
   * const result = await handleUserCreate(payload);
   *
   * emitter.emitMessageSuccess({
   *   id: 'msg-123',
   *   command: 'user.create',
   *   duration: Date.now() - startTime,
   *   response: result
   * });
   * ```
   *
   * @public
   */
  emitMessageSuccess(data: {
    id: string;
    command: string;
    duration: number;
    response?: unknown;
  }): void {
    if (this.isDestroyed) {
      return;
    }
    this.emitEvent('message:success', data);
  }

  /**
   * Emit a message error event
   *
   * Call this when message processing fails with an error.
   * Captures error details including stack trace for debugging.
   *
   * @param data - Message error data
   * @param data.id - Message identifier
   * @param data.command - Command name
   * @param data.duration - Processing duration before error (milliseconds)
   * @param data.error - Error details
   * @param data.error.code - Error code
   * @param data.error.message - Error message
   * @param data.error.stack - Optional stack trace
   * @param data.error.context - Optional additional context
   *
   * @example
   * ```typescript
   * try {
   *   await handleUserCreate(payload);
   * } catch (error) {
   *   emitter.emitMessageError({
   *     id: 'msg-123',
   *     command: 'user.create',
   *     duration: Date.now() - startTime,
   *     error: {
   *       code: error.code || 'UNKNOWN',
   *       message: error.message,
   *       stack: error.stack,
   *       context: { userId: payload.id }
   *     }
   *   });
   * }
   * ```
   *
   * @public
   */
  emitMessageError(data: {
    id: string;
    command: string;
    duration: number;
    error: {
      code: string;
      message: string;
      stack?: string;
      context?: Record<string, unknown>;
    };
  }): void {
    if (this.isDestroyed) {
      return;
    }
    this.emitEvent('message:error', data);
  }

  /**
   * Emit a message timeout event
   *
   * Call this when a message processing exceeds the timeout threshold.
   * Useful for identifying slow operations and performance bottlenecks.
   *
   * @param data - Message timeout data
   * @param data.id - Message identifier
   * @param data.command - Command name
   * @param data.duration - Duration before timeout (milliseconds)
   *
   * @example
   * ```typescript
   * // In RpcClient, when request times out
   * emitter.emitMessageTimeout({
   *   id: 'msg-123',
   *   command: 'user.create',
   *   duration: 5000 // Timeout threshold
   * });
   * ```
   *
   * @public
   */
  emitMessageTimeout(data: {
    id: string;
    command: string;
    duration: number;
  }): void {
    if (this.isDestroyed) {
      return;
    }
    this.emitEvent('message:timeout', data);
  }

  /**
   * Emit a connection connected event
   *
   * Call this when the service successfully connects to RabbitMQ.
   *
   * @param data - Connection data
   * @param data.url - RabbitMQ connection URL
   * @param data.message - Optional connection message
   *
   * @example
   * ```typescript
   * emitter.emitConnectionConnected({
   *   url: 'amqp://localhost:5672',
   *   message: 'Connected successfully'
   * });
   * ```
   *
   * @public
   */
  emitConnectionConnected(data: {
    url: string;
    message?: string;
  }): void {
    if (this.isDestroyed) {
      return;
    }
    this.emitEvent('connection:connected', data);
  }

  /**
   * Emit a connection disconnected event
   *
   * Call this when the service disconnects from RabbitMQ.
   *
   * @param data - Disconnection data
   * @param data.message - Optional disconnection message
   *
   * @example
   * ```typescript
   * emitter.emitConnectionDisconnected({
   *   message: 'Connection closed gracefully'
   * });
   * ```
   *
   * @public
   */
  emitConnectionDisconnected(data: {
    message?: string;
  }): void {
    if (this.isDestroyed) {
      return;
    }
    this.emitEvent('connection:disconnected', data);
  }

  /**
   * Emit a connection error event
   *
   * Call this when a connection error occurs.
   *
   * @param data - Connection error data
   * @param data.error - Error object
   * @param data.message - Optional error context message
   *
   * @example
   * ```typescript
   * emitter.emitConnectionError({
   *   error: new Error('Connection refused'),
   *   message: 'Failed to connect to RabbitMQ'
   * });
   * ```
   *
   * @public
   */
  emitConnectionError(data: {
    error: Error;
    message?: string;
  }): void {
    if (this.isDestroyed) {
      return;
    }
    this.emitEvent('connection:error', data);
  }

  /**
   * Emit a service started event
   *
   * Call this when a service (RPC, Pub/Sub) starts successfully.
   *
   * @param service - Service information
   *
   * @example
   * ```typescript
   * emitter.emitServiceStarted({
   *   id: 'rpc-server-users',
   *   type: 'rpc-server',
   *   name: 'users',
   *   status: 'active',
   *   startedAt: new Date(),
   *   messageCount: 0
   * });
   * ```
   *
   * @public
   */
  emitServiceStarted(service: DebugServiceInfo): void {
    if (this.isDestroyed) {
      return;
    }
    this.emitEvent('service:started', service);
  }

  /**
   * Emit a service stopped event
   *
   * Call this when a service stops or shuts down.
   *
   * @param serviceId - Service identifier
   *
   * @example
   * ```typescript
   * emitter.emitServiceStopped('rpc-server-users');
   * ```
   *
   * @public
   */
  emitServiceStopped(serviceId: string): void {
    if (this.isDestroyed) {
      return;
    }
    this.emitEvent('service:stopped', { id: serviceId });
  }

  /**
   * Generic event emission with error handling
   *
   * Internal method that wraps all events with consistent structure
   * and prevents errors from crashing the application.
   *
   * @param type - Event type
   * @param data - Event data
   *
   * @internal
   */
  private emitEvent(type: DebugEvent['type'], data: unknown): void {
    if (this.isDestroyed) {
      return;
    }

    try {
      const event: DebugEvent = {
        type,
        timestamp: new Date(),
        serviceId: this.serviceId,
        data,
      };

      this.emit('debug-event', event);
    } catch (error) {
      // Prevent emission errors from crashing the application
      console.error('[DebugEmitter] Failed to emit event:', error);
    }
  }
}
