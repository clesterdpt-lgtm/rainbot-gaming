/* ============================================================
   Tardigrade Simulator - procedural PBR material library

   Everything here is generated in code. No image files, ever.

   ------------------------------------------------------------
   HOW IT WORKS
   ------------------------------------------------------------
   Each material is baked from a small set of scalar noise
   *fields* (Float32Array, one value per texel):

       fBm  -  fractal brownian motion, the general-purpose
               "natural surface" noise.
       ridged multifractal - sharp creases: bark fissures,
               rock facets, wood grain.
       Worley / cellular - discrete objects: gravel pebbles,
               soil aggregate, moss shoots, glaze crazing,
               concrete air pockets.
       domain warping - fBm used to distort the *input* of the
               next noise, which is what stops procedural work
               looking like procedural work.

   All noise is tileable by construction (integer lattice periods
   with an explicit modulo wrap), and fully deterministic - the
   permutation table comes from core.js `makeRng`, never
   Math.random, so screenshots are reproducible frame for frame.

   From those fields each generator produces:

       height   -> a real height field in [0,1]
       albedo   -> LINEAR reflectance, encoded to sRGB on write
       rough    -> perceptual roughness
       metal    -> metalness (only where it is non-zero)

   The normal map is then derived from the height field with a
   3x3 Sobel operator (wrap-aware). Nothing is faked with random
   RGB noise: if the normal map says there is a bump, the height
   field says so too, and the ambient occlusion agrees.

   ------------------------------------------------------------
   TEXTURE PACKING
   ------------------------------------------------------------
   Three textures per material, never more:

       <name>          RGB albedo        SRGBColorSpace
       <name>.normal   RGB tangent normal + A = height
                                         LinearSRGBColorSpace
       <name>.orm      R = AO
                       G = roughness
                       B = metalness     LinearSRGBColorSpace

   The ORM texture is bound to aoMap / roughnessMap /
   metalnessMap at once - glTF's ORM convention - so a material
   with full PBR channels costs three uploads, not five.

   Colour space is the classic trap here: ONLY the albedo map is
   sRGB. Normal, roughness, AO and metalness are linear data and
   are tagged LinearSRGBColorSpace. Getting this wrong makes
   every surface in the game subtly wrong in a way that is very
   hard to see and impossible to unsee.

   ------------------------------------------------------------
   SCALE
   ------------------------------------------------------------
   The world is measured in tardigrade body lengths (hero = 1.6).
   Every material declares `tile`: how many world units one
   texture tile is *meant* to cover. `repeat` is the default for
   the geometry this material usually lands on. If your mesh is a
   different size, ask for the right tiling instead of guessing:

       materials.make("soil", { worldSize: 900 })   // 900 units across
       materials.make("bark", { repeat: 12 })
       materials.repeatFor("gravel", 240)           // -> a number

   `make()` clones the textures when you change tiling, but the
   clones share the same GPU image, so retiling is close to free.
   ============================================================ */

import * as THREE from "three";
import { clamp, clamp01, lerp, smoothstep, hash01, makeRng } from "./core.js";

/* ==========================================================
   1. Colour helpers
   ========================================================== */

/** linear -> sRGB, table driven because we call it ~50 million times. */
const SRGB_LUT = new Uint8Array(4096);
for (let i = 0; i < 4096; i += 1) {
  const c = i / 4095;
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  SRGB_LUT[i] = Math.round(clamp01(v) * 255);
}
const toSrgbByte = (linear) => SRGB_LUT[(clamp01(linear) * 4095) | 0];

/** Perlin output is roughly +-0.62; 0.8 gain fills [0,1] without much clipping. */
const n01 = (v) => clamp01(v * 0.8 + 0.5);

/* ==========================================================
   2. Noise toolkit - all tileable, all deterministic
   ========================================================== */

const GRAD = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1]);

function makePerm(rng) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) p[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = (rng() * (i + 1)) | 0;
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1) perm[i] = p[i & 255];
  return perm;
}

/**
 * 2D gradient (Perlin) noise on a lattice that wraps every
 * (px, py) cells. Because the wrap is explicit, sampling u in
 * [0,1) at frequency px gives a seamlessly tiling texture.
 */
function noise2(x, y, px, py, perm) {
  const X = Math.floor(x);
  const Y = Math.floor(y);
  const fx = x - X;
  const fy = y - Y;

  let x0 = X % px; if (x0 < 0) x0 += px;
  let y0 = Y % py; if (y0 < 0) y0 += py;
  let x1 = x0 + 1; if (x1 >= px) x1 = 0;
  let y1 = y0 + 1; if (y1 >= py) y1 = 0;

  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);

  const a0 = perm[x0 & 511];
  const a1 = perm[x1 & 511];

  let h = (perm[(a0 + y0) & 511] & 7) << 1;
  const n00 = GRAD[h] * fx + GRAD[h + 1] * fy;
  h = (perm[(a1 + y0) & 511] & 7) << 1;
  const n10 = GRAD[h] * (fx - 1) + GRAD[h + 1] * fy;
  h = (perm[(a0 + y1) & 511] & 7) << 1;
  const n01 = GRAD[h] * fx + GRAD[h + 1] * (fy - 1);
  h = (perm[(a1 + y1) & 511] & 7) << 1;
  const n11 = GRAD[h] * (fx - 1) + GRAD[h + 1] * (fy - 1);

  const ix0 = n00 + u * (n10 - n00);
  const ix1 = n01 + u * (n11 - n01);
  return ix0 + v * (ix1 - ix0);
}

/**
 * Fractal brownian motion / ridged multifractal field.
 *
 *   periodX / periodY  lattice period (integers). Different X and Y
 *                      periods give anisotropy - that is how wood
 *                      grain and brushed metal are made.
 *   ridged             1-|n| squared per octave: sharp creases.
 *   warpX / warpY      domain warping source fields.
 */
function fbmField(size, o) {
  const perm = o.perm;
  const periodX = o.periodX | 0;
  const periodY = (o.periodY === undefined ? o.periodX : o.periodY) | 0;
  const octaves = o.octaves || 4;
  const gain = o.gain === undefined ? 0.5 : o.gain;
  const ridged = o.ridged === true;
  const seedX = o.seedX || 0;
  const seedY = o.seedY || 0;
  const warpX = o.warpX || null;
  const warpY = o.warpY || null;
  const warpAmount = o.warpAmount || 0;

  const out = new Float32Array(size * size);
  const inv = 1 / size;

  for (let y = 0; y < size; y += 1) {
    const v = y * inv;
    const row = y * size;
    for (let x = 0; x < size; x += 1) {
      const i = row + x;
      const u = x * inv;
      let bx = u * periodX + seedX;
      let by = v * periodY + seedY;
      if (warpX !== null) {
        bx += warpX[i] * warpAmount;
        by += warpY[i] * warpAmount;
      }
      let amp = 1;
      let sum = 0;
      let norm = 0;
      let sx = bx;
      let sy = by;
      let px = periodX;
      let py = periodY;
      for (let oct = 0; oct < octaves; oct += 1) {
        let n = noise2(sx, sy, px, py, perm);
        if (ridged) { n = 1 - (n < 0 ? -n : n); n *= n; }
        sum += n * amp;
        norm += amp;
        amp *= gain;
        sx += sx; sy += sy; px += px; py += py;
      }
      out[i] = sum / norm;
    }
  }
  return out;
}

/** Bilinear, wrap-aware upsample. Used to build low-frequency fields cheaply. */
function resampleWrap(src, srcSize, dstSize) {
  const out = new Float32Array(dstSize * dstSize);
  const scale = srcSize / dstSize;
  for (let y = 0; y < dstSize; y += 1) {
    const sy = (y + 0.5) * scale - 0.5;
    const yi = Math.floor(sy);
    const fy = sy - yi;
    let ya = yi % srcSize; if (ya < 0) ya += srcSize;
    const yb = (ya + 1) % srcSize;
    const rowA = ya * srcSize;
    const rowB = yb * srcSize;
    for (let x = 0; x < dstSize; x += 1) {
      const sx = (x + 0.5) * scale - 0.5;
      const xi = Math.floor(sx);
      const fx = sx - xi;
      let xa = xi % srcSize; if (xa < 0) xa += srcSize;
      const xb = (xa + 1) % srcSize;
      const top = src[rowA + xa] + (src[rowA + xb] - src[rowA + xa]) * fx;
      const bot = src[rowB + xa] + (src[rowB + xb] - src[rowB + xa]) * fx;
      out[y * dstSize + x] = top + (bot - top) * fy;
    }
  }
  return out;
}

/** Low-frequency fBm: bake small, upsample. Identical result, a lot cheaper. */
function lowField(size, div, o) {
  const small = Math.max(16, Math.floor(size / div));
  const src = fbmField(small, o);
  return small === size ? src : resampleWrap(src, small, size);
}

/**
 * Tileable Worley / cellular noise.
 * Returns F1 and F2 distances (in cell units) plus the id of the
 * nearest feature point, which is what lets every pebble get its
 * own colour and every moss shoot its own height.
 */
function worleyField(size, o) {
  const cellsX = o.cellsX | 0;
  const cellsY = (o.cellsY === undefined ? o.cellsX : o.cellsY) | 0;
  const jitter = o.jitter === undefined ? 0.9 : o.jitter;
  const seed = o.seed || 0;
  const warpX = o.warpX || null;
  const warpY = o.warpY || null;
  const warpAmount = o.warpAmount || 0;

  const count = cellsX * cellsY;
  const fpx = new Float32Array(count);
  const fpy = new Float32Array(count);
  for (let cy = 0; cy < cellsY; cy += 1) {
    for (let cx = 0; cx < cellsX; cx += 1) {
      const c = cy * cellsX + cx;
      fpx[c] = cx + 0.5 + (hash01(cx * 2 + 1, cy * 2 + 1, seed * 13 + 3) - 0.5) * jitter;
      fpy[c] = cy + 0.5 + (hash01(cx * 2 + 7, cy * 2 + 5, seed * 13 + 97) - 0.5) * jitter;
    }
  }

  const f1 = new Float32Array(size * size);
  const f2 = new Float32Array(size * size);
  const id = new Int32Array(size * size);
  const inv = 1 / size;

  for (let y = 0; y < size; y += 1) {
    const row = y * size;
    const vy = y * inv * cellsY;
    for (let x = 0; x < size; x += 1) {
      const i = row + x;
      let px = x * inv * cellsX;
      let py = vy;
      if (warpX !== null) {
        px += warpX[i] * warpAmount;
        py += warpY[i] * warpAmount;
      }
      const cx0 = Math.floor(px);
      const cy0 = Math.floor(py);
      let b1 = 1e9;
      let b2 = 1e9;
      let bid = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const cy = cy0 + dy;
        let wy = cy % cellsY; if (wy < 0) wy += cellsY;
        const baseY = cy - wy;
        const rowC = wy * cellsX;
        for (let dx = -1; dx <= 1; dx += 1) {
          const cx = cx0 + dx;
          let wx = cx % cellsX; if (wx < 0) wx += cellsX;
          const c = rowC + wx;
          const ddx = fpx[c] + (cx - wx) - px;
          const ddy = fpy[c] + baseY - py;
          const d = Math.sqrt(ddx * ddx + ddy * ddy);
          if (d < b1) { b2 = b1; b1 = d; bid = c; }
          else if (d < b2) { b2 = d; }
        }
      }
      f1[i] = b1;
      f2[i] = b2;
      id[i] = bid;
    }
  }
  return { f1, f2, id };
}

/* ==========================================================
   3. Field operations
   ========================================================== */

/** Separable box blur with wraparound, O(n) in the radius. */
function blurWrap(src, size, radius) {
  const n = size * size;
  const tmp = new Float32Array(n);
  const out = new Float32Array(n);
  const w = radius * 2 + 1;
  const invW = 1 / w;

  for (let y = 0; y < size; y += 1) {
    const row = y * size;
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) {
      let x = k % size; if (x < 0) x += size;
      sum += src[row + x];
    }
    for (let x = 0; x < size; x += 1) {
      tmp[row + x] = sum * invW;
      let xa = (x - radius) % size; if (xa < 0) xa += size;
      const xb = (x + radius + 1) % size;
      sum += src[row + xb] - src[row + xa];
    }
  }

  for (let x = 0; x < size; x += 1) {
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) {
      let y = k % size; if (y < 0) y += size;
      sum += tmp[y * size + x];
    }
    for (let y = 0; y < size; y += 1) {
      out[y * size + x] = sum * invW;
      let ya = (y - radius) % size; if (ya < 0) ya += size;
      const yb = (y + radius + 1) % size;
      sum += tmp[yb * size + x] - tmp[ya * size + x];
    }
  }
  return out;
}

/**
 * Ambient occlusion from the height field.
 *
 * Two-scale cavity: how far a texel sits below its local mean at a
 * tight radius (crevice detail) and a wide radius (broad shadowing).
 * Self-normalising against the RMS of the signal so one strength
 * value behaves the same on flat concrete and chunky gravel.
 */
function cavityAO(height, size, strength, floorValue) {
  const n = size * size;
  const near = blurWrap(height, size, Math.max(1, Math.round(size / 220)));
  const far = blurWrap(height, size, Math.max(2, Math.round(size / 34)));

  let sumSq = 0;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const v = (near[i] - height[i]) * 0.55 + (far[i] - height[i]) * 0.45;
    d[i] = v;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / n) || 1e-6;
  const scale = 1 / (2.1 * rms);

  const ao = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const occ = clamp01(d[i] * scale);
    ao[i] = clamp(1 - occ * strength, floorValue, 1);
  }
  return ao;
}

/* ==========================================================
   4. Canvas + texture plumbing
   ========================================================== */

let canvasKind = "unknown";

function makeCanvas(size) {
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const c = new OffscreenCanvas(size, size);
      if (c.getContext("2d")) {
        canvasKind = "OffscreenCanvas";
        return c;
      }
    } catch (error) {
      /* fall through to the DOM canvas */
    }
  }
  canvasKind = "HTMLCanvasElement";
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return c;
}

/* ==========================================================
   5. Map builders
   ========================================================== */

function buildAlbedoBytes(size, r, g, b) {
  const n = size * size;
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    data[o] = toSrgbByte(r[i]);
    data[o + 1] = toSrgbByte(g[i]);
    data[o + 2] = toSrgbByte(b[i]);
    data[o + 3] = 255;
  }
  return data;
}

/**
 * Tangent-space normal map from the height field, 3x3 Sobel with wrap.
 *
 * Convention check, because this is where normal maps go wrong:
 *   - Three builds the TBN from the UV derivatives, so R is the
 *     component along +U and G the component along +V.
 *   - The perturbed normal of a height field is (-dh/du, -dh/dv, 1).
 *   - CanvasTexture uploads with flipY = true, so image row 0 is v = 1,
 *     which means dh/dv = -dh/drow. The two negatives cancel and G
 *     ends up as +dh/drow. (OpenGL-style green-up normal map.)
 *
 * `strength` is resolution independent: the per-texel gradient is
 * scaled by size/1024 so a 512 and a 2048 bake look identical.
 *
 * The alpha channel carries the raw height. Nothing samples it today,
 * but RGBA8 is uploaded either way so it is free storage for whoever
 * wants parallax or displacement later.
 */
function buildNormalBytes(size, height, strength) {
  const data = new Uint8ClampedArray(size * size * 4);
  const k = strength * (size / 1024) * 0.125;
  for (let y = 0; y < size; y += 1) {
    const ym = (y === 0 ? size - 1 : y - 1) * size;
    const yc = y * size;
    const yp = (y === size - 1 ? 0 : y + 1) * size;
    for (let x = 0; x < size; x += 1) {
      const xm = x === 0 ? size - 1 : x - 1;
      const xp = x === size - 1 ? 0 : x + 1;

      const h00 = height[ym + xm], h10 = height[ym + x], h20 = height[ym + xp];
      const h01 = height[yc + xm], h21 = height[yc + xp];
      const h02 = height[yp + xm], h12 = height[yp + x], h22 = height[yp + xp];

      const gx = (h20 + 2 * h21 + h22) - (h00 + 2 * h01 + h02);
      const gy = (h02 + 2 * h12 + h22) - (h00 + 2 * h10 + h20);

      const nx = -gx * k;
      const ny = gy * k;
      const invLen = 1 / Math.sqrt(nx * nx + ny * ny + 1);

      const o = (yc + x) * 4;
      data[o] = (nx * invLen * 0.5 + 0.5) * 255;
      data[o + 1] = (ny * invLen * 0.5 + 0.5) * 255;
      data[o + 2] = (invLen * 0.5 + 0.5) * 255;
      data[o + 3] = clamp01(height[yc + x]) * 255;
    }
  }
  return data;
}

/**
 * A normal map calibrated to an ANGLE instead of to an arbitrary strength.
 *
 * `normalStrength` is a fine knob for surface texture that only has to look
 * bumpy, but it is useless when the question is "will this surface catch the
 * sun". That question has a number attached to it: on the LEGO brick, no face
 * is closer than 40 degrees to the specular lobe (measured: top 57, front 40,
 * right 69), so a normal that wobbles by five degrees can never produce a
 * highlight no matter how strong the light is.
 *
 * Each layer is a (height field, target slope) pair. The builder measures the
 * gradient magnitude of that layer at `percentile` and scales it so that
 * gradient lands exactly on tan(target). Layers are then summed as tangent
 * SLOPES before the normal is normalised, which is the correct combination
 * for a stack of surface relief and keeps each layer's angle meaningful.
 *
 * Alpha carries the first layer's height, same as buildNormalBytes.
 */
function buildSlopeNormalBytes(size, layers) {
  const n = size * size;
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const stats = [];

  for (const layer of layers) {
    const height = layer.height;
    const gx = new Float32Array(n);
    const gy = new Float32Array(n);
    for (let y = 0; y < size; y += 1) {
      const ym = (y === 0 ? size - 1 : y - 1) * size;
      const yc = y * size;
      const yp = (y === size - 1 ? 0 : y + 1) * size;
      for (let x = 0; x < size; x += 1) {
        const xm = x === 0 ? size - 1 : x - 1;
        const xp = x === size - 1 ? 0 : x + 1;
        const h00 = height[ym + xm], h10 = height[ym + x], h20 = height[ym + xp];
        const h01 = height[yc + xm], h21 = height[yc + xp];
        const h02 = height[yp + xm], h12 = height[yp + x], h22 = height[yp + xp];
        gx[yc + x] = (h20 + 2 * h21 + h22) - (h00 + 2 * h01 + h02);
        gy[yc + x] = (h02 + 2 * h12 + h22) - (h00 + 2 * h10 + h20);
      }
    }

    // Percentile of gradient magnitude, subsampled. The mean is the wrong
    // statistic: most texels of any surface are flat, so calibrating on the
    // mean makes the interesting minority absurdly steep.
    const step = Math.max(1, Math.floor(n / 24000));
    const mags = [];
    for (let i = 0; i < n; i += step) mags.push(Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]));
    mags.sort((a, b) => a - b);
    const pct = layer.percentile === undefined ? 0.92 : layer.percentile;
    const ref = mags[Math.min(mags.length - 1, Math.floor(mags.length * pct))] || 1e-6;
    const k = Math.tan((layer.deg * Math.PI) / 180) / Math.max(ref, 1e-6);
    for (let i = 0; i < n; i += 1) { sx[i] += gx[i] * k; sy[i] += gy[i] * k; }
    stats.push({ deg: layer.deg, refGradient: Number(ref.toFixed(5)) });
  }

  const base = layers[0].height;
  const data = new Uint8ClampedArray(n * 4);
  let slopeSum = 0;
  for (let i = 0; i < n; i += 1) {
    const nx = -sx[i];
    const ny = sy[i];
    const invLen = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    slopeSum += Math.acos(clamp01(invLen));
    const o = i * 4;
    data[o] = (nx * invLen * 0.5 + 0.5) * 255;
    data[o + 1] = (ny * invLen * 0.5 + 0.5) * 255;
    data[o + 2] = (invLen * 0.5 + 0.5) * 255;
    data[o + 3] = clamp01(base[i]) * 255;
  }
  return { data, meanSlopeDeg: Number(((slopeSum / n) * 180 / Math.PI).toFixed(1)), layers: stats };
}

