/**
 * Message envelope for wrapping message data
 */
export interface MessageEnvelope<T = any> {
  id: string;
  timestamp: number;
  data: T;
  metadata?: Record<string, any>;
}

/**
 * Request envelope for RPC requests
 */
export interface RequestEnvelope<T = any> extends MessageEnvelope<T> {
  command: string;
}

/**
 * Response envelope for RPC responses
 */
export interface ResponseEnvelope<T = any> {
  id: string;
  timestamp: number;
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
    stack?: string;
  };
}

/**
 * Serializer interface for message serialization
 */
export interface Serializer {
  encode(data: any): Buffer;
  decode(buffer: Buffer): any;
}

/**
 * JSON serializer implementation
 */
export class JsonSerializer implements Serializer {
  encode(data: any): Buffer {
    return Buffer.from(JSON.stringify(data));
  }

  decode(buffer: Buffer): any {
    return JSON.parse(buffer.toString());
  }
}

/**
 * ACK/NACK strategy for reliable message handling
 */
export interface AckStrategy {
  mode: 'auto' | 'manual';
  requeue: boolean | ((error: Error, attempts: number) => boolean);
  maxRetries?: number;
  retryDelay?: number | ((attempt: number) => number);
}

/**
 * Dead Letter Queue configuration
 */
export interface DLQOptions {
  enabled: boolean;
  exchange?: string;
  routingKey?: string;
  ttl?: number;
  maxLength?: number;
  processHandler?: (msg: any) => Promise<void>;
}

/**
 * Message validation configuration
 */
export interface MessageValidationOptions {
  maxSize?: number;
  schemaValidation?: boolean;
  malformedMessageStrategy: 'reject' | 'dlq' | 'ignore';
}

/**
 * Deduplication configuration
 */
export interface DeduplicationOptions {
  enabled: boolean;
  cacheTTL: number;
  cacheSize: number;
  keyExtractor?: (msg: any) => string;
}

/**
 * Slow message detection thresholds
 */
export interface SlowThresholds {
  warn?: number;
  error?: number;
}

/**
 * Slow message context information
 */
export interface SlowMessageContext {
  command?: string;
  eventName?: string;
  duration: number;
  threshold: number;
  level: 'warn' | 'error';
  messageId?: string;
  metadata?: Record<string, any>;
}

/**
 * Slow message detection configuration
 */
export interface SlowMessageDetectionOptions {
  slowThresholds?: SlowThresholds;
  onSlowMessage?: (context: SlowMessageContext) => void;
}
