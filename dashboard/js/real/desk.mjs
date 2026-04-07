// Desk and furniture rendering — 8 unique lamps, coffee mug with steam,
// syntax-highlighted code, indicator lights, enhanced desk, keyboard detail,
// lamp glow cone, name plate with emboss. PixiJS 8 API.
const PIXI = window.PIXI;

// ── Constants ────────────────────────────────────────────────────────────────
const DESK_W = 110;
const DESK_H = 22;
const MONITOR_W = 56;
const MONITOR_H = 36;
const KEYBOARD_W = 36;
const MUG_RADIUS = 5;
const NAMEPLATE_W = 28;
const NAMEPLATE_H = 10;
const LAMP_BASE_Y = -13;

// ── Syntax highlight palette ─────────────────────────────────────────────────
const SYN = {
  keyword:  0x60a5fa,  // blue
  string:   0x4ade80,  // green
  func:     0xfb923c,  // orange
  comment:  0x6b7280,  // gray
  text:     0xe2e8f0,  // white-ish
  number:   0xc084fc,  // purple
  type:     0x22d3ee,  // cyan
  punct:    0x94a3b8,  // muted
};
const SYN_COLORS = [SYN.keyword, SYN.string, SYN.func, SYN.comment,
                     SYN.text, SYN.number, SYN.type, SYN.punct];

// ── Helpers ──────────────────────────────────────────────────────────────────
function darken(color, amount) {
  const r = Math.max(0, ((color >> 16) & 0xff) * (1 - amount)) | 0;
  const g = Math.max(0, ((color >> 8) & 0xff) * (1 - amount)) | 0;
  const b = Math.max(0, (color & 0xff) * (1 - amount)) | 0;
  return (r << 16) | (g << 8) | b;
}

function lighten(color, amount) {
  const r = Math.min(255, ((color >> 16) & 0xff) + (255 - ((color >> 16) & 0xff)) * amount) | 0;
  const g = Math.min(255, ((color >> 8) & 0xff) + (255 - ((color >> 8) & 0xff)) * amount) | 0;
  const b = Math.min(255, (color & 0xff) + (255 - (color & 0xff)) * amount) | 0;
  return (r << 16) | (g << 8) | b;
}

function abbrev(name) {
  if (!name) return '??';
  return name.split(/[-_ ]+/).map(w => (w[0] || '')).join('').toUpperCase().slice(0, 3);
}

// Cheap seeded pseudo-random
function lcg(seed) {
  return ((seed * 1103515245 + 12345) & 0x7fffffff);
}

// ══════════════════════════════════════════════════════════════════════════════
// 8 UNIQUE LAMP DESIGNS
// ══════════════════════════════════════════════════════════════════════════════

function drawLampGooseneck(g, c) {
  // Curved flexible neck lamp
  g.roundRect(-5, LAMP_BASE_Y, 10, 4, 2).fill(0x444455);
  g.moveTo(0, LAMP_BASE_Y);
  g.quadraticCurveTo(-8, LAMP_BASE_Y - 22, 2, LAMP_BASE_Y - 28);
  g.stroke({ width: 1.5, color: 0x888888 });
  g.ellipse(2, LAMP_BASE_Y - 28, 7, 3).fill(c);
  g.ellipse(2, LAMP_BASE_Y - 28, 7, 3).stroke({ width: 0.5, color: darken(c, 0.3) });
}

function drawLampArchitect(g, c) {
  // Angled articulated arm with joints
  g.roundRect(-6, LAMP_BASE_Y, 12, 3, 1).fill(0x555566);
  g.moveTo(0, LAMP_BASE_Y).lineTo(-4, LAMP_BASE_Y - 16);
  g.stroke({ width: 2, color: 0x777788 });
  g.circle(-4, LAMP_BASE_Y - 16, 1.5).fill(0x888899);
  g.moveTo(-4, LAMP_BASE_Y - 16).lineTo(3, LAMP_BASE_Y - 28);
  g.stroke({ width: 2, color: 0x777788 });
  g.roundRect(-2, LAMP_BASE_Y - 32, 12, 5, 1).fill(c);
  g.roundRect(-2, LAMP_BASE_Y - 32, 12, 5, 1).stroke({ width: 0.5, color: darken(c, 0.2) });
}

