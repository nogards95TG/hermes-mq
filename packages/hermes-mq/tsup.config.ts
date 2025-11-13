import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: false, // Disable auto DTS generation, we copy manually
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  external: ['amqplib'], // Only external dependency
  treeshake: true,
  bundle: true, // Bundle everything except amqplib
});
