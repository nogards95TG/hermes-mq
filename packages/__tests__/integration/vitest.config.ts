import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    testTimeout: 30000,
    hookTimeout: 90000,
    globals: true,
    environment: 'node',
    include: ['**/*.integration.test.ts'],
    // Suppress unhandled errors from RabbitMQ connection cleanup during test shutdown
    dangerouslyIgnoreUnhandledErrors: true,
  },
  resolve: {
    alias: {
      '@hermes/core': path.resolve(__dirname, '../../core/src'),
      '@hermes/client': path.resolve(__dirname, '../../client/src'),
      '@hermes/server': path.resolve(__dirname, '../../server/src'),
    },
  },
});
