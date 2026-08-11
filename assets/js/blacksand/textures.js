/* ============================================================
   BLACKSAND - procedural texture synthesis

   Every surface texture in the game is generated here at load time.
   No downloads, no atlas, no licensing - and because the generators
   are seeded, a map looks identical for every player.

   Each material gets a full PBR set: albedo, normal, and one packed
   ORM+H texture (R = ambient occlusion, G = roughness, B = height).
   Normals are derived from the same height field that drives the
   albedo's shading, so the bump you see and the bump the light sees
   are the same bump. Painting a normal map that disagrees with the
   albedo is the single most common reason procedural surfaces look
   like plastic.

   Three decisions worth stating up front:

   * The noise is *periodic*, not "tileable by blending four lookups".
     The blend trick is seamless but averages four independent fields
     together toward the middle of the tile, so every texture had a
     washed-out centre and a crisp border. Periodic Perlin wraps the
     integer lattice instead: exact, uniform contrast, and a quarter
     of the cost.

   * Generators compose *fields* - whole-image scalar layers built once
     - rather than calling noise per texel per use. A 2048 texture is
     4.2M texels; evaluating an octave stack inside the shading loop
     costs seconds. Fields are also generated at a resolution matched
     to their own frequency and bilinearly upsampled, which is where
     most of the load time went.

   * Height rides in the ORM's blue channel rather than in the albedo's
     alpha. Alpha would be free, but any material asking for
     transparency would then be see-through in proportion to its own
     relief, and that bug is invisible until someone adds glass.
   ============================================================ */

import { makeRng, clamp, clamp01, lerp, smoothstep, smootherstep } from "./core.js";

/* ---------------------- the palette rotation ----------------------

   Every warm albedo in the game is rotated PALETTE_HUE degrees towards
   yellow as it is written. It is applied here, once, rather than by
   re-typing forty constants, because the constants are not the thing
   that was wrong with them - their RELATIONSHIPS are right and their
   common origin was not.

   Measured, and it is the largest single discrepancy in the project.
   blacksand-chroma-compare puts Battlefield 2's sunlit ground at hue
   48 and its shade at 63 - a yellow ochre. Ours measured 24 and 30 -
   terracotta. Six blind reviewers in a row described our frames as "a
   single swatch", "one hue at varying values" and "a filter", and none
   of them named this because none of them had the reference number.

   Why the frame is redder than any texture in it: colour here is a
   PRODUCT - albedo x wall tint x sun x AO - and hue is not preserved
   under multiplication of same-hue chromatic terms, it walks towards
   red. The census (blacksand-chroma-sweep --albedo) puts the albedos
   at hue 18-48, the saturation-weighted mean near 32, and the frame
   they end up in at 24.

   That also sets the GAIN, which is what makes this a measured number
   rather than a taste: rotating the albedos alone buys 0.39 of a
   degree at the frame per degree at the source (+18 -> +7, +35 -> +14,
   +50 -> +18, so it is mildly compressive).

   24, NOT the 55-60 that would satisfy the metric outright, and the
   difference is the whole judgement in this change. Rendered as a
   contact sheet across 0/14/26/40 and looked at rather than scored:
   by 40 the sand is olive and the plaster walls have gone frankly
   green, and 26 is about the last row that still reads as desert. The metric is a saturation-WEIGHTED mean hue, so it is set by
   the most chromatic surfaces in frame - our masonry - while
   Battlefield 2 earns the same number from genuinely yellow sand and
   from vegetation we do not have. Rotating far enough to match it
   turns our buildings green without making our sand any more like
   theirs, which is fitting the instrument instead of the picture.

   24 lands the frame at 36-41 against a 44-52 target and stops there,
   and the last four degrees were given up on sight rather than on the
   number: at 28 two of the ten gameplay frames had plaster walls
   reading frankly olive, which is a worse thing for a hostile reviewer
   to find than a hue that is still eight degrees short. The residual
   is reported rather than dialled out.

   Rotating structures.js's PLASTER tints as well was measured and
   dropped: those tints multiply masonry textures that have already
   been through this function, so it double-rotates. A +35 albedo
   rotation lands the frame at 38 with the tints left alone and 37 with
   them rotated too.

   Only the warm half of the wheel moves. Rotating the blue tarps and
   the green scrub by the same amount is a hue filter, and a filter is
   precisely what the reviewers keep calling this.

   Done in the authored sRGB values rather than in linear light,
   deliberately: the two agree to within a degree and a half over this
   palette (a +15 sRGB rotation measures +16.3 linear on sand), and
   the linear round trip costs two pow() calls on every texel of every
   2048 texture, which is seconds of load time for no visible gain. */
const PALETTE_HUE = 24;

function palette(r, g, b) {
  const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
  const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
  const d = mx - mn;
  // Greys carry no hue to rotate, and they are most of a concrete or
  // plaster texture, so this early-out is also the hot path.
  if (d < 1 / 512 || mx < 1 / 512) return null;
  let h;
  if (mx === r) h = 60 * (((g - b) / d) % 6);
  else if (mx === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  if (h >= 90 && h <= 330) return null;

  h += PALETTE_HUE;
  if (h >= 360) h -= 360;
  const hp = h / 60;
  const x = d * (1 - Math.abs((hp % 2) - 1));
  if (hp < 1) return [mn + d, mn + x, mn];
  if (hp < 2) return [mn + x, mn + d, mn];
  if (hp < 3) return [mn, mn + d, mn + x];
  if (hp < 4) return [mn, mn + x, mn + d];
  if (hp < 5) return [mn + x, mn, mn + d];
  return [mn + d, mn, mn + x];
}

/* --------------------------- helpers --------------------------- */

function makeCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

/** Next power of two at or above n. Field resolutions stay pow2 so the
 *  bilinear wrap can use a mask instead of a modulo. */
function pow2Ceil(n) {
  let v = 1;
  while (v < n) v <<= 1;
  return v;
}

/**
 * Periodic 2D Perlin. `period` is in lattice units and must be an
 * integer; the gradient lattice wraps at it, so any field sampled over
 * u,v in [0,1) at frequency == period tiles exactly.
 *
 * The gradient index comes from an integer hash rather than a
 * permutation table because a 256-entry table caps the usable period
 * at 256, and the grain fields want more than that.
 */
function makePeriodicNoise(seed) {
  const salt0 = (seed | 0) || 1;

  function hash(x, y, salt) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + salt + salt0) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  // Eight unit-ish gradients. Sixteen would band less, but at these
  // frequencies the extra directions are not visible and the table
  // lookup is on the hot path.
  const GX = [1, -1, 1, -1, 1, -1, 0, 0];
  const GY = [1, 1, -1, -1, 0, 0, 1, -1];

  function noise(x, y, period, salt) {
    const X = Math.floor(x);
    const Y = Math.floor(y);
    const xf = x - X;
    const yf = y - Y;

    let x0 = X % period; if (x0 < 0) x0 += period;
    let y0 = Y % period; if (y0 < 0) y0 += period;
    const x1 = x0 + 1 === period ? 0 : x0 + 1;
    const y1 = y0 + 1 === period ? 0 : y0 + 1;

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

  noise.hash01 = (x, y, salt) => hash(x, y, salt) / 4294967296;
  return noise;
}

const PERIODIC = makePeriodicNoise(0x51a9d);

function fbmPeriodic(x, y, freq, octaves = 4, gain = 0.5, salt = 0) {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let f = freq;
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * PERIODIC(x * f, y * f, f, salt + i * 7919);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / (norm || 1);
}

function ridgedPeriodic(x, y, freq, octaves = 4, gain = 0.5, salt = 0) {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let f = freq;
  for (let i = 0; i < octaves; i += 1) {
    const n = 1 - Math.abs(PERIODIC(x * f, y * f, f, salt + i * 7919));
    sum += amp * n * n;
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / (norm || 1);
}

/**
 * A scalar layer over the whole tile, materialised once.
 *
 * The resolution is chosen from the field's own top octave: a
 * frequency-4 field carries no information a 128px grid cannot hold,
 * and generating it at 2048 costs 256x more for an identical result.
 * Sampling is wrap-bilinear so the field stays seamless.
 */
function makeField(res, data) {
  const mask = res - 1;
  return {
    res,
    data,
    /** u,v in [0,1). */
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
    /** Nearest lookup, for anything that must not be smeared (cell ids). */
    near(u, v) {
      const x = Math.floor(u * res) & mask;
      const y = Math.floor(v * res) & mask;
      return data[y * res + x];
    },
  };
}

/** Field factory bound to one texture's output size. */
function makeFields(size, baseSalt) {
  let saltCounter = baseSalt * 104729;

  function resolutionFor(topFrequency, scale = 5) {
    return clamp(pow2Ceil(topFrequency * scale), 64, size);
  }

  return {
    /** Fractal noise in roughly -1..1. */
    fbm(freq, octaves = 4, gain = 0.5, resScale = 5) {
      const salt = (saltCounter += 2654435761) | 0;
      const top = freq * 2 ** (octaves - 1);
      const res = resolutionFor(top, resScale);
      const data = new Float32Array(res * res);
      for (let y = 0; y < res; y += 1) {
        const v = y / res;
        for (let x = 0; x < res; x += 1) {
          data[y * res + x] = fbmPeriodic(x / res, v, freq, octaves, gain, salt);
        }
      }
      return makeField(res, data);
    },

    /** Ridged multifractal in 0..1 - the shape that reads as fracture. */
    ridged(freq, octaves = 4, gain = 0.5, resScale = 6) {
      const salt = (saltCounter += 2654435761) | 0;
      const top = freq * 2 ** (octaves - 1);
      const res = resolutionFor(top, resScale);
      const data = new Float32Array(res * res);
      for (let y = 0; y < res; y += 1) {
        const v = y / res;
        for (let x = 0; x < res; x += 1) {
          data[y * res + x] = ridgedPeriodic(x / res, v, freq, octaves, gain, salt);
        }
      }
      return makeField(res, data);
    },

    /** Domain-warped fbm. Kills the axis-aligned look of plain fbm. */
    warped(freq, octaves = 4, strength = 0.55, resScale = 6) {
      const salt = (saltCounter += 2654435761) | 0;
      const top = freq * 2 ** (octaves - 1);
      const res = resolutionFor(top, resScale);
      const data = new Float32Array(res * res);
      for (let y = 0; y < res; y += 1) {
        const v = y / res;
        for (let x = 0; x < res; x += 1) {
          const u = x / res;
          const qx = fbmPeriodic(u, v, Math.max(2, freq >> 1), 2, 0.5, salt + 11);
          const qy = fbmPeriodic(u, v, Math.max(2, freq >> 1), 2, 0.5, salt + 23);
          // The warp offset has to be a whole number of periods or the
          // field stops tiling; scaling by 1/freq keeps it in tile space.
          data[y * res + x] = fbmPeriodic(
            u + (strength * qx) / freq, v + (strength * qy) / freq,
            freq, octaves, 0.5, salt
          );
        }
      }
      return makeField(res, data);
    },

    /**
     * Periodic Worley. Returns F1 (distance to the nearest feature
     * point, in cell units) and the nearest cell's hash, which is what
     * lets a generator give every pebble its own colour and height.
     */
    cell(period, jitter = 0.9, resScale = 24) {
      const salt = (saltCounter += 2654435761) | 0;
      const res = resolutionFor(period, resScale);
      const f1 = new Float32Array(res * res);
      const id = new Float32Array(res * res);
      const f2 = new Float32Array(res * res);
      for (let y = 0; y < res; y += 1) {
        const cv = (y / res) * period;
        const cy = Math.floor(cv);
        for (let x = 0; x < res; x += 1) {
          const cu = (x / res) * period;
          const cx = Math.floor(cu);
          let best = 1e9;
          let second = 1e9;
          let bestId = 0;
          for (let oy = -1; oy <= 1; oy += 1) {
            for (let ox = -1; ox <= 1; ox += 1) {
              const gx = cx + ox;
              const gy = cy + oy;
              let wx = gx % period; if (wx < 0) wx += period;
              let wy = gy % period; if (wy < 0) wy += period;
              const hx = PERIODIC.hash01(wx, wy, salt);
              const hy = PERIODIC.hash01(wx, wy, salt + 977);
              const px = gx + 0.5 + (hx - 0.5) * jitter;
              const py = gy + 0.5 + (hy - 0.5) * jitter;
              const d = (px - cu) * (px - cu) + (py - cv) * (py - cv);
              if (d < best) {
                second = best;
                best = d;
                bestId = PERIODIC.hash01(wx, wy, salt + 4231);
              } else if (d < second) second = d;
            }
          }
          const i = y * res + x;
          f1[i] = Math.sqrt(best);
          f2[i] = Math.sqrt(second);
          id[i] = bestId;
        }
      }
      return { f1: makeField(res, f1), f2: makeField(res, f2), id: makeField(res, id) };
    },
  };
}

/**
 * Build a tileable height field. `fn(u, v, x, y)` returns any range;
 * the result is normalised to 0..1 so downstream code can assume it.
 */
function heightField(size, fn) {
  const data = new Float32Array(size * size);
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const h = fn(x / size, y / size, x, y);
      data[y * size + x] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  const range = max - min || 1;
  for (let i = 0; i < data.length; i += 1) data[i] = (data[i] - min) / range;
  return data;
}

/** Legacy shim: the old blended-torus sampler, kept because other
 *  modules may already call it. Backed by the periodic noise now. */
function makeTileableNoise(seed) {
  const salt = (seed | 0) * 40503;
  return (u, v, frequency, octaves = 5, gain = 0.5) =>
    fbmPeriodic(u, v, Math.max(1, Math.round(frequency)), octaves, gain, salt);
}

/** Sobel the height field into a tangent-space normal map. */
function normalFromHeight(height, size, strength) {
  const out = new Uint8ClampedArray(size * size * 4);
  const mask = size - 1;
  const pow2 = (size & mask) === 0;
  const wrap = pow2 ? (v) => v & mask : (v) => ((v % size) + size) % size;
  const at = (x, y) => height[wrap(y) * size + wrap(x)];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const tl = at(x - 1, y - 1); const t = at(x, y - 1); const tr = at(x + 1, y - 1);
      const l = at(x - 1, y); const r = at(x + 1, y);
      const bl = at(x - 1, y + 1); const b = at(x, y + 1); const br = at(x + 1, y + 1);

      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

      let nx = -dx * strength;
      let ny = -dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len;
      const nzn = nz / len;

      const i = (y * size + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nzn * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Cheap ambient occlusion from the height field: compare each texel to
 * a ring around it at two radii. Concave texels darken. This is what
 * puts real dirt into mortar lines and panel gaps - and the generators
 * read it back, so lichen and dust land where they physically would.
 */
function aoField(height, size, radius, strength) {
  const out = new Float32Array(size * size);
  const mask = size - 1;
  const pow2 = (size & mask) === 0;
  const wrap = pow2 ? (v) => v & mask : (v) => ((v % size) + size) % size;
  const at = (x, y) => height[wrap(y) * size + wrap(x)];
  const offsets = [];
  for (let a = 0; a < 8; a += 1) {
    const angle = (a / 8) * Math.PI * 2;
    // Two radii: the inner ring finds crevices, the outer finds the
    // broad hollows a single ring reads as flat.
    offsets.push([Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius), 1.0]);
    offsets.push([Math.round(Math.cos(angle + 0.4) * radius * 2.6),
      Math.round(Math.sin(angle + 0.4) * radius * 2.6), 0.45]);
  }
  let weight = 0;
  for (const o of offsets) weight += o[2];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const h = at(x, y);
      let occ = 0;
      for (let k = 0; k < offsets.length; k += 1) {
        const o = offsets[k];
        occ += Math.max(0, at(x + o[0], y + o[1]) - h) * o[2];
      }
      out[y * size + x] = clamp01(1 - (occ / weight) * strength * 12);
    }
  }
  return out;
}

/** Legacy RGBA form of the above, kept for anything already using it. */
function aoFromHeight(height, size, radius, strength) {
  const f = aoField(height, size, radius, strength);
  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < f.length; i += 1) {
    const v = f[i] * 255;
    out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
  }
  return out;
}

