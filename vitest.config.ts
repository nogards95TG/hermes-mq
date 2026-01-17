import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    exclude: ['__tests__/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '__tests__/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        'examples/**',
        '**/index.ts',
        '**/*.config.ts',
        '**/.eslintrc.js',
        'scripts/**',
      ],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 75,
        statements: 75,
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
