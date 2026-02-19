# TypeScript Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the Todoist AI Agent from JavaScript to TypeScript with comprehensive test coverage, improved architecture, and webhook notifications.

**Architecture:** Separate Services with Shared Core - maintain server and poller as separate concerns while extracting all shared logic into reusable services. Add full TypeScript type safety, Vitest test coverage (80%+ target), and ntfy webhook notifications.

**Tech Stack:** TypeScript 5.x, Vitest, Node.js 20+, Express, Axios

---

## Task 1: TypeScript Setup and Configuration

**Files:**
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Modify: `package.json`
- Create: `.eslintrc.json`

**Step 1: Install TypeScript dependencies**

```bash
npm install --save-dev typescript @types/node @types/express tsx vitest @vitest/coverage-v8 @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['dist/**', 'tests/**', '**/*.test.ts', '**/*.config.ts']
    }
  }
});
```

**Step 4: Create .eslintrc.json**

```json
{
  "parser": "@typescript-eslint/parser",
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module"
  },
  "rules": {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
  }
}
```

**Step 5: Update package.json scripts**

Add/modify these scripts in `package.json`:

```json
{
  "scripts": {
    "build": "tsc",
    "build:watch": "tsc --watch",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "test:unit": "vitest tests/unit",
    "test:integration": "vitest tests/integration",
    "test:watch": "vitest --watch",
    "lint": "eslint src/**/*.ts",
    "typecheck": "tsc --noEmit"
  }
}
```

**Step 6: Create src directory structure**

```bash
mkdir -p src/{services,repositories,handlers,utils,types}
mkdir -p tests/{unit/{services,repositories,handlers,utils},integration,helpers}
```

**Step 7: Verify TypeScript compilation**

```bash
npm run typecheck
```

Expected: No errors (empty src directory is fine)

**Step 8: Commit**

```bash
git add tsconfig.json vitest.config.ts .eslintrc.json package.json package-lock.json
git commit -m "chore: add TypeScript and Vitest configuration"
```

---

## Task 2: Core Types and Interfaces

**Files:**
- Create: `src/types/index.ts`
- Create: `tests/unit/types/index.test.ts`

**Step 1: Write types test**

Create `tests/unit/types/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { TodoistTask, Conversation, Message, NotificationPayload, WebhookEvent } from '../../../src/types';

describe('Types', () => {
  it('should have TodoistTask type', () => {
    const task: TodoistTask = {
      id: '123',
      content: 'Test task',
      description: 'Test description',
      labels: ['AI'],
      added_at: '2026-02-19T10:00:00Z',
      is_deleted: false,
      checked: false
    };
    expect(task.id).toBe('123');
  });

  it('should have Conversation type', () => {
    const conv: Conversation = {
      title: 'Test',
      messages: [],
      createdAt: '2026-02-19T10:00:00Z',
      lastActivityAt: '2026-02-19T10:00:00Z'
    };
    expect(conv.messages).toHaveLength(0);
  });

  it('should have NotificationPayload type', () => {
    const payload: NotificationPayload = {
      taskTitle: 'Test',
      status: 'success',
      timestamp: '2026-02-19T10:00:00Z'
    };
    expect(payload.status).toBe('success');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test tests/unit/types
```

Expected: FAIL - module not found

**Step 3: Create types**

Create `src/types/index.ts`:

```typescript
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
```

**Step 4: Run test to verify it passes**

```bash
npm run test tests/unit/types
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/types/index.ts tests/unit/types/index.test.ts
git commit -m "feat: add TypeScript types and interfaces"
```

---

## Task 3: Configuration Utility

**Files:**
- Create: `src/utils/config.ts`
- Create: `tests/unit/utils/config.test.ts`

**Step 1: Write test for config**

Create `tests/unit/utils/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig } from '../../../src/utils/config';

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TODOIST_API_TOKEN: 'test-token',
      TODOIST_WEBHOOK_SECRET: 'test-secret',
      NTFY_WEBHOOK_URL: 'https://test.example.com',
      PORT: '9000'
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load configuration from environment', () => {
    const config = getConfig();

    expect(config.todoistApiToken).toBe('test-token');
    expect(config.todoistWebhookSecret).toBe('test-secret');
    expect(config.ntfyWebhookUrl).toBe('https://test.example.com');
    expect(config.port).toBe(9000);
  });

  it('should use default values', () => {
    delete process.env.PORT;
    delete process.env.POLL_INTERVAL_MS;

    const config = getConfig();

    expect(config.port).toBe(9000);
    expect(config.pollIntervalMs).toBe(60000);
    expect(config.claudeTimeoutMs).toBe(120000);
    expect(config.maxMessages).toBe(20);
    expect(config.aiLabel).toBe('AI');
  });

  it('should throw error if required env vars missing', () => {
    delete process.env.TODOIST_API_TOKEN;

    expect(() => getConfig()).toThrow('TODOIST_API_TOKEN');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test tests/unit/utils/config
```

Expected: FAIL - module not found

**Step 3: Implement config**

Create `src/utils/config.ts`:

```typescript
import type { Config } from '../types';

export function getConfig(): Config {
  const todoistApiToken = process.env.TODOIST_API_TOKEN;
  const todoistWebhookSecret = process.env.TODOIST_WEBHOOK_SECRET;
  const ntfyWebhookUrl = process.env.NTFY_WEBHOOK_URL || 'https://ntfy.g-spot.workers.dev';

  if (!todoistApiToken) {
    throw new Error('TODOIST_API_TOKEN environment variable is required');
  }

  if (!todoistWebhookSecret) {
    throw new Error('TODOIST_WEBHOOK_SECRET environment variable is required');
  }

  return {
    todoistApiToken,
    todoistWebhookSecret,
    ntfyWebhookUrl,
    port: parseInt(process.env.PORT || '9000', 10),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '60000', 10),
    claudeTimeoutMs: parseInt(process.env.CLAUDE_TIMEOUT_MS || '120000', 10),
    maxMessages: parseInt(process.env.MAX_MESSAGES || '20', 10),
    aiLabel: process.env.AI_LABEL || 'AI'
  };
}
```

**Step 4: Run test to verify it passes**

```bash
npm run test tests/unit/utils/config
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/config.ts tests/unit/utils/config.test.ts
git commit -m "feat: add configuration utility"
```

---

## Task 4: Logger Utility

**Files:**
- Create: `src/utils/logger.ts`
- Create: `tests/unit/utils/logger.test.ts`

**Step 1: Write test for logger**

Create `tests/unit/utils/logger.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '../../../src/utils/logger';

describe('Logger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('should log info messages with timestamp', () => {
    logger.info('Test message', { key: 'value' });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[INFO]'),
      expect.stringContaining('Test message'),
      expect.stringContaining('key')
    );
  });

  it('should log error messages with context', () => {
    logger.error('Error occurred', { taskId: '123', error: 'Failed' });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[ERROR]'),
      expect.stringContaining('Error occurred'),
      expect.stringContaining('taskId')
    );
  });

  it('should log warnings', () => {
    logger.warn('Warning message');

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[WARN]'),
      expect.stringContaining('Warning message')
    );
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test tests/unit/utils/logger
```

