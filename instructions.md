PRD: Hermes - Modern RabbitMQ Client for Node.js
Overview
Hermes is a modern, type-safe RabbitMQ client library for Node.js that provides intuitive APIs for RPC (request/response) and Pub/Sub (event-driven) messaging patterns. Built with TypeScript, it offers connection pooling, automatic reconnection, retry logic, and graceful shutdown out of the box.
Target Users: Backend developers building microservices, event-driven architectures, or distributed systems with RabbitMQ.
Version: 1.0.0
Repository: Monorepo with Turborepo

Goals

Replace deprecated amqp-ts with modern amqplib
Provide type-safe APIs with TypeScript generics
Implement connection pooling and channel reuse for performance
Support both RPC and Pub/Sub patterns with clean separation
Offer automatic retry logic with exponential backoff
Enable flexible multi-exchange configuration for events
Maintain zero dependencies beyond amqplib
Achieve 85%+ test coverage

Non-Goals

CRUD auto-mapping helpers (future enhancement)
Built-in metrics/observability (V1.1)
Circuit breaker pattern (V1.1)
Message buffering during reconnection (V1.1)
Support for other message brokers (Kafka, Redis, etc.)

Architecture
Package Structure
@hermes/
├── core/ # Connection management, retry logic, types
├── client/ # RPC client, Publisher, Subscriber
├── server/ # RPC server, command routing
└── testing/ # Test utilities, mocks, testcontainers helpers
Dependency Graph
@hermes/testing (devDependencies only)
↓
@hermes/server ──→ @hermes/core
↓ ↓
@hermes/client ────────→
Technology Stack

Runtime: Node.js 18+
Language: TypeScript 5.3+ (strict mode)
Build: tsup (ESM + CJS)
Testing: Vitest + Testcontainers
Monorepo: Turborepo + pnpm workspaces
Versioning: Changesets

Package 1: @hermes/core
Responsibilities

Singleton connection management per URL
Channel pooling with health checks
Retry logic with exponential backoff
Shared types and error classes
Logger interface (optional, zero-dependency)

Public API
typescript// Connection Management
export interface ConnectionConfig {
url: string;
reconnect?: boolean;
reconnectInterval?: number;
maxReconnectAttempts?: number;
heartbeat?: number;
logger?: Logger;
}

export class ConnectionManager {
static getInstance(config: ConnectionConfig): ConnectionManager;
getConnection(): Promise<Connection>;
isConnected(): boolean;
close(): Promise<void>;
on(event: 'connected' | 'disconnected' | 'error' | 'reconnecting', handler: (data?: any) => void): void;
off(event: string, handler: Function): void;
}

// Channel Pooling
export interface ChannelPoolConfig {
min?: number;
max?: number;
acquireTimeout?: number;
evictionInterval?: number;
}

export class ChannelPool {
constructor(connection: Connection, config?: ChannelPoolConfig);
acquire(): Promise<ConfirmChannel>;
release(channel: ConfirmChannel): void;
destroy(channel: ConfirmChannel): Promise<void>;
size(): number;
available(): number;
pending(): number;
drain(): Promise<void>;
}

// Retry Logic
export interface RetryConfig {
enabled?: boolean;
maxAttempts?: number;
initialDelay?: number;
maxDelay?: number;
backoffMultiplier?: number;
retryableErrors?: Array<string | RegExp>;
}

export class RetryPolicy {
constructor(config?: RetryConfig);
shouldRetry(error: Error, attempt: number): boolean;
getDelay(attempt: number): number;
execute<T>(fn: () => Promise<T>, context?: string): Promise<T>;
}

// Error Types
export class HermesError extends Error {
constructor(message: string, public code: string, public details?: any);
}

export class ConnectionError extends HermesError {}
export class TimeoutError extends HermesError {}
export class ChannelError extends HermesError {}

// Logger Interface
export interface Logger {
debug(message: string, context?: Record<string, any>): void;
info(message: string, context?: Record<string, any>): void;
warn(message: string, context?: Record<string, any>): void;
error(message: string, error?: Error, context?: Record<string, any>): void;
}

export class SilentLogger implements Logger {
debug() {}
info() {}
warn() {}
error() {}
}

export class ConsoleLogger implements Logger {
constructor(minLevel?: 'debug' | 'info' | 'warn' | 'error');
}

// Message Types
export interface MessageEnvelope<T = any> {
id: string;
timestamp: number;
data: T;
metadata?: Record<string, any>;
}

export interface RequestEnvelope<T = any> extends MessageEnvelope<T> {
command: string;
}

