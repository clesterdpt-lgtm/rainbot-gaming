/* ============================================================
   SAINTFALL - summit HUD  (Kenosis, "The White Vigil")

   A fork of hud.js, and it HAS to be a fork rather than a
   parameterisation: hud.js imports DISTRICTS, ROAD_PATH,
   FOSSE_PATH, FOSSE_SPUR, MAP_HALF and MAP_SIZE from
   saintfall/terrain.js at MODULE SCOPE, and draws the whole-map
   raster, the projection and the reported range straight off them.
   None of that is injectable without rewriting the file the other
   level ships with.

   What this fork is NOT is a copy. Everything below the combat
   line in hud.js - health, heat, the boss bar, the objective, the
   stratagem dock, the reticle, the damage numbers - is DELETED,
   not stubbed, because this level has no combat to report and a
   stubbed HUD element is a promise the level does not keep.

   ------------------------------------------------------------
   THE TWO THINGS THAT ARE GENUINELY DIFFERENT

   1. THE HILLSHADE RAMP HAS TO BE RE-NORMALISED.

      hud.js's minimap shades against a 168m elevation range,
      because that is what a dune basin spans. Kenosis spans 452m
      plus a -16m outfall. Feeding the same ramp a range two and a
      half times wider puts every sample above its top stop, and
      the whole minimap renders as a WHITE DISC - a failure that
      looks like a broken canvas rather than like a wrong constant.

   2. THERE IS AN ALTIMETER, AND IT IS NOT DECORATION.

      Vesper is a plan-view level: a compass and a north-up minimap
      describe it completely, because everything is at roughly the
      same height. Kenosis's whole subject is height. A player on
      the Via Sacra needs to know how far up they are and which
      stations are above them, and no plan view can say that. The
      altimeter is a vertical scale with the nine stations marked
      on it and the player's altitude tracking up it - the one
      piece of new UI in the pack.

   Styling rides on the existing sf-hud classes wherever it can, so
   assets/css/saintfall.css needs no edit. The altimeter has no
   counterpart there, so this module injects its own <style> once -
   which is stated here because a module that writes CSS and does
   not say so is a module nobody can find later.
   ============================================================ */

import { clamp, clamp01, lerp, sstep } from "saintfall/core.js";
import {
  STATIONS, STATION_ORDER, VIA_SACRA_PATH, MAP_HALF, MAP_SIZE,
} from "saintfall/summit-terrain.js";
import { keybindLabel } from "saintfall/keybinds.js";

/* The elevation range the hillshade normalises against. Read off
   the layout rather than measured at runtime, so two runs of the
   same level cannot shade differently, and so a terrain bug that
   pushes the peak to 900m shows up as a saturated map instead of
   silently rescaling itself to look correct. */
const ELEV_MIN = -16;
const ELEV_MAX = 452;

const STATION_COLOUR = {
  basecamp: "#cfd8e4",
  tarn: "#5d7ea8",
  bowl: "#e6edf6",
  glacier: "#6fc2d8",
  rime: "#b9c3cc",
  fumarole: "#e0b545",
  cascade: "#8fd6e6",
  bell: "#c2b27a",
  summit: "#ffcf90",
};

