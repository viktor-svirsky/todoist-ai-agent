import {
  TODOIST_API_URL,
  AI_INDICATOR,
  PROGRESS_INDICATOR,
  MAX_IMAGE_SIZE_BYTES,
} from "./constants.ts";
import { fetchWithRetry } from "./retry.ts";

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
