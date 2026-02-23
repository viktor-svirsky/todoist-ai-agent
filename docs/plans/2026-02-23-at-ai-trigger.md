# @ai Comment Trigger Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the "AI" label trigger with `@ai` mention in any comment on any task.

**Architecture:** Remove all label-based webhook handlers (`item:added`, `item:updated`). Change `note:added` to trigger when the comment contains `@ai` (case-insensitive), stripping `@ai` before passing to Claude. Remove `hasAiLabel()` and all label config.

**Tech Stack:** TypeScript, Vitest, Node.js

---

### Task 1: Update types — remove label-based event names

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Update the `WebhookEvent` type**

Replace the current `event_name` union:
```typescript
// Before
event_name: 'item:added' | 'item:updated' | 'item:completed' | 'note:added';
event_data: {
  id?: string;
  item_id?: string;
  content?: string;
  labels?: string[];
  posted_uid?: string;
};

// After
event_name: 'item:completed' | 'note:added' | string;
event_data: {
  id?: string;
  item_id?: string;
  content?: string;
  labels?: string[];
  posted_uid?: string;
};
```

Using `| string` keeps the type open so unknown events pass through without TypeScript errors.

**Step 2: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

**Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "refactor: broaden WebhookEvent type for non-label triggers"
```

---

### Task 2: Remove AI_LABEL from constants and config

**Files:**
- Modify: `src/utils/constants.ts`
- Modify: `src/utils/config.ts`
- Modify: `tests/unit/utils/config.test.ts`

**Step 1: Read the config test to understand what to update**

```bash
cat tests/unit/utils/config.test.ts
```

**Step 2: Write failing test — config no longer has aiLabel**

In `tests/unit/utils/config.test.ts`, find any test that checks `config.aiLabel` and remove it. Add (or update) a test that verifies `aiLabel` is NOT a property of the returned config:

```typescript
it('should not include aiLabel', () => {
  // set required env vars
  process.env.TODOIST_API_TOKEN = 'tok';
  process.env.TODOIST_WEBHOOK_SECRET = 'sec';
  const config = getConfig();
  expect((config as any).aiLabel).toBeUndefined();
});
```

**Step 3: Run test to verify it fails**

```bash
npm run test:unit -- tests/unit/utils/config.test.ts
```
Expected: FAIL (aiLabel still exists)

**Step 4: Remove `AI_LABEL` from `src/utils/constants.ts`**

Delete this line:
```typescript
/** Default Todoist label for AI tasks (overridable via AI_LABEL env var) */
AI_LABEL: 'AI'
```

**Step 5: Remove `aiLabel` from `src/utils/config.ts`**

In `getConfig()`, remove:
```typescript
aiLabel: process.env.AI_LABEL || 'AI'
```

In the `Config` interface (in `src/types/index.ts`), remove:
```typescript
aiLabel: string;
```

**Step 6: Run tests**

```bash
npm run test:unit -- tests/unit/utils/config.test.ts
```
Expected: PASS

**Step 7: Commit**

```bash
git add src/utils/constants.ts src/utils/config.ts src/types/index.ts tests/unit/utils/config.test.ts
git commit -m "refactor: remove AI label config and constant"
```

---

### Task 3: Remove `hasAiLabel` from TodoistService

**Files:**
- Modify: `src/services/todoist.service.ts`
- Modify: `tests/unit/services/todoist.service.test.ts`
- Modify: `tests/helpers/mocks.ts`

**Step 1: Write failing tests — remove hasAiLabel tests, update constructor**

In `tests/unit/services/todoist.service.test.ts`:
- Change `new TodoistService('test-token', 'AI')` → `new TodoistService('test-token')`
- Delete the three `hasAiLabel` tests:
  - `'should return true if task has AI label'`
  - `'should return false if task does not have AI label'`
  - `'should return false when hasAiLabel fails to fetch task'`

**Step 2: Run tests to verify they fail**

```bash
npm run test:unit -- tests/unit/services/todoist.service.test.ts
```
Expected: FAIL (constructor still expects two args)

**Step 3: Update `src/services/todoist.service.ts`**

- Remove `aiLabel` constructor parameter
- Delete `hasAiLabel()` method entirely

```typescript
constructor(private readonly apiToken: string) {}
```

**Step 4: Update mock to remove `hasAiLabel`**

In `tests/helpers/mocks.ts`, remove `hasAiLabel: vi.fn()` from `createMockTodoistService()`.

**Step 5: Run tests**

```bash
npm run test:unit -- tests/unit/services/todoist.service.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add src/services/todoist.service.ts tests/unit/services/todoist.service.test.ts tests/helpers/mocks.ts
git commit -m "refactor: remove hasAiLabel from TodoistService"
```

---

### Task 4: Rewrite WebhookHandler for @ai trigger

**Files:**
- Modify: `src/handlers/webhook.handler.ts`
- Modify: `tests/unit/handlers/webhook.handler.test.ts`

**Step 1: Write the new failing tests**

Replace the entire content of `tests/unit/handlers/webhook.handler.test.ts` with:

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

  describe('note:added', () => {
    it('should process comment containing @ai', async () => {
      await handler.handleWebhook({
        event_name: 'note:added',
        event_data: { item_id: '123', content: '@ai what is the weather?', posted_uid: 'user-1' }
      });

      expect(processor.processComment).toHaveBeenCalledWith('123', 'what is the weather?');
    });

    it('should process comment with @ai in the middle', async () => {
      await handler.handleWebhook({
        event_name: 'note:added',
        event_data: { item_id: '123', content: 'hey @ai can you help?', posted_uid: 'user-1' }
      });

      expect(processor.processComment).toHaveBeenCalledWith('123', 'hey  can you help?');
    });

    it('should be case-insensitive for @AI', async () => {
      await handler.handleWebhook({
        event_name: 'note:added',
        event_data: { item_id: '123', content: '@AI help me', posted_uid: 'user-1' }
      });

      expect(processor.processComment).toHaveBeenCalledWith('123', 'help me');
    });

    it('should ignore comment without @ai', async () => {
      await handler.handleWebhook({
        event_name: 'note:added',
        event_data: { item_id: '123', content: 'just a regular comment', posted_uid: 'user-1' }
      });

      expect(processor.processComment).not.toHaveBeenCalled();
    });

    it('should ignore bot own comments', async () => {
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

    it('should ignore error prefix comments', async () => {
      await handler.handleWebhook({
        event_name: 'note:added',
        event_data: {
          item_id: '123',
          content: '⚠️ AI agent error: Something went wrong',
          posted_uid: 'user-1'
        }
      });

      expect(processor.processComment).not.toHaveBeenCalled();
    });

    it('should ignore note:added with missing fields', async () => {
      await handler.handleWebhook({
        event_name: 'note:added',
        event_data: {}
      });

      expect(processor.processComment).not.toHaveBeenCalled();
    });
  });

  describe('item:completed', () => {
    it('should handle item:completed for any task', async () => {
      await handler.handleWebhook({
        event_name: 'item:completed',
        event_data: { id: '123' }
      });

      expect(processor.handleTaskCompletion).toHaveBeenCalledWith('123');
    });

    it('should ignore item:completed with missing id', async () => {
      await handler.handleWebhook({
        event_name: 'item:completed',
        event_data: {}
      });

      expect(processor.handleTaskCompletion).not.toHaveBeenCalled();
    });
  });

  describe('unknown events', () => {
    it('should silently ignore unknown event types', async () => {
      await handler.handleWebhook({
        event_name: 'item:added',
        event_data: { id: '123', labels: ['AI'] }
      });

      expect(processor.processNewTask).not.toHaveBeenCalled();
      expect(processor.processComment).not.toHaveBeenCalled();
    });
  });

  it('should rethrow errors after logging', async () => {
    vi.mocked(processor.handleTaskCompletion).mockRejectedValue(new Error('DB Error'));

    await expect(handler.handleWebhook({
      event_name: 'item:completed',
      event_data: { id: '123' }
    })).rejects.toThrow('DB Error');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm run test:unit -- tests/unit/handlers/webhook.handler.test.ts
```
Expected: multiple FAILs

