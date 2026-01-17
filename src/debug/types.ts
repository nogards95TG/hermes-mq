/**
 * Debug UI Types and Interfaces
 * Zero-dependency application-level monitoring for Hermes MQ
 */

export interface DebugConfig {
  /**
   * Enable debug monitoring
   * @default false in production, true in development
   */
  enabled: boolean;

  /**
   * Web UI configuration (embedded mode)
   */
  webUI?: {
    /** Port for the debug web server */
    port: number;
    /** Auto-open browser on start */
    autoOpen?: boolean;
    /** Host to bind to */
    host?: string;
    /** Enable CORS for development */
    cors?: boolean;
  };

  /**
   * Report to centralized debug server (centralized mode)
   */
  reportTo?: string;

  /**
   * Message snapshot configuration
   */
  snapshot?: {
    /** Enable message snapshotting */
    enabled: boolean;
    /** Maximum messages to keep in memory */
    maxMessages?: number;
    /** Persist snapshots to disk */
    persistToDisk?: boolean;
    /** Retention hours for snapshots */
    retentionHours?: number;
  };

  /**
   * Performance limits
   */
  limits?: {
    /** Max memory usage in MB */
    maxMemoryMb?: number;
    /** Sampling rate (0-1) for high-traffic scenarios */
    samplingRate?: number;
  };
}

export interface DebugMessage {
  /** Unique message ID */
  id: string;
  /** Timestamp */
  timestamp: Date;
  /** Message type */
  type: 'rpc-request' | 'rpc-response' | 'pubsub-publish' | 'pubsub-consume';
  /** Queue name */
  queue: string;
  /** RPC command or pub/sub pattern */
  command: string;
  /** Processing status */
  status: 'pending' | 'success' | 'error' | 'timeout';
  /** Processing duration in ms */
  duration?: number;
  /** Correlation ID for request/response matching */
  correlationId: string;
  /** Message payload */
  payload: unknown;
  /** Response data (for successful RPC) */
  response?: unknown;
  /** Error details (for failures) */
  error?: DebugError;
  /** Service/instance identifier */
  serviceId?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface DebugError {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Stack trace */
  stack?: string;
  /** Additional error context */
  context?: Record<string, unknown>;
}

export interface DebugStats {
  /** Total messages processed */
  totalMessages: number;
  /** Success count */
  successCount: number;
  /** Error count */
  errorCount: number;
  /** Average latency in ms */
  avgLatency: number;
  /** P95 latency in ms */
  p95Latency: number;
  /** P99 latency in ms */
  p99Latency: number;
  /** Messages per second */
  messagesPerSecond: number;
  /** Error rate (0-1) */
  errorRate: number;
  /** Active queues */
  activeQueues: Set<string>;
  /** Active commands */
  activeCommands: Map<string, number>;
}

export interface DebugHandlerPerformance {
  /** Handler/command name */
  command: string;
  /** Queue name */
  queue: string;
  /** Total calls */
  callCount: number;
  /** Average duration */
  avgDuration: number;
  /** Min duration */
  minDuration: number;
  /** Max duration */
  maxDuration: number;
  /** P95 duration */
  p95Duration: number;
  /** P99 duration */
  p99Duration: number;
  /** Error count */
  errorCount: number;
  /** Error rate */
  errorRate: number;
  /** Recent slow calls */
  slowCalls: Array<{
    messageId: string;
    duration: number;
    timestamp: Date;
  }>;
}

export interface DebugConnectionHealth {
  /** Connection status */
  status: 'connected' | 'disconnected' | 'reconnecting';
  /** Uptime in ms */
  uptime: number;
  /** RabbitMQ URL */
  url: string;
  /** Active channels count */
  channelCount: number;
  /** Channel details */
  channels: Array<{
    id: number;
    type: 'rpc-server' | 'rpc-client' | 'publisher' | 'subscriber';
    queue?: string;
    exchange?: string;
  }>;
  /** Recent connection events */
  events: Array<{
    type: 'connected' | 'disconnected' | 'error' | 'heartbeat-missed';
    timestamp: Date;
    message: string;
  }>;
}

export interface DebugServiceInfo {
  /** Service ID */
  id: string;
  /** Service type */
  type: 'rpc-server' | 'rpc-client' | 'publisher' | 'subscriber';
  /** Queue or exchange name */
  name: string;
  /** Status */
  status: 'active' | 'inactive';
  /** Start time */
  startedAt: Date;
  /** Message count */
  messageCount: number;
}

export type DebugEventType =
  | 'message:received'
  | 'message:success'
  | 'message:error'
  | 'message:timeout'
  | 'connection:connected'
  | 'connection:disconnected'
  | 'connection:error'
  | 'service:started'
  | 'service:stopped';

export interface DebugEvent {
  type: DebugEventType;
  timestamp: Date;
  serviceId: string;
  data: unknown;
}
