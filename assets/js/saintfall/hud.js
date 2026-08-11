/* ============================================================
   SAINTFALL - heads-up display

   Deliberately thin. This build exists to be looked at, so the
   HUD's job is to name where you are and then get out of the way.
   Everything here can be hidden in one call, because a review
   frame with a HUD in it is a review of the HUD.
   ============================================================ */

import { clamp01, lerp } from "saintfall/core.js";

export function buildHud(ctx, host) {
  const el = host;
  el.innerHTML = `
    <div class="sf-hud__district" id="sf-district">
      <div class="sf-hud__eyebrow">Vesper-IX &middot; Operation The Gilded Silence</div>
      <div class="sf-hud__name" id="sf-district-name"></div>
    </div>
    <div class="sf-hud__compass" id="sf-compass">
      <div class="sf-hud__strip" id="sf-compass-strip"></div>
      <div class="sf-hud__needle"></div>
    </div>
    <div class="sf-hud__readout" id="sf-readout"></div>
    <div class="sf-hud__objective" id="sf-objective">
      <div class="sf-hud__objlabel" id="sf-objlabel"></div>
      <div class="sf-hud__objbar"><i id="sf-objbar"></i></div>
    </div>
    <div class="sf-hud__banner" id="sf-banner"></div>
    <div class="sf-hud__reticle" id="sf-reticle"><i></i><i></i><i></i><i></i></div>
    <div class="sf-hud__hurt" id="sf-hurt"></div>
    <div class="sf-hud__vitals" id="sf-vitals">
      <div class="sf-hud__hpwrap"><div class="sf-hud__hp" id="sf-hp"></div></div>
      <div class="sf-hud__jet" id="sf-jet" role="progressbar" aria-label="Jetpack lift charge"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
        <div class="sf-hud__jetlabel"><span>LIFT CHARGE</span><b id="sf-jet-value">100%</b></div>
        <div class="sf-hud__jettrack"><i id="sf-jet-fill"></i></div>
      </div>
      <div class="sf-hud__vitalrow">
        <span id="sf-ammo">&mdash;</span>
        <span id="sf-reinf"></span>
      </div>
    </div>
    <div class="sf-hud__strat" id="sf-strat"></div>
    <div class="sf-hud__code" id="sf-code"></div>
    <div class="sf-hud__hint" id="sf-hint">
      <b>WASD</b> move &middot; <b>Shift</b> sprint &middot; <b>Ctrl</b> crouch &middot;
      <b>Space</b> vault &middot; <b>Shift+Space</b> jetpack &middot; <b>Ctrl</b> descend &middot;
      <b>LMB</b> fire &middot; <b>RMB</b> aim &middot;
      <b>Q</b> lance rite &middot; <b>R</b> reload &middot; <b>V</b>+arrows stratagem &middot;
      <b>M</b> mute &middot; <b>K</b> show colliders &middot; <b>1&ndash;5</b> time of day &middot; <b>F</b> free camera
    </div>
  `;

  const districtEl = el.querySelector("#sf-district");
  const nameEl = el.querySelector("#sf-district-name");
  const stripEl = el.querySelector("#sf-compass-strip");
  const readoutEl = el.querySelector("#sf-readout");
  const hintEl = el.querySelector("#sf-hint");
  const objEl = el.querySelector("#sf-objective");
  const objLabelEl = el.querySelector("#sf-objlabel");
  const objBarEl = el.querySelector("#sf-objbar");
  const bannerEl = el.querySelector("#sf-banner");
  const hpEl = el.querySelector("#sf-hp");
  const jetEl = el.querySelector("#sf-jet");
  const jetFillEl = el.querySelector("#sf-jet-fill");
  const jetValueEl = el.querySelector("#sf-jet-value");
  const ammoEl = el.querySelector("#sf-ammo");
  const reinfEl = el.querySelector("#sf-reinf");
  const stratEl = el.querySelector("#sf-strat");
  const codeEl = el.querySelector("#sf-code");
  const hurtEl = el.querySelector("#sf-hurt");
  const reticleEl = el.querySelector("#sf-reticle");

  // One node per stratagem, built once. Rebuilding this markup every
  // frame is the classic way to make a HUD cost more than the scene.
  const stratNodes = [];
  if (ctx.mission) {
    for (const [key, spec] of Object.entries(ctx.mission.stratagems)) {
      const node = document.createElement("div");
      node.className = "sf-hud__stratitem";
      node.innerHTML = `<b>${spec.name}</b><span>${spec.code
        .map((d) => ({ up: "&uarr;", down: "&darr;", left: "&larr;", right: "&rarr;" }[d]))
        .join("")}</span><i></i>`;
      stratEl.appendChild(node);
      stratNodes.push({ key, spec, node, fill: node.querySelector("i") });
    }
  }
  let lastHurt = -99;

  /* --- compass ticks --- */
  const marks = [
    { a: 0, label: "N" }, { a: 45, label: "NE" }, { a: 90, label: "E" },
    { a: 135, label: "SE" }, { a: 180, label: "S" }, { a: 225, label: "SW" },
    { a: 270, label: "W" }, { a: 315, label: "NW" },
  ];
  const tickEls = [];
  for (const m of marks) {
    const t = document.createElement("span");
    t.className = "sf-hud__tick";
    t.textContent = m.label;
    stripEl.appendChild(t);
    tickEls.push({ ...m, node: t });
  }
  const poiEls = [];
  for (const poi of ctx.world.pois) {
    const t = document.createElement("span");
    t.className = "sf-hud__poi";
    t.textContent = poi.name;
    stripEl.appendChild(t);
    poiEls.push({ poi, node: t });
  }

  let current = null;
  let showFor = 0;
  let hintFade = 14;
  const fwdVec = new ctx.THREE.Vector3();

  function districtAt(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const [key, d] of Object.entries(ctx.districts)) {
      const dist = Math.hypot(x - d.x, z - d.z);
      if (dist < d.r * 0.95 && dist < bestD) { bestD = dist; best = { key, ...d }; }
    }
    return best;
  }

  return {
    el,
    update(dt, player, camera) {
      const p = player.position;
      const d = districtAt(p.x, p.z);
      const key = d ? d.key : null;
      if (key !== current) {
        current = key;
        showFor = d ? 5.2 : 0;
        if (d) nameEl.textContent = d.name;
      }
      showFor = Math.max(0, showFor - dt);
      districtEl.style.opacity = String(clamp01(showFor > 4.4 ? (5.2 - showFor) / 0.8 : showFor / 1.4));

      hintFade = Math.max(0, hintFade - dt);
      hintEl.style.opacity = String(clamp01(hintFade / 2.5));

      // Compass. Bearings are screen-space offsets from the camera's
      // forward vector, clamped to the strip.
      camera.getWorldDirection(fwdVec);
      const fwd = Math.atan2(fwdVec.x, fwdVec.z);
      const half = 62;
      const layout = (angleRad, node) => {
        let delta = ((angleRad - fwd) * 180) / Math.PI;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        if (Math.abs(delta) > half) { node.style.opacity = "0"; return; }
        node.style.left = `${50 + (delta / half) * 50}%`;
        node.style.opacity = String(clamp01(1 - Math.abs(delta) / half * 0.85));
      };
      for (const t of tickEls) layout((t.a * Math.PI) / 180, t.node);
      for (const { poi, node } of poiEls) {
        const bearing = Math.atan2(poi.x - p.x, poi.z - p.z);
        const dist = Math.hypot(poi.x - p.x, poi.z - p.z);
        layout(bearing, node);
        node.style.fontSize = `${lerp(11, 8, clamp01(dist / 1400))}px`;
      }

      readoutEl.textContent = `${Math.round(p.x)} , ${Math.round(p.z)}   ·   ${Math.round(p.y)}m`;

      const jet = ctx.jetpack?.status?.(player.state);
      if (jet) {
        const fuelN = clamp01(jet.fuel / jet.maxFuel);
        const value = Math.round(fuelN * 100);
        jetFillEl.style.transform = `scaleX(${fuelN})`;
        jetValueEl.textContent = jet.lockedOut && jet.requested ? `${value}% · RELEASE`
          : jet.mode === "thrust" ? `${value}% · THRUST`
            : jet.mode === "glide" ? `${value}% · GLIDE`
              : jet.mode === "empty" ? `${value}% · EMPTY`
                : jet.mode === "recharging" ? `${value}% · CHARGING`
                  : jet.mode === "cooldown" ? `${value}% · COOLING`
                    : jet.mode === "low" ? `${value}% · LOW` : `${value}%`;
        jetEl.dataset.state = fuelN <= 0.18 ? "crit" : jet.mode;
        jetEl.setAttribute("aria-valuenow", String(value));
        jetEl.setAttribute("aria-valuetext", `${value} percent, ${jet.mode}`);
      }

      /* --- combat --- */
      const combat = ctx.combat;
      const mission = ctx.mission;
      if (!combat || !mission) return;

      const hp = clamp01(combat.player.hp / combat.player.maxHp);
      hpEl.style.width = `${hp * 100}%`;
      // Colour is a threshold, not a gradient. A bar that slides
      // continuously from green to red never reads as "you are in
      // trouble NOW" - it just reads as slightly different.
      hpEl.dataset.state = hp > 0.6 ? "ok" : hp > 0.28 ? "warn" : "crit";

      if (combat.player.lastHitAt !== lastHurt) {
        lastHurt = combat.player.lastHitAt;
        hurtEl.classList.remove("is-hit");
        // Reflow, or the animation does not restart on a second hit
        // inside its own duration - which is exactly when it matters.
        void hurtEl.offsetWidth;
        hurtEl.classList.add("is-hit");
      }

      const weapon = ctx.weapons && ctx.weapons.current;
      if (weapon) {
        const mag = ctx.weapons.ammo ? ctx.weapons.ammo() : null;
        ammoEl.innerHTML = mag
          ? `<b>${mag.mag}</b> / ${mag.reserve}${mag.reloading ? " &middot; RELOADING" : ""}`
          : "&mdash;";
      }
      reinfEl.textContent = `REINFORCEMENTS ${mission.state.reinforcements}`;

      const obj = mission.objective();
      if (obj) {
        objEl.style.opacity = "1";
        objLabelEl.textContent = `${obj.name}  ·  ${Math.round(obj.dist)}m`;
        objBarEl.style.width = `${(obj.progress || 0) * 100}%`;
      } else {
        objEl.style.opacity = "0";
      }

      bannerEl.textContent = mission.state.banner || "";
      bannerEl.style.opacity = mission.state.banner ? "1" : "0";

      for (const s of stratNodes) {
        const cd = mission.cooldowns[s.key];
        s.fill.style.width = `${clamp01(1 - cd / s.spec.cooldown) * 100}%`;
        s.node.dataset.ready = cd <= 0 ? "1" : "0";
      }

      if (mission.entry.active) {
        codeEl.style.opacity = "1";
        codeEl.innerHTML = mission.entry.keys
          .map((d) => `<b>${{ up: "&uarr;", down: "&darr;", left: "&larr;", right: "&rarr;" }[d]}</b>`)
          .join("") || "<b>&hellip;</b>";
      } else {
        codeEl.style.opacity = "0";
      }

      /* The lance is drawn for the airborne silhouette, but firing is
         deliberately disabled during boosted traversal. Hide the
         shooting affordance until the boots are back down. */
      reticleEl.style.opacity = combat.player.dead || jet?.inFlight ? "0" : "1";
    },
    setVisible(v) { el.style.display = v ? "" : "none"; },
    flashDistrict(name) { nameEl.textContent = name; showFor = 5.2; },
  };
}
