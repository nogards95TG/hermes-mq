import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ConsumerReconnectionManager } from '../../src/core/utils/ConsumerReconnectionManager';
import { ConsoleLogger } from '../../src/core/types/Logger';
import { TIME, LIMITS } from '../../src/core/constants';

describe('ConsumerReconnectionManager', () => {
  let manager: ConsumerReconnectionManager;
  let mockLogger: any;

  beforeEach(() => {
    vi.useFakeTimers();
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    manager = new ConsumerReconnectionManager({ logger: mockLogger });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('scheduleReconnect', () => {
    it('should schedule reconnection with exponential backoff', async () => {
      const reconnectCallback = vi.fn().mockResolvedValue(undefined);

      // First attempt
      manager.scheduleReconnect(reconnectCallback);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining(`Scheduling consumer reconnection attempt 1/${LIMITS.MAX_CONSUMER_RECONNECT_ATTEMPTS}`),
        expect.objectContaining({ delay: TIME.CONSUMER_RECONNECT_BASE_DELAY_MS })
      );

      // Advance time to trigger first reconnect
      await vi.advanceTimersByTimeAsync(TIME.CONSUMER_RECONNECT_BASE_DELAY_MS);
      expect(reconnectCallback).toHaveBeenCalledTimes(1);
      expect(manager.getAttemptCount()).toBe(0); // Reset after success
    });

    it('should retry with exponential backoff on failure', async () => {
      let callCount = 0;
      const reconnectCallback = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Connection failed');
        }
        return Promise.resolve();
      });

      // First attempt
      manager.scheduleReconnect(reconnectCallback);
      await vi.advanceTimersByTimeAsync(TIME.CONSUMER_RECONNECT_BASE_DELAY_MS);
      expect(reconnectCallback).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to reconnect consumer',
        expect.any(Error)
      );

      // Second attempt (10s delay = baseDelay * 2^1)
      await vi.advanceTimersByTimeAsync(TIME.CONSUMER_RECONNECT_BASE_DELAY_MS * 2);
      expect(reconnectCallback).toHaveBeenCalledTimes(2);

      // Third attempt (20s delay = baseDelay * 2^2) - should succeed
      await vi.advanceTimersByTimeAsync(TIME.CONSUMER_RECONNECT_BASE_DELAY_MS * 4);
      expect(reconnectCallback).toHaveBeenCalledTimes(3);
      expect(manager.getAttemptCount()).toBe(0); // Reset after success
    });

    it('should stop after max reconnection attempts', async () => {
      const reconnectCallback = vi.fn().mockRejectedValue(new Error('Connection failed'));

      // First attempt
      manager.scheduleReconnect(reconnectCallback);
      await vi.advanceTimersByTimeAsync(TIME.CONSUMER_RECONNECT_BASE_DELAY_MS);
      expect(reconnectCallback).toHaveBeenCalledTimes(1);

      // Attempt 2
      await vi.advanceTimersByTimeAsync(TIME.CONSUMER_RECONNECT_BASE_DELAY_MS * 2);
      expect(reconnectCallback).toHaveBeenCalledTimes(2);

      // Attempt 3
      await vi.advanceTimersByTimeAsync(TIME.CONSUMER_RECONNECT_BASE_DELAY_MS * 4);
      expect(reconnectCallback).toHaveBeenCalledTimes(3);

      // Attempt 4
      await vi.advanceTimersByTimeAsync(TIME.CONSUMER_RECONNECT_BASE_DELAY_MS * 8);
      expect(reconnectCallback).toHaveBeenCalledTimes(4);

      // Attempt 5
      await vi.advanceTimersByTimeAsync(TIME.CONSUMER_RECONNECT_MAX_DELAY_MS);
      expect(reconnectCallback).toHaveBeenCalledTimes(5);

      // Should not attempt again
      await vi.advanceTimersByTimeAsync(TIME.CONSUMER_RECONNECT_MAX_DELAY_MS);
      expect(reconnectCallback).toHaveBeenCalledTimes(5); // Still 5
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Max consumer reconnection attempts')
      );
    });

    it('should not schedule multiple reconnections concurrently', async () => {
      const reconnectCallback = vi.fn().mockResolvedValue(undefined);

      manager.scheduleReconnect(reconnectCallback);
      manager.scheduleReconnect(reconnectCallback);
      manager.scheduleReconnect(reconnectCallback);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Reconnection already scheduled, skipping'
      );

      await vi.advanceTimersByTimeAsync(5000);
      expect(reconnectCallback).toHaveBeenCalledTimes(1);
    });

    it('should respect max delay cap', async () => {
      const reconnectCallback = vi.fn().mockRejectedValue(new Error('Connection failed'));

      const customMaxDelay = 30_000;
      manager = new ConsumerReconnectionManager({
        logger: mockLogger,
        baseDelay: TIME.CONSUMER_RECONNECT_BASE_DELAY_MS,
        maxDelay: customMaxDelay,
      });

      // Attempts 1-4 would naturally be 5s, 10s, 20s, 40s
      // But 40s should be capped to 30s

      manager.scheduleReconnect(reconnectCallback);
      await vi.advanceTimersByTimeAsync(TIME.CONSUMER_RECONNECT_BASE_DELAY_MS); // Attempt 1
      await vi.advanceTimersByTimeAsync(TIME.CONSUMER_RECONNECT_BASE_DELAY_MS * 2); // Attempt 2
      await vi.advanceTimersByTimeAsync(TIME.CONSUMER_RECONNECT_BASE_DELAY_MS * 4); // Attempt 3

      // Attempt 4 should be capped to 30s instead of 40s
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining(`Scheduling consumer reconnection attempt 4/${LIMITS.MAX_CONSUMER_RECONNECT_ATTEMPTS}`),
        expect.objectContaining({ delay: customMaxDelay })
      );
    });
  });

  describe('reset', () => {
    it('should reset reconnection state', async () => {
      const reconnectCallback = vi.fn().mockRejectedValue(new Error('Connection failed'));

      manager.scheduleReconnect(reconnectCallback);
      await vi.advanceTimersByTimeAsync(5000);
      expect(manager.getAttemptCount()).toBeGreaterThan(0);

      manager.reset();
      expect(manager.getAttemptCount()).toBe(0);
      expect(manager.isScheduled()).toBe(false);
    });

    it('should clear pending timer on reset', () => {
      const reconnectCallback = vi.fn().mockResolvedValue(undefined);

      manager.scheduleReconnect(reconnectCallback);
      expect(manager.isScheduled()).toBe(true);

      manager.reset();
      expect(manager.isScheduled()).toBe(false);
    });
  });

  describe('cancel', () => {
    it('should cancel pending reconnection', () => {
      const reconnectCallback = vi.fn().mockResolvedValue(undefined);

      manager.scheduleReconnect(reconnectCallback);
      expect(manager.isScheduled()).toBe(true);

      manager.cancel();
      expect(manager.isScheduled()).toBe(false);
    });

    it('should prevent reconnection callback from executing', async () => {
      const reconnectCallback = vi.fn().mockResolvedValue(undefined);

      manager.scheduleReconnect(reconnectCallback);
      manager.cancel();

      await vi.advanceTimersByTimeAsync(10000);
      expect(reconnectCallback).not.toHaveBeenCalled();
    });
  });

  describe('state queries', () => {
    it('should track reconnection in progress', async () => {
      const reconnectCallback = vi.fn().mockImplementation(() => {
        expect(manager.isReconnectInProgress()).toBe(true);
        return Promise.resolve();
      });

      expect(manager.isReconnectInProgress()).toBe(false);

      manager.scheduleReconnect(reconnectCallback);
      await vi.advanceTimersByTimeAsync(5000);

      expect(reconnectCallback).toHaveBeenCalled();
      expect(manager.isReconnectInProgress()).toBe(false); // Reset after success
    });

    it('should track scheduled state', () => {
      const reconnectCallback = vi.fn().mockResolvedValue(undefined);

      expect(manager.isScheduled()).toBe(false);

      manager.scheduleReconnect(reconnectCallback);
      expect(manager.isScheduled()).toBe(true);
    });

    it('should track attempt count', async () => {
      let attempts = 0;
      const reconnectCallback = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Failed');
        }
        return Promise.resolve();
      });

      expect(manager.getAttemptCount()).toBe(0);

      manager.scheduleReconnect(reconnectCallback);
      await vi.advanceTimersByTimeAsync(TIME.CONSUMER_RECONNECT_BASE_DELAY_MS);
      // After first attempt and auto-scheduled retry, count should be 1 before the retry timer executes
      // The count increments when scheduleReconnect is called, not when the callback runs
      expect(manager.getAttemptCount()).toBeGreaterThanOrEqual(1);

      await vi.advanceTimersByTimeAsync(TIME.CONSUMER_RECONNECT_BASE_DELAY_MS * 2);
      expect(manager.getAttemptCount()).toBeGreaterThanOrEqual(2);

      // Third attempt should succeed and reset
      await vi.advanceTimersByTimeAsync(TIME.CONSUMER_RECONNECT_BASE_DELAY_MS * 4);
      expect(manager.getAttemptCount()).toBe(0); // Reset after success
    });
  });

  describe('custom configuration', () => {
    it('should respect custom max reconnection attempts', async () => {
      const reconnectCallback = vi.fn().mockRejectedValue(new Error('Failed'));

      manager = new ConsumerReconnectionManager({
        logger: mockLogger,
        maxReconnectAttempts: 2,
      });

      manager.scheduleReconnect(reconnectCallback);
      await vi.advanceTimersByTimeAsync(5000); // Attempt 1
      await vi.advanceTimersByTimeAsync(10000); // Attempt 2

      // Should stop after 2 attempts
      expect(reconnectCallback).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Max consumer reconnection attempts (2) reached')
      );
    });

    it('should respect custom base delay', async () => {
      const reconnectCallback = vi.fn().mockResolvedValue(undefined);

      manager = new ConsumerReconnectionManager({
        logger: mockLogger,
        baseDelay: 10000,
      });

      manager.scheduleReconnect(reconnectCallback);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining(`Scheduling consumer reconnection attempt 1/${LIMITS.MAX_CONSUMER_RECONNECT_ATTEMPTS}`),
        expect.objectContaining({ delay: 10_000 })
      );
    });

    it('should use SilentLogger as default', () => {
      const managerWithDefaults = new ConsumerReconnectionManager();
      expect(managerWithDefaults).toBeDefined();
      // Should not throw errors when logging
      const callback = vi.fn().mockResolvedValue(undefined);
      managerWithDefaults.scheduleReconnect(callback);
    });
  });
});
