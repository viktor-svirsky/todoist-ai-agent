import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { PollingHandler } from '../../../src/handlers/polling.handler';
import {
  createMockTodoistService,
  createMockConversationRepository
} from '../../helpers/mocks';
import type { TaskProcessorService } from '../../../src/services/task-processor.service';
import { mockTask, mockComment } from '../../helpers/fixtures';

vi.mock('axios');

describe('PollingHandler', () => {
  let handler: PollingHandler;
  let processor: TaskProcessorService;
  let todoist: ReturnType<typeof createMockTodoistService>;
  let conversations: ReturnType<typeof createMockConversationRepository>;

  beforeEach(() => {
    processor = {
      processNewTask: vi.fn(),
      processComment: vi.fn()
    } as unknown as TaskProcessorService;

    todoist = createMockTodoistService();
    conversations = createMockConversationRepository();

    handler = new PollingHandler(processor, todoist, conversations, 'test-token');
    vi.clearAllMocks();
  });

  it('should fetch AI-labeled tasks', async () => {
    const tasks = [mockTask({ labels: ['AI'] })];
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { results: tasks } });

    await handler.poll();

    expect(axios.get).toHaveBeenCalledWith(
      'https://api.todoist.com/api/v1/tasks',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' }
      })
    );
  });

  it('should process new tasks', async () => {
    const task = mockTask({ added_at: new Date().toISOString() });
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { results: [task] } });
    vi.mocked(conversations.exists).mockResolvedValue(false);

    await handler.poll();

    expect(processor.processNewTask).toHaveBeenCalledWith(task);
  });

  it('should detect new comments on existing tasks', async () => {
    const task = mockTask({ added_at: '2026-02-19T10:00:00Z' });
    const comment = mockComment();

    vi.mocked(axios.get)
      .mockResolvedValueOnce({ data: { results: [task] } })
      .mockResolvedValueOnce({ data: { results: [comment] } });

    vi.mocked(conversations.exists).mockResolvedValue(true);

    await handler.poll();

    // Should check for comments
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.todoist.com/api/v1/comments',
      expect.objectContaining({
        params: { task_id: '123' }
      })
    );
  });

  it('should ignore bot comments', async () => {
    const task = mockTask();
    const botComment = mockComment({ content: '🤖 **AI Agent**\n\nResponse' });

    vi.mocked(axios.get)
      .mockResolvedValueOnce({ data: { results: [task] } })
      .mockResolvedValueOnce({ data: { results: [botComment] } });

    vi.mocked(conversations.exists).mockResolvedValue(true);

    await handler.poll();

    expect(processor.processComment).not.toHaveBeenCalled();
  });

  it('should track processed comment IDs', async () => {
    const task = mockTask();
    const comment = mockComment();

    vi.mocked(axios.get)
      .mockResolvedValueOnce({ data: { results: [task] } })
      .mockResolvedValueOnce({ data: { results: [comment] } });

    vi.mocked(conversations.exists).mockResolvedValue(true);

    // First poll - should process
    await handler.poll();
    expect(processor.processComment).toHaveBeenCalledTimes(1);

    // Second poll - should skip (already processed)
    vi.mocked(axios.get)
      .mockResolvedValueOnce({ data: { results: [task] } })
      .mockResolvedValueOnce({ data: { results: [comment] } });

    await handler.poll();
    expect(processor.processComment).toHaveBeenCalledTimes(1); // Still 1
  });
});
