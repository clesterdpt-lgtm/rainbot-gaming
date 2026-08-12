/* ============================================================
   SAINTFALL - Field Rank and Doctrine configuration

   Pure progression data. Runtime systems may consume these stable
   IDs, but this module intentionally owns no save, UI, or gameplay
   state and imports no dependencies.
   ============================================================ */

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const PROGRESSION_SCHEMA_VERSION = 1;
export const FIELD_RANK_CAP = 25;
export const DOCTRINE_POINTS_PER_RANK = 1;
export const DOCTRINE_POINT_START_RANK = 2;
export const TALENT_MAX_RANK = 2;
export const MAX_POINTS_PER_ORDER = 8;
export const CAPSTONE_ELIGIBILITY_POINTS = 8;
export const MAX_ACTIVE_CAPSTONES = 2;
export const VOW_SEAL_RANKS = deepFreeze([12, 22]);

/** Cumulative career XP required to enter each rank; index 0 is Rank 1. */
export const FIELD_RANK_XP_THRESHOLDS = deepFreeze([
  0,
  125,
  287,
  490,
  738,
  1035,
  1385,
  1792,
  2260,
  2793,
  3395,
  4070,
  4822,
  5655,
  6573,
  7580,
  8680,
  9877,
  11175,
  12578,
  14090,
  15715,
  17457,
  19320,
  21308,
]);

/** Stable award rules. `repeat` documents the intended anti-farming scope. */
export const XP_AWARDS = deepFreeze({
  kill_thresher: {
    id: "kill_thresher",
    label: "Thresher purged",
    event: "enemy_killed",
    match: { enemyKey: "thresher" },
    amount: 8,
    repeat: "event",
  },
  kill_gleaner: {
    id: "kill_gleaner",
    label: "Gleaner purged",
    event: "enemy_killed",
    match: { enemyKey: "gleaner" },
    amount: 16,
    repeat: "event",
  },
  kill_harrow: {
    id: "kill_harrow",
    label: "Harrow purged",
    event: "enemy_killed",
    match: { enemyKey: "harrow" },
    amount: 32,
    repeat: "event",
  },
  kill_matriarch: {
    id: "kill_matriarch",
    label: "Matriarch purged",
    event: "enemy_killed",
    match: { enemyKey: "matriarch" },
    amount: 240,
    repeat: "event",
  },
  kill_coulter: {
    id: "kill_coulter",
    label: "Coulter broken",
    event: "enemy_killed",
    match: { enemyKey: "coulter" },
    amount: 360,
    repeat: "event",
  },
  relay_silenced: {
    id: "relay_silenced",
    label: "Vox-relay silenced",
    event: "relay_silenced",
    amount: 175,
    repeat: "relay",
  },
  breach_wave_cleared: {
    id: "breach_wave_cleared",
    label: "Bloom wave cleared",
    event: "breach_wave_cleared",
    amount: 90,
    repeat: "wave",
  },
  breach_cycle_cleared: {
    id: "breach_cycle_cleared",
    label: "Bloom cycle broken",
    event: "breach_cycle_cleared",
    amount: 300,
    repeat: "cycle",
  },
  operation_won: {
    id: "operation_won",
    label: "Operation completed",
    event: "operation_won",
    amount: 650,
    repeat: "operation",
  },
});

export const ORDER_IDS = deepFreeze([
  "censer",
  "procession",
  "wing",
  "halo",
  "edict",
]);

