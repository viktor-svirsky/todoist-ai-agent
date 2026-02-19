import type { TodoistTask, Conversation, Message, TodoistComment } from '../../src/types';

export function mockTask(overrides?: Partial<TodoistTask>): TodoistTask {
  return {
    id: '123',
    content: 'Test task',
    description: 'Test description',
    labels: ['AI'],
    added_at: '2026-02-19T10:00:00Z',
    is_deleted: false,
    checked: false,
    ...overrides
  };
}

export function mockConversation(overrides?: Partial<Conversation>): Conversation {
  return {
    title: 'Test task',
    messages: [],
    createdAt: '2026-02-19T10:00:00Z',
    lastActivityAt: '2026-02-19T10:00:00Z',
    ...overrides
  };
}

export function mockMessage(role: 'user' | 'assistant', content: string): Message {
  return { role, content };
}

export function mockComment(overrides?: Partial<TodoistComment>): TodoistComment {
  return {
    id: 'comment-123',
    task_id: '123',
    content: 'Test comment',
    posted_at: '2026-02-19T10:00:00Z',
    posted_uid: 'user-123',
    ...overrides
  };
}
