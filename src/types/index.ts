export interface TodoistTask {
  id: string;
  content: string;
  description?: string;
  labels?: string[];
  added_at: string;
  is_deleted?: boolean;
  checked?: boolean;
}

export interface TodoistComment {
  id: string;
  task_id: string;
  content: string;
  posted_at: string;
  posted_uid: string;
  file_attachment?: {
    file_url: string;
    file_type: string;
    file_name: string;
    resource_type: string;
  };
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface Conversation {
  title: string;
  messages: Message[];
  createdAt: string;
  lastActivityAt: string;
}

export interface WebhookEvent {
  // Known values: 'item:completed', 'note:added', 'item:added', 'item:updated', etc.
  event_name: string;
  event_data: {
    id?: string;
    item_id?: string;
    content?: string;
    labels?: string[];
    posted_uid?: string;
  };
}

export interface Config {
  todoistApiToken: string;
  todoistWebhookSecret: string;
  port: number;
  pollIntervalMs: number;
  claudeTimeoutMs: number;
  maxMessages: number;
}

import type { Request } from 'express';

export interface WebhookRequest extends Request {
  rawBody?: string;
}
