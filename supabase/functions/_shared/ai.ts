import { braveSearch } from "./search.ts";
import { fetchUrl } from "./fetch-url.ts";
import { MAX_TOOL_ROUNDS, DEFAULT_MAX_TOKENS, MAX_AI_RESPONSE_BYTES, FALLBACK_STATUS_CODES, MAX_TEXT_FILE_CHARS } from "./constants.ts";
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

export interface DocumentAttachment {
  data: string;
  mediaType: string;
  fileName: string;
  textContent?: string;
}

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  braveApiKey?: string;
  fallbackModel?: string;
}

// Provider-specific messages accumulate in this array during the tool loop.
// The shape varies by provider (OpenAI vs Anthropic), so we use a permissive type.
type ApiMessage = Record<string, unknown>;

const SYSTEM_PROMPT = [
  "You are an AI assistant embedded in Todoist.",
  "You help solve tasks by reasoning and providing clear, actionable answers.",
  "When you need current or specific information, always use the tools available to you — do not say tools are unavailable.",
  "Users may attach files to their comments — you can read and analyze PDFs and text-based files (.txt, .md, .csv, .json, .py, .ts, .sh, etc.).",
  "When including URLs in your response, always format them as markdown links: [descriptive text](url) — never post bare URLs.",
  "Respond concisely — your reply will be posted as a Todoist comment.",
].join("\n");

const OPENAI_SEARCH_TOOL = {
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
};

const OPENAI_FETCH_TOOL = {
  type: "function" as const,
  function: {
    name: "fetch_url",
    description: "Fetch and read the text content of a web page. Returns the extracted text (HTML is stripped). Redirects are followed safely (up to 5 hops). Only works with text-based pages (HTML, plain text).",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
      },
      required: ["url"],
    },
  },
};

const ANTHROPIC_SEARCH_TOOL = {
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
};

const ANTHROPIC_FETCH_TOOL = {
  name: "fetch_url",
  description: "Fetch and read the text content of a web page. Returns the extracted text (HTML is stripped). Redirects are followed safely (up to 5 hops). Only works with text-based pages (HTML, plain text).",
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to fetch" },
    },
    required: ["url"],
  },
};

// ---------------------------------------------------------------------------
// Link formatting for Todoist comments
// ---------------------------------------------------------------------------

/**
 * Convert bare URLs in text to markdown links [domain](url).
 * Skips URLs already inside markdown link syntax [text](url).
 * Handles URLs with balanced parentheses (e.g., Wikipedia).
 */
export function formatLinksForTodoist(text: string): string {
  // Match bare URLs. Allow parentheses in the URL body so Wikipedia-style URLs work.
  // Character class excludes whitespace, angle brackets, and square brackets only.
  return text.replace(
    /(?<!\]\()(?<!\[)(https?:\/\/[^\s\]<>]+)/g,
    (match, _url, offset) => {
      // Check if this URL is already the target of a markdown link: [text](URL)
      const before = text.slice(Math.max(0, offset - 2), offset);
      if (before.endsWith("](")) return match;

      // Strip trailing punctuation that's likely not part of the URL,
      // but preserve balanced parentheses (common in Wikipedia URLs).
      let url = match;
      let trailing = "";
      const trailingMatch = match.match(/([.,;:!?]+)$/);
      if (trailingMatch) {
        url = match.slice(0, -trailingMatch[1].length);
        trailing = trailingMatch[1];
      }
      // Strip trailing closing parens only if unbalanced in the URL
      while (url.endsWith(")")) {
        const opens = (url.match(/\(/g) || []).length;
        const closes = (url.match(/\)/g) || []).length;
        if (closes > opens) {
          trailing = ")" + trailing;
          url = url.slice(0, -1);
        } else {
          break;
        }
      }

      try {
        const hostname = new URL(url).hostname.replace(/^www\./, "");
        return `[${hostname}](${url})${trailing}`;
      } catch {
        return `[${url}](${url})${trailing}`;
      }
    },
  );
}

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
  customPrompt?: string | null,
  documents?: DocumentAttachment[],
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

  const hasAttachments = (images && images.length > 0) || (documents && documents.length > 0);
  if (hasAttachments) {
    let lastUserIdx = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx !== -1) {
      const textContent = typeof result[lastUserIdx].content === "string"
        ? result[lastUserIdx].content
        : "";
      // deno-lint-ignore no-explicit-any
      const parts: any[] = [{ type: "text", text: textContent }];
      if (images) {
        for (const img of images) {
          parts.push({
            type: "image_url",
            image_url: { url: `data:${img.mediaType};base64,${img.data}` },
          });
        }
      }
      if (documents) {
        for (const doc of documents) {
          if (doc.textContent !== undefined) {
            // Text file — inject as plain text, works with all providers
            const truncated = doc.textContent.length > MAX_TEXT_FILE_CHARS
              ? doc.textContent.slice(0, MAX_TEXT_FILE_CHARS) + "\n\n[Content truncated]"
              : doc.textContent;
            parts.push({
              type: "text",
              text: `[File: ${doc.fileName}]\n${truncated}`,
            });
          } else if (doc.data) {
            // PDF document with content — will be converted per-provider
            parts.push({
              type: "document_attachment",
              file_name: doc.fileName,
              media_type: doc.mediaType,
              data: doc.data,
            });
          } else {
            // Unsupported binary file — text placeholder for all providers
            parts.push({
              type: "text",
              text: `[Attached file: ${doc.fileName} — only PDF and text-based files are supported for AI processing]`,
            });
          }
        }
      }
      result[lastUserIdx] = { role: "user", content: parts };
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

/** Convert document_attachment parts to text placeholders for OpenAI-compatible providers. */
function sanitizeDocumentsForOpenAi(messages: ApiMessage[]): ApiMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "user" || !Array.isArray(msg.content)) return msg;
    const parts = (msg.content as Record<string, unknown>[]).map((part) => {
      if (part.type === "document_attachment") {
        return {
          type: "text",
          text: `[Attached file: ${part.file_name} — document processing requires Anthropic provider]`,
        };
      }
      return part;
    });
    return { ...msg, content: parts };
  });
}