export const DOCTRINE_ORDERS = deepFreeze([
  {
    id: "censer",
    name: "Order of the Censer",
    shortName: "Censer",
    focus: "Precision, heat, and deliberate venting",
    accent: "gold",
    icon: "censer",
    talents: [
      {
        id: "censer_rite_of_censure",
        orderId: "censer",
        kind: "talent",
        name: "Rite of Censure",
        summary: "Turn precision into a close-range opening.",
        tier: 1,
        requires: { orderPoints: 0 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "An aimed headshot or Matriarch weak-point hit brands that enemy for 5 seconds. The next melee hit consumes the brand and removes 12% weapon heat.",
          },
          {
            rank: 2,
            description: "Consuming the brand also staggers light enemies within 4 metres of the target.",
          },
        ],
      },
      {
        id: "censer_ashen_rebuke",
        orderId: "censer",
        kind: "talent",
        name: "Ashen Rebuke",
        summary: "Make a well-timed vent part of the attack.",
        tier: 1,
        requires: { orderPoints: 0 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "Starting a manual vent at 60% heat or higher releases a short frontal force cone that staggers light enemies.",
          },
          {
            rank: 2,
            description: "Starting the vent between 85% and 99% heat also damages enemies and widens the cone by 30%.",
          },
        ],
      },
      {
        id: "censer_gold_nail",
        orderId: "censer",
        kind: "talent",
        name: "The Gold Nail",
        summary: "Follow precision with one immaculate shot.",
        tier: 2,
        requires: { orderPoints: 2 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "A headshot or weak-point hit arms the next rifle shot for 4 seconds; that shot produces no heat.",
          },
          {
            rank: 2,
            description: "The armed shot also has perfect accuracy and pierces one enemy.",
          },
        ],
      },
      {
        id: "censer_furnace_reprieve",
        orderId: "censer",
        kind: "talent",
        name: "Furnace Reprieve",
        summary: "Stay dangerous near the edge of overheat.",
        tier: 3,
        requires: { orderPoints: 4 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "Killing an enemy while weapon heat is at least 70% removes 8% heat, at most once every 2 seconds.",
          },
          {
            rank: 2,
            description: "A precision kill removes 16% heat instead; the 2-second limit still applies.",
          },
        ],
      },
    ],
    capstone: {
      id: "censer_martyrs_furnace",
      orderId: "censer",
      kind: "capstone",
      name: "Martyr's Furnace",
      summary: "Trade vitality for a brief, controllable redline.",
      requires: { orderPoints: 8, vowSeal: true },
      description: "Reaching maximum heat starts a 3-second Redline instead of immediately locking the weapon. Each Redline shot scorches 4 vitality; completing a manual vent restores vitality scorched by that Redline. Failing to vent ends in the normal overheat lock.",
    },
  },
  {
    id: "procession",
    name: "Order of the Procession",
    shortName: "Procession",
    focus: "Melee cadence, control, and committed finishers",
    accent: "amber",
    icon: "procession",
    talents: [
      {
        id: "procession_hooking_step",
        orderId: "procession",
        kind: "talent",
        name: "Hooking Step",
        summary: "Gather the brood into the finisher's path.",
        tier: 1,
        requires: { orderPoints: 0 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "The second melee-combo strike pulls light enemies up to 3 metres toward the centre of its sweep.",
          },
          {
            rank: 2,
            description: "The pull reaches 5 metres and interrupts Gleaner and Harrow attacks without moving those heavy enemies.",
          },
        ],
      },
      {
        id: "procession_third_toll",
        orderId: "procession",
        kind: "talent",
        name: "Third Toll",
        summary: "Turn a clean three-hit procession into a rupture.",
        tier: 1,
        requires: { orderPoints: 0 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "Landing all three melee-combo strikes without missing sends a 6-metre ground rupture from the finisher.",
          },
          {
            rank: 2,
            description: "If the rupture hits at least 3 enemies, it repeats once at half damage.",
          },
        ],
      },
      {
        id: "procession_executioners_measure",
        orderId: "procession",
        kind: "talent",
        name: "Executioner's Measure",
        summary: "Reward holding the full procession on one threat.",
        tier: 2,
        requires: { orderPoints: 2 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "Landing all three combo strikes on the same Harrow or Matriarch exposes it for 4 seconds; the next rifle hit counts as a weak-point hit.",
          },
          {
            rank: 2,
            description: "The third strike also interrupts the target's current attack and extends the exposure to 6 seconds.",
          },
        ],
      },
      {
        id: "procession_processional_mercy",
        orderId: "procession",
        kind: "talent",
        name: "Processional Mercy",
        summary: "Let a decisive kill sustain the next sequence.",
        tier: 3,
        requires: { orderPoints: 4 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "A melee-combo kill extends the current combo buffer by 1 second and restores 6 Reliquary charge, once per combo.",
          },
          {
            rank: 2,
            description: "A third-strike kill restores 12 charge instead and immediately readies the first strike.",
          },
        ],
      },
    ],
    capstone: {
      id: "procession_endless_litany",
      orderId: "procession",
      kind: "capstone",
      name: "Endless Litany",
      summary: "Keep the three-step rite cycling for as long as it remains unbroken.",
      requires: { orderPoints: 8, vowSeal: true },
      description: "After the third combo hit, the next melee input cycles directly to an empowered first strike. Every third connected hit releases a 5-metre Bellstrike; missing, taking damage, or letting the combo buffer expire ends the Litany.",
    },
  },
  {
    id: "wing",
    name: "Order of the Wing",
    shortName: "Wing",
    focus: "Momentum, aerial commitment, and Reliquary movement",
    accent: "cyan",
    icon: "wing",
    talents: [
      {
        id: "wing_wingbeat_conversion",
        orderId: "wing",
        kind: "talent",
        name: "Wingbeat Conversion",
        summary: "Carry a ground charge cleanly into flight.",
        tier: 1,
        requires: { orderPoints: 0 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "Activating the jet within 0.45 seconds of releasing a ground boost preserves horizontal momentum and waives the jet's ignition cost.",
          },
          {
            rank: 2,
            description: "The transition window becomes 0.7 seconds and the first airborne rifle shot has perfect accuracy.",
          },
        ],
      },
      {
        id: "wing_falling_gospel",
        orderId: "wing",
        kind: "talent",
        name: "Falling Gospel",
        summary: "Feed aerial kills into Penitent's Fall.",
        tier: 1,
        requires: { orderPoints: 0 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "An airborne rifle kill grants 1 Feather, up to 3. Penitent's Fall consumes them to add 1.5 metres of impact radius per Feather.",
          },
          {
            rank: 2,
            description: "Consuming all 3 Feathers also restores 15 Reliquary charge after impact.",
          },
        ],
      },
      {
        id: "wing_gravitic_wake",
        orderId: "wing",
        kind: "talent",
        name: "Gravitic Wake",
        summary: "Shape the swarm while evading it.",
        tier: 2,
        requires: { orderPoints: 2 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "A sideways or backward boost leaves a 2.5-second wake that slows light enemies within 2.5 metres.",
          },
          {
            rank: 2,
            description: "The wake grows to 4 metres and gently pulls affected enemies toward its centre.",
          },
        ],
      },
      {
        id: "wing_rams_halo",
        orderId: "wing",
        kind: "talent",
        name: "Ram's Halo",
        summary: "Turn a collision with a heavy target into altitude.",
        tier: 3,
        requires: { orderPoints: 4 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "A forward boost into a Harrow or Matriarch vaults over it instead of stopping and reduces the next Penitent's Fall cost by 5 for 3 seconds.",
          },
          {
            rank: 2,
            description: "The vault emits a 4-metre stagger pulse and reduces the primed Fall's cost by 10 instead.",
          },
        ],
      },
    ],
    capstone: {
      id: "wing_unbroken_circuit",
      orderId: "wing",
      kind: "capstone",
      name: "Unbroken Circuit",
      summary: "Complete a circuit of distinct Reliquary actions.",
      requires: { orderPoints: 8, vowSeal: true },
      description: "Use any 3 distinct Reliquary verbs - boost, jet, Penitent's Fall, or a successful Aegis block - within 8 seconds to restore 25 charge and release a 6-metre halo shockwave. Each verb counts once; the Circuit then has a 12-second cooldown.",
    },
  },
  {
    id: "halo",
    name: "Order of the Halo",
    shortName: "Halo",
    focus: "Timed defence, counters, and objective protection",
    accent: "blue",
    icon: "halo",
    talents: [
      {
        id: "halo_votive_parry",
        orderId: "halo",
        kind: "talent",
        name: "Votive Parry",
        summary: "Give a precisely raised Aegis an offensive answer.",
        tier: 1,
        requires: { orderPoints: 0 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "Blocking a hit within 0.25 seconds of raising Aegis creates a perfect guard and emits a 3-metre stagger pulse.",
          },
          {
            rank: 2,
            description: "A perfect guard refunds that block's charge cost and fires an immediate retaliatory bolt at a ranged attacker.",
          },
        ],
      },
      {
        id: "halo_stored_wrath",
        orderId: "halo",
        kind: "talent",
        name: "Stored Wrath",
        summary: "Return absorbed force when the shield falls.",
        tier: 1,
        requires: { orderPoints: 0 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "Aegis stores 25% of blocked damage, up to 60. Releasing it after a block deals the stored force in a 4-metre frontal shield bash.",
          },
          {
            rank: 2,
            description: "Aegis stores 40% of blocked damage, up to 100, and the bash reaches 6 metres.",
          },
        ],
      },
      {
        id: "halo_pilgrims_reversal",
        orderId: "halo",
        kind: "talent",
        name: "Pilgrim's Reversal",
        summary: "Turn a block into immediate repositioning.",
        tier: 2,
        requires: { orderPoints: 2 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "A successful Aegis block arms one charge-free backward boost for 1.25 seconds.",
          },
          {
            rank: 2,
            description: "The free boost may travel in any direction and its first impact staggers the struck enemy.",
          },
        ],
      },
      {
        id: "halo_mercy_circuit",
        orderId: "halo",
        kind: "talent",
        name: "Mercy Circuit",
        summary: "Keep an objective moving behind the Aegis.",
        tier: 3,
        requires: { orderPoints: 4 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "Relay channel progress continues at 50% speed while Aegis is raised, but shield drain is increased by 50%.",
          },
          {
            rank: 2,
            description: "Protected relay progress rises to 75% speed and no longer increases shield drain.",
          },
        ],
      },
    ],
    capstone: {
      id: "halo_seraph_aegis",
      orderId: "halo",
      kind: "capstone",
      name: "Seraph Aegis",
      summary: "Commit the Reliquary to a stationary defensive dome.",
      requires: { orderPoints: 8, vowSeal: true },
      description: "Hold Aegis while stationary for 1 second to form a 360-degree dome. Movement is disabled and charge drain is doubled; releasing the dome returns up to 150 absorbed damage as a radial blast.",
    },
  },
  {
    id: "edict",
    name: "Order of the Edict",
    shortName: "Edict",
    focus: "Command timing, placement, and battlefield authorship",
    accent: "green",
    icon: "edict",
    talents: [
      {
        id: "edict_siren_beacon",
        orderId: "edict",
        kind: "talent",
        name: "Siren Beacon",
        summary: "Make offensive command markers gather their own targets.",
        tier: 1,
        requires: { orderPoints: 0 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "Orbital Lance and Cluster Salvo markers draw light enemies within 12 metres toward their impact point.",
          },
          {
            rank: 2,
            description: "The draw reaches 20 metres and causes nearby Harrows and Matriarchs to turn toward the marker without moving them.",
          },
        ],
      },
      {
        id: "edict_live_fuse",
        orderId: "edict",
        kind: "talent",
        name: "Live Fuse",
        summary: "Spend gunfire to hurry an inbound strike.",
        tier: 1,
        requires: { orderPoints: 0 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "Shooting an inbound offensive-command beacon removes 0.35 seconds from its delay, up to 1.4 seconds per command.",
          },
          {
            rank: 2,
            description: "A precision hit removes 0.7 seconds and raises the per-command reduction limit to 2.8 seconds.",
          },
        ],
      },
      {
        id: "edict_recall_rite",
        orderId: "edict",
        kind: "talent",
        name: "Recall Rite",
        summary: "Correct one command before its final lock.",
        tier: 2,
        requires: { orderPoints: 2 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "Before the final 0.6 seconds, the active command may be issued once more to relocate its marker; relocation adds 2 seconds to the remaining delay.",
          },
          {
            rank: 2,
            description: "Relocation adds only 0.75 seconds and retains the marker's current Siren pull.",
          },
        ],
      },
      {
        id: "edict_field_chapel",
        orderId: "edict",
        kind: "talent",
        name: "Field Chapel",
        summary: "Turn a reinforcement pod into a contested sanctuary.",
        tier: 3,
        requires: { orderPoints: 4 },
        maxRank: 2,
        ranks: [
          {
            rank: 1,
            description: "The Gilding Rite leaves a 10-second sanctuary that removes 5% heat and restores 3 Reliquary charge per second while grounded inside; it draws enemies within 18 metres.",
          },
          {
            rank: 2,
            description: "The sanctuary lasts 14 seconds and its boundary destroys incoming Gleaner shots.",
          },
        ],
      },
    ],
    capstone: {
      id: "edict_combined_liturgy",
      orderId: "edict",
      kind: "capstone",
      name: "Combined Liturgy",
      summary: "Fuse two different commands into one authored battlefield event.",
      requires: { orderPoints: 8, vowSeal: true },
      description: "Each command impact leaves an 8-second sigil. Placing a different command inside it consumes the sigil and fuses the pair; Combined Liturgy then has a 30-second shared cooldown.",
      fusions: [
        {
          id: "sunshard",
          commandIds: ["orbital", "cluster"],
          name: "Sunshard",
          description: "A concentrated follow-up strikes the highest-health enemy inside the Orbital Lance footprint.",
        },
        {
          id: "halo_bastion",
          commandIds: ["orbital", "resupply"],
          name: "Halo Bastion",
          description: "The recovery zone gains a temporary projectile-blocking halo after the Orbital Lance lands.",
        },
        {
          id: "reliquary_minefield",
          commandIds: ["cluster", "resupply"],
          name: "Reliquary Minefield",
          description: "Unspent cluster shards arm around the recovery zone as proximity mines.",
        },
      ],
    },
  },
]);

