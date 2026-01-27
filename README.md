# Hermes MQ 🚀

[![Test](https://github.com/nogards95TG/hermes-mq/workflows/Test/badge.svg)](https://github.com/nogards95TG/hermes-mq/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org)

Modern, type-safe RabbitMQ client library for Node.js with intuitive APIs for RPC and Pub/Sub patterns.

## ✨ Features

- 🎯 **Type-Safe**: Full TypeScript support with generics
- 🔌 **Connection Pooling**: Automatic channel reuse and health checks
- 🔄 **Auto Reconnection**: Exponential backoff retry logic with circuit breaker
- 🎭 **Dual Patterns**: Both RPC (request/response) and Pub/Sub (events)
- 📝 **Flexible Logging**: Pluggable logger interface (Winston, Pino, etc.)
- 🧪 **Testable**: Mock implementations and Testcontainers support
- 🚀 **Production Ready**: Graceful shutdown, error handling, monitoring
- 📦 **Zero Dependencies**: Only depends on `amqplib`
- ✅ **Publisher Confirms**: Built-in message persistence validation
- 🔒 **Persistent Messages**: Auto messageId and timestamp on all messages
- 🧹 **Memory Safe**: Automatic cleanup of expired RPC callbacks
- 🔁 **Auto Recovery**: Consumer re-registration on server cancellation
- 🚦 **Flow Control**: Built-in backpressure handling
- ⏱️ **TTL & Limits**: Queue message expiration and size limits
- 🛡️ **Best Practices**: Following RabbitMQ production recommendations
- 📊 **Slow Message Detection**: Multi-level thresholds for performance monitoring
- 🏥 **Health Checks**: Built-in health check API for Kubernetes liveness/readiness probes
- 📈 **Prometheus Metrics**: Zero-dependency metrics export in Prometheus text format

## Quick Start

### Prerequisites

- Node.js 18 or higher
- RabbitMQ server running (or use our Docker Compose setup)

### Start RabbitMQ

```bash
docker-compose up -d
```

RabbitMQ will be available at:

- AMQP: `amqp://localhost:5672`
- Management UI: `http://localhost:15672` (admin/admin)

### Installation

```bash
# Using npm
npm install hermes-mq

# Using yarn
yarn add hermes-mq

# Using pnpm
pnpm add hermes-mq
```

## 📖 Usage Examples

### RPC Pattern (Request/Response)

**Server:**

```typescript
import { RpcServer } from 'hermes-mq';
import { ConnectionManager } from 'hermes-mq';

const connection = new ConnectionManager({ url: 'amqp://localhost' });

const server = new RpcServer({
  connection,
  queueName: 'users',
  prefetch: 15, // defaults to 10 (RabbitMQ best practice)
});

server
  .registerHandler('GET_USER', async ({ id }: { id: string }) => {
    const user = await db.users.findById(id);
    if (!user) throw new Error('User not found');
    return user;
  })
  .registerHandler('CREATE_USER', async (data: CreateUserDto) => {
    return await db.users.create(data);
  });

await server.start();
```

**Client:**

```typescript
import { RpcClient } from 'hermes-mq';
import { ConnectionManager } from 'hermes-mq';

const connection = new ConnectionManager({ url: 'amqp://localhost' });

const client = new RpcClient({
  connection,
  queueName: 'users',
  timeout: 5000,
});

const user = await client.send<{ id: string }, User>('GET_USER', { id: '123' });

console.log(user);
```

### Pub/Sub Pattern (Events)

**Publisher:**

```typescript
import { Publisher } from 'hermes-mq';
import { ConnectionManager } from 'hermes-mq';

const connection = new ConnectionManager({ url: 'amqp://localhost' });

const publisher = new Publisher({
  connection,
  exchange: 'events',
});

await publisher.publish('user.created', {
  userId: '123',
  email: 'test@example.com',
});
```

**Subscriber:**

```typescript
import { Subscriber } from 'hermes-mq';
import { ConnectionManager } from 'hermes-mq';

const connection = new ConnectionManager({ url: 'amqp://localhost' });

const subscriber = new Subscriber({
  connection,
  exchange: 'events',
  queueName: 'email_service',
});

subscriber
  .on('user.created', async (data) => {
    await sendWelcomeEmail(data.email);
  })
  .on('user.*', async (data, { eventName }) => {
    console.log('User event:', eventName, data);
  });

await subscriber.start();
```

### Connection Sharing (Best Practice)

For optimal resource usage, share a single `ConnectionManager` instance across multiple clients and servers:

```typescript
import { ConnectionManager, RpcServer, RpcClient, Publisher, Subscriber } from 'hermes-mq';

// Create one connection manager
const connection = new ConnectionManager({
  url: 'amqp://localhost',
  reconnect: true,
  heartbeat: 60,
});

// Share it across all components
const server = new RpcServer({ connection, queueName: 'api' });
const client = new RpcClient({ connection, queueName: 'api' });
const publisher = new Publisher({ connection, exchange: 'events' });
const subscriber = new Subscriber({ connection, exchange: 'events' });

// Start all components
await Promise.all([server.start(), subscriber.start()]);

// All components share the same underlying RabbitMQ connection
// This reduces resource usage and improves performance

// Cleanup: close components first, then connection
await client.close();
await server.stop();
await publisher.close();
await subscriber.stop();
await connection.close(); // Close shared connection last
```

**Benefits:**

- Reduced TCP connections to RabbitMQ (one instead of many)
- Lower memory footprint
- Easier connection management and monitoring
- Consistent reconnection behavior across all components

## 🛡️ Production Reliability Features

Hermes MQ includes comprehensive reliability features designed for production environments:

### 1. ACK/NACK Strategy with Retries

Configure automatic message retry behavior with exponential backoff:

```typescript
const server = new RpcServer({
  connection,
  queueName: 'critical-service',
  ackStrategy: {
    mode: 'auto', // 'auto' | 'manual'
    maxRetries: 3,
    requeue: (error, attempts) => attempts < 3 && !error.fatal,
    retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt), 30000),
  },
});
```

### 2. Dead Letter Queue (DLQ) Configuration

Automatically route failed messages to a DLQ for analysis and reprocessing:

```typescript
const queueOptions = {
  dlq: {
    enabled: true,
    exchange: 'dlx', // Dead letter exchange
    routingKey: 'failed.messages',
    ttl: 86400000, // 24 hours
    maxLength: 10000,
    processHandler: async (msg) => {
      // Handle failed messages
      logger.error('Processing DLQ message', msg);
    },
  },
};

await connectionManager.assertQueue('myqueue', queueOptions);
```

### 3. Poison Message Protection

Automatically handle malformed messages without crashing:

```typescript
const server = new RpcServer({
  connection,
  queueName: 'users',
  messageValidation: {
    maxSize: 1048576, // 1MB
    malformedMessageStrategy: 'dlq', // 'reject' | 'dlq' | 'ignore'
  },
});
```

### 4. Duplicate Detection

Prevent reprocessing of duplicate messages using LRU cache.

> **⚠️ Important:** Deduplication is **disabled by default** to minimize overhead. Enable it only if your handlers are **not idempotent**.

**Example configuration:**

```typescript
const server = new RpcServer({
  connection,
  queueName: 'payments',
  deduplication: {
    enabled: true, // Enable for non-idempotent operations
    cacheTTL: 300000, // 5 minutes
    cacheSize: 10000,
  },
});
```

**Trade-offs:**

- **Memory cost:** Each message ID is cached for the TTL duration
- **CPU cost:** Cache lookup on every message
- **False negatives:** Messages arriving after cache expiry will be reprocessed

If your operations are naturally idempotent, keep deduplication disabled for better performance.

### 5. Error Isolation in Pub/Sub

Prevent single failed handler from affecting other handlers:

```typescript
const subscriber = new Subscriber({
  connection,
  exchange: 'events',
  handlerTimeout: 30000, // 30 seconds
  errorHandling: {
    isolateErrors: true, // Continue on handler error
    continueOnError: true,
    errorHandler: (error, context) => {
      logger.error('Handler failed', { event: context.eventName, error });
    },
  },
});
```

### 6. Graceful Shutdown

Properly clean up resources and wait for in-flight messages:

```typescript
const server = new RpcServer({
  connection,
  queueName: 'myqueue',
});

await server.start();

// Later...
await server.stop({
  timeout: 30000, // Wait up to 30 seconds for in-flight messages
  force: false, // Throw if timeout exceeded
});
```

### Production Configuration Example

```typescript
const rpcServer = new RpcServer({
  connection: {
    url: process.env.AMQP_URL || 'amqp://localhost',
    heartbeat: 30,
    reconnect: true,
    maxReconnectAttempts: 10,
  },
  queueName: 'critical-service',

  // Reliability settings
  ackStrategy: {
    mode: 'auto',
    maxRetries: 3,
    requeue: (error, attempts) => attempts < 3 && !error.fatal,
    retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt), 30000),
  },

  messageValidation: {
    maxSize: 1048576, // 1MB
    malformedMessageStrategy: 'dlq',
  },

  deduplication: {
    enabled: true,
    cacheTTL: 300000,
    cacheSize: 10000,
  },

  prefetch: 1, // Process one message at a time
  handlerTimeout: 30000,
});
```

### 7. Publisher Confirms (v1.0+)

Ensure messages are safely persisted before considering them sent:

```typescript
const publisher = new Publisher({
  connection,
  exchange: 'events',
  publisherConfirms: true, // default: true
  confirmMode: 'sync', // 'sync' | 'async'
  retry: {
    enabled: true,
    maxAttempts: 3,
    initialDelay: 1000,
  },
});
```

### 8. Persistent Messages with Auto Metadata (v1.0+)

Messages include unique IDs and timestamps automatically:

```typescript
// All published messages automatically include:
// - messageId: unique UUID
// - timestamp: milliseconds since epoch
// - persistent: true by default

await publisher.publish('user.created', userData);
```

### 9. Memory Leak Prevention (v1.0+)

RPC clients automatically cleanup expired callbacks:

```typescript
const client = new RpcClient({
  connection,
  queueName: 'service',
  timeout: 30000, // Callbacks > 2x timeout are auto-cleaned every 30s
});
```

### 10. Consumer Cancellation Recovery (v1.0+)

Automatic re-registration when RabbitMQ cancels consumers (during maintenance, queue deletion, etc.):

```typescript
// Both RpcServer and Subscriber automatically:
// - Detect consumer cancellation (null message)
// - Re-register consumer with exponential backoff (5s, 10s, 20s, 40s, 60s max)
// - Retry up to 5 times before giving up
// - Log all reconnection attempts

const server = new RpcServer({
  connection,
  queueName: 'service',
  // No configuration needed - recovery is automatic
});
```

This ensures your services automatically recover from temporary RabbitMQ maintenance or configuration changes without manual intervention.

### 11. Mandatory Flag & Return Handling (v1.0+)

Handle unroutable messages gracefully:

```typescript
const publisher = new Publisher({
  connection,
  exchange: 'events',
  mandatory: true,
  onReturn: (msg) => {
    logger.error('Unroutable message', {
      exchange: msg.exchange,
      routingKey: msg.routingKey,
    });
  },
});
```

### 12. Flow Control & Backpressure (v1.0+)

Automatic channel backpressure handling:

```typescript
// Publisher automatically:
// - Detects when channel.publish() returns false
// - Waits for 'drain' event before continuing
// - Buffers pending writes internally
```

### 13. Queue Limits & TTL (v1.0+)

Configure message expiration and queue size:

```typescript
await connectionManager.assertQueue('my-queue', {
  durable: true,
  messageTtl: 3600000, // 1 hour
  maxLength: 10000,
  overflow: 'reject-publish', // or 'drop-head', 'reject-publish-dlx'
});
```

### 14. Enhanced Connection Recovery (v1.0+)

Exponential backoff with heartbeat monitoring:

```typescript
const config = {
  url: 'amqp://localhost',
  reconnect: true,
  reconnectInterval: 5000,
  maxReconnectAttempts: 10,
  heartbeat: 60, // Recommended: 30-60s (warning if 0)
};
// Delay: min(base * 2^attempt, 60s) = 5s, 10s, 20s, 40s, 60s...
```

### 15. Slow Message Detection

Monitor and detect slow message processing with multi-level thresholds:

**RPC Server:**

```typescript
import { RpcServer } from 'hermes-mq';
import { ConnectionManager } from 'hermes-mq';

const connection = new ConnectionManager({ url: 'amqp://localhost' });

const server = new RpcServer({
  connection,
  queueName: 'users',
  slowMessageDetection: {
    slowThresholds: {
      warn: 1000, // Log warning if handler takes > 1 second
      error: 5000, // Log error if handler takes > 5 seconds
    },
    onSlowMessage: (context) => {
      // Custom handler for slow messages
      logger[context.level](`Slow handler detected`, {
        command: context.command,
        duration: context.duration,
        threshold: context.threshold,
        messageId: context.messageId,
      });

      // Send to monitoring system
      metrics.histogram('handler.duration', context.duration, {
        command: context.command,
        level: context.level,
      });
    },
  },
});
```

**Pub/Sub Subscriber:**

```typescript
import { Subscriber } from 'hermes-mq';
import { ConnectionManager } from 'hermes-mq';

const connection = new ConnectionManager({ url: 'amqp://localhost' });

const subscriber = new Subscriber({
  connection,
  exchange: 'events',
  slowMessageDetection: {
    slowThresholds: {
      warn: 1000,
      error: 5000,
    },
    onSlowMessage: (context) => {
      logger.warn(`Slow event handler: ${context.eventName} took ${context.duration}ms`);
    },
  },
});
```

**Use Cases:**

- Performance monitoring and bottleneck detection
- SLA enforcement and alerting
- Identifying problematic handlers that need optimization
- Tracking handler duration metrics over time

The slow message detection automatically measures handler execution time and triggers callbacks when thresholds are exceeded. Both `warn` and `error` thresholds are optional - use what fits your monitoring needs.

### 16. Health Checks

Built-in health check API for Kubernetes liveness/readiness probes and monitoring:

```typescript
import { HealthChecker } from 'hermes-mq';

const health = new HealthChecker({
  connection,
});

// Optionally register servers/subscribers for consumer tracking
health.registerServer(rpcServer);
health.registerServer(subscriber);

// Perform health check
const result = await health.check();
console.log(result);
/*
{
  status: 'healthy',  // 'healthy' | 'degraded' | 'unhealthy'
  timestamp: 2025-01-15T19:48:56.000Z,
  checks: {
    connection: {
      status: 'up',
      connectedAt: 2025-01-15T19:48:50.000Z,
      url: 'amqp://localhost'
    },
    channel: {
      status: 'open',
      count: 2
    },
    consumers: {
      count: 2,
      active: 2
    }
  },
  uptime: 125000,
  errors: undefined
}
*/

// Simple boolean check
const isHealthy = await health.isHealthy(); // true
```

**Express Integration:**

```typescript
import express from 'express';

const app = express();

app.get('/health', async (req, res) => {
  const result = await health.check();
  res.status(result.status === 'healthy' ? 200 : 503).json(result);
});

app.get('/readiness', async (req, res) => {
  const isReady = await health.isHealthy();
  res.sendStatus(isReady ? 200 : 503);
});
```

**Kubernetes:**

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 30

readinessProbe:
  httpGet:
    path: /readiness
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
```

**Health Status:**

- `healthy`: Connection UP + at least 1 channel open
- `degraded`: Connection UP but no channels (warning state)
- `unhealthy`: Connection DOWN

### 17. Prometheus Metrics

Zero-dependency metrics export in Prometheus text format with automatic global collection:

```typescript
import { MetricsCollector, RpcServer, RpcClient, Publisher, Subscriber } from 'hermes-mq';

// Get the global metrics instance (singleton)
const metrics = MetricsCollector.global();

// Simply enable metrics on your components
const server = new RpcServer({
  connection,
  queueName: 'users',
  enableMetrics: true, // Metrics automatically collected globally
});

const client = new RpcClient({
  connection,
  queueName: 'users',
  enableMetrics: true, // Metrics automatically collected globally
});

const publisher = new Publisher({
  connection,
  exchange: 'events',
  enableMetrics: true, // Metrics automatically collected globally
});

const subscriber = new Subscriber({
  connection,
  exchange: 'events',
  enableMetrics: true, // Metrics automatically collected globally
});

// All metrics from all components are automatically aggregated in the global instance
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send(metrics.toPrometheus());
});
```

**How it works:**

- Set `enableMetrics: true` on any component to enable automatic metrics collection
- All metrics are automatically collected in a global singleton `MetricsCollector` instance
- Metrics from all components (RpcClient, RpcServer, Publisher, Subscriber) are aggregated together
- No need to manually pass metrics instances around - just enable and go!
- You can still create custom `MetricsCollector` instances if needed for specific use cases

**Available Metrics:**

```
# RPC Client metrics
hermes_rpc_requests_total{queue="users",status="success|timeout|error|decode_error"}
hermes_rpc_request_duration_seconds{queue="users",status="success|error"}

