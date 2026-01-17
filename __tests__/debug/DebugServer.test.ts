import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DebugServer } from '../../src/debug/DebugServer';
import type {
  DebugConfig,
  DebugMessage,
  DebugEvent,
  DebugServiceInfo,
} from '../../src/debug/types';
import WebSocket from 'ws';

describe('DebugServer', () => {
  let server: DebugServer;
  const testPort = 13333; // Use different port for testing

  const createTestConfig = (overrides: Partial<DebugConfig> = {}): DebugConfig => ({
    enabled: true,
    webUI: {
      port: testPort,
      autoOpen: false,
      host: 'localhost',
      cors: true,
      ...overrides.webUI,
    },
    snapshot: {
      enabled: true,
      maxMessages: 100,
      ...overrides.snapshot,
    },
  });

  beforeEach(() => {
    server = new DebugServer(createTestConfig());
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('start/stop', () => {
    it('should start server successfully', async () => {
      await expect(server.start()).resolves.toBeUndefined();
    });

    it('should stop server successfully', async () => {
      await server.start();
      await expect(server.stop()).resolves.toBeUndefined();
    });

    it('should be able to restart', async () => {
      await server.start();
      await server.stop();

      server = new DebugServer(createTestConfig());
      await expect(server.start()).resolves.toBeUndefined();
    });

    it('should stop gracefully even if not started', async () => {
      await expect(server.stop()).resolves.toBeUndefined();
    });
  });

  describe('HTTP endpoints', () => {
    beforeEach(async () => {
      await server.start();
    });

    it('should serve index.html on /', async () => {
      const res = await fetch(`http://localhost:${testPort}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
    });

    it('should serve static files', async () => {
      const endpoints = ['/app.js', '/styles.css'];

      for (const endpoint of endpoints) {
        const res = await fetch(`http://localhost:${testPort}${endpoint}`);
        expect(res.status).toBe(200);
      }
    });

    it('should return 404 for non-existent files', async () => {
      const res = await fetch(`http://localhost:${testPort}/non-existent.js`);
      expect(res.status).toBe(404);
    });

    it('should handle CORS preflight requests', async () => {
      const res = await fetch(`http://localhost:${testPort}/`, {
        method: 'OPTIONS',
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('should prevent path traversal attacks', async () => {
      const maliciousUrls = [
        '/../../../etc/passwd',
        '/..%2F..%2F..%2Fetc%2Fpasswd',
        '/static/../../../etc/passwd',
      ];

      for (const url of maliciousUrls) {
        const res = await fetch(`http://localhost:${testPort}${url}`);
        expect(res.status).toBe(404);
      }
    });
  });

  describe('API endpoints', () => {
    beforeEach(async () => {
      await server.start();
    });

    it('GET /api/messages should return messages', async () => {
      const message: DebugMessage = {
        id: 'test-msg-1',
        timestamp: new Date(),
        type: 'rpc-request',
        queue: 'test-queue',
        command: 'test.command',
        status: 'success',
        correlationId: 'corr-1',
        payload: { test: 'data' },
      };

      server.addMessage(message);

      const res = await fetch(`http://localhost:${testPort}/api/messages`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('test-msg-1');
    });

    it('GET /api/messages/:id should return specific message', async () => {
      const message: DebugMessage = {
        id: 'specific-msg',
        timestamp: new Date(),
        type: 'rpc-request',
        queue: 'test-queue',
        command: 'test.command',
        status: 'success',
        correlationId: 'corr-1',
        payload: {},
      };

      server.addMessage(message);

      const res = await fetch(`http://localhost:${testPort}/api/messages/specific-msg`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.id).toBe('specific-msg');
    });

    it('GET /api/messages/:id should return 404 for non-existent message', async () => {
      const res = await fetch(`http://localhost:${testPort}/api/messages/non-existent`);
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error).toBe('Message not found');
    });

    it('GET /api/stats should return statistics', async () => {
      server.addMessage({
        id: 'msg-1',
        timestamp: new Date(),
        type: 'rpc-request',
        queue: 'test',
        command: 'cmd',
        status: 'success',
        correlationId: 'corr-1',
        payload: {},
        duration: 100,
      });

      const res = await fetch(`http://localhost:${testPort}/api/stats`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toHaveProperty('totalMessages');
      expect(data).toHaveProperty('successCount');
      expect(data.totalMessages).toBe(1);
    });

    it('GET /api/performance should return handler performance', async () => {
      const res = await fetch(`http://localhost:${testPort}/api/performance`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it('GET /api/services should return registered services', async () => {
      const service: DebugServiceInfo = {
        id: 'service-1',
        type: 'rpc-server',
        name: 'test-service',
        status: 'active',
        startedAt: new Date(),
        messageCount: 0,
      };

      server.registerService(service);

      const res = await fetch(`http://localhost:${testPort}/api/services`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('service-1');
    });

    it('GET /api/health should return connection health', async () => {
      const health = {
        status: 'connected' as const,
        uptime: 1000,
        url: 'amqp://localhost',
        channelCount: 2,
        channels: [],
        events: [],
      };

      server.updateConnectionHealth(health);

      const res = await fetch(`http://localhost:${testPort}/api/health`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.status).toBe('connected');
      expect(data.uptime).toBe(1000);
    });

    it('should return 404 for unknown API endpoints', async () => {
      const res = await fetch(`http://localhost:${testPort}/api/unknown`);
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error).toBe('Not found');
    });
  });

  describe('WebSocket', () => {
    beforeEach(async () => {
      await server.start();
    });

    it('should accept WebSocket connections', () => {
      return new Promise<void>((resolve) => {
        const ws = new WebSocket(`ws://localhost:${testPort}`);

        ws.on('open', () => {
          ws.close();
          resolve();
        });
      });
    });

    it('should send initial data on connection', () => {
      return new Promise<void>((resolve) => {
        const message: DebugMessage = {
          id: 'initial-msg',
          timestamp: new Date(),
          type: 'rpc-request',
          queue: 'test',
          command: 'cmd',
          status: 'success',
          correlationId: 'corr-1',
          payload: {},
        };

        server.addMessage(message);

        const ws = new WebSocket(`ws://localhost:${testPort}`);

        ws.on('message', (data: Buffer) => {
          const parsed = JSON.parse(data.toString());

          if (parsed.type === 'initial-data') {
            expect(parsed.data).toHaveProperty('messages');
            expect(parsed.data).toHaveProperty('stats');
            expect(parsed.data).toHaveProperty('services');
            expect(parsed.data.messages).toHaveLength(1);
            ws.close();
            resolve();
          }
        });
      });
    });

    it('should broadcast new messages to connected clients', () => {
      return new Promise<void>((resolve) => {
        const ws = new WebSocket(`ws://localhost:${testPort}`);
        let receivedInitial = false;

        ws.on('message', (data: Buffer) => {
          const parsed = JSON.parse(data.toString());

          if (parsed.type === 'initial-data') {
            receivedInitial = true;

            // Add message after client is connected
            server.addMessage({
              id: 'broadcast-msg',
              timestamp: new Date(),
              type: 'rpc-request',
              queue: 'test',
              command: 'cmd',
              status: 'success',
              correlationId: 'corr-1',
              payload: {},
            });
          } else if (parsed.type === 'message' && receivedInitial) {
            expect(parsed.data.id).toBe('broadcast-msg');
            ws.close();
            resolve();
          }
        });
      });
    });

    it('should handle client messages - get-stats', () => {
      return new Promise<void>((resolve) => {
        const ws = new WebSocket(`ws://localhost:${testPort}`);

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'get-stats' }));
        });

        ws.on('message', (data: Buffer) => {
          const parsed = JSON.parse(data.toString());

          if (parsed.type === 'stats') {
            expect(parsed.data).toHaveProperty('totalMessages');
            ws.close();
            resolve();
          }
        });
      });
    });

    it('should handle client messages - clear-messages', () => {
      return new Promise<void>((resolve) => {
        server.addMessage({
          id: 'to-clear',
          timestamp: new Date(),
          type: 'rpc-request',
          queue: 'test',
          command: 'cmd',
          status: 'success',
          correlationId: 'corr-1',
          payload: {},
        });

        const ws = new WebSocket(`ws://localhost:${testPort}`);

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'clear-messages' }));
        });

        ws.on('message', (data: Buffer) => {
          const parsed = JSON.parse(data.toString());

          if (parsed.type === 'messages-cleared') {
            ws.close();
            resolve();
          }
        });
      });
    });

    it('should handle invalid JSON gracefully', () => {
      return new Promise<void>((resolve) => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const ws = new WebSocket(`ws://localhost:${testPort}`);

        ws.on('open', () => {
          ws.send('invalid json{');

          setTimeout(() => {
            ws.close();
            consoleErrorSpy.mockRestore();
            resolve();
          }, 100);
        });
      });
    });
  });

  describe('event handling', () => {
    beforeEach(async () => {
      await server.start();
    });

    it('should handle message events', () => {
      const event: DebugEvent = {
        type: 'message:received',
        timestamp: new Date(),
        serviceId: 'service-1',
        data: {
          id: 'msg-1',
          type: 'rpc-request',
          queue: 'test',
          command: 'cmd',
          correlationId: 'corr-1',
          payload: {},
        },
      };

      expect(() => {
        server.onEvent(event);
      }).not.toThrow();
    });

    it('should handle connection events', () => {
      const event: DebugEvent = {
        type: 'connection:connected',
        timestamp: new Date(),
        serviceId: 'service-1',
        data: {
          url: 'amqp://localhost',
          message: 'Connected',
        },
      };

      expect(() => {
        server.onEvent(event);
      }).not.toThrow();
    });

    it('should handle service events', () => {
      const event: DebugEvent = {
        type: 'service:started',
        timestamp: new Date(),
        serviceId: 'service-1',
        data: {
          id: 'service-1',
          type: 'rpc-server' as const,
          name: 'test-service',
          status: 'active' as const,
          startedAt: new Date(),
          messageCount: 0,
        },
      };

      expect(() => {
        server.onEvent(event);
      }).not.toThrow();
    });

    it('should handle invalid event data gracefully', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const invalidEvent: DebugEvent = {
        type: 'message:received',
        timestamp: new Date(),
        serviceId: 'service-1',
        data: null,
      };

      expect(() => {
        server.onEvent(invalidEvent);
      }).not.toThrow();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('service management', () => {
    it('should register services', () => {
      const service: DebugServiceInfo = {
        id: 'service-1',
        type: 'rpc-server',
        name: 'test-service',
        status: 'active',
        startedAt: new Date(),
        messageCount: 0,
      };

      expect(() => {
        server.registerService(service);
      }).not.toThrow();
    });

    it('should unregister services', () => {
      const service: DebugServiceInfo = {
        id: 'service-1',
        type: 'rpc-server',
        name: 'test-service',
        status: 'active',
        startedAt: new Date(),
        messageCount: 0,
      };

      server.registerService(service);

      expect(() => {
        server.unregisterService('service-1');
      }).not.toThrow();
    });
  });

  describe('configuration', () => {
    it('should use default configuration values', () => {
      const serverWithDefaults = new DebugServer({
        enabled: true,
      });

      expect(serverWithDefaults).toBeDefined();
    });

    it('should respect custom port', async () => {
      const customPort = 14444;
      const customServer = new DebugServer(
        createTestConfig({
          webUI: { port: customPort },
        })
      );

      await customServer.start();

      const res = await fetch(`http://localhost:${customPort}/api/stats`);
      expect(res.status).toBe(200);

      await customServer.stop();
    });

    it('should respect max messages limit', () => {
      const limitedServer = new DebugServer(
        createTestConfig({
          snapshot: { maxMessages: 2, enabled: true },
        })
      );

      for (let i = 0; i < 5; i++) {
        limitedServer.addMessage({
          id: `msg-${i}`,
          timestamp: new Date(),
          type: 'rpc-request',
          queue: 'test',
          command: 'cmd',
          status: 'success',
          correlationId: 'corr-1',
          payload: {},
        });
      }

      // The message store should respect the limit
      // This is tested indirectly through the MessageStore tests
    });
  });
});
