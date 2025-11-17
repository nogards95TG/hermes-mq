/**
 * RPC Server Middleware Example
 *
 * Demonstrates using middleware with Hermes-MQ RpcServer including:
 * - Global middleware
 * - Handler-specific middleware
 * - Built-in validate middleware
 * - Built-in retry middleware
 */

const { RpcServer, validate, retry, ConsoleLogger } = require('hermes-mq');

// Example: using Zod (would need: npm install zod)
// const { z } = require('zod');
// const addSchema = z.object({
//   a: z.number(),
//   b: z.number()
// });

// For demo purposes, create a simple Zod-like schema
const addSchema = {
  safeParse: (data) => {
    if (typeof data.a === 'number' && typeof data.b === 'number') {
      return { success: true, data };
    }
    return {
      success: false,
      error: { errors: ['a and b must be numbers'] },
    };
  },
};

const main = async () => {
  const server = new RpcServer({
    connection: { url: 'amqp://localhost' },
    queueName: 'calculator',
    logger: new ConsoleLogger('debug'),
  });

  // Global middleware - applied to all handlers
  server.use(async (ctx, next) => {
    const startTime = Date.now();
    console.log(`[REQUEST] Command: ${ctx.command}, Payload:`, ctx.payload);

    await next();

    const duration = Date.now() - startTime;
    console.log(`[RESPONSE] Command: ${ctx.command}, Duration: ${duration}ms`);
  });

  // Handler with validation middleware
  server.registerHandler(
    'ADD',
    validate(addSchema), // Validates payload before handler
    async (payload, ctx) => {
      console.log(`[ADD] Calculating ${payload.a} + ${payload.b}`);
      return { sum: payload.a + payload.b };
    }
  );

  // Handler with validation and retry middleware
  server.registerHandler(
    'MULTIPLY',
    validate(addSchema),
    retry({
      maxAttempts: 3,
      backoffStrategy: 'exponential',
      backoffDelay: 1000,
    }),
    async (payload, ctx) => {
      console.log(`[MULTIPLY] Calculating ${payload.a} * ${payload.b}`);
      return { product: payload.a * payload.b };
    }
  );

  // Handler that uses context metadata from middleware
  server.registerHandler('DIVIDE', validate(addSchema), async (payload, ctx) => {
    if (payload.b === 0) {
      // Can short-circuit and return error
      return {
        error: 'DivisionByZero',
        message: 'Cannot divide by zero',
      };
    }
    console.log(`[DIVIDE] Calculating ${payload.a} / ${payload.b}`);
    return { quotient: payload.a / payload.b };
  });

  // Simple handler without middleware (backward compatible)
  server.registerHandler('ECHO', async (payload) => {
    console.log(`[ECHO] Echoing:`, payload);
    return payload;
  });

  try {
    console.log('Starting RPC server...');
    await server.start();
    console.log('Server listening on queue: calculator');

    // Keep server running
    console.log('Press Ctrl+C to stop');
    await new Promise(() => {});
  } catch (error) {
    console.error('Server error:', error);
    await server.stop();
    process.exit(1);
  }
};

main().catch(console.error);
