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

## 🧩 Middleware (Express-style)

Hermes MQ supports an Express-style middleware model for both Pub/Sub and RPC flows. Middlewares are small functions that run in an "onion" order (before/after) and can modify the message context, short-circuit the pipeline, or perform side effects like logging, metrics, or auth checks.

Key concepts:

- Global middleware: registered with `.use(...middlewares)` on `Publisher`, `RpcClient`, `Subscriber`, or `RpcServer`. They apply to all outgoing/incoming messages for that instance.
- Per-handler / per-request middleware: passed when registering a handler or sending a request. Examples:
  - `subscriber.on('event.name', mw1, mw2, handler)`
  - `server.registerHandler('METHOD', mw1, handler)`
  - `client.send('METHOD', payload, [mw1, mw2])`
- Middleware signature (TypeScript):

```ts
type Middleware<T = any> = (
  message: T,
  ctx: MessageContext,
  next: () => Promise<any>
) => Promise<any> | any;
```

- Handler (final function) signature for RPC server handlers remains backward-compatible: `(data, metadata) => Promise|any`. The library wraps legacy handlers so you can keep existing code.

Behavior notes and compatibility guarantees:

- `.use(...)` performs defensive validation and will throw a `ValidationError` if a non-function is passed. This is intentional to fail fast when middleware arguments are invalid.
- When no middleware is attached to a `Subscriber.on(...)` or `RpcServer.registerHandler(...)`, the original (legacy) handler is stored directly to preserve semantics and test spyability.
- Middleware order: global middlewares run first, then per-handler/per-request middlewares, then the final handler. Middlewares form an "onion" so you can run logic before and after the downstream call using `await next()`.

See the `examples/` folder for simple usage examples:

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
