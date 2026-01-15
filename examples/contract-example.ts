/**
 * Example: Contract-based RPC with Type Safety
 *
 * This demonstrates the full contract-first workflow with type inference.
 */

import { defineContract, v, createContractServer, createContractClient } from '../src';

// Step 1: Define the contract
const usersContract = defineContract({
  serviceName: 'users',
  commands: {
    GET_USER: {
      req: v.string().uuid(),
      res: v.string(),
    },
    CREATE_USER: {
      req: v.string().min(2).max(50),
      res: v.string(),
    },
  },
});

async function main() {
  // Step 2: Create server with type-safe handlers
  const server = createContractServer(usersContract, {
    connection: { url: 'amqp://localhost' },
    validate: false,
  });

  // ✅ Autocomplete on command names!
  server.registerHandler('GET_USER', async (userId) => {
    // ✅ userId is typed as string (UUID validated)
    console.log('Server: Received GET_USER request:', userId);
    return `User ${userId}`;
  });

  server.registerHandler('CREATE_USER', async (name) => {
    // ✅ name is typed as string (min 2, max 50)
    console.log('Server: Received CREATE_USER request:', name);
    return `Created user: ${name}`;
  });

  await server.start();
  console.log('✓ Server started');

  // Step 3: Create client with type-safe calls
  const client = createContractClient(usersContract, {
    connection: { url: 'amqp://localhost' },
  });

  // Wait a bit for server to be ready
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    // ✅ Autocomplete on command names!
    // ✅ Request is typed and validated!
    const user = await client.send('GET_USER', '550e8400-e29b-41d4-a716-446655440000');
    console.log('Client: Received response:', user);

    const newUser = await client.send('CREATE_USER', 'John Doe');
    console.log('Client: Received response:', newUser);

    // ❌ This would fail validation (not a UUID)
    // await client.send('GET_USER', 'invalid-uuid');

    // ❌ This would fail validation (too short)
    // await client.send('CREATE_USER', 'J');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
    await server.stop();
    console.log('✓ Cleaned up');
  }
}

main().catch(console.error);
