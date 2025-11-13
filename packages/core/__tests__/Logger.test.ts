import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SilentLogger, ConsoleLogger } from '../src/types/Logger';

describe('Logger', () => {
  describe('SilentLogger', () => {
    it('should not output anything', () => {
      const logger = new SilentLogger();
      const spy = vi.spyOn(console, 'log');

      logger.debug('test');
      logger.info('test');
      logger.warn('test');
      logger.error('test');

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('ConsoleLogger', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should log debug messages when minLevel is debug', () => {
      const logger = new ConsoleLogger('debug');
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      logger.debug('test message', { foo: 'bar' });

      expect(spy).toHaveBeenCalledWith('[DEBUG] test message {"foo":"bar"}');
    });

    it('should not log debug messages when minLevel is info', () => {
      const logger = new ConsoleLogger('info');
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      logger.debug('test message');

      expect(spy).not.toHaveBeenCalled();
    });

    it('should log info messages', () => {
      const logger = new ConsoleLogger('info');
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});

      logger.info('test message', { key: 'value' });

      expect(spy).toHaveBeenCalledWith('[INFO] test message {"key":"value"}');
    });

    it('should log warn messages', () => {
      const logger = new ConsoleLogger('info');
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      logger.warn('test warning');

      expect(spy).toHaveBeenCalledWith('[WARN] test warning');
    });

    it('should log error messages with error object', () => {
      const logger = new ConsoleLogger('info');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const error = new Error('Something went wrong');
      logger.error('test error', error, { context: 'test' });

      expect(errorSpy).toHaveBeenCalledWith(
        '[ERROR] test error - Something went wrong {"context":"test"}'
      );
      expect(errorSpy).toHaveBeenCalledWith(error.stack);
    });

    it('should log error messages without error object', () => {
      const logger = new ConsoleLogger('info');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logger.error('test error');

      expect(spy).toHaveBeenCalledWith('[ERROR] test error');
    });

    it('should respect minLevel hierarchy', () => {
      const logger = new ConsoleLogger('error');
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');

      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
