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
import type { Validator } from './Validator';

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
};

// Re-export types
export type { Validator } from './Validator';
export type { StringValidator, NumberValidator, ObjectValidator, ArrayValidator };
export type Infer<T> = T extends { validate: (value: unknown) => { data?: infer U } } ? U : never;