function openaiBody(model: string, messages: ApiMessage[], maxTokens: number, tools: Record<string, unknown>[]): Record<string, unknown> {
  const body: Record<string, unknown> = { model, messages: sanitizeDocumentsForOpenAi(messages), max_tokens: maxTokens };
  if (tools.length > 0) body.tools = tools;
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
        // Multimodal content — convert image_url and document_attachment to Anthropic formats
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
          if (part.type === "document_attachment") {
            return {
              type: "document",
              source: {
                type: "base64",
                media_type: part.media_type as string,
                data: part.data as string,
              },
            };
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

function anthropicBody(model: string, messages: ApiMessage[], maxTokens: number, tools: Record<string, unknown>[]): Record<string, unknown> {
  const { system, messages: converted } = toAnthropicMessages(messages);
  const body: Record<string, unknown> = { model, messages: converted, max_tokens: maxTokens };
  if (system) body.system = system;
  if (tools.length > 0) body.tools = tools;
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
// Fallback detection
// ---------------------------------------------------------------------------

function isOverloadError(status: number): boolean {
  return FALLBACK_STATUS_CODES.includes(status);
}

// ---------------------------------------------------------------------------
// Unified executePrompt
// ---------------------------------------------------------------------------

interface FetchContext {
  endpoint: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

interface FallbackState {
  activeModel: string;
  hasFallenBack: boolean;
  fallbackModel?: string;
}

/** Single AI API call with optional fallback on overload errors. */
async function fetchWithFallback(
  ctx: FetchContext,
  body: Record<string, unknown>,
  fallback: FallbackState,
  round: number | "final",
): Promise<{ res: Response; activeModel: string; hasFallenBack: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ctx.timeoutMs);

  let res: Response;
  try {
    res = await Sentry.startSpan(
      { name: "ai.chat_completion", op: "ai.chat", attributes: { "ai.model": fallback.activeModel, "ai.round": round } },
      () =>
        fetch(ctx.endpoint, {
          method: "POST",
          headers: ctx.headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        })
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    if (!fallback.hasFallenBack && fallback.fallbackModel && isOverloadError(res.status)) {
      console.warn("AI model overloaded, falling back", {
        from: fallback.activeModel, to: fallback.fallbackModel, status: res.status, round,
      });
      const newModel = fallback.fallbackModel;
      const fallbackBody = { ...body, model: newModel };
      const fbController = new AbortController();
      const fbTimeout = setTimeout(() => fbController.abort(), ctx.timeoutMs);
      try {
        res = await Sentry.startSpan(
          { name: "ai.chat_completion", op: "ai.chat", attributes: { "ai.model": newModel, "ai.round": round, "ai.fallback": true } },
          () =>
            fetch(ctx.endpoint, {
              method: "POST",
              headers: ctx.headers,
              body: JSON.stringify(fallbackBody),
              signal: fbController.signal,
            })
        );
      } finally {
        clearTimeout(fbTimeout);
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`AI API error ${res.status}: ${text}`);
      }
      return { res, activeModel: newModel, hasFallenBack: true };
    }
    const text = await res.text();
    throw new Error(`AI API error ${res.status}: ${text}`);
  }

  return { res, activeModel: fallback.activeModel, hasFallenBack: fallback.hasFallenBack };
}

export async function executePrompt(
  messages: ApiMessage[],
  config: AiConfig
): Promise<string> {
  const anthropic = isAnthropicUrl(config.baseUrl);
  const runMessages = [...messages];

  // Build tools list: fetch_url is always available, web_search varies by provider
  const tools: Record<string, unknown>[] = [];
  if (anthropic) {
    tools.push(ANTHROPIC_FETCH_TOOL);
    if (config.braveApiKey) {
      tools.push(ANTHROPIC_SEARCH_TOOL);
    } else {
      // Anthropic built-in web search — server-side, no API key needed
      tools.push({ type: "web_search_20250305", name: "web_search" });
    }
  } else {
    tools.push(OPENAI_FETCH_TOOL);
    if (config.braveApiKey) tools.push(OPENAI_SEARCH_TOOL);
  }

  const headers = anthropic ? anthropicHeaders(config.apiKey) : openaiHeaders(config.apiKey);
  const endpoint = anthropic
    ? `${config.baseUrl}/messages`
    : `${config.baseUrl}/chat/completions`;
  const buildBody = anthropic ? anthropicBody : openaiBody;
  const extractContent = anthropic ? anthropicExtractContent : openaiExtractContent;
  const extractToolCalls = anthropic ? anthropicExtractToolCalls : openaiExtractToolCalls;
  const assistantMsg = anthropic ? anthropicAssistantMessage : openaiAssistantMessage;
  const toolResultMsg = anthropic ? anthropicToolResultMessage : openaiToolResultMessage;

  const ctx: FetchContext = { endpoint, headers, timeoutMs: config.timeoutMs };
  let activeModel = config.model;
  let hasFallenBack = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const body = buildBody(activeModel, runMessages, DEFAULT_MAX_TOKENS, tools);
    const result = await fetchWithFallback(ctx, body, { activeModel, hasFallenBack, fallbackModel: config.fallbackModel }, round);
    activeModel = result.activeModel;
    hasFallenBack = result.hasFallenBack;

    const data = await parseAiResponse(result.res);
    const content = extractContent(data);
    if (content !== undefined) {
      return content ? formatLinksForTodoist(content) : "(no response)";
    }

    // Has tool calls — process them in parallel
    runMessages.push(assistantMsg(data));

    const toolCalls = extractToolCalls(data);
    const toolResults = await Promise.all(
      toolCalls.map(async (tc) => ({
        id: tc.id,
        result: await handleToolCall(tc.name, tc.arguments, config.braveApiKey),
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
  }

  // Exhausted tool rounds — get final response without tools
  const finalBody = buildBody(activeModel, runMessages, DEFAULT_MAX_TOKENS, []);
  const finalResult = await fetchWithFallback(ctx, finalBody, { activeModel, hasFallenBack, fallbackModel: config.fallbackModel }, "final");

  const data = await parseAiResponse(finalResult.res);
  const content = anthropic ? anthropicExtractContent(data) : openaiExtractContent(data);
  return content ? formatLinksForTodoist(content) : "(no response)";
}

async function handleToolCall(
  name: string,
  argsJson: string,
  braveApiKey?: string
): Promise<string> {
  try {
    if (name === "web_search") {
      if (!braveApiKey) return "Error: web search is not configured.";
      const args = JSON.parse(argsJson);
      const query = typeof args.query === "string" ? args.query.slice(0, 500) : "";
      if (!query) return "Error: search query is required.";
      const count = typeof args.count === "number"
        ? Math.min(Math.max(Math.round(args.count), 1), 10)
        : 5;

      const results = await braveSearch(braveApiKey, query, count);
      if (results.length === 0) return "No results found.";
      return results
        .map((r) => `[${r.title}](${r.url})\n${r.description}`)
        .join("\n\n");
    }

    if (name === "fetch_url") {
      const args = JSON.parse(argsJson);
      const url = typeof args.url === "string" ? args.url.trim() : "";
      if (!url) return "Error: URL is required.";
      return await fetchUrl(url);
    }

    return `Unknown tool: ${name}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Tool call failed", { tool: name, error: message });
    return `Tool error: ${message}`;
  }
}
