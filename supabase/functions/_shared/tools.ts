import type { TodoistClient, TodoistTaskInput } from "./todoist.ts";

// Agentic system prompt used when Todoist tools are enabled. Replaces the default
// assistant prompt in ai.ts — the agent becomes a task-mutating secretary instead
// of an answer-only chat bot.
export const AGENTIC_SYSTEM_PROMPT = [
  "You are an AI secretary embedded in Todoist.",
  "You have direct access to the user's Todoist via tools. You can list, search, create, update, complete, and delete tasks. You can also manage projects and labels.",
  "Prefer action over explanation: when the user asks you to do something, do it, then report what you did.",
  "When the user asks a planning question (e.g. 'what should I focus on?'), use list_tasks first to read their actual state before answering.",
  "Before destructive actions (delete_task, bulk changes), confirm if the request is ambiguous; otherwise proceed.",
  "After mutations, briefly confirm what changed (e.g. 'Created 3 subtasks', 'Rescheduled 5 overdue items to tomorrow').",
  "For dates, use Todoist's natural-language format (e.g. 'today', 'tomorrow at 3pm', 'next monday') via the due_string field.",
  "Priority values: 1 = lowest, 4 = highest (Todoist inverts this in the UI).",
  "When including URLs in your response, format them as markdown links: [text](url).",
  "Respond concisely — replies post as Todoist comments.",
].join("\n");

// Tool definitions. We emit a neutral form and convert per-provider inside ai.ts.
interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export const TODOIST_TOOL_SPECS: ToolSpec[] = [
  {
    name: "list_tasks",
    description:
      "List the user's active tasks. Optionally filter by project, label, or Todoist filter expression (e.g. 'today', 'overdue', 'p1', 'no date').",
    input_schema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Only tasks in this project." },
        label: { type: "string", description: "Only tasks with this label name." },
        filter: {
          type: "string",
          description:
            "Todoist filter expression (e.g. 'today', 'overdue', 'p1 & !no date').",
        },
      },
    },
  },
  {
    name: "create_task",
    description: "Create a new task in Todoist.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Task title (required)." },
        description: { type: "string", description: "Optional task description." },
        project_id: {
          type: "string",
          description: "Project id. Defaults to Inbox if omitted.",
        },
        parent_id: {
          type: "string",
          description: "Parent task id — use to create subtasks.",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Label names to attach.",
        },
        priority: {
          type: "number",
          description: "1 (lowest) to 4 (highest).",
        },
        due_string: {
          type: "string",
          description:
            "Natural-language due date, e.g. 'today', 'tomorrow 9am', 'next mon'.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "update_task",
    description: "Update an existing task. Only provided fields are changed.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Task to update." },
        content: { type: "string" },
        description: { type: "string" },
        priority: { type: "number", description: "1–4." },
        due_string: { type: "string", description: "Natural-language due date." },
        labels: { type: "array", items: { type: "string" } },
        project_id: { type: "string", description: "Move to this project." },
        parent_id: { type: "string", description: "Move under this parent task." },
      },
      required: ["task_id"],
    },
  },
  {
    name: "complete_task",
    description: "Mark a task as completed.",
    input_schema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
    },
  },
  {
    name: "uncomplete_task",
    description: "Reopen a previously completed task.",
    input_schema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
    },
  },
  {
    name: "delete_task",
    description: "Permanently delete a task. This cannot be undone.",
    input_schema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
    },
  },
  {
    name: "list_projects",
    description: "List all of the user's projects.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_project",
    description: "Create a new project.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        parent_id: { type: "string", description: "Optional parent project id." },
        color: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_labels",
    description: "List all of the user's labels.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_label",
    description: "Create a new label.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        color: { type: "string" },
      },
      required: ["name"],
    },
  },
];

const TODOIST_TOOL_NAMES = new Set(TODOIST_TOOL_SPECS.map((t) => t.name));

export function isTodoistToolName(name: string): boolean {
  return TODOIST_TOOL_NAMES.has(name.replace(/^proxy_/, ""));
}

