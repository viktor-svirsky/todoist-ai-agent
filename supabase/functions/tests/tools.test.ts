import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  handleTodoistTool,
  isTodoistToolName,
  toAnthropicTools,
  toOpenAiTools,
  TODOIST_TOOL_SPECS,
  AGENTIC_SYSTEM_PROMPT,
} from "../_shared/tools.ts";
import type { TodoistClient } from "../_shared/todoist.ts";

// ---------------------------------------------------------------------------
// Fake TodoistClient — records calls, returns canned data.
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type Calls = Array<{ method: string; args: any[] }>;

function makeFakeClient(
  overrides: Partial<Record<keyof TodoistClient, (...args: unknown[]) => unknown>> = {},
): { client: TodoistClient; calls: Calls } {
  const calls: Calls = [];
  // deno-lint-ignore no-explicit-any
  const track = (method: string, fn: (...args: any[]) => any) =>
    // deno-lint-ignore no-explicit-any
    async (...args: any[]) => {
      calls.push({ method, args });
      return await fn(...args);
    };

  const defaults: Record<string, (...args: unknown[]) => unknown> = {
    listTasks: () => [],
    createTask: (input: unknown) => ({
      id: "t-new",
      content: (input as { content: string }).content,
    }),
    updateTask: (id: unknown) => ({ id: id as string, content: "updated" }),
    completeTask: () => undefined,
    uncompleteTask: () => undefined,
    deleteTask: () => undefined,
    listProjects: () => [],
    createProject: (input: unknown) => ({
      id: "p-new",
      name: (input as { name: string }).name,
    }),
    listLabels: () => [],
    createLabel: (input: unknown) => ({
      id: "l-new",
      name: (input as { name: string }).name,
    }),
  };
  const merged = { ...defaults, ...overrides };
  const wrapped: Record<string, unknown> = {};
  for (const [method, impl] of Object.entries(merged)) {
    wrapped[method] = track(method, impl as (...args: unknown[]) => unknown);
  }
  return { client: wrapped as unknown as TodoistClient, calls };
}

// ---------------------------------------------------------------------------
// Tool specs / provider conversion
// ---------------------------------------------------------------------------

Deno.test("TODOIST_TOOL_SPECS: covers expected CRUD surface", () => {
  const names = TODOIST_TOOL_SPECS.map((t) => t.name).sort();
  const expected = [
    "complete_task",
    "create_label",
    "create_project",
    "create_task",
    "delete_task",
    "list_labels",
    "list_projects",
    "list_tasks",
    "uncomplete_task",
    "update_task",
  ];
  assertEquals(names, expected);
});

Deno.test("AGENTIC_SYSTEM_PROMPT: mentions secretary role and action orientation", () => {
  assertStringIncludes(AGENTIC_SYSTEM_PROMPT, "secretary");
  assertStringIncludes(AGENTIC_SYSTEM_PROMPT, "Prefer action");
});

Deno.test("isTodoistToolName: matches known names and ignores proxy_ prefix", () => {
  assertEquals(isTodoistToolName("list_tasks"), true);
  assertEquals(isTodoistToolName("proxy_list_tasks"), true);
  assertEquals(isTodoistToolName("web_search"), false);
  assertEquals(isTodoistToolName("unknown_tool"), false);
});

Deno.test("toAnthropicTools: returns native Anthropic tool shape", () => {
  const tools = toAnthropicTools();
  assertEquals(tools.length, TODOIST_TOOL_SPECS.length);
  const first = tools[0] as { name: string; input_schema: unknown };
  assertEquals(typeof first.name, "string");
  assertEquals(typeof first.input_schema, "object");
});

Deno.test("toOpenAiTools: wraps specs in function-calling shape", () => {
  const tools = toOpenAiTools();
  assertEquals(tools.length, TODOIST_TOOL_SPECS.length);
  const first = tools[0] as {
    type: string;
    function: { name: string; parameters: unknown };
  };
  assertEquals(first.type, "function");
  assertEquals(typeof first.function.name, "string");
});

// ---------------------------------------------------------------------------
// handleTodoistTool dispatch
// ---------------------------------------------------------------------------

Deno.test("list_tasks: forwards filter params and formats summary", async () => {
  const { client, calls } = makeFakeClient({
    listTasks: (() => [
      { id: "t1", content: "Task one", priority: 1 },
      { id: "t2", content: "Task two", due: { string: "today" }, priority: 4 },
    ]) as unknown as TodoistClient["listTasks"],
  });
  const result = await handleTodoistTool(
    "list_tasks",
    JSON.stringify({ project_id: "p1", filter: "today" }),
    client,
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].args[0], { project_id: "p1", label: undefined, filter: "today" });
  assertStringIncludes(result, "2 task(s)");
  assertStringIncludes(result, "[t1] Task one");
  assertStringIncludes(result, "[t2] Task two (due today) [p1]");
});

