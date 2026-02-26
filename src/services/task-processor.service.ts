import type { TodoistTask, TodoistComment, ImageAttachment } from '../types/index.js';
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

      const messages = this.claude.buildMessages(task, conv.messages);
      const response = await this.claude.executePrompt(messages);

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

    const progressCommentId = await this.todoist.postProgressComment(taskId);

    try {
      const task = await this.todoist.getTask(taskId);
      let conv = await this.conversations.load(taskId);

      if (conv.messages.length === 0) {
        conv = { ...conv, title: task.content, createdAt: new Date().toISOString() };
        const taskContent = `Task: ${task.content}\n${task.description || ''}`.trim();
        conv = this.conversations.addMessage(conv, 'user', taskContent);
      }

      conv = this.conversations.addMessage(conv, 'user', comment);

      const images = await this.getImageAttachments(taskId);
      const apiMessages = this.claude.buildMessages(task, conv.messages, images.length > 0 ? images : undefined);
      const response = await this.claude.executePrompt(apiMessages);

      conv = this.conversations.addMessage(conv, 'assistant', response);
      await this.conversations.save(taskId, conv);
      await this.todoist.updateComment(progressCommentId, response);

      logger.info('Comment processed successfully', { taskId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Task processing failed', { taskId, error: message });
      try {
        await this.todoist.updateComment(
          progressCommentId,
          `${CONSTANTS.ERROR_PREFIX} ${message}. Retry by adding a comment.`
        );
      } catch (e) {
        logger.error('Failed to update progress comment with error', { taskId, error: e });
      }
    }
  }

  private async getImageAttachments(taskId: string): Promise<ImageAttachment[]> {
    try {
      const comments = await this.todoist.getComments(taskId);
      const imageComments = comments.filter(
        (c: TodoistComment) => c.file_attachment && c.file_attachment.resource_type === 'image'
      );

      if (imageComments.length === 0) return [];

      const images: ImageAttachment[] = [];
      for (const comment of imageComments) {
        const att = comment.file_attachment!;
        try {
          const buffer = await this.todoist.downloadFile(att.file_url);
          images.push({
            data: Buffer.from(buffer).toString('base64'),
            mediaType: att.file_type || 'image/png',
          });
          logger.info('Downloaded image attachment', { taskId, fileName: att.file_name });
        } catch (e) {
          logger.error('Failed to download image', { taskId, fileName: att.file_name, error: e });
        }
      }

      return images;
    } catch (error) {
      logger.error('Failed to fetch comments for images', { taskId, error });
      return [];
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

  private async handleError(taskId: string, _taskTitle: string, error: unknown): Promise<void> {
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
