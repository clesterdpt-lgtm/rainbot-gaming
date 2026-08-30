/* ============================================================
   APOP DEMON MOGGERS 3D - procedural texture synthesis

   Every surface in the game is generated here, at load time, into
   typed arrays and canvases. No image files ship with the build.

   The reason this module is as large as it is: the single loudest
   tell that a frame came from an engine demo rather than a game is a
   flat, uniform plane. Super Mario 64's textures are 32 or 64 pixels
   square, but they are never flat - they carry grain, stains, tile
   breaks and painted trim, and they are placed on geometry small
   enough that the variation always reads. We cannot copy the texel
   budget, so we copy the variance.

   Four decisions worth stating up front, because each of them was a
   bug the first time round:

   * The lattice noise is PERIODIC, not "tileable by cross-blending
     four lookups". The blend trick is seamless but averages four
     independent fields together toward the middle of the tile, which
     leaves every texture washed out in the centre and crisp at the
     border. Periodic Perlin wraps the integer gradient lattice, so a
     field sampled over u,v in [0,1) at an integer frequency tiles
     exactly and has uniform contrast everywhere.

   * Normals are Sobel-filtered from the SAME height field the albedo
     shades from. A normal map derived from the albedo instead
     disagrees with the shading wherever colour and relief are not the
     same thing - a dark scuff on a flat tile becomes a dent - and
     that mismatch is what makes procedural surfaces read as plastic.

   * Generators compose FIELDS: whole-image scalar layers built once,
     at a resolution matched to their own top octave, then bilinearly
     sampled. Evaluating an octave stack per texel inside the shading
     loop costs seconds per texture. Detail finer than a field can
     hold comes from a per-texel integer hash, which is free and tiles
     exactly by construction.

   * Colour space is decided here and only here. Albedo and emissive
     are tagged SRGBColorSpace; normal, AO/roughness/metalness and
     flow are tagged NoColorSpace. Getting that wrong double-encodes,
     and a double-encoded roughness map looks like a lighting bug
     rather than a texture bug, so it survives review.

   Repetition is attacked from two sides. Inside a tile, every
   generator multiplies a low-frequency macro field over its albedo so
   the texture is never uniform at its own scale. Across tiles,
   materials.js multiplies a separate world-space macro texture (see
   `macro()` below) over the surface at a ~40 m period, which is what
   actually stops a 20 m floor from showing its 2 m repeat. Variants
   are the third lever: `variants()` returns N independently seeded but
   otherwise identical sets, and world.js scatters them.
   ============================================================ */

import {
  clamp, clamp01, lerp, smoothstep, smootherstep,
  makeRng, hexToRgb, hslToRgb, mixHex,
} from "apop3d/core.js";

const DEFAULT_SIZE = 512;

/* ---------------------------------------------------------------
   Periodic gradient noise.

   `px`/`py` are the lattice periods in each axis and must be whole
   numbers; the gradient hash wraps at them. Separate periods per axis
   are not a luxury - brushed metal, carpet pile and wood grain are all
   strongly anisotropic, and faking that by stretching an isotropic
   field afterwards smears the grain into streaks with visible lattice
   corners in them.

   The gradient index comes from an integer hash rather than a 256
   entry permutation table, because a table caps the usable period at
   256 and the grain fields want more than that.
   --------------------------------------------------------------- */

function makePeriodicNoise(seed) {
  const salt0 = (seed | 0) || 1;

  function hash(x, y, salt) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + salt + salt0) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  // Eight gradients. Sixteen bands less, but at these frequencies the
  // extra directions are invisible and this lookup is the hot path.
  const GX = [1, -1, 1, -1, 1, -1, 0, 0];
  const GY = [1, 1, -1, -1, 0, 0, 1, -1];

  function noise(x, y, px, py, salt) {
    const X = Math.floor(x);
    const Y = Math.floor(y);
    const xf = x - X;
    const yf = y - Y;

    let x0 = X % px; if (x0 < 0) x0 += px;
    let y0 = Y % py; if (y0 < 0) y0 += py;
    const x1 = x0 + 1 === px ? 0 : x0 + 1;
    const y1 = y0 + 1 === py ? 0 : y0 + 1;

    const u = smootherstep(xf);
    const v = smootherstep(yf);

    const h00 = hash(x0, y0, salt) & 7;
    const h10 = hash(x1, y0, salt) & 7;
    const h01 = hash(x0, y1, salt) & 7;
    const h11 = hash(x1, y1, salt) & 7;

    const n00 = GX[h00] * xf + GY[h00] * yf;
    const n10 = GX[h10] * (xf - 1) + GY[h10] * yf;
    const n01 = GX[h01] * xf + GY[h01] * (yf - 1);
    const n11 = GX[h11] * (xf - 1) + GY[h11] * (yf - 1);

    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
  }

  noise.hash01 = (x, y, salt) => hash(x | 0, y | 0, salt | 0) / 4294967296;
  return noise;
}

const PN = makePeriodicNoise(0xA90D3D);

/** Per-texel integer hash in 0..1. Tiles exactly because it is keyed
 *  on the integer texel coordinate, and costs one multiply chain -
 *  which is why all grain-scale detail comes from here rather than
 *  from another octave of noise the field could not hold anyway. */
function hash01(x, y, salt) { return PN.hash01(x, y, salt); }

function fbmP(u, v, fx, fy, octaves = 4, gain = 0.5, salt = 0) {
  let amp = 1, sum = 0, norm = 0;
  let ax = Math.max(1, Math.round(fx));
  let ay = Math.max(1, Math.round(fy));
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * PN(u * ax, v * ay, ax, ay, salt + i * 7919);
    norm += amp;
    amp *= gain;
    ax *= 2; ay *= 2;
  }
  return sum / (norm || 1);
}

/** Ridged multifractal in 0..1. This is the shape that reads as
 *  fracture - cracked tile, crazed plaster, split asphalt - because
 *  its maxima are creases rather than blobs. */
function ridgedP(u, v, fx, fy, octaves = 4, gain = 0.5, salt = 0) {
  let amp = 1, sum = 0, norm = 0;
  let ax = Math.max(1, Math.round(fx));
  let ay = Math.max(1, Math.round(fy));
  for (let i = 0; i < octaves; i += 1) {
    const n = 1 - Math.abs(PN(u * ax, v * ay, ax, ay, salt + i * 7919));
    sum += amp * n * n;
    norm += amp;
    amp *= gain;
    ax *= 2; ay *= 2;
  }
  return sum / (norm || 1);
}

/* ---------------------------------------------------------------
   Fields
   --------------------------------------------------------------- */

function pow2Ceil(n) { let v = 1; while (v < n) v <<= 1; return v; }

/** A scalar layer over the whole tile, materialised once and sampled
 *  wrap-bilinearly so it stays seamless. */
function makeField(res, data) {
  const mask = res - 1;
  return {
    res,
    data,
    at(u, v) {
      const fx = u * res;
      const fy = v * res;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const x0 = ix & mask;
      const y0 = iy & mask;
      const x1 = (ix + 1) & mask;
      const y1 = (iy + 1) & mask;
      const a = data[y0 * res + x0];
      const b = data[y0 * res + x1];
      const c = data[y1 * res + x0];
      const d = data[y1 * res + x1];
      return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
    },
  };
}

/**
 * Field factory bound to one texture's output size.
 *
 * The resolution of a field is chosen from its own top octave: a
 * frequency-4 field carries nothing a 64px grid cannot hold, and
 * generating it at 512 costs 64x more for an identical result. The
 * clamp at `size` is also a Nyquist guard - a field whose top octave
 * exceeds half the output resolution aliases into sparkle, so
 * generators keep their top frequency well under it and take the
 * finest grain from hash01 instead.
 */
function makeFieldKit(size, seed) {
  let salt = (seed * 104729) | 0;
  const nextSalt = () => (salt = (salt + 2654435761) | 0);
  const resFor = (top, scale) => clamp(pow2Ceil(Math.ceil(top * scale)), 32, size);

  function build(fx, fy, octaves, resScale, fn) {
    const s = nextSalt();
    const top = Math.max(fx, fy) * 2 ** (octaves - 1);
    const res = resFor(top, resScale);
    const data = new Float32Array(res * res);
    for (let y = 0; y < res; y += 1) {
      const v = y / res;
      for (let x = 0; x < res; x += 1) data[y * res + x] = fn(x / res, v, s);
    }
    return makeField(res, data);
  }

  return {
    /** Fractal noise in roughly -1..1. */
    fbm(fx, fy = fx, octaves = 4, gain = 0.5, resScale = 4) {
      return build(fx, fy, octaves, resScale, (u, v, s) => fbmP(u, v, fx, fy, octaves, gain, s));
    },
    /** Ridged multifractal in 0..1. */
    ridged(fx, fy = fx, octaves = 4, gain = 0.5, resScale = 5) {
      return build(fx, fy, octaves, resScale, (u, v, s) => ridgedP(u, v, fx, fy, octaves, gain, s));
    },
    /** Domain-warped fbm. Kills the axis-aligned look plain fbm has,
     *  which is what separates a damp patch from a checkerboard. */
    warped(fx, fy = fx, octaves = 4, strength = 0.6, resScale = 5) {
      return build(fx, fy, octaves, resScale, (u, v, s) => {
        const qx = fbmP(u, v, Math.max(2, fx >> 1), Math.max(2, fy >> 1), 2, 0.5, s + 11);
        const qy = fbmP(u, v, Math.max(2, fx >> 1), Math.max(2, fy >> 1), 2, 0.5, s + 23);
        // The warp offset has to stay a whole number of periods or the
        // field stops tiling, hence dividing it back by the frequency.
        return fbmP(u + (strength * qx) / fx, v + (strength * qy) / fy, fx, fy, octaves, 0.5, s);
      });
    },
  };
}

/* ---------------------------------------------------------------
   Height -> normal / AO
   --------------------------------------------------------------- */

function buildHeight(w, h, fn) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const v = y / h;
    for (let x = 0; x < w; x += 1) out[y * w + x] = clamp01(fn(x / w, v, x, y));
  }
  return out;
}

/** Sobel the height field into a tangent-space normal map. */
function normalFromHeight(height, w, h, strength) {
  const out = new Uint8ClampedArray(w * h * 4);
  const wx = (v) => ((v % w) + w) % w;
  const wy = (v) => ((v % h) + h) % h;
  const at = (x, y) => height[wy(y) * w + wx(x)];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);

      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

      let nx = -dx * strength;
      let ny = -dy * strength;
      const len = Math.hypot(nx, ny, 1) || 1;
      nx /= len; ny /= len;

      const i = (y * w + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (1 / len) * 0.5 * 255 + 127.5;
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Cheap ambient occlusion from the height field: compare each texel to
 * two rings around it. Concave texels darken.
 *
 * The generators read this back and shade with it, so grime, damp and
 * efflorescence land where they physically would - in the grout line,
 * in the panel gap, at the foot of a rivet. A generator that cannot
 * see its own occlusion has to fake it with a second noise field that
 * then disagrees with the AO map, and the disagreement reads as dirt
 * floating above the surface.
 */
function aoFromHeight(height, w, h, radius, strength) {
  const out = new Float32Array(w * h);
  const wx = (v) => ((v % w) + w) % w;
  const wy = (v) => ((v % h) + h) % h;
  const at = (x, y) => height[wy(y) * w + wx(x)];
  const offsets = [];
  for (let a = 0; a < 8; a += 1) {
    const angle = (a / 8) * Math.PI * 2;
    offsets.push([Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius), 1.0]);
  }
  for (let a = 0; a < 4; a += 1) {
    const angle = (a / 4) * Math.PI * 2 + 0.4;
    offsets.push([Math.round(Math.cos(angle) * radius * 2.8), Math.round(Math.sin(angle) * radius * 2.8), 0.45]);
  }
  let weight = 0;
  for (const o of offsets) weight += o[2];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const base = at(x, y);
      let occ = 0;
      for (let k = 0; k < offsets.length; k += 1) {
        const o = offsets[k];
        occ += Math.max(0, at(x + o[0], y + o[1]) - base) * o[2];
      }
      out[y * w + x] = clamp01(1 - (occ / weight) * strength * 12);
    }
  }
  return out;
}

