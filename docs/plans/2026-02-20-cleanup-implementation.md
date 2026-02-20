# Todoist AI Agent Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove GeminiService integration, design docs, and build artifacts to simplify the codebase.

**Architecture:** Simplify from dual-AI (Claude + Gemini via Playwright) to single-AI (Claude only). Remove incomplete browser automation features and associated orchestration layer.

**Tech Stack:** TypeScript, Node.js, Express, Todoist API, Claude CLI

---

## Task 1: Delete GeminiService

**Files:**
- Delete: `src/services/gemini.service.ts`

**Step 1: Verify file exists**

Run: `ls -la src/services/gemini.service.ts`
Expected: File exists (55 lines)

**Step 2: Delete GeminiService**

```bash
rm src/services/gemini.service.ts
```

**Step 3: Verify deletion**

Run: `ls src/services/gemini.service.ts`
Expected: "No such file or directory"

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove GeminiService integration"
```

---

## Task 2: Delete Playwright Types

**Files:**
- Delete: `src/types/playwright.types.ts`

**Step 1: Delete Playwright types**

```bash
rm src/types/playwright.types.ts
```

**Step 2: Verify deletion**

Run: `ls src/types/playwright.types.ts`
Expected: "No such file or directory"

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove Playwright type definitions"
```

---

## Task 3: Delete AIOrchestrator

**Files:**
- Delete: `src/services/ai-orchestrator.service.ts`

**Step 1: Delete AIOrchestrator**

```bash
rm src/services/ai-orchestrator.service.ts
```

**Step 2: Verify deletion**

Run: `ls src/services/ai-orchestrator.service.ts`
Expected: "No such file or directory"

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove AIOrchestrator service"
```

---

## Task 4: Update src/index.ts

**Files:**
- Modify: `src/index.ts:10-14,26-37,70-78`

**Step 1: Read current file**

Run: `cat src/index.ts`
Expected: File contains GeminiService, AIOrchestrator, PlaywrightMCPClient imports

**Step 2: Remove imports**

Remove these lines from top of file:

```typescript
import { GeminiService } from './services/gemini.service.js';
import { AIOrchestrator } from './services/ai-orchestrator.service.js';
import type { PlaywrightMCPClient } from './types/playwright.types.js';
```

**Step 3: Remove Playwright mock client**

Remove lines 26-34 (the entire playwrightClient object):

```typescript
// DELETE THIS:
const playwrightClient: PlaywrightMCPClient = {
  navigate: async () => { throw new Error('Playwright MCP not configured'); },
  waitForPageLoad: async () => {},
  click: async () => {},
  type: async () => {},
  pressKey: async () => {},
  waitForElement: async () => {},
  getTextContent: async () => { throw new Error('Playwright MCP not configured'); }
};
```

**Step 4: Remove GeminiService and AIOrchestrator initialization**

Remove these lines:

```typescript
// DELETE THIS:
const geminiService = new GeminiService(playwrightClient);
const aiOrchestrator = new AIOrchestrator(claudeService, geminiService);
```

**Step 5: Update TaskProcessorService initialization**

Change from:

```typescript
const taskProcessor = new TaskProcessorService(
  claudeService,
  todoistService,
  conversationRepo,
  aiOrchestrator
);
```

To:

```typescript
const taskProcessor = new TaskProcessorService(
  claudeService,
  todoistService,
  conversationRepo
);
```

**Step 6: Remove Gemini validation test**

Remove lines 70-78 (the async IIFE that tests Gemini):

```typescript
// DELETE THIS:
(async () => {
  const isGeminiWorking = await geminiService.test();
  if (isGeminiWorking) {
    logger.info('✅ Gemini integration validated');
  } else {
    logger.warn('⚠️ Gemini integration unavailable, running Claude-only mode');
  }
})();
```

**Step 7: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: May fail with type errors in task-processor.service.ts (will fix in next task)

**Step 8: Commit**

```bash
git add src/index.ts
git commit -m "refactor: remove GeminiService/AIOrchestrator from main entry point"
```

---

## Task 5: Update TaskProcessorService

**Files:**
- Modify: `src/services/task-processor.service.ts`

**Step 1: Read current file**

Run: `cat src/services/task-processor.service.ts`
Expected: File contains AIOrchestrator in constructor

**Step 2: Read the file to understand current implementation**

Before making changes, we need to see the current code structure to update it properly.

**Step 3: Remove AIOrchestrator from constructor**

Find the constructor (likely around line 10-20) and remove the `aiOrchestrator` parameter:

Change from:
```typescript
constructor(
  private claudeService: ClaudeService,
  private todoistService: TodoistService,
  private conversationRepo: ConversationRepository,
  private aiOrchestrator: AIOrchestrator
) {}
```

To:
```typescript
constructor(
  private claudeService: ClaudeService,
  private todoistService: TodoistService,
  private conversationRepo: ConversationRepository
) {}
```

**Step 4: Remove AIOrchestrator import**

Remove this import from top of file:
```typescript
import type { AIOrchestrator } from './ai-orchestrator.service.js';
```

**Step 5: Update process method to use Claude directly**

Find where `aiOrchestrator.processTask()` is called and replace with direct Claude usage.

Change from:
```typescript
const response = await this.aiOrchestrator.processTask(task, messages);
```

To:
```typescript
const prompt = this.claudeService.buildPrompt(task, messages);
const response = await this.claudeService.executePrompt(prompt);
```

**Step 6: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: SUCCESS - no type errors

**Step 7: Commit**

```bash
git add src/services/task-processor.service.ts
git commit -m "refactor: simplify TaskProcessor to use Claude directly"
```

---

## Task 6: Delete Design Documentation

**Files:**
- Delete: `docs/plans/` (entire directory)

**Step 1: List current design docs**

Run: `ls -la docs/plans/`
Expected: Shows 9 files (8 old + 1 new cleanup design)

**Step 2: Keep only the cleanup design doc**

```bash
cd docs/plans
# Save cleanup design temporarily
cp 2026-02-20-todoist-cleanup-design.md /tmp/cleanup-design.md
# Delete all files
rm *.md
# Restore cleanup design
mv /tmp/cleanup-design.md 2026-02-20-todoist-cleanup-design.md
cd ../..
```

**Step 3: Verify only cleanup design remains**

Run: `ls docs/plans/`
Expected: Only `2026-02-20-todoist-cleanup-design.md` and this implementation plan

**Step 4: Actually, delete ALL including cleanup design per user request**

```bash
rm docs/plans/2026-02-18-todoist-ai-agent-design.md
rm docs/plans/2026-02-18-todoist-ai-agent-implementation.md
rm docs/plans/2026-02-19-gemini-integration.md
rm docs/plans/2026-02-19-refactoring-design.md
rm docs/plans/2026-02-19-todoist-gemini-agent-design.md
rm docs/plans/2026-02-19-typescript-refactoring.md
rm docs/plans/2026-02-20-ntfy-removal-design.md
rm docs/plans/2026-02-20-ntfy-removal.md
```

**Step 5: Commit**

```bash
git add -A
git commit -m "docs: remove old design documentation"
```

---

## Task 7: Delete Build Artifacts

**Files:**
- Delete: `dist/` (entire directory)

**Step 1: Check dist size**

Run: `du -sh dist/`
Expected: ~268K

**Step 2: Delete dist directory**

```bash
rm -rf dist/
```

**Step 3: Verify deletion**

Run: `ls dist/`
Expected: "No such file or directory"

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove compiled build artifacts"
```

