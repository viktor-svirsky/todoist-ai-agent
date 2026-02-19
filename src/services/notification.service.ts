import axios from 'axios';
import type { NotificationPayload } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class NotificationService {
  constructor(private webhookUrl: string) {}

  async sendNotification(payload: NotificationPayload): Promise<void> {
    // Fire and forget - don't block on notification delivery
    axios.post(this.webhookUrl, payload, {
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' }
    })
      .then(() => {
        logger.info('Notification sent', {
          taskTitle: payload.taskTitle,
          status: payload.status
        });
      })
      .catch(error => {
        // Fail gracefully - notification is secondary to core functionality
        logger.warn('Failed to send notification', {
          error: error instanceof Error ? error.message : 'Unknown error',
          payload
        });
      });
  }
}
