/* ============================================================
   BLACKSAND - core primitives

   Shared, dependency-free helpers every other module leans on:
   a deterministic RNG, an event bus, small math, and the shape
   of the `ctx` object that is threaded through the whole engine.

   Nothing here may import three. Modules that need three take it
   from `ctx.THREE` so the import map stays the single source of
   truth for which build is live.
   ============================================================ */

export const VERSION = "0.1.0";

/* ----------------------------- math ----------------------------- */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v, a, b, c, d) => lerp(c, d, clamp01(invLerp(a, b, v)));
export const smoothstep = (t) => { const x = clamp01(t); return x * x * (3 - 2 * x); };
export const smootherstep = (t) => { const x = clamp01(t); return x * x * x * (x * (x * 6 - 15) + 10); };

/** Frame-rate independent exponential approach.
 *  `rate` is the fraction of the remaining gap closed per second. */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

/** Shortest signed angular difference, in radians. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export const dampAngle = (a, b, rate, dt) => a + angleDelta(a, b) * (1 - Math.exp(-rate * dt));

/* ------------------------------ rng ------------------------------ */

/**
 * mulberry32. Small, fast, and good enough for world generation.
 * Everything procedural in this game seeds from here so a map is
 * byte-identical for every player in a match - the netcode ships a
 * seed, not a heightmap.
 */
export function makeRng(seed = 1) {
  let a = (seed >>> 0) || 1;
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + (hi - lo) * rng();
  rng.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * rng());
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  rng.sign = () => (rng() < 0.5 ? -1 : 1);
  rng.chance = (p) => rng() < p;
  /** Box-Muller, cached. Useful for scatter that should clump naturally. */
  let spare = null;
  rng.gauss = () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0; let v = 0; let s = 0;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * m;
    return u * m;
  };
  rng.shuffle = (arr) => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  };
  return rng;
}

/** Deterministic 32-bit hash of a string, for seeding by name. */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------ noise ------------------------------ */

/**
 * Classic 2D value-gradient noise with a permutation table. Terrain,
 * texture synthesis and wind all share this so a single seed controls
 * everything visible.
 */
export function makeNoise2D(seed = 1) {
  const rng = makeRng(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) p[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i += 1) perm[i] = p[i & 255];

  const GRAD = [
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ];

  function grad(hash, x, y) {
    const g = GRAD[hash & 7];
    return g[0] * x + g[1] * y;
  }

  /** Perlin-style, range roughly [-1, 1]. */
  function noise(x, y) {
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
    return lerp(x1, x2, v);
  }

  /** Fractal sum. `lacunarity` and `gain` follow the usual convention. */
  noise.fbm = (x, y, octaves = 5, lacunarity = 2.0, gain = 0.5) => {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i += 1) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / (norm || 1);
  };

  /** Ridged multifractal - the shape that reads as eroded rock. */
  noise.ridged = (x, y, octaves = 5, lacunarity = 2.0, gain = 0.5) => {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i += 1) {
      const n = 1 - Math.abs(noise(x * freq, y * freq));
      sum += amp * n * n;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / (norm || 1);
  };

  /** Domain-warped fbm. Kills the grid-aligned look of plain fbm. */
  noise.warped = (x, y, strength = 1.4, octaves = 5) => {
    const qx = noise.fbm(x + 0.0, y + 0.0, 3);
    const qy = noise.fbm(x + 5.2, y + 1.3, 3);
    return noise.fbm(x + strength * qx, y + strength * qy, octaves);
  };

  return noise;
}

/* ------------------------------ bus ------------------------------ */

/**
 * Tiny synchronous event bus. Subsystems talk through this rather
 * than holding references to each other, which is what lets separate
 * modules be developed and swapped independently.
 */
export function makeBus() {
  const handlers = new Map();
  return {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
    once(type, fn) {
      const off = this.on(type, (payload) => { off(); fn(payload); });
      return off;
    },
    off(type, fn) {
      handlers.get(type)?.delete(fn);
    },
    emit(type, payload) {
      const set = handlers.get(type);
      if (!set) return;
      // Copy: handlers commonly unsubscribe themselves during dispatch.
      for (const fn of Array.from(set)) {
        try {
          fn(payload);
        } catch (error) {
          console.error(`[blacksand] handler for "${type}" threw`, error);
        }
      }
    },
    clear() { handlers.clear(); },
  };
}

/* ----------------------------- pools ----------------------------- */

/**
 * Fixed-capacity object pool. Every per-frame allocation in the hot
 * loop (tracers, decals, impact sparks) comes from one of these -
 * a shooter that allocates per bullet will stutter under GC.
 */
export function makePool(factory, capacity, reset) {
  const items = new Array(capacity);
  const free = new Int32Array(capacity);
  let freeCount = capacity;
  for (let i = 0; i < capacity; i += 1) {
    items[i] = factory(i);
    free[i] = capacity - 1 - i;
  }
  return {
    capacity,
    items,
    get active() { return capacity - freeCount; },
    acquire() {
      if (freeCount === 0) return null;
      freeCount -= 1;
      const index = free[freeCount];
      const item = items[index];
      item.__poolIndex = index;
      return item;
    },
    release(item) {
      if (!item || item.__poolIndex === undefined || item.__poolIndex < 0) return;
      if (reset) reset(item);
      free[freeCount] = item.__poolIndex;
      item.__poolIndex = -1;
      freeCount += 1;
    },
    releaseAll() {
      freeCount = capacity;
      for (let i = 0; i < capacity; i += 1) {
        if (reset) reset(items[i]);
        items[i].__poolIndex = -1;
        free[i] = capacity - 1 - i;
      }
    },
  };
}

/* --------------------------- ring buffer --------------------------- */

/** Fixed-size history, used by the netcode for snapshot interpolation
 *  and by the profiler for rolling frame times. */
export function makeRing(size) {
  const data = new Array(size).fill(null);
  let head = 0;
  let count = 0;
  return {
    size,
    push(value) {
      data[head] = value;
      head = (head + 1) % size;
      if (count < size) count += 1;
      return value;
    },
    /** 0 = newest. */
    at(index) {
      if (index < 0 || index >= count) return null;
      return data[(head - 1 - index + size * 2) % size];
    },
    get length() { return count; },
    toArray() {
      const out = [];
      for (let i = count - 1; i >= 0; i -= 1) out.push(this.at(i));
      return out;
    },
    clear() { head = 0; count = 0; data.fill(null); },
  };
}

/* --------------------------- diagnostics --------------------------- */

/**
 * Rolling statistics over the last N samples. The HUD's frame graph
 * and the QA report both read from one of these; percentiles matter
 * more than an average because a shooter is judged on its worst frames.
 */
export function makeStat(window = 180) {
  const ring = makeRing(window);
  return {
    push(v) { ring.push(v); return v; },
    get length() { return ring.length; },
    mean() {
      if (!ring.length) return 0;
      let sum = 0;
      for (let i = 0; i < ring.length; i += 1) sum += ring.at(i);
      return sum / ring.length;
    },
    percentile(p) {
      if (!ring.length) return 0;
      const arr = ring.toArray().slice().sort((a, b) => a - b);
      const idx = clamp(Math.round((p / 100) * (arr.length - 1)), 0, arr.length - 1);
      return arr[idx];
    },
    max() {
      let m = -Infinity;
      for (let i = 0; i < ring.length; i += 1) m = Math.max(m, ring.at(i));
      return ring.length ? m : 0;
    },
    clear() { ring.clear(); },
  };
}

/* ------------------------------ misc ------------------------------ */

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Resolve after the next paint. Used by the loader so progress text
 *  actually renders between heavy build steps instead of jumping. */
export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Yield to the browser so a long synchronous build does not freeze
 *  the loading screen. Cheaper than nextFrame when called in a loop. */
export function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Very small deep-ish merge for settings objects. Arrays and class
 * instances are replaced wholesale, plain objects are merged.
 */
export function mergeDeep(target, patch) {
  if (!patch) return target;
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    const isPlain = value && typeof value === "object" && !Array.isArray(value)
      && Object.getPrototypeOf(value) === Object.prototype;
    if (isPlain && target[key] && typeof target[key] === "object") {
      mergeDeep(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}
