import { RpcServer } from '@hermes/server';
import { ConsoleLogger, ValidationError } from '@hermes/core';

/**
 * Rpc Server Error Handling Example
 * This example demonstrates how to:
 * 1. Handle validation errors
 * 2. Implement custom errors
 * 3. Manage timeouts
 * 4. Simulate unreliable operations
 * 5. Handle unexpected crashes
 */

const logger = new ConsoleLogger('info');

const server = new RpcServer({
  connection: {
    url: process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672',
  },
  queueName: 'error-handling-demo',
  prefetch: 5,
  logger,
});

// Handler with input validation
server.registerHandler('DIVIDE', (data) => {
  const { a, b } = data;

  // Input validation
  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new ValidationError('Both a and b must be numbers', { a, b });
  }

  if (b === 0) {
    throw new ValidationError('Cannot divide by zero', { a, b });
  }

  logger.info(`Dividing ${a} / ${b}`);
  return { result: a / b };
});

// Custom error class for insufficient funds
class InsufficientFundsError extends Error {
  constructor(balance, amount) {
    super(`Insufficient funds: balance=${balance}, requested=${amount}`);
    this.name = 'InsufficientFundsError';
    this.code = 'INSUFFICIENT_FUNDS';
    this.details = { balance, amount };
  }
}

server.registerHandler('WITHDRAW', (data) => {
  const { accountId, amount } = data;
  const balance = 100; // Simulated balance

  logger.info(`Withdrawal request: account=${accountId}, amount=${amount}`);

  if (amount > balance) {
    throw new InsufficientFundsError(balance, amount);
  }

  return {
    accountId,
    newBalance: balance - amount,
    transactionId: `TX-${Date.now()}`,
  };
});

// Handler simulating a slow operation
server.registerHandler('SLOW_OPERATION', async (data) => {
  const { delay = 3000 } = data;
  logger.info(`Starting slow operation (${delay}ms)...`);

  await new Promise((resolve) => setTimeout(resolve, delay));

  logger.info('Slow operation completed');
  return {
    completed: true,
    delay,
    timestamp: new Date().toISOString(),
  };
});

// Handler simulating unreliable operation
server.registerHandler('UNRELIABLE', (data) => {
  const { failureRate = 0.3 } = data;
  const random = Math.random();

  logger.info(`Unreliable operation (failure rate: ${failureRate * 100}%)`);

  if (random < failureRate) {
    throw new Error('Random failure occurred');
  }

  return {
    success: true,
    luckyNumber: random,
  };
});

// Handler that crashes unexpectedly
server.registerHandler('CRASH', () => {
  logger.warn('⚠️  Crash handler called - throwing unexpected error');
  throw new Error('Unexpected server error!');
});

const start = async () => {
  try {
    await server.start();
    logger.info('🚀 Error Handling Demo Server started');
    logger.info(`📝 Handlers: DIVIDE, WITHDRAW, SLOW_OPERATION, UNRELIABLE, CRASH`);
    logger.info('✋ Press Ctrl+C to stop');
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
};

const shutdown = async () => {
  logger.info('🛑 Shutting down...');
  try {
    await server.stop();
    logger.info('✅ Server stopped');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', error);
    process.exit(1);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
