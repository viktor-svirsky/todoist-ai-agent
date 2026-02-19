# Gemini Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Gemini consultation to the Todoist AI agent using Playwright browser automation, with Claude synthesizing both perspectives into unified responses.

**Architecture:** AI Orchestrator pattern coordinates Claude and Gemini services. GeminiService uses Playwright MCP to interact with gemini.google.com/app. Sequential flow: Claude analyzes → Gemini consulted → Claude synthesizes. Graceful fallback to Claude-only if Gemini unavailable.

**Tech Stack:** TypeScript, Playwright MCP, Vitest

---

## Task 1: Add Playwright MCP Type Definitions

**Files:**
- Create: `src/types/playwright.types.ts`

**Step 1: Write type definitions for Playwright MCP client**

```typescript
// src/types/playwright.types.ts
export interface PlaywrightMCPClient {
  navigate(url: string): Promise<void>;
  waitForPageLoad(): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  waitForElement(selector: string, timeoutMs: number): Promise<void>;
  getTextContent(selector: string): Promise<string>;
}
```

**Step 2: Export from main types file**

Modify: `src/types/index.ts`

Add at the end:
```typescript
export * from './playwright.types.js';
```

**Step 3: Commit**

```bash
git add src/types/playwright.types.ts src/types/index.ts
git commit -m "feat: add Playwright MCP type definitions"
```

---

## Task 2: Implement GeminiService with Tests (TDD)

**Files:**
- Create: `tests/unit/services/gemini.service.test.ts`
- Create: `src/services/gemini.service.ts`

### Step 1: Write failing test for successful consultation

```typescript
// tests/unit/services/gemini.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiService } from '../../../src/services/gemini.service';
import type { PlaywrightMCPClient } from '../../../src/types/index';

describe('GeminiService', () => {
  let mockPlaywright: PlaywrightMCPClient;
  let geminiService: GeminiService;

  beforeEach(() => {
    mockPlaywright = {
      navigate: vi.fn().mockResolvedValue(undefined),
      waitForPageLoad: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
      pressKey: vi.fn().mockResolvedValue(undefined),
      waitForElement: vi.fn().mockResolvedValue(undefined),
      getTextContent: vi.fn().mockResolvedValue('This is Gemini\'s response')
    };
    geminiService = new GeminiService(mockPlaywright);
  });

  describe('consultGemini', () => {
    it('should navigate to Gemini and return response', async () => {
      const prompt = 'What is 2+2?';
      const response = await geminiService.consultGemini(prompt);

      expect(mockPlaywright.navigate).toHaveBeenCalledWith('https://gemini.google.com/app');
      expect(mockPlaywright.waitForPageLoad).toHaveBeenCalled();
      expect(mockPlaywright.type).toHaveBeenCalledWith(
        expect.stringContaining('textarea'),
        prompt
      );
      expect(mockPlaywright.pressKey).toHaveBeenCalledWith('Enter');
      expect(response).toBe('This is Gemini\'s response');
    });
  });
});
```

### Step 2: Run test to verify it fails

```bash
npm test tests/unit/services/gemini.service.test.ts
```

Expected: FAIL with "Cannot find module '../../../src/services/gemini.service'"

### Step 3: Write minimal GeminiService implementation

```typescript
// src/services/gemini.service.ts
import type { PlaywrightMCPClient } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class GeminiService {
  private readonly GEMINI_URL = 'https://gemini.google.com/app';
  private readonly TIMEOUT_MS = 60000;
  private readonly INPUT_SELECTOR = 'textarea[placeholder*="Enter a prompt"], textarea[aria-label*="prompt"]';
  private readonly RESPONSE_SELECTOR = '[data-test-id="model-response"], .model-response-text, [role="article"]:last-child';

  constructor(private playwright: PlaywrightMCPClient) {}

  async consultGemini(prompt: string): Promise<string> {
    logger.debug('Consulting Gemini', { promptLength: prompt.length });

    // Navigate to Gemini
    await this.playwright.navigate(this.GEMINI_URL);
    await this.playwright.waitForPageLoad();

    // Try to start fresh chat (optional, don't fail if button missing)
    try {
      await this.playwright.click('[aria-label="New chat"]');
    } catch {
      logger.debug('New chat button not found, using existing chat');
    }

    // Type prompt
    await this.playwright.waitForElement(this.INPUT_SELECTOR, 5000);
    await this.playwright.type(this.INPUT_SELECTOR, prompt);

    // Submit
    await this.playwright.pressKey('Enter');

    // Wait for and extract response
    await this.playwright.waitForElement(this.RESPONSE_SELECTOR, this.TIMEOUT_MS);
    const responseText = await this.playwright.getTextContent(this.RESPONSE_SELECTOR);

    if (!responseText || responseText.trim().length === 0) {
      throw new Error('Gemini returned empty response');
    }

    logger.debug('Gemini response received', { responseLength: responseText.length });
    return responseText.trim();
  }
}
```

