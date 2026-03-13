import { braveSearch } from "./search.ts";
import { MAX_TOOL_ROUNDS, DEFAULT_MAX_TOKENS, MAX_AI_RESPONSE_BYTES } from "./constants.ts";
import * as Sentry from "@sentry/deno"; // startSpan is a no-op when Sentry is not initialized (no DSN set)
import type {
  OpenAiResponse,
  AnthropicResponse,
  AnthropicContentBlock,
  ExtractedToolCall,
} from "./types.ts";

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

// Provider-specific messages accumulate in this array during the tool loop.
// The shape varies by provider (OpenAI vs Anthropic), so we use a permissive type.
type ApiMessage = Record<string, unknown>;

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
// buildMessages (produces OpenAI-style messages with system role)
// ---------------------------------------------------------------------------

export function buildMessages(
  taskContent: string,
  taskDescription: string | undefined,
  messages: Message[],
  images?: ImageAttachment[],
  customPrompt?: string | null
): ApiMessage[] {
  const taskContext = [
    `Current task: "${taskContent}"`,
    taskDescription ? `Task description: "${taskDescription}"` : "",
  ].filter(Boolean).join("\n");

  const systemParts = [SYSTEM_PROMPT];
  if (customPrompt) {
    systemParts.push(`User's custom instructions:\n${customPrompt}`);
  }
  systemParts.push(taskContext);

  const result: ApiMessage[] = [
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

function openaiBody(model: string, messages: ApiMessage[], maxTokens: number, useTools: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = { model, messages, max_tokens: maxTokens };
  if (useTools) body.tools = OPENAI_TOOLS;
  return body;
}

/** Returns text content, null for empty, or undefined to signal tool calls. */
function openaiExtractContent(data: OpenAiResponse): string | null | undefined {
  const choice = data.choices?.[0];
  if (!choice) return null;
  if (choice.message.tool_calls && choice.message.tool_calls.length > 0) return undefined;
  return choice.message.content?.trim() || null;
}

function openaiExtractToolCalls(data: OpenAiResponse): ExtractedToolCall[] {
  const calls = data.choices?.[0]?.message?.tool_calls || [];
  return calls
    .filter((tc) => tc.type === "function")
    .map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments }));
}

function openaiAssistantMessage(data: OpenAiResponse): ApiMessage {
  return data.choices[0].message as unknown as ApiMessage;
}

function openaiToolResultMessage(toolCallId: string, content: string): ApiMessage {
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

function toAnthropicMessages(messages: ApiMessage[]): { system: string; messages: ApiMessage[] } {
  let system = "";
  const converted: ApiMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system += (system ? "\n\n" : "") + (msg.content as string);
      continue;
    }
    if (msg.role === "user") {
      if (Array.isArray(msg.content)) {
        // Multimodal content — convert image_url to Anthropic image format
        const parts = (msg.content as Record<string, unknown>[]).map((part) => {
          if (part.type === "image_url") {
            const imageUrl = part.image_url as { url: string };
            const match = imageUrl.url.match(/^data:([^;]+);base64,(.+)$/);
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

function anthropicBody(model: string, messages: ApiMessage[], maxTokens: number, useTools: boolean): Record<string, unknown> {
  const { system, messages: converted } = toAnthropicMessages(messages);
  const body: Record<string, unknown> = { model, messages: converted, max_tokens: maxTokens };
  if (system) body.system = system;
  if (useTools) body.tools = ANTHROPIC_TOOLS;
  return body;
}

/** Returns text content, null for empty, or undefined to signal tool calls. */
function anthropicExtractContent(data: AnthropicResponse): string | null | undefined {
  if (!data.content || data.content.length === 0) return null;
  const hasToolUse = data.content.some((b: AnthropicContentBlock) => b.type === "tool_use");
  if (hasToolUse) return undefined;
  const textBlocks = data.content.filter((b: AnthropicContentBlock): b is { type: "text"; text: string } => b.type === "text");
  return textBlocks.map((b) => b.text).join("\n").trim() || null;
}

function anthropicExtractToolCalls(data: AnthropicResponse): ExtractedToolCall[] {
  return (data.content || [])
    .filter((b: AnthropicContentBlock): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, arguments: JSON.stringify(b.input) }));
}

function anthropicAssistantMessage(data: AnthropicResponse): ApiMessage {
  return { role: "assistant", content: data.content };
}

function anthropicToolResultMessage(toolCallId: string, content: string): ApiMessage {
  return {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: toolCallId, content }],
  };
}

// ---------------------------------------------------------------------------
// Response parsing with size limit
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
async function parseAiResponse(res: Response): Promise<any> {
  const text = await res.text();
  if (text.length > MAX_AI_RESPONSE_BYTES) {
    throw new Error(`AI response too large: ${text.length} bytes (limit ${MAX_AI_RESPONSE_BYTES})`);
  }
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Unified executePrompt
// ---------------------------------------------------------------------------

export async function executePrompt(
  messages: ApiMessage[],
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

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
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

      const data = await parseAiResponse(res);
      const content = extractContent(data);
      if (content !== undefined) {
        return content || "(no response)";
      }

      // Has tool calls — process them in parallel
      runMessages.push(assistantMsg(data));

      const toolCalls = extractToolCalls(data);
      const toolResults = await Promise.all(
        toolCalls.map(async (tc) => ({
          id: tc.id,
          result: await handleToolCall(tc.name, tc.arguments, config.braveApiKey!),
        }))
      );
      if (anthropic) {
        // Anthropic requires all tool results in a single user message
        runMessages.push({
          role: "user",
          content: toolResults.map((tr) => ({
            type: "tool_result",
            tool_use_id: tr.id,
            content: tr.result,
          })),
        });
      } else {
        for (const tr of toolResults) {
          runMessages.push(toolResultMsg(tr.id, tr.result));
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

    const data = await parseAiResponse(res);
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
    if (name !== "web_search") {
      return `Unknown tool: ${name}`;
    }

    const args = JSON.parse(argsJson);
    const query = typeof args.query === "string" ? args.query.slice(0, 500) : "";
    if (!query) return "Error: search query is required.";
    const count = typeof args.count === "number"
      ? Math.min(Math.max(Math.round(args.count), 1), 10)
      : 5;

    const results = await braveSearch(braveApiKey, query, count);
    if (results.length === 0) return "No results found.";
    return results
      .map((r) => `**${r.title}**\n${r.url}\n${r.description}`)
      .join("\n\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Tool call failed", { tool: name, error: message });
    return `Tool error: ${message}`;
  }
}
