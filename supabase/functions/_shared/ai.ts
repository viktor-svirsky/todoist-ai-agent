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

interface AiConfig {
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

const TOOLS = [
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

export function buildMessages(
  taskContent: string,
  taskDescription: string | undefined,
  messages: Message[],
  images?: ImageAttachment[]
): any[] {
  const taskContext = [
    `Current task: "${taskContent}"`,
    taskDescription ? `Task description: "${taskDescription}"` : "",
  ].filter(Boolean).join("\n");

  const result: any[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${taskContext}` },
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

export async function executePrompt(
  messages: any[],
  config: AiConfig
): Promise<string> {
  const useTools = !!config.braveApiKey;
  const runMessages = [...messages];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const body: any = { model: config.model, messages: runMessages, max_tokens: DEFAULT_MAX_TOKENS };
    if (useTools) body.tools = TOOLS;

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
          fetch(`${config.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          })
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`AI API error ${res.status}: ${text}`);
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      if (!choice) return "(no response)";

      if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
        return choice.message.content?.trim() || "(no response)";
      }

      runMessages.push(choice.message);

      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type !== "function") continue;
        const result = await handleToolCall(
          toolCall.function.name,
          toolCall.function.arguments,
          config.braveApiKey!
        );
        runMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  // Exhausted tool rounds — get final response without tools
  const res = await Sentry.startSpan(
    { name: "ai.chat_completion", op: "ai.chat", attributes: { "ai.model": config.model, "ai.round": "final" } },
    () =>
      fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ model: config.model, messages: runMessages, max_tokens: DEFAULT_MAX_TOKENS }),
      })
  );
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "(no response)";
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
