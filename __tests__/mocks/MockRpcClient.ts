import { ValidationError } from '../../src/core';

/**
 * Call history entry for tracking RPC calls
 */
interface CallHistoryEntry {
  command: string;
  data: any;
  timestamp: number;
  options?: {
    timeout?: number;
    metadata?: Record<string, any>;
  };
}

/**
 * Mock implementation of RpcClient for testing
 * Use this in your tests to avoid needing a real RabbitMQ connection.
 */
export class MockRpcClient {
  private responses = new Map<string, any>();
  private errors = new Map<string, Error>();
  private callHistory: CallHistoryEntry[] = [];
  private closed = false;

  /**
   * Mock a successful response for a command
   */
  mockResponse(command: string, response: any): void {
    const normalizedCommand = command.toUpperCase();
    this.responses.set(normalizedCommand, response);
    this.errors.delete(normalizedCommand);
  }

  /**
   * Mock an error for a command
   */
  mockError(command: string, error: Error): void {
    const normalizedCommand = command.toUpperCase();
    this.errors.set(normalizedCommand, error);
    this.responses.delete(normalizedCommand);
  }

  /**
   * Send a command (mocked)
   */
  async send<TRequest = any, TResponse = any>(
    command: string,
    data: TRequest,
    options?: {
      timeout?: number;
      metadata?: Record<string, any>;
      signal?: AbortSignal;
    }
  ): Promise<TResponse> {
    if (this.closed) {
      throw new Error('RpcClient is closed');
    }

    if (!command || typeof command !== 'string') {
      throw new ValidationError('Command must be a non-empty string', {});
    }

    const normalizedCommand = command.toUpperCase();

    // Record the call
    this.callHistory.push({
      command: normalizedCommand,
      data,
      timestamp: Date.now(),
      options: options ? { timeout: options.timeout, metadata: options.metadata } : undefined,
    });

    // Check if aborted
    if (options?.signal?.aborted) {
      throw new Error('Request aborted');
    }

    // Return mocked error if configured
    if (this.errors.has(normalizedCommand)) {
      throw this.errors.get(normalizedCommand)!;
    }

    // Return mocked response if configured
    if (this.responses.has(normalizedCommand)) {
      return this.responses.get(normalizedCommand) as TResponse;
    }

    // No mock configured
    throw new Error(`No mock configured for command: ${normalizedCommand}`);
  }

  /**
   * Get the history of all calls made to send()
   */
  getCallHistory(): CallHistoryEntry[] {
    return [...this.callHistory];
  }

  /**
   * Get calls for a specific command
   */
  getCallsForCommand(command: string): CallHistoryEntry[] {
    const normalizedCommand = command.toUpperCase();
    return this.callHistory.filter((call) => call.command === normalizedCommand);
  }

  /**
   * Clear all mocked responses, errors, and call history
   */
  clear(): void {
    this.responses.clear();
    this.errors.clear();
    this.callHistory = [];
  }

  /**
   * Check if client is ready (always true for mock)
   */
  isReady(): boolean {
    return !this.closed;
  }

  /**
   * Close the client (just marks as closed)
   */
  async close(): Promise<void> {
    this.closed = true;
  }
}
