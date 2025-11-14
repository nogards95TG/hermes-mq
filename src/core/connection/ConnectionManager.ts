import * as amqp from 'amqplib';
import { EventEmitter } from 'events';
import { Logger, SilentLogger } from '../types/Logger';
import { ConnectionError } from '../types/Errors';

/**
 * Connection configuration options
 */
export interface ConnectionConfig {
  url: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeat?: number;
  logger?: Logger;
}

/**
 * Default connection configuration
 */
const DEFAULT_CONFIG: Required<Omit<ConnectionConfig, 'url' | 'logger'>> = {
  reconnect: true,
  reconnectInterval: 5000,
  maxReconnectAttempts: 10,
  heartbeat: 60,
};

/**
 * ConnectionManager implements singleton pattern for RabbitMQ connections
 * Each unique URL gets its own ConnectionManager instance
 */
export class ConnectionManager extends EventEmitter {
  private static instances = new Map<string, ConnectionManager>();
  private connection: amqp.Connection | null = null;
  private isConnecting = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private config: Required<Omit<ConnectionConfig, 'logger'>>;
  private logger: Logger;
  private isClosed = false;

  private constructor(config: ConnectionConfig) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = config.logger || new SilentLogger();
  }

  /**
   * Get or create ConnectionManager instance for given configuration
   */
  static getInstance(config: ConnectionConfig): ConnectionManager {
    const key = config.url;

    if (!ConnectionManager.instances.has(key)) {
      ConnectionManager.instances.set(key, new ConnectionManager(config));
    }

    return ConnectionManager.instances.get(key)!;
  }

  /**
   * Get active connection, establishing if necessary
   */
  async getConnection(): Promise<amqp.Connection> {
    if (this.isClosed) {
      throw new ConnectionError('ConnectionManager has been closed');
    }

    if (this.connection && !this.isConnecting) {
      return this.connection;
    }

    if (this.isConnecting) {
      // Wait for ongoing connection attempt
      return new Promise((resolve, reject) => {
        const onConnected = () => {
          cleanup();
          resolve(this.connection!);
        };
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const cleanup = () => {
          this.removeListener('connected', onConnected);
          this.removeListener('error', onError);
        };

        this.once('connected', onConnected);
        this.once('error', onError);
      });
    }

    return this.connect();
  }

  /**
   * Establish connection to RabbitMQ
   */
  private async connect(): Promise<amqp.Connection> {
    this.isConnecting = true;

    try {
      this.logger.info('Connecting to RabbitMQ', { url: this.maskUrl(this.config.url) });

      this.connection = (await amqp.connect(this.config.url, {
        heartbeat: this.config.heartbeat,
      })) as unknown as amqp.Connection;

      this.setupConnectionHandlers();
      this.reconnectAttempts = 0;
      this.isConnecting = false;

      this.logger.info('Connected to RabbitMQ');
      this.emit('connected');

      return this.connection;
    } catch (error) {
      this.isConnecting = false;
      const connectionError = new ConnectionError('Failed to connect to RabbitMQ', {
        error: (error as Error).message,
      });

      this.logger.error('Connection failed', connectionError);
      this.emit('error', connectionError);

      if (this.config.reconnect && this.reconnectAttempts < this.config.maxReconnectAttempts) {
        this.scheduleReconnect();
      }

      throw connectionError;
    }
  }

  /**
   * Setup connection event handlers
   */
  private setupConnectionHandlers(): void {
    if (!this.connection) return;

    this.connection.on('error', (error: Error) => {
      // "Unexpected close" errors occur when connections are closed abruptly
      // (e.g., during test cleanup or when RabbitMQ restarts)
      // Log as warning but don't propagate to avoid crashing the application
      if (error.message === 'Unexpected close') {
        this.logger.warn('Connection closed unexpectedly', {
          message: error.message,
          reconnect: this.config.reconnect,
        });
        return;
      }

      this.logger.error('Connection error', error);
      this.emit('error', error);
    });

    this.connection.on('close', () => {
      this.logger.warn('Connection closed');
      this.connection = null;
      this.emit('disconnected');

      if (this.config.reconnect && !this.isClosed) {
        this.scheduleReconnect();
      }
    });
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isClosed) return;

    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.config.maxReconnectAttempts) {
      this.logger.error('Max reconnection attempts reached');
      return;
    }

    this.logger.info(
      `Scheduling reconnection attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts}`,
      { interval: this.config.reconnectInterval }
    );

    this.emit('reconnecting', { attempt: this.reconnectAttempts });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // Error already logged and emitted in connect()
      });
    }, this.config.reconnectInterval);
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.connection !== null && !this.isConnecting;
  }

  /**
   * Close connection and cleanup
   */
  async close(): Promise<void> {
    this.isClosed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.connection) {
      try {
        await (this.connection as any).close();
        this.logger.info('Connection closed gracefully');
      } catch (error) {
        this.logger.error('Error closing connection', error as Error);
      }
      this.connection = null;
    }

    // Remove from instances map
    ConnectionManager.instances.delete(this.config.url);
    this.removeAllListeners();
  }

  /**
   * Mask sensitive information in URL for logging
   */
  private maskUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.password) {
        parsed.password = '****';
      }
      return parsed.toString();
    } catch {
      return url.replace(/\/\/[^:]+:[^@]+@/, '//****:****@');
    }
  }
}
