import { describe, it, expect } from 'vitest';
import { v } from '../../src/core/contract/validators';

describe('BooleanValidator', () => {
  describe('Basic validation', () => {
    it('should validate true', () => {
      const validator = v.boolean();
      const result = validator.validate(true);

      expect(result.success).toBe(true);
      expect(result.data).toBe(true);
    });

    it('should validate false', () => {
      const validator = v.boolean();
      const result = validator.validate(false);

      expect(result.success).toBe(true);
      expect(result.data).toBe(false);
    });

    it('should reject non-boolean values', () => {
      const validator = v.boolean();

      expect(validator.validate(0).success).toBe(false);
      expect(validator.validate(1).success).toBe(false);
      expect(validator.validate('true').success).toBe(false);
      expect(validator.validate('false').success).toBe(false);
      expect(validator.validate({}).success).toBe(false);
      expect(validator.validate([]).success).toBe(false);
    });
  });

  describe('Required/Optional', () => {
    it('should require value by default', () => {
      const validator = v.boolean();

      expect(validator.validate(undefined).success).toBe(false);
      expect(validator.validate(null).success).toBe(false);
    });

    it('should allow undefined when optional', () => {
      const validator = v.boolean().optional();
      const result = validator.validate(undefined);

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('should allow null when optional', () => {
      const validator = v.boolean().optional();
      const result = validator.validate(null);

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('should validate boolean when optional', () => {
      const validator = v.boolean().optional();

      expect(validator.validate(true).success).toBe(true);
      expect(validator.validate(false).success).toBe(true);
    });

    it('should make optional field required again', () => {
      const validator = v.boolean().optional().required();

      expect(validator.validate(undefined).success).toBe(false);
      expect(validator.validate(true).success).toBe(true);
    });
  });

  describe('Error messages', () => {
    it('should provide clear error for type mismatch', () => {
      const validator = v.boolean();
      const result = validator.validate('not a boolean');

      expect(result.errors?.[0].message).toBe('Expected boolean');
    });

    it('should provide clear error for required field', () => {
      const validator = v.boolean();
      const result = validator.validate(undefined);

      expect(result.errors?.[0].message).toBe('Field is required');
    });
  });

  describe('Usage in objects', () => {
    it('should work in object schema', () => {
      const validator = v.object({
        active: v.boolean(),
        verified: v.boolean().optional(),
      });

      const result = validator.validate({
        active: true,
        verified: false,
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        active: true,
        verified: false,
      });
    });

    it('should validate optional boolean in object', () => {
      const validator = v.object({
        active: v.boolean(),
        verified: v.boolean().optional(),
      });

      const result = validator.validate({
        active: true,
      });

      expect(result.success).toBe(true);
    });
  });
});
