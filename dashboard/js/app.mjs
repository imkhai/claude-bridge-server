import { fetchAgents, fetchChains, fetchTimeline, fetchWorklog, fetchLeaderboard } from './api.mjs';
import { DashboardState } from './state.mjs';
import { initTerminal } from './simple/terminal.mjs';
import { init as initOffice, update as updateOffice, destroy as destroyOffice } from './real/office.mjs';

const state = new DashboardState();

// --- DOM refs ---
const connectionDot = document.getElementById('connection-status');
const connectionLabel = document.getElementById('connection-label');
const headerUptime = document.getElementById('header-uptime');
const headerWorkers = document.getElementById('header-workers');
const btnReal = document.getElementById('mode-toggle-real');
const btnSimple = document.getElementById('mode-toggle-simple');
const btnFullscreen = document.getElementById('fullscreen-btn');
const simpleMode = document.getElementById('simple-mode');
const realMode = document.getElementById('real-mode');
const realTimeline = document.getElementById('real-timeline');

// --- Simple mode terminal renderer ---
let terminal = null;

// --- Mode switching ---
let currentMode = localStorage.getItem('dashboard-mode') || 'simple';

function setMode(mode) {
  currentMode = mode;
  localStorage.setItem('dashboard-mode', mode);

  simpleMode.classList.toggle('active', mode === 'simple');
  realMode.classList.toggle('active', mode === 'real');
  btnSimple.classList.toggle('active', mode === 'simple');
  btnReal.classList.toggle('active', mode === 'real');

  if (mode === 'simple') {
    initSimpleMode();
    terminal.update(state);
  } else if (mode === 'real') {
    initRealMode();
  }
}

btnSimple.addEventListener('click', () => setMode('simple'));
btnReal.addEventListener('click', () => setMode('real'));
btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  switch (e.key) {
    case '1': setMode('real'); break;
    case '2': setMode('simple'); break;
    case 'r': refreshData(); break;
    case 'f':
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
      break;
  }
});

// --- SSE Client with reconnect ---
let eventSource = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/dashboard/stream');

  connectionDot.className = 'connection-dot connecting';
  connectionDot.title = 'Connecting';
  connectionLabel.textContent = 'Connecting...';

  eventSource.addEventListener('open', () => {
    connectionDot.className = 'connection-dot connected';
    connectionDot.title = 'Connected';
    connectionLabel.textContent = 'Connected';
    reconnectDelay = 1000;

    // Clear stale state on reconnect — server sends full snapshot immediately
    state.resetState();
    // Also fetch full data to ensure we have worklog/timeline
    refreshData();
  });

  eventSource.addEventListener('agents', (e) => {
    try {
      const data = JSON.parse(e.data);
      state.updateAgents(data);
    } catch { /* ignore parse errors */ }
  });

  eventSource.addEventListener('timeline', (e) => {
    try {
      const data = JSON.parse(e.data);
      state.addTimelineEvent(data);
      // Refresh worklog when a task completes
      if (data.type === 'task_done' || data.type === 'task_error' || data.type === 'task_timeout') {
        fetchWorklog().then((wl) => state.updateWorklog(wl)).catch(() => {});
      }
    } catch { /* ignore */ }
  });

  eventSource.addEventListener('chain', (e) => {
    try {
      const data = JSON.parse(e.data);
      state.updateChains(data);
    } catch { /* ignore */ }
  });

  eventSource.addEventListener('leaderboard', (e) => {
    try {
      const data = JSON.parse(e.data);
      state.updateLeaderboard(data);
    } catch { /* ignore */ }
  });

  eventSource.addEventListener('error', () => {
    connectionDot.className = 'connection-dot';
    connectionDot.title = 'Disconnected';
    connectionLabel.textContent = 'Disconnected';
    eventSource.close();
    eventSource = null;

    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      connectSSE();
    }, reconnectDelay);
  });
}

// --- Initial data load ---
async function refreshData() {
  try {
    const [agentsData, chainsData, timelineData, worklogData, leaderboardData] = await Promise.all([
      fetchAgents(),
      fetchChains(),
      fetchTimeline(),
      fetchWorklog(),
      fetchLeaderboard(),
    ]);
    state.updateAgents(agentsData);
    state.updateChains(chainsData);
    state.setTimeline(timelineData.events);
    state.updateWorklog(worklogData);
    state.updateLeaderboard(leaderboardData);
  } catch {
    // Will retry via SSE
  }
}

// --- Simple Mode (terminal renderer) ---

function initSimpleMode() {
  if (!terminal) {
    terminal = initTerminal(simpleMode, state);
  }
}

function renderHeader() {
  headerUptime.textContent = `uptime: ${state.formatUptime(state.stats.uptime)}`;
  headerWorkers.textContent = `Workers: ${state.stats.active}/${state.stats.maxParallel} | Queue: ${state.stats.queued}`;
}

function renderRealTimeline() {
  if (!realTimeline) return;
  const events = state.timeline.slice(-5).reverse();
  realTimeline.innerHTML = events.map((evt) => {
    const time = new Date(evt.timestamp).toLocaleTimeString('en-US', { hour12: false });
    const label = evt.type.replace('task_', '').toUpperCase();
    const agent = evt.agentId || '';
    const extra = evt.duration ? ` (${state.formatDuration(evt.duration)})` : '';
    return `<div class="timeline-entry evt-${evt.type}"><span class="time">${time}</span> ${escapeHtml(agent)} ${label}${extra}</div>`;
  }).join('');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Real Mode (PixiJS office) ---
let pixiInitialized = false;

async function initRealMode() {
  if (pixiInitialized) {
    // Already initialized — just push latest state
    updateOffice(state);
    return;
  }

  if (typeof PIXI === 'undefined') {
    const canvas = realMode.querySelector('#office-canvas');
    if (canvas) canvas.style.display = 'none';
    const msg = document.createElement('div');
    msg.style.cssText = 'color: var(--text-muted); padding: 40px; text-align: center;';
    msg.textContent = 'PixiJS not loaded. Real mode requires an internet connection for CDN.';
    realMode.insertBefore(msg, realMode.firstChild);
    return;
  }

  pixiInitialized = true;
  const canvas = document.getElementById('office-canvas');

  await initOffice(canvas, state);

  // Listen for state changes to update the office
  state.onChange(() => {
    if (currentMode === 'real') {
      updateOffice(state);
    }
  });
}

// --- Render loop ---
state.onChange(() => {
  renderHeader();
  if (currentMode === 'simple') {
    initSimpleMode();
    terminal.update(state);
  }
  renderRealTimeline();
});

// --- Bootstrap ---
setMode(currentMode);
refreshData().then(() => {
  connectSSE();
});
