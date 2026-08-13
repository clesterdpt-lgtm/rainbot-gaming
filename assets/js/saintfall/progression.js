/* ============================================================
   SAINTFALL - Field Rank and Doctrine runtime

   One authoritative owner for career XP, ranked rites, Vow Seals,
   deployed loadouts, and the gameplay effects those choices enable.
   Field saves may restore a build, but never rewind career XP.
   ============================================================ */

import {
  PROGRESSION_CONFIG,
  PROGRESSION_SCHEMA_VERSION,
  FIELD_RANK_CAP,
  FIELD_RANK_XP_THRESHOLDS,
  XP_AWARDS,
  DOCTRINE_ORDERS,
  DOCTRINE_POINTS_PER_RANK,
  DOCTRINE_POINT_START_RANK,
  VOW_SEAL_RANKS,
  MAX_POINTS_PER_ORDER,
  CAPSTONE_ELIGIBILITY_POINTS,
  MAX_ACTIVE_CAPSTONES,
} from "saintfall/progression-config.js";
import { makeBus } from "saintfall/core.js";

const FIELD_SCHEMA_VERSION = 1;
const RECEIPT_LIMIT = 12000;
const RECEIPT_MAX_LENGTH = 240;

const clone = (value) => JSON.parse(JSON.stringify(value));
const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeReceipt = (value) => {
  if (typeof value !== "string") return "";
  const receipt = value.trim();
  return receipt && receipt.length <= RECEIPT_MAX_LENGTH ? receipt : "";
};

const TALENTS = new Map();
const CAPSTONES = new Map();
const ORDERS = new Map();
const STRATAGEM_KEYS = new Set(["orbital", "cluster", "resupply"]);
for (const order of DOCTRINE_ORDERS) {
  ORDERS.set(order.id, order);
  for (const talent of order.talents) TALENTS.set(talent.id, talent);
  if (order.capstone) CAPSTONES.set(order.capstone.id, order.capstone);
}

/* Every rite below is a deployed mechanic. Keeping this list explicit makes
   persistence validation fail closed if a future data-only preview is added
   before its gameplay bridge exists. */
const IMPLEMENTED_TALENTS = new Set([
  "censer_rite_of_censure",
  "censer_ashen_rebuke",
  "censer_gold_nail",
  "censer_furnace_reprieve",
  "procession_hooking_step",
  "procession_third_toll",
  "procession_executioners_measure",
  "procession_processional_mercy",
  "wing_wingbeat_conversion",
  "wing_falling_gospel",
  "wing_gravitic_wake",
  "wing_rams_halo",
  "halo_votive_parry",
  "halo_stored_wrath",
  "halo_pilgrims_reversal",
  "halo_mercy_circuit",
  "edict_siren_beacon",
  "edict_live_fuse",
  "edict_recall_rite",
  "edict_field_chapel",
]);

const IMPLEMENTED_CAPSTONES = new Set([
  "censer_martyrs_furnace",
  "procession_endless_litany",
  "wing_unbroken_circuit",
  "halo_seraph_aegis",
  "edict_combined_liturgy",
]);

const IMPLEMENTATION_NOTE = "This rite is authored for the next Doctrine expansion and cannot consume a point yet.";

/* Player-facing copy is the balance contract: it describes what this runtime
   executes, including concrete timing and limits hidden by the shorter data
   summaries. */
const MVP_COPY = Object.freeze({
  censer_rite_of_censure: {
    summary: "Brand with precision, then break the brand in melee.",
    ranks: [
      "A headshot or weak-point hit brands the enemy for 5 seconds. Melee consumes it for 35% bonus damage and removes 12% weapon heat.",
      "Breaking the brand also releases a 4-metre stagger pulse around the target.",
    ],
  },
  censer_ashen_rebuke: {
    summary: "Turn a high-heat manual vent into an attack.",
    ranks: [
      "Venting at 60% heat or higher sends a short stagger pulse ahead of the Reliquary.",
      "Venting at 85% heat or higher widens the pulse and deals 45 damage.",
    ],
  },
  censer_gold_nail: {
    summary: "Carry one precision hit into a heatless follow-up.",
    ranks: [
      "A headshot or weak-point hit arms the next rifle shot for 4 seconds; that shot produces no heat.",
      "The heatless shot also removes 6% existing weapon heat.",
    ],
  },
  censer_furnace_reprieve: {
    summary: "Use kills near redline to keep the lance speaking.",
  },
  procession_hooking_step: {
    summary: "Make the second strike interrupt the brood around you.",
    ranks: [
      "A connected second combo strike emits a 3-metre stagger pulse.",
      "The pulse reaches 5 metres and staggers for longer.",
    ],
  },
  procession_third_toll: {
    summary: "Turn a clean three-hit procession into a rupture.",
  },
  procession_executioners_measure: {
    summary: "Expose a heavy enemy by keeping all three strikes on it.",
    ranks: [
      "Landing all three strikes on one Harrow or Matriarch exposes it; the next rifle hit deals 40% bonus damage.",
      "The exposure lasts 6 seconds instead of 4 and the finisher adds a stagger pulse.",
    ],
  },
  procession_processional_mercy: {
    summary: "Let one decisive melee kill sustain each combo.",
    ranks: [
      "The first melee-combo kill restores 6 Reliquary charge, once per combo.",
      "A third-strike kill restores 12 charge instead.",
    ],
  },
  wing_wingbeat_conversion: {
    summary: "Carry a ground charge cleanly into flight.",
    ranks: [
      "Igniting the jet within 0.45 seconds after a boost ends refunds the ignition cost.",
      "The window becomes 0.7 seconds and the first airborne rifle shot produces no heat.",
    ],
  },
  wing_falling_gospel: {
    summary: "Feed airborne rifle kills into Penitent's Fall.",
  },
  wing_gravitic_wake: {
    summary: "A mobility boost leaves a brief field that repeatedly staggers light enemies.",
    ranks: [
      "A sideways or backward boost leaves a 2.5-second, 2.5-metre Gravitic Wake.",
      "The Wake reaches 4 metres and its stagger pulses last longer.",
    ],
  },
  wing_rams_halo: {
    summary: "Prime the next Fall with a committed forward boost.",
    ranks: [
      "A forward boost emits a 4-metre stagger pulse and primes the next Penitent's Fall for 3 seconds.",
      "The primed Fall gains 20% damage and 2 metres of radius.",
    ],
  },
  halo_votive_parry: {
    summary: "Give a precisely raised Aegis an offensive answer.",
    ranks: [
      "Blocking within 0.25 seconds of raising Aegis emits a 3-metre stagger pulse.",
      "A perfect guard also returns charge based on the force absorbed and fires a 45-damage bolt back at an identified Gleaner attacker.",
    ],
  },
  halo_stored_wrath: {
    summary: "Return absorbed force when the shield falls.",
    ranks: [
      "Aegis stores 25% of blocked damage, up to 60. Releasing after a block sends that damage through a frontal pulse reaching 4 metres.",
      "Aegis stores 40% of blocked damage, up to 100, and the frontal pulse reaches 6 metres.",
    ],
  },
  halo_pilgrims_reversal: {
    summary: "Turn a block into immediate repositioning.",
    ranks: [
      "A successful Aegis block arms one charge-free backward boost for 1.25 seconds.",
      "The free boost follows your chosen direction and its first enemy contact staggers for 0.75 seconds.",
    ],
  },
  halo_mercy_circuit: {
    summary: "Keep a relay rite moving behind the Aegis.",
    ranks: [
      "Relay channel progress continues at 50% speed while Aegis is raised, with 50% additional shield drain.",
      "Protected relay progress rises to 75% speed with normal shield drain.",
    ],
  },
  censer_martyrs_furnace: {
    summary: "Turn a near-redline purge into a violent reprieve.",
    description: "A manual vent begun above 80% heat releases a second furnace blast, deals heavy damage, and restores 8 Reliquary charge.",
  },
  procession_endless_litany: {
    summary: "Let a clean finisher open an empowered next verse.",
    description: "After a connected third strike, landing the next first strike within 1.5 seconds releases a Bellstrike and restores 8 Reliquary charge. Every clean verse can continue the Litany.",
  },
  wing_unbroken_circuit: {
    summary: "Complete a circuit of distinct Reliquary actions.",
    description: "Use any 3 distinct Reliquary verbs - boost, jet, Penitent's Fall, or perfect guard - within 8 seconds to restore 25 charge and release a 6-metre halo shockwave. The Circuit then cools down for 12 seconds.",
  },
  halo_seraph_aegis: {
    summary: "Commit the Reliquary to a stationary defensive dome.",
    description: "Hold Aegis while stationary for 1 second to form a 360-degree dome. Movement is locked and shield drain is doubled; releasing returns up to 150 damage absorbed by the dome as an 8-metre radial blast. A dome release supersedes Stored Wrath.",
  },
  edict_siren_beacon: {
    summary: "Make offensive command markers gather their own targets.",
  },
  edict_live_fuse: {
    summary: "Spend gunfire to hurry an inbound strike.",
  },
  edict_recall_rite: {
    summary: "Correct one command before its final lock.",
    ranks: [
      "Before the final 0.6 seconds, reissuing the same inbound command relocates it once and adds 2 seconds to its remaining delay.",
      "Relocation adds only 0.75 seconds and keeps the marker's current Siren pull.",
    ],
  },
  edict_field_chapel: {
    summary: "Turn a reinforcement pod into a contested sanctuary.",
  },
  edict_combined_liturgy: {
    summary: "Fuse two different commands into one authored battlefield event.",
    description: "Each command impact leaves an 8-second, 9-metre sigil. Calling a different command inside it consumes that sigil and fuses the pair; Combined Liturgy then has a 30-second shared cooldown.",
  },
});

function annotatedDefinitions() {
  const definitions = clone(PROGRESSION_CONFIG);
  for (const order of definitions.doctrine.orders) {
    for (const talent of order.talents) {
      talent.implemented = IMPLEMENTED_TALENTS.has(talent.id);
      if (!talent.implemented) talent.implementationNote = IMPLEMENTATION_NOTE;
      const copy = MVP_COPY[talent.id];
      if (copy?.summary) talent.summary = copy.summary;
      if (copy?.ranks) talent.ranks = talent.ranks.map((rank, index) => ({
        ...rank,
        description: copy.ranks[index] || rank.description,
      }));
    }
    if (order.capstone) {
      order.capstone.implemented = IMPLEMENTED_CAPSTONES.has(order.capstone.id);
      if (!order.capstone.implemented) order.capstone.implementationNote = IMPLEMENTATION_NOTE;
      const copy = MVP_COPY[order.capstone.id];
      if (copy?.summary) order.capstone.summary = copy.summary;
      if (copy?.description) order.capstone.description = copy.description;
    }
  }
  return definitions;
}

const DEFINITIONS = annotatedDefinitions();

function freshCareer() {
  return {
    schema: PROGRESSION_SCHEMA_VERSION,
    totalXp: 0,
    allocations: {},
    activeCapstones: [null, null],
    receipts: [],
    revision: 0,
    lifetime: { kills: 0, relays: 0, breachWaves: 0, breachCycles: 0, operations: 0 },
  };
}

function rankForXp(totalXp) {
  let rank = 1;
  for (let index = 1; index < FIELD_RANK_XP_THRESHOLDS.length; index += 1) {
    if (totalXp < FIELD_RANK_XP_THRESHOLDS[index]) break;
    rank = index + 1;
  }
  return Math.min(FIELD_RANK_CAP, rank);
}

