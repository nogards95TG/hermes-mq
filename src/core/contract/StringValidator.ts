import type { Validator, ValidationResult } from './Validator';

/**
 * String validator with chainable methods
 */
export class StringValidator<TRequired extends boolean = true> implements Validator<TRequired extends true ? string : string | undefined> {
  readonly _type!: TRequired extends true ? string : string | undefined;

  private minLength?: number;
  private maxLength?: number;
  private regex?: RegExp;
  private regexMessage?: string;
  private isRequired: boolean = true;

  constructor(required: boolean = true) {
    this.isRequired = required;
  }

  /**
   * Make this field required (default)
   */
  required(): StringValidator<true> {
    const validator = new StringValidator<true>(true);
    validator.minLength = this.minLength;
    validator.maxLength = this.maxLength;
    validator.regex = this.regex;
    validator.regexMessage = this.regexMessage;
    return validator;
  }

  /**
   * Make this field optional (allows undefined)
   */
  optional(): StringValidator<false> {
    const validator = new StringValidator<false>(false);
    validator.minLength = this.minLength;
    validator.maxLength = this.maxLength;
    validator.regex = this.regex;
    validator.regexMessage = this.regexMessage;
    return validator;
  }

  /**
   * Set minimum length
   */
  min(length: number): this {
    this.minLength = length;
    return this;
  }

  /**
   * Set maximum length
   */
  max(length: number): this {
    this.maxLength = length;
    return this;
  }

  /**
   * Validate as email format
   */
  email(): this {
    this.regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    this.regexMessage = 'Invalid email format';
    return this;
  }

  /**
   * Validate as UUID format
   */
  uuid(): this {
    this.regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    this.regexMessage = 'Invalid UUID format';
    return this;
  }

  /**
   * Validate as MongoDB ObjectId format
   */
  mongoId(): this {
    this.regex = /^[0-9a-fA-F]{24}$/;
    this.regexMessage = 'Invalid MongoDB ObjectId';
    return this;
  }

  /**
   * Custom pattern validation
   */
  pattern(pattern: RegExp, message?: string): this {
    this.regex = pattern;
    this.regexMessage = message || 'Invalid format';
    return this;
  }

  /**
   * Validate the value
   */
  validate(value: unknown): ValidationResult<TRequired extends true ? string : string | undefined> {
    // Handle undefined/null for optional fields
    if (value === undefined || value === null) {
      if (!this.isRequired) {
        return { success: true, data: undefined };
      }
      return {
        success: false,
        errors: [{ path: [], message: 'Field is required' }],
      };
    }

    // Type check
    if (typeof value !== 'string') {
      return {
        success: false,
        errors: [{ path: [], message: 'Expected string' }],
      };
    }

    // Min length validation
    if (this.minLength !== undefined && value.length < this.minLength) {
      return {
        success: false,
        errors: [
          {
            path: [],
            message: `String must be at least ${this.minLength} character${this.minLength === 1 ? '' : 's'}`,
          },
        ],
      };
    }

    // Max length validation
    if (this.maxLength !== undefined && value.length > this.maxLength) {
      return {
        success: false,
        errors: [
          {
            path: [],
            message: `String must be at most ${this.maxLength} character${this.maxLength === 1 ? '' : 's'}`,
          },
        ],
      };
    }

    // Pattern validation
    if (this.regex && !this.regex.test(value)) {
      return {
        success: false,
        errors: [{ path: [], message: this.regexMessage || 'Invalid format' }],
      };
    }

    return { success: true, data: value };
  }
}
