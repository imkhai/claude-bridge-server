// Rich interaction system — speech bubbles, discussion state machine, detail panel, tooltips
// Inspired by Hive OfficeSimulation speech bubble and golden milestone patterns
import { getAgentColor, abbreviateId } from '../state.mjs';

const PIXI = window.PIXI;

// ── Discussion timing ──────────────────────────────────────────────────────────
const DISCUSSION_SHOW_MS = 4000;
const DISCUSSION_GAP_MS_MIN = 500;
const DISCUSSION_GAP_MS_MAX = 1500;
const GOLDEN_INTERVAL_MIN = 45000;
const GOLDEN_INTERVAL_MAX = 75000;
const TYPEWRITER_WORD_INTERVAL_MIN = 280;
const TYPEWRITER_WORD_INTERVAL_MAX = 530;

// ── Workflow message pools (10+ per category) ──────────────────────────────────
const WORKFLOW_MESSAGES = {
  researching: [
    '🔬 Investigating the problem...',
    '📚 Reading documentation...',
    '🌐 Searching for examples...',
    '📊 Comparing approaches...',
    '🧪 Testing a hypothesis...',
    '📝 Documenting findings...',
    '🔍 Deep-diving into the code...',
    '📖 Checking API references...',
    '🧩 Mapping dependencies...',
    '💡 Found a promising lead!',
    '📋 Compiling research notes...',
  ],
  coding: [
    '💻 Writing implementation...',
    '🔨 Building the feature...',
    '📝 Writing TypeScript types...',
    '🧪 Running test suite...',
    '🐛 Debugging a failing test...',
    '🔧 Refactoring for clarity...',
    '📦 npm run build...',
    '✅ All tests passing!',
    '🚀 Pushing changes...',
    '🔄 Resolving merge conflict...',
    '⚡ Optimizing performance...',
  ],
  reviewing: [
    '📋 Opening the diff...',
    '🔍 Checking type safety...',
    '🛡️ Scanning for vulnerabilities...',
    '⚠️ Found a potential issue...',
    '📝 Writing review comments...',
    '🔄 Requesting changes...',
    '✅ LGTM — approved!',
    '👀 Double-checking edge cases...',
    '📊 Reviewing test coverage...',
    '🧹 Suggesting cleanup...',
    '🎯 Verifying requirements...',
  ],
  planning: [
    '🧠 Analyzing requirements...',
    '📐 Drawing architecture...',
    '📊 Evaluating trade-offs...',
    '🏗️ Designing data model...',
    '📝 Writing design spec...',
    '🔌 Planning API contracts...',
    '✅ Architecture spec done!',
    '🗺️ Mapping the roadmap...',
    '⚖️ Weighing alternatives...',
    '📋 Breaking into subtasks...',
    '🎯 Defining acceptance criteria...',
  ],
  security: [
    '🔒 Running security scan...',
    '🛡️ Checking OWASP Top 10...',
    '🔐 Auditing auth flow...',
    '⚠️ Found a vulnerability...',
    '📝 Writing security report...',
    '🔑 Reviewing key management...',
    '✅ Security audit passed!',
    '🧪 Testing input validation...',
    '🕵️ Checking for injection...',
    '📊 Assessing risk level...',
    '🔍 Scanning dependencies...',
  ],
  general: [
    '📋 Processing the task...',
    '🔄 Working on it...',
    '📊 Making progress...',
    '🧹 Cleaning up...',
    '📝 Writing output...',
    '✅ Almost there...',
    '💡 Had an insight!',
    '🔍 Looking into details...',
    '⚙️ Configuring settings...',
    '📦 Packaging results...',
    '🎯 Staying focused...',
  ],
};

// Agent ID keywords → message pool mapping
const AGENT_POOL_MAP = [
  { patterns: ['research', 'analyze', 'investigate'], pool: 'researching' },
  { patterns: ['security', 'audit', 'scan'], pool: 'security' },
  { patterns: ['review', 'qa', 'test'], pool: 'reviewing' },
  { patterns: ['lead', 'architect', 'plan'], pool: 'planning' },
  { patterns: ['engineer', 'impl', 'code', 'dev', 'senior', 'frontend', 'backend'], pool: 'coding' },
];