# RPC Server metrics
hermes_messages_consumed_total{queue="users",command="GET_USER",status="ack|error"}
hermes_message_processing_duration_seconds{queue="users",command="GET_USER"}

# Publisher metrics
hermes_messages_published_total{exchange="events",eventName="user.created",status="success|error"}

# Subscriber metrics
hermes_messages_consumed_total{exchange="events",eventName="user.created",status="ack|partial_error"}
hermes_message_processing_duration_seconds{exchange="events",eventName="user.created"}
```

**Custom Metrics:**

```typescript
// Counter
metrics.incrementCounter(
  'messages_published_total',
  {
    queue: 'users',
    status: 'success',
  },
  1
);

// Gauge
metrics.setGauge('connection_state', { state: 'connected' }, 1);
metrics.incrementGauge('channel_count', {}, 1);
metrics.decrementGauge('channel_count', {}, 1);

// Histogram (for latencies, durations, etc.)
metrics.observeHistogram(
  'message_duration_seconds',
  {
    queue: 'users',
  },
  0.125
);

// Custom help text
metrics.setHelp('messages_published_total', 'Total number of published messages');

// Reset all metrics
metrics.reset();
```

**Prometheus Configuration:**

```yaml
scrape_configs:
  - job_name: 'hermes-mq'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
    scrape_interval: 15s
