import { describe, it, expect } from 'vitest';
import { v } from '../../src/core/contract/validators';

describe('ObjectValidator', () => {
  describe('Basic validation', () => {
    it('should validate a valid object', () => {
      const validator = v.object({
        name: v.string(),
        age: v.number(),
      });

      const result = validator.validate({ name: 'John', age: 30 });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'John', age: 30 });
    });

    it('should reject non-object values', () => {
      const validator = v.object({ name: v.string() });

      expect(validator.validate('not an object').success).toBe(false);
      expect(validator.validate(42).success).toBe(false);
      expect(validator.validate(true).success).toBe(false);
      expect(validator.validate([]).success).toBe(false);
    });

    it('should reject arrays', () => {
      const validator = v.object({ name: v.string() });
      const result = validator.validate([1, 2, 3]);

      expect(result.success).toBe(false);
      expect(result.errors?.[0].message).toBe('Expected object');
    });
  });

  describe('Generic object (no schema)', () => {
    it('should validate any object when no schema is provided', () => {
      const validator = v.object();

      expect(validator.validate({}).success).toBe(true);
      expect(validator.validate({ name: 'John' }).success).toBe(true);
      expect(validator.validate({ id: 1, data: 'test', active: true }).success).toBe(true);
    });

    it('should accept objects with any structure', () => {
      const validator = v.object();
      const result = validator.validate({
        string: 'value',
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        nested: { key: 'value' },
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        string: 'value',
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        nested: { key: 'value' },
      });
    });

    it('should reject non-object values', () => {
      const validator = v.object();

      expect(validator.validate('not an object').success).toBe(false);
      expect(validator.validate(42).success).toBe(false);
      expect(validator.validate([]).success).toBe(false);
      expect(validator.validate(true).success).toBe(false);
    });

    it('should support optional generic objects', () => {
      const validator = v.object().optional();

      expect(validator.validate(undefined).success).toBe(true);
      expect(validator.validate({ any: 'data' }).success).toBe(true);
    });

    it('should accept empty objects', () => {
      const validator = v.object();
      const result = validator.validate({});

      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
    });
  });

  describe('Required/Optional', () => {
    it('should require value by default', () => {
      const validator = v.object({ name: v.string() });

      expect(validator.validate(undefined).success).toBe(false);
      expect(validator.validate(null).success).toBe(false);
    });

    it('should allow undefined when optional', () => {
      const validator = v.object({ name: v.string() }).optional();
      const result = validator.validate(undefined);

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('should validate object when provided even if optional', () => {
      const validator = v.object({ name: v.string() }).optional();
      const result = validator.validate({ name: 'John' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'John' });
    });
  });

  describe('Nested field validation', () => {
    it('should validate all fields', () => {
      const validator = v.object({
        name: v.string().min(2),
        age: v.number().min(0),
        email: v.string().email(),
      });

      const result = validator.validate({
        name: 'John',
        age: 30,
        email: 'john@example.com',
      });

      expect(result.success).toBe(true);
    });

    it('should fail if any field is invalid', () => {
      const validator = v.object({
        name: v.string().min(2),
        age: v.number().min(0),
      });

      const result = validator.validate({
        name: 'J', // too short
        age: 30,
      });

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0].path).toEqual(['name']);
    });

    it('should report multiple field errors', () => {
      const validator = v.object({
        name: v.string().min(2),
        age: v.number().min(0),
      });

      const result = validator.validate({
        name: 'J', // too short
        age: -5, // negative
      });

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('Optional fields in object', () => {
    it('should handle optional fields', () => {
      const validator = v.object({
        name: v.string(),
        age: v.number().optional(),
      });

      const result1 = validator.validate({ name: 'John' });
      expect(result1.success).toBe(true);

      const result2 = validator.validate({ name: 'John', age: 30 });
      expect(result2.success).toBe(true);
    });

    it('should validate optional field when provided', () => {
      const validator = v.object({
        name: v.string(),
        age: v.number().min(0).optional(),
      });

      const result = validator.validate({ name: 'John', age: -5 });
      expect(result.success).toBe(false);
    });
  });

  describe('Nested objects', () => {
    it('should validate nested objects', () => {
      const validator = v.object({
        name: v.string(),
        address: v.object({
          street: v.string(),
          city: v.string(),
        }),
      });

      const result = validator.validate({
        name: 'John',
        address: {
          street: '123 Main St',
          city: 'New York',
        },
      });

      expect(result.success).toBe(true);
    });

    it('should report nested field errors with path', () => {
      const validator = v.object({
        name: v.string(),
        address: v.object({
          street: v.string().min(5),
          city: v.string(),
        }),
      });

      const result = validator.validate({
        name: 'John',
        address: {
          street: '123', // too short
          city: 'NYC',
        },
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0].path).toEqual(['address', 'street']);
    });
  });

  describe('Complex schemas', () => {
    it('should handle complex nested structures', () => {
      const validator = v.object({
        user: v.object({
          id: v.string().uuid(),
          profile: v.object({
            name: v.string().min(2),
            age: v.number().min(0).max(150),
          }),
        }),
        tags: v.array(v.string()),
      });

      const result = validator.validate({
        user: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          profile: {
            name: 'John',
            age: 30,
          },
        },
        tags: ['developer', 'nodejs'],
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Error messages', () => {
    it('should provide clear error for type mismatch', () => {
      const validator = v.object({ name: v.string() });
      const result = validator.validate('not an object');

      expect(result.errors?.[0].message).toBe('Expected object');
    });

    it('should provide clear error for required field', () => {
      const validator = v.object({ name: v.string() });
      const result = validator.validate(undefined);

      expect(result.errors?.[0].message).toBe('Field is required');
    });

    it('should include field path in errors', () => {
      const validator = v.object({
        name: v.string().min(2),
      });
      const result = validator.validate({ name: 'J' });

      expect(result.errors?.[0].path).toEqual(['name']);
    });
  });
});