function getPoolForAgent(agentId) {
  const id = agentId.toLowerCase();
  for (const entry of AGENT_POOL_MAP) {
    if (entry.patterns.some((p) => id.includes(p))) return entry.pool;
  }
  return 'general';
}

const GOLDEN_MILESTONES = [
  '🚀 Deployed to production!',
  '✅ All tests passing!',
  '🎉 Feature shipped!',
  '⚡ Build time improved 40%!',
  '🔒 Security audit passed!',
  '📦 Docker image built!',
  '🚢 PR merged to main!',
  '📊 Context cleanup complete!',
  '💎 Zero warnings achieved!',
  '🏆 Sprint goal completed!',
];

// ── Bubble factory (PixiJS 8) ──────────────────────────────────────────────────

function createBubble(text, type = 'regular') {
  const c = new PIXI.Container();
  const w = Math.max(text.length * 5.2 + 18, 56);

  let bgColor, bgAlpha, borderColor, borderAlpha, textColor, fontSize, fontWeight;
  if (type === 'golden') {
    bgColor = 0xfef3c7; bgAlpha = 0.95;
    borderColor = 0xf59e0b; borderAlpha = 0.7;
    textColor = 0x78350f; fontSize = 9; fontWeight = '700';
  } else if (type === 'error') {
    bgColor = 0xfee2e2; bgAlpha = 0.95;
    borderColor = 0xf85149; borderAlpha = 0.7;
    textColor = 0x7f1d1d; fontSize = 8; fontWeight = '600';
  } else {
    bgColor = 0xffffff; bgAlpha = 0.92;
    borderColor = 0xd1d5db; borderAlpha = 0.5;
    textColor = 0x1e293b; fontSize = 8; fontWeight = '600';
  }

  const bg = new PIXI.Graphics();
  // Rounded rect body
  bg.roundRect(-w / 2, -54, w, 20, 6).fill({ color: bgColor, alpha: bgAlpha });
  // Tail pointer toward agent
  bg.moveTo(-4, -34).lineTo(0, -28).lineTo(4, -34).closePath().fill({ color: bgColor, alpha: bgAlpha });
  // Border stroke
  bg.roundRect(-w / 2, -54, w, 20, 6).stroke({ width: type === 'golden' ? 0.8 : 0.5, color: borderColor, alpha: borderAlpha });
  c.addChild(bg);

  // Empty text — filled by typewriter
  const t = new PIXI.Text({
    text: '',
    style: {
      fontSize,
      fill: textColor,
      fontFamily: 'Inter, system-ui, sans-serif',
      fontWeight,
    },
  });
  t.anchor.set(0.5, 0.5);
  t.y = -44;
  c.addChild(t);

  c.scale.set(0);
  return c;
}

// ── Spring scale animation ─────────────────────────────────────────────────────

function springScale(bubble, ticker) {
  let elapsed = 0;
  const step = (tick) => {
    if (!bubble || bubble.destroyed) { ticker.remove(step); return; }
    elapsed += tick.deltaMS;
    const t = Math.min(elapsed / 300, 1);
    // Overshoot to 1.05 then settle to 1.0
    const sc = t < 0.6
      ? (t / 0.6) * 1.05
      : 1.05 - 0.05 * ((t - 0.6) / 0.4);
    bubble.scale.set(sc);
    if (t >= 1) { bubble.scale.set(1); ticker.remove(step); }
  };
  ticker.add(step);
}

// ── Typewriter effect (word-by-word) ───────────────────────────────────────────

