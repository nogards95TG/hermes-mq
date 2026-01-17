import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
  DebugConfig,
  DebugMessage,
  DebugEvent,
  DebugServiceInfo,
  DebugConnectionHealth,
} from './types';
import { MessageStore } from './MessageStore';
import { Logger } from '../core/types/Logger';

/**
 * Debug Web UI Server
 *
 * Central hub for collecting and broadcasting debug information from all Hermes MQ components.
 * Provides a web-based UI with real-time updates via WebSocket for monitoring RPC calls,
 * pub/sub messages, connection health, and service status.
 *
 * **Architecture:**
 * - HTTP Server: Serves static UI files and REST API endpoints
 * - WebSocket Server: Broadcasts real-time updates to connected clients
 * - MessageStore: In-memory circular buffer for storing recent messages
 * - Event Processing: Converts DebugEvents from DebugEmitters into DebugMessages
 *
 * **Security Features:**
 * - Path traversal prevention via file whitelist
 * - Cryptographically secure ID generation
 * - CORS support (configurable)
 * - Input validation with type guards
 *
 * **Performance:**
 * - Async file I/O to prevent event loop blocking
 * - Efficient broadcast with connection state checks
 * - Race condition prevention in concurrent updates
 *
 * @example Basic Usage
 * ```typescript
 * import { DebugServer } from 'hermes-mq';
 *
 * const debugServer = new DebugServer({
 *   enabled: true,
 *   webUI: {
 *     port: 3333,
 *     autoOpen: true,
 *     host: 'localhost',
 *     cors: true,
 *   },
 *   snapshot: {
 *     enabled: true,
 *     maxMessages: 1000,
 *   },
 * });
 *
 * await debugServer.start();
 * console.log('Debug UI available at http://localhost:3333');
 *
 * // Later...
 * await debugServer.stop();
 * ```
 *
 * @example Integration with RPC Client
 * ```typescript
 * import { RpcClient, DebugServer, DebugEmitter } from 'hermes-mq';
 *
 * const debugServer = new DebugServer({ enabled: true });
 * await debugServer.start();
 *
 * const client = new RpcClient({
 *   connection: { url: 'amqp://localhost' },
 *   debug: { enabled: true },
 * });
 *
 * // DebugEmitter inside RpcClient automatically sends events to DebugServer
 * await client.connect();
 *
 * const response = await client.call('user.create', { name: 'John' });
 * // Message appears in debug UI in real-time
 * ```
 *
 * @public
 */
export class DebugServer {
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private messageStore: MessageStore;
  private services: Map<string, DebugServiceInfo> = new Map();
  private connectionHealth: DebugConnectionHealth | null = null;
  private logger: Logger;
  private readonly config: Required<DebugConfig['webUI']> & Pick<DebugConfig, 'snapshot'>;

  /**
   * Create a new DebugServer instance
   *
   * @param config - Debug configuration with webUI and snapshot settings
   * @param logger - Optional logger instance (defaults to console)
   *
   * @example
   * ```typescript
   * const server = new DebugServer({
   *   enabled: true,
   *   webUI: { port: 3333, autoOpen: true },
   *   snapshot: { maxMessages: 1000 },
   * });
   * ```
   *
   * @public
   */
  constructor(config: DebugConfig, logger: Logger = console) {
    this.config = {
      port: config.webUI?.port || 3333,
      autoOpen: config.webUI?.autoOpen ?? false,
      host: config.webUI?.host || '0.0.0.0',
      cors: config.webUI?.cors ?? true,
      snapshot: config.snapshot,
    };

    this.logger = logger;
    this.messageStore = new MessageStore(config.snapshot?.maxMessages || 1000);
  }

