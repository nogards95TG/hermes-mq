import { Message } from 'amqplib';
import { MessageValidationError, MessageParsingError } from '../errors';
import { MessageValidationOptions } from '../types/Messages';

/**
 * Result of message parsing operation
 */
export interface ParseResult<T = any> {
  success: boolean;
  data?: T;
  error?: Error;
  strategy?: 'reject' | 'dlq' | 'ignore';
}

/**
 * MessageParser handles message validation and parsing
 *
 * Validates messages for size limits, null bytes, and JSON structure.
 * Supports configurable strategies for handling malformed messages.
 *
 * @example
 * ```typescript
 * const parser = new MessageParser({
 *   maxSize: 1048576, // 1MB
 *   malformedMessageStrategy: 'dlq'
 * });
 *
 * const result = await parser.parse(message);
 * if (!result.success) {
 *   console.log('Malformed message:', result.error);
 * }
 * ```
 */
export class MessageParser {
  private options: MessageValidationOptions;

  constructor(options: MessageValidationOptions) {
    this.options = options;
  }

  /**
   * Parse and validate a message
   *
   * @param msg - AMQP message to parse
   * @returns Parse result with data or error
   */
  async parse<T = any>(msg: Message): Promise<ParseResult<T>> {
    try {
      // Size validation
      if (this.options.maxSize && msg.content.length > this.options.maxSize) {
        throw new MessageValidationError('Message exceeds maximum size', {
          maxSize: this.options.maxSize,
          actualSize: msg.content.length,
        });
      }

      // Parse content string
      const contentStr = msg.content.toString();

      // Check for null bytes or invalid characters
      if (/\0/.test(contentStr)) {
        throw new MessageValidationError('Message contains null bytes', {
          messageId: msg.properties.messageId,
        });
      }

      // Parse JSON
      let data: any;
      try {
        data = JSON.parse(contentStr);
      } catch (jsonError) {
        throw new MessageParsingError('Failed to parse JSON', {
          error: (jsonError as Error).message,
          content: contentStr.substring(0, 100), // First 100 chars for logging
        });
      }

      // Basic structure validation
      if (data === null || data === undefined) {
        throw new MessageValidationError('Message is null or undefined', {
          messageId: msg.properties.messageId,
        });
      }

      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error as Error,
        strategy: this.options.malformedMessageStrategy,
      };
    }
  }
}