/* ---------------------------------------------------------------
   Colour helpers. Authoring stays in sRGB hex per CONTRACT §5; these
   turn a hex into the float triples the shading loop wants without
   re-parsing a string four million times.
   --------------------------------------------------------------- */

function rgbOf(hex) { const c = hexToRgb(hex); return [c.r, c.g, c.b]; }

function mixInto(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

/** Nudge an authored hex around the wheel and in lightness. Used for
 *  per-tile and per-plank jitter, where hand-listing twelve swatches
 *  would be both tedious and worse - the relationships matter more
 *  than the absolute values. */
function jitterHex(hex, hueShift, satScale, lightShift) {
  const c = hexToRgb(hex);
  const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
  const l = (max + min) / 2;
  let s = 0, hh = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === c.r) hh = ((c.g - c.b) / d + (c.g < c.b ? 6 : 0)) / 6;
    else if (max === c.g) hh = ((c.b - c.r) / d + 2) / 6;
    else hh = ((c.r - c.g) / d + 4) / 6;
  }
  const out = hslToRgb(hh + hueShift, clamp01(s * satScale), clamp01(l + lightShift));
  return [out.r, out.g, out.b];
}

/* Shading output slots. One reusable array per synth run rather than
   a fresh literal per texel: at 512 square that is a quarter of a
   million allocations per texture and the GC pause shows up as a
   load-time hitch. */
const O_R = 0, O_G = 1, O_B = 2, O_ROUGH = 3, O_METAL = 4, O_ALPHA = 5;
const O_ER = 6, O_EG = 7, O_EB = 8;

/* ---------------------------------------------------------------
   Generators.

   Each is `(w, h, o) => spec`, where spec supplies:
     height(u, v, x, y)                       -> 0..1
     shade(u, v, height, slope, ao, x, y, out)
   and shade writes albedo/roughness/metalness/alpha/emissive into
   `out`. The driver resets `out` to sane defaults before every call,
   so a generator only writes what it actually cares about.
   --------------------------------------------------------------- */

/* Albedos below are authored as sRGB texel values for physically
   plausible LINEAR reflectance: a light floor tile is about 0.40, mall
   plaster 0.45, concrete 0.25, grass 0.12, asphalt 0.06. sRGB 0xdc
   looks like a believable beige on a monitor but is linear 0.71, which
   is brighter than fresh snow - and a surface authored there has no
   headroom left, so every scuff, accent tile and macro variation
   clips to white the moment a key light lands on it. That was the
   first contact sheet: a floor with plenty of variation in the texture
   and none of it visible in the frame. Brightness is the lighting
   grade's job; these stay dark enough to have somewhere to go. */

