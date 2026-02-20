import type { Config } from '../types/index.js';

function parseIntSafe(value: string | undefined, defaultValue: string, name: string, min?: number, max?: number): number {
  const parsed = parseInt(value || defaultValue, 10);
  if (isNaN(parsed)) {
    throw new Error(`${name} must be a valid number`);
  }
  if (min !== undefined && parsed < min) {
    throw new Error(`${name} must be at least ${min}`);
  }
  if (max !== undefined && parsed > max) {
    throw new Error(`${name} must be at most ${max}`);
  }
  return parsed;
}

export function getConfig(): Config {
  const todoistApiToken = process.env.TODOIST_API_TOKEN;
  const todoistWebhookSecret = process.env.TODOIST_WEBHOOK_SECRET;

  if (!todoistApiToken) {
    throw new Error('TODOIST_API_TOKEN environment variable is required');
  }

  if (!todoistWebhookSecret) {
    throw new Error('TODOIST_WEBHOOK_SECRET environment variable is required');
  }

  return {
    todoistApiToken,
    todoistWebhookSecret,
    port: parseIntSafe(process.env.PORT, '9000', 'PORT', 1, 65535),
    pollIntervalMs: parseIntSafe(process.env.POLL_INTERVAL_MS, '60000', 'POLL_INTERVAL_MS', 1000),
    claudeTimeoutMs: parseIntSafe(process.env.CLAUDE_TIMEOUT_MS, '120000', 'CLAUDE_TIMEOUT_MS', 1000),
    maxMessages: parseIntSafe(process.env.MAX_MESSAGES, '20', 'MAX_MESSAGES', 1),
    aiLabel: process.env.AI_LABEL || 'AI'
  };
}