```

**Example Output:**

```
# HELP hermes_rpc_requests_total Total count
# TYPE hermes_rpc_requests_total counter
hermes_rpc_requests_total{queue="users",status="success"} 1523
hermes_rpc_requests_total{queue="users",status="timeout"} 12

# HELP hermes_rpc_request_duration_seconds Histogram of values
# TYPE hermes_rpc_request_duration_seconds histogram
hermes_rpc_request_duration_seconds_bucket{queue="users",status="success",le="0.005"} 234
hermes_rpc_request_duration_seconds_bucket{queue="users",status="success",le="0.01"} 856
hermes_rpc_request_duration_seconds_bucket{queue="users",status="success",le="+Inf"} 1523
hermes_rpc_request_duration_seconds_sum{queue="users",status="success"} 45.23
hermes_rpc_request_duration_seconds_count{queue="users",status="success"} 1523
```

**Features:**

- ✅ Zero external dependencies
- ✅ Prometheus text format compatible
- ✅ Automatic metrics for RPC Client/Server and Publisher/Subscriber
- ✅ Counter, Gauge, and Histogram support
- ✅ Label support for multi-dimensional metrics
- ✅ Custom histogram buckets
- ✅ Memory efficient

## 🏗️ Development

### Setup

```bash
# Clone repository
git clone https://github.com/nogards95TG/hermes-mq.git
cd hermes-mq

