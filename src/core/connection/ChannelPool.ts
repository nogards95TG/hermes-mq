import * as amqp from 'amqplib';
import { Logger, SilentLogger } from '../types/Logger';
import { ChannelError } from '../types/Errors';
import { TIME } from '../constants';

/**
 * Channel pool configuration
 */
export interface ChannelPoolConfig {
  min?: number;
  max?: number;
  acquireTimeout?: number;
  evictionInterval?: number;
}

/**
 * Default channel pool configuration
 */
const DEFAULT_POOL_CONFIG: Required<ChannelPoolConfig> = {
  min: 1,
  max: 10,
  acquireTimeout: TIME.CHANNEL_POOL_ACQUIRE_TIMEOUT_MS,
  evictionInterval: TIME.CHANNEL_POOL_EVICTION_INTERVAL_MS,
};

/**
 * Channel wrapper with health status
 */
interface ChannelWrapper {
  channel: amqp.ConfirmChannel;
  inUse: boolean;
  created: number;
  lastUsed: number;
}

/**
 * ChannelPool manages a pool of RabbitMQ channels
 */
export class ChannelPool {
  private connection: amqp.Connection;
  private config: Required<ChannelPoolConfig>;
  private logger: Logger;
  private channels: ChannelWrapper[] = [];
  private pendingAcquires: Array<{
    resolve: (channel: amqp.ConfirmChannel) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = [];
  private evictionTimer: NodeJS.Timeout | null = null;
  private isDraining = false;

  constructor(connection: amqp.Connection, config?: ChannelPoolConfig, logger?: Logger) {
    this.connection = connection;
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
    this.logger = logger || new SilentLogger();

    this.startEvictionTimer();
  }

  /**
   * Acquire a channel from the pool
   */
  async acquire(): Promise<amqp.ConfirmChannel> {
    if (this.isDraining) {
      throw ChannelError.poolDraining('Channel pool is draining');
    }

    // Try to find available channel
    const available = this.channels.find((w) => !w.inUse);
    if (available) {
      if (await this.isChannelHealthy(available.channel)) {
        available.inUse = true;
        available.lastUsed = Date.now();
        return available.channel;
      } else {
        // Channel is broken, destroy and create new one
        await this.destroyWrapper(available);
      }
    }

    // Create new channel if under max limit
    if (this.channels.length < this.config.max) {
      const channel = await this.createChannel();
      const wrapper: ChannelWrapper = {
        channel,
        inUse: true,
        created: Date.now(),
        lastUsed: Date.now(),
      };
      this.channels.push(wrapper);
      return channel;
    }

    // Wait for channel to become available
    return new Promise<amqp.ConfirmChannel>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.pendingAcquires.findIndex((p) => p.resolve === resolve);
        if (index !== -1) {
          this.pendingAcquires.splice(index, 1);
        }
        reject(ChannelError.timeout('Channel acquire timeout', { timeout: this.config.acquireTimeout }));
      }, this.config.acquireTimeout);

      this.pendingAcquires.push({ resolve, reject, timeout });
    });
  }

  /**
   * Release a channel back to the pool
   */
  release(channel: amqp.ConfirmChannel): void {
    const wrapper = this.channels.find((w) => w.channel === channel);
    if (!wrapper) {
      this.logger.warn('Attempted to release unknown channel');
      return;
    }

    wrapper.inUse = false;
    wrapper.lastUsed = Date.now();

    // Serve pending acquire if any
    if (this.pendingAcquires.length > 0) {
      const pending = this.pendingAcquires.shift();
      if (pending) {
        clearTimeout(pending.timeout);
        wrapper.inUse = true;
        pending.resolve(channel);
      }
    }
  }

  /**
   * Destroy a specific channel
   */
  async destroy(channel: amqp.ConfirmChannel): Promise<void> {
    const wrapper = this.channels.find((w) => w.channel === channel);
    if (wrapper) {
      await this.destroyWrapper(wrapper);
    }
  }

  /**
   * Get pool statistics
   */
  size(): number {
    return this.channels.length;
  }

  available(): number {
    return this.channels.filter((w) => !w.inUse).length;
  }

  pending(): number {
    return this.pendingAcquires.length;
  }

  /**
   * Drain all channels and stop accepting new acquires
   */
  async drain(): Promise<void> {
    this.isDraining = true;

    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }

    // Reject all pending acquires
    for (const pending of this.pendingAcquires) {
      clearTimeout(pending.timeout);
      pending.reject(ChannelError.poolDraining('Pool is draining'));
    }
    this.pendingAcquires = [];

    // Wait for all channels to be released
    const maxWait = TIME.CHANNEL_POOL_MAX_WAIT_MS;
    const startTime = Date.now();
    while (this.channels.some((w) => w.inUse)) {
      if (Date.now() - startTime > maxWait) {
        this.logger.warn('Drain timeout exceeded, forcing channel closure');
        break;
      }
      await this.sleep(100);
    }

    // Destroy all channels
    await Promise.all(this.channels.map((w) => this.destroyWrapper(w)));
    this.channels = [];
  }

  /**
   * Create a new channel
   */
  private async createChannel(): Promise<amqp.ConfirmChannel> {
    try {
      const channel = (await (
        this.connection as any
      ).createConfirmChannel()) as amqp.ConfirmChannel;

      channel.on('error', (error: Error) => {
        this.logger.error('Channel error', error);
      });

      channel.on('close', () => {
        this.logger.debug('Channel closed');
        // Remove from pool
        const index = this.channels.findIndex((w) => w.channel === channel);
        if (index !== -1) {
          this.channels.splice(index, 1);
        }
      });

      return channel;
    } catch (error) {
      throw ChannelError.creationFailed('Failed to create channel', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Check if channel is healthy
   */
  private async isChannelHealthy(channel: amqp.ConfirmChannel): Promise<boolean> {
    try {
      // Simple health check: try to check queue (will throw if channel is closed)
      await channel.checkQueue('amq.rabbitmq.reply-to');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Destroy channel wrapper and remove it from the pool.
   *
   * @remarks
   * Channel close errors are intentionally caught and logged at WARN level
   * (not DEBUG) because they may indicate issues during cleanup/eviction.
   * The channel is removed from the pool regardless of close success.
   */
  private async destroyWrapper(wrapper: ChannelWrapper): Promise<void> {
    try {
      await wrapper.channel.close();
    } catch (error) {
      // Intentionally suppressed: channel close errors during cleanup/eviction are not critical
      // However, we log at WARN level for visibility in production
      this.logger.warn('Error closing channel during cleanup', {
        error: (error as Error).message,
      });
    }

    const index = this.channels.indexOf(wrapper);
    if (index !== -1) {
      this.channels.splice(index, 1);
    }
  }

  /**
   * Start eviction timer to cleanup idle channels
   */
  private startEvictionTimer(): void {
    this.evictionTimer = setInterval(() => {
      this.evictIdleChannels();
    }, this.config.evictionInterval);
  }

  /**
   * Evict idle channels beyond minimum
   */
  private evictIdleChannels(): void {
    if (this.isDraining) return;

    const now = Date.now();
    const idleThreshold = this.config.evictionInterval;
    const toEvict = this.channels
      .filter((w) => !w.inUse && now - w.lastUsed > idleThreshold)
      .slice(this.config.min);

    for (const wrapper of toEvict) {
      this.destroyWrapper(wrapper).catch((error) => {
        this.logger.error('Error evicting channel', error);
      });
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
