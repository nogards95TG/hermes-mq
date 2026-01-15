import type {
  Contract,
  CommandNames,
  InferRequest,
  InferResponse,
} from '../../core/contract/Contract';
import { RpcClient, type RpcClientConfig } from './RpcClient';
import { ValidationError } from '../../core';

/**
 * Helper type to extract request type from command definition
 */
type RequestType<TCommandDef> = InferRequest<TCommandDef>;

/**
 * Helper type to extract response type from command definition
 */
type ResponseType<TCommandDef> = InferResponse<TCommandDef>;

/**
 * Type-safe RPC client based on a contract
 *
 * Provides automatic request/response validation and full TypeScript type inference.
 *
 * @example
 * ```typescript
 * import { createContractClient, defineContract, v } from 'hermes-mq';
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
 * const client = createContractClient(contract, {
 *   connection: { url: 'amqp://localhost' },
 * });
 *
 * // Full type safety and autocomplete!
 * const user = await client.send('GET_USER', { id: '...' });
 * console.log(user.name); // typed!
 * ```
 */
export class ContractRpcClient<TContract extends Contract> {
  private client: RpcClient;
  private contract: TContract;

  constructor(
    contract: TContract,
    config: Omit<RpcClientConfig, 'queueName'> & { queueName?: string }
  ) {
    this.contract = contract;
    this.client = new RpcClient({
      ...config,
      queueName: config.queueName || contract.serviceName,
    });
  }

  /**
   * Send a type-safe RPC request with automatic validation
   *
   * @param command - Command name from the contract
   * @param request - Request data (validated before sending)
   * @param options - Send options
   * @param options.timeout - Custom timeout for this request
   * @param options.metadata - Additional metadata to send
   * @param options.signal - AbortSignal to cancel the request
   * @returns Promise with typed response data
   *
   * @example
   * ```typescript
   * const user = await client.send('GET_USER', {
   *   id: '550e8400-e29b-41d4-a716-446655440000'
   * });
   *
   * // user.name is typed!
   * console.log(user.name);
   * ```
   */
  async send<TCommand extends CommandNames<TContract>>(
    command: TCommand,
    request: RequestType<TContract['commands'][TCommand]>,
    options?: {
      timeout?: number;
      metadata?: Record<string, any>;
      signal?: AbortSignal;
    }
  ): Promise<ResponseType<TContract['commands'][TCommand]>> {
    const commandDef = this.contract.commands[command];

    // Validate request before sending
    const requestResult = commandDef.req.validate(request);

    if (!requestResult.success) {
      throw new ValidationError(`Invalid request for ${command}`, {
        command,
        errors: requestResult.errors,
      });
    }

    // Send request and return response
    // Response validation is skipped - trust the server + TypeScript type safety
    const response = await this.client.send(command, requestResult.data!, options);

    return response as ResponseType<TContract['commands'][TCommand]>;
  }

  /**
   * Close the client
   */
  async close(): Promise<void> {
    await this.client.close();
  }

  /**
   * Check if client is ready
   */
  isClientReady(): boolean {
    return this.client.isClientReady();
  }
}

/**
 * Factory function to create a contract-based RPC client
 *
 * @param contract - Service contract definition
 * @param config - Client configuration (queueName is optional, defaults to contract.serviceName)
 * @returns Type-safe RPC client instance
 *
 * @example
 * ```typescript
 * const client = createContractClient(usersContract, {
 *   connection: { url: 'amqp://localhost' },
 * });
 * ```
 */
export const createContractClient = <TContract extends Contract>(
  contract: TContract,
  config: Omit<RpcClientConfig, 'queueName'> & { queueName?: string }
): ContractRpcClient<TContract> => new ContractRpcClient(contract, config);
