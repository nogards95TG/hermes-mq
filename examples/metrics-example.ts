/**
 * Example: Prometheus Metrics with Global Collection
 *
 * This example shows how to use the new automatic global metrics collection.
 * All components automatically aggregate their metrics into a single global instance.
 */

import express from 'express';
import { MetricsCollector, RpcServer, RpcClient, Publisher, Subscriber } from 'hermes-mq';

const app = express();

// Get the global metrics instance
// This singleton collects all metrics from all components that have enableMetrics: true
const metrics = MetricsCollector.global();

// Create RPC Server with metrics enabled
const rpcServer = new RpcServer({
  connection: { url: 'amqp://localhost' },
  queueName: 'users-service',
  enableMetrics: true, // ← Simply enable metrics!
});

rpcServer.registerHandler('GET_USER', async (data: { userId: string }) => {
  // Simulate database lookup
  await new Promise(resolve => setTimeout(resolve, 50));
  return {
    id: data.userId,
    name: 'John Doe',
    email: 'john@example.com'
  };
});

// Create RPC Client with metrics enabled
const rpcClient = new RpcClient({
  connection: { url: 'amqp://localhost' },
  queueName: 'orders-service',
  enableMetrics: true, // ← Metrics automatically collected!
});

// Create Publisher with metrics enabled
const publisher = new Publisher({
  connection: { url: 'amqp://localhost' },
  exchange: 'events',
  enableMetrics: true, // ← No need to pass metrics instance!
});

// Create Subscriber with metrics enabled
const subscriber = new Subscriber({
  connection: { url: 'amqp://localhost' },
  exchange: 'events',
  enableMetrics: true, // ← Metrics shared globally!
});

subscriber.on('user.created', async (data) => {
  console.log('User created:', data);
  // Process event...
});

// Expose Prometheus metrics endpoint
app.get('/metrics', (req, res) => {
  // All metrics from all components are automatically here!
  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send(metrics.toPrometheus());
});

// Example API endpoint that uses RPC
app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await rpcClient.send('GET_USER', {
      userId: req.params.id
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Example API endpoint that publishes events
app.post('/api/users', async (req, res) => {
  try {
    // Create user in database...
    const newUser = { id: '123', ...req.body };

    // Publish event - metrics are automatically tracked!
    await publisher.publish('user.created', newUser);

    res.json(newUser);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Start everything
async function start() {
  await rpcServer.start();
  await subscriber.start();

  app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
    console.log('Metrics available at http://localhost:3000/metrics');
    console.log('');
    console.log('All components share the same global metrics instance!');
    console.log('Visit /metrics to see aggregated metrics from:');
    console.log('  - RpcServer (messages consumed, processing duration)');
    console.log('  - RpcClient (requests sent, durations, errors)');
    console.log('  - Publisher (messages published)');
    console.log('  - Subscriber (messages consumed, processing duration)');
  });
}

start().catch(console.error);

// Benefits of the new approach:
// ✅ No need to create MetricsCollector instances manually
// ✅ No need to pass metrics to each component
// ✅ All metrics automatically aggregated in one place
// ✅ Simple enableMetrics: true flag
// ✅ Zero configuration
// ✅ Metrics from all components share labels and timestamps correctly
