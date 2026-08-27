/* ============================================================
   SAINTFALL - Antiphon HUD  (Meridian-IV, "The Green Antiphon")

   A compass, a place name, one signed readout and a reticle.
   Nothing else. It is deliberately the smallest HUD of the three
   worlds, and the three things below are why it is not a copy of
   either of the others.

   ------------------------------------------------------------
   1. THE READOUT IS SIGNED ABOUT THE SEA, AND THE SEA IS y = 0.

   Every previous SAINTFALL world puts y = 0 on the ground the
   player spawns on, so an altimeter is a one-sided scale and a
   negative number means "under the map". Here y = 0 is the WATER,
   half the walkable surface of the level is below it, and the
   number a player standing in the shallows actually needs is not
   their own altitude - it is how much water is over their feet
   and how much of the wade budget that has spent. So the readout
   has two regimes and it says which one it is in:

     above SEA_Y : "+12 M" and the tide band the ground is in;
     below SEA_Y : the DEPTH, with a bar that fills to WADE_MAX.

   Reading depth from the player's own y would be wrong twice: the
   figure's origin is its feet, so it reads 0 in a metre of water,
   and on the Spine's deck plates it reads 34 m of altitude while
   the ground under the deck is 8 m of lagoon. Depth comes from
   `field.waterDepthAt`, which INTERFACES makes the one reader.

   ------------------------------------------------------------
   2. THERE IS NO PER-FRAME MINIMAP.

   summit-hud.js bakes a 240x240 hillshade and blits it every
   frame, and it has to: a mountain is a height field and the only
   way to say "which of these nine places is above me" in two
   dimensions is to shade it. This level's whole shape is a RING
   with the stations spaced around it - which is exactly what a
   compass strip already is. A minimap here would repeat the
   compass in a smaller, worse font.

   The raster is still written, because the tactical map PAGE
   (ui.js:1678, `ctx.hud?.redrawTacticalMap?.(canvas)`) asks for
   one - but it is baked LAZILY, on the first request, and never
   ticked. A HUD that costs 57,600 `heightAt` calls a frame on a
   fill-bound renderer is a HUD that has spent the water's budget.

   ------------------------------------------------------------
   3. THE RETICLE IS NOT TURQUOISE, AND THAT IS A RULE NOT A TASTE.

   DESIGN-SEED section 4: turquoise is the level's currency and it
   is spent only on water. summit-hud.js's crosshair is #bfeee0,
   which on Kenosis sits against white snow and reads perfectly -
   and on a turquoise lagoon is invisible, because it is the
   lagoon's own hue at the lagoon's own value. This one is bone
   white with a brass core, the two hues the palette keeps OUT of
   the water band, and it survives being over the sea, over the
   canopy and over the hull.

   ------------------------------------------------------------
   COST. Zero triangles, zero draw calls, zero fill: it is DOM.
   Per frame it does one `surfaceAt`, one `waterDepthAt`, one
   `tideBandAt` and about twenty style writes. The lazy tactical
   raster is 200x200 `heightAt` calls, once, off the hot path.

   Styling rides the existing sf-hud classes in
   assets/css/saintfall-ui.css wherever it can. The tide readout
   and the reticle have no counterpart there, so this module
   injects its own <style> once - stated here because a module
   that writes CSS and does not say so is a module nobody can
   find later.
   ============================================================ */

import { clamp, clamp01, lerp } from "saintfall/core.js";
import {
  STATIONS, STATION_ORDER, SEA_Y, TIDE, WADE_MAX, MAP_SIZE, MAP_HALF,
} from "saintfall/atoll-terrain.js";
import { STATION_TINT } from "saintfall/atoll-art.js";

/* The tide bands `field.tideBandAt` returns, named. Index is the
   band number, 0 subtidal to 4 supralittoral, and the names are
   the real zonation terms because they are also what the surface
   classifier and the crust materials are keyed on - a HUD that
   invents its own vocabulary for the same five numbers makes the
   art direction and the instrument disagree in conversation. */
const TIDE_BAND_NAMES = [
  "SUBTIDAL",       // 0 - never uncovered
  "LOW WATER",      // 1 - uncovered at springs only
  "TIDE FLAT",      // 2 - the crust band, TIDE.crustTop at its top
  "SPLASH",         // 3 - salt bloom, nothing living
  "DRY",            // 4 - supralittoral, above TIDE.splashTop
];

