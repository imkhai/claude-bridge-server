import crypto from 'crypto';
import { Router } from 'express';
import { queue } from '../queue.mjs';
import {
  validateWorkingDir,
  validateAllowedTools,
  validateDisallowedTools,
  validateInputFields,
} from '../utils/validators.mjs';

export const chainRouter = Router();

const chains = new Map();
const MAX_CHAINS = 500;

export function getChains() {
  return chains;
}

chainRouter.post('/chain', (req, res) => {
  const { steps } = req.body;

  if (!Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ error: 'steps is required and must be a non-empty array' });
  }

  // Validate each step
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s.prompt || typeof s.prompt !== 'string' || s.prompt.trim().length === 0) {
      return res.status(400).json({ error: `Step ${i + 1}: prompt is required` });
    }
    try {
      validateInputFields({ agentId: s.agentId, maxTurns: s.maxTurns, prompt: s.prompt });
      validateWorkingDir(s.workingDir);
      validateAllowedTools(s.allowedTools);
      validateDisallowedTools(s.disallowedTools);
    } catch (err) {
      return res.status(400).json({ error: `Step ${i + 1}: ${err.message}` });
    }
  }

  // Evict completed chains if at capacity
  if (chains.size >= MAX_CHAINS) {
    for (const [id, chain] of chains) {
      if (chain.status === 'done' || chain.status === 'error') {
        chains.delete(id);
      }
    }
    if (chains.size >= MAX_CHAINS) {
      return res.status(429).json({ error: 'Too many chains, try again later' });
    }
  }

  const chainId = 'chain-' + crypto.randomUUID();

  const chainState = {
    chainId,
    status: 'running',
    currentStep: 1,
    steps: steps.map((s, i) => ({
      step: i + 1,
      prompt: s.prompt,
      agentId: s.agentId || 'unknown',
      usesPreviousResult: s.usesPreviousResult || false,
      workingDir: s.workingDir || null,
      allowedTools: s.allowedTools || null,
      disallowedTools: s.disallowedTools || null,
      maxTurns: s.maxTurns || null,
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
      workingDir: step.workingDir,
      allowedTools: step.allowedTools,
      disallowedTools: step.disallowedTools,
      maxTurns: step.maxTurns,
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