function buildOrmBytes(size, ao, rough, metal) {
  const n = size * size;
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    data[o] = clamp01(ao[i]) * 255;
    data[o + 1] = clamp01(rough[i]) * 255;
    data[o + 2] = metal ? clamp01(metal[i]) * 255 : 0;
    data[o + 3] = 255;
  }
  return data;
}

/* ==========================================================
   6. Shader extensions
   ------------------------------------------------------------
   Optional, string-guarded injections: if a future Three.js
   renames a chunk we skip the feature instead of producing a
   broken shader.

   macro        - the anti-tiling system (see below).
   crevice      - the baked cavity map darkens albedo, not only
                  indirect light. Real dirt collects in pits and
                  the eye reads that as depth long before it
                  reads a normal map.
   rough        - a material-owned absolute roughness band. Call
                  sites multiply `roughness` into the map, which
                  can only ever make a surface glossier; some
                  materials need a floor as well as a ceiling.
   foliage      - cheap two-sided back light for thin leaves plus
                  per-instance hue/value jitter. Real transmission
                  costs a full scene resolve per frame and breaks
                  down completely on overlapping instanced blades,
                  so this approximates it for a dot product.

   ------------------------------------------------------------
   ANTI-TILING
   ------------------------------------------------------------
   A tiled texture gives itself away twice over: the pattern
   repeats, and everything in it is the same size. Fixing only the
   repeat still leaves ground that reads as "one stipple noise at
   one world scale".

   So the macro pass samples one shared low-frequency map three
   times, at three scales and three rotations. Rotated lattices
   are incommensurate, so the composite has no period a viewer can
   lock onto, and the three scales give real layering:

       octave A   scale s          broad albedo patches
       octave B   scale s * 3.1    colour variation, rotated 30 deg
       octave C   scale s * 8.6    roughness breakup, rotated 107 deg

   Value and colour are driven by *different* octave pairs on
   purpose. If one field drives both, the bright patches and the
   warm patches coincide and the eye reads the result as shading
   rather than as two different materials mixed together.

   On top of that, `shuffle` samples the material's own albedo a
   second time - rotated, at a different scale - and cross-fades
   between the two copies under a low-frequency mask. Two
   incommensurate copies of the same stochastic texture never
   repeat together, which kills the last of the visible stamp for
   the price of one extra fetch.
   ========================================================== */

const shaderConfig = new WeakMap();

/* cos/sin pairs. Angles chosen to be mutually irrational-ish so no
   two octaves ever line back up inside the visible range. */
const TS_ROT_B = "vec2( 0.86320, 0.50485 )";   //  30.4 deg
const TS_ROT_C = "vec2( -0.28366, 0.95892 )";  // 106.5 deg
const TS_ROT_D = "vec2( 0.54030, 0.84147 )";   //  57.3 deg

const TS_ROT_FN =
  "vec2 tsRot( vec2 p, vec2 cs ) { return vec2( p.x * cs.x - p.y * cs.y, p.x * cs.y + p.y * cs.x ); }";

const TS_SEED_FN =
  "float tsSeed( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }";

/* Hash + value noise for the crystalline facet pass. Kept to one hash
   function so the whole block costs 8 hashes per noise octave and nothing
   else; it only ever compiles into flat-shaded materials. */
const TS_HASH_FN = [
  "float tsH13( vec3 p ) {",
  "  p = fract( p * 0.1031 );",
  "  p += dot( p, p.zyx + 31.32 );",
  "  return fract( ( p.x + p.y ) * p.z );",
  "}",
  "float tsVN( vec3 p ) {",
  "  vec3 i = floor( p );",
  "  vec3 f = fract( p );",
  "  f = f * f * ( 3.0 - 2.0 * f );",
  "  float a = mix( tsH13( i ), tsH13( i + vec3( 1.0, 0.0, 0.0 ) ), f.x );",
  "  float b = mix( tsH13( i + vec3( 0.0, 1.0, 0.0 ) ), tsH13( i + vec3( 1.0, 1.0, 0.0 ) ), f.x );",
  "  float c = mix( tsH13( i + vec3( 0.0, 0.0, 1.0 ) ), tsH13( i + vec3( 1.0, 0.0, 1.0 ) ), f.x );",
  "  float d = mix( tsH13( i + vec3( 0.0, 1.0, 1.0 ) ), tsH13( i + vec3( 1.0, 1.0, 1.0 ) ), f.x );",
  "  return mix( mix( a, b, f.y ), mix( c, d, f.y ), f.z );",
  "}",
  "",
].join("\n");

/* World position, replicating three's own instancing/batching chain so the
   value survives InstancedMesh. Injected after project_vertex, where
   `transformed` is final. */
const TS_WORLDPOS_VERT = [
  "{",
  "  vec4 tsWp = vec4( transformed, 1.0 );",
  "  #ifdef USE_BATCHING",
  "    tsWp = batchingMatrix * tsWp;",
  "  #endif",
  "  #ifdef USE_INSTANCING",
  "    tsWp = instanceMatrix * tsWp;",
  "  #endif",
  "  vTsWPos = ( modelMatrix * tsWp ).xyz;",
  "}",
].join("\n");

