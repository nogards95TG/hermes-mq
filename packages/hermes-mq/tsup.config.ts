import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true, // Now we can enable DTS generation!
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  external: ['amqplib'], // Only external dependency
  treeshake: true,
  bundle: true, // Bundle everything
});