**Step 3: Rewrite `src/handlers/webhook.handler.ts`**

```typescript
import type { WebhookEvent } from '../types/index.js';
import type { TaskProcessorService } from '../services/task-processor.service.js';
import type { ConversationRepository } from '../repositories/conversation.repository.js';
import { CONSTANTS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

const AT_AI_PATTERN = /@ai\s*/gi;

export class WebhookHandler {
  constructor(
    private processor: TaskProcessorService,
    private _todoist: unknown,
    private _conversations: ConversationRepository
  ) {}

  async handleWebhook(event: WebhookEvent): Promise<void> {
    const { event_name, event_data } = event;

    try {
      if (event_name === 'note:added') {
        if (!event_data.item_id || !event_data.content) {
          logger.warn('Missing required fields in note:added event', { event_data });
          return;
        }
        const content = event_data.content;

        // Ignore bot's own comments
        if (content.startsWith(CONSTANTS.AI_INDICATOR)) return;
        if (content.startsWith(CONSTANTS.ERROR_PREFIX)) return;

        // Only trigger on @ai mention
        if (!AT_AI_PATTERN.test(content)) return;

        // Strip @ai from content before processing
        AT_AI_PATTERN.lastIndex = 0;
        const stripped = content.replace(AT_AI_PATTERN, '').trim();

        await this.processor.processComment(event_data.item_id, stripped);

      } else if (event_name === 'item:completed') {
        if (!event_data.id) {
          logger.warn('Missing id in item:completed event', { event_name });
          return;
        }
        await this.processor.handleTaskCompletion(event_data.id);
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

**Step 4: Run tests**

```bash
npm run test:unit -- tests/unit/handlers/webhook.handler.test.ts
```
Expected: all PASS

**Step 5: Commit**

```bash
git add src/handlers/webhook.handler.ts tests/unit/handlers/webhook.handler.test.ts
git commit -m "feat: trigger agent on @ai comment mention instead of AI label"
```

---

### Task 5: Update index.ts — remove aiLabel from TodoistService constructor

**Files:**
- Modify: `src/index.ts`

**Step 1: Update the constructor call**

Change:
```typescript
const todoistService = new TodoistService(config.todoistApiToken, config.aiLabel);
```
To:
```typescript
const todoistService = new TodoistService(config.todoistApiToken);
```

**Step 2: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

**Step 3: Run all tests**

```bash
npm test
```
Expected: all PASS

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "chore: remove aiLabel from TodoistService instantiation"
```

---

### Task 6: Build, restart, and verify end-to-end

**Step 1: Build**

```bash
npm run build
```
Expected: no errors

**Step 2: Restart the LaunchAgent**

```bash
launchctl kickstart -k gui/$(id -u)/com.user.todoist-ai-agent
```

**Step 3: Tail logs**

```bash
tail -f ~/Library/Logs/todoist-ai-agent.log
```

**Step 4: Verify**

Add a comment `@ai hello, are you working?` to any Todoist task. Confirm a reply appears as a comment within ~30 seconds.