function tsimOnBeforeCompile(shader) {
  const cfg = shaderConfig.get(this);
  if (!cfg) return;

  let vertHead = "";
  let fragHead = "";
  let frag = shader.fragmentShader;
  let vert = shader.vertexShader;

  /* ---------------- macro / crevice / shuffle ---------------- */
  const canMacro =
    cfg.macro && frag.includes("#include <map_fragment>") && frag.includes("#include <roughnessmap_fragment>");

  if (canMacro) {
    const m = cfg.macro;
    shader.uniforms.tsMacroMap = { value: m.map };
    shader.uniforms.tsMacroScale = { value: m.scale };
    shader.uniforms.tsMacroStrength = { value: m.strength };
    shader.uniforms.tsMacroMix = { value: m.mix };
    fragHead += [
      "uniform sampler2D tsMacroMap;",
      "uniform vec4 tsMacroScale;",
      "uniform vec3 tsMacroStrength;",
      "uniform vec2 tsMacroMix;",
      TS_ROT_FN,
      "",
    ].join("\n");

    const apply = [
      "diffuseColor.rgb *= 1.0 + tsValue * tsMacroStrength.x;",
      "diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 1.26, 1.02, 0.70 ), tsWarm * tsMacroStrength.y );",
    ];
    if (m.shuffle > 0) {
      // One extra albedo fetch, rotated and rescaled, cross-faded under a
      // low-frequency mask. The mask is deliberately steep: a soft blend
      // would average two copies of the same noise and flatten its contrast.
      apply.unshift(
        `vec3 tsAlt = texture2D( map, tsRot( tsUv, ${TS_ROT_D} ) * tsMacroScale.w + vec2( 0.29, 0.61 ) ).rgb;`,
        "diffuseColor.rgb = mix( diffuseColor.rgb, tsAlt, smoothstep( 0.36, 0.64, tsMacroB.r ) * tsMacroMix.x );"
      );
    }
    if (m.crevice > 0) {
      apply.push(
        "#ifdef USE_AOMAP",
        "  diffuseColor.rgb *= mix( 1.0, texture2D( aoMap, vAoMapUv ).r, tsMacroMix.y );",
        "#endif"
      );
    }

    // The whole pass hangs off vMapUv, which only exists with USE_MAP. Guard
    // it rather than assume: make() can hand a material to a call site that
    // strips the map, and a shader that fails to compile takes the frame with
    // it. tsRough is declared outside so the roughness patch always links.
    frag = frag.replace(
      "#include <map_fragment>",
      [
        "float tsValue = 0.0;",
        "float tsWarm = 0.0;",
        "float tsRough = 0.0;",
        "#ifdef USE_MAP",
        "vec2 tsUv = vMapUv;",
        "vec3 tsMacroA = texture2D( tsMacroMap, tsUv * tsMacroScale.x ).rgb;",
        `vec3 tsMacroB = texture2D( tsMacroMap, tsRot( tsUv, ${TS_ROT_B} ) * tsMacroScale.y + vec2( 0.37, 0.71 ) ).rgb;`,
        `vec3 tsMacroC = texture2D( tsMacroMap, tsRot( tsUv, ${TS_ROT_C} ) * tsMacroScale.z + vec2( 0.13, 0.59 ) ).rgb;`,
        "tsValue = ( tsMacroA.r - 0.5 ) + ( tsMacroB.r - 0.5 ) * 0.62 + ( tsMacroC.r - 0.5 ) * 0.34;",
        "tsWarm = ( tsMacroB.g - 0.5 ) + ( tsMacroA.g - 0.5 ) * 0.55;",
        "tsRough = ( tsMacroA.b - 0.5 ) * 0.65 + ( tsMacroC.b - 0.5 );",
        "#endif",
        "#include <map_fragment>",
        "#ifdef USE_MAP",
        ...apply,
        "#endif",
      ].join("\n")
    );
  }

  /* ---------------- crystalline facets ----------------

     A flat-shaded facet is a plane, and a plane has an exact, camera
     independent identity: its normal, plus its distance from the origin
     along that normal. Both are constant over the whole facet, so
     hash(normal, offset) is a stable per-facet seed that costs no extra
     attribute, no extra draw call and no per-instance data.

     Everything here is inside `#ifdef FLAT_SHADED`. That is not a
     convenience: the same per-facet hash on a smooth-shaded mesh would
     hash per TRIANGLE and shatter a curved surface into blotches. The
     glazed pot and the terracotta shard share this material and are
     smooth-shaded, so the define is what keeps them out of it.
     ------------------------------------------------------------------ */
  const facetLines = [];
  const facet = cfg.facet;
  const canFacet =
    facet &&
    vert.includes("#include <project_vertex>") &&
    frag.includes("#include <color_fragment>");

  if (canFacet) {
    shader.uniforms.tsFacet = { value: facet.jitter };
    shader.uniforms.tsFacetWarm = { value: facet.warm };
    shader.uniforms.tsFacetCool = { value: facet.cool };
    shader.uniforms.tsFacetCloud = { value: facet.cloud };

    vertHead += "varying vec3 vTsWPos;\n";
    fragHead +=
      "varying vec3 vTsWPos;\nuniform vec4 tsFacet;\nuniform vec3 tsFacetWarm;\n" +
      "uniform vec3 tsFacetCool;\nuniform vec4 tsFacetCloud;\n" + TS_HASH_FN;

    vert = vert.replace(
      "#include <project_vertex>",
      ["#include <project_vertex>", TS_WORLDPOS_VERT].join("\n")
    );

    frag = frag.replace(
      "#include <color_fragment>",
      [
        "#include <color_fragment>",
        "vec3 tsFacetN = vec3( 0.0, 1.0, 0.0 );",
        "float tsFacetLift = 0.0;",
        "float tsFacetRough = 0.0;",
        "vec2 tsFacetTilt = vec2( 0.0 );",
        "#ifdef FLAT_SHADED",
        "{",
        // The facet plane. dFdx/dFdy of a world position are two edge vectors
        // of the triangle, so their cross product is the true geometric
        // normal - no tangent frame and no extra varying needed.
        "  vec3 tsE1 = dFdx( vTsWPos );",
        "  vec3 tsE2 = dFdy( vTsWPos );",
        "  tsFacetN = normalize( cross( tsE1, tsE2 ) );",
        "  float tsPlane = dot( tsFacetN, vTsWPos );",
        // The key has to come out of a CONTINUOUS function, not a raw hash.
        // tsFacetN and tsPlane are constant over a planar facet in exact
        // arithmetic only: they are built from coarse derivatives, which are
        // evaluated per 2x2 quad, so they carry a few ULPs of jitter. Feeding
        // that into fract(sin(...)) - a deliberately chaotic function - turned
        // every crystal into a 2x2 dither pattern. Value noise maps a tiny
        // input wobble to a tiny output wobble, which is the whole point.
        "  vec3 tsKeySrc = vec3( tsFacetN.xy * 3.7, tsPlane * 0.09 );",
        "  float tsK1 = tsVN( tsKeySrc );",
        "  float tsK2 = tsVN( tsKeySrc + 19.31 );",
        "  float tsK3 = tsVN( tsKeySrc + 47.07 );",
        // Cloudiness inside the facet. Sugar is not glass: it is a milky
        // aggregate, and the streaks are what stop a facet being one number.
        //
        // Procedural noise has no mip chain, so the fine octave has to be
        // faded out by hand once one cycle drops below a pixel or the whole
        // scatter stipples. tsFoot is the world-space size of one pixel here;
        // when it approaches the noise period, the octave is over.
        "  float tsFoot = ( abs( tsE1.x ) + abs( tsE1.y ) + abs( tsE1.z )",
        "    + abs( tsE2.x ) + abs( tsE2.y ) + abs( tsE2.z ) ) * 0.5;",
        "  float tsLodA = 1.0 - smoothstep( 0.30, 0.95, tsFoot * tsFacetCloud.x );",
        "  float tsLodB = 1.0 - smoothstep( 0.30, 0.95, tsFoot * tsFacetCloud.x * 3.7 );",
        "  float tsCloud = tsVN( vTsWPos * tsFacetCloud.x ) * tsLodA;",
        "  tsCloud = mix( tsCloud, tsVN( vTsWPos * tsFacetCloud.x * 3.7 ) * tsLodB, 0.34 );",
        "  tsCloud = ( tsCloud - 0.5 * max( tsLodA, tsLodB ) ) * 2.0;",
        // Per-facet value spread, then the cloud on top of it.
        "  tsFacetLift = ( tsK1 - 0.5 ) * 2.0 * tsFacet.x + tsCloud * tsFacetCloud.y;",
        "  diffuseColor.rgb *= max( 0.0, 1.0 + tsFacetLift );",
        // Per-facet hue. Two directions from neutral, never one, or the
        // heap reads as one colour with a brightness ramp on it.
        "  float tsHue = ( tsK2 - 0.5 ) * 2.0;",
        "  vec3 tsTint = tsHue >= 0.0",
        "    ? mix( vec3( 1.0 ), tsFacetWarm, tsHue )",
        "    : mix( vec3( 1.0 ), tsFacetCool, -tsHue );",
        "  diffuseColor.rgb *= mix( vec3( 1.0 ), tsTint, tsFacet.y );",
        "  tsFacetRough = ( tsK3 - 0.5 ) * 2.0 * tsFacet.z + tsCloud * tsFacetCloud.z;",
        // The tilt is chosen here and applied to the normal further down.
        "  tsFacetTilt = vec2( tsK2 * 6.2831853, ( tsK3 - 0.5 ) * 2.0 * tsFacet.w );",
        "}",
        "#endif",
      ].join("\n")
    );

    facetLines.push("roughnessFactor = clamp( roughnessFactor + tsFacetRough, 0.02, 1.0 );");
  }

  /* ---------------- edge wear ----------------

     "Worn through" is not a colour, it is a CORRELATION: where a surface has
     been rubbed, it is simultaneously brighter (the film is thinner or gone),
     smoother (the asperities are polished off) and slightly desaturated. Where
     it has not, dirt has collected and it is darker and rougher. Driving all
     three off one mask is what makes the eye read "this object has been
     handled" instead of "this object has a texture on it".

     The mask is the GLOSS relief's height (its alpha channel), not the base
     normal's. The base height field is texel-scale noise - peel cells, sand
     grains - and wear driven off that is just more speckle. The gloss swell is
     the broad, panel-scale waviness of the moulded part, so its high ground is
     where a real object rubs against the floor of a shed.
     ------------------------------------------------------------------ */
  const wearLines = [];
  if (cfg.wear && frag.includes("#include <color_fragment>")) {
    shader.uniforms.tsWear = { value: cfg.wear.amount };
    shader.uniforms.tsWearTint = { value: cfg.wear.tint };
    fragHead += "uniform vec4 tsWear;\nuniform vec3 tsWearTint;\n";

    frag = frag.replace(
      "#include <color_fragment>",
      [
        "#include <color_fragment>",
        "float tsWorn = 0.0;",
        "#ifdef USE_CLEARCOAT_NORMALMAP",
        "  tsWorn = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).a - 0.5;",
        "#elif defined( USE_NORMALMAP )",
        "  tsWorn = texture2D( normalMap, vNormalMapUv ).a - 0.5;",
        "#endif",
        // Signed, so the low ground darkens by as much as the high ground
        // lifts and the object keeps its overall value.
        "diffuseColor.rgb *= 1.0 + tsWorn * tsWear.x;",
        "diffuseColor.rgb = mix( diffuseColor.rgb, tsWearTint * dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ),",
        "  clamp( tsWorn, 0.0, 1.0 ) * tsWear.y );",
      ].join("\n")
    );

    wearLines.push("roughnessFactor = clamp( roughnessFactor - tsWorn * tsWear.z, 0.02, 1.0 );");
  }

  /* ---------------- absolute roughness band ---------------- */
  const roughLines = [];
  if (canMacro) {
    roughLines.push("roughnessFactor = clamp( roughnessFactor + tsRough * tsMacroStrength.z, 0.045, 1.0 );");
  }
  roughLines.push(...wearLines);
  roughLines.push(...facetLines);
  if (cfg.rough) {
    shader.uniforms.tsRoughBand = { value: cfg.rough };
    fragHead += "uniform vec4 tsRoughBand;\n";
    roughLines.push(
      "roughnessFactor = clamp( roughnessFactor * tsRoughBand.x + tsRoughBand.y, tsRoughBand.z, tsRoughBand.w );"
    );
  }
  if (roughLines.length && frag.includes("#include <roughnessmap_fragment>")) {
    frag = frag.replace(
      "#include <roughnessmap_fragment>",
      ["#include <roughnessmap_fragment>", ...roughLines].join("\n")
    );
  }

  /* ---------------- facet tilt ----------------

     Applied after the normal maps, and built in WORLD space before being
     rotated into view space. Building the tangent frame from the view-space
     normal instead would make each facet's tilt direction rotate with the
     camera, and a scatter of a few thousand crystals would crawl while the
     player walked past it.

     This is what actually turns the heap into sugar: every grain is a real
     crystal with faces at slightly different angles, so at any moment a
     handful of them are aimed at the sun and the rest are not.
     ------------------------------------------------------------------ */
  if (canFacet && frag.includes("#include <normal_fragment_maps>")) {
    const tiltBody = [
      "#ifdef FLAT_SHADED",
      "{",
      "  vec3 tsUp = abs( tsFacetN.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );",
      "  vec3 tsT = normalize( cross( tsFacetN, tsUp ) );",
      "  vec3 tsB = cross( tsFacetN, tsT );",
      "  vec3 tsOff = ( tsT * cos( tsFacetTilt.x ) + tsB * sin( tsFacetTilt.x ) ) * tsFacetTilt.y;",
      "  vec3 tsOffView = ( viewMatrix * vec4( tsOff, 0.0 ) ).xyz;",
      "  normal = normalize( normal + tsOffView );",
      "  #ifdef USE_CLEARCOAT",
      "    clearcoatNormal = normalize( clearcoatNormal + tsOffView );",
      "  #endif",
      "}",
      "#endif",
    ].join("\n");

    // Prefer the clearcoat anchor so both normals exist; fall back to the
    // base normal anchor if a future Three drops the clearcoat chunk.
    if (frag.includes("#include <clearcoat_normal_fragment_maps>")) {
      frag = frag.replace(
        "#include <clearcoat_normal_fragment_maps>",
        ["#include <clearcoat_normal_fragment_maps>", tiltBody].join("\n")
      );
    } else {
      frag = frag.replace(
        "#include <normal_fragment_maps>",
        ["#include <normal_fragment_maps>", tiltBody.replace(/#ifdef USE_CLEARCOAT[\s\S]*?#endif\n/, "")].join("\n")
      );
    }
  }

  /* ---------------- foliage: hue jitter + back light ---------------- */
  const fol = cfg.foliage;
  if (fol && vert.includes("#include <begin_vertex>") && frag.includes("#include <color_fragment>")) {
    shader.uniforms.tsLeafTrans = { value: fol.strength };
    shader.uniforms.tsLeafTint = { value: fol.tint };
    shader.uniforms.tsLeafJitter = { value: fol.jitter };

    vertHead += `varying float vTsSeed;\n${TS_SEED_FN}\n`;
    fragHead += "varying float vTsSeed;\nuniform float tsLeafTrans;\nuniform vec3 tsLeafTint;\nuniform vec2 tsLeafJitter;\n";

    vert = vert.replace(
      "#include <begin_vertex>",
      [
        "#include <begin_vertex>",
        "#ifdef USE_INSTANCING",
        "  vTsSeed = tsSeed( instanceMatrix[ 3 ].xz );",
        "#else",
        "  vTsSeed = tsSeed( modelMatrix[ 3 ].xz );",
        "#endif",
      ].join("\n")
    );

    // Per-instance hue AND value, both continuous. Two clusters of colour
    // read as two materials; a continuous spread reads as a lawn.
    frag = frag.replace(
      "#include <color_fragment>",
      [
        "#include <color_fragment>",
        "{",
        "  float tsH = vTsSeed * 2.0 - 1.0;",
        "  vec3 tsStraw = vec3( 1.34, 1.02, 0.48 );",
        "  vec3 tsCool = vec3( 0.70, 1.00, 0.88 );",
        "  vec3 tsHue = tsH >= 0.0 ? mix( vec3( 1.0 ), tsStraw, tsH ) : mix( vec3( 1.0 ), tsCool, -tsH );",
        "  float tsVal = 1.0 + ( fract( vTsSeed * 7.13 + 0.317 ) - 0.5 ) * 2.0 * tsLeafJitter.y;",
        "  diffuseColor.rgb *= mix( vec3( 1.0 ), tsHue, tsLeafJitter.x ) * tsVal;",
        "}",
      ].join("\n")
    );

    if (frag.includes("#include <opaque_fragment>")) {
      // Chlorophyll filters what passes through a leaf, so transmitted light
      // is MORE saturated than reflected light, never whiter. The rolloff is
      // a uniform scale on the whole vector, so it caps the magnitude without
      // touching the hue - a per-channel clamp would desaturate to white,
      // which is exactly the failure we are fixing.
      frag = frag.replace(
        "#include <opaque_fragment>",
        [
          "#if NUM_DIR_LIGHTS > 0",
          "{",
          "  vec3 tsL = normalize( directionalLights[ 0 ].direction );",
          "  float tsNdL = dot( geometryNormal, tsL );",
          "  float tsBack = clamp( -tsNdL, 0.0, 1.0 );",
          "  float tsThru = pow( clamp( dot( -geometryViewDir, tsL ), 0.0, 1.0 ), 3.0 );",
          // A blade twisted edge-on to the sun gets neither Lambert (N.L ~ 0)
          // nor the back-scatter term (-N.L ~ 0), so it fell through to pure
          // sky ambient - which is blue. That is the chalky pale-blue band a
          // reviewer spotted running along a single blade whose base was
          // saturated olive, at constant distance. This wrap term peaks
          // exactly at the terminator and fills the gap with transmitted
          // green instead of leaving it to the sky.
          "  float tsEdge = pow( 1.0 - abs( tsNdL ), 3.0 );",
          "  vec3 tsTrans = diffuseColor.rgb * tsLeafTint * directionalLights[ 0 ].color",
          "    * ( tsBack * 0.55 + tsThru * 0.85 + tsEdge * 0.70 ) * tsLeafTrans;",
          "  tsTrans /= 1.0 + max( max( tsTrans.r, tsTrans.g ), tsTrans.b ) * 0.85;",
          "  outgoingLight += tsTrans;",
          "}",
          "#endif",
          "#include <opaque_fragment>",
        ].join("\n")
      );
    }
  }

  /* ---------------- substance response ----------------

     Why a hand-rolled lobe instead of "raise envMapIntensity and let GGX do
     it": the angles do not allow it. Measured at the beauty-shot cameras, the
     closest any visible face of the LEGO brick gets to the sun's specular
     half-vector is 38 degrees; the bottle cap skirt, the hose and the pot are
     all in the same band. A GGX lobe wide enough to respond at 38 degrees
     needs roughness above 0.8, at which point the surface is not glossy any
     more. So the sun highlight in this scene is not a dot that lands
     somewhere - it is a broad sheen whose falloff is the material's signature,
     and the exponent is the knob that separates enamel from rubber from
     unglazed clay.

     Two terms, and they answer different questions:

       lobe   - pow( NoH, exponent ). The sun. Exponent is authored per
                substance: ~90 for a fired glaze, ~8 for rubber.
       graze  - the environment specular already sampled by three, scaled up
                at grazing incidence. Every dielectric goes mirror-bright at
                the edge; this is the term that puts a sky-coloured rim on the
                top of the hose coil and the lip of the cap.

     The lobe is driven by irradiance RECOVERED from the diffuse the light
     loop has already accumulated, not by directionalLights[0] directly. That
     value is shadowed, and it is summed over all four cascade lights, so the
     sheen inherits both properties for nothing. A term built from the light
     uniform alone shines straight through shadows, which is the single most
     obvious way a bolted-on specular gives itself away.
     ------------------------------------------------------------------ */
  if (cfg.spec && frag.includes("#include <lights_fragment_end>")) {
    shader.uniforms.tsSpecA = { value: cfg.spec.a };
    shader.uniforms.tsSpecTint = { value: cfg.spec.tint };
    fragHead += "uniform vec4 tsSpecA;\nuniform vec3 tsSpecTint;\n";
    frag = frag.replace(
      "#include <lights_fragment_end>",
      [
        "#include <lights_fragment_end>",
        "{",
        "  float tsNoV = clamp( dot( geometryNormal, geometryViewDir ), 0.0, 1.0 );",
        "  float tsGraze = pow( 1.0 - tsNoV, 5.0 );",
        "  reflectedLight.indirectSpecular *= 1.0 + tsGraze * tsSpecA.w;",
        "#if NUM_DIR_LIGHTS > 0",
        "  {",
        // The gloss relief lives on the clearcoat normal, and it is the only
        // thing in this scene that swings a normal far enough to reach the
        // sun. Reading the base normal here would leave the sheen sitting on
        // a face that is 38 degrees off and never moves.
        "    vec3 tsSN = geometryNormal;",
        "#ifdef USE_CLEARCOAT",
        "    tsSN = clearcoatNormal;",
        "#endif",
        "    vec3 tsSL = normalize( directionalLights[ 0 ].direction );",
        "    vec3 tsSH = normalize( tsSL + geometryViewDir );",
        "    float tsNoH = clamp( dot( tsSN, tsSH ), 0.0, 1.0 );",
        "    float tsLum = dot( reflectedLight.directDiffuse, vec3( 0.2126, 0.7152, 0.0722 ) );",
        "    float tsAlb = max( dot( material.diffuseColor, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.015 );",
        "    float tsIrr = clamp( tsLum * PI / tsAlb, 0.0, 16.0 );",
        // The authored exponent is quoted at roughness 0.25 and then tracks
        // the roughness map, 1/r^2, the way a real lobe does. Two consequences
        // that matter: the sheen breaks up ACROSS one surface instead of
        // coating it evenly, and one material definition can serve two call
        // sites that ask for different roughness - the hose comes out rubber
        // and the brick comes out ABS from the same library entry, because the
        // hose's rib modulation swings the lobe width with it.
        "    float tsR2 = max( material.roughness * material.roughness, 0.0022 );",
        "    float tsExp = clamp( tsSpecA.x * 0.0625 / tsR2, 3.0, 420.0 );",
        // Normalised so sharpening the lobe does not also dim it - otherwise
        // every retune of the shape is a retune of the brightness too and
        // nothing can be compared to anything.
        "    float tsLobe = pow( tsNoH, tsExp ) * ( tsExp + 2.0 ) * 0.0625;",
        "    float tsF = tsSpecA.y + ( 1.0 - tsSpecA.y ) * tsGraze;",
        "    reflectedLight.directSpecular += tsSpecTint * ( tsIrr * tsLobe * tsF * tsSpecA.z );",
        "  }",
        "#endif",
        "}",
      ].join("\n")
    );
  }

  /* ---------------- wrap-around back scatter (non-leaf foliage) ---------------- */
  if (cfg.translucency && frag.includes("#include <lights_fragment_end>")) {
    shader.uniforms.tsBackScatter = { value: cfg.translucency.amount };
    shader.uniforms.tsBackTint = { value: cfg.translucency.tint };
    fragHead += "uniform float tsBackScatter;\nuniform vec3 tsBackTint;\n";
    frag = frag.replace(
      "#include <lights_fragment_end>",
      [
        "#include <lights_fragment_end>",
        "#if ( NUM_DIR_LIGHTS > 0 )",
        "{",
        // Light 0 only. The cascade rig hands us four directional lights that
        // are all the same sun; summing the loop multiplied this term by the
        // cascade count and washed every mossy surface out.
        "  vec3 tsL = normalize( directionalLights[ 0 ].direction );",
        "  float tsWrap = clamp( dot( -geometryViewDir, tsL ), 0.0, 1.0 );",
        "  float tsThin = 1.0 - abs( dot( geometryNormal, geometryViewDir ) ) * 0.55;",
        "  vec3 tsBack = directionalLights[ 0 ].color * pow( tsWrap, 3.0 ) * tsThin;",
        "  reflectedLight.directDiffuse += tsBack * tsBackScatter * tsBackTint * diffuseColor.rgb;",
        "}",
        "#endif",
      ].join("\n")
    );
  }

  shader.fragmentShader = fragHead + frag;
  shader.vertexShader = vertHead + vert;
}

function tsimCacheKey() {
  const cfg = shaderConfig.get(this);
  if (!cfg) return "tsim-plain";
  const m = cfg.macro;
  return [
    "tsim",
    m ? `m${m.shuffle > 0 ? "s" : ""}${m.crevice > 0 ? "c" : ""}` : "",
    cfg.rough ? "r" : "",
    cfg.foliage ? `f${cfg.foliage.strength}` : "",
    cfg.translucency ? "t" : "",
    cfg.facet ? "x" : "",
    cfg.spec ? "p" : "",
    cfg.wear ? "w" : "",
    cfg.detail ? `d${cfg.detail.parallax > 0 ? "p" : ""}` : "",
  ].join("|");
}

function attachShaderConfig(material, cfg) {
  if (!cfg) return material;
  shaderConfig.set(material, cfg);
  material.onBeforeCompile = tsimOnBeforeCompile;
  material.customProgramCacheKey = tsimCacheKey;
  return material;
}

/* ==========================================================
   7. Material generators
   ------------------------------------------------------------
   Every generator returns linear-space channels. Albedo values
   are real-world reflectances: soil sits around 0.05, dry
   concrete around 0.28, fresh paint around 0.5. Nothing is ever
   pure black (0.03 floor) or paper white (0.8 ceiling), because
   nothing in a garden is.
   ========================================================== */

function alloc(n) {
  return {
    height: new Float32Array(n),
    r: new Float32Array(n),
    g: new Float32Array(n),
    b: new Float32Array(n),
    rough: new Float32Array(n),
  };
}

/* ---------------- soil: damp, crumbly, organic ---------------- */
function genSoil(size, perm) {
  const n = size * size;
  const warpA = lowField(size, 4, { periodX: 6, octaves: 3, perm, seedX: 3, seedY: 11 });
  const warpB = lowField(size, 4, { periodX: 6, octaves: 3, perm, seedX: 47, seedY: 5 });

  // Aggregate clumps, then the individual mineral grains inside them.
  const clods = worleyField(size, { cellsX: 8, perm, jitter: 0.98, seed: 2, warpX: warpA, warpY: warpB, warpAmount: 1.15 });
  const grains = worleyField(size, { cellsX: 34, perm, jitter: 1, seed: 8 });
  const detail = fbmField(size, { periodX: 28, octaves: 5, perm, seedX: 13, seedY: 29 });
  const organic = lowField(size, 2, { periodX: 12, octaves: 4, perm, seedX: 71, seedY: 3 });
  const damp = lowField(size, 4, { periodX: 3, octaves: 3, perm, seedX: 5, seedY: 61 });
  // The slowest field in the bake. world.js's terrain shader keeps only the
  // LUMINANCE of this map (it substitutes its own splat hue), so anything
  // that is going to break up the ground at range has to be a value swing,
  // and it has to happen at a scale bigger than a clod.
  const region = lowField(size, 8, { periodX: 2, octaves: 3, perm, seedX: 96, seedY: 34 });

  const out = alloc(n);
  for (let i = 0; i < n; i += 1) {
    const clod = 1 - smoothstep(0.10, 0.55, clods.f1[i]);
    const gid = grains.id[i];
    const gRad = 0.26 + hash01(gid, 5, 3) * 0.17;
    const gt = clamp01(grains.f1[i] / gRad);
    const grain = Math.sqrt(Math.max(0, 1 - gt * gt));
    const det = n01(detail[i]);
    const org = n01(organic[i]);
    const wet = n01(damp[i]);
    const reg = n01(region[i]);

    const h = clamp01(clod * 0.42 + grain * 0.29 + det * 0.16 + org * 0.08 + (reg - 0.5) * 0.10);
    out.height[i] = h;

    // Raised crumbs dry out; hollows stay dark and damp; whole patches of the
    // bed are simply drier than others.
    const dry = clamp01(smoothstep(0.34, 0.86, h) * 0.52 + (1 - wet) * 0.40 + (reg - 0.45) * 0.62);
    let r = lerp(0.040, 0.178, dry);
    let g = lerp(0.026, 0.126, dry);
    let b = lerp(0.017, 0.082, dry);

    // Two distinct mineral populations, both well separated from the matrix.
    // A jitter that stays inside a narrow band around the mean is variation
    // that measures as present and reads as absent.
    const kind = hash01(gid, 17, 9);
    if (kind > 0.78) {
      // pale quartz / sand grain
      const m = grain * smoothstep(0.78, 0.90, kind);
      r = lerp(r, 0.365, m); g = lerp(g, 0.334, m); b = lerp(b, 0.280, m);
    } else if (kind < 0.13) {
      // charred organic fleck
      const m = grain * 0.92;
      r = lerp(r, 0.016, m); g = lerp(g, 0.013, m); b = lerp(b, 0.011, m);
    } else if (kind > 0.60) {
      // rusty iron-stained crumb
      const m = grain * 0.55;
      r = lerp(r, 0.196, m); g = lerp(g, 0.104, m); b = lerp(b, 0.048, m);
    }

    const humus = smoothstep(0.60, 0.93, org) * 0.6;
    r = lerp(r, 0.038, humus); g = lerp(g, 0.027, humus); b = lerp(b, 0.015, humus);

    out.r[i] = r; out.g[i] = g; out.b[i] = b;

    // Damp hollows are markedly glossier than dry crumbs. At 0.97 across the
    // board the specular lobe is too broad to see and soil reads as clay.
    const lowness = smoothstep(0.32, 0.04, h);
    out.rough[i] = clamp(0.93 - lowness * 0.34 * wet - grain * 0.06 - (1 - dry) * 0.10, 0.48, 0.98);
  }
  return out;
}

/* ---------------- gravel: individual stones ---------------- */
function genGravel(size, perm) {
  const n = size * size;
  const warpA = lowField(size, 4, { periodX: 8, octaves: 3, perm, seedX: 17, seedY: 2 });
  const warpB = lowField(size, 4, { periodX: 8, octaves: 3, perm, seedX: 3, seedY: 55 });

  const pebbles = worleyField(size, { cellsX: 7, perm, jitter: 0.95, seed: 5, warpX: warpA, warpY: warpB, warpAmount: 0.55 });
  const chips = worleyField(size, { cellsX: 20, perm, jitter: 1, seed: 21 });
  const micro = fbmField(size, { periodX: 40, octaves: 4, perm, seedX: 9, seedY: 31 });
  const dust = fbmField(size, { periodX: 64, octaves: 3, perm, seedX: 77, seedY: 13 });
  // Beds of gravel are not stirred. Whole corners of one are pale limestone
  // and whole corners are dark flint, and that regional bias is what reads
  // as a real material rather than as five colours shuffled per pebble.
  const lithology = lowField(size, 6, { periodX: 2, octaves: 3, perm, seedX: 52, seedY: 19 });

  // Five believable garden-gravel lithologies, linear reflectance, ordered
  // dark to pale so the regional bias slides continuously along the list.
  const ROCK = [
    [0.070, 0.069, 0.074], // basalt
    [0.112, 0.108, 0.098], // flint
    [0.205, 0.202, 0.190], // grey granite
    [0.245, 0.190, 0.166], // pink granite
    [0.330, 0.296, 0.234], // buff limestone
  ];

  const out = alloc(n);
  for (let i = 0; i < n; i += 1) {
    const id = pebbles.id[i];
    const lith = n01(lithology[i]);
    const rad = 0.31 + hash01(id, 7, 3) * 0.17;
    const t = clamp01(pebbles.f1[i] / rad);
    const dome = Math.sqrt(Math.max(0, 1 - t * t));
    const mic = n01(micro[i]);
    const dst = n01(dust[i]);
    const chipT = clamp01(chips.f1[i] / 0.42);
    const chip = Math.sqrt(Math.max(0, 1 - chipT * chipT));

    // Pebble dome, faceted a little by micro noise; gaps fill with grit.
    const h = clamp01(dome * 0.74 + dome * (mic - 0.5) * 0.16 + (1 - dome) * (chip * 0.13 + dst * 0.07));
    out.height[i] = h;

    // 60% pebble identity, 40% where in the bed it lies.
    const pick = clamp01(hash01(id, 23, 11) * 0.60 + lith * 0.40);
    const rock = ROCK[Math.min(ROCK.length - 1, (pick * ROCK.length) | 0)];
    const shade = 0.74 + mic * 0.52;
    let r = rock[0] * shade;
    let g = rock[1] * shade;
    let b = rock[2] * shade;

    // Mineral speckle inside each stone.
    const fleck = hash01(chips.id[i], 3, 41);
    if (fleck > 0.88) {
      const m = chip * 0.6 * dome;
      r = lerp(r, 0.42, m); g = lerp(g, 0.40, m); b = lerp(b, 0.37, m);
    }

    // Gaps: damp shaded grit, much darker than the stone faces.
    const gap = 1 - smoothstep(0.05, 0.42, dome);
    r = lerp(r, 0.052, gap); g = lerp(g, 0.043, gap); b = lerp(b, 0.033, gap);

    out.r[i] = r; out.g[i] = g; out.b[i] = b;
    out.rough[i] = clamp(lerp(0.94, 0.50 + (1 - mic) * 0.22, dome), 0.42, 0.98);
  }
  return out;
}

/* ---------------- sand: drifts, ripples, grains ----------------
   Three scales again: drift (period 2 across the tile), wind ripples
   (anisotropic, period 3x11) and the individual grains. Sand with only a
   grain layer is the classic "one stipple noise" surface. ---------------- */
function genSand(size, perm) {
  const n = size * size;
  const grains = worleyField(size, { cellsX: 56, perm, jitter: 1, seed: 33 });
  const coarse = worleyField(size, { cellsX: 18, perm, jitter: 1, seed: 12 });
  const drift = lowField(size, 6, { periodX: 2, octaves: 3, perm, seedX: 88, seedY: 41 });
  const ripple = fbmField(size, { periodX: 3, periodY: 11, octaves: 3, perm, seedX: 4, seedY: 8 });
  const fine = fbmField(size, { periodX: 50, octaves: 3, perm, seedX: 61, seedY: 17 });

  const out = alloc(n);
  for (let i = 0; i < n; i += 1) {
    const id = grains.id[i];
    const rad = 0.30 + hash01(id, 11, 7) * 0.16;
    const t = clamp01(grains.f1[i] / rad);
    const dome = Math.sqrt(Math.max(0, 1 - t * t));
    const ct = clamp01(coarse.f1[i] / (0.16 + Math.pow(hash01(coarse.id[i], 3, 7), 2) * 0.30));
    const pebble = (hash01(coarse.id[i], 19, 2) > 0.62 ? 1 : 0) * Math.sqrt(Math.max(0, 1 - ct * ct));
    const dr = n01(drift[i]);
    const rip = n01(ripple[i]);
    const h = clamp01(dome * 0.36 + pebble * 0.22 + rip * 0.24 + dr * 0.22 + n01(fine[i]) * 0.10);
    out.height[i] = h;

    // Drift crests are sun-bleached, troughs hold damp: a wide value range,
    // then per-grain tone on top of it.
    const bleach = smoothstep(0.35, 0.85, dr) * 0.6 + smoothstep(0.4, 0.9, h) * 0.4;
    const tone = (0.72 + hash01(id, 29, 3) * 0.60) * lerp(0.74, 1.22, bleach);
    let r = 0.268 * tone;
    let g = 0.224 * tone;
    let b = 0.162 * tone;
    const kind = hash01(id, 5, 19);
    if (kind > 0.93) { r *= 0.40; g *= 0.39; b *= 0.42; }             // dark mineral grain
    else if (kind < 0.06) { r = lerp(r, 0.44, 0.7); g = lerp(g, 0.42, 0.7); b = lerp(b, 0.38, 0.7); } // shell fleck
    // Coarser grit sits paler and greyer than the fine sand around it.
    r = lerp(r, 0.255, pebble * 0.55); g = lerp(g, 0.238, pebble * 0.55); b = lerp(b, 0.205, pebble * 0.55);

    out.r[i] = r; out.g[i] = g; out.b[i] = b;
    out.rough[i] = clamp(0.90 - dome * 0.10 - pebble * 0.16 - bleach * 0.06, 0.58, 0.98);
  }
  return out;
}

/* ---------------- moss: a cushion of tiny shoots ---------------- */
function genMoss(size, perm) {
  const n = size * size;
  const warpA = lowField(size, 4, { periodX: 5, octaves: 3, perm, seedX: 9, seedY: 44 });
  const warpB = lowField(size, 4, { periodX: 5, octaves: 3, perm, seedX: 66, seedY: 2 });

  const shoots = worleyField(size, { cellsX: 12, perm, jitter: 1, seed: 12, warpX: warpA, warpY: warpB, warpAmount: 0.45 });
  const leaflets = worleyField(size, { cellsX: 38, perm, jitter: 1, seed: 27 });
  const clump = lowField(size, 3, { periodX: 4, octaves: 4, perm, seedX: 21, seedY: 7 });
  const strand = fbmField(size, { periodX: 46, periodY: 46, octaves: 3, perm, ridged: true, seedX: 12, seedY: 3 });

  const out = alloc(n);
  for (let i = 0; i < n; i += 1) {
    const id = shoots.id[i];
    const rad = 0.34 + hash01(id, 3, 13) * 0.20;
    const t = clamp01(shoots.f1[i] / rad);
    const dome = Math.pow(Math.max(0, 1 - t * t), 0.65);
    const lt = clamp01(leaflets.f1[i] / 0.42);
    const leaf = Math.sqrt(Math.max(0, 1 - lt * lt));
    const cl = n01(clump[i]);
    const str = clamp01(strand[i]);

    const h = clamp01(dome * (0.52 + cl * 0.28) + leaf * 0.22 * dome + str * 0.12);
    out.height[i] = h;

    // Tips catch light and go yellow-green; the cushion floor is near black.
    const tip = smoothstep(0.42, 0.92, h);
    const shade = smoothstep(0.30, 0.02, h);
    let r = lerp(0.041, 0.118, tip);
    let g = lerp(0.086, 0.168, tip);
    let b = lerp(0.026, 0.048, tip);
    r = lerp(r, 0.011, shade); g = lerp(g, 0.018, shade); b = lerp(b, 0.010, shade);

    // Patches of dried-out moss.
    const dead = smoothstep(0.74, 0.95, cl) * tip;
    r = lerp(r, 0.145, dead); g = lerp(g, 0.108, dead); b = lerp(b, 0.040, dead);

    out.r[i] = r; out.g[i] = g; out.b[i] = b;
    out.rough[i] = clamp(0.92 - tip * 0.28, 0.55, 0.96);
  }
  return out;
}

/* ---------------- grass blade ---------------- */
function genGrass(size, perm) {
  const n = size * size;
  const fibre = fbmField(size, { periodX: 26, periodY: 3, octaves: 4, perm, seedX: 2, seedY: 19 });
  const blotch = lowField(size, 4, { periodX: 3, periodY: 6, octaves: 3, perm, seedX: 40, seedY: 6 });
  const out = alloc(n);
  const inv = 1 / size;

  for (let y = 0; y < size; y += 1) {
    const v = y * inv;              // 0 = base of the blade, 1 = tip
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const u = x * inv;
      const acrossBlade = Math.abs(u - 0.5) * 2;

      // Longitudinal ribs plus the pronounced central keel.
      const ribs = Math.cos(u * Math.PI * 12) * 0.5 + 0.5;
      const keel = 1 - smoothstep(0.0, 0.16, acrossBlade);
      const fib = n01(fibre[i]);
      const h = clamp01(0.34 + ribs * 0.14 + keel * 0.30 + fib * 0.16 - acrossBlade * 0.12);
      out.height[i] = h;

      // Colour ramps from a yellow-green base through deep green to a dry tip.
      const drying = smoothstep(0.72, 1.0, v);
      const young = smoothstep(0.30, 0.0, v);
      const bl = n01(blotch[i]);
      let r = lerp(0.052, 0.062, bl);
      let g = lerp(0.118, 0.146, bl);
      let bb = lerp(0.028, 0.036, bl);
      r = lerp(r, 0.086, young); g = lerp(g, 0.108, young); bb = lerp(bb, 0.030, young);
      r = lerp(r, 0.186, drying); g = lerp(g, 0.152, drying); bb = lerp(bb, 0.056, drying);
      // The keel is paler, as on a real blade.
      r = lerp(r, r * 1.35, keel); g = lerp(g, g * 1.28, keel); bb = lerp(bb, bb * 1.3, keel);

      out.r[i] = r; out.g[i] = g; out.b[i] = bb;
      out.rough[i] = clamp(0.52 - keel * 0.14 + drying * 0.22, 0.28, 0.82);
    }
  }
  return out;
}

/* ---------------- leaf: veins, blade puckering, sun damage ---------------- */
function genLeaf(size, perm) {
  const n = size * size;
  const cells = worleyField(size, { cellsX: 26, perm, jitter: 1, seed: 44 });
  const mottle = lowField(size, 3, { periodX: 5, octaves: 4, perm, seedX: 8, seedY: 30 });
  const grain = fbmField(size, { periodX: 60, octaves: 3, perm, seedX: 15, seedY: 52 });
  const out = alloc(n);
  const inv = 1 / size;

  for (let y = 0; y < size; y += 1) {
    const v = y * inv;
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const u = x * inv;
      const side = u < 0.5 ? -1 : 1;
      const fromRib = Math.abs(u - 0.5);

      // Midrib.
      const midrib = 1 - smoothstep(0.006, 0.042, fromRib);
      // Secondary veins fan out from the midrib at an angle.
      const s = v * 9 + side * fromRib * 5.2;
      const sec = (1 - smoothstep(0.0, 0.09, Math.abs(s - Math.floor(s) - 0.5))) * smoothstep(0.02, 0.10, fromRib);
      // Tertiary reticulation between the secondaries. Kept faint on purpose:
      // world.js stretches this texture up a grass blade at roughly 15:1, and
      // a strong Voronoi net turns into visible hatching all over the lawn.
      const net = 1 - smoothstep(0.0, 0.055, cells.f2[i] - cells.f1[i]);

      // The reticulation net is the worst offender of the three because it
      // covers the entire blade rather than tracing a few lines.
      const veins = clamp01(midrib + sec * 0.8 + net * 0.05);
      // Blade tissue puckers upward between the veins.
      const pucker = Math.sqrt(Math.max(0, 1 - clamp01(cells.f1[i] / 0.55) ** 2));
      const h = clamp01(0.42 + veins * 0.34 + pucker * 0.10 * (1 - veins) + n01(grain[i]) * 0.07);
      out.height[i] = h;

      const mot = n01(mottle[i]);
      // Healthy chlorophyll green; veins are paler and yellower. A wide
      // mottle range so a leaf has internal colour, not one flat green.
      let r = lerp(0.028, 0.082, mot);
      let g = lerp(0.070, 0.172, mot);
      let b = lerp(0.017, 0.044, mot);
      // Was (0.108, 0.134, 0.044) at weight 0.75 - blue at a third of green,
      // i.e. a yellow-olive. Under a warm key, multiplied by the canopy
      // patch's 1.45, that renders as GOLD: reviews reported bright gold vein
      // dashes and a gold Voronoi net "like chicken wire stretched over the
      // leaf". The gloss was blamed and lowered twice; the gloss was never
      // it, the albedo was. Real veins are a paler, slightly desaturated
      // green than the blade, not a different hue, and they are subtle.
      r = lerp(r, 0.118, veins * 0.42); g = lerp(g, 0.152, veins * 0.42); b = lerp(b, 0.082, veins * 0.42);

      // Sun-scorched blotches towards the edges.
      const scorch = smoothstep(0.72, 0.97, mot) * smoothstep(0.18, 0.46, fromRib);
      r = lerp(r, 0.168, scorch); g = lerp(g, 0.092, scorch); b = lerp(b, 0.026, scorch);

      out.r[i] = r; out.g[i] = g; out.b[i] = b;
      out.rough[i] = clamp(0.36 + veins * 0.16 + scorch * 0.24, 0.26, 0.78);
    }
  }
  return out;
}

