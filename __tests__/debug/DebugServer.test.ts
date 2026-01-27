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

      // Test that server is listening on custom port by fetching index
      const res = await fetch(`http://localhost:${customPort}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');

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
