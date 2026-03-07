# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Todoist AI Agent — a multi-tenant SaaS that adds AI-powered conversations to Todoist tasks. Users mention `@ai` in task comments to get intelligent responses with web search, conversation memory, and bring-your-own-key support.

## Architecture

**Backend:** Supabase Edge Functions (Deno 2, TypeScript) running on Supabase's hosted infrastructure.
**Frontend:** React 19 + Vite + Tailwind CSS 4, deployed to Cloudflare Pages.
**Database:** PostgreSQL with Row Level Security (RLS) via Supabase. Sensitive columns (tokens, API keys) encrypted with AES-256-GCM.
**Auth:** Supabase Auth + Todoist OAuth flow.

### Request Flow

1. User comments `@ai ...` on a Todoist task
2. Todoist sends webhook POST to `/webhook` Edge Function
3. Handler verifies HMAC-SHA256 signature, checks rate limits, decrypts user credentials
4. Builds conversation from task comment history, calls AI provider (Anthropic or OpenAI-compatible)
5. AI can use `web_search` tool (Brave Search) in a multi-round tool loop (max 3 rounds)
6. Response posted back as a Todoist comment

### Key Modules (`supabase/functions/_shared/`)

- `ai.ts` — Dual-provider AI client (Anthropic native + OpenAI-compatible). Auto-detects provider by URL. Handles tool call loop.
- `crypto.ts` — AES-256-GCM encryption/decryption + HMAC verification for webhook signatures.
- `messages.ts` — Converts Todoist comments to AI conversation messages.
- `todoist.ts` — Todoist REST API client (comments, tasks, projects, file downloads).
- `rate-limit.ts` — Per-user rate limiting with account blocking via PostgreSQL function.
- `supabase.ts` — Two client factories: `createServiceClient` (admin) and `createUserClient` (RLS-scoped).

### Edge Functions

| Function | JWT | Purpose |
|----------|-----|---------|
| `webhook` | No | Receives Todoist webhooks, triggers AI responses |
| `auth-callback` | No | Handles Todoist OAuth token exchange |
| `settings` | No* | CRUD for user preferences (validates auth header manually) |

*Settings validates the Authorization header via Supabase user client, not Edge Function JWT verification.

## Commands

```bash
# Install dependencies
npm install && cd frontend && npm install && cd ..

# Start local Supabase (requires Supabase CLI)
npm run supabase:start
npm run supabase:reset          # Apply migrations

# Serve Edge Functions locally
npm run functions:serve          # Reads supabase/.env.local

# Frontend dev server
npm run frontend:dev

# Run all Deno tests (backend)
npm test
# Single test file
deno test supabase/functions/tests/crypto.test.ts --no-check --allow-env --allow-read

# Frontend tests (Vitest)
cd frontend && npm test

# Lint
deno lint supabase/functions/    # Backend
cd frontend && npm run lint      # Frontend (ESLint)

# Build frontend
cd frontend && npm run build     # Runs tsc -b && vite build
```

## Testing Patterns

- Backend tests use Deno's built-in test runner with `jsr:@std/assert`.
- All tests are in `supabase/functions/tests/` — one file per module.
- Tests set env vars at the top of each file and use dynamic imports (`await import(...)`) to load modules after env setup.
- Supabase client triggers background token refresh, so tests disable sanitizers: `Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false })`.
- A common pattern wraps this in a helper `function t(name, fn)`.
- Tests mock `fetch` via `globalThis.fetch` assignment for external API calls.

## Environment Setup

Backend secrets go in `supabase/.env.local`. Frontend env in `frontend/.env.local`. See `.env.example` for all variables. Required:
- `TODOIST_CLIENT_ID`, `TODOIST_CLIENT_SECRET` — OAuth app credentials
- `ENCRYPTION_KEY` — Base64-encoded 32-byte key for AES-256-GCM
- `DEFAULT_AI_BASE_URL`, `DEFAULT_AI_API_KEY`, `DEFAULT_AI_MODEL` — Default AI provider

## Database

Schema managed via sequential SQL migrations in `supabase/migrations/`. Main table is `users_config` with RLS policy `auth.uid() = id`. Rate limiting uses a PostgreSQL function `check_rate_limit()` for atomic counter updates.

## CI

GitHub Actions runs on push/PR to `main`:
- `frontend` job: Node 22, `npm ci`, lint, test (Vitest), build
- `deno-tests` job: Deno, runs `deno test supabase/functions/tests/ --no-check --allow-env`
