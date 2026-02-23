import type { WebhookEvent } from '../types/index.js';
import type { TaskProcessorService } from '../services/task-processor.service.js';
import { CONSTANTS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

export class WebhookHandler {
  constructor(private processor: TaskProcessorService) {}

  async handleWebhook(event: WebhookEvent): Promise<void> {
    const { event_name, event_data } = event;

    try {
      if (event_name === 'note:added') {
        if (!event_data.item_id || !event_data.content) {
          logger.warn('Missing required fields in note:added event', { event_data });
          return;
        }
        const content = event_data.content;

        // Ignore bot's own comments
        if (content.startsWith(CONSTANTS.AI_INDICATOR)) return;
        if (content.startsWith(CONSTANTS.ERROR_PREFIX)) return;

        // Only trigger on @ai mention (case-insensitive)
        if (!/@ai/i.test(content)) return;

        // Strip @ai and normalise whitespace before processing
        const stripped = content.replace(/@ai/gi, '').replace(/\s+/g, ' ').trim();

        await this.processor.processComment(event_data.item_id, stripped);

      } else if (event_name === 'item:completed') {
        if (!event_data.id) {
          logger.warn('Missing id in item:completed event', { event_name });
          return;
        }
        await this.processor.handleTaskCompletion(event_data.id);
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