Deno.test("list_tasks: empty result returns friendly message", async () => {
  const { client } = makeFakeClient();
  const result = await handleTodoistTool("list_tasks", "{}", client);
  assertEquals(result, "No matching tasks.");
});

Deno.test("create_task: passes input through and confirms", async () => {
  const { client, calls } = makeFakeClient();
  const result = await handleTodoistTool(
    "create_task",
    JSON.stringify({ content: "Buy milk", priority: 3 }),
    client,
  );
  assertEquals(calls[0].method, "createTask");
  assertEquals(calls[0].args[0], { content: "Buy milk", priority: 3 });
  assertStringIncludes(result, "Created task");
  assertStringIncludes(result, "Buy milk");
});

Deno.test("create_task: rejects when content missing", async () => {
  const { client, calls } = makeFakeClient();
  const result = await handleTodoistTool("create_task", "{}", client);
  assertEquals(calls.length, 0);
  assertStringIncludes(result, "content is required");
});

Deno.test("update_task: strips task_id from patch and forwards rest", async () => {
  const { client, calls } = makeFakeClient();
  await handleTodoistTool(
    "update_task",
    JSON.stringify({ task_id: "t1", content: "New content", priority: 2 }),
    client,
  );
  assertEquals(calls[0].args[0], "t1");
  assertEquals(calls[0].args[1], { content: "New content", priority: 2 });
});

Deno.test("update_task: rejects without task_id", async () => {
  const { client, calls } = makeFakeClient();
  const result = await handleTodoistTool(
    "update_task",
    JSON.stringify({ content: "x" }),
    client,
  );
  assertEquals(calls.length, 0);
  assertStringIncludes(result, "task_id is required");
});

Deno.test("complete_task / uncomplete_task / delete_task: call the right method", async () => {
  for (const tool of ["complete_task", "uncomplete_task", "delete_task"]) {
    const { client, calls } = makeFakeClient();
    const result = await handleTodoistTool(
      tool,
      JSON.stringify({ task_id: "t9" }),
      client,
    );
    const expectedMethod = {
      complete_task: "completeTask",
      uncomplete_task: "uncompleteTask",
      delete_task: "deleteTask",
    }[tool]!;
    assertEquals(calls[0].method, expectedMethod);
    assertStringIncludes(result, "t9");
  }
});

Deno.test("list_projects: formats with inbox marker", async () => {
  const { client } = makeFakeClient({
    listProjects: (() => [
      { id: "p1", name: "Work", is_inbox_project: false },
      { id: "p-inbox", name: "Inbox", is_inbox_project: true },
    ]) as unknown as TodoistClient["listProjects"],
  });
  const result = await handleTodoistTool("list_projects", "{}", client);
  assertStringIncludes(result, "[p1] Work");
  assertStringIncludes(result, "[p-inbox] Inbox (Inbox)");
});

Deno.test("create_project: requires name", async () => {
  const { client, calls } = makeFakeClient();
  const result = await handleTodoistTool("create_project", "{}", client);
  assertEquals(calls.length, 0);
  assertStringIncludes(result, "name is required");
});

Deno.test("handleTodoistTool: unknown name returns clear error", async () => {
  const { client } = makeFakeClient();
  const result = await handleTodoistTool("nonexistent_tool", "{}", client);
  assertStringIncludes(result, "Unknown Todoist tool");
});

Deno.test("handleTodoistTool: wraps thrown client errors", async () => {
  const { client } = makeFakeClient({
    listTasks: (() => {
      throw new Error("API down");
    }) as unknown as TodoistClient["listTasks"],
  });
  const result = await handleTodoistTool("list_tasks", "{}", client);
  assertStringIncludes(result, "Tool error (list_tasks)");
  assertStringIncludes(result, "API down");
});

Deno.test("handleTodoistTool: handles malformed JSON args gracefully", async () => {
  const { client } = makeFakeClient();
  // Malformed JSON should parse as empty object; create_task then fails validation.
  const result = await handleTodoistTool("create_task", "{not json", client);
  assertStringIncludes(result, "content is required");
});

Deno.test("handleTodoistTool: strips proxy_ prefix from tool name", async () => {
  const { client, calls } = makeFakeClient();
  await handleTodoistTool(
    "proxy_create_task",
    JSON.stringify({ content: "hi" }),
    client,
  );
  assertEquals(calls[0].method, "createTask");
});