# Install dependencies
pnpm install

# Start RabbitMQ
docker-compose up -d

# Build package
pnpm build

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch
```

### Project Structure

```
hermes-mq/
├── src/
│   ├── core/          # Connection management and utilities
│   ├── client/        # RPC client and Publisher
│   ├── server/        # RPC server and Subscriber
│   └── index.ts       # Main exports
├── __tests__/         # Unit and integration tests
├── dist/              # Built files (ESM + CJS + types)
└── docker-compose.yml # RabbitMQ setup
```

## 🧪 Testing

Hermes MQ is thoroughly tested with 189 tests (164 unit + 25 integration).

### Running Tests

```bash
# Run all tests
pnpm test

# Run unit tests only
pnpm test:unit

# Run integration tests (requires RabbitMQ)
pnpm test:integration

# Generate coverage report
pnpm test:coverage
```

Integration tests use [Testcontainers](https://testcontainers.com/) to spin up real RabbitMQ instances.

## 📚 Documentation

- [Contributing Guide](./CONTRIBUTING.md) - How to contribute
- [API Documentation](./src) - TypeScript source with JSDoc comments

## 🔄 Continuous Integration

All pull requests and commits are automatically tested with:

- ✅ Linting (ESLint)
- ✅ Type checking (TypeScript)
- ✅ Unit tests on Node.js 18, 20, and 22
- ✅ Integration tests with RabbitMQ (Testcontainers)
- ✅ Code coverage tracking

See [`.github/workflows/test.yml`](./.github/workflows/test.yml) for details.

---

## 🗺️ Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features and future enhancements, these are **optional features** for specific use cases.

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](./CONTRIBUTING.md) for details.

Before submitting a PR, run the pre-push checks locally:

```bash
pnpm pre-push
```

This ensures all CI checks will pass.

## 📄 License

MIT © 2025 [nogards95TG](https://github.com/nogards95TG)

## 🙏 Acknowledgments

- Built with [amqplib](https://github.com/amqp-node/amqplib)
- Inspired by modern message queue clients
- Special thanks to the RabbitMQ community

---

Made with ❤️ by nogards95TG