  /**
   * Start the debug server
   *
   * Initializes the HTTP server and WebSocket server. The server begins listening
   * on the configured host and port. If `autoOpen` is enabled, automatically opens
   * the debug UI in the default browser.
   *
   * @returns Promise that resolves when server is listening
   * @throws Error if server fails to start (e.g., port already in use)
   *
   * @example
   * ```typescript
   * const server = new DebugServer({ enabled: true });
   * await server.start();
   * // Debug UI now available at http://localhost:3333
   * ```
   *
   * @public
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.httpServer = createServer((req, res) => this.handleHttpRequest(req, res));

        this.wss = new WebSocketServer({ server: this.httpServer });

        this.wss.on('connection', (ws: WebSocket) => {
          this.logger.info('[DebugServer] Client connected');

          // Send initial data
          this.sendToClient(ws, {
            type: 'initial-data',
            data: {
              messages: this.messageStore.getAll(),
              stats: this.messageStore.getStats(),
              services: Array.from(this.services.values()),
              connectionHealth: this.connectionHealth,
            },
          });

          ws.on('message', (data: Buffer) => {
            try {
              const message = JSON.parse(data.toString());
              this.handleClientMessage(ws, message);
            } catch (error) {
              this.logger.error('[DebugServer] Failed to parse client message:', error as Error);
            }
          });

          ws.on('close', () => {
            this.logger.info('[DebugServer] Client disconnected');
          });
        });

        this.httpServer.listen(this.config.port, this.config.host, () => {
          const url = `http://${this.config.host === '0.0.0.0' ? 'localhost' : this.config.host}:${this.config.port}`;
          this.logger.info(`🐛 Hermes MQ Debug UI available at ${url}`);

          if (this.config.autoOpen) {
            this.openBrowser(url);
          }

          resolve();
        });

        this.httpServer.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the debug server
   *
   * Gracefully shuts down the WebSocket server and HTTP server. All connected
   * clients are disconnected. Safe to call even if server is not running.
   *
   * @returns Promise that resolves when server is fully stopped
   *
   * @example
   * ```typescript
   * await server.stop();
   * console.log('Debug server stopped');
   * ```
   *
   * @public
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close();
        this.wss = null;
      }

      if (this.httpServer) {
        this.httpServer.close(() => {
          this.logger.info('[DebugServer] Server stopped');
          resolve();
        });
        this.httpServer = null;
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle debug events from DebugEmitters
   *
   * Processes events emitted by DebugEmitter instances in RPC clients/servers and
   * publishers/subscribers. Events are converted to DebugMessages and stored, then
   * broadcast to all connected WebSocket clients.
   *
   * Supports message events, connection events, and service lifecycle events.
   *
   * @param event - Debug event from a DebugEmitter
   *
   * @example
   * ```typescript
   * const emitter = new DebugEmitter('rpc-client-1');
   * emitter.on('debug-event', (event) => debugServer.onEvent(event));
   *
   * emitter.emitMessageReceived({
   *   id: 'msg-1',
   *   type: 'rpc-request',
   *   queue: 'user.queue',
   *   command: 'user.create',
   *   payload: { name: 'John' },
   * });
   * // Event processed and broadcast to all connected clients
   * ```
   *
   * @public
   */
  onEvent(event: DebugEvent): void {
    switch (event.type) {
      case 'message:received':
      case 'message:success':
      case 'message:error':
      case 'message:timeout':
        this.handleMessageEvent(event);
        break;

      case 'connection:connected':
      case 'connection:disconnected':
      case 'connection:error':
        this.handleConnectionEvent(event);
        break;

      case 'service:started':
      case 'service:stopped':
        this.handleServiceEvent(event);
        break;
    }
  }

