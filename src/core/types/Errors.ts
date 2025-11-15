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
 * Transient errors indicate retryable failures (network, temporary service outage, timeouts)
 */
export class TransientError extends HermesError {
  constructor(message: string, details?: any) {
    super(message, 'TRANSIENT_ERROR', details);
  }
}

/**
 * Permanent errors indicate non-retryable failures (validation, malformed payload, logic errors)
 */
export class PermanentError extends HermesError {
  constructor(message: string, details?: any) {
    super(message, 'PERMANENT_ERROR', details);
  }
}

/**
 * Heuristic to detect transient errors when explicit TransientError isn't used.
 */
export function isTransientError(error: Error): boolean {
  if (!error) return false;

  if (error instanceof TransientError) return true;

  const msg = (error.message || '').toString();
  const name = (error as any).name || '';

  const transientPatterns: Array<RegExp> = [
    /timeout/i,
    /ECONNREFUSED/,
    /ETIMEDOUT/,
    /ENOTFOUND/,
    /503/,
    /connection/i,
  ];

  return transientPatterns.some((p) => p.test(msg) || p.test(name));
}
