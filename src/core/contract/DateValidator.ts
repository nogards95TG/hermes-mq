import type { Validator, ValidationResult } from './Validator';

/**
 * Date validator - validates Date objects or ISO date strings
 */
export class DateValidator<TRequired extends boolean = true> implements Validator<TRequired extends true ? Date : Date | undefined> {
  readonly _type!: TRequired extends true ? Date : Date | undefined;

  private minDate?: Date;
  private maxDate?: Date;
  private acceptString: boolean = true; // Accept ISO date strings by default
  private isRequired: boolean = true;

  constructor(required: boolean = true) {
    this.isRequired = required;
  }

  /**
   * Make this field required (default)
   */
  required(): DateValidator<true> {
    const validator = new DateValidator<true>(true);
    validator.minDate = this.minDate;
    validator.maxDate = this.maxDate;
    validator.acceptString = this.acceptString;
    return validator;
  }

  /**
   * Make this field optional (allows undefined)
   */
  optional(): DateValidator<false> {
    const validator = new DateValidator<false>(false);
    validator.minDate = this.minDate;
    validator.maxDate = this.maxDate;
    validator.acceptString = this.acceptString;
    return validator;
  }

  /**
   * Set minimum date (inclusive)
   */
  min(date: Date | string | number): this {
    this.minDate = date instanceof Date ? date : new Date(date);
    return this;
  }

  /**
   * Set maximum date (inclusive)
   */
  max(date: Date | string | number): this {
    this.maxDate = date instanceof Date ? date : new Date(date);
    return this;
  }

  /**
   * Only accept Date objects, not ISO strings
   */
  strict(): this {
    this.acceptString = false;
    return this;
  }

  /**
   * Validate the value
   */
  validate(value: unknown): ValidationResult<TRequired extends true ? Date : Date | undefined> {
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

    let date: Date;

    // Handle Date object
    if (value instanceof Date) {
      if (isNaN(value.getTime())) {
        return {
          success: false,
          errors: [{ path: [], message: 'Invalid date' }],
        };
      }
      date = value;
    }
    // Handle ISO string
    else if (typeof value === 'string' && this.acceptString) {
      const parsed = new Date(value);
      if (isNaN(parsed.getTime())) {
        return {
          success: false,
          errors: [{ path: [], message: 'Invalid date string' }],
        };
      }
      date = parsed;
    }
    // Handle timestamp
    else if (typeof value === 'number' && this.acceptString) {
      const parsed = new Date(value);
      if (isNaN(parsed.getTime())) {
        return {
          success: false,
          errors: [{ path: [], message: 'Invalid timestamp' }],
        };
      }
      date = parsed;
    }
    // Invalid type
    else {
      return {
        success: false,
        errors: [{ path: [], message: this.acceptString ? 'Expected Date, ISO string, or timestamp' : 'Expected Date object' }],
      };
    }

    // Min date validation
    if (this.minDate && date < this.minDate) {
      return {
        success: false,
        errors: [{ path: [], message: `Date must be after ${this.minDate.toISOString()}` }],
      };
    }

    // Max date validation
    if (this.maxDate && date > this.maxDate) {
      return {
        success: false,
        errors: [{ path: [], message: `Date must be before ${this.maxDate.toISOString()}` }],
      };
    }

    return { success: true, data: date };
  }
}
