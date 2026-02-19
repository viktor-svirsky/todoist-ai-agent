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
    limit: '100kb', // Todoist webhooks are typically small
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
    const signature = req.headers['x-todoist-hmac-sha256'];

    // Type narrowing and validation
    if (typeof signature !== 'string') {
      logger.warn('Invalid or missing webhook signature header');
      return res.status(403).json({ error: 'Missing signature' });
    }

    if (!req.rawBody) {
      logger.warn('Missing webhook body');
      return res.status(403).json({ error: 'Missing body' });
    }

    // Verify HMAC signature
    const expected = crypto
      .createHmac('sha256', webhookSecret)
      .update(req.rawBody)
      .digest('base64');

    const expectedBuf = Buffer.from(expected);
    const signatureBuf = Buffer.from(signature);

    // Check length first to avoid timing attack via exception
    if (expectedBuf.length !== signatureBuf.length) {
      logger.warn('Invalid webhook signature length');
      return res.status(403).json({ error: 'Invalid signature' });
    }

    if (!crypto.timingSafeEqual(expectedBuf, signatureBuf)) {
      logger.warn('Invalid webhook signature');
      return res.status(403).json({ error: 'Invalid signature' });
    }

    // Respond immediately
    res.status(200).json({ ok: true });

    // Process asynchronously
    const event: WebhookEvent = req.body;
    setImmediate(() => {
      handler.handleWebhook(event).catch((error) => {
        logger.error('Webhook processing failed', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          event_name: event.event_name
        });
      });
    });
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return app;
}
