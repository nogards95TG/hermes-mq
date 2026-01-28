import { ConnectionManager } from '../connection/ConnectionManager';
import { RpcServer } from '../../server/rpc/RpcServer';
import { Subscriber } from '../../server/pubsub/Subscriber';

/**
 * Health check status
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Connection health details
 */
export interface ConnectionHealth {
  status: 'up' | 'down';
  connectedAt?: Date;
  url: string;
}

/**
 * Channel health details
 */
export interface ChannelHealth {
  status: 'open' | 'closed';
  count: number;
}

/**
 * Consumer health details
 */
export interface ConsumerHealth {
  count: number;
  active: number;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  status: HealthStatus;
  timestamp: Date;
  checks: {
    connection: ConnectionHealth;
    channel: ChannelHealth;
    consumers: ConsumerHealth;
  };
  uptime: number;
  errors?: string[];
}

/**
 * Health checker configuration
 */
export interface HealthCheckerConfig {
  /**
   * Connection manager instance
   */
  connection: ConnectionManager;
  servers?: (RpcServer | Subscriber)[];
}

/**
 * HealthChecker provides health check functionality for Hermes MQ
 *
 * Monitors connection status, channel health, and consumer activity.
 * Useful for Kubernetes liveness/readiness probes and monitoring systems.
 *
 * @example
 * ```typescript
 * import { HealthChecker, ConnectionManager } from 'hermes-mq';
 *
 * const connection = new ConnectionManager({ url: 'amqp://localhost' });
 *
 * const health = new HealthChecker({
 *   connection
 * });
 *
 * const result = await health.check();
 * console.log(result.status); // 'healthy' | 'degraded' | 'unhealthy'
 *
 * // Express integration
 * app.get('/health', async (req, res) => {
 *   const result = await health.check();
 *   res.status(result.status === 'healthy' ? 200 : 503).json(result);
 * });
 * ```
 */
export class HealthChecker {
  private connectionManager: ConnectionManager;
  private servers: (RpcServer | Subscriber)[];
  private startTime: Date;

  constructor(config: HealthCheckerConfig) {
    this.connectionManager = config.connection;
    this.servers = config.servers || [];
    this.startTime = new Date();
  }

  /**
   * Register a server or subscriber for health monitoring
   */
  registerServer(server: RpcServer | Subscriber): void {
    if (!this.servers.includes(server)) {
      this.servers.push(server);
    }
  }

  /**
   * Unregister a server or subscriber from health monitoring
   */
  unregisterServer(server: RpcServer | Subscriber): void {
    const index = this.servers.indexOf(server);
    if (index !== -1) {
      this.servers.splice(index, 1);
    }
  }

  /**
   * Perform health check
   *
   * Returns comprehensive health status including connection, channels, and consumers.
   * Status determination:
   * - healthy: Connection UP + at least 1 channel open
   * - degraded: Connection UP but no channels (warning state)
   * - unhealthy: Connection DOWN
   *
   * @returns Promise that resolves to health check result
   */
  async check(): Promise<HealthCheckResult> {
    const timestamp = new Date();
    const errors: string[] = [];
    let status: HealthStatus = 'healthy';

    // Check connection
    const connectionStatus = this.connectionManager.getConnectionStatus();
    const connectionHealth: ConnectionHealth = {
      status: connectionStatus.connected ? 'up' : 'down',
      connectedAt: connectionStatus.connectedAt || undefined,
      url: connectionStatus.url,
    };

    if (!connectionStatus.connected) {
      status = 'unhealthy';
      errors.push('RabbitMQ connection is down');
    }

    // Check channels
    const channelCount = this.connectionManager.getChannelCount();
    const channelHealth: ChannelHealth = {
      status: channelCount > 0 ? 'open' : 'closed',
      count: channelCount,
    };

    if (connectionStatus.connected && channelCount === 0) {
      status = 'degraded';
      errors.push('No active channels (connection up but no channels open)');
    }

    // Check consumers
    let totalConsumers = 0;
    let activeConsumers = 0;

    for (const server of this.servers) {
      if ('getConsumerCount' in server) {
        const count = server.getConsumerCount();
        totalConsumers++;
        if (count > 0) {
          activeConsumers++;
        }
      }
    }

    const consumerHealth: ConsumerHealth = {
      count: totalConsumers,
      active: activeConsumers,
    };

    // Calculate uptime
    const uptime = timestamp.getTime() - this.startTime.getTime();

    return {
      status,
      timestamp,
      checks: {
        connection: connectionHealth,
        channel: channelHealth,
        consumers: consumerHealth,
      },
      uptime,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Simple boolean health check
   *
   * @returns true if status is 'healthy', false otherwise
   */
  async isHealthy(): Promise<boolean> {
    const result = await this.check();
    return result.status === 'healthy';
  }

  /**
   * Get uptime in milliseconds
   *
   * @returns Time since HealthChecker was created
   */
  getUptime(): number {
    return Date.now() - this.startTime.getTime();
  }
}
