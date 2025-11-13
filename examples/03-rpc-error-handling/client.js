import { RpcClient } from '@hermes/client';
import { ConsoleLogger, TimeoutError, RetryPolicy } from '@hermes/core';

/**
 * Rpc Client Error Handling Example
 * * This example demonstrates how to:
 * 1. Handle validation errors from the server
 * 2. Manage timeouts
 * 3. Use AbortSignal to cancel requests
 * 4. Implement retry logic
 * 5. Handle custom errors
 */

const logger = new ConsoleLogger('info');

const client = new RpcClient({
  connection: {
    url: process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672',
  },
  queueName: 'error-handling-demo',
  timeout: 5000,
  logger,
});

const main = async () => {
  try {
    logger.info('🚀 Starting Error Handling Examples\n');

    // Example 1: Validation Error
    logger.info('📤 Example 1: Validation Error (divide by zero)');
    try {
      await client.send('DIVIDE', { a: 10, b: 0 });
    } catch (error) {
      logger.error(`❌ Caught error: ${error.message}`);
      logger.info(`   Error name: ${error.name}`);
      logger.info(`   Details: ${JSON.stringify(error.details || {})}\n`);
    }

    // Example 2: Invalid Input Type
    logger.info('📤 Example 2: Invalid Input Type');
    try {
      await client.send('DIVIDE', { a: 'ten', b: 5 });
    } catch (error) {
      logger.error(`❌ Caught error: ${error.message}\n`);
    }

    // Example 3: Custom Error
    logger.info('📤 Example 3: Custom Error (insufficient funds)');
    try {
      await client.send('WITHDRAW', { accountId: 'ACC-123', amount: 150 });
    } catch (error) {
      logger.error(`❌ ${error.message}`);
      if (error.details) {
        logger.info(`   Balance: ${error.details.balance}`);
        logger.info(`   Requested: ${error.details.amount}\n`);
      }
    }

    // Example 4: Timeout
    logger.info('📤 Example 4: Timeout (operation too slow)');
    try {
      // 2 second timeout, but operation takes 3 seconds
      await client.send('SLOW_OPERATION', { delay: 3000 }, { timeout: 2000 });
    } catch (error) {
      if (error instanceof TimeoutError) {
        logger.error(`❌ Request timed out after ${error.details?.timeout}ms\n`);
      } else {
        logger.error(`❌ Error: ${error.message}\n`);
      }
    }

    // Example 5: Slow Operation with sufficient timeout
    logger.info('📤 Example 5: Slow Operation (with sufficient timeout)');
    const slowResult = await client.send('SLOW_OPERATION', { delay: 1000 }, { timeout: 3000 });
    logger.info(`✅ Completed: ${slowResult.completed}\n`);

    // Example 6: Request Cancellation with AbortSignal
    logger.info('📤 Example 6: Request Cancellation with AbortSignal');
    const controller = new AbortController();

    // Abort the request after 500ms
    setTimeout(() => {
      logger.info('   ⚠️  Aborting request...');
      controller.abort();
    }, 500);

    try {
      await client.send(
        'SLOW_OPERATION',
        { delay: 2000 },
        { signal: controller.signal, timeout: 5000 }
      );
    } catch (error) {
      logger.error(`❌ ${error.message}\n`);
    }

    // Example 7: Retry Logic for Unreliable Operation
    logger.info('📤 Example 7: Retry Logic for Unreliable Operation');

    const retryPolicy = new RetryPolicy({
      maxAttempts: 5,
      initialDelay: 100,
      maxDelay: 1000,
      backoffMultiplier: 2,
      retryableErrors: ['Random failure', 'timeout'],
    });

    let attempts = 0;
    const reliableCall = async () => {
      attempts++;
      logger.info(`   Attempt ${attempts}...`);
      return await client.send('UNRELIABLE', { failureRate: 0.6 });
    };

    try {
      const result = await retryPolicy.execute(reliableCall);
      logger.info(`✅ Success after ${attempts} attempts`);
      logger.info(`   Lucky number: ${result.luckyNumber.toFixed(3)}\n`);
    } catch (error) {
      logger.error(`❌ Failed after ${attempts} attempts: ${error.message}\n`);
    }

    // Example 8: Handling Server Crash
    logger.info('📤 Example 8: Handling Server Crash');
    try {
      await client.send('CRASH', {});
    } catch (error) {
      logger.error(`❌ Server error: ${error.message}\n`);
    }

    // Example 9: Successful Division
    logger.info('📤 Example 9: Successful Division');
    const divResult = await client.send('DIVIDE', { a: 100, b: 5 });
    logger.info(`✅ Result: ${divResult.result}\n`);

    logger.info('🎉 All examples completed!');
  } catch (error) {
    logger.error('❌ Unexpected error:', error);
  } finally {
    await client.close();
    logger.info('👋 Client closed');
  }
};

main();
