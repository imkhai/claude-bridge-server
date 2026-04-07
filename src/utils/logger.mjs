import { config } from '../config.mjs';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level) {
  return LEVELS[level] >= LEVELS[config.LOG_LEVEL];
}

function formatTag(key, value) {
  return value != null ? ` [${key}:${value}]` : '';
}

function log(level, message, meta = {}) {
  if (!shouldLog(level)) return;

  const timestamp = new Date().toISOString();
  const label = level.toUpperCase().padEnd(5);
  const taskTag = formatTag('task', meta.taskId);
  const agentTag = formatTag('agent', meta.agentId);

  const line = `[${timestamp}] [${label}]${taskTag}${agentTag} ${message}`;

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message, meta) => log('debug', message, meta),
  info: (message, meta) => log('info', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  error: (message, meta) => log('error', message, meta),
};
