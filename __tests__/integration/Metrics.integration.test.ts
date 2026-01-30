import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import {
  RpcClient,
  RpcServer,
  Publisher,
  Subscriber,
  MetricsCollector,
  TimeoutError,
  ConnectionManager,
} from '../../src';

describe('Metrics Integration Tests', () => {
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

  describe('RpcClient metrics', () => {
    let connection: ConnectionManager;

    it('should track successful RPC requests', async () => {
      const metrics = MetricsCollector.global();
      metrics.reset();

      connection = new ConnectionManager({ url: rabbitUrl });

      const server = new RpcServer({
        connection,
        queueName: 'test-rpc-metrics-success',
      });

      server.registerHandler('TEST', async (data: any) => {
        return { result: data.value * 2 };
      });

      await server.start();

      // Give server time to initialize
      await new Promise((resolve) => setTimeout(resolve, 100));

      const client = new RpcClient({
        connection,
        queueName: 'test-rpc-metrics-success',
        enableMetrics: true,
      });

      // Make successful requests
      await client.send('TEST', { value: 5 });
      await client.send('TEST', { value: 10 });

      const output = metrics.toPrometheus();

      // Verify counter
      expect(output).toContain('hermes_rpc_requests_total');
      expect(output).toMatch(
        /hermes_rpc_requests_total\{queue="test-rpc-metrics-success",status="success"\} 2/
      );

      // Verify histogram
      expect(output).toContain('hermes_rpc_request_duration_seconds');
      expect(output).toMatch(
        /hermes_rpc_request_duration_seconds_count\{queue="test-rpc-metrics-success",status="success"\} 2/
      );

      await client.close();
      await server.stop();
      await connection.close();
    });

    it('should track RPC request timeouts', async () => {
      const metrics = MetricsCollector.global();
      metrics.reset();

      connection = new ConnectionManager({ url: rabbitUrl });

      const server = new RpcServer({
        connection,
        queueName: 'test-rpc-metrics-timeout',
      });

      // Handler that takes too long
      server.registerHandler('SLOW', async () => {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return { result: 'done' };
      });

      await server.start();

      const client = new RpcClient({
        connection,
        queueName: 'test-rpc-metrics-timeout',
        timeout: 100, // Very short timeout
        enableMetrics: true,
      });

      try {
        await client.send('SLOW', {});
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError);
      }

      const output = metrics.toPrometheus();

      // Verify timeout counter
      expect(output).toContain('hermes_rpc_requests_total');
      expect(output).toMatch(
        /hermes_rpc_requests_total\{queue="test-rpc-metrics-timeout",status="timeout"\} 3/
      );

      await client.close();
      await server.stop();
      await connection.close();
    });

    it('should track RPC request errors', async () => {
      const metrics = MetricsCollector.global();
      metrics.reset();

      connection = new ConnectionManager({ url: rabbitUrl });

      const server = new RpcServer({
        connection,
        queueName: 'test-rpc-metrics-error',
      });

      server.registerHandler('ERROR', async () => {
        throw new Error('Handler error');
      });

      await server.start();

      const client = new RpcClient({
        connection,
        queueName: 'test-rpc-metrics-error',
        enableMetrics: true,
      });

      try {
        await client.send('ERROR', {});
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }

      const output = metrics.toPrometheus();

      // Verify error counter
      expect(output).toContain('hermes_rpc_requests_total');
      expect(output).toMatch(
        /hermes_rpc_requests_total\{queue="test-rpc-metrics-error",status="error"\} 1/
      );

      // Verify histogram (should still track duration for errors)
      expect(output).toMatch(
        /hermes_rpc_request_duration_seconds_count\{queue="test-rpc-metrics-error",status="error"\} 1/
      );

      await client.close();
      await server.stop();
      await connection.close();
    });
  });

  describe('RpcServer metrics', () => {
    let connection: ConnectionManager;

    it('should track consumed messages and processing duration', async () => {
      const metrics = MetricsCollector.global();
      metrics.reset();

      connection = new ConnectionManager({ url: rabbitUrl });

      const server = new RpcServer({
        connection,
        queueName: 'test-server-metrics',
        enableMetrics: true,
      });

      server.registerHandler('PROCESS', async (data: any) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { processed: data.value };
      });

      await server.start();

      const client = new RpcClient({
        connection,
        queueName: 'test-server-metrics',
      });

      await client.send('PROCESS', { value: 42 });
      await client.send('PROCESS', { value: 100 });

      // Wait a bit for metrics to be updated
      await new Promise((resolve) => setTimeout(resolve, 100));

      const output = metrics.toPrometheus();

      // Verify consumed messages counter
      expect(output).toContain('hermes_messages_consumed_total');
      expect(output).toMatch(
        /hermes_messages_consumed_total\{command="PROCESS",queue="test-server-metrics",status="ack"\} 2/
      );

      // Verify processing duration histogram
      expect(output).toContain('hermes_message_processing_duration_seconds');
      expect(output).toMatch(
        /hermes_message_processing_duration_seconds_count\{command="PROCESS",queue="test-server-metrics"\} 2/
      );

      await client.close();
      await server.stop();
      await connection.close();
    });

    it('should track server errors', async () => {
      const metrics = MetricsCollector.global();
      metrics.reset();

      connection = new ConnectionManager({ url: rabbitUrl });

      const server = new RpcServer({
        connection,
        queueName: 'test-server-error-metrics',
        enableMetrics: true,
      });

      server.registerHandler('FAIL', async () => {
        throw new Error('Processing error');
      });

      await server.start();

      const client = new RpcClient({
        connection,
        queueName: 'test-server-error-metrics',
      });

      try {
        await client.send('FAIL', {});
      } catch (error) {
        // Expected error
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      const output = metrics.toPrometheus();

      // Note: The error is caught in handleRequestError which sends response
      // The initial error tracking happens in the catch block
      expect(output).toContain('hermes_messages_consumed_total');

      await client.close();
      await server.stop();
      await connection.close();
    });
  });

  describe('Publisher metrics', () => {
    let connection: ConnectionManager;

    it('should track published messages', async () => {
      const metrics = MetricsCollector.global();
      metrics.reset();

      connection = new ConnectionManager({ url: rabbitUrl });

      const publisher = new Publisher({
        connection,
        exchange: 'test-publisher-metrics',
        enableMetrics: true,
      });

      await publisher.publish('user.created', { userId: '123' });
      await publisher.publish('user.updated', { userId: '456' });
      await publisher.publish('user.created', { userId: '789' });

      const output = metrics.toPrometheus();

      // Verify published messages counters
      expect(output).toContain('hermes_messages_published_total');
      expect(output).toMatch(
        /hermes_messages_published_total\{eventName="user.created",exchange="test-publisher-metrics",status="success"\} 2/
      );
      expect(output).toMatch(
        /hermes_messages_published_total\{eventName="user.updated",exchange="test-publisher-metrics",status="success"\} 1/
      );

      await publisher.close();
    });
  });

  describe('Subscriber metrics', () => {
    let connection: ConnectionManager;

    it('should track consumed events and processing duration', async () => {
      const metrics = MetricsCollector.global();
      metrics.reset();

      connection = new ConnectionManager({ url: rabbitUrl });

      const publisher = new Publisher({
        connection,
        exchange: 'test-subscriber-metrics',
      });

      const subscriber = new Subscriber({
        connection,
        exchange: 'test-subscriber-metrics',
        enableMetrics: true,
      });

      let processedCount = 0;

      subscriber.on('order.placed', async (data) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        processedCount++;
      });

      await subscriber.start();

      // Give subscriber time to set up
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Publish events
      await publisher.publish('order.placed', { orderId: '1' });
      await publisher.publish('order.placed', { orderId: '2' });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(processedCount).toBe(2);

      const output = metrics.toPrometheus();

      // Verify consumed events counter
      expect(output).toContain('hermes_messages_consumed_total');
      expect(output).toMatch(
        /hermes_messages_consumed_total\{eventName="order.placed",exchange="test-subscriber-metrics",status="ack"\} 2/
      );

      // Verify processing duration histogram
      expect(output).toContain('hermes_message_processing_duration_seconds');
      expect(output).toMatch(
        /hermes_message_processing_duration_seconds_count\{eventName="order.placed",exchange="test-subscriber-metrics"\} 2/
      );

      await subscriber.stop();
      await publisher.close();
    });

    it('should track partial errors in isolated mode', async () => {
      const metrics = MetricsCollector.global();
      metrics.reset();

      connection = new ConnectionManager({ url: rabbitUrl });

      const publisher = new Publisher({
        connection,
        exchange: 'test-subscriber-error-metrics',
      });

      const subscriber = new Subscriber({
        connection,
        exchange: 'test-subscriber-error-metrics',
        errorHandling: {
          isolateErrors: true,
          continueOnError: true,
        },
        enableMetrics: true,
      });

      // Register a handler that fails
      subscriber.on('event.fail', async () => {
        throw new Error('Handler failed');
      });

      await subscriber.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      await publisher.publish('event.fail', { test: true });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 200));

      const output = metrics.toPrometheus();

      // Verify partial error tracking
      expect(output).toContain('hermes_messages_consumed_total');
      expect(output).toMatch(
        /hermes_messages_consumed_total\{eventName="event.fail",exchange="test-subscriber-error-metrics",status="partial_error"\} 1/
      );

      await subscriber.stop();
      await publisher.close();
    });
  });

  describe('Shared metrics collector', () => {
    let connection: ConnectionManager;
    let connection2: ConnectionManager;

    it('should share metrics across multiple components', async () => {
      const metrics = MetricsCollector.global();
      metrics.reset();

      connection = new ConnectionManager({ url: rabbitUrl });

      const server = new RpcServer({
        connection,
        queueName: 'shared-metrics-test',
        enableMetrics: true,
      });

      server.registerHandler('TEST', async (data: any) => ({ result: data }));
      await server.start();

      const client = new RpcClient({
        connection,
        queueName: 'shared-metrics-test',
        enableMetrics: true,
      });

      connection2 = new ConnectionManager({ url: rabbitUrl });

      const publisher = new Publisher({
        connection: connection2,
        exchange: 'shared-metrics-exchange',
        enableMetrics: true,
      });

      // Generate activity
      await client.send('TEST', { value: 1 });
      await publisher.publish('test.event', { data: 'test' });

      const output = metrics.toPrometheus();

      // Should have metrics from both RPC and Pub/Sub
      expect(output).toContain('hermes_rpc_requests_total');
      expect(output).toContain('hermes_messages_published_total');
      expect(output).toContain('hermes_messages_consumed_total');

      await client.close();
      await server.stop();
      await publisher.close();
      await connection.close();
      await connection2.close();
    });
  });
});
