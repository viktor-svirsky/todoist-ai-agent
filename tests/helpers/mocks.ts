import { vi } from 'vitest';
import type { ClaudeService } from '../../src/services/claude.service';
import type { TodoistService } from '../../src/services/todoist.service';
import type { NotificationService } from '../../src/services/notification.service';
import type { ConversationRepository } from '../../src/repositories/conversation.repository';

export function createMockClaudeService(): ClaudeService {
  return {
    buildPrompt: vi.fn(),
    executePrompt: vi.fn()
  } as unknown as ClaudeService;
}

export function createMockTodoistService(): TodoistService {
  return {
    getTask: vi.fn(),
    postComment: vi.fn(),
    hasAiLabel: vi.fn()
  } as unknown as TodoistService;
}

export function createMockNotificationService(): NotificationService {
  return {
    sendNotification: vi.fn()
  } as unknown as NotificationService;
}

export function createMockConversationRepository(): ConversationRepository {
  return {
    load: vi.fn(),
    save: vi.fn(),
    exists: vi.fn(),
    cleanup: vi.fn(),
    addMessage: vi.fn()
  } as unknown as ConversationRepository;
}