Expected: FAIL - module not found

**Step 3: Implement logger**

Create `src/utils/logger.ts`:

```typescript
type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogContext {
  [key: string]: unknown;
}

function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();
  const levelStr = `[${level.toUpperCase()}]`;
  const contextStr = context ? ` ${JSON.stringify(context)}` : '';
  return `${timestamp} ${levelStr} ${message}${contextStr}`;
}

export const logger = {
  info(message: string, context?: LogContext): void {
    console.log(formatLog('info', message, context));
  },

  warn(message: string, context?: LogContext): void {
    console.warn(formatLog('warn', message, context));
  },

  error(message: string, context?: LogContext): void {
    console.error(formatLog('error', message, context));
  },

  debug(message: string, context?: LogContext): void {
    if (process.env.DEBUG) {
      console.log(formatLog('debug', message, context));
    }
  }
};
```

**Step 4: Run test to verify it passes**

```bash
npm run test tests/unit/utils/logger
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/logger.ts tests/unit/utils/logger.test.ts
git commit -m "feat: add structured logger utility"
```

---

## Task 5: Constants

**Files:**
- Create: `src/utils/constants.ts`

**Step 1: Create constants file**

Create `src/utils/constants.ts`:

```typescript
export const CONSTANTS = {
  TODOIST_BASE_URL: 'https://api.todoist.com/api/v1',
  AI_INDICATOR: '🤖 **AI Agent**',
  ERROR_PREFIX: '⚠️ AI agent error:',
  POLL_INTERVAL_MS: 60_000,
  CLAUDE_TIMEOUT_MS: 120_000,
  MAX_MESSAGES: 20,
  AI_LABEL: 'AI'
} as const;
```

**Step 2: Verify TypeScript compilation**

```bash
npm run typecheck
```

Expected: No errors

**Step 3: Commit**

```bash
git add src/utils/constants.ts
git commit -m "feat: add constants"
```

---

## Task 6: Conversation Repository

**Files:**
- Create: `src/repositories/conversation.repository.ts`
- Create: `tests/unit/repositories/conversation.repository.test.ts`
- Create: `tests/helpers/fixtures.ts`

**Step 1: Create test fixtures**

Create `tests/helpers/fixtures.ts`:

```typescript
import type { TodoistTask, Conversation, Message, TodoistComment } from '../../src/types';

export function mockTask(overrides?: Partial<TodoistTask>): TodoistTask {
  return {
    id: '123',
    content: 'Test task',
    description: 'Test description',
    labels: ['AI'],
    added_at: '2026-02-19T10:00:00Z',
    is_deleted: false,
    checked: false,
    ...overrides
  };
}

export function mockConversation(overrides?: Partial<Conversation>): Conversation {
  return {
    title: 'Test task',
    messages: [],
    createdAt: '2026-02-19T10:00:00Z',
    lastActivityAt: '2026-02-19T10:00:00Z',
    ...overrides
  };
}

export function mockMessage(role: 'user' | 'assistant', content: string): Message {
  return { role, content };
}

export function mockComment(overrides?: Partial<TodoistComment>): TodoistComment {
  return {
    id: 'comment-123',
    task_id: '123',
    content: 'Test comment',
    posted_at: '2026-02-19T10:00:00Z',
    posted_uid: 'user-123',
    ...overrides
  };
}
```

**Step 2: Write repository tests**

Create `tests/unit/repositories/conversation.repository.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConversationRepository } from '../../../src/repositories/conversation.repository';
import { mockConversation, mockMessage } from '../../helpers/fixtures';

describe('ConversationRepository', () => {
  let tempDir: string;
  let repo: ConversationRepository;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'todoist-test-'));
    const dataFile = join(tempDir, 'conversations.json');
    repo = new ConversationRepository(dataFile);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should load conversation', async () => {
    const conv = await repo.load('task-123');

    expect(conv.messages).toEqual([]);
    expect(conv.title).toBe('');
  });

  it('should save and load conversation', async () => {
    const conv = mockConversation({ title: 'Test' });
    await repo.save('task-123', conv);

    const loaded = await repo.load('task-123');
    expect(loaded.title).toBe('Test');
  });

  it('should check task existence', async () => {
    expect(await repo.exists('task-123')).toBe(false);

    await repo.save('task-123', mockConversation());
    expect(await repo.exists('task-123')).toBe(true);
  });

  it('should cleanup task', async () => {
    await repo.save('task-123', mockConversation());
    expect(await repo.exists('task-123')).toBe(true);

    await repo.cleanup('task-123');
    expect(await repo.exists('task-123')).toBe(false);
  });

  it('should add message to conversation', () => {
    const conv = mockConversation();
    const updated = repo.addMessage(conv, 'user', 'Hello');

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

    const updated = repo.addMessage(conv, 'user', 'New message', 20);

    expect(updated.messages).toHaveLength(20);
    expect(updated.messages[0].content).toBe('Message 0'); // First preserved
    expect(updated.messages[updated.messages.length - 1].content).toBe('New message'); // Last is new
  });
});
```

**Step 3: Run test to verify it fails**

```bash
npm run test tests/unit/repositories
```

Expected: FAIL - module not found

**Step 4: Implement repository**

Create `src/repositories/conversation.repository.ts`:

```typescript
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { Conversation, Message } from '../types';

export class ConversationRepository {
  constructor(private dataFile: string) {}

  async load(taskId: string): Promise<Conversation> {
    try {
      const raw = await readFile(this.dataFile, 'utf8');
      const data = JSON.parse(raw);
      return data[taskId] ?? this.createEmpty();
    } catch {
      return this.createEmpty();
    }
  }

  async save(taskId: string, conversation: Conversation): Promise<void> {
    const data = await this.loadAll();
    data[taskId] = {
      ...conversation,
      lastActivityAt: new Date().toISOString()
    };
    await this.saveAll(data);
  }

  async exists(taskId: string): Promise<boolean> {
    const data = await this.loadAll();
    return taskId in data;
  }

  async cleanup(taskId: string): Promise<void> {
    const data = await this.loadAll();
    delete data[taskId];
    await this.saveAll(data);
  }

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

  private async loadAll(): Promise<Record<string, Conversation>> {
    try {
      const raw = await readFile(this.dataFile, 'utf8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  private async saveAll(data: Record<string, Conversation>): Promise<void> {
    await mkdir(dirname(this.dataFile), { recursive: true });
    await writeFile(this.dataFile, JSON.stringify(data, null, 2));
  }

  private createEmpty(): Conversation {
    return {
      title: '',
      messages: [],
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString()
    };
  }
}
```

**Step 5: Run test to verify it passes**

```bash
npm run test tests/unit/repositories
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/repositories/conversation.repository.ts tests/unit/repositories/conversation.repository.test.ts tests/helpers/fixtures.ts
git commit -m "feat: add conversation repository with tests"
```

---

## Task 7: Claude Service

**Files:**
- Create: `src/services/claude.service.ts`
- Create: `tests/unit/services/claude.service.test.ts`

**Step 1: Write Claude service tests**

