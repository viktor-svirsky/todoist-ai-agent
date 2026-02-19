import axios from 'axios';
import type { TodoistTask, TodoistComment } from '../types/index.js';
import type { TaskProcessorService } from '../services/task-processor.service.js';
import type { TodoistService } from '../services/todoist.service.js';
import type { ConversationRepository } from '../repositories/conversation.repository.js';
import { CONSTANTS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

export class PollingHandler {
  private lastPollTime = new Date(0); // Initialize to epoch to catch all tasks on first poll
  private processedComments = new Set<string>();
  private readonly MAX_PROCESSED_COMMENTS = 10000;

  constructor(
    private processor: TaskProcessorService,
    private todoist: TodoistService,
    private conversations: ConversationRepository,
    private apiToken: string
  ) {}

  async poll(): Promise<void> {
    logger.debug('Polling for AI-labeled tasks');

    try {
      const tasks = await this.fetchAiTasks();
      const currentPollTime = new Date();

      for (const task of tasks) {
        try {
          await this.processTask(task);
        } catch (error) {
          logger.error('Failed to process task', {
            taskId: task.id,
            error: error instanceof Error ? error.message : 'Unknown'
          });
          // Continue processing other tasks
        }
      }

      this.lastPollTime = currentPollTime;
    } catch (error) {
      logger.error('Polling failed', {
        error: error instanceof Error ? error.message : 'Unknown'
      });
    }
  }

  private async fetchAiTasks(): Promise<TodoistTask[]> {
    try {
      const { data } = await axios.get<{ results: TodoistTask[] }>(
        `${CONSTANTS.TODOIST_BASE_URL}/tasks`,
        {
          headers: { Authorization: `Bearer ${this.apiToken}` },
          params: { label: CONSTANTS.AI_LABEL }
        }
      );

      const tasks = data.results || [];
      return tasks.filter(t =>
        !t.is_deleted &&
        !t.checked
      );
    } catch (error) {
      logger.error('Failed to fetch AI tasks', {
        error: error instanceof Error ? error.message : 'Unknown'
      });
      return [];
    }
  }

  private async processTask(task: TodoistTask): Promise<void> {
    const taskAdded = new Date(task.added_at);
    const isNewTask = taskAdded > this.lastPollTime;
    const alreadyProcessed = await this.conversations.exists(task.id);

    // Process new tasks
    if (isNewTask && !alreadyProcessed) {
      await this.processor.processNewTask(task);
      return;
    }

    // Mark old tasks as seen
    if (!isNewTask && !alreadyProcessed) {
      logger.debug('Marking old task as seen', { taskId: task.id });
      await this.conversations.save(task.id, {
        title: task.content,
        messages: [],
        createdAt: task.added_at,
        lastActivityAt: new Date().toISOString()
      });
      return;
    }

    // Check for new comments on existing tasks
    await this.checkForNewComments(task);
  }

  private async checkForNewComments(task: TodoistTask): Promise<void> {
    const comments = await this.fetchComments(task.id);
    const newComments = comments.filter(c =>
      !this.processedComments.has(c.id) &&
      !c.content.startsWith(CONSTANTS.AI_INDICATOR) &&
      !c.content.startsWith(CONSTANTS.ERROR_PREFIX)
    );

    if (newComments.length === 0) return;

    logger.info('Found new comments', { taskId: task.id, count: newComments.length });

    // Process chronologically
    newComments.sort((a, b) => new Date(a.posted_at).getTime() - new Date(b.posted_at).getTime());

    for (const comment of newComments) {
      this.addProcessedComment(comment.id);
      await this.processor.processComment(task.id, comment.content);
    }
  }

  private addProcessedComment(commentId: string): void {
    this.processedComments.add(commentId);

    // Simple FIFO cleanup when size exceeds limit
    if (this.processedComments.size > this.MAX_PROCESSED_COMMENTS) {
      const iterator = this.processedComments.values();
      for (let i = 0; i < 1000; i++) {
        const { value } = iterator.next();
        if (value) this.processedComments.delete(value);
      }
    }
  }

  private async fetchComments(taskId: string): Promise<TodoistComment[]> {
    try {
      const { data } = await axios.get<{ results: TodoistComment[] }>(
        `${CONSTANTS.TODOIST_BASE_URL}/comments`,
        {
          headers: { Authorization: `Bearer ${this.apiToken}` },
          params: { task_id: taskId }
        }
      );
      return data.results || [];
    } catch (error) {
      logger.error('Failed to fetch comments', { taskId, error });
      return [];
    }
  }
}
