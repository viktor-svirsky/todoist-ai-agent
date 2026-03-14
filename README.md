<p align="center">
  <img src="https://img.shields.io/badge/Todoist-E44332?style=for-the-badge&logo=todoist&logoColor=white" alt="Todoist" />
  <img src="https://img.shields.io/badge/Supabase-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/Deno-000000?style=for-the-badge&logo=deno&logoColor=white" alt="Deno" />
  <img src="https://img.shields.io/badge/React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
</p>

<h1 align="center">Todoist AI Agent</h1>

<p align="center">
  <strong>A multi-tenant SaaS that brings AI-powered conversations to your Todoist tasks.</strong>
</p>

<p align="center">
  Mention <code>@ai</code> in any task comment and get intelligent responses — with web search, conversation memory, and bring-your-own-key support.
</p>

<p align="center">
  <a href="https://todoist-ai-agent.pages.dev"><img src="https://img.shields.io/badge/Live_Demo-Try_it_now-E44332?style=for-the-badge" alt="Live Demo" /></a>
</p>

<p align="center">
  <a href="https://github.com/viktor-svirsky/todoist-ai-agent/actions/workflows/ci.yml"><img src="https://github.com/viktor-svirsky/todoist-ai-agent/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/viktor-svirsky/todoist-ai-agent/actions/workflows/deploy.yml"><img src="https://github.com/viktor-svirsky/todoist-ai-agent/actions/workflows/deploy.yml/badge.svg" alt="Deploy" /></a>
  <a href="https://github.com/viktor-svirsky/todoist-ai-agent/actions/workflows/security.yml"><img src="https://github.com/viktor-svirsky/todoist-ai-agent/actions/workflows/security.yml/badge.svg" alt="Security Audit" /></a>
  <img src="https://img.shields.io/static/v1?label=version&message=v1.3.0&color=blue" alt="Version" /> <!-- x-release-please-version -->
  <img src="https://img.shields.io/badge/license-ISC-green" alt="License" />
</p>

---

## How It Works

```mermaid
sequenceDiagram
    participant U as User
    participant T as Todoist
    participant W as Webhook (Edge Function)
    participant AI as AI Provider
    participant B as Brave Search

    U->>T: Comment "@ai What is X?"
    T->>W: POST /webhook/:userId
    W->>W: Verify HMAC signature
    W->>AI: Chat completion request
    AI-->>W: Tool call: web_search("X")
    W->>B: Search query
    B-->>W: Search results
    W->>AI: Results + continue
    AI-->>W: Final answer
    W->>T: Post comment with response
    T-->>U: See AI response
```

## Features

| Feature | Description |
|---------|-------------|
| **Self-service onboarding** | Connect via Todoist OAuth in one click |
| **Trigger word** | Customizable per user (default: `@ai`) |
| **Web search** | Real-time information via Brave Search API |
| **Conversation memory** | Full message history per task |
| **Rate limiting** | Per-user webhook and settings rate limits with account blocking |
| **Bring your own key** | Supports Anthropic (Claude) and any OpenAI-compatible provider, with key validation before save |
| **Image support** | Attach images to comments for multimodal AI analysis |
| **Data isolation** | Row Level Security ensures complete tenant separation |
| **Error tracking** | Optional Sentry integration for monitoring |
| **Accessible UI** | ARIA labels, focus management, keyboard navigation, screen reader support |

## Architecture

