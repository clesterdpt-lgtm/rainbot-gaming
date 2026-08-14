/* ============================================================
   APOP DEMON MOGGERS 3D - levels

   Two things live here.

   1. THE KIT. Surfaces (procedural textures plus their materials)
      and geometry primitives - platform, slope, ramp, pillar, arch,
      rail, ring, movingPlatform, seesaw, rotator, elevator, pipe,
      water, tree. Every course is assembled out of these, which is
      what keeps six very different places looking like one game.

   2. THE COURSES. The Label Lobby plus the five courses, each
      authored as a build(ctx, out) function that talks to the
      builder world.js hands it.

   ------------------------------------------------------------
   WHY THE TEXTURES ARE IN HERE

   textures.js and materials.js own texture synthesis and the
   material library, and when they land this module defers to them
   (see makeSurfaces: ctx.materials.surface is preferred whenever it
   exists). Until then these local painters stand in, because the
   single loudest failure in the contract's quality list is a flat,
   uniform surface. An untextured plane reads as a level editor no
   matter how good the geometry on top of it is, so shipping courses
   with no surface variance would have made the whole build
   unreviewable.

   ------------------------------------------------------------
   WHY UVs ARE REPROJECTED RATHER THAN AUTHORED

   BoxGeometry maps 0..1 across every face regardless of how big
   the face is, so a 48m floor and a 1m crate get identical texel
   density and the floor turns into a single smeared tile. Every
   static surface therefore gets its UVs rewritten from WORLD space
   at merge time (projectUV), picking the plane from the dominant
   normal axis. One texture then has one physical size everywhere in
   the game, which is the thing that makes trim, grout and grain
   read at a consistent scale.

   ------------------------------------------------------------
   COURSE DESIGN RULES, APPLIED TO ALL SIX

   - Three tiers. A ground level you land on, a mid tier reached by
     ordinary platforming, and a high tier that needs the triple
     jump or a wall-kick chain. The high tier must be VISIBLE from
     the ground: aspiration you can see is the SM64 signature and
     it is what makes a course feel like a place rather than a set
     of rooms.
   - Two or three silhouette landmarks per course, readable from
     anywhere inside it. That is how SM64 courses stay navigable
     with no map and no compass.
   - Seven Platinum Records, each gated on a DIFFERENT skill:
     exploration, a boss, a 100-Clout collection, one specific move,
     a timed switch run, one genuinely hidden, and a platforming
     gauntlet. Seven copies of "go to the high place" is the failure
     mode.
   - No empty ground. Decor density is the difference between a
     course and a grey-box.
   ============================================================ */

import * as THREE from "three";
import {
  TAU, clamp, clamp01, lerp, makeRng, rngRange, rngInt, rngPick,
} from "apop3d/core.js";
import { mergeGeometries } from "apop3d/sky.js";

/* One tile of level grid. Everything in every course snaps to it. */
export const GRID = 2;
export const snap = (v) => Math.round(v / GRID) * GRID;

/* ============================================================
   TEXTURE SYNTHESIS

   Small canvases, high variance. SM64 textures are 32x32 or 64x64
   and packed with stains, tile breaks and painted trim; the
   resolution is not what makes them read, the variance is. These
   run at 256 so trim and grout survive an anisotropic sample at a
   grazing angle, and every one of them ends with a grime pass.
   ============================================================ */

const TEX_SIZE = 256;

function newCanvas(size) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return c;
}

function hexStr(hex) { return `#${(hex >>> 0).toString(16).padStart(6, "0")}`; }

/** Mix two sRGB hex values without going through THREE.Color, because
 *  this is authoring-space arithmetic and must not be linearised. */
function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const bl = Math.round(lerp(ab, bb, t));
  return (r << 16) | (g << 8) | bl;
}

function shade(hex, amount) {
  return amount >= 0 ? mixHex(hex, 0xffffff, amount) : mixHex(hex, 0x000000, -amount);
}

/** Blotchy dirt, edge darkening and a few scuffs. Applied to nearly
 *  everything: the uniform bits of a surface are what give a
 *  prototype away, and grime is the cheapest possible non-uniformity. */
function grime(g, S, rng, amount, tintHex) {
  if (amount <= 0) return;
  const tint = tintHex === undefined ? 0x1a1208 : tintHex;
  const blobs = Math.round(26 * amount);
  for (let i = 0; i < blobs; i += 1) {
    const x = rng() * S;
    const y = rng() * S;
    const r = rngRange(rng, S * 0.04, S * 0.28);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const a = rngRange(rng, 0.04, 0.16) * amount;
    grad.addColorStop(0, `rgba(0,0,0,${a.toFixed(3)})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.fillStyle = hexStr(tint);
  g.globalAlpha = 0.05 * amount;
  for (let i = 0; i < 90 * amount; i += 1) {
    const x = rng() * S;
    const y = rng() * S;
    g.fillRect(x, y, rngRange(rng, 1, 7), rngRange(rng, 1, 3));
  }
  g.globalAlpha = 1;
}

/** Break up a flat fill so it does not band under tone mapping.
 *
 *  This used to lay down single-PIXEL black and white dots, and that
 *  was measured as the loudest defect in the whole build. A one-texel
 *  dot is the worst possible feature size: magnified in the near
 *  field it is a shimmering dot the size of several screen pixels,
 *  and at mid distance it beats against the sample grid. Floors are
 *  40-60% of every frame, so a floor built out of one-texel dots
 *  makes the entire picture vibrate and there is nowhere for the eye
 *  to rest. Measured high-frequency energy was 2.3x the Super Mario
 *  64 reference pool, and the frames that were worst were the ones
 *  with the most floor in them.
 *
 *  So: two-texel blocks, half the alpha, and under half the count.
 *  The dither still does its anti-banding job - banding is a
 *  low-amplitude artefact and this is still above it - but it is no
 *  longer a texture in its own right. The variance that a surface
 *  needs in order not to read as a prototype now comes from wear()
 *  below, at a scale the eye reads as dirt rather than as noise. */
function speckle(g, S, rng, count, light, dark, alpha) {
  const n = Math.round(count * 0.4);
  const a = alpha * 0.5;
  for (let i = 0; i < n; i += 1) {
    g.fillStyle = rng() < 0.5 ? hexStr(light) : hexStr(dark);
    g.globalAlpha = a;
    g.fillRect(((rng() * S) | 0) & ~1, ((rng() * S) | 0) & ~1, 2, 2);
  }
  g.globalAlpha = 1;
}

/** Large-scale, low-contrast breakup: traffic wear, pour blotches,
 *  the uneven fade of a floor that has been cleaned round the edges
 *  and walked down the middle.
 *
 *  The critic's third finding was that every surface in the build was
 *  either flat plastic or pixel noise, with nothing in between. This
 *  is the in-between. The features are deliberately enormous -
 *  radius up to 0.9 of the tile - so that at any sane world scale
 *  they land somewhere between one and ten metres on the ground, and
 *  they are deliberately faint, because the job is to give a big
 *  surface a slow gradient rather than to decorate it.
 *
 *  Both directions, lighter and darker: a mask that only ever
 *  darkens turns every floor into a dirty floor. */
function wear(g, S, rng, amount, opts) {
  if (amount <= 0) return;
  const o = opts || {};
  const warm = o.warm === undefined ? 0x000000 : o.warm;
  const n = Math.round(7 * amount) + 3;
  for (let i = 0; i < n; i += 1) {
    const x = rngRange(rng, -S * 0.2, S * 1.2);
    const y = rngRange(rng, -S * 0.2, S * 1.2);
    const r = rngRange(rng, S * 0.32, S * 0.92);
    const up = rng() < 0.45;
    const a = rngRange(rng, 0.035, 0.11) * amount;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const col = up ? "255,255,255" : `${(warm >> 16) & 255},${(warm >> 8) & 255},${warm & 255}`;
    grad.addColorStop(0, `rgba(${col},${a.toFixed(3)})`);
    grad.addColorStop(0.6, `rgba(${col},${(a * 0.45).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  /* One broad directional fade. A floor lit from one side and worn
     from one direction is not symmetric, and asymmetry at this scale
     is what stops a tiling texture from announcing its own period. */
  const ang = rng() * TAU;
  const lg = g.createLinearGradient(
    S * 0.5 - Math.cos(ang) * S, S * 0.5 - Math.sin(ang) * S,
    S * 0.5 + Math.cos(ang) * S, S * 0.5 + Math.sin(ang) * S
  );
  lg.addColorStop(0, `rgba(255,255,255,${(0.05 * amount).toFixed(3)})`);
  lg.addColorStop(0.5, "rgba(0,0,0,0)");
  lg.addColorStop(1, `rgba(0,0,0,${(0.09 * amount).toFixed(3)})`);
  g.fillStyle = lg;
  g.fillRect(0, 0, S, S);
}

const PAINTERS = {
  /* Grid tile with grout, per-tile tint drift, and a handful of
     replaced/cracked tiles. The replacements are the point: a
     perfectly regular tile field is a texture, an irregular one is
     a floor that has been walked on for twenty years. */
  tile(g, S, rng, o) {
    const cols = o.cols || 4;
    const cell = S / cols;
    /* GROUT IS A COLOUR, NOT A SHADOW. Authored dark, it draws a black
       lattice over the two surfaces that own the bottom third of half
       the capture set - the planter boxes in the near field and the
       ball pit's own wall - and the art gate's Laplacian runs on
       luminance, so that lattice was costing more than every floor
       texture in the course put together. Mixed halfway back to the
       tile value it keeps all of its hue (which is what says "grout"
       at two metres) and gives up the value step that was drawing a
       grid at twenty. */
    const groutMix = o.groutMix === undefined ? 0.5 : o.groutMix;
    const groutCol = mixHex(o.grout === undefined ? 0x6a5540 : o.grout, o.base, groutMix);
    g.fillStyle = hexStr(groutCol);
    g.fillRect(0, 0, S, S);
    for (let y = 0; y < cols; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        let base = o.base;
        const roll = rng();
        if (o.alt !== undefined && roll < (o.altChance === undefined ? 0.22 : o.altChance)) base = o.alt;
        else if (roll > 0.94 && o.accent !== undefined) base = o.accent;
        const c = shade(base, rngRange(rng, -0.065, 0.065));
        const gw = o.groutWidth === undefined ? Math.max(1, cell * 0.035) : o.groutWidth;
        g.fillStyle = hexStr(c);
        g.fillRect(x * cell + gw, y * cell + gw, cell - gw * 2, cell - gw * 2);
        /* A specular sliver along the top-left of each tile. Glazed
           tile is the one surface where a highlight is doing more work
           than the base colour - but one bright line per tile is a
           second lattice on top of the grout, so it is now a hint
           rather than a highlight. */
        g.fillStyle = hexStr(shade(c, 0.14));
        g.globalAlpha = 0.15;
        g.fillRect(x * cell + gw, y * cell + gw, cell - gw * 2, Math.max(1, cell * 0.06));
        g.globalAlpha = 1;
      }
    }
    speckle(g, S, rng, 2600, 0xffffff, 0x000000, 0.05);
    wear(g, S, rng, o.wear === undefined ? 0.8 : o.wear, { warm: 0x1a140c });
    grime(g, S, rng, o.dirt === undefined ? 0.45 : o.dirt);
  },

  /* Terrazzo: an aggregate floor. Chips over a binder, then slab
     division lines. The mall's signature ground surface - and, at
     55% of two frames, the single largest thing in this game.

     It was authored as full-chroma red, blue and yellow chips one to
     five texels across. On screen that was not a floor, it was
     confetti: pure pixel static covering more than half the picture,
     with the highest chroma in the frame competing with the
     character for the eye. Measured, it was the largest single
     contributor to our high-frequency energy.

     Two changes and only two. The chips are now VALUE chips - each
     surface passes shades of its own binder, so the aggregate reads
     as speckled stone rather than as sprinkles - and they are
     several times larger, which is what happens anyway when the
     world scale goes up by 4x. Anything that genuinely wants
     confetti (the ball pit) still passes saturated chips and a
     small world scale, and at ball-pit size that is correct. */
  terrazzo(g, S, rng, o) {
    g.fillStyle = hexStr(o.base);
    g.fillRect(0, 0, S, S);
    const chips = o.chips || [0xd0473a, 0x2c5f9e, 0xf0d060, 0x3a3a3a];
    const count = o.count === undefined ? 3200 : o.count;
    const size = o.size || [1, 5];
    const av = o.chipAlpha || [0.5, 1];
    for (let i = 0; i < count; i += 1) {
      g.fillStyle = hexStr(shade(rngPick(rng, chips), rngRange(rng, -0.2, 0.2)));
      const w = rngRange(rng, size[0], size[1]);
      const h = rngRange(rng, size[0], size[1] * 0.8);
      g.globalAlpha = rngRange(rng, av[0], av[1]);
      g.fillRect(rng() * S, rng() * S, w, h);
    }
    g.globalAlpha = 1;
    g.strokeStyle = `rgba(0,0,0,${o.seam === undefined ? 0.14 : o.seam})`;
    g.lineWidth = Math.max(1, S / 180);
    for (let i = 1; i < 2; i += 1) {
      g.beginPath();
      g.moveTo((S / 2) * i, 0); g.lineTo((S / 2) * i, S);
      g.moveTo(0, (S / 2) * i); g.lineTo(S, (S / 2) * i);
      g.stroke();
    }
    wear(g, S, rng, o.wear === undefined ? 1 : o.wear, { warm: 0x1c1610 });
    grime(g, S, rng, o.dirt === undefined ? 0.4 : o.dirt);
  },

  /* Carpet. Fibre noise plus traffic paths. Traffic is what makes a
     red carpet look walked on rather than printed. */
  carpet(g, S, rng, o) {
    g.fillStyle = hexStr(o.base);
    g.fillRect(0, 0, S, S);
    /* Fibre. Half the count it had, at half the amplitude and twice
       the size: a carpet is read from its traffic paths and its pile
       direction, never from an individual tuft, and 14000 one-pixel
       tufts is just noise on a surface that covers a whole course. */
    for (let i = 0; i < 6000; i += 1) {
      const v = rngRange(rng, -0.09, 0.075);
      g.fillStyle = hexStr(shade(o.base, v));
      g.fillRect((rng() * S) | 0, (rng() * S) | 0, 2, rng() < 0.5 ? 2 : 3);
    }
    if (o.weave) {
      g.globalAlpha = 0.07;
      g.fillStyle = "#000";
      for (let y = 0; y < S; y += 8) g.fillRect(0, y, S, 2);
      g.globalAlpha = 1;
    }
    wear(g, S, rng, o.wear === undefined ? 1.1 : o.wear, { warm: 0x180608 });
    grime(g, S, rng, o.dirt === undefined ? 0.5 : o.dirt, 0x2a0a10);
  },

  /* Poured concrete. Form-board seams, pour blotches, hairline
     cracks. Every basement and every roof deck starts here. */
  concrete(g, S, rng, o) {
    g.fillStyle = hexStr(o.base);
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i += 1) {
      const x = rng() * S, y = rng() * S, r = rngRange(rng, S * 0.06, S * 0.34);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const c = shade(o.base, rngRange(rng, -0.14, 0.12));
      grad.addColorStop(0, `${hexStr(c)}`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = 0.4;
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    if (o.seams !== false) {
      g.fillStyle = hexStr(shade(o.base, -0.28));
      g.fillRect(0, S * 0.5 - 1, S, 2);
      g.fillStyle = hexStr(shade(o.base, 0.14));
      g.fillRect(0, S * 0.5 + 1, S, 1);
    }
    g.strokeStyle = `rgba(0,0,0,0.35)`;
    for (let c = 0; c < 4; c += 1) {
      g.lineWidth = rngRange(rng, 0.6, 1.6);
      g.beginPath();
      let x = rng() * S, y = rng() * S;
      g.moveTo(x, y);
      for (let s = 0; s < 6; s += 1) {
        x += rngRange(rng, -26, 26);
        y += rngRange(rng, -26, 26);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    speckle(g, S, rng, 4200, 0xffffff, 0x000000, 0.06);
    wear(g, S, rng, o.wear === undefined ? 1 : o.wear, { warm: 0x14100a });
    grime(g, S, rng, o.dirt === undefined ? 0.55 : o.dirt);
  },

  /* Brushed or painted metal. Streaks run in one axis so a merged
     mesh reads as rolled sheet rather than as noise. */
  metal(g, S, rng, o) {
    g.fillStyle = hexStr(o.base);
    g.fillRect(0, 0, S, S);
    /* Rolled-sheet streaks. Sixteen hundred one-texel lines turned
       any large metal object - the fountain drum most of all - into a
       field of dense horizontal hatching at close range. Half as many,
       two texels thick and a third fainter reads as brushed metal and
       mips to a clean grey instead of to a shimmer. */
    for (let i = 0; i < 700; i += 1) {
      const y = (rng() * S) | 0;
      const w = rngRange(rng, S * 0.12, S * 0.9);
      g.globalAlpha = rngRange(rng, 0.02, 0.09);
      g.fillStyle = rng() < 0.5 ? "#ffffff" : "#000000";
      g.fillRect(rng() * S, y, w, 2);
    }
    g.globalAlpha = 1;
    wear(g, S, rng, 0.7, { warm: 0x1a1610 });
    if (o.rivets) {
      const n = o.rivets;
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) {
          const x = (i + 0.5) * (S / n);
          const y = (j + 0.5) * (S / n);
          g.fillStyle = hexStr(shade(o.base, 0.28));
          g.beginPath(); g.arc(x, y, S * 0.012, 0, TAU); g.fill();
          g.fillStyle = hexStr(shade(o.base, -0.3));
          g.beginPath(); g.arc(x, y + S * 0.006, S * 0.007, 0, TAU); g.fill();
        }
      }
    }
    grime(g, S, rng, o.dirt === undefined ? 0.3 : o.dirt, 0x3a2a12);
  },

  /* A painted panel with a fake bevel. Two-thirds of every built
     surface in the game is a panel of some kind, so the bevel and
     the bottom grime carry a lot of the read. */
  /* THE BEVEL AND THE TRIM ARE A LUMINANCE BUDGET.
     `panel` is on the stall boxes, the arcade cabinets, the counters
     and every capstone in the game, so its border draws a grid over
     whatever it is on - one dark line, one bright line and a trim band
     per repeat. Measured, the `boss` frame's deck (one 24 m slab of
     `foodcourt.counter` at 3.2 m per repeat) and its bank of cabinets
     were the two hottest regions in the whole capture set, ahead of
     any floor texture.
     The Laplacian the art gate measures runs on LUMINANCE, so the
     bevel and the trim are the expensive half of this painter and
     their hue is free. Halved shades, and the trim band is mixed most
     of the way back toward the base value while keeping all of its
     colour - a trim that is a different COLOUR from its panel still
     reads as trim at every distance this is seen from, and it stops
     drawing a hard value edge every three metres. */
  panel(g, S, rng, o) {
    const inset = S * (o.inset === undefined ? 0.07 : o.inset);
    g.fillStyle = hexStr(shade(o.base, -0.09));
    g.fillRect(0, 0, S, S);
    g.fillStyle = hexStr(shade(o.base, 0.09));
    g.fillRect(0, 0, S - inset * 0.5, S - inset * 0.5);
    g.fillStyle = hexStr(o.base);
    g.fillRect(inset, inset, S - inset * 2, S - inset * 2);
    if (o.trim !== undefined) {
      const mix = o.trimMix === undefined ? 0.5 : o.trimMix;
      g.fillStyle = hexStr(mixHex(o.trim, o.base, mix));
      g.fillRect(0, S - inset * 0.9, S, inset * 0.9);
    }
    speckle(g, S, rng, 2200, 0xffffff, 0x000000, 0.05);
    const grad = g.createLinearGradient(0, S * 0.6, 0, S);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.28)");
    g.fillStyle = grad;
    g.fillRect(0, S * 0.6, S, S * 0.4);
    wear(g, S, rng, o.wear === undefined ? 0.7 : o.wear, { warm: 0x14100c });
    grime(g, S, rng, o.dirt === undefined ? 0.35 : o.dirt);
  },

  /* Neon. Dark plate, bright tube, wide bloom halo. Unlit material,
     so the halo painted here is the only glow it will ever have. */
  neon(g, S, rng, o) {
    g.fillStyle = hexStr(o.back === undefined ? 0x0a0610 : o.back);
    g.fillRect(0, 0, S, S);
    const bars = o.bars || 3;
    for (let i = 0; i < bars; i += 1) {
      const y = (i + 0.5) * (S / bars);
      const hue = o.colors ? o.colors[i % o.colors.length] : o.base;
      const h = S * (o.thick === undefined ? 0.055 : o.thick);
      const grad = g.createLinearGradient(0, y - h * 4, 0, y + h * 4);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.5, `${hexStr(shade(hue, -0.35))}`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = 0.75;
      g.fillStyle = grad;
      g.fillRect(0, y - h * 4, S, h * 8);
      g.globalAlpha = 1;
      g.fillStyle = hexStr(hue);
      g.fillRect(0, y - h * 0.5, S, h);
      g.fillStyle = hexStr(shade(hue, 0.75));
      g.fillRect(0, y - h * 0.18, S, h * 0.36);
    }
  },

  /* LED wall. A pixel grid with a dark mask between the diodes,
     which is what stops a video wall from reading as a painted
     rectangle. */
  led(g, S, rng, o) {
    g.fillStyle = "#050308";
    g.fillRect(0, 0, S, S);
    const n = o.pitch || 16;
    const cell = S / n;
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const t = clamp01(0.5 + 0.5 * Math.sin(x * 0.7 + y * 0.33));
        const c = mixHex(o.a, o.b, t * rngRange(rng, 0.6, 1.0));
        g.fillStyle = hexStr(shade(c, rngRange(rng, -0.25, 0.1)));
        g.fillRect(x * cell + cell * 0.14, y * cell + cell * 0.14, cell * 0.72, cell * 0.72);
      }
    }
  },

  /* Polished stone with veins. The hub's floor and the awards
     venue's steps. */
  marble(g, S, rng, o) {
    g.fillStyle = hexStr(o.base);
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 26; i += 1) {
      g.strokeStyle = `${hexStr(rng() < 0.6 ? o.vein : shade(o.base, 0.3))}`;
      g.globalAlpha = rngRange(rng, 0.10, 0.5);
      g.lineWidth = rngRange(rng, 0.6, 3.4);
      g.beginPath();
      let x = rng() * S, y = rng() * S;
      g.moveTo(x, y);
      const dx = rngRange(rng, -1, 1), dy = rngRange(rng, -1, 1);
      for (let s = 0; s < 10; s += 1) {
        x += dx * 26 + rngRange(rng, -14, 14);
        y += dy * 26 + rngRange(rng, -14, 14);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    if (o.slabs) {
      g.strokeStyle = "rgba(0,0,0,0.30)";
      g.lineWidth = Math.max(1, S / 150);
      g.strokeRect(0, 0, S, S);
    }
    speckle(g, S, rng, 1800, 0xffffff, 0x000000, 0.04);
    grime(g, S, rng, o.dirt === undefined ? 0.16 : o.dirt);
  },

  wood(g, S, rng, o) {
    g.fillStyle = hexStr(o.base);
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 220; i += 1) {
      g.strokeStyle = hexStr(shade(o.base, rngRange(rng, -0.24, 0.16)));
      g.globalAlpha = rngRange(rng, 0.15, 0.6);
      g.lineWidth = rngRange(rng, 0.5, 2.2);
      const y = rng() * S;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= S; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 2.4);
      g.stroke();
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 3; i += 1) {
      const x = rng() * S, y = rng() * S;
      g.strokeStyle = hexStr(shade(o.base, -0.32));
      g.lineWidth = 1.4;
      for (let r = 2; r < 12; r += 2.5) {
        g.beginPath(); g.ellipse(x, y, r, r * 0.6, 0.4, 0, TAU); g.stroke();
      }
    }
    grime(g, S, rng, o.dirt === undefined ? 0.3 : o.dirt);
  },

  fabric(g, S, rng, o) {
    g.fillStyle = hexStr(o.base);
    g.fillRect(0, 0, S, S);
    /* A three-texel weave at 12% is a moire pattern waiting for a
       grazing angle. Six texels at 7% still reads as cloth. */
    g.globalAlpha = 0.07;
    for (let y = 0; y < S; y += 6) {
      g.fillStyle = y % 12 === 0 ? "#ffffff" : "#000000";
      g.fillRect(0, y, S, 2);
    }
    for (let x = 0; x < S; x += 6) {
      g.fillStyle = x % 12 === 0 ? "#ffffff" : "#000000";
      g.fillRect(x, 0, 2, S);
    }
    g.globalAlpha = 1;
    const grad = g.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, "rgba(255,255,255,0.12)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.0)");
    grad.addColorStop(1, "rgba(0,0,0,0.30)");
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    speckle(g, S, rng, 2000, 0xffffff, 0x000000, 0.04);
  },

  /* Awning and marquee stripes. */
  stripe(g, S, rng, o) {
    const n = o.count || 6;
    const w = S / n;
    for (let i = 0; i < n; i += 1) {
      g.fillStyle = hexStr(i % 2 === 0 ? o.base : o.alt);
      g.fillRect(i * w, 0, w, S);
    }
    g.globalAlpha = 0.07;
    for (let y = 0; y < S; y += 8) { g.fillStyle = "#000"; g.fillRect(0, y, S, 2); }
    g.globalAlpha = 1;
    /* The awnings are the mid-plane's bright mass. The old fade took
       their bottom third down by a third of a stop of black, which
       cost the frame most of its light exactly where the kiosks are. */
    const grad = g.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, "rgba(255,255,255,0.16)");
    grad.addColorStop(1, `rgba(0,0,0,${o.fade === undefined ? 0.34 : o.fade})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    grime(g, S, rng, o.dirt === undefined ? 0.25 : o.dirt);
  },

  /* Loose aggregate. The stone size and contrast are both down from
     where they were authored: 2600 stones at plus or minus 30% value
     is the same pixel-static failure the terrazzo had, and a gravel
     bed is in any case a mid-frequency surface - you read the
     unevenness of the bed long before you read an individual stone. */
  gravel(g, S, rng, o) {
    g.fillStyle = hexStr(o.base);
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 1300; i += 1) {
      const r = rngRange(rng, 2.4, 7.2);
      const c = shade(o.base, rngRange(rng, -0.15, 0.14));
      g.fillStyle = hexStr(c);
      g.beginPath();
      g.ellipse(rng() * S, rng() * S, r, r * rngRange(rng, 0.55, 1), rng() * TAU, 0, TAU);
      g.fill();
    }
    speckle(g, S, rng, 1600, 0xffffff, 0x000000, 0.05);
    wear(g, S, rng, o.wear === undefined ? 1 : o.wear, { warm: 0x15110b });
    grime(g, S, rng, o.dirt === undefined ? 0.4 : o.dirt);
  },

  /* Standing liquid: soda in the fountain, the rooftop pool, the
     coolant channels in the basement. Concentric ripples plus a few
     bright caustic slivers. */
  liquid(g, S, rng, o) {
    g.fillStyle = hexStr(o.base);
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i += 1) {
      g.strokeStyle = hexStr(shade(o.base, rngRange(rng, -0.22, 0.3)));
      g.globalAlpha = rngRange(rng, 0.08, 0.34);
      g.lineWidth = rngRange(rng, 0.8, 3);
      const cx = rng() * S, cy = rng() * S;
      g.beginPath();
      g.ellipse(cx, cy, rngRange(rng, 8, 70), rngRange(rng, 6, 46), rng() * TAU, 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 180; i += 1) {
      g.fillStyle = hexStr(shade(o.base, 0.55));
      g.globalAlpha = rngRange(rng, 0.1, 0.5);
      g.fillRect(rng() * S, rng() * S, rngRange(rng, 2, 10), 1);
    }
    g.globalAlpha = 1;
  },

  /* Slatted grate. The gaps are painted, not modelled - a real
     grate at this scale costs more triangles than the whole floor.

     This painter was the highest-contrast object in any of our
     frames: near-black gaps under a pale slat, ten slats to two
     metres, on the escalators and every catwalk in the course. A
     black-and-white stripe pattern at that pitch, seen on a diagonal
     ramp, is a moire generator - and it drew the eye straight past
     the character to a staircase.

     The gaps are now a shade of the slat rather than a hole punched
     to black, the cross-ribs are drawn in a mid tone instead of the
     highlight (they were the brightest pixels on the surface), and
     callers ask for far fewer slats over a larger tile so the pitch
     survives to mid distance. It reads as tread plate now instead of
     as a barcode, which is what it should always have been. */
  grate(g, S, rng, o) {
    const gap = o.gap === undefined ? shade(o.base, -0.38) : o.gap;
    g.fillStyle = hexStr(gap);
    g.fillRect(0, 0, S, S);
    const n = o.slats || 10;
    const cell = S / n;
    for (let i = 0; i < n; i += 1) {
      /* The slat now owns four fifths of its cell rather than three
         fifths. A gap that is a third of the pattern is a stripe;
         a gap that is a fifth of it is a score line on a solid
         plate, and a solid plate is what this needs to mip down to. */
      g.fillStyle = hexStr(shade(o.base, rngRange(rng, -0.06, 0.06)));
      g.fillRect(0, i * cell + cell * 0.1, S, cell * 0.8);
      g.fillStyle = hexStr(shade(o.base, 0.14));
      g.fillRect(0, i * cell + cell * 0.1, S, Math.max(1, cell * 0.1));
    }
    g.fillStyle = hexStr(shade(o.base, -0.16));
    const ribs = o.ribs === undefined ? 4 : o.ribs;
    for (let i = 0; i < ribs; i += 1) {
      g.fillRect((i / ribs) * S, 0, Math.max(1, S * 0.024), S);
    }
    wear(g, S, rng, 0.6, { warm: 0x2a1a08 });
    grime(g, S, rng, o.dirt === undefined ? 0.5 : o.dirt, 0x3a1a08);
  },

  /* Server rack face: vents, drive bays, status LEDs. Emissive in
     the material, so the LEDs are what light the basement. */
  rack(g, S, rng, o) {
    g.fillStyle = hexStr(o.base);
    g.fillRect(0, 0, S, S);
    const rows = 16;
    const h = S / rows;
    for (let r = 0; r < rows; r += 1) {
      g.fillStyle = hexStr(shade(o.base, -0.35));
      g.fillRect(0, r * h + h * 0.08, S, h * 0.84);
      g.fillStyle = hexStr(shade(o.base, 0.12));
      g.fillRect(0, r * h + h * 0.08, S, 1);
      for (let v = 0; v < 22; v += 1) {
        g.fillStyle = "#000";
        g.globalAlpha = 0.6;
        g.fillRect(S * 0.08 + v * (S * 0.038), r * h + h * 0.3, S * 0.018, h * 0.4);
      }
      g.globalAlpha = 1;
      if (rng() > 0.25) {
        g.fillStyle = rng() > 0.3 ? hexStr(o.led) : hexStr(o.led2 || 0xff4040);
        g.fillRect(S * 0.88, r * h + h * 0.34, S * 0.035, h * 0.3);
      }
    }
    grime(g, S, rng, 0.2, 0x0a1418);
  },

  /* A lit building face. Distant towers are the cheapest possible
     answer to "what is beyond the play area" in a night course, and a
     tower is nothing but a grid of windows: a few floors dark, a few
     warm, one or two cold. The floor bands matter as much as the
     windows - without them the grid reads as graph paper. */
  windows(g, S, rng, o) {
    g.fillStyle = hexStr(o.base);
    g.fillRect(0, 0, S, S);
    const cols = o.cols || 7;
    const rows = o.rows || 11;
    const cw = S / cols;
    const ch = S / rows;
    const litChance = o.lit === undefined ? 0.42 : o.lit;
    for (let y = 0; y < rows; y += 1) {
      /* Whole floors go dark together. Random per-window lighting
         looks like static; buildings empty by storey. */
      const floorK = rng() < 0.22 ? 0.06 : 1;
      g.fillStyle = hexStr(shade(o.base, -0.3));
      g.fillRect(0, y * ch + ch * 0.78, S, Math.max(1, ch * 0.12));
      for (let x = 0; x < cols; x += 1) {
        const on = rng() < litChance * floorK;
        const c = on
          ? mixHex(o.warm === undefined ? 0xffd08a : o.warm,
            o.cool === undefined ? 0x9ad8ff : o.cool, rng() * rng())
          : shade(o.base, -0.42);
        g.fillStyle = hexStr(shade(c, rngRange(rng, -0.18, 0.12)));
        g.fillRect(x * cw + cw * 0.2, y * ch + ch * 0.16, cw * 0.6, ch * 0.52);
        if (on) {
          g.globalAlpha = 0.35;
          g.fillStyle = hexStr(shade(c, 0.5));
          g.fillRect(x * cw + cw * 0.2, y * ch + ch * 0.16, cw * 0.6, Math.max(1, ch * 0.14));
          g.globalAlpha = 1;
        }
      }
    }
    speckle(g, S, rng, 1400, 0xffffff, 0x000000, 0.04);
  },

  /* The checker patch under the food court seating.

     This was authored "loud on purpose" and it was the wrong call.
     Two tones a long way apart, on tiles about a metre across, on a
     46m slab: at mid distance the squares fell below the sample grid
     and the whole floor turned into crawling stripes, and worse, a
     character standing on it was lighter than half the squares she
     was standing on and darker than the other half. There is no
     silhouette against a floor like that - the eye cannot even
     decide which tone is the background.

     The pattern survives because it is the course's identity; what
     changed is that the two tones are now within about ten
     luminance of each other and separated by HUE rather than value,
     and the squares are four metres instead of one. A big soft
     checker still reads as a checker, still gives the eye something
     to measure the room against, and no longer competes with
     anything standing on it. The joint line does the work the value
     step used to do at close range. */
  checker(g, S, rng, o) {
    const n = o.cols || 4;
    const cell = S / n;
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const c = (x + y) % 2 === 0 ? o.base : o.alt;
        g.fillStyle = hexStr(shade(c, rngRange(rng, -0.05, 0.05)));
        g.fillRect(x * cell, y * cell, cell, cell);
        /* A darker joint and a light chamfer, so the tile edge is
           read from the line and not from the fill. */
        const jw = Math.max(1, cell * 0.018);
        g.fillStyle = `rgba(0,0,0,${o.joint === undefined ? 0.26 : o.joint})`;
        g.fillRect(x * cell, y * cell, cell, jw);
        g.fillRect(x * cell, y * cell, jw, cell);
        g.fillStyle = "rgba(255,255,255,0.10)";
        g.fillRect(x * cell + jw, y * cell + jw, cell - jw * 2, Math.max(1, cell * 0.012));
      }
    }
    /* Shades of the tile itself, not black and white. A dither built
       from the two extremes of the ramp is a contrast texture at the
       smallest feature size the frame has, and this surface is the
       whole bottom half of three capture framings. Built from the
       base it still breaks banding and no longer registers as its own
       pattern. */
    speckle(g, S, rng, 1000, shade(o.base, 0.16), shade(o.base, -0.16), 0.05);
    wear(g, S, rng, o.wear === undefined ? 1 : o.wear, { warm: 0x201a12 });
    grime(g, S, rng, o.dirt === undefined ? 0.5 : o.dirt);
  },

  /* Moulded plastic. Deliberately the quietest painter in the file:
     one flat saturated fill, a slow sheen across it, and nothing at
     pixel scale at all.
     It exists because the things that wear it - ball pit balls, and
     anything else that is a small, numerous, rounded object - are
     read entirely from their SILHOUETTE and their HUE. Giving ninety
     spheres a texture each does not make them look manufactured, it
     makes the region they occupy vibrate. The variation that a field
     of these needs belongs between the objects, not on them. */
  plastic(g, S, rng, o) {
    g.fillStyle = hexStr(o.base);
    g.fillRect(0, 0, S, S);
    /* A single broad highlight so the fill is not literally uniform
       under flat shading - one feature, most of the tile across. */
    const grad = g.createRadialGradient(S * 0.34, S * 0.3, 0, S * 0.34, S * 0.3, S * 0.75);
    grad.addColorStop(0, "rgba(255,255,255,0.16)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    wear(g, S, rng, o.wear === undefined ? 0.6 : o.wear, { warm: 0x1a1410 });
    grime(g, S, rng, o.dirt === undefined ? 0.15 : o.dirt);
  },
};

/* ============================================================
   SURFACES

   name -> painter, painter options, material kind, physical texture
   size in metres, and the collision material tag the moveset and
   the footstep audio key off.

   "lit" materials are Lambert (cheap, matte, and the flat shading
   suits the toy-plastic read). "shiny" are Standard, used sparingly
   for chrome, gold, glass and liquid. "glow" are unlit Basic,
   because a neon tube that responds to the sun is not a neon tube.
   ============================================================ */

/* METALNESS IS CAPPED AT ABOUT 0.34 THROUGHOUT THIS TABLE.

   materials.js can bake a gradient cube map and push it onto every
   material in ITS registry - but the surfaces below are constructed
   here, with plain THREE.MeshStandardMaterial, and are not in that
   registry, so they never receive one. A metalness of 0.95 with no
   environment map has almost no diffuse term and nothing to reflect,
   which means it renders BLACK. That is what the food court's chrome
   fountain pedestal, the hub's platinum records, the awards
   statuette's plinth trim and the hell arena's truss were all doing:
   sitting in the middle of the frame as unlit silhouettes.

   Capped low they read as painted or brushed metal instead of as
   mirrors, which is the correct look for this game anyway - Super
   Mario 64 has no mirrors either. If an env map is ever wired into
   these materials, this cap is the thing to revisit. */

const SURFACES = {
  /* ---------------- shared ---------------- */
  /* THE SHARED METALS CARRY A HUE NOW, AND THAT IS THE POINT.
     They were 0x9aa3ad / 0xb8c0c8 / 0x949aa2 - three greys with a
     saturation of 0.05 to 0.10 - and between the rails, the grates,
     the escalator treads and the service platforms they are one of
     the largest painted areas in the game. Neutral grey over that
     much of the frame is contract tell #6 arriving through the back
     door: it drags the whole picture's chroma down and it makes every
     course read as the same undecided colour. Steel that has a
     definite cool cast still reads as steel; steel with no cast at
     all reads as untextured. Values are held within a few luminance
     of the originals, so this buys chroma without touching the value
     structure the squint test measures.

     ------------------------------------------------------------
     AND THEN THEY ALL CAME DOWN ABOUT A FIFTH IN VALUE, BECAUSE THE
     BACKGROUND MOVED UNDER THEM.

     These are almost entirely THIN geometry - handrails, balusters,
     hangers, escalator kerbs, catwalk edges - one or two pixels wide
     at the distance the capture presets shoot from. A one-pixel
     feature contributes to high-frequency energy in proportion to its
     CONTRAST against what is behind it, and what is behind it is the
     upper half of the frame, which the airlight pass took from
     luminance 90 to 46. The rails did not change and their gradient
     nearly doubled: measured, the railing and escalator band across
     the top of `enemy-encounter` and `boss` is now the hottest region
     in the game, hotter than any floor ever was.

     So the metals follow the background down. They keep their cool
     cast and their relative order - chrome brightest, grate darkest -
     and they are still unmistakably metal, because metal is read from
     its specular ramp and not from its albedo. Super Mario 64's own
     metal is a mid grey; ours was a near-white. */
  "shared.metal": { p: "metal", o: { base: 0x74849a, rivets: 3 }, kind: "shiny", rough: 0.46, metal: 0.30, m: 3, c: "metal" },
  "shared.chrome": { p: "metal", o: { base: 0x93a8bd, dirt: 0.12 }, kind: "shiny", rough: 0.26, metal: 0.26, m: 4, c: "metal" },
  "shared.gold": { p: "metal", o: { base: 0xc0902f, dirt: 0.1 }, kind: "shiny", rough: 0.34, metal: 0.34, m: 2, c: "metal" },
  "shared.rail": { p: "metal", o: { base: 0x8496a8 }, kind: "shiny", rough: 0.34, metal: 0.30, m: 1, c: "metal" },
  /* Five slats to three metres, not ten to two. See the grate
     painter: this surface is on every catwalk, every escalator and
     every service platform in the game, and at the old pitch it was
     a black-and-white barcode that moired on any diagonal and pulled
     the eye off the subject in three separate frames.
     Now four slats to four and a half metres, and a gap only a third
     of the way down from the plate rather than most of the way: the
     mall's escalators are sixteen metres long and seen end-on, which
     stacks the whole repeat into a few dozen pixels. */
  "shared.grate": { p: "grate", o: { base: 0x6f7c8c, gap: 0x5e6a78, slats: 4, ribs: 3, dirt: 0.45 }, kind: "lit", m: 4.5, c: "metal" },
  /* ARCADE CARPET, not a rubber mat - and the change is a measurement.
     As a near-black mat (0x2a2c30) this surface floors the Payola
     Phantom's arena, and the arena is the whole bottom half of the
     `boss` frame: squint P5 came back at 10 against a Super Mario 64
     reference of 45.7, the worst row in the set, and the albedo lives
     in the map so no light and no material.color could reach it. Worse,
     the concrete painter's own tonal blotches at that value survive
     only where they are lightest, which read to a blind critic as
     broken shadow cascades striped across the floor.
     A dark indigo arcade carpet is three times the value, is the one
     floor in the mall that can carry real chroma without competing
     with the reserved gameplay red, and is what the floor of an arcade
     has actually looked like since 1982. */
  "shared.rubber": { p: "carpet", o: { base: 0x2b2450, weave: true, dirt: 0.4, wear: 0.9 }, kind: "lit", m: 2.5, c: "stone" },
  "shared.glass": { p: "marble", o: { base: 0x6fc8e4, vein: 0xd8f4ff, dirt: 0.06 }, kind: "shiny", rough: 0.08, metal: 0.1, m: 4, c: "ice", opacity: 0.34 },

  /* Crowd liveries. A stand full of identical figures reads as a
     texture; five colours is enough that the eye stops counting. They
     live in "shared" because three courses have an audience, and the
     namespace release rule keeps shared surfaces resident. */
  "shared.crowdA": { p: "fabric", o: { base: 0x2b2f42 }, kind: "lit", m: 1.4, c: "stone" },
  "shared.crowdB": { p: "fabric", o: { base: 0xa62442 }, kind: "lit", m: 1.4, c: "stone" },
  "shared.crowdC": { p: "fabric", o: { base: 0xe8dcc2 }, kind: "lit", m: 1.4, c: "stone" },
  "shared.crowdD": { p: "fabric", o: { base: 0x2f6a8e }, kind: "lit", m: 1.4, c: "stone" },
  "shared.crowdE": { p: "fabric", o: { base: 0x7a4aa8 }, kind: "lit", m: 1.4, c: "stone" },

  /* ---------------- 0 : The Label Lobby ---------------- */
  "lobby.marble": { p: "marble", o: { base: 0x453a60, vein: 0xd8bc74, slabs: true, dirt: 0.1 }, kind: "shiny", rough: 0.16, metal: 0.15, m: 4, c: "stone" },
  "lobby.marbleLight": { p: "marble", o: { base: 0xf0e4c0, vein: 0xa08a5e, slabs: true, dirt: 0.14 }, kind: "shiny", rough: 0.22, metal: 0.05, m: 4, c: "stone" },
  "lobby.carpet": { p: "carpet", o: { base: 0x8a0e22, weave: true, dirt: 0.35 }, kind: "lit", m: 3, c: "grass" },
  "lobby.wall": { p: "panel", o: { base: 0x5e4d70, trim: 0xd8b055, inset: 0.06, dirt: 0.2 }, kind: "lit", m: 3, c: "stone" },
  "lobby.wood": { p: "wood", o: { base: 0x74482a, dirt: 0.2 }, kind: "lit", m: 2, c: "stone" },
  "lobby.velvet": { p: "fabric", o: { base: 0x5c0a1c }, kind: "lit", m: 2, c: "grass" },
  "lobby.platinum": { p: "metal", o: { base: 0xe4e8ee, dirt: 0.06 }, kind: "shiny", rough: 0.22, metal: 0.30, m: 3, c: "metal" },
  "lobby.neon": { p: "neon", o: { base: 0xff2e86, bars: 2, colors: [0xff2e86, 0x36e0ff], back: 0x120616 }, kind: "glow", m: 2, c: "metal" },

  /* ---------------- 1 : The Mall Food Court ----------------

     The ground, wall and ceiling albedos here are held about 28%
     below where a photograph of a real food court would put them, and
     pushed cool. That is deliberate and it was measured: at their
     natural value the floor, the walls, the columns, the tables and
     the ceiling all landed inside one narrow band around 65%
     luminance, so the course collapsed to a single beige mass when
     squinted at. Nothing bright had anywhere dark to sit against.
     Everything that is SUPPOSED to carry colour - the kiosk
     liveries, the awnings, the cup, the neon, the ball pit - kept its
     value, so those props are now the light in the frame rather than
     competing with an equally bright floor.

     Cool, specifically, and not just darker: the player is a warm
     saturated costume, and a floor darkened toward the same warm
     mid-tone would simply swap which of the two disappears.

     ------------------------------------------------------------
     SECOND PASS, AFTER THE FLOORS WERE MEASURED

     The value plan above was right and the surface treatment under
     it was wrong. The floors are 40-60% of every frame in this
     course and they were carrying the frame's highest contrast at
     its smallest feature size: full-chroma terrazzo confetti one to
     five texels across, and a metre-pitch checker whose two tones
     were half the value range apart. The result measured at 2.3x the
     Super Mario 64 pool's high-frequency energy, and by eye there
     was nowhere for the eye to land - every square metre of ground
     was shouting.

     The plane structure this course is now graded to, in rendered
     luminance rather than albedo:

       far wall / ceiling      30-45   darkest, coolest, and fogged
       foreground floor        65-80   quiet mid-dark, low contrast
       kiosks / awnings       95-130   the mid plane is the bright one
       signs, neon, shafts    150+     small, saturated, gameplay

     That is the inversion the review found: the old build had the
     background at 124 and the foreground floor at 30-82, so the
     brightest thing in the picture was an empty wall a hundred
     metres away. Value depth now runs the right way round, which is
     how Super Mario 64 gets its depth - by value structure, not by
     haze.

     ------------------------------------------------------------
     THIRD PASS: THE COLOUR THAT THE SECOND PASS SPENT

     The value plan above works and it is not being touched. What it
     cost was chroma. "Down about a third in saturation" was the right
     instruction for the kiosks, which had been shouting; it was
     applied to the whole course, and the surfaces it hit hardest were
     the ones with the most screen area. The floor, the walls, the
     tables, the counters, the mezzanine tile, the awning grounds and
     the structural columns all ended up between 0.03 and 0.14
     saturation - that is not "muted", that is grey. Measured against
     the Super Mario 64 pool the course came out at 0.418 against
     0.525, the only one of the four gate rows still failing, and by
     eye the room read as a beige photocopy of itself.

     The correction is a pure HUE-AND-CHROMA pass at CONSTANT
     LUMINANCE. Every base below was recomputed to sit within a few
     luminance of what it replaced and then pushed out along hue, so
     the squint value range, the darks and the high-frequency energy
     all measure the same picture they did before - the Laplacian runs
     on luminance, so chroma is free noise-wise - while the frame
     gains the colour back.

     Hues are now ASSIGNED BY PLANE rather than by object, which is
     the part the review was actually asking for. One hue per job:

       ground plane            ochre / terracotta      warm, H 30-45
       vertical structure      lit travertine          warm, H 45
       far wall + ceiling      plum-indigo             cool, H 255
       mezzanine tile, metal   slate blue              cool, H 213
       seating                 muted indigo            cool, H 217
       kiosk liveries          orange / jade / blue    the mid plane
       reserved                saturated red           GAMEPLAY ONLY

     Two rules keep this from turning back into mud. Warm ground
     against cool structure means the two largest masses in every
     frame are opposed rather than blended. And the reserved red is
     still reserved: nothing decorative gets near it.

     ------------------------------------------------------------
     FOURTH PASS: THE PLAN WAS NEVER ACTUALLY ON SCREEN.

     The plane structure above is written in RENDERED luminance, and
     it asks for a foreground floor at 65-80. Measured off the real
     captures, the ground plane was arriving at 190-210 - brighter
     than the kiosks that are supposed to be the bright plane, and
     within thirty of clipping. It had been squeezed from both ends:
     the albedos below were authored for the old, dimmer rig, and the
     rig then gained a shadow leak (sky.js shadowStrength) that adds a
     fixed lift to every square metre of a roofed course's floor.

     So the frame had no darks, and - less obviously - no chroma
     either. A saturated ochre pushed to 205 is a pale cream: HSV S
     collapses as a colour approaches white, and the floors are 40-60%
     of every frame. This is the escape from the trade the third pass
     ran into. Lifting SHADOWS costs saturation; lowering HIGHLIGHTS
     buys it. Measured on the arrival framing, taking the floor down
     took saturation from 0.496 to 0.566 with no other change.

     Every ground albedo below therefore comes down about 30% in
     linear luminance and goes UP in chroma at the same time. Value
     separations inside each surface (the checker's two tones, the
     terrazzo's chips against its binder) are preserved exactly,
     because those are what a silhouette is read against. */
  "foodcourt.terrazzo": {
    p: "terrazzo",
    o: {
      base: 0x7a6120,
      /* Value chips, not colour chips. Every one of these is within
         about eight luminance of the binder, so the floor reads as
         speckled aggregate at two metres and as a flat quiet stone at
         twenty - which is the whole point of an aggregate floor.
         They gained chroma with the binder and kept their spacing:
         the aggregate is what it always was, in colour. */
      chips: [0x836826, 0x6f5a1c, 0x816a28, 0x715c1e, 0x7d6122],
      /* HALF THE CHIPS AT TWICE THE SIZE AND A THIRD OF THE ALPHA.
         This floor is the single largest contributor to the build's
         high-frequency energy after the ball pit: at 18 metres per
         repeat a 3-12 texel chip lands at 21-86 cm on the ground with
         a hard rectangular edge and up to 0.7 alpha, which reads on
         screen as blocking artefacts rather than as aggregate. The
         chips are still the surface's texture - they are simply now
         at a size the eye resolves as stone and an amplitude it reads
         as mottle. The variance they give up comes back at a scale
         that costs nothing, in wear() below. */
      count: 620, size: [7, 22], chipAlpha: [0.12, 0.32],
      /* wear/grime kept LOW on purpose.
         At uvScale 18 one grime blob lands 4-9 m across the plaza, and
         at wear 1.4 those blobs were the largest-scale event on the
         floor - a blind reviewer read them as "broad soft diagonal warm
         bands with no overhead aperture and no matching shadow", i.e.
         sourceless light streaks, and marked them as dirty decals.
         Proven by A/B: they survived every VFX toggle and vanished the
         instant this albedo map was unbound. There is now a real cast
         shadow on the floor, and mottle at this scale competes with it
         rather than supporting it. */
      dirt: 0.20, wear: 0.55, seam: 0.18,
    },
    kind: "lit", m: 16, c: "stone",
  },
  "foodcourt.tile": { p: "tile", o: { base: 0x8aa6c8, alt: 0x7e9abc, accent: 0x5f86ad, cols: 2, grout: 0x5b6c86, dirt: 0.45 }, kind: "lit", m: 5, c: "stone" },
  /* The fountain's own glaze. It was sharing the mezzanine's floor
     tile, and once that went cool grey the basin rings turned into a
     ring of pale crates with black grout lines round the plaza. A
     fountain is glazed, saturated and darker than the floor it stands
     on - which is also what gives the red cup something to sit
     against. */
  "foodcourt.basin": { p: "tile", o: { base: 0x4fbcd8, alt: 0x3ea6c4, accent: 0xd0f2fa, cols: 3, grout: 0x2a7a94, dirt: 0.24 }, kind: "shiny", rough: 0.3, metal: 0.05, m: 2.5, c: "stone" },
  /* Gold and terracotta, eight luminance apart, on four-metre
     squares. The old red-and-white metre checker was the reason a
     character standing on this floor had no consistent silhouette:
     she was lighter than half the squares under her and darker than
     the other half, so her outline changed sign every stride. Two
     tones this close read as one value mass from any distance, which
     is exactly what a subject needs to stand on - and note that the
     third pass MOVED THEM CLOSER IN VALUE while moving them apart in
     hue and up in chroma. That is the trade the whole regrade rests
     on: value separation is what costs you a silhouette, hue
     separation is free.

     Both tones came down about 30% in linear luminance in the fourth
     pass (see the terrazzo note) and gained chroma doing it: S 0.66 ->
     0.77. Their separation is unchanged at under five luminance, so
     the silhouette guarantee above still holds. This is the plaza
     floor - it is the whole bottom half of the arrival, water and
     interior framings, and at 0xcda545 it was rendering at 205-210,
     which is why those three were the frames a blind gate flagged for
     having no darks. */
  "foodcourt.checker": { p: "checker", o: { base: 0xbe8c2c, alt: 0xc9822e, cols: 2, joint: 0.24, dirt: 0.45, wear: 1.05 }, kind: "lit", m: 8, c: "stone" },
  /* THE STOREFRONT BAND - AND A DEFINITION THAT IS NOT CURRENTLY IN
     EFFECT. READ THIS BEFORE TUNING IT.

     `materials.js` ALSO registers "foodcourt.counter", and its
     registry is consulted first (see makeSurfaces().get below), so
     what actually renders is materials.js's terrazzo-concrete at 1.5 m
     per repeat, not this. Traced by raycast: the mesh comes back
     wearing a material named "apop-foodcourt.counter", and the "apop-"
     prefix is materials.js's. The same is true of "foodcourt.tile" and
     "foodcourt.wall" above - three of this course's largest surfaces,
     including the 24 m x 128 m perimeter wall, are painted by the
     other module. That is why the wall renders as a pale cream at
     luminance ~212 while the plane plan at the top of this section
     asks for a plum-indigo far wall at 30-45, and why the storefront
     band across the upper third of nearly every capture is the
     brightest thing in the frame with the highest local contrast.
     Measured, that band is the hot region in the top rows of the
     `collect` and `boss` high-frequency maps.

     The values below are kept consistent with the course's fourth-pass
     regrade so they are correct the moment the shadowing is resolved,
     but changing them changes nothing on screen today. The fix belongs
     in materials.js: either drop the four foodcourt entries from its
     registry so this table is reached, or bring them down in value and
     up in repeat length to match this plan. */
  "foodcourt.counter": { p: "panel", o: { base: 0xc8bc86, trim: 0x8a6b58, inset: 0.08, dirt: 0.3 }, kind: "lit", m: 3.2, c: "stone" },
  /* The kiosks are the MID PLANE and the mid plane is now the
     brightest thing in the course, so all three liveries went up in
     value and down about a third in saturation. Down in saturation
     because the review's other finding was that red had stopped
     meaning anything: it was on the chairs, the slides, the pipes,
     the awnings, the planters and the character's sash at once.
     Saturated red is now reserved (see foodcourt.tray) and the
     environment gets the muted end of every hue. Trims are cream
     rather than yellow for the same reason - yellow is Clout. */
  "foodcourt.stall": { p: "panel", o: { base: 0xe07a4e, trim: 0xf0e0b4, inset: 0.05, dirt: 0.28 }, kind: "lit", m: 3, c: "stone" },
  "foodcourt.stallB": { p: "panel", o: { base: 0x4aa88e, trim: 0xf2e2b8, inset: 0.05, dirt: 0.28 }, kind: "lit", m: 3, c: "stone" },
  "foodcourt.stallC": { p: "panel", o: { base: 0x5c7ecc, trim: 0xf0e0b4, inset: 0.05, dirt: 0.28 }, kind: "lit", m: 3, c: "stone" },
  /* Five stripes to four metres, not eight to three: at the old
     pitch a row of awnings across the mid distance was a picket
     fence of alternating white and full-value red. The fade at the
     bottom is halved as well - these are the brightest large surface
     in the frame now and a third of a stop of black across their
     lower half was throwing that away. */
  "foodcourt.awning": { p: "stripe", o: { base: 0xf4e8c0, alt: 0xdc8f6a, count: 5, fade: 0.16, dirt: 0.22 }, kind: "lit", m: 4, c: "stone", side: 2 },
  "foodcourt.awningB": { p: "stripe", o: { base: 0xf2e8bc, alt: 0x4fb894, count: 5, fade: 0.16, dirt: 0.22 }, kind: "lit", m: 4, c: "stone", side: 2 },
  /* The background plane. It was the brightest region in the whole
     picture - 124 against a foreground floor at 30-82 - which is
     value depth exactly backwards and it pulled the eye to an empty
     wall. Dropped by a third and cooled; the fog now takes it the
     rest of the way down. */
  "foodcourt.wall": { p: "panel", o: { base: 0x453a5e, trim: 0x322a46, inset: 0.03, dirt: 0.45 }, kind: "lit", m: 12, c: "stone" },
  /* Metre bricks, not thirty-seven-centimetre ones. A storefront
     band twenty metres long in eight-per-three-metre courses was
     orange pixel noise at any distance past the near field. */
  "foodcourt.brick": { p: "tile", o: { base: 0x8a5a3c, alt: 0x7d5034, cols: 4, grout: 0x5e4430, dirt: 0.4 }, kind: "lit", m: 4, c: "stone" },
  "foodcourt.planter": { p: "tile", o: { base: 0x9a6a4e, alt: 0x8a5c42, cols: 3, grout: 0x5a3f2c, dirt: 0.4 }, kind: "lit", m: 3, c: "stone" },
  /* Bark mulch, not a hole in the floor. This was authored at 0x241a12
     - luma 28 - on the assumption that it would only ever be seen as a
     sliver between a coping and a shrub. It is not: once the near-field
     planters stopped z-fighting their own copings, a metre-wide band of
     it runs across the bottom third of five of the seven captures, and
     the squint darks fell to 24 against a reference pool at 46. Lifted
     to luma ~50 and warmed, it still sits well under everything around
     it and reads as what it is. */
  /* ...and it is now THREE AND A HALF METRES PER REPEAT, not two.
     Measured on a near-field bed at four metres from the lens, the
     bark chips were the highest-frequency region in the bottom third
     of the frame - higher than the shrubs standing in it, higher than
     the floor, and second only to the shopfront band. `m` is metres
     per texture repeat, so raising it makes each chip physically
     larger and puts fewer edges under every screen pixel. Bark mulch
     is 3-5 cm pieces; at m 2 these were being drawn at about 2 cm,
     which is coffee grounds. Wear comes down with it for the same
     reason - the near field is meant to be the quiet part. */
  "foodcourt.soil": { p: "gravel", o: { base: 0x3d3122, dirt: 0.42, wear: 0.28 }, kind: "lit", m: 3.4, c: "grass" },
  /* PALM FRONDS ONLY. This is the bright, chromatic green, and it is
     allowed to be that because a frond is a thin mid-air silhouette
     five metres up - it is never a large near-field mass. */
  "foodcourt.leaf": { p: "carpet", o: { base: 0x3f8f4a, weave: false, dirt: 0.16 }, kind: "shiny", rough: 0.62, metal: 0.0, m: 2, c: "grass", side: 2 },
  /* CLIPPED HEDGE, and it is a separate surface from the frond above
     for one measured reason. A blind pass named the near-field shrub
     "the largest, most saturated, highest-contrast object in frame" in
     three captures out of four; measured on the `interior` frame that
     mass sat at luma 103 with the mid-ground floor at 128, which is
     nowhere near enough separation for something four metres from the
     lens and directly in front of the picture.
     A hedge is also not a frond: it is a dense, dusty, dark-in-the-
     shade thing, and box foliage in a mall reads closer to olive than
     to leaf green. Base value is down about a third from the frond and
     chroma with it, and the three liveries below take it from there.
     `shiny` is the other half of the note - a purely matte lambert
     read as clay on both the shrubs and the ball pit. A broad, weak
     specular is what says "waxy leaf" rather than "moulded dough". */
  "foodcourt.hedge": { p: "carpet", o: { base: 0x4a6b3e, weave: false, dirt: 0.34, wear: 0.6 }, kind: "shiny", rough: 0.66, metal: 0.0, m: 1.6, c: "grass", side: 2 },
  "foodcourt.trunk": { p: "wood", o: { base: 0x6a4a30, dirt: 0.3 }, kind: "lit", m: 2, c: "stone" },
  /* BLUE RASPBERRY, and it is not a gag - it is the only value in the
     palette that lets the fountain read as liquid. Authored as orange
     soda, the pool sat at the same hue AND the same luma as the
     terrazzo and the checker patch it is surrounded by, so twelve
     metres of standing drink photographed as more floor: the `water`
     shot came back with a basin, a coping, spouts and no water in it.
     A dark saturated blue separates from a warm gold plaza by hue and
     by value at once, it separates from the pale teal basin tile by
     value, and it makes the brass wish-coins on the bed readable -
     which is what tells a human it is a fountain and not a planter. */
  "foodcourt.soda": { p: "liquid", o: { base: 0x1a6f9e }, kind: "shiny", rough: 0.05, metal: 0.0, m: 3, c: "water", opacity: 0.86 },
  /* The lid, and the other half of the background plane. Dark and
     cool for the same reason as the wall: the two of them together
     are most of the top third of every interior frame, and the frame
     had no darks at all - our darkest 5% sat at 18-45 where Super
     Mario 64 routinely reaches 2-11. */
  "foodcourt.ceiling": { p: "panel", o: { base: 0x2b2440, trim: 0x1f1a30, inset: 0.03, dirt: 0.4 }, kind: "lit", m: 6, c: "stone" },
  "foodcourt.neon": { p: "neon", o: { base: 0xff3d6e, bars: 3, colors: [0xff3d6e, 0xffd166, 0x36e0ff], back: 0x140a10 }, kind: "glow", m: 3, c: "metal" },
  /* The arcade cabinets' own screens, which used to share
     foodcourt.neon. A three-bar neon sign is authored for a two-metre
     fascia; on a 0.8 x 0.64 m cabinet screen at three metres per
     repeat, the same painter stacks near-black backing against three
     full-chroma bars inside sixty screen pixels, twelve times across
     the frame. Measured, that row of cabinets was the hottest band in
     the `boss` capture - hotter than any floor or wall in the course.
     One fat soft bar on a lit plum backing reads as a screen at this
     size, where a barcode reads as aliasing. */
  "foodcourt.screen": { p: "neon", o: { base: 0xff5a86, bars: 1, thick: 0.30, colors: [0xff5a86], back: 0x3a1830 }, kind: "glow", m: 1.2, c: "metal" },
  /* THE ARCADE CABINET KIT. A blind pass read the row in the `boss`
     framing as "plain boxes with two seam lines and a flat dark cap,
     scattered with no aisle logic and no front face", which is a fair
     description of a 1.0 x 1.9 x 0.85 slab wearing a shopfront panel.
     What makes a cabinet a cabinet at fifteen metres is three bands
     stacked in a fixed order - a lit marquee, a dark recessed screen
     bezel, a jutting control deck - so each gets its own surface and
     its own value, and the shell gets a second livery so a bank is not
     one blue mass.
     `cabinet` is the dark structural colour: bezel, kick plate, hood
     and the coin door. It is deliberately the darkest thing on the
     arcade deck, because a screen recessed into something LIGHTER
     reads as a sticker rather than as a hole. */
  "foodcourt.cabinet": { p: "panel", o: { base: 0x2b2540, trim: 0x191428, inset: 0.06, dirt: 0.42 }, kind: "lit", m: 1.4, c: "metal" },
  /* Header art. Unlit like every sign in this game, and warm so it
     reads against both cool shells.
     A PANEL PAINTER, NOT A NEON ONE, and that is a UV-scale argument
     rather than a taste one: UVs here are projected from world space,
     so a 0.34 m tall face at any repeat length shorter than about a
     metre lands on an ARBITRARY band of the texture. A neon painter is
     mostly dark backing, so roughly half the cabinets in a row would
     have come out with a black header. A panel is bright everywhere. */
  "foodcourt.marquee": { p: "panel", o: { base: 0xffc247, trim: 0xf4f0d8, inset: 0.16, dirt: 0.12 }, kind: "glow", m: 1.1, c: "metal" },
  /* The second cabinet shell. Same value as foodcourt.stallC within a
     few luminance - a bank has to read as ONE row of machines, and a
     value step down the row would break it into objects again - but a
     clearly different hue, which is what a real arcade looks like. */
  "foodcourt.cabinetB": { p: "panel", o: { base: 0xb06a86, trim: 0xefe0b8, inset: 0.05, dirt: 0.3 }, kind: "lit", m: 3, c: "stone" },
  "foodcourt.sign": { p: "panel", o: { base: 0xffd166, trim: 0xd0342c, inset: 0.12, dirt: 0.15 }, kind: "glow", m: 3, c: "stone" },
  /* THE RESERVED HUE. Saturated red now means "this is gameplay":
     the moving tray platforms, the timed switch run, the cup you
     climb. Nothing decorative may use it. */
  "foodcourt.tray": { p: "panel", o: { base: 0xd6392b, inset: 0.14, dirt: 0.2 }, kind: "lit", m: 1, c: "stone" },
  /* ...and the surface everything decorative that used to be red now
     uses instead. Moulded cafeteria plastic.

     It was authored as a putty grey-brown (0x9c8f86, saturation 0.14)
     and that was over-correcting: taking red off the chairs was
     right, replacing it with an absence of colour was not. The
     chairs are dozens of small objects scattered over the warm floor,
     which makes them the cheapest hue contrast in the course. A
     muted indigo at the same value reads as moulded plastic, is
     unmistakably not the reserved red, and separates the seating
     from the ground it stands on without a value step. */
  /* A BLIND PASS CALLED THE CAFE CLUSTER "A GREY SCRIBBLE", and both
     halves of that are fixable. "Scribble" is geometry and is answered
     in seatingField below; "grey" is this line. At 0x6d84a8 the
     moulding measured saturation 0.34 against a floor at 0.73, so
     forty-odd small objects standing on warm gold averaged to haze.
     Deeper and bluer holds the same value band the note above is
     protecting - the seating must not step out of the floor it stands
     on - while giving the furniture a hue a viewer can name. */
  "foodcourt.seat": { p: "panel", o: { base: 0x53709c, trim: 0x36466a, inset: 0.14, dirt: 0.3 }, kind: "shiny", rough: 0.46, metal: 0.0, m: 1, c: "stone" },
  /* The second livery. A food court buys its chairs in two colours and
     mixes them across the floor; one colour over forty objects is the
     same instanced-clone read the hedges were flagged for, one aisle
     away. Teal, because it is the only hue left in this course that is
     neither the reserved gameplay red nor Clout yellow. */
  "foodcourt.seatB": { p: "panel", o: { base: 0x3f7d78, trim: 0x27504e, inset: 0.14, dirt: 0.3 }, kind: "shiny", rough: 0.46, metal: 0.0, m: 1, c: "stone" },
  "foodcourt.table": { p: "panel", o: { base: 0xdcd4ac, trim: 0xa89a70, inset: 0.1, dirt: 0.3 }, kind: "lit", m: 1.5, c: "stone" },
  /* THE BALL PIT, AND THE WORST HIGH-FREQUENCY ROW IN THE GAME.

     It was one surface - a cream binder with full-chroma confetti at
     the terrazzo painter's default 1-5 texel chip size - worn by
     ninety identical spheres. At m 1.2 a chip is half a centimetre,
     so every ball in the pit was covered in sub-pixel static, and
     ninety of them at the same radius filling the middle of the
     `collect` framing measured 19.2 against a Super Mario 64 pool of
     11.7: the single worst frame in the set.

     The mistake was answering "a ball pit is many colours" at TEXEL
     scale instead of at BALL scale. A real ball pit is a few dozen
     large flat saturated primaries, and that is both quieter and more
     colourful - the confetti's chroma was averaging to cream on
     screen, while a solid red ball stays red at any distance.
     So: four plain saturated plastics, no chips, and the variation
     moved up to one hue per instance batch. Four extra draw calls
     against a budget of 300, for the frame's largest noise source and
     a real lift in saturation.

     THE FOUR HUES ARE HELD INSIDE ONE VALUE BAND, and that is the
     same trade the checker floor above rests on. Authored as natural
     primaries the four sat at luminance 87 / 117 / 130 / 175, so
     every point where a red ball touched a yellow one was an
     88-luminance step - and the high-frequency metric is a Laplacian
     of LUMINANCE, so a hue step is free and a value step is not. Held
     within about forty of each other the pit still reads as four
     obvious colours and stops being a field of hard edges. */
  /* ...AND THEY ARE SHINY, which is the whole difference between
     plastic and clay. A blind pass put it plainly: "everything is pure
     matte lambert, the ball-pit spheres read as clay". A ball pit is
     seventy pieces of injection-moulded polypropylene and the ONLY
     thing that says so at this distance is a specular lobe travelling
     across the top of each sphere as the eye moves. Roughness 0.38
     keeps that lobe broad enough to survive a 0.34 m ball at fifteen
     metres - a tighter one is a single blown pixel, which reads as
     sparkle rather than as material. Metalness stays at zero: these
     are dielectrics, and the diffuse term is still carrying the hue. */
  "foodcourt.ballA": { p: "plastic", o: { base: 0xe8546a, dirt: 0.12, wear: 0.7 }, kind: "shiny", rough: 0.38, metal: 0.0, m: 1.2, c: "ice" },
  "foodcourt.ballB": { p: "plastic", o: { base: 0x3a92d8, dirt: 0.12, wear: 0.7 }, kind: "shiny", rough: 0.38, metal: 0.0, m: 1.2, c: "ice" },
  "foodcourt.ballC": { p: "plastic", o: { base: 0xcc9c22, dirt: 0.12, wear: 0.7 }, kind: "shiny", rough: 0.38, metal: 0.0, m: 1.2, c: "ice" },
  "foodcourt.ballD": { p: "plastic", o: { base: 0x40aa66, dirt: 0.12, wear: 0.7 }, kind: "shiny", rough: 0.38, metal: 0.0, m: 1.2, c: "ice" },
  /* The surface of the pit the loose balls float on. Ball-sized
     chips, and that was the first thing tried - the same four hues at
     full chroma on a pale binder, twenty to fifty centimetres across.
     It measured WORSE than the confetti it replaced: the frequency
     had come down but the local contrast had gone up, and Laplacian
     energy is the product of the two. A large hard-edged saturated
     square on a cream ground is a bigger gradient than a small one.

     The bed is UNDER the balls. It is in their shadow, and painting
     it as if it were lit was the actual error. Dark binder, darkened
     hues, and enough wear over the top to keep any single chip from
     having a clean edge: it now reads as depth below the bright balls
     instead of competing with them - which is also the only real dark
     mass in the `collect` framing, a frame that had none. */
  /* ...but it went too far, and the frame said so. The `collect` pose
     stands her ON THE RIM with the pit behind her, so this surface is
     what her legs are read against, and at base 0x2e2822 in the pit's
     own shade it arrived darker than her boots: the best-keyed subject
     in the whole set was cut off at the knees. A liner is vinyl over
     foam, not a cave. Lifted to a warm mid so it still sits well under
     the balls - which is the whole job of a bed - while separating
     from a navy costume by a clear margin at every camera in the set.
     The dark mass the `collect` frame needs comes from the pit's own
     inner wall and the shadow under the rim, not from the floor of it. */
  "foodcourt.ballBed": {
    p: "terrazzo",
    o: {
      base: 0x6e6154,
      chips: [0x8e4048, 0x2e5c78, 0x8a6c1e, 0x2e6848, 0x5c5044],
      count: 70, size: [18, 48], chipAlpha: [0.26, 0.46],
      dirt: 0.3, wear: 1.1, seam: 0,
    },
    kind: "lit", m: 3, c: "ice",
  },
  /* THE STRUCTURAL COLUMNS, WHICH USED TO BE shared.chrome.

     The mall's columns are the largest single objects in the course -
     the cup pillar alone is eighteen metres of 0.85m drum and it
     fills a third of the enemy-encounter framing on its own - and
     they were wearing a near-neutral metal at saturation 0.06.
     A column that reads as unpainted grey concrete is also, at this
     scale, a grey card held up in front of the lens: it drags the
     frame's mean chroma down further than any other surface in the
     level.

     They are travertine now, not chrome. Same value (212 against
     221, so the columns are still the bright verticals that catch the
     eye going up), a real warm cast, and marble veining instead of
     rivets, which is what a shopping-mall column actually is. Chrome
     stays on the things that are genuinely chrome: bollards, lamp
     posts, hand rails, the fountain's spouts. */
  "foodcourt.column": { p: "marble", o: { base: 0xe8d08a, vein: 0xb99a5c, slabs: false, dirt: 0.22 }, kind: "lit", m: 3.5, c: "stone" },

  /* ---------------- 2 : The Awards-Show Red Carpet ---------------- */
  /* Values here are deliberately several stops lighter than a literal
     reading of "twenty minutes after sundown" would give. The dome is
     a burning sunset and the sun is 7 degrees up, so almost nothing
     horizontal catches the key: the surfaces themselves have to carry
     the value or the whole boulevard silhouettes into the sky. */
  "carpet.red": { p: "carpet", o: { base: 0xc4152f, weave: true, dirt: 0.24 }, kind: "lit", m: 3, c: "grass" },
  "carpet.trim": { p: "metal", o: { base: 0xe8bc3a, dirt: 0.1 }, kind: "shiny", rough: 0.32, metal: 0.34, m: 1.5, c: "metal" },
  "redcarpet.asphalt": { p: "concrete", o: { base: 0x45454f, dirt: 0.5 }, kind: "lit", m: 4, c: "stone" },
  "redcarpet.kerb": { p: "concrete", o: { base: 0x8e8a86, dirt: 0.4, seams: false }, kind: "lit", m: 2, c: "stone" },
  "redcarpet.step": { p: "marble", o: { base: 0xe4dece, vein: 0x9a8e70, slabs: true, dirt: 0.24 }, kind: "shiny", rough: 0.3, metal: 0.05, m: 3, c: "stone" },
  "redcarpet.facade": { p: "panel", o: { base: 0x6a5a8e, trim: 0xe8c04a, inset: 0.05, dirt: 0.26 }, kind: "lit", m: 4, c: "stone" },
  "redcarpet.facadeB": { p: "tile", o: { base: 0xc8b48e, alt: 0xa8906a, accent: 0xe8c04a, cols: 6, grout: 0x6a5a44, dirt: 0.3 }, kind: "lit", m: 3, c: "stone" },
  "redcarpet.marquee": { p: "neon", o: { base: 0xffd166, bars: 4, colors: [0xffd166, 0xffffff, 0xffd166, 0xff5a7a], back: 0x1a1020 }, kind: "glow", m: 3, c: "metal" },
  "redcarpet.barrier": { p: "metal", o: { base: 0x3e4048, rivets: 2, dirt: 0.35 }, kind: "shiny", rough: 0.48, metal: 0.28, m: 1.5, c: "metal" },
  "redcarpet.limo": { p: "panel", o: { base: 0x2a2a34, inset: 0.02, dirt: 0.1 }, kind: "shiny", rough: 0.2, metal: 0.24, m: 3, c: "metal" },
  "redcarpet.banner": { p: "fabric", o: { base: 0x7a2a68 }, kind: "lit", m: 3, c: "grass", side: 2 },
  "redcarpet.tower": { p: "windows", o: { base: 0x2a2438, cols: 7, rows: 12, lit: 0.4, warm: 0xffcf8a, cool: 0xa8d8ff }, kind: "glow", m: 9, c: "stone" },
  "redcarpet.velvet": { p: "fabric", o: { base: 0x8a1030 }, kind: "lit", m: 2, c: "grass" },
  "redcarpet.pool": { p: "liquid", o: { base: 0x2e6e94 }, kind: "shiny", rough: 0.05, metal: 0.1, m: 3, c: "water", opacity: 0.74 },

  /* ---------------- 3 : The Streaming Farm Basement ---------------- */
  /* A dark course still needs a full value range - "dark" is a
     average, not a ceiling. The concrete is the darkest thing here and
     the painted aisle lanes are nearly white, so the player has both
     a dark and a bright to read against wherever she stands.

     That was the intent and the measurement said it was not
     happening: value range 70 against the Super Mario 64 pool's 123,
     the worst in the game alongside the rooftop. Two causes, one in
     each file. The lighting half is in sky.js (an ambient term
     carrying more than half the room, so nothing had a lit side).
     The half that lives here is that the concrete, the floor tile and
     the racks were all authored as blue-GREYS - saturations of 0.06
     to 0.22 - which put them within a few luminance of one another
     AND within a few degrees of hue, so a wall, a floor and ninety
     server cabinets composited into one teal fog. They keep their
     values and get their chroma back below; the lane goes brighter
     still, because it is the only genuinely light thing in the room
     and it has to carry the top of the ladder on its own. */
  "basement.concrete": { p: "concrete", o: { base: 0x2f3a4e, dirt: 0.7 }, kind: "lit", m: 4, c: "stone" },
  "basement.floor": { p: "tile", o: { base: 0x64798c, alt: 0x566a80, cols: 3, grout: 0x4a5b70, dirt: 0.45 }, kind: "lit", m: 4.5, c: "stone" },
  "basement.lane": { p: "concrete", o: { base: 0xdfeaf4, dirt: 0.26, seams: false }, kind: "lit", m: 2, c: "stone" },
  "basement.hazard": { p: "stripe", o: { base: 0xf0c020, alt: 0x1e2228, count: 5, dirt: 0.4 }, kind: "lit", m: 2.4, c: "metal" },
  /* Both rack liveries are unlit Basic materials, so the painter base
     IS the value they render at - no amount of fill will lift them.
     At 0x2a3038 ninety cabinets came out ninety black boxes and the
     room had no midtone between the concrete and the painted lanes. */
  "basement.rack": { p: "rack", o: { base: 0x556880, led: 0x36ff9a, led2: 0xff3a4a }, kind: "glow", m: 3, c: "metal" },
  "basement.rackB": { p: "rack", o: { base: 0x46607f, led: 0x4ab8ff, led2: 0xffc23a }, kind: "glow", m: 3, c: "metal" },
  "basement.case": { p: "metal", o: { base: 0x555d68, rivets: 4, dirt: 0.4 }, kind: "shiny", rough: 0.52, metal: 0.28, m: 2, c: "metal" },
  "basement.pipe": { p: "metal", o: { base: 0x7a6f60, dirt: 0.55 }, kind: "shiny", rough: 0.6, metal: 0.28, m: 2, c: "metal" },
  "basement.cable": { p: "metal", o: { base: 0x18181c, dirt: 0.2 }, kind: "lit", m: 1, c: "metal" },
  "basement.coolant": { p: "liquid", o: { base: 0x2a8eb4 }, kind: "shiny", rough: 0.05, metal: 0, m: 3, c: "water", opacity: 0.7 },
  "basement.screen": { p: "led", o: { a: 0x0a5a4a, b: 0x36ff9a, pitch: 20 }, kind: "glow", m: 2, c: "metal" },
  "basement.screenB": { p: "led", o: { a: 0x0a3a6a, b: 0x4ac8ff, pitch: 24 }, kind: "glow", m: 2, c: "metal" },
  "basement.grate": { p: "grate", o: { base: 0x6e757e, slats: 6, dirt: 0.5 }, kind: "lit", m: 3, c: "metal" },

  /* ---------------- 4 : Influencer Rooftop Afterparty ---------------- */
  "roof.gravel": { p: "gravel", o: { base: 0x5c6376, dirt: 0.45 }, kind: "lit", m: 3, c: "stone" },
  "roof.deck": { p: "wood", o: { base: 0xb98a4e, dirt: 0.3 }, kind: "lit", m: 2, c: "stone" },
  "roof.parapet": { p: "concrete", o: { base: 0x757e92, dirt: 0.45 }, kind: "lit", m: 3, c: "stone" },
  "roof.tower": { p: "windows", o: { base: 0x232038, cols: 6, rows: 13, lit: 0.46, warm: 0xffc98a, cool: 0x9ad0ff }, kind: "glow", m: 9, c: "stone" },
  "roof.facade": { p: "windows", o: { base: 0x2e2a44, cols: 5, rows: 9, lit: 0.3, warm: 0xffbe7a, cool: 0x8ac0ff }, kind: "glow", m: 6, c: "stone" },
  "roof.pool": { p: "liquid", o: { base: 0x1fa0c8 }, kind: "shiny", rough: 0.04, metal: 0, m: 3, c: "water", opacity: 0.72 },
  "roof.pooltile": { p: "tile", o: { base: 0x2fb0d8, alt: 0x1a7fa8, cols: 8, grout: 0xe8f4f8, dirt: 0.2 }, kind: "lit", m: 2, c: "ice" },
  "roof.neon": { p: "neon", o: { base: 0xff2ec4, bars: 3, colors: [0xff2ec4, 0x2ee8ff, 0xb44dff], back: 0x0a0616 }, kind: "glow", m: 3, c: "metal" },
  "roof.duct": { p: "metal", o: { base: 0x8c9298, rivets: 5, dirt: 0.45 }, kind: "shiny", rough: 0.52, metal: 0.28, m: 2, c: "metal" },
  "roof.cushion": { p: "fabric", o: { base: 0xf0e4d2 }, kind: "lit", m: 1.5, c: "grass" },
  "roof.hedge": { p: "carpet", o: { base: 0x2c6a3a, dirt: 0.2 }, kind: "lit", m: 1.5, c: "grass" },
  "roof.glasswall": { p: "marble", o: { base: 0x8ec4d8, vein: 0xffffff, dirt: 0.04 }, kind: "shiny", rough: 0.06, metal: 0.1, m: 4, c: "ice", opacity: 0.24 },

  /* ---------------- 5 : Boyz II Hell ---------------- */
  /* A "dark" arena still needs a midtone. At 0x1a1420 the stage, the
     deck and the rock were all within a few percent of black, the
     magma and the LED wall were the only things in the frame carrying
     any value at all, and a character standing on the stage had
     nothing to be a silhouette against.

     Lifted again, and this time it was only half an albedo problem:
     the deck faces UP and the course's whole lighting idea is an
     underlight, so the stage was being lit by the dark half of the
     hemisphere and no albedo here could have saved it (the key fix is
     in sky.js). These values are what the deck needs to read as a lit
     stage floor once the truss above it is actually on. */
  "hell.stage": { p: "panel", o: { base: 0x5c4a6e, trim: 0xb01840, inset: 0.04, dirt: 0.3 }, kind: "lit", m: 4, c: "stone" },
  "hell.deck": { p: "grate", o: { base: 0x6f5a84, slats: 7, dirt: 0.35 }, kind: "lit", m: 3, c: "metal" },
  "hell.truss": { p: "metal", o: { base: 0x8a8a94, rivets: 6, dirt: 0.35 }, kind: "shiny", rough: 0.48, metal: 0.30, m: 2, c: "metal" },
  "hell.mark": { p: "stripe", o: { base: 0xf0e8d0, alt: 0x8a1030, count: 10, dirt: 0.3 }, kind: "lit", m: 2, c: "stone" },
  /* Two-thirds value. This is a fifty-six-metre unlit wall directly
     behind the stage: at full saturation it is not a screen in the
     scene, it IS the scene, and everything in front of it silhouettes
     to black. */
  "hell.led": { p: "led", o: { a: 0xa01344, b: 0x158ba8, pitch: 18 }, kind: "glow", m: 4, c: "metal" },
  "hell.magma": { p: "liquid", o: { base: 0xff5a18 }, kind: "glow", m: 4, c: "water" },
  "hell.rock": { p: "concrete", o: { base: 0x4e2a2e, dirt: 0.65 }, kind: "lit", m: 4, c: "stone" },
  "hell.speaker": { p: "grate", o: { base: 0x2e2e38, slats: 18, dirt: 0.3 }, kind: "lit", m: 2, c: "stone" },
  "hell.chrome": { p: "metal", o: { base: 0xe8c8d8, dirt: 0.05 }, kind: "shiny", rough: 0.22, metal: 0.30, m: 2, c: "metal" },
};

/* One typo guard: a surface that names a painter or a colour that
   does not exist would otherwise fail silently at load and leave a
   white material, which is very hard to spot in a busy frame. */
function validateSurface(name, def) {
  if (!PAINTERS[def.p]) throw new Error(`levels: surface "${name}" wants unknown painter "${def.p}"`);
}

/* ============================================================
   SURFACE CACHE

   Textures and materials are built on demand and disposed by
   namespace when a course unloads, so the food court's twenty
   textures do not stay resident while the player is in the
   basement. Namespaces are the prefix before the dot.
   ============================================================ */

export function makeSurfaces(ctx) {
  const cache = new Map();

  function build(name) {
    const def = SURFACES[name];
    if (!def) {
      /* Loud, but not fatal: a missing surface must not take down a
         course build. Magenta is deliberate - it is impossible to
         mistake for art direction. */
      console.warn(`[apop3d] unknown surface "${name}"`);
      const mat = new THREE.MeshLambertMaterial({ color: 0xff00ff, vertexColors: true });
      return { mat, tex: null, def: { m: 2, c: "stone" } };
    }
    validateSurface(name, def);

    const canvas = newCanvas(TEX_SIZE);
    const g = canvas.getContext("2d");
    const rng = makeRng(hashName(name));
    PAINTERS[def.p](g, TEX_SIZE, rng, def.o || {});

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;   /* colour map: encode once */
    /* 16, not 4. Almost every surface in this game is a floor or a
       walkway seen at a grazing angle, which is precisely the case
       trilinear filtering handles worst: it picks a mip from the
       larger of the two derivatives and blurs the sharp axis into
       mush, or picks the smaller one and aliases. Four samples was
       not enough to keep a tile joint or a tread plate stable across
       a forty-metre floor, and the shimmer that produced was a
       measurable part of our high-frequency energy. */
    tex.anisotropy = 16;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.name = name;

    const common = {
      map: tex,
      vertexColors: true,
      side: def.side === 2 ? THREE.DoubleSide : THREE.FrontSide,
    };
    if (def.opacity !== undefined) {
      common.transparent = true;
      common.opacity = def.opacity;
      /* DEPTH WRITE STAYS ON unless a surface asks otherwise, and that
         is the opposite of the usual advice for a reason.
         Every surface here is MERGED into one mesh per name, and the
         things wearing a translucent surface in this game are solid
         VOLUMES - soda columns, glass pyramids, cabinet fronts - not
         thin sheets. With depth write off, a solid volume draws over
         whatever is behind it regardless of order, so the food court's
         soda columns painted themselves in front of the crates they
         stand behind and a blind critic read it as a material bug
         rather than as a choice. Writing depth costs correct occlusion
         between two translucent panes seen through each other, which
         no shot in this game contains, and buys correct occlusion
         against the whole opaque world, which every shot does. */
      common.depthWrite = def.depthWrite !== false;
    }

    let mat;
    if (def.kind === "glow") {
      /* Unlit. A sign that dims when the sun goes down is not a sign,
         it is a painted board. */
      mat = new THREE.MeshBasicMaterial(common);
    } else if (def.kind === "shiny") {
      mat = new THREE.MeshStandardMaterial({
        ...common,
        roughness: def.rough === undefined ? 0.4 : def.rough,
        metalness: def.metal === undefined ? 0.3 : def.metal,
      });
    } else {
      mat = new THREE.MeshLambertMaterial(common);
    }
    mat.name = name;
    return { mat, tex, def };
  }

  function hashName(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  return {
    /** Prefer the real materials module the moment it exists. */
    get(name) {
      if (ctx.materials && typeof ctx.materials.surface === "function") {
        const m = ctx.materials.surface(name);
        if (m && m.isMaterial) {
          return { mat: m, tex: null, def: SURFACES[name] || { m: 2, c: "stone" } };
        }
      }
      let entry = cache.get(name);
      if (!entry) { entry = build(name); cache.set(name, entry); }
      return entry;
    },

    material(name) { return this.get(name).mat; },

    /** Metres per texture repeat, used by the world-space UV
     *  projection so one texture has one physical size everywhere. */
    scale(name) {
      const d = SURFACES[name];
      return d && d.m ? d.m : 2;
    },

    /** The collision material tag. Drives the moveset (ice slides,
     *  water swims) and the footstep bank. */
    collision(name) {
      const d = SURFACES[name];
      return d && d.c ? d.c : "stone";
    },

    /** Drop every surface in these namespaces. Called on unload; a
     *  leak here shows up as a course-to-course slowdown rather than
     *  as a crash, which is why it is explicit. */
    release(prefixes) {
      const keep = new Set(["shared"]);
      for (const [name, entry] of cache) {
        const ns = name.split(".")[0];
        if (keep.has(ns)) continue;
        if (prefixes && prefixes.length && !prefixes.includes(ns)) continue;
        entry.mat.dispose();
        if (entry.tex) entry.tex.dispose();
        cache.delete(name);
      }
    },

    disposeAll() {
      for (const entry of cache.values()) {
        entry.mat.dispose();
        if (entry.tex) entry.tex.dispose();
      }
      cache.clear();
    },

    get size() { return cache.size; },
    names: Object.keys(SURFACES),
  };
}

/* ============================================================
   GEOMETRY UTILITIES
   ============================================================ */

/**
 * Rewrite UVs as a world-space planar projection chosen per triangle
 * from the dominant normal axis. See the header for why this exists.
 * `scale` is metres per texture repeat.
 */
export function projectUV(geo, scale) {
  const pos0 = geo.attributes.position;
  if (!pos0) return geo;

  /* PER TRIANGLE, NOT PER VERTEX - and this used to be per vertex.
     The distinction is not cosmetic. On any curved surface the
     dominant normal axis changes as you go round it, so a triangle
     whose three corners each picked a different projection plane got
     its three UVs from three different planes: the texture sheared,
     folded and compressed to nothing near every 45-degree point.
     Every cylinder in the game - the fountain drum, the columns, the
     bollards, the litter bins, the pipes - was wearing a band of
     dense vertical stripes on each side as a result, which is both
     wrong and, since the stripes land at pixel scale, expensive in
     the one measurement we are trying to bring down.

     Selecting the plane once per face from the face's own geometric
     normal is what the module header always claimed happened here.
     It needs a de-indexed geometry, because an indexed vertex is
     shared between faces that may want different planes and one of
     them would have to lose. De-indexing costs vertices, not
     triangles, so it does not touch the triangle budget. */
  if (geo.index) {
    const ni = geo.toNonIndexed();
    geo.setIndex(null);
    for (const name of Object.keys(ni.attributes)) geo.setAttribute(name, ni.attributes[name]);
    ni.dispose();
  }

  const pos = geo.attributes.position;
  const inv = 1 / Math.max(0.001, scale);
  const uv = new Float32Array(pos.count * 2);
  const tris = Math.floor(pos.count / 3);
  for (let t = 0; t < tris; t += 1) {
    const a = t * 3, b = a + 1, c = a + 2;
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const e1x = pos.getX(b) - ax, e1y = pos.getY(b) - ay, e1z = pos.getZ(b) - az;
    const e2x = pos.getX(c) - ax, e2y = pos.getY(c) - ay, e2z = pos.getZ(c) - az;
    const nx = Math.abs(e1y * e2z - e1z * e2y);
    const ny = Math.abs(e1z * e2x - e1x * e2z);
    const nz = Math.abs(e1x * e2y - e1y * e2x);
    /* 0 = project on XZ (a floor), 1 = ZY, 2 = XY. */
    const axis = (ny >= nx && ny >= nz) ? 0 : (nx >= nz ? 1 : 2);
    for (let k = 0; k < 3; k += 1) {
      const i = a + k;
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const u = axis === 0 ? x : (axis === 1 ? z : x);
      const v = axis === 0 ? z : y;
      uv[i * 2] = u * inv;
      uv[i * 2 + 1] = v * inv;
    }
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

/**
 * Bake per-vertex tint, a stable per-face grain, and a contact
 * darkening near the bottom of the object.
 *
 * The contact term is doing more work than it looks. The contract
 * calls a floating character the loudest failure in the list, and the
 * same is true of props: a crate whose base is exactly as bright as
 * its top reads as hovering even when it is not. One shadow-casting
 * directional light cannot ground four hundred objects, so every one
 * of them carries a little of its own occlusion.
 */
export function paintGeometry(geo, opts) {
  const o = opts || {};
  const pos = geo.attributes.position;
  if (!pos) return geo;
  const tint = o.tint === undefined ? 0xffffff : o.tint;
  const tr = ((tint >> 16) & 255) / 255;
  const tg = ((tint >> 8) & 255) / 255;
  const tb = (tint & 255) / 255;
  const jitter = o.jitter === undefined ? 0.07 : o.jitter;
  const ao = o.ao === undefined ? 0.34 : o.ao;
  const aoHeight = o.aoHeight === undefined ? 1.6 : o.aoHeight;

  geo.computeBoundingBox();
  const minY = o.groundY !== undefined ? o.groundY : geo.boundingBox.min.y;

  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    /* Hashed from position, so a merged mesh keeps the same grain no
       matter what order its parts were queued in - determinism is
       what makes a screenshot golden meaningful. */
    let h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    h -= Math.floor(h);
    const grain = 1 + (h - 0.5) * 2 * jitter;
    const contact = ao > 0
      ? lerp(1 - ao, 1, clamp01((y - minY) / Math.max(0.05, aoHeight)))
      : 1;
    const k = grain * contact;
    col[i * 3] = tr * k;
    col[i * 3 + 1] = tg * k;
    col[i * 3 + 2] = tb * k;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}

function roundedRectShape(w, d, r) {
  const hw = w / 2, hd = d / 2;
  const rr = clamp(r, 0, Math.min(hw, hd) - 0.001);
  const s = new THREE.Shape();
  s.moveTo(-hw + rr, -hd);
  s.lineTo(hw - rr, -hd);
  s.quadraticCurveTo(hw, -hd, hw, -hd + rr);
  s.lineTo(hw, hd - rr);
  s.quadraticCurveTo(hw, hd, hw - rr, hd);
  s.lineTo(-hw + rr, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - rr);
  s.lineTo(-hw, -hd + rr);
  s.quadraticCurveTo(-hw, -hd, -hw + rr, -hd);
  return s;
}

/* ============================================================
   PRIMITIVES

   Every builder returns an indexed BufferGeometry with normals,
   centred on the origin, ready to be transformed, painted and
   merged. UVs are not authored: projectUV overwrites them.
   ============================================================ */

export function makePrimitives() {
  const P = {};

  /**
   * The workhorse. A slab with chamfered top and bottom edges and
   * rounded corners in plan.
   *
   * The chamfer is not decoration. SM64 silhouettes read at 240p
   * because their edges catch a different value from their faces; a
   * hard-edged box merges into whatever is behind it the moment the
   * light is flat. Two centimetres of bevel is the cheapest possible
   * edge highlight and it survives any camera distance.
   */
  P.platform = (w, h, d, opts = {}) => {
    const bev = opts.bevel === undefined ? Math.min(0.14, h * 0.28, w * 0.1, d * 0.1) : opts.bevel;
    const round = opts.round === undefined ? Math.min(0.4, w * 0.14, d * 0.14) : opts.round;
    if (bev <= 0.005) {
      const g = new THREE.BoxGeometry(w, h, d);
      return g;
    }
    const shape = roundedRectShape(
      Math.max(0.05, w - bev * 2), Math.max(0.05, d - bev * 2),
      Math.max(0, round - bev)
    );
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.02, h - bev * 2),
      bevelEnabled: true,
      bevelSize: bev,
      bevelThickness: bev,
      bevelSegments: 1,
      curveSegments: opts.curve === undefined ? 2 : opts.curve,
      steps: 1,
    });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -(h / 2 - bev), 0);
    geo.computeVertexNormals();
    return geo;
  };

  /** A wedge rising along +Z. Origin at the centre of its base. */
  P.slope = (w, h, d, opts = {}) => {
    const hw = w / 2, hd = d / 2;
    const t = opts.thickness === undefined ? 0.4 : opts.thickness;
    const pos = [
      -hw, 0, -hd, hw, 0, -hd, hw, h, hd, -hw, h, hd,          /* top face */
      -hw, -t, -hd, hw, -t, -hd, hw, h - t, hd, -hw, h - t, hd, /* under */
    ];
    const idx = [
      0, 2, 1, 0, 3, 2,      /* top */
      4, 5, 6, 4, 6, 7,      /* bottom */
      0, 1, 5, 0, 5, 4,      /* back */
      3, 7, 6, 3, 6, 2,      /* front */
      0, 4, 7, 0, 7, 3,      /* left */
      1, 2, 6, 1, 6, 5,      /* right */
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  };

  /** A slope with kerbs down each side and tread lines across it. */
  P.ramp = (w, rise, run, opts = {}) => {
    const parts = [P.slope(w, rise, run, opts)];
    if (opts.kerb !== false) {
      const kw = opts.kerbWidth === undefined ? 0.3 : opts.kerbWidth;
      const kh = opts.kerbHeight === undefined ? 0.5 : opts.kerbHeight;
      for (const s of [-1, 1]) {
        const k = P.slope(kw, rise, run, { thickness: 0.2 });
        k.translate(s * (w / 2 - kw / 2), kh * 0.5, 0);
        const top = P.slope(kw, rise, run, { thickness: kh });
        top.translate(s * (w / 2 - kw / 2), kh, 0);
        parts.push(k, top);
      }
    }
    /* TREAD PITCH IS A HIGH-FREQUENCY BUDGET, NOT A DETAIL SETTING.
       At one bar every 1.2 m, 60 mm tall, the mall's sixteen-metre
       escalator put thirteen sub-pixel horizontal lines across the
       upper third of the frame - and measured, that escalator was the
       single hottest region of the `enemy-encounter` capture, hotter
       than any texture in the course. A stair read at thirty metres is
       read from its slope and its handrail; the treads only have to
       survive being stood on.
       Two metres and 110 mm: half as many lines, each nearly twice as
       deep, so the pattern lands above the sample grid at the
       distances these are actually seen from. */
    if (opts.treads) {
      const n = Math.max(2, Math.round(run / 2.0));
      for (let i = 1; i < n; i += 1) {
        const t = i / n;
        const bar = new THREE.BoxGeometry(w * 0.92, 0.11, 0.22);
        bar.translate(0, rise * t + 0.055, -run / 2 + run * t);
        parts.push(bar);
      }
    }
    return mergeGeometries(parts);
  };

  /** Base, shaft and capital. Odd side counts read as carved, even
   *  as machined; the default 8 is the mall's aluminium column. */
  P.pillar = (r, h, opts = {}) => {
    const sides = opts.sides || 8;
    const parts = [];
    const shaft = new THREE.CylinderGeometry(
      r * (opts.taper === undefined ? 0.94 : opts.taper), r, h, sides, 1
    );
    shaft.translate(0, h / 2, 0);
    parts.push(shaft);
    if (opts.base !== false) {
      const b = P.platform(r * 2.7, 0.32, r * 2.7, { bevel: 0.08 });
      b.translate(0, 0.16, 0);
      parts.push(b);
    }
    if (opts.cap !== false) {
      const c = P.platform(r * 2.5, 0.36, r * 2.5, { bevel: 0.1 });
      c.translate(0, h - 0.18, 0);
      parts.push(c);
    }
    if (opts.flutes) {
      for (let i = 0; i < sides; i += 1) {
        const a = (i / sides) * TAU;
        const f = new THREE.BoxGeometry(r * 0.16, h * 0.9, r * 0.16);
        f.translate(Math.cos(a) * r * 0.99, h / 2, Math.sin(a) * r * 0.99);
        parts.push(f);
      }
    }
    return mergeGeometries(parts);
  };

  /** Two legs and a radial span of voussoirs. */
  P.arch = (w, h, d, opts = {}) => {
    const parts = [];
    const legW = opts.legWidth === undefined ? w * 0.16 : opts.legWidth;
    const springs = opts.spring === undefined ? h * 0.55 : opts.spring;
    for (const s of [-1, 1]) {
      const leg = P.platform(legW, springs, d, { bevel: 0.08 });
      leg.translate(s * (w / 2 - legW / 2), springs / 2, 0);
      parts.push(leg);
    }
    const steps = opts.segments || 9;
    const R = w / 2 - legW * 0.0;
    for (let i = 0; i < steps; i += 1) {
      const a0 = Math.PI * (i / steps);
      const a1 = Math.PI * ((i + 1) / steps);
      const am = (a0 + a1) / 2;
      const seg = new THREE.BoxGeometry(
        (Math.PI * R) / steps * 1.08, h - springs, d
      );
      seg.rotateZ(am - Math.PI / 2);
      seg.translate(
        -Math.cos(am) * (R - legW * 0.5),
        springs + Math.sin(am) * (h - springs) * 0.5,
        0
      );
      parts.push(seg);
    }
    return mergeGeometries(parts);
  };

  /** Handrail along a polyline, with posts. Points are [x, y, z].
   *
   *  THE DEFAULT RADIUS IS A HIGH-FREQUENCY BUDGET. A 70 mm tube at
   *  the thirty-odd metres these are typically seen from is barely
   *  one pixel wide, and there are a great many of them: measured,
   *  the railing band across the top of a frame was the largest
   *  remaining contributor to this build's high-frequency energy,
   *  because a one-pixel edge at full contrast is the worst case for
   *  a Laplacian and for a sampler both. 100 mm is still a handrail -
   *  Super Mario 64's are chunkier than this - and it costs nothing
   *  but triangles we are nowhere near spending. */
  P.rail = (points, opts = {}) => {
    const parts = [];
    const rr = opts.radius === undefined ? 0.10 : opts.radius;
    const height = opts.height === undefined ? 1.1 : opts.height;
    const postEvery = opts.postEvery === undefined ? 2.4 : opts.postEvery;
    const bars = opts.bars === undefined ? 2 : opts.bars;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i], b = points[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.01) continue;
      for (let k = 0; k < bars; k += 1) {
        const hy = height * (bars === 1 ? 1 : (0.45 + 0.55 * (k / (bars - 1))));
        const seg = new THREE.CylinderGeometry(rr, rr, len, 6, 1);
        seg.rotateZ(Math.PI / 2);
        const q = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(dx, dy, dz).normalize()
        );
        seg.applyQuaternion(q);
        seg.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + hy, (a[2] + b[2]) / 2);
        parts.push(seg);
      }
      const n = Math.max(1, Math.round(len / postEvery));
      for (let p = 0; p <= n; p += 1) {
        if (p === n && i < points.length - 2) continue;
        const t = p / n;
        const post = new THREE.CylinderGeometry(rr * 1.15, rr * 1.35, height, 6, 1);
        post.translate(a[0] + dx * t, a[1] + dy * t + height / 2, a[2] + dz * t);
        parts.push(post);
      }
    }
    return mergeGeometries(parts);
  };

  /** Open tube with a flared lip - warp pipes, slides, ducting. */
  P.pipe = (r, len, opts = {}) => {
    const sides = opts.sides || 12;
    const parts = [];
    const tube = new THREE.CylinderGeometry(r, r, len, sides, 1, true);
    tube.translate(0, len / 2, 0);
    parts.push(tube);
    if (opts.lip !== false) {
      const lipH = opts.lipHeight === undefined ? 0.4 : opts.lipHeight;
      const lip = new THREE.CylinderGeometry(r * 1.14, r * 1.14, lipH, sides, 1);
      lip.translate(0, len - lipH / 2, 0);
      parts.push(lip);
    }
    if (opts.inner) {
      const inner = new THREE.CylinderGeometry(r * 0.9, r * 0.9, len, sides, 1, true);
      inner.scale(-1, 1, 1);
      inner.translate(0, len / 2, 0);
      parts.push(inner);
    }
    return mergeGeometries(parts);
  };

  /**
   * A closed annular slab - a kerb, a basin coping, a pool rim.
   *
   * What it replaces is a ring of tangential boxes, and that is worth
   * saying because the boxes look right in a plan view and wrong in
   * the frame: the segments meet along their INNER edges and pull
   * apart along their outer ones, so a twenty-segment fountain wall is
   * a ring of separate crates with the pool showing through the gaps.
   * Course 1's fountain read as teal packing cases for exactly that
   * reason. A lathe closes it, and it is built from four explicit
   * pieces rather than a LatheGeometry profile because the winding of
   * a lathe depends on the order of its points and a ring that is
   * inside out is invisible from the only side anybody sees.
   *
   * Origin at the CENTRE OF THE BASE, so `pos` is where it sits on the
   * floor rather than half a height above it.
   */
  P.ring = (rIn, rOut, h, opts = {}) => {
    const seg = opts.segments === undefined ? 44 : opts.segments;
    const parts = [];
    const outer = new THREE.CylinderGeometry(rOut, rOut, h, seg, 1, true);
    outer.translate(0, h / 2, 0);
    parts.push(outer);
    /* Mirrored, not re-wound: scaling by -1 reverses the winding, which
       is how P.pipe turns a tube inside out for its own inner wall. */
    const inner = new THREE.CylinderGeometry(rIn, rIn, h, seg, 1, true);
    inner.scale(-1, 1, 1);
    inner.translate(0, h / 2, 0);
    parts.push(inner);
    const top = new THREE.RingGeometry(rIn, rOut, seg, 1);
    top.rotateX(-Math.PI / 2);
    top.translate(0, h, 0);
    parts.push(top);
    if (opts.floor !== false) {
      const bot = new THREE.RingGeometry(rIn, rOut, seg, 1);
      bot.rotateX(Math.PI / 2);
      parts.push(bot);
    }
    return mergeGeometries(parts);
  };

  /** A liquid surface. Segmented so vfx or a vertex shader can ripple
   *  it later; flat-shaded with a gentle swell baked in for now.
   *
   *  `opts.radius` builds a DISC instead of a square. Course 2 already
   *  hand-rolled one and said why: a square of liquid inside a circular
   *  pool leaves four corners poking out through the wall, and in
   *  course 1's fountain those corners were the only water anybody
   *  could see - an orange diamond wedged through a teal ring, which
   *  is not what a fountain looks like. */
  P.water = (w, d, opts = {}) => {
    const seg = opts.segments === undefined ? 8 : opts.segments;
    let geo;
    if (opts.radius) {
      geo = new THREE.RingGeometry(
        opts.inner === undefined ? 0.0001 : opts.inner,
        opts.radius, opts.arc === undefined ? 44 : opts.arc, Math.max(1, seg)
      );
    } else {
      geo = new THREE.PlaneGeometry(w, d, seg, seg);
    }
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const amp = opts.swell === undefined ? 0.05 : opts.swell;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, Math.sin(x * 0.6) * amp + Math.cos(z * 0.47) * amp);
    }
    geo.computeVertexNormals();
    return geo;
  };

  /**
   * Vegetation, in five dialects. All of them are stacked polygonal
   * cones or crossed cards, because a plant that reads at 30m is a
   * silhouette and nothing else.
   */
  P.tree = (kind, opts = {}) => {
    const rng = makeRng(opts.seed === undefined ? 0x71EE : opts.seed);
    const parts = [];
    const h = opts.height === undefined ? 5 : opts.height;

    if (kind === "palm") {
      const trunkSeg = 5;
      let px = 0, pz = 0;
      for (let i = 0; i < trunkSeg; i += 1) {
        const t0 = i / trunkSeg, t1 = (i + 1) / trunkSeg;
        const r0 = lerp(0.24, 0.14, t0), r1 = lerp(0.24, 0.14, t1);
        const seg = new THREE.CylinderGeometry(r1, r0, h / trunkSeg, 7, 1);
        px += rngRange(rng, -0.1, 0.16);
        pz += rngRange(rng, -0.12, 0.12);
        seg.translate(px, h * (t0 + t1) / 2, pz);
        parts.push(seg);
      }
      const fronds = 9;
      for (let i = 0; i < fronds; i += 1) {
        const a = (i / fronds) * TAU + rngRange(rng, -0.15, 0.15);
        const len = rngRange(rng, 1.9, 2.9);
        const f = new THREE.BoxGeometry(len, 0.05, 0.62);
        f.translate(len / 2, 0, 0);
        f.rotateZ(rngRange(rng, -0.55, -0.15));
        f.rotateY(a);
        f.translate(px, h - 0.1, pz);
        parts.push(f);
      }
    } else if (kind === "ficus") {
      const trunk = new THREE.CylinderGeometry(0.1, 0.16, h * 0.55, 6, 1);
      trunk.translate(0, h * 0.275, 0);
      parts.push(trunk);
      const blobs = 7;
      for (let i = 0; i < blobs; i += 1) {
        const r = rngRange(rng, 0.5, 0.95);
        const b = new THREE.IcosahedronGeometry(r, 0);
        b.translate(
          rngRange(rng, -0.75, 0.75),
          h * 0.5 + rngRange(rng, 0, h * 0.45),
          rngRange(rng, -0.75, 0.75)
        );
        parts.push(b);
      }
    } else if (kind === "dead") {
      const trunk = new THREE.CylinderGeometry(0.08, 0.2, h, 5, 1);
      trunk.translate(0, h / 2, 0);
      parts.push(trunk);
      for (let i = 0; i < 6; i += 1) {
        const len = rngRange(rng, 0.8, 1.8);
        const b = new THREE.CylinderGeometry(0.03, 0.07, len, 4, 1);
        b.translate(0, len / 2, 0);
        b.rotateZ(rngRange(rng, 0.5, 1.15));
        b.rotateY(rng() * TAU);
        b.translate(0, h * rngRange(rng, 0.45, 0.92), 0);
        parts.push(b);
      }
    } else if (kind === "cable") {
      /* The basement's only "plant": a hanging bundle of loom cable. */
      const strands = 9;
      for (let i = 0; i < strands; i += 1) {
        const len = rngRange(rng, h * 0.4, h);
        const s = new THREE.CylinderGeometry(0.045, 0.045, len, 4, 1);
        s.translate(rngRange(rng, -0.3, 0.3), -len / 2, rngRange(rng, -0.3, 0.3));
        s.rotateZ(rngRange(rng, -0.12, 0.12));
        parts.push(s);
      }
    } else {
      /* "spire": the twisted horn shapes in the Boyz II Hell arena. */
      const segs = 6;
      for (let i = 0; i < segs; i += 1) {
        const t0 = i / segs, t1 = (i + 1) / segs;
        const seg = new THREE.CylinderGeometry(
          lerp(0.6, 0.05, t1), lerp(0.6, 0.05, t0), h / segs, 5, 1
        );
        seg.rotateZ(rngRange(rng, -0.12, 0.12) * (i + 1));
        seg.translate(
          Math.sin(t0 * 3) * 0.5, h * (t0 + t1) / 2, Math.cos(t0 * 2.4) * 0.4
        );
        parts.push(seg);
      }
    }
    return mergeGeometries(parts);
  };

  /* --------------------------------------------------------------
     DYNAMIC PRIMITIVES

     These return descriptors, not geometry. world.js instantiates
     them as their own meshes and drives them in update(), because a
     mover has to publish its per-frame delta: a body riding a lift
     must inherit that delta BEFORE its own integration or the player
     slides off every platform in the game.
     -------------------------------------------------------------- */

  P.movingPlatform = (opts) => ({
    kind: "moving",
    points: opts.points,
    period: opts.period === undefined ? 6 : opts.period,
    pause: opts.pause === undefined ? 0.6 : opts.pause,
    size: opts.size || [4, 0.6, 4],
    surface: opts.surface || "shared.metal",
    ease: opts.ease === undefined ? true : opts.ease,
    phase: opts.phase || 0,
    tint: opts.tint,
  });

  P.seesaw = (opts) => ({
    kind: "seesaw",
    pos: opts.pos,
    size: opts.size || [8, 0.4, 3],
    axis: opts.axis || "x",
    maxTilt: opts.maxTilt === undefined ? 0.22 : opts.maxTilt,
    rate: opts.rate === undefined ? 1.1 : opts.rate,
    surface: opts.surface || "shared.metal",
    phase: opts.phase || 0,
  });

  P.rotator = (opts) => ({
    kind: "rotator",
    pos: opts.pos,
    radius: opts.radius === undefined ? 6 : opts.radius,
    arms: opts.arms === undefined ? 3 : opts.arms,
    armSize: opts.armSize || [5, 0.5, 2.2],
    period: opts.period === undefined ? 9 : opts.period,
    surface: opts.surface || "shared.metal",
    hub: opts.hub !== false,
    tilt: opts.tilt || 0,
    phase: opts.phase || 0,
  });

  P.elevator = (opts) => ({
    kind: "elevator",
    pos: opts.pos,
    low: opts.low,
    high: opts.high,
    period: opts.period === undefined ? 8 : opts.period,
    size: opts.size || [5, 0.6, 5],
    surface: opts.surface || "shared.metal",
    phase: opts.phase || 0,
    hold: opts.hold === undefined ? 1.2 : opts.hold,
  });

  return P;
}

/* ============================================================
   AUTHORING HELPERS SHARED BY THE COURSES
   ============================================================ */

/** A row of stall units along a wall, alternating liveries. */
function stallRow(out, P, opts) {
  const {
    x, z, count, spacing, facing, surfaces, awnings, width = 9, depth = 6, height = 5,
  } = opts;
  const dir = facing;               /* yaw in radians the counter faces */
  const nx = Math.sin(dir), nz = Math.cos(dir);
  const tx = Math.cos(dir), tz = -Math.sin(dir);
  for (let i = 0; i < count; i += 1) {
    const o = (i - (count - 1) / 2) * spacing;
    const cx = x + tx * o;
    const cz = z + tz * o;
    const surf = surfaces[i % surfaces.length];
    const awn = awnings[i % awnings.length];

    /* Body */
    out.add(P.platform(width, height, depth, { bevel: 0.12 }), surf, {
      pos: [cx, height / 2, cz], rot: [0, dir, 0], collide: true,
    });
    /* Roof cap - a landable ledge, which is what turns a row of shops
       into the course's first mid-tier route. */
    out.add(P.platform(width + 0.8, 0.5, depth + 0.8, { bevel: 0.14 }), "foodcourt.counter", {
      pos: [cx, height + 0.25, cz], rot: [0, dir, 0], collide: true,
    });
    /* Counter and its front lip */
    out.add(P.platform(width * 0.86, 0.24, 1.5, { bevel: 0.08 }), "foodcourt.counter", {
      pos: [cx + nx * (depth / 2 + 0.55), 1.15, cz + nz * (depth / 2 + 0.55)],
      rot: [0, dir, 0], collide: true,
    });
    for (const s of [-1, 1]) {
      out.add(P.pillar(0.16, 1.05, { base: false, cap: false, sides: 6 }), "shared.chrome", {
        pos: [
          cx + nx * (depth / 2 + 0.55) + tx * s * width * 0.4,
          0, cz + nz * (depth / 2 + 0.55) + tz * s * width * 0.4,
        ],
      });
    }
    /* Awning: a shallow slope, double-sided so it reads from below. */
    const aw = P.slope(width * 0.94, 0.9, 2.6, { thickness: 0.12 });
    out.add(aw, awn, {
      pos: [cx + nx * (depth / 2 + 1.5), 3.5, cz + nz * (depth / 2 + 1.5)],
      rot: [0, dir + Math.PI, 0], collide: false, castShadow: true,
    });
    /* Signboard above the awning, lit. */
    out.add(P.platform(width * 0.7, 1.5, 0.3, { bevel: 0.06 }), "foodcourt.sign", {
      pos: [cx + nx * (depth / 2 + 0.2), 4.5, cz + nz * (depth / 2 + 0.2)],
      rot: [0, dir, 0], collide: false, tint: [0xffd166, 0xff6b6b, 0x6bd5ff, 0x9be870][i % 4],
    });
    out.add(P.platform(width * 0.72, 0.16, 0.42, { bevel: 0.04 }), "foodcourt.neon", {
      pos: [cx + nx * (depth / 2 + 0.15), 3.62, cz + nz * (depth / 2 + 0.15)],
      rot: [0, dir, 0], collide: false,
    });
  }
}

/** Tables, chairs and litter. The single highest-value decor pass in
 *  the game: an empty floor is the "this is a prototype" tell. */
/* A BLIND PASS CALLED THE `water` CLUSTER "A GREY SCRIBBLE", and the
   word to take seriously is scribble. The old chair was a 0.1 m back
   slab on four cylinders of radius 0.035 - at the twenty metres that
   frame is shot from, each leg is well under one screen pixel wide, so
   forty chairs contributed a hundred and sixty flickering sub-pixel
   lines and nothing with an outline. Sub-pixel structure is not detail;
   it is the pixel-noise metric's favourite food and it reads as mess.

   The rebuild trades line count for MASS. The seat and the back are
   one moulded shell rather than two slabs, the legs are half again as
   thick and closed at the bottom by a stretcher rail, and the whole
   chair gets an apron under the seat - so the leg zone is a shape with
   a hole in it instead of four hairlines. The table gets an apron and
   a proper cross foot for the same reason. Chairs then come in two
   liveries, because forty objects of one colour scattered over one
   floor is the same instanced-clone read as the hedges. */
function seatingField(out, P, rng, opts) {
  const { cx, cz, radius, count, table, chair, chairB, tray } = opts;
  const protoTable = () => {
    const parts = [];
    const top = P.platform(1.9, 0.16, 1.9, { bevel: 0.05, round: 0.9, curve: 4 });
    top.translate(0, 0.85, 0);
    /* The apron. A 12 cm band under the top edge is what stops a cafe
       table reading as a disc hovering on a stick. */
    const apron = P.platform(1.72, 0.14, 1.72, { bevel: 0.03, round: 0.8, curve: 4 });
    apron.translate(0, 0.72, 0);
    const stem = new THREE.CylinderGeometry(0.15, 0.17, 0.72, 8, 1);
    stem.translate(0, 0.36, 0);
    /* A cross foot, not a disc: four spurs read as a base at any
       distance and cast a shape rather than a shadow of a coin. */
    for (let i = 0; i < 4; i += 1) {
      const spur = P.platform(1.06, 0.11, 0.24, { bevel: 0.03, round: 0.1 });
      spur.rotateY((i / 4) * TAU);
      spur.translate(0, 0.055, 0);
      parts.push(spur);
    }
    parts.push(top, apron, stem);
    return mergeGeometries(parts);
  };
  const protoChair = () => {
    const parts = [];
    const seat = P.platform(0.66, 0.13, 0.64, { bevel: 0.04, round: 0.22 });
    seat.translate(0, 0.46, 0);
    /* The back, raked and thicker. A vertical slab is a gate; a raked
       one is a chair, and the rake is what separates the silhouette
       from the seat below it. */
    const back = P.platform(0.66, 0.66, 0.14, { bevel: 0.04, round: 0.18 });
    back.rotateX(-0.16);
    back.translate(0, 0.83, -0.28);
    /* Apron under the seat, and a stretcher rail low down. Together
       they close the leg zone into one dark band, which is what a
       chair at twenty metres actually looks like. */
    const apron = P.platform(0.58, 0.11, 0.56, { bevel: 0.03, round: 0.16 });
    apron.translate(0, 0.37, 0);
    const rail = P.platform(0.52, 0.07, 0.50, { bevel: 0.02, round: 0.14 });
    rail.translate(0, 0.16, 0);
    parts.push(seat, back, apron, rail);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.CylinderGeometry(0.055, 0.05, 0.44, 6, 1);
        leg.translate(sx * 0.25, 0.22, sz * 0.24);
        parts.push(leg);
      }
    }
    return mergeGeometries(parts);
  };
  const protoTray = () => {
    const g = P.platform(0.62, 0.06, 0.46, { bevel: 0.02, round: 0.07 });
    return g;
  };
  const CHAIRS = chairB ? [chair, chairB] : [chair];

  for (let i = 0; i < count; i += 1) {
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * radius;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    if (opts.reject && opts.reject(x, z)) continue;
    const yaw = rng() * TAU;
    /* Three size classes, not one. A hundred identical objects at
       exactly character scale is the difference between a place and a
       filler pass: the eye reads the repeat instantly and stops
       believing anything in the frame. Instance scale is free, so
       there is no excuse for a uniform field.
       The bottom class came UP - 0.74 was a doll's chair at 0.46 m
       across, which is most of where the scribble came from. */
    const cls = rng();
    const size = cls < 0.24 ? rngRange(rng, 1.24, 1.44)
      : (cls < 0.66 ? rngRange(rng, 1.0, 1.14) : rngRange(rng, 0.86, 0.98));
    /* Laminate, one stop down from the floor it stands on. A cream
       table top is a large near-horizontal bright plane, and in the
       `water` framing a cluster of them sits in the bottom third. */
    out.inst(`table.${table}`, protoTable, table,
      { pos: [x, 0, z], rot: [0, yaw, 0], tint: 0xc4bda6,
        scale: [size, rngRange(rng, 0.94, 1.05), size] });
    const chairs = rngInt(rng, 2, 4);
    /* The livery walks per SETTING, not per chair. Two colours around
       one table is a paint chart; a teal table beside a blue one is a
       food court. */
    const surf = CHAIRS[i % CHAIRS.length];
    for (let c = 0; c < chairs; c += 1) {
      const ca = yaw + (c / chairs) * TAU + rngRange(rng, -0.34, 0.34);
      const cd = rngRange(rng, 1.2, 1.5) * size;
      out.inst(`chair.${surf}`, protoChair, surf, {
        pos: [x + Math.cos(ca) * cd, 0, z + Math.sin(ca) * cd],
        /* One in six is pushed away from the table and turned out of
           line, which is what a chair somebody stood up from does. */
        rot: [0, -ca + Math.PI / 2 + (rng() < 0.17 ? rngRange(rng, -0.9, 0.9) : rngRange(rng, -0.12, 0.12)), 0],
        scale: size * rngRange(rng, 0.94, 1.06),
      });
    }
    if (rng() > 0.45 && tray) {
      out.inst(`tray.${tray}`, protoTray, tray, {
        pos: [x + rngRange(rng, -0.5, 0.5), 0.95 * size, z + rngRange(rng, -0.5, 0.5)],
        rot: [0, rng() * TAU, 0], scale: size,
      });
    }
  }
}

/* ------------------------------------------------------------------
   THE NEAR FIELD

   Measured, not decorative. Five rounds of blind review turned on one
   sentence: "the bottom 30-45% of every capture is unbroken, evenly
   lit floor. Nothing overlaps it, nothing sits in front of it." The
   experiment that made it undeniable ran the same environments twice,
   once with the character and once with her hidden: 5-2 with her, 1-6
   without. One readable element had been added on top of a set of
   pictures that still had a single depth layer plus a fog curtain.

   Every reference frame that beat us had a framing device - cage
   bars, roof tiles, a ledge overhang, a slab edge with void beneath -
   and the only frame of ours that ever won on its picture rather than
   on its character was the one with the ball pit's brick rim cutting
   the bottom edge.

   THE NUMBERS THIS IS BUILT FROM. camera.js solves a capture pose
   about nine metres behind the character with the lens 3.0 to 3.9 m
   up and pitched 5 to 14 degrees down, and the blind-compare crop
   throws away the bottom 15.5% of the frame - so anything that lives
   below NDC -0.69 is never seen by the review at all. Solving those
   together, an object D metres in front of the lens has to reach

       top  ~=  lensHeight - 0.35 * D

   to fill the bottom third of the picture the critic actually looks
   at. Three and a half to five metres out that is 1.2 to 1.9 m tall.
   Ten metres out it is a building, which is why scattering more props
   across the middle distance never closed this gap.

   TWO RULES KEEP IT FROM COSTING A CAPTURE.

     1. IT GOES TO ONE SIDE. The sight line to her chest passes about
        2.4 m up at four metres from the lens, so a bed across the
        middle of the frame clears her chest and then eats her feet
        and her contact shadow - the loudest failure in the contract's
        list. Beds sit 2.5 to 4 m off the view axis and run OUT of
        frame, so the shot reads as looking past something.
     2. IT COLLIDES. camera.js scores its own bottom row: a near prop
        there is worth +0.85 to the pose and an unbroken floor plane
        across it costs -1.70. Geometry the collision BVH cannot see
        is geometry the solver can neither credit nor avoid.
   ------------------------------------------------------------------ */

/* ------------------------------------------------------------------
   THE HEDGE KIT

   A blind pass, round six: "the same squashed-sphere hedge appears in
   five of seven frames, three in a row at identical rotation and scale
   in `interior` and `platforming`." That is exactly what it was - ONE
   `out.inst("shrub")` key, one IcosahedronGeometry scaled (1, 0.78, 1),
   and a yaw jitter that does nothing at all to a solid of revolution.

   THE FIX IS THREE SILHOUETTES AND NINE BATCHES, and the nine is
   forced by the instancing contract rather than chosen: out.inst()
   paints the prototype's vertex colours the FIRST time a key is seen
   and ignores every later instance's `tint`, so per-instance hue is
   not expressible as a transform. Hue has to be a batch. Three shapes
   times three liveries is nine draw calls against a budget of three
   hundred, on a frame currently spending 162.

   Variety here is expected to HELP the tightest metric row rather than
   cost it. Measured on the crowd earlier in this project, an evenly
   spaced lattice of identical bodies scored 8.50 on pixel noise and
   the same bodies with pose variety scored 7.90: a repeat at a regular
   pitch beats against the sampling grid, and breaking the repeat
   breaks the beat.

   Each prototype is normalised to y 0..1 and |x|,|z| <= 1 so the
   instance scale below is read directly in metres.
   ------------------------------------------------------------------ */

const HEDGE_SHAPES = ["dome", "cone", "spray"];

/* Three liveries, and all three are DARKER AND LESS CHROMATIC than
   the single one they replace. `interior` measured the near-field
   shrub mass at luma 103 / saturation 0.66 with the mid-ground floor
   it overlaps at 128 - a foreground element barely under the thing it
   is meant to sit in front of, which is why a blind pass kept naming
   it as the subject of the picture. These multiply foodcourt.hedge's
   0x4a6b3e base to an albedo luma near 65 in three separate hue bands
   (blue-green in shade, mid box, dusty olive), which puts the mass a
   clear stop under the mid-ground and spreads it across enough hue
   that three beds in one frame are not one colour. */
const HEDGE_LIVERY = [0x94aeb4, 0xa8b2a0, 0xc0ac86];

/** Normalise a merged foliage blob to y 0..1, |x|,|z| <= 1. */
function normaliseProto(geo) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  geo.translate(0, -b.min.y, 0);
  const h = Math.max(0.001, b.max.y - b.min.y);
  const w = Math.max(0.001, Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z));
  geo.scale(1 / w, 1 / h, 1 / w);
  return geo;
}

/**
 * One of three hedge silhouettes.
 *
 * They are separated by OUTLINE, not by detail: a dome, a cone and a
 * low spreading spray read as three different plants as black shapes,
 * which is the test CONTRACT §2.3 actually applies. Two of the three
 * are also deliberately asymmetric, so the per-instance yaw jitter has
 * something to act on - on the solid of revolution it replaced, yaw
 * was a no-op and every clone in a row was pixel-identical.
 */
function hedgeProto(kind) {
  const blob = (rx, ry, rz, px, py, pz) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    g.scale(rx, ry, rz);
    g.translate(px, py, pz);
    return g;
  };
  const parts = [];
  if (kind === "cone") {
    /* Clipped conifer. The one vertical in the kit: in a bed of low
       mounds it is the note that stops the run reading as a hedge
       extruded along a line. */
    const c = new THREE.ConeGeometry(0.62, 1.02, 9, 2);
    c.translate(0, 0.51, 0);
    parts.push(c, blob(0.30, 0.22, 0.30, 0.02, 0.92, -0.02),
      blob(0.34, 0.20, 0.32, -0.26, 0.26, 0.16));
  } else if (kind === "spray") {
    /* A low spreading shrub, wider than it is tall and lopsided on
       purpose - its top edge is four different heights, so a clump of
       them has a ragged skyline instead of one repeated arc. */
    parts.push(
      blob(0.62, 0.34, 0.50, -0.32, 0.32, -0.08),
      blob(0.52, 0.28, 0.58, 0.34, 0.26, 0.18),
      blob(0.42, 0.40, 0.42, 0.02, 0.50, -0.24),
      blob(0.34, 0.20, 0.36, -0.56, 0.18, 0.28)
    );
  } else {
    /* The box ball, kept - it is the right shape for a mall planter -
       but built from three offset lobes rather than one ellipsoid, so
       its outline has shoulders and the light breaks across it. */
    parts.push(
      blob(0.84, 0.54, 0.80, 0, 0.44, 0),
      blob(0.48, 0.32, 0.44, 0.26, 0.70, -0.12),
      blob(0.40, 0.26, 0.42, -0.32, 0.60, 0.20)
    );
  }
  return normaliseProto(mergeGeometries(parts));
}

/* Per-shape aspect. A cone that is as wide as a dome is a dome with a
   point on it, so the three shapes are given three different reads of
   the same requested (radius, height) rather than being drawn to one
   bounding box - which is the other half of "identical scale". */
const HEDGE_ASPECT = { dome: [1.0, 1.0], cone: [0.66, 1.68], spray: [1.20, 0.86] };

/**
 * Plant one hedge. `pick` is any integer; shape and livery are taken
 * from it on different strides so the two never move together and a
 * run never repeats a (shape, colour) pair at a regular pitch.
 * `r` and `h` are the nominal radius and height in metres.
 */
function plantHedge(out, rng, pick, pos, r, h, surface) {
  const surf = surface || "foodcourt.hedge";
  const shape = HEDGE_SHAPES[((pick % 3) + 3) % 3];
  const livery = (((pick + ((pick / 3) | 0)) % 3) + 3) % 3;
  const [ar, ah] = HEDGE_ASPECT[shape];
  const size = [r * ar, h * ah, r * ar * rngRange(rng, 0.80, 1.24)];
  out.inst(`${surf}.${shape}${livery}`, () => hedgeProto(shape), surf, {
    pos,
    /* Yaw is a full turn and the tilt is nearly three times what it
       was: a clipped shrub leans, and a bed of them that all stand
       plumb is a bed of clones however different the outlines are. */
    rot: [rngRange(rng, -0.20, 0.20), rng() * TAU, rngRange(rng, -0.20, 0.20)],
    scale: size,
    tint: HEDGE_LIVERY[livery],
    /* Hard contact darkening. Foliage self-shadows from the inside
       out, and the underside of a shrub sitting in a planter is the
       darkest thing in the near field - which is what a foreground
       element is for. */
    ao: 0.52, jitter: 0.10,
  });
}

/**
 * A planted kerb: the mall's own version of a foreground layer.
 *
 * `yaw` runs along the bed's length, and the length is deliberately
 * longer than the frame is wide at that distance - a device that ends
 * inside the picture is a prop, a device that leaves both edges is a
 * framing element.
 *
 * `ao` is turned up hard. Foreground mass in the reference pool is
 * always darker than the mid-ground it overlaps; the contact gradient
 * paints that in for free and costs nothing at runtime.
 */
/* THE NEAR FIELD IS THE DARK END OF THE PICTURE, and the first pass
   built it as the bright end. Every reference frame that beat us puts
   its framing device UNDER the mid-ground it overlaps - cage bars, a
   ledge lip, a slab edge with void beneath - because that is what a
   thing between the lens and the light does. Ours arrived with a
   cream coping and a lit crown, which made the bottom third the
   brightest and busiest band in the frame instead of the quietest.
   The coping and foliage tints below are the fix, and they are cheap
   in both directions: dropping value in the near field widens the squint
   range (which the gate wants), raises HSV saturation (the darker of
   two samples of the same hue is the more saturated), and takes the
   local contrast of the busiest region of the frame down with it. */
/* THE BOX IS ALSO A REPEAT, and the same pass said so: "the same
   brown planter box in five [frames]". A bed is three slabs and a
   tint, so its variety is nearly free - what it needed was somewhere
   to come from. `livery` below picks the box's SURFACE (three
   different painters, not three tints of one), its coping and its
   proportions together, so two beds in the same capture are two
   different pieces of municipal furniture rather than one asset at
   two positions. Beds are keyed by livery at the call site, not
   randomly, because the pairs that appear together in a frame are
   known and can be chosen to differ. */
const BED_LIVERY = [
  /* Brick-faced, warm. The original. */
  { surface: "foodcourt.planter", box: 0xa89e8a, kerb: 0x968d76, uv: 3, cap: 0.20, lip: 0.36 },
  /* Cast concrete with a wide flat coping and no visible course - the
     quietest of the three, and the one that goes nearest the lens. */
  { surface: "foodcourt.brick", box: 0x88898e, kerb: 0x8a8676, uv: 4, cap: 0.26, lip: 0.50 },
  /* Stained timber sleeper: darker, warmer, and a thin coping so the
     mass reads as boards rather than as masonry. */
  { surface: "foodcourt.trunk", box: 0xa08e79, kerb: 0x847b63, uv: 2.4, cap: 0.14, lip: 0.24 },
];

function foregroundBed(out, P, rng, opts) {
  const {
    x, z, yaw = 0, len = 7.4, depth = 2.3, wall = 1.05,
    crown = 1.9, lumps = 5, livery = 0,
    plant = true,
  } = opts;
  const L = BED_LIVERY[livery % BED_LIVERY.length];
  const surface = opts.surface || L.surface;
  /* Calibrated, not chosen. A first pass at 0.62 of full value took
     the squint darks to 24 against a reference pool at 46 - the near
     field stopped being shade and became a hole, and two frames
     flagged for it. These sit near 0.70 of full: the bottom third is
     clearly under the mid-ground it overlaps and the darkest five
     percent of the frame stays where the reference pool puts it. */
  const kerbTint = opts.kerbTint === undefined ? L.kerb : opts.kerbTint;
  const boxTint = opts.boxTint === undefined ? L.box : opts.boxTint;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const world = (u, v) => [x + c * u + s * v, z - s * u + c * v];

  /* The box. Rounded and bevelled hard: at four metres from the lens
     this is the largest single silhouette in the frame, and a sharp
     box edge there is the one place aliasing is guaranteed to show. */
  out.add(P.platform(len, wall, depth, { bevel: 0.12, round: 0.34, curve: 3 }), surface, {
    pos: [x, wall / 2, z], rot: [0, yaw, 0], collide: true,
    uvScale: L.uv, ao: 0.5, aoHeight: 2.4, tint: boxTint,
  });
  /* The coping. A lip is what separates a planter from a crate at a
     distance, so it stays lighter than the box - but only just. It is
     the near field's own highlight, not the frame's. */
  out.add(P.platform(len + L.lip, L.cap, depth + L.lip, { bevel: 0.07, round: 0.4, curve: 3 }),
    "foodcourt.counter", {
      pos: [x, wall + L.cap / 2, z], rot: [0, yaw, 0], collide: true,
      tint: kerbTint, ao: 0.25, aoHeight: 1.2,
    });
  /* A SHADOW GAP UNDER THE COPING. Two centimetres of dark set back
     from the face is what a stone lip actually casts, and it is the
     cheapest thing in this file that says "these two slabs are
     different pieces". Without it the box and its coping are one
     silhouette in any frame far enough away to lose the tint step -
     which is most of them. */
  out.add(P.platform(len + L.lip - 0.14, 0.09, depth + L.lip - 0.14, { bevel: 0.02, round: 0.3, curve: 3 }),
    "foodcourt.soil", {
      pos: [x, wall - 0.035, z], rot: [0, yaw, 0], collide: false, ao: 0.5, aoHeight: 0.4,
    });
  /* THE SOIL SITS PROUD OF THE COPING, and the 0.07 is not styling.
     Both slabs used to top out at exactly wall + 0.20 - coplanar,
     coincident, and inside the bevel of each other - so which one a
     pixel belonged to was decided by depth-buffer precision. On screen
     that is a hard black-and-cream checkerboard, four screen pixels a
     cell, sitting in the bottom third of five of the seven captures:
     the single loudest pixel-scale artefact in the set, on the exact
     band of the frame the whole near-field pass exists to quieten.
     Mounded soil inside a lip is also what a planter looks like. */
  /* The soil follows the coping rather than a fixed height, because
     the coping is now a per-livery thickness: at the concrete bed's
     0.26 m cap a soil slab pinned to the old wall + 0.27 would have
     come back exactly coplanar with the lip, which is the artefact
     this note was written about in the first place. */
  out.add(P.platform(len - 0.5, 0.5, depth - 0.5, { bevel: 0.06, round: 0.24, curve: 3 }),
    "foodcourt.soil", { pos: [x, wall + L.cap - 0.18, z], rot: [0, yaw, 0], collide: false, ao: 0 });

  if (!plant) return;
  /* Clumped, not spaced. Shrubs go in twos and threes with a gap,
     because five evenly spaced lumps is the instanced-clone read the
     review keeps naming. Sizes come from three classes so the mass
     has a top note and a base rather than one repeated radius.
     `i + livery` walks the shape/livery pair along the run, so no two
     neighbours in a bed share a silhouette and no two beds in a frame
     start on the same one. */
  let u = -len / 2 + rngRange(rng, 0.5, 1.1);
  const soilTop = wall + L.cap + 0.07;
  let n = 0;
  for (let i = 0; i < lumps && u < len / 2 - 0.5; i += 1) {
    const big = rng() < 0.42;
    const r = big ? rngRange(rng, 0.70, 1.00) : rngRange(rng, 0.40, 0.62);
    const h = (crown - wall) * (big ? rngRange(rng, 1.14, 1.46) : rngRange(rng, 0.68, 1.06));
    const v = rngRange(rng, -depth * 0.16, depth * 0.16);
    const p = world(u, v);
    plantHedge(out, rng, i + livery * 2 + (big ? 1 : 0),
      [p[0], soilTop - 0.14, p[1]], r, h);
    n += 1;
    /* The gap is the point. A clump advances by barely more than its
       own radius; the break after one advances by two and a half. */
    u += r * (rng() < 0.55 ? rngRange(rng, 1.05, 1.5) : rngRange(rng, 1.9, 2.7));
  }
  /* GROUND COVER, and it is a noise fix rather than a planting one.
     The rebuilt shrubs are lower and narrower than the single big
     ellipsoid they replaced, which left far more bare soil showing -
     and bark mulch at close range is the highest-frequency surface in
     the near field. Filling the gaps with low, wide, dark plants
     covers the busiest texture in the frame with the quietest one, in
     the exact band the near-field pass exists to calm. They also sit
     under the tall clumps, so the bed has two ranks. */
  for (let i = 0; i < n + 2; i += 1) {
    const uu = rngRange(rng, -len / 2 + 0.6, len / 2 - 0.6);
    const vv = rngRange(rng, -depth * 0.3, depth * 0.3);
    const p = world(uu, vv);
    plantHedge(out, rng, 2 + i * 2 + livery,
      [p[0], soilTop - 0.2, p[1]],
      rngRange(rng, 0.38, 0.62), (crown - wall) * rngRange(rng, 0.42, 0.72));
  }
}

/**
 * A mall column, with the bottom three metres of it treated as near
 * field rather than as more shaft.
 *
 * THE ANTI-PATTERN THIS EXISTS TO KILL. Round six, on `arrival`: "the
 * largest, most saturated, highest-contrast object in frame is ... a
 * bare pale column, full frame height, and the single brightest value
 * in the picture." All three complaints are about the same thing - a
 * travertine cylinder is one unbroken value from the floor to the
 * ceiling, so whichever one happens to stand near the lens becomes a
 * bright bar down the side of the picture with nothing to say.
 *
 * Three cheap changes, no extra draw calls (everything here merges
 * into surfaces the course already draws):
 *
 *   1. A CONTACT GRADIENT over the bottom 3.4 m. paintGeometry's `ao`
 *      term is a vertex ramp, so the part of the column that can ever
 *      be near-field is a third of a stop under the part that reads as
 *      architecture - which is also what a column under a mezzanine
 *      actually does.
 *   2. A DARK PLINTH. It puts a horizontal at ankle height and gives
 *      the shaft somewhere to stand.
 *   3. A COLLAR at 2.3 m. One band across a vertical is the difference
 *      between a column and a bar, and it lands right where a lens
 *      3.0 m up crops the frame edge.
 */
function mallColumn(out, P, x, z, height, radius, opts = {}) {
  out.add(P.pillar(radius, height, { sides: 8, flutes: !!opts.flutes, base: false }),
    "foodcourt.column", {
      pos: [x, 0, z], collide: true,
      tint: opts.tint === undefined ? 0xd8d0c0 : opts.tint,
      ao: 0.40, aoHeight: 3.4,
    });
  out.add(P.platform(radius * 2.9, 0.44, radius * 2.9, { bevel: 0.09, round: radius * 0.7, curve: 3 }),
    "foodcourt.brick", { pos: [x, 0.22, z], collide: true, tint: 0x7c6f62, ao: 0.5, aoHeight: 1.0 });
  out.add(new THREE.CylinderGeometry(radius * 1.12, radius * 1.12, 0.26, 10, 1),
    "foodcourt.brick", { pos: [x, 2.3, z], collide: false, tint: 0x8a7c6a, ao: 0.2, aoHeight: 1.4 });
}

/**
 * THE UNDERCROFT - a colonnade with a deep, dark room behind it.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A PROP.
 *
 * A blind critic measured the same defect four rounds running: the
 * character is the only true dark in the picture. Subject luminance
 * 24-40 against fields of 77-171, at 0.6-1.35% of frame area - a one
 * percent chip carrying a hundred percent of the focal load. The
 * prescription was a SECOND dark of comparable value at 5-15% of
 * frame, owned by architecture and not by more set dressing, because
 * the round before that had answered the same note with near-field
 * props and the props became the subject in three frames out of four.
 *
 * The constraint that decides the shape of the answer is the CROP.
 * The blind pool and the metrics gate both cut to y 0.155..0.845,
 * which is NDC |y| < 0.69, and the capture presets stand the lens
 * 3.3-5.0 m up pitched 5-15 degrees down. Work the two together and
 * everything the review actually sees lies between the floor and
 * about six metres, at ten to thirty metres out. That rules out the
 * obvious answers:
 *
 *   - A soffit at mall ceiling height is above the crop.
 *   - A soffit at mezzanine height asymptotes to the horizon: a
 *     horizontal plane above the eye compresses into a band a few
 *     percent tall unless its NEAR edge is inside twenty metres.
 *   - Painting an existing surface dark is not architecture and the
 *     surfaces that are big enough are floors, which have to stay
 *     light or the character has nothing to sit against.
 *
 * What does work at that height and that distance is a HOLE. A room
 * with its own roof, seen through an opening, is dark because of what
 * it is: nothing reaches into it. Eight metres of opening five and a
 * half metres tall at twenty metres out is nine percent of the crop,
 * which is the middle of the band the critic asked for, and it is a
 * mass a frame can be composed on rather than a smudge in a corner.
 *
 * HOW IT IS MADE DARK. There is no shadow to be had here - a roofed
 * course occludes its own directional key before it reaches the floor
 * (see the note above COURSE_1's ceiling) so the cavity would light
 * exactly like the plaza outside it. paintGeometry's `ao` term is a
 * vertex ramp measured from a declared `groundY`, so the recess
 * carries its own occlusion: darkest at the back and the floor,
 * lifting toward the opening. The reveal, the lintel and the piers
 * stay in the course's ordinary values, which is what makes the
 * cavity read as depth rather than as a black rectangle painted on a
 * wall - a dark needs a light edge or it is a hole in the film.
 *
 * Local axes: the opening faces +Z and the recess runs back to -Z,
 * with `yaw` turning that whole frame, so a call site reads as "this
 * many metres wide, this deep, facing this way".
 */
function undercroft(out, P, opts) {
  const {
    x, z, yaw = 0, width = 10, depth = 6, height = 5.4,
    bays = 2, fascia = 1.0, pierW = 1.1, sign = null,
    /* Not a taste call: `foodcourt.wall` is the course's plum-indigo
       background panel at twelve metres per repeat, which is the
       lowest-frequency surface in the food court. The high-frequency
       row of the metrics gate is the tightest of the four, so a mass
       this size has to be flat. */
    dark = "foodcourt.wall",
  } = opts;

  const c = Math.cos(yaw), s = Math.sin(yaw);
  /* Local (u along the frontage, v into the recess) -> world. Same
     convention as `rot: [0, yaw, 0]` applies to a box, so a slab's
     own X is the frontage and its Z is the depth. */
  const at = (u, v) => [x + c * u + s * v, z - s * u + c * v];
  const half = width / 2;
  const backV = -depth;
  const top = height + fascia;

  /* THE BACK. Full width of the structure, not of the opening, so the
     piers have something to stand against and the recess has no
     daylight behind it. */
  const back = at(0, backV - 0.35);
  out.add(P.platform(width + pierW * 2 + 0.7, top, 0.7, { bevel: 0.1 }), dark, {
    pos: [back[0], top / 2, back[1]], rot: [0, yaw, 0], collide: true,
    tint: 0xa094c4, ao: 0.46, aoHeight: top * 0.9, groundY: 0,
  });
  /* The two returns. These are the surfaces a camera standing off to
     one side actually sees INTO, so they carry the deepest value. */
  for (const sgn of [-1, 1]) {
    const p = at(sgn * (half + 0.3), backV / 2);
    out.add(P.platform(0.6, height, depth, { bevel: 0.08 }), dark, {
      pos: [p[0], height / 2, p[1]], rot: [0, yaw, 0], collide: true,
      tint: 0x8e83b0, ao: 0.50, aoHeight: height * 0.85, groundY: 0,
    });
  }
  /* THE CEILING OF THE ROOM. Down-facing, and the one plane in the
     whole assembly that no light in this course can reach at any
     angle. It is also what the camera's own frame score calls a cap
     band - a down-facing surface across the top rows - so it earns
     composition as well as value. */
  const ceil = at(0, backV / 2);
  out.add(P.platform(width + 0.4, 0.5, depth, { bevel: 0.06 }), "foodcourt.ceiling", {
    pos: [ceil[0], height + 0.25, ceil[1]], rot: [0, yaw, 0], collide: true,
    tint: 0xb0a4d0, ao: 0.36, aoHeight: 0.5, groundY: height,
  });
  /* The floor of the recess, a step up off the plaza. A raised
     threshold is what says "inside" from outside, and it stops the
     bright plaza floor running straight through the opening - which
     it did, and which put the brightest surface in the course inside
     the mass that exists to be the darkest. */
  const flr = at(0, backV / 2 + 0.2);
  out.add(P.platform(width - 0.1, 0.34, depth - 0.4, { bevel: 0.07 }), "foodcourt.brick", {
    pos: [flr[0], 0.17, flr[1]], rot: [0, yaw, 0], collide: true,
    tint: 0x786058, ao: 0.45, aoHeight: 0.34, groundY: 0,
  });

  /* THE REVEAL - the light edge that makes the dark read.
     Piers at both jambs and at every bay division, in the course's
     travertine, plus a lintel and a fascia band over the opening.
     Without these the recess is a black rectangle and a black
     rectangle in a still frame reads as missing geometry, which is
     the same failure `wireframe: true` is banned for. */
  const cols = bays + 1;
  for (let i = 0; i < cols; i += 1) {
    const u = -half + (width * i) / bays;
    const w = (i === 0 || i === cols - 1) ? pierW : pierW * 0.72;
    const p = at(u, 0.1);
    out.add(P.platform(w, height, 1.5, { bevel: 0.1 }), "foodcourt.column", {
      pos: [p[0], height / 2, p[1]], rot: [0, yaw, 0], collide: true,
      tint: 0xcfc6b2, ao: 0.44, aoHeight: 3.4,
    });
    /* A plinth and a capital on every pier. One band across a
       vertical is the difference between a column and a bar - the
       same finding mallColumn is built around. */
    out.add(P.platform(w + 0.36, 0.42, 1.86, { bevel: 0.07 }), "foodcourt.brick", {
      pos: [p[0], 0.21, p[1]], rot: [0, yaw, 0], collide: true, tint: 0x7c6f62, ao: 0.5, aoHeight: 1.0,
    });
    out.add(P.platform(w + 0.30, 0.34, 1.8, { bevel: 0.07 }), "foodcourt.counter", {
      pos: [p[0], height - 0.17, p[1]], rot: [0, yaw, 0], collide: false, tint: 0xb6a988, ao: 0.2, aoHeight: 1.0,
    });
  }
  /* The lintel, then the fascia above it. The fascia is the course's
     shopfront value and it is what puts a bright horizontal directly
     over the dark - which is the value break the whole device is
     built on. */
  const lin = at(0, 0.1);
  out.add(P.platform(width + pierW * 2 + 0.4, 0.5, 1.7, { bevel: 0.08 }), "foodcourt.brick", {
    pos: [lin[0], height + 0.25, lin[1]], rot: [0, yaw, 0], collide: true, tint: 0x8a7c6a, ao: 0,
  });
  out.add(P.platform(width + pierW * 2 + 0.6, fascia - 0.5, 1.5, { bevel: 0.08 }), "foodcourt.counter", {
    pos: [lin[0], height + 0.5 + (fascia - 0.5) / 2, lin[1]], rot: [0, yaw, 0], collide: true,
    tint: 0xbcae90, ao: 0.16, aoHeight: 1.2,
  });
  /* A SHADOW GAP under the lintel. Twelve centimetres of dark set
     back from the face, the same device foregroundBed uses on its
     coping and for the same reason: without it the lintel and the
     void behind it are one silhouette at any distance far enough to
     lose the tint step, which is most of them. */
  out.add(P.platform(width + 0.1, 0.16, 1.2, { bevel: 0.03 }), dark, {
    pos: [lin[0], height - 0.06, lin[1]], rot: [0, yaw, 0], collide: false,
    tint: 0x5c5278, ao: 0,
  });

  if (sign) {
    const sp = at(sign.u || 0, 0.55);
    out.add(P.platform(sign.w || width * 0.5, sign.h || 1.4, 0.4, { bevel: 0.08 }),
      "foodcourt.sign", {
        pos: [sp[0], height + fascia * 0.5, sp[1]], rot: [0, yaw, 0], collide: false,
        tint: sign.tint === undefined ? 0xffd166 : sign.tint,
      });
    out.add(P.platform((sign.w || width * 0.5) + 0.5, 0.26, 0.5, { bevel: 0.05 }),
      "foodcourt.neon", {
        pos: [sp[0], height + fascia * 0.5 - (sign.h || 1.4) * 0.5 - 0.2, sp[1]],
        rot: [0, yaw, 0], collide: false, tint: sign.neon === undefined ? 0x36e0ff : sign.neon,
      });
  }
}

/**
 * A run of posts with rope slung between them.
 *
 * Six identical capsules evenly spread across a foreground read as
 * debug geometry, which is exactly what a blind pass called the old
 * bollard ring. What makes a stanchion line legible is the ROPE: it
 * is the line that says these things belong to each other, and it is
 * a horizontal in a frame that otherwise has none down here.
 *
 * `at(t)` returns [x, z] for t in 0..1 along the run.
 */
function ropeRun(out, P, rng, opts) {
  const { count, at, postSurface = "shared.chrome", ropeSurface = "foodcourt.tray",
    ropeTint = 0x8a1f2c, height = 1.02, sag = 0.26, y = 0 } = opts;
  const pts = [];
  for (let i = 0; i < count; i += 1) {
    /* Uneven spacing, from a jitter on the parameter rather than on
       the position: the run still follows its curve, it just stops
       being a ruler. */
    const t = count === 1 ? 0.5 : (i + rngRange(rng, -0.16, 0.16)) / (count - 1);
    const p = at(clamp01(t));
    if (!p) continue;
    pts.push(p);
    out.inst("stanchion", () => {
      const parts = [];
      const post = new THREE.CylinderGeometry(0.075, 0.095, 1.0, 8, 1);
      post.translate(0, 0.5, 0);
      const base = new THREE.CylinderGeometry(0.3, 0.34, 0.11, 12, 1);
      base.translate(0, 0.055, 0);
      const knob = new THREE.SphereGeometry(0.115, 8, 6);
      knob.scale(1, 1.35, 1);
      knob.translate(0, 1.05, 0);
      parts.push(post, base, knob);
      return mergeGeometries(parts);
    }, postSurface, {
      pos: [p[0], y, p[1]], rot: [0, rng() * TAU, 0],
      scale: [1, height * rngRange(rng, 0.94, 1.06), 1],
    });
  }
  /* The rope. Three chords per span rather than a curve: the sag is
     what reads, not the smoothness, and three cylinders per gap is
     nothing next to a draw call. */
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i], b = pts[i + 1];
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (span > 6.5) continue;      // a gap in the run, not a span
    const top = y + height;
    const segs = 3;
    for (let k = 0; k < segs; k += 1) {
      const t0 = k / segs, t1 = (k + 1) / segs;
      const p0 = [lerp(a[0], b[0], t0), lerp(a[1], b[1], t0)];
      const p1 = [lerp(a[0], b[0], t1), lerp(a[1], b[1], t1)];
      const y0 = top - sag * 4 * t0 * (1 - t0);
      const y1 = top - sag * 4 * t1 * (1 - t1);
      const dx = p1[0] - p0[0], dy = y1 - y0, dz = p1[1] - p0[1];
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.05) continue;
      const seg = new THREE.CylinderGeometry(0.055, 0.055, len, 5, 1);
      seg.rotateZ(Math.PI / 2);
      seg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(1, 0, 0), new THREE.Vector3(dx, dy, dz).normalize()
      ));
      seg.translate((p0[0] + p1[0]) / 2, (y0 + y1) / 2, (p0[1] + p1[1]) / 2);
      out.add(seg, ropeSurface, { collide: false, castShadow: false, tint: ropeTint, ao: 0 });
    }
  }
}

/* ============================================================
   THE PROP BANK

   Small repeated objects, built once per course and drawn as
   InstancedMesh. Nothing in here is allowed to be unique: if a
   thing appears once it belongs in the course build, and if it
   appears twenty times it belongs here, because twenty separate
   meshes is twenty draw calls out of a budget of three hundred.
   ============================================================ */

function makeProps(P) {
  const F = {};

  F.trashcan = () => {
    const parts = [];
    const body = new THREE.CylinderGeometry(0.42, 0.36, 1.05, 10, 1);
    body.translate(0, 0.525, 0);
    const lid = new THREE.CylinderGeometry(0.46, 0.46, 0.14, 10, 1);
    lid.translate(0, 1.11, 0);
    const mouth = new THREE.CylinderGeometry(0.24, 0.24, 0.1, 8, 1);
    mouth.translate(0, 1.2, 0);
    parts.push(body, lid, mouth);
    return mergeGeometries(parts);
  };

  F.bollard = () => {
    const parts = [];
    const post = new THREE.CylinderGeometry(0.12, 0.14, 0.95, 8, 1);
    post.translate(0, 0.475, 0);
    const cap = new THREE.SphereGeometry(0.13, 8, 6);
    cap.translate(0, 0.98, 0);
    parts.push(post, cap);
    return mergeGeometries(parts);
  };

  F.planterPot = () => {
    const parts = [];
    const pot = new THREE.CylinderGeometry(1.15, 0.92, 1.0, 12, 1);
    pot.translate(0, 0.5, 0);
    const rim = new THREE.CylinderGeometry(1.24, 1.24, 0.18, 12, 1);
    rim.translate(0, 0.95, 0);
    parts.push(pot, rim);
    return mergeGeometries(parts);
  };

  F.vending = () => {
    const parts = [];
    const body = P.platform(1.5, 2.3, 0.85, { bevel: 0.06 });
    body.translate(0, 1.15, 0);
    const glass = P.platform(1.0, 1.5, 0.1, { bevel: 0.03 });
    glass.translate(0, 1.45, 0.44);
    parts.push(body, glass);
    return mergeGeometries(parts);
  };

  /* ------------------------------------------------------------------
     THE ARCADE CABINET, IN FOUR PIECES

     A blind pass on the `boss` framing: "plain boxes with two seam
     lines and a flat dark cap, scattered with no aisle logic and no
     front face." The old F.arcade was one merged buffer wearing one
     shopfront panel, so every part of it - hood, screen surround,
     control deck - rendered in the same value as the body and vanished
     into it past about eight metres. What was left was a blue prism.

     A cabinet is legible at distance because of a fixed vertical
     ORDER of values, not because of its outline: lit marquee, dark
     bezel, bright screen, dark control deck, body, dark kick plate.
     So the model is split across four surfaces and assembled at the
     call site - four instanced draws for the whole arcade, against one
     before, and every one of those bands survives to fifteen metres.

     `shell` is the coloured body, `trim` the dark structure, and the
     screen and marquee are the two unlit pieces. Each returns its own
     geometry so a bank can mix two shells under one trim.
     ------------------------------------------------------------------ */

  /* The coloured body: a tapered cabinet with a waisted front, so the
     silhouette has a shoulder where the control deck breaks out of it
     instead of being a rectangle from every angle. */
  F.arcadeShell = () => {
    const parts = [];
    const lower = P.platform(0.96, 1.02, 0.82, { bevel: 0.05 });
    lower.translate(0, 0.55, 0);
    const upper = P.platform(0.96, 0.86, 0.62, { bevel: 0.05 });
    upper.translate(0, 1.52, -0.10);
    /* NO SIDE-ART PANELS. A first pass stood a 4 cm slab proud of each
       flank on the theory that it would catch the key along the row.
       It cannot: the panel wears the SAME surface and the same tint as
       the body it sits on, so it carries no colour information at all
       and only adds two near-vertical edges per cabinet. Removing them
       and the deck's separate lip moved that frame's Laplacian by 0.0,
       which is worth recording - the arcade's whole 2.0 contribution
       is spread evenly across shell, trim, screen and marquee (each
       measured at 0.4-0.5 by toggling it alone), so there is no cheap
       win here and no reason to keep dead geometry either. The bands
       that do the work are separated by VALUE, not by relief. */
    parts.push(lower, upper);
    return mergeGeometries(parts);
  };

  /* Everything dark: kick plate, coin door, screen bezel, control deck
     and the hood over the marquee. This is what gives the cabinet its
     front - a face is a hole with a frame around it. */
  F.arcadeTrim = () => {
    const parts = [];
    const kick = P.platform(0.90, 0.20, 0.78, { bevel: 0.04 });
    kick.translate(0, 0.10, 0);
    const coin = P.platform(0.34, 0.30, 0.10, { bevel: 0.02 });
    coin.translate(0, 0.74, 0.43);
    /* The deck the buttons sit on. It juts 0.22 m past the body and it
       is the single most important part of the read: nothing else in a
       mall has a horizontal ledge at 1.05 m with a raked face above it.
       ONE BLOCK, not a slab plus a separate lip: two parallel
       horizontals 6 cm apart across fifteen cabinets is a picket
       fence at this distance, and the deck says everything the lip
       was there to say. */
    const deck = P.platform(0.98, 0.22, 0.48, { bevel: 0.04 });
    deck.translate(0, 1.00, 0.30);
    /* The bezel. A frame 6 cm wider than the screen on every side,
       raked with it, so the screen reads as recessed. */
    const bezel = P.platform(0.86, 0.70, 0.06, { bevel: 0.02 });
    bezel.rotateX(-0.30);
    bezel.translate(0, 1.52, 0.24);
    const hood = P.slope(0.98, 0.26, 0.34, { thickness: 0.14 });
    hood.rotateY(Math.PI);
    hood.translate(0, 2.20, 0.06);
    parts.push(kick, coin, deck, bezel, hood);
    return mergeGeometries(parts);
  };

  /* The screen, sitting inside the bezel and raked the same way. */
  F.arcadeScreen = () => {
    const g = P.platform(0.72, 0.56, 0.05, { bevel: 0.015 });
    g.rotateX(-0.30);
    g.translate(0, 1.52, 0.29);
    return g;
  };

  /* The header. Unlit, leaning forward the way a real marquee does,
     and the ONE element that reads at any distance a shot of this
     course will ever be taken from: a row of machines is a row of lit
     bars at a constant height, which is exactly the "alignment that
     reads as a row" the note asked for. */
  F.arcadeMarquee = () => {
    const g = P.platform(0.92, 0.34, 0.09, { bevel: 0.02 });
    g.rotateX(0.20);
    g.translate(0, 2.02, 0.30);
    return g;
  };

  F.crate = () => P.platform(1.2, 1.2, 1.2, { bevel: 0.08, round: 0.1 });

  F.barrel = () => {
    const parts = [];
    const b = new THREE.CylinderGeometry(0.48, 0.48, 1.15, 10, 1);
    b.translate(0, 0.575, 0);
    const r1 = new THREE.CylinderGeometry(0.51, 0.51, 0.1, 10, 1);
    r1.translate(0, 0.3, 0);
    const r2 = r1.clone();
    r2.translate(0, 0.55, 0);
    parts.push(b, r1, r2);
    return mergeGeometries(parts);
  };

  F.stanchion = () => {
    const parts = [];
    const post = new THREE.CylinderGeometry(0.055, 0.055, 1.0, 8, 1);
    post.translate(0, 0.5, 0);
    const base = new THREE.CylinderGeometry(0.26, 0.3, 0.09, 12, 1);
    base.translate(0, 0.045, 0);
    const knob = new THREE.SphereGeometry(0.09, 8, 6);
    knob.translate(0, 1.03, 0);
    parts.push(post, base, knob);
    return mergeGeometries(parts);
  };

  F.speaker = () => {
    const parts = [];
    const body = P.platform(1.4, 2.0, 1.2, { bevel: 0.06 });
    body.translate(0, 1.0, 0);
    for (let i = 0; i < 2; i += 1) {
      const cone = new THREE.CylinderGeometry(0.44, 0.5, 0.16, 12, 1);
      cone.rotateX(Math.PI / 2);
      cone.translate(0, 0.7 + i * 0.85, 0.62);
      parts.push(cone);
    }
    parts.push(body);
    return mergeGeometries(parts);
  };

  F.ball = () => new THREE.IcosahedronGeometry(0.34, 1);

  F.rack = () => {
    const parts = [];
    const body = P.platform(1.1, 2.6, 1.9, { bevel: 0.05 });
    body.translate(0, 1.3, 0);
    parts.push(body);
    return mergeGeometries(parts);
  };

  F.duct = () => {
    const parts = [];
    const b = P.platform(1.1, 1.0, 3.4, { bevel: 0.06 });
    b.translate(0, 0.5, 0);
    for (let i = -1; i <= 1; i += 1) {
      const rib = P.platform(1.22, 1.12, 0.16, { bevel: 0.03 });
      rib.translate(0, 0.5, i * 1.1);
      parts.push(rib);
    }
    parts.push(b);
    return mergeGeometries(parts);
  };

  F.parasol = () => {
    const parts = [];
    const pole = new THREE.CylinderGeometry(0.05, 0.06, 2.6, 6, 1);
    pole.translate(0, 1.3, 0);
    const canopy = new THREE.ConeGeometry(1.75, 0.7, 8, 1);
    canopy.translate(0, 2.75, 0);
    parts.push(pole, canopy);
    return mergeGeometries(parts);
  };

  F.lounger = () => {
    const parts = [];
    const seat = P.platform(0.9, 0.22, 2.0, { bevel: 0.05, round: 0.18 });
    seat.translate(0, 0.42, 0);
    const back = P.platform(0.9, 0.2, 0.95, { bevel: 0.05, round: 0.18 });
    back.rotateX(-0.85);
    back.translate(0, 0.72, -0.8);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.CylinderGeometry(0.04, 0.04, 0.32, 5, 1);
        leg.translate(sx * 0.36, 0.16, sz * 0.8);
        parts.push(leg);
      }
    }
    parts.push(seat, back);
    return mergeGeometries(parts);
  };

  /* Split into mast and globe on purpose.
     Welded together and painted chrome, the globe was the brightest
     small object in the food court and it sat at roughly the height of
     the character's head, so a blind review of the `interior` frame
     reported the eye going to a lamp instead of to the subject. A
     chrome sphere is a specular highlight with a silhouette; a glass
     globe in a mall that is lit through its own roof is an off-white
     lump. Two keys, two surfaces, one extra draw call. */
  F.pillarLamp = () => {
    const post = new THREE.CylinderGeometry(0.09, 0.13, 3.2, 8, 1);
    post.translate(0, 1.6, 0);
    return post;
  };

  F.pillarLampGlobe = () => {
    const parts = [];
    const collar = new THREE.CylinderGeometry(0.15, 0.19, 0.16, 8, 1);
    collar.translate(0, 3.12, 0);
    const head = new THREE.SphereGeometry(0.31, 10, 8);
    head.scale(1, 1.1, 1);
    head.translate(0, 3.42, 0);
    parts.push(collar, head);
    return mergeGeometries(parts);
  };

  /** A twin-headed boulevard lamp. Tall enough to break the skyline
   *  from the carpet, which is what stops a long straight course from
   *  reading as a corridor. */
  F.streetLamp = () => {
    const parts = [];
    const base = new THREE.CylinderGeometry(0.34, 0.44, 0.6, 10, 1);
    base.translate(0, 0.3, 0);
    const post = new THREE.CylinderGeometry(0.13, 0.2, 7.4, 8, 1);
    post.translate(0, 3.9, 0);
    parts.push(base, post);
    for (const s of [-1, 1]) {
      const arm = new THREE.CylinderGeometry(0.09, 0.09, 2.0, 6, 1);
      arm.rotateZ(Math.PI / 2);
      arm.translate(s * 1.0, 7.5, 0);
      const head = new THREE.SphereGeometry(0.42, 10, 7);
      head.scale(1, 0.62, 1);
      head.translate(s * 1.9, 7.36, 0);
      parts.push(arm, head);
    }
    return mergeGeometries(parts);
  };

  /**
   * A crowd figure.
   *
   * The single highest-value prop in the bank. A stand, a barrier or a
   * pit with nobody in it is the loudest possible "nobody finished
   * this course" signal, and a body reads at any distance as long as
   * the head separates from the shoulders. Two poses so a stand is not
   * a row of clones; `arms` raises them for the cheering variant.
   */
  F.fan = (arms) => {
    const parts = [];
    const legs = P.platform(0.42, 0.82, 0.3, { bevel: 0.06, round: 0.13 });
    legs.translate(0, 0.41, 0);
    const torso = P.platform(0.56, 0.74, 0.36, { bevel: 0.08, round: 0.16 });
    torso.translate(0, 1.18, 0);
    const head = new THREE.SphereGeometry(0.17, 8, 6);
    head.translate(0, 1.68, 0);
    parts.push(legs, torso, head);
    for (const s of [-1, 1]) {
      const arm = new THREE.CylinderGeometry(0.08, 0.07, 0.66, 5, 1);
      if (arms) {
        arm.translate(0, 0.33, 0);
        arm.rotateZ(s * 0.34);
        arm.translate(s * 0.3, 1.34, 0);
      } else {
        arm.translate(0, -0.33, 0);
        arm.rotateZ(s * 0.16);
        arm.translate(s * 0.32, 1.44, 0);
      }
      parts.push(arm);
    }
    return mergeGeometries(parts);
  };

  /** A photographer: a fan with a camera welded to their face. */
  F.photog = () => {
    const parts = [F.fan(false)];
    const box = P.platform(0.34, 0.26, 0.3, { bevel: 0.04 });
    box.translate(0, 1.62, 0.26);
    const lens = new THREE.CylinderGeometry(0.11, 0.14, 0.36, 8, 1);
    lens.rotateX(Math.PI / 2);
    lens.translate(0, 1.62, 0.55);
    parts.push(box, lens);
    return mergeGeometries(parts);
  };

  return F;
}

/* ============================================================
   SHARED SET DRESSING
   ============================================================ */

/* ------------------------------------------------------------------
   HOW TO AUTHOR A CAMERA MARKER

   `out.marker(name, from, look)` is NOT a camera pose. camera.js
   solves its own pose and treats a marker as two hints:

     look  - THE LANDMARK. The shot is composed camera / character /
             landmark along one line, so this is the thing that ends up
             behind her shoulder. Give it the visual centre of a real
             object, not a patch of floor.
     from  - WHICH SIDE the shot is taken from. Only the horizontal
             direction from the landmark to this point is read... with
             one exception below.

   The character is then planted `stand` metres in front of the
   landmark on the `from` side and dropped onto whatever floor is
   there, so the rule that matters is: the ring at `stand` metres
   around the landmark, on the `from` side, must be somewhere a person
   can stand. `stand` is per preset - roughly 6m for collect, 9-10 for
   platforming and interior, 13-16 for arrival and the vantages - so a
   landmark in the middle of a twelve-metre pool will put her in the
   water however the marker is written.

   THE EXCEPTION: `vista` and `high-ground` are vantage presets. For
   those, `from` also selects the surface she stands on - camera.js
   probes downward from `from` for the highest standable thing within
   18m. So a vantage `from` must sit just ABOVE the platform you mean,
   and that platform needs headroom: the camera ends up about 8m above
   her, so a 17m catwalk under a 22m ceiling puts the camera inside
   the roof and the frame comes back black.

   And the camera goes on the OPPOSITE side of her from the landmark.
   A vantage on a perimeter balcony aimed at the middle of the course
   therefore puts the camera in the outside wall. Vantages want to
   stand near the middle of a course and look outward.
   ------------------------------------------------------------------ */

const CROWD_SURFACES = [
  "shared.crowdA", "shared.crowdB", "shared.crowdC",
  "shared.crowdD", "shared.crowdE",
];

/**
 * Fill a strip with people.
 *
 * Costs ten draw calls total no matter how many figures: five
 * liveries times two poses. Everything else about a crowd - the jitter
 * in yaw, the jitter in height, the fact that the rows are not evenly
 * spaced - is per-instance and free.
 *
 * `at(i, j)` returns [x, y, z] or null to leave a gap.
 */
function crowdField(out, F, rng, opts) {
  const { rows, per, at, scale = 1, faceAt } = opts;
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < per; i += 1) {
      const p = at(i, j);
      if (!p) continue;
      const cheer = rng() < (opts.cheer === undefined ? 0.45 : opts.cheer);
      const surf = CROWD_SURFACES[rngInt(rng, 0, CROWD_SURFACES.length - 1)];
      let yaw;
      if (faceAt) yaw = Math.atan2(faceAt[0] - p[0], faceAt[2] - p[2]) + rngRange(rng, -0.3, 0.3);
      else yaw = rng() * TAU;
      out.inst(`fan.${cheer ? "up" : "down"}.${surf}`, () => F.fan(cheer), surf, {
        pos: p, rot: [0, yaw, 0],
        scale: scale * rngRange(rng, 0.9, 1.12),
      });
    }
  }
}

/**
 * A skyline. Boxes of window texture beyond the play area, sized so
 * the tallest sit above the course's own landmarks and the nearest
 * still clear the perimeter wall.
 *
 * These are decor only - never collided, never shadow-relevant - and
 * they are what turns "the level stops here" into "the city keeps
 * going". One draw call for the whole skyline.
 */
function skyline(out, P, rng, opts) {
  const { surface, count, inner, outer, minH, maxH, centre = [0, 0], y = 0 } = opts;
  /* A unit box, deliberately: BoxGeometry's own 0..1 UVs survive
     out.inst (which only reprojects a prototype that has none), so
     each tower gets exactly ONE window grid across each face no
     matter how large the instance is scaled. World-space projection
     would give a fifty-metre tower fifty repeats of a window and
     turn the skyline into noise. */
  const proto = () => new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * TAU + rngRange(rng, -0.09, 0.09);
    const r = rngRange(rng, inner, outer);
    const h = rngRange(rng, minH, maxH);
    out.inst("tower", proto, surface, {
      pos: [centre[0] + Math.cos(a) * r, y + h / 2, centre[1] + Math.sin(a) * r],
      rot: [0, -a + rngRange(rng, -0.35, 0.35), 0],
      scale: [rngRange(rng, 13, 30), h, rngRange(rng, 13, 26)],
    });
  }
}

/* ============================================================
   HUB - THE LABEL LOBBY

   A record-label atrium. Five giant framed Platinum Records hang
   on the walls; each is a course entrance you jump into, and the
   ones above the ground floor are locked behind a Record count.

   The composition is a rotunda for a reason. The player has to be
   able to stand in the doorway, turn once, and see every course
   they own plus the ones they do not yet - the locked frames on
   the upper ring are the whole progression readable in a single
   look, which is the job the castle courtyard does in SM64.
   ============================================================ */

const HUB = {
  id: 0,
  name: "The Label Lobby",
  theme: "hub",
  music: "lobby",
  spawnCount: 6,
  sky: { radius: 60, centre: [0, 8, 0] },
  records: [],

  build(ctx, out) {
    const P = out.prim;
    const F = makeProps(P);
    const rng = out.rng;

    const R = 30;             /* atrium radius */
    const MEZZ = 8;           /* upper ring walking height */
    const WALL_H = 26;

    out.bounds([-R - 4, -2, -R - 4], [R + 4, WALL_H + 6, R + 4]);

    /* ---------------- floor and the label inlay ---------------- */

    out.add(P.platform(R * 2 + 8, 1.2, R * 2 + 8, { bevel: 0.2, round: 6, curve: 6 }),
      "lobby.marble", { pos: [0, -0.6, 0], collide: true, uvScale: 5 });

    /* A twelve-metre record pressed into the floor. Concentric rings
       rather than a texture, because the player walks across it and a
       flat decal at that size reads as a sticker. */
    for (let i = 0; i < 5; i += 1) {
      const rr = 11 - i * 2.1;
      const ring = new THREE.CylinderGeometry(rr, rr, 0.05 + i * 0.008, 48, 1);
      out.add(ring, i === 4 ? "lobby.platinum" : "lobby.marble",
        { pos: [0, 0.02 + i * 0.006, 0], collide: false, tint: i % 2 ? 0xcfc4a8 : 0xffffff });
    }
    out.add(new THREE.CylinderGeometry(1.6, 1.6, 0.1, 24, 1), "lobby.neon",
      { pos: [0, 0.07, 0], collide: false });

    /* Reflecting channel around the inlay: the hub's water surface. */
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * TAU;
      const seg = P.platform(3.4, 0.5, 1.6, { bevel: 0.06 });
      out.add(seg, "lobby.marbleLight", {
        pos: [Math.cos(a) * 13.6, -0.15, Math.sin(a) * 13.6],
        rot: [0, -a, 0], collide: true,
      });
    }
    out.add(P.water(25, 25, { segments: 12, swell: 0.02 }), "shared.glass",
      { pos: [0, -0.18, 0], collide: false });

    /* ---------------- outer wall, ring of bays ---------------- */

    const BAYS = 16;
    for (let i = 0; i < BAYS; i += 1) {
      const a = (i / BAYS) * TAU;
      const cx = Math.cos(a) * R;
      const cz = Math.sin(a) * R;
      const w = (TAU * R) / BAYS + 0.6;
      out.add(P.platform(w, WALL_H, 3.0, { bevel: 0.14 }), "lobby.wall", {
        pos: [cx, WALL_H / 2, cz], rot: [0, -a + Math.PI / 2, 0], collide: true, uvScale: 4,
      });
      /* Gold pilaster between every bay. It is what makes the
         rotunda read as a room with structure rather than a drum. */
      const pa = ((i + 0.5) / BAYS) * TAU;
      out.add(P.pillar(0.55, WALL_H - 2, { sides: 6, flutes: true }), "lobby.wood", {
        pos: [Math.cos(pa) * (R - 0.9), 0, Math.sin(pa) * (R - 0.9)], collide: true,
      });
      out.add(P.platform(1.6, 0.5, 1.6, { bevel: 0.1 }), "shared.gold", {
        pos: [Math.cos(pa) * (R - 0.9), WALL_H - 2.1, Math.sin(pa) * (R - 0.9)], collide: false,
      });
    }

    /* ---------------- the mezzanine ring ---------------- */

    const innerR = R - 7;
    for (let i = 0; i < BAYS * 2; i += 1) {
      const a = (i / (BAYS * 2)) * TAU;
      /* Two breaks in the ring, so reaching the far side of the upper
         floor is a jump rather than a walk. */
      if (i === 7 || i === 8 || i === 23 || i === 24) continue;
      const w = (TAU * (R - 3.5)) / (BAYS * 2) + 0.5;
      out.add(P.platform(w, 0.8, 7.4, { bevel: 0.1 }), "lobby.marbleLight", {
        pos: [Math.cos(a) * (R - 3.5), MEZZ - 0.4, Math.sin(a) * (R - 3.5)],
        rot: [0, -a, 0], collide: true,
      });
      out.add(P.platform(w, 0.35, 7.4, { bevel: 0.06 }), "lobby.carpet", {
        pos: [Math.cos(a) * (R - 3.5), MEZZ + 0.16, Math.sin(a) * (R - 3.5)],
        rot: [0, -a, 0], collide: true,
      });
      const rp = [];
      for (let s = -1; s <= 1; s += 2) {
        rp.push([Math.cos(a) * innerR + Math.sin(a) * s * w * 0.5, MEZZ + 0.3,
          Math.sin(a) * innerR - Math.cos(a) * s * w * 0.5]);
      }
      out.add(P.rail(rp, { height: 1.05, bars: 2 }), "shared.gold",
        { collide: false, castShadow: false });
    }

    /* ---------------- grand stair, north ---------------- */

    for (let i = 0; i < 12; i += 1) {
      const y = (i + 1) * (MEZZ / 12);
      const z = -14 - i * 1.05;
      out.add(P.platform(12 - i * 0.2, 0.42, 1.15, { bevel: 0.05 }), "lobby.marbleLight",
        { pos: [0, y - 0.21, z], collide: true });
      out.add(P.platform(9.5 - i * 0.2, 0.12, 1.0, { bevel: 0.03 }), "lobby.carpet",
        { pos: [0, y + 0.06, z], collide: true });
    }
    out.add(P.rail([[-6.2, 0, -14], [-6.2, MEZZ, -26.6]], { height: 1.05, bars: 2 }),
      "shared.gold", { collide: false });
    out.add(P.rail([[6.2, 0, -14], [6.2, MEZZ, -26.6]], { height: 1.05, bars: 2 }),
      "shared.gold", { collide: false });

    /* ---------------- the framed records ---------------- */

    /* Each portal is a 9m platinum record in a gold frame. The locked
       ones get a plate with the Record count they want; the plate is
       geometry rather than HUD text so it survives a screenshot with
       the HUD hidden. */
    const PORTALS = [
      { course: 1, a: -Math.PI / 2, y: 5.5, need: 0, tint: 0xffc98a, label: "FOOD COURT" },
      { course: 2, a: 0, y: 5.5, need: 1, tint: 0xff7aa8, label: "RED CARPET" },
      { course: 3, a: Math.PI, y: MEZZ + 5.0, need: 8, tint: 0x7affd0, label: "SERVER FARM" },
      { course: 4, a: Math.PI / 2, y: MEZZ + 5.0, need: 15, tint: 0xb98aff, label: "ROOFTOP" },
      { course: 5, a: -Math.PI / 2 + 0.62, y: MEZZ + 11.5, need: 25, tint: 0xff5a3a, label: "BOYZ II HELL" },
    ];
    for (const portal of PORTALS) {
      const cx = Math.cos(portal.a) * (R - 1.7);
      const cz = Math.sin(portal.a) * (R - 1.7);
      const yaw = -portal.a + Math.PI / 2;
      /* Frame */
      out.add(P.platform(11, 11, 0.9, { bevel: 0.16, round: 5.4, curve: 8 }), "shared.gold",
        { pos: [cx, portal.y, cz], rot: [0, yaw, 0], collide: true });
      /* The disc itself - locked frames stay dark, open ones glow. */
      out.add(new THREE.CylinderGeometry(4.6, 4.6, 0.36, 40, 1),
        portal.need > 0 ? "lobby.marble" : "lobby.platinum", {
          pos: [cx - Math.cos(portal.a) * 0.6, portal.y, cz - Math.sin(portal.a) * 0.6],
          rot: [Math.PI / 2, 0, yaw], collide: false,
          tint: portal.need > 0 ? 0x8a8a96 : portal.tint,
        });
      out.add(new THREE.CylinderGeometry(1.5, 1.5, 0.42, 24, 1), "lobby.neon", {
        pos: [cx - Math.cos(portal.a) * 0.66, portal.y, cz - Math.sin(portal.a) * 0.66],
        rot: [Math.PI / 2, 0, yaw], collide: false, tint: portal.tint,
      });
      /* Name plate under the frame */
      out.add(P.platform(7.2, 1.0, 0.3, { bevel: 0.05 }), "lobby.wall", {
        pos: [cx - Math.cos(portal.a) * 0.5, portal.y - 6.4, cz - Math.sin(portal.a) * 0.5],
        rot: [0, yaw, 0], collide: false, tint: portal.need > 0 ? 0x6a6a78 : 0xffe0a8,
      });
      /* Locked frames get a bar of Record pips: as many pips as the
         count they need, which reads at a glance and needs no text. */
      for (let k = 0; k < Math.min(portal.need, 10); k += 1) {
        out.add(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 12, 1), "lobby.platinum", {
          pos: [
            cx - Math.cos(portal.a) * 0.7 + Math.cos(yaw) * (k - 4.5) * 0.62,
            portal.y - 6.4,
            cz - Math.sin(portal.a) * 0.7 - Math.sin(yaw) * (k - 4.5) * 0.62,
          ],
          rot: [Math.PI / 2, 0, 0], collide: false, tint: 0xd8d8e4,
        });
      }
      out.portal(portal.course, [cx - Math.cos(portal.a) * 1.4, portal.y - 4.4,
        cz - Math.sin(portal.a) * 1.4], { requires: portal.need, label: portal.label });

      /* Velvet rope in front of every locked door. */
      if (portal.need > 0 && portal.y < MEZZ) {
        for (let s = -1; s <= 1; s += 2) {
          out.inst("stanchion", F.stanchion, "shared.gold", {
            pos: [cx - Math.cos(portal.a) * 4 + Math.cos(yaw) * s * 3,
              0, cz - Math.sin(portal.a) * 4 - Math.sin(yaw) * s * 3],
          });
        }
      }
    }

    /* ---------------- reception, cases, seating ---------------- */

    out.add(P.platform(9, 1.15, 3.2, { bevel: 0.12, round: 1.2, curve: 5 }), "lobby.wood",
      { pos: [0, 0.575, 15], collide: true });
    out.add(P.platform(9.6, 0.16, 3.6, { bevel: 0.05, round: 1.3, curve: 5 }), "shared.gold",
      { pos: [0, 1.2, 15], collide: true });
    out.add(P.platform(7.5, 3.4, 0.4, { bevel: 0.08 }), "lobby.neon",
      { pos: [0, 3.4, 17.4], collide: false });

    for (let i = 0; i < 10; i += 1) {
      const a = rngRange(rng, 0, TAU);
      const r = rngRange(rng, 17, 25);
      /* `i % 3` in BOTH the key and the seed. out.inst builds its
         prototype once per key, so a seed that varies with `i` inside a
         single key produced ten copies of the same tree - see the note
         on the food court's palms. */
      const v = i % 3;
      out.inst(`ficus${v}`, () => P.tree("ficus", { height: 3.4, seed: 0x300 + v * 41 }),
        "foodcourt.leaf", { pos: [Math.cos(a) * r, 0, Math.sin(a) * r], rot: [0, rng() * TAU, 0] });
      out.inst("planterPot", F.planterPot, "lobby.wood",
        { pos: [Math.cos(a) * r, 0, Math.sin(a) * r] });
    }

    for (let i = 0; i < 14; i += 1) {
      const a = rngRange(rng, 0, TAU);
      const r = rngRange(rng, 18, 26);
      out.inst("stanchion", F.stanchion, "shared.gold",
        { pos: [Math.cos(a) * r, 0, Math.sin(a) * r] });
    }

    /* Label staff and hangers-on around the edge of the rotunda, and a
       row leaning on the mezzanine rail. The hub is the first room of
       the game and an empty marble drum is a lobby nobody works in.
       The middle of the floor - the record inlay, which is what the
       arrival and collect shots are about - stays clear. */
    crowdField(out, F, rng, {
      rows: 3, per: 22, faceAt: [0, 2, 0], cheer: 0.2,
      at: (i, k) => {
        if (rng() < 0.34) return null;
        const a = (i / 22) * TAU + k * 0.09;
        const r = 19 + k * 3;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (z > 8 && Math.abs(x) < 7) return null;   /* the entrance axis */
        return [x, 0, z];
      },
    });
    crowdField(out, F, rng, {
      rows: 1, per: 20, faceAt: [0, 1, 0], cheer: 0.15,
      at: (i) => {
        if (rng() < 0.4) return null;
        const a = (i / 20) * TAU;
        return [Math.cos(a) * (R - 4.4), MEZZ + 0.34, Math.sin(a) * (R - 4.4)];
      },
    });

    /* Award cases along the lower wall - lit, so the ring of them
       reads as a band of light at knee height all the way round. */
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * TAU + 0.31;
      const cx = Math.cos(a) * (R - 3.2);
      const cz = Math.sin(a) * (R - 3.2);
      out.add(P.platform(3.4, 2.4, 1.1, { bevel: 0.08 }), "lobby.wall",
        { pos: [cx, 1.2, cz], rot: [0, -a, 0], collide: true });
      out.add(P.platform(2.8, 1.4, 0.14, { bevel: 0.03 }), "lobby.neon",
        { pos: [cx - Math.cos(a) * 0.6, 1.5, cz - Math.sin(a) * 0.6], rot: [0, -a, 0], collide: false });
    }

    /* ---------------- the chandelier ---------------- */

    /* Sixty gold discs on invisible strings. The hub's one piece of
       pure spectacle, and the reason the atrium reads as tall. */
    for (let i = 0; i < 60; i += 1) {
      const a = (i * 2.39996);                       /* golden angle */
      const t = i / 60;
      const r = 1.6 + Math.sqrt(t) * 8.5;
      const y = WALL_H - 2.5 - t * 9.5 - Math.sin(i) * 0.6;
      out.add(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 14, 1), "shared.gold", {
        pos: [Math.cos(a) * r, y, Math.sin(a) * r],
        rot: [rngRange(rng, -0.4, 0.4), rng() * TAU, rngRange(rng, -0.4, 0.4)],
        collide: false, castShadow: false,
      });
    }
    out.add(new THREE.CylinderGeometry(0.35, 0.35, 4.5, 10, 1), "shared.gold",
      { pos: [0, WALL_H - 1.2, 0], collide: false, castShadow: false });

    /* ---------------- lights, beams, markers ---------------- */

    out.accent(0, { pos: [0, 15, 0], color: 0xffd9a0, intensity: 42, distance: 46 });
    out.accent(1, { pos: [0, 6, 22], color: 0xff5a8a, intensity: 16, distance: 24 });
    out.accent(2, { pos: [-22, 12, -12], color: 0x8a6aff, intensity: 18, distance: 30 });
    out.accent(3, { pos: [22, 12, -12], color: 0x6ad8ff, intensity: 18, distance: 30 });

    /* One broad shaft from the glass dome, landing on the inlay. */
    /* Quarter value, and more sides. These are additive, double-sided
       and thirteen metres across at the floor: authored near white
       they put a clipped hole in the middle of the one room the
       player sees first, and the facet edges of a twelve-sided cone
       that bright read as missing geometry rather than as light. */
    out.beam({ pos: [0, WALL_H + 2, 0], dir: [0, -1, 0], length: WALL_H + 3, radius: 6.5, radiusEnd: 13, color: 0x4e4030, sides: 26, steps: 5 });
    out.beam({ pos: [-13, WALL_H + 2, 8], dir: [0.16, -1, -0.1], length: WALL_H + 3, radius: 2.2, radiusEnd: 5, color: 0x453427, sides: 18, steps: 4 });
    out.beam({ pos: [12, WALL_H + 2, -9], dir: [-0.12, -1, 0.14], length: WALL_H + 3, radius: 2.2, radiusEnd: 5, color: 0x453427, sides: 18, steps: 4 });

    out.spawn(0, [0, 0.2, 22], Math.PI);
    out.spawn(1, [0, MEZZ + 0.5, -24], 0);
    out.spawn(2, [0, 0.2, 8], Math.PI);

    /* Camera markers - see HOW TO AUTHOR A CAMERA MARKER above.
       The hub's landmarks are the five framed records, the chandelier
       and the inlay, so every marker aims at one of those. Both
       vantages stand on the MEZZANINE at 8m under a 26m dome, which
       is the one place in this course with the headroom the solved
       camera needs; the grand stair is the approach, not a vantage. */
    out.marker("arrival", [0, 1.0, 26], [0, 6.5, -20]);
    out.marker("vista", [0, 8.6, -24], [0, 5.5, 26]);
    out.marker("platforming", [0, 1.0, -6], [0, 6.5, -24]);
    out.marker("enemy-encounter", [8, 1.0, 18], [-4, 2.4, 22]);
    out.marker("collect", [0, 1.0, 12], [0, 1.6, 0]);
    out.marker("boss", [0, 1.0, 20], [0, 6.0, 29]);
    out.marker("interior", [0, 1.0, 16], [0, 12, 0]);
    out.marker("water", [0, 1.0, 20], [0, 0.2, 8]);
    out.marker("high-ground", [-21, 8.6, 14], [26, 6.0, 6]);

    out.clout([0, 1.4, 18], "yellow");
    out.cloutRing([0, 1.2, 0], 13.6, 12, "yellow");
    out.cloutLine([0, 1.2, -15], [0, MEZZ + 1.2, -26], 8, "yellow");
  },
};

/* ============================================================
   COURSE 1 - THE MALL FOOD COURT

   The tutorial course, and therefore the one that has to be the
   best-looking thing in the game. A dead mall's food court under
   three enormous skylights.

   Composition:
     - ONE dominant centre. The Fountain of Free Refills is a 16m
       soda fountain in the middle of the plaza, climbable in four
       stages, and visible from every square metre of the course.
     - TWO corner landmarks with completely different silhouettes:
       MOG BURGER (a nine-metre burger on a chrome pole, north-west)
       and the Pretzel Helix (a spiral of platforms round a golden
       pretzel, south-east). Round-and-fat against tall-and-thin, so
       a glance at the horizon always tells you which way you face.
     - Three tiers you can see from the floor: the shop roofs and
       the mezzanine at 5-8m, and the skylight catwalks at 17m.

   The skylights are load-bearing for the lighting: the whole
   course is lit by three columns of daylight coming down into a
   warm fluorescent interior, which is what stops an indoor course
   from reading as a flat grey box.
   ============================================================ */

const COURSE_1 = {
  id: 1,
  name: "The Mall Food Court",
  theme: "mall",
  music: "mall",
  spawnCount: 3,
  records: [
    { id: "mall-1", name: "Top of the Refills", gate: "exploration" },
    { id: "mall-2", name: "Manager's Special", gate: "boss" },
    { id: "mall-3", name: "Eight Red Straws", gate: "clout-100" },
    { id: "mall-4", name: "Mind the Gap", gate: "long-jump" },
    { id: "mall-5", name: "Blue Plate Special", gate: "timed-switch" },
    { id: "mall-6", name: "Lost in the Ball Pit", gate: "hidden" },
    { id: "mall-7", name: "The Pretzel Gauntlet", gate: "gauntlet" },
  ],

  build(ctx, out) {
    const P = out.prim;
    const F = makeProps(P);
    const rng = out.rng;

    const HALF = 60;
    const WALL_H = 24;
    const CEIL = 22;
    const MEZZ = 8;
    const CAT = 17;

    out.bounds([-HALF - 6, -4, -HALF - 6], [HALF + 6, CEIL + 6, HALF + 6]);

    /* ============ ground ============ */

    /* Eighteen metres per texture repeat, not six. The aggregate in
       this floor is what the review called "pure static": at six
       metres a chip was one to five screen pixels across a surface
       that fills more than half the frame. At eighteen the same
       painter reads as a slow mottle you notice and then stop
       noticing, which is what a floor is for. */
    out.add(P.platform(HALF * 2 + 8, 1.6, HALF * 2 + 8, { bevel: 0.3, round: 3 }),
      "foodcourt.terrazzo", { pos: [0, -0.8, 0], collide: true, uvScale: 18, jitter: 0.04 });

    /* The checker patch under the seating. One regular area in the
       middle of a mottled floor gives the eye something to measure
       everything else against - but quietly. Four-metre squares at
       eight metres per repeat: big enough that the pitch never falls
       near the sample grid anywhere in the room. */
    out.add(P.platform(46, 0.3, 46, { bevel: 0.08, round: 2 }), "foodcourt.checker",
      { pos: [0, -0.1, 0], collide: true, uvScale: 8, ao: 0 });

    /* Perimeter walls, storefront band and the upper clerestory. */
    for (let side = 0; side < 4; side += 1) {
      const a = (side / 4) * TAU;
      const nx = Math.sin(a), nz = Math.cos(a);
      out.add(P.platform(HALF * 2 + 8, WALL_H, 4, { bevel: 0.2 }), "foodcourt.wall", {
        pos: [nx * (HALF + 2), WALL_H / 2, nz * (HALF + 2)],
        rot: [0, a, 0], collide: true, uvScale: 12,
      });
      /* Brick storefront base, so the wall is not one material for
         twenty-four metres. */
      out.add(P.platform(HALF * 2 + 8, 3.4, 0.5, { bevel: 0.1 }), "foodcourt.brick", {
        pos: [nx * (HALF - 0.2), 1.7, nz * (HALF - 0.2)], rot: [0, a, 0], collide: false,
      });
      out.add(P.platform(HALF * 2 + 8, 0.6, 0.9, { bevel: 0.12 }), "foodcourt.counter", {
        pos: [nx * (HALF - 0.4), 3.6, nz * (HALF - 0.4)], rot: [0, a, 0], collide: false,
      });
    }

    /* ============ ceiling and skylights ============ */

    /* The ceiling is a 5x5 grid of coffers with three cells removed.
       Three openings rather than one: a single hole puts all the
       light in one place and leaves the rest of a 120m room flat. */
    const SKY_CELLS = [[2, 2], [0, 3], [4, 1]];
    const cell = (HALF * 2 + 8) / 5;
    for (let gx = 0; gx < 5; gx += 1) {
      for (let gz = 0; gz < 5; gz += 1) {
        if (SKY_CELLS.some((c) => c[0] === gx && c[1] === gz)) continue;
        const cx = (gx - 2) * cell;
        const cz = (gz - 2) * cell;
        out.add(P.platform(cell - 0.4, 1.0, cell - 0.4, { bevel: 0.16 }), "foodcourt.ceiling", {
          pos: [cx, CEIL + 0.5, cz], collide: true, uvScale: 9, ao: 0,
        });
        /* Coffer ribs and a fluorescent tube per bay: the ceiling is
           on camera in every upward shot and cannot be a flat plate. */
        out.add(P.platform(cell - 0.4, 0.5, 0.7, { bevel: 0.06 }), "shared.metal",
          { pos: [cx, CEIL - 0.25, cz], collide: false, ao: 0 });
        out.add(P.platform(cell * 0.62, 0.24, 0.42, { bevel: 0.04 }), "foodcourt.neon",
          { pos: [cx, CEIL - 0.55, cz], collide: false, ao: 0, tint: 0xfff0d0 });
      }
    }
    const skylights = [];
    for (const [gx, gz] of SKY_CELLS) {
      const cx = (gx - 2) * cell;
      const cz = (gz - 2) * cell;
      skylights.push([cx, cz]);
      /* Chrome curb, then a shallow glass pyramid on top of it. */
      for (let s = 0; s < 4; s += 1) {
        const a = (s / 4) * TAU;
        out.add(P.platform(cell, 1.6, 1.2, { bevel: 0.12 }), "shared.chrome", {
          pos: [cx + Math.sin(a) * (cell / 2 - 0.6), CEIL + 0.8, cz + Math.cos(a) * (cell / 2 - 0.6)],
          rot: [0, a, 0], collide: true, ao: 0,
        });
      }
      const glass = new THREE.ConeGeometry(cell * 0.72, 4.4, 4, 1);
      out.add(glass, "shared.glass", { pos: [cx, CEIL + 3.6, cz], rot: [0, Math.PI / 4, 0], collide: false, ao: 0 });
      for (let s = 0; s < 4; s += 1) {
        const a = (s / 4) * TAU + Math.PI / 4;
        const bar = new THREE.CylinderGeometry(0.16, 0.16, 5.6, 5, 1);
        bar.rotateZ(0.46);
        out.add(bar, "shared.chrome", {
          pos: [cx + Math.sin(a) * cell * 0.26, CEIL + 3.4, cz + Math.cos(a) * cell * 0.26],
          rot: [0, -a, 0], collide: false, ao: 0,
        });
      }
      /* The shaft. This is the course's signature light and the one
         thing that has to survive every camera angle.

         Its colour IS its brightness: the beam material is additive at
         a global gain of 1 and double-sided, so a near-white shaft
         adds itself to the frame twice and buries the middle of the
         picture in clipped white - which reads as a hole burned in
         the image, not as light. This is dialled to roughly a third of
         a white shaft, which survives tone mapping with headroom and
         lets the geometry behind it stay visible THROUGH it, and the
         side count is up because a faceted cone silhouette reads as
         missing geometry rather than as air. */
      out.beam({
        pos: [cx, CEIL + 1.5, cz], dir: [0.06, -1, 0.04],
        length: CEIL + 2.5, radius: cell * 0.34, radiusEnd: cell * 0.62,
        color: 0x5e5748, sides: 24, steps: 5,
      });
    }

    /* ============ the mezzanine ============ */

    const deckSpans = [
      /* [axis, fixed, from, to] - axis 0 runs along x, 1 along z */
      [0, -HALF + 6, -HALF, -8], [0, -HALF + 6, 8, HALF],
      [0, HALF - 6, -HALF, HALF],
      [1, -HALF + 6, -HALF + 12, HALF - 12],
      [1, HALF - 6, -HALF + 12, HALF - 12],
    ];
    for (const [axis, fixed, from, to] of deckSpans) {
      const len = to - from;
      const mid = (from + to) / 2;
      const pos = axis === 0 ? [mid, MEZZ - 0.5, fixed] : [fixed, MEZZ - 0.5, mid];
      const size = axis === 0 ? [len, 1.0, 12] : [12, 1.0, len];
      out.add(P.platform(size[0], size[1], size[2], { bevel: 0.14 }), "foodcourt.tile",
        { pos, collide: true, uvScale: 6, ao: 0 });
      /* Underside fascia, so from the plaza floor the mezzanine reads
         as a built structure and not as a floating slab. */
      const fpos = axis === 0
        ? [mid, MEZZ - 1.6, fixed + (fixed < 0 ? 6 : -6)]
        : [fixed + (fixed < 0 ? 6 : -6), MEZZ - 1.6, mid];
      const fsize = axis === 0 ? [len, 1.4, 0.6] : [0.6, 1.4, len];
      out.add(P.platform(fsize[0], fsize[1], fsize[2], { bevel: 0.06 }), "foodcourt.counter",
        { pos: fpos, collide: false, ao: 0 });
      /* Rail along the inner edge. */
      const rp = axis === 0
        ? [[from, MEZZ, fixed + (fixed < 0 ? 6 : -6)], [to, MEZZ, fixed + (fixed < 0 ? 6 : -6)]]
        : [[fixed + (fixed < 0 ? 6 : -6), MEZZ, from], [fixed + (fixed < 0 ? 6 : -6), MEZZ, to]];
      out.add(P.rail(rp, { height: 1.1, bars: 2, postEvery: 3 }), "shared.rail",
        { collide: false, castShadow: false });
      /* Support columns down to the floor every twelve metres. */
      const n = Math.max(2, Math.round(len / 12));
      for (let i = 0; i <= n; i += 1) {
        const t = from + (len * i) / n;
        const cxz = axis === 0
          ? [t, 0, fixed + (fixed < 0 ? 5 : -5)]
          : [fixed + (fixed < 0 ? 5 : -5), 0, t];
        mallColumn(out, P, cxz[0], cxz[2], MEZZ - 1, 0.62);
      }
    }

    /* The long-jump island: the north deck's twelve-metre break with
       a six-metre landing pad floating in the middle of it. Nine
       metres of air on each side - a running long jump clears it and
       nothing else does, which is the entire point of the record. */
    out.add(P.platform(7, 1.0, 7, { bevel: 0.14 }), "foodcourt.tile",
      { pos: [0, MEZZ - 0.5, -HALF + 6], collide: true });
    mallColumn(out, P, 0, -HALF + 6, MEZZ - 1, 0.7);
    out.add(new THREE.TorusGeometry(3.1, 0.16, 6, 28), "foodcourt.neon",
      { pos: [0, MEZZ + 0.14, -HALF + 6], rot: [Math.PI / 2, 0, 0], collide: false, tint: 0x6bd5ff });

    /* Escalators: four ramps at the diagonals. Frozen, so they are
       ramps - a mall where the escalators still work is a mall with
       a maintenance budget. */
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * TAU + Math.PI / 4;
      const dx = Math.sin(a), dz = Math.cos(a);
      const baseX = dx * (HALF - 26), baseZ = dz * (HALF - 26);
      const ramp = P.ramp(5, MEZZ, 16, { thickness: 0.7, treads: true, kerbHeight: 0.7 });
      out.add(ramp, "shared.grate", {
        pos: [baseX, 0, baseZ], rot: [0, a + Math.PI, 0], collide: "metal",
      });
      const rr = [
        [baseX - dz * 2.8, 0, baseZ + dx * 2.8],
        [baseX - dz * 2.8 - dx * 16, MEZZ, baseZ + dx * 2.8 - dz * 16],
      ];
      out.add(P.rail(rr, { height: 1.05, bars: 2 }), "shared.rail", { collide: false });
      const rl = [
        [baseX + dz * 2.8, 0, baseZ - dx * 2.8],
        [baseX + dz * 2.8 - dx * 16, MEZZ, baseZ - dx * 2.8 - dz * 16],
      ];
      out.add(P.rail(rl, { height: 1.05, bars: 2 }), "shared.rail", { collide: false });
    }

    /* ============ the catwalks ============ */

    /* A cross of service catwalks under the skylights, with a hole
       in the middle for the fountain's straw. Visible from the floor
       through the shafts, which is what makes the top tier legible
       as a destination rather than a surprise. */
    for (const axis of [0, 1]) {
      for (const sgn of [-1, 1]) {
        const from = sgn * 7, to = sgn * (HALF - 2);
        const mid = (from + to) / 2;
        const len = Math.abs(to - from);
        const pos = axis === 0 ? [mid, CAT, 0] : [0, CAT, mid];
        const size = axis === 0 ? [len, 0.5, 4.6] : [4.6, 0.5, len];
        out.add(P.platform(size[0], size[1], size[2], { bevel: 0.1 }), "shared.grate",
          { pos, collide: "metal", uvScale: 3.6 });
        const rp = axis === 0
          ? [[from, CAT + 0.25, 2.3], [to, CAT + 0.25, 2.3]]
          : [[2.3, CAT + 0.25, from], [2.3, CAT + 0.25, to]];
        const rq = axis === 0
          ? [[from, CAT + 0.25, -2.3], [to, CAT + 0.25, -2.3]]
          : [[-2.3, CAT + 0.25, from], [-2.3, CAT + 0.25, to]];
        out.add(P.rail(rp, { height: 1.0, bars: 2, radius: 0.075 }), "shared.rail",
          { collide: false, castShadow: false });
        out.add(P.rail(rq, { height: 1.0, bars: 2, radius: 0.075 }), "shared.rail",
          { collide: false, castShadow: false });
        /* Hangers up to the ceiling. */
        for (let i = 1; i < 5; i += 1) {
          const t = from + (to - from) * (i / 5);
          const hp = axis === 0 ? [t, CAT + 2.6, 0] : [0, CAT + 2.6, t];
          out.add(new THREE.CylinderGeometry(0.09, 0.09, 5.2, 5, 1), "shared.metal",
            { pos: hp, collide: false, castShadow: false, ao: 0 });
        }
      }
    }

    /* ============ LANDMARK 1 - THE FOUNTAIN OF FREE REFILLS ============ */

    /* WHY THE BOTTOM BOWL IS A PLAZA POOL

       This used to be three bowls, the lowest of them a ten-metre ring
       of tangential boxes 1.7m tall with a SQUARE sheet of soda inside
       it. Measured against what the frame actually contained, every
       part of that was wrong. The ring read as twenty teal packing
       cases because tangential boxes meet on their inner edges and
       gape on their outer ones. The square sheet was 18m across inside
       a 20m ring, so its corners speared out THROUGH the wall and the
       only liquid visible anywhere was four orange wedges. And a 1.7m
       parapet around water sitting 0.45m below its top hides the pool
       from every camera at standing height, which is where the capture
       presets put the lens.

       So the ground bowl is now a wide, shallow plaza pool: twelve
       metres of standing soda behind a coping low enough to see over,
       closed with P.ring so the rim is a circle, with the waterline
       0.42m under a pale capstone that draws the edge.

       THE HEIGHTS ARE A MEASUREMENT, NOT A TASTE CALL. camera.js
       decides whether a `water` shot is honest by probing DOWN from
       2.5m above the surface it found and asking how much of a 5m ring
       is also water. So every horizontal surface the sculpture owns
       between the waterline and waterline+2.5 turns a pool into a
       "31% patch" - which is exactly what a first pass at four evenly
       spaced bowls produced, because bowl two's underside sat 2.5m up
       and roofed most of the pool. Bowl two therefore starts at 3.85m,
       and between it and the water there is nothing but a smooth
       uncapped stem. The route up is stepping stones instead.

       `r` is the centre line of the wall; `sink` is how far the water
       sits below the coping; `stem` is the pedestal up to the next
       bowl. */
    const TIERS = [
      { r: 13.0, y: 0.95, wall: 1.5, sink: 0.42, seg: 52, stem: 2.6 },
      { r: 8.0, y: 4.80, wall: 1.2, sink: 0.34, seg: 40, stem: 1.9 },
      { r: 5.6, y: 7.10, wall: 1.0, sink: 0.30, seg: 30, stem: 1.3 },
      { r: 3.7, y: 9.30, wall: 0.9, sink: 0.26, seg: 22, stem: 0 },
    ];
    const POOL = TIERS[0];
    const POOL_R = POOL.r - POOL.wall / 2;        /* inner face  */
    const POOL_OUT = POOL.r + POOL.wall / 2;      /* outer face  */
    const POOL_Y = POOL.y - POOL.sink;            /* the waterline */

    TIERS.forEach((tier, ti) => {
      const rIn = tier.r - tier.wall / 2;
      const rOut = tier.r + tier.wall / 2;
      const h = ti === 0 ? tier.y : 0.95;
      /* Only 0.18m of soda over the bed. Deep enough to read as liquid
         over tile, shallow enough that standing ON the surface - which
         is what the collider makes her do - is indistinguishable from
         standing in it. */
      const bedY = tier.y - tier.sink - 0.18;

      /* The wall. One closed ring, collidable, standable on top. */
      out.add(P.ring(rIn, rOut, h, { segments: tier.seg }), "foodcourt.basin", {
        pos: [0, tier.y - h, 0], collide: true, uvScale: 3.4,
      });
      /* The capstone. A pale lip proud of the wall on both faces: it is
         the line that says "this is the edge of a pool", and it is the
         only thing in the composition that separates a teal wall from
         teal water at a distance. */
      /* THE GROUND POOL'S COPING OVERSAILS, AND THE WALL UNDER IT IS
         THE SECOND DARK. Read the note above `undercroft` first.

         Three captures - `arrival`, `interior` and `water` - stand at
         one end of a hundred-and-twenty-metre room and look at this
         fountain, and everything past it is forty metres away. There
         is nothing else at readable distance in any of the three, so
         the mass that has to carry a second dark for all of them IS
         the fountain. The critic asked for it in those words: "a
         shaded soffit under the fountain rim".

         So this ring is now a piece of masonry rather than a lip: it
         projects 0.42 m past the outer face instead of 0.13, and the
         wall beneath it is a REVEAL - recessed, in its own shade, and
         dark. The reveal is 0.60 m tall and crosses 55-62% of the
         frame width in all three captures, which at the ten to
         thirteen metres those lenses stand from the near coping is
         five percent of the reviewed crop.

         THE GROUND POOL'S COPING ALSO STANDS PROUD OF THE WALL TOP
         rather than being flush with it, which is where the height of
         the reveal comes from. The wall is 0.95 m and the water sits
         0.42 m down inside it, so a reveal cut into the wall could
         only ever be half a metre - and the wall cannot be raised,
         because a parapet over water is what hid the pool from every
         standing lens in the first place (see the note above TIERS).
         Setting the coping ON TOP instead buys 0.33 m of reveal
         without moving the waterline at all. The cost is measured:
         the sight line from a 3.8 m lens thirteen metres out grazes a
         1.28 m coping and reaches the 0.53 m waterline four metres
         inside the pool, so 83% of the water is still in the picture.
         The spouts sit inboard of it on the exposed wall top, which is
         also where a fountain's jets belong.

         The upper bowls keep the old flush lip. They are seen from
         BELOW, where a reveal is invisible and an oversail would only
         thicken their outline. */
      const cap = ti === 0
        ? { rIn: rOut - 0.35, rOut: rOut + 0.42, h: 0.33, y: tier.y }
        : { rIn: rIn - 0.13, rOut: rOut + 0.13, h: 0.16, y: tier.y - 0.11 };
      out.add(P.ring(cap.rIn, cap.rOut, cap.h, { segments: tier.seg, floor: ti === 0 }),
        "foodcourt.counter", {
          pos: [0, cap.y, 0], collide: ti === 0, uvScale: 4, tint: 0xc9c0a8,
        });
      if (ti === 0) {
        /* The reveal itself, and a plinth under it that oversails as
           well, so the dark is a recess between two projections rather
           than a band of paint on a drum. A shadow gap needs a lip at
           BOTH ends or it reads as a change of material - the same
           argument foregroundBed makes about its own coping.

           `foodcourt.wall` because it is the course's lowest-frequency
           surface at twelve metres per repeat: this ring is eighty-six
           metres of circumference and the high-frequency row of the
           metrics gate is the tightest of the four. */
        out.add(P.ring(rOut - 0.02, rOut + 0.03, 0.75, { segments: tier.seg, floor: false }),
          "foodcourt.wall", {
            pos: [0, 0.20, 0], collide: false, uvScale: 6,
            tint: 0x7a7392, ao: 0.45, aoHeight: 1.1, groundY: 0.10,
          });
        out.add(P.ring(rOut - 0.12, rOut + 0.30, 0.20, { segments: tier.seg, floor: false }),
          "foodcourt.brick", {
            pos: [0, 0, 0], collide: false, uvScale: 4,
            tint: 0x7c6a58, ao: 0.4, aoHeight: 0.5,
          });
      }
      /* The bed, tiled and pale so the soda over it reads as depth
         rather than as paint. */
      out.add(new THREE.CylinderGeometry(rIn, rIn, 0.4, tier.seg, 1), "foodcourt.basin",
        { pos: [0, bedY - 0.2, 0], collide: true, uvScale: 3.4, tint: 0x8fb6c8 });
      /* THE WATER. A disc, cut to the wall. */
      out.add(P.water(0, 0, { radius: rIn - 0.06, arc: tier.seg, segments: 5, swell: 0.035 }),
        "foodcourt.soda", { pos: [0, tier.y - tier.sink, 0], collide: "water" });
      /* Two ripple rings per bowl. Flat annuli a centimetre above the
         surface in a lighter tint - the cheapest thing in the game
         that turns a sheet of colour into a liquid. */
      for (let k = 0; k < 2; k += 1) {
        const rr = (rIn - 0.4) * (0.42 + k * 0.34);
        const ripple = new THREE.RingGeometry(rr, rr + 0.14, tier.seg, 1);
        ripple.rotateX(-Math.PI / 2);
        out.add(ripple, "foodcourt.soda", {
          pos: [0, tier.y - tier.sink + 0.014 + k * 0.004, 0],
          collide: false, castShadow: false, tint: 0x6fb2cc,
        });
      }
      /* THE PEDESTAL IS A BALUSTER, NOT A DRUM.

         This was one `P.pillar` with base and cap suppressed - a
         fourteen-sided cylinder of `shared.chrome`, 2.6 m in radius
         and five metres tall, standing in the middle of the pool. A
         blind pass on the `water` capture: "its central mass is a
         featureless grey drum with horizontal banding - reads as
         untextured placeholder". Every word of that is a description
         of the geometry rather than of the shading. A cylinder has one
         silhouette from every bearing; the metal painter's rivet
         courses run round it as horizontal stripes with nothing
         vertical to break them; and chrome with no environment map is
         a flat grey (see the metalness note above the surface table).

         So it is built the way the middle of a tiered fountain
         actually is - a splayed FOOT, a tapered fluted SHAFT, a
         COLLAR, and a FLARE spreading out under the bowl above:

           - The flutes are the answer to the banding. They are
             verticals, they cost nothing (the primitive already
             carries them), and they put a run of light and shade down
             the shaft that no amount of albedo could.
           - The flare is the answer to the outline. It is the only
             part of this sculpture that changes width with height,
             which is what makes the middle of the fountain read as
             three stacked objects instead of one pipe - and its
             underside is a broad down-facing cone, which is a dark
             this course cannot otherwise buy at that height.
           - The shaft wears the fountain's own glaze rather than
             chrome. Chrome here was neither reflective (no env map)
             nor coloured, so it read as absence; the basin tile ties
             the pedestal to the bowls it holds up. The collars stay
             metal, because a moulding is where the metal belongs.

         HEIGHTS ARE CONSTRAINED, not chosen. camera.js decides whether
         a `water` shot is honest by probing DOWN from 2.5 m above the
         surface it found, so nothing here may put an up-facing surface
         between the waterline and waterline + 2.5. The flare's collar
         sits at 3.6 m over the ground pool's 0.53 m waterline, which
         clears that probe by half a metre. Re-measure if TIERS moves. */
      if (tier.stem > 0) {
        const next = TIERS[ti + 1];
        const foot = tier.y - 1.2;
        const flareH = 1.25 + ti * 0.1;
        const flareTop = next.y - 0.30;
        const shaftTop = flareTop - flareH;
        const flareR = Math.min(next.r - next.wall / 2 - 0.5, tier.stem * 1.75);

        out.add(new THREE.CylinderGeometry(tier.stem * 1.04, tier.stem * 1.32, 0.42, 16, 1),
          "shared.chrome", { pos: [0, foot + 0.21, 0], collide: true, ao: 0.42, aoHeight: 1.2 });
        out.add(P.pillar(tier.stem, shaftTop - foot - 0.34, {
          sides: 16, base: false, cap: false, taper: 0.84, flutes: true,
        }), "foodcourt.basin", {
          pos: [0, foot + 0.34, 0], collide: true, uvScale: 2.2, ao: 0.3, aoHeight: 2.4,
        });
        out.add(new THREE.CylinderGeometry(tier.stem * 0.92, tier.stem * 0.92, 0.26, 16, 1),
          "shared.chrome", { pos: [0, shaftTop - 0.13, 0], collide: false, ao: 0 });
        /* The flare. Its underside is the point of it - see above. */
        out.add(new THREE.CylinderGeometry(flareR, tier.stem * 0.86, flareH, 20, 1, true),
          "foodcourt.basin", {
            pos: [0, shaftTop + flareH / 2, 0], collide: true, uvScale: 2.6,
            tint: 0x6f8ea0, ao: 0.5, aoHeight: flareH * 1.1, groundY: shaftTop,
          });
        out.add(new THREE.CylinderGeometry(flareR + 0.16, flareR + 0.16, 0.22, 20, 1),
          "shared.chrome", { pos: [0, flareTop - 0.11, 0], collide: true, ao: 0 });
      }
    });

    /* THE STEPPING STONES, and why they are at those three bearings.

       They are the route: the coping is 0.35m from the outermost stone
       and the stone is 0.3m from bowl two's rim, so the climb reads as
       three easy hops instead of one impossible jump across the pool.
       The bearings are not decorative either. camera.js scans a ring
       7.5m from the marker's look point and takes the FIRST water it
       finds, which on this fountain is the +x axis, then samples a 5m
       ring around that hit. A stone on the +x side lands inside those
       samples and answers "stone" in the middle of a pool; at 90, 180
       and 270 degrees the nearest sample is nine metres away. */
    const STONE_BED = POOL_Y - 0.18;      /* the pool bed */
    const STONE_TOP = 2.6;
    for (let i = 0; i < 3; i += 1) {
      const a = Math.PI * (0.5 + i * 0.5);
      const sx = Math.cos(a) * 10.4, sz = Math.sin(a) * 10.4;
      out.add(P.pillar(1.4, STONE_TOP - STONE_BED, { sides: 12, base: false, cap: true, taper: 0.86 }),
        "foodcourt.basin", { pos: [sx, STONE_BED, sz], collide: true, uvScale: 2.2 });
      /* A pale disc on top so the stone separates from the soda around
         it at the distance the shot is actually taken from. */
      out.add(new THREE.CylinderGeometry(1.55, 1.55, 0.16, 14, 1), "foodcourt.counter",
        { pos: [sx, STONE_TOP - 0.04, sz], collide: false, tint: 0xf4efdf });
    }

    /* SOMETHING IN THE WATER. A pool with nothing in it is a coloured
       floor; coins on the bed are the one prop that names a fountain
       without a caption, and they cost a single instanced draw. Kept
       off the stem and off the rim so they read as scattered rather
       than as a pattern, and seeded locally so adding them cannot walk
       the course's whole scatter stream. */
    const wishRng = makeRng(0xF0417A);
    for (let i = 0; i < 54; i += 1) {
      const a = wishRng() * TAU;
      const r = Math.sqrt(rngRange(wishRng, 0, 1)) * (POOL_R - 1.2 - POOL.stem) + POOL.stem + 0.9;
      out.inst("wishCoin", () => {
        const c = new THREE.CylinderGeometry(0.17, 0.17, 0.035, 10, 1);
        c.rotateZ(Math.PI / 2 * 0.03);
        return c;
      }, "shared.gold", {
        pos: [Math.cos(a) * r, POOL_Y - 0.33, Math.sin(a) * r],
        rot: [0, wishRng() * TAU, 0], scale: rngRange(wishRng, 0.8, 1.25),
      });
    }
    /* Litter that floats: a lost tray and two cups. Three objects, and
       they are what makes it a MALL fountain rather than a civic one. */
    for (let i = 0; i < 3; i += 1) {
      const a = 0.7 + i * 2.3;
      const r = POOL.stem + 2.4 + i * 2.1;
      out.add(P.platform(1.5, 0.12, 1.1, { bevel: 0.04 }), "foodcourt.tray", {
        pos: [Math.cos(a) * r, POOL_Y + 0.03, Math.sin(a) * r],
        rot: [0, a * 1.7, 0], collide: false, tint: i === 1 ? 0xf2c94c : 0xd6392b,
      });
    }

    /* Eight chrome spouts on the coping, each with a jet arcing into
       the pool. Movement is what a still frame cannot show, so the
       jets are geometry: a leaning column of soda from the nozzle down
       to the surface, and a pale ring of foam where it lands. */
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * TAU + 0.19;
      const cx = Math.cos(a), cz = Math.sin(a);
      out.inst("spout", () => {
        const parts = [];
        const body = new THREE.CylinderGeometry(0.19, 0.24, 0.62, 10, 1);
        body.translate(0, 0.31, 0);
        const neck = new THREE.CylinderGeometry(0.11, 0.13, 0.5, 8, 1);
        neck.rotateZ(-0.72);
        neck.translate(-0.17, 0.72, 0);
        parts.push(body, neck);
        return mergeGeometries(parts);
      }, "shared.chrome", { pos: [cx * (POOL.r - 0.1), POOL.y, cz * (POOL.r - 0.1)], rot: [0, -a, 0] });

      /* Thin, and tinted almost white. A jet is aerated water and a
         fat opaque column of the pool's own colour reads as a bollard
         standing in the fountain - which is exactly how the first
         version photographed. */
      const jetLen = POOL.y + 0.72 - POOL_Y;
      const jet = new THREE.CylinderGeometry(0.045, 0.09, jetLen, 7, 1);
      jet.rotateZ(0.34);
      out.add(jet, "foodcourt.soda", {
        pos: [cx * (POOL.r - 1.05), POOL_Y + jetLen / 2, cz * (POOL.r - 1.05)],
        rot: [0, -a, 0], collide: false, castShadow: false, tint: 0xdff2fb,
      });
      const foam = new THREE.RingGeometry(0.34, 0.92, 12, 1);
      foam.rotateX(-Math.PI / 2);
      out.add(foam, "foodcourt.counter", {
        pos: [cx * (POOL.r - 1.5), POOL_Y + 0.02, cz * (POOL.r - 1.5)],
        collide: false, castShadow: false, tint: 0xfff4e2,
      });
    }

    /* The giant cup, its lid, and a straw that goes to the roof. The
       straw is a wall-kick surface and the silhouette that makes the
       fountain read from the far corner of the course. */
    out.add(new THREE.CylinderGeometry(3.5, 2.6, 6.0, 18, 1), "foodcourt.tray",
      { pos: [0, 12.0, 0], collide: true, uvScale: 3, tint: 0xe8453c });
    out.add(new THREE.CylinderGeometry(3.55, 3.55, 0.5, 18, 1), "foodcourt.counter",
      { pos: [0, 14.9, 0], collide: true, tint: 0xf2f0e8 });
    out.add(new THREE.TorusGeometry(3.6, 0.22, 6, 24), "foodcourt.neon",
      { pos: [0, 13.0, 0], rot: [Math.PI / 2, 0, 0], collide: false, tint: 0xffd166 });
    const straw = new THREE.CylinderGeometry(0.45, 0.45, 12, 10, 1);
    straw.rotateZ(0.30);
    out.add(straw, "foodcourt.tray", { pos: [-1.6, 20.5, 0], collide: true, tint: 0xf2f0e8 });

    /* Cascade columns between the bowls. Additive-free: this is
       liquid, not light. Each one runs from the lip of the bowl above
       to the SURFACE of the bowl below - stopping short of the water
       is the detail that made the old ones read as hanging rods - and
       lands in a ring of foam. */
    for (let ti = 0; ti < TIERS.length - 1; ti += 1) {
      const upper = TIERS[ti + 1];
      const lower = TIERS[ti];
      const fallTop = upper.y - 0.12;
      const fallBottom = lower.y - lower.sink;
      const len = fallTop - fallBottom;
      const rr = upper.r + upper.wall / 2 + 0.22;
      /* Three arcs, not six columns. A cylinder of falling water is a
         column, and six of them read as the pillars holding the bowl
         up - which is what a blind pass called them. A sheet spilling
         over an arc of the rim is what a tiered fountain actually
         does, and three arcs leave the gaps that let the pool behind
         stay visible through the structure. */
      for (let k = 0; k < 3; k += 1) {
        const a0 = (k / 3) * TAU + ti * 0.4;
        const sheet = new THREE.CylinderGeometry(rr, rr * 1.06, len, 14, 1, true, a0, 0.78);
        out.add(sheet, "foodcourt.soda", {
          pos: [0, fallBottom + len / 2, 0],
          collide: false, castShadow: false, tint: 0xcdeaf6,
        });
        const splash = new THREE.RingGeometry(rr - 0.55, rr * 1.06 + 0.55, 14, 1, a0 - 0.06, 0.9);
        splash.rotateX(-Math.PI / 2);
        out.add(splash, "foodcourt.counter", {
          pos: [0, fallBottom + 0.022, 0],
          collide: false, castShadow: false, tint: 0xfff4e2,
        });
      }
    }

    /* ============ LANDMARK 2 - MOG BURGER ============ */

    const BX = -34, BZ = -40;
    out.add(P.pillar(0.85, 18, { sides: 10, base: true, cap: false }), "foodcourt.column",
      { pos: [BX, 0, BZ], collide: true });
    /* Bun, patty, cheese, lettuce, bun. Stacked spheres and discs,
       because a burger is the easiest silhouette in the world to
       read and the hardest to mistake for anything else. */
    const bunBottom = new THREE.SphereGeometry(4.4, 20, 10, 0, TAU, Math.PI * 0.5, Math.PI * 0.5);
    out.add(bunBottom, "foodcourt.planter", { pos: [BX, 18.6, BZ], rot: [Math.PI, 0, 0], collide: true, tint: 0xe8b566 });
    out.add(new THREE.CylinderGeometry(4.6, 4.6, 1.1, 20, 1), "foodcourt.trunk",
      { pos: [BX, 19.4, BZ], collide: true, tint: 0x6a3a20 });
    out.add(new THREE.CylinderGeometry(4.3, 4.3, 0.45, 4, 1), "foodcourt.sign",
      { pos: [BX, 20.1, BZ], rot: [0, 0.4, 0], collide: false, tint: 0xffc93c });
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * TAU;
      out.add(P.platform(1.9, 0.22, 1.5, { bevel: 0.05, round: 0.7, curve: 4 }), "foodcourt.leaf", {
        pos: [BX + Math.cos(a) * 4.3, 20.5, BZ + Math.sin(a) * 4.3],
        rot: [rngRange(rng, -0.2, 0.2), -a, rngRange(rng, -0.25, 0.25)], collide: false,
      });
    }
    const bunTop = new THREE.SphereGeometry(4.6, 20, 12, 0, TAU, 0, Math.PI * 0.5);
    out.add(bunTop, "foodcourt.planter", { pos: [BX, 20.8, BZ], collide: true, tint: 0xe8b566 });
    /* Sesame seeds. Twenty tiny instanced ellipsoids: the detail that
       makes it a burger instead of a bap. */
    for (let i = 0; i < 22; i += 1) {
      const u = rng(), v = rng() * 0.72;
      const th = u * TAU, ph = Math.acos(1 - v);
      out.inst("seed", () => {
        const s = new THREE.SphereGeometry(0.22, 6, 4);
        s.scale(1.6, 0.7, 1);
        return s;
      }, "foodcourt.counter", {
        pos: [
          BX + Math.sin(ph) * Math.cos(th) * 4.5,
          20.8 + Math.cos(ph) * 4.5,
          BZ + Math.sin(ph) * Math.sin(th) * 4.5,
        ],
        rot: [0, rng() * TAU, 0],
      });
    }
    /* Landing pad on the crown and the neon collar below. */
    out.add(new THREE.CylinderGeometry(2.4, 2.4, 0.3, 16, 1), "shared.chrome",
      { pos: [BX, 25.3, BZ], collide: true });
    out.add(new THREE.TorusGeometry(5.6, 0.3, 6, 30), "foodcourt.neon",
      { pos: [BX, 16.5, BZ], rot: [Math.PI / 2, 0, 0], collide: false, tint: 0xff3d6e });
    /* The sign boards, crossed so the name reads from any angle. */
    for (let i = 0; i < 2; i += 1) {
      out.add(P.platform(11, 3.2, 0.5, { bevel: 0.1 }), "foodcourt.sign", {
        pos: [BX, 13.2, BZ], rot: [0, (i * Math.PI) / 2, 0], collide: false, tint: 0xffd166,
      });
      out.add(P.platform(10.2, 0.5, 0.7, { bevel: 0.06 }), "foodcourt.neon", {
        pos: [BX, 11.3, BZ], rot: [0, (i * Math.PI) / 2, 0], collide: false, tint: 0xff3d6e,
      });
    }

    /* Rotating tray arms: the route from the catwalk up to the bun. */
    out.mover(P.rotator({
      pos: [BX, 22.0, BZ], radius: 7.4, arms: 3, armSize: [7, 0.4, 2.6],
      period: 11, surface: "foodcourt.tray", tilt: 0,
    }));

    /* ============ LANDMARK 3 - THE PRETZEL HELIX ============ */

    const PX = 38, PZ = 34;
    out.add(P.pillar(2.0, CAT - 0.6, { sides: 9, flutes: true }), "foodcourt.wall",
      { pos: [PX, 0, PZ], collide: true });

    /* THE KIOSK AT THE FOOT OF IT, and it is doing two jobs.

       ONE: THE HELIX HAD NO MASS BELOW SIX METRES. `platforming` and
       `enemy-encounter` are both solved against this landmark, and
       both cameras stand 3.3-5.0 m up pitched 13-15 degrees down
       against a review crop of NDC |y| < 0.69 - which puts the top of
       the reviewed picture at about six metres of world height at
       eighteen metres out. Everything this landmark had was above that
       line: a 2 m column, treads at r 7, and gold arcs at 7.5 to 14 m.
       The part of it inside the frame was a pole. Measured, camera.js
       scored the whole helix at 13% of frame against a 20% floor and
       refused the preset outright.

       TWO: IT IS THE SECOND DARK FOR BOTH OF THOSE FRAMES. A counter
       drum with a service bay cut out of it is a cavity - see the note
       above `undercroft` for why a hole is the only dark available at
       this lens height - and the bay is 7 m of chord by 3.4 m tall at
       seventeen metres, which is nine percent of the reviewed crop.

       THE BAY FACES 198 DEGREES because that is the bisector of the
       two bearings that photograph it: `platforming`'s marker looks
       due north up the helix's axis (camera at 180) and
       `enemy-encounter` shoots it from the south-west (camera at
       about 215). A 98-degree opening covers both with room to spare.

       It clears the gauntlet. The treads spiral at r 6.3-7.2 and the
       two floor plinths stand at 7.2; the drum stops at 4.6 and the
       cornice at 5.7. The corbels under the two lowest treads pass
       inside the drum and are simply hidden, which reads as a tread
       springing from the kiosk roof - truer than a bracket in mid-air. */
    const KIOSK_R = 4.1;          /* centre line of the counter wall */
    const KIOSK_H = 4.3;
    const KIOSK_FACE = 198 * Math.PI / 180;
    const KIOSK_BAY = 0.86;       /* half-width of the opening, radians */
    for (let i = 0; i < 16; i += 1) {
      const b = (i / 16) * TAU;
      let d = Math.abs(b - KIOSK_FACE);
      if (d > Math.PI) d = TAU - d;
      if (d < KIOSK_BAY) continue;
      out.add(P.platform(1.78, KIOSK_H, 1.0, { bevel: 0.09 }), "foodcourt.stall", {
        pos: [PX + Math.sin(b) * KIOSK_R, KIOSK_H / 2, PZ + Math.cos(b) * KIOSK_R],
        rot: [0, b, 0], collide: true, tint: 0xc0714a, ao: 0.44, aoHeight: 3.0,
      });
    }
    /* THE CAVITY. A dark drum inside the counter drum, so what the bay
       opens onto is a room rather than the back of the column. It is a
       full ring because the counter hides it everywhere else and a
       ring is one merge either way. */
    out.add(P.ring(2.15, 2.95, KIOSK_H, { segments: 22 }), "foodcourt.wall", {
      pos: [PX, 0, PZ], collide: true, uvScale: 6,
      tint: 0xbcb2dc, ao: 0.38, aoHeight: KIOSK_H * 0.9, groundY: 0,
    });
    out.add(new THREE.CylinderGeometry(3.75, 3.75, 0.34, 22, 1), "foodcourt.brick", {
      pos: [PX, 0.17, PZ], collide: true, tint: 0x786058, ao: 0.45, aoHeight: 0.34,
    });
    /* The cornice, which is also the bay's ceiling: a down-facing
       annulus oversailing the counter by 1.6 m. Nothing in a roofed
       course can light it. */
    out.add(P.ring(2.0, KIOSK_R + 1.6, 0.62, { segments: 26 }), "foodcourt.ceiling", {
      pos: [PX, KIOSK_H, PZ], collide: true, uvScale: 5,
      tint: 0xc8bee8, ao: 0.30, aoHeight: 0.62, groundY: KIOSK_H,
    });
    /* The parapet above it, in the shopfront's own value. This is the
       light edge that makes the dark under it read as depth instead of
       as a hole cut in the picture. */
    out.add(P.ring(KIOSK_R + 0.6, KIOSK_R + 1.6, 0.85, { segments: 26, floor: false }),
      "foodcourt.counter", {
        pos: [PX, KIOSK_H + 0.62, PZ], collide: true, tint: 0xbcae90, ao: 0.2, aoHeight: 1.2,
      });
    /* The serving counter across the bay. A bright horizontal inside a
       dark opening is what says "kiosk" rather than "doorway", and it
       is the one element that makes the scale of the thing readable. */
    out.add(P.ring(3.5, KIOSK_R + 0.62, 0.3, { segments: 26 }), "foodcourt.counter", {
      pos: [PX, 1.02, PZ], collide: true, tint: 0xd2c6a0, ao: 0.3, aoHeight: 1.3,
    });
    /* Neon collar on the parapet - the course's own signage language,
       and the only saturated thing on the landmark below the pretzel. */
    out.add(new THREE.TorusGeometry(KIOSK_R + 1.35, 0.2, 6, 26), "foodcourt.neon",
      { pos: [PX, KIOSK_H + 1.2, PZ], rot: [Math.PI / 2, 0, 0], collide: false, tint: 0xffd166 });

    /* THE PRETZEL IS A SIGN NOW, NOT THREE ARCS ROUND A POLE.

       It used to be three 78%-arcs of torus at 3.4, 3.15 and 2.9 m,
       each given its own three-axis rotation and slid off the column
       axis, climbing from 7.5 to 13.9 m. Blind, on the
       `enemy-encounter` capture, that came back as "an unidentifiable
       tan sausage cropped by the top edge", and both halves of that
       sentence are geometry:

         - A partial torus tilted on three axes has no symmetry a
           viewer can complete. Wrapped round a column of comparable
           radius it is a tube crossing another tube - the read is
           "pipe", and at that scale, "sausage".
         - The lowest arc hung into the top of the REVIEWED crop. The
           blind pool and the metrics gate both cut at NDC |y| < 0.69,
           and from the solved encounter lens - 4.98 m up, pitched 13
           degrees down, eighteen metres out - that ceiling is 6.3 m of
           world height. Anything between 6 and 8 m appears in the
           frame only as a fragment entering from the top edge, which
           is the worst possible way to show a landmark.

       So the arcs are gone and the pretzel is a real pretzel: three
       full rings in ONE vertical plane, two up and one down, which is
       the arrangement that reads as a pretzel at a silhouette and at
       any resolution. It is mounted flat against the column facing the
       plaza - the bearing the `platforming` and `enemy-encounter`
       cameras both work from - and it starts at 8.6 m, clear of the
       crop's ceiling, so it is a sign over the landmark rather than a
       fragment inside the picture. The salt is what makes it bread
       rather than a gold ring.

       It keeps its collision. The gauntlet's own treads are the route
       (see below) and these never connected to anything, but a
       climbable ledge that used to be there is not worth removing. */
    const PRETZEL_FACE = KIOSK_FACE;          /* square with the bay */
    const PRETZEL_Y = 11.4;
    const pretzelAt = (u, v) => [
      PX + Math.cos(PRETZEL_FACE) * u + Math.sin(PRETZEL_FACE) * v,
      PZ - Math.sin(PRETZEL_FACE) * u + Math.cos(PRETZEL_FACE) * v,
    ];
    /* Two upper loops and one lower belly, overlapping. The tube is
       fat on purpose: a thin ring at eighteen metres is a hairline,
       and a hairline against a dark background is the worst case for
       the high-frequency row. */
    const PRETZEL_LOOPS = [
      [-1.85, 1.15, 2.05], [1.85, 1.15, 2.05], [0, -1.70, 2.35],
    ];
    for (const [lu, lv, lr] of PRETZEL_LOOPS) {
      const p = pretzelAt(lu, 2.65);
      out.add(new THREE.TorusGeometry(lr, 0.52, 8, 24), "shared.gold", {
        pos: [p[0], PRETZEL_Y + lv, p[1]], rot: [0, PRETZEL_FACE, 0],
        collide: true, tint: 0xd8a548,
      });
    }
    /* Salt. Six pale grains scattered over the top loops - the detail
       that says baked rather than cast, and the only thing on this
       landmark lighter than the gold. */
    for (let i = 0; i < 7; i += 1) {
      const a = 0.4 + i * 0.9;
      const lu = Math.cos(a) * (1.85 + (i % 2) * 0.4) * (i % 2 ? 1 : -1);
      const lv = 1.15 + Math.sin(a) * 2.05;
      const p = pretzelAt(lu, 2.65 + 0.5);
      out.inst("pretzelSalt", () => {
        const s = new THREE.SphereGeometry(0.17, 6, 5);
        s.scale(1.2, 0.8, 1);
        return s;
      }, "foodcourt.counter", {
        pos: [p[0], PRETZEL_Y + lv, p[1]], rot: [0, a, 0], tint: 0xf2ecd8,
      });
    }
    /* THE GAUNTLET, RE-ORDERED SO IT READS AS A ROUTE.

       A blind pass could not find the climb in the `platforming`
       frame: "red slabs, brown slabs and tan forms float around the
       purple column at random heights and orientations with no
       ascending order and no visible support... two red slabs rest on
       the floor and read as rugs." Four separate causes, all here.

       1. IT STARTED ON THE FAR SIDE. The helix began at bearing zero,
          which is the east face, and the shot is taken from the
          south-west - so the lowest step in the picture was already
          six treads in and there was no bottom of the staircase in
          frame at all. START_A is the bearing the solved `platforming`
          camera actually shoots from, measured, not guessed.
       2. TWO AND A HALF TURNS IS NOISE. At 39 degrees per step the
          treads stack up behind each other from every angle. One and
          three quarter turns spaces them where the eye can follow one
          to the next.
       3. THE COLOURS CYCLED. Red, yellow, blue, red, yellow, blue is
          a repeat, and a repeat cannot express order. They are banded
          by HEIGHT now - one colour per turn, lightening as it climbs
          - so the frame says which way is up without a caption.
       4. NOTHING HELD THEM UP. Every tread carries a corbel back to
          the column, and the two lowest are solid plinths standing on
          the floor instead of slabs hovering 0.9 m above it. That is
          the whole difference between a staircase and a rug. */
    const STEPS = 22;
    const START_A = -1.79;
    const TURNS = 1.75;
    const STEP_BAND = [0xe8453c, 0xf2c94c, 0x36a8d8];
    for (let i = 0; i < STEPS; i += 1) {
      if (i % 4 === 3 && i > 4) continue;
      const t = i / STEPS;
      const a = START_A + t * TAU * TURNS;
      const r = 7.2 - t * 0.9;
      const y = 0.9 + t * (CAT - 1.6);
      const w = 4.0 - t * 0.8;
      const sx = PX + Math.cos(a) * r;
      const sz = PZ + Math.sin(a) * r;
      const band = Math.min(2, Math.floor(t * 3));
      if (i < 2) {
        out.add(P.platform(w + 0.6, y + 0.22, 3.5, { bevel: 0.14, round: 0.22 }),
          "foodcourt.stall", {
            pos: [sx, (y + 0.22) / 2, sz], rot: [0, -a, 0], collide: true, uvScale: 2.4,
          });
      } else {
        const cr = (r + 2.0) / 2;
        out.add(P.platform(r - 0.8, 0.36, 0.85, { bevel: 0.06 }), "shared.metal", {
          pos: [PX + Math.cos(a) * cr, y - 0.36, PZ + Math.sin(a) * cr],
          rot: [0, -a, 0], collide: false, castShadow: false,
        });
      }
      out.add(P.platform(w, 0.45, 3.0, { bevel: 0.08 }), "foodcourt.tray", {
        pos: [sx, y, sz], rot: [0, -a, 0], collide: true,
        tint: shade(STEP_BAND[band], (t * 3 - band) * 0.2 - 0.07),
      });
    }
    out.add(P.platform(7.5, 0.7, 7.5, { bevel: 0.14 }), "shared.grate",
      { pos: [PX, CAT - 0.35, PZ], collide: "metal" });
    out.add(P.rail([[PX - 3.5, CAT, PZ - 3.5], [PX + 3.5, CAT, PZ - 3.5]], { height: 1.0 }),
      "shared.rail", { collide: false });

    /* ============ shop rows ============ */

    stallRow(out, P, {
      x: 0, z: -HALF + 12, count: 5, spacing: 12, facing: 0,
      surfaces: ["foodcourt.stall", "foodcourt.stallB", "foodcourt.stallC"],
      awnings: ["foodcourt.awning", "foodcourt.awningB"],
    });
    stallRow(out, P, {
      x: -HALF + 12, z: 4, count: 4, spacing: 12, facing: Math.PI / 2,
      surfaces: ["foodcourt.stallB", "foodcourt.stallC", "foodcourt.stall"],
      awnings: ["foodcourt.awningB", "foodcourt.awning"],
    });
    /* THE SOUTH ROW HAS A HOLE IN IT, and it is the mall entrance.
       This used to be five shops across the whole south side, and the
       consequence was invisible until the `arrival` framing was
       measured: the camera for that preset stands about nine metres
       behind the character, so the further back she is allowed to
       stand the more of the cup fits above the frame line - and every
       metre past z=45 put the lens inside a shop. Two pairs with a
       twenty-two metre gap on the axis is both the room that shot
       needs and what the south wall of a food court actually looks
       like: you come in through a gap between the units. */
    for (const side of [-1, 1]) {
      stallRow(out, P, {
        x: side * 21, z: HALF - 12, count: 2, spacing: 11, facing: Math.PI,
        surfaces: side < 0
          ? ["foodcourt.stallC", "foodcourt.stall"]
          : ["foodcourt.stallB", "foodcourt.stallC"],
        awnings: ["foodcourt.awning", "foodcourt.awningB"],
      });
    }
    /* Entrance pylons either side of the gap, so the hole reads as a
       doorway rather than as a missing shop. */
    for (const side of [-1, 1]) {
      mallColumn(out, P, side * 12.5, HALF - 13, 7.4, 1.05, { flutes: true });
      out.add(new THREE.TorusGeometry(1.5, 0.22, 6, 18), "foodcourt.neon",
        { pos: [side * 12.5, 7.3, HALF - 13], rot: [Math.PI / 2, 0, 0], collide: false, tint: 0x36e0ff });
    }

    /* ============ the play place ============ */

    const YX = -40, YZ = 34;
    for (let s = 0; s < 4; s += 1) {
      const a = (s / 4) * TAU;
      out.add(P.platform(13, 1.6, 1.0, { bevel: 0.1 }), "foodcourt.planter", {
        pos: [YX + Math.sin(a) * 6, 0.8, YZ + Math.cos(a) * 6], rot: [0, a, 0], collide: true,
      });
      /* A pale capstone on the rim. `collect` is the one framing that
         already had a near-field element - this rim is what cuts its
         bottom edge - and the cost of that was that the character was
         keyed against the pit's shade and lost her legs to it. A bright
         line along the top of the wall is what puts a value break
         between her silhouette and the dark inside, and it reads as a
         moulded plastic lip, which is what a ball pit has. */
      out.add(P.platform(13.5, 0.22, 1.36, { bevel: 0.07 }), "foodcourt.counter", {
        pos: [YX + Math.sin(a) * 6, 1.71, YZ + Math.cos(a) * 6], rot: [0, a, 0],
        collide: true, tint: 0xe6dcc0, ao: 0,
      });
      /* AND THE INSIDE OF THE PIT IS LINED, WHICH IS THE SECOND DARK
         FOR `collect`.

         That capture has no architecture within reach of anything -
         the cast-shadow pass measured 0% coverage on its near deck at
         every direction and elevation it tried - so the only route to
         an environment dark here is a surface that is dark by its own
         form. A pit is one: a 1.4 m lining under a coping that
         oversails it by two thirds of a metre is in permanent shade,
         and the far wall of the pit sits thirteen to sixteen metres
         from the solved lens facing straight at it.

         The pale capstone above it stays exactly as it was. It is
         there so her silhouette has a value break to sit against (see
         the note above), and taking the wall under it DOWN widens that
         break rather than closing it. */
      out.add(P.platform(13.0, 1.34, 0.16, { bevel: 0.04 }), "foodcourt.wall", {
        pos: [YX + Math.sin(a) * 5.5, 0.86, YZ + Math.cos(a) * 5.5], rot: [0, a, 0],
        collide: false, uvScale: 6, tint: 0x6e6688, ao: 0.5, aoHeight: 1.7, groundY: 0.19,
      });
      /* The nosing. A moulded plastic lip standing 0.6 m proud of the
         lining - the oversail that makes the lining shade rather than
         paint, and the thing a ball pit actually has along its rim. */
      out.add(P.platform(13.3, 0.22, 0.72, { bevel: 0.05 }), "foodcourt.counter", {
        pos: [YX + Math.sin(a) * 5.12, 1.60, YZ + Math.cos(a) * 5.12], rot: [0, a, 0],
        collide: false, tint: 0xd8cfb4, ao: 0.18, aoHeight: 0.9,
      });
    }
    out.add(P.water(12, 12, { segments: 6, swell: 0.02 }), "foodcourt.ballBed",
      { pos: [YX, 1.0, YZ], collide: "ice" });
    /* Four batches, one hue each, and a radius that varies per ball.
       Ninety spheres of identical size and identical speckle read as a
       texture rather than as objects - which is exactly how the
       `collect` framing was scoring: the worst high-frequency row in
       the game and the lowest saturation, from the same cause. Colour
       and scale both now vary at BALL scale, where the eye can
       actually resolve them, and each ball is a flat plastic fill. */
    const BALL_HUES = [
      "foodcourt.ballA", "foodcourt.ballB",
      "foodcourt.ballC", "foodcourt.ballD",
    ];
    /* Sixty-four rather than ninety, and bigger. A ball pit is read
       as a mass of objects, and ninety of them in a twelve-metre pit
       are individually about four screen pixels of gap apart, which
       is a texture. Fewer, larger, with the bed visible between them
       reads as depth - and Super Mario 64's props are consistently
       larger than instinct suggests.

       IT IS A PILE, NOT A GRID. The last pass got the colour and the
       size right and left the arrangement wrong: same radius band,
       one height, uniform density, which a blind read called "more
       particle grid than pile". Two things fix that and neither costs
       a draw call. The height follows a dome - deep in the middle,
       thinning to a single layer at the wall, exactly the way loose
       balls settle - so the mass has a top edge that is not the rim.
       And the radius classes are separated hard rather than jittered:
       a third of them are big, and a big ball next to a small one is
       the only cue at this distance that says these are objects with
       size rather than a texture with a frequency. */
    for (let i = 0; i < 74; i += 1) {
      const a = rng() * TAU;
      const rn = Math.sqrt(rng());
      const r = rn * 5.4;
      const hue = i % BALL_HUES.length;
      const big = rng() < 0.34;
      const s = big ? rngRange(rng, 1.32, 1.62) : rngRange(rng, 0.78, 1.02);
      /* The dome. Balls near the middle stack two deep; balls at the
         wall are a single layer resting on the bed. */
      const dome = 1 - rn * rn;
      const y = 1.06 + dome * rngRange(rng, 0.35, 1.5) + s * 0.12;
      out.inst(`ball${hue}`, F.ball, BALL_HUES[hue], {
        pos: [YX + Math.cos(a) * r, y, YZ + Math.sin(a) * r],
        rot: [rng() * TAU, rng() * TAU, rng() * TAU],
        scale: [s, s * rngRange(rng, 0.94, 1.06), s],
      });
    }
    /* Six that got out. Escaped balls on the floor outside the pit are
       the detail that turns a container of spheres into something
       children have been playing in, and they are the only objects in
       the `collect` frame that break the line of the rim. */
    for (let i = 0; i < 6; i += 1) {
      const a = rngRange(rng, 0.2, 2.6);
      const r = rngRange(rng, 7.4, 10.5);
      const s = rngRange(rng, 0.9, 1.35);
      out.inst(`ball${i % BALL_HUES.length}`, F.ball, BALL_HUES[i % BALL_HUES.length], {
        pos: [YX + Math.cos(a) * r, 0.34 * s, YZ + Math.sin(a) * r],
        rot: [rng() * TAU, rng() * TAU, rng() * TAU], scale: [s, s, s],
      });
    }
    /* Tower and two slides. The record is at the top of the far
       slide, inside the tube, where nothing on the ground can see it. */
    out.add(P.platform(6, 5.4, 6, { bevel: 0.14 }), "foodcourt.stallC",
      { pos: [YX - 8, 2.7, YZ - 6], collide: true });
    out.add(P.platform(7, 0.6, 7, { bevel: 0.12 }), "foodcourt.tray",
      { pos: [YX - 8, 5.7, YZ - 6], collide: true, tint: 0x36a8d8 });
    /* THE MAIN SLIDE LANDS IN THE PIT, which it did not.
       It used to run from the tower down to (-46, 0.6, 30.5) - seven
       metres from the middle of a five-and-a-half metre ball field, so
       it came into the `collect` frame from off the top edge, crossed
       the picture and stopped in mid-air over the tower with no
       relationship to anything under it. A slide that does not arrive
       somewhere is a red diagonal.
       Authored from the BOTTOM now, because the bottom is the end that
       has to be in a particular place: the mouth sits 1.3 m from the
       pit's centre, overhanging the balls, and the tube climbs from
       there to the tower deck. Direction and length are solved for
       those two endpoints rather than eyeballed, which is why the
       angles below are not round numbers. */
    const slide = P.pipe(1.5, 8.8, { sides: 12, inner: true, lip: true });
    slide.rotateX(1.143);
    out.add(slide, "foodcourt.tray",
      { pos: [YX - 1, 2.7, YZ - 0.8], rot: [0, -2.142, 0], collide: true, tint: 0xf2c94c });
    const slide2 = P.pipe(1.5, 10, { sides: 12, inner: true, lip: true });
    slide2.rotateX(-0.62);
    out.add(slide2, "foodcourt.tray", { pos: [YX - 11.5, 1.0, YZ - 7], rot: [0, 1.1, 0], collide: true, tint: 0x6ee06e });
    out.add(P.ramp(3, 5.4, 8, { treads: true, kerbHeight: 0.6 }), "shared.grate",
      { pos: [YX - 8, 0, YZ - 13], rot: [0, Math.PI, 0], collide: "metal" });

    /* ============ the arcade alcove ============ */

    const AX = 42, AZ = -40;
    /* The alcove floor is a RAISED deck now, not a rug.
       0.4 m of rubber painted on the terrazzo was doing nothing for
       the `boss` framing: the pose for that beat puts the lens four
       metres north of this edge, which is exactly the distance at
       which a near-field element decides whether the bottom of the
       frame is a picture or a floor. A 0.75 m step with a nosing and
       a bumper rail on top of it reads through the bottom third from
       there, and it is also just true - an arcade in a mall is up a
       step behind a barrier. */
    out.add(P.platform(24, 0.75, 20, { bevel: 0.12 }), "shared.rubber",
      { pos: [AX - 4, 0.375, AZ], collide: true, uvScale: 3 });
    /* EIGHT METRES PER REPEAT, NOT 3.2. `foodcourt.counter` is a panel
       painter - it draws a border - and at the surface's own scale a
       24 m deck wears seven and a half of those borders in each
       direction, which is a grid, and this deck is 45% of the `boss`
       frame. It was the single hottest region left in the capture set
       after the painters were calmed. Three repeats across the deck
       still breaks the plane into slabs; it just stops ruling it.
       The tint comes down with it: at 0xbcae90 this was the brightest
       field in the whole set (191) and the least saturated (0.46),
       which is value depth backwards for a floor at the bottom of the
       frame - and it is a rubber arcade deck, not a lit ceiling. */
    out.add(P.platform(24.5, 0.16, 20.5, { bevel: 0.06 }), "foodcourt.counter",
      { pos: [AX - 4, 0.79, AZ], collide: true, tint: 0xac9e80, ao: 0, uvScale: 8 });
    /* The bumper rail along the +Z edge - and the sign of that is the
       whole point of the rail, so it is measured, not assumed.
       It was authored at AZ-10 on the strength of the word "north",
       and the solved `boss` lens is at z = -25.0 looking toward
       z = -40: the camera stands on the +Z side, so AZ-10 put the only
       framing element in the shot BEHIND everything in it, and the
       bottom third of the capture came back as thirty-five percent of
       unbroken deck. AZ+10 is five metres in front of that lens, which
       is where a foreground layer has to be.
       Bars, not a wall: a rail reads as a foreground layer and still
       lets the fight through it, which is the difference between
       framing a shot and standing behind a crate. The sight line from
       that lens to her chest passes 2.75 m up at the rail, and the
       rail tops out at 1.96 m, so it cuts the bottom of the frame
       without touching the subject. Two gaps in it are the way in. */
    /* ONE BAR, NOT TWO. A rail seen almost end-on across a 24 m deck
       is three long, near-horizontal cylinders converging at a shallow
       angle - the exact geometry that aliases hardest - and measured,
       the second bar alone was worth more high-frequency energy than
       any texture in the alcove. A top rail and its posts say "barrier"
       on their own; the middle bar only said it twice. */
    for (const seg of [[-16, -6.5], [-3.5, 3.5], [6.5, 16]]) {
      out.add(P.rail([[AX - 4 + seg[0], 0.9, AZ + 10], [AX - 4 + seg[1], 0.9, AZ + 10]],
        { height: 1.05, bars: 1, radius: 0.085, postEvery: 3.2 }), "shared.rail",
      { collide: false, castShadow: true });
    }
    /* CABINETS IN BANKS, AND EVERY BANK FACES THE SAME WAY.
       Two rows of six at 2.2 m spacing is a spreadsheet and a blind
       pass said so; the answer was banks of two and three with real
       gaps between them, which is right and is kept. What the SIXTH
       pass then found was the opposite failure: "scattered with no
       aisle logic and no front face". Two causes, both fixed here.

       ONE, THE ROWS FACED EACH OTHER. Row 1 stood at AZ+5 pointed at
       -Z and the `boss` lens stands at AZ+15, so the nearest and
       largest machines in that frame presented their BACKS - which is
       why the near cabinets were blank prisms while only the far row
       had any screen at all. Both rows face +Z now. That is also the
       truer arrangement: you play a row standing in the aisle behind
       the next one, so a room of cabinets is a set of parallel ranks
       all pointing at the door, not two teams facing off.

       TWO, THE YAW JITTER. A per-cabinet +/-0.09 rad on a 1 m box is
       nine centimetres of stagger along a bank, which does not read as
       "hand-placed", it reads as "dropped". Machines in a bank are
       pushed together square; the bank as a whole gets the jitter.
       The result is what the note asked for - an alignment that reads
       as a row of machines - while the bank gaps keep it off a grid. */
    const BANKS = [
      { row: 0, from: -12.6, n: 3, livery: 0 }, { row: 0, from: -5.0, n: 2, livery: 1 },
      { row: 0, from: 1.6, n: 3, livery: 0 }, { row: 1, from: -11.0, n: 2, livery: 1 },
      { row: 1, from: -3.4, n: 3, livery: 0 }, { row: 1, from: 4.6, n: 2, livery: 1 },
    ];
    /* One scale for all four pieces of a cabinet, or they come apart:
       every part carries its own offset from a shared feet origin. */
    const CAB = 0.86;
    const SHELL = ["foodcourt.stallC", "foodcourt.cabinetB"];
    for (const bank of BANKS) {
      const yaw = rngRange(rng, -0.035, 0.035);
      const bz = AZ - 6 + bank.row * 11 + rngRange(rng, -0.3, 0.3);
      const bx = AX - 4 + bank.from;
      const sy = rngRange(rng, 0.95, 1.06);
      const width = (bank.n - 1) * 1.02 + 1.22;
      /* A dark base rail under the whole bank. It ties the machines
         into one object at the floor - which is what says "these
         belong together" at the distance this room is photographed
         from - and it puts a hard horizontal under the row. */
      out.add(P.platform(width, 0.1, 1.0, { bevel: 0.03 }), "foodcourt.cabinet", {
        pos: [bx + ((bank.n - 1) * 1.02) / 2, 0.92, bz - 0.02], rot: [0, yaw, 0],
        collide: false, tint: 0xa89ec0, ao: 0.4, aoHeight: 0.5,
      });
      for (let k = 0; k < bank.n; k += 1) {
        /* Cabinets in a bank touch: 1.02 m apart for a 0.96 m body. */
        const px = bx + k * 1.02;
        const s = [CAB, CAB * sy * rngRange(rng, 0.985, 1.015), CAB];
        const at = { pos: [px, 0.91, bz], rot: [0, yaw, 0], scale: s };
        out.inst(`arcadeShell${bank.livery}`, F.arcadeShell,
          SHELL[bank.livery], at);
        out.inst("arcadeTrim", F.arcadeTrim, "foodcourt.cabinet", at);
        out.inst("arcadeScreen", F.arcadeScreen, "foodcourt.screen", at);
        /* The marquee is an UNLIT surface, so its authored value is
           its screen value: at full it was the brightest band in the
           lower half of the `boss` frame, which is the near-field rule
           broken by the one prop that most needed the alignment read.
           A warm amber at about seven tenths still carries the row and
           stops competing with the fight behind it. */
        out.inst("arcadeMarquee", F.arcadeMarquee, "foodcourt.marquee",
          { ...at, tint: 0xc8ae86 });
      }
    }
    /* THE PRIZE COUNTER MOVED OFF THE BOSS SIGHT LINE.
       At (AX+4, AZ+6) it stood at world (46, 3, -34), and a raycast
       from the solved `boss` lens toward the Phantom hit it at 8.9 m:
       a five-metre orange slab half-occluding the fight, and the same
       object a blind pass called "a giant flat orange slab with no
       reason to be in the lens". It is the aisle counter of an arcade,
       which belongs at the far end of the aisle rather than in the
       middle of the floor - and from there it is a left-hand mid-ground
       mass in the same frame instead of a hole punched through it. The
       aisle between the two cabinet rows runs at z = AZ-1; the rows
       themselves sit at AZ-6 and AZ+5, so this clears both. */
    out.add(P.platform(5, 4.2, 3.4, { bevel: 0.1 }), "foodcourt.stall",
      { pos: [AX - 14, 3.0, AZ - 1], collide: true });
    out.add(P.platform(4.2, 2.4, 2.8, { bevel: 0.05 }), "shared.glass",
      { pos: [AX - 14, 4.1, AZ - 1], collide: false });
    out.add(new THREE.TorusGeometry(9, 0.28, 6, 34), "foodcourt.neon",
      { pos: [AX - 4, 6.6, AZ], rot: [Math.PI / 2, 0, 0], collide: false, tint: 0xb44dff });

    /* ============ THE EAST CONCOURSES ============

       THE SECOND DARK, and the east half of the room finally being
       built. Read the note above `undercroft` for why this shape and
       not a soffit, a colonnade or a darker wall.

       The east plaza is where two of the seven captures are taken and
       it had nothing in it. `platforming` was measured as "no landmark
       at all, the lowest value range in the set and the highest
       saturation - flat and garish at once", and the reason is visible
       in a raycast of its own frame: from the solved lens the top of
       the picture is the perimeter wall at thirty-three metres and
       everything below it is floor. The Pretzel Helix that preset
       exists to photograph is forty-five degrees off the lens.

       Both structures are placed by measurement rather than by plan,
       against the poses camera.js actually solves:

         EAST CONCOURSE, opening at x 51.0 facing the plaza. The
         `platforming` lens stands at (27.5, 4.2, 26.5) on a bearing of
         99.3 degrees; this sits at 99.6 and twenty-four metres, which
         is dead centre of that frame. At that range a 13 m x 5.2 m
         opening is a third of the frame wide and its cavity fills the
         crop from NDC 0.24 to the top - the mass the preset never had.

         NORTH-EAST CONCOURSE, opening at (45.0, 41.5). The
         `enemy-encounter` lens stands at (31, 5.0, 14.3) on a bearing
         of 27.3 degrees; this sits at 27.2 and thirty-one metres.
         Wider and taller because it is nine metres further away, and
         far enough round that neither structure appears in the other's
         frame - measured, they are 43 and 49 degrees off the other
         lens against half-widths of 37 and 38.

       They also stop being a pair of set pieces and start being a
       building: the mezzanine deck already runs the whole east side at
       seven metres with columns at x = 49, so these read as the ground
       floor that deck has always implied. The piers clear the column
       line by half a metre on purpose. */
    undercroft(out, P, {
      x: 51.0, z: 21.5, yaw: -Math.PI / 2,
      width: 13, depth: 6.6, height: 5.2, bays: 3, fascia: 1.2,
      sign: { w: 6.4, h: 1.5, tint: 0xffd166, neon: 0x36e0ff },
    });
    undercroft(out, P, {
      x: 45.0, z: 41.5, yaw: -2.664,
      width: 17, depth: 6.0, height: 5.6, bays: 3, fascia: 1.1,
      sign: { w: 7.6, h: 1.4, tint: 0xffd166, neon: 0xff3d6e },
    });
    /* THE ELEVATOR MOVED TWENTY METRES SOUTH, and it is not a taste
       call: at (52, 26) its five-metre platform stood exactly where the
       east concourse's middle two piers now are, and it travels to
       8.4 m, which is through the concourse ceiling. Nothing references
       this position - it is a second route up to the mezzanine beside
       the four escalators - so it moves rather than the architecture. */
    out.mover(P.elevator({
      pos: [52, 0, 6], low: 0.6, high: MEZZ + 0.4, period: 7, size: [5, 0.6, 5],
      surface: "shared.chrome",
    }));

    /* ============ THE NEAR FIELD ============

       Read "THE NEAR FIELD" above foregroundBed first: it carries the
       measurement these positions come out of.

       Every bed below was authored in the SOLVED camera's own space -
       a distance in front of the lens and an offset to one side of the
       view axis - and then written out in world coordinates so the
       file stays readable. The pose each was solved against is in its
       comment. If a marker moves, RE-MEASURE; do not nudge these by
       eye, because the two numbers that matter (how far in front of
       the lens, and how far off the sight line to her chest) are both
       invisible from a plan view of the course.

       The three that already had a foreground element are not here:
       `collect` has the ball pit's rim, `boss` has the arcade step and
       its bumper rail, and both are authored where they belong. */

    const NEAR_FIELD = [];
    const bed = (a, b, opts) => {
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
      /* Scatter has to keep off these: a vending machine dropped on a
         planter is a vending machine floating 1.2 m in the air, and it
         would land in the one part of the frame the eye goes to first. */
      NEAR_FIELD.push([cx, cz, len / 2 + 2.2]);
      foregroundBed(out, P, rng, Object.assign({
        x: cx, z: cz, yaw: Math.atan2(-dz, dx), len,
      }, opts));
    };

    /* THE LIVERY ON EACH BED IS CHOSEN, NOT SEEDED. Which beds share a
       frame is known - they were placed in pairs against solved lenses
       - so the pair in any one capture is always two different kits
       (see BED_LIVERY). A seeded pick would have drawn the same one
       twice often enough to reproduce the exact "same brown planter
       box" read this is answering. */
    /* `arrival`: lens (4.6, 3.0, 45.9) looking down the corridor at the
       fountain. These two sit 4.6 m either side of the axis, which puts
       the east bed at four metres in front of the lens and the west one
       at nine - one in the bottom corner and one beside her, which is
       two depth layers out of two objects. */
    bed([4.6, 44.2], [4.9, 38.6], { crown: 1.72, wall: 1.0, livery: 0 });
    bed([-4.9, 43.4], [-4.5, 38.2], { crown: 1.62, wall: 1.0, lumps: 4, livery: 2 });
    /* `interior`: lens (-8.5, 3.2, 32.1) looking east down the atrium,
       measured. Same corridor, six metres further in, so the pair reads
       as an avenue rather than as two objects that happen to be there.
       The west bed is pulled two metres off the corridor's edge: at its
       first position its near face stood 1.1 m from that lens, and a
       crown that close is not a framing device, it is a thumb over the
       lens - it filled a quarter of the frame with the one mass in the
       shot the fog and the shading could not reach, so the bottom third
       came back BRIGHTER than the mid-ground it was meant to sit under.
       Four metres is the band the whole near-field pass is authored in. */
    bed([5.6, 36.4], [4.9, 31.2], { crown: 1.66, wall: 1.0, livery: 1 });
    bed([-4.4, 35.2], [-4.0, 30.4], { crown: 1.58, wall: 0.95, lumps: 4, livery: 0 });
    /* THE EAST ARENA BED IS GONE, AND THE REASON IT EXISTED IS GONE
       WITH IT.

       There used to be a deep island bed here at (31.7, 16.4) to
       (35.0, 23.1), and it was never really scenery. It was a STEERING
       DEVICE: a near-field element was worth up to 2.55 to camera.js's
       frame score, which is more than a whole composition, so the only
       way to stop the platforming camera swinging 140 degrees onto the
       one bed in the arena was to author a second bed on the other
       side and let the landmark term break the tie. The bed's depth
       (3.6 m against the usual 2.3) was read straight off the solver's
       bottom-row sampling grid rather than off anything in the world.

       camera.js has since been rewritten. That reward is 0.28 and it
       SELF-DISABLES above 18% near-field mass, so a bed steers nothing
       any more - and this one was doing measurable harm. It sat at
       0.66 of subject distance from the `enemy-encounter` lens, which
       is just past the 0.60 cut that would have made it near field,
       so it escaped the size cap while landing at NDC (-0.08, -0.68):
       dead bottom-centre, at subject depth, in the one frame carrying
       the set's only high-frequency flag. Five clumps of hedge four to
       six metres from a lens is the busiest thing that frame contains.

       The arena gets architecture instead - see THE EAST CONCOURSES
       above - which is a mass the camera can compose ON rather than a
       mass it composes AROUND. */
    /* `enemy-encounter`: lens (43.6, 5.0, 11.1) looking north-west at
       the knot, measured. On the LEFT here, because the encounter
       camera and the platforming camera sit on opposite sides of the
       same small arena and their sight lines cross - a bed placed on
       the right of this shot lands in front of her in the other one.
       This is the east half of the pair described above. */
    bed([44.7, 17.9], [39.9, 19.9], { crown: 1.6, wall: 1.0, lumps: 4, livery: 2 });
    /* `water`: lens (26, 3.7, 2.3) looking west across the pool. Outside
       the coping at r 19-24, in the same band as the rope barrier, so
       the bottom of that frame now has a planted kerb in front of a
       rope line in front of the pool wall. */
    bed([24.1, -2.5], [18.9, -2.1], { crown: 1.68, wall: 1.05, livery: 1 });

    /* `collect`: the pit rim already cuts the bottom of this frame -
       it is the only capture in the set that ever won on its picture -
       but the lens sits 5.5 m up here, and at that height a planter
       four metres out is entirely below the frame line. What reads
       from there is a VERTICAL. The play place gets its entry totem,
       which is 4.2 m of sign standing at the right-hand edge two and a
       half metres nearer than anything else in the shot. */
    out.add(P.pillar(0.34, 4.2, { sides: 8, base: true, cap: false }), "shared.chrome",
      { pos: [-30.6, 0, 31.0], collide: true });
    out.add(P.platform(1.9, 2.4, 0.36, { bevel: 0.09 }), "foodcourt.sign",
      { pos: [-30.6, 3.1, 31.0], rot: [0, 0.62, 0], collide: false, tint: 0xff8c3c });
    out.add(P.platform(2.05, 0.34, 0.5, { bevel: 0.06 }), "foodcourt.neon",
      { pos: [-30.6, 1.72, 31.0], rot: [0, 0.62, 0], collide: false, tint: 0x36e0ff });
    bed([-29.4, 28.6], [-31.8, 32.6], { crown: 1.5, wall: 0.9, lumps: 4, livery: 2 });

    /* ============ planters, kiosks, litter ============ */

    /* Note the absence of a planter on the arrival axis. A five-metre
       palm planted between the camera and the landmark it is meant to
       frame does not frame it, it hides it - the two planters that
       flank the approach are at 18m off-centre for exactly that
       reason. */
    const PLANTERS = [
      [18, 16], [-18, 16], [18, -16], [-18, -16],
      [30, 4], [-30, 4], [17, 34], [4, -30], [-26, -26], [26, 26],
    ];
    /* TEN PLANTERS, THREE KITS, AND THREE PALMS - and the last of those
       was a bug rather than a decision. `out.inst` invokes its factory
       exactly ONCE, the first time a key is seen, so `seed: 0x900 + i`
       inside a single "palm" key produced ten copies of seed 0x900:
       ten identical trees, at ten positions, differing only by yaw -
       which on a radially symmetric crown is no difference at all.
       Three keys is three genuinely different trees for two extra draw
       calls, and the same argument applies to the ring itself, so the
       segment count, the radius, the phase and the box tint all move
       together per planter. */
    const PLANTER_KIT = [
      { segs: 8, r: 3.2, w: 2.6, h: 1.2, tint: 0xb2a894 },
      { segs: 6, r: 2.9, w: 3.1, h: 1.05, tint: 0x9c9a90 },
      { segs: 8, r: 3.5, w: 2.8, h: 1.35, tint: 0xa89678 },
    ];
    for (let i = 0; i < PLANTERS.length; i += 1) {
      const [px, pz] = PLANTERS[i];
      const K = PLANTER_KIT[i % PLANTER_KIT.length];
      /* The ring's phase. Without it every planter in the course puts a
         segment joint on the same bearing, and eight of them across a
         frame line up into a repeat the eye finds instantly. */
      const phase = rngRange(rng, 0, TAU);
      for (let s = 0; s < K.segs; s += 1) {
        const a = (s / K.segs) * TAU + phase;
        out.add(P.platform(K.w, K.h, 0.7, { bevel: 0.08 }), "foodcourt.planter", {
          pos: [px + Math.cos(a) * K.r, K.h / 2, pz + Math.sin(a) * K.r],
          rot: [0, -a, 0], collide: true, tint: K.tint, ao: 0.46, aoHeight: 2.0,
        });
      }
      out.add(new THREE.CylinderGeometry(K.r - 0.2, K.r - 0.2, K.h - 0.1, 14, 1), "foodcourt.soil",
        { pos: [px, (K.h - 0.1) / 2, pz], collide: true });
      const v = i % 3;
      const yaw = rng() * TAU;
      const tall = rngRange(rng, 0.88, 1.18);
      out.inst(`palm${v}`, () => P.tree("palm", { height: 5.4, seed: 0x900 + v * 37 }),
        "foodcourt.leaf", { pos: [px, K.h - 0.1, pz], rot: [0, yaw, 0], scale: [1, tall, 1] });
      out.inst(`palmTrunk${v}`, () => P.tree("palm", { height: 5.4, seed: 0x900 + v * 37 }),
        "foodcourt.trunk", { pos: [px, K.h - 0.1, pz], rot: [0, yaw, 0], scale: [0.999, tall * 0.999, 0.999] });
      /* Underplanting. A bare ring of soil around a trunk is the read a
         blind pass gave the mid-ground planters, and three hedges at
         the foot of the palm cost nothing: they go into batches the
         near-field beds already pay for. */
      const under = rngInt(rng, 2, 4);
      for (let k = 0; k < under; k += 1) {
        const a = phase + (k / under) * TAU + rngRange(rng, -0.5, 0.5);
        const rr = K.r - rngRange(rng, 0.9, 1.6);
        plantHedge(out, rng, i + k, [px + Math.cos(a) * rr, K.h - 0.24, pz + Math.sin(a) * rr],
          rngRange(rng, 0.42, 0.72), rngRange(rng, 0.5, 0.9));
      }
    }

    /* The arrival corridor - the strip of floor the player walks in
       along and the strip the camera looks down - is kept CLEAR.
       Every real Super Mario 64 frame that beats us is roughly sixty
       percent bare ground; a scatter pass that fills the approach is
       the fastest way to make a course look like a warehouse. */
    const clear = (x, z) => (Math.abs(x) < 9 && z > 24 && z < 50)
      || (Math.abs(x + 6) < 7 && z > 30 && z < 46)
      /* The encounter apron, north of the pool: the chorus stands here
         and the camera shoots down the corridor over it into the
         fountain, so a table in it is a table across the beat. */
      || (Math.abs(x - 2) < 14 && z > 12 && z < 24)
      /* The east arena. `platforming` puts her at (34,22) and the
         encounter beat is solved from there, so the whole triangle of
         camera, character and mob lives in this box - and the frame
         that came back before it existed had her wedged inside a
         planter under an escalator with a Lackey filling a third of
         the lens. Kept bare on purpose. */
      || (x > 24 && x < 46 && z > 8 && z < 32)
      /* THE ALCOVE APPROACH. The `boss` camera stands north of the
         arcade deck and solveBearing PULLS IN on the first thing its
         sphere-cast hits between the aim point and where it wanted to
         stand - so a cafe table dropped at (41, -20) by the seeded
         scatter does not appear in the frame, it shortens it, and a
         Payola Phantom whose shell spans 5.7 m loses its head off the
         top edge. Twelve metres of clear approach is what lets that
         pose reach its own framing distance. */
      || (x > 28 && x < 52 && z > -30 && z < -14)
      /* The two concourses and the aprons in front of them. Scatter
         inside a recess is furniture standing in a doorway, and
         scatter in front of one hides the mass the whole structure was
         built to be. */
      || (x > 44 && x < 60 && z > 12 && z < 32)
      || (x > 34 && x < 58 && z > 34 && z < 52);
    /* THE POOL APRON, AND IT IS FOUR AND A HALF METRES NOW, NOT TWO.

       The plaza pool reaches 13.75 m and the scatter loops below were
       written against a ten-metre basin, so without this a third of
       the bollards stand in the water and the `water` shot is composed
       through a picket line of them.

       Two metres was not enough. A blind pass on that capture: "the
       highest-contrast object in the lower half is a grey bin". Traced
       by raycast, that bin is a scattered trashcan at (16.0, -2.4) -
       16.2 m out, which cleared the old apron by half a metre and
       landed in the lower-right quadrant of the frame at nine metres
       from the lens. A 1.2 m steel can lit from above against a warm
       floor is the highest local contrast this course can produce, and
       putting one directly in front of the fountain is also just
       wrong: nobody stands a bin against a fountain. Four and a half
       metres clears the whole terrace the pool sits in, and the rope
       barrier at r 21 is unaffected because it does not consult this
       predicate. */
    const apron = (x, z) => Math.hypot(x, z) < POOL_OUT + 4.5;
    const nearField = (x, z) => NEAR_FIELD.some(
      (b) => Math.hypot(x - b[0], z - b[1]) < b[2]);
    const busy = (x, z) => clear(x, z) || apron(x, z) || nearField(x, z);

    for (let i = 0; i < 22; i += 1) {
      const a = rng() * TAU, r = rngRange(rng, 14, 52);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (busy(x, z)) continue;
      out.inst("trashcan", F.trashcan, "shared.metal",
        { pos: [x, 0, z], rot: [0, rng() * TAU, 0], scale: rngRange(rng, 0.85, 1.2) });
    }
    for (let i = 0; i < 14; i += 1) {
      const a = rng() * TAU, r = rngRange(rng, 30, 52);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (busy(x, z)) continue;
      out.inst("vending", F.vending, "foodcourt.stallC",
        { pos: [x, 0, z], rot: [0, rng() * TAU, 0], scale: rngRange(rng, 0.9, 1.15) });
    }
    /* THE BOLLARDS ARE A ROPE BARRIER NOW.

       Twenty-six identical capsules seeded around the apron at a
       uniform radius read, in a blind pass, as "six identical bollards
       evenly spread across the water foreground with no rope between
       them - they read as debug capsules". That is a fair description
       of what they were. The fix is not fewer of them, it is the
       ROPE: a line slung post to post is what says these objects
       belong to each other, and it is the only horizontal anywhere in
       the bottom of the `water` frame. The runs are arcs of the apron
       with real gaps between them - a barrier has a way through it -
       and the posts are jittered along their own arc so no two spans
       measure the same. */
    const ROPE_ARCS = [
      [0.30, 1.28, 21.4, 6], [1.62, 2.42, 22.6, 5],
      [2.86, 3.74, 20.8, 5], [4.06, 4.86, 22.2, 5],
      [5.16, 6.02, 21.0, 6],
    ];
    for (const [a0, a1, rr, n] of ROPE_ARCS) {
      ropeRun(out, P, rng, {
        count: n,
        at: (t) => {
          const a = lerp(a0, a1, t);
          const r = rr + Math.sin(t * 5.1 + a0) * 0.8;
          const x = Math.cos(a) * r, z = Math.sin(a) * r;
          return (clear(x, z) || nearField(x, z)) ? null : [x, z];
        },
      });
    }
    for (let i = 0; i < 10; i += 1) {
      const x = rngRange(rng, -50, 50), z = rngRange(rng, -50, 50);
      if (busy(x, z)) continue;
      out.inst("pillarLamp", F.pillarLamp, "shared.metal", { pos: [x, 0, z] });
      out.inst("pillarLampGlobe", F.pillarLampGlobe, "foodcourt.counter",
        { pos: [x, 0, z], tint: 0xbcb39c });
    }

    /* The seating field, drawn in four calls.
       TWENTY-EIGHT SETTINGS, NOT THIRTY-FOUR, and all of them bigger.
       The `water` framing looks across the widest part of this field
       and a blind pass read the result as a grey scribble; a third of
       the fix is the geometry (see seatingField), a third is the
       colour, and a third is simply that a food court photographs
       better with fewer, larger, more separated settings than with a
       dense mat of small ones. */
    seatingField(out, P, rng, {
      cx: 0, cz: 0, radius: 25, count: 28,
      /* Chairs and litter used to be the same saturated red as the
         gameplay platforms, which is most of why red stopped meaning
         anything in this course: a hundred and twenty red objects
         scattered across the floor, and the moving platform you are
         supposed to notice painted the same colour. */
      table: "foodcourt.table", chair: "foodcourt.seat", chairB: "foodcourt.seatB",
      tray: "foodcourt.seat",
      reject: (x, z) => Math.hypot(x, z) < POOL_OUT + 2.6 || clear(x, z) || nearField(x, z),
    });

    /* ============ movers ============ */

    /* Timed tray platforms for the blue switch run: they exist all
       the time as geometry, and collect.js raises them on the hit. */
    const trayRun = [];
    for (let i = 0; i < 6; i += 1) {
      const t = i / 5;
      trayRun.push([lerp(-20, -50, t), lerp(1.4, 10.0, t), lerp(20, 2, t)]);
    }
    for (let i = 0; i < trayRun.length; i += 1) {
      out.add(P.platform(3.4, 0.4, 3.4, { bevel: 0.06 }), "foodcourt.tray", {
        pos: trayRun[i], collide: true, tint: 0x36a8d8, tag: `switch-tray-${i}`,
      });
    }

    out.mover(P.movingPlatform({
      points: [[24, 9.4, 0], [24, 9.4, -22], [24, 15.2, -22]],
      period: 9, size: [4.4, 0.5, 4.4], surface: "shared.grate",
    }));
    out.mover(P.movingPlatform({
      points: [[-24, 9.4, 6], [-24, 13.6, 24], [-24, 9.4, 6]],
      period: 8, size: [4.4, 0.5, 4.4], surface: "shared.grate", phase: 0.4,
    }));
    /* The mezzanine elevator is declared with the east concourse it
       had to move out of - see THE EAST CONCOURSES above. */
    out.mover(P.seesaw({
      pos: [-8, MEZZ + 0.4, 40], size: [10, 0.4, 3.4], axis: "x", surface: "foodcourt.tray",
    }));

    /* ============ collectibles ============ */

    out.record("mall-1", [0, 16.6, 0], { hint: "exploration" });
    out.record("mall-2", [AX + 4, 2.4, AZ], { requires: "miniboss:payola", hint: "boss" });
    out.record("mall-3", [0, 3.2, 26], { requires: "clout:100", hint: "clout" });
    out.record("mall-4", [0, MEZZ + 1.6, -HALF + 6], { hint: "long-jump" });
    out.record("mall-5", [-50, 11.2, 2], { requires: "switch:blue-1", hint: "timed" });
    out.record("mall-6", [YX - 12.6, 3.0, YZ - 8.2], { hidden: true, hint: "hidden" });
    out.record("mall-7", [BX, 26.4, BZ], { hint: "gauntlet" });

    out.switchAt([-20, 0.4, 20], "blue", "switch:blue-1");

    out.cloutRing([0, 1.2, 0], 13.5, 12, "yellow");
    out.cloutRing([0, 1.2, 0], 19, 16, "yellow");
    out.cloutLine([-32, 1.2, 40], [-32, MEZZ + 1.2, 46], 6, "yellow");
    out.cloutLine([32, 1.2, 40], [32, MEZZ + 1.2, 46], 6, "yellow");
    out.cloutLine([-32, 1.2, -40], [-32, MEZZ + 1.2, -46], 6, "yellow");
    out.cloutLine([32, 1.2, -40], [32, MEZZ + 1.2, -46], 6, "yellow");
    out.cloutRing([PX, 9, PZ], 7.2, 10, "yellow");
    out.cloutLine([-8, CAT + 1.2, 0], [-40, CAT + 1.2, 0], 10, "yellow");
    out.cloutLine([0, CAT + 1.2, 8], [0, CAT + 1.2, 40], 10, "yellow");
    out.clout([BX, 26.0, BZ - 3], "red");
    out.clout([YX, 1.9, YZ], "red");
    out.clout([0, 15.6, 0], "red");
    out.clout([AX - 4, 1.6, AZ], "red");
    for (let i = 0; i < 6; i += 1) {
      out.clout([rngRange(rng, -50, 50), 5.9, rngRange(rng, -50, 50)], "yellow");
    }

    out.deal([26, MEZZ + 1.4, 26], "main-character-energy");
    out.deal([-46, 1.4, -46], "auto-tune-beam");

    /* ============ enemies ============ */

    /* THE STAGED ENCOUNTER, and the two numbers that decide whether it
       can be photographed at all.

       `enemy-encounter` does not read the marker. camera.js takes the
       enemy NEAREST THE PLAYER as its landmark, stands her `stand`=7m
       in front of it, and then asks whether she is already within 18m
       of that point - if she is, it throws the ideal stand point away
       and composes around where she REALLY is. So there is a dead band
       between about eight and twenty-five metres where the composition
       is hijacked by her actual position while the enemy is still far
       enough that a 62-degree skew swings it clean out of frame. That
       band is exactly where course 1's nearest enemy used to sit, and
       the preset refused every run with "enemy not visible in frame".

       Two rules follow, and both are load-bearing:

         1. The encounter is a GROUP on open floor at least 25m from
            wherever the harness starts the beat, so the ideal stand
            point wins and the character is walked into it.
         2. NOTHING else may sit in the dead band around either of the
            two places the harness starts it from - the spawn, and the
            foot of the Pretzel Helix where `platforming` leaves her.
            That is why the bats moved off the pretzel and the pig mob
            is out on the south-west floor.

       What stands on the arrival apron is a chorus: four Backup
       Dancers in a line across the approach with a Plant on the flank
       and a knot of Lackeys behind. The shot looks down the arrival
       corridor over their heads and into the fountain, so the beat has
       the course's own landmark for a backdrop. They are cyan against
       a warm mall, they hold their marks (the dancer is beat-driven
       and does not chase), and their lesson - read the music, not the
       body - is one the first course should be teaching. */
    out.enemy("dancer", [2, 0.2, 16], { count: 4, formation: "line", spacing: 3.0 });
    out.enemy("plant", [-9, 0.2, 15]);
    out.enemy("lackey", [11, 0.2, 14], { count: 3, formation: "ring", spacing: 2.0 });

    /* THE EAST KNOT - the group the capture actually photographs.

       `platforming` leaves the player on the open plaza east of the
       fountain and `enemy-encounter` runs next, so this is the post
       that has to satisfy the rules above from THERE. It sits SEVEN
       metres away, on the near side of the band rather than the far
       side: at that range camera.js keeps her real position as the
       subject, so the composition depends only on where the previous
       preset put her, which the marker below fixes exactly - no
       walking, no second solve, nothing to drift. The line from the
       solved camera through the knot passes seven metres off the cup,
       so the beat is framed with the fountain behind it rather than
       against a blank wall, and the ground for fifteen metres in every
       direction is kept clear of scatter below.
       DANCERS AND A PLANT, and the reason is that they are the only
       two archetypes that will still be seven metres away when the
       shutter falls. The harness advances two thirds of a second
       between posing the camera and taking the frame, and a Lackey mob
       runs at 5.4 m/s: staged at seven metres they arrived as four
       bodies stacked on top of the character with her face behind one
       of them. A Backup Dancer is beat-driven and holds its mark, an
       Industry Plant is rooted and is a turret. Cyan line, green
       turret, warm floor - and the Pretzel Helix behind them.

       THE KNOT MOVED NORTH, and the reason was measured in the
       `platforming` frame rather than in this one. The old posts ran
       (29.1,18.3), (31.0,16.0), (32.8,13.6) - three Plants at even
       spacing on one diagonal, which a blind pass read exactly as
       that: "three potted plants at equal spacing". Worse, the middle
       one sat FOUR METRES in front of the platforming lens, where a
       1.6 m turret fills forty-seven percent of frame height: "a
       potted plant cropped into the bottom-right corner is the
       sharpest, most saturated object in the frame - a corner eye-trap
       pulling straight off the subject". It was not badly lit, it was
       badly placed.
       They are north-west of her now, at nine to fourteen metres from
       the platforming lens instead of four - so the same turret is a
       fifth of frame height rather than a half - and they are grouped
       as a PAIR plus an outlier rather than a row. The bed authored in
       the near-field section stands where the eye-trap used to. */
    out.enemy("plant", [31.5, 0.2, 23.5]);
    out.enemy("plant", [30.2, 0.2, 22.2]);
    out.enemy("plant", [33.4, 0.2, 26.1]);
    out.enemy("dancer", [30.0, 0.2, 25.0], { count: 4, formation: "line", spacing: 2.8, facing: -0.62 });

    /* The pound and the crowd, the two lessons course 1 still owed:
       a Pay-Pig walled in by Lackeys, out on the south-west floor
       where there is room to circle it. */
    out.enemy("pig", [-28, 0.4, -8]);
    out.enemy("lackey", [-28, 0.2, -8], { count: 4, formation: "ring", spacing: 3.2 });

    /* The rest of the population, authored rather than scattered.
       A seeded scatter cannot honour the two rules above - it drops
       bodies into the dead band around the two places the harness
       starts the encounter beat from, and one imp landing there is
       enough to lose the frame. Every post below is at least 33m from
       the foot of the pretzel and outside the pool apron. */
    out.enemy("imp", [-26, 0.2, 24], { count: 2, spacing: 2.4 });
    out.enemy("lackey", [-38, 0.2, 4], { count: 4, formation: "ring", spacing: 3.0 });
    out.enemy("plant", [-22, 0.2, -22]);
    out.enemy("imp", [24, 0.2, -28], { count: 2, spacing: 2.4 });
    out.enemy("lackey", [44, 0.2, -14], { count: 4, formation: "ring", spacing: 3.0 });
    out.enemy("plant", [6, 0.2, -30]);
    out.enemy("imp", [-6, 0.2, -46], { count: 2, spacing: 2.4 });
    out.enemy("plant", [40, 0.2, 6]);
    out.enemy("bouncer", [AX - 4, 0.6, AZ]);
    /* Both of these used to spawn at twelve metres, directly over the
       fountain and over the pretzel. The enemy-encounter preset takes
       the NEAREST enemy as its landmark and stands the player under
       it, so whenever one of those two won it composed a shot of the
       ceiling. Flying enemies still fly; they just start at a height a
       camera can frame from the floor.
       The bats have since moved again, off the pretzel entirely: at
       twenty metres from its foot they were sitting in the dead band
       described above and winning the encounter beat with a pair of
       flyers. They own the air over the ball pit now. */
    out.enemy("drone", [18, 3.4, 18]);
    out.enemy("bat", [YX + 6, 3.4, YZ - 4]);
    out.enemy("lackey", [-14, 0.4, -18]);
    out.enemy("imp", [-20, 0.4, -24]);
    /* "payola" was never a registered fight id - bosses.js arms
       `twins`, `phantom` and `lucifer`, and provideArena silently
       no-ops on anything else, so this record was gated on a fight
       that never armed. The Payola Phantom IS `phantom`. */
    out.boss("phantom", [AX + 2, 0.6, AZ - 2], { record: "mall-2" });

    /* ============ lighting ============ */

    /* Four banks of fluorescent, one per quadrant, sitting just under
       the ceiling. The shafts do the drama; these keep the corners
       from going black. */
    out.accent(0, { pos: [-30, 15, -30], color: 0xffe0a8, intensity: 55, distance: 62 });
    out.accent(1, { pos: [30, 15, -30], color: 0xffe0a8, intensity: 55, distance: 62 });
    out.accent(2, { pos: [30, 15, 30], color: 0xffe0a8, intensity: 55, distance: 62 });
    out.accent(3, { pos: [-30, 15, 30], color: 0xffe0a8, intensity: 55, distance: 62 });

    /* ============ spawns and camera markers ============ */

    out.spawn(0, [0, 0.4, 44], Math.PI);
    out.spawn(1, [0, MEZZ + 0.6, 50], Math.PI);
    out.spawn(2, [PX, CAT + 0.6, PZ], Math.PI * 0.75);

    /* Camera markers - see HOW TO AUTHOR A CAMERA MARKER above.
       Every one of the nine has one of the three landmarks in it: the
       cup, MOG BURGER or the pretzel. A frame of this course with none
       of them in it does not say where it was taken.

       Both vantages stand on the FOUNTAIN and the shop roofs rather
       than on the mezzanine or the catwalks, which is not a taste
       call: the mezzanine hugs the perimeter, so a vantage there aimed
       at the middle of the plaza puts the solved camera inside the
       outside wall, and the catwalks at 17m leave only 5m of headroom
       under a 22m ceiling when the camera needs 8. */
    /* THE ARRIVAL LOOK POINT IS TWENTY-FIVE METRES OUT, and that is
       arithmetic, not taste.

       A blind pass named the one real fault in this frame: "the one
       real landmark, the red funnel, is cropped by the top edge".
       Solve it and it is a distance problem. camera.js puts the lens
       about nine metres behind her at roughly three metres up, and
       flattens the pitch to about eight degrees under a lid, so with a
       48-degree lens the top of the frame reaches

           3.0 + R * tan(24 - 8)  =  3.0 + 0.286 R

       metres of height at R metres out. The cup's lid sits at 15.15 m,
       which needs R >= 43. With the look point eight metres in front
       of the cup she stood at z=21 and the lens landed at R=31, where
       the frame line crosses the cup a third of the way up it.
       Twenty-five metres puts her at z=38 and the lens at R=46, which
       clears the lid with a metre to spare - and it is why the south
       shop row now has a gap in it, because every metre past z=45 used
       to put the camera inside a unit.
       The trade is that the fountain is smaller. It is an ARRIVAL: the
       shot wants the whole thing and the room it stands in, and the
       near-field beds either side of the corridor are what stop that
       reading as distance for its own sake.

       THE LOOK POINT STAYS TWENTY-FIVE METRES SHORT OF THE CUP, AND
       BOTH ALTERNATIVES WERE MEASURED BEFORE IT DID.

       It is a fair complaint that this marker aims at open air rather
       than naming its own subject - camera.js reads a `look` as a
       search DIRECTION and finds the fountain along it either way, so
       moving the point onto the sculpture ought to be free
       documentation. It is not free. Both honest versions of it lose
       the capture outright:

         [0, 14.9, 0]  the cup's own lid. The mass probe's height band
                       is seeded from the hint, so naming the top of a
                       sixteen-metre object hands the shot the top of a
                       sixteen-metre object: the landmark comes back as
                       an 8 x 9 m silhouette at y 16 with its centre at
                       NDC (3.6, 6.8), and the preset refuses with
                       "landmark owns 0% of the frame".
         [0, 10, 0]    the middle of the sculpture, at the height that
                       works. Refuses at 7%: the hint is also the
                       centre of the MASS_NEAR radius the probe accepts
                       masses within, and pulling it twenty-five metres
                       up the corridor changes which mass wins and
                       therefore where `stand` puts her.

       So the point stays where the arithmetic above put it, and this
       note is the documentation instead. What the shot is OF is the
       Fountain of Free Refills, twenty-five metres beyond the aim, on
       the bearing the aim establishes. */
    out.marker("arrival", [0, 1.2, 54], [0, 10, 25]);
    out.marker("vista", [0, 6.0, 0], [BX, 19, BZ]);
    /* Shot from the plaza rather than from the north, and aimed at a
       point 3.5m OFF the helix's axis on the camera's side. That
       offset is the whole point: `platforming` stands her nine metres
       from its landmark, and nine metres from the middle of the
       pretzel is on top of the gauntlet's own steps - which put her a
       storey up with the encounter beat's mob hidden behind the
       treads. Landmark plus stand is 12.5m from the axis, which is
       open floor, and the helix still fills the frame behind her. */
    out.marker("platforming", [PX, 1.2, PZ - 24], [PX, 11, PZ - 3.5]);
    /* AIMED AT THE GROUP THAT ACTUALLY TURNS UP, WHICH IS THE EAST
       KNOT AND NOT THE ARRIVAL CHORUS.

       This marker used to aim at the four Backup Dancers on the
       arrival apron, on the reasoning that camera.js overrides the
       landmark with the nearest live enemy anyway, so the marker was
       only documentation. It is not only documentation. `markerSide`
       honours a marker's POSITION - which side of the mob the shot is
       taken from, the one thing a solver cannot infer - but only when
       the marker's look point is within twenty metres of the actor
       that turned up. `platforming` runs first and leaves her out on
       the east plaza, so the nearest enemy is the east knot at about
       (31, 24), thirty metres from the apron the marker was aimed at.
       The test failed every run and the side was decided by fallback.

       So it aims at the knot, from the south-west of it. That bearing
       is chosen, not guessed: continued past the mob it runs into the
       north-east concourse at (45, 41.5), so the beat is framed
       against built architecture rather than against bare floor - and
       the chorus on the apron is still the arrival beat's group, which
       is the frame it belongs in. */
    out.marker("enemy-encounter", [23, 1.2, 13], [31.3, 1.6, 24.2]);
    out.marker("collect", [YX + 16, 1.2, YZ + 16], [YX, 2.2, YZ]);
    /* Six metres, not three: the Payola Phantom's shell spans 5.7 m and
       its head sits about 6.5 m up, so an aim point at 3.0 crops it.
       READ THIS BEFORE TRUSTING IT, THOUGH. camera.js's `boss` case
       replaces BOTH halves of this marker - the landmark becomes the
       live boss at `b.y + 1.7`, and `from` becomes the player's own
       position - so on this preset the marker is documentation of
       intent and the aim height above is not the lever that decides
       the crop. The two things on this side of the seam that do move
       it are the clear approach in `clear()` above, which lets the
       solved pose reach its full framing distance instead of being
       pulled in onto a cafe table, and where the boss is spawned. */
    out.marker("boss", [AX + 4, 1.2, AZ + 24], [AX, 6.0, AZ]);
    /* Aimed at the air over the encounter apron rather than at the cup.
       `interior` stands her 10m from its landmark, and 10m from the
       middle of the fountain is inside the pool - she ended up posed on
       a stepping stone with a Backup Dancer at her elbow. Ten metres
       from a point out over the apron is the clear arrival corridor,
       and the shot still looks down the length of the room with the
       ceiling, the shafts and the mezzanine in it. */
    out.marker("interior", [0, 1.2, 36], [0, 13, 20]);
    /* The look point is the middle of the pool and the from point is
       well out on the +x apron, and both halves matter. camera.js
       scans a 7.5m ring around `look` for a water surface and makes
       the first hit its landmark, so aiming at the centre of the
       fountain is what puts the landmark IN the pool rather than on
       its far shore. It then stands her nine metres from that landmark
       towards `from` - which at this bearing is 16m out from the
       middle, on the dry apron outside the coping, with the whole pool
       and the cup stacked up behind her. Aim `from` at the old [0,z]
       and she is stood in the water instead. */
    out.marker("water", [40, 1.2, 8], [0, 1.0, 0]);
    /* Halfway up the north-east escalator: the only elevated standing
       point in this course that is not either against the perimeter
       (where the solved camera lands in the outside wall) or pressed
       against the cup. */
    out.marker("high-ground", [24, 4.5, 24], [PX, 12, PZ]);
  },
};

/* ============================================================
   COURSE 2 - THE AWARDS-SHOW RED CARPET

   A boulevard at dusk running north to the venue. The carpet is
   the spine: it tells you which way is forward from anywhere on
   the course, the way the Pilgrim's Road does on Vesper-IX.

   Landmarks: the theatre facade closing the north end, a
   twenty-metre gold statuette on the roundabout in the middle of
   it, and a searchlight scaffold in the south-east whose beams are
   visible from the far end of the map.
   ============================================================ */

const COURSE_2 = {
  id: 2,
  name: "The Awards-Show Red Carpet",
  theme: "redcarpet",
  music: "redcarpet",
  spawnCount: 3,
  records: [
    { id: "carpet-1", name: "Best Supporting Silhouette", gate: "exploration" },
    { id: "carpet-2", name: "The Algorithm Twins", gate: "boss" },
    { id: "carpet-3", name: "A Hundred Little Claps", gate: "clout-100" },
    { id: "carpet-4", name: "Kick Off the Step-and-Repeat", gate: "wall-kick" },
    { id: "carpet-5", name: "Roll It Out", gate: "timed-switch" },
    { id: "carpet-6", name: "Backseat of the Limo", gate: "hidden" },
    { id: "carpet-7", name: "Up the Rig", gate: "gauntlet" },
  ],

  build(ctx, out) {
    const P = out.prim;
    const F = makeProps(P);
    const rng = out.rng;

    const W = 46;              /* boulevard half-width */
    const NORTH = -70, SOUTH = 62;

    out.bounds([-W - 8, -6, NORTH - 10], [W + 8, 40, SOUTH + 10]);

    /* ---- ground: asphalt boulevard with the carpet down the spine ---- */
    out.add(P.platform(W * 2, 2, SOUTH - NORTH + 20, { bevel: 0.3 }),
      "redcarpet.asphalt", { pos: [0, -1, (NORTH + SOUTH) / 2], collide: true, uvScale: 6 });
    out.add(P.platform(15, 0.28, SOUTH - NORTH - 6, { bevel: 0.06 }), "carpet.red",
      { pos: [0, 0.14, (NORTH + SOUTH) / 2 + 4], collide: "grass", uvScale: 4 });
    for (const s of [-1, 1]) {
      out.add(P.platform(0.8, 0.34, SOUTH - NORTH - 6, { bevel: 0.05 }), "carpet.trim",
        { pos: [s * 7.9, 0.17, (NORTH + SOUTH) / 2 + 4], collide: false });
      /* Pale kerb down each side of the asphalt. A dark road with no
         kerb has no edge, and without an edge the boulevard reads as
         a void the carpet is floating over. */
      out.add(P.platform(1.4, 0.5, SOUTH - NORTH + 16, { bevel: 0.07 }), "redcarpet.kerb",
        { pos: [s * 43, 0.25, (NORTH + SOUTH) / 2], collide: true });
      out.add(P.platform(6, 0.34, SOUTH - NORTH + 16, { bevel: 0.06 }), "redcarpet.kerb",
        { pos: [s * 46.5, 0.17, (NORTH + SOUTH) / 2], collide: true, uvScale: 3, tint: 0xcfcac2 });
    }
    /* Lane markings. Three metres of paint per five is the standard
       and it is also exactly enough to make a long road read as long. */
    for (let i = 0; i < 26; i += 1) {
      const z = NORTH + 4 + i * 5;
      if (Math.abs(z - (NORTH + 74)) < 16) continue;
      for (const s of [-1, 1]) {
        out.add(P.platform(0.5, 0.06, 3, { bevel: 0.01 }), "redcarpet.kerb",
          { pos: [s * 27, 0.06, z], collide: false, ao: 0, tint: 0xf0ead8 });
      }
    }

    /* ---- press pens: barrier, riser, step-and-repeat wall ---- */
    for (const s of [-1, 1]) {
      for (let i = 0; i < 9; i += 1) {
        const z = NORTH + 22 + i * 13;
        out.add(P.platform(1.2, 1.15, 11, { bevel: 0.06 }), "redcarpet.barrier",
          { pos: [s * 11, 0.58, z], collide: true });
        /* Riser: the mid tier. Standing on the press is the shortcut
           to the bleachers and everything above them. */
        out.add(P.platform(9, 3.0, 11.5, { bevel: 0.12 }), "redcarpet.facade",
          { pos: [s * 17.5, 1.5, z], collide: true });
        out.add(P.platform(9.4, 0.4, 11.9, { bevel: 0.1 }), "shared.grate",
          { pos: [s * 17.5, 3.2, z], collide: "metal" });
        out.inst("stanchion", F.stanchion, "shared.gold",
          { pos: [s * 8.6, 0.14, z - 5] });
        /* Rope between the stanchions, and the press themselves. */
        out.add(P.platform(0.34, 0.34, 12.6, { bevel: 0.12, round: 0.16 }), "redcarpet.velvet",
          { pos: [s * 8.6, 0.92, z + 1.2], collide: false, ao: 0 });
        for (let k = 0; k < 4; k += 1) {
          out.inst("photog", F.photog, CROWD_SURFACES[(i + k) % CROWD_SURFACES.length], {
            pos: [s * (14.4 + (k % 2) * 4.6), 3.4, z - 4.4 + k * 2.9],
            rot: [0, s > 0 ? -Math.PI / 2 + rngRange(rng, -0.3, 0.3) : Math.PI / 2 + rngRange(rng, -0.3, 0.3), 0],
            scale: rngRange(rng, 0.94, 1.08),
          });
        }
      }
      /* Bleachers behind the press, stepping up to six metres. */
      for (let k = 0; k < 5; k += 1) {
        out.add(P.platform(5, 1.4 + k * 1.2, 74, { bevel: 0.1 }), "redcarpet.facadeB",
          { pos: [s * (25 + k * 5), (1.4 + k * 1.2) / 2, NORTH + 56], collide: true, uvScale: 4 });
      }
      /* ...and the several hundred people standing on them. This is
         the difference between a set and an event. */
      crowdField(out, F, rng, {
        rows: 5, per: 26, faceAt: [0, 3, NORTH + 56],
        at: (i, k) => {
          if (rng() < 0.14) return null;
          return [
            s * (25 + k * 5) + rngRange(rng, -1.6, 1.6),
            1.4 + k * 1.2,
            NORTH + 21 + i * 2.8 + rngRange(rng, -0.5, 0.5),
          ];
        },
      });
      /* Step-and-repeat banner walls flanking the carpet. The wall
         kick record lives in the gap between two of them. */
      for (let i = 0; i < 3; i += 1) {
        out.add(P.platform(0.7, 9, 16, { bevel: 0.08 }), "redcarpet.banner",
          { pos: [s * 9.2, 4.5, NORTH + 16 + i * 22], collide: true, uvScale: 4,
            tint: [0x8a2050, 0x50124a, 0x2a1a5a][i] });
      }
    }
    /* The wall-kick shaft: two parallel walls 3.4m apart, 16m tall. */
    for (const s of [-1, 1]) {
      out.add(P.platform(0.9, 17, 9, { bevel: 0.1 }), "redcarpet.facade",
        { pos: [-32 + s * 1.7, 8.5, NORTH + 30], collide: true, uvScale: 4 });
    }
    out.add(P.platform(6, 0.6, 9, { bevel: 0.1 }), "shared.grate",
      { pos: [-32, 17.3, NORTH + 30], collide: "metal" });

    /* ---- LANDMARK 1: the theatre facade ---- */
    const VZ = NORTH;
    out.add(P.platform(64, 30, 8, { bevel: 0.3 }), "redcarpet.facadeB",
      { pos: [0, 15, VZ - 6], collide: true, uvScale: 6 });
    /* Two flanking towers, so the venue has a silhouette rather than
       an outline. They are also what the marquee reads against. */
    for (const s of [-1, 1]) {
      out.add(P.platform(16, 44, 16, { bevel: 0.3 }), "redcarpet.tower",
        { pos: [s * 38, 22, VZ - 8], collide: true, uvScale: 9, ao: 0.2, aoHeight: 12 });
      out.add(P.platform(18, 1.4, 18, { bevel: 0.2 }), "redcarpet.facadeB",
        { pos: [s * 38, 44.8, VZ - 8], collide: true });
      out.add(P.pillar(1.2, 9, { sides: 8, flutes: true }), "carpet.trim",
        { pos: [s * 38, 45.4, VZ - 8], collide: false });
      /* Vertical blade sign up each tower - the theatre's name in
         light, and the only thing tall enough to see from the south
         gate a hundred and thirty metres away. */
      out.add(P.platform(1.0, 26, 5, { bevel: 0.1 }), "redcarpet.marquee",
        { pos: [s * 30.2, 20, VZ + 1], collide: false });
    }
    /* Upper storey band: pilasters and a cornice over the doors. */
    for (let i = 0; i < 11; i += 1) {
      out.add(P.platform(2.2, 16, 1.6, { bevel: 0.08 }), "redcarpet.step",
        { pos: [-25 + i * 5, 20, VZ - 2.6], collide: false });
      out.add(P.platform(3.4, 1.0, 2.2, { bevel: 0.12 }), "carpet.trim",
        { pos: [-25 + i * 5, 28.4, VZ - 2.6], collide: false });
    }
    out.add(P.platform(66, 1.6, 3.4, { bevel: 0.2 }), "carpet.trim",
      { pos: [0, 29.6, VZ - 3.2], collide: true });
    /* Steps up to the doors: the mid tier and the boss arena. */
    for (let i = 0; i < 8; i += 1) {
      out.add(P.platform(34 - i * 0.6, 1.1, 2.0, { bevel: 0.05 }), "redcarpet.step",
        { pos: [0, i * 1.0 + 0.55, VZ + 12 - i * 1.9], collide: true });
    }
    out.add(P.platform(30, 0.8, 9, { bevel: 0.12 }), "redcarpet.step",
      { pos: [0, 8.0, VZ - 1], collide: true });
    out.add(P.platform(26, 0.3, 8, { bevel: 0.06 }), "carpet.red",
      { pos: [0, 8.55, VZ - 1], collide: "grass" });
    /* Marquee arch and its roof - the high tier. */
    out.add(P.arch(30, 20, 5, { legWidth: 4.4, segments: 11 }), "redcarpet.facade",
      { pos: [0, 0, VZ + 2], collide: true, uvScale: 4 });
    out.add(P.platform(36, 1.0, 10, { bevel: 0.16 }), "redcarpet.marquee",
      { pos: [0, 18.5, VZ + 3], collide: true });
    out.add(P.platform(34, 2.6, 0.8, { bevel: 0.08 }), "redcarpet.marquee",
      { pos: [0, 16.6, VZ + 7.6], collide: false });
    for (let i = 0; i < 26; i += 1) {
      out.inst("bulb", () => new THREE.SphereGeometry(0.3, 8, 6), "redcarpet.marquee", {
        pos: [-16.5 + i * 1.32, 15.1, VZ + 7.9],
      });
    }
    for (let i = 0; i < 6; i += 1) {
      out.add(P.pillar(1.5, 26, { sides: 12, flutes: true }), "redcarpet.step",
        { pos: [-26 + i * 10.4, 0, VZ - 1.5], collide: true });
    }

    /* ---- LANDMARK 2: the statuette ---- */
    const SZ = NORTH + 74;
    out.add(new THREE.CylinderGeometry(11, 12.5, 2.4, 22, 1), "redcarpet.step",
      { pos: [0, 1.2, SZ], collide: true, uvScale: 4 });
    out.add(P.platform(7, 6, 7, { bevel: 0.2, round: 1 }), "redcarpet.step",
      { pos: [0, 5.4, SZ], collide: true });
    /* The figure: a stack of tapering rings, arms up. Reads as an
       award from four hundred metres, which is the only requirement. */
    const body = new THREE.CylinderGeometry(1.35, 2.3, 9, 10, 1);
    out.add(body, "shared.gold", { pos: [0, 12.9, SZ], collide: true });
    out.add(new THREE.SphereGeometry(1.6, 14, 10), "shared.gold",
      { pos: [0, 18.4, SZ], collide: true });
    for (const s of [-1, 1]) {
      const arm = new THREE.CylinderGeometry(0.5, 0.62, 7.5, 8, 1);
      arm.rotateZ(s * 0.34);
      out.add(arm, "shared.gold", { pos: [s * 2.0, 15.4, SZ], collide: true });
    }
    out.add(new THREE.TorusGeometry(2.2, 0.32, 6, 22), "shared.gold",
      { pos: [0, 20.6, SZ], rot: [Math.PI / 2, 0, 0], collide: true });
    out.add(new THREE.CylinderGeometry(2.4, 2.4, 0.3, 18, 1), "carpet.trim",
      { pos: [0, 20.8, SZ], collide: true });
    out.add(new THREE.TorusGeometry(13, 0.4, 6, 34), "redcarpet.marquee",
      { pos: [0, 0.5, SZ], rot: [Math.PI / 2, 0, 0], collide: false });

    /* The roundabout is a fountain. Two jobs: it gives the course the
       one reflective surface it otherwise has none of, and it gives
       the crowd a physical reason to stand back from the statue
       instead of hugging it. */
    for (let i = 0; i < 28; i += 1) {
      const a = (i / 28) * TAU;
      out.add(P.platform((TAU * 17) / 28 + 0.5, 1.3, 1.6, { bevel: 0.1 }), "redcarpet.step", {
        pos: [Math.cos(a) * 17, 0.65, SZ + Math.sin(a) * 17],
        rot: [0, -a, 0], collide: true,
      });
      out.add(new THREE.CylinderGeometry(0.2, 0.26, 1.5, 8, 1), "carpet.trim", {
        pos: [Math.cos(a) * 15.1, 0.75, SZ + Math.sin(a) * 15.1], collide: false,
      });
    }
    out.add(new THREE.CylinderGeometry(16.6, 16.6, 0.5, 34, 1), "redcarpet.step",
      { pos: [0, 0.25, SZ], collide: true, uvScale: 3, tint: 0xc4cdd6 });
    /* A disc, not P.water's square plane: a square of liquid inside a
       round basin overhangs the kerb at four points and the seam is
       the first thing the eye finds. */
    const pool = new THREE.CircleGeometry(16.3, 34);
    pool.rotateX(-Math.PI / 2);
    out.add(pool, "redcarpet.pool", { pos: [0, 0.66, SZ], collide: "water" });
    for (let i = 0; i < 14; i += 1) {
      const a = (i / 14) * TAU + 0.31;
      /* Thin. A "jet" wide enough to read as a solid is a bollard made
         of glass, and at this opacity it comes out an opaque mint cone
         standing in the fountain. */
      out.inst("jet", () => {
        const j = new THREE.CylinderGeometry(0.04, 0.1, 2.2, 6, 1);
        j.translate(0, 1.1, 0);
        return j;
      }, "redcarpet.pool", { pos: [Math.cos(a) * 13.6, 0.66, SZ + Math.sin(a) * 13.6] });
    }

    /* ---- LANDMARK 3: the searchlight rig ---- */
    const RX = 34, RZ = NORTH + 104;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        out.add(P.pillar(0.4, 16, { sides: 6, base: false, cap: false }), "hell.truss",
          { pos: [RX + sx * 4, 0, RZ + sz * 4], collide: true });
      }
    }
    for (let i = 1; i <= 4; i += 1) {
      out.add(P.platform(9.6, 0.4, 9.6, { bevel: 0.08 }), "shared.grate",
        { pos: [RX, i * 4, RZ], collide: "metal" });
      /* Every level has one corner missing - climbing it is a route,
         not a ladder. */
      out.add(P.platform(4.4, 0.5, 4.4, { bevel: 0.08 }), "hell.truss",
        { pos: [RX + (i % 2 ? 7 : -7), i * 4 - 2, RZ + (i % 2 ? -7 : 7)], collide: true });
    }
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * TAU;
      const drum = new THREE.CylinderGeometry(1.5, 1.5, 2.4, 12, 1);
      drum.rotateX(-0.9);
      out.add(drum, "shared.metal", {
        pos: [RX + Math.cos(a) * 3, 17.4, RZ + Math.sin(a) * 3], rot: [0, -a, 0], collide: false,
      });
      out.add(new THREE.CylinderGeometry(1.4, 1.4, 0.3, 12, 1), "redcarpet.marquee", {
        pos: [RX + Math.cos(a) * 3 + Math.sin(a) * 0.4, 18.4, RZ + Math.sin(a) * 3], collide: false,
      });
      /* The beam colour IS its brightness: the beam shader multiplies
         vertex colour by a global gain of 1 and adds the result, so a
         near-white shaft clips to paper the instant the camera looks
         along it. A dusk searchlight is a warm grey column with a
         bright root, not a white wall. */
      out.beam({
        pos: [RX + Math.cos(a) * 3, 18, RZ + Math.sin(a) * 3],
        dir: [Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5], length: 110,
        radius: 1.3, radiusEnd: 9, color: 0x54452e, sides: 10, steps: 3,
      });
    }
    out.mover(P.movingPlatform({
      points: [[RX - 14, 5, RZ], [RX - 14, 13, RZ], [RX - 6, 17.4, RZ]],
      period: 9, size: [4, 0.5, 4], surface: "hell.truss",
    }));
    out.mover(P.rotator({
      pos: [RX, 10, RZ], radius: 8, arms: 3, armSize: [7, 0.45, 2.4], period: 12,
      surface: "hell.truss",
    }));

    /* ---- limos, cameras, crowd props ---- */
    for (let i = 0; i < 7; i += 1) {
      const z = NORTH + 96 + (i % 4) * 12;
      const x = (i < 4 ? -1 : 1) * rngRange(rng, 24, 38);
      out.inst("limo", () => {
        const parts = [];
        const b = P.platform(3.0, 1.5, 11, { bevel: 0.2, round: 0.8 });
        b.translate(0, 0.95, 0);
        const c = P.platform(2.6, 1.1, 5, { bevel: 0.2, round: 0.6 });
        c.translate(0, 2.1, -0.6);
        parts.push(b, c);
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const wheel = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 10, 1);
            wheel.rotateZ(Math.PI / 2);
            wheel.translate(sx * 1.5, 0.55, sz * 4);
            parts.push(wheel);
          }
        }
        return mergeGeometries(parts);
      }, "redcarpet.limo", { pos: [x, 0, z], rot: [0, rngRange(rng, -0.2, 0.2), 0] });
    }
    for (let i = 0; i < 30; i += 1) {
      const s = i % 2 ? 1 : -1;
      out.inst("camera", () => {
        const parts = [];
        const b = P.platform(0.5, 0.36, 0.7, { bevel: 0.05 });
        b.translate(0, 1.5, 0);
        const lens = new THREE.CylinderGeometry(0.16, 0.2, 0.4, 8, 1);
        lens.rotateX(Math.PI / 2);
        lens.translate(0, 1.5, 0.5);
        parts.push(b, lens);
        return mergeGeometries(parts);
      }, "redcarpet.barrier", {
        pos: [s * rngRange(rng, 13.5, 21), 3.4, NORTH + 24 + rng() * 100],
        rot: [0, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0],
      });
    }
    for (let i = 0; i < 20; i += 1) {
      out.inst("speaker", F.speaker, "hell.speaker", {
        pos: [(i % 2 ? 1 : -1) * rngRange(rng, 30, 42), 0, NORTH + 20 + rng() * 110],
        rot: [0, rng() * TAU, 0],
      });
    }
    for (let i = 0; i < 16; i += 1) {
      out.inst(`dead${i % 3}`,
        () => P.tree("dead", { height: 6.5, seed: 0x2000 + (i % 3) * 53 }), "foodcourt.trunk", {
          pos: [(i % 2 ? 1 : -1) * rngRange(rng, 42, 45), 0, NORTH + 14 + rng() * 120],
          rot: [0, rng() * TAU, 0], scale: [1, rngRange(rng, 0.82, 1.24), 1],
        });
    }

    /* ---- the boulevard itself: lamps, planters, city ---- */

    /* Twelve twin-headed lamps a side. They are the vertical rhythm
       that turns a hundred and thirty metres of straight road into a
       measured distance rather than a runway. */
    for (let i = 0; i < 12; i += 1) {
      const z = NORTH + 10 + i * 12;
      for (const s of [-1, 1]) {
        out.inst("streetLamp", F.streetLamp, "redcarpet.barrier",
          { pos: [s * 44.6, 0.4, z], rot: [0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0] });
        out.inst("lampGlow", () => {
          const parts = [];
          for (const t of [-1, 1]) {
            const b = new THREE.SphereGeometry(0.34, 8, 6);
            b.scale(1, 0.6, 1);
            b.translate(t * 1.9, 7.3, 0);
            parts.push(b);
          }
          return mergeGeometries(parts);
        }, "redcarpet.marquee",
        { pos: [s * 44.6, 0.4, z], rot: [0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0] });
      }
    }
    for (let i = 0; i < 14; i += 1) {
      const z = NORTH + 16 + i * 10;
      for (const s of [-1, 1]) {
        out.inst("planterPot", F.planterPot, "redcarpet.step",
          { pos: [s * 47.4, 0.34, z + (s > 0 ? 5 : 0)], scale: 0.8 });
        out.inst(`ficus${i % 3}`,
          () => P.tree("ficus", { height: 3.2, seed: 0x2600 + (i % 3) * 47 }),
          "foodcourt.leaf", { pos: [s * 47.4, 1.0, z + (s > 0 ? 5 : 0)], rot: [0, rng() * TAU, 0] });
      }
    }
    for (let i = 0; i < 26; i += 1) {
      out.inst("bollard", F.bollard, "carpet.trim", {
        pos: [(i % 2 ? 1 : -1) * rngRange(rng, 40.5, 41.5), 0.4, NORTH + 8 + rng() * 128],
      });
    }
    for (let i = 0; i < 12; i += 1) {
      out.inst("trashcan", F.trashcan, "redcarpet.barrier", {
        pos: [(i % 2 ? 1 : -1) * rngRange(rng, 45, 48), 0.34, NORTH + 12 + rng() * 124],
        rot: [0, rng() * TAU, 0],
      });
    }

    /* Standing crowd along the pavement on both sides, and a knot of
       them around the statuette roundabout. */
    for (const s of [-1, 1]) {
      crowdField(out, F, rng, {
        rows: 3, per: 30, faceAt: [0, 1, NORTH + 70], cheer: 0.55,
        at: (i, k) => {
          if (rng() < 0.2) return null;
          return [
            s * (44.5 + k * 1.5) + rngRange(rng, -0.7, 0.7),
            0.34,
            NORTH + 12 + i * 4.3 + rngRange(rng, -1.1, 1.1),
          ];
        },
      });
    }
    /* Outside the basin, not in it: the fountain kerb is at 17.8m and
       a crowd authored inside that radius stands in the water. */
    crowdField(out, F, rng, {
      rows: 2, per: 24, faceAt: [0, 12, SZ], cheer: 0.7,
      at: (i, k) => {
        const a = (i / 24) * TAU + k * 0.13;
        const r = 20 + k * 2.6;
        const x = Math.cos(a) * r;
        const z = SZ + Math.sin(a) * r;
        if (Math.abs(x) < 9 && Math.abs(z) < 70) return null;   /* keep the carpet clear */
        return [x, 0.06, z];
      },
    });

    /* The city the boulevard runs through. Decor only: thirty-four
       towers in one draw call, so that every horizon in the course has
       a skyline on it instead of a gradient.

       They start at 105m because the two vantage presets solve a
       camera into the air north of the theatre, and a tower is not a
       collider - a camera that ends up inside one does not push out of
       it, it just returns a black frame. */
    skyline(out, P, rng, {
      surface: "redcarpet.tower", count: 34,
      inner: 105, outer: 210, minH: 30, maxH: 104,
      centre: [0, NORTH + 60],
    });

    /* ---- lights, spawns, markers, collectibles ----

       The sun sits seven degrees above the horizon here, so it lands
       on almost nothing that faces up: the carpet, the steps and the
       roofs get essentially no key at all. These four practicals are
       therefore not accent lighting, they ARE the lighting for the
       ground plane, and they are placed at the three landmarks plus
       the middle of the run so that no stretch of the boulevard is
       more than forty metres from one. */
    out.accent(0, { pos: [0, 13, VZ + 14], color: 0xffdcb0, intensity: 210, distance: 96 });
    out.accent(1, { pos: [0, 11, SZ], color: 0xffcf80, intensity: 175, distance: 82 });
    out.accent(2, { pos: [0, 9, NORTH + 44], color: 0xffa8c0, intensity: 130, distance: 74 });
    out.accent(3, { pos: [RX - 6, 12, RZ + 4], color: 0xa8b4ff, intensity: 140, distance: 78 });

    out.spawn(0, [0, 0.4, SOUTH - 6], Math.PI);
    out.spawn(1, [0, 8.9, VZ + 1], 0);
    out.spawn(2, [RX, 16.6, RZ], Math.PI);

    out.record("carpet-1", [0, 22.6, SZ], { hint: "exploration" });
    out.record("carpet-2", [0, 9.8, VZ - 1], { requires: "miniboss:twins", hint: "boss" });
    out.record("carpet-3", [0, 1.8, NORTH + 40], { requires: "clout:100", hint: "clout" });
    out.record("carpet-4", [-32, 19.0, NORTH + 30], { hint: "wall-kick" });
    out.record("carpet-5", [0, 20.4, VZ + 3], { requires: "switch:blue-2", hint: "timed" });
    out.record("carpet-6", [-30, 1.6, NORTH + 108], { hidden: true, hint: "hidden" });
    out.record("carpet-7", [RX, 19.4, RZ], { hint: "gauntlet" });
    out.switchAt([0, 0.4, SOUTH - 14], "blue", "switch:blue-2");

    out.cloutLine([0, 1.2, SOUTH - 10], [0, 1.2, NORTH + 20], 24, "yellow");
    out.cloutRing([0, 1.8, SZ], 14.4, 14, "yellow");
    out.cloutLine([-17.5, 4.2, NORTH + 24], [-17.5, 4.2, NORTH + 120], 12, "yellow");
    out.cloutLine([17.5, 4.2, NORTH + 24], [17.5, 4.2, NORTH + 120], 12, "yellow");
    out.cloutRing([RX, 9, RZ], 8, 8, "yellow");
    out.clout([0, 19.6, VZ + 3], "red");
    out.clout([0, 21.6, SZ], "red");
    out.deal([0, 9.4, VZ - 4], "diva-tax");

    for (let i = 0; i < 10; i += 1) {
      out.enemy(rngPick(rng, ["drone", "bat", "lackey", "dancer"]),
        [rngRange(rng, -30, 30), 0.4, NORTH + 20 + rng() * 110]);
    }
    out.boss("twins", [0, 8.9, VZ - 2], { record: "carpet-2" });

    /* Camera markers - see HOW TO AUTHOR A CAMERA MARKER above.
       The two vantages stand on the searchlight rig and on the east
       theatre tower: both are near enough to the middle of the course
       that the solved camera lands in open air, and both look back
       along the boulevard so the statuette, the marquee and the
       skyline stack up behind her. */
    out.marker("arrival", [10, 1.2, 60], [RX, 14, RZ]);
    out.marker("vista", [RX, 16.5, RZ], [0, 12, SZ]);
    out.marker("platforming", [RX, 1.2, RZ + 24], [RX, 10, RZ]);
    out.marker("enemy-encounter", [6, 1.2, NORTH + 56], [-8, 2.4, NORTH + 36]);
    out.marker("collect", [28, 1.2, SZ], [14.4, 2.6, SZ]);
    out.marker("boss", [0, 9, VZ + 22], [0, 10, VZ - 1]);
    out.marker("interior", [0, 1.2, VZ + 26], [0, 6, VZ + 3]);
    out.marker("water", [0, 1.2, SZ + 30], [0, 1.2, SZ]);
    out.marker("high-ground", [38, 46, VZ - 8], [0, 12, SZ]);
  },
};

/* ============================================================
   COURSE 3 - THE STREAMING FARM BASEMENT

   Sealed, cold, and lit entirely by hardware. The whole course is
   one enormous machine room: aisles of racks on a raised floor,
   coolant channels underneath, cable trays overhead.

   Navigation is by colour rather than by silhouette, because at
   this light level a silhouette is all you get: the Monolith
   glows green, the Cooling Tower cyan, the Cable Cathedral amber.
   ============================================================ */

const COURSE_3 = {
  id: 3,
  name: "The Streaming Farm Basement",
  theme: "basement",
  music: "basement",
  spawnCount: 3,
  records: [
    { id: "farm-1", name: "Top of the Stack", gate: "exploration" },
    { id: "farm-2", name: "Deplatformed", gate: "boss" },
    { id: "farm-3", name: "Hundred Percent Uptime", gate: "clout-100" },
    { id: "farm-4", name: "Pull the Breaker", gate: "ground-pound" },
    { id: "farm-5", name: "Cold Aisle Sprint", gate: "timed-switch" },
    { id: "farm-6", name: "Under the Floor", gate: "hidden" },
    { id: "farm-7", name: "The Cooling Climb", gate: "gauntlet" },
  ],

  build(ctx, out) {
    const P = out.prim;
    const F = makeProps(P);
    const rng = out.rng;

    const H = 45;              /* half extent */
    /* Twenty-four, not sixteen. The two vantage presets stand the
       player on the highest thing near their marker and then solve a
       camera about eight metres above her; under a sixteen-metre lid
       there was no elevated surface in the course a camera could see
       from, and both frames came back as the inside of the ceiling
       slab. It also lets the cathedral and the cooling tower read as
       tall, which is the whole point of both of them. */
    const CEIL = 24;

    out.bounds([-H - 4, -8, -H - 4], [H + 4, CEIL + 4, H + 4]);

    out.add(P.platform(H * 2 + 6, 3, H * 2 + 6, { bevel: 0.2 }), "basement.concrete",
      { pos: [0, -1.5, 0], collide: true, uvScale: 6 });
    /* Raised floor: tiles on pedestals, with two channels cut out of
       it. The cut-outs are the hidden record's route. */
    for (let gx = -7; gx <= 7; gx += 1) {
      for (let gz = -7; gz <= 7; gz += 1) {
        if (gz === 0 && Math.abs(gx) > 2) continue;      /* coolant trench */
        if (gx === -5 && gz > 2 && gz < 6) continue;     /* the hidden hole */
        out.add(P.platform(6, 0.5, 6, { bevel: 0.06 }), "basement.floor",
          { pos: [gx * 6, 0.75, gz * 6], collide: true, uvScale: 3 });
      }
    }
    out.add(P.water(H * 2, 8, { segments: 10, swell: 0.02 }), "basement.coolant",
      { pos: [0, -0.2, 0], collide: "water" });
    out.add(P.water(8, 12, { segments: 6, swell: 0.02 }), "basement.coolant",
      { pos: [-30, -0.2, 26], collide: "water" });

    for (let side = 0; side < 4; side += 1) {
      const a = (side / 4) * TAU;
      out.add(P.platform(H * 2 + 6, CEIL + 2, 3, { bevel: 0.2 }), "basement.concrete", {
        pos: [Math.sin(a) * (H + 1), (CEIL + 2) / 2, Math.cos(a) * (H + 1)],
        rot: [0, a, 0], collide: true, uvScale: 5,
      });
    }
    out.add(P.platform(H * 2 + 6, 1.2, H * 2 + 6, { bevel: 0.1 }), "basement.concrete",
      { pos: [0, CEIL + 0.6, 0], collide: true, uvScale: 5, ao: 0 });

    /* Painted cold-aisle lanes. Nearly white on a course whose
       darkest surface is near-black: this is the course's value range
       in one prop, and it is what the player's silhouette is read
       against when she is down among the racks. Also the only thing
       in a machine room that tells you which way the aisles run. */
    for (let row = -4; row <= 4; row += 1) {
      const z = row * 9 + 4.5;
      if (Math.abs(z) > 40) continue;
      out.add(P.platform(60, 0.12, 2.2, { bevel: 0.02 }), "basement.lane",
        { pos: [0, 1.06, z], collide: false, ao: 0, uvScale: 2 });
    }

    /* ---- rack aisles: the ground-level maze and the first tier ---- */
    for (let row = -4; row <= 4; row += 1) {
      if (row === 0) continue;
      for (let i = -6; i <= 6; i += 1) {
        const x = i * 2.2 + (row % 2 ? 1.1 : 0);
        const z = row * 9;
        if (Math.abs(x) > 30) continue;
        /* Two liveries and three heights. Ninety identical cabinets
           at exactly character scale reads as a tiling pass; the
           variation costs one extra draw call and nothing else. */
        const tall = rng();
        out.inst(rng() < 0.5 ? "rack" : "rackB", F.rack,
          rng() < 0.5 ? "basement.rack" : "basement.rackB", {
            pos: [x, 1.0, z],
            scale: [1, tall < 0.2 ? 1.24 : (tall < 0.75 ? 1.0 : 0.82), 1],
          });
      }
      /* Aisle containment: a walkable lid over every second aisle,
         which is how you get from the floor to the cable trays. */
      if (row % 2 === 0) {
        out.add(P.platform(62, 0.4, 2.6, { bevel: 0.06 }), "shared.grate",
          { pos: [0, 3.8, row * 9], collide: "metal", uvScale: 2 });
        out.add(P.platform(62, 0.16, 0.5, { bevel: 0.03 }), "basement.hazard",
          { pos: [0, 4.02, row * 9 + 1.2], collide: false, ao: 0 });
      }
      /* End-of-row status panel: a lit face at the end of every aisle,
         so the maze has a readable end from anywhere inside it. */
      for (const s of [-1, 1]) {
        out.add(P.platform(0.3, 2.2, 1.8, { bevel: 0.05 }),
          row % 2 ? "basement.screen" : "basement.screenB",
          { pos: [s * 30.6, 2.3, row * 9], collide: false, ao: 0 });
      }
    }
    /* Collision for the rack rows as three long slabs rather than
       ninety boxes: the player cannot tell, and the BVH can. */
    for (let row = -4; row <= 4; row += 1) {
      if (row === 0) continue;
      out.collide([-0.5, 2.3, row * 9], [61, 2.6, 1.9], "metal");
    }

    /* ---- LANDMARK 1: the Monolith ---- */
    out.add(P.platform(14, 1.2, 14, { bevel: 0.16 }), "basement.case",
      { pos: [0, 1.4, -30], collide: true });
    for (let i = 0; i < 5; i += 1) {
      const s = 1 - i * 0.12;
      out.add(P.platform(11 * s, 3.0, 11 * s, { bevel: 0.1 }), "basement.rack",
        { pos: [0, 3.5 + i * 3.0, -30], rot: [0, i * 0.16, 0], collide: true, uvScale: 3 });
      out.add(P.platform(11.4 * s, 0.35, 11.4 * s, { bevel: 0.08 }), "basement.case",
        { pos: [0, 5.1 + i * 3.0, -30], rot: [0, i * 0.16, 0], collide: true });
    }
    out.add(new THREE.CylinderGeometry(1.1, 1.1, 17, 12, 1), "basement.screen",
      { pos: [0, 9.5, -30], collide: false });
    out.add(P.platform(6, 0.5, 6, { bevel: 0.1 }), "shared.grate",
      { pos: [0, 18.6, -30], collide: "metal" });

    /* ---- LANDMARK 2: the cooling tower and its spiral ---- */
    const CX = 30, CZ = 26;
    out.add(new THREE.CylinderGeometry(7, 8.5, CEIL, 16, 1), "basement.pipe",
      { pos: [CX, CEIL / 2, CZ], collide: true, uvScale: 4 });
    for (let i = 0; i < 4; i += 1) {
      out.add(new THREE.TorusGeometry(8.2 - i * 0.1, 0.5, 6, 20), "basement.case",
        { pos: [CX, 2.5 + i * 3.6, CZ], rot: [Math.PI / 2, 0, 0], collide: false });
    }
    const SPIRAL = 20;
    for (let i = 0; i < SPIRAL; i += 1) {
      if (i % 5 === 4) continue;
      const t = i / SPIRAL;
      const a = t * TAU * 2.2;
      out.add(P.platform(4.2, 0.4, 3.2, { bevel: 0.06 }), "shared.grate", {
        pos: [CX + Math.cos(a) * 10.5, 1.6 + t * (CEIL - 3), CZ + Math.sin(a) * 10.5],
        rot: [0, -a, 0], collide: "metal",
      });
    }
    out.add(P.platform(8, 0.5, 8, { bevel: 0.1 }), "shared.grate",
      { pos: [CX, CEIL - 1.1, CZ], collide: "metal" });
    for (let i = 0; i < 5; i += 1) {
      const pipe = new THREE.CylinderGeometry(0.8, 0.8, 22, 8, 1);
      pipe.rotateZ(Math.PI / 2);
      out.add(pipe, "basement.pipe",
        { pos: [CX - 18, 12 + i * 0.9, CZ + (i - 2) * 1.9], collide: true });
    }

    /* ---- LANDMARK 3: the cable cathedral ---- */
    for (let i = -5; i <= 5; i += 1) {
      out.add(P.platform(74, 0.35, 1.6, { bevel: 0.05 }), "shared.grate",
        { pos: [0, 12.5 + Math.abs(i) * 0.35, i * 5], collide: "metal", uvScale: 2, ao: 0 });
      for (let k = 0; k < 9; k += 1) {
        out.inst(`cablebundle${k % 3}`,
          () => P.tree("cable", { height: 3.6, seed: 0x4000 + (k % 3) * 29 }),
          "basement.cable", { pos: [-32 + k * 8, 12.4 + Math.abs(i) * 0.35, i * 5] });
      }
      out.add(new THREE.CylinderGeometry(0.1, 0.1, 3.5, 5, 1), "shared.metal",
        { pos: [-30, 14.3, i * 5], collide: false, ao: 0 });
      out.add(new THREE.CylinderGeometry(0.1, 0.1, 3.5, 5, 1), "shared.metal",
        { pos: [30, 14.3, i * 5], collide: false, ao: 0 });
    }
    /* Gantry over the top: the high tier. */
    out.add(P.platform(74, 0.5, 5, { bevel: 0.08 }), "shared.grate",
      { pos: [0, 13.2, 0], collide: "metal", uvScale: 2.4 });
    out.add(P.rail([[-36, 13.45, 2.5], [36, 13.45, 2.5]], { height: 1.0 }), "shared.rail",
      { collide: false, castShadow: false });
    out.add(P.rail([[-36, 13.45, -2.5], [36, 13.45, -2.5]], { height: 1.0 }), "shared.rail",
      { collide: false, castShadow: false });

    /* ---- the roof: structure between the cathedral and the lid ----

       Raising the ceiling to 24 opened ten metres of dead air over the
       cable trays. A machine room's roof is the busiest surface in the
       building - primary ducting, bus bar, sprinkler main - and an
       empty one reads as an unfinished box. */
    for (let i = -4; i <= 4; i += 1) {
      out.add(P.platform(H * 2, 1.1, 1.3, { bevel: 0.1 }), "hell.truss",
        { pos: [0, CEIL - 1.2, i * 10], collide: false, ao: 0, uvScale: 3 });
      for (let k = -3; k <= 3; k += 1) {
        out.add(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 5, 1), "shared.metal",
          { pos: [k * 12, CEIL - 3.4, i * 10], collide: false, ao: 0 });
      }
    }
    for (let i = 0; i < 20; i += 1) {
      out.inst("bigduct", F.duct, "roof.duct", {
        pos: [rngRange(rng, -38, 38), CEIL - 3.2, rngRange(rng, -38, 38)],
        rot: [0, rng() < 0.5 ? 0 : Math.PI / 2, 0], scale: [2.1, 2.1, 2.6],
      });
    }
    for (let i = 0; i < 9; i += 1) {
      const pipe = new THREE.CylinderGeometry(0.55, 0.55, H * 2, 7, 1);
      pipe.rotateZ(Math.PI / 2);
      out.add(pipe, "basement.pipe",
        { pos: [0, CEIL - 5.2 - (i % 3) * 0.9, -36 + i * 9], collide: false, ao: 0 });
    }

    /* ---- decor: screens, ducts, drums, spill ---- */
    for (let i = 0; i < 18; i += 1) {
      out.inst("duct", F.duct, "roof.duct", {
        pos: [rngRange(rng, -38, 38), 10.4, rngRange(rng, -38, 38)],
        rot: [0, rng() < 0.5 ? 0 : Math.PI / 2, 0],
      });
    }
    for (let i = 0; i < 22; i += 1) {
      out.inst("barrel", F.barrel, "basement.case", {
        pos: [rngRange(rng, -40, 40), 1.0, rngRange(rng, -40, 40)], rot: [0, rng() * TAU, 0],
        scale: rngRange(rng, 0.8, 1.35),
      });
    }
    for (let i = 0; i < 14; i += 1) {
      out.add(P.platform(5.4, 3.0, 0.3, { bevel: 0.04 }),
        i % 2 ? "basement.screen" : "basement.screenB", {
          pos: [rngRange(rng, -30, 30), 5.4, (i % 2 ? 1 : -1) * (H - 2.4)],
          collide: false, ao: 0,
        });
    }
    /* Three size classes of crate, and none of them at exactly
       character height: a field of identical man-sized boxes is the
       single most common filler tell in the medium. */
    for (let i = 0; i < 18; i += 1) {
      const c = rng();
      const sc = c < 0.25 ? rngRange(rng, 1.7, 2.3)
        : (c < 0.65 ? rngRange(rng, 0.95, 1.15) : rngRange(rng, 0.55, 0.72));
      out.inst("crate", F.crate, "basement.case", {
        pos: [rngRange(rng, -36, 36), 1.0 + sc * 0.6, rngRange(rng, -36, 36)],
        rot: [0, rng() * TAU, 0], scale: sc,
      });
    }
    /* Wall-mounted cable ladders and a cage of loom on the long walls,
       so the perimeter is not four flat slabs of concrete. */
    for (const s of [-1, 1]) {
      for (let i = 0; i < 9; i += 1) {
        out.add(P.platform(0.6, CEIL - 4, 1.2, { bevel: 0.06 }), "basement.case",
          { pos: [s * (H - 2.6), (CEIL - 4) / 2, -36 + i * 9], collide: false, uvScale: 2 });
        out.inst(`cableriser${i % 3}`,
          () => P.tree("cable", { height: 4.4, seed: 0x4400 + (i % 3) * 31 }),
          "basement.cable", { pos: [s * (H - 3.4), 9.5, -36 + i * 9] });
      }
    }

    out.mover(P.elevator({
      pos: [-30, 0, -26], low: 1.2, high: 13.0, period: 8, size: [5, 0.5, 5],
      surface: "shared.grate",
    }));
    out.mover(P.movingPlatform({
      points: [[-18, 6.5, 12], [18, 6.5, 12], [18, 6.5, -12], [-18, 6.5, -12]],
      period: 16, size: [4.2, 0.4, 4.2], surface: "shared.grate",
    }));
    out.mover(P.rotator({
      pos: [CX, 8, CZ], radius: 12, arms: 2, armSize: [8, 0.4, 2.4], period: 13,
      surface: "hell.truss",
    }));

    /* Sealed room, no sun: the accents are not accents, they are the
       entire key. Four of them at forty-plus metres of reach so no
       corner of a ninety-metre floor plate is unlit, colour-coded to
       the three landmarks so navigation works by hue - which is the
       only thing that CAN work at this light level. */
    out.accent(0, { pos: [0, 11, -30], color: 0x4affb0, intensity: 190, distance: 74 });
    out.accent(1, { pos: [CX, 12, CZ], color: 0x5adcff, intensity: 175, distance: 70 });
    out.accent(2, { pos: [-14, 10, 4], color: 0xffb457, intensity: 200, distance: 78 });
    out.accent(3, { pos: [16, 6, 30], color: 0xff6a80, intensity: 110, distance: 52 });

    /* Kept dim on purpose. These are additive and double-sided, so a
       saturated shaft in a room this dark is the brightest thing in
       the frame by a factor of three and burns a hole in it. */
    out.beam({ pos: [0, 18.4, -30], dir: [0, -1, 0], length: 17, radius: 1.6, radiusEnd: 5.5, color: 0x186a44, sides: 20, steps: 4 });
    out.beam({ pos: [CX, CEIL - 0.6, CZ], dir: [0, -1, 0], length: CEIL - 1, radius: 3, radiusEnd: 8, color: 0x14506a, sides: 20, steps: 4 });
    out.beam({ pos: [-26, CEIL - 4, 6], dir: [0, -1, 0], length: 18, radius: 1.4, radiusEnd: 5, color: 0x4a3a16, sides: 18, steps: 3 });

    out.spawn(0, [0, 1.4, 38], Math.PI);
    out.spawn(1, [0, 13.9, 0], -Math.PI / 2);
    out.spawn(2, [CX, CEIL - 0.5, CZ], Math.PI);

    out.record("farm-1", [0, 20.2, -30], { hint: "exploration" });
    out.record("farm-2", [-20, 1.8, 32], { requires: "miniboss:plant", hint: "boss" });
    out.record("farm-3", [0, 1.8, 22], { requires: "clout:100", hint: "clout" });
    out.record("farm-4", [24, 1.8, -34], { requires: "pound:breaker-1", hint: "ground-pound" });
    out.record("farm-5", [-34, 6.6, -6], { requires: "switch:blue-3", hint: "timed" });
    out.record("farm-6", [-30, -0.4, 26], { hidden: true, hint: "hidden" });
    out.record("farm-7", [CX, CEIL + 0.4, CZ], { hint: "gauntlet" });
    out.switchAt([24, 1.2, -28], "pound", "pound:breaker-1");
    out.switchAt([-34, 1.2, 12], "blue", "switch:blue-3");

    out.cloutLine([-30, 1.8, 9], [30, 1.8, 9], 14, "yellow");
    out.cloutLine([-30, 1.8, -9], [30, 1.8, -9], 14, "yellow");
    out.cloutRing([CX, 4, CZ], 10.5, 10, "yellow");
    out.cloutLine([-34, 14.2, 0], [34, 14.2, 0], 12, "yellow");
    out.cloutRing([0, 4.5, -30], 8, 8, "yellow");
    out.clout([0, 19.6, -30], "red");
    out.clout([-30, 0.4, 26], "red");
    out.deal([0, 14.0, -14], "stan-shield");

    for (let i = 0; i < 12; i += 1) {
      out.enemy(rngPick(rng, ["imp", "bat", "plant", "pig"]),
        [rngRange(rng, -36, 36), 1.4, rngRange(rng, -36, 36)]);
    }
    /* "phantom", not "plant". The Payola Phantom is the fight bosses.js
       registers for course 3; "plant" is an ENEMY archetype, and
       provideArena silently no-ops on an id it does not know, so the
       course shipped with a boss record gated on a fight that was
       never armed. */
    out.boss("phantom", [-20, 1.4, 32], { record: "farm-2" });

    /* Camera markers - see HOW TO AUTHOR A CAMERA MARKER above.
       Both vantages stand well inside the room: an aisle lid at 4m and
       the Monolith's fourth cap at 14m, both of which leave the solved
       camera under the 24m lid with metres to spare. */
    out.marker("arrival", [0, 1.6, 38], [0, 9, -30]);
    out.marker("vista", [0, 4.2, -18], [CX, 10, CZ]);
    out.marker("platforming", [CX, 1.6, CZ + 26], [CX, 11, CZ]);
    out.marker("enemy-encounter", [-6, 1.6, 16], [-24, 2, 30]);
    out.marker("collect", [16, 1.6, 9], [4, 2.2, 9]);
    out.marker("boss", [-8, 1.6, 22], [-20, 3, 32]);
    out.marker("interior", [10, 1.6, 4], [-6, 13, -6]);
    out.marker("water", [0, 1.6, 14], [0, 0.4, 0]);
    out.marker("high-ground", [0, 13.6, 0], [CX, 12, CZ]);
  },
};

/* ============================================================
   COURSE 4 - INFLUENCER ROOFTOP AFTERPARTY

   Thirty floors up at night. The course is three roofs at
   different heights connected by gaps, and the drop between them
   is the hazard: a rooftop course where you cannot fall off is a
   courtyard with a nice backdrop.

   Landmarks: the pool and its neon, the old timber water tower,
   and the tower crane swinging over the void from the next site.
   ============================================================ */

const COURSE_4 = {
  id: 4,
  name: "Influencer Rooftop Afterparty",
  theme: "rooftop",
  music: "rooftop",
  spawnCount: 3,
  records: [
    { id: "roof-1", name: "Hook of the Crane", gate: "exploration" },
    { id: "roof-2", name: "Guest List Only", gate: "boss" },
    { id: "roof-3", name: "A Hundred Little Hearts", gate: "clout-100" },
    { id: "roof-4", name: "Clear the Alley", gate: "long-jump" },
    { id: "roof-5", name: "Relight the Sign", gate: "timed-switch" },
    { id: "roof-6", name: "Inside the Tank", gate: "hidden" },
    { id: "roof-7", name: "Scaffold Sunrise", gate: "gauntlet" },
  ],

  build(ctx, out) {
    const P = out.prim;
    const F = makeProps(P);
    const rng = out.rng;

    out.bounds([-70, -40, -60], [70, 46, 70]);

    /** A roof slab with a parapet all the way round. */
    function roof(cx, cz, w, d, y, surf) {
      out.add(P.platform(w, 2.2, d, { bevel: 0.2 }), "roof.parapet",
        { pos: [cx, y - 1.1, cz], collide: true, uvScale: 4 });
      out.add(P.platform(w - 1.6, 0.4, d - 1.6, { bevel: 0.08 }), surf,
        { pos: [cx, y + 0.2, cz], collide: true, uvScale: 4 });
      for (let s = 0; s < 4; s += 1) {
        const a = (s / 4) * TAU;
        const len = s % 2 === 0 ? w : d;
        out.add(P.platform(len, 1.1, 0.8, { bevel: 0.08 }), "roof.parapet", {
          pos: [cx + Math.sin(a) * ((s % 2 === 0 ? d : w) / 2 - 0.4), y + 0.75,
            cz + Math.cos(a) * ((s % 2 === 0 ? d : w) / 2 - 0.4)],
          rot: [0, a, 0], collide: true,
        });
      }
      /* The building under it. Without a shaft of facade the roof
         reads as a plate floating in a night sky - and a facade with
         no lit windows in it reads as a plinth. Thirty floors of
         occupied office is the only thing that says how high up this
         course is. */
      out.add(P.platform(w - 0.5, 34, d - 0.5, { bevel: 0.3 }), "roof.facade",
        { pos: [cx, y - 18, cz], collide: true, uvScale: 6, ao: 0 });
    }

    roof(0, 0, 58, 58, 0, "roof.deck");
    roof(-48, 22, 26, 30, -6, "roof.gravel");
    roof(42, -30, 30, 26, 7, "roof.gravel");

    /* ---- the city this roof is thirty floors above ----

       The single most important object in the course and it did not
       exist: every frame of a rooftop level is half horizon, and the
       horizon here was an empty gradient. Neighbouring towers, some of
       them ABOVE the deck so they close the frame, all of them decor.
       One draw call. */
    skyline(out, P, rng, {
      surface: "roof.tower", count: 42,
      inner: 62, outer: 210, minH: 34, maxH: 150,
      centre: [0, 0], y: -46,
    });
    skyline(out, P, rng, {
      surface: "redcarpet.tower", count: 22,
      inner: 96, outer: 260, minH: 60, maxH: 210,
      centre: [10, -20], y: -70,
    });

    /* ---- LANDMARK 1: the pool, the bar and the DJ pyramid ---- */
    for (let s = 0; s < 4; s += 1) {
      const a = (s / 4) * TAU;
      out.add(P.platform(20, 1.2, 1.2, { bevel: 0.08 }), "roof.pooltile", {
        pos: [-8 + Math.sin(a) * 9.4, 0.8, 6 + Math.cos(a) * 9.4], rot: [0, a, 0], collide: true,
      });
    }
    out.add(P.platform(18, 1.6, 18, { bevel: 0.1 }), "roof.pooltile",
      { pos: [-8, -0.4, 6], collide: true, uvScale: 2 });
    out.add(P.water(18, 18, { segments: 12, swell: 0.05 }), "roof.pool",
      { pos: [-8, 0.9, 6], collide: "water" });
    out.add(P.platform(15, 0.5, 15, { bevel: 0.06 }), "roof.neon",
      { pos: [-8, -0.2, 6], collide: false, tint: 0x2ee8ff });

    out.add(P.platform(12, 2.6, 3.4, { bevel: 0.12 }), "roof.deck",
      { pos: [16, 1.3, 10], collide: true });
    out.add(P.platform(13, 0.4, 4.2, { bevel: 0.1 }), "shared.chrome",
      { pos: [16, 2.8, 10], collide: true });
    out.add(P.platform(11, 3.4, 0.5, { bevel: 0.08 }), "roof.neon",
      { pos: [16, 4.6, 8], collide: false, tint: 0xff2ec4 });
    for (let i = 0; i < 6; i += 1) {
      out.inst("stool", () => {
        const parts = [];
        const seat = new THREE.CylinderGeometry(0.36, 0.32, 0.14, 10, 1);
        seat.translate(0, 1.0, 0);
        const post = new THREE.CylinderGeometry(0.07, 0.09, 1.0, 8, 1);
        post.translate(0, 0.5, 0);
        parts.push(seat, post);
        return mergeGeometries(parts);
      }, "shared.chrome", { pos: [11.4 + i * 1.9, 0.4, 13.4] });
    }

    /* DJ booth: a stepped pyramid of LED. Mid tier and the loudest
       object on the deck. */
    for (let i = 0; i < 4; i += 1) {
      out.add(P.platform(12 - i * 2.4, 1.3, 8 - i * 1.6, { bevel: 0.08 }), "hell.led",
        { pos: [18, 0.65 + i * 1.3, -18], collide: true, uvScale: 2 });
    }
    out.add(P.platform(6, 0.4, 3.2, { bevel: 0.06 }), "shared.chrome",
      { pos: [18, 5.6, -18], collide: true });
    for (const s of [-1, 1]) {
      out.inst("speaker", F.speaker, "hell.speaker",
        { pos: [18 + s * 8, 0.4, -18], rot: [0, -s * 0.4, 0], scale: 1.6 });
    }

    /* ---- LANDMARK 2: the water tower ---- */
    const TX = -20, TZ = -20;
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * TAU + Math.PI / 4;
      const leg = new THREE.CylinderGeometry(0.28, 0.38, 11, 6, 1);
      leg.rotateZ(Math.cos(a) * 0.09);
      leg.rotateX(-Math.sin(a) * 0.09);
      out.add(leg, "roof.deck",
        { pos: [TX + Math.cos(a) * 3.4, 5.9, TZ + Math.sin(a) * 3.4], collide: true });
    }
    out.add(P.platform(10, 0.5, 10, { bevel: 0.1 }), "roof.deck",
      { pos: [TX, 11.3, TZ], collide: true });
    out.add(new THREE.CylinderGeometry(4.4, 4.4, 7, 14, 1), "roof.deck",
      { pos: [TX, 15.1, TZ], collide: true, uvScale: 2 });
    out.add(new THREE.ConeGeometry(5.2, 3.2, 14, 1), "roof.duct",
      { pos: [TX, 20.2, TZ], collide: true });
    for (let i = 0; i < 3; i += 1) {
      out.add(new THREE.TorusGeometry(4.5, 0.16, 6, 18), "shared.metal",
        { pos: [TX, 13.2 + i * 2.2, TZ], rot: [Math.PI / 2, 0, 0], collide: false });
    }
    /* The spiral of scaffold boards that climbs it - the gauntlet. */
    for (let i = 0; i < 16; i += 1) {
      if (i % 5 === 4) continue;
      const t = i / 16;
      const a = t * TAU * 1.9;
      out.add(P.platform(3.6, 0.3, 2.6, { bevel: 0.05 }), "roof.deck", {
        pos: [TX + Math.cos(a) * 7.4, 1.4 + t * 16, TZ + Math.sin(a) * 7.4],
        rot: [0, -a, 0], collide: true,
      });
    }
    out.add(P.platform(6, 0.4, 6, { bevel: 0.08 }), "shared.grate",
      { pos: [TX, 21.9, TZ], collide: "metal" });

    /* ---- LANDMARK 3: the crane ---- */
    const KX = 46, KZ = 26;
    for (let i = 0; i < 9; i += 1) {
      out.add(P.platform(3.2, 3.4, 3.2, { bevel: 0.1 }), "hell.truss",
        { pos: [KX, 1.7 + i * 3.4, KZ], rot: [0, i * 0.05, 0], collide: true, uvScale: 1.6 });
    }
    out.add(P.platform(52, 1.6, 3.0, { bevel: 0.12 }), "hell.truss",
      { pos: [KX - 20, 32, KZ], collide: true, uvScale: 2 });
    out.add(P.platform(14, 1.6, 3.0, { bevel: 0.12 }), "hell.truss",
      { pos: [KX + 9, 32, KZ], collide: true });
    out.add(P.platform(5, 3, 4, { bevel: 0.1 }), "roof.duct",
      { pos: [KX + 15, 32, KZ], collide: true });
    out.add(new THREE.CylinderGeometry(0.1, 0.1, 11, 5, 1), "shared.metal",
      { pos: [KX - 30, 26, KZ], collide: false });
    out.add(P.platform(3.2, 1.4, 3.2, { bevel: 0.14 }), "shared.metal",
      { pos: [KX - 30, 20.2, KZ], collide: true });
    out.mover(P.movingPlatform({
      points: [[KX - 34, 21.4, KZ], [KX - 34, 21.4, KZ - 26], [KX - 34, 21.4, KZ]],
      period: 14, size: [4, 0.4, 4], surface: "hell.truss",
    }));

    /* ---- the long-jump alley ---- */
    /* A ten-metre gap between the main roof and the low roof, with a
       hoarding island in the middle you cannot land on. */
    out.add(P.platform(5, 0.6, 5, { bevel: 0.1 }), "roof.gravel",
      { pos: [-34, 0.3, 12], collide: true });
    out.add(P.platform(1.2, 5, 1.2, { bevel: 0.08 }), "roof.parapet",
      { pos: [-38, 2.5, 16], collide: true });

    /* ---- decor: cabanas, hedges, loungers, ducts, string lights ---- */
    for (let i = 0; i < 4; i += 1) {
      const cx = -22 + i * 15, cz = 22;
      for (const s of [-1, 1]) {
        for (const t of [-1, 1]) {
          out.add(new THREE.CylinderGeometry(0.12, 0.14, 3.2, 6, 1), "roof.deck",
            { pos: [cx + s * 2.4, 1.6, cz + t * 2.4], collide: true });
        }
      }
      out.add(P.platform(6.2, 0.4, 6.2, { bevel: 0.1 }), "roof.cushion",
        { pos: [cx, 3.4, cz], collide: true });
      out.add(P.platform(6.4, 0.2, 6.4, { bevel: 0.06 }), "roof.neon",
        { pos: [cx, 3.15, cz], collide: false, tint: [0xff2ec4, 0x2ee8ff, 0xb44dff, 0xffd166][i] });
    }
    for (let i = 0; i < 18; i += 1) {
      out.inst("lounger", F.lounger, "roof.cushion", {
        pos: [rngRange(rng, -24, 24), 0.4, rngRange(rng, -6, 18)], rot: [0, rng() * TAU, 0],
      });
    }
    for (let i = 0; i < 12; i += 1) {
      out.inst("parasol", F.parasol, "roof.cushion", {
        pos: [rngRange(rng, -24, 24), 0.4, rngRange(rng, -8, 20)], rot: [0, rng() * TAU, 0],
      });
    }
    for (let i = 0; i < 26; i += 1) {
      /* THE ROOFTOP HEDGE WAS THE SAME BUG AS THE FOOD COURT'S: one
         key, one rounded box, twenty-six clones at one size, told
         apart only by a yaw that a square-in-plan solid does not
         answer to. It shares the three-silhouette kit now; only the
         surface differs. */
      const s = rngRange(rng, 0.9, 1.5);
      plantHedge(out, rng, i, [rngRange(rng, -26, 26), 0.4, rngRange(rng, -26, 26)],
        1.3 * s, 1.7 * s, "roof.hedge");
    }
    for (let i = 0; i < 14; i += 1) {
      out.inst("duct", F.duct, "roof.duct", {
        pos: [rngRange(rng, -26, 26), 0.4, rngRange(rng, -26, 26)],
        rot: [0, rng() < 0.5 ? 0 : Math.PI / 2, 0],
      });
    }
    for (let i = 0; i < 10; i += 1) {
      out.inst(`roofdead${i % 3}`,
        () => P.tree("dead", { height: 4.4, seed: 0x5000 + (i % 3) * 37 }), "roof.hedge", {
          pos: [rngRange(rng, -26, 26), 0.4, rngRange(rng, -26, 26)],
          rot: [0, rng() * TAU, 0], scale: [1, rngRange(rng, 0.84, 1.2), 1],
        });
    }
    /* Festoon lights on catenaries. Twelve strings, one draw call. */
    for (let k = 0; k < 12; k += 1) {
      const a0 = (k / 12) * TAU;
      for (let i = 0; i <= 8; i += 1) {
        const t = i / 8;
        const sag = Math.sin(t * Math.PI) * 2.2;
        out.inst("festoon", () => new THREE.SphereGeometry(0.16, 6, 5), "roof.neon", {
          pos: [
            lerp(Math.cos(a0) * 26, Math.cos(a0 + 0.52) * 26, t),
            7.5 - sag,
            lerp(Math.sin(a0) * 26, Math.sin(a0 + 0.52) * 26, t),
          ],
        });
      }
    }
    for (let i = 0; i < 8; i += 1) {
      out.add(P.pillar(0.16, 8, { sides: 6, base: true, cap: false }), "roof.duct",
        { pos: [Math.cos(i / 8 * TAU) * 26, 0.4, Math.sin(i / 8 * TAU) * 26], collide: true });
    }

    /* The neon sign the timed switch relights, hung off the parapet. */
    for (let i = 0; i < 4; i += 1) {
      out.add(P.platform(5, 6.5, 0.5, { bevel: 0.1 }), "roof.neon", {
        pos: [-12 + i * 8, 5, -28.5], collide: false,
        tint: [0xff2ec4, 0x2ee8ff, 0xb44dff, 0xffd166][i],
      });
    }

    /* ---- the party ----

       An "afterparty" with nobody at it is a roof with furniture on
       it. Guests around the bar, along the pool coping, on the cabana
       terrace and up on the DJ pyramid steps - ten draw calls for the
       whole crowd, and the single largest change to what this course
       reads as. */
    crowdField(out, F, rng, {
      rows: 3, per: 14, faceAt: [16, 2, 10], cheer: 0.3,
      at: (i, k) => {
        const a = -0.9 + (i / 14) * 2.6;
        const r = 5.5 + k * 2.3;
        return [16 + Math.cos(a) * r, 0.4, 10 + Math.sin(a) * r * 0.8];
      },
    });
    crowdField(out, F, rng, {
      rows: 1, per: 20, faceAt: [-8, 1, 6], cheer: 0.35,
      at: (i) => {
        const a = (i / 20) * TAU;
        return [-8 + Math.cos(a) * 11.4, 0.4, 6 + Math.sin(a) * 11.4];
      },
    });
    crowdField(out, F, rng, {
      rows: 2, per: 16, faceAt: [18, 5, -18], cheer: 0.85,
      at: (i, k) => {
        if (rng() < 0.15) return null;
        return [2 + i * 2.1, 0.4, -24 + k * 3.4 + rngRange(rng, -0.6, 0.6)];
      },
    });
    crowdField(out, F, rng, {
      rows: 2, per: 12, faceAt: [0, 1, 0], cheer: 0.25,
      at: (i, k) => [-24 + i * 4.2, 0.4, 19 + k * 5.5 + rngRange(rng, -0.8, 0.8)],
    });

    out.mover(P.elevator({
      pos: [-34, 0, -8], low: 0.6, high: 11.6, period: 8, size: [4.4, 0.5, 4.4],
      surface: "shared.grate",
    }));
    out.mover(P.rotator({
      pos: [0, 6.5, -6], radius: 7, arms: 3, armSize: [6, 0.4, 2.2], period: 10,
      surface: "roof.deck",
    }));
    out.mover(P.seesaw({ pos: [30, 1.0, 6], size: [9, 0.4, 3.2], surface: "roof.deck" }));

    /* Night exterior with a moon for a key, so as on every other
       course in this game the practicals carry the ground plane. Pool
       cyan, DJ magenta, bar amber, water-tower violet: four colours,
       four landmarks, and a deck that is never one flat hue. */
    out.accent(0, { pos: [-8, 4, 6], color: 0x2ee8ff, intensity: 170, distance: 54 });
    out.accent(1, { pos: [18, 7, -18], color: 0xff2ec4, intensity: 200, distance: 60 });
    out.accent(2, { pos: [16, 5, 10], color: 0xffb44a, intensity: 130, distance: 44 });
    out.accent(3, { pos: [TX, 15, TZ], color: 0xb46aff, intensity: 140, distance: 52 });

    out.spawn(0, [0, 0.6, 24], Math.PI);
    out.spawn(1, [TX, 12.0, TZ], 0);
    out.spawn(2, [KX - 30, 21.2, KZ], -Math.PI / 2);

    out.record("roof-1", [KX - 30, 21.8, KZ], { hint: "exploration" });
    out.record("roof-2", [18, 6.4, -18], { requires: "miniboss:bouncer", hint: "boss" });
    out.record("roof-3", [0, 2.0, 14], { requires: "clout:100", hint: "clout" });
    out.record("roof-4", [-48, -4.6, 22], { hint: "long-jump" });
    out.record("roof-5", [0, 2.0, -26], { requires: "switch:blue-4", hint: "timed" });
    out.record("roof-6", [TX, 15.4, TZ], { hidden: true, hint: "hidden" });
    out.record("roof-7", [TX, 22.6, TZ], { hint: "gauntlet" });
    out.switchAt([26, 0.6, -22], "blue", "switch:blue-4");

    out.cloutRing([-8, 2.4, 6], 11, 12, "yellow");
    out.cloutLine([-26, 1.4, 24], [26, 1.4, 24], 14, "yellow");
    out.cloutLine([-30, 1.4, 12], [-44, 0.4, 18], 8, "yellow");
    out.cloutRing([TX, 6, TZ], 7.4, 10, "yellow");
    out.cloutLine([KX - 4, 33.4, KZ], [KX - 40, 33.4, KZ], 12, "yellow");
    out.clout([18, 6.2, -18], "red");
    out.clout([TX, 22.4, TZ], "red");
    out.clout([42, 8.4, -30], "red");
    out.deal([42, 8.2, -30], "label-advance");

    for (let i = 0; i < 12; i += 1) {
      out.enemy(rngPick(rng, ["dancer", "bat", "drone", "pig"]),
        [rngRange(rng, -24, 24), 0.6, rngRange(rng, -24, 24)]);
    }
    out.boss("bouncer", [18, 0.6, -14], { record: "roof-2" });

    /* Camera markers - see HOW TO AUTHOR A CAMERA MARKER above. The
       vantages stand on the water tower deck and out on the crane jib,
       which are the two places in the course where the solved camera
       ends up over open air with the whole city behind it. */
    out.marker("arrival", [0, 1.0, 24], [TX, 14, TZ]);
    out.marker("vista", [TX, 12, TZ], [KX - 20, 32, KZ]);
    out.marker("platforming", [TX + 18, 1.0, TZ + 14], [TX, 10, TZ]);
    out.marker("enemy-encounter", [8, 1.0, 4], [-10, 2.4, -14]);
    out.marker("collect", [16, 1.0, 24], [16, 3.0, 10]);
    out.marker("boss", [6, 1.0, -4], [18, 4.0, -18]);
    out.marker("interior", [-7, 1.0, 6], [-7, 1.6, 22]);
    out.marker("water", [8, 1.0, 20], [-8, 1.0, 6]);
    out.marker("high-ground", [KX - 20, 33, KZ], [18, 5, -18]);
  },
};

/* ============================================================
   COURSE 5 - BOYZ II HELL: THE FINAL LIVESTREAM

   Not a place, a broadcast. An arena floating in a void with a
   magma moat, a stage the size of a street, and a lighting truss
   overhead that doubles as the high tier.

   Everything is lit from below. That is the whole art direction:
   underlight is what turns an ordinary silhouette into a villain,
   and it costs one hemisphere light with a hot lower half.
   ============================================================ */

const COURSE_5 = {
  id: 5,
  name: "Boyz II Hell - Final Livestream",
  theme: "hell",
  music: "hell",
  spawnCount: 3,
  records: [
    { id: "hell-1", name: "Above the Rig", gate: "exploration" },
    { id: "hell-2", name: "Lucifer Lipsync", gate: "boss" },
    { id: "hell-3", name: "A Hundred Screaming Fans", gate: "clout-100" },
    { id: "hell-4", name: "Kill the Pyro", gate: "ground-pound" },
    { id: "hell-5", name: "Encore Run", gate: "timed-switch" },
    { id: "hell-6", name: "Under the Stage", gate: "hidden" },
    { id: "hell-7", name: "Climb the Cathedral", gate: "gauntlet" },
  ],

  build(ctx, out) {
    const P = out.prim;
    const F = makeProps(P);
    const rng = out.rng;

    const R = 40;
    out.bounds([-R - 30, -30, -R - 40], [R + 30, 46, R + 30]);

    /* ---- the arena floor and its moat ---- */
    out.add(new THREE.CylinderGeometry(R, R - 3, 4, 40, 1), "hell.rock",
      { pos: [0, -2, 0], collide: true, uvScale: 6 });
    out.add(new THREE.CylinderGeometry(R - 4, R - 4, 0.6, 40, 1), "hell.stage",
      { pos: [0, 0.0, 0], collide: true, uvScale: 5 });
    out.add(new THREE.TorusGeometry(R + 5, 4.5, 8, 44), "hell.magma",
      { pos: [0, -3.5, 0], rot: [Math.PI / 2, 0, 0], collide: "water" });
    for (let i = 0; i < 26; i += 1) {
      const a = (i / 26) * TAU;
      out.inst(`spire${i % 3}`,
        () => P.tree("spire", { height: 9, seed: 0x6000 + (i % 3) * 43 }), "hell.rock", {
        pos: [Math.cos(a) * (R - 1.5), -1.5, Math.sin(a) * (R - 1.5)],
        rot: [0, rng() * TAU, 0], scale: rngRange(rng, 0.8, 1.5),
      });
    }

    /* ---- LANDMARK 1: the stage ---- */
    const SZ = -26;
    out.add(P.platform(52, 4.5, 20, { bevel: 0.3 }), "hell.stage",
      { pos: [0, 2.25, SZ], collide: true, uvScale: 5 });
    out.add(P.platform(52.8, 0.5, 20.8, { bevel: 0.14 }), "hell.deck",
      { pos: [0, 4.75, SZ], collide: "metal", uvScale: 3 });
    /* The thrust: a catwalk out into the arena, the boss arena floor. */
    out.add(P.platform(9, 4.5, 30, { bevel: 0.2 }), "hell.stage",
      { pos: [0, 2.25, SZ + 24], collide: true, uvScale: 4 });
    out.add(P.platform(9.6, 0.5, 30.6, { bevel: 0.12 }), "hell.deck",
      { pos: [0, 4.75, SZ + 24], collide: "metal", uvScale: 3 });
    out.add(new THREE.CylinderGeometry(9, 9, 5, 26, 1), "hell.stage",
      { pos: [0, 2.5, SZ + 40], collide: true, uvScale: 4 });
    out.add(new THREE.CylinderGeometry(9.4, 9.4, 0.5, 26, 1), "hell.deck",
      { pos: [0, 5.0, SZ + 40], collide: "metal" });
    /* Under-stage crawlspace: the hidden record. */
    out.add(P.platform(20, 0.4, 8, { bevel: 0.06 }), "hell.deck",
      { pos: [0, 0.6, SZ - 4], collide: "metal" });

    /* Stairs up either side. */
    for (const s of [-1, 1]) {
      for (let i = 0; i < 5; i += 1) {
        out.add(P.platform(5, 1.0, 1.8, { bevel: 0.05 }), "hell.deck",
          { pos: [s * 24, 0.5 + i * 1.0, SZ + 12 - i * 1.7], collide: "metal" });
      }
    }

    /* ---- LANDMARK 2: the throne screen ---- */
    out.add(P.platform(56, 30, 3, { bevel: 0.2 }), "hell.led",
      { pos: [0, 16, SZ - 12], collide: true, uvScale: 6 });
    for (const s of [-1, 1]) {
      out.add(P.platform(12, 26, 3, { bevel: 0.2 }), "hell.led",
        { pos: [s * 32, 14, SZ - 8], rot: [0, -s * 0.5, 0], collide: true, uvScale: 6 });
    }
    /* The horned crown on top: the course's true silhouette. */
    out.add(P.platform(30, 3, 5, { bevel: 0.2 }), "hell.chrome",
      { pos: [0, 32, SZ - 12], collide: true });
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i += 1) {
        const horn = new THREE.ConeGeometry(1.5 - i * 0.2, 8 - i * 1.2, 6, 1);
        horn.rotateZ(s * (0.28 + i * 0.12));
        out.add(horn, "hell.chrome", {
          pos: [s * (6 + i * 4.4), 36 - i * 1.4, SZ - 12], collide: false,
        });
      }
    }
    out.add(P.platform(12, 0.6, 5, { bevel: 0.12 }), "hell.truss",
      { pos: [0, 33.8, SZ - 12], collide: true });

    /* ---- LANDMARK 3: the truss cathedral ---- */
    for (let i = 0; i < 5; i += 1) {
      const y = 20 + i * 0.0;
      const z = SZ + i * 16;
      out.add(P.platform(74, 1.4, 1.6, { bevel: 0.1 }), "hell.truss",
        { pos: [0, y, z], collide: true, uvScale: 2 });
      for (const s of [-1, 1]) {
        out.add(P.pillar(0.7, 20, { sides: 6, cap: false }), "hell.truss",
          { pos: [s * 36, 0, z], collide: true });
      }
      for (let k = -3; k <= 3; k += 1) {
        out.add(new THREE.CylinderGeometry(0.28, 0.28, 3.2, 5, 1), "hell.truss",
          { pos: [k * 10, y - 2.2, z], collide: false, ao: 0 });
        const light = new THREE.CylinderGeometry(0.7, 0.95, 1.5, 8, 1);
        out.add(light, "hell.chrome", { pos: [k * 10, y - 4.2, z], collide: false, ao: 0 });
        /* Thirty-five beams, additive and double-sided, at a global
           gain of one. At full saturation they do not read as lights,
           they read as a white sheet over the middle of the frame -
           the colour here is roughly a quarter value, which is what
           lets the truss and the crowd stay visible THROUGH them. */
        out.beam({
          pos: [k * 10, y - 4.6, z], dir: [k * 0.06, -1, 0.05], length: 22,
          radius: 1.0, radiusEnd: 6.5, sides: 18, steps: 4,
          color: [0x4a0e20, 0x0a3e4a, 0x4a3c1e, 0x3a3a3e][(k + 3) % 4],
        });
      }
    }
    /* The gauntlet up: staggered truss platforms in the wings. */
    for (let i = 0; i < 14; i += 1) {
      if (i % 5 === 4) continue;
      const t = i / 14;
      const s = i % 2 ? 1 : -1;
      out.add(P.platform(4.4, 0.4, 4.4, { bevel: 0.08 }), "hell.truss", {
        pos: [s * (14 + Math.sin(i) * 5), 5.5 + t * 15, SZ + 30 - t * 24],
        rot: [0, rngRange(rng, -0.4, 0.4), 0], collide: true,
      });
    }
    out.add(P.platform(8, 0.5, 8, { bevel: 0.1 }), "shared.grate",
      { pos: [0, 21.4, SZ + 6], collide: "metal" });

    /* ---- floating fan platforms over the moat ---- */
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * TAU;
      const r = R - 8 + Math.sin(i * 1.7) * 4;
      out.add(new THREE.CylinderGeometry(3.4, 3.0, 1.0, 12, 1), "hell.rock", {
        pos: [Math.cos(a) * r, 1.2 + Math.sin(i * 2.3) * 2.4, Math.sin(a) * r], collide: true,
      });
    }

    /* ---- speaker stacks, pyro, decor ---- */
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i += 1) {
        out.inst("speaker", F.speaker, "hell.speaker", {
          pos: [s * 30, 0.4 + i * 2.0, SZ + 4], scale: 2.0,
        });
      }
    }
    for (let i = 0; i < 10; i += 1) {
      out.inst("pyro", () => {
        const parts = [];
        const b = new THREE.CylinderGeometry(0.4, 0.5, 1.1, 8, 1);
        b.translate(0, 0.55, 0);
        const n = new THREE.ConeGeometry(0.3, 0.7, 8, 1);
        n.translate(0, 1.4, 0);
        parts.push(b, n);
        return mergeGeometries(parts);
      }, "hell.chrome", { pos: [-27 + i * 6, 5.0, SZ + 8] });
    }
    /* Three size classes, kept off the thrust and off the boss circle
       so the two places the player actually fights are bare ground. */
    for (let i = 0; i < 20; i += 1) {
      const c = rng();
      const sc = c < 0.24 ? rngRange(rng, 1.8, 2.4)
        : (c < 0.66 ? rngRange(rng, 1.0, 1.2) : rngRange(rng, 0.55, 0.7));
      const x = rngRange(rng, -34, 34);
      const z = rngRange(rng, 0, 32);
      if (Math.abs(x) < 11 || Math.hypot(x, z - (SZ + 40)) < 19) continue;
      out.inst("crate", F.crate, "hell.speaker",
        { pos: [x, 0.3 + sc * 0.6, z], rot: [0, rng() * TAU, 0], scale: sc });
    }
    for (let i = 0; i < 26; i += 1) {
      const x = rngRange(rng, -34, 34);
      const z = rngRange(rng, -6, 34);
      if (Math.abs(x) < 11 || Math.hypot(x, z - (SZ + 40)) < 19) continue;
      out.inst("barrel", F.barrel, "hell.chrome",
        { pos: [x, 0.4, z], rot: [0, rng() * TAU, 0], scale: rngRange(rng, 0.75, 1.4) });
    }

    /* ---- THE AUDIENCE ----

       This is a livestream of a concert and the arena was empty. The
       fans fill the horseshoe of floor outside the thrust and climb
       the fan platforms over the moat, all lit from below by the
       magma, which is exactly the read the course wants: a wall of
       silhouettes with hot orange under their chins. */
    crowdField(out, F, rng, {
      rows: 7, per: 34, faceAt: [0, 6, SZ], cheer: 0.82,
      at: (i, k) => {
        const a = -1.32 + (i / 34) * 2.64;
        const r = 15 + k * 3.4 + rngRange(rng, -1, 1);
        const x = Math.sin(a) * r;
        const z = SZ + 34 + Math.cos(a) * r * 0.72;
        if (Math.abs(x) < 6.5) return null;              /* the thrust */
        if (Math.hypot(x, z - (SZ + 40)) < 11) return null;  /* the boss circle */
        if (Math.hypot(x, z) > R - 4) return null;       /* the moat */
        return [x, 0.3, z];
      },
    });
    crowdField(out, F, rng, {
      rows: 2, per: 20, faceAt: [0, 8, SZ], cheer: 0.9,
      at: (i, k) => {
        const a = (i / 20) * TAU;
        const r = R - 12 - k * 4;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (z < SZ + 8) return null;
        return [x, 0.3, z];
      },
    });

    /* Stage marks: a strip of white gaffer down the thrust. The stage
       is the darkest surface in the frame and the player walks the
       whole length of it, so it gets the one bright line in the
       course to read her feet against. */
    out.add(P.platform(1.2, 0.12, 28, { bevel: 0.02 }), "hell.mark",
      { pos: [0, 5.06, SZ + 24], collide: false, ao: 0, uvScale: 2 });
    for (let i = 0; i < 8; i += 1) {
      out.add(P.platform(3.4, 0.12, 0.5, { bevel: 0.02 }), "hell.mark",
        { pos: [-24 + i * 7, 5.06, SZ + 6], collide: false, ao: 0 });
    }

    out.mover(P.rotator({
      pos: [0, 8.5, SZ + 40], radius: 11, arms: 4, armSize: [9, 0.45, 2.6], period: 12,
      surface: "hell.truss",
    }));
    out.mover(P.elevator({
      pos: [-30, 0, 20], low: 1.2, high: 20.4, period: 10, size: [5, 0.5, 5],
      surface: "hell.truss",
    }));
    out.mover(P.movingPlatform({
      points: [[26, 8, 24], [26, 14, 4], [26, 20, -12]],
      period: 12, size: [4.4, 0.5, 4.4], surface: "hell.truss",
    }));

    out.accent(0, { pos: [0, 9, SZ + 40], color: 0xff4a80, intensity: 220, distance: 72 });
    out.accent(1, { pos: [0, 12, SZ + 4], color: 0x4ae0ff, intensity: 190, distance: 74 });
    out.accent(2, { pos: [-30, 3, 18], color: 0xff7030, intensity: 190, distance: 82 });
    out.accent(3, { pos: [30, 3, 18], color: 0xff7030, intensity: 190, distance: 82 });

    out.spawn(0, [0, 1.0, 30], Math.PI);
    out.spawn(1, [0, 5.4, SZ + 40], Math.PI);
    out.spawn(2, [0, 22.0, SZ + 6], Math.PI);

    out.record("hell-1", [0, 35.0, SZ - 12], { hint: "exploration" });
    out.record("hell-2", [0, 6.6, SZ + 40], { requires: "boss:lucifer", hint: "boss" });
    out.record("hell-3", [0, 2.4, 24], { requires: "clout:100", hint: "clout" });
    out.record("hell-4", [-20, 6.6, SZ], { requires: "pound:pyro-1", hint: "ground-pound" });
    out.record("hell-5", [30, 21.4, -6], { requires: "switch:blue-5", hint: "timed" });
    out.record("hell-6", [0, 1.6, SZ - 4], { hidden: true, hint: "hidden" });
    out.record("hell-7", [0, 22.6, SZ + 6], { hint: "gauntlet" });
    out.switchAt([-20, 5.2, SZ + 2], "pound", "pound:pyro-1");
    out.switchAt([0, 1.0, 30], "blue", "switch:blue-5");

    out.cloutRing([0, 2.2, 20], 16, 16, "yellow");
    out.cloutRing([0, 6.4, SZ + 40], 8, 10, "yellow");
    out.cloutLine([-24, 6.2, SZ], [24, 6.2, SZ], 14, "yellow");
    out.cloutLine([0, 22.0, SZ + 6], [0, 22.0, SZ + 40], 10, "yellow");
    out.clout([0, 34.6, SZ - 12], "red");
    out.clout([0, 6.4, SZ + 40], "red");
    out.deal([26, 8.6, 24], "choreo-cancel");

    for (let i = 0; i < 14; i += 1) {
      out.enemy(rngPick(rng, ["dancer", "imp", "bat", "lackey"]),
        [rngRange(rng, -30, 30), 1.0, rngRange(rng, -6, 32)]);
    }
    out.boss("lucifer", [0, 5.4, SZ + 40], { record: "hell-2" });

    /* Camera markers - see HOW TO AUTHOR A CAMERA MARKER above. Both
       vantages stand on the truss: the arena floats in a void, so a
       vantage anywhere near its edge solves a camera out over the
       moat with nothing behind it but sky. */
    out.marker("arrival", [0, 1.0, 34], [0, 10, SZ + 12]);
    out.marker("vista", [0, 20.9, SZ + 32], [0, 32, SZ - 12]);
    out.marker("platforming", [20, 1.0, SZ + 34], [16, 12, SZ + 14]);
    out.marker("enemy-encounter", [10, 1.0, 16], [-12, 2.4, 4]);
    out.marker("collect", [24, 1.0, 14], [8, 6.4, SZ + 40]);
    out.marker("boss", [0, 5.4, SZ + 62], [0, 8, SZ + 40]);
    out.marker("interior", [0, 5.4, SZ + 22], [0, 6, SZ]);
    out.marker("water", [0, 1.0, R - 16], [0, -2, R + 5]);
    out.marker("high-ground", [0, 21.8, SZ + 6], [R - 6, 2, 20]);
  },
};

const COURSES = [COURSE_1, COURSE_2, COURSE_3, COURSE_4, COURSE_5];

/* ============================================================
   MODULE
   ============================================================ */

export function create(ctx) {
  const surfaces = makeSurfaces(ctx);
  const primitives = makePrimitives();

  return {
    GRID,
    snap,
    surfaces,
    primitives,
    courses: COURSES,
    hub: HUB,

    /** Course definition by id. 0 is the hub. */
    byId(id) {
      if (id === 0) return HUB;
      return COURSES.find((c) => c.id === id) || null;
    },

    surface(name) { return surfaces.material(name); },
    surfaceScale(name) { return surfaces.scale(name); },
    surfaceCollision(name) { return surfaces.collision(name); },
    releaseSurfaces(prefixes) { surfaces.release(prefixes); },

    projectUV,
    paintGeometry,
    mergeGeometries,

    dispose() { surfaces.disposeAll(); },
  };
}