function drawLampLedBar(g, c) {
  // Thin vertical LED strip on pole
  g.ellipse(0, LAMP_BASE_Y + 1, 4, 2).fill(0x444455);
  g.moveTo(0, LAMP_BASE_Y).lineTo(0, LAMP_BASE_Y - 26);
  g.stroke({ width: 1.5, color: 0x666677 });
  g.roundRect(-5, LAMP_BASE_Y - 28, 10, 3, 1).fill(c);
  g.roundRect(-5, LAMP_BASE_Y - 28, 10, 3, 1).stroke({ width: 0.5, color: darken(c, 0.2) });
}

function drawLampBanker(g, c) {
  // Classic green banker's lamp with brass
  g.roundRect(-6, LAMP_BASE_Y, 12, 3, 1).fill(0x8b7355);
  g.roundRect(-4, LAMP_BASE_Y - 2, 8, 2, 0.5).fill(0x9b8365);
  g.rect(-1.5, LAMP_BASE_Y - 14, 3, 12).fill(0x8b7355);
  g.ellipse(0, LAMP_BASE_Y - 16, 9, 5).fill(c);
  g.arc(0, LAMP_BASE_Y - 16, 9, Math.PI, 0, false);
  g.stroke({ width: 0.8, color: darken(c, 0.4) });
}

function drawLampSpotlight(g, c) {
  // Directional spot with articulated joint
  g.roundRect(-4, LAMP_BASE_Y, 8, 4, 1).fill(0x555566);
  g.moveTo(0, LAMP_BASE_Y).lineTo(4, LAMP_BASE_Y - 14);
  g.stroke({ width: 1.8, color: 0x777788 });
  g.circle(4, LAMP_BASE_Y - 14, 1.5).fill(0x888899);
  g.moveTo(4, LAMP_BASE_Y - 14).lineTo(-2, LAMP_BASE_Y - 26);
  g.stroke({ width: 1.8, color: 0x777788 });
  g.circle(-2, LAMP_BASE_Y - 27, 5).fill(0x555566);
  g.circle(-2, LAMP_BASE_Y - 27, 3).fill(c);
}

function drawLampDesigner(g, c) {
  // Flat modern pendant style
  g.ellipse(0, LAMP_BASE_Y + 1, 5, 2).fill(0x555566);
  g.moveTo(0, LAMP_BASE_Y).lineTo(0, LAMP_BASE_Y - 24);
  g.stroke({ width: 1, color: 0x888899 });
  g.moveTo(-10, LAMP_BASE_Y - 26).lineTo(10, LAMP_BASE_Y - 26)
    .lineTo(8, LAMP_BASE_Y - 24).lineTo(-8, LAMP_BASE_Y - 24).closePath().fill(c);
  g.moveTo(-10, LAMP_BASE_Y - 26).lineTo(10, LAMP_BASE_Y - 26);
  g.stroke({ width: 0.8, color: darken(c, 0.3) });
}

function drawLampSimple(g, c) {
  // Arc lamp — pole + horizontal arm + dome shade
  g.rect(-4, LAMP_BASE_Y, 8, 3).fill(0x555566);
  g.moveTo(0, LAMP_BASE_Y).lineTo(0, LAMP_BASE_Y - 20);
  g.stroke({ width: 2, color: 0x666677 });
  g.moveTo(0, LAMP_BASE_Y - 20).lineTo(8, LAMP_BASE_Y - 20);
  g.stroke({ width: 2, color: 0x666677 });
  g.arc(8, LAMP_BASE_Y - 20, 5, 0, Math.PI, false).fill(c);
  g.arc(8, LAMP_BASE_Y - 20, 5, 0, Math.PI, false).stroke({ width: 0.5, color: darken(c, 0.3) });
}

