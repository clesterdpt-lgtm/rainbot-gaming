/* ============================================================
   APOP DEMON MOGGERS 3D - core

   Pure helpers. Nothing here may import three: these functions get
   called from the physics inner loop and from the build scripts that
   run under plain node, so they stay dependency-free and allocation-
   free wherever it is cheap to do so.
   ============================================================ */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const smootherstep = (t) => { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); };
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Frame-rate independent exponential approach.
 *  `rate` is the fraction of the remaining gap closed per second.
 *  damp(x, target, 0.9, dt) converges identically at 30fps and 144fps,
 *  which a naive `x += (target-x)*0.9` does not. */
export function damp(current, target, rate, dt) {
  return target + (current - target) * Math.exp(-rate * dt);
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** Shortest signed angular difference, in (-PI, PI]. */
export function angleDelta(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/** Rotate `from` toward `to` by at most `maxStep` radians, wrapping correctly. */
export function approachAngle(from, to, maxStep) {
  const d = angleDelta(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

/** Exponential angular damping that takes the short way round. */
export function dampAngle(from, to, rate, dt) {
  return from + angleDelta(from, to) * (1 - Math.exp(-rate * dt));
}

// ---------------------------------------------------------------
// Deterministic RNG. Level layout, texture synthesis and crowd
// placement all seed from here so a given build always renders the
// same frame - which is the only way the screenshot goldens mean
// anything.
// ---------------------------------------------------------------

/** mulberry32: small, fast, good enough distribution for art seeding. */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngRange(rng, lo, hi) { return lo + rng() * (hi - lo); }
export function rngInt(rng, lo, hi) { return Math.floor(lo + rng() * (hi - lo + 1)); }
export function rngPick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

/** Fisher-Yates, seeded. Returns a new array. */
export function rngShuffle(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return out;
}

// ---------------------------------------------------------------
// Value / gradient noise. Used by the texture synthesiser and by the
// terrain shaping in the outdoor courses.
// ---------------------------------------------------------------

export function makeNoise2D(seed) {
  const rng = makeRng(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) p[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i += 1) perm[i] = p[i & 255];

  const grad = (hash, x, y) => {
    switch (hash & 7) {
      case 0: return x + y;
      case 1: return x - y;
      case 2: return -x + y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  };

  return function noise2D(x, y) {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = smootherstep(xf);
    const v = smootherstep(yf);
    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v); // roughly -1..1
  };
}

/** Fractal brownian motion over any 2D noise function. */
export function fbm2D(noise, x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

// ---------------------------------------------------------------
// Colour. Authoring happens in hex; shading wants linear-ish floats
// and a way to derive a tint or shade from a base without hand-mixing
// three swatches per material.
// ---------------------------------------------------------------

export function hexToRgb(hex) {
  const h = typeof hex === "string" ? parseInt(hex.replace("#", ""), 16) : hex;
  return { r: ((h >> 16) & 255) / 255, g: ((h >> 8) & 255) / 255, b: (h & 255) / 255 };
}

export function rgbToHex(r, g, b) {
  const c = (v) => clamp(Math.round(v * 255), 0, 255);
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

export function mixHex(a, b, t) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  return rgbToHex(lerp(ca.r, cb.r, t), lerp(ca.g, cb.g, t), lerp(ca.b, cb.b, t));
}

export function shadeHex(hex, amount) {
  return amount >= 0 ? mixHex(hex, 0xffffff, amount) : mixHex(hex, 0x000000, -amount);
}

export function hslToRgb(h, s, l) {
  h = ((h % 1) + 1) % 1;
  if (s <= 0) return { r: l, g: l, b: l };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: hue(h + 1 / 3), g: hue(h), b: hue(h - 1 / 3) };
}

export function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

// ---------------------------------------------------------------
// Easing. The animation and camera work leans on these hard; SM64's
// readability comes largely from motion that accelerates and settles
// rather than moving linearly.
// ---------------------------------------------------------------

export const ease = {
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outBack: (t) => { const c = 1.70158, c3 = c + 1; return 1 + c3 * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  outElastic: (t) => {
    if (t <= 0) return 0; if (t >= 1) return 1;
    const c4 = TAU / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  outBounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

// ---------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------

/** Ring buffer of numbers, for frame timing and hitch detection. */
export class Rolling {
  constructor(size = 60) { this.buf = new Float64Array(size); this.i = 0; this.n = 0; }
  push(v) { this.buf[this.i] = v; this.i = (this.i + 1) % this.buf.length; if (this.n < this.buf.length) this.n += 1; return this; }
  get mean() { let s = 0; for (let k = 0; k < this.n; k += 1) s += this.buf[k]; return this.n ? s / this.n : 0; }
  get max() { let m = -Infinity; for (let k = 0; k < this.n; k += 1) if (this.buf[k] > m) m = this.buf[k]; return this.n ? m : 0; }
  percentile(p) {
    if (!this.n) return 0;
    const a = Array.prototype.slice.call(this.buf, 0, this.n).sort((x, y) => x - y);
    return a[clamp(Math.floor(p * (a.length - 1)), 0, a.length - 1)];
  }
}

/** A named timer that counts down in seconds and reports its first zero-cross. */
export class Timer {
  constructor(duration = 0) { this.t = duration; this.duration = duration; }
  set(d) { this.t = d; this.duration = d; return this; }
  tick(dt) { const was = this.t > 0; this.t = Math.max(0, this.t - dt); return was && this.t === 0; }
  get active() { return this.t > 0; }
  get progress() { return this.duration > 0 ? 1 - this.t / this.duration : 1; }
}

/** Fixed-size object pool. VFX and audio voices both draw from these
 *  so a busy boss phase never allocates mid-frame. */
export class Pool {
  constructor(factory, size) {
    this.items = new Array(size);
    for (let i = 0; i < size; i += 1) this.items[i] = { alive: false, obj: factory(i) };
    this.cursor = 0;
  }
  acquire() {
    const n = this.items.length;
    for (let k = 0; k < n; k += 1) {
      const slot = this.items[(this.cursor + k) % n];
      if (!slot.alive) { slot.alive = true; this.cursor = (this.cursor + k + 1) % n; return slot; }
    }
    // Fully saturated: steal the oldest. Dropping the effect entirely
    // reads as a bug; recycling reads as density.
    const slot = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % n;
    return slot;
  }
  release(slot) { slot.alive = false; }
  forEach(fn) { for (let i = 0; i < this.items.length; i += 1) if (this.items[i].alive) fn(this.items[i].obj, this.items[i]); }
}

/** Tiny event bus. Keeps gameplay systems from importing each other
 *  just to say "the player landed" or "a record was collected". */
export class Bus {
  constructor() { this.map = new Map(); }
  on(name, fn) {
    if (!this.map.has(name)) this.map.set(name, new Set());
    this.map.get(name).add(fn);
    return () => this.off(name, fn);
  }
  off(name, fn) { const s = this.map.get(name); if (s) s.delete(fn); }
  emit(name, payload) {
    const s = this.map.get(name);
    if (!s) return;
    for (const fn of s) {
      try { fn(payload); } catch (err) { console.error(`[apop3d] listener for "${name}" threw`, err); }
    }
  }
}
