import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../../../src/utils/logger';

describe('Logger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should log info messages with timestamp', () => {
    logger.info('Test message', { key: 'value' });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/\[INFO\].*Test message.*key/)
    );
  });

  it('should log error messages with context', () => {
    logger.error('Error occurred', { taskId: '123', error: 'Failed' });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/\[ERROR\].*Error occurred.*taskId/)
    );
  });

  it('should log warnings', () => {
    logger.warn('Warning message');

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/\[WARN\].*Warning message/)
    );
  });

  it('should log debug messages when DEBUG is set', () => {
    process.env.DEBUG = 'true';
    logger.debug('Debug message', { debug: true });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/.*\[DEBUG\].*Debug message.*debug/)
    );

    delete process.env.DEBUG;
  });

  it('should not log debug messages when DEBUG is not set', () => {
    delete process.env.DEBUG;
    logger.debug('Debug message');

    expect(console.log).not.toHaveBeenCalled();
  });

  it('should serialize Error objects correctly', () => {
    const error = new Error('Test error');
    logger.error('Error occurred', { error });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/.*\[ERROR\].*Error occurred.*Test error/)
    );
  });
});