/* ---------------- bark: deep vertical fissures + lichen ---------------- */
function genBark(size, perm) {
  const n = size * size;
  const warpA = lowField(size, 4, { periodX: 6, periodY: 4, octaves: 3, perm, seedX: 12, seedY: 4 });
  const warpB = lowField(size, 4, { periodX: 6, periodY: 4, octaves: 3, perm, seedX: 88, seedY: 21 });

  // Anisotropic ridged noise: high frequency across the trunk, low along it.
  const fissure = fbmField(size, {
    periodX: 14, periodY: 3, octaves: 5, perm, ridged: true,
    warpX: warpA, warpY: warpB, warpAmount: 0.9, seedX: 1, seedY: 6,
  });
  const cross = fbmField(size, { periodX: 3, periodY: 26, octaves: 3, perm, ridged: true, seedX: 30, seedY: 2 });
  const detail = fbmField(size, { periodX: 44, octaves: 4, perm, seedX: 5, seedY: 71 });
  const lichen = lowField(size, 3, { periodX: 4, octaves: 4, perm, seedX: 63, seedY: 14 });

  const out = alloc(n);
  for (let i = 0; i < n; i += 1) {
    const fis = clamp01(fissure[i]);
    const crs = clamp01(cross[i]);
    const det = n01(detail[i]);
    const ridge = Math.pow(fis, 0.75);
    const h = clamp01(ridge * 0.72 - (1 - crs) * 0.16 + det * 0.16);
    out.height[i] = h;

    const depth = smoothstep(0.62, 0.06, h);
    let r = lerp(0.108, 0.020, depth);
    let g = lerp(0.082, 0.015, depth);
    let b = lerp(0.058, 0.011, depth);

    // Grey weathering on the exposed ridges.
    const weather = smoothstep(0.55, 0.95, h) * (0.35 + det * 0.4);
    r = lerp(r, 0.125, weather); g = lerp(g, 0.118, weather); b = lerp(b, 0.104, weather);

    // Lichen only colonises the raised, sunlit ridges.
    const lich = smoothstep(0.60, 0.86, n01(lichen[i])) * smoothstep(0.45, 0.80, h);
    r = lerp(r, 0.207, lich); g = lerp(g, 0.228, lich); b = lerp(b, 0.163, lich);

    out.r[i] = r; out.g[i] = g; out.b[i] = b;
    out.rough[i] = clamp(0.90 + depth * 0.07 - lich * 0.04, 0.7, 1);
  }
  return out;
}

/* ---------------- stone: faceted, crystalline, cracked ---------------- */
function genStone(size, perm) {
  const n = size * size;
  const warpA = lowField(size, 4, { periodX: 5, octaves: 3, perm, seedX: 6, seedY: 26 });
  const warpB = lowField(size, 4, { periodX: 5, octaves: 3, perm, seedX: 51, seedY: 9 });

  const facets = fbmField(size, { periodX: 6, octaves: 5, perm, ridged: true, warpX: warpA, warpY: warpB, warpAmount: 0.7, seedX: 3, seedY: 3 });
  const body = fbmField(size, { periodX: 9, octaves: 5, perm, seedX: 33, seedY: 12 });
  const crystals = worleyField(size, { cellsX: 30, perm, jitter: 1, seed: 61 });
  const cracks = worleyField(size, { cellsX: 6, perm, jitter: 0.9, seed: 73, warpX: warpA, warpY: warpB, warpAmount: 0.7 });
  const grit = fbmField(size, { periodX: 56, octaves: 3, perm, seedX: 44, seedY: 5 });

  const out = alloc(n);
  for (let i = 0; i < n; i += 1) {
    const crack = 1 - smoothstep(0.0, 0.035, cracks.f2[i] - cracks.f1[i]);
    const ct = clamp01(crystals.f1[i] / 0.40);
    const cry = Math.sqrt(Math.max(0, 1 - ct * ct));
    const h = clamp01(0.30 + clamp01(facets[i]) * 0.34 + n01(body[i]) * 0.22 + cry * 0.10 + n01(grit[i]) * 0.06 - crack * 0.30);
    out.height[i] = h;

    // Grey stone with quartz, mica and feldspar grains.
    const cid = crystals.id[i];
    const pick = hash01(cid, 13, 5);
    let r = 0.196, g = 0.196, b = 0.190;
    const tone = 0.82 + n01(body[i]) * 0.42;
    r *= tone; g *= tone; b *= tone;
    if (pick > 0.86) { const m = cry * 0.8; r = lerp(r, 0.415, m); g = lerp(g, 0.405, m); b = lerp(b, 0.388, m); }
    else if (pick < 0.14) { const m = cry * 0.8; r = lerp(r, 0.050, m); g = lerp(g, 0.049, m); b = lerp(b, 0.053, m); }
    else if (pick > 0.62) { const m = cry * 0.5; r = lerp(r, 0.245, m); g = lerp(g, 0.198, m); b = lerp(b, 0.172, m); }

    r = lerp(r, 0.062, crack * 0.85); g = lerp(g, 0.060, crack * 0.85); b = lerp(b, 0.060, crack * 0.85);

    out.r[i] = r; out.g[i] = g; out.b[i] = b;
    out.rough[i] = clamp(0.72 - cry * 0.22 * (pick > 0.86 ? 1 : 0.3) + crack * 0.2, 0.34, 0.95);
  }
  return out;
}

/* ---------------- concrete: patio slab ----------------

   One texture tile is 120 world units - about 75 body lengths - so this is
   the material a tardigrade spends most of its life standing on, seen from
   two centimetres away. It has to survive that.

   Three deliberate scales, because a surface with only one is what "obvious
   tiling noise" actually looks like:

     macro (period 2 over the tile, ~60 units)  pour patches, wear paths,
                                                staining, algae in the damp
     mid   (6-26 cells)                         exposed aggregate, air voids,
                                                hairline cracks
     micro (62 cells + period 120 fBm)          sand in the cement paste,
                                                the surface it is actually made of

   Air voids use a power-law radius rather than a fixed one. Every previous
   pore was the same size, which is why the slab read as printed halftone
   dots: real concrete has one big blowhole for every hundred pin-pricks.
   ------------------------------------------------------------------------ */
