import { describe, it, expect } from 'vitest';
import { v } from '../../src/core/contract/validators';

describe('CustomValidator', () => {
  describe('Basic usage', () => {
    it('should validate with custom logic', () => {
      const validator = v.custom<string>((value) => {
        if (typeof value !== 'string') {
          return { success: false, errors: [{ path: [], message: 'Expected string' }] };
        }
        return { success: true, data: value };
      });

      expect(validator.validate('hello').success).toBe(true);
      expect(validator.validate(123).success).toBe(false);
    });

    it('should return custom error messages', () => {
      const validator = v.custom<string>((value) => {
        if (typeof value !== 'string') {
          return { success: false, errors: [{ path: [], message: 'Must be a string' }] };
        }
        if (!value.startsWith('PREFIX_')) {
          return { success: false, errors: [{ path: [], message: 'Must start with PREFIX_' }] };
        }
        return { success: true, data: value };
      });

      const result1 = validator.validate(123);
      expect(result1.errors?.[0].message).toBe('Must be a string');

      const result2 = validator.validate('invalid');
      expect(result2.errors?.[0].message).toBe('Must start with PREFIX_');

      const result3 = validator.validate('PREFIX_valid');
      expect(result3.success).toBe(true);
    });
  });

  describe('Complex validations', () => {
    it('should validate custom business logic', () => {
      // Validate even numbers only
      const evenNumberValidator = v.custom<number>((value) => {
        if (typeof value !== 'number') {
          return { success: false, errors: [{ path: [], message: 'Expected number' }] };
        }
        if (value % 2 !== 0) {
          return { success: false, errors: [{ path: [], message: 'Must be even' }] };
        }
        return { success: true, data: value };
      });

      expect(evenNumberValidator.validate(2).success).toBe(true);
      expect(evenNumberValidator.validate(4).success).toBe(true);
      expect(evenNumberValidator.validate(3).success).toBe(false);
    });

    it('should validate with multiple conditions', () => {
      const passwordValidator = v.custom<string>((value) => {
        if (typeof value !== 'string') {
          return { success: false, errors: [{ path: [], message: 'Expected string' }] };
        }
        
        const errors = [];
        
        if (value.length < 8) {
          errors.push({ path: [], message: 'Password must be at least 8 characters' });
        }
        if (!/[A-Z]/.test(value)) {
          errors.push({ path: [], message: 'Password must contain uppercase letter' });
        }
        if (!/[0-9]/.test(value)) {
          errors.push({ path: [], message: 'Password must contain number' });
        }
        
        if (errors.length > 0) {
          return { success: false, errors };
        }
        
        return { success: true, data: value };
      });

      expect(passwordValidator.validate('Short1').success).toBe(false);
      expect(passwordValidator.validate('nouppercase1').success).toBe(false);
      expect(passwordValidator.validate('NoNumbers').success).toBe(false);
      expect(passwordValidator.validate('Valid1Password').success).toBe(true);
    });
  });

  describe('Usage in objects', () => {
    it('should work in object schema', () => {
      const customIdValidator = v.custom<string>((value) => {
        if (typeof value !== 'string' || !value.startsWith('ID_')) {
          return { success: false, errors: [{ path: [], message: 'Invalid ID format' }] };
        }
        return { success: true, data: value };
      });

      const validator = v.object({
        id: customIdValidator,
        name: v.string(),
      });

      expect(validator.validate({
        id: 'ID_123',
        name: 'John',
      }).success).toBe(true);

      expect(validator.validate({
        id: '123',
        name: 'John',
      }).success).toBe(false);
    });
  });

  describe('Advanced use cases', () => {
    it('should validate conditional logic', () => {
      // Validate US or UK phone number
      const phoneValidator = v.custom<string>((value) => {
        if (typeof value !== 'string') {
          return { success: false, errors: [{ path: [], message: 'Expected string' }] };
        }
        
        const usFormat = /^\+1\d{10}$/;
        const ukFormat = /^\+44\d{10}$/;
        
        if (!usFormat.test(value) && !ukFormat.test(value)) {
          return { success: false, errors: [{ path: [], message: 'Invalid phone format (US: +1XXXXXXXXXX, UK: +44XXXXXXXXXX)' }] };
        }
        
        return { success: true, data: value };
      });

      expect(phoneValidator.validate('+12025551234').success).toBe(true);
      expect(phoneValidator.validate('+442075551234').success).toBe(true);
      expect(phoneValidator.validate('+33123456789').success).toBe(false);
    });

    it('should validate with external data', () => {
      const allowedUserIds = ['user1', 'user2', 'user3'];
      
      const userIdValidator = v.custom<string>((value) => {
        if (typeof value !== 'string') {
          return { success: false, errors: [{ path: [], message: 'Expected string' }] };
        }
        if (!allowedUserIds.includes(value)) {
          return { success: false, errors: [{ path: [], message: 'User ID not found' }] };
        }
        return { success: true, data: value };
      });

      expect(userIdValidator.validate('user1').success).toBe(true);
      expect(userIdValidator.validate('user99').success).toBe(false);
    });

    it('should transform data during validation', () => {
      const trimmedStringValidator = v.custom<string>((value) => {
        if (typeof value !== 'string') {
          return { success: false, errors: [{ path: [], message: 'Expected string' }] };
        }
        
        const trimmed = value.trim();
        if (trimmed.length === 0) {
          return { success: false, errors: [{ path: [], message: 'String cannot be empty' }] };
        }
        
        return { success: true, data: trimmed };
      });

      const result = trimmedStringValidator.validate('  hello  ');
      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');
    });
  });

  describe('Type inference', () => {
    it('should infer custom types', () => {
      interface User {
        id: string;
        name: string;
      }

      const userValidator = v.custom<User>((value) => {
        if (typeof value !== 'object' || value === null) {
          return { success: false, errors: [{ path: [], message: 'Expected object' }] };
        }
        
        const obj = value as any;
        if (typeof obj.id !== 'string' || typeof obj.name !== 'string') {
          return { success: false, errors: [{ path: [], message: 'Invalid user structure' }] };
        }
        
        return { success: true, data: obj as User };
      });

      const result = userValidator.validate({ id: '123', name: 'John' });
      if (result.success) {
        // TypeScript should infer result.data as User
        const user: User = result.data!;
        expect(user.id).toBe('123');
        expect(user.name).toBe('John');
      }
    });
  });
});
