# Hermes MQ

Modern, type-safe RabbitMQ client library for Node.js with built-in support for RPC (request/response) and Pub/Sub (event-driven) messaging patterns.

## Features

- 🚀 **RPC Pattern** - Request/response with timeout and retry support
- 📢 **Pub/Sub Pattern** - Event publishing and subscribing with pattern matching
- 🔄 **Auto-reconnection** - Automatic reconnection with exponential backoff
- 🏊 **Connection Pooling** - Efficient channel reuse with health checks
- 📦 **Type-safe** - Full TypeScript support with generics
- 🎯 **Zero config** - Sensible defaults, highly configurable
- 🛡️ **Error handling** - Automatic error serialization and retry logic
- 🚦 **Graceful shutdown** - Drain in-flight messages before closing

## Installation

```bash
npm install hermes-mq
# or
pnpm add hermes-mq
# or
yarn add hermes-mq
```

## Quick Start

### RPC (Request/Response)

**Server:**

```typescript
import { RpcServer } from 'hermes-mq';

const server = new RpcServer({
  connection: { url: 'amqp://localhost' },
  queueName: 'users',
  prefetch: 10,
});

// Register command handlers
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
console.log('RPC Server started');

// Graceful shutdown
process.on('SIGTERM', async () => {
  await server.stop({ timeout: 30000 });
  process.exit(0);
});
```

**Client:**

```typescript
import { RpcClient } from 'hermes-mq';

const client = new RpcClient({
  connection: { url: 'amqp://localhost' },
  queueName: 'users',
  timeout: 5000,
});

// Send command and wait for response
const user = await client.send<{ id: string }, User>('GET_USER', { id: '123' });

console.log(user);
await client.close();
```

### Pub/Sub (Event-Driven)

**Publisher:**

```typescript
import { Publisher } from 'hermes-mq';

const publisher = new Publisher({
  connection: { url: 'amqp://localhost' },
  exchange: 'events',
});

// Publish event
await publisher.publish('user.created', {
  userId: '123',
  email: 'test@example.com',
});

// Publish to multiple exchanges
await publisher.publishToMany(['app_events', 'audit_events'], 'user.deleted', { userId: '123' });

await publisher.close();
```

**Subscriber:**

```typescript
import { Subscriber } from 'hermes-mq';

const subscriber = new Subscriber({
  connection: { url: 'amqp://localhost' },
  exchange: 'events',
  queueName: 'email_service',
  prefetch: 5,
});

// Subscribe to events with wildcards
subscriber
  .on('user.created', async (data) => {
    await sendWelcomeEmail(data.email);
  })
  .on('user.*', async (data, { eventName }) => {
    console.log('User event:', eventName, data);
  })
  .on('order.#', async (data, { eventName }) => {
    // Matches order.created, order.shipped.express, etc.
    console.log('Order event:', eventName, data);
  });

await subscriber.start();

// Stop subscriber
process.on('SIGTERM', async () => {
  await subscriber.stop();
  process.exit(0);
});
```

## Advanced Usage

### Custom Logger

```typescript
import { RpcClient, Logger } from 'hermes-mq';
import winston from 'winston';

class WinstonAdapter implements Logger {
  constructor(private winston: winston.Logger) {}

  debug(message: string, context?: any) {
    this.winston.debug(message, context);
  }
  info(message: string, context?: any) {
    this.winston.info(message, context);
  }
  warn(message: string, context?: any) {
    this.winston.warn(message, context);
  }
  error(message: string, error?: Error, context?: any) {
    this.winston.error(message, { error, ...context });
  }
}

const logger = new WinstonAdapter(
  winston.createLogger({
    level: 'info',
    format: winston.format.json(),
  })
);

const client = new RpcClient({
  connection: { url: 'amqp://localhost', logger },
  queueName: 'users',
  logger,
});
```

### Retry Configuration

```typescript
import { RpcClient } from 'hermes-mq';

const client = new RpcClient({
  connection: { url: 'amqp://localhost' },
  queueName: 'external_api',
  retry: {
    enabled: true,
    maxAttempts: 5,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    retryableErrors: [/ECONNREFUSED/, /ETIMEDOUT/, /503/],
  },
});
```

### Multiple Exchanges

