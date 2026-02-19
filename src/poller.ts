import { PollingHandler } from './handlers/polling.handler';
import { logger } from './utils/logger';

export function startPoller(
  handler: PollingHandler,
  intervalMs: number
): NodeJS.Timeout {
  logger.info('Starting poller', { intervalMs });

  // Poll immediately
  handler.poll().catch(error => {
    logger.error('Initial poll failed', { error });
  });

  // Then poll on interval
  return setInterval(() => {
    handler.poll().catch(error => {
      logger.error('Poll failed', { error });
    });
  }, intervalMs);
}
