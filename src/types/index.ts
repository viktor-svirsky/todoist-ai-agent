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

export interface NotificationPayload {
  taskTitle: string;
  status: 'success' | 'error';
  message?: string;
  timestamp: string;
}

export interface WebhookEvent {
  event_name: 'item:added' | 'item:updated' | 'item:completed' | 'note:added';
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
  ntfyWebhookUrl: string;
  port: number;
  pollIntervalMs: number;
  claudeTimeoutMs: number;
  maxMessages: number;
  aiLabel: string;
}
