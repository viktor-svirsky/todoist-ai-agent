export const TODOIST_API_URL = "https://api.todoist.com/api/v1";
export const TODOIST_OAUTH_URL = "https://todoist.com/oauth/authorize";
export const TODOIST_TOKEN_URL = "https://todoist.com/oauth/access_token";
export const TODOIST_SYNC_URL = "https://api.todoist.com/api/v1/sync";
export const TODOIST_USER_URL = "https://api.todoist.com/api/v1/user";

export const AI_INDICATOR = "🤖 **AI Agent**";
export const ERROR_PREFIX = "⚠️ AI agent error:";
export const PROGRESS_INDICATOR = "🤖 **AI Agent**\n\n_Reviewing..._";

export const MAX_TOOL_ROUNDS = 3;
export const DEFAULT_AI_MODEL = "claude-opus-4-6";
export const DEFAULT_MAX_MESSAGES = 10;
export const DEFAULT_MAX_TOKENS = 2048;

export const MAX_IMAGE_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB
export const TODOIST_API_TIMEOUT_MS = 30_000; // 30 seconds

export const RETRY_MAX_RETRIES = 2;
export const RETRY_BASE_DELAY_MS = 500;
export const RETRY_MAX_DELAY_MS = 5000;

export const RATE_LIMIT_MAX_REQUESTS = 10;
export const RATE_LIMIT_WINDOW_SECONDS = 120;

export const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024; // 1 MB
export const MAX_AI_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
