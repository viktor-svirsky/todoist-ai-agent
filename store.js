import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

const DATA_FILE = new URL('../data/conversations.json', import.meta.url).pathname;
const MAX_MESSAGES = 20;

async function load() {
  try {
    const raw = await readFile(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function save(data) {
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

export async function loadConversation(taskId) {
  const data = await load();
  return data[taskId] ?? { title: '', messages: [], createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString() };
}

export async function saveConversation(taskId, conversation) {
  const data = await load();
  data[taskId] = { ...conversation, lastActivityAt: new Date().toISOString() };
  await save(data);
}

export function addMessage(conversation, role, content) {
  const messages = [...conversation.messages, { role, content }];
  if (messages.length <= MAX_MESSAGES) {
    return { ...conversation, messages };
  }
  // Prune: keep first message + last (MAX_MESSAGES - 1) messages
  const first = messages[0];
  const rest = messages.slice(-(MAX_MESSAGES - 1));
  return { ...conversation, messages: [first, ...rest] };
}

export async function cleanupTask(taskId) {
  const data = await load();
  delete data[taskId];
  await save(data);
}

export async function taskExists(taskId) {
  const data = await load();
  return taskId in data;
}
