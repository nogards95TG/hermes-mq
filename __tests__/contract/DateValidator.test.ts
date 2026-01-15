import { describe, it, expect } from 'vitest';
import { v } from '../../src/core/contract/validators';

describe('DateValidator', () => {
  describe('Basic validation', () => {
    it('should validate a Date object', () => {
      const validator = v.date();
      const date = new Date('2024-01-15');
      const result = validator.validate(date);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(date);
    });

    it('should validate an ISO date string', () => {
      const validator = v.date();
      const result = validator.validate('2024-01-15T10:30:00Z');

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Date);
    });

    it('should validate a timestamp', () => {
      const validator = v.date();
      const timestamp = Date.now();
      const result = validator.validate(timestamp);

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Date);
    });

    it('should reject invalid date strings', () => {
      const validator = v.date();

      expect(validator.validate('not a date').success).toBe(false);
      expect(validator.validate('2024-13-45').success).toBe(false);
    });

    it('should reject invalid Date objects', () => {
      const validator = v.date();
      const result = validator.validate(new Date('invalid'));

      expect(result.success).toBe(false);
      expect(result.errors?.[0].message).toBe('Invalid date');
    });

    it('should reject non-date values', () => {
      const validator = v.date();

      expect(validator.validate(true).success).toBe(false);
      expect(validator.validate({}).success).toBe(false);
      expect(validator.validate([]).success).toBe(false);
    });
  });

  describe('Required/Optional', () => {
    it('should require value by default', () => {
      const validator = v.date();

      expect(validator.validate(undefined).success).toBe(false);
      expect(validator.validate(null).success).toBe(false);
    });

    it('should allow undefined when optional', () => {
      const validator = v.date().optional();
      const result = validator.validate(undefined);

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('should validate date when optional', () => {
      const validator = v.date().optional();
      const date = new Date('2024-01-15');
      const result = validator.validate(date);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(date);
    });
  });

  describe('Min/Max validation', () => {
    it('should enforce minimum date', () => {
      const minDate = new Date('2024-01-01');
      const validator = v.date().min(minDate);

      expect(validator.validate(new Date('2023-12-31')).success).toBe(false);
      expect(validator.validate(new Date('2024-01-01')).success).toBe(true);
      expect(validator.validate(new Date('2024-01-02')).success).toBe(true);
    });

    it('should enforce maximum date', () => {
      const maxDate = new Date('2024-12-31');
      const validator = v.date().max(maxDate);

      expect(validator.validate(new Date('2024-12-30')).success).toBe(true);
      expect(validator.validate(new Date('2024-12-31')).success).toBe(true);
      expect(validator.validate(new Date('2025-01-01')).success).toBe(false);
    });

    it('should enforce date range', () => {
      const validator = v.date()
        .min(new Date('2024-01-01'))
        .max(new Date('2024-12-31'));

      expect(validator.validate(new Date('2023-12-31')).success).toBe(false);
      expect(validator.validate(new Date('2024-06-15')).success).toBe(true);
      expect(validator.validate(new Date('2025-01-01')).success).toBe(false);
    });

    it('should accept string dates for min/max', () => {
      const validator = v.date().min('2024-01-01').max('2024-12-31');

      expect(validator.validate(new Date('2024-06-15')).success).toBe(true);
    });

    it('should accept timestamp for min/max', () => {
      const minTimestamp = new Date('2024-01-01').getTime();
      const maxTimestamp = new Date('2024-12-31').getTime();
      const validator = v.date().min(minTimestamp).max(maxTimestamp);

      expect(validator.validate(new Date('2024-06-15')).success).toBe(true);
    });
  });

  describe('Strict mode', () => {
    it('should only accept Date objects in strict mode', () => {
      const validator = v.date().strict();

      expect(validator.validate(new Date()).success).toBe(true);
      expect(validator.validate('2024-01-15T10:30:00Z').success).toBe(false);
      expect(validator.validate(Date.now()).success).toBe(false);
    });

    it('should provide appropriate error message in strict mode', () => {
      const validator = v.date().strict();
      const result = validator.validate('2024-01-15');

      expect(result.success).toBe(false);
      expect(result.errors?.[0].message).toBe('Expected Date object');
    });
  });

  describe('Error messages', () => {
    it('should provide clear error for invalid date string', () => {
      const validator = v.date();
      const result = validator.validate('invalid');

      expect(result.errors?.[0].message).toBe('Invalid date string');
    });

    it('should provide clear error for required field', () => {
      const validator = v.date();
      const result = validator.validate(undefined);

      expect(result.errors?.[0].message).toBe('Field is required');
    });

    it('should provide clear error for min validation', () => {
      const minDate = new Date('2024-01-01');
      const validator = v.date().min(minDate);
      const result = validator.validate(new Date('2023-12-31'));

      expect(result.errors?.[0].message).toContain('must be after');
      expect(result.errors?.[0].message).toContain('2024-01-01');
    });

    it('should provide clear error for max validation', () => {
      const maxDate = new Date('2024-12-31');
      const validator = v.date().max(maxDate);
      const result = validator.validate(new Date('2025-01-01'));

      expect(result.errors?.[0].message).toContain('must be before');
      expect(result.errors?.[0].message).toContain('2024-12-31');
    });
  });

  describe('Usage in objects', () => {
    it('should work in object schema', () => {
      const validator = v.object({
        createdAt: v.date(),
        updatedAt: v.date().optional(),
      });

      const now = new Date();
      const result = validator.validate({
        createdAt: now,
        updatedAt: now,
      });

      expect(result.success).toBe(true);
    });

    it('should accept ISO strings in object', () => {
      const validator = v.object({
        createdAt: v.date(),
      });

      const result = validator.validate({
        createdAt: '2024-01-15T10:30:00Z',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Chaining validations', () => {
    it('should chain multiple validations', () => {
      const validator = v.date()
        .min(new Date('2024-01-01'))
        .max(new Date('2024-12-31'))
        .optional();

      expect(validator.validate(undefined).success).toBe(true);
      expect(validator.validate(new Date('2024-06-15')).success).toBe(true);
      expect(validator.validate(new Date('2023-12-31')).success).toBe(false);
    });
  });
});
