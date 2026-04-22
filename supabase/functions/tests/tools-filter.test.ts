import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  filterTodoistTools,
  handleTodoistTool,
  TODOIST_TOOL_SPECS,
  toAnthropicTools,
  toOpenAiTools,
} from "../_shared/tools.ts";
import type { TodoistClient } from "../_shared/todoist.ts";

const READ_ONLY = ["list_tasks", "list_projects", "list_labels"];

// deno-lint-ignore no-explicit-any
type Calls = Array<{ method: string; args: any[] }>;

function makeSpyClient(): { client: TodoistClient; calls: Calls } {
  const calls: Calls = [];
  const defaults: Record<string, (...args: unknown[]) => unknown> = {
    listTasks: () => [],
    createTask: (input: unknown) => ({
      id: "t-new",
      content: (input as { content: string }).content,
    }),
    updateTask: (id: unknown) => ({ id: id as string, content: "x" }),
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
  const wrapped: Record<string, unknown> = {};
  for (const [method, impl] of Object.entries(defaults)) {
    // deno-lint-ignore no-explicit-any
    wrapped[method] = async (...args: any[]) => {
      calls.push({ method, args });
      return await (impl as (...a: unknown[]) => unknown)(...args);
    };
  }
  return { client: wrapped as unknown as TodoistClient, calls };
}

Deno.test("filterTodoistTools full returns all specs", () => {
  const out = filterTodoistTools(TODOIST_TOOL_SPECS, "full");
  assertEquals(out.length, TODOIST_TOOL_SPECS.length);
});

Deno.test("filterTodoistTools read_only returns exactly the 3 read tools", () => {
  const out = filterTodoistTools(TODOIST_TOOL_SPECS, "read_only");
  assertEquals(out.map((t) => t.name).sort(), [...READ_ONLY].sort());
});

Deno.test("toAnthropicTools(read_only) emits 3 tool entries", () => {
  const out = toAnthropicTools("read_only");
  assertEquals(out.length, 3);
  const names = out.map((t) => (t as { name: string }).name).sort();
  assertEquals(names, [...READ_ONLY].sort());
});

Deno.test("toOpenAiTools(read_only) emits 3 function entries", () => {
  const out = toOpenAiTools("read_only");
  assertEquals(out.length, 3);
  for (const entry of out) {
    assertEquals((entry as { type: string }).type, "function");
  }
});

Deno.test("toAnthropicTools() defaults to full", () => {
  assertEquals(toAnthropicTools().length, TODOIST_TOOL_SPECS.length);
});

Deno.test("handleTodoistTool read_only blocks update_task without calling client", async () => {
  const { client, calls } = makeSpyClient();
  const out = await handleTodoistTool(
    "update_task",
    JSON.stringify({ task_id: "x", content: "y" }),
    client,
    "read_only",
  );
  assertStringIncludes(out, "not available on Free tier");
  assert(!calls.some((c) => c.method === "updateTask"));
});

Deno.test("handleTodoistTool read_only blocks create_task and delete_task", async () => {
  const { client, calls } = makeSpyClient();
  for (const name of ["create_task", "delete_task", "complete_task", "create_project", "create_label"]) {
    const out = await handleTodoistTool(name, "{}", client, "read_only");
    assertStringIncludes(out, "not available on Free tier");
  }
  assertEquals(calls.length, 0);
});

Deno.test("handleTodoistTool read_only blocks proxy_-prefixed write tool", async () => {
  const { client, calls } = makeSpyClient();
  const out = await handleTodoistTool(
    "proxy_update_task",
    JSON.stringify({ task_id: "x" }),
    client,
    "read_only",
  );
  assertStringIncludes(out, "not available on Free tier");
  assertEquals(calls.length, 0);
});

Deno.test("handleTodoistTool read_only still allows list_tasks", async () => {
  const { client, calls } = makeSpyClient();
  const out = await handleTodoistTool("list_tasks", "{}", client, "read_only");
  assertStringIncludes(out, "No matching tasks.");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].method, "listTasks");
});

Deno.test("handleTodoistTool full still allows update_task", async () => {
  const { client, calls } = makeSpyClient();
  const out = await handleTodoistTool(
    "update_task",
    JSON.stringify({ task_id: "x" }),
    client,
    "full",
  );
  assertStringIncludes(out, "Updated task");
  assert(calls.some((c) => c.method === "updateTask"));
});
