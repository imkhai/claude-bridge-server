// Agent state management

const IDLE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const FADE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

// Color assignment by role keywords
const COLOR_MAP = [
  { patterns: ['security', 'audit'], color: '#ef4444', name: 'red' },
  { patterns: ['lead', 'architect', 'plan'], color: '#8b5cf6', name: 'violet' },
  { patterns: ['senior', 'engineer', 'impl'], color: '#22c55e', name: 'green' },
  { patterns: ['review', 'qa', 'test'], color: '#f59e0b', name: 'amber' },
  { patterns: ['research', 'analyze'], color: '#0ea5e9', name: 'cyan' },
  { patterns: ['frontend', 'ui', 'design'], color: '#ec4899', name: 'pink' },
  { patterns: ['backend', 'api', 'data'], color: '#14b8a6', name: 'teal' },
];
const DEFAULT_COLOR = '#6366f1';

export function getAgentColor(agentId) {
  const id = agentId.toLowerCase();
  for (const entry of COLOR_MAP) {
    if (entry.patterns.some((p) => id.includes(p))) {
      return entry.color;
    }
  }
  return DEFAULT_COLOR;
}

export function abbreviateId(agentId) {
  if (agentId.length <= 10) return agentId;
  const parts = agentId.split(/[-_]/);
  if (parts.length >= 2) {
    return parts.map((p) => p.slice(0, 3)).join('-');
  }
  return agentId.slice(0, 10);
}

export class DashboardState {
  constructor() {
    this.agents = [];
    this.stats = { active: 0, maxParallel: 4, queued: 0, totalProcessed: 0, uptime: 0 };
    this.chains = [];
    this.timeline = [];
    this.worklog = [];
    this.leaderboard = [];
    this.maxTimeline = 100;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of this.listeners) {
      try { fn(this); } catch { /* ignore */ }
    }
  }

  updateAgents(data) {
    this.agents = data.agents || [];
    if (data.stats) {
      this.stats = data.stats;
    }
    this.notify();
  }

  updateChains(data) {
    if (data.chains) {
      // Merge: update existing, add new
      for (const incoming of data.chains) {
        const idx = this.chains.findIndex((c) => c.chainId === incoming.chainId);
        if (idx >= 0) {
          this.chains[idx] = incoming;
        } else {
          this.chains.push(incoming);
        }
      }
      // Keep only last 20 chains
      if (this.chains.length > 20) {
        this.chains = this.chains.slice(-20);
      }
    }
    this.notify();
  }

  addTimelineEvent(event) {
    this.timeline.push(event);
    if (this.timeline.length > this.maxTimeline) {
      this.timeline.shift();
    }
    this.notify();
  }

  setTimeline(events) {
    this.timeline = events || [];
    this.notify();
  }

  updateWorklog(data) {
    this.worklog = data.jobs || [];
    this.notify();
  }

  updateLeaderboard(data) {
    this.leaderboard = data.leaderboard || [];
    this.notify();
  }

  getEffectiveStatus(agent) {
    if (agent.status === 'active') return 'active';
    if (agent.status === 'queued') return 'queued';
    if (agent.status === 'error') return 'error';
    if (agent.status === 'timeout') return 'timeout';

    // Check if idle for too long
    if (agent.lastActiveAt) {
      const elapsed = Date.now() - new Date(agent.lastActiveAt).getTime();
      if (elapsed > FADE_THRESHOLD_MS) return 'faded';
      if (elapsed > IDLE_THRESHOLD_MS) return 'idle';
    }

    return agent.status || 'idle';
  }

  formatDuration(ms) {
    if (!ms && ms !== 0) return '-';
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    if (mins < 60) return `${mins}m ${remSecs.toString().padStart(2, '0')}s`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins.toString().padStart(2, '0')}m ${remSecs.toString().padStart(2, '0')}s`;
  }

  formatUptime(secs) {
    if (!secs) return '--';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
  }
}
