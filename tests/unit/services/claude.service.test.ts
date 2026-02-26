import { describe, it, expect } from 'vitest';
import { ClaudeService } from '../../../src/services/claude.service';
import { mockTask, mockMessage } from '../../helpers/fixtures';

describe('ClaudeService', () => {
  const service = new ClaudeService(120000, 'http://localhost:8317/v1', 'test-key', 'claude-sonnet-4-6');

  it('should build messages with task context', () => {
    const task = mockTask({ content: 'Test task', description: 'Description' });
    const messages = [mockMessage('user', 'Hello')];

    const result = service.buildMessages(task, messages);

    expect(result[0]).toEqual(expect.objectContaining({ role: 'system' }));
    expect(result[0].content).toContain('Test task');
    expect(result[0].content).toContain('Description');
    expect(result[1]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('should build messages without description', () => {
    const task = mockTask({ content: 'Test task', description: undefined });

    const result = service.buildMessages(task, []);

    const systemContent = result[0].content as string;
    expect(systemContent).toContain('Test task');
    expect(systemContent).not.toContain('undefined');
  });

  it('should include conversation history as separate messages', () => {
    const task = mockTask();
    const messages = [
      mockMessage('user', 'Question 1'),
      mockMessage('assistant', 'Answer 1'),
      mockMessage('user', 'Question 2')
    ];

    const result = service.buildMessages(task, messages);

    expect(result).toHaveLength(4); // system + 3 messages
    expect(result[1]).toEqual({ role: 'user', content: 'Question 1' });
    expect(result[2]).toEqual({ role: 'assistant', content: 'Answer 1' });
    expect(result[3]).toEqual({ role: 'user', content: 'Question 2' });
  });

  it('should attach images to the last user message', () => {
    const task = mockTask();
    const messages = [mockMessage('user', 'Check this image')];
    const images = [{ data: 'base64data', mediaType: 'image/png' }];

    const result = service.buildMessages(task, messages, images);

    const lastMsg = result[1];
    expect(Array.isArray(lastMsg.content)).toBe(true);
    const content = lastMsg.content as Array<{ type: string }>;
    expect(content[0]).toEqual({ type: 'text', text: 'Check this image' });
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,base64data' },
    });
  });

  it('should include web search in system prompt when search is available', () => {
    const searchService = { search: async () => [] };
    const serviceWithSearch = new ClaudeService(120000, 'http://localhost:8317/v1', 'test-key', 'claude-sonnet-4-6', searchService as never);
    const task = mockTask();
    const result = serviceWithSearch.buildMessages(task, [mockMessage('user', 'hi')]);

    expect(result[0].content).toContain('search the web');
  });
});
