import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import axios from 'axios';
import type { TodoistTask, TodoistComment } from '../types/index.js';
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

    const progressCommentId = await this.todoist.postProgressComment(taskId);
    let tempDir: string | undefined;

    try {
      const task = await this.todoist.getTask(taskId);
      let conv = await this.conversations.load(taskId);

      if (conv.messages.length === 0) {
        conv = { ...conv, title: task.content, createdAt: new Date().toISOString() };
        const taskContent = `Task: ${task.content}\n${task.description || ''}`.trim();
        conv = this.conversations.addMessage(conv, 'user', taskContent);
      }

      conv = this.conversations.addMessage(conv, 'user', comment);

      // Download image attachments from previous comments
      const imagePaths = await this.downloadImageAttachments(taskId);
      tempDir = imagePaths.length > 0 ? join(tmpdir(), `todoist-agent-${taskId}`) : undefined;

      const prompt = this.claude.buildPrompt(task, conv.messages, imagePaths.length > 0 ? imagePaths : undefined);
      const response = await this.claude.executePrompt(prompt);

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
    } finally {
      if (tempDir) {
        try {
          await rm(tempDir, { recursive: true, force: true });
          logger.info('Cleaned up temp image directory', { tempDir });
        } catch (e) {
          logger.error('Failed to cleanup temp directory', { tempDir, error: e });
        }
      }
    }
  }

  private async downloadImageAttachments(taskId: string): Promise<string[]> {
    try {
      const comments = await this.todoist.getComments(taskId);
      const imageComments = comments.filter(
        (c: TodoistComment) => c.file_attachment && c.file_attachment.resource_type === 'image'
      );

      if (imageComments.length === 0) return [];

      const tempDir = join(tmpdir(), `todoist-agent-${taskId}`);
      await mkdir(tempDir, { recursive: true });

      const paths: string[] = [];
      for (const comment of imageComments) {
        const att = comment.file_attachment!;
        const filePath = join(tempDir, att.file_name);
        try {
          const response = await axios.get(att.file_url, {
            responseType: 'arraybuffer',
            maxRedirects: 5,
            headers: { Authorization: `Bearer ${this.todoist.getApiToken()}` }
          });
          await writeFile(filePath, response.data);
          paths.push(filePath);
          logger.info('Downloaded image attachment', { taskId, fileName: att.file_name });
        } catch (e) {
          logger.error('Failed to download image', { taskId, fileName: att.file_name, error: e });
        }
      }

      return paths;
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
