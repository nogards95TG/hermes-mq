import { describe, it, expect, vi } from 'vitest';
import { RetryPolicy } from '../src/retry/RetryPolicy';

describe('RetryPolicy', () => {
  describe('getDelay', () => {
    it('should calculate exponential backoff', () => {
      const policy = new RetryPolicy({
        initialDelay: 1000,
        maxDelay: 30000,
        backoffMultiplier: 2,
      });

      expect(policy.getDelay(0)).toBe(1000);
      expect(policy.getDelay(1)).toBe(2000);
      expect(policy.getDelay(2)).toBe(4000);
      expect(policy.getDelay(3)).toBe(8000);
      expect(policy.getDelay(4)).toBe(16000);
    });

    it('should cap delay at maxDelay', () => {
      const policy = new RetryPolicy({
        initialDelay: 1000,
        maxDelay: 10000,
        backoffMultiplier: 2,
      });

      expect(policy.getDelay(10)).toBe(10000);
      expect(policy.getDelay(20)).toBe(10000);
    });

    it('should work with different backoff multipliers', () => {
      const policy = new RetryPolicy({
        initialDelay: 100,
        maxDelay: 10000,
        backoffMultiplier: 3,
      });

      expect(policy.getDelay(0)).toBe(100);
      expect(policy.getDelay(1)).toBe(300);
      expect(policy.getDelay(2)).toBe(900);
      expect(policy.getDelay(3)).toBe(2700);
    });
  });

  describe('shouldRetry', () => {
    it('should return false when disabled', () => {
      const policy = new RetryPolicy({ enabled: false });
      const error = new Error('ECONNREFUSED');

      expect(policy.shouldRetry(error, 0)).toBe(false);
    });

    it('should return false when max attempts reached', () => {
      const policy = new RetryPolicy({ maxAttempts: 3 });
      const error = new Error('ECONNREFUSED');

      expect(policy.shouldRetry(error, 3)).toBe(false);
      expect(policy.shouldRetry(error, 4)).toBe(false);
    });

    it('should return true for retryable errors', () => {
      const policy = new RetryPolicy({
        retryableErrors: [/ECONNREFUSED/, /ETIMEDOUT/],
      });

      expect(policy.shouldRetry(new Error('ECONNREFUSED'), 0)).toBe(true);
      expect(policy.shouldRetry(new Error('ETIMEDOUT'), 0)).toBe(true);
    });

    it('should return false for non-retryable errors', () => {
      const policy = new RetryPolicy({
        retryableErrors: [/ECONNREFUSED/],
      });

      expect(policy.shouldRetry(new Error('Invalid input'), 0)).toBe(false);
      expect(policy.shouldRetry(new Error('Unauthorized'), 0)).toBe(false);
    });

    it('should match string patterns in error messages', () => {
      const policy = new RetryPolicy({
        retryableErrors: ['network error', 'timeout'],
      });

      expect(policy.shouldRetry(new Error('A network error occurred'), 0)).toBe(true);
      expect(policy.shouldRetry(new Error('Request timeout'), 0)).toBe(true);
      expect(policy.shouldRetry(new Error('Invalid request'), 0)).toBe(false);
    });
  });

  describe('execute', () => {
    it('should succeed on first attempt', async () => {
      const policy = new RetryPolicy();
      const fn = vi.fn().mockResolvedValue('success');

      const result = await policy.execute(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 10,
        retryableErrors: [/ECONNREFUSED/],
      });

      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce('success');

      const result = await policy.execute(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw on non-retryable errors', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 10,
        retryableErrors: [/ECONNREFUSED/],
      });

      const fn = vi.fn().mockRejectedValue(new Error('Invalid input'));

      await expect(policy.execute(fn)).rejects.toThrow('Invalid input');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should throw after max attempts', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 10,
        retryableErrors: [/ECONNREFUSED/],
      });

      const fn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(policy.execute(fn)).rejects.toThrow('ECONNREFUSED');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should wait between retries', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 100,
        backoffMultiplier: 2,
        retryableErrors: [/ECONNREFUSED/],
      });

      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce('success');

      const startTime = Date.now();
      await policy.execute(fn);
      const duration = Date.now() - startTime;

      // Should wait at least initialDelay (100ms) but account for execution time
      expect(duration).toBeGreaterThanOrEqual(90);
    });

    it('should pass context to logger', async () => {
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const policy = new RetryPolicy(
        {
          maxAttempts: 2,
          initialDelay: 10,
          retryableErrors: [/ECONNREFUSED/],
        },
        mockLogger
      );

      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce('success');

      await policy.execute(fn, 'test-operation');

      expect(mockLogger.warn).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('succeeded after'),
        expect.objectContaining({ context: 'test-operation' })
      );
    });
  });
});
