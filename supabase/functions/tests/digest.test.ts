import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  buildDigestPrompt,
  isDigestTimeNow,
  type TodoistTask,
  type TodoistProject,
  type DigestUser,
} from "../_shared/digest.ts";

// ---------------------------------------------------------------------------
// Env setup (needed for dynamic imports that reference Deno.env)
// ---------------------------------------------------------------------------

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("ENCRYPTION_KEY", btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetch(
  fn: (url: string, init?: RequestInit) => Response | Promise<Response>,
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: unknown) =>
    Promise.resolve(fn(String(input), init as RequestInit))) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

// Disable sanitizers — Supabase client starts token refresh intervals
function t(name: string, fn: () => Promise<void> | void) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<TodoistTask> = {}): TodoistTask {
  return {
    id: "task-1",
    content: "Buy groceries",
    priority: 1,
    labels: [],
    ...overrides,
  };
}

function makeProject(overrides: Partial<TodoistProject> = {}): TodoistProject {
  return {
    id: "proj-1",
    name: "Personal",
    ...overrides,
  };
}

function makeUser(overrides: Partial<DigestUser> = {}): DigestUser {
  return {
    id: "user-1",
    todoist_token: "test-token",
    custom_ai_base_url: null,
    custom_ai_api_key: null,
    custom_ai_model: null,
    custom_brave_key: null,
    custom_prompt: null,
    digest_enabled: true,
    digest_time: "08:00",
    digest_timezone: "UTC",
    digest_project_id: null,
    last_digest_at: null,
    is_disabled: false,
    ...overrides,
  };
}

// ============================================================================
// buildDigestPrompt
// ============================================================================

Deno.test("buildDigestPrompt: includes today's date and timezone in system message", () => {
  const { system } = buildDigestPrompt([], [], [], [], "America/New_York");
  assertStringIncludes(system, "America/New_York");
  // Should contain a date-like string
  assertStringIncludes(system, "Current date:");
});

Deno.test("buildDigestPrompt: formats overdue tasks with urgency indicators", () => {
  const overdue = [makeTask({ content: "Pay rent", priority: 4, due: { date: "2025-01-01" } })];
  const { user } = buildDigestPrompt(overdue, [], [], [], "UTC");
  assertStringIncludes(user, "OVERDUE");
  assertStringIncludes(user, "Pay rent");
  assertStringIncludes(user, "P1"); // priority 4 = P1 in Todoist
});

Deno.test("buildDigestPrompt: formats today's tasks sorted by priority", () => {
  const today = [
    makeTask({ id: "t1", content: "Low priority", priority: 1 }),
    makeTask({ id: "t2", content: "High priority", priority: 4 }),
    makeTask({ id: "t3", content: "Medium priority", priority: 3 }),
  ];
  const { user } = buildDigestPrompt([], today, [], [], "UTC");
  assertStringIncludes(user, "TODAY'S TASKS");
  // High priority should appear before low priority
  const highIdx = user.indexOf("High priority");
  const lowIdx = user.indexOf("Low priority");
  assertEquals(highIdx < lowIdx, true);
});

Deno.test("buildDigestPrompt: formats upcoming tasks grouped by day", () => {
  const upcoming = [
    makeTask({ id: "t1", content: "Monday task", due: { date: "2025-03-10" } }),
    makeTask({ id: "t2", content: "Tuesday task", due: { date: "2025-03-11" } }),
    makeTask({ id: "t3", content: "Monday task 2", due: { date: "2025-03-10" } }),
  ];
  const { user } = buildDigestPrompt([], [], upcoming, [], "UTC");
  assertStringIncludes(user, "UPCOMING");
  assertStringIncludes(user, "2025-03-10");
  assertStringIncludes(user, "2025-03-11");
  assertStringIncludes(user, "Monday task");
  assertStringIncludes(user, "Tuesday task");
});

Deno.test("buildDigestPrompt: handles empty task list gracefully", () => {
  const { user } = buildDigestPrompt([], [], [], [], "UTC");
  assertStringIncludes(user, "No tasks for today");
});

