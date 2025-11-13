# @hermes/server

RPC server for Hermes RabbitMQ client library.

## Installation

```bash
npm install @hermes/server @hermes/core
# or
pnpm add @hermes/server @hermes/core
# or
yarn add @hermes/server @hermes/core
```

## Features

- 🎯 **RPC Server** - Handle commands with automatic routing
- 🔄 **Auto-reconnection** - Automatic reconnection with exponential backoff
- 🛡️ **Error handling** - Automatic error serialization and response
- 📦 **Type-safe** - Full TypeScript support with generics
- 🚦 **Graceful shutdown** - Drain in-flight messages before closing
- 📊 **Stats tracking** - Track processed messages and errors

## Quick Start

```typescript
import { RpcServer } from '@hermes/server';

const server = new RpcServer({
  connection: { url: 'amqp://localhost' },
  queueName: 'users',
  prefetch: 10,
});

// Register command handlers
server
  .command('GET_USER', async ({ id }: { id: string }) => {
    const user = await db.users.findById(id);
    if (!user) throw new Error('User not found');
    return user;
  })
  .command('CREATE_USER', async (data: CreateUserDto) => {
    return await db.users.create(data);
  });

// Start server
await server.start();
console.log('RPC Server started');

// Graceful shutdown
process.on('SIGTERM', async () => {
  await server.stop({ timeout: 30000 });
  process.exit(0);
});
```

## Command Registration

### Single Command

```typescript
server.command('ECHO', async (data) => {
  return { echo: data };
});
```

### Multiple Commands

```typescript
server.commands({
  GET_USER: async ({ id }) => {
    return await db.users.findById(id);
  },
  CREATE_USER: async (data) => {
    return await db.users.create(data);
  },
  DELETE_USER: async ({ id }) => {
    await db.users.delete(id);
    return { success: true };
  },
});
```

## Error Handling

Errors thrown in handlers are automatically caught and sent back to the client:

```typescript
server.command('GET_USER', async ({ id }: { id: string }) => {
  const user = await db.users.findById(id);
  if (!user) {
    // This error will be serialized and sent to the client
    throw new Error('User not found');
  }
  return user;
});
```

## Configuration Options

```typescript
interface RpcServerConfig {
  connection: ConnectionConfig;
  queueName: string;
  prefetch?: number; // Default: 10
  queueOptions?: AssertQueue;
  onUnhandledCommand?: (command: string) => void;
  retry?: RetryConfig;
  deadLetter?: {
    exchange: string;
    routingKey?: string;
  };
  includeStackTrace?: boolean; // Default: NODE_ENV !== 'production'
  logger?: Logger;
  serializer?: Serializer;
}
```

## Stats

Get server statistics:

```typescript
const stats = server.getStats();
console.log(stats);
// {
//   commandsRegistered: 5,
//   messagesProcessed: 1234,
//   messagesInFlight: 2,
//   errors: 10
// }
```

## Documentation

For full documentation, visit [GitHub Repository](https://github.com/nogards95TG/hermes-mq).

## License

MIT
