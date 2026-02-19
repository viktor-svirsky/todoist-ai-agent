import type { WebhookEvent } from '../types/index.js';
import type { TaskProcessorService } from '../services/task-processor.service.js';
import type { TodoistService } from '../services/todoist.service.js';
import type { ConversationRepository } from '../repositories/conversation.repository.js';
import { CONSTANTS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

export class WebhookHandler {
  constructor(
    private processor: TaskProcessorService,
    private todoist: TodoistService,
    private conversations: ConversationRepository
  ) {}

  async handleWebhook(event: WebhookEvent): Promise<void> {
    const { event_name, event_data } = event;

    try {
      if (event_name === 'item:added') {
        const labels = event_data.labels ?? [];
        if (!labels.includes(CONSTANTS.AI_LABEL)) return;
        if (!event_data.id) {
          logger.warn('Missing id in item:added event', { event_name });
          return;
        }

        const task = await this.todoist.getTask(event_data.id);
        await this.processor.processNewTask(task);

      } else if (event_name === 'item:updated') {
        const labels = event_data.labels ?? [];
        if (!labels.includes(CONSTANTS.AI_LABEL)) return;
        if (!event_data.id) {
          logger.warn('Missing id in item:updated event', { event_name });
          return;
        }
        if (await this.conversations.exists(event_data.id)) return;

        const task = await this.todoist.getTask(event_data.id);
        await this.processor.processNewTask(task);

      } else if (event_name === 'note:added') {
        if (!event_data.item_id || !event_data.content) {
          logger.warn('Missing required fields in note:added event', { event_data });
          return;
        }
        const taskId = event_data.item_id;
        const content = event_data.content;

        // Ignore bot's own comments
        if (content.startsWith(CONSTANTS.AI_INDICATOR)) return;
        if (content.startsWith(CONSTANTS.ERROR_PREFIX)) return;

        if (!await this.todoist.hasAiLabel(taskId)) return;

        await this.processor.processComment(taskId, content);

      } else if (event_name === 'item:completed') {
        if (!event_data.id) {
          logger.warn('Missing id in item:completed event', { event_name });
          return;
        }
        const taskId = event_data.id;
        if (!await this.todoist.hasAiLabel(taskId)) return;

        await this.processor.handleTaskCompletion(taskId);
      }
    } catch (error) {
      logger.error('Webhook handling failed', {
        event_name,
        error: error instanceof Error ? error.message : 'Unknown'
      });
      throw error;
    }
  }
}
