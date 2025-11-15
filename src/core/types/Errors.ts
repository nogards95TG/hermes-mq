/**
 * Base error class for all Hermes errors
 */
export class HermesError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Connection-related errors
 */
export class ConnectionError extends HermesError {
  constructor(message: string, details?: any) {
    super(message, 'CONNECTION_ERROR', details);
  }
}

/**
 * Timeout errors
 */
export class TimeoutError extends HermesError {
  constructor(message: string, details?: any) {
    super(message, 'TIMEOUT_ERROR', details);
  }
}

/**
 * Channel-related errors
 */
export class ChannelError extends HermesError {
  constructor(message: string, details?: any) {
    super(message, 'CHANNEL_ERROR', details);
  }
}

/**
 * Validation errors
 */
export class ValidationError extends HermesError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', details);
  }
}

/**
 * Message validation errors (poison message handling)
 */
export class MessageValidationError extends HermesError {
  constructor(message: string, details?: any) {
    super(message, 'MESSAGE_VALIDATION_ERROR', details);
  }
}

/**
 * Message parsing errors
 */
export class MessageParsingError extends HermesError {
  constructor(message: string, details?: any) {
    super(message, 'MESSAGE_PARSING_ERROR', details);
  }
}
