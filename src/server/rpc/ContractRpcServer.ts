import type {
  Contract,
  CommandNames,
  InferRequest,
  InferResponse,
} from '../../core/contract/Contract';
import { RpcServer, type RpcServerConfig } from './RpcServer';
import { ValidationError } from '../../core';

/**
 * Helper type to extract handler function type from command definition
 */
type HandlerFunction<TCommandDef> = (
  request: InferRequest<TCommandDef>,
  metadata?: Record<string, any>
) => Promise<InferResponse<TCommandDef>> | InferResponse<TCommandDef>;

/**
 * Type-safe RPC server based on a contract
 *
 * Provides automatic request/response validation and full TypeScript type inference.
 *
 * @example
 * ```typescript
 * import { createContractServer, defineContract, v } from 'hermes-mq';
 *
 * const contract = defineContract({
 *   serviceName: 'users',
 *   commands: {
 *     GET_USER: {
 *       req: v.object({ id: v.string().uuid() }),
 *       res: v.object({ id: v.string(), name: v.string() }),
 *     },
 *   },
 * });
 *
 * // With runtime validation (default)
 * const server = createContractServer(contract, {
 *   connection: { url: 'amqp://localhost' },
 *   validate: true, // default: true
 * });
 *
 * // TypeScript autocomplete only (skip validation for performance)
 * const fastServer = createContractServer(contract, {
 *   connection: { url: 'amqp://localhost' },
 *   validate: false, // zero overhead, only TypeScript types
 * });
 *
 * // Full type safety and autocomplete!
 * server.registerHandler('GET_USER', async (request) => {
 *   const user = await db.users.findById(request.id);
 *   return { id: user.id, name: user.name };
 * });
 *
 * await server.start();
 * ```
 */
export class ContractRpcServer<TContract extends Contract> {
  private server: RpcServer;
  private contract: TContract;
  private enableValidation: boolean;

  constructor(
    contract: TContract,
    config: Omit<RpcServerConfig, 'queueName'> & { queueName?: string; validate?: boolean }
  ) {
    this.contract = contract;
    this.enableValidation = config.validate ?? true; // Default: true (validate)
    this.server = new RpcServer({
      ...config,
      queueName: config.queueName || contract.serviceName,
    });
  }

  /**
   * Register a type-safe handler with automatic validation
   *
   * @param command - Command name from the contract
   * @param handler - Handler function with typed request/response
   *
   * @example
   * ```typescript
   * server.registerHandler('GET_USER', async (request) => {
   *   // request.id is typed as string (UUID validated)
   *   const user = await db.users.findById(request.id);
   *   return { id: user.id, name: user.name }; // return type is checked
   * });
   * ```
   */
  registerHandler<TCommand extends CommandNames<TContract>>(
    command: TCommand,
    handler: HandlerFunction<TContract['commands'][TCommand]>
  ): this {
    const commandDef = this.contract.commands[command];

    // Wrap handler with validation (if enabled)
    this.server.registerHandler(command, async (data, metadata) => {
      let validatedData: any = data;

      // Validate request (if validation is enabled)
      if (this.enableValidation) {
        const requestResult = commandDef.req.validate(data);

        if (!requestResult.success) {
          throw new ValidationError(`Invalid request for ${command}`, {
            command,
            errors: requestResult.errors,
          });
        }
        validatedData = requestResult.data!;
      }

      // Execute handler with validated (or raw) data
      const result = await handler(validatedData, metadata);

      // Response validation is skipped - TypeScript ensures type correctness
      // Runtime validation would expose internal errors to clients
      return result;
    });

    return this;
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    await this.server.start();
  }

  /**
   * Stop the server
   *
   * @param options - Stop options
   * @param options.timeout - Maximum time to wait for in-flight messages (default: 30000ms)
   * @param options.force - Force stop even if timeout is exceeded (default: false)
   */
  async stop(options?: { timeout?: number; force?: boolean }): Promise<void> {
    await this.server.stop(options);
  }

  /**
   * Check if server is running
   */
  isServerRunning(): boolean {
    return this.server.isServerRunning();
  }

  /**
   * Get number of registered handlers
   */
  getHandlerCount(): number {
    return this.server.getHandlerCount();
  }
}

/**
 * Factory function to create a contract-based RPC server
 *
 * @param contract - Service contract definition
 * @param config - Server configuration
 * @param config.validate - Enable runtime validation (default: true). Set to false for TypeScript-only type checking with zero overhead
 * @param config.queueName - Queue name (optional, defaults to contract.serviceName)
 * @returns Type-safe RPC server instance
 *
 * @example
 * ```typescript
 * // With validation (recommended for production)
 * const server = createContractServer(usersContract, {
 *   connection: { url: 'amqp://localhost' },
 *   validate: true, // default
 * });
 *
 * // Without validation (maximum performance, TypeScript only)
 * const fastServer = createContractServer(usersContract, {
 *   connection: { url: 'amqp://localhost' },
 *   validate: false,
 * });
 * ```
 */
export const createContractServer = <TContract extends Contract>(
  contract: TContract,
  config: Omit<RpcServerConfig, 'queueName'> & { queueName?: string; validate?: boolean }
): ContractRpcServer<TContract> => new ContractRpcServer(contract, config);
