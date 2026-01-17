import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageBuffer } from '../../src/core/message/MessageBuffer';

describe('MessageBuffer', () => {
  let buffer: MessageBuffer;

  beforeEach(() => {
    buffer = new MessageBuffer({
      maxSize: 5,
      ttl: 30000,
    });
  });

  describe('constructor', () => {
    it('should create a buffer with the specified options', () => {
      expect(buffer).toBeDefined();
      expect(buffer.size()).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
    });
  });

  describe('add', () => {
    it('should add a message to the buffer', async () => {
      const promise = buffer.add({ test: 'data' });

      expect(buffer.size()).toBe(1);
      expect(buffer.isEmpty()).toBe(false);
      expect(promise).toBeInstanceOf(Promise);
    });

    it('should add multiple messages to the buffer', async () => {
      buffer.add({ msg: 1 });
      buffer.add({ msg: 2 });
      buffer.add({ msg: 3 });

      expect(buffer.size()).toBe(3);
    });

    it('should reject when buffer is full', async () => {
      // Fill the buffer to maxSize (5)
      buffer.add({ msg: 1 });
      buffer.add({ msg: 2 });
      buffer.add({ msg: 3 });
      buffer.add({ msg: 4 });
      buffer.add({ msg: 5 });

      expect(buffer.size()).toBe(5);

      // Try to add one more
      await expect(buffer.add({ msg: 6 })).rejects.toThrow('Message buffer is full');

      // Size should remain 5
      expect(buffer.size()).toBe(5);
    });

    it('should return a promise for each added message', () => {
      const promise1 = buffer.add({ msg: 1 });
      const promise2 = buffer.add({ msg: 2 });

      expect(promise1).toBeInstanceOf(Promise);
      expect(promise2).toBeInstanceOf(Promise);
      expect(promise1).not.toBe(promise2);
    });
  });

  describe('flush', () => {
    it('should return all buffered messages', () => {
      buffer.add({ msg: 1 });
      buffer.add({ msg: 2 });
      buffer.add({ msg: 3 });

      const flushed = buffer.flush();

      expect(flushed).toHaveLength(3);
      expect(flushed[0].data).toEqual({ msg: 1 });
      expect(flushed[1].data).toEqual({ msg: 2 });
      expect(flushed[2].data).toEqual({ msg: 3 });
    });

    it('should include timestamp, resolve and reject functions', () => {
      buffer.add({ msg: 1 });

      const flushed = buffer.flush();

      expect(flushed[0]).toHaveProperty('data');
      expect(flushed[0]).toHaveProperty('timestamp');
      expect(flushed[0]).toHaveProperty('resolve');
      expect(flushed[0]).toHaveProperty('reject');
      expect(typeof flushed[0].resolve).toBe('function');
      expect(typeof flushed[0].reject).toBe('function');
      expect(typeof flushed[0].timestamp).toBe('number');
    });

    it('should clear the buffer after flushing', () => {
      buffer.add({ msg: 1 });
      buffer.add({ msg: 2 });

      expect(buffer.size()).toBe(2);

      buffer.flush();

      expect(buffer.size()).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
    });

    it('should return empty array if buffer is empty', () => {
      const flushed = buffer.flush();

      expect(flushed).toEqual([]);
      expect(flushed).toHaveLength(0);
    });

    it('should resolve/reject promises when callbacks are called', async () => {
      const promise = buffer.add({ msg: 1 });

      const flushed = buffer.flush();
      flushed[0].resolve('success');

      await expect(promise).resolves.toBe('success');
    });

    it('should reject promise when reject is called', async () => {
      const promise = buffer.add({ msg: 1 });

      const flushed = buffer.flush();
      flushed[0].reject(new Error('failed'));

      await expect(promise).rejects.toThrow('failed');
    });
  });

  describe('size', () => {
    it('should return 0 for empty buffer', () => {
      expect(buffer.size()).toBe(0);
    });

    it('should return correct size after adding messages', () => {
      expect(buffer.size()).toBe(0);

      buffer.add({ msg: 1 });
      expect(buffer.size()).toBe(1);

      buffer.add({ msg: 2 });
      expect(buffer.size()).toBe(2);

      buffer.add({ msg: 3 });
      expect(buffer.size()).toBe(3);
    });

    it('should return 0 after flushing', () => {
      buffer.add({ msg: 1 });
      buffer.add({ msg: 2 });

      expect(buffer.size()).toBe(2);

      buffer.flush();

      expect(buffer.size()).toBe(0);
    });
  });

  describe('isEmpty', () => {
    it('should return true for empty buffer', () => {
      expect(buffer.isEmpty()).toBe(true);
    });

    it('should return false when buffer has messages', () => {
      buffer.add({ msg: 1 });

      expect(buffer.isEmpty()).toBe(false);
    });

    it('should return true after flushing', () => {
      buffer.add({ msg: 1 });

      expect(buffer.isEmpty()).toBe(false);

      buffer.flush();

      expect(buffer.isEmpty()).toBe(true);
    });

    it('should return true after clearing', async () => {
      const promise = buffer.add({ msg: 1 });

      expect(buffer.isEmpty()).toBe(false);

      buffer.clear();

      expect(buffer.isEmpty()).toBe(true);
      
      // Catch the rejected promise to avoid unhandled rejection
      await expect(promise).rejects.toThrow();
    });
  });

  describe('clear', () => {
    it('should clear the buffer', async () => {
      const promise1 = buffer.add({ msg: 1 });
      const promise2 = buffer.add({ msg: 2 });

      expect(buffer.size()).toBe(2);

      buffer.clear();

      expect(buffer.size()).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
      
      // Catch the rejected promises to avoid unhandled rejections
      await expect(promise1).rejects.toThrow();
      await expect(promise2).rejects.toThrow();
    });

    it('should reject all pending promises with default error', async () => {
      const promise1 = buffer.add({ msg: 1 });
      const promise2 = buffer.add({ msg: 2 });

      buffer.clear();

      await expect(promise1).rejects.toThrow('Buffer cleared');
      await expect(promise2).rejects.toThrow('Buffer cleared');
    });

    it('should reject all pending promises with custom error reason', async () => {
      const promise1 = buffer.add({ msg: 1 });
      const promise2 = buffer.add({ msg: 2 });

      buffer.clear('Connection lost');

      await expect(promise1).rejects.toThrow('Connection lost');
      await expect(promise2).rejects.toThrow('Connection lost');
    });

    it('should allow adding messages after clearing', async () => {
      const promise = buffer.add({ msg: 1 });
      buffer.clear();

      expect(buffer.size()).toBe(0);

      buffer.add({ msg: 2 });

      expect(buffer.size()).toBe(1);
      
      // Catch the rejected promise from first add
      await expect(promise).rejects.toThrow();
    });
  });

  describe('timestamp handling', () => {
    it('should store current timestamp with each message', () => {
      const beforeAdd = Date.now();
      buffer.add({ msg: 1 });
      const afterAdd = Date.now();

      const flushed = buffer.flush();

      expect(flushed[0].timestamp).toBeGreaterThanOrEqual(beforeAdd);
      expect(flushed[0].timestamp).toBeLessThanOrEqual(afterAdd);
    });

    it('should store different timestamps for different messages', async () => {
      buffer.add({ msg: 1 });

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      buffer.add({ msg: 2 });

      const flushed = buffer.flush();

      expect(flushed[1].timestamp).toBeGreaterThan(flushed[0].timestamp);
    });
  });

  describe('edge cases', () => {
    it('should handle different data types', () => {
      buffer.add('string message');
      buffer.add(123);
      buffer.add({ complex: { nested: 'object' } });
      buffer.add(['array', 'message']);
      buffer.add(null);

      const flushed = buffer.flush();

      expect(flushed[0].data).toBe('string message');
      expect(flushed[1].data).toBe(123);
      expect(flushed[2].data).toEqual({ complex: { nested: 'object' } });
      expect(flushed[3].data).toEqual(['array', 'message']);
      expect(flushed[4].data).toBe(null);
    });

    it('should handle maxSize of 1', () => {
      const smallBuffer = new MessageBuffer({ maxSize: 1, ttl: 30000 });

      smallBuffer.add({ msg: 1 });

      expect(smallBuffer.size()).toBe(1);
      expect(smallBuffer.add({ msg: 2 })).rejects.toThrow('Message buffer is full');
    });

    it('should handle large maxSize', () => {
      const largeBuffer = new MessageBuffer({ maxSize: 10000, ttl: 30000 });

      for (let i = 0; i < 1000; i++) {
        largeBuffer.add({ msg: i });
      }

      expect(largeBuffer.size()).toBe(1000);
    });

    it('should maintain FIFO order', () => {
      buffer.add({ order: 1 });
      buffer.add({ order: 2 });
      buffer.add({ order: 3 });
      buffer.add({ order: 4 });

      const flushed = buffer.flush();

      expect(flushed[0].data).toEqual({ order: 1 });
      expect(flushed[1].data).toEqual({ order: 2 });
      expect(flushed[2].data).toEqual({ order: 3 });
      expect(flushed[3].data).toEqual({ order: 4 });
    });
  });
});
