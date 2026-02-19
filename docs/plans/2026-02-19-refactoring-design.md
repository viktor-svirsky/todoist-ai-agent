# Todoist AI Agent - Refactoring Design

**Date:** 2026-02-19
**Status:** Approved
**Type:** Major Refactoring

## Overview

Comprehensive refactoring of the Todoist AI Agent to improve code organization, maintainability, and testability. Converting from JavaScript to TypeScript with full test coverage and adding webhook notifications for operation status.

## Goals

1. **Better Code Organization** - Clear module boundaries, separation of concerns
2. **Improved Maintainability** - Eliminate duplication, consistent patterns
3. **Add Testability** - Enable comprehensive unit and integration testing
4. **Type Safety** - Full TypeScript migration with strict mode
5. **New Feature** - Webhook notifications to ntfy on operation completion

## Architecture Approach

**Selected: Separate Services with Shared Core**

Maintain server and poller as separate concerns while extracting all shared logic into reusable services. This balances simplicity with maintainability and preserves the current dual-mode operation (webhooks + polling).

## File Structure

```
todoist-ai-agent/
├── src/
│   ├── services/
│   │   ├── task-processor.service.ts    # Core business logic
│   │   ├── notification.service.ts      # ntfy webhook sender
│   │   ├── claude.service.ts            # Claude CLI wrapper
│   │   └── todoist.service.ts           # Todoist REST API
│   ├── repositories/
│   │   └── conversation.repository.ts   # Data persistence layer
│   ├── handlers/
│   │   ├── webhook.handler.ts           # Webhook event processing
│   │   └── polling.handler.ts           # Polling logic
│   ├── utils/
│   │   ├── config.ts                    # Environment & constants
│   │   ├── logger.ts                    # Structured logging
│   │   └── constants.ts                 # Magic strings/numbers
│   ├── types/
│   │   └── index.ts                     # TypeScript interfaces
│   ├── server.ts                        # Express app entry point
│   ├── poller.ts                        # Polling service entry point
│   └── index.ts                         # Main orchestrator
├── tests/
│   ├── unit/
│   │   ├── services/
│   │   ├── handlers/
│   │   └── repositories/
│   ├── integration/
│   └── helpers/
│       ├── fixtures.ts
│       └── mocks.ts
├── dist/                                # Compiled JavaScript
├── data/
│   └── conversations.json               # Persisted state
├── docs/
│   └── plans/
├── tsconfig.json
├── vitest.config.ts
├── package.json
└── .env
```

## Key Principles

1. **Separation of Concerns**: Handlers orchestrate, services contain logic, repositories manage data
2. **Dependency Injection**: Services receive dependencies via constructors for testability
3. **Single Responsibility**: Each module has one clear purpose
4. **Type Safety**: Full TypeScript coverage with strict mode enabled
5. **Testability**: Pure functions, mockable dependencies, 80%+ coverage

## Core Components

### Services (Business Logic)

#### TaskProcessorService
```typescript
class TaskProcessorService {
  constructor(
    private claude: ClaudeService,
    private todoist: TodoistService,
    private notifications: NotificationService,
    private conversations: ConversationRepository
  ) {}

  async processNewTask(task: TodoistTask): Promise<void>
  async processComment(taskId: string, comment: string): Promise<void>
  async handleTaskCompletion(taskId: string): Promise<void>
}
```

**Responsibilities:**
- Orchestrate task/comment processing workflow
- Load conversation history from repository
- Call Claude service for AI responses
- Post responses to Todoist
- Send notifications to ntfy
- Update conversation store

#### ClaudeService
```typescript
class ClaudeService {
  async executePrompt(prompt: string, timeout?: number): Promise<string>
  buildPrompt(task: TodoistTask, messages: Message[]): string
}
```

**Responsibilities:**
- Wrap Claude CLI with correct flags (`--print`, `--no-session-persistence`, etc.)
- Build prompts from task context and conversation history
- Handle timeouts (120s) and spawn errors
- Return AI-generated responses

#### TodoistService
```typescript
class TodoistService {
  async getTask(taskId: string): Promise<TodoistTask>
  async postComment(taskId: string, content: string): Promise<void>
  async hasAiLabel(taskId: string): Promise<boolean>
}
```

**Responsibilities:**
- REST API client for Todoist
- Add AI indicator prefix (🤖 **AI Agent**) to all comments
- Implement retry logic for rate limits
- Handle network errors gracefully

