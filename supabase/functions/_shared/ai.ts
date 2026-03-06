import { braveSearch } from "./search.ts";
import { MAX_TOOL_ROUNDS, DEFAULT_MAX_TOKENS } from "./constants.ts";
import * as Sentry from "npm:@sentry/deno"; // startSpan is a no-op when Sentry is not initialized (no DSN set)

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ImageAttachment {
  data: string;
  mediaType: string;
}

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  braveApiKey?: string;
}

const SYSTEM_PROMPT = [
  "You are an AI assistant embedded in Todoist.",
  "You help solve tasks by reasoning and providing clear, actionable answers.",
  "You can search the web when you need current information.",
  "Respond concisely — your reply will be posted as a Todoist comment.",
].join("\n");

const OPENAI_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description: "Search the web for current information.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
          count: { type: "number", description: "Number of results (1-10, default 5)" },
        },
        required: ["query"],
      },
    },
  },
];

const ANTHROPIC_TOOLS = [
  {
    name: "web_search",
    description: "Search the web for current information.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        count: { type: "number", description: "Number of results (1-10, default 5)" },
      },
      required: ["query"],
    },
  },
];

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

export function isAnthropicUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "api.anthropic.com" || host.endsWith(".anthropic.com");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// buildMessages (unchanged — produces OpenAI-style messages with system role)
// ---------------------------------------------------------------------------

export function buildMessages(
  taskContent: string,
  taskDescription: string | undefined,
  messages: Message[],
  images?: ImageAttachment[],
  customPrompt?: string | null
): any[] {
  const taskContext = [
    `Current task: "${taskContent}"`,
    taskDescription ? `Task description: "${taskDescription}"` : "",
  ].filter(Boolean).join("\n");

  const systemParts = [SYSTEM_PROMPT];
  if (customPrompt) {
    systemParts.push(`User's custom instructions:\n${customPrompt}`);
  }
  systemParts.push(taskContext);

  const result: any[] = [
    { role: "system", content: systemParts.join("\n\n") },
  ];

  for (const msg of messages) {
    result.push({ role: msg.role, content: msg.content });
  }

  if (images && images.length > 0) {
    let lastUserIdx = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx !== -1) {
      const textContent = typeof result[lastUserIdx].content === "string"
        ? result[lastUserIdx].content
        : "";
      result[lastUserIdx] = {
        role: "user",
        content: [
          { type: "text", text: textContent },
          ...images.map((img) => ({
            type: "image_url",
            image_url: { url: `data:${img.mediaType};base64,${img.data}` },
          })),
        ],
      };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// OpenAI provider
// ---------------------------------------------------------------------------

function openaiHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

function openaiBody(model: string, messages: any[], maxTokens: number, useTools: boolean): any {
  const body: any = { model, messages, max_tokens: maxTokens };
  if (useTools) body.tools = OPENAI_TOOLS;
  return body;
}

function openaiExtractContent(data: any): string | null {
  const choice = data.choices?.[0];
  if (!choice) return null;
  if (choice.message.tool_calls && choice.message.tool_calls.length > 0) return undefined as any; // signal: has tool calls
  return choice.message.content?.trim() || null;
}

function openaiExtractToolCalls(data: any): Array<{ id: string; name: string; arguments: string }> {
  const calls = data.choices?.[0]?.message?.tool_calls || [];
  return calls
    .filter((tc: any) => tc.type === "function")
    .map((tc: any) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments }));
}

function openaiAssistantMessage(data: any): any {
  return data.choices[0].message;
}

function openaiToolResultMessage(toolCallId: string, content: string): any {
  return { role: "tool", tool_call_id: toolCallId, content };
}

// ---------------------------------------------------------------------------
// Anthropic provider
// ---------------------------------------------------------------------------

const ANTHROPIC_API_VERSION = "2023-06-01";

function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_API_VERSION,
  };
}

function toAnthropicMessages(messages: any[]): { system: string; messages: any[] } {
  let system = "";
  const converted: any[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system += (system ? "\n\n" : "") + msg.content;
      continue;
    }
    if (msg.role === "user") {
      if (Array.isArray(msg.content)) {
        // Multimodal content — convert image_url to Anthropic image format
        const parts = msg.content.map((part: any) => {
          if (part.type === "image_url") {
            const url: string = part.image_url.url;
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              return {
                type: "image",
                source: { type: "base64", media_type: match[1], data: match[2] },
              };
            }
          }
          return part;
        });
        converted.push({ role: "user", content: parts });
      } else {
        converted.push({ role: "user", content: msg.content });
      }
      continue;
    }
    if (msg.role === "tool") {
      converted.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: msg.tool_call_id, content: msg.content }],
      });
      continue;
    }
    // assistant messages — pass through (may contain tool_use blocks)
    converted.push(msg);
  }

  return { system, messages: converted };
}

