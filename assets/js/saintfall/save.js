/* ============================================================
   SAINTFALL - field-save service

   One Rainbot save envelope owns an autosave and three manual field
   slots. Durable simulation state is captured here; each owning
   system performs its own restore so UI code never reaches through
   scene graphs or replays transient effects.
   ============================================================ */

import { clamp, clamp01 } from "saintfall/core.js";

const GAME_ID = "saintfall";
const SAVE_VERSION = 2;
const MANUAL_SLOTS = 3;
const AUTOSAVE_AFTER = 42;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validRngState(value) {
  return isRecord(value) && Number.isInteger(value.a)
    && value.a >= 0 && value.a <= 0xffffffff
    && (value.spare === null || isFiniteNumber(value.spare));
}

function nearestDistrict(ctx, x, z) {
  let best = null;
  let distance = Infinity;
  for (const district of Object.values(ctx.districts || {})) {
    const d = Math.hypot(x - district.x, z - district.z);
    if (d < distance) { best = district; distance = d; }
  }
  return best?.name || "The Pilgrim's Road";
}

function fallbackSlot() {
  const key = "rainbot_game_save:saintfall";
  return {
    read() {
      try {
        const saved = JSON.parse(localStorage.getItem(key));
        return saved?.version === SAVE_VERSION && saved?.data ? saved : null;
      } catch (_) { return null; }
    },
    save(data, meta = {}) {
      try {
        localStorage.setItem(key, JSON.stringify({
          version: SAVE_VERSION,
          savedAt: Date.now(),
          meta,
          data,
        }));
        return true;
      } catch (_) { return false; }
    },
  };
}

