# @hermes/client

RPC client and Pub/Sub publisher/subscriber for Hermes RabbitMQ client library.

## Installation

```bash
npm install @hermes/client @hermes/core
# or
pnpm add @hermes/client @hermes/core
# or
yarn add @hermes/client @hermes/core
```

## Features

- 🚀 **RPC Client** - Request/response pattern with timeout and retry support
- 📢 **Publisher** - Fire-and-forget event publishing to multiple exchanges
- 📥 **Subscriber** - Consume events with pattern matching (wildcards support)
- 🔄 **Auto-reconnection** - Automatic reconnection with exponential backoff
- 📦 **Type-safe** - Full TypeScript support with generics
- 🎯 **Zero config** - Sensible defaults, highly configurable

## Quick Start

### RPC Client

```typescript
import { RpcClient } from '@hermes/client';

const client = new RpcClient({
  connection: { url: 'amqp://localhost' },
  queueName: 'users',
  timeout: 5000,
});

// Send command and wait for response
const user = await client.send<{ id: string }, User>(
  'GET_USER',
  { id: '123' }
);

console.log(user);
await client.close();
```

### Publisher

```typescript
import { Publisher } from '@hermes/client';

const publisher = new Publisher({
  connection: { url: 'amqp://localhost' },
  exchange: 'events',
});

// Publish event
await publisher.publish('user.created', {
  userId: '123',
  email: 'test@example.com',
});

await publisher.close();
```

### Subscriber

```typescript
import { Subscriber } from '@hermes/client';

const subscriber = new Subscriber({
  connection: { url: 'amqp://localhost' },
  exchange: 'events',
  queueName: 'email_service',
});

// Subscribe to events with wildcards
subscriber
  .on('user.created', async (data) => {
    await sendWelcomeEmail(data.email);
  })
  .on('user.*', async (data, { eventName }) => {
    console.log('User event:', eventName, data);
  });

await subscriber.start();
```

## Documentation

For full documentation, visit [GitHub Repository](https://github.com/nogards95TG/hermes-mq).

## License

MIT
