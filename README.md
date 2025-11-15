# Hermes MQ 🚀

[![Test](https://github.com/nogards95TG/hermes-mq/workflows/Test/badge.svg)](https://github.com/nogards95TG/hermes-mq/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org)

Modern, type-safe RabbitMQ client library for Node.js with intuitive APIs for RPC and Pub/Sub patterns.

## ✨ Features

- 🎯 **Type-Safe**: Full TypeScript support with generics
- 🔌 **Connection Pooling**: Automatic channel reuse and health checks
- 🔄 **Auto Reconnection**: Exponential backoff retry logic
- 🎭 **Dual Patterns**: Both RPC (request/response) and Pub/Sub (events)
- 📝 **Flexible Logging**: Pluggable logger interface (Winston, Pino, etc.)
- 🧪 **Testable**: Mock implementations and Testcontainers support
- 🚀 **Production Ready**: Graceful shutdown, error handling, monitoring
- 📦 **Zero Dependencies**: Only depends on `amqplib`

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
  prefetch: 10,
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

Prevent reprocessing of duplicate messages using LRU cache:

```typescript
const server = new RpcServer({
  connection: { url: 'amqp://localhost' },
  queueName: 'payments',
  deduplication: {
    enabled: true,
    cacheTTL: 300000, // 5 minutes
    cacheSize: 10000,
    keyExtractor: (msg) => msg.transactionId,
  },
});
```

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
