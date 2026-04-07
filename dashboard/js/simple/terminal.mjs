// Simple Mode — Terminal layout renderer
// Creates the full terminal UI with box-drawing characters

import { renderAgentsTable } from './table.mjs';
import { renderQueueStats, renderChainProgress } from './progress.mjs';
import { renderTimeline } from './timeline.mjs';
import { renderWorklog } from './worklog.mjs';
import { renderLeaderboard } from './leaderboard.mjs';

const BOX = {
  tl: '╔', tr: '╗', bl: '╚', br: '╝',
  h: '═', v: '║',
  // Single-line for inner sections
  stl: '┌', str: '┐', sbl: '└', sbr: '┘',
  sh: '─', sv: '│',
  slt: '├', srt: '┤', stt: '┬', sbt: '┴', sx: '┼',
  // Double-line dividers
  dl: '╠', dr: '╣',
};

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Initialize the terminal renderer.
 * Replaces the simple-mode container contents with a terminal-style layout.
 * Returns an object with an update(state) method.
 */
export function initTerminal(container, state) {
  // Create terminal wrapper
  container.innerHTML = '';
  const terminal = document.createElement('div');
  terminal.className = 'terminal-wrapper';
  terminal.innerHTML = `
    <div class="terminal-scanline"></div>
    <div class="terminal-content">
      <div class="terminal-header" id="term-header"></div>
      <div class="terminal-divider" id="term-divider-1"></div>
      <div class="terminal-section">
        <div class="terminal-section-title">AGENTS</div>
        <div class="terminal-agents" id="term-agents"></div>
      </div>
      <div class="terminal-section">
        <div class="terminal-section-title">LEADERBOARD</div>
        <div class="terminal-leaderboard" id="term-leaderboard"></div>
      </div>
      <div class="terminal-section">
        <div class="terminal-section-title">CHAINS</div>
        <div class="terminal-chains" id="term-chains"></div>
      </div>
      <div class="terminal-columns">
        <div class="terminal-col terminal-col-queue">
          <div class="terminal-section-title">QUEUE</div>
          <div class="terminal-queue" id="term-queue"></div>
        </div>
        <div class="terminal-col terminal-col-timeline">
          <div class="terminal-section-title">TIMELINE (recent)</div>
          <div class="terminal-timeline" id="term-timeline"></div>
        </div>
      </div>
      <div class="terminal-section">
        <div class="terminal-section-title">WORKLOG HISTORY</div>
        <div class="terminal-worklog" id="term-worklog"></div>
      </div>
      <div class="terminal-footer" id="term-footer"></div>
    </div>
  `;
  container.appendChild(terminal);

  // Cache DOM refs
  const els = {
    header: terminal.querySelector('#term-header'),
    agents: terminal.querySelector('#term-agents'),
    chains: terminal.querySelector('#term-chains'),
    queue: terminal.querySelector('#term-queue'),
    timeline: terminal.querySelector('#term-timeline'),
    leaderboard: terminal.querySelector('#term-leaderboard'),
    worklog: terminal.querySelector('#term-worklog'),
    footer: terminal.querySelector('#term-footer'),
  };

  function update(state) {
    renderHeader(els.header, state);
    renderAgentsTable(els.agents, state);
    renderLeaderboard(els.leaderboard, state);
    renderChainProgress(els.chains, state);
    renderQueueStats(els.queue, state);
    renderTimeline(els.timeline, state);
    renderWorklog(els.worklog, state);
    renderFooter(els.footer);
  }

  // Initial render
  update(state);

  return { update };
}

function renderHeader(el, state) {
  const s = state.stats;
  const uptime = state.formatUptime(s.uptime);
  const port = location.port || '3210';

  el.innerHTML =
    `<span class="term-title">CLAUDE BRIDGE SERVER</span>` +
    `<span class="term-subtitle"> ${BOX.sh} Dashboard</span>` +
    `<span class="term-uptime">uptime: ${escapeHtml(uptime)}</span>` +
    `<br>` +
    `<span class="term-info">Port: ${port} ${BOX.sv} Workers: ${s.active}/${s.maxParallel} active ${BOX.sv} Queue: ${s.queued} waiting ${BOX.sv} Processed: ${s.totalProcessed}</span>`;
}

function renderFooter(el) {
  const now = new Date().toLocaleTimeString('en-US', { hour12: false });
  el.innerHTML =
    `<span class="term-footer-keys">[1] Real  [2] Simple  [r] Refresh  [f] Fullscreen</span>` +
    `<span class="term-footer-time">${now}</span>`;
}

export { escapeHtml };