function pointsEarnedForRank(rank) {
  const earnedRanks = Math.max(0,
    Math.min(FIELD_RANK_CAP, Math.floor(rank)) - DOCTRINE_POINT_START_RANK + 1);
  return earnedRanks * DOCTRINE_POINTS_PER_RANK;
}

function sealsEarnedForRank(rank) {
  return VOW_SEAL_RANKS.filter((threshold) => rank >= threshold).length;
}

function pointsInOrder(allocations, orderId) {
  const order = ORDERS.get(orderId);
  if (!order) return 0;
  return order.talents.reduce((sum, talent) => sum + (allocations[talent.id] || 0), 0);
}

function pointsSpent(allocations) {
  return Object.values(allocations).reduce((sum, value) => sum + value, 0);
}

function normalizeAllocations(raw, { allowForthcoming = false } = {}) {
  if (!isRecord(raw)) return null;
  const allocations = {};
  for (const [id, value] of Object.entries(raw)) {
    const talent = TALENTS.get(id);
    const amount = value;
    if (!talent || typeof amount !== "number" || !Number.isInteger(amount)
      || amount < 0 || amount > talent.maxRank) return null;
    if (amount > 0 && !allowForthcoming && !IMPLEMENTED_TALENTS.has(id)) return null;
    if (amount > 0) allocations[id] = amount;
  }
  for (const order of DOCTRINE_ORDERS) {
    const invested = pointsInOrder(allocations, order.id);
    if (invested > MAX_POINTS_PER_ORDER) return null;
    for (const talent of order.talents) {
      if ((allocations[talent.id] || 0) > 0
        && invested < (talent.requires?.orderPoints || 0)) return null;
    }
  }
  return allocations;
}

function normalizeCapstones(raw, allocations, rank, { allowForthcoming = false } = {}) {
  if (!Array.isArray(raw) || raw.length > MAX_ACTIVE_CAPSTONES) return null;
  const active = [null, null];
  const seen = new Set();
  for (let index = 0; index < raw.length; index += 1) {
    const id = raw[index];
    if (id === null) continue;
    if (typeof id !== "string" || !id) return null;
    const capstone = CAPSTONES.get(id);
    if (!capstone || seen.has(id)) return null;
    if (!allowForthcoming && !IMPLEMENTED_CAPSTONES.has(id)) return null;
    if (pointsInOrder(allocations, capstone.orderId) < CAPSTONE_ELIGIBILITY_POINTS) return null;
    if (index >= sealsEarnedForRank(rank)) return null;
    active[index] = id;
    seen.add(id);
  }
  return active;
}

