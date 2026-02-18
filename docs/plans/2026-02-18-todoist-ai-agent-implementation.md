# Todoist AI Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Node.js webhook server that monitors Todoist tasks labeled "AI" and autonomously responds via comments using Claude Code CLI (already installed and authenticated) with Playwright browser, shell execution, and multi-turn conversation memory.

**Architecture:** Express server on port 9000 receives Todoist webhooks, immediately responds 200, enqueues jobs for async processing. Each job loads conversation history from disk, invokes `claude -p` as a subprocess (no API key needed — uses existing Claude Code auth), then posts the response as a Todoist comment. Playwright MCP and bash tool are already configured in Claude Code — no separate setup needed.

**Tech Stack:** Node.js 25, Express 4, axios, dotenv, jest — no Anthropic SDK or MCP SDK required

---

## Pre-flight Checklist

Before starting, confirm you have:
- `claude` CLI installed and authenticated (run `claude --version` to verify)
- `TODOIST_API_TOKEN` — from app.todoist.com/app/settings/integrations/developer
- `TODOIST_WEBHOOK_SECRET` — you'll set this in Task 7 when registering the webhook
- Port 9000 accessible at `https://9635783.xyz:9000`

---

## Task 1: Project Scaffold

**Files:**
- Create: `todoist-ai-agent/package.json`
- Create: `todoist-ai-agent/.env.example`
- Create: `todoist-ai-agent/.gitignore`
- Create: `todoist-ai-agent/data/.gitkeep`

**Step 1: Create project directory and package.json**

```bash
cd /Users/viktor_svirskyi/Documents/Claude/todoist-ai-agent
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install express axios dotenv
npm install --save-dev jest supertest
```

**Step 3: Update package.json**

Replace the `scripts` section in `package.json`:
```json
{
  "name": "todoist-ai-agent",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "test": "node --experimental-vm-modules node_modules/.bin/jest"
  },
  "jest": {
    "transform": {}
  }
}
```

**Step 4: Create `.env.example`**

```bash
# Todoist
TODOIST_API_TOKEN=...
TODOIST_WEBHOOK_SECRET=...

# Server
PORT=9000
```

**Step 5: Create `.gitignore`**

```
node_modules/
.env
data/conversations.json
```

**Step 6: Create data directory**

```bash
mkdir -p data
echo '{}' > data/conversations.json
```

**Step 7: Create `.env` from example**

```bash
cp .env.example .env
# Fill in your actual keys
```

**Step 8: Commit**

```bash
git init
git add package.json .env.example .gitignore data/.gitkeep docs/
git commit -m "feat: project scaffold for todoist-ai-agent"
```

---

## Task 2: Conversation Store (`store.js`)

**Files:**
- Create: `todoist-ai-agent/store.js`
- Create: `todoist-ai-agent/tests/store.test.js`

**Step 1: Write failing tests**

Create `tests/store.test.js`:

```javascript
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
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- tests/store.test.js
```
Expected: FAIL — `store.js` does not exist.

**Step 3: Implement `store.js`**

```javascript
import fs from 'fs/promises';
import path from 'path';

const DATA_FILE = new URL('../data/conversations.json', import.meta.url).pathname;
const MAX_MESSAGES = 20;

async function load() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function save(data) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
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
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- tests/store.test.js
```
Expected: PASS all 4 tests.

**Step 5: Commit**

```bash
git add store.js tests/store.test.js
git commit -m "feat: conversation store with pruning"
```

---

## Task 3: Todoist API Client (`todoist.js`)

**Files:**
- Create: `todoist-ai-agent/todoist.js`
- Create: `todoist-ai-agent/tests/todoist.test.js`

**Step 1: Write failing tests**

Create `tests/todoist.test.js`:

```javascript
import { jest } from '@jest/globals';

jest.unstable_mockModule('axios', () => ({
  default: {
    get: jest.fn(),
    post: jest.fn(),
  }
}));

const axios = (await import('axios')).default;
const { getTask, hasAiLabel, postComment, getBotUid } = await import('../todoist.js');

describe('todoist', () => {
  beforeEach(() => jest.clearAllMocks());

  test('getTask returns task object', async () => {
    axios.get.mockResolvedValue({ data: { id: '123', content: 'Test task', description: '' } });
    const task = await getTask('123');
    expect(task.id).toBe('123');
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.todoist.com/rest/v2/tasks/123',
      expect.any(Object)
    );
  });

  test('hasAiLabel returns true when AI label present', async () => {
    axios.get.mockResolvedValue({ data: { id: '123', labels: ['AI', 'work'] } });
    const result = await hasAiLabel('123');
    expect(result).toBe(true);
  });

  test('hasAiLabel returns false when AI label absent', async () => {
    axios.get.mockResolvedValue({ data: { id: '123', labels: ['work'] } });
    const result = await hasAiLabel('123');
    expect(result).toBe(false);
  });

  test('postComment calls correct endpoint', async () => {
    axios.post.mockResolvedValue({ data: { id: 'comment_1' } });
    await postComment('task_123', 'Hello!');
    expect(axios.post).toHaveBeenCalledWith(
      'https://api.todoist.com/rest/v2/comments',
      { task_id: 'task_123', content: 'Hello!' },
      expect.any(Object)
    );
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- tests/todoist.test.js
```
Expected: FAIL — `todoist.js` does not exist.

