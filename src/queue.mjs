import crypto from 'crypto';
import { config } from './config.mjs';
import { logger } from './utils/logger.mjs';
import { saveTask, saveContext, saveResult, resultPath } from './utils/file-manager.mjs';
import { runClaude, cancelProcess, killAllProcesses } from './claude-runner.mjs';

const jobs = new Map();
const waitingQueue = [];
let activeCount = 0;
let totalProcessed = 0;
const startTime = Date.now();

function evictStaleJobs() {
  const now = Date.now();
  for (const [taskId, job] of jobs) {
    if (job.status === 'done' || job.status === 'error' || job.status === 'timeout' || job.status === 'cancelled') {
      const finishedMs = job.finishedAt ? new Date(job.finishedAt).getTime() : 0;
      if (now - finishedMs > config.JOB_TTL_MS) {
        jobs.delete(taskId);
      }
    }
  }
}

function createJob(params) {
  const taskId = crypto.randomUUID();
  const job = {
    taskId,
    agentId: params.agentId || 'unknown',
    status: 'queued',
    prompt: params.prompt,
    context: params.context || null,
    contextFile: params.contextFile || null,
    workingDir: params.workingDir || null,
    allowedTools: params.allowedTools || null,
    disallowedTools: params.disallowedTools || null,
    maxTurns: params.maxTurns || null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
    resultFile: null,
    exitCode: null,
    duration: null,
    _resolve: null,
  };
  jobs.set(taskId, job);
  return job;
}

async function executeJob(job) {
  const { taskId, agentId, prompt, context, workingDir, allowedTools, disallowedTools, maxTurns } = job;
  let { contextFile } = job;

  job.status = 'running';
  job.startedAt = new Date().toISOString();
  activeCount++;

  logger.info(`STARTED (active: ${activeCount}/${config.MAX_PARALLEL})`, { taskId, agentId });

  try {
    await saveTask(taskId, prompt);

    // Save inline context to a file if provided and no contextFile given
    if (context && !contextFile) {
      contextFile = await saveContext(taskId, context);
    }

    const startMs = Date.now();
    const output = await runClaude({ prompt, contextFile, workingDir, taskId, agentId, allowedTools, disallowedTools, maxTurns });
    const duration = Date.now() - startMs;

    job.status = 'done';
    job.result = output;
    job.duration = duration;
    job.finishedAt = new Date().toISOString();
    job.exitCode = 0;
    job.resultFile = await saveResult(taskId, agentId, prompt, output, duration);

    logger.info(`DONE (${duration}ms, ${output.length} chars)`, { taskId, agentId });
    totalProcessed++;

    if (job._resolve) {
      job._resolve(job);
      job._resolve = null;
    }
  } catch (err) {
    const duration = job.startedAt ? Date.now() - new Date(job.startedAt).getTime() : 0;

    job.status = err.type === 'timeout' ? 'timeout' : 'error';
    job.error = err.message;
    job.duration = duration;
    job.finishedAt = new Date().toISOString();
    job.exitCode = err.exitCode ?? null;

    logger.error(`${job.status.toUpperCase()}: ${err.message}`, { taskId, agentId });
    totalProcessed++;

    if (job._resolve) {
      job._resolve(job);
      job._resolve = null;
    }
  } finally {
    if (job.status !== 'cancelled') {
      activeCount--;
    }
    processQueue();
  }
}

function processQueue() {
  while (activeCount < config.MAX_PARALLEL && waitingQueue.length > 0) {
    const job = waitingQueue.shift();
    executeJob(job);
  }
}

export const queue = {
  submit(params) {
    if (jobs.size >= config.MAX_QUEUE_SIZE) {
      evictStaleJobs();
      if (jobs.size >= config.MAX_QUEUE_SIZE) {
        throw new Error('Queue full');
      }
    }

    const job = createJob(params);
    waitingQueue.push(job);

    const position = waitingQueue.length;
    logger.info(`QUEUED (position: ${position})`, { taskId: job.taskId, agentId: job.agentId });

    processQueue();

    return { taskId: job.taskId, status: job.status, position };
  },

  submitAndWait(params) {
    if (jobs.size >= config.MAX_QUEUE_SIZE) {
      evictStaleJobs();
      if (jobs.size >= config.MAX_QUEUE_SIZE) {
        throw new Error('Queue full');
      }
    }

    const job = createJob(params);

    const promise = new Promise((resolve) => {
      job._resolve = resolve;
    });

    waitingQueue.push(job);

    const position = waitingQueue.length;
    logger.info(`QUEUED (position: ${position})`, { taskId: job.taskId, agentId: job.agentId });

    processQueue();

    return promise;
  },

  getJob(taskId) {
    return jobs.get(taskId) || null;
  },

  listJobs({ status, agentId, limit } = {}) {
    let result = Array.from(jobs.values());

    if (status) {
      result = result.filter((j) => j.status === status);
    }
    if (agentId) {
      result = result.filter((j) => j.agentId === agentId);
    }
    if (limit) {
      result = result.slice(-limit);
    }

    return result;
  },

  cancelJob(taskId) {
    const job = jobs.get(taskId);
    if (!job) return null;

    if (job.status === 'queued') {
      const idx = waitingQueue.findIndex((j) => j.taskId === taskId);
      if (idx !== -1) waitingQueue.splice(idx, 1);
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      if (job._resolve) {
        job._resolve(job);
        job._resolve = null;
      }
      logger.info(`CANCELLED (was queued)`, { taskId, agentId: job.agentId });
      return job;
    }

    if (job.status === 'running') {
      cancelProcess(taskId);
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      activeCount--;
      if (job._resolve) {
        job._resolve(job);
        job._resolve = null;
      }
      logger.info(`CANCELLED (was running)`, { taskId, agentId: job.agentId });
      processQueue();
      return job;
    }

    return job;
  },

  getStats() {
    return {
      active: activeCount,
      maxParallel: config.MAX_PARALLEL,
      queued: waitingQueue.length,
      totalProcessed,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    };
  },

  async shutdown() {
    logger.info('Shutting down queue...');

    // Cancel all queued jobs
    while (waitingQueue.length > 0) {
      const job = waitingQueue.shift();
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      if (job._resolve) {
        job._resolve(job);
        job._resolve = null;
      }
    }

    // Mark running jobs as cancelled and kill processes
    for (const job of jobs.values()) {
      if (job.status === 'running') {
        job.status = 'cancelled';
        job.finishedAt = new Date().toISOString();
        if (job._resolve) {
          job._resolve(job);
          job._resolve = null;
        }
      }
    }

    killAllProcesses();

    // Wait up to 10s for processes to finish
    const deadline = Date.now() + 10000;
    while (activeCount > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }

    logger.info(`Queue shutdown complete. Active: ${activeCount}`);
  },
};