export interface ResponseEnvelope<T = any> {
success: boolean;
data?: T;
error?: {
code: string;
message: string;
details?: any;
stack?: string;
};
}

export interface Serializer {
encode(data: any): Buffer;
decode(buffer: Buffer): any;
}

export class JsonSerializer implements Serializer {}
Implementation Details
ConnectionManager

Singleton pattern keyed by URL
Auto-reconnection with exponential backoff on connection loss
EventEmitter for lifecycle events
Graceful shutdown: close all channels before closing connection
Fail-fast strategy: Pending operations fail immediately on disconnect, rely on RetryPolicy for recovery

ChannelPool

Lazy initialization: create channels on demand up to max
Use ConfirmChannel for delivery guarantees
Health check on acquire(): test channel before returning
Track in-flight operations per channel
Auto-destroy broken channels

RetryPolicy

Exponential backoff: delay = min(initialDelay \* backoffMultiplier^attempt, maxDelay)
Default retryable errors: /ECONNREFUSED/, /ETIMEDOUT/, /ENOTFOUND/
Stop retrying on non-retryable errors immediately

Package 2: @hermes/client
Responsibilities

RPC Client (request/response pattern)
Event Publisher (fire-and-forget)
Event Subscriber (consume events with pattern matching)

Public API
typescript// RPC Client
export interface RpcClientConfig {
connection: ConnectionConfig;
queueName: string;
timeout?: number;
retry?: RetryConfig;
serializer?: Serializer;
logger?: Logger;
assertQueue?: boolean;
queueOptions?: AssertQueue;
}

export class RpcClient {
constructor(config: RpcClientConfig);

send<TRequest = any, TResponse = any>(
command: string,
data: TRequest,
options?: {
timeout?: number;
metadata?: Record<string, any>;
signal?: AbortSignal;
}
): Promise<TResponse>;

isReady(): boolean;
close(): Promise<void>;
}

// Publisher
export interface PublisherConfig {
connection: ConnectionConfig;
exchanges?: Array<{
name: string;
type?: 'topic' | 'fanout' | 'direct';
options?: AssertExchange;
}>;
exchange?: string;
exchangeType?: 'topic' | 'fanout' | 'direct';
defaultExchange?: string;
persistent?: boolean;
retry?: RetryConfig;
logger?: Logger;
}

export class Publisher {
constructor(config: PublisherConfig);

publish<T = any>(
eventName: string,
data: T,
options?: {
exchange?: string;
routingKey?: string;
persistent?: boolean;
metadata?: Record<string, any>;
}
): Promise<void>;

publishToMany<T = any>(
exchanges: string[],
eventName: string,
data: T,
options?: {
routingKey?: string;
metadata?: Record<string, any>;
}
): Promise<void>;

close(): Promise<void>;
}

// Subscriber
export interface SubscriberConfig {
connection: ConnectionConfig;
exchange: string;
exchangeType?: 'topic' | 'fanout' | 'direct';
exchangeOptions?: AssertExchange;
queueName?: string;
queueOptions?: AssertQueue;
prefetch?: number;
retry?: RetryConfig;
logger?: Logger;
}

export type EventHandler<T = any> = (
data: T,
context: {
eventName: string;
timestamp: number;
metadata?: Record<string, any>;
rawMessage: ConsumeMessage;
}
) => Promise<void> | void;

export class Subscriber {
constructor(config: SubscriberConfig);

on<T = any>(eventPattern: string, handler: EventHandler<T>): this;
start(): Promise<void>;
stop(): Promise<void>;
isRunning(): boolean;
}
Implementation Details
RpcClient

Use direct reply-to queue: amq.rabbitmq.reply-to
Generate UUID v4 for correlationId per request
Track pending requests in Map<correlationId, { resolve, reject, timeout }>
Single consumer on reply-to queue, route by correlationId
Timeout handling: clear timeout on response or error
AbortSignal support: cleanup on abort
Apply RetryPolicy to network errors

Publisher

Assert exchanges on first publish (lazy)
Use channel.publish() with waitForConfirms() for guaranteed delivery
Support multiple exchanges: configured upfront or dynamic
Default options: durable: true, persistent: true
Add timestamp automatically if not provided

Subscriber

Auto-generate queue name if not provided: {exchange}.{uuid}
Bind queue to exchange with routing key = eventPattern
Pattern matching:

- matches exactly one word: user.\* → user.created, user.updated

# matches zero or more words: order.# → order.created, order.shipped.express

Route incoming messages to all matching handlers
Execute handlers in parallel with Promise.all()
Use channel.ack() after successful handler execution
Use channel.nack(false, false) on error (send to DLQ if configured)