function drawLampNeon(g, c) {
  // Neon tube on two vertical posts
  g.moveTo(-3, LAMP_BASE_Y).lineTo(-3, LAMP_BASE_Y - 18);
  g.stroke({ width: 1.5, color: 0x555566 });
  g.moveTo(3, LAMP_BASE_Y).lineTo(3, LAMP_BASE_Y - 18);
  g.stroke({ width: 1.5, color: 0x555566 });
  g.roundRect(-6, LAMP_BASE_Y - 20, 12, 3, 1.5).fill(c);
  g.roundRect(-5, LAMP_BASE_Y - 19.5, 10, 2, 1).fill({ color: 0xffffff, alpha: 0.4 });
}

const LAMP_DRAW_FNS = [
  drawLampGooseneck,   // slot 0
  drawLampArchitect,   // slot 1
  drawLampLedBar,      // slot 2
  drawLampBanker,      // slot 3
  drawLampSpotlight,   // slot 4
  drawLampDesigner,    // slot 5
  drawLampSimple,      // slot 6
  drawLampNeon,        // slot 7
];

// ── Code line procedural generation ─────────────────────────────────────────
function generateCodeLines(seed, count) {
  const lines = [];
  let s = seed | 0;
  for (let i = 0; i < count; i++) {
    s = lcg(s);
    const indent = (s % 4) * 4;
    s = lcg(s);
    const width = 8 + (s % 28);
    s = lcg(s);
    const colorIdx = s % SYN_COLORS.length;
    lines.push({ width, color: SYN_COLORS[colorIdx], indent });
  }
  return lines;
}

// ── Steam particle system ───────────────────────────────────────────────────
const MAX_STEAM = 6;

function createSteamParticles() {
  const particles = [];
  for (let i = 0; i < MAX_STEAM; i++) {
    particles.push({
      x: 0, y: 0, life: 0, maxLife: 40 + Math.random() * 30,
      phase: Math.random() * Math.PI * 2,
      speed: 0.15 + Math.random() * 0.12,
      size: 1.0 + Math.random() * 0.8,
    });
  }
  return particles;
}

function resetSteamParticle(p) {
  p.x = (Math.random() - 0.5) * 4;
  p.y = 0;
  p.life = 0;
  p.maxLife = 40 + Math.random() * 30;
  p.phase = Math.random() * Math.PI * 2;
  p.speed = 0.15 + Math.random() * 0.12;
  p.size = 1.0 + Math.random() * 0.8;
}

// ══════════════════════════════════════════════════════════════════════════════
// DESK CLASS — backward-compatible API
// ══════════════════════════════════════════════════════════════════════════════