Create `tests/unit/services/claude.service.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ClaudeService } from '../../../src/services/claude.service';
import { mockTask, mockMessage } from '../../helpers/fixtures';

describe('ClaudeService', () => {
  it('should build prompt with task context', () => {
    const service = new ClaudeService(120000);
    const task = mockTask({ content: 'Test task', description: 'Description' });
    const messages = [mockMessage('user', 'Hello')];

    const prompt = service.buildPrompt(task, messages);

    expect(prompt).toContain('Test task');
    expect(prompt).toContain('Description');
    expect(prompt).toContain('USER: Hello');
    expect(prompt).toContain('Todoist comment');
  });

  it('should build prompt without description', () => {
    const service = new ClaudeService(120000);
    const task = mockTask({ content: 'Test task', description: undefined });

    const prompt = service.buildPrompt(task, []);

    expect(prompt).toContain('Test task');
    expect(prompt).not.toContain('undefined');
  });

  it('should include conversation history in prompt', () => {
    const service = new ClaudeService(120000);
    const task = mockTask();
    const messages = [
      mockMessage('user', 'Question 1'),
      mockMessage('assistant', 'Answer 1'),
      mockMessage('user', 'Question 2')
    ];

    const prompt = service.buildPrompt(task, messages);

    expect(prompt).toContain('Question 1');
    expect(prompt).toContain('Answer 1');
    expect(prompt).toContain('Question 2');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test tests/unit/services/claude.service
```

Expected: FAIL - module not found

**Step 3: Implement Claude service (prompt building only)**

Create `src/services/claude.service.ts`:

```typescript
import { spawn } from 'child_process';
import type { TodoistTask, Message } from '../types';
import { logger } from '../utils/logger';

export class ClaudeService {
  constructor(private timeoutMs: number) {}

  buildPrompt(task: TodoistTask, messages: Message[]): string {
    const history = messages.length > 0
      ? messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
      : '';

    return [
      `You are an AI assistant embedded in Viktor's Todoist.`,
      `You help solve tasks by reasoning, browsing the web, and running shell commands on this Mac.`,
      `Current task: "${task.content}"`,
      task.description ? `Task description: "${task.description}"` : '',
      '',
      history ? `Conversation so far:\n${history}` : '',
      '',
      `Respond concisely — your reply will be posted as a Todoist comment.`,
      `If you need to browse the web or run commands, use your available tools.`
    ].filter(Boolean).join('\n');
  }

  async executePrompt(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let proc: ReturnType<typeof spawn>;

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`claude timed out after ${this.timeoutMs / 1000}s`));
      }, this.timeoutMs);

      proc = spawn('claude', [
        '--print',
        '--dangerously-skip-permissions',
        '--no-session-persistence',
        '--permission-mode', 'bypassPermissions',
        prompt
      ], {
        env: { ...process.env, HOME: process.env.HOME },
        stdio: ['ignore', 'pipe', 'pipe']
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
          logger.error('Claude CLI failed', { code, stderr: stderr.trim() });
          reject(new Error(`claude exited with code ${code}: ${stderr.trim()}`));
        }
      });

      proc.on('error', err => {
        clearTimeout(timer);
        logger.error('Failed to spawn claude', { error: err.message });
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });
    });
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npm run test tests/unit/services/claude.service
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/claude.service.ts tests/unit/services/claude.service.test.ts
git commit -m "feat: add Claude service with prompt building"
```

---

## Task 8: Todoist Service

**Files:**
- Create: `src/services/todoist.service.ts`
- Create: `tests/unit/services/todoist.service.test.ts`

**Step 1: Write Todoist service tests**

Create `tests/unit/services/todoist.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { TodoistService } from '../../../src/services/todoist.service';
import { mockTask } from '../../helpers/fixtures';

vi.mock('axios');

