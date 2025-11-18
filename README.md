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

## 🔧 Middleware System

Hermes MQ includes an Express/Koa-like middleware system for request/response processing.

### Server-Side Middleware

**Global Middleware** - Applied to all handlers:

```typescript
import { RpcServer } from 'hermes-mq';

const server = new RpcServer({
  connection: { url: 'amqp://localhost' },
  queueName: 'api',
});

// Register global middleware (must be before any handlers)
server.use(async (ctx, next) => {
  console.log(`[${ctx.command}] Request received`);
  await next();
  console.log(`[${ctx.command}] Response sent`);
});

// Global middlewares are applied to all handlers
server.registerHandler('GET_USER', async (userId: string) => {
  return await db.users.findById(userId);
});
```

**Handler-Specific Middleware** - Applied only to specific handlers:

```typescript
import { validate, retry } from 'hermes-mq';
import { z } from 'zod';

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive(),
});

server.registerHandler(
  'CREATE_USER',
  validate(createUserSchema),  // Built-in validation middleware
  retry({                        // Built-in retry middleware
    maxAttempts: 3,
    backoffStrategy: 'exponential',
    backoffDelay: 1000
  }),
  async (payload) => {           // Handler receives validated payload
    return await db.users.create(payload);
  }
);
```

### Built-in Middleware

#### 1. Validate Middleware

Validates incoming payloads with support for Zod, Yup, Ajv, and custom adapters:

```typescript
import { validate } from 'hermes-mq';

// Auto-detect Zod schema
const zodSchema = z.object({ id: z.number() });
server.registerHandler('GET', validate(zodSchema), handler);

// Auto-detect Yup schema
const yupSchema = yup.object({ id: yup.number().required() });
server.registerHandler('GET', validate(yupSchema), handler);

// Custom adapter
import { validateAdapter } from 'hermes-mq';

const customAdapter = validateAdapter('joi', (payload) => {
  const { error, value } = joiSchema.validate(payload);
  if (error) return { success: false, errors: error.details };
  return { success: true, value };
});

server.registerHandler('GET', validate(customAdapter), handler);
```

On validation failure, middleware returns:
```typescript
{
  error: 'ValidationError',
  details: [...] // validation error details
}
```

#### 2. Retry Middleware

Override per-command retry policy:

```typescript
import { retry } from 'hermes-mq';

server.registerHandler(
  'CRITICAL_OPERATION',
  retry({
    maxAttempts: 5,
    backoffStrategy: 'exponential', // 'fixed' | 'exponential' | custom function
    backoffDelay: 1000,
    requeueOnFail: true
  }),
  handler
);
```

### Custom Middleware

Create custom middleware following the middleware signature:

```typescript
import { Middleware, RpcContext } from 'hermes-mq';

const authMiddleware: Middleware = async (ctx: RpcContext, next) => {
  // Pre-processing
  const token = ctx.properties.headers?.authorization;
  if (!token) {
    return { error: 'Unauthorized' }; // Short-circuit with error
  }

  // Verify token and store user in context
  const user = await verifyToken(token);
  ctx.meta.user = user;

  // Call next middleware/handler
  const result = await next();

  // Post-processing
  console.log(`User ${user.id} executed ${ctx.command}`);
  return result;
};

server.use(authMiddleware);
server.registerHandler('DELETE_USER', async (payload, ctx) => {
  const userId = ctx.meta.user.id;
  return await db.users.delete(userId);
});
```

### Middleware Execution Order

```
Global MW 1 → Global MW 2 → Handler MW 1 → Handler MW 2 → Handler → Handler MW 2 response → Handler MW 1 response → Global MW 2 response → Global MW 1 response
```

### Important Notes

1. **Global middleware registration**: Call `server.use()` **before** `registerHandler()` for middlewares to apply to all handlers. After the first handler is registered, additional `use()` calls will be ignored (logged with warning).

2. **Handler signature**: New middleware system supports both:
   - New: `(payload, ctx: RpcContext) => any`
   - Old: `(payload, metadata?) => any` (backward compatible)

3. **Short-circuiting**: Returning a non-undefined value from middleware stops chain execution and sends that value as response.

4. **Error handling**: Throwing an error in middleware will be caught and sent to client as error response.

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

Automatic re-registration when server cancels consumers:

```typescript
// RpcServer and Subscriber automatically detect cancellation
// and re-register after 5 seconds with full logging
```

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
