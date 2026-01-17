import type { DebugMessage, DebugStats, DebugHandlerPerformance } from './types';

/**
 * Message Store - Circular Buffer for Debug Messages
 *
 * High-performance in-memory storage for debug messages with advanced filtering,
 * search capabilities, and real-time statistics. Implements a circular buffer to
 * maintain a fixed maximum number of recent messages.
 *
 * **Features:**
 * - Circular buffer with configurable size limit
 * - Single-pass filtering for optimal performance
 * - Full-text search across message fields and payload
 * - Real-time statistics (latency percentiles, throughput, error rates)
 * - Handler performance metrics per command/queue
 * - Memory usage tracking
 *
 * **Performance Optimizations:**
 * - Smart payload search (only when needed)
 * - String caching to avoid repeated JSON.stringify
 * - Fast exact-match filters before expensive text search
 * - Percentile calculations with sorted arrays
 *
 * @example Basic Usage
 * ```typescript
 * import { MessageStore } from 'hermes-mq';
 *
 * const store = new MessageStore(1000); // Store last 1000 messages
 *
 * // Add messages
 * store.add({
 *   id: 'msg-1',
 *   timestamp: new Date(),
 *   type: 'rpc-request',
 *   queue: 'user.queue',
 *   command: 'user.create',
 *   status: 'success',
 *   correlationId: 'corr-123',
 *   payload: { name: 'John' },
 *   duration: 45,
 * });
 *
 * // Get all messages
 * const all = store.getAll();
 *
 * // Search and filter
 * const filtered = store.filter({
 *   queue: 'user.queue',
 *   status: 'success',
 *   search: 'John',
 * });
 *
 * // Get statistics
 * const stats = store.getStats();
 * console.log(`Avg latency: ${stats.avgLatency}ms, P95: ${stats.p95Latency}ms`);
 * ```
 *
 * @example Performance Metrics
 * ```typescript
 * // Get performance by handler
 * const performance = store.getHandlerPerformance();
 * performance.forEach(p => {
 *   console.log(`${p.queue}:${p.command}`);
 *   console.log(`  Calls: ${p.callCount}, Avg: ${p.avgDuration}ms`);
 *   console.log(`  P95: ${p.p95Duration}ms, Errors: ${p.errorRate * 100}%`);
 * });
 * ```
 *
 * @public
 */
export class MessageStore {
  private messages: DebugMessage[] = [];
  private readonly maxMessages: number;
  private performanceData: Map<string, number[]> = new Map();

  /**
   * Create a new MessageStore instance
   *
   * @param maxMessages - Maximum number of messages to store (default: 1000)
   *                      Older messages are automatically removed when limit is reached
   *
   * @example
   * ```typescript
   * // Store up to 5000 messages
   * const store = new MessageStore(5000);
   * ```
   *
   * @public
   */
  constructor(maxMessages: number = 1000) {
    this.maxMessages = maxMessages;
  }

