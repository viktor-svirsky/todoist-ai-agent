import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { TodoistTask, Message, ImageAttachment } from '../types/index.js';
import type { SearchService } from './search.service.js';
import { logger } from '../utils/logger.js';

const SYSTEM_PROMPT = [
  'You are an AI assistant embedded in Viktor\'s Todoist.',
  'You help solve tasks by reasoning and providing clear, actionable answers.',
  'You can search the web when you need current information.',
  'Respond concisely — your reply will be posted as a Todoist comment.',
].join('\n');

const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information. Use when you need facts, documentation, news, or anything not in your training data.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          count: { type: 'number', description: 'Number of results (1-10, default 5)' },
        },
        required: ['query'],
      },
    },
  },
];

const MAX_TOOL_ROUNDS = 5;

export class ClaudeService {
  private client: OpenAI;

  constructor(
    private timeoutMs: number,
    private baseUrl: string,
    private apiKey: string,
    private model: string,
    private search?: SearchService
  ) {
    this.client = new OpenAI({ baseURL: baseUrl, apiKey });
  }

  buildMessages(task: TodoistTask, messages: Message[], images?: ImageAttachment[]): ChatCompletionMessageParam[] {
    const result: ChatCompletionMessageParam[] = [];

    const taskContext = [
      `Current task: "${task.content}"`,
      task.description ? `Task description: "${task.description}"` : '',
    ].filter(Boolean).join('\n');

    result.push({ role: 'system', content: `${SYSTEM_PROMPT}\n\n${taskContext}` });

    for (const msg of messages) {
      result.push({ role: msg.role, content: msg.content });
    }

    if (images && images.length > 0) {
      let lastUserIdx = -1;
      for (let i = result.length - 1; i >= 0; i--) {
        if (result[i].role === 'user') { lastUserIdx = i; break; }
      }
      if (lastUserIdx !== -1) {
        const lastMsg = result[lastUserIdx];
        const textContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
        result[lastUserIdx] = {
          role: 'user',
          content: [
            { type: 'text' as const, text: textContent },
            ...images.map(img => ({
              type: 'image_url' as const,
              image_url: { url: `data:${img.mediaType};base64,${img.data}` },
            })),
          ],
        };
      }
    }

    return result;
  }

  async executePrompt(messages: ChatCompletionMessageParam[]): Promise<string> {
    logger.info('Calling Claude API', { model: this.model, messageCount: messages.length });

    const useTools = !!this.search;
    const runMessages = [...messages];

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: runMessages,
        ...(useTools ? { tools: TOOLS } : {}),
      }, {
        timeout: this.timeoutMs,
      });

      const choice = response.choices[0];
      if (!choice) {
        logger.warn('Empty response from Claude API');
        return '(no response)';
      }

      // No tool calls — return the text content
      if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
        return choice.message.content?.trim() || '(no response)';
      }

      // Tool calls — execute them and continue the loop
      runMessages.push(choice.message);

      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type !== 'function') continue;
        const result = await this.handleToolCall(toolCall.function.name, toolCall.function.arguments);
        runMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        } as ChatCompletionMessageParam);
      }

      logger.info('Tool round completed', { round: round + 1, toolCalls: choice.message.tool_calls.length });
    }

    // Safety: if we exhaust rounds, get a final response without tools
    logger.warn('Max tool rounds reached, requesting final response');
    const finalResponse = await this.client.chat.completions.create({
      model: this.model,
      messages: runMessages,
    }, {
      timeout: this.timeoutMs,
    });

    return finalResponse.choices[0]?.message?.content?.trim() || '(no response)';
  }

  private async handleToolCall(name: string, argsJson: string): Promise<string> {
    try {
      const args = JSON.parse(argsJson);

      if ((name === 'web_search' || name === 'proxy_web_search') && this.search) {
        const results = await this.search.search(args.query, args.count || 5);
        if (results.length === 0) return 'No results found.';
        return results.map(r => `**${r.title}**\n${r.url}\n${r.description}`).join('\n\n');
      }

      return `Unknown tool: ${name}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Tool call failed', { name, error: message });
      return `Tool error: ${message}`;
    }
  }
}