const ALTIMETER_CSS = `
.sf-alt{position:absolute;right:18px;top:50%;transform:translateY(-50%);
  width:74px;height:min(52vh,430px);pointer-events:none;
  font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;
  color:#cfe0f4;letter-spacing:.08em;z-index:4}
.sf-alt__track{position:absolute;right:26px;top:8px;bottom:8px;width:2px;
  background:linear-gradient(to top,rgba(90,120,170,.18),rgba(190,215,245,.5))}
.sf-alt__tick{position:absolute;right:20px;width:14px;height:1px;
  background:rgba(190,215,245,.42);transform:translateY(-.5px)}
.sf-alt__tick[data-major]{right:14px;width:20px;background:rgba(214,232,252,.7)}
.sf-alt__label{position:absolute;right:40px;white-space:nowrap;
  transform:translateY(-50%);opacity:.62;font-size:9px}
.sf-alt__stn{position:absolute;right:23px;width:8px;height:8px;border-radius:50%;
  transform:translate(50%,-50%);box-shadow:0 0 0 1px rgba(8,12,20,.65)}
.sf-alt__me{position:absolute;right:19px;width:0;height:0;
  border-top:6px solid transparent;border-bottom:6px solid transparent;
  border-right:9px solid #ffcf90;transform:translateY(-50%);
  filter:drop-shadow(0 0 4px rgba(255,207,144,.5))}
.sf-alt__read{position:absolute;right:0;top:-6px;text-align:right;
  font-size:15px;letter-spacing:.02em;color:#f2f7ff}
.sf-alt__read small{display:block;font-size:8px;opacity:.55;letter-spacing:.16em}

/* ---------------------------- reticle ----------------------------
   Four ticks and a centre bead, in the operative's own verdigris.
   A crosshair on this level is not decoration: the crescent
   discharge is aimed down the camera ray, so without something at
   the centre of the screen the player is firing at a direction they
   cannot see. The gap OPENS as the weapon fires, which is the only
   feedback a shot with no impact yet has. */
.sf-cross{position:absolute;left:50%;top:50%;width:0;height:0;
  pointer-events:none;opacity:0;transition:opacity .18s ease}
.sf-cross.is-live{opacity:1}
.sf-cross i{position:absolute;background:#bfeee0;display:block;
  box-shadow:0 0 4px rgba(80,200,180,.75),0 0 1px rgba(0,0,0,.9);
  transform-origin:50% 50%}
.sf-cross__n,.sf-cross__s{width:2px;height:9px;left:-1px}
.sf-cross__e,.sf-cross__w{width:9px;height:2px;top:-1px}
.sf-cross__dot{width:3px;height:3px;left:-1.5px;top:-1.5px;border-radius:50%;
  background:#eafff8;box-shadow:0 0 6px rgba(120,240,215,.9)}

/* ---------------------------- kit dock ----------------------------
   The operative's own numbers, bottom-left where the campaign keeps
   its vitals: health, the shared reliquary charge, and one row per
   doctrine verb (the Vigil's step charges, the Bastion's guard and
   cast). Same hard-edged monospace as the altimeter. */
.sf-kit{position:absolute;left:18px;bottom:18px;display:flex;
  flex-direction:column;gap:7px;min-width:230px;pointer-events:none;
  font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;
  color:#cfe0f4;letter-spacing:.08em;z-index:4}
.sf-kit__bar{position:relative;height:14px;
  background:rgba(10,16,26,.62);border:1px solid rgba(190,215,245,.28)}
.sf-kit__bar i{position:absolute;left:0;top:0;bottom:0;width:100%;
  transform-origin:0 50%;transform:scaleX(1)}
.sf-kit__hp i{background:linear-gradient(to right,#e0b545,#ffcf90)}
.sf-kit__hp[data-state="hurt"] i{background:linear-gradient(to right,#c2502f,#ff9540)}
.sf-kit__hp[data-state="dead"] i{background:#6b1f14}
.sf-kit__charge i{background:linear-gradient(to right,#3f7d92,#8fd6e6)}
.sf-kit__charge[data-state="crit"] i{background:#a1452c}
.sf-kit__bar b{position:absolute;right:6px;top:50%;transform:translateY(-50%);
  font-size:9px;color:#f2f7ff;text-shadow:0 1px 2px rgba(0,0,0,.8)}
.sf-kit__bar small{position:absolute;left:6px;top:50%;transform:translateY(-50%);
  font-size:8px;opacity:.62;letter-spacing:.16em}
.sf-kit__row{display:flex;align-items:center;gap:8px;height:16px;
  background:rgba(10,16,26,.5);border:1px solid rgba(190,215,245,.2);
  padding:0 6px}
.sf-kit__row kbd{font:inherit;font-size:8px;padding:1px 4px;
  border:1px solid rgba(190,215,245,.4);color:#eafff8}
.sf-kit__row span{flex:1;font-size:9px;opacity:.85}
.sf-kit__row b{font-size:10px;color:#ffe9c9}
.sf-kit__row[data-state="ready"] b{color:#bfeee0}
.sf-kit__row[data-state="cooldown"] b,.sf-kit__row[data-state="empty"] b{color:#e8a06a}
.sf-kit__row[data-state="active"] b{color:#ffd76a}
`;

