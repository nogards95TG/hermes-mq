import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageDeduplicator } from '../../src/core/message/MessageDeduplicator';
import { Message } from 'amqplib';
import { createMockMessage } from '../helpers/Message';

describe('MessageDeduplicator', () => {
  let deduplicator: MessageDeduplicator;

  beforeEach(() => {
    deduplicator = new MessageDeduplicator({
      enabled: true,
      cacheTTL: 10000,
      cacheSize: 100,
    });
  });

  describe('constructor', () => {
    it('should create a deduplicator with the specified options', () => {
      expect(deduplicator).toBeDefined();
      const stats = deduplicator.getStats();
      expect(stats.maxCacheSize).toBe(100);
      expect(stats.cacheTTL).toBe(10000);
    });
  });

  describe('process - when enabled', () => {
    it('should process a new message and cache the result', async () => {
      const msg = createMockMessage({ data: 'test' }, 'msg-1');
      const handler = vi.fn().mockResolvedValue('handler-result');

      const result = await deduplicator.process(msg, handler);

      expect(result.duplicate).toBe(false);
      expect(result.result).toBe('handler-result');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should detect duplicate messages with same messageId', async () => {
      const msg1 = createMockMessage({ data: 'test' }, 'msg-1');
      const msg2 = createMockMessage({ data: 'different' }, 'msg-1');
      const handler = vi.fn().mockResolvedValue('handler-result');

      // First call - process normally
      const result1 = await deduplicator.process(msg1, handler);
      expect(result1.duplicate).toBe(false);
      expect(result1.result).toBe('handler-result');
      expect(handler).toHaveBeenCalledTimes(1);

      // Second call - should be detected as duplicate
      const result2 = await deduplicator.process(msg2, handler);
      expect(result2.duplicate).toBe(true);
      expect(result2.result).toBe('handler-result');
      expect(handler).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should use content hash when messageId is not provided', async () => {
      const msg1 = createMockMessage({ data: 'test' });
      const msg2 = createMockMessage({ data: 'test' }); // Same content
      const handler = vi.fn().mockResolvedValue('result');

      const result1 = await deduplicator.process(msg1, handler);
      expect(result1.duplicate).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);

      const result2 = await deduplicator.process(msg2, handler);
      expect(result2.duplicate).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should process messages with different content separately', async () => {
      const msg1 = createMockMessage({ data: 'test1' });
      const msg2 = createMockMessage({ data: 'test2' });
      const handler = vi.fn().mockResolvedValue('result');

      const result1 = await deduplicator.process(msg1, handler);
      expect(result1.duplicate).toBe(false);

      const result2 = await deduplicator.process(msg2, handler);
      expect(result2.duplicate).toBe(false);
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should cache different results for different messages', async () => {
      const msg1 = createMockMessage({ data: 'test1' }, 'msg-1');
      const msg2 = createMockMessage({ data: 'test2' }, 'msg-2');
      const handler1 = vi.fn().mockResolvedValue('result-1');
      const handler2 = vi.fn().mockResolvedValue('result-2');

      const result1 = await deduplicator.process(msg1, handler1);
      const result2 = await deduplicator.process(msg2, handler2);

      expect(result1.result).toBe('result-1');
      expect(result2.result).toBe('result-2');

      // Check cached results
      const cached1 = await deduplicator.process(msg1, vi.fn());
      const cached2 = await deduplicator.process(msg2, vi.fn());

      expect(cached1.duplicate).toBe(true);
      expect(cached1.result).toBe('result-1');
      expect(cached2.duplicate).toBe(true);
      expect(cached2.result).toBe('result-2');
    });
  });

  describe('process - when disabled', () => {
    beforeEach(() => {
      deduplicator = new MessageDeduplicator({
        enabled: false,
        cacheTTL: 10000,
        cacheSize: 100,
      });
    });

    it('should always process messages without deduplication', async () => {
      const msg = createMockMessage({ data: 'test' }, 'msg-1');
      const handler = vi.fn().mockResolvedValue('result');

      const result1 = await deduplicator.process(msg, handler);
      const result2 = await deduplicator.process(msg, handler);

      expect(result1.duplicate).toBe(false);
      expect(result2.duplicate).toBe(false);
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('custom keyExtractor', () => {
    it('should use custom key extractor when provided', async () => {
      deduplicator = new MessageDeduplicator({
        enabled: true,
        cacheTTL: 10000,
        cacheSize: 100,
        keyExtractor: (data) => data.customId,
      });

      const msg1 = createMockMessage({ customId: 'abc123', data: 'test' });
      const msg2 = createMockMessage({ customId: 'abc123', data: 'different' });
      const handler = vi.fn().mockResolvedValue('result');

      const result1 = await deduplicator.process(msg1, handler);
      expect(result1.duplicate).toBe(false);

      const result2 = await deduplicator.process(msg2, handler);
      expect(result2.duplicate).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should fallback to default key extraction if custom extractor fails', async () => {
      deduplicator = new MessageDeduplicator({
        enabled: true,
        cacheTTL: 10000,
        cacheSize: 100,
        keyExtractor: (data) => data.missingField.id, // Will throw
      });

      const msg = createMockMessage('invalid json content', 'msg-1');
      const handler = vi.fn().mockResolvedValue('result');

      const result = await deduplicator.process(msg, handler);

      expect(result.duplicate).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should fallback to messageId when keyExtractor fails on valid JSON', async () => {
      deduplicator = new MessageDeduplicator({
        enabled: true,
        cacheTTL: 10000,
        cacheSize: 100,
        keyExtractor: (data) => {
          throw new Error('Extractor error');
        },
      });

      const msg = createMockMessage({ data: 'test' }, 'msg-1');
      const handler = vi.fn().mockResolvedValue('result');

      // Should not throw and use fallback
      const result = await deduplicator.process(msg, handler);
      expect(result.duplicate).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear the cache', async () => {
      const msg = createMockMessage({ data: 'test' }, 'msg-1');
      const handler = vi.fn().mockResolvedValue('result');

      // Add to cache
      await deduplicator.process(msg, handler);
      expect(handler).toHaveBeenCalledTimes(1);

      // Clear cache
      deduplicator.clear();

      // Should process again
      await deduplicator.process(msg, handler);
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should reset cache size to 0', async () => {
      const msg = createMockMessage({ data: 'test' }, 'msg-1');
      await deduplicator.process(msg, vi.fn().mockResolvedValue('result'));

      expect(deduplicator.getStats().cacheSize).toBe(1);

      deduplicator.clear();

      expect(deduplicator.getStats().cacheSize).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return current cache statistics', () => {
      const stats = deduplicator.getStats();

      expect(stats).toHaveProperty('cacheSize');
      expect(stats).toHaveProperty('maxCacheSize');
      expect(stats).toHaveProperty('cacheTTL');
      expect(stats.maxCacheSize).toBe(100);
      expect(stats.cacheTTL).toBe(10000);
    });

    it('should reflect actual cache size', async () => {
      const msg1 = createMockMessage({ data: 'test1' }, 'msg-1');
      const msg2 = createMockMessage({ data: 'test2' }, 'msg-2');
      const handler = vi.fn().mockResolvedValue('result');

      expect(deduplicator.getStats().cacheSize).toBe(0);

      await deduplicator.process(msg1, handler);
      expect(deduplicator.getStats().cacheSize).toBe(1);

      await deduplicator.process(msg2, handler);
      expect(deduplicator.getStats().cacheSize).toBe(2);
    });
  });

  describe('LRU Cache behavior', () => {
    it('should evict oldest entries when cache is full', async () => {
      deduplicator = new MessageDeduplicator({
        enabled: true,
        cacheTTL: 10000,
        cacheSize: 2, // Small cache
      });

      const msg1 = createMockMessage({ data: 'test1' }, 'msg-1');
      const msg2 = createMockMessage({ data: 'test2' }, 'msg-2');
      const msg3 = createMockMessage({ data: 'test3' }, 'msg-3');
      const handler = vi.fn().mockResolvedValue('result');

      // Fill cache
      await deduplicator.process(msg1, handler);
      await deduplicator.process(msg2, handler);
      expect(deduplicator.getStats().cacheSize).toBe(2);

      // Add third item - should evict first
      await deduplicator.process(msg3, handler);
      expect(deduplicator.getStats().cacheSize).toBe(2);

      // msg1 should be evicted, so it will be processed again
      handler.mockClear();
      const result1 = await deduplicator.process(msg1, handler);
      expect(result1.duplicate).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);

      // msg2 should also be evicted (cache size is 2, has msg1 and msg3 now)
      handler.mockClear();
      const result2 = await deduplicator.process(msg2, handler);
      expect(result2.duplicate).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle TTL expiration', async () => {
      deduplicator = new MessageDeduplicator({
        enabled: true,
        cacheTTL: 50, // Very short TTL
        cacheSize: 100,
      });

      const msg = createMockMessage({ data: 'test' }, 'msg-1');
      const handler = vi.fn().mockResolvedValue('result');

      // Process message
      await deduplicator.process(msg, handler);
      expect(handler).toHaveBeenCalledTimes(1);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should process again due to TTL expiration
      await deduplicator.process(msg, handler);
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should refresh entry position when accessed', async () => {
      deduplicator = new MessageDeduplicator({
        enabled: true,
        cacheTTL: 10000,
        cacheSize: 2,
      });

      const msg1 = createMockMessage({ data: 'test1' }, 'msg-1');
      const msg2 = createMockMessage({ data: 'test2' }, 'msg-2');
      const msg3 = createMockMessage({ data: 'test3' }, 'msg-3');
      const handler = vi.fn().mockResolvedValue('result');

      // Fill cache
      await deduplicator.process(msg1, handler);
      await deduplicator.process(msg2, handler);

      // Access msg1 again (should move it to most recent)
      await deduplicator.process(msg1, handler);

      // Add msg3 - should evict msg2 (oldest), not msg1
      await deduplicator.process(msg3, handler);

      // msg1 should still be cached
      handler.mockClear();
      const result1 = await deduplicator.process(msg1, handler);
      expect(result1.duplicate).toBe(true);
      expect(handler).not.toHaveBeenCalled();

      // msg2 should be evicted
      const result2 = await deduplicator.process(msg2, handler);
      expect(result2.duplicate).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('content hashing', () => {
    it('should generate same hash for identical content', async () => {
      const content = { data: 'test', timestamp: 12345 };
      const msg1 = createMockMessage(content);
      const msg2 = createMockMessage(content);
      const handler = vi.fn().mockResolvedValue('result');

      await deduplicator.process(msg1, handler);
      expect(handler).toHaveBeenCalledTimes(1);

      await deduplicator.process(msg2, handler);
      expect(handler).toHaveBeenCalledTimes(1); // Not called again - duplicate
    });

    it('should generate different hashes for different content', async () => {
      const msg1 = createMockMessage({ data: 'test1' });
      const msg2 = createMockMessage({ data: 'test2' });
      const handler = vi.fn().mockResolvedValue('result');

      await deduplicator.process(msg1, handler);
      await deduplicator.process(msg2, handler);

      expect(handler).toHaveBeenCalledTimes(2); // Both processed
    });

    it('should handle binary content hashing', async () => {
      const buffer1 = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const buffer2 = Buffer.from([0x01, 0x02, 0x03, 0x04]);

      const msg1 = {
        content: buffer1,
        properties: {},
        fields: {
          deliveryTag: 1,
          redelivered: false,
          exchange: 'test',
          routingKey: 'test.key',
        },
      } as Message;

      const msg2 = {
        content: buffer2,
        properties: {},
        fields: {
          deliveryTag: 2,
          redelivered: false,
          exchange: 'test',
          routingKey: 'test.key',
        },
      } as Message;

      const handler = vi.fn().mockResolvedValue('result');

      await deduplicator.process(msg1, handler);
      expect(handler).toHaveBeenCalledTimes(1);

      await deduplicator.process(msg2, handler);
      expect(handler).toHaveBeenCalledTimes(1); // Same content, not called again
    });
  });

  describe('edge cases', () => {
    it('should handle empty content', async () => {
      const msg = createMockMessage('');
      const handler = vi.fn().mockResolvedValue('result');

      const result = await deduplicator.process(msg, handler);

      expect(result.duplicate).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle handler errors', async () => {
      const msg = createMockMessage({ data: 'test' }, 'msg-1');
      const handler = vi.fn().mockRejectedValue(new Error('Handler error'));

      await expect(deduplicator.process(msg, handler)).rejects.toThrow('Handler error');
    });

    it('should not cache undefined results (limitation)', async () => {
      const msg = createMockMessage({ data: 'test' }, 'msg-1');
      const handler = vi.fn().mockResolvedValue(undefined);

      const result1 = await deduplicator.process(msg, handler);
      expect(result1.duplicate).toBe(false);
      expect(result1.result).toBeUndefined();
      expect(handler).toHaveBeenCalledTimes(1);

      // undefined cannot be distinguished from cache miss
      const result2 = await deduplicator.process(msg, handler);
      expect(result2.duplicate).toBe(false); // Will process again
      expect(result2.result).toBeUndefined();
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should cache null results', async () => {
      const msg = createMockMessage({ data: 'test' }, 'msg-1');
      const handler = vi.fn().mockResolvedValue(null);

      const result1 = await deduplicator.process(msg, handler);
      expect(result1.result).toBeNull();

      const result2 = await deduplicator.process(msg, handler);
      expect(result2.duplicate).toBe(true);
      expect(result2.result).toBeNull();
    });

    it('should handle very large cache sizes', async () => {
      deduplicator = new MessageDeduplicator({
        enabled: true,
        cacheTTL: 10000,
        cacheSize: 10000,
      });

      const handler = vi.fn().mockResolvedValue('result');

      // Add many messages
      for (let i = 0; i < 1000; i++) {
        const msg = createMockMessage({ data: `test${i}` }, `msg-${i}`);
        await deduplicator.process(msg, handler);
      }

      expect(deduplicator.getStats().cacheSize).toBe(1000);
      expect(handler).toHaveBeenCalledTimes(1000);
    });
  });
});