**Step 3: Implement `todoist.js`**

```javascript
import axios from 'axios';
import 'dotenv/config';

const BASE = 'https://api.todoist.com/rest/v2';
const headers = () => ({ Authorization: `Bearer ${process.env.TODOIST_API_TOKEN}` });

export async function getTask(taskId) {
  const { data } = await axios.get(`${BASE}/tasks/${taskId}`, { headers: headers() });
  return data;
}

export async function hasAiLabel(taskId) {
  const task = await getTask(taskId);
  return (task.labels ?? []).includes('AI');
}

export async function postComment(taskId, content) {
  await axios.post(`${BASE}/comments`, { task_id: taskId, content }, { headers: headers() });
}

export async function getBotUid() {
  const { data } = await axios.get('https://api.todoist.com/sync/v9/user', { headers: headers() });
  return String(data.id);
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- tests/todoist.test.js
```
Expected: PASS all 4 tests.

**Step 5: Commit**

```bash
git add todoist.js tests/todoist.test.js
git commit -m "feat: todoist REST API client"
```

---

## Task 4: Claude Agent via Claude Code CLI (`agent.js`)

**Files:**
- Create: `todoist-ai-agent/agent.js`

No unit tests — integration code that spawns `claude` CLI. Tested end-to-end in Task 9.

**Why no API key:** Claude Code is already installed and authenticated on this Mac. We invoke it as a subprocess with `-p` (print/non-interactive mode) and `--dangerously-skip-permissions` so tools (Playwright MCP, bash) run without interactive prompts. All MCPs already configured in Claude Code settings.

**Step 1: Verify `claude` is available**

```bash
which claude && claude --version
```
Expected: prints path and version (e.g. `1.x.x`).

**Step 2: Implement `agent.js`**

```javascript
import { spawn } from 'child_process';

const AGENT_TIMEOUT_MS = 120_000; // 2 minutes

export async function runAgent({ task, messages }) {
  // Build conversation history as readable text
  const history = messages.length > 0
    ? messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
    : '';

  const prompt = [
    `You are an AI assistant embedded in Viktor's Todoist.`,
    `You help solve tasks by reasoning, browsing the web, and running shell commands on this Mac.`,
    `Current task: "${task.content}"`,
    task.description ? `Task description: "${task.description}"` : '',
    '',
    history ? `Conversation so far:\n${history}` : '',
    '',
    `Respond concisely — your reply will be posted as a Todoist comment.`,
    `If you need to browse the web or run commands, use your available tools.`,
  ].filter(Boolean).join('\n');

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`claude timed out after ${AGENT_TIMEOUT_MS / 1000}s`));
    }, AGENT_TIMEOUT_MS);

    const proc = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
      env: { ...process.env, HOME: process.env.HOME },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', chunk => { stdout += chunk; });
    proc.stderr.on('data', chunk => { stderr += chunk; });

    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim() || '(no response)');
      } else {
        reject(new Error(`claude exited with code ${code}: ${stderr.trim()}`));
      }
    });

    proc.on('error', err => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}
```

**Step 3: Quick smoke test**

```bash
node --input-type=module <<'EOF'
import { runAgent } from './agent.js';
const result = await runAgent({
  task: { content: 'What is 2+2?', description: '' },
  messages: []
});
console.log('Agent response:', result);
EOF
```
Expected: Claude responds with "4" or similar.

**Step 4: Commit**

```bash
git add agent.js
git commit -m "feat: Claude agent using Claude Code CLI subprocess"
```

---

## Task 6: Webhook Server (`server.js`)

**Files:**
- Create: `todoist-ai-agent/server.js`
- Create: `todoist-ai-agent/tests/server.test.js`

**Step 1: Write failing tests for routing and HMAC logic**

Create `tests/server.test.js`:

```javascript
import { jest } from '@jest/globals';
import crypto from 'crypto';

