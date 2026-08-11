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
      <div class="sf-hud__eyebrow">VESPER-IX &middot; OPERATION THE GILDED SILENCE</div>
      <div class="sf-hud__name" id="sf-district-name"></div>
    </div>
    <div class="sf-hud__compass" id="sf-compass">
      <span class="sf-hud__compass-label" aria-hidden="true">BEARING</span>
      <div class="sf-hud__strip" id="sf-compass-strip"></div>
      <div class="sf-hud__needle"></div>
    </div>
    ${ctx.qa ? '<output class="sf-hud__readout" id="sf-readout" aria-label="QA world coordinates"></output>' : ""}
    <aside class="sf-hud__minimap" id="sf-minimap" aria-label="Tactical mini-map">
      <div class="sf-minimap__head">
        <span><small>VESPER TACTICAL</small><strong>NORTH-UP</strong></span>
        <b id="sf-map-range">180M</b>
      </div>
      <canvas id="sf-map-canvas" width="280" height="280" aria-hidden="true"></canvas>
      <div class="sf-minimap__event" id="sf-map-event" data-phase="dormant">
        <div class="sf-minimap__event-head">
          <span class="sf-minimap__event-title">
            <small id="sf-event-kicker">BLOOM PRESSURE</small>
            <strong id="sf-event-name">SIGNAL QUIET</strong>
          </span>
          <b id="sf-event-count">STANDBY</b>
        </div>
        <small id="sf-event-sub">SIGNAL QUIET</small>
        <i><em id="sf-event-fill"></em></i>
      </div>
    </aside>
    <div class="sf-hud__objective" id="sf-objective">
      <div class="sf-hud__objhead">
        <span>PRIMARY DIRECTIVE</span>
        <div class="sf-hud__objlabel" id="sf-objlabel"></div>
      </div>
      <div class="sf-hud__objbar"><i id="sf-objbar"></i></div>
    </div>
    <div class="sf-hud__banner" id="sf-banner"></div>
    <div class="sf-hud__breach-alert" id="sf-breach-alert" aria-live="polite">
      <small id="sf-breach-kicker"></small><strong id="sf-breach-title"></strong>
    </div>
    <div class="sf-hud__reticle" id="sf-reticle"><i></i><i></i><i></i><i></i></div>
    <div class="sf-hud__hurt" id="sf-hurt"></div>
    <div class="sf-hud__numbers" id="sf-damage-numbers" aria-hidden="true"></div>
    <div class="sf-hud__vitals" id="sf-vitals">
      <div class="sf-hud__hplabel"><span>VITALITY</span><b id="sf-hp-value">150 / 150</b></div>
      <div class="sf-hud__hpwrap"><div class="sf-hud__hp" id="sf-hp"></div></div>
      <div class="sf-hud__jet" id="sf-jet" role="progressbar" aria-label="Reliquary charge"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
        <div class="sf-hud__jetlabel"><span>RELIQUARY CHARGE</span><b id="sf-jet-value">100%</b></div>
        <div class="sf-hud__jettrack"><i id="sf-jet-fill"></i></div>
        <div class="sf-hud__boost" id="sf-boost"><span><b>E</b> BOOST SLIDE</span><strong id="sf-boost-value">READY</strong></div>
        <div class="sf-hud__shield" id="sf-shield"><span><b>X</b> AEGIS BLOCK</span><strong id="sf-shield-value">READY</strong></div>
      </div>
      <div class="sf-hud__vitalrow">
        <span id="sf-ammo">&mdash;</span>
        <span id="sf-reinf"></span>
      </div>
    </div>
    <section class="sf-hud__command" id="sf-command-status" aria-label="Command availability">
      <header class="sf-hud__command-head">
        <span>RELIQUARY COMMAND</span>
        <strong><kbd>TAB</kbd> HOLD</strong>
      </header>
      <div class="sf-hud__strat" id="sf-strat"></div>
    </section>
    <div class="sf-hud__hint" id="sf-hint">
      <span><kbd>TAB</kbd> <b>HOLD COMMAND WHEEL</b></span>
      <i aria-hidden="true"></i>
      <span><kbd>ESC</kbd> <b>FIELD MENU</b></span>
    </div>
  `;

  const districtEl = el.querySelector("#sf-district");
  const nameEl = el.querySelector("#sf-district-name");
  const stripEl = el.querySelector("#sf-compass-strip");
  const readoutEl = el.querySelector("#sf-readout");
  const minimapEl = el.querySelector("#sf-minimap");
  const mapCanvas = el.querySelector("#sf-map-canvas");
  const mapRangeEl = el.querySelector("#sf-map-range");
  const mapEventEl = el.querySelector("#sf-map-event");
  const eventKickerEl = el.querySelector("#sf-event-kicker");
  const eventNameEl = el.querySelector("#sf-event-name");
  const eventCountEl = el.querySelector("#sf-event-count");
  const eventSubEl = el.querySelector("#sf-event-sub");
  const eventFillEl = el.querySelector("#sf-event-fill");
  const hintEl = el.querySelector("#sf-hint");
  const objEl = el.querySelector("#sf-objective");
  const objLabelEl = el.querySelector("#sf-objlabel");
  const objBarEl = el.querySelector("#sf-objbar");
  const bannerEl = el.querySelector("#sf-banner");
  const breachAlertEl = el.querySelector("#sf-breach-alert");
  const breachKickerEl = el.querySelector("#sf-breach-kicker");
  const breachTitleEl = el.querySelector("#sf-breach-title");
  const hpEl = el.querySelector("#sf-hp");
  const hpValueEl = el.querySelector("#sf-hp-value");
  const jetEl = el.querySelector("#sf-jet");
  const jetFillEl = el.querySelector("#sf-jet-fill");
  const jetValueEl = el.querySelector("#sf-jet-value");
  const boostEl = el.querySelector("#sf-boost");
  const boostValueEl = el.querySelector("#sf-boost-value");
  const shieldEl = el.querySelector("#sf-shield");
  const shieldValueEl = el.querySelector("#sf-shield-value");
  const ammoEl = el.querySelector("#sf-ammo");
  const reinfEl = el.querySelector("#sf-reinf");
  const stratEl = el.querySelector("#sf-strat");
  const hurtEl = el.querySelector("#sf-hurt");
  const reticleEl = el.querySelector("#sf-reticle");
  const damageLayerEl = el.querySelector("#sf-damage-numbers");

  /* Damage numbers subscribe to the health mutation itself, not to
     weapon hit effects. If a number appears, `combat.applyDamage`
     already changed the target's health in that same call. */
  const damageNumbers = [];
  const damageWorld = new ctx.THREE.Vector3();
  let damageSequence = 0;
  ctx.combat?.bus?.on("enemyDamaged", (event) => {
    if (!event || !Number.isFinite(event.damage)) return;
    while (damageNumbers.length >= 32) {
      damageNumbers.shift().node.remove();
    }
    const node = document.createElement("span");
    node.className = "sf-damage-number";
    if (event.head) node.classList.add("is-head");
    if (event.weak) node.classList.add("is-weak");
    if (event.killed) node.classList.add("is-kill");
    if (event.source === "boost") node.classList.add("is-boost");
    node.textContent = `${event.weak ? "✦" : ""}${Math.max(1, Math.round(event.damage))}`;
    damageLayerEl.appendChild(node);
    damageSequence += 1;
    damageNumbers.push({
      node,
      x: event.x,
      y: event.y,
      z: event.z,
      age: 0,
      life: event.killed ? 1.05 : 0.86,
      drift: ((damageSequence % 5) - 2) * 7,
    });
  });

  /* Compact readiness sigils replace the old on-screen direction cards.
     The wheel owns selection; this dock only answers the question a player
     needs before opening it: what is available right now? */
  const commandSigil = (key) => ({
    orbital: `
      <svg viewBox="0 0 32 32" focusable="false" aria-hidden="true">
        <path d="M16 2v8M11 6l5 5 5-5M16 12v17"/>
        <path d="M7 25h18M10 29h12"/>
      </svg>`,
    cluster: `
      <svg viewBox="0 0 32 32" focusable="false" aria-hidden="true">
        <path d="M16 3v9M12 8l4 4 4-4"/>
        <circle cx="8" cy="23" r="3"/><circle cx="16" cy="26" r="3"/><circle cx="24" cy="23" r="3"/>
      </svg>`,
    resupply: `
      <svg viewBox="0 0 32 32" focusable="false" aria-hidden="true">
        <path d="M16 2v8M12 6l4 4 4-4"/>
        <path d="M7 13h18v15H7zM16 16v9M11.5 20.5h9"/>
      </svg>`,
  }[key] || `
    <svg viewBox="0 0 32 32" focusable="false" aria-hidden="true">
      <circle cx="16" cy="16" r="11"/><path d="M16 9v14M9 16h14"/>
    </svg>`);

  // One node per command, built once. Rebuilding this markup every
  // frame is the classic way to make a HUD cost more than the scene.
  const stratNodes = [];
  if (ctx.mission) {
    const order = Array.isArray(ctx.mission.wheelOrder)
      ? ctx.mission.wheelOrder : Object.keys(ctx.mission.stratagems);
    for (const key of order.slice(0, 3)) {
      const spec = ctx.mission.stratagems[key];
      if (!spec) continue;
      const node = document.createElement("div");
      node.className = "sf-hud__stratitem";
      node.dataset.command = key;
      node.style.setProperty("--sf-command-colour", spec.colour || "#d8a441");
      node.setAttribute("aria-label", `${spec.name}, ready`);
      node.innerHTML = `
        <span class="sf-hud__stratglyph">${commandSigil(key)}</span>
        <span class="sf-hud__stratcopy">
          <b>${spec.name}</b>
          <small>${spec.role || "Reliquary support"}</small>
        </span>
        <strong class="sf-hud__stratstatus">READY</strong>
        <i class="sf-hud__stratfill" aria-hidden="true"></i>`;
      stratEl.appendChild(node);
      stratNodes.push({
        key,
        spec,
        node,
        fill: node.querySelector(".sf-hud__stratfill"),
        status: node.querySelector(".sf-hud__stratstatus"),
      });
    }
  }
  let lastHurt = -99;
  let breachAlertFor = 0;

  function showBreachAlert(kicker, title, seconds = 3.2, boss = false) {
    breachKickerEl.textContent = kicker;
    breachTitleEl.textContent = title;
    breachAlertEl.dataset.boss = boss ? "1" : "0";
    breachAlertEl.classList.add("is-shown");
    breachAlertFor = seconds;
  }

  if (ctx.breaches?.bus) {
    ctx.breaches.bus.on("warning", (event) => showBreachAlert(
      `BLOOM BREACH ${event.wave} / ${event.waveCount}`, event.name.toUpperCase(), 3.4));
    ctx.breaches.bus.on("bossWarning", () => showBreachAlert(
      "APEX SIGNATURE", "MATRIARCH ASCENDANT", 4.8, true));
    ctx.breaches.bus.on("opened", (event) => showBreachAlert(
      "BREACH OPEN", `${event.remaining} HOSTILES SURFACING`, 2.5, !!event.boss));
    ctx.breaches.bus.on("cleared", () => showBreachAlert(
      "FIELD UPDATE", "BREACH SEALED", 2.6));
    ctx.breaches.bus.on("complete", () => showBreachAlert(
      "VESPER COMMAND", "BLOOM SIGNAL SEVERED", 5.2));
  }

  /* --- compass ticks --- */
  /* Player/camera yaw zero points toward authored +Z, which is south on
     Vesper-IX. Authored north is -Z (pi), east is +X (pi / 2). */
  const marks = [
    { a: 0, label: "S" }, { a: 45, label: "SE" }, { a: 90, label: "E" },
    { a: 135, label: "NE" }, { a: 180, label: "N" }, { a: 225, label: "NW" },
    { a: 270, label: "W" }, { a: 315, label: "SW" },
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
  const map2d = mapCanvas.getContext("2d");
  let mapTick = 0;
  let mapDrawSeq = 0;
  const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
  const mapNumber = (value) => Number(value.toFixed(3));
  let minimapSemantic = {
    drawSeq: 0,
    worldRotation: 0,
    bodyYaw: 0,
    cameraYaw: 0,
    arrowYaw: 0,
    arrowCanvasYaw: Math.PI,
    north: {
      axis: "-Z",
      worldYaw: Math.PI,
      canvasYaw: 0,
      x: null,
      y: null,
    },
    contacts: [],
  };

  function drawMinimap(player) {
    const bounds = mapCanvas.getBoundingClientRect();
    if (!map2d || bounds.width < 2 || bounds.height < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(bounds.width * dpr));
    const height = Math.max(1, Math.round(bounds.height * dpr));
    if (mapCanvas.width !== width || mapCanvas.height !== height) {
      mapCanvas.width = width;
      mapCanvas.height = height;
    }
    map2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    map2d.clearRect(0, 0, bounds.width, bounds.height);

    const w = bounds.width;
    const h = bounds.height;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const radius = Math.max(12, Math.min(w, h) * 0.455);
    const ps = player.state;
    const event = ctx.breaches?.status?.();
    const activeEvent = event && (event.phase === "warning" || event.phase === "active");
    const mapRange = activeEvent
      ? Math.max(180, Math.min(420, (event.distance || 0) * 1.18 + 26))
      : 180;
    mapRangeEl.textContent = `${Math.round(mapRange)}M`;
    const bodyYaw = wrapAngle(Number.isFinite(ps.yaw) ? ps.yaw : 0);
    const cameraYaw = wrapAngle(Number.isFinite(ps.camYaw) ? ps.camYaw : bodyYaw);
    /* The glyph is authored pointing toward canvas-up. In world space yaw
       zero faces +Z (south, canvas-down), so body yaw maps to canvas rotation
       pi - yaw. Camera orbit never participates in this transform. */
    const arrowCanvasYaw = wrapAngle(Math.PI - bodyYaw);
    const contacts = [];

    const point = (x, z, edge = false) => {
      const dx = x - ps.x;
      const dz = z - ps.z;
      const dist = Math.hypot(dx, dz);
      const limit = edge ? Math.min(1, (mapRange * 0.93) / Math.max(1e-4, dist)) : 1;
      return {
        x: cx + (dx * limit / mapRange) * radius,
        // Authored north is -Z, so negative Z belongs at canvas-up.
        y: cy + (dz * limit / mapRange) * radius,
        inside: dist <= mapRange,
        dist,
      };
    };
    const recordContact = (type, id, x, z, p, details = {}) => {
      contacts.push({
        type,
        id: String(id),
        worldX: mapNumber(x),
        worldZ: mapNumber(z),
        canvasX: mapNumber(p.x),
        canvasY: mapNumber(p.y),
        inside: !!p.inside,
        ...details,
      });
    };

    map2d.save();
    map2d.beginPath();
    map2d.arc(cx, cy, radius, 0, Math.PI * 2);
    map2d.clip();
    const bg = map2d.createRadialGradient(cx, cy, 2, cx, cy, radius);
    bg.addColorStop(0, "rgba(28,20,17,.78)");
    bg.addColorStop(0.68, "rgba(14,10,11,.86)");
    bg.addColorStop(1, "rgba(5,4,6,.96)");
    map2d.fillStyle = bg;
    map2d.fillRect(0, 0, w, h);

    map2d.lineWidth = 1;
    for (const fraction of [0.33, 0.66, 1]) {
      map2d.beginPath();
      map2d.arc(cx, cy, radius * fraction, 0, Math.PI * 2);
      map2d.strokeStyle = fraction === 1 ? "rgba(225,169,73,.50)" : "rgba(225,169,73,.13)";
      map2d.stroke();
    }
    map2d.strokeStyle = "rgba(225,169,73,.11)";
    map2d.beginPath(); map2d.moveTo(cx, cy - radius); map2d.lineTo(cx, cy + radius); map2d.stroke();
    map2d.beginPath(); map2d.moveTo(cx - radius, cy); map2d.lineTo(cx + radius, cy); map2d.stroke();

    // Nearby authored landmarks make this a map rather than only a
    // threat detector. Labels stay off the tiny surface; silhouettes
    // and the compass already carry their names.
    map2d.fillStyle = "rgba(224,214,188,.36)";
    for (const [poiIndex, poi] of (ctx.world.pois || []).entries()) {
      const p = point(poi.x, poi.z);
      if (!p.inside) continue;
      recordContact("poi", poi.key || poi.name || poiIndex, poi.x, poi.z, p);
      map2d.fillRect(p.x - 1, p.y - 1, 2, 2);
    }

    for (const [relayIndex, relay] of (ctx.mission?.relays || []).entries()) {
      const p = point(relay.x, relay.z);
      if (!p.inside) continue;
      recordContact("relay", relay.key || relayIndex, relay.x, relay.z, p, {
        done: !!relay.done,
      });
      map2d.save();
      map2d.translate(p.x, p.y);
      map2d.rotate(Math.PI * 0.25);
      map2d.fillStyle = relay.done ? "rgba(106,217,174,.58)" : "#f0ad4b";
      map2d.fillRect(-2.5, -2.5, 5, 5);
      map2d.restore();
    }

    const pulse = 0.5 + Math.sin(ctx.atmos.elapsed * 6.4) * 0.5;
    for (const [enemyIndex, inst] of ctx.enemies.live.entries()) {
      if (!inst || inst.state === "death") continue;
      const p = point(inst.x, inst.z);
      if (!p.inside) continue;
      const eventUnit = !!inst.eventId;
      recordContact("enemy", inst.id || `${inst.key || "unit"}-${enemyIndex}`,
        inst.x, inst.z, p, {
          species: inst.key || "unknown",
          event: eventUnit,
          emerging: !!inst.emerging?.active,
        });
      const size = inst.key === "matriarch" ? 5.5
        : inst.key === "harrow" ? 3.4 : inst.key === "gleaner" ? 2.5 : 1.7;
      map2d.fillStyle = inst.emerging?.active
        ? `rgba(255,172,61,${0.45 + pulse * 0.5})`
        : eventUnit ? "#ff6843" : "rgba(221,111,60,.72)";
      if (inst.key === "matriarch") {
        map2d.save();
        map2d.translate(p.x, p.y);
        map2d.rotate(Math.PI * 0.25);
        map2d.fillRect(-size, -size, size * 2, size * 2);
        map2d.restore();
      } else {
        map2d.beginPath();
        map2d.arc(p.x, p.y, size + (inst.emerging?.active ? pulse * 1.4 : 0), 0, Math.PI * 2);
        map2d.fill();
      }
    }

    const objective = ctx.mission?.objective?.();
    if (objective && !objective.event) {
      const p = point(objective.x, objective.z, true);
      recordContact("objective", objective.name || "mission", objective.x, objective.z, p, {
        edge: !p.inside,
      });
      map2d.save();
      map2d.translate(p.x, p.y);
      map2d.rotate(Math.PI * 0.25);
      map2d.strokeStyle = "#ffe29a";
      map2d.lineWidth = 1.4;
      map2d.strokeRect(-3.5, -3.5, 7, 7);
      map2d.restore();
    }

    if (activeEvent) {
      const p = point(event.x, event.z, true);
      recordContact("breach", event.serial || event.name || "active",
        event.x, event.z, p, { edge: !p.inside, phase: event.phase });
      map2d.beginPath();
      map2d.arc(p.x, p.y, 7 + pulse * 3, 0, Math.PI * 2);
      map2d.strokeStyle = `rgba(255,101,58,${0.55 + pulse * 0.35})`;
      map2d.lineWidth = 1.5;
      map2d.stroke();
    }
    map2d.restore();

    // The map keeps a fixed, true north-up world orientation. Only the player
    // body arrow turns; orbiting the camera cannot rotate either layer.
    map2d.save();
    map2d.translate(cx, cy);
    map2d.rotate(arrowCanvasYaw);
    map2d.fillStyle = "#fff0bf";
    map2d.shadowColor = "rgba(255,188,75,.8)";
    map2d.shadowBlur = 5;
    map2d.beginPath();
    map2d.moveTo(0, -7); map2d.lineTo(4.2, 5); map2d.lineTo(0, 2.4); map2d.lineTo(-4.2, 5);
    map2d.closePath(); map2d.fill();
    map2d.restore();

    const north = point(ps.x, ps.z - mapRange * 0.82, true);
    map2d.fillStyle = "rgba(255,224,159,.68)";
    map2d.font = "600 8px Share Tech Mono, monospace";
    map2d.textAlign = "center";
    map2d.fillText("N", north.x, north.y + 3);

    mapDrawSeq += 1;
    minimapSemantic = {
      drawSeq: mapDrawSeq,
      worldRotation: 0,
      bodyYaw,
      cameraYaw,
      arrowYaw: bodyYaw,
      arrowCanvasYaw,
      north: {
        axis: "-Z",
        worldYaw: Math.PI,
        canvasYaw: 0,
        x: mapNumber(north.x),
        y: mapNumber(north.y),
      },
      contacts,
    };
  }

  function updateBreachReadout() {
    const event = ctx.breaches?.status?.();
    if (!event) { minimapEl.dataset.event = "0"; return; }
    mapEventEl.dataset.phase = event.phase;
    minimapEl.dataset.event = event.phase === "warning" || event.phase === "active" ? "1" : "0";
    eventKickerEl.textContent = event.complete ? "BLOOM STATUS"
      : event.wave > 0 ? `BREACH ${event.wave} / ${event.waveCount}` : "BLOOM PRESSURE";
    eventNameEl.textContent = event.complete ? "SIGNAL SEVERED"
      : event.wave > 0 ? event.name : "SIGNAL QUIET";
    eventNameEl.title = eventNameEl.textContent;
    eventSubEl.textContent = event.subtitle;
    if (event.phase === "dormant") eventCountEl.textContent = `${Math.ceil(event.timer)}S`;
    else if (event.phase === "warning") eventCountEl.textContent = `IN ${event.timer.toFixed(1)}S`;
    else if (event.phase === "active") eventCountEl.textContent = event.boss
      ? `${event.boss.health} HP` : `${event.remaining} LEFT`;
    else if (event.phase === "intermission") eventCountEl.textContent = `${Math.ceil(event.timer)}S`;
    else eventCountEl.textContent = "CLEAR";

    let progress = 0;
    if (event.boss) progress = 1 - event.boss.health / Math.max(1, event.boss.maxHealth);
    else if (event.phase === "active" && event.total) progress = 1 - event.remaining / event.total;
    else if (event.phase === "warning") progress = 1 - event.timer / ctx.breaches.config.warningSeconds;
    else if (event.phase === "intermission") progress = 1 - event.timer / ctx.breaches.config.intermissionSeconds;
    else if (event.complete) progress = 1;
    eventFillEl.style.width = `${clamp01(progress) * 100}%`;
  }

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

      breachAlertFor = Math.max(0, breachAlertFor - dt);
      if (breachAlertFor <= 0) breachAlertEl.classList.remove("is-shown");

      // Compass. Bearings are screen-space offsets from the camera's
      // forward vector, clamped to the strip.
      camera.getWorldDirection(fwdVec);
      const fwd = Math.atan2(fwdVec.x, fwdVec.z);
      const half = 62;
      const screenBearing = (angleRad) => {
        let delta = ((angleRad - fwd) * 180) / Math.PI;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        if (Math.abs(delta) > half) return null;
        return {
          left: 50 + (delta / half) * 50,
          opacity: clamp01(1 - Math.abs(delta) / half * 0.85),
        };
      };
      const layout = (angleRad, node) => {
        const screen = screenBearing(angleRad);
        if (!screen) { node.style.opacity = "0"; return; }
        node.style.left = `${screen.left}%`;
        node.style.opacity = String(screen.opacity);
      };
      for (const t of tickEls) layout((t.a * Math.PI) / 180, t.node);
      /* Eleven district names inside a 29rem compass become one
         unreadable word when several share a bearing. Keep only the
         three nearest, screen-separated landmarks; the tactical map
         carries the full field picture. */
      const poiCandidates = [];
      for (const { poi, node } of poiEls) {
        const bearing = Math.atan2(poi.x - p.x, poi.z - p.z);
        const dist = Math.hypot(poi.x - p.x, poi.z - p.z);
        const screen = screenBearing(bearing);
        node.style.opacity = "0";
        if (screen) poiCandidates.push({ node, dist, screen });
      }
      poiCandidates.sort((a, b) => a.dist - b.dist);
      const occupied = [];
      for (const candidate of poiCandidates) {
        if (occupied.length >= 3
          || occupied.some((left) => Math.abs(left - candidate.screen.left) < 17)) continue;
        occupied.push(candidate.screen.left);
        candidate.node.style.left = `${candidate.screen.left}%`;
        candidate.node.style.opacity = String(candidate.screen.opacity * 0.78);
        candidate.node.style.fontSize = `${lerp(11, 9, clamp01(candidate.dist / 1400))}px`;
      }

      if (readoutEl) {
        readoutEl.textContent = `${Math.round(p.x)} , ${Math.round(p.z)}   ·   ${Math.round(p.y)}m`;
      }

      mapTick -= dt;
      if (mapTick <= 0) {
        mapTick = 0.05;
        updateBreachReadout();
        drawMinimap(player);
      }

      /* Project world impacts after the camera has settled for this
         frame. DOM text stays pin-sharp while its anchor follows the
         creature and naturally disappears behind the camera. */
      const hudW = el.clientWidth || 1;
      const hudH = el.clientHeight || 1;
      for (let i = damageNumbers.length - 1; i >= 0; i -= 1) {
        const item = damageNumbers[i];
        item.age += dt;
        if (item.age >= item.life) {
          item.node.remove();
          damageNumbers.splice(i, 1);
          continue;
        }
        damageWorld.set(item.x, item.y + item.age * 0.52, item.z).project(camera);
        const visible = damageWorld.z > -1 && damageWorld.z < 1
          && Math.abs(damageWorld.x) < 1.14 && Math.abs(damageWorld.y) < 1.14;
        item.node.style.display = visible ? "" : "none";
        if (!visible) continue;
        const t = clamp01(item.age / item.life);
        item.node.style.left = `${(damageWorld.x * 0.5 + 0.5) * hudW}px`;
        item.node.style.top = `${(-damageWorld.y * 0.5 + 0.5) * hudH}px`;
        item.node.style.opacity = String(clamp01((1 - t) * 1.55));
        item.node.style.transform = `translate(-50%, -50%) translate(${item.drift * t}px, ${-30 * t}px) scale(${1 + (1 - t) * 0.18})`;
      }

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
      const boost = ctx.boost?.status?.();
      if (boost) {
        const lowCharge = jet && jet.fuel + 1e-6 < boost.fuelCost;
        boostEl.dataset.state = boost.active ? "active"
          : boost.cooldownRemaining > 0 ? "cooldown"
            : lowCharge ? "low" : "ready";
        boostValueEl.textContent = boost.active ? (boost.attack ? "IMPACT" : "SLIDE")
          : boost.cooldownRemaining > 0 ? `${boost.cooldownRemaining.toFixed(1)}S`
            : lowCharge ? "LOW CHARGE" : "READY";
      }
      const shield = ctx.shield?.status?.();
      if (shield) {
        const lowCharge = !jet || jet.fuel <= 1e-6;
        const release = shield.requested && shield.needsRelease;
        const locked = shield.requested && !shield.active && !lowCharge && !release;
        shieldEl.dataset.state = shield.active ? "active"
          : lowCharge ? "low" : locked ? "locked" : "ready";
        shieldValueEl.textContent = shield.active
          ? (shield.impact > 0.18 ? "ABSORB" : "BLOCKING")
          : release ? "RELEASE X" : lowCharge ? "LOW CHARGE" : locked ? "LOCKED" : "READY";
        if (shield.active && jet) {
          const value = Math.round(clamp01(jet.fuel / jet.maxFuel) * 100);
          jetValueEl.textContent = `${value}% · AEGIS`;
          jetEl.dataset.state = "shield";
          jetEl.setAttribute("aria-valuetext", `${value} percent, Aegis blocking`);
        }
      }

      /* --- combat --- */
      const combat = ctx.combat;
      const mission = ctx.mission;
      if (!combat || !mission) return;

      const hp = clamp01(combat.player.hp / combat.player.maxHp);
      hpEl.style.width = `${hp * 100}%`;
      hpValueEl.textContent = `${Math.ceil(combat.player.hp)} / ${combat.player.maxHp}`;
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
        const h = ctx.weapons.heatState ? ctx.weapons.heatState() : null;
        /* A percentage AND a bar. The number alone is unreadable in
           a firefight - nobody parses two digits while being charged
           - and the bar alone cannot say how close to the lockout
           you are once it is nearly full. The state word replaces
           the number when there IS no decision left to make. */
        if (!h) {
          ammoEl.innerHTML = "&mdash;";
        } else {
          const pct = Math.round(h.heat * 100);
          const state = h.overheated ? "OVERHEAT"
            : (h.venting ? "VENTING" : `${pct}%`);
          const cls = h.overheated ? " is-over" : (h.venting ? " is-venting" : "");
          ammoEl.innerHTML = `<span class="sf-heat${cls}">`
            + `<i class="sf-heat__track"><b style="width:${pct}%"></b></i>`
            + `<u>${state}</u></span>`;
        }
      }
      reinfEl.textContent = `REINFORCEMENTS ${mission.state.reinforcements}`;

      const obj = mission.objective();
      if (obj) {
        objEl.style.opacity = "1";
        objEl.dataset.event = obj.event ? "1" : "0";
        objLabelEl.textContent = `${obj.name}  ·  ${Math.round(obj.dist)}m`;
        objBarEl.style.width = `${(obj.progress || 0) * 100}%`;
      } else {
        objEl.style.opacity = "0";
        objEl.dataset.event = "0";
      }

      bannerEl.textContent = mission.state.banner || "";
      bannerEl.style.opacity = mission.state.banner ? "1" : "0";

      for (const s of stratNodes) {
        const cd = Math.max(0, Number(mission.cooldowns[s.key]) || 0);
        const ready = cd <= 0;
        const pct = s.spec.cooldown > 0
          ? clamp01(1 - cd / s.spec.cooldown) : 1;
        const status = ready ? "READY" : cd < 10 ? `${cd.toFixed(1)}S` : `${Math.ceil(cd)}S`;
        s.fill.style.width = `${pct * 100}%`;
        s.status.textContent = status;
        s.node.dataset.ready = ready ? "1" : "0";
        s.node.dataset.cooldown = ready ? "0" : String(Math.ceil(cd));
        s.node.setAttribute("aria-label", `${s.spec.name}, ${ready ? "ready" : `${Math.ceil(cd)} seconds`}`);
      }

      /* The lance is drawn for the airborne silhouette, but firing is
         deliberately disabled during boosted traversal. Hide the
         shooting affordance until the boots are back down. */
      reticleEl.style.opacity = combat.player.dead || jet?.inFlight || boost?.active
        || shield?.active ? "0" : "1";
    },
    minimapState() {
      return {
        ...minimapSemantic,
        north: { ...minimapSemantic.north },
        contacts: minimapSemantic.contacts.map((contact) => ({ ...contact })),
      };
    },
    redrawMinimap() { drawMinimap(ctx.player); },
    setVisible(v) { el.style.display = v ? "" : "none"; },
    flashDistrict(name) { nameEl.textContent = name; showFor = 5.2; },
    damageNumberCount() { return damageNumbers.length; },
  };
}
