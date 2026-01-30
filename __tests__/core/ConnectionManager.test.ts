import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { ConnectionManager } from '../../src/core/connection/ConnectionManager';

// Mock amqplib
vi.mock('amqplib', () => {
  const mockChannel = {
    assertQueue: vi.fn().mockResolvedValue({}),
    assertExchange: vi.fn().mockResolvedValue({}),
    bindQueue: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue({}),
    on: vi.fn(),
  };

  const mockConnection = new EventEmitter();
  (mockConnection as any).createChannel = vi.fn().mockResolvedValue(mockChannel);
  (mockConnection as any).createConfirmChannel = vi.fn().mockResolvedValue(mockChannel);
  (mockConnection as any).close = vi.fn().mockResolvedValue(undefined);

  return {
    connect: vi.fn().mockResolvedValue(mockConnection),
  };
});

describe('ConnectionManager', () => {
  let connectionManager: ConnectionManager;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (connectionManager) {
      await connectionManager.close().catch(() => {});
    }
  });

  describe('retry logic', () => {
    it('should retry connection on network errors with default config', async () => {
      const amqplib = await import('amqplib');
      let attemptCount = 0;

      const mockConn = new EventEmitter();
      (mockConn as any).createChannel = vi.fn().mockResolvedValue({});
      (mockConn as any).close = vi.fn().mockResolvedValue(undefined);

      (amqplib.connect as any).mockImplementation(async () => {
        attemptCount++;
        if (attemptCount <= 2) {
          const error: any = new Error('ECONNREFUSED');
          error.code = 'ECONNREFUSED';
          throw error;
        }
        return mockConn;
      });

      connectionManager = new ConnectionManager({
        enableCircuitBreaker: false,
        url: 'amqp://localhost',
        retry: {
          enabled: true,
          maxAttempts: 3,
          initialDelay: 1,
          retryableErrors: [/ECONNREFUSED|Failed to connect/],
        },
      });

      const connection = await connectionManager.getConnection();

      expect(attemptCount).toBe(3);
      expect(connection).toBe(mockConn);
    });

    it('should throw after max retry attempts', async () => {
      const amqplib = await import('amqplib');
      let attemptCount = 0;

      (amqplib.connect as any).mockImplementation(async () => {
        attemptCount++;
        const error: any = new Error('ECONNREFUSED');
        error.code = 'ECONNREFUSED';
        throw error;
      });

      connectionManager = new ConnectionManager({
        enableCircuitBreaker: false,
        url: 'amqp://localhost',
        retry: {
          enabled: true,
          maxAttempts: 2,
          initialDelay: 1,
          retryableErrors: [/ECONNREFUSED|Failed to connect/],
        },
      });

      await expect(connectionManager.getConnection()).rejects.toThrow();
      expect(attemptCount).toBe(2);
    });

    it('should retry on ETIMEDOUT errors', async () => {
      const amqplib = await import('amqplib');
      let attemptCount = 0;

      const mockConn = new EventEmitter();
      (mockConn as any).createChannel = vi.fn().mockResolvedValue({});
      (mockConn as any).close = vi.fn().mockResolvedValue(undefined);

      (amqplib.connect as any).mockImplementation(async () => {
        attemptCount++;
        if (attemptCount <= 2) {
          const error: any = new Error('ETIMEDOUT');
          error.code = 'ETIMEDOUT';
          throw error;
        }
        return mockConn;
      });

      connectionManager = new ConnectionManager({
        enableCircuitBreaker: false,
        url: 'amqp://localhost',
        retry: {
          enabled: true,
          maxAttempts: 3,
          initialDelay: 1,
          retryableErrors: [/ETIMEDOUT|Failed to connect/],
        },
      });

      const connection = await connectionManager.getConnection();

      expect(attemptCount).toBe(3);
      expect(connection).toBe(mockConn);
    });

    it('should not retry on non-network errors', async () => {
      const amqplib = await import('amqplib');
      let attemptCount = 0;

      (amqplib.connect as any).mockImplementation(async () => {
        attemptCount++;
        throw new Error('Authentication failed');
      });

      connectionManager = new ConnectionManager({
        enableCircuitBreaker: false,
        url: 'amqp://localhost',
        retry: {
          enabled: true,
          maxAttempts: 3,
          initialDelay: 1,
        },
      });

      await expect(connectionManager.getConnection()).rejects.toThrow();
      expect(attemptCount).toBe(1); // Should not retry non-network errors
    });

    it('should allow custom retryable errors', async () => {
      const amqplib = await import('amqplib');
      let attemptCount = 0;

      const mockConn = new EventEmitter();
      (mockConn as any).createChannel = vi.fn().mockResolvedValue({});
      (mockConn as any).close = vi.fn().mockResolvedValue(undefined);

      (amqplib.connect as any).mockImplementation(async () => {
        attemptCount++;
        if (attemptCount <= 2) {
          throw new Error('Custom retryable error');
        }
        return mockConn;
      });

      connectionManager = new ConnectionManager({
        enableCircuitBreaker: false,
        url: 'amqp://localhost',
        retry: {
          enabled: true,
          maxAttempts: 3,
          initialDelay: 1,
          retryableErrors: [/Custom retryable|Failed to connect/],
        },
      });

      const connection = await connectionManager.getConnection();

      expect(attemptCount).toBe(3);
      expect(connection).toBe(mockConn);
    });

    it('should work without retry when disabled', async () => {
      const amqplib = await import('amqplib');
      let attemptCount = 0;

      (amqplib.connect as any).mockImplementation(async () => {
        attemptCount++;
        const error = new Error('Connection refused');
        (error as any).code = 'ECONNREFUSED';
        throw error;
      });

      connectionManager = new ConnectionManager({
        enableCircuitBreaker: false,
        url: 'amqp://localhost',
        retry: {
          enabled: false,
        },
      });

      await expect(connectionManager.getConnection()).rejects.toThrow();
      expect(attemptCount).toBe(1); // Should not retry when disabled
    });
  });

  describe('basic functionality', () => {
    it('should connect successfully', async () => {
      const amqplib = await import('amqplib');
      const mockConn = new EventEmitter();
      (mockConn as any).createChannel = vi.fn().mockResolvedValue({});
      (mockConn as any).close = vi.fn().mockResolvedValue(undefined);

      (amqplib.connect as any).mockResolvedValue(mockConn);

      connectionManager = new ConnectionManager({
        enableCircuitBreaker: false,
        url: 'amqp://localhost',
      });

      const connection = await connectionManager.getConnection();
      expect(connection).toBe(mockConn);
    });

    it('should reuse existing connection', async () => {
      const amqplib = await import('amqplib');
      const mockConn = new EventEmitter();
      (mockConn as any).createChannel = vi.fn().mockResolvedValue({});
      (mockConn as any).close = vi.fn().mockResolvedValue(undefined);

      (amqplib.connect as any).mockResolvedValue(mockConn);

      connectionManager = new ConnectionManager({
        enableCircuitBreaker: false,
        url: 'amqp://localhost',
      });

      const connection1 = await connectionManager.getConnection();
      const connection2 = await connectionManager.getConnection();

      expect(connection1).toBe(connection2);
      expect(amqplib.connect).toHaveBeenCalledTimes(1);
    });
  });
});
