# Multi-Tenant SaaS Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the single-user todoist-ai-agent into a multi-tenant SaaS on Supabase with Todoist OAuth onboarding, a settings page, and per-user AI/search configuration.

**Architecture:** Supabase Edge Functions (Deno) handle webhooks, OAuth, and settings. Supabase PostgreSQL stores users, tokens (encrypted), conversations, and messages with RLS. A static React + Tailwind frontend on Vercel provides the landing page and settings.

**Tech Stack:** Supabase (PostgreSQL, Auth, Edge Functions, Vault), Deno, React, Tailwind CSS, OpenAI SDK (Deno-compatible), Vite

**Design doc:** `docs/plans/2026-02-26-multi-tenant-saas-design.md`

---

### Task 1: Supabase Project Setup

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/00001_initial_schema.sql`

**Step 1: Initialize Supabase locally**

```bash
cd /Users/viktor_svirskyi/Projects/todoist-ai-agent
npx supabase init
```

This creates the `supabase/` directory with `config.toml`.

**Step 2: Create the initial migration**

Create `supabase/migrations/00001_initial_schema.sql`:

```sql
-- Enable required extensions
create extension if not exists "pgsodium";

-- Users config table
create table users_config (
  id                  uuid primary key references auth.users(id) on delete cascade,
  todoist_token       text not null,
  todoist_user_id     text unique not null,
  webhook_secret      text not null,
  trigger_word        text not null default '@ai',
  custom_ai_base_url  text,
  custom_ai_api_key   text,
  custom_ai_model     text,
  custom_brave_key    text,
  max_messages        int not null default 20,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Conversations table
create table conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users_config(id) on delete cascade,
  task_id         text not null,
  title           text,
  created_at      timestamptz not null default now(),
  last_activity   timestamptz not null default now(),
  unique(user_id, task_id)
);

-- Messages table
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

-- RLS
alter table users_config enable row level security;
create policy "users_own_config" on users_config
  for all using (auth.uid() = id);

alter table conversations enable row level security;
create policy "users_own_conversations" on conversations
  for all using (auth.uid() = user_id);

alter table messages enable row level security;
create policy "users_own_messages" on messages
  for all using (
    conversation_id in (
      select id from conversations where user_id = auth.uid()
    )
  );

-- Updated_at trigger
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger users_config_updated_at
  before update on users_config
  for each row execute function update_updated_at();
```

**Step 3: Start local Supabase and apply migration**

```bash
npx supabase start
npx supabase db reset
```

Expected: Tables created, RLS enabled, all migrations applied.

**Step 4: Verify schema**

```bash
npx supabase db lint
```

Expected: No errors.

**Step 5: Commit**

```bash
git add supabase/
git commit -m "feat: initialize Supabase project with schema and RLS"
```

---

### Task 2: Shared Edge Function Utilities

**Files:**
- Create: `supabase/functions/_shared/supabase.ts`
- Create: `supabase/functions/_shared/constants.ts`
- Create: `supabase/functions/_shared/todoist.ts`

**Step 1: Create Supabase client helper**

Create `supabase/functions/_shared/supabase.ts`:

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function createServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

export function createUserClient(authHeader: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
}
```

**Step 2: Create constants**

Create `supabase/functions/_shared/constants.ts`:

```typescript
export const TODOIST_API_URL = "https://api.todoist.com/api/v1";
export const TODOIST_OAUTH_URL = "https://todoist.com/oauth/authorize";
export const TODOIST_TOKEN_URL = "https://todoist.com/oauth/access_token";
export const TODOIST_SYNC_URL = "https://api.todoist.com/sync/v9/sync";

export const AI_INDICATOR = "🤖 **AI Agent**";
export const ERROR_PREFIX = "⚠️ AI agent error:";
export const PROGRESS_INDICATOR = "🤖 **AI Agent**\n\n_Reviewing..._";

export const MAX_TOOL_ROUNDS = 5;
export const DEFAULT_AI_MODEL = "claude-sonnet-4-5-20250514";
export const DEFAULT_MAX_MESSAGES = 20;
```

**Step 3: Create Todoist API helper**

Create `supabase/functions/_shared/todoist.ts`:

```typescript
import { TODOIST_API_URL, AI_INDICATOR, PROGRESS_INDICATOR } from "./constants.ts";

export class TodoistClient {
  constructor(private token: string) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  async getTask(taskId: string) {
    const res = await fetch(`${TODOIST_API_URL}/tasks/${taskId}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Todoist getTask failed: ${res.status}`);
    return res.json();
  }

  async getComments(taskId: string) {
    const res = await fetch(`${TODOIST_API_URL}/comments?task_id=${taskId}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Todoist getComments failed: ${res.status}`);
    const data = await res.json();
    return data.results || [];
  }

  async postComment(taskId: string, content: string): Promise<string> {
    const res = await fetch(`${TODOIST_API_URL}/comments`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        task_id: taskId,
        content: `${AI_INDICATOR}\n\n${content}`,
      }),
    });
    if (!res.ok) throw new Error(`Todoist postComment failed: ${res.status}`);
    const data = await res.json();
    return data.id;
  }

  async postProgressComment(taskId: string): Promise<string> {
    const res = await fetch(`${TODOIST_API_URL}/comments`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId, content: PROGRESS_INDICATOR }),
    });
    if (!res.ok) throw new Error(`Todoist postProgressComment failed: ${res.status}`);
    const data = await res.json();
    return data.id;
  }

  async updateComment(commentId: string, content: string): Promise<void> {
    const res = await fetch(`${TODOIST_API_URL}/comments/${commentId}`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ content: `${AI_INDICATOR}\n\n${content}` }),
    });
    if (!res.ok) throw new Error(`Todoist updateComment failed: ${res.status}`);
  }

  async downloadFile(url: string): Promise<Uint8Array> {
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
```

**Step 4: Commit**

```bash
git add supabase/functions/_shared/
git commit -m "feat: add shared Edge Function utilities"
```

---

### Task 3: AI Service (Deno port)

**Files:**
- Create: `supabase/functions/_shared/ai.ts`
- Create: `supabase/functions/_shared/search.ts`

**Step 1: Create search service**

Create `supabase/functions/_shared/search.ts`:

```typescript
interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export async function braveSearch(
  apiKey: string,
  query: string,
  count = 5
): Promise<SearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!res.ok) throw new Error(`Brave search failed: ${res.status}`);

  const data = await res.json();
  return (data.web?.results || []).map((r: any) => ({
    title: r.title,
    url: r.url,
    description: r.description,
  }));
}
```

**Step 2: Create AI service**

Create `supabase/functions/_shared/ai.ts`:

Port the existing `claude.service.ts` logic. Key differences: uses `fetch` instead of OpenAI SDK (simpler in Deno, avoids npm dependency), function signatures accept config params instead of class state.

```typescript
import { braveSearch } from "./search.ts";
import { MAX_TOOL_ROUNDS } from "./constants.ts";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ImageAttachment {
  data: string;
  mediaType: string;
}

interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  braveApiKey?: string;
}

const SYSTEM_PROMPT = [
  "You are an AI assistant embedded in Todoist.",
  "You help solve tasks by reasoning and providing clear, actionable answers.",
  "You can search the web when you need current information.",
  "Respond concisely — your reply will be posted as a Todoist comment.",
].join("\n");

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description: "Search the web for current information.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
          count: { type: "number", description: "Number of results (1-10, default 5)" },
        },
        required: ["query"],
      },
    },
  },
];

export function buildMessages(
  taskContent: string,
  taskDescription: string | undefined,
  messages: Message[],
  images?: ImageAttachment[]
): any[] {
  const taskContext = [
    `Current task: "${taskContent}"`,
    taskDescription ? `Task description: "${taskDescription}"` : "",
  ].filter(Boolean).join("\n");

  const result: any[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${taskContext}` },
  ];

  for (const msg of messages) {
    result.push({ role: msg.role, content: msg.content });
  }

  if (images && images.length > 0) {
    let lastUserIdx = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx !== -1) {
      const textContent = typeof result[lastUserIdx].content === "string"
        ? result[lastUserIdx].content
        : "";
      result[lastUserIdx] = {
        role: "user",
        content: [
          { type: "text", text: textContent },
          ...images.map((img) => ({
            type: "image_url",
            image_url: { url: `data:${img.mediaType};base64,${img.data}` },
          })),
        ],
      };
    }
  }

  return result;
}