Deno.test("buildDigestPrompt: includes user's custom prompt if set", () => {
  const { system } = buildDigestPrompt([], [], [], [], "UTC", "Respond in German");
  assertStringIncludes(system, "Respond in German");
});

Deno.test("buildDigestPrompt: truncates very long task lists", () => {
  const manyTasks = Array.from({ length: 200 }, (_, i) =>
    makeTask({
      id: `t${i}`,
      content: `Task number ${i} with a very long description to inflate the size ${"x".repeat(50)}`,
      due: { date: "2025-03-10" },
    })
  );
  const { user } = buildDigestPrompt([], manyTasks, [], [], "UTC");
  // Should be truncated to max 8000 chars + truncation indicator
  assertEquals(user.length <= 8100, true);
});

Deno.test("buildDigestPrompt: includes project names from project map", () => {
  const tasks = [makeTask({ content: "Work task", project_id: "proj-1" })];
  const projects = [makeProject({ id: "proj-1", name: "Work" })];
  const { user } = buildDigestPrompt([], tasks, [], projects, "UTC");
  assertStringIncludes(user, "[Work]");
});

Deno.test("buildDigestPrompt: includes task labels", () => {
  const tasks = [makeTask({ content: "Labeled task", labels: ["urgent", "home"] })];
  const { user } = buildDigestPrompt([], tasks, [], [], "UTC");
  assertStringIncludes(user, "(urgent, home)");
});

// ============================================================================
// processDigestForUser
// ============================================================================

// Dynamic import to allow env setup first
const { processDigestForUser } = await import("../_shared/digest.ts");

