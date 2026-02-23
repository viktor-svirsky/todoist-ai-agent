import { vi } from 'vitest';
import type { ClaudeService } from '../../src/services/claude.service';
import type { TodoistService } from '../../src/services/todoist.service';
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
    getComments: vi.fn().mockResolvedValue([]),
    postComment: vi.fn().mockResolvedValue('comment-id'),
    postProgressComment: vi.fn().mockResolvedValue('progress-id'),
    updateComment: vi.fn().mockResolvedValue(undefined),
    downloadFile: vi.fn()
  } as unknown as TodoistService;
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
