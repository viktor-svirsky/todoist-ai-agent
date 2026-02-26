# Multi-Tenant SaaS Design

## Overview

Convert todoist-ai-agent from a single-user Node.js app to a multi-tenant SaaS running entirely on Supabase, with a static frontend for onboarding and settings.

## Decisions

| Decision | Choice |
|----------|--------|
| Database | Supabase (PostgreSQL) |
| User experience | Landing page + OAuth + settings page |
| AI keys | Shared default + BYOK option |
| Brave Search | Shared default + BYOK option |
| Frontend hosting | Vercel or Cloudflare Pages |
| Backend | Supabase Edge Functions (Deno) |
| AI timeout | Accept Edge Function limits (60-150s) |
| Trigger | Configurable per user (default `@ai`) |
| Conversations | Deleted on task completion |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (Vercel/Cloudflare Pages)                     │
│  React + Tailwind + Supabase JS                         │
│  /, /settings, /auth/callback                           │
└──────────┬──────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  Supabase                                               │
│                                                         │
│  Auth ─── Todoist OAuth (custom provider)               │
│                                                         │
│  Edge Functions:                                        │
│    auth-callback  ── OAuth exchange, webhook registration│
│    webhook/:id    ── HMAC verify → AI call → comment    │
│    settings       ── CRUD user preferences              │
│                                                         │
│  Database (PostgreSQL):                                 │
│    users_config   ── tokens, settings, trigger word     │
│    conversations  ── per-task, per-user                 │
│    messages       ── normalized chat history            │
│                                                         │
│  Vault ── encrypted token/key storage                   │
│  RLS   ── per-user data isolation                       │
└──────────┬──────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────┐    ┌──────────────────────┐
│  Todoist API         │    │  AI API              │
│  - OAuth             │    │  - Shared default    │
│  - Webhooks          │    │  - Or user's own key │
│  - Comments          │    │  - OpenAI-compatible │
│  - Tasks             │    └──────────────────────┘
└──────────────────────┘
           │
           ▼
┌──────────────────────┐
│  Brave Search API    │
│  - Shared default    │
│  - Or user's own key │
└──────────────────────┘
```

## Database Schema

```sql
-- User settings and tokens (extends Supabase Auth)
create table users_config (
  id                  uuid primary key references auth.users(id) on delete cascade,
  todoist_token       text not null,          -- encrypted via Vault
  todoist_user_id     text unique not null,   -- for webhook routing
  webhook_secret      text not null,          -- per-user HMAC secret
  trigger_word        text not null default '@ai',
  custom_ai_base_url  text,                   -- null = shared default
  custom_ai_api_key   text,                   -- null = shared default, encrypted
  custom_ai_model     text,                   -- null = shared default
  custom_brave_key    text,                   -- null = shared default, encrypted
  max_messages        int not null default 20,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Conversations (per-task, per-user)
create table conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users_config(id) on delete cascade,
  task_id         text not null,
  title           text,
  created_at      timestamptz not null default now(),
  last_activity   timestamptz not null default now(),
  unique(user_id, task_id)
);

-- Normalized messages
create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz not null default now()
);

-- Indexes
create index idx_conversations_user_task on conversations(user_id, task_id);
create index idx_messages_conversation on messages(conversation_id, created_at);
create index idx_users_config_todoist_user on users_config(todoist_user_id);
```

### Row Level Security

```sql
-- users_config: users see only their own row
alter table users_config enable row level security;
create policy "users own config" on users_config
  for all using (auth.uid() = id);

-- conversations: users see only their own
alter table conversations enable row level security;
create policy "users own conversations" on conversations
  for all using (auth.uid() = user_id);

-- messages: through conversation ownership
alter table messages enable row level security;
create policy "users own messages" on messages
  for all using (
    conversation_id in (
      select id from conversations where user_id = auth.uid()
    )
  );
```

## OAuth & Onboarding Flow

```
User clicks "Connect Todoist" on landing page
        ↓
Redirect to Todoist OAuth:
  https://todoist.com/oauth/authorize?client_id=XXX&scope=data:read_write&state=<random>
        ↓
User authorizes → Todoist redirects to callback URL
        ↓
Edge Function: /auth-callback
  1. Exchange code for access_token
  2. Fetch Todoist user profile → get todoist_user_id
  3. Create Supabase Auth user + users_config row
  4. Store todoist_token (encrypted) in users_config
  5. Register webhook via Todoist API:
     POST https://api.todoist.com/rest/v2/webhooks
       url: https://<project>.supabase.co/functions/v1/webhook/<todoist_user_id>
       events: ["note:added", "item:completed"]
  6. Store webhook secret in users_config
  7. Redirect to settings page with session
```

- Webhook URL contains `todoist_user_id` as routing key
- Webhooks are registered programmatically — no manual setup
- Todoist OAuth is the only login method

## Edge Functions

### `auth-callback`
OAuth code exchange, user creation, webhook registration. Redirects to settings page on success.

### `webhook/:userId`
1. Look up user by `todoist_user_id` from URL path
2. Verify HMAC with user's `webhook_secret`
3. Check trigger word match (from user's config)
4. Load conversation from DB (or create)
5. Call AI API (user's custom key or shared default)
6. Post response as Todoist comment using user's token
7. Save conversation to DB
8. On `item:completed`: delete conversation

### `settings`
Protected by Supabase Auth JWT.
- GET: current trigger word, whether custom keys are set, model
- PUT: update trigger word, AI key/url/model, Brave key

## Frontend

Static React + Tailwind SPA. Three views:

- `/` — Landing page with "Connect Todoist" button
- `/auth/callback` — OAuth redirect handler
- `/settings` — Trigger word, AI provider config, Brave key, disconnect button

## Security

- **Vault encryption** for all tokens and API keys at rest
- **RLS** on all tables, enforced at database level
- **Per-user HMAC** webhook verification
- **Service role** used by Edge Functions for webhook processing (no user session)
- **Account deletion** revokes webhook, cascades all data, deletes Auth user
- **Shared keys** stored as Edge Function secrets, never exposed to frontend

## Migration from Current Architecture

**Deleted:**
- Express server, index.ts, server.ts
- ConversationRepository (JSON file)
- LaunchAgent plist
- Node.js-specific code

**Rewritten for Deno:**
- AI client logic (OpenAI SDK works in Deno)
- Brave Search client
- Task processing logic
- Webhook handler + HMAC verification

**New:**
- Supabase project (DB, Auth, Vault, RLS, Edge Functions)
- OAuth flow
- Settings API
- Frontend (React)

**Business logic preserved:**
- Trigger word matching, conversation management, tool-calling loop
- OpenAI SDK message building, system prompt
- Todoist comment posting, task fetching, image attachments
