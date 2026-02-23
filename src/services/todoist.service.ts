import axios from 'axios';
import type { TodoistTask, TodoistComment } from '../types/index.js';
import { CONSTANTS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

/**
 * Service for interacting with Todoist API.
 */
export class TodoistService {
  private readonly baseUrl = CONSTANTS.TODOIST_BASE_URL;

  constructor(private readonly apiToken: string) {}

  /**
   * Fetches a task by ID from Todoist API.
   * @param taskId - The task ID to fetch
   * @returns The task data
   * @throws {Error} If the API request fails (404, 401, network errors, etc.)
   */
  async getTask(taskId: string): Promise<TodoistTask> {
    logger.info('Fetching task from Todoist', { taskId });
    const response = await axios.get<TodoistTask>(
      `${this.baseUrl}/tasks/${taskId}`,
      { headers: this.headers() }
    );
    return response.data;
  }

  async getComments(taskId: string): Promise<TodoistComment[]> {
    logger.info('Fetching comments from Todoist', { taskId });
    const response = await axios.get<{ results: TodoistComment[] }>(
      `${this.baseUrl}/comments`,
      { params: { task_id: taskId }, headers: this.headers() }
    );
    return response.data.results;
  }

  async postComment(taskId: string, content: string): Promise<string> {
    logger.info('Posting comment to Todoist', { taskId });
    const response = await axios.post<{ id: string }>(
      `${this.baseUrl}/comments`,
      {
        task_id: taskId,
        content: `${CONSTANTS.AI_INDICATOR}\n\n${content}`
      },
      {
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.id;
  }

  async postProgressComment(taskId: string): Promise<string> {
    const response = await axios.post<{ id: string }>(
      `${this.baseUrl}/comments`,
      { task_id: taskId, content: CONSTANTS.PROGRESS_INDICATOR },
      { headers: { ...this.headers(), 'Content-Type': 'application/json' } }
    );
    return response.data.id;
  }

  async updateComment(commentId: string, content: string): Promise<void> {
    await axios.post(
      `${this.baseUrl}/comments/${commentId}`,
      { content: `${CONSTANTS.AI_INDICATOR}\n\n${content}` },
      { headers: { ...this.headers(), 'Content-Type': 'application/json' } }
    );
  }

  async downloadFile(url: string): Promise<Buffer> {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      maxRedirects: 5,
      headers: this.headers()
    });
    return response.data;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`
    };
  }
}
