# Sentry Integration Design

**Date:** 2026-03-02
**Status:** approved

## Goal

Add Sentry error tracking and performance monitoring to all three Supabase Edge Functions.

## Scope

- **Error tracking:** capture all unhandled exceptions across webhook, auth-callback, settings
- **Performance:** track per-request latency and AI API call duration

## Architecture

### New file: `_shared/sentry.ts`

Exports:
- `withSentry(handler)` — higher-order function wrapping a `Deno.serve` handler
  - Initializes Sentry on first call using `SENTRY_DSN` env var
  - Wraps handler in a `http.server` span
  - Catches unhandled exceptions, calls `captureException`, flushes, returns 500
  - No-ops gracefully when `SENTRY_DSN` is not set

### Modified files

| File | Change |
|------|--------|
| `webhook/index.ts` | Wrap `Deno.serve(handler)` → `Deno.serve(withSentry(handler))` |
| `auth-callback/index.ts` | Same |
| `settings/index.ts` | Same |
| `_shared/ai.ts` | Wrap each `fetch` in `executePrompt` in `Sentry.startSpan` |

### SDK

`npm:@sentry/deno` via Deno 2 native npm: specifier.

## Config

| Setting | Value |
|---------|-------|
| `SENTRY_DSN` | From Sentry project, stored as Supabase Edge Function secret |
| `tracesSampleRate` | `1.0` (100% — low volume app) |
| `environment` | From `Deno.env.get("ENVIRONMENT")` — `"production"` or `"development"` |

## Performance Spans

| Span | Location | Attributes |
|------|----------|-----------|
| `http.server` | `withSentry` wrapper | `http.method`, `http.url` |
| `ai.chat_completion` | `executePrompt` in `ai.ts` | `model`, `round` |

## Graceful Degradation

When `SENTRY_DSN` is not set (local dev), all Sentry calls are no-ops. No SDK initialization, no errors thrown.

## Implementation Steps

1. Create Sentry project via MCP → get DSN
2. Create `_shared/sentry.ts`
3. Update `_shared/ai.ts` — add span around fetch
4. Update `webhook/index.ts` — wrap with `withSentry`
5. Update `auth-callback/index.ts` — wrap with `withSentry`
6. Update `settings/index.ts` — wrap with `withSentry`
7. Add `SENTRY_DSN` to Supabase secrets (`supabase secrets set`)
8. Deploy and verify errors appear in Sentry
