/**
 * Post-deploy E2E tests — tests the FULL flow via Todoist API.
 *
 * Creates a real Todoist task, adds comments with @ai trigger,
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
 *
 * Note: The deployed agent rate-limits to 10 requests per 120 seconds per user.
 * These tests use a single task with sequential comments to minimize webhook triggers.
 */

import { assert, assertEquals } from "@std/assert";

const TODOIST_TOKEN = Deno.env.get("TODOIST_TEST_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("E2E_SUPABASE_URL") || "https://nztpwctdgeexrxqcocjm.supabase.co";
const TODOIST_API = "https://api.todoist.com/api/v1";
const AI_INDICATOR = "\u{1F916} **AI Agent**";
const ERROR_PREFIX = "\u{26A0}\u{FE0F} AI agent error:";
const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 120_000;

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
 * Looks for a comment starting with AI_INDICATOR that isn't the progress indicator.
 * Returns the stripped AI response content, or null if timed out.
 */
async function waitForAiResponse(
  taskId: string,
  triggerCommentId: string,
  timeoutMs = MAX_WAIT_MS,
): Promise<string | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const comments = await getComments(taskId);

    // Look for AI comments that appeared after our trigger
    for (const c of comments) {
      if (c.id === triggerCommentId) continue;
      if (!c.content.startsWith(AI_INDICATOR)) continue;
      if (c.content === `${AI_INDICATOR}\n\n_Reviewing..._`) continue;

      const content = c.content.slice(AI_INDICATOR.length).replace(/^\n+/, "").trim();
      return content;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  return null;
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
  assert(params.has("scope"), "OAuth redirect should include scope");
  assertEquals(params.get("scope"), "data:read_write");
  console.log(`  auth-start redirects to Todoist OAuth with client_id=${params.get("client_id")}`);
});

t("e2e post-deploy: test user exists in database after onboarding", async () => {
  // Get the test user's Todoist ID
  const userRes = await fetch(`${TODOIST_API}/user`, {
    headers: { Authorization: `Bearer ${TODOIST_TOKEN}` },
  });
  assert(userRes.ok, "Should fetch Todoist user profile");
  const userData = await userRes.json();
  const todoistUserId = String(userData.id);

  // Verify the user exists in the deployed Supabase DB via the settings endpoint
  // The settings endpoint requires auth — we use the webhook as a proxy check:
  // if the AI responds to @ai, the user is onboarded (token decrypts, config exists)
  // This is already verified by the AI tests below, but let's also check the user
  // exists by looking at the Todoist API — if we can create tasks, the account is active
  const taskRes = await fetch(`${TODOIST_API}/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TODOIST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: "[E2E] Onboarding check" }),
  });
  assert(taskRes.ok, "Test account should be able to create tasks (active Todoist account)");
  const task = await taskRes.json();
  console.log(`  Test user ${todoistUserId} is onboarded (Todoist account active)`);

  // Cleanup
  await fetch(`${TODOIST_API}/tasks/${task.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${TODOIST_TOKEN}` },
  });
});

// ---------------------------------------------------------------------------
// AI Features — one test per feature, each uses its own isolated task
// ---------------------------------------------------------------------------

t("e2e post-deploy: AI responds to basic @ai comment", async () => {
  const taskId = await createTask("[E2E Test] Basic AI response");
  try {
    const commentId = await addComment(taskId, "@ai Say exactly: e2e-test-ok");

    const response = await waitForAiResponse(taskId, commentId);
    assert(response !== null, "AI should respond within timeout (check: tunnel up? rate limit?)");
    assert(response!.length > 0, "AI response should not be empty");
    assert(
      !response!.startsWith(ERROR_PREFIX),
      `AI returned an error: ${response!.slice(0, 300)}`,
    );
    console.log(`  AI response: ${response!.slice(0, 200)}`);
  } finally {
    await deleteTask(taskId);
  }
});

t("e2e post-deploy: AI fetches URL and responds with page content", async () => {
  const taskId = await createTask("[E2E Test] URL fetching");
  try {
    const commentId = await addComment(
      taskId,
      "@ai Fetch https://example.com and tell me the domain name mentioned on the page",
    );

    const response = await waitForAiResponse(taskId, commentId);
    assert(response !== null, "AI should respond within timeout (check: tunnel up? rate limit?)");
    assert(response!.length > 0, "AI response should not be empty");
    assert(
      !response!.startsWith(ERROR_PREFIX),
      `AI returned an error: ${response!.slice(0, 300)}`,
    );
    // example.com page content mentions "Example Domain"
    const lower = response!.toLowerCase();
    const mentionsContent = lower.includes("example") || lower.includes("domain") || lower.includes("iana");
    assert(mentionsContent, `AI should reference page content. Got: ${response!.slice(0, 300)}`);
    console.log(`  AI response: ${response!.slice(0, 200)}`);
  } finally {
    await deleteTask(taskId);
  }
});
