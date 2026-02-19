/**
 * Application-wide constants.
 *
 * These are compile-time constant values. Some values (like timeouts and limits)
 * have runtime-configurable equivalents in Config that can be overridden via
 * environment variables. Use CONSTANTS for static values (URLs, UI markers) and
 * Config for values that should be runtime-configurable.
 */
export const CONSTANTS = {
  /** Todoist REST API base URL */
  TODOIST_BASE_URL: 'https://api.todoist.com/api/v1',

  /** Prefix added to all AI agent comments for identification */
  AI_INDICATOR: '🤖 **AI Agent**',

  /** Prefix for error messages posted to Todoist */
  ERROR_PREFIX: '⚠️ AI agent error:',

  /** Default polling interval in milliseconds (overridable via POLL_INTERVAL_MS env var) */
  POLL_INTERVAL_MS: 60_000,

  /** Default Claude CLI timeout in milliseconds (overridable via CLAUDE_TIMEOUT_MS env var) */
  CLAUDE_TIMEOUT_MS: 120_000,

  /** Default maximum conversation messages (overridable via MAX_MESSAGES env var) */
  MAX_MESSAGES: 20,

  /** Default Todoist label for AI tasks (overridable via AI_LABEL env var) */
  AI_LABEL: 'AI'
} as const;

/** Type representing the constants object */
export type Constants = typeof CONSTANTS;