/** Convert neutral tool specs to Anthropic-native format. */
export function toAnthropicTools(): Record<string, unknown>[] {
  return TODOIST_TOOL_SPECS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

/** Convert neutral tool specs to OpenAI function-calling format. */
export function toOpenAiTools(): Record<string, unknown>[] {
  return TODOIST_TOOL_SPECS.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

function parseArgs(argsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argsJson);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function summarizeTask(t: { id: string; content: string; due?: { string?: string } | null; priority?: number }): string {
  const due = t.due?.string ? ` (due ${t.due.string})` : "";
  const pri = t.priority && t.priority > 1 ? ` [p${5 - t.priority}]` : "";
  return `- [${t.id}] ${t.content}${due}${pri}`;
}

/**
 * Dispatch a Todoist tool call to the TodoistClient and return a string summary
 * suitable for feeding back into the AI conversation.
 */
export async function handleTodoistTool(
  rawName: string,
  argsJson: string,
  client: TodoistClient,
): Promise<string> {
  const name = rawName.replace(/^proxy_/, "");
  const args = parseArgs(argsJson);

  try {
    switch (name) {
      case "list_tasks": {
        const tasks = await client.listTasks({
          project_id: args.project_id as string | undefined,
          label: args.label as string | undefined,
          filter: args.filter as string | undefined,
        });
        if (tasks.length === 0) return "No matching tasks.";
        return `${tasks.length} task(s):\n${tasks.map(summarizeTask).join("\n")}`;
      }

      case "create_task": {
        const input = args as Partial<TodoistTaskInput>;
        if (!input.content) return "Error: content is required.";
        const task = await client.createTask(input as TodoistTaskInput);
        return `Created task [${task.id}] "${task.content}".`;
      }

      case "update_task": {
        const taskId = args.task_id as string | undefined;
        if (!taskId) return "Error: task_id is required.";
        const { task_id: _omit, ...patch } = args;
        const task = await client.updateTask(taskId, patch as Partial<TodoistTaskInput>);
        return `Updated task [${task.id}] "${task.content}".`;
      }

      case "complete_task": {
        const taskId = args.task_id as string | undefined;
        if (!taskId) return "Error: task_id is required.";
        await client.completeTask(taskId);
        return `Completed task [${taskId}].`;
      }

      case "uncomplete_task": {
        const taskId = args.task_id as string | undefined;
        if (!taskId) return "Error: task_id is required.";
        await client.uncompleteTask(taskId);
        return `Reopened task [${taskId}].`;
      }

      case "delete_task": {
        const taskId = args.task_id as string | undefined;
        if (!taskId) return "Error: task_id is required.";
        await client.deleteTask(taskId);
        return `Deleted task [${taskId}].`;
      }

      case "list_projects": {
        const projects = await client.listProjects();
        if (projects.length === 0) return "No projects.";
        return projects
          .map((p) => `- [${p.id}] ${p.name}${p.is_inbox_project ? " (Inbox)" : ""}`)
          .join("\n");
      }

      case "create_project": {
        const nameArg = args.name as string | undefined;
        if (!nameArg) return "Error: name is required.";
        const project = await client.createProject({
          name: nameArg,
          parent_id: args.parent_id as string | undefined,
          color: args.color as string | undefined,
        });
        return `Created project [${project.id}] "${project.name}".`;
      }

      case "list_labels": {
        const labels = await client.listLabels();
        if (labels.length === 0) return "No labels.";
        return labels.map((l) => `- ${l.name}`).join("\n");
      }

      case "create_label": {
        const nameArg = args.name as string | undefined;
        if (!nameArg) return "Error: name is required.";
        const label = await client.createLabel({
          name: nameArg,
          color: args.color as string | undefined,
        });
        return `Created label "${label.name}".`;
      }

      default:
        return `Unknown Todoist tool: ${name}`;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Tool error (${name}): ${message}`;
  }
}
