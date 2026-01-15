import type { Validator, Infer } from './Validator';

/**
 * Command definition with request and response validators
 */
export interface CommandDefinition<
  TRequestValidator extends Validator = Validator,
  TResponseValidator extends Validator = Validator
> {
  req: TRequestValidator;
  res: TResponseValidator;
  _types?: {
    req: Infer<TRequestValidator>;
    res: Infer<TResponseValidator>;
  };
}

/**
 * Service contract definition
 */
export interface Contract<TCommands extends Record<string, CommandDefinition> = any> {
  serviceName: string;
  commands: TCommands;
}

/**
 * Extract command names from contract
 */
export type CommandNames<T extends Contract> = keyof T['commands'] & string;

/**
 * Infer request type from command definition
 */
export type InferRequest<T> = T extends CommandDefinition<infer TReqValidator, any>
  ? Infer<TReqValidator>
  : never;

/**
 * Infer response type from command definition
 */
export type InferResponse<T> = T extends CommandDefinition<any, infer TResValidator>
  ? Infer<TResValidator>
  : never;

/**
 * Define a service contract
 *
 * @example
 * ```typescript
 * import { defineContract, v } from 'hermes-mq';
 *
 * export const usersContract = defineContract({
 *   serviceName: 'users',
 *   commands: {
 *     GET_USER: {
 *       req: v.object({
 *         id: v.string().uuid(),
 *       }),
 *       res: v.object({
 *         id: v.string(),
 *         name: v.string(),
 *         email: v.string().email(),
 *       }),
 *     },
 *   },
 * });
 *
 * // Create server with contract
 * const server = createContractServer(usersContract, {
 *   connection: { url: 'amqp://localhost' }
 * });
 *
 * // Create client with contract
 * const client = createContractClient(usersContract, {
 *   connection: { url: 'amqp://localhost' }
 * });
 * ```
 */
export const defineContract = <TCommands extends Record<string, CommandDefinition>>(config: {
  serviceName: string;
  commands: TCommands;
}): Contract<TCommands> => ({
  serviceName: config.serviceName,
  commands: config.commands,
});