  /**
   * Add a message to the store
   *
   * Adds a new message to the front of the circular buffer. If the buffer is full,
   * the oldest message is automatically removed. Also tracks performance metrics
   * for commands with duration data.
   *
   * @param message - The debug message to add
   *
   * @example
   * ```typescript
   * store.add({
   *   id: 'msg-123',
   *   timestamp: new Date(),
   *   type: 'rpc-request',
   *   queue: 'user.queue',
   *   command: 'user.create',
   *   status: 'success',
   *   correlationId: 'corr-456',
   *   payload: { name: 'Alice' },
   *   duration: 42,
   * });
   * ```
   *
   * @public
   */
  add(message: DebugMessage): void {
    this.messages.unshift(message); // Add to front

    // Keep performance tracking
    if (message.duration !== undefined) {
      const key = `${message.queue}:${message.command}`;
      const durations = this.performanceData.get(key) || [];
      durations.push(message.duration);
      
      // Keep last 100 durations per command
      if (durations.length > 100) {
        durations.shift();
      }
      
      this.performanceData.set(key, durations);
    }

    // Circular buffer: remove oldest if exceeds limit
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(0, this.maxMessages);
    }
  }

  /**
   * Get all stored messages
   *
   * Returns a shallow copy of all messages in the store, ordered from newest to oldest.
   *
   * @returns Array of all debug messages (newest first)
   *
   * @example
   * ```typescript
   * const allMessages = store.getAll();
   * console.log(`Total messages: ${allMessages.length}`);
   * console.log(`Latest message: ${allMessages[0].command}`);
   * ```
   *
   * @public
   */
  getAll(): DebugMessage[] {
    return [...this.messages];
  }

  /**
   * Get messages with filtering - optimized for performance
   *
   * Filters messages using a single-pass algorithm for optimal performance.
   * Fast exact-match filters are applied first, followed by expensive text search.
   * Smart payload search only activates when text not found in basic fields.
   *
   * **Performance:** O(n) single-pass filtering, faster than multi-pass approaches.
   *
   * @param filters - Filter criteria (all filters are AND combined)
   * @param filters.queue - Exact match on queue name
   * @param filters.command - Exact match on command name
   * @param filters.status - Exact match on status (success/error/timeout/pending)
   * @param filters.type - Exact match on message type
   * @param filters.search - Full-text search across id, command, queue, and payload
   * @param filters.startTime - Messages after this timestamp
   * @param filters.endTime - Messages before this timestamp
   * @param filters.limit - Maximum number of results to return
   *
   * @returns Filtered messages (newest first)
   *
   * @example Basic Filtering
   * ```typescript
   * // Get all successful user.create messages
   * const messages = store.filter({
   *   queue: 'user.queue',
   *   command: 'user.create',
   *   status: 'success'
   * });
   * ```
   *
   * @example Full-Text Search
   * ```typescript
   * // Search for "John" anywhere in messages
   * const results = store.filter({
   *   search: 'John',
   *   limit: 50
   * });
   * ```
   *
   * @example Time Range
   * ```typescript
   * // Get messages from last hour with errors
   * const oneHourAgo = new Date(Date.now() - 3600000);
   * const errors = store.filter({
   *   status: 'error',
   *   startTime: oneHourAgo
   * });
   * ```
   *
   * @public
   */
  filter(filters: {
    queue?: string;
    command?: string;
    status?: string;
    type?: string;
    search?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): DebugMessage[] {
    let filtered = this.messages;

    // Early exit if no filters
    if (Object.keys(filters).length === 0) {
      return [...this.messages];
    }

    // Single-pass filter for better performance
    filtered = filtered.filter((m) => {
      // Exact match filters (fast)
      if (filters.queue && m.queue !== filters.queue) return false;
      if (filters.command && m.command !== filters.command) return false;
      if (filters.status && m.status !== filters.status) return false;
      if (filters.type && m.type !== filters.type) return false;

      // Time range filters
      if (filters.startTime && m.timestamp < filters.startTime) return false;
      if (filters.endTime && m.timestamp > filters.endTime) return false;

      // Text search filter (expensive - do last)
      if (filters.search) {
        const search = filters.search.toLowerCase();
        const searchableText = `${m.id} ${m.command} ${m.queue}`.toLowerCase();

        // Only search payload if not found in basic fields
        if (!searchableText.includes(search)) {
          try {
            // Cache payload string to avoid multiple JSON.stringify calls
            const payloadStr = typeof m.payload === 'string'
              ? m.payload
              : JSON.stringify(m.payload);

            if (!payloadStr.toLowerCase().includes(search)) {
              return false;
            }
          } catch {
            // If payload can't be stringified, skip it
            return false;
          }
        }
      }

      return true;
    });

    // Apply limit after filtering
    if (filters.limit && filters.limit > 0) {
      filtered = filtered.slice(0, filters.limit);
    }

    return filtered;
  }

  /**
   * Get a specific message by ID
   *
   * @param id - The unique message ID
   * @returns The message if found, undefined otherwise
   *
   * @example
   * ```typescript
   * const message = store.getById('msg-123');
   * if (message) {
   *   console.log(`Found: ${message.command} - ${message.status}`);
   * }
   * ```
   *
   * @public
   */
  getById(id: string): DebugMessage | undefined {
    return this.messages.find((m) => m.id === id);
  }

  /**
   * Get comprehensive statistics about stored messages
   *
   * Calculates real-time statistics including:
   * - Total message counts (total, success, error)
   * - Latency metrics (average, P95, P99)
   * - Throughput (messages per second, last 60 seconds)
   * - Error rate (percentage of failed messages)
   * - Active queues and commands
   *
   * **Performance:** Uses efficient percentile calculation with sorted arrays.
   *
   * @returns Statistics object with all metrics
   *
   * @example
   * ```typescript
   * const stats = store.getStats();
   *
   * console.log(`Total: ${stats.totalMessages}`);
   * console.log(`Success: ${stats.successCount}, Errors: ${stats.errorCount}`);
   * console.log(`Avg latency: ${stats.avgLatency}ms`);
   * console.log(`P95 latency: ${stats.p95Latency}ms`);
   * console.log(`P99 latency: ${stats.p99Latency}ms`);
   * console.log(`Throughput: ${stats.messagesPerSecond} msg/sec`);
   * console.log(`Error rate: ${(stats.errorRate * 100).toFixed(2)}%`);
   * console.log(`Active queues: ${stats.activeQueues.size}`);
   * ```
   *
   * @public
   */
  getStats(): DebugStats {
    const total = this.messages.length;
    const successCount = this.messages.filter((m) => m.status === 'success').length;
    const errorCount = this.messages.filter((m) => m.status === 'error').length;

    const durations = this.messages
      .filter((m) => m.duration !== undefined)
      .map((m) => m.duration!);

    const avgLatency = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    const sorted = [...durations].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p99Index = Math.floor(sorted.length * 0.99);
    const p95Latency = sorted[p95Index] || 0;
    const p99Latency = sorted[p99Index] || 0;

    // Calculate messages per second (last minute)
    const oneMinuteAgo = new Date(Date.now() - 60000);
    const recentMessages = this.messages.filter((m) => m.timestamp > oneMinuteAgo);
    const messagesPerSecond = recentMessages.length / 60;

    const activeQueues = new Set(this.messages.map((m) => m.queue));
    const activeCommands = new Map<string, number>();
    
    this.messages.forEach((m) => {
      activeCommands.set(m.command, (activeCommands.get(m.command) || 0) + 1);
    });

    return {
      totalMessages: total,
      successCount,
      errorCount,
      avgLatency: Math.round(avgLatency),
      p95Latency: Math.round(p95Latency),
      p99Latency: Math.round(p99Latency),
      messagesPerSecond: Math.round(messagesPerSecond * 10) / 10,
      errorRate: total > 0 ? errorCount / total : 0,
      activeQueues,
      activeCommands,
    };
  }

  /**
   * Get handler performance metrics grouped by command/queue
   *
   * Analyzes performance of individual handlers (command/queue pairs), providing:
   * - Call count and duration statistics (avg, min, max, P95, P99)
   * - Error count and error rate
   * - Top 5 slowest calls with details
   *
   * Results are sorted by call count (most frequently used handlers first).
   *
   * @param queue - Optional filter for specific queue
   * @param command - Optional filter for specific command
   * @returns Array of performance metrics per handler
   *
   * @example Get All Handler Performance
   * ```typescript
   * const performance = store.getHandlerPerformance();
   *
   * performance.forEach(p => {
   *   console.log(`${p.queue}:${p.command}`);
   *   console.log(`  Calls: ${p.callCount}`);
   *   console.log(`  Avg: ${p.avgDuration}ms, P95: ${p.p95Duration}ms`);
   *   console.log(`  Errors: ${p.errorCount} (${(p.errorRate * 100).toFixed(2)}%)`);
   *
   *   if (p.slowCalls.length > 0) {
   *     console.log('  Slowest calls:');
   *     p.slowCalls.forEach(call => {
   *       console.log(`    ${call.messageId}: ${call.duration}ms`);
   *     });
   *   }
   * });
   * ```
   *
   * @example Filter by Queue
   * ```typescript
   * // Get performance for all commands in user.queue
   * const userQueuePerf = store.getHandlerPerformance('user.queue');
   * ```
   *
   * @example Filter by Queue and Command
   * ```typescript
   * // Get performance for specific handler
   * const specificPerf = store.getHandlerPerformance('user.queue', 'user.create');
   * ```
   *
   * @public
   */
  getHandlerPerformance(queue?: string, command?: string): DebugHandlerPerformance[] {
    const grouped = new Map<string, DebugMessage[]>();

    this.messages.forEach((m) => {
      if (queue && m.queue !== queue) return;
      if (command && m.command !== command) return;

      const key = `${m.queue}:${m.command}`;
      const messages = grouped.get(key) || [];
      messages.push(m);
      grouped.set(key, messages);
    });

    const performances: DebugHandlerPerformance[] = [];

    grouped.forEach((messages, key) => {
      const [queueName, commandName] = key.split(':');
      const durations = messages
        .filter((m) => m.duration !== undefined)
        .map((m) => m.duration!);

      if (durations.length === 0) return;

      const sorted = [...durations].sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      const p99Index = Math.floor(sorted.length * 0.99);

      const errorCount = messages.filter((m) => m.status === 'error').length;

      const slowCalls = messages
        .filter((m) => m.duration && m.duration > sorted[p95Index])
        .slice(0, 5)
        .map((m) => ({
          messageId: m.id,
          duration: m.duration!,
          timestamp: m.timestamp,
        }));

      performances.push({
        command: commandName,
        queue: queueName,
        callCount: messages.length,
        avgDuration: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
        minDuration: Math.min(...durations),
        maxDuration: Math.max(...durations),
        p95Duration: sorted[p95Index] || 0,
        p99Duration: sorted[p99Index] || 0,
        errorCount,
        errorRate: errorCount / messages.length,
        slowCalls,
      });
    });

    return performances.sort((a, b) => b.callCount - a.callCount);
  }

  /**
   * Clear all stored messages and performance data
   *
   * Removes all messages from the store and resets performance tracking.
   * Useful for starting fresh or when memory usage is a concern.
   *
   * @example
   * ```typescript
   * store.clear();
   * console.log('All messages cleared');
   * ```
   *
   * @public
   */
  clear(): void {
    this.messages = [];
    this.performanceData.clear();
  }

  /**
   * Get estimated memory usage in bytes
   *
   * Provides a rough estimate of memory used by stored messages by serializing
   * them to JSON and measuring the string length. Actual memory usage may be
   * higher due to JavaScript object overhead.
   *
   * @returns Estimated memory usage in bytes
   *
   * @example
   * ```typescript
   * const bytes = store.getMemoryUsage();
   * console.log(`Memory usage: ${bytes} bytes`);
   *
   * // Convert to MB for easier reading
   * const mb = store.getMemoryUsageMB();
   * console.log(`Memory usage: ${mb.toFixed(2)} MB`);
   * ```
   *
   * @public
   */
  getMemoryUsage(): number {
    // Rough estimate: JSON stringify size
    return JSON.stringify(this.messages).length;
  }

  /**
   * Get estimated memory usage in megabytes
   *
   * Convenience method that returns memory usage in MB instead of bytes.
   *
   * @returns Estimated memory usage in megabytes
   *
   * @example
   * ```typescript
   * const mb = store.getMemoryUsageMB();
   * console.log(`Store is using ${mb.toFixed(2)} MB`);
   *
   * // Monitor memory usage
   * if (mb > 50) {
   *   console.warn('High memory usage, consider clearing old messages');
   *   store.clear();
   * }
   * ```
   *
   * @public
   */
  getMemoryUsageMB(): number {
    return this.getMemoryUsage() / 1024 / 1024;
  }
}
