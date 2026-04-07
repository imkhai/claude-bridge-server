// Chain workflow visualization — connected node graph, animated arrows, agent linking, progress counter
// PixiJS 8 API — all drawing via Graphics.fill/stroke, Text with object-style options
const PIXI = window.PIXI;

// ── Layout constants ───────────────────────────────────────────────────────────
const BAR_Y = 385;
const BAR_MARGIN_X = 80;
const BAR_WIDTH = 720;
const NODE_RADIUS = 8;
const GLOW_RADIUS = 14;
const HIT_RADIUS = 14;

// ── Colors ─────────────────────────────────────────────────────────────────────
const COLORS = {
  trackBg: 0x21262d,
  completed: 0x22c55e,
  completedDark: 0x166534,
  active: 0xf59e0b,
  activeDark: 0x92400e,
  pending: 0x484f58,
  error: 0xf85149,
  errorDark: 0x7f1d1d,
  linePending: 0x30363d,
  textMuted: 0x8b949e,
  textDim: 0x484f58,
  arrowGlow: 0xf59e0b,
  checkmarkFg: 0x0d1117,
  nodeBg: 0x0d1117,
};

// ── Dash pattern for animated flow ─────────────────────────────────────────────
const DASH_LENGTH = 6;
const GAP_LENGTH = 4;
const DASH_SPEED = 0.08; // pixels per animTime unit

// ══════════════════════════════════════════════════════════════════════════════
// Pipeline class
// ══════════════════════════════════════════════════════════════════════════════

export class Pipeline {
  constructor() {
    this.container = new PIXI.Container();
    this.animTime = 0;
    this.chains = [];
    this.deskPositions = []; // [{x, y, agentId}]

    // Cached previous progress for animated counter
    this._prevCompleted = 0;
    this._displayCompleted = 0;
    this._counterAnimTimer = 0;

    // ── Persistent Graphics — cleared each tick, never destroyed/recreated ──
    this._trackGfx = new PIXI.Graphics();
    this._linesGfx = new PIXI.Graphics();
    this._nodesGfx = new PIXI.Graphics();
    this._arrowsGfx = new PIXI.Graphics();
    this._pillGfx = new PIXI.Graphics();

    this.container.addChild(this._trackGfx);
    this.container.addChild(this._linesGfx);
    this.container.addChild(this._nodesGfx);
    this.container.addChild(this._arrowsGfx);
    this.container.addChild(this._pillGfx);

    // Pooled Text objects (max 10 steps * 3 texts per step + 1 progress = 31)
    this._textPool = [];
    this._textPoolIdx = 0;
    for (let i = 0; i < 35; i++) {
      const t = new PIXI.Text({
        text: '',
        style: { fontFamily: 'monospace', fontSize: 7, fill: 0x8b949e },
      });
      t.visible = false;
      this.container.addChild(t);
      this._textPool.push(t);
    }
  }

  setDeskPositions(positions) {
    this.deskPositions = positions;
  }

  update(chains) {
    this.chains = chains || [];
  }

  tick(dt) {
    this.animTime += dt;
    this._draw();
  }

  // ── Text pool helper ─────────────────────────────────────────────────────
  _allocText(text, fontSize, fill, fontWeight = 'normal') {
    let t;
    if (this._textPoolIdx < this._textPool.length) {
      t = this._textPool[this._textPoolIdx];
    } else {
      // Pool exhausted — create new (rare)
      t = new PIXI.Text({ text: '', style: { fontFamily: 'monospace', fontSize: 7, fill: 0x8b949e } });
      this.container.addChild(t);
      this._textPool.push(t);
    }
    this._textPoolIdx++;
    t.visible = true;
    t.text = text;
    t.style.fontSize = fontSize;
    t.style.fill = fill;
    t.style.fontWeight = fontWeight;
    t.alpha = 1;
    return t;
  }

  // ── Main draw ──────────────────────────────────────────────────────────────

