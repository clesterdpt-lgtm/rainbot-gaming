/* ============================================================
   BLACKSAND - vegetation

   Nine species of desert plant, every one an InstancedMesh, lit by a
   translucency term and moved by a gusting vertex wind.

   Four decisions drive the whole file:

   * ONE texture atlas, ONE material family. Every leaf, frond, blade
     and trunk samples a single 1024px atlas, so palms, reeds and crops
     differ by geometry and UV rect rather than by material. That keeps
     the program count at one and lets a species cost exactly one draw
     call.

   * Alpha CUT, with coverage-preserving mipmaps. Blended foliage sorts
     wrong, so the cutoff stays - but a naively mipped frond loses its
     leaflets by mip 3 (the box filter averages a 40%-covered texel down
     below the cutoff and the whole frond dissolves). The mip chain is
     built here in JS and each level's alpha is rescaled until its
     coverage matches level 0. That is the difference between palms that
     thin out at 60m and palms that survive to the horizon.

   * Translucency, not just diffuse. Foliage lit as an opaque solid
     reads as painted cardboard. A per-vertex thickness feeds a cheap
     back-scatter term so a frond between the camera and the sun glows.
     It is the single largest quality jump available in this module.

   * Placement is ecological, not uniform. A moisture field built from
     the wadi, altitude, slope and settlement irrigation decides which
     species may grow where, and everything is placed in clusters
     seeded on that field. Uniform scatter is the tell that gives away
     procedural vegetation instantly - real plants grow where the water
     is, in clumps, with bare ground between them.
   ============================================================ */

import { makeRng, makeNoise2D, clamp01, lerp, smoothstep } from "./core.js";

/* ---------------------------- atlas ---------------------------- */

const ATLAS = 1024;

/**
 * Cell rectangles in canvas pixels, [x, y, w, h], y measured down from
 * the top. Two rows of 256 under one row of 512, so the tall things
 * (fronds, bark, the palm impostor) get tall cells.
 *
 * Cells are padded by PAD texels when UVs are generated: without it the
 * mip chain bleeds a neighbour's colour into a leaf edge, and at mip 4
 * the reeds pick up the crop cell.
 */
const CELL = {
  frond:     [0, 0, 256, 512],
  frondDead: [256, 0, 256, 512],
  bark:      [512, 0, 256, 512],
  impostor:  [768, 0, 256, 512],
  tamarisk:  [0, 512, 256, 256],
  acacia:    [256, 512, 256, 256],
  thorn:     [512, 512, 256, 256],
  deadbrush: [768, 512, 256, 256],
  tussock:   [0, 768, 256, 256],
  reed:      [256, 768, 256, 256],
  crop:      [512, 768, 256, 256],
  contact:   [768, 768, 256, 256],
};
const PAD = 3;

const ALPHA_CUT = 0.34;

/** Wind strength per weather preset. `sky.weather` is the authority on
 *  conditions; foliage only decides how hard that blows. */
const WEATHER_WIND = {
  clear: 0.34, hazy: 0.48, overcast: 0.72, dust: 1.05, storm: 1.55,
};

