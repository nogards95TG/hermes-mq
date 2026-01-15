import type { Validator, ValidationResult, ValidationError as ValidatorError } from './Validator';

/**
 * Object validator with optional field validation
 * Can validate generic objects (no schema) or typed objects (with schema)
 */
export class ObjectValidator<TSchema extends Record<string, Validator> | undefined = undefined, TRequired extends boolean = true>
  implements Validator<
    TRequired extends true
      ? (TSchema extends Record<string, Validator> ? { [K in keyof TSchema]: TSchema[K]['_type'] } : Record<string, any>)
      : (TSchema extends Record<string, Validator> ? { [K in keyof TSchema]: TSchema[K]['_type'] } : Record<string, any>) | undefined
  >
{
  readonly _type!: TRequired extends true
    ? (TSchema extends Record<string, Validator> ? { [K in keyof TSchema]: TSchema[K]['_type'] } : Record<string, any>)
    : (TSchema extends Record<string, Validator> ? { [K in keyof TSchema]: TSchema[K]['_type'] } : Record<string, any>) | undefined;

  private schema?: TSchema;
  private isRequired: boolean = true;

  constructor(schema?: TSchema, required: boolean = true) {
    this.schema = schema;
    this.isRequired = required;
  }

  /**
   * Make this field required (default)
   */
  required(): ObjectValidator<TSchema, true> {
    return new ObjectValidator<TSchema, true>(this.schema, true);
  }

  /**
   * Make this field optional (allows undefined)
   */
  optional(): ObjectValidator<TSchema, false> {
    return new ObjectValidator<TSchema, false>(this.schema, false);
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
    if (typeof value !== 'object' || Array.isArray(value)) {
      return {
        success: false,
        errors: [{ path: [], message: 'Expected object' }],
      };
    }

    const obj = value as Record<string, unknown>;

    // If no schema provided, accept any object
    if (!this.schema) {
      return { success: true, data: obj };
    }

    const result: Record<string, unknown> = {};
    const errors: ValidatorError[] = [];

    // Validate each field in the schema
    for (const [key, validator] of Object.entries(this.schema)) {
      const fieldValue = obj[key];
      const fieldResult = validator.validate(fieldValue);

      if (!fieldResult.success) {
        // Add path prefix to errors
        for (const error of fieldResult.errors || []) {
          errors.push({
            path: [key, ...error.path],
            message: error.message,
          });
        }
      } else {
        result[key] = fieldResult.data;
      }
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    return { success: true, data: result };
  }
}