### Step 4: Run test to verify it passes

```bash
npm test tests/unit/services/gemini.service.test.ts
```

Expected: PASS (1 test)

### Step 5: Add test for empty response handling

```typescript
// Add to tests/unit/services/gemini.service.test.ts inside describe('consultGemini')

it('should throw error when Gemini returns empty response', async () => {
  mockPlaywright.getTextContent = vi.fn().mockResolvedValue('');

  await expect(geminiService.consultGemini('test')).rejects.toThrow(
    'Gemini returned empty response'
  );
});
```

### Step 6: Run test to verify it passes

```bash
npm test tests/unit/services/gemini.service.test.ts
```

Expected: PASS (2 tests)

### Step 7: Add test for timeout handling

```typescript
// Add to tests/unit/services/gemini.service.test.ts inside describe('consultGemini')

it('should propagate timeout errors', async () => {
  mockPlaywright.waitForElement = vi.fn().mockRejectedValue(
    new Error('Timeout waiting for element')
  );

  await expect(geminiService.consultGemini('test')).rejects.toThrow('Timeout');
});
```

### Step 8: Run test to verify it passes

```bash
npm test tests/unit/services/gemini.service.test.ts
```

Expected: PASS (3 tests)

### Step 9: Add test() method with test

```typescript
// Add to tests/unit/services/gemini.service.test.ts

describe('test', () => {
  it('should return true when Gemini responds with OK', async () => {
    mockPlaywright.getTextContent = vi.fn().mockResolvedValue('OK');

    const result = await geminiService.test();

    expect(result).toBe(true);
    expect(mockPlaywright.type).toHaveBeenCalledWith(
      expect.any(String),
      'Respond with just the word OK'
    );
  });

  it('should return false when test fails', async () => {
    mockPlaywright.navigate = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await geminiService.test();

    expect(result).toBe(false);
  });
});
```

### Step 10: Implement test() method

```typescript
// Add to src/services/gemini.service.ts

async test(): Promise<boolean> {
  try {
    const response = await this.consultGemini('Respond with just the word OK');
    return response.toLowerCase().includes('ok');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Gemini test failed', { error: message });
    return false;
  }
}
```

### Step 11: Run all tests to verify they pass

```bash
npm test tests/unit/services/gemini.service.test.ts
```

Expected: PASS (5 tests)

### Step 12: Commit

```bash
git add src/services/gemini.service.ts tests/unit/services/gemini.service.test.ts
git commit -m "feat: add GeminiService with Playwright integration

- Navigate to gemini.google.com/app
- Send prompts and extract responses
- Handle timeouts and empty responses
- Validate connectivity with test() method"
```

---

## Task 3: Implement AIOrchestrator with Tests (TDD)

**Files:**
- Create: `tests/unit/services/ai-orchestrator.service.test.ts`
- Create: `src/services/ai-orchestrator.service.ts`

### Step 1: Write failing test for successful orchestration