export class Desk {
  constructor(agentColor, slotIndex, agentName) {
    this.color = agentColor;
    this.slotIndex = slotIndex % 8;
    this.agentName = agentName || '';
    this.container = new PIXI.Container();
    this.status = 'idle';
    this.animTime = 0;
    this.codeLineSeed = (slotIndex * 7919 + 31) | 0;
    this.codeScrollTick = 0;
    this.steamParticles = createSteamParticles();

    // ── Graphics layers (z-order bottom to top) ──
    this.shadowGfx = new PIXI.Graphics();
    this.lampGlowGfx = new PIXI.Graphics();
    this.lightConeGfx = new PIXI.Graphics();
    this.deskHighlightGfx = new PIXI.Graphics();
    this.deskGfx = new PIXI.Graphics();
    this.grainGfx = new PIXI.Graphics();
    this.mugGfx = new PIXI.Graphics();
    this.steamGfx = new PIXI.Graphics();
    this.standGfx = new PIXI.Graphics();
    this.monFrameGfx = new PIXI.Graphics();
    this.monScreenGfx = new PIXI.Graphics();
    this.indicatorGfx = new PIXI.Graphics();
    this.codeMaskGfx = new PIXI.Graphics();
    this.codeContainer = new PIXI.Container();
    this.kbGfx = new PIXI.Graphics();
    this.kbKeysGfx = new PIXI.Graphics();
    this.lampGfx = new PIXI.Graphics();
    this.namePlateGfx = new PIXI.Graphics();

    // Pooled code line Graphics (prevents creating new ones every frame)
    this._codeLinePool = [];
    for (let i = 0; i < 12; i++) {
      const lg = new PIXI.Graphics();
      lg.visible = false;
      this.codeContainer.addChild(lg);
      this._codeLinePool.push(lg);
    }
    this._codeLinePoolIdx = 0;

    // Add in z-order
    this.container.addChild(this.shadowGfx);
    this.container.addChild(this.lampGlowGfx);
    this.container.addChild(this.lightConeGfx);
    this.container.addChild(this.deskHighlightGfx);
    this.container.addChild(this.deskGfx);
    this.container.addChild(this.grainGfx);
    this.container.addChild(this.mugGfx);
    this.container.addChild(this.steamGfx);
    this.container.addChild(this.standGfx);
    this.container.addChild(this.monFrameGfx);
    this.container.addChild(this.monScreenGfx);
    this.container.addChild(this.indicatorGfx);
    this.container.addChild(this.codeMaskGfx);
    this.container.addChild(this.codeContainer);
    this.codeContainer.mask = this.codeMaskGfx;
    this.container.addChild(this.kbGfx);
    this.container.addChild(this.kbKeysGfx);
    this.container.addChild(this.lampGfx);
    this.container.addChild(this.namePlateGfx);

    // Name text
    this.nameText = new PIXI.Text({
      text: abbrev(this.agentName) || String(slotIndex),
      style: { fontSize: 6, fill: 0x94a3b8, fontFamily: 'monospace', fontWeight: '700' },
    });
    this.nameText.anchor.set(0.5, 0.5);
    this.container.addChild(this.nameText);

    // Draw all static parts
    this._drawShadow();
    this._drawDeskSurface();
    this._drawWoodGrain();
    this._drawMonitorStand();
    this._drawMonitorFrame();
    this._drawCodeMask();
    this._drawKeyboardBody();
    this._drawKeyboardKeys();
    this._drawLampBody();
    this._drawMug();
    this._drawNamePlate();

    // Initial dynamic draw
    this._drawMonitorScreen();
    this._drawIndicatorLights();
    this._drawLampGlow();
    this._drawSteam();
    this._drawDeskHighlight();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  setStatus(status) {
    this.status = status;
  }

  tick(dt) {
    this.animTime += dt;
    this._drawMonitorScreen();
    this._drawIndicatorLights();
    this._drawLampGlow();
    this._drawSteam();
    this._drawDeskHighlight();

    // Keyboard key press animation when active (throttled)
    if (this.status === 'active' &&
        Math.floor(this.animTime * 0.4) !== Math.floor((this.animTime - dt) * 0.4)) {
      this._drawKeyboardKeys();
    }
  }

  layout(centerX, deskY) {
    this.container.position.set(centerX, deskY);
  }

  destroy() {
    this.container.destroy({ children: true });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STATIC DRAWING (called once at construction)
  // ══════════════════════════════════════════════════════════════════════════

  _drawShadow() {
    const g = this.shadowGfx;
    g.clear();
    g.ellipse(0, 20, DESK_W * 0.48, 6).fill({ color: 0x000000, alpha: 0.15 });
    g.ellipse(0, 20, DESK_W * 0.35, 4).fill({ color: 0x000000, alpha: 0.08 });
  }

  _drawDeskSurface() {
    const g = this.deskGfx;
    g.clear();
    const topW = DESK_W - 10;
    const botW = DESK_W;
    const h = DESK_H;
    const topOff = (botW - topW) / 2;

    // Main surface — 3D perspective (top narrower)
    g.moveTo(-botW / 2, 0)
     .lineTo(-topW / 2 + topOff, -h)
     .lineTo(topW / 2 + topOff, -h)
     .lineTo(botW / 2, 0)
     .closePath()
     .fill(0x5a3d2b);
    g.moveTo(-botW / 2, 0)
     .lineTo(-topW / 2 + topOff, -h)
     .lineTo(topW / 2 + topOff, -h)
     .lineTo(botW / 2, 0)
     .closePath()
     .stroke({ color: 0x7a5438, width: 1.5 });

    // Front edge — lighter for depth
    g.moveTo(-botW / 2, 0)
     .lineTo(botW / 2, 0)
     .lineTo(botW / 2, 3)
     .lineTo(-botW / 2, 3)
     .closePath()
     .fill(0x6b4e38);

    // Desk legs
    g.rect(-botW / 2 + 6, 3, 4, 14).fill(0x4a3525);
    g.rect(botW / 2 - 10, 3, 4, 14).fill(0x4a3525);

    // Leg front faces (3D)
    g.rect(-botW / 2 + 6, 3, 4, 1).fill(0x5a4535);
    g.rect(botW / 2 - 10, 3, 4, 1).fill(0x5a4535);
  }

  _drawWoodGrain() {
    const g = this.grainGfx;
    g.clear();
    // Diagonal grain
    for (let i = 0; i < 7; i++) {
      const x1 = -42 + i * 13;
      const x2 = x1 + 8 + (i % 3) * 2;
      g.moveTo(x1, -DESK_H + 3).lineTo(x2, -2);
      g.stroke({ width: 0.5, color: 0x6b4423, alpha: 0.25 });
    }
    // Horizontal subtle grain
    for (let j = 0; j < 3; j++) {
      const y = -DESK_H + 5 + j * 7;
      g.moveTo(-DESK_W / 2 + 8, y).lineTo(DESK_W / 2 - 8, y);
      g.stroke({ width: 0.3, color: 0x7a5538, alpha: 0.15 });
    }
  }

  _drawMonitorStand() {
    const g = this.standGfx;
    g.clear();
    // Neck
    g.rect(-3, -DESK_H - 4, 6, 6).fill(0x444455);
    // Base plate
    g.roundRect(-10, -DESK_H + 1, 20, 2, 1).fill(0x3a3a4a);
  }

  _drawMonitorFrame() {
    const g = this.monFrameGfx;
    g.clear();
    const my = -DESK_H - 4;
    // Outer bezel
    g.roundRect(-MONITOR_W / 2, my - MONITOR_H, MONITOR_W, MONITOR_H, 3).fill(0x1a1a2e);
    g.roundRect(-MONITOR_W / 2, my - MONITOR_H, MONITOR_W, MONITOR_H, 3)
     .stroke({ width: 1.5, color: 0x444455 });
    // Inner bezel highlight
    g.roundRect(-MONITOR_W / 2 + 1, my - MONITOR_H + 1, MONITOR_W - 2, MONITOR_H - 2, 2)
     .stroke({ width: 0.5, color: 0x333344 });
  }

  _drawCodeMask() {
    const g = this.codeMaskGfx;
    g.clear();
    const my = -DESK_H - 4;
    g.rect(-MONITOR_W / 2 + 3, my - MONITOR_H + 3, MONITOR_W - 6, MONITOR_H - 6).fill(0xffffff);
  }

  _drawKeyboardBody() {
    const g = this.kbGfx;
    g.clear();
    g.roundRect(-KEYBOARD_W / 2, -DESK_H - 1, KEYBOARD_W, 10, 2).fill(0x21262d);
    g.roundRect(-KEYBOARD_W / 2, -DESK_H - 1, KEYBOARD_W, 10, 2)
     .stroke({ color: 0x444c56, width: 0.5 });
  }

  _drawKeyboardKeys() {
    const g = this.kbKeysGfx;
    g.clear();
    const isActive = this.status === 'active';
    const pressedKey = isActive ? Math.floor(this.animTime * 5.3) % 28 : -1;
    const kbX = -KEYBOARD_W / 2 + 2;
    const kbY = -DESK_H;
    let keyIdx = 0;

    // 3 rows of keys
    for (let row = 0; row < 3; row++) {
      const cols = row === 2 ? 6 : 8;
      for (let col = 0; col < cols; col++) {
        const kx = kbX + col * 4 + (row === 1 ? 1 : 0);
        const ky = kbY + row * 3;
        const isPressed = keyIdx === pressedKey;
        const yOff = isPressed ? 0.3 : 0;
        const baseColor = isPressed ? 0x4a5060 : 0x30363d;
        // Key shadow
        g.rect(kx, ky + 0.5 + yOff, 3, 2).fill({ color: 0x1a1f27, alpha: 0.5 });
        // Key cap
        g.rect(kx, ky + yOff, 3, 1.8).fill(baseColor);
        keyIdx++;
      }
    }

    // Space bar — wider
    const spX = kbX + 8;
    const spY = kbY + 6;
    const spPressed = pressedKey >= 22 || (isActive && Math.sin(this.animTime * 2.1) > 0.8);
    const spOff = spPressed ? 0.3 : 0;
    g.rect(spX, spY + 0.5 + spOff, 14, 2).fill({ color: 0x1a1f27, alpha: 0.5 });
    g.rect(spX, spY + spOff, 14, 1.8).fill(spPressed ? 0x4a5060 : 0x30363d);
  }

  _drawLampBody() {
    const g = this.lampGfx;
    g.clear();
    const lampColor = lighten(this.color, 0.2);
    const drawFn = LAMP_DRAW_FNS[this.slotIndex];

    // We draw lamp at offset — use a child container approach via translate
    // PixiJS 8 Graphics doesn't have translate, so we position the container
    this.lampGfx.position.set(-38, 0);
    drawFn(g, lampColor);
  }

  _drawMug() {
    const g = this.mugGfx;
    g.clear();
    const mx = 26, my = -8;

    // Mug body
    g.circle(mx, my, MUG_RADIUS).fill(0xd4d4d8);
    g.circle(mx, my, MUG_RADIUS).stroke({ width: 1, color: 0xa1a1aa });

    // Handle
    g.arc(mx + MUG_RADIUS, my, 3, -Math.PI / 2, Math.PI / 2, false);
    g.stroke({ width: 1.2, color: 0xa1a1aa });

    // Coffee liquid fill
    g.circle(mx, my - 0.5, MUG_RADIUS - 1.5).fill(0x78350f);

    // Coffee highlight crescent
    g.arc(mx - 1, my - 1, 2, 0, Math.PI, true);
    g.fill({ color: 0x9a5520, alpha: 0.5 });
  }

  _drawNamePlate() {
    const g = this.namePlateGfx;
    g.clear();
    const py = 22;

    // Plate shadow (emboss bottom)
    g.roundRect(-NAMEPLATE_W / 2 + 0.5, py + 0.5, NAMEPLATE_W, NAMEPLATE_H, 2)
     .fill({ color: 0x0f172a, alpha: 0.5 });
    // Plate body
    g.roundRect(-NAMEPLATE_W / 2, py, NAMEPLATE_W, NAMEPLATE_H, 2).fill(0x1e293b);
    g.roundRect(-NAMEPLATE_W / 2, py, NAMEPLATE_W, NAMEPLATE_H, 2)
     .stroke({ width: 0.5, color: 0x334155 });
    // Top highlight (emboss)
    g.moveTo(-NAMEPLATE_W / 2 + 2, py + 1).lineTo(NAMEPLATE_W / 2 - 2, py + 1);
    g.stroke({ width: 0.5, color: 0x475569, alpha: 0.4 });

    this.nameText.position.set(0, py + NAMEPLATE_H / 2);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DYNAMIC DRAWING (called every tick)
  // ══════════════════════════════════════════════════════════════════════════

  _drawMonitorScreen() {
    const g = this.monScreenGfx;
    g.clear();

    // Hide all pooled code lines, reset pool index
    this._codeLinePoolIdx = 0;
    for (const lg of this._codeLinePool) { lg.clear(); lg.visible = false; }

    const my = -DESK_H - 4;
    const sx = -MONITOR_W / 2 + 3;
    const sy = my - MONITOR_H + 3;
    const sw = MONITOR_W - 6;
    const sh = MONITOR_H - 6;

    const isActive = this.status === 'active';
    const isError = this.status === 'error' || this.status === 'timeout';
    const isDone = this.status === 'done';

    if (isActive) {
      g.roundRect(sx, sy, sw, sh, 1).fill(0x0d2d33);
      g.roundRect(sx, sy, sw, sh, 1).fill({ color: this.color, alpha: 0.05 });

      this.codeScrollTick++;
      if (this.codeScrollTick % 4 === 0) {
        this.codeLineSeed = lcg(this.codeLineSeed);
      }
      const lines = generateCodeLines(
        this.codeLineSeed + Math.floor(this.animTime * 0.8), 10
      );
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        // Reuse pooled Graphics
        let lineG;
        if (this._codeLinePoolIdx < this._codeLinePool.length) {
          lineG = this._codeLinePool[this._codeLinePoolIdx];
        } else {
          lineG = new PIXI.Graphics();
          this.codeContainer.addChild(lineG);
          this._codeLinePool.push(lineG);
        }
        this._codeLinePoolIdx++;
        lineG.visible = true;

        const ly = sy + 3 + i * 2.8;
        const lx = sx + 2 + ln.indent;
        const lw = Math.min(ln.width, sw - ln.indent - 4);
        if (lw > 0) {
          lineG.rect(lx, ly, lw, 1.5).fill({ color: ln.color, alpha: 0.65 });
        }
        if (ln.width > 14 && i % 2 === 0) {
          const seg2x = lx + lw + 2;
          const seg2w = Math.min(8 + (ln.indent % 5) * 2, sw - (seg2x - sx) - 2);
          if (seg2w > 0) {
            const c2 = SYN_COLORS[(lines.length - i) % SYN_COLORS.length];
            lineG.rect(seg2x, ly, seg2w, 1.5).fill({ color: c2, alpha: 0.5 });
          }
        }
      }

      // Blinking cursor — reuse a pool slot
      if (Math.sin(this.animTime * 0.3) > 0) {
        let curG;
        if (this._codeLinePoolIdx < this._codeLinePool.length) {
          curG = this._codeLinePool[this._codeLinePoolIdx];
        } else {
          curG = new PIXI.Graphics();
          this.codeContainer.addChild(curG);
          this._codeLinePool.push(curG);
        }
        this._codeLinePoolIdx++;
        curG.visible = true;
        const curLine = 3 + Math.floor(this.animTime * 0.2) % 7;
        const cy = sy + 3 + curLine * 2.8;
        curG.rect(sx + 4 + (this.animTime * 3) % 30, cy, 2, 2)
            .fill({ color: this.color, alpha: 0.7 });
      }

    } else if (isError) {
      const flashAlpha = 0.12 + Math.sin(this.animTime * 0.3) * 0.08;
      g.roundRect(sx, sy, sw, sh, 1).fill({ color: 0xf85149, alpha: flashAlpha });
      // X symbol
      g.moveTo(sx + 10, sy + 6).lineTo(sx + sw - 10, sy + sh - 6);
      g.stroke({ width: 2, color: 0xf85149 });
      g.moveTo(sx + sw - 10, sy + 6).lineTo(sx + 10, sy + sh - 6);
      g.stroke({ width: 2, color: 0xf85149 });

    } else if (isDone) {
      g.roundRect(sx, sy, sw, sh, 1).fill({ color: 0x22c55e, alpha: 0.06 });
      // Checkmark
      g.moveTo(sx + 12, sy + sh / 2)
       .lineTo(sx + sw / 2 - 2, sy + sh - 8)
       .lineTo(sx + sw - 10, sy + 6);
      g.stroke({ width: 2.5, color: 0x22c55e });

    } else {
      // Off / idle
      g.roundRect(sx, sy, sw, sh, 1).fill(0x0a0a14);
      // Subtle screen reflection
      g.moveTo(sx + 3, sy + 2)
       .lineTo(sx + 10, sy + sh - 4)
       .lineTo(sx + 12, sy + sh - 4)
       .lineTo(sx + 5, sy + 2)
       .closePath()
       .fill({ color: 0xffffff, alpha: 0.03 });
    }
  }

  _drawIndicatorLights() {
    const g = this.indicatorGfx;
    g.clear();
    const my = -DESK_H - 4 - MONITOR_H + 3;
    const isActive = this.status === 'active';
    const isError = this.status === 'error' || this.status === 'timeout';
    const isDone = this.status === 'done';

    // Red — bright on error
    g.circle(-MONITOR_W / 2 + 6, my, 1.5)
     .fill({ color: 0xef4444, alpha: isError ? 0.9 : 0.3 });
    // Yellow — bright when idle
    g.circle(-MONITOR_W / 2 + 11, my, 1.5)
     .fill({ color: 0xfbbf24, alpha: (!isActive && !isError && !isDone) ? 0.8 : 0.3 });
    // Green — bright when active or done
    g.circle(-MONITOR_W / 2 + 16, my, 1.5)
     .fill({ color: 0x22c55e, alpha: (isActive || isDone) ? 0.9 : 0.3 });
  }

  _drawLampGlow() {
    const gg = this.lampGlowGfx;
    gg.clear();
    const lc = this.lightConeGfx;
    lc.clear();

    const isActive = this.status === 'active';
    const isDone = this.status === 'done';
    const isOff = this.status === 'offline';

    let glowAlpha, coneAlpha, bulbAlpha;
    if (isActive) {
      glowAlpha = 0.14 + Math.sin(this.animTime * 0.12) * 0.04;
      coneAlpha = 0.12;
      bulbAlpha = 0.45;
    } else if (isDone) {
      glowAlpha = 0.08;
      coneAlpha = 0.06;
      bulbAlpha = 0.25;
    } else if (isOff) {
      return; // no glow
    } else {
      // idle / queued
      glowAlpha = 0.05;
      coneAlpha = 0.04;
      bulbAlpha = 0.15;
    }

    const lx = -38;
    // Halo around lamp head
    gg.circle(lx, LAMP_BASE_Y - 24, 8).fill({ color: this.color, alpha: glowAlpha });
    gg.circle(lx, LAMP_BASE_Y - 24, 4).fill({ color: this.color, alpha: bulbAlpha });

    // Light cone from lamp down to desk surface
    lc.moveTo(lx, LAMP_BASE_Y - 10)
      .lineTo(lx - 15, 2)
      .lineTo(lx + 15, 2)
      .closePath()
      .fill({ color: this.color, alpha: coneAlpha });
  }

  _drawDeskHighlight() {
    const g = this.deskHighlightGfx;
    g.clear();

    const isActive = this.status === 'active';
    const isDone = this.status === 'done';
    const isOff = this.status === 'offline';
    if (isOff) return;

    const lx = -38;
    const alpha = isActive
      ? 0.16 + Math.sin(this.animTime * 0.15) * 0.04
      : isDone ? 0.08 : 0.04;

    // Elliptical glow on desk surface under lamp
    g.ellipse(lx, -4, 16, 5).fill({ color: this.color, alpha });
  }

  _drawSteam() {
    const g = this.steamGfx;
    g.clear();

    const isActive = this.status === 'active';
    const mx = 26, my = -8;

    for (let i = 0; i < this.steamParticles.length; i++) {
      const p = this.steamParticles[i];

      if (isActive) {
        p.life += 1;
        if (p.life > p.maxLife) resetSteamParticle(p);
      } else {
        if (p.life > 0) p.life = Math.max(0, p.life - 2);
      }

      if (p.life > 0) {
        const t = p.life / p.maxLife;
        const alpha = (1 - t) * 0.3;
        const px = mx + p.x + Math.sin(p.life * 0.08 + p.phase) * 2.5;
        const py = my - MUG_RADIUS - 2 - p.life * p.speed;
        const sz = p.size * (0.7 + t * 0.6);

        g.circle(px, py, sz).fill({ color: 0xffffff, alpha });
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// FUNCTIONAL API — wraps the class for alternative usage
// ══════════════════════════════════════════════════════════════════════════════

export function createDesk(agentColor, slotIndex, agentName) {
  return new Desk(agentColor, slotIndex, agentName);
}

export function updateDesk(desk, dt, newStatus) {
  if (newStatus !== undefined) desk.setStatus(newStatus);
  desk.tick(dt);
}

export function destroyDesk(desk) {
  desk.destroy();
}