const GENERATORS = {

  /**
   * Food-court floor tile. Course 1's dominant surface, so it gets the
   * most attention: everything the player looks at for twenty minutes
   * has to survive being looked at for twenty minutes.
   *
   * What is actually in here, and why each one earns its cost:
   *  - grout is a real recess, not a painted line, so the AO pass digs
   *    it out and the normal map catches a highlight on the bevel;
   *  - per-tile colour jitter plus a scatter of accent tiles in a
   *    second hue. A uniform grid of one colour is the exact thing
   *    that makes a tiled floor read as wallpaper, and SM64's own
   *    floors are full of odd-coloured squares;
   *  - a few cracked tiles, carved from a ridged field masked to the
   *    tile, because a floor with no damage anywhere reads as new and
   *    nothing in this game is new;
   *  - scuff streaks that raise roughness without changing colour
   *    much. Specular variation is what sells a hard floor; an even
   *    gloss across twenty metres is a mirror, not a mall.
   */
  tile(w, h, o) {
    const cols = o.cols ?? 4;
    const groutWidth = o.groutWidth ?? 0.028;
    const base = o.base ?? 0xaea595;
    const accent = o.accent ?? 0x6d8399;
    const groutColor = rgbOf(o.groutColor ?? 0x554c42);
    const accentRate = o.accentRate ?? 0.11;
    const crackRate = o.crackRate ?? 0.07;
    const F = makeFieldKit(Math.max(w, h), o.seed ?? 7);
    const wear = F.warped(3, 3, 4, 0.7);
    const scuff = F.fbm(6, 3, 3, 0.55);
    const crack = F.ridged(cols * 3, cols * 3, 4, 0.55);
    const speckleF = F.fbm(48, 48, 2, 0.5);
    const S = { cell: 0x51, crack: 0xC3, grain: 0x9E, accent: 0x27 };
    const tmp = [0, 0, 0];

    // Tile-local coordinates, shared by the height and shade passes so
    // the crack in the albedo is the crack in the relief.
    const local = (u, v) => {
      const fx = u * cols, fy = v * cols;
      const cx = Math.floor(fx), cy = Math.floor(fy);
      return { cx, cy, lx: fx - cx, ly: fy - cy };
    };
    const edgeDist = (lx, ly) => Math.min(Math.min(lx, 1 - lx), Math.min(ly, 1 - ly));

    return {
      normalStrength: 3.4,
      aoRadius: 3,
      aoStrength: 0.85,
      macroAmount: 0.14,

      height(u, v, x, y) {
        const { cx, cy, lx, ly } = local(u, v);
        const d = edgeDist(lx, ly);
        const face = smoothstep((d - groutWidth) / 0.022);
        const cracked = hash01(cx, cy, S.crack) < crackRate;
        let hgt = 0.16 + face * 0.68;
        // A very slight dome: real tiles are not optically flat and the
        // sheen sliding across them is most of what says "hard floor".
        hgt += face * 0.05 * Math.sin(lx * Math.PI) * Math.sin(ly * Math.PI);
        if (cracked) {
          const c = crack.at(u, v);
          hgt -= face * clamp01((c - 0.80) * 9) * 0.42;
        }
        hgt -= (1 - face) * 0.05 * (hash01(x, y, S.grain) - 0.5);
        return hgt;
      },

      shade(u, v, hgt, slope, ao, x, y, out) {
        const { cx, cy, lx, ly } = local(u, v);
        const d = edgeDist(lx, ly);
        const face = smoothstep((d - groutWidth) / 0.022);

        const isAccent = hash01(cx, cy, S.accent) < accentRate;
        const r1 = hash01(cx, cy, S.cell);
        const r2 = hash01(cx + 91, cy + 17, S.cell);
        const col = jitterHex(isAccent ? accent : base,
          (r1 - 0.5) * 0.035, 0.82 + r2 * 0.5, (r2 - 0.5) * 0.13);

        // Fine mineral fleck inside the tile face. Cheap, and it is the
        // difference between "vinyl" and "stone-look composite".
        const fleck = (hash01(x, y, S.grain) - 0.5) * 0.09
          + speckleF.at(u, v) * 0.05;
        tmp[0] = clamp01(col[0] + fleck);
        tmp[1] = clamp01(col[1] + fleck);
        tmp[2] = clamp01(col[2] + fleck);

        // Grout: darker, dirtier, and dirtier still where the AO pass
        // says it is deepest.
        mixInto(tmp, groutColor, tmp, face);
        const grime = clamp01((1 - ao) * 1.5);
        tmp[0] *= 1 - grime * 0.30;
        tmp[1] *= 1 - grime * 0.32;
        tmp[2] *= 1 - grime * 0.30;

        const worn = clamp01(wear.at(u, v) * 0.9 + 0.5);
        const streak = clamp01(scuff.at(u, v) * 1.4 + 0.5);
        const scuffed = clamp01((streak - 0.52) * 3.4) * face;

        out[O_R] = tmp[0] * (0.90 + worn * 0.18) + scuffed * 0.04;
        out[O_G] = tmp[1] * (0.90 + worn * 0.18) + scuffed * 0.04;
        out[O_B] = tmp[2] * (0.90 + worn * 0.18) + scuffed * 0.04;

        // Polished face, matte grout, and a per-tile gloss lottery so
        // adjacent tiles catch the light differently.
        const gloss = 0.20 + r1 * 0.26;
        out[O_ROUGH] = lerp(0.94, gloss + scuffed * 0.42 + (1 - worn) * 0.08, face);
        out[O_METAL] = 0;
      },
    };
  },

  /**
   * Plush awards-show carpet.
   *
   * Pile is directional, so the fibre field is stretched hard along one
   * axis; matting is where footfall has crushed the pile flat, and
   * crushed pile is BRIGHTER and less rough than standing pile because
   * you are looking at the sides of the fibres rather than down into
   * the gaps between them. Getting that inversion the wrong way round
   * is the classic tell - it makes a carpet look like spilled paint.
   *
   * The weave rides underneath at a much coarser scale and only ever
   * shows in the normal map; you cannot see the backing through the
   * pile, but the light knows it is there.
   */
  carpet(w, h, o) {
    const base = rgbOf(o.base ?? 0x8e1220);
    const root = rgbOf(o.root ?? 0x520b16);
    const sheen = rgbOf(o.sheen ?? 0xb03a4c);
    const F = makeFieldKit(Math.max(w, h), o.seed ?? 21);
    const fibre = F.fbm(12, 72, 2, 0.55, 6);
    const clump = F.fbm(9, 26, 3, 0.55);
    const matting = F.warped(4, 4, 3, 0.75);
    const S = { grain: 0x41, foot: 0x88 };
    const weaveFreq = o.weave ?? 26;
    const tmp = [0, 0, 0];

    // Footprints: a scatter of ovals on a coarse lattice, each one a
    // patch of crushed pile. Cheaper than a real footprint decal and
    // reads identically at the distance the camera actually sits.
    const footAt = (u, v) => {
      const g = 5;
      let best = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const cx = Math.floor(u * g) + ox;
          const cy = Math.floor(v * g) + oy;
          if (hash01(cx, cy, S.foot) > 0.42) continue;
          const px = (cx + hash01(cx, cy, S.foot + 1)) / g;
          const py = (cy + hash01(cx, cy, S.foot + 2)) / g;
          const dx = (u - px) * 2.6;
          const dy = (v - py) * 1.5;
          const d = Math.hypot(dx, dy) * g;
          best = Math.max(best, 1 - clamp01(d));
        }
      }
      return best;
    };

    return {
      // Pile is fibre, not gravel. The first pass gave the per-texel
      // grain a third of the height range and half the tip colour,
      // which at any real viewing distance is below one pixel - so it
      // never resolved as fibre, it just aliased, and the carpet read
      // as red static. The grain is now a whisper and the CLUMPING
      // carries the surface, because clumps are the scale the eye can
      // actually hold on to from across a room.
      normalStrength: 1.3,
      aoRadius: 2,
      aoStrength: 0.65,
      macroAmount: 0.18,

      height(u, v, x, y) {
        const weave = (Math.sin(u * weaveFreq * Math.PI * 2) * Math.sin(v * weaveFreq * Math.PI * 2)) * 0.5 + 0.5;
        const pile = clamp01(fibre.at(u, v) * 1.6 + 0.5);
        const tufts = clamp01(clump.at(u, v) * 1.2 + 0.5);
        const flat = footAt(u, v) * clamp01(matting.at(u, v) * 0.8 + 0.6);
        const grain = hash01(x, y, S.grain);
        return 0.34 + weave * 0.12 + pile * 0.28 * (1 - flat * 0.7)
          + tufts * 0.16 + grain * 0.05 * (1 - flat * 0.6);
      },

      shade(u, v, hgt, slope, ao, x, y, out) {
        const pile = clamp01(fibre.at(u, v) * 1.6 + 0.5);
        const grain = hash01(x, y, S.grain);
        const flat = clamp01(footAt(u, v) * clamp01(matting.at(u, v) * 0.9 + 0.6));

        // Deep in the pile it is dark; the tips catch the room.
        mixInto(tmp, root, base, clamp01(hgt * 1.15 + 0.10));
        const tipLight = clamp01((pile - 0.50) * 1.9) * (0.60 + grain * 0.18);
        mixInto(tmp, tmp, sheen, tipLight * 0.42 + flat * 0.38);

        out[O_R] = tmp[0] * (0.86 + ao * 0.22);
        out[O_G] = tmp[1] * (0.86 + ao * 0.22);
        out[O_B] = tmp[2] * (0.86 + ao * 0.22);
        // Crushed pile takes on a slight sheen; standing pile is dead
        // matte. That contrast is the whole read of the surface.
        out[O_ROUGH] = clamp01(0.98 - flat * 0.30 - tipLight * 0.10);
        out[O_METAL] = 0;
      },
    };
  },

  /**
   * Cast concrete for the basement and the parking deck.
   *
   * Four things layered in the order they happen physically: the pour
   * itself (fine sand matrix), the aggregate the surface has worn down
   * to, the control joints sawn in afterwards, and then the water -
   * damp patches, which darken AND gloss the surface, and the
   * efflorescence that dries out of them, which is the opposite.
   *
   * `terrazzo` swaps the aggregate for large polished chips and drops
   * the roughness. It is the same material physically - stone in a
   * matrix - so it is a flag rather than a second generator, and it
   * gives food-court counter tops for the price of a branch.
   */
  concrete(w, h, o) {
    const terrazzo = !!o.terrazzo;
    const base = rgbOf(o.base ?? (terrazzo ? 0xcfc6bc : 0x8d8a8e));
    const dark = rgbOf(o.dark ?? (terrazzo ? 0x8e857c : 0x5c5a60));
    const chip = rgbOf(o.chip ?? (terrazzo ? 0x4a5560 : 0x6f6a66));
    const chip2 = rgbOf(o.chip2 ?? (terrazzo ? 0xb8474f : 0x9a938a));
    const F = makeFieldKit(Math.max(w, h), o.seed ?? 33);
    const pour = F.warped(3, 3, 4, 0.8);
    const blotch = F.fbm(7, 7, 4, 0.6);
    const damp = F.warped(2, 2, 3, 0.9);
    const crack = F.ridged(9, 9, 4, 0.55);
    const chipF = F.fbm(terrazzo ? 26 : 44, terrazzo ? 26 : 44, 2, 0.5);
    const S = { grain: 0x17, agg: 0x6D };
    const joints = o.joints ?? 2;   // sawn control joints per axis
    const tmp = [0, 0, 0];

    const jointDist = (t) => {
      const p = t * joints;
      const d = Math.abs(p - Math.round(p)) / joints;
      return d;
    };

    return {
      normalStrength: 2.6,
      aoRadius: 3,
      aoStrength: 0.75,
      macroAmount: 0.20,

      height(u, v, x, y) {
        const jd = Math.min(jointDist(u), jointDist(v));
        const joint = 1 - smoothstep(jd / 0.006);
        const agg = clamp01(chipF.at(u, v) * 1.4 + 0.5);
        const exposed = clamp01(pour.at(u, v) * 1.3 + 0.45);
        const cr = clamp01((crack.at(u, v) - 0.86) * 7);
        return clamp01(
          0.58 + agg * (terrazzo ? 0.10 : 0.22) * exposed
          + (hash01(x, y, S.grain) - 0.5) * 0.09
          - joint * 0.5 - cr * 0.30
        );
      },

      shade(u, v, hgt, slope, ao, x, y, out) {
        const exposed = clamp01(pour.at(u, v) * 1.3 + 0.45);
        const agg = clamp01(chipF.at(u, v) * 1.5 + 0.5);
        const hs = hash01(Math.floor(u * (terrazzo ? 26 : 60)), Math.floor(v * (terrazzo ? 26 : 60)), S.agg);

        mixInto(tmp, dark, base, clamp01(blotch.at(u, v) * 0.9 + 0.55));
        // Aggregate only shows where the skin has worn through, which
        // the pour field decides. A speckle applied everywhere reads as
        // noise; a speckle applied in patches reads as concrete.
        const show = clamp01((agg - 0.56) * 4.5) * clamp01((exposed - 0.42) * 3);
        mixInto(tmp, tmp, hs < 0.16 ? chip2 : chip, show * (terrazzo ? 0.92 : 0.55));

        // Damp. Wet concrete is both darker and glossier; the two move
        // together or the surface reads as a stain rather than water.
        const wet = clamp01((damp.at(u, v) - 0.10) * 2.2) * (o.damp ?? (terrazzo ? 0 : 0.85));
        // Efflorescence blooms at the rim of the damp and in the joints,
        // where the water leaves and the salt does not.
        const bloom = clamp01((0.34 - Math.abs(damp.at(u, v) - 0.02) * 3.2)) * (1 - wet)
          * clamp01((1 - ao) * 2.2 + 0.25) * (o.bloom ?? (terrazzo ? 0 : 0.7));

        const grime = clamp01((1 - ao) * 1.4);
        out[O_R] = clamp01(tmp[0] * (1 - wet * 0.42) * (1 - grime * 0.26) + bloom * 0.30);
        out[O_G] = clamp01(tmp[1] * (1 - wet * 0.42) * (1 - grime * 0.27) + bloom * 0.30);
        out[O_B] = clamp01(tmp[2] * (1 - wet * 0.40) * (1 - grime * 0.26) + bloom * 0.32);
        out[O_ROUGH] = clamp01(
          (terrazzo ? 0.32 : 0.90) - wet * 0.55 + bloom * 0.10
          + (hash01(x, y, S.grain) - 0.5) * 0.07 - show * (terrazzo ? 0.10 : 0)
        );
        out[O_METAL] = 0;
      },
    };
  },

  /**
   * Brushed metal panelling: server racks, rooftop HVAC, stage truss.
   *
   * The brushing is a strongly anisotropic field rather than a
   * stretched isotropic one, because the whole point of a brushed
   * finish is that the highlight smears along one axis and stays tight
   * across it.
   *
   * Edge wear FOLLOWS THE SEAMS. Wear that is scattered by noise looks
   * like dirt; wear that hugs the panel edges and the rivet heads looks
   * like something people have been walking past and knocking into for
   * years, which is the only kind of wear anyone reads as wear.
   */
  metalPanel(w, h, o) {
    const painted = !!o.painted;
    const metalCol = rgbOf(o.metal ?? 0xa8adb4);
    const paintCol = rgbOf(o.paint ?? 0x3a4550);
    const rustCol = rgbOf(o.rust ?? 0x6b4326);
    const panelsX = o.panelsX ?? 2;
    const panelsY = o.panelsY ?? 3;
    const rivets = o.rivets ?? 6;
    // Polished chrome is the same brushed machine with the fabrication
    // switched off. A seam at the tile border would repeat across a
    // bumper at exactly the texture period, which is the one place a
    // mirror surface cannot hide it.
    const seams = o.seams !== false;
    const F = makeFieldKit(Math.max(w, h), o.seed ?? 55);
    const brush = F.fbm(160, 6, 2, 0.5, 3);
    const blotch = F.warped(4, 4, 3, 0.8);
    const chipF = F.ridged(14, 14, 3, 0.55);
    const S = { grain: 0x2B, rivet: 0x74 };
    const tmp = [0, 0, 0];

    const panel = (u, v) => {
      const fx = u * panelsX, fy = v * panelsY;
      const lx = fx - Math.floor(fx), ly = fy - Math.floor(fy);
      const d = Math.min(Math.min(lx, 1 - lx) / panelsX, Math.min(ly, 1 - ly) / panelsY);
      return { lx, ly, d };
    };

    // Rivet heads march along the top and bottom edge of every panel.
    const rivetAt = (u, v) => {
      if (!seams || rivets <= 0) return 0;
      const fy = v * panelsY;
      const ly = fy - Math.floor(fy);
      const edge = Math.min(ly, 1 - ly);
      const ry = 0.045;
      if (edge > ry * 2.2) return 0;
      const fx = u * rivets;
      const lx = fx - Math.floor(fx) - 0.5;
      const dx = lx / rivets;
      const dy = (edge - ry) / panelsY;
      const d = Math.hypot(dx, dy * 1.0) * 90;
      return clamp01(1 - d);
    };

    return {
      normalStrength: 3.0,
      aoRadius: 3,
      aoStrength: 0.9,
      macroAmount: 0.10,

      height(u, v, x, y) {
        const p = panel(u, v);
        const seam = seams ? 1 - smoothstep((p.d - 0.004) / 0.006) : 0;
        const riv = rivetAt(u, v);
        const dome = Math.sqrt(Math.max(0, 1 - (1 - riv) * (1 - riv)));
        return clamp01(
          0.62 - seam * 0.52 + dome * 0.30
          + brush.at(u, v) * 0.045 + (hash01(x, y, S.grain) - 0.5) * 0.05
        );
      },

      shade(u, v, hgt, slope, ao, x, y, out) {
        const p = panel(u, v);
        const seam = seams ? 1 - smoothstep((p.d - 0.004) / 0.006) : 0;
        const riv = rivetAt(u, v);
        // Proximity to a hard edge, which is where paint leaves and
        // steel polishes itself against passing shoulders.
        const nearEdge = seams
          ? clamp01(1 - p.d / 0.05) * clamp01(blotch.at(u, v) * 1.4 + 0.7)
          : 0;
        const wear = clamp01(nearEdge * 0.9 + riv * 0.6 + clamp01((chipF.at(u, v) - 0.88) * 8) * 0.7);

        const streak = brush.at(u, v);
        const bright = 0.86 + streak * 0.30 + (hash01(x, y, S.grain) - 0.5) * 0.08;

        if (painted) {
          mixInto(tmp, paintCol, metalCol, wear);
          // Rust only where paint has gone AND water can sit, i.e. in
          // the occluded seam, not on the exposed face.
          const rust = clamp01((1 - ao) * 1.6) * wear * (o.rust === null ? 0 : 0.75);
          mixInto(tmp, tmp, rustCol, rust * 0.8);
          out[O_METAL] = lerp(0.06, 0.92, wear) * (1 - rust * 0.8);
          out[O_ROUGH] = clamp01(lerp(0.46, 0.30, wear) + rust * 0.5 + seam * 0.2);
        } else {
          mixInto(tmp, metalCol, metalCol, 0);
          out[O_METAL] = 0.93;
          // Brushed anisotropy is faked in the roughness map: tight
          // across the grain, loose along it. A single roughness value
          // gives the round highlight of cast metal, which is exactly
          // what a server rack does not have.
          out[O_ROUGH] = clamp01(0.42 + streak * 0.26 - wear * 0.16 + seam * 0.22);
        }

        const grime = clamp01((1 - ao) * 1.5);
        out[O_R] = clamp01(tmp[0] * bright * (1 - grime * 0.35));
        out[O_G] = clamp01(tmp[1] * bright * (1 - grime * 0.36));
        out[O_B] = clamp01(tmp[2] * bright * (1 - grime * 0.34));
      },
    };
  },

  /**
   * Stucco / plaster for mall walls and the hub.
   *
   * The character of render is not its bumps - it is a smooth trowelled
   * skin - it is where the skin has failed. So the relief is low and
   * the interest comes from chips that expose a darker undercoat, plus
   * long trowel arcs that only show as a sheen.
   */
  stucco(w, h, o) {
    const base = rgbOf(o.base ?? 0xbdb0a0);
    const under = rgbOf(o.under ?? 0x847868);
    const stain = rgbOf(o.stain ?? 0x8e8271);
    const F = makeFieldKit(Math.max(w, h), o.seed ?? 63);
    const peel = F.fbm(34, 34, 3, 0.55);
    const trowel = F.warped(5, 3, 3, 1.0);
    const chips = F.ridged(11, 11, 4, 0.5);
    const dirt = F.warped(3, 4, 3, 0.7);
    const S = { grain: 0x5A };

    return {
      normalStrength: 1.7,
      aoRadius: 2,
      aoStrength: 0.6,
      macroAmount: 0.16,

      height(u, v, x, y) {
        const chip = clamp01((chips.at(u, v) - 0.87) * 8);
        return clamp01(
          0.70 + peel.at(u, v) * 0.09 + trowel.at(u, v) * 0.05
          + (hash01(x, y, S.grain) - 0.5) * 0.05 - chip * 0.45
        );
      },

      shade(u, v, hgt, slope, ao, x, y, out) {
        const chip = clamp01((chips.at(u, v) - 0.87) * 8);
        const grime = clamp01((1 - ao) * 1.5);
        // Vertical dirt runs: rain and condensation move DOWN a wall,
        // so the streak field is stretched in v, not isotropic.
        const run = clamp01(dirt.at(u, v) * 1.2 + 0.5);
        const tone = 0.92 + peel.at(u, v) * 0.13 + (hash01(x, y, S.grain) - 0.5) * 0.05;

        const tmp = [0, 0, 0];
        mixInto(tmp, base, stain, clamp01((run - 0.55) * 1.8) * 0.7);
        mixInto(tmp, tmp, under, chip);
        out[O_R] = clamp01(tmp[0] * tone * (1 - grime * 0.22));
        out[O_G] = clamp01(tmp[1] * tone * (1 - grime * 0.23));
        out[O_B] = clamp01(tmp[2] * tone * (1 - grime * 0.21));
        out[O_ROUGH] = clamp01(0.88 - trowel.at(u, v) * 0.12 + chip * 0.08);
        out[O_METAL] = 0;
      },
    };
  },

  /** Car-park and service-road asphalt. Aggregate held in tar, with
   *  the tar polished off the high points by traffic and cracks that
   *  open along the direction of the roll. */
  asphalt(w, h, o) {
    const tar = rgbOf(o.tar ?? 0x24222a);
    const stone = rgbOf(o.stone ?? 0x6a6670);
    const paint = rgbOf(o.paint ?? 0xd8c34a);
    const F = makeFieldKit(Math.max(w, h), o.seed ?? 71);
    const agg = F.fbm(56, 56, 2, 0.5);
    const patch = F.warped(3, 3, 3, 0.85);
    const crack = F.ridged(7, 5, 4, 0.55);
    const S = { grain: 0x39, chip: 0x8C };
    const line = o.line ?? 0;   // 0 = none, otherwise fraction of v
    const tmp = [0, 0, 0];

    return {
      normalStrength: 2.8,
      aoRadius: 2,
      aoStrength: 0.8,
      macroAmount: 0.22,

      height(u, v, x, y) {
        const a = clamp01(agg.at(u, v) * 1.5 + 0.5);
        const cr = clamp01((crack.at(u, v) - 0.83) * 8);
        return clamp01(0.60 + a * 0.24 + (hash01(x, y, S.grain) - 0.5) * 0.16 - cr * 0.42);
      },

      shade(u, v, hgt, slope, ao, x, y, out) {
        const a = clamp01(agg.at(u, v) * 1.6 + 0.5);
        const worn = clamp01(patch.at(u, v) * 1.2 + 0.5);
        const exposed = clamp01((a - 0.50) * 3.2) * clamp01((worn - 0.35) * 2.4);
        const flake = hash01(x, y, S.chip);

        mixInto(tmp, tar, stone, exposed * (0.55 + flake * 0.5));
        const grime = clamp01((1 - ao) * 1.3);
        let rough = clamp01(0.93 - exposed * 0.22 + (flake - 0.5) * 0.10);

        if (line > 0) {
          const d = Math.abs(v - line);
          const on = 1 - smoothstep((d - 0.012) / 0.004);
          // Road paint is chipped by the aggregate under it, so the
          // wear mask is the aggregate mask, not a fresh noise.
          const kept = on * clamp01(1 - exposed * 1.1);
          mixInto(tmp, tmp, paint, kept);
          rough = lerp(rough, 0.62, kept);
        }

        out[O_R] = clamp01(tmp[0] * (1 - grime * 0.20));
        out[O_G] = clamp01(tmp[1] * (1 - grime * 0.20));
        out[O_B] = clamp01(tmp[2] * (1 - grime * 0.18));
        out[O_ROUGH] = rough;
        out[O_METAL] = 0;
      },
    };
  },

  /**
   * Architectural glass.
   *
   * Almost all of the read is in the roughness and the normal: a pane
   * with a perfectly uniform roughness is a mirror and reads as
   * chrome. Real glass carries roll waviness from the float line
   * (very low frequency, very low amplitude - but it is what bends a
   * reflected skyline), smudges at hand height, and dirt in the
   * corners where the squeegee never reaches.
   */
  glass(w, h, o) {
    const tint = rgbOf(o.tint ?? 0xbfd6dd);
    const F = makeFieldKit(Math.max(w, h), o.seed ?? 83);
    const wave = F.fbm(3, 2, 2, 0.5);
    const smudge = F.warped(6, 5, 3, 0.9);
    const dust = F.fbm(20, 20, 3, 0.55);
    const S = { grain: 0x4F };

    return {
      normalStrength: 0.7,
      aoRadius: 2,
      aoStrength: 0.25,
      macroAmount: 0.05,

      height(u, v) {
        return clamp01(0.5 + wave.at(u, v) * 0.5 + smudge.at(u, v) * 0.06);
      },

      shade(u, v, hgt, slope, ao, x, y, out) {
        const sm = clamp01((smudge.at(u, v) - 0.05) * 2.2);
        const grit = clamp01(dust.at(u, v) * 1.3 + 0.4);
        // Corners collect grime; the distance-to-edge term is what
        // makes a window read as a window rather than as a hole.
        const edge = 1 - smoothstep(Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v)) / 0.07);
        const dirty = clamp01(sm * 0.55 + edge * grit * 0.9);

        out[O_R] = clamp01(tint[0] * (0.94 + dirty * 0.30));
        out[O_G] = clamp01(tint[1] * (0.94 + dirty * 0.28));
        out[O_B] = clamp01(tint[2] * (0.94 + dirty * 0.24));
        out[O_ROUGH] = clamp01(0.03 + dirty * 0.30 + (hash01(x, y, S.grain) - 0.5) * 0.02);
        out[O_METAL] = 0;
        out[O_ALPHA] = clamp01((o.opacity ?? 0.22) + dirty * 0.35);
      },
    };
  },

  /**
   * Velvet rope and its gold-braid variant, for the red carpet.
   *
   * The rope runs along U and the strands wrap around V, so the twist
   * is a shear of the two: `fract(v * strands + u * twist)`. Everything
   * else - the sheen, the AO between strands, the fuzz - falls out of
   * that one term, which is why the shape is worth getting right
   * rather than approximating with a sine.
   */
  velvetRope(w, h, o) {
    const gold = !!o.gold;
    const base = rgbOf(o.base ?? (gold ? 0xb08a2e : 0x7a0f1c));
    const tip = rgbOf(o.tip ?? (gold ? 0xf2dd8c : 0xc2405a));
    const deep = rgbOf(o.deep ?? (gold ? 0x50390d : 0x2c0409));
    const strands = o.strands ?? 6;
    const twist = o.twist ?? 3;
    const F = makeFieldKit(Math.max(w, h), o.seed ?? 97);
    const fuzz = F.fbm(90, 24, 2, 0.5, 3);
    const S = { grain: 0x66 };
    const tmp = [0, 0, 0];

    const strand = (u, v) => {
      const q = (v * strands + u * twist) % 1;
      const qq = q < 0 ? q + 1 : q;
      return Math.sin(qq * Math.PI);   // 0 at the groove, 1 at the crown
    };

    return {
      normalStrength: 3.2,
      aoRadius: 3,
      aoStrength: 0.95,
      macroAmount: 0.08,

      height(u, v, x, y) {
        const s = strand(u, v);
        return clamp01(0.25 + s * s * 0.62 + fuzz.at(u, v) * 0.08 + (hash01(x, y, S.grain) - 0.5) * 0.06);
      },

      shade(u, v, hgt, slope, ao, x, y, out) {
        const s = strand(u, v);
        const crown = clamp01((s - 0.35) * 1.9);
        mixInto(tmp, deep, base, clamp01(s * 1.4));
        mixInto(tmp, tmp, tip, crown * (gold ? 0.75 : 0.45) * (0.6 + fuzz.at(u, v) * 0.6));
        out[O_R] = clamp01(tmp[0] * (0.82 + ao * 0.26));
        out[O_G] = clamp01(tmp[1] * (0.82 + ao * 0.26));
        out[O_B] = clamp01(tmp[2] * (0.82 + ao * 0.26));
        out[O_ROUGH] = gold
          ? clamp01(0.34 - crown * 0.14 + (1 - ao) * 0.25)
          : clamp01(0.96 - crown * 0.12);
        out[O_METAL] = gold ? clamp01(0.75 + crown * 0.2) : 0;
      },
    };
  },

  /**
   * Stage decking. Planks along U with per-plank tone and a random
   * butt-joint offset per row, growth rings from a warped field, and
   * screw heads at the plank ends.
   *
   * `painted` gives the matte-black touring deck, which is the same
   * timber with a scuffed paint film over it - so the scuffs are keyed
   * to the plank edges and the screw heads, where boots actually land.
   */
  woodStage(w, h, o) {
    const painted = !!o.painted;
    const light = rgbOf(o.light ?? 0xb08249);
    const dark = rgbOf(o.dark ?? 0x6b4823);
    const paint = rgbOf(o.paint ?? 0x16161a);
    const rows = o.rows ?? 6;
    const F = makeFieldKit(Math.max(w, h), o.seed ?? 109);
    const grain = F.warped(4, 60, 3, 0.9, 4);
    const fibre = F.fbm(8, 120, 2, 0.5, 3);
    const wearF = F.warped(3, 3, 3, 0.8);
    const S = { plank: 0x1D, grain: 0x2E, screw: 0x99 };
    const tmp = [0, 0, 0];

    const plankOf = (u, v) => {
      const fy = v * rows;
      const py = Math.floor(fy);
      const ly = fy - py;
      // Every row is shifted along its own length so the butt joints do
      // not line up into a visible column, which is the single thing
      // that makes plank flooring look like a texture.
      const shift = hash01(py, 0, S.plank);
      const fx = (u + shift) * 3;
      const px = Math.floor(fx);
      const lx = fx - px;
      return { px, py, lx, ly };
    };

    return {
      normalStrength: 2.4,
      aoRadius: 3,
      aoStrength: 0.85,
      macroAmount: 0.16,

      height(u, v, x, y) {
        const p = plankOf(u, v);
        const gapY = 1 - smoothstep((Math.min(p.ly, 1 - p.ly) - 0.008) / 0.012);
        const gapX = 1 - smoothstep((Math.min(p.lx, 1 - p.lx) - 0.004) / 0.008);
        const gap = Math.max(gapY, gapX);
        const g = grain.at(u, v);
        const ring = Math.abs(Math.sin(g * 9.0)) * 0.10;
        // Screw heads sit a short way in from each butt joint.
        const sd = Math.hypot((p.lx - 0.06) * 3, (p.ly - 0.5) / rows * 3) * 26;
        const screw = clamp01(1 - sd);
        return clamp01(
          0.72 + ring + fibre.at(u, v) * 0.06 + (hash01(x, y, S.grain) - 0.5) * 0.05
          - gap * 0.6 - screw * 0.35
        );
      },

      shade(u, v, hgt, slope, ao, x, y, out) {
        const p = plankOf(u, v);
        const tone = hash01(p.px, p.py, S.plank);
        const g = grain.at(u, v);
        const ring = clamp01(Math.abs(Math.sin(g * 9.0)) * 1.2);
        const wear = clamp01(wearF.at(u, v) * 1.3 + 0.5);
        const grime = clamp01((1 - ao) * 1.5);

        mixInto(tmp, dark, light, clamp01(0.30 + tone * 0.55 - ring * 0.45 + fibre.at(u, v) * 0.4));

        if (painted) {
          // Paint survives in the middle of a board and fails at every
          // edge and fixing; that pattern is the whole look of a deck.
          const bare = clamp01(grime * 1.4 + clamp01((wear - 0.62) * 3.5)) * 0.85;
          mixInto(tmp, paint, tmp, bare);
          out[O_ROUGH] = clamp01(0.72 - (1 - bare) * 0.22 + bare * 0.2);
        } else {
          out[O_ROUGH] = clamp01(0.78 - wear * 0.16 + ring * 0.10);
        }

        out[O_R] = clamp01(tmp[0] * (0.86 + ao * 0.20));
        out[O_G] = clamp01(tmp[1] * (0.86 + ao * 0.20));
        out[O_B] = clamp01(tmp[2] * (0.86 + ao * 0.20));
        out[O_METAL] = 0;
      },
    };
  },

  /**
   * Lawn seen from above, for the hub and the rooftop planters.
   *
   * Clumps first, blades second. A grass texture built only from
   * high-frequency blade noise reads as green static; the clumping is
   * what gives it a scale the eye can hold on to at running speed.
   */
  grass(w, h, o) {
    const blade = rgbOf(o.blade ?? 0x4e8a34);
    const dry = rgbOf(o.dry ?? 0x93a24a);
    const deep = rgbOf(o.deep ?? 0x1f4021);
    const soil = rgbOf(o.soil ?? 0x4a3a26);
    const F = makeFieldKit(Math.max(w, h), o.seed ?? 127);
    const clump = F.fbm(10, 10, 3, 0.55);
    const bladeF = F.fbm(48, 96, 2, 0.5, 3);
    const patch = F.warped(3, 3, 3, 0.85);
    const S = { grain: 0x7A, flower: 0xB1 };
    const tmp = [0, 0, 0];

    return {
      normalStrength: 2.2,
      aoRadius: 2,
      aoStrength: 0.9,
      macroAmount: 0.20,

      height(u, v, x, y) {
        return clamp01(
          0.45 + clamp01(clump.at(u, v) * 1.3 + 0.5) * 0.32
          + clamp01(bladeF.at(u, v) * 1.4 + 0.5) * 0.18
          + (hash01(x, y, S.grain) - 0.5) * 0.14
        );
      },

      shade(u, v, hgt, slope, ao, x, y, out) {
        const cl = clamp01(clump.at(u, v) * 1.4 + 0.5);
        const bl = clamp01(bladeF.at(u, v) * 1.5 + 0.5);
        const bare = clamp01((patch.at(u, v) - 0.22) * 2.6);
        mixInto(tmp, deep, blade, clamp01(hgt * 1.3 - 0.15));
        mixInto(tmp, tmp, dry, clamp01((cl - 0.55) * 2.0) * 0.55 + bl * 0.12);
        mixInto(tmp, tmp, soil, bare * 0.8);

        // A sparse fleck of clover flower. Two texels each; entirely
        // invisible until the camera drops low, and then it is the
        // reason the lawn does not look like a shader.
        const fl = hash01(x, y, S.flower) < 0.0012 && bare < 0.3 ? 1 : 0;

        out[O_R] = clamp01(tmp[0] * (0.82 + ao * 0.28) + fl * 0.65);
        out[O_G] = clamp01(tmp[1] * (0.82 + ao * 0.28) + fl * 0.62);
        out[O_B] = clamp01(tmp[2] * (0.82 + ao * 0.28) + fl * 0.55);
        out[O_ROUGH] = clamp01(0.92 - bl * 0.10 + bare * 0.06);
        out[O_METAL] = 0;
      },
    };
  },

  /**
   * Pool / fountain water.
   *
   * The albedo is nearly flat on purpose - water has no meaningful
   * diffuse colour at this scale, and painting caustics into it locks
   * the light in place the instant anything moves. All the life is in
   * the normal map, and the flow map that ships with it lets whoever
   * animates the surface scroll two ripple layers against each other
   * without the shear tearing.
   */
  water(w, h, o) {
    const shallow = rgbOf(o.shallow ?? 0x3ba6c4);
    const deepC = rgbOf(o.deep ?? 0x114a6b);
    const F = makeFieldKit(Math.max(w, h), o.seed ?? 137);
    const ripple = F.fbm(9, 9, 4, 0.55);
    const chop = F.fbm(23, 19, 3, 0.5);
    const depth = F.warped(3, 3, 3, 0.8);
    const tmp = [0, 0, 0];

    return {
      normalStrength: 1.4,
      aoRadius: 2,
      aoStrength: 0.2,
      macroAmount: 0.06,
      flow: { field: depth, scale: 0.35 },

      height(u, v) {
        return clamp01(0.5 + ripple.at(u, v) * 0.34 + chop.at(u, v) * 0.16);
      },

      shade(u, v, hgt, slope, ao, x, y, out) {
        const d = clamp01(depth.at(u, v) * 1.2 + 0.5);
        mixInto(tmp, deepC, shallow, d);
        // A whisper of foam on the steepest ripple faces, which is what
        // stops still water from reading as coloured glass.
        const foam = clamp01((slope * 26) - 0.55) * 0.35;
        out[O_R] = clamp01(tmp[0] + foam);
        out[O_G] = clamp01(tmp[1] + foam);
        out[O_B] = clamp01(tmp[2] + foam);
        out[O_ROUGH] = clamp01(0.06 + foam * 0.7);
        out[O_METAL] = 0;
        out[O_ALPHA] = clamp01((o.opacity ?? 0.78) + foam);
      },
    };
  },

  /**
   * Metallic foil, for record sleeves and for the Platinum Record
   * itself. Three modes off one machine, because they are physically
   * the same thing - a mirror surface with relief in it:
   *
   *   sleeve   crinkled foil stamping over a printed card
   *   vinyl    black record: concentric grooves plus a paper label
   *   platinum the collectible: the same grooves in mirror metal
   *
   * The grooves are drawn from the radius rather than from noise
   * because they must be perfectly concentric; a record whose grooves
   * wobble reads as a novelty coaster.
   */
  foil(w, h, o) {
    const mode = o.mode ?? "sleeve";
    const F = makeFieldKit(Math.max(w, h), o.seed ?? 149);
    const crease = F.ridged(8, 8, 4, 0.55);
    const wrinkle = F.warped(14, 14, 3, 0.9);
    const print = F.warped(4, 4, 3, 0.8);
    const S = { grain: 0xA7 };
    const tmp = [0, 0, 0];

    const foilCol = rgbOf(o.foil ?? 0xd8d2c6);
    const cardCol = rgbOf(o.card ?? 0x2a2130);
    const inkCol = rgbOf(o.ink ?? 0xe0357c);
    const labelCol = rgbOf(o.label ?? 0xd8b23a);
    const platinum = mode === "platinum";
    const disc = platinum || mode === "vinyl";
    /* Groove pitch, in radians across the disc radius. A real record
       has far more grooves than this; drawing them at their true pitch
       puts the pattern at roughly two texels per cycle, which is the
       Nyquist limit, and the top mip crawls with moire whenever the
       record spins. This is the densest pitch that still resolves. */
    const GROOVE = o.groove ?? 300;

    const radial = (u, v) => {
      const dx = u - 0.5, dy = v - 0.5;
      return { r: Math.hypot(dx, dy) * 2, a: Math.atan2(dy, dx) };
    };

    return {
      normalStrength: disc ? 1.6 : 3.0,
      aoRadius: 2,
      aoStrength: disc ? 0.4 : 0.8,
      macroAmount: disc ? 0.04 : 0.12,

      height(u, v, x, y) {
        if (disc) {
          const { r } = radial(u, v);
          const inLand = clamp01((r - 0.30) * 14) * (1 - clamp01((r - 0.96) * 24));
          const groove = (Math.sin(r * GROOVE) * 0.5 + 0.5) * inLand;
          return clamp01(0.72 + groove * 0.16 + (hash01(x, y, S.grain) - 0.5) * 0.02);
        }
        const c = clamp01((crease.at(u, v) - 0.55) * 2.4);
        return clamp01(0.55 + c * 0.34 + wrinkle.at(u, v) * 0.12 + (hash01(x, y, S.grain) - 0.5) * 0.04);
      },

      shade(u, v, hgt, slope, ao, x, y, out) {
        if (disc) {
          const { r } = radial(u, v);
          const label = 1 - smoothstep((r - 0.26) / 0.03);
          const spindle = 1 - smoothstep((r - 0.024) / 0.008);
          const outside = smoothstep((r - 0.985) / 0.02);
          const groove = Math.sin(r * GROOVE) * 0.5 + 0.5;

          if (platinum) {
            // Mirror metal with the groove modulating roughness only.
            // Modulating albedo instead makes it look like a painted
            // spiral, which is what happens if you shade a record the
            // way you shade a tile.
            mixInto(tmp, [0.82, 0.84, 0.88], [0.96, 0.95, 0.92], groove);
            mixInto(tmp, tmp, rgbOf(0xf0c65a), label * 0.9);
            out[O_METAL] = 1 - label * 0.55;
            out[O_ROUGH] = clamp01(0.10 + groove * 0.10 + label * 0.55);
          } else {
            mixInto(tmp, [0.035, 0.033, 0.04], [0.10, 0.098, 0.11], groove);
            mixInto(tmp, tmp, labelCol, label);
            out[O_METAL] = 0.05;
            out[O_ROUGH] = clamp01(0.24 + groove * 0.12 + label * 0.55);
          }
          mixInto(tmp, tmp, [0.02, 0.02, 0.025], spindle);
          out[O_R] = tmp[0]; out[O_G] = tmp[1]; out[O_B] = tmp[2];
          out[O_ALPHA] = 1 - outside;
          return;
        }

        const c = clamp01((crease.at(u, v) - 0.55) * 2.4);
        const stamped = clamp01(print.at(u, v) * 1.6 + 0.45);
        const foiled = clamp01((stamped - 0.5) * 3.0);
        mixInto(tmp, cardCol, inkCol, clamp01((stamped - 0.30) * 2.2) * 0.7);
        mixInto(tmp, tmp, foilCol, foiled);
        // Fake iridescence: the crease slope shifts the hue, which is
        // what the eye actually reads off a stamped foil. A flat metal
        // tint reads as grey plastic under this game's lighting.
        const shift = (slope * 8 - 0.2);
        out[O_R] = clamp01(tmp[0] * (1 + shift * 0.25) * (0.82 + ao * 0.3));
        out[O_G] = clamp01(tmp[1] * (1 - shift * 0.10) * (0.82 + ao * 0.3));
        out[O_B] = clamp01(tmp[2] * (1 + shift * 0.35) * (0.82 + ao * 0.3));
        out[O_METAL] = foiled * 0.92;
        out[O_ROUGH] = clamp01(lerp(0.72, 0.20, foiled) + c * 0.14);
      },
    };
  },

  /**
   * LED video wall.
   *
   * Three separate periodicities have to be right or it reads as a
   * printed poster: the RGB subpixel triad (invisible individually,
   * responsible for the colour fringing), the pixel grid with its dark
   * mask between pixels, and the seams between the physical cabinets.
   * A dead pixel every few thousand does more for the illusion than
   * any of them.
   *
   * The panel is an emitter, so nearly all of its brightness rides in
   * the emissive map; the albedo stays dark, which is what the wall
   * genuinely looks like with the power off and what keeps it from
   * washing out under the stage lights.
   */
  screenPanel(w, h, o) {
    const pixels = o.pixels ?? 64;
    const cabinets = o.cabinets ?? 2;
    const content = o.content ?? "bars";
    const F = makeFieldKit(Math.max(w, h), o.seed ?? 151);
    const wash = F.fbm(5, 5, 3, 0.6);
    const S = { dead: 0xD2, jit: 0x3C };
    const hot = rgbOf(o.hot ?? 0xff3ea5);
    const cool = rgbOf(o.cool ?? 0x2ce8ff);

    // What the wall is showing. Deliberately abstract: readable text on
    // a video wall dates a screenshot instantly and reads as UI.
    const signal = (u, v) => {
      if (content === "waveform") {
        const bandN = 18;
        const b = Math.floor(u * bandN);
        const amp = 0.25 + hash01(b, 0, 0x11) * 0.7;
        return v > 1 - amp ? clamp01((v - (1 - amp)) / amp) : 0;
      }
      if (content === "grid") {
        const gx = Math.abs(((u * 8) % 1) - 0.5), gy = Math.abs(((v * 8) % 1) - 0.5);
        return clamp01(1 - Math.min(gx, gy) * 8);
      }
      const bars = 7;
      const b = Math.floor(v * bars);
      const phase = hash01(b, 3, 0x55);
      const width = 0.25 + phase * 0.55;
      const q = (u + phase) % 1;
      return q < width ? 1 : 0.06;
    };

    return {
      normalStrength: 1.2,
      aoRadius: 2,
      aoStrength: 0.5,
      macroAmount: 0.04,
      emissive: true,

      height(u, v) {
        const px = Math.abs(((u * pixels) % 1) - 0.5) * 2;
        const py = Math.abs(((v * pixels) % 1) - 0.5) * 2;
        const mask = clamp01(1 - Math.max(px, py) * 1.35);
        const cx = Math.abs(((u * cabinets) % 1) - 0.5) * 2;
        const cy = Math.abs(((v * cabinets) % 1) - 0.5) * 2;
        const seam = clamp01((Math.max(cx, cy) - 0.985) * 90);
        return clamp01(0.55 + mask * 0.35 - seam * 0.5);
      },

      shade(u, v, hgt, slope, ao, x, y, out) {
        const pxi = Math.floor(u * pixels);
        const pyi = Math.floor(v * pixels);
        const lx = u * pixels - pxi;
        const ly = v * pixels - pyi;
        const inPixel = clamp01(1 - Math.max(Math.abs(lx - 0.5), Math.abs(ly - 0.5)) * 2.35);

        // Subpixel triad: thirds of the pixel emit R, G and B.
        const third = Math.min(2, Math.floor(lx * 3));
        const dead = hash01(pxi, pyi, S.dead) < 0.0009 ? 0 : 1;
        const jit = 0.86 + hash01(pxi, pyi, S.jit) * 0.28;
        // Scanline: alternate rows sit slightly dimmer, which is the
        // cue that reads as "screen" from across a room.
        const scan = pyi % 2 === 0 ? 1 : 0.78;

        const sig = signal(u, v);
        const mixCol = clamp01(wash.at(u, v) * 0.9 + 0.5);
        const cr = lerp(hot[0], cool[0], mixCol);
        const cg = lerp(hot[1], cool[1], mixCol);
        const cb = lerp(hot[2], cool[2], mixCol);

        // Subpixel weighting has to average to 1.0 across the three
        // thirds or the panel takes on a colour cast: at 1.6/0.55 the
        // boosted channel clipped while the other two did not, and a
        // pink-and-cyan wall came out green. This pair sums to 2.94/3,
        // so the mip chain converges on the colour that was authored.
        const gain = sig * inPixel * dead * jit * scan;
        out[O_ER] = cr * gain * (third === 0 ? 1.30 : 0.82);
        out[O_EG] = cg * gain * (third === 1 ? 1.30 : 0.82);
        out[O_EB] = cb * gain * (third === 2 ? 1.30 : 0.82);

        // Powered-down albedo: near-black glass over a dark mask.
        const body = 0.035 + inPixel * 0.05;
        out[O_R] = body; out[O_G] = body; out[O_B] = body + 0.008;
        out[O_ROUGH] = clamp01(0.34 - inPixel * 0.16);
        out[O_METAL] = 0.15;
      },
    };
  },

  /**
   * Injection-moulded plastic: food-court seating, tray stacks, cable
   * jacketing. Orange-peel micro relief, a mould parting line, and
   * scratches that only show as a roughness change. Plastic that is
   * uniformly glossy reads as a Blinn sphere from 1998.
   */
  plastic(w, h, o) {
    const base = rgbOf(o.base ?? 0xe0603a);
    const F = makeFieldKit(Math.max(w, h), o.seed ?? 163);
    const peel = F.fbm(38, 38, 2, 0.5);
    const scratch = F.fbm(120, 9, 2, 0.5, 3);
    const dust = F.warped(4, 4, 3, 0.8);
    const S = { grain: 0x93 };
    const seamAt = o.seam ?? 0.5;
    const tmp = [0, 0, 0];

    return {
      normalStrength: 1.5,
      aoRadius: 2,
      aoStrength: 0.5,
      macroAmount: 0.10,

      height(u, v, x, y) {
        const seam = 1 - smoothstep((Math.abs(v - seamAt) - 0.003) / 0.004);
        return clamp01(0.68 + peel.at(u, v) * 0.10 + (hash01(x, y, S.grain) - 0.5) * 0.03 + seam * 0.14);
      },

      shade(u, v, hgt, slope, ao, x, y, out) {
        const sc = clamp01(Math.abs(scratch.at(u, v)) * 2.4 - 1.1);
        const grubby = clamp01((1 - ao) * 1.4 + clamp01(dust.at(u, v) * 1.2 + 0.4) * 0.25);
        mixInto(tmp, base, [0.82, 0.82, 0.84], sc * 0.35);
        out[O_R] = clamp01(tmp[0] * (1 - grubby * 0.18));
        out[O_G] = clamp01(tmp[1] * (1 - grubby * 0.19));
        out[O_B] = clamp01(tmp[2] * (1 - grubby * 0.17));
        out[O_ROUGH] = clamp01((o.gloss ?? 0.34) + sc * 0.34 + grubby * 0.16 + peel.at(u, v) * 0.10);
        out[O_METAL] = 0;
      },
    };
  },

  /**
   * The world-space breakup layer.
   *
   * Not a surface. materials.js multiplies this over every tiled level
   * surface at a ~40 m period, in world space, so a floor that repeats
   * its texture every 2 m never repeats its APPEARANCE. This is the
   * single highest-value texture in the file for the money it costs:
   * one extra sample, and the "obvious tiling" note disappears from
   * every review.
   *
   * Kept low contrast on purpose. Anything stronger reads as blotchy
   * lighting rather than as material variation.
   */
  macro(w, h, o) {
    const F = makeFieldKit(Math.max(w, h), o.seed ?? 3);
    const broad = F.warped(2, 2, 3, 0.9);
    const mid = F.fbm(5, 5, 3, 0.55);
    const fine = F.fbm(13, 13, 2, 0.5);
    return {
      normalStrength: 0.1,
      aoRadius: 2,
      aoStrength: 0.0,
      macroAmount: 0,
      height() { return 0.5; },
      shade(u, v, hgt, slope, ao, x, y, out) {
        const value = clamp01(
          0.5 + broad.at(u, v) * 0.34 + mid.at(u, v) * 0.16 + fine.at(u, v) * 0.07
        );
        out[O_R] = value; out[O_G] = value; out[O_B] = value;
        out[O_ROUGH] = value;
        out[O_METAL] = 0;
      },
    };
  },
};

