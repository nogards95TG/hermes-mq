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
 * Connection-related errors.
 * - ConnectionError.failed() - Initial connection failure
 * - ConnectionError.closed() - Unexpected connection closure
 * - ConnectionError.auth() - Authentication failure
 * - ConnectionError.timeout() - Connection timeout
 * - ConnectionError.tls() - SSL/TLS errors
 */
export class ConnectionError extends HermesError {
  private constructor(message: string, code: string, details?: any) {
    super(message, code, details);
  }

  static failed(message: string, details?: any): ConnectionError {
    return new ConnectionError(message, 'CONNECTION_ERROR:FAILED', details);
  }

  static closed(message: string, details?: any): ConnectionError {
    return new ConnectionError(message, 'CONNECTION_ERROR:CLOSED', details);
  }

  static auth(message: string, details?: any): ConnectionError {
    return new ConnectionError(message, 'CONNECTION_ERROR:AUTH', details);
  }

  static timeout(message: string, details?: any): ConnectionError {
    return new ConnectionError(message, 'CONNECTION_ERROR:TIMEOUT', details);
  }

  static tls(message: string, details?: any): ConnectionError {
    return new ConnectionError(message, 'CONNECTION_ERROR:TLS', details);
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
 * Channel-related errors.
 * - ChannelError.creationFailed() - Failed to create channel
 * - ChannelError.poolDraining() - Pool is draining
 * - ChannelError.closed() - Channel closed unexpectedly
 * - ChannelError.flow() - Flow control active
 * - ChannelError.timeout() - Channel operation timeout
 */
export class ChannelError extends HermesError {
  private constructor(message: string, code: string, details?: any) {
    super(message, code, details);
  }

  static creationFailed(message: string, details?: any): ChannelError {
    return new ChannelError(message, 'CHANNEL_ERROR:CREATION_FAILED', details);
  }

  static poolDraining(message: string, details?: any): ChannelError {
    return new ChannelError(message, 'CHANNEL_ERROR:POOL_DRAINING', details);
  }

  static closed(message: string, details?: any): ChannelError {
    return new ChannelError(message, 'CHANNEL_ERROR:CLOSED', details);
  }

  static flow(message: string, details?: any): ChannelError {
    return new ChannelError(message, 'CHANNEL_ERROR:FLOW', details);
  }

  static timeout(message: string, details?: any): ChannelError {
    return new ChannelError(message, 'CHANNEL_ERROR:TIMEOUT', details);
  }
}

/**
 * Validation errors.
 * - ValidationError.commandRequired() - Command is required
 * - ValidationError.handlerRequired() - Handler is required/missing
 * - ValidationError.exchangeRequired() - Exchange is required
 * - ValidationError.patternRequired() - Pattern is required
 * - ValidationError.eventNameRequired() - Event name is required
 * - ValidationError.invalidConfig() - Invalid configuration
 */
export class ValidationError extends HermesError {
  private constructor(message: string, code: string, details?: any) {
    super(message, code, details);
  }

  static commandRequired(message: string, details?: any): ValidationError {
    return new ValidationError(message, 'VALIDATION_ERROR:COMMAND_REQUIRED', details);
  }

  static handlerRequired(message: string, details?: any): ValidationError {
    return new ValidationError(message, 'VALIDATION_ERROR:HANDLER_REQUIRED', details);
  }

  static exchangeRequired(message: string, details?: any): ValidationError {
    return new ValidationError(message, 'VALIDATION_ERROR:EXCHANGE_REQUIRED', details);
  }

  static patternRequired(message: string, details?: any): ValidationError {
    return new ValidationError(message, 'VALIDATION_ERROR:PATTERN_REQUIRED', details);
  }

  static eventNameRequired(message: string, details?: any): ValidationError {
    return new ValidationError(message, 'VALIDATION_ERROR:EVENT_NAME_REQUIRED', details);
  }

  static invalidConfig(message: string, details?: any): ValidationError {
    return new ValidationError(message, 'VALIDATION_ERROR:INVALID_CONFIG', details);
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

/**
 * State-related errors
 * Used when operations are attempted on objects in invalid states
 * (e.g., calling methods before initialization)
 */
export class StateError extends HermesError {
  constructor(message: string, details?: any) {
    super(message, 'STATE_ERROR', details);
  }
}

/**
 * Retry exhausted errors
 * Used when all retry attempts have been exhausted
 */
export class RetryExhaustedError extends HermesError {
  constructor(message: string, details?: any) {
    super(message, 'RETRY_EXHAUSTED_ERROR', details);
  }
}

/**
 * Publish-related errors
 * - PublishError.publishFailed() - Failed to publish message
 */
export class PublishError extends HermesError {
  private constructor(message: string, code: string, details?: any) {
    super(message, code, details);
  }
  static publishFailed(message: string, details?: any): PublishError {
    return new PublishError(message, 'PUBLISH_ERROR:PUBLISH_FAILED', details);
  }
}
