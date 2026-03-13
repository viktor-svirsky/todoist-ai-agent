import {
  TODOIST_API_TIMEOUT_MS,
  RETRY_MAX_RETRIES,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
} from "./constants.ts";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof TypeError) return true; // network errors
  return false;
}

function isSafeToRetry(method: string | undefined): boolean {
  const m = (method || "GET").toUpperCase();
  return m === "GET" || m === "HEAD" || m === "OPTIONS";
}

function computeDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, maxMs);
  return capped * (0.5 + Math.random() * 0.5);
}

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: RetryOptions,
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? RETRY_MAX_RETRIES;
  const baseDelayMs = options?.baseDelayMs ?? RETRY_BASE_DELAY_MS;
  const maxDelayMs = options?.maxDelayMs ?? RETRY_MAX_DELAY_MS;
  const timeoutMs = options?.timeoutMs ?? TODOIST_API_TIMEOUT_MS;
  const safeMethod = isSafeToRetry(init?.method);

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });

      // For non-safe methods (POST, etc.), only retry on connection-level errors
      // (caught below), never on HTTP status codes — the server may have already
      // processed the request.
      if (res.ok || !safeMethod || !isRetryableStatus(res.status) || attempt === maxRetries) {
        return res;
      }
      // Retryable status on safe method — fall through to delay and retry
    } catch (error) {
      if (attempt === maxRetries || !isRetryableError(error)) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }

    const delay = computeDelay(attempt, baseDelayMs, maxDelayMs);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw lastError || new Error("Retry exhausted");
}