/* ---------------------------------------------------------------
   Canvas-backed generators.

   Lettering and crowd silhouettes are drawn with the 2D context
   because they are shapes, not fields - constructing a readable glyph
   or a recognisable head-and-shoulders out of noise is possible and
   is a waste of everyone's time. The drawn art is read back through
   getImageData and then goes through exactly the same height ->
   normal -> AO pipeline as everything else, so a neon tube still gets
   a real dome normal rather than a flat card.
   --------------------------------------------------------------- */

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

/**
 * Emissive tube lettering.
 *
 * Drawn three times over: a wide dark pass for the glass envelope, a
 * medium pass for the phosphor, and a narrow white-hot pass for the
 * plasma core. That stack is why the sign still reads when it is
 * switched off - the albedo keeps the dark glass and only the emissive
 * carries the light, so an unlit sign is a grey tube rather than a
 * black rectangle with a glow painted on it.
 */
function drawNeon(w, h, o) {
  const text = String(o.text ?? "MOG");
  const hex = o.color ?? 0xff3ea5;
  const c = hexToRgb(hex);
  const rgb = (a) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;

  const art = makeCanvas(w, h);
  const g = art.getContext("2d", { willReadFrequently: true });
  g.clearRect(0, 0, w, h);

  const relief = makeCanvas(w, h);
  const gr = relief.getContext("2d", { willReadFrequently: true });
  gr.fillStyle = "#000";
  gr.fillRect(0, 0, w, h);

  const size = Math.floor(h * (o.fontScale ?? 0.44));
  const font = `900 ${size}px ${o.font ?? "Impact, Haettenschweiler, 'Arial Black', sans-serif"}`;
  const paint = (target, lines) => {
    target.font = font;
    target.textAlign = "center";
    target.textBaseline = "middle";
    target.lineJoin = "round";
    target.lineCap = "round";
    for (const line of lines) {
      target.lineWidth = line.width;
      target.strokeStyle = line.style;
      target.globalAlpha = line.alpha ?? 1;
      target.strokeText(text, w * 0.5, h * 0.5);
    }
    target.globalAlpha = 1;
  };

  // Glass envelope: dark, slightly cool, wider than the light.
  paint(g, [
    { width: size * 0.20, style: "rgba(24,22,30,1)" },
    { width: size * 0.15, style: "rgba(58,54,70,1)" },
    { width: size * 0.085, style: rgb(0.55) },
    { width: size * 0.035, style: "rgba(255,255,255,0.92)" },
  ]);

  // Relief: successively narrower white strokes build a dome profile
  // for the Sobel to turn into a real tube normal.
  gr.globalCompositeOperation = "lighter";
  for (let i = 0; i < 6; i += 1) {
    const t = i / 5;
    gr.lineWidth = size * lerp(0.20, 0.03, t);
    gr.strokeStyle = "rgba(255,255,255,0.19)";
    gr.font = font;
    gr.textAlign = "center";
    gr.textBaseline = "middle";
    gr.lineJoin = "round";
    gr.lineCap = "round";
    gr.strokeText(text, w * 0.5, h * 0.5);
  }

  // Emissive: the halo first (blurred by the shadow filter, which is
  // the only cheap blur a 2D context has), then the hot core.
  const em = makeCanvas(w, h);
  const ge = em.getContext("2d", { willReadFrequently: true });
  ge.clearRect(0, 0, w, h);
  ge.globalCompositeOperation = "lighter";
  ge.shadowColor = rgb(0.9);
  ge.shadowBlur = size * 0.28;
  paint(ge, [
    { width: size * 0.085, style: rgb(1), alpha: 0.85 },
  ]);
  ge.shadowBlur = 0;
  paint(ge, [
    { width: size * 0.075, style: rgb(1) },
    { width: size * 0.03, style: "rgba(255,255,255,1)" },
  ]);

  return {
    albedo: g.getImageData(0, 0, w, h).data,
    relief: gr.getImageData(0, 0, w, h).data,
    emissive: ge.getImageData(0, 0, w, h).data,
  };
}

