# Webhook-Only Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove polling fallback mechanism to rely exclusively on webhook-based event processing.

**Architecture:** Delete all polling-related files (poller.js, PollingHandler, tests), remove polling initialization from index.ts, and update documentation to reflect webhook-only operation. The agent will process events solely through Todoist webhooks hitting the Express endpoint.

**Tech Stack:** TypeScript, Express, Vitest (testing)

---

## Task 1: Delete Polling Handler

**Files:**
- Delete: `src/handlers/polling.handler.ts`
- Delete: `tests/unit/handlers/polling.handler.test.ts`

**Step 1: Remove polling handler source file**

```bash
rm src/handlers/polling.handler.ts
```

Expected: File deleted

**Step 2: Remove polling handler test file**

```bash
rm tests/unit/handlers/polling.handler.test.ts
```

Expected: File deleted

**Step 3: Verify files are deleted**

```bash
ls src/handlers/polling.handler.ts 2>&1
ls tests/unit/handlers/polling.handler.test.ts 2>&1
```

Expected: "No such file or directory" for both

**Step 4: Commit deletion**

```bash
git add -A
git commit -m "Remove polling handler and tests"
```

---

## Task 2: Delete Poller Module

**Files:**
- Delete: `src/poller.ts` (or `src/poller.js`)

**Step 1: Check if poller file exists**

```bash
ls src/poller.* 2>&1
```

Expected: Shows `src/poller.ts` or `src/poller.js`

**Step 2: Remove poller module**

```bash
rm src/poller.*
```

Expected: File(s) deleted

**Step 3: Verify deletion**

```bash
ls src/poller.* 2>&1
```

Expected: "No such file or directory"

**Step 4: Commit deletion**

```bash
git add -A
git commit -m "Remove poller module"
```

---

## Task 3: Update index.ts - Remove Imports

**Files:**
- Modify: `src/index.ts:1-11`

**Step 1: Read current index.ts**

```bash
head -20 src/index.ts
```

Expected: See imports including `startPoller` and `PollingHandler`

**Step 2: Remove polling imports**

Remove these two lines:
```typescript
import { startPoller } from './poller.js';
import { PollingHandler } from './handlers/polling.handler.js';
```

Result should be:
```typescript
import 'dotenv/config';
import { createServer } from './server.js';
import { WebhookHandler } from './handlers/webhook.handler.js';
import { TaskProcessorService } from './services/task-processor.service.js';
import { ClaudeService } from './services/claude.service.js';
import { TodoistService } from './services/todoist.service.js';
import { ConversationRepository } from './repositories/conversation.repository.js';
import { getConfig } from './utils/config.js';
import { logger } from './utils/logger.js';
```

**Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: May show errors about PollingHandler not being used (will fix next)

**Step 4: Commit import cleanup**

```bash
git add src/index.ts
git commit -m "Remove polling imports from index.ts"
```

---

## Task 4: Update index.ts - Remove PollingHandler Initialization

**Files:**
- Modify: `src/index.ts:35-40`

**Step 1: Read the main function**

```bash
sed -n '28,45p' src/index.ts
```

Expected: See WebhookHandler and PollingHandler initialization

**Step 2: Remove PollingHandler initialization block**

Remove lines 35-40:
```typescript
    const pollingHandler = new PollingHandler(
      taskProcessor,
      todoistService,
      conversationRepo,
      config.todoistApiToken
    );
```

**Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: May still show errors about startPoller (will fix next)

**Step 4: Commit handler cleanup**

```bash
git add src/index.ts
git commit -m "Remove PollingHandler initialization"
```

---

## Task 5: Update index.ts - Remove Poller Startup

**Files:**
- Modify: `src/index.ts:48-50`

**Step 1: Read server startup section**

```bash
sed -n '42,55p' src/index.ts
```

Expected: See startPoller call after app.listen

**Step 2: Remove poller startup lines**

Remove lines 48-50:
```typescript
    // Start poller
    startPoller(pollingHandler, config.pollIntervalMs);
    logger.info('Poller started', { intervalMs: config.pollIntervalMs });
```

Keep only:
```typescript
    logger.info('Todoist AI Agent started successfully');
```

**Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: SUCCESS - no TypeScript errors

**Step 4: Commit poller removal**

```bash
git add src/index.ts
git commit -m "Remove poller startup from main function"
```

---

## Task 6: Verify Tests Pass

**Files:**
- Test: All tests in `tests/`

**Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests PASS (polling tests already deleted)

**Step 2: Run typecheck again**

```bash
npm run typecheck
```

Expected: SUCCESS - no errors

**Step 3: Build the project**

```bash
npm run build
```

Expected: SUCCESS - dist/ regenerated without polling files

**Step 4: Verify dist structure**

```bash
ls -la dist/handlers/
```

Expected: Should see `webhook.handler.js` but NOT `polling.handler.js`

---

## Task 7: Update README - Features Section

**Files:**
- Modify: `README.md:7`

**Step 1: Read current features**

```bash
sed -n '1,15p' README.md
```

Expected: See "Dual-mode operation" in features

**Step 2: Update features section**

Change line 7 from:
```markdown
- **Dual-mode operation**: Webhook-based (real-time) + polling fallback (60s interval)
```

To:
```markdown
- **Webhook-based operation**: Real-time event processing from Todoist
```

**Step 3: Verify change**

```bash
sed -n '5,10p' README.md
```

Expected: See updated feature description

**Step 4: Commit README update**

```bash
git add README.md
git commit -m "Update README features - webhook-only operation"
```

---

## Task 8: Update README - Architecture Diagram

**Files:**
- Modify: `README.md:16-24`

**Step 1: Read current architecture section**

```bash
sed -n '14,25p' README.md
```

Expected: See both Primary and Fallback lines

**Step 2: Update architecture diagram**

Replace the architecture section (lines 16-24) with:
```markdown
## Architecture

```
Todoist → webhook POST → Express (port 9000) → async job queue → Agent Loop → Todoist comment
                                                                      ↓
                                                            Claude (via CLI)
                                                                      ↓
                                                               Todoist REST API
```
```

Remove the "Fallback: Polling..." line entirely.

**Step 3: Verify change**

```bash
sed -n '14,25p' README.md
```

Expected: See single-line architecture, no polling mention

**Step 4: Commit architecture update**

```bash
git add README.md
git commit -m "Update README architecture diagram - remove polling"
```

---

## Task 9: Update README - Remove Fault-Tolerant Reference

**Files:**
- Modify: `README.md:12`

**Step 1: Find fault-tolerant line**

```bash
grep -n "Fault-tolerant" README.md
```

Expected: Line 12 with "Fault-tolerant: Continues working even if webhooks fail to deliver"

**Step 2: Remove fault-tolerant line**

Delete line 12:
```markdown
- **Fault-tolerant**: Continues working even if webhooks fail to deliver
```

**Step 3: Verify removal**

```bash
grep -n "Fault-tolerant" README.md
```

Expected: No output (line deleted)

**Step 4: Commit feature cleanup**

```bash
git add README.md
git commit -m "Remove fault-tolerant feature from README"
```

---

## Task 10: Final Verification

**Files:**
- All project files

**Step 1: Search for polling references**

```bash
grep -r "polling" src/ --include="*.ts" --include="*.js" || echo "No polling references found"
```

Expected: "No polling references found"

**Step 2: Search for PollingHandler references**

```bash
grep -r "PollingHandler" . --include="*.ts" --include="*.md" --exclude-dir=node_modules --exclude-dir=dist || echo "No PollingHandler references found"
```

Expected: May find references in docs/plans/ (design docs) but NOT in src/

**Step 3: Run full test suite**

```bash
npm test
```

Expected: All tests PASS

**Step 4: Build and start server (manual verification)**

```bash
npm run build
npm start &
sleep 3
curl http://localhost:9000/health
kill %1
```

Expected: Server starts, health endpoint responds, no polling logs

**Step 5: Final commit (if any cleanup needed)**

```bash
git status
```

Expected: Working tree clean (all changes committed)

---

## Success Criteria

- ✅ All polling files deleted (`poller.ts`, `polling.handler.ts`, tests)
- ✅ No polling imports in `src/index.ts`
- ✅ No PollingHandler initialization in `src/index.ts`
- ✅ No poller startup in `src/index.ts`
- ✅ All tests pass (`npm test`)
- ✅ TypeScript compiles without errors (`npm run typecheck`)
- ✅ Build succeeds (`npm run build`)
- ✅ No polling references in active code
- ✅ README reflects webhook-only architecture
- ✅ Server starts successfully

---

## Rollback Plan

If issues arise:
```bash
git log --oneline -10
git revert <commit-hash>
```

All polling code preserved in git history before this implementation.
