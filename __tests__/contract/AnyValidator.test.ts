import { describe, it, expect } from 'vitest';
import { v } from '../../src/core/contract/validators';

describe('AnyValidator', () => {
  describe('Basic validation', () => {
    it('should accept any value', () => {
      const validator = v.any();

      expect(validator.validate('string').success).toBe(true);
      expect(validator.validate(42).success).toBe(true);
      expect(validator.validate(true).success).toBe(true);
      expect(validator.validate({}).success).toBe(true);
      expect(validator.validate([]).success).toBe(true);
      expect(validator.validate(new Date()).success).toBe(true);
      expect(validator.validate(0).success).toBe(true);
      expect(validator.validate(false).success).toBe(true);
      expect(validator.validate('').success).toBe(true);
    });

    it('should preserve the value', () => {
      const validator = v.any();
      
      const obj = { key: 'value' };
      const result = validator.validate(obj);
      
      expect(result.success).toBe(true);
      expect(result.data).toBe(obj);
    });
  });

  describe('Required/Optional', () => {
    it('should reject undefined by default', () => {
      const validator = v.any();
      const result = validator.validate(undefined);

      expect(result.success).toBe(false);
      expect(result.errors?.[0].message).toBe('Field is required');
    });

    it('should allow undefined when optional', () => {
      const validator = v.any().optional();
      const result = validator.validate(undefined);

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('should allow null when optional', () => {
      const validator = v.any().optional();
      const result = validator.validate(null);

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('should accept any value when optional', () => {
      const validator = v.any().optional();

      expect(validator.validate(undefined).success).toBe(true);
      expect(validator.validate('value').success).toBe(true);
      expect(validator.validate(123).success).toBe(true);
    });
  });

  describe('Usage in objects', () => {
    it('should work in object schema', () => {
      const validator = v.object({
        id: v.string(),
        data: v.any(),
        metadata: v.any().optional(),
      });

      const result = validator.validate({
        id: '123',
        data: { anything: 'goes', nested: { deep: true } },
        metadata: [1, 'two', { three: 3 }],
      });

      expect(result.success).toBe(true);
    });

    it('should accept any type for the field', () => {
      const validator = v.object({
        flexible: v.any(),
      });

      expect(validator.validate({ flexible: 'string' }).success).toBe(true);
      expect(validator.validate({ flexible: 123 }).success).toBe(true);
      expect(validator.validate({ flexible: true }).success).toBe(true);
      expect(validator.validate({ flexible: { nested: 'object' } }).success).toBe(true);
    });
  });

  describe('Use cases', () => {
    it('should work for dynamic API responses', () => {
      const validator = v.object({
        status: v.string(),
        data: v.any(), // Can be anything from the API
      });

      expect(validator.validate({
        status: 'success',
        data: { user: { name: 'John' } },
      }).success).toBe(true);

      expect(validator.validate({
        status: 'success',
        data: ['item1', 'item2'],
      }).success).toBe(true);
    });

    it('should work for flexible configuration', () => {
      const validator = v.object({
        name: v.string(),
        value: v.any(), // Can be string, number, object, etc.
      });

      expect(validator.validate({
        name: 'timeout',
        value: 5000,
      }).success).toBe(true);

      expect(validator.validate({
        name: 'config',
        value: { host: 'localhost', port: 3000 },
      }).success).toBe(true);
    });
  });
});
