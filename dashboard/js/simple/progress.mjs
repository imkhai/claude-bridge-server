// Simple Mode — Queue stats bars and chain progress

import { escapeHtml } from './terminal.mjs';

/**
 * Render queue statistics with block-character progress bars.
 * Active: ██████████░░░░░░░░░░ 2/4
 * Queue:  ███░░░░░░░░░░░░░░░░░ 3
 */
export function renderQueueStats(el, state) {
  const s = state.stats;
  const barWidth = 20;

  const activeFill = Math.round((s.active / Math.max(s.maxParallel, 1)) * barWidth);
  const activeBar = '<span class="bar-filled">' + '█'.repeat(activeFill) + '</span>' +
                    '<span class="bar-empty">' + '░'.repeat(barWidth - activeFill) + '</span>';

  const queueFill = Math.min(s.queued, barWidth);
  const queueBar = '<span class="bar-filled">' + '█'.repeat(queueFill) + '</span>' +
                   '<span class="bar-empty">' + '░'.repeat(barWidth - queueFill) + '</span>';

  let html = '';
  html += `<div class="queue-line">Active: ${activeBar} <span class="queue-val">${s.active}/${s.maxParallel}</span></div>`;
  html += `<div class="queue-line">Queue:  ${queueBar} <span class="queue-val">${s.queued}</span></div>`;
  html += `<div class="queue-line">Total:  <span class="queue-val">${s.totalProcessed} processed</span></div>`;

  el.innerHTML = html;
}

/**
 * Render chain progress with step-by-step view.
 * [■■■□] Step 2/4: tech-lead (running, 1m 45s)
 * 1. security-auditor  ✓ done    2m 26s
 * 2. tech-lead         ▸ running 1m 45s
 * 3. senior-engineer   ○ pending
 */
export function renderChainProgress(el, state) {
  const activeChains = state.chains.filter(
    (c) => c.status === 'running' || c.status === 'done' || c.status === 'error'
  );

  if (activeChains.length === 0) {
    el.innerHTML = '<div class="term-empty">No active chains.</div>';
    return;
  }

  let html = '';
  for (const chain of activeChains.slice(-5)) {
    const total = chain.steps.length;
    const done = chain.steps.filter((s) => s.status === 'done').length;
    const current = chain.steps.find((s) => s.status === 'running');
    const currentStep = chain.currentStep || done + 1;

    // Chain header
    const shortId = chain.chainId.length > 16
      ? chain.chainId.slice(0, 6) + '..' + chain.chainId.slice(-6)
      : chain.chainId;
    html += `<div class="chain-block">`;
    html += `<div class="chain-id">CHAIN: ${escapeHtml(shortId)}</div>`;

    // Progress bar: [■■■□]
    const filled = '■'.repeat(done);
    const empty = '□'.repeat(total - done);
    const currentInfo = current
      ? `${escapeHtml(current.agentId)} (${current.status}${current.startedAt ? ', ' + state.formatDuration(Date.now() - new Date(current.startedAt).getTime()) : ''})`
      : '';
    html += `<div class="chain-progress-bar">[<span class="bar-filled">${filled}</span><span class="bar-empty">${empty}</span>] Step ${currentStep}/${total}${currentInfo ? ': ' + currentInfo : ''}</div>`;

    // Steps list
    for (const step of chain.steps) {
      const icon = step.status === 'done' ? '<span class="step-done">✓</span>' :
                   step.status === 'running' ? '<span class="step-running">▸</span>' :
                   step.status === 'error' ? '<span class="step-error">✗</span>' :
                   step.status === 'cancelled' ? '<span class="step-error">✗</span>' :
                   '<span class="step-pending">○</span>';

      const statusLabel = step.status || 'pending';
      const dur = step.duration ? ' ' + state.formatDuration(step.duration) : '';
      const activeDur = step.status === 'running' && step.startedAt
        ? ' ' + state.formatDuration(Date.now() - new Date(step.startedAt).getTime())
        : '';
      const agentPad = escapeHtml(step.agentId || 'unknown').padEnd(20);

      html += `<div class="chain-step-line step-${step.status || 'pending'}">`;
      html += `  ${step.step}. ${agentPad} ${icon} ${statusLabel}${dur}${activeDur}`;
      html += `</div>`;
    }
    html += '</div>';
  }

  el.innerHTML = html;
}