t("processDigestForUser: fetches tasks, calls AI, posts task (happy path)", async () => {
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  const restore = mockFetch((url, init) => {
    fetchCalls.push({ url, init });

    // Todoist getTasks (overdue, today, upcoming)
    if (url.includes("/tasks?")) {
      return new Response(JSON.stringify({ results: [{ id: "t1", content: "Test", priority: 1, labels: [] }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Todoist getProjects
    if (url.includes("/projects") && !url.includes("tasks")) {
      return new Response(JSON.stringify({ results: [{ id: "p1", name: "Inbox" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // AI API call
    if (url.includes("anthropic.com") || url.includes("chat/completions")) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Your daily summary" } }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Todoist createTask
    if (url.includes("/tasks") && init?.method === "POST") {
      return new Response(JSON.stringify({ id: "new-task-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Supabase update last_digest_at
    if (url.includes("/rest/v1/users_config")) {
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  try {
    Deno.env.set("DEFAULT_AI_BASE_URL", "https://api.openai.com/v1");
    Deno.env.set("DEFAULT_AI_API_KEY", "test-key");
    const result = await processDigestForUser(makeUser());
    assertEquals(result, true);

    // Verify createTask was called
    const createCall = fetchCalls.find((c) => c.url.includes("/tasks") && c.init?.method === "POST");
    assertEquals(!!createCall, true);
    const body = JSON.parse(createCall!.init!.body as string);
    assertStringIncludes(body.content, "Daily Digest");
  } finally {
    restore();
  }
});

t("processDigestForUser: skips user when Todoist API returns error", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("/tasks?")) {
      return new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/projects")) {
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  try {
    const result = await processDigestForUser(makeUser());
    assertEquals(result, false);
  } finally {
    restore();
  }
});

t("processDigestForUser: skips user when AI API returns error", async () => {
  const restore = mockFetch((url, init) => {
    if (url.includes("/tasks?")) {
      return new Response(JSON.stringify({ results: [{ id: "t1", content: "Test", priority: 1, labels: [] }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/projects") && !url.includes("tasks")) {
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("chat/completions")) {
      return new Response("Internal Server Error", { status: 500 });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  try {
    Deno.env.set("DEFAULT_AI_BASE_URL", "https://api.openai.com/v1");
    Deno.env.set("DEFAULT_AI_API_KEY", "test-key");
    const result = await processDigestForUser(makeUser());
    assertEquals(result, false);
  } finally {
    restore();
  }
});

t("processDigestForUser: updates last_digest_at after successful delivery", async () => {
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  const restore = mockFetch((url, init) => {
    fetchCalls.push({ url, init });
    if (url.includes("/tasks?")) {
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/projects") && !url.includes("tasks")) {
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("chat/completions")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: "Summary" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/tasks") && init?.method === "POST") {
      return new Response(JSON.stringify({ id: "t1" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  try {
    Deno.env.set("DEFAULT_AI_BASE_URL", "https://api.openai.com/v1");
    Deno.env.set("DEFAULT_AI_API_KEY", "test-key");
    const result = await processDigestForUser(makeUser());
    assertEquals(result, true);

    // Verify Supabase update was called with last_digest_at
    const updateCall = fetchCalls.find((c) =>
      c.url.includes("/rest/v1/users_config") && c.init?.method === "PATCH"
    );
    assertEquals(!!updateCall, true);
  } finally {
    restore();
  }
});

t("processDigestForUser: does not update last_digest_at on failure", async () => {
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  const restore = mockFetch((url, init) => {
    fetchCalls.push({ url, init });
    if (url.includes("/tasks?")) {
      return new Response("{}", { status: 500, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/projects")) {
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  try {
    const result = await processDigestForUser(makeUser());
    assertEquals(result, false);

    // Verify no Supabase update was called
    const updateCall = fetchCalls.find((c) =>
      c.url.includes("/rest/v1/users_config") && c.init?.method === "PATCH"
    );
    assertEquals(!!updateCall, false);
  } finally {
    restore();
  }
});

t("processDigestForUser: skips disabled accounts", async () => {
  const restore = mockFetch(() => {
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  try {
    const result = await processDigestForUser(makeUser({ is_disabled: true }));
    assertEquals(result, false);
  } finally {
    restore();
  }
});

t("processDigestForUser: skips when digest not enabled", async () => {
  const restore = mockFetch(() => {
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  try {
    const result = await processDigestForUser(makeUser({ digest_enabled: false }));
    assertEquals(result, false);
  } finally {
    restore();
  }
});

t("processDigestForUser: posts to specified project when digest_project_id is set", async () => {
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  const restore = mockFetch((url, init) => {
    fetchCalls.push({ url, init });
    if (url.includes("/tasks?")) {
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/projects") && !url.includes("tasks")) {
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("chat/completions")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: "Summary" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/tasks") && init?.method === "POST") {
      return new Response(JSON.stringify({ id: "t1" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  try {
    Deno.env.set("DEFAULT_AI_BASE_URL", "https://api.openai.com/v1");
    Deno.env.set("DEFAULT_AI_API_KEY", "test-key");
    const result = await processDigestForUser(makeUser({ digest_project_id: "proj-123" }));
    assertEquals(result, true);

    const createCall = fetchCalls.find((c) =>
      c.url.includes("/tasks") && c.init?.method === "POST" && !c.url.includes("?")
    );
    const body = JSON.parse(createCall!.init!.body as string);
    assertEquals(body.project_id, "proj-123");
  } finally {
    restore();
  }
});

// ============================================================================
// isDigestTimeNow
// ============================================================================

Deno.test("isDigestTimeNow: returns true when current time matches digest_time", () => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const h = parts.find((p) => p.type === "hour")!.value.padStart(2, "0");
  const m = parts.find((p) => p.type === "minute")!.value.padStart(2, "0");
  assertEquals(isDigestTimeNow(`${h}:${m}`, "UTC"), true);
});

Deno.test("isDigestTimeNow: returns false when time is far from digest_time", () => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")!.value);
  // Set target 3 hours in the future
  const targetHour = (h + 3) % 24;
  assertEquals(isDigestTimeNow(`${String(targetHour).padStart(2, "0")}:00`, "UTC"), false);
});

Deno.test("isDigestTimeNow: returns false for invalid timezone", () => {
  assertEquals(isDigestTimeNow("08:00", "Mars/Olympus"), false);
});