```typescript
// tests/unit/services/ai-orchestrator.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIOrchestrator } from '../../../src/services/ai-orchestrator.service';
import type { ClaudeService } from '../../../src/services/claude.service';
import type { GeminiService } from '../../../src/services/gemini.service';
import type { TodoistTask, Message } from '../../../src/types/index';

describe('AIOrchestrator', () => {
  let mockClaude: ClaudeService;
  let mockGemini: GeminiService;
  let orchestrator: AIOrchestrator;

  const mockTask: TodoistTask = {
    id: '123',
    content: 'What is TypeScript?',
    description: 'Explain in simple terms',
    added_at: '2026-02-19T10:00:00Z'
  };

  const mockMessages: Message[] = [
    { role: 'user', content: 'Previous question' },
    { role: 'assistant', content: 'Previous answer' }
  ];

  beforeEach(() => {
    mockClaude = {
      buildPrompt: vi.fn().mockReturnValue('Claude prompt'),
      executePrompt: vi.fn()
        .mockResolvedValueOnce('Claude analysis: TypeScript is a typed superset of JavaScript')
        .mockResolvedValueOnce('Blended response: TypeScript adds static typing to JavaScript')
    } as any;

    mockGemini = {
      consultGemini: vi.fn().mockResolvedValue('Gemini opinion: TypeScript provides type safety')
    } as any;

    orchestrator = new AIOrchestrator(mockClaude, mockGemini);
  });

  describe('processTask', () => {
    it('should consult both Claude and Gemini, then synthesize', async () => {
      const result = await orchestrator.processTask(mockTask, mockMessages);

      // Verify Claude called first
      expect(mockClaude.buildPrompt).toHaveBeenCalledWith(mockTask, mockMessages);
      expect(mockClaude.executePrompt).toHaveBeenCalledWith('Claude prompt');

      // Verify Gemini consulted
      expect(mockGemini.consultGemini).toHaveBeenCalledWith(
        'What is TypeScript?\n\nExplain in simple terms'
      );

      // Verify synthesis
      expect(mockClaude.executePrompt).toHaveBeenCalledTimes(2);
      expect(result).toBe('Blended response: TypeScript adds static typing to JavaScript');
    });
  });
});
```

### Step 2: Run test to verify it fails

```bash
npm test tests/unit/services/ai-orchestrator.service.test.ts
```

Expected: FAIL with "Cannot find module '../../../src/services/ai-orchestrator.service'"

### Step 3: Write minimal AIOrchestrator implementation

```typescript
// src/services/ai-orchestrator.service.ts
import type { ClaudeService } from './claude.service.js';
import type { GeminiService } from './gemini.service.js';
import type { TodoistTask, Message } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class AIOrchestrator {
  constructor(
    private claude: ClaudeService,
    private gemini: GeminiService,
    private timeoutMs: number = 240000
  ) {}

  async processTask(task: TodoistTask, messages: Message[]): Promise<string> {
    logger.info('Processing task with AI orchestration', { taskId: task.id });

    // Step 1: Get Claude's initial analysis
    const claudePrompt = this.claude.buildPrompt(task, messages);
    const claudeAnalysis = await this.claude.executePrompt(claudePrompt);

    // Step 2: Consult Gemini
    let geminiOpinion: string | null = null;
    try {
      const geminiPrompt = this.buildGeminiPrompt(task);
      geminiOpinion = await this.gemini.consultGemini(geminiPrompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('Gemini consultation failed', { error: message });
    }

    // Step 3: Synthesize
    if (geminiOpinion) {
      return await this.synthesize(task.content, claudeAnalysis, geminiOpinion);
    } else {
      return claudeAnalysis + '\n\n_Note: Unable to consult second opinion_';
    }
  }

  private buildGeminiPrompt(task: TodoistTask): string {
    return [
      task.content,
      task.description ? `\n\n${task.description}` : ''
    ].join('');
  }

  private async synthesize(
    originalTask: string,
    claudeAnalysis: string,
    geminiOpinion: string
  ): Promise<string> {
    const synthesisPrompt = [
      `Task: "${originalTask}"`,
      ``,
      `Your analysis: ${claudeAnalysis}`,
      ``,
      `Another perspective: ${geminiOpinion}`,
      ``,
      `Blend these two perspectives into one cohesive response. Do not attribute which AI said what—just provide a unified answer that incorporates the best insights from both.`
    ].join('\n');

    return await this.claude.executePrompt(synthesisPrompt);
  }
}
```

### Step 4: Run test to verify it passes

```bash
npm test tests/unit/services/ai-orchestrator.service.test.ts
```

Expected: PASS (1 test)