function typewriterBubble(bubble, fullText, ticker, speed = 'normal') {
  const textObj = bubble.children[1];
  if (!textObj) return;

  const words = fullText.split(' ');
  let wordIdx = 0;
  let elapsed = 0;
  const interval = speed === 'fast'
    ? 150
    : TYPEWRITER_WORD_INTERVAL_MIN + Math.random() * (TYPEWRITER_WORD_INTERVAL_MAX - TYPEWRITER_WORD_INTERVAL_MIN);

  const step = (tick) => {
    if (!bubble || bubble.destroyed) { ticker.remove(step); return; }
    elapsed += tick.deltaMS;
    if (elapsed >= interval) {
      elapsed -= interval;
      wordIdx++;
      if (wordIdx <= words.length) textObj.text = words.slice(0, wordIdx).join(' ');
      if (wordIdx >= words.length) ticker.remove(step);
    }
  };
  ticker.add(step);
}

// ── Fade out and destroy ───────────────────────────────────────────────────────

function fadeOutBubble(bubble, ticker, duration = 300) {
  if (!bubble || bubble.destroyed) return;
  let elapsed = 0;
  const step = (tick) => {
    if (!bubble || bubble.destroyed) { ticker.remove(step); return; }
    elapsed += tick.deltaMS;
    const t = Math.min(elapsed / duration, 1);
    bubble.alpha = 1 - t;
    if (t >= 1) {
      ticker.remove(step);
      bubble.destroy();
    }
  };
  ticker.add(step);
}

// ── Per-agent discussion state ─────────────────────────────────────────────────

class AgentDiscussion {
  constructor(agentId) {
    this.agentId = agentId;
    this.phase = 'idle'; // idle | showing | gap
    this.showTimer = 0;
    this.gapTimer = 0;
    this.goldenTimer = GOLDEN_INTERVAL_MIN + Math.random() * (GOLDEN_INTERVAL_MAX - GOLDEN_INTERVAL_MIN);
    this.workflowIndex = 0;
    this.pool = getPoolForAgent(agentId);
    this.currentBubble = null;
  }

  pickMessage() {
    const messages = WORKFLOW_MESSAGES[this.pool] || WORKFLOW_MESSAGES.general;
    const msg = messages[this.workflowIndex % messages.length];
    this.workflowIndex++;
    return msg;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Main Interactions class
// ══════════════════════════════════════════════════════════════════════════════

export class Interactions {
  constructor(state) {
    this.state = state;
    this.detailPanel = null;
    this.tooltip = null;
    this.selectedAgentId = null;
    this.flashAgentId = null;
    this.flashTimer = 0;

    // Discussion state per agent
    this.discussions = new Map();

    // Tooltip delay
    this._hoverAgentId = null;
    this._hoverDelayTimer = 0;
    this._hoverDelayThreshold = 300; // ms before showing tooltip
    this._tooltipVisible = false;

    // Ticker reference (set via setTicker)
    this._ticker = null;

    // Agent containers (set via setAgentContainers)
    this._agentContainers = new Map();

    this._createDetailPanel();
    this._createTooltip();
  }

  /**
   * Must be called after PixiJS app is ready to enable speech bubbles.
   */
  setTicker(ticker) {
    this._ticker = ticker;
  }

  /**
   * Register an agent's PixiJS container for speech bubble attachment.
   */
  setAgentContainer(agentId, container) {
    this._agentContainers.set(agentId, container);
  }

  // ── Detail Panel ───────────────────────────────────────────────────────────

  _createDetailPanel() {
    let panel = document.getElementById('agent-detail-panel');
    if (panel) { this.detailPanel = panel; return; }

    panel = document.createElement('div');
    panel.id = 'agent-detail-panel';
    panel.className = 'detail-panel';
    panel.innerHTML = `
      <button class="close-btn" id="detail-close">&times;</button>
      <div class="detail-header">
        <div class="detail-avatar-mini" id="detail-avatar"></div>
        <div class="detail-header-text">
          <span class="detail-color-badge" id="detail-badge"></span>
          <h3 id="detail-agent-name"></h3>
        </div>
      </div>
      <div class="detail-status-bar" id="detail-status-bar">
        <span class="status-dot" id="detail-status-dot"></span>
        <span class="status-label" id="detail-status"></span>
      </div>
      <div class="detail-section">
        <div class="detail-row">
          <span class="detail-label">MODEL / CONFIG</span>
          <span class="detail-value" id="detail-model">claude -p</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">TASK ID</span>
          <span class="detail-value" id="detail-task-id"></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">DURATION</span>
          <span class="detail-value" id="detail-duration"></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">COMPLETED TASKS</span>
          <span class="detail-value" id="detail-completed"></span>
        </div>
      </div>
      <div class="detail-section">
        <span class="detail-label">CURRENT SESSION</span>
        <div class="detail-progress-bar" id="detail-progress-wrap">
          <div class="detail-progress-fill" id="detail-progress-fill"></div>
          <span class="detail-progress-text" id="detail-progress-text"></span>
        </div>
      </div>
      <div class="detail-section">
        <span class="detail-label">CURRENT PROMPT</span>
        <div class="prompt-text" id="detail-prompt"></div>
      </div>
      <div class="detail-section">
        <span class="detail-label">TASK HISTORY</span>
        <div id="detail-history" class="detail-history"></div>
      </div>
    `;

    const realMode = document.getElementById('real-mode');
    if (realMode) realMode.appendChild(panel);
    this.detailPanel = panel;

    // Close button
    panel.querySelector('#detail-close').addEventListener('click', () => this.closePanel());

    // Escape/Q to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'q') this.closePanel();
    });
  }

