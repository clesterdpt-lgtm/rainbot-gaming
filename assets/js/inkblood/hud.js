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
} from "./art.js?v=20260802-5";
import { WEAPONS, PASSIVES } from "./weapons.js?v=20260802-5";

export class Hud {
  constructor(fonts) {
    this.fonts = fonts;
    this.scale = 1;
    this.hitRects = [];      // clickable regions, rebuilt each frame
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

  /* ------------------------------------------------------- */
  /* The main HUD                                            */
  /* ------------------------------------------------------- */

  draw(g, st) {
    const s = this.scale;
    const W = this.w;
    const H = this.h;
    this.hitRects.length = 0;

    /* ---- soul bar, hairline across the very top ------------ */
    const barY = 10 * s;
    const barX = 14 * s;
    const barW = W - 28 * s;
    this.bar(g, barX, barY, barW, 15 * s, st.xp / st.xpNeed, PAL.arcane);
    inkText(g, `LV ${st.level}`, barX + 10 * s, barY + 13 * s, {
      font: this.fonts.display(14 * s), halo: 4, outline: 2, colour: PAL.ink, align: "left",
    });

    /* ---- portrait + life ---------------------------------- */
    const pw = 124 * s;
    const ph = 138 * s;
    const px = 14 * s;
    const py = barY + 24 * s;
    this.panel(g, px, py, pw, ph, { seed: 5 });
    if (st.portrait) {
      g.save();
      g.beginPath();
      g.rect(px + 4 * s, py + 4 * s, pw - 8 * s, ph - 8 * s);
      g.clip();
      const img = st.portrait.canvas;
      const k = Math.max((pw - 8 * s) / img.width, (ph - 8 * s) / img.height);
      g.drawImage(img, px + 4 * s, py + 4 * s, img.width * k, img.height * k);
      g.restore();
    }
    g.fillStyle = PAL.ink;
    g.fillRect(px + 4 * s, py + ph - 26 * s, pw - 8 * s, 22 * s);
    inkText(g, "血墨", px + pw / 2, py + ph - 9 * s, {
      font: this.fonts.jp(15 * s), halo: 0, outline: 0, colour: PAL.paperLit, align: "center",
    });

    const lifeY = py + ph + 6 * s;
    this.bar(g, px, lifeY, pw, 17 * s, st.hp / st.maxHp, PAL.blood);
    inkText(g, `${Math.ceil(st.hp)} / ${Math.round(st.maxHp)}`, px + pw / 2, lifeY + 13 * s, {
      font: this.fonts.display(13 * s), halo: 3, outline: 1.6, colour: PAL.ink, align: "center",
    });

    /* ---- clock, top centre --------------------------------- */
    const mins = Math.floor(st.time / 60);
    const secs = Math.floor(st.time % 60);
    const clock = `${mins}:${String(secs).padStart(2, "0")}`;
    inkText(g, clock, W / 2, barY + 62 * s, {
      font: this.fonts.impact(46 * s), halo: 10, outline: 4.5, colour: PAL.ink, align: "center",
    });

    /* ---- kills + coin, top right --------------------------- */
    const rx = W - 16 * s;
    inkText(g, `${st.kills}`, rx - 28 * s, py + 22 * s, {
      font: this.fonts.display(24 * s), halo: 5, outline: 2.4, colour: PAL.ink, align: "right",
    });
    this.skullIcon(g, rx - 14 * s, py + 14 * s, 11 * s);
    inkText(g, `${st.coins}`, rx - 28 * s, py + 48 * s, {
      font: this.fonts.display(24 * s), halo: 5, outline: 2.4, colour: PAL.ink, align: "right",
    });
    this.coinIcon(g, rx - 14 * s, py + 40 * s, 9 * s);

    /* ---- loadout, bottom centre ---------------------------- */
    // Down here it can never collide with the clock or the soul bar,
    // however many weapons the run ends up carrying.
    const wSize = 36 * s;
    const pSize = 30 * s;
    const gapS = 5 * s;
    const wTotal = st.weapons.length * (wSize + gapS) - gapS;
    const pTotal = st.passives.length * (pSize + gapS) - gapS;
    const rowY = H - (st.boss && !st.boss.dead ? 152 * s : 78 * s)
      - (this.compact ? 44 * s : 0);
    let sx = W / 2 - wTotal / 2;
    st.weapons.forEach((w, i) => {
      const def = WEAPONS[w.id];
      this.slot(g, sx, rowY, wSize, def.sigil, w.level, w.level >= def.max, {
        seed: i + 2, evolved: !!def.evolved,
      });
      sx += wSize + gapS;
    });
    sx = W / 2 - pTotal / 2;
    const rowY2 = rowY + wSize + gapS;
    st.passives.forEach((pp, i) => {
      const def = PASSIVES[pp.id];
      this.slot(g, sx, rowY2, pSize, def.sigil, pp.level, pp.level >= def.max, { seed: i + 20 });
      sx += pSize + gapS;
    });

    /* ---- stat block, bottom left -------------------------- */
    if (st.showStats && !this.compact) this.statBlock(g, 14 * s, H - 232 * s, 172 * s, 218 * s, st);

    /* ---- minimap, bottom right ---------------------------- */
    if (!this.compact || W > 560) this.minimap(g, W - 130 * s, H - 130 * s, 114 * s, st);

    /* ---- boss bar ----------------------------------------- */
    if (st.boss && !st.boss.dead) {
      const bw = Math.min(720 * s, W * 0.6);
      const bx = (W - bw) / 2;
      const by = H - 52 * s;
      drawInkSigil(g, st.boss.def.sigil || "boss-skull", bx + 17 * s, by - 15 * s, 30 * s, {
        colour: PAL.ink, accent: PAL.blood,
      });
      inkText(g, st.boss.def.name.toUpperCase(), W / 2, by - 8 * s, {
        font: this.fonts.display(19 * s), halo: 6, outline: 3, colour: PAL.ink, align: "center",
      });
      this.bar(g, bx, by, bw, 18 * s, st.boss.hp / st.boss.maxHp, PAL.blood);
    }
  }

  skullIcon(g, x, y, r) {
    g.save();
    g.fillStyle = PAL.ink;
    roughCircle(g, x, y, r, 3, 0.06);
    g.fill();
    g.fillStyle = PAL.paperLit;
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
      font: this.fonts.impact(58 * s), halo: 12, outline: 6, colour: PAL.ink, align: "center",
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
          font: this.fonts.display(15 * s), halo: 0, outline: 0, colour: PAL.paperLit, align: "center",
        });
        g.restore();
      }
      g.restore();

      brush(g, [[x + 8 * s, y + 160 * s], [x + cw - 8 * s, y + 160 * s]],
        { width: 2.6 * s, taper: "both", jitter: 0.3, seed: 41 + i, colour: PAL.ink });

      inkText(g, c.name.toUpperCase(), x + cw / 2, y + 188 * s, {
        font: this.fonts.display(19 * s), halo: 0, outline: 0, colour: PAL.ink, align: "center",
      });
      const kindLabel = c.evolved ? "EVOLUTION"
        : c.level ? `LEVEL ${c.level}`
          : (c.kind === "newPassive" ? "NEW RELIC"
            : c.kind === "newWeapon" ? "NEW WEAPON" : "BOON");
      inkText(g, kindLabel, x + cw / 2, y + 208 * s, {
        font: this.fonts.display(13 * s), halo: 0, outline: 0,
        colour: c.evolved ? PAL.blood : PAL.inkSoft, align: "center",
      });

      // Description, wrapped.
      g.save();
      g.font = this.fonts.body(13.5 * s);
      g.fillStyle = PAL.inkSoft;
      g.textAlign = "center";
      const words = c.desc.split(" ");
      let line = "";
      let ly = y + 236 * s;
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (g.measureText(test).width > cw - 28 * s) {
          g.fillText(line, x + cw / 2, ly);
          ly += 17 * s;
          line = word;
        } else line = test;
      }
      if (line) g.fillText(line, x + cw / 2, ly);
      g.restore();

      if (isSel) {
        inkText(g, "▲", x + cw / 2, y + ch + 24 * s, {
          font: this.fonts.display(20 * s), halo: 4, outline: 2, colour: PAL.blood, align: "center",
        });
      }
    });

    inkText(g, "← →  CHOOSE      ENTER  TAKE IT", W / 2, H - 26 * s, {
      font: this.fonts.display(15 * s), halo: 5, outline: 2, colour: PAL.inkSoft, align: "center",
    });
  }

  hitTest(x, y) {
    for (const r of this.hitRects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.index;
    }
    return -1;
  }
}
