import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { TodoistService } from '../../../src/services/todoist.service';
import { mockTask } from '../../helpers/fixtures';

vi.mock('axios');

describe('TodoistService', () => {
  let service: TodoistService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TodoistService('test-token', 'AI');
  });

  it('should fetch task by ID', async () => {
    const task = mockTask({ id: '123', content: 'Test task' });
    vi.mocked(axios.get).mockResolvedValue({ data: task });

    const result = await service.getTask('123');

    expect(result).toEqual(task);
    expect(vi.mocked(axios.get)).toHaveBeenCalledWith(
      'https://api.todoist.com/api/v1/tasks/123',
      { headers: { Authorization: 'Bearer test-token' } }
    );
  });

  it('should post comment with AI indicator prefix', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { id: 'comment-123' } });

    await service.postComment('123', 'Test response');

    expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
      'https://api.todoist.com/api/v1/comments',
      { task_id: '123', content: '🤖 **AI Agent**\n\nTest response' },
      { headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' } }
    );
  });

  it('should return true if task has AI label', async () => {
    const task = mockTask({ labels: ['AI', 'urgent'] });
    vi.mocked(axios.get).mockResolvedValue({ data: task });

    const result = await service.hasAiLabel('123');

    expect(result).toBe(true);
  });

  it('should return false if task does not have AI label', async () => {
    const task = mockTask({ labels: ['urgent', 'work'] });
    vi.mocked(axios.get).mockResolvedValue({ data: task });

    const result = await service.hasAiLabel('123');

    expect(result).toBe(false);
  });

  it('should propagate errors from getTask', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'));

    await expect(service.getTask('123')).rejects.toThrow('Network error');
  });

  it('should propagate errors from postComment', async () => {
    vi.mocked(axios.post).mockRejectedValueOnce(new Error('API error'));

    await expect(service.postComment('123', 'Test')).rejects.toThrow('API error');
  });

  it('should return false when hasAiLabel fails to fetch task', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('Not found'));

    const result = await service.hasAiLabel('123');

    expect(result).toBe(false);
  });
});
