import { Message } from 'amqplib';
import { createHash } from 'crypto';
import { DeduplicationOptions } from '../types/Messages';

/**
 * Simple LRU Cache implementation for deduplication
 */
class LRUCache<K, V> {
  private cache: Map<K, { value: V; timestamp: number }>;
  private readonly maxSize: number;
  private readonly ttl: number;

  constructor(maxSize: number, ttl: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  /**
   * Get value from cache, handling expiration
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Set value in cache
   */
  set(key: K, value: V): void {
    // Remove if exists
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Add new entry
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });

    // Evict oldest if size exceeded
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value as K;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get current size
   */
  size(): number {
    return this.cache.size;
  }
}

/**
 * Result of deduplication processing
 */
export interface DeduplicationResult<T = any> {
  duplicate: boolean;
  result?: T;
}

/**
 * MessageDeduplicator prevents processing of duplicate messages
 *
 * Uses an LRU cache to track recently processed message IDs.
 * Messages with previously seen IDs are skipped and the cached
 * result is returned instead.
 *
 * @example
 * ```typescript
 * const deduplicator = new MessageDeduplicator({
 *   enabled: true,
 *   cacheTTL: 300000, // 5 minutes
 *   cacheSize: 10000
 * });
 *
 * const result = await deduplicator.process(msg, async () => {
 *   return await handler(msg);
 * });
 *
 * if (result.duplicate) {
 *   console.log('Skipped duplicate message');
 * }
 * ```
 */
export class MessageDeduplicator {
  private cache: LRUCache<string, any>;
  private options: DeduplicationOptions;

  constructor(options: DeduplicationOptions) {
    this.options = options;
    this.cache = new LRUCache(options.cacheSize, options.cacheTTL);
  }

  /**
   * Process a message with deduplication
   *
   * @param msg - AMQP message
   * @param handler - Handler to execute for new messages
   * @returns Deduplication result with duplicate flag and result
   */
  async process<T = any>(msg: Message, handler: () => Promise<T>): Promise<DeduplicationResult<T>> {
    if (!this.options.enabled) {
      // Bypass deduplication
      return {
        duplicate: false,
        result: await handler(),
      };
    }

    const key = this.extractKey(msg);

    // Check cache for duplicate
    if (this.cache.has(key)) {
      return {
        duplicate: true,
        result: this.cache.get(key),
      };
    }

    // Process new message
    const result = await handler();

    // Cache result
    this.cache.set(key, result);

    return {
      duplicate: false,
      result,
    };
  }

  /**
   * Extract deduplication key from message
   */
  private extractKey(msg: Message): string {
    if (this.options.keyExtractor) {
      try {
        const data = JSON.parse(msg.content.toString());
        return this.options.keyExtractor(data);
      } catch (parseError) {
        // If parsing fails, fall back to default key extraction
        return msg.properties.messageId || this.hashContent(msg.content);
      }
    }

    // Default: use messageId or create hash from content
    if (msg.properties.messageId) {
      return msg.properties.messageId;
    }

    return this.hashContent(msg.content);
  }

  /**
   * Cryptographically secure hash of message content using SHA-256
   */
  private hashContent(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Clear the deduplication cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      cacheSize: this.cache.size(),
      maxCacheSize: this.options.cacheSize,
      cacheTTL: this.options.cacheTTL,
    };
  }
}
