import { Router } from 'express';
import { queue, getTimeline, getAgentSummaries, onTimelineEvent, getCompletedJobs, getPerformanceStats } from '../queue.mjs';
import { getChains } from './chain.mjs';
import { getAllProgress } from '../claude-runner.mjs';
import { logger } from '../utils/logger.mjs';

export const dashboardRouter = Router();

// GET /api/dashboard/agents — agent status derived from queue job data
dashboardRouter.get('/api/dashboard/agents', (req, res) => {
  const agents = getAgentSummaries();
  const stats = queue.getStats();
  res.json({
    agents,
    stats: {
      ...stats,
      totalProcessed: stats.totalProcessed,
    },
  });
});

// GET /api/dashboard/chains — active/recent chains
dashboardRouter.get('/api/dashboard/chains', (req, res) => {
  const chains = getChains();
  const result = [];
  for (const chain of chains.values()) {
    result.push({
      chainId: chain.chainId,
      status: chain.status,
      currentStep: chain.currentStep,
      steps: chain.steps.map((s) => ({
        step: s.step,
        agentId: s.agentId,
        taskId: s.taskId,
        status: s.status,
        duration: s.duration,
        prompt: s.prompt ? s.prompt.slice(0, 200) : null,
      })),
    });
  }
  res.json({ chains: result });
});

// GET /api/dashboard/timeline — recent events (ring buffer, 100 entries)
dashboardRouter.get('/api/dashboard/timeline', (req, res) => {
  res.json({ events: getTimeline() });
});

// GET /api/dashboard/worklog — completed job history
dashboardRouter.get('/api/dashboard/worklog', (req, res) => {
  const jobs = getCompletedJobs();
  res.json({ jobs });
});

// GET /api/dashboard/leaderboard — per-agent performance rankings
dashboardRouter.get('/api/dashboard/leaderboard', (req, res) => {
  res.json({ leaderboard: getPerformanceStats() });
});

// GET /api/dashboard/stream — SSE endpoint
dashboardRouter.get('/api/dashboard/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial data immediately
  sendAgentsEvent(res);
  sendChainsEvent(res);
  sendLeaderboardEvent(res);

  // Periodic push every 2 seconds
  const intervalId = setInterval(() => {
    sendAgentsEvent(res);
    sendChainsEvent(res);
    sendLeaderboardEvent(res);
  }, 2000);

  // Push timeline events in real-time
  const unsubscribe = onTimelineEvent((event) => {
    sendSSE(res, 'timeline', event);
  });

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(intervalId);
    unsubscribe();
    logger.debug('SSE client disconnected');
  });

  logger.debug('SSE client connected');
});

function sendSSE(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Client may have disconnected
  }
}

function sendAgentsEvent(res) {
  const agents = getAgentSummaries();
  const stats = queue.getStats();
  const allProgress = getAllProgress();

  // Enrich agents with real-time progress
  for (const agent of agents) {
    if (agent.currentTaskId && allProgress[agent.currentTaskId]) {
      const prog = allProgress[agent.currentTaskId];
      agent.progress = {
        outputBytes: prog.outputBytes,
        elapsed: Math.floor((Date.now() - prog.startedAt) / 1000),
        lastActivityAgo: Math.floor((Date.now() - prog.lastActivity) / 1000),
        recentStderr: prog.stderrLines,
      };
    }
  }

  sendSSE(res, 'agents', { agents, stats });
}

function sendLeaderboardEvent(res) {
  const leaderboard = getPerformanceStats();
  if (leaderboard.length > 0) {
    sendSSE(res, 'leaderboard', { leaderboard });
  }
}

function sendChainsEvent(res) {
  const chains = getChains();
  const result = [];
  for (const chain of chains.values()) {
    if (chain.status === 'running' || (chain.status === 'done' && Date.now() - new Date(chain.steps[chain.steps.length - 1]?.duration || 0) < 300000)) {
      result.push({
        chainId: chain.chainId,
        status: chain.status,
        currentStep: chain.currentStep,
        steps: chain.steps.map((s) => ({
          step: s.step,
          agentId: s.agentId,
          taskId: s.taskId,
          status: s.status,
          duration: s.duration,
        })),
      });
    }
  }
  if (result.length > 0) {
    sendSSE(res, 'chain', { chains: result });
  }
}
