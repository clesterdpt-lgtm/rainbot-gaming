/* ============================================================
   INKBLOOD — hud.js
   The interface is part of the page, not an overlay on top of it.

   Every panel is a hand-inked rectangle with a slightly wrong
   corner, filled with paper and dropped on the artwork the way a
   manga panel sits on a spread. Bars are brush strokes. The only
   colour permitted is the crimson of the life bar and the violet
   of the soul meter, which is exactly the colour budget the rest
   of the game runs on.
   ============================================================ */

"use strict";

import {
  PAL, panelFrame, panelBody, inkText, brush, splat, tone, roughCircle,
  starburst, wobble, fillToneDevice, drawInkSigil,
} from "./art.js?v=20260803-2";
import { WEAPONS, PASSIVES } from "./weapons.js?v=20260803-close-slash-1";

export class Hud {
  constructor(fonts) {
    this.fonts = fonts;
    this.scale = 1;
    this.hitRects = [];      // clickable regions, rebuilt each frame
    this.regions = {};       // named layout regions for visual QA
    this.presentation = "open-ornamental-frame";
  }

  layout(w, h) {
    this.w = w;
    this.h = h;
    // Scale off whichever axis is tighter. Height alone leaves the
    // chrome enormous on a narrow phone, where a 170px status panel
    // covers a third of the playfield.
    this.scale = Math.max(0.58, Math.min(1.2, Math.min(h / 900, w / 1000)));
    this.compact = w < 720 || h < 520;
  }

  /* ------------------------------------------------------- */
  /* Small parts                                             */
  /* ------------------------------------------------------- */

  panel(g, x, y, w, h, opts = {}) {
    panelBody(g, x, y, w, h, { fill: opts.fill || "rgba(243,239,229,0.93)", shadow: opts.shadow });
    panelFrame(g, x, y, w, h, { weight: (opts.weight || 3) * this.scale, seed: opts.seed || 3, jitter: 1.4 });
  }

  /**
   * A bar drawn as a brush stroke inside an inked trough, with a
   * torn leading edge so it never looks like a progress widget.
   */
  bar(g, x, y, w, h, frac, colour, opts = {}) {
    const f = Math.max(0, Math.min(1, frac));
    g.save();
    // Trough
    g.fillStyle = "rgba(243,239,229,0.9)";
    g.fillRect(x, y, w, h);
    g.beginPath();
    g.rect(x, y, w, h);
    fillToneDevice(g, 0.22, 3);
    // Fill
    if (f > 0.001) {
      const fw = w * f;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + fw - h * 0.35, y);
      g.lineTo(x + fw, y + h * 0.5);
      g.lineTo(x + fw - h * 0.35, y + h);
      g.lineTo(x, y + h);
      g.closePath();
      g.fillStyle = colour;
      g.fill();
      if (opts.gloss !== false) {
        g.fillStyle = "rgba(255,255,255,0.28)";
        g.fillRect(x + 2, y + 2, Math.max(0, fw - 6), h * 0.26);
      }
    }
    // Ink border
    g.strokeStyle = PAL.ink;
    g.lineWidth = 2.2 * this.scale;
    g.strokeRect(x, y, w, h);
    g.restore();
  }

  /** Weapon / passive slot: a small inked square with a pictogram. */
  slot(g, x, y, size, sigil, level, maxed, opts = {}) {
    const s = this.scale;
    panelBody(g, x, y, size, size, { fill: opts.evolved ? PAL.ink : "rgba(243,239,229,0.95)", shadow: false });
    panelFrame(g, x, y, size, size, { weight: 2.4 * s, seed: (opts.seed || 1) * 7, jitter: 0.9 });
    drawInkSigil(g, sigil, x + size / 2, y + size / 2, size * 0.72, {
      colour: opts.evolved ? PAL.paperLit : PAL.ink,
      accent: opts.evolved ? PAL.bloodHot : PAL.blood,
      paper: opts.evolved ? PAL.ink : PAL.paperLit,
      evolved: !!opts.evolved,
    });
    if (level != null) {
      const pips = Math.min(level, 8);
      for (let i = 0; i < pips; i++) {
        g.fillStyle = maxed ? PAL.blood : PAL.ink;
        g.fillRect(x + 2 + i * (size - 6) / 8, y + size - 4, (size - 8) / 8, 2.6 * s);
      }
    }
  }

  /**
   * An open ornamental frame, not a filled panel. The reference lets the
   * battlefield run behind the readouts and uses fine ruled borders to bind
   * them into one composition.
   */
  commandPanel(g, x, y, w, h, seed = 61) {
    const u = this.uiScale || this.scale;
    g.save();
    g.globalAlpha = 0.82;
    const ruled = (a, b, lineSeed) => {
      brush(g, [a, b], {
        width: 1.65 * u, taper: "both", jitter: 0.2, seed: lineSeed, colour: PAL.paperLit,
      });
      brush(g, [a, b], {
        width: 0.48 * u, taper: "both", jitter: 0.2, seed: lineSeed, colour: PAL.ink,
      });
    };
    ruled([x + 11 * u, y + 6 * u], [x + w - 11 * u, y + 6 * u], seed + 2);

    g.globalAlpha = 0.72;
    const corners = [
      [x + 4 * u, y + 17 * u, 1, -1],
      [x + w - 4 * u, y + 17 * u, -1, -1],
    ];
    corners.forEach(([cx, cy, dx, dy], i) => {
      brush(g, [[cx, cy], [cx + dx * 10 * u, cy], [cx + dx * 15 * u, cy + dy * 5 * u]], {
        width: 1.9 * u, taper: "both", jitter: 0.16, seed: seed + 10 + i, colour: PAL.paperLit,
      });
      brush(g, [[cx, cy], [cx + dx * 10 * u, cy], [cx + dx * 15 * u, cy + dy * 5 * u]], {
        width: 0.58 * u, taper: "both", jitter: 0.16, seed: seed + 10 + i, colour: PAL.ink,
      });
    });
    g.restore();
  }

  /** A local paper knockout keeps each meter readable over the battlefield. */
  commandBar(g, x, y, w, h, frac, colour, seed = 71) {
    const u = this.uiScale || this.scale;
    const f = Math.max(0, Math.min(1, frac));
    g.save();
    g.fillStyle = "rgba(248,245,236,0.82)";
    g.fillRect(x, y, w, h);
    if (f > 0.001) {
      const fw = Math.max(h * 0.45, w * f);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.max(0, fw - h * 0.42), y);
      g.lineTo(x + fw, y + h * 0.5);
      g.lineTo(x + Math.max(0, fw - h * 0.42), y + h);
      g.lineTo(x, y + h);
      g.closePath();
      g.fillStyle = colour;
      g.fill();
      g.globalAlpha = 0.28;
      g.fillStyle = PAL.paperLit;
      g.fillRect(x + 2 * u, y + 2 * u, Math.max(0, fw - 5 * u), Math.max(1, h * 0.18));
      g.globalAlpha = 1;
    }
    panelFrame(g, x, y, w, h, {
      colour: PAL.paperLit, weight: 2.25 * u, seed, jitter: 0.45,
    });
    panelFrame(g, x, y, w, h, {
      colour: PAL.ink, weight: 0.85 * u, seed, jitter: 0.45,
    });
    g.restore();
  }

  /** The timer sits in a deliberately overbuilt manga chapter cartouche. */
  timerPlate(g, cx, cy, w, h, clock) {
    const u = this.uiScale || this.scale;
    const outer = [
      [cx, cy - h / 2 - 12 * u],
      [cx + w / 2 + 29 * u, cy],
      [cx, cy + h / 2 + 12 * u],
      [cx - w / 2 - 29 * u, cy],
    ];
    const points = [
      [cx - w / 2 + 18 * u, cy - h / 2],
      [cx + w / 2 - 18 * u, cy - h / 2],
      [cx + w / 2, cy],
      [cx + w / 2 - 18 * u, cy + h / 2],
      [cx - w / 2 + 18 * u, cy + h / 2],
      [cx - w / 2, cy],
    ];
    g.save();
    // Oversized diamond braces are the most distinctive piece of the sample
    // HUD. A paper under-stroke keeps their hairlines alive over busy terrain.
    outer.forEach((p, i) => {
      const q = outer[(i + 1) % outer.length];
      brush(g, [p, q], {
        width: 1.65 * u, taper: "both", jitter: 0.15, seed: 84 + i, colour: PAL.paperLit,
      });
      brush(g, [p, q], {
        width: 0.46 * u, taper: "both", jitter: 0.15, seed: 84 + i, colour: PAL.ink,
      });
    });
    g.beginPath();
    points.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.closePath();
    g.fillStyle = "rgba(27,27,34,0.98)";
    g.fill();
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length];
      brush(g, [p, q], {
        width: 2.2 * u, taper: "none", jitter: 0.18, seed: 90 + i, colour: PAL.ink,
      });
      brush(g, [p, q], {
        width: 0.72 * u, taper: "none", jitter: 0.18, seed: 90 + i, colour: PAL.paperLit,
      });
    });
    g.globalAlpha = 0.72;
    brush(g, [[cx - w / 2 - 26 * u, cy], [cx - w / 2 + 2 * u, cy]], {
      width: 0.68 * u, taper: "both", jitter: 0.14, seed: 98, colour: PAL.ink,
    });
    brush(g, [[cx + w / 2 - 2 * u, cy], [cx + w / 2 + 26 * u, cy]], {
      width: 0.68 * u, taper: "both", jitter: 0.14, seed: 99, colour: PAL.ink,
    });
    g.globalAlpha = 0.9;
    g.strokeStyle = PAL.ink;
    g.lineWidth = 0.9 * u;
    g.save();
    g.translate(cx, cy - h / 2);
    g.rotate(Math.PI / 4);
    g.strokeRect(-5 * u, -5 * u, 10 * u, 10 * u);
    g.restore();
    g.save();
    g.translate(cx, cy + h / 2);
    g.rotate(Math.PI / 4);
    g.strokeRect(-5 * u, -5 * u, 10 * u, 10 * u);
    g.restore();
    g.restore();
    inkText(g, clock, cx, cy + Math.max(8, 11 * u), {
      font: this.fonts.display(Math.max(24, 37 * u)), halo: 0, outline: 0,
      colour: PAL.paperLit, align: "center",
    });
  }

  emptySlot(g, x, y, size, seed) {
    const u = this.uiScale || this.scale;
    g.save();
    g.fillStyle = "rgba(248,245,236,0.82)";
    g.fillRect(x, y, size, size);
    g.globalAlpha = 0.8;
    panelFrame(g, x, y, size, size, {
      colour: PAL.paperLit, weight: 2.1 * u, seed, jitter: 0.5,
    });
    panelFrame(g, x, y, size, size, {
      colour: PAL.ink, weight: 0.78 * u, seed, jitter: 0.5,
    });
    brush(g, [[x + size * 0.29, y + size * 0.67], [x + size * 0.7, y + size * 0.31]], {
      width: 0.58 * u, taper: "both", jitter: 0.18, seed: seed + 1, colour: PAL.ink,
    });
    g.restore();
  }

  drawLoadout(g, st, x, y, maxW) {
    const u = this.uiScale || this.scale;
    const wSize = (this.compact ? 34 : 42) * u;
    const pSize = (this.compact ? 22 : 25) * u;
    const gap = 5 * u;
    const weaponCount = Math.min(6, Math.max(5, st.weapons.length));
    let sx = x;
    for (let i = 0; i < weaponCount; i++) {
      const weapon = st.weapons[i];
      if (weapon) {
        const def = WEAPONS[weapon.id];
        this.slot(g, sx, y, wSize, def.sigil, weapon.level, weapon.level >= def.max, {
          seed: i + 2, evolved: !!def.evolved,
        });
      } else {
        this.emptySlot(g, sx, y, wSize, 112 + i * 3);
      }
      sx += wSize + gap;
    }

    sx += 6 * u;
    for (let i = 0; i < st.passives.length; i++) {
      if (sx + pSize > x + maxW) break;
      const passive = st.passives[i];
      const def = PASSIVES[passive.id];
      this.slot(g, sx, y + (wSize - pSize) / 2, pSize, def.sigil,
        passive.level, passive.level >= def.max, { seed: i + 30 });
      sx += pSize + gap;
    }
    return { x, y, w: Math.min(maxW, Math.max(0, sx - x - gap)), h: wSize };
  }

  soulIcon(g, x, y, r) {
    g.save();
    g.translate(x, y);
    g.rotate(Math.PI / 4);
    g.fillStyle = PAL.arcane;
    g.fillRect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
    g.strokeStyle = PAL.ink;
    g.lineWidth = Math.max(1, r * 0.16);
    g.strokeRect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
    g.globalAlpha = 0.6;
    g.strokeStyle = PAL.ink;
    g.strokeRect(-r * 0.32, -r * 0.32, r * 0.64, r * 0.64);
    g.restore();
  }

  /* ------------------------------------------------------- */
  /* The main HUD                                            */
  /* ------------------------------------------------------- */

  draw(g, st) {
    const s = this.scale;
    const W = this.w;
    const H = this.h;
    const u = this.compact ? Math.max(0.72, s) : s;
    this.uiScale = u;
    this.hitRects.length = 0;
    this.regions = {};

    const inset = Math.max(7, 14 * s);
    const bandY = Math.max(7, 11 * s);
    const bandX = inset;
    const bandW = W - inset * 2;
    const bandH = (this.compact ? 132 : 124) * u;
    const controlReserve = this.compact ? 90 : 100;
    this.commandPanel(g, bandX, bandY, bandW, bandH);
    this.regions.band = { x: bandX, y: bandY, w: bandW, h: bandH };

    const mins = Math.floor(st.time / 60);
    const secs = Math.floor(st.time % 60);
    const clock = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

    if (this.compact) {
      const hpX = bandX + 9 * u;
      const hpY = bandY + 11 * u;
      const hpW = Math.max(110, bandW - controlReserve - 17 * u);
      const hpH = 12 * u;
      this.commandBar(g, hpX, hpY, hpW, hpH, st.hp / st.maxHp, PAL.blood, 72);
      inkText(g, `HP  ${Math.ceil(st.hp)} / ${Math.round(st.maxHp)}`, hpX, hpY + 27 * u, {
        font: this.fonts.display(Math.max(12, 14 * u)), halo: Math.max(2.5, 3 * u), outline: 0,
        colour: PAL.ink, align: "left",
      });
      this.regions.hp = { x: hpX, y: hpY, w: hpW, h: hpH };

      const timerW = 112 * u;
      const timerH = 46 * u;
      const timerY = bandY + 50 * u;
      this.timerPlate(g, W / 2, timerY, timerW, timerH, clock);
      this.regions.timer = { x: W / 2 - timerW / 2, y: timerY - timerH / 2, w: timerW, h: timerH };

      inkText(g, `LV. ${st.level}`, bandX + 11 * u, bandY + 65 * u, {
        font: this.fonts.display(Math.max(12, 14 * u)), halo: Math.max(2.5, 3 * u), outline: 0,
        colour: PAL.ink, align: "left",
      });
      const counterY = bandY + 63 * u;
      const right = bandX + bandW - 10 * u;
      this.skullIcon(g, right - 77 * u, counterY - 5 * u, 7 * u);
      inkText(g, `${st.kills}`, right - 64 * u, counterY, {
        font: this.fonts.display(Math.max(12, 14 * u)), halo: Math.max(2.5, 3 * u), outline: 0,
        colour: PAL.ink, align: "left",
      });
      this.soulIcon(g, right - 28 * u, counterY - 5 * u, 6 * u);
      inkText(g, `${st.coins}`, right - 16 * u, counterY, {
        font: this.fonts.display(Math.max(12, 14 * u)), halo: Math.max(2.5, 3 * u), outline: 0,
        colour: PAL.ink, align: "left",
      });
      const xpY = bandY + 70 * u;
      this.commandBar(g, bandX + 10 * u, xpY, bandW - 20 * u, 3 * u,
        st.xp / st.xpNeed, PAL.arcane, 79);
      this.regions.xp = { x: bandX + 10 * u, y: xpY, w: bandW - 20 * u, h: 3 * u };

      const loadoutY = bandY + 84 * u;
      this.regions.loadout = this.drawLoadout(g, st, bandX + 11 * u, loadoutY, bandW - 22 * u);
    } else {
      const timerW = 180 * u;
      const timerH = 68 * u;
      const timerCx = W / 2;
      const timerCy = bandY + 42 * u;
      this.timerPlate(g, timerCx, timerCy, timerW, timerH, clock);
      this.regions.timer = { x: timerCx - timerW / 2, y: timerCy - timerH / 2, w: timerW, h: timerH };

      const hpX = bandX + 12 * u;
      const hpY = bandY + 15 * u;
      const hpW = Math.max(180 * u,
        Math.min(360 * u, timerCx - timerW / 2 - hpX - 26 * u));
      const hpH = 17 * u;
      this.commandBar(g, hpX, hpY, hpW, hpH, st.hp / st.maxHp, PAL.blood, 73);
      inkText(g, `HP  ${Math.ceil(st.hp)} / ${Math.round(st.maxHp)}`, hpX, hpY + 30 * u, {
        font: this.fonts.display(Math.max(12, 15 * u)), halo: Math.max(2.5, 3.5 * u), outline: 0,
        colour: PAL.ink, align: "left",
      });
      this.regions.hp = { x: hpX, y: hpY, w: hpW, h: hpH };

      const rightX = timerCx + timerW / 2 + 28 * u;
      const rightEdge = bandX + bandW - controlReserve;
      const xpW = Math.max(80 * u, rightEdge - rightX);
      const xpY = bandY + 15 * u;
      this.commandBar(g, rightX, xpY, xpW, 8 * u, st.xp / st.xpNeed, PAL.arcane, 78);
      inkText(g, `LV. ${st.level}`, rightEdge, xpY - 2 * u, {
        font: this.fonts.display(Math.max(12, 15 * u)), halo: Math.max(2.5, 3.5 * u), outline: 0,
        colour: PAL.ink, align: "right",
      });
      this.regions.xp = { x: rightX, y: xpY, w: xpW, h: 8 * u };

      const statFont = Math.max(14, 21 * u);
      this.skullIcon(g, rightEdge - 8 * u, bandY + 50 * u, 8 * u);
      inkText(g, `${st.kills}`, rightEdge - 24 * u, bandY + 57 * u, {
        font: this.fonts.display(statFont), halo: 4 * u, outline: 0,
        colour: PAL.ink, align: "right",
      });
      this.soulIcon(g, rightEdge - 8 * u, bandY + 82 * u, 7 * u);
      inkText(g, `${st.coins}`, rightEdge - 24 * u, bandY + 88 * u, {
        font: this.fonts.display(statFont), halo: 4 * u, outline: 0,
        colour: PAL.ink, align: "right",
      });

      const loadoutY = bandY + 70 * u;
      const maxLoadoutW = timerCx - timerW / 2 - hpX - 18 * u;
      this.regions.loadout = this.drawLoadout(g, st, hpX, loadoutY, maxLoadoutW);
    }

    /* ---- stat block, bottom left -------------------------- */
    if (st.showStats && !this.compact) this.statBlock(g, 14 * s, H - 232 * s, 172 * s, 218 * s, st);

    /* ---- minimap, bottom right ---------------------------- */
    if (!this.compact) {
      const radarSize = 78 * u;
      const radarX = W - radarSize - 17 * u;
      const radarY = H - radarSize - 17 * u;
      this.minimap(g, radarX, radarY, radarSize, st);
      this.regions.radar = { x: radarX, y: radarY, w: radarSize, h: radarSize };
    }

    /* ---- boss bar ----------------------------------------- */
    if (st.boss && !st.boss.dead) {
      const bw = Math.min(720 * s, W * 0.6);
      const bx = (W - bw) / 2;
      const by = H - 52 * s;
      drawInkSigil(g, st.boss.def.sigil || "boss-skull", bx + 17 * s, by - 15 * s, 30 * s, {
        colour: PAL.ink, accent: PAL.blood,
      });
      inkText(g, st.boss.def.name.toUpperCase(), W / 2, by - 8 * s, {
        font: this.fonts.display(Math.max(14, 18 * s)), halo: 3.5, outline: 1.2,
        colour: PAL.ink, align: "center",
      });
      this.bar(g, bx, by, bw, 18 * s, st.boss.hp / st.boss.maxHp, PAL.blood);
    }
  }

  skullIcon(g, x, y, r, invert = false) {
    g.save();
    g.fillStyle = invert ? PAL.paperLit : PAL.ink;
    roughCircle(g, x, y, r, 3, 0.06);
    g.fill();
    g.fillStyle = invert ? PAL.ink : PAL.paperLit;
    g.beginPath();
    g.ellipse(x - r * 0.34, y - r * 0.1, r * 0.24, r * 0.3, 0, 0, Math.PI * 2);
    g.ellipse(x + r * 0.34, y - r * 0.1, r * 0.24, r * 0.3, 0, 0, Math.PI * 2);
    g.fill();
    g.fillRect(x - r * 0.4, y + r * 0.42, r * 0.8, r * 0.3);
    g.restore();
  }

  coinIcon(g, x, y, r) {
    g.save();
    roughCircle(g, x, y, r, 5, 0.05);
    g.fillStyle = PAL.paperLit;
    g.fill();
    g.strokeStyle = PAL.ink;
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = PAL.ink;
    g.fillRect(x - r * 0.24, y - r * 0.24, r * 0.48, r * 0.48);
    g.restore();
  }

  statBlock(g, x, y, w, h, st) {
    const s = this.scale;
    this.panel(g, x, y, w, h, { seed: 9 });
    const rows = [
      ["MIGHT", `+${Math.round((st.stats.might - 1) * 100)}%`],
      ["HASTE", `+${Math.round((1 - st.stats.cooldown) * 100)}%`],
      ["AREA", `+${Math.round((st.stats.area - 1) * 100)}%`],
      ["AMOUNT", `+${st.stats.amount}`],
      ["ARMOUR", `${st.stats.armor}`],
      ["SPEED", `+${Math.round((st.stats.moveSpeed - 1) * 100)}%`],
      ["MAGNET", `+${Math.round((st.stats.magnet - 1) * 100)}%`],
      ["FORTUNE", `+${Math.round((st.stats.luck - 1) * 100)}%`],
      ["REGEN", `${st.stats.regen.toFixed(1)}/s`],
      ["REVIVE", `${st.stats.revives}`],
    ];
    inkText(g, "STATUS", x + w / 2, y + 20 * s, {
      font: this.fonts.display(15 * s), halo: 0, outline: 0, colour: PAL.ink, align: "center",
    });
    brush(g, [[x + 10 * s, y + 26 * s], [x + w - 10 * s, y + 26 * s]],
      { width: 1.4 * s, taper: "both", jitter: 0.4, seed: 4, colour: PAL.ink });
    rows.forEach((r, i) => {
      const ry = y + 44 * s + i * 17 * s;
      inkText(g, r[0], x + 10 * s, ry, {
        font: this.fonts.display(12.5 * s), halo: 0, outline: 0, colour: PAL.inkSoft, align: "left",
      });
      inkText(g, r[1], x + w - 10 * s, ry, {
        font: this.fonts.display(12.5 * s), halo: 0, outline: 0, colour: PAL.ink, align: "right",
      });
    });
  }

  minimap(g, x, y, size, st) {
    const s = this.scale;
    const cx = x + size / 2;
    const cy = y + size / 2;
    const R = size / 2;
    g.save();
    roughCircle(g, cx, cy, R, 7, 0.03);
    g.save();
    g.clip();
    g.fillStyle = "rgba(243,239,229,0.9)";
    g.fillRect(x, y, size, size);
    g.beginPath();
    g.rect(x, y, size, size);
    fillToneDevice(g, 0.26, 3);
    // Enemies as ink flecks, scaled from a 2400-unit window.
    const range = 1500;
    for (const e of st.enemyPositions) {
      const dx = (e[0] - st.px) / range * R;
      const dy = (e[1] - st.py) / range * R;
      if (dx * dx + dy * dy > R * R) continue;
      g.fillStyle = e[2] ? PAL.blood : PAL.ink;
      const r = e[2] ? 3.4 * s : 1.9 * s;
      g.beginPath();
      g.arc(cx + dx, cy + dy, r, 0, Math.PI * 2);
      g.fill();
    }
    // The player.
    starburst(g, cx, cy, 6 * s, { points: 4, inner: 0.24, colour: PAL.arcane });
    g.restore();
    g.strokeStyle = PAL.ink;
    g.lineWidth = 3 * s;
    roughCircle(g, cx, cy, R, 7, 0.03);
    g.stroke();
    g.restore();
  }

  /* ------------------------------------------------------- */
  /* Level-up choice                                         */
  /* ------------------------------------------------------- */

  drawLevelUp(g, st, choices, selected, anim) {
    const s = this.scale;
    const W = this.w;
    const H = this.h;

    // Dim the fight behind a wash of tone.
    g.save();
    g.globalAlpha = 0.9;
    g.fillStyle = PAL.paperLit;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
    g.beginPath();
    g.rect(0, 0, W, H);
    fillToneDevice(g, 0.2, 4);
    g.restore();

    const pop = Math.min(1, anim / 0.22);
    inkText(g, "LEVEL UP", W / 2, 92 * s * pop, {
      font: this.fonts.display(52 * s), halo: 6, outline: 2.4, colour: PAL.ink, align: "center",
    });
    brush(g, [[W / 2 - 118 * s, 122 * s * pop], [W / 2 - 26 * s, 122 * s * pop]],
      { width: 2.4 * s, taper: "both", jitter: 0.2, seed: 80, colour: PAL.blood });
    starburst(g, W / 2, 122 * s * pop, 8 * s, { points: 4, inner: 0.18, colour: PAL.blood });
    brush(g, [[W / 2 + 26 * s, 122 * s * pop], [W / 2 + 118 * s, 122 * s * pop]],
      { width: 2.4 * s, taper: "both", jitter: 0.2, seed: 81, colour: PAL.blood });

    const n = choices.length;
    const cw = Math.min(280 * s, (W - 60 * s) / n - 16 * s);
    const ch = 330 * s;
    const gap = 18 * s;
    const total = n * cw + (n - 1) * gap;
    const x0 = (W - total) / 2;
    const y0 = H / 2 - ch / 2 + 26 * s;

    this.hitRects.length = 0;
    choices.forEach((c, i) => {
      const x = x0 + i * (cw + gap);
      const isSel = i === selected;
      const lift = isSel ? -10 * s : 0;
      const y = y0 + lift;
      this.hitRects.push({ x, y, w: cw, h: ch, index: i });

      g.save();
      if (isSel) {
        g.shadowColor = "rgba(192,20,33,0.55)";
        g.shadowBlur = 26 * s;
      }
      panelBody(g, x, y, cw, ch, { fill: PAL.paperLit });
      g.restore();
      panelFrame(g, x, y, cw, ch, { weight: (isSel ? 5 : 3) * s, seed: 30 + i * 5, jitter: 1.8 });

      // A large hand-drawn sigil makes the choice readable by shape,
      // without asking every card to carry another line of Japanese.
      g.save();
      g.beginPath();
      g.rect(x + 6 * s, y + 6 * s, cw - 12 * s, 150 * s);
      g.clip();
      g.fillStyle = PAL.paperLit;
      g.fillRect(x, y, cw, 160 * s);
      g.beginPath();
      g.moveTo(x, y + 160 * s);
      g.lineTo(x, y + 40 * s);
      g.lineTo(x + cw, y + 10 * s);
      g.lineTo(x + cw, y + 160 * s);
      g.closePath();
      fillToneDevice(g, c.evolved ? 0.62 : 0.3, 4);
      drawInkSigil(g, c.sigil || "slash", x + cw / 2, y + 83 * s, Math.min(112 * s, cw * 0.56), {
        colour: PAL.ink,
        accent: PAL.blood,
        paper: PAL.paperLit,
        evolved: !!c.evolved,
      });
      if (c.isNew) {
        g.save();
        g.translate(x + cw - 34 * s, y + 30 * s);
        g.rotate(0.24);
        splat(g, 0, 0, 22 * s, { seed: 12 + i, colour: PAL.blood, drops: 4, rough: 0.5 });
        inkText(g, "NEW", 0, 5 * s, {
          font: this.fonts.display(Math.max(11, 15 * s)), halo: 0, outline: 0,
          colour: PAL.paperLit, align: "center",
        });
        g.restore();
      }
      g.restore();

      brush(g, [[x + 8 * s, y + 160 * s], [x + cw - 8 * s, y + 160 * s]],
        { width: 2.6 * s, taper: "both", jitter: 0.3, seed: 41 + i, colour: PAL.ink });

      inkText(g, c.name.toUpperCase(), x + cw / 2, y + 188 * s, {
        font: this.fonts.display(Math.max(13, 19 * s)), halo: 0, outline: 0,
        colour: PAL.ink, align: "center",
      });
      const kindLabel = c.evolved ? "EVOLUTION"
        : c.level ? `LEVEL ${c.level}`
          : (c.kind === "newPassive" ? "NEW RELIC"
            : c.kind === "newWeapon" ? "NEW WEAPON" : "BOON");
      inkText(g, kindLabel, x + cw / 2, y + 208 * s, {
        font: this.fonts.display(Math.max(11, 13 * s)), halo: 0, outline: 0,
        colour: c.evolved ? PAL.blood : PAL.inkSoft, align: "center",
      });

      // Description, wrapped.
      g.save();
      const bodySize = Math.max(11.5, 13.5 * s);
      const bodyLine = Math.max(14, 17 * s);
      g.font = this.fonts.body(bodySize);
      g.fillStyle = PAL.inkSoft;
      g.textAlign = "center";
      const words = c.desc.split(" ");
      let line = "";
      let ly = y + 236 * s;
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (g.measureText(test).width > cw - 28 * s) {
          g.fillText(line, x + cw / 2, ly);
          ly += bodyLine;
          line = word;
        } else line = test;
      }
      if (line) g.fillText(line, x + cw / 2, ly);
      g.restore();

      if (isSel) {
        inkText(g, "▲", x + cw / 2, y + ch + 24 * s, {
          font: this.fonts.display(19 * s), halo: 2.5, outline: 1, colour: PAL.blood, align: "center",
        });
      }
    });

    inkText(g, "← →  CHOOSE      ENTER  TAKE IT", W / 2, H - 26 * s, {
      font: this.fonts.display(Math.max(12, 15 * s)), halo: 2.5, outline: 1,
      colour: PAL.inkSoft, align: "center",
    });
  }

  hitTest(x, y) {
    for (const r of this.hitRects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.index;
    }
    return -1;
  }
}
