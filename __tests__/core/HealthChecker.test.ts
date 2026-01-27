import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HealthChecker } from '../../src/core/health/HealthChecker';
import { ConnectionManager } from '../../src/core/connection/ConnectionManager';

// Mock ConnectionManager
vi.mock('../../src/core/connection/ConnectionManager', () => {
  const mockGetConnectionStatus = vi.fn();
  const mockGetChannelCount = vi.fn();

  return {
    ConnectionManager: vi.fn(() => ({
      getConnectionStatus: mockGetConnectionStatus,
      getChannelCount: mockGetChannelCount,
    })),
  };
});

describe('HealthChecker', () => {
  let healthChecker: HealthChecker;
  let mockConnectionManager: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConnectionManager = new ConnectionManager({ url: 'amqp://localhost' });

    healthChecker = new HealthChecker({
      connection: mockConnectionManager,
    });
  });

  describe('check()', () => {
    it('should return healthy status when connection is up and channels are open', async () => {
      mockConnectionManager.getConnectionStatus.mockReturnValue({
        connected: true,
        connectedAt: new Date(),
        url: 'amqp://localhost',
      });
      mockConnectionManager.getChannelCount.mockReturnValue(2);

      const result = await healthChecker.check();

      expect(result.status).toBe('healthy');
      expect(result.checks.connection.status).toBe('up');
      expect(result.checks.channel.status).toBe('open');
      expect(result.checks.channel.count).toBe(2);
      expect(result.errors).toBeUndefined();
    });

    it('should return degraded status when connection is up but no channels', async () => {
      mockConnectionManager.getConnectionStatus.mockReturnValue({
        connected: true,
        connectedAt: new Date(),
        url: 'amqp://localhost',
      });
      mockConnectionManager.getChannelCount.mockReturnValue(0);

      const result = await healthChecker.check();

      expect(result.status).toBe('degraded');
      expect(result.checks.connection.status).toBe('up');
      expect(result.checks.channel.status).toBe('closed');
      expect(result.checks.channel.count).toBe(0);
      expect(result.errors).toContain('No active channels (connection up but no channels open)');
    });

    it('should return unhealthy status when connection is down', async () => {
      mockConnectionManager.getConnectionStatus.mockReturnValue({
        connected: false,
        connectedAt: null,
        url: 'amqp://localhost',
      });
      mockConnectionManager.getChannelCount.mockReturnValue(0);

      const result = await healthChecker.check();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.connection.status).toBe('down');
      expect(result.checks.channel.status).toBe('closed');
      expect(result.errors).toContain('RabbitMQ connection is down');
    });

    it('should include timestamp and uptime in result', async () => {
      mockConnectionManager.getConnectionStatus.mockReturnValue({
        connected: true,
        connectedAt: new Date(),
        url: 'amqp://localhost',
      });
      mockConnectionManager.getChannelCount.mockReturnValue(1);

      const beforeCheck = Date.now();
      const result = await healthChecker.check();
      const afterCheck = Date.now();

      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(beforeCheck);
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(afterCheck);
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(typeof result.uptime).toBe('number');
    });

    it('should track consumer count when servers are registered', async () => {
      mockConnectionManager.getConnectionStatus.mockReturnValue({
        connected: true,
        connectedAt: new Date(),
        url: 'amqp://localhost',
      });
      mockConnectionManager.getChannelCount.mockReturnValue(1);

      // Mock RpcServer
      const mockServer = {
        getConsumerCount: vi.fn().mockReturnValue(1),
      } as any;

      healthChecker.registerServer(mockServer);

      const result = await healthChecker.check();

      expect(result.checks.consumers.count).toBe(1);
      expect(result.checks.consumers.active).toBe(1);
    });

    it('should track multiple servers', async () => {
      mockConnectionManager.getConnectionStatus.mockReturnValue({
        connected: true,
        connectedAt: new Date(),
        url: 'amqp://localhost',
      });
      mockConnectionManager.getChannelCount.mockReturnValue(1);

      const mockServer1 = {
        getConsumerCount: vi.fn().mockReturnValue(1),
      } as any;

      const mockServer2 = {
        getConsumerCount: vi.fn().mockReturnValue(0),
      } as any;

      const mockServer3 = {
        getConsumerCount: vi.fn().mockReturnValue(1),
      } as any;

      healthChecker.registerServer(mockServer1);
      healthChecker.registerServer(mockServer2);
      healthChecker.registerServer(mockServer3);

      const result = await healthChecker.check();

      expect(result.checks.consumers.count).toBe(3);
      expect(result.checks.consumers.active).toBe(2);
    });
  });

  describe('registerServer()', () => {
    it('should register a server for monitoring', async () => {
      mockConnectionManager.getConnectionStatus.mockReturnValue({
        connected: true,
        connectedAt: new Date(),
        url: 'amqp://localhost',
      });
      mockConnectionManager.getChannelCount.mockReturnValue(1);

      const mockServer = {
        getConsumerCount: vi.fn().mockReturnValue(1),
      } as any;

      healthChecker.registerServer(mockServer);

      const result = await healthChecker.check();

      expect(result.checks.consumers.count).toBe(1);
      expect(mockServer.getConsumerCount).toHaveBeenCalled();
    });

    it('should not register the same server twice', async () => {
      mockConnectionManager.getConnectionStatus.mockReturnValue({
        connected: true,
        connectedAt: new Date(),
        url: 'amqp://localhost',
      });
      mockConnectionManager.getChannelCount.mockReturnValue(1);

      const mockServer = {
        getConsumerCount: vi.fn().mockReturnValue(1),
      } as any;

      healthChecker.registerServer(mockServer);
      healthChecker.registerServer(mockServer);

      const result = await healthChecker.check();

      expect(result.checks.consumers.count).toBe(1);
    });
  });

  describe('unregisterServer()', () => {
    it('should unregister a server from monitoring', async () => {
      mockConnectionManager.getConnectionStatus.mockReturnValue({
        connected: true,
        connectedAt: new Date(),
        url: 'amqp://localhost',
      });
      mockConnectionManager.getChannelCount.mockReturnValue(1);

      const mockServer = {
        getConsumerCount: vi.fn().mockReturnValue(1),
      } as any;

      healthChecker.registerServer(mockServer);
      healthChecker.unregisterServer(mockServer);

      const result = await healthChecker.check();

      expect(result.checks.consumers.count).toBe(0);
    });

    it('should do nothing if server is not registered', async () => {
      mockConnectionManager.getConnectionStatus.mockReturnValue({
        connected: true,
        connectedAt: new Date(),
        url: 'amqp://localhost',
      });
      mockConnectionManager.getChannelCount.mockReturnValue(1);

      const mockServer = {
        getConsumerCount: vi.fn().mockReturnValue(1),
      } as any;

      // Should not throw
      healthChecker.unregisterServer(mockServer);

      const result = await healthChecker.check();
      expect(result.checks.consumers.count).toBe(0);
    });
  });

  describe('isHealthy()', () => {
    it('should return true when status is healthy', async () => {
      mockConnectionManager.getConnectionStatus.mockReturnValue({
        connected: true,
        connectedAt: new Date(),
        url: 'amqp://localhost',
      });
      mockConnectionManager.getChannelCount.mockReturnValue(1);

      const result = await healthChecker.isHealthy();

      expect(result).toBe(true);
    });

    it('should return false when status is degraded', async () => {
      mockConnectionManager.getConnectionStatus.mockReturnValue({
        connected: true,
        connectedAt: new Date(),
        url: 'amqp://localhost',
      });
      mockConnectionManager.getChannelCount.mockReturnValue(0);

      const result = await healthChecker.isHealthy();

      expect(result).toBe(false);
    });

    it('should return false when status is unhealthy', async () => {
      mockConnectionManager.getConnectionStatus.mockReturnValue({
        connected: false,
        connectedAt: null,
        url: 'amqp://localhost',
      });
      mockConnectionManager.getChannelCount.mockReturnValue(0);

      const result = await healthChecker.isHealthy();

      expect(result).toBe(false);
    });
  });

  describe('getUptime()', () => {
    it('should return uptime in milliseconds', async () => {
      const uptime1 = healthChecker.getUptime();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      const uptime2 = healthChecker.getUptime();

      expect(uptime1).toBeGreaterThanOrEqual(0);
      expect(uptime2).toBeGreaterThan(uptime1);
    });
  });

  describe('constructor with servers', () => {
    it('should accept servers in constructor config', async () => {
      mockConnectionManager.getConnectionStatus.mockReturnValue({
        connected: true,
        connectedAt: new Date(),
        url: 'amqp://localhost',
      });
      mockConnectionManager.getChannelCount.mockReturnValue(1);

      const mockServer = {
        getConsumerCount: vi.fn().mockReturnValue(1),
      } as any;

      const connection = new ConnectionManager({ url: 'amqp://localhost' });

      const checker = new HealthChecker({
        connection,
        servers: [mockServer],
      });

      const result = await checker.check();

      expect(result.checks.consumers.count).toBe(1);
      expect(result.checks.consumers.active).toBe(1);
    });
  });
});
