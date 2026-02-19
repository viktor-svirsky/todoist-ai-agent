import { describe, it, expect } from 'vitest';
import type { TodoistTask, Conversation, Message, NotificationPayload, WebhookEvent } from '../../../src/types';

describe('Types', () => {
  it('should have TodoistTask type', () => {
    const task: TodoistTask = {
      id: '123',
      content: 'Test task',
      description: 'Test description',
      labels: ['AI'],
      added_at: '2026-02-19T10:00:00Z',
      is_deleted: false,
      checked: false
    };
    expect(task.id).toBe('123');
  });

  it('should have Conversation type', () => {
    const conv: Conversation = {
      title: 'Test',
      messages: [],
      createdAt: '2026-02-19T10:00:00Z',
      lastActivityAt: '2026-02-19T10:00:00Z'
    };
    expect(conv.messages).toHaveLength(0);
  });

  it('should have NotificationPayload type', () => {
    const payload: NotificationPayload = {
      taskTitle: 'Test',
      status: 'success',
      timestamp: '2026-02-19T10:00:00Z'
    };
    expect(payload.status).toBe('success');
  });
});
