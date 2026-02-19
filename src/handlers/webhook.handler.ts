import type { WebhookEvent } from '../types';
import type { TaskProcessorService } from '../services/task-processor.service';
import type { TodoistService } from '../services/todoist.service';
import type { ConversationRepository } from '../repositories/conversation.repository';
import { CONSTANTS } from '../utils/constants';
import { logger } from '../utils/logger';

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

        const task = await this.todoist.getTask(event_data.id!);
        await this.processor.processNewTask(task);

      } else if (event_name === 'item:updated') {
        const labels = event_data.labels ?? [];
        if (!labels.includes(CONSTANTS.AI_LABEL)) return;
        if (await this.conversations.exists(event_data.id!)) return;

        const task = await this.todoist.getTask(event_data.id!);
        await this.processor.processNewTask(task);

      } else if (event_name === 'note:added') {
        const taskId = event_data.item_id!;
        const content = event_data.content!;

        // Ignore bot's own comments
        if (content.startsWith(CONSTANTS.AI_INDICATOR)) return;
        if (content.startsWith(CONSTANTS.ERROR_PREFIX)) return;

        if (!await this.todoist.hasAiLabel(taskId)) return;

        await this.processor.processComment(taskId, content);

      } else if (event_name === 'item:completed') {
        const taskId = event_data.id!;
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