function genConcrete(size, perm) {
  const n = size * size;
  const warpA = lowField(size, 4, { periodX: 4, octaves: 3, perm, seedX: 11, seedY: 3 });
  const warpB = lowField(size, 4, { periodX: 4, octaves: 3, perm, seedX: 2, seedY: 46 });

  /* --- macro --- */
  const patch = lowField(size, 6, { periodX: 2, octaves: 4, perm, seedX: 133, seedY: 21 });
  const wear = lowField(size, 5, { periodX: 3, octaves: 4, perm, seedX: 64, seedY: 88, warpX: warpA, warpY: warpB, warpAmount: 0.5 });
  const stains = lowField(size, 3, { periodX: 5, octaves: 4, perm, seedX: 81, seedY: 12 });

  /* --- mid --- */
  const pores = worleyField(size, { cellsX: 20, perm, jitter: 1, seed: 90 });
  const aggregate = worleyField(size, { cellsX: 9, perm, jitter: 1, seed: 4, warpX: warpA, warpY: warpB, warpAmount: 0.55 });
  const cracks = worleyField(size, { cellsX: 4, perm, jitter: 0.9, seed: 55, warpX: warpA, warpY: warpB, warpAmount: 0.9 });

  /* --- micro --- */
  const grit = worleyField(size, { cellsX: 62, perm, jitter: 1, seed: 41 });
  const fine = fbmField(size, { periodX: 52, octaves: 4, perm, seedX: 7, seedY: 66 });
  const micro = fbmField(size, { periodX: 128, octaves: 3, perm, seedX: 29, seedY: 5 });

  // Aggregate lithologies exposed where the cement skin has worn off. These
  // are spread WIDE around the paste value on purpose: a chip that sits
  // within a few percent of the cement it is embedded in is a chip nobody
  // will ever see, and the frame goes back to reading as one flat wash.
  const STONE = [
    [0.062, 0.061, 0.066], // dark basalt
    [0.148, 0.140, 0.128], // dark greywacke
    [0.352, 0.318, 0.256], // buff limestone
    [0.286, 0.206, 0.176], // pink feldspar
    [0.470, 0.458, 0.436], // quartz
  ];

  const out = alloc(n);
  for (let i = 0; i < n; i += 1) {
    /* ---- masks ---- */
    const pat = n01(patch[i]);
    const wr = n01(wear[i]);
    const st = n01(stains[i]);
    const surf = n01(fine[i]);
    const mic = n01(micro[i]);

    // Void size follows a power law across a CONTINUOUS range: hash^1.8 runs
    // smoothly from pin-prick to blowhole. An exponent steep enough to make
    // "most voids small" true also makes most voids identical, and identical
    // voids on a lattice is exactly the printed-halftone look this replaces.
    // Occupancy matters as much as size. world.js tiles this at roughly 33
    // world units, so a 20-cell lattice is one candidate void every 1.6 units
    // - a third of a millimetre at true scale. Filling 60% of those gave a
    // golf-ball dimple field; 16% gives voids about a millimetre apart, which
    // is what a float-finished slab actually has.
    const poreId = pores.id[i];
    const poreRoll = hash01(poreId, 3, 77);
    const poreSize = Math.pow(hash01(poreId, 9, 5), 1.8);
    const poreRad = 0.018 + poreSize * 0.30;
    const pt = clamp01(pores.f1[i] / poreRad);
    // Shallow pin-pricks stay faint; only the big voids read as holes.
    const poreDepth = 0.35 + poreSize * 0.65;
    const pore = (poreRoll > 0.84 ? 1 : 0) * Math.sqrt(Math.max(0, 1 - pt * pt)) * poreDepth;

    // Exposed aggregate: mostly where the cement paste has worn through, but
    // never zero - a cast slab always shows some chip through the skin.
    const aggId = aggregate.id[i];
    const aggRad = 0.22 + hash01(aggId, 13, 3) * 0.26;
    const at = clamp01(aggregate.f1[i] / aggRad);
    const aggDome = Math.sqrt(Math.max(0, 1 - at * at));
    const exposed = clamp01(0.22 + smoothstep(0.36, 0.78, wr) * 0.78) * (hash01(aggId, 5, 29) > 0.30 ? 1 : 0.3);
    const agg = aggDome * exposed;

    // Both crack layers are masked by an unrelated low-frequency field. A
    // Worley edge network left unmasked tessellates the ENTIRE surface into
    // closed cells, and a complete tessellation is the one thing that never
    // happens in a real slab - it reads instantly as a Voronoi diagram.
    // Masked, it becomes a few crazed patches, which is what slabs do.
    const crack = (1 - smoothstep(0.0, 0.009, cracks.f2[i] - cracks.f1[i]))
      * smoothstep(0.48, 0.78, pat);
    // Craquelure at the aggregate scale, free: the cell-boundary distance of a
    // Worley field we already have. This is the layer between "one big crack"
    // and "sand", and without something living there the slab has a hole in
    // its frequency spectrum that reads as an untextured surface.
    const craze = (1 - smoothstep(0.0, 0.028, aggregate.f2[i] - aggregate.f1[i]))
      * smoothstep(0.30, 0.66, wr);
    const gt = clamp01(grit.f1[i] / 0.40);
    const sand = Math.sqrt(Math.max(0, 1 - gt * gt));

    /* ---- height ---- */
    const h = clamp01(
      0.60
      + (pat - 0.5) * 0.16          // the slab is not flat: it was floated by hand
      + agg * 0.15
      + sand * 0.022
      + surf * 0.10
      + (mic - 0.5) * 0.05
      - pore * 0.34
      - crack * 0.22
      - craze * 0.07
    );
    out.height[i] = h;

    /* ---- albedo ---- */
    // Cement paste. The macro patch drives a wide value swing on its own so
    // the slab still layers correctly even when the shader macro is off.
    // The cast is warm on purpose: a neutral grey albedo under a blue sky
    // resolves to blue-grey, and the whole patio read as dirty snow.
    const paste = 0.230 + pat * 0.165 + (surf - 0.5) * 0.048 + (mic - 0.5) * 0.022;
    let r = paste * 1.090;
    let g = paste * 1.000;
    let b = paste * 0.840;

    // Sand grains in the paste, faintly paler and warmer.
    r = lerp(r, r * 1.20 + 0.020, sand * 0.45);
    g = lerp(g, g * 1.17 + 0.017, sand * 0.45);
    b = lerp(b, b * 1.10 + 0.012, sand * 0.45);

    // Exposed aggregate: real stone colours, not a grey tint.
    const stone = STONE[(hash01(aggId, 23, 11) * STONE.length) | 0];
    const am = agg * 0.85;
    r = lerp(r, stone[0], am); g = lerp(g, stone[1], am); b = lerp(b, stone[2], am);

    // Foot-polished paths: slightly darker, much smoother.
    const polish = smoothstep(0.30, 0.02, wr);
    r = lerp(r, r * 0.88, polish); g = lerp(g, g * 0.88, polish); b = lerp(b, b * 0.90, polish);

    // Damp / dirt staining collects in the low ground.
    //
    // `stains` is a period-5 low field, so thresholding it directly gives big
    // smooth ellipses with clean contours. Against a lit slab those read as
    // painted-on blobs rather than damp: a blind reviewer logged "soft dark
    // ovals of identical shape and near-identical value ... they read as
    // either painted blobs or holes and never as objects", and an isolation
    // test (unlit material, albedo map only) confirmed the ovals live in this
    // texture. Perturbing the threshold input with the fine and micro fields
    // breaks the contour into an irregular edge, and the darkening is eased
    // off so relief rather than albedo carries it.
    const stainEdge = st + (surf - 0.5) * 0.20 + (mic - 0.5) * 0.10;
    const dirt = smoothstep(0.54, 0.94, stainEdge) * lerp(1, 0.35, smoothstep(0.55, 0.85, h));
    r = lerp(r, 0.118, dirt * 0.58); g = lerp(g, 0.113, dirt * 0.58); b = lerp(b, 0.099, dirt * 0.58);

    // Algae in the permanently shaded damp - a garden slab is never neutral.
    const algae = smoothstep(0.62, 0.92, st) * smoothstep(0.62, 0.18, pat);
    r = lerp(r, 0.058, algae * 0.85); g = lerp(g, 0.092, algae * 0.85); b = lerp(b, 0.042, algae * 0.85);

    // Rust bloom off an old fixing.
    const rust = smoothstep(0.93, 1.0, st);
    r = lerp(r, 0.150, rust); g = lerp(g, 0.086, rust); b = lerp(b, 0.048, rust);

    // Lime bloom / efflorescence on the high, dry ground.
    const bloom = smoothstep(0.72, 0.97, pat) * smoothstep(0.55, 0.85, h);
    r = lerp(r, 0.470, bloom * 0.45); g = lerp(g, 0.462, bloom * 0.45); b = lerp(b, 0.440, bloom * 0.45);

    // Void and crack interiors. Shaded concrete, not holes punched through
    // the slab: at 0.05 with the cavity map on top these read as glossy black
    // puddles the moment the camera gets close, which it does constantly.
    const deep = clamp01(pore * 0.85 + crack * 0.75 + craze * 0.30);
    r = lerp(r, 0.118, deep); g = lerp(g, 0.112, deep); b = lerp(b, 0.104, deep);

    out.r[i] = r; out.g[i] = g; out.b[i] = b;

    /* ---- roughness ----
       A wide band. Open pores and crack walls are matte; the trodden path is
       burnished nearly to a sheen; exposed quartz is glassier than paste. */
    out.rough[i] = clamp(
      0.86
      + (surf - 0.5) * 0.16
      - polish * 0.34
      - agg * 0.16
      - dirt * 0.06
      + deep * 0.12,
      0.42, 1.0
    );
  }
  return out;
}

/* ---------------- ceramic: glazed pot ---------------- */
function genCeramic(size, perm) {
  const n = size * size;
  const craze = worleyField(size, { cellsX: 20, perm, jitter: 1, seed: 17 });
  const pool = lowField(size, 4, { periodX: 4, octaves: 4, perm, seedX: 22, seedY: 9 });
  const dust = fbmField(size, { periodX: 60, octaves: 3, perm, seedX: 3, seedY: 88 });
  const specks = worleyField(size, { cellsX: 46, perm, jitter: 1, seed: 31 });

  const out = alloc(n);
  for (let i = 0; i < n; i += 1) {
    // Crazing: the classic thin crack network in an old glaze.
    const line = 1 - smoothstep(0.0, 0.016, craze.f2[i] - craze.f1[i]);
    const pl = n01(pool[i]);
    const speck = hash01(specks.id[i], 5, 3) > 0.965
      ? Math.sqrt(Math.max(0, 1 - clamp01(specks.f1[i] / 0.22) ** 2)) : 0;

    const h = clamp01(0.66 + (pl - 0.5) * 0.20 + n01(dust[i]) * 0.05 - line * 0.34 + speck * 0.12);
    out.height[i] = h;

    // Warm cream glaze, cooler and deeper where it has pooled.
    let r = lerp(0.615, 0.545, 1 - pl);
    let g = lerp(0.595, 0.552, 1 - pl);
    let b = lerp(0.540, 0.540, 1 - pl);
    // Crazing traps dirt and goes brown.
    r = lerp(r, 0.300, line * 0.7); g = lerp(g, 0.278, line * 0.7); b = lerp(b, 0.242, line * 0.7);
    // Iron speck burnt through the glaze.
    r = lerp(r, 0.180, speck); g = lerp(g, 0.120, speck); b = lerp(b, 0.078, speck);

    out.r[i] = r; out.g[i] = g; out.b[i] = b;
    out.rough[i] = clamp(0.115 + (1 - pl) * 0.05 + line * 0.30 + speck * 0.25, 0.07, 0.6);
  }
  return out;
}

/* ---------------- sugar: sucrose crystal ----------------

   Split out of `ceramic`, which it shared until now. Sucrose is a
   transparent crystalline solid: its albedo is very high and almost
   colourless, its "texture" is internal - cleavage planes, trapped air,
   the odd inclusion - and it has no dirt in it at all, because a sugar
   grain that has been lying in a flower bed dissolves rather than gets
   grubby. Everything that reads as detail on a real grain is refraction,
   which is why the per-facet pass in the shader carries most of the load
   and this map only has to stay out of its way.
   -------------------------------------------------------------------- */
function genSugar(size, perm) {
  const n = size * size;
  const cleave = worleyField(size, { cellsX: 12, perm, jitter: 1, seed: 63 });
  const milk = lowField(size, 4, { periodX: 5, octaves: 4, perm, seedX: 12, seedY: 74 });
  const bubbles = worleyField(size, { cellsX: 38, perm, jitter: 1, seed: 26 });
  const fine = fbmField(size, { periodX: 70, octaves: 3, perm, seedX: 91, seedY: 6 });

  const out = alloc(n);
  for (let i = 0; i < n; i += 1) {
    // Cleavage steps: straight-ish terraces, not a crack network.
    const step = 1 - smoothstep(0.0, 0.055, cleave.f2[i] - cleave.f1[i]);
    const mk = n01(milk[i]);
    const bt = clamp01(bubbles.f1[i] / 0.26);
    const bubble = hash01(bubbles.id[i], 11, 4) > 0.80
      ? Math.sqrt(Math.max(0, 1 - bt * bt)) : 0;
    const f = n01(fine[i]);

    out.height[i] = clamp01(0.70 + (mk - 0.5) * 0.10 + f * 0.05 - step * 0.30 + bubble * 0.16);

    // Near-white and only just off neutral. Sugar photographs slightly warm
    // in the milky regions because that is scattered light, not pigment.
    const milky = smoothstep(0.44, 0.86, mk);
    const v = 0.760 + f * 0.055 + milky * 0.045;
    out.r[i] = v;
    out.g[i] = v * (1 - milky * 0.006);
    out.b[i] = v * (1 - milky * 0.020);
    // Trapped air is the one genuinely bright thing: a total-internal
    // reflection off a bubble wall is brighter than the crystal around it.
    out.r[i] = lerp(out.r[i], 0.860, bubble * 0.6);
    out.g[i] = lerp(out.g[i], 0.858, bubble * 0.6);
    out.b[i] = lerp(out.b[i], 0.852, bubble * 0.6);

    // Cleavage faces are optically flat; the milky interior scatters.
    out.rough[i] = clamp(0.055 + milky * 0.16 + step * 0.10 + bubble * 0.12, 0.03, 0.42);
  }
  return out;
}

/* ---------------- terracotta: unglazed fired clay ---------------- */
function genTerracotta(size, perm) {
  const n = size * size;
  const pores = worleyField(size, { cellsX: 44, perm, jitter: 1, seed: 71 });
  const grog = worleyField(size, { cellsX: 17, perm, jitter: 1, seed: 8 });
  const bloom = lowField(size, 3, { periodX: 4, octaves: 4, perm, seedX: 34, seedY: 18 });
  const fine = fbmField(size, { periodX: 46, octaves: 4, perm, seedX: 55, seedY: 2 });
  const out = alloc(n);
  const inv = 1 / size;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const pt = clamp01(pores.f1[i] / 0.22);
      const pore = hash01(pores.id[i], 7, 9) > 0.62 ? Math.sqrt(Math.max(0, 1 - pt * pt)) : 0;
      const gt = clamp01(grog.f1[i] / 0.26);
      const chunk = hash01(grog.id[i], 3, 21) > 0.72 ? Math.sqrt(Math.max(0, 1 - gt * gt)) : 0;
      const f = n01(fine[i]);

      // Throwing rings from the potter's wheel. Computed per PIXEL, not per
      // row: as a per-row sine this was a dead-straight band running the full
      // width of the texture, 9 cycles per tile at repeat 8 - 72 identical
      // ribs - and three reviews read the pot as burlap, woven canvas or
      // corduroy rather than fired clay. Real throwing wanders in both phase
      // and depth, so jitter it and let the amplitude breathe.
      // Jitter from `fine` (period 46), not `bloom` (period 4). A
      // low-frequency jitter shifts whole regions of the row together, so
      // neighbouring pixels still line up and the rib rhythm survives as a
      // weave; a high-frequency one breaks it at texel scale.
      const ring = (Math.sin(y * inv * Math.PI * 2 * 9
        + (f - 0.5) * 3.4 + (n01(bloom[i]) - 0.5) * 1.6) * 0.5 + 0.5)
        * (0.5 + 0.5 * n01(bloom[i]));

      const h = clamp01(0.58 + ring * 0.10 + f * 0.16 + chunk * 0.10 - pore * 0.34);
      out.height[i] = h;

      const shade = 0.86 + f * 0.30;
      let r = 0.272 * shade;
      let g = 0.112 * shade;
      let b = 0.062 * shade;
      // Coarse grog particles are paler and greyer.
      r = lerp(r, 0.230, chunk * 0.7); g = lerp(g, 0.148, chunk * 0.7); b = lerp(b, 0.110, chunk * 0.7);
      // Lime bloom / salt efflorescence.
      // Efflorescence is a thin crust that gathers in pores, not a splat.
      // Blending 80% toward a near-neutral 0.43 lifted green and blue 4-6x
      // over a base of (0.272, 0.112, 0.062), which is why three reviews
      // described the pot as covered in bird droppings or peeling paint.
      // Efflorescence at ONE size reads as splattered paint. `bloom` is a
      // lowField at period 4, so every blob came out the same diameter with
      // no smaller ones between - a reviewer called it bird lime. Mixing in
      // the high-frequency `fine` field breaks the blobs into a range of
      // sizes and lets them fray at the edges, which is how a crust actually
      // grows out of the pores rather than sitting on top of the clay.
      const blFine = n01(fine[i]);
      const blMix = n01(bloom[i]) * 0.62 + blFine * 0.38;
      const bl = smoothstep(0.62, 0.90, blMix) * (0.25 + 0.75 * pore) * (0.45 + 0.55 * blFine);
      r = lerp(r, 0.372, bl * 0.30); g = lerp(g, 0.344, bl * 0.30); b = lerp(b, 0.318, bl * 0.30);
      // Pore interiors.
      r = lerp(r, 0.075, pore); g = lerp(g, 0.038, pore); b = lerp(b, 0.024, pore);

      out.r[i] = r; out.g[i] = g; out.b[i] = b;
      out.rough[i] = clamp(0.88 - bl * 0.06 + pore * 0.08, 0.7, 0.99);
    }
  }
  return out;
}

