import { describe, it, expect } from 'vitest';
import { v } from '../../src/core/contract/validators';

describe('ArrayValidator', () => {
  describe('Basic validation', () => {
    it('should validate a valid array', () => {
      const validator = v.array(v.string());
      const result = validator.validate(['a', 'b', 'c']);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(['a', 'b', 'c']);
    });

    it('should validate an empty array', () => {
      const validator = v.array(v.string());
      const result = validator.validate([]);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('should reject non-array values', () => {
      const validator = v.array(v.string());

      expect(validator.validate('not an array').success).toBe(false);
      expect(validator.validate(42).success).toBe(false);
      expect(validator.validate({}).success).toBe(false);
      expect(validator.validate(true).success).toBe(false);
    });
  });

  describe('Array without item type (any array)', () => {
    it('should validate any array when no item validator is provided', () => {
      const validator = v.array();

      expect(validator.validate([]).success).toBe(true);
      expect(validator.validate([1, 2, 3]).success).toBe(true);
      expect(validator.validate(['a', 'b']).success).toBe(true);
      expect(validator.validate([1, 'a', true, {}]).success).toBe(true);
    });

    it('should accept arrays with mixed types', () => {
      const validator = v.array();
      const result = validator.validate([1, 'string', true, { key: 'value' }, [1, 2]]);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([1, 'string', true, { key: 'value' }, [1, 2]]);
    });

    it('should reject non-array values', () => {
      const validator = v.array();

      expect(validator.validate('not an array').success).toBe(false);
      expect(validator.validate(42).success).toBe(false);
      expect(validator.validate({}).success).toBe(false);
    });

    it('should support min/max on untyped arrays', () => {
      const validator = v.array().min(2).max(5);

      expect(validator.validate([1]).success).toBe(false);
      expect(validator.validate([1, 2]).success).toBe(true);
      expect(validator.validate([1, 'a', true]).success).toBe(true);
      expect(validator.validate([1, 2, 3, 4, 5, 6]).success).toBe(false);
    });

    it('should support optional untyped arrays', () => {
      const validator = v.array().optional();

      expect(validator.validate(undefined).success).toBe(true);
      expect(validator.validate([1, 2, 'a']).success).toBe(true);
    });
  });

  describe('Required/Optional', () => {
    it('should require value by default', () => {
      const validator = v.array(v.string());

      expect(validator.validate(undefined).success).toBe(false);
      expect(validator.validate(null).success).toBe(false);
    });

    it('should allow undefined when optional', () => {
      const validator = v.array(v.string()).optional();
      const result = validator.validate(undefined);

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('should validate array when provided even if optional', () => {
      const validator = v.array(v.string()).optional();
      const result = validator.validate(['a', 'b']);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(['a', 'b']);
    });
  });

  describe('Item validation', () => {
    it('should validate string items', () => {
      const validator = v.array(v.string().min(2));

      expect(validator.validate(['ab', 'cd']).success).toBe(true);
      expect(validator.validate(['a', 'b']).success).toBe(false);
    });

    it('should validate number items', () => {
      const validator = v.array(v.number().min(0));

      expect(validator.validate([1, 2, 3]).success).toBe(true);
      expect(validator.validate([1, -1, 3]).success).toBe(false);
    });

    it('should validate object items', () => {
      const validator = v.array(v.object({
        name: v.string(),
        age: v.number(),
      }));

      const result = validator.validate([
        { name: 'John', age: 30 },
        { name: 'Jane', age: 25 },
      ]);

      expect(result.success).toBe(true);
    });

    it('should fail if any item is invalid', () => {
      const validator = v.array(v.string().min(2));
      const result = validator.validate(['ab', 'c', 'de']);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0].path[0]).toBe('1'); // index 1
    });

    it('should report multiple item errors', () => {
      const validator = v.array(v.number().min(0));
      const result = validator.validate([1, -1, 2, -2]);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('Min/Max length', () => {
    it('should enforce minimum length', () => {
      const validator = v.array(v.string()).min(2);

      expect(validator.validate([]).success).toBe(false);
      expect(validator.validate(['a']).success).toBe(false);
      expect(validator.validate(['a', 'b']).success).toBe(true);
      expect(validator.validate(['a', 'b', 'c']).success).toBe(true);
    });

    it('should enforce maximum length', () => {
      const validator = v.array(v.string()).max(2);

      expect(validator.validate([]).success).toBe(true);
      expect(validator.validate(['a']).success).toBe(true);
      expect(validator.validate(['a', 'b']).success).toBe(true);
      expect(validator.validate(['a', 'b', 'c']).success).toBe(false);
    });

    it('should enforce both min and max', () => {
      const validator = v.array(v.string()).min(1).max(3);

      expect(validator.validate([]).success).toBe(false);
      expect(validator.validate(['a']).success).toBe(true);
      expect(validator.validate(['a', 'b']).success).toBe(true);
      expect(validator.validate(['a', 'b', 'c']).success).toBe(true);
      expect(validator.validate(['a', 'b', 'c', 'd']).success).toBe(false);
    });
  });

  describe('Nested arrays', () => {
    it('should validate arrays of arrays', () => {
      const validator = v.array(v.array(v.number()));

      const result = validator.validate([
        [1, 2, 3],
        [4, 5, 6],
      ]);

      expect(result.success).toBe(true);
    });

    it('should report nested array errors with path', () => {
      const validator = v.array(v.array(v.number().min(0)));

      const result = validator.validate([
        [1, 2],
        [3, -1], // invalid
      ]);

      expect(result.success).toBe(false);
      expect(result.errors?.[0].path).toEqual(['1', '1']); // array[1][1]
    });
  });

  describe('Arrays of objects', () => {
    it('should validate arrays of objects', () => {
      const validator = v.array(v.object({
        id: v.string().uuid(),
        name: v.string().min(2),
      }));

      const result = validator.validate([
        { id: '550e8400-e29b-41d4-a716-446655440000', name: 'John' },
        { id: '550e8400-e29b-41d4-a716-446655440001', name: 'Jane' },
      ]);

      expect(result.success).toBe(true);
    });

    it('should report object field errors with path', () => {
      const validator = v.array(v.object({
        name: v.string().min(2),
      }));

      const result = validator.validate([
        { name: 'John' },
        { name: 'J' }, // too short
      ]);

      expect(result.success).toBe(false);
      expect(result.errors?.[0].path).toEqual(['1', 'name']); // array[1].name
    });
  });

  describe('Chaining validations', () => {
    it('should chain multiple validations', () => {
      const validator = v.array(v.number().integer().min(0)).min(1).max(10);

      expect(validator.validate([]).success).toBe(false); // too short
      expect(validator.validate([1, 2, 3]).success).toBe(true);
      expect(validator.validate([1, 2.5, 3]).success).toBe(false); // not integer
      expect(validator.validate([1, -1, 3]).success).toBe(false); // negative
    });

    it('should preserve validations through optional', () => {
      const validator = v.array(v.string()).min(1).optional();

      expect(validator.validate(undefined).success).toBe(true);
      expect(validator.validate([]).success).toBe(false); // too short
      expect(validator.validate(['a']).success).toBe(true);
    });
  });

  describe('Error messages', () => {
    it('should provide clear error for type mismatch', () => {
      const validator = v.array(v.string());
      const result = validator.validate('not an array');

      expect(result.errors?.[0].message).toBe('Expected array');
    });

    it('should provide clear error for required field', () => {
      const validator = v.array(v.string());
      const result = validator.validate(undefined);

      expect(result.errors?.[0].message).toBe('Field is required');
    });

    it('should provide clear error for min length', () => {
      const validator = v.array(v.string()).min(2);
      const result = validator.validate(['a']);

      expect(result.errors?.[0].message).toBe('Array must have at least 2 items');
    });

    it('should provide clear error for max length', () => {
      const validator = v.array(v.string()).max(2);
      const result = validator.validate(['a', 'b', 'c']);

      expect(result.errors?.[0].message).toBe('Array must have at most 2 items');
    });

    it('should include item index in error path', () => {
      const validator = v.array(v.string().min(2));
      const result = validator.validate(['ab', 'c']);

      expect(result.errors?.[0].path[0]).toBe('1'); // index 1
    });
  });
});
