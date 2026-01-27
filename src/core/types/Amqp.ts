import * as amqp from 'amqplib';

/**
 * Extended Connection interface with confirm channel support
 *
 * amqplib's Connection type doesn't properly expose createConfirmChannel
 * in TypeScript, so we extend it with proper types.
 */
export interface ConnectionWithConfirm extends amqp.Connection {
  createConfirmChannel(): Promise<amqp.ConfirmChannel>;
  createChannel(): Promise<amqp.Channel>;
  close(): Promise<void>;
}

/**
 * Extended Error interface with additional error details
 *
 * Used for RPC error responses that may include structured error information
 */
export interface ExtendedError extends Error {
  code?: string;
  details?: any;
}

/**
 * Type guard to check if a connection supports confirm channels
 */
export const isConnectionWithConfirm = (conn: amqp.Connection): conn is ConnectionWithConfirm => {
  return typeof (conn as any).createConfirmChannel === 'function';
};

/**
 * Type guard to check if an error has extended error properties
 */
export const isExtendedError = (error: unknown): error is ExtendedError => {
  return error instanceof Error;
};

/**
 * Safely cast amqplib Connection to ConnectionWithConfirm
 *
 * This is safe because all amqplib connections support these methods,
 * they're just not properly typed in the library's TypeScript definitions.
 */
export const asConnectionWithConfirm = (conn: amqp.Connection): ConnectionWithConfirm => {
  return conn as ConnectionWithConfirm;
};

/**
 * Extended Channel interface with connection property
 *
 * Used to check if a channel's underlying connection is still valid
 */
export type ChannelWithConnection = amqp.Channel & {
  connection?: amqp.Connection;
};

/**
 * Extended ConfirmChannel interface with waitForConfirms
 *
 * The waitForConfirms method exists but isn't always properly typed
 */
export type ExtendedConfirmChannel = amqp.ConfirmChannel & {
  waitForConfirms(): Promise<void>;
  connection?: amqp.Connection;
};

/**
 * Safely cast to ChannelWithConnection
 */
export const asChannelWithConnection = (channel: amqp.Channel): ChannelWithConnection => {
  return channel as ChannelWithConnection;
};

/**
 * Safely cast to ExtendedConfirmChannel
 */
export const asExtendedConfirmChannel = (channel: amqp.ConfirmChannel): ExtendedConfirmChannel => {
  return channel as ExtendedConfirmChannel;
};