Package 3: @hermes/server
Responsibilities

RPC Server (handle commands)
Command routing and dispatching
Error serialization for RPC responses
Graceful shutdown with in-flight message draining

Public API
typescriptexport interface RpcServerConfig {
connection: ConnectionConfig;
queueName: string;
prefetch?: number;
queueOptions?: AssertQueue;
onUnhandledCommand?: (command: string) => void;
retry?: RetryConfig;
deadLetter?: {
exchange: string;
routingKey?: string;
};
includeStackTrace?: boolean;
logger?: Logger;
serializer?: Serializer;
}

export type CommandHandler<TRequest = any, TResponse = any> = (
data: TRequest,
context: {
command: string;
metadata?: Record<string, any>;
correlationId: string;
rawMessage: ConsumeMessage;
}
) => Promise<TResponse> | TResponse;

export class RpcServer {
constructor(config: RpcServerConfig);

command<TRequest = any, TResponse = any>(
commandName: string,
handler: CommandHandler<TRequest, TResponse>
): this;

commands(handlers: Record<string, CommandHandler>): this;

start(): Promise<void>;

stop(options?: {
timeout?: number;
force?: boolean;
}): Promise<void>;

isRunning(): boolean;

getStats(): {
commandsRegistered: number;
messagesProcessed: number;
messagesInFlight: number;
errors: number;
};
}
Implementation Details
RpcServer

Assert queue with durable: true on start
Set prefetch to control concurrent message processing
Parse incoming message: extract command, data, correlationId, replyTo
Command names are case-insensitive (normalize to uppercase internally)
Route to registered handler by command name
Wrap handler execution in try/catch
Serialize response as ResponseEnvelope:

Success: { success: true, data: result }
Error: { success: false, error: { code, message, details, stack? } }

Send response to replyTo queue with same correlationId
Use channel.ack() after response is sent
If handler throws and retry enabled: use channel.nack(false, true) to requeue
After max retries: send to dead letter exchange if configured
Graceful shutdown:

Stop accepting new messages (channel.cancel())
Wait for in-flight messages (up to timeout)
Close channel and connection
Force kill if timeout exceeded and force: true

Error Serialization
typescriptconst serializeError = (error: Error, includeStack: boolean): ErrorObject => {
return {
code: error.name || 'INTERNAL_ERROR',
message: error.message,
details: error['details'],
...(includeStack && { stack: error.stack }),
};
};
Default: includeStackTrace = process.env.NODE_ENV !== 'production'

Package 4: @hermes/testing
Responsibilities

Mock implementations for unit tests
Testcontainers wrapper for integration tests
Test helpers and utilities

Public API
typescript// Mock RPC Client
export class MockRpcClient {
mockResponse(command: string, response: any): void;
mockError(command: string, error: Error): void;
send<TReq, TRes>(command: string, data: TReq): Promise<TRes>;
getCallHistory(): Array<{ command: string; data: any; timestamp: number }>;
clear(): void;
close(): Promise<void>;
}

// Mock Publisher
export class MockPublisher {
publish<T>(eventName: string, data: T, options?: any): Promise<void>;
publishToMany<T>(exchanges: string[], eventName: string, data: T): Promise<void>;
getPublishedEvents(): Array<{
exchange: string;
eventName: string;
data: any;
timestamp: number;
}>;
clear(): void;
close(): Promise<void>;
}

// Testcontainers
export class RabbitMQContainer {
start(): Promise<{
url: string;
managementUrl: string;
container: StartedTestContainer;
}>;
stop(): Promise<void>;
}

// Helpers
export const withRabbitMQ = async <T>(
fn: (url: string) => Promise<T>
): Promise<T>;

export const setupRabbitMQSuite = (): {
getUrl: () => string;
};

```

### Implementation Details

#### MockRpcClient
- Store responses/errors in Map keyed by command name (uppercase)
- Record all calls to `send()` in array for assertion
- Simulate async behavior with `Promise.resolve()`

#### RabbitMQContainer
- Use `rabbitmq:3.13-management-alpine` image
- Expose ports: 5672 (AMQP), 15672 (Management UI)
- Wait for startup: `/Server startup complete/` log message
- Return mapped ports for host access

#### withRabbitMQ
- Start container
- Execute test function with connection URL
- Stop container in finally block
- Useful for single test isolation

#### setupRabbitMQSuite
- Start container in `beforeAll()`
- Stop container in `afterAll()`
- Return URL getter for use in tests
- Useful for test suite sharing single container

---

## Testing Strategy

### Test Pyramid
```

        E2E (optional)
           ▲
    Integration Tests
         (Real RabbitMQ)
           ▲
      Contract Tests
         (Mocks)
           ▲
        Unit Tests
    (Business Logic)

