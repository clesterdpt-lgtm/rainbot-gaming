/* ============================================================
   SAINTFALL - district boss hunt

   Two encounters can use the shared enemy simulation while still
   needing the lifecycle guarantees of a boss: a fixed home, a hidden
   reveal gate, an arena reset, durable identity, an objective marker,
   and exactly one mission victory. The Distaff, the Winnower, the
   Garner, the Abbess and the Stylite retain their bespoke controllers,
   and this file reaches them through `domain` rather than by key. Six districts unlock the giant
   Coulter beneath the Fallen Saint; killing it unlocks the Apostate.
   ============================================================ */

import { ABBESS_CONFIG } from "saintfall/abbess.js";
import { clamp, makeBus } from "saintfall/core.js";
import { GARNER_CONFIG } from "saintfall/garner.js";
import { STYLITE_CONFIG } from "saintfall/stylite.js";
import { DISTRICTS } from "saintfall/terrain.js";

export const DISTRICT_BOSS_SITES = Object.freeze([
  Object.freeze({
    key: "censer", district: "Censer Works", boss: "The Winnower",
    order: "DESTROY THE WINNOWER", enemyKey: "winnower",
    x: DISTRICTS.censer.x, z: DISTRICTS.censer.z,
    arenaRadius: 98, domain: "winnower",
  }),
  Object.freeze({
    key: "scar", district: "Glass Scar", boss: "The Distaff",
    order: "BREAK THE DISTAFF", enemyKey: "distaff",
    x: DISTRICTS.scar.x, z: DISTRICTS.scar.z,
    arenaRadius: 92, domain: "distaff",
  }),
  Object.freeze({
    key: "ossuary", district: "The Ossuary", boss: "The Garner",
    order: "CLOSE THE GARNER", enemyKey: "garner",
    /* Taken from the encounter rather than restated. The arena centre
       and the mouth have to be the same point - the boundary check
       measures from one and the fight happens at the other - and a
       pit that moved without this following it would put the reset
       ring a hundred metres off the thing it is supposed to contain. */
    x: GARNER_CONFIG.pitX, z: GARNER_CONFIG.pitZ,
    arenaRadius: 112, aggroRadius: GARNER_CONFIG.aggroRadius,
    domain: "garner", stage: "district",
  }),
  Object.freeze({
    key: "bloom", district: "The Bloom", boss: "The Abbess",
    order: "UNSEAT THE ABBESS", enemyKey: "abbess",
    /* The Throat - the clearing world.js keeps free of spires at the
       Bloom's centre, ringed by sixteen of them leaning inward over it.
       Taken from the encounter rather than restated so the arena centre
       and the queen cannot drift apart. */
    x: ABBESS_CONFIG.lairX, z: ABBESS_CONFIG.lairZ,
    arenaRadius: 104, aggroRadius: ABBESS_CONFIG.aggroRadius,
    domain: "abbess",
  }),
  Object.freeze({
    key: "choir", district: "Choir Spires", boss: "The Stylite",
    order: "BRING DOWN THE STYLITE", enemyKey: "stylite",
    x: DISTRICTS.choir.x, z: DISTRICTS.choir.z,
    arenaRadius: STYLITE_CONFIG.arenaRadius,
    aggroRadius: STYLITE_CONFIG.aggroRadius,
    domain: "stylite",
  }),
  Object.freeze({
    /* The Matriarch takes the Reach. She was the Bloom's guardian until
       the Abbess replaced her, and the Abbess still lays one at a third
       health - so this is the district meeting the thing the Bloom
       exports rather than a spare model being found a home. */
    key: "reach", district: "The Gilded Reach", boss: "The Matriarch",
    order: "SLAY THE MATRIARCH", enemyKey: "matriarch",
    x: DISTRICTS.reach.x + 18, z: DISTRICTS.reach.z - 12,
    arenaRadius: 102, aggroRadius: 66, domain: "district",
  }),
  Object.freeze({
    key: "saint", district: "The Fallen Saint", boss: "The Coulter",
    order: "BREAK THE COULTER", enemyKey: "coulter",
    x: DISTRICTS.saint.x, z: DISTRICTS.saint.z,
    spawnX: DISTRICTS.saint.x + 105, spawnZ: DISTRICTS.saint.z - 125,
    arenaRadius: 285, warningRadius: 330, aggroRadius: 215,
    openSearchRadius: 64, openRadius: 7.5, burrowDepth: 16,
    yaw: Math.PI * 0.76, domain: "district", stage: "penultimate",
  }),
]);