export function buildProgression(ctx) {
  let career = freshCareer();
  let persistence = null;
  let persistTimer = 0;
  let clock = 0;
  let disposed = false;
  const listeners = new Set();
  const bus = makeBus();
  const stops = [];
  const operationBase = ctx.qa ? `qa-${ctx.seed}` : `op-${ctx.seed.toString(16)}-${Date.now().toString(36)}`;
  const field = {
    operationId: operationBase,
    startedAt: Date.now(),
    loadout: null,
  };
  const effects = {
    brands: new Map(),
    exposed: new Map(),
    goldNailUntil: 0,
    wingShotUntil: 0,
    lastBoostAt: -Infinity,
    furnaceReadyAt: 0,
    feathers: 0,
    wake: null,
    ramPrimeUntil: 0,
    circuit: { verbs: new Map(), readyAt: 0 },
    comboTargets: new Set(),
    comboConnected: false,
    comboMercyUsed: false,
    litanyUntil: 0,
    halo: {
      storedWrath: 0,
      storedWrathBlocks: 0,
      reversalUntil: 0,
      reversalYaw: 0,
      reversalPending: false,
      reversalBoostSerial: 0,
      domeActive: false,
      domeStored: 0,
      domeBlocks: 0,
      lastDomeBlast: 0,
      mercyCueAt: 0,
    },
    edict: {
      beacons: new Map(),
      sanctuaries: new Map(),
      sigils: new Map(),
      fusionReadyAt: 0,
      lastFusion: null,
    },
    feedback: { serial: 0, last: null, counts: {} },
    counters: {},
  };

  const effectiveAllocations = () => field.loadout?.allocations || career.allocations;
  const effectiveCapstones = () => field.loadout?.activeCapstones || career.activeCapstones;

  function bump(name, amount = 1) {
    effects.counters[name] = (effects.counters[name] || 0) + amount;
  }

  /* Doctrine effects deliberately publish one normalized presentation event
     after their authoritative gameplay mutation succeeds. VFX, animation and
     audio consume this independently, so a muted or low-quality renderer can
     never change damage, cooldowns or progression state. */
  function cue(order, kind, detail = {}) {
    if (disposed) return;
    const ps = ctx.player?.state || {};
    const stage = detail.stage || "proc";
    const prepStage = ["arm", "store", "segment", "inbound", "form", "channel", "pulse"]
      .includes(stage);
    const resolvedStage = ["consume", "complete", "release", "resolve"].includes(stage);
    const priority = Number.isFinite(Number(detail.priority))
      ? Math.max(0, Math.min(3, Math.floor(Number(detail.priority))))
      : prepStage ? 0
        : (detail.capstone && (resolvedStage || stage === "proc")) ? 3
          : (resolvedStage || stage === "finisher" || stage === "precision") ? 2 : 1;
    const event = {
      order,
      kind,
      cue: kind,
      x: finite(detail.x, ps.x),
      y: finite(detail.y, ps.y),
      z: finite(detail.z, ps.z),
      yaw: finite(detail.yaw, ps.yaw),
      radius: Math.max(0, finite(detail.radius)),
      intensity: Math.max(0, Math.min(1, finite(detail.intensity ?? detail.strength, 0.7))),
      rank: Math.max(1, Math.floor(finite(detail.rank, 1))),
      capstone: !!detail.capstone,
      talentId: detail.talentId || "",
      source: detail.source || detail.talentId || kind,
      stage,
      priority,
      count: Math.max(0, Math.floor(finite(detail.count))),
      value: Math.max(0, finite(detail.value)),
      targetId: typeof detail.targetId === "string" ? detail.targetId : "",
    };
    effects.feedback.serial += 1;
    effects.feedback.last = { ...event, serial: effects.feedback.serial };
    const feedbackId = event.talentId || `${order}:${kind}`;
    effects.feedback.counts[feedbackId] = (effects.feedback.counts[feedbackId] || 0) + 1;
    bus.emit("doctrine", event);
    ctx.vfx?.doctrineCue?.(event);
    ctx.player?.pulseDoctrine?.(order, event.intensity, event.capstone ? 0.72 : 0.42);
  }

  function talentRank(id) {
    return effectiveAllocations()[id] || 0;
  }

  function capstoneActive(id) {
    return effectiveCapstones().includes(id);
  }

  function fieldRank() {
    return rankForXp(career.totalXp);
  }

  function editStatus() {
    if (field.loadout) {
      const reason = "This field save uses a frozen Doctrine loadout. Complete or restart the deployment before revising the career build.";
      return { ok: false, canEdit: false, reason, message: reason };
    }
    if (ctx.qa && !ctx.runtime?.progressionEditsLockedForQA) {
      return { ok: true, canEdit: true, reason: "", message: "" };
    }
    const missionPhase = ctx.mission?.state?.phase;
    if (missionPhase === "won" || missionPhase === "lost") {
      return { ok: true, canEdit: true, reason: "", message: "" };
    }
    let reason = "";
    if (ctx.runtime?.phase !== "playing") reason = "Complete deployment before revising Doctrine.";
    else if (!document.body.classList.contains("rb-escape-menu-open")) reason = "Open the field menu to revise Doctrine.";
    else if (ctx.combat?.player?.dead) reason = "Doctrine cannot be revised while the Reliquary is fallen.";
    else {
      const breachPhase = ctx.breaches?.status?.()?.phase;
      if (breachPhase === "warning" || breachPhase === "active") {
        reason = "Available when Bloom pressure subsides.";
      } else if (ctx.mission?.canFieldSave?.() === false) {
        reason = "Complete the active channel or command before revising Doctrine.";
      } else if (ctx.player?.action || ctx.boost?.state?.active || ctx.slam?.state?.active
        || ctx.shield?.state?.active || ctx.jetpack?.state?.inFlight) {
        reason = "Complete the current Reliquary action before revising Doctrine.";
      }
    }
    return { ok: !reason, canEdit: !reason, reason, message: reason };
  }

  function state() {
    const rank = fieldRank();
    const threshold = FIELD_RANK_XP_THRESHOLDS[rank - 1] || 0;
    const next = rank < FIELD_RANK_CAP ? FIELD_RANK_XP_THRESHOLDS[rank] : threshold;
    const allocations = { ...effectiveAllocations() };
    const activeCapstones = [...effectiveCapstones()];
    const earned = pointsEarnedForRank(rank);
    const spent = pointsSpent(allocations);
    const sealsEarned = sealsEarnedForRank(rank);
    const edit = editStatus();
    const remaining = (until) => Number(Math.max(0, finite(until) - clock).toFixed(3));
    const targetRecord = (targetId, effect = {}) => {
      const target = (ctx.enemies?.live || []).find((enemy) => enemy?.id === targetId
        && enemy.state !== "death");
      return {
        targetId,
        rank: Math.max(1, Math.floor(finite(effect.rank, 1))),
        remaining: remaining(effect.until),
        x: finite(target?.x, effect.x),
        y: finite(target?.y, effect.y),
        z: finite(target?.z, effect.z),
      };
    };
    const brandTargets = [...effects.brands.entries()]
      .map(([targetId, effect]) => targetRecord(targetId, effect))
      .filter((effect) => effect.remaining > 0);
    const exposedTargets = [...effects.exposed.entries()]
      .map(([targetId, effect]) => targetRecord(targetId, effect))
      .filter((effect) => effect.remaining > 0);
    const circuitSegments = [...effects.circuit.verbs.entries()].map(([verb, at]) => ({
      verb,
      remaining: Number(Math.max(0, 8 - (clock - finite(at))).toFixed(3)),
    })).filter((segment) => segment.remaining > 0);
    const wakeRemaining = effects.wake ? remaining(effects.wake.until) : 0;
    const orders = DOCTRINE_ORDERS.map((order) => {
      const invested = pointsInOrder(allocations, order.id);
      const talentStates = order.talents.map((talent) => {
        const owned = allocations[talent.id] || 0;
        const implemented = IMPLEMENTED_TALENTS.has(talent.id);
        const required = talent.requires?.orderPoints || 0;
        const eligible = implemented && owned < talent.maxRank && invested >= required
          && invested < MAX_POINTS_PER_ORDER && spent < earned;
        const after = Math.max(0, invested - (owned > 0 ? 1 : 0));
        const wouldBreakDependency = owned > 0 && order.talents.some((other) =>
          (allocations[other.id] || 0) > 0 && other.id !== talent.id
          && (other.requires?.orderPoints || 0) > after);
        const wouldBreakVow = owned > 0 && activeCapstones.includes(order.capstone?.id)
          && after < CAPSTONE_ELIGIBILITY_POINTS;
        return {
          id: talent.id,
          rank: owned,
          maxRank: talent.maxRank,
          implemented,
          implementationNote: implemented ? "" : IMPLEMENTATION_NOTE,
          eligible,
          lockReason: implemented ? invested < required
            ? `Requires ${required} points in this Order.` : "" : IMPLEMENTATION_NOTE,
          refundable: owned > 0 && !wouldBreakDependency && !wouldBreakVow,
          refundReason: wouldBreakVow ? "Unbind this Order's active Vow first."
            : wouldBreakDependency ? "Refund dependent rites first." : "",
        };
      });
      const capstone = order.capstone;
      const capImplemented = IMPLEMENTED_CAPSTONES.has(capstone.id);
      const capActive = activeCapstones.includes(capstone.id);
      return {
        id: order.id,
        points: invested,
        talents: talentStates,
        capstone: {
          id: capstone.id,
          implemented: capImplemented,
          implementationNote: capImplemented ? "" : IMPLEMENTATION_NOTE,
          eligible: capImplemented && invested >= CAPSTONE_ELIGIBILITY_POINTS,
          active: capActive,
          reason: capImplemented ? invested < CAPSTONE_ELIGIBILITY_POINTS
            ? `Invest ${CAPSTONE_ELIGIBILITY_POINTS} points in this Order.` : "" : IMPLEMENTATION_NOTE,
        },
      };
    });
    return {
      schema: PROGRESSION_SCHEMA_VERSION,
      rank,
      totalXp: career.totalXp,
      xp: career.totalXp,
      xpIntoRank: Math.max(0, career.totalXp - threshold),
      xpForNext: rank < FIELD_RANK_CAP ? Math.max(1, next - threshold) : 0,
      pointsEarned: earned,
      pointsSpent: spent,
      pointsAvailable: Math.max(0, earned - spent),
      points: { earned, spent, free: Math.max(0, earned - spent) },
      vowSealsEarned: sealsEarned,
      vowSealsUsed: activeCapstones.filter(Boolean).length,
      vowSealsAvailable: Math.max(0, sealsEarned - activeCapstones.filter(Boolean).length),
      vowSeals: {
        earned: sealsEarned,
        used: activeCapstones.filter(Boolean).length,
        free: Math.max(0, sealsEarned - activeCapstones.filter(Boolean).length),
      },
      allocations,
      activeCapstones,
      orders,
      editLocked: !edit.ok,
      lockReason: edit.reason,
      operationId: field.operationId,
      lifetime: { ...career.lifetime },
      effects: {
        feathers: effects.feathers,
        brands: brandTargets.length,
        brandTargets,
        exposed: exposedTargets.length,
        exposedTargets,
        armed: {
          goldNail: {
            active: remaining(effects.goldNailUntil) > 0,
            remaining: remaining(effects.goldNailUntil),
          },
          wingbeatShot: {
            active: remaining(effects.wingShotUntil) > 0,
            remaining: remaining(effects.wingShotUntil),
          },
          endlessLitany: {
            active: remaining(effects.litanyUntil) > 0,
            remaining: remaining(effects.litanyUntil),
          },
          ramsHalo: {
            active: remaining(effects.ramPrimeUntil) > 0,
            remaining: remaining(effects.ramPrimeUntil),
          },
          pilgrimsReversal: {
            active: effects.halo.reversalPending && remaining(effects.halo.reversalUntil) > 0,
            remaining: remaining(effects.halo.reversalUntil),
          },
        },
        wake: wakeRemaining > 0 ? {
          x: finite(effects.wake.x),
          y: finite(effects.wake.y),
          z: finite(effects.wake.z),
          rank: Math.max(1, Math.floor(finite(effects.wake.rank, 1))),
          remaining: wakeRemaining,
          nextPulseIn: Math.max(0, finite(effects.wake.nextPulse) - clock),
        } : null,
        circuitVerbs: circuitSegments.map((segment) => segment.verb),
        circuitSegments,
        circuitWindowRemaining: circuitSegments.length
          ? Math.min(...circuitSegments.map((segment) => segment.remaining)) : 0,
        circuitCooldown: Math.max(0, effects.circuit.readyAt - clock),
        storedWrath: Number(effects.halo.storedWrath.toFixed(2)),
        reversalUntil: Math.max(0, effects.halo.reversalUntil - clock),
        reversalPending: effects.halo.reversalPending && effects.halo.reversalUntil >= clock,
        reversalBoostSerial: effects.halo.reversalBoostSerial,
        domeActive: effects.halo.domeActive,
        domeStored: Number(effects.halo.domeStored.toFixed(2)),
        domeBlocks: effects.halo.domeBlocks,
        lastDomeBlast: Number(effects.halo.lastDomeBlast.toFixed(2)),
        activeBeacon: effects.edict.beacons.size
          ? { ...effects.edict.beacons.values().next().value } : null,
        edictBeacons: [...effects.edict.beacons.values()].map((beacon) => ({ ...beacon })),
        activeSanctuary: effects.edict.sanctuaries.size
          ? { ...effects.edict.sanctuaries.values().next().value } : null,
        sanctuaries: [...effects.edict.sanctuaries.values()].map((field) => ({ ...field })),
        activeSigils: [...effects.edict.sigils.values()].map((sigil) => ({ ...sigil })),
        sigils: [...effects.edict.sigils.values()].map((sigil) => ({ ...sigil })),
        fusionCooldown: Math.max(0, effects.edict.fusionReadyAt - clock),
        lastFusion: effects.edict.lastFusion ? {
          ...effects.edict.lastFusion,
          effectPoint: effects.edict.lastFusion.effectPoint
            ? { ...effects.edict.lastFusion.effectPoint } : null,
        } : null,
        feedback: {
          serial: effects.feedback.serial,
          last: effects.feedback.last ? { ...effects.feedback.last } : null,
          counts: { ...effects.feedback.counts },
        },
        counters: { ...effects.counters },
      },
    };
  }

  function notify(type, message, detail = {}) {
    const result = { ok: detail.ok !== false, type, message, ...detail, state: state() };
    for (const listener of listeners) {
      try { listener(result); } catch (error) { console.error("[saintfall] progression listener threw", error); }
    }
    return result;
  }

  function flushPersistence() {
    if (persistTimer) window.clearTimeout(persistTimer);
    persistTimer = 0;
    if (ctx.qa || !persistence) return false;
    const ok = persistence.writeCareer?.(captureCareer(), { reason: "progression" })
      ?? persistence.write?.(captureCareer(), { reason: "progression" }) ?? false;
    if (!ok && !disposed && !persistTimer) {
      persistTimer = window.setTimeout(flushPersistence, 5000);
    }
    return ok;
  }

  function queuePersistence() {
    if (ctx.qa || disposed || !persistence || persistTimer) return;
    persistTimer = window.setTimeout(flushPersistence, 450);
  }

  function markCareerChanged() {
    career.revision = Math.max(0, career.revision || 0) + 1;
  }

  function mutationFailure(reason, message = reason) {
    return { ok: false, reason, message, state: state() };
  }

  function canMutate() {
    const edit = editStatus();
    return edit.ok ? null : mutationFailure("edit-locked", edit.reason);
  }

  function grantXp(amount, receipt, source = "field") {
    if (disposed) return mutationFailure("disposed", "Progression service is unavailable.");
    const value = typeof amount === "number" && Number.isFinite(amount)
      ? Math.max(0, Math.floor(amount)) : 0;
    const key = normalizeReceipt(receipt);
    if (value <= 0) return mutationFailure("invalid-xp", "XP award must be positive.");
    if (!key) return mutationFailure("invalid-receipt", "XP award requires a valid authoritative receipt.");
    if (career.receipts.includes(key)) {
      return { ok: true, duplicate: true, awarded: 0, reason: "duplicate-receipt", state: state() };
    }
    if (career.receipts.length >= RECEIPT_LIMIT) {
      return mutationFailure("receipt-ledger-full", "Career receipt ledger is full; progression was not changed.");
    }
    const beforeRank = fieldRank();
    const beforeXp = career.totalXp;
    const capXp = FIELD_RANK_XP_THRESHOLDS[FIELD_RANK_CAP - 1];
    career.totalXp = Math.min(capXp, career.totalXp + value);
    career.receipts.push(key);
    markCareerChanged();
    const afterRank = fieldRank();
    const rankUps = Math.max(0, afterRank - beforeRank);
    queuePersistence();
    const gainedSeals = sealsEarnedForRank(afterRank) - sealsEarnedForRank(beforeRank);
    const message = rankUps > 0
      ? `Field Rank ${afterRank} · ${rankUps === 1 ? "Doctrine Point earned" : `${rankUps} Doctrine Points earned`}${gainedSeals > 0 ? ` · ${gainedSeals === 1 ? "Vow Seal earned" : `${gainedSeals} Vow Seals earned`}` : ""}`
      : "";
    if (rankUps > 0) ctx.mission?.announce?.(message.toUpperCase(), 3.2);
    return notify("xp", message, {
      source,
      receipt: key,
      awarded: career.totalXp - beforeXp,
      requested: value,
      rankUps,
      pointsGained: rankUps * DOCTRINE_POINTS_PER_RANK,
      sealsGained: gainedSeals,
    });
  }

  function spend(talentId) {
    const locked = canMutate();
    if (locked) return locked;
    const talent = TALENTS.get(talentId);
    if (!talent) return mutationFailure("unknown-talent", "Unknown Doctrine rite.");
    if (!IMPLEMENTED_TALENTS.has(talentId)) return mutationFailure("forthcoming", IMPLEMENTATION_NOTE);
    const allocations = { ...effectiveAllocations() };
    const current = allocations[talentId] || 0;
    const rank = fieldRank();
    if (current >= talent.maxRank) return mutationFailure("max-rank", "Maximum rank reached.");
    if (pointsSpent(allocations) >= pointsEarnedForRank(rank)) {
      return mutationFailure("no-points", "No Doctrine Points are available.");
    }
    const invested = pointsInOrder(allocations, talent.orderId);
    const required = talent.requires?.orderPoints || 0;
    if (invested < required) return mutationFailure("tier-locked", `Requires ${required} points in this Order.`);
    if (invested >= MAX_POINTS_PER_ORDER) return mutationFailure("order-cap", `This Order is limited to ${MAX_POINTS_PER_ORDER} points.`);
    career.allocations[talentId] = current + 1;
    markCareerChanged();
    resetEffects({ preserveCounters: true });
    queuePersistence();
    return notify("spend", `${talent.name} · Rank ${current + 1} inscribed`, { talentId });
  }

  function refund(talentId) {
    const locked = canMutate();
    if (locked) return locked;
    const talent = TALENTS.get(talentId);
    if (!talent) return mutationFailure("unknown-talent", "Unknown Doctrine rite.");
    const allocations = { ...effectiveAllocations() };
    const active = [...effectiveCapstones()];
    const current = allocations[talentId] || 0;
    if (current <= 0) return mutationFailure("not-owned", "This rite has no rank to refund.");
    const afterAllocations = { ...allocations };
    if (current === 1) delete afterAllocations[talentId];
    else afterAllocations[talentId] = current - 1;
    const investedAfter = pointsInOrder(afterAllocations, talent.orderId);
    const order = ORDERS.get(talent.orderId);
    if (active.includes(order.capstone?.id)
      && investedAfter < CAPSTONE_ELIGIBILITY_POINTS) {
      return mutationFailure("active-vow", "Unbind this Order's active Vow first.");
    }
    const invalidDependent = order.talents.find((other) =>
      (afterAllocations[other.id] || 0) > 0
      && (other.requires?.orderPoints || 0) > investedAfter);
    if (invalidDependent) return mutationFailure("dependent-talent", `Refund ${invalidDependent.name} first.`);
    career.allocations = afterAllocations;
    markCareerChanged();
    resetEffects({ preserveCounters: true });
    queuePersistence();
    return notify("refund", `${talent.name} refunded`, { talentId });
  }

  function respec() {
    const locked = canMutate();
    if (locked) return locked;
    career.allocations = {};
    career.activeCapstones = [null, null];
    markCareerChanged();
    resetEffects();
    queuePersistence();
    return notify("respec", "Doctrine reset · all points and Vow Seals returned");
  }

  function equipCapstone(capstoneId, requestedSlot) {
    const locked = canMutate();
    if (locked) return locked;
    const capstone = CAPSTONES.get(capstoneId);
    if (!capstone) return mutationFailure("unknown-capstone", "Unknown capstone Vow.");
    if (!IMPLEMENTED_CAPSTONES.has(capstoneId)) return mutationFailure("forthcoming", IMPLEMENTATION_NOTE);
    const allocations = { ...effectiveAllocations() };
    const active = [...effectiveCapstones()];
    if (active.includes(capstoneId)) {
      return { ok: true, idempotent: true, message: `${capstone.name} is already bound.`, state: state() };
    }
    if (pointsInOrder(allocations, capstone.orderId) < CAPSTONE_ELIGIBILITY_POINTS) {
      return mutationFailure("capstone-locked", `Invest ${CAPSTONE_ELIGIBILITY_POINTS} points in this Order.`);
    }
    const seals = sealsEarnedForRank(fieldRank());
    let slot = Number.isInteger(requestedSlot) ? requestedSlot : -1;
    if (slot < 0) slot = active.findIndex((id, index) => !id && index < seals);
    if (slot < 0 || slot >= seals || slot >= MAX_ACTIVE_CAPSTONES) {
      return mutationFailure("vow-limit", "Both earned Vow Seals are already bound.");
    }
    if (active[slot]) {
      return mutationFailure("vow-slot-occupied", "Unbind the current Vow before replacing it.");
    }
    career.activeCapstones[slot] = capstoneId;
    markCareerChanged();
    resetEffects({ preserveCounters: true });
    queuePersistence();
    return notify("equip-capstone", `${capstone.name} bound to Vow ${slot + 1}`, { capstoneId, slot });
  }

  function unequipCapstone(slotOrId) {
    const locked = canMutate();
    if (locked) return locked;
    const active = [...effectiveCapstones()];
    const slot = typeof slotOrId === "string"
      ? active.indexOf(slotOrId) : Math.floor(Number(slotOrId));
    if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_ACTIVE_CAPSTONES
      || !active[slot]) {
      return mutationFailure("vow-not-bound", "That Vow Seal is already unbound.");
    }
    const capstoneId = active[slot];
    career.activeCapstones[slot] = null;
    markCareerChanged();
    resetEffects({ preserveCounters: true });
    queuePersistence();
    return notify("unequip-capstone", `${CAPSTONES.get(capstoneId)?.name || "Capstone Vow"} unbound`, { capstoneId, slot });
  }

  function validateCareer(value) {
    if (!isRecord(value)) return false;
    if (value.schema !== PROGRESSION_SCHEMA_VERSION
      || !Object.prototype.hasOwnProperty.call(value, "totalXp")
      || !isRecord(value.allocations)
      || !Array.isArray(value.activeCapstones)
      || !Array.isArray(value.receipts)
      || !Object.prototype.hasOwnProperty.call(value, "revision")
      || !isRecord(value.lifetime)) return false;
    if (typeof value.revision !== "number" || !Number.isSafeInteger(value.revision)
      || value.revision < 0) return false;
    const rawXp = value.totalXp;
    if (typeof rawXp !== "number" || !Number.isFinite(rawXp) || !Number.isInteger(rawXp)
      || rawXp < 0 || rawXp > FIELD_RANK_XP_THRESHOLDS[FIELD_RANK_CAP - 1]) {
      return false;
    }
    const totalXp = rawXp;
    const allocations = normalizeAllocations(value.allocations);
    if (!allocations || pointsSpent(allocations) > pointsEarnedForRank(rankForXp(totalXp))) return false;
    const activeCapstones = normalizeCapstones(
      value.activeCapstones,
      allocations,
      rankForXp(totalXp)
    );
    if (!activeCapstones) return false;
    if (value.activeCapstones.length !== MAX_ACTIVE_CAPSTONES) return false;
    const receipts = value.receipts.map(normalizeReceipt);
    if (receipts.some((receipt, index) => !receipt || receipt !== value.receipts[index])
      || new Set(receipts).size !== receipts.length || receipts.length > RECEIPT_LIMIT) return false;
    const lifetimeRaw = value.lifetime;
    const lifetime = {};
    for (const key of ["kills", "relays", "breachWaves", "breachCycles", "operations"]) {
      if (!Object.prototype.hasOwnProperty.call(lifetimeRaw, key)) return false;
      const amount = lifetimeRaw[key];
      if (typeof amount !== "number" || !Number.isFinite(amount)
        || !Number.isSafeInteger(amount) || amount < 0) return false;
      lifetime[key] = amount;
    }
    return {
      schema: PROGRESSION_SCHEMA_VERSION,
      totalXp,
      allocations,
      activeCapstones,
      receipts: [...receipts],
      revision: value.revision,
      lifetime,
    };
  }

  function captureCareer() {
    return clone(career);
  }

  function restoreCareer(value, options = {}) {
    const normalized = value === null || value === undefined ? freshCareer() : validateCareer(value);
    if (!normalized) return mutationFailure("invalid-career", "Career progression record was rejected.");
    career = normalized;
    if (!options.preserveField) field.loadout = null;
    resetEffects();
    if (options.persist !== false) queuePersistence();
    return notify("restore-career", "", { source: options.source || "runtime" });
  }

  /* A late cloud reply may arrive after local play has resumed. Without a
     server transaction we cannot correctly combine two divergent award
     histories from bare receipt IDs, so fail closed: accept an ancestor or a
     strict descendant, and reject divergence instead of inventing/losing XP. */
  function mergeCareer(value, options = {}) {
    const incoming = validateCareer(value);
    if (!incoming) return mutationFailure("invalid-career", "Career progression record was rejected.");
    const liveReceipts = new Set(career.receipts);
    const incomingReceipts = new Set(incoming.receipts);
    const incomingContainsLive = career.receipts.every((receipt) => incomingReceipts.has(receipt));
    const liveContainsIncoming = incoming.receipts.every((receipt) => liveReceipts.has(receipt));
    const incomingDominates = incoming.totalXp >= career.totalXp
      && ["kills", "relays", "breachWaves", "breachCycles", "operations"]
        .every((key) => incoming.lifetime[key] >= career.lifetime[key]);
    const liveDominates = career.totalXp >= incoming.totalXp
      && ["kills", "relays", "breachWaves", "breachCycles", "operations"]
        .every((key) => career.lifetime[key] >= incoming.lifetime[key]);
    if (!incomingContainsLive && !liveContainsIncoming) {
      return mutationFailure("career-conflict", "Career changed in two places; the local career was preserved.");
    }
    if (incoming.revision > career.revision && incomingContainsLive && incomingDominates) {
      career = incoming;
      if (options.persist !== false) queuePersistence();
      return notify("merge-career", "", { source: options.source || "cloud", adopted: "incoming" });
    }
    if (career.revision > incoming.revision && liveContainsIncoming && liveDominates) {
      if (options.persist !== false) queuePersistence();
      return notify("merge-career", "", { source: options.source || "cloud", adopted: "local" });
    }
    if (JSON.stringify(career) !== JSON.stringify(incoming)) {
      return mutationFailure("career-conflict", "Career revisions conflict; the local career was preserved.");
    }
    return { ok: true, idempotent: true, state: state() };
  }

  function captureField() {
    return {
      schema: FIELD_SCHEMA_VERSION,
      operationId: field.operationId,
      startedAt: field.startedAt,
      loadout: {
        allocations: { ...effectiveAllocations() },
        activeCapstones: [...effectiveCapstones()],
      },
    };
  }

  function validateField(value) {
    if (!isRecord(value) || value.schema !== FIELD_SCHEMA_VERSION
      || typeof value.operationId !== "string" || !value.operationId.trim()
      || value.operationId !== value.operationId.trim() || value.operationId.length > 160
      || typeof value.startedAt !== "number" || !Number.isFinite(value.startedAt)
      || !Number.isSafeInteger(value.startedAt) || value.startedAt < 0
      || !isRecord(value.loadout) || !isRecord(value.loadout.allocations)
      || !Array.isArray(value.loadout.activeCapstones)
      || value.loadout.activeCapstones.length !== MAX_ACTIVE_CAPSTONES) return false;
    const allocations = normalizeAllocations(value.loadout.allocations);
    if (!allocations || pointsSpent(allocations) > pointsEarnedForRank(fieldRank())) return false;
    const activeCapstones = normalizeCapstones(
      value.loadout.activeCapstones,
      allocations,
      fieldRank()
    );
    if (!activeCapstones) return false;
    return {
      schema: FIELD_SCHEMA_VERSION,
      operationId: value.operationId,
      startedAt: value.startedAt,
      loadout: { allocations, activeCapstones },
    };
  }

  function restoreField(value) {
    const normalized = validateField(value);
    if (!normalized) return mutationFailure("invalid-field-loadout", "Deployed Doctrine loadout was rejected.");
    field.operationId = normalized.operationId;
    field.startedAt = normalized.startedAt;
    field.loadout = normalized.loadout;
    resetEffects();
    return notify("restore-field", "Deployed Doctrine restored");
  }

  function restoreFieldForQA(value) {
    if (!ctx.qa) return mutationFailure("qa-only", "Field-loadout probes are available only to QA.");
    ctx.runtime.progressionEditsLockedForQA = true;
    return restoreField(value);
  }

  function clearFieldLoadout(options = {}) {
    if (!field.loadout) return { ok: true, idempotent: true, state: state() };
    field.loadout = null;
    if (ctx.qa) ctx.runtime.progressionEditsLockedForQA = false;
    resetEffects();
    return notify("clear-field", "", { source: options.source || "runtime" });
  }

  function attachPersistence(next) {
    persistence = next && typeof next === "object" ? next : null;
    return !!persistence;
  }

  function resetEffects({ preserveCounters = false } = {}) {
    const counters = preserveCounters ? effects.counters : {};
    effects.brands.clear();
    effects.exposed.clear();
    effects.goldNailUntil = 0;
    effects.wingShotUntil = 0;
    effects.lastBoostAt = -Infinity;
    effects.furnaceReadyAt = 0;
    effects.feathers = 0;
    effects.wake = null;
    effects.ramPrimeUntil = 0;
    effects.circuit.verbs.clear();
    effects.circuit.readyAt = 0;
    effects.comboTargets.clear();
    effects.comboConnected = false;
    effects.comboMercyUsed = false;
    effects.litanyUntil = 0;
    effects.halo.storedWrath = 0;
    effects.halo.storedWrathBlocks = 0;
    effects.halo.reversalUntil = 0;
    effects.halo.reversalYaw = 0;
    effects.halo.reversalPending = false;
    effects.halo.reversalBoostSerial = 0;
    effects.halo.domeActive = false;
    effects.halo.domeStored = 0;
    effects.halo.domeBlocks = 0;
    effects.halo.lastDomeBlast = 0;
    effects.halo.mercyCueAt = 0;
    effects.edict.beacons.clear();
    effects.edict.sanctuaries.clear();
    effects.edict.sigils.clear();
    effects.edict.fusionReadyAt = 0;
    effects.edict.lastFusion = null;
    effects.feedback.serial = 0;
    effects.feedback.last = null;
    effects.feedback.counts = {};
    effects.counters = counters;
  }

  function resetForQA() {
    if (!ctx.qa) return mutationFailure("qa-only", "Progression reset is available only to QA.");
    career = freshCareer();
    field.operationId = operationBase;
    field.startedAt = Date.now();
    field.loadout = null;
    ctx.runtime.progressionEditsLockedForQA = false;
    clock = 0;
    resetEffects();
    return notify("reset", "QA progression reset");
  }

  function sourceReceipt(prefix, suffix) {
    return `${prefix}:${field.operationId}:${String(suffix)}`;
  }

  function noteLifetimeOnce(receipt, key) {
    const normalized = normalizeReceipt(receipt);
    if (!normalized || career.receipts.includes(normalized)
      || career.receipts.length >= RECEIPT_LIMIT) return false;
    career.lifetime[key] = (career.lifetime[key] || 0) + 1;
    return true;
  }

  function onEnemyKilled(event = {}) {
    const enemyKey = event.enemyKey || event.key || "unknown";
    const enemyId = typeof event.enemyId === "string" ? event.enemyId.trim() : "";
    const award = XP_AWARDS[`kill_${enemyKey}`];
    if (!enemyId || !award) return event;
    const receipt = sourceReceipt("kill", enemyId);
    if (noteLifetimeOnce(receipt, "kills")) {
      grantXp(award.amount, receipt, award.id);
    }

    const heat = ctx.weapons?.heatState?.()?.heat || 0;
    const reprieve = talentRank("censer_furnace_reprieve");
    if (reprieve > 0 && heat >= 0.7 && clock >= effects.furnaceReadyAt) {
      const precision = !!event.head || !!event.weak;
      ctx.weapons?.coolHeat?.(precision && reprieve >= 2 ? 0.16 : 0.08, { reason: "furnace-reprieve" });
      effects.furnaceReadyAt = clock + 2;
      bump("furnaceReprieves");
      cue("censer", "reprieve", {
        ...event, rank: reprieve, intensity: precision && reprieve >= 2 ? 0.82 : 0.62,
        talentId: "censer_furnace_reprieve",
      });
    }

    const gospel = talentRank("wing_falling_gospel");
    const airborne = ctx.jetpack?.state?.inFlight || !ctx.player?.state?.grounded;
    if (gospel > 0 && airborne && event.source === "shot" && effects.feathers < 3) {
      effects.feathers = Math.min(3, effects.feathers + 1);
      bump("feathersEarned");
      cue("wing", "feather", {
        ...event, rank: gospel, count: effects.feathers,
        intensity: 0.42 + effects.feathers * 0.14,
        talentId: "wing_falling_gospel",
      });
    }
    return event;
  }

  function modifyEnemyDamage(event = {}) {
    let damage = Math.max(0, finite(event.damage ?? event.requested));
    const id = event.enemyId;
    const brand = id ? effects.brands.get(id) : null;
    if (event.source === "melee" && brand && brand.until >= clock) {
      damage *= 1.35;
      effects.brands.delete(id);
      ctx.weapons?.coolHeat?.(0.12, { reason: "rite-of-censure" });
      if (brand.rank >= 2) {
        ctx.combat?.shockwave?.(event.x, event.y, event.z, {
          radius: 4, damage: 0, stun: 0.65, knockSpeed: 5, source: "censure-brand",
        });
      }
      bump("brandsBroken");
      cue("censer", "brand-break", {
        ...event, rank: brand.rank, radius: brand.rank >= 2 ? 4 : 2.5,
        intensity: brand.rank >= 2 ? 0.9 : 0.7,
        talentId: "censer_rite_of_censure", targetId: id,
      });
    }
    const exposed = id ? effects.exposed.get(id) : null;
    if (event.source === "shot" && exposed && exposed.until >= clock) {
      damage *= 1.4;
      effects.exposed.delete(id);
      bump("exposuresRuptured");
      cue("procession", "expose", {
        ...event, radius: 2.6, intensity: 0.8,
        talentId: "procession_executioners_measure", targetId: id, stage: "consume",
      });
    }
    return damage;
  }

  function onEnemyDamaged(event = {}) {
    const precision = event.source === "shot" && (event.head || event.weak);
    if (precision && event.enemyId) {
      const nail = talentRank("censer_gold_nail");
      if (nail > 0) {
        effects.goldNailUntil = clock + 4;
        cue("censer", "heatless", {
          ...event, rank: nail, intensity: 0.54,
          talentId: "censer_gold_nail", stage: "arm", targetId: event.enemyId,
        });
      }
      if (!event.killed) {
        const censure = talentRank("censer_rite_of_censure");
        if (censure > 0) {
          effects.brands.set(event.enemyId, {
            until: clock + 5,
            rank: censure,
            x: finite(event.x),
            y: finite(event.y),
            z: finite(event.z),
          });
          cue("censer", "brand", {
            ...event, rank: censure, intensity: 0.56,
            talentId: "censer_rite_of_censure", stage: "arm", targetId: event.enemyId,
          });
        }
      }
    }
    return event;
  }

  function onWeaponFire(event = {}) {
    const heatAdded = Math.max(0, finite(event.heatAdded));
    if (effects.goldNailUntil >= clock && talentRank("censer_gold_nail") > 0) {
      ctx.weapons?.coolHeat?.(heatAdded, { reason: "gold-nail", clearOverheat: true });
      if (talentRank("censer_gold_nail") >= 2) ctx.weapons?.coolHeat?.(0.06, { reason: "gold-nail-rank-2" });
      effects.goldNailUntil = 0;
      bump("goldNailsFired");
      cue("censer", "heatless", {
        ...event, intensity: 0.84, rank: talentRank("censer_gold_nail"),
        talentId: "censer_gold_nail", stage: "consume",
      });
    } else if (effects.wingShotUntil >= clock && talentRank("wing_wingbeat_conversion") >= 2) {
      ctx.weapons?.coolHeat?.(heatAdded, { reason: "wingbeat-shot", clearOverheat: true });
      effects.wingShotUntil = 0;
      bump("wingbeatShots");
      cue("wing", "conversion", {
        ...event, intensity: 0.7, rank: 2,
        talentId: "wing_wingbeat_conversion", stage: "shot",
      });
    }
    return event;
  }

  function onVent(event = {}) {
    const rank = talentRank("censer_ashen_rebuke");
    if (rank > 0 && event.startHeat >= 0.6) {
      const hot = rank >= 2 && event.startHeat >= 0.85;
      const distance = hot ? 3.4 : 2.7;
      const x = finite(event.x) + Math.sin(finite(event.yaw)) * distance;
      const z = finite(event.z) + Math.cos(finite(event.yaw)) * distance;
      ctx.combat?.shockwave?.(x, finite(event.y), z, {
        radius: hot ? 4.8 : 3.4,
        damage: hot ? 45 : 0,
        stun: hot ? 0.9 : 0.55,
        knockSpeed: hot ? 8 : 5,
        source: "ashen-rebuke",
      });
      bump("ashenRebukes");
      cue("censer", "vent", {
        ...event, x, z, radius: hot ? 4.8 : 3.4, rank,
        intensity: hot ? 0.9 : 0.68, talentId: "censer_ashen_rebuke",
      });
    }
    if (capstoneActive("censer_martyrs_furnace") && event.startHeat >= 0.8) {
      const x = finite(event.x) + Math.sin(finite(event.yaw)) * 2.8;
      const z = finite(event.z) + Math.cos(finite(event.yaw)) * 2.8;
      ctx.combat?.shockwave?.(x, finite(event.y), z, {
        radius: 6, damage: 70, edgeFalloff: 0.55, stun: 1, knockSpeed: 9,
        source: "martyrs-furnace",
      });
      ctx.jetpack?.restoreCharge?.(8, "martyrs-furnace");
      bump("martyrsFurnaceBlasts");
      cue("censer", "martyr", {
        ...event, x, z, radius: 6, intensity: 1, capstone: true,
        talentId: "censer_martyrs_furnace",
      });
    }
    return event;
  }

  function onVentComplete(event = {}) { return event; }

  function onMeleeStrike(event = {}) {
    const step = Math.floor(finite(event.comboStep));
    const connected = event.hits > 0;
    if (step === 1) {
      effects.comboConnected = connected;
      effects.comboMercyUsed = false;
      effects.comboTargets = new Set((event.targets || [])
        .filter((target) => target.enemyKey === "harrow" || target.enemyKey === "matriarch")
        .map((target) => target.enemyId));
      if (connected && capstoneActive("procession_endless_litany") && effects.litanyUntil >= clock) {
        ctx.combat?.shockwave?.(event.x, event.y, event.z, {
          radius: 5, damage: 55, edgeFalloff: 0.5, stun: 0.75, knockSpeed: 7,
          source: "endless-litany",
        });
        ctx.jetpack?.restoreCharge?.(8, "endless-litany");
        bump("litanyVerses");
        cue("procession", "litany", {
          ...event, radius: 5, intensity: 1, capstone: true,
          talentId: "procession_endless_litany", stage: "consume",
        });
      }
    } else {
      effects.comboConnected = effects.comboConnected && connected;
      if (step === 2 && effects.comboTargets.size) {
        const current = new Set((event.targets || []).map((target) => target.enemyId));
        effects.comboTargets = new Set([...effects.comboTargets].filter((id) => current.has(id)));
      }
    }

    const hook = talentRank("procession_hooking_step");
    if (hook > 0 && step === 2 && connected) {
      ctx.combat?.shockwave?.(event.x, event.y, event.z, {
        radius: hook >= 2 ? 5 : 3, damage: 0, stun: hook >= 2 ? 0.8 : 0.45,
        knockSpeed: 4, source: "hooking-step",
      });
      bump("hookingSteps");
      cue("procession", "hook", {
        ...event, radius: hook >= 2 ? 5 : 3, rank: hook,
        intensity: hook >= 2 ? 0.78 : 0.62,
        talentId: "procession_hooking_step", stage: "second-strike",
      });
    }

    const mercy = talentRank("procession_processional_mercy");
    if (mercy > 0 && event.kills > 0 && !effects.comboMercyUsed) {
      ctx.jetpack?.restoreCharge?.(step === 3 && mercy >= 2 ? 12 : 6, "processional-mercy");
      effects.comboMercyUsed = true;
      bump("processionalMercies");
      cue("procession", "mercy", {
        ...event, rank: mercy, intensity: mercy >= 2 ? 0.82 : 0.62,
        talentId: "procession_processional_mercy",
      });
    }

    if (step === 3) {
      const measure = talentRank("procession_executioners_measure");
      if (measure > 0 && effects.comboConnected) {
        const current = new Set((event.targets || []).map((target) => target.enemyId));
        const armedTargets = (event.targets || []).filter((target) =>
          !target.killed && effects.comboTargets.has(target.enemyId) && current.has(target.enemyId));
        for (const target of armedTargets) {
          effects.exposed.set(target.enemyId, {
            until: clock + (measure >= 2 ? 6 : 4),
            rank: measure,
            x: finite(target.x),
            y: finite(target.y),
            z: finite(target.z),
          });
        }
        if (measure >= 2 && armedTargets.length) {
          ctx.combat?.shockwave?.(event.x, event.y, event.z, {
            radius: 4, damage: 0, stun: 0.75, knockSpeed: 5, source: "executioners-measure",
          });
        }
        if (armedTargets.length) {
          const primary = armedTargets[0];
          cue("procession", "expose", {
            ...event, x: primary.x, y: primary.y, z: primary.z,
            radius: 4, rank: measure, count: armedTargets.length,
            intensity: measure >= 2 ? 0.82 : 0.62,
            talentId: "procession_executioners_measure", stage: "arm",
            targetId: primary.enemyId,
          });
        }
      }
      const thirdToll = talentRank("procession_third_toll");
      if (thirdToll > 0 && effects.comboConnected) {
        const first = ctx.combat?.shockwave?.(event.x, event.y, event.z, {
          radius: 6, damage: 48, edgeFalloff: 0.42, stun: 0.5, knockSpeed: 7,
          source: "third-toll",
        });
        const echoed = thirdToll >= 2 && (first?.hits || 0) >= 3;
        if (echoed) {
          ctx.combat?.shockwave?.(event.x, event.y, event.z, {
            radius: 6, damage: 24, edgeFalloff: 0.5, stun: 0.25, knockSpeed: 4,
            source: "third-toll-echo",
          });
        }
        bump("thirdTolls");
        cue("procession", "toll", {
          ...event, radius: 6, rank: thirdToll,
          intensity: echoed ? 1 : 0.82,
          talentId: "procession_third_toll", count: echoed ? 2 : 1,
          stage: "finisher",
        });
      }
      effects.litanyUntil = connected && capstoneActive("procession_endless_litany")
        ? clock + 1.5 : 0;
      if (effects.litanyUntil) {
        cue("procession", "litany", {
          ...event, radius: 2.8, intensity: 0.62, capstone: true,
          talentId: "procession_endless_litany", stage: "arm",
        });
      }
    }
    if (!connected) {
      effects.comboTargets.clear();
      effects.litanyUntil = 0;
    }
    return event;
  }

  function onShieldBlock(event = {}) {
    const amount = Math.max(0, finite(event.amount ?? event.absorbed));
    const ps = ctx.player?.state || {};
    const guardOrigin = {
      x: finite(event.playerX, ps.x),
      y: finite(event.playerY, ps.y),
      z: finite(event.playerZ, ps.z),
      yaw: finite(event.yaw, ps.yaw),
    };
    if (event.dome && capstoneActive("halo_seraph_aegis")) {
      effects.halo.domeActive = true;
      effects.halo.domeStored = Math.min(150, effects.halo.domeStored + amount);
      effects.halo.domeBlocks += 1;
      bump("seraphBlocks");
      cue("halo", "dome", {
        ...event, ...guardOrigin,
        radius: Math.max(0.75, finite(ctx.shield?.config?.domeRadius, 2.62)),
        intensity: Math.min(0.78, 0.3 + effects.halo.domeStored / 260),
        capstone: true, talentId: "halo_seraph_aegis", stage: "store",
      });
    } else {
      const storedRank = talentRank("halo_stored_wrath");
      if (storedRank > 0) {
        const cap = storedRank >= 2 ? 100 : 60;
        const portion = storedRank >= 2 ? 0.4 : 0.25;
        effects.halo.storedWrath = Math.min(cap, effects.halo.storedWrath + amount * portion);
        effects.halo.storedWrathBlocks += 1;
        bump("wrathBlocks");
        cue("halo", "wrath-store", {
          ...event, ...guardOrigin, rank: storedRank, value: effects.halo.storedWrath,
          intensity: Math.min(0.74, 0.28 + effects.halo.storedWrath / 150),
          talentId: "halo_stored_wrath", stage: "store",
        });
      }
    }

    const reversal = talentRank("halo_pilgrims_reversal");
    if (reversal > 0) {
      effects.halo.reversalUntil = clock + 1.25;
      effects.halo.reversalYaw = finite(event.yaw, ctx.player?.state?.yaw);
      effects.halo.reversalPending = true;
      bump("reversalsArmed");
      cue("halo", "reversal", {
        ...event, ...guardOrigin, rank: reversal, intensity: 0.52,
        talentId: "halo_pilgrims_reversal", stage: "arm",
      });
    }

    const rank = talentRank("halo_votive_parry");
    if (rank <= 0 || !event.perfect) return event;
    ctx.combat?.shockwave?.(finite(event.playerX, ctx.player?.state?.x),
      finite(event.playerY, ctx.player?.state?.y),
      finite(event.playerZ, ctx.player?.state?.z), {
        radius: rank >= 2 ? 4 : 3,
        damage: 0,
        stun: rank >= 2 ? 0.9 : 0.6,
        knockSpeed: 6,
        source: "votive-parry",
      });
    if (rank >= 2) {
      ctx.jetpack?.restoreCharge?.(
        Math.min(12, Math.max(3, amount * 0.12)), "votive-parry"
      );
      const attacker = (ctx.enemies?.live || []).find((enemy) =>
        enemy?.id === event.enemyId && enemy.state !== "death" && enemy.key === "gleaner");
      if (attacker) {
        const hitY = attacker.y + 1.25;
        ctx.combat?.damageEnemy?.(attacker, 45, {
          source: "votive-parry",
          x: attacker.x,
          y: hitY,
          z: attacker.z,
        });
        ctx.vfx?.spark?.(attacker.x, hitY, attacker.z, 1.65, false, true);
        bump("votiveBolts");
      }
    }
    bump("perfectGuards");
    cue("halo", "parry", {
      ...event, ...guardOrigin, rank, radius: rank >= 2 ? 4 : 3,
      intensity: rank >= 2 ? 0.95 : 0.78,
      talentId: "halo_votive_parry",
    });
    return event;
  }

  function modifyShieldFrame(event = {}) {
    const seraph = capstoneActive("halo_seraph_aegis");
    const earnedDome = seraph && !!event.stationary && finite(event.activeFor) >= 1;
    const dome = seraph && (effects.halo.domeActive || earnedDome);
    effects.halo.domeActive = dome;
    const mercy = talentRank("halo_mercy_circuit");
    const protectedRelay = !!event.missionChanneling && mercy > 0;
    let drainMultiplier = dome ? 2 : 1;
    if (protectedRelay && mercy === 1) drainMultiplier *= 1.5;
    return {
      drainMultiplier,
      moveSpeed: dome ? 0 : finite(event.baseMoveSpeed, 3),
      movementLocked: dome,
      omniDirectional: dome,
      dome,
      source: dome ? "seraph-aegis" : protectedRelay ? "mercy-circuit" : "",
    };
  }

  function onShieldRelease(event = {}) {
    const ps = ctx.player?.state || event;
    const x = finite(event.x, ps.x);
    const y = finite(event.y, ps.y);
    const z = finite(event.z, ps.z);
    const yaw = finite(event.yaw, ps.yaw);
    const domeRelease = effects.halo.domeActive || !!event.dome;
    if (domeRelease) {
      const force = Math.min(150, Math.max(0, effects.halo.domeStored));
      if (force > 0) {
        ctx.combat?.shockwave?.(x, y, z, {
          radius: 8,
          innerRadius: 2.5,
          damage: force,
          edgeFalloff: 0.68,
          stun: 1,
          knockSpeed: 10,
          source: "seraph-aegis",
        });
        bump("seraphBlasts");
        cue("halo", "seraph", {
          x, y, z, yaw, radius: 8, value: force, intensity: Math.min(1, 0.55 + force / 300),
          capstone: true, talentId: "halo_seraph_aegis", stage: "release",
        });
      }
      effects.halo.lastDomeBlast = force;
      effects.halo.domeStored = 0;
      effects.halo.domeBlocks = 0;
      effects.halo.domeActive = false;
      /* A dome is the shield's release event; it never also discharges the
         directional Stored Wrath bank. */
      effects.halo.storedWrath = 0;
      effects.halo.storedWrathBlocks = 0;
      return event;
    }

    const force = Math.max(0, effects.halo.storedWrath);
    const rank = talentRank("halo_stored_wrath");
    if (rank > 0 && force > 0) {
      const reach = rank >= 2 ? 6 : 4;
      const centre = reach * 0.56;
      ctx.combat?.shockwave?.(
        x + Math.sin(yaw) * centre,
        y,
        z + Math.cos(yaw) * centre,
        {
          radius: reach * 0.54,
          innerRadius: reach * 0.18,
          damage: force,
          edgeFalloff: 0.78,
          stun: rank >= 2 ? 0.85 : 0.55,
          knockSpeed: rank >= 2 ? 9 : 7,
          source: "stored-wrath",
        }
      );
      bump("wrathBashes");
      cue("halo", "wrath-release", {
        x, y, z, yaw, radius: reach, rank, value: force,
        intensity: Math.min(1, 0.5 + force / 160),
        talentId: "halo_stored_wrath", stage: "release",
      });
    }
    effects.halo.storedWrath = 0;
    effects.halo.storedWrathBlocks = 0;
    effects.halo.domeActive = false;
    effects.halo.domeStored = 0;
    effects.halo.domeBlocks = 0;
    return event;
  }

  function modifyBoostTrigger(event = {}) {
    const rank = talentRank("halo_pilgrims_reversal");
    if (rank <= 0 || !effects.halo.reversalPending || effects.halo.reversalUntil < clock) {
      if (effects.halo.reversalUntil < clock) effects.halo.reversalPending = false;
      return undefined;
    }
    const serial = Math.max(1, Math.floor(finite(event.anticipatedBoostIndex, 1)));
    effects.halo.reversalPending = false;
    effects.halo.reversalUntil = 0;
    effects.halo.reversalBoostSerial = serial;
    bump("reversalsUsed");
    const boostYaw = rank >= 2
      ? finite(event.intendedYaw, event.baseYaw)
      : finite(event.baseYaw, effects.halo.reversalYaw) + Math.PI;
    const cueYaw = boostYaw + Math.PI;
    cue("halo", "reversal", {
      ...event,
      x: finite(event.playerX, ctx.player?.state?.x),
      y: finite(event.playerY, ctx.player?.state?.y),
      z: finite(event.playerZ, ctx.player?.state?.z),
      yaw: cueYaw,
      rank, intensity: rank >= 2 ? 0.86 : 0.7,
      talentId: "halo_pilgrims_reversal", stage: "consume",
    });
    return {
      cost: 0,
      yaw: boostYaw,
      attack: rank >= 2 ? !!event.intendedAttack : false,
      contactEnabled: rank >= 2,
      steerLockSeconds: rank >= 2 ? 0 : 0.3,
      source: "pilgrims-reversal",
    };
  }

  function modifyBoostImpact(event = {}) {
    if (talentRank("halo_pilgrims_reversal") < 2 || !event.firstImpact
      || event.source !== "pilgrims-reversal"
      || Math.floor(finite(event.boostIndex)) !== effects.halo.reversalBoostSerial) return undefined;
    bump("reversalImpacts");
    return { stun: 0.75, source: "pilgrims-reversal" };
  }

  function modifyObjectiveChannel(event = {}) {
    if (event.kind !== "relay") return undefined;
    const shielded = event.shieldActive ?? ctx.shield?.state?.active;
    if (!shielded) return { progressMultiplier: 1, source: "unshielded" };
    const mercy = talentRank("halo_mercy_circuit");
    if (mercy <= 0) return { progressMultiplier: 0, source: "aegis-paused" };
    if (clock >= effects.halo.mercyCueAt) {
      effects.halo.mercyCueAt = clock + 0.85;
      cue("halo", "mercy", {
        ...event, rank: mercy, intensity: 0.42,
        talentId: "halo_mercy_circuit", stage: "channel",
      });
    }
    return {
      progressMultiplier: mercy >= 2 ? 0.75 : 0.5,
      source: "mercy-circuit",
    };
  }

  function noteVerb(verb, event = {}) {
    const wingbeat = talentRank("wing_wingbeat_conversion");
    const circuitEvent = verb === "perfectGuard" ? {
      ...event,
      x: finite(event.playerX, ctx.player?.state?.x),
      y: finite(event.playerY, ctx.player?.state?.y),
      z: finite(event.playerZ, ctx.player?.state?.z),
      yaw: finite(event.yaw, ctx.player?.state?.yaw),
    } : event;
    if (verb === "boost") {
      const reversal = event.modifierSource === "pilgrims-reversal";
      if (!reversal && talentRank("wing_gravitic_wake") > 0 && !event.attack) {
        effects.wake = {
          x: finite(event.x), y: finite(event.y), z: finite(event.z),
          until: clock + 2.5, nextPulse: clock,
          rank: talentRank("wing_gravitic_wake"),
        };
        bump("graviticWakes");
        cue("wing", "wake", {
          ...event, radius: talentRank("wing_gravitic_wake") >= 2 ? 4 : 2.5,
          rank: talentRank("wing_gravitic_wake"), intensity: 0.58,
          talentId: "wing_gravitic_wake", stage: "arm",
        });
      }
      const ram = talentRank("wing_rams_halo");
      if (!reversal && ram > 0 && event.attack) {
        effects.ramPrimeUntil = clock + 3;
        ctx.combat?.shockwave?.(finite(event.x), finite(event.y), finite(event.z), {
          radius: 4, damage: 0, stun: ram >= 2 ? 0.8 : 0.5, knockSpeed: 7,
          source: "rams-halo",
        });
        bump("ramsHalos");
        cue("wing", "ram", {
          ...event, radius: 4, rank: ram, intensity: ram >= 2 ? 0.84 : 0.68,
          talentId: "wing_rams_halo", stage: "arm",
        });
      }
    } else if (verb === "boostEnd") {
      effects.lastBoostAt = clock;
      return event;
    } else if (verb === "jet" && wingbeat > 0) {
      const windowSeconds = wingbeat >= 2 ? 0.7 : 0.45;
      if (clock - finite(effects.lastBoostAt, -99) <= windowSeconds) {
        ctx.jetpack?.restoreCharge?.(finite(event.ignitionCost), "wingbeat-conversion");
        if (wingbeat >= 2) effects.wingShotUntil = clock + 4;
        bump("wingbeatConversions");
        cue("wing", "conversion", {
          ...event, rank: wingbeat, intensity: wingbeat >= 2 ? 0.86 : 0.68,
          talentId: "wing_wingbeat_conversion", stage: "convert",
        });
      }
    }

    if (capstoneActive("wing_unbroken_circuit") && clock >= effects.circuit.readyAt) {
      for (const [key, at] of effects.circuit.verbs) {
        if (clock - at > 8) effects.circuit.verbs.delete(key);
      }
      const circuitSize = effects.circuit.verbs.size;
      effects.circuit.verbs.set(verb, clock);
      if (effects.circuit.verbs.size > circuitSize && effects.circuit.verbs.size < 3) {
        cue("wing", "circuit", {
          ...circuitEvent, count: effects.circuit.verbs.size, radius: 2.2,
          intensity: 0.4 + Math.min(3, effects.circuit.verbs.size) * 0.12,
          capstone: true, talentId: "wing_unbroken_circuit", stage: "segment",
        });
      }
      if (effects.circuit.verbs.size >= 3) {
        ctx.jetpack?.restoreCharge?.(25, "unbroken-circuit");
        const ps = ctx.player?.state || event;
        ctx.combat?.shockwave?.(finite(ps.x), finite(ps.y), finite(ps.z), {
          radius: 6, damage: 38, edgeFalloff: 0.5, stun: 0.65, knockSpeed: 8,
          source: "unbroken-circuit",
        });
        effects.circuit.verbs.clear();
        effects.circuit.readyAt = clock + 12;
        bump("circuitsCompleted");
        cue("wing", "circuit", {
          ...ps, radius: 6, count: 3, intensity: 1, capstone: true,
          talentId: "wing_unbroken_circuit", stage: "complete",
        });
      }
    }
    return event;
  }

  function modifySlam(options = {}) {
    const changed = {};
    const gospel = talentRank("wing_falling_gospel");
    if (gospel > 0 && effects.feathers > 0) {
      const feathers = effects.feathers;
      changed.radius = finite(options.radius) + feathers * 1.5;
      changed.damage = finite(options.damage) * (1 + feathers * 0.08);
      if (gospel >= 2 && feathers >= 3) ctx.jetpack?.restoreCharge?.(15, "falling-gospel");
      effects.feathers = 0;
      bump("featherFalls");
      cue("wing", "feather", {
        ...(ctx.player?.state || options), radius: changed.radius, count: feathers,
        rank: gospel, intensity: Math.min(1, 0.58 + feathers * 0.13),
        talentId: "wing_falling_gospel", stage: "consume",
      });
    }
    if (talentRank("wing_rams_halo") > 0 && effects.ramPrimeUntil >= clock) {
      const ram = talentRank("wing_rams_halo");
      changed.radius = finite(changed.radius, options.radius) + (ram >= 2 ? 2 : 1);
      changed.damage = finite(changed.damage, options.damage) * (ram >= 2 ? 1.2 : 1.1);
      effects.ramPrimeUntil = 0;
      bump("ramPrimedFalls");
      cue("wing", "ram", {
        ...(ctx.player?.state || options), radius: changed.radius, rank: ram,
        intensity: ram >= 2 ? 0.95 : 0.78,
        talentId: "wing_rams_halo", stage: "consume",
      });
    }
    return changed;
  }

  function commandFusionId(first, second) {
    const pair = new Set([first, second]);
    if (pair.has("orbital") && pair.has("cluster")) return "sunshard";
    if (pair.has("orbital") && pair.has("resupply")) return "halo_bastion";
    if (pair.has("cluster") && pair.has("resupply")) return "reliquary_minefield";
    return "";
  }

  function activeSigilRecords(value) {
    const records = value instanceof Map ? [...value.values()]
      : Array.isArray(value) ? value : [];
    return records.filter((sigil) => sigil && (sigil.remaining === undefined
      || finite(sigil.remaining) > 0));
  }

  function modifyCommandCall(request = {}) {
    const key = request.key;
    if (!STRATAGEM_KEYS.has(key)) return undefined;
    const recall = talentRank("edict_recall_rite");
    const pending = Array.isArray(request.pending) ? request.pending : [];
    const existing = [...pending].reverse().find((shot) => shot?.key === key
      && !shot.relocated && finite(shot.t) > 0.6);
    if (recall > 0 && existing) {
      bump("commandsRecalled");
      return {
        handled: false,
        allowWhileCooldown: true,
        relocate: {
          shotId: existing.id,
          target: request.target,
          addedDelay: recall >= 2 ? 0.75 : 2,
          preserveSiren: recall >= 2,
        },
      };
    }

    const change = {};
    const offensive = key === "orbital" || key === "cluster";
    const siren = talentRank("edict_siren_beacon");
    if (offensive && siren > 0) {
      change.siren = {
        radius: siren >= 2 ? 20 : 12,
        pullKeys: ["thresher", "gleaner"],
        faceKeys: siren >= 2 ? ["harrow", "matriarch"] : [],
        speedScale: siren >= 2 ? 0.78 : 0.68,
      };
    }
    const liveFuse = talentRank("edict_live_fuse");
    if (offensive && liveFuse > 0) {
      change.liveFuse = {
        seconds: 0.35,
        precisionSeconds: liveFuse >= 2 ? 0.7 : 0.35,
        maxReduction: liveFuse >= 2 ? 2.8 : 1.4,
      };
    }
    const chapel = talentRank("edict_field_chapel");
    if (key === "resupply" && chapel > 0) {
      change.sanctuary = {
        duration: chapel >= 2 ? 14 : 10,
        radius: 8,
        heatPerSecond: 0.05,
        chargePerSecond: 3,
        drawRadius: 18,
        blocksProjectiles: chapel >= 2,
      };
    }

    if (capstoneActive("edict_combined_liturgy")) {
      change.sigil = { duration: 8, radius: 9 };
      if (clock >= effects.edict.fusionReadyAt && finite(request.cooldownRemaining) <= 0) {
        const target = request.target || {};
        const sigil = activeSigilRecords(request.sigils).find((candidate) => {
          const candidateKey = candidate.key || candidate.commandKey;
          if (!candidate.id || candidateKey === key) return false;
          const radius = Math.max(0.5, finite(candidate.radius, 9));
          return Math.hypot(finite(candidate.x) - finite(target.x),
            finite(candidate.z) - finite(target.z)) <= radius;
        });
        const sigilKey = sigil?.key || sigil?.commandKey;
        const fusionId = sigil ? commandFusionId(sigilKey, key) : "";
        if (sigil && fusionId) {
          change.consumeSigilId = sigil.id;
          change.fusion = {
            id: fusionId,
            anchor: {
              id: sigil.id,
              key: sigilKey,
              x: finite(sigil.x),
              y: finite(sigil.y),
              z: finite(sigil.z),
            },
          };
          effects.edict.fusionReadyAt = clock + 30;
          effects.edict.lastFusion = { id: fusionId, at: clock, first: sigilKey, second: key };
          effects.edict.sigils.delete(sigil.id);
          bump("combinedLiturgies");
        }
      }
    }
    return Object.keys(change).length ? change : undefined;
  }

  function modifyCommandBeaconHit(event = {}) {
    const shot = event.shot || {};
    if (shot.key !== "orbital" && shot.key !== "cluster") return undefined;
    const rank = talentRank("edict_live_fuse");
    if (rank <= 0) return undefined;
    const seconds = rank >= 2 && event.precision ? 0.7 : 0.35;
    const maxReduction = rank >= 2 ? 2.8 : 1.4;
    if (finite(event.alreadyReduced, shot.reducedBy) >= maxReduction) return false;
    bump(event.precision ? "precisionFuses" : "liveFuses");
    return { seconds, maxReduction, source: "live-fuse" };
  }

  function modifyCommandResolution(event = {}) {
    const shot = event.shot || event;
    if (shot?.id) effects.edict.beacons.delete(shot.id);
    return undefined;
  }

  function onCommandInbound(event = {}) {
    const shot = event.shot || event;
    const id = typeof shot.id === "string" ? shot.id : "";
    if (!id || !STRATAGEM_KEYS.has(shot.key)) return event;
    effects.edict.beacons.set(id, {
      id,
      key: shot.key,
      x: finite(shot.x),
      y: finite(shot.y),
      z: finite(shot.z),
      remaining: Math.max(0, finite(shot.t, event.seconds)),
      initialDelay: Math.max(0, finite(shot.initialDelay, event.seconds)),
      reducedBy: Math.max(0, finite(shot.reducedBy)),
      relocated: !!shot.relocated,
      siren: !!shot.siren || ((shot.key === "orbital" || shot.key === "cluster")
        && talentRank("edict_siren_beacon") > 0),
      liveFuse: !!shot.liveFuse || ((shot.key === "orbital" || shot.key === "cluster")
        && talentRank("edict_live_fuse") > 0),
    });
    bump("edictBeaconsCalled");
    if (effects.edict.beacons.get(id)?.siren) {
      cue("edict", "siren", {
        ...shot, radius: shot.siren?.radius || 12, intensity: 0.62,
        talentId: "edict_siren_beacon", stage: "inbound",
      });
    }
    return event;
  }

  function onCommandRelocated(event = {}) {
    const shot = event.shot || event;
    const id = typeof shot.id === "string" ? shot.id : "";
    if (!id) return event;
    const prior = effects.edict.beacons.get(id) || { id, key: shot.key || event.key };
    effects.edict.beacons.set(id, {
      ...prior,
      x: finite(shot.x, prior.x),
      y: finite(shot.y, prior.y),
      z: finite(shot.z, prior.z),
      remaining: Math.max(0, finite(shot.t, event.remaining ?? event.seconds ?? prior.remaining)),
      relocated: true,
      siren: shot.siren === undefined ? !!prior.siren : !!shot.siren,
    });
    cue("edict", "recall", {
      ...shot, intensity: 0.76, rank: talentRank("edict_recall_rite"),
      talentId: "edict_recall_rite", stage: "relocate",
    });
    return event;
  }

  function onCommandBeaconHit(event = {}) {
    const shot = event.shot || event;
    const id = typeof shot.id === "string" ? shot.id
      : typeof shot.commandId === "string" ? shot.commandId : "";
    if (!id) return event;
    const prior = effects.edict.beacons.get(id);
    if (prior) {
      prior.remaining = Math.max(0, finite(shot.t, event.remaining ?? prior.remaining));
      prior.reducedBy = Math.max(0, finite(shot.reducedBy,
        event.totalReduced ?? event.reducedBy ?? prior.reducedBy));
    }
    cue("edict", "fuse", {
      ...shot, intensity: event.precision ? 0.86 : 0.66,
      rank: talentRank("edict_live_fuse"),
      talentId: "edict_live_fuse", stage: event.precision ? "precision" : "hit",
    });
    return event;
  }

  function onCommandImpact(event = {}) {
    const shot = event.shot || event;
    if (typeof shot.id === "string") effects.edict.beacons.delete(shot.id);
    return event;
  }

  function onCommandSanctuary(event = {}) {
    const fieldState = event.sanctuary || event.field || event;
    const id = typeof fieldState.id === "string" ? fieldState.id : "";
    if (!id) return event;
    effects.edict.sanctuaries.set(id, {
      id,
      x: finite(fieldState.x),
      y: finite(fieldState.y),
      z: finite(fieldState.z),
      radius: Math.max(0, finite(fieldState.radius, 8)),
      remaining: Math.max(0, finite(fieldState.remaining, fieldState.duration)),
      blocksProjectiles: !!fieldState.blocksProjectiles,
      fusionId: typeof fieldState.fusionId === "string" ? fieldState.fusionId : "",
    });
    const chapelRank = talentRank("edict_field_chapel");
    const fieldChapel = chapelRank > 0 && !fieldState.fusionId;
    if (fieldChapel) {
      bump("fieldChapels");
      cue("edict", "chapel", {
        ...fieldState, radius: Math.max(0, finite(fieldState.radius, 8)),
        intensity: chapelRank >= 2 ? 0.82 : 0.64,
        rank: chapelRank,
        talentId: "edict_field_chapel", stage: "form",
      });
    }
    return event;
  }

  function onCommandSigil(event = {}) {
    const sigil = event.sigil || event;
    const id = typeof sigil.id === "string" ? sigil.id : "";
    const key = sigil.key || sigil.commandKey;
    if (!id || !STRATAGEM_KEYS.has(key)) return event;
    effects.edict.sigils.set(id, {
      id,
      key,
      x: finite(sigil.x),
      y: finite(sigil.y),
      z: finite(sigil.z),
      radius: Math.max(0, finite(sigil.radius, 9)),
      remaining: Math.max(0, finite(sigil.remaining, sigil.duration)),
    });
    cue("edict", "sigil", {
      ...sigil, radius: Math.max(0, finite(sigil.radius, 9)), intensity: 0.62,
      capstone: true, talentId: "edict_combined_liturgy", stage: "form",
    });
    return event;
  }

  function onCommandFusion(event = {}) {
    const fusion = event.fusion || event;
    const id = typeof fusion.id === "string" ? fusion.id : "";
    if (!id) return event;
    const effectPoint = fusion.effectPoint && typeof fusion.effectPoint === "object"
      ? fusion.effectPoint : fusion;
    const point = {
      x: finite(effectPoint.x, fusion.anchor?.x),
      y: finite(effectPoint.y, fusion.anchor?.y),
      z: finite(effectPoint.z, fusion.anchor?.z),
    };
    effects.edict.lastFusion = {
      id,
      at: clock,
      first: fusion.first || fusion.anchor?.key
        || (id === "sunshard" ? (fusion.commandKey === "orbital" ? "cluster" : "orbital")
          : id === "halo_bastion" ? (fusion.commandKey === "orbital" ? "resupply" : "orbital")
            : id === "reliquary_minefield"
              ? (fusion.commandKey === "cluster" ? "resupply" : "cluster") : ""),
      second: fusion.second || fusion.key || fusion.commandKey || "",
      effectPoint: point,
    };
    effects.edict.fusionReadyAt = Math.max(effects.edict.fusionReadyAt, clock + 30);
    bump("fusionsResolved");
    cue("edict", "fusion", {
      ...fusion, ...point,
      radius: Math.max(0.75, finite(fusion.effectRadius, fusion.outcome?.radius || 9)),
      intensity: 1, capstone: true, talentId: "edict_combined_liturgy",
      source: id, stage: "resolve",
    });
    return event;
  }

  function update(dt) {
    if (disposed) return;
    const elapsed = Math.max(0, finite(dt));
    clock += elapsed;
    if (effects.halo.reversalPending && effects.halo.reversalUntil < clock) {
      effects.halo.reversalPending = false;
    }
    for (const [id, brand] of effects.brands) if (brand.until < clock) effects.brands.delete(id);
    for (const [id, exposed] of effects.exposed) if (exposed.until < clock) effects.exposed.delete(id);
    for (const [id, beacon] of effects.edict.beacons) {
      beacon.remaining = Math.max(0, finite(beacon.remaining) - elapsed);
      if (beacon.remaining <= 0) effects.edict.beacons.delete(id);
    }
    for (const [id, sanctuary] of effects.edict.sanctuaries) {
      sanctuary.remaining = Math.max(0, finite(sanctuary.remaining) - elapsed);
      if (sanctuary.remaining <= 0) effects.edict.sanctuaries.delete(id);
    }
    for (const [id, sigil] of effects.edict.sigils) {
      sigil.remaining = Math.max(0, finite(sigil.remaining) - elapsed);
      if (sigil.remaining <= 0) effects.edict.sigils.delete(id);
    }
    if (effects.wake) {
      if (effects.wake.until < clock) effects.wake = null;
      else if (clock >= effects.wake.nextPulse) {
        ctx.combat?.shockwave?.(effects.wake.x, effects.wake.y, effects.wake.z, {
          radius: effects.wake.rank >= 2 ? 4 : 2.5,
          damage: 0,
          stun: effects.wake.rank >= 2 ? 0.45 : 0.28,
          knockSpeed: 2,
          source: "gravitic-wake",
        });
        cue("wing", "wake", {
          ...effects.wake, radius: effects.wake.rank >= 2 ? 4 : 2.5,
          intensity: 0.38, talentId: "wing_gravitic_wake", stage: "pulse",
        });
        effects.wake.nextPulse = clock + 0.48;
      }
    }
    for (const [verb, at] of effects.circuit.verbs) {
      if (clock - at > 8) effects.circuit.verbs.delete(verb);
    }
  }

  stops.push(ctx.mission?.bus?.on?.("inbound", onCommandInbound));
  stops.push(ctx.mission?.bus?.on?.("relocated", onCommandRelocated));
  stops.push(ctx.mission?.bus?.on?.("beaconHit", onCommandBeaconHit));
  stops.push(ctx.mission?.bus?.on?.("impact", onCommandImpact));
  stops.push(ctx.mission?.bus?.on?.("sanctuary", onCommandSanctuary));
  stops.push(ctx.mission?.bus?.on?.("sigil", onCommandSigil));
  stops.push(ctx.mission?.bus?.on?.("fusion", onCommandFusion));
  stops.push(ctx.mission?.bus?.on?.("relayDone", (event = {}) => {
    const relayKey = typeof event.key === "string" ? event.key.trim() : "";
    if (!relayKey) return;
    const receipt = sourceReceipt("relay", relayKey);
    if (noteLifetimeOnce(receipt, "relays")) {
      grantXp(XP_AWARDS.relay_silenced.amount, receipt, XP_AWARDS.relay_silenced.id);
    }
  }));
  stops.push(ctx.combat?.bus?.on?.("playerDied", () => {
    resetEffects({ preserveCounters: true });
  }));
  stops.push(ctx.mission?.bus?.on?.("won", () => {
    const receipt = sourceReceipt("win", "complete");
    if (noteLifetimeOnce(receipt, "operations")) {
      grantXp(XP_AWARDS.operation_won.amount, receipt, XP_AWARDS.operation_won.id);
    }
  }));
  stops.push(ctx.breaches?.bus?.on?.("cleared", (event = {}) => {
    const cycle = event.cycle;
    const waveIndex = event.waveIndex;
    if (!Number.isInteger(cycle) || cycle < 1
      || !Number.isInteger(waveIndex) || waveIndex < 0) return;
    const receipt = sourceReceipt("breach-wave", `${cycle}:${waveIndex}`);
    if (noteLifetimeOnce(receipt, "breachWaves")) {
      grantXp(XP_AWARDS.breach_wave_cleared.amount, receipt,
        XP_AWARDS.breach_wave_cleared.id);
    }
  }));
  stops.push(ctx.breaches?.bus?.on?.("complete", (event = {}) => {
    const cycle = event.cycle ?? event.cyclesCleared;
    if (!Number.isInteger(cycle) || cycle < 1) return;
    const receipt = sourceReceipt("breach-cycle", cycle);
    if (noteLifetimeOnce(receipt, "breachCycles")) {
      grantXp(XP_AWARDS.breach_cycle_cleared.amount, receipt,
        XP_AWARDS.breach_cycle_cleared.id);
    }
  }));

  window.addEventListener("pagehide", flushPersistence);

  return {
    bus,
    state,
    definitions: () => clone(DEFINITIONS),
    onChange(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    rank: talentRank,
    has: (talentId, minimum = 1) => talentRank(talentId) >= minimum,
    capstoneActive,
    canEdit: editStatus,
    grantXp,
    spend,
    refund,
    respec,
    equipCapstone,
    unequipCapstone,
    captureCareer,
    restoreCareer,
    mergeCareer,
    validateCareer,
    captureField,
    restoreField,
    restoreFieldForQA,
    clearFieldLoadout,
    validateField,
    validateFieldState: validateField,
    attachPersistence,
    resetForQA,
    onEnemyKilled,
    modifyEnemyDamage,
    onEnemyDamaged,
    onWeaponFire,
    onVent,
    onVentComplete,
    onMeleeStrike,
    onShieldBlock,
    modifyShieldFrame,
    onShieldRelease,
    modifyBoostTrigger,
    modifyBoostImpact,
    modifyObjectiveChannel,
    noteVerb,
    modifySlam,
    modifyCommandCall,
    modifyCommandBeaconHit,
    modifyCommandResolution,
    onCommandInbound,
    onCommandRelocated,
    onCommandBeaconHit,
    onCommandImpact,
    onCommandSanctuary,
    onCommandSigil,
    onCommandFusion,
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (persistTimer) window.clearTimeout(persistTimer);
      persistTimer = 0;
      if (!ctx.qa && persistence) {
        persistence.writeCareer?.(captureCareer(), { reason: "progression-dispose" })
          ?? persistence.write?.(captureCareer(), { reason: "progression-dispose" });
      }
      for (const stop of stops) stop?.();
      listeners.clear();
      bus.clear();
      window.removeEventListener("pagehide", flushPersistence);
    },
  };
}
