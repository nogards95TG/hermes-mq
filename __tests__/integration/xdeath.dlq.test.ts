/*
  Integration test scaffold for DLQ/x-death behavior using Testcontainers.
  This test requires Docker and will not be run by default in the unit test suite.
  To run integration tests you can use the special vitest integration config:

    pnpm test:integration

  The test below demonstrates using testcontainers to start RabbitMQ, create a queue,
  and publish a message with `x-death` headers to assert the Subscriber/RpcServer
  identify attempts correctly.

  NOTE: This file is a scaffold. Running it requires Docker and may be slow/flaky
  in CI. Keep it under `__tests__/integration` and run separately.
*/

import { test } from 'vitest';
import { GenericContainer } from 'testcontainers';
import amqp from 'amqplib';

test.skip('integration: DLQ/x-death behavior (scaffold)', async () => {
  // Start rabbitmq container
  const container = await new GenericContainer('rabbitmq:3-management')
    .withExposedPorts(5672, 15672)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5672);
  const url = `amqp://${host}:${port}`;

  const conn = await amqp.connect(url);
  const ch = await conn.createChannel();

  const exchange = 'test-ex';
  const queue = 'test-queue';

  await ch.assertExchange(exchange, 'topic', { durable: true });
  // Create queue with a dead-letter-exchange to simulate DLQ cycles
  await ch.assertQueue(queue, { durable: true });
  await ch.bindQueue(queue, exchange, '#');

  // Publish a message that already has x-death header entries (simulated)
  const headers = {
    'x-death': [{ queue: queue, count: 2, 'routing-keys': ['a.b'] }],
  };

  ch.publish(exchange, 'a.b', Buffer.from(JSON.stringify({ hello: 'world' })), {
    headers,
  });

  // Here you would start your Subscriber/RpcServer against this broker and assert
  // that getXDeathCount reports attempts=2 and that maxRetries logic triggers.
  // For brevity this scaffold stops here.

  await ch.close();
  await conn.close();
  await container.stop();
});