  _draw() {
    // Clear persistent Graphics — never removeChildren (prevents flashing)
    this._trackGfx.clear();
    this._linesGfx.clear();
    this._nodesGfx.clear();
    this._arrowsGfx.clear();
    this._pillGfx.clear();
    // Hide all pooled texts
    this._textPoolIdx = 0;
    for (const t of this._textPool) t.visible = false;

    // Find the most relevant chain
    const activeChain = this.chains.find((c) => c.status === 'running')
      || this.chains[this.chains.length - 1];

    if (!activeChain || !activeChain.steps || activeChain.steps.length === 0) return;

    const steps = activeChain.steps;
    const totalSteps = steps.length;
    const nodeSpacing = totalSteps > 1 ? BAR_WIDTH / (totalSteps - 1) : 0;

    // ─── Background track ────────────────────────────────────────────────
    this._trackGfx.roundRect(BAR_MARGIN_X - 10, BAR_Y - 2, BAR_WIDTH + 20, 4, 2);
    this._trackGfx.fill(COLORS.trackBg);

    // ─── Connection lines between nodes ──────────────────────────────────
    for (let i = 0; i < totalSteps - 1; i++) {
      this._drawConnectionLine(i, steps, nodeSpacing);
    }

    // ─── Draw nodes ──────────────────────────────────────────────────────
    for (let i = 0; i < totalSteps; i++) {
      this._drawNode(i, steps[i], nodeSpacing, totalSteps);
    }

    // ─── Agent-to-step arrows for running steps ──────────────────────────
    for (let i = 0; i < totalSteps; i++) {
      const step = steps[i];
      const isRunning = step.status === 'running' || step.status === 'active';
      if (isRunning && step.agentId) {
        const x = BAR_MARGIN_X + i * nodeSpacing;
        this._drawAgentArrow(x, BAR_Y, step.agentId);
      }
    }

    // ─── Progress counter ────────────────────────────────────────────────
    this._drawProgressCounter(steps, totalSteps, nodeSpacing);
  }

  // ── Connection line between step i and step i+1 ───────────────────────────

  _drawConnectionLine(i, steps, nodeSpacing) {
    const x1 = BAR_MARGIN_X + i * nodeSpacing;
    const x2 = BAR_MARGIN_X + (i + 1) * nodeSpacing;
    const step = steps[i];
    const nextStep = steps[i + 1];
    const isDone = step.status === 'done' || step.status === 'completed';
    const nextIsActive = nextStep.status === 'running' || nextStep.status === 'active';
    const g = this._linesGfx;

    if (isDone && !nextIsActive) {
      g.moveTo(x1 + NODE_RADIUS, BAR_Y);
      g.lineTo(x2 - NODE_RADIUS, BAR_Y);
      g.stroke({ color: COLORS.completed, width: 2.5 });
    } else if (isDone && nextIsActive) {
      this._drawAnimatedDashLine(x1 + NODE_RADIUS, x2 - NODE_RADIUS, BAR_Y, COLORS.active, true);
    } else {
      g.moveTo(x1 + NODE_RADIUS, BAR_Y);
      g.lineTo(x2 - NODE_RADIUS, BAR_Y);
      g.stroke({ color: COLORS.linePending, width: 1.5 });
    }
  }

  // ── Animated dash line with flowing dashes ─────────────────────────────────

  _drawAnimatedDashLine(fromX, toX, y, color, glow = false) {
    const lineLen = toX - fromX;
    if (lineLen <= 0) return;
    const g = this._linesGfx;

    if (glow) {
      g.moveTo(fromX, y);
      g.lineTo(toX, y);
      g.stroke({ color, width: 6, alpha: 0.12 });
    }

    const totalPattern = DASH_LENGTH + GAP_LENGTH;
    const offset = (this.animTime * DASH_SPEED * 100) % totalPattern;

    let pos = -offset;
    while (pos < lineLen) {
      const dashStart = Math.max(pos, 0);
      const dashEnd = Math.min(pos + DASH_LENGTH, lineLen);
      if (dashEnd > dashStart) {
        g.moveTo(fromX + dashStart, y);
        g.lineTo(fromX + dashEnd, y);
      }
      pos += totalPattern;
    }
    g.stroke({ color, width: 2.5 });
  }

  // ── Draw a single pipeline node ────────────────────────────────────────────