/**
 * Crowd impostor sheet.
 *
 * A stadium crowd is thousands of bodies, and no draw-call budget
 * survives modelling any of them. What survives is one alpha-cut sheet
 * of silhouettes scattered across camera-facing quads - which is what
 * every arena game has done since arenas existed.
 *
 * These are drawn as SILHOUETTES with two or three value steps, not as
 * little characters. At the distance a crowd sits, detail is noise;
 * what carries is the outline and the value separation from whatever
 * is behind them. Roughly a third of them hold a phone up, because a
 * field of tiny lights is the cheapest possible "this is a concert".
 */
function drawCrowd(w, h, o) {
  const cols = o.cols ?? 4;
  const rows = o.rows ?? 4;
  const cw = Math.floor(w / cols);
  const ch = Math.floor(h / rows);
  const rng = makeRng(o.seed ?? 0x5EA7);

  const art = makeCanvas(w, h);
  const g = art.getContext("2d", { willReadFrequently: true });
  g.clearRect(0, 0, w, h);

  const relief = makeCanvas(w, h);
  const gr = relief.getContext("2d", { willReadFrequently: true });
  gr.fillStyle = "#000";
  gr.fillRect(0, 0, w, h);

  const em = makeCanvas(w, h);
  const ge = em.getContext("2d", { willReadFrequently: true });
  ge.clearRect(0, 0, w, h);

  const css = (r, g2, b, a = 1) =>
    `rgba(${Math.round(r * 255)},${Math.round(g2 * 255)},${Math.round(b * 255)},${a})`;

  for (let ry = 0; ry < rows; ry += 1) {
    for (let rx = 0; rx < cols; rx += 1) {
      const ox = rx * cw, oy = ry * ch;
      const skin = hslToRgb(0.06 + rng() * 0.03, 0.30 + rng() * 0.22, 0.22 + rng() * 0.42);
      const hair = hslToRgb(rng(), 0.35 + rng() * 0.5, 0.10 + rng() * 0.35);
      const shirt = hslToRgb(rng(), 0.45 + rng() * 0.45, 0.18 + rng() * 0.35);
      const armsUp = rng() < 0.45;
      const phone = rng() < 0.35;

      const cx = ox + cw * 0.5;
      const headR = ch * 0.13;
      const headY = oy + ch * 0.30;

      // Body: a rounded trapezoid, wide at the base so the silhouette
      // holds together when a hundred of them overlap.
      g.fillStyle = css(shirt.r, shirt.g, shirt.b);
      g.beginPath();
      g.moveTo(cx - cw * 0.20, oy + ch * 0.99);
      g.lineTo(cx - cw * 0.16, headY + headR * 1.35);
      g.quadraticCurveTo(cx, headY + headR * 0.7, cx + cw * 0.16, headY + headR * 1.35);
      g.lineTo(cx + cw * 0.20, oy + ch * 0.99);
      g.closePath();
      g.fill();

      if (armsUp) {
        g.strokeStyle = css(skin.r, skin.g, skin.b);
        g.lineWidth = cw * 0.07;
        g.lineCap = "round";
        for (const side of [-1, 1]) {
          g.beginPath();
          g.moveTo(cx + side * cw * 0.14, headY + headR * 2.0);
          g.lineTo(cx + side * cw * 0.24, headY + headR * 0.2);
          g.stroke();
        }
      }

      g.fillStyle = css(skin.r, skin.g, skin.b);
      g.beginPath();
      g.arc(cx, headY, headR, 0, Math.PI * 2);
      g.fill();

      g.fillStyle = css(hair.r, hair.g, hair.b);
      g.beginPath();
      g.arc(cx, headY - headR * 0.22, headR * 0.98, Math.PI, Math.PI * 2);
      g.fill();

      if (phone) {
        const px = cx + (rng() < 0.5 ? -1 : 1) * cw * 0.20;
        const py = headY - headR * (armsUp ? 2.4 : 0.4);
        g.fillStyle = "rgba(18,18,26,1)";
        g.fillRect(px - cw * 0.028, py - ch * 0.035, cw * 0.056, ch * 0.07);
        ge.fillStyle = "rgba(210,236,255,1)";
        ge.fillRect(px - cw * 0.020, py - ch * 0.028, cw * 0.040, ch * 0.056);
        ge.fillStyle = "rgba(160,210,255,0.35)";
        ge.beginPath();
        ge.arc(px, py, cw * 0.10, 0, Math.PI * 2);
        ge.fill();
      }

      // Relief: the whole silhouette lifted, with the head a touch
      // prouder, so the sheet still catches a rim light.
      gr.fillStyle = "rgba(150,150,150,1)";
      gr.beginPath();
      gr.moveTo(cx - cw * 0.20, oy + ch * 0.99);
      gr.lineTo(cx - cw * 0.16, headY + headR * 1.35);
      gr.quadraticCurveTo(cx, headY + headR * 0.7, cx + cw * 0.16, headY + headR * 1.35);
      gr.lineTo(cx + cw * 0.20, oy + ch * 0.99);
      gr.closePath();
      gr.fill();
      gr.fillStyle = "rgba(220,220,220,1)";
      gr.beginPath();
      gr.arc(cx, headY, headR, 0, Math.PI * 2);
      gr.fill();
    }
  }

  return {
    albedo: g.getImageData(0, 0, w, h).data,
    relief: gr.getImageData(0, 0, w, h).data,
    emissive: ge.getImageData(0, 0, w, h).data,
    cols, rows,
  };
}

