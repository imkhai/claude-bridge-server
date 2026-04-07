// Simple Mode — Agent status table
// Renders agents with box-drawing characters and status indicators

import { getAgentColor } from '../state.mjs';
import { escapeHtml } from './terminal.mjs';

const STATUS_ICONS = {
  active: '<span class="si-active">■</span>',
  done: '<span class="si-done">■</span>',
  queued: '<span class="si-queued">●</span>',
  idle: '<span class="si-idle">○</span>',
  faded: '<span class="si-idle">○</span>',
  error: '<span class="si-error">✗</span>',
  timeout: '<span class="si-error">✗</span>',
};

const STATUS_LABELS = {
  active: 'RUN',
  done: 'DONE',
  queued: 'WAIT',
  idle: 'IDLE',
  faded: 'IDLE',
  error: 'ERR',
  timeout: 'TIME',
};

export function renderAgentsTable(el, state) {
  if (state.agents.length === 0) {
    el.innerHTML = '<div class="term-empty">No agents discovered yet.</div>';
    return;
  }

  // Column widths
  const colAgent = 20;
  const colStatus = 8;
  const colDur = 10;
  const colTask = 40;

  const pad = (s, w) => s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length);
  const padR = (s, w) => s.length >= w ? s.slice(0, w) : ' '.repeat(w - s.length) + s;

  // Header
  let html = '<div class="term-table">';
  html += '<div class="term-table-header">';
  html += `┌${'─'.repeat(colAgent + 2)}┬${'─'.repeat(colStatus + 2)}┬${'─'.repeat(colDur + 2)}┬${'─'.repeat(colTask + 2)}┐`;
  html += '</div>';
  html += '<div class="term-table-header">';
  html += `│ ${pad('Agent ID', colAgent)} │ ${pad('Status', colStatus)} │ ${pad('Duration', colDur)} │ ${pad('Task', colTask)} │`;
  html += '</div>';
  html += '<div class="term-table-header">';
  html += `├${'─'.repeat(colAgent + 2)}┼${'─'.repeat(colStatus + 2)}┼${'─'.repeat(colDur + 2)}┼${'─'.repeat(colTask + 2)}┤`;
  html += '</div>';

  // Rows
  for (const agent of state.agents) {
    const effectiveStatus = state.getEffectiveStatus(agent);
    const icon = STATUS_ICONS[effectiveStatus] || STATUS_ICONS.idle;
    const label = STATUS_LABELS[effectiveStatus] || 'IDLE';

    const duration = agent.status === 'active' && agent.startedAt
      ? state.formatDuration(Date.now() - new Date(agent.startedAt).getTime())
      : agent.duration ? state.formatDuration(agent.duration) : '-';

    const prompt = agent.currentPrompt
      ? agent.currentPrompt.slice(0, colTask - 2) + (agent.currentPrompt.length > colTask - 2 ? '..' : '')
      : '-';

    const color = getAgentColor(agent.agentId);
    const blink = agent.status === 'active' ? ' blink' : '';
    const rowClass = `term-row status-${effectiveStatus === 'faded' ? 'idle' : effectiveStatus}`;

    html += `<div class="${rowClass}">`;
    html += `│ <span style="color:${color}">${pad(escapeHtml(agent.agentId), colAgent)}</span>`;
    html += ` │ <span class="${blink}">${icon}</span> ${pad(label, colStatus - 2)}`;
    html += ` │ ${padR(duration, colDur)}`;
    html += ` │ ${pad(escapeHtml(prompt), colTask)} │`;
    html += '</div>';
  }

  // Footer
  html += '<div class="term-table-footer">';
  html += `└${'─'.repeat(colAgent + 2)}┴${'─'.repeat(colStatus + 2)}┴${'─'.repeat(colDur + 2)}┴${'─'.repeat(colTask + 2)}┘`;
  html += '</div>';
  html += '</div>';

  el.innerHTML = html;
}
