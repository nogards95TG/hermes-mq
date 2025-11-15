/**
 * RPC Client Middleware Example
 *
 * Demonstrates using client-side middleware with Hermes-MQ RpcClient including:
 * - Payload validation before sending
 * - Payload transformation
 * - Request logging
 */

const { RpcClient, ConsoleLogger } = require('hermes-mq');

// Simple Zod-like schema for validation
const addSchema = {
  safeParse: (data) => {
    if (typeof data.a === 'number' && typeof data.b === 'number') {
      return { success: true, data };
    }
    return {
      success: false,
      error: { errors: ['a and b must be numbers'] }
    };
  }
};

async function main() {
  const client = new RpcClient({
    connection: { url: 'amqp://localhost' },
    queueName: 'calculator',
    timeout: 5000,
    logger: new ConsoleLogger('debug'),
  });

  // Client middleware 1: Validate outgoing payload
  const validateMiddleware = async (command, payload) => {
    console.log(`[CLIENT VALIDATE] Command: ${command}, Payload:`, payload);
    
    // If adding numbers, validate
    if (command === 'ADD' || command === 'MULTIPLY' || command === 'DIVIDE') {
      const result = addSchema.safeParse(payload);
      if (!result.success) {
        throw new Error(`Validation error: ${result.error.errors[0]}`);
      }
    }
    
    return { command, payload };
  };

  // Client middleware 2: Log all requests
  const loggingMiddleware = async (command, payload) => {
    console.log(`[CLIENT LOG] Sending request to ${command}`);
    return { command, payload };
  };

  // Client middleware 3: Add metadata to payload
  const metadataMiddleware = async (command, payload) => {
    const enrichedPayload = {
      ...payload,
      _clientId: 'example-client-v1',
      _timestamp: Date.now()
    };
    return { command, payload: enrichedPayload };
  };

  // Register middlewares
  client.use(validateMiddleware);
  client.use(loggingMiddleware);
  // client.use(metadataMiddleware); // Commented: would add extra fields to payload

  try {
    console.log('Making RPC requests...\n');

    // Test ADD
    try {
      console.log('>>> Sending ADD request { a: 5, b: 3 }');
      const result = await client.send('ADD', { a: 5, b: 3 });
      console.log('<<< Result:', result);
      console.log('');
    } catch (error) {
      console.error('Error:', error.message);
      console.log('');
    }

    // Test MULTIPLY
    try {
      console.log('>>> Sending MULTIPLY request { a: 7, b: 6 }');
      const result = await client.send('MULTIPLY', { a: 7, b: 6 });
      console.log('<<< Result:', result);
      console.log('');
    } catch (error) {
      console.error('Error:', error.message);
      console.log('');
    }

    // Test DIVIDE by zero
    try {
      console.log('>>> Sending DIVIDE request { a: 10, b: 0 }');
      const result = await client.send('DIVIDE', { a: 10, b: 0 });
      console.log('<<< Result:', result);
      console.log('');
    } catch (error) {
      console.error('Error:', error.message);
      console.log('');
    }

    // Test ECHO
    try {
      console.log('>>> Sending ECHO request { message: "hello" }');
      const result = await client.send('ECHO', { message: 'hello' });
      console.log('<<< Result:', result);
      console.log('');
    } catch (error) {
      console.error('Error:', error.message);
      console.log('');
    }

    // Test invalid payload (will fail validation in middleware)
    try {
      console.log('>>> Sending ADD request with invalid payload { a: "invalid", b: 3 }');
      const result = await client.send('ADD', { a: 'invalid', b: 3 });
      console.log('<<< Result:', result);
      console.log('');
    } catch (error) {
      console.error('Validation error caught:', error.message);
      console.log('');
    }

    await client.close();
    console.log('Client closed');

  } catch (error) {
    console.error('Client error:', error);
    await client.close();
    process.exit(1);
  }
}

main().catch(console.error);