export const CONCORDANCES = deepFreeze([
  {
    id: "censer_procession",
    orderIds: ["censer", "procession"],
    name: "Ash Knight",
    summary: "Carry rifle heat and precision openings into an unbroken melee rite.",
  },
  {
    id: "censer_wing",
    orderIds: ["censer", "wing"],
    name: "Solar Diver",
    summary: "Build furnace pressure in flight and discharge it through a violent descent.",
  },
  {
    id: "censer_halo",
    orderIds: ["censer", "halo"],
    name: "Iron Thurible",
    summary: "Use perfect defence to hold the weapon at its most dangerous heat.",
  },
  {
    id: "censer_edict",
    orderIds: ["censer", "edict"],
    name: "Judgment Engine",
    summary: "Turn precise target selection into command-guided annihilation.",
  },
  {
    id: "procession_wing",
    orderIds: ["procession", "wing"],
    name: "Falling Star",
    summary: "Enter from above, gather the brood, and finish the procession on impact.",
  },
  {
    id: "procession_halo",
    orderIds: ["procession", "halo"],
    name: "Bellwarden",
    summary: "Let a timed guard ring the opening bell for an execution sequence.",
  },
  {
    id: "procession_edict",
    orderIds: ["procession", "edict"],
    name: "Execution Marshal",
    summary: "Arrange the formation with commands, then personally break it.",
  },
  {
    id: "wing_halo",
    orderIds: ["wing", "halo"],
    name: "Seraphic Bulwark",
    summary: "Alternate rapid intervention, perfect defence, and explosive escape.",
  },
  {
    id: "wing_edict",
    orderIds: ["wing", "edict"],
    name: "Living Beacon",
    summary: "Carry an armed command into the swarm and leave before judgment lands.",
  },
  {
    id: "halo_edict",
    orderIds: ["halo", "edict"],
    name: "Choir Bastion",
    summary: "Build a sanctuary around the objective and return every assault.",
  },
]);

export const PROGRESSION_CONFIG = deepFreeze({
  schemaVersion: PROGRESSION_SCHEMA_VERSION,
  fieldRank: {
    cap: FIELD_RANK_CAP,
    xpThresholds: FIELD_RANK_XP_THRESHOLDS,
    xpAwards: XP_AWARDS,
  },
  doctrine: {
    pointsPerRank: DOCTRINE_POINTS_PER_RANK,
    pointStartRank: DOCTRINE_POINT_START_RANK,
    talentMaxRank: TALENT_MAX_RANK,
    maxPointsPerOrder: MAX_POINTS_PER_ORDER,
    capstoneEligibilityPoints: CAPSTONE_ELIGIBILITY_POINTS,
    maxActiveCapstones: MAX_ACTIVE_CAPSTONES,
    vowSealRanks: VOW_SEAL_RANKS,
    orderIds: ORDER_IDS,
    orders: DOCTRINE_ORDERS,
    concordances: CONCORDANCES,
  },
});
