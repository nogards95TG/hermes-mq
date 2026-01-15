import type { Validator, ValidationResult, ValidationError as ValidatorError } from './Validator';

/**
 * Any validator - accepts any value
 */
class AnyValidator implements Validator<any> {
  readonly _type!: any;
  
  validate(value: unknown): ValidationResult<any> {
    return { success: true, data: value };
  }
}

/**
 * Array validator with optional item validation
 */
export class ArrayValidator<TItem extends Validator = Validator, TRequired extends boolean = true>
  implements Validator<TRequired extends true ? Array<TItem['_type']> : Array<TItem['_type']> | undefined>
{
  readonly _type!: TRequired extends true ? Array<TItem['_type']> : Array<TItem['_type']> | undefined;

  private itemValidator: TItem;
  private minLength?: number;
  private maxLength?: number;
  private isRequired: boolean = true;

  constructor(itemValidator?: TItem, required: boolean = true) {
    this.itemValidator = (itemValidator || new AnyValidator()) as TItem;
    this.isRequired = required;
  }

  /**
   * Make this field required (default)
   */
  required(): ArrayValidator<TItem, true> {
    const validator = new ArrayValidator<TItem, true>(this.itemValidator, true);
    validator.minLength = this.minLength;
    validator.maxLength = this.maxLength;
    return validator;
  }

  /**
   * Make this field optional (allows undefined)
   */
  optional(): ArrayValidator<TItem, false> {
    const validator = new ArrayValidator<TItem, false>(this.itemValidator, false);
    validator.minLength = this.minLength;
    validator.maxLength = this.maxLength;
    return validator;
  }

  /**
   * Set minimum array length
   */
  min(length: number): this {
    this.minLength = length;
    return this;
  }

  /**
   * Set maximum array length
   */
  max(length: number): this {
    this.maxLength = length;
    return this;
  }

  /**
   * Validate the value
   */
  validate(value: unknown): ValidationResult<any> {
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
    if (!Array.isArray(value)) {
      return {
        success: false,
        errors: [{ path: [], message: 'Expected array' }],
      };
    }

    // Min length validation
    if (this.minLength !== undefined && value.length < this.minLength) {
      return {
        success: false,
        errors: [
          {
            path: [],
            message: `Array must have at least ${this.minLength} item${this.minLength === 1 ? '' : 's'}`,
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
            message: `Array must have at most ${this.maxLength} item${this.maxLength === 1 ? '' : 's'}`,
          },
        ],
      };
    }

    // Validate each item
    const result: unknown[] = [];
    const errors: ValidatorError[] = [];

    for (let i = 0; i < value.length; i++) {
      const itemResult = this.itemValidator.validate(value[i]);

      if (!itemResult.success) {
        // Add index to error path
        for (const error of itemResult.errors || []) {
          errors.push({
            path: [i.toString(), ...error.path],
            message: error.message,
          });
        }
      } else {
        result.push(itemResult.data);
      }
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    return { success: true, data: result };
  }
}