/* ---------------- metal: brushed steel, dented and grimy ---------------- */
function genMetal(size, perm) {
  const n = size * size;
  // Brush lines run along U: fast variation in V, almost none in U.
  const brush = fbmField(size, { periodX: 3, periodY: 150, octaves: 3, gain: 0.62, perm, seedX: 4, seedY: 1 });
  const scratch = fbmField(size, { periodX: 5, periodY: 96, octaves: 3, perm, ridged: true, seedX: 44, seedY: 12 });
  const dents = lowField(size, 4, { periodX: 7, octaves: 4, perm, seedX: 15, seedY: 29 });
  /* Dirt on metal is not a blob field. This used to be a lowField at period 5
     with a value drop to 0.06 linear, i.e. a 9:1 albedo swing at roughly the
     size of a thumbprint - and the bottle-cap call site converts this map's
     LUMINANCE into a shade multiplier, so those blobs came out of the frame as
     hard dark specks and a blind reviewer read the whole landmark as speckled
     granite rather than as painted steel.
     Two changes: it is finer and at a different period from the plastic
     library entry (they shared a period-5 lowField and therefore a visible
     signature), and it is gated on the HEIGHT field below, so grime collects
     in the crimp valleys and dents where it actually collects. */
  const grime = lowField(size, 3, { periodX: 9, octaves: 4, perm, seedX: 72, seedY: 6 });
  const rustGrain = fbmField(size, { periodX: 42, octaves: 4, perm, seedX: 21, seedY: 58 });

  const out = alloc(n);
  const metal = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const br = n01(brush[i]);
    const sc = smoothstep(0.86, 1.0, clamp01(scratch[i]));
    const dn = n01(dents[i]);
    const gr = n01(grime[i]);
    const rg = n01(rustGrain[i]);

    const h = clamp01(0.60 + (br - 0.5) * 0.10 + (dn - 0.5) * 0.26 - sc * 0.20);
    out.height[i] = h;

    // Low ground only. 1 at the bottom of a dent, 0 on the crown.
    const hollow = smoothstep(0.66, 0.34, h);

    const rust = smoothstep(0.70, 0.95, gr) * (0.35 + rg * 0.5) * (0.35 + hollow * 0.85);
    const soil = smoothstep(0.58, 0.88, gr) * 0.34 * (0.25 + hollow * 0.95);

    // Steel F0. Metal albedo IS the specular colour, so it stays high.
    let r = 0.560, g = 0.572, b = 0.585;
    const shade = 0.9 + br * 0.22;
    r *= shade; g *= shade; b *= shade;
    // Scratches expose bright, un-oxidised metal.
    r = lerp(r, 0.70, sc * 0.5); g = lerp(g, 0.71, sc * 0.5); b = lerp(b, 0.72, sc * 0.5);
    // Grime is a dielectric film sitting on top. It darkens; it does not
    // punch a hole. 0.16 keeps the swing inside 3.5:1, which reads as dirt.
    r = lerp(r, 0.165, soil); g = lerp(g, 0.152, soil); b = lerp(b, 0.138, soil);
    // Rust: iron oxide, definitely not a metal any more.
    r = lerp(r, 0.215, rust); g = lerp(g, 0.098, rust); b = lerp(b, 0.048, rust);

    out.r[i] = r; out.g[i] = g; out.b[i] = b;
    out.rough[i] = clamp(0.26 + (1 - br) * 0.16 + sc * 0.20 + soil * 0.35 + rust * 0.5, 0.12, 0.95);
    metal[i] = clamp01(1 - soil * 0.9 - rust * 0.95);
  }
  out.metal = metal;
  return out;
}

/* ---------------- painted wood: satin paint, chipped ---------------- */
function genPaintedWood(size, perm) {
  const n = size * size;
  // Grain runs along V.
  const grain = fbmField(size, { periodX: 4, periodY: 46, octaves: 4, perm, seedX: 7, seedY: 2 });
  const rings = fbmField(size, { periodX: 3, periodY: 15, octaves: 4, perm, ridged: true, seedX: 25, seedY: 40 });
  const chipMask = lowField(size, 3, { periodX: 5, octaves: 4, perm, seedX: 61, seedY: 17 });
  const chipEdge = fbmField(size, { periodX: 30, octaves: 4, perm, seedX: 13, seedY: 9 });
  const brush = fbmField(size, { periodX: 40, periodY: 3, octaves: 3, perm, seedX: 3, seedY: 55 });

  const out = alloc(n);
  for (let i = 0; i < n; i += 1) {
    const gr = n01(grain[i]);
    const rg = clamp01(rings[i]);
    const br = n01(brush[i]);
    // Sharp-edged flakes where the paint has let go.
    const chip = smoothstep(0.50, 0.56, clamp01(n01(chipMask[i]) * 0.82 + n01(chipEdge[i]) * 0.30));

    const woodH = rg * 0.5 + gr * 0.3;
    const h = clamp01(lerp(0.72 + br * 0.06 + woodH * 0.06, 0.40 + woodH * 0.34, chip));
    out.height[i] = h;

    // Duck-egg satin paint.
    let r = lerp(0.402, 0.438, br);
    let g = lerp(0.492, 0.520, br);
    let b = lerp(0.474, 0.498, br);
    // Bare weathered wood underneath.
    const wr = lerp(0.175, 0.098, rg);
    const wg = lerp(0.126, 0.070, rg);
    const wb = lerp(0.079, 0.043, rg);
    r = lerp(r, wr, chip); g = lerp(g, wg, chip); b = lerp(b, wb, chip);

    out.r[i] = r; out.g[i] = g; out.b[i] = b;
    out.rough[i] = clamp(lerp(0.40 + (1 - br) * 0.09, 0.86, chip), 0.3, 0.95);
  }
  return out;
}

/* ---------------- plastic: injection-moulded ABS ----------------

   This is the LEGO brick and the hose, and both call sites tint it in their
   own shader with a `diffuseColor.rgb *= <linear colour>` multiply. So the
   albedo baked here is deliberately a near-neutral MOULD SURFACE, not a
   colour: it carries value variation only, close to 1.0, so the call site's
   authored reflectance is the reflectance you actually get. Baking a red
   here as well meant the brick shipped at 0.18 linear red instead of the
   0.5 that real ABS measures - dark enough to kill every shading gradient
   in it, which is the other half of "reads as gouache".

   The surface itself is what sells injection moulding:
     - orange peel, the fine cellular texture left by an etched tool
     - tool polish streaks running along the draw direction
     - flow lines fanning from the gate
     - sink marks: broad, very shallow dishing over the thick sections

   None of these are visible as colour. They are visible because they bend
   the specular highlight, which is the entire point of a glossy material.
   ------------------------------------------------------------------------ */
function genPlastic(size, perm) {
  const n = size * size;
  const peel = worleyField(size, { cellsX: 58, perm, jitter: 1, seed: 6 });
  const peelFine = worleyField(size, { cellsX: 128, perm, jitter: 1, seed: 37 });
  const flow = fbmField(size, { periodX: 4, periodY: 24, octaves: 3, perm, seedX: 18, seedY: 4 });
  const polish = fbmField(size, { periodX: 3, periodY: 190, octaves: 3, gain: 0.6, perm, seedX: 12, seedY: 77 });
  const sink = lowField(size, 6, { periodX: 3, octaves: 3, perm, seedX: 45, seedY: 8 });
  const scuff = fbmField(size, { periodX: 60, periodY: 6, octaves: 3, perm, ridged: true, seedX: 39, seedY: 23 });
  const dirt = lowField(size, 4, { periodX: 5, octaves: 3, perm, seedX: 70, seedY: 11 });

  const out = alloc(n);
  for (let i = 0; i < n; i += 1) {
    const pt = clamp01(peel.f1[i] / 0.38);
    const grain = Math.sqrt(Math.max(0, 1 - pt * pt));
    const ft = clamp01(peelFine.f1[i] / 0.42);
    const fineGrain = Math.sqrt(Math.max(0, 1 - ft * ft));
    const fl = n01(flow[i]);
    const pol = n01(polish[i]);
    const sk = n01(sink[i]);
    // A scratch in gloss plastic is a BRIGHT line, not a dark one: the torn
    // surface scatters where the polish reflects. As a deep groove it fed the
    // cavity AO instead, and once the gloss layer lifted everything around it
    // the stud tops came out covered in dark dashes that read as dirt.
    const sc = smoothstep(0.86, 1.0, clamp01(scuff[i]));
    const dt = n01(dirt[i]);

    // Everything here is shallow on purpose. Mould texture is microns deep;
    // it must perturb the highlight, never read as lumps. The tool-polish and
    // flow terms were halved once the gloss layer arrived: the base normal is
    // still lit by the base specular lobe, and at full amplitude the two
    // stacked and the brick came out looking like varnished timber.
    const h = clamp01(
      0.62
      + grain * 0.13
      + fineGrain * 0.05
      + (sk - 0.5) * 0.14
      - sc * 0.028
    );
    out.height[i] = h;

    // Near-white mould surface. The tiny value swing is the polish and the
    // peel catching light differently, not pigment.
    const shade = 0.800 + (grain - 0.4) * 0.045 + (pol - 0.5) * 0.030;
    let r = shade;
    let g = shade;
    let b = shade * 0.996;
    // Scuffs go chalky and lift the value.
    r = lerp(r, 0.92, sc * 0.55); g = lerp(g, 0.91, sc * 0.55); b = lerp(b, 0.90, sc * 0.55);
    // Old grime in the recesses. Kept, but no longer a 2.7x value drop: the
    // gloss layer lifted everything around it, and against that the old
    // strength read as mould blotches on the stud tops rather than as dirt.
    const soil = smoothstep(0.72, 0.97, dt) * 0.42;
    r = lerp(r, 0.54, soil); g = lerp(g, 0.51, soil); b = lerp(b, 0.47, soil);

    out.r[i] = r; out.g[i] = g; out.b[i] = b;

    // ABS off a polished tool measures around 0.25-0.35 perceptual roughness.
    // The band is narrow and the variation inside it is what makes the
    // highlight crawl across the surface instead of sitting there as a dot.
    out.rough[i] = clamp(
      0.30 + (1 - grain) * 0.07 + (1 - pol) * 0.06 + sc * 0.18 + soil * 0.22,
      0.22, 0.86
    );
  }
  return out;
}

/* ==========================================================
   7b. Gloss relief - the layer that makes a highlight exist
   ------------------------------------------------------------
   MEASURED, not assumed. On the LEGO brick at its own beauty
   shot the angle between each face normal and the specular
   half-vector is:

       top    57.4 deg      right  69.0 deg
       front  40.4 deg      left  111.0 deg

   A GGX lobe at roughness 0.25 is about 4 degrees wide, and at
   roughness 0.6 about 20. So NO flat face on that brick can
   catch the sun, at any roughness, with any F0, under any
   environment. That was verified three ways: swapping a plain
   MeshStandardMaterial on at runtime changed nothing; raising
   roughness from 0.15 to 0.55 changed nothing; and a chrome
   mirror in the brick's place reflected two flat colours - a
   blue sky above, a brown ground below - because the baked
   environment's entire dynamic range is 22:1 with the sun
   covering 0.002% of it.

   The thing that makes a real brick photograph as plastic is
   that its edges are radiused and its moulded face is not
   optically flat, so somewhere on every face the normal sweeps
   through the lobe. That is a surface property, so it belongs
   here.

   This field is that surface: a broad, smooth waviness with a
   calibrated slope of 20-30 degrees, plus mould peel, sink
   dimples and wear scuffs. It is fed to the material's GLOSS
   layer only (clearcoatNormalMap) - never to the base normal -
   because the diffuse response of moulded plastic really is
   flat, and pushing this into the base normal would read as
   dents rather than as shine.
   ========================================================== */
function genGlossRelief(size, perm, o) {
  const n = size * size;
  const seed = o.seed || 0;

  // Two decorrelated low-frequency swells. One alone gives a surface that
  // wobbles in a single direction, which reads as corduroy once it catches
  // the light; two at incommensurate periods read as a moulded panel.
  const swellA = lowField(size, 6, { periodX: o.waveCycles, octaves: 3, perm, seedX: seed + 3, seedY: seed + 41 });
  const swellB = lowField(size, 5, {
    periodX: Math.max(2, o.waveCycles * 2 - 1),
    periodY: Math.max(2, o.waveCycles * 2 + 1),
    octaves: 3, perm, seedX: seed + 17, seedY: seed + 5,
  });

  const peel = worleyField(size, { cellsX: o.peelCells, perm, jitter: 1, seed: seed + 9 });
  const dimple = worleyField(size, { cellsX: Math.max(3, Math.round(o.peelCells / 6)), perm, jitter: 1, seed: seed + 23 });
  const scuff = fbmField(size, {
    periodX: o.scuffX, periodY: o.scuffY, octaves: 3, perm, ridged: true, seedX: seed + 31, seedY: seed + 13,
  });

  const swell = new Float32Array(n);
  const detail = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    swell[i] = clamp01(0.5 + (n01(swellA[i]) - 0.5) * 1.0 + (n01(swellB[i]) - 0.5) * 0.62);

    const pt = clamp01(peel.f1[i] / 0.42);
    const cell = Math.sqrt(Math.max(0, 1 - pt * pt));
    const dt = clamp01(dimple.f1[i] / 0.30);
    const pit = hash01(dimple.id[i], 5, 7) > 0.78 ? Math.sqrt(Math.max(0, 1 - dt * dt)) : 0;
    const sc = smoothstep(0.76, 1.0, clamp01(scuff[i]));
    detail[i] = clamp01(0.5 + (cell - 0.45) * o.peel - pit * o.dimple - sc * o.scuff);
  }
  return { swell, detail };
}

/* ---------------- water: exact-tiling ripple sum ---------------- */
function genWater(size, perm, variant) {
  const n = size * size;
  // Integer wave numbers, so the surface tiles perfectly.
  const WAVES = variant === 0
    ? [[3, 1, 1.0, 0.0], [1, 3, 0.78, 1.7], [4, -2, 0.46, 3.1], [-2, 5, 0.32, 0.6], [6, 3, 0.20, 2.2], [7, -5, 0.12, 4.4]]
    : [[2, 2, 0.9, 1.1], [-3, 1, 0.7, 2.6], [1, -4, 0.5, 0.3], [5, 2, 0.3, 3.8], [-4, -5, 0.18, 1.4], [8, 1, 0.10, 5.0]];

  const capillary = fbmField(size, { periodX: 22, octaves: 4, perm, seedX: variant * 17 + 3, seedY: variant * 5 + 9 });
  const out = alloc(n);
  const inv = 1 / size;
  const TAU = Math.PI * 2;

  for (let y = 0; y < size; y += 1) {
    const v = y * inv;
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const u = x * inv;
      let h = 0;
      let amp = 0;
      for (let w = 0; w < WAVES.length; w += 1) {
        const W = WAVES[w];
        h += Math.sin(TAU * (W[0] * u + W[1] * v) + W[3]) * W[2];
        amp += W[2];
      }
      h = h / amp * 0.5 + 0.5;
      h = clamp01(h * 0.82 + n01(capillary[i]) * 0.18);
      out.height[i] = h;
      out.r[i] = 0.62; out.g[i] = 0.70; out.b[i] = 0.72;
      out.rough[i] = clamp(0.030 + (1 - h) * 0.055, 0.02, 0.13);
    }
  }
  return out;
}

/* ---------------- chitin: the hero's cuticle ---------------- */
function genChitin(size, perm) {
  const n = size * size;
  const papillae = worleyField(size, { cellsX: 30, perm, jitter: 1, seed: 3 });
  const wrinkle = fbmField(size, { periodX: 12, periodY: 6, octaves: 4, perm, seedX: 9, seedY: 41 });
  const granule = worleyField(size, { cellsX: 64, perm, jitter: 1, seed: 26 });
  const patch = lowField(size, 4, { periodX: 4, octaves: 3, perm, seedX: 52, seedY: 7 });
  const out = alloc(n);
  const inv = 1 / size;

  for (let y = 0; y < size; y += 1) {
    // Transverse cuticular folds between body segments.
    const fold = Math.abs(Math.sin(y * inv * Math.PI * 4));
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const pt = clamp01(papillae.f1[i] / (0.26 + hash01(papillae.id[i], 5, 2) * 0.16));
      const bump = Math.sqrt(Math.max(0, 1 - pt * pt));
      const gt = clamp01(granule.f1[i] / 0.34);
      const gran = Math.sqrt(Math.max(0, 1 - gt * gt));
      const wr = n01(wrinkle[i]);

      const h = clamp01(0.44 + bump * 0.26 + gran * 0.08 + (wr - 0.5) * 0.20 + fold * 0.14);
      out.height[i] = h;

      // Pale warm amber, the classic water-bear colour.
      const pa = n01(patch[i]);
      let r = lerp(0.400, 0.512, pa);
      let g = lerp(0.286, 0.372, pa);
      let b = lerp(0.152, 0.208, pa);
      // Papilla tips catch the light and are a touch paler.
      r = lerp(r, 0.560, bump * 0.35); g = lerp(g, 0.430, bump * 0.35); b = lerp(b, 0.268, bump * 0.35);
      // Sub-cuticular granules read slightly olive.
      r = lerp(r, 0.268, gran * 0.30); g = lerp(g, 0.238, gran * 0.30); b = lerp(b, 0.118, gran * 0.30);
      // Folds are shadowed and a touch more saturated.
      const deep = smoothstep(0.44, 0.16, h);
      r = lerp(r, 0.218, deep * 0.6); g = lerp(g, 0.140, deep * 0.6); b = lerp(b, 0.070, deep * 0.6);

      out.r[i] = r; out.g[i] = g; out.b[i] = b;
      out.rough[i] = clamp(0.34 + deep * 0.24 - bump * 0.10, 0.2, 0.7);
    }
  }
  return out;
}

/* ---------------- glass: nearly perfect, faintly smeared ---------------- */
function genGlass(size, perm) {
  const n = size * size;
  const wave = lowField(size, 4, { periodX: 3, octaves: 3, perm, seedX: 5, seedY: 23 });
  const smear = lowField(size, 3, { periodX: 6, octaves: 4, perm, seedX: 41, seedY: 8 });
  const specks = worleyField(size, { cellsX: 22, perm, jitter: 1, seed: 14 });
  const out = alloc(n);

  for (let i = 0; i < n; i += 1) {
    const sm = n01(smear[i]);
    const dust = hash01(specks.id[i], 7, 3) > 0.94
      ? Math.sqrt(Math.max(0, 1 - clamp01(specks.f1[i] / 0.14) ** 2)) : 0;
    const h = clamp01(0.5 + (n01(wave[i]) - 0.5) * 0.5 + dust * 0.25);
    out.height[i] = h;

    const grime = smoothstep(0.70, 0.96, sm);
    out.r[i] = lerp(0.78, 0.60, grime * 0.5);
    out.g[i] = lerp(0.80, 0.62, grime * 0.5);
    out.b[i] = lerp(0.79, 0.58, grime * 0.5);
    out.rough[i] = clamp(0.025 + grime * 0.22 + dust * 0.4, 0.02, 0.6);
  }
  return out;
}

/* ==========================================================
   8. Material registry
   ------------------------------------------------------------
   res    - fraction of quality.textureSize (power of two)
   tile   - world units one texture tile should cover
   repeat - default UV repeat for the geometry this usually lands on
   ========================================================== */

/**
 * Cheap two-sided foliage translucency, plus per-instance hue/value jitter.
 *
 * Real leaves glow when the sun is behind them. `MeshPhysicalMaterial`'s
 * `transmission` models that with a refraction backbuffer, which is both very
 * expensive and visibly broken once thousands of instanced blades overlap
 * (blades sample a buffer that excludes other transmissive geometry and fall
 * to black). Instead we add a wrap-around back-scatter term straight into
 * `outgoingLight`.
 *
 * Two contributions:
 *   back - the sun is on the far side of this surface
 *   thru - the viewer is looking roughly into the sun through the leaf,
 *          which is when real backlit foliage lights up most
 *
 * The light vector comes from three's own view-space directional light
 * uniform, so this stays correct under instancing and needs no per-frame
 * CPU work.
 *
 * This routes through `attachShaderConfig` rather than assigning
 * `onBeforeCompile` directly, and that is load bearing: `Material.copy()`
 * does not copy `onBeforeCompile` or `customProgramCacheKey`, so a closure
 * installed here is silently dropped by `clone()`. Every call site reaches
 * these materials through `make()`, which clones - so before this change no
 * foliage in the shipped world had any translucency at all.
 */
