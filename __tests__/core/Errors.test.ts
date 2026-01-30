import { describe, it, expect } from 'vitest';
import {
  HermesError,
  ConnectionError,
  TimeoutError,
  ChannelError,
  ValidationError,
  StateError,
  RetryExhaustedError,
} from '../../src/core/errors';

describe('Errors', () => {
  describe('HermesError', () => {
    it('should create error with message, code, and details', () => {
      const error = new HermesError('Test error', 'TEST_CODE', { foo: 'bar' });

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.details).toEqual({ foo: 'bar' });
      expect(error.name).toBe('HermesError');
    });

    it('should have stack trace', () => {
      const error = new HermesError('Test error', 'TEST_CODE');
      expect(error.stack).toBeDefined();
    });
  });

  describe('ConnectionError', () => {
    it('should create failed connection error', () => {
      const error = ConnectionError.failed('Connection failed', { host: 'localhost' });

      expect(error.message).toBe('Connection failed');
      expect(error.code).toBe('CONNECTION_ERROR:FAILED');
      expect(error.details).toEqual({ host: 'localhost' });
      expect(error.name).toBe('ConnectionError');
      expect(error).toBeInstanceOf(ConnectionError);
      expect(error).toBeInstanceOf(HermesError);
    });

    it('should create closed connection error', () => {
      const error = ConnectionError.closed('Connection closed');

      expect(error.message).toBe('Connection closed');
      expect(error.code).toBe('CONNECTION_ERROR:CLOSED');
      expect(error.name).toBe('ConnectionError');
    });

    it('should create auth connection error', () => {
      const error = ConnectionError.auth('Authentication failed');

      expect(error.message).toBe('Authentication failed');
      expect(error.code).toBe('CONNECTION_ERROR:AUTH');
    });

    it('should create timeout connection error', () => {
      const error = ConnectionError.timeout('Connection timeout');

      expect(error.message).toBe('Connection timeout');
      expect(error.code).toBe('CONNECTION_ERROR:TIMEOUT');
    });

    it('should create tls connection error', () => {
      const error = ConnectionError.tls('TLS error');

      expect(error.message).toBe('TLS error');
      expect(error.code).toBe('CONNECTION_ERROR:TLS');
    });

    it('should have stack trace', () => {
      const error = ConnectionError.failed('Connection failed');
      expect(error.stack).toBeDefined();
    });
  });

  describe('TimeoutError', () => {
    it('should create timeout error', () => {
      const error = new TimeoutError('Operation timed out', { timeout: 5000 });

      expect(error.message).toBe('Operation timed out');
      expect(error.code).toBe('TIMEOUT_ERROR');
      expect(error.details).toEqual({ timeout: 5000 });
      expect(error.name).toBe('TimeoutError');
    });
  });

  describe('ChannelError', () => {
    it('should create creation failed channel error', () => {
      const error = ChannelError.creationFailed('Channel creation failed', {
        reason: 'connection lost',
      });

      expect(error.message).toBe('Channel creation failed');
      expect(error.code).toBe('CHANNEL_ERROR:CREATION_FAILED');
      expect(error.details).toEqual({ reason: 'connection lost' });
      expect(error.name).toBe('ChannelError');
      expect(error).toBeInstanceOf(ChannelError);
      expect(error).toBeInstanceOf(HermesError);
    });

    it('should create pool draining channel error', () => {
      const error = ChannelError.poolDraining('Pool is draining');

      expect(error.message).toBe('Pool is draining');
      expect(error.code).toBe('CHANNEL_ERROR:POOL_DRAINING');
    });

    it('should create closed channel error', () => {
      const error = ChannelError.closed('Channel closed');

      expect(error.message).toBe('Channel closed');
      expect(error.code).toBe('CHANNEL_ERROR:CLOSED');
    });

    it('should create flow channel error', () => {
      const error = ChannelError.flow('Flow control active');

      expect(error.message).toBe('Flow control active');
      expect(error.code).toBe('CHANNEL_ERROR:FLOW');
    });

    it('should create timeout channel error', () => {
      const error = ChannelError.timeout('Channel timeout');

      expect(error.message).toBe('Channel timeout');
      expect(error.code).toBe('CHANNEL_ERROR:TIMEOUT');
    });

    it('should have stack trace', () => {
      const error = ChannelError.creationFailed('Failed');
      expect(error.stack).toBeDefined();
    });
  });

  describe('ValidationError', () => {
    it('should create command required validation error', () => {
      const error = ValidationError.commandRequired('Command is required', {
        field: 'command',
      });

      expect(error.message).toBe('Command is required');
      expect(error.code).toBe('VALIDATION_ERROR:COMMAND_REQUIRED');
      expect(error.details).toEqual({ field: 'command' });
      expect(error.name).toBe('ValidationError');
      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toBeInstanceOf(HermesError);
    });

    it('should create handler required validation error', () => {
      const error = ValidationError.handlerRequired('Handler is required');

      expect(error.message).toBe('Handler is required');
      expect(error.code).toBe('VALIDATION_ERROR:HANDLER_REQUIRED');
    });

    it('should create exchange required validation error', () => {
      const error = ValidationError.exchangeRequired('Exchange is required');

      expect(error.message).toBe('Exchange is required');
      expect(error.code).toBe('VALIDATION_ERROR:EXCHANGE_REQUIRED');
    });

    it('should create pattern required validation error', () => {
      const error = ValidationError.patternRequired('Pattern is required');

      expect(error.message).toBe('Pattern is required');
      expect(error.code).toBe('VALIDATION_ERROR:PATTERN_REQUIRED');
    });

    it('should create event name required validation error', () => {
      const error = ValidationError.eventNameRequired('Event name is required');

      expect(error.message).toBe('Event name is required');
      expect(error.code).toBe('VALIDATION_ERROR:EVENT_NAME_REQUIRED');
    });

    it('should create invalid config validation error', () => {
      const error = ValidationError.invalidConfig('Invalid configuration');

      expect(error.message).toBe('Invalid configuration');
      expect(error.code).toBe('VALIDATION_ERROR:INVALID_CONFIG');
    });

    it('should have stack trace', () => {
      const error = ValidationError.commandRequired('Command required');
      expect(error.stack).toBeDefined();
    });
  });

  describe('StateError', () => {
    it('should create state error', () => {
      const error = new StateError('Invalid state', { state: 'not ready' });

      expect(error.message).toBe('Invalid state');
      expect(error.code).toBe('STATE_ERROR');
      expect(error.details).toEqual({ state: 'not ready' });
      expect(error.name).toBe('StateError');
      expect(error).toBeInstanceOf(StateError);
      expect(error).toBeInstanceOf(HermesError);
    });
  });

  describe('RetryExhaustedError', () => {
    it('should create retry exhausted error', () => {
      const error = new RetryExhaustedError('Retry exhausted', { attempts: 3 });

      expect(error.message).toBe('Retry exhausted');
      expect(error.code).toBe('RETRY_EXHAUSTED_ERROR');
      expect(error.details).toEqual({ attempts: 3 });
      expect(error.name).toBe('RetryExhaustedError');
      expect(error).toBeInstanceOf(RetryExhaustedError);
      expect(error).toBeInstanceOf(HermesError);
    });
  });
});
