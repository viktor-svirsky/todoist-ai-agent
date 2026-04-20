import {
  TODOIST_API_URL,
  AI_INDICATOR,
  PROGRESS_INDICATOR,
  MAX_IMAGE_SIZE_BYTES,
} from "./constants.ts";
import { fetchWithRetry } from "./retry.ts";

export interface TodoistTask {
  id: string;
  content: string;
  description?: string;
  project_id?: string;
  section_id?: string | null;
  parent_id?: string | null;
  labels?: string[];
  priority?: number;
  due?: { date: string; string?: string; datetime?: string | null } | null;
  is_completed?: boolean;
  url?: string;
}

export interface TodoistTaskInput {
  content: string;
  description?: string;
  project_id?: string;
  section_id?: string;
  parent_id?: string;
  labels?: string[];
  priority?: number;
  due_string?: string;
  due_date?: string;
  due_datetime?: string;
}

export interface TodoistProject {
  id: string;
  name: string;
  color?: string;
  parent_id?: string | null;
  is_inbox_project?: boolean;
}

export interface TodoistLabel {
  id: string;
  name: string;
  color?: string;
}

export class TodoistClient {
  constructor(private token: string) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  async getTask(taskId: string) {
    const res = await fetchWithRetry(`${TODOIST_API_URL}/tasks/${taskId}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Todoist getTask failed: ${res.status}`);
    return res.json();
  }

  async getComments(taskId: string) {
    const res = await fetchWithRetry(
      `${TODOIST_API_URL}/comments?task_id=${taskId}`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`Todoist getComments failed: ${res.status}`);
    const data = await res.json();
    return data.results || [];
  }

  async postComment(taskId: string, content: string): Promise<string> {
    const res = await fetchWithRetry(`${TODOIST_API_URL}/comments`, {
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
    const res = await fetchWithRetry(`${TODOIST_API_URL}/comments`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId, content: PROGRESS_INDICATOR }),
    });
    if (!res.ok)
      throw new Error(`Todoist postProgressComment failed: ${res.status}`);
    const data = await res.json();
    return data.id;
  }

  async updateComment(commentId: string, content: string): Promise<void> {
    const res = await fetchWithRetry(
      `${TODOIST_API_URL}/comments/${commentId}`,
      {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ content: `${AI_INDICATOR}\n\n${content}` }),
      },
    );
    if (!res.ok)
      throw new Error(`Todoist updateComment failed: ${res.status}`);
  }

  // --- Task CRUD ---

  async listTasks(
    params: {
      project_id?: string;
      section_id?: string;
      label?: string;
      filter?: string;
      ids?: string[];
    } = {},
  ): Promise<TodoistTask[]> {
    const qs = new URLSearchParams();
    if (params.project_id) qs.set("project_id", params.project_id);
    if (params.section_id) qs.set("section_id", params.section_id);
    if (params.label) qs.set("label", params.label);
    if (params.filter) qs.set("filter", params.filter);
    if (params.ids?.length) qs.set("ids", params.ids.join(","));
    const url = `${TODOIST_API_URL}/tasks${qs.toString() ? `?${qs}` : ""}`;
    const res = await fetchWithRetry(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Todoist listTasks failed: ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data?.results)) return data.results;
    if (Array.isArray(data)) return data;
    return [];
  }

  async createTask(input: TodoistTaskInput): Promise<TodoistTask> {
    const res = await fetchWithRetry(`${TODOIST_API_URL}/tasks`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`Todoist createTask failed: ${res.status}`);
    return res.json();
  }

  async updateTask(
    taskId: string,
    input: Partial<TodoistTaskInput>,
  ): Promise<TodoistTask> {
    const res = await fetchWithRetry(`${TODOIST_API_URL}/tasks/${taskId}`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`Todoist updateTask failed: ${res.status}`);
    return res.json();
  }

  async completeTask(taskId: string): Promise<void> {
    const res = await fetchWithRetry(
      `${TODOIST_API_URL}/tasks/${taskId}/close`,
      { method: "POST", headers: this.headers() },
    );
    if (!res.ok) throw new Error(`Todoist completeTask failed: ${res.status}`);
  }

  async uncompleteTask(taskId: string): Promise<void> {
    const res = await fetchWithRetry(
      `${TODOIST_API_URL}/tasks/${taskId}/reopen`,
      { method: "POST", headers: this.headers() },
    );
    if (!res.ok) throw new Error(`Todoist uncompleteTask failed: ${res.status}`);
  }

  async deleteTask(taskId: string): Promise<void> {
    const res = await fetchWithRetry(`${TODOIST_API_URL}/tasks/${taskId}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Todoist deleteTask failed: ${res.status}`);
  }

  async moveTask(
    taskId: string,
    target: { project_id?: string; section_id?: string; parent_id?: string },
  ): Promise<TodoistTask> {
    return this.updateTask(taskId, target);
  }

  // --- Projects ---

  async listProjects(): Promise<TodoistProject[]> {
    const res = await fetchWithRetry(`${TODOIST_API_URL}/projects`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Todoist listProjects failed: ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data?.results)) return data.results;
    if (Array.isArray(data)) return data;
    return [];
  }

  async createProject(input: {
    name: string;
    parent_id?: string;
    color?: string;
  }): Promise<TodoistProject> {
    const res = await fetchWithRetry(`${TODOIST_API_URL}/projects`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`Todoist createProject failed: ${res.status}`);
    return res.json();
  }

  // --- Labels ---

  async listLabels(): Promise<TodoistLabel[]> {
    const res = await fetchWithRetry(`${TODOIST_API_URL}/labels`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Todoist listLabels failed: ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data?.results)) return data.results;
    if (Array.isArray(data)) return data;
    return [];
  }

  async createLabel(input: {
    name: string;
    color?: string;
  }): Promise<TodoistLabel> {
    const res = await fetchWithRetry(`${TODOIST_API_URL}/labels`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`Todoist createLabel failed: ${res.status}`);
    return res.json();
  }

  // --- Inbox helper (for auto-creating control task) ---

  async getInboxProjectId(): Promise<string> {
    const projects = await this.listProjects();
    const inbox = projects.find((p) => p.is_inbox_project);
    if (!inbox) throw new Error("Inbox project not found");
    return inbox.id;
  }

  private isTrustedDomain(url: string): boolean {
    try {
      const host = new URL(url).hostname;
      return host.endsWith(".todoist.com") || host.endsWith(".doist.com") || host.endsWith(".todoist.net");
    } catch {
      return false;
    }
  }

  async downloadFile(url: string): Promise<Uint8Array> {
    if (!this.isTrustedDomain(url)) {
      throw new Error("File URL is not from a trusted Todoist domain");
    }
    const res = await fetchWithRetry(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);

    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(
        `File exceeds maximum size of ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)} MB`,
      );
    }

    if (!res.body) {
      return new Uint8Array(await res.arrayBuffer());
    }

    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    const reader = res.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.byteLength;
      if (totalSize > MAX_IMAGE_SIZE_BYTES) {
        reader.cancel();
        throw new Error(
          `File exceeds maximum size of ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)} MB`,
        );
      }
      chunks.push(value);
    }

    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }
}