Framework: Vitest
Why Vitest:

Fast: Vite-powered, hot module reload
ESM native, TypeScript first-class
Jest-compatible API
Built-in UI and coverage

Test Types

1. Unit Tests (Vitest)
   Target: 90%+ coverage
   Focus:

RetryPolicy: exponential backoff, shouldRetry logic
Error serialization/deserialization
Pattern matching for event wildcards
Message envelope creation
Logger adapters

Example:
typescriptimport { describe, it, expect, vi } from 'vitest';
import { RetryPolicy } from '../RetryPolicy';

describe('RetryPolicy', () => {
it('should calculate exponential backoff', () => {
const policy = new RetryPolicy({
initialDelay: 1000,
maxDelay: 30000,
backoffMultiplier: 2,
});

    expect(policy.getDelay(0)).toBe(1000);
    expect(policy.getDelay(1)).toBe(2000);
    expect(policy.getDelay(2)).toBe(4000);
    expect(policy.getDelay(10)).toBe(30000);

});

it('should retry on network errors', async () => {
const policy = new RetryPolicy({
maxAttempts: 3,
initialDelay: 100,
retryableErrors: [/ECONNREFUSED/],
});

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce('success');

    const result = await policy.execute(fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);

});
}); 2. Integration Tests (Testcontainers)
Target: 80%+ coverage
Focus:

Full RPC flow: client → server → response
Pub/Sub flow: publisher → subscriber
Timeout handling
Error propagation
Reconnection after broker restart
Graceful shutdown

Example:
typescriptimport { describe, it, expect } from 'vitest';
import { RpcClient } from '../../RpcClient';
import { RpcServer } from '@hermes/server';
import { setupRabbitMQSuite } from '@hermes/testing';

describe('RPC Integration', () => {
const { getUrl } = setupRabbitMQSuite();

it('should handle request/response', async () => {
const url = getUrl();

    const server = new RpcServer({
      connection: { url },
      queueName: 'test_echo',
    });

    server.command('ECHO', async (data) => ({ echo: data }));
    await server.start();

    const client = new RpcClient({
      connection: { url },
      queueName: 'test_echo',
      timeout: 5000,
    });

    const result = await client.send('ECHO', { message: 'hello' });

    expect(result).toEqual({ echo: { message: 'hello' } });

    await server.stop();
    await client.close();

});

it('should timeout on slow handler', async () => {
const url = getUrl();

    const server = new RpcServer({
      connection: { url },
      queueName: 'test_slow',
    });

    server.command('SLOW', async () => {
      await new Promise(resolve => setTimeout(resolve, 10000));
      return { done: true };
    });

    await server.start();

    const client = new RpcClient({
      connection: { url },
      queueName: 'test_slow',
      timeout: 1000,
    });

    await expect(
      client.send('SLOW', {})
    ).rejects.toThrow(/timeout/i);

    await server.stop();
    await client.close();

});
}); 3. Contract Tests (Mocks)
Target: 85%+ coverage
Focus:

Client/server interface compliance
Error handling contracts
Message format validation

Example:
typescriptimport { describe, it, expect } from 'vitest';
import { MockRpcClient } from '@hermes/testing';

describe('RPC Contract', () => {
it('should handle valid responses', async () => {
const client = new MockRpcClient();

    client.mockResponse('GET_USER', {
      id: '123',
      email: 'test@example.com',
    });

    const result = await client.send('GET_USER', { id: '123' });

    expect(result).toEqual({
      id: '123',
      email: 'test@example.com',
    });

    const history = client.getCallHistory();
    expect(history).toHaveLength(1);
    expect(history[0].command).toBe('GET_USER');

});
});
Coverage Thresholds
typescript// vitest.config.ts
export default defineConfig({
test: {
coverage: {
provider: 'v8',
reporter: ['text', 'json', 'html', 'lcov'],
exclude: [
'**/node_modules/**',
'**/dist/**',
'**/*.test.ts',
'**/testing/**',
],
thresholds: {
lines: 85,
functions: 85,
branches: 80,
statements: 85,
},
},
},
});

Code Style Guidelines
Language & Patterns
English only - All code, comments, documentation
Arrow functions - Prefer arrow functions everywhere
typescriptconst connect = async (): Promise<Connection> => {
// implementation
};
Destructuring - Use object/array destructuring
typescriptconst { url, queueName } = config;
const [user, orders] = await Promise.all([getUser(), getOrders()]);
Early returns - Fail fast, reduce nesting
typescriptif (!this.isConnected()) {
throw new ConnectionError('Not connected');
}

