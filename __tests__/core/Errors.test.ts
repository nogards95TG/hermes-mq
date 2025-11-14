import { describe, it, expect } from 'vitest';
import { HermesError, ConnectionError, TimeoutError, ChannelError, ValidationError } from '../../src/core/types/Errors';

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
    it('should create connection error', () => {
      const error = new ConnectionError('Connection failed', { host: 'localhost' });

      expect(error.message).toBe('Connection failed');
      expect(error.code).toBe('CONNECTION_ERROR');
      expect(error.details).toEqual({ host: 'localhost' });
      expect(error.name).toBe('ConnectionError');
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
    it('should create channel error', () => {
      const error = new ChannelError('Channel closed', { reason: 'connection lost' });

      expect(error.message).toBe('Channel closed');
      expect(error.code).toBe('CHANNEL_ERROR');
      expect(error.details).toEqual({ reason: 'connection lost' });
      expect(error.name).toBe('ChannelError');
    });
  });

  describe('ValidationError', () => {
    it('should create validation error', () => {
      const error = new ValidationError('Invalid input', { field: 'email' });

      expect(error.message).toBe('Invalid input');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details).toEqual({ field: 'email' });
      expect(error.name).toBe('ValidationError');
    });
  });
});