### Step 5: Add test for Gemini failure fallback

```typescript
// Add to tests/unit/services/ai-orchestrator.service.test.ts inside describe('processTask')

it('should fallback to Claude-only when Gemini fails', async () => {
  mockGemini.consultGemini = vi.fn().mockRejectedValue(new Error('Gemini timeout'));

  const result = await orchestrator.processTask(mockTask, mockMessages);

  expect(mockClaude.executePrompt).toHaveBeenCalledTimes(1); // Only initial analysis
  expect(result).toContain('Claude analysis: TypeScript is a typed superset of JavaScript');
  expect(result).toContain('_Note: Unable to consult second opinion_');
});
```

### Step 6: Run test to verify it passes

```bash
npm test tests/unit/services/ai-orchestrator.service.test.ts
```

Expected: PASS (2 tests)

### Step 7: Add test for task without description

```typescript
// Add to tests/unit/services/ai-orchestrator.service.test.ts inside describe('processTask')

it('should handle tasks without description', async () => {
  const taskWithoutDesc: TodoistTask = {
    id: '456',
    content: 'Simple question',
    added_at: '2026-02-19T10:00:00Z'
  };

  await orchestrator.processTask(taskWithoutDesc, []);

  expect(mockGemini.consultGemini).toHaveBeenCalledWith('Simple question');
});
```

### Step 8: Run test to verify it passes

```bash
npm test tests/unit/services/ai-orchestrator.service.test.ts
```

Expected: PASS (3 tests)

### Step 9: Commit

```bash
git add src/services/ai-orchestrator.service.ts tests/unit/services/ai-orchestrator.service.test.ts
git commit -m "feat: add AIOrchestrator service

- Coordinates Claude and Gemini consultation
- Sequential flow: analyze → consult → synthesize
- Graceful fallback to Claude-only on Gemini failure
- Blends responses without attribution"
```

---

## Task 4: Integrate AIOrchestrator into TaskProcessor

**Files:**
- Modify: `src/services/task-processor.service.ts:1-130`
- Modify: `tests/unit/services/task-processor.service.test.ts` (if exists)

### Step 1: Add AIOrchestrator to TaskProcessor constructor

Modify `src/services/task-processor.service.ts`:

```typescript
// Add import at top
import type { AIOrchestrator } from './ai-orchestrator.service.js';

// Modify constructor
export class TaskProcessorService {
  constructor(
    private claude: ClaudeService,
    private todoist: TodoistService,
    private notifications: NotificationService,
    private conversations: ConversationRepository,
    private orchestrator: AIOrchestrator  // Add this
  ) {}
```

### Step 2: Replace Claude calls with Orchestrator in processNewTask

Modify `src/services/task-processor.service.ts` lines 29-30:

```typescript
// Before:
// const prompt = this.claude.buildPrompt(task, conv.messages);
// const response = await this.claude.executePrompt(prompt);

// After:
const response = await this.orchestrator.processTask(task, conv.messages);
```

### Step 3: Replace Claude calls with Orchestrator in processComment

Modify `src/services/task-processor.service.ts` lines 62-63:

```typescript
// Before:
// const prompt = this.claude.buildPrompt(task, conv.messages);
// const response = await this.claude.executePrompt(prompt);

// After:
const response = await this.orchestrator.processTask(task, conv.messages);
```

### Step 4: Run existing tests to verify changes

```bash
npm test tests/unit/services/task-processor.service.test.ts
```

Expected: Tests may fail if they mock ClaudeService directly. Update mocks to include orchestrator if needed.

### Step 5: Commit

```bash
git add src/services/task-processor.service.ts
git commit -m "refactor: integrate AIOrchestrator into TaskProcessor

Replace direct Claude calls with orchestrator.processTask()
to enable Gemini consultation for all AI tasks"
```

---

## Task 5: Wire Up Dependencies in Index/Server

**Files:**
- Modify: `src/index.ts` or `src/server.ts` (wherever services are instantiated)

### Step 1: Import new services

Add imports:

```typescript
import { GeminiService } from './services/gemini.service.js';
import { AIOrchestrator } from './services/ai-orchestrator.service.js';
```

### Step 2: Create Playwright MCP client mock/stub

