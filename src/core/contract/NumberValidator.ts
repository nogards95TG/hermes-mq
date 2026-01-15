import type { Validator, ValidationResult } from './Validator';

/**
 * Number validator with chainable methods
 */
export class NumberValidator<TRequired extends boolean = true> implements Validator<TRequired extends true ? number : number | undefined> {
  readonly _type!: TRequired extends true ? number : number | undefined;

  private minValue?: number;
  private maxValue?: number;
  private integerOnly: boolean = false;
  private positiveOnly: boolean = false;
  private negativeOnly: boolean = false;
  private isRequired: boolean = true;

  constructor(required: boolean = true) {
    this.isRequired = required;
  }

  /**
   * Make this field required (default)
   */
  required(): NumberValidator<true> {
    const validator = new NumberValidator<true>(true);
    validator.minValue = this.minValue;
    validator.maxValue = this.maxValue;
    validator.integerOnly = this.integerOnly;
    validator.positiveOnly = this.positiveOnly;
    validator.negativeOnly = this.negativeOnly;
    return validator;
  }

  /**
   * Make this field optional (allows undefined)
   */
  optional(): NumberValidator<false> {
    const validator = new NumberValidator<false>(false);
    validator.minValue = this.minValue;
    validator.maxValue = this.maxValue;
    validator.integerOnly = this.integerOnly;
    validator.positiveOnly = this.positiveOnly;
    validator.negativeOnly = this.negativeOnly;
    return validator;
  }

  /**
   * Set minimum value (inclusive)
   */
  min(value: number): this {
    this.minValue = value;
    return this;
  }

  /**
   * Set maximum value (inclusive)
   */
  max(value: number): this {
    this.maxValue = value;
    return this;
  }

  /**
   * Require integer (no decimals)
   */
  integer(): this {
    this.integerOnly = true;
    return this;
  }

  /**
   * Require positive number (> 0)
   */
  positive(): this {
    this.positiveOnly = true;
    return this;
  }

  /**
   * Require negative number (< 0)
   */
  negative(): this {
    this.negativeOnly = true;
    return this;
  }

  /**
   * Validate the value
   */
  validate(value: unknown): ValidationResult<TRequired extends true ? number : number | undefined> {
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
    if (typeof value !== 'number' || isNaN(value)) {
      return {
        success: false,
        errors: [{ path: [], message: 'Expected number' }],
      };
    }

    // Integer validation
    if (this.integerOnly && !Number.isInteger(value)) {
      return {
        success: false,
        errors: [{ path: [], message: 'Must be an integer' }],
      };
    }

    // Positive validation
    if (this.positiveOnly && value <= 0) {
      return {
        success: false,
        errors: [{ path: [], message: 'Must be positive' }],
      };
    }

    // Negative validation
    if (this.negativeOnly && value >= 0) {
      return {
        success: false,
        errors: [{ path: [], message: 'Must be negative' }],
      };
    }

    // Min value validation
    if (this.minValue !== undefined && value < this.minValue) {
      return {
        success: false,
        errors: [{ path: [], message: `Must be at least ${this.minValue}` }],
      };
    }

    // Max value validation
    if (this.maxValue !== undefined && value > this.maxValue) {
      return {
        success: false,
        errors: [{ path: [], message: `Must be at most ${this.maxValue}` }],
      };
    }

    return { success: true, data: value };
  }
}