const CANVAS_GENERATORS = {
  /**
   * Wraps a canvas draw into the same spec shape the field generators
   * use, so the driver does not need to know which kind it has. The
   * albedo is read straight back; the height comes from the separate
   * relief canvas, never from the albedo's luminance - a bright pixel
   * is not a high pixel and treating it as one is how you get a neon
   * sign whose letters are embossed by their own colour.
   */
  neonSign(w, h, o) {
    const art = drawNeon(w, h, o);
    const glow = o.emissiveGain ?? 1.0;
    return {
      normalStrength: 3.0,
      aoRadius: 3,
      aoStrength: 0.5,
      macroAmount: 0,
      emissive: true,
      nonTiling: true,
      height(u, v, x, y) { return art.relief[(y * w + x) * 4] / 255; },
      shade(u, v, hgt, slope, ao, x, y, out) {
        const i = (y * w + x) * 4;
        const a = art.albedo[i + 3] / 255;
        out[O_R] = (art.albedo[i] / 255) * a;
        out[O_G] = (art.albedo[i + 1] / 255) * a;
        out[O_B] = (art.albedo[i + 2] / 255) * a;
        out[O_ALPHA] = a;
        out[O_ROUGH] = 0.14 + (1 - a) * 0.5;
        out[O_METAL] = 0.0;
        const ea = art.emissive[i + 3] / 255;
        out[O_ER] = (art.emissive[i] / 255) * ea * glow;
        out[O_EG] = (art.emissive[i + 1] / 255) * ea * glow;
        out[O_EB] = (art.emissive[i + 2] / 255) * ea * glow;
      },
    };
  },

  crowdBoard(w, h, o) {
    const art = drawCrowd(w, h, o);
    return {
      normalStrength: 1.8,
      aoRadius: 3,
      aoStrength: 0.6,
      macroAmount: 0,
      emissive: true,
      nonTiling: true,
      atlas: { cols: art.cols, rows: art.rows },
      height(u, v, x, y) { return art.relief[(y * w + x) * 4] / 255; },
      shade(u, v, hgt, slope, ao, x, y, out) {
        const i = (y * w + x) * 4;
        const a = art.albedo[i + 3] / 255;
        out[O_R] = (art.albedo[i] / 255) * (0.80 + ao * 0.25);
        out[O_G] = (art.albedo[i + 1] / 255) * (0.80 + ao * 0.25);
        out[O_B] = (art.albedo[i + 2] / 255) * (0.80 + ao * 0.25);
        out[O_ALPHA] = a;
        out[O_ROUGH] = 0.82;
        out[O_METAL] = 0;
        const ea = art.emissive[i + 3] / 255;
        out[O_ER] = (art.emissive[i] / 255) * ea;
        out[O_EG] = (art.emissive[i + 1] / 255) * ea;
        out[O_EB] = (art.emissive[i + 2] / 255) * ea;
      },
    };
  },
};

