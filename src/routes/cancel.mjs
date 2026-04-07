import { Router } from 'express';
import { queue } from '../queue.mjs';

export const cancelRouter = Router();

cancelRouter.post('/cancel/:taskId', (req, res) => {
  const job = queue.cancelJob(req.params.taskId);

  if (!job) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json({
    taskId: job.taskId,
    status: job.status,
  });
});