export async function executePrompt(
  messages: any[],
  config: AiConfig
): Promise<string> {
  const useTools = !!config.braveApiKey;
  const runMessages = [...messages];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const body: any = { model: config.model, messages: runMessages };
    if (useTools) body.tools = TOOLS;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`AI API error ${res.status}: ${text}`);
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      if (!choice) return "(no response)";

      if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
        return choice.message.content?.trim() || "(no response)";
      }

      runMessages.push(choice.message);

      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type !== "function") continue;
        const result = await handleToolCall(
          toolCall.function.name,
          toolCall.function.arguments,
          config.braveApiKey!
        );
        runMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  // Exhausted tool rounds — get final response without tools
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, messages: runMessages }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "(no response)";
}

async function handleToolCall(
  name: string,
  argsJson: string,
  braveApiKey: string
): Promise<string> {
  try {
    const args = JSON.parse(argsJson);

    if (name === "web_search" || name === "proxy_web_search") {
      const results = await braveSearch(braveApiKey, args.query, args.count || 5);
      if (results.length === 0) return "No results found.";
      return results
        .map((r) => `**${r.title}**\n${r.url}\n${r.description}`)
        .join("\n\n");
    }

    return `Unknown tool: ${name}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return `Tool error: ${message}`;
  }
}
```

**Step 3: Commit**

```bash
git add supabase/functions/_shared/ai.ts supabase/functions/_shared/search.ts
git commit -m "feat: add AI and search services for Deno"
```

---

### Task 4: Auth Callback Edge Function

**Files:**
- Create: `supabase/functions/auth-callback/index.ts`

**Step 1: Create the OAuth callback function**

Create `supabase/functions/auth-callback/index.ts`:

```typescript
import { createServiceClient } from "../_shared/supabase.ts";
import { TODOIST_TOKEN_URL, TODOIST_SYNC_URL } from "../_shared/constants.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": Deno.env.get("FRONTEND_URL") || "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) {
    return new Response("Missing code parameter", { status: 400, headers: CORS_HEADERS });
  }

  try {
    // 1. Exchange code for access token
    const tokenRes = await fetch(TODOIST_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: Deno.env.get("TODOIST_CLIENT_ID"),
        client_secret: Deno.env.get("TODOIST_CLIENT_SECRET"),
        code,
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed: ${tokenRes.status}`);
    }

    const { access_token } = await tokenRes.json();

    // 2. Fetch Todoist user profile
    const syncRes = await fetch(TODOIST_SYNC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify({ sync_token: "*", resource_types: '["user"]' }),
    });

    if (!syncRes.ok) {
      throw new Error(`Sync API failed: ${syncRes.status}`);
    }

    const syncData = await syncRes.json();
    const todoistUserId = String(syncData.user.id);
    const email = syncData.user.email;

    // 3. Create or update Supabase Auth user
    const supabase = createServiceClient();

    // Check if user already exists
    const { data: existingConfig } = await supabase
      .from("users_config")
      .select("id")
      .eq("todoist_user_id", todoistUserId)
      .single();

    let userId: string;

    if (existingConfig) {
      // Returning user — update token
      userId = existingConfig.id;
      await supabase
        .from("users_config")
        .update({ todoist_token: access_token })
        .eq("id", userId);
    } else {
      // New user — create Auth user + config
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { todoist_user_id: todoistUserId },
      });

      if (authError) throw authError;
      userId = authUser.user.id;

      // 4. Register webhook with Todoist
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const webhookUrl = `${supabaseUrl}/functions/v1/webhook/${todoistUserId}`;

      // Note: Todoist webhook registration returns a secret
      // For now, store the client_secret as webhook_secret
      // The actual webhook uses HMAC with the client_secret
      const webhookSecret = Deno.env.get("TODOIST_CLIENT_SECRET")!;

      // 5. Insert users_config
      const { error: configError } = await supabase
        .from("users_config")
        .insert({
          id: userId,
          todoist_token: access_token,
          todoist_user_id: todoistUserId,
          webhook_secret: webhookSecret,
        });

      if (configError) throw configError;
    }

    // 6. Generate a session for the user
    const { data: session, error: sessionError } =
      await supabase.auth.admin.generateLink({
        type: "magiclink",
        email,
      });

    if (sessionError) throw sessionError;

    // Redirect to frontend with token
    const frontendUrl = Deno.env.get("FRONTEND_URL") || "http://localhost:5173";
    const redirectUrl = `${frontendUrl}/auth/callback#access_token=${session.properties.hashed_token}&type=magiclink`;

    return Response.redirect(redirectUrl, 302);
  } catch (error) {
    console.error("Auth callback error:", error);
    const frontendUrl = Deno.env.get("FRONTEND_URL") || "http://localhost:5173";
    return Response.redirect(`${frontendUrl}/?error=auth_failed`, 302);
  }
});
```

**Step 2: Commit**

```bash
git add supabase/functions/auth-callback/
git commit -m "feat: add Todoist OAuth callback Edge Function"
```

---

### Task 5: Webhook Edge Function

**Files:**
- Create: `supabase/functions/webhook/index.ts`

**Step 1: Create the webhook handler**

Create `supabase/functions/webhook/index.ts`:

```typescript
import { createServiceClient } from "../_shared/supabase.ts";
import { TodoistClient } from "../_shared/todoist.ts";
import { buildMessages, executePrompt } from "../_shared/ai.ts";
import {
  AI_INDICATOR,
  ERROR_PREFIX,
  DEFAULT_AI_MODEL,
  DEFAULT_MAX_MESSAGES,
} from "../_shared/constants.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Extract todoist_user_id from URL path: /webhook/:userId
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/");
  const todoistUserId = pathParts[pathParts.length - 1];

  if (!todoistUserId) {
    return new Response("Missing user ID", { status: 400 });
  }

  // Read raw body for HMAC verification
  const rawBody = await req.text();

  // Look up user config
  const supabase = createServiceClient();
  const { data: user, error: userError } = await supabase
    .from("users_config")
    .select("*")
    .eq("todoist_user_id", todoistUserId)
    .single();

  if (userError || !user) {
    return new Response("User not found", { status: 404 });
  }

  // Verify HMAC signature
  const signature = req.headers.get("x-todoist-hmac-sha256");
  if (!signature) {
    return new Response("Missing signature", { status: 403 });
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(user.webhook_secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  if (expected !== signature) {
    return new Response("Invalid signature", { status: 403 });
  }

  // Respond immediately
  const event = JSON.parse(rawBody);

  // Process asynchronously via EdgeRuntime.waitUntil if available,
  // otherwise process inline
  const processPromise = processEvent(event, user, supabase);

  // Deno Deploy supports waitUntil
  try {
    (globalThis as any).EdgeRuntime?.waitUntil?.(processPromise);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    // Fallback: process inline
    await processPromise;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});

async function processEvent(event: any, user: any, supabase: any) {
  try {
    const { event_name, event_data } = event;

    if (event_name === "note:added") {
      await handleNoteAdded(event_data, user, supabase);
    } else if (event_name === "item:completed") {
      await handleItemCompleted(event_data, user, supabase);
    }
  } catch (error) {
    console.error("Event processing failed:", error);
  }
}

async function handleNoteAdded(eventData: any, user: any, supabase: any) {
  const { item_id: taskId, content } = eventData;
  if (!taskId || !content) return;

  // Ignore bot's own comments
  if (content.startsWith(AI_INDICATOR)) return;
  if (content.startsWith(ERROR_PREFIX)) return;

  // Check trigger word (case-insensitive)
  const trigger = user.trigger_word || "@ai";
  const triggerRegex = new RegExp(trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  if (!triggerRegex.test(content)) return;

  // Strip trigger word and normalize whitespace
  const stripped = content.replace(new RegExp(trigger, "gi"), "").replace(/\s+/g, " ").trim();

  const todoist = new TodoistClient(user.todoist_token);
  const progressCommentId = await todoist.postProgressComment(taskId);

  try {
    const task = await todoist.getTask(taskId);

    // Load or create conversation
    let { data: conv } = await supabase
      .from("conversations")
      .select("id, title")
      .eq("user_id", user.id)
      .eq("task_id", taskId)
      .single();

    if (!conv) {
      const { data: newConv, error } = await supabase
        .from("conversations")
        .insert({ user_id: user.id, task_id: taskId, title: task.content })
        .select("id, title")
        .single();
      if (error) throw error;
      conv = newConv;

      // Seed with task content
      await supabase.from("messages").insert({
        conversation_id: conv.id,
        role: "user",
        content: `Task: ${task.content}\n${task.description || ""}`.trim(),
      });
    }

    // Add user message
    await supabase.from("messages").insert({
      conversation_id: conv.id,
      role: "user",
      content: stripped,
    });

    // Load recent messages
    const maxMessages = user.max_messages || DEFAULT_MAX_MESSAGES;
    const { data: dbMessages } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true })
      .limit(maxMessages);

    // Get image attachments
    const images = await getImageAttachments(todoist, taskId);

    // Build AI config
    const aiConfig = {
      baseUrl: user.custom_ai_base_url || Deno.env.get("DEFAULT_AI_BASE_URL")!,
      apiKey: user.custom_ai_api_key || Deno.env.get("DEFAULT_AI_API_KEY")!,
      model: user.custom_ai_model || Deno.env.get("DEFAULT_AI_MODEL") || DEFAULT_AI_MODEL,
      timeoutMs: 55_000, // Edge Function limit minus buffer
      braveApiKey: user.custom_brave_key || Deno.env.get("DEFAULT_BRAVE_KEY"),
    };

    const apiMessages = buildMessages(
      task.content,
      task.description,
      dbMessages || [],
      images.length > 0 ? images : undefined
    );

    const response = await executePrompt(apiMessages, aiConfig);

    // Save assistant message
    await supabase.from("messages").insert({
      conversation_id: conv.id,
      role: "assistant",
      content: response,
    });

    // Update last_activity
    await supabase
      .from("conversations")
      .update({ last_activity: new Date().toISOString() })
      .eq("id", conv.id);

    await todoist.updateComment(progressCommentId, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Processing failed:", { taskId, error: message });
    try {
      await todoist.updateComment(
        progressCommentId,
        `${ERROR_PREFIX} ${message}. Retry by adding a comment.`
      );
    } catch (e) {
      console.error("Failed to update error comment:", e);
    }
  }
}

async function handleItemCompleted(eventData: any, user: any, supabase: any) {
  const taskId = eventData.id;
  if (!taskId) return;

  // Delete conversation and messages (cascade)
  const { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_id", user.id)
    .eq("task_id", taskId)
    .single();

  if (conv) {
    await supabase.from("conversations").delete().eq("id", conv.id);
  }
}

async function getImageAttachments(
  todoist: TodoistClient,
  taskId: string
): Promise<{ data: string; mediaType: string }[]> {
  try {
    const comments = await todoist.getComments(taskId);
    const imageComments = comments.filter(
      (c: any) => c.file_attachment?.resource_type === "image"
    );

    if (imageComments.length === 0) return [];

    const images: { data: string; mediaType: string }[] = [];
    for (const comment of imageComments) {
      const att = comment.file_attachment;
      try {
        const buffer = await todoist.downloadFile(att.file_url);
        // Deno base64 encoding
        const base64 = btoa(String.fromCharCode(...buffer));
        images.push({ data: base64, mediaType: att.file_type || "image/png" });
      } catch (e) {
        console.error("Failed to download image:", e);
      }
    }

    return images;
  } catch {
    return [];
  }
}
```

**Step 2: Commit**

```bash
git add supabase/functions/webhook/
git commit -m "feat: add webhook Edge Function with multi-tenant processing"
```

---

### Task 6: Settings Edge Function

**Files:**
- Create: `supabase/functions/settings/index.ts`

**Step 1: Create the settings function**

Create `supabase/functions/settings/index.ts`:

```typescript
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": Deno.env.get("FRONTEND_URL") || "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  }

  const supabase = createUserClient(authHeader);

  // Verify session
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  }

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("users_config")
      .select("trigger_word, custom_ai_base_url, custom_ai_model, max_messages")
      .eq("id", user.id)
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: "Config not found" }), {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Don't expose actual keys — just whether they're set
    const serviceClient = createServiceClient();
    const { data: fullConfig } = await serviceClient
      .from("users_config")
      .select("custom_ai_api_key, custom_brave_key")
      .eq("id", user.id)
      .single();

    return new Response(
      JSON.stringify({
        trigger_word: data.trigger_word,
        custom_ai_base_url: data.custom_ai_base_url,
        custom_ai_model: data.custom_ai_model,
        has_custom_ai_key: !!fullConfig?.custom_ai_api_key,
        has_custom_brave_key: !!fullConfig?.custom_brave_key,
        max_messages: data.max_messages,
      }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  if (req.method === "PUT") {
    const body = await req.json();

    const updates: Record<string, any> = {};
    if (body.trigger_word !== undefined) updates.trigger_word = body.trigger_word;
    if (body.custom_ai_base_url !== undefined) updates.custom_ai_base_url = body.custom_ai_base_url || null;
    if (body.custom_ai_api_key !== undefined) updates.custom_ai_api_key = body.custom_ai_api_key || null;
    if (body.custom_ai_model !== undefined) updates.custom_ai_model = body.custom_ai_model || null;
    if (body.custom_brave_key !== undefined) updates.custom_brave_key = body.custom_brave_key || null;
    if (body.max_messages !== undefined) updates.max_messages = body.max_messages;

    if (Object.keys(updates).length === 0) {
      return new Response(JSON.stringify({ error: "No fields to update" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Use service client to update encrypted fields
    const serviceClient = createServiceClient();
    const { error } = await serviceClient
      .from("users_config")
      .update(updates)
      .eq("id", user.id);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  if (req.method === "DELETE") {
    // Account deletion: revoke webhook, delete all data
    const serviceClient = createServiceClient();

    const { data: config } = await serviceClient
      .from("users_config")
      .select("todoist_token")
      .eq("id", user.id)
      .single();

    // Delete user (cascades to users_config, conversations, messages)
    await serviceClient.auth.admin.deleteUser(user.id);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
});
```

**Step 2: Commit**

```bash
git add supabase/functions/settings/
git commit -m "feat: add settings Edge Function"
```

---

### Task 7: Frontend — Project Setup

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/lib/supabase.ts`
- Create: `frontend/tailwind.config.js`
- Create: `frontend/postcss.config.js`

**Step 1: Scaffold the frontend project**

```bash
cd /Users/viktor_svirskyi/Projects/todoist-ai-agent
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install @supabase/supabase-js react-router-dom
npm install -D tailwindcss @tailwindcss/vite
```

**Step 2: Configure Tailwind**

Update `frontend/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

Update `frontend/src/index.css`:

```css
@import "tailwindcss";
```

**Step 3: Create Supabase client**

Create `frontend/src/lib/supabase.ts`:

```typescript
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

**Step 4: Create `.env` for frontend**

Create `frontend/.env.local`:

```
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=your-local-anon-key
VITE_TODOIST_CLIENT_ID=your-todoist-client-id
```

**Step 5: Commit**

```bash
git add frontend/
git commit -m "feat: scaffold frontend with React, Tailwind, Supabase client"
```

---

### Task 8: Frontend — Landing Page

**Files:**
- Create: `frontend/src/pages/Landing.tsx`
- Modify: `frontend/src/main.tsx`

**Step 1: Create the landing page**

Create `frontend/src/pages/Landing.tsx`:

```tsx
import { supabase } from "../lib/supabase";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Landing() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if already logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate("/settings");
    });

    // Check for error in URL
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) setError("Authentication failed. Please try again.");
  }, [navigate]);

  const handleConnect = () => {
    const clientId = import.meta.env.VITE_TODOIST_CLIENT_ID;
    const state = crypto.randomUUID();
    sessionStorage.setItem("oauth_state", state);

    const params = new URLSearchParams({
      client_id: clientId,
      scope: "data:read_write",
      state,
    });

    window.location.href = `https://todoist.com/oauth/authorize?${params}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Todoist AI Agent</h1>
          <p className="mt-3 text-gray-600">
            An AI assistant that lives in your Todoist. Mention your trigger word
            in any comment and get an instant AI response.
          </p>
        </div>

        <div className="space-y-4 text-left text-sm text-gray-600">
          <div className="flex gap-3">
            <span className="text-lg">💬</span>
            <p>Comment <code className="bg-gray-200 px-1 rounded">@ai</code> on any task to get help</p>
          </div>
          <div className="flex gap-3">
            <span className="text-lg">🔍</span>
            <p>Web search included for current information</p>
          </div>
          <div className="flex gap-3">
            <span className="text-lg">🔑</span>
            <p>Bring your own AI key or use the shared default</p>
          </div>
        </div>

        {error && (
          <p className="text-red-600 text-sm">{error}</p>
        )}

        <button
          onClick={handleConnect}
          className="w-full py-3 px-4 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg transition-colors"
        >
          Connect Todoist
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Set up routing**

Update `frontend/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import Settings from "./pages/Settings";
import AuthCallback from "./pages/AuthCallback";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
```

**Step 3: Commit**

```bash
git add frontend/src/
git commit -m "feat: add landing page with Todoist OAuth redirect"
```

---

### Task 9: Frontend — Auth Callback & Settings Page

**Files:**
- Create: `frontend/src/pages/AuthCallback.tsx`
- Create: `frontend/src/pages/Settings.tsx`

**Step 1: Create auth callback page**

Create `frontend/src/pages/AuthCallback.tsx`:

```tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // Supabase handles the hash fragment from the magic link
    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        navigate("/settings");
      }
    });

    // Fallback: if session already exists
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate("/settings");
    });

    // Timeout fallback
    const timeout = setTimeout(() => navigate("/?error=timeout"), 10_000);
    return () => clearTimeout(timeout);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-600">Completing setup...</p>
    </div>
  );
}
```

**Step 2: Create settings page**

Create `frontend/src/pages/Settings.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

interface UserSettings {
  trigger_word: string;
  custom_ai_base_url: string | null;
  custom_ai_model: string | null;
  has_custom_ai_key: boolean;
  has_custom_brave_key: boolean;
  max_messages: number;
}

export default function Settings() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Form state
  const [triggerWord, setTriggerWord] = useState("@ai");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [braveKey, setBraveKey] = useState("");

  useEffect(() => {
    // Check auth
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate("/");
        return;
      }
      loadSettings(session.access_token);
    });
  }, [navigate]);

  async function loadSettings(token: string) {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/settings`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.ok) {
      const data = await res.json();
      setSettings(data);
      setTriggerWord(data.trigger_word);
      setAiBaseUrl(data.custom_ai_base_url || "");
      setAiModel(data.custom_ai_model || "");
    }
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const updates: Record<string, any> = {
      trigger_word: triggerWord,
      custom_ai_base_url: aiBaseUrl || null,
      custom_ai_model: aiModel || null,
    };
    if (aiApiKey) updates.custom_ai_api_key = aiApiKey;
    if (braveKey) updates.custom_brave_key = braveKey;

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/settings`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      }
    );

    setSaving(false);
    setMessage(res.ok ? "Settings saved." : "Failed to save settings.");
    if (res.ok) {
      setAiApiKey("");
      setBraveKey("");
      loadSettings(session.access_token);
    }
  }

  async function handleDisconnect() {
    if (!confirm("This will delete your account and all data. Continue?")) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/settings`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      }
    );

    await supabase.auth.signOut();
    navigate("/");
  }

  if (!settings) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-4">
      <div className="max-w-md w-full space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Trigger word</label>
            <input
              type="text"
              value={triggerWord}
              onChange={(e) => setTriggerWord(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="@ai"
            />
            <p className="mt-1 text-xs text-gray-500">
              The agent responds when this word appears in a comment.
            </p>
          </div>

          <hr />
          <p className="text-sm font-medium text-gray-700">AI Provider (optional)</p>
          <p className="text-xs text-gray-500">Leave empty to use the shared default.</p>

          <div>
            <label className="block text-sm text-gray-600">Base URL</label>
            <input
              type="text"
              value={aiBaseUrl}
              onChange={(e) => setAiBaseUrl(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="https://api.anthropic.com/v1"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-600">API Key</label>
            <input
              type="password"
              value={aiApiKey}
              onChange={(e) => setAiApiKey(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder={settings.has_custom_ai_key ? "••••••••  (key set)" : "sk-..."}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-600">Model</label>
            <input
              type="text"
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="claude-sonnet-4-5-20250514"
            />
          </div>

          <hr />
          <p className="text-sm font-medium text-gray-700">Web Search (optional)</p>
          <p className="text-xs text-gray-500">Leave empty to use the shared default.</p>

          <div>
            <label className="block text-sm text-gray-600">Brave Search API Key</label>
            <input
              type="password"
              value={braveKey}
              onChange={(e) => setBraveKey(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder={settings.has_custom_brave_key ? "••••••••  (key set)" : "BSA..."}
            />
          </div>
        </div>

        {message && (
          <p className={`text-sm ${message.includes("Failed") ? "text-red-600" : "text-green-600"}`}>
            {message}
          </p>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition-colors"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>

        <button
          onClick={handleDisconnect}
          className="w-full py-2 px-4 bg-white border border-red-300 text-red-600 hover:bg-red-50 font-medium rounded-lg transition-colors"
        >
          Disconnect & Delete Account
        </button>
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add frontend/src/pages/
git commit -m "feat: add auth callback and settings pages"
```

---

### Task 10: Supabase Secrets & Deployment Config

**Files:**
- Create: `supabase/.env.local` (not committed)
- Modify: `supabase/config.toml`

**Step 1: Set Edge Function secrets**

These are set via the Supabase CLI and stored securely — never committed:

```bash
npx supabase secrets set \
  TODOIST_CLIENT_ID="your-client-id" \
  TODOIST_CLIENT_SECRET="your-client-secret" \
  DEFAULT_AI_BASE_URL="https://api.anthropic.com/v1" \
  DEFAULT_AI_API_KEY="sk-ant-your-key" \
  DEFAULT_AI_MODEL="claude-sonnet-4-5-20250514" \
  DEFAULT_BRAVE_KEY="your-brave-key" \
  FRONTEND_URL="https://your-app.vercel.app"
```

**Step 2: Update `.gitignore`**

Add to root `.gitignore`:

```
supabase/.env.local
frontend/.env.local
```

**Step 3: Commit**

```bash
git add .gitignore supabase/config.toml
git commit -m "chore: update gitignore for Supabase and frontend env files"
```

---

### Task 11: Local Testing & Verification

**Step 1: Start Supabase locally**

```bash
npx supabase start
```

**Step 2: Set local secrets**

```bash
cp supabase/.env.local.example supabase/.env.local
# Fill in local values
```

**Step 3: Serve Edge Functions locally**

```bash
npx supabase functions serve --env-file supabase/.env.local
```

**Step 4: Start frontend dev server**

```bash
cd frontend && npm run dev
```

**Step 5: Test the flow**

1. Open `http://localhost:5173`
2. Click "Connect Todoist"
3. Complete OAuth flow
4. Verify settings page loads
5. Change trigger word and save
6. Add a comment with the trigger word on a Todoist task
7. Verify agent responds

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: local testing adjustments"
```

---

### Task 12: Clean Up Old Node.js Code

**Files:**
- Delete: `src/` (entire directory)
- Delete: `tests/` (entire directory)
- Delete: `vitest.config.ts`
- Delete: `eslint.config.js`
- Delete: `tsconfig.json`
- Delete: `com.user.todoist-ai-agent.plist.example`
- Modify: `package.json` — strip to minimal (just Supabase CLI as devDep)
- Modify: `README.md` — update for SaaS setup

**Step 1: Remove old source code**

```bash
rm -rf src/ tests/ dist/ data/
rm vitest.config.ts eslint.config.js tsconfig.json
rm com.user.todoist-ai-agent.plist.example
```

**Step 2: Update package.json**

Replace `package.json` with minimal version:

```json
{
  "name": "todoist-ai-agent",
  "version": "2.0.0",
  "private": true,
  "description": "Multi-tenant AI agent for Todoist",
  "scripts": {
    "supabase:start": "npx supabase start",
    "supabase:stop": "npx supabase stop",
    "supabase:reset": "npx supabase db reset",
    "functions:serve": "npx supabase functions serve --env-file supabase/.env.local",
    "frontend:dev": "cd frontend && npm run dev",
    "frontend:build": "cd frontend && npm run build"
  }
}
```

**Step 3: Update README.md**

Rewrite to document the SaaS architecture, self-hosting with Supabase, and frontend deployment.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove single-user Node.js code, update for SaaS"
```

---

### Task 13: CI Update

**Files:**
- Modify: `.github/workflows/ci.yml`

**Step 1: Update CI for new project structure**

Replace CI workflow to validate Edge Functions and frontend:

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: cd frontend && npm ci
      - run: cd frontend && npm run lint
      - run: cd frontend && npm run build

  edge-functions:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - run: supabase functions lint
```

**Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "chore: update CI for Supabase + frontend structure"
```

---

Plan complete and saved to `docs/plans/2026-02-26-multi-tenant-saas.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints

Which approach?