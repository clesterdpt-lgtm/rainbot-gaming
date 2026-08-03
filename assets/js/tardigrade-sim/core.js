/* ============================================================
   Tardigrade Simulator - shared core utilities
   Small, dependency-free helpers used by every system module.
   ============================================================ */

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b - a === 0 ? 0 : (v - a) / (b - a));
export const smoothstep = (a, b, v) => {
  const t = clamp01(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (a, b, v) => {
  const t = clamp01(invLerp(a, b, v));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Frame-rate independent exponential smoothing. `rate` = how much of the gap closes per second. */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

export const wrapAngle = (a) => {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
};
export const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;
export const dampAngle = (a, b, rate, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt));

/** Deterministic 32-bit hash -> [0,1). Used anywhere a stable "random" is needed. */
export function hash01(x, y = 0, z = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** mulberry32 - tiny, fast, seedable PRNG. Every system should use this, never Math.random. */
export function makeRng(seed = 1) {
  let a = (seed >>> 0) || 1;
  const rng = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.int = (lo, hi) => Math.floor(lo + rng() * (hi - lo + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.sign = () => (rng() < 0.5 ? -1 : 1);
  /** Normally distributed, mean 0 stddev 1 (Box-Muller). */
  rng.normal = () => {
    const u = Math.max(1e-9, rng());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rng());
  };
  return rng;
}

/** Minimal synchronous event bus. */
export class Emitter {
  constructor() { this._map = new Map(); }
  on(type, fn) {
    let set = this._map.get(type);
    if (!set) { set = new Set(); this._map.set(type, set); }
    set.add(fn);
    return () => this.off(type, fn);
  }
  once(type, fn) {
    const off = this.on(type, (payload) => { off(); fn(payload); });
    return off;
  }
  off(type, fn) {
    const set = this._map.get(type);
    if (set) set.delete(fn);
  }
  emit(type, payload) {
    const set = this._map.get(type);
    if (!set || set.size === 0) return;
    for (const fn of Array.from(set)) {
      try { fn(payload); }
      catch (error) { console.error(`[tardigrade-sim] listener for "${type}" threw`, error); }
    }
  }
  clear() { this._map.clear(); }
}

/**
 * Rolling numeric stats, used for the perf overlay and QA reports.
 */
export class RollingAverage {
  constructor(size = 90) {
    this.size = size;
    this.values = new Float32Array(size);
    this.index = 0;
    this.count = 0;
  }
  push(value) {
    this.values[this.index] = value;
    this.index = (this.index + 1) % this.size;
    if (this.count < this.size) this.count += 1;
    return this;
  }
  get mean() {
    if (this.count === 0) return 0;
    let total = 0;
    for (let i = 0; i < this.count; i += 1) total += this.values[i];
    return total / this.count;
  }
  percentile(p) {
    if (this.count === 0) return 0;
    const slice = Array.prototype.slice.call(this.values, 0, this.count).sort((a, b) => a - b);
    const idx = clamp(Math.round((slice.length - 1) * p), 0, slice.length - 1);
    return slice[idx];
  }
}

/** Reusable object pool so hot paths never allocate. */
export class Pool {
  constructor(factory, reset, initial = 0) {
    this.factory = factory;
    this.reset = reset;
    this.free = [];
    for (let i = 0; i < initial; i += 1) this.free.push(factory());
  }
  acquire() {
    return this.free.length > 0 ? this.free.pop() : this.factory();
  }
  release(item) {
    if (this.reset) this.reset(item);
    this.free.push(item);
  }
}

/** Format helpers shared by HUD + QA text output. */
export const fmtInt = (v) => Math.round(v).toLocaleString("en-US");
export const fmtTime = (seconds) => {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};

/** Standard easing curves for UI + camera work. */
export const ease = {
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  outBack: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  outElastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};
