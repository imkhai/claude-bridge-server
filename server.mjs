import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from './src/config.mjs';
import { logger } from './src/utils/logger.mjs';
import { ensureDirectories } from './src/utils/file-manager.mjs';
import { queue } from './src/queue.mjs';
import { checkClaudeCli } from './src/claude-runner.mjs';
import { authMiddleware } from './src/middleware/auth.mjs';
import { requestLogger } from './src/middleware/request-logger.mjs';
import { askRouter } from './src/routes/ask.mjs';
import { statusRouter } from './src/routes/status.mjs';
import { jobsRouter } from './src/routes/jobs.mjs';
import { healthRouter } from './src/routes/health.mjs';
import { cancelRouter } from './src/routes/cancel.mjs';
import { chainRouter } from './src/routes/chain.mjs';
import { dashboardRouter } from './src/routes/dashboard-api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();

let shuttingDown = false;

app.use(express.json({ limit: '2mb' }));
app.use(requestLogger);
app.use(authMiddleware);

// Reject requests during shutdown
app.use((req, res, next) => {
  if (shuttingDown && req.path !== '/health') {
    return res.status(503).json({ error: 'Server is shutting down' });
  }
  next();
});

// Dashboard static files and API (before auth middleware for static assets)
app.use('/dashboard', express.static(join(__dirname, 'dashboard')));

// Redirect root to dashboard for browser requests
app.get('/', (req, res, next) => {
  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    return res.redirect('/dashboard');
  }
  next();
});

app.use(askRouter);
app.use(statusRouter);
app.use(jobsRouter);
app.use(healthRouter);
app.use(cancelRouter);
app.use(chainRouter);
app.use(dashboardRouter);

// Global error handler — never expose internal error details
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  await ensureDirectories();

  const cliOk = await checkClaudeCli();
  if (!cliOk) {
    logger.error('Claude CLI not available. Exiting.');
    process.exit(1);
  }

  app.listen(config.BRIDGE_PORT, config.BIND_HOST, () => {
    logger.info('='.repeat(50));
    logger.info('Claude Bridge Server started');
    logger.info(`  Bind Host:    ${config.BIND_HOST}`);
    logger.info(`  Port:         ${config.BRIDGE_PORT}`);
    logger.info(`  Max Parallel: ${config.MAX_PARALLEL}`);
    logger.info(`  Timeout:      ${config.TIMEOUT_MS}ms`);
    logger.info(`  Workspace:    ${config.WORKSPACE}`);
    logger.info(`  Claude Path:  ${config.CLAUDE_PATH}`);
    logger.info(`  Log Level:    ${config.LOG_LEVEL}`);
    logger.info(`  Auth:         ${config.API_KEY ? 'enabled' : 'disabled (no API_KEY)'}`);
    logger.info(`  Max Queue:    ${config.MAX_QUEUE_SIZE}`);
    logger.info('='.repeat(50));
  });

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT — starting graceful shutdown');
    shuttingDown = true;
    await queue.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM — starting graceful shutdown');
    shuttingDown = true;
    await queue.shutdown();
    process.exit(0);
  });
}

start();
