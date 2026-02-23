import { spawn } from 'child_process';
import type { TodoistTask, Message } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * Service for interacting with Claude CLI to process task requests.
 */
export class ClaudeService {
  constructor(private timeoutMs: number) {}

  /**
   * Builds a prompt for Claude from a Todoist task and conversation history.
   * @param task - The Todoist task to process
   * @param messages - Previous conversation messages
   * @returns Formatted prompt string
   */
  buildPrompt(task: TodoistTask, messages: Message[], imagePaths?: string[]): string {
    const history = messages.length > 0
      ? messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
      : '';

    const imageSection = imagePaths && imagePaths.length > 0
      ? `\nImage attachments from task comments — IMPORTANT: use your Read tool to view each file:\n${imagePaths.map(p => `- ${p}`).join('\n')}`
      : '';

    return [
      `You are an AI assistant embedded in Viktor's Todoist.`,
      `You help solve tasks by reasoning, browsing the web, and running shell commands on this Mac.`,
      `Current task: "${task.content}"`,
      task.description ? `Task description: "${task.description}"` : '',
      imageSection,
      '',
      history ? `Conversation so far:\n${history}` : '',
      '',
      `Respond concisely — your reply will be posted as a Todoist comment.`,
      `If you need to browse the web or run commands, use your available tools.`
    ].filter(Boolean).join('\n');
  }

  /**
   * Executes a prompt using Claude CLI.
   * @param prompt - The prompt to send to Claude
   * @returns Claude's response text
   * @throws Error if Claude fails or times out
   */
  async executePrompt(prompt: string, options?: { interactive?: boolean }): Promise<string> {
    return new Promise((resolve, reject) => {
      let proc: ReturnType<typeof spawn>;
      let timedOut = false;

      const cleanup = () => {
        clearTimeout(timer);
        if (proc) {
          proc.stdout?.removeAllListeners();
          proc.stderr?.removeAllListeners();
          proc.removeAllListeners();
        }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
        cleanup();
        reject(new Error(`claude timed out after ${this.timeoutMs / 1000}s`));
      }, this.timeoutMs);

      const args = options?.interactive
        ? ['--dangerously-skip-permissions', '--no-session-persistence', '--permission-mode', 'bypassPermissions', '--output-format', 'text', '--max-turns', '5']
        : ['--print', '--dangerously-skip-permissions', '--no-session-persistence', '--permission-mode', 'bypassPermissions'];

      proc = spawn('claude', args, {
        env: { ...process.env, HOME: process.env.HOME },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      proc.stdin?.write(prompt);
      proc.stdin?.end();

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', chunk => { stdout += chunk; });
      proc.stderr?.on('data', chunk => { stderr += chunk; });

      proc.on('close', code => {
        if (timedOut) return; // Already handled by timeout
        cleanup();
        if (code === 0) {
          resolve(stdout.trim() || '(no response)');
        } else {
          logger.error('Claude CLI failed', { code, stderr: stderr.trim() });
          reject(new Error(`claude exited with code ${code}: ${stderr.trim()}`));
        }
      });

      proc.on('error', err => {
        if (timedOut) return; // Already handled by timeout
        cleanup();
        logger.error('Failed to spawn claude', { error: err.message });
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });
    });
  }
}