return await this.doSend(command, data);
Minimal comments - Comment WHY, not WHAT
typescript// Cap exponential backoff to prevent overflow
const delay = Math.min(baseDelay \* Math.pow(2, attempt), maxDelay);
Naming Conventions
typescript// Interfaces: PascalCase
interface ConnectionConfig {}

// Classes: PascalCase
class RpcClient {}

// Functions/variables: camelCase
const createConnection = () => {};

// Constants: UPPER_SNAKE_CASE
const DEFAULT_TIMEOUT = 30000;

// Private properties: underscore prefix
class Foo {
private \_connection: Connection;
}

// Booleans: is/has/should prefix
const isConnected = true;
const hasError = false;
const shouldRetry = (error: Error) => true;
Error Handling
typescript// Specific error types
throw new TimeoutError('RPC timeout', { command, timeout });

// Early validation
if (!command) {
throw new ValidationError('Command is required');
}

// Never silent failures
try {
await something();
} catch (error) {
this.logger.error('Operation failed', error);
throw error;
}
Async/Await
typescript// Always use async/await
const result = await client.send('CMD', data);

// Promise.all for parallel operations
const [user, orders] = await Promise.all([
getUser(id),
getOrders(id),
]);

// Never use .then() chains

Build Configuration
Monorepo Setup
Tool: Turborepo + pnpm workspaces
json// package.json (root)
{
"name": "hermes-mq",
"private": true,
"workspaces": [
"packages/*",
"examples/*"
],
"scripts": {
"build": "turbo run build",
"test": "turbo run test",
"test:watch": "turbo run test:watch",
"lint": "turbo run lint",
"clean": "turbo run clean"
},
"devDependencies": {
"turbo": "^1.11.0",
"typescript": "^5.3.0",
"@types/node": "^20.10.0",
"vitest": "^1.0.0",
"@vitest/coverage-v8": "^1.0.0",
"eslint": "^8.55.0",
"prettier": "^3.1.0",
"@changesets/cli": "^2.27.0"
}
}
json// turbo.json
{
"$schema": "https://turbo.build/schema.json",
"pipeline": {
"build": {
"dependsOn": ["^build"],
"outputs": ["dist/**"]
},
"test": {
"dependsOn": ["build"],
"outputs": ["coverage/**"]
},
"lint": {
"outputs": []
},
"clean": {
"cache": false
}
}
}
yaml# pnpm-workspace.yaml
packages:

- 'packages/\*'
- 'examples/\*'
  Package Build (tsup)
  typescript// packages/core/tsup.config.ts
  import { defineConfig } from 'tsup';

export default defineConfig({
entry: ['src/index.ts'],
format: ['esm', 'cjs'],
dts: true,
splitting: false,
sourcemap: true,
clean: true,
minify: false,
external: ['amqplib'],
});
json// packages/core/package.json
{
"name": "@hermes/core",
"version": "1.0.0",
"main": "./dist/index.cjs",
"module": "./dist/index.js",
"types": "./dist/index.d.ts",
"exports": {
".": {
"import": "./dist/index.js",
"require": "./dist/index.cjs",
"types": "./dist/index.d.ts"
}
},
"scripts": {
"build": "tsup",
"test": "vitest run",
"test:watch": "vitest",
"lint": "eslint src"
},
"dependencies": {
"amqplib": "^0.10.4"
},
"devDependencies": {
"@types/amqplib": "^0.10.5",
"tsup": "^8.0.0"
},
"engines": {
"node": ">=18.0.0"
}
}
TypeScript Configuration
json// tsconfig.json (root)
{
"compilerOptions": {
"target": "ES2022",
"module": "ESNext",
"lib": ["ES2022"],
"moduleResolution": "bundler",
"strict": true,
"esModuleInterop": true,
"skipLibCheck": true,
"forceConsistentCasingInFileNames": true,
"resolveJsonModule": true,
"isolatedModules": true,
"declaration": true,
"declarationMap": true,
"sourceMap": true
}
}
json// packages/core/tsconfig.json
{
"extends": "../../tsconfig.json",
"compilerOptions": {
"outDir": "./dist",
"rootDir": "./src"
},
"include": ["src/**/*"],
"exclude": ["**/*.test.ts", "**/*.spec.ts"]
}

CI/CD Pipeline
GitHub Actions
yaml# .github/workflows/test.yml
name: Test