export async function createTextures(ctx) {
  const { THREE, settings, render } = ctx;
  const SIZE = settings.q.textureSize;
  const cache = new Map();

  /* Surfaces the player's face is never 30cm from do not need the top
     tier's texel budget. Halving them is invisible and buys back most
     of the synthesis time at ultra. */
  const HALF_SIZE = new Set([
    "metal", "corrugated", "wood", "sandbag", "scrub", "rubble", "plaster", "drymud",
  ]);
  function sizeFor(name) {
    if (name === "macro") return Math.min(512, SIZE);
    return HALF_SIZE.has(name) ? Math.max(256, SIZE >> 1) : SIZE;
  }

  function toTexture(pixels, size, { srgb = false, repeat = 1 } = {}) {
    const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = render.anisotropy;
    texture.repeat.set(repeat, repeat);
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Turn a per-texel shader into a full PBR set.
   *
   * `shade(u, v, height, slope, rng, x, y, ao)` returns
   * [r, g, b, roughness] with everything in 0..1. Roughness rides in
   * the alpha slot and is split out afterwards, so a generator writes
   * one function rather than four. AO is handed in rather than left
   * for the caller to guess: dust, lichen and rust all accumulate
   * where the surface is occluded, and a generator that cannot see the
   * occlusion has to fake it with a second noise field that then
   * disagrees with the AO map.
   *
   * `options` may be a factory so an early cache hit skips field
   * generation entirely - the fields are the expensive part.
   */
  function synth(name, size, options) {
    if (cache.has(name)) return cache.get(name);
    const o = typeof options === "function" ? options() : options;
    const {
      heightFn, shade, normalStrength = 2.4, aoRadius = 3, aoStrength = 0.5,
    } = o;

    const height = heightField(size, heightFn);
    const ao = aoField(height, size, aoRadius, aoStrength);
    const albedo = new Uint8ClampedArray(size * size * 4);
    const orm = new Uint8ClampedArray(size * size * 4);
    const rng = makeRng(name.length * 7919 + 13);

    const mask = size - 1;
    const at = (x, y) => height[(y & mask) * size + (x & mask)];

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = y * size + x;
        const h = height[i];
        const slope = Math.hypot(at(x + 1, y) - at(x - 1, y), at(x, y + 1) - at(x, y - 1));
        const [r, g, b, ro] = shade(x / size, y / size, h, slope, rng, x, y, ao[i]);
        const j = i * 4;
        // Applied here rather than inside each generator so it also
        // covers the surfaces structures.js registers through synth().
        const p = palette(r, g, b);
        albedo[j] = clamp01(p ? p[0] : r) * 255;
        albedo[j + 1] = clamp01(p ? p[1] : g) * 255;
        albedo[j + 2] = clamp01(p ? p[2] : b) * 255;
        albedo[j + 3] = 255;
        orm[j] = ao[i] * 255;
        orm[j + 1] = clamp01(ro) * 255;
        orm[j + 2] = h * 255;
        orm[j + 3] = 255;
      }
    }

    // One texture serves as both roughnessMap (.g) and aoMap (.r);
    // three samples exactly those channels, so packing them costs
    // nothing and halves the uploads.
    const ormTexture = toTexture(orm, size);

    const set = {
      map: toTexture(albedo, size, { srgb: true }),
      normalMap: toTexture(normalFromHeight(height, size, normalStrength), size),
      roughnessMap: ormTexture,
      aoMap: ormTexture,
      ormMap: ormTexture,
      height,
      size,
    };
    cache.set(name, set);
    return set;
  }

  /* ------------------------- generators ------------------------- */

  /* Albedos below are authored as sRGB texel values for physically
     plausible *linear* reflectance: dry sand ~0.36, limestone ~0.32,
     concrete ~0.25, asphalt ~0.06. The lighting grade is somebody
     else's job; darkening these to compensate for an exposure fault
     would bake the fault into the material for good. */

  const GENERATORS = {
    /**
     * Wind-rippled desert sand.
     *
     * Aeolian ripples are not sinusoidal. They have a long shallow
     * windward slope and a short steep lee face, their crests are
     * sinuous and bifurcate, and - the detail that sells it - the
     * crests carry the *coarse* grains while the troughs collect fine
     * sand and dark heavy-mineral laminae. Colour comes from that
     * mineral sorting rather than from a single hue lerp, which is why
     * the surface still reads as sand when the sun moves.
     */
    sand(size) {
      return synth("sand", size, () => {
        const F = makeFields(size, 11);
        const dune = F.fbm(3, 3, 0.55);
        const patch = F.fbm(5, 3, 0.5);
        const warp = F.warped(7, 4, 0.7);
        const swirl = F.fbm(3, 2, 0.5);
        const mineral = F.fbm(11, 4, 0.6);
        const hue = F.fbm(2, 2, 0.5);
        const coarse = F.fbm(34, 2, 0.5);
        /* Granules, not pebbles. At 20 cells the "pebbles" were 17cm
           underfoot - already generous for a dune - and the terrain
           splat also tiles this texture at 13.7m, where they came out
           as 70cm polka dots strewn across every hillside. 46 cells is
           7cm near and 30cm at the mid rate, and the albedo step below
           is now small enough that the mid rate reads as grain rather
           than as spots. */
        const peb = F.cell(46, 0.9, 14);

        // Integer wave numbers: the ripple train has to close on itself
        // across the tile or the seam is a visible scar.
        const RU = 27; const RV = 8;
        const CU = 7; const CV = -19;

        const ripplesAt = (u, v) => {
          const w = warp.at(u, v);
          const s = swirl.at(u, v);
          const phase = u * RU + v * RV + w * 2.4 + s * 1.1;
          const t = phase - Math.floor(phase);
          const prof = t < 0.66
            ? Math.pow(t / 0.66, 1.55)
            : Math.pow(1 - (t - 0.66) / 0.34, 0.55);
          // A coarser granule-ripple train crossing at a shallow angle.
          // Two trains at different angles is what stops the surface
          // reading as corduroy at any viewing distance.
          const phase2 = u * CU + v * CV + w * 1.6;
          const t2 = phase2 - Math.floor(phase2);
          const prof2 = t2 < 0.6
            ? Math.pow(t2 / 0.6, 1.7)
            : Math.pow(1 - (t2 - 0.6) / 0.4, 0.6);
          const blend = clamp01(s * 1.5 + 0.45);
          const present = clamp01((patch.at(u, v) + 0.34) * 1.9);
          return { profile: lerp(prof, prof2, blend), present };
        };

        return {
          heightFn: (u, v, x, y) => {
            const { profile, present } = ripplesAt(u, v);
            const d = peb.f1.at(u, v);
            const radius = 0.20 + peb.id.near(u, v) * 0.22;
            const pebble = clamp01((radius - d) * 6) ** 0.6;
            // Coarse grains sit high on the crests, fine sand fills the
            // troughs - so grain amplitude tracks the ripple profile.
            const grain = (coarse.at(u, v) * 0.5 + 0.5) * (0.35 + profile * 0.9);
            // Granules sit in the troughs, where the saltation load
            // drops them - not on the crests. Riding them at full
            // amplitude everywhere turned the ripple field into an
            // even sandpaper stipple that read as poured concrete.
            return dune.at(u, v) * 0.30
              + profile * present * 0.50
              + grain * 0.10
              + pebble * 0.07 * (1.0 - profile * 0.7);
          },

          shade: (u, v, h, slope, rng, x, y, ao) => {
            const { profile, present } = ripplesAt(u, v);
            const m = mineral.at(u, v);
            const tone = hue.at(u, v);

            /* Three mineral populations, mixed by sorting rather than
               by height: quartz-rich pale sand, iron-stained feldspar,
               and dark heavy-mineral laminae that streak the lee faces.

               Measured, not guessed. The median texel used to land at
               linear hue 29.8 / saturation 0.667, and every other
               surface in the game sat inside hue 26.6-47.8 - dirt
               0.679, gravel 0.688, sandbag 0.689, wood 0.708, metal
               0.744. Six surfaces inside 0.08 of one saturation is the
               "nothing separates" a blind reviewer called out, and sand
               is the one that covers most of the screen, so it is the
               one that has to move. These land the median at hue 33 /
               saturation 0.50 with the luminance held at 0.37, which
               is a real dry quartz dune rather than an orange one.
               The two ends also now differ in CHROMA, not just value:
               clean quartz at 0.40 against iron-stained at 0.61, so the
               mineral sorting is visible as a second axis instead of
               reading as one colour at two brightnesses. */
            const quartz = [0.770, 0.712, 0.610];
            const iron = [0.640, 0.545, 0.420];
            const heavy = [0.315, 0.280, 0.285];

            const ironMix = clamp01(tone * 1.25 + 0.48);
            let r = lerp(quartz[0], iron[0], ironMix);
            let g = lerp(quartz[1], iron[1], ironMix);
            let b = lerp(quartz[2], iron[2], ironMix);

            // Heavy minerals concentrate where the ripple is *low* and
            // the local supply is high - thin dark stripes parallel to
            // the crests, the single most recognisable sand detail.
            const laminae = clamp01((m * 1.6 + 0.28) * (1.0 - profile) * present * 2.1 - 0.42);
            r = lerp(r, heavy[0], laminae * 0.85);
            g = lerp(g, heavy[1], laminae * 0.85);
            b = lerp(b, heavy[2], laminae * 0.85);

            // Granules read cooler and greyer than the sand around
            // them, but only slightly: a strong tone step here is what
            // turned the mid tiling rate into a field of polka dots.
            const d = peb.f1.at(u, v);
            const pid = peb.id.near(u, v);
            const radius = 0.20 + pid * 0.22;
            const pebble = clamp01((radius - d) * 8);
            const pTone = 0.58 + pid * 0.20;
            const pw = pebble * 0.26 * (1 - profile * 0.7);
            r = lerp(r, pTone * 1.04, pw);
            g = lerp(g, pTone * 1.0, pw);
            b = lerp(b, pTone * 0.94, pw);

            // Sun-facing crests bleach; shaded troughs hold moisture and
            // shadow. AO carries most of that, this is the albedo half.
            const bleach = profile * present * 0.055;
            const shade = (1 - ao) * 0.16;
            const speckle = (rng() - 0.5) * 0.040;

            // Roughness is where sand stops looking like a painted
            // surface. Quartz-rich crests wind-polish to a faint sheen
            // (0.78); the fine trough sand and the dark laminae stay
            // fully diffuse. One value for the whole texture is what
            // makes a dune read as felt.
            const rough = 0.985
              - profile * present * 0.16
              // Granules are quartz and they do take a polish, but at
              // a 0.30 delta they dropped to 0.66 and a twelve-degree
              // sun turned the whole ripple field into glitter. 0.16
              // keeps the sheen and loses the sparkle.
              - pebble * 0.16
              + laminae * 0.01
              + (rng() - 0.5) * 0.03;
            return [
              r + bleach - shade + speckle,
              g + bleach * 0.97 - shade + speckle,
              b + bleach * 0.9 - shade * 1.1 + speckle * 0.85,
              rough,
            ];
          },
          /* Calibrated, not guessed. The height field is normalised to
             0..1 over a tile that is 3.4m on the terrain, so a ripple
             half-wave is 6cm of run against about 1.5cm of rise - a
             real slope of ~14 degrees. The Sobel of the normalised
             field over that span is ~0.046, so the strength that
             reproduces 14 degrees is tan(14)/0.046 = 5.4. At the old
             2.1 the ripples tilted the normal by five degrees and
             disappeared the moment the sun came round in front. */
          normalStrength: 5.4,
          aoRadius: 3,
          aoStrength: 0.55,
        };
      });
    },

    /**
     * Graded, compacted ground: the surface of a vehicle track, a
     * bulldozed compound floor, the scoured terrace of a wadi. This is
     * what the terrain splat lays down wherever the map generator
     * flattened something, so it covers more screen than any other
     * surface in a built-up frame.
     *
     * It used to be authored as desiccation-cracked mud at nine
     * polygons per tile. At the terrain's 13.7m mid rate that put
     * 1.5-metre crazed plates across every street, and the whole town
     * read as a cracked ceramic floor. Desiccation belongs to `drymud`,
     * which exists for exactly that. Here the cracking is a fine
     * hairline craze at 34 cells per tile - 10cm underfoot - and the
     * character comes from what actually distinguishes compacted
     * ground: wheel-polished smears, embedded grit, a skim of
     * wind-blown sand, and broad tonal mottling.
     */
    dirt(size) {
      return synth("dirt", size, () => {
        const F = makeFields(size, 23);
        const broad = F.warped(4, 4, 0.6);
        const craze = F.cell(52, 0.85, 14);
        const scuff = F.warped(7, 3, 0.9);
        const fine = F.fbm(26, 3, 0.5);
        const grit = F.cell(58, 1.0, 12);
        const stain = F.fbm(6, 3, 0.55);
        const tone = F.fbm(3, 2, 0.5);
        const skim = F.warped(9, 3, 0.8);

        const crazeAt = (u, v) => clamp01(1 - (craze.f2.at(u, v) - craze.f1.at(u, v)) * 15.0);

        return {
          heightFn: (u, v) => {
            const crack = crazeAt(u, v);
            const gr = clamp01(0.09 - grit.f1.at(u, v)) * 7;
            // Compacted ground is *smooth* at the centimetre scale;
            // its relief is the broad ruck of a graded surface plus
            // whatever grit the blade left proud.
            return broad.at(u, v) * 0.34
              + (scuff.at(u, v) * 0.5 + 0.5) * 0.20
              + (fine.at(u, v) * 0.5 + 0.5) * 0.10
              // The craze lives here and in the AO derived from it -
              // NOT in the albedo. A crack is a geometric feature: it
              // is dark because it is occluded, and occlusion under a
              // sky is never more than a partial loss of the ambient
              // term. Painted into the albedo it goes on being dark
              // when the light says it should not be, and a floor of
              // near-black lines under an open sky is the single most
              // obvious "this is a texture" tell there is.
              - Math.pow(crack, 2.2) * 0.26
              + gr * 0.13
              + 0.5;
          },
          shade: (u, v, h, slope, rng, x, y, ao) => {
            const crack = crazeAt(u, v);
            const t = clamp01(tone.at(u, v) * 1.3 + 0.5);
            const sc = clamp01(scuff.at(u, v) * 1.5 + 0.5);
            // Pale sun-bleached crust over damp brown silt. Where the
            // crust has been scuffed through, the darker fill shows.
            /* Blues raised across all three. This tile measured hue
               28.9 / saturation 0.679, i.e. inside 0.01 of gravel and
               inside 0.02 of sandbag, wood and metal - five surfaces
               separated by nothing but value. A sun-bleached crust is
               the LEAST chromatic thing on a desert floor and it had
               the most saturation of any ground layer. The warm ochre
               end keeps its character; it just no longer sets the
               median. */
            const crust = [0.645, 0.585, 0.500];
            const scuffed = [0.415, 0.360, 0.300];
            const ochre = [0.560, 0.452, 0.340];

            const base = [
              lerp(crust[0], ochre[0], t),
              lerp(crust[1], ochre[1], t),
              lerp(crust[2], ochre[2], t),
            ];
            let r = lerp(base[0], scuffed[0], sc * 0.55);
            let g = lerp(base[1], scuffed[1], sc * 0.55);
            let b = lerp(base[2], scuffed[2], sc * 0.55);
            // Silt really does fall into a crack and it really is a
            // slightly different colour from the crust either side -
            // but the term is a couple of per cent, not a black line.
            // Everything the crack does visually is carried by the
            // normal map and the AO field derived from the height.
            const inCrack = clamp01(crack * 1.8 - 0.60);
            r -= inCrack * 0.022; g -= inCrack * 0.020; b -= inCrack * 0.014;

            // Loose grit sitting on the crust.
            const gr = clamp01((0.10 - grit.f1.at(u, v)) * 10);
            const gTone = 0.50 + grit.id.near(u, v) * 0.22;
            r = lerp(r, gTone * 1.05, gr * 0.7);
            g = lerp(g, gTone * 0.99, gr * 0.7);
            b = lerp(b, gTone * 0.88, gr * 0.7);

            // A skim of drifted sand lying over the compacted surface -
            // the pale patchwork that says wind, not water.
            const drift = clamp01(skim.at(u, v) * 1.9 - 0.35) * (1 - gr);
            r = lerp(r, 0.700, drift * 0.42);
            g = lerp(g, 0.615, drift * 0.42);
            b = lerp(b, 0.470, drift * 0.42);

            const salt = clamp01(stain.at(u, v) * 1.8 - 0.55) * 0.09;
            // The craze AO is deep here by design, and it also ships in
            // the ORM, so a large term makes the tile pay for it twice.
            const occ = (1 - ao) * 0.15;
            // Wheel-burnished ground genuinely is smoother than raw
            // silt: the smear reads at 0.72 against 0.99 for the crust.
            const rough = 0.99 - sc * 0.27 - gr * 0.16 + inCrack * 0.01 - drift * 0.03;
            return [
              r + salt - occ,
              g + salt - occ,
              b + salt * 0.9 - occ,
              rough,
            ];
          },
          normalStrength: 3.4,
          aoRadius: 4,
          // Raised with the crack depth: the AO map is now the whole
          // of the craze's visual weight, so it has to carry it.
          aoStrength: 1.05,
        };
      });
    },

    /**
     * Weathered limestone. Bedding planes with per-bed hardness, two
     * joint families, and lichen/dust that accumulates by occlusion -
     * differential weathering is what stops a rock face reading as
     * grey noise.
     */
    rock(size) {
      return synth("rock", size, () => {
        const F = makeFields(size, 37);
        const bedWarp = F.warped(3, 3, 0.9);
        // Joint fields are sampled at a generous resolution scale.
        // A ridged multifractal raised to a high power makes a crest
        // one or two texels wide; at the old resScale the crest sat at
        // the field's own Nyquist and every cliff face carried a
        // shimmering hash of white filaments that no mip chain could
        // remove, because the aliasing was baked into the source.
        const jointA = F.ridged(9, 4, 0.55, 14);
        const jointB = F.ridged(6, 3, 0.5, 16);
        const blockF = F.warped(5, 3, 0.9);
        const rubble = F.cell(14, 0.95, 22);
        const grain = F.fbm(40, 2, 0.5);
        const ironF = F.fbm(5, 3, 0.55);
        const lichenF = F.warped(13, 3, 0.8);

        // Six beds, not nine. The terrain projects this at an 8m tile,
        // so nine beds is a 90cm lamination and the cliff reads as
        // layered pastry; six gives 1.35m beds, which is the thickness
        // a massive limestone actually parts at.
        const BEDS = 6;
        // Joint columns per tile. Both must be integers, and the
        // conjugate set's v coefficient too, or the tile stops closing
        // on itself.
        const JOINTS = 5;
        const JOINTS2 = 4;
        const JOINTS2_V = 3;
        // Per-bed hardness, hashed off the bed index so the sequence is
        // stable: soft beds recess, hard beds stand proud and overhang.
        const hardness = [];
        for (let i = 0; i < BEDS; i += 1) {
          hardness.push(0.25 + PERIODIC.hash01(i, 91, 5501) * 0.75);
        }

        /* Near-vertical joint set.
         *
         * A stratified face with only bedding-parallel relief is
         * plywood, whatever else is layered on it: the eye reads
         * continuous horizontal bands and stops looking. Limestone
         * fails on two conjugate joint sets as well, and it is the
         * *vertical* one that breaks the face into blocks and gives it
         * a readable size. It is built as a phase train rather than a
         * field because makeFields has one frequency for both axes,
         * and a field stretched in v stops tiling. */
        const jointVAt = (u, v, bedIndex) => {
          // Offset per bed. A joint that runs unbroken through every
          // bed makes a lattice, and a lattice reads as crazy paving;
          // real jointing terminates at the parting and restarts
          // somewhere else in the bed above.
          const phase = u * JOINTS
            + PERIODIC.hash01(bedIndex, 17, 4441) * 0.9
            + jointB.at(u, v) * 1.15
            + bedWarp.at(u, v) * 0.55;
          const t = Math.abs(phase - Math.floor(phase) - 0.5) * 2;
          return 1 - smoothstep(t * 3.4);
        };

        /* Conjugate joint set, crossing the first at a shallow angle.
         *
         * Two *linear* systems crossing cut a face into parallelograms,
         * which is what jointed rock looks like. A ridged multifractal
         * cuts it into rounded equant cells, which is what dried mud
         * looks like - and with two ridged sets doing most of the work
         * this cliff read as blown-up mud crack however good the
         * bedding was. The ridged sets are still here, but demoted to
         * the roughening they are good at. */
        const jointWAt = (u, v, bedIndex) => {
          const phase = u * JOINTS2 + v * JOINTS2_V
            + PERIODIC.hash01(bedIndex, 29, 7717) * 0.9
            + blockF.at(u, v) * 1.05;
          const t = Math.abs(phase - Math.floor(phase) - 0.5) * 2;
          return 1 - smoothstep(t * 3.0);
        };

        /* Two warps, at different scales. The broad one alone made the
           bed boundaries into long smooth sinuous curves and the whole
           cliff read as a contour map - the wrong kind of legible. The
           fine one ravels the edge of every parting so the boundary is
           a broken line of blocks, which is what a jointed limestone
           bedding plane actually looks like. */
        const bedAt = (u, v) => {
          const warped = v * BEDS
            + bedWarp.at(u, v) * 0.85
            + blockF.at(u, v) * 0.42
            + jointB.at(u, v) * 0.20;
          const index = Math.floor(warped);
          const frac = warped - index;
          return { index: ((index % BEDS) + BEDS) % BEDS, frac };
        };

        return {
          heightFn: (u, v) => {
            const bed = bedAt(u, v);
            const hard = hardness[bed.index];
            // Recessed soft beds, with the parting plane cut at the
            // boundary between them.
            const parting = 1 - smoothstep(Math.min(bed.frac, 1 - bed.frac) * 7.5);
            // Exponents dropped from 5/7 to 3/4. The joint still reads
            // as a crack, but its walls are two or three texels of ramp
            // instead of one texel of cliff, which is the difference
            // between relief and aliasing.
            const ja = Math.pow(clamp01(jointA.at(u, v)), 3) * 1.0;
            const jb = Math.pow(clamp01(jointB.at(u, v)), 4) * 0.75;
            // Cross-jointing: without something cutting *across* the
            // bedding, a stratified face is plywood. Blocks bounded by
            // the joint set stand at their own depth.
            const blk = blockF.at(u, v);
            const jv = jointVAt(u, v, bed.index);
            const jw = jointWAt(u, v, bed.index);
            const chip = clamp01(0.13 - rubble.f1.at(u, v)) * 4.5;
            /* Weighted toward the two *rectilinear* systems - bedding
               and the vertical joint set - and away from the equant
               warped field. Balanced the other way the face broke into
               rounded polygons and read as blown-up dried mud rather
               than as a jointed rock wall. */
            return hard * 0.36
              + blk * 0.07
              + (grain.at(u, v) * 0.5 + 0.5) * 0.10 * hard
              + chip * 0.14
              - parting * 0.32
              - jv * 0.22
              - jw * 0.15
              - ja * 0.06 * (1.3 - hard)
              - jb * 0.04
              + 0.5;
          },
          shade: (u, v, h, slope, rng, x, y, ao) => {
            const bed = bedAt(u, v);
            const hard = hardness[bed.index];
            // Hard beds are cleaner and paler; soft beds are marly and
            // browner because they shed dust that then sticks to them.
            // The two tones sit closer together than they used to: at
            // the terrain's 8m tile a 30% albedo step between beds made
            // every cliff read as laminated plywood. The bedding is
            // carried by relief and occlusion; the albedo only hints.
            /* Cooler and less chromatic than they were, and the reason
               is the sand rather than the rock. Pulling sand's median
               saturation from 0.667 to 0.50 closed the gap to rock's
               0.401 to almost nothing, and a cliff the same colour as
               the dune below it has no silhouette. Weathered limestone
               under a desert sky really is a pale grey-buff - the warm
               note comes from the iron staining below each hard bed,
               which is local, and that stays. Median lands near hue 42
               / saturation 0.28, so rock now separates from sand by
               chroma and hue instead of by value alone. */
            const pale = [0.648, 0.628, 0.596];
            const marl = [0.552, 0.522, 0.472];

            const t = clamp01(hard * 1.15 - 0.10);
            let r = lerp(marl[0], pale[0], t);
            let g = lerp(marl[1], pale[1], t);
            let b = lerp(marl[2], pale[2], t);

            // Per-block tone, decorrelated from the bedding, so the
            // face breaks into masonry-like units rather than stripes.
            const blk = blockF.at(u, v) * 0.11;
            r += blk; g += blk * 0.96; b += blk * 0.88;

            // The vertical joints are damp, shadowed and dust-filled;
            // giving them a tone as well as relief is what makes the
            // face read as blocks rather than as a bumped stripe.
            const jv = jointVAt(u, v, bed.index);
            const jw = jointWAt(u, v, bed.index);
            r -= jv * 0.055 + jw * 0.038;
            g -= jv * 0.052 + jw * 0.036;
            b -= jv * 0.044 + jw * 0.030;

            // Iron staining, strongest just below a hard bed where water
            // runs out along the parting.
            const iron = clamp01(ironF.at(u, v) * 1.4 + 0.35)
              * clamp01(1 - Math.abs(bed.frac - 0.12) * 5);
            r += iron * 0.115; g += iron * 0.055; b += iron * 0.010;

            // Dust and lichen collect in the occluded parts. Driving
            // both from AO is what makes the crevices read as depth
            // rather than as a painted dark line.
            const cavity = 1 - ao;
            const dust = clamp01(cavity * 1.5 - 0.10);
            r = lerp(r, 0.590, dust * 0.34);
            g = lerp(g, 0.556, dust * 0.34);
            b = lerp(b, 0.492, dust * 0.34);

            const lichen = clamp01(lichenF.at(u, v) * 2.0 - 0.55) * clamp01(cavity * 2.2);
            r = lerp(r, 0.300, lichen * 0.55);
            g = lerp(g, 0.330, lichen * 0.55);
            b = lerp(b, 0.245, lichen * 0.55);

            const occ = cavity * 0.20;
            const speckle = (rng() - 0.5) * 0.035;
            // Hard, dense beds take a polish where they are exposed;
            // marl and the dusty crevices stay matte. That spread is
            // the only thing that separates limestone from plasterboard
            // once the sun is off-axis.
            const rough = 0.96 - t * 0.28 - iron * 0.05 + dust * 0.06 + lichen * 0.04;
            return [
              r - occ + speckle,
              g - occ + speckle,
              b - occ + speckle,
              rough,
            ];
          },
          // 4.2 turned the joint crests into mirror-bright filaments.
          // 2.9 keeps the relief and loses the hash.
          normalStrength: 2.9,
          aoRadius: 5,
          aoStrength: 1.05,
        };
      });
    },

    /**
     * Desert pavement / wadi gravel. Well-sorted rounded clasts sitting
     * on a fine matrix - the surface that armours everything the wind
     * has stripped of sand, and the correct floor for a dry riverbed.
     */
    gravel(size) {
      return synth("gravel", size, () => {
        const F = makeFields(size, 53);
        /* Clast sizes are set against the *coarsest* rate this texture
           is tiled at, not the finest. The terrain splat samples it at
           3.4m and again at 13.7m; at 15 cells the big clasts were
           23cm underfoot, which is right, and 90cm at the mid rate,
           which is a boulder field seen from a hilltop. 24 cells puts
           them at 14cm and 53cm - still coarse at range, but the
           distance detail-blend takes the rest. */
        const big = F.cell(24, 0.95, 20);
        const mid = F.cell(44, 1.0, 11);
        const small = F.cell(84, 1.0, 12);
        const matrix = F.fbm(30, 3, 0.5);
        const patch = F.fbm(4, 3, 0.5);
        const tone = F.fbm(3, 2, 0.5);

        const stoneAt = (u, v) => {
          const rBig = 0.30 + big.id.near(u, v) * 0.16;
          const dBig = clamp01((rBig - big.f1.at(u, v)) / rBig);
          const rMid = 0.30 + mid.id.near(u, v) * 0.16;
          const dMid = clamp01((rMid - mid.f1.at(u, v)) / rMid);
          const rSm = 0.34 + small.id.near(u, v) * 0.14;
          const dSm = clamp01((rSm - small.f1.at(u, v)) / rSm);
          // Coverage falls off in patches so the matrix shows through -
          // a wall-to-wall clast field looks like bubble wrap.
          const cover = clamp01(patch.at(u, v) * 1.5 + 0.62);
          return { dBig, dMid, dSm, cover };
        };

        return {
          heightFn: (u, v) => {
            const s = stoneAt(u, v);
            // Domes, not discs: sqrt of the normalised radius gives the
            // rounded shoulder a water-worn clast actually has.
            const dome = Math.sqrt(s.dBig) * 0.50 * s.cover
              + Math.sqrt(s.dMid) * 0.30
              + Math.sqrt(s.dSm) * 0.16;
            return dome + (matrix.at(u, v) * 0.5 + 0.5) * 0.12 + 0.2;
          },
          shade: (u, v, h, slope, rng, x, y, ao) => {
            const s = stoneAt(u, v);
            const t = clamp01(tone.at(u, v) * 1.2 + 0.5);
            // Matrix is fine buff silt; clasts run from pale limestone
            // through chert grey to iron-varnished brown.
            //
            /* A mature desert pavement is DARK - manganese varnish
               drops its reflectance to 0.12-0.20 linear against dune
               sand at 0.35-0.40. Weighting the lithologies toward
               limestone put the lag within a few per cent of the sand
               it is supposed to contrast with, and cost the map the one
               large-scale albedo boundary a real desert basin has.

               That target was right and the tile missed it: measured
               off the finished texels the median came out at 0.072
               linear, which is DARKER THAN ASPHALT (0.083) and half the
               bottom of the intended band. The cause is the occlusion
               term below being subtracted in the albedo as well as
               shipped in the ORM, so a surface built out of domed
               clasts pays for its own AO twice. Raised to land the
               median at ~0.15 linear, and the blues come up with it:
               at saturation 0.688 the lag was inside 0.01 of dirt and
               0.02 of sand, so the one boundary this texture exists to
               draw was being drawn in value alone. */
            let r = lerp(0.560, 0.492, t);
            let g = lerp(0.500, 0.440, t);
            let b = lerp(0.418, 0.372, t);

            const paint = (mask, id) => {
              if (mask <= 0.001) return;
              const k = id;
              const lith = k < 0.26 ? 0 : k < 0.58 ? 1 : 2;
              const cols = [
                [0.645, 0.610, 0.545],   // limestone
                [0.400, 0.392, 0.382],   // chert
                [0.418, 0.316, 0.238],   // varnished
              ][lith];
              const v2 = 0.86 + k * 0.30;
              const w = clamp01(mask * 1.5);
              r = lerp(r, cols[0] * v2, w);
              g = lerp(g, cols[1] * v2, w);
              b = lerp(b, cols[2] * v2, w);
            };
            paint(s.dSm * 0.75, small.id.near(u, v));
            paint(s.dMid * 0.85, mid.id.near(u, v));
            paint(s.dBig * s.cover, big.id.near(u, v));

            // 0.16, not 0.30. The ORM ships the same occlusion field to
            // the shader, so anything here is paid twice - and on a
            // surface made of domed clasts the AO field is deep.
            const occ = (1 - ao) * 0.16;
            const speckle = (rng() - 0.5) * 0.045;
            const stone = clamp01(s.dBig * s.cover + s.dMid * 0.8);
            // Desert varnish is a genuinely glossy manganese film, and
            // wind-blasted chert polishes. A desert pavement in raking
            // light is a field of glints against a matte silt matrix -
            // flatten that to one roughness and the surface dies.
            const varnish = clamp01(tone.at(u, v) * 1.4 + 0.5);
            const rough = 0.97 - stone * (0.30 + varnish * 0.22);
            return [
              r - occ + speckle,
              g - occ + speckle,
              b - occ + speckle,
              rough,
            ];
          },
          normalStrength: 4.0,
          aoRadius: 4,
          aoStrength: 1.0,
        };
      });
    },

    /**
     * Poured concrete. Board-formed: horizontal form lines with
     * tie-rod holes, aggregate showing where the skin has spalled,
     * rust bleeding out of the reinforcement, and vertical water
     * staining under every horizontal edge.
     */
    concrete(size) {
      return synth("concrete", size, () => {
        const F = makeFields(size, 71);
        const broad = F.warped(4, 4, 0.55);
        const fine = F.fbm(20, 3, 0.5);
        const agg = F.cell(40, 1.0, 16);
        // Fines are an fbm rather than a second Worley: a Worley fine
        // enough to resolve 3mm sand needs a 2048 field and costs more
        // than every other concrete field put together, and after the
        // bilinear upsample it is indistinguishable from noise anyway.
        const fines = F.fbm(56, 2, 0.5, 6);
        const voids = F.cell(58, 1.0, 9);
        const spall = F.warped(6, 3, 0.9);
        const streakF = F.fbm(14, 3, 0.6);
        const grimeF = F.warped(3, 3, 0.8);
        const rustF = F.fbm(7, 3, 0.55);
        const boards = 7;
        const bays = 2;

        // Board offsets: real formwork is not laid to the millimetre,
        // and the tiny step between boards is the tell that says
        // "poured in place" rather than "grey plastic".
        const boardStep = [];
        for (let i = 0; i < boards; i += 1) boardStep.push((PERIODIC.hash01(i, 3, 8117) - 0.5) * 0.11);

        const formAt = (v) => {
          const f = v * boards;
          const index = Math.floor(f);
          const frac = f - index;
          return { index: ((index % boards) + boards) % boards, frac };
        };

        /** Vertical day-joint between pours, one per bay. */
        const bayAt = (u) => {
          const f = u * bays;
          return Math.abs(f - Math.floor(f) - 0.5) * 2;
        };

        /* Exposed aggregate is not a spalling artifact. Every formed
           face has the coarse stone sitting just under a 2mm skin of
           laitance, and weathering brings it through everywhere the
           surface has been rained on - which is the whole outside of a
           building. Gating it behind `spall` (as this generator used
           to) left about four per cent of the texture with any stone
           in it at all, and the other ninety-six read as painted card. */
        const aggAt = (u, v) => {
          const sp = clamp01(spall.at(u, v) * 1.6 - 0.62);
          const weather = clamp01(broad.at(u, v) * 1.3 + 0.55);
          return {
            sp,
            coarse: clamp01((0.155 - agg.f1.at(u, v)) * 8) * (0.42 + weather * 0.35 + sp * 0.8),
            fines: clamp01(fines.at(u, v) * 2.4 + 0.35) * (0.30 + weather * 0.30),
          };
        };

        return {
          heightFn: (u, v) => {
            const board = formAt(v);
            const seam = 1 - smoothstep(Math.min(board.frac, 1 - board.frac) * 13);
            const day = 1 - smoothstep(bayAt(u) * 16);
            const step = boardStep[board.index];
            const tie = (() => {
              // Tie-rod holes on a grid, two per board.
              const gu = u * 4;
              const cu = Math.abs(gu - Math.floor(gu) - 0.5);
              const cv = Math.abs(board.frac - 0.5);
              return clamp01(1 - Math.hypot(cu * 2.6, cv * 2.2) * 7);
            })();
            const a = aggAt(u, v);
            // Blowholes: the trapped air bubbles against the shutter
            // face. Small, round, and everywhere - and the single
            // cheapest cue that a wall was cast rather than modelled.
            const blow = clamp01((0.09 - voids.f1.at(u, v)) * 12);
            // Arris damage: the corner of every board line chips off.
            const chip = clamp01(spall.at(u, v) * 2.2 + 0.35) * seam;
            return broad.at(u, v) * 0.16
              + (fine.at(u, v) * 0.5 + 0.5) * 0.12
              + step
              + a.coarse * 0.20
              + a.fines * 0.07
              - blow * 0.16
              - a.sp * 0.20
              - seam * 0.22
              - chip * 0.10
              - day * 0.14
              - tie * 0.35
              + 0.5;
          },
          shade: (u, v, h, slope, rng, x, y, ao) => {
            const board = formAt(v);
            // sRGB 0.545 -> linear ~0.25, the correct albedo for
            // weathered structural concrete.
            let base = 0.545 + broad.at(u, v) * 0.070 + boardStep[board.index] * 0.45;

            // Water runs off the bottom edge of each board and streaks
            // vertically below it, strongest right under the seam - and
            // it carries the dirt off the face above with it, so the
            // streak is a stain rather than a shadow.
            const under = clamp01(1 - board.frac * 2.4);
            const streak = clamp01(streakF.at(u, v) * 1.7 + 0.15) * under;
            base -= streak * 0.18;
            // Broad atmospheric grime, heaviest where the wall is
            // sheltered. Without it the panel tone is uniform and the
            // eye reads the whole wall as one flat card.
            const grime = clamp01(grimeF.at(u, v) * 1.5 + 0.42);
            base -= grime * 0.085;

            const a = aggAt(u, v);
            const aggTone = 0.40 + agg.id.near(u, v) * 0.32;
            const sandTone = 0.50 + fines.at(u, v) * 0.22;

            let r = base; let g = base * 0.995; let b = base * 0.965;
            r = lerp(r, sandTone * 1.01, a.fines * 0.40);
            g = lerp(g, sandTone * 0.98, a.fines * 0.40);
            b = lerp(b, sandTone * 0.93, a.fines * 0.40);
            r = lerp(r, aggTone * 1.02, a.coarse * 0.80);
            g = lerp(g, aggTone * 0.98, a.coarse * 0.80);
            b = lerp(b, aggTone * 0.92, a.coarse * 0.80);

            // Rust bleeds out of the spalled patches AND out of every
            // tie hole, and runs downward from both.
            const rust = clamp01(rustF.at(u, v) * 1.5 + 0.15)
              * clamp01(a.sp * 2.0 + clamp01(1 - Math.abs(board.frac - 0.5) * 3.4) * 0.55)
              * clamp01(1 - board.frac * 1.6);
            r = lerp(r, 0.430, rust * 0.60);
            g = lerp(g, 0.245, rust * 0.60);
            b = lerp(b, 0.150, rust * 0.60);

            const blow = clamp01((0.09 - voids.f1.at(u, v)) * 12);
            const occ = (1 - ao) * 0.30 + blow * 0.12;
            const speckle = (rng() - 0.5) * 0.022;
            /* A trowelled/formed concrete skin is genuinely smooth -
               0.55 - and every place the skin has gone (aggregate,
               blowholes, spall) is genuinely rough. That 0.35 spread is
               what makes the sun pick out the panel faces and leave the
               damage matte; one value near 0.9 for the whole surface is
               how concrete, brick and sand end up shading identically. */
            const rough = clamp01(
              0.55
              + a.coarse * 0.34 + a.fines * 0.14 + a.sp * 0.22 + blow * 0.18
              + grime * 0.09 - streak * 0.06 + rust * 0.10
            );
            return [
              r - occ + speckle,
              g - occ + speckle,
              b - occ + speckle,
              rough,
            ];
          },
          normalStrength: 3.6,
          aoRadius: 3,
          aoStrength: 0.95,
        };
      });
    },

    /**
     * Sandstone block wall, the workhorse of a desert map. Per-block
     * tone and inset, chipped arrises, mortar that has been smeared
     * and has fallen out in places, and dust banked on every course.
     */
    blockwall(size) {
      const ROWS = 8;
      const COLS = 4;
      return synth("blockwall", size, () => {
        const F = makeFields(size, 89);
        const face = F.fbm(26, 3, 0.5);
        const wear = F.warped(7, 4, 0.7);
        const chipF = F.warped(22, 3, 1.0);
        const dustF = F.fbm(5, 3, 0.55);
        const mortarF = F.fbm(18, 3, 0.5);

        const blockAt = (u, v) => {
          const row = Math.floor(v * ROWS);
          const offset = (row % 2) * 0.5;
          const bu = ((u * COLS + offset) % 1 + 1) % 1;
          const bv = (v * ROWS) % 1;
          const col = Math.floor(((u * COLS + offset) % COLS + COLS) % COLS);
          return { row: ((row % ROWS) + ROWS) % ROWS, col, bu, bv };
        };

        return {
          heightFn: (u, v) => {
            const B = blockAt(u, v);
            const mu = Math.min(B.bu, 1 - B.bu) * COLS;
            const mv = Math.min(B.bv, 1 - B.bv) * ROWS;
            const joint = smoothstep(Math.min(mu, mv) * 8.5);
            // Every block sits at its own depth. Uniform inset is the
            // giveaway that a wall was generated rather than built.
            const inset = PERIODIC.hash01(B.row, B.col, 6151) * 0.10;
            // Arris damage: corners break off first.
            const corner = clamp01(1 - Math.min(mu, mv) * 1.6);
            const chip = clamp01(chipF.at(u, v) * 1.4 + 0.15) * corner;
            const mortarLoss = clamp01(mortarF.at(u, v) * 1.6 - 0.35) * (1 - joint);
            return joint * (0.52 - inset)
              + (face.at(u, v) * 0.5 + 0.5) * 0.10 * joint
              + (wear.at(u, v) * 0.5 + 0.5) * 0.16 * joint
              - chip * 0.22
              - mortarLoss * 0.16
              + 0.2;
          },
          shade: (u, v, h, slope, rng, x, y, ao) => {
            const B = blockAt(u, v);
            const mu = Math.min(B.bu, 1 - B.bu) * COLS;
            const mv = Math.min(B.bv, 1 - B.bv) * ROWS;
            const joint = smoothstep(Math.min(mu, mv) * 8.5);

            // Per-block tint hashed off the block index so it is stable
            // rather than a per-texel speckle.
            const k = PERIODIC.hash01(B.row, B.col, 1723);
            const k2 = PERIODIC.hash01(B.row, B.col, 9391);
            const tint = 0.84 + k * 0.30;
            const warm = 0.94 + k2 * 0.14;

            const block = [0.680 * tint * warm, 0.605 * tint, 0.470 * tint * (2 - warm)];
            const mortar = [0.560, 0.545, 0.505];

            const mortarMask = 1 - joint;
            let r = lerp(block[0], mortar[0], mortarMask);
            let g = lerp(block[1], mortar[1], mortarMask);
            let b = lerp(block[2], mortar[2], mortarMask);

            // Chipped corners expose fresh, paler stone.
            const corner = clamp01(1 - Math.min(mu, mv) * 1.6);
            const chip = clamp01((chipF.at(u, v) * 1.4 + 0.15) * corner * 2.0 - 0.5);
            r = lerp(r, 0.730, chip * 0.7);
            g = lerp(g, 0.670, chip * 0.7);
            b = lerp(b, 0.545, chip * 0.7);

            // Dust banks on top of every course and washes down the face.
            const dust = clamp01(dustF.at(u, v) * 1.3 + 0.35)
              * clamp01(1 - Math.abs(B.bv - 0.06) * 4.5);
            r = lerp(r, 0.660, dust * 0.30);
            g = lerp(g, 0.600, dust * 0.30);
            b = lerp(b, 0.480, dust * 0.30);

            const occ = (1 - ao) * 0.30;
            /* A cut sandstone face is not as rough as the sand it came
               from: the saw leaves it around 0.62, wind polishes the
               exposed arris further, and only the mortar and the fresh
               chip scars are genuinely matte. Keeping the whole wall at
               0.93 is what made brick, concrete and sand shade alike. */
            const rough = clamp01(
              0.62
              + mortarMask * 0.30
              + chip * 0.22
              + dust * 0.16
              + (0.5 - k2) * 0.10
            );
            return [
              r - occ,
              g - occ,
              b - occ,
              rough,
            ];
          },
          normalStrength: 5.0,
          aoRadius: 4,
          aoStrength: 1.3,
        };
      });
    },

    /**
     * Asphalt. Wheel paths polish the binder smooth and bleach the
     * aggregate; everything between them ravels. Cracks propagate as a
     * network, not as isolated scratches, and old repairs sit as
     * darker patches with their own edges.
     */
    asphalt(size) {
      return synth("asphalt", size, () => {
        const F = makeFields(size, 101);
        const agg = F.cell(54, 1.0, 14);
        const cracks = F.cell(11, 0.9, 26);
        const ravel = F.fbm(9, 4, 0.55);
        const patchF = F.warped(4, 3, 0.8);
        const dustF = F.fbm(6, 3, 0.5);
        const polishF = F.warped(5, 3, 0.8);

        /* Polish, not wheel paths.
         *
         * This used to be two gaussians pinned to u = 0.30 and 0.70,
         * on the assumption that one texture tile spanned the whole
         * carriageway. The road mesh now tiles at 1.35m and carries
         * its wheel paths in vertex colour, where it can follow a road
         * that changes width - so a u-locked feature here no longer
         * lands on the tyre line, it lands every 1.35 metres, and
         * paints pale bands straight across the traffic direction.
         * Anything in this texture that keys off u alone is now a
         * periodic artifact and has to go. */
        const wheelAt = (u, v) => clamp01(polishF.at(u, v) * 1.9 + 0.42);

        const crackAt = (u, v) => {
          const w = clamp01(1 - (cracks.f2.at(u, v) - cracks.f1.at(u, v)) * 7.0);
          return Math.pow(w, 2.2);
        };

        return {
          heightFn: (u, v) => {
            const wheel = wheelAt(u, v);
            const aggregate = clamp01(0.17 - agg.f1.at(u, v)) * 5;
            const rv = clamp01(ravel.at(u, v) * 1.4 + 0.2);
            const crack = crackAt(u, v);
            const patch = clamp01(patchF.at(u, v) * 1.7 - 0.55);
            return 0.55
              + aggregate * 0.20 * (1 - wheel * 0.75) * (0.4 + rv)
              - wheel * 0.055
              - crack * 0.40
              + patch * 0.03;
          },
          shade: (u, v, h, slope, rng, x, y, ao) => {
            const wheel = wheelAt(u, v);
            const crack = crackAt(u, v);
            const patch = clamp01(patchF.at(u, v) * 1.7 - 0.55);

            // sRGB 0.275 -> linear ~0.06: dry weathered asphalt. Fresh
            // binder is far darker, but nothing on this map is fresh.
            let g0 = 0.275 + (dustF.at(u, v) * 0.5 + 0.5) * 0.045;
            // Polished wheel paths bleach as the binder wears off the
            // aggregate; the crown between them stays darker.
            g0 += wheel * 0.075;
            // A repair patch is younger and therefore blacker.
            g0 -= patch * 0.075;

            const aggregate = clamp01((0.17 - agg.f1.at(u, v)) * 7) * (1 - wheel * 0.5);
            const aggTone = 0.30 + agg.id.near(u, v) * 0.22;
            let r = g0; let g = g0 * 1.0; let b = g0 * 1.03;
            r = lerp(r, aggTone, aggregate * 0.55);
            g = lerp(g, aggTone * 0.99, aggregate * 0.55);
            b = lerp(b, aggTone * 0.99, aggregate * 0.55);

            // Wind-blown sand collects in the cracks. The banking
            // against the kerbs used to live here too, keyed off u -
            // which is now a 1.35m stripe rather than a road edge, and
            // is the road mesh's business anyway.
            const sand = clamp01(crack * 1.4 - 0.15) * 0.55
              + clamp01(dustF.at(u, v) * 1.8 - 0.55) * 0.5;
            r = lerp(r, 0.560, clamp01(sand) * 0.62);
            g = lerp(g, 0.495, clamp01(sand) * 0.62);
            b = lerp(b, 0.380, clamp01(sand) * 0.62);

            const occ = (1 - ao) * 0.22;
            const speckle = (rng() - 0.5) * 0.030;
            return [
              r - occ + speckle,
              g - occ + speckle,
              b - occ + speckle,
              0.86 - wheel * 0.26 + aggregate * 0.06,
            ];
          },
          normalStrength: 2.6,
          aoRadius: 3,
          aoStrength: 0.7,
        };
      });
    },

    /** Painted, scratched, rusting sheet metal. */
    metal(size) {
      return synth("metal", size, () => {
        const F = makeFields(size, 131);
        const dents = F.warped(5, 4, 0.7);
        const scratchF = F.fbm(48, 2, 0.5);
        const rustF = F.warped(8, 4, 0.8);
        const edgeF = F.fbm(3, 2, 0.5);

        const rustAt = (u, v) => clamp01(Math.pow(clamp01(rustF.at(u, v) * 1.5 + 0.5), 2.4) * 2.2);

        return {
          heightFn: (u, v) => {
            const rust = rustAt(u, v);
            const scratch = Math.abs(scratchF.at(u, v));
            return (dents.at(u, v) * 0.5 + 0.5) * 0.55
              + scratch * 0.10
              // Rust is not flat: it blisters and flakes off.
              + Math.pow(rust, 1.6) * 0.35;
          },
          shade: (u, v, h, slope, rng, x, y, ao) => {
            const rust = rustAt(u, v);
            const paint = [0.300, 0.340, 0.310];
            const primer = [0.470, 0.365, 0.245];
            const rustCol = [0.400, 0.185, 0.085];
            // Paint fails to primer first, then to rust. Skipping the
            // primer stage is what makes painted metal read as a decal.
            const stage1 = clamp01(rust * 2.2);
            const stage2 = clamp01(rust * 1.4 - 0.35);
            let r = lerp(paint[0], primer[0], stage1);
            let g = lerp(paint[1], primer[1], stage1);
            let b = lerp(paint[2], primer[2], stage1);
            r = lerp(r, rustCol[0], stage2);
            g = lerp(g, rustCol[1], stage2);
            b = lerp(b, rustCol[2], stage2);

            const scratch = rng() < 0.010 ? 0.40 : 0;
            const edge = clamp01(edgeF.at(u, v) * 1.4 + 0.3) * 0.05;
            const occ = (1 - ao) * 0.24;
            return [
              r + scratch + edge - occ,
              g + scratch + edge - occ,
              b + scratch + edge * 0.9 - occ,
              // Sound alkyd paint is nearly a gloss (0.26); rust is as
              // matte as a surface gets (0.95). Starting the ramp at
              // 0.44 put painted steel and dry plaster in the same
              // specular bracket, which is why nothing on the map read
              // as painted metal.
              lerp(0.26, 0.95, rust) - scratch * 0.14,
            ];
          },
          normalStrength: 2.2,
          aoRadius: 3,
          aoStrength: 0.6,
        };
      });
    },

    /**
     * Corrugated steel sheet: roofing, shack walls, fence panels. The
     * profile has to be a real trapezoid, not a sine - the flat crown
     * is what catches the sun as a hard line down the sheet.
     */
    corrugated(size) {
      return synth("corrugated", size, () => {
        const F = makeFields(size, 149);
        const rustF = F.warped(9, 4, 0.8);
        const dentF = F.warped(4, 3, 0.7);
        const dirtF = F.fbm(11, 3, 0.55);
        const RIBS = 9;

        const ribAt = (u) => {
          const t = ((u * RIBS) % 1 + 1) % 1;
          // Trapezoid: flat crown, sloped webs, flat valley.
          if (t < 0.16) return t / 0.16;
          if (t < 0.44) return 1;
          if (t < 0.60) return 1 - (t - 0.44) / 0.16;
          return 0;
        };

        return {
          heightFn: (u, v) => {
            const rib = ribAt(u);
            const dent = dentF.at(u, v) * 0.5 + 0.5;
            const rust = clamp01(rustF.at(u, v) * 1.3 + 0.35);
            return rib * 0.62 + dent * 0.16 + Math.pow(rust, 2.0) * 0.14 + 0.1;
          },
          shade: (u, v, h, slope, rng, x, y, ao) => {
            const rib = ribAt(u);
            const rust = clamp01(Math.pow(clamp01(rustF.at(u, v) * 1.3 + 0.4), 2.2) * 1.9);
            // Rust runs down from the fixings and pools in the valleys,
            // so the valleys corrode first.
            const valley = 1 - rib;
            const total = clamp01(rust * (0.55 + valley * 0.9));
            const zinc = [0.545, 0.560, 0.565];
            const rustCol = [0.415, 0.200, 0.095];
            let r = lerp(zinc[0], rustCol[0], total);
            let g = lerp(zinc[1], rustCol[1], total);
            let b = lerp(zinc[2], rustCol[2], total);
            const dirt = clamp01(dirtF.at(u, v) * 1.4 + 0.3) * valley * 0.16;
            r -= dirt; g -= dirt * 0.95; b -= dirt * 0.85;
            const occ = (1 - ao) * 0.22;
            return [r - occ, g - occ, b - occ, lerp(0.38, 0.93, total)];
          },
          normalStrength: 3.2,
          aoRadius: 3,
          aoStrength: 0.7,
        };
      });
    },

    /**
     * Lime plaster over blockwork - the render on every town building.
     * Its whole character is where it has *failed*: spalled patches
     * showing the block beneath, hairline map cracking, and the dark
     * splash line rain kicks up along the bottom.
     */
    plaster(size) {
      return synth("plaster", size, () => {
        const F = makeFields(size, 167);
        const trowel = F.warped(5, 4, 0.9);
        const spallF = F.warped(4, 3, 1.0);
        const hair = F.cell(20, 0.9, 22);
        const grit = F.fbm(28, 2, 0.5);
        const stainF = F.fbm(8, 3, 0.55);
        const ROWS = 7; const COLS = 4;

        const spallAt = (u, v) => clamp01(spallF.at(u, v) * 1.8 - 0.62);
        const hairAt = (u, v) => clamp01(1 - (hair.f2.at(u, v) - hair.f1.at(u, v)) * 9.0);

        return {
          heightFn: (u, v) => {
            const sp = spallAt(u, v);
            const row = Math.floor(v * ROWS);
            const bu = ((u * COLS + (row % 2) * 0.5) % 1 + 1) % 1;
            const bv = (v * ROWS) % 1;
            const joint = smoothstep(Math.min(Math.min(bu, 1 - bu) * COLS,
              Math.min(bv, 1 - bv) * ROWS) * 8);
            return (trowel.at(u, v) * 0.5 + 0.5) * 0.18
              + (grit.at(u, v) * 0.5 + 0.5) * 0.06
              - hairAt(u, v) * 0.10
              // Where the render has come off, the block joints show.
              - sp * 0.20 + sp * joint * 0.14
              + 0.55;
          },
          shade: (u, v, h, slope, rng, x, y, ao) => {
            const sp = spallAt(u, v);
            // sRGB 0.74 -> linear ~0.5. Lime render really is that
            // bright; it is the dirt on it that brings it down.
            let base = 0.735 + trowel.at(u, v) * 0.045;
            const stain = clamp01(stainF.at(u, v) * 1.6 + 0.15);
            // Rain splash darkens the bottom of every wall.
            const splash = clamp01(1 - v * 4.5) * 0.5 + stain * 0.14;
            base -= splash * 0.20;

            let r = base; let g = base * 0.985; let b = base * 0.935;
            // Exposed block underneath.
            r = lerp(r, 0.615, sp * 0.85);
            g = lerp(g, 0.545, sp * 0.85);
            b = lerp(b, 0.430, sp * 0.85);

            const crack = hairAt(u, v);
            const occ = (1 - ao) * 0.24 + crack * 0.10;
            // A steel-trowelled lime skin takes a low sheen; where it
            // has blown off, the block behind it is matte. Without that
            // step the spall is a colour change with no material change.
            const rough = clamp01(0.68 + sp * 0.26 + splash * 0.14
              + clamp01(trowel.at(u, v) * 1.2 + 0.5) * 0.10);
            return [r - occ, g - occ, b - occ, rough];
          },
          normalStrength: 3.2,
          aoRadius: 4,
          aoStrength: 0.85,
        };
      });
    },

    /** Cracked dry mud, for pond beds and the wadi floor after a flood. */
    drymud(size) {
      return synth("drymud", size, () => {
        const F = makeFields(size, 181);
        const polys = F.cell(7, 0.8, 34);
        const inner = F.cell(17, 0.9, 22);
        const silt = F.fbm(26, 3, 0.5);
        const tone = F.fbm(3, 2, 0.5);

        const crackAt = (u, v) => clamp01(1 - (polys.f2.at(u, v) - polys.f1.at(u, v)) * 5.0);
        const fineAt = (u, v) => clamp01(1 - (inner.f2.at(u, v) - inner.f1.at(u, v)) * 9.0);

        return {
          heightFn: (u, v) => {
            const crack = crackAt(u, v);
            const fine = fineAt(u, v) * 0.5;
            // The plate curls up at its edge as it dries, so the rim is
            // the highest point and the crack cuts below the floor.
            const curl = clamp01(crack * 1.8 - 0.30);
            return 0.5
              + (silt.at(u, v) * 0.5 + 0.5) * 0.10
              + curl * 0.26
              - Math.pow(crack, 3.0) * 0.55
              - Math.pow(fine, 2.5) * 0.14;
          },
          shade: (u, v, h, slope, rng, x, y, ao) => {
            const crack = crackAt(u, v);
            const t = clamp01(tone.at(u, v) * 1.3 + 0.5);
            const dry = [0.600, 0.535, 0.430];
            const grey = [0.500, 0.470, 0.420];
            const deep = [0.215, 0.180, 0.140];
            let r = lerp(dry[0], grey[0], t);
            let g = lerp(dry[1], grey[1], t);
            let b = lerp(dry[2], grey[2], t);
            const inCrack = clamp01(crack * 2.4 - 0.9);
            r = lerp(r, deep[0], inCrack);
            g = lerp(g, deep[1], inCrack);
            b = lerp(b, deep[2], inCrack);
            const occ = (1 - ao) * 0.32;
            return [r - occ, g - occ, b - occ, 0.96 - inCrack * 0.08];
          },
          normalStrength: 3.4,
          aoRadius: 5,
          aoStrength: 1.1,
        };
      });
    },

    /** Broken concrete and brick rubble, for collapsed structures. */
    rubble(size) {
      return synth("rubble", size, () => {
        const F = makeFields(size, 193);
        const chunks = F.cell(11, 1.0, 32);
        const shards = F.cell(26, 1.0, 20);
        const dust = F.fbm(22, 3, 0.5);
        const rebarF = F.fbm(30, 2, 0.5);

        return {
          heightFn: (u, v) => {
            // Angular, not domed: raise F1 to a low power so the clast
            // has a flat top and a hard shoulder like a broken slab.
            const rBig = 0.34 + chunks.id.near(u, v) * 0.14;
            const big = clamp01((rBig - chunks.f1.at(u, v)) / rBig) ** 0.35;
            const rSm = 0.34 + shards.id.near(u, v) * 0.14;
            const small = clamp01((rSm - shards.f1.at(u, v)) / rSm) ** 0.4;
            return big * 0.52 + small * 0.28 + (dust.at(u, v) * 0.5 + 0.5) * 0.14 + 0.1;
          },
          shade: (u, v, h, slope, rng, x, y, ao) => {
            const idBig = chunks.id.near(u, v);
            const idSm = shards.id.near(u, v);
            const rBig = 0.34 + idBig * 0.14;
            const big = clamp01((rBig - chunks.f1.at(u, v)) * 4.0);
            const rSm = 0.34 + idSm * 0.14;
            const small = clamp01((rSm - shards.f1.at(u, v)) * 5.0);

            // Grey concrete, red brick, pale block - a demolition heap
            // is never one material.
            const pick = (k) => (k < 0.5 ? [0.520, 0.510, 0.485]
              : k < 0.78 ? [0.470, 0.290, 0.215]
                : [0.625, 0.560, 0.450]);
            const cBig = pick(idBig);
            const cSm = pick(idSm);

            // Dust coats everything; it is what unifies the heap.
            let r = 0.560; let g = 0.505; let b = 0.410;
            r = lerp(r, cSm[0], small * 0.55); g = lerp(g, cSm[1], small * 0.55); b = lerp(b, cSm[2], small * 0.55);
            r = lerp(r, cBig[0], big * 0.70); g = lerp(g, cBig[1], big * 0.70); b = lerp(b, cBig[2], big * 0.70);

            const rebar = clamp01(Math.abs(rebarF.at(u, v)) * 6 - 5.0) * big;
            r = lerp(r, 0.360, rebar); g = lerp(g, 0.190, rebar); b = lerp(b, 0.110, rebar);

            const occ = (1 - ao) * 0.34;
            const speckle = (rng() - 0.5) * 0.04;
            return [r - occ + speckle, g - occ + speckle, b - occ + speckle,
              0.94 - big * 0.06 + rebar * 0.04];
          },
          normalStrength: 4.0,
          aoRadius: 5,
          aoStrength: 1.15,
        };
      });
    },

    /**
     * Sun-bleached softwood, sawn along U.
     *
     * Three measured faults set every constant below, and the first two
     * are the same mistake made twice: authoring a quantity in sRGB that
     * the renderer consumes in LINEAR light.
     *
     * CHROMA. The old ramp ran sRGB 0.505/0.385/0.255 to
     * 0.360/0.268/0.180 - saturation 0.495 in sRGB, which reads as a
     * moderate brown when you type it. In linear light, where albedo is
     * multiplied by the vertex tint, the same colour is saturation
     * 0.765. Through a tan tint at its own linear saturation 0.61, the
     * effective albedo measured 0.886, the MOST chromatic surface in
     * the whole library - above sand (0.727), blockwall (0.751) and
     * every masonry surface. Timber weathered in a desert is greyer
     * than the sand beside it, not twice as colourful.
     *
     * CONTRAST. The old comment claimed the ramp avoided running "2:1
     * between earlywood and latewood". 0.505/0.360 is 1.40 - in sRGB.
     * In linear it is 0.2158/0.1074 = 2.01, so the surface was doing
     * exactly the thing the comment says it must not.
     *
     * GRAIN DIRECTION. |sin| in v puts the rings across U, which is
     * right - but scaleBoxUv used to hand every box u=width, v=height,
     * so on a vertical post the rings ran horizontally, round the piece
     * like a barber pole. structures.js now swaps the axes per face so
     * u is always the piece's LONG axis, which is the axis a board is
     * sawn along. That is the single change that stops a market post
     * reading as flame or polished stone.
     *
     * The pitch went with it: the old 10 lines per tile is 6.7cm at the
     * market's uvScale, which is not grain, it is a tiger stripe. 32
     * lines per tile is 2.1cm there - coarse-sawn softwood - and at 1024
     * texels it is 32 texels a period, which is the same margin above
     * the mip floor that sandbag's weave had to be pulled back to.
     *
     * --- and then the fourth fault, which is what a reviewer sees ---
     *
     * A blind art director called our crates "flat single-colour solids,
     * one value per face, no surface texture" and concluded the meshes
     * were untextured. They are not: every structures material carries a
     * 1024 or 2048 albedo, normal and packed ORM (probe, ten gameplay
     * frames, 20424 rays). The observation was right and the cause was
     * the opposite of missing texture - it was ALL of the texture sitting
     * at one spatial frequency.
     *
     * Measured on the box-filtered pyramid of the generated maps, as
     * sd/mean per level:
     *
     *   AO channel   mip0   mip1   mip2   mip3   mip4   mip5
     *   wood         0.698  0.671  0.597  0.454  0.269  0.075
     *   blockwall    0.269  0.267  0.262  0.233  0.211  0.149
     *   concrete     0.150  0.144  0.130  0.112  0.096  0.080
     *
     * Wood carried the second most banded AO in the whole library - 4.6x
     * concrete's - and then fell BELOW both of them by mip5. That is one
     * surface behaving as two: at 2.6m a crate was a hard black barcode,
     * closer to corrugated card than to timber, and by 11m the ridge was
     * under a texel, the normal map had flattened and the AO had averaged
     * to its own mean, so the same crate was a blank tan slab. Both
     * halves of that came from `lineAt * 0.30` in the height field, which
     * is a 1cm corrugation at these tile rates.
     *
     * The reason every other built surface survives the trip is that each
     * has a CONSTRUCTION GRID an order of magnitude coarser than its
     * noise - blocks, formwork boards, a corrugation profile - and wood
     * had none. It was a single infinite board. So: 6 planks per tile
     * (8-18cm at the rates the kit actually uses), each with its own
     * value, its own silvering, its own ring phase and pitch, a joint
     * groove between them and butt joints along their length. That is
     * structure at 6 and 1.3 per tile instead of 32, and it is what is
     * still there at 20m.
     */
    wood(size) {
      return synth("wood", size, () => {
        const F = makeFields(size, 211);
        const wanderF = F.fbm(3, 3, 0.5);
        const figureF = F.fbm(6, 2, 0.5);
        const greyF = F.warped(3, 3, 0.7);
        const splitF = F.fbm(14, 3, 0.5);
        const fuzzF = F.fbm(34, 2, 0.5);

        const RINGS = 16;

        /* Boards per tile, and the resulting board widths at the rates
         * this kit actually samples wood at (measured off the merged
         * buffers): crate 0.91m tile -> 15cm, pallet and market post
         * 0.67m -> 11cm, guard tower 1.0m -> 17cm. All real sawn sizes.
         * A market post is 0.1m across, so it shows most of one board,
         * which is what a 100mm post is. */
        const PLANKS = 6;
        // Joint width as a fraction of a board. 5.5% of 11cm is 6mm,
        // which is the gap a shrunk board leaves.
        const JOINT = 0.055;
        /* Butt joints per tile - the only structure this material has
         * ever had on the u axis, and the one term here that has to be
         * held down rather than pushed.
         *
         * 1.3 with a 0.30 groove was measured on a guard tower and it
         * turned the legs into BAMBOO: a post's u axis is its 5.2m
         * length, so seven board ends banded across a piece that is one
         * baulk of timber and has none. 0.8 with a 0.12 groove is a dry
         * hairline - a crate face gets about one per board, which is
         * what a crate has, and a post gets a few faint cross checks,
         * which is what sun does to a post. The general rule this is an
         * instance of: a feature keyed to the LONG axis is multiplied by
         * however long the piece is, so its budget is set by the longest
         * piece in the kit, not by the most common one. */
        const BUTTS = 0.8;

        /* Per-board constants, hashed on the board index MOD PLANKS.
         *
         * The modulus is what keeps the tile tiling. Everything below is
         * also expressed relative to the board's own 0..1 coordinate
         * rather than to v, for the same reason: a ring pitch that varied
         * per board but was measured from v would accumulate phase across
         * the tile and tear at the seam.
         */
        const hash = (i, salt) => {
          const k = ((i % PLANKS) + PLANKS) % PLANKS;
          const s = Math.sin((k + 1) * 127.1 + salt * 311.7) * 43758.5453;
          return s - Math.floor(s);
        };

        /* Boards are not coplanar - cladding never is, and the step at a
         * joint is worth more than the groove because it catches the sun
         * on one side and shades the other.
         *
         * Ramped across the joint into the neighbour's level rather than
         * stepped. sandbag's weave already paid for this lesson: a hard
         * discontinuity is the one thing a mip chain cannot filter, and
         * it aliases at every distance and every resolution. Blended over
         * the joint the slope is bounded by JOINT, and at 6 per tile that
         * is 170 texels of period at 1024 - five mip levels of headroom.
         */
        const liftAt = (i, f) => {
          const own = hash(i, 3) - 0.5;
          const other = (f < 0.5 ? hash(i - 1, 3) : hash(i + 1, 3)) - 0.5;
          const edge = Math.min(f, 1 - f);
          const w = edge >= JOINT ? 0 : 0.5 * (1 - edge / JOINT);
          return lerp(own, other, w);
        };

        /* The wander is a DISPLACEMENT in v, not a phase offset, and its
         * gradient is what has to stay under one.
         *
         * The previous version added the warp to the phase and held the
         * amplitude "under half a cycle" - but folding is not set by
         * amplitude, it is set by d(warp)/dv against the ring frequency.
         * A field of frequency f and amplitude A has gradient about 2fA,
         * so 0.70 of a cycle at frequency 4 was gradient 5.6 against a
         * ring frequency of 5: marginally folding already, which is why
         * the earlier 2.2 closed the rings into loops. Written as a
         * displacement the criterion is explicit - 2*3*0.022 + 2*6*0.008
         * = 0.23 - and the amplitudes can be read directly as how far
         * across the board the grain wanders: 0.030 of a tile, which at
         * the market's rate is 2.5cm, or about one ring width. At 0.073
         * it was 6cm of wander over a 28cm run and the post came out
         * looking like flame figure on a veneer rather than like sawn
         * softwood. Sawn grain is nearly straight; the wander is there
         * so the lines are not ruled, not so they are decorative. */
        /** Board index, position across it, and the joint and butt
         *  masks - everything downstream needs the same decomposition,
         *  and computing it twice is how the height and the albedo drift
         *  out of register. */
        const boardAt = (u, v) => {
          const t = v * PLANKS;
          const i = Math.floor(t);
          const f = t - i;
          const edge = Math.min(f, 1 - f);
          const joint = edge >= JOINT ? 0 : 1 - edge / JOINT;
          // Board ends, offset per board so they do not line up into a
          // second grid across the piece.
          const e = u * BUTTS + hash(i, 7);
          const ef = e - Math.floor(e);
          const bEdge = Math.min(ef, 1 - ef);
          const butt = bEdge >= 0.009 ? 0 : 1 - bEdge / 0.009;
          return { i, f, joint, butt };
        };

        const ringAt = (u, v, b) => {
          const drift = wanderF.at(u, v) * 0.022 + figureF.at(u, v) * 0.008;
          /* Rings are counted WITHIN the board, at the board's own pitch
           * and phase. Adjacent boards are different pieces of timber, so
           * the grain must not run continuously across a joint - that
           * continuity is most of what made a crate read as one carved
           * block rather than as boards nailed to a frame. Working in the
           * board's local f is also what keeps the tile periodic when the
           * pitch varies. */
          const pitch = (RINGS / PLANKS) * (0.78 + hash(b.i, 1) * 0.5);
          const phase = hash(b.i, 2);
          return Math.abs(Math.sin(
            ((b.f + drift * PLANKS) * pitch + phase) * Math.PI * 2));
        };

        // Latewood is a NARROW hard line; the pale earlywood is most of
        // a sawn face. |sin| alone splits it half and half, which is
        // what made the old surface read as stripes rather than grain.
        const lineAt = (u, v, b) => Math.pow(1 - ringAt(u, v, b), 2.6);

        return {
          heightFn: (u, v) => {
            const b = boardAt(u, v);
            /* Weathering erodes the soft earlywood and leaves the hard
             * latewood standing proud, so the grain is a fine ridge at
             * the line rather than a groove between lines.
             *
             * 0.055, not 0.30. A growth ring on weathered sawn softwood
             * stands a few tenths of a millimetre proud; at 0.30 of the
             * height range through normalStrength 2.6 it was rendering
             * as a 1cm corrugation, and the AO cast off it was the
             * black barcode a crate wore at 2.6m. The ring is now a
             * roughness and albedo cue with just enough relief to catch
             * a raking sun, and the relief budget goes to the joints
             * instead, where it survives the mip chain.
             */
            const fuzz = fuzzF.at(u, v) * 0.5 + 0.5;
            const split = clamp01(Math.abs(splitF.at(u, v)) * 7 - 5.6);
            return 0.50 + lineAt(u, v, b) * 0.055 + fuzz * 0.10
              - split * 0.32 - b.joint * b.joint * 0.42 - b.butt * 0.12
              + liftAt(b.i, b.f) * 0.13;
          },
          shade: (u, v, h, slope, rng, x, y, ao) => {
            const b = boardAt(u, v);
            const line = lineAt(u, v, b);
            const split = clamp01(Math.abs(splitF.at(u, v)) * 7 - 5.6);

            /* sRGB 0.520/0.455/0.385 is linear 0.231/0.174/0.121:
             * reflectance 0.18, saturation 0.47. Weathered pine measures
             * 0.15-0.25 and sits between our plaster (0.16) and our sand
             * (0.49) on chroma, which is where timber belongs. */
            const timber = [0.520, 0.455, 0.385];
            // UV silvers exposed timber towards grey; it does not just
            // fade. Linear saturation 0.145, so this is also what pulls
            // the surface's mean chroma down where it is most exposed.
            const silverC = [0.505, 0.492, 0.470];
            /* Per-board silvering bias, +-0.26 on the blend.
             *
             * Boards weather individually: a plank that has faced the sun
             * for a decade sits beside one that was replaced last year.
             * This and `tone` below are the only two terms in the whole
             * material that vary at 6 per tile instead of 32, and they
             * are the ones still doing anything at 20m. */
            const silver = clamp01(greyF.at(u, v) * 1.5 + 0.45
              + (hash(b.i, 4) - 0.5) * 0.52);
            let r = lerp(timber[0], silverC[0], silver * 0.70);
            let g = lerp(timber[1], silverC[1], silver * 0.70);
            let bl = lerp(timber[2], silverC[2], silver * 0.70);

            /* Grain, checking and dirt are VALUE, not colour. Every one
             * of them used to be a second hue lerped in, and hue is not
             * preserved under multiplication - a chromatic term times a
             * chromatic tint walks away from both. As multipliers on one
             * colour the surface keeps a single hue however hard they
             * are driven, which is what "nearly monochrome" means.
             *
             * 0.86 at the line is 1.44x in linear, against the 2.01x it
             * was doing while claiming not to.
             *
             * `tone` is the per-board value, +-19%. It is deliberately
             * larger than any of the fine terms: it is the one that has
             * to still be visible when the ring is under a texel, and a
             * row of boards at one value is the thing a reviewer reads as
             * "one value per face". The joint and the butt darken because
             * a gap is a shadow and an end grain drinks dirt.
             */
            const tone = 0.81 + hash(b.i, 5) * 0.38;
            const wear = tone * (1 - line * 0.14) * (1 - split * 0.34)
              * (1 - (1 - ao) * 0.30)
              * (1 - b.joint * 0.34) * (1 - b.butt * 0.15);
            r *= wear; g *= wear; bl *= wear;

            // Silvered and split timber is matte; sound timber under
            // desert dust is barely less so. Sawn end grain is rougher
            // than either. The window is 0.72-1.00.
            const rough = clamp01(0.62 + silver * 0.26 + split * 0.14
              + b.butt * 0.14 - line * 0.06);
            return [r, g, bl, rough];
          },
          /* 2.2, down from 2.6. The relief is now carried by joints six
           * to a tile rather than by rings thirty-two to a tile, and a
           * joint is a much wider feature, so the same visual depth needs
           * less gain - and less gain is what stops the fine noise that
           * remains from re-aliasing into the barcode this replaced. */
          normalStrength: 2.2,
          aoRadius: 3,
          aoStrength: 0.8,
        };
      });
    },

    /** Hessian sandbag: a coarse woven jute sack, bulging and sun-rotted. */
    sandbag(size) {
      return synth("sandbag", size, () => {
        const F = makeFields(size, 227);
        const bulge = F.warped(4, 3, 0.7);
        const slub = F.fbm(24, 2, 0.5);
        const rotF = F.warped(6, 3, 0.8);
        // 34, not 48. Structures use this surface for market canopies
        // and awnings at roughly 2 tiles per 3 metres, so at 48 the
        // weave landed near the mip chain's own limit and every stall
        // in the bazaar was a cross-hatched moire.
        const WEAVE = 34;

        return {
          heightFn: (u, v) => {
            // A real plain weave is over-under, so the warp and weft
            // threads alternate which one is on top - max() of two
            // sines gives a waffle, which is a knit, not a weave.
            //
            // The over/under selector has to be a *ramp*. As a binary
            // test it put a step discontinuity into the height field
            // every half thread, and a discontinuity is the one thing a
            // mip chain cannot filter: it aliased at every distance and
            // every resolution.
            const cu = Math.sin(u * Math.PI * 2 * WEAVE);
            const cv = Math.sin(v * Math.PI * 2 * WEAVE);
            const over = clamp01(cu * cv * 2.6 + 0.5);
            const thread = lerp(
              Math.abs(cv) * 0.5 + 0.35,
              Math.abs(cu) * 0.5 + 0.5,
              over
            );
            const slubbing = (slub.at(u, v) * 0.5 + 0.5) * 0.18;
            return (bulge.at(u, v) * 0.5 + 0.5) * 0.60 + thread * 0.28 + slubbing;
          },
          shade: (u, v, h, slope, rng, x, y, ao) => {
            const rot = clamp01(rotF.at(u, v) * 1.4 + 0.4);
            const jute = [0.560, 0.480, 0.335];
            const bleached = [0.640, 0.590, 0.470];
            let r = lerp(jute[0], bleached[0], rot);
            let g = lerp(jute[1], bleached[1], rot);
            let b = lerp(jute[2], bleached[2], rot);
            const fray = rng() < 0.014 ? 0.10 : 0;
            const occ = (1 - ao) * 0.34;
            return [r + fray - occ, g + fray - occ, b + fray - occ, 0.97];
          },
          normalStrength: 2.3,
          aoRadius: 3,
          aoStrength: 0.95,
        };
      });
    },

    /** Dry scrub ground cover, used where terrain is not bare sand. */
    scrub(size) {
      return synth("scrub", size, () => {
        const F = makeFields(size, 239);
        const clumps = F.warped(10, 4, 0.7);
        const fine = F.fbm(38, 2, 0.5);
        const green = F.fbm(5, 3, 0.5);
        const soil = F.fbm(3, 2, 0.5);

        return {
          heightFn: (u, v) => (clumps.at(u, v) * 0.5 + 0.5) * 0.68
            + (fine.at(u, v) * 0.5 + 0.5) * 0.32,
          shade: (u, v, h, slope, rng, x, y, ao) => {
            const dry = [0.455, 0.415, 0.255];
            const live = [0.245, 0.290, 0.155];
            const ground = [0.560, 0.480, 0.360];
            const t = clamp01(green.at(u, v) * 1.5 + 0.42);
            const cover = clamp01((clumps.at(u, v) * 0.5 + 0.5) * 1.9 - 0.55);
            let r = lerp(ground[0], lerp(dry[0], live[0], t), cover);
            let g = lerp(ground[1], lerp(dry[1], live[1], t), cover);
            let b = lerp(ground[2], lerp(dry[2], live[2], t), cover);
            const s = soil.at(u, v) * 0.05;
            const jitter = (rng() - 0.5) * 0.05;
            const occ = (1 - ao) * 0.24;
            return [r + s + jitter - occ, g + s + jitter - occ, b + s * 0.8 + jitter - occ, 0.97];
          },
          normalStrength: 2.6,
          aoRadius: 3,
          aoStrength: 0.8,
        };
      });
    },
  };

  /* --------------------- terrain macro variation --------------------- */

  /**
   * A single very-low-frequency data texture the terrain shader tiles
   * at hundreds of metres. It is the answer to "the ground repeats":
   * no amount of detail-texture cleverness hides a 3m tile at 300m,
   * but a field that only varies over 200m breaks the eye's lock on
   * the repeat while costing one fetch.
   *
   *   R = broad tonal multiplier      G = warm/cool hue drift
   *   B = roughness / damp variation  A = desert-pavement (lag) cover
   */
  function buildMacro(size) {
    if (cache.has("macro")) return cache.get("macro");
    const F = makeFields(size, 307);
    const toneF = F.warped(3, 5, 0.8);
    const hueF = F.fbm(2, 3, 0.55);
    const roughF = F.fbm(4, 3, 0.5);
    const lagF = F.warped(5, 4, 0.9);
    const patchF = F.fbm(7, 4, 0.5);
    // Scour: a ridged field, so the light streaks are *lines* with
    // sharp shoulders rather than blobs. Wind-scoured ground reads as
    // parallel pale trails and dark inter-trail hollows, and a
    // symmetric noise cannot produce either.
    const scourF = F.ridged(6, 4, 0.55, 10);

    /* A gaussian-ish field spends most of its life near 0.5. Sampled
       back at a 38% multiplier, the previous macro map varied the
       terrain albedo by about six per cent - which is why a dune field
       210m across was one hue. The S-curve below pushes the
       distribution out to the rails so the map has genuinely light and
       genuinely dark regions, and the shader is then free to use them.
       k > 1 expands about the midpoint; k < 1 compresses toward it,
       which is the opposite of what is wanted here and cost a round to
       spot, because a compressed macro map looks exactly like no macro
       map at all. */
    const contrast = (t, k) => {
      const c = clamp01(t);
      return c < 0.5
        ? 0.5 * Math.pow(c * 2, k)
        : 1 - 0.5 * Math.pow((1 - c) * 2, k);
    };

    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      const v = y / size;
      for (let x = 0; x < size; x += 1) {
        const u = x / size;
        const i = (y * size + x) * 4;
        const scour = clamp01(scourF.at(u, v) * 1.5 - 0.18);
        const tone = contrast(
          toneF.at(u, v) * 1.35 + 0.5 + patchF.at(u, v) * 0.30 + scour * 0.24, 2.0
        );
        pixels[i] = tone * 255;
        pixels[i + 1] = contrast(hueF.at(u, v) * 1.35 + 0.5, 1.8) * 255;
        pixels[i + 2] = clamp01(roughF.at(u, v) * 1.1 + 0.5 - scour * 0.30) * 255;
        pixels[i + 3] = contrast(lagF.at(u, v) * 1.6 + 0.42, 1.7) * 255;
      }
    }
    const set = { map: toTexture(pixels, size), size };
    cache.set("macro", set);
    return set;
  }
  GENERATORS.macro = buildMacro;

  /* ------------------------ non-tiling art ------------------------ */

  /** Radial gradient sprite used for muzzle flash, smoke and impacts. */
  function makeSprite(name, draw, size = 256) {
    if (cache.has(name)) return cache.get(name);
    const canvas = makeCanvas(size);
    const g = canvas.getContext("2d");
    draw(g, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = render.anisotropy;
    texture.needsUpdate = true;
    cache.set(name, texture);
    return texture;
  }

  const sprites = {
    get smoke() {
      return makeSprite("sprite:smoke", (g, s) => {
        const image = g.createImageData(s, s);
        for (let y = 0; y < s; y += 1) {
          for (let x = 0; x < s; x += 1) {
            const u = x / s - 0.5;
            const v = y / s - 0.5;
            const r = Math.hypot(u, v) * 2;
            const puff = fbmPeriodic(x / s, y / s, 4, 5, 0.5, 991) * 0.5 + 0.5;
            const a = clamp01((1 - r) * 1.35) * clamp01(puff * 1.5) * 255;
            const i = (y * s + x) * 4;
            const grey = 200 + puff * 40;
            image.data[i] = grey; image.data[i + 1] = grey; image.data[i + 2] = grey;
            image.data[i + 3] = a;
          }
        }
        g.putImageData(image, 0, 0);
      });
    },
    get flash() {
      return makeSprite("sprite:flash", (g, s) => {
        const c = s / 2;
        const grad = g.createRadialGradient(c, c, 0, c, c, c);
        grad.addColorStop(0, "rgba(255,255,246,1)");
        grad.addColorStop(0.18, "rgba(255,232,168,0.95)");
        grad.addColorStop(0.42, "rgba(255,150,52,0.42)");
        grad.addColorStop(1, "rgba(255,110,20,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, s, s);
        // Star spikes, the shape a real muzzle flash makes on a camera.
        g.globalCompositeOperation = "lighter";
        g.strokeStyle = "rgba(255,238,196,0.5)";
        for (let i = 0; i < 6; i += 1) {
          const a = (i / 6) * Math.PI * 2 + 0.2;
          g.lineWidth = 3 + (i % 2) * 5;
          g.beginPath();
          g.moveTo(c, c);
          g.lineTo(c + Math.cos(a) * c * 0.95, c + Math.sin(a) * c * 0.95);
          g.stroke();
        }
      });
    },
    get spark() {
      return makeSprite("sprite:spark", (g, s) => {
        const c = s / 2;
        const grad = g.createRadialGradient(c, c, 0, c, c, c);
        grad.addColorStop(0, "rgba(255,255,255,1)");
        grad.addColorStop(0.3, "rgba(255,206,120,0.85)");
        grad.addColorStop(1, "rgba(255,120,20,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, s, s);
      }, 64);
    },
    get bullethole() {
      return makeSprite("sprite:bullethole", (g, s) => {
        g.clearRect(0, 0, s, s);
        const c = s / 2;
        const rng = makeRng(7);
        // Dust ring first, hole punched over it.
        const ring = g.createRadialGradient(c, c, s * 0.08, c, c, s * 0.5);
        ring.addColorStop(0, "rgba(30,24,18,0.85)");
        ring.addColorStop(0.35, "rgba(90,78,62,0.42)");
        ring.addColorStop(1, "rgba(120,105,86,0)");
        g.fillStyle = ring;
        g.beginPath(); g.arc(c, c, s * 0.5, 0, Math.PI * 2); g.fill();

        g.fillStyle = "rgba(12,10,9,0.95)";
        g.beginPath();
        for (let i = 0; i <= 14; i += 1) {
          const a = (i / 14) * Math.PI * 2;
          const r = s * (0.11 + rng() * 0.035);
          const x = c + Math.cos(a) * r;
          const y = c + Math.sin(a) * r;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.closePath();
        g.fill();
      }, 128);
    },
    get scorch() {
      return makeSprite("sprite:scorch", (g, s) => {
        const image = g.createImageData(s, s);
        for (let y = 0; y < s; y += 1) {
          for (let x = 0; x < s; x += 1) {
            const u = x / s - 0.5;
            const v = y / s - 0.5;
            const r = Math.hypot(u, v) * 2;
            const edge = fbmPeriodic(x / s, y / s, 6, 4, 0.5, 733) * 0.32;
            const a = clamp01(1 - (r + edge)) ** 1.6 * 235;
            const i = (y * s + x) * 4;
            image.data[i] = 22; image.data[i + 1] = 18; image.data[i + 2] = 15;
            image.data[i + 3] = a;
          }
        }
        g.putImageData(image, 0, 0);
      });
    },
  };

  /* ------------------------------ api ------------------------------ */

  const api = {
    size: SIZE,
    sprites,

    /** Get (and lazily build) a PBR set by name. */
    get(name, size = null) {
      if (cache.has(name)) return cache.get(name);
      const generator = GENERATORS[name];
      if (!generator) throw new Error(`[blacksand] no texture generator "${name}"`);
      return generator(size === null ? sizeFor(name) : size);
    },

    list() { return Object.keys(GENERATORS); },

    /** Register a generator from another module (the structures agent
     *  adds its own surfaces this way rather than editing this file). */
    register(name, generator) { GENERATORS[name] = generator; },

    synth,
    heightField,
    normalFromHeight,
    aoFromHeight,
    aoField,
    makeFields,
    makeTileableNoise,
    toTexture,

    dispose() {
      const seen = new Set();
      for (const value of cache.values()) {
        if (!value) continue;
        if (value.isTexture) { value.dispose(); continue; }
        for (const key of ["map", "normalMap", "roughnessMap", "aoMap", "ormMap"]) {
          const texture = value[key];
          if (texture && !seen.has(texture)) { seen.add(texture); texture.dispose(); }
        }
      }
      cache.clear();
    },
  };

  // Pre-build the surfaces the first frame needs, so the loading bar
  // covers the cost instead of the first second of play.
  for (const name of ["sand", "dirt", "rock", "gravel", "macro", "concrete", "blockwall"]) {
    api.get(name);
  }

  return api;
}
