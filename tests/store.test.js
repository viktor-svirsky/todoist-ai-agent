import { jest } from '@jest/globals';

// Mock fs/promises before importing store
const mockData = {};
jest.unstable_mockModule('fs/promises', () => ({
  readFile: jest.fn(async () => JSON.stringify(mockData)),
  writeFile: jest.fn(async () => {}),
  mkdir: jest.fn(async () => {}),
}));

const { loadConversation, saveConversation, addMessage, cleanupTask } =
  await import('../store.js');

describe('store', () => {
  test('loadConversation returns empty messages for unknown task', async () => {
    const conv = await loadConversation('task_999');
    expect(conv.messages).toEqual([]);
  });

  test('addMessage adds to messages array', async () => {
    const conv = { title: 'Test', messages: [] };
    const updated = addMessage(conv, 'user', 'hello');
    expect(updated.messages).toHaveLength(1);
    expect(updated.messages[0]).toEqual({ role: 'user', content: 'hello' });
  });

  test('addMessage prunes to 20 messages, keeping first', async () => {
    let conv = { title: 'Test', messages: [] };
    // Add 25 messages alternating user/assistant
    for (let i = 0; i < 25; i++) {
      conv = addMessage(conv, i % 2 === 0 ? 'user' : 'assistant', `msg${i}`);
    }
    expect(conv.messages).toHaveLength(20);
    // First message must be preserved
    expect(conv.messages[0].content).toBe('msg0');
  });

  test('cleanupTask removes task from store', async () => {
    const fs = await import('fs/promises');
    mockData['task_123'] = { title: 'x', messages: [] };
    await cleanupTask('task_123');
    expect(fs.writeFile).toHaveBeenCalled();
  });
});
