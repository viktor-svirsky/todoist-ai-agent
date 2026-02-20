import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskProcessorService } from '../../../src/services/task-processor.service';
import {
  createMockClaudeService,
  createMockTodoistService,
  createMockConversationRepository,
  createMockAIOrchestrator
} from '../../helpers/mocks';
import { mockTask, mockConversation } from '../../helpers/fixtures';

describe('TaskProcessorService', () => {
  let processor: TaskProcessorService;
  let claude: ReturnType<typeof createMockClaudeService>;
  let todoist: ReturnType<typeof createMockTodoistService>;
  let conversations: ReturnType<typeof createMockConversationRepository>;
  let orchestrator: ReturnType<typeof createMockAIOrchestrator>;

  beforeEach(() => {
    claude = createMockClaudeService();
    todoist = createMockTodoistService();
    conversations = createMockConversationRepository();
    orchestrator = createMockAIOrchestrator();

    processor = new TaskProcessorService(
      claude,
      todoist,
      conversations,
      orchestrator
    );
  });

  it('should process new task successfully', async () => {
    const task = mockTask();
    const conv = mockConversation();
    const updatedConv = { ...conv, messages: [{ role: 'user' as const, content: 'Task' }] };

    vi.mocked(conversations.load).mockResolvedValue(conv);
    vi.mocked(conversations.addMessage).mockReturnValue(updatedConv);
    vi.mocked(orchestrator.processTask).mockResolvedValue('AI response');

    await processor.processNewTask(task);

    expect(conversations.load).toHaveBeenCalledWith('123');
    expect(orchestrator.processTask).toHaveBeenCalledWith(task, updatedConv.messages);
    expect(todoist.postComment).toHaveBeenCalledWith('123', 'AI response');
    expect(conversations.save).toHaveBeenCalled();
  });

  it('should handle errors and post error comment', async () => {
    const task = mockTask();
    const conv = mockConversation();

    vi.mocked(conversations.load).mockResolvedValue(conv);
    vi.mocked(conversations.addMessage).mockReturnValue(conv);
    vi.mocked(orchestrator.processTask).mockRejectedValue(new Error('Timeout'));

    await processor.processNewTask(task);

    expect(todoist.postComment).toHaveBeenCalledWith(
      '123',
      expect.stringContaining('⚠️ AI agent error: Timeout')
    );
  });

  it('should process comment on existing task', async () => {
    const task = mockTask();
    const conv = mockConversation({ messages: [{ role: 'user', content: 'Previous' }] });

    vi.mocked(todoist.getTask).mockResolvedValue(task);
    vi.mocked(conversations.load).mockResolvedValue(conv);
    vi.mocked(conversations.addMessage).mockReturnValue(conv);
    vi.mocked(orchestrator.processTask).mockResolvedValue('Response');

    await processor.processComment('123', 'User comment');

    expect(conversations.addMessage).toHaveBeenCalledWith(conv, 'user', 'User comment');
    expect(orchestrator.processTask).toHaveBeenCalled();
    expect(todoist.postComment).toHaveBeenCalledWith('123', 'Response');
  });

  it('should handle task completion', async () => {
    const conv = mockConversation({ messages: [{ role: 'user', content: 'Task' }] });
    vi.mocked(conversations.load).mockResolvedValue(conv);

    await processor.handleTaskCompletion('123');

    expect(todoist.postComment).toHaveBeenCalledWith(
      '123',
      expect.stringContaining('Task completed')
    );
    expect(conversations.cleanup).toHaveBeenCalledWith('123');
  });
});
