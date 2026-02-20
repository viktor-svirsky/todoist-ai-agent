import 'dotenv/config';
import { createServer } from './server.js';
import { startPoller } from './poller.js';
import { WebhookHandler } from './handlers/webhook.handler.js';
import { PollingHandler } from './handlers/polling.handler.js';
import { TaskProcessorService } from './services/task-processor.service.js';
import { ClaudeService } from './services/claude.service.js';
import { TodoistService } from './services/todoist.service.js';
import { NotificationService } from './services/notification.service.js';
import { ConversationRepository } from './repositories/conversation.repository.js';
import { GeminiService } from './services/gemini.service.js';
import { AIOrchestrator } from './services/ai-orchestrator.service.js';
import { getConfig } from './utils/config.js';
import { logger } from './utils/logger.js';
import type { PlaywrightMCPClient } from './types/playwright.types.js';

async function main() {
  try {
    const config = getConfig();

    // Initialize services
    const conversationRepo = new ConversationRepository('./data');
    const claudeService = new ClaudeService(config.claudeTimeoutMs);
    const todoistService = new TodoistService(config.todoistApiToken, config.aiLabel);
    const notificationService = new NotificationService(config.ntfyWebhookUrl);

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

    const geminiService = new GeminiService(playwrightClient);
    const aiOrchestrator = new AIOrchestrator(claudeService, geminiService);

    const taskProcessor = new TaskProcessorService(
      claudeService,
      todoistService,
      notificationService,
      conversationRepo,
      aiOrchestrator
    );

    // Initialize handlers
    const webhookHandler = new WebhookHandler(
      taskProcessor,
      todoistService,
      conversationRepo
    );

    const pollingHandler = new PollingHandler(
      taskProcessor,
      todoistService,
      conversationRepo,
      config.todoistApiToken
    );

    // Start server
    const app = createServer(webhookHandler, config.todoistWebhookSecret, config.port);
    app.listen(config.port, '0.0.0.0', () => {
      logger.info('Server listening', { port: config.port });
    });

    // Start poller
    startPoller(pollingHandler, config.pollIntervalMs);
    logger.info('Poller started', { intervalMs: config.pollIntervalMs });

    // Validate Gemini integration on startup
    (async () => {
      const isGeminiWorking = await geminiService.test();
      if (isGeminiWorking) {
        logger.info('✅ Gemini integration validated');
      } else {
        logger.warn('⚠️ Gemini integration unavailable, running Claude-only mode');
      }
    })();

    logger.info('Todoist AI Agent started successfully');
  } catch (error) {
    logger.error('Failed to start', { error });
    process.exit(1);
  }
}

main();