// Mock external modules
jest.unstable_mockModule('../todoist.js', () => ({
  getTask: jest.fn(async (id) => ({ id, content: 'Test task', description: '', labels: ['AI'] })),
  hasAiLabel: jest.fn(async () => true),
  postComment: jest.fn(async () => {}),
  getBotUid: jest.fn(async () => 'bot_uid_123'),
}));
jest.unstable_mockModule('../agent.js', () => ({
  runAgent: jest.fn(async () => 'Agent response'),
}));
jest.unstable_mockModule('../store.js', () => ({
  loadConversation: jest.fn(async () => ({ title: '', messages: [], createdAt: '', lastActivityAt: '' })),
  saveConversation: jest.fn(async () => {}),
  addMessage: jest.fn((conv, role, content) => ({ ...conv, messages: [...conv.messages, { role, content }] })),
  cleanupTask: jest.fn(async () => {}),
  taskExists: jest.fn(async () => false),
}));

process.env.TODOIST_WEBHOOK_SECRET = 'test_secret';
process.env.TODOIST_API_TOKEN = 'test_token';

const { createApp, verifySignature } = await import('../server.js');

describe('verifySignature', () => {
  test('returns true for valid HMAC-SHA256 signature', () => {
    const body = JSON.stringify({ event_name: 'comment:added' });
    const sig = crypto.createHmac('sha256', 'test_secret').update(body).digest('base64');
    expect(verifySignature(body, sig, 'test_secret')).toBe(true);
  });

  test('returns false for invalid signature', () => {
    expect(verifySignature('body', 'badsig', 'test_secret')).toBe(false);
  });
});

