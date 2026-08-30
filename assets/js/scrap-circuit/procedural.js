/* ============================================================
   SCRAP CIRCUIT — procedural texture bakery
   ------------------------------------------------------------
   The hand-picked AI textures cover ground, walls and vehicles.
   What they cannot cover is the stuff a 90s arena brawler builds
   its skyline out of: window grids, storefronts, sidewalk slabs,
   chain-link, garage doors, painted road markings. Those are
   *structured* textures — a grid of lit and unlit windows has to
   line up with the storey height of the building it is on — so
   they are painted here at runtime on a 2D canvas instead.

   House rules so these sit next to the AI art without clashing:
   - 128 px tiles, same as the manifest art.
   - Everything is dithered and posterised to a small palette; no
     smooth gradients, because the blit shader quantises to 15-bit
     anyway and untreated gradients band badly.
   - Grime, streaks and edge wear on every surface. A clean
     texture reads as "untextured flat colour" from ten metres.

   Textures are cached by their full option signature, so a facade
   asked for twice with the same palette is uploaded to the GPU once.
   ============================================================ */
(() => {
  "use strict";
  const SCRAP = (window.SCRAP = window.SCRAP || {});

  const cache = new Map();

  function makeCanvas(size) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    return c;
  }

  /* ---------------- palette + noise helpers ---------------- */

  function hex(n) {
    return `#${n.toString(16).padStart(6, "0")}`;
  }
  function shade(n, f) {
    const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
    const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
    const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
    return `rgb(${r},${g},${b})`;
  }

  /* Deterministic PRNG so the same key always paints the same tile —
     otherwise a rebuilt arena shuffles every wall between rounds. */
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* Speckle noise: the cheapest way to stop a fill reading as plastic. */
  function speckle(ctx, size, rand, amount, dark, light) {
    const n = Math.round(size * size * amount);
    for (let i = 0; i < n; i += 1) {
      const x = Math.floor(rand() * size);
      const y = Math.floor(rand() * size);
      ctx.fillStyle = rand() < 0.5 ? dark : light;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  /* Vertical grime streaks — the single most "used building" cue. */
  function streaks(ctx, size, rand, count, color, alphaMax = 0.22) {
    for (let i = 0; i < count; i += 1) {
      const x = Math.floor(rand() * size);
      const w = 1 + Math.floor(rand() * 3);
      const top = Math.floor(rand() * size * 0.6);
      const h = Math.floor(size * (0.25 + rand() * 0.6));
      ctx.globalAlpha = 0.06 + rand() * alphaMax;
      ctx.fillStyle = color;
      ctx.fillRect(x, top, w, h);
    }
    ctx.globalAlpha = 1;
  }

  /* Edge wear so tiled surfaces don't show a perfect seam grid. */
  function scuff(ctx, size, rand, count, color) {
    for (let i = 0; i < count; i += 1) {
      const x = rand() * size;
      const y = rand() * size;
      const w = 2 + rand() * 10;
      const h = 1 + rand() * 3;
      ctx.globalAlpha = 0.1 + rand() * 0.25;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- painters ---------------- */
  /* Every painter takes (ctx, size, opts, rand). Sizes are in pixels of
     the tile; callers pick the world size the tile covers. */

  const painters = {
    /* Office / apartment facade. One tile = one storey band by default,
       so a building N storeys tall tiles the texture N times vertically
       and the window rows land exactly on the floors. */
    facade(ctx, size, o, rand) {
      const base = o.base == null ? 0x6a6e78 : o.base;
      const cols = o.cols || 4;
      const litChance = o.lit == null ? 0.22 : o.lit;
      const litColor = o.litColor || "#ffd98a";
      const glass = o.glass || "#26313f";

      ctx.fillStyle = shade(base, 1);
      ctx.fillRect(0, 0, size, size);
      // Concrete banding between floors.
      ctx.fillStyle = shade(base, 1.14);
      ctx.fillRect(0, 0, size, Math.round(size * 0.09));
      ctx.fillStyle = shade(base, 0.72);
      ctx.fillRect(0, Math.round(size * 0.09), size, 2);
      ctx.fillStyle = shade(base, 0.82);
      ctx.fillRect(0, size - Math.round(size * 0.06), size, Math.round(size * 0.06));

      const pad = size * 0.05;
      const cw = (size - pad * 2) / cols;
      const winTop = size * 0.17;
      const winH = size * 0.6;
      for (let c = 0; c < cols; c += 1) {
        const x = pad + c * cw;
        const ww = cw * 0.66;
        const ox = x + (cw - ww) / 2;
        // Recessed frame.
        ctx.fillStyle = shade(base, 0.6);
        ctx.fillRect(ox - 2, winTop - 2, ww + 4, winH + 4);
        const isLit = rand() < litChance;
        ctx.fillStyle = isLit ? litColor : glass;
        ctx.fillRect(ox, winTop, ww, winH);
        if (isLit) {
          // Blinds / interior clutter so lit windows aren't flat blocks.
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          const bh = Math.max(1, Math.round(winH * (0.15 + rand() * 0.4)));
          ctx.fillRect(ox, winTop, ww, bh);
        } else {
          // Sky reflection wedge on the upper-left of dark glass.
          ctx.fillStyle = "rgba(160,190,215,0.13)";
          ctx.beginPath();
          ctx.moveTo(ox, winTop);
          ctx.lineTo(ox + ww, winTop);
          ctx.lineTo(ox, winTop + winH * 0.7);
          ctx.closePath();
          ctx.fill();
        }
        // Mullion.
        ctx.fillStyle = shade(base, 0.5);
        ctx.fillRect(ox + ww / 2 - 1, winTop, 2, winH);
        // Sill.
        ctx.fillStyle = shade(base, 1.2);
        ctx.fillRect(ox - 3, winTop + winH, ww + 6, 3);
      }
      streaks(ctx, size, rand, 14, "#1b1c20", 0.2);
      speckle(ctx, size, rand, 0.05, "rgba(0,0,0,0.3)", "rgba(255,255,255,0.12)");
    },

    /* Ground-floor storefront: awning, big glass, sign band. Used as the
       bottom tile of street-facing buildings. */
    storefront(ctx, size, o, rand) {
      const base = o.base == null ? 0x77706a : o.base;
      const awning = o.awning || "#a8342e";
      const sign = o.sign || "#1d2430";
      ctx.fillStyle = shade(base, 1);
      ctx.fillRect(0, 0, size, size);

      // Sign band across the top.
      ctx.fillStyle = sign;
      ctx.fillRect(0, 0, size, Math.round(size * 0.2));
      ctx.fillStyle = o.signInk || "#e8c65a";
      const words = 2 + Math.floor(rand() * 2);
      let sx = 8;
      for (let w = 0; w < words; w += 1) {
        const wl = 12 + Math.floor(rand() * 26);
        ctx.fillRect(sx, Math.round(size * 0.07), wl, Math.round(size * 0.06));
        sx += wl + 7;
      }

      // Awning stripes.
      const ay = Math.round(size * 0.2);
      const ah = Math.round(size * 0.11);
      for (let x = 0; x < size; x += 10) {
        ctx.fillStyle = (x / 10) % 2 ? awning : "#e6ddcd";
        ctx.fillRect(x, ay, 10, ah);
      }
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, ay + ah, size, 3);

      // Plate glass + door.
      const gy = ay + ah + 4;
      const gh = size - gy - Math.round(size * 0.07);
      ctx.fillStyle = "#1a2732";
      ctx.fillRect(6, gy, size - 12, gh);
      ctx.fillStyle = "rgba(150,185,210,0.16)";
      ctx.beginPath();
      ctx.moveTo(6, gy);
      ctx.lineTo(size - 6, gy);
      ctx.lineTo(6, gy + gh * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shade(base, 0.55);
      ctx.fillRect(Math.round(size * 0.45), gy, 5, gh);   // door frame
      ctx.fillRect(Math.round(size * 0.2), gy, 3, gh);    // mullions
      ctx.fillRect(Math.round(size * 0.75), gy, 3, gh);
      // Kickplate + pavement line.
      ctx.fillStyle = shade(base, 0.65);
      ctx.fillRect(0, size - Math.round(size * 0.07), size, Math.round(size * 0.07));
      streaks(ctx, size, rand, 8, "#15161a", 0.16);
      speckle(ctx, size, rand, 0.05, "rgba(0,0,0,0.32)", "rgba(255,255,255,0.1)");
    },

    /* Night skyline block — for the far-off backdrop towers. Unlit
       material, so the window pattern is the whole read. */
    towerNight(ctx, size, o, rand) {
      const base = o.base == null ? 0x12161f : o.base;
      ctx.fillStyle = shade(base, 1);
      ctx.fillRect(0, 0, size, size);
      const cols = o.cols || 6;
      const rows = o.rows || 8;
      const cw = size / cols;
      const rh = size / rows;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const on = rand() < (o.lit == null ? 0.3 : o.lit);
          ctx.fillStyle = on
            ? (rand() < 0.25 ? "#cfe4ff" : "#ffcf7a")
            : shade(base, 1.35);
          ctx.fillRect(c * cw + cw * 0.22, r * rh + rh * 0.22, cw * 0.56, rh * 0.5);
        }
      }
      speckle(ctx, size, rand, 0.03, "rgba(0,0,0,0.4)", "rgba(255,255,255,0.06)");
    },

    /* Concrete sidewalk slabs with expansion joints. */
    sidewalk(ctx, size, o, rand) {
      const base = o.base == null ? 0x9a968c : o.base;
      ctx.fillStyle = shade(base, 1);
      ctx.fillRect(0, 0, size, size);
      const n = o.slabs || 2;
      const step = size / n;
      ctx.fillStyle = shade(base, 0.68);
      for (let i = 0; i <= n; i += 1) {
        ctx.fillRect(Math.round(i * step), 0, 2, size);
        ctx.fillRect(0, Math.round(i * step), size, 2);
      }
      // Slab-to-slab tone variation.
      for (let y = 0; y < n; y += 1) {
        for (let x = 0; x < n; x += 1) {
          ctx.globalAlpha = 0.05 + rand() * 0.1;
          ctx.fillStyle = rand() < 0.5 ? "#000" : "#fff";
          ctx.fillRect(x * step + 2, y * step + 2, step - 4, step - 4);
        }
      }
      ctx.globalAlpha = 1;
      scuff(ctx, size, rand, 26, "#4b4a45");
      speckle(ctx, size, rand, 0.1, "rgba(0,0,0,0.28)", "rgba(255,255,255,0.16)");
    },

    /* Chain-link — transparent, for junkyard and lot boundaries. */
    chainlink(ctx, size, o, rand) {
      ctx.clearRect(0, 0, size, size);
      const cell = o.cell || 16;
      ctx.strokeStyle = o.wire || "#b9bec6";
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.95;
      for (let i = -size; i < size * 2; i += cell) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i, size); ctx.lineTo(i + size, 0); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Rust flecks on the wire.
      for (let i = 0; i < 60; i += 1) {
        ctx.fillStyle = "rgba(140,80,40,0.5)";
        ctx.fillRect(rand() * size, rand() * size, 2, 2);
      }
    },

    /* Segmented roll-up garage / loading dock door. */
    garage(ctx, size, o, rand) {
      const base = o.base == null ? 0x8d8f94 : o.base;
      ctx.fillStyle = shade(base, 1);
      ctx.fillRect(0, 0, size, size);
      const seg = o.segments || 6;
      const sh = size / seg;
      for (let i = 0; i < seg; i += 1) {
        ctx.fillStyle = shade(base, i % 2 ? 0.9 : 1.06);
        ctx.fillRect(0, i * sh, size, sh - 2);
        ctx.fillStyle = shade(base, 0.55);
        ctx.fillRect(0, i * sh + sh - 2, size, 2);
        // Panel indents.
        ctx.strokeStyle = shade(base, 0.75);
        ctx.lineWidth = 1;
        ctx.strokeRect(6, i * sh + 4, size - 12, sh - 10);
      }
      streaks(ctx, size, rand, 6, "#3a2a1c", 0.25);
      scuff(ctx, size, rand, 18, "#5a4433");
      speckle(ctx, size, rand, 0.05, "rgba(0,0,0,0.3)", "rgba(255,255,255,0.1)");
    },

    /* Asphalt with no painted lines — for lots, cul-de-sacs, aprons. */
    asphalt(ctx, size, o, rand) {
      const base = o.base == null ? 0x3b3c41 : o.base;
      ctx.fillStyle = shade(base, 1);
      ctx.fillRect(0, 0, size, size);
      speckle(ctx, size, rand, 0.55, "rgba(0,0,0,0.5)", "rgba(190,190,195,0.22)");
      // Tar-patched cracks.
      ctx.strokeStyle = "rgba(12,12,14,0.85)";
      for (let i = 0; i < 5; i += 1) {
        ctx.lineWidth = 1 + rand() * 2;
        ctx.beginPath();
        let x = rand() * size;
        let y = rand() * size;
        ctx.moveTo(x, y);
        for (let s = 0; s < 5; s += 1) {
          x += (rand() - 0.5) * 40;
          y += (rand() - 0.5) * 40;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Oil stains.
      for (let i = 0; i < 3; i += 1) {
        ctx.globalAlpha = 0.18 + rand() * 0.15;
        ctx.fillStyle = "#0b0b0d";
        const r = 8 + rand() * 20;
        ctx.beginPath();
        ctx.ellipse(rand() * size, rand() * size, r, r * 0.7, rand() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },

    /* Painted road markings on transparent — laid over asphalt so lane
       lines can follow the road instead of tiling with the texture. */
    roadLine(ctx, size, o, rand) {
      ctx.clearRect(0, 0, size, size);
      const color = o.color || "#e8d76a";
      const dash = o.dash == null ? true : o.dash;
      ctx.fillStyle = color;
      const w = Math.max(2, Math.round(size * (o.width || 0.09)));
      if (dash) {
        for (let y = 0; y < size; y += size / 2) {
          ctx.fillRect((size - w) / 2, y + size * 0.09, w, size * 0.32);
        }
      } else {
        ctx.fillRect((size - w) / 2, 0, w, size);
      }
      // Worn paint.
      ctx.globalCompositeOperation = "destination-out";
      for (let i = 0; i < 40; i += 1) {
        ctx.fillStyle = "#000";
        ctx.fillRect(rand() * size, rand() * size, 2 + rand() * 4, 1 + rand() * 3);
      }
      ctx.globalCompositeOperation = "source-over";
    },

    /* Shingled pitched roof. */
    shingle(ctx, size, o, rand) {
      const base = o.base == null ? 0x5a4038 : o.base;
      ctx.fillStyle = shade(base, 0.8);
      ctx.fillRect(0, 0, size, size);
      const rows = o.rows || 8;
      const rh = size / rows;
      for (let r = 0; r < rows; r += 1) {
        const off = (r % 2) * (size / 12);
        for (let x = -size / 12; x < size; x += size / 6) {
          ctx.fillStyle = shade(base, 0.85 + rand() * 0.35);
          ctx.fillRect(x + off + 1, r * rh, size / 6 - 2, rh - 1);
        }
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(0, r * rh + rh - 1, size, 1);
      }
      speckle(ctx, size, rand, 0.1, "rgba(0,0,0,0.3)", "rgba(255,255,255,0.08)");
    },

    /* Brick — courses with mortar and a few blown-out bricks. */
    brick(ctx, size, o, rand) {
      const base = o.base == null ? 0x7a3f30 : o.base;
      const mortar = o.mortar || "#9a9284";
      ctx.fillStyle = mortar;
      ctx.fillRect(0, 0, size, size);
      const rows = o.rows || 10;
      const bh = size / rows;
      const bw = size / 4;
      for (let r = 0; r < rows; r += 1) {
        const off = (r % 2) * (bw / 2);
        for (let x = -bw; x < size; x += bw) {
          ctx.fillStyle = shade(base, 0.78 + rand() * 0.45);
          ctx.fillRect(x + off + 1, r * bh + 1, bw - 2, bh - 2);
        }
      }
      scuff(ctx, size, rand, 14, "#4a2a20");
      streaks(ctx, size, rand, 6, "#2a1c16", 0.18);
      speckle(ctx, size, rand, 0.08, "rgba(0,0,0,0.28)", "rgba(255,255,255,0.1)");
    },

    /* Big painted ad board — parody copy, deliberately unreadable at
       gameplay distance but colourful enough to break up a wall. */
    billboard(ctx, size, o, rand) {
      const bg = o.bg || "#d8452e";
      const ink = o.ink || "#f4ecd8";
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = o.band || "#1c2230";
      ctx.fillRect(0, size * 0.62, size, size * 0.16);
      ctx.fillStyle = ink;
      // Headline block letters.
      let x = 8;
      for (let i = 0; i < 5; i += 1) {
        const w = 10 + rand() * 18;
        ctx.fillRect(x, size * 0.2, w, size * 0.2);
        x += w + 6;
        if (x > size - 14) break;
      }
      // Body copy lines.
      ctx.globalAlpha = 0.7;
      for (let i = 0; i < 3; i += 1) {
        ctx.fillRect(10, size * 0.65 + i * 7, size * (0.4 + rand() * 0.45), 3);
      }
      ctx.globalAlpha = 1;
      scuff(ctx, size, rand, 12, "#2a2018");
      speckle(ctx, size, rand, 0.05, "rgba(0,0,0,0.25)", "rgba(255,255,255,0.12)");
    },

    /* Sky: a banded vertical gradient with horizon haze. Painted, not
       shaded, so it quantises cleanly through the 15-bit blit. */
    sky(ctx, size, o, rand) {
      const top = o.top || [0x1a, 0x2c, 0x50];
      const bottom = o.bottom || [0xc9, 0x77, 0x47];
      // Enough bands that the blit shader's own 15-bit quantise decides
      // the stepping; at 26 the painter's banding won and the sky looked
      // like a stack of coloured tape.
      const bands = o.bands || 72;
      for (let i = 0; i < bands; i += 1) {
        const t = i / (bands - 1);
        const e = Math.pow(t, o.curve || 1.5);
        const r = Math.round(top[0] + (bottom[0] - top[0]) * e);
        const g = Math.round(top[1] + (bottom[1] - top[1]) * e);
        const b = Math.round(top[2] + (bottom[2] - top[2]) * e);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(0, Math.floor((i * size) / bands), size, Math.ceil(size / bands) + 1);
      }
      if (o.clouds) {
        /* Clouds are stacked, tapering ellipse runs rather than bars —
           a rectangle at this scale reads as a rendering artefact, which
           is exactly what the first pass looked like. */
        const decks = o.clouds === true ? 5 : o.clouds;
        for (let i = 0; i < decks; i += 1) {
          // Higher clouds are smaller and fainter, low ones are broad
          // banks — the perspective cue that makes a flat strip read as
          // a sky rather than a smear of dashes.
          const height = rand();
          const cy = size * (0.06 + height * 0.56);
          const cx = rand() * size;
          const spanW = size * (0.3 + (1 - height) * 0.45);
          const alpha = (0.12 + rand() * 0.16) * (0.5 + (1 - height) * 0.7);
          const puffs = 7 + Math.floor(rand() * 7);
          // Two stacked passes: a soft mass, then brighter tops.
          for (let pass = 0; pass < 2; pass += 1) {
            for (let p = 0; p < puffs; p += 1) {
              const t = p / (puffs - 1) - 0.5;
              const fall = 1 - t * t * 3.2;
              if (fall <= 0.05) continue;
              const rx = spanW * 0.22 * (0.75 + rand() * 0.5);
              const ry = Math.max(2.5, rx * (0.3 + rand() * 0.22) * (pass ? 0.55 : 1));
              ctx.globalAlpha = alpha * fall * (pass ? 0.85 : 1);
              ctx.fillStyle = pass ? (o.cloudTop || o.cloud || "#ffffff") : (o.cloud || "#ffffff");
              const py = cy - (pass ? ry * 0.7 : 0) + (rand() - 0.5) * 5;
              /* Drawn three times, offset by a full tile each way, so a
                 cloud straddling the edge continues on the other side.
                 The sky texture is repeated around the dome; without this
                 a hard vertical seam runs down the sky wherever a cloud
                 was clipped. */
              for (let w = -1; w <= 1; w += 1) {
                ctx.beginPath();
                ctx.ellipse(cx + t * spanW + w * size, py, rx, ry, 0, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          }
        }
        ctx.globalAlpha = 1;
      }
      if (o.stars) {
        for (let i = 0; i < 90; i += 1) {
          const y = rand() * size * 0.6;
          ctx.globalAlpha = 0.25 + rand() * 0.7;
          ctx.fillStyle = "#dfe8ff";
          ctx.fillRect(rand() * size, y, 1, 1);
        }
        ctx.globalAlpha = 1;
      }
    },

    /* Rolling sea / harbour water with a horizon band of chop. */
    water(ctx, size, o, rand) {
      const base = o.base == null ? 0x1e3d5c : o.base;
      ctx.fillStyle = shade(base, 1);
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 42; i += 1) {
        const y = rand() * size;
        const w = 6 + rand() * 26;
        ctx.globalAlpha = 0.1 + rand() * 0.25;
        ctx.fillStyle = rand() < 0.6 ? shade(base, 1.5) : shade(base, 0.65);
        ctx.fillRect(rand() * size, y, w, 2);
      }
      ctx.globalAlpha = 1;
      speckle(ctx, size, rand, 0.08, "rgba(0,0,0,0.2)", "rgba(200,225,255,0.2)");
    },

    /* Flat painted metal panel with rivets — trailers, containers, plant. */
    panel(ctx, size, o, rand) {
      const base = o.base == null ? 0x8a8f96 : o.base;
      ctx.fillStyle = shade(base, 1);
      ctx.fillRect(0, 0, size, size);
      const seams = o.seams || 4;
      for (let i = 0; i <= seams; i += 1) {
        ctx.fillStyle = shade(base, 0.7);
        ctx.fillRect(Math.round((i * size) / seams), 0, 2, size);
      }
      ctx.fillStyle = shade(base, 0.55);
      for (let i = 0; i <= seams; i += 1) {
        for (let y = 6; y < size; y += 18) {
          ctx.fillRect(Math.round((i * size) / seams) - 1, y, 3, 3);
        }
      }
      streaks(ctx, size, rand, 9, "#4a2f1c", 0.3);
      scuff(ctx, size, rand, 20, "#6a4a30");
      speckle(ctx, size, rand, 0.06, "rgba(0,0,0,0.3)", "rgba(255,255,255,0.12)");
    },

    /* ---------- automotive ---------- */

    /* Tinted car glass. The shipped art for this was a cracked-ice tile,
       which turned every cabin in the roster into a glowing turquoise
       block — the single most damaging texture in the game. */
    carGlass(ctx, size, o, rand) {
      const base = o.base == null ? 0x1d2733 : o.base;
      ctx.fillStyle = shade(base, 1);
      ctx.fillRect(0, 0, size, size);
      // Sky reflection sweeping down from the upper left.
      const g = ctx.createLinearGradient(0, 0, size * 0.9, size);
      g.addColorStop(0, "rgba(180,208,232,0.55)");
      g.addColorStop(0.4, "rgba(120,150,180,0.18)");
      g.addColorStop(0.75, "rgba(20,28,40,0.0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      // A couple of hard specular bands — glass needs a straight edge.
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = "#dff0ff";
      ctx.beginPath();
      ctx.moveTo(size * 0.05, size * 0.55);
      ctx.lineTo(size * 0.55, size * 0.02);
      ctx.lineTo(size * 0.72, size * 0.02);
      ctx.lineTo(size * 0.2, size * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      // Grime along the bottom edge and a few chips.
      ctx.fillStyle = "rgba(20,22,26,0.45)";
      ctx.fillRect(0, size - 10, size, 10);
      for (let i = 0; i < 14; i += 1) {
        ctx.globalAlpha = 0.1 + rand() * 0.2;
        ctx.fillStyle = "#cfe0ee";
        ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 3, 1);
      }
      ctx.globalAlpha = 1;
    },

    /* Automotive paint: a flat colour is not a texture, so this lays in
       orange-peel mottling, a faint horizontal shade break where the
       body line runs, and honest wear — stone chips low down, swirls in
       the clear coat, rust creeping out of the seams. */
    carPaint(ctx, size, o, rand) {
      const base = o.base == null ? 0x2f9fb4 : o.base;
      ctx.fillStyle = shade(base, 1);
      ctx.fillRect(0, 0, size, size);
      // Panel shading: lighter toward the top, darker at the sill.
      const g = ctx.createLinearGradient(0, 0, 0, size);
      g.addColorStop(0, "rgba(255,255,255,0.13)");
      g.addColorStop(0.42, "rgba(255,255,255,0.02)");
      g.addColorStop(0.62, "rgba(0,0,0,0.05)");
      g.addColorStop(1, "rgba(0,0,0,0.34)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      // Body crease.
      ctx.fillStyle = shade(base, 1.28);
      ctx.fillRect(0, Math.round(size * 0.46), size, 2);
      ctx.fillStyle = shade(base, 0.7);
      ctx.fillRect(0, Math.round(size * 0.48), size, 2);
      // Clear-coat swirls.
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 22; i += 1) {
        ctx.beginPath();
        ctx.arc(rand() * size, rand() * size, 3 + rand() * 12, rand() * 6, rand() * 6);
        ctx.stroke();
      }
      // Stone chips along the bottom, rust blooms at the seams.
      for (let i = 0; i < 60; i += 1) {
        ctx.globalAlpha = 0.2 + rand() * 0.5;
        ctx.fillStyle = rand() < 0.55 ? "#3a2a20" : "#8a5a34";
        const y = size * (0.6 + rand() * 0.4);
        ctx.fillRect(rand() * size, y, 1 + rand() * 2, 1 + rand() * 2);
      }
      ctx.globalAlpha = 1;
      if (o.rust !== false) {
        for (let i = 0; i < 4; i += 1) {
          ctx.globalAlpha = 0.16 + rand() * 0.2;
          ctx.fillStyle = "#8a4a24";
          const rx = rand() * size, ry = rand() * size;
          const r = 3 + rand() * 9;
          ctx.beginPath();
          ctx.ellipse(rx, ry, r, r * 0.6, rand() * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      speckle(ctx, size, rand, 0.06, "rgba(0,0,0,0.22)", "rgba(255,255,255,0.1)");
    },

    /* Wheel face: tyre sidewall ring with a lettered shoulder, a rim and
       spokes. Used on the wheel end-caps so wheels stop reading as
       featureless black cylinders. */
    wheelFace(ctx, size, o, rand) {
      const c = size / 2;
      ctx.fillStyle = "#131317";
      ctx.fillRect(0, 0, size, size);
      // Tyre shoulder.
      ctx.strokeStyle = "#26262c";
      ctx.lineWidth = size * 0.09;
      ctx.beginPath(); ctx.arc(c, c, size * 0.44, 0, Math.PI * 2); ctx.stroke();
      // Whitewall lettering, faint.
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = "#cfcfc8";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(c, c, size * 0.38, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      // Rim.
      const rim = o.rim || "#9aa0a8";
      ctx.fillStyle = rim;
      ctx.beginPath(); ctx.arc(c, c, size * 0.29, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade(0x2a2c32, 1);
      ctx.beginPath(); ctx.arc(c, c, size * 0.24, 0, Math.PI * 2); ctx.fill();
      // Spokes.
      const spokes = o.spokes || 5;
      ctx.fillStyle = rim;
      for (let i = 0; i < spokes; i += 1) {
        const ang = (i / spokes) * Math.PI * 2;
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(ang);
        ctx.fillRect(-size * 0.035, -size * 0.245, size * 0.07, size * 0.2);
        ctx.restore();
      }
      // Hub cap + nuts.
      ctx.fillStyle = shade(0xd0d4da, 1);
      ctx.beginPath(); ctx.arc(c, c, size * 0.085, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#4a4d55";
      for (let i = 0; i < 5; i += 1) {
        const ang = (i / 5) * Math.PI * 2 + 0.4;
        ctx.fillRect(c + Math.cos(ang) * size * 0.135 - 2, c + Math.sin(ang) * size * 0.135 - 2, 4, 4);
      }
      speckle(ctx, size, rand, 0.05, "rgba(0,0,0,0.4)", "rgba(200,200,210,0.12)");
    },

    /* Radiator grille + valance. */
    grille(ctx, size, o, rand) {
      const base = o.base == null ? 0x2a2c32 : o.base;
      ctx.fillStyle = shade(base, 1);
      ctx.fillRect(0, 0, size, size);
      const bars = o.bars || 7;
      for (let i = 0; i < bars; i += 1) {
        ctx.fillStyle = shade(base, i % 2 ? 1.7 : 0.6);
        ctx.fillRect(4, 6 + i * ((size - 12) / bars), size - 8, ((size - 12) / bars) * 0.55);
      }
      ctx.strokeStyle = o.chrome || "#b8bcc4";
      ctx.lineWidth = 3;
      ctx.strokeRect(3, 4, size - 6, size - 8);
      scuff(ctx, size, rand, 14, "#6a6050");
      speckle(ctx, size, rand, 0.06, "rgba(0,0,0,0.35)", "rgba(255,255,255,0.12)");
    },

    /* Headlight / taillight lens: concentric rings so it reads as glass
       with a bulb behind it rather than a flat coloured rectangle. */
    lamp(ctx, size, o, rand) {
      const c = size / 2;
      const tint = o.tint || "#ffe9b0";
      ctx.fillStyle = o.housing || "#2a2c32";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = tint;
      ctx.beginPath(); ctx.arc(c, c, size * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath(); ctx.arc(c, c, size * 0.2, 0, Math.PI * 2); ctx.fill();
      // Fresnel rings.
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 2;
      for (let r = size * 0.12; r < size * 0.42; r += size * 0.07) {
        ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(c - size * 0.3, c - size * 0.32, size * 0.24, size * 0.1);
      ctx.globalAlpha = 1;
    },

    /* Highway sound wall: precast panels between posts, with a coping
       cap. A plain speckled slab is the one surface in the game that
       still lost a blind comparison — a 9 m wall with no rhythm reads as
       untextured no matter how much noise is sprinkled on it. */
    soundwall(ctx, size, o, rand) {
      const base = o.base == null ? 0x8a8378 : o.base;
      ctx.fillStyle = shade(base, 1);
      ctx.fillRect(0, 0, size, size);
      // Vertical precast panels.
      const panels = o.panels || 3;
      const pw = size / panels;
      for (let i = 0; i < panels; i += 1) {
        ctx.fillStyle = shade(base, 0.86 + ((i * 37) % 30) / 100);
        ctx.fillRect(i * pw + 4, 0, pw - 8, size);
        // Deeply recessed field with a lit top lip and a shadowed sill —
        // this is what gives the wall relief at a distance.
        ctx.fillStyle = shade(base, 0.62);
        ctx.fillRect(i * pw + 11, size * 0.1, pw - 22, size * 0.76);
        ctx.fillStyle = shade(base, 0.42);
        ctx.fillRect(i * pw + 11, size * 0.1, pw - 22, 4);
        ctx.fillStyle = shade(base, 1.34);
        ctx.fillRect(i * pw + 11, size * 0.86 - 4, pw - 22, 4);
        // Horizontal lift joints inside the field.
        ctx.fillStyle = shade(base, 0.52);
        for (let k = 1; k < 4; k += 1) {
          ctx.fillRect(i * pw + 11, size * (0.1 + k * 0.19), pw - 22, 2);
        }
        // Post between panels: light face, dark shadow side.
        ctx.fillStyle = shade(base, 1.28);
        ctx.fillRect(i * pw - 4, 0, 6, size);
        ctx.fillStyle = shade(base, 0.4);
        ctx.fillRect(i * pw + 2, 0, 4, size);
      }
      // Coping cap along the top and a dirt band at the bottom.
      ctx.fillStyle = shade(base, 1.22);
      ctx.fillRect(0, 0, size, Math.round(size * 0.07));
      ctx.fillStyle = shade(base, 0.55);
      ctx.fillRect(0, Math.round(size * 0.07), size, 3);
      ctx.fillStyle = shade(base, 0.6);
      ctx.fillRect(0, size - Math.round(size * 0.1), size, Math.round(size * 0.1));
      // Road dirt climbing the bottom third — a real sound wall is
      // filthy at car height and clean at the cap.
      for (let y = Math.round(size * 0.55); y < size; y += 1) {
        const k = (y - size * 0.55) / (size * 0.45);
        ctx.globalAlpha = k * 0.3;
        ctx.fillStyle = "#3a332a";
        ctx.fillRect(0, y, size, 1);
      }
      ctx.globalAlpha = 1;
      streaks(ctx, size, rand, 20, "#332e26", 0.3);
      scuff(ctx, size, rand, 26, "#5c5648");
      /* Speckle stays low here. At 9% the dots were the loudest thing on
         the wall and buried the panel relief, so a 190 m barrier read as
         beige noise from the one angle a player sees it most: flush
         against it at speed. */
      speckle(ctx, size, rand, 0.025, "rgba(0,0,0,0.24)", "rgba(255,255,255,0.1)");
    },

    /* Soft radial disc, transparent at the rim. Laid flat on the ground
       under a lamp or a neon sign it becomes a pool of light, which is
       the single most characteristic thing about how a 1995 vehicular
       brawler lit its streets: bright puddles under the lights, near
       black between them. */
    glowDisc(ctx, size, o, rand) {
      ctx.clearRect(0, 0, size, size);
      const c = size / 2;
      const g = ctx.createRadialGradient(c, c, size * 0.02, c, c, size * 0.5);
      const tint = o.tint || "255,232,168";
      g.addColorStop(0, `rgba(${tint},${o.core == null ? 0.95 : o.core})`);
      g.addColorStop(0.28, `rgba(${tint},${(o.core == null ? 0.95 : o.core) * 0.6})`);
      g.addColorStop(0.62, `rgba(${tint},${(o.core == null ? 0.95 : o.core) * 0.22})`);
      g.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      // Break the perfect circle so it reads as light on a real surface.
      ctx.globalCompositeOperation = "destination-out";
      for (let i = 0; i < 40; i += 1) {
        ctx.globalAlpha = 0.04 + rand() * 0.12;
        ctx.fillStyle = "#000";
        const a = rand() * Math.PI * 2;
        const d = size * (0.2 + rand() * 0.3);
        ctx.beginPath();
        ctx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, size * (0.03 + rand() * 0.08), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },

    /* Painted wall sign / graffiti panel. Period walls are covered in
       hand-painted ads and tags; a clean facade reads as a placeholder. */
    wallSign(ctx, size, o, rand) {
      ctx.clearRect(0, 0, size, size);
      const bg = o.bg || "#8a2f2a";
      const ink = o.ink || "#efe4cc";
      if (o.panel !== false) {
        ctx.fillStyle = bg;
        ctx.fillRect(2, 2, size - 4, size - 4);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 3;
        ctx.strokeRect(7, 7, size - 14, size - 14);
      }
      ctx.fillStyle = ink;
      // Big block headline.
      let x = 12;
      const hy = size * (o.panel === false ? 0.3 : 0.22);
      for (let i = 0; i < 4; i += 1) {
        const w = 10 + rand() * 22;
        if (x + w > size - 12) break;
        ctx.fillRect(x, hy, w, size * 0.18);
        x += w + 6;
      }
      // Second line, smaller.
      x = 14;
      for (let i = 0; i < 5; i += 1) {
        const w = 6 + rand() * 14;
        if (x + w > size - 14) break;
        ctx.fillRect(x, hy + size * 0.26, w, size * 0.08);
        x += w + 5;
      }
      if (o.tag) {
        // Spray tag: loose diagonal strokes over the top.
        ctx.strokeStyle = o.tagInk || "#5ee0c8";
        ctx.lineWidth = 4 + rand() * 3;
        ctx.lineCap = "round";
        for (let i = 0; i < 5; i += 1) {
          ctx.beginPath();
          let px = 10 + rand() * size * 0.6;
          let py = size * (0.4 + rand() * 0.4);
          ctx.moveTo(px, py);
          for (let k = 0; k < 3; k += 1) {
            px += 10 + rand() * 22;
            py += (rand() - 0.5) * 26;
            ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      }
      // Weathering: knock holes in the paint.
      ctx.globalCompositeOperation = "destination-out";
      for (let i = 0; i < 90; i += 1) {
        ctx.globalAlpha = 0.15 + rand() * 0.55;
        ctx.fillStyle = "#000";
        ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 5, 1 + rand() * 4);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },

    /* Hazard chevrons for crushers, presses, lifts. */
    hazard(ctx, size, o, rand) {
      const a = o.a || "#e0b52a";
      const b = o.b || "#22242a";
      ctx.fillStyle = a;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = b;
      const w = size / 4;
      for (let i = -size; i < size * 2; i += w * 2) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + w, 0);
        ctx.lineTo(i + w + size, size);
        ctx.lineTo(i + size, size);
        ctx.closePath();
        ctx.fill();
      }
      scuff(ctx, size, rand, 22, "#5a4a20");
      speckle(ctx, size, rand, 0.07, "rgba(0,0,0,0.35)", "rgba(255,255,255,0.12)");
    },
  };

  /* ============================================================
     FX SHEETS
     ------------------------------------------------------------
     A scaling sphere is a 2000s effect. A 90s arena brawler blew
     things up with a billboarded sprite animation: a white core
     that punches out, a boiling orange fireball, then greasy smoke
     that outlives the flame. These paint that as a frame grid.
     ============================================================ */

  /* Colour ramp for a fireball's life: core white -> yellow -> orange
     -> red -> ember -> smoke. */
  function fireRamp(t) {
    const stops = [
      [1.00, 1.00, 0.94],
      [1.00, 0.92, 0.52],
      [1.00, 0.62, 0.16],
      [0.87, 0.28, 0.07],
      [0.45, 0.20, 0.12],
      [0.22, 0.20, 0.20],
    ];
    const x = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
    const i = Math.floor(x);
    const f = x - i;
    const a = stops[i], b = stops[i + 1];
    return [
      Math.round((a[0] + (b[0] - a[0]) * f) * 255),
      Math.round((a[1] + (b[1] - a[1]) * f) * 255),
      Math.round((a[2] + (b[2] - a[2]) * f) * 255),
    ];
  }

  /**
   * Explosion sprite sheet. `cols` x `rows` frames of a fireball, drawn
   * as a set of blobs that keep their identity across frames so the
   * animation boils rather than flickers.
   */
  function paintExplosionSheet(ctx, cell, cols, rows, o, rand) {
    const frames = cols * rows;
    const blobs = [];
    const n = o.blobs || 16;
    for (let i = 0; i < n; i += 1) {
      blobs.push({
        ang: (i / n) * Math.PI * 2 + rand() * 0.5,
        dist: 0.18 + rand() * 0.62,
        size: 0.2 + rand() * 0.3,
        phase: rand() * 0.34,
        drift: 0.6 + rand() * 0.9,
      });
    }
    for (let f = 0; f < frames; f += 1) {
      const t = f / (frames - 1);
      const ox = (f % cols) * cell;
      const oy = Math.floor(f / cols) * cell;
      const cx = ox + cell / 2;
      const cy = oy + cell / 2;
      const grow = 0.25 + t * 0.78;
      const fade = t < 0.82 ? 1 : 1 - (t - 0.82) / 0.18;

      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, cell, cell);
      ctx.clip();

      // Fireball blobs, drawn back to front so the hot ones sit on top.
      blobs.forEach((b, i) => {
        const life = Math.min(1, t + b.phase);
        const [r, g, bl] = fireRamp(life);
        const d = b.dist * grow * cell * 0.5 * b.drift;
        const bx = cx + Math.cos(b.ang) * d;
        // Fireballs climb as they age.
        const by = cy + Math.sin(b.ang) * d * 0.85 - t * cell * 0.16;
        const rad = Math.max(1, b.size * grow * cell * 0.62);
        ctx.globalAlpha = fade * (life > 0.9 ? 0.4 : 0.85) * (0.7 + (i % 3) * 0.15);
        /* Soft-edged blobs. A hard `arc` fill is legible as a circle once
           the sprite is scaled to fifteen metres, and the late frames read
           as a stack of red discs rather than a fireball. */
        const grad = ctx.createRadialGradient(bx, by, rad * 0.15, bx, by, rad);
        grad.addColorStop(0, `rgba(${r},${g},${bl},1)`);
        grad.addColorStop(0.55, `rgba(${r},${g},${bl},0.85)`);
        grad.addColorStop(0.82, `rgba(${Math.round(r * 0.8)},${Math.round(g * 0.7)},${Math.round(bl * 0.7)},0.4)`);
        grad.addColorStop(1, `rgba(${Math.round(r * 0.6)},${Math.round(g * 0.5)},${Math.round(bl * 0.5)},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(bx, by, rad, 0, Math.PI * 2);
        ctx.fill();
      });

      // The core: a hard white punch that dies fast.
      if (t < 0.42) {
        const k = 1 - t / 0.42;
        ctx.globalAlpha = fade * k;
        ctx.fillStyle = "#fffdf2";
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.06 + cell * 0.24 * grow * k, 0, Math.PI * 2);
        ctx.fill();
      }

      // Flying embers on the mid frames.
      if (t > 0.12 && t < 0.85) {
        ctx.globalAlpha = fade * 0.9;
        for (let i = 0; i < 14; i += 1) {
          const ang = (i / 14) * Math.PI * 2 + f * 0.21;
          const d = grow * cell * (0.35 + ((i * 37) % 40) / 70);
          ctx.fillStyle = i % 3 ? "#ffd06a" : "#ff8a30";
          ctx.fillRect(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d - t * cell * 0.2,
            Math.max(1, cell * 0.02), Math.max(1, cell * 0.02));
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  /* Soft smoke puff — one frame, scaled and faded by the FX system.
     The blobs are drawn near-opaque and the softness comes entirely from
     the radial mask at the end. Painting them semi-transparent instead
     capped the sheet at about 20% alpha, which made every puff in the
     game invisible against a lit background. */
  function paintSmoke(ctx, size, o, rand) {
    ctx.clearRect(0, 0, size, size);
    const c = size / 2;
    const tint = o.tint || [128, 125, 120];
    for (let i = 0; i < 26; i += 1) {
      const ang = rand() * Math.PI * 2;
      const d = rand() * size * 0.24;
      const r = size * (0.16 + rand() * 0.2);
      const sh = 0.62 + rand() * 0.7;
      ctx.globalAlpha = 0.55 + rand() * 0.45;
      ctx.fillStyle = `rgb(${Math.min(255, Math.round(tint[0] * sh))},${Math.min(255, Math.round(tint[1] * sh))},${Math.min(255, Math.round(tint[2] * sh))})`;
      ctx.beginPath();
      ctx.arc(c + Math.cos(ang) * d, c + Math.sin(ang) * d, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Punch the corners out so the quad never shows as a square.
    ctx.globalCompositeOperation = "destination-in";
    const g = ctx.createRadialGradient(c, c, size * 0.02, c, c, size * 0.5);
    g.addColorStop(0, "rgba(0,0,0,0.95)");
    g.addColorStop(0.34, "rgba(0,0,0,0.82)");
    g.addColorStop(0.62, "rgba(0,0,0,0.48)");
    g.addColorStop(0.85, "rgba(0,0,0,0.15)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = "source-over";
  }

  /* Muzzle flash / weapon bloom: a star burst on transparent. */
  function paintFlash(ctx, size, o, rand) {
    ctx.clearRect(0, 0, size, size);
    const c = size / 2;
    const spikes = o.spikes || 7;
    ctx.fillStyle = o.tint || "#ffe28a";
    for (let i = 0; i < spikes; i += 1) {
      const ang = (i / spikes) * Math.PI * 2 + rand() * 0.3;
      const len = size * (0.24 + rand() * 0.26);
      const w = size * (0.03 + rand() * 0.05);
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.65 + rand() * 0.35;
      ctx.beginPath();
      ctx.moveTo(0, -w);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, w);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fffdf0";
    ctx.beginPath(); ctx.arc(c, c, size * 0.14, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = o.tint || "#ffe28a";
    ctx.beginPath(); ctx.arc(c, c, size * 0.24, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* Ground scorch decal. */
  function paintScorch(ctx, size, o, rand) {
    ctx.clearRect(0, 0, size, size);
    const c = size / 2;
    for (let i = 0; i < 26; i += 1) {
      const ang = rand() * Math.PI * 2;
      const d = rand() * size * 0.3;
      ctx.globalAlpha = 0.12 + rand() * 0.24;
      ctx.fillStyle = rand() < 0.7 ? "#131113" : "#3a2a1c";
      ctx.beginPath();
      ctx.ellipse(c + Math.cos(ang) * d, c + Math.sin(ang) * d,
        size * (0.1 + rand() * 0.2), size * (0.08 + rand() * 0.18), rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "destination-in";
    const g = ctx.createRadialGradient(c, c, size * 0.05, c, c, size * 0.5);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(0.65, "rgba(0,0,0,0.8)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  const sheetCache = new Map();

  /**
   * Animated sprite sheet. Returns { texture, cols, rows, frames } —
   * the FX pool clones the texture per sprite and walks offset/repeat.
   */
  function sheet(name, opts = {}) {
    const key = `${name}:${JSON.stringify(opts)}`;
    if (sheetCache.has(key)) return sheetCache.get(key);
    const cols = opts.cols || 4;
    const rows = opts.rows || 4;
    const cell = opts.cell || 96;
    const canvas = makeCanvas(1);
    canvas.width = cols * cell;
    canvas.height = rows * cell;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const rand = rng(opts.seed == null ? hashString(key) : opts.seed);
    if (name === "explosion") paintExplosionSheet(ctx, cell, cols, rows, opts, rand);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    if (THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
    texture.needsUpdate = true;
    const out = { texture, cols, rows, frames: cols * rows };
    sheetCache.set(key, out);
    return out;
  }

  /* Single-frame FX textures (smoke, flash, scorch). */
  function fxTex(name, opts = {}) {
    const key = `fx:${name}:${JSON.stringify(opts)}`;
    if (cache.has(key)) return cache.get(key);
    const size = opts.size || 96;
    const canvas = makeCanvas(size);
    const ctx = canvas.getContext("2d");
    const rand = rng(opts.seed == null ? hashString(key) : opts.seed);
    if (name === "smoke") paintSmoke(ctx, size, opts, rand);
    else if (name === "flash") paintFlash(ctx, size, opts, rand);
    else if (name === "scorch") paintScorch(ctx, size, opts, rand);
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    if (THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
    texture.needsUpdate = true;
    cache.set(key, texture);
    return texture;
  }

  /* ---------------- public API ---------------- */

  /**
   * Bake (or fetch from cache) a texture.
   * @param {string} painter  key in `painters`
   * @param {object} opts     painter options; `size` (default 128),
   *                          `seed` (defaults to a hash of the options)
   */
  function tex(painter, opts = {}) {
    const key = `${painter}:${JSON.stringify(opts)}`;
    if (cache.has(key)) return cache.get(key);
    const size = opts.size || 128;
    const canvas = makeCanvas(size);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const rand = rng(opts.seed == null ? hashString(key) : opts.seed);
    (painters[painter] || painters.panel)(ctx, size, opts, rand);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    if (THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
    texture.needsUpdate = true;
    cache.set(key, texture);
    return texture;
  }

  /**
   * Material backed by a baked texture. Goes through SCRAP.textures so a
   * manifest PNG dropped in under the same logical key still wins — the
   * procedural tile is the floor, not a ceiling.
   */
  function mat(key, painter, opts = {}) {
    const material = SCRAP.textures.mat(key, {
      color: 0xffffff,
      transparent: !!opts.transparent,
      opacity: opts.opacity == null ? 1 : opts.opacity,
      side: opts.side,
    });
    if (!material.map) {
      material.map = tex(painter, opts);
      material.userData.ps1SnapEnabled = false;
      material.needsUpdate = true;
    }
    material.userData.tile = opts.tile || 4;
    return material;
  }

  function basicMat(key, painter, opts = {}) {
    const material = SCRAP.textures.basicMat(key, {
      color: 0xffffff,
      transparent: !!opts.transparent,
      opacity: opts.opacity == null ? 1 : opts.opacity,
      side: opts.side,
    });
    if (!material.map) {
      material.map = tex(painter, opts);
      material.userData.ps1SnapEnabled = false;
      material.needsUpdate = true;
    }
    material.userData.tile = opts.tile || 4;
    return material;
  }

  SCRAP.proc = { tex, mat, basicMat, painters, cache, sheet, fxTex };
})();
