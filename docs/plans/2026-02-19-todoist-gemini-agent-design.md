# Todoist AI Agent + Gemini Collaboration — Design Doc

**Date:** 2026-02-19
**Status:** Approved

## Overview

Enhance the existing Todoist AI agent to include Gemini collaboration via Playwright browser automation. For every AI-labeled task, Claude will analyze first, consult Gemini for a second perspective, then synthesize both viewpoints into a single cohesive response.

## Requirements Summary

### Collaboration Model
- **Sequential consultation**: Claude analyzes → Gemini consulted → Claude synthesizes
- **Trigger**: Every task labeled "AI" (no conditional logic)
- **Gemini interaction**: Fresh session per task via gemini.google.com/app
- **Context sharing**: Current message only (not full conversation history)
- **Response format**: Blended synthesis without explicit attribution
- **Error handling**: Explicit fallback note if Gemini consultation fails

### User Experience
- User sees one unified response (doesn't know two AIs were involved)
- If Gemini fails: response includes "_Note: Unable to consult second opinion_"
- No change to existing webhook/polling behavior

## Architecture

```
┌─────────────────────────────────────────────────┐
│          TaskProcessor (existing)               │
│  - Handles webhook/polling events               │
│  - Manages conversation history                 │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│          AIOrchestrator (new)                   │
│  - Coordinates Claude + Gemini consultation     │
│  - Handles synthesis logic                      │
│  - Manages error fallback                       │
└──────┬────────────────────────────────┬─────────┘
       │                                │
       ▼                                ▼
┌─────────────────┐          ┌──────────────────┐
│ ClaudeService   │          │ GeminiService    │
│  (existing)     │          │  (new)           │
│  - Spawns CLI   │          │  - Playwright    │
│  - Builds prompt│          │  - Web automation│
└─────────────────┘          └──────────────────┘
```

**Key design decision**: Use the Orchestrator pattern to coordinate Claude and Gemini without tight coupling. Each service has a single responsibility.

## Components

### `AIOrchestrator` (new service)

**File**: `src/services/ai-orchestrator.service.ts`

```typescript
export class AIOrchestrator {
  constructor(
    private claudeService: ClaudeService,
    private geminiService: GeminiService,
    private timeoutMs: number = 240000 // 4 minutes total
  ) {}

  /**
   * Process a task by consulting both Claude and Gemini, then synthesizing.
   * @param task - The Todoist task to process
   * @param messages - Conversation history
   * @returns Synthesized response from both AIs
   */
  async processTask(task: TodoistTask, messages: Message[]): Promise<string> {
    // 1. Get Claude's initial analysis
    const claudePrompt = this.claudeService.buildPrompt(task, messages);
    const claudeAnalysis = await this.claudeService.executePrompt(claudePrompt);

    // 2. Consult Gemini with current message only
    let geminiOpinion: string | null = null;
    try {
      const geminiPrompt = this.buildGeminiPrompt(task);
      geminiOpinion = await this.geminiService.consultGemini(geminiPrompt);
    } catch (error) {
      logger.warn('Gemini consultation failed', { error: error.message });
    }

    // 3. Synthesize both perspectives
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

    return await this.claudeService.executePrompt(synthesisPrompt);
  }
}
```

### `GeminiService` (new service)

**File**: `src/services/gemini.service.ts`

```typescript
export class GeminiService {
  private readonly GEMINI_URL = 'https://gemini.google.com/app';
  private readonly TIMEOUT_MS = 60000; // 60 seconds

  constructor(private playwrightClient: PlaywrightMCPClient) {}

  /**
   * Consult Gemini via Playwright browser automation.
   * @param prompt - The prompt to send to Gemini
   * @returns Gemini's response text
   * @throws Error if navigation, interaction, or extraction fails
   */
  async consultGemini(prompt: string): Promise<string> {
    // 1. Navigate to Gemini
    await this.playwrightClient.navigate(this.GEMINI_URL);
    await this.playwrightClient.waitForPageLoad();

    // 2. Start fresh chat (click "New chat" or clear input)
    try {
      await this.playwrightClient.click('[aria-label="New chat"]');
    } catch {
      // Fallback: just clear any existing input
      logger.debug('New chat button not found, using existing chat');
    }

    // 3. Type prompt into input field
    const inputSelector = 'textarea[placeholder*="Enter a prompt"], textarea[aria-label*="prompt"]';
    await this.playwrightClient.waitForElement(inputSelector, 5000);
    await this.playwrightClient.type(inputSelector, prompt);

    // 4. Submit (press Enter or click send button)
    await this.playwrightClient.pressKey('Enter');

    // 5. Wait for response to appear
    const responseSelector = '[data-test-id="model-response"], .model-response-text, [role="article"]:last-child';
    await this.playwrightClient.waitForElement(responseSelector, this.TIMEOUT_MS);

    // 6. Extract response text
    const responseText = await this.playwrightClient.getTextContent(responseSelector);

    if (!responseText || responseText.trim().length === 0) {
      throw new Error('Gemini returned empty response');
    }

    return responseText.trim();
  }

  /**
   * Test if Gemini integration is working (used on startup).
   */
  async test(): Promise<boolean> {
    try {
      const response = await this.consultGemini('Respond with just the word OK');
      return response.toLowerCase().includes('ok');
    } catch (error) {
      logger.error('Gemini test failed', { error: error.message });
      return false;
    }
  }
}
```

### `ClaudeService` (minor modification)

**File**: `src/services/claude.service.ts`

No changes to existing methods (`buildPrompt`, `executePrompt`). The synthesis happens via a second call to `executePrompt`, so no new method needed.

### `TaskProcessor` (minimal changes)

**File**: `src/services/task-processor.service.ts`

```typescript
// Before:
const prompt = this.claudeService.buildPrompt(task, messages);
const response = await this.claudeService.executePrompt(prompt);

// After:
const response = await this.aiOrchestrator.processTask(task, messages);
```

## Data Flow

### Complete Task Processing Flow

1. **Trigger**: Webhook or poller detects AI-labeled task
2. **TaskProcessor.processTask(taskId)**:
   - Fetch task from Todoist API
   - Load conversation history
   - Call `aiOrchestrator.processTask(task, messages)`
3. **AIOrchestrator.processTask()**:
   - Build Claude prompt (includes conversation history)
   - Execute Claude analysis (120s timeout)
   - Build Gemini prompt (current message only)
   - Try to consult Gemini (60s timeout)
   - If Gemini succeeds: synthesize both responses (60s timeout)
   - If Gemini fails: return Claude's response + fallback note
4. **TaskProcessor posts response**:
   - Post synthesized response as Todoist comment
   - Update conversation history

### Timeouts

| Operation | Timeout |
|-----------|---------|
| Claude initial analysis | 120s |
| Gemini consultation | 60s |
| Claude synthesis | 60s |
| **Total maximum** | ~240s |

## Error Handling & Edge Cases

### Gemini Consultation Failures

| Scenario | Detection | Action |
|----------|-----------|--------|
| Page doesn't load | Navigation timeout (10s) | Skip Gemini, use fallback note |
| Login session expired | Detect login page URL | Skip Gemini, log warning to re-login |
| "New chat" button missing | Element not found | Proceed without clicking it |
| Input field not found | Selector fails after 5s | Skip Gemini, log error |
| Response timeout | No response after 60s | Skip Gemini, use fallback note |
| DOM structure changed | Any selector fails | Skip Gemini, log for maintenance |
| Rate limiting detected | Check for "Try again" text | Skip Gemini, note in logs |
| Empty response | Response text is blank | Skip Gemini, log warning |

### Synthesis Failures

| Scenario | Action |
|----------|--------|
| Claude synthesis times out | Return Claude's original analysis + Gemini opinion unblended |
| Synthesis produces empty response | Return Claude's original analysis only |

### Playwright MCP Failures

| Scenario | Action |
|----------|--------|
| Playwright MCP not available | Detect on startup, disable Gemini integration |
| Browser crash mid-operation | Catch error, skip Gemini for this task |

### Graceful Degradation Strategy

```typescript
async processTask(task, messages): Promise<string> {
  try {
    // Step 1: Claude always runs
    const claudeAnalysis = await getClaudeAnalysis(task, messages);

    try {
      // Step 2: Gemini optional
      const geminiOpinion = await getGeminiOpinion(task);

      try {
        // Step 3: Synthesis optional
        return await synthesize(claudeAnalysis, geminiOpinion);
      } catch {
        // Synthesis failed, return both separately
        return `${claudeAnalysis}\n\n---\n\n${geminiOpinion}`;
      }
    } catch {
      // Gemini failed, Claude-only with note
      return `${claudeAnalysis}\n\n_Note: Unable to consult second opinion_`;
    }
  } catch {
    // Everything failed
    return '⚠️ AI agent error. Please try again.';
  }
}
```

## Testing Strategy

### Unit Tests

**`GeminiService.test.ts`** (mocked Playwright):
- `consultGemini()` returns response when successful
- `consultGemini()` throws timeout error after 60s
- `consultGemini()` handles missing DOM elements gracefully
- `consultGemini()` handles empty responses
- `test()` validates connectivity

**`AIOrchestrator.test.ts`** (mocked services):
- `processTask()` calls Claude → Gemini → synthesize in correct order
- `processTask()` falls back to Claude-only when Gemini fails
- `processTask()` includes fallback note when Gemini unavailable
- `processTask()` handles all service errors without crashing

### Integration Tests

**Playwright Integration** (real browser, mock Gemini page):
- Navigate to gemini.google.com/app successfully
- Find and interact with input field
- Extract response text from DOM

### Smoke Test on Startup

```typescript
async function validateGeminiIntegration(): Promise<void> {
  const isWorking = await geminiService.test();
  if (isWorking) {
    logger.info('✅ Gemini integration validated');
  } else {
    logger.warn('⚠️ Gemini integration unavailable, running Claude-only mode');
  }
}
```

### Manual Testing Checklist

- [ ] Create test task with "AI" label
- [ ] Verify Claude + Gemini both consulted
- [ ] Check response is properly synthesized
- [ ] Test with Playwright MCP disconnected (verify fallback)
- [ ] Test with Gemini logged out (verify fallback note)
- [ ] Test with slow Gemini response (verify timeout handling)

## Implementation Notes

### File Structure

New files to create:
```
src/services/
├── ai-orchestrator.service.ts  (new)
├── gemini.service.ts            (new)
├── claude.service.ts            (modify: minimal)
└── task-processor.service.ts   (modify: minimal)

tests/unit/services/
├── ai-orchestrator.test.ts     (new)
└── gemini.service.test.ts       (new)
```

### Playwright MCP Client

Assume Playwright MCP is already set up (`.playwright-mcp` directory exists). The `GeminiService` will use the existing MCP client library.

### Environment Variables

No new env vars needed. Uses existing:
- `ANTHROPIC_API_KEY` (for Claude)
- Playwright MCP configured via existing settings

### Deployment

- No changes to launchd configuration
- Agent will auto-detect Gemini availability on startup
- If Playwright MCP unavailable, agent runs Claude-only mode
- Logs will indicate Gemini integration status

### Performance Considerations

- Total task processing time increases from ~120s to ~240s max
- Gemini consultation runs sequentially (not parallel) to pass Claude's analysis context
- Conversation history still sent to Claude (not Gemini) to keep Gemini focused on current task

### Future Enhancements (Out of Scope)

- Parallel consultation (Claude and Gemini analyze simultaneously)
- Conditional Gemini consultation (only for certain task types)
- Multiple AI perspectives (add GPT-4, etc.)
- Gemini API integration (faster than browser automation)

## Success Criteria

✅ Every AI-labeled task gets both Claude and Gemini perspectives
✅ Responses are seamlessly blended (no attribution)
✅ Graceful fallback when Gemini unavailable
✅ Clear error messages in logs for debugging
✅ Existing agent functionality unaffected
✅ Startup validation confirms Gemini integration status
