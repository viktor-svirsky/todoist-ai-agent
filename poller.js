import 'dotenv/config';
import axios from 'axios';
import { runAgent } from './agent.js';
import { postComment, getTask } from './todoist.js';
import { loadConversation, saveConversation, addMessage, taskExists } from './store.js';

const POLL_INTERVAL_MS = 60_000; // 1 minute
const BASE = 'https://api.todoist.com/api/v1';
const headers = () => ({ Authorization: `Bearer ${process.env.TODOIST_API_TOKEN}` });

let lastPollTime = new Date();
// Track processed comment IDs to avoid reprocessing
const processedComments = new Set();

async function getAiTasks() {
  try {
    // GET /tasks only returns active (non-completed, non-deleted) tasks by default
    const { data } = await axios.get(`${BASE}/tasks`, { headers: headers() });
    const tasks = data.results || [];
    // Filter for AI-labeled tasks only
    return tasks.filter(t => t.labels && t.labels.includes('AI') && !t.is_deleted && !t.checked);
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

async function getTaskComments(taskId) {
  try {
    const { data } = await axios.get(`${BASE}/comments`, {
      headers: headers(),
      params: { task_id: taskId }
    });
    // API returns {results: [], next_cursor: null}
    return data.results || [];
  } catch (err) {
    console.error(`[poller] Error fetching comments for task ${taskId}:`, err.message);
    return [];
  }
}

async function processNewComment(task, comment) {
  console.log(`[poller] Processing new comment on task ${task.id}: "${comment.content.substring(0, 50)}..."`);

  let conv = await loadConversation(task.id);

  // If first interaction, add task context as first message
  if (conv.messages.length === 0) {
    conv = { ...conv, title: task.content, createdAt: new Date().toISOString() };
    conv = addMessage(conv, 'user', `Task: ${task.content}\n${task.description || ''}`.trim());
  }

  try {
    conv = addMessage(conv, 'user', comment.content);
    const response = await runAgent({ task, messages: conv.messages });
    conv = addMessage(conv, 'assistant', response);
    await saveConversation(task.id, conv);
    await postComment(task.id, response);
    console.log(`[poller] ✅ Processed comment on task ${task.id} and posted response`);
  } catch (err) {
    console.error(`[poller] ❌ Error processing comment on task ${task.id}:`, err.message);
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

    const currentPollTime = new Date();

    // Process each AI-labeled task
    for (const task of aiTasks) {
      const taskAdded = new Date(task.added_at);
      const isNewTask = taskAdded > lastPollTime;
      const alreadyProcessed = await taskExists(task.id);

      // Process new tasks
      if (isNewTask && !alreadyProcessed) {
        await processNewTask(task);
        continue;
      }

      // Mark old tasks as seen (to avoid processing later)
      if (!isNewTask && !alreadyProcessed) {
        console.log(`[poller] Marking old task ${task.id} as seen (added ${task.added_at})`);
        await saveConversation(task.id, { title: task.content, messages: [], createdAt: task.added_at });
        continue;
      }

      // Check for new comments on existing tasks
      const comments = await getTaskComments(task.id);
      if (comments.length === 0) continue;

      // Find unprocessed comments (not in processedComments set)
      // Also filter out bot's own comments (error messages and AI responses)
      const newComments = comments.filter(c =>
        !processedComments.has(c.id) &&
        !c.content.startsWith('⚠️ AI agent error') &&
        !c.content.startsWith('🤖 **AI Agent**')
      );

      if (newComments.length > 0) {
        console.log(`[poller] Found ${newComments.length} new comment(s) on task ${task.id}`);

        // Process comments in chronological order (oldest first)
        newComments.sort((a, b) => new Date(a.posted_at) - new Date(b.posted_at));

        for (const comment of newComments) {
          // Mark as processed BEFORE processing to avoid duplicate processing
          processedComments.add(comment.id);
          await processNewComment(task, comment);
        }
      }
    }

    lastPollTime = currentPollTime;
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
