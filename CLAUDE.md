# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Hermes MQ** is a type-safe RabbitMQ client library for Node.js that supports two communication patterns:
- **RPC (Request/Response)**: Synchronous request-response via RabbitMQ queues
- **Pub/Sub**: Asynchronous event publishing and subscriptions via exchanges

The library ships as both ESM and CJS with TypeScript declarations.

## Commands

```bash
# Build
npm run build           # tsup → dist/ (ESM + CJS + DTS)
npm run typecheck       # tsc --noEmit (type check only)

# Test
npm test                # All unit tests
npm run test:unit       # Unit tests only
npm run test:integration # Integration tests (requires Docker for Testcontainers)
npm run test:watch      # Watch mode
npm run test:coverage   # With coverage report (75% threshold enforced)

# Lint & Format
npm run lint            # ESLint
npm run lint:fix        # ESLint with auto-fix
npm run format          # Prettier write
npm run format:check    # Prettier check

# Dev environment
docker-compose up -d    # Start RabbitMQ for integration tests
```

To run a single test file:
```bash
npx vitest run __tests__/core/CircuitBreaker.test.ts
```

## Architecture

### Package Layout

```
src/
├── index.ts            # Public API re-exports
├── client/
│   ├── rpc/RpcClient.ts     # Sends RPC requests; tracks pending with correlation IDs
│   └── pubsub/Publisher.ts  # Publishes to exchanges with confirms & backpressure
├── server/
│   ├── rpc/RpcServer.ts     # Handles RPC commands; routes to registered handlers
│   └── pubsub/Subscriber.ts # Consumes events from exchange with pattern routing
└── core/
    ├── connection/
    │   ├── ConnectionManager.ts            # Single AMQP connection with circuit breaker + retry
    │   └── ConsumerReconnectionManager.ts  # Auto-recovery on consumer cancellation
    ├── message/
    │   ├── MessageParser.ts       # Buffer → envelope deserialization
    │   ├── MessageBuffer.ts       # TTL-based buffer for pending RPC responses
    │   └── MessageDeduplicator.ts # LRU dedup cache (disabled by default)
    ├── resilience/CircuitBreaker.ts  # CLOSED → OPEN → HALF_OPEN state machine
    ├── retry/RetryPolicy.ts          # Exponential backoff (3 attempts, 1s→30s)
    ├── health/HealthChecker.ts       # K8s-ready liveness/readiness probes
    ├── metrics/MetricsCollector.ts   # Global singleton, Prometheus text format
    ├── errors/index.ts               # HermesError hierarchy
    ├── types/
    │   ├── Messages.ts  # Message envelope, AckStrategy, DLQ config types
    │   ├── Logger.ts    # Logger interface + SilentLogger/ConsoleLogger
    │   └── Amqp.ts      # AMQP type extensions and guards
    └── constants.ts     # Shared magic numbers (timeouts, limits, defaults)
```

### Key Design Decisions

- **Single connection**: `ConnectionManager` owns one AMQP connection shared across all channels. RpcClient/RpcServer/Publisher/Subscriber each get their own channel from it.
- **No message envelopes on the wire**: Messages are sent as raw payloads (envelope was removed to reduce overhead).
- **Circuit breaker wraps connection**: Prevents cascading failures during RabbitMQ outages (5 failures → OPEN, 60s reset).
- **Deduplication is opt-in**: `MessageDeduplicator` uses LRU (10k entries, 5-min TTL) but is disabled by default.
- **MetricsCollector is a global singleton**: All components push to the same instance; export via `getMetrics()`.
- **Mocks included**: `__tests__/mocks/MockRpcClient.ts` and `MockPublisher.ts` are exported as part of the package for consumers to use in their own tests.

### Test Structure

- `__tests__/core/` — Unit tests for all core modules
- `__tests__/client/` — Publisher and RpcClient unit tests
- `__tests__/server/` — RpcServer and Subscriber unit tests
- `__tests__/integration/` — End-to-end tests using Testcontainers (real RabbitMQ)
- `__tests__/mocks/` — Mock implementations (also tested)

Integration tests spin up RabbitMQ via Testcontainers (`__tests__/integration/testContainer.ts`); no manual setup needed beyond Docker being available.

### TypeScript Strictness

`noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, and `strict` are all enabled. Code must pass `npm run typecheck` cleanly.
