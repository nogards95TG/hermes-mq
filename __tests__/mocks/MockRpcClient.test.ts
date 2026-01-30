import { describe, it, expect, beforeEach } from 'vitest';
import { MockRpcClient } from './MockRpcClient';
import { ValidationError } from '../../src/core';

describe('MockRpcClient', () => {
  let mockClient: MockRpcClient;

  beforeEach(() => {
    mockClient = new MockRpcClient();
  });

  describe('mockResponse', () => {
    it('should return mocked response for configured command', async () => {
      const expectedResponse = { userId: 123, name: 'John' };
      mockClient.mockResponse('GET_USER', expectedResponse);

      const result = await mockClient.send('GET_USER', { id: 1 });

      expect(result).toEqual(expectedResponse);
    });

    it('should normalize command name to uppercase', async () => {
      const expectedResponse = { success: true };
      mockClient.mockResponse('create_user', expectedResponse);

      const result = await mockClient.send('CREATE_USER', { name: 'Jane' });

      expect(result).toEqual(expectedResponse);
    });

    it('should throw error if command is not mocked', async () => {
      await expect(mockClient.send('UNKNOWN_COMMAND', {})).rejects.toThrow(
        'No mock configured for command: UNKNOWN_COMMAND'
      );
    });

    it('should handle multiple different commands', async () => {
      mockClient.mockResponse('GET_USER', { id: 1, name: 'Alice' });
      mockClient.mockResponse('GET_ORDER', { orderId: 999, total: 100 });

      const user = await mockClient.send('GET_USER', { id: 1 });
      const order = await mockClient.send('GET_ORDER', { id: 999 });

      expect(user).toEqual({ id: 1, name: 'Alice' });
      expect(order).toEqual({ orderId: 999, total: 100 });
    });

    it('should override previous mock for same command', async () => {
      mockClient.mockResponse('GET_USER', { id: 1, name: 'First' });
      mockClient.mockResponse('GET_USER', { id: 1, name: 'Second' });

      const result = await mockClient.send('GET_USER', { id: 1 });

      expect(result).toEqual({ id: 1, name: 'Second' });
    });
  });

  describe('mockError', () => {
    it('should throw mocked error for configured command', async () => {
      const expectedError = new Error('User not found');
      mockClient.mockError('GET_USER', expectedError);

      await expect(mockClient.send('GET_USER', { id: 999 })).rejects.toThrow('User not found');
    });

    it('should throw ValidationError when configured', async () => {
      const validationError = ValidationError.invalidConfig('Invalid input');
      mockClient.mockError('CREATE_USER', validationError);

      await expect(mockClient.send('CREATE_USER', { name: '' })).rejects.toThrow(
        'Invalid input'
      );
    });

    it('should normalize command name to uppercase for errors', async () => {
      const error = new Error('Test error');
      mockClient.mockError('delete_user', error);

      await expect(mockClient.send('DELETE_USER', { id: 1 })).rejects.toThrow('Test error');
    });
  });

  describe('send', () => {
    it('should validate command is not empty', async () => {
      mockClient.mockResponse('TEST', { ok: true });

      await expect(mockClient.send('', {})).rejects.toThrow('Command must be a non-empty string');
    });

    it('should handle AbortSignal timeout', async () => {
      mockClient.mockResponse('SLOW_COMMAND', { result: 'done' });

      const controller = new AbortController();
      controller.abort();

      await expect(
        mockClient.send('SLOW_COMMAND', {}, { signal: controller.signal })
      ).rejects.toThrow('Request aborted');
    });

    it('should accept custom timeout option', async () => {
      mockClient.mockResponse('COMMAND', { success: true });

      const result = await mockClient.send('COMMAND', {}, { timeout: 5000 });

      expect(result).toEqual({ success: true });
    });

    it('should track call history with correct data', async () => {
      mockClient.mockResponse('GET_USER', { id: 1 });
      mockClient.mockResponse('GET_ORDER', { orderId: 2 });

      await mockClient.send('GET_USER', { id: 1 });
      await mockClient.send('GET_ORDER', { orderId: 2 });

      const history = mockClient.getCallHistory();

      expect(history).toHaveLength(2);
      expect(history[0].command).toBe('GET_USER');
      expect(history[0].data).toEqual({ id: 1 });
      expect(history[1].command).toBe('GET_ORDER');
      expect(history[1].data).toEqual({ orderId: 2 });
    });

    it('should track timestamps in call history', async () => {
      mockClient.mockResponse('TEST', { ok: true });

      const before = Date.now();
      await mockClient.send('TEST', {});
      const after = Date.now();

      const history = mockClient.getCallHistory();
      expect(history[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(history[0].timestamp).toBeLessThanOrEqual(after);
    });

    it('should track options in call history', async () => {
      mockClient.mockResponse('TEST', { ok: true });

      await mockClient.send('TEST', { data: 'test' }, { timeout: 3000 });

      const history = mockClient.getCallHistory();
      expect(history[0].options).toEqual({ timeout: 3000 });
    });

    it('should track custom correlationId in call history', async () => {
      mockClient.mockResponse('TEST', { ok: true });

      await mockClient.send('TEST', { data: 'test' }, { correlationId: 'trace-123' });

      const history = mockClient.getCallHistory();
      expect(history[0].options?.correlationId).toBe('trace-123');
    });

    it('should track correlationId with metadata and timeout', async () => {
      mockClient.mockResponse('CREATE_USER', { userId: 456 });

      await mockClient.send(
        'CREATE_USER',
        { name: 'John' },
        {
          correlationId: 'req-abc-123',
          metadata: { source: 'api', userId: '789' },
          timeout: 5000,
        }
      );

      const history = mockClient.getCallHistory();
      expect(history[0].options?.correlationId).toBe('req-abc-123');
      expect(history[0].options?.metadata).toEqual({ source: 'api', userId: '789' });
      expect(history[0].options?.timeout).toBe(5000);
    });
  });

  describe('getCallHistory', () => {
    it('should return empty array when no calls made', () => {
      expect(mockClient.getCallHistory()).toEqual([]);
    });

    it('should return all calls in order', async () => {
      mockClient.mockResponse('CMD1', { r: 1 });
      mockClient.mockResponse('CMD2', { r: 2 });
      mockClient.mockResponse('CMD3', { r: 3 });

      await mockClient.send('CMD1', {});
      await mockClient.send('CMD2', {});
      await mockClient.send('CMD3', {});

      const history = mockClient.getCallHistory();
      expect(history).toHaveLength(3);
      expect(history[0].command).toBe('CMD1');
      expect(history[1].command).toBe('CMD2');
      expect(history[2].command).toBe('CMD3');
    });

    it('should include failed calls in history', async () => {
      mockClient.mockResponse('SUCCESS', { ok: true });
      mockClient.mockError('FAILURE', new Error('Failed'));

      await mockClient.send('SUCCESS', {});
      await mockClient.send('FAILURE', {}).catch(() => {});

      const history = mockClient.getCallHistory();
      expect(history).toHaveLength(2);
      expect(history[1].command).toBe('FAILURE');
    });
  });

  describe('getCallsForCommand', () => {
    it('should return only calls for specified command', async () => {
      mockClient.mockResponse('GET_USER', { id: 1 });
      mockClient.mockResponse('GET_ORDER', { orderId: 1 });

      await mockClient.send('GET_USER', { id: 1 });
      await mockClient.send('GET_ORDER', { orderId: 1 });
      await mockClient.send('GET_USER', { id: 2 });

      const userCalls = mockClient.getCallsForCommand('GET_USER');

      expect(userCalls).toHaveLength(2);
      expect(userCalls[0].data).toEqual({ id: 1 });
      expect(userCalls[1].data).toEqual({ id: 2 });
    });

    it('should normalize command name', async () => {
      mockClient.mockResponse('TEST_CMD', { ok: true });

      await mockClient.send('test_cmd', {});

      const calls = mockClient.getCallsForCommand('TEST_CMD');
      expect(calls).toHaveLength(1);
    });

    it('should return empty array for command with no calls', () => {
      const calls = mockClient.getCallsForCommand('NEVER_CALLED');
      expect(calls).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should clear all call history', async () => {
      mockClient.mockResponse('TEST', { ok: true });

      await mockClient.send('TEST', {});
      expect(mockClient.getCallHistory()).toHaveLength(1);

      mockClient.clear();
      expect(mockClient.getCallHistory()).toEqual([]);
    });

    it('should clear all mocked responses', async () => {
      mockClient.mockResponse('CMD1', { ok: true });
      mockClient.mockResponse('CMD2', { ok: true });

      mockClient.clear();

      await expect(mockClient.send('CMD1', {})).rejects.toThrow();
      await expect(mockClient.send('CMD2', {})).rejects.toThrow();
    });

    it('should clear all mocked errors', async () => {
      mockClient.mockError('FAIL', new Error('Error'));

      mockClient.clear();

      await expect(mockClient.send('FAIL', {})).rejects.toThrow('No mock configured');
    });
  });

  describe('close', () => {
    it('should resolve without error', async () => {
      await expect(mockClient.close()).resolves.toBeUndefined();
    });

    it('should allow calling close multiple times', async () => {
      await mockClient.close();
      await expect(mockClient.close()).resolves.toBeUndefined();
    });
  });

  describe('type safety', () => {
    it('should maintain type safety for request/response', async () => {
      interface UserRequest {
        userId: number;
      }
      interface UserResponse {
        id: number;
        name: string;
      }

      mockClient.mockResponse('GET_USER', {
        id: 1,
        name: 'John',
      } as UserResponse);

      const response = await mockClient.send<UserRequest, UserResponse>('GET_USER', { userId: 1 });

      // TypeScript should enforce these types
      expect(response.id).toBe(1);
      expect(response.name).toBe('John');
    });
  });

  describe('integration scenarios', () => {
    it('should support unit testing user code', async () => {
      // Simulate testing a service that uses RpcClient
      mockClient.mockResponse('VALIDATE_USER', { valid: true, userId: 123 });
      mockClient.mockResponse('CREATE_SESSION', { sessionId: 'abc-123' });

      // User's service would call these
      const validationResult = await mockClient.send('VALIDATE_USER', {
        username: 'john',
        password: 'secret',
      });
      const sessionResult = await mockClient.send('CREATE_SESSION', {
        userId: validationResult.userId,
      });

      // Verify the calls were made correctly
      const calls = mockClient.getCallHistory();
      expect(calls).toHaveLength(2);
      expect(calls[0].command).toBe('VALIDATE_USER');
      expect(calls[1].data).toEqual({ userId: 123 });
      expect(sessionResult.sessionId).toBe('abc-123');
    });

    it('should support testing error handling', async () => {
      mockClient.mockError('RISKY_OPERATION', new Error('Database error'));

      let errorCaught = false;
      try {
        await mockClient.send('RISKY_OPERATION', {});
      } catch (error) {
        errorCaught = true;
        expect(error).toBeInstanceOf(Error);
      }

      expect(errorCaught).toBe(true);
      expect(mockClient.getCallHistory()).toHaveLength(1);
    });
  });
});