```typescript
import { Publisher } from 'hermes-mq';

const publisher = new Publisher({
  connection: { url: 'amqp://localhost' },
  exchanges: [
    { name: 'app_events', type: 'topic' },
    { name: 'audit_events', type: 'fanout' },
    { name: 'notifications', type: 'topic' },
  ],
  defaultExchange: 'app_events',
});

// Publish to default exchange
await publisher.publish('user.created', { id: '123' });

// Publish to specific exchange
await publisher.publish(
  'user.login',
  { userId: '123', ip: '1.2.3.4' },
  { exchange: 'audit_events' }
);
```

### Connection Management

```typescript
import { ConnectionManager } from 'hermes-mq';

const manager = ConnectionManager.getInstance({
  url: 'amqp://localhost',
  reconnect: true,
  reconnectInterval: 5000,
  maxReconnectAttempts: 10,
  heartbeat: 60,
});

// Listen to connection events
manager.on('connected', () => console.log('Connected'));
manager.on('disconnected', () => console.log('Disconnected'));
manager.on('reconnecting', (data) => console.log('Reconnecting...', data));
manager.on('error', (error) => console.error('Error:', error));

const connection = await manager.getConnection();
```

## API Reference

### RPC

#### `RpcClient`

- `send<TRequest, TResponse>(command, data, options?)` - Send RPC request
- `isReady()` - Check if client is ready
- `close()` - Close client connection

#### `RpcServer`

- `registerHandler(commandName, handler)` - Register single command handler
- `start()` - Start server
- `stop(options?)` - Stop server gracefully
- `isRunning()` - Check if server is running
- `getStats()` - Get server statistics

### Pub/Sub

#### `Publisher`

- `publish(eventName, data, options?)` - Publish event
- `publishToMany(exchanges, eventName, data, options?)` - Publish to multiple exchanges
- `close()` - Close publisher

#### `Subscriber`

- `on(eventPattern, handler)` - Register event handler
- `start()` - Start consuming
- `stop()` - Stop consuming
- `isRunning()` - Check if subscriber is running

### Core

#### `ConnectionManager`

- `getInstance(config)` - Get singleton instance
- `getConnection()` - Get connection
- `isConnected()` - Check connection status
- `close()` - Close connection
- `on(event, handler)` - Listen to events

#### `RetryPolicy`

- `execute(fn, context?)` - Execute function with retry
- `shouldRetry(error, attempt)` - Check if should retry
- `getDelay(attempt)` - Get delay for attempt

## Pattern Matching

Subscribers support RabbitMQ routing key patterns:

- `*` matches exactly one word: `user.*` → `user.created`, `user.updated`
- `#` matches zero or more words: `order.#` → `order.created`, `order.shipped.express`

## Error Handling

All errors are properly typed and serialized:

```typescript
import { HermesError, TimeoutError, ConnectionError } from 'hermes-mq';

try {
  const result = await client.send('COMMAND', data);
} catch (error) {
  if (error instanceof TimeoutError) {
    console.log('Request timed out');
  } else if (error instanceof ConnectionError) {
    console.log('Connection failed');
  } else if (error instanceof HermesError) {
    console.log('Hermes error:', error.code, error.details);
  }
}
```

## TypeScript Support

Full TypeScript support with generics:

```typescript
interface User {
  id: string;
  email: string;
  name: string;
}

interface GetUserRequest {
  id: string;
}

// Fully typed request/response
const user = await client.send<GetUserRequest, User>('GET_USER', { id: '123' });
// user is typed as User

// Typed command handler
server.registerHandler<GetUserRequest, User>('GET_USER', async (data) => {
  // data is typed as GetUserRequest
  // return type must be User
  return await db.users.findById(data.id);
});
```

## Examples

Check the [examples](https://github.com/nogards95TG/hermes-mq/tree/main/examples) folder for complete working examples:

- Basic RPC
- Error handling
- Pub/Sub with wildcards
- Multiple exchanges
- Custom logger integration
- Graceful shutdown

## Requirements

- Node.js >= 18.0.0
- RabbitMQ >= 3.8.0

## License

MIT

## Contributing

Contributions are welcome! Please read the [contributing guide](https://github.com/nogards95TG/hermes-mq/blob/main/CONTRIBUTING.md).

## Support

- 📖 [Documentation](https://github.com/nogards95TG/hermes-mq)
- 🐛 [Issue Tracker](https://github.com/nogards95TG/hermes-mq/issues)
- 💬 [Discussions](https://github.com/nogards95TG/hermes-mq/discussions)
