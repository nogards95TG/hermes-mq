import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChannelPool } from '../../src/core/connection/ChannelPool';
import { MockConnection } from '../helpers/types';
import { createMockConnection, createMockChannel } from '../helpers/Connection';

describe('ChannelPool', () => {
  let connection: MockConnection;
  let pool: ChannelPool;

  beforeEach(() => {
    connection = createMockConnection();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a pool with default configuration', () => {
      pool = new ChannelPool(connection);

      expect(pool).toBeDefined();
      expect(pool.size()).toBe(0);
      expect(pool.available()).toBe(0);
      expect(pool.pending()).toBe(0);
    });

    it('should create a pool with custom configuration', () => {
      pool = new ChannelPool(connection, {
        min: 2,
        max: 5,
        acquireTimeout: 3000,
        evictionInterval: 60000,
      });

      expect(pool).toBeDefined();
      expect(pool.size()).toBe(0);
    });

    it('should accept a custom logger', () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      pool = new ChannelPool(connection, undefined, logger);

      expect(pool).toBeDefined();
    });
  });

  describe('acquire', () => {
    beforeEach(() => {
      pool = new ChannelPool(connection, { min: 1, max: 3 });
    });

    it('should create and acquire a new channel when pool is empty', async () => {
      const mockChannel = createMockChannel();
      (connection.createConfirmChannel as any).mockResolvedValue(mockChannel);

      const channel = await pool.acquire();

      expect(channel).toBe(mockChannel);
      expect(pool.size()).toBe(1);
      expect(pool.available()).toBe(0);
      expect(connection.createConfirmChannel).toHaveBeenCalledTimes(1);
    });

    it('should reuse available channel', async () => {
      const mockChannel = createMockChannel();
      (connection.createConfirmChannel as any).mockResolvedValue(mockChannel);

      // Acquire and release
      const channel1 = await pool.acquire();
      pool.release(channel1);

      expect(pool.available()).toBe(1);

      // Acquire again - should reuse
      const channel2 = await pool.acquire();

      expect(channel2).toBe(mockChannel);
      expect(connection.createConfirmChannel).toHaveBeenCalledTimes(1); // Only called once
      expect(pool.size()).toBe(1);
    });

    it('should create multiple channels up to max limit', async () => {
      const mockChannel1 = createMockChannel();
      const mockChannel2 = createMockChannel();
      const mockChannel3 = createMockChannel();

      (connection.createConfirmChannel as any)
        .mockResolvedValueOnce(mockChannel1)
        .mockResolvedValueOnce(mockChannel2)
        .mockResolvedValueOnce(mockChannel3);

      const channel1 = await pool.acquire();
      const channel2 = await pool.acquire();
      const channel3 = await pool.acquire();

      expect(pool.size()).toBe(3);
      expect(pool.available()).toBe(0);
      expect(connection.createConfirmChannel).toHaveBeenCalledTimes(3);
    });

    it('should wait when max channels reached', async () => {
      pool = new ChannelPool(connection, { min: 1, max: 2, acquireTimeout: 1000 });

      const mockChannel1 = createMockChannel();
      const mockChannel2 = createMockChannel();

      (connection.createConfirmChannel as any)
        .mockResolvedValueOnce(mockChannel1)
        .mockResolvedValueOnce(mockChannel2);

      // Acquire all channels
      const channel1 = await pool.acquire();
      const channel2 = await pool.acquire();

      expect(pool.size()).toBe(2);
      expect(pool.available()).toBe(0);

      // Third acquire should wait
      const acquirePromise = pool.acquire();

      expect(pool.pending()).toBe(1);

      // Release one channel
      setTimeout(() => pool.release(channel1), 100);

      const channel3 = await acquirePromise;

      expect(channel3).toBe(mockChannel1); // Reused
      expect(pool.pending()).toBe(0);
    });

    it('should timeout when waiting too long', async () => {
      pool = new ChannelPool(connection, { min: 1, max: 1, acquireTimeout: 100 });

      const mockChannel = createMockChannel();
      (connection.createConfirmChannel as any).mockResolvedValue(mockChannel);

      // Acquire the only channel
      await pool.acquire();

      // Try to acquire again - should timeout
      await expect(pool.acquire()).rejects.toThrow('Channel acquire timeout');
    });

    it('should recreate unhealthy channels', async () => {
      const unhealthyChannel = createMockChannel();
      const healthyChannel = createMockChannel();

      // First channel will be unhealthy
      unhealthyChannel.checkQueue = vi.fn().mockRejectedValue(new Error('Channel closed'));

      (connection.createConfirmChannel as any)
        .mockResolvedValueOnce(unhealthyChannel)
        .mockResolvedValueOnce(healthyChannel);

      // First acquire
      const channel1 = await pool.acquire();
      pool.release(channel1);

      // Second acquire should detect unhealthy channel and create new one
      const channel2 = await pool.acquire();

      expect(channel2).toBe(healthyChannel);
      expect(unhealthyChannel.close).toHaveBeenCalled();
    });

    it('should throw error when pool is draining', async () => {
      const mockChannel = createMockChannel();
      (connection.createConfirmChannel as any).mockResolvedValue(mockChannel);

      // Start draining
      const drainPromise = pool.drain();

      // Try to acquire - should fail
      await expect(pool.acquire()).rejects.toThrow('Channel pool is draining');

      await drainPromise;
    });

    it('should handle channel creation errors', async () => {
      (connection.createConfirmChannel as any).mockRejectedValue(new Error('Connection error'));

      await expect(pool.acquire()).rejects.toThrow('Failed to create channel');
    });
  });

  describe('release', () => {
    beforeEach(() => {
      pool = new ChannelPool(connection, { min: 1, max: 3 });
    });

    it('should release a channel back to the pool', async () => {
      const mockChannel = createMockChannel();
      (connection.createConfirmChannel as any).mockResolvedValue(mockChannel);

      const channel = await pool.acquire();

      expect(pool.available()).toBe(0);

      pool.release(channel);

      expect(pool.available()).toBe(1);
    });

    it('should warn when releasing unknown channel', async () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      pool = new ChannelPool(connection, undefined, logger);

      const unknownChannel = createMockChannel();

      pool.release(unknownChannel);

      expect(logger.warn).toHaveBeenCalledWith('Attempted to release unknown channel');
    });

    it('should serve pending acquire when releasing', async () => {
      pool = new ChannelPool(connection, { min: 1, max: 1, acquireTimeout: 5000 });

      const mockChannel = createMockChannel();
      (connection.createConfirmChannel as any).mockResolvedValue(mockChannel);

      // Acquire the only channel
      const channel1 = await pool.acquire();

      // Try to acquire again - will wait
      const acquirePromise = pool.acquire();

      expect(pool.pending()).toBe(1);

      // Release should immediately serve pending acquire
      pool.release(channel1);

      const channel2 = await acquirePromise;

      expect(channel2).toBe(mockChannel);
      expect(pool.pending()).toBe(0);
      expect(pool.available()).toBe(0); // Channel is in use again
    });
  });

  describe('destroy', () => {
    beforeEach(() => {
      pool = new ChannelPool(connection, { min: 1, max: 3 });
    });

    it('should destroy a specific channel', async () => {
      const mockChannel = createMockChannel();
      (connection.createConfirmChannel as any).mockResolvedValue(mockChannel);

      const channel = await pool.acquire();

      expect(pool.size()).toBe(1);

      await pool.destroy(channel);

      expect(pool.size()).toBe(0);
      expect(mockChannel.close).toHaveBeenCalled();
    });

    it('should handle unknown channel gracefully', async () => {
      const unknownChannel = createMockChannel();

      await expect(pool.destroy(unknownChannel)).resolves.not.toThrow();
    });

    it('should handle channel close errors', async () => {
      const mockChannel = createMockChannel();
      mockChannel.close = vi.fn().mockRejectedValue(new Error('Close error'));

      (connection.createConfirmChannel as any).mockResolvedValue(mockChannel);

      const channel = await pool.acquire();

      // Should not throw
      await expect(pool.destroy(channel)).resolves.not.toThrow();
      expect(pool.size()).toBe(0);
    });
  });

  describe('size, available, pending', () => {
    beforeEach(() => {
      pool = new ChannelPool(connection, { min: 1, max: 3 });
    });

    it('should return correct pool statistics', async () => {
      const mockChannel1 = createMockChannel();
      const mockChannel2 = createMockChannel();

      (connection.createConfirmChannel as any)
        .mockResolvedValueOnce(mockChannel1)
        .mockResolvedValueOnce(mockChannel2);

      expect(pool.size()).toBe(0);
      expect(pool.available()).toBe(0);
      expect(pool.pending()).toBe(0);

      const channel1 = await pool.acquire();

      expect(pool.size()).toBe(1);
      expect(pool.available()).toBe(0);

      pool.release(channel1);

      expect(pool.size()).toBe(1);
      expect(pool.available()).toBe(1);

      const channel2 = await pool.acquire();

      // Channel2 should reuse channel1 since it's available
      expect(pool.size()).toBe(1);
      expect(pool.available()).toBe(0);
      expect(channel2).toBe(mockChannel1);
    });
  });

  describe('drain', () => {
    beforeEach(() => {
      pool = new ChannelPool(connection, { min: 1, max: 3 });
    });

    it('should drain all channels', async () => {
      const mockChannel1 = createMockChannel();
      const mockChannel2 = createMockChannel();

      (connection.createConfirmChannel as any)
        .mockResolvedValueOnce(mockChannel1)
        .mockResolvedValueOnce(mockChannel2);

      const channel1 = await pool.acquire();
      const channel2 = await pool.acquire();

      pool.release(channel1);
      pool.release(channel2);

      expect(pool.size()).toBe(2);

      await pool.drain();

      expect(pool.size()).toBe(0);
      expect(mockChannel1.close).toHaveBeenCalled();
      expect(mockChannel2.close).toHaveBeenCalled();
    });
  });

  describe('channel events', () => {
    beforeEach(() => {
      pool = new ChannelPool(connection, { min: 1, max: 3 });
    });

    it('should register error handler on channel creation', async () => {
      const mockChannel = createMockChannel();
      (connection.createConfirmChannel as any).mockResolvedValue(mockChannel);

      await pool.acquire();

      expect(mockChannel.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should register close handler on channel creation', async () => {
      const mockChannel = createMockChannel();
      (connection.createConfirmChannel as any).mockResolvedValue(mockChannel);

      await pool.acquire();

      expect(mockChannel.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should remove channel from pool when closed', async () => {
      const mockChannel = createMockChannel();
      let closeHandler: (() => void) | null = null;

      mockChannel.on = vi.fn((event: string, handler: () => void) => {
        if (event === 'close') {
          closeHandler = handler;
        }
        return mockChannel;
      }) as any;

      (connection.createConfirmChannel as any).mockResolvedValue(mockChannel);

      await pool.acquire();

      expect(pool.size()).toBe(1);

      // Simulate channel close
      closeHandler!();

      expect(pool.size()).toBe(0);
    });

    it('should log errors on channel error event', async () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      pool = new ChannelPool(connection, undefined, logger);

      const mockChannel = createMockChannel();
      let errorHandler: ((error: Error) => void) | null = null;

      mockChannel.on = vi.fn((event: string, handler: (error: Error) => void) => {
        if (event === 'error') {
          errorHandler = handler;
        }
        return mockChannel;
      }) as any;

      (connection.createConfirmChannel as any).mockResolvedValue(mockChannel);

      await pool.acquire();

      // Simulate channel error
      errorHandler!(new Error('Test error'));

      expect(logger.error).toHaveBeenCalledWith('Channel error', expect.any(Error));
    });

    it('should log debug message on channel close event', async () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      pool = new ChannelPool(connection, undefined, logger);

      const mockChannel = createMockChannel();
      let closeHandler: (() => void) | null = null;

      mockChannel.on = vi.fn((event: string, handler: () => void) => {
        if (event === 'close') {
          closeHandler = handler;
        }
        return mockChannel;
      }) as any;

      (connection.createConfirmChannel as any).mockResolvedValue(mockChannel);

      await pool.acquire();

      // Simulate channel close
      closeHandler!();

      expect(logger.debug).toHaveBeenCalledWith('Channel closed');
    });
  });

  describe('edge cases', () => {
    it('should handle rapid acquire/release cycles', async () => {
      pool = new ChannelPool(connection, { min: 1, max: 2 });

      const mockChannel = createMockChannel();
      (connection.createConfirmChannel as any).mockResolvedValue(mockChannel);

      for (let i = 0; i < 10; i++) {
        const channel = await pool.acquire();
        pool.release(channel);
      }

      expect(pool.size()).toBeGreaterThan(0);
      expect(pool.available()).toBeGreaterThan(0);
    });

    it('should handle concurrent acquires', async () => {
      pool = new ChannelPool(connection, { min: 1, max: 5 });

      const channels = Array.from({ length: 5 }, () => createMockChannel());
      (connection.createConfirmChannel as any)
        .mockResolvedValueOnce(channels[0])
        .mockResolvedValueOnce(channels[1])
        .mockResolvedValueOnce(channels[2])
        .mockResolvedValueOnce(channels[3])
        .mockResolvedValueOnce(channels[4]);

      const acquires = Promise.all([
        pool.acquire(),
        pool.acquire(),
        pool.acquire(),
        pool.acquire(),
        pool.acquire(),
      ]);

      const results = await acquires;

      expect(results).toHaveLength(5);
      expect(pool.size()).toBe(5);
    });
  });
});
