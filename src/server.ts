import express from 'express';
import crypto from 'crypto';
import { WebhookHandler } from './handlers/webhook.handler';
import { logger } from './utils/logger';
import type { WebhookRequest, WebhookEvent } from './types';

export function createServer(
  handler: WebhookHandler,
  webhookSecret: string,
  port: number
) {
  const app = express();

  // Raw body needed for HMAC verification
  app.use(express.json({
    verify: (req: WebhookRequest, _res, buf) => {
      req.rawBody = buf.toString();
    }
  }));

  // Request logging
  app.use((req, _res, next) => {
    logger.debug('Request received', { method: req.method, path: req.path });
    next();
  });

  // Webhook endpoint
  app.post('/webhook', async (req: WebhookRequest, res) => {
    const signature = req.headers['x-todoist-hmac-sha256'] as string;

    // Verify HMAC signature
    if (signature && req.rawBody) {
      const expected = crypto
        .createHmac('sha256', webhookSecret)
        .update(req.rawBody)
        .digest('base64');

      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
        logger.warn('Invalid webhook signature');
        return res.status(403).json({ error: 'Invalid signature' });
      }
    }

    // Respond immediately
    res.status(200).json({ ok: true });

    // Process asynchronously
    const event: WebhookEvent = req.body;
    setImmediate(async () => {
      try {
        await handler.handleWebhook(event);
      } catch (error) {
        logger.error('Webhook processing failed', { error });
      }
    });
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return app;
}
