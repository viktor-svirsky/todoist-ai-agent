# Sentry Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Sentry error tracking and performance monitoring to all three Supabase Edge Functions using a `withSentry()` handler wrapper.

**Architecture:** Create `_shared/sentry.ts` exporting `withSentry(handler)` and `captureException(error)`. Wrap all three `Deno.serve` handlers. Add AI call spans in `_shared/ai.ts`. Gracefully no-ops when `SENTRY_DSN` env var is absent.

**Tech Stack:** `npm:@sentry/deno`, Deno 2, Supabase Edge Functions

---

### Task 1: Create Sentry Project via MCP

**No files.** This is a pure MCP operation.

**Step 1: Find or create a team**

Use the Sentry MCP to find existing teams in the `viktor-svirskyi` org:

```
mcp__claude_ai_Sentry__find_teams(organizationSlug="viktor-svirskyi", regionUrl="https://us.sentry.io")
```

If no team exists, create one:
```
mcp__claude_ai_Sentry__create_team(organizationSlug="viktor-svirskyi", name="default", regionUrl="https://us.sentry.io")
```

**Step 2: Create the Sentry project**

```
mcp__claude_ai_Sentry__create_project(
  organizationSlug="viktor-svirskyi",
  teamSlug="<slug from step above>",
  name="todoist-ai-agent",
  platform="javascript",
  regionUrl="https://us.sentry.io"
)
```

**Step 3: Get the DSN**

```
mcp__claude_ai_Sentry__find_dsns(
  organizationSlug="viktor-svirskyi",
  projectSlug="todoist-ai-agent",
  regionUrl="https://us.sentry.io"
)
```

Save the DSN value — it will be used in Task 6.

---

### Task 2: Create `_shared/sentry.ts`

**Files:**
- Create: `supabase/functions/_shared/sentry.ts`
- Test: `supabase/functions/tests/sentry.test.ts`

**Step 1: Write the failing tests**

Create `supabase/functions/tests/sentry.test.ts`:

```typescript
import { assertEquals } from "jsr:@std/assert";
import { withSentry, captureException } from "../_shared/sentry.ts";

Deno.test("withSentry: passes response through when handler succeeds", async () => {
  const handler = async (_req: Request) =>
    new Response(JSON.stringify({ ok: true }), { status: 200 });
  const wrapped = withSentry(handler);
  const res = await wrapped(new Request("http://localhost/test", { method: "POST" }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
});

Deno.test("withSentry: returns 500 JSON when handler throws", async () => {
  const handler = async (_req: Request): Promise<Response> => {
    throw new Error("boom");
  };
  const wrapped = withSentry(handler);
  const res = await wrapped(new Request("http://localhost/test", { method: "POST" }));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, "Internal server error");
});

Deno.test("withSentry: OPTIONS request passes through", async () => {
  const handler = async (req: Request) =>
    req.method === "OPTIONS"
      ? new Response(null, { status: 200 })
      : new Response("ok", { status: 200 });
  const wrapped = withSentry(handler);
  const res = await wrapped(new Request("http://localhost/test", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
});

Deno.test("captureException: no-ops when SENTRY_DSN not set", () => {
  // Should not throw even without Sentry initialized
  captureException(new Error("test error"));
});
```

**Step 2: Run tests to verify they fail**

```bash
npx deno test supabase/functions/tests/sentry.test.ts --no-check
```