describe('webhook routing', () => {
  let app;
  beforeAll(async () => { app = await createApp(); });

  function makeRequest(payload) {
    const body = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', 'test_secret').update(body).digest('base64');
    return { body, sig };
  }

  test('returns 403 for invalid signature', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Todoist-Hmac-SHA256', 'invalidsig')
      .send('{}');
    expect(res.status).toBe(403);
  });

  test('returns 200 for valid webhook', async () => {
    const { default: request } = await import('supertest');
    const payload = { event_name: 'comment:added', event_data: { id: 'c1', task_id: 't1', posted_by_uid: 'other_uid', content: 'Hello AI' } };
    const { body, sig } = makeRequest(payload);
    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Todoist-Hmac-SHA256', sig)
      .send(body);
    expect(res.status).toBe(200);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- tests/server.test.js
```
Expected: FAIL — `server.js` does not exist.

**Step 4: Implement `server.js`**

```javascript
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
  const task = await getTask(taskId);
  const conv = await loadConversation(taskId);
  if (conv.messages.length > 0) {
    await postComment(taskId, `✅ Task completed. Conversation history cleared.`);
  }
  await cleanupTask(taskId);
}

export async function createApp() {
  const app = express();
  const secret = process.env.TODOIST_WEBHOOK_SECRET;
  let botUid = null;

  // Lazily cache bot UID
  async function isBotComment(uid) {
    if (!botUid) {
      try { botUid = await getBotUid(); } catch { botUid = null; }
    }
    return botUid && String(uid) === String(botUid);
  }

  // Raw body needed for HMAC verification
  app.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = buf.toString(); }
  }));

  app.post('/webhook', async (req, res) => {
    const sig = req.headers['x-todoist-hmac-sha256'];
    if (!sig || !verifySignature(req.rawBody, sig, secret)) {
      return res.status(403).json({ error: 'Invalid signature' });
    }

    // Always respond 200 immediately
    res.status(200).json({ ok: true });

    const { event_name, event_data } = req.body;

    enqueue(async () => {
      try {
        if (event_name === 'comment:added') {
          const { task_id, posted_by_uid, content } = event_data;
          if (await isBotComment(posted_by_uid)) return; // Prevent loop
          if (!await hasAiLabel(task_id)) return;
          await handleComment(task_id, content);

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
        const taskId = event_data?.task_id ?? event_data?.id;
        if (taskId) {
          try {
            await postComment(taskId, `⚠️ AI agent error: ${err.message}. Retry by adding a comment.`);
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
  app.listen(port, () => console.log(`Todoist AI Agent listening on port ${port}`));
}
```

**Step 5: Run tests to verify they pass**

```bash
npm test -- tests/server.test.js
```
Expected: PASS all tests.

**Step 6: Run all tests**

```bash
npm test
```
Expected: All tests pass.

**Step 7: Commit**

```bash
git add server.js tests/server.test.js
git commit -m "feat: webhook server with HMAC verification and async job queue"
```

---

## Task 7: Webhook Registration Script (`setup.js`)

**Files:**
- Create: `todoist-ai-agent/setup.js`

This is a one-time script to register the Todoist webhook.

**Step 1: Create `setup.js`**

```javascript
import axios from 'axios';
import 'dotenv/config';

const BASE = 'https://api.todoist.com/rest/v2';
const headers = { Authorization: `Bearer ${process.env.TODOIST_API_TOKEN}` };

async function listWebhooks() {
  // Todoist uses sync API for webhooks
  const { data } = await axios.post('https://api.todoist.com/sync/v9/sync', {
    sync_token: '*',
    resource_types: ['webhooks']
  }, { headers });
  return data.webhooks ?? [];
}

async function registerWebhook() {
  const existing = await listWebhooks();
  const url = 'https://9635783.xyz:9000/webhook';
  const alreadyExists = existing.some(w => w.url === url);

  if (alreadyExists) {
    console.log('✅ Webhook already registered:', url);
    return;
  }

  // Generate a random secret
  const { randomBytes } = await import('crypto');
  const secret = randomBytes(32).toString('hex');

  const { data } = await axios.post('https://api.todoist.com/sync/v9/webhooks', null, {
    headers,
    params: {
      url,
      events: 'comment:added,item:added,item:updated,item:completed',
      secret,
    }
  });

  console.log('✅ Webhook registered!');
  console.log(`📋 Add this to your .env file:`);
  console.log(`TODOIST_WEBHOOK_SECRET=${secret}`);
  console.log('\nWebhook details:', JSON.stringify(data, null, 2));
}

registerWebhook().catch(err => {
  console.error('❌ Failed to register webhook:', err.response?.data ?? err.message);
  process.exit(1);
});
```

**Step 2: Run the setup script**

```bash
node setup.js
```
Expected: Prints the `TODOIST_WEBHOOK_SECRET` value. Add it to `.env`.

**Step 3: Commit**

```bash
git add setup.js
git commit -m "feat: one-time webhook registration script"
```

---

## Task 8: launchd Daemon

**Files:**
- Create: `todoist-ai-agent/com.user.todoist-ai-agent.plist`

**Step 1: Create plist file**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.user.todoist-ai-agent</string>

  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/viktor_svirskyi/Documents/Claude/todoist-ai-agent/server.js</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/Users/viktor_svirskyi/Documents/Claude/todoist-ai-agent</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>

  <key>StandardOutPath</key>
  <string>/Users/viktor_svirskyi/Library/Logs/todoist-ai-agent.log</string>

  <key>StandardErrorPath</key>
  <string>/Users/viktor_svirskyi/Library/Logs/todoist-ai-agent.log</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
```

**Step 2: Load the environment variables into plist**

The plist doesn't load `.env` automatically. Instead, hardcode the env vars in the plist `EnvironmentVariables` dict:

```bash
# Print your current .env values in plist format
cat .env | grep -v '^#' | grep '=' | while IFS='=' read -r key val; do
  echo "    <key>$key</key>"
  echo "    <string>$val</string>"
done
```

Add those key/string pairs to the `EnvironmentVariables` dict in the plist.

**Step 3: Install the daemon**

```bash
cp com.user.todoist-ai-agent.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.user.todoist-ai-agent.plist
```

**Step 4: Verify it's running**

```bash
launchctl list | grep todoist
curl http://localhost:9000/health
```
Expected: `{"status":"ok"}`

**Step 5: Check logs**

```bash
tail -f ~/Library/Logs/todoist-ai-agent.log
```

**Step 6: Commit**

```bash
git add com.user.todoist-ai-agent.plist
git commit -m "feat: launchd daemon config for auto-start"
```

---

## Task 9: End-to-End Smoke Test

No code to write — manual verification steps.

**Step 1: Verify server health**

```bash
curl https://9635783.xyz:9000/health
```
Expected: `{"status":"ok"}`

**Step 2: Test with a new "AI"-labeled task**

In Todoist:
1. Create a new task: "What is the current Node.js LTS version?"
2. Add the label "AI" to it
3. Wait ~10 seconds

Expected: A comment appears on the task with Claude's answer.

**Step 3: Test multi-turn conversation**

On the same task, add a comment: "What changed between that version and the latest?"

Expected: A follow-up comment appears that references the previous answer.

**Step 4: Test browser tool**

Create a new "AI"-labeled task: "Go to https://nodejs.org and tell me what the current LTS version is"

Expected: Claude uses Playwright to browse the page and reports back.

**Step 5: Test shell tool**

Add a comment to any AI task: "What is the current disk usage on this Mac?"

Expected: Claude runs `df -h` and reports the output.

**Step 6: Verify error handling**

Temporarily set `ANTHROPIC_API_KEY` to an invalid value, restart, add a comment.

Expected: An error comment appears on the task. Restore the key and restart.

**Step 7: Final commit**

```bash
git add .
git commit -m "docs: update implementation plan with verified status"
```

---

## Management Commands

```bash
# View logs
tail -f ~/Library/Logs/todoist-ai-agent.log

# Restart agent
launchctl stop com.user.todoist-ai-agent
launchctl start com.user.todoist-ai-agent

# Stop permanently
launchctl unload ~/Library/LaunchAgents/com.user.todoist-ai-agent.plist

# Re-enable
launchctl load ~/Library/LaunchAgents/com.user.todoist-ai-agent.plist

# Check status
launchctl list | grep todoist
```
