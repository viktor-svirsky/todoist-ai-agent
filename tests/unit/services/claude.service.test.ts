import { describe, it, expect, vi } from 'vitest';
import { ClaudeService } from '../../../src/services/claude.service';
import { mockTask, mockMessage } from '../../helpers/fixtures';

describe('ClaudeService', () => {
  it('should build prompt with task context', () => {
    const service = new ClaudeService(120000);
    const task = mockTask({ content: 'Test task', description: 'Description' });
    const messages = [mockMessage('user', 'Hello')];

    const prompt = service.buildPrompt(task, messages);

    expect(prompt).toContain('Test task');
    expect(prompt).toContain('Description');
    expect(prompt).toContain('USER: Hello');
    expect(prompt).toContain('Todoist comment');
  });

  it('should build prompt without description', () => {
    const service = new ClaudeService(120000);
    const task = mockTask({ content: 'Test task', description: undefined });

    const prompt = service.buildPrompt(task, []);

    expect(prompt).toContain('Test task');
    expect(prompt).not.toContain('undefined');
  });

  it('should include conversation history in prompt', () => {
    const service = new ClaudeService(120000);
    const task = mockTask();
    const messages = [
      mockMessage('user', 'Question 1'),
      mockMessage('assistant', 'Answer 1'),
      mockMessage('user', 'Question 2')
    ];

    const prompt = service.buildPrompt(task, messages);

    expect(prompt).toContain('Question 1');
    expect(prompt).toContain('Answer 1');
    expect(prompt).toContain('Question 2');
  });
});
