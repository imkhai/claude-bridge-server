import crypto from 'crypto';
import { Router } from 'express';
import { queue } from '../queue.mjs';

export const chainRouter = Router();

const chains = new Map();

chainRouter.post('/chain', (req, res) => {
  const { steps } = req.body;

  if (!Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ error: 'steps is required and must be a non-empty array' });
  }

  const chainId = 'chain-' + crypto.randomUUID().slice(0, 6);

  const chainState = {
    chainId,
    status: 'running',
    currentStep: 1,
    steps: steps.map((s, i) => ({
      step: i + 1,
      prompt: s.prompt,
      agentId: s.agentId || 'unknown',
      usesPreviousResult: s.usesPreviousResult || false,
      taskId: null,
      status: 'pending',
      duration: null,
    })),
  };

  chains.set(chainId, chainState);

  // Execute chain in background
  executeChain(chainState);

  res.json({
    chainId,
    steps: chainState.steps.map((s) => ({
      taskId: s.taskId,
      step: s.step,
      status: s.status,
    })),
  });
});

chainRouter.get('/chain/:chainId', (req, res) => {
  const chain = chains.get(req.params.chainId);

  if (!chain) {
    return res.status(404).json({ error: 'Chain not found' });
  }

  res.json({
    chainId: chain.chainId,
    status: chain.status,
    currentStep: chain.currentStep,
    steps: chain.steps.map((s) => ({
      taskId: s.taskId,
      step: s.step,
      status: s.status,
      duration: s.duration,
    })),
  });
});

async function executeChain(chain) {
  let previousResultFile = null;

  for (let i = 0; i < chain.steps.length; i++) {
    const step = chain.steps[i];
    chain.currentStep = i + 1;
    step.status = 'running';

    const params = {
      prompt: step.prompt,
      agentId: step.agentId,
    };

    if (step.usesPreviousResult && previousResultFile) {
      params.contextFile = previousResultFile;
    }

    try {
      const job = await queue.submitAndWait(params);
      step.taskId = job.taskId;
      step.duration = job.duration;

      if (job.status === 'done') {
        step.status = 'done';
        previousResultFile = job.resultFile;
      } else {
        step.status = job.status;
        for (let j = i + 1; j < chain.steps.length; j++) {
          chain.steps[j].status = 'cancelled';
        }
        chain.status = 'error';
        return;
      }
    } catch (err) {
      step.status = 'error';
      for (let j = i + 1; j < chain.steps.length; j++) {
        chain.steps[j].status = 'cancelled';
      }
      chain.status = 'error';
      return;
    }
  }

  chain.status = 'done';
}
