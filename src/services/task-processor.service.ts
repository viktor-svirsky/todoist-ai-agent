import type { TodoistTask } from '../types/index.js';
import type { ClaudeService } from './claude.service.js';
import type { TodoistService } from './todoist.service.js';
import type { ConversationRepository } from '../repositories/conversation.repository.js';
import { CONSTANTS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

export class TaskProcessorService {
  constructor(
    private claude: ClaudeService,
    private todoist: TodoistService,
    private conversations: ConversationRepository
  ) {}

  async processNewTask(task: TodoistTask): Promise<void> {
    logger.info('Processing new task', { taskId: task.id, title: task.content });

    try {
      let conv = await this.conversations.load(task.id);

      if (conv.messages.length === 0) {
        conv = { ...conv, title: task.content, createdAt: new Date().toISOString() };
        const taskContent = `Task: ${task.content}\n${task.description || ''}`.trim();
        conv = this.conversations.addMessage(conv, 'user', taskContent);
      }

      const prompt = this.claude.buildPrompt(task, conv.messages);
      const response = await this.claude.executePrompt(prompt);

      conv = this.conversations.addMessage(conv, 'assistant', response);
      await this.conversations.save(task.id, conv);
      await this.todoist.postComment(task.id, response);

      logger.info('Task processed successfully', { taskId: task.id });
    } catch (error) {
      await this.handleError(task.id, task.content, error);
    }
  }

  async processComment(taskId: string, comment: string): Promise<void> {
    logger.info('Processing comment', { taskId, commentLength: comment.length });

    try {
      const task = await this.todoist.getTask(taskId);
      let conv = await this.conversations.load(taskId);

      if (conv.messages.length === 0) {
        conv = { ...conv, title: task.content, createdAt: new Date().toISOString() };
        const taskContent = `Task: ${task.content}\n${task.description || ''}`.trim();
        conv = this.conversations.addMessage(conv, 'user', taskContent);
      }

      conv = this.conversations.addMessage(conv, 'user', comment);
      const prompt = this.claude.buildPrompt(task, conv.messages);
      const response = await this.claude.executePrompt(prompt);

      conv = this.conversations.addMessage(conv, 'assistant', response);
      await this.conversations.save(taskId, conv);
      await this.todoist.postComment(taskId, response);

      logger.info('Comment processed successfully', { taskId });
    } catch (error) {
      try {
        const task = await this.todoist.getTask(taskId);
        await this.handleError(taskId, task.content, error);
      } catch (fetchError) {
        await this.handleError(taskId, 'Unknown task', error);
        logger.error('Failed to fetch task in error handler', { taskId, error: fetchError });
      }
    }
  }

  async handleTaskCompletion(taskId: string): Promise<void> {
    logger.info('Handling task completion', { taskId });

    try {
      const conv = await this.conversations.load(taskId);
      if (conv.messages.length > 0) {
        await this.todoist.postComment(taskId, 'Task completed. Conversation history cleared.');
      }
    } catch (error) {
      logger.error('Failed to post completion comment', { taskId, error });
    }

    try {
      await this.conversations.cleanup(taskId);
    } catch (error) {
      logger.error('Failed to cleanup conversation', { taskId, error });
    }
  }

  private async handleError(taskId: string, taskTitle: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Task processing failed', { taskId, error: message });

    try {
      await this.todoist.postComment(
        taskId,
        `${CONSTANTS.ERROR_PREFIX} ${message}. Retry by adding a comment.`
      );
    } catch (e) {
      logger.error('Failed to post error comment', { taskId, error: e });
    }
  }
}
