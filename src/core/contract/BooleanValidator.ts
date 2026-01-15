import type { Validator, ValidationResult } from './Validator';

/**
 * Boolean validator
 */
export class BooleanValidator<TRequired extends boolean = true> implements Validator<TRequired extends true ? boolean : boolean | undefined> {
  readonly _type!: TRequired extends true ? boolean : boolean | undefined;

  private isRequired: boolean = true;

  constructor(required: boolean = true) {
    this.isRequired = required;
  }

  /**
   * Make this field required (default)
   */
  required(): BooleanValidator<true> {
    return new BooleanValidator<true>(true);
  }

  /**
   * Make this field optional (allows undefined)
   */
  optional(): BooleanValidator<false> {
    return new BooleanValidator<false>(false);
  }

  /**
   * Validate the value
   */
  validate(value: unknown): ValidationResult<TRequired extends true ? boolean : boolean | undefined> {
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
    if (typeof value !== 'boolean') {
      return {
        success: false,
        errors: [{ path: [], message: 'Expected boolean' }],
      };
    }

    return { success: true, data: value };
  }
}
