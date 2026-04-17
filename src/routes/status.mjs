import { Router } from 'express';
import { queue, getJobProgress, getAllProgress } from '../queue.mjs';

export const statusRouter = Router();

statusRouter.get('/status/:taskId', (req, res) => {
  const job = queue.getJob(req.params.taskId);

  if (!job) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const progress = getJobProgress(job.taskId);

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
    progress: progress ? {
      outputBytes: progress.outputBytes,
      stderrBytes: progress.stderrBytes,
      elapsed: Math.floor((Date.now() - progress.startedAt) / 1000),
      lastActivity: Math.floor((Date.now() - progress.lastActivity) / 1000),
      recentStderr: progress.stderrLines,
    } : null,
  });
});

// Real-time progress for all running tasks
statusRouter.get('/progress', (req, res) => {
  const allProgress = getAllProgress();
  const jobs = queue.listJobs({ status: 'running' });

  const tasks = jobs.map(job => {
    const prog = allProgress[job.taskId];
    return {
      taskId: job.taskId,
      agentId: job.agentId,
      status: job.status,
      prompt: job.prompt ? job.prompt.slice(0, 150) + (job.prompt.length > 150 ? '...' : '') : null,
      startedAt: job.startedAt,
      progress: prog ? {
        outputBytes: prog.outputBytes,
        stderrBytes: prog.stderrBytes,
        elapsed: Math.floor((Date.now() - prog.startedAt) / 1000),
        lastActivityAgo: Math.floor((Date.now() - prog.lastActivity) / 1000),
        recentStderr: prog.stderrLines,
      } : null,
    };
  });

  res.json({ tasks, active: tasks.length, maxParallel: queue.getStats().maxParallel });
});