export function buildSummitHud(ctx, host) {
  const el = host;
  const { THREE } = ctx;

  if (!document.getElementById("sf-alt-css")) {
    const style = document.createElement("style");
    style.id = "sf-alt-css";
    style.textContent = ALTIMETER_CSS;
    document.head.appendChild(style);
  }

  el.innerHTML = `
    <div class="sf-hud__district" id="sf-district">
      <div class="sf-hud__eyebrow">SAINTFALL &middot; THE WHITE VIGIL</div>
      <div class="sf-hud__name" id="sf-district-name"></div>
    </div>
    <div class="sf-hud__compass" id="sf-compass">
      <span class="sf-hud__compass-label" aria-hidden="true">BEARING</span>
      <div class="sf-hud__strip" id="sf-compass-strip"></div>
      <div class="sf-hud__needle"></div>
    </div>
    <aside class="sf-hud__minimap" id="sf-minimap" aria-label="Ascent map">
      <div class="sf-minimap__head">
        <span><small>KENOSIS</small><strong>NORTH-UP</strong></span>
        <b id="sf-map-range">400M</b>
      </div>
      <canvas id="sf-map-canvas" width="280" height="280" aria-hidden="true"></canvas>
      <div class="sf-minimap__expand" aria-hidden="true"><kbd>${keybindLabel("map")}</kbd><span>ASCENT MAP</span></div>
    </aside>
    <div class="sf-alt" id="sf-alt" aria-label="Altimeter">
      <div class="sf-alt__read" id="sf-alt-read">0<small>METRES</small></div>
      <div class="sf-alt__track"></div>
      <div id="sf-alt-marks"></div>
      <div class="sf-alt__me" id="sf-alt-me" style="top:100%"></div>
    </div>
    <div class="sf-cross" id="sf-cross" aria-hidden="true">
      <i class="sf-cross__n"></i><i class="sf-cross__s"></i>
      <i class="sf-cross__e"></i><i class="sf-cross__w"></i>
      <i class="sf-cross__dot"></i>
    </div>
    <div class="sf-kit" id="sf-kit" aria-label="Operative kit">
      <div class="sf-kit__bar sf-kit__hp" id="sf-kit-hp"><i id="sf-kit-hp-fill"></i>
        <small>VITALITY</small><b id="sf-kit-hp-value">150</b></div>
      <div class="sf-kit__bar sf-kit__charge" id="sf-kit-charge"><i id="sf-kit-charge-fill"></i>
        <small>RELIQUARY</small><b id="sf-kit-charge-value">READY</b></div>
      <div class="sf-kit__row" id="sf-kit-ability" data-state="ready" hidden>
        <kbd id="sf-kit-ability-key">E</kbd>
        <span id="sf-kit-ability-name"></span>
        <b id="sf-kit-ability-value"></b>
      </div>
      <div class="sf-kit__row" id="sf-kit-cast" data-state="ready" hidden>
        <kbd>RMB</kbd>
        <span id="sf-kit-cast-name">HAMMER CAST</span>
        <b id="sf-kit-cast-value">READY</b>
      </div>
      <div class="sf-kit__row" id="sf-kit-command" data-state="ready" hidden>
        <kbd>Q</kbd>
        <span id="sf-kit-command-name">FIELD COMMAND</span>
        <b id="sf-kit-command-value">READY</b>
      </div>
      <div class="sf-kit__row" id="sf-kit-doctrine" data-state="ready" hidden>
        <kbd>${keybindLabel("menu").split(" / ")[0] || "ESC"}</kbd>
        <span id="sf-kit-doctrine-name">DOCTRINE POINT</span>
        <b id="sf-kit-doctrine-value">1</b>
      </div>
    </div>
    ${ctx.qa ? '<output class="sf-hud__readout" id="sf-readout" aria-label="QA world coordinates"></output>' : ""}
  `;

  const districtEl = el.querySelector("#sf-district");
  const nameEl = el.querySelector("#sf-district-name");
  const stripEl = el.querySelector("#sf-compass-strip");
  const rangeEl = el.querySelector("#sf-map-range");
  const canvas = el.querySelector("#sf-map-canvas");
  const readoutEl = el.querySelector("#sf-readout");
  const altMarks = el.querySelector("#sf-alt-marks");
  const altMe = el.querySelector("#sf-alt-me");
  const altRead = el.querySelector("#sf-alt-read");
  const kitEls = {
    hp: el.querySelector("#sf-kit-hp"),
    hpFill: el.querySelector("#sf-kit-hp-fill"),
    hpValue: el.querySelector("#sf-kit-hp-value"),
    charge: el.querySelector("#sf-kit-charge"),
    chargeFill: el.querySelector("#sf-kit-charge-fill"),
    chargeValue: el.querySelector("#sf-kit-charge-value"),
    ability: el.querySelector("#sf-kit-ability"),
    abilityKey: el.querySelector("#sf-kit-ability-key"),
    abilityName: el.querySelector("#sf-kit-ability-name"),
    abilityValue: el.querySelector("#sf-kit-ability-value"),
    cast: el.querySelector("#sf-kit-cast"),
    castValue: el.querySelector("#sf-kit-cast-value"),
    command: el.querySelector("#sf-kit-command"),
    commandName: el.querySelector("#sf-kit-command-name"),
    commandValue: el.querySelector("#sf-kit-command-value"),
    doctrine: el.querySelector("#sf-kit-doctrine"),
    doctrineName: el.querySelector("#sf-kit-doctrine-name"),
    doctrineValue: el.querySelector("#sf-kit-doctrine-value"),
  };
  /* One-time dock identity, resolved on the first update once the
     kit exists on ctx (the HUD is built before the kit's summit-main
     wiring finished being read - pulling per frame is the campaign
     HUD's own pattern anyway). */
  let kitDockNamed = false;
  function nameKitDock() {
    const kit = ctx.kenosis;
    if (!kit || kitDockNamed) return;
    kitDockNamed = true;
    if (kit.id === "white-vigil") {
      kitEls.ability.hidden = false;
      kitEls.abilityKey.textContent = keybindLabel("block").split(" / ")[0] || "E";
      kitEls.abilityName.textContent = "VIGIL STEP";
    } else if (kit.id === "bastion-penitent") {
      kitEls.ability.hidden = false;
      kitEls.abilityKey.textContent = keybindLabel("block").split(" / ")[0] || "E";
      kitEls.abilityName.textContent = "TOWER SHIELD";
      kitEls.cast.hidden = false;
    }
  }
  function updateKitDock(player) {
    const combatPlayer = ctx.combat?.player;
    if (combatPlayer) {
      const frac = clamp01(combatPlayer.hp / Math.max(1, combatPlayer.maxHp));
      kitEls.hpFill.style.transform = `scaleX(${frac.toFixed(3)})`;
      kitEls.hpValue.textContent = String(Math.max(0, Math.round(combatPlayer.hp)));
      kitEls.hp.dataset.state = combatPlayer.dead ? "dead"
        : frac < 0.35 ? "hurt" : "ok";
    }
    const jet = ctx.jetpack?.status?.(player.state);
    if (jet) {
      const frac = clamp01(jet.fuel / Math.max(1, jet.maxFuel));
      kitEls.chargeFill.style.transform = `scaleX(${frac.toFixed(3)})`;
      const label = jet.leapMode
        ? (jet.mode === "cooldown" ? `LEAP ${jet.leapCooldownRemaining.toFixed(1)}S`
          : jet.mode === "thrust" ? "LEAP"
            : jet.mode.toUpperCase())
        : jet.mode.toUpperCase();
      kitEls.chargeValue.textContent = `${Math.round(frac * 100)}% · ${label}`;
      kitEls.charge.dataset.state = frac < 0.18 ? "crit" : jet.mode;
    }
    nameKitDock();
    /* THE COMMAND ROW. Ahead of the kit early-out on purpose: the
       wheel is the mission's, not the kit's, and a level that somehow
       had no kit would still want to know what it can call. It shows
       whatever is IN THE AIR first, then whatever is closest to
       ready - which are the only two things the player can act on. */
    const command = ctx.command?.dockState?.();
    if (command) {
      kitEls.command.hidden = false;
      if (command.inbound) {
        kitEls.commandName.textContent = "INBOUND";
        kitEls.commandValue.textContent = `${command.inbound.remaining.toFixed(1)}S`;
        kitEls.command.dataset.state = "active";
      } else if (command.boon.active) {
        kitEls.commandName.textContent = "GILDED";
        kitEls.commandValue.textContent = `${command.boon.remaining.toFixed(0)}S`;
        kitEls.command.dataset.state = "active";
      } else if (command.best) {
        kitEls.commandName.textContent = String(command.best.name).toUpperCase();
        kitEls.commandValue.textContent = command.best.ready
          ? (command.best.spare > 0 ? `READY ×${command.best.spare + 1}` : "READY")
          : `${Math.ceil(command.best.remaining)}S`;
        kitEls.command.dataset.state = command.best.ready ? "ready" : "cooldown";
      }
    }
    const kit = ctx.kenosis;
    if (!kit) return;
    const status = kit.status();
    if (status.blink) {
      const b = status.blink;
      /* Clamped both ways: `repeat` throws on a negative count, and
         a doctrine that widens or narrows the step's magazine can
         put these two out of order for a frame. */
      const held = Math.max(0, Math.min(b.maxCharges, b.charges));
      const pips = "◆".repeat(held) + "◇".repeat(Math.max(0, b.maxCharges - held));
      kitEls.abilityValue.textContent = b.charges < b.maxCharges
        ? `${pips} ${b.rechargeIn.toFixed(1)}S CD` : `${pips} READY`;
      kitEls.ability.dataset.state = b.charges > 0 ? "ready" : "cooldown";
    }
    if (status.block) {
      kitEls.abilityValue.textContent = status.block.active ? "HELD"
        : status.block.blockedReason ? status.block.blockedReason.toUpperCase() : "READY";
      kitEls.ability.dataset.state = status.block.active ? "active" : "ready";
    }
    /* The doctrine's own cue. The campaign HUD has a dedicated
       banner for this; here it is one more row of the kit dock, and
       it only exists while there is something to spend. */
    const doctrine = ctx.doctrine?.state?.();
    if (doctrine) {
      const free = Math.max(0, Math.floor(Number(doctrine.pointsAvailable) || 0));
      kitEls.doctrine.hidden = free < 1;
      if (free >= 1) {
        kitEls.doctrineValue.textContent = String(free);
        kitEls.doctrineName.textContent = free === 1
          ? "DOCTRINE POINT" : "DOCTRINE POINTS";
        kitEls.doctrine.dataset.state = "ready";
      }
    }
    if (status.hammer) {
      const h = status.hammer;
      kitEls.castValue.textContent = h.phase === "out" ? "CAST"
        : h.phase === "return" ? "RETURNING"
          : h.phase === "windup" ? "WINDING"
            : h.cooldown > 0 ? `${h.cooldown.toFixed(1)}S CD` : "READY";
      kitEls.cast.dataset.state = h.phase !== "held" ? "active"
        : h.cooldown > 0 ? "cooldown" : "ready";
    }
  }

  const crossEl = el.querySelector("#sf-cross");
  const crossArms = {
    n: crossEl.querySelector(".sf-cross__n"),
    s: crossEl.querySelector(".sf-cross__s"),
    e: crossEl.querySelector(".sf-cross__e"),
    w: crossEl.querySelector(".sf-cross__w"),
  };
  let crossSpread = 0;
  const g2 = canvas.getContext("2d");

  /* ---------------------------- compass ---------------------------- */

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
  /* Station bearings ride the same strip. On a level where every
     station is visible from the parvis, a compass that only knows
     the cardinals is telling you the one thing you can already
     see. */
  const stationTicks = STATION_ORDER.filter((id) => id !== "summit").map((id) => {
    const s = document.createElement("span");
    s.className = "sf-hud__tick sf-hud__tick--marker";
    s.textContent = STATIONS[id].name.replace(/^The /, "").slice(0, 3).toUpperCase();
    s.style.color = STATION_COLOUR[id];
    stripEl.appendChild(s);
    return { id, el: s };
  });

  /* --------------------------- altimeter --------------------------- */

  const ALT_TOP = ELEV_MAX + 24;
  const ALT_BOT = ELEV_MIN;
  const altFrac = (y) => 1 - clamp01((y - ALT_BOT) / (ALT_TOP - ALT_BOT));

  for (let y = 0; y <= 450; y += 50) {
    const tick = document.createElement("i");
    tick.className = "sf-alt__tick";
    if (y % 100 === 0) tick.dataset.major = "1";
    tick.style.top = `${altFrac(y) * 100}%`;
    altMarks.appendChild(tick);
    if (y % 100 === 0) {
      const lab = document.createElement("i");
      lab.className = "sf-alt__label";
      lab.textContent = String(y);
      lab.style.top = `${altFrac(y) * 100}%`;
      altMarks.appendChild(lab);
    }
  }
  for (const id of STATION_ORDER) {
    const dot = document.createElement("i");
    dot.className = "sf-alt__stn";
    dot.style.top = `${altFrac(STATIONS[id].padY) * 100}%`;
    dot.style.background = STATION_COLOUR[id] || "#cfe0f4";
    dot.title = STATIONS[id].name;
    altMarks.appendChild(dot);
  }

  /* ------------------------- the map raster -------------------------
     Baked ONCE into an offscreen canvas at 240x240 (about 8.5m per
     pixel) and blitted per frame. The hillshade is 57,600 height
     samples; doing it per frame would cost more than the rest of
     the HUD put together and it never changes.
     ------------------------------------------------------------------ */

  const RAST = 240;
  const raster = document.createElement("canvas");
  raster.width = RAST;
  raster.height = RAST;
  {
    const rg = raster.getContext("2d");
    const img = rg.createImageData(RAST, RAST);
    const field = ctx.field;
    const toWorld = (i) => (i / (RAST - 1)) * MAP_SIZE - MAP_HALF;
    const SUN = [-0.72, 0.69];      // a raking light from the WNW, as the level's is
    for (let j = 0; j < RAST; j += 1) {
      const z = toWorld(j);
      for (let i = 0; i < RAST; i += 1) {
        const x = toWorld(i);
        const y = field.heightAt(x, z);
        /* NORMALISED AGAINST THE AUTHORED RANGE, not a measured
           one. See the header: hud.js's 168m ramp on a 468m level
           saturates every pixel and the map goes white. */
        const t = clamp01((y - ELEV_MIN) / (ELEV_MAX - ELEV_MIN));
        // Cheap slope shading off the two neighbours we already want.
        const e = 12;
        const dx = field.heightAt(x + e, z) - field.heightAt(x - e, z);
        const dz = field.heightAt(x, z + e) - field.heightAt(x, z - e);
        const shade = clamp01(0.5 + (dx * SUN[0] + dz * SUN[1]) / (e * 2.2));
        /* Cold at the bottom, warm at the top - the same story the
           level tells in three dimensions, told in two. */
        const r = lerp(28, 236, t) * lerp(0.55, 1.18, shade);
        const gg = lerp(42, 226, t) * lerp(0.58, 1.14, shade);
        const b = lerp(74, 214, t) * lerp(0.70, 1.06, shade);
        const o = (j * RAST + i) * 4;
        img.data[o] = clamp(r, 0, 255);
        img.data[o + 1] = clamp(gg, 0, 255);
        img.data[o + 2] = clamp(b, 0, 255);
        img.data[o + 3] = 255;
      }
    }
    rg.putImageData(img, 0, 0);

    // The Via Sacra, drawn once into the raster.
    rg.strokeStyle = "rgba(255,222,170,0.72)";
    rg.lineWidth = 1.6;
    rg.lineJoin = "round";
    rg.beginPath();
    VIA_SACRA_PATH.forEach((p, i) => {
      const px = ((p[0] + MAP_HALF) / MAP_SIZE) * RAST;
      const pz = ((p[1] + MAP_HALF) / MAP_SIZE) * RAST;
      if (i === 0) rg.moveTo(px, pz); else rg.lineTo(px, pz);
    });
    rg.stroke();
  }

  /* ---------------------------- state ---------------------------- */

  let current = null;
  let showFor = 0;
  let wholeMap = false;
  const fwdVec = new THREE.Vector3();

  function stationAt(x, z) {
    let best = null;
    let bestW = 0;
    for (const id of STATION_ORDER) {
      const s = STATIONS[id];
      const d = Math.hypot(x - s.x, z - s.z);
      const w = 1 - sstep(s.r * 0.55, s.r * 1.05, d);
      if (w > bestW) { bestW = w; best = { id, name: s.name }; }
    }
    return bestW > 0.02 ? best : null;
  }

  function drawMap(px, pz, heading, range) {
    const W = canvas.width;
    const half = W / 2;
    g2.clearRect(0, 0, W, W);
    g2.save();
    g2.beginPath();
    g2.arc(half, half, half - 2, 0, Math.PI * 2);
    g2.clip();

    const scale = wholeMap ? W / MAP_SIZE : W / (range * 2);
    const cx = wholeMap ? 0 : px;
    const cz = wholeMap ? 0 : pz;
    const sx = half - ((cx + MAP_HALF) / MAP_SIZE) * RAST * (MAP_SIZE / RAST) * scale;
    void sx;

    // Blit the baked raster, centred on the player (or the map).
    const drawW = MAP_SIZE * scale;
    g2.imageSmoothingEnabled = true;
    g2.drawImage(
      raster,
      half - ((cx + MAP_HALF) / MAP_SIZE) * drawW,
      half - ((cz + MAP_HALF) / MAP_SIZE) * drawW,
      drawW, drawW
    );

    const toPx = (x, z) => [
      half + (x - cx) * scale,
      half + (z - cz) * scale,
    ];

    // Stations.
    for (const id of STATION_ORDER) {
      const s = STATIONS[id];
      const [ax, az] = toPx(s.x, s.z);
      g2.fillStyle = STATION_COLOUR[id] || "#cfe0f4";
      g2.beginPath();
      g2.arc(ax, az, id === "summit" ? 5 : 3.4, 0, Math.PI * 2);
      g2.fill();
      if (wholeMap) {
        g2.fillStyle = "rgba(232,242,255,0.82)";
        g2.font = "600 9px ui-monospace,Menlo,monospace";
        g2.fillText(s.name.replace(/^The /, "").toUpperCase(), ax + 7, az + 3);
      }
    }

    // The player, as a heading wedge.
    const [mx, mz] = toPx(px, pz);
    g2.save();
    g2.translate(mx, mz);
    g2.rotate(-heading);
    g2.fillStyle = "#ffcf90";
    g2.beginPath();
    g2.moveTo(0, -6.5);
    g2.lineTo(4.2, 5);
    g2.lineTo(0, 2.6);
    g2.lineTo(-4.2, 5);
    g2.closePath();
    g2.fill();
    g2.restore();
    g2.restore();

    // Rim.
    g2.strokeStyle = "rgba(190,215,245,0.34)";
    g2.lineWidth = 2;
    g2.beginPath();
    g2.arc(half, half, half - 2, 0, Math.PI * 2);
    g2.stroke();
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

      // District banner.
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

      // Compass.
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

      // Altimeter.
      const f = altFrac(p.y);
      altMe.style.top = `${f * 100}%`;
      altRead.innerHTML = `${Math.round(p.y)}<small>METRES</small>`;

      // Map.
      const range = wholeMap ? MAP_HALF : 400;
      rangeEl.textContent = wholeMap ? "FULL" : `${range}M`;
      drawMap(p.x, p.z, fwd, range);

      if (readoutEl) {
        readoutEl.textContent =
          `${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}  ${s ? s.id : "-"}`;
      }

      updateKitDock(player);
    },
    commandDockState: () => ctx.command?.dockState?.() || null,
    kitDockState() {
      return {
        hp: kitEls.hpValue.textContent,
        hpState: kitEls.hp.dataset.state || null,
        charge: kitEls.chargeValue.textContent,
        ability: kitEls.ability.hidden ? null : {
          name: kitEls.abilityName.textContent,
          value: kitEls.abilityValue.textContent,
          state: kitEls.ability.dataset.state,
        },
        cast: kitEls.cast.hidden ? null : {
          value: kitEls.castValue.textContent,
          state: kitEls.cast.dataset.state,
        },
        doctrine: kitEls.doctrine.hidden ? null : {
          points: kitEls.doctrineValue.textContent,
          label: kitEls.doctrineName.textContent,
        },
      };
    },
    setVisible(v) { el.style.display = v ? "" : "none"; },
    flashDistrict(name) { nameEl.textContent = name; showFor = 5.2; },
    toggleMap(on) {
      wholeMap = on === undefined ? !wholeMap : !!on;
      canvas.parentElement.classList.toggle("is-whole", wholeMap);
      return wholeMap;
    },
    mapState: () => ({ wholeMap, elevRange: [ELEV_MIN, ELEV_MAX] }),
    /* hud.js's callers use these two; keep the names so anything
       shared between the levels does not have to branch. */
    start() {}, stop() {}, connect() {},
    damageNumberCount: () => 0,
  };
}
