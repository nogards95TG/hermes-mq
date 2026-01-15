/**
 * Validation result returned by validators
 */
export interface ValidationResult<T = any> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
}

/**
 * Validation error with path and message
 */
export interface ValidationError {
  path: string[];
  message: string;
}

/**
 * Base validator interface
 */
export interface Validator<T = any> {
  /**
   * Validate a value and return result
   */
  validate(value: unknown): ValidationResult<T>;

  /**
   * Phantom type for TypeScript inference
   */
  _type?: T;
}

/**
 * Helper type to infer the type from a Validator
 */
export type Infer<T> = T extends Validator<infer U> ? U : never;
