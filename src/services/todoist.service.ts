import axios from 'axios';
import type { TodoistTask } from '../types';
import { CONSTANTS } from '../utils/constants';
import { logger } from '../utils/logger';

/**
 * Service for interacting with Todoist API.
 */
export class TodoistService {
  private readonly baseUrl = CONSTANTS.TODOIST_BASE_URL;

  constructor(
    private readonly apiToken: string,
    private readonly aiLabel: string
  ) {}

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

  /**
   * Posts a comment to a Todoist task with AI indicator prefix.
   * @param taskId - The task ID to comment on
   * @param content - The comment content
   * @throws {Error} If the API request fails
   */
  async postComment(taskId: string, content: string): Promise<void> {
    logger.info('Posting comment to Todoist', { taskId });
    await axios.post(
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
  }

  /**
   * Checks if a task has the AI label.
   * Returns false if the task cannot be fetched (404, network errors, etc.).
   * @param taskId - The task ID to check
   * @returns True if task has AI label, false otherwise or on error
   */
  async hasAiLabel(taskId: string): Promise<boolean> {
    try {
      const task = await this.getTask(taskId);
      return (task.labels ?? []).includes(this.aiLabel);
    } catch (error) {
      logger.error('Failed to check AI label', { taskId, error });
      return false;
    }
  }

  /**
   * Returns authorization headers for Todoist API requests.
   */
  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`
    };
  }
}
