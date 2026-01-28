import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from '../../src/core/resilience/CircuitBreaker';
import { SilentLogger } from '../../src/core/types/Logger';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('CLOSED state', () => {
    beforeEach(() => {
      breaker = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeout: 60000,
        halfOpenMaxAttempts: 2,
      });
    });

    it('should start in CLOSED state', () => {
      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.isClosed()).toBe(true);
      expect(breaker.isOpen()).toBe(false);
      expect(breaker.isHalfOpen()).toBe(false);
    });

    it('should execute function successfully when CLOSED', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await breaker.execute(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should stay CLOSED on single failure', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('failure'));

      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.getStats().failureCount).toBe(1);
    });

    it('should reset failure count on success', async () => {
      const failFn = vi.fn().mockRejectedValue(new Error('failure'));
      const successFn = vi.fn().mockResolvedValue('success');

      // Fail once
      await expect(breaker.execute(failFn)).rejects.toThrow('failure');
      expect(breaker.getStats().failureCount).toBe(1);

      // Success should reset failure count
      await breaker.execute(successFn);
      expect(breaker.getStats().failureCount).toBe(0);
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should transition to OPEN after threshold failures', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('failure'));
      const stateChangeSpy = vi.fn();
      breaker.on('stateChange', stateChangeSpy);

      // Fail 3 times (threshold)
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(fn)).rejects.toThrow('failure');
      }

      expect(breaker.getState()).toBe('OPEN');
      expect(breaker.isOpen()).toBe(true);
      expect(stateChangeSpy).toHaveBeenCalledWith({
        oldState: 'CLOSED',
        newState: 'OPEN',
        failureCount: 3,
        successCount: 0,
      });
    });
  });

  describe('OPEN state', () => {
    beforeEach(() => {
      breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 60000,
        halfOpenMaxAttempts: 2,
      });
    });

    it('should fail-fast when OPEN', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('failure'));

      // Trigger OPEN state (2 failures)
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      expect(breaker.getState()).toBe('OPEN');

      // Should fail-fast without calling function
      const fastFailFn = vi.fn().mockResolvedValue('should not be called');
      await expect(breaker.execute(fastFailFn)).rejects.toThrow('Circuit breaker is OPEN');
      expect(fastFailFn).not.toHaveBeenCalled();
    });

    it('should transition to HALF_OPEN after reset timeout', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('failure'));

      // Trigger OPEN state
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      expect(breaker.getState()).toBe('OPEN');

      // Advance time to after reset timeout
      vi.advanceTimersByTime(60000);

      // Next request should transition to HALF_OPEN
      const successFn = vi.fn().mockResolvedValue('success');
      await breaker.execute(successFn);

      expect(breaker.getState()).toBe('HALF_OPEN');
      expect(successFn).toHaveBeenCalledTimes(1);
    });

    it('should remain OPEN before reset timeout', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('failure'));

      // Trigger OPEN state
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      expect(breaker.getState()).toBe('OPEN');

      // Advance time but not enough
      vi.advanceTimersByTime(30000);

      // Should still be OPEN
      const testFn = vi.fn().mockResolvedValue('test');
      await expect(breaker.execute(testFn)).rejects.toThrow('Circuit breaker is OPEN');
      expect(breaker.getState()).toBe('OPEN');
    });
  });

  describe('HALF_OPEN state', () => {
    beforeEach(() => {
      breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 60000,
        halfOpenMaxAttempts: 3,
      });
    });

    it('should allow limited requests in HALF_OPEN', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('failure'));

      // Trigger OPEN state
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      expect(breaker.getState()).toBe('OPEN');

      // Transition to HALF_OPEN
      vi.advanceTimersByTime(60000);
      const successFn = vi.fn().mockResolvedValue('success');
      await breaker.execute(successFn);
      expect(breaker.getState()).toBe('HALF_OPEN');

      // Should allow up to halfOpenMaxAttempts
      await breaker.execute(successFn);
      await breaker.execute(successFn);

      expect(successFn).toHaveBeenCalledTimes(3);
    });

    it('should transition to CLOSED after successful attempts', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('failure'));

      // Trigger OPEN state
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      await expect(breaker.execute(fn)).rejects.toThrow('failure');

      // Transition to HALF_OPEN
      vi.advanceTimersByTime(60000);
      const successFn = vi.fn().mockResolvedValue('success');

      // All halfOpenMaxAttempts succeed
      await breaker.execute(successFn);
      await breaker.execute(successFn);
      await breaker.execute(successFn);

      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.isClosed()).toBe(true);
    });

    it('should reopen on failure in HALF_OPEN', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('failure'));

      // Trigger OPEN state
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      await expect(breaker.execute(fn)).rejects.toThrow('failure');

      // Transition to HALF_OPEN
      vi.advanceTimersByTime(60000);
      const successFn = vi.fn().mockResolvedValue('success');
      await breaker.execute(successFn);
      expect(breaker.getState()).toBe('HALF_OPEN');

      // Failure should reopen circuit
      const failFn = vi.fn().mockRejectedValue(new Error('fail again'));
      await expect(breaker.execute(failFn)).rejects.toThrow('fail again');

      expect(breaker.getState()).toBe('OPEN');
    });

    it('should limit concurrent requests in HALF_OPEN state', async () => {
      // Create a new breaker with specific config for this test
      breaker = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 60000,
        halfOpenMaxAttempts: 2,
      });

      const failFn = vi.fn().mockRejectedValue(new Error('fail'));
      const slowFn = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => setTimeout(() => resolve('slow'), 100));
      });

      // Trigger OPEN state
      await expect(breaker.execute(failFn)).rejects.toThrow('fail');
      expect(breaker.getState()).toBe('OPEN');

      // Transition to HALF_OPEN
      vi.advanceTimersByTime(60000);

      // Start first half-open attempt (slow)
      const promise1 = breaker.execute(slowFn);
      expect(breaker.getState()).toBe('HALF_OPEN');

      // Start second half-open attempt (slow)
      const promise2 = breaker.execute(slowFn);

      // Third attempt should be rejected because we've used up both slots
      const extraFn = vi.fn().mockResolvedValue('extra');
      await expect(breaker.execute(extraFn)).rejects.toThrow('has reached max attempts');
      expect(extraFn).not.toHaveBeenCalled();

      // Wait for pending promises to complete
      vi.advanceTimersByTime(100);
      await promise1;
      await promise2;
    });
  });

  describe('forceReset', () => {
    it('should reset circuit breaker to CLOSED state', async () => {
      breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 60000,
      });

      const fn = vi.fn().mockRejectedValue(new Error('failure'));

      // Trigger OPEN state
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      expect(breaker.getState()).toBe('OPEN');

      // Force reset
      const resetSpy = vi.fn();
      breaker.on('reset', resetSpy);
      breaker.forceReset();

      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.getStats().failureCount).toBe(0);
      expect(resetSpy).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return current statistics', async () => {
      breaker = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeout: 60000,
      });

      const failFn = vi.fn().mockRejectedValue(new Error('failure'));
      const successFn = vi.fn().mockResolvedValue('success');

      // Initial stats
      let stats = breaker.getStats();
      expect(stats.state).toBe('CLOSED');
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);

      // After success
      await breaker.execute(successFn);
      stats = breaker.getStats();
      expect(stats.successCount).toBe(1);
      expect(stats.lastSuccessTime).toBeTruthy();

      // After failure
      await expect(breaker.execute(failFn)).rejects.toThrow('failure');
      stats = breaker.getStats();
      expect(stats.failureCount).toBe(1);
      expect(stats.lastFailureTime).toBeTruthy();
    });
  });

  describe('events', () => {
    it('should emit stateChange event', async () => {
      breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 60000,
      });

      const stateChangeSpy = vi.fn();
      breaker.on('stateChange', stateChangeSpy);

      const fn = vi.fn().mockRejectedValue(new Error('failure'));

      // Trigger OPEN state
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      await expect(breaker.execute(fn)).rejects.toThrow('failure');

      expect(stateChangeSpy).toHaveBeenCalledWith({
        oldState: 'CLOSED',
        newState: 'OPEN',
        failureCount: 2,
        successCount: 0,
      });
    });

    it('should emit reset event', () => {
      breaker = new CircuitBreaker();
      const resetSpy = vi.fn();
      breaker.on('reset', resetSpy);

      breaker.forceReset();

      expect(resetSpy).toHaveBeenCalled();
    });
  });

  describe('with logger', () => {
    it('should use provided logger', async () => {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      breaker = new CircuitBreaker({
        failureThreshold: 1,
        logger: logger as any,
      });

      const fn = vi.fn().mockRejectedValue(new Error('failure'));
      await expect(breaker.execute(fn)).rejects.toThrow('failure');

      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('default configuration', () => {
    it('should use default values when not provided', () => {
      breaker = new CircuitBreaker();

      const stats = breaker.getStats();
      expect(stats.state).toBe('CLOSED');
      expect(breaker.isClosed()).toBe(true);
    });
  });
});
