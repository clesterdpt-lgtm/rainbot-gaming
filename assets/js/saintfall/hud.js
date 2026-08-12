/* ============================================================
   SAINTFALL - heads-up display

   Deliberately thin. This build exists to be looked at, so the
   HUD's job is to name where you are and then get out of the way.
   Everything here can be hidden in one call, because a review
   frame with a HUD in it is a review of the HUD.
   ============================================================ */

import { clamp01, lerp } from "saintfall/core.js";
import {
  DISTRICTS, FOSSE_PATH, FOSSE_SPUR, MAP_HALF, MAP_SIZE, ROAD_PATH,
} from "saintfall/terrain.js";

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
      <div class="sf-minimap__expand" aria-hidden="true"><kbd>M</kbd><span>TACTICAL VIEW</span></div>
    </aside>
    <section class="sf-hud__objective" id="sf-objective" aria-label="Active field orders">
      <header class="sf-objective__head">
        <span>FIELD ORDERS</span><small><kbd>M</kbd> MAP</small>
      </header>
      <article class="sf-objective__item sf-objective__item--primary">
        <i aria-hidden="true">01</i>
        <span class="sf-objective__copy"><small>PRIORITY</small><strong id="sf-objlabel"></strong></span>
        <b id="sf-objdistance">&mdash;</b>
      </article>
      <div class="sf-hud__objbar"><i id="sf-objbar"></i></div>
      <div class="sf-minimap__event" id="sf-map-event" data-phase="dormant">
        <div class="sf-minimap__event-head">
          <i aria-hidden="true">02</i>
          <span class="sf-minimap__event-title">
            <small id="sf-event-kicker">BLOOM PRESSURE</small>
            <strong id="sf-event-name">SIGNAL QUIET</strong>
          </span>
          <b id="sf-event-count">STANDBY</b>
        </div>
        <small id="sf-event-sub">SIGNAL QUIET</small>
        <i><em id="sf-event-fill"></em></i>
      </div>
    </section>
    <div class="sf-hud__banner" id="sf-banner"></div>
    <div class="sf-hud__breach-alert" id="sf-breach-alert" aria-live="polite">
      <small id="sf-breach-kicker"></small><strong id="sf-breach-title"></strong>
    </div>
    <div class="sf-hud__reticle" id="sf-reticle"><i></i><i></i><i></i><i></i></div>
    <div class="sf-hud__hurt" id="sf-hurt"></div>
    <div class="sf-hud__toxin" id="sf-toxin" data-state="clear"></div>
    <div class="sf-hud__numbers" id="sf-damage-numbers" aria-hidden="true"></div>
    <div class="sf-hud__vitals" id="sf-vitals">
      <div class="sf-hud__hplabel"><span>VITALITY</span><b id="sf-hp-value">150</b></div>
      <div class="sf-hud__hpwrap"><div class="sf-hud__hp" id="sf-hp"></div></div>
      <div class="sf-hud__jet" id="sf-jet" role="progressbar" aria-label="Reliquary charge"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
        <div class="sf-hud__jetlabel"><span>CHARGE</span><b id="sf-jet-value">100%</b></div>
        <div class="sf-hud__jettrack"><i id="sf-jet-fill"></i></div>
        <div class="sf-hud__boost" id="sf-boost"><span><b>SHIFT</b> GLIDE</span><strong id="sf-boost-value">READY</strong></div>
        <div class="sf-hud__shield" id="sf-shield"><span><b>X</b> AEGIS</span><strong id="sf-shield-value">READY</strong></div>
      </div>
      <div class="sf-hud__vitalrow">
        <span id="sf-ammo">&mdash;</span>
        <span id="sf-reinf"></span>
      </div>
    </div>
    <section class="sf-hud__command" id="sf-command-status" aria-label="Command availability">
      <header class="sf-hud__command-head">
        <span>COMMAND</span>
        <strong><kbd>E</kbd></strong>
      </header>
      <div class="sf-hud__strat" id="sf-strat"></div>
    </section>
    <div class="sf-hud__hint" id="sf-hint">
      <span><kbd>E</kbd> <b>HOLD FOR COMMAND</b></span>
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
  const objDistanceEl = el.querySelector("#sf-objdistance");
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
  const toxinEl = el.querySelector("#sf-toxin");
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
  let lastToxin = -1;
  let breachAlertFor = 0;

  function formatCountdown(seconds) {
    const total = Math.max(0, Math.ceil(Number(seconds) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }

  function showBreachAlert(kicker, title, seconds = 3.2, boss = false) {
    breachKickerEl.textContent = kicker;
    breachTitleEl.textContent = title;
    breachAlertEl.dataset.boss = boss ? "1" : "0";
    breachAlertEl.classList.add("is-shown");
    breachAlertFor = seconds;
  }

  if (ctx.breaches?.bus) {
    ctx.breaches.bus.on("warning", (event) => showBreachAlert(
      `CYCLE ${event.cycle} · BREACH ${event.wave} / ${event.waveCount}`,
      event.name.toUpperCase(), 3.4));
    ctx.breaches.bus.on("bossWarning", (event) => showBreachAlert(
      `CYCLE ${event.cycle} · APEX SIGNATURE`, "MATRIARCH ASCENDANT", 4.8, true));
    ctx.breaches.bus.on("opened", (event) => showBreachAlert(
      "BREACH OPEN", `${event.remaining} HOSTILES SURFACING`, 2.5, !!event.boss));
    ctx.breaches.bus.on("cleared", () => showBreachAlert(
      "FIELD UPDATE", "BREACH SEALED", 2.6));
    ctx.breaches.bus.on("complete", (event) => showBreachAlert(
      "BLOOM RECOILING", `BROOD CYCLE ${event.cyclesCleared} BROKEN`, 5.2));
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
  let hintFade = 8;
  const fwdVec = new ctx.THREE.Vector3();
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
    range: 180,
    north: {
      axis: "-Z",
      worldYaw: Math.PI,
      canvasYaw: 0,
      x: null,
      y: null,
    },
    contacts: [],
  };
  let wholeMapBase = null;
  let wholeMapSemantic = null;

  function buildWholeMapBase() {
    if (wholeMapBase) return wholeMapBase;
    const size = 192;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    const heights = new Float32Array(size * size);
    let minHeight = Infinity;
    let maxHeight = -Infinity;
    for (let y = 0; y < size; y += 1) {
      const z = -MAP_HALF + (y / (size - 1)) * MAP_SIZE;
      for (let x = 0; x < size; x += 1) {
        const worldX = -MAP_HALF + (x / (size - 1)) * MAP_SIZE;
        const height = ctx.field.heightAt(worldX, z);
        heights[y * size + x] = height;
        minHeight = Math.min(minHeight, height);
        maxHeight = Math.max(maxHeight, height);
      }
    }
    const districtColours = {
      cathedral: [56, 51, 58], ossuary: [126, 112, 82], scar: [39, 88, 91],
      censer: [68, 58, 52], choir: [80, 65, 76], bloom: [86, 43, 43],
      threshold: [107, 74, 47], reach: [116, 78, 43], saint: [99, 65, 43],
    };
    const image = context.createImageData(size, size);
    const sample = (x, y) => heights[Math.max(0, Math.min(size - 1, y)) * size
      + Math.max(0, Math.min(size - 1, x))];
    for (let y = 0; y < size; y += 1) {
      const z = -MAP_HALF + (y / (size - 1)) * MAP_SIZE;
      for (let x = 0; x < size; x += 1) {
        const worldX = -MAP_HALF + (x / (size - 1)) * MAP_SIZE;
        const height = heights[y * size + x];
        const elevation = clamp01((height - minHeight) / Math.max(1, maxHeight - minHeight));
        const slopeX = sample(x + 1, y) - sample(x - 1, y);
        const slopeZ = sample(x, y + 1) - sample(x, y - 1);
        const hillshade = Math.max(.48, Math.min(1.18,
          .82 + (-slopeX * .018 - slopeZ * .012) + elevation * .16));
        let colour = [61 + elevation * 71, 42 + elevation * 48, 31 + elevation * 34];
        for (const [key, district] of Object.entries(DISTRICTS)) {
          const distance = Math.hypot(worldX - district.x, z - district.z);
          const blend = clamp01(1 - distance / (district.r * 1.05)) * .52;
          if (blend <= 0) continue;
          const tint = districtColours[key] || colour;
          colour = colour.map((channel, index) => lerp(channel, tint[index], blend));
        }
        const contourPhase = Math.abs((((height + 500) / 18) % 1 + 1) % 1 - .5);
        const contour = contourPhase > .465 ? .84 : 1;
        const edge = Math.max(Math.abs(worldX), Math.abs(z)) / MAP_HALF;
        const edgeShade = 1 - clamp01((edge - .84) / .16) * .17;
        const offset = (y * size + x) * 4;
        image.data[offset] = Math.round(colour[0] * hillshade * contour * edgeShade);
        image.data[offset + 1] = Math.round(colour[1] * hillshade * contour * edgeShade);
        image.data[offset + 2] = Math.round(colour[2] * hillshade * contour * edgeShade);
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    wholeMapBase = canvas;
    return canvas;
  }

  function drawWholeMap(player, canvas) {
    const map2d = canvas?.getContext?.("2d");
    const bounds = canvas?.getBoundingClientRect?.();
    if (!map2d || !bounds || bounds.width < 2 || bounds.height < 2) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(bounds.width * dpr));
    const height = Math.max(1, Math.round(bounds.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    map2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    map2d.clearRect(0, 0, bounds.width, bounds.height);
    const margin = Math.max(9, Math.min(bounds.width, bounds.height) * .035);
    const mapSize = Math.max(20, Math.min(bounds.width, bounds.height) - margin * 2);
    const left = (bounds.width - mapSize) * .5;
    const top = (bounds.height - mapSize) * .5;
    const project = (x, z) => ({
      x: left + ((x + MAP_HALF) / MAP_SIZE) * mapSize,
      y: top + ((z + MAP_HALF) / MAP_SIZE) * mapSize,
    });
    const drawPath = (path, colour, lineWidth, dash = []) => {
      map2d.save();
      map2d.beginPath();
      path.forEach(([x, z], index) => {
        const point = project(x, z);
        if (index === 0) map2d.moveTo(point.x, point.y);
        else map2d.lineTo(point.x, point.y);
      });
      map2d.setLineDash(dash);
      map2d.lineWidth = lineWidth;
      map2d.strokeStyle = colour;
      map2d.stroke();
      map2d.restore();
    };

    map2d.save();
    map2d.beginPath();
    map2d.rect(left, top, mapSize, mapSize);
    map2d.clip();
    map2d.drawImage(buildWholeMapBase(), left, top, mapSize, mapSize);
    for (let i = 1; i < 4; i += 1) {
      const offset = mapSize * i / 4;
      map2d.strokeStyle = "rgba(249,222,161,.07)";
      map2d.lineWidth = 1;
      map2d.beginPath(); map2d.moveTo(left + offset, top); map2d.lineTo(left + offset, top + mapSize); map2d.stroke();
      map2d.beginPath(); map2d.moveTo(left, top + offset); map2d.lineTo(left + mapSize, top + offset); map2d.stroke();
    }
    drawPath(ROAD_PATH, "rgba(246,206,124,.78)", Math.max(1.4, mapSize / 210));
    drawPath(FOSSE_PATH, "rgba(26,19,20,.72)", Math.max(1.2, mapSize / 235), [4, 3]);
    drawPath(FOSSE_SPUR, "rgba(26,19,20,.58)", Math.max(1, mapSize / 270), [3, 3]);

    const majorPoiIds = new Set(Object.keys(DISTRICTS));
    for (const poi of ctx.world.pois || []) {
      if (majorPoiIds.has(poi.id)) continue;
      const point = project(poi.x, poi.z);
      map2d.fillStyle = "rgba(246,225,181,.38)";
      map2d.fillRect(point.x - 1, point.y - 1, 2, 2);
    }
    const labelScale = Math.max(.82, Math.min(1.1, mapSize / 310));
    for (const [key, district] of Object.entries(DISTRICTS)) {
      const point = project(district.x, district.z);
      const radius = (district.r / MAP_SIZE) * mapSize;
      map2d.save();
      map2d.setLineDash([2.5, 3.5]);
      map2d.strokeStyle = "rgba(248,218,154,.18)";
      map2d.lineWidth = 1;
      map2d.beginPath(); map2d.arc(point.x, point.y, radius, 0, Math.PI * 2); map2d.stroke();
      map2d.restore();
      map2d.fillStyle = "rgba(255,239,203,.82)";
      map2d.font = `600 ${Math.round(7 * labelScale)}px Share Tech Mono, monospace`;
      map2d.textAlign = "center";
      const shortName = district.name.replace(/^The /, "").toUpperCase();
      const labelPadding = Math.max(28, mapSize * .085);
      const labelX = Math.max(left + labelPadding,
        Math.min(left + mapSize - labelPadding, point.x));
      const labelY = Math.max(top + 17,
        Math.min(top + mapSize - 9, point.y - 5));
      map2d.fillText(shortName, labelX, labelY);
      map2d.fillStyle = "rgba(245,205,121,.72)";
      map2d.beginPath(); map2d.arc(point.x, point.y, 2, 0, Math.PI * 2); map2d.fill();
    }

    for (const relay of ctx.mission?.relays || []) {
      const point = project(relay.x, relay.z);
      map2d.save(); map2d.translate(point.x, point.y); map2d.rotate(Math.PI * .25);
      map2d.fillStyle = relay.done ? "rgba(118,205,167,.92)" : "#f3b74e";
      map2d.fillRect(-3, -3, 6, 6); map2d.restore();
    }
    const objective = ctx.mission?.objective?.();
    if (objective && !objective.event) {
      const point = project(objective.x, objective.z);
      map2d.strokeStyle = "#ffe29a"; map2d.lineWidth = 1.5;
      map2d.strokeRect(point.x - 4, point.y - 4, 8, 8);
    }
    const event = ctx.breaches?.status?.();
    if (event && ["warning", "active"].includes(event.phase)) {
      const point = project(event.x, event.z);
      const pulse = 4 + (Math.sin(ctx.atmos.elapsed * 6) * .5 + .5) * 3;
      map2d.strokeStyle = "rgba(255,104,67,.92)"; map2d.lineWidth = 1.5;
      map2d.beginPath(); map2d.arc(point.x, point.y, pulse, 0, Math.PI * 2); map2d.stroke();
    }
    const playerPoint = project(player.state.x, player.state.z);
    const arrowCanvasYaw = wrapAngle(Math.PI - (Number.isFinite(player.state.yaw) ? player.state.yaw : 0));
    map2d.save(); map2d.translate(playerPoint.x, playerPoint.y); map2d.rotate(arrowCanvasYaw);
    map2d.fillStyle = "#fff0bf"; map2d.shadowColor = "rgba(255,188,75,.9)"; map2d.shadowBlur = 6;
    map2d.beginPath(); map2d.moveTo(0, -7); map2d.lineTo(4.5, 5); map2d.lineTo(0, 2.5); map2d.lineTo(-4.5, 5); map2d.closePath(); map2d.fill();
    map2d.restore();
    map2d.restore();

    map2d.strokeStyle = "rgba(245,216,142,.52)";
    map2d.lineWidth = 1;
    map2d.strokeRect(left + .5, top + .5, mapSize - 1, mapSize - 1);
    map2d.fillStyle = "rgba(255,231,173,.86)";
    map2d.font = "600 9px Share Tech Mono, monospace";
    map2d.textAlign = "center";
    map2d.fillText("N", left + mapSize * .5, top + 10);
    canvas.dataset.scope = "whole-basin";
    canvas.dataset.north = "-Z";
    wholeMapSemantic = {
      wholeMap: true,
      range: MAP_SIZE,
      bounds: { minX: -MAP_HALF, maxX: MAP_HALF, minZ: -MAP_HALF, maxZ: MAP_HALF },
      player: { x: mapNumber(player.state.x), z: mapNumber(player.state.z),
        canvasX: mapNumber(playerPoint.x), canvasY: mapNumber(playerPoint.y) },
      districts: Object.keys(DISTRICTS),
    };
    return wholeMapSemantic;
  }

  function drawMinimap(player, canvas = mapCanvas, options = {}) {
    const map2d = canvas?.getContext?.("2d");
    const bounds = canvas?.getBoundingClientRect?.();
    if (!bounds) return null;
    if (!map2d || bounds.width < 2 || bounds.height < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(bounds.width * dpr));
    const height = Math.max(1, Math.round(bounds.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
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
    const objective = ctx.mission?.objective?.();
    const detailed = options.detailed === true;
    const farthestSignal = Math.max(objective?.dist || 0, activeEvent ? event.distance || 0 : 0);
    const mapRange = Number.isFinite(options.range)
      ? Math.max(120, Number(options.range))
      : detailed ? Math.max(420, Math.min(1050, farthestSignal * 1.14 + 80))
        : activeEvent ? Math.max(180, Math.min(420, (event.distance || 0) * 1.18 + 26))
          : 180;
    if (canvas === mapCanvas) mapRangeEl.textContent = `${Math.round(mapRange)}M`;
    const glyphScale = detailed ? clamp01(Math.min(w, h) / 520) * 1.2 + 1 : 1;
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
    map2d.fillStyle = detailed ? "rgba(230,218,187,.62)" : "rgba(224,214,188,.36)";
    const labels = [];
    const canPlaceLabel = (p) => !labels.some((placed) => Math.hypot(placed.x - p.x, placed.y - p.y) < 44);
    for (const [poiIndex, poi] of (ctx.world.pois || []).entries()) {
      const p = point(poi.x, poi.z);
      if (!p.inside) continue;
      recordContact("poi", poi.key || poi.name || poiIndex, poi.x, poi.z, p);
      map2d.fillRect(p.x - glyphScale, p.y - glyphScale, glyphScale * 2, glyphScale * 2);
      if (detailed && labels.length < 8 && canPlaceLabel(p)) {
        labels.push({ x: p.x, y: p.y });
        map2d.fillStyle = "rgba(242,229,199,.72)";
        map2d.font = "600 9px Share Tech Mono, monospace";
        map2d.textAlign = p.x > cx ? "right" : "left";
        map2d.fillText(String(poi.name || poi.key || "LANDMARK").toUpperCase(),
          p.x + (p.x > cx ? -6 : 6), p.y - 5);
        map2d.fillStyle = "rgba(230,218,187,.62)";
      }
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
      map2d.fillRect(-2.5 * glyphScale, -2.5 * glyphScale, 5 * glyphScale, 5 * glyphScale);
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
          submerged: !!inst.body?.hidden,
        });
      const size = (inst.key === "matriarch" ? 5.5
        : inst.key === "coulter" ? 5.0
          : inst.key === "harrow" ? 3.4 : inst.key === "gleaner" ? 2.5 : 1.7) * glyphScale;
      map2d.fillStyle = inst.emerging?.active
        ? `rgba(255,172,61,${0.45 + pulse * 0.5})`
        : eventUnit ? "#ff6843" : "rgba(221,111,60,.72)";
      if (inst.body) {
        /* A BURROWER GETS A BEARING, NOT A DOT.
           The mini-map is the only instrument that can see it while it
           is under the sand, and what the player needs from that is not
           "it is there" but "it is coming here" - so the glyph is a
           chevron pointing the way it is travelling, hollow while it is
           submerged and filled once it is up.

           This is deliberately the ONE place a submerged enemy is
           legible. Take it away and the hunt phase is unreadable
           whenever the player happens to be facing the wrong way; make
           it a solid marker and there was never a hunt. */
        const submerged = !!inst.body.hidden;
        map2d.save();
        map2d.translate(p.x, p.y);
        map2d.rotate(-(inst.body.heading || 0));
        map2d.beginPath();
        map2d.moveTo(0, -size);
        map2d.lineTo(size * 0.78, size * 0.72);
        map2d.lineTo(0, size * 0.22);
        map2d.lineTo(-size * 0.78, size * 0.72);
        map2d.closePath();
        if (submerged) {
          map2d.strokeStyle = `rgba(184,242,62,${0.42 + pulse * 0.42})`;
          map2d.lineWidth = 1.6;
          map2d.stroke();
        } else {
          map2d.fillStyle = "#b8f23e";
          map2d.fill();
        }
        map2d.restore();
      } else if (inst.key === "matriarch") {
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
      map2d.strokeRect(-3.5 * glyphScale, -3.5 * glyphScale, 7 * glyphScale, 7 * glyphScale);
      map2d.restore();
    }

    if (activeEvent) {
      const p = point(event.x, event.z, true);
      recordContact("breach", event.serial || event.name || "active",
        event.x, event.z, p, { edge: !p.inside, phase: event.phase });
      map2d.beginPath();
      map2d.arc(p.x, p.y, (7 + pulse * 3) * glyphScale, 0, Math.PI * 2);
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
    map2d.moveTo(0, -7 * glyphScale); map2d.lineTo(4.2 * glyphScale, 5 * glyphScale);
    map2d.lineTo(0, 2.4 * glyphScale); map2d.lineTo(-4.2 * glyphScale, 5 * glyphScale);
    map2d.closePath(); map2d.fill();
    map2d.restore();

    const north = point(ps.x, ps.z - mapRange * 0.82, true);
    map2d.fillStyle = "rgba(255,224,159,.68)";
    map2d.font = "600 8px Share Tech Mono, monospace";
    map2d.textAlign = "center";
    map2d.fillText("N", north.x, north.y + 3);

    if (canvas === mapCanvas) mapDrawSeq += 1;
    const semantic = {
      drawSeq: canvas === mapCanvas ? mapDrawSeq : minimapSemantic.drawSeq,
      worldRotation: 0,
      bodyYaw,
      cameraYaw,
      arrowYaw: bodyYaw,
      arrowCanvasYaw,
      range: mapNumber(mapRange),
      detailed,
      north: {
        axis: "-Z",
        worldYaw: Math.PI,
        canvasYaw: 0,
        x: mapNumber(north.x),
        y: mapNumber(north.y),
      },
      contacts,
    };
    if (canvas === mapCanvas) minimapSemantic = semantic;
    return semantic;
  }

  function updateBreachReadout() {
    const event = ctx.breaches?.status?.();
    if (!event) { minimapEl.dataset.event = "0"; return; }
    mapEventEl.dataset.phase = event.phase;
    minimapEl.dataset.event = event.phase === "warning" || event.phase === "active" ? "1" : "0";
    eventKickerEl.textContent = event.complete ? `CYCLE ${event.cyclesCleared} CLEARED`
      : event.wave > 0 ? `CYCLE ${event.cycle} · BREACH ${event.wave} / ${event.waveCount}` : "BLOOM PRESSURE";
    eventNameEl.textContent = event.complete ? "BLOOM RECOILING"
      : event.wave > 0 ? event.name : "SIGNAL QUIET";
    eventNameEl.title = eventNameEl.textContent;
    eventSubEl.textContent = event.subtitle;
    if (event.phase === "dormant") eventCountEl.textContent = `${Math.ceil(event.timer)}S`;
    else if (event.phase === "warning") eventCountEl.textContent = `IN ${event.timer.toFixed(1)}S`;
    else if (event.phase === "active") eventCountEl.textContent = event.boss
      ? `${event.boss.health} HP` : `${event.remaining} LEFT`;
    else if (event.phase === "intermission") eventCountEl.textContent = `${Math.ceil(event.timer)}S`;
    else if (event.phase === "complete") eventCountEl.textContent = `NEXT ${formatCountdown(event.timer)}`;
    else eventCountEl.textContent = "CLEAR";

    let progress = 0;
    if (event.boss) progress = 1 - event.boss.health / Math.max(1, event.boss.maxHealth);
    else if (event.phase === "active" && event.total) progress = 1 - event.remaining / event.total;
    else if (event.phase === "warning") progress = 1 - event.timer / ctx.breaches.config.warningSeconds;
    else if (event.phase === "intermission") progress = 1 - event.timer / ctx.breaches.config.intermissionSeconds;
    else if (event.complete) progress = 1 - event.timer
      / Math.max(1, ctx.breaches.config.cycleCooldownSeconds);
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
        boostValueEl.textContent = boost.active
          ? (boost.attack ? "IMPACT" : boost.holding ? "GLIDE" : "BOOST")
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
      hpValueEl.textContent = `${Math.ceil(combat.player.hp)}`;
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

      /* VENOM. A held state rather than a flash, because that is what
         it is: the hurt vignette says "you were hit" and this says "you
         are still being hurt, and it will not stop until you move".
         Driven as an inline opacity because it tracks a continuous
         value; the flash next to it is a class toggle because it does
         not. */
      const toxin = ctx.coulter ? ctx.coulter.toxinLevel() : 0;
      if (toxin !== lastToxin) {
        lastToxin = toxin;
        toxinEl.style.opacity = toxin > 0.001 ? (0.20 + toxin * 0.68).toFixed(3) : "0";
        toxinEl.dataset.state = toxin > 0.6 ? "crit" : toxin > 0.001 ? "warn" : "clear";
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
          ammoEl.hidden = true;
        } else {
          const pct = Math.round(h.heat * 100);
          ammoEl.hidden = pct <= 0 && !h.overheated && !h.venting;
          const state = h.overheated ? "OVERHEAT"
            : (h.venting ? "VENTING" : `${pct}%`);
          const cls = h.overheated ? " is-over" : (h.venting ? " is-venting" : "");
          ammoEl.innerHTML = `<span class="sf-heat${cls}">`
            + `<i class="sf-heat__track"><b style="width:${pct}%"></b></i>`
            + `<u>${state}</u></span>`;
        }
      }
      reinfEl.textContent = `✦ ${mission.state.reinforcements}`;
      reinfEl.setAttribute("aria-label", `${mission.state.reinforcements} reinforcements`);

      const obj = mission.objective();
      if (obj) {
        objEl.style.opacity = "1";
        objEl.dataset.event = obj.event ? "1" : "0";
        objLabelEl.textContent = obj.name;
        objDistanceEl.textContent = `${Math.round(obj.dist)}M`;
        objBarEl.style.width = `${(obj.progress || 0) * 100}%`;
      } else {
        objEl.style.opacity = "0";
        objEl.dataset.event = "0";
        objDistanceEl.textContent = "—";
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

      /* The trooper can now fire mid-glide and mid-flight, so the
         reticle stays up through both - hiding it there used to be
         honest, and would now be a lie about what the trigger does.
         The two things that genuinely cannot shoot are the shield and
         the slam. */
      reticleEl.style.opacity = combat.player.dead || shield?.active
        || ctx.slam?.state?.active ? "0" : "1";
    },
    minimapState() {
      return {
        ...minimapSemantic,
        north: { ...minimapSemantic.north },
        contacts: minimapSemantic.contacts.map((contact) => ({ ...contact })),
      };
    },
    redrawMinimap() { drawMinimap(ctx.player); },
    redrawTacticalMap(canvas) { return drawWholeMap(ctx.player, canvas); },
    tacticalMapState() {
      return wholeMapSemantic ? {
        ...wholeMapSemantic,
        bounds: { ...wholeMapSemantic.bounds },
        player: { ...wholeMapSemantic.player },
        districts: [...wholeMapSemantic.districts],
      } : null;
    },
    setVisible(v) { el.style.display = v ? "" : "none"; },
    flashDistrict(name) { nameEl.textContent = name; showFor = 5.2; },
    damageNumberCount() { return damageNumbers.length; },
  };
}
