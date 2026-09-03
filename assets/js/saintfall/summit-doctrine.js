/* ============================================================
   SAINTFALL - Kenosis doctrine runtime

   Implements the same public contract `ui.js`'s doctrine board and
   `audio.js`'s cue subscriber read from the campaign's
   `progression.js`, over the two Kenosis trees. It is deliberately
   NOT that file: the campaign runtime carries a career/field split,
   a 12,000-entry receipt ledger, cloud merge reconciliation and a
   copy-override table, none of which a trials ground has any use
   for. What it does carry is the surface everything else expects -
   `state()`, `definitions()`, `rank()`, `spend()`, `canEdit()`,
   `onChange()`, and a `bus` that emits "doctrine".

   TWO WAYS A RITE TAKES EFFECT, and no third:

   1. `kit(key, fallback, detail)` - the modifier oracle. The kits
      ask for a number they were going to use anyway (blink charges,
      stoop damage, guard speed) and get it back modified. Nothing in
      summit-kenosis.js knows a talent id.
   2. `verb(name, detail)` - the authority. A kit reports that
      something happened and THIS file decides what the doctrine adds
      to the world, calling combat/enemies/vfx itself.

   Every rite ends in `cue()`, which is the single place the doctrine
   bus, the VFX and the camera kick are fired from - the same design
   as the campaign, so `audio.doctrineCue` needs no special case.
   ============================================================ */

import { makeBus, clamp01 } from "saintfall/core.js";
import {
  KENOSIS_RANK_CAP, KENOSIS_POINT_START_RANK, KENOSIS_POINTS_PER_RANK,
  KENOSIS_MAX_POINTS_PER_ORDER, KENOSIS_CAPSTONE_POINTS,
  KENOSIS_VOW_SEAL_RANKS, KENOSIS_XP_THRESHOLDS, KENOSIS_XP_AWARDS,
  TUNING, kenosisTreeFor, kenosisNodeIds,
} from "saintfall/summit-doctrine-config.js";
import { DISTRICT_SITE_BOSS_KEYS, BOSS_ENEMY_KEYS } from "saintfall/progression.js";

const STORE_PREFIX = "saintfall:kenosis-doctrine:v1:";

function rankForXp(totalXp) {
  let rank = 1;
  for (let i = 0; i < KENOSIS_XP_THRESHOLDS.length; i += 1) {
    if (totalXp >= KENOSIS_XP_THRESHOLDS[i]) rank = i + 1;
  }
  return Math.min(KENOSIS_RANK_CAP, rank);
}
function pointsForRank(rank) {
  return Math.max(0, Math.min(KENOSIS_RANK_CAP, Math.floor(rank))
    - KENOSIS_POINT_START_RANK + 1) * KENOSIS_POINTS_PER_RANK;
}
function sealsForRank(rank) {
  return KENOSIS_VOW_SEAL_RANKS.filter((r) => rank >= r).length;
}

