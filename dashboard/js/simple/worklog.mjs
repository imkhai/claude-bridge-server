// Simple Mode — Agent Worklog History
// Git-log style history of completed tasks per agent

import { getAgentColor } from '../state.mjs';
import { escapeHtml } from './terminal.mjs';

const STATUS_ICONS = {
  done: '<span class="wl-icon wl-done">✓</span>',
  error: '<span class="wl-icon wl-error">✗</span>',
  timeout: '<span class="wl-icon wl-timeout">⏱</span>',
};

// Track collapsed state per agent
const collapsed = new Set();

/**
 * Render the worklog section.
 * Groups completed jobs by agent, most recent first.
 */
export function renderWorklog(el, state) {
  const jobs = state.worklog;

  if (!jobs || jobs.length === 0) {
    el.innerHTML = '<div class="term-empty">No completed tasks yet.</div>';
    return;
  }

  // Group by agent
  const agentGroups = new Map();
  for (const job of jobs) {
    const id = job.agentId || 'unknown';
    if (!agentGroups.has(id)) agentGroups.set(id, []);
    agentGroups.get(id).push(job);
  }

  // Sort each group by finishedAt desc
  for (const [, group] of agentGroups) {
    group.sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));
  }

  // Sort agents by most recent activity
  const sortedAgents = [...agentGroups.entries()].sort((a, b) => {
    const aTime = a[1][0]?.finishedAt || '';
    const bTime = b[1][0]?.finishedAt || '';
    return bTime.localeCompare(aTime);
  });

  let html = '';

  for (const [agentId, tasks] of sortedAgents) {
    const color = getAgentColor(agentId);
    const isCollapsed = collapsed.has(agentId);

    // Compute stats
    const total = tasks.length;
    const doneCount = tasks.filter((t) => t.status === 'done').length;
    const successRate = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    const durations = tasks.filter((t) => t.duration).map((t) => t.duration);
    const avgDuration = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    // Agent header (clickable to toggle)
    html += `<div class="wl-agent-block">`;
    html += `<div class="wl-agent-header" data-agent="${escapeHtml(agentId)}">`;
    html += `<span class="wl-toggle">${isCollapsed ? '▸' : '▾'}</span> `;
    html += `<span style="color:${color};font-weight:700">${escapeHtml(agentId)}</span>`;
    html += `<span class="wl-agent-stats">`;
    html += ` │ ${total} tasks │ ${successRate}% ok │ avg ${state.formatDuration(avgDuration)}`;
    html += `</span>`;
    html += `</div>`;

    if (!isCollapsed) {
      // Task entries
      for (const task of tasks) {
        const icon = STATUS_ICONS[task.status] || STATUS_ICONS.done;
        const shortId = task.taskId ? task.taskId.slice(0, 8) : '--------';
        const dur = task.duration ? state.formatDuration(task.duration) : '-';
        const time = task.finishedAt
          ? new Date(task.finishedAt).toLocaleTimeString('en-US', { hour12: false })
          : '--:--:--';
        const prompt = task.prompt
          ? task.prompt.slice(0, 60) + (task.prompt.length > 60 ? '..' : '')
          : '-';

        html += `<div class="wl-entry status-${task.status}">`;
        html += `  ${icon} `;
        html += `<span class="wl-id">${shortId}</span> `;
        html += `<span class="wl-status">${task.status.toUpperCase().padEnd(5)}</span> `;
        html += `<span class="wl-dur">${dur.padStart(8)}</span> `;
        html += `<span class="wl-time">${time}</span> `;
        html += `<span class="wl-prompt">${escapeHtml(prompt)}</span>`;
        html += `</div>`;
      }
    }

    html += `</div>`;
  }

  el.innerHTML = html;

  // Attach click handlers for collapse/expand
  el.querySelectorAll('.wl-agent-header').forEach((header) => {
    header.addEventListener('click', () => {
      const agent = header.dataset.agent;
      if (collapsed.has(agent)) {
        collapsed.delete(agent);
      } else {
        collapsed.add(agent);
      }
      renderWorklog(el, state);
    });
  });
}
