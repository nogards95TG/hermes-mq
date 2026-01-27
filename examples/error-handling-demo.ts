/**
 * Demo: Type-safe error handling with factory methods
 *
 * This file demonstrates the improved error handling system with:
 * - Full TypeScript autocomplete
 * - Type-safe error codes
 * - No magic strings
 */

import {
  ConnectionError,
  ChannelError,
  ValidationError,
  StateError,
  RetryExhaustedError,
} from '../src/core';

// ✅ Connection errors - autocomplete shows all factory methods
function connectionExample() {
  // TypeScript autocomplete will show:
  // - ConnectionError.failed()
  // - ConnectionError.closed()
  // - ConnectionError.auth()
  // - ConnectionError.timeout()
  // - ConnectionError.tls()

  throw ConnectionError.failed('Connection failed', {
    url: 'amqp://localhost',
    attempt: 3,
  });
}

// ✅ Channel errors - type-safe and discoverable
function channelExample() {
  // TypeScript autocomplete will show:
  // - ChannelError.creationFailed()
  // - ChannelError.poolDraining()
  // - ChannelError.closed()
  // - ChannelError.flow()
  // - ChannelError.timeout()

  throw ChannelError.creationFailed('Failed to create channel', {
    poolSize: 10,
  });
}

// ✅ Validation errors - semantic and clear
function validationExample() {
  // TypeScript autocomplete will show:
  // - ValidationError.commandRequired()
  // - ValidationError.handlerRequired()
  // - ValidationError.exchangeRequired()
  // - ValidationError.patternRequired()
  // - ValidationError.eventNameRequired()
  // - ValidationError.invalidConfig()

  throw ValidationError.commandRequired('Command is required', {
    providedValue: undefined,
  });
}

// ✅ Error catching with type safety
function errorHandlingExample() {
  try {
    throw ConnectionError.failed('Connection failed');
  } catch (error) {
    if (error instanceof ConnectionError) {
      // error.code is available and type-safe
      console.log('Connection error:', error.code); // "CONNECTION_ERROR:FAILED"
      console.log('Details:', error.details);
    }
  }
}

// ✅ Pattern matching with error codes
function errorMatchingExample(error: Error) {
  if (error instanceof ConnectionError) {
    // Can check specific error codes
    if (error.code === 'CONNECTION_ERROR:FAILED') {
      // Retry connection
    } else if (error.code === 'CONNECTION_ERROR:AUTH') {
      // Handle authentication failure
    }
  }
}

// ❌ This would be a compile error (constructor is private):
// throw new ConnectionError('message', 'code', {});

// ✅ Must use factory methods:
throw ConnectionError.failed('Connection failed');

export {
  connectionExample,
  channelExample,
  validationExample,
  errorHandlingExample,
  errorMatchingExample,
};
