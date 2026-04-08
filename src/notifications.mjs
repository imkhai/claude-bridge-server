import { onTimelineEvent } from './queue.mjs';
import { config } from './config.mjs';
import { logger } from './utils/logger.mjs';
import { getTelegram, sendMessage } from './telegram.mjs';

let unsubscribe = null;

export function initNotifications() {
  const bot = getTelegram();
  if (!bot || !config.TELEGRAM_CHAT_ID) {
    logger.debug('Notifications: disabled (no bot or no TELEGRAM_CHAT_ID)');
    return;
  }

  const allowedEvents = new Set(
    config.TELEGRAM_NOTIFY_EVENTS.split(',').map(s => s.trim()).filter(Boolean),
  );

  unsubscribe = onTimelineEvent(event => {
    if (!allowedEvents.has(event.type)) return;
    formatAndSend(event);
  });

  logger.info(`Notifications: enabled (events: ${[...allowedEvents].join(', ')})`);
}

export function shutdownNotifications() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

function formatAndSend(event) {
  const chatId = config.TELEGRAM_CHAT_ID;
  let text;

  switch (event.type) {
    case 'task_done': {
      const duration = event.duration ? `${(event.duration / 1000).toFixed(1)}s` : '?';
      text = `✅ Job Complete\nAgent: ${event.agentId || 'unknown'}\nTask: ${event.taskId?.slice(0, 8) || '?'}\nDuration: ${duration}`;
      if (event.chars) {
        text += `\nOutput: ${event.chars} chars`;
      }
      break;
    }

    case 'task_error':
      text = `❌ Job Error\nAgent: ${event.agentId || 'unknown'}\nTask: ${event.taskId?.slice(0, 8) || '?'}\nError: ${event.error || 'unknown'}`;
      break;

    case 'task_timeout':
      text = `⏰ Job Timeout\nAgent: ${event.agentId || 'unknown'}\nTask: ${event.taskId?.slice(0, 8) || '?'}\nError: ${event.error || 'timed out'}`;
      break;

    default:
      return;
  }

  sendMessage(chatId, text).catch(err => {
    logger.error(`Notification send failed: ${err.message}`);
  });
}
