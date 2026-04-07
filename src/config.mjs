import { resolve } from 'path';

export const config = {
  BRIDGE_PORT: parseInt(process.env.BRIDGE_PORT, 10) || 3210,
  MAX_PARALLEL: parseInt(process.env.MAX_PARALLEL, 10) || 4,
  TIMEOUT_MS: parseInt(process.env.TIMEOUT_MS, 10) || 600000,
  WORKSPACE: process.env.WORKSPACE || resolve('./workspace'),
  CLAUDE_PATH: process.env.CLAUDE_PATH || 'claude',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};