For now, create a mock Playwright client until real MCP integration is added:

```typescript
// TODO: Replace with real Playwright MCP client
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

### Step 3: Instantiate GeminiService and AIOrchestrator

```typescript
const geminiService = new GeminiService(playwrightClient);
const aiOrchestrator = new AIOrchestrator(claudeService, geminiService);
```

### Step 4: Pass orchestrator to TaskProcessor

```typescript
const taskProcessor = new TaskProcessorService(
  claudeService,
  todoistService,
  notificationService,
  conversationRepository,
  aiOrchestrator  // Add this
);
```

### Step 5: Add startup validation

```typescript
// Validate Gemini integration on startup
(async () => {
  const isGeminiWorking = await geminiService.test();
  if (isGeminiWorking) {
    logger.info('✅ Gemini integration validated');
  } else {
    logger.warn('⚠️ Gemini integration unavailable, running Claude-only mode');
  }
})();
```

### Step 6: Run the app to test

```bash
npm run build
npm start
```

Expected: Server starts, logs Gemini integration status (likely unavailable until MCP configured)

### Step 7: Commit

```bash
git add src/index.ts src/server.ts
git commit -m "feat: wire up AIOrchestrator in dependency tree

- Instantiate GeminiService and AIOrchestrator
- Pass orchestrator to TaskProcessor
- Add startup validation for Gemini integration
- Mock Playwright client until MCP configured"
```

---

## Task 6: Add Playwright MCP Integration (Real Implementation)

**Files:**
- Create: `src/clients/playwright-mcp.client.ts`
- Modify: `src/index.ts` or `src/server.ts`

### Step 1: Research Playwright MCP client library

Check documentation or existing `.playwright-mcp` directory for MCP client usage.

Expected: Find client library or SDK to interact with Playwright MCP server.

### Step 2: Create Playwright MCP client wrapper

```typescript
// src/clients/playwright-mcp.client.ts
import type { PlaywrightMCPClient } from '../types/index.js';
// Import actual MCP client library here (TBD based on Step 1)

export function createPlaywrightMCPClient(): PlaywrightMCPClient {
  // TODO: Implement actual MCP client connection
  // This will depend on the MCP client library available

  return {
    async navigate(url: string): Promise<void> {
      // Implementation using MCP client
    },
    async waitForPageLoad(): Promise<void> {
      // Implementation
    },
    async click(selector: string): Promise<void> {
      // Implementation
    },
    async type(selector: string, text: string): Promise<void> {
      // Implementation
    },
    async pressKey(key: string): Promise<void> {
      // Implementation
    },
    async waitForElement(selector: string, timeoutMs: number): Promise<void> {
      // Implementation
    },
    async getTextContent(selector: string): Promise<string> {
      // Implementation
    }
  };
}
```

### Step 3: Replace mock client with real client

Modify `src/index.ts`:

```typescript
// Before:
// const playwrightClient: PlaywrightMCPClient = { ... mock ... };

// After:
import { createPlaywrightMCPClient } from './clients/playwright-mcp.client.js';

const playwrightClient = createPlaywrightMCPClient();
```

### Step 4: Test with real Gemini

Create a test task in Todoist labeled "AI" with content: "What is 2+2?"

Expected: Agent consults both Claude and Gemini, posts synthesized response

### Step 5: Commit

```bash
git add src/clients/playwright-mcp.client.ts src/index.ts
git commit -m "feat: integrate real Playwright MCP client

Replace mock client with actual MCP implementation
for browser automation with Gemini"
```

**Note:** Step 6 may require additional investigation into the Playwright MCP setup in `.playwright-mcp` directory.

---

## Task 7: Add Integration Test

**Files:**
- Create: `tests/integration/gemini-integration.test.ts`

### Step 1: Write integration test

```typescript
// tests/integration/gemini-integration.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { GeminiService } from '../../src/services/gemini.service';
import { createPlaywrightMCPClient } from '../../src/clients/playwright-mcp.client';

