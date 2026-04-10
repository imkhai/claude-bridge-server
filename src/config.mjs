import { resolve } from 'path';

export const config = {
  BRIDGE_PORT: parseInt(process.env.BRIDGE_PORT, 10) || 3210,
  BIND_HOST: process.env.BIND_HOST || '127.0.0.1',
  API_KEY: process.env.API_KEY || '',
  MAX_PARALLEL: parseInt(process.env.MAX_PARALLEL, 10) || 4,
  TIMEOUT_MS: parseInt(process.env.TIMEOUT_MS, 10) || 600000,
  WORKSPACE: process.env.WORKSPACE || resolve(process.env.HOME, 'prod-data/bridge-data'),
  CLAUDE_PATH: process.env.CLAUDE_PATH || 'claude',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  // Default allowed tools for Claude CLI. Set to comma-separated list or "all" for full access.
  // Examples: "Read,Write,Edit,Bash,Glob,Grep" or "all"
  DEFAULT_ALLOWED_TOOLS: process.env.DEFAULT_ALLOWED_TOOLS || '',
  // Max agentic turns per task (0 = unlimited)
  DEFAULT_MAX_TURNS: parseInt(process.env.DEFAULT_MAX_TURNS, 10) || 0,
  // Queue limits
  MAX_QUEUE_SIZE: parseInt(process.env.MAX_QUEUE_SIZE, 10) || 1000,
  JOB_TTL_MS: parseInt(process.env.JOB_TTL_MS, 10) || 3600000, // 1 hour
  // Conversation memory
  SUMMARY_ENABLED: process.env.SUMMARY_ENABLED !== 'false',
  SUMMARY_MAX_CHARS: parseInt(process.env.SUMMARY_MAX_CHARS, 10) || 6000,
  SUMMARY_MAX_TURN_CHARS: parseInt(process.env.SUMMARY_MAX_TURN_CHARS, 10) || 3000,

  // Telegram Bot
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  TELEGRAM_WEBHOOK_URL: process.env.TELEGRAM_WEBHOOK_URL || '',
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET || '',
  TELEGRAM_NOTIFY_EVENTS: process.env.TELEGRAM_NOTIFY_EVENTS || 'task_done,task_error,task_timeout',
};
