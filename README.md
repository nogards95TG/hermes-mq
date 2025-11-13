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

## 📦 Packages

This monorepo contains the following packages:

- **[@hermes/core](./packages/core)**: Connection management, retry logic, types
- **@hermes/client**: RPC client, Publisher (includes testing mocks)
- **@hermes/server**: RPC server, Subscriber, command routing

## 🚀 Quick Start

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
# Using pnpm (recommended)
pnpm add @hermes/core @hermes/client @hermes/server

# Using npm
npm install @hermes/core @hermes/client @hermes/server

# Using yarn
yarn add @hermes/core @hermes/client @hermes/server
```

## 📖 Usage Examples

### RPC Pattern (Request/Response)

**Server:**

```typescript
import { RpcServer } from '@hermes/server';

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
import { RpcClient } from '@hermes/client';

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
import { Publisher } from '@hermes/client';

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
import { Subscriber } from '@hermes/client';

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

# Build all packages
pnpm build

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run linter
pnpm lint
```

### Project Structure

```
hermes-mq/
├── examples/          # Usage examples
├── packages/
│   ├── core/          # Core connection and utilities
│   ├── client/        # RPC client and Pub/Sub
│   ├── server/        # RPC server
│   └── hermes-mq/     # Single export package
└── docker-compose.yml # RabbitMQ setup
```

## 🧪 Testing

Hermes MQ provides comprehensive testing utilities to help you test your messaging code.

### Using Mock Implementations

```typescript
import { MockRpcClient, MockPublisher } from '@hermes/client';

// Mock RPC responses
const mockClient = new MockRpcClient();
mockClient.mockResponse('GET_USER', { id: 123, name: 'John' });
const user = await mockClient.send('GET_USER', { id: 123 });

// Mock event publishing
const mockPublisher = new MockPublisher();
await mockPublisher.publish('user.created', { id: 123 });
const events = mockPublisher.getPublishedEvents();
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run unit tests
pnpm test:unit

# Run integration tests (requires RabbitMQ)
pnpm test:integration

# Generate coverage report
pnpm test:coverage
```

## 📚 Documentation

- [Examples](./examples) - Working code examples
- [Contributing Guide](./CONTRIBUTING.md) - How to contribute

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
