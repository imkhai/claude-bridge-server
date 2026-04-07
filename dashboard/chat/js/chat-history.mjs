/**
 * Chat History — sidebar conversation list and file history.
 */

import * as api from './chat-api.mjs';
import { getFileCategory } from './chat-upload.mjs';

let conversations = [];
let activeConversationId = null;
let onConversationSelect = null;
let onNewChat = null;

/**
 * Initialize history module.
 */
export function init(opts) {
  onConversationSelect = opts.onConversationSelect || (() => {});
  onNewChat = opts.onNewChat || (() => {});

  // Tab switching
  document.querySelectorAll('.sidebar-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.sidebar-content').forEach(c => c.classList.add('hidden'));
      const target = document.getElementById(`tab-${tab.dataset.tab}`);
      if (target) target.classList.remove('hidden');

      if (tab.dataset.tab === 'files') loadFiles();
    });
  });

  // New chat button
  document.getElementById('newChatBtn').addEventListener('click', () => {
    onNewChat();
  });

  // Search conversations
  document.getElementById('searchConversations').addEventListener('input', (e) => {
    renderConversationList(e.target.value.toLowerCase());
  });

  // Search files
  document.getElementById('searchFiles').addEventListener('input', (e) => {
    filterFiles(e.target.value.toLowerCase());
  });
}

/**
 * Load conversations from server.
 */
export async function loadConversations() {
  try {
    const result = await api.getConversations();
    conversations = result.conversations || result || [];
    conversations.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    renderConversationList();
  } catch (err) {
    console.error('Failed to load conversations:', err);
    conversations = [];
    renderConversationList();
  }
}

/**
 * Set active conversation.
 */
export function setActive(conversationId) {
  activeConversationId = conversationId;
  renderConversationList();
}

/**
 * Add or update a conversation in the list.
 */
export function upsertConversation(conv) {
  const idx = conversations.findIndex(c => c.id === conv.id);
  if (idx >= 0) {
    conversations[idx] = { ...conversations[idx], ...conv };
  } else {
    conversations.unshift(conv);
  }
  renderConversationList();
}

/**
 * Render conversation list, optionally filtered.
 */
function renderConversationList(filter = '') {
  const container = document.getElementById('conversationList');
  container.innerHTML = '';

  const filtered = filter
    ? conversations.filter(c => (c.title || '').toLowerCase().includes(filter))
    : conversations;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:40px 16px; color:var(--text-dim); font-size:13px;">
        ${filter ? 'No matching conversations' : 'No conversations yet'}
      </div>
    `;
    return;
  }

  // Group by date
  const groups = groupByDate(filtered);

  for (const [label, items] of Object.entries(groups)) {
    const groupLabel = document.createElement('div');
    groupLabel.className = 'conv-group-label';
    groupLabel.textContent = label;
    container.appendChild(groupLabel);

    for (const conv of items) {
      const item = createConversationItem(conv);
      container.appendChild(item);
    }
  }
}

function createConversationItem(conv) {
  const item = document.createElement('div');
  item.className = `conv-item${conv.id === activeConversationId ? ' active' : ''}`;
  item.dataset.id = conv.id;

  const preview = getPreview(conv);
  const time = formatShortTime(conv.updatedAt || conv.createdAt);

  item.innerHTML = `
    <div class="conv-item-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    </div>
    <div class="conv-item-text">
      <div class="conv-item-title">${escapeHtml(conv.title || 'Untitled')}</div>
      <div class="conv-item-preview">${escapeHtml(preview)}</div>
    </div>
    <span class="conv-item-time">${time}</span>
    <button class="conv-item-delete" title="Delete conversation">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
    </button>
  `;

  item.addEventListener('click', (e) => {
    if (e.target.closest('.conv-item-delete')) return;
    onConversationSelect(conv.id);
  });

  item.querySelector('.conv-item-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    showDeleteConfirm(conv);
  });

  return item;
}

function showDeleteConfirm(conv) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <h3>Delete conversation?</h3>
      <p>This will permanently delete "${escapeHtml(conv.title || 'Untitled')}". This action cannot be undone.</p>
      <div class="confirm-actions">
        <button class="confirm-btn cancel-btn">Cancel</button>
        <button class="confirm-btn danger delete-btn">Delete</button>
      </div>
    </div>
  `;

  overlay.querySelector('.cancel-btn').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('.delete-btn').addEventListener('click', async () => {
    try {
      await api.deleteConversation(conv.id);
      conversations = conversations.filter(c => c.id !== conv.id);
      if (activeConversationId === conv.id) {
        activeConversationId = null;
        onNewChat();
      }
      renderConversationList();
    } catch (err) {
      console.error('Delete failed:', err);
    }
    overlay.remove();
  });

  document.body.appendChild(overlay);
}

/**
 * Load and render files tab.
 */
let allFiles = [];

async function loadFiles() {
  try {
    const result = await api.getFiles();
    allFiles = result.files || result || [];
    renderFileList();
  } catch (err) {
    console.error('Failed to load files:', err);
    allFiles = [];
    renderFileList();
  }
}

function renderFileList(filter = '') {
  const container = document.getElementById('fileList');
  container.innerHTML = '';

  const filtered = filter
    ? allFiles.filter(f => (f.filename || f.name || '').toLowerCase().includes(filter))
    : allFiles;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:40px 16px; color:var(--text-dim); font-size:13px;">
        ${filter ? 'No matching files' : 'No uploaded files'}
      </div>
    `;
    return;
  }

  const groups = groupByDate(filtered, 'uploadedAt');

  for (const [label, items] of Object.entries(groups)) {
    const groupLabel = document.createElement('div');
    groupLabel.className = 'conv-group-label';
    groupLabel.textContent = label;
    container.appendChild(groupLabel);

    for (const file of items) {
      const item = createFileItem(file);
      container.appendChild(item);
    }
  }
}

function filterFiles(query) {
  renderFileList(query);
}

function createFileItem(file) {
  const item = document.createElement('div');
  item.className = 'file-item';

  const name = file.filename || file.name || 'unknown';
  const cat = getFileCategory(name);
  const ext = name.split('.').pop().toUpperCase();
  const size = file.size ? formatFileSize(file.size) : '';

  item.innerHTML = `
    <div class="file-icon ${cat}">${ext}</div>
    <div class="file-info">
      <div class="file-name">${escapeHtml(name)}</div>
      <div class="file-meta">${size}${file.conversationId ? ' \u00B7 Conversation' : ''}</div>
    </div>
  `;

  return item;
}

// === Utilities ===

function groupByDate(items, dateField = 'updatedAt') {
  const groups = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);

  for (const item of items) {
    const d = new Date(item[dateField] || item.createdAt || Date.now());
    let label;
    if (d >= today) label = 'Today';
    else if (d >= yesterday) label = 'Yesterday';
    else if (d >= weekAgo) label = 'This Week';
    else label = 'Older';

    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  }

  return groups;
}

function getPreview(conv) {
  if (!conv.messages || conv.messages.length === 0) return 'Empty conversation';
  const last = conv.messages[conv.messages.length - 1];
  return (last.content || '').substring(0, 60);
}

function formatShortTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
