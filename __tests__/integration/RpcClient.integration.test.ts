import { describe, it, expect } from 'vitest';
import { RpcClient } from '../../src/client';
import { RpcServer } from '../../src/server';
import { TimeoutError, ValidationError, SilentLogger } from '../../src/core';
import { setupRabbitMQSuite, withRabbitMQ } from './testContainer';

/**
 * Integration tests for RpcClient using real RabbitMQ
 *
 * These tests use the setupRabbitMQSuite utility to manage a shared
 * RabbitMQ container across all tests in this suite.
 */

describe('RpcClient Integration Tests', () => {
  const { getUrl } = setupRabbitMQSuite();

  describe('End-to-End RPC', () => {
    it('should complete full request-response cycle', async () => {
      const logger = new SilentLogger();

      // Start server
      const server = new RpcServer({
        connection: { url: getUrl() },
        queueName: 'test-e2e',
        logger,
      });

      server.registerHandler('ADD', (data: { a: number; b: number }) => {
        return { result: data.a + data.b };
      });

      await server.start();

      // Create client
      const client = new RpcClient({
        connection: { url: getUrl() },
        queueName: 'test-e2e',
        logger,
      });

      // Send request
      const response = await client.send<{ a: number; b: number }, { result: number }>('ADD', {
        a: 5,
        b: 3,
      });

      // Verify
      expect(response.result).toBe(8);

      // Cleanup
      await client.close();
      await server.stop();
    });

    it.skip('should handle multiple concurrent requests with correct correlation', async () => {
      const logger = new SilentLogger();

      const server = new RpcServer({
        connection: { url: getUrl() },
        queueName: 'test-concurrent',
        logger,
      });

      server.registerHandler('ECHO', (data: { id: number }) => data);

      await server.start();

      const client = new RpcClient({
        connection: { url: getUrl() },
        queueName: 'test-concurrent',
        logger,
      });

      // Send 10 concurrent requests
      const promises = Array.from({ length: 10 }, (_, i) => client.send('ECHO', { id: i }));

      const results = await Promise.all(promises);

      // Verify each response matches its request
      results.forEach((result: any, i: number) => {
        expect(result.id).toBe(i);
      });

      await client.close();
      await server.stop();
    });

    it('should handle requests with metadata', async () => {
      const logger = new SilentLogger();

      const server = new RpcServer({
        connection: { url: getUrl() },
        queueName: 'test-metadata',
        logger,
      });

      let receivedMetadata: Record<string, any> | undefined;

      server.registerHandler('PROCESS', (_data: any, metadata?: Record<string, any>) => {
        receivedMetadata = metadata;
        return { processed: true };
      });

      await server.start();

      const client = new RpcClient({
        connection: { url: getUrl() },
        queueName: 'test-metadata',
        logger,
      });

      await client.send(
        'PROCESS',
        { value: 'test' },
        {
          metadata: { userId: '123', timestamp: Date.now() },
        }
      );

      expect(receivedMetadata).toBeDefined();
      expect(receivedMetadata?.userId).toBe('123');

      await client.close();
      await server.stop();
    });
  });

  describe('Error Handling', () => {
    it('should propagate validation errors from server to client', async () => {
      const logger = new SilentLogger();

      const server = new RpcServer({
        connection: { url: getUrl() },
        queueName: 'test-validation',
        logger,
      });

      server.registerHandler('DIVIDE', (data: { a: number; b: number }) => {
        if (data.b === 0) {
          throw new ValidationError('Cannot divide by zero', { a: data.a, b: data.b });
        }
        return { result: data.a / data.b };
      });

      await server.start();

      const client = new RpcClient({
        connection: { url: getUrl() },
        queueName: 'test-validation',
        logger,
      });

      await expect(client.send('DIVIDE', { a: 10, b: 0 })).rejects.toThrow('Cannot divide by zero');

      await client.close();
      await server.stop();
    });

    it('should propagate custom errors with details', async () => {
      const logger = new SilentLogger();

      const server = new RpcServer({
        connection: { url: getUrl() },
        queueName: 'test-custom-error',
        logger,
      });

      class CustomError extends Error {
        constructor(
          message: string,
          public details: any
        ) {
          super(message);
          this.name = 'CustomError';
        }
      }

      server.registerHandler('FAIL', () => {
        throw new CustomError('Custom failure', { code: 500, extra: 'info' });
      });

      await server.start();

      const client = new RpcClient({
        connection: { url: getUrl() },
        queueName: 'test-custom-error',
        logger,
      });

      try {
        await client.send('FAIL', {});
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toBe('Custom failure');
        expect(error.details).toBeDefined();
        expect(error.details.code).toBe(500);
      }

      await client.close();
      await server.stop();
    });

    it('should handle unknown command error', async () => {
      const logger = new SilentLogger();

      const server = new RpcServer({
        connection: { url: getUrl() },
        queueName: 'test-unknown',
        logger,
      });

      await server.start();

      const client = new RpcClient({
        connection: { url: getUrl() },
        queueName: 'test-unknown',
        logger,
      });

      await expect(client.send('UNKNOWN_COMMAND', {})).rejects.toThrow('No handler registered');

      await client.close();
      await server.stop();
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout when server response is too slow', async () => {
      const logger = new SilentLogger();

      const server = new RpcServer({
        connection: { url: getUrl() },
        queueName: 'test-timeout',
        logger,
      });

      server.registerHandler('SLOW', async () => {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return { done: true };
      });

      await server.start();

      const client = new RpcClient({
        connection: { url: getUrl() },
        queueName: 'test-timeout',
        timeout: 1000, // 1 second timeout
        logger,
      });

      await expect(client.send('SLOW', {})).rejects.toThrow(TimeoutError);

      await client.close();
      await server.stop();
    });

    it('should complete when operation is within timeout', async () => {
      const logger = new SilentLogger();

      const server = new RpcServer({
        connection: { url: getUrl() },
        queueName: 'test-fast',
        logger,
      });

      server.registerHandler('FAST', async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { done: true };
      });

      await server.start();

      const client = new RpcClient({
        connection: { url: getUrl() },
        queueName: 'test-fast',
        timeout: 2000,
        logger,
      });

      const result = await client.send('FAST', {});
      expect(result.done).toBe(true);

      await client.close();
      await server.stop();
    });

    it('should support per-request timeout override', async () => {
      const logger = new SilentLogger();

      const server = new RpcServer({
        connection: { url: getUrl() },
        queueName: 'test-override',
        logger,
      });

      server.registerHandler('MEDIUM', async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return { done: true };
      });

      await server.start();

      const client = new RpcClient({
        connection: { url: getUrl() },
        queueName: 'test-override',
        timeout: 500, // Default 500ms
        logger,
      });

      // This should timeout with default
      await expect(client.send('MEDIUM', {})).rejects.toThrow(TimeoutError);

      // This should succeed with override
      const result = await client.send('MEDIUM', {}, { timeout: 3000 });
      expect(result.done).toBe(true);

      await client.close();
      await server.stop();
    });
  });

  describe('Request Cancellation', () => {
    it('should cancel request with AbortSignal', async () => {
      const logger = new SilentLogger();

      const server = new RpcServer({
        connection: { url: getUrl() },
        queueName: 'test-abort',
        logger,
      });

      server.registerHandler('LONG_TASK', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return { done: true };
      });

      await server.start();

      const client = new RpcClient({
        connection: { url: getUrl() },
        queueName: 'test-abort',
        timeout: 10000,
        logger,
      });

      const controller = new AbortController();

      // Abort after 500ms
      setTimeout(() => controller.abort(), 500);

      await expect(client.send('LONG_TASK', {}, { signal: controller.signal })).rejects.toThrow(
        'Request aborted'
      );

      await client.close();
      await server.stop();
    });
  });

  describe('Server Features', () => {
    it.skip('should respect server prefetch limit', async () => {
      const logger = new SilentLogger();
      const processOrder: number[] = [];

      const server = new RpcServer({
        connection: { url: getUrl() },
        queueName: 'test-prefetch',
        prefetch: 3, // Process max 3 at a time
        logger,
      });

      server.registerHandler('WORK', async (data: { id: number }) => {
        processOrder.push(data.id);
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { id: data.id, done: true };
      });

      await server.start();

      const client = new RpcClient({
        connection: { url: getUrl() },
        queueName: 'test-prefetch',
        logger,
      });

      // Send 10 requests
      const promises = Array.from({ length: 10 }, (_, i) => client.send('WORK', { id: i }));

      await Promise.all(promises);

      // Verify all were processed
      expect(processOrder).toHaveLength(10);

      await client.close();
      await server.stop();
    });

    it('should handle graceful shutdown with in-flight messages', async () => {
      const logger = new SilentLogger();
      let handlerCompleted = false;

      const server = new RpcServer({
        connection: { url: getUrl() },
        queueName: 'test-graceful',
        logger,
      });

      server.registerHandler('SLOW_WORK', async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        handlerCompleted = true;
        return { done: true };
      });

      await server.start();

      const client = new RpcClient({
        connection: { url: getUrl() },
        queueName: 'test-graceful',
        logger,
      });

      // Start request
      const promise = client.send('SLOW_WORK', {});

      // Stop server after 100ms (but it should wait)
      setTimeout(() => server.stop(), 100);

      // Wait for response
      await promise;

      // Verify handler completed
      expect(handlerCompleted).toBe(true);

      await client.close();
    });
  });

  describe('Command Normalization', () => {
    it('should normalize commands to uppercase', async () => {
      const logger = new SilentLogger();

      const server = new RpcServer({
        connection: { url: getUrl() },
        queueName: 'test-normalize',
        logger,
      });

      server.registerHandler('TEST_COMMAND', () => ({ success: true }));

      await server.start();

      const client = new RpcClient({
        connection: { url: getUrl() },
        queueName: 'test-normalize',
        logger,
      });

      // Send with lowercase
      const result1 = await client.send('test_command', {});
      expect(result1.success).toBe(true);

      // Send with mixed case
      const result2 = await client.send('Test_Command', {});
      expect(result2.success).toBe(true);

      await client.close();
      await server.stop();
    });
  });

  describe('Multiple Clients', () => {
    it('should handle multiple clients connecting to same queue', async () => {
      const logger = new SilentLogger();

      const server = new RpcServer({
        connection: { url: getUrl() },
        queueName: 'test-multi-client',
        logger,
      });

      server.registerHandler('INCREMENT', (data: { value: number }) => ({
        result: data.value + 1,
      }));

      await server.start();

      // Create 5 clients
      const clients = await Promise.all(
        Array.from({ length: 5 }, () =>
          Promise.resolve(
            new RpcClient({
              connection: { url: getUrl() },
              queueName: 'test-multi-client',
              logger,
            })
          )
        )
      );

      // Each client sends a request
      const results = await Promise.all(
        clients.map((client: RpcClient, i: number) => client.send('INCREMENT', { value: i }))
      );

      // Verify responses
      results.forEach((result: any, i: number) => {
        expect(result.result).toBe(i + 1);
      });

      // Cleanup
      await Promise.all(clients.map((c: RpcClient) => c.close()));
      await server.stop();
    });
  });

  describe('Isolated Container Tests', () => {
    it('should work with isolated container using withRabbitMQ', async () => {
      await withRabbitMQ(async (url) => {
        const logger = new SilentLogger();

        // Start server
        const server = new RpcServer({
          connection: { url },
          queueName: 'isolated-test',
          logger,
        });

        server.registerHandler('ISOLATED_CMD', (data: { message: string }) => ({
          echo: data.message,
          isolated: true,
        }));

        await server.start();

        // Create client
        const client = new RpcClient({
          connection: { url },
          queueName: 'isolated-test',
          logger,
        });

        // Send request
        const response = await client.send<{ message: string }, any>('ISOLATED_CMD', {
          message: 'Hello from isolated container',
        });

        // Verify
        expect(response.echo).toBe('Hello from isolated container');
        expect(response.isolated).toBe(true);

        // Cleanup
        await client.close();
        await server.stop();
      });
    });

    it('should handle multiple isolated containers in parallel tests', async () => {
      // This demonstrates that each withRabbitMQ call gets its own container
      const test1 = withRabbitMQ(async (url) => {
        const server = new RpcServer({
          connection: { url },
          queueName: 'parallel-1',
          logger: new SilentLogger(),
        });

        server.registerHandler('TEST', () => ({ testId: 1 }));
        await server.start();

        const client = new RpcClient({
          connection: { url },
          queueName: 'parallel-1',
          logger: new SilentLogger(),
        });

        const result = await client.send('TEST', {});
        await client.close();
        await server.stop();

        return result;
      });

      const test2 = withRabbitMQ(async (url) => {
        const server = new RpcServer({
          connection: { url },
          queueName: 'parallel-2',
          logger: new SilentLogger(),
        });

        server.registerHandler('TEST', () => ({ testId: 2 }));
        await server.start();

        const client = new RpcClient({
          connection: { url },
          queueName: 'parallel-2',
          logger: new SilentLogger(),
        });

        const result = await client.send('TEST', {});
        await client.close();
        await server.stop();

        return result;
      });

      // Run tests in parallel - each has its own container
      const [result1, result2] = await Promise.all([test1, test2]);

      expect(result1.testId).toBe(1);
      expect(result2.testId).toBe(2);
    }, 180000); // Longer timeout for parallel containers
  });
});
