// Simple Mode — Agent Performance Leaderboard
// ASCII art trophies, box-drawing table, block-char status bars

import { getAgentColor, abbreviateId } from '../state.mjs';
import { escapeHtml } from './terminal.mjs';

const TROPHY_1ST = [
  '     <span class="trophy-gold">___________</span>',
  '    <span class="trophy-gold">\'._==_==_=_.\'</span>',
  '    <span class="trophy-gold">.-\\:      /-.</span>',
  '   <span class="trophy-gold">| (|:.)(.:)|  |</span>',
  '    <span class="trophy-gold\'>-|:.):( |-\'</span>',
  '      <span class="trophy-gold">\\:googl:/</span>',
  '       <span class="trophy-gold">\'googl\'</span>',
  '         <span class="trophy-gold">)googl(</span>',
  '       <span class="trophy-gold">_googl_</span>',
  '      <span class="trophy-gold">\'._____\'</span>',
].join('\n').replace(/googl/g, '._|@|_.');

const TROPHY_ART = `<span class="trophy-gold">  ♛  #1</span>  <span class="trophy-silver">♕  #2</span>  <span class="trophy-bronze">♕  #3</span>`;

/**
 * Render a horizontal bar using block characters.
 * @param {number} pct 0-100
 * @param {number} width total bar width in chars
 * @param {string} color CSS color
 */
function renderBar(pct, width, color) {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `<span style="color:${color}">${bar}</span>`;
}

/**
 * Format duration in ms to human-readable.
 */
function fmtDur(ms) {
  if (!ms) return '-';
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const rem = Math.floor(secs % 60);
  return `${mins}m${rem.toString().padStart(2, '0')}s`;
}

/**
 * Render the leaderboard section into the given element.
 */
export function renderLeaderboard(el, state) {
  const lb = state.leaderboard;
  if (!lb || lb.length === 0) {
    el.innerHTML = '<div class="term-empty">No performance data yet.</div>';
    return;
  }

  const pad = (s, w) => s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length);
  const padR = (s, w) => s.length >= w ? s.slice(0, w) : ' '.repeat(w - s.length) + s;

  // Column widths
  const cRank = 4;
  const cAgent = 18;
  const cTasks = 5;
  const cSucc = 12; // includes bar
  const cAvg = 8;
  const cScore = 6;
  const cStreak = 6;

  let html = '';

  // Trophy header for top 3
  if (lb.length >= 1) {
    html += '<div class="lb-trophies">';
    html += TROPHY_ART;
    html += '</div>';

    // Podium: show top 3 names
    html += '<div class="lb-podium">';
    for (let i = 0; i < Math.min(3, lb.length); i++) {
      const entry = lb[i];
      const color = getAgentColor(entry.agentId);
      const medal = i === 0 ? 'trophy-gold' : i === 1 ? 'trophy-silver' : 'trophy-bronze';
      const name = abbreviateId(entry.agentId);
      html += `<span class="${medal}" style="margin-right:12px"><span style="color:${color}">${escapeHtml(name)}</span> ${entry.score}pts</span>`;
    }
    html += '</div>';
  }

  // Table
  html += '<div class="term-table lb-table">';

  // Header
  html += '<div class="term-table-header">';
  html += `┌${'─'.repeat(cRank + 2)}┬${'─'.repeat(cAgent + 2)}┬${'─'.repeat(cTasks + 2)}┬${'─'.repeat(cSucc + 2)}┬${'─'.repeat(cAvg + 2)}┬${'─'.repeat(cScore + 2)}┬${'─'.repeat(cStreak + 2)}┐`;
  html += '</div>';
  html += '<div class="term-table-header">';
  html += `│ ${pad('Rank', cRank)} │ ${pad('Agent', cAgent)} │ ${pad('Tasks', cTasks)} │ ${pad('Success%', cSucc)} │ ${pad('Avg Time', cAvg)} │ ${pad('Score', cScore)} │ ${pad('Streak', cStreak)} │`;
  html += '</div>';
  html += '<div class="term-table-header">';
  html += `├${'─'.repeat(cRank + 2)}┼${'─'.repeat(cAgent + 2)}┼${'─'.repeat(cTasks + 2)}┼${'─'.repeat(cSucc + 2)}┼${'─'.repeat(cAvg + 2)}┼${'─'.repeat(cScore + 2)}┼${'─'.repeat(cStreak + 2)}┤`;
  html += '</div>';

  // Rows
  for (const entry of lb) {
    const color = getAgentColor(entry.agentId);
    const isTop = entry.rank === 1;
    const rowClass = isTop ? 'term-row lb-top' : 'term-row';

    const rankIcon = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `#${entry.rank}`;
    const rankStr = pad(rankIcon, cRank);
    const agentStr = pad(abbreviateId(entry.agentId), cAgent);
    const tasksStr = padR(String(entry.totalTasks), cTasks);
    const succPct = entry.successRate;

    // Bar (6 chars) + percentage
    const barWidth = 6;
    const barColor = succPct >= 80 ? '#22c55e' : succPct >= 50 ? '#f59e0b' : '#ef4444';
    const bar = renderBar(succPct, barWidth, barColor);
    const succStr = `${bar} ${padR(succPct.toFixed(0) + '%', 4)}`;

    const avgStr = padR(fmtDur(entry.avgDuration), cAvg);
    const scoreStr = padR(String(entry.score), cScore);
    const streakStr = entry.streak > 0
      ? padR('🔥' + entry.streak, cStreak)
      : padR('-', cStreak);

    html += `<div class="${rowClass}">`;
    html += `│ ${rankStr} │ <span style="color:${color}">${escapeHtml(agentStr)}</span> │ ${tasksStr} │ ${succStr} │ ${avgStr} │ ${scoreStr} │ ${streakStr} │`;
    html += '</div>';
  }

  // Footer
  html += '<div class="term-table-footer">';
  html += `└${'─'.repeat(cRank + 2)}┴${'─'.repeat(cAgent + 2)}┴${'─'.repeat(cTasks + 2)}┴${'─'.repeat(cSucc + 2)}┴${'─'.repeat(cAvg + 2)}┴${'─'.repeat(cScore + 2)}┴${'─'.repeat(cStreak + 2)}┘`;
  html += '</div>';
  html += '</div>';

  el.innerHTML = html;
}
