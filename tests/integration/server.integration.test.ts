import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import crypto from 'crypto';
import { createServer } from '../../src/server';
import { WebhookHandler } from '../../src/handlers/webhook.handler';
import { TaskProcessorService } from '../../src/services/task-processor.service';
import { TodoistService } from '../../src/services/todoist.service';
import { ConversationRepository } from '../../src/repositories/conversation.repository';
import {
  createMockClaudeService,
  createMockNotificationService
} from '../helpers/mocks';

describe('Server Integration', () => {
  let tempDir: string;
  let app: ReturnType<typeof createServer>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'todoist-test-'));
    const dataFile = join(tempDir, 'conversations.json');

    const conversationRepo = new ConversationRepository(dataFile);
    const claude = createMockClaudeService();
    const notifications = createMockNotificationService();
    const todoist = new TodoistService('test-token', 'AI');

    vi.mocked(claude.executePrompt).mockResolvedValue('Test response');

    const processor = new TaskProcessorService(
      claude,
      todoist,
      notifications,
      conversationRepo
    );

    const handler = new WebhookHandler(processor, todoist, conversationRepo);
    app = createServer(handler, 'test-secret', 9000);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should respond to health check', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('should accept webhook POST', async () => {
    const payload = {
      event_name: 'item:added',
      event_data: { id: '123', labels: ['AI'] }
    };
    const body = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', 'test-secret')
      .update(body)
      .digest('base64');

    const response = await request(app)
      .post('/webhook')
      .set('x-todoist-hmac-sha256', signature)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it('should reject invalid HMAC signature', async () => {
    const response = await request(app)
      .post('/webhook')
      .set('x-todoist-hmac-sha256', 'invalid-signature')
      .send({
        event_name: 'item:added',
        event_data: { id: '123' }
      });

    expect(response.status).toBe(403);
  });
});