export function buildSaveSystem(ctx, options = {}) {
  const slot = window.RBGameSaves?.create?.(GAME_ID, { version: SAVE_VERSION })
    || fallbackSlot();
  /* Saintfall boots after the shared account synchronizer may already
     have made its one authentication pass. Registering the slot here
     and asking for a fresh merge prevents a newer cloud field save
     from being missed simply because the 3D assets took longer. */
  void window.RBGameSaves?.syncWithCloud?.();
  const listeners = new Set();
  let autosaveClock = 0;
  let lastResult = null;

  function emptyData() {
    return { schema: SAVE_VERSION, autosave: null, manuals: Array(MANUAL_SLOTS).fill(null) };
  }

  function readData() {
    const data = slot.read()?.data;
    if (!data || data.schema !== SAVE_VERSION) return emptyData();
    const manuals = Array(MANUAL_SLOTS).fill(null);
    for (let i = 0; i < MANUAL_SLOTS; i += 1) {
      const saved = data.manuals?.[i];
      manuals[i] = saved?.snapshot?.schema === SAVE_VERSION
        && validSnapshot(saved.snapshot) ? saved : null;
    }
    const autosave = data.autosave?.snapshot?.schema === SAVE_VERSION
      && validSnapshot(data.autosave.snapshot)
      ? data.autosave : null;
    return { schema: SAVE_VERSION, autosave, manuals };
  }

  function notify(type, detail = {}) {
    lastResult = { type, at: Date.now(), ...detail };
    for (const listener of listeners) listener(lastResult);
  }

  function saveReason() {
    const phase = ctx.mission?.state?.phase;
    if (ctx.runtime?.phase !== "playing") return "Finish deployment before saving.";
    if (ctx.combat?.player?.dead || phase === "lost") return "No living field state to save.";
    if (phase === "won") return "The completed operation is already recorded.";
    if (ctx.player?.state?.free) return "Return to the trooper before saving.";
    if (ctx.jetpack?.state?.inFlight || !ctx.player?.state?.grounded) {
      return "Land before creating a field save.";
    }
    if (ctx.boost?.state?.active || ctx.shield?.state?.active || ctx.player?.action) {
      return "Complete the current action before saving.";
    }
    if (ctx.mission?.canFieldSave?.() === false) {
      return "Wait for the active command to resolve.";
    }
    return "";
  }

  function canSave() {
    return !saveReason();
  }

  /* Constructing the snapshot is separate from the public safe-save gate so
     apply() can keep a private rollback point even if the player opens the
     menu during a transient state. That rollback is never written to disk. */
  function makeSnapshot() {
    const ps = ctx.player.state;
    const combat = ctx.combat.snapshot?.() || ctx.combat.player;
    const breach = ctx.breaches?.status?.() || null;
    const mission = ctx.mission.snapshot();
    const timestamp = Date.now();
    return {
      schema: SAVE_VERSION,
      build: ctx.build || null,
      seed: ctx.seed,
      timestamp,
      summary: {
        district: nearestDistrict(ctx, ps.x, ps.z),
        missionPhase: mission.phase,
        relays: `${mission.relaysDone}/${ctx.mission.relays.length}`,
        breach: breach?.complete ? `Cycle ${breach.cyclesCleared || 1} cleared`
          : breach?.wave > 0 ? `Cycle ${breach.cycle || 1} · Breach ${breach.wave}/${breach.waveCount}` : "Signal quiet",
        vitality: `${Math.ceil(combat.hp)}/${combat.maxHp}`,
        reinforcements: mission.reinforcements,
        elapsed: Math.max(0, Math.round(mission.elapsed)),
      },
      player: {
        x: finite(ps.x),
        z: finite(ps.z),
        yaw: finite(ps.yaw),
        camYaw: finite(ps.camYaw, ps.yaw),
        camPitch: finite(ps.camPitch),
        camDist: finite(ps.camDist, 5.2),
      },
      combat,
      mission,
      breaches: breach,
      enemies: ctx.enemies.snapshot(),
      weapon: ctx.weapons.snapshot?.() || null,
      boost: ctx.boost.status?.() || null,
      atmosphere: {
        time: ctx.atmos.time,
        storm: finite(ctx.atmos.storm),
      },
      reliquary: {
        fuel: Math.max(0, finite(ctx.jetpack?.state?.fuel)),
        maxFuel: Math.max(1, finite(ctx.jetpack?.config?.maxFuel, 100)),
        cooldownRemaining: Math.max(0, finite(ctx.jetpack?.state?.cooldownRemaining)),
        rechargeDelayRemaining: Math.max(0, finite(ctx.jetpack?.state?.rechargeDelayRemaining)),
      },
    };
  }

  function capture() {
    if (!canSave()) return null;
    return makeSnapshot();
  }

  /* Local and cloud records are untrusted input. Exact envelope/schema checks
     are not enough: every required nested domain must be valid before the
     first authoritative object is touched. Domain restore methods still clamp
     values defensively, but malformed shapes are rejected rather than silently
     becoming an empty battlefield or a reset mission. */
  function validSnapshot(snapshot, { allowDead = false, allowPending = false } = {}) {
    if (!isRecord(snapshot) || snapshot.schema !== SAVE_VERSION
      || !isFiniteNumber(snapshot.seed) || snapshot.seed !== ctx.seed) return false;

    const player = snapshot.player;
    if (!isRecord(player)
      || ![player.x, player.z, player.yaw, player.camYaw, player.camPitch, player.camDist]
        .every(isFiniteNumber)
      || Math.abs(player.x) > 2000 || Math.abs(player.z) > 2000
      || player.camPitch < -2 || player.camPitch > 2
      || player.camDist < 1 || player.camDist > 20) return false;

    const combat = snapshot.combat;
    if (!isRecord(combat)
      || ![combat.hp, combat.maxHp, combat.kills, combat.shots, combat.hits,
        combat.regenLockRemaining].every(isFiniteNumber)
      || combat.maxHp < 1 || combat.hp < (allowDead ? 0 : Number.EPSILON)
      || combat.hp > combat.maxHp
      || combat.kills < 0 || combat.shots < 0 || combat.hits < 0
      || ![combat.kills, combat.shots, combat.hits].every(Number.isInteger)
      || combat.hits > combat.shots || combat.regenLockRemaining < 0) return false;

    const mission = snapshot.mission;
    const phases = new Set(["relays", "extract", "won", "lost"]);
    const relayKeys = new Set(ctx.mission.relays.map((relay) => relay.key));
    if (!isRecord(mission) || !phases.has(mission.phase)
      || !Array.isArray(mission.relays)
      || mission.relays.length !== relayKeys.size
      || !isRecord(mission.cooldowns)
      || ![mission.elapsed, mission.extractTimer, mission.deaths,
        mission.reinforcements, mission.maxReinforcements].every(isFiniteNumber)
      || typeof mission.extractCalled !== "boolean"
      || mission.elapsed < 0 || mission.extractTimer < 0
      || ![mission.deaths, mission.reinforcements, mission.maxReinforcements]
        .every(Number.isInteger)
      || mission.deaths < 0 || mission.maxReinforcements < 1
      || mission.reinforcements < 0
      || mission.reinforcements > mission.maxReinforcements) return false;
    const savedRelayKeys = new Set();
    for (const relay of mission.relays) {
      if (!isRecord(relay) || typeof relay.key !== "string"
        || !relayKeys.has(relay.key) || savedRelayKeys.has(relay.key)
        || typeof relay.done !== "boolean" || !isFiniteNumber(relay.progress)
        || relay.progress < 0 || relay.progress > 1) return false;
      savedRelayKeys.add(relay.key);
    }
    for (const [key, spec] of Object.entries(ctx.mission.stratagems || {})) {
      if (!isFiniteNumber(mission.cooldowns[key]) || mission.cooldowns[key] < 0
        || mission.cooldowns[key] > spec.cooldown) return false;
    }
    if (!Array.isArray(mission.pending) || (mission.pending.length && !allowPending)) return false;
    for (const shot of mission.pending) {
      const spec = ctx.mission.stratagems?.[shot?.key];
      if (!isRecord(shot) || !spec
        || ![shot.x, shot.z, shot.remaining].every(isFiniteNumber)
        || shot.remaining <= 0 || shot.remaining > spec.delay) return false;
    }

    const enemies = snapshot.enemies;
    if (!isRecord(enemies) || !Array.isArray(enemies.live)
      || enemies.live.length > 420 || !Number.isSafeInteger(enemies.nextId)
      || enemies.nextId < 1 || enemies.nextId >= Number.MAX_SAFE_INTEGER
      || !validRngState(enemies.rng)) return false;
    const enemyIds = new Set();
    const enemyById = new Map();
    let maxEnemyId = 0;
    for (const enemy of enemies.live) {
      const idMatch = typeof enemy?.id === "string"
        ? /^sf-enemy-([1-9]\d*)$/.exec(enemy.id) : null;
      const idNumber = idMatch ? Number(idMatch[1]) : NaN;
      if (!isRecord(enemy) || typeof enemy.id !== "string" || !enemy.id
        || !idMatch || !Number.isSafeInteger(idNumber) || idNumber < 1
        || enemy.id.length > 80 || enemyIds.has(enemy.id)
        || typeof enemy.key !== "string" || !ctx.enemies.species.has(enemy.key)
        || ![enemy.x, enemy.z, enemy.yaw, enemy.scale, enemy.health,
          enemy.maxHealth, enemy.damageScale].every(isFiniteNumber)
        || Math.abs(enemy.x) > 2000 || Math.abs(enemy.z) > 2000
        || enemy.health <= 0 || enemy.maxHealth < enemy.health
        || enemy.maxHealth > 10_000_000
        || enemy.scale < 0.7 || enemy.scale > 1.35
        || enemy.damageScale < 0.2 || enemy.damageScale > 4
        || !(enemy.eventId === null
          || (typeof enemy.eventId === "string" && enemy.eventId.length <= 80))
        || !(enemy.eventWave === null
          || (Number.isInteger(enemy.eventWave) && enemy.eventWave >= 0))
        || !(enemy.home === null || (isRecord(enemy.home)
          && isFiniteNumber(enemy.home.x) && isFiniteNumber(enemy.home.z)))
        || !isFiniteNumber(enemy.suspicion) || enemy.suspicion < 0 || enemy.suspicion > 1
        || typeof enemy.alerted !== "boolean"
        || !isFiniteNumber(enemy.fireTimer) || enemy.fireTimer < 0
        || !Number.isInteger(enemy.burstLeft) || enemy.burstLeft < 0
        || !(enemy.broodTimer === null
          || (isFiniteNumber(enemy.broodTimer) && enemy.broodTimer >= 0))
        || !Array.isArray(enemy.broodIds)
        || new Set(enemy.broodIds).size !== enemy.broodIds.length
        || enemy.broodIds.some((id) => typeof id !== "string" || !id || id.length > 80)) return false;
      if (enemy.emergence !== null && enemy.emergence !== undefined) {
        if (!isRecord(enemy.emergence)
          || ![enemy.emergence.delay, enemy.emergence.duration,
            enemy.emergence.depth, enemy.emergence.elapsed].every(isFiniteNumber)
          || enemy.emergence.delay < 0 || enemy.emergence.duration < 0.1
          || enemy.emergence.depth < 0.7 || enemy.emergence.elapsed < 0
          || [enemy.emergence.active, enemy.emergence.surfaced,
            enemy.emergence.burst, enemy.emergence.boss]
            .some((value) => typeof value !== "boolean")) return false;
      }
      enemyIds.add(enemy.id);
      enemyById.set(enemy.id, enemy);
      maxEnemyId = Math.max(maxEnemyId, idNumber);
    }
    if (enemies.nextId <= maxEnemyId) return false;
    for (const enemy of enemies.live) {
      if (enemy.broodIds.some((id) => !enemyIds.has(id))) return false;
    }

    const breach = snapshot.breaches;
    const breachPhases = new Set(["dormant", "warning", "active", "intermission", "complete"]);
    const breachMembers = Array.isArray(breach?.memberIds) ? breach.memberIds : [];
    const uniqueBreachMembers = new Set(breachMembers);
    const waveCount = ctx.breaches?.waves?.length || Number(breach?.waveCount) || 0;
    if (!isRecord(breach)
      || !breachPhases.has(breach.phase)
      || ![breach.wave, breach.timer, breach.x, breach.z, breach.total,
        breach.remaining, breach.serial].every(isFiniteNumber)
      || ![breach.wave, breach.waveIndex, breach.waveCount, breach.total,
        breach.remaining, breach.serial].every(Number.isInteger)
      || breach.waveCount !== waveCount || breach.waveIndex !== breach.wave - 1
      || breach.wave < 0 || breach.wave > waveCount
      || breach.timer < 0 || breach.total < 0 || breach.remaining < 0
      || breach.remaining > breach.total || breach.serial < 0
      || typeof breach.complete !== "boolean" || typeof breach.auto !== "boolean"
      || !validRngState(breach.rng)
      || !Array.isArray(breach.memberIds)
      || uniqueBreachMembers.size !== breachMembers.length
      || breachMembers.some((id) => typeof id !== "string" || !enemyIds.has(id))
      || ((breach.phase === "warning" || breach.phase === "active")
        && breachMembers.length !== breach.remaining)
      || !(breach.bossId === null
        || (typeof breach.bossId === "string" && enemyIds.has(breach.bossId)))
      || !(breach.boss === null || (isRecord(breach.boss)
        && isFiniteNumber(breach.boss.health) && isFiniteNumber(breach.boss.maxHealth)
        && breach.boss.health >= 0 && breach.boss.maxHealth >= breach.boss.health))) return false;
    const hasCycleState = breach.cycle !== undefined || breach.cyclesCleared !== undefined;
    if (hasCycleState && (!Number.isInteger(breach.cycle) || breach.cycle < 1
      || !Number.isInteger(breach.cyclesCleared) || breach.cyclesCleared < 0
      || breach.cycle !== breach.cyclesCleared + (breach.complete ? 0 : 1))) return false;
    const noBreachMembers = breachMembers.length === 0 && breach.remaining === 0;
    const dormantShape = breach.phase !== "dormant" || (
      breach.wave === 0 && breach.waveIndex === -1 && breach.total === 0
      && noBreachMembers && !breach.complete
    );
    const warningShape = breach.phase !== "warning" || (
      breach.wave >= 1 && breach.waveIndex >= 0 && breach.remaining > 0
      && !breach.complete
    );
    const activeShape = breach.phase !== "active" || (
      breach.wave >= 1 && breach.waveIndex >= 0 && !breach.complete
    );
    const intermissionShape = breach.phase !== "intermission" || (
      breach.wave >= 1 && breach.wave < waveCount && breach.waveIndex >= 0
      && noBreachMembers && !breach.complete
    );
    const completeShape = breach.phase !== "complete" || (
      breach.wave === waveCount && breach.waveIndex === waveCount - 1
      && noBreachMembers && breach.complete
    );
    const bossPresent = breach.bossId !== null;
    const bossShape = bossPresent === (breach.boss !== null)
      && (!bossPresent || (uniqueBreachMembers.has(breach.bossId)
        && enemyById.get(breach.bossId)?.key === "matriarch"));
    if (!dormantShape || !warningShape || !activeShape || !intermissionShape
      || !completeShape || breach.complete !== (breach.phase === "complete")
      || !bossShape) return false;

    const weapon = snapshot.weapon;
    if (!isRecord(weapon) || !new Set(["ranged", "melee"]).has(weapon.mode)
      || typeof weapon.overheated !== "boolean"
      || ![weapon.heat, weapon.venting, weapon.sinceShot, weapon.cooldown]
        .every(isFiniteNumber)
      || weapon.heat < 0 || weapon.heat > 1 || weapon.venting < 0
      || weapon.sinceShot < 0 || weapon.cooldown < 0) return false;

    const boost = snapshot.boost;
    if (!isRecord(boost)
      || ![boost.cooldownRemaining, boost.boosts, boost.hits].every(isFiniteNumber)
      || boost.cooldownRemaining < 0 || boost.boosts < 0 || boost.hits < 0) return false;

    const reliquary = snapshot.reliquary;
    if (!isRecord(reliquary)
      || ![reliquary.fuel, reliquary.maxFuel, reliquary.cooldownRemaining,
        reliquary.rechargeDelayRemaining].every(isFiniteNumber)
      || reliquary.maxFuel <= 0 || reliquary.fuel < 0
      || reliquary.fuel > reliquary.maxFuel
      || reliquary.cooldownRemaining < 0 || reliquary.rechargeDelayRemaining < 0) return false;

    const atmosphere = snapshot.atmosphere;
    return isRecord(atmosphere)
      && new Set(["goldenhour", "noon", "dusk", "night", "storm"]).has(atmosphere.time)
      && isFiniteNumber(atmosphere.storm) && atmosphere.storm >= 0 && atmosphere.storm <= 1;
  }

  function writeData(data, meta = {}) {
    const ok = slot.save(data, {
      label: "Saintfall field command",
      slots: data.manuals.filter(Boolean).length + (data.autosave ? 1 : 0),
      ...meta,
    });
    slot.refresh?.();
    return ok;
  }

  function saveManual(index) {
    if (!Number.isInteger(index) || index < 0 || index >= MANUAL_SLOTS) {
      notify("error", { message: "Invalid field-save slot." });
      return null;
    }
    const snapshot = capture();
    if (!snapshot) {
      notify("error", { message: "Field save unavailable in the current state." });
      return null;
    }
    const data = readData();
    data.manuals[index] = { id: `manual-${index + 1}`, snapshot };
    if (!writeData(data, { lastSlot: index + 1 })) {
      notify("error", { message: "The field save could not be written." });
      return null;
    }
    notify("saved", { slot: index, snapshot: clone(snapshot) });
    return snapshot;
  }

  function saveAuto(force = false) {
    if (!force && autosaveClock < AUTOSAVE_AFTER) return null;
    const snapshot = capture();
    if (!snapshot) return null;
    const data = readData();
    data.autosave = { id: "autosave", snapshot };
    if (!writeData(data, { autosave: true })) return null;
    autosaveClock = 0;
    notify("autosaved", { snapshot: clone(snapshot) });
    return snapshot;
  }

  function resolveSlot(kind, index = 0) {
    const data = readData();
    if (kind === "autosave") return data.autosave;
    return Number.isInteger(index) && index >= 0 && index < MANUAL_SLOTS
      ? data.manuals[index] : null;
  }

  function restoreSnapshot(snapshot) {
    ctx.player.input.clearAll?.();
    ctx.player.cancelTransientActions?.();
    ctx.player.setFree(false);
    if (snapshot.atmosphere?.time && typeof options.setTime === "function") {
      options.setTime(snapshot.atmosphere.time);
    }
    if (typeof options.setStorm === "function") {
      options.setStorm(clamp01(finite(snapshot.atmosphere?.storm)));
    }
    let x = clamp(finite(snapshot.player.x), -970, 970);
    let z = clamp(finite(snapshot.player.z), -970, 970);
    const ground = ctx.collide?.groundHeight?.(x, z) ?? ctx.terrain.heightAt(x, z);
    const open = ctx.collide?.findOpen?.(x, z, ground, 32, 12);
    if (open) [x, z] = open;
    const yaw = finite(snapshot.player.yaw, Math.PI);
    ctx.player.spawn(x, z, yaw);
    ctx.player.state.camYaw = finite(snapshot.player.camYaw, yaw);
    ctx.player.state.camPitch = clamp(finite(snapshot.player.camPitch), -1.05, 1.15);
    ctx.player.state.camDist = clamp(finite(snapshot.player.camDist, 5.2), 2.8, 9.5);

    const restoredEnemies = ctx.enemies.restore(snapshot.enemies);
    if (!restoredEnemies || restoredEnemies.restored !== snapshot.enemies.live.length) {
      throw new Error("Enemy roster restore was incomplete.");
    }
    if (ctx.combat.restore?.(snapshot.combat) === false) {
      throw new Error("Combat state restore was rejected.");
    }
    if (!ctx.mission.restore(snapshot.mission)) {
      throw new Error("Mission state restore was rejected.");
    }
    ctx.breaches?.restore?.(snapshot.breaches || {});
    ctx.boost?.restore?.(snapshot.boost || {});
    ctx.shield?.reset?.(true);
    ctx.jetpack?.reset?.(true);
    if (ctx.jetpack?.state) {
      const maxFuel = Math.max(1, finite(ctx.jetpack.config?.maxFuel,
        snapshot.reliquary?.maxFuel || 100));
      ctx.jetpack.setState?.({
        fuel: clamp(finite(snapshot.reliquary?.fuel, maxFuel), 0, maxFuel),
        cooldownRemaining: Math.max(0, finite(snapshot.reliquary?.cooldownRemaining)),
        rechargeDelayRemaining: Math.max(0, finite(snapshot.reliquary?.rechargeDelayRemaining)),
      });
    }
    ctx.weapons?.restore?.(snapshot.weapon || {});
    ctx.hud?.redrawMinimap?.();
  }

  function apply(snapshot) {
    if (!validSnapshot(snapshot)) {
      notify("error", { message: "This save is missing or incompatible." });
      return false;
    }

    const rollback = makeSnapshot();
    const rollbackTransient = {
      combat: {
        hp: ctx.combat.player.hp,
        dead: ctx.combat.player.dead,
        respawnIn: ctx.combat.player.respawnIn,
        invulnerable: ctx.combat.player.invulnerable,
      },
      mission: {
        countedDeath: ctx.mission.state.countedDeath,
        channelling: ctx.mission.state.channelling,
        banner: ctx.mission.state.banner,
        bannerFor: ctx.mission.state.bannerFor,
      },
    };
    try {
      restoreSnapshot(snapshot);
    } catch (_) {
      /* A validated payload should not fail, but a subsystem regression must
         not leave half a load applied. Restore the in-memory checkpoint and
         report a contained failure rather than resuming a split world. */
      try {
        if (validSnapshot(rollback, { allowDead: true, allowPending: true })) {
          restoreSnapshot(rollback);
          Object.assign(ctx.combat.player, rollbackTransient.combat);
          Object.assign(ctx.mission.state, rollbackTransient.mission);
        }
      } catch (_) { /* the original error is still contained below */ }
      notify("error", { message: "The field state could not be restored safely." });
      return false;
    }

    ctx.mission.announce("FIELD STATE RESTORED", 2.4);
    notify("loaded", { snapshot: clone(snapshot) });
    return true;
  }

  function load(kind, index = 0) {
    const saved = resolveSlot(kind, index);
    if (!saved?.snapshot) {
      notify("error", { message: "No compatible field save in this slot." });
      return false;
    }
    return apply(clone(saved.snapshot));
  }

  function clearManual(index) {
    if (!Number.isInteger(index) || index < 0 || index >= MANUAL_SLOTS) return false;
    const data = readData();
    if (!data.manuals[index]) return false;
    data.manuals[index] = null;
    const ok = writeData(data, { clearedSlot: index + 1 });
    if (ok) notify("cleared", { slot: index });
    return ok;
  }

  function update(dt) {
    if (!canSave()) return;
    autosaveClock += Math.max(0, finite(dt));
    saveAuto(false);
  }

  function state() {
    const data = readData();
    return {
      version: SAVE_VERSION,
      canSave: canSave(),
      saveReason: saveReason(),
      autosave: data.autosave ? clone(data.autosave) : null,
      manuals: clone(data.manuals),
      lastResult: lastResult ? clone(lastResult) : null,
      current: capture(),
    };
  }

  window.addEventListener("pagehide", () => {
    if (autosaveClock > 5) saveAuto(true);
  });

  return {
    version: SAVE_VERSION,
    manualSlots: MANUAL_SLOTS,
    capture,
    apply,
    saveManual,
    saveAuto,
    load,
    clearManual,
    canSave,
    saveReason,
    read: readData,
    update,
    state,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
