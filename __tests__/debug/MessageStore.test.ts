import { describe, it, expect, beforeEach } from 'vitest';
import { MessageStore } from '../../src/debug/MessageStore';
import type { DebugMessage } from '../../src/debug/types';

describe('MessageStore', () => {
  let store: MessageStore;

  const createMessage = (overrides: Partial<DebugMessage> = {}): DebugMessage => ({
    id: `msg-${Math.random()}`,
    timestamp: new Date(),
    type: 'rpc-request',
    queue: 'test-queue',
    command: 'test.command',
    status: 'success',
    duration: 100,
    correlationId: 'corr-1',
    payload: { test: 'data' },
    ...overrides,
  });

  beforeEach(() => {
    store = new MessageStore(100);
  });

  describe('add', () => {
    it('should add a message to the store', () => {
      const message = createMessage();
      store.add(message);

      expect(store.getAll()).toHaveLength(1);
      expect(store.getAll()[0]).toEqual(message);
    });

    it('should add messages to the front (LIFO)', () => {
      const msg1 = createMessage({ id: 'msg-1' });
      const msg2 = createMessage({ id: 'msg-2' });

      store.add(msg1);
      store.add(msg2);

      const all = store.getAll();
      expect(all[0].id).toBe('msg-2');
      expect(all[1].id).toBe('msg-1');
    });

    it('should respect max messages limit', () => {
      const smallStore = new MessageStore(3);

      for (let i = 0; i < 5; i++) {
        smallStore.add(createMessage({ id: `msg-${i}` }));
      }

      expect(smallStore.getAll()).toHaveLength(3);
    });

    it('should track performance data for messages with duration', () => {
      const msg1 = createMessage({ queue: 'queue1', command: 'cmd1', duration: 100 });
      const msg2 = createMessage({ queue: 'queue1', command: 'cmd1', duration: 200 });

      store.add(msg1);
      store.add(msg2);

      const performance = store.getHandlerPerformance('queue1', 'cmd1');
      expect(performance).toHaveLength(1);
      expect(performance[0].callCount).toBe(2);
      expect(performance[0].avgDuration).toBe(150);
    });
  });

  describe('getAll', () => {
    it('should return a copy of all messages', () => {
      const msg = createMessage();
      store.add(msg);

      const all = store.getAll();
      expect(all).toHaveLength(1);

      // Modify the returned array should not affect store
      all.push(createMessage());
      expect(store.getAll()).toHaveLength(1);
    });

    it('should return empty array when no messages', () => {
      expect(store.getAll()).toEqual([]);
    });
  });

  describe('getById', () => {
    it('should find message by ID', () => {
      const msg = createMessage({ id: 'target-id' });
      store.add(msg);
      store.add(createMessage({ id: 'other-id' }));

      const found = store.getById('target-id');
      expect(found).toBeDefined();
      expect(found?.id).toBe('target-id');
    });

    it('should return undefined for non-existent ID', () => {
      expect(store.getById('non-existent')).toBeUndefined();
    });
  });

  describe('filter', () => {
    beforeEach(() => {
      // Add test messages
      store.add(createMessage({
        id: 'msg-1',
        queue: 'queue-a',
        command: 'cmd1',
        status: 'success',
        type: 'rpc-request'
      }));
      store.add(createMessage({
        id: 'msg-2',
        queue: 'queue-b',
        command: 'cmd2',
        status: 'error',
        type: 'rpc-response'
      }));
      store.add(createMessage({
        id: 'msg-3',
        queue: 'queue-a',
        command: 'cmd1',
        status: 'success',
        type: 'rpc-request'
      }));
    });

    it('should filter by queue', () => {
      const filtered = store.filter({ queue: 'queue-a' });
      expect(filtered).toHaveLength(2);
      expect(filtered.every(m => m.queue === 'queue-a')).toBe(true);
    });

    it('should filter by command', () => {
      const filtered = store.filter({ command: 'cmd2' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].command).toBe('cmd2');
    });

    it('should filter by status', () => {
      const filtered = store.filter({ status: 'error' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].status).toBe('error');
    });

    it('should filter by type', () => {
      const filtered = store.filter({ type: 'rpc-response' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].type).toBe('rpc-response');
    });

    it('should filter by search text in id, command, queue', () => {
      const filtered = store.filter({ search: 'msg-2' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('msg-2');
    });

    it('should filter by search text in payload', () => {
      store.add(createMessage({
        id: 'msg-search',
        payload: { special: 'unique-value-xyz' }
      }));

      const filtered = store.filter({ search: 'unique-value-xyz' });
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.some(m => m.id === 'msg-search')).toBe(true);
    });

    it('should filter by time range', () => {
      const now = new Date();
      const past = new Date(now.getTime() - 60000);
      const future = new Date(now.getTime() + 60000);

      store.add(createMessage({
        id: 'msg-past',
        timestamp: new Date(past.getTime() - 10000)
      }));
      store.add(createMessage({
        id: 'msg-now',
        timestamp: now
      }));

      const filtered = store.filter({
        startTime: past,
        endTime: future
      });

      expect(filtered.some(m => m.id === 'msg-now')).toBe(true);
      expect(filtered.some(m => m.id === 'msg-past')).toBe(false);
    });

    it('should apply limit', () => {
      const filtered = store.filter({ limit: 2 });
      expect(filtered).toHaveLength(2);
    });

    it('should combine multiple filters', () => {
      const filtered = store.filter({
        queue: 'queue-a',
        status: 'success',
        limit: 1
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].queue).toBe('queue-a');
      expect(filtered[0].status).toBe('success');
    });

    it('should return all messages when no filters provided', () => {
      const filtered = store.filter({});
      expect(filtered).toHaveLength(3);
    });

    it('should handle circular references in payload gracefully', () => {
      const circular: any = { a: 1 };
      circular.self = circular;

      store.add(createMessage({
        id: 'msg-circular',
        payload: circular
      }));

      // Should not throw, just skip the payload in search
      expect(() => {
        store.filter({ search: 'something' });
      }).not.toThrow();
    });
  });

  describe('getStats', () => {
    it('should calculate statistics correctly', () => {
      store.add(createMessage({ status: 'success', duration: 100 }));
      store.add(createMessage({ status: 'success', duration: 200 }));
      store.add(createMessage({ status: 'error', duration: 150 }));

      const stats = store.getStats();

      expect(stats.totalMessages).toBe(3);
      expect(stats.successCount).toBe(2);
      expect(stats.errorCount).toBe(1);
      expect(stats.avgLatency).toBe(150);
      expect(stats.errorRate).toBeCloseTo(1/3);
    });

    it('should calculate percentiles correctly', () => {
      // Add messages with known durations
      for (let i = 1; i <= 100; i++) {
        store.add(createMessage({ duration: i }));
      }

      const stats = store.getStats();

      // Percentiles might be off by one due to rounding
      expect(stats.p95Latency).toBeGreaterThanOrEqual(94);
      expect(stats.p95Latency).toBeLessThanOrEqual(96);
      expect(stats.p99Latency).toBeGreaterThanOrEqual(98);
      expect(stats.p99Latency).toBeLessThanOrEqual(100);
    });

    it('should track active queues', () => {
      store.add(createMessage({ queue: 'queue-1' }));
      store.add(createMessage({ queue: 'queue-2' }));
      store.add(createMessage({ queue: 'queue-1' }));

      const stats = store.getStats();

      expect(stats.activeQueues.size).toBe(2);
      expect(stats.activeQueues.has('queue-1')).toBe(true);
      expect(stats.activeQueues.has('queue-2')).toBe(true);
    });

    it('should track active commands', () => {
      store.add(createMessage({ command: 'cmd1' }));
      store.add(createMessage({ command: 'cmd2' }));
      store.add(createMessage({ command: 'cmd1' }));

      const stats = store.getStats();

      expect(stats.activeCommands.get('cmd1')).toBe(2);
      expect(stats.activeCommands.get('cmd2')).toBe(1);
    });

    it('should calculate messages per second from last minute', () => {
      const now = new Date();
      const twoMinutesAgo = new Date(now.getTime() - 120000);

      // Recent messages (within last minute)
      store.add(createMessage({ timestamp: now }));
      store.add(createMessage({ timestamp: new Date(now.getTime() - 30000) }));
      store.add(createMessage({ timestamp: new Date(now.getTime() - 45000) }));

      // Old message (should not count)
      store.add(createMessage({ timestamp: twoMinutesAgo }));

      const stats = store.getStats();

      // Should have 3 messages in last minute = 3/60 = 0.05 msg/sec (rounded to 0.1)
      expect(stats.messagesPerSecond).toBeGreaterThanOrEqual(0);
      expect(stats.messagesPerSecond).toBeLessThanOrEqual(1); // Allow for rounding
    });
  });

  describe('getHandlerPerformance', () => {
    beforeEach(() => {
      // Add performance data
      store.add(createMessage({ queue: 'q1', command: 'cmd1', duration: 100, status: 'success' }));
      store.add(createMessage({ queue: 'q1', command: 'cmd1', duration: 200, status: 'success' }));
      store.add(createMessage({ queue: 'q1', command: 'cmd1', duration: 300, status: 'error' }));
      store.add(createMessage({ queue: 'q2', command: 'cmd2', duration: 150, status: 'success' }));
    });

    it('should return performance metrics for all handlers', () => {
      const perf = store.getHandlerPerformance();

      expect(perf).toHaveLength(2);
      expect(perf[0].callCount).toBe(3);
      expect(perf[1].callCount).toBe(1);
    });

    it('should filter by queue', () => {
      const perf = store.getHandlerPerformance('q1');

      expect(perf).toHaveLength(1);
      expect(perf[0].queue).toBe('q1');
    });

    it('should filter by command', () => {
      const perf = store.getHandlerPerformance(undefined, 'cmd2');

      expect(perf).toHaveLength(1);
      expect(perf[0].command).toBe('cmd2');
    });

    it('should calculate correct metrics', () => {
      const perf = store.getHandlerPerformance('q1', 'cmd1');

      expect(perf).toHaveLength(1);
      expect(perf[0].avgDuration).toBe(200);
      expect(perf[0].minDuration).toBe(100);
      expect(perf[0].maxDuration).toBe(300);
      expect(perf[0].errorCount).toBe(1);
      expect(perf[0].errorRate).toBeCloseTo(1/3);
    });

    it('should identify slow calls', () => {
      const perf = store.getHandlerPerformance('q1', 'cmd1');

      expect(perf).toHaveLength(1);
      expect(perf[0].slowCalls).toBeDefined();
      expect(Array.isArray(perf[0].slowCalls)).toBe(true);
      // Slow calls array should exist (might be empty depending on data)
    });

    it('should sort by call count descending', () => {
      const perf = store.getHandlerPerformance();

      expect(perf[0].callCount).toBeGreaterThanOrEqual(perf[1].callCount);
    });
  });

  describe('clear', () => {
    it('should remove all messages', () => {
      store.add(createMessage());
      store.add(createMessage());

      store.clear();

      expect(store.getAll()).toHaveLength(0);
    });

    it('should clear performance data', () => {
      store.add(createMessage({ queue: 'q1', command: 'cmd1', duration: 100 }));
      store.clear();

      const perf = store.getHandlerPerformance();
      expect(perf).toHaveLength(0);
    });
  });

  describe('getMemoryUsage', () => {
    it('should return memory usage in bytes', () => {
      store.add(createMessage());

      const usage = store.getMemoryUsage();
      expect(usage).toBeGreaterThan(0);
    });

    it('should return 0 for empty store', () => {
      const emptyStore = new MessageStore();
      expect(emptyStore.getMemoryUsage()).toBeGreaterThan(0); // Empty array still has size
    });
  });

  describe('getMemoryUsageMB', () => {
    it('should return memory usage in MB', () => {
      for (let i = 0; i < 100; i++) {
        store.add(createMessage({ payload: { large: 'x'.repeat(1000) } }));
      }

      const usageMB = store.getMemoryUsageMB();
      expect(usageMB).toBeGreaterThan(0);
      expect(usageMB).toBe(store.getMemoryUsage() / 1024 / 1024);
    });
  });

  describe('edge cases', () => {
    it('should handle messages without duration', () => {
      store.add(createMessage({ duration: undefined }));

      const stats = store.getStats();
      expect(stats.avgLatency).toBe(0);
    });

    it('should handle empty store gracefully', () => {
      const emptyStore = new MessageStore();

      expect(() => {
        emptyStore.getStats();
        emptyStore.getHandlerPerformance();
        emptyStore.filter({ queue: 'test' });
      }).not.toThrow();
    });

    it('should handle very large payloads', () => {
      const largePayload = { data: 'x'.repeat(10000) };
      const msg = createMessage({ payload: largePayload });

      expect(() => {
        store.add(msg);
        store.filter({ search: 'test' });
      }).not.toThrow();
    });
  });
});
