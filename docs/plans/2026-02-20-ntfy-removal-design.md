# Remove ntfy Integration — Design Doc

**Date:** 2026-02-20
**Status:** Approved

## Overview

Remove all ntfy notification integration from the Todoist AI Agent. The external notification system is no longer needed, and all related code (service, types, config, tests) will be completely removed.

## Motivation

The ntfy integration was originally added to provide external notifications when tasks were processed or errors occurred. This feature is no longer being used and adds unnecessary complexity to the codebase.

## Requirements

- Remove all notification-related code
- No replacement notification system needed
- Complete silence (no additional logging in place of notifications)
- Maintain all existing core functionality (task processing, comments, conversation storage)

## Approach

**Selected approach:** Complete atomic removal in a single PR

Remove all notification code in one cohesive change rather than incremental removal. This approach is preferred because:
- Notification code is well-isolated with clear boundaries
- Single PR is easier to review than multiple incremental changes
- No temporary or transitional code needed
- Safe to remove atomically without affecting core functionality

## Scope and Files Affected

### Files to Delete
- `src/services/notification.service.ts` - The NotificationService class
- `tests/unit/services/notification.service.test.ts` - Service tests

### Files to Modify
- `src/index.ts` - Remove NotificationService instantiation and dependency injection
- `src/services/task-processor.service.ts` - Remove notification calls and dependency
- `src/types/index.ts` - Remove NotificationPayload interface and ntfyWebhookUrl from Config
- `src/utils/config.ts` - Remove ntfyWebhookUrl from getConfig()
- `tests/unit/utils/config.test.ts` - Remove tests for NTFY_WEBHOOK_URL
- `.env.example` - Remove NTFY_WEBHOOK_URL reference (if exists)

### Dependencies
- `axios` remains in package.json (still needed for Todoist API calls)

**Total impact:** 2 deletions, 6-7 modifications

## Detailed Changes by Component

### TaskProcessorService
**File:** `src/services/task-processor.service.ts`

- Remove `private notifications: NotificationService` from constructor parameter
- Remove `await this.notifications.sendNotification(...)` calls from:
  - `processNewTask()` method (success notification)
  - `processComment()` method (success notification)
  - `handleError()` method (error notification)
- Remove NotificationService import

### Main Entry Point
**File:** `src/index.ts`

- Remove `import { NotificationService }` statement
- Remove `const notificationService = new NotificationService(config.ntfyWebhookUrl)` instantiation
- Remove `notificationService` parameter when constructing TaskProcessorService

### Type Definitions
**File:** `src/types/index.ts`

- Remove `NotificationPayload` interface
- Remove `ntfyWebhookUrl: string` from Config interface

### Configuration
**File:** `src/utils/config.ts`

- Remove `ntfyWebhookUrl` constant declaration
- Remove `ntfyWebhookUrl` from returned Config object

### Configuration Tests
**File:** `tests/unit/utils/config.test.ts`

- Remove `NTFY_WEBHOOK_URL` from test environment setup
- Remove ntfyWebhookUrl assertion from config test

## Testing and Verification

### Automated Tests
- `npm test` - All existing tests should pass
- `npm run typecheck` - TypeScript compilation succeeds with no errors
- `npm run build` - Clean build to dist/ with no import errors

### Verification Points
- Config loading works without ntfyWebhookUrl
- TaskProcessor tests pass without notification dependency
- No orphaned references to NotificationService or NotificationPayload
- No missing dependencies or import errors

### Expected Behavior
No behavioral changes to core functionality. The app will function identically, just without external notification HTTP calls. All task processing, comment handling, and conversation storage remain unchanged.

## Deployment Considerations

### Environment Variables
- `NTFY_WEBHOOK_URL` can be removed from `.env` (if present)
- No migration required - variable will be ignored after deployment
- Safe to deploy during normal operation

### Runtime Impact
- **Zero breaking changes** - Notifications were fire-and-forget
- **No error conditions introduced** - Core functionality unaffected
- **Performance:** Negligible improvement (removes non-blocking HTTP calls)

### Rollback Plan
- Revert the PR if ntfy integration needs restoration
- No data loss or corruption risk (notifications were optional/non-blocking)

### Documentation
- Historical design docs remain unchanged (they document past architecture)
- This design doc serves as removal documentation

## Implementation Plan

Implementation will be handled by the `writing-plans` skill, which will create a detailed step-by-step implementation plan with file-level changes.
