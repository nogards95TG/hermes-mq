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
