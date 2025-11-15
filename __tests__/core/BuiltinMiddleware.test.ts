import { describe, it, expect } from 'vitest';
import { validate, validateAdapter, retry, createContext } from '../../src/middleware';
import { SilentLogger } from '../../src/core';

describe('Built-in Middleware', () => {
  describe('validate middleware', () => {
    describe('with Zod schema (auto-detection)', () => {
      it('should validate and pass with valid payload', async () => {
        // Mock Zod-like schema
        const schema = {
          safeParse: (data: any) => ({
            success: true,
            data: { ...data, validated: true },
          }),
        };

        const validateMw = validate(schema);
        const next = async () => ({ success: 'next called' });

        const ctx = createContext('TEST', { a: 5, b: 3 }, {}, new SilentLogger());
        const result = await validateMw(ctx, next);

        expect(result).toEqual({ success: 'next called' });
        expect(ctx.payload).toEqual({ a: 5, b: 3, validated: true });
      });

      it('should return error response on invalid payload', async () => {
        const schema = {
          safeParse: (data: any) => ({
            success: false,
            error: { errors: ['a is required'] },
          }),
        };

        const validateMw = validate(schema);
        const next = async () => {
          throw new Error('Should not be called');
        };

        const ctx = createContext('TEST', {}, {}, new SilentLogger());
        const result = await validateMw(ctx, next);

        expect(result).toEqual({
          error: 'ValidationError',
          details: ['a is required'],
        });
      });
    });

    describe('with Yup schema (auto-detection)', () => {
      it('should validate and pass with valid payload', async () => {
        // Mock Yup-like schema
        const schema = {
          validate: async (data: any) => ({ ...data, validated: true }),
          validateSync: (data: any) => ({ ...data, validated: true }),
        };

        const validateMw = validate(schema);
        const next = async () => ({ success: 'next called' });

        const ctx = createContext('TEST', { name: 'test' }, {}, new SilentLogger());
        const result = await validateMw(ctx, next);

        expect(result).toEqual({ success: 'next called' });
        expect(ctx.payload).toEqual({ name: 'test', validated: true });
      });

      it('should return error on Yup validation failure', async () => {
        const schema = {
          validate: async () => {
            const error = new Error('Validation failed');
            (error as any).errors = ['name is required'];
            throw error;
          },
          validateSync: () => {},
        };

        const validateMw = validate(schema);
        const next = async () => {
          throw new Error('Should not be called');
        };

        const ctx = createContext('TEST', {}, {}, new SilentLogger());
        const result = await validateMw(ctx, next);

        expect(result).toEqual({
          error: 'ValidationError',
          details: ['name is required'],
        });
      });
    });

    describe('with custom adapter', () => {
      it('should use custom adapter', async () => {
        const adapter = validateAdapter('custom', (payload) => {
          if (payload.id) {
            return { success: true, value: payload };
          }
          return { success: false, errors: ['id is required'] };
        });

        const validateMw = validate(adapter);
        const next = async () => 'success';

        const ctx = createContext('TEST', { id: 123 }, {}, new SilentLogger());
        const result = await validateMw(ctx, next);

        expect(result).toBe('success');
      });

      it('should handle async custom adapter', async () => {
        const adapter = validateAdapter('async', async (payload) => {
          // Simulate async validation
          await new Promise((resolve) => setTimeout(resolve, 10));
          if (payload.email?.includes('@')) {
            return { success: true, value: payload };
          }
          return { success: false, errors: ['invalid email'] };
        });

        const validateMw = validate(adapter);
        const next = async () => 'success';

        const ctx = createContext('TEST', { email: 'test@example.com' }, {}, new SilentLogger());
        const result = await validateMw(ctx, next);

        expect(result).toBe('success');
      });
    });

    it('should throw on invalid schema/adapter', () => {
      const invalidSchema = { foo: 'bar' };

      expect(() => {
        validate(invalidSchema);
      }).toThrow();
    });
  });

  describe('retry middleware', () => {
    it('should inject retry policy into context meta', async () => {
      const retryMw = retry({
        maxAttempts: 5,
        backoffStrategy: 'exponential',
        backoffDelay: 1000,
      });

      const next = async () => 'success';

      const ctx = createContext('TEST', {}, {}, new SilentLogger());
      const result = await retryMw(ctx, next);

      expect(result).toBe('success');
      expect(ctx.meta.retryPolicy).toEqual({
        maxAttempts: 5,
        backoffStrategy: 'exponential',
        backoffDelay: 1000,
        requeueOnFail: true,
      });
    });

    it('should use default values for retry policy', async () => {
      const retryMw = retry({});

      const next = async () => 'success';

      const ctx = createContext('TEST', {}, {}, new SilentLogger());
      await retryMw(ctx, next);

      expect(ctx.meta.retryPolicy).toEqual({
        maxAttempts: undefined,
        backoffStrategy: 'fixed',
        backoffDelay: 1000,
        requeueOnFail: true,
      });
    });

    it('should allow requeueOnFail to be false', async () => {
      const retryMw = retry({
        maxAttempts: 3,
        requeueOnFail: false,
      });

      const next = async () => 'success';

      const ctx = createContext('TEST', {}, {}, new SilentLogger());
      await retryMw(ctx, next);

      expect(ctx.meta.retryPolicy.requeueOnFail).toBe(false);
    });

    it('should call next middleware', async () => {
      const retryMw = retry({ maxAttempts: 3 });
      let nextCalled = false;

      const next = async () => {
        nextCalled = true;
        return 'handler_result';
      };

      const ctx = createContext('TEST', {}, {}, new SilentLogger());
      const result = await retryMw(ctx, next);

      expect(nextCalled).toBe(true);
      expect(result).toBe('handler_result');
    });
  });

  describe('middleware integration', () => {
    it('should work together - validate then retry', async () => {
      const schema = {
        safeParse: (data: any) => ({
          success: data.value !== undefined,
          data: data,
          error: data.value === undefined ? { errors: ['value required'] } : null,
        }),
      };

      const validateMw = validate(schema);
      const retryMw = retry({ maxAttempts: 3 });

      let validationPassed = false;
      let retryPolicySet = false;

      const handler = (payload: any, ctx: any) => {
        validationPassed = !!ctx.payload;
        retryPolicySet = !!ctx.meta.retryPolicy;
        return { success: true };
      };

      // Simulate middleware chain
      const ctx = createContext('TEST', { value: 42 }, {}, new SilentLogger());

      // Apply validate
      await validateMw(ctx, async () => {
        // Apply retry
        await retryMw(ctx, async () => {
          handler(ctx.payload, ctx);
        });
      });

      expect(validationPassed).toBe(true);
      expect(retryPolicySet).toBe(true);
    });
  });
});
