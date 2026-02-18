import { jest } from '@jest/globals';
import crypto from 'crypto';

// Mock external modules
jest.unstable_mockModule('../todoist.js', () => ({
  getTask: jest.fn(async (id) => ({ id, content: 'Test task', description: '', labels: ['AI'] })),
  hasAiLabel: jest.fn(async () => true),
  postComment: jest.fn(async () => {}),
  getBotUid: jest.fn(async () => 'bot_uid_123'),
}));
jest.unstable_mockModule('../agent.js', () => ({
  runAgent: jest.fn(async () => 'Agent response'),
}));
jest.unstable_mockModule('../store.js', () => ({
  loadConversation: jest.fn(async () => ({ title: '', messages: [], createdAt: '', lastActivityAt: '' })),
  saveConversation: jest.fn(async () => {}),
  addMessage: jest.fn((conv, role, content) => ({ ...conv, messages: [...conv.messages, { role, content }] })),
  cleanupTask: jest.fn(async () => {}),
  taskExists: jest.fn(async () => false),
}));

process.env.TODOIST_WEBHOOK_SECRET = 'test_secret';
process.env.TODOIST_API_TOKEN = 'test_token';

const { createApp, verifySignature } = await import('../server.js');

describe('verifySignature', () => {
  test('returns true for valid HMAC-SHA256 signature', () => {
    const body = JSON.stringify({ event_name: 'note:added' });
    const sig = crypto.createHmac('sha256', 'test_secret').update(body).digest('base64');
    expect(verifySignature(body, sig, 'test_secret')).toBe(true);
  });

  test('returns false for invalid signature', () => {
    expect(verifySignature('body', 'badsig', 'test_secret')).toBe(false);
  });
});

describe('webhook routing', () => {
  let app;
  beforeAll(async () => { app = await createApp(); });

  function makeRequest(payload) {
    const body = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', 'test_secret').update(body).digest('base64');
    return { body, sig };
  }

  test('returns 403 for invalid signature', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Todoist-Hmac-SHA256', 'invalidsig')
      .send('{}');
    expect(res.status).toBe(403);
  });

  test('returns 200 for valid webhook', async () => {
    const { default: request } = await import('supertest');
    const payload = { event_name: 'note:added', event_data: { item_id: 't1', posted_uid: 'other_uid', content: 'Hello AI' } };
    const { body, sig } = makeRequest(payload);
    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Todoist-Hmac-SHA256', sig)
      .send(body);
    expect(res.status).toBe(200);
  });
});
