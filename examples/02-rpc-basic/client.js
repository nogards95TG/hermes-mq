import { RpcClient } from '@hermes/client';
import { ConsoleLogger } from '@hermes/core';

/**
 * RPC Client Example
 * * This example demonstrates how to:
 * 1. Create an RPC client
 * 2. Send synchronous requests
 * 3. Handle timeouts and errors
 * 4. Send metadata with requests
 * 5. Properly close the client
 */

const logger = new ConsoleLogger('info');

// Create RPC Client
const client = new RpcClient({
  connection: {
    url: process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672',
  },
  queueName: 'math-operations',
  timeout: 5000, // 5 seconds timeout for requests
  logger,
});

const main = async () => {
  try {
    logger.info('🚀 Starting RPC Client examples\n');

    // Example 1: Addition
    logger.info('📤 Example 1: ADD');
    const sum = await client.send('ADD', { a: 10, b: 5 });
    logger.info(`✅ Result: ${sum.result}\n`);

    // Example 2: Multiplication
    logger.info('📤 Example 2: MULTIPLY');
    const product = await client.send('MULTIPLY', { a: 7, b: 6 });
    logger.info(`✅ Result: ${product.result}\n`);

    // Example 3: Power (asynchronous operation)
    logger.info('📤 Example 3: POWER');
    const power = await client.send('POWER', { base: 2, exponent: 10 });
    logger.info(`✅ Result: ${power.result}\n`);

    // Example 4: ECHO with metadata
    logger.info('📤 Example 4: ECHO with metadata');
    const echo = await client.send(
      'ECHO',
      { message: 'Hello from client!' },
      {
        metadata: {
          clientId: 'example-client-1',
          timestamp: Date.now(),
        },
      }
    );
    logger.info('✅ Echo response:', echo);
    logger.info('');

    // Example 5: Get server stats
    logger.info('📤 Example 5: Server STATS');
    const stats = await client.send('STATS', {});
    logger.info('✅ Server stats:', {
      handlers: stats.handlers,
      uptime: `${stats.uptime.toFixed(2)}s`,
      memory: `${(stats.memory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
    });
    logger.info('');

    // Example 6: Parallel requests
    logger.info('📤 Example 6: Parallel requests');
    const start = Date.now();
    const results = await Promise.all([
      client.send('ADD', { a: 1, b: 2 }),
      client.send('MULTIPLY', { a: 3, b: 4 }),
      client.send('POWER', { base: 2, exponent: 3 }),
    ]);
    const duration = Date.now() - start;
    logger.info(`✅ Completed 3 operations in ${duration}ms`);
    logger.info(
      'Results:',
      results.map((r) => r.result)
    );
    logger.info('');
  } catch (error) {
    logger.error('❌ Error:', error.message);
  } finally {
    // close the client
    await client.close();
    logger.info('👋 Client closed');
  }
};

main();