/* Per-generator output size, as a multiple of the quality tier's base.
   Synthesis time and video memory are both linear in texel count and
   both are this module's whole cost, so anything the camera does not
   get close to is halved. Measured at the 512 default: a full-size set
   is 4 MB of VRAM with its mips, and a course that loads eight of them
   is already the biggest allocation in the game.

   crowdBoard sits at 1.0 rather than 2.0 despite being an atlas: a 4x4
   grid at 512 gives 128 px per figure, and a crowd impostor is never
   more than a few dozen pixels tall on screen. Doubling it cost 16 MB
   to render detail the rasteriser throws away in the first mip. */
const SIZE_SCALE = {
  macro: 0.5, glass: 0.5, water: 0.5, plastic: 0.5,
  velvetRope: 0.5, foil: 1.0, crowdBoard: 1.0, neonSign: 0.5,
};

const NON_SQUARE = {
  neonSign: { w: 2, h: 1 },
};

/* ============================================================
   Module
   ============================================================ */

export function create(ctx) {
  const THREE = ctx.THREE;
  const cache = new Map();
  const registry = [];   // every texture we made, for dispose/refilter
  let macroSet = null;
  let synthMs = 0;

  const baseSize = () => {
    const q = ctx.settings && ctx.settings.q;
    return (q && q.textureSize) || DEFAULT_SIZE;
  };

  /**
   * Anisotropic filtering level.
   *
   * Resolved lazily rather than at create() because textures.js is
   * wired BEFORE render.js (see main.js MODULE_TABLE), so there is no
   * renderer to ask when this module is constructed. Everything here is
   * generated on demand at course load, by which time the renderer
   * exists - and `ready()` re-applies it to anything that slipped
   * through earlier, because a floor sampled without anisotropy
   * shimmers into noise at grazing angles. SM64 never had this problem
   * because its textures were 32 pixels square; ours are 512 and will
   * alias into static without it.
   */
  function anisotropyLevel() {
    const caps = ctx.renderer && ctx.renderer.capabilities;
    const max = caps && typeof caps.getMaxAnisotropy === "function" ? caps.getMaxAnisotropy() : 1;
    const want = (ctx.settings && ctx.settings.q && ctx.settings.q.anisotropy) || 8;
    return clamp(Math.min(max, want), 1, 16);
  }

  function finish(texture, { srgb = false, wrap = true } = {}) {
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = anisotropyLevel();
    texture.needsUpdate = true;
    registry.push(texture);
    return texture;
  }

  function dataTexture(pixels, w, h, opts) {
    const t = new THREE.DataTexture(pixels, w, h, THREE.RGBAFormat);
    return finish(t, opts);
  }

  /**
   * Run a generator into raw buffers.
   *
   * Split out from texture creation so `atlas()` can pack several runs
   * into one image without uploading each of them first.
   */
  function synthBuffers(name, opts) {
    const gen = GENERATORS[name] || CANVAS_GENERATORS[name];
    if (!gen) throw new Error(`[apop3d] no texture generator "${name}"`);

    const t0 = (typeof performance !== "undefined" ? performance.now() : 0);
    const scale = SIZE_SCALE[name] ?? 1;
    const aspect = NON_SQUARE[name] || { w: 1, h: 1 };
    const base = Math.max(64, Math.round((opts.size || baseSize()) * scale));
    const w = opts.width || Math.round(base * aspect.w);
    const h = opts.height || Math.round(base * aspect.h);

    const spec = gen(w, h, opts);
    const height = buildHeight(w, h, spec.height);
    const ao = aoFromHeight(height, w, h, spec.aoRadius ?? 3, spec.aoStrength ?? 0.7);

    // Within-tile macro variation, applied by the driver so every
    // generator gets it without repeating the same four lines. This is
    // the low-frequency half of the anti-repeat story; the world-space
    // half lives in materials.js.
    const macroAmount = opts.macroAmount ?? spec.macroAmount ?? 0.14;
    let macroField = null;
    if (macroAmount > 0) {
      const MF = makeFieldKit(Math.max(w, h), (opts.seed ?? 1) * 31 + 5);
      macroField = MF.warped(2, 2, 3, 0.9);
    }

    const albedo = new Uint8ClampedArray(w * h * 4);
    const arm = new Uint8ClampedArray(w * h * 4);
    const emissive = spec.emissive ? new Uint8ClampedArray(w * h * 4) : null;
    const out = new Float64Array(9);

    const wx = (v) => ((v % w) + w) % w;
    const wy = (v) => ((v % h) + h) % h;
    const hAt = (x, y) => height[wy(y) * w + wx(x)];

    for (let y = 0; y < h; y += 1) {
      const v = y / h;
      for (let x = 0; x < w; x += 1) {
        const u = x / w;
        const i = y * w + x;
        const hgt = height[i];
        const slope = Math.hypot(hAt(x + 1, y) - hAt(x - 1, y), hAt(x, y + 1) - hAt(x, y - 1));

        out[O_R] = 0.5; out[O_G] = 0.5; out[O_B] = 0.5;
        out[O_ROUGH] = 0.8; out[O_METAL] = 0; out[O_ALPHA] = 1;
        out[O_ER] = 0; out[O_EG] = 0; out[O_EB] = 0;
        spec.shade(u, v, hgt, slope, ao[i], x, y, out);

        let tint = 1;
        if (macroField) tint = 1 + macroField.at(u, v) * macroAmount * 2;

        const j = i * 4;
        albedo[j] = clamp01(out[O_R] * tint) * 255;
        albedo[j + 1] = clamp01(out[O_G] * tint) * 255;
        albedo[j + 2] = clamp01(out[O_B] * tint) * 255;
        albedo[j + 3] = clamp01(out[O_ALPHA]) * 255;

        // R = ambient occlusion, G = roughness, B = metalness. Three
        // samples exactly those channels for aoMap/roughnessMap/
        // metalnessMap, so one upload serves all three.
        arm[j] = ao[i] * 255;
        arm[j + 1] = clamp01(out[O_ROUGH]) * 255;
        arm[j + 2] = clamp01(out[O_METAL]) * 255;
        arm[j + 3] = 255;

        if (emissive) {
          emissive[j] = clamp01(out[O_ER]) * 255;
          emissive[j + 1] = clamp01(out[O_EG]) * 255;
          emissive[j + 2] = clamp01(out[O_EB]) * 255;
          emissive[j + 3] = 255;
        }
      }
    }

    const normal = normalFromHeight(height, w, h, spec.normalStrength ?? 2.4);

    let flow = null;
    if (spec.flow) {
      // Flow map: the curl of a low-frequency field, which is
      // divergence-free by construction and therefore never piles water
      // up in a corner. RG carry the vector biased to 0.5.
      flow = new Uint8ClampedArray(w * h * 4);
      const f = spec.flow.field;
      const s = spec.flow.scale ?? 0.3;
      const e = 1 / Math.max(w, h);
      for (let y = 0; y < h; y += 1) {
        const v = y / h;
        for (let x = 0; x < w; x += 1) {
          const u = x / w;
          const dx = (f.at(u + e, v) - f.at(u - e, v)) / (2 * e);
          const dy = (f.at(u, v + e) - f.at(u, v - e)) / (2 * e);
          const j = (y * w + x) * 4;
          flow[j] = clamp01(0.5 + dy * s) * 255;
          flow[j + 1] = clamp01(0.5 - dx * s) * 255;
          flow[j + 2] = 128;
          flow[j + 3] = 255;
        }
      }
    }

    synthMs += (typeof performance !== "undefined" ? performance.now() : 0) - t0;
    return { w, h, albedo, arm, normal, emissive, flow, height, spec };
  }

  function toSet(name, opts, buffers) {
    const wrap = !buffers.spec.nonTiling;
    const arm = dataTexture(buffers.arm, buffers.w, buffers.h, { wrap });
    // aoMap must read UV channel 0. Three defaults the AO read to the
    // second UV set, and most procedurally built level geometry never
    // gets one - so the occlusion silently does nothing and every
    // recess lights as if it were flat.
    arm.channel = 0;

    const set = {
      name,
      opts,
      size: Math.max(buffers.w, buffers.h),
      width: buffers.w,
      height: buffers.h,
      map: dataTexture(buffers.albedo, buffers.w, buffers.h, { srgb: true, wrap }),
      normalMap: dataTexture(buffers.normal, buffers.w, buffers.h, { wrap }),
      roughnessMap: arm,
      aoMap: arm,
      metalnessMap: arm,
      armMap: arm,
      emissiveMap: buffers.emissive
        ? dataTexture(buffers.emissive, buffers.w, buffers.h, { srgb: true, wrap })
        : null,
      flowMap: buffers.flow ? dataTexture(buffers.flow, buffers.w, buffers.h, { wrap }) : null,
      heightField: buffers.height,
      hasAlpha: !!buffers.spec.nonTiling || name === "glass" || name === "water" || name === "foil",
      atlas: buffers.spec.atlas || null,
    };
    return set;
  }

  /** Cache key. Every option that changes the output has to be in
   *  here, and the key order has to be stable - two equivalent option
   *  objects written in a different order must hash the same or the
   *  cache silently synthesises the surface twice. */
  function keyOf(name, opts) {
    const keys = Object.keys(opts).sort();
    let s = name;
    for (const k of keys) {
      const v = opts[k];
      if (v === undefined) continue;
      s += `|${k}=${typeof v === "object" && v !== null ? JSON.stringify(v) : v}`;
    }
    return s;
  }

  function get(name, opts = {}) {
    const key = keyOf(name, opts);
    const hit = cache.get(key);
    if (hit) return hit;
    const set = toSet(name, opts, synthBuffers(name, opts));
    cache.set(key, set);
    return set;
  }

  /**
   * N independently seeded runs of the same generator.
   *
   * Deliberately NOT one packed atlas for the tiling surfaces. An atlas
   * cell cannot use RepeatWrapping - its neighbours bleed across the
   * cell border under mip filtering - and a floor that cannot repeat is
   * useless. Separate sets keep every variant individually tileable and
   * cost nothing extra on the GPU, since world.js only ever binds one
   * of them per draw. `atlas()` below exists for the surfaces that
   * genuinely want a sheet, where the mesh brings its own UVs.
   */
  function variants(name, opts = {}, count = 3) {
    const list = [];
    for (let i = 0; i < count; i += 1) {
      list.push(get(name, { ...opts, seed: (opts.seed ?? 1) + i * 977, variant: i }));
    }
    return list;
  }

  /**
   * Pack `cols * rows` variants into one sheet, for props that carry
   * their own UVs - crowd boards, sign faces, sleeve art. Never use
   * this for a surface that tiles.
   */
  function atlas(name, opts = {}) {
    const cols = opts.cols ?? 2;
    const rows = opts.rows ?? 2;
    const key = keyOf(`atlas:${name}`, opts);
    const hit = cache.get(key);
    if (hit) return hit;

    // Canvas generators lay their own grid out internally, which is
    // both cheaper and gives them control over the composition.
    if (CANVAS_GENERATORS[name]) {
      const set = get(name, opts);
      const packed = {
        ...set,
        cols: set.atlas ? set.atlas.cols : cols,
        rows: set.atlas ? set.atlas.rows : rows,
        uvRect(i) {
          const c = this.cols, r = this.rows;
          const ix = i % c, iy = Math.floor(i / c) % r;
          return { x: ix / c, y: 1 - (iy + 1) / r, w: 1 / c, h: 1 / r };
        },
      };
      cache.set(key, packed);
      return packed;
    }

    const cell = synthBuffers(name, { ...opts, seed: (opts.seed ?? 1) });
    const cw = cell.w, chh = cell.h;
    const W = cw * cols, H = chh * rows;
    const albedo = new Uint8ClampedArray(W * H * 4);
    const arm = new Uint8ClampedArray(W * H * 4);
    const normal = new Uint8ClampedArray(W * H * 4);
    const emissive = cell.emissive ? new Uint8ClampedArray(W * H * 4) : null;

    const blit = (src, dst, ox, oy) => {
      for (let y = 0; y < chh; y += 1) {
        const s = y * cw * 4;
        const d = ((oy + y) * W + ox) * 4;
        dst.set(src.subarray(s, s + cw * 4), d);
      }
    };

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        const buf = i === 0 ? cell : synthBuffers(name, { ...opts, seed: (opts.seed ?? 1) + i * 977 });
        blit(buf.albedo, albedo, c * cw, r * chh);
        blit(buf.arm, arm, c * cw, r * chh);
        blit(buf.normal, normal, c * cw, r * chh);
        if (emissive && buf.emissive) blit(buf.emissive, emissive, c * cw, r * chh);
      }
    }

    const armTex = dataTexture(arm, W, H, { wrap: false });
    armTex.channel = 0;
    const packed = {
      name, opts, cols, rows, width: W, height: H, size: Math.max(W, H),
      map: dataTexture(albedo, W, H, { srgb: true, wrap: false }),
      normalMap: dataTexture(normal, W, H, { wrap: false }),
      roughnessMap: armTex,
      aoMap: armTex,
      metalnessMap: armTex,
      armMap: armTex,
      emissiveMap: emissive ? dataTexture(emissive, W, H, { srgb: true, wrap: false }) : null,
      flowMap: null,
      hasAlpha: true,
      uvRect(i) {
        const ix = i % cols, iy = Math.floor(i / cols) % rows;
        return { x: ix / cols, y: 1 - (iy + 1) / rows, w: 1 / cols, h: 1 / rows };
      },
    };
    cache.set(key, packed);
    return packed;
  }

  /** The shared world-space breakup layer. One instance for the whole
   *  game; materials.js binds it into every tiled surface. */
  function macro() {
    if (!macroSet) macroSet = get("macro", { seed: 3 });
    return macroSet;
  }

  const api = {
    get,
    variants,
    atlas,
    macro,
    has(name) { return !!(GENERATORS[name] || CANVAS_GENERATORS[name]); },
    names: Object.keys(GENERATORS).concat(Object.keys(CANVAS_GENERATORS)),

    /** Re-apply filtering to everything already uploaded. Called from
     *  ready() because the renderer does not exist when this module is
     *  constructed and the first few textures may have been created
     *  with a placeholder anisotropy. */
    refreshFiltering() {
      const level = anisotropyLevel();
      for (const t of registry) {
        if (t.anisotropy !== level) { t.anisotropy = level; t.needsUpdate = true; }
      }
      return level;
    },

    stats() {
      let bytes = 0;
      for (const t of registry) {
        const img = t.image;
        if (img && img.width) bytes += img.width * img.height * 4 * 1.34;
      }
      return { sets: cache.size, textures: registry.length, synthMs: Math.round(synthMs), bytes: Math.round(bytes) };
    },

    dispose() {
      for (const t of registry) t.dispose();
      registry.length = 0;
      cache.clear();
      macroSet = null;
      synthMs = 0;
    },

    update() {},
    lateUpdate() {},
  };

  return api;
}

/** Runs after every module exists. See refreshFiltering(). */
export function ready(ctx) {
  if (ctx.textures && typeof ctx.textures.refreshFiltering === "function") {
    ctx.textures.refreshFiltering();
  }
}