export async function createFoliage(ctx) {
  const { THREE, render, terrain, settings } = ctx;
  const q = settings.q;
  const rng = makeRng(ctx.seed ^ 0x0f01a9e);
  const noise = makeNoise2D(ctx.seed ^ 0x77);

  const group = new THREE.Group();
  group.name = "foliage";
  render.scene.add(group);

  /* ============================ wind ============================ */

  const wind = {
    direction: new THREE.Vector2(0.82, 0.57).normalize(),
    /** 0 (dead calm) .. ~1.6 (sandstorm). audio.js reads this. */
    strength: WEATHER_WIND.clear,
    target: WEATHER_WIND.clear,
    phase: 0,
    gust: 0,
  };

  // Shared by every foliage material, so update() writes each value once
  // however many species are on screen.
  const windUniforms = {
    uWindDir: { value: wind.direction },
    uWindTime: { value: 0 },
    uGustTime: { value: 0 },
    uWindStrength: { value: wind.strength },
    uTranslucency: { value: 0.46 },
    /** How hard a down-facing leaf is held back off the sky probe.
     *  This is what gives a canopy an interior. */
    uSkyOcclude: { value: 0.30 },
    /**
     * What a leaf sees when it is NOT looking at the sky.
     *
     * The previous version treated a downward normal as pure loss -
     * indirect fell to (1 - uSkyOcclude) with nothing replacing it -
     * and a probe over four species found 10-29% of every crown's
     * pixels crushed below 0.02 linear, worst at 18m and improving
     * with distance. That is the reviewer's "black scribbles", and it
     * is not fog and not the alpha cut: three applies fog after the
     * alpha test, so the mechanism it named cannot happen, and the
     * effect gets BETTER with range rather than worse.
     *
     * The physical answer is that a leaf turning away from the sky in
     * a desert turns toward a floor of sunlit sand, which is the
     * second brightest surface in the scene. So a down-facing leaf
     * keeps most of its level and changes COLOUR, warm and slightly
     * dimmer, instead of going out.
     */
    uBounce: { value: new THREE.Color(0.94, 0.82, 0.62) },
    /**
     * How much of the per-vertex canopy AO reaches the indirect term.
     * At 1.0 it multiplied the orientation term, and two occlusions in
     * series took a crown interior to 15% of an already small ambient.
     */
    uAoDepth: { value: 0.62 },
    /**
     * View-INDEPENDENT transmission through a leaf, as a fraction of
     * the sun landing on the face you cannot see.
     *
     * The module already had a translucency term, so the reviewer's
     * "no transmission" was wrong as stated - but it was entirely
     * view-DEPENDENT: a pow(dot(V,-L), 4.5) halo plus a 0.06 floor,
     * which only fires when the eye is nearly in line with the sun.
     * Splitting one plant's pixels at their own median measured what
     * that costs: the lit half sits at 0.49-0.72 of the sand behind
     * it, which is right, while the shaded half sits at 0.046-0.09.
     * An 8:1 to 12:1 range inside a single bush is what makes a crown
     * read as a black silhouette, and no ambient tuning fixes it
     * because the missing light is the sun coming THROUGH the leaf.
     */
    uLeafWrap: { value: 1.15 },
    /**
     * Sunlit sand, bounced back up into the canopy.
     *
     * A leaf inside a crown is in shadow, but the ground three metres
     * under it is in full sun and a desert floor returns about a third
     * of what lands on it. Nothing in the standard chain delivers
     * that: `scene.environment` is a SKY probe, and the shadow map has
     * already taken the sun away. This is deliberately NOT a constant
     * floor - a previous constant floor of 0.10 acted as a
     * half-strength unshadowed light on every leaf on the map. It is
     * keyed on how far the surface faces DOWN and on the sun's own
     * elevation, so it goes out at dusk.
     *
     * The value is sand albedo times the fraction of a downward
     * hemisphere that is ground, which is where the 0.17 comes from.
     */
    uGroundBounce: { value: new THREE.Color(0.175, 0.150, 0.108) },
    /** clamp01(sun.y). Written by update() from ctx.sky. */
    uSunUp: { value: 1 },
  };

  /* ========================== atlas art ========================== */

  const canvas = document.createElement("canvas");
  canvas.width = ATLAS;
  canvas.height = ATLAS;
  const g2d = canvas.getContext("2d", { willReadFrequently: true });
  g2d.clearRect(0, 0, ATLAS, ATLAS);

  /** Draw inside one cell with the origin at its top-left, clipped so a
   *  stroke that overruns cannot contaminate the neighbouring species. */
  function cell(name, draw) {
    const [x, y, w, h] = CELL[name];
    g2d.save();
    g2d.beginPath();
    g2d.rect(x, y, w, h);
    g2d.clip();
    g2d.translate(x, y);
    draw(g2d, w, h, makeRng(0x9e37 ^ name.length ^ (x * 31 + y)));
    g2d.restore();
  }

  const rgb = (r, g, b, a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;

  /** A leaflet / blade: a filled lens shape, because a stroked line of
   *  constant width mips into mush while a shape with a fat middle keeps
   *  its coverage. */
  function lance(g, x0, y0, x1, y1, halfWidth, fill, bow = 0.35) {
    const mx = (x0 + x1) * 0.5;
    const my = (y0 + y1) * 0.5;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo(mx + nx * halfWidth * (1 + bow), my + ny * halfWidth * (1 + bow), x1, y1);
    g.quadraticCurveTo(mx - nx * halfWidth, my - ny * halfWidth, x0, y0);
    g.fill();
  }

  /* ---- date palm frond ---- */

  function drawFrond(g, w, h, r, dead) {
    // The live rachis was #3d4a22 - 0.058 linear, darker than the
    // leaflets it carries. On a real date palm it is the opposite way
    // round: the midrib is a pale yellow-green spine that catches the
    // sun, and it is the single brightest line in the frond.
    const rachisDark = dead ? "#5c4d2c" : "#55622e";
    const cx = w * 0.5;
    const leaflets = dead ? 30 : 46;

    // Rachis. Tapered, so the frond does not read as a stick with
    // leaves glued to it.
    g.fillStyle = rachisDark;
    g.beginPath();
    g.moveTo(cx - w * 0.030, h);
    g.lineTo(cx + w * 0.030, h);
    g.lineTo(cx + w * 0.006, 0);
    g.lineTo(cx - w * 0.006, 0);
    g.closePath();
    g.fill();

    for (let i = 0; i < leaflets; i += 1) {
      const t = i / leaflets;
      // The bottom eighth of a date frond is bare petiole with spines,
      // not leaflets. Skipping it is what stops the canopy looking like
      // a feather duster.
      const along = 0.12 + t * 0.88;
      const y = h * (1 - along);
      // Envelope: longest around a third of the way out, tapering to a
      // point. Raised to a power so the tip is a spike, not a paddle.
      const env = Math.pow(Math.sin(Math.pow(along, 0.8) * Math.PI), 0.72);
      for (const side of [-1, 1]) {
        if (r.chance(dead ? 0.16 : 0.05)) continue;   // gaps: nothing is perfect
        const len = w * (dead ? 0.34 : 0.44) * env * r.range(0.82, 1.14);
        // Leaflets sweep forward toward the tip and hang more as they
        // near the end of the frond.
        const rise = lerp(0.86, 0.30, along) * r.range(0.86, 1.12);
        const x1 = cx + side * len;
        const y1 = y - len * rise * (dead ? 0.35 : 1);
        const shade = r.range(-1, 1);
        // A sunlit date frond reflects about 12-15%; 78,88,55 is 8.6%,
        // which is a leaf in shade being asked to also serve as the
        // leaf in sun. The shading has plenty of range to darken it -
        // it had none to lift it.
        // Blue was 0.37 of green in linear, which is a wet tropical
        // leaf. A date frond that has spent a summer in a desert is a
        // grey-green - the same value, far less chroma. This is the
        // same fault the round-6 chroma probe found map-wide (our
        // shade carries 1.74x the reference's saturation), read at the
        // one surface that is nothing BUT shaded pixels. Luma is held
        // where it was; only the chroma moves.
        const fill = dead
          ? rgb(138 + shade * 22, 116 + shade * 18, 74 + shade * 14, 0.98)
          : rgb(95 + shade * 22, 104 + shade * 22, 78 + shade * 16, 0.98);
        lance(g, cx + side * w * 0.012, y, x1, y1, w * r.range(0.016, 0.026), fill, 0.45);
      }
    }

    // A rim of paler leaflets catches the light and stops the frond
    // reading as one flat silhouette.
    for (let i = 0; i < (dead ? 10 : 20); i += 1) {
      const along = r.range(0.2, 0.95);
      const y = h * (1 - along);
      const side = r.sign();
      const env = Math.pow(Math.sin(Math.pow(along, 0.8) * Math.PI), 0.72);
      const len = w * 0.42 * env * r.range(0.9, 1.1);
      lance(g, cx, y, cx + side * len, y - len * lerp(0.86, 0.3, along),
        w * 0.017, dead ? "rgba(178,152,88,0.95)" : "rgba(126,140,72,0.95)", 0.4);
    }
  }

  /* ---- date palm trunk ---- */

  function drawBark(g, w, h, r) {
    /* ---- MEASURED: this cell was the darkest thing in the atlas ----
       Every texel of it is opaque, so unlike a leaf card it has no
       gaps to let sand through, and it is the trunk of every palm and
       every tamarisk on the map. At #5d4e3b it sat at 0.0875 linear
       luma - below the impostor, below every leaf cell, and half of
       the tussock and thorn cells that a reviewer had no complaint
       about. A date palm trunk in desert sun is a pale grey-tan; it is
       lighter than its own canopy, not four times darker.

       This is the same class of fault as the acacia twigs fixed in
       round 2 (0.021 linear, an eighth of leaf value), one cell over. */
    g.fillStyle = "#7a6a52";
    g.fillRect(0, 0, w, h);

    // Mottling first, so the leaf scars sit on top of a varied ground
    // rather than on a flat brown.
    for (let i = 0; i < 900; i += 1) {
      const s = r.range(2, 9);
      g.fillStyle = rgb(122 + r.range(-26, 26), 106 + r.range(-22, 22), 80 + r.range(-18, 18), 0.35);
      g.fillRect(r.range(0, w), r.range(0, h), s, s * r.range(0.4, 1.6));
    }

    // Old leaf bases: a diamond lattice of stubs, offset row to row.
    // This is what makes a date palm trunk recognisable at 20m; a plain
    // cylinder of bark reads as a telegraph pole.
    const rows = 22;
    const cols = 6;
    for (let row = 0; row < rows; row += 1) {
      const t = row / rows;
      const y = h * (1 - t) - h / rows;
      const rh = (h / rows) * 1.08;
      // Scars are crisp near the crown and worn smooth near the base.
      const crisp = clamp01(t * 1.5 - 0.1);
      for (let col = 0; col < cols; col += 1) {
        const x = w * ((col + (row % 2) * 0.5) / cols);
        const cw = (w / cols) * 0.92;
        for (const wrap of [-w, 0, w]) {
          const px = x + wrap;
          g.fillStyle = rgb(146 + r.range(-14, 14), 128 + r.range(-12, 12), 98, 0.55 + crisp * 0.35);
          g.beginPath();
          g.moveTo(px - cw * 0.5, y + rh);
          g.lineTo(px + cw * 0.5, y + rh);
          g.lineTo(px + cw * 0.34, y + rh * 0.18);
          g.lineTo(px - cw * 0.34, y + rh * 0.18);
          g.closePath();
          g.fill();
          // Shadow line under the stub. Contact shadow at texture scale
          // is what gives the trunk relief without a normal map budget.
          // Kept dark relative to the new ground, not in absolute
          // terms: this line is what gives the trunk relief, so it has
          // to move with the base fill or the scars go flat.
          g.fillStyle = rgb(54, 44, 32, 0.42 + crisp * 0.3);
          g.fillRect(px - cw * 0.5, y + rh * 0.96, cw, rh * 0.16);
        }
      }
    }

    // Vertical fibre, faint, running the whole trunk.
    for (let i = 0; i < 120; i += 1) {
      const x = r.range(0, w);
      g.strokeStyle = rgb(96, 82, 64, r.range(0.06, 0.2));
      g.lineWidth = r.range(0.8, 2.4);
      g.beginPath();
      g.moveTo(x, r.range(0, h * 0.4));
      g.lineTo(x + r.range(-5, 5), r.range(h * 0.6, h));
      g.stroke();
    }
  }

  /* ---- shrub masses ---- */

  function drawTamarisk(g, w, h, r) {
    // Tamarisk is a haze of scale-leaves on whippy stems: almost no
    // individual leaf is readable, so draw the mass, not the leaf.
    for (let i = 0; i < 26; i += 1) {
      const x0 = w * 0.5 + r.range(-w * 0.12, w * 0.12);
      const ang = r.range(-2.55, -0.6);
      const len = h * r.range(0.5, 0.95);
      /* 0.071 linear, against a leaf mass at 0.12 and a lifted bark at
         0.15 - the darkest structural element left in the atlas, and
         26 of them are stroked across the whole card. This is the same
         defect as the acacia twigs fixed in round 2 (0.021, an eighth
         of leaf value), one cell over and never caught.
         Deliberately the STEMS and not the leaf mass: the tamarisk's
         sunlit half already measures 0.58 of the sand behind it, which
         is right, so lifting the leaf would blow the lit half to fix
         the shaded one. The stems are dark in both halves and thin
         enough that they barely register in the lit population. */
      g.strokeStyle = rgb(118, 106, 84, 0.85);
      g.lineWidth = r.range(1.6, 3.4);
      g.beginPath();
      g.moveTo(x0, h);
      g.quadraticCurveTo(x0 + Math.cos(ang) * len * 0.4, h + Math.sin(ang) * len * 0.7,
        x0 + Math.cos(ang) * len, h + Math.sin(ang) * len);
      g.stroke();
    }
    for (let i = 0; i < 520; i += 1) {
      const bx = w * 0.5 + r.gauss() * w * 0.24;
      const by = h - Math.abs(r.gauss()) * h * 0.42 - r.range(0, h * 0.35);
      const len = r.range(6, 20);
      const ang = r.range(-2.7, -0.45);
      const shade = r.range(-1, 1);
      lance(g, bx, by, bx + Math.cos(ang) * len, by + Math.sin(ang) * len,
        r.range(1.1, 2.4),
        rgb(104 + shade * 26, 112 + shade * 22, 78 + shade * 20, 0.9), 0.5);
    }
  }

  function drawAcacia(g, w, h, r) {
    /* Twigs first, angular. An acacia canopy is mostly gaps.
     *
     * These used to be rgb(48,40,30) - 0.021 linear, an eighth of the
     * leaf value and darker than anything else in the atlas. Under a
     * shader that then multiplies by a canopy AO term, they arrive
     * under 0.02 display linear, and a crop of one tree at 18m shows
     * exactly what a reviewer called "black scribbles": a tangle of
     * near-black spikes with hard alpha edges. A sunlit acacia branch
     * is PALE - closer to its own trunk than to its leaves - so this
     * now matches the bark, and the crown reads as a thing with
     * structure rather than as a hole cut in the sky. */
    for (let i = 0; i < 30; i += 1) {
      const y0 = h * r.range(0.55, 1.0);
      const x0 = w * r.range(0.1, 0.9);
      g.strokeStyle = rgb(104, 92, 72, 0.9);
      g.lineWidth = r.range(1.4, 3.2);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0 + r.range(-w * 0.3, w * 0.3), y0 - h * r.range(0.15, 0.5));
      g.stroke();
    }
    // Pinnate leaves: clumps of tiny paired leaflets.
    for (let clump = 0; clump < 120; clump += 1) {
      const cx = w * 0.5 + r.gauss() * w * 0.26;
      const cy = h * 0.55 + r.gauss() * h * 0.26;
      const ang = r.range(-Math.PI, Math.PI);
      const n = r.int(5, 9);
      const spacing = r.range(3.0, 5.0);
      const shade = r.range(-1, 1);
      const fill = rgb(74 + shade * 20, 84 + shade * 18, 58 + shade * 14, 0.95);
      for (let i = 0; i < n; i += 1) {
        const px = cx + Math.cos(ang) * i * spacing;
        const py = cy + Math.sin(ang) * i * spacing;
        for (const side of [-1, 1]) {
          const a2 = ang + side * 1.25;
          lance(g, px, py, px + Math.cos(a2) * 4.2, py + Math.sin(a2) * 4.2, 1.5, fill, 0.7);
        }
      }
    }
    // Thorns.
    for (let i = 0; i < 40; i += 1) {
      const x = w * r.range(0.15, 0.85);
      const y = h * r.range(0.4, 0.95);
      g.strokeStyle = "rgba(222,214,190,0.85)";
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + r.range(-5, 5), y - r.range(4, 9));
      g.stroke();
    }
  }

  function drawThorn(g, w, h, r) {
    // Camel thorn: rigid grey-green sticks, sparse leaf, long white
    // spines. Almost a wire sculpture.
    for (let i = 0; i < 46; i += 1) {
      const x0 = w * 0.5 + r.range(-w * 0.1, w * 0.1);
      const ang = r.range(-2.5, -0.64);
      const len = h * r.range(0.42, 0.92);
      const x1 = x0 + Math.cos(ang) * len;
      const y1 = h + Math.sin(ang) * len;
      lance(g, x0, h, x1, y1, r.range(1.6, 3.2), rgb(128, 130, 92, 0.94), 0.15);
      // Side shoots.
      for (let k = 0; k < 3; k += 1) {
        const t = r.range(0.25, 0.9);
        const bx = lerp(x0, x1, t);
        const by = lerp(h, y1, t);
        const a2 = ang + r.range(-0.85, 0.85);
        const l2 = len * r.range(0.15, 0.38);
        lance(g, bx, by, bx + Math.cos(a2) * l2, by + Math.sin(a2) * l2,
          r.range(1.1, 2.0), rgb(140, 138, 98, 0.9), 0.15);
      }
    }
    for (let i = 0; i < 180; i += 1) {
      const x = w * 0.5 + r.gauss() * w * 0.2;
      const y = h - Math.abs(r.gauss()) * h * 0.5;
      const ang = r.range(-Math.PI, Math.PI);
      lance(g, x, y, x + Math.cos(ang) * 5.5, y + Math.sin(ang) * 5.5, 1.9,
        rgb(146 + r.range(-18, 18), 148 + r.range(-16, 16), 96, 0.9), 0.6);
    }
    for (let i = 0; i < 70; i += 1) {
      const x = w * 0.5 + r.gauss() * w * 0.22;
      const y = h - Math.abs(r.gauss()) * h * 0.55;
      g.strokeStyle = "rgba(226,220,196,0.8)";
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + r.range(-7, 7), y - r.range(5, 12));
      g.stroke();
    }
  }

  function drawDeadBrush(g, w, h, r) {
    for (let i = 0; i < 130; i += 1) {
      const x0 = w * 0.5 + r.gauss() * w * 0.16;
      const y0 = h - Math.abs(r.gauss()) * h * 0.25;
      const ang = r.range(-2.9, -0.25);
      const len = h * r.range(0.18, 0.7);
      const x1 = x0 + Math.cos(ang) * len;
      const y1 = y0 + Math.sin(ang) * len;
      const shade = r.range(-1, 1);
      lance(g, x0, y0, x1, y1, r.range(0.9, 2.1),
        rgb(122 + shade * 24, 104 + shade * 20, 76 + shade * 16, 0.92), 0.2);
      for (let k = 0; k < 2; k += 1) {
        const t = r.range(0.3, 0.95);
        const bx = lerp(x0, x1, t);
        const by = lerp(y0, y1, t);
        const a2 = ang + r.range(-1.1, 1.1);
        const l2 = len * r.range(0.2, 0.5);
        lance(g, bx, by, bx + Math.cos(a2) * l2, by + Math.sin(a2) * l2,
          r.range(0.7, 1.5), rgb(136, 116, 84, 0.85), 0.2);
      }
    }
  }

  /* ---- ground cover ---- */

  function drawBlades(g, w, h, r, opts) {
    const { count, colours, minLen, maxLen, spread, headColour } = opts;
    for (let i = 0; i < count; i += 1) {
      const x0 = w * 0.5 + r.range(-w * spread, w * spread);
      const ang = -Math.PI * 0.5 + r.gauss() * 0.42;
      const len = h * r.range(minLen, maxLen);
      // Blades arc over rather than standing straight; the arc is what
      // separates grass from a bar chart.
      const bend = r.range(-0.5, 0.5) + Math.sign(x0 - w * 0.5) * 0.25;
      const x1 = x0 + Math.cos(ang) * len + bend * len * 0.55;
      const y1 = h + Math.sin(ang) * len;
      const c = colours[r.int(0, colours.length - 1)];
      g.fillStyle = c;
      g.beginPath();
      g.moveTo(x0 - r.range(1.4, 3.0), h);
      g.quadraticCurveTo(x0 + bend * len * 0.15, h - len * 0.55, x1, y1);
      g.quadraticCurveTo(x0 + bend * len * 0.15 + 2.6, h - len * 0.5, x0 + r.range(1.4, 3.0), h);
      g.fill();
      // Seed heads, on about one blade in twenty.
      //
      // This used to fire on one blade in five with a fat, saturated
      // ellipse, which put a yellow tuft on every plant across the whole
      // map. Massed, the tufts read as tongues of flame - an art
      // director looking at a depot frame called the ground cover a
      // cartoon fire. Flowering is an accent in a dry landscape, not a
      // carpet, so it is rarer, narrower and much duller.
      if (headColour && r.chance(0.055)) {
        g.fillStyle = headColour;
        g.beginPath();
        g.ellipse(x1, y1 + 3.5, 1.5, 5.4, bend * 0.5, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  /* ---- palm impostor ---- */

  function drawImpostor(g, w, h, r) {
    // The far LOD. Painted rather than baked from the real geometry: at
    // this range the eye wants the SILHOUETTE right and nothing else,
    // and a 256px render of the mesh is a grey smudge.
    const cx = w * 0.5;
    const crownY = h * 0.44;
    /* This cell measured 0.0855 linear luma, the darkest in the atlas
       after bark - and it is what EVERY palm past the shadow distance
       is made of, which is most of the palms in any wide shot. A
       reviewer reading "distant trees are black scribbles" is reading
       this one cell. Matched to the bark and frond values it replaces,
       plus a step lighter again because a tree at 400m has most of a
       kilometre of hazy air in front of it. */
    g.fillStyle = "#7a6a52";
    g.beginPath();
    g.moveTo(cx - w * 0.048, h);
    g.lineTo(cx + w * 0.048, h);
    g.lineTo(cx + w * 0.028, crownY);
    g.lineTo(cx - w * 0.028, crownY);
    g.closePath();
    g.fill();
    for (let i = 0; i < 14; i += 1) {
      const y = lerp(crownY, h, i / 14);
      g.fillStyle = "rgba(56,46,34,0.35)";
      g.fillRect(cx - w * 0.052, y, w * 0.104, 2.2);
    }

    const fronds = 15;
    for (let i = 0; i < fronds; i += 1) {
      const t = i / (fronds - 1);
      // Canvas angles: 0 is +x, -PI/2 is straight up.
      const ang = lerp(-2.95, -0.20, t) + r.range(-0.12, 0.12);
      const len = h * r.range(0.30, 0.42);
      // Droop always bends the frond DOWNWARD, whichever side it is on.
      const droopSign = Math.cos(ang) < 0 ? -1 : 1;
      const droop = 1.15;
      const segs = 8;
      const pts = [];
      let px = cx;
      let py = crownY;
      for (let s = 1; s <= segs; s += 1) {
        const u = s / segs;
        const a = ang + droopSign * droop * u * u;
        px += Math.cos(a) * (len / segs);
        py += Math.sin(a) * (len / segs);
        const halfW = h * 0.030 * Math.sin(Math.pow(u, 0.55) * Math.PI) + 0.5;
        // Perpendicular to the local direction, so a near-vertical frond
        // does not collapse to a hairline.
        pts.push([px, py, -Math.sin(a) * halfW, Math.cos(a) * halfW]);
      }
      const shade = r.range(-1, 1);
      g.fillStyle = rgb(104 + shade * 20, 112 + shade * 20, 84 + shade * 14, 0.97);
      g.beginPath();
      g.moveTo(cx, crownY);
      for (const [x, y, ox, oy] of pts) g.lineTo(x + ox, y + oy);
      for (let s = pts.length - 1; s >= 0; s -= 1) {
        g.lineTo(pts[s][0] - pts[s][2], pts[s][1] - pts[s][3]);
      }
      g.closePath();
      g.fill();
    }
  }

  /* ---- contact shadow ---- */

  function drawContact(g, w, h) {
    // Multiply-blended, so WHITE is "no darkening". The alpha channel is
    // ignored by multiply blending - a transparent border would multiply
    // by black and stamp a square hole in the ground.
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, w, h);
    // Values are sRGB and the atlas is decoded to linear before the
    // multiply, so 150 is about 0.30 linear - a believable contact
    // shadow. A "dark grey" of 50 would be 0.03 linear and stamp a black
    // disc on the sand.
    const grad = g.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, w * 0.5);
    grad.addColorStop(0.0, "rgba(150,146,138,1)");
    grad.addColorStop(0.40, "rgba(196,192,184,1)");
    grad.addColorStop(0.75, "rgba(236,234,230,1)");
    grad.addColorStop(1.0, "rgba(255,255,255,1)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }

  cell("frond", (g, w, h, r) => drawFrond(g, w, h, r, false));
  cell("frondDead", (g, w, h, r) => drawFrond(g, w, h, r, true));
  cell("bark", drawBark);
  cell("impostor", drawImpostor);
  cell("tamarisk", drawTamarisk);
  cell("acacia", drawAcacia);
  cell("thorn", drawThorn);
  cell("deadbrush", drawDeadBrush);
  cell("tussock", (g, w, h, r) => drawBlades(g, w, h, r, {
    count: 150, minLen: 0.35, maxLen: 0.95, spread: 0.10,
    colours: ["#a3936a", "#8e805a", "#b3a67e", "#7e7150", "#75735a"],
    headColour: "rgba(166,154,124,0.75)",
  }));
  cell("reed", (g, w, h, r) => drawBlades(g, w, h, r, {
    count: 84, minLen: 0.55, maxLen: 1.0, spread: 0.07,
    colours: ["#74805a", "#828b64", "#68724f", "#8d8b64"],
    headColour: "rgba(134,116,86,0.85)",
  }));
  cell("crop", (g, w, h, r) => drawBlades(g, w, h, r, {
    count: 96, minLen: 0.5, maxLen: 0.92, spread: 0.13,
    colours: ["#57633d", "#616c4a", "#4a5537", "#68704e"],
    headColour: "rgba(146,138,104,0.8)",
  }));
  cell("contact", drawContact);

  /* ==================== texture: mips by hand ==================== */

  /** Canvas pixels to a bottom-up RGBA buffer. Rows are flipped here
   *  rather than relying on UNPACK_FLIP_Y, which is not applied to
   *  ArrayBufferView uploads on every driver. */
  function readFlipped() {
    const src = g2d.getImageData(0, 0, ATLAS, ATLAS).data;
    const out = new Uint8Array(ATLAS * ATLAS * 4);
    const stride = ATLAS * 4;
    for (let y = 0; y < ATLAS; y += 1) {
      out.set(src.subarray(y * stride, y * stride + stride), (ATLAS - 1 - y) * stride);
    }
    return out;
  }

  /**
   * Push colour outward into transparent texels.
   *
   * Without this the box filter averages a leaf's colour against the
   * (black, alpha 0) background and every leaf edge picks up a dark
   * fringe that gets worse with every mip level. Cheaper than filtering
   * in premultiplied space and un-premultiplying, and it also fixes the
   * bilinear fringe at mip 0.
   */
  function bleed(data, size, passes) {
    for (let pass = 0; pass < passes; pass += 1) {
      const src = data.slice();
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const i = (y * size + x) * 4;
          if (src[i + 3] >= 8) continue;
          let r = 0; let g = 0; let b = 0; let n = 0;
          for (let dy = -1; dy <= 1; dy += 1) {
            const yy = y + dy;
            if (yy < 0 || yy >= size) continue;
            for (let dx = -1; dx <= 1; dx += 1) {
              const xx = x + dx;
              if (xx < 0 || xx >= size) continue;
              const j = (yy * size + xx) * 4;
              if (src[j + 3] < 8) continue;
              r += src[j]; g += src[j + 1]; b += src[j + 2]; n += 1;
            }
          }
          if (n === 0) continue;
          data[i] = r / n;
          data[i + 1] = g / n;
          data[i + 2] = b / n;
          // A whisker of alpha so the fill propagates on the next pass
          // without ever surviving the alpha cut.
          data[i + 3] = 2;
        }
      }
    }
  }

  function coverageOf(data, scale) {
    const cut = ALPHA_CUT * 255;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] * scale >= cut) n += 1;
    return n / (data.length / 4);
  }

  /**
   * The whole point of building mips by hand: rescale each level's alpha
   * until the fraction of texels above the cutoff matches level 0.
   * Straight box filtering drops a frond's coverage from 40% to 12% by
   * mip 3 and the alpha test then erases it - the classic "foliage
   * dissolves at distance" fault.
   */
  function buildMips(base) {
    const mips = [{ data: base, width: ATLAS, height: ATLAS }];
    const target = coverageOf(base, 1);
    let cur = base;
    let size = ATLAS;

    while (size > 8) {
      const next = size >> 1;
      const out = new Uint8Array(next * next * 4);
      for (let y = 0; y < next; y += 1) {
        for (let x = 0; x < next; x += 1) {
          const o = (y * next + x) * 4;
          const a = ((y * 2) * size + x * 2) * 4;
          const b = a + 4;
          const c = a + size * 4;
          const d = c + 4;
          for (let k = 0; k < 4; k += 1) {
            out[o + k] = (cur[a + k] + cur[b + k] + cur[c + k] + cur[d + k] + 2) >> 2;
          }
        }
      }
      // Binary search the alpha gain that restores coverage.
      let lo = 0.25;
      let hi = 6.0;
      for (let i = 0; i < 14; i += 1) {
        const mid = (lo + hi) * 0.5;
        if (coverageOf(out, mid) > target) hi = mid; else lo = mid;
      }
      const gain = (lo + hi) * 0.5;
      if (Math.abs(gain - 1) > 0.02) {
        for (let i = 3; i < out.length; i += 4) out[i] = Math.min(255, out[i] * gain);
      }
      mips.push({ data: out, width: next, height: next });
      cur = out;
      size = next;
    }
    return mips;
  }

  const pixels = readFlipped();
  bleed(pixels, ATLAS, 2);
  const mipChain = buildMips(pixels);

  const atlas = new THREE.DataTexture(
    mipChain[0].data, ATLAS, ATLAS, THREE.RGBAFormat, THREE.UnsignedByteType
  );
  atlas.mipmaps = mipChain;
  atlas.generateMipmaps = false;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.magFilter = THREE.LinearFilter;
  atlas.wrapS = THREE.ClampToEdgeWrapping;
  atlas.wrapT = THREE.ClampToEdgeWrapping;
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = render.anisotropy;
  atlas.flipY = false;
  atlas.name = "foliage-atlas";
  atlas.needsUpdate = true;

  /* ========================= UV helpers ========================= */

  /** Cell-local (0..1, 0..1 with v=0 at the plant's base) to atlas UV. */
  function uvAt(name, u, v) {
    const [x, y, w, h] = CELL[name];
    const u0 = (x + PAD) / ATLAS;
    const u1 = (x + w - PAD) / ATLAS;
    // Rows were flipped on upload, so canvas y maps to 1 - y/ATLAS.
    const v0 = 1 - (y + h - PAD) / ATLAS;
    const v1 = 1 - (y + PAD) / ATLAS;
    return [lerp(u0, u1, u), lerp(v0, v1, v)];
  }

  /* ========================== materials ========================== */

  const materialRegistry = [];

  /**
   * `aFoliage` is (windMask, ambientOcclusion, thickness, billboard).
   * Stiffness lives in the wind mask rather than in a per-material
   * uniform: a trunk vertex carries 0.02 and a frond tip carries 1.0, so
   * one material can drive a rigid palm and a floppy reed at once.
   *
   * `aInst` is (lodFade, dryness) per instance.
   */
  function foliageMaterial(name, fadeStart, fadeEnd) {
    const material = new THREE.MeshStandardMaterial({
      map: atlas,
      alphaTest: ALPHA_CUT,
      transparent: false,
      side: THREE.DoubleSide,
      roughness: 0.92,
      metalness: 0,
      dithering: true,
      shadowSide: THREE.DoubleSide,
    });
    material.name = `bs-foliage-${name}`;
    // Free MSAA-resolved leaf edges IF the HDR target ever gets samples.
    // With samples: 0 in render.js this only softens the cut slightly.
    material.alphaToCoverage = q.ssao && q.taa;

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, windUniforms);
      shader.uniforms.uFade = { value: new THREE.Vector2(fadeStart, fadeEnd) };

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `
          #include <common>
          attribute vec4 aFoliage;
          attribute vec4 aInst;
          // (metres up the stem, 0..1 up the stem). Unbound on a
          // geometry that does not opt in, which reads as 0 - no
          // stretch, no bend - so this is safe to leave off a bush.
          attribute vec2 aShape;
          uniform vec2  uWindDir;
          uniform float uWindTime;
          uniform float uGustTime;
          uniform float uWindStrength;
          uniform vec2  uFade;
          varying vec3 vFoliage;
          /** (lodFade, dryness, per-instance hash 0..1). */
          varying vec3 vInst;
          varying vec3 vBsWorldNormal;
          vec3  bsOrigin;
          vec2  bsWindLocal;
          vec2  bsBillboard;
          float bsDist;
          float bsHash;
        `)
        .replace("#include <beginnormal_vertex>", `
          #include <beginnormal_vertex>
          {
            #ifdef USE_INSTANCING
              bsOrigin = (modelMatrix * instanceMatrix[3]).xyz;
              vec3 bsAxX = normalize(instanceMatrix[0].xyz);
              vec3 bsAxZ = normalize(instanceMatrix[2].xyz);
              float bsYaw = atan(instanceMatrix[2].x, instanceMatrix[2].z);
            #else
              bsOrigin = modelMatrix[3].xyz;
              vec3 bsAxX = vec3(1.0, 0.0, 0.0);
              vec3 bsAxZ = vec3(0.0, 0.0, 1.0);
              float bsYaw = 0.0;
            #endif
            // The wind blows in ONE world direction. Instances are yawed
            // at random, so the world vector has to be rotated into the
            // instance frame or every plant leans a different way.
            vec3 bsWd = vec3(uWindDir.x, 0.0, uWindDir.y);
            bsWindLocal = vec2(dot(bsWd, bsAxX), dot(bsWd, bsAxZ));
            bsDist = distance(cameraPosition, bsOrigin);
            // One value per instance, constant over the plant. Used
            // for the dither phase and the impostor mirror. A sin-hash
            // is fine here because it is evaluated per INSTANCE, not
            // per pixel - the thing that went wrong last time was a
            // sin-hash used as a per-pixel threshold.
            bsHash = fract(sin(dot(floor(bsOrigin.xz * 8.0), vec2(12.9898, 78.233))) * 43758.5453);

            vec3 bsToCam = cameraPosition - bsOrigin;
            float bsA = aFoliage.w > 0.5 ? (atan(bsToCam.x, bsToCam.z) - bsYaw) : 0.0;
            bsBillboard = vec2(cos(bsA), sin(bsA));
            objectNormal.xz = vec2(
              objectNormal.x * bsBillboard.x + objectNormal.z * bsBillboard.y,
              -objectNormal.x * bsBillboard.y + objectNormal.z * bsBillboard.x);
            // The instance rotation is normally applied later, in
            // defaultnormal_vertex; the sky-occlusion term needs the
            // world normal here, so it is applied by hand.
            #ifdef USE_INSTANCING
              vBsWorldNormal = normalize(mat3(modelMatrix) * (mat3(instanceMatrix) * objectNormal));
            #else
              vBsWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
            #endif
          }
        `)
        .replace("#include <begin_vertex>", `
          #include <begin_vertex>
          {
            // Per-instance silhouette, BEFORE the billboard rotation so
            // the bend leans in the instance's own frame and a stand of
            // palms leans every which way rather than as one comb.
            transformed.y += aShape.x * aInst.z;
            transformed.x += aShape.y * aShape.y * aInst.w;

            // Every distant palm samples the SAME impostor cell, so a
            // grove at range was one painted card repeated a hundred
            // times - varying only in height, which is exactly the
            // "same silhouette, varying only in scale" a reviewer
            // flagged. Real geometry is already broken up by a random
            // per-instance yaw (measured sd 1.75-1.83 rad against an
            // ideal of 1.814), but a camera-facing card cannot use
            // yaw. Mirroring half of them in the instance's own x
            // costs one instruction and doubles the silhouette count.
            // The card is symmetric about local x = 0 and its normal
            // has no x component at yaw 0, so nothing else moves.
            if (aFoliage.w > 0.5 && bsHash < 0.5) transformed.x = -transformed.x;

            transformed.xz = vec2(
              transformed.x * bsBillboard.x + transformed.z * bsBillboard.y,
              -transformed.x * bsBillboard.y + transformed.z * bsBillboard.x);

            // Distance fade shrinks the plant into its own base instead
            // of popping out. The base is at local y = 0 for every
            // species, which is why this is a plain multiply.
            transformed *= 1.0 - smoothstep(uFade.x, uFade.y, bsDist);

            float bsPhase = dot(bsOrigin.xz, uWindDir);
            float bsT = uWindTime - bsPhase * 0.028;
            // A gust is a travelling front, not a global multiplier:
            // sharpened so the map is mostly calm with a wave crossing
            // it. Everything swaying in unison is the giveaway.
            float bsGust = sin(bsPhase * 0.0075 - uGustTime) * 0.5 + 0.5;
            bsGust = bsGust * bsGust * bsGust;
            float bsAmp = uWindStrength * (0.26 + 1.45 * bsGust);

            float bsMask = aFoliage.x;
            float bsSway = sin(bsT * 1.55) * 0.62 + sin(bsT * 3.7 + 1.3) * 0.21;
            float bsFlutter = sin(bsT * 8.2 + bsOrigin.x * 0.55) * 0.17 * bsMask;
            float bsBend = (bsSway + bsFlutter) * bsMask * bsAmp;

            transformed.x += bsWindLocal.x * bsBend;
            transformed.z += bsWindLocal.y * bsBend;
            // Foreshorten, so the tip traces an arc rather than
            // stretching away from the stem.
            transformed.y -= abs(bsBend) * 0.24;

            vFoliage = aFoliage.xyz;
            vInst = vec3(aInst.xy, bsHash);
          }
        `);

      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `
          #include <common>
          uniform float uTranslucency;
          uniform float uSkyOcclude;
          uniform vec3  uBounce;
          uniform float uAoDepth;
          uniform float uLeafWrap;
          uniform vec3  uGroundBounce;
          uniform float uSunUp;
          varying vec3 vFoliage;
          varying vec3 vInst;
          varying vec3 vBsWorldNormal;
          /** The sun AFTER its shadow lookup. See below. */
          vec3 bsSunLit = vec3(0.0);
        `)
        .replace("#include <lights_fragment_begin>", `
          #include <lights_fragment_begin>
          #if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
            // directLight survives the include, and the directional
            // block is the LAST one that writes it (point, then spot,
            // then directional), so this is the sun with its shadow
            // already multiplied in.
            //
            // This matters: the translucency term below used the raw
            // uniform, so a bush standing in a shadow band still glowed
            // at full strength - lit identically in shade and in sun,
            // which is precisely the fault this module was sent back
            // for. Anchoring on the #include is also the only option:
            // onBeforeCompile runs before three resolves its chunks, so
            // there is no text inside the chunk to match on.
            bsSunLit = directLight.color;
          #endif
        `)
        .replace("#include <map_fragment>", `
          #include <map_fragment>
          {
            // Per-instance dryness. A stand of identical plants is the
            // second giveaway after uniform spacing, and a hue shift is
            // far cheaper than a second texture.
            // Straw, not acid.
            //
            // The dry end used to be (1.22, 1.06, 0.66) - a boost ABOVE
            // one that pushed the green channel up and the blue channel
            // down at the same time, which is the recipe for lime. On a
            // carpet of ground cover it turned a field into highlighter
            // pen. Real dry vegetation is desaturated first and warm
            // second: its reflectance goes UP in red as the chlorophyll
            // goes, it does not gain green.
            vec3 bsTint = mix(vec3(0.90, 0.93, 0.86), vec3(1.10, 1.00, 0.80), vInst.y);
            // AO used to be folded in here, which darkened the DIRECT
            // light by it too - so a sunlit frond tip was held back by
            // the occlusion of the crown it grew out of. It is applied
            // to the indirect term instead, below.
            diffuseColor.rgb *= bsTint;
          }
        `)
        .replace("#include <alphatest_fragment>", `
          #include <alphatest_fragment>
          if (vInst.x < 0.996) {
            /* ---- stochastic threshold for the LOD cross-fade ----
               Two wrong answers already live in this history, and both
               were measured:

               A white-noise sin-hash discarded a random half of the
               pixels inside a crown, which at range read as a black
               scribble. The post chain is SMAA - MORPHOLOGICAL edge AA
               with no temporal accumulation - so nothing downstream can
               resolve a per-pixel random discard.

               An 8x8 Bayer matrix fixed the randomness and introduced a
               worse thing: every fading instance on screen shares the
               same lattice, aligned to gl_FragCoord, so the pattern is
               coherent across the whole frame and the eye locks onto
               it. Measured by forcing every drawn instance to 50%
               coverage and taking the mean high-pass response per
               (x mod 8, y mod 8) phase class: the spread across those
               64 classes went from 0.072 to 2.97 on the establishing
               pose. That is a frame-wide regular grid, and it is what a
               reviewer called a stippled dot lattice.

               Interleaved gradient noise instead, offset by a
               per-instance hash. Two properties matter and neither is
               "it looks random":

               - its period is irrational, so there is no lattice at 4,
                 8 or any other pixel spacing for the eye to find, and
                 its energy sits at the one-pixel scale, below the
                 length SMAA searches for an edge pattern;
               - the per-instance offset means two neighbouring plants
                 at the same coverage do not share a phase, so the
                 pattern cannot become frame-coherent even when a whole
                 grove fades at once.

               It is still a stipple, and a stipple is still visible if
               enough of the screen is at partial coverage - which is
               why the bands below were narrowed and the LOD levels were
               made decimations of each other rather than different
               plants. This is the second line of defence, not the
               first. */
            float bsIgn = fract(52.9829189
              * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            if (vInst.x < fract(bsIgn + vInst.z)) discard;
          }
        `)
        .replace("#include <lights_fragment_end>", `
          #include <lights_fragment_end>
          // World normal of the face actually being shaded. Shared by
          // the canopy-interior block and the ground bounce below, so
          // it lives outside both.
          vec3 bsWN = normalize(vBsWorldNormal);
          if (!gl_FrontFacing) bsWN = -bsWN;
          {
            // ---- canopy interior ----
            // Ambient here is a sky probe, so it arrives from above. A
            // leaf whose face points at the ground cannot receive it in
            // full, and a canopy whose underside is as bright as its
            // top has no interior at all - that is what makes a bush
            // read as cotton wool. The vertex AO handles occlusion
            // WITHIN the plant; this handles which way the surface is
            // pointing. Both are needed: either alone still reads flat.
            float bsUp = clamp(bsWN.y * 0.5 + 0.5, 0.0, 1.0);
            // Sky above, sunlit sand below. Turning away from one turns
            // toward the other, so the level barely moves and the HUE
            // does - which is what actually reads as a canopy interior.
            // Multiplying the two occlusions in series instead put a
            // quarter of every crown under 0.02 linear.
            vec3 bsOrient = mix(uBounce * (1.0 - uSkyOcclude * 0.35),
                                vec3(1.0 + uSkyOcclude * 0.25), bsUp);
            reflectedLight.indirectDiffuse *= bsOrient * mix(1.0, vFoliage.y, uAoDepth);
            // Direct light is only partly occluded - a sunbeam does get
            // into a canopy, it just does not get all the way in.
            reflectedLight.directDiffuse *= mix(1.0, vFoliage.y, 0.45);
          }
          #if NUM_DIR_LIGHTS > 0
          {
            vec3 bsV = normalize(vViewPosition);
            vec3 bsL = normalize(directionalLights[0].direction);
            // +1 when the sun is on the face we cannot see, -1 when it
            // is on the face we can.
            float bsFacing = dot(-normal, bsL);

            // ---- forward scatter ----
            // The halo when the eye is looking into the sun THROUGH a
            // leaf. The lobe is sharper than it looks reasonable to
            // make it: a broad one lights the whole canopy and destroys
            // the interior the block above just built.
            float bsHalo = pow(clamp(dot(bsV, -bsL), 0.0, 1.0), 4.5)
              * clamp(bsFacing * 0.5 + 0.5, 0.0, 1.0);

            // ---- view-independent transmission ----
            // This is the half that was missing. A leaf lit from behind
            // is bright from EVERY angle; only the halo above depends
            // on where the eye is. The old term had a 0.06 floor times
            // a (0.5 + 0.5) wrap, which never reaches zero, so it had
            // to stay tiny or it would have lit the front-lit half as
            // well - and tiny is why a side-lit crown still read as a
            // silhouette. Squaring a term that IS zero on the front-lit
            // half buys the strength back without that leak.
            float bsThrough = clamp(bsFacing, 0.0, 1.0);
            bsThrough *= bsThrough;

            // Chlorophyll transmits green and red, not blue: a backlit
            // leaf is warmer and more saturated than the same leaf in
            // reflection. Skipping this is why cheap translucency reads
            // as a white blowout rather than as a leaf.
            vec3 bsTrans = diffuseColor.rgb * vec3(1.04, 1.10, 0.68);
            reflectedLight.directDiffuse += bsSunLit * bsTrans
              * (bsThrough * uLeafWrap + bsHalo * 2.15)
              * uTranslucency * vFoliage.z;

            // ---- sunlit sand, bounced ----
            // Deliberately NOT gated on bsSunLit: the leaf may be in
            // the crown's own shadow while the sand around the tree is
            // in full sun, and that is exactly the case this exists
            // for. It is gated on the sun's elevation instead, so it
            // goes out at dusk rather than becoming a second light.
            // NOT squared. (-N.y * 0.5 + 0.5) already IS the view
            // factor from a Lambertian surface to a flat ground plane:
            // 1 facing straight down, 0.5 for a vertical leaf, 0 for
            // one facing the sky. Squaring it took the vertical case -
            // which is most of a bush - to a quarter, and a first pass
            // that did square it moved the tamarisk's shaded half by
            // 0.001 while every other species gained 20-30%.
            float bsDown = clamp(-bsWN.y * 0.5 + 0.5, 0.0, 1.0);
            // Less AO than the sky term gets. A leaf's view of the sky
            // is blocked by the crown directly above it; its view of
            // the sunlit sand is mostly sideways and outward, past the
            // edge of the crown, so the same occlusion does not apply.
            reflectedLight.indirectDiffuse += directionalLights[0].color
              * uGroundBounce * bsDown * uSunUp
              * RECIPROCAL_PI * diffuseColor.rgb
              * mix(1.0, vFoliage.y, uAoDepth * 0.45);
          }
          #endif
        `);

      material.userData.shader = shader;
    };
    // Same key for every species: they differ only in uniform values, so
    // they share one compiled program.
    material.customProgramCacheKey = () => "bs-foliage-v4";
    materialRegistry.push(material);
    return material;
  }

  const treeMaterial = foliageMaterial("tree", q.treeDistance * 0.86, q.treeDistance);
  const shrubMaterial = foliageMaterial("shrub", q.propDistance * 0.82, q.propDistance);
  const grassMaterial = foliageMaterial("grass",
    Math.max(12, q.grassDistance * 0.66), Math.max(20, q.grassDistance));

  /** Contact shadows. Multiply-blended and in the transparent pass, so
   *  they land on the ground after it has been drawn. */
  const contactMaterial = new THREE.MeshBasicMaterial({
    map: atlas,
    blending: THREE.MultiplyBlending,
    // Three validates this pairing every draw call and logs an error
    // when it is missing - 217 of them in a three-second capture, which
    // buries every other agent's console output. Multiply blending
    // multiplies by the source RGB, so an un-premultiplied texel with
    // alpha 0 arrives as full-strength black and darkens the ground it
    // was supposed to leave alone.
    premultipliedAlpha: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: false,
    // Double-sided because the patch is tilted to the terrain normal and
    // a single-sided quad flips away on any slope steeper than the
    // camera's grazing angle.
    side: THREE.DoubleSide,
  });
  contactMaterial.name = "bs-foliage-contact";
  contactMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uContactFade = { value: new THREE.Vector2(q.propDistance * 0.4, q.propDistance * 0.75) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `
        #include <common>
        varying float vContactDist;
      `)
      .replace("#include <project_vertex>", `
        #include <project_vertex>
        vContactDist = -mvPosition.z;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `
        #include <common>
        uniform vec2 uContactFade;
        varying float vContactDist;
      `)
      .replace("#include <fog_fragment>", `
        // Fade to white (multiply identity) with distance. Fog is off on
        // this material because a fogged multiply tints the ground
        // instead of darkening it.
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0),
          smoothstep(uContactFade.x, uContactFade.y, vContactDist));
        #include <fog_fragment>
      `);
  };
  contactMaterial.customProgramCacheKey = () => "bs-foliage-contact";
  materialRegistry.push(contactMaterial);

  /* ========================= geometry kit ========================= */

  function makeBuilder() {
    const P = [];
    const N = [];
    const U = [];
    const F = [];
    const S = [];
    const I = [];
    return {
      /**
       * `stretch` and `bend` are the per-instance shape channels.
       *
       * `stretch` is how many metres up the stem this vertex sits, so a
       * per-instance multiplier can make one geometry into a 4m palm
       * and a 9m palm without a second buffer or a second draw call.
       * The crown carries the trunk's full height rather than its own,
       * which is what makes the trunk lengthen and the crown ride up
       * instead of the fronds stretching into noodles.
       *
       * `bend` is 0..1 up the same stem and drives a quadratic sideways
       * lean. A lean baked into the instance matrix rotates the crown
       * too and reads as a tree planted crooked; a bend leaves the
       * crown level and reads as a tree that grew toward the light.
       */
      vertex(px, py, pz, nx, ny, nz, u, v, wind, ao, thick, bill, stretch, bend) {
        P.push(px, py, pz);
        N.push(nx, ny, nz);
        U.push(u, v);
        F.push(wind, ao, thick, bill || 0);
        S.push(stretch || 0, bend || 0);
        return P.length / 3 - 1;
      },
      quad(a, b, c, d) { I.push(a, b, c, a, c, d); },
      tri(a, b, c) { I.push(a, b, c); },
      get triangles() { return I.length / 3; },
      build(name) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
        geometry.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
        geometry.setAttribute("aFoliage", new THREE.Float32BufferAttribute(F, 4));
        geometry.setAttribute("aShape", new THREE.Float32BufferAttribute(S, 2));
        geometry.setIndex(I);
        geometry.computeBoundingSphere();
        // The per-instance stretch and bend push vertices outside the
        // authored bounds. Frustum culling is off on every foliage mesh
        // so this only feeds the shadow pass, but a palm that vanishes
        // from its own shadow at the screen edge is worse than the
        // handful of microseconds the tight sphere saves.
        geometry.boundingSphere.radius *= 1.9;
        geometry.name = name;
        return geometry;
      },
    };
  }

  /**
   * One alpha card. `segs` vertical divisions exist purely so the wind
   * can bend it; a single quad snaps at its base like a signpost.
   *
   * `sphere` blends the card's flat normal toward a normal radiating
   * from the plant's centre. Flat card normals are why cross-quad bushes
   * look like two pieces of cardboard - a spherical normal makes the
   * same geometry shade as a soft mass.
   */
  function addCard(b, cfg) {
    const {
      cell: cellName, w, h, yaw = 0, x = 0, y = 0, z = 0,
      segs = 2, lean = 0, bow = 0, aoBase = 0.42, aoTop = 1.0,
      thick = 1, windBase = 0.0, windTop = 1.0, windPow = 2.0,
      sphere = 0, sphereY = 0.45, bill = 0, uFlip = false,
      stretchTop = 0, bendTop = 0, stretchBase = 0, bendBase = 0,
    } = cfg;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const rows = [];
    for (let i = 0; i <= segs; i += 1) {
      const t = i / segs;
      const ly = h * t;
      const lz = lean * h * t * t;
      const lx = bow * w * t * t;
      const ids = [];
      for (const side of [-1, 1]) {
        const cx = lx + side * w * 0.5 * (1 - t * t * 0.12);
        const px = x + cx * cy + lz * sy;
        const py = y + ly;
        const pz = z - cx * sy + lz * cy;
        let nx = sy;
        let ny = 0;
        let nz = cy;
        if (sphere > 0) {
          const dx = px - x;
          const dy = py - (y + h * sphereY);
          const dz = pz - z;
          const len = Math.hypot(dx, dy, dz) || 1;
          nx = lerp(nx, dx / len, sphere);
          ny = lerp(ny, dy / len, sphere);
          nz = lerp(nz, dz / len, sphere);
          const l2 = Math.hypot(nx, ny, nz) || 1;
          nx /= l2; ny /= l2; nz /= l2;
        }
        const u = (side < 0) === !uFlip ? 0 : 1;
        const [uu, vv] = uvAt(cellName, u, t);
        ids.push(b.vertex(px, py, pz, nx, ny, nz, uu, vv,
          lerp(windBase, windTop, Math.pow(t, windPow)),
          lerp(aoBase, aoTop, smoothstep(t * 2.2)), thick, bill,
          stretchBase + stretchTop * t, bendBase + bendTop * t));
      }
      rows.push(ids);
    }
    for (let i = 0; i < segs; i += 1) {
      b.quad(rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]);
    }
  }

  /**
   * A palm frond: a tapered strip integrated along an arc so it rises
   * from the crown, flattens, then droops. Three intersecting quads
   * cannot do this - the arc is the whole silhouette of a date palm.
   */
  function addFrond(b, cfg) {
    const {
      x, y, z, yaw, pitch, droop, length, width,
      cell: cellName = "frond", segs = 6, thick = 1, ao = 0.92,
      aoBase = 0.42, stretch = 0, bend = 0,
    } = cfg;
    const dirX = Math.sin(yaw);
    const dirZ = Math.cos(yaw);
    const sideX = Math.cos(yaw);
    const sideZ = -Math.sin(yaw);

    let px = x;
    let py = y;
    let pz = z;
    const step = length / segs;
    const rows = [];
    for (let i = 0; i <= segs; i += 1) {
      const t = i / segs;
      const ang = pitch - droop * t * t;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      // Face normal: cross(tangent, side) with side.y = 0, which reduces
      // to this. A horizontal frond then has a normal of (0,1,0), which
      // is the check worth remembering when this looks wrong.
      const nx = -dirX * sa;
      const ny = ca;
      const nz = -dirZ * sa;

      const half = width * 0.5 * Math.pow(Math.sin(Math.pow(clamp01(t), 0.72) * Math.PI), 0.55) + width * 0.04;
      // The crown's own occlusion. A frond is buried in seventeen other
      // fronds at its base and hanging in open sky at its tip; a single
      // AO value for the whole frond is why the crown had no interior
      // and read as one green pompom.
      const frondAo = lerp(aoBase, ao, smoothstep(Math.pow(t, 0.75)));
      // Thinner toward the tip, so the translucency lights the outer
      // leaflets and leaves the packed middle solid.
      const frondThick = thick * (0.35 + 0.85 * Math.pow(t, 0.8));
      const ids = [];
      for (const side of [-1, 1]) {
        const [uu, vv] = uvAt(cellName, side < 0 ? 0 : 1, t);
        ids.push(b.vertex(
          px + sideX * half * side, py, pz + sideZ * half * side,
          nx, ny, nz, uu, vv,
          0.10 + Math.pow(t, 1.5) * 0.90, frondAo, frondThick, 0,
          stretch, bend
        ));
      }
      rows.push(ids);
      px += dirX * step * ca;
      py += step * sa;
      pz += dirZ * step * ca;
    }
    for (let i = 0; i < segs; i += 1) {
      b.quad(rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]);
    }
  }

  /** Lofted tapered trunk, leaning along an arc. */
  function addTrunk(b, cfg) {
    const {
      x = 0, y = 0, z = 0, height, rBase, rTop, sides, rings,
      leanX = 0, leanZ = 0, cellName = "bark", scars = 0,
      windTop = 0.16, aoBase = 0.30, thick = 0.04, vRepeat = 1,
      stretch = 0, bend = 0, stretchBase = 0, bendBase = 0,
    } = cfg;
    const ringIds = [];
    for (let ring = 0; ring <= rings; ring += 1) {
      const t = ring / rings;
      const yy = y + height * t;
      // Date palm trunks bulge slightly where old leaf bases stack.
      const bulge = scars > 0 ? 1 + Math.sin(t * scars) * 0.05 : 1;
      const radius = lerp(rBase, rTop, Math.pow(t, 0.8)) * bulge;
      const cx = x + leanX * t * t;
      const cz = z + leanZ * t * t;
      const ids = [];
      for (let s = 0; s <= sides; s += 1) {
        const a = (s / sides) * Math.PI * 2;
        const nx = Math.sin(a);
        const nz = Math.cos(a);
        const [uu, vv] = uvAt(cellName, s / sides, clamp01(t * vRepeat));
        ids.push(b.vertex(
          cx + nx * radius, yy, cz + nz * radius,
          nx, 0.12, nz, uu, vv,
          Math.pow(t, 2.4) * windTop,
          lerp(aoBase, 1.0, smoothstep(t * 2.6)), thick, 0,
          stretchBase + stretch * t, bendBase + bend * t
        ));
      }
      ringIds.push(ids);
    }
    for (let ring = 0; ring < rings; ring += 1) {
      for (let s = 0; s < sides; s += 1) {
        b.quad(ringIds[ring][s], ringIds[ring][s + 1],
          ringIds[ring + 1][s + 1], ringIds[ring + 1][s]);
      }
    }
  }

  /* ------------------------ species geometry ------------------------ */

  /**
   * `form` picks the silhouette family. Two families plus the
   * per-instance stretch and bend is what breaks the "one model" read:
   * a grove now has tall bare-trunked date palms over squat young ones
   * with their skirts down to the sand, which is what a real irrigated
   * grove looks like. It costs one extra InstancedMesh per LOD level -
   * three draw calls for the whole species.
   */
  function buildPalm(level, form = 0) {
    const b = makeBuilder();
    /* ---- ONE rng per FORM, not per level ----
       Every builder here used to seed on `level`, so LOD 1 was not a
       cheaper version of LOD 0 - it was a different tree, drawn from a
       different random sequence, with a different frond count and
       therefore different frond yaws. Measured at the 62m boundary,
       inside the palm's own screen rect, the swap moved 5.2/255 over
       11% of its pixels (7.3/255 over 16% for the young form), and a
       tamarisk at 70m moved 22.9/255 over 33%. That pop is the entire
       reason the cross-fade dither exists, so it is the thing worth
       attacking. Sharing the seed and DECIMATING - keeping the same
       fronds, half as many - makes a level the same plant thinned out.
       The rng is still drawn for every frond whether or not it is kept,
       so the sequence does not shift between levels. */
    const r = makeRng(0x9a11 + form * 131);
    const young = form === 1;
    const height = young ? 3.1 : 6.6;
    const leanX = young ? 0.14 : 0.55;
    const leanZ = young ? 0.10 : -0.22;
    // The stretch channel is authored in metres at the crown, so a
    // per-instance value of +0.4 makes the trunk 40% of `height`
    // longer. The trunk ramps it with its own t; the crown takes it all.
    const stretch = height;

    if (level === 0) {
      addTrunk(b, {
        height, rBase: young ? 0.36 : 0.32, rTop: young ? 0.28 : 0.19,
        sides: 9, rings: 11,
        leanX, leanZ, scars: young ? 10 : 20, windTop: 0.13,
        stretch, bend: 1,
      });
    } else {
      addTrunk(b, {
        height, rBase: young ? 0.34 : 0.30, rTop: young ? 0.27 : 0.19,
        sides: 5, rings: 3,
        leanX, leanZ, windTop: 0.13,
        stretch, bend: 1,
      });
    }

    const crownX = leanX;
    const crownZ = leanZ;
    const crownY = height - 0.15;
    const fronds = young ? 14 : 17;
    for (let i = 0; i < fronds; i += 1) {
      const t = i / fronds;
      // A date palm's crown is two shells: young fronds pointing up out
      // of the middle, old ones arching almost horizontal at the edge.
      const age = (i % 3) / 2;
      // Droop is capped so the tip ends up pointing down rather than
      // curling back under the crown - past about 1.5 total the frond
      // travels backwards in x and the palm reads as a spider.
      const pitch = lerp(young ? 1.32 : 1.15, young ? 0.16 : -0.10, age) + r.range(-0.14, 0.14);
      const droop = lerp(0.75, young ? 1.15 : 1.35, age) + r.range(-0.10, 0.10);
      const yaw = t * Math.PI * 2 + r.range(-0.18, 0.18);
      const length = lerp(young ? 2.6 : 3.5, young ? 2.0 : 2.5, age) * r.range(0.82, 1.18);
      const width = (young ? 0.66 : 0.72) * r.range(0.9, 1.1);
      // Drawn from the rng above whether or not it survives, so the two
      // levels stay in step. Odd fronds go at range.
      if (level > 0 && i % 2 === 1) continue;
      addFrond(b, {
        x: crownX, y: crownY, z: crownZ,
        yaw, pitch, droop, length, width,
        segs: level === 0 ? 6 : 3,
        // Deep at the base: seventeen frond roots packed into a 40cm
        // collar is the darkest part of the whole tree.
        thick: 1.0, ao: 0.98, aoBase: 0.26,
        stretch, bend: 1,
      });
    }
    // The dead skirt: brown fronds hanging under the crown. Every real
    // date palm that has not been pruned has one, and it is what makes
    // the crown read as a crown instead of a green pompom.
    const dead = young ? 8 : 5;
    for (let i = 0; i < dead; i += 1) {
      const pitch = -0.55 + r.range(-0.2, 0.2);
      const length = (young ? 1.5 : 2.0) * r.range(0.85, 1.15);
      if (level > 0 && i % 2 === 1) continue;
      addFrond(b, {
        x: crownX, y: crownY - 0.25, z: crownZ,
        yaw: (i / dead) * Math.PI * 2 + 0.4,
        pitch, length,
        droop: 1.5,
        width: 0.56,
        cell: "frondDead",
        segs: level === 0 ? 4 : 2,
        thick: 0.55, ao: 0.60, aoBase: 0.22,
        stretch, bend: 1,
      });
    }
    return b;
  }

  function buildPalmImpostor(form = 0) {
    const b = makeBuilder();
    const young = form === 1;
    addCard(b, {
      cell: "impostor", w: young ? 3.8 : 4.6, h: young ? 5.4 : 9.2, segs: 1,
      aoBase: 0.8, aoTop: 1.0, thick: 0.7,
      windBase: 0.0, windTop: 0.10, bill: 1,
      // The impostor has to grow with its instance the same way the
      // real geometry does, or a palm changes height as it crosses the
      // LOD band.
      stretchTop: young ? 3.1 : 6.6, bendTop: 1,
    });
    return b;
  }

  function buildAcacia(level) {
    const b = makeBuilder();
    // Seeded on the species, not the level - see buildPalm.
    const r = makeRng(0x5c31);
    const trunkH = 1.9;
    // Everything above the trunk rides the trunk's own stretch, so a
    // tall instance is a tall tree rather than a stretched one.
    const stretch = trunkH;
    addTrunk(b, {
      height: trunkH, rBase: 0.26, rTop: 0.14,
      sides: level === 0 ? 6 : 4, rings: level === 0 ? 4 : 2,
      leanX: 0.12, leanZ: 0.08, windTop: 0.06, aoBase: 0.28, vRepeat: 0.4,
      stretch, bend: 1,
    });
    // Boughs, splaying out to hold up a flat canopy.
    const boughs = 4;
    for (let i = 0; i < boughs; i += 1) {
      const a = (i / boughs) * Math.PI * 2 + r.range(-0.3, 0.3);
      if (level > 0 && i % 2 === 1) continue;
      addTrunk(b, {
        x: 0.12 + Math.sin(a) * 0.1, y: trunkH - 0.1, z: 0.08 + Math.cos(a) * 0.1,
        height: 1.5, rBase: 0.11, rTop: 0.045,
        sides: 4, rings: 2,
        leanX: Math.sin(a) * 1.25, leanZ: Math.cos(a) * 1.25,
        windTop: 0.14, aoBase: 0.85, vRepeat: 0.25,
        stretchBase: stretch, bendBase: 1,
      });
    }
    // The canopy is a flat umbrella of near-horizontal cards. That
    // silhouette IS the acacia; a round bush of the same leaves reads as
    // a generic tree.
    const cards = 9;
    for (let i = 0; i < cards; i += 1) {
      const a = (i / cards) * Math.PI * 2 + r.range(-0.2, 0.2);
      const dist = r.range(0.5, 1.5);
      const w = 2.5 * r.range(0.8, 1.2);
      const y = trunkH + 0.55 + r.range(-0.2, 0.35);
      const lean = r.range(-0.35, 0.35);
      if (level > 0 && i % 2 === 1) continue;
      addCard(b, {
        cell: "acacia", w, h: 1.5,
        yaw: a + Math.PI * 0.5,
        x: Math.sin(a) * dist, y, z: Math.cos(a) * dist,
        segs: level === 0 ? 2 : 1,
        lean,
        aoBase: 0.44, aoTop: 1.0, thick: 0.95,
        windBase: 0.25, windTop: 0.75,
        sphere: 0.55, sphereY: -0.2,
        stretchBase: stretch, bendBase: 1,
      });
    }
    return b;
  }

  function buildAcaciaFar() {
    const b = makeBuilder();
    for (let i = 0; i < 2; i += 1) {
      addCard(b, {
        cell: "acacia", w: 4.4, h: 2.0, yaw: i * Math.PI * 0.5, y: 2.2,
        segs: 1, aoBase: 0.9, aoTop: 1.0, thick: 0.8, windBase: 0.2, windTop: 0.5,
        stretchBase: 1.9, bendBase: 1,
      });
    }
    addTrunk(b, {
      height: 2.3, rBase: 0.22, rTop: 0.12, sides: 3, rings: 1,
      windTop: 0.05, aoBase: 0.35, vRepeat: 0.4,
      stretch: 1.9, bend: 1,
    });
    return b;
  }

  function buildTamarisk(level) {
    const b = makeBuilder();
    // Seeded on the species, not the level - see buildPalm. This one
    // was the worst offender: 3 cards drawn from a different sequence
    // than the 8 they replaced made the far level a visibly different
    // bush, 22.9/255 over a third of its own pixels at the boundary.
    const r = makeRng(0x77a3);
    const stretch = 0.85;
    addTrunk(b, {
      height: 0.85, rBase: 0.17, rTop: 0.09,
      sides: level === 0 ? 5 : 3, rings: 2,
      leanX: 0.16, windTop: 0.08, aoBase: 0.24, vRepeat: 0.3,
      stretch, bend: 1,
    });
    const cards = 8;
    for (let i = 0; i < cards; i += 1) {
      const a = (i / cards) * Math.PI * 2 + r.range(-0.3, 0.3);
      const dist = r.range(0.15, 0.6);
      const w = 2.0 * r.range(0.8, 1.25);
      const h = 2.1 * r.range(0.75, 1.2);
      const y = 0.55 + r.range(-0.25, 0.35);
      const lean = r.range(-0.25, 0.25);
      const bow = r.range(-0.2, 0.2);
      // 6 of 8, not 4 of 8. Halving the cards halves the density of a
      // bush whose whole read IS its density, and this boundary
      // measured the largest pop of any in the module. Two extra cards
      // at one segment each is 4 triangles on 540 instances.
      if (level > 0 && i % 4 === 3) continue;
      addCard(b, {
        cell: "tamarisk", w, h,
        yaw: a, x: Math.sin(a) * dist, y, z: Math.cos(a) * dist,
        segs: level === 0 ? 3 : 1,
        lean, bow,
        aoBase: 0.30, aoTop: 1.0, thick: 1.0,
        windBase: 0.18, windTop: 1.0,
        sphere: 0.62, sphereY: 0.42,
        stretchBase: stretch, bendBase: 1,
      });
    }
    return b;
  }

  function buildBush(cellName, cfg) {
    const {
      cards = 5, w = 1.4, h = 1.0, spread = 0.22, thick = 0.9,
      windBase = 0.1, windTop = 1.0, sphere = 0.6, segs = 2, seed = 1,
      aoBase = 0.4,
    } = cfg;
    const b = makeBuilder();
    const r = makeRng(seed);
    for (let i = 0; i < cards; i += 1) {
      const a = (i / cards) * Math.PI * 2 + r.range(-0.35, 0.35);
      const dist = r.range(0, spread);
      addCard(b, {
        cell: cellName,
        w: w * r.range(0.78, 1.24), h: h * r.range(0.72, 1.3),
        yaw: a, x: Math.sin(a) * dist, y: r.range(-0.04, 0.06), z: Math.cos(a) * dist,
        segs, lean: r.range(-0.22, 0.22), bow: r.range(-0.18, 0.18),
        aoBase, aoTop: 1.0, thick,
        windBase, windTop, sphere, sphereY: 0.5,
      });
    }
    return b;
  }

  /* ========================== ecology ========================== */

  /** Must match terrain.js's wadi carve, or plants will line the wrong
   *  channel. Duplicated rather than exported because terrain has no
   *  reason to publish its shape internals. */
  const wadiCentre = (x) => Math.sin(x * 0.0026) * 96 + Math.sin(x * 0.00071) * 190;
  const wadiDistance = (x, z) => Math.abs(z - wadiCentre(x));

  /** Settlements, derived from the exclusion discs world.js hands over:
   *  anything with a big pad is a place people live. */
  let settlements = [];
  let exclusionList = [];

  function clearOfBuildings(x, z, margin = 0) {
    for (const e of exclusionList) {
      if (Math.hypot(x - e.x, z - e.z) < e.radius + margin) return false;
    }
    return true;
  }

  const qMin = new THREE.Vector3();
  const qMax = new THREE.Vector3();
  /** Nothing grows through a container, a sandbag wall or one of the 90
   *  scattered cover pieces, none of which are in the exclusion list. */
  function clearOfColliders(x, z, y, radius) {
    const physics = ctx.physics;
    if (!physics) return true;
    qMin.set(x - radius, y - 1.5, z - radius);
    qMax.set(x + radius, y + 4.0, z + radius);
    return physics.queryBox(qMin, qMax, physics.LAYER.STATIC).length === 0;
  }

  /** Irrigation: a ring of worked ground around each settlement. */
  function irrigationAt(x, z) {
    let best = 0;
    for (const s of settlements) {
      const d = Math.hypot(x - s.x, z - s.z);
      const t = (d - s.radius * 0.9) / (s.radius * 1.6);
      if (t < 0 || t > 1) continue;
      best = Math.max(best, 1 - smoothstep(t));
    }
    return best;
  }

  /**
   * 0 (bare dune / rock) .. 1 (wadi bottom). Every species is gated on
   * this, which is what makes the vegetation explain the landscape
   * instead of decorating it.
   */
  function moistureAt(x, z, y, slope) {
    const wadi = 1 - smoothstep(clamp01(wadiDistance(x, z) / 105));
    const low = 1 - clamp01((y - terrain.minHeight) / 52);
    const patch = noise.fbm(x * 0.0034, z * 0.0034, 4) * 0.5 + 0.5;
    let m = wadi * 0.55 + low * 0.16 + patch * 0.29;
    m = Math.max(m, irrigationAt(x, z) * 0.92);
    // Steep ground sheds water and is where the rock shows through.
    m *= 1 - smoothstep(clamp01((slope - 0.15) / 0.26));
    return clamp01(m);
  }

  /* ========================== placement ========================== */

  const layers = [];
  const contacts = [];
  const lodSets = [];

  const tmpQuat = new THREE.Quaternion();
  const tmpQuat2 = new THREE.Quaternion();
  const tmpVec = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const tmpNormal = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  let lodTimer = 0;
  const lastLodCamera = new THREE.Vector3(1e6, 1e6, 1e6);

  /**
   * Rejection-sample cluster seeds, then grow each cluster around its
   * seed. Uniform rejection sampling gives an even sprinkle that reads
   * as wallpaper; real stands of desert plant are patchy because the
   * water is patchy and because they seed from each other.
   */
  function samplePlacements(spec) {
    const {
      count, perCluster = 1, spread = 6, accept,
      scale = [1, 1], tilt = 0.35, radius = 0.6, contact = 0,
      lean = 0, stretch = 0, bend = 0,
    } = spec;
    const out = [];
    if (count <= 0) return out;

    const half = terrain.MAP_SIZE * 0.46;
    const clusters = Math.max(1, Math.round(count / perCluster));
    let attempts = 0;
    const maxAttempts = clusters * 60;

    while (out.length < count && attempts < maxAttempts) {
      attempts += 1;
      const cx = rng.range(-half, half);
      const cz = rng.range(-half, half);
      if (!terrain.inBounds(cx, cz)) continue;
      if (!accept(cx, cz)) continue;

      // Cluster size varies by nearly 4x. A fixed count per seed still
      // reads as a regular texture from the air, because every clump is
      // the same clump; real stands run from a single survivor to a
      // thicket, and it is that RANGE that stops the eye finding the
      // rule.
      const n = Math.max(1, Math.round(perCluster * rng.range(0.22, 2.1)));
      // A cluster's own spread varies too, so some stands are tight and
      // some are a scatter.
      const clusterSpread = spread * rng.range(0.5, 1.7);
      for (let i = 0; i < n && out.length < count; i += 1) {
        // Gaussian offsets give a dense middle and a ragged edge, which
        // is what a clump of scrub actually looks like from the air.
        const px = cx + rng.gauss() * clusterSpread;
        const pz = cz + rng.gauss() * clusterSpread;
        if (!terrain.inBounds(px, pz)) continue;
        if (!accept(px, pz)) continue;
        const y = terrain.heightAt(px, pz);
        if (!clearOfColliders(px, pz, y, radius)) continue;

        // Skewed toward the small end: a stand is mostly juveniles with
        // a few mature plants over them, never a uniform draw. A flat
        // range is why procedural vegetation reads as one plant scaled.
        const t = Math.pow(rng(), 1.7);
        const s = lerp(scale[0], scale[1], t);
        out.push({
          x: px, y, z: pz,
          yaw: rng.range(0, Math.PI * 2),
          scale: s,
          yScale: s * rng.range(0.86, 1.18),
          dry: clamp01(rng() * 0.72 + (1 - moistureAt(px, pz, y, terrain.slopeAt(px, pz))) * 0.5),
          tilt, lean,
          // Shape channels, read by the vertex shader through aInst.
          // Correlated with age: a tall palm is also the one that has
          // had time to bend.
          stretch: stretch ? stretch * (t - 0.35) * 1.55 : 0,
          bend: bend ? bend * (rng() - 0.5) * 2 * (0.4 + t) : 0,
          contact: contact * s,
        });
      }
    }
    return out;
  }

  function composeMatrix(matrix, p) {
    terrain.normalAt(p.x, p.z, tmpNormal);
    // Plants grow toward the light, not square out of a slope, so only
    // part of the terrain tilt is applied.
    tmpVec.copy(tmpNormal).lerp(UP, 1 - p.tilt).normalize();
    tmpQuat.setFromUnitVectors(UP, tmpVec);
    tmpQuat2.setFromAxisAngle(UP, p.yaw);
    tmpQuat.multiply(tmpQuat2);
    if (p.lean) {
      tmpVec.set(Math.cos(p.yaw * 1.7), 0, Math.sin(p.yaw * 1.7)).normalize();
      tmpQuat2.setFromAxisAngle(tmpVec, p.lean * (p.dry - 0.5) * 2);
      tmpQuat.multiply(tmpQuat2);
    }
    tmpScale.set(p.scale, p.yScale, p.scale);
    tmpPos.set(p.x, p.y - 0.06, p.z);
    matrix.compose(tmpPos, tmpQuat, tmpScale);
  }

  /** (lodFade, dryness, stemStretch, stemBend) per instance. */
  function attachInstanceAttribute(geometry, capacity) {
    const data = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i += 1) data[i * 4] = 1;
    const attribute = new THREE.InstancedBufferAttribute(data, 4);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aInst", attribute);
    return attribute;
  }

  /** A species with no LOD: one mesh, matrices written once. */
  function buildStatic(name, geometry, material, placements, opts = {}) {
    if (placements.length === 0) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
    mesh.name = `foliage-${name}`;
    mesh.castShadow = Boolean(opts.castShadow) && q.shadows;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    const attribute = attachInstanceAttribute(geometry, placements.length);
    const matrix = new THREE.Matrix4();
    placements.forEach((p, i) => {
      composeMatrix(matrix, p);
      mesh.setMatrixAt(i, matrix);
      attribute.setXYZW(i, 1, p.dry, p.stretch || 0, p.bend || 0);
      if (p.contact > 0) contacts.push(p);
    });
    mesh.instanceMatrix.needsUpdate = true;
    attribute.needsUpdate = true;
    group.add(mesh);
    layers.push({
      name, mesh, instances: placements.length,
      triangles: (geometry.index.count / 3) * placements.length,
    });
    return mesh;
  }

  /**
   * A species with LOD. One InstancedMesh per level, all sharing the
   * plant list; every refresh re-buckets by camera distance and writes a
   * fade weight so the swap is a dither cross-fade rather than a pop.
   *
   * The rebuild is O(plants) with no allocation and runs a few times a
   * second, which for a few hundred trees is free. Per-instance LOD
   * cannot be done any other way with InstancedMesh.
   */
  function buildLod(name, levels, material, placements, opts = {}) {
    if (placements.length === 0) return null;
    const capacity = placements.length;
    const meshes = levels.map((level, index) => {
      const mesh = new THREE.InstancedMesh(level.geometry, material, capacity);
      mesh.name = `foliage-${name}-l${index}`;
      // Every level below the impostor casts. Restricting it to level 0
      // meant a palm stopped throwing a shadow at 62m while its own
      // shadow cascade reaches four times that, so a grove read as
      // pasted onto the sand from the middle distance outward. The
      // impostor is a camera-facing card and would cast a shadow that
      // swings as the player walks, so that one stays off.
      mesh.castShadow = Boolean(opts.castShadow) && q.shadows
        && index < (opts.shadowLevels ?? levels.length - 1);
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.count = 0;
      mesh.userData.attribute = attachInstanceAttribute(level.geometry, capacity);
      group.add(mesh);
      return mesh;
    });

    const matrices = placements.map((p) => {
      const matrix = new THREE.Matrix4();
      composeMatrix(matrix, p);
      if (p.contact > 0) contacts.push(p);
      return matrix;
    });

    const set = {
      name, meshes, levels, placements, matrices,
      cullDistance: opts.cullDistance ?? levels[levels.length - 1].maxDistance,
      band: opts.band ?? 14,
      counts: levels.map(() => 0),
    };
    lodSets.push(set);
    layers.push({
      name, mesh: meshes[0], instances: capacity, lod: levels.length,
      triangles: (levels[0].geometry.index.count / 3) * capacity,
    });
    refreshLod(set, render.camera.position);
    return set;
  }

  function refreshLod(set, cameraPosition) {
    const { meshes, levels, placements, matrices, band } = set;
    for (let i = 0; i < meshes.length; i += 1) set.counts[i] = 0;

    for (let i = 0; i < placements.length; i += 1) {
      const p = placements[i];
      const d = Math.hypot(cameraPosition.x - p.x, cameraPosition.y - p.y, cameraPosition.z - p.z);
      if (d > set.cullDistance) continue;

      for (let l = 0; l < levels.length; l += 1) {
        // The band belongs to the BOUNDARY, not to the species: level
        // l's fade-out at its far edge is the same event as level
        // l+1's fade-in, so both read `levels[l].band`. A boundary
        // whose two levels are near-identical wants 0 - a hard swap
        // costs nothing there and every stippled pixel is a cost.
        const nearBand = l === 0 ? 0 : (levels[l - 1].band ?? band);
        const farBand = levels[l].band ?? band;
        const near = l === 0 ? -1e9 : levels[l - 1].maxDistance;
        const far = levels[l].maxDistance;
        if (d <= near - nearBand || d > far) continue;
        // Weight 1 in the body of the band, ramping in and out over
        // the boundary's band so two levels overlap through the swap.
        let fade = 1;
        if (farBand > 0 && d > far - farBand) fade = Math.min(fade, (far - d) / farBand);
        if (nearBand > 0 && d < near) fade = Math.min(fade, 1 - (near - d) / nearBand);
        if (fade <= 0.004) continue;
        const mesh = meshes[l];
        const index = set.counts[l];
        if (index >= placements.length) continue;
        mesh.setMatrixAt(index, matrices[i]);
        mesh.userData.attribute.setXYZW(index, fade, p.dry, p.stretch || 0, p.bend || 0);
        set.counts[l] = index + 1;
      }
    }

    for (let i = 0; i < meshes.length; i += 1) {
      const mesh = meshes[i];
      mesh.count = set.counts[i];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.attribute.needsUpdate = true;
    }
  }

  /* ------------------------- contact shadows ------------------------- */

  function buildContacts() {
    if (contacts.length === 0) return;
    const b = makeBuilder();
    const [u0, v0] = uvAt("contact", 0, 0);
    const [u1, v1] = uvAt("contact", 1, 1);
    const a = b.vertex(-0.5, 0, -0.5, 0, 1, 0, u0, v0, 0, 1, 0, 0);
    const c = b.vertex(0.5, 0, -0.5, 0, 1, 0, u1, v0, 0, 1, 0, 0);
    const d = b.vertex(0.5, 0, 0.5, 0, 1, 0, u1, v1, 0, 1, 0, 0);
    const e = b.vertex(-0.5, 0, 0.5, 0, 1, 0, u0, v1, 0, 1, 0, 0);
    b.quad(a, c, d, e);
    const geometry = b.build("foliage-contact");

    const mesh = new THREE.InstancedMesh(geometry, contactMaterial, contacts.length);
    mesh.name = "foliage-contact";
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    // Not a shadow caster or receiver, and the QA clearance probe should
    // not report a shadow patch as geometry pressed against the lens.
    mesh.userData.qaOpaque = false;

    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    contacts.forEach((p, i) => {
      terrain.normalAt(p.x, p.z, tmpNormal);
      quat.setFromUnitVectors(UP, tmpNormal);
      tmpQuat2.setFromAxisAngle(UP, p.yaw);
      quat.multiply(tmpQuat2);
      scale.set(p.contact, 1, p.contact);
      position.set(p.x, p.y + 0.055, p.z);
      matrix.compose(position, quat, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    layers.push({ name: "contact", mesh, instances: contacts.length, triangles: 2 * contacts.length });
  }

  /* ============================ populate ============================ */

  const geometryCache = [];
  function geom(builder, name) {
    const geometry = builder.build(name);
    geometryCache.push(geometry);
    return geometry;
  }

  const api = {
    group,
    wind,
    layers,

    /**
     * Called by world.js once the map layout and its flattened pads are
     * final, so nothing is planted inside a building.
     */
    populate(exclusions = []) {
      exclusionList = exclusions;
      // A pad wider than 30m is a settlement; the small ones are cover
      // and props. People live where there is water, so these are also
      // the irrigation sources.
      settlements = exclusions.filter((e) => e.radius >= 30);

      const density = clamp01(q.grassDensity);
      const cover = 0.25 + density * 0.75;

      /* ---- date palms: the wadi and the villages ---- */

      const palmAccept = (x, z) => {
        const slope = terrain.slopeAt(x, z);
        if (slope > 0.20) return false;
        const y = terrain.heightAt(x, z);
        if (!clearOfBuildings(x, z, -6)) return false;
        const m = moistureAt(x, z, y, slope);
        if (m < 0.50) return false;
        return wadiDistance(x, z) < 80 || irrigationAt(x, z) > 0.25;
      };
      // Date palms are planted, not seeded: a grove is a tight stand
      // around the water with hard edges, not a drift. Small clusters
      // with a small spread is what gives it that.
      const palmPlacements = samplePlacements({
        count: 260, perCluster: 6, spread: 7, accept: palmAccept,
        // 2.6:1 in uniform scale, on top of which the stretch channel
        // adds another 1.9:1 of trunk. A stand now runs from a 3m
        // juvenile to a 12m mature palm, which is the real range.
        scale: [0.62, 1.62], tilt: 0.25, radius: 1.0, contact: 3.6, lean: 0.05,
        stretch: 0.55, bend: 0.85,
      });
      // Split the same list into two silhouette families rather than
      // sampling twice, so the ecology gating stays in one place.
      const palms = palmPlacements.filter((p, i) => (i * 7 + Math.round(p.x)) % 5 !== 0);
      const palmsYoung = palmPlacements.filter((p, i) => (i * 7 + Math.round(p.x)) % 5 === 0);
      buildLod("palm", [
        // band 0: the mid level is now the SAME palm with every other
        // frond removed, so there is nothing for a cross-fade to hide.
        // Every metre of band is screen area sitting at partial
        // coverage, and partial coverage is the only thing that can
        // stipple.
        { geometry: geom(buildPalm(0, 0), "palm-hi"), maxDistance: 62, band: 0 },
        // Real geometry has to reach as far as shadows do.
        //
        // The impostor is a camera-facing billboard (`bill: 1`), so it
        // cannot cast: three renders the depth pass from the LIGHT, and
        // the card would face the light rather than the camera, giving
        // a silhouette that has nothing to do with what is drawn. It is
        // correctly excluded from the caster set.
        //
        // The consequence was that at 210m every palm on the map became
        // a non-casting impostor, and a blind art director measured the
        // result: ground under a crown at luma 111 against open sunlit
        // sand at 110. A grove that casts nothing reads as decals
        // painted on the heightfield, which is exactly what it said.
        //
        // So the mid level now runs to the shadow distance rather than
        // to a fixed 210m. Beyond that the impostor takes over and
        // casts nothing, which is correct - there is no shadow map out
        // there to receive it.
        //
        // The multiplier used to be 0.95, which at ultra put the last
        // caster at 399m against a far cascade fitted to 420m and at
        // high put it at 247m against 260m: a 13-21m ring in which the
        // shadow map still reaches but every palm in it is a
        // non-casting billboard. 1.0 closes it exactly.
        //
        // A cross-fade IS kept at this boundary - unlike the one
        // above, real geometry to a flat card is a genuine change of
        // silhouette (measured 3.1/255 over 7% of the palm's pixels at
        // 200m) - but 8m is enough to cover it, not 16.
        { geometry: geom(buildPalm(1, 0), "palm-mid"),
          maxDistance: Math.max(210, q.shadowDistance), band: 8 },
        // band 0 at the outermost cull, because the material ALREADY
        // fades this out without stippling: `transformed *= 1.0 -
        // smoothstep(uFade)` shrinks the plant into its own base over
        // treeDistance*0.86..treeDistance, which for a tree at 800m is
        // sub-pixel long before it vanishes. A dither band on top of a
        // scale fade is a stipple bought for nothing.
        { geometry: geom(buildPalmImpostor(0), "palm-far"),
          maxDistance: q.treeDistance, band: 0 },
        // No set-level band on this species or the two below: every
        // level carries its own, so a value here would be a dead
        // constant sitting where someone would go to tune the fade.
      ], treeMaterial, palms, { castShadow: true });
      buildLod("palmYoung", [
        // 4, not 0. The young form's crown is short and wide, so
        // dropping half its fronds changes more of its silhouette than
        // it does on the mature palm: measured 8.8/255 over 17% of its
        // own pixels against the mature palm's 1.9/255 over 7%. A 4m
        // ring at 62m holds very few palms, which is the whole point -
        // buy the cross-fade only where the measurement asks for it.
        { geometry: geom(buildPalm(0, 1), "palmy-hi"), maxDistance: 62, band: 4 },
        { geometry: geom(buildPalm(1, 1), "palmy-mid"),
          maxDistance: Math.max(210, q.shadowDistance), band: 8 },
        { geometry: geom(buildPalmImpostor(1), "palmy-far"),
          maxDistance: q.treeDistance, band: 0 },
      ], treeMaterial, palmsYoung, { castShadow: true });

      /* ---- acacia: open ground, the lone tree on the plain ---- */

      const acaciaAccept = (x, z) => {
        const slope = terrain.slopeAt(x, z);
        if (slope > 0.26) return false;
        const y = terrain.heightAt(x, z);
        if (!clearOfBuildings(x, z, 4)) return false;
        const m = moistureAt(x, z, y, slope);
        return m > 0.20 && m < 0.62;
      };
      const acacias = samplePlacements({
        count: 170, perCluster: 2, spread: 16, accept: acaciaAccept,
        scale: [0.62, 1.85], tilt: 0.4, radius: 1.2, contact: 3.2, lean: 0.16,
        stretch: 0.5, bend: 0.5,
      });
      buildLod("acacia", [
        // Same reasoning as the palm above: real geometry out to the
        // shadow distance. `acacia-far` is cross-cards rather than a
        // billboard, so unlike the palm impostor it can and does cast
        // all the way to its own cull - shadowLevels 2 of 2 levels.
        //
        // band 8, not 18: the far level is now the same acacia with
        // every other bough and canopy card removed, so the swap has
        // far less to hide than it did when the two levels were drawn
        // from different random sequences.
        { geometry: geom(buildAcacia(0), "acacia-hi"),
          maxDistance: Math.max(90, q.shadowDistance), band: 8 },
        { geometry: geom(buildAcaciaFar(), "acacia-far"), maxDistance: q.treeDistance * 0.7 },
      ], treeMaterial, acacias, { castShadow: true, band: 8, shadowLevels: 2 });

      /* ---- tamarisk: the wadi banks ---- */

      const tamariskAccept = (x, z) => {
        const slope = terrain.slopeAt(x, z);
        if (slope > 0.30) return false;
        const y = terrain.heightAt(x, z);
        if (!clearOfBuildings(x, z, 2)) return false;
        return moistureAt(x, z, y, slope) > 0.38 && wadiDistance(x, z) < 150;
      };
      const tamarisks = samplePlacements({
        count: 540, perCluster: 7, spread: 9, accept: tamariskAccept,
        scale: [0.55, 1.95], tilt: 0.45, radius: 0.8, contact: 2.2, lean: 0.14,
        stretch: 0.6, bend: 0.5,
      });
      buildLod("tamarisk", [
        // The one boundary that measured a genuinely large pop -
        // 22.9/255 over a third of the bush's own pixels - because 3
        // cards drawn from a different seed made the far level a
        // different bush. It is 4 of the same 8 cards now, so the band
        // can come down from 12 to 6 rather than up.
        { geometry: geom(buildTamarisk(0), "tamarisk-hi"), maxDistance: 70, band: 6 },
        // band 0 at the cull: shrubMaterial's scale fade runs
        // propDistance*0.82..propDistance, which is exactly this
        // boundary, so the dither would only stipple ground the scale
        // fade has already shrunk away. The acacia below does NOT get
        // this - its cull is treeDistance*0.7, well inside the tree
        // material's full-scale region, so it still needs a band.
        { geometry: geom(buildTamarisk(1), "tamarisk-far"),
          maxDistance: q.propDistance, band: 0 },
        // Both levels are real geometry - the far one is a thinner
        // bush, not a billboard - so both may cast.
      ], shrubMaterial, tamarisks, { castShadow: true, shadowLevels: 2 });

      /* ---- reeds: the wadi bottom ---- */

      const reedAccept = (x, z) => {
        if (wadiDistance(x, z) > 30) return false;
        const slope = terrain.slopeAt(x, z);
        if (slope > 0.13) return false;
        if (!clearOfBuildings(x, z, 0)) return false;
        return moistureAt(x, z, terrain.heightAt(x, z), slope) > 0.60;
      };
      const reeds = samplePlacements({
        count: 2600, perCluster: 34, spread: 5.0, accept: reedAccept,
        scale: [0.55, 1.85], tilt: 0.3, radius: 0.4, contact: 1.0,
      });
      buildStatic("reed", geom(buildBush("reed", {
        cards: 4, w: 0.9, h: 2.1, spread: 0.12, thick: 1.0, segs: 3,
        windBase: 0.12, windTop: 1.0, sphere: 0.25, seed: 0x2f1, aoBase: 0.34,
      }), "reed"), shrubMaterial, reeds, { castShadow: true });

      /* ---- camel thorn: the dry middle ground ---- */

      const thornAccept = (x, z) => {
        const slope = terrain.slopeAt(x, z);
        if (slope > 0.32) return false;
        const y = terrain.heightAt(x, z);
        if (!clearOfBuildings(x, z, 0)) return false;
        const m = moistureAt(x, z, y, slope);
        return m > 0.12 && m < 0.62;
      };
      const thorns = samplePlacements({
        count: Math.round(3000 * cover), perCluster: 16, spread: 8, accept: thornAccept,
        scale: [0.42, 1.75], tilt: 0.55, radius: 0.5, contact: 1.5,
      });
      buildStatic("thorn", geom(buildBush("thorn", {
        cards: 4, w: 1.25, h: 0.95, spread: 0.16, thick: 0.75, segs: 1,
        windBase: 0.06, windTop: 0.55, sphere: 0.62, seed: 0x81c, aoBase: 0.36,
      }), "thorn"), shrubMaterial, thorns, { castShadow: true });

      /* ---- dead brush: the dunes ---- */

      const brushAccept = (x, z) => {
        const slope = terrain.slopeAt(x, z);
        if (slope > 0.34) return false;
        const y = terrain.heightAt(x, z);
        if (!clearOfBuildings(x, z, 0)) return false;
        return moistureAt(x, z, y, slope) < 0.34;
      };
      const brush = samplePlacements({
        count: Math.round(1100 * cover), perCluster: 7, spread: 12, accept: brushAccept,
        scale: [0.4, 1.55], tilt: 0.6, radius: 0.4, contact: 1.2,
      });
      buildStatic("deadbrush", geom(buildBush("deadbrush", {
        cards: 4, w: 1.1, h: 0.75, spread: 0.14, thick: 0.55, segs: 1,
        windBase: 0.05, windTop: 0.45, sphere: 0.55, seed: 0x33d, aoBase: 0.4,
      }), "deadbrush"), shrubMaterial, brush, { castShadow: true });

      /* ---- tussock grass ---- */

      const tussockAccept = (x, z) => {
        const slope = terrain.slopeAt(x, z);
        if (slope > 0.28) return false;
        const y = terrain.heightAt(x, z);
        if (!clearOfBuildings(x, z, 0)) return false;
        const m = moistureAt(x, z, y, slope);
        return m > 0.22 && m < 0.80;
      };
      const tussocks = samplePlacements({
        count: Math.round(2800 * cover), perCluster: 22, spread: 6, accept: tussockAccept,
        scale: [0.45, 1.7], tilt: 0.55, radius: 0.35, contact: 1.1,
      });
      buildStatic("tussock", geom(buildBush("tussock", {
        cards: 4, w: 0.95, h: 0.72, spread: 0.1, thick: 1.0, segs: 2,
        windBase: 0.1, windTop: 1.0, sphere: 0.5, seed: 0x5b2, aoBase: 0.3,
      }), "tussock"), shrubMaterial, tussocks, { castShadow: true });

      /* ---- fine ground cover, near field only ---- */

      if (q.grassDistance > 0 && density > 0) {
        const grassAccept = (x, z) => {
          const slope = terrain.slopeAt(x, z);
          if (slope > 0.26) return false;
          const y = terrain.heightAt(x, z);
          if (!clearOfBuildings(x, z, 0)) return false;
          return moistureAt(x, z, y, slope) > 0.30;
        };
        const grass = samplePlacements({
          count: Math.round(10000 * density), perCluster: 30, spread: 4.5, accept: grassAccept,
          scale: [0.45, 1.55], tilt: 0.65, radius: 0.25,
        });
        buildStatic("grass", geom(buildBush("tussock", {
          cards: 3, w: 0.62, h: 0.34, spread: 0.07, thick: 1.0, segs: 1,
          windBase: 0.12, windTop: 1.0, sphere: 0.45, seed: 0x9c7, aoBase: 0.32,
        }), "grass"), grassMaterial, grass, { castShadow: false });
      }

      /* ---- cultivated plots: why anyone lives here ---- */

      const crops = [];
      for (const s of settlements) {
        const fields = 3;
        for (let f = 0; f < fields; f += 1) {
          const angle = rng.range(0, Math.PI * 2);
          const dist = s.radius * rng.range(1.15, 1.7);
          const fx = s.x + Math.cos(angle) * dist;
          const fz = s.z + Math.sin(angle) * dist;
          if (!terrain.inBounds(fx, fz)) continue;
          if (terrain.slopeAt(fx, fz) > 0.10) continue;
          const rowAngle = rng.range(0, Math.PI);
          const ca = Math.cos(rowAngle);
          const sa = Math.sin(rowAngle);
          const halfW = rng.range(8, 13);
          const halfL = rng.range(7, 11);
          // Straight rows with bare earth between them. Rows are the
          // whole reason this reads as cultivation rather than as a
          // patch of greener scrub.
          for (let row = -halfW; row <= halfW; row += 2.4) {
            for (let along = -halfL; along <= halfL; along += 0.95) {
              const px = fx + ca * row - sa * along;
              const pz = fz + sa * row + ca * along;
              if (!terrain.inBounds(px, pz)) continue;
              if (terrain.slopeAt(px, pz) > 0.16) continue;
              if (!clearOfBuildings(px, pz, -2)) continue;
              const y = terrain.heightAt(px, pz);
              if (!clearOfColliders(px, pz, y, 0.3)) continue;
              crops.push({
                x: px, y, z: pz,
                yaw: rowAngle + rng.range(-0.12, 0.12),
                scale: rng.range(0.85, 1.15),
                yScale: rng.range(0.85, 1.2),
                dry: rng() * 0.22,
                tilt: 0.7, lean: 0, contact: 0,
              });
            }
          }
        }
      }
      buildStatic("crop", geom(buildBush("crop", {
        cards: 3, w: 0.7, h: 0.85, spread: 0.06, thick: 1.0, segs: 2,
        windBase: 0.1, windTop: 1.0, sphere: 0.35, seed: 0x4e8, aoBase: 0.3,
      }), "crop"), shrubMaterial, crops, { castShadow: true });

      buildContacts();
    },

    /* ----------------------------- runtime ----------------------------- */

    update(dt, c) {
      const weather = c?.sky?.weather || ctx.sky?.weather || "clear";
      wind.target = WEATHER_WIND[weather] ?? WEATHER_WIND.clear;
      // Ease rather than cut: a weather change is a front arriving.
      wind.strength += (wind.target - wind.strength) * (1 - Math.exp(-0.4 * dt));

      wind.phase += dt * lerp(0.9, 2.6, clamp01(wind.strength));
      wind.gust += dt * lerp(0.10, 0.42, clamp01(wind.strength));

      windUniforms.uWindTime.value = wind.phase;
      windUniforms.uGustTime.value = wind.gust;
      windUniforms.uWindStrength.value = wind.strength;
      windUniforms.uWindDir.value.copy(wind.direction);
      // The sand only bounces light back up while the sun is on it.
      // Read lazily off ctx, so foliage still runs if sky is rebuilt.
      const sun = (c?.sky || ctx.sky)?.sunDirection;
      windUniforms.uSunUp.value = sun ? clamp01(sun.y) : 1;

      lodTimer += dt;
      const camera = render.camera.position;
      const moved = camera.distanceToSquared(lastLodCamera) > 36;
      if (lodTimer > 0.3 || moved) {
        lodTimer = 0;
        lastLodCamera.copy(camera);
        for (const set of lodSets) refreshLod(set, camera);
      }
    },

    /** Manual override, for the wind machine in a scripted sequence. */
    setWind(strength, directionRadians) {
      wind.strength = strength;
      wind.target = strength;
      if (directionRadians !== undefined) {
        wind.direction.set(Math.cos(directionRadians), Math.sin(directionRadians)).normalize();
      }
    },

    /** World positions of up to `count` plants of a species. The
     *  art-director loop needs to point a camera at an actual palm; it
     *  cannot re-derive placement from the outside. */
    samplePositions(name, count = 8) {
      const source = lodSets.find((s) => s.name === name);
      if (source) {
        const step = Math.max(1, Math.floor(source.placements.length / count));
        const out = [];
        for (let i = 0; i < source.placements.length && out.length < count; i += step) {
          const p = source.placements[i];
          out.push([p.x, p.y, p.z, p.scale]);
        }
        return out;
      }
      const layer = layers.find((l) => l.name === name);
      if (!layer) return [];
      const matrix = new THREE.Matrix4();
      const step = Math.max(1, Math.floor(layer.instances / count));
      const out = [];
      for (let i = 0; i < layer.instances && out.length < count; i += step) {
        layer.mesh.getMatrixAt(i, matrix);
        out.push([matrix.elements[12], matrix.elements[13], matrix.elements[14], 1]);
      }
      return out;
    },

    report() {
      let instances = 0;
      let triangles = 0;
      for (const layer of layers) {
        instances += layer.instances;
        triangles += layer.triangles;
      }
      let drawCalls = 0;
      group.traverse((obj) => { if (obj.isInstancedMesh && obj.count > 0) drawCalls += 1; });
      return {
        species: layers.map((l) => ({
          name: l.name,
          instances: l.instances,
          lod: l.lod || 1,
          drawn: l.mesh.count,
        })),
        instances,
        drawCalls,
        peakTriangles: Math.round(triangles),
        wind: {
          strength: Number(wind.strength.toFixed(3)),
          weather: ctx.sky?.weather || "clear",
        },
      };
    },

    dispose() {
      group.traverse((obj) => { if (obj.isInstancedMesh) obj.dispose(); });
      for (const geometry of geometryCache) geometry.dispose();
      for (const material of materialRegistry) material.dispose();
      atlas.dispose();
      render.scene.remove(group);
    },
  };

  return api;
}
