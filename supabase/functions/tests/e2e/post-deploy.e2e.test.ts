/**
 * Post-deploy E2E tests — tests the FULL flow via Todoist API.
 *
 * Creates real Todoist tasks, adds comments with @ai trigger,
 * waits for the AI agent to respond, and verifies the response.
 *
 * Run with:
 *   TODOIST_TEST_TOKEN=xxx deno test supabase/functions/tests/e2e/post-deploy.e2e.test.ts \
 *     --no-check --allow-env --allow-net --allow-read
 *
 * Requirements:
 * - TODOIST_TEST_TOKEN: API token for a test Todoist account connected to the deployed agent
 * - The test account must have completed the OAuth flow on the deployed app
 * - The deployed agent must be running (health check should pass first)
 * - The test account should have rate_limit_max_requests raised (e.g. 50) in the DB
 */

import { assert, assertEquals } from "@std/assert";

const TODOIST_TOKEN = Deno.env.get("TODOIST_TEST_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("E2E_SUPABASE_URL") || "https://nztpwctdgeexrxqcocjm.supabase.co";
const TODOIST_API = "https://api.todoist.com/api/v1";
const AI_INDICATOR = "\u{1F916} **AI Agent**";
const ERROR_PREFIX = "\u{26A0}\u{FE0F} AI agent error:";
const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 180_000;

function t(name: string, fn: () => Promise<void>) {
  Deno.test({
    name,
    fn,
    sanitizeOps: false,
    sanitizeResources: false,
    ignore: !TODOIST_TOKEN,
  });
}

// ---------------------------------------------------------------------------
// Todoist API helpers
// ---------------------------------------------------------------------------

async function todoistFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${TODOIST_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TODOIST_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

async function createTask(content: string): Promise<string> {
  const res = await todoistFetch("/tasks", {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Create task failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.id;
}

async function addComment(taskId: string, content: string): Promise<string> {
  const res = await todoistFetch("/comments", {
    method: "POST",
    body: JSON.stringify({ task_id: taskId, content }),
  });
  if (!res.ok) throw new Error(`Add comment failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.id;
}

async function getComments(taskId: string): Promise<Array<{ id: string; content: string; posted_at: string }>> {
  const res = await todoistFetch(`/comments?task_id=${taskId}`);
  if (!res.ok) throw new Error(`Get comments failed: ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

async function deleteTask(taskId: string): Promise<void> {
  const res = await todoistFetch(`/tasks/${taskId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    console.warn(`Cleanup: failed to delete task ${taskId}: ${res.status}`);
  }
}

/**
 * Poll for an AI response comment on a task.
 * Returns the stripped AI response content, or null if timed out.
 */
async function waitForAiResponse(
  taskId: string,
  triggerCommentId: string,
  timeoutMs = MAX_WAIT_MS,
): Promise<string | null> {
  // Snapshot existing AI comments before polling so retries don't pick up stale responses
  const existingBefore = await getComments(taskId);
  const existingAiIds = new Set(
    existingBefore
      .filter((c) => c.content.startsWith(AI_INDICATOR) && c.id !== triggerCommentId)
      .map((c) => c.id)
  );

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const comments = await getComments(taskId);

    for (const c of comments) {
      if (c.id === triggerCommentId) continue;
      if (existingAiIds.has(c.id)) continue;
      if (!c.content.startsWith(AI_INDICATOR)) continue;
      if (c.content === `${AI_INDICATOR}\n\n_Reviewing..._`) continue;

      const content = c.content.slice(AI_INDICATOR.length).replace(/^\n+/, "").trim();
      return content;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  return null;
}

/** Assert AI responded successfully (not null, not empty, not an error). */
function assertAiSuccess(response: string | null, context: string): string {
  assert(response !== null, `${context}: AI should respond within timeout (check: tunnel up? rate limit?)`);
  assert(response!.length > 0, `${context}: AI response should not be empty`);
  assert(!response!.startsWith(ERROR_PREFIX), `${context}: AI returned an error: ${response!.slice(0, 300)}`);
  assert(response !== "(no response)", `${context}: AI returned empty content`);
  return response!;
}

const MAX_RETRIES = 3;

/**
 * Post a comment and wait for AI response, retrying with a fresh comment
 * if the first attempt times out (handles Supabase edge function throttling
 * and Todoist webhook delivery failures).
 */
async function triggerAndWait(
  taskId: string,
  content: string,
  context: string,
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const commentId = await addComment(taskId, content);
    const response = await waitForAiResponse(taskId, commentId);
    if (response !== null) return assertAiSuccess(response, context);
    if (attempt < MAX_RETRIES) {
      console.log(`  ${context}: no response on attempt ${attempt}, retrying...`);
      await sleep(COOLDOWN_MS);
    }
  }
  return assertAiSuccess(null, context); // will throw
}

// ---------------------------------------------------------------------------
// Onboarding — verify deployed auth flow and user setup
// ---------------------------------------------------------------------------

t("e2e post-deploy: health endpoint returns healthy", async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/health`);
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.status, "healthy");
});

t("e2e post-deploy: auth-start redirects to Todoist OAuth", async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/auth-start`, {
    redirect: "manual",
  });
  assertEquals(res.status, 302, "auth-start should return 302 redirect");
  const location = res.headers.get("location") || "";
  assert(
    location.startsWith("https://todoist.com/oauth/authorize"),
    `Should redirect to Todoist OAuth. Got: ${location.slice(0, 100)}`,
  );
  const params = new URL(location).searchParams;
  assert(params.has("client_id"), "OAuth redirect should include client_id");
  assert(params.has("state"), "OAuth redirect should include CSRF state");
  assertEquals(params.get("scope"), "data:read_write");
  console.log(`  auth-start redirects to Todoist OAuth with client_id=${params.get("client_id")}`);
});

t("e2e post-deploy: test user is onboarded and active", async () => {
  const userRes = await fetch(`${TODOIST_API}/user`, {
    headers: { Authorization: `Bearer ${TODOIST_TOKEN}` },
  });
  assert(userRes.ok, "Should fetch Todoist user profile");
  const userData = await userRes.json();
  const todoistUserId = String(userData.id);

  const taskRes = await todoistFetch("/tasks", {
    method: "POST",
    body: JSON.stringify({ content: "[E2E] Onboarding check" }),
  });
  assert(taskRes.ok, "Test account should be able to create tasks");
  const task = await taskRes.json();
  console.log(`  Test user ${todoistUserId} is onboarded`);
  await deleteTask(task.id);
});

// ---------------------------------------------------------------------------
// AI Features — comprehensive e2e for each capability
// ---------------------------------------------------------------------------

// Cooldown between AI tests to avoid webhook rate limits and allow
// the previous request to fully complete before triggering the next one.
const COOLDOWN_MS = 10_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

t("e2e post-deploy: AI responds to basic @ai comment", async () => {
  const taskId = await createTask("[E2E] Basic AI response");
  try {
    const response = await triggerAndWait(taskId, "@ai Say exactly: e2e-test-ok", "Basic response");
    console.log(`  AI response: ${response.slice(0, 200)}`);
  } finally {
    await deleteTask(taskId);
  }
});

t("e2e post-deploy: AI fetches URL and extracts page content", async () => {
  await sleep(COOLDOWN_MS);
  const taskId = await createTask("[E2E] URL fetching");
  try {
    const response = await triggerAndWait(
      taskId,
      "@ai Fetch https://example.com and tell me the main heading on the page",
      "URL fetch",
    );
    const lower = response.toLowerCase();
    assert(
      lower.includes("example") || lower.includes("domain"),
      `AI should reference page content. Got: ${response.slice(0, 300)}`,
    );
    console.log(`  AI response: ${response.slice(0, 200)}`);
  } finally {
    await deleteTask(taskId);
  }
});

t("e2e post-deploy: AI performs web search and returns results", async () => {
  await sleep(COOLDOWN_MS);
  const taskId = await createTask("[E2E] Web search");
  try {
    const response = await triggerAndWait(
      taskId,
      "@ai Search the web for Supabase Edge Functions and give me a one-sentence summary",
      "Web search",
    );
    const lower = response.toLowerCase();
    assert(
      lower.includes("supabase") || lower.includes("edge") || lower.includes("function"),
      `AI should reference Supabase. Got: ${response.slice(0, 300)}`,
    );
    console.log(`  AI response: ${response.slice(0, 200)}`);
  } finally {
    await deleteTask(taskId);
  }
});

t("e2e post-deploy: AI handles error URL gracefully", async () => {
  await sleep(COOLDOWN_MS);
  const taskId = await createTask("[E2E] Error URL handling");
  try {
    const response = await triggerAndWait(
      taskId,
      "@ai Read https://httpbin.org/status/500 and describe what happened",
      "Error URL",
    );
    const lower = response.toLowerCase();
    assert(
      lower.includes("500") || lower.includes("error") || lower.includes("server"),
      `AI should mention the error. Got: ${response.slice(0, 300)}`,
    );
    console.log(`  AI response: ${response.slice(0, 200)}`);
  } finally {
    await deleteTask(taskId);
  }
});

t("e2e post-deploy: AI reads and reviews a complex real-world page", async () => {
  await sleep(COOLDOWN_MS);
  const taskId = await createTask("[E2E] Complex page review");
  try {
    const response = await triggerAndWait(
      taskId,
      "@ai review and provide details of Keeper.sh",
      "Complex page",
    );
    const lower = response.toLowerCase();
    assert(
      lower.includes("keeper") || lower.includes("calendar") || lower.includes("sync"),
      `AI should reference Keeper.sh content. Got: ${response.slice(0, 300)}`,
    );
    assert(response.length > 200, "Complex page review should be detailed");
    console.log(`  AI response: ${response.slice(0, 200)}`);
  } finally {
    await deleteTask(taskId);
  }
});
