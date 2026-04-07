// Real Mode — Leaderboard overlay panel (PixiJS)
// Small top-right panel showing top 3 agents with crown/medal icons

import { getAgentColor, abbreviateId } from '../state.mjs';

const PIXI = window.PIXI;

const PANEL_W = 200;
const PANEL_H = 130;
const PANEL_MARGIN = 12;
const PANEL_PADDING = 10;
const ROW_HEIGHT = 28;
const TITLE_HEIGHT = 24;

export class LeaderboardOverlay {
  constructor(canvasW) {
    this.container = new PIXI.Container();
    this.container.position.set(canvasW - PANEL_W - PANEL_MARGIN, PANEL_MARGIN);
    this.container.alpha = 0.92;

    // Background panel
    this.bg = new PIXI.Graphics();
    this._drawBg();
    this.container.addChild(this.bg);

    // Title
    this.title = new PIXI.Text({
      text: '♛ LEADERBOARD',
      style: {
        fontFamily: 'monospace',
        fontSize: 11,
        fontWeight: 'bold',
        fill: 0xffd700,
        letterSpacing: 1,
      },
    });
    this.title.position.set(PANEL_PADDING + 2, PANEL_PADDING);
    this.container.addChild(this.title);

    // Divider line
    this.divider = new PIXI.Graphics();
    this.divider.rect(PANEL_PADDING, PANEL_PADDING + TITLE_HEIGHT - 4, PANEL_W - PANEL_PADDING * 2, 1);
    this.divider.fill(0x444466);
    this.container.addChild(this.divider);

    // Row containers for top 3
    this.rows = [];
    for (let i = 0; i < 3; i++) {
      const row = this._createRow(i);
      row.container.position.set(PANEL_PADDING, PANEL_PADDING + TITLE_HEIGHT + i * ROW_HEIGHT);
      this.container.addChild(row.container);
      this.rows.push(row);
    }

    this.lastData = [];
  }

  _drawBg() {
    this.bg.clear();
    // Rounded rect background
    this.bg.roundRect(0, 0, PANEL_W, PANEL_H, 8);
    this.bg.fill({ color: 0x0d0d1a, alpha: 0.85 });
    this.bg.roundRect(0, 0, PANEL_W, PANEL_H, 8);
    this.bg.stroke({ color: 0x2a2a4a, width: 1, alpha: 0.6 });
  }

  _createRow(index) {
    const container = new PIXI.Container();

    // Medal icon (drawn with graphics)
    const medal = new PIXI.Graphics();
    this._drawMedal(medal, index);
    container.addChild(medal);

    // Color dot
    const dot = new PIXI.Graphics();
    dot.circle(22, 10, 4);
    dot.fill(0x666666);
    container.addChild(dot);

    // Name text
    const name = new PIXI.Text({
      text: '---',
      style: {
        fontFamily: 'monospace',
        fontSize: 11,
        fill: 0xaaaacc,
      },
    });
    name.position.set(30, 2);
    container.addChild(name);

    // Score text (right-aligned)
    const score = new PIXI.Text({
      text: '',
      style: {
        fontFamily: 'monospace',
        fontSize: 10,
        fill: 0x888899,
      },
    });
    score.position.set(PANEL_W - PANEL_PADDING * 2 - 40, 3);
    container.addChild(score);

    return { container, medal, dot, name, score };
  }

  _drawMedal(gfx, rank) {
    gfx.clear();
    const colors = [0xffd700, 0xc0c0c0, 0xcd7f32]; // gold, silver, bronze
    const color = colors[rank] || 0x555555;

    // Circle medal
    gfx.circle(8, 10, 7);
    gfx.fill(color);
    gfx.circle(8, 10, 7);
    gfx.stroke({ color: 0x000000, width: 1, alpha: 0.3 });

    // Rank number inside
    const numText = new PIXI.Text({
      text: String(rank + 1),
      style: {
        fontFamily: 'monospace',
        fontSize: 9,
        fontWeight: 'bold',
        fill: rank === 0 ? 0x332200 : 0x222222,
      },
    });
    numText.anchor.set(0.5);
    numText.position.set(8, 10);
    gfx.addChild(numText);

    // Crown for #1
    if (rank === 0) {
      const crown = new PIXI.Graphics();
      // Simple crown shape
      crown.moveTo(3, 1);
      crown.lineTo(5, -2);
      crown.lineTo(8, 1);
      crown.lineTo(11, -2);
      crown.lineTo(13, 1);
      crown.fill(0xffd700);
      crown.stroke({ color: 0xaa8800, width: 0.5 });
      gfx.addChild(crown);
    }
  }

  /**
   * Update with new leaderboard data.
   * @param {Array} leaderboard - sorted array from API
   */
  update(leaderboard) {
    if (!leaderboard || leaderboard.length === 0) {
      this.container.visible = false;
      return;
    }

    this.container.visible = true;
    const top3 = leaderboard.slice(0, 3);
    this.lastData = top3;

    for (let i = 0; i < 3; i++) {
      const row = this.rows[i];
      if (i < top3.length) {
        const entry = top3[i];
        const color = parseInt(getAgentColor(entry.agentId).replace('#', ''), 16);

        // Update dot color
        row.dot.clear();
        row.dot.circle(22, 10, 4);
        row.dot.fill(color);

        // Update name
        const abbr = abbreviateId(entry.agentId);
        row.name.text = abbr.length > 12 ? abbr.slice(0, 12) : abbr;
        row.name.style.fill = i === 0 ? 0xffd700 : 0xaaaacc;

        // Update score
        row.score.text = `${entry.score}`;
        row.score.style.fill = i === 0 ? 0xffd700 : i === 1 ? 0xc0c0c0 : 0xcd7f32;

        row.container.visible = true;
      } else {
        row.container.visible = false;
      }
    }

    // Adjust panel height based on visible rows
    const visibleRows = Math.min(3, top3.length);
    const newH = PANEL_PADDING * 2 + TITLE_HEIGHT + visibleRows * ROW_HEIGHT;
    if (newH !== PANEL_H) {
      this.bg.clear();
      this.bg.roundRect(0, 0, PANEL_W, newH, 8);
      this.bg.fill({ color: 0x0d0d1a, alpha: 0.85 });
      this.bg.roundRect(0, 0, PANEL_W, newH, 8);
      this.bg.stroke({ color: 0x2a2a4a, width: 1, alpha: 0.6 });
    }
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}
