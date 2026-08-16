/* ============================================================
   SAINTFALL - field-save service

   One Rainbot save envelope owns an autosave and three manual field
   slots. Durable simulation state is captured here; each owning
   system performs its own restore so UI code never reaches through
   scene graphs or replays transient effects.
   ============================================================ */

import { DAY_CYCLE_SECONDS } from "saintfall/art.js";
import { clamp, clamp01 } from "saintfall/core.js";
import {
  FIELD_RANK_CAP,
  FIELD_RANK_XP_THRESHOLDS,
  DOCTRINE_POINT_START_RANK,
  DOCTRINE_POINTS_PER_RANK,
  DOCTRINE_ORDERS,
} from "saintfall/progression-config.js";

const GAME_ID = "saintfall";
const SAVE_VERSION = 2;
const MANUAL_SLOTS = 3;
const AUTOSAVE_AFTER = 42;
const AUTOSAVE_RETRY_BASE = 5;
const AUTOSAVE_RETRY_MAX = 120;
const CAREER_CONFLICT_KEY = "saintfall:career-conflict:v1";
/* The burrower's cycle, as a closed set. Kept here beside the other
   schema constants rather than imported from coulter.js: this file's
   job is to distrust the payload, and a validator that asks the runtime
   what is valid has already given up its independence. */
