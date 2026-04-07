import express from 'express';
import { config } from './src/config.mjs';
import { logger } from './src/utils/logger.mjs';
import { ensureDirectories } from './src/utils/file-manager.mjs';
import { queue } from './src/queue.mjs';
import { checkClaudeCli } from './src/claude-runner.mjs';
import { askRouter } from './src/routes/ask.mjs';
import { statusRouter } from './src/routes/status.mjs';
import { jobsRouter } from './src/routes/jobs.mjs';
import { healthRouter } from './src/routes/health.mjs';
import { cancelRouter } from './src/routes/cancel.mjs';
import { chainRouter } from './src/routes/chain.mjs';

const app = express();

app.use(express.json({ limit: '10mb' }));

app.use(askRouter);
app.use(statusRouter);
app.use(jobsRouter);
app.use(healthRouter);
app.use(cancelRouter);
app.use(chainRouter);

// Global error handler
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

async function start() {
  await ensureDirectories();

  const cliOk = await checkClaudeCli();
  if (!cliOk) {
    logger.error('Claude CLI not available. Exiting.');
    process.exit(1);
  }

  app.listen(config.BRIDGE_PORT, () => {
    logger.info('='.repeat(50));
    logger.info('Claude Bridge Server started');
    logger.info(`  Port:         ${config.BRIDGE_PORT}`);
    logger.info(`  Max Parallel: ${config.MAX_PARALLEL}`);
    logger.info(`  Timeout:      ${config.TIMEOUT_MS}ms`);
    logger.info(`  Workspace:    ${config.WORKSPACE}`);
    logger.info(`  Claude Path:  ${config.CLAUDE_PATH}`);
    logger.info(`  Log Level:    ${config.LOG_LEVEL}`);
    logger.info('='.repeat(50));
  });

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT');
    await queue.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM');
    await queue.shutdown();
    process.exit(0);
  });
}

start();