#### NotificationService
```typescript
interface NotificationPayload {
  taskTitle: string;
  status: 'success' | 'error';
  message?: string;
  timestamp: string;
}

class NotificationService {
  async sendNotification(payload: NotificationPayload): Promise<void>
}
```

**Responsibilities:**
- POST to `https://ntfy.g-spot.workers.dev`
- Send notifications for both success and error cases
- Include task title, status, and timestamp
- Fail gracefully (log errors but don't throw)

### Handlers (Orchestration)

#### WebhookHandler
```typescript
class WebhookHandler {
  constructor(
    private processor: TaskProcessorService,
    private todoist: TodoistService,
    private config: Config
  ) {}

  async handleWebhook(event: WebhookEvent): Promise<void>
}
```

**Responsibilities:**
- Process webhook events: `item:added`, `item:updated`, `note:added`, `item:completed`
- Verify HMAC-SHA256 signatures
- Filter events for AI label
- Filter out bot's own comments (prevent loops)
- Delegate to TaskProcessorService
- Return 200 immediately, process asynchronously

#### PollingHandler
```typescript
class PollingHandler {
  constructor(
    private processor: TaskProcessorService,
    private todoist: TodoistService
  ) {}

  async poll(): Promise<void>
}
```

**Responsibilities:**
- Fetch AI-labeled tasks every 60 seconds
- Detect new comments on existing tasks
- Track processed comment IDs (prevent duplicates)
- Filter bot's own comments (by content prefix)
- Filter completed/deleted tasks
- Delegate to TaskProcessorService

### Repository (Data Access)

#### ConversationRepository
```typescript
class ConversationRepository {
  async load(taskId: string): Promise<Conversation>
  async save(taskId: string, conversation: Conversation): Promise<void>
  async exists(taskId: string): Promise<boolean>
  async cleanup(taskId: string): Promise<void>
  addMessage(conversation: Conversation, role: string, content: string): Conversation
}
```

**Responsibilities:**
- Persist conversations to `data/conversations.json`
- Load conversations by task ID
- Prune messages (keep first + last 19 messages)
- Check task existence
- Cleanup completed tasks
- Create data directory if missing

## Data Flow

### Webhook Flow
```
Todoist Webhook → Express (HMAC verify) → WebhookHandler
                                              ↓
                                    TaskProcessorService
                                    ↙     ↓      ↓     ↘
                    ConversationRepo  Claude  Todoist  Notification
                                              ↓
                                    Comment Posted + ntfy notified
```

### Polling Flow
```
setInterval(60s) → PollingHandler
                        ↓
                  Fetch AI tasks via TodoistService
                        ↓
                  Check for new comments (track IDs)
                        ↓
                  TaskProcessorService
                        ↓
                  (same as webhook flow)
```

### Shared Logic Extraction

**Before:**
- `server.js` has `handleNewTask()` and `handleComment()` (180 lines)
- `poller.js` has `processNewTask()` and `processNewComment()` (95 lines)
- Duplication: prompt building, agent calls, comment posting, error handling

**After:**
- Single `TaskProcessorService` with shared methods
- Both handlers call the same service
- Notification sending in one place
- Consistent error handling across both entry points

## Error Handling Strategy

### Error Types & Responses

#### Claude Service Errors
```typescript
// Timeout (120s)
→ Post comment: "⚠️ AI agent error: Request timed out"
→ Send notification: {status: 'error', message: 'Claude timeout'}
→ Log error with full context

// CLI spawn failure
→ Same as timeout with specific error message
→ No automatic retry (user can add comment to retry)
```

#### Todoist API Errors
```typescript
// Rate limit (429)
→ Exponential backoff: 5s, 10s, 20s
→ Max 3 retries
→ If all fail: log error, send notification, give up

// Network errors
→ Retry once after 5s
→ Log and notify on failure

// Invalid task ID (410)
→ Log warning, skip processing
→ No notification (invalid state)
```

#### Notification Service Errors
```typescript
// ntfy webhook fails
→ Log error but DON'T throw
→ Comment still gets posted (notification is secondary)
→ Graceful degradation
```

#### Repository Errors
```typescript
// File read/write errors
→ Throw error up to handler
→ Handler logs and posts error comment
→ Prevents silent data corruption
```

### Structured Logging

```typescript
logger.error('Failed to process task', {
  taskId: '123',
  error: err.message,
  stack: err.stack,
  component: 'TaskProcessorService',
  timestamp: new Date().toISOString()
});
```

**Log Levels:**
- `error`: Failures preventing operation
- `warn`: Recoverable issues (e.g., notification failed but comment posted)
- `info`: Successful operations
- `debug`: Detailed flow (disabled in production)

### Graceful Degradation

**Priority hierarchy:**
1. **Must succeed**: Post comment to Todoist (core functionality)
2. **Should succeed**: Save conversation history
3. **Nice to have**: Send notification to ntfy

Notification failures don't prevent comment posting. Conversation save failures are logged but don't block operations.

## Testing Strategy

### Coverage Goals

**Target: 80%+ code coverage** across:
- All services (business logic)
- All handlers (orchestration)
- Repository (data access)
- Utilities (config, logger)

### Test Structure

```
tests/
├── unit/
│   ├── services/
│   │   ├── task-processor.service.test.ts
│   │   ├── claude.service.test.ts
│   │   ├── todoist.service.test.ts
│   │   └── notification.service.test.ts
│   ├── handlers/
│   │   ├── webhook.handler.test.ts
│   │   └── polling.handler.test.ts
│   ├── repositories/
│   │   └── conversation.repository.test.ts
│   └── utils/
│       ├── config.test.ts
│       └── logger.test.ts
├── integration/
│   ├── server.integration.test.ts
│   ├── poller.integration.test.ts
│   └── task-processing.integration.test.ts
└── helpers/
    ├── fixtures.ts
    └── mocks.ts
```

### Key Test Scenarios

**TaskProcessorService:**
- ✅ Processes new task successfully
- ✅ Processes comment on existing task
- ✅ Handles task completion and cleanup
- ✅ Sends success notification with correct payload
- ✅ Sends error notification on failure
- ✅ Adds AI indicator to all comments
- ✅ Manages conversation history correctly
- ✅ Prunes messages when limit exceeded

**ClaudeService:**
- ✅ Builds correct prompts with task context
- ✅ Executes CLI with correct flags
- ✅ Handles timeout (120s) gracefully
- ✅ Handles spawn errors
- ✅ Returns trimmed response

**TodoistService:**
- ✅ Fetches tasks correctly
- ✅ Posts comments with AI indicator prefix
- ✅ Checks for AI label accurately
- ✅ Implements retry logic on rate limit
- ✅ Handles network errors
- ✅ Filters completed/deleted tasks

**NotificationService:**
- ✅ Sends success notification with task title and timestamp
- ✅ Sends error notification with error message
- ✅ Fails gracefully without throwing
- ✅ Formats payload correctly
- ✅ Handles network timeouts

**WebhookHandler:**
- ✅ Processes `item:added` events correctly
- ✅ Processes `item:updated` events (new AI label)
- ✅ Processes `note:added` events (comments)
- ✅ Processes `item:completed` events (cleanup)
- ✅ Filters tasks without AI label
- ✅ Verifies HMAC-SHA256 signatures
- ✅ Returns 200 immediately
- ✅ Processes asynchronously via job queue

**PollingHandler:**
- ✅ Fetches AI-labeled tasks only
- ✅ Detects new comments on existing tasks
- ✅ Filters bot's own comments (by prefix)
- ✅ Tracks processed comment IDs
- ✅ Prevents duplicate processing
- ✅ Skips completed/deleted tasks
- ✅ Processes comments chronologically

**ConversationRepository:**
- ✅ Loads conversations by task ID
- ✅ Saves conversations with timestamp
- ✅ Prunes messages (keeps first + last 19)
- ✅ Checks task existence
- ✅ Cleans up completed tasks
- ✅ Creates data directory if missing
- ✅ Handles corrupted JSON gracefully

### Mocking Strategy

**What we'll mock:**
- External API calls (Todoist REST API, ntfy webhook)
- Claude CLI spawn (use test fixtures for responses)
- File system operations (for deterministic tests)
- Time/dates (for timestamp consistency)
- Network requests (axios mock adapter)

**What we WON'T mock:**
- Internal service interactions (integration tests)
- Conversation repository logic (test actual file I/O)
- Error handling flows (test real error propagation)

### Test Utilities

```typescript
// tests/helpers/fixtures.ts
export const mockTask = (overrides?: Partial<TodoistTask>): TodoistTask
export const mockConversation = (): Conversation
export const mockComment = (): TodoistComment

// tests/helpers/mocks.ts
export const createMockClaudeService = (): ClaudeService
export const createMockTodoistService = (): TodoistService
export const createMockNotificationService = (): NotificationService
```

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage report
npm run test:coverage

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Watch mode during development
npm run test:watch

# Type checking
npm run typecheck
```

## Build & Deployment

### TypeScript Configuration

**`tsconfig.json`:**
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

### Build Scripts

**`package.json`:**
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

### Development Workflow

**During development:**
```bash
# Terminal 1: Watch TypeScript compilation
npm run build:watch

# Terminal 2: Run with auto-reload
npm run dev

# Terminal 3: Watch tests
npm run test:watch
```

### Migration Strategy (Zero Downtime)

**Phase 1: Preparation**
1. Build new TypeScript structure in `src/`
2. Write comprehensive tests (80%+ coverage)
3. Keep old `.js` files intact (no deletion yet)
4. Ensure all tests pass

**Phase 2: Validation**
```bash
# Build TypeScript to dist/
npm run build

# Verify compilation
npm run typecheck

# Run all tests
npm run test:coverage

# Test compiled version locally
NODE_ENV=test node dist/index.js
```

Verify locally:
- Server starts on port 9000
- Poller runs every 60 seconds
- Logs are structured correctly
- Test with mock webhook event

**Phase 3: Cutover**
1. Stop current service:
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.user.todoist-ai-agent.plist
   ```

2. Update `com.user.todoist-ai-agent.plist`:
   ```xml
   <!-- Change ProgramArguments from: -->
   <string>/Users/viktor_svirskyi/Documents/Claude/todoist-ai-agent/server.js</string>

   <!-- To: -->
   <string>/Users/viktor_svirskyi/Documents/Claude/todoist-ai-agent/dist/index.js</string>
   ```

3. Reload service:
   ```bash
   launchctl load ~/Library/LaunchAgents/com.user.todoist-ai-agent.plist
   ```

4. Monitor logs:
   ```bash
   tail -f ~/Library/Logs/todoist-ai-agent.log
   ```

5. Test with real AI-labeled task

**Phase 4: Validation Period**
- Monitor for 24-48 hours
- Check logs for errors
- Verify notifications working
- Test comment processing
- Confirm polling working

**Phase 5: Cleanup**
- Once validated, remove old `.js` files:
  ```bash
  rm server.js poller.js agent.js todoist.js store.js register-webhook.js
  ```
- Keep only TypeScript source in `src/`
- Update README.md with new structure

### Rollback Plan

If issues arise during cutover:

```bash
# Stop new service
launchctl unload ~/Library/LaunchAgents/com.user.todoist-ai-agent.plist

# Revert plist to old configuration
git checkout com.user.todoist-ai-agent.plist

# Restart old service
launchctl load ~/Library/LaunchAgents/com.user.todoist-ai-agent.plist

# Verify old service running
tail -f ~/Library/Logs/todoist-ai-agent.log
```

Old `.js` files remain until Phase 5, enabling instant rollback.

### New Dependencies

```json
{
  "devDependencies": {
    "@types/node": "^20.x",
    "@types/express": "^4.x",
    "@typescript-eslint/eslint-plugin": "^6.x",
    "@typescript-eslint/parser": "^6.x",
    "@vitest/coverage-v8": "^1.x",
    "eslint": "^8.x",
    "tsx": "^4.x",
    "typescript": "^5.x",
    "vitest": "^1.x"
  }
}
```

## Success Criteria

The refactoring will be considered successful when:

1. ✅ All tests pass with 80%+ coverage
2. ✅ TypeScript compilation succeeds with no errors
3. ✅ Service runs in production for 48 hours without issues
4. ✅ Webhook processing works correctly (verified with test tasks)
5. ✅ Polling detects and processes comments (verified with test tasks)
6. ✅ Notifications sent to ntfy for both success and error cases
7. ✅ No regressions in existing functionality
8. ✅ Code is more maintainable (measured by ease of adding features)
9. ✅ Clear module boundaries enable easy testing

## Future Enhancements

This refactoring sets the foundation for:

- **Database migration**: Replace JSON file with Upstash Redis or Neon PostgreSQL
- **Notification queue**: Retry failed ntfy webhooks
- **Multiple notification channels**: Slack, Discord, email
- **Analytics**: Track task processing metrics
- **Admin API**: Query conversation history, force cleanup
- **Horizontal scaling**: Multiple poller instances with distributed locking
- **WebSocket updates**: Real-time progress notifications

## References

- Original design: `docs/plans/2026-02-18-todoist-ai-agent-design.md`
- TypeScript Best Practices: https://www.typescriptlang.org/docs/handbook/
- Vitest Documentation: https://vitest.dev/
- Todoist REST API: https://developer.todoist.com/rest/v2/
