import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import {
  RpcClient,
  RpcServer,
  Publisher,
  Subscriber,
  MetricsCollector,
} from '../../src';

describe('Global Metrics Integration Tests', () => {
  let container: StartedTestContainer;
  let rabbitUrl: string;

  beforeAll(async () => {
    // Start RabbitMQ container
    container = await new GenericContainer('rabbitmq:3-management-alpine')
      .withExposedPorts(5672)
      .withStartupTimeout(120000)
      .start();

    const host = container.getHost();
    const port = container.getMappedPort(5672);
    rabbitUrl = `amqp://${host}:${port}`;
  }, 120000);

  afterAll(async () => {
    if (container) {
      await container.stop();
    }
  });

  beforeEach(() => {
    // Reset global metrics before each test
    MetricsCollector.resetGlobal();
  });

  describe('Global metrics collection', () => {
    it('should automatically collect metrics from all components when enabled', async () => {
      // Get global metrics instance
      const metrics = MetricsCollector.global();

      // Create components with metrics enabled
      const server = new RpcServer({
        connection: { url: rabbitUrl },
        queueName: 'test-global-metrics',
        enableMetrics: true,
      });

      server.registerHandler('PING', async () => ({ message: 'pong' }));
      await server.start();

      // Give server time to initialize
      await new Promise(resolve => setTimeout(resolve, 100));

      const client = new RpcClient({
        connection: { url: rabbitUrl },
        queueName: 'test-global-metrics',
        enableMetrics: true,
      });

      const publisher = new Publisher({
        connection: { url: rabbitUrl },
        exchange: 'test-global-exchange',
        enableMetrics: true,
      });

      // Generate activity
      await client.send('PING', {});
      await publisher.publish('test.event', { data: 'test' });

      // Wait a bit for metrics to be updated
      await new Promise(resolve => setTimeout(resolve, 100));

      const output = metrics.toPrometheus();

      // Verify metrics from all components are collected
      expect(output).toContain('hermes_rpc_requests_total');
      expect(output).toContain('hermes_messages_published_total');
      expect(output).toContain('hermes_messages_consumed_total');

      await client.close();
      await server.stop();
      await publisher.close();
    });

    it('should not collect metrics when disabled', async () => {
      const server = new RpcServer({
        connection: { url: rabbitUrl },
        queueName: 'test-no-metrics',
        enableMetrics: false, // explicitly disabled
      });

      server.registerHandler('TEST', async () => ({ result: 'ok' }));
      await server.start();

      await new Promise(resolve => setTimeout(resolve, 100));

      const client = new RpcClient({
        connection: { url: rabbitUrl },
        queueName: 'test-no-metrics',
        // enableMetrics defaults to false
      });

      await client.send('TEST', {});

      // Get global instance
      const metrics = MetricsCollector.global();
      const output = metrics.toPrometheus();

      // Should be empty since metrics were not enabled
      expect(output).toBe('');

      await client.close();
      await server.stop();
    });

    it('should aggregate metrics from multiple components into single global instance', async () => {
      const metrics = MetricsCollector.global();

      // Create multiple clients and servers
      const server1 = new RpcServer({
        connection: { url: rabbitUrl },
        queueName: 'queue-1',
        enableMetrics: true,
      });

      const server2 = new RpcServer({
        connection: { url: rabbitUrl },
        queueName: 'queue-2',
        enableMetrics: true,
      });

      server1.registerHandler('ADD', async (data: any) => ({ result: data.a + data.b }));
      server2.registerHandler('MULTIPLY', async (data: any) => ({ result: data.a * data.b }));

      await server1.start();
      await server2.start();

      await new Promise(resolve => setTimeout(resolve, 100));

      const client1 = new RpcClient({
        connection: { url: rabbitUrl },
        queueName: 'queue-1',
        enableMetrics: true,
      });

      const client2 = new RpcClient({
        connection: { url: rabbitUrl },
        queueName: 'queue-2',
        enableMetrics: true,
      });

      // Generate activity on both queues
      await client1.send('ADD', { a: 2, b: 3 });
      await client2.send('MULTIPLY', { a: 4, b: 5 });

      await new Promise(resolve => setTimeout(resolve, 100));

      const output = metrics.toPrometheus();

      // Verify metrics from both queues
      expect(output).toMatch(/hermes_rpc_requests_total\{queue="queue-1",status="success"\} 1/);
      expect(output).toMatch(/hermes_rpc_requests_total\{queue="queue-2",status="success"\} 1/);
      expect(output).toMatch(/hermes_messages_consumed_total\{command="ADD",queue="queue-1",status="ack"\} 1/);
      expect(output).toMatch(/hermes_messages_consumed_total\{command="MULTIPLY",queue="queue-2",status="ack"\} 1/);

      await client1.close();
      await client2.close();
      await server1.stop();
      await server2.stop();
    });

    it('should allow mixing components with and without metrics', async () => {
      const metrics = MetricsCollector.global();

      const serverWithMetrics = new RpcServer({
        connection: { url: rabbitUrl },
        queueName: 'with-metrics',
        enableMetrics: true,
      });

      const serverWithoutMetrics = new RpcServer({
        connection: { url: rabbitUrl },
        queueName: 'without-metrics',
        enableMetrics: false,
      });

      serverWithMetrics.registerHandler('TEST', async () => ({ result: 'ok' }));
      serverWithoutMetrics.registerHandler('TEST', async () => ({ result: 'ok' }));

      await serverWithMetrics.start();
      await serverWithoutMetrics.start();

      await new Promise(resolve => setTimeout(resolve, 100));

      const client1 = new RpcClient({
        connection: { url: rabbitUrl },
        queueName: 'with-metrics',
        enableMetrics: true,
      });

      const client2 = new RpcClient({
        connection: { url: rabbitUrl },
        queueName: 'without-metrics',
        // No metrics
      });

      await client1.send('TEST', {});
      await client2.send('TEST', {});

      await new Promise(resolve => setTimeout(resolve, 100));

      const output = metrics.toPrometheus();

      // Should only have metrics from components with metrics enabled
      expect(output).toContain('queue="with-metrics"');
      expect(output).not.toContain('queue="without-metrics"');

      await client1.close();
      await client2.close();
      await serverWithMetrics.stop();
      await serverWithoutMetrics.stop();
    });
  });
});
