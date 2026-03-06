import {
  TODOIST_API_URL,
  AI_INDICATOR,
  PROGRESS_INDICATOR,
  MAX_IMAGE_SIZE_BYTES,
  TODOIST_API_TIMEOUT_MS,
} from "./constants.ts";

function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = TODOIST_API_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

export class TodoistClient {
  constructor(private token: string) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  async getTask(taskId: string) {
    const res = await fetchWithTimeout(`${TODOIST_API_URL}/tasks/${taskId}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Todoist getTask failed: ${res.status}`);
    return res.json();
  }

  async getComments(taskId: string) {
    const res = await fetchWithTimeout(
      `${TODOIST_API_URL}/comments?task_id=${taskId}`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`Todoist getComments failed: ${res.status}`);
    const data = await res.json();
    return data.results || [];
  }

  async postComment(taskId: string, content: string): Promise<string> {
    const res = await fetchWithTimeout(`${TODOIST_API_URL}/comments`, {
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
    const res = await fetchWithTimeout(`${TODOIST_API_URL}/comments`, {
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
    const res = await fetchWithTimeout(
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

  private isTrustedDomain(url: string): boolean {
    try {
      const host = new URL(url).hostname;
      return host.endsWith(".todoist.com") || host.endsWith(".doist.com") || host.endsWith(".todoist.net");
    } catch {
      return false;
    }
  }

  async getTasks(filter: string): Promise<any[]> {
    const params = new URLSearchParams({ filter });
    const res = await fetchWithTimeout(
      `${TODOIST_API_URL}/tasks?${params}`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`Todoist getTasks failed: ${res.status}`);
    const data = await res.json();
    return data.results || [];
  }

  async getProjects(): Promise<any[]> {
    const res = await fetchWithTimeout(`${TODOIST_API_URL}/projects`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Todoist getProjects failed: ${res.status}`);
    const data = await res.json();
    return data.results || [];
  }

  async createTask(content: string, projectId?: string): Promise<string> {
    const body: Record<string, string> = { content };
    if (projectId) body.project_id = projectId;
    const res = await fetchWithTimeout(`${TODOIST_API_URL}/tasks`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Todoist createTask failed: ${res.status}`);
    const data = await res.json();
    return data.id;
  }

  async downloadFile(url: string): Promise<Uint8Array> {
    const headers = this.isTrustedDomain(url) ? this.headers() : {};
    const res = await fetchWithTimeout(url, { headers });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);

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