---

## Task 8: Delete Old Worktree

**Files:**
- Delete: `.worktrees/typescript-refactoring/`

**Step 1: Check worktree size**

Run: `du -sh .worktrees/typescript-refactoring/`
Expected: ~640K

**Step 2: Remove git worktree properly**

```bash
git worktree remove .worktrees/typescript-refactoring
```

**Step 3: Clean up worktree directory if it still exists**

```bash
rm -rf .worktrees/
```

**Step 4: Verify deletion**

Run: `ls .worktrees/`
Expected: "No such file or directory"

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove old worktree directory"
```

---

## Task 9: Run All Tests

**Files:**
- Verify: All test files

**Step 1: Run type checking**

Run: `npm run typecheck`
Expected: SUCCESS - no type errors

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Run linter**

Run: `npm run lint`
Expected: No linting errors

**Step 4: If any test failures, investigate and fix**

Check test output for failures related to:
- GeminiService references
- AIOrchestrator references
- Missing imports

Fix by updating test files to remove references to deleted services.

---

## Task 10: Rebuild and Verify Server

**Files:**
- Create: `dist/` (regenerated)

**Step 1: Clean build**

Run: `npm run build`
Expected: TypeScript compiles successfully, dist/ directory created

**Step 2: Verify dist structure**

Run: `ls -la dist/`
Expected: Directory exists with compiled .js and .d.ts files

**Step 3: Start server in test mode**

Run: `npm start &`
Wait 3 seconds, then:
Run: `curl http://localhost:9000/health`
Expected: HTTP 200 response

**Step 4: Stop test server**

Run: `pkill -f "node dist/index.js"`

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: rebuild after cleanup"
```

---

## Task 11: Final Verification

**Step 1: Check git status**

Run: `git status`
Expected: Working tree clean

**Step 2: Review commit log**

Run: `git log --oneline -12`
Expected: See all cleanup commits

**Step 3: Verify file structure**

Run: `find src -name "*.ts" | grep -E "(gemini|playwright|orchestrator)"`
Expected: No matches (all removed)

**Step 4: Check project size reduction**

Run: `du -sh . --exclude=node_modules`
Expected: Reduced by ~1-2MB

---

## Success Criteria

- ✅ TypeScript compiles without errors (`npm run typecheck`)
- ✅ All tests pass (`npm test`)
- ✅ Linter passes (`npm run lint`)
- ✅ Server starts successfully
- ✅ Health endpoint responds
- ✅ No references to GeminiService, AIOrchestrator, or Playwright types
- ✅ All specified files and directories deleted
- ✅ LaunchAgent plist file preserved
- ✅ All changes committed to git

## Rollback Plan

If any issues arise:

```bash
git log --oneline -12  # Find commit before cleanup
git revert <commit-hash>..HEAD  # Revert all cleanup commits
```
