# Todoist AI Agent Cleanup Design

**Date:** 2026-02-20
**Status:** Approved
**Approach:** Aggressive cleanup (one-shot removal)

## Overview

Remove unnecessary files, incomplete features, and build artifacts from the todoist-ai-agent project to simplify the codebase and focus on core Claude-based functionality.

## Goals

- Remove incomplete GeminiService integration (not functional without Playwright MCP)
- Delete all design/plan documentation
- Clean up build artifacts and old worktrees
- Simplify architecture back to single-AI (Claude only)
- Maintain LaunchAgent configuration for macOS auto-start

## Architecture Changes

### Before
```
TaskProcessor → AIOrchestrator → Claude + Gemini (via Playwright)
```

### After
```
TaskProcessor → Claude (direct)
```

The dual-AI consultation pattern is removed. The app returns to single-AI mode using Claude Sonnet 4.5 directly.

## Files to Delete

### Source Code
- `src/services/gemini.service.ts` - Browser automation for Gemini
- `src/services/ai-orchestrator.service.ts` - Multi-AI coordination
- `src/types/playwright.types.ts` - Playwright type definitions

### Documentation
- `docs/plans/` - Entire directory (all 8 design docs)

### Build Artifacts
- `dist/` - Compiled JavaScript (regenerated on build)
- `.worktrees/typescript-refactoring/` - Old git worktree

### Files to Keep
- `com.user.todoist-ai-agent.plist` - LaunchAgent config for macOS

## Code Modifications

### `src/index.ts`
Remove:
- Imports: `GeminiService`, `AIOrchestrator`, `PlaywrightMCPClient`
- Mock Playwright client setup (lines 26-34)
- `geminiService` and `aiOrchestrator` initialization (lines 36-37)
- Gemini validation test (lines 70-78)
- `aiOrchestrator` parameter from `TaskProcessorService` constructor

### `src/services/task-processor.service.ts`
Remove:
- `AIOrchestrator` from constructor parameters
- Change task processing to call `claudeService` directly

No other files require changes.

## Verification Steps

1. Delete all specified files and directories
2. Update code to remove GeminiService references
3. Run `npm run typecheck` - verify TypeScript compilation
4. Run `npm run build` - regenerate dist/
5. Run `npm test` - verify all tests pass
6. Manual test: start server, verify webhook endpoint works

## Expected Outcomes

- ✅ Simpler codebase focused on core functionality
- ✅ ~1MB of unnecessary files removed
- ✅ No breaking changes to existing Claude integration
- ✅ All tests pass
- ✅ TypeScript compilation succeeds

## Rollback Plan

All changes tracked in git. If issues arise, revert the cleanup commit.

## Trade-offs

**Pros:**
- Cleaner, more maintainable codebase
- Removes incomplete/non-functional features
- Easier for others to understand the project
- Faster builds (no dist/ in git)

**Cons:**
- Design docs not easily accessible (must check git history)
- dist/ must be rebuilt before running
- Cannot easily recover deleted code (must use git)

## Success Criteria

- TypeScript compiles without errors
- All existing tests pass
- Server starts and responds to webhooks
- No references to Gemini/Playwright remain in active code