on:
push:
branches: [main]
pull_request:
branches: [main]

jobs:
lint:
runs-on: ubuntu-latest
steps: - uses: actions/checkout@v4 - uses: pnpm/action-setup@v2
with:
version: 8 - uses: actions/setup-node@v4
with:
node-version: 18
cache: 'pnpm' - run: pnpm install - run: pnpm lint

test-unit:
runs-on: ubuntu-latest
strategy:
matrix:
node-version: [18, 20, 22]
steps: - uses: actions/checkout@v4 - uses: pnpm/action-setup@v2
with:
version: 8 - uses: actions/setup-node@v4
with:
node-version: ${{ matrix.node-version }}
cache: 'pnpm' - run: pnpm install - run: pnpm test:unit

test-integration:
runs-on: ubuntu-latest
steps: - uses: actions/checkout@v4 - uses: pnpm/action-setup@v2
with:
version: 8 - uses: actions/setup-node@v4
with:
node-version: 20
cache: 'pnpm' - run: pnpm install - run: pnpm test:integration

coverage:
runs-on: ubuntu-latest
needs: [test-unit, test-integration]
steps: - uses: actions/checkout@v4 - uses: pnpm/action-setup@v2
with:
version: 8 - uses: actions/setup-node@v4
with:
node-version: 20
cache: 'pnpm' - run: pnpm install - run: pnpm test:coverage - uses: codecov/codecov-action@v3
with:
files: ./coverage/lcov.info
yaml# .github/workflows/release.yml
name: Release

on:
push:
branches: - main

concurrency: ${{ github.workflow }}-${{ github.ref }}

jobs:
release:
runs-on: ubuntu-latest
steps: - uses: actions/checkout@v4 - uses: pnpm/action-setup@v2
with:
version: 8 - uses: actions/setup-node@v4
with:
node-version: 20
cache: 'pnpm' - run: pnpm install - run: pnpm build - name: Create Release PR or Publish
uses: changesets/action@v1
with:
publish: pnpm release
env:
GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
NPM_TOKEN: ${{ secrets.NPM_TOKEN }}

Usage Examples
Example 1: Basic RPC
typescript// server.ts
import { RpcServer } from '@hermes/server';

const server = new RpcServer({
connection: { url: 'amqp://localhost' },
queueName: 'users',
prefetch: 10,
});

server
.command('GET_USER', async ({ id }: { id: string }) => {
const user = await db.users.findById(id);
if (!user) throw new Error('User not found');
return user;
})
.command('CREATE_USER', async (data: CreateUserDto) => {
return await db.users.create(data);
});

await server.start();

process.on('SIGTERM', async () => {
await server.stop();
process.exit(0);
});
typescript// client.ts
import { RpcClient } from '@hermes/client';

const client = new RpcClient({
connection: { url: 'amqp://localhost' },
queueName: 'users',
timeout: 5000,
});

const user = await client.send<{ id: string }, User>(
'GET_USER',
{ id: '123' }
);

console.log(user);
Example 2: Pub/Sub with Wildcards
typescript// publisher.ts
import { Publisher } from '@hermes/client';

const publisher = new Publisher({
connection: { url: 'amqp://localhost' },
exchange: 'events',
});

await publisher.publish('user.created', {
userId: '123',
email: 'test@example.com',
});

await publisher.publish('user.updated', {
userId: '123',
name: 'New Name',
});
typescript// subscriber.ts
import { Subscriber } from '@hermes/client';

const subscriber = new Subscriber({
connection: { url: 'amqp://localhost' },
exchange: 'events',
queueName: 'email_service',
prefetch: 5,
});

subscriber
.on('user.created', async (data) => {
await sendWelcomeEmail(data.email);
})
.on('user.\*', async (data, { eventName }) => {
console.log('User event:', eventName, data);
});

await subscriber.start();

process.on('SIGTERM', async () => {
await subscriber.stop();
});
Example 3: Multiple Exchanges
typescriptimport { Publisher } from '@hermes/client';

const publisher = new Publisher({
connection: { url: 'amqp://localhost' },
exchanges: [
{ name: 'app_events', type: 'topic' },
{ name: 'audit_events', type: 'fanout' },
{ name: 'notifications', type: 'topic' },
],
defaultExchange: 'app_events',
});

await publisher.publish('user.created', { id: '123' });

await publisher.publish(
'user.login',
{ userId: '123', ip: '1.2.3.4' },
{ exchange: 'audit_events' }
);