/* The elevation range the lazy tactical raster normalises
   against. Authored, not measured: summit-hud.js records that
   feeding a ramp a range it was not built for renders the whole
   map as one flat disc, and a measured range hides exactly the
   terrain bug that would cause it. -42 is the abyssal floor the
   apron decays to; 214 is the Cauldron's authored rim. */
const ELEV_MIN = -42;
const ELEV_MAX = 214;

const ATOLL_HUD_CSS = `
/* ---------------------------- tide readout ----------------------------
   Top right, under the minimap slot the other worlds use. Two
   regimes, switched by [data-mode]: "air" is bone white, "water"
   is bone white with a brass bar, and "over" - past WADE_MAX -
   turns the bar to the level's one alarm colour. */
.sf-tide{position:absolute;right:max(1.4rem,calc(env(safe-area-inset-right) + 1rem));
  top:4.45rem;width:7.4rem;pointer-events:none;z-index:4;text-align:right;
  font:600 10px/1 "Share Tech Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  color:#e7ecdf;letter-spacing:.10em;
  text-shadow:0 1px 4px rgba(0,0,0,.92)}
.sf-tide__num{display:block;font-size:22px;line-height:1;letter-spacing:.01em;
  font-variant-numeric:tabular-nums;color:#f4f7ec}
.sf-tide__num b{font-weight:700}
.sf-tide__num i{font-style:normal;font-size:9px;opacity:.6;margin-left:.22rem;
  letter-spacing:.16em}
.sf-tide__band{display:block;margin-top:.22rem;font-size:8px;opacity:.62;
  letter-spacing:.20em}
.sf-tide__wade{display:block;margin-top:.28rem;height:3px;border-radius:2px;
  background:rgba(8,20,18,.62);box-shadow:inset 0 0 0 1px rgba(216,178,94,.22);
  overflow:hidden}
.sf-tide__wade i{display:block;height:100%;width:0%;
  background:linear-gradient(90deg,rgba(216,178,94,.55),#d9b25e);
  transition:width .09s linear}
.sf-tide[data-mode="air"] .sf-tide__wade{opacity:0}
.sf-tide[data-mode="over"] .sf-tide__num{color:#ffb27a}
.sf-tide[data-mode="over"] .sf-tide__wade i{background:#ff8a5c}

/* ------------------------------ reticle ------------------------------
   Four ticks and a bead. Bone white with a brass core - see the
   header: cyan is the water's, and a cyan crosshair over the
   lagoon is a crosshair nobody can find. The gap OPENS as the
   weapon fires, which is the only feedback a shot with no impact
   yet has. */
.sf-cross{position:absolute;left:50%;top:50%;width:0;height:0;
  pointer-events:none;opacity:0;transition:opacity .18s ease;z-index:4}
.sf-cross.is-live{opacity:1}
.sf-cross i{position:absolute;background:#eef2e4;display:block;
  box-shadow:0 0 4px rgba(20,28,24,.85),0 0 1px rgba(0,0,0,.95);
  transform-origin:50% 50%}
.sf-cross__n,.sf-cross__s{width:2px;height:9px;left:-1px}
.sf-cross__e,.sf-cross__w{width:9px;height:2px;top:-1px}
.sf-cross__dot{width:3px;height:3px;left:-1.5px;top:-1.5px;border-radius:50%;
  background:#d9b25e;box-shadow:0 0 6px rgba(217,178,94,.85)}
`;