  /**
   * Add a debug message to the store and broadcast to clients
   *
   * Stores the message in the MessageStore (circular buffer) and broadcasts it
   * to all connected WebSocket clients. Also broadcasts updated statistics.
   *
   * @param message - The debug message to add
   *
   * @example
   * ```typescript
   * server.addMessage({
   *   id: 'msg-123',
   *   timestamp: new Date(),
   *   type: 'rpc-request',
   *   queue: 'user.queue',
   *   command: 'user.create',
   *   status: 'success',
   *   correlationId: 'corr-456',
   *   payload: { name: 'John' },
   *   duration: 45,
   * });
   * ```
   *
   * @public
   */
  addMessage(message: DebugMessage): void {
    this.messageStore.add(message);

    // Broadcast to all connected clients
    this.broadcast({
      type: 'message',
      data: message,
    });

    // Update stats
    this.broadcast({
      type: 'stats',
      data: this.messageStore.getStats(),
    });
  }

  /**
   * Register a service for monitoring
   *
   * Adds a service (RPC client/server, publisher, subscriber) to the debug server's
   * service registry. Broadcasts the registration to all connected clients.
   *
   * @param service - Service information to register
   *
   * @example
   * ```typescript
   * server.registerService({
   *   id: 'rpc-server-user-service',
   *   type: 'rpc-server',
   *   name: 'UserService',
   *   status: 'active',
   *   startedAt: new Date(),
   *   messageCount: 0,
   * });
   * ```
   *
   * @public
   */
  registerService(service: DebugServiceInfo): void {
    this.services.set(service.id, service);

    this.broadcast({
      type: 'service',
      data: {
        action: 'registered',
        service,
      },
    });
  }

  /**
   * Unregister a service from monitoring
   *
   * Removes a service from the debug server's registry. Typically called when a
   * service disconnects or is destroyed. Broadcasts the unregistration to clients.
   *
   * @param serviceId - ID of the service to unregister
   *
   * @example
   * ```typescript
   * server.unregisterService('rpc-server-user-service');
   * ```
   *
   * @public
   */
  unregisterService(serviceId: string): void {
    this.services.delete(serviceId);

    this.broadcast({
      type: 'service',
      data: {
        action: 'unregistered',
        serviceId,
      },
    });
  }

