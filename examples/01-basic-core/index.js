/**
 * Basic example of using @hermes/core
 *
 * This example demonstrates:
 * - ConnectionManager usage
 * - ChannelPool usage
 * - RetryPolicy usage
 * - Custom Logger
 */

const { ConnectionManager, ChannelPool, RetryPolicy, ConsoleLogger } = require('@hermes/core');

const main = async () => {
  // Create a logger
  const logger = new ConsoleLogger('debug');

  try {
    logger.info('=== Hermes Core Example ===');

    // 1. Create ConnectionManager
    const manager = ConnectionManager.getInstance({
      url: process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost',
      reconnect: true,
      reconnectInterval: 5000,
      maxReconnectAttempts: 3,
      logger,
    });

    // Listen to connection events
    manager.on('connected', () => logger.info('✅ Connected to RabbitMQ'));
    manager.on('disconnected', () => logger.warn('⚠️  Disconnected from RabbitMQ'));
    manager.on('error', (error) => logger.error('❌ Connection error', error));
    manager.on('reconnecting', ({ attempt }) =>
      logger.info(`🔄 Reconnecting... (attempt ${attempt})`)
    );

    // 2. Get connection
    const connection = await manager.getConnection();
    logger.info(`Connection ready: ${manager.isConnected()}`);

    // 3. Create ChannelPool
    const pool = new ChannelPool(
      connection,
      {
        min: 1,
        max: 5,
        acquireTimeout: 5000,
      },
      logger
    );

    logger.info(`Channel pool created - Size: ${pool.size()}, Available: ${pool.available()}`);

    // 4. Use RetryPolicy
    const retryPolicy = new RetryPolicy(
      {
        enabled: true,
        maxAttempts: 3,
        initialDelay: 1000,
        backoffMultiplier: 2,
      },
      logger
    );

    // 5. Acquire and use a channel
    const channel = await pool.acquire();
    logger.info('Channel acquired from pool');

    try {
      // Assert a queue
      const queueName = 'hermes-test-queue';
      await channel.assertQueue(queueName, {
        durable: true,
      });

      logger.info(`Queue "${queueName}" asserted`);

      // Publish a test message
      const message = { text: 'Hello from Hermes!', timestamp: Date.now() };
      channel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), { persistent: true });

      logger.info('Message published:', message);

      // Wait for confirmation
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      // Always release the channel back to the pool
      pool.release(channel);
      logger.info('Channel released back to pool');
    }

    logger.info(
      `Pool stats - Size: ${pool.size()}, Available: ${pool.available()}, Pending: ${pool.pending()}`
    );

    // 6. Demonstrate RetryPolicy
    logger.info('\n=== Testing RetryPolicy ===');

    let attemptCount = 0;
    const result = await retryPolicy.execute(async () => {
      attemptCount++;
      if (attemptCount < 2) {
        throw new Error('ECONNREFUSED - Simulated connection error');
      }
      return { success: true, attempts: attemptCount };
    }, 'test-operation');

    logger.info('Retry result:', result);

    // Cleanup
    await pool.drain();
    logger.info('Channel pool drained');

    await manager.close();
    logger.info('Connection closed');

    logger.info('\n✅ Example completed successfully!');
  } catch (error) {
    logger.error('Example failed', error);
    process.exit(1);
  }
};

main();
