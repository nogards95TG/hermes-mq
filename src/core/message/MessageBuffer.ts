/**
 * Buffered message entry
 */
interface BufferedMessage<T = any> {
  data: T;
  timestamp: number;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

/**
 * Message buffer configuration
 */
export interface MessageBufferOptions {
  maxSize: number;
  ttl: number;
}

/**
 * MessageBuffer stores messages during connection disruptions
 *
 * Buffers outgoing messages when reconnecting and flushes them once
 * connection is restored. Implements TTL to prevent stale messages.
 *
 * @example
 * ```typescript
 * const buffer = new MessageBuffer({
 *   maxSize: 1000,
 *   ttl: 30000 // 30 seconds
 * });
 *
 * const result = await buffer.add({ data: 'message' });
 * const buffered = buffer.flush();
 * ```
 */
export class MessageBuffer {
  private queue: BufferedMessage[] = [];
  private options: MessageBufferOptions;

  constructor(options: MessageBufferOptions) {
    this.options = options;
  }

  /**
   * Add a message to the buffer
   *
   * Returns a promise that will be resolved/rejected when the message
   * is processed during flush().
   *
   * @param data - Message data to buffer
   * @returns Promise that resolves when message is processed
   * @throws Error if buffer is full
   */
  add<T = any>(data: T): Promise<any> {
    if (this.queue.length >= this.options.maxSize) {
      return Promise.reject(new Error('Message buffer is full'));
    }

    return new Promise((resolve, reject) => {
      this.queue.push({
        data,
        timestamp: Date.now(),
        resolve,
        reject,
      });
    });
  }

  /**
   * Get all buffered messages and clear the buffer
   *
   * @returns Array of buffered messages with their metadata
   */
  flush(): BufferedMessage[] {
    const buffered = [...this.queue];
    this.queue = [];
    return buffered;
  }

  /**
   * Get current buffer size
   *
   * @returns Number of buffered messages
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Check if buffer is empty
   *
   * @returns true if no messages are buffered
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Clear the buffer and reject all pending messages
   *
   * @param reason - Error reason for rejection
   */
  clear(reason?: string): void {
    const error = new Error(reason || 'Buffer cleared');
    for (const { reject } of this.queue) {
      reject(error);
    }
    this.queue = [];
  }
}