export function buildAtollHud(ctx, host) {
  const el = host;
  const { THREE } = ctx;

  if (!document.getElementById("sf-atoll-hud-css")) {
    const style = document.createElement("style");
    style.id = "sf-atoll-hud-css";
    style.textContent = ATOLL_HUD_CSS;
    document.head.appendChild(style);
  }

  el.innerHTML = `
    <div class="sf-hud__district" id="sf-district">
      <div class="sf-hud__eyebrow">SAINTFALL &middot; THE GREEN ANTIPHON</div>
      <div class="sf-hud__name" id="sf-district-name"></div>
    </div>
    <div class="sf-hud__compass" id="sf-compass">
      <span class="sf-hud__compass-label" aria-hidden="true">BEARING</span>
      <div class="sf-hud__strip" id="sf-compass-strip"></div>
      <div class="sf-hud__needle"></div>
    </div>
    <div class="sf-tide" id="sf-tide" data-mode="air" aria-label="Altitude and wade depth">
      <span class="sf-tide__num" id="sf-tide-num"><b>0</b><i>M</i></span>
      <span class="sf-tide__band" id="sf-tide-band">DRY</span>
      <span class="sf-tide__wade"><i id="sf-tide-wade"></i></span>
    </div>
    <div class="sf-cross" id="sf-cross" aria-hidden="true">
      <i class="sf-cross__n"></i><i class="sf-cross__s"></i>
      <i class="sf-cross__e"></i><i class="sf-cross__w"></i>
      <i class="sf-cross__dot"></i>
    </div>
    ${ctx.qa ? '<output class="sf-hud__readout" id="sf-readout" aria-label="QA world coordinates"></output>' : ""}
  `;

  const districtEl = el.querySelector("#sf-district");
  const nameEl = el.querySelector("#sf-district-name");
  const stripEl = el.querySelector("#sf-compass-strip");
  const tideEl = el.querySelector("#sf-tide");
  const tideNum = el.querySelector("#sf-tide-num");
  const tideBand = el.querySelector("#sf-tide-band");
  const tideWade = el.querySelector("#sf-tide-wade");
  const readoutEl = el.querySelector("#sf-readout");
  const crossEl = el.querySelector("#sf-cross");
  const crossArms = {
    n: crossEl.querySelector(".sf-cross__n"),
    s: crossEl.querySelector(".sf-cross__s"),
    e: crossEl.querySelector(".sf-cross__e"),
    w: crossEl.querySelector(".sf-cross__w"),
  };
  let crossSpread = 0;

  /* ---------------------------- compass ---------------------------- */

  /* Engine bearing is atan2(x, z) and the strip is placed on it
     directly, so SOUTH is angle 0: +Z is south under this
     project's axes and yaw 0 faces -Z. Getting this table upside
     down is the failure this project has had twice, and it looks
     like a compass that is right at one heading and wrong at the
     opposite one. */
  const CARDINALS = [
    { a: Math.PI, t: "N" }, { a: Math.PI * 1.25, t: "NE" },
    { a: Math.PI * 1.5, t: "E" }, { a: Math.PI * 1.75, t: "SE" },
    { a: 0, t: "S" }, { a: Math.PI * 0.25, t: "SW" },
    { a: Math.PI * 0.5, t: "W" }, { a: Math.PI * 0.75, t: "NW" },
  ];
  const stripTicks = CARDINALS.map((c) => {
    const s = document.createElement("span");
    s.className = "sf-hud__tick";
    s.textContent = c.t;
    stripEl.appendChild(s);
    return { ...c, el: s };
  });

  /* Station bearings ride the same strip, in the station's own
     STATION_TINT hue. On a ring level every station is at a
     BEARING and nothing else - there is no "above you" and no
     "behind the ridge" - so a compass that carries them is a
     complete map of where things are. The Hold is excluded: it is
     at the centre, its bearing is undefined within a few hundred
     metres of it, and a marker that swings 180 degrees as you
     walk past is worse than no marker. */
  const stationTicks = STATION_ORDER.filter((id) => id !== "hold").map((id) => {
    const s = document.createElement("span");
    s.className = "sf-hud__tick sf-hud__tick--marker";
    s.textContent = STATIONS[id].name
      .replace(/^The /, "").slice(0, 3).toUpperCase();
    const tint = STATION_TINT[id];
    if (tint) s.style.color = tint[0];
    stripEl.appendChild(s);
    return { id, el: s };
  });

  /* ------------------------- the naming field -------------------------
     `field.surfaceAt(x, z).district` IS the naming field - the
     terrain already decides which station owns a patch of ground,
     and it does it with the pad ellipses and the tint washes the
     art uses. Asking it is the difference between the banner and
     the ground agreeing and the banner having its own opinion.
     The distance fallback exists only for a field that has not
     been built yet (a harness may construct the HUD first). */
  function stationAt(x, z) {
    const f = ctx.field || (ctx.terrain && ctx.terrain.field);
    if (f && f.surfaceAt) {
      const s = f.surfaceAt(x, z);
      if (s && s.district && STATIONS[s.district]) {
        return { id: s.district, name: STATIONS[s.district].name };
      }
      if (s) return null;
    }
    let best = null;
    let bestD = Infinity;
    for (const id of STATION_ORDER) {
      const st = STATIONS[id];
      const d = Math.hypot(x - st.x, z - st.z) / Math.max(1, st.r);
      if (d < 1 && d < bestD) { bestD = d; best = { id, name: st.name }; }
    }
    return best;
  }

  /* ---------------------------- state ---------------------------- */

  let current = null;
  let showFor = 0;
  const fwdVec = new THREE.Vector3();
  let raster = null;

  /* The tactical map page's raster. Baked on demand and cached -
     see header note 2. 200x200 over 2048 m is 10.2 m per pixel,
     which is finer than the ring is wide and coarser than any
     feature the page can usefully show. */
  function bakeRaster() {
    const f = ctx.field || (ctx.terrain && ctx.terrain.field);
    if (!f || !f.heightAt) return null;
    const N = 200;
    const c = document.createElement("canvas");
    c.width = N;
    c.height = N;
    const g = c.getContext("2d");
    const img = g.createImageData(N, N);
    const toWorld = (i) => (i / (N - 1)) * MAP_SIZE - MAP_HALF;
    /* A raking light from the ENE, which is the level's own trade
       light - the map and the world agree about which side of the
       ring is lit. */
    const SUN = [0.83, 0.56];
    for (let j = 0; j < N; j += 1) {
      const z = toWorld(j);
      for (let i = 0; i < N; i += 1) {
        const x = toWorld(i);
        const y = f.heightAt(x, z);
        const o = (j * N + i) * 4;
        if (y < SEA_Y) {
          /* Water is drawn by DEPTH, not by height, because the
             one thing a plan view of an atoll has to say is where
             the lagoon ends and the ocean starts - and those two
             are the same elevation band on a height ramp. */
          const d = clamp01((SEA_Y - y) / 26);
          img.data[o] = lerp(126, 8, d);
          img.data[o + 1] = lerp(198, 40, d);
          img.data[o + 2] = lerp(188, 78, d);
        } else {
          const t = clamp01((y - SEA_Y) / (ELEV_MAX - SEA_Y));
          const e = 12;
          const dx = f.heightAt(x + e, z) - f.heightAt(x - e, z);
          const dz = f.heightAt(x, z + e) - f.heightAt(x, z - e);
          const shade = clamp01(0.5 + (dx * SUN[0] + dz * SUN[1]) / (e * 2.2));
          img.data[o] = clamp(lerp(74, 196, t) * lerp(0.56, 1.20, shade), 0, 255);
          img.data[o + 1] = clamp(lerp(104, 176, t) * lerp(0.60, 1.14, shade), 0, 255);
          img.data[o + 2] = clamp(lerp(58, 152, t) * lerp(0.66, 1.08, shade), 0, 255);
        }
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  return {
    el,

    /** Shown only for a figure that has something to aim. */
    setReticle(on) { crossEl.classList.toggle("is-live", !!on); },

    /** `kick` is 0..1; the gap opens with it and settles on its own. */
    reticleKick(kick) { crossSpread = Math.max(crossSpread, clamp01(kick)); },

    update(dt, player, camera) {
      /* The gap: 7px at rest, 17 under fire. Settling is framerate
         independent so a hitch does not leave it open. */
      crossSpread *= Math.exp(-7 * Math.max(0, dt));
      const gap = 7 + crossSpread * 10;
      crossArms.n.style.top = `${-gap - 9}px`;
      crossArms.s.style.top = `${gap}px`;
      crossArms.w.style.left = `${-gap - 9}px`;
      crossArms.e.style.left = `${gap}px`;

      const p = player.position;

      /* ------------------------ place name ------------------------ */
      const s = stationAt(p.x, p.z);
      const key = s ? s.id : null;
      if (key !== current) {
        current = key;
        showFor = s ? 5.2 : 0;
        if (s) nameEl.textContent = s.name;
      }
      showFor = Math.max(0, showFor - dt);
      districtEl.style.opacity = String(
        clamp01(showFor > 4.4 ? (5.2 - showFor) / 0.8 : showFor / 1.4)
      );

      /* -------------------------- compass -------------------------- */
      camera.getWorldDirection(fwdVec);
      const fwd = Math.atan2(fwdVec.x, fwdVec.z);
      const HALF_FOV = 62;
      const put = (node, angle) => {
        let d = ((angle - fwd) * 180) / Math.PI;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        if (Math.abs(d) > HALF_FOV) { node.style.opacity = "0"; return; }
        node.style.opacity = String(1 - Math.abs(d) / HALF_FOV);
        node.style.left = `${50 + (d / HALF_FOV) * 50}%`;
      };
      for (const t of stripTicks) put(t.el, t.a);
      for (const t of stationTicks) {
        const st = STATIONS[t.id];
        put(t.el, Math.atan2(st.x - p.x, st.z - p.z));
      }

      /* ---------------------- altitude / depth ---------------------- */
      /* THE ONE READER. `field.waterDepthAt` is `SEA_Y - heightAt`
         clamped at zero, and INTERFACES makes it the only place
         that subtraction happens - so a HUD that did it itself
         would be a second definition of "how deep is it" that can
         drift from the water shader's. */
      const f = ctx.field || (ctx.terrain && ctx.terrain.field);
      const depth = f && f.waterDepthAt ? f.waterDepthAt(p.x, p.z) : 0;
      const band = f && f.tideBandAt ? f.tideBandAt(p.x, p.z) : 4;
      if (depth > 0.06) {
        const over = depth > WADE_MAX;
        tideEl.dataset.mode = over ? "over" : "water";
        tideNum.innerHTML = `<b>${depth.toFixed(1)}</b><i>M DEEP</i>`;
        tideWade.style.width = `${clamp01(depth / WADE_MAX) * 100}%`;
      } else {
        tideEl.dataset.mode = "air";
        /* Signed, and about SEA_Y rather than about the player's
           own spawn: on this level a negative altitude is a real
           place - the reef flat at low water sits at -0.4 m and
           is walked on. */
        const y = p.y - SEA_Y;
        tideNum.innerHTML = `<b>${y >= 0 ? "+" : ""}${y.toFixed(y < 10 ? 1 : 0)}</b><i>M</i>`;
        tideWade.style.width = "0%";
      }
      tideBand.textContent = TIDE_BAND_NAMES[clamp(Math.round(band), 0, 4)];

      if (readoutEl) {
        readoutEl.textContent =
          `${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}  `
          + `${s ? s.id : "-"}  d${depth.toFixed(2)}`;
      }
    },

    setVisible(v) { el.style.display = v ? "" : "none"; },
    flashDistrict(name) { nameEl.textContent = name; showFor = 5.2; },

    /** ui.js:1678 asks for this when the tactical map page opens,
     *  optional-chained. Baked on the first call and cached; the
     *  return's `range` is what the page prints beside the map. */
    redrawTacticalMap(canvas) {
      if (!canvas) return null;
      if (!raster) raster = bakeRaster();
      const g = canvas.getContext("2d");
      if (!g) return null;
      const W = canvas.width;
      const H = canvas.height;
      g.clearRect(0, 0, W, H);
      const side = Math.min(W, H);
      const ox = (W - side) * 0.5;
      const oy = (H - side) * 0.5;
      if (raster) {
        g.imageSmoothingEnabled = true;
        g.drawImage(raster, ox, oy, side, side);
      }
      const toPx = (x, z) => [
        ox + ((x + MAP_HALF) / MAP_SIZE) * side,
        oy + ((z + MAP_HALF) / MAP_SIZE) * side,
      ];
      for (const id of STATION_ORDER) {
        const st = STATIONS[id];
        const [ax, az] = toPx(st.x, st.z);
        g.fillStyle = (STATION_TINT[id] && STATION_TINT[id][0]) || "#e7ecdf";
        g.beginPath();
        g.arc(ax, az, id === "cauldron" ? 5 : 3.4, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "rgba(238,242,228,0.82)";
        g.font = "600 9px ui-monospace,Menlo,monospace";
        g.fillText(st.name.replace(/^The /, "").toUpperCase(), ax + 7, az + 3);
      }
      return { range: MAP_SIZE, baked: !!raster, stations: STATION_ORDER.length };
    },

    mapState: () => ({ raster: !!raster, elevRange: [ELEV_MIN, ELEV_MAX] }),
    tideState: () => ({ bands: TIDE_BAND_NAMES.slice(), wadeMax: WADE_MAX, seaY: SEA_Y, tide: TIDE }),

    /* hud.js's callers use these; keep the names so anything
       shared between the levels does not have to branch. */
    start() {}, stop() {}, connect() {},
    toggleMap() { return false; },
    damageNumberCount: () => 0,
  };
}
