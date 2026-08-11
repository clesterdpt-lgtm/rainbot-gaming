/* ============================================================
   SAINTFALL - core primitives

   Dependency-free helpers every other module leans on: a
   deterministic RNG, noise fields, small math, colour utilities
   and an event bus.

   Nothing here may import three. Modules that need three take it
   from `ctx.THREE` so the import map stays the single source of
   truth for which build is live.
   ============================================================ */

export const VERSION = "0.1.0";

/* ----------------------------- math ----------------------------- */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v, a, b, c, d) => lerp(c, d, clamp01(invLerp(a, b, v)));
export const smoothstep = (t) => { const x = clamp01(t); return x * x * (3 - 2 * x); };
export const smootherstep = (t) => { const x = clamp01(t); return x * x * x * (x * (x * 6 - 15) + 10); };
export const sstep = (edge0, edge1, x) => smoothstep(invLerp(edge0, edge1, x));

/** Frame-rate independent exponential approach. */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export const dampAngle = (a, b, rate, dt) => a + angleDelta(a, b) * (1 - Math.exp(-rate * dt));

/** Smooth minimum. The shape that lets two height fields merge into
 *  one landmass instead of intersecting with a visible seam. */
export function smin(a, b, k) {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return lerp(b, a, h) - k * h * (1 - h);
}

export function smax(a, b, k) {
  return -smin(-a, -b, k);
}

/* ------------------------------ rng ------------------------------ */

/** mulberry32. Everything procedural seeds from here. */
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
  /** Symmetric jitter in [-m, m]. */
  rng.jit = (m) => (rng() * 2 - 1) * m;
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
  /** Weighted pick. `items` is [{ w, ...}] or a parallel weights array. */
  rng.weighted = (items, weightOf = (it) => it.w) => {
    let total = 0;
    for (const it of items) total += weightOf(it) || 0;
    let r = rng() * total;
    for (const it of items) {
      r -= weightOf(it) || 0;
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  };
  return rng;
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Cheap deterministic hash of two integers to [0,1). Used for
 *  per-instance variation where a full RNG stream is overkill. */
export function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* ------------------------------ noise ------------------------------ */

/**
 * Classic 2D gradient noise with a permutation table, plus the
 * fractal variants the terrain leans on.
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

  /** Billowed - rounded, cloud-like lobes. Dune crowns use this. */
  noise.billow = (x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) => {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i += 1) {
      sum += amp * (Math.abs(noise(x * freq, y * freq)) * 2 - 1);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / (norm || 1);
  };

  return noise;
}

/* ------------------------------ colour ------------------------------ */

/**
 * Colour helpers that work on plain [r,g,b] arrays in 0..1 sRGB.
 * The palette is authored in sRGB because that is how eyes and
 * reference images work; conversion to linear happens once, at the
 * point a value is handed to three.
 */

export function hexToRgb(hex) {
  const h = typeof hex === "string" ? parseInt(hex.replace("#", ""), 16) : hex;
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}

export function rgbToHex(rgb) {
  const c = (v) => clamp(Math.round(v * 255), 0, 255);
  return (c(rgb[0]) << 16) | (c(rgb[1]) << 8) | c(rgb[2]);
}

export function mixRgb(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** sRGB transfer -> linear. */
export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export function rgbToLinear(rgb) {
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
}

export function rgbToHsl(rgb) {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

export function hslToRgb(hsl) {
  const [h, s, l] = hsl;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}

/** Shift a colour in HSL space. Used everywhere to derive a shade or
 *  a highlight from a base without hand-authoring three swatches. */
export function shiftHsl(rgb, dh = 0, ds = 0, dl = 0) {
  const [h, s, l] = rgbToHsl(rgb);
  return hslToRgb([(h + dh + 1) % 1, clamp01(s + ds), clamp01(l + dl)]);
}

/**
 * A colour ramp. Stops are [t, "#rrggbb"] pairs; `at(t)` interpolates
 * in sRGB, which is where the palette was designed and where the
 * midpoints look right.
 */
export function makeRamp(stops) {
  const parsed = stops
    .map(([t, c]) => ({ t, c: typeof c === "string" || typeof c === "number" ? hexToRgb(c) : c }))
    .sort((a, b) => a.t - b.t);
  return {
    stops: parsed,
    at(t) {
      const x = clamp01(t);
      if (x <= parsed[0].t) return parsed[0].c.slice();
      const last = parsed[parsed.length - 1];
      if (x >= last.t) return last.c.slice();
      for (let i = 0; i < parsed.length - 1; i += 1) {
        const a = parsed[i];
        const b = parsed[i + 1];
        if (x >= a.t && x <= b.t) {
          const k = invLerp(a.t, b.t, x);
          return mixRgb(a.c, b.c, k);
        }
      }
      return last.c.slice();
    },
  };
}

/* ------------------------------ bus ------------------------------ */

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
    off(type, fn) { handlers.get(type)?.delete(fn); },
    emit(type, payload) {
      const set = handlers.get(type);
      if (!set) return;
      for (const fn of Array.from(set)) {
        try {
          fn(payload);
        } catch (error) {
          console.error(`[saintfall] handler for "${type}" threw`, error);
        }
      }
    },
    clear() { handlers.clear(); },
  };
}

/* ----------------------------- stats ----------------------------- */

export function makeRing(size) {
  const data = new Array(size).fill(0);
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
    clear() { head = 0; count = 0; data.fill(0); },
  };
}

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

export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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

/** 2D distance helpers, used constantly by the district fields. */
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const distSq2 = (ax, az, bx, bz) => {
  const dx = ax - bx; const dz = az - bz;
  return dx * dx + dz * dz;
};

/** Signed distance to a 2D line segment. Roads, trenches and ridges
 *  are all authored as polylines and evaluated through this. */
export function sdSegment(px, pz, ax, az, bx, bz) {
  const pax = px - ax;
  const paz = pz - az;
  const bax = bx - ax;
  const baz = bz - az;
  const h = clamp01((pax * bax + paz * baz) / (bax * bax + baz * baz || 1e-6));
  const dx = pax - bax * h;
  const dz = paz - baz * h;
  return Math.hypot(dx, dz);
}

/** Distance to a polyline: min over its segments. */
export function sdPolyline(px, pz, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const d = sdSegment(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

/** Catmull-Rom sample of a polyline, for smooth roads and ridges. */
export function sampleSpline(pts, t) {
  const n = pts.length;
  if (n === 0) return [0, 0];
  if (n === 1) return pts[0].slice();
  const x = clamp01(t) * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  const f = x - i;
  const p0 = pts[Math.max(0, i - 1)];
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p3 = pts[Math.min(n - 1, i + 2)];
  const cr = (a, b, c, d) => 0.5 * (
    2 * b + (-a + c) * f
    + (2 * a - 5 * b + 4 * c - d) * f * f
    + (-a + 3 * b - 3 * c + d) * f * f * f
  );
  return [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])];
}
