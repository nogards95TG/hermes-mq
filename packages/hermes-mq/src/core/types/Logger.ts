/**
 * Logger interface for flexible logging integration
 */
export interface Logger {
  debug(message: string, context?: Record<string, any>): void;
  info(message: string, context?: Record<string, any>): void;
  warn(message: string, context?: Record<string, any>): void;
  error(message: string, error?: Error, context?: Record<string, any>): void;
}

/**
 * Silent logger implementation (no-op)
 */
export class SilentLogger implements Logger {
  debug(_message: string, _context?: Record<string, any>): void {}
  info(_message: string, _context?: Record<string, any>): void {}
  warn(_message: string, _context?: Record<string, any>): void {}
  error(_message: string, _context?: Record<string, any>): void {}
}

/**
 * Console logger implementation
 */
export class ConsoleLogger implements Logger {
  private minLevel: 'debug' | 'info' | 'warn' | 'error';
  private levels = { debug: 0, info: 1, warn: 2, error: 3 };

  constructor(minLevel: 'debug' | 'info' | 'warn' | 'error' = 'info') {
    this.minLevel = minLevel;
  }

  private shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
    return this.levels[level] >= this.levels[this.minLevel];
  }

  private formatContext(context?: Record<string, any>): string {
    return context ? ` ${JSON.stringify(context)}` : '';
  }

  debug(message: string, context?: Record<string, any>): void {
    if (this.shouldLog('debug')) {
      console.debug(`[DEBUG] ${message}${this.formatContext(context)}`);
    }
  }

  info(message: string, context?: Record<string, any>): void {
    if (this.shouldLog('info')) {
      console.info(`[INFO] ${message}${this.formatContext(context)}`);
    }
  }

  warn(message: string, context?: Record<string, any>): void {
    if (this.shouldLog('warn')) {
      console.warn(`[WARN] ${message}${this.formatContext(context)}`);
    }
  }

  error(message: string, error?: Error, context?: Record<string, any>): void {
    if (this.shouldLog('error')) {
      const errorInfo = error ? ` - ${error.message}` : '';
      console.error(`[ERROR] ${message}${errorInfo}${this.formatContext(context)}`);
      if (error?.stack) {
        console.error(error.stack);
      }
    }
  }
}
