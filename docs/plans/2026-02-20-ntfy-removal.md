# Remove ntfy Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Completely remove ntfy notification integration from the Todoist AI Agent codebase.

**Architecture:** Remove NotificationService and all dependencies in reverse order of initialization: remove usage from TaskProcessor → remove from main entry point → delete service and tests → clean up types and config.

**Tech Stack:** TypeScript, Vitest (testing), Express.js

---

## Task 1: Create Feature Branch

**Step 1: Create and checkout new branch**

```bash
cd /Users/viktor_svirskyi/Documents/Claude/todoist-ai-agent
git checkout -b remove-ntfy-integration
```

Expected: Switched to a new branch 'remove-ntfy-integration'

**Step 2: Verify clean working tree**

```bash
git status
```

Expected: "On branch remove-ntfy-integration" with no uncommitted changes

---

## Task 2: Verify Baseline Tests Pass

**Step 1: Run all tests**

```bash
npm test
```

Expected: All tests pass (baseline confirmation before changes)

**Step 2: Run type checking**

```bash
npm run typecheck
```

Expected: No TypeScript errors

---

## Task 3: Remove NotificationService from TaskProcessor

**Files:**
- Modify: `src/services/task-processor.service.ts`

**Step 1: Remove notification import**

Remove line 4:
```typescript
import type { NotificationService } from './notification.service.js';
```

**Step 2: Remove notifications from constructor**

In constructor (line 11-17), remove the `notifications` parameter:

Before:
```typescript
constructor(
  private claude: ClaudeService,
  private todoist: TodoistService,
  private notifications: NotificationService,
  private conversations: ConversationRepository,
  private orchestrator: AIOrchestrator
) {}
```

After:
```typescript
constructor(
  private claude: ClaudeService,
  private todoist: TodoistService,
  private conversations: ConversationRepository,
  private orchestrator: AIOrchestrator
) {}
```

**Step 3: Remove success notification from processNewTask**

Remove lines 37-41:
```typescript
await this.notifications.sendNotification({
  taskTitle: task.content,
  status: 'success',
  timestamp: new Date().toISOString()
});
```

**Step 4: Remove success notification from processComment**

Remove lines 69-73:
```typescript
await this.notifications.sendNotification({
  taskTitle: task.content,
  status: 'success',
  timestamp: new Date().toISOString()
});
```

**Step 5: Remove error notification from handleError**

Remove lines 120-125:
```typescript
await this.notifications.sendNotification({
  taskTitle,
  status: 'error',
  message,
  timestamp: new Date().toISOString()
});
```

Also remove the try-catch wrapper around the notification call (lines 119-128), keeping only the logger.error line.

After removal, the end of handleError should look like:
```typescript
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
}
```

**Step 6: Run type checking**

```bash
npm run typecheck
```

