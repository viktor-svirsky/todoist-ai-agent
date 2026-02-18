import { jest } from '@jest/globals';

jest.unstable_mockModule('axios', () => ({
  default: {
    get: jest.fn(),
    post: jest.fn(),
  }
}));

const axios = (await import('axios')).default;
const { getTask, hasAiLabel, postComment, getBotUid } = await import('../todoist.js');

describe('todoist', () => {
  beforeEach(() => jest.clearAllMocks());

  test('getTask returns task object', async () => {
    axios.get.mockResolvedValue({ data: { id: '123', content: 'Test task', description: '' } });
    const task = await getTask('123');
    expect(task.id).toBe('123');
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.todoist.com/rest/v2/tasks/123',
      expect.any(Object)
    );
  });

  test('hasAiLabel returns true when AI label present', async () => {
    axios.get.mockResolvedValue({ data: { id: '123', labels: ['AI', 'work'] } });
    const result = await hasAiLabel('123');
    expect(result).toBe(true);
  });

  test('hasAiLabel returns false when AI label absent', async () => {
    axios.get.mockResolvedValue({ data: { id: '123', labels: ['work'] } });
    const result = await hasAiLabel('123');
    expect(result).toBe(false);
  });

  test('postComment calls correct endpoint', async () => {
    axios.post.mockResolvedValue({ data: { id: 'comment_1' } });
    await postComment('task_123', 'Hello!');
    expect(axios.post).toHaveBeenCalledWith(
      'https://api.todoist.com/rest/v2/comments',
      { task_id: 'task_123', content: 'Hello!' },
      expect.any(Object)
    );
  });
});
