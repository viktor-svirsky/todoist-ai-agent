# Todoist Webhook-Only Design

**Date:** 2026-02-20
**Status:** Approved
**Approach:** Test-First Cleanup (aggressive removal with automated verification)

## Overview

Remove the polling fallback mechanism from the Todoist AI Agent to rely exclusively on webhook-based event processing. This simplifies the codebase, improves performance by eliminating unnecessary API calls, and demonstrates trust in Todoist's webhook reliability.

## Goals

- Remove all polling-related code (poller, PollingHandler, tests)
- Rely exclusively on real-time webhook events from Todoist
- Simplify architecture to single event-processing mode
- Reduce API calls and server resource usage
- Maintain comprehensive test coverage for webhook handler

## Motivation

Three primary drivers:
1. **Simplicity** - Cleaner codebase, easier to maintain
2. **Trust in webhooks** - Webhooks are reliable enough; polling is unnecessary overhead
3. **Performance** - Reduce API calls and server resource usage

## Risk Acceptance

Webhook failures (network issues, Todoist downtime) will be handled manually. No fallback mechanism or automated monitoring will be implemented. This trade-off is acceptable given webhook reliability and the simplicity benefits.

## Architecture Changes

### Before (Dual-mode)
```
Primary:  Todoist → webhook → Express → WebhookHandler → TaskProcessor → Claude → Response
Fallback: Polling (60s) → PollingHandler → TaskProcessor → Claude → Response
```

### After (Webhook-only)
```
Todoist → webhook → Express → WebhookHandler → TaskProcessor → Claude → Response
```

The agent relies exclusively on real-time webhook events from Todoist. No polling, no fallback mechanism.

## Files to Delete

### Source Code
- `src/poller.js` (or `src/poller.ts`) - Polling interval loop
- `src/handlers/polling.handler.ts` - Polling event handler

### Tests
- `tests/unit/handlers/polling.handler.test.ts` - Polling handler tests

### Build Artifacts
- `dist/handlers/polling.handler.js` (and .map, .d.ts files) - Will be regenerated without polling on next build

### Files to Keep
- `src/handlers/webhook.handler.ts` - Core webhook handler (unchanged)
- All other services, repositories, and utilities

## Code Modifications

### `src/index.ts`

Remove the following:
- Line 3: `import { startPoller } from './poller.js';`
- Line 5: `import { PollingHandler } from './handlers/polling.handler.js';`
- Lines 35-40: `PollingHandler` initialization block
- Lines 48-50: `startPoller()` call and logging

**Result:** The main file will only initialize WebhookHandler and start the Express server.

No other files require changes since polling is isolated from the core task processing logic.

## Testing Strategy

### Automated Test Approach

1. **Review existing webhook tests** - Verify `tests/unit/handlers/webhook.handler.test.ts` covers:
   - Task creation with AI label triggers processing
   - Task updates trigger processing
   - Comment additions trigger conversation continuation
   - Non-AI tasks are ignored
   - HMAC signature verification works

2. **Run test suite** - Execute `npm test` to ensure:
   - All webhook handler tests pass
   - Task processor tests pass (unaffected by polling removal)
   - No broken imports or missing dependencies

3. **Type checking** - Run `npm run typecheck` to verify TypeScript compilation

4. **Build verification** - Run `npm run build` to ensure clean compilation

5. **Optional manual test** - Start server locally, use a test Todoist task to verify end-to-end webhook flow

### Success Criteria
- ✅ All tests pass
- ✅ TypeScript compiles without errors
- ✅ Server starts successfully
- ✅ No polling-related code remains

## Documentation Updates

### `README.md` Changes

1. **Features section (line 7)** - Change from:
   - "Dual-mode operation: Webhook-based (real-time) + polling fallback (60s interval)"

   To:
   - "Webhook-based operation: Real-time event processing from Todoist"

2. **Architecture diagram (lines 16-24)** - Remove the fallback line:
   ```
   Todoist → webhook POST → Express (port 9000) → async job queue → Agent Loop → Todoist comment
                                                                       ↓
                                                             Claude (via CLI)
                                                                       ↓
                                                                Todoist REST API
   ```

3. **Remove polling references** - Clean up any mentions of:
   - 60-second polling interval
   - Fault-tolerant fallback
   - Polling handler

## Implementation Steps

1. Delete polling files (`poller.js`, `polling.handler.ts`, `polling.handler.test.ts`)
2. Update `src/index.ts` to remove polling imports and initialization
3. Run `npm run typecheck` - verify TypeScript compilation
4. Run `npm test` - verify all tests pass
5. Run `npm run build` - regenerate dist/
6. Update `README.md` with new architecture and feature descriptions
7. Commit changes with message: "Remove polling fallback, webhook-only mode"

## Expected Outcomes

- ✅ Simpler codebase focused on webhook event processing
- ✅ ~500 lines of code removed (polling logic + tests)
- ✅ Reduced API calls (no 60-second polling)
- ✅ Lower server resource usage
- ✅ All tests pass
- ✅ TypeScript compilation succeeds

## Rollback Plan

All changes tracked in git. If webhook reliability becomes an issue, restore polling code from git history (commit before this change).

## Trade-offs

**Pros:**
- Cleaner, more maintainable codebase
- Better performance (no polling overhead)
- Simpler mental model (single event source)
- Reduced API rate limit usage

**Cons:**
- No automatic fallback if webhooks fail
- Manual intervention required for webhook delivery issues
- Complete dependency on Todoist webhook reliability

## Success Criteria

- TypeScript compiles without errors
- All webhook handler tests pass
- Server starts and responds to webhooks
- No references to polling remain in active code
- Documentation accurately reflects webhook-only architecture