  _renderDetailPanel(agentId) {
    const agent = this.state.agents.find((a) => a.agentId === agentId);
    if (!agent) return;

    const color = getAgentColor(agentId);
    const status = agent.status || 'idle';

    // Avatar mini — colored circle with initials
    const avatarEl = this.detailPanel.querySelector('#detail-avatar');
    const initials = agentId.split(/[-_]/).map((p) => p[0]?.toUpperCase() || '').join('').slice(0, 2);
    avatarEl.style.background = color;
    avatarEl.textContent = initials;

    // Badge
    this.detailPanel.querySelector('#detail-badge').style.backgroundColor = color;

    // Agent name
    this.detailPanel.querySelector('#detail-agent-name').textContent = agentId;

    // Status bar
    const statusDot = this.detailPanel.querySelector('#detail-status-dot');
    statusDot.className = `status-dot status-dot-${status}`;
    const statusLabel = this.detailPanel.querySelector('#detail-status');
    statusLabel.textContent = status.toUpperCase();
    statusLabel.className = `status-label status-${status}`;

    // Task ID
    this.detailPanel.querySelector('#detail-task-id').textContent = agent.currentTaskId || '-';

    // Duration
    this.detailPanel.querySelector('#detail-duration').textContent =
      agent.duration ? this.state.formatDuration(agent.duration) : '-';

    // Completed
    this.detailPanel.querySelector('#detail-completed').textContent = agent.completedTasks || 0;

    // Progress indicator
    const progressWrap = this.detailPanel.querySelector('#detail-progress-wrap');
    const progressFill = this.detailPanel.querySelector('#detail-progress-fill');
    const progressText = this.detailPanel.querySelector('#detail-progress-text');
    if (status === 'active' && agent.startedAt) {
      progressWrap.style.display = 'block';
      const elapsed = Date.now() - new Date(agent.startedAt).getTime();
      const timeout = 600000; // 10 min default
      const pct = Math.min((elapsed / timeout) * 100, 100);
      progressFill.style.width = `${pct}%`;
      progressFill.style.background = color;
      progressText.textContent = `${this.state.formatDuration(elapsed)} elapsed`;
    } else {
      progressWrap.style.display = 'none';
    }

    // Prompt
    this.detailPanel.querySelector('#detail-prompt').textContent = agent.currentPrompt || 'No active task';

    // Task history — expandable entries
    const historyEl = this.detailPanel.querySelector('#detail-history');
    const agentEvents = this.state.timeline
      .filter((e) => e.agentId === agentId)
      .slice(-8)
      .reverse();

    if (agentEvents.length === 0) {
      historyEl.innerHTML = '<div class="history-empty">No recent tasks</div>';
    } else {
      historyEl.innerHTML = agentEvents.map((evt) => {
        const time = new Date(evt.timestamp).toLocaleTimeString('en-US', { hour12: false });
        const label = (evt.type || '').replace('task_', '').toUpperCase();
        const dur = evt.duration ? ` (${this.state.formatDuration(evt.duration)})` : '';
        const prompt = evt.prompt ? escapeHtml(evt.prompt.slice(0, 80)) : '';
        return `<div class="history-entry" tabindex="0">
          <div class="history-entry-header">
            <span class="history-time">${time}</span>
            <span class="history-label history-label-${(evt.type || '').replace('task_', '')}">${label}</span>${dur}
          </div>
          ${prompt ? `<div class="history-entry-detail">${prompt}</div>` : ''}
        </div>`;
      }).join('');

      // Expandable click
      historyEl.querySelectorAll('.history-entry').forEach((entry) => {
        entry.addEventListener('click', () => entry.classList.toggle('expanded'));
      });
    }
  }