await publisher.publishToMany(
['app_events', 'audit_events'],
'user.deleted',
{ userId: '123' }
);
Example 4: Custom Logger
typescriptimport { RpcClient } from '@hermes/client';
import { Logger } from '@hermes/core';
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

const winstonLogger = winston.createLogger({
level: 'info',
format: winston.format.json(),
transports: [new winston.transports.File({ filename: 'app.log' })],
});

const logger = new WinstonAdapter(winstonLogger);

const client = new RpcClient({
connection: { url: 'amqp://localhost', logger },
queueName: 'users',
logger,
});
Example 5: Retry Configuration
typescriptimport { RpcClient } from '@hermes/client';

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

const result = await client.send('FETCH_DATA', { id: '123' });
Example 6: Testing
typescript// user.service.test.ts
import { describe, it, expect } from 'vitest';
import { MockRpcClient } from '@hermes/testing';
import { UserService } from './user.service';

describe('UserService', () => {
it('should create user', async () => {
const client = new MockRpcClient();
client.mockResponse('CREATE_USER', {
id: '123',
email: 'test@example.com',
});

    const service = new UserService(client);
    const user = await service.createUser({ email: 'test@example.com' });

    expect(user.id).toBe('123');
    expect(client.getCallHistory()).toHaveLength(1);

});
});

```

---

## Implementation Order

### Phase 1: Core Foundation (Week 1)
- [ ] Setup monorepo (Turborepo + pnpm)
- [ ] ConnectionManager with singleton pattern
- [ ] ChannelPool with health checks
- [ ] RetryPolicy with exponential backoff
- [ ] Error types (HermesError, ConnectionError, TimeoutError)
- [ ] Logger interface (Logger, SilentLogger, ConsoleLogger)
- [ ] Message types (MessageEnvelope, RequestEnvelope, ResponseEnvelope)
- [ ] Unit tests for core logic

### Phase 2: RPC Pattern (Week 2)
- [ ] RpcClient with direct reply-to queue
- [ ] Timeout and AbortSignal support
- [ ] RpcServer with command routing
- [ ] Error serialization/deserialization
- [ ] Graceful shutdown for server
- [ ] Integration tests with Testcontainers

### Phase 3: Pub/Sub Pattern (Week 3)
- [ ] Publisher with multi-exchange support
- [ ] Subscriber with pattern matching
- [ ] Wildcard support (`*`, `#`)
- [ ] Multiple handler routing
- [ ] Integration tests for pub/sub

### Phase 4: Testing Utilities (Week 4)
- [ ] MockRpcClient implementation
- [ ] MockPublisher implementation
- [ ] RabbitMQContainer wrapper
- [ ] Test helpers (withRabbitMQ, setupRabbitMQSuite)
- [ ] Example tests in examples/

### Phase 5: Documentation & Polish (Week 5)
- [ ] README.md with badges and quick start
- [ ] API documentation with TypeDoc
- [ ] Examples (01-06)
- [ ] Contributing guide
- [ ] Docker compose for local development
- [ ] GitHub Actions CI/CD
- [ ] Changesets setup

### Phase 6: Release (Week 6)
- [ ] Final testing on Node 18, 20, 22
- [ ] Performance benchmarks
- [ ] Security audit
- [ ] Publish to npm
- [ ] GitHub release with changelog
- [ ] Announcement (Twitter, Reddit, Dev.to)

---

## Success Criteria

### Functional Requirements
- [ ] RpcClient can send commands and receive responses
- [ ] RpcServer can handle commands and reply correctly
- [ ] Publisher can publish events to single or multiple exchanges
- [ ] Subscriber can consume events with wildcard pattern matching
- [ ] Automatic reconnection works after RabbitMQ restart
- [ ] Retry logic works with exponential backoff
- [ ] Graceful shutdown completes within 30 seconds
- [ ] Custom logger integration works (Winston/Pino)

### Non-Functional Requirements
- [ ] Unit test coverage ≥ 90%
- [ ] Integration test coverage ≥ 80%
- [ ] All tests pass on Node 18, 20, 22
- [ ] TypeScript strict mode with zero errors
- [ ] ESM + CJS builds work correctly
- [ ] Package size < 50KB (gzipped) per package
- [ ] Zero memory leaks in 24h load test
- [ ] Documentation complete with runnable examples

### Performance Targets
- [ ] Support 1000+ RPC requests/second on single connection
- [ ] RPC call overhead < 5ms (excluding network)
- [ ] Channel pool reuse rate > 95%
- [ ] Pub/Sub latency < 10ms (excluding network)

---

## Future Enhancements (V1.1+)

