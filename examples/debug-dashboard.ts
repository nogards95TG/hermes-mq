/**
 * Hermes MQ Debug Dashboard Example
 *
 * This example demonstrates how to use the built-in debug web UI
 * to monitor RPC requests and responses in real-time.
 *
 * Features shown:
 * - Embedded debug server
 * - Real-time message tracking
 * - Application-level monitoring
 * - Zero configuration setup
 */

import { RpcServer, RpcClient, DebugServer } from '../src';

async function main() {
  console.log('🐛 Starting Hermes MQ with Debug UI...\n');

  // ============================================================================
  // Option 1: Centralized Debug Server (Recommended for multiple services)
  // ============================================================================

  console.log('Starting centralized debug server...');
  const debugServer = new DebugServer({
    enabled: true,
    webUI: {
      port: 9000,
      autoOpen: false, // Set to true to auto-open browser
      host: 'localhost',
    },
    snapshot: {
      enabled: false
    }
  });

  await debugServer.start();
  console.log('✅ Debug UI available at http://localhost:9000\n');

  // ============================================================================
  // RPC Server with Debug Enabled
  // ============================================================================

  const server = new RpcServer({
    connection: { url: 'amqp://admin:admin@localhost' },
    queueName: 'test',
    debug: {
      enabled: true, // Enable debug hooks
    },
    slowMessageDetection: {
      slowThresholds: {
        warn: 100,
        error: 200,
      },
    },
  });

  // Connect server events to debug server
  const serverEmitter = server.getDebugEmitter();
  if (serverEmitter) {
    serverEmitter.on('debug-event', (event) => {
      debugServer.onEvent(event);
    });

    // Register service in debug UI
    debugServer.registerService({
      id: server.getServiceId(),
      type: 'rpc-server',
      name: 'test-rpc-server',
      status: 'active',
      startedAt: new Date(),
      messageCount: 0,
    });
  }

  // Register handlers
  server.registerHandler('TEST', (data) => {
    return data;
  });

  server.registerHandler('SLOW', (data) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ result: data.a * data.b });
      }, 150);
    });
  });

  server.registerHandler('SLOW_ERROR', (data) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ result: data.a * data.b });
      }, 250);
    });
  });

  server.registerHandler('ERROR', (data) => {
    // Simulate error condition
    if (!data) {
      throw new Error('Data is required');
    }

    return data;
  });

  await server.start();
  console.log('✅ RPC Server started\n');

  // ============================================================================
  // RPC Client with Debug Enabled
  // ============================================================================

  const client = new RpcClient({
    connection: { url: 'amqp://admin:admin@localhost' },
    queueName: 'test',
    debug: {
      enabled: true, // Enable debug hooks
    },
  });

  // Connect client events to debug server
  const clientEmitter = client.getDebugEmitter();
  if (clientEmitter) {
    clientEmitter.on('debug-event', (event) => {
      debugServer.onEvent(event);
    });

    debugServer.registerService({
      id: client.getServiceId(),
      type: 'rpc-client',
      name: 'test-rpc-client',
      status: 'active',
      startedAt: new Date(),
      messageCount: 0,
    });
  }

  console.log('✅ RPC Client ready\n');
  console.log('📊 Open http://localhost:9000 in your browser to see the debug UI\n');
  console.log('Sending test requests...\n');

  // ============================================================================
  // Send Test Requests (will appear in Debug UI)
  // ============================================================================

  try {
    // Successful requests
    const result1 = await client.send('TEST', { hello: 'world' });
    console.log(`Result1: ${JSON.stringify(result1)}\n`);

    const result2 = await client.send('SLOW', { data: 'slow_request' });
    console.log(`Result2: ${JSON.stringify(result2)}\n`);

    const result3 = await client.send('SLOW_ERROR', { data: 'very_slow_request' });
    console.log(`Result3: ${JSON.stringify(result3)}\n`);

    // const result4 = await client.send('ERROR', { valid: true });
    // console.log(`Result4: ${JSON.stringify(result4)}\n`);

    // const result5 = await client.send('ERROR', null);
    // console.log(`Result5: ${JSON.stringify(result5)}\n`);

    // Send multiple requests to populate the dashboard
    // console.log('Sending batch of requests for demo...');
    // const promises = [];

    // for (let i = 0; i < 10; i++) {
    //   promises.push(
    //     client.send('ADD', { a: i, b: i * 2 }).catch(() => {}),
    //   );

    //   // Some will be slow
    //   if (i % 3 === 0) {
    //     promises.push(
    //       client.send('SLOW_OPERATION', { delay: Math.random() * 200 }).catch(() => {}),
    //     );
    //   }

    //   // Some will error
    //   // if (i % 5 === 0) {
    //   //   promises.push(
    //   //     client.send('DIVIDE', { a: 10, b: 0 }).catch(() => {}),
    //   //   );
    //   // }
    // }

    // await Promise.all(promises);
  } catch (error) {
    console.error('Error:', error);
  }

  // ============================================================================
  // Keep Running
  // ============================================================================

  console.log('✨ Debug Dashboard is running!');
  console.log('📊 View real-time metrics at http://localhost:9000');
  console.log('\nPress Ctrl+C to stop\n');

  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down...');
    await client.close();
    await server.stop();
    await debugServer.stop();
    process.exit(0);
  });
}

main().catch(console.error);
