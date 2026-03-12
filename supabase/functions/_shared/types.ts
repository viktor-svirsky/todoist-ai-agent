// ---------------------------------------------------------------------------
// Todoist API types
// ---------------------------------------------------------------------------

export interface TodoistFileAttachment {
  resource_type: string;
  file_url: string;
  file_type: string;
}

export interface TodoistComment {
  id: string;
  content: string;
  posted_at: string;
  file_attachment?: TodoistFileAttachment;
}

export interface TodoistTask {
  id: string;
  content: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Webhook event types
// ---------------------------------------------------------------------------

export interface TodoistNoteEventData {
  id?: string;
  content: string;
  item_id: string;
  file_attachment?: TodoistFileAttachment;
}

export interface TodoistItemEventData {
  id: string;
  content: string;
  description: string;
  labels: string[];
}

export interface TodoistWebhookEvent {
  event_name: string;
  user_id: number | string;
  event_data: TodoistNoteEventData | TodoistItemEventData;
}

// ---------------------------------------------------------------------------
// User config (from users_config DB table)
// ---------------------------------------------------------------------------

export interface UserConfig {
  id: string;
  todoist_token: string;
  todoist_user_id: string;
  trigger_word: string | null;
  custom_ai_base_url: string | null;
  custom_ai_api_key: string | null;
  custom_ai_model: string | null;
  custom_brave_key: string | null;
  max_messages: number | null;
  custom_prompt: string | null;
}

// ---------------------------------------------------------------------------
// AI message types (OpenAI-compatible format)
// ---------------------------------------------------------------------------

export interface TextMessagePart {
  type: "text";
  text: string;
}

export interface ImageUrlMessagePart {
  type: "image_url";
  image_url: { url: string };
}

export type MultimodalContentPart = TextMessagePart | ImageUrlMessagePart;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | MultimodalContentPart[];
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

// ---------------------------------------------------------------------------
// OpenAI API types
// ---------------------------------------------------------------------------

export interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAiChoice {
  message: {
    content: string | null;
    role: string;
    tool_calls?: OpenAiToolCall[];
  };
}

export interface OpenAiResponse {
  choices: OpenAiChoice[];
}

// ---------------------------------------------------------------------------
// Anthropic API types
// ---------------------------------------------------------------------------

export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicImageBlock
  | AnthropicToolResultBlock;

export interface AnthropicResponse {
  content: AnthropicContentBlock[];
}

// ---------------------------------------------------------------------------
// Extracted tool call (unified across providers)
// ---------------------------------------------------------------------------

export interface ExtractedToolCall {
  id: string;
  name: string;
  arguments: string;
}