  _drawNode(i, step, nodeSpacing, totalSteps) {
    const x = BAR_MARGIN_X + i * nodeSpacing;
    const isDone = step.status === 'done' || step.status === 'completed';
    const isRunning = step.status === 'running' || step.status === 'active';
    const isError = step.status === 'error' || step.status === 'failed';
    const g = this._nodesGfx;

    if (isDone) {
      g.circle(x, BAR_Y, NODE_RADIUS + 2).fill({ color: COLORS.completed, alpha: 0.15 });
      g.circle(x, BAR_Y, NODE_RADIUS).fill(COLORS.completed);
      // Checkmark
      g.moveTo(x - 4, BAR_Y).lineTo(x - 1, BAR_Y + 3).lineTo(x + 4, BAR_Y - 3)
        .stroke({ color: COLORS.checkmarkFg, width: 1.8 });
    } else if (isRunning) {
      const pulse = 0.5 + Math.sin(this.animTime * 0.2) * 0.35;
      g.circle(x, BAR_Y, GLOW_RADIUS).fill({ color: COLORS.active, alpha: 0.1 + pulse * 0.12 });
      g.circle(x, BAR_Y, NODE_RADIUS + 3).fill({ color: COLORS.active, alpha: 0.2 + pulse * 0.15 });
      g.circle(x, BAR_Y, NODE_RADIUS).fill({ color: COLORS.active, alpha: 0.7 + pulse * 0.3 });
      g.circle(x, BAR_Y, 3).fill(COLORS.nodeBg);
    } else if (isError) {
      g.circle(x, BAR_Y, NODE_RADIUS + 2).fill({ color: COLORS.error, alpha: 0.2 });
      g.circle(x, BAR_Y, NODE_RADIUS).fill(COLORS.error);
      // X mark
      g.moveTo(x - 3, BAR_Y - 3).lineTo(x + 3, BAR_Y + 3).stroke({ color: COLORS.checkmarkFg, width: 1.8 });
      g.moveTo(x + 3, BAR_Y - 3).lineTo(x - 3, BAR_Y + 3).stroke({ color: COLORS.checkmarkFg, width: 1.8 });
    } else {
      g.circle(x, BAR_Y, NODE_RADIUS).stroke({ color: COLORS.pending, width: 1.5 });
      g.circle(x, BAR_Y, 2).fill({ color: COLORS.pending, alpha: 0.3 });
    }

    // ─── Step label below node ───────────────────────────────────────────
    this._drawStepLabel(x, step, i, isDone, isRunning, isError);

    // ─── Step number above node (pooled Text) ────────────────────────────
    const num = this._allocText(
      `${i + 1}`, 7,
      isDone || isRunning ? COLORS.textMuted : COLORS.textDim,
    );
    num.anchor.set(0.5, 1);
    num.position.set(x, BAR_Y - (isRunning ? GLOW_RADIUS + 3 : NODE_RADIUS + 4));
  }

  // ── Step label: agent name + duration/counter ──────────────────────────────

  _drawStepLabel(x, step, i, isDone, isRunning, isError) {
    const agentName = step.agentId
      ? step.agentId.split(/[-_]/).map((p) => p.slice(0, 4)).join('-')
      : `Step ${i + 1}`;

    const labelColor = isDone ? COLORS.completed
      : isRunning ? COLORS.active
      : isError ? COLORS.error
      : COLORS.textDim;

    const label = this._allocText(agentName, 7, labelColor, isRunning ? 'bold' : 'normal');
    label.anchor.set(0.5, 0);
    label.position.set(x, BAR_Y + 14);

    if (isDone && step.duration) {
      const dur = this._allocText(this._formatDuration(step.duration), 6, COLORS.completedDark);
      dur.anchor.set(0.5, 0);
      dur.position.set(x, BAR_Y + 24);
    } else if (isRunning && step.startedAt) {
      const elapsed = Date.now() - new Date(step.startedAt).getTime();
      const counter = this._allocText(this._formatDuration(elapsed), 6, COLORS.activeDark);
      counter.anchor.set(0.5, 0);
      counter.position.set(x, BAR_Y + 24);
      counter.alpha = 0.6 + Math.sin(this.animTime * 0.15) * 0.4;
    }
  }

  // ── Arrow from pipeline step to agent desk ─────────────────────────────────

  _drawAgentArrow(fromX, fromY, agentId) {
    const deskIdx = this.deskPositions.findIndex((d) => d && d.agentId === agentId);
    if (deskIdx < 0) return;

    const desk = this.deskPositions[deskIdx];
    const toX = desk.x;
    const toY = desk.y + 25;
    const g = this._arrowsGfx;

    const goingUp = toY < fromY;
    const startY = goingUp ? fromY - GLOW_RADIUS - 2 : fromY + GLOW_RADIUS + 2;
    const pulseAlpha = 0.35 + Math.sin(this.animTime * 0.15) * 0.2;
    const midY = (startY + toY) / 2;

    // Glow underlay
    g.moveTo(fromX, startY);
    g.bezierCurveTo(fromX, midY, toX, midY, toX, toY);
    g.stroke({ color: COLORS.arrowGlow, width: 4, alpha: pulseAlpha * 0.3 });

    // Animated dashes
    this._drawAnimatedDashCurve(fromX, startY, toX, toY, midY, COLORS.arrowGlow, pulseAlpha);

    // Arrowhead
    const headSize = 5;
    const headDir = goingUp ? -1 : 1;
    g.moveTo(toX - headSize, toY - headSize * headDir);
    g.lineTo(toX, toY);
    g.lineTo(toX + headSize, toY - headSize * headDir);
    g.stroke({ color: COLORS.arrowGlow, width: 1.5, alpha: pulseAlpha + 0.15 });
  }

  // ── Animated dash along a bezier curve ─────────────────────────────────────

