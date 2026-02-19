import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import type { Conversation } from '../types/index.js';

export class ConversationRepository {
  private readonly dataFile: string;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.dataFile = join(dataDir, 'conversations.json');
  }

  /**
   * Creates an empty conversation
   */
  private createEmpty(): Conversation {
    return {
      title: '',
      messages: [],
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString()
    };
  }

  /**
   * Loads all conversations from disk
   */
  private async loadAll(): Promise<Record<string, Conversation>> {
    try {
      const raw = await readFile(this.dataFile, 'utf8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  /**
   * Checks if a conversation exists for the given task ID.
   */
  async exists(taskId: string): Promise<boolean> {
    const data = await this.loadAll();
    return taskId in data;
  }

  /**
   * Saves a conversation for the given task ID.
   * Automatically updates lastActivityAt to current timestamp.
   */
  async save(taskId: string, conversation: Conversation): Promise<void> {
    // Chain this operation after the current lock
    this.writeLock = this.writeLock.then(async () => {
      const data = await this.loadAll();
      data[taskId] = {
        ...conversation,
        lastActivityAt: new Date().toISOString()
      };
      await mkdir(dirname(this.dataFile), { recursive: true });
      await writeFile(this.dataFile, JSON.stringify(data, null, 2), 'utf8');
    });

    await this.writeLock;
  }

  /**
   * Loads a conversation for the given task ID.
   * Returns an empty conversation if none exists.
   */
  async load(taskId: string): Promise<Conversation> {
    const data = await this.loadAll();
    return data[taskId] ?? this.createEmpty();
  }

  /**
   * Removes a conversation for the given task ID.
   * Does not throw if conversation doesn't exist.
   */
  async cleanup(taskId: string): Promise<void> {
    // Chain this operation after the current lock
    this.writeLock = this.writeLock.then(async () => {
      const data = await this.loadAll();
      delete data[taskId];
      await mkdir(dirname(this.dataFile), { recursive: true });
      await writeFile(this.dataFile, JSON.stringify(data, null, 2), 'utf8');
    });

    await this.writeLock;
  }

  /**
   * Adds a message to a conversation.
   * Prunes old messages when exceeding maxMessages (keeps first + last N-1).
   */
  addMessage(
    conversation: Conversation,
    role: 'user' | 'assistant',
    content: string,
    maxMessages: number = 20
  ): Conversation {
    const messages = [...conversation.messages, { role, content }];

    if (messages.length <= maxMessages) {
      return { ...conversation, messages };
    }

    // Prune: keep first message + last (maxMessages - 1) messages
    const first = messages[0];
    const rest = messages.slice(-(maxMessages - 1));
    return { ...conversation, messages: [first, ...rest] };
  }
}
