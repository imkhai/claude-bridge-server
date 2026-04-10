/**
 * Chat App — main application entry point.
 * Initializes all modules, wires events, manages state.
 */

import * as api from './chat-api.mjs';
import * as renderer from './chat-renderer.mjs';
import * as upload from './chat-upload.mjs';
import * as history from './chat-history.mjs';
import * as agents from './chat-agents.mjs';

// ===== State =====
let currentConversationId = null;
let currentSSE = null;
let isWaitingForResponse = false;

// ===== DOM Elements =====
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const welcomeScreen = document.getElementById('welcomeScreen');
const typingIndicator = document.getElementById('typingIndicator');

// ===== Mobile Helpers =====
const isMobile = () => window.innerWidth <= 768;

function initMobile() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const hamburger = document.getElementById('hamburgerBtn');

  // Hamburger toggle
  hamburger.addEventListener('click', () => {
    const isOpen = sidebar.classList.contains('mobile-open');
    if (isOpen) {
      closeMobileSidebar();
    } else {
      sidebar.classList.add('mobile-open');
      sidebar.classList.remove('collapsed');
      backdrop.classList.add('visible');
    }
  });

  // Backdrop closes sidebar
  backdrop.addEventListener('click', closeMobileSidebar);

  // Close sidebar on conversation select (mobile)
  sidebar.addEventListener('click', (e) => {
    if (isMobile() && e.target.closest('.conv-item')) {
      closeMobileSidebar();
    }
  });
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  sidebar.classList.remove('mobile-open');
  backdrop.classList.remove('visible');
}

function initVirtualKeyboard() {
  if (!window.visualViewport) return;

  const appLayout = document.querySelector('.app-layout');
  const inputArea = document.querySelector('.chat-input-area');

  window.visualViewport.addEventListener('resize', () => {
    // Detect keyboard: visual viewport significantly shorter than layout viewport
    const keyboardHeight = window.innerHeight - window.visualViewport.height;
    const isKeyboardOpen = keyboardHeight > 100;

    if (isKeyboardOpen) {
      document.body.classList.add('keyboard-open');
      // Adjust app layout height to account for keyboard
      appLayout.style.height = `${window.visualViewport.height - document.querySelector('.header').offsetHeight}px`;
      // Scroll input into view
      requestAnimationFrame(() => {
        inputArea.scrollIntoView({ block: 'end', behavior: 'smooth' });
      });
    } else {
      document.body.classList.remove('keyboard-open');
      appLayout.style.height = '';
    }
  });

  window.visualViewport.addEventListener('scroll', () => {
    // Prevent visual viewport from scrolling away from input when keyboard is open
    if (document.body.classList.contains('keyboard-open')) {
      window.scrollTo(0, 0);
    }
  });
}

// ===== Initialize =====
function init() {
  // Init modules
  upload.init({
    chatMain: document.getElementById('chatMain'),
    dropOverlay: document.getElementById('dropOverlay'),
    fileInput: document.getElementById('fileInput'),
    attachBtn: document.getElementById('attachBtn'),
    filePreviewBar: document.getElementById('filePreviewBar'),
    filePreviews: document.getElementById('filePreviews'),
    onFilesChanged: (files) => {
      updateSendButton();
    },
  });

  history.init({
    onConversationSelect: loadConversation,
    onNewChat: newConversation,
  });

  agents.init({});

  // Load conversations, then restore last active conversation
  history.loadConversations().then(() => {
    // Check URL param first, then sessionStorage fallback
    const params = new URLSearchParams(window.location.search);
    const convId = params.get('conv') || sessionStorage.getItem('activeConversationId');
    if (convId) {
      loadConversation(convId);
    }
  });

  // Wire input events
  chatInput.addEventListener('input', () => {
    autoResize();
    updateSendButton();
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  sendBtn.addEventListener('click', handleSend);

  // Hint chips
  document.querySelectorAll('.hint-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chatInput.value = chip.dataset.hint;
      autoResize();
      updateSendButton();
      chatInput.focus();
    });
  });

  // Mode switch
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Mode functionality can be extended
    });
  });

  // Mobile: hamburger, backdrop, virtual keyboard
  initMobile();
  initVirtualKeyboard();

  chatInput.focus();
}

