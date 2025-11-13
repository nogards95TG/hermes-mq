import { RpcServer } from '@hermes/server';
import { ConsoleLogger } from '@hermes/core';

/**
 * RPC Server Basic Example with Math Operations
 * This example demonstrates how to:
 * 1. Create an RPC server
 * 2. Register multiple handlers for different commands
 * 3. Handle synchronous and asynchronous requests
 * 4. Manage graceful shutdown
 */

const logger = new ConsoleLogger('info');

// Crea RPC Server
const server = new RpcServer({
  connection: {
    url: process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672',
  },
  queueName: 'math-operations',
  prefetch: 10, // Max 10 messages processed at a time
  logger,
});

// Addition handler (synchronous)
server.registerHandler('ADD', (data) => {
  const { a, b } = data;
  logger.info(`Adding ${a} + ${b}`);
  return { result: a + b };
});

// Multiplication handler (synchronous)
server.registerHandler('MULTIPLY', (data) => {
  const { a, b } = data;
  logger.info(`Multiplying ${a} * ${b}`);
  return { result: a * b };
});

// Power handler (async simulation)
server.registerHandler('POWER', async (data) => {
  const { base, exponent } = data;
  logger.info(`Calculating ${base}^${exponent}`);

  // fake async operation
  await new Promise((resolve) => setTimeout(resolve, 100));

  return { result: Math.pow(base, exponent) };
});

// Echo handler
server.registerHandler('ECHO', (data, metadata) => {
  logger.info('Echo request', { data, metadata });
  return {
    echo: data,
    receivedAt: new Date().toISOString(),
    metadata,
  };
});

// Stats handler
server.registerHandler('STATS', () => {
  return {
    handlers: server.getHandlerCount(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  };
});

// Avvia il server
const start = async () => {
  try {
    await server.start();
    logger.info('🚀 RPC Server started successfully');
    logger.info(
      `📝 Registered ${server.getHandlerCount()} handlers: ADD, MULTIPLY, POWER, ECHO, STATS`
    );
    logger.info('✋ Press Ctrl+C to stop');
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
};

// Gestisci shutdown graceful
const shutdown = async () => {
  logger.info('🛑 Shutting down server...');
  try {
    await server.stop();
    logger.info('✅ Server stopped gracefully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', error);
    process.exit(1);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