  // ── Tooltip ────────────────────────────────────────────────────────────────

  _createTooltip() {
    let tip = document.getElementById('desk-tooltip');
    if (tip) { this.tooltip = tip; return; }

    tip = document.createElement('div');
    tip.id = 'desk-tooltip';
    tip.className = 'desk-tooltip';
    tip.style.display = 'none';
    tip.style.opacity = '0';

    const realMode = document.getElementById('real-mode');
    if (realMode) realMode.appendChild(tip);
    this.tooltip = tip;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  onAgentClick(agentId) {
    this.selectedAgentId = agentId;
    this._renderDetailPanel(agentId);

    // Slide-in with spring feel
    this.detailPanel.classList.add('open');
  }

  onPipelineStepClick(agentId) {
    if (!agentId) return;
    this.flashAgentId = agentId;
    this.flashTimer = 1500;
  }

  onDeskHover(agentId, mouseX, mouseY) {
    if (!agentId) {
      this._cancelHover();
      return;
    }

    // Delayed show (300ms hover threshold)
    if (this._hoverAgentId !== agentId) {
      this._hoverAgentId = agentId;
      this._hoverDelayTimer = 0;
      if (this._tooltipVisible) {
        // Switching agents — show immediately
        this._showTooltip(agentId, mouseX, mouseY);
      }
      return;
    }

    if (this._tooltipVisible) {
      // Follow cursor
      this._positionTooltip(mouseX, mouseY);
      return;
    }

    // Still waiting for delay threshold (incremented in tick)
  }

  onDeskHoverEnd() {
    this._cancelHover();
  }

  _cancelHover() {
    this._hoverAgentId = null;
    this._hoverDelayTimer = 0;
    if (this._tooltipVisible) {
      this._tooltipVisible = false;
      this.tooltip.style.opacity = '0';
      setTimeout(() => {
        if (!this._tooltipVisible) this.tooltip.style.display = 'none';
      }, 150);
    }
  }

  _showTooltip(agentId, mouseX, mouseY) {
    const agent = this.state.agents.find((a) => a.agentId === agentId);
    if (!agent) { this._cancelHover(); return; }

    const status = agent.status || 'idle';
    const duration = agent.duration ? this.state.formatDuration(agent.duration) : '-';
    const prompt = agent.currentPrompt
      ? (agent.currentPrompt.length > 60 ? agent.currentPrompt.slice(0, 57) + '...' : agent.currentPrompt)
      : 'No active task';

    this.tooltip.innerHTML = `
      <div class="tooltip-agent">${escapeHtml(agent.agentId)}</div>
      <div class="tooltip-status"><span class="tooltip-dot tooltip-dot-${status}"></span>${status.toUpperCase()}</div>
      <div class="tooltip-info">${escapeHtml(prompt)}</div>
      <div class="tooltip-info">Duration: ${duration}</div>
    `;

    this.tooltip.style.display = 'block';
    this._tooltipVisible = true;

    // Fade in
    requestAnimationFrame(() => { this.tooltip.style.opacity = '1'; });

    this._positionTooltip(mouseX, mouseY);
  }

  _positionTooltip(mouseX, mouseY) {
    this.tooltip.style.left = `${mouseX + 15}px`;
    this.tooltip.style.top = `${mouseY - 10}px`;

    // Keep in bounds
    const rect = this.tooltip.getBoundingClientRect();
    const parent = this.tooltip.parentElement?.getBoundingClientRect();
    if (parent) {
      if (rect.right > parent.right) {
        this.tooltip.style.left = `${mouseX - rect.width - 10}px`;
      }
      if (rect.bottom > parent.bottom - 80) {
        this.tooltip.style.top = `${mouseY - rect.height - 10}px`;
      }
    }
  }

  closePanel() {
    this.detailPanel.classList.remove('open');
    this.selectedAgentId = null;
  }

  refreshPanel() {
    if (this.selectedAgentId && this.detailPanel.classList.contains('open')) {
      this._renderDetailPanel(this.selectedAgentId);
    }
  }

  // ── Discussion State Machine ───────────────────────────────────────────────

  /**
   * Register agents for discussion tracking. Call when agents change.
   */
  updateAgents(agents) {
    for (const agent of agents) {
      if (!this.discussions.has(agent.agentId)) {
        this.discussions.set(agent.agentId, new AgentDiscussion(agent.agentId));
      }
    }
  }

  /**
   * Tick — updates flash, tooltip delay, and discussion state machine.
   * Returns the agentId that should be flashing, or null.
   */
  tick(dtMs) {
    // Flash countdown
    if (this.flashTimer > 0) {
      this.flashTimer -= dtMs;
      if (this.flashTimer <= 0) this.flashAgentId = null;
    }

    // Tooltip hover delay
    if (this._hoverAgentId && !this._tooltipVisible) {
      this._hoverDelayTimer += dtMs;
      if (this._hoverDelayTimer >= this._hoverDelayThreshold) {
        this._showTooltip(this._hoverAgentId, 0, 0);
      }
    }

    // Discussion state machine per agent
    if (this._ticker) {
      for (const agent of (this.state.agents || [])) {
        this._tickDiscussion(agent, dtMs);
      }
    }

    return this.flashAgentId;
  }

  _tickDiscussion(agent, dtMs) {
    const disc = this.discussions.get(agent.agentId);
    if (!disc) return;

    const container = this._agentContainers.get(agent.agentId);
    if (!container) return;

    const isActive = agent.status === 'active';

    // Clear bubble when not active
    if (!isActive) {
      if (disc.currentBubble && !disc.currentBubble.destroyed) {
        fadeOutBubble(disc.currentBubble, this._ticker, 200);
        disc.currentBubble = null;
      }
      disc.phase = 'idle';
      return;
    }

    // Golden milestone timer
    disc.goldenTimer -= dtMs;
    if (disc.goldenTimer <= 0) {
      disc.goldenTimer = GOLDEN_INTERVAL_MIN + Math.random() * (GOLDEN_INTERVAL_MAX - GOLDEN_INTERVAL_MIN);
      if (disc.phase === 'gap' || disc.phase === 'idle') {
        this._showBubble(disc, container, GOLDEN_MILESTONES[Math.floor(Math.random() * GOLDEN_MILESTONES.length)], 'golden');
        disc.phase = 'showing';
        disc.showTimer = DISCUSSION_SHOW_MS + 2000; // golden shows longer
        return;
      }
    }

    // State machine: idle → showing → gap → showing → ...
    switch (disc.phase) {
      case 'idle':
        disc.phase = 'showing';
        disc.showTimer = DISCUSSION_SHOW_MS;
        this._showBubble(disc, container, disc.pickMessage(), 'regular');
        break;

      case 'showing':
        disc.showTimer -= dtMs;
        if (disc.showTimer <= 0) {
          // Dismiss bubble
          if (disc.currentBubble && !disc.currentBubble.destroyed) {
            fadeOutBubble(disc.currentBubble, this._ticker, 200);
            disc.currentBubble = null;
          }
          disc.phase = 'gap';
          disc.gapTimer = DISCUSSION_GAP_MS_MIN + Math.random() * (DISCUSSION_GAP_MS_MAX - DISCUSSION_GAP_MS_MIN);
        }
        break;

      case 'gap':
        disc.gapTimer -= dtMs;
        if (disc.gapTimer <= 0) {
          disc.phase = 'showing';
          disc.showTimer = DISCUSSION_SHOW_MS;
          this._showBubble(disc, container, disc.pickMessage(), 'regular');
        }
        break;
    }
  }

  _showBubble(disc, container, text, type) {
    // Remove old bubble
    if (disc.currentBubble && !disc.currentBubble.destroyed) {
      disc.currentBubble.destroy();
    }

    const bubble = createBubble(text, type);
    container.addChild(bubble);
    disc.currentBubble = bubble;

    springScale(bubble, this._ticker);
    typewriterBubble(bubble, text, this._ticker, type === 'golden' ? 'fast' : 'normal');
  }

  /**
   * Show an error bubble on an agent (for task failures).
   */
  showErrorBubble(agentId, text) {
    if (!this._ticker) return;
    const container = this._agentContainers.get(agentId);
    if (!container) return;

    const disc = this.discussions.get(agentId);
    if (disc && disc.currentBubble && !disc.currentBubble.destroyed) {
      disc.currentBubble.destroy();
      disc.currentBubble = null;
    }

    const bubble = createBubble(text || 'Error occurred!', 'error');
    container.addChild(bubble);
    if (disc) disc.currentBubble = bubble;

    springScale(bubble, this._ticker);
    typewriterBubble(bubble, text || 'Error occurred!', this._ticker, 'fast');

    // Auto-dismiss after 5s
    let elapsed = 0;
    const dismiss = (tick) => {
      if (!bubble || bubble.destroyed) { this._ticker.remove(dismiss); return; }
      elapsed += tick.deltaMS;
      if (elapsed >= 5000) {
        this._ticker.remove(dismiss);
        fadeOutBubble(bubble, this._ticker, 300);
        if (disc) disc.currentBubble = null;
      }
    };
    this._ticker.add(dismiss);
  }

  /**
   * Show a golden milestone bubble on an agent.
   */
  showGoldenBubble(agentId, text) {
    if (!this._ticker) return;
    const container = this._agentContainers.get(agentId);
    if (!container) return;

    const disc = this.discussions.get(agentId);
    if (disc && disc.currentBubble && !disc.currentBubble.destroyed) {
      disc.currentBubble.destroy();
      disc.currentBubble = null;
    }

    const bubble = createBubble(text, 'golden');
    container.addChild(bubble);
    if (disc) disc.currentBubble = bubble;

    springScale(bubble, this._ticker);
    typewriterBubble(bubble, text, this._ticker, 'fast');

    // Auto-dismiss after 6s
    let elapsed = 0;
    const dismiss = (tick) => {
      if (!bubble || bubble.destroyed) { this._ticker.remove(dismiss); return; }
      elapsed += tick.deltaMS;
      if (elapsed >= 6000) {
        this._ticker.remove(dismiss);
        fadeOutBubble(bubble, this._ticker, 300);
        if (disc) disc.currentBubble = null;
      }
    };
    this._ticker.add(dismiss);
  }

  isFlashing(agentId) {
    return this.flashAgentId === agentId && this.flashTimer > 0;
  }

  destroy() {
    // Destroy all active bubbles
    for (const [, disc] of this.discussions) {
      if (disc.currentBubble && !disc.currentBubble.destroyed) {
        disc.currentBubble.destroy();
      }
    }
    this.discussions.clear();

    if (this.detailPanel?.parentElement) {
      this.detailPanel.parentElement.removeChild(this.detailPanel);
    }
    if (this.tooltip?.parentElement) {
      this.tooltip.parentElement.removeChild(this.tooltip);
    }
  }
}

// ── Utility ────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