export function buildSummitDoctrine(ctx, player) {
  const characterId = ctx.playerCharacter?.id || null;
  const tree = kenosisTreeFor(characterId);
  if (!tree) return null;

  const bus = makeBus();
  const NODE_IDS = new Set(kenosisNodeIds(tree.id));
  const TALENTS = new Map();
  const CAPSTONES = new Map();
  const ORDER_OF = new Map();
  for (const order of tree.orders) {
    for (const talent of order.talents) {
      TALENTS.set(talent.id, talent);
      ORDER_OF.set(talent.id, order.id);
    }
    if (order.capstone) {
      CAPSTONES.set(order.capstone.id, order.capstone);
      ORDER_OF.set(order.capstone.id, order.id);
    }
  }

  /* ---------------------- the record ---------------------- */
  const store = `${STORE_PREFIX}${tree.id}`;
  const fresh = () => ({ totalXp: 0, allocations: {}, activeCapstones: [null, null] });
  let record = fresh();
  try {
    const raw = window.localStorage?.getItem(store);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        record.totalXp = Math.max(0, Math.floor(Number(parsed.totalXp) || 0));
        for (const [id, value] of Object.entries(parsed.allocations || {})) {
          const talent = TALENTS.get(id);
          if (!talent) continue;
          const n = Math.floor(Number(value) || 0);
          if (n > 0) record.allocations[id] = Math.min(talent.maxRank, n);
        }
        const caps = Array.isArray(parsed.activeCapstones) ? parsed.activeCapstones : [];
        record.activeCapstones = [0, 1].map((i) => (CAPSTONES.has(caps[i]) ? caps[i] : null));
      }
    }
  } catch (_) { record = fresh(); }

  let persistTimer = 0;
  function persist() {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      try { window.localStorage?.setItem(store, JSON.stringify(record)); } catch (_) { /* private mode */ }
    }, 250);
  }

  const listeners = new Set();
  function notify() {
    const snap = state();
    for (const fn of listeners) { try { fn(snap); } catch (_) { /* keep the rest */ } }
    return snap;
  }

  /* ---------------------- reading ---------------------- */
  const rank = (id) => Math.max(0, Math.floor(Number(record.allocations[id]) || 0));
  const has = (id, min = 1) => rank(id) >= min;
  const capstoneActive = (id) => record.activeCapstones.includes(id);
  const pointsInOrder = (orderId) => tree.orders
    .find((o) => o.id === orderId)?.talents
    .reduce((sum, t) => sum + rank(t.id), 0) || 0;
  const pointsSpent = () => Object.values(record.allocations)
    .reduce((sum, v) => sum + Math.max(0, Math.floor(Number(v) || 0)), 0);

  /** The tuned value for a rite at its current rank, or null when
   *  unowned. `TUNING[id][key]` is a [rank1, rank2] pair. */
  function tuned(id, key) {
    const r = rank(id);
    if (r <= 0) return null;
    const row = TUNING[id];
    if (!row) return null;
    const pair = row[key];
    if (Array.isArray(pair)) return pair[Math.min(pair.length - 1, r - 1)];
    return Number.isFinite(pair) ? pair : null;
  }
  /** Capstone numbers are single values and gated on being BOUND. */
  function vow(id, key) {
    if (!capstoneActive(id)) return null;
    const row = TUNING[id];
    const value = row ? row[key] : null;
    return Number.isFinite(value) ? value : null;
  }

  function editStatus() {
    if (ctx.qa) return { ok: true, message: "" };
    const menuOpen = typeof document !== "undefined"
      && document.body?.classList?.contains("rb-escape-menu-open");
    if (!menuOpen) {
      return { ok: false, message: "Open the field menu to revise Doctrine." };
    }
    return { ok: true, message: "" };
  }

  function state() {
    const fieldRank = rankForXp(record.totalXp);
    const earned = pointsForRank(fieldRank);
    const spent = pointsSpent();
    const edit = editStatus();
    const floorXp = KENOSIS_XP_THRESHOLDS[fieldRank - 1] ?? 0;
    const nextXp = KENOSIS_XP_THRESHOLDS[fieldRank] ?? 0;
    return {
      treeId: tree.id,
      title: tree.title,
      rank: fieldRank,
      rankCap: KENOSIS_RANK_CAP,
      totalXp: record.totalXp,
      xp: record.totalXp,
      xpIntoRank: Math.max(0, record.totalXp - floorXp),
      xpForNext: fieldRank >= KENOSIS_RANK_CAP ? 0 : Math.max(0, nextXp - floorXp),
      pointsEarned: earned,
      pointsSpent: spent,
      pointsAvailable: Math.max(0, earned - spent),
      points: { earned, spent, free: Math.max(0, earned - spent) },
      activeCapstones: record.activeCapstones.slice(0, 2),
      vowSealsEarned: sealsForRank(fieldRank),
      editLocked: !edit.ok,
      lockReason: edit.message,
      orders: tree.orders.map((order) => {
        const invested = pointsInOrder(order.id);
        return {
          id: order.id,
          points: invested,
          talents: order.talents.map((talent) => ({
            id: talent.id,
            rank: rank(talent.id),
            implemented: true,
            eligible: invested >= (talent.requires?.orderPoints || 0),
            refundable: true,
          })),
          capstone: order.capstone ? {
            id: order.capstone.id,
            implemented: true,
            equipped: capstoneActive(order.capstone.id),
            eligible: invested >= KENOSIS_CAPSTONE_POINTS,
          } : null,
        };
      }),
      effects: { counts: { ...procCounts } },
    };
  }

  const definitions = () => ({
    id: tree.id,
    title: tree.title,
    subtitle: tree.subtitle,
    orders: tree.orders,
    maxPointsPerOrder: KENOSIS_MAX_POINTS_PER_ORDER,
    capstoneEligibilityPoints: KENOSIS_CAPSTONE_POINTS,
    rankCap: KENOSIS_RANK_CAP,
    vowSealRanks: KENOSIS_VOW_SEAL_RANKS,
  });

  /* ---------------------- mutations ---------------------- */
  const result = (ok, message, extra = {}) => ({ ok, message, state: state(), ...extra });

  function spend(talentId) {
    const edit = editStatus();
    if (!edit.ok) return result(false, edit.message);
    const talent = TALENTS.get(talentId);
    if (!talent) return result(false, "Unknown rite.");
    const current = rank(talentId);
    if (current >= talent.maxRank) return result(false, "Maximum rank reached.");
    const snap = state();
    if (snap.pointsAvailable < 1) return result(false, "No Doctrine Points remain.");
    const orderId = ORDER_OF.get(talentId);
    const invested = pointsInOrder(orderId);
    const need = talent.requires?.orderPoints || 0;
    if (invested < need) return result(false, `Requires ${need} points in this Order.`);
    if (invested >= KENOSIS_MAX_POINTS_PER_ORDER) {
      return result(false, `This Order is limited to ${KENOSIS_MAX_POINTS_PER_ORDER} Doctrine Points.`);
    }
    record.allocations[talentId] = current + 1;
    persist();
    notify();
    return result(true, `${talent.name} inscribed.`);
  }

  function refund(talentId) {
    const edit = editStatus();
    if (!edit.ok) return result(false, edit.message);
    const talent = TALENTS.get(talentId);
    if (!talent) return result(false, "Unknown rite.");
    const current = rank(talentId);
    if (current <= 0) return result(false, "No rank has been inscribed.");
    const orderId = ORDER_OF.get(talentId);
    const after = pointsInOrder(orderId) - 1;
    /* A refund may not strand a higher tier or unqualify a bound Vow. */
    for (const other of tree.orders.find((o) => o.id === orderId).talents) {
      if (other.id === talentId || rank(other.id) <= 0) continue;
      if ((other.requires?.orderPoints || 0) > after) {
        return result(false, "Refund the dependent rites first.");
      }
    }
    const cap = tree.orders.find((o) => o.id === orderId)?.capstone;
    if (cap && capstoneActive(cap.id) && after < KENOSIS_CAPSTONE_POINTS) {
      return result(false, "Unbind this Order's Vow first.");
    }
    if (current - 1 <= 0) delete record.allocations[talentId];
    else record.allocations[talentId] = current - 1;
    persist();
    notify();
    return result(true, `${talent.name} released.`);
  }

  function respec() {
    const edit = editStatus();
    if (!edit.ok) return result(false, edit.message);
    record.allocations = {};
    record.activeCapstones = [null, null];
    deadWeightBossStates = new WeakMap();
    persist();
    notify();
    return result(true, "Doctrine reset.");
  }

  function equipCapstone(capstoneId, requestedSlot = null) {
    const edit = editStatus();
    if (!edit.ok) return result(false, edit.message);
    const cap = CAPSTONES.get(capstoneId);
    if (!cap) return result(false, "Unknown Vow.");
    if (capstoneActive(capstoneId)) return result(false, "This Vow is already bound.");
    const invested = pointsInOrder(ORDER_OF.get(capstoneId));
    if (invested < KENOSIS_CAPSTONE_POINTS) {
      return result(false, `Requires ${KENOSIS_CAPSTONE_POINTS} points in this Order.`);
    }
    const seals = sealsForRank(rankForXp(record.totalXp));
    if (seals < 1) return result(false, `The first Vow seal opens at Field Rank ${KENOSIS_VOW_SEAL_RANKS[0]}.`);
    let slot = Number.isInteger(requestedSlot) ? requestedSlot
      : record.activeCapstones.findIndex((v) => !v);
    if (slot < 0) slot = 0;
    if (slot >= seals) return result(false, `That Vow seal opens at Field Rank ${KENOSIS_VOW_SEAL_RANKS[slot]}.`);
    record.activeCapstones[slot] = capstoneId;
    persist();
    notify();
    return result(true, `${cap.name} bound.`);
  }

  function unequipCapstone(slotOrId) {
    const edit = editStatus();
    if (!edit.ok) return result(false, edit.message);
    const slot = Number.isInteger(slotOrId) ? slotOrId
      : record.activeCapstones.indexOf(slotOrId);
    if (slot < 0 || slot > 1) return result(false, "No Vow in that seal.");
    record.activeCapstones[slot] = null;
    persist();
    notify();
    return result(true, "Vow released.");
  }

  function grantXp(amount, _receipt, source = "field") {
    const add = Math.max(0, Math.floor(Number(amount) || 0));
    if (!add) return result(true, "", { awarded: 0 });
    const before = rankForXp(record.totalXp);
    const capXp = KENOSIS_XP_THRESHOLDS[KENOSIS_XP_THRESHOLDS.length - 1];
    record.totalXp = Math.min(capXp, record.totalXp + add);
    const after = rankForXp(record.totalXp);
    persist();
    notify();
    if (after > before) {
      const rankUps = after - before;
      const gainedSeals = sealsForRank(after) - sealsForRank(before);
      const message = `Field Rank ${after} · ${rankUps === 1 ? "Doctrine Point earned" : `${rankUps} Doctrine Points earned`}${gainedSeals > 0 ? ` · ${gainedSeals === 1 ? "Vow Seal earned" : `${gainedSeals} Vow Seals earned`}` : ""}`;
      bus.emit("rank", { rank: after, source });
      ctx.mission?.announce?.(message.toUpperCase(), 3.2);
      ctx.gameUi?.announce?.(message);
    }
    return result(true, "", { awarded: add, rank: after });
  }

  /* ---------------------- the cue ---------------------- */
  const procCounts = Object.create(null);
  const PREP = /^(arm|store|segment|form|channel|pulse)$/;

  function cue(order, kind, detail = {}) {
    const ps = player?.state || {};
    const stage = typeof detail.stage === "string" ? detail.stage : "proc";
    const priority = PREP.test(stage) ? 0
      : detail.capstone ? 3
        : /^(consume|complete|release|resolve)$/.test(stage) ? 2 : 1;
    const event = {
      order,
      kind,
      cue: kind,
      x: Number.isFinite(detail.x) ? detail.x : ps.x || 0,
      y: Number.isFinite(detail.y) ? detail.y : ps.y || 0,
      z: Number.isFinite(detail.z) ? detail.z : ps.z || 0,
      yaw: Number.isFinite(detail.yaw) ? detail.yaw : ps.yaw || 0,
      radius: Math.max(0, Number(detail.radius) || 0),
      intensity: clamp01(Number(detail.intensity ?? 0.72)),
      rank: Math.max(1, Math.floor(Number(detail.rank) || 1)),
      capstone: !!detail.capstone,
      talentId: detail.talentId || "",
      source: detail.source || detail.talentId || kind,
      stage,
      priority,
      count: Math.max(0, Math.floor(Number(detail.count) || 0)),
      value: Math.max(0, Number(detail.value) || 0),
    };
    if (event.talentId) {
      procCounts[event.talentId] = (procCounts[event.talentId] || 0) + 1;
    }
    bus.emit("doctrine", event);
    ctx.vfx?.doctrineCue?.(event);
    player?.pulseDoctrine?.(order, event.intensity, event.capstone ? 0.72 : 0.42);
    if (priority > 0) {
      const weight = event.capstone ? 0.85 : 0.35;
      player?.doctrineKick?.((0.26 + priority * 0.20)
        * (0.55 + event.intensity * 0.55), weight);
    }
  }

  /* ---------------------- live effect state ---------------------- */
  const fx = {
    cutThreadUntil: -99,
    verdict: 0,
    volleyHeld: 0,
    ledgerUntil: -99,
    thinIceUntil: -99,
    lanternAt: -99,
    veilArmed: 0,
    veilUntil: -99,
    stillFor: 0,
    guardStacks: 0,
    bankedWeight: 0,
    unbrokenAt: -99,
    choirAt: -99,
    lastStoopMetres: 0,
    braceUntil: -99,
  };
  const now = () => player?.state?.clock || 0;
  /* Boss control and damage vulnerability are different clocks. A boss can
     be off-balance for Shatterpoint without being unable to act for that
     entire window, and repeated hammer contacts cannot refresh the hard
     stagger until its brace expires. Weak keys keep encounter bodies
     collectible and make this state naturally disappear with the actor. */
  let deadWeightBossStates = new WeakMap();

  function deadWeightBossState(inst, create = false) {
    if (!inst || !BOSS_ENEMY_KEYS.has(inst.key)) return null;
    let state = deadWeightBossStates.get(inst);
    if (!state && create) {
      state = { lockUntil: -99, offBalanceUntil: -99, staggers: 0, resisted: 0 };
      deadWeightBossStates.set(inst, state);
    }
    return state || null;
  }

  function deadWeightOffBalance(inst) {
    const state = deadWeightBossState(inst);
    return !!state && now() < state.offBalanceUntil;
  }

  function deadWeightStatus(inst) {
    const state = deadWeightBossState(inst);
    const clock = now();
    return {
      boss: !!state,
      braced: !!state && clock < state.lockUntil,
      offBalance: !!state && clock < state.offBalanceUntil,
      lockRemaining: state ? Math.max(0, state.lockUntil - clock) : 0,
      offBalanceRemaining: state ? Math.max(0, state.offBalanceUntil - clock) : 0,
      staggers: state?.staggers || 0,
      resisted: state?.resisted || 0,
    };
  }

  /* ============================================================
     THE KIT ORACLE. Numbers the kits were going to use anyway.
     ============================================================ */
  function kit(key, fallback, detail = {}) {
    const base = Number(fallback) || 0;
    switch (key) {
      /* ---- White Vigil ---- */
      case "blinkCharges":
        return tuned("quicksilver_three_places", "charges") ?? base;
      case "blinkRecharge":
        return tuned("quicksilver_three_places", "recharge") ?? base;
      case "meleeDamage": {
        let mult = 1;
        if (now() < fx.cutThreadUntil) {
          mult *= tuned("quicksilver_cut_the_thread", "damage") || 1;
        }
        if (has("anvil_measured_swing") && detail.comboStep === 3) {
          mult *= tuned("anvil_measured_swing", "damage") || 1;
        }
        if (has("anvil_shatterpoint") && detail.staggered) {
          mult *= tuned("anvil_shatterpoint", "damage") || 1;
        }
        if (fx.bankedWeight > 0 && detail.hammer) {
          mult += fx.bankedWeight / Math.max(1, base);
        }
        return base * mult;
      }
      case "crescentRange":
        return tuned("crescent_long_measure", "range") ?? base;
      case "crescentFloor":
        return tuned("crescent_long_measure", "floor") ?? base;
      case "crescentDamage": {
        let mult = 1;
        if (has("crescent_reaping_volley")) {
          const ramp = tuned("crescent_reaping_volley", "ramp") || 0;
          const over = tuned("crescent_reaping_volley", "seconds") || 1.6;
          mult *= 1 + ramp * clamp01(fx.volleyHeld / over);
        }
        if (now() < fx.veilUntil) {
          mult *= (TUNING.vigil_white_vigil.damage) || 1;
        }
        return base * mult;
      }
      case "stoopDamage": {
        const per = tuned("stoop_falling_star", "perMetre");
        if (!per) return base;
        const cap = tuned("stoop_falling_star", "cap") || 0;
        return base + Math.min(cap, per * (Number(detail.metres) || 0));
      }
      case "stoopGroundLaunch":
        return tuned("stoop_high_pass", "launch") ?? base;
      /* ---- Bastion ---- */
      case "guardMoveSpeed":
        return tuned("bulwark_immovable", "speed") ?? base;
      case "incomingDamage": {
        let mult = 1;
        if (fx.guardStacks > 0) {
          const per = tuned("bulwark_anvil_stance", "perStack") || 0;
          mult *= Math.max(0.2, 1 - per * fx.guardStacks);
        }
        if (now() < fx.thinIceUntil) {
          mult *= Math.max(0.2, 1 - (tuned("vigil_thin_ice", "reduction") || 0));
        }
        if (now() < fx.braceUntil) {
          mult *= Math.max(0.2, 1 - (tuned("tocsin_braced_call", "reduction") || 0));
        }
        return base * mult;
      }
      case "castCharges":
        return tuned("cast_second_reliquary", "charges") ?? base;
      case "castCooldown":
        return tuned("cast_second_reliquary", "cooldown") ?? base;
      case "castReturnDamage": {
        /* A share of the OUTBOUND blow, not of the already-halved
           homeward one - multiplying the return leg by 0.6 made the
           rite a downgrade, which the audit caught by asserting the
           number moved the right way. */
        const share = tuned("cast_true_return", "damage");
        if (!share) return base;
        const outbound = Number(detail.outbound);
        return (Number.isFinite(outbound) ? outbound : base * 2) * share;
      }
      case "castKnockdownStun":
        return tuned("cast_hooked_chain", "stun") ?? base;
      case "moveSpeed": {
        let mult = 1;
        if (now() < fx.ledgerUntil) mult *= tuned("vigil_pale_ledger", "speed") || 1;
        if (now() < fx.gaitUntil) mult *= tuned("forge_furnace_gait", "speed") || 1;
        return base * mult;
      }

      /* ---- The call Orders ----
         `summit-command.js` asks for each of a command's four numbers
         at the moment it is called, so a rite bought mid-fight applies
         to the very next call rather than to the next reset. The
         multipliers are absolute - see TUNING's note. */
      case "callCooldown": {
        let mult = 1;
        if (has("antiphon_swift_verse")) {
          mult *= tuned("antiphon_swift_verse", "cooldown") || 1;
        }
        if (has("tocsin_two_bells")) {
          mult *= tuned("tocsin_two_bells", "cooldown") || 1;
        }
        return base * mult;
      }
      case "callDelay":
        return has("tocsin_short_fuse")
          ? base * (tuned("tocsin_short_fuse", "delay") || 1) : base;
      case "callRadius": {
        let mult = 1;
        if (has("antiphon_wider_verse")) {
          mult *= tuned("antiphon_wider_verse", "radius") || 1;
        }
        if (has("tocsin_heavy_ordnance")) {
          mult *= tuned("tocsin_heavy_ordnance", "radius") || 1;
        }
        return base * mult;
      }
      case "callDamage": {
        let mult = 1;
        if (has("antiphon_wider_verse")) {
          mult *= tuned("antiphon_wider_verse", "damage") || 1;
        }
        if (has("tocsin_heavy_ordnance")) {
          mult *= tuned("tocsin_heavy_ordnance", "damage") || 1;
        }
        return base * mult;
      }
      case "callCharges":
        return has("tocsin_two_bells")
          ? (tuned("tocsin_two_bells", "charges") ?? base) : base;
      /* THE TWO STRUCTURED ANSWERS. A Vow that changes the SHAPE of a
         call cannot be expressed as a multiplier, and teaching the
         command module a talent id would put doctrine knowledge in a
         file that has no business holding any. So the doctrine returns
         a small record and the command module performs it. */
      case "callEcho": {
        if (!capstoneActive("antiphon_the_response")) return null;
        const V = TUNING.antiphon_the_response;
        /* The other two of the operative's three, whichever was
           called - so the Vow reads the wheel rather than a list this
           file would have to keep in step with it. */
        const keys = (ctx.command?.wheelOrder || [])
          .filter((k) => k !== detail.key);
        if (!keys.length) return null;
        cue("antiphon", "chorus", {
          radius: 11, capstone: true, talentId: "antiphon_the_response",
          stage: "form", intensity: 1, count: keys.length,
        });
        return {
          keys,
          radiusScale: V.radiusScale,
          damageScale: V.damageScale,
          stagger: V.stagger,
        };
      }
      case "callInstant": {
        if (!capstoneActive("tocsin_the_great_bell") || !detail.guarding) return null;
        const V = TUNING.tocsin_the_great_bell;
        cue("tocsin", "toll", {
          radius: V.groundRadius, capstone: true,
          talentId: "tocsin_the_great_bell", stage: "resolve", intensity: 1.2,
        });
        return { atSelf: true, delay: 0, groundFlyers: true, stun: V.stun };
      }
      default:
        return base;
    }
  }
  fx.gaitUntil = -99;

  /* ============================================================
     THE AUTHORITY. A kit reports a verb; the doctrine answers.
     ============================================================ */
  const shock = (x, y, z, opts) => ctx.combat?.shockwave?.(x, y, z, opts);

  function verb(name, detail = {}) {
    const ps = player?.state || {};
    const clock = now();
    switch (name) {
      /* -------------------- White Vigil -------------------- */
      case "blink": {
        const fromX = Number(detail.fromX) || ps.x;
        const fromZ = Number(detail.fromZ) || ps.z;
        if (has("antiphon_answering_step") && ctx.command?.cooldowns) {
          const off = tuned("antiphon_answering_step", "refund") || 0;
          let moved = 0;
          for (const key of ctx.command.wheelOrder || []) {
            const before = ctx.command.cooldowns[key] || 0;
            if (before <= 0) continue;
            ctx.command.cooldowns[key] = Math.max(0, before - off);
            moved += before - ctx.command.cooldowns[key];
          }
          if (moved > 0) {
            cue("antiphon", "verse", {
              x: ps.x, z: ps.z, radius: 4.5, intensity: 0.55,
              talentId: "antiphon_answering_step",
              rank: rank("antiphon_answering_step"), value: moved,
            });
          }
        }
        if (has("quicksilver_second_wind")) {
          ctx.jetpack?.restoreCharge?.(
            tuned("quicksilver_second_wind", "charge") || 0, "quicksilver");
          cue("quicksilver", "arm", {
            talentId: "quicksilver_second_wind", stage: "arm",
            radius: 2.4, intensity: 0.5, rank: rank("quicksilver_second_wind"),
          });
        }
        if (has("quicksilver_afterimage")) {
          const r = tuned("quicksilver_afterimage", "pullRadius") || 7;
          const stun = tuned("quicksilver_afterimage", "stun") || 0.9;
          let pulled = 0;
          for (const inst of ctx.enemies?.live || []) {
            if (!inst || inst.state === "death" || inst.health <= 0) continue;
            if (Math.hypot(inst.x - fromX, inst.z - fromZ) > r) continue;
            inst.alerted = true;
            inst.suspicion = 1;
            ctx.enemies?.stun?.(inst, stun);
            pulled += 1;
          }
          cue("quicksilver", "afterimage", {
            x: fromX, z: fromZ, radius: r, count: pulled,
            talentId: "quicksilver_afterimage", rank: rank("quicksilver_afterimage"),
            intensity: 0.8,
          });
        }
        if (has("quicksilver_cut_the_thread")) {
          fx.cutThreadUntil = clock + (tuned("quicksilver_cut_the_thread", "window") || 3);
          cue("quicksilver", "arm", {
            talentId: "quicksilver_cut_the_thread", stage: "arm",
            radius: 1.8, intensity: 0.45,
          });
        }
        if (capstoneActive("quicksilver_unbroken_vigil")
          && clock - fx.unbrokenAt >= (TUNING.quicksilver_unbroken_vigil.cooldown || 9)
          && detail.throughEnemy) {
          fx.unbrokenAt = clock;
          const V = TUNING.quicksilver_unbroken_vigil;
          cue("quicksilver", "capstone", {
            x: fromX, z: fromZ, radius: V.radius, capstone: true,
            talentId: "quicksilver_unbroken_vigil", stage: "form", intensity: 1,
          });
          window.setTimeout(() => {
            const gy = ctx.collide?.groundHeight?.(fromX, fromZ) ?? ps.y;
            shock(fromX, gy, fromZ, {
              radius: V.radius, innerRadius: V.radius * 0.35, damage: V.damage,
              edgeFalloff: 0.4, stun: V.stun, knockSpeed: 12, source: "doctrine",
            });
            cue("quicksilver", "capstone", {
              x: fromX, z: fromZ, radius: V.radius, capstone: true,
              talentId: "quicksilver_unbroken_vigil", stage: "resolve", intensity: 1.2,
            });
          }, 400);
        }
        return;
      }
      case "crescentHit": {
        if (has("crescent_paired_verdict") && detail.hand !== fx.lastHand) {
          fx.lastHand = detail.hand;
          fx.verdict += 1;
          const need = tuned("crescent_paired_verdict", "stacks") || 6;
          if (fx.verdict >= need) {
            fx.verdict = 0;
            cue("crescent", "verdict", {
              radius: 3.2, talentId: "crescent_paired_verdict",
              rank: rank("crescent_paired_verdict"), stage: "consume", intensity: 0.95,
            });
            if (capstoneActive("crescent_choir_of_edges")
              && clock - fx.choirAt >= (TUNING.crescent_choir_of_edges.cooldown || 8)) {
              fx.choirAt = clock;
              ctx.playerDischarge?.fan?.(TUNING.crescent_choir_of_edges.fan,
                TUNING.crescent_choir_of_edges.damage);
              cue("crescent", "capstone", {
                radius: 7, capstone: true, talentId: "crescent_choir_of_edges",
                stage: "resolve", intensity: 1.2,
              });
            }
          } else {
            cue("crescent", "arm", {
              radius: 1.4, count: fx.verdict, stage: "arm",
              talentId: "crescent_paired_verdict", intensity: 0.34,
            });
          }
        }
        return;
      }
      case "crescentKill": {
        if (has("crescent_sundered_arc")) {
          const splits = tuned("crescent_sundered_arc", "splits") || 2;
          const share = tuned("crescent_sundered_arc", "damage") || 0.55;
          ctx.playerDischarge?.shards?.(detail.x, detail.y, detail.z, splits,
            (Number(detail.damage) || 26) * share);
          cue("crescent", "sunder", {
            x: detail.x, y: detail.y, z: detail.z, radius: 3.4, count: splits,
            talentId: "crescent_sundered_arc", rank: rank("crescent_sundered_arc"),
            intensity: 0.85,
          });
        }
        return;
      }
      case "stoopEnd": {
        fx.lastStoopMetres = Number(detail.metres) || 0;
        if (has("stoop_shearwater")) {
          const slow = tuned("stoop_shearwater", "slow") || 0.45;
          const secs = tuned("stoop_shearwater", "seconds") || 2.2;
          let caught = 0;
          for (const inst of ctx.enemies?.live || []) {
            if (!inst || inst.state === "death" || inst.health <= 0) continue;
            if (Math.hypot(inst.x - ps.x, inst.z - ps.z) > 6.5) continue;
            inst.slowUntil = clock + secs;
            inst.slowFactor = slow;
            caught += 1;
          }
          cue("stoop", "wake", {
            radius: 6.5, count: caught, yaw: ps.yaw,
            talentId: "stoop_shearwater", rank: rank("stoop_shearwater"), intensity: 0.7,
          });
        }
        if (detail.landed && capstoneActive("stoop_the_long_dive")) {
          const V = TUNING.stoop_the_long_dive;
          const scale = 1 + clamp01(fx.lastStoopMetres / 22) * 0.35;
          const gy = ctx.collide?.groundHeight?.(ps.x, ps.z) ?? ps.y;
          shock(ps.x, gy, ps.z, {
            radius: V.radius * scale, innerRadius: V.radius * 0.4, damage: V.damage,
            edgeFalloff: 0.42, stun: V.stun, knockSpeed: 14, source: "doctrine",
          });
          cue("stoop", "capstone", {
            radius: V.radius * scale, capstone: true, stage: "resolve",
            talentId: "stoop_the_long_dive", intensity: 1.25,
          });
        }
        return;
      }
      case "stoopLaunchFromGround": {
        cue("stoop", "arm", {
          radius: 3.0, stage: "arm", talentId: "stoop_high_pass",
          rank: rank("stoop_high_pass"), intensity: 0.8,
          value: Number(detail.launch) || 0,
        });
        return;
      }
      case "stoopKill": {
        if (has("stoop_kingfisher")) {
          const share = tuned("stoop_kingfisher", "refund") || 0.55;
          detail.refund?.(share);
          cue("stoop", "arm", {
            radius: 2.2, talentId: "stoop_kingfisher",
            rank: rank("stoop_kingfisher"), stage: "arm", intensity: 0.55,
          });
        }
        return;
      }
      /* -------------------- Bastion -------------------- */
      case "guardBlock": {
        if (has("bulwark_anvil_stance")) {
          const max = tuned("bulwark_anvil_stance", "stacks") || 5;
          if (fx.guardStacks < max) {
            fx.guardStacks += 1;
            cue("bulwark", "arm", {
              radius: 1.6, count: fx.guardStacks, stage: "arm",
              talentId: "bulwark_anvil_stance", intensity: 0.4,
            });
          }
        }
        if (has("bulwark_returned_weight")) {
          const share = tuned("bulwark_returned_weight", "share") || 0.5;
          const cap = tuned("bulwark_returned_weight", "cap") || 220;
          fx.bankedWeight = Math.min(cap, fx.bankedWeight
            + (Number(detail.amount) || 0) * share);
          cue("bulwark", "store", {
            radius: 1.8, value: fx.bankedWeight, stage: "store",
            talentId: "bulwark_returned_weight", intensity: 0.45,
          });
        }
        if (detail.perfect && has("bulwark_bell_and_board")) {
          const r = tuned("bulwark_bell_and_board", "radius") || 5.5;
          const stun = tuned("bulwark_bell_and_board", "stun") || 1.3;
          shock(ps.x, ps.y, ps.z, {
            radius: r, innerRadius: r * 0.4, damage: 0, edgeFalloff: 0.4,
            stun, knockSpeed: 6, source: "doctrine",
          });
          cue("bulwark", "bell", {
            radius: r, talentId: "bulwark_bell_and_board",
            rank: rank("bulwark_bell_and_board"), stage: "consume", intensity: 0.95,
          });
        }
        if (detail.perfect && capstoneActive("bulwark_the_shut_gate")) {
          const V = TUNING.bulwark_the_shut_gate;
          shock(ps.x, ps.y, ps.z, {
            radius: V.radius, innerRadius: V.radius * 0.35, damage: V.damage,
            edgeFalloff: 0.4, stun: V.stun, knockSpeed: 16, source: "doctrine",
          });
          cue("bulwark", "capstone", {
            radius: V.radius, capstone: true, stage: "resolve",
            talentId: "bulwark_the_shut_gate", intensity: 1.25,
          });
        }
        return;
      }
      case "guardDrop": {
        fx.guardStacks = 0;
        return;
      }
      case "hammerHit": {
        if (fx.bankedWeight > 0) {
          cue("bulwark", "release", {
            radius: 3.4, value: fx.bankedWeight, stage: "release",
            talentId: "bulwark_returned_weight", intensity: 0.9,
          });
          fx.bankedWeight = 0;
        }
        if (has("anvil_dead_weight") && detail.inst) {
          const bossState = deadWeightBossState(detail.inst, true);
          if (!bossState) {
            ctx.enemies?.stun?.(detail.inst,
              tuned("anvil_dead_weight", "stun") || 0.55);
            cue("anvil", "pulse", {
              x: detail.x, y: detail.y, z: detail.z, radius: 2.2, stage: "pulse",
              talentId: "anvil_dead_weight", intensity: 0.42,
            });
          } else {
            const clock = now();
            if (clock >= bossState.lockUntil) {
              const stun = tuned("anvil_dead_weight", "bossStun") || 0.25;
              ctx.enemies?.stun?.(detail.inst, stun);
              bossState.lockUntil = clock
                + (tuned("anvil_dead_weight", "bossLockout") || 2.5);
              bossState.offBalanceUntil = clock
                + (tuned("anvil_dead_weight", "offBalance") || 1.5);
              bossState.staggers += 1;
              cue("anvil", "pulse", {
                x: detail.x, y: detail.y, z: detail.z, radius: 2.2,
                stage: "pulse", talentId: "anvil_dead_weight", intensity: 0.54,
              });
            } else {
              bossState.resisted += 1;
              cue("anvil", "brace", {
                x: detail.x, y: detail.y, z: detail.z, radius: 2.2,
                stage: "resist", talentId: "anvil_dead_weight", intensity: 0.34,
              });
            }
          }
        }
        if (has("anvil_ring_true") && detail.killed && ctx.combat?.player) {
          const heal = tuned("anvil_ring_true", "health") || 14;
          const p = ctx.combat.player;
          p.hp = Math.min(p.maxHp, p.hp + heal);
          cue("anvil", "mercy", {
            radius: 2.6, value: heal, talentId: "anvil_ring_true",
            rank: rank("anvil_ring_true"), intensity: 0.7,
          });
        }
        return;
      }
      case "hammerFinisher": {
        if (capstoneActive("anvil_the_last_nail")) {
          const V = TUNING.anvil_the_last_nail;
          shock(ps.x, ps.y, ps.z, {
            radius: V.radius, innerRadius: V.radius * 0.35, damage: V.damage,
            edgeFalloff: 0.42, stun: V.stun, knockSpeed: 13, source: "doctrine",
          });
          cue("anvil", "capstone", {
            radius: V.radius, capstone: true, stage: "resolve",
            talentId: "anvil_the_last_nail", intensity: 1.2,
          });
        }
        return;
      }
      case "castHit": {
        if (has("cast_iron_bell") && detail.inst) {
          ctx.enemies?.stun?.(detail.inst, tuned("cast_iron_bell", "stun") || 1.4);
          cue("cast", "bell", {
            x: detail.x, y: detail.y, z: detail.z, radius: 2.8,
            talentId: "cast_iron_bell", rank: rank("cast_iron_bell"), intensity: 0.75,
          });
        }
        if (has("cast_hooked_chain") && detail.grounded && detail.inst) {
          const drag = tuned("cast_hooked_chain", "drag") || 6;
          const dx = ps.x - detail.inst.x;
          const dz = ps.z - detail.inst.z;
          const len = Math.hypot(dx, dz) || 1;
          ctx.enemies?.knockback?.(detail.inst, dx / len, dz / len, drag);
          cue("cast", "chain", {
            x: detail.x, y: detail.y, z: detail.z, radius: 3.4, yaw: ps.yaw,
            talentId: "cast_hooked_chain", rank: rank("cast_hooked_chain"), intensity: 0.9,
          });
        }
        return;
      }
      case "castThrow": {
        if (capstoneActive("cast_the_thrown_choir")) {
          cue("cast", "capstone", {
            radius: 5, capstone: true, yaw: ps.yaw, stage: "resolve",
            talentId: "cast_the_thrown_choir", intensity: 1.1,
          });
        }
        return;
      }
      case "leap": {
        if (has("forge_stoked")) {
          const r = tuned("forge_stoked", "radius") || 5;
          shock(ps.x, ps.y, ps.z, {
            radius: r, innerRadius: r * 0.35,
            damage: tuned("forge_stoked", "damage") || 55,
            edgeFalloff: 0.45, stun: 0.4, knockSpeed: 6, source: "doctrine",
          });
          cue("forge", "stoke", {
            radius: r, talentId: "forge_stoked",
            rank: rank("forge_stoked"), intensity: 0.85,
          });
        }
        if (capstoneActive("forge_the_open_firebox")) {
          cue("forge", "capstone", {
            radius: 4, capstone: true, stage: "form",
            talentId: "forge_the_open_firebox", intensity: 0.9,
          });
        }
        return;
      }
      /* -------------------- The call Orders -------------------- */
      case "callCast": {
        if (has("tocsin_braced_call")) {
          fx.braceUntil = clock + (tuned("tocsin_braced_call", "seconds") || 4);
          cue("tocsin", "brace", {
            x: ps.x, z: ps.z, radius: 4.2, intensity: 0.7,
            talentId: "tocsin_braced_call", stage: "arm",
            rank: rank("tocsin_braced_call"),
          });
        }
        return;
      }
      case "callImpact": {
        const cx = Number(detail.x);
        const cz = Number(detail.z);
        if (!Number.isFinite(cx) || !Number.isFinite(cz)) return;
        if (has("antiphon_lingering_verse")) {
          const seconds = tuned("antiphon_lingering_verse", "seconds") || 5;
          const slow = tuned("antiphon_lingering_verse", "slow") || 0.55;
          const fieldRadius = Math.max(5, (Number(detail.radius) || 8) * 0.9);
          /* The command module owns the field so the slow, the mark
             and the cue all expire together and a save that drops the
             doctrine cannot leave one of the three behind. */
          ctx.command?.addField?.(cx, cz, {
            radius: fieldRadius, slow, seconds, order: "antiphon",
          });
          cue("antiphon", "answer", {
            x: cx, z: cz, radius: fieldRadius, intensity: 0.85,
            talentId: "antiphon_lingering_verse",
            rank: rank("antiphon_lingering_verse"), value: seconds,
          });
        }
        if (has("tocsin_heavy_ordnance")) {
          cue("tocsin", "toll", {
            x: cx, z: cz, radius: Math.max(4, Number(detail.radius) || 8),
            intensity: 0.9, talentId: "tocsin_heavy_ordnance",
            stage: "resolve", rank: rank("tocsin_heavy_ordnance"),
            count: Number(detail.hits) || 0,
          });
        }
        return;
      }
      case "leapLand": {
        if (has("forge_hard_landing")) {
          const r = tuned("forge_hard_landing", "radius") || 4.5;
          shock(ps.x, ps.y, ps.z, {
            radius: r, innerRadius: r * 0.35,
            damage: tuned("forge_hard_landing", "damage") || 70,
            edgeFalloff: 0.42, stun: 0.7, knockSpeed: 9, source: "doctrine",
          });
          cue("forge", "landing", {
            radius: r, talentId: "forge_hard_landing",
            rank: rank("forge_hard_landing"), intensity: 0.9,
          });
        }
        if (has("forge_furnace_gait")) {
          fx.gaitUntil = clock + (tuned("forge_furnace_gait", "seconds") || 3.5);
          cue("forge", "arm", {
            radius: 2.4, stage: "arm", talentId: "forge_furnace_gait", intensity: 0.5,
          });
        }
        if (capstoneActive("forge_the_open_firebox")) {
          const V = TUNING.forge_the_open_firebox;
          shock(ps.x, ps.y, ps.z, {
            radius: V.radius, innerRadius: V.radius * 0.35, damage: V.damage,
            edgeFalloff: 0.4, stun: V.stun, knockSpeed: 15, source: "doctrine",
          });
          cue("forge", "capstone", {
            radius: V.radius, capstone: true, stage: "resolve",
            talentId: "forge_the_open_firebox", intensity: 1.3,
          });
        }
        return;
      }
      default:
        return;
    }
  }

  /* ---------------------- shared notifiers ---------------------- */
  const rewardedBosses = new Set();

  function awardBossDefeat(keyOrSite) {
    const enemyKey = DISTRICT_SITE_BOSS_KEYS[keyOrSite] || keyOrSite;
    if (!BOSS_ENEMY_KEYS.has(enemyKey)) return false;
    if (rewardedBosses.has(enemyKey)) return false;
    rewardedBosses.add(enemyKey);
    const award = KENOSIS_XP_AWARDS[enemyKey];
    if (award) {
      grantXp(award, null, "boss-defeat");
      return true;
    }
    return false;
  }

  function onEnemyKilled(event = {}) {
    const key = event.enemyKey || event.key || "";
    const isBoss = BOSS_ENEMY_KEYS.has(key);
    if (isBoss) {
      if (rewardedBosses.has(key)) return event;
      rewardedBosses.add(key);
    }
    const award = KENOSIS_XP_AWARDS[key] || 50;
    grantXp(award, null, isBoss ? "boss-kill" : "kill");
    const clock = now();
    if (has("vigil_pale_ledger")) {
      fx.ledgerUntil = clock + (tuned("vigil_pale_ledger", "seconds") || 3);
      cue("vigil", "arm", {
        radius: 2.2, stage: "arm", talentId: "vigil_pale_ledger", intensity: 0.5,
      });
    }
    return event;
  }

  function onPlayerHurt(event = {}) {
    const clock = now();
    if (has("vigil_thin_ice")) {
      fx.thinIceUntil = clock + (tuned("vigil_thin_ice", "seconds") || 0.9);
      cue("vigil", "pulse", {
        radius: 2.6, stage: "pulse", talentId: "vigil_thin_ice", intensity: 0.55,
      });
    }
    if (has("forge_bellows") && ctx.jetpack?.state) {
      const cut = tuned("forge_bellows", "perHit") || 0.2;
      ctx.jetpack.state.leapCooldownRemaining =
        Math.max(0, (ctx.jetpack.state.leapCooldownRemaining || 0) - cut);
      cue("forge", "pulse", {
        radius: 1.8, stage: "pulse", talentId: "forge_bellows", intensity: 0.4,
      });
    }
    return event;
  }

  /** The last-chance save. Returns true when the blow was refused. */
  function interceptLethal(amount) {
    if (!has("vigil_last_lantern")) return false;
    const clock = now();
    const cd = tuned("vigil_last_lantern", "cooldown") || 95;
    if (clock - fx.lanternAt < cd) return false;
    const p = ctx.combat?.player;
    if (!p || p.hp - amount > 0) return false;
    fx.lanternAt = clock;
    p.hp = tuned("vigil_last_lantern", "health") || 45;
    cue("vigil", "lantern", {
      radius: 5.5, talentId: "vigil_last_lantern",
      rank: rank("vigil_last_lantern"), stage: "resolve", intensity: 1.1,
    });
    return true;
  }

  function update(dt) {
    const clock = now();
    const ps = player?.state || {};
    /* Watchfire: the reliquary fills faster the closer to the end. */
    if (has("vigil_watchfire") && ctx.combat?.player && ctx.jetpack?.state) {
      const frac = ctx.combat.player.hp / Math.max(1, ctx.combat.player.maxHp);
      if (frac <= (tuned("vigil_watchfire", "threshold") || 0.45)) {
        ctx.jetpack.restoreCharge?.((tuned("vigil_watchfire", "regen") || 7) * dt,
          "watchfire");
        fx.watchTick = (fx.watchTick || 0) + dt;
        if (fx.watchTick > 1.1) {
          fx.watchTick = 0;
          cue("vigil", "pulse", {
            radius: 2.8, stage: "pulse", talentId: "vigil_watchfire", intensity: 0.5,
          });
        }
      }
    }
    /* Reaping Volley ramps only while the trigger is actually held. */
    const firing = !!player?.input?.state?.firing;
    fx.volleyHeld = firing ? fx.volleyHeld + dt : 0;
    if (!firing) fx.lastHand = null;
    /* The White Vigil veil: stand still, disappear. */
    if (capstoneActive("vigil_white_vigil")) {
      const still = (ps.speed || 0) < 0.4 && ps.grounded;
      fx.stillFor = still ? fx.stillFor + dt : 0;
      const arm = TUNING.vigil_white_vigil.arm || 1.6;
      if (fx.stillFor >= arm && clock >= fx.veilUntil) {
        fx.veilUntil = clock + (TUNING.vigil_white_vigil.seconds || 6);
        for (const inst of ctx.enemies?.live || []) {
          if (inst) { inst.suspicion = 0; inst.alerted = false; }
        }
        cue("vigil", "capstone", {
          radius: 4.5, capstone: true, stage: "form",
          talentId: "vigil_white_vigil", intensity: 1,
        });
      }
    }
  }

  /* MELEE ARRIVES ON THE BUS, not through a hook combat.js would
     have to learn. `combat.meleeStrike` already publishes everything
     the Anvil needs - which targets, which combo step, how many
     died - so the doctrine listens rather than asking the strike
     path to carry it. */
  function onMelee(event = {}) {
    if (!event || !event.hits) return;
    const clock = now();
    const targets = Array.isArray(event.targets) ? event.targets : [];
    const live = ctx.enemies?.live || [];
    const instFor = (t) => (t && t.inst) || live.find((e) => e
      && (e.id === t?.id || e.id === t?.enemyId));
    for (const target of targets) {
      const inst = instFor(target);
      if (!inst) continue;
      /* Shatterpoint needs the target's state at the moment of the
         blow, which only exists here - a damage getter cannot see it. */
      if (has("anvil_shatterpoint")
        && ((inst.stunTime || 0) > 0 || deadWeightOffBalance(inst))
        && inst.health > 0) {
        const bonus = (tuned("anvil_shatterpoint", "damage") || 1) - 1;
        if (bonus > 0) {
          ctx.combat?.damageEnemy?.(inst,
            (loadoutMeleeBase() || 100) * bonus, {
              source: "doctrine", x: inst.x, y: inst.y, z: inst.z,
            });
          cue("anvil", "pulse", {
            x: inst.x, y: inst.y, z: inst.z, radius: 2.4, stage: "pulse",
            talentId: "anvil_shatterpoint", intensity: 0.6,
          });
        }
      }
      verb("hammerHit", {
        inst, x: inst.x, y: inst.y, z: inst.z,
        killed: inst.health <= 0,
      });
    }
    if (event.comboStep === 3 || event.slam) verb("hammerFinisher", {});
    /* The arrival strike is spent once it lands. */
    if (clock < fx.cutThreadUntil) {
      fx.cutThreadUntil = -99;
      cue("quicksilver", "release", {
        radius: 3.0, stage: "release", talentId: "quicksilver_cut_the_thread",
        rank: rank("quicksilver_cut_the_thread"), intensity: 0.9,
      });
    }
  }
  const loadoutMeleeBase = () => {
    const spec = ctx.loadout?.meleeSpec;
    return spec ? Number(spec.damage) || 0 : 0;
  };

  const stops = [];
  stops.push(ctx.combat?.bus?.on?.("kill", (e) => onEnemyKilled(e)) || null);
  stops.push(ctx.combat?.bus?.on?.("playerHurt", (e) => onPlayerHurt(e)) || null);
  stops.push(ctx.combat?.bus?.on?.("melee", (e) => onMelee(e)) || null);
  stops.push(ctx.mission?.bus?.on?.("districtBossDone", (e) => awardBossDefeat(e?.key)) || null);
  stops.push(ctx.mission?.bus?.on?.("finalBossDone", (e) => awardBossDefeat(e?.key || "apostate")) || null);
  stops.push(ctx.districtBosses?.bus?.on?.("defeated", (e) => awardBossDefeat(e?.enemyKey || e?.key)) || null);

  return {
    bus,
    treeId: tree.id,
    state,
    definitions,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    rank,
    has,
    capstoneActive,
    canEdit: () => { const e = editStatus(); return { ok: e.ok, canEdit: e.ok, message: e.message, reason: e.message }; },
    spend,
    refund,
    respec,
    equipCapstone,
    unequipCapstone,
    grantXp,
    update,
    /* The two kit seams. */
    kit,
    verb,
    interceptLethal,
    /* ============================================================
       THE CAMPAIGN CONTRACT

       m112 carries these trees into `games/saintfall.html`, where
       `save.js` and `main.js` talk to whatever sits on
       `ctx.progression`. Every one of those calls is `?.`-guarded, so
       a missing method is a silent no-op rather than a crash - which
       is exactly why the gaps have to be filled deliberately instead
       of discovered later as progression that quietly fails to save.

       THIS RUNTIME DECLINES THE CAREER ENVELOPE, ON PURPOSE. The
       campaign keeps ONE career record per account ("Career
       progression belongs to the account envelope, not any single
       slot" - save.js), and three operatives with three different
       trees would fight over it: a Vigil's `captureCareer` would
       overwrite Vesper's 25-talent career, and Vesper's would then be
       handed back to the Vigil as a record full of node ids its tree
       has never heard of.

       So `captureCareer` returns null and the envelope is left
       untouched. Nothing is lost by it: this runtime has owned its
       own per-tree localStorage store since m108 and still does, so a
       Kenosis doctrine persists across sessions on the campaign
       exactly as it does on the summit - it simply persists beside
       Vesper's career instead of on top of it.

       `validateCareer` is deliberately NOT provided either.
       `save.js`'s `normalizeCareer` falls back to cloning the value
       when the runtime has no validator, so an existing Vesper career
       passes through this operative untouched; supplying a validator
       here would reject it as INVALID_CAREER and raise a conflict
       over a record we do not own.
       ============================================================ */
    captureCareer: () => null,
    restoreCareer: (value, options = {}) => ({
      ok: true, ignored: true, source: options.source || "runtime",
      reason: "kenosis-doctrine-owns-its-own-store",
    }),
    /* Cleared directly rather than through `respec()`: a new game must
       always succeed, and `respec()` refuses while editing is locked
       (mid-fight, or with a Vow sealed). `state()` derives everything
       from `record`, so there is nothing else to recompute. */
    resetCareer(options = {}) {
      record.totalXp = 0;
      record.allocations = {};
      record.activeCapstones = [null, null];
      deadWeightBossStates = new WeakMap();
      rewardedBosses.clear();
      persist();
      notify();
      return { ok: true, source: options.source || "runtime" };
    },
    awardBossDefeat,
    onEnemyKilled,
    deadWeightStatus,
    /* No career/field split - see the m108 milestone. A null field
       layer is explicitly valid to `save.js` (`validFieldProgression`
       returns true for null), so the campaign simply records that
       this operative brought no field loadout. */
    captureField: () => null,
    restoreField: () => true,
    validateField: () => true,
    validateFieldState: () => true,
    restoreFieldForQA: () => true,
    clearFieldLoadout: () => true,
    /* This runtime persists itself; the campaign's persistence
       service has nothing to attach to. */
    attachPersistence: () => false,
    doctrineSnapshot: () => ({
      tree: tree.id,
      totalXp: record.totalXp,
      allocations: { ...record.allocations },
      activeCapstones: [...record.activeCapstones],
    }),
    status: () => state(),
    fieldRank: () => state().rank,
    /* Diagnostics for the audit harness. */
    procCounts: () => ({ ...procCounts }),
    dispose() {
      for (const stop of stops) stop?.();
      listeners.clear();
      window.clearTimeout(persistTimer);
    },
  };
}
