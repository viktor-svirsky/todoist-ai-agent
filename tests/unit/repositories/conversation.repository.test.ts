import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { ConversationRepository } from '../../../src/repositories/conversation.repository';
import { mockConversation, mockMessage } from '../../helpers/fixtures';
import type { Conversation } from '../../../src/types';

describe('ConversationRepository', () => {
  const testDataDir = join(__dirname, '../../__temp__');
  let repository: ConversationRepository;

  beforeEach(async () => {
    await mkdir(testDataDir, { recursive: true });
    repository = new ConversationRepository(testDataDir);
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  describe('save', () => {
    it('should save a conversation to a JSON file', async () => {
      const conversation = mockConversation({
        title: 'Test Conversation',
        messages: [mockMessage('user', 'Hello')]
      });

      await repository.save('task-123', conversation);

      const loaded = await repository.load('task-123');
      expect(loaded.title).toBe(conversation.title);
      expect(loaded.messages).toEqual(conversation.messages);
      expect(loaded.createdAt).toBe(conversation.createdAt);
      // lastActivityAt should be updated by save()
      expect(loaded.lastActivityAt).toBeDefined();
    });

    it('should overwrite existing conversation', async () => {
      const conv1 = mockConversation({ title: 'First' });
      const conv2 = mockConversation({ title: 'Second' });

      await repository.save('task-123', conv1);
      await repository.save('task-123', conv2);

      const loaded = await repository.load('task-123');
      expect(loaded.title).toBe('Second');
    });

    it('should update lastActivityAt on save', async () => {
      const conversation = mockConversation({
        lastActivityAt: '2020-01-01T00:00:00.000Z'
      });

      await repository.save('task-123', conversation);

      const loaded = await repository.load('task-123');
      expect(loaded.lastActivityAt).not.toBe('2020-01-01T00:00:00.000Z');
    });

    it('should handle concurrent saves without data loss', async () => {
      // Save 3 different tasks concurrently
      await Promise.all([
        repository.save('task-1', mockConversation({ title: 'Task 1' })),
        repository.save('task-2', mockConversation({ title: 'Task 2' })),
        repository.save('task-3', mockConversation({ title: 'Task 3' }))
      ]);

      // Verify all 3 were saved
      const conv1 = await repository.load('task-1');
      const conv2 = await repository.load('task-2');
      const conv3 = await repository.load('task-3');

      expect(conv1.title).toBe('Task 1');
      expect(conv2.title).toBe('Task 2');
      expect(conv3.title).toBe('Task 3');
    });
  });

  describe('load', () => {
    it('should return empty conversation if does not exist', async () => {
      const loaded = await repository.load('nonexistent');
      expect(loaded).toBeDefined();
      expect(loaded.title).toBe('');
      expect(loaded.messages).toEqual([]);
      expect(loaded.createdAt).toBeDefined();
      expect(loaded.lastActivityAt).toBeDefined();
    });

    it('should load an existing conversation', async () => {
      const conversation = mockConversation({
        messages: [
          mockMessage('user', 'Question'),
          mockMessage('assistant', 'Answer')
        ]
      });

      await repository.save('task-456', conversation);
      const loaded = await repository.load('task-456');

      expect(loaded.messages).toHaveLength(2);
    });
  });

  describe('exists', () => {
    it('should check task existence', async () => {
      expect(await repository.exists('task-123')).toBe(false);

      await repository.save('task-123', mockConversation());
      expect(await repository.exists('task-123')).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should cleanup task', async () => {
      await repository.save('task-123', mockConversation());
      expect(await repository.exists('task-123')).toBe(true);

      await repository.cleanup('task-123');
      expect(await repository.exists('task-123')).toBe(false);
    });

    it('should not throw when cleaning up nonexistent conversation', async () => {
      await expect(repository.cleanup('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('addMessage', () => {
    it('should add message to conversation', () => {
      const conv = mockConversation();
      const updated = repository.addMessage(conv, 'user', 'Hello');

      expect(updated.messages).toHaveLength(1);
      expect(updated.messages[0].role).toBe('user');
      expect(updated.messages[0].content).toBe('Hello');
    });

    it('should prune messages when exceeding max', () => {
      const conv = mockConversation({
        messages: Array.from({ length: 20 }, (_, i) =>
          mockMessage(i % 2 === 0 ? 'user' : 'assistant', `Message ${i}`)
        )
      });

      const updated = repository.addMessage(conv, 'user', 'New message', 20);

      expect(updated.messages).toHaveLength(20);
      expect(updated.messages[0].content).toBe('Message 0'); // First preserved
      expect(updated.messages[updated.messages.length - 1].content).toBe('New message'); // Last is new
    });
  });
});
