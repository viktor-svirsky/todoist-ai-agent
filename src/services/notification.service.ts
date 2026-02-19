import axios from 'axios';
import type { NotificationPayload } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class NotificationService {
  constructor(private webhookUrl: string) {}

  async sendNotification(payload: NotificationPayload): Promise<void> {
    try {
      await axios.post(this.webhookUrl, payload, {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' }
      });

      logger.info('Notification sent', {
        taskTitle: payload.taskTitle,
        status: payload.status
      });
    } catch (error) {
      // Fail gracefully - notification is secondary to core functionality
      logger.warn('Failed to send notification', {
        error: error instanceof Error ? error.message : 'Unknown error',
        payload
      });
    }
  }
}
