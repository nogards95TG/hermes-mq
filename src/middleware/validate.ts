import { Middleware, RpcContext } from '../middleware';

/**
 * Validation result from schema adapters
 */
export interface ValidationResult {
  success: boolean;
  value?: any;
  errors?: any;
}

/**
 * Adapter interface for different schema validation libraries
 */
export interface ValidateAdapter {
  type: string;
  validate: (payload: any) => ValidationResult | Promise<ValidationResult>;
}

/**
 * Detect if an object is a Zod schema
 * @internal
 */
const isZodSchema = (schema: any): boolean => {
  return schema && typeof schema.safeParse === 'function';
};

/**
 * Detect if an object is a Yup schema
 * @internal
 */
const isYupSchema = (schema: any): boolean => {
  return schema &&
    typeof schema.validate === 'function' &&
    typeof schema.validateSync === 'function' &&
    typeof schema.describe === 'function';
};

/**
 * Detect if an object is an Ajv validate function
 * @internal
 */
const isAjvValidate = (schema: any): boolean => {
  return typeof schema === 'function' && schema.schema !== undefined && 'errors' in schema;
};

/**
 * Create a Zod adapter
 * @internal
 */
const createZodAdapter = (schema: any): ValidateAdapter => ({
  type: 'zod',
  validate: (payload: any) => {
    const result = schema.safeParse(payload);
    if (result.success) {
      return { success: true, value: result.data };
    }
    return { success: false, errors: result.error.errors };
  },
});

/**
 * Create a Yup adapter
 * @internal
 */
const createYupAdapter = (schema: any): ValidateAdapter => ({
  type: 'yup',
  validate: async (payload: any) => {
    try {
      const value = await schema.validate(payload);
      return { success: true, value };
    } catch (error: any) {
      return { success: false, errors: error.errors || [error.message] };
    }
  },
});

/**
 * Create an Ajv adapter
 * @internal
 */
const createAjvAdapter = (validate: any): ValidateAdapter => ({
  type: 'ajv',
  validate: (payload: any) => {
    const isValid = validate(payload);
    if (isValid) {
      return { success: true, value: payload };
    }
    return { success: false, errors: validate.errors };
  },
});

/**
 * Validation error response format
 */
export interface ValidationErrorResponse {
  error: 'ValidationError';
  details: any;
}

/**
 * Built-in validate middleware
 *
 * Validates incoming request payload using provided schema or adapter.
 * Supports auto-detection of Zod and Yup schemas.
 *
 * If validation fails, returns a standardized error response and short-circuits the chain.
 * If validation passes, updates ctx.payload with validated/coerced value.
 *
 * @param schemaOrAdapter - Schema object (Zod/Yup/Ajv) or custom adapter
 * @returns Middleware function
 *
 * @example
 * ```typescript
 * import { validate } from 'hermes-mq';
 * import { z } from 'zod';
 *
 * const addSchema = z.object({
 *   a: z.number(),
 *   b: z.number()
 * });
 *
 * server.registerHandler(
 *   'ADD',
 *   validate(addSchema),
 *   async (payload) => ({ sum: payload.a + payload.b })
 * );
 * ```
 */
export const validate = <Req = any, Res = any>(
  schemaOrAdapter: any
): Middleware<Req, Res> => {
  // Determine which adapter to use
  let adapter: ValidateAdapter;

  if (schemaOrAdapter.type && schemaOrAdapter.validate) {
    // Already an adapter
    adapter = schemaOrAdapter;
  } else if (isZodSchema(schemaOrAdapter)) {
    // Auto-detect Zod
    adapter = createZodAdapter(schemaOrAdapter);
  } else if (isYupSchema(schemaOrAdapter)) {
    // Auto-detect Yup
    adapter = createYupAdapter(schemaOrAdapter);
  } else if (isAjvValidate(schemaOrAdapter)) {
    // Auto-detect Ajv
    adapter = createAjvAdapter(schemaOrAdapter);
  } else {
    throw new Error(
      `Invalid schema or adapter provided to validate(). ` +
        `Expected Zod/Yup/Ajv schema or { type, validate } adapter.`
    );
  }

  return async (ctx: RpcContext<Req, Res>, next) => {
    try {
      const result = await adapter.validate(ctx.payload);

      if (!result.success) {
        // Validation failed - return error response
        const errorResponse: ValidationErrorResponse = {
          error: 'ValidationError',
          details: result.errors,
        };

        ctx.logger.debug('Payload validation failed', {
          command: ctx.command,
          errors: result.errors,
        });

        // Return the error (will be short-circuited as response)
        return errorResponse;
      }

      // Validation passed - update payload with validated/coerced value
      if (result.value !== undefined) {
        ctx.payload = result.value;
      }

      ctx.logger.debug('Payload validation passed', {
        command: ctx.command,
      });

      // Continue to next middleware
      return await next();
    } catch (error) {
      ctx.logger.error('Validation middleware error', error as Error);
      throw error;
    }
  };
};

/**
 * Create a custom adapter for a validation library
 *
 * @param type - Adapter type name
 * @param validateFn - Function that validates payload and returns { success, value?, errors? }
 * @returns Adapter object
 *
 * @example
 * ```typescript
 * import { validateAdapter } from 'hermes-mq';
 * import Joi from 'joi';
 *
 * const schema = Joi.object({
 *   name: Joi.string().required(),
 *   age: Joi.number().required()
 * });
 *
 * const adapter = validateAdapter('joi', (payload) => {
 *   const { error, value } = schema.validate(payload);
 *   if (error) {
 *     return { success: false, errors: error.details };
 *   }
 *   return { success: true, value };
 * });
 *
 * server.registerHandler('CREATE_USER', validate(adapter), handler);
 * ```
 */
export const validateAdapter = (
  type: string,
  validateFn: (payload: any) => ValidationResult | Promise<ValidationResult>
): ValidateAdapter => ({
  type,
  validate: validateFn,
});
