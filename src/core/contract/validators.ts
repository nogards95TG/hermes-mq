/**
 * Validator builder object
 *
 * Import and use `v` to create validators:
 *
 * @example
 * ```typescript
 * import { v } from 'hermes-mq';
 *
 * const schema = v.object({
 *   name: v.string().min(2),
 *   email: v.string().email(),
 *   age: v.number().optional(),
 * });
 * ```
 */

import { StringValidator } from './StringValidator';
import { NumberValidator } from './NumberValidator';
import { ObjectValidator } from './ObjectValidator';
import { ArrayValidator } from './ArrayValidator';
import { BooleanValidator } from './BooleanValidator';
import { DateValidator } from './DateValidator';
import { AnyValidator } from './AnyValidator';
import type { Validator, ValidationResult } from './Validator';

export const v = {
  /**
   * Create a string validator
   *
   * @example
   * ```typescript
   * v.string() // required string
   * v.string().optional() // optional string
   * v.string().min(2).max(100) // string with length constraints
   * v.string().email() // email validation
   * v.string().uuid() // UUID validation
   * v.string().mongoId() // MongoDB ObjectId validation
   * ```
   */
  string: () => new StringValidator(true),

  /**
   * Create a number validator
   *
   * @example
   * ```typescript
   * v.number() // required number
   * v.number().optional() // optional number
   * v.number().min(0).max(100) // number with range constraints
   * v.number().integer() // integer only
   * v.number().positive() // positive only
   * v.number().negative() // negative only
   * ```
   */
  number: () => new NumberValidator(true),

  /**
   * Create a boolean validator
   *
   * @example
   * ```typescript
   * v.boolean() // required boolean
   * v.boolean().optional() // optional boolean
   * ```
   */
  boolean: () => new BooleanValidator(true),

  /**
   * Create a date validator
   *
   * @example
   * ```typescript
   * v.date() // required date (accepts Date, ISO string, timestamp)
   * v.date().optional() // optional date
   * v.date().min(new Date('2024-01-01')) // date after 2024-01-01
   * v.date().max(new Date()) // date before now
   * v.date().strict() // only accept Date objects, not strings
   * ```
   */
  date: () => new DateValidator(true),

  /**
   * Create an any validator (accepts any value)
   *
   * @example
   * ```typescript
   * v.any() // accepts any value
   * v.any().optional() // optional any value
   * ```
   */
  any: () => new AnyValidator(true),

  /**
   * Create an 
   * Create an object validator
   *
   * @example
   * ```typescript
   * v.object() // any object (no field validation)
   * v.object({
   *   name: v.string(),
   *   age: v.number().optional(),
   * })
   * v.object({ ... }).optional() // optional object
   * ```
   */
  object: <TSchema extends Record<string, Validator>>(schema?: TSchema) =>
    new ObjectValidator(schema, true),

  /**
   * Create an array validator
   *
   * @example
   * ```typescript
   * v.array() // any array (no item validation)
   * v.array(v.string()) // array of strings
   * v.array(v.number()).min(1).max(10) // array with size constraints
   * v.array(v.object({ ... })) // array of objects
   * v.array(v.string()).optional() // optional array
   * ```
   */
  array: <TItem extends Validator>(itemValidator?: TItem) =>
    new ArrayValidator(itemValidator, true),

  /**
   * Create a custom validator with user-defined validation logic
   *
   * @example
   * ```typescript
   * v.custom<string>((value) => {
   *   if (typeof value !== 'string') {
   *     return { success: false, errors: [{ path: [], message: 'Expected string' }] };
   *   }
   *   if (!value.startsWith('PREFIX_')) {
   *     return { success: false, errors: [{ path: [], message: 'Must start with PREFIX_' }] };
   *   }
   *   return { success: true, data: value };
   * }), EnumValidator
   * ```
   */
  custom: <T>(
    validateFn: (value: unknown) => ValidationResult<T>
  ): Validator<T> => ({
    _type: undefined as any,
    validate: validateFn,
  }),
};

// Re-export types
export type { Validator } from './Validator';
export type { StringValidator, NumberValidator, ObjectValidator, ArrayValidator, BooleanValidator, DateValidator, AnyValidator };
export type Infer<T> = T extends { validate: (value: unknown) => { data?: infer U } } ? U : never;