### V1.1 (Q2 2024)
- [ ] Metrics events (EventEmitter pattern) for observability
- [ ] `@hermes/metrics-prometheus` plugin
- [ ] Circuit breaker pattern for RPC calls
- [ ] Message buffering during reconnection

### V1.2 (Q3 2024)
- [ ] Request/response tracing with OpenTelemetry
- [ ] Message compression plugin
- [ ] Schema validation plugin (Zod/Joi)
- [ ] Dead letter queue management utilities

### V2.0 (Q4 2024)
- [ ] CRUD auto-mapping helpers (CrudRpcClient/Server)
- [ ] Transaction support for multi-step operations
- [ ] Priority queues
- [ ] Scheduled/delayed messages

---

## Open Questions

1. **Dead Letter Queue Configuration:** Should DLQ setup be automatic or manual? Current: manual via `deadLetter` config option.

2. **Message TTL:** Should we expose TTL (time-to-live) configuration for messages? Current: not exposed, rely on RabbitMQ defaults.

3. **Prefetch Tuning:** Should we provide guidance on optimal prefetch values? Current: default 10, user configurable.

4. **Connection String Format:** Support both `amqp://` and `amqps://` (TLS)? Current: yes, amqplib handles both.

5. **TypeDoc vs Docusaurus:** Start with TypeDoc for V1, migrate to Docusaurus if project grows? Current: yes.

---

## Risks & Mitigations

### Risk 1: Testcontainers Slow on CI
**Mitigation:** Cache Docker images, run integration tests only on main branch

### Risk 2: Breaking Changes in amqplib
**Mitigation:** Pin to specific minor version, monitor releases closely

### Risk 3: Memory Leaks in Connection Pool
**Mitigation:** Comprehensive leak testing, proper cleanup in finally blocks

### Risk 4: Pattern Matching Performance
**Mitigation:** Benchmark with 1000+ patterns, optimize regex compilation

### Risk 5: Adoption if Documentation Unclear
**Mitigation:** Invest heavily in examples, video tutorials, blog posts

---

## Appendix: Repository Structure
```

hermes-mq/
├── .github/
│ └── workflows/
│ ├── test.yml
│ └── release.yml
├── .changeset/
│ └── README.md
├── packages/
│ ├── core/
│ │ ├── src/
│ │ │ ├── connection/
│ │ │ │ ├── ConnectionManager.ts
│ │ │ │ └── ChannelPool.ts
│ │ │ ├── retry/
│ │ │ │ └── RetryPolicy.ts
│ │ │ ├── types/
│ │ │ │ ├── Logger.ts
│ │ │ │ ├── Errors.ts
│ │ │ │ ├── Messages.ts
│ │ │ │ └── Serializer.ts
│ │ │ └── index.ts
│ │ ├── **tests**/
│ │ │ ├── unit/
│ │ │ └── integration/
│ │ ├── package.json
│ │ ├── tsconfig.json
│ │ ├── tsup.config.ts
│ │ └── README.md
│ ├── client/
│ │ ├── src/
│ │ │ ├── rpc/
│ │ │ │ └── RpcClient.ts
│ │ │ ├── pubsub/
│ │ │ │ ├── Publisher.ts
│ │ │ │ └── Subscriber.ts
│ │ │ └── index.ts
│ │ ├── **tests**/
│ │ ├── package.json
│ │ └── README.md
│ ├── server/
│ │ ├── src/
│ │ │ ├── rpc/
│ │ │ │ └── RpcServer.ts
│ │ │ └── index.ts
│ │ ├── **tests**/
│ │ ├── package.json
│ │ └── README.md
│ └── testing/
│ ├── src/
│ │ ├── mocks/
│ │ │ ├── MockRpcClient.ts
│ │ │ └── MockPublisher.ts
│ │ ├── containers/
│ │ │ └── RabbitMQContainer.ts
│ │ ├── helpers/
│ │ │ └── testHelpers.ts
│ │ └── index.ts
│ ├── package.json
│ └── README.md
├── examples/
│ ├── 01-basic-rpc/
│ ├── 02-pub-sub/
│ ├── 03-error-handling/
│ ├── 04-multiple-exchanges/
│ ├── 05-custom-logger/
│ └── 06-graceful-shutdown/
├── docs/
│ ├── getting-started.md
│ └── api-reference.md
├── .eslintrc.js
├── .prettierrc
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── turbo.json
├── LICENSE
└── README.md

License
MIT License

Document Version: 1.0.0
Last Updated: 2024-11-12
Author: nogards95TG
Status: Ready for Implementation
l'autode della liberia nogards95TG