describe('TodoistService', () => {
  let service: TodoistService;

  beforeEach(() => {
    service = new TodoistService('test-token', 'AI');
    vi.clearAllMocks();
  });

  it('should get task by ID', async () => {
    const task = mockTask();
    vi.mocked(axios.get).mockResolvedValueOnce({ data: task });

    const result = await service.getTask('123');

    expect(result).toEqual(task);
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.todoist.com/api/v1/tasks/123',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' }
      })
    );
  });

  it('should post comment with AI indicator', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ data: {} });

    await service.postComment('123', 'Test response');

    expect(axios.post).toHaveBeenCalledWith(
      'https://api.todoist.com/api/v1/comments',
      {
        task_id: '123',
        content: '🤖 **AI Agent**\n\nTest response'
      },
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' }
      })
    );
  });

  it('should check if task has AI label', async () => {
    const task = mockTask({ labels: ['AI', 'Other'] });
    vi.mocked(axios.get).mockResolvedValueOnce({ data: task });

    const result = await service.hasAiLabel('123');

    expect(result).toBe(true);
  });

  it('should return false if task lacks AI label', async () => {
    const task = mockTask({ labels: ['Other'] });
    vi.mocked(axios.get).mockResolvedValueOnce({ data: task });

    const result = await service.hasAiLabel('123');

    expect(result).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test tests/unit/services/todoist.service
```

Expected: FAIL - module not found

**Step 3: Implement Todoist service**

Create `src/services/todoist.service.ts`:

```typescript
import axios from 'axios';
import type { TodoistTask } from '../types';
import { CONSTANTS } from '../utils/constants';
import { logger } from '../utils/logger';

export class TodoistService {
  private baseUrl = CONSTANTS.TODOIST_BASE_URL;

  constructor(
    private apiToken: string,
    private aiLabel: string
  ) {}

  async getTask(taskId: string): Promise<TodoistTask> {
    const { data } = await axios.get<TodoistTask>(
      `${this.baseUrl}/tasks/${taskId}`,
      { headers: this.headers() }
    );
    return data;
  }

  async postComment(taskId: string, content: string): Promise<void> {
    const aiContent = `${CONSTANTS.AI_INDICATOR}\n\n${content}`;

    await axios.post(
      `${this.baseUrl}/comments`,
      { task_id: taskId, content: aiContent },
      { headers: this.headers() }
    );

    logger.info('Posted comment', { taskId, contentLength: content.length });
  }

  async hasAiLabel(taskId: string): Promise<boolean> {
    try {
      const task = await this.getTask(taskId);
      return (task.labels ?? []).includes(this.aiLabel);
    } catch (error) {
      logger.error('Failed to check AI label', { taskId, error });
      return false;
    }
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.apiToken}`
    };
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npm run test tests/unit/services/todoist.service
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/todoist.service.ts tests/unit/services/todoist.service.test.ts
git commit -m "feat: add Todoist service with API client"
```

---

## Task 9: Notification Service

**Files:**
- Create: `src/services/notification.service.ts`
- Create: `tests/unit/services/notification.service.test.ts`

**Step 1: Write notification service tests**

Create `tests/unit/services/notification.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { NotificationService } from '../../../src/services/notification.service';

vi.mock('axios');

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    service = new NotificationService('https://test.example.com');
    vi.clearAllMocks();
  });

  it('should send success notification', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ data: {} });

    await service.sendNotification({
      taskTitle: 'Test task',
      status: 'success',
      timestamp: '2026-02-19T10:00:00Z'
    });

    expect(axios.post).toHaveBeenCalledWith(
      'https://test.example.com',
      expect.objectContaining({
        taskTitle: 'Test task',
        status: 'success'
      })
    );
  });

  it('should send error notification with message', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ data: {} });

    await service.sendNotification({
      taskTitle: 'Test task',
      status: 'error',
      message: 'Something failed',
      timestamp: '2026-02-19T10:00:00Z'
    });

    expect(axios.post).toHaveBeenCalledWith(
      'https://test.example.com',
      expect.objectContaining({
        taskTitle: 'Test task',
        status: 'error',
        message: 'Something failed'
      })
    );
  });

  it('should fail gracefully on network error', async () => {
    vi.mocked(axios.post).mockRejectedValueOnce(new Error('Network error'));

    await expect(
      service.sendNotification({
        taskTitle: 'Test',
        status: 'success',
        timestamp: '2026-02-19T10:00:00Z'
      })
    ).resolves.not.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test tests/unit/services/notification.service
```

Expected: FAIL - module not found

**Step 3: Implement notification service**

Create `src/services/notification.service.ts`:

```typescript
import axios from 'axios';
import type { NotificationPayload } from '../types';
import { logger } from '../utils/logger';

export class NotificationService {
  constructor(private webhookUrl: string) {}

  async sendNotification(payload: NotificationPayload): Promise<void> {
    try {
      await axios.post(this.webhookUrl, payload, {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' }
      });

      logger.info('Notification sent', {
        taskTitle: payload.taskTitle,
        status: payload.status
      });
    } catch (error) {
      // Fail gracefully - notification is secondary to core functionality
      logger.warn('Failed to send notification', {
        error: error instanceof Error ? error.message : 'Unknown error',
        payload
      });
    }
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npm run test tests/unit/services/notification.service
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/notification.service.ts tests/unit/services/notification.service.test.ts
git commit -m "feat: add notification service for ntfy webhooks"
```

---

## Task 10: Task Processor Service

**Files:**
- Create: `src/services/task-processor.service.ts`
- Create: `tests/unit/services/task-processor.service.test.ts`
- Create: `tests/helpers/mocks.ts`

**Step 1: Create mock helpers**

Create `tests/helpers/mocks.ts`:

```typescript
import { vi } from 'vitest';
import type { ClaudeService } from '../../src/services/claude.service';
import type { TodoistService } from '../../src/services/todoist.service';
import type { NotificationService } from '../../src/services/notification.service';
import type { ConversationRepository } from '../../src/repositories/conversation.repository';

export function createMockClaudeService(): ClaudeService {
  return {
    buildPrompt: vi.fn(),
    executePrompt: vi.fn()
  } as unknown as ClaudeService;
}

export function createMockTodoistService(): TodoistService {
  return {
    getTask: vi.fn(),
    postComment: vi.fn(),
    hasAiLabel: vi.fn()
  } as unknown as TodoistService;
}

export function createMockNotificationService(): NotificationService {
  return {
    sendNotification: vi.fn()
  } as unknown as NotificationService;
}

export function createMockConversationRepository(): ConversationRepository {
  return {
    load: vi.fn(),
    save: vi.fn(),
    exists: vi.fn(),
    cleanup: vi.fn(),
    addMessage: vi.fn()
  } as unknown as ConversationRepository;
}
```

**Step 2: Write task processor tests**

Create `tests/unit/services/task-processor.service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskProcessorService } from '../../../src/services/task-processor.service';
import {
  createMockClaudeService,
  createMockTodoistService,
  createMockNotificationService,
  createMockConversationRepository
} from '../../helpers/mocks';
import { mockTask, mockConversation } from '../../helpers/fixtures';

describe('TaskProcessorService', () => {
  let processor: TaskProcessorService;
  let claude: ReturnType<typeof createMockClaudeService>;
  let todoist: ReturnType<typeof createMockTodoistService>;
  let notifications: ReturnType<typeof createMockNotificationService>;
  let conversations: ReturnType<typeof createMockConversationRepository>;

  beforeEach(() => {
    claude = createMockClaudeService();
    todoist = createMockTodoistService();
    notifications = createMockNotificationService();
    conversations = createMockConversationRepository();

    processor = new TaskProcessorService(
      claude,
      todoist,
      notifications,
      conversations
    );
  });

  it('should process new task successfully', async () => {
    const task = mockTask();
    const conv = mockConversation();
    const updatedConv = { ...conv, messages: [{ role: 'user' as const, content: 'Task' }] };

    vi.mocked(conversations.load).mockResolvedValue(conv);
    vi.mocked(conversations.addMessage).mockReturnValue(updatedConv);
    vi.mocked(claude.buildPrompt).mockReturnValue('prompt');
    vi.mocked(claude.executePrompt).mockResolvedValue('AI response');

    await processor.processNewTask(task);

    expect(conversations.load).toHaveBeenCalledWith('123');
    expect(claude.executePrompt).toHaveBeenCalledWith('prompt');
    expect(todoist.postComment).toHaveBeenCalledWith('123', 'AI response');
    expect(notifications.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        taskTitle: 'Test task',
        status: 'success'
      })
    );
    expect(conversations.save).toHaveBeenCalled();
  });

  it('should handle errors and send error notification', async () => {
    const task = mockTask();
    const conv = mockConversation();

    vi.mocked(conversations.load).mockResolvedValue(conv);
    vi.mocked(conversations.addMessage).mockReturnValue(conv);
    vi.mocked(claude.buildPrompt).mockReturnValue('prompt');
    vi.mocked(claude.executePrompt).mockRejectedValue(new Error('Timeout'));

    await processor.processNewTask(task);

    expect(todoist.postComment).toHaveBeenCalledWith(
      '123',
      expect.stringContaining('⚠️ AI agent error: Timeout')
    );
    expect(notifications.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        message: 'Timeout'
      })
    );
  });

  it('should process comment on existing task', async () => {
    const task = mockTask();
    const conv = mockConversation({ messages: [{ role: 'user', content: 'Previous' }] });

    vi.mocked(todoist.getTask).mockResolvedValue(task);
    vi.mocked(conversations.load).mockResolvedValue(conv);
    vi.mocked(conversations.addMessage).mockReturnValue(conv);
    vi.mocked(claude.buildPrompt).mockReturnValue('prompt');
    vi.mocked(claude.executePrompt).mockResolvedValue('Response');

    await processor.processComment('123', 'User comment');

    expect(conversations.addMessage).toHaveBeenCalledWith(conv, 'user', 'User comment');
    expect(claude.executePrompt).toHaveBeenCalled();
    expect(todoist.postComment).toHaveBeenCalledWith('123', 'Response');
  });

  it('should handle task completion', async () => {
    const conv = mockConversation({ messages: [{ role: 'user', content: 'Task' }] });
    vi.mocked(conversations.load).mockResolvedValue(conv);

    await processor.handleTaskCompletion('123');

    expect(todoist.postComment).toHaveBeenCalledWith(
      '123',
      expect.stringContaining('Task completed')
    );
    expect(conversations.cleanup).toHaveBeenCalledWith('123');
  });
});
```

**Step 3: Run test to verify it fails**

```bash
npm run test tests/unit/services/task-processor.service
```

Expected: FAIL - module not found

**Step 4: Implement task processor service**

Create `src/services/task-processor.service.ts`:

```typescript
import type { TodoistTask } from '../types';
import type { ClaudeService } from './claude.service';
import type { TodoistService } from './todoist.service';
import type { NotificationService } from './notification.service';
import type { ConversationRepository } from '../repositories/conversation.repository';
import { CONSTANTS } from '../utils/constants';
import { logger } from '../utils/logger';

export class TaskProcessorService {
  constructor(
    private claude: ClaudeService,
    private todoist: TodoistService,
    private notifications: NotificationService,
    private conversations: ConversationRepository
  ) {}

  async processNewTask(task: TodoistTask): Promise<void> {
    logger.info('Processing new task', { taskId: task.id, title: task.content });

    try {
      let conv = await this.conversations.load(task.id);

      if (conv.messages.length === 0) {
        conv = { ...conv, title: task.content, createdAt: new Date().toISOString() };
        const taskContent = `Task: ${task.content}\n${task.description || ''}`.trim();
        conv = this.conversations.addMessage(conv, 'user', taskContent);
      }

      const prompt = this.claude.buildPrompt(task, conv.messages);
      const response = await this.claude.executePrompt(prompt);

      conv = this.conversations.addMessage(conv, 'assistant', response);
      await this.conversations.save(task.id, conv);
      await this.todoist.postComment(task.id, response);

      await this.notifications.sendNotification({
        taskTitle: task.content,
        status: 'success',
        timestamp: new Date().toISOString()
      });

      logger.info('Task processed successfully', { taskId: task.id });
    } catch (error) {
      await this.handleError(task.id, task.content, error);
    }
  }

  async processComment(taskId: string, comment: string): Promise<void> {
    logger.info('Processing comment', { taskId, commentLength: comment.length });

    try {
      const task = await this.todoist.getTask(taskId);
      let conv = await this.conversations.load(taskId);

      if (conv.messages.length === 0) {
        conv = { ...conv, title: task.content };
        const taskContent = `Task: ${task.content}\n${task.description || ''}`.trim();
        conv = this.conversations.addMessage(conv, 'user', taskContent);
      }

      conv = this.conversations.addMessage(conv, 'user', comment);
      const prompt = this.claude.buildPrompt(task, conv.messages);
      const response = await this.claude.executePrompt(prompt);

      conv = this.conversations.addMessage(conv, 'assistant', response);
      await this.conversations.save(taskId, conv);
      await this.todoist.postComment(taskId, response);

      await this.notifications.sendNotification({
        taskTitle: task.content,
        status: 'success',
        timestamp: new Date().toISOString()
      });

      logger.info('Comment processed successfully', { taskId });
    } catch (error) {
      const task = await this.todoist.getTask(taskId);
      await this.handleError(taskId, task.content, error);
    }
  }

  async handleTaskCompletion(taskId: string): Promise<void> {
    logger.info('Handling task completion', { taskId });

    const conv = await this.conversations.load(taskId);
    if (conv.messages.length > 0) {
      await this.todoist.postComment(taskId, 'Task completed. Conversation history cleared.');
    }
    await this.conversations.cleanup(taskId);
  }

  private async handleError(taskId: string, taskTitle: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Task processing failed', { taskId, error: message });

    try {
      await this.todoist.postComment(
        taskId,
        `${CONSTANTS.ERROR_PREFIX} ${message}. Retry by adding a comment.`
      );
    } catch (e) {
      logger.error('Failed to post error comment', { taskId, error: e });
    }

    await this.notifications.sendNotification({
      taskTitle,
      status: 'error',
      message,
      timestamp: new Date().toISOString()
    });
  }
}
```

**Step 5: Run test to verify it passes**

```bash
npm run test tests/unit/services/task-processor.service
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/services/task-processor.service.ts tests/unit/services/task-processor.service.test.ts tests/helpers/mocks.ts
git commit -m "feat: add task processor service with error handling"
```

---

## Task 11: Webhook Handler

**Files:**
- Create: `src/handlers/webhook.handler.ts`
- Create: `tests/unit/handlers/webhook.handler.test.ts`

**Step 1: Write webhook handler tests**

Create `tests/unit/handlers/webhook.handler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhookHandler } from '../../../src/handlers/webhook.handler';
import {
  createMockTodoistService,
  createMockConversationRepository
} from '../../helpers/mocks';
import type { TaskProcessorService } from '../../../src/services/task-processor.service';

describe('WebhookHandler', () => {
  let handler: WebhookHandler;
  let processor: TaskProcessorService;
  let todoist: ReturnType<typeof createMockTodoistService>;
  let conversations: ReturnType<typeof createMockConversationRepository>;

  beforeEach(() => {
    processor = {
      processNewTask: vi.fn(),
      processComment: vi.fn(),
      handleTaskCompletion: vi.fn()
    } as unknown as TaskProcessorService;

    todoist = createMockTodoistService();
    conversations = createMockConversationRepository();

    handler = new WebhookHandler(processor, todoist, conversations);
  });

  it('should process item:added event with AI label', async () => {
    vi.mocked(todoist.getTask).mockResolvedValue({
      id: '123',
      content: 'Test',
      labels: ['AI'],
      added_at: '2026-02-19T10:00:00Z',
      is_deleted: false,
      checked: false
    });

    await handler.handleWebhook({
      event_name: 'item:added',
      event_data: { id: '123', labels: ['AI'] }
    });

    expect(processor.processNewTask).toHaveBeenCalled();
  });

  it('should ignore item:added without AI label', async () => {
    await handler.handleWebhook({
      event_name: 'item:added',
      event_data: { id: '123', labels: ['Other'] }
    });

    expect(processor.processNewTask).not.toHaveBeenCalled();
  });

  it('should process note:added event', async () => {
    vi.mocked(todoist.hasAiLabel).mockResolvedValue(true);

    await handler.handleWebhook({
      event_name: 'note:added',
      event_data: { item_id: '123', content: 'Comment', posted_uid: 'user-1' }
    });

    expect(processor.processComment).toHaveBeenCalledWith('123', 'Comment');
  });

  it('should ignore bot comments', async () => {
    vi.mocked(todoist.hasAiLabel).mockResolvedValue(true);

    await handler.handleWebhook({
      event_name: 'note:added',
      event_data: {
        item_id: '123',
        content: '🤖 **AI Agent**\n\nResponse',
        posted_uid: 'user-1'
      }
    });

    expect(processor.processComment).not.toHaveBeenCalled();
  });

  it('should handle item:completed event', async () => {
    vi.mocked(todoist.hasAiLabel).mockResolvedValue(true);

    await handler.handleWebhook({
      event_name: 'item:completed',
      event_data: { id: '123' }
    });

    expect(processor.handleTaskCompletion).toHaveBeenCalledWith('123');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test tests/unit/handlers/webhook.handler
```

Expected: FAIL - module not found

**Step 3: Implement webhook handler**

Create `src/handlers/webhook.handler.ts`:

```typescript
import type { WebhookEvent } from '../types';
import type { TaskProcessorService } from '../services/task-processor.service';
import type { TodoistService } from '../services/todoist.service';
import type { ConversationRepository } from '../repositories/conversation.repository';
import { CONSTANTS } from '../utils/constants';
import { logger } from '../utils/logger';

export class WebhookHandler {
  constructor(
    private processor: TaskProcessorService,
    private todoist: TodoistService,
    private conversations: ConversationRepository
  ) {}

  async handleWebhook(event: WebhookEvent): Promise<void> {
    const { event_name, event_data } = event;

    try {
      if (event_name === 'item:added') {
        const labels = event_data.labels ?? [];
        if (!labels.includes(CONSTANTS.AI_LABEL)) return;

        const task = await this.todoist.getTask(event_data.id!);
        await this.processor.processNewTask(task);

      } else if (event_name === 'item:updated') {
        const labels = event_data.labels ?? [];
        if (!labels.includes(CONSTANTS.AI_LABEL)) return;
        if (await this.conversations.exists(event_data.id!)) return;

        const task = await this.todoist.getTask(event_data.id!);
        await this.processor.processNewTask(task);

      } else if (event_name === 'note:added') {
        const taskId = event_data.item_id!;
        const content = event_data.content!;

        // Ignore bot's own comments
        if (content.startsWith(CONSTANTS.AI_INDICATOR)) return;
        if (content.startsWith(CONSTANTS.ERROR_PREFIX)) return;

        if (!await this.todoist.hasAiLabel(taskId)) return;

        await this.processor.processComment(taskId, content);

      } else if (event_name === 'item:completed') {
        const taskId = event_data.id!;
        if (!await this.todoist.hasAiLabel(taskId)) return;

        await this.processor.handleTaskCompletion(taskId);
      }
    } catch (error) {
      logger.error('Webhook handling failed', {
        event_name,
        error: error instanceof Error ? error.message : 'Unknown'
      });
      throw error;
    }
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npm run test tests/unit/handlers/webhook.handler
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/handlers/webhook.handler.ts tests/unit/handlers/webhook.handler.test.ts
git commit -m "feat: add webhook handler with event processing"
```

---

## Task 12: Polling Handler

**Files:**
- Create: `src/handlers/polling.handler.ts`
- Create: `tests/unit/handlers/polling.handler.test.ts`

**Step 1: Write polling handler tests**

Create `tests/unit/handlers/polling.handler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { PollingHandler } from '../../../src/handlers/polling.handler';
import {
  createMockTodoistService,
  createMockConversationRepository
} from '../../helpers/mocks';
import type { TaskProcessorService } from '../../../src/services/task-processor.service';
import { mockTask, mockComment } from '../../helpers/fixtures';

vi.mock('axios');

describe('PollingHandler', () => {
  let handler: PollingHandler;
  let processor: TaskProcessorService;
  let todoist: ReturnType<typeof createMockTodoistService>;
  let conversations: ReturnType<typeof createMockConversationRepository>;

  beforeEach(() => {
    processor = {
      processNewTask: vi.fn(),
      processComment: vi.fn()
    } as unknown as TaskProcessorService;

    todoist = createMockTodoistService();
    conversations = createMockConversationRepository();

    handler = new PollingHandler(processor, todoist, conversations, 'test-token');
    vi.clearAllMocks();
  });

  it('should fetch AI-labeled tasks', async () => {
    const tasks = [mockTask({ labels: ['AI'] })];
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { results: tasks } });

    await handler.poll();

    expect(axios.get).toHaveBeenCalledWith(
      'https://api.todoist.com/api/v1/tasks',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' }
      })
    );
  });

  it('should process new tasks', async () => {
    const task = mockTask({ added_at: new Date().toISOString() });
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { results: [task] } });
    vi.mocked(conversations.exists).mockResolvedValue(false);

    await handler.poll();

    expect(processor.processNewTask).toHaveBeenCalledWith(task);
  });

  it('should detect new comments on existing tasks', async () => {
    const task = mockTask({ added_at: '2026-02-19T10:00:00Z' });
    const comment = mockComment();

    vi.mocked(axios.get)
      .mockResolvedValueOnce({ data: { results: [task] } })
      .mockResolvedValueOnce({ data: { results: [comment] } });

    vi.mocked(conversations.exists).mockResolvedValue(true);

    await handler.poll();

    // Should check for comments
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.todoist.com/api/v1/comments',
      expect.objectContaining({
        params: { task_id: '123' }
      })
    );
  });

  it('should ignore bot comments', async () => {
    const task = mockTask();
    const botComment = mockComment({ content: '🤖 **AI Agent**\n\nResponse' });

    vi.mocked(axios.get)
      .mockResolvedValueOnce({ data: { results: [task] } })
      .mockResolvedValueOnce({ data: { results: [botComment] } });

    vi.mocked(conversations.exists).mockResolvedValue(true);

    await handler.poll();

    expect(processor.processComment).not.toHaveBeenCalled();
  });

  it('should track processed comment IDs', async () => {
    const task = mockTask();
    const comment = mockComment();

    vi.mocked(axios.get)
      .mockResolvedValueOnce({ data: { results: [task] } })
      .mockResolvedValueOnce({ data: { results: [comment] } });

    vi.mocked(conversations.exists).mockResolvedValue(true);

    // First poll - should process
    await handler.poll();
    expect(processor.processComment).toHaveBeenCalledTimes(1);

    // Second poll - should skip (already processed)
    vi.mocked(axios.get)
      .mockResolvedValueOnce({ data: { results: [task] } })
      .mockResolvedValueOnce({ data: { results: [comment] } });

    await handler.poll();
    expect(processor.processComment).toHaveBeenCalledTimes(1); // Still 1
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test tests/unit/handlers/polling.handler
```

Expected: FAIL - module not found

**Step 3: Implement polling handler**

Create `src/handlers/polling.handler.ts`:

```typescript
import axios from 'axios';
import type { TodoistTask, TodoistComment } from '../types';
import type { TaskProcessorService } from '../services/task-processor.service';
import type { TodoistService } from '../services/todoist.service';
import type { ConversationRepository } from '../repositories/conversation.repository';
import { CONSTANTS } from '../utils/constants';
import { logger } from '../utils/logger';

export class PollingHandler {
  private lastPollTime = new Date();
  private processedComments = new Set<string>();

  constructor(
    private processor: TaskProcessorService,
    private todoist: TodoistService,
    private conversations: ConversationRepository,
    private apiToken: string
  ) {}

  async poll(): Promise<void> {
    logger.debug('Polling for AI-labeled tasks');

    try {
      const tasks = await this.fetchAiTasks();
      const currentPollTime = new Date();

      for (const task of tasks) {
        await this.processTask(task);
      }

      this.lastPollTime = currentPollTime;
    } catch (error) {
      logger.error('Polling failed', {
        error: error instanceof Error ? error.message : 'Unknown'
      });
    }
  }

  private async fetchAiTasks(): Promise<TodoistTask[]> {
    const { data } = await axios.get<{ results: TodoistTask[] }>(
      `${CONSTANTS.TODOIST_BASE_URL}/tasks`,
      { headers: { Authorization: `Bearer ${this.apiToken}` } }
    );

    const tasks = data.results || [];
    return tasks.filter(t =>
      t.labels?.includes(CONSTANTS.AI_LABEL) &&
      !t.is_deleted &&
      !t.checked
    );
  }

  private async processTask(task: TodoistTask): Promise<void> {
    const taskAdded = new Date(task.added_at);
    const isNewTask = taskAdded > this.lastPollTime;
    const alreadyProcessed = await this.conversations.exists(task.id);

    // Process new tasks
    if (isNewTask && !alreadyProcessed) {
      await this.processor.processNewTask(task);
      return;
    }

    // Mark old tasks as seen
    if (!isNewTask && !alreadyProcessed) {
      logger.debug('Marking old task as seen', { taskId: task.id });
      await this.conversations.save(task.id, {
        title: task.content,
        messages: [],
        createdAt: task.added_at,
        lastActivityAt: new Date().toISOString()
      });
      return;
    }

    // Check for new comments on existing tasks
    await this.checkForNewComments(task);
  }

  private async checkForNewComments(task: TodoistTask): Promise<void> {
    const comments = await this.fetchComments(task.id);
    const newComments = comments.filter(c =>
      !this.processedComments.has(c.id) &&
      !c.content.startsWith(CONSTANTS.AI_INDICATOR) &&
      !c.content.startsWith(CONSTANTS.ERROR_PREFIX)
    );

    if (newComments.length === 0) return;

    logger.info('Found new comments', { taskId: task.id, count: newComments.length });

    // Process chronologically
    newComments.sort((a, b) => new Date(a.posted_at).getTime() - new Date(b.posted_at).getTime());

    for (const comment of newComments) {
      this.processedComments.add(comment.id);
      await this.processor.processComment(task.id, comment.content);
    }
  }

  private async fetchComments(taskId: string): Promise<TodoistComment[]> {
    try {
      const { data } = await axios.get<{ results: TodoistComment[] }>(
        `${CONSTANTS.TODOIST_BASE_URL}/comments`,
        {
          headers: { Authorization: `Bearer ${this.apiToken}` },
          params: { task_id: taskId }
        }
      );
      return data.results || [];
    } catch (error) {
      logger.error('Failed to fetch comments', { taskId, error });
      return [];
    }
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npm run test tests/unit/handlers/polling.handler
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/handlers/polling.handler.ts tests/unit/handlers/polling.handler.test.ts
git commit -m "feat: add polling handler with comment detection"
```

---

## Task 13: Server Entry Point

**Files:**
- Create: `src/server.ts`
- Modify: `src/types/index.ts` (add Express types)

**Step 1: Add Express types**

Append to `src/types/index.ts`:

```typescript
import type { Request } from 'express';

export interface WebhookRequest extends Request {
  rawBody?: string;
}
```

**Step 2: Create server**

Create `src/server.ts`:

```typescript
import express from 'express';
import crypto from 'crypto';
import { WebhookHandler } from './handlers/webhook.handler';
import { logger } from './utils/logger';
import type { WebhookRequest, WebhookEvent } from './types';

export function createServer(
  handler: WebhookHandler,
  webhookSecret: string,
  port: number
) {
  const app = express();

  // Raw body needed for HMAC verification
  app.use(express.json({
    verify: (req: WebhookRequest, _res, buf) => {
      req.rawBody = buf.toString();
    }
  }));

  // Request logging
  app.use((req, _res, next) => {
    logger.debug('Request received', { method: req.method, path: req.path });
    next();
  });

  // Webhook endpoint
  app.post('/webhook', async (req: WebhookRequest, res) => {
    const signature = req.headers['x-todoist-hmac-sha256'] as string;

    // Verify HMAC signature
    if (signature && req.rawBody) {
      const expected = crypto
        .createHmac('sha256', webhookSecret)
        .update(req.rawBody)
        .digest('base64');

      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
        logger.warn('Invalid webhook signature');
        return res.status(403).json({ error: 'Invalid signature' });
      }
    }

    // Respond immediately
    res.status(200).json({ ok: true });

    // Process asynchronously
    const event: WebhookEvent = req.body;
    setImmediate(async () => {
      try {
        await handler.handleWebhook(event);
      } catch (error) {
        logger.error('Webhook processing failed', { error });
      }
    });
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return app;
}
```

**Step 3: Verify TypeScript compilation**

```bash
npm run typecheck
```

Expected: No errors

**Step 4: Commit**

```bash
git add src/server.ts src/types/index.ts
git commit -m "feat: add Express server with webhook endpoint"
```

---

## Task 14: Poller Entry Point

**Files:**
- Create: `src/poller.ts`

**Step 1: Create poller**

Create `src/poller.ts`:

```typescript
import { PollingHandler } from './handlers/polling.handler';
import { logger } from './utils/logger';

export function startPoller(
  handler: PollingHandler,
  intervalMs: number
): NodeJS.Timeout {
  logger.info('Starting poller', { intervalMs });

  // Poll immediately
  handler.poll().catch(error => {
    logger.error('Initial poll failed', { error });
  });

  // Then poll on interval
  return setInterval(() => {
    handler.poll().catch(error => {
      logger.error('Poll failed', { error });
    });
  }, intervalMs);
}
```

**Step 2: Verify TypeScript compilation**

```bash
npm run typecheck
```

Expected: No errors

**Step 3: Commit**

```bash
git add src/poller.ts
git commit -m "feat: add poller entry point"
```

---

## Task 15: Main Index

**Files:**
- Create: `src/index.ts`

**Step 1: Create main index**

Create `src/index.ts`:

```typescript
import 'dotenv/config';
import { createServer } from './server';
import { startPoller } from './poller';
import { WebhookHandler } from './handlers/webhook.handler';
import { PollingHandler } from './handlers/polling.handler';
import { TaskProcessorService } from './services/task-processor.service';
import { ClaudeService } from './services/claude.service';
import { TodoistService } from './services/todoist.service';
import { NotificationService } from './services/notification.service';
import { ConversationRepository } from './repositories/conversation.repository';
import { getConfig } from './utils/config';
import { logger } from './utils/logger';

async function main() {
  try {
    const config = getConfig();

    // Initialize services
    const conversationRepo = new ConversationRepository('./data/conversations.json');
    const claudeService = new ClaudeService(config.claudeTimeoutMs);
    const todoistService = new TodoistService(config.todoistApiToken, config.aiLabel);
    const notificationService = new NotificationService(config.ntfyWebhookUrl);

    const taskProcessor = new TaskProcessorService(
      claudeService,
      todoistService,
      notificationService,
      conversationRepo
    );

    // Initialize handlers
    const webhookHandler = new WebhookHandler(
      taskProcessor,
      todoistService,
      conversationRepo
    );

    const pollingHandler = new PollingHandler(
      taskProcessor,
      todoistService,
      conversationRepo,
      config.todoistApiToken
    );

    // Start server
    const app = createServer(webhookHandler, config.todoistWebhookSecret, config.port);
    app.listen(config.port, '0.0.0.0', () => {
      logger.info('Server listening', { port: config.port });
    });

    // Start poller
    startPoller(pollingHandler, config.pollIntervalMs);
    logger.info('Poller started', { intervalMs: config.pollIntervalMs });

    logger.info('Todoist AI Agent started successfully');
  } catch (error) {
    logger.error('Failed to start', { error });
    process.exit(1);
  }
}

main();
```

**Step 2: Build TypeScript**

```bash
npm run build
```

Expected: Compilation successful, output in `dist/`

**Step 3: Test running compiled code**

```bash
# Ensure .env is configured
node dist/index.js &
SERVER_PID=$!
sleep 5

# Test health endpoint
curl http://localhost:9000/health

# Stop server
kill $SERVER_PID
```

Expected: Health check returns `{"status":"ok","timestamp":"..."}`

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add main entry point with service initialization"
```

---

## Task 16: Integration Tests

**Files:**
- Create: `tests/integration/server.integration.test.ts`
- Create: `tests/integration/poller.integration.test.ts`

**Step 1: Write server integration test**

Create `tests/integration/server.integration.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createServer } from '../../src/server';
import { WebhookHandler } from '../../src/handlers/webhook.handler';
import { TaskProcessorService } from '../../src/services/task-processor.service';
import { TodoistService } from '../../src/services/todoist.service';
import { ConversationRepository } from '../../src/repositories/conversation.repository';
import {
  createMockClaudeService,
  createMockNotificationService
} from '../helpers/mocks';

describe('Server Integration', () => {
  let tempDir: string;
  let app: ReturnType<typeof createServer>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'todoist-test-'));
    const dataFile = join(tempDir, 'conversations.json');

    const conversationRepo = new ConversationRepository(dataFile);
    const claude = createMockClaudeService();
    const notifications = createMockNotificationService();
    const todoist = new TodoistService('test-token', 'AI');

    vi.mocked(claude.executePrompt).mockResolvedValue('Test response');

    const processor = new TaskProcessorService(
      claude,
      todoist,
      notifications,
      conversationRepo
    );

    const handler = new WebhookHandler(processor, todoist, conversationRepo);
    app = createServer(handler, 'test-secret', 9000);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should respond to health check', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('should accept webhook POST', async () => {
    const response = await request(app)
      .post('/webhook')
      .send({
        event_name: 'item:added',
        event_data: { id: '123', labels: ['AI'] }
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it('should reject invalid HMAC signature', async () => {
    const response = await request(app)
      .post('/webhook')
      .set('x-todoist-hmac-sha256', 'invalid-signature')
      .send({
        event_name: 'item:added',
        event_data: { id: '123' }
      });

    expect(response.status).toBe(403);
  });
});
```

**Step 2: Install supertest**

```bash
npm install --save-dev supertest @types/supertest
```

**Step 3: Run integration tests**

```bash
npm run test:integration
```

Expected: PASS

**Step 4: Commit**

```bash
git add tests/integration/server.integration.test.ts package.json package-lock.json
git commit -m "test: add server integration tests"
```

---

## Task 17: Update LaunchAgent Configuration

**Files:**
- Modify: `com.user.todoist-ai-agent.plist`

**Step 1: Update plist to use compiled TypeScript**

Edit `com.user.todoist-ai-agent.plist`:

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
    <string>/Users/viktor_svirskyi/Documents/Claude/todoist-ai-agent/dist/index.js</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/Users/viktor_svirskyi/Documents/Claude/todoist-ai-agent</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>TODOIST_API_TOKEN</key>
    <string>YOUR_TOKEN_HERE</string>
    <key>TODOIST_WEBHOOK_SECRET</key>
    <string>YOUR_SECRET_HERE</string>
    <key>PORT</key>
    <string>9000</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>/Users/viktor_svirskyi/Library/Logs/todoist-ai-agent.log</string>

  <key>StandardErrorPath</key>
  <string>/Users/viktor_svirskyi/Library/Logs/todoist-ai-agent.log</string>
</dict>
</plist>
```

**Step 2: Commit**

```bash
git add com.user.todoist-ai-agent.plist
git commit -m "chore: update LaunchAgent to use compiled TypeScript"
```

---

## Task 18: Migration and Validation

**Files:**
- Create: `scripts/validate.sh`

**Step 1: Create validation script**

Create `scripts/validate.sh`:

```bash
#!/bin/bash
set -e

echo "=== Todoist AI Agent Validation ==="

# Build TypeScript
echo "Building TypeScript..."
npm run build

# Run tests
echo "Running tests..."
npm run test:coverage

# Type check
echo "Type checking..."
npm run typecheck

# Lint
echo "Linting..."
npm run lint

echo "✅ All validation checks passed!"
```

**Step 2: Make executable**

```bash
chmod +x scripts/validate.sh
```

**Step 3: Run validation**

```bash
./scripts/validate.sh
```

Expected: All checks pass

**Step 4: Deploy**

```bash
# Build production
npm run build

# Stop old service
launchctl unload ~/Library/LaunchAgents/com.user.todoist-ai-agent.plist

# Load new service
launchctl load ~/Library/LaunchAgents/com.user.todoist-ai-agent.plist

# Check logs
tail -f ~/Library/Logs/todoist-ai-agent.log
```

**Step 5: Test with real task**

1. Create Todoist task with "AI" label
2. Wait for processing (check logs)
3. Verify comment posted
4. Verify notification sent to ntfy
5. Add comment to task
6. Verify agent responds

**Step 6: Commit**

```bash
git add scripts/validate.sh
git commit -m "chore: add validation script for deployment"
```

---

## Task 19: Cleanup Old JavaScript Files

**Files:**
- Delete: `server.js`, `poller.js`, `agent.js`, `todoist.js`, `store.js`, `register-webhook.js`

**Step 1: Verify service running with TypeScript**

```bash
# Check service status
launchctl list | grep todoist

# Check logs for successful startup
tail -20 ~/Library/Logs/todoist-ai-agent.log
```

Expected: Service running, no errors in logs

**Step 2: Run final tests**

```bash
npm run test:coverage
```

Expected: 80%+ coverage, all tests pass

**Step 3: Remove old JavaScript files**

```bash
rm server.js poller.js agent.js todoist.js store.js register-webhook.js
```

**Step 4: Update README**

Update `README.md` to reflect TypeScript structure:

```markdown
## Development

# Install dependencies
npm install

# Run tests
npm test

# Build TypeScript
npm run build

# Run in development mode
npm run dev

# Type check
npm run typecheck
```

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: remove old JavaScript files, update README"
```

**Step 6: Push to GitHub**

```bash
git push origin main
```

---

## Completion Checklist

- [ ] All 19 tasks completed
- [ ] Tests pass with 80%+ coverage
- [ ] TypeScript compilation successful
- [ ] Service running in production
- [ ] Webhooks working (tested with real task)
- [ ] Polling working (tested with comments)
- [ ] Notifications sent to ntfy
- [ ] No errors in logs for 48 hours
- [ ] Old JavaScript files removed
- [ ] Documentation updated

## Success Metrics

1. **Code Coverage**: 80%+ across all modules
2. **Type Safety**: Zero TypeScript errors
3. **Reliability**: Service uptime 99.9%
4. **Performance**: Comment processing < 30s average
5. **Maintainability**: New features can be added in isolated modules
