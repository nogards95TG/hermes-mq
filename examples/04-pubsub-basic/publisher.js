import { Publisher } from '@hermes/client';
import { ConsoleLogger } from '@hermes/core';

const main = async () => {
  const publisher = new Publisher({
    connection: {
      url: process.env.RABBITMQ_URL || 'amqp://localhost',
    },
    exchange: 'events',
    exchangeType: 'topic',
    logger: new ConsoleLogger(),
  });

  console.log('🚀 Publisher started');

  // Publish user events
  await publisher.publish('user.created', {
    id: 1,
    name: 'John Doe',
    email: 'john@example.com',
  });
  console.log('✅ Published: user.created');

  await publisher.publish('user.updated', {
    id: 1,
    name: 'John Smith',
  });
  console.log('✅ Published: user.updated');

  await publisher.publish('user.deleted', {
    id: 1,
  });
  console.log('✅ Published: user.deleted');

  // Publish order events
  await publisher.publish('order.created', {
    orderId: 'ORD-001',
    userId: 1,
    items: ['item1', 'item2'],
  });
  console.log('✅ Published: order.created');

  await publisher.publish('order.shipped', {
    orderId: 'ORD-001',
    carrier: 'DHL',
  });
  console.log('✅ Published: order.shipped');

  await publisher.publish('order.shipped.express', {
    orderId: 'ORD-002',
    carrier: 'FedEx',
    priority: 'high',
  });
  console.log('✅ Published: order.shipped.express');

  // Publish with metadata
  await publisher.publish(
    'payment.processed',
    {
      orderId: 'ORD-001',
      amount: 99.99,
      currency: 'USD',
    },
    {
      metadata: {
        userId: '123',
        traceId: 'trace-abc-def',
        source: 'payment-gateway',
      },
    }
  );
  console.log('✅ Published: payment.processed (with metadata)');

  // Publish to multiple exchanges
  await publisher.publishToMany(['events', 'audit-logs'], 'system.critical', {
    message: 'Critical system event',
    severity: 'high',
  });
  console.log('✅ Published to multiple exchanges: system.critical');

  console.log('\n✨ All events published successfully');
  console.log('💡 Keep the subscriber running to see the events being consumed\n');

  await publisher.close();
};

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
