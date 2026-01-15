import { describe, it, expect } from 'vitest';
import { v } from '../../src/core/contract/validators';

describe('StringValidator', () => {
  describe('basic validation', () => {
    it('should validate string', () => {
      const validator = v.string();
      const result = validator.validate('hello');

      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');
    });

    it('should reject non-string', () => {
      const validator = v.string();
      const result = validator.validate(123);

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([
        { path: [], message: 'Expected string' },
      ]);
    });

    it('should reject undefined by default (required)', () => {
      const validator = v.string();
      const result = validator.validate(undefined);

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([
        { path: [], message: 'Field is required' },
      ]);
    });

    it('should reject null by default (required)', () => {
      const validator = v.string();
      const result = validator.validate(null);

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([
        { path: [], message: 'Field is required' },
      ]);
    });
  });

  describe('.optional()', () => {
    it('should allow undefined when optional', () => {
      const validator = v.string().optional();
      const result = validator.validate(undefined);

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('should allow null when optional', () => {
      const validator = v.string().optional();
      const result = validator.validate(null);

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('should validate string when optional', () => {
      const validator = v.string().optional();
      const result = validator.validate('hello');

      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');
    });

    it('should reject non-string even when optional', () => {
      const validator = v.string().optional();
      const result = validator.validate(123);

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([
        { path: [], message: 'Expected string' },
      ]);
    });
  });

  describe('.required()', () => {
    it('should make field required again after optional', () => {
      const validator = v.string().optional().required();
      const result = validator.validate(undefined);

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([
        { path: [], message: 'Field is required' },
      ]);
    });

    it('should validate string when required', () => {
      const validator = v.string().optional().required();
      const result = validator.validate('hello');

      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');
    });
  });

  describe('.min()', () => {
    it('should validate string with minimum length', () => {
      const validator = v.string().min(3);
      const result = validator.validate('hello');

      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');
    });

    it('should reject string shorter than minimum', () => {
      const validator = v.string().min(5);
      const result = validator.validate('hi');

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([
        { path: [], message: 'String must be at least 5 characters' },
      ]);
    });

    it('should accept string equal to minimum', () => {
      const validator = v.string().min(5);
      const result = validator.validate('hello');

      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');
    });

    it('should use singular form for min(1)', () => {
      const validator = v.string().min(1);
      const result = validator.validate('');

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([
        { path: [], message: 'String must be at least 1 character' },
      ]);
    });
  });

  describe('.max()', () => {
    it('should validate string with maximum length', () => {
      const validator = v.string().max(10);
      const result = validator.validate('hello');

      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');
    });

    it('should reject string longer than maximum', () => {
      const validator = v.string().max(3);
      const result = validator.validate('hello');

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([
        { path: [], message: 'String must be at most 3 characters' },
      ]);
    });

    it('should accept string equal to maximum', () => {
      const validator = v.string().max(5);
      const result = validator.validate('hello');

      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');
    });
  });

  describe('.min().max()', () => {
    it('should validate string within range', () => {
      const validator = v.string().min(2).max(10);
      const result = validator.validate('hello');

      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');
    });

    it('should reject string shorter than min', () => {
      const validator = v.string().min(3).max(10);
      const result = validator.validate('hi');

      expect(result.success).toBe(false);
      expect(result.errors?.[0].message).toContain('at least 3');
    });

    it('should reject string longer than max', () => {
      const validator = v.string().min(2).max(5);
      const result = validator.validate('hello world');

      expect(result.success).toBe(false);
      expect(result.errors?.[0].message).toContain('at most 5');
    });
  });

  describe('.email()', () => {
    it('should validate valid email', () => {
      const validator = v.string().email();
      const result = validator.validate('user@example.com');

      expect(result.success).toBe(true);
      expect(result.data).toBe('user@example.com');
    });

    it('should reject invalid email format', () => {
      const validator = v.string().email();
      const result = validator.validate('not-an-email');

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([
        { path: [], message: 'Invalid email format' },
      ]);
    });

    it('should reject email without @', () => {
      const validator = v.string().email();
      const result = validator.validate('user.example.com');

      expect(result.success).toBe(false);
    });

    it('should reject email without domain', () => {
      const validator = v.string().email();
      const result = validator.validate('user@');

      expect(result.success).toBe(false);
    });
  });

  describe('.uuid()', () => {
    it('should validate valid UUID v4', () => {
      const validator = v.string().uuid();
      const result = validator.validate('550e8400-e29b-41d4-a716-446655440000');

      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID format', () => {
      const validator = v.string().uuid();
      const result = validator.validate('not-a-uuid');

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([
        { path: [], message: 'Invalid UUID format' },
      ]);
    });

    it('should reject UUID with wrong structure', () => {
      const validator = v.string().uuid();
      const result = validator.validate('550e8400-e29b-41d4-a716');

      expect(result.success).toBe(false);
    });
  });

  describe('.mongoId()', () => {
    it('should validate valid MongoDB ObjectId', () => {
      const validator = v.string().mongoId();
      const result = validator.validate('507f1f77bcf86cd799439011');

      expect(result.success).toBe(true);
    });

    it('should reject invalid MongoDB ObjectId', () => {
      const validator = v.string().mongoId();
      const result = validator.validate('not-a-mongo-id');

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([
        { path: [], message: 'Invalid MongoDB ObjectId' },
      ]);
    });

    it('should reject ObjectId with wrong length', () => {
      const validator = v.string().mongoId();
      const result = validator.validate('507f1f77bcf86cd7');

      expect(result.success).toBe(false);
    });
  });

  describe('chaining', () => {
    it('should chain min and email', () => {
      const validator = v.string().min(5).email();
      const result = validator.validate('a@b.c');

      expect(result.success).toBe(true);
    });

    it('should fail on min when chained with email', () => {
      const validator = v.string().min(20).email();
      const result = validator.validate('user@example.com');

      expect(result.success).toBe(false);
      expect(result.errors?.[0].message).toContain('at least 20');
    });

    it('should chain optional with email', () => {
      const validator = v.string().optional().email();

      const result1 = validator.validate(undefined);
      expect(result1.success).toBe(true);

      const result2 = validator.validate('user@example.com');
      expect(result2.success).toBe(true);

      const result3 = validator.validate('invalid');
      expect(result3.success).toBe(false);
    });

    it('should chain min, max, and uuid', () => {
      const validator = v.string().min(36).max(36).uuid();
      const result = validator.validate('550e8400-e29b-41d4-a716-446655440000');

      expect(result.success).toBe(true);
    });
  });

  describe('TypeScript type inference', () => {
    it('should infer string type for required', () => {
      const validator = v.string();
      const result = validator.validate('hello');

      if (result.success) {
        // TypeScript should infer result.data as string
        const value: string = result.data!;
        expect(typeof value).toBe('string');
      }
    });

    it('should infer string | undefined for optional', () => {
      const validator = v.string().optional();
      const result = validator.validate(undefined);

      if (result.success) {
        // TypeScript should infer result.data as string | undefined
        const value: string | undefined = result.data;
        expect(value).toBeUndefined();
      }
    });
  });
});