describe('Gemini Integration', () => {
  let geminiService: GeminiService;

  beforeAll(() => {
    const playwrightClient = createPlaywrightMCPClient();
    geminiService = new GeminiService(playwrightClient);
  });

  it('should successfully consult Gemini', async () => {
    const response = await geminiService.consultGemini('What is 2+2?');

    expect(response).toBeTruthy();
    expect(response.length).toBeGreaterThan(0);
    expect(response.toLowerCase()).toContain('4');
  }, 90000); // 90 second timeout

  it('should pass connectivity test', async () => {
    const result = await geminiService.test();

    expect(result).toBe(true);
  }, 90000);
});
```

### Step 2: Run integration test

```bash
npm run test:integration
```

Expected: PASS if Playwright MCP is configured and Gemini is logged in

### Step 3: Commit

```bash
git add tests/integration/gemini-integration.test.ts
git commit -m "test: add Gemini integration test

Validates real Playwright MCP connectivity
and Gemini consultation workflow"
```

---

## Task 8: Update Documentation

**Files:**
- Modify: `README.md`

### Step 1: Update Features section

Add to README.md features:

```markdown
- **Dual-AI consultation**: Every task gets analyzed by both Claude and Gemini for comprehensive responses
- **Browser automation**: Uses Playwright to interact with Gemini via web interface
```

### Step 2: Update Architecture diagram

Update the architecture section:

```markdown
## Architecture

\`\`\`
Primary: Todoist → webhook POST → Express (port 9000) → async job queue → Agent Loop → Todoist comment
                                                                              ↓
                                                                      AIOrchestrator
                                                                      ↙           ↘
                                                              Claude CLI    Gemini (Playwright)
                                                                  ↓               ↓
                                                          Todoist REST     gemini.google.com
\`\`\`
```

### Step 3: Add Gemini setup section

Add to README:

```markdown
### Gemini Setup

The agent requires Gemini to be logged in via browser for consultation:

1. Ensure Playwright MCP is configured and running
2. Navigate to `https://gemini.google.com/app` and log in
3. Keep the session active (the agent uses browser automation)
4. The agent will validate Gemini connectivity on startup

If Gemini is unavailable, the agent will automatically fall back to Claude-only mode with a note in responses.
```

### Step 4: Commit

```bash
git add README.md
git commit -m "docs: update README with Gemini integration

- Add dual-AI consultation to features
- Update architecture diagram
- Add Gemini setup instructions
- Document fallback behavior"
```

---

## Task 9: Final End-to-End Test

**Manual Testing Checklist:**

### Step 1: Verify startup

```bash
npm run build
npm start
```

Check logs for:
- ✅ Gemini integration validated (or ⚠️ warning if unavailable)
- Server listening on port 9000

### Step 2: Test with real Todoist task

1. Create task in Todoist: "Explain quantum computing in simple terms"
2. Add "AI" label
3. Wait for agent to process

Expected response:
- Contains explanation from both Claude and Gemini perspectives (blended)
- No attribution of which AI said what
- Comprehensive answer

### Step 3: Test Gemini fallback

1. Stop Playwright MCP or log out of Gemini
2. Create task: "What is Docker?"
3. Add "AI" label

Expected response:
- Contains Claude's analysis
- Includes: "_Note: Unable to consult second opinion_"

### Step 4: Test conversation continuity

1. Add comment to existing AI task: "Can you explain more?"
2. Wait for response

Expected:
- Response references previous conversation
- Still consults both AIs for new message

### Step 5: Verify all tests pass

```bash
npm test
```

Expected: All unit and integration tests pass

---

## Success Criteria

✅ All unit tests pass (85%+ coverage)
✅ Integration test validates Gemini connectivity
✅ Real Todoist task gets both Claude + Gemini perspectives
✅ Responses are blended without attribution
✅ Graceful fallback when Gemini unavailable
✅ Startup validation confirms Gemini status
✅ Documentation updated with new architecture

---

## Notes

- **Playwright MCP Setup**: Task 6 may require additional work depending on MCP client library availability
- **Gemini Selectors**: DOM selectors in GeminiService may need adjustment if Gemini UI changes
- **Error Handling**: All Gemini errors are caught and logged; agent never fails due to Gemini issues
- **Performance**: Total processing time increases from ~120s to ~240s max per task
- **TDD**: Each task follows Red-Green-Refactor cycle for quality assurance
