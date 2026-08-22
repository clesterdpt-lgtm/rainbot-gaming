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
      <div class="sf-hud__eyebrow">SAINTFALL &middot; OPERATION THE GILDED SILENCE</div>
      <div class="sf-hud__name" id="sf-district-name"></div>
    </div>
    <div class="sf-hud__compass" id="sf-compass">
      <span class="sf-hud__compass-label" aria-hidden="true">BEARING</span>
      <div class="sf-hud__strip" id="sf-compass-strip"></div>
      <div class="sf-hud__needle"></div>
    </div>
    <section class="sf-bossbar" id="sf-bossbar" hidden data-state="idle" aria-live="polite">
      <header class="sf-bossbar__head">
        <strong class="sf-bossbar__name" id="sf-bossbar-name"></strong>
      </header>
      <div class="sf-bossbar__track" role="progressbar" id="sf-bossbar-track"
        aria-label="Boss vitality" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
        <i class="sf-bossbar__chip" id="sf-bossbar-chip"></i>
        <i class="sf-bossbar__fill" id="sf-bossbar-fill"></i>
      </div>
    </section>
    ${ctx.qa ? '<output class="sf-hud__readout" id="sf-readout" aria-label="QA world coordinates"></output>' : ""}
    <aside class="sf-hud__minimap" id="sf-minimap" aria-label="Tactical mini-map">
      <div class="sf-minimap__head">
        <span><small>SAINTFALL</small><strong>NORTH-UP</strong></span>
        <b id="sf-map-range">180M</b>
      </div>
      <canvas id="sf-map-canvas" width="280" height="280" aria-hidden="true"></canvas>
      <div class="sf-minimap__expand" aria-hidden="true"><kbd>M</kbd><span>TACTICAL VIEW</span></div>
    </aside>
    <section class="sf-hud__objective" id="sf-objective" aria-label="Active field orders">
      <header class="sf-objective__head">
        <span>FIELD ORDERS</span><small><span id="sf-hud-tier" class="sf-hud__tier" title="Difficulty tier">PENITENT</span> · <kbd>M</kbd> MAP</small>
      </header>
      <article class="sf-objective__item sf-objective__item--primary">
        <i aria-hidden="true">01</i>
        <span class="sf-objective__copy"><small>PRIORITY</small><strong id="sf-objlabel"></strong></span>
        <div class="sf-objective__meta">
          <svg class="sf-objective__arrow" id="sf-objarrow" viewBox="0 0 16 16" aria-hidden="true" width="14" height="14">
            <path d="M8 1.5 L14 13.5 L8 10.5 L2 13.5 Z" fill="currentColor" />
          </svg>
          <b id="sf-objdistance">&mdash;</b>
        </div>
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
    <div class="sf-hud__silk" id="sf-silk" data-state="clear"></div>
    <div class="sf-hud__stun" id="sf-stun" data-state="clear"></div>
    <div class="sf-hud__numbers" id="sf-damage-numbers" aria-hidden="true"></div>
    <div class="sf-hud__vitals" id="sf-vitals">
      <div class="sf-hud__hplabel"><span>VITALITY</span><b id="sf-hp-value">150</b></div>
      <div class="sf-hud__hpwrap"><div class="sf-hud__hp" id="sf-hp"></div></div>
      <div class="sf-hud__boon" id="sf-boon" data-state="off" aria-live="off">
        <span>GILDED</span><strong id="sf-boon-value"></strong>
        <i><em id="sf-boon-fill"></em></i>
      </div>
    </div>
    <div class="sf-hud__charge" id="sf-charge">
      <div class="sf-hud__jet" id="sf-jet" role="progressbar" aria-label="Reliquary charge"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
        <div class="sf-hud__jetlabel"><span>CHARGE</span><b id="sf-jet-value">100%</b></div>
        <div class="sf-hud__jettrack"><i id="sf-jet-fill"></i></div>
        <div class="sf-hud__boost" id="sf-boost"><span><b>SHIFT</b> GLIDE</span><strong id="sf-boost-value">READY</strong></div>
        <div class="sf-hud__shield" id="sf-shield"><span><b>E</b> AEGIS</span><strong id="sf-shield-value">READY</strong></div>
      </div>
    </div>
    <div class="sf-hud__heat sf-heat" id="sf-ammo" role="progressbar"
      aria-label="Weapon heat" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
      aria-valuetext="Weapon cool" data-state="cold">
      <svg class="sf-heat__crescent" viewBox="0 0 104 30" focusable="false" aria-hidden="true">
        <path class="sf-heat__track" pathLength="100" d="M8 7 Q52 35 96 7" />
        <path class="sf-heat__fill sf-heat__fill--left" pathLength="100" d="M52 25 Q30 24 8 7" />
        <path class="sf-heat__fill sf-heat__fill--right" pathLength="100" d="M52 25 Q74 24 96 7" />
        <circle class="sf-heat__core" cx="52" cy="25" r="1.7" />
      </svg>
      <u>0%</u>
    </div>
    <section class="sf-hud__command" id="sf-command-status" aria-label="Command availability">
      <header class="sf-hud__command-head">
        <span>COMMAND</span>
        <strong><kbd>Q</kbd></strong>
      </header>
      <div class="sf-hud__strat" id="sf-strat"></div>
    </section>
    <div class="sf-hud__hint" id="sf-hint">
      <span><kbd>Q</kbd> <b>HOLD FOR COMMAND</b></span>
    </div>
  `;

  const districtEl = el.querySelector("#sf-district");
  const nameEl = el.querySelector("#sf-district-name");
  /* The road's tier, in the field orders header, so the tier in force is
     never a guess - a tier that only showed in a menu read as "not working". */
  const tierEl = el.querySelector("#sf-hud-tier");
  let tierShown = "";
  function refreshTier() {
    const label = ctx.difficulty?.label?.() || "";
    if (label !== tierShown && tierEl) {
      tierShown = label;
      tierEl.textContent = label;
      tierEl.dataset.tier = ctx.difficulty?.tier || "";
    }
  }
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
  const bossBarEl = el.querySelector("#sf-bossbar");
  const bossBarNameEl = el.querySelector("#sf-bossbar-name");
  const bossBarTrackEl = el.querySelector("#sf-bossbar-track");
  const bossBarChipEl = el.querySelector("#sf-bossbar-chip");
  const bossBarFillEl = el.querySelector("#sf-bossbar-fill");
  const hintEl = el.querySelector("#sf-hint");
  const objEl = el.querySelector("#sf-objective");
  const objLabelEl = el.querySelector("#sf-objlabel");
  const objDistanceEl = el.querySelector("#sf-objdistance");
  const objArrowEl = el.querySelector("#sf-objarrow");
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
  const heatFillEls = [...ammoEl.querySelectorAll(".sf-heat__fill")];
  const heatStateEl = ammoEl.querySelector("u");
  const boonEl = el.querySelector("#sf-boon");
  const boonValueEl = el.querySelector("#sf-boon-value");
  const boonFillEl = el.querySelector("#sf-boon-fill");
  const stratEl = el.querySelector("#sf-strat");
  const hurtEl = el.querySelector("#sf-hurt");
  const toxinEl = el.querySelector("#sf-toxin");
  const silkEl = el.querySelector("#sf-silk");
  const stunEl = el.querySelector("#sf-stun");
  const reticleEl = el.querySelector("#sf-reticle");
  const damageLayerEl = el.querySelector("#sf-damage-numbers");
  let reticleGapPx = 30;
  let reticleConeRad = 0;

  /* Damage numbers subscribe to the health mutation itself, not to
     weapon hit effects. If a number appears, `combat.applyDamage`
     already changed the target's health in that same call. */
  const damageNumbers = [];
  const damageWorld = new ctx.THREE.Vector3();
  let damageSequence = 0;
  function pushDamageNumber(event, { weak = !!event.weak } = {}) {
    if (!event || !Number.isFinite(event.damage)) return;
    while (damageNumbers.length >= 32) {
      damageNumbers.shift().node.remove();
    }
    const node = document.createElement("span");
    node.className = "sf-damage-number";
    if (event.head) node.classList.add("is-head");
    if (weak) node.classList.add("is-weak");
    if (event.killed) node.classList.add("is-kill");
    if (event.source === "boost") node.classList.add("is-boost");
    node.textContent = `${weak ? "✦" : ""}${Math.max(1, Math.round(event.damage))}`;
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
  }
  ctx.combat?.bus?.on("enemyDamaged", (event) => pushDamageNumber(event));
  /* A LEG IS A POOL OF ITS OWN and its hits never pass through
     `applyDamage` - so for a whole build every shot and swing that
     landed on one of the Distaff's eight legs drew NO number, and the
     only figures a player ever saw were the body's. Read from the
     ground that looked like eight legs with hitboxes a few centimetres
     wide. Same layer, same styling; a joint hit takes the weak-point
     mark because a joint is that limb's designed target. */
  ctx.combat?.bus?.on("legHit", (event) => pushDamageNumber(event, { weak: !!event.joint }));

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
  let lastSilk = "";
  let lastStun = "";
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
    /* Named off the wave the event actually belongs to rather than a
       fixed string - this used to read "MATRIARCH ASCENDANT" for
       every boss wave including the Coulter's, because the string was
       written once for the first boss the game had and never revisited
       when the second one arrived. */
    ctx.breaches.bus.on("bossWarning", (event) => showBreachAlert(
      `CYCLE ${event.cycle} · APEX SIGNATURE`,
      `${(event.name || "APEX PREDATOR").toUpperCase()} ASCENDANT`, 4.8, true));
    ctx.breaches.bus.on("opened", (event) => showBreachAlert(
      "BREACH OPEN", `${event.remaining} HOSTILES SURFACING`, 2.5, !!event.boss));
    ctx.breaches.bus.on("cleared", () => showBreachAlert(
      "FIELD UPDATE", "BREACH SEALED", 2.6));
    ctx.breaches.bus.on("complete", (event) => showBreachAlert(
      "BLOOM RECOILING", `BROOD CYCLE ${event.cyclesCleared} BROKEN`, 5.2));
  }
  if (ctx.distaff?.bus) {
    ctx.distaff.bus.on("aggro", () => showBreachAlert(
      "THE GLASS SCAR · APEX SIGNATURE", "THE DISTAFF AWAKENS", 4.8, true));
    ctx.distaff.bus.on("collapse", () => showBreachAlert(
      "THE DISTAFF", "ITS FOOTING IS BROKEN", 3.2, true));
    /* No banner for the lunge. The rear-up, the chord and the animal
       itself crossing thirty metres of crater at you are the tell; a
       line of text over the top of that was reading it out loud. */
    ctx.distaff.bus.on("defeated", () => showBreachAlert(
      "THE GLASS SCAR", "THE DISTAFF IS UNWOUND", 5.2));
  }
  if (ctx.winnower?.bus) {
    ctx.winnower.bus.on("aggro", () => showBreachAlert(
      "THE CENSER WORKS · APEX SIGNATURE", "THE WINNOWER RISES", 4.8, true));
    ctx.winnower.bus.on("stunned", () => showBreachAlert(
      "THE WINNOWER", "IT IS DOWN - STRIKE NOW", 3.6, true));
    // The two ways it comes down read differently on purpose: one is
    // its own decision and the other is the player's.
    ctx.winnower.bus.on("stoke", (e) => showBreachAlert(
      "THE WINNOWER", e.stalled ? "STALLED - IT IS DOWN" : "IT STOOPS TO THE FIRE",
      3.0, true));
    ctx.winnower.bus.on("defeated", () => showBreachAlert(
      "THE CENSER WORKS", "THE WINNOWER IS GROUNDED", 5.2));
  }
  if (ctx.garner?.bus) {
    ctx.garner.bus.on("aggro", () => showBreachAlert(
      "THE OSSUARY · APEX SIGNATURE", "THE GROUND IS GIVING WAY", 4.8, true));
    /* The two alerts that are not threats. Everything else this boss
       does is announced by the world itself - a fifteen-metre limb
       standing up is not a thing that needs a banner - so the strip is
       spent only on the two moments the player could otherwise miss:
       a limb is on the sand, and the mouth is open. */
    ctx.garner.bus.on("lashMiss", () => showBreachAlert(
      "THE GARNER", "A LIMB IS DOWN — CUT IT", 2.4, true));
    ctx.garner.bus.on("inhaleTelegraph", () => showBreachAlert(
      "THE GARNER", "IT DRAWS BREATH — GET CLEAR OF THE PIT", 2.6, true));
    ctx.garner.bus.on("gorge", () => showBreachAlert(
      "THE GARNER", "THE GULLET IS OPEN", 3.4, true));
    ctx.garner.bus.on("defeated", () => showBreachAlert(
      "THE OSSUARY", "THE GARNER IS CLOSED", 5.2));
  }
  if (ctx.abbess?.bus) {
    ctx.abbess.bus.on("aggro", () => showBreachAlert(
      "THE BLOOM · APEX SIGNATURE", "THE ABBESS WAKES", 4.8, true));
    /* The strip is spent on the three beats the world does not announce
       loudly enough by itself: she is about to lay, she is about to
       drop twenty metres of abdomen, and - the one that decides
       fights - her brood is walking home. */
    ctx.abbess.bus.on("clutchTelegraph", () => showBreachAlert(
      "THE ABBESS", "SHE IS LAYING — BURN THE CLUTCH", 2.4, true));
    ctx.abbess.bus.on("slamTelegraph", () => showBreachAlert(
      "THE ABBESS", "SHE RISES — GET OUT, OR GET UNDER HER", 2.2, true));
    ctx.abbess.bus.on("feed", () => showBreachAlert(
      "THE ABBESS", "SHE IS BEING FED", 1.8, true));
    ctx.abbess.bus.on("defeated", () => showBreachAlert(
      "THE BLOOM", "THE ABBESS IS UNSEATED", 5.2));
  }
  if (ctx.stylite?.bus) {
    ctx.stylite.bus.on("aggro", () => showBreachAlert(
      "CHOIR SPIRES · APEX SIGNATURE", "IT IS ABOVE YOU", 4.8, true));
    ctx.stylite.bus.on("stoopTelegraph", () => showBreachAlert(
      "THE STYLITE", "IT IS COMING DOWN ON YOU", 2.0, true));
    /* The two beats the fight turns on: the grip going, and the window
       it buys. Everything else the animal does is visible against open
       sky and needs no banner. */
    ctx.stylite.bus.on("gripBroken", () => showBreachAlert(
      "THE STYLITE", "ITS GRIP IS GONE", 2.4, true));
    ctx.stylite.bus.on("crash", () => showBreachAlert(
      "THE STYLITE", "DOWN — CLOSE AND STRIKE", 3.2, true));
    ctx.stylite.bus.on("defeated", () => showBreachAlert(
      "CHOIR SPIRES", "THE STYLITE IS BROUGHT DOWN", 5.2));
  }
  if (ctx.districtBosses?.bus) {
    ctx.districtBosses.bus.on("approach", (event) => showBreachAlert(
      `${event.district.toUpperCase()} · BOSS TERRITORY`,
      `${event.boss.toUpperCase()} AHEAD`, 3.4, true));
    ctx.districtBosses.bus.on("exitWarning", () => showBreachAlert(
      "ARENA BOUNDARY", "TURN BACK — LEAVING WILL RESET THE FIGHT", 3.2, true));
    ctx.districtBosses.bus.on("arenaReset", (event) => showBreachAlert(
      `${event.district.toUpperCase()} · ENCOUNTER RESET`,
      `${event.boss.toUpperCase()} RESTORED TO FULL STRENGTH`, 4.0, true));
    ctx.districtBosses.bus.on("aggro", (event) => {
      // Bespoke modules (winnower, distaff, garner, abbess, stylite) own their own aggro banner
      if (!event.site?.domain) {
        showBreachAlert(
          `${event.district.toUpperCase()} · APEX SIGNATURE`, event.boss.toUpperCase(), 4.2, true);
      }
    });
    ctx.districtBosses.bus.on("engaged", (event) => showBreachAlert(
      "WEAPONS FREE", event.order, 2.8, true));
    ctx.districtBosses.bus.on("defeated", (event) => showBreachAlert(
      "DISTRICT SECURED", `${event.boss.toUpperCase()} DESTROYED`, 4.0, true));
  }
  if (ctx.apostate?.bus) {
    ctx.apostate.bus.on("aggro", () => showBreachAlert(
      "VAULT-CATHEDRAL · FALSE SAINT", "THE APOSTATE AWAKENS", 5.2, true));
    ctx.apostate.bus.on("engaged", () => showBreachAlert(
      "FINAL DIRECTIVE", "DESTROY WHAT IS WEARING YOU", 3.4, true));
    ctx.apostate.bus.on("call", () => showBreachAlert(
      "THE APOSTATE", "BROOD CALL - THE FLOOR IS MOVING", 2.8, true));
    ctx.apostate.bus.on("shield", (event) => {
      if (event.active) showBreachAlert(
        "THE APOSTATE", "AEGIS RAISED - BREAK ITS ANGLE", 2.3, true);
    });
    ctx.apostate.bus.on("slam", () => showBreachAlert(
      "THE APOSTATE", "RELIQUARY IMPACT", 1.8, true));
    ctx.apostate.bus.on("defeated", () => showBreachAlert(
      "VAULT-CATHEDRAL", "THE FALSE SAINT IS BROKEN", 6.0, true));
  }

  if (ctx.undercroft?.bus) {
    ctx.undercroft.bus.on("fracture", () => showBreachAlert(
      "THE NAVE", "THE FLOOR IS GOING", 3.0, true));
    ctx.undercroft.bus.on("answer", () => showBreachAlert(
      "THE UNDERCROFT", "THE HIVE ANSWERS", 4.4, true));
    ctx.undercroft.bus.on("clutch", () => showBreachAlert(
      "THE UNDERCROFT", "CLUTCH LAID AROUND YOU", 2.2, true));
    ctx.undercroft.bus.on("lasherCut", (event) => {
      if (event?.unmoored) showBreachAlert(
        "THE UNDERCROFT", "UNMOORED - BREAK IT NOW", 3.4, true);
    });
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

    for (const boss of ctx.mission?.bosses || []) {
      if (boss.stage === "penultimate" && ctx.mission?.state?.phase === "districtBosses") continue;
      const point = project(boss.x, boss.z);
      map2d.save(); map2d.translate(point.x, point.y); map2d.rotate(Math.PI * .25);
      map2d.fillStyle = boss.done ? "rgba(118,205,167,.92)" : "#f3b74e";
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
    const mapSize = Math.max(12, Math.min(w, h));
    const half = mapSize * 0.5;
    const mapLeft = cx - half;
    const mapTop = cy - half;
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
      const limit = edge ? Math.min(1, (mapRange * 0.90) / Math.max(1e-4, dist)) : 1;
      return {
        x: cx + (dx * limit / mapRange) * half,
        // Authored north is -Z, so negative Z belongs at canvas-up.
        y: cy + (dz * limit / mapRange) * half,
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
    map2d.rect(mapLeft, mapTop, mapSize, mapSize);
    map2d.clip();

    // No dark background fill (transparent map).

    // Clean subtle square grid and crosshairs in thin gold
    map2d.lineWidth = 1;
    map2d.strokeStyle = "rgba(216,164,65,.14)";
    map2d.beginPath();
    map2d.moveTo(cx, mapTop); map2d.lineTo(cx, mapTop + mapSize);
    map2d.moveTo(mapLeft, cy); map2d.lineTo(mapLeft + mapSize, cy);
    map2d.stroke();

    for (const fraction of [0.5]) {
      const innerHalf = half * fraction;
      map2d.strokeStyle = "rgba(216,164,65,.10)";
      map2d.strokeRect(cx - innerHalf, cy - innerHalf, innerHalf * 2, innerHalf * 2);
    }

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

    for (const [bossIndex, boss] of (ctx.mission?.bosses || []).entries()) {
      const p = point(boss.x, boss.z);
      if (!p.inside) continue;
      recordContact("boss", boss.key || bossIndex, boss.x, boss.z, p, {
        done: !!boss.done,
        name: boss.boss,
      });
      map2d.save();
      map2d.translate(p.x, p.y);
      map2d.rotate(Math.PI * 0.25);
      map2d.fillStyle = boss.done ? "rgba(106,217,174,.58)" : "#f0ad4b";
      map2d.fillRect(-2.5 * glyphScale, -2.5 * glyphScale, 5 * glyphScale, 5 * glyphScale);
      map2d.restore();
    }

    const pulse = 0.5 + Math.sin(ctx.atmos.elapsed * 6.4) * 0.5;
    for (const [enemyIndex, inst] of ctx.enemies.live.entries()) {
      /* A district boss hidden behind its arena-entry reveal must not
         leak through the tactical picture either. The instance stays
         alive for save and rig stability, but it does not become a
         contact until the same reveal that makes its world figure
         visible. Coulter's submerged chevron is deliberately separate:
         that encounter is already active and the bearing is its hunt
         mechanic. */
      if (!inst || inst.state === "death" || inst.encounterHidden) continue;
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
      const size = (inst.key === "apostate" ? 5.8
        : inst.key === "matriarch" ? 5.5
        : inst.key === "coulter" ? 5.0
          : inst.key === "precentor" ? 4.8
            : inst.key === "cantor" ? 4.3
          : inst.key === "harrow" ? 3.4 : inst.key === "gleaner" ? 2.5 : 1.7) * glyphScale;
      map2d.fillStyle = inst.key === "apostate" ? "#b568f5" : inst.emerging?.active
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
      } else if (inst.key === "apostate") {
        /* A doubled lozenge: the player's objective diamond, corrupted into
           the Bloom's violet shell and cyan living core. */
        map2d.save();
        map2d.translate(p.x, p.y);
        map2d.rotate(Math.PI * 0.25);
        map2d.fillRect(-size, -size, size * 2, size * 2);
        map2d.fillStyle = "#54efd2";
        map2d.fillRect(-size * 0.34, -size * 0.34, size * 0.68, size * 0.68);
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

    // Thin gold square border
    map2d.strokeStyle = "rgba(216, 164, 65, 0.72)";
    map2d.lineWidth = 1;
    map2d.strokeRect(mapLeft + 0.5, mapTop + 0.5, mapSize - 1, mapSize - 1);

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
    map2d.fillStyle = "rgba(255,224,159,.82)";
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

  /* The Distaff is not a breach wave and carries a different shape -
     see distaff.js's `status()` - so it is reformatted into the same
     four fields the strip already renders rather than teaching the
     strip two shapes. Takes priority over an ordinary Bloom breach
     when both happen to be live at once: whichever the player is
     standing next to is the more urgent thing on screen. */
  function updateDistaffReadout() {
    const d = ctx.distaff?.status?.();
    if (!d || d.phase === "dormant" || d.dead) return false;
    minimapEl.dataset.event = "1";
    mapEventEl.dataset.phase = d.phase;
    eventKickerEl.textContent = "THE GLASS SCAR · APEX SIGNATURE";
    eventNameEl.textContent = "THE DISTAFF";
    eventNameEl.title = eventNameEl.textContent;
    eventSubEl.textContent = d.phase === "returning"
      ? "Withdrawing - it is going home"
      : d.collapsed
        ? "Collapsed - the body is exposed"
        : d.lunging
          ? "IT IS COMING"
          : "Target legs — break its footing";
    eventCountEl.textContent = d.collapsed
      ? "EXPOSED" : `${d.health} HP`;
    eventFillEl.style.width = `${clamp01(1 - d.health / Math.max(1, d.maxHealth)) * 100}%`;
    return true;
  }

  /* The flyer's readout carries what its fight is actually about,
     which is not its health: whether it is up or down, and how close
     the player is to pulling it down. */
  function updateWinnowerReadout() {
    const w = ctx.winnower?.status?.();
    if (!w || w.phase === "dormant" || w.dead) return false;
    minimapEl.dataset.event = "1";
    mapEventEl.dataset.phase = w.phase;
    eventKickerEl.textContent = "THE CENSER WORKS · APEX SIGNATURE";
    eventNameEl.textContent = "THE WINNOWER";
    eventNameEl.title = eventNameEl.textContent;
    eventSubEl.textContent = w.phase === "return"
      ? "Withdrawing - it is flying home"
      : w.grounded
        ? (w.stunned
          ? "DOWN - strike gut freely"
          : w.stalled ? "Stalled - gut exposed" : "Stoking - gut exposed")
        : `Airborne · ${w.altitude}m · lift ${Math.max(0, Math.ceil(w.lift))}`;
    eventCountEl.textContent = `${w.health} HP`;
    eventFillEl.style.width = `${clamp01(1 - w.health / Math.max(1, w.maxHealth)) * 100}%`;
    return true;
  }

  /* The pit's readout carries the two counts the player is actually
     playing to: how many limbs are up and threatening, and how many
     are down and worth crossing the pan for. Its health is the least
     interesting number in the fight and is relegated to the bar. */
  function updateGarnerReadout() {
    const g = ctx.garner?.status?.();
    if (!g || g.phase === "dormant" || g.dead) return false;
    minimapEl.dataset.event = "1";
    mapEventEl.dataset.phase = g.phase;
    eventKickerEl.textContent = "THE OSSUARY · APEX SIGNATURE";
    eventNameEl.textContent = "THE GARNER";
    eventNameEl.title = eventNameEl.textContent;
    eventSubEl.textContent = g.phase === "sealing"
      ? "Sealing - the pan is closing over it"
      : g.phase === "breach"
        ? "The ground is falling in"
        : g.exposed
          ? "GULLET OPEN - strike into the mouth"
          : g.seized
            ? "SEIZED - it is winding you in"
            : g.inhaling
              ? "IT DRAWS - hold the rim"
              : g.armsDown > 0
                ? `${g.armsDown} limb${g.armsDown > 1 ? "s" : ""} down - cut them`
                : `${g.armsUp} limbs raised · ${g.armsSevered} cut`;
    eventCountEl.textContent = g.exposed ? "EXPOSED" : `${g.health} HP`;
    eventFillEl.style.width = `${clamp01(1 - g.health / Math.max(1, g.maxHealth)) * 100}%`;
    return true;
  }

  /* Her readout is a POPULATION count, because that is what her fight
     is: eggs on the ground, children in the room, and how many of them
     have already reached her. Health is the least interesting number
     she has and is relegated to the bar. */
  function updateAbbessReadout() {
    const a = ctx.abbess?.status?.();
    if (!a || a.phase === "dormant" || a.dead) return false;
    minimapEl.dataset.event = "1";
    mapEventEl.dataset.phase = a.phase;
    eventKickerEl.textContent = "THE BLOOM · APEX SIGNATURE";
    eventNameEl.textContent = "THE ABBESS";
    eventNameEl.title = eventNameEl.textContent;
    eventSubEl.textContent = a.phase === "retire"
      ? "Settling - she is folding back down"
      : a.phase === "rouse"
        ? "The chamber is lighting"
        : a.phase === "royal"
          ? "Brood surge — swarm surfacing"
          : a.exposed
            ? "UNDERSIDE EXPOSED - strike the belly"
            : a.eggs > 0
              ? `${a.eggs} egg${a.eggs > 1 ? "s" : ""} swelling · ${a.brood} hatched`
              : `${a.brood} / ${a.broodCap} brood · ${a.fed} fed her`;
    eventCountEl.textContent = a.exposed ? "EXPOSED" : `${a.health} HP`;
    eventFillEl.style.width = `${clamp01(1 - a.health / Math.max(1, a.maxHealth)) * 100}%`;
    return true;
  }

  /* Its readout carries the two numbers that decide the fight, and
     health is neither: how far up it is, and how much of its grip is
     left. */
  function updateStyliteReadout() {
    const s = ctx.stylite?.status?.();
    if (!s || s.phase === "dormant" || s.dead) return false;
    minimapEl.dataset.event = "1";
    mapEventEl.dataset.phase = s.phase;
    eventKickerEl.textContent = "CHOIR SPIRES · APEX SIGNATURE";
    eventNameEl.textContent = "THE STYLITE";
    eventNameEl.title = eventNameEl.textContent;
    eventSubEl.textContent = s.phase === "retire"
      ? "Withdrawing - it is going back up"
      : s.grounded
        ? "DOWN — close and strike"
        : s.phase === "plummet"
          ? "FALLING"
          : s.phase === "stoop"
            ? "IT IS COMING DOWN ON YOU"
            : s.phase === "leap"
              ? "In the air — hit it now"
              : `Perched · ${s.altitude}m up · grip ${Math.round(s.gripFraction * 100)}%`;
    eventCountEl.textContent = s.grounded ? "EXPOSED" : `${s.health} HP`;
    eventFillEl.style.width = `${clamp01(1 - s.health / Math.max(1, s.maxHealth)) * 100}%`;
    return true;
  }

  function updateApostateReadout() {
    const a = ctx.apostate?.status?.();
    if (!a || a.phase === "dormant" || a.dead) return false;
    minimapEl.dataset.event = "1";
    mapEventEl.dataset.phase = a.phase;
    eventKickerEl.textContent = "VAULT-CATHEDRAL · FINAL SIGNATURE";
    eventNameEl.textContent = "THE APOSTATE";
    eventNameEl.title = eventNameEl.textContent;
    eventSubEl.textContent = a.phase === "reveal"
      ? "Your reliquary answers from inside the Bloom"
      : a.action === "shield"
        ? "AEGIS ACTIVE - flank the false saint"
        : a.action === "summon"
          ? "Calling the brood through the nave floor"
          : a.action === "jet"
            ? `Airborne · ${a.altitude}m · impact imminent`
            : a.action === "vent"
              ? "Venting the corrupted Censer-Lance"
              : a.overheated
                ? "Weapon overheated"
                : `${a.summons} / ${a.summonCap} summoned insects · heat ${Math.round(a.heat * 100)}%`;
    eventCountEl.textContent = a.phase === "reveal" ? "LOCKED" : `${a.health} HP`;
    eventFillEl.style.width = `${clamp01(1 - a.health / Math.max(1, a.maxHealth)) * 100}%`;
    return true;
  }

  function updateDistrictBossReadout() {
    const boss = ctx.districtBosses?.activeBoss?.();
    if (!boss || boss.defeated) return false;
    minimapEl.dataset.event = "1";
    mapEventEl.dataset.phase = boss.phase;
    eventKickerEl.textContent = `${boss.district.toUpperCase()} · APEX SIGNATURE`;
    eventNameEl.textContent = boss.boss.toUpperCase();
    eventNameEl.title = eventNameEl.textContent;
    eventSubEl.textContent = boss.phase === "alert"
      ? "Signature resolving — weapons lock pending"
      : boss.enemyKey === "coulter"
        ? "Hundred-metre sand leviathan — track the furrow and strike when it surfaces"
        : boss.enemyKey === "matriarch"
          ? "Circle the armour — break the rear sac"
          : boss.enemyKey === "precentor"
            ? "Oversized raptorial caste — evade the scythes"
            : "Armoured Concord engine — break its firing line";
    eventCountEl.textContent = boss.phase === "alert" ? "LOCKED" : `${boss.health} HP`;
    eventFillEl.style.width = `${clamp01(1 - boss.health / Math.max(1, boss.maxHealth)) * 100}%`;
    return true;
  }

  function updateBreachReadout() {
    if (updateApostateReadout()) return;
    if (updateWinnowerReadout()) return;
    if (updateDistaffReadout()) return;
    if (updateGarnerReadout()) return;
    if (updateAbbessReadout()) return;
    if (updateStyliteReadout()) return;
    if (updateDistrictBossReadout()) return;
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

  const bossBarAnim = { key: "", fill: 1, chip: 1, wait: 0, hurt: 0 };

  function packBoss(key, name, district, health, maxHealth, detail, phase) {
    if (!maxHealth || health < 0) return null;
    if (phase === "dormant" || phase === "dead") return null;
    return {
      key, name, district, detail: detail || "",
      health: Math.max(0, health), maxHealth,
      ratio: clamp01(health / Math.max(1, maxHealth)),
    };
  }

  function readActiveBoss() {
    const apostate = ctx.apostate?.status?.();
    if (apostate && apostate.phase !== "dormant" && !apostate.dead) {
      const under = ctx.undercroft?.status?.();
      const hive = apostate.stage === 2;
      /* A NEW KEY FOR THE SECOND POOL. The bar animates its drain and
         its chip against `bossBarAnim.key`; leaving the key alone
         across the transition would make a full refill read as one
         enormous heal on the same bar rather than as a second bar. */
      return packBoss(hive ? "apostate-hive" : "apostate",
        hive ? "THE APOSTATE ENTHRONED" : "THE APOSTATE",
        hive ? "The Undercroft" : "Vault-Cathedral",
        apostate.health, apostate.maxHealth,
        apostate.phase === "reveal" ? "The false saint is answering"
          : apostate.phase === "descent" ? "The floor is going"
          : under?.unmooredFor > 0 ? "Unmoored — hit it now"
          : apostate.action === "shield" ? "Aegis raised — flank it"
          : apostate.action === "summon"
            ? (hive ? "Calling brood through the comb" : "Calling brood through the nave")
          : apostate.action === "jet" ? "Airborne — impact incoming"
          : apostate.overheated ? "Weapon overheated"
          : hive && under?.lashersUp > 0
            ? `${under.lashersUp} lasher${under.lashersUp === 1 ? "" : "s"} up — cut them`
            : "",
        apostate.phase);
    }
    const winnower = ctx.winnower?.status?.();
    if (winnower && winnower.phase !== "dormant" && !winnower.dead) {
      return packBoss("winnower", "THE WINNOWER", "Censer Works",
        winnower.health, winnower.maxHealth,
        winnower.phase === "return" ? "Withdrawing"
          : winnower.grounded
            ? (winnower.stunned ? "Down — strike freely"
              : winnower.stalled ? "Stalled — gut exposed" : "Stoking — gut exposed")
            : `Airborne · ${winnower.altitude}m`,
        winnower.phase);
    }
    const distaff = ctx.distaff?.status?.();
    if (distaff && distaff.phase !== "dormant" && !distaff.dead) {
      return packBoss("distaff", "THE DISTAFF", "Glass Scar",
        distaff.health, distaff.maxHealth,
        distaff.phase === "returning" ? "Withdrawing"
          : distaff.collapsed ? "Collapsed — body exposed"
          : distaff.lunging ? "Lunging"
          : "Target legs — break its footing",
        distaff.phase);
    }
    const garner = ctx.garner?.status?.();
    if (garner && garner.phase !== "dormant" && !garner.dead) {
      return packBoss("garner", "THE GARNER", "The Ossuary",
        garner.health, garner.maxHealth,
        garner.exposed ? "Gullet open"
          : garner.seized ? "Seized"
          : garner.inhaling ? "Drawing you in"
          : "",
        garner.phase);
    }
    const abbess = ctx.abbess?.status?.();
    if (abbess && abbess.phase !== "dormant" && !abbess.dead) {
      return packBoss("abbess", "THE ABBESS", "The Bloom",
        abbess.health, abbess.maxHealth,
        abbess.exposed ? "Underside exposed"
          : abbess.biting ? "Jaws drawn back"
          : abbess.phase === "royal" ? "Brood surge"
          : abbess.phase === "retire" ? "Folding back down" : "",
        abbess.phase);
    }
    const stylite = ctx.stylite?.status?.();
    if (stylite && stylite.phase !== "dormant" && !stylite.dead) {
      return packBoss("stylite", "THE STYLITE", "Choir Spires",
        stylite.health, stylite.maxHealth,
        stylite.grounded ? "Down — close and strike"
          : stylite.phase === "plummet" ? "Falling"
          : stylite.phase === "stoop" ? "Diving" : "",
        stylite.phase);
    }
    /* The Coulter is allocated from drop so its spine and save identity
       stay stable, and coulter.status() therefore reports a live burrow
       phase the entire operation. The bar is the Fallen Saint fight,
       not the staged animal: six district victories unlock the site,
       and walking in to wake it is what puts the name on screen. */
    const saint = ctx.districtBosses?.status?.("saint");
    const saintFight = saint && saint.available && !saint.defeated
      && (saint.phase === "alert" || saint.phase === "active");
    if (saintFight) {
      const coulter = ctx.coulter?.status?.();
      if (coulter && !coulter.dead) {
        return packBoss("coulter", "THE COULTER", "The Fallen Saint",
          coulter.health || saint.health, coulter.maxHealth || saint.maxHealth,
          coulter.phase === "burrow" ? "Under the sand"
            : coulter.phase === "crest" ? "Surfaced — strike the maw" : "",
          coulter.phase || saint.phase);
      }
    }
    const district = ctx.districtBosses?.activeBoss?.();
    if (district && district.available !== false && !district.defeated
      && district.phase !== "dormant") {
      return packBoss(district.key || district.enemyKey, district.boss?.toUpperCase() || "APEX",
        district.district, district.health, district.maxHealth,
        district.phase === "alert" ? "Signature resolving" : "",
        district.phase);
    }
    const event = ctx.breaches?.status?.();
    if (event?.boss && event.phase === "active") {
      return packBoss(event.boss.key || "breach-boss",
        (event.boss.name || event.name || "BLOOM APEX").toUpperCase(),
        "Bloom breach", event.boss.health, event.boss.maxHealth, "", "active");
    }
    return null;
  }

  function updateBossBar(dt) {
    if (!bossBarEl) return;
    const blocked = ctx.intro?.isBlocking?.() || ctx.runtime?.phase !== "playing";
    const boss = blocked ? null : readActiveBoss();
    if (!boss) {
      bossBarEl.hidden = true;
      bossBarEl.classList.remove("is-on", "is-hurt");
      bossBarEl.dataset.state = "idle";
      el.classList.remove("sf-hud--boss");
      bossBarAnim.key = "";
      return;
    }
    if (boss.key !== bossBarAnim.key) {
      bossBarAnim.key = boss.key;
      bossBarAnim.fill = boss.ratio;
      bossBarAnim.chip = boss.ratio;
      bossBarAnim.wait = 0;
      bossBarAnim.hurt = 0;
    }
    if (boss.ratio < bossBarAnim.fill - 0.002) {
      bossBarAnim.wait = 0.38;
      bossBarAnim.hurt = 0.28;
    }
    bossBarAnim.fill += (boss.ratio - bossBarAnim.fill) * Math.min(1, dt * 14);
    if (boss.ratio > bossBarAnim.chip) bossBarAnim.chip = boss.ratio;
    if (bossBarAnim.wait > 0) bossBarAnim.wait -= dt;
    else bossBarAnim.chip += (bossBarAnim.fill - bossBarAnim.chip) * Math.min(1, dt * 3.2);
    if (bossBarAnim.hurt > 0) bossBarAnim.hurt -= dt;

    const pct = Math.round(boss.ratio * 100);
    bossBarEl.hidden = false;
    bossBarEl.classList.add("is-on");
    bossBarEl.classList.toggle("is-hurt", bossBarAnim.hurt > 0);
    bossBarEl.dataset.state = boss.ratio <= 0.22 ? "crit" : boss.ratio <= 0.45 ? "warn" : "ok";
    el.classList.add("sf-hud--boss");
    /* THE NAME AND THE BAR, AND NOTHING ELSE. The district kicker, the
       numeric readout and the state caption ("Airborne · 40m", "Down —
       close and strike") used to ride on this strip too; they were
       removed on request so the bar reads as a name over a bar, the
       way a boss bar does. The state captions still exist as data
       (`boss.detail`, packed below) for the screen reader and for any
       harness that wants them - they are just not drawn. */
    bossBarNameEl.textContent = boss.name;
    bossBarFillEl.style.width = `${(bossBarAnim.fill * 100).toFixed(2)}%`;
    bossBarChipEl.style.width = `${(bossBarAnim.chip * 100).toFixed(2)}%`;
    bossBarTrackEl.setAttribute("aria-valuenow", String(pct));
    bossBarTrackEl.setAttribute("aria-valuetext",
      `${boss.name} ${pct} percent${boss.detail ? ` — ${boss.detail}` : ""}`);
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
      refreshTier();
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

      updateBossBar(dt);

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
      /* SILK. The same kind of thing as venom - a condition, held - and
         it says the one thing the player needs while it holds: your
         feet are not yours. Two states rather than a level, because a
         root is on or off: "held" while pinned in place, "hauled"
         while a line is dragging the body. No text; the strands at the
         edge of the frame are the sentence. */
      const ps = ctx.player?.state;
      const silk = (ps?.rootFor || 0) > 0
        ? (ctx.distaff?.status?.()?.reeling ? "hauled" : "held") : "clear";
      if (silk !== lastSilk) {
        lastSilk = silk;
        silkEl.dataset.state = silk;
        silkEl.style.opacity = silk === "clear" ? "0" : "1";
      }
      /* FLATTENED. A different sentence from the silk above and it
         needs a different frame: a root takes the feet and the player
         keeps shooting, so silk stays clear of the reticle. A stun
         takes the hands too - see player.applyStun - so there is
         nothing in the middle of the screen worth protecting, and the
         reticle going dark under it is the point. */
      const stun = (ps?.stunFor || 0) > 0 ? "down" : "clear";
      if (stun !== lastStun) {
        lastStun = stun;
        stunEl.dataset.state = stun;
        stunEl.style.opacity = stun === "clear" ? "0" : "1";
      }

      const weapon = ctx.weapons && ctx.weapons.current;
      if (weapon) {
        const h = ctx.weapons.heatState ? ctx.weapons.heatState() : null;
        if (!h) {
          ammoEl.hidden = true;
        } else {
          const heat = clamp01(h.heat);
          const pct = Math.round(heat * 100);
          const state = h.overheated ? "over"
            : h.venting ? "venting"
              : heat >= 0.82 ? "hot"
                : heat >= 0.55 ? "warm"
                  : heat > 0.015 ? "heating" : "cold";
          const stateText = h.overheated ? "OVERHEAT"
            : h.venting ? "VENTING" : `${pct}%`;
          ammoEl.hidden = heat <= 0.001 && !h.overheated && !h.venting;
          ammoEl.dataset.state = state;
          ammoEl.classList.toggle("is-over", h.overheated);
          ammoEl.classList.toggle("is-venting", h.venting);
          ammoEl.setAttribute("aria-valuenow", String(pct));
          ammoEl.setAttribute("aria-valuetext", h.overheated
            ? `Weapon overheated at ${pct} percent`
            : h.venting ? `Weapon venting at ${pct} percent`
              : heat <= 0.015 ? "Weapon cool" : `Weapon heat ${pct} percent`);
          heatStateEl.textContent = stateText;
          for (const fill of heatFillEls) fill.style.strokeDasharray = `${pct} 100`;
        }
      } else {
        ammoEl.hidden = true;
      }

      /* THE BLESSING, and it is a countdown rather than a badge. What
         the player has to decide while it is lit is whether there is
         time to push, so the number that matters is the one going
         down - and the bar is what makes the last three seconds
         readable without reading. */
      const boon = mission.boon?.();
      const boonOn = !!boon?.active;
      if (boonOn !== (boonEl.dataset.state === "on")) {
        boonEl.dataset.state = boonOn ? "on" : "off";
      }
      if (boonOn) {
        const left = Math.max(0, boon.remaining);
        boonValueEl.textContent = `${left.toFixed(1)}S`;
        boonFillEl.style.width = `${clamp01(left / Math.max(0.001, boon.seconds)) * 100}%`;
        boonEl.dataset.level = left < 3.5 ? "fading" : "full";
      }

      const obj = mission.objective();
      if (obj) {
        objEl.style.opacity = "1";
        objEl.dataset.event = obj.event ? "1" : "0";
        objLabelEl.textContent = obj.name;
        objDistanceEl.textContent = `${Math.round(obj.dist)}M`;
        objBarEl.style.width = `${(obj.progress || 0) * 100}%`;
        if (objArrowEl && Number.isFinite(obj.x) && Number.isFinite(obj.z)) {
          const dx = obj.x - ps.x;
          const dz = obj.z - ps.z;
          camera.getWorldDirection(fwdVec);
          const fx = fwdVec.x;
          const fz = fwdVec.z;
          const fLen = Math.hypot(fx, fz) || 1;
          const forwardX = fx / fLen;
          const forwardZ = fz / fLen;
          const rightX = -forwardZ;
          const rightZ = forwardX;
          const dFwd = dx * forwardX + dz * forwardZ;
          const dRight = dx * rightX + dz * rightZ;
          const rad = Math.atan2(dRight, dFwd);
          const deg = (rad * 180) / Math.PI;
          objArrowEl.style.transform = `rotate(${deg.toFixed(1)}deg)`;
          objArrowEl.style.opacity = "1";
        } else if (objArrowEl) {
          objArrowEl.style.opacity = "0";
        }
      } else {
        objEl.style.opacity = "0";
        objEl.dataset.event = "0";
        objDistanceEl.textContent = "—";
        if (objArrowEl) objArrowEl.style.opacity = "0";
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
      /* The four arms describe the weapon's ACTUAL half-angle instead
         of promising rifle precision at hip fire. Project the cone
         through the live camera FOV so the wide state grows on screen,
         then collapses to a small sight picture while RMB is held. */
      reticleConeRad = Math.max(0, ctx.weapons?.spread?.() || 0);
      const canvas = ctx.render?.renderer?.domElement;
      const height = Math.max(1, canvas?.clientHeight || canvas?.height || 720);
      const fov = Math.max(1, camera?.fov || 60) * Math.PI / 180;
      const conePx = Math.tan(reticleConeRad) * (height * 0.5) / Math.tan(fov * 0.5);
      reticleGapPx = Math.min(44, Math.max(6, conePx));
      reticleEl.style.setProperty("--sf-reticle-gap", `${reticleGapPx.toFixed(2)}px`);
      reticleEl.dataset.aiming = ctx.weapons?.carry?.ads > 0.5 ? "1" : "0";
      reticleEl.style.opacity = combat.player.dead || shield?.active
        || ctx.slam?.state?.active ? "0" : "1";
    },
    reticleState() {
      return {
        gapPx: Number(reticleGapPx.toFixed(2)),
        coneRad: Number(reticleConeRad.toFixed(5)),
        aiming: reticleEl.dataset.aiming === "1",
      };
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
