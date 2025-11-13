import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@hermes/client': path.resolve(__dirname, '../client/src'),
      '@hermes/core': path.resolve(__dirname, '../core/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000, // 30s for integration tests
    hookTimeout: 90000, // 90s for container startup
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/__tests__/**', '**/dist/**', '**/node_modules/**'],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 75,
        statements: 75,
      },
    },
  },
});
