import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIOrchestrator } from '../../../src/services/ai-orchestrator.service';
import type { ClaudeService } from '../../../src/services/claude.service';
import type { GeminiService } from '../../../src/services/gemini.service';
import type { TodoistTask, Message } from '../../../src/types/index';

describe('AIOrchestrator', () => {
  let mockClaude: ClaudeService;
  let mockGemini: GeminiService;
  let orchestrator: AIOrchestrator;

  const mockTask: TodoistTask = {
    id: '123',
    content: 'What is TypeScript?',
    description: 'Explain in simple terms',
    added_at: '2026-02-19T10:00:00Z'
  };

  const mockMessages: Message[] = [
    { role: 'user', content: 'Previous question' },
    { role: 'assistant', content: 'Previous answer' }
  ];

  beforeEach(() => {
    mockClaude = {
      buildPrompt: vi.fn().mockReturnValue('Claude prompt'),
      executePrompt: vi.fn()
        .mockResolvedValueOnce('Claude analysis: TypeScript is a typed superset of JavaScript')
        .mockResolvedValueOnce('Blended response: TypeScript adds static typing to JavaScript')
    } as any;

    mockGemini = {
      consultGemini: vi.fn().mockResolvedValue('Gemini opinion: TypeScript provides type safety')
    } as any;

    orchestrator = new AIOrchestrator(mockClaude, mockGemini);
  });

  describe('processTask', () => {
    it('should consult both Claude and Gemini, then synthesize', async () => {
      const result = await orchestrator.processTask(mockTask, mockMessages);

      // Verify Claude called first
      expect(mockClaude.buildPrompt).toHaveBeenCalledWith(mockTask, mockMessages);
      expect(mockClaude.executePrompt).toHaveBeenCalledWith('Claude prompt');

      // Verify Gemini consulted
      expect(mockGemini.consultGemini).toHaveBeenCalledWith(
        'What is TypeScript?\n\nExplain in simple terms'
      );

      // Verify synthesis
      expect(mockClaude.executePrompt).toHaveBeenCalledTimes(2);
      expect(result).toBe('Blended response: TypeScript adds static typing to JavaScript');
    });

    it('should fallback to Claude-only when Gemini fails', async () => {
      mockGemini.consultGemini = vi.fn().mockRejectedValue(new Error('Gemini timeout'));

      const result = await orchestrator.processTask(mockTask, mockMessages);

      expect(mockClaude.executePrompt).toHaveBeenCalledTimes(1); // Only initial analysis
      expect(result).toContain('Claude analysis: TypeScript is a typed superset of JavaScript');
      expect(result).toContain('_Note: Unable to consult second opinion_');
    });

    it('should handle tasks without description', async () => {
      const taskWithoutDesc: TodoistTask = {
        id: '456',
        content: 'Simple question',
        added_at: '2026-02-19T10:00:00Z'
      };

      await orchestrator.processTask(taskWithoutDesc, []);

      expect(mockGemini.consultGemini).toHaveBeenCalledWith('Simple question');
    });
  });
});
