import crypto from 'crypto';
import { config } from './config.mjs';
import { logger } from './utils/logger.mjs';
import { saveTask, saveContext, saveResult, resultPath } from './utils/file-manager.mjs';
import { runClaude, cancelProcess, killAllProcesses } from './claude-runner.mjs';
import * as db from './db.mjs';

const jobs = new Map();
const waitingQueue = [];
let activeCount = 0;
let totalProcessed = 0;
const startTime = Date.now();

// --- Completed jobs (persisted to SQLite) ---

function addCompletedJob(job) {
  try {
    db.saveJob(job);
  } catch (err) {
    logger.error(`Failed to persist job to DB: ${err.message}`, { taskId: job.taskId });
  }
}

export function getCompletedJobs() {
  try {
    return db.getCompletedJobs();
  } catch {
    return [];
  }
}

// --- Timeline event ring buffer ---
const timeline = [];
const MAX_TIMELINE = 100;

function addTimelineEvent(type, data) {
  const event = { type, ...data, timestamp: new Date().toISOString() };
  timeline.push(event);
  if (timeline.length > MAX_TIMELINE) timeline.shift();
  // Notify SSE listeners
  for (const listener of timelineListeners) {
    listener(event);
  }
}

const timelineListeners = new Set();

export function onTimelineEvent(fn) {
  timelineListeners.add(fn);
  return () => timelineListeners.delete(fn);
}

export function getTimeline() {
  return [...timeline];
}

export function getAgentSummaries() {
  const agentMap = new Map();

  for (const job of jobs.values()) {
    const id = job.agentId;
    if (!agentMap.has(id)) {
      agentMap.set(id, {
        agentId: id,
        status: 'idle',
        currentTaskId: null,
        currentPrompt: null,
        startedAt: null,
        duration: null,
        completedTasks: 0,
        lastActiveAt: null,
      });
    }
    const agent = agentMap.get(id);

    if (job.status === 'running') {
      agent.status = 'active';
      agent.currentTaskId = job.taskId;
      agent.currentPrompt = job.prompt;
      agent.startedAt = job.startedAt;
      agent.duration = Date.now() - new Date(job.startedAt).getTime();
    } else if (job.status === 'queued') {
      if (agent.status !== 'active') {
        agent.status = 'queued';
        agent.currentTaskId = job.taskId;
        agent.currentPrompt = job.prompt;
      }
    } else if (job.status === 'error' || job.status === 'timeout') {
      if (agent.status !== 'active' && agent.status !== 'queued') {
        agent.status = job.status;
      }
    }

    if (job.status === 'done') {
      agent.completedTasks++;
    }

    if (job.finishedAt) {
      if (!agent.lastActiveAt || new Date(job.finishedAt) > new Date(agent.lastActiveAt)) {
        agent.lastActiveAt = job.finishedAt;
      }
    }
    if (job.startedAt) {
      if (!agent.lastActiveAt || new Date(job.startedAt) > new Date(agent.lastActiveAt)) {
        agent.lastActiveAt = job.startedAt;
      }
    }
  }

  return Array.from(agentMap.values());
}

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

  addTimelineEvent('task_started', { taskId, agentId, prompt: prompt.slice(0, 200) });
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

    addTimelineEvent('task_done', { taskId, agentId, duration, chars: output.length });
    logger.info(`DONE (${duration}ms, ${output.length} chars)`, { taskId, agentId });
    totalProcessed++;
    addCompletedJob(job);

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

    addTimelineEvent(job.status === 'timeout' ? 'task_timeout' : 'task_error', { taskId, agentId, error: err.message });
    logger.error(`${job.status.toUpperCase()}: ${err.message}`, { taskId, agentId });
    totalProcessed++;
    addCompletedJob(job);

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

export function getPerformanceStats() {
  let dbStats;
  try {
    dbStats = db.getPerformanceStats();
  } catch {
    dbStats = [];
  }

  // Build metrics from DB agent_stats
  const agentMetrics = dbStats.map(row => {
    const totalFinished = row.total_tasks;
    const totalTasks = row.success_count;
    const successRate = totalFinished > 0 ? (row.success_count / totalFinished) * 100 : 0;
    const avgDuration = totalTasks > 0 ? Math.round(row.total_duration / totalTasks) : 0;

    let consistency = 100;
    const reliability = Math.round(successRate * 0.7 + consistency * 0.3);

    return {
      agentId: row.agentId,
      totalTasks,
      totalFinished,
      streak: 0,
      reliability,
      successRate: Math.round(successRate * 10) / 10,
      avgDuration,
      fastestTask: 0,
      totalOutputChars: 0,
    };
  });

  // Also include in-memory active agents not yet in DB
  for (const job of jobs.values()) {
    if (!agentMetrics.find(m => m.agentId === job.agentId)) {
      agentMetrics.push({
        agentId: job.agentId,
        totalTasks: 0,
        totalFinished: 0,
        streak: 0,
        reliability: 0,
        successRate: 0,
        avgDuration: 0,
        fastestTask: 0,
        totalOutputChars: 0,
      });
    }
  }

  // Composite score
  const maxTasks = Math.max(1, ...agentMetrics.map((a) => a.totalTasks));
  const maxSpeed = Math.max(1, ...agentMetrics.map((a) => a.avgDuration));

  for (const m of agentMetrics) {
    const successNorm = m.successRate;
    const tasksNorm = (m.totalTasks / maxTasks) * 100;
    const speedNorm = m.avgDuration > 0 ? ((maxSpeed - m.avgDuration) / maxSpeed) * 100 : 0;
    m.score = Math.round((successNorm * 0.4 + tasksNorm * 0.3 + speedNorm * 0.3) * 10) / 10;
  }

  agentMetrics.sort((a, b) => b.score - a.score);
  agentMetrics.forEach((m, i) => { m.rank = i + 1; });

  return agentMetrics;
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
    addTimelineEvent('task_queued', { taskId: job.taskId, agentId: job.agentId, prompt: params.prompt.slice(0, 200), position });
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
    addTimelineEvent('task_queued', { taskId: job.taskId, agentId: job.agentId, prompt: params.prompt.slice(0, 200), position });
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
      addTimelineEvent('task_cancelled', { taskId, agentId: job.agentId });
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
      addTimelineEvent('task_cancelled', { taskId, agentId: job.agentId });
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