function anthropicBody(model: string, messages: any[], maxTokens: number, useTools: boolean): any {
  const { system, messages: converted } = toAnthropicMessages(messages);
  const body: any = { model, messages: converted, max_tokens: maxTokens };
  if (system) body.system = system;
  if (useTools) body.tools = ANTHROPIC_TOOLS;
  return body;
}

function anthropicExtractContent(data: any): string | null {
  if (!data.content || data.content.length === 0) return null;
  const hasToolUse = data.content.some((b: any) => b.type === "tool_use");
  if (hasToolUse) return undefined as any; // signal: has tool calls
  const textBlocks = data.content.filter((b: any) => b.type === "text");
  return textBlocks.map((b: any) => b.text).join("\n").trim() || null;
}

function anthropicExtractToolCalls(data: any): Array<{ id: string; name: string; arguments: string }> {
  return (data.content || [])
    .filter((b: any) => b.type === "tool_use")
    .map((b: any) => ({ id: b.id, name: b.name, arguments: JSON.stringify(b.input) }));
}

function anthropicAssistantMessage(data: any): any {
  return { role: "assistant", content: data.content };
}

function anthropicToolResultMessage(toolCallId: string, content: string): any {
  return {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: toolCallId, content }],
  };
}

// ---------------------------------------------------------------------------
// Unified executePrompt
// ---------------------------------------------------------------------------

export async function executePrompt(
  messages: any[],
  config: AiConfig
): Promise<string> {
  const anthropic = isAnthropicUrl(config.baseUrl);
  const useTools = !!config.braveApiKey;
  const runMessages = [...messages];

  const headers = anthropic ? anthropicHeaders(config.apiKey) : openaiHeaders(config.apiKey);
  const endpoint = anthropic
    ? `${config.baseUrl}/messages`
    : `${config.baseUrl}/chat/completions`;
  const buildBody = anthropic ? anthropicBody : openaiBody;
  const extractContent = anthropic ? anthropicExtractContent : openaiExtractContent;
  const extractToolCalls = anthropic ? anthropicExtractToolCalls : openaiExtractToolCalls;
  const assistantMsg = anthropic ? anthropicAssistantMessage : openaiAssistantMessage;
  const toolResultMsg = anthropic ? anthropicToolResultMessage : openaiToolResultMessage;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const body = buildBody(config.model, runMessages, DEFAULT_MAX_TOKENS, useTools);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const res = await Sentry.startSpan(
        {
          name: "ai.chat_completion",
          op: "ai.chat",
          attributes: { "ai.model": config.model, "ai.round": round },
        },
        () =>
          fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          })
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`AI API error ${res.status}: ${text}`);
      }

      const data = await res.json();
      const content = extractContent(data);
      if (content !== undefined) {
        return content || "(no response)";
      }

      // Has tool calls — process them
      runMessages.push(assistantMsg(data));

      const toolCalls = extractToolCalls(data);
      if (anthropic) {
        // Anthropic requires all tool results in a single user message
        const toolResults: any[] = [];
        for (const tc of toolCalls) {
          const result = await handleToolCall(tc.name, tc.arguments, config.braveApiKey!);
          toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: result });
        }
        runMessages.push({ role: "user", content: toolResults });
      } else {
        for (const tc of toolCalls) {
          const result = await handleToolCall(tc.name, tc.arguments, config.braveApiKey!);
          runMessages.push(toolResultMsg(tc.id, result));
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  // Exhausted tool rounds — get final response without tools
  const finalBody = buildBody(config.model, runMessages, DEFAULT_MAX_TOKENS, false);
  const finalController = new AbortController();
  const finalTimeout = setTimeout(() => finalController.abort(), config.timeoutMs);

  try {
    const res = await Sentry.startSpan(
      { name: "ai.chat_completion", op: "ai.chat", attributes: { "ai.model": config.model, "ai.round": "final" } },
      () =>
        fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(finalBody),
          signal: finalController.signal,
        })
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const content = anthropic ? anthropicExtractContent(data) : openaiExtractContent(data);
    return content || "(no response)";
  } finally {
    clearTimeout(finalTimeout);
  }
}

async function handleToolCall(
  name: string,
  argsJson: string,
  braveApiKey: string
): Promise<string> {
  try {
    const args = JSON.parse(argsJson);

    if (name === "web_search" || name === "proxy_web_search") {
      const results = await braveSearch(braveApiKey, args.query, args.count || 5);
      if (results.length === 0) return "No results found.";
      return results
        .map((r) => `**${r.title}**\n${r.url}\n${r.description}`)
        .join("\n\n");
    }

    return `Unknown tool: ${name}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return `Tool error: ${message}`;
  }
}
