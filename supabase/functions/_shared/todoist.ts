import { TODOIST_API_URL, AI_INDICATOR, PROGRESS_INDICATOR } from "./constants.ts";

export class TodoistClient {
  constructor(private token: string) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  async getTask(taskId: string) {
    const res = await fetch(`${TODOIST_API_URL}/tasks/${taskId}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Todoist getTask failed: ${res.status}`);
    return res.json();
  }

  async getComments(taskId: string) {
    const res = await fetch(`${TODOIST_API_URL}/comments?task_id=${taskId}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Todoist getComments failed: ${res.status}`);
    const data = await res.json();
    return data.results || [];
  }

  async postComment(taskId: string, content: string): Promise<string> {
    const res = await fetch(`${TODOIST_API_URL}/comments`, {
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
    const res = await fetch(`${TODOIST_API_URL}/comments`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId, content: PROGRESS_INDICATOR }),
    });
    if (!res.ok) throw new Error(`Todoist postProgressComment failed: ${res.status}`);
    const data = await res.json();
    return data.id;
  }

  async updateComment(commentId: string, content: string): Promise<void> {
    const res = await fetch(`${TODOIST_API_URL}/comments/${commentId}`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ content: `${AI_INDICATOR}\n\n${content}` }),
    });
    if (!res.ok) throw new Error(`Todoist updateComment failed: ${res.status}`);
  }

  async downloadFile(url: string): Promise<Uint8Array> {
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
