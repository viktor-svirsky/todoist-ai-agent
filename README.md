# Todoist AI Agent

A multi-tenant AI agent SaaS that connects to users' Todoist accounts via OAuth. Mention a trigger word (default `@ai`) in a task comment, and the agent responds with an AI-generated answer posted back as a Todoist comment.

## Features

- **Self-service onboarding** via Todoist OAuth
- **Per-user configuration**: custom trigger word, AI provider (BYOK), Brave search key
- **Web search**: optionally uses Brave Search for current information
- **Conversation context**: maintains message history per task (cleared on task completion)
- **Row Level Security**: complete data isolation between users

## Architecture

```
User → Todoist OAuth → Supabase Auth → users_config row
Todoist → POST /webhook/:userId → Edge Function → AI (OpenAI-compatible) → Todoist comment
User → Settings page → Edge Function → users_config update
```

**Stack**: Supabase (PostgreSQL + Edge Functions + Auth), React + Tailwind CSS, Deno runtime

## Project Structure

```
todoist-ai-agent/
├── supabase/
│   ├── config.toml                      # Supabase project config
│   ├── migrations/
│   │   └── 00001_initial_schema.sql     # Schema, RLS policies, indexes
│   └── functions/
│       ├── _shared/
│       │   ├── supabase.ts              # Supabase client helpers
│       │   ├── constants.ts             # Shared constants
│       │   ├── todoist.ts               # Todoist API client
│       │   ├── search.ts               # Brave Search client
│       │   └── ai.ts                    # AI chat completions + tool loop
│       ├── auth-callback/index.ts       # OAuth code exchange + onboarding
│       ├── webhook/index.ts             # Multi-tenant webhook handler
│       └── settings/index.ts            # User settings CRUD
├── frontend/
│   ├── src/
│   │   ├── main.tsx                     # Routes: /, /settings, /auth/callback
│   │   ├── lib/supabase.ts             # Supabase JS client
│   │   └── pages/
│   │       ├── Landing.tsx              # Connect Todoist button
│   │       ├── AuthCallback.tsx         # OAuth completion handler
│   │       └── Settings.tsx             # User preferences form
│   └── package.json
└── package.json                         # Root scripts
```

## Setup

### Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli)
- Node.js 22+

### 1. Start Supabase locally

```bash
npx supabase start
npx supabase db reset   # applies migrations
```

### 2. Create a Todoist App

1. Go to [Todoist App Management](https://developer.todoist.com/appconsole.html)
2. Create a new app
3. Set the **OAuth redirect URL** to: `https://<your-supabase-url>/functions/v1/auth-callback`
4. Note the **Client ID** and **Client Secret**

### 3. Configure environment

Create `supabase/.env.local`:

```env
TODOIST_CLIENT_ID=your_client_id
TODOIST_CLIENT_SECRET=your_client_secret
DEFAULT_AI_BASE_URL=https://api.openai.com/v1
DEFAULT_AI_API_KEY=your_openai_key
DEFAULT_AI_MODEL=gpt-4o-mini
DEFAULT_BRAVE_API_KEY=your_brave_key    # optional
PUBLIC_SITE_URL=http://localhost:5173
```

Create `frontend/.env.local`:

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key from supabase start output>
VITE_TODOIST_CLIENT_ID=your_client_id
```

### 4. Serve Edge Functions

```bash
npx supabase functions serve --env-file supabase/.env.local
```

### 5. Run the frontend

```bash
cd frontend && npm install && npm run dev
```

### 6. Connect your Todoist account

Open `http://localhost:5173`, click **Connect Todoist**, and authorize the app.

## Usage

1. Open any task in Todoist
2. Add a comment containing your trigger word (default: `@ai`) followed by your question
3. The agent posts a response as a new comment
4. Continue the conversation by adding more comments with the trigger word
5. When the task is completed, the conversation history is cleared

## Development

```bash
# Start everything locally
npm run supabase:start
npm run functions:serve
npm run frontend:dev

# Build frontend
npm run frontend:build
```

## Security

- **HMAC verification**: each user gets a unique webhook secret; every incoming webhook is verified
- **Row Level Security**: users can only access their own data
- **Supabase Auth**: JWT-based authentication for the settings API
- **No secrets in code**: all credentials stored in environment variables

## License

ISC
