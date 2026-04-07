import { Router } from 'express';
import { queue } from '../queue.mjs';

export const statusRouter = Router();

statusRouter.get('/status/:taskId', (req, res) => {
  const job = queue.getJob(req.params.taskId);

  if (!job) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json({
    taskId: job.taskId,
    agentId: job.agentId,
    status: job.status,
    prompt: job.prompt,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    result: job.result,
    error: job.error,
    resultFile: job.resultFile,
  });
});
