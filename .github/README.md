# GitHub Actions Workflows

This directory contains the CI/CD workflows for Hermes MQ.

## Workflows

### 🧪 Test (`test.yml`)

Runs on every push to `main`/`develop` and on pull requests.

**Jobs:**

1. **Lint** - ESLint checks on all packages
2. **Type Check** - TypeScript compilation verification
3. **Unit Tests** - Runs on Node.js 18, 20, and 22
4. **Integration Tests** - Full end-to-end tests with RabbitMQ (Testcontainers)
5. **Coverage** - Generates coverage reports

## Local Testing

You can run the same checks locally:

```bash
# Lint
pnpm lint

# Type check
pnpm typecheck

# Unit tests
pnpm test:unit

# Integration tests
pnpm test:integration

# Coverage
pnpm test:coverage
```

## Badge Status

The test badge in the README updates automatically based on the latest workflow run:

![Test](https://github.com/nogards95TG/hermes-mq/workflows/Test/badge.svg)