```mermaid
graph LR
    subgraph Frontend ["Frontend (Cloudflare Pages)"]
        LP[Landing Page]
        SP[Settings Page]
    end

    subgraph Supabase ["Supabase"]
        Auth[Auth]
        DB[(PostgreSQL + RLS)]
        EF[Edge Functions]
    end

    subgraph External ["External Services"]
        TD[Todoist API]
        AI[AI Provider]
        BS[Brave Search]
    end

    LP -->|OAuth| Auth
    SP -->|JWT| EF
    TD -->|Webhook| EF
    EF -->|CRUD| DB
    EF -->|Chat| AI
    EF -->|Search| BS
    EF -->|Comments| TD
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Deno 2 (Edge Functions) |
| **Backend** | Supabase Edge Functions (TypeScript) |
| **Frontend** | React 19, Vite, Tailwind CSS 4 |
| **Database** | PostgreSQL with Row Level Security |
| **Auth** | Supabase Auth + Todoist OAuth |
| **Hosting** | Supabase (backend), Cloudflare Pages (frontend) |
| **Monitoring** | Sentry (optional) |

## Project Structure

```
todoist-ai-agent/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                  # Lint, test, build
│   │   ├── codeql.yml              # CodeQL code scanning
│   │   ├── deploy.yml              # Edge Functions + Cloudflare Pages
│   │   └── security.yml            # npm audit
│   ├── ISSUE_TEMPLATE/             # Bug report & feature request forms
│   ├── pull_request_template.md
│   └── dependabot.yml              # Automated dependency updates
├── supabase/
│   ├── config.toml
│   ├── migrations/                 # Database schema + RLS policies
│   └── functions/
│       ├── _shared/
│       │   ├── ai.ts               # Chat completions + tool loop
│       │   ├── constants.ts        # API URLs, defaults, limits
│       │   ├── crypto.ts           # AES-256-GCM encryption, HMAC verification, OAuth state signing
│       │   ├── messages.ts         # Comment → message parsing
│       │   ├── rate-limit.ts       # Per-user rate limiting + account blocking
│       │   ├── search.ts           # Brave Search client
│       │   ├── sentry.ts           # Error tracking
│       │   ├── supabase.ts         # Supabase client factories
│       │   ├── todoist.ts          # Todoist REST API client
│       │   └── validation.ts       # Input validation
│       ├── auth-start/             # OAuth initiation (CSRF-protected)
│       ├── auth-callback/          # OAuth completion handler
│       ├── webhook/                # Todoist webhook processor
│       ├── settings/               # User config CRUD
│       ├── health/                 # Health check endpoint (env + DB)
│       └── tests/                  # Deno test suite
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Landing.tsx         # OAuth initiation
│       │   ├── AuthCallback.tsx    # OAuth completion
│       │   └── Settings.tsx        # User preferences
│       └── lib/supabase.ts         # Supabase client
├── .env.example                    # Environment template
├── deno.json                       # Deno configuration
└── package.json                    # Root scripts
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Deno](https://deno.land/) (for running tests locally)
- A [Todoist App](https://developer.todoist.com/appconsole.html) (Client ID + Secret)

### 1. Clone and install

```bash
git clone https://github.com/viktor-svirsky/todoist-ai-agent.git
cd todoist-ai-agent
npm install
cd frontend && npm install && cd ..
```

### 2. Start Supabase

```bash
npx supabase start
npx supabase db reset   # applies migrations
```

### 3. Configure environment

Create **`supabase/.env.local`**:

```env
TODOIST_CLIENT_ID=your_client_id
TODOIST_CLIENT_SECRET=your_client_secret
DEFAULT_AI_BASE_URL=https://api.anthropic.com/v1
DEFAULT_AI_API_KEY=your_api_key
DEFAULT_AI_MODEL=claude-opus-4-6
DEFAULT_BRAVE_API_KEY=your_brave_key    # optional
PUBLIC_SITE_URL=http://localhost:5173
SENTRY_DSN=your_sentry_dsn              # optional

# Required: encryption key for sensitive DB columns (AES-256-GCM)
# Generate with: deno -e "console.log(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))"
ENCRYPTION_KEY=your_generated_key
```

Create **`frontend/.env.local`**:

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key from supabase start output>
```

### 4. Run locally

```bash
# Terminal 1 — Edge Functions
npm run functions:serve

# Terminal 2 — Frontend
npm run frontend:dev
```

### 5. Connect Todoist

Open [localhost:5173](http://localhost:5173), click **Connect Todoist**, and authorize.

## Usage

1. Open any task in Todoist
2. Add a comment: `@ai What should I prioritize this week?`
3. The agent responds as a new comment
4. Continue the conversation — history is preserved per task

## Development

### Commands

```bash
npm run supabase:start      # Start local Supabase
npm run supabase:stop       # Stop local Supabase
npm run supabase:reset      # Reset database (re-apply migrations)
npm run functions:serve     # Serve Edge Functions locally
npm run frontend:dev        # Start frontend dev server
npm run frontend:build      # Build frontend for production
npm test                    # Run Deno test suite
```

### Running Tests

```bash
# All tests
npm test

# With coverage
deno test supabase/functions/tests/ --no-check --allow-env --allow-read --coverage

# Specific test file
deno test supabase/functions/tests/crypto.test.ts --no-check --allow-env --allow-read
```

### Test Coverage

231 tests covering all shared modules and handlers:

| Module | Tests | What's covered |
|--------|-------|----------------|
| **ai.ts** | 41 | `buildMessages` (custom prompts, images, edge cases), `executePrompt` (OpenAI + Anthropic providers, tool calls, multi-tool batching) |
| **validation.ts** | 33 | All settings fields: type checks, boundaries, nulls, multi-field errors, SSRF prevention |
| **messages.ts** | 30 | Comment parsing, trigger word stripping, special chars, normalize helpers |
| **rate-limit.ts** | 29 | Config parsing, env overrides, rate limit checks, account blocking |
| **crypto.ts** | 21 | AES-256-GCM encrypt/decrypt round-trips, HMAC verification, OAuth state signing/verification |
| **webhook** | 21 | HMAC verification, rate limiting, idempotency, request validation |
| **todoist.ts** | 15 | All TodoistClient methods: API calls, auth headers, error handling, trusted domains |
| **settings** | 26 | CRUD operations, auth, rate limiting, field validation, API key validation |
| **auth-callback** | 10 | OAuth flow, token exchange, CSRF state verification, error handling |
| **search.ts** | 6 | Brave Search: result mapping, params, headers, empty/error responses |
| **auth-start** | 4 | OAuth initiation, CORS, state signing, error handling |
| **release-config** | 4 | Release configuration validation |
| **sentry.ts** | 4 | `withSentry` wrapper, error handling, `captureException` no-op |

### Linting

```bash
cd frontend && npm run lint     # ESLint for frontend
deno lint supabase/functions/   # Deno lint for Edge Functions
```

## CI/CD

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| **CI** | Push & PR to `main` | Lint, test & build frontend; run Deno tests |
| **CodeQL** | Push & PR to `main`, weekly | Code scanning for security vulnerabilities |
| **Deploy** | Push to `main` | Validate secrets, deploy Edge Functions + frontend, post-deploy health check, E2E smoke tests |
| **Security Audit** | Push & PR to `main`, weekly | Run `npm audit` on frontend deps; Deno type-check, lockfile verification, and npm audit on backend deps |
| **Dependabot** | Weekly (Monday) | Open PRs for outdated npm packages and GitHub Actions |

## Security

| Measure | Implementation |
|---------|---------------|
| **Webhook verification** | HMAC-SHA256 signature on every Todoist webhook |
| **OAuth CSRF protection** | HMAC-signed state tokens with nonce and expiry |
| **SSRF prevention** | Private hostname blocking + HTTPS-only for custom AI URLs |
| **Webhook idempotency** | Atomic event deduplication prevents duplicate AI responses |
| **Data encryption** | AES-256-GCM for sensitive DB columns (tokens, API keys) |
| **Data isolation** | PostgreSQL Row Level Security per user |
| **Authentication** | JWT-based via Supabase Auth |
| **Secrets management** | All credentials in environment variables |
| **Input validation** | Server-side validation on all user settings |
| **Code scanning** | CodeQL analysis for security vulnerabilities |
| **Dependency scanning** | Automated npm audit + Dependabot |
| **Rate limiting** | Per-user webhook and settings rate limits |
| **Image limits** | 4 MB max per attachment |

## License

[ISC](LICENSE)
