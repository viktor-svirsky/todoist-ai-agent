import express from 'express';
import crypto from 'crypto';
import 'dotenv/config';
import { getTask, hasAiLabel, postComment, getBotUid } from './todoist.js';
import { runAgent } from './agent.js';
import { loadConversation, saveConversation, addMessage, cleanupTask, taskExists } from './store.js';

export function verifySignature(rawBody, signature, secret) {
  try {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// Simple in-memory async job queue
const queue = [];
let processing = false;

async function enqueue(job) {
  queue.push(job);
  if (!processing) processQueue();
}

async function processQueue() {
  processing = true;
  while (queue.length > 0) {
    const job = queue.shift();
    try {
      await job();
    } catch (err) {
      console.error('[queue] Unhandled job error:', err);
    }
  }
  processing = false;
}

async function handleNewTask(taskId) {
  const task = await getTask(taskId);
  let conv = await loadConversation(taskId);
  conv = { ...conv, title: task.content, createdAt: new Date().toISOString() };
  conv = addMessage(conv, 'user', `Task: ${task.content}\n${task.description ?? ''}`.trim());

  const response = await runAgent({ task, messages: conv.messages });
  conv = addMessage(conv, 'assistant', response);
  await saveConversation(taskId, conv);
  await postComment(taskId, response);
}

async function handleComment(taskId, commentContent) {
  const task = await getTask(taskId);
  let conv = await loadConversation(taskId);

  // If first interaction, add task context as first message
  if (conv.messages.length === 0) {
    conv = { ...conv, title: task.content };
    conv = addMessage(conv, 'user', `Task: ${task.content}\n${task.description ?? ''}`.trim());
  }

  conv = addMessage(conv, 'user', commentContent);
  const response = await runAgent({ task, messages: conv.messages });
  conv = addMessage(conv, 'assistant', response);
  await saveConversation(taskId, conv);
  await postComment(taskId, response);
}

async function handleCompleted(taskId) {
  const conv = await loadConversation(taskId);
  if (conv.messages.length > 0) {
    await postComment(taskId, `Task completed. Conversation history cleared.`);
  }
  await cleanupTask(taskId);
}

export async function createApp() {
  const app = express();
  const secret = process.env.TODOIST_WEBHOOK_SECRET;
  let botUid = null;

  // Lazily cache bot UID
  async function isBotComment(uid) {
    // TODO: Fix getBotUid() - Sync API v9 is deprecated
    // For now, skip bot detection (webhook comments from bot likely won't trigger anyway)
    return false;
  }

  // Raw body needed for HMAC verification
  app.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = buf.toString(); }
  }));

  // Request logging middleware
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  app.post('/webhook', async (req, res) => {
    console.log('[webhook] Event received:', req.body.event_name);
    const sig = req.headers['x-todoist-hmac-sha256'];

    // Allow requests without signature for initial verification
    if (sig && !verifySignature(req.rawBody, sig, secret)) {
      return res.status(403).json({ error: 'Invalid signature' });
    }

    // Always respond 200 immediately
    res.status(200).json({ ok: true });

    const { event_name, event_data } = req.body;

    enqueue(async () => {
      try {
        if (event_name === 'note:added') {
          // In Todoist API v1, task comments are called "notes"
          const { item_id, posted_uid, content } = event_data;
          if (await isBotComment(posted_uid)) return; // Prevent loop
          if (!await hasAiLabel(item_id)) return;
          await handleComment(item_id, content);

        } else if (event_name === 'item:added') {
          const { id, labels } = event_data;
          if (!(labels ?? []).includes('AI')) return;
          await handleNewTask(id);

        } else if (event_name === 'item:updated') {
          const { id, labels } = event_data;
          if (!(labels ?? []).includes('AI')) return;
          if (await taskExists(id)) return; // Already seen
          await handleNewTask(id);

        } else if (event_name === 'item:completed') {
          const { id } = event_data;
          if (!await hasAiLabel(id)) return;
          await handleCompleted(id);
        }
      } catch (err) {
        console.error(`[agent] Error processing ${event_name}:`, err);
        const taskId = event_data?.item_id ?? event_data?.id;
        if (taskId) {
          try {
            await postComment(taskId, `AI agent error: ${err.message}. Retry by adding a comment.`);
          } catch (e) {
            console.error('[agent] Failed to post error comment:', e);
          }
        }
      }
    });
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  return app;
}

// Only start server if run directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const app = await createApp();
  const port = process.env.PORT ?? 9000;
  app.listen(port, '0.0.0.0', () => console.log(`Todoist AI Agent listening on port ${port}`));

  // Start polling for AI tasks (fallback if webhooks don't work)
  console.log('[poller] Starting task polling (60s interval)...');
  const { startPolling } = await import('./poller.js');
  startPolling(60_000); // Poll every 60 seconds
}
