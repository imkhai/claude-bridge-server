import { Router } from 'express';
import { config } from '../config.mjs';
import { queue } from '../queue.mjs';

export const healthRouter = Router();

healthRouter.get('/health', (req, res) => {
  const stats = queue.getStats();

  res.json({
    ok: true,
    uptime: stats.uptime,
    active: stats.active,
    maxParallel: stats.maxParallel,
    queued: stats.queued,
    totalProcessed: stats.totalProcessed,
    workspace: config.WORKSPACE,
  });
});