  _drawAnimatedDashCurve(x1, y1, x2, y2, midY, color, alpha) {
    // Sample points along bezier
    const points = [];
    const segments = 30;
    for (let t = 0; t <= 1; t += 1 / segments) {
      const mt = 1 - t;
      const px = mt * mt * x1 + 2 * mt * t * ((x1 + x2) / 2) + t * t * x2;
      // Control points matching bezierCurveTo(x1, midY, x2, midY, x2, y2) from (x1, y1)
      const py = mt * mt * mt * y1 + 3 * mt * mt * t * midY + 3 * mt * t * t * midY + t * t * t * y2;
      points.push({ x: px, y: py });
    }

    // Calculate cumulative arc length
    const lengths = [0];
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      lengths.push(lengths[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    const totalLen = lengths[lengths.length - 1];
    if (totalLen <= 0) return;

    const totalPattern = DASH_LENGTH + GAP_LENGTH;
    const offset = (this.animTime * DASH_SPEED * 80) % totalPattern;

    const g = this._arrowsGfx;
    let dist = -offset;

    while (dist < totalLen) {
      const dashStart = Math.max(dist, 0);
      const dashEnd = Math.min(dist + DASH_LENGTH, totalLen);
      if (dashEnd > dashStart) {
        const p1 = this._pointAtLength(points, lengths, dashStart);
        const p2 = this._pointAtLength(points, lengths, dashEnd);
        if (p1 && p2) {
          g.moveTo(p1.x, p1.y);
          g.lineTo(p2.x, p2.y);
        }
      }
      dist += totalPattern;
    }
    g.stroke({ color, width: 1.5, alpha });
  }

  _pointAtLength(points, lengths, targetLen) {
    for (let i = 1; i < lengths.length; i++) {
      if (lengths[i] >= targetLen) {
        const segLen = lengths[i] - lengths[i - 1];
        if (segLen === 0) return points[i];
        const t = (targetLen - lengths[i - 1]) / segLen;
        return {
          x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
          y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
        };
      }
    }
    return points[points.length - 1];
  }

  // ── Progress counter [X / Y] ──────────────────────────────────────────────

  _drawProgressCounter(steps, totalSteps, nodeSpacing) {
    const completed = steps.filter((s) => s.status === 'done' || s.status === 'completed').length;

    if (completed !== this._prevCompleted) {
      this._prevCompleted = completed;
      this._counterAnimTimer = 0;
    }
    this._counterAnimTimer += 1;
    const animSpeed = 0.08;
    this._displayCompleted += (completed - this._displayCompleted) * animSpeed;
    const displayNum = Math.round(this._displayCompleted);

    const labelText = `${displayNum} done / ${totalSteps} total`;
    const g = this._pillGfx;
    const pillW = labelText.length * 5.5 + 20;
    const pillH = 16;
    const pillX = BAR_MARGIN_X + BAR_WIDTH / 2;
    const pillY = BAR_Y - 26;

    g.roundRect(pillX - pillW / 2, pillY - pillH / 2, pillW, pillH, 8);
    g.fill({ color: 0x161b22, alpha: 0.85 });
    g.stroke({ color: completed === totalSteps ? COLORS.completed : COLORS.textDim, width: 0.5, alpha: 0.5 });

    const progressLabel = this._allocText(
      labelText, 8,
      completed === totalSteps ? COLORS.completed : COLORS.textMuted,
      completed === totalSteps ? 'bold' : 'normal',
    );
    progressLabel.anchor.set(0.5, 0.5);
    progressLabel.position.set(pillX, pillY);

    if (completed === totalSteps && totalSteps > 0) {
      const glow = 0.3 + Math.sin(this.animTime * 0.1) * 0.2;
      g.roundRect(pillX - pillW / 2 - 2, pillY - pillH / 2 - 2, pillW + 4, pillH + 4, 10);
      g.fill({ color: COLORS.completed, alpha: glow * 0.15 });
    }
  }

  // ── Hit testing ────────────────────────────────────────────────────────────

  getAgentAtStep(stepIndex) {
    const activeChain = this.chains.find((c) => c.status === 'running')
      || this.chains[this.chains.length - 1];
    if (!activeChain || !activeChain.steps) return null;
    const step = activeChain.steps[stepIndex];
    return step ? step.agentId : null;
  }

  hitTestStep(globalX, globalY) {
    const activeChain = this.chains.find((c) => c.status === 'running')
      || this.chains[this.chains.length - 1];
    if (!activeChain || !activeChain.steps) return -1;

    const totalSteps = activeChain.steps.length;
    const nodeSpacing = totalSteps > 1 ? BAR_WIDTH / (totalSteps - 1) : 0;

    for (let i = 0; i < totalSteps; i++) {
      const x = BAR_MARGIN_X + i * nodeSpacing;
      const dx = globalX - x;
      const dy = globalY - BAR_Y;
      if (dx * dx + dy * dy < HIT_RADIUS * HIT_RADIUS) {
        return i;
      }
    }
    return -1;
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  _formatDuration(ms) {
    if (!ms && ms !== 0) return '-';
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins}m ${rem.toString().padStart(2, '0')}s`;
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}