Expected: Should have errors about missing NotificationService in index.ts (expected - we'll fix next)

---

## Task 4: Remove NotificationService from Main Entry Point

**Files:**
- Modify: `src/index.ts`

**Step 1: Remove NotificationService import**

Remove line 9:
```typescript
import { NotificationService } from './services/notification.service.js';
```

**Step 2: Remove notificationService instantiation**

Remove line 25:
```typescript
const notificationService = new NotificationService(config.ntfyWebhookUrl);
```

**Step 3: Remove notificationService from TaskProcessorService constructor**

In the taskProcessor instantiation (lines 41-47), remove the `notificationService` parameter:

Before:
```typescript
const taskProcessor = new TaskProcessorService(
  claudeService,
  todoistService,
  notificationService,
  conversationRepo,
  aiOrchestrator
);
```

After:
```typescript
const taskProcessor = new TaskProcessorService(
  claudeService,
  todoistService,
  conversationRepo,
  aiOrchestrator
);
```

**Step 4: Run type checking**

```bash
npm run typecheck
```

Expected: Should still have errors about Config.ntfyWebhookUrl (expected - we'll fix in Task 6)

---

## Task 5: Delete NotificationService and Tests

**Files:**
- Delete: `src/services/notification.service.ts`
- Delete: `tests/unit/services/notification.service.test.ts`

**Step 1: Delete the service file**

```bash
rm src/services/notification.service.ts
```

Expected: File deleted

**Step 2: Delete the test file**

```bash
rm tests/unit/services/notification.service.test.ts
```

Expected: File deleted

**Step 3: Verify files deleted**

```bash
git status
```

Expected: Both files shown as deleted

---

## Task 6: Remove NotificationPayload Type and ntfyWebhookUrl from Config

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Remove NotificationPayload interface**

Remove lines 31-36:
```typescript
export interface NotificationPayload {
  taskTitle: string;
  status: 'success' | 'error';
  message?: string;
  timestamp: string;
}
```

**Step 2: Remove ntfyWebhookUrl from Config interface**

In the Config interface (lines 49-58), remove line 52:
```typescript
ntfyWebhookUrl: string;
```

After removal, Config should look like:
```typescript
export interface Config {
  todoistApiToken: string;
  todoistWebhookSecret: string;
  port: number;
  pollIntervalMs: number;
  claudeTimeoutMs: number;
  maxMessages: number;
  aiLabel: string;
}
```

**Step 3: Run type checking**

```bash
npm run typecheck
```

Expected: Should have error in config.ts about ntfyWebhookUrl (expected - we'll fix next)

---

## Task 7: Remove ntfyWebhookUrl from Config Implementation

**Files:**
- Modify: `src/utils/config.ts`

**Step 1: Remove ntfyWebhookUrl constant**

Remove line 20:
```typescript
const ntfyWebhookUrl = process.env.NTFY_WEBHOOK_URL || 'https://ntfy.g-spot.workers.dev';
```

**Step 2: Remove ntfyWebhookUrl from returned object**

In the return statement (lines 30-39), remove line 33:
```typescript
ntfyWebhookUrl,
```

After removal, the return should look like:
```typescript
return {
  todoistApiToken,
  todoistWebhookSecret,
  port: parseIntSafe(process.env.PORT, '9000', 'PORT', 1, 65535),
  pollIntervalMs: parseIntSafe(process.env.POLL_INTERVAL_MS, '60000', 'POLL_INTERVAL_MS', 1000),
  claudeTimeoutMs: parseIntSafe(process.env.CLAUDE_TIMEOUT_MS, '120000', 'CLAUDE_TIMEOUT_MS', 1000),
  maxMessages: parseIntSafe(process.env.MAX_MESSAGES, '20', 'MAX_MESSAGES', 1),
  aiLabel: process.env.AI_LABEL || 'AI'
};
```

**Step 3: Run type checking**

```bash
npm run typecheck
```

Expected: No errors (all type issues resolved)

---

## Task 8: Update Config Tests

**Files:**
- Modify: `tests/unit/utils/config.test.ts`

**Step 1: Remove NTFY_WEBHOOK_URL from test environment**

In the beforeEach hook (lines 8-15), remove line 12:
```typescript
NTFY_WEBHOOK_URL: 'https://test.example.com',
```

**Step 2: Remove ntfyWebhookUrl assertion**

In the first test "should load configuration from environment" (lines 21-28), remove line 26:
```typescript
expect(config.ntfyWebhookUrl).toBe('https://test.example.com');
```

**Step 3: Run config tests**

```bash
npm test tests/unit/utils/config.test.ts
```

Expected: All config tests pass

---

## Task 9: Run Full Test Suite

**Step 1: Run all unit tests**

```bash
npm test
```

Expected: All tests pass

**Step 2: Run type checking**

```bash
npm run typecheck
```

Expected: No TypeScript errors

**Step 3: Build the project**

```bash
npm run build
```

Expected: Build succeeds with no errors, outputs to dist/

---

## Task 10: Commit Changes

**Step 1: Review changes**

```bash
git status
```

Expected: Shows 4 modified files, 2 deleted files

**Step 2: Add all changes**

```bash
git add -A
```

**Step 3: Commit with descriptive message**

```bash
git commit -m "$(cat <<'EOF'
refactor: remove ntfy notification integration

Removes all ntfy-related code including:
- NotificationService class and tests
- Notification calls from TaskProcessorService
- ntfyWebhookUrl from config and types
- NotificationPayload type definition

The notification feature is no longer needed. Core functionality
(task processing, comments, conversation storage) is unaffected.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
EOF
)"
```

Expected: Commit created successfully

---

## Task 11: Create Pull Request

**Step 1: Push branch to remote**

```bash
git push -u origin remove-ntfy-integration
```

Expected: Branch pushed successfully

**Step 2: Create pull request**

```bash
gh pr create --title "Remove ntfy notification integration" --body "$(cat <<'EOF'
## Summary
- Removes NotificationService and all notification-related code
- Cleans up types, config, and tests
- No behavioral changes to core functionality

## Changes
- Deleted `NotificationService` class and tests
- Removed notification calls from `TaskProcessorService`
- Removed `ntfyWebhookUrl` from config
- Removed `NotificationPayload` type

## Testing
- ✅ All unit tests pass
- ✅ Type checking passes
- ✅ Build succeeds

## Design Doc
See `docs/plans/2026-02-20-ntfy-removal-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: Pull request created with URL returned

---

## Task 12: Verification

**Step 1: View the PR**

The PR URL will be displayed. Open it to review.

**Step 2: Verify CI/CD (if configured)**

If the repository has CI/CD configured, verify that automated checks pass.

**Step 3: Optional - Manual smoke test**

If desired, test the app locally:
```bash
npm run dev
```

Create a test task with "AI" label and verify it processes successfully without notification errors.

---

## Summary

**Files Modified:** 4
- `src/index.ts`
- `src/services/task-processor.service.ts`
- `src/types/index.ts`
- `src/utils/config.ts`
- `tests/unit/utils/config.test.ts`

**Files Deleted:** 2
- `src/services/notification.service.ts`
- `tests/unit/services/notification.service.test.ts`

**Total Tasks:** 12 bite-sized steps
**Estimated Time:** 20-30 minutes

**Testing Strategy:** Verify baseline → Remove incrementally → Verify after each change → Full test suite at end

**Deployment:** Zero breaking changes, safe to merge and deploy immediately after PR approval.
