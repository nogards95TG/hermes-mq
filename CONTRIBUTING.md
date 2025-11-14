# Contributing to Hermes MQ

Thank you for considering contributing to Hermes MQ! 🎉

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/hermes-mq.git`
3. Install dependencies: `pnpm install`
4. Start RabbitMQ: `docker-compose up -d`
5. Build package: `pnpm build`
6. Run tests: `pnpm test`

## Development Workflow

### Adding a Feature

1. Create a new branch: `git checkout -b feature/your-feature-name`
2. Make your changes
3. Add tests for your changes
4. Run pre-push checks: `pnpm pre-push`
5. Commit your changes: `git commit -m "feat: add your feature"`
6. Push to your fork: `git push origin feature/your-feature-name`
7. Create a Pull Request

### Pre-Push Checks

Before pushing, run the pre-push script to ensure CI will pass:

```bash
pnpm pre-push
```

This runs:
- 📦 Dependency installation
- 🏗️ Build
-  Type checking
- 🧪 Unit tests
- 🔗 Integration tests

### Running Tests

```bash
# Run all tests
pnpm test

# Run unit tests only
pnpm test:unit

# Run integration tests (requires RabbitMQ)
pnpm test:integration

# Run tests in watch mode
pnpm test:watch

# Generate coverage report
pnpm test:coverage
```

### Code Style

We use Prettier for code formatting. Run:

```bash
# Check formatting
pnpm format:check

# Fix formatting
pnpm format
```

All code is written in TypeScript with strict mode enabled.

## Testing Guidelines

- Write unit tests for all business logic
- Write integration tests for external dependencies (RabbitMQ)
- Aim for 75%+ code coverage
- Use descriptive test names
- Follow the AAA pattern (Arrange, Act, Assert)

## Code Review Process

1. All submissions require review
2. We may ask for changes before merging
3. Ensure CI/CD passes
4. Keep PRs focused and small when possible


## License

By contributing, you agree that your contributions will be licensed under the MIT License.
