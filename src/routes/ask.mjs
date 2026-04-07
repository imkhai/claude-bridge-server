import { Router } from 'express';
import { queue } from '../queue.mjs';

export const askRouter = Router();

askRouter.post('/ask', async (req, res, next) => {
  try {
    const { prompt, agentId, context, contextFile, workingDir } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required and must be a string' });
    }

    const result = queue.submit({ prompt, agentId, context, contextFile, workingDir });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

askRouter.post('/ask/sync', async (req, res, next) => {
  try {
    const { prompt, agentId, context, contextFile, workingDir } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required and must be a string' });
    }

    const job = await queue.submitAndWait({ prompt, agentId, context, contextFile, workingDir });

    res.json({
      taskId: job.taskId,
      agentId: job.agentId,
      status: job.status,
      result: job.result,
      error: job.error || null,
      resultFile: job.resultFile,
      duration: job.duration,
      tokensEstimate: null,
    });
  } catch (err) {
    next(err);
  }
});
