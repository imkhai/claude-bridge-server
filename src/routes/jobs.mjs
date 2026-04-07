import { Router } from 'express';
import { queue } from '../queue.mjs';

export const jobsRouter = Router();

jobsRouter.get('/jobs', (req, res) => {
  const { status, agentId } = req.query;
  const limit = parseInt(req.query.limit, 10) || 50;

  const allJobs = queue.listJobs({ status, agentId, limit });
  const stats = queue.getStats();

  const jobs = allJobs.map((j) => ({
    taskId: j.taskId,
    agentId: j.agentId,
    status: j.status,
    prompt: j.prompt,
    createdAt: j.createdAt,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    duration: j.duration,
    resultFile: j.resultFile,
  }));

  res.json({
    active: stats.active,
    maxParallel: stats.maxParallel,
    queued: stats.queued,
    total: allJobs.length,
    jobs,
  });
});