Expected: fail with import error (file doesn't exist yet).

**Step 3: Create `_shared/sentry.ts`**

```typescript
import * as Sentry from "npm:@sentry/deno";

let initialized = false;

function initSentry(): void {
  if (initialized) return;
  initialized = true;
  const dsn = Deno.env.get("SENTRY_DSN");
  if (!dsn) return;
  Sentry.init({
    dsn,
    tracesSampleRate: 1.0,
    environment: Deno.env.get("ENVIRONMENT") ?? "production",
  });
}

function hasDsn(): boolean {
  return !!Deno.env.get("SENTRY_DSN");
}

type Handler = (req: Request) => Promise<Response>;

export function withSentry(handler: Handler): Handler {
  initSentry();
  return async (req: Request): Promise<Response> => {
    const execute = async (): Promise<Response> => {
      try {
        return await handler(req);
      } catch (error) {
        if (hasDsn()) {
          Sentry.captureException(error);
          await Sentry.flush(2000);
        }
        return new Response(JSON.stringify({ error: "Internal server error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    };

    if (!hasDsn()) return execute();

    return Sentry.startSpan(
      {
        name: `${req.method} ${new URL(req.url).pathname}`,
        op: "http.server",
        attributes: {
          "http.method": req.method,
          "http.url": req.url,
        },
      },
      execute
    );
  };
}

export function captureException(error: unknown): void {
  if (!hasDsn()) return;
  Sentry.captureException(error);
}
```

**Step 4: Run tests to verify they pass**

```bash
npx deno test supabase/functions/tests/sentry.test.ts --no-check
```

Expected: 4 tests pass.

**Step 5: Run full test suite to confirm no regressions**

```bash
npx deno test supabase/functions/tests/ --no-check
```

Expected: all tests pass.

---

### Task 3: Add AI span to `_shared/ai.ts`

**Files:**
- Modify: `supabase/functions/_shared/ai.ts`

**Step 1: Add Sentry import at top of `ai.ts`**

After the existing imports at line 1-2, add:

```typescript
import * as Sentry from "npm:@sentry/deno";
```

**Step 2: Wrap the fetch inside the for-loop (line ~106)**

The `for` loop in `executePrompt` currently has:

```typescript
const res = await fetch(`${config.baseUrl}/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  },
  body: JSON.stringify(body),
  signal: controller.signal,
});
```

Replace with:

```typescript
const res = await Sentry.startSpan(
  {
    name: "ai.chat_completion",
    op: "ai.chat",
    attributes: { "ai.model": config.model, "ai.round": round },
  },
  () =>
    fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
);
```

**Step 3: Wrap the final fetch after the loop (line ~150)**

The fallback fetch after exhausting tool rounds currently has:

```typescript
const res = await fetch(`${config.baseUrl}/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  },
  body: JSON.stringify({ model: config.model, messages: runMessages }),
});
```

Replace with:

```typescript
const res = await Sentry.startSpan(
  { name: "ai.chat_completion", op: "ai.chat", attributes: { "ai.model": config.model, "ai.round": "final" } },
  () =>
    fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, messages: runMessages }),
    })
);
```

**Step 4: Run full test suite**

```bash
npx deno test supabase/functions/tests/ --no-check
```

Expected: all tests pass (existing `ai.test.ts` tests only test `buildMessages`, not `executePrompt`, so no impact).

---

### Task 4: Wrap `webhook/index.ts`

**Files:**
- Modify: `supabase/functions/webhook/index.ts`

**Step 1: Add imports**

At the top of `webhook/index.ts`, after the existing imports (around line 10), add:

```typescript
import { withSentry, captureException } from "../_shared/sentry.ts";
```

**Step 2: Wrap `Deno.serve`**

At the bottom of `webhook/index.ts`, change:

```typescript
Deno.serve(async (req: Request) => {
```

to:

```typescript
Deno.serve(withSentry(async (req: Request) => {
```

And close with `}));` instead of `});` at the end of the file.

**Step 3: Add `captureException` at the async processing error site**

In the `processPromise` block (around line 220):

```typescript
} catch (error) {
  console.error("Async webhook processing failed", {
    event_name: event.event_name,
    error: error instanceof Error ? error.message : String(error),
  });
}
```

Change to:

```typescript
} catch (error) {
  console.error("Async webhook processing failed", {
    event_name: event.event_name,
    error: error instanceof Error ? error.message : String(error),
  });
  captureException(error);
}
```

**Step 4: Run full test suite**

```bash
npx deno test supabase/functions/tests/ --no-check
```

Expected: all tests pass.

---

### Task 5: Wrap `auth-callback/index.ts`

**Files:**
- Modify: `supabase/functions/auth-callback/index.ts`

**Step 1: Add imports**

At the top of `auth-callback/index.ts`, after the existing imports, add:

```typescript
import { withSentry, captureException } from "../_shared/sentry.ts";
```

**Step 2: Wrap `Deno.serve`**

Change:

```typescript
Deno.serve(async (req) => {
```

to:

```typescript
Deno.serve(withSentry(async (req) => {
```

And change the closing `});` to `}));`.

**Step 3: Add `captureException` at the outer catch**

The outer catch at the bottom of the handler (around line 275):

```typescript
} catch (error) {
  console.error("Auth callback error:", error);
  return errorRedirect("auth_failed");
}
```

Change to:

```typescript
} catch (error) {
  console.error("Auth callback error:", error);
  captureException(error);
  return errorRedirect("auth_failed");
}
```

**Step 4: Run full test suite**

```bash
npx deno test supabase/functions/tests/ --no-check
```

Expected: all tests pass.

---

### Task 6: Wrap `settings/index.ts`

**Files:**
- Modify: `supabase/functions/settings/index.ts`

**Step 1: Add imports**

At the top of `settings/index.ts`, after the existing imports, add:

```typescript
import { withSentry } from "../_shared/sentry.ts";
```

**Step 2: Wrap `Deno.serve`**

Change:

```typescript
Deno.serve(async (req) => {
```

to:

```typescript
Deno.serve(withSentry(async (req) => {
```

And change the closing `});` to `}));`.

**Step 3: Run full test suite**

```bash
npx deno test supabase/functions/tests/ --no-check
```

Expected: all tests pass.

---

### Task 7: Set `SENTRY_DSN` Secret and Deploy

**No files to edit.** This is configuration.

**Step 1: Set the Sentry DSN as a Supabase secret**

Use the DSN captured in Task 1:

```bash
cd /Users/viktor_svirskyi/Projects/todoist-ai-agent
npx supabase secrets set SENTRY_DSN=<dsn-from-task-1>
```

**Step 2: Deploy all three edge functions**

```bash
npx supabase functions deploy webhook
npx supabase functions deploy auth-callback
npx supabase functions deploy settings
```

**Step 3: Verify deployment**

Trigger a real webhook event (add an @ai comment on a Todoist task). Then check the Sentry dashboard at https://viktor-svirskyi.sentry.io to confirm:
- A transaction appears under the `todoist-ai-agent` project
- The `ai.chat_completion` span is visible inside the transaction

---

### Task 8: Verify Error Capture Works

**Step 1: Check Sentry project in MCP**

```
mcp__claude_ai_Sentry__find_projects(organizationSlug="viktor-svirskyi", regionUrl="https://us.sentry.io")
```

Confirm `todoist-ai-agent` project appears.

**Step 2: Done**

The integration is complete. Future errors from the three Edge Functions will appear in Sentry with stack traces, and AI call durations will be visible as spans in performance transactions.
