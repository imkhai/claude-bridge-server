import crypto from 'crypto';
import { readFile, stat } from 'fs/promises';
import { statSync } from 'fs';
import { config } from './config.mjs';
import { logger } from './utils/logger.mjs';
import { saveTask, saveContext } from './utils/file-manager.mjs';
import { runClaude, isProcessAlive, killProcess } from './claude-runner.mjs';
import * as db from './db.mjs';

const POLL_INTERVAL_MS = 2000;
const FORCE_KILL_DELAY_MS = 5000;

const jobs = new Map();
const waitingQueue = [];
const jobTimers = new Map();
let activeCount = 0;
let totalProcessed = 0;
const startTime = Date.now();

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

const timeline = [];
const MAX_TIMELINE = 100;

function addTimelineEvent(type, data) {
  const event = { type, ...data, timestamp: new Date().toISOString() };
  timeline.push(event);
  if (timeline.length > MAX_TIMELINE) timeline.shift();
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

export function getJobProgress(taskId) {
  const job = jobs.get(taskId);
  if (!job || job.status !== 'running') return null;
  return computeProgress(job);
}

export function getAllProgress() {
  const out = {};
  for (const [taskId, job] of jobs) {
    if (job.status !== 'running') continue;
    out[taskId] = computeProgress(job);
  }
  return out;
}

function computeProgress(job) {
  let outputBytes = 0;
  let stderrBytes = 0;
  let lastActivityMs = job.startedAtMs || Date.now();
  try {
    if (job.outputPath) {
      const st = statSync(job.outputPath);
      outputBytes = st.size;
      lastActivityMs = Math.max(lastActivityMs, st.mtimeMs);
    }
  } catch {}
  try {
    if (job.errorPath) {
      const st = statSync(job.errorPath);
      stderrBytes = st.size;
      lastActivityMs = Math.max(lastActivityMs, st.mtimeMs);
    }
  } catch {}

  return {
    outputBytes,
    stderrBytes,
    startedAt: job.startedAtMs || Date.parse(job.startedAt) || Date.now(),
    lastActivity: lastActivityMs,
    stderrLines: [],
  };
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
    startedAtMs: null,
    finishedAt: null,
    result: null,
    error: null,
    resultFile: null,
    outputPath: null,
    errorPath: null,
    pid: null,
    exitCode: null,
    duration: null,
    timingOut: false,
    _resolve: null,
  };
  jobs.set(taskId, job);
  return job;
}

async function finalizeJob(job) {
  const timer = jobTimers.get(job.taskId);
  if (timer) {
    clearInterval(timer);
    jobTimers.delete(job.taskId);
  }

  let output = '';
  if (job.outputPath) {
    try {
      output = await readFile(job.outputPath, 'utf-8');
    } catch (err) {
      logger.warn(`Could not read output file ${job.outputPath}: ${err.message}`, { taskId: job.taskId });
    }
  }

  let errText = '';
  if (job.errorPath) {
    try {
      errText = await readFile(job.errorPath, 'utf-8');
    } catch {}
  }

  const startedMs = job.startedAtMs || Date.parse(job.startedAt) || Date.now();
  const durationMs = Date.now() - startedMs;
  const finishedAt = new Date().toISOString();

  if (job.status === 'cancelled') {
    // preserve cancellation state
  } else if (job.status === 'timeout') {
    // preserve timeout state (result may still be partial output)
    job.result = output;
  } else if (output.trim().length > 0) {
    job.status = 'done';
    job.result = output;
    job.exitCode = 0;
  } else {
    job.status = 'error';
    job.error = errText.slice(-2000) || 'Process exited with no output';
    job.result = output;
  }

  job.resultFile = job.outputPath;
  job.duration = durationMs;
  job.finishedAt = finishedAt;

  const eventType = job.status === 'done'
    ? 'task_done'
    : job.status === 'timeout'
      ? 'task_timeout'
      : job.status === 'cancelled'
        ? 'task_cancelled'
        : 'task_error';
  const eventData = {
    taskId: job.taskId,
    agentId: job.agentId,
    duration: durationMs,
    ...(job.status === 'done' ? { chars: (job.result || '').length } : {}),
    ...(job.status !== 'done' && job.error ? { error: job.error } : {}),
  };
  addTimelineEvent(eventType, eventData);
  logger.info(`${job.status.toUpperCase()} (${durationMs}ms, pid=${job.pid})`, { taskId: job.taskId, agentId: job.agentId });

  totalProcessed++;
  addCompletedJob(job);

  if (activeCount > 0) activeCount--;

  if (job._resolve) {
    job._resolve(job);
    job._resolve = null;
  }

  processQueue();
}

function startPollLoop(job) {
  if (jobTimers.has(job.taskId)) return;
  const timer = setInterval(() => {
    try {
      if (!isProcessAlive(job.pid)) {
        finalizeJob(job).catch((err) => {
          logger.error(`Finalize failed: ${err.message}`, { taskId: job.taskId, stack: err.stack });
        });
        return;
      }

      if (!job.timingOut) {
        const elapsed = Date.now() - (job.startedAtMs || Date.parse(job.startedAt) || Date.now());
        if (elapsed > config.TIMEOUT_MS) {
          job.timingOut = true;
          job.status = 'timeout';
          job.error = `Process timed out after ${config.TIMEOUT_MS}ms`;
          logger.warn(`Timing out process pid=${job.pid}`, { taskId: job.taskId, agentId: job.agentId });
          killProcess(job.pid, 'SIGTERM');
          setTimeout(() => {
            if (isProcessAlive(job.pid)) {
              killProcess(job.pid, 'SIGKILL');
            }
          }, FORCE_KILL_DELAY_MS);
        }
      }
    } catch (err) {
      logger.error(`Poll tick failed: ${err.message}`, { taskId: job.taskId });
    }
  }, POLL_INTERVAL_MS);
  jobTimers.set(job.taskId, timer);
}