const BURROW_PHASES = new Set(["burrow", "rise", "crest", "dive", "dead"]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeClone(value, fallback = null) {
  try { return clone(value); } catch (_) { return fallback; }
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

const ORDER_BY_TALENT = new Map();
const CAPSTONE_NAMES = new Map();
for (const order of DOCTRINE_ORDERS) {
  for (const talent of order.talents) ORDER_BY_TALENT.set(talent.id, order);
  if (order.capstone) CAPSTONE_NAMES.set(order.capstone.id, order.capstone.name);
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
  const listeners = new Set();
  let autosaveClock = 0;
  let autosaveFailures = 0;
  let autosaveRetryRemaining = 0;
  let lastResult = null;
  let careerHydrated = false;
  let careerBaseline = "";
  let careerBaselineHadRecord = false;
  const INVALID_CAREER = Symbol("invalid-career");
  let careerQuarantined = false;
  let careerConflictRecord = null;
  let careerConflictLoaded = false;

  function emptyData() {
    return {
      schema: SAVE_VERSION,
      /* Career progression belongs to the account envelope, not any single
         field slot. Keeping this additive lets schema-2 field saves remain
         valid while a fresh career is created by the progression service. */
      career: null,
      autosave: null,
      manuals: Array(MANUAL_SLOTS).fill(null),
    };
  }

  function normalizeCareer(value) {
    if (value === null || value === undefined) return null;
    if (!isRecord(value)) return INVALID_CAREER;
    const validate = ctx.progression?.validateCareer;
    if (typeof validate !== "function") return clone(value);
    const result = validate(value);
    if (result === false || result === null || result === undefined) return INVALID_CAREER;
    return isRecord(result) ? clone(result) : clone(value);
  }

  function sameCareer(a, b) {
    return JSON.stringify(a || null) === JSON.stringify(b || null);
  }

  function sameCareerBuild(a, b) {
    return !!a && !!b
      && JSON.stringify(a.allocations || {}) === JSON.stringify(b.allocations || {})
      && JSON.stringify(a.activeCapstones || []) === JSON.stringify(b.activeCapstones || []);
  }

  /* A scalar revision only describes ordering on one writer. It is not proof
     that a career authored on another device descended from this one. A
     descendant must also contain every authoritative receipt, dominate each
     monotonic career counter, and keep the same build. Remote build edits are
     therefore surfaced for an explicit choice instead of being silently won
     by the numerically larger revision. */
  function careerDominates(candidate, current, { requireSameBuild = true } = {}) {
    if (!candidate || !current || candidate.totalXp < current.totalXp
      || candidate.revision < current.revision
      || (requireSameBuild && !sameCareerBuild(candidate, current))) return false;
    const incomingReceipts = new Set(candidate.receipts || []);
    if (!(current.receipts || []).every((receipt) => incomingReceipts.has(receipt))) return false;
    const dominates = ["kills", "relays", "breachWaves", "breachCycles", "operations"]
      .every((key) => (candidate.lifetime?.[key] || 0) >= (current.lifetime?.[key] || 0));
    if (!dominates) return false;
    if (candidate.revision === current.revision) {
      return sameCareer(candidate, current);
    }
    return true;
  }

  function conflictBranch(value, source, capturedAt = Date.now()) {
    const wrapped = isRecord(value) && Object.prototype.hasOwnProperty.call(value, "record");
    const candidate = wrapped ? value.record : value;
    const available = wrapped ? value.available !== false : candidate !== null && candidate !== undefined;
    const normalized = normalizeCareer(candidate);
    const valid = normalized !== INVALID_CAREER && normalized !== null;
    return {
      source,
      capturedAt: Number.isSafeInteger(Number(wrapped ? value.capturedAt : capturedAt))
        ? Number(wrapped ? value.capturedAt : capturedAt) : Date.now(),
      available,
      valid,
      record: valid ? normalized : null,
      invalidReason: available && !valid ? "Career record failed validation." : "",
    };
  }

  function normalizeConflictRecord(value) {
    if (!isRecord(value)) return null;
    const at = Number.isSafeInteger(Number(value.at)) ? Number(value.at) : Date.now();
    const reason = typeof value.reason === "string" && value.reason.trim()
      ? value.reason.trim().slice(0, 160) : "career-conflict";
    let local;
    let synced;
    if (value.schema === 2 && isRecord(value.branches)) {
      local = conflictBranch(value.branches.local, "device", at);
      synced = conflictBranch(value.branches.synced, "synced", at);
    } else if (value.schema === 1) {
      /* Read-only migration for conflicts created by the first progression
         slice. The selected branch is rewritten in schema 2 on the next
         conflict; no unvalidated legacy payload is ever exposed to callers. */
      local = conflictBranch(value.local, "device", at);
      synced = conflictBranch(value.incoming, "synced", at);
    } else return null;
    if (!local.valid && !synced.valid) return null;
    return {
      schema: 2,
      active: value.active !== false,
      at,
      reason,
      branches: { local, synced },
    };
  }

  function loadCareerConflict() {
    if (careerConflictLoaded) return careerConflictRecord;
    careerConflictLoaded = true;
    if (ctx.qa) return careerConflictRecord;
    try {
      careerConflictRecord = normalizeConflictRecord(
        JSON.parse(localStorage.getItem(CAREER_CONFLICT_KEY) || "null")
      );
    } catch (_) { careerConflictRecord = null; }
    if (careerConflictRecord?.active) careerQuarantined = true;
    return careerConflictRecord;
  }

  function persistCareerConflict(record) {
    careerConflictRecord = normalizeConflictRecord(record);
    careerConflictLoaded = true;
    if (!careerConflictRecord) return false;
    careerQuarantined = true;
    if (ctx.qa) return true;
    try {
      const serialized = JSON.stringify(careerConflictRecord);
      localStorage.setItem(CAREER_CONFLICT_KEY, serialized);
      return localStorage.getItem(CAREER_CONFLICT_KEY) === serialized;
    } catch (_) { return false; }
  }

  function preserveCareerConflict(localCareer, incomingCareer, reason) {
    const at = Date.now();
    return persistCareerConflict({
      schema: 2,
      active: true,
      at,
      reason,
      branches: {
        local: conflictBranch(localCareer, "device", at),
        synced: conflictBranch(incomingCareer, "synced", at),
      },
    });
  }

  function careerRank(totalXp) {
    let rank = 1;
    for (let index = 1; index < FIELD_RANK_XP_THRESHOLDS.length; index += 1) {
      if (totalXp < FIELD_RANK_XP_THRESHOLDS[index]) break;
      rank = index + 1;
    }
    return Math.min(FIELD_RANK_CAP, rank);
  }

  function careerSummary(record, updatedAt) {
    const rank = careerRank(record.totalXp);
    const earned = Math.max(0,
      rank - DOCTRINE_POINT_START_RANK + 1) * DOCTRINE_POINTS_PER_RANK;
    const spent = Object.values(record.allocations || {})
      .reduce((sum, amount) => sum + Math.max(0, finite(amount)), 0);
    const byOrder = new Map();
    for (const [talentId, amount] of Object.entries(record.allocations || {})) {
      const order = ORDER_BY_TALENT.get(talentId);
      if (!order || amount <= 0) continue;
      byOrder.set(order.id, {
        id: order.id,
        name: order.shortName || order.name,
        points: (byOrder.get(order.id)?.points || 0) + amount,
      });
    }
    const build = [...byOrder.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    const activeVows = (record.activeCapstones || [])
      .filter(Boolean)
      .map((id) => CAPSTONE_NAMES.get(id) || id);
    return {
      rank,
      totalXp: record.totalXp,
      revision: record.revision,
      pointsEarned: earned,
      pointsSpent: spent,
      pointsAvailable: Math.max(0, earned - spent),
      doctrinePoints: {
        earned,
        spent,
        available: Math.max(0, earned - spent),
      },
      build,
      buildLabel: build.length ? build.map((order) => `${order.name} ${order.points}`).join(" + ") : "Uninscribed",
      activeVows,
      activeVowNames: activeVows,
      receipts: record.receipts?.length || 0,
      lifetime: { ...(record.lifetime || {}) },
      updatedAt,
    };
  }

  function conflictState() {
    const record = loadCareerConflict();
    const branchState = (branch, label) => ({
      source: branch?.source || "",
      label,
      available: !!branch?.available,
      valid: !!branch?.valid,
      summary: branch?.valid ? careerSummary(branch.record, branch.capturedAt) : null,
      invalidReason: branch?.invalidReason || "",
    });
    return {
      active: !!record?.active,
      at: record?.at || 0,
      reason: record?.reason || "",
      branches: {
        local: branchState(record?.branches?.local, "This device"),
        synced: branchState(record?.branches?.synced, "Synced career"),
      },
    };
  }

  function validFieldProgression(value) {
    if (value === null || value === undefined) return true;
    if (!isRecord(value)) return false;
    const validate = ctx.progression?.validateField
      || ctx.progression?.validateFieldState;
    return typeof validate !== "function" || validate(value) !== false;
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
    const career = normalizeCareer(data.career);
    if (career === INVALID_CAREER) careerQuarantined = true;
    return {
      schema: SAVE_VERSION,
      career: career === INVALID_CAREER ? null : career,
      careerStatus: career === INVALID_CAREER ? "invalid" : career ? "valid" : "missing",
      autosave,
      manuals,
    };
  }

  /* Career persistence is an orthogonal account mutation. Preserve the raw
     field slots byte-for-structure even when a slot was authored by a newer
     build and this runtime cannot currently load it; resolving a career must
     never double as deleting a field save. */
  function readDataForCareerWrite() {
    const raw = slot.read()?.data;
    if (!isRecord(raw) || raw.schema !== SAVE_VERSION) return emptyData();
    return {
      schema: SAVE_VERSION,
      career: safeClone(raw.career, null),
      autosave: safeClone(raw.autosave, null),
      manuals: Array.from({ length: MANUAL_SLOTS }, (_, index) =>
        safeClone(raw.manuals?.[index], null)),
    };
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
    if (ctx.boost?.state?.active || ctx.slam?.state?.active
      || ctx.shield?.state?.active || ctx.player?.action) {
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
        bosses: `${mission.bossesDone || 0}/${ctx.mission.bosses?.length || 7}`,
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
      /* The corrupted Reliquary figure is domain-owned rather than rebuilt by
         the generic bestiary restore. Its summoned insects remain ordinary
         enemies and are rebound to this record by their stable IDs. */
      apostate: ctx.apostate?.snapshot?.() || null,
      distaff: ctx.distaff?.snapshot?.() || null,
      /* The pit does not have a position to save - it is the only boss
         in the game that cannot move - so its record carries the two
         things that ARE its state instead: how far open it is, and what
         each of the six limbs was doing. See `validateGarner`. */
      garner: ctx.garner?.snapshot?.() || null,
      /* The queen's record carries no position either - she cannot
         move - and deliberately no eggs or live brood: those are
         seconds-long consequences of an attack, and restoring into a
         chamber full of hatchlings the player never saw laid is worse
         than losing them. `royalDone` IS saved; repeating a
         once-per-encounter beat on every load would hand out unlimited
         Matriarchs. */
      abbess: ctx.abbess?.snapshot?.() || null,
      /* Which needle it is on is the whole of where this boss IS, so
         the perch index is saved and the flight is not: mid-leap and
         mid-plummet are a position on a curve plus a destination, and
         re-deriving those from a phase name would drop it through the
         district or hang it in open air. */
      stylite: ctx.stylite?.snapshot?.() || null,
      winnower: ctx.winnower?.snapshot?.() || null,
      districtBosses: ctx.districtBosses?.snapshot?.() || null,
      /* Only the venom already in the player. The pools on the ground
         and the globules in the air are deliberately not saved - see
         coulter.js - so a load never drops the player into a hazard
         they never saw arrive. */
      coulter: ctx.coulter?.snapshot?.() || null,
      weapon: ctx.weapons.snapshot?.() || null,
      boost: ctx.boost.status?.() || null,
      slam: ctx.slam?.status?.() || null,
      atmosphere: {
        time: ctx.atmos.time,
        storm: finite(ctx.atmos.storm),
        cyclePhase: finite(ctx.atmos.cyclePhase),
        cycleDuration: Math.max(60, finite(ctx.atmos.cycleDuration, DAY_CYCLE_SECONDS)),
        cycleRunning: !!ctx.atmos.cycleRunning,
        cycleCount: Math.max(0, Math.floor(finite(ctx.atmos.cycleCount))),
      },
      reliquary: {
        fuel: Math.max(0, finite(ctx.jetpack?.state?.fuel)),
        maxFuel: Math.max(1, finite(ctx.jetpack?.config?.maxFuel, 100)),
        cooldownRemaining: Math.max(0, finite(ctx.jetpack?.state?.cooldownRemaining)),
        rechargeDelayRemaining: Math.max(0, finite(ctx.jetpack?.state?.rechargeDelayRemaining)),
      },
      /* This is intentionally only the deployed/loadout state. Career XP,
         receipts, and the authoritative talent ledger are envelope data and
         must never be rolled backward by loading an old field save. */
      progression: ctx.progression?.captureField?.() || null,
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
    const phases = new Set([
      "districtBosses", "relays", "saintBoss", "cathedralBoss", "extract", "won", "lost",
    ]);
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
    if (mission.bosses !== undefined) {
      const bossKeys = new Set((ctx.mission.bosses || []).map((boss) => boss.key));
      const districtBossKeys = new Set((ctx.mission.bosses || [])
        .filter((boss) => boss.stage !== "penultimate").map((boss) => boss.key));
      if (!Array.isArray(mission.bosses)
        || ![bossKeys.size, districtBossKeys.size].includes(mission.bosses.length)
        || !Number.isInteger(mission.bossesDone)
        || mission.bossesDone < 0 || mission.bossesDone > mission.bosses.length) return false;
      const savedBossKeys = new Set();
      let bossesDone = 0;
      for (const boss of mission.bosses) {
        if (!isRecord(boss) || typeof boss.key !== "string"
          || !bossKeys.has(boss.key) || savedBossKeys.has(boss.key)
          || typeof boss.done !== "boolean") return false;
        savedBossKeys.add(boss.key);
        if (boss.done) bossesDone += 1;
      }
      const fullRoster = savedBossKeys.size === bossKeys.size
        && [...bossKeys].every((key) => savedBossKeys.has(key));
      const legacyRoster = savedBossKeys.size === districtBossKeys.size
        && [...districtBossKeys].every((key) => savedBossKeys.has(key));
      const districtsDone = [...districtBossKeys]
        .filter((key) => mission.bosses.find((boss) => boss.key === key)?.done).length;
      const saintDone = mission.bosses.find((boss) => boss.key === "saint")?.done === true;
      if ((!fullRoster && !legacyRoster) || bossesDone !== mission.bossesDone
        || (mission.phase === "saintBoss"
          && (!fullRoster || districtsDone !== districtBossKeys.size || saintDone))
        || (mission.phase === "cathedralBoss"
          && (districtsDone !== districtBossKeys.size || (fullRoster && !saintDone)))) return false;
    }
    for (const [key, spec] of Object.entries(ctx.mission.stratagems || {})) {
      if (!isFiniteNumber(mission.cooldowns[key]) || mission.cooldowns[key] < 0
        || mission.cooldowns[key] > spec.cooldown) return false;
    }
    /* Optional, so saves written before the Gilding Rite still load.
       The multipliers are bounded rather than merely finite: this field
       is the one place in the schema where a hand-edited number turns
       into damage output, and "1e9" is a valid float. */
    if (mission.boon !== null && mission.boon !== undefined) {
      const boon = mission.boon;
      if (!isRecord(boon)
        || ![boon.remaining, boon.seconds, boon.damage, boon.heat].every(isFiniteNumber)
        || boon.remaining < 0 || boon.seconds < 0 || boon.seconds > 600
        || boon.remaining > boon.seconds
        || boon.damage < 0.1 || boon.damage > 4
        || boon.heat < 0 || boon.heat > 4) return false;
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
      /* A burrower's cycle state. `phase` is checked against the exact
         set the state machine can be in rather than "is a string",
         because a bad phase does not throw - it silently strands the
         boss in a state nothing advances, which presents as a boss that
         never comes out of the ground. */
      if (enemy.body !== null && enemy.body !== undefined) {
        if (!isRecord(enemy.body)
          || !BURROW_PHASES.has(enemy.body.phase)
          || ![enemy.body.timer, enemy.body.heading, enemy.body.depth,
            enemy.body.x, enemy.body.y, enemy.body.z].every(isFiniteNumber)
          || enemy.body.timer < -2 || enemy.body.timer > 600
          || Math.abs(enemy.body.heading) > 100
          || Math.abs(enemy.body.depth) > 60
          || Math.abs(enemy.body.x) > 2000 || Math.abs(enemy.body.z) > 2000
          || Math.abs(enemy.body.y) > 2000
          || !Number.isInteger(enemy.body.surfacings)
          || enemy.body.surfacings < 0 || enemy.body.surfacings > 100000) return false;
      }
      enemyIds.add(enemy.id);
      enemyById.set(enemy.id, enemy);
      maxEnemyId = Math.max(maxEnemyId, idNumber);
    }
    if (enemies.nextId <= maxEnemyId) return false;
    for (const enemy of enemies.live) {
      if (enemy.broodIds.some((id) => !enemyIds.has(id))) return false;
    }

    const validateDistrictEncounter = (record, phases) => {
      if (record === null || record === undefined) return true;
      if (!isRecord(record) || !phases.has(record.phase)
        || ![record.timer, record.health, record.x, record.z, record.yaw]
          .every(isFiniteNumber)
        || record.timer < 0 || record.timer > 600
        || record.health < 0 || record.health > 10_000_000
        || Math.abs(record.x) > 2000 || Math.abs(record.z) > 2000
        || typeof record.defeated !== "boolean") return false;
      if (record.instanceId !== null && record.instanceId !== undefined
        && (typeof record.instanceId !== "string" || !enemyIds.has(record.instanceId))) return false;
      return true;
    };
    if (!validateDistrictEncounter(snapshot.distaff,
      new Set(["dormant", "alert", "standing", "collapsed", "recovering", "returning", "dead"]))) {
      return false;
    }
    if (!validateDistrictEncounter(snapshot.winnower,
      new Set(["dormant", "alert", "soar", "strafe", "land", "stoke", "launch", "return", "dead"]))) {
      return false;
    }
    /* The Garner's own validator rather than a loosened shared one. It
       has no x/z/yaw to check and six limb pools that do, and widening
       `validateDistrictEncounter` to make those optional would stop it
       catching a truncated Distaff record - which is the whole job. */
    const validateGarner = (record) => {
      if (record === null || record === undefined) return true;
      const phases = new Set(["dormant", "breach", "feeding", "gorge",
        "sealing", "dead"]);
      if (!isRecord(record) || !phases.has(record.phase)
        || ![record.timer, record.open, record.health].every(isFiniteNumber)
        || record.timer < 0 || record.timer > 600
        || record.open < 0 || record.open > 1
        || record.health < 0 || record.health > 10_000_000
        || typeof record.defeated !== "boolean") return false;
      if (record.instanceId !== null && record.instanceId !== undefined
        && (typeof record.instanceId !== "string"
          || !enemyIds.has(record.instanceId))) return false;
      const limbPhases = new Set(["sheathed", "erupt", "rear", "lash",
        "seize", "limp", "drag", "severed"]);
      for (const field of ["armHp", "armRegrow"]) {
        const list = record[field];
        if (list === null || list === undefined) continue;
        if (!Array.isArray(list) || list.length > 16
          || !list.every((v) => isFiniteNumber(v) && v >= 0 && v <= 100000)) return false;
      }
      if (record.armPhases !== null && record.armPhases !== undefined) {
        if (!Array.isArray(record.armPhases) || record.armPhases.length > 16
          || !record.armPhases.every((p) => limbPhases.has(p))) return false;
      }
      return true;
    };
    if (!validateGarner(snapshot.garner)) return false;
    const validateAbbess = (record) => {
      if (record === null || record === undefined) return true;
      const phases = new Set(["dormant", "rouse", "seated", "royal",
        "retire", "dead"]);
      if (!isRecord(record) || !phases.has(record.phase)
        || ![record.timer, record.health].every(isFiniteNumber)
        || record.timer < 0 || record.timer > 600
        || record.health < 0 || record.health > 10_000_000
        || typeof record.royalDone !== "boolean"
        || typeof record.defeated !== "boolean") return false;
      if (record.instanceId !== null && record.instanceId !== undefined
        && (typeof record.instanceId !== "string"
          || !enemyIds.has(record.instanceId))) return false;
      for (const field of ["fed", "laid"]) {
        const v = record[field];
        if (v === null || v === undefined) continue;
        if (!isFiniteNumber(v) || v < 0 || v > 100000) return false;
      }
      return true;
    };
    if (!validateAbbess(snapshot.abbess)) return false;
    const validateStylite = (record) => {
      if (record === null || record === undefined) return true;
      const phases = new Set(["dormant", "rouse", "perched", "retire", "dead"]);
      if (!isRecord(record) || !phases.has(record.phase)
        || ![record.timer, record.health].every(isFiniteNumber)
        || record.timer < 0 || record.timer > 600
        || record.health < 0 || record.health > 10_000_000
        || typeof record.defeated !== "boolean") return false;
      if (record.instanceId !== null && record.instanceId !== undefined
        && (typeof record.instanceId !== "string"
          || !enemyIds.has(record.instanceId))) return false;
      for (const field of ["perch", "grip", "falls"]) {
        const n = record[field];
        if (n === null || n === undefined) continue;
        if (!isFiniteNumber(n) || n < 0 || n > 100000) return false;
      }
      return true;
    };
    if (!validateStylite(snapshot.stylite)) return false;
    if (snapshot.districtBosses !== null && snapshot.districtBosses !== undefined) {
      const domain = snapshot.districtBosses;
      const expected = new Set((ctx.districtBosses?.status?.() || []).map((boss) => boss.key));
      const legacy = new Set([...expected].filter((key) => key !== "saint"));
      if (!isRecord(domain) || !Array.isArray(domain.bosses)
        || ![expected.size, legacy.size].includes(domain.bosses.length)) return false;
      const found = new Set();
      for (const record of domain.bosses) {
        if (!isRecord(record) || !expected.has(record.key) || found.has(record.key)
          || ![record.timer, record.disengageFor, record.health, record.maxHealth,
            record.x, record.z, record.yaw].every(isFiniteNumber)
          || !new Set(["dormant", "alert", "active", "dead"]).has(record.phase)
          || record.timer < 0 || record.timer > 600
          || record.disengageFor < 0 || record.disengageFor > 600
          || record.health < 0 || record.maxHealth < record.health
          || record.maxHealth > 10_000_000
          || Math.abs(record.x) > 2000 || Math.abs(record.z) > 2000
          || typeof record.defeated !== "boolean"
          || !(record.instanceId === null
            || (typeof record.instanceId === "string" && enemyIds.has(record.instanceId)))) return false;
        found.add(record.key);
      }
      const fullRoster = found.size === expected.size
        && [...expected].every((key) => found.has(key));
      const legacyRoster = found.size === legacy.size
        && [...legacy].every((key) => found.has(key));
      if (!fullRoster && !legacyRoster) return false;
    }

    /* Optional for pre-Apostate field saves. New Cathedral-boss saves carry
       an independent lifecycle record because a generic enemy restore would
       otherwise replace the figure behind its AI controller's closure. */
    const apostate = snapshot.apostate;
    if (apostate !== null && apostate !== undefined) {
      const apostatePhases = new Set(["dormant", "reveal", "duel", "dead"]);
      const apostateActions = new Set([
        null, "ranged", "shield", "boost", "summon", "vent", "jet",
        "melee1", "melee2", "melee3",
      ]);
      const cooldownKeys = ["summon", "shot", "melee", "boost", "shield", "jet"];
      if (!isRecord(apostate)
        || apostate.instanceId !== "sf-enemy-apostate"
        || !apostatePhases.has(apostate.phase)
        || !apostateActions.has(apostate.action ?? null)
        || ![apostate.timer, apostate.actionFor, apostate.actionElapsed,
          apostate.actionYaw, apostate.shotIndex, apostate.meleeStep, apostate.heat,
          apostate.sinceShot, apostate.shieldBlocks, apostate.altitude,
          apostate.deathStartAltitude, apostate.actionSerial, apostate.disengageFor,
          apostate.health, apostate.maxHealth, apostate.x, apostate.z,
          apostate.yaw].every(isFiniteNumber)
        || apostate.timer < 0 || apostate.actionFor < 0 || apostate.actionElapsed < 0
        || !Number.isInteger(apostate.shotIndex) || apostate.shotIndex < 0
        || apostate.shotIndex > 6
        || !Number.isInteger(apostate.meleeStep) || apostate.meleeStep < 0
        || apostate.meleeStep > 2
        || apostate.heat < 0 || apostate.heat > 1 || apostate.sinceShot < 0
        || !Number.isInteger(apostate.shieldBlocks) || apostate.shieldBlocks < 0
        || apostate.altitude < 0 || apostate.altitude > 12
        || apostate.deathStartAltitude < 0 || apostate.deathStartAltitude > 12
        || !Number.isInteger(apostate.actionSerial) || apostate.actionSerial < 0
        || apostate.disengageFor < 0 || apostate.disengageFor > 600
        || apostate.maxHealth < 1 || apostate.maxHealth > 10_000_000
        || apostate.health < 0 || apostate.health > apostate.maxHealth
        || Math.abs(apostate.x) > 2000 || Math.abs(apostate.z) > 2000
        || [apostate.actionHit, apostate.overheated, apostate.jetImpacted,
          apostate.victoryReported, apostate.revealed, apostate.defeated]
          .some((value) => typeof value !== "boolean")
        || !isRecord(apostate.cooldowns)
        || cooldownKeys.some((key) => !isFiniteNumber(apostate.cooldowns[key])
          || apostate.cooldowns[key] < -600 || apostate.cooldowns[key] > 600)
        || !Array.isArray(apostate.summonIds)
        || new Set(apostate.summonIds).size !== apostate.summonIds.length
        || apostate.summonIds.some((id) => typeof id !== "string" || !enemyIds.has(id))) {
        return false;
      }
    } else if (mission.phase === "cathedralBoss") return false;

    const breach = snapshot.breaches;
    const breachPhases = new Set(["dormant", "warning", "active", "intermission", "complete"]);
    const breachMembers = Array.isArray(breach?.memberIds) ? breach.memberIds : [];
    const uniqueBreachMembers = new Set(breachMembers);
    const buriedBreachMembers = Array.isArray(breach?.buried) ? breach.buried : [];
    const breachRecovering = breach?.recovering === true;
    const waveCount = ctx.breaches?.waves?.length || Number(breach?.waveCount) || 0;
    const allowedBlockedBosses = new Set([
      ...(ctx.mission?.bosses || []).map((boss) => boss.key), "apostate",
    ]);
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
      || (breach.recovering !== undefined && typeof breach.recovering !== "boolean")
      || (breach.retreatFor !== undefined
        && (!isFiniteNumber(breach.retreatFor) || breach.retreatFor < 0))
      || (breach.recoveries !== undefined
        && (!Number.isInteger(breach.recoveries) || breach.recoveries < 0))
      || !(breach.blockedByBoss === undefined || breach.blockedByBoss === null
        || allowedBlockedBosses.has(breach.blockedByBoss))
      || !validRngState(breach.rng)
      || !Array.isArray(breach.memberIds)
      || (breach.buried !== undefined && !Array.isArray(breach.buried))
      || uniqueBreachMembers.size !== breachMembers.length
      || breachMembers.some((id) => typeof id !== "string" || !enemyIds.has(id))
      || ((breach.phase === "warning" || breach.phase === "active")
        && breachMembers.length !== breach.remaining)
      || !(breach.bossId === null
        || (typeof breach.bossId === "string" && enemyIds.has(breach.bossId)))
      || !(breach.boss === null || (isRecord(breach.boss)
        && isFiniteNumber(breach.boss.health) && isFiniteNumber(breach.boss.maxHealth)
        && breach.boss.health >= 0 && breach.boss.maxHealth >= breach.boss.health))) return false;
    const waveSpecies = new Set((ctx.breaches?.waves || [])
      .flatMap((wave) => wave?.roster || []).map((entry) => entry?.key)
      .filter((key) => typeof key === "string" && key));
    if (buriedBreachMembers.some((record) => !isRecord(record)
      || !waveSpecies.has(record.key)
      || ![record.health, record.maxHealth, record.damageScale].every(isFiniteNumber)
      || record.health <= 0 || record.maxHealth < record.health || record.damageScale <= 0)) return false;
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
      breach.wave >= 1 && (breachRecovering || breach.wave < waveCount) && breach.waveIndex >= 0
      && noBreachMembers && !breach.complete
    );
    const recoveryShape = !breachRecovering || (
      breach.phase === "intermission" && buriedBreachMembers.length > 0
      && buriedBreachMembers.length <= breach.total
    );
    const completeShape = breach.phase !== "complete" || (
      breach.wave === waveCount && breach.waveIndex === waveCount - 1
      && noBreachMembers && breach.complete
    );
    const bossPresent = breach.bossId !== null;
    /* WHICH SPECIES MAY HOLD A BOSS BAR, from the wave table rather than
       as a literal. This check used to read `=== "matriarch"`, which was
       true when there was one boss and became a silent rejection of
       every save made during the second one: the payload was structurally
       perfect, so the load failed with "this save is incompatible" and
       nothing said why.

       The wave definitions are frozen module constants, not player data,
       so reading them is not the validator trusting its input. The
       literal fallback only matters if the breach module is absent
       entirely, in which case there is no event to validate. */
    const bossKeys = new Set((ctx.breaches?.waves || [])
      .map((wave) => wave?.bossKey)
      .filter((key) => typeof key === "string" && key));
    if (!bossKeys.size) {
      bossKeys.add("matriarch");
      bossKeys.add("coulter");
    }
    const bossShape = bossPresent === (breach.boss !== null)
      && (!bossPresent || (uniqueBreachMembers.has(breach.bossId)
        && bossKeys.has(enemyById.get(breach.bossId)?.key)));
    if (!dormantShape || !warningShape || !activeShape || !intermissionShape || !recoveryShape
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
    const baseAtmosphereValid = isRecord(atmosphere)
      && new Set(["goldenhour", "noon", "dusk", "night", "storm"]).has(atmosphere.time)
      && isFiniteNumber(atmosphere.storm) && atmosphere.storm >= 0 && atmosphere.storm <= 1;
    if (!baseAtmosphereValid) return false;
    const hasCycle = Object.prototype.hasOwnProperty.call(atmosphere, "cyclePhase")
      || Object.prototype.hasOwnProperty.call(atmosphere, "cycleDuration")
      || Object.prototype.hasOwnProperty.call(atmosphere, "cycleRunning")
      || Object.prototype.hasOwnProperty.call(atmosphere, "cycleCount");
    if (snapshot.progression !== undefined && !validFieldProgression(snapshot.progression)) {
      return false;
    }
    /* Optional, so saves written before the Coulter existed still load.
       Present and malformed is a rejection; absent is a zero. */
    if (snapshot.coulter !== null && snapshot.coulter !== undefined) {
      const venom = snapshot.coulter;
      if (!isRecord(venom) || !isFiniteNumber(venom.toxin)
        || venom.toxin < 0 || venom.toxin > 1) return false;
    }
    return !hasCycle || (
      isFiniteNumber(atmosphere.cyclePhase)
      && atmosphere.cyclePhase >= 0 && atmosphere.cyclePhase < 1
      && isFiniteNumber(atmosphere.cycleDuration)
      && atmosphere.cycleDuration >= 60 && atmosphere.cycleDuration <= 86400
      && typeof atmosphere.cycleRunning === "boolean"
      && Number.isInteger(atmosphere.cycleCount) && atmosphere.cycleCount >= 0
    );
  }

  function writeData(data, meta = {}) {
    /* Every field write re-reads the current account career immediately
       before committing the shared envelope. This prevents an already-open
       tab's stale in-memory field state from carrying stale XP back over a
       newer locally/cloud-synced career. */
    if (!ctx.qa && careerQuarantined && !meta.repair) return false;
    if (!ctx.qa && !meta.career) {
      const latest = readData();
      if (latest.careerStatus === "invalid") return false;
      data.career = latest.career;
    }
    /* `careerStatus` is a read-time diagnostic, never part of the durable
       schema. Rebuild the exact envelope shape here so recovery metadata or
       another caller's scratch fields cannot leak into account storage. */
    const durable = {
      schema: SAVE_VERSION,
      career: data.career ? clone(data.career) : null,
      autosave: data.autosave ? clone(data.autosave) : null,
      manuals: Array.from({ length: MANUAL_SLOTS }, (_, index) =>
        data.manuals?.[index] ? clone(data.manuals[index]) : null),
    };
    const ok = slot.save(durable, {
      label: "Saintfall field command",
      slots: durable.manuals.filter(Boolean).length + (durable.autosave ? 1 : 0),
      ...meta,
    });
    slot.refresh?.();
    return ok;
  }

  function writeCareer(career, meta = {}) {
    /* Deterministic QA sessions must never write into a player's real local
       envelope. Progression also keeps an in-memory QA profile, but this
       guard makes the persistence boundary safe on its own. */
    if (ctx.qa) return true;
    const normalized = normalizeCareer(career);
    if (normalized === INVALID_CAREER) return false;
    if (careerQuarantined && meta.repair !== true) {
      /* Gameplay may continue while the menu is waiting for a recovery
         choice. Keep legitimate same-device gains/build edits folded into
         the durable device branch so choosing it never drops progress earned
         after the conflict was detected. The write still reports paused to
         progression; nothing touches the shared account envelope yet. */
      const conflict = loadCareerConflict();
      const local = conflict?.branches?.local;
      if (conflict?.active && local?.valid
        && !sameCareer(local.record, normalized)
        && careerDominates(normalized, local.record, { requireSameBuild: false })) {
        conflict.branches.local = conflictBranch(normalized, "device", Date.now());
        persistCareerConflict(conflict);
      }
      return false;
    }
    const data = readDataForCareerWrite();
    data.career = normalized;
    return writeData(data, { career: true, ...meta });
  }

  function resolveCareerConflict(choice) {
    const aliases = {
      local: "local",
      device: "local",
      synced: "synced",
      cloud: "synced",
      incoming: "synced",
    };
    const selected = aliases[String(choice || "").toLowerCase()] || "";
    const record = loadCareerConflict();
    if (!selected) {
      const result = {
        ok: false,
        reason: "invalid-choice",
        message: "Choose this device or the synced career.",
        choice: null,
        conflict: conflictState(),
      };
      notify("career-conflict-error", result);
      return result;
    }
    if (!record?.active) {
      const result = {
        ok: false,
        reason: "no-conflict",
        message: "No career conflict is waiting for recovery.",
        choice: selected,
        conflict: conflictState(),
      };
      notify("career-conflict-error", result);
      return result;
    }
    const branch = record.branches[selected];
    const normalized = branch?.valid ? normalizeCareer(branch.record) : INVALID_CAREER;
    if (normalized === INVALID_CAREER || normalized === null) {
      const result = {
        ok: false,
        reason: "invalid-branch",
        message: `${selected === "local" ? "This device" : "The synced career"} cannot be recovered because its record is invalid.`,
        choice: selected,
        conflict: conflictState(),
      };
      notify("career-conflict-error", result);
      return result;
    }

    /* Keep field slots from the envelope as it exists at click time. In QA,
       exercise the same validation and runtime restore but never write the
       shared slot or localStorage. */
    const data = readDataForCareerWrite();
    const previousRuntime = ctx.progression?.captureCareer?.() || null;
    let written = true;
    if (!ctx.qa) {
      data.career = normalized;
      written = writeData(data, {
        career: true,
        repair: true,
        recoveryChoice: selected,
      });
      const verify = written ? normalizeCareer(slot.read()?.data?.career) : INVALID_CAREER;
      written = written && verify !== INVALID_CAREER && sameCareer(verify, normalized);
    }
    if (!written) {
      const result = {
        ok: false,
        reason: "write-failed",
        message: "The recovered career could not be written. Both copies remain preserved.",
        choice: selected,
        conflict: conflictState(),
      };
      notify("career-conflict-error", result);
      return result;
    }

    const restored = ctx.progression?.restoreCareer?.(normalized, {
      source: "career-recovery",
      persist: false,
      preserveField: true,
    });
    if (restored?.ok === false) {
      if (!ctx.qa && previousRuntime) {
        data.career = normalizeCareer(previousRuntime) === INVALID_CAREER
          ? normalized : normalizeCareer(previousRuntime);
        writeData(data, { career: true, repair: true, recoveryRollback: true });
      }
      const result = {
        ok: false,
        reason: restored.reason || "restore-failed",
        message: "The recovered career could not be activated safely. Both copies remain preserved.",
        choice: selected,
        conflict: conflictState(),
      };
      notify("career-conflict-error", result);
      return result;
    }

    /* The backup is the final commit marker: leave it intact through every
       validation, write, readback, and runtime-restore step. */
    if (!ctx.qa) {
      try {
        localStorage.removeItem(CAREER_CONFLICT_KEY);
        if (localStorage.getItem(CAREER_CONFLICT_KEY) !== null) {
          throw new Error("conflict backup remained after removal");
        }
      } catch (_) {
        const result = {
          ok: false,
          reason: "backup-clear-failed",
          message: "The career was recovered, but its safety backup could not be cleared. Recovery remains paused.",
          choice: selected,
          conflict: conflictState(),
        };
        notify("career-conflict-error", result);
        return result;
      }
    }
    careerConflictRecord = null;
    careerConflictLoaded = true;
    careerQuarantined = false;
    careerHydrated = true;
    careerBaseline = JSON.stringify(normalized);
    careerBaselineHadRecord = true;
    autosaveFailures = 0;
    autosaveRetryRemaining = 0;
    const result = {
      ok: true,
      reason: "",
      message: selected === "local" ? "This device's career was kept."
        : "The synced career was restored.",
      choice: selected,
      state: careerSummary(normalized, Date.now()),
      conflict: conflictState(),
    };
    notify("career-conflict-resolved", result);
    return result;
  }

  function stageCareerConflictForQA(localCareer, syncedCareer, reason = "qa-career-conflict") {
    if (!ctx.qa) {
      return {
        ok: false,
        reason: "qa-only",
        message: "Career conflict staging is available only in deterministic QA.",
        choice: null,
        conflict: conflictState(),
      };
    }
    const at = Date.now();
    const record = {
      schema: 2,
      active: true,
      at,
      reason,
      branches: {
        local: conflictBranch(localCareer, "device", at),
        synced: conflictBranch(syncedCareer, "synced", at),
      },
    };
    if (!record.branches.local.valid && !record.branches.synced.valid) {
      return {
        ok: false,
        reason: "no-valid-branch",
        message: "At least one staged career branch must be valid.",
        choice: null,
        conflict: conflictState(),
      };
    }
    persistCareerConflict(record);
    const result = {
      ok: true,
      reason: "",
      message: "QA career conflict staged in memory.",
      choice: null,
      conflict: conflictState(),
    };
    notify("career-conflict", result);
    return result;
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
    if (!force && autosaveRetryRemaining > 0) return null;
    if (!force && autosaveClock < AUTOSAVE_AFTER) return null;
    const snapshot = capture();
    if (!snapshot) return null;
    const data = readData();
    data.autosave = { id: "autosave", snapshot };
    if (!writeData(data, { autosave: true })) {
      autosaveClock = AUTOSAVE_AFTER;
      autosaveFailures = Math.min(8, autosaveFailures + 1);
      autosaveRetryRemaining = Math.min(AUTOSAVE_RETRY_MAX,
        AUTOSAVE_RETRY_BASE * (2 ** (autosaveFailures - 1)));
      notify("autosave-deferred", {
        message: `Autosave delayed; retrying in ${Math.ceil(autosaveRetryRemaining)} seconds.`,
        retryIn: autosaveRetryRemaining,
      });
      return null;
    }
    autosaveClock = 0;
    autosaveFailures = 0;
    autosaveRetryRemaining = 0;
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
    const savedAtmosphere = snapshot.atmosphere || {};
    if (isFiniteNumber(savedAtmosphere.cyclePhase)
      && typeof options.setDayCycle === "function") {
      options.setDayCycle(savedAtmosphere.cyclePhase,
        savedAtmosphere.cycleRunning !== false, savedAtmosphere.cycleCount || 0);
    } else if (savedAtmosphere.time && typeof options.setDayCycle === "function") {
      /* Schema-2 saves made before the natural cycle only know a named
         preset. Place them at the matching hour and let production
         continue; deterministic QA restores stay fixed. */
      const legacyPhase = {
        goldenhour: 0, noon: 0.25, dusk: 0.5, night: 0.72, storm: 0,
      }[savedAtmosphere.time] ?? 0;
      options.setDayCycle(legacyPhase, !ctx.qa, 0);
    } else if (savedAtmosphere.time && typeof options.setTime === "function") {
      options.setTime(savedAtmosphere.time);
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
    if (snapshot.apostate) {
      if (ctx.apostate?.restore?.(snapshot.apostate, restoredEnemies) === false) {
        throw new Error("Apostate encounter restore was rejected.");
      }
    } else {
      /* Legacy field saves predate the encounter. They keep their original
         extraction/win semantics while the new figure remains dormant. */
      ctx.apostate?.reset?.();
    }
    if (ctx.combat.restore?.(snapshot.combat) === false) {
      throw new Error("Combat state restore was rejected.");
    }
    if (!ctx.mission.restore(snapshot.mission)) {
      throw new Error("Mission state restore was rejected.");
    }
    if (snapshot.distaff) {
      if (ctx.distaff?.restore?.(snapshot.distaff, restoredEnemies) === false) {
        throw new Error("Distaff encounter restore was rejected.");
      }
    } else if (ctx.mission.bosses?.find((boss) => boss.key === "scar")?.done) {
      ctx.distaff?.restore?.({ phase: "dead", health: 0, defeated: true }, restoredEnemies);
    }
    if (snapshot.winnower) {
      if (ctx.winnower?.restore?.(snapshot.winnower, restoredEnemies) === false) {
        throw new Error("Winnower encounter restore was rejected.");
      }
    } else if (ctx.mission.bosses?.find((boss) => boss.key === "censer")?.done) {
      ctx.winnower?.restore?.({ phase: "dead", health: 0, defeated: true }, restoredEnemies);
    }
    if (snapshot.abbess) {
      if (ctx.abbess?.restore?.(snapshot.abbess, restoredEnemies) === false) {
        throw new Error("Abbess encounter restore was rejected.");
      }
    } else if (ctx.mission.bosses?.find((boss) => boss.key === "bloom")?.done) {
      ctx.abbess?.restore?.({ phase: "dead", health: 0, royalDone: true,
        defeated: true }, restoredEnemies);
    } else {
      /* A save written before the Bloom queen existed still names the
         district; the Matriarch that used to stand there was an
         ordinary record in `districtBosses`. Seat her rather than
         leaving whatever the constructor built. */
      ctx.abbess?.resetToSeat?.();
    }
    if (snapshot.stylite) {
      if (ctx.stylite?.restore?.(snapshot.stylite, restoredEnemies) === false) {
        throw new Error("Stylite encounter restore was rejected.");
      }
    } else if (ctx.mission.bosses?.find((boss) => boss.key === "choir")?.done) {
      ctx.stylite?.restore?.({ phase: "dead", health: 0, defeated: true },
        restoredEnemies);
    } else {
      /* A save written before the Choir's tenant existed still names
         the district; the Precentor that used to stand there was an
         ordinary record in `districtBosses`. Seat it rather than
         leaving whatever the constructor built. */
      ctx.stylite?.resetToPerch?.();
    }
    if (snapshot.garner) {
      if (ctx.garner?.restore?.(snapshot.garner, restoredEnemies) === false) {
        throw new Error("Garner encounter restore was rejected.");
      }
    } else if (ctx.mission.bosses?.find((boss) => boss.key === "ossuary")?.done) {
      ctx.garner?.restore?.({ phase: "dead", health: 0, defeated: true }, restoredEnemies);
    } else {
      /* A save written before the Ossuary boss existed still names the
         district in its mission record, and the placeholder that used
         to stand there was an ordinary enemy in `districtBosses`. Snap
         the pit shut rather than leaving it in whatever state the
         constructor happened to build it in. */
      ctx.garner?.resetToPit?.();
    }
    if (ctx.districtBosses?.restore?.(snapshot.districtBosses || {}, restoredEnemies) === false) {
      throw new Error("District boss restore was rejected.");
    }
    ctx.breaches?.restore?.(snapshot.breaches || {});
    /* Restored after the enemies, because it also clears the venom on
       the ground - and a load that left the previous session's pools
       standing would poison the player at the new position. */
    ctx.coulter?.restore?.(snapshot.coulter || {});
    ctx.boost?.restore?.(snapshot.boost || {});
    ctx.slam?.restore?.(snapshot.slam || {});
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
    /* Legacy schema-2 snapshots do not carry a deployed doctrine. In that
       case retain the current career build rather than treating it as a
       reset, while still restoring an explicitly captured field loadout. */
    if (snapshot.progression !== null && snapshot.progression !== undefined) {
      ctx.progression?.restoreField?.(snapshot.progression);
    } else {
      ctx.progression?.clearFieldLoadout?.({ source: "legacy-field-save" });
    }
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
    autosaveRetryRemaining = Math.max(0,
      autosaveRetryRemaining - Math.max(0, finite(dt)));
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
      career: data.career ? clone(data.career) : null,
      careerStatus: data.careerStatus,
      careerQuarantined,
      careerConflict: conflictState(),
      autosaveRetryIn: autosaveRetryRemaining,
      lastResult: lastResult ? clone(lastResult) : null,
      current: capture(),
    };
  }

  window.addEventListener("pagehide", () => {
    if (autosaveClock > 5) saveAuto(true);
  });

  /* Hydrate once from the local envelope, then again after the optional cloud
     merge finishes. The progression service owns merge/normalization rules;
     save.js only provides the durable account record and never asks a field
     snapshot to restore career XP. */
  function hydrateCareer({ reconcile = false } = {}) {
    if (ctx.qa) return;
    const preserved = loadCareerConflict();
    if (preserved?.active) {
      careerQuarantined = true;
      if (!careerHydrated) {
        const recoveryBranch = preserved.branches.local?.valid
          ? preserved.branches.local : preserved.branches.synced;
        if (recoveryBranch?.valid) {
          const restored = ctx.progression?.restoreCareer?.(recoveryBranch.record, {
            source: "career-conflict-backup",
            persist: false,
            preserveField: true,
          });
          if (restored?.ok !== false) {
            careerHydrated = true;
            careerBaseline = JSON.stringify(recoveryBranch.record);
            careerBaselineHadRecord = true;
          }
        }
      }
      if (!reconcile) {
        notify("career-conflict", {
          message: "Two career records are preserved. Choose which one to continue.",
          conflict: conflictState(),
        });
      }
      return;
    }
    const savedRecord = readData();
    if (savedRecord.careerStatus === "invalid") {
      careerQuarantined = true;
      const rawStored = safeClone(slot.read()?.data?.career, null);
      preserveCareerConflict(ctx.progression?.captureCareer?.(), rawStored,
        "invalid-stored-career");
      notify("career-conflict", {
        message: "The synced career is invalid. A valid device copy is preserved for recovery.",
        conflict: conflictState(),
      });
      console.error("[saintfall] invalid career progression was quarantined; the stored record was not overwritten");
      return;
    }
    const saved = savedRecord.career;
    /* A missing/corrupt cloud record must never erase a valid career that was
       already hydrated locally or earned while the merge was in flight. */
    const current = ctx.progression?.captureCareer?.() || null;
    let baseline = null;
    try { baseline = careerBaseline ? JSON.parse(careerBaseline) : null; } catch (_) { baseline = null; }
    let result = { ok: true };
    let adopted = current;

    if (!reconcile || !careerHydrated) {
      result = ctx.progression?.restoreCareer?.(saved, {
        source: "save",
        persist: false,
        preserveField: false,
      });
      adopted = ctx.progression?.captureCareer?.() || saved;
      careerBaselineHadRecord = !!saved;
    } else if (!saved || sameCareer(saved, current)) {
      /* A missing cloud record never erases live play. An equal record needs
         no mutation, but still closes the reconciliation baseline. */
      adopted = current;
    } else {
      const changedLocally = baseline ? !sameCareer(current, baseline) : !!current;
      const changedRemotely = baseline ? !sameCareer(saved, baseline) : !!saved;
      const incomingDescends = careerDominates(saved, current);
      const localDescends = careerDominates(current, saved);

      if (!careerBaselineHadRecord && !changedLocally) {
        result = ctx.progression?.restoreCareer?.(saved, {
          source: "cloud",
          persist: false,
          preserveField: true,
        });
        adopted = saved;
      } else if (incomingDescends) {
        result = ctx.progression?.restoreCareer?.(saved, {
          source: "cloud",
          persist: false,
          preserveField: true,
        });
        adopted = saved;
      } else if (localDescends && (changedLocally || !changedRemotely)) {
        adopted = current;
        if (!writeCareer(current, { reason: "career-reconcile-local" })) {
          result = { ok: false, reason: "career-write-failed" };
        }
      } else {
        /* This includes every build disagreement, even if the incoming branch
           has a higher revision and all monotonic XP counters. A revision is
           not ancestry; an explicit player choice is required. */
        result = { ok: false, reason: "career-conflict" };
      }
    }
    if (result?.ok === false) {
      careerQuarantined = true;
      preserveCareerConflict(current, saved, result.reason || "career-sync-conflict");
      notify("career-conflict", {
        message: "Career progress changed in two places. Both copies are preserved for recovery.",
        conflict: conflictState(),
      });
      console.error("[saintfall] career sync conflict was quarantined; local progression remains active and automatic persistence is paused");
      return;
    }
    careerHydrated = true;
    careerBaseline = JSON.stringify(adopted || ctx.progression?.captureCareer?.() || null);
    careerBaselineHadRecord = reconcile
      ? careerBaselineHadRecord || !!saved
      : !!saved;
  }

  hydrateCareer();
  ctx.progression?.attachPersistence?.({
    read: () => clone(readData().career),
    write: writeCareer,
    readCareer: () => clone(readData().career),
    writeCareer,
  });
  /* Capture the device baseline before asking the shared synchronizer to
     mutate its slot. Even an implementation that completes synchronously can
     no longer replace the local branch before we have a three-way baseline.
     Saintfall boots after the synchronizer's normal auth pass, so this fresh
     merge still prevents a late-loading game from missing the cloud copy. */
  const cloudSync = Promise.resolve().then(() => window.RBGameSaves?.syncWithCloud?.())
    .catch(() => null);
  void cloudSync.then(() => hydrateCareer({ reconcile: true }));

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
    writeCareer,
    conflictState,
    resolveCareerConflict,
    stageCareerConflictForQA,
    update,
    state,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
