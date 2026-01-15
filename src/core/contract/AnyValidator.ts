import type { Validator, ValidationResult } from './Validator';

/**
 * Any validator - accepts any value
 */
export class AnyValidator<TRequired extends boolean = true> implements Validator<TRequired extends true ? any : any | undefined> {
  readonly _type!: TRequired extends true ? any : any | undefined;

  private isRequired: boolean = true;

  constructor(required: boolean = true) {
    this.isRequired = required;
  }

  /**
   * Make this field required (default)
   */
  required(): AnyValidator<true> {
    return new AnyValidator<true>(true);
  }

  /**
   * Make this field optional (allows undefined)
   */
  optional(): AnyValidator<false> {
    return new AnyValidator<false>(false);
  }

  /**
   * Validate the value (always passes except for required check)
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

    return { success: true, data: value };
  }
}