const GENERIC_SITES = DISTRICT_BOSS_SITES.filter((site) => site.domain === "district");
const ALERT_SECONDS = 2.8;
const DISENGAGE_SECONDS = 13;
const APPROACH_PADDING = 48;
const EXIT_WARNING_BAND = 24;

export function buildDistrictBosses(ctx) {
  const { enemies, combat } = ctx;
  const bus = makeBus();
  const records = new Map(GENERIC_SITES.map((site) => [site.key, {
    site,
    phase: "dormant",       // dormant -> alert -> active -> dead
    timer: 0,
    disengageFor: 0,
    defeated: false,
    instance: null,
  }]));
  const boundary = new Map(DISTRICT_BOSS_SITES.map((site) => [site.key, {
    approachWarned: false,
    exitWarned: false,
    enteredDeep: false,
    inside: false,
    lastDist: null,
  }]));

  const eventId = (key) => `district-boss:${key}`;

  function setGate(record, hidden, locked = hidden) {
    const inst = record.instance;
    if (!inst) return;
    inst.encounterHidden = !!hidden;
    inst.encounterLocked = !!locked;
    inst.districtBossKey = record.site.key;
    if (inst.root) inst.root.visible = !inst.encounterHidden;
  }

  function openPoint(site) {
    // The Choir's needle spiral deliberately leaves its exact centre open.
    // A generic radial search can otherwise choose a flat point underneath
    // one of the giant visual shafts, hiding the enlarged mantis inside it.
    if (site.key === "choir") return { x: site.x, z: site.z };
    const x = site.spawnX ?? site.x;
    const z = site.spawnZ ?? site.z;
    const y = ctx.collide?.groundHeight?.(x, z)
      ?? ctx.terrain.heightAt(x, z);
    const open = ctx.collide?.findOpen?.(x, z, y,
      site.openSearchRadius || 34, 14, site.openRadius
        || (site.enemyKey === "coulter" ? 3.1 : 2.4));
    return open ? { x: open[0], z: open[1] } : { x, z };
  }

  function siteAvailable(site) {
    const phase = ctx.mission?.state?.phase;
    return site.stage === "penultimate" ? phase === "saintBoss" : phase === "districtBosses";
  }

  function configure(record, inst, phase = record.phase) {
    if (!inst) return null;
    record.instance = inst;
    inst.eventId = eventId(record.site.key);
    inst.districtBossKey = record.site.key;
    inst.home = { x: inst.x, z: inst.z };
    inst.suspicion = phase === "active" ? 1 : 0;
    inst.alerted = phase === "active";
    setGate(record, phase === "dormant", phase === "dormant" || phase === "alert");
    return inst;
  }

  function ensureSpawned(key) {
    const record = records.get(key);
    if (!record || record.defeated) return null;
    if (record.instance && enemies.live.includes(record.instance)) return record.instance;
    const found = enemies.live.find((inst) => inst.eventId === eventId(key)
      && inst.state !== "death");
    if (found?.key === record.site.enemyKey) return configure(record, found);
    if (found) enemies.remove?.(found);
    const point = openPoint(record.site);
    const inst = enemies.spawn(record.site.enemyKey, point.x, point.z, {
      yaw: Number.isFinite(record.site.yaw) ? record.site.yaw
        : Math.PI * (0.18 + GENERIC_SITES.indexOf(record.site) * 0.27),
      scale: record.site.spawnScale || 1,
      health: record.site.health,
      eventId: eventId(key),
    });
    if (!inst) return null;
    if (inst.body) {
      const ground = ctx.collide?.groundHeight?.(point.x, point.z)
        ?? ctx.terrain.heightAt(point.x, point.z);
      const depth = record.site.burrowDepth || 6;
      enemies.seedBody?.(inst, point.x, ground - depth, point.z, inst.yaw, depth);
      inst.body.depth = depth;
      inst.body.hidden = true;
    }
    inst.home = { x: point.x, z: point.z };
    return configure(record, inst);
  }

  function removeOwnedBrood(record) {
    const owner = record.instance;
    if (!owner) return;
    const ids = new Set((owner.broodKids || []).map((kid) => kid?.id).filter(Boolean));
    for (const inst of [...enemies.live]) {
      if (inst === owner) continue;
      if (ids.has(inst.id) || (inst.eventId === owner.eventId
        && !records.has(inst.districtBossKey))) enemies.remove?.(inst);
    }
    owner.broodKids = [];
  }

  function resetRecord(record, { silent = false } = {}) {
    const inst = ensureSpawned(record.site.key);
    if (!inst) return;
    removeOwnedBrood(record);
    if (record.site.enemyKey === "coulter") ctx.coulter?.clearHazards?.();
    const point = openPoint(record.site);
    inst.x = point.x;
    inst.z = point.z;
    inst.y = ctx.collide?.groundHeight?.(point.x, point.z)
      ?? ctx.terrain.heightAt(point.x, point.z);
    inst.yaw = Number.isFinite(record.site.yaw) ? record.site.yaw : 0;
    inst.root.position.set(inst.x, inst.y, inst.z);
    inst.root.rotation.set(0, inst.yaw, 0);
    inst.health = inst.maxHealth;
    inst.state = "idle";
    inst.suspicion = 0;
    inst.alerted = false;
    inst.stunTime = 0;
    inst.knockbackTime = 0;
    inst.speed = 0;
    if (inst.body) {
      const ground = ctx.collide?.groundHeight?.(point.x, point.z)
        ?? ctx.terrain.heightAt(point.x, point.z);
      const depth = record.site.burrowDepth || Math.max(6, inst.body.depth || 6);
      enemies.seedBody?.(inst, point.x, ground - depth,
        point.z, inst.yaw, depth);
      inst.body.phase = "burrow";
      inst.body.timer = 6;
      inst.body.hidden = true;
      inst.body.depth = depth;
    }
    record.phase = "dormant";
    record.timer = 0;
    record.disengageFor = 0;
    ctx.player?.setFree?.(false);
    setGate(record, true, true);
    enemies.play?.(inst, "idle", 0.25);
    if (!silent) bus.emit("reset", publicRecord(record));
  }

  function beginAlert(record) {
    if (!record.instance || record.defeated || combat.player.dead) return;
    record.phase = "alert";
    record.timer = ALERT_SECONDS;
    record.disengageFor = 0;
    setGate(record, false, true);
    enemies.play?.(record.instance, "alert", 0.18);
    ctx.mission?.announce?.(`${record.site.boss.toUpperCase()} AWAKENS`, 3.2);
    bus.emit("aggro", publicRecord(record));
  }

  function finishAlert(record) {
    record.phase = "active";
    record.timer = 0;
    const inst = record.instance;
    setGate(record, false, false);
    if (inst) {
      inst.suspicion = 1;
      inst.alerted = true;
      enemies.play?.(inst, "alert", 0.15);
    }
    bus.emit("engaged", publicRecord(record));
  }

  function finishDefeat(record) {
    if (record.defeated) return;
    record.defeated = true;
    record.phase = "dead";
    record.timer = 0;
    record.disengageFor = 0;
    setGate(record, false, false);
    removeOwnedBrood(record);
    ctx.mission?.completeDistrictBoss?.(record.site.key);
    bus.emit("defeated", publicRecord(record));
  }

  function publicRecord(record) {
    const inst = record.instance;
    return {
      key: record.site.key,
      district: record.site.district,
      boss: record.site.boss,
      order: record.site.order,
      enemyKey: record.site.enemyKey,
      stage: record.site.stage || "district",
      available: siteAvailable(record.site),
      phase: record.phase,
      defeated: record.defeated,
      hidden: !!inst?.encounterHidden,
      locked: !!inst?.encounterLocked,
      health: inst ? Math.max(0, Math.round(inst.health)) : 0,
      maxHealth: inst ? Math.round(inst.maxHealth) : 0,
      x: inst?.x ?? record.site.x,
      z: inst?.z ?? record.site.z,
      arenaX: record.site.x,
      arenaZ: record.site.z,
      arenaRadius: record.site.arenaRadius,
      dist: Math.hypot(ctx.player.state.x - (inst?.x ?? record.site.x),
        ctx.player.state.z - (inst?.z ?? record.site.z)),
    };
  }

  function update(dt) {
    const d = Math.min(0.1, Math.max(0, dt));
    for (const record of records.values()) {
      if (record.defeated) continue;
      const inst = ensureSpawned(record.site.key);
      if (!inst) continue;
      const missionDone = ctx.mission?.bosses?.find?.((boss) => boss.key === record.site.key)?.done;
      if (missionDone) {
        record.defeated = true;
        record.phase = "dead";
        enemies.remove?.(inst);
        record.instance = null;
        continue;
      }
      if (!siteAvailable(record.site)) {
        if (record.phase !== "dormant") resetRecord(record, { silent: true });
        else setGate(record, true, true);
        continue;
      }
      if (inst.state === "death" || inst.health <= 0) {
        finishDefeat(record);
        continue;
      }
      const dist = Math.hypot(ctx.player.state.x - inst.x, ctx.player.state.z - inst.z);
      if (record.phase === "dormant") {
        if (!combat.player.dead && dist <= record.site.aggroRadius) beginAlert(record);
        continue;
      }
      if (record.phase === "alert") {
        if (combat.player.dead) {
          resetRecord(record);
          continue;
        }
        record.timer = Math.max(0, record.timer - d);
        if (record.timer <= 0) finishAlert(record);
        continue;
      }
      if (record.phase !== "active") continue;
      record.disengageFor = 0;
    }
    updateArenaBoundaries();
  }

  function runtimeStatus(site) {
    if (site.key === "scar") return ctx.distaff?.status?.() || null;
    if (site.key === "censer") return ctx.winnower?.status?.() || null;
    if (site.key === "ossuary") return ctx.garner?.status?.() || null;
    if (site.key === "bloom") return ctx.abbess?.status?.() || null;
    if (site.key === "choir") return ctx.stylite?.status?.() || null;
    const record = records.get(site.key);
    return record ? publicRecord(record) : null;
  }

  /* A bespoke controller answers about its own animal and nothing
     else: `ctx.stylite.status()` knows grip and altitude but has never
     heard of the Choir Spires, the order text or the mission gate. So
     the site's own identity is laid UNDER it, and the two fields every
     caller derives - is it finished, how far away is it - are
     normalised on top, because the six controllers spell "finished"
     three different ways (`defeated`, `dead`, phase "dead"). */
  function siteStatus(site) {
    const record = records.get(site.key);
    if (record) return publicRecord(record);
    const runtime = runtimeStatus(site);
    if (!runtime) return null;
    const x = Number.isFinite(runtime.x) ? runtime.x : site.x;
    const z = Number.isFinite(runtime.z) ? runtime.z : site.z;
    return {
      key: site.key,
      district: site.district,
      boss: site.boss,
      order: site.order,
      enemyKey: site.enemyKey,
      stage: site.stage || "district",
      available: siteAvailable(site),
      arenaX: site.x,
      arenaZ: site.z,
      arenaRadius: site.arenaRadius,
      ...runtime,
      x,
      z,
      defeated: !!runtime.defeated || !!runtime.dead || runtime.phase === "dead",
      dist: Math.hypot(ctx.player.state.x - x, ctx.player.state.z - z),
    };
  }

  function fightActive(status) {
    if (!status || status.defeated || status.dead) return false;
    // Intro beats (alert / rouse / reveal / breach) are not a fight
    // yet. Treating them as one reset the arena the moment a player
    // woke a boss from outside the district pin - the Winnower's stacks
    // and the Stylite's needles sit well off-centre - so the camera
    // stole the shot and the encounter never handed combat back.
    // "sealing" is the Garner's own withdrawal, and it belongs on this
    // list for the same reason "returning" does: a boss that is going
    // back to sleep must not trip the arena-exit reset on the way.
    return !["dormant", "dead", "return", "returning", "sealing", "retire",
      "alert", "rouse", "reveal", "breach"].includes(status.phase);
  }

  function siteEvent(site, status = runtimeStatus(site)) {
    return {
      key: site.key,
      district: site.district,
      boss: site.boss,
      order: site.order,
      phase: status?.phase || "dormant",
      arenaRadius: site.arenaRadius,
      x: site.x,
      z: site.z,
    };
  }

  function resetArena(site) {
    if (site.domain === "distaff") ctx.distaff?.resetToLair?.();
    else if (site.domain === "winnower") ctx.winnower?.resetToPerch?.();
    /* The pit CLOSES rather than snapping. Every other reset here is a
       teleport home because the animal has somewhere to go; this one
       has nowhere, so the reset is the animation - and a boss whose
       arena you just left visibly swallowing itself back into the pan
       is a much better answer to "why did the fight stop" than a
       mouth that was there a frame ago and is not now. */
    else if (site.domain === "garner") ctx.garner?.seal?.();
    /* She folds back down rather than snapping home, for the Garner's
       reason: a queen who cannot move has nowhere to be teleported to,
       so the reset IS the animation. */
    else if (site.domain === "abbess") ctx.abbess?.retire?.();
    else if (site.domain === "stylite") ctx.stylite?.retire?.();
    else {
      const record = records.get(site.key);
      if (record) resetRecord(record, { silent: true });
    }
  }

  function updateArenaBoundaries() {
    const ps = ctx.player?.state;
    if (!ps) return;
    for (const site of DISTRICT_BOSS_SITES) {
      const state = boundary.get(site.key);
      const missionBoss = ctx.mission?.bosses?.find?.((boss) => boss.key === site.key);
      if (!state || missionBoss?.done || !siteAvailable(site)) {
        if (state) {
          state.approachWarned = false;
          state.exitWarned = false;
          state.enteredDeep = false;
          state.inside = false;
          state.lastDist = null;
        }
        continue;
      }
      const status = runtimeStatus(site);
      const dist = Math.hypot(ps.x - site.x, ps.z - site.z);
      const warningRadius = site.warningRadius || site.arenaRadius + APPROACH_PADDING;
      const active = fightActive(status);
      const exitBand = Math.min(EXIT_WARNING_BAND, Math.max(12, site.arenaRadius * 0.25));
      const deepThreshold = site.arenaRadius - exitBand - 2;

      if (!active && dist > site.arenaRadius && dist <= warningRadius
        && !state.approachWarned) {
        state.approachWarned = true;
        const event = siteEvent(site, status);
        ctx.mission?.announce?.(`WARNING — ${site.boss.toUpperCase()} TERRITORY AHEAD`, 3.4);
        bus.emit("approach", event);
      } else if (!active && dist > warningRadius + 18) {
        state.approachWarned = false;
      }

      // Mark the player as having penetrated inside the arena interior
      if (dist <= deepThreshold) {
        state.enteredDeep = true;
        state.exitWarned = false;
      }

      // Exit warning only fires if the player was already engaged in the arena interior
      // and is now moving outward into the boundary warning band
      if (active && state.enteredDeep && dist >= site.arenaRadius - exitBand
        && dist <= site.arenaRadius && !state.exitWarned
        && (state.lastDist === null || dist >= state.lastDist - 0.05)) {
        state.exitWarned = true;
        const event = siteEvent(site, status);
        ctx.mission?.announce?.("WARNING — LEAVING BOSS AREA. FIGHT WILL RESET", 3.2);
        bus.emit("exitWarning", event);
      }

      if (active && dist > site.arenaRadius) {
        const event = siteEvent(site, status);
        resetArena(site);
        ctx.mission?.announce?.(`${site.boss.toUpperCase()} RESET — RE-ENTER THE ARENA`, 4.0);
        bus.emit("arenaReset", event);
        state.approachWarned = false;
        state.exitWarned = false;
        state.enteredDeep = false;
        state.inside = false;
        state.lastDist = null;
        continue;
      }

      if (!active || dist > site.arenaRadius) {
        state.exitWarned = false;
        if (dist > site.arenaRadius) state.enteredDeep = false;
      }
      state.inside = dist <= site.arenaRadius;
      state.lastDist = dist;
    }
  }

  function objective(key) {
    const record = records.get(key);
    if (!record || record.defeated || !siteAvailable(record.site)) return null;
    const status = publicRecord(record);
    return {
      name: record.phase === "active" || record.phase === "alert"
        ? record.site.order : `HUNT ${record.site.boss.toUpperCase()} — ${record.site.district.toUpperCase()}`,
      x: status.x,
      z: status.z,
      dist: status.dist,
      progress: status.maxHealth > 0 ? 1 - status.health / status.maxHealth : 0,
      event: record.phase === "active" || record.phase === "alert",
      bossKey: key,
    };
  }

  function activeBoss() {
    for (const record of records.values()) {
      if (record.phase === "alert" || record.phase === "active") return publicRecord(record);
    }
    return null;
  }

  function snapshot() {
    return {
      bosses: [...records.values()].map((record) => {
        const inst = record.instance;
        const defeated = record.defeated || inst?.state === "death" || (inst && inst.health <= 0);
        return {
          key: record.site.key,
          phase: defeated ? "dead" : record.phase,
          timer: Number(Math.max(0, record.timer).toFixed(3)),
          disengageFor: Number(Math.max(0, record.disengageFor).toFixed(3)),
          defeated,
          instanceId: defeated ? null : (inst?.id || null),
          health: inst ? Number(Math.max(0, inst.health).toFixed(3)) : 0,
          maxHealth: inst ? Number(inst.maxHealth.toFixed(3)) : 0,
          x: Number((inst?.x ?? record.site.x).toFixed(4)),
          z: Number((inst?.z ?? record.site.z).toFixed(4)),
          yaw: Number((inst?.yaw || 0).toFixed(5)),
        };
      }),
    };
  }

  function restore(saved = {}, restoredEnemies = {}) {
    const byId = restoredEnemies?.byId instanceof Map ? restoredEnemies.byId : new Map();
    const savedByKey = new Map((Array.isArray(saved.bosses) ? saved.bosses : [])
      .filter((entry) => entry && records.has(entry.key))
      .map((entry) => [entry.key, entry]));
    for (const record of records.values()) {
      let entry = savedByKey.get(record.site.key);
      const missionDone = ctx.mission?.bosses?.find?.((boss) => boss.key === record.site.key)?.done;
      record.defeated = entry ? !!entry.defeated : !!missionDone;
      record.phase = record.defeated ? "dead"
        : ["dormant", "alert", "active"].includes(entry?.phase) ? entry.phase : "dormant";
      record.timer = clamp(Number(entry?.timer) || 0, 0, ALERT_SECONDS);
      record.disengageFor = clamp(Number(entry?.disengageFor) || 0, 0, DISENGAGE_SECONDS);
      let inst = (entry?.instanceId && byId.get(entry.instanceId))
        || enemies.live.find((candidate) => candidate.eventId === eventId(record.site.key));
      if (inst && inst.key !== record.site.enemyKey) {
        enemies.remove?.(inst);
        inst = null;
        entry = null;
        record.phase = "dormant";
        record.timer = 0;
        record.disengageFor = 0;
      }
      if (record.defeated) {
        if (inst) enemies.remove?.(inst);
        record.instance = null;
        continue;
      }
      if (!inst) inst = ensureSpawned(record.site.key);
      configure(record, inst, record.phase);
      if (!inst) continue;
      if (entry) {
        inst.x = Number.isFinite(entry.x) ? entry.x : inst.x;
        inst.z = Number.isFinite(entry.z) ? entry.z : inst.z;
        inst.yaw = Number.isFinite(entry.yaw) ? entry.yaw : inst.yaw;
        inst.root.position.set(inst.x, inst.y, inst.z);
        inst.root.rotation.y = inst.yaw;
        if (Number.isFinite(entry.maxHealth) && entry.maxHealth > 0) inst.maxHealth = entry.maxHealth;
        if (Number.isFinite(entry.health)) inst.health = clamp(entry.health, 1, inst.maxHealth);
      }
      if (!siteAvailable(record.site) && record.phase !== "dormant") {
        resetRecord(record, { silent: true });
      }
    }
    return true;
  }

  for (const record of records.values()) ensureSpawned(record.site.key);

  return {
    bus,
    sites: DISTRICT_BOSS_SITES,
    update,
    objective,
    activeBoss,
    /* status(key) answers for ANY of the seven sites, through the
       bespoke controller where there is one. It used to read `records`
       directly, which holds only the two sites the shared enemy
       simulation drives - so `status("choir")` went null the day the
       Stylite took the Choir Spires, and with it every caller that
       asks a site how its fight is going. `mission.js` and
       `breaches.js` had each grown their own private copy of the
       controller lookup to work around it; this is the one they can
       both use.

       THE NO-ARGUMENT FORM IS NOT THE SAME QUESTION and must not be
       widened to match. `status()` is the roster this module SAVES -
       it pairs with snapshot()/restore(), and save.js validates a
       loaded file by checking that its boss array is exactly this long
       (`save.js`, "expected"/"legacy"). Returning seven entries from a
       snapshot that writes two rejects every existing save file, which
       is the same class of failure as the Abbess's negative phase
       timer. `saintfall-stylite-fight.mjs` asserts on it for the
       matching reason: it is how that harness proves the Choir LEFT
       the shared simulation. */
    status(key) {
      if (key) {
        const site = DISTRICT_BOSS_SITES.find((entry) => entry.key === key);
        return site ? siteStatus(site) : null;
      }
      return [...records.values()].map(publicRecord);
    },
    snapshot,
    restore,
    ensureSpawned,
    reset(key) {
      const record = records.get(key);
      if (!record) return false;
      record.defeated = false;
      resetRecord(record);
      return true;
    },
  };
}
