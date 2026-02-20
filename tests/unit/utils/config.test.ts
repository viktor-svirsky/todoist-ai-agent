import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig } from '../../../src/utils/config';

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TODOIST_API_TOKEN: 'test-token',
      TODOIST_WEBHOOK_SECRET: 'test-secret',
      PORT: '9000'
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load configuration from environment', () => {
    const config = getConfig();

    expect(config.todoistApiToken).toBe('test-token');
    expect(config.todoistWebhookSecret).toBe('test-secret');
    expect(config.port).toBe(9000);
  });

  it('should use default values', () => {
    delete process.env.PORT;
    delete process.env.POLL_INTERVAL_MS;

    const config = getConfig();

    expect(config.port).toBe(9000);
    expect(config.pollIntervalMs).toBe(60000);
    expect(config.claudeTimeoutMs).toBe(120000);
    expect(config.maxMessages).toBe(20);
    expect(config.aiLabel).toBe('AI');
  });

  it('should throw error if required env vars missing', () => {
    delete process.env.TODOIST_API_TOKEN;

    expect(() => getConfig()).toThrow('TODOIST_API_TOKEN');
  });

  it('should throw error if TODOIST_WEBHOOK_SECRET missing', () => {
    delete process.env.TODOIST_WEBHOOK_SECRET;

    expect(() => getConfig()).toThrow('TODOIST_WEBHOOK_SECRET');
  });

  it('should throw error for invalid PORT', () => {
    process.env.PORT = 'not-a-number';

    expect(() => getConfig()).toThrow('PORT must be a valid number');
  });

  it('should throw error for invalid port range', () => {
    process.env.PORT = '99999';

    expect(() => getConfig()).toThrow('PORT must be at most 65535');
  });

  it('should throw error for invalid POLL_INTERVAL_MS', () => {
    process.env.POLL_INTERVAL_MS = '0';

    expect(() => getConfig()).toThrow('POLL_INTERVAL_MS must be at least 1000');
  });
});
