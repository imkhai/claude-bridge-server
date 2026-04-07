// Simple Mode — Event log / timeline
// Scrolling list of recent events (last 20)

import { escapeHtml } from './terminal.mjs';

const EVENT_ICONS = {
  task_done: '<span class="evt-icon evt-done">✓</span>',
  task_started: '<span class="evt-icon evt-started">▸</span>',
  task_queued: '<span class="evt-icon evt-created">+</span>',
  task_error: '<span class="evt-icon evt-error">✗</span>',
  task_timeout: '<span class="evt-icon evt-timeout">⏱</span>',
  task_cancelled: '<span class="evt-icon evt-cancelled">−</span>',
  chain_created: '<span class="evt-icon evt-created">+</span>',
  chain_done: '<span class="evt-icon evt-done">✓</span>',
  chain_error: '<span class="evt-icon evt-error">✗</span>',
};

/**
 * Render timeline events.
 * Format: HH:MM:SS icon agent-name EVENT (details)
 * Most recent at top, last 20 events.
 */
export function renderTimeline(el, state) {
  const events = state.timeline.slice(-20).reverse();

  if (events.length === 0) {
    el.innerHTML = '<div class="term-empty">No events yet.</div>';
    return;
  }

  let html = '';
  for (const evt of events) {
    const time = new Date(evt.timestamp).toLocaleTimeString('en-US', { hour12: false });
    const icon = EVENT_ICONS[evt.type] || '<span class="evt-icon">?</span>';
    const label = evt.type.replace('task_', '').replace('chain_', '').toUpperCase();
    const agent = evt.agentId || '';
    const extra = [];
    if (evt.duration) extra.push(state.formatDuration(evt.duration));
    if (evt.chars) extra.push(`${evt.chars} chars`);
    const details = extra.length ? ` (${extra.join(', ')})` : '';

    html += `<div class="timeline-row evt-${evt.type}">`;
    html += `<span class="tl-time">${time}</span> `;
    html += `${icon} `;
    html += `<span class="tl-agent">${escapeHtml(agent)}</span> `;
    html += `<span class="tl-label">${label}</span>`;
    html += `<span class="tl-details">${escapeHtml(details)}</span>`;
    html += '</div>';
  }

  el.innerHTML = html;
}