// ===== Send Message =====
async function handleSend() {
  const text = chatInput.value.trim();
  if ((!text && upload.getPendingCount() === 0) || isWaitingForResponse) return;

  // Upload files first if any
  let uploadedFiles = [];
  if (upload.getPendingCount() > 0) {
    try {
      uploadedFiles = await upload.uploadPendingFiles();
    } catch (err) {
      appendSystemMessage(`File upload failed: ${err.message}`);
      return;
    }
  }

  // Hide welcome screen
  if (welcomeScreen) {
    welcomeScreen.style.display = 'none';
  }

  // Render user message
  const userMsg = {
    id: `msg-${Date.now()}`,
    role: 'user',
    content: text,
    files: uploadedFiles,
    timestamp: new Date().toISOString(),
  };
  chatMessages.appendChild(renderer.renderUserMessage(userMsg));
  scrollToBottom();

  // Clear input
  chatInput.value = '';
  autoResize();
  updateSendButton();

  // Set waiting state
  isWaitingForResponse = true;
  updateSendButton();
  showTyping(true);
  agents.clear();

  // Send to server
  try {
    const filePaths = uploadedFiles.map(f => f.path);
    const result = await api.sendMessage(currentConversationId, text, filePaths);

    currentConversationId = result.conversationId;
    history.setActive(currentConversationId);

    // Persist active conversation for reload
    const url = new URL(window.location);
    url.searchParams.set('conv', currentConversationId);
    window.history.replaceState({}, '', url);
    sessionStorage.setItem('activeConversationId', currentConversationId);

    // Update conversation in sidebar
    history.upsertConversation({
      id: result.conversationId,
      title: text.substring(0, 60),
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    // Show routing info
    if (result.routing) {
      const agentList = result.routing.agents.join(' \u2192 ');
      appendSystemMessage(`Routing: **${result.routing.pattern}** \u2014 ${agentList}`);
    }

    // Connect SSE for real-time updates
    connectToStream(result.conversationId);

  } catch (err) {
    console.error('Send error:', err);
    appendSystemMessage(`Error sending message: ${err.message}`);
    showTyping(false);
    isWaitingForResponse = false;
    updateSendButton();
  }
}

// ===== SSE Stream =====
function connectToStream(conversationId) {
  // Close existing SSE
  if (currentSSE) {
    currentSSE.close();
    currentSSE = null;
  }

  currentSSE = api.connectSSE(conversationId, {
    onRouting(data) {
      const r = data.routing || data;
      if (r.agents) {
        const list = r.agents.join(' \u2192 ');
        appendSystemMessage(`Spawning team: ${list}`);
      }
    },

    onAgentStart(data) {
      // Use agentId as canonical key — taskId isn't available until job completes
      agents.addAgent(data.agentId, data.agentId, 'running');
      showTyping(true, `${data.agentId} is working...`);
    },

    onAgentProgress(data) {
      agents.updateProgress(data.agentId, data);
    },

    onAgentDone(data) {
      // Server sends agent-message with {id, agentId, content, taskId, duration, status}
      agents.agentDone(data.agentId, data.content);

      const msg = {
        id: data.id || `msg-${Date.now()}-${data.agentId}`,
        role: 'agent',
        agentId: data.agentId,
        content: data.content || data.result || 'Task completed.',
        taskId: data.taskId,
        duration: data.duration,
        timestamp: data.timestamp || new Date().toISOString(),
        status: 'done',
      };
      chatMessages.appendChild(renderer.renderAgentMessage(msg));
      scrollToBottom();
    },

    onAgentError(data) {
      agents.agentError(data.agentId, data.error || data.content);

      const msg = {
        id: data.id || `msg-${Date.now()}-${data.agentId}`,
        role: 'agent',
        agentId: data.agentId,
        content: data.error || data.content || 'Agent failed',
        taskId: data.taskId,
        duration: data.duration,
        timestamp: data.timestamp || new Date().toISOString(),
        status: 'error',
      };
      chatMessages.appendChild(renderer.renderAgentMessage(msg));
      scrollToBottom();
    },

    onMessage(data) {
      // Generic message event
      if (data.role === 'agent') {
        const msg = {
          id: data.id || `msg-${Date.now()}`,
          role: 'agent',
          agentId: data.agentId,
          content: data.content,
          duration: data.duration,
          timestamp: data.timestamp || new Date().toISOString(),
          status: data.status || 'done',
        };
        chatMessages.appendChild(renderer.renderAgentMessage(msg));
        scrollToBottom();
      } else if (data.role === 'system') {
        appendSystemMessage(data.content);
      }
    },

    onDone(data) {
      showTyping(false);
      isWaitingForResponse = false;
      updateSendButton();
      if (data && data.summary) {
        appendSystemMessage(data.summary);
      }
      // Refresh conversation list
      history.loadConversations();
    },

    onError() {
      // Only reset if SSE connection is permanently closed (CLOSED = 2)
      // EventSource auto-reconnects, so don't reset on transient errors
      if (currentSSE && currentSSE.readyState === EventSource.CLOSED) {
        showTyping(false);
        isWaitingForResponse = false;
        updateSendButton();
      }
    },
  });
}

// ===== Load Conversation =====
async function loadConversation(conversationId) {
  try {
    const conv = await api.getConversation(conversationId);
    currentConversationId = conversationId;
    history.setActive(conversationId);

    // Persist active conversation for reload
    const url = new URL(window.location);
    url.searchParams.set('conv', conversationId);
    window.history.replaceState({}, '', url);
    sessionStorage.setItem('activeConversationId', conversationId);

    // Clear messages
    chatMessages.innerHTML = '';
    if (welcomeScreen) welcomeScreen.style.display = 'none';
    agents.clear();

    // Render all messages
    for (const msg of (conv.messages || [])) {
      if (msg.role === 'user') {
        chatMessages.appendChild(renderer.renderUserMessage(msg));
      } else if (msg.role === 'agent') {
        chatMessages.appendChild(renderer.renderAgentMessage(msg));
      } else if (msg.role === 'system') {
        chatMessages.appendChild(renderer.renderSystemMessage(msg));
      }
    }
    scrollToBottom();

    // Connect SSE so any in-flight agent results auto-appear
    connectToStream(conversationId);
  } catch (err) {
    console.error('Failed to load conversation:', err);
    appendSystemMessage(`Failed to load conversation: ${err.message}`);
  }
}

// ===== New Conversation =====
function newConversation() {
  currentConversationId = null;
  history.setActive(null);

  // Clear persisted conversation
  const url = new URL(window.location);
  url.searchParams.delete('conv');
  window.history.replaceState({}, '', url);
  sessionStorage.removeItem('activeConversationId');

  chatMessages.innerHTML = '';
  agents.clear();
  upload.clearPending();
  showTyping(false);
  isWaitingForResponse = false;

  if (currentSSE) {
    currentSSE.close();
    currentSSE = null;
  }

  // Show welcome
  if (welcomeScreen) {
    chatMessages.appendChild(welcomeScreen);
    welcomeScreen.style.display = '';
  }

  updateSendButton();
  chatInput.focus();
}

// ===== Helpers =====
function appendSystemMessage(content) {
  const msg = {
    id: `sys-${Date.now()}`,
    role: 'system',
    content,
    timestamp: new Date().toISOString(),
  };
  chatMessages.appendChild(renderer.renderSystemMessage(msg));
  scrollToBottom();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

function showTyping(show, label = 'Agents are working...') {
  if (show) {
    typingIndicator.classList.remove('hidden');
    const labelEl = typingIndicator.querySelector('.typing-label');
    if (labelEl) labelEl.textContent = label;
  } else {
    typingIndicator.classList.add('hidden');
  }
}

function autoResize() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
}

function updateSendButton() {
  const hasText = chatInput.value.trim().length > 0;
  const hasFiles = upload.getPendingCount() > 0;
  sendBtn.disabled = (!hasText && !hasFiles) || isWaitingForResponse;
}

// ===== Start =====
document.addEventListener('DOMContentLoaded', init);
