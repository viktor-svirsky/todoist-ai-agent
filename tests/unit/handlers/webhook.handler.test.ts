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

  describe('note:added', () => {
    it('should process comment containing @ai', async () => {
      await handler.handleWebhook({
        event_name: 'note:added',
        event_data: { item_id: '123', content: '@ai what is the weather?', posted_uid: 'user-1' }
      });

      expect(processor.processComment).toHaveBeenCalledWith('123', 'what is the weather?');
    });

    it('should process comment with @ai in the middle', async () => {
      await handler.handleWebhook({
        event_name: 'note:added',
        event_data: { item_id: '123', content: 'hey @ai can you help?', posted_uid: 'user-1' }
      });

      expect(processor.processComment).toHaveBeenCalledWith('123', 'hey can you help?');
    });

    it('should be case-insensitive for @AI', async () => {
      await handler.handleWebhook({
        event_name: 'note:added',
        event_data: { item_id: '123', content: '@AI help me', posted_uid: 'user-1' }
      });

      expect(processor.processComment).toHaveBeenCalledWith('123', 'help me');
    });

    it('should ignore comment without @ai', async () => {
      await handler.handleWebhook({
        event_name: 'note:added',
        event_data: { item_id: '123', content: 'just a regular comment', posted_uid: 'user-1' }
      });

      expect(processor.processComment).not.toHaveBeenCalled();
    });

    it('should ignore bot own comments', async () => {
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

    it('should ignore error prefix comments', async () => {
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

    it('should ignore note:added with missing fields', async () => {
      await handler.handleWebhook({
        event_name: 'note:added',
        event_data: {}
      });

      expect(processor.processComment).not.toHaveBeenCalled();
    });

    it('should correctly process two consecutive @ai comments', async () => {
      const event = {
        event_name: 'note:added' as const,
        event_data: { item_id: '123', content: '@ai first question', posted_uid: 'user-1' }
      };
      await handler.handleWebhook(event);
      await handler.handleWebhook(event);
      expect(processor.processComment).toHaveBeenCalledTimes(2);
      expect(processor.processComment).toHaveBeenNthCalledWith(2, '123', 'first question');
    });
  });

  describe('item:completed', () => {
    it('should handle item:completed for any task', async () => {
      await handler.handleWebhook({
        event_name: 'item:completed',
        event_data: { id: '123' }
      });

      expect(processor.handleTaskCompletion).toHaveBeenCalledWith('123');
    });

    it('should ignore item:completed with missing id', async () => {
      await handler.handleWebhook({
        event_name: 'item:completed',
        event_data: {}
      });

      expect(processor.handleTaskCompletion).not.toHaveBeenCalled();
    });
  });

  describe('unknown events', () => {
    it('should silently ignore unknown event types', async () => {
      await handler.handleWebhook({
        event_name: 'item:added',
        event_data: { id: '123', labels: ['AI'] }
      });

      expect(processor.processNewTask).not.toHaveBeenCalled();
      expect(processor.processComment).not.toHaveBeenCalled();
    });
  });

  it('should rethrow errors after logging', async () => {
    vi.mocked(processor.handleTaskCompletion).mockRejectedValue(new Error('DB Error'));

    await expect(handler.handleWebhook({
      event_name: 'item:completed',
      event_data: { id: '123' }
    })).rejects.toThrow('DB Error');
  });
});
