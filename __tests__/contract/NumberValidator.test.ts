import { describe, it, expect } from 'vitest';
import { NumberValidator } from '../../src/core/contract/NumberValidator';

describe('NumberValidator', () => {
  describe('Basic validation', () => {
    it('should validate a valid number', () => {
      const validator = new NumberValidator();
      const result = validator.validate(42);

      expect(result.success).toBe(true);
      expect(result.data).toBe(42);
    });

    it('should reject non-number values', () => {
      const validator = new NumberValidator();

      expect(validator.validate('42').success).toBe(false);
      expect(validator.validate(true).success).toBe(false);
      expect(validator.validate({}).success).toBe(false);
      expect(validator.validate([]).success).toBe(false);
    });

    it('should reject NaN', () => {
      const validator = new NumberValidator();
      const result = validator.validate(NaN);

      expect(result.success).toBe(false);
      expect(result.errors?.[0].message).toBe('Expected number');
    });

    it('should accept zero', () => {
      const validator = new NumberValidator();
      const result = validator.validate(0);

      expect(result.success).toBe(true);
      expect(result.data).toBe(0);
    });

    it('should accept negative numbers', () => {
      const validator = new NumberValidator();
      const result = validator.validate(-42);

      expect(result.success).toBe(true);
      expect(result.data).toBe(-42);
    });

    it('should accept decimals', () => {
      const validator = new NumberValidator();
      const result = validator.validate(3.14);

      expect(result.success).toBe(true);
      expect(result.data).toBe(3.14);
    });
  });

  describe('Required/Optional', () => {
    it('should require value by default', () => {
      const validator = new NumberValidator();

      expect(validator.validate(undefined).success).toBe(false);
      expect(validator.validate(null).success).toBe(false);
    });

    it('should allow undefined when optional', () => {
      const validator = new NumberValidator().optional();
      const result = validator.validate(undefined);

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('should allow null when optional', () => {
      const validator = new NumberValidator().optional();
      const result = validator.validate(null);

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('should make optional field required again', () => {
      const validator = new NumberValidator().optional().required();

      expect(validator.validate(undefined).success).toBe(false);
      expect(validator.validate(42).success).toBe(true);
    });
  });

  describe('Min validation', () => {
    it('should enforce minimum value', () => {
      const validator = new NumberValidator().min(10);

      expect(validator.validate(9).success).toBe(false);
      expect(validator.validate(10).success).toBe(true);
      expect(validator.validate(11).success).toBe(true);
    });

    it('should work with negative minimums', () => {
      const validator = new NumberValidator().min(-10);

      expect(validator.validate(-11).success).toBe(false);
      expect(validator.validate(-10).success).toBe(true);
      expect(validator.validate(-9).success).toBe(true);
    });

    it('should work with decimal minimums', () => {
      const validator = new NumberValidator().min(3.14);

      expect(validator.validate(3.13).success).toBe(false);
      expect(validator.validate(3.14).success).toBe(true);
      expect(validator.validate(3.15).success).toBe(true);
    });
  });

  describe('Max validation', () => {
    it('should enforce maximum value', () => {
      const validator = new NumberValidator().max(100);

      expect(validator.validate(99).success).toBe(true);
      expect(validator.validate(100).success).toBe(true);
      expect(validator.validate(101).success).toBe(false);
    });

    it('should work with negative maximums', () => {
      const validator = new NumberValidator().max(-10);

      expect(validator.validate(-9).success).toBe(false);
      expect(validator.validate(-10).success).toBe(true);
      expect(validator.validate(-11).success).toBe(true);
    });
  });

  describe('Min and Max together', () => {
    it('should enforce range', () => {
      const validator = new NumberValidator().min(0).max(100);

      expect(validator.validate(-1).success).toBe(false);
      expect(validator.validate(0).success).toBe(true);
      expect(validator.validate(50).success).toBe(true);
      expect(validator.validate(100).success).toBe(true);
      expect(validator.validate(101).success).toBe(false);
    });
  });

  describe('Integer validation', () => {
    it('should accept integers', () => {
      const validator = new NumberValidator().integer();

      expect(validator.validate(0).success).toBe(true);
      expect(validator.validate(42).success).toBe(true);
      expect(validator.validate(-42).success).toBe(true);
    });

    it('should reject decimals', () => {
      const validator = new NumberValidator().integer();
      const result = validator.validate(3.14);

      expect(result.success).toBe(false);
      expect(result.errors?.[0].message).toBe('Must be an integer');
    });
  });

  describe('Positive validation', () => {
    it('should accept positive numbers', () => {
      const validator = new NumberValidator().positive();

      expect(validator.validate(0.1).success).toBe(true);
      expect(validator.validate(1).success).toBe(true);
      expect(validator.validate(42).success).toBe(true);
    });

    it('should reject zero and negative numbers', () => {
      const validator = new NumberValidator().positive();

      expect(validator.validate(0).success).toBe(false);
      expect(validator.validate(-1).success).toBe(false);
      expect(validator.validate(-42).success).toBe(false);
    });
  });

  describe('Negative validation', () => {
    it('should accept negative numbers', () => {
      const validator = new NumberValidator().negative();

      expect(validator.validate(-0.1).success).toBe(true);
      expect(validator.validate(-1).success).toBe(true);
      expect(validator.validate(-42).success).toBe(true);
    });

    it('should reject zero and positive numbers', () => {
      const validator = new NumberValidator().negative();

      expect(validator.validate(0).success).toBe(false);
      expect(validator.validate(1).success).toBe(false);
      expect(validator.validate(42).success).toBe(false);
    });
  });

  describe('Chaining validations', () => {
    it('should chain multiple validations', () => {
      const validator = new NumberValidator().min(0).max(100).integer();

      expect(validator.validate(-1).success).toBe(false);
      expect(validator.validate(0).success).toBe(true);
      expect(validator.validate(50).success).toBe(true);
      expect(validator.validate(50.5).success).toBe(false);
      expect(validator.validate(100).success).toBe(true);
      expect(validator.validate(101).success).toBe(false);
    });

    it('should preserve validations through optional/required', () => {
      const validator = new NumberValidator().min(10).optional();

      expect(validator.validate(undefined).success).toBe(true);
      expect(validator.validate(5).success).toBe(false);
      expect(validator.validate(15).success).toBe(true);
    });
  });

  describe('Error messages', () => {
    it('should provide clear error for type mismatch', () => {
      const validator = new NumberValidator();
      const result = validator.validate('not a number');

      expect(result.errors?.[0].message).toBe('Expected number');
    });

    it('should provide clear error for required field', () => {
      const validator = new NumberValidator();
      const result = validator.validate(undefined);

      expect(result.errors?.[0].message).toBe('Field is required');
    });

    it('should provide clear error for min validation', () => {
      const validator = new NumberValidator().min(10);
      const result = validator.validate(5);

      expect(result.errors?.[0].message).toBe('Must be at least 10');
    });

    it('should provide clear error for max validation', () => {
      const validator = new NumberValidator().max(100);
      const result = validator.validate(150);

      expect(result.errors?.[0].message).toBe('Must be at most 100');
    });

    it('should provide clear error for integer validation', () => {
      const validator = new NumberValidator().integer();
      const result = validator.validate(3.14);

      expect(result.errors?.[0].message).toBe('Must be an integer');
    });

    it('should provide clear error for positive validation', () => {
      const validator = new NumberValidator().positive();
      const result = validator.validate(-5);

      expect(result.errors?.[0].message).toBe('Must be positive');
    });

    it('should provide clear error for negative validation', () => {
      const validator = new NumberValidator().negative();
      const result = validator.validate(5);

      expect(result.errors?.[0].message).toBe('Must be negative');
    });
  });
});