function applyFoliageTranslucency(material, strength = 0.85, options = {}) {
  material.userData.foliageTranslucency = strength;

  // Measured: grass lit only by the sky dome rendered at median hue 203 deg -
  // solidly cyan - while sun-backlit grass in the same scene measured 120 deg,
  // correct green. `scene.environmentIntensity` is 1.65 against a very blue
  // Preetham dome, and foliage takes that full-strength, so ambient was
  // pulling the blades ~80 deg off their own albedo. Two blind reviews called
  // this out as "the grey wash failure with a blue bias" and "a blue-grey
  // curtain". Foliage takes a reduced share of the sky so its own chlorophyll
  // albedo and the warm sun survive; hard surfaces are unaffected.
  material.envMapIntensity = 0.42;
  const cfg = shaderConfig.get(material) || {};
  cfg.foliage = {
    strength,
    // Transmitted light is filtered by chlorophyll, so it is greener and
    // more saturated than the reflected light, never whiter.
    tint: new THREE.Color().fromArray(options.tint || [0.86, 1.18, 0.52]),
    // x = hue spread, y = +-value spread. Both per instance, both continuous.
    jitter: new THREE.Vector2(
      options.hueJitter === undefined ? 0.5 : options.hueJitter,
      options.valueJitter === undefined ? 0.26 : options.valueJitter
    ),
  };
  return attachShaderConfig(material, cfg);
}

/**
 * Macro presets. `scale` is the base octave; the pass derives the other two
 * from it. `shuffle` is the rotated albedo re-sample (0 disables the extra
 * fetch entirely), `crevice` is how much of the baked cavity map lands on
 * albedo.
 */
/**
 * Substance presets for the sheen pass. The exponent is the identity: it is
 * the angular half-width of the sun response, and it is the thing that makes
 * two objects of the same colour read as two different materials.
 *
 *   exponent  half-width   substance
 *      6         33 deg    unglazed clay, dry concrete, weathered wood
 *     14         21 deg    rubber, worn matte plastic
 *     34         14 deg    injection-moulded ABS, satin paint
 *     70          9 deg    baked enamel over pressed steel
 *    170          6 deg    fired glaze, glass, sugar
 *
 * `graze` scales the environment specular at the silhouette. Every dielectric
 * goes to F = 1 there; how far it goes before it does is the second half of
 * the signature. Rubber tubes and glazed pots have a hard bright rim; fired
 * clay barely has one.
 */
const SPEC_CLAY = { exponent: 6, f0: 0.045, gain: 0.42, graze: 0.9, tint: [1.0, 0.96, 0.90] };
const SPEC_RUBBER = { exponent: 14, f0: 0.055, gain: 1.25, graze: 2.4, tint: [0.94, 1.0, 0.96] };
const SPEC_ABS = { exponent: 34, f0: 0.055, gain: 1.65, graze: 2.0, tint: [1.0, 0.99, 0.98] };
const SPEC_ENAMEL = { exponent: 70, f0: 0.070, gain: 2.30, graze: 2.6, tint: [1.0, 0.98, 0.94] };
const SPEC_GLAZE = { exponent: 170, f0: 0.060, gain: 2.60, graze: 3.0, tint: [1.0, 0.99, 0.97] };

const MACRO_GROUND = { albedo: 0.52, warmth: 0.62, rough: 0.22, scale: 1 / 6.5, shuffle: 0, crevice: 0.28 };
const MACRO_ROCK = { albedo: 0.42, warmth: 0.46, rough: 0.18, scale: 1 / 5.0, shuffle: 0, crevice: 0.26 };
const MACRO_SOFT = { albedo: 0.28, warmth: 0.42, rough: 0.12, scale: 1 / 5.0, shuffle: 0, crevice: 0.18 };

const DEFS = {
  soil: {
    res: 1 / 2, tile: 16, repeat: 56, gen: genSoil, normalStrength: 58, ao: 1.0, aoFloor: 0.20,
    macro: MACRO_GROUND,
    build: (m) => new THREE.MeshStandardMaterial({ ...m, normalScale: new THREE.Vector2(1.15, 1.15) }),
  },
  gravel: {
    res: 1 / 2, tile: 40, repeat: 22, gen: genGravel, normalStrength: 86, ao: 1.05, aoFloor: 0.13,
    macro: MACRO_GROUND,
    build: (m) => new THREE.MeshStandardMaterial({ ...m, normalScale: new THREE.Vector2(1.25, 1.25) }),
  },
  sand: {
    res: 1 / 8, tile: 12, repeat: 74, gen: genSand, normalStrength: 40, ao: 0.8, aoFloor: 0.3,
    macro: MACRO_SOFT,
    build: (m) => new THREE.MeshStandardMaterial(m),
  },
  moss: {
    res: 1 / 4, tile: 30, repeat: 30, gen: genMoss, normalStrength: 74, ao: 1.15, aoFloor: 0.10,
    macro: MACRO_SOFT,
    translucency: { amount: 0.55, tint: [0.42, 0.68, 0.22] },
    build: (m) => new THREE.MeshPhysicalMaterial({
      ...m,
      sheen: 0.35,
      sheenColor: new THREE.Color(0x9fc46a),
      sheenRoughness: 0.55,
      normalScale: new THREE.Vector2(1.2, 1.2),
    }),
  },
  grass: {
    res: 1 / 8, tile: 120, repeat: 1, clampUv: true, gen: genGrass, normalStrength: 26, ao: 0.5, aoFloor: 0.45,
    foliage: { strength: 0.85, tint: [0.86, 1.24, 0.40], hueJitter: 0.46, valueJitter: 0.30 },
    build: (m) => new THREE.MeshPhysicalMaterial({
      ...m,
      side: THREE.DoubleSide,
      sheen: 0.55,
      sheenColor: new THREE.Color(0xc7e08a),
      sheenRoughness: 0.4,
    }),
  },
  leaf: {
    res: 1 / 4, tile: 130, repeat: 1, clampUv: true, gen: genLeaf, normalStrength: 34, ao: 0.7, aoFloor: 0.35,
    foliage: {
      strength: 0.7,
      // Warm-green: chlorophyll passes green and a little red, blocks blue.
      tint: [0.92, 1.20, 0.44],
      // world.js scatters grass with a per-instance colour, but that colour
      // is one hue ramp and the frame still read as two clusters of green.
      // This adds a continuous per-instance hue and value spread on top.
      hueJitter: 0.42,
      valueJitter: 0.28,
    },
    build: (m) => new THREE.MeshPhysicalMaterial({
      ...m,
      side: THREE.DoubleSide,
      clearcoat: 0.06,
      clearcoatRoughness: 0.40,
      sheen: 0.16,
      sheenColor: new THREE.Color(0xbfe08c),
      // A blade of grass down inside a lawn sees a sliver of sky, not a
      // hemisphere of it. At full environment intensity the blue sky term
      // swamped the (deliberately dark) chlorophyll albedo and half the lawn
      // came out silver-grey, which is what read as "only two hues".
      envMapIntensity: 0.5,
      // NOTE: deliberately NOT MeshPhysicalMaterial.transmission.
      // Three renders transmissive materials in a separate pass that samples a
      // transmission backbuffer which excludes other transmissive objects.
      // With thousands of overlapping instanced blades that breaks down and
      // renders whole blades black, and it costs a full extra scene render.
      // applyFoliageTranslucency() gets the backlit glow for ~nothing instead.
    }),
  },
  bark: {
    res: 1 / 4, tile: 30, repeat: 8, gen: genBark, normalStrength: 105, ao: 1.2, aoFloor: 0.10,
    macro: MACRO_SOFT,
    build: (m) => new THREE.MeshStandardMaterial({ ...m, normalScale: new THREE.Vector2(1.3, 1.3) }),
  },
  stone: {
    res: 1 / 4, tile: 25, repeat: 6, gen: genStone, normalStrength: 62, ao: 0.95, aoFloor: 0.18,
    macro: MACRO_ROCK,
    build: (m) => new THREE.MeshStandardMaterial(m),
  },
  concrete: {
    // The patio is the ground in half the beauty shots and one tile of it is
    // 120 world units, so it earns the same bake budget as the terrain.
    res: 1 / 2, tile: 120, repeat: 8, gen: genConcrete, normalStrength: 58, ao: 0.92, aoFloor: 0.26,
    macro: MACRO_GROUND,
    // Dry cement has almost no lobe but it does have a real grazing rim - it
    // is what separates a slab from a sheet of grey card at the far edge.
    spec: { exponent: 5, f0: 0.040, gain: 0.30, graze: 1.1, tint: [1.0, 0.97, 0.92] },
    build: (m) => new THREE.MeshStandardMaterial({ ...m, normalScale: new THREE.Vector2(1.15, 1.15) }),
  },
  ceramic: {
    /* repeat was 6, which is a tile every 15 world units on a mesh the size
       of the pot and a tile every 0.8 units on a sugar crystal. Neither call
       site asks for a tiling, so both inherited it, and on the crystals the
       whole crazing network landed at a fraction of a pixel: it mipped to a
       flat grey, and then moired against the anisotropic filter. 2 puts about
       one crazing network on each crystal facet, which is what a grain of
       sugar actually looks like, and coarsens the pot in the same move. */
    res: 1 / 8, tile: 90, repeat: 2, gen: genCeramic, normalStrength: 26, ao: 0.45, aoFloor: 0.55,
    /* A fired glaze is not optically flat - it flowed before it set, and on a
       700-unit pot that flow is the whole reason a highlight travels down the
       side instead of sitting on it as a dot. 26 deg, because the pot is seen
       from below in two beauty shots and its wall is 50+ deg off the specular
       half-vector there; anything shallower can never reach. */
    gloss: { res: 1 / 8, repeat: 2, seed: 41, waveCycles: 3, peelCells: 24, scuffX: 24, scuffY: 18,
      peel: 0.12, dimple: 0.0, scuff: 0.0, swellDeg: 26, detailDeg: 4 },
    // The one hard, tight lobe in the set. A glaze is glass, and a glass
    // surface next to unglazed clay is the clearest substance contrast the
    // frame has.
    spec: SPEC_GLAZE,
    // Glaze wears at the rim and where the pot has been dragged: it goes
    // brighter and smoother there and holds dirt in the hollows.
    wear: { albedo: 0.30, fade: 0.14, rough: 0.22, tint: [1.06, 1.01, 0.94] },
    roughBand: [0.90, 0.015, 0.05, 0.46],
    build: (m, maps) => new THREE.MeshPhysicalMaterial({
      ...m,
      clearcoat: 1,
      clearcoatRoughness: 0.10,
      clearcoatNormalMap: maps.gloss || maps.normal,
      clearcoatNormalScale: new THREE.Vector2(1, 1),
      specularIntensity: 1,
      envMapIntensity: 1.15,
    }),
  },
  /* ---- sugar ----
     world.js asks for a material called `sugar` and falls back to `ceramic`
     when the library does not ship one. It shipped on the fallback, which
     meant every retune of the pot's glaze was also a retune of the sugar
     drift and vice versa - and they are opposite materials: one is a thick
     poured glass film over an opaque body, the other is a transparent
     crystalline solid with no film at all. Splitting them is what lets the
     pot have a soft travelling highlight and the sugar have a hard sparkle. */
  sugar: {
    res: 1 / 8, tile: 90, repeat: 2, gen: genSugar, normalStrength: 20, ao: 0.35, aoFloor: 0.62,
    gloss: { res: 1 / 8, repeat: 2, seed: 41, waveCycles: 3, peelCells: 24, scuffX: 24, scuffY: 18,
      peel: 0.12, dimple: 0.0, scuff: 0.0, swellDeg: 15, detailDeg: 3 },
    /* Flat-shaded on purpose (crystals ARE faceted), but every facet was
       arriving as one uniform colour value: the texture is authored for a
       90-unit tile and the call site leaves the default repeat on a crystal
       2-11 units across, so every crazing line and iron speck lands at a
       fraction of a pixel and mips to a flat grey. Facet identity has to come
       from somewhere that is not UV space. */
    facet: {
      // x value spread, y hue spread, z roughness spread, w tilt radians
      // The tilt is the important one: real sugar sparkles because a few
      // grains in every hundred happen to be aimed at the sun. 0.42 rad is
      // 24 degrees, enough to swing a facet in or out of the lobe.
      jitter: [0.26, 0.55, 0.30, 0.42],
      warm: [1.16, 1.00, 0.72],
      cool: [0.80, 0.92, 1.10],
      // x world-space noise frequency, y albedo amount, z roughness amount, w spare
      cloud: [1.15, 0.26, 0.16, 0],
    },
    // Sucrose has a higher index than a glaze and no diffuse to speak of, so
    // the lobe is the tightest in the library and the rim the hardest.
    spec: { exponent: 240, f0: 0.075, gain: 3.4, graze: 3.4, tint: [1.0, 0.99, 0.98] },
    build: (m, maps) => new THREE.MeshPhysicalMaterial({
      ...m,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      clearcoatNormalMap: maps.gloss || maps.normal,
      clearcoatNormalScale: new THREE.Vector2(1, 1),
      specularIntensity: 1,
      ior: 1.55,
      envMapIntensity: 1.35,
    }),
  },
  terracotta: {
    res: 1 / 4, tile: 70, repeat: 8, gen: genTerracotta, normalStrength: 44, ao: 0.85, aoFloor: 0.25,
    macro: MACRO_SOFT,
    spec: SPEC_CLAY,
    build: (m) => new THREE.MeshStandardMaterial(m),
  },
  metal: {
    res: 1 / 4, tile: 40, repeat: 5, gen: genMetal, normalStrength: 30, ao: 0.5, aoFloor: 0.45,
    // Baked enamel over pressed steel. Tight enough to be obviously a
    // different substance from the ABS brick two shots away, and the highest
    // grazing gain in the set - a cap lip is a rolled edge and it catches the
    // sky along its whole circumference.
    spec: SPEC_ENAMEL,
    // Enamel on a crimp wears through on the ridges: brighter, smoother, and
    // shifted towards the bare steel underneath.
    wear: { albedo: 0.34, fade: 0.22, rough: 0.26, tint: [1.02, 1.02, 1.06] },
    // A floor, mostly. The call site drives roughness with its own rust field
    // and a multiply can only ever make a surface glossier, so without a floor
    // the clean paint goes to a mirror and without a ceiling the rust goes to
    // felt.
    roughBand: [1.0, 0.0, 0.13, 0.82],
    // A bottle cap is pressed steel under baked enamel, so the coat is real,
    // and pressed sheet is never flat - it keeps the swell of the die. The
    // rusty screw shares this material and reads as slightly greasy under it,
    // which for something that has been lying in a flower bed is fair.
    gloss: { res: 1 / 8, repeat: 2, seed: 63, waveCycles: 4, peelCells: 20, scuffX: 40, scuffY: 6,
      peel: 0.10, dimple: 0.0, scuff: 0.10, swellDeg: 21, detailDeg: 6 },
    build: (m, maps) => new THREE.MeshPhysicalMaterial({
      ...m,
      // Brushed steel: the highlight should smear along the grain.
      anisotropy: 0.55,
      anisotropyRotation: 0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.26,
      clearcoatNormalMap: maps.gloss || maps.normal,
      clearcoatNormalScale: new THREE.Vector2(1, 1),
      envMapIntensity: 1.25,
    }),
  },
  paintedWood: {
    res: 1 / 4, tile: 60, repeat: 5, gen: genPaintedWood, normalStrength: 40, ao: 0.7, aoFloor: 0.35,
    // Satin paint is exactly the case a gloss layer is for: the pigment is
    // matte, the film on top of it is not, and the film follows the grain it
    // was brushed over rather than the flat of the stick.
    gloss: { res: 1 / 8, repeat: 2.5, seed: 19, waveCycles: 3, peelCells: 22, scuffX: 44, scuffY: 5,
      peel: 0.10, dimple: 0.0, scuff: 0.08, swellDeg: 18, detailDeg: 6 },
    spec: { exponent: 26, f0: 0.050, gain: 1.30, graze: 1.7, tint: [1.0, 0.99, 0.96] },
    wear: { albedo: 0.26, fade: 0.10, rough: 0.20, tint: [1.04, 1.02, 0.96] },
    build: (m, maps) => new THREE.MeshPhysicalMaterial({
      ...m,
      clearcoat: 0.5,
      clearcoatRoughness: 0.26,
      clearcoatNormalMap: maps.gloss || maps.normal,
      clearcoatNormalScale: new THREE.Vector2(1, 1),
    }),
  },
  plastic: {
    // Injection-moulded ABS. The mould texture is the entire look, so it needs
    // real texels: at 1/8 the orange peel was below one texel per cell and the
    // brick had literally nothing for a highlight to catch on.
    res: 1 / 4, tile: 50, repeat: 4, gen: genPlastic, normalStrength: 34, ao: 0.28, aoFloor: 0.70,
    // Call sites multiply `roughness` into the map, which can only ever make a
    // surface glossier - the LEGO call site asks for 0.24, landing the brick
    // near 0.05 where the sun's GGX lobe is a sub-pixel dot against a smooth
    // sky and the whole face reads as unlit paint. This band is the material's
    // own floor and ceiling: gain, bias, min, max.
    roughBand: [1.55, 0.10, 0.17, 0.60],
    /* The measurement that matters: no face of the LEGO brick is closer than
       40 degrees to the specular half-vector at its own beauty shot, so the
       gloss layer has to sweep through tens of degrees or the brick can never
       have a highlight. The base normal stays shallow - moulded ABS really is
       flat to the touch - and all of the angle lives here, in the clearcoat.
       A 26-degree swell at three cycles per tile puts roughly one bright band
       per 40 screen pixels on the brick, which survives mipping. */
    // Almost all of the angle is in the swell. Pits and scuff grooves were
    // tried at strength and had to come out: a groove wall sweeps the whole
    // reflection cone, and this environment is a hard step from flat sky to
    // flat ground, so every groove came back as a black dash and the brick
    // read as mouldy rather than glossy.
    gloss: { res: 1 / 8, repeat: 1.4, seed: 7, waveCycles: 3, peelCells: 30, scuffX: 26, scuffY: 20,
      peel: 0.12, dimple: 0.0, scuff: 0.0, swellDeg: 31, detailDeg: 3 },
    /* Serves BOTH the LEGO brick and the coiled hose, which are not the same
       substance. They separate because the sheen exponent tracks the actual
       per-fragment roughness: the brick call site asks for 0.24 and lands
       near 0.21, giving a 12-degree ABS lobe; the hose drives roughness with
       a rib function that swings 0.19 to 0.60, so its ridges come out shiny
       and its valleys matte, which is exactly how a garden hose photographs.
       (A dedicated `rubber` entry would still be better - see the report.) */
    spec: SPEC_ABS,
    // The mould-release film wears off the high ground first, so a used brick
    // is brighter and glossier on the swells and grubbier in the hollows.
    wear: { albedo: 0.30, fade: 0.16, rough: 0.24, tint: [1.05, 1.02, 1.0] },
    build: (m, maps) => new THREE.MeshPhysicalMaterial({
      ...m,
      // Moulded ABS really is flat to the touch. All of the angle now lives
      // in the gloss layer, so the base normal only has to carry the peel.
      normalScale: new THREE.Vector2(0.55, 0.55),
      // The gloss layer of moulded ABS, with the mould texture in it. Giving
      // the clearcoat its own normal map is what makes the highlight crawl
      // over the peel instead of sitting on the surface like a decal.
      // The gloss normal sweeps the reflection through tens of degrees, and
      // this environment is a hard two-tone step (flat sky over flat ground)
      // with nothing in between, so a mirror-sharp coat turns that sweep into
      // banding. 0.18 is wide enough to blur the horizon step into a ramp and
      // still narrow enough to read as gloss.
      clearcoat: 0.85,
      clearcoatRoughness: 0.24,
      clearcoatNormalMap: maps.gloss || maps.normal,
      clearcoatNormalScale: new THREE.Vector2(1, 1),
      // ABS measures n = 1.54; the extra reach to 1.60 buys a little more F0
      // (0.040 -> 0.053) which is the difference between a highlight you have
      // to look for and one you see. The sky here is a smooth gradient, so a
      // sharp reflection of it carries no information - the environment term
      // has to be strong enough for its own value ramp to read as gloss.
      ior: 1.6,
      specularIntensity: 1,
      envMapIntensity: 1.7,
    }),
  },
  water: {
    res: 1 / 8, tile: 60, repeat: 14, gen: genWater, normalStrength: 46, ao: 0, aoFloor: 1, noAo: true,
    build: (m, maps) => new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0xffffff),
      normalMap: maps.normal,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: maps.orm,
      roughness: 1,
      metalness: 0,
      transmission: 0.94,
      thickness: 5,
      ior: 1.333,
      attenuationColor: new THREE.Color(0x5f9c86),
      attenuationDistance: 55,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      clearcoatNormalMap: maps.normal2,
      clearcoatNormalScale: new THREE.Vector2(0.35, 0.35),
      envMapIntensity: 1.4,
      side: THREE.FrontSide,
    }),
  },
  chitin: {
    res: 1 / 4, tile: 1.6, repeat: 3, gen: genChitin, normalStrength: 44, ao: 0.8, aoFloor: 0.3,
    build: (m, maps) => new THREE.MeshPhysicalMaterial({
      ...m,
      // A waxy arthropod cuticle: hard gloss layer over a soft, slightly
      // translucent body, with a whisper of thin-film colour.
      clearcoat: 0.9,
      clearcoatRoughness: 0.11,
      clearcoatNormalMap: maps.normal,
      clearcoatNormalScale: new THREE.Vector2(0.6, 0.6),
      sheen: 0.5,
      sheenColor: new THREE.Color(0xffd7a0),
      sheenRoughness: 0.45,
      iridescence: 0.18,
      iridescenceIOR: 1.32,
      iridescenceThicknessRange: [180, 520],
      transmission: 0.1,
      thickness: 0.45,
      ior: 1.46,
      attenuationColor: new THREE.Color(0xffc07a),
      attenuationDistance: 1.6,
      envMapIntensity: 1.1,
    }),
  },
  glass: {
    res: 1 / 16, tile: 80, repeat: 2, gen: genGlass, normalStrength: 10, ao: 0.25, aoFloor: 0.7,
    build: (m, maps) => new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0xffffff),
      normalMap: maps.normal,
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughnessMap: maps.orm,
      roughness: 1,
      metalness: 0,
      transmission: 0.99,
      thickness: 2.2,
      ior: 1.52,
      attenuationColor: new THREE.Color(0xd6efe4),
      attenuationDistance: 220,
      specularIntensity: 1,
      envMapIntensity: 1.3,
      side: THREE.DoubleSide,
    }),
  },
};

