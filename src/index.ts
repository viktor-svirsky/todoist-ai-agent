import 'dotenv/config';
import { createServer } from './server.js';
import { WebhookHandler } from './handlers/webhook.handler.js';
import { TaskProcessorService } from './services/task-processor.service.js';
import { ClaudeService } from './services/claude.service.js';
import { TodoistService } from './services/todoist.service.js';
import { ConversationRepository } from './repositories/conversation.repository.js';
import { getConfig } from './utils/config.js';
import { logger } from './utils/logger.js';

async function main() {
  try {
    const config = getConfig();

    // Initialize services
    const conversationRepo = new ConversationRepository('./data');
    const claudeService = new ClaudeService(config.claudeTimeoutMs);
    const todoistService = new TodoistService(config.todoistApiToken, config.aiLabel);

    const taskProcessor = new TaskProcessorService(
      claudeService,
      todoistService,
      conversationRepo
    );

    // Initialize handlers
    const webhookHandler = new WebhookHandler(
      taskProcessor,
      todoistService,
      conversationRepo
    );

    // Start server
    const app = createServer(webhookHandler, config.todoistWebhookSecret, config.port);
    app.listen(config.port, '0.0.0.0', () => {
      logger.info('Server listening', { port: config.port });
    });

    logger.info('Todoist AI Agent started successfully');
  } catch (error) {
    logger.error('Failed to start', { error });
    process.exit(1);
  }
}

main();
