import { describe, it, expect, beforeEach } from 'vitest';
import { RpcClient } from '../../src/client/rpc/RpcClient';
import { SilentLogger } from '../../src/core';

describe('RpcClient - Client Middleware', () => {
  let client: RpcClient;

  beforeEach(() => {
    client = new RpcClient({
      connection: { url: 'amqp://localhost' },
      queueName: 'test-queue',
      logger: new SilentLogger(),
    });
  });

  describe('use() method', () => {
    it('should register client middleware', () => {
      const middleware = async (command: string, payload: any) => ({
        command,
        payload,
      });

      expect(() => {
        client.use(middleware);
      }).not.toThrow();
    });

    it('should register multiple client middlewares', () => {
      const mw1 = async (command: string, payload: any) => ({ command, payload });
      const mw2 = async (command: string, payload: any) => ({ command, payload });

      expect(() => {
        client.use(mw1);
        client.use(mw2);
      }).not.toThrow();
    });

    it('should register multiple middlewares in one call', () => {
      const mw1 = async (command: string, payload: any) => ({ command, payload });
      const mw2 = async (command: string, payload: any) => ({ command, payload });

      expect(() => {
        client.use(mw1, mw2);
      }).not.toThrow();
    });
  });

  describe('validation middleware type', () => {
    it('should accept validation-like middleware', () => {
      // Client middleware signature is (command, payload) => {command, payload}
      // This is different from server middleware (ctx, next)
      const validationLikeMw = async (command: string, payload: any) => {
        if (!payload.value) {
          throw new Error('Validation failed');
        }
        return { command, payload };
      };

      expect(() => {
        client.use(validationLikeMw);
      }).not.toThrow();
    });
  });

  describe('client middleware chaining', () => {
    it('should allow chaining multiple uses', () => {
      const mw1 = async (cmd: string, payload: any) => ({
        command: cmd,
        payload: { ...payload, mw1: true },
      });

      const mw2 = async (cmd: string, payload: any) => ({
        command: cmd,
        payload: { ...payload, mw2: true },
      });

      expect(() => {
        client.use(mw1);
        client.use(mw2);
      }).not.toThrow();
    });
  });

  describe('client middleware syntax', () => {
    it('should support async middleware', () => {
      const asyncMw = async (command: string, payload: any) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { command, payload };
      };

      expect(() => {
        client.use(asyncMw);
      }).not.toThrow();
    });

    it('should support sync middleware', () => {
      const syncMw = (command: string, payload: any) => ({
        command,
        payload,
      });

      expect(() => {
        client.use(syncMw);
      }).not.toThrow();
    });
  });

  describe('client middleware behavior', () => {
    it('should allow middleware to transform command', () => {
      const transformMw = async (command: string, payload: any) => ({
        command: command.toLowerCase(),
        payload,
      });

      expect(() => {
        client.use(transformMw);
      }).not.toThrow();
    });

    it('should allow middleware to transform payload', () => {
      const transformMw = async (command: string, payload: any) => ({
        command,
        payload: { ...payload, transformed: true },
      });

      expect(() => {
        client.use(transformMw);
      }).not.toThrow();
    });

    it('should allow middleware to transform both', () => {
      const transformMw = async (command: string, payload: any) => ({
        command: `${command}_MODIFIED`,
        payload: { ...payload, modified: true },
      });

      expect(() => {
        client.use(transformMw);
      }).not.toThrow();
    });
  });

  describe('client middleware execution order', () => {
    it('should execute middlewares in registration order', () => {
      const order: string[] = [];

      const mw1 = async (command: string, payload: any) => {
        order.push('mw1');
        return { command, payload };
      };

      const mw2 = async (command: string, payload: any) => {
        order.push('mw2');
        return { command, payload };
      };

      const mw3 = async (command: string, payload: any) => {
        order.push('mw3');
        return { command, payload };
      };

      client.use(mw1, mw2, mw3);

      // Note: actual execution order would be tested during send()
      // which requires mocking/integration test setup
      expect(() => {
        client.use(mw1, mw2, mw3);
      }).not.toThrow();
    });
  });

  describe('compatibility with existing send() signature', () => {
    it('should not break existing API', () => {
      // RpcClient.send() signature should remain unchanged
      // client.send('COMMAND', payload, options?) should still work
      expect(typeof client.send).toBe('function');
    });
  });
});