async function executeJob(job) {
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  job.startedAtMs = Date.now();
  activeCount++;

  addTimelineEvent('task_started', { taskId: job.taskId, agentId: job.agentId, prompt: job.prompt.slice(0, 200) });
  logger.info(`STARTED (active: ${activeCount}/${config.MAX_PARALLEL})`, { taskId: job.taskId, agentId: job.agentId });

  try {
    await saveTask(job.taskId, job.prompt);

    let contextFile = job.contextFile;
    if (job.context && !contextFile) {
      contextFile = await saveContext(job.taskId, job.context);
    }

    const { pid, outputPath, errorPath, startedAt } = runClaude({
      prompt: job.prompt,
      contextFile,
      workingDir: job.workingDir,
      taskId: job.taskId,
      agentId: job.agentId,
      allowedTools: job.allowedTools,
      disallowedTools: job.disallowedTools,
      maxTurns: job.maxTurns,
    });

    job.pid = pid;
    job.outputPath = outputPath;
    job.errorPath = errorPath;
    job.startedAtMs = startedAt;
    job.startedAt = new Date(startedAt).toISOString();

    try {
      db.saveJob(job);
    } catch (err) {
      logger.error(`Failed to persist running job: ${err.message}`, { taskId: job.taskId });
    }

    startPollLoop(job);
  } catch (err) {
    job.status = 'error';
    job.error = err.message;
    job.finishedAt = new Date().toISOString();
    job.duration = job.startedAtMs ? Date.now() - job.startedAtMs : 0;
    if (activeCount > 0) activeCount--;
    addTimelineEvent('task_error', { taskId: job.taskId, agentId: job.agentId, error: err.message });
    logger.error(`SPAWN FAILED: ${err.message}`, { taskId: job.taskId, agentId: job.agentId });
    totalProcessed++;
    addCompletedJob(job);
    if (job._resolve) {
      job._resolve(job);
      job._resolve = null;
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

export async function reconcileOrphans() {
  let rows;
  try {
    rows = db.getRunningJobs();
  } catch (err) {
    logger.error(`reconcileOrphans: failed to query DB: ${err.message}`);
    return;
  }
  if (!rows.length) return;

  logger.info(`Reconciling ${rows.length} orphan job(s) from previous run`);

  for (const row of rows) {
    const startedAtMs = row.startedAt ? Date.parse(row.startedAt) : Date.now();
    const job = {
      taskId: row.taskId,
      agentId: row.agentId,
      status: 'running',
      prompt: row.prompt || '',
      context: null,
      contextFile: null,
      workingDir: row.workingDir || null,
      allowedTools: null,
      disallowedTools: null,
      maxTurns: null,
      createdAt: row.createdAt || row.startedAt || new Date(startedAtMs).toISOString(),
      startedAt: row.startedAt || new Date(startedAtMs).toISOString(),
      startedAtMs,
      finishedAt: null,
      result: null,
      error: null,
      resultFile: row.resultFile || row.outputPath || null,
      outputPath: row.outputPath || null,
      errorPath: row.errorPath || null,
      pid: row.pid || null,
      exitCode: null,
      duration: null,
      timingOut: false,
      _resolve: null,
    };

    jobs.set(job.taskId, job);
    activeCount++;

    if (job.pid && isProcessAlive(job.pid)) {
      logger.info(`Orphan alive, resuming poll`, { taskId: job.taskId, pid: job.pid });
      startPollLoop(job);
    } else {
      logger.info(`Orphan dead, finalizing from disk`, { taskId: job.taskId, pid: job.pid });
      await finalizeJob(job);
    }
  }
}

export function getPerformanceStats() {
  let dbStats;
  try {
    dbStats = db.getPerformanceStats();
  } catch {
    dbStats = [];
  }

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
      addCompletedJob(job);
      return job;
    }

    if (job.status === 'running') {
      job.status = 'cancelled';
      killProcess(job.pid, 'SIGTERM');
      setTimeout(() => {
        if (isProcessAlive(job.pid)) {
          killProcess(job.pid, 'SIGKILL');
        }
      }, FORCE_KILL_DELAY_MS);
      logger.info(`CANCELLED (was running, pid=${job.pid})`, { taskId, agentId: job.agentId });
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
    logger.info('Shutting down queue (running processes will be left detached)...');

    while (waitingQueue.length > 0) {
      const job = waitingQueue.shift();
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      addCompletedJob(job);
      if (job._resolve) {
        job._resolve(job);
        job._resolve = null;
      }
    }

    for (const timer of jobTimers.values()) {
      clearInterval(timer);
    }
    jobTimers.clear();

    logger.info(`Queue shutdown complete. Active detached: ${activeCount}`);
  },
};