  /**
   * Update RabbitMQ connection health information
   *
   * Updates the current connection health status and broadcasts it to all connected
   * clients. Includes connection status, uptime, channel information, and recent events.
   *
   * @param health - Current connection health information
   *
   * @example
   * ```typescript
   * server.updateConnectionHealth({
   *   status: 'connected',
   *   uptime: 12345,
   *   url: 'amqp://localhost:5672',
   *   channelCount: 3,
   *   channels: [{ id: '1', type: 'rpc', queue: 'user.queue' }],
   *   events: [
   *     { type: 'connected', timestamp: new Date(), message: 'Connected to RabbitMQ' }
   *   ],
   * });
   * ```
   *
   * @public
   */
  updateConnectionHealth(health: DebugConnectionHealth): void {
    this.connectionHealth = health;

    this.broadcast({
      type: 'connection-health',
      data: health,
    });
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    // CORS headers
    if (this.config.cors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    const url = req.url || '/';

    // API endpoints
    if (url.startsWith('/api/')) {
      this.handleApiRequest(req, res, url);
      return;
    }

    // Serve static files
    this.serveStaticFile(res, url);
  }

  private handleApiRequest(_req: IncomingMessage, res: ServerResponse, url: string): void {
    res.setHeader('Content-Type', 'application/json');

    try {
      if (url === '/api/messages') {
        // Get all messages
        res.writeHead(200);
        res.end(JSON.stringify(this.messageStore.getAll()));
      } else if (url.startsWith('/api/messages/')) {
        // Get message by ID
        const id = url.split('/')[3];
        const message = this.messageStore.getById(id);

        if (message) {
          res.writeHead(200);
          res.end(JSON.stringify(message));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Message not found' }));
        }
      } else if (url === '/api/stats') {
        // Get statistics
        res.writeHead(200);
        res.end(JSON.stringify(this.messageStore.getStats()));
      } else if (url === '/api/performance') {
        // Get handler performance
        res.writeHead(200);
        res.end(JSON.stringify(this.messageStore.getHandlerPerformance()));
      } else if (url === '/api/services') {
        // Get registered services
        res.writeHead(200);
        res.end(JSON.stringify(Array.from(this.services.values())));
      } else if (url === '/api/health') {
        // Get connection health
        res.writeHead(200);
        res.end(JSON.stringify(this.connectionHealth));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      this.logger.error('[DebugServer] API error:', error as Error);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  private async serveStaticFile(res: ServerResponse, url: string): Promise<void> {
    try {
      // Whitelist of allowed files - prevents path traversal attacks
      const allowedFiles: Record<string, { filename: string; contentType: string }> = {
        '/': { filename: 'index.html', contentType: 'text/html; charset=utf-8' },
        '/index.html': { filename: 'index.html', contentType: 'text/html; charset=utf-8' },
        '/app.js': { filename: 'app.js', contentType: 'application/javascript; charset=utf-8' },
        '/styles.css': { filename: 'styles.css', contentType: 'text/css; charset=utf-8' },
      };

      const fileInfo = allowedFiles[url];

      if (!fileInfo) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      // Safely construct file path - no user input directly in path
      const filePath = join(__dirname, 'static', fileInfo.filename);

      // Read file asynchronously to avoid blocking event loop
      const content = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': fileInfo.contentType,
        'Content-Length': Buffer.byteLength(content),
      });
      res.end(content);
    } catch (error) {
      this.logger.error('[DebugServer] Failed to serve static file:', error as Error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error');
    }
  }

  private handleClientMessage(ws: WebSocket, message: unknown): void {
    // Type guard for client message
    if (!this.isValidClientMessage(message)) {
      this.logger.warn('[DebugServer] Invalid client message format');
      return;
    }

    switch (message.type) {
      case 'get-messages':
        this.sendToClient(ws, {
          type: 'messages',
          data: this.messageStore.filter(message.filters || {}),
        });
        break;

      case 'get-stats':
        this.sendToClient(ws, {
          type: 'stats',
          data: this.messageStore.getStats(),
        });
        break;

      case 'get-performance':
        this.sendToClient(ws, {
          type: 'performance',
          data: this.messageStore.getHandlerPerformance(),
        });
        break;

      case 'clear-messages':
        this.messageStore.clear();
        this.broadcast({
          type: 'messages-cleared',
          data: null,
        });
        break;

      default:
        this.logger.warn(`[DebugServer] Unknown message type: ${message.type}`);
    }
  }

  /**
   * Type guard for client WebSocket messages
   */
  private isValidClientMessage(message: unknown): message is { type: string; filters?: any } {
    return (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      typeof (message as any).type === 'string'
    );
  }

  private handleMessageEvent(event: DebugEvent): void {
    // Type guard and convert event to DebugMessage format
    if (!this.isMessageEventData(event.data)) {
      this.logger.warn('[DebugServer] Invalid message event data format');
      return;
    }

    const messageData = event.data;
    const message: DebugMessage = {
      id: messageData.id || this.generateId(),
      timestamp: event.timestamp,
      type: messageData.type || 'rpc-request',
      queue: messageData.queue || '',
      command: messageData.command || '',
      status: this.getStatusFromEventType(event.type),
      duration: messageData.duration,
      correlationId: messageData.correlationId || '',
      payload: messageData.payload,
      response: messageData.response,
      error: messageData.error,
      serviceId: event.serviceId,
      metadata: messageData.metadata,
    };

    this.addMessage(message);
  }

  /**
   * Type guard for message event data
   */
  private isMessageEventData(data: unknown): data is {
    id?: string;
    type?: DebugMessage['type'];
    queue?: string;
    command?: string;
    duration?: number;
    correlationId?: string;
    payload?: unknown;
    response?: unknown;
    error?: any;
    metadata?: Record<string, unknown>;
  } {
    return typeof data === 'object' && data !== null;
  }

  private handleConnectionEvent(event: DebugEvent): void {
    // Type guard and update connection health based on event
    if (!this.isConnectionEventData(event.data)) {
      this.logger.warn('[DebugServer] Invalid connection event data format');
      return;
    }

    const eventData = event.data;

    if (!this.connectionHealth) {
      this.connectionHealth = {
        status: 'disconnected',
        uptime: 0,
        url: eventData.url || '',
        channelCount: 0,
        channels: [],
        events: [],
      };
    }

    // Create new array to avoid race conditions during broadcast
    const newEvent = {
      type: this.getHealthEventType(event.type),
      timestamp: event.timestamp,
      message: eventData.message || '',
    };

    // Keep last 50 events - create new array to avoid mutation during iteration
    const updatedEvents = [newEvent, ...this.connectionHealth.events].slice(0, 50);
    this.connectionHealth.events = updatedEvents;

    if (event.type === 'connection:connected') {
      this.connectionHealth.status = 'connected';
    } else if (event.type === 'connection:disconnected') {
      this.connectionHealth.status = 'disconnected';
    }

    this.updateConnectionHealth(this.connectionHealth);
  }

  /**
   * Type guard for connection event data
   */
  private isConnectionEventData(data: unknown): data is {
    url?: string;
    message?: string;
    error?: Error;
  } {
    return typeof data === 'object' && data !== null;
  }

  private handleServiceEvent(event: DebugEvent): void {
    if (event.type === 'service:started') {
      if (!this.isServiceInfo(event.data)) {
        this.logger.warn('[DebugServer] Invalid service started event data');
        return;
      }
      this.registerService(event.data);
    } else if (event.type === 'service:stopped') {
      if (!this.isServiceStoppedData(event.data)) {
        this.logger.warn('[DebugServer] Invalid service stopped event data');
        return;
      }
      this.unregisterService(event.data.id);
    }
  }

  /**
   * Type guard for service info
   */
  private isServiceInfo(data: unknown): data is DebugServiceInfo {
    return (
      typeof data === 'object' &&
      data !== null &&
      'id' in data &&
      'type' in data &&
      'name' in data &&
      'status' in data
    );
  }

  /**
   * Type guard for service stopped event data
   */
  private isServiceStoppedData(data: unknown): data is { id: string } {
    return typeof data === 'object' && data !== null && 'id' in data;
  }

  private broadcast(message: unknown): void {
    if (!this.wss) return;

    try {
      const data = JSON.stringify(message);

      this.wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      });
    } catch (error) {
      this.logger.error('[DebugServer] Failed to broadcast message:', error as Error);
    }
  }

  private sendToClient(ws: WebSocket, message: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        this.logger.error('[DebugServer] Failed to send message to client:', error as Error);
      }
    }
  }

  private getStatusFromEventType(type: string): DebugMessage['status'] {
    if (type === 'message:success') return 'success';
    if (type === 'message:error') return 'error';
    if (type === 'message:timeout') return 'timeout';
    return 'pending';
  }

  private getHealthEventType(type: string): DebugConnectionHealth['events'][0]['type'] {
    if (type === 'connection:connected') return 'connected';
    if (type === 'connection:disconnected') return 'disconnected';
    if (type === 'connection:error') return 'error';
    return 'error';
  }

  /**
   * Generate a cryptographically secure unique ID
   *
   * Uses crypto.randomBytes to generate secure random IDs for messages that don't
   * have one. This prevents predictable IDs that could be security vulnerabilities.
   *
   * @returns Secure random ID in format "msg_<16 hex chars>"
   *
   * @private
   * @internal
   */
  private generateId(): string {
    return `msg_${randomBytes(8).toString('hex')}`;
  }

  private openBrowser(url: string): void {
    const { exec } = require('node:child_process');
    const start =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';

    exec(`${start} ${url}`, (error: Error | null) => {
      if (error) {
        this.logger.warn(`[DebugServer] Could not auto-open browser: ${error.message}`);
      }
    });
  }
}
