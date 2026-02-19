import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhookHandler } from '../../../src/handlers/webhook.handler';
import {
  createMockTodoistService,
  createMockConversationRepository
} from '../../helpers/mocks';
import type { TaskProcessorService } from '../../../src/services/task-processor.service';

describe('WebhookHandler', () => {
  let handler: WebhookHandler;
  let processor: TaskProcessorService;
  let todoist: ReturnType<typeof createMockTodoistService>;
  let conversations: ReturnType<typeof createMockConversationRepository>;

  beforeEach(() => {
    processor = {
      processNewTask: vi.fn(),
      processComment: vi.fn(),
      handleTaskCompletion: vi.fn()
    } as unknown as TaskProcessorService;

    todoist = createMockTodoistService();
    conversations = createMockConversationRepository();

    handler = new WebhookHandler(processor, todoist, conversations);
  });

  it('should process item:added event with AI label', async () => {
    vi.mocked(todoist.getTask).mockResolvedValue({
      id: '123',
      content: 'Test',
      labels: ['AI'],
      added_at: '2026-02-19T10:00:00Z',
      is_deleted: false,
      checked: false
    });

    await handler.handleWebhook({
      event_name: 'item:added',
      event_data: { id: '123', labels: ['AI'] }
    });

    expect(processor.processNewTask).toHaveBeenCalled();
  });

  it('should ignore item:added without AI label', async () => {
    await handler.handleWebhook({
      event_name: 'item:added',
      event_data: { id: '123', labels: ['Other'] }
    });

    expect(processor.processNewTask).not.toHaveBeenCalled();
  });

  it('should process note:added event', async () => {
    vi.mocked(todoist.hasAiLabel).mockResolvedValue(true);

    await handler.handleWebhook({
      event_name: 'note:added',
      event_data: { item_id: '123', content: 'Comment', posted_uid: 'user-1' }
    });

    expect(processor.processComment).toHaveBeenCalledWith('123', 'Comment');
  });

  it('should ignore bot comments', async () => {
    vi.mocked(todoist.hasAiLabel).mockResolvedValue(true);

    await handler.handleWebhook({
      event_name: 'note:added',
      event_data: {
        item_id: '123',
        content: '🤖 **AI Agent**\n\nResponse',
        posted_uid: 'user-1'
      }
    });

    expect(processor.processComment).not.toHaveBeenCalled();
  });

  it('should handle item:completed event', async () => {
    vi.mocked(todoist.hasAiLabel).mockResolvedValue(true);

    await handler.handleWebhook({
      event_name: 'item:completed',
      event_data: { id: '123' }
    });

    expect(processor.handleTaskCompletion).toHaveBeenCalledWith('123');
  });

  it('should process item:updated event for new tasks with AI label', async () => {
    vi.mocked(conversations.exists).mockResolvedValue(false);
    vi.mocked(todoist.getTask).mockResolvedValue({
      id: '123',
      content: 'Test',
      labels: ['AI'],
      added_at: '2026-02-19T10:00:00Z',
      is_deleted: false,
      checked: false
    });

    await handler.handleWebhook({
      event_name: 'item:updated',
      event_data: { id: '123', labels: ['AI'] }
    });

    expect(processor.processNewTask).toHaveBeenCalled();
  });

  it('should ignore item:updated if conversation exists', async () => {
    vi.mocked(conversations.exists).mockResolvedValue(true);

    await handler.handleWebhook({
      event_name: 'item:updated',
      event_data: { id: '123', labels: ['AI'] }
    });

    expect(processor.processNewTask).not.toHaveBeenCalled();
  });

  it('should rethrow errors after logging', async () => {
    vi.mocked(todoist.getTask).mockRejectedValue(new Error('API Error'));

    await expect(handler.handleWebhook({
      event_name: 'item:added',
      event_data: { id: '123', labels: ['AI'] }
    })).rejects.toThrow('API Error');
  });

  it('should ignore note:added for tasks without AI label', async () => {
    vi.mocked(todoist.hasAiLabel).mockResolvedValue(false);

    await handler.handleWebhook({
      event_name: 'note:added',
      event_data: { item_id: '123', content: 'Comment', posted_uid: 'user-1' }
    });

    expect(processor.processComment).not.toHaveBeenCalled();
  });

  it('should ignore error prefix comments', async () => {
    vi.mocked(todoist.hasAiLabel).mockResolvedValue(true);

    await handler.handleWebhook({
      event_name: 'note:added',
      event_data: {
        item_id: '123',
        content: '⚠️ AI agent error: Something went wrong',
        posted_uid: 'user-1'
      }
    });

    expect(processor.processComment).not.toHaveBeenCalled();
  });
});