/* ==========================================================
   9. The system
   ========================================================== */

export async function createMaterials(ctx) {
  const q = ctx.settings.quality;
  const rng = makeRng(0x7a1d16 ^ 0x4d47);
  const perm = makePerm(rng);

  const materials = new Map();
  const textures = new Map();
  const textureBytes = new Map();
  const bakeTimes = {};
  const glossStats = {};
  const yieldToPaint = () => new Promise((resolve) => setTimeout(resolve, 0));

  let totalBytes = 0;

  function registerTexture(key, texture, size) {
    const bytes = Math.round(size * size * 4 * (texture.generateMipmaps ? 4 / 3 : 1));
    textures.set(key, texture);
    textureBytes.set(key, bytes);
    totalBytes += bytes;
    ctx.track(texture);
    return texture;
  }

  function makeTexture(bytesData, size, srgb, wrap, repeat) {
    const canvas = makeCanvas(size);
    const g2d = canvas.getContext("2d");
    g2d.putImageData(new ImageData(bytesData, size, size), 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
    texture.wrapS = wrap;
    texture.wrapT = wrap;
    texture.repeat.set(repeat, repeat);
    texture.anisotropy = Math.min(q.anisotropy, 16);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.flipY = true;
    // aoMap / roughnessMap / metalnessMap all read uv0 from this one texture.
    texture.channel = 0;
    texture.needsUpdate = true;
    return texture;
  }

  /* ---------- the low-frequency anti-tiling map, shared by everything ----------

     Three decorrelated fields in one RGB texture, each domain-warped so the
     patches have organic edges rather than fBm's tell-tale soap-bubble shape.

     Every channel is histogram-stretched to its own measured 2%/98% range
     before it is written. Raw fBm crowds around 0.5 - a 4-octave field only
     uses about a third of [0,1] - and a modulation map that never leaves the
     middle of its range produces variation that is present in the data and
     invisible on screen, which is the exact failure this pass exists to fix.
     ------------------------------------------------------------------------ */
  const macroSize = clamp(Math.round(q.textureSize / 8), 64, 256);
  const macroTexture = (() => {
    const warpX = lowField(macroSize, 2, { periodX: 3, octaves: 3, perm, seedX: 71, seedY: 5 });
    const warpY = lowField(macroSize, 2, { periodX: 3, octaves: 3, perm, seedX: 9, seedY: 143 });

    const bright = fbmField(macroSize, {
      periodX: 4, octaves: 4, perm, seedX: 101, seedY: 7,
      warpX, warpY, warpAmount: 0.9,
    });
    const warmth = fbmField(macroSize, { periodX: 3, octaves: 3, perm, seedX: 13, seedY: 202 });
    const rough = fbmField(macroSize, {
      periodX: 6, octaves: 4, perm, seedX: 55, seedY: 41,
      warpX: warpY, warpY: warpX, warpAmount: 0.6,
    });

    const stretch = (field) => {
      const sorted = Float32Array.from(field).sort();
      const lo = sorted[Math.floor(sorted.length * 0.02)];
      const hi = sorted[Math.floor(sorted.length * 0.98)];
      const span = hi - lo || 1;
      const out = new Float32Array(field.length);
      for (let i = 0; i < field.length; i += 1) out[i] = clamp01((field[i] - lo) / span);
      return out;
    };

    const b = stretch(bright);
    const w = stretch(warmth);
    const r = stretch(rough);
    const data = new Uint8ClampedArray(macroSize * macroSize * 4);
    for (let i = 0; i < macroSize * macroSize; i += 1) {
      const o = i * 4;
      data[o] = b[i] * 255;
      data[o + 1] = w[i] * 255;
      data[o + 2] = r[i] * 255;
      data[o + 3] = 255;
    }
    const tex = makeTexture(data, macroSize, false, THREE.RepeatWrapping, 1);
    // Sampled three times per ground fragment. It carries nothing above the
    // second mip, so 16x anisotropy on it is 16 taps bought for nothing.
    tex.anisotropy = 2;
    return registerTexture("_macro", tex, macroSize);
  })();

  /* ---------- bake every material ---------- */
  const names = Object.keys(DEFS);
  const bakedMaps = new Map();
  const bakeStart = performance.now();

  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const def = DEFS[name];
    const size = clamp(Math.round(q.textureSize * def.res), 64, 2048);
    const wrap = def.clampUv ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    const t0 = performance.now();

    if (ctx.boot && typeof ctx.boot.progress === "function") {
      ctx.boot.progress(0.32 + 0.085 * (index / names.length), `Baking ${name}`);
    }

    const fields = def.gen(size, perm, 0);
    const ao = def.noAo
      ? new Float32Array(size * size).fill(1)
      : cavityAO(fields.height, size, def.ao, def.aoFloor);

    const maps = {};
    maps.map = registerTexture(
      name,
      makeTexture(buildAlbedoBytes(size, fields.r, fields.g, fields.b), size, true, wrap, def.repeat),
      size
    );
    maps.normal = registerTexture(
      `${name}.normal`,
      makeTexture(buildNormalBytes(size, fields.height, def.normalStrength), size, false, wrap, def.repeat),
      size
    );
    maps.orm = registerTexture(
      `${name}.orm`,
      makeTexture(buildOrmBytes(size, ao, fields.rough, fields.metal || null), size, false, wrap, def.repeat),
      size
    );
    maps.hasMetal = Boolean(fields.metal);

    /* ---- gloss relief ----
       Its own texture, its own resolution and its own slope calibration,
       because it answers a different question than the base normal does:
       not "what does this surface feel like" but "will this surface catch
       the sun". It is low frequency by design, so it needs far fewer texels
       than the albedo and it survives mipping at any distance. */
    if (def.gloss) {
      const gSize = clamp(Math.round(q.textureSize * (def.gloss.res || def.res)), 128, 1024);
      const relief = genGlossRelief(gSize, perm, def.gloss);
      const built = buildSlopeNormalBytes(gSize, [
        { height: relief.swell, deg: def.gloss.swellDeg, percentile: 0.9 },
        { height: relief.detail, deg: def.gloss.detailDeg, percentile: 0.985 },
      ]);
      // Deliberately NOT the albedo's repeat. A highlight has to be a broad
      // shape - one bright region per hand-sized panel - or it reads as
      // glitter rather than as gloss. The albedo wants 50-unit tiles; the
      // gloss layer wants one tile per whole prop.
      const gRepeat = def.gloss.repeat === undefined ? def.repeat : def.gloss.repeat;
      glossStats[name] = { size: gSize, repeat: gRepeat, meanSlopeDeg: built.meanSlopeDeg };
      maps.gloss = registerTexture(
        `${name}.gloss`,
        makeTexture(built.data, gSize, false, wrap, gRepeat),
        gSize
      );
      maps.glossRepeatScale = def.repeat > 0 ? gRepeat / def.repeat : 1;
    }

    // Water gets a second, independently scrolling wave normal for the
    // clearcoat layer - one scrolling texture never reads as water.
    if (name === "water") {
      const second = genWater(size, perm, 1);
      maps.normal2 = registerTexture(
        "water.normal2",
        makeTexture(buildNormalBytes(size, second.height, def.normalStrength * 0.7), size, false, wrap, def.repeat * 0.63),
        size
      );
    }

    bakedMaps.set(name, { maps, size });
    bakeTimes[name] = Math.round(performance.now() - t0);
    await yieldToPaint();
  }

  const bakeMs = Math.round(performance.now() - bakeStart);

  /* ---------- assemble ---------- */
  function buildMaterial(name) {
    const def = DEFS[name];
    const entry = bakedMaps.get(name);
    const { maps } = entry;

    const base = {
      map: maps.map,
      normalMap: maps.normal,
      aoMap: maps.orm,
      roughnessMap: maps.orm,
      roughness: 1,
      metalness: 0,
      aoMapIntensity: 1,
    };
    if (maps.hasMetal) {
      base.metalnessMap = maps.orm;
      base.metalness = 1;
    }

    const material = def.build(base, maps);
    material.name = `tsim:${name}`;
    material.userData.tsimName = name;
    material.userData.tileUnits = def.tile;
    if (maps.glossRepeatScale) material.userData.tsGlossRepeatScale = maps.glossRepeatScale;

    if (def.foliage) applyFoliageTranslucency(material, def.foliage.strength, def.foliage);

    const cfg = shaderConfig.get(material) || {};
    if (def.macro) {
      const s = def.macro.scale;
      cfg.macro = {
        map: macroTexture,
        // x/y/z: the three macro octaves. w: the rotated albedo re-sample.
        scale: new THREE.Vector4(s, s * 3.1, s * 8.6, 0.63),
        strength: new THREE.Vector3(def.macro.albedo, def.macro.warmth, def.macro.rough),
        mix: new THREE.Vector2(def.macro.shuffle || 0, def.macro.crevice || 0),
        shuffle: def.macro.shuffle || 0,
        crevice: def.macro.crevice || 0,
      };
    }
    if (def.roughBand) {
      cfg.rough = new THREE.Vector4(...def.roughBand);
    }
    if (def.translucency) {
      cfg.translucency = {
        amount: def.translucency.amount,
        tint: new THREE.Color().fromArray(def.translucency.tint),
      };
    }
    if (def.facet) {
      cfg.facet = {
        jitter: new THREE.Vector4(...def.facet.jitter),
        warm: new THREE.Color().fromArray(def.facet.warm),
        cool: new THREE.Color().fromArray(def.facet.cool),
        cloud: new THREE.Vector4(...def.facet.cloud),
      };
    }
    if (def.spec) {
      cfg.spec = {
        // x sun-lobe exponent, y F0, z lobe gain, w grazing environment gain
        a: new THREE.Vector4(def.spec.exponent, def.spec.f0, def.spec.gain, def.spec.graze),
        tint: new THREE.Color().fromArray(def.spec.tint || [1, 1, 1]),
      };
    }
    if (def.wear) {
      cfg.wear = {
        // x albedo swing, y desaturate-toward-tint on the worn high ground,
        // z roughness drop on that same high ground, w spare
        amount: new THREE.Vector4(def.wear.albedo, def.wear.fade || 0, def.wear.rough || 0, 0),
        tint: new THREE.Color().fromArray(def.wear.tint || [1, 1, 1]),
      };
    }
    if (cfg.macro || cfg.rough || cfg.translucency || cfg.foliage || cfg.facet || cfg.spec || cfg.wear) {
      attachShaderConfig(material, cfg);
    }

    return ctx.track(material);
  }

  /* ---------- retiling helper for make() ---------- */
  const MAP_SLOTS = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "clearcoatNormalMap"];

  function retile(material, repeat) {
    // The gloss map is authored at its own tiling on purpose, so a call site
    // asking for "this mesh is 900 units across" has to scale it by the same
    // factor rather than be handed the albedo's number.
    const glossScale = material.userData.tsGlossRepeatScale || 1;
    const seen = new Map();
    for (const slot of MAP_SLOTS) {
      const texture = material[slot];
      if (!texture) continue;
      const want = slot === "clearcoatNormalMap" ? repeat * glossScale : repeat;
      const key = `${texture.uuid}@${want}`;
      let clone = seen.get(key);
      if (!clone) {
        // Texture.clone() shares `source`, so this costs no extra GPU memory.
        clone = texture.clone();
        clone.repeat.set(want, want);
        clone.needsUpdate = true;
        ctx.track(clone);
        seen.set(key, clone);
      }
      material[slot] = clone;
    }
    material.needsUpdate = true;
  }

  /** Object.assign, but colour-aware, so make(name, { color: 0xff0000 }) works. */
  function applyOverrides(material, overrides) {
    for (const key of Object.keys(overrides)) {
      const value = overrides[key];
      const current = material[key];
      if (current && current.isColor && (typeof value === "number" || typeof value === "string")) {
        current.set(value);
      } else if (current && current.isVector2 && Array.isArray(value)) {
        current.set(value[0], value[1]);
      } else if (current && current.isVector2 && typeof value === "number") {
        current.set(value, value);
      } else {
        material[key] = value;
      }
    }
  }

  const api = {
    /** Shared, cached instance. Never mutate what comes out of here. */
    get(name) {
      if (materials.has(name)) return materials.get(name);
      if (!DEFS[name]) {
        console.warn(`[materials] unknown material "${name}" - falling back to soil`);
        return api.get("soil");
      }
      const material = buildMaterial(name);
      materials.set(name, material);
      return material;
    },

    /**
     * A private clone you may mutate.
     *   make("soil", { worldSize: 900 })   retile for a 900-unit mesh
     *   make("bark", { repeat: 12 })       explicit tiling
     *   make("leaf", { transmission: 0 })  cheap LOD variant
     */
    make(name, overrides = {}) {
      const source = api.get(name);
      const def = DEFS[name] || DEFS.soil;
      const material = source.clone();
      material.name = `${source.name}#`;

      const cfg = shaderConfig.get(source);
      if (cfg) attachShaderConfig(material, cfg);

      const rest = { ...overrides };
      let repeat = null;
      if (rest.worldSize !== undefined) { repeat = rest.worldSize / def.tile; delete rest.worldSize; }
      if (rest.repeat !== undefined) { repeat = rest.repeat; delete rest.repeat; }
      if (repeat !== null) retile(material, repeat);

      applyOverrides(material, rest);
      material.needsUpdate = true;
      return ctx.track(material);
    },

    /**
     * texture("soil")         albedo
     * texture("soil.normal")  tangent normal (A = height)
     * texture("soil.orm")     R = AO, G = roughness, B = metalness
     */
    texture(name) {
      return textures.get(name) || null;
    },

    list() { return Object.keys(DEFS); },

    /** World units one tile of this material is meant to cover. */
    tileUnits(name) { return (DEFS[name] || DEFS.soil).tile; },

    /** Repeat value that makes `name` sit at its intended scale on a mesh `worldSize` across. */
    repeatFor(name, worldSize) { return worldSize / (DEFS[name] || DEFS.soil).tile; },

    update(dt, context) {
      // Water: two normal layers crossing at an angle. The clearcoat layer
      // runs slower and against the flow so the interference never repeats.
      const t = context.time.elapsed;
      const a = textures.get("water.normal");
      const b = textures.get("water.normal2");
      if (a) a.offset.set(t * 0.017, t * 0.011);
      if (b) {
        b.center.set(0.5, 0.5);
        b.rotation = 0.9;
        b.offset.set(-t * 0.009, t * 0.021);
      }
    },

    report() {
      const perMaterial = {};
      for (const [name, entry] of bakedMaps) perMaterial[name] = entry.size;
      return {
        count: materials.size,
        registered: names.length,
        textures: textures.size,
        textureMemoryMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
        textureSizes: perMaterial,
        baseTextureSize: q.textureSize,
        bakeMs,
        gloss: glossStats,
        slowestBake: Object.entries(bakeTimes).sort((x, y) => y[1] - x[1]).slice(0, 3),
        canvas: canvasKind,
        anisotropy: Math.min(q.anisotropy, 16),
      };
    },

    dispose() {
      for (const material of materials.values()) material.dispose();
      for (const texture of textures.values()) texture.dispose();
      materials.clear();
      textures.clear();
    },
  };

  // Warm the cache so the first frame never compiles a material mid-flight.
  for (const name of names) api.get(name);

  return api;
}
