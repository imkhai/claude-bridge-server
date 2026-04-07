import { Router } from 'express';
import { queue } from '../queue.mjs';
import {
  validateWorkingDir,
  validateContextFile,
  validateAllowedTools,
  validateDisallowedTools,
  validateInputFields,
} from '../utils/validators.mjs';

export const askRouter = Router();

function validateAskBody(body) {
  const { prompt, agentId, context, contextFile, workingDir, allowedTools, disallowedTools, maxTurns } = body;

  validateInputFields({ agentId, maxTurns, prompt, context });

  return {
    prompt: prompt.trim(),
    agentId,
    context,
    contextFile: validateContextFile(contextFile),
    workingDir: validateWorkingDir(workingDir),
    allowedTools: validateAllowedTools(allowedTools),
    disallowedTools: validateDisallowedTools(disallowedTools),
    maxTurns,
  };
}

askRouter.post('/ask', async (req, res, next) => {
  try {
    const params = validateAskBody(req.body);
    const result = queue.submit(params);
    res.json(result);
  } catch (err) {
    if (err.message.includes('must be') || err.message.includes('is required') || err.message.includes('not permitted') || err.message === 'Queue full') {
      return res.status(err.message === 'Queue full' ? 429 : 400).json({ error: err.message });
    }
    next(err);
  }
});

askRouter.post('/ask/sync', async (req, res, next) => {
  try {
    const params = validateAskBody(req.body);
    const job = await queue.submitAndWait(params);

    res.json({
      taskId: job.taskId,
      agentId: job.agentId,
      status: job.status,
      result: job.result,
      error: job.error || null,
      resultFile: job.resultFile,
      duration: job.duration,
    });
  } catch (err) {
    if (err.message.includes('must be') || err.message.includes('is required') || err.message.includes('not permitted') || err.message === 'Queue full') {
      return res.status(err.message === 'Queue full' ? 429 : 400).json({ error: err.message });
    }
    next(err);
  }
});
