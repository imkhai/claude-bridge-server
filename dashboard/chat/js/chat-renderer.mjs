/**
 * Chat Renderer — renders messages with markdown support.
 */

/**
 * Convert markdown text to HTML.
 */
export function markdownToHtml(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  // Code blocks with language label
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const header = lang
      ? `<div class="code-block-header"><span>${lang}</span><button class="copy-code-btn" onclick="navigator.clipboard.writeText(this.closest('.code-block-wrapper').querySelector('code').textContent)">Copy</button></div>`
      : '';
    return `<div class="code-block-wrapper">${header}<pre><code class="language-${lang || 'text'}">${code.trim()}</code></pre></div>`;
  });

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Unordered lists
  html = html.replace(/^(\s*)[-*] (.+)$/gm, '$1<li>$2</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Tables
  html = html.replace(/^\|(.+)\|$/gm, (match, content) => {
    const cells = content.split('|').map(c => c.trim());
    if (cells.every(c => /^[-:]+$/.test(c))) return '<!-- table-sep -->';
    const tag = 'td';
    const row = cells.map(c => `<${tag}>${c}</${tag}>`).join('');
    return `<tr>${row}</tr>`;
  });
  html = html.replace(/((?:<tr>.*<\/tr>\n?<!-- table-sep -->\n?)+)((?:<tr>.*<\/tr>\n?)+)/g, (_, head, body) => {
    const headerRow = head.replace(/<!-- table-sep -->/g, '').replace(/<td>/g, '<th>').replace(/<\/td>/g, '</th>');
    return `<table><thead>${headerRow}</thead><tbody>${body}</tbody></table>`;
  });
  html = html.replace(/<!-- table-sep -->\n?/g, '');

  // Paragraphs: wrap remaining text blocks
  html = html.replace(/\n{2,}/g, '</p><p>');
  // Single newlines within paragraphs
  html = html.replace(/\n/g, '<br>');

  // Wrap in paragraph if not already block-level
  if (!html.startsWith('<')) {
    html = `<p>${html}</p>`;
  }

  return html;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Format timestamp for display.
 */
export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  if (isToday) return `${hours}:${mins}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hours}:${mins}`;
}

/**
 * Format duration in seconds to human readable.
 */
export function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

/**
 * Render a user message bubble.
 */
export function renderUserMessage(msg) {
  const el = document.createElement('div');
  el.className = 'message user';
  el.dataset.messageId = msg.id || '';

  const filesHtml = renderFileAttachments(msg.files);

  el.innerHTML = `
    <div class="message-avatar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    </div>
    <div class="message-body">
      <div class="message-header">
        <span class="message-sender">You</span>
        <span class="message-time">${formatTime(msg.timestamp)}</span>
      </div>
      <div class="message-content">${markdownToHtml(msg.content)}</div>
      ${filesHtml}
    </div>
  `;
  return el;
}

/**
 * Render an agent message bubble.
 */
export function renderAgentMessage(msg) {
  const el = document.createElement('div');
  el.className = 'message agent';
  el.dataset.messageId = msg.id || '';

  const agentName = msg.agentId || 'Agent';
  const badge = msg.agentId
    ? `<span class="agent-badge"><span class="agent-badge-dot"></span>${msg.agentId}</span>`
    : '';
  const duration = msg.duration
    ? `<div class="message-duration"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>${formatDuration(msg.duration)}</div>`
    : '';

  el.innerHTML = `
    <div class="message-avatar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
      <span class="avatar-status ${msg.status || 'done'}"></span>
    </div>
    <div class="message-body">
      <div class="message-header">
        <span class="message-sender">${agentName}</span>
        ${badge}
        <span class="message-time">${formatTime(msg.timestamp)}</span>
      </div>
      <div class="message-content">${markdownToHtml(msg.content)}</div>
      ${duration}
    </div>
  `;
  return el;
}

/**
 * Render a system message (routing info, status updates).
 */
export function renderSystemMessage(msg) {
  const el = document.createElement('div');
  el.className = 'message system';
  el.dataset.messageId = msg.id || '';

  el.innerHTML = `
    <div class="message-content">${markdownToHtml(msg.content)}</div>
  `;
  return el;
}

/**
 * Render file attachments inside a message.
 */
function renderFileAttachments(files) {
  if (!files || files.length === 0) return '';

  const items = files.map(f => {
    const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(f.filename || f.path || f);
    const name = f.filename || (typeof f === 'string' ? f.split('/').pop() : 'file');
    const path = f.path || f;

    if (isImage) {
      return `<div class="message-file-thumb"><img src="/api/chat/file/${encodeURIComponent(path)}" alt="${name}" loading="lazy"></div>`;
    }
    return `
      <div class="message-file-chip">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
        ${name}
      </div>
    `;
  }).join('');

  return `<div class="message-files">${items}</div>`;
}
