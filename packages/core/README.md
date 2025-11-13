# @hermes/core

Core connection management and utilities for Hermes RabbitMQ client.

## Features

- 🔌 **Connection Management**: Singleton pattern with automatic reconnection
- 🏊 **Channel Pooling**: Efficient channel reuse with health checks
- 🔄 **Retry Logic**: Exponential backoff for transient failures
- 📝 **Flexible Logging**: Pluggable logger interface
- 🛡️ **Type Safety**: Full TypeScript support with strict mode

## Installation

```bash
pnpm add @hermes/core
```

## Usage

### Connection Manager

```typescript
import { ConnectionManager } from '@hermes/core';

const manager = ConnectionManager.getInstance({
  url: 'amqp://localhost',
  reconnect: true,
  reconnectInterval: 5000,
  maxReconnectAttempts: 10,
});

// Get connection
const connection = await manager.getConnection();

// Listen to events
manager.on('connected', () => console.log('Connected'));
manager.on('disconnected', () => console.log('Disconnected'));
manager.on('reconnecting', (data) => console.log('Reconnecting...', data));
manager.on('error', (error) => console.error('Error:', error));

// Close connection
await manager.close();
```

### Channel Pool

```typescript
import { ChannelPool } from '@hermes/core';

const pool = new ChannelPool(connection, {
  min: 1,
  max: 10,
  acquireTimeout: 5000,
});

// Acquire channel
const channel = await pool.acquire();

try {
  // Use channel
  await channel.assertQueue('myqueue');
} finally {
  // Always release channel back to pool
  pool.release(channel);
}

// Drain pool
await pool.drain();
```

### Retry Policy

```typescript
import { RetryPolicy } from '@hermes/core';

const policy = new RetryPolicy({
  enabled: true,
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  retryableErrors: [/ECONNREFUSED/, /ETIMEDOUT/],
});

// Execute with retry
const result = await policy.execute(
  async () => {
    // Your operation
    return await someOperation();
  },
  'operation-name'
);
```

### Custom Logger

```typescript
import { Logger, ConsoleLogger } from '@hermes/core';

// Use console logger
const logger = new ConsoleLogger('debug');

// Or implement custom logger
class MyLogger implements Logger {
  debug(message: string, context?: Record<string, any>): void {
    // Your implementation
  }
  info(message: string, context?: Record<string, any>): void {
    // Your implementation
  }
  warn(message: string, context?: Record<string, any>): void {
    // Your implementation
  }
  error(message: string, error?: Error, context?: Record<string, any>): void {
    // Your implementation
  }
}
```

## API Reference

See [API Documentation](../../docs/api-reference.md) for detailed API reference.

## License

MIT
