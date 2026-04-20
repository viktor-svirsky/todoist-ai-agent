import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { TodoistClient } from "../_shared/todoist.ts";
import { AI_INDICATOR, PROGRESS_INDICATOR } from "../_shared/constants.ts";

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetch(response: { status: number; body: unknown }): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, _init?: unknown) => {
    return Promise.resolve(new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    }));
  }) as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

function capturingFetch(response: { status: number; body: unknown }): {
  restore: () => void;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = ((input: unknown, init?: unknown) => {
    calls.push({ url: String(input), init: init as RequestInit });
    return Promise.resolve(new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    }));
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = originalFetch; }, calls };
}

function mockFetchBinary(data: Uint8Array): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, _init?: unknown) => {
    return Promise.resolve(new Response(data as unknown as BodyInit, {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    }));
  }) as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

// ---------------------------------------------------------------------------
// getTask
// ---------------------------------------------------------------------------

Deno.test("TodoistClient.getTask: returns task data on success", async () => {
  const restore = mockFetch({
    status: 200,
    body: { id: "123", content: "Buy milk", description: "" },
  });
  try {
    const client = new TodoistClient("test-token");
    const task = await client.getTask("123");
    assertEquals(task.id, "123");
    assertEquals(task.content, "Buy milk");
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.getTask: throws on API error", async () => {
  const restore = mockFetch({ status: 404, body: { error: "Not found" } });
  try {
    const client = new TodoistClient("test-token");
    await assertRejects(
      () => client.getTask("999"),
      Error,
      "Todoist getTask failed: 404"
    );
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.getTask: sends Authorization header", async () => {
  const { restore, calls } = capturingFetch({
    status: 200,
    body: { id: "1", content: "task" },
  });
  try {
    const client = new TodoistClient("my-secret-token");
    await client.getTask("1");
    assertEquals(calls.length, 1);
    const headers = calls[0].init.headers as Record<string, string>;
    assertEquals(headers["Authorization"], "Bearer my-secret-token");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// getComments
// ---------------------------------------------------------------------------

Deno.test("TodoistClient.getComments: returns results array", async () => {
  const restore = mockFetch({
    status: 200,
    body: { results: [{ id: "c1", content: "hello" }, { id: "c2", content: "world" }] },
  });
  try {
    const client = new TodoistClient("token");
    const comments = await client.getComments("task1");
    assertEquals(comments.length, 2);
    assertEquals(comments[0].id, "c1");
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.getComments: returns empty when no results field", async () => {
  const restore = mockFetch({ status: 200, body: {} });
  try {
    const client = new TodoistClient("token");
    const comments = await client.getComments("task1");
    assertEquals(comments, []);
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.getComments: throws on API error", async () => {
  const restore = mockFetch({ status: 500, body: {} });
  try {
    const client = new TodoistClient("token");
    await assertRejects(
      () => client.getComments("task1"),
      Error,
      "Todoist getComments failed: 500"
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// postComment
// ---------------------------------------------------------------------------

Deno.test("TodoistClient.postComment: wraps content with AI_INDICATOR", async () => {
  const { restore, calls } = capturingFetch({
    status: 200,
    body: { id: "comment-1" },
  });
  try {
    const client = new TodoistClient("token");
    const id = await client.postComment("task1", "The answer is 42.");
    assertEquals(id, "comment-1");
    const body = JSON.parse(calls[0].init.body as string);
    assertEquals(body.task_id, "task1");
    assertStringIncludes(body.content, AI_INDICATOR);
    assertStringIncludes(body.content, "The answer is 42.");
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.postComment: throws on API error", async () => {
  const restore = mockFetch({ status: 403, body: {} });
  try {
    const client = new TodoistClient("token");
    await assertRejects(
      () => client.postComment("task1", "text"),
      Error,
      "Todoist postComment failed: 403"
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// postProgressComment
// ---------------------------------------------------------------------------

Deno.test("TodoistClient.postProgressComment: sends PROGRESS_INDICATOR", async () => {
  const { restore, calls } = capturingFetch({
    status: 200,
    body: { id: "progress-1" },
  });
  try {
    const client = new TodoistClient("token");
    const id = await client.postProgressComment("task1");
    assertEquals(id, "progress-1");
    const body = JSON.parse(calls[0].init.body as string);
    assertEquals(body.content, PROGRESS_INDICATOR);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// updateComment
// ---------------------------------------------------------------------------

Deno.test("TodoistClient.updateComment: wraps content with AI_INDICATOR", async () => {
  const { restore, calls } = capturingFetch({
    status: 200,
    body: {},
  });
  try {
    const client = new TodoistClient("token");
    await client.updateComment("comment-1", "Updated answer");
    const body = JSON.parse(calls[0].init.body as string);
    assertStringIncludes(body.content, AI_INDICATOR);
    assertStringIncludes(body.content, "Updated answer");
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.updateComment: throws on API error", async () => {
  const restore = mockFetch({ status: 404, body: {} });
  try {
    const client = new TodoistClient("token");
    await assertRejects(
      () => client.updateComment("comment-1", "text"),
      Error,
      "Todoist updateComment failed: 404"
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// downloadFile
// ---------------------------------------------------------------------------

Deno.test("TodoistClient.downloadFile: returns file bytes", async () => {
  const data = new TextEncoder().encode("file contents");
  const restore = mockFetchBinary(data);
  try {
    const client = new TodoistClient("token");
    const result = await client.downloadFile("https://cdn.todoist.com/file.png");
    assertEquals(new TextDecoder().decode(result), "file contents");
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.downloadFile: sends auth header for trusted domains", async () => {
  const { restore, calls } = capturingFetch({ status: 200, body: {} });
  try {
    const client = new TodoistClient("my-token");
    // Using arrayBuffer fallback since mock returns JSON
    try { await client.downloadFile("https://cdn.todoist.com/file.png"); } catch { /* ignore parse */ }
    const headers = calls[0].init.headers as Record<string, string>;
    assertEquals(headers["Authorization"], "Bearer my-token");
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.downloadFile: rejects untrusted domains", async () => {
  const restore = mockFetch({ status: 200, body: {} });
  try {
    const client = new TodoistClient("my-token");
    await assertRejects(
      () => client.downloadFile("https://external-cdn.example.com/file.png"),
      Error,
      "File URL is not from a trusted Todoist domain"
    );
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.downloadFile: throws on HTTP error", async () => {
  const restore = mockFetch({ status: 404, body: {} });
  try {
    const client = new TodoistClient("token");
    await assertRejects(
      () => client.downloadFile("https://cdn.todoist.com/missing.png"),
      Error,
      "Download failed: 404"
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Task CRUD
// ---------------------------------------------------------------------------

Deno.test("TodoistClient.listTasks: passes filter params as query string", async () => {
  const { restore, calls } = capturingFetch({
    status: 200,
    body: { results: [{ id: "t1", content: "Task 1" }] },
  });
  try {
    const client = new TodoistClient("token");
    const tasks = await client.listTasks({
      project_id: "p1",
      label: "urgent",
      filter: "today",
    });
    assertEquals(tasks.length, 1);
    assertStringIncludes(calls[0].url, "project_id=p1");
    assertStringIncludes(calls[0].url, "label=urgent");
    assertStringIncludes(calls[0].url, "filter=today");
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.listTasks: returns empty array when no results", async () => {
  const restore = mockFetch({ status: 200, body: {} });
  try {
    const client = new TodoistClient("token");
    const tasks = await client.listTasks();
    assertEquals(tasks, []);
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.createTask: posts input as JSON body", async () => {
  const { restore, calls } = capturingFetch({
    status: 200,
    body: { id: "new-1", content: "Buy milk" },
  });
  try {
    const client = new TodoistClient("token");
    const task = await client.createTask({
      content: "Buy milk",
      priority: 3,
      due_string: "tomorrow",
    });
    assertEquals(task.id, "new-1");
    const body = JSON.parse(calls[0].init.body as string);
    assertEquals(body.content, "Buy milk");
    assertEquals(body.priority, 3);
    assertEquals(body.due_string, "tomorrow");
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.updateTask: sends partial update as JSON", async () => {
  const { restore, calls } = capturingFetch({
    status: 200,
    body: { id: "t1", content: "Updated" },
  });
  try {
    const client = new TodoistClient("token");
    await client.updateTask("t1", { content: "Updated", priority: 1 });
    assertStringIncludes(calls[0].url, "/tasks/t1");
    const body = JSON.parse(calls[0].init.body as string);
    assertEquals(body.content, "Updated");
    assertEquals(body.priority, 1);
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.completeTask: POSTs to /close endpoint", async () => {
  const { restore, calls } = capturingFetch({ status: 200, body: {} });
  try {
    const client = new TodoistClient("token");
    await client.completeTask("t1");
    assertStringIncludes(calls[0].url, "/tasks/t1/close");
    assertEquals(calls[0].init.method, "POST");
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.uncompleteTask: POSTs to /reopen endpoint", async () => {
  const { restore, calls } = capturingFetch({ status: 200, body: {} });
  try {
    const client = new TodoistClient("token");
    await client.uncompleteTask("t1");
    assertStringIncludes(calls[0].url, "/tasks/t1/reopen");
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.deleteTask: sends DELETE request", async () => {
  const { restore, calls } = capturingFetch({ status: 200, body: {} });
  try {
    const client = new TodoistClient("token");
    await client.deleteTask("t1");
    assertStringIncludes(calls[0].url, "/tasks/t1");
    assertEquals(calls[0].init.method, "DELETE");
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.moveTask: delegates to updateTask with target", async () => {
  const { restore, calls } = capturingFetch({ status: 200, body: { id: "t1" } });
  try {
    const client = new TodoistClient("token");
    await client.moveTask("t1", { project_id: "p2" });
    const body = JSON.parse(calls[0].init.body as string);
    assertEquals(body.project_id, "p2");
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.listProjects: returns results array", async () => {
  const restore = mockFetch({
    status: 200,
    body: { results: [{ id: "p1", name: "Work", is_inbox_project: false }] },
  });
  try {
    const client = new TodoistClient("token");
    const projects = await client.listProjects();
    assertEquals(projects.length, 1);
    assertEquals(projects[0].name, "Work");
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.createProject: posts name as JSON body", async () => {
  const { restore, calls } = capturingFetch({
    status: 200,
    body: { id: "p-new", name: "New Project" },
  });
  try {
    const client = new TodoistClient("token");
    const project = await client.createProject({ name: "New Project" });
    assertEquals(project.name, "New Project");
    const body = JSON.parse(calls[0].init.body as string);
    assertEquals(body.name, "New Project");
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.listLabels: returns results array", async () => {
  const restore = mockFetch({
    status: 200,
    body: { results: [{ id: "l1", name: "urgent" }] },
  });
  try {
    const client = new TodoistClient("token");
    const labels = await client.listLabels();
    assertEquals(labels.length, 1);
    assertEquals(labels[0].name, "urgent");
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.createLabel: posts name as JSON body", async () => {
  const { restore, calls } = capturingFetch({
    status: 200,
    body: { id: "l-new", name: "new-label" },
  });
  try {
    const client = new TodoistClient("token");
    await client.createLabel({ name: "new-label" });
    const body = JSON.parse(calls[0].init.body as string);
    assertEquals(body.name, "new-label");
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.getInboxProjectId: returns inbox project id", async () => {
  const restore = mockFetch({
    status: 200,
    body: {
      results: [
        { id: "p1", name: "Work", is_inbox_project: false },
        { id: "p-inbox", name: "Inbox", is_inbox_project: true },
      ],
    },
  });
  try {
    const client = new TodoistClient("token");
    const id = await client.getInboxProjectId();
    assertEquals(id, "p-inbox");
  } finally {
    restore();
  }
});

Deno.test("TodoistClient.getInboxProjectId: throws when inbox not found", async () => {
  const restore = mockFetch({
    status: 200,
    body: { results: [{ id: "p1", name: "Work", is_inbox_project: false }] },
  });
  try {
    const client = new TodoistClient("token");
    await assertRejects(
      () => client.getInboxProjectId(),
      Error,
      "Inbox project not found",
    );
  } finally {
    restore();
  }
});
