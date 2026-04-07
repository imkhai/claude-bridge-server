/**
 * Chat Agents — right panel showing real-time agent activity.
 */

import { formatDuration } from './chat-renderer.mjs';

let agents = new Map(); // taskId -> agent state
let panelEl = null;
let contentEl = null;
let timers = new Map(); // taskId -> interval

/**
 * Initialize agent panel.
 */
export function init(opts) {
  panelEl = document.getElementById('agentPanel');
  contentEl = document.getElementById('agentPanelContent');

  document.getElementById('toggleAgentPanel').addEventListener('click', () => {
    panelEl.classList.toggle('collapsed');
  });

  document.getElementById('closeAgentPanel').addEventListener('click', () => {
    panelEl.classList.add('collapsed');
  });
}

/**
 * Show the panel.
 */
export function show() {
  panelEl.classList.remove('collapsed');
}

/**
 * Clear all agents (for new conversation).
 */
export function clear() {
  agents.clear();
  timers.forEach(t => clearInterval(t));
  timers.clear();
  renderIdle();
}

/**
 * Add an agent that just started.
 */
export function addAgent(taskId, agentId, status = 'running') {
  agents.set(taskId, {
    taskId,
    agentId,
    status,
    startedAt: Date.now(),
    elapsed: 0,
    outputBytes: 0,
    output: '',
  });

  // Start elapsed timer
  const timer = setInterval(() => {
    const agent = agents.get(taskId);
    if (agent && agent.status === 'running') {
      agent.elapsed = (Date.now() - agent.startedAt) / 1000;
      updateAgentCard(taskId);
    }
  }, 1000);
  timers.set(taskId, timer);

  render();
  show();
}

/**
 * Update agent progress.
 */
export function updateProgress(taskId, data) {
  const agent = agents.get(taskId);
  if (!agent) return;
  if (data.outputBytes !== undefined) agent.outputBytes = data.outputBytes;
  if (data.output !== undefined) agent.output = data.output;
  updateAgentCard(taskId);
}

/**
 * Mark agent as done.
 */
export function agentDone(taskId, output = '') {
  const agent = agents.get(taskId);
  if (!agent) return;
  agent.status = 'done';
  agent.elapsed = (Date.now() - agent.startedAt) / 1000;
  if (output) agent.output = output;
  clearInterval(timers.get(taskId));
  timers.delete(taskId);
  render();
}

/**
 * Mark agent as errored.
 */
export function agentError(taskId, error = '') {
  const agent = agents.get(taskId);
  if (!agent) return;
  agent.status = 'error';
  agent.elapsed = (Date.now() - agent.startedAt) / 1000;
  agent.output = error || agent.output;
  clearInterval(timers.get(taskId));
  timers.delete(taskId);
  render();
}

/**
 * Render full panel.
 */
function render() {
  if (agents.size === 0) {
    renderIdle();
    return;
  }

  contentEl.innerHTML = '';
  for (const [taskId, agent] of agents) {
    const card = createAgentCard(agent);
    contentEl.appendChild(card);
  }
}

function renderIdle() {
  contentEl.innerHTML = `
    <div class="agent-idle">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
      <p>No active agents</p>
      <span>Send a message to start working</span>
    </div>
  `;
}

function createAgentCard(agent) {
  const card = document.createElement('div');
  card.className = 'agent-card';
  card.dataset.taskId = agent.taskId;

  const statusIcon = getStatusIcon(agent.status);
  const statusClass = agent.status;
  const elapsed = formatDuration(agent.elapsed);
  const bytes = agent.outputBytes > 0 ? formatBytes(agent.outputBytes) : '';
  const metaParts = [elapsed, bytes].filter(Boolean).join(' \u00B7 ');

  card.innerHTML = `
    <div class="agent-card-header">
      <div class="agent-status-icon ${statusClass}">${statusIcon}</div>
      <div class="agent-card-info">
        <div class="agent-card-name">${escapeHtml(agent.agentId)}</div>
        <div class="agent-card-meta">${metaParts}</div>
      </div>
      <div class="agent-card-expand">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6,9 12,15 18,9"/></svg>
      </div>
    </div>
    <div class="agent-card-body">
      ${agent.status === 'running' ? `<div class="agent-progress-bar"><div class="agent-progress-fill" style="width: ${Math.min(90, agent.elapsed * 2)}%"></div></div>` : ''}
      ${agent.output ? `<div class="agent-output">${escapeHtml(truncate(agent.output, 2000))}</div>` : '<div class="agent-output" style="color:var(--text-dim); font-style:italic;">No output yet...</div>'}
    </div>
  `;

  // Toggle expand
  card.querySelector('.agent-card-header').addEventListener('click', () => {
    card.classList.toggle('expanded');
  });

  return card;
}

function updateAgentCard(taskId) {
  const agent = agents.get(taskId);
  if (!agent) return;
  const card = contentEl.querySelector(`[data-task-id="${taskId}"]`);
  if (!card) return;

  const meta = card.querySelector('.agent-card-meta');
  const elapsed = formatDuration(agent.elapsed);
  const bytes = agent.outputBytes > 0 ? formatBytes(agent.outputBytes) : '';
  meta.textContent = [elapsed, bytes].filter(Boolean).join(' \u00B7 ');
}

function getStatusIcon(status) {
  switch (status) {
    case 'running':
      return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>';
    case 'done':
      return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20,6 9,17 4,12"/></svg>';
    case 'error':
      return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    case 'queued':
      return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>';
    default:
      return '';
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + '...';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
