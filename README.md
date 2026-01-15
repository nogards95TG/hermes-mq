# Hermes MQ 🚀

[![Test](https://github.com/nogards95TG/hermes-mq/workflows/Test/badge.svg)](https://github.com/nogards95TG/hermes-mq/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org)

Modern, type-safe RabbitMQ client library for Node.js with intuitive APIs for RPC and Pub/Sub patterns.

## ✨ Features

- 🎯 **Type-Safe**: Full TypeScript support with generics
- � **Contract-Based**: Define contracts once with automatic validation and type inference
- 🔌 **Connection Pooling**: Automatic channel reuse and health checks
- 🔄 **Auto Reconnection**: Exponential backoff retry logic with circuit breaker
- 🎭 **Dual Patterns**: Both RPC (request/response) and Pub/Sub (events)
- ✅ **Built-in Validators**: Most common validators with chainable API
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

const server = new RpcServer({
  connection: { url: 'amqp://localhost' },
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

const client = new RpcClient({
  connection: { url: 'amqp://localhost' },
  queueName: 'users',
  timeout: 5000,
});

const user = await client.send<{ id: string }, User>('GET_USER', { id: '123' });

console.log(user);
```

### Contract-Based RPC (Type-Safe with Validation)

Define contracts once, get full type safety and automatic validation on both client and server.

**Define Contract:**

```typescript
import { defineContract, v } from 'hermes-mq';

const usersContract = defineContract({
  serviceName: 'users',
  commands: {
    GET_USER: {
      req: v.object({
        id: v.string().uuid(),
      }),
      res: v.object({
        id: v.string().uuid(),
        name: v.string().min(2),
        email: v.string().email(),
        age: v.number().min(0).optional(),
      }),
    },
    CREATE_USER: {
      req: v.object({
        name: v.string().min(2).max(50),
        email: v.string().email(),
        age: v.number().min(0).max(150).optional(),
      }),
      res: v.object({
        id: v.string().uuid(),
        name: v.string(),
        email: v.string(),
      }),
    },
  },
});
```

**Server (with automatic validation):**

```typescript
import { createContractServer } from 'hermes-mq';

const server = createContractServer(usersContract, {
  connection: { url: 'amqp://localhost' },
});

// ✅ Full type inference and autocomplete
server.registerHandler('GET_USER', async (request) => {
  // request.id is typed as string (UUID validated)
  const user = await db.users.findById(request.id);

  // Return type is checked at compile time
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    age: user.age,
  };
});

server.registerHandler('CREATE_USER', async (request) => {
  // request is validated automatically before this handler runs
  // request.name: string (min 2, max 50)
  // request.email: string (email format)
  // request.age?: number (0-150)

  const user = await db.users.create(request);
  return { id: user.id, name: user.name, email: user.email };
});

await server.start();
```

**Client (with automatic validation):**

```typescript
import { createContractClient } from 'hermes-mq';

const client = createContractClient(usersContract, {
  connection: { url: 'amqp://localhost' },
});

// ✅ Full type safety and autocomplete
const user = await client.send('GET_USER', {
  id: '550e8400-e29b-41d4-a716-446655440000',
});
// user is typed: { id: string, name: string, email: string, age?: number }

const newUser = await client.send('CREATE_USER', {
  name: 'John Doe',
  email: 'john@example.com',
  age: 30,
});

// ❌ This would fail validation at runtime (and TypeScript compilation)
// await client.send('GET_USER', { id: 'not-a-uuid' });
// await client.send('CREATE_USER', { name: 'J', email: 'invalid' });
```

**Available Validators:**

```typescript
import { v } from 'hermes-mq';

// String validators
v.string(); // Required string
v.string().optional(); // Optional string
v.string().min(2).max(100); // Length constraints
v.string().email(); // Email format
v.string().uuid(); // UUID format
v.string().mongoId(); // MongoDB ObjectId format
v.string().pattern(/regex/); // Custom regex

// Number validators
v.number(); // Required number
v.number().optional(); // Optional number
v.number().min(0).max(100); // Range constraints
v.number().integer(); // Integer only
v.number().positive(); // > 0
v.number().negative(); // < 0

// Object validators
v.object(); // Any object (no field validation)
v.object({
  name: v.string(),
  age: v.number().optional(),
});
v.object().optional(); // Optional generic object

// Array validators
v.array(); // Any array (no item validation)
v.array(v.string()); // Array of strings
v.array(v.number()).min(1); // Array with size constraints
v.array().optional(); // Optional array (any type)
v.array(
  v.object({
    // Array of objects
    id: v.string(),
    name: v.string(),
  })
);

// Nested structures
v.object({
  user: v.object({
    profile: v.object({
      name: v.string(),
    }),
  }),
  tags: v.array(v.string()),
  metadata: v.array().optional(), // Flexible metadata
  context: v.object().optional(), // Flexible context
});
```

**Benefits:**

- ✅ **Type Safety**: Full TypeScript inference from contract to handlers
- ✅ **Automatic Validation**: Requests validated before reaching handlers
- ✅ **DRY Principle**: Define contract once, use everywhere
- ✅ **Developer Experience**: Autocomplete for command names and request/response types
- ✅ **Error Prevention**: Catch invalid data before processing
- ✅ **No Runtime Response Validation**: Avoids leaking internal errors to clients

### Pub/Sub Pattern (Events)

**Publisher:**

```typescript
import { Publisher } from 'hermes-mq';

const publisher = new Publisher({
  connection: { url: 'amqp://localhost' },
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

const subscriber = new Subscriber({
  connection: { url: 'amqp://localhost' },
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

## 🛡️ Production Reliability Features

Hermes MQ includes comprehensive reliability features designed for production environments:

### 1. ACK/NACK Strategy with Retries

Configure automatic message retry behavior with exponential backoff:

```typescript
const server = new RpcServer({
  connection: { url: 'amqp://localhost' },
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
  connection: { url: 'amqp://localhost' },
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
  connection: { url: 'amqp://localhost' },
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
  connection: { url: 'amqp://localhost' },
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
  connection: { url: 'amqp://localhost' },
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
  connection: { url: 'amqp://localhost' },
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
  connection: { url: 'amqp://localhost' },
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
  connection: { url: 'amqp://localhost' },
  queueName: 'service',
  // No configuration needed - recovery is automatic
});
```

This ensures your services automatically recover from temporary RabbitMQ maintenance or configuration changes without manual intervention.

### 11. Mandatory Flag & Return Handling (v1.0+)

Handle unroutable messages gracefully:

```typescript
const publisher = new Publisher({
  connection: { url: 'amqp://localhost' },
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

const server = new RpcServer({
  connection: { url: 'amqp://localhost' },
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

const subscriber = new Subscriber({
  connection: { url: 'amqp://localhost' },
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
