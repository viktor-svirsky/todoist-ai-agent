import type { ClaudeService } from './claude.service.js';
import type { GeminiService } from './gemini.service.js';
import type { TodoistTask, Message } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class AIOrchestrator {
  constructor(
    private claude: ClaudeService,
    private gemini: GeminiService,
    private timeoutMs: number = 240000
  ) {}

  async processTask(task: TodoistTask, messages: Message[]): Promise<string> {
    logger.info('Processing task with AI orchestration', { taskId: task.id });

    // Step 1: Get Claude's initial analysis
    const claudePrompt = this.claude.buildPrompt(task, messages);
    const claudeAnalysis = await this.claude.executePrompt(claudePrompt);

    // Step 2: Consult Gemini
    let geminiOpinion: string | null = null;
    try {
      const geminiPrompt = this.buildGeminiPrompt(task);
      geminiOpinion = await this.gemini.consultGemini(geminiPrompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('Gemini consultation failed', { error: message });
    }

    // Step 3: Synthesize
    if (geminiOpinion) {
      return await this.synthesize(task.content, claudeAnalysis, geminiOpinion);
    } else {
      return claudeAnalysis + '\n\n_Note: Unable to consult second opinion_';
    }
  }

  private buildGeminiPrompt(task: TodoistTask): string {
    return [
      task.content,
      task.description ? `\n\n${task.description}` : ''
    ].join('');
  }

  private async synthesize(
    originalTask: string,
    claudeAnalysis: string,
    geminiOpinion: string
  ): Promise<string> {
    const synthesisPrompt = [
      `Task: "${originalTask}"`,
      ``,
      `Your analysis: ${claudeAnalysis}`,
      ``,
      `Another perspective: ${geminiOpinion}`,
      ``,
      `Blend these two perspectives into one cohesive response. Do not attribute which AI said what—just provide a unified answer that incorporates the best insights from both.`
    ].join('\n');

    return await this.claude.executePrompt(synthesisPrompt);
  }
}
