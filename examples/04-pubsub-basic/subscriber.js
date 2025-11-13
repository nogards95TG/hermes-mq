import { Subscriber } from '@hermes/server';
import { ConsoleLogger } from '@hermes/core';

const main = async () => {
  const subscriber = new Subscriber({
    connection: {
      url: process.env.RABBITMQ_URL || 'amqp://localhost',
    },
    exchange: 'events',
    exchangeType: 'topic',
    prefetch: 10,
    logger: new ConsoleLogger(),
  });

  console.log('🎧 Subscriber starting...\n');

  // Subscribe to all user events (wildcard *)
  subscriber.on('user.*', (data, context) => {
    console.log(`📨 [user.*] ${context.eventName}:`, data);
  });

  // Subscribe to all order events (wildcard #)
  subscriber.on('order.#', (data, context) => {
    console.log(`📦 [order.#] ${context.eventName}:`, data);
  });

  // Subscribe to specific payment events
  subscriber.on('payment.processed', (data, context) => {
    console.log(`💳 [payment.processed]:`, data);
    if (context.metadata) {
      console.log(`   Metadata:`, context.metadata);
    }
  });

  // Subscribe to critical system events
  subscriber.on('system.critical', (data, context) => {
    console.log(`🚨 [system.critical]:`, data);
    console.log(`   Timestamp: ${new Date(context.timestamp).toISOString()}`);
  });

  // Multiple handlers for the same event
  subscriber.on('user.created', (data) => {
    console.log(`   🔔 Additional handler triggered for user.created`);
  });

  await subscriber.start();
  console.log('✅ Subscriber is running and listening for events...');
  console.log('   Patterns: user.*, order.#, payment.processed, system.critical');
  console.log('   Press Ctrl+C to stop\n');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down subscriber...');
    await subscriber.stop();
    console.log('✅ Subscriber stopped gracefully');
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await subscriber.stop();
    process.exit(0);
  });
};

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
