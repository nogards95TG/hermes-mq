/**
 * Test environment setup file
 * Provides polyfills for Node.js versions that don't include certain Web APIs
 */

// Polyfill File API for Node < 20
if (typeof global.File === 'undefined') {
  // @ts-expect-error - File may not exist in older Node versions
  global.File = class File extends Blob {
    constructor(parts: BlobPart[], name: string, options?: FilePropertyBag) {
      super(parts, options);
      Object.defineProperty(this, 'name', { value: name });
    }
  };
}

// Polyfill FormData for Node < 18
if (typeof global.FormData === 'undefined') {
  const { FormData } = require('formdata-node');
  global.FormData = FormData;
}

// Suppress "Unexpected close" errors from amqplib during test cleanup
// These occur when containers are stopped while connections are still open
// They are expected behavior and not actual test failures
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  const message = args[0]?.toString() || '';
  if (message.includes('Unexpected close')) {
    return; // Silently ignore
  }
  originalConsoleError.apply(console, args);
};

// Handle unhandled rejections for "Unexpected close" errors
process.on('unhandledRejection', (reason: any) => {
  if (reason?.message?.includes('Unexpected close')) {
    // Ignore these specific errors during test cleanup
    return;
  }
  // Re-throw other unhandled rejections
  throw reason;
});
