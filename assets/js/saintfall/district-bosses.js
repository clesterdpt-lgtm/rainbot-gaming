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
import { APOSTATE_CONFIG } from "saintfall/apostate.js";
import { clamp, makeBus } from "saintfall/core.js";
import { GARNER_CONFIG } from "saintfall/garner.js";
import { revealCamera } from "saintfall/reveal-camera.js";
import { STYLITE_CONFIG } from "saintfall/stylite.js";
import { DISTRICTS, MATRIARCH_ARENA } from "saintfall/terrain.js";

export const DISTRICT_BOSS_SITES = Object.freeze([
  Object.freeze({
    key: "censer", district: "Censer Works", boss: "The Winnower",
    order: "DESTROY THE WINNOWER", enemyKey: "winnower",
    x: DISTRICTS.censer.x, z: DISTRICTS.censer.z,
    /* Arena rings grew ~40% across the board (m101): the old rings
       were tight enough that ordinary dodging brushed the exit
       warning, and a fight that keeps threatening to reset itself
       reads as a wall, not a territory. Each ring stays well inside
       its module's own disengage leash, which is the invariant that
       keeps "you left the arena" firing before "the boss lost you". */
    arenaRadius: 140, domain: "winnower",
  }),
  Object.freeze({
    key: "scar", district: "Glass Scar", boss: "The Distaff",
    order: "BREAK THE DISTAFF", enemyKey: "distaff",
    x: DISTRICTS.scar.x, z: DISTRICTS.scar.z,
    arenaRadius: 132, domain: "distaff",
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
    arenaRadius: GARNER_CONFIG.arenaRadius, aggroRadius: GARNER_CONFIG.aggroRadius,
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
    arenaRadius: ABBESS_CONFIG.arenaRadius, aggroRadius: ABBESS_CONFIG.aggroRadius,
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
    /* Taken from terrain.js's MATRIARCH_ARENA - the flattened pan
       the height field carves and world.js keeps its masts out of -
       so the encounter, the ground and the prop keep-clear cannot
       drift apart. */
    x: MATRIARCH_ARENA.x, z: MATRIARCH_ARENA.z,
    arenaRadius: MATRIARCH_ARENA.bossRadius, aggroRadius: 66, domain: "district",
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
const COULTER_ALERT_SECONDS = 4.8;
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
    revealed: false,
    instance: null,
  }]));
  const boundary = new Map(DISTRICT_BOSS_SITES.map((site) => [site.key, {
    approachWarned: false,
    exitWarned: false,
    enteredDeep: false,
    inside: false,
    wasInside: false,
    lastDist: null,
  }]));

  const eventId = (key) => `district-boss:${key}`;
  const alertSeconds = (record) => record.site.key === "saint"
    ? COULTER_ALERT_SECONDS : ALERT_SECONDS;

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
    inst.coulterReveal = false;
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
    record.revealed = false;
    ctx.player?.setFree?.(false);
    setGate(record, true, true);
    enemies.play?.(inst, "idle", 0.25);
    if (!silent) bus.emit("reset", publicRecord(record));
  }

  function beginAlert(record) {
    if (!record.instance || record.defeated || combat.player.dead) return;
    record.phase = "alert";
    record.timer = alertSeconds(record);
    record.disengageFor = 0;
    setGate(record, false, true);
    enemies.play?.(record.instance, "alert", 0.18);
    bus.emit("aggro", publicRecord(record));

    /* Authored hero camera framing for shared-simulation bosses (Matriarch, Coulter).
       Positioned at fixed, clear vantage points so the reveal shot is consistent
       and unobstructed regardless of where the player entered the district. */
    if (record.revealed) return;
    record.revealed = true;
    if (ctx.player?.setFree && !ctx.player.state.free) {
      const inst = record.instance;
      const groundAt = (x, z) => ctx.collide?.groundHeight?.(x, z)
        ?? ctx.terrain.heightAt(x, z);
      if (record.site.key === "reach") {
        // Matriarch: the flattened pan at the heart of the Gilded Reach.
        // The authored shot is ray-tested and re-framed if blocked - see
        // reveal-camera.js.
        const camX = inst.x - 18;
        const camZ = inst.z + 24;
        revealCamera(ctx, {
          label: "matriarch",
          preferred: [camX, groundAt(camX, camZ) + 3.8, camZ],
          target: [inst.x, inst.y + 2.2, inst.z],
          halfHeight: 3.5, halfWidth: 3,
          floorY: inst.y + 0.4,
          fov: 48,
        });
      } else if (record.site.key === "saint") {
        /* Coulter: elevated dune vantage over the Fallen Saint basin.
           The animal itself is still BURIED at reveal - inst.y is
           sixteen metres under the pan - so the shot frames the sand
           it is about to come out of, never a point underground (a
           subterranean target reads as "blocked" to every ray and
           would send the solver hunting for a view that cannot
           exist). */
        const camX = inst.x - 38;
        const camZ = inst.z + 42;
        const surfaceY = groundAt(inst.x, inst.z);
        /* The ordinary hunt waits up to six seconds before surfacing.
           An intro that ends before the animal appears is an intro to
           an empty dune, so this protected reveal owns the first breach. */
        ctx.coulter?.beginReveal?.(inst);
        revealCamera(ctx, {
          label: "coulter",
          preferred: [camX, groundAt(camX, camZ) + 7.5, camZ],
          target: [inst.x, Math.max(inst.y + 5.0, surfaceY + 4), inst.z],
          halfHeight: 6, halfWidth: 6,
          floorY: surfaceY + 1,
          fov: 52,
        });
      }
    }
  }

  function finishAlert(record) {
    record.phase = "active";
    record.timer = 0;
    const inst = record.instance;
    setGate(record, false, false);
    ctx.player?.setFree?.(false);
    if (inst) {
      inst.coulterReveal = false;
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
    ctx.player?.setFree?.(false);
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
        if (!combat.player.dead && dist <= record.site.aggroRadius
          && insideArena(record.site.key)) beginAlert(record);
        continue;
      }
      if (record.phase === "alert") {
        if (combat.player.dead) {
          resetRecord(record);
          continue;
        }
        record.timer = Math.max(0, record.timer - d);
        /* The Coulter travels tens of metres while it erupts. Keep the
           authored lens fixed but follow the rendered head, otherwise
           the camera remains on the original patch of sand while the
           boss exits the frame toward whichever side the player used. */
        if (record.site.key === "saint" && ctx.player?.state?.free
          && inst.body?.head) {
          ctx.player.setFree(true, undefined,
            [inst.body.head.x, inst.body.head.y + 2.5, inst.body.head.z]);
        }
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

  /* A fight is ENGAGED from the moment a boss leaves dormancy until
     it is dead or fully home again - a wider net than fightActive(),
     which exists to time arena RESETS and so must exclude intros and
     walk-homes. Engagement is what gates the autosave and the stray
     purge: an intro is not a moment to write a save file into, and it
     is very much a moment the stage should already be clear for. */
  const ENGAGED_EXEMPT = new Set(["dormant", "dead"]);
  function statusEngaged(status) {
    if (!status || status.defeated || status.dead) return false;
    return !ENGAGED_EXEMPT.has(status.phase);
  }

  function apostateStatus() {
    const status = ctx.apostate?.status?.();
    return status && !status.dead && !ENGAGED_EXEMPT.has(status.phase)
      ? status : null;
  }

  /** Is ANY boss fight under way? The one answer save.js asks. */
  function anyFightActive() {
    if (apostateStatus()) return true;
    for (const site of DISTRICT_BOSS_SITES) {
      if (!siteAvailable(site)) continue;
      const missionBoss = ctx.mission?.bosses?.find?.((boss) => boss.key === site.key);
      if (missionBoss?.done) continue;
      if (statusEngaged(runtimeStatus(site))) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------
     THE ARENA IS THE BOSS'S ALONE.

     A boss fight is a duel, and every garrison Thresher that wanders
     into the ring turns it into a brawl the encounter was not tuned
     for. While a site is engaged, anything inside its ring that the
     fight did not spawn is removed.

     WHAT IS KEPT is decided by provenance, not species:
       - the bosses themselves (eventId "district-boss:*",
         districtBossKey, or the Apostate's own key);
       - boss-spawned adds (they carry the owner's eventId - the
         Apostate's and the Undercroft's already did, the Matriarch's
         brood now inherits hers in combat.brood - or the Abbess's
         `abbessBornAt` birthmark);
       - Bloom breach waves (eventId "breach-*"): breaches.js already
         submerges any wave that touches a protected boss area, and
         that path banks the wave's health rather than deleting it -
         racing it with a remove() here would leak that bookkeeping.

     Removal clears the stray's projectiles first, for the reason
     recorded on the Apostate's dismissOwnedThreats: a deleted Gleaner
     must not leave its bolts in the air. Boss instances are NEVER
     removed here - five of the bespoke controllers keep a closure
     over their instance and cannot recover from losing it.
     ------------------------------------------------------------ */
  const PURGE_MARGIN = 24;

  function strayInstance(inst) {
    if (inst.eventId) return false;
    if (inst.districtBossKey) return false;
    if (inst.abbessBornAt) return false;
    if (inst.key === "apostate") return false;
    return true;
  }

  function purgeArenaStrays(cx, cz, radius) {
    let removed = 0;
    for (const inst of [...enemies.live]) {
      if (!strayInstance(inst)) continue;
      if (Math.hypot(inst.x - cx, inst.z - cz) > radius) continue;
      ctx.combat?.clearProjectiles?.(inst.id);
      enemies.remove?.(inst);
      removed += 1;
    }
    return removed;
  }

  function updateArenaBoundaries() {
    const ps = ctx.player?.state;
    if (!ps) return;
    /* The Apostate is not a district site, but its nave is an arena
       by every rule that matters here. */
    const apostate = apostateStatus();
    if (apostate) {
      purgeArenaStrays(APOSTATE_CONFIG.arenaX, APOSTATE_CONFIG.arenaZ,
        (APOSTATE_CONFIG.disengageRadius || APOSTATE_CONFIG.arenaRadius) + PURGE_MARGIN);
    }
    for (const site of DISTRICT_BOSS_SITES) {
      const state = boundary.get(site.key);
      const missionBoss = ctx.mission?.bosses?.find?.((boss) => boss.key === site.key);
      if (!state || missionBoss?.done || !siteAvailable(site)) {
        if (state) {
          state.approachWarned = false;
          state.exitWarned = false;
          state.enteredDeep = false;
          state.inside = false;
          state.wasInside = false;
          state.lastDist = null;
        }
        continue;
      }
      const status = runtimeStatus(site);
      if (statusEngaged(status)) {
        purgeArenaStrays(site.x, site.z, site.arenaRadius + PURGE_MARGIN);
      }
      const dist = Math.hypot(ps.x - site.x, ps.z - site.z);
      const warningRadius = site.warningRadius || site.arenaRadius + APPROACH_PADDING;
      const active = fightActive(status);
      const exitBand = Math.min(EXIT_WARNING_BAND, Math.max(12, site.arenaRadius * 0.25));
      const deepThreshold = site.arenaRadius - exitBand - 2;

      const movingInward = state.lastDist !== null && dist < state.lastDist - 0.05;
      const movingOutward = state.lastDist !== null && dist > state.lastDist + 0.05;

      // 1. Approach Warning ("WARNING — [BOSS] TERRITORY AHEAD"):
      // Fires only when:
      // - The boss fight is not currently active
      // - The player is in the warning band outside the arena (dist > arenaRadius && dist <= warningRadius)
      // - The player is moving inward towards the boss area (or initial approach if lastDist is null)
      // - The player was NOT already inside the arena (!state.inside && !state.wasInside)
      // - The approach warning has not already fired for this approach
      if (!active && dist > site.arenaRadius && dist <= warningRadius
        && !state.approachWarned && !state.inside && !state.wasInside
        && (state.lastDist === null || movingInward)) {
        state.approachWarned = true;
        const event = siteEvent(site, status);
        ctx.mission?.announce?.(`WARNING — ${site.boss.toUpperCase()} TERRITORY AHEAD`, 3.4);
        bus.emit("approach", event);
      } else if (!active && dist > warningRadius + 18) {
        // Reset approach warning & wasInside only when the player moves far outside into the desert
        state.approachWarned = false;
        state.wasInside = false;
      }

      // If the player is inside the arena, mark wasInside and suppress approach warning
      // so leaving the arena never triggers "TERRITORY AHEAD"
      if (dist <= site.arenaRadius) {
        state.wasInside = true;
        state.approachWarned = true;
      }

      // Mark the player as having penetrated inside the arena interior during an active fight
      if (active && dist <= deepThreshold) {
        state.enteredDeep = true;
        state.exitWarned = false;
      }

      // 2. Exit Warning ("WARNING — LEAVING BOSS AREA. FIGHT WILL RESET"):
      // Fires only when:
      // - The fight is active
      // - The player was engaged in the arena interior (state.enteredDeep)
      // - The player is in the perimeter warning band (dist >= arenaRadius - exitBand && dist <= arenaRadius)
      // - The player is moving OUTWARD away from the boss center (movingOutward)
      // - The exit warning has not already fired on this outward motion
      if (active && state.enteredDeep && dist >= site.arenaRadius - exitBand
        && dist <= site.arenaRadius && !state.exitWarned
        && movingOutward) {
        state.exitWarned = true;
        const event = siteEvent(site, status);
        ctx.mission?.announce?.("WARNING — LEAVING BOSS AREA. FIGHT WILL RESET", 3.2);
        bus.emit("exitWarning", event);
      }

      // 3. Reset when crossing boundary during active fight:
      if (active && dist > site.arenaRadius) {
        const event = siteEvent(site, status);
        resetArena(site);
        ctx.mission?.announce?.(`${site.boss.toUpperCase()} RESET — RE-ENTER THE ARENA`, 4.0);
        bus.emit("arenaReset", event);
        state.approachWarned = true; // Suppress approach warning while walking away after reset
        state.exitWarned = false;
        state.enteredDeep = false;
        state.inside = false;
        state.wasInside = true;      // Suppress approach warning when leaving
        state.lastDist = dist;
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

  /* WHERE A BOSS MAY WAKE, and the reason it is one function every
     controller asks rather than a number each one keeps.

     Aggro is measured from the ANIMAL and the arena reset from the
     SITE, and the two are not at the same point: the Winnower perches
     32m off the Censer Works' centre with a 78m aggro against a 98m
     ring, so its wake radius reaches twelve metres past the ring on
     the perch's side. A player walking in from that side was woken
     from OUTSIDE the arena - reveal camera, hands off the body - and
     the moment the alert handed control back the fight was "active
     with the player outside the ring", which is precisely the reset
     condition. Reset re-arms the reveal, the player is still inside
     aggro, so it wakes again: reproduced at 104m from the site as
     eight reveals in forty seconds with the camera held for 39.9 of
     them and no way to move out of it. That is what "stuck in the
     Winnower's intro" is.

     A fight's territory is the ring. Nothing may START one for a
     player who is not in it. Absent a site or a position, the answer
     is yes, so a controller that asks before the sites exist behaves
     as it always did. */
  function insideArena(key, x = ctx.player?.state?.x, z = ctx.player?.state?.z) {
    const site = DISTRICT_BOSS_SITES.find((entry) => entry.key === key);
    if (!site || !Number.isFinite(x) || !Number.isFinite(z)) return true;
    return Math.hypot(x - site.x, z - site.z) <= site.arenaRadius;
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
      record.timer = clamp(Number(entry?.timer) || 0, 0, alertSeconds(record));
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
        const savedMax = Number(entry.maxHealth);
        const savedHealth = Number(entry.health);
        /* Exact, allow-listed balance migrations. Saves from either
           earlier Matriarch generation carry one of these difficulty-
           scaled maxima. Preserve the wounded fraction while moving
           only those known pools to the current species tuning. */
        const baseMax = Number(enemies.species?.get(inst.key)?.spec?.health);
        const tunedScale = ctx.difficulty?.healthScale?.(inst.key) ?? 1;
        const tunedMax = Number.isFinite(baseMax) && baseMax > 0
          ? Math.max(1, Math.round(baseMax * tunedScale)) : inst.maxHealth;
        const legacyReachMax = [3060, 3600, 4320, 6120, 7200, 10080]
          .includes(savedMax);
        const migrateReach = record.site.key === "reach" && legacyReachMax
          && savedMax < tunedMax;
        if (migrateReach) {
          const fraction = Number.isFinite(savedHealth)
            ? clamp(savedHealth / savedMax, 0, 1) : 1;
          inst.maxHealth = tunedMax;
          inst.health = clamp(Math.round(tunedMax * fraction), 1, tunedMax);
        } else {
          if (Number.isFinite(savedMax) && savedMax > 0) inst.maxHealth = savedMax;
          if (Number.isFinite(savedHealth)) inst.health = clamp(savedHealth, 1, inst.maxHealth);
        }
        delete inst.balanceMigration;
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
    insideArena,
    anyFightActive,
    reset(key) {
      const record = records.get(key);
      if (!record) return false;
      record.defeated = false;
      resetRecord(record);
      return true;
    },
  };
}
