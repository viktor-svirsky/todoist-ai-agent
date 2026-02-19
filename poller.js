import 'dotenv/config';
import axios from 'axios';
import { runAgent } from './agent.js';
import { postComment } from './todoist.js';
import { loadConversation, saveConversation, addMessage, taskExists } from './store.js';

const POLL_INTERVAL_MS = 60_000; // 1 minute
const BASE = 'https://api.todoist.com/api/v1';
const headers = () => ({ Authorization: `Bearer ${process.env.TODOIST_API_TOKEN}` });

let lastPollTime = new Date();

async function getAiTasks() {
  try {
    const { data } = await axios.get(`${BASE}/tasks`, { headers: headers() });
    const tasks = data.results || [];
    return tasks.filter(t => t.labels && t.labels.includes('AI'));
  } catch (err) {
    console.error('[poller] Error fetching tasks:', err.message);
    return [];
  }
}

async function processNewTask(task) {
  console.log(`[poller] Processing new AI task: ${task.id} - ${task.content}`);

  let conv = await loadConversation(task.id);

  // Initialize conversation with task content
  if (conv.messages.length === 0) {
    conv = { ...conv, title: task.content, createdAt: new Date().toISOString() };
    conv = addMessage(conv, 'user', `Task: ${task.content}\n${task.description || ''}`.trim());
  }

  try {
    const response = await runAgent({ task, messages: conv.messages });
    conv = addMessage(conv, 'assistant', response);
    await saveConversation(task.id, conv);
    await postComment(task.id, response);
    console.log(`[poller] ✅ Processed task ${task.id} and posted comment`);
  } catch (err) {
    console.error(`[poller] ❌ Error processing task ${task.id}:`, err.message);
    try {
      await postComment(task.id, `⚠️ AI agent error: ${err.message}. Retry by adding a comment.`);
    } catch (e) {
      console.error('[poller] Failed to post error comment:', e.message);
    }
  }
}

async function poll() {
  console.log(`[poller] Checking for AI-labeled tasks...`);

  try {
    const aiTasks = await getAiTasks();

    if (aiTasks.length === 0) {
      console.log('[poller] No AI-labeled tasks found');
      return;
    }

    console.log(`[poller] Found ${aiTasks.length} AI-labeled task(s)`);

    // Process only new tasks (added after last poll time)
    for (const task of aiTasks) {
      const taskAdded = new Date(task.added_at);
      const isNew = taskAdded > lastPollTime;
      const alreadyProcessed = await taskExists(task.id);

      if (isNew && !alreadyProcessed) {
        await processNewTask(task);
      } else if (!isNew && !alreadyProcessed) {
        // Task exists but wasn't seen before (might have been created before poller started)
        console.log(`[poller] Skipping old task ${task.id} (added ${task.added_at})`);
        // Mark as seen to avoid processing later
        await saveConversation(task.id, { title: task.content, messages: [], createdAt: task.added_at });
      }
    }

    lastPollTime = new Date();
  } catch (err) {
    console.error('[poller] Poll error:', err.message);
  }
}

export function startPolling(intervalMs = POLL_INTERVAL_MS) {
  console.log('[poller] Starting Todoist AI task poller...');
  console.log(`[poller] Polling interval: ${intervalMs / 1000}s`);

  // Run poll immediately on start
  poll().then(() => {
    // Then poll on interval
    setInterval(poll, intervalMs);
  });
}
