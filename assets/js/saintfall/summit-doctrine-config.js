/* ============================================================
   SAINTFALL - Kenosis doctrine data

   Two complete trees, one per operative, in the same shape the
   campaign's `progression-config.js` uses - because `ui.js`'s
   doctrine board renders whatever `definitions()` hands it and
   knows nothing about Vesper. Five Orders each, five nodes per
   Order (four rites + a Vow capstone): 50 nodes in total, which is
   twice the count Vesper's own tree carries.

   WHY A PARALLEL PACK RATHER THAN AN EXTENSION. `progression.js`
   imports `DOCTRINE_ORDERS` at module scope, builds its TALENTS /
   CAPSTONES / ORDERS maps and its IMPLEMENTED_TALENTS allowlist
   once, and `buildProgression(ctx)` takes no tree argument - it
   cannot return a different tree without re-shaping 2300 lines that
   Vesper's whole campaign depends on. Kenosis is a parallel content
   pack everywhere else (summit-art, summit-hud, summit-world); the
   doctrine follows the same rule. Nothing here is imported by the
   campaign and nothing here can change it.

   COPY LIVES IN ONE PLACE. The campaign carries an `MVP_COPY`
   override table inside progression.js that silently rewrites 19 of
   its 25 nodes, and its text has drifted from the config it
   overrides. There is no override layer here: the description a
   player reads is the description in this file, and the runtime
   reads its numbers from `TUNING` below so the two cannot disagree.
   ============================================================ */

/* ------------------------------------------------------------
   ECONOMY. Deliberately shorter than the campaign's 25 ranks: the
   trials ground is an afternoon, not a operation, and a doctrine
   nobody reaches the middle of is a doctrine nobody has seen.
   ------------------------------------------------------------ */
export const KENOSIS_RANK_CAP = 14;
export const KENOSIS_POINT_START_RANK = 2;
export const KENOSIS_POINTS_PER_RANK = 1;
/* Eight, because an Order IS eight ranks (four rites at two each)
   and a cap below that makes the tier-3 rite unreachable no matter
   how the player spends - the audit caught `three_places`,
   `reaping_volley`, `immovable`, `hooked_chain` and `last_lantern`
   refused with "this Order is limited". The cap that matters is the
   11 points a full career earns against 32 ranks of capacity. */
export const KENOSIS_MAX_POINTS_PER_ORDER = 8;
export const KENOSIS_CAPSTONE_POINTS = 5;
export const KENOSIS_MAX_ACTIVE_CAPSTONES = 2;
export const KENOSIS_VOW_SEAL_RANKS = Object.freeze([5, 9]);

/* Cumulative XP for each Field Rank. A trial cohort is 4 threshers,
   2 gleaners and a harrow - 370 XP - so the first two ranks land
   inside the first fight and the cap is a long afternoon. */
export const KENOSIS_XP_THRESHOLDS = Object.freeze([
  0, 180, 430, 760, 1180, 1700, 2330, 3080, 3960, 4980, 6150, 7480, 8980, 10660,
]);

export const KENOSIS_XP_AWARDS = Object.freeze({
  thresher: 25,
  gleaner: 60,
  harrow: 150,
  "censer-kite": 45,
  cohort: 120,
});

/* ------------------------------------------------------------
   THE NUMBERS. Every value a rite actually applies lives here, and
   the descriptions below are written against it. `summit-doctrine.js`
   reads this table - it never hard-codes a magnitude - so a balance
   pass changes one number and the board's copy stays true.
   ------------------------------------------------------------ */
export const TUNING = Object.freeze({
  /* ---- White Vigil ---- */
  quicksilver_afterimage: { pullRadius: [7, 9.5], stun: [0.9, 1.4] },
  quicksilver_second_wind: { charge: [9, 15] },
  quicksilver_cut_the_thread: { window: [3.0, 3.0], damage: [1.6, 2.2] },
  quicksilver_three_places: { charges: [3, 3], recharge: [4.4, 3.6] },
  quicksilver_unbroken_vigil: { radius: 6.5, damage: 190, stun: 2.0, cooldown: 9 },

  crescent_paired_verdict: { stacks: [6, 6], damage: [1.45, 1.9] },
  crescent_long_measure: { range: [54, 62], floor: [0.72, 0.86] },
  crescent_sundered_arc: { splits: [2, 3], damage: [0.55, 0.7] },
  crescent_reaping_volley: { ramp: [0.22, 0.34], seconds: [1.6, 1.6] },
  crescent_choir_of_edges: { fan: 7, damage: 34, cooldown: 8 },

  stoop_falling_star: { perMetre: [3.2, 4.6], cap: [110, 160] },
  stoop_kingfisher: { refund: [0.55, 1.0] },
  stoop_shearwater: { slow: [0.45, 0.32], seconds: [2.2, 3.0] },
  stoop_high_pass: { launch: [9.5, 11.5] },
  stoop_the_long_dive: { radius: 8.5, damage: 260, stun: 2.4 },

  vigil_pale_ledger: { speed: [1.18, 1.3], seconds: [3.0, 4.0] },
  vigil_watchfire: { threshold: [0.45, 0.6], regen: [7, 11] },
  vigil_thin_ice: { seconds: [0.9, 1.3], reduction: [0.4, 0.55] },
  vigil_last_lantern: { cooldown: [95, 70], health: [45, 70] },
  vigil_white_vigil: { arm: 1.6, damage: 2.6, seconds: 6 },

  /* ---- Bastion Penitent ---- */
  bulwark_anvil_stance: { perStack: [0.05, 0.075], stacks: [5, 6] },
  bulwark_bell_and_board: { radius: [5.5, 7], stun: [1.3, 1.9] },
  bulwark_returned_weight: { share: [0.5, 0.8], cap: [220, 340] },
  bulwark_immovable: { speed: [2.6, 3.1], resist: [0.5, 0.8] },
  bulwark_the_shut_gate: { radius: 9, damage: 210, stun: 2.6 },

  cast_true_return: { damage: [0.6, 0.85] },
  cast_iron_bell: { stun: [1.4, 2.1] },
  cast_second_reliquary: { charges: [2, 2], cooldown: [6.5, 5.5] },
  cast_hooked_chain: { stun: [4.0, 5.5], drag: [6, 9] },
  cast_the_thrown_choir: { arcs: 3, spread: 0.38, damage: 175 },

  forge_stoked: { radius: [5, 6.5], damage: [55, 85] },
  forge_hard_landing: { radius: [4.5, 6], damage: [70, 115] },
  forge_bellows: { perHit: [0.2, 0.32] },
  forge_furnace_gait: { speed: [1.35, 1.5], seconds: [3.5, 4.5] },
  forge_the_open_firebox: { radius: 10, damage: 300, stun: 2.8 },

  anvil_dead_weight: { stun: [0.55, 0.85] },
  anvil_measured_swing: { damage: [1.5, 1.9] },
  anvil_ring_true: { health: [14, 22] },
  anvil_shatterpoint: { damage: [1.6, 2.1] },
  anvil_the_last_nail: { radius: 7.5, damage: 240, stun: 2.2 },

  /* ---- The call Orders ----
     Both trees end on an Order that improves what the sky does when
     it is asked, so the numbers below are read by `summit-command.js`
     through the same `kit()` oracle the weapons use. Multipliers are
     ABSOLUTE (0.86 = a 14% shorter cooldown) rather than deltas,
     because a command spec is four numbers and a percentage of a
     percentage is how a balance pass goes wrong. */
  antiphon_swift_verse: { cooldown: [0.86, 0.74] },
  antiphon_answering_step: { refund: [3, 5] },
  antiphon_wider_verse: { radius: [1.18, 1.32], damage: [1.16, 1.3] },
  antiphon_lingering_verse: { seconds: [5, 8], slow: [0.55, 0.38] },
  antiphon_the_response: { radiusScale: 0.45, damageScale: 0.4, stagger: 0.6 },

  tocsin_short_fuse: { delay: [0.72, 0.52] },
  tocsin_braced_call: { reduction: [0.28, 0.48], seconds: [4, 5.5] },
  tocsin_heavy_ordnance: { damage: [1.22, 1.4], radius: [1.1, 1.18] },
  tocsin_two_bells: { charges: [2, 2], cooldown: [1, 0.84] },
  tocsin_the_great_bell: { groundRadius: 12, stun: 2.6 },
});

/* ------------------------------------------------------------
   THE SIGILS. Forty AI plates is forty assets this build cannot
   author, and `ui.js` resolves a talent icon straight from its id
   with no fallback - a missing file renders as an empty black
   square with a tier chip on it. So every Kenosis rite carries its
   own icon as a generated SVG data URI: the Order's colour, the
   Order's fold count as radial symmetry, and a per-rite glyph. It
   costs about 700 bytes each against ~900KB for a plate, it is
   crisp at every size, and it cannot 404.
   ------------------------------------------------------------ */
function riteIcon(colour, accent, folds, glyph) {
  const spokes = [];
  const n = Math.max(2, Math.min(12, folds));
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x1 = 32 + Math.cos(a) * 9;
    const y1 = 32 + Math.sin(a) * 9;
    const x2 = 32 + Math.cos(a) * 25;
    const y2 = 32 + Math.sin(a) * 25;
    spokes.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`);
  }
  /* Six centre glyphs, picked per rite so no two nodes in an Order
     read alike at thumbnail size. */
  const glyphs = [
    `<circle cx="32" cy="32" r="6.5"/>`,
    `<path d="M32 24 L39 32 L32 40 L25 32 Z"/>`,
    `<path d="M24 38 L32 22 L40 38 Z"/>`,
    `<path d="M23 32 h18 M32 23 v18"/>`,
    `<path d="M24 32 a8 8 0 0 1 16 0 a8 8 0 0 1 -16 0" />`,
    `<path d="M25 25 L39 39 M39 25 L25 39"/>`,
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
    + `<rect width="64" height="64" fill="#05080d"/>`
    + `<g fill="none" stroke="${colour}" stroke-width="1.5" opacity="0.5">${spokes.join("")}</g>`
    + `<circle cx="32" cy="32" r="21" fill="none" stroke="${colour}" stroke-width="1.6" opacity="0.75"/>`
    + `<circle cx="32" cy="32" r="15" fill="none" stroke="${accent}" stroke-width="1" opacity="0.5"/>`
    + `<g fill="none" stroke="${accent}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">`
    + `${glyphs[glyph % glyphs.length]}</g>`
    + `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/* Attach an icon to every node of an Order as the tree is built. */
function withIcons(order) {
  const { colour, accent, folds } = order.art;
  order.talents.forEach((talent, index) => {
    talent.icon = riteIcon(colour, accent, folds, index);
  });
  if (order.capstone) order.capstone.icon = riteIcon(accent, colour, folds, 5);
  return order;
}

const t = (id, orderId, name, summary, tier, orderPoints, ranks) => ({
  id,
  orderId,
  kind: "talent",
  name,
  summary,
  tier,
  requires: { orderPoints },
  maxRank: ranks.length,
  implemented: true,
  ranks: ranks.map((description, i) => ({ rank: i + 1, description })),
});

const cap = (id, orderId, name, summary, description) => ({
  id,
  orderId,
  kind: "capstone",
  name,
  summary,
  requires: { orderPoints: KENOSIS_CAPSTONE_POINTS, vowSeal: true },
  implemented: true,
  description,
});

/* ============================================================
   THE KENOTIC RITE - White Vigil
   A scout's doctrine: displacement, edges, and the line of a dive.
   ============================================================ */
const VIGIL_ORDERS = [
  withIcons({
    id: "quicksilver",
    name: "Order of Quicksilver",
    shortName: "Quicksilver",
    focus: "Displacement, and what is owed for arriving somewhere new.",
    accent: "cyan",
    art: { colour: "#9df3e0", accent: "#eafff7", folds: 2, spin: 0.52 },
    talents: [
      t("quicksilver_afterimage", "quicksilver", "Afterimage",
        "Leave something behind that the swarm still believes in.", 1, 0, [
          "The Vigil Step leaves a standing afterimage. Enemies within 7 metres turn on it and are staggered for 0.9 seconds.",
          "The afterimage holds a 9.5-metre draw and staggers for 1.4 seconds.",
        ]),
      t("quicksilver_second_wind", "quicksilver", "Second Wind",
        "The step pays for itself.", 1, 0, [
          "Completing a Vigil Step returns 9 reliquary charge.",
          "The return rises to 15 charge.",
        ]),
      t("quicksilver_cut_the_thread", "quicksilver", "Cut the Thread",
        "Arrive already swinging.", 2, 2, [
          "For 3 seconds after a Step, the next blade strike deals 60% more damage.",
          "The empowered strike deals 120% more damage and cannot be blocked by armour.",
        ]),
      t("quicksilver_three_places", "quicksilver", "Three Places at Once",
        "Be somewhere else more often.", 3, 4, [
          "The Vigil Step carries a third charge and each recharges in 4.4 seconds.",
          "Each charge recharges in 3.6 seconds.",
        ]),
    ],
    capstone: cap("quicksilver_unbroken_vigil", "quicksilver", "The Unbroken Vigil",
      "Make the arrival itself the weapon.",
      "A Vigil Step that passes through an enemy leaves a collapsing echo at the departure point: after 0.4 seconds it implodes for 190 damage in 6.5 metres and staggers everything caught for 2 seconds. The echo can be raised once every 9 seconds."),
  }),
  withIcons({
    id: "crescent",
    name: "Order of the Crescent",
    shortName: "Crescent",
    focus: "The paired emitters, and the discipline of alternating hands.",
    accent: "gold",
    art: { colour: "#ffe6a2", accent: "#fff6dc", folds: 4, spin: 0.24 },
    talents: [
      t("crescent_paired_verdict", "crescent", "Paired Verdict",
        "Both hands, one sentence.", 1, 0, [
          "Landing pulses from alternating hands builds a Verdict. At 6 stacks the next pulse deals 45% more damage and clears the count.",
          "The empowered pulse deals 90% more damage.",
        ]),
      t("crescent_long_measure", "crescent", "The Long Measure",
        "Reach past what a sidearm should.", 1, 0, [
          "Crescent range extends to 54 metres and never falls below 72% damage.",
          "Range extends to 62 metres and the floor rises to 86%.",
        ]),
      t("crescent_sundered_arc", "crescent", "Sundered Arc",
        "A killing pulse does not stop.", 2, 2, [
          "A pulse that kills splits into 2 shards dealing 55% damage to other targets.",
          "It splits into 3 shards dealing 70% damage.",
        ]),
      t("crescent_reaping_volley", "crescent", "Reaping Volley",
        "Reward the held trigger.", 3, 4, [
          "Sustained fire ramps damage by 22% over 1.6 seconds of continuous firing.",
          "The ramp rises to 34%.",
        ]),
    ],
    capstone: cap("crescent_choir_of_edges", "crescent", "Choir of Edges",
      "Spend the whole Verdict at once.",
      "Completing a Verdict releases a fan of 7 crescents across the forward arc, each dealing 34 damage and travelling the weapon's full range. The Choir can sing once every 8 seconds."),
  }),
  withIcons({
    id: "stoop",
    name: "Order of the Stoop",
    shortName: "Stoop",
    focus: "The dive: a line chosen in the air and paid for on landing.",
    accent: "blue",
    art: { colour: "#8fd6e6", accent: "#eafcff", folds: 3, spin: -0.36 },
    talents: [
      t("stoop_falling_star", "stoop", "Falling Star",
        "Distance is the damage.", 1, 0, [
          "The Stoop gains 3.2 damage for every metre of line flown, up to 110.",
          "It gains 4.6 per metre, up to 160.",
        ]),
      t("stoop_kingfisher", "stoop", "Kingfisher",
        "A dive that catches something is not spent.", 1, 0, [
          "A Stoop that kills refunds 55% of its cooldown.",
          "A Stoop that kills refunds the whole cooldown.",
        ]),
      t("stoop_shearwater", "stoop", "Shearwater",
        "Leave the air disturbed behind you.", 2, 2, [
          "The Stoop leaves a wake that slows enemies to 45% speed for 2.2 seconds.",
          "The wake slows to 32% for 3 seconds.",
        ]),
      t("stoop_high_pass", "stoop", "High Pass",
        "Start the dive from the ground.", 3, 4, [
          "The Stoop may be thrown from standing: the Vigil launches 9.5 metres up into the line.",
          "The launch rises to 11.5 metres.",
        ]),
    ],
    capstone: cap("stoop_the_long_dive", "stoop", "The Long Dive",
      "Land the whole line at once.",
      "A Stoop that ends on the ground detonates for 260 damage in 8.5 metres and staggers for 2.4 seconds. The longer the line flown, the wider the mark it leaves."),
  }),
  withIcons({
    id: "vigil",
    name: "Order of the Vigil",
    shortName: "Vigil",
    focus: "Staying alive long enough to be somewhere else.",
    accent: "green",
    art: { colour: "#cfe0f4", accent: "#ffffff", folds: 6, spin: 0.18 },
    talents: [
      t("vigil_pale_ledger", "vigil", "Pale Ledger",
        "Every name closed is speed owed.", 1, 0, [
          "A kill grants 18% movement speed for 3 seconds.",
          "It grants 30% for 4 seconds.",
        ]),
      t("vigil_watchfire", "vigil", "Watchfire",
        "Burn brightest at the end of the wick.", 1, 0, [
          "Below 45% vitality the reliquary recharges 7 faster per second.",
          "The threshold rises to 60% and the recharge to 11 per second.",
        ]),
      t("vigil_thin_ice", "vigil", "Thin Ice",
        "Being hit is information.", 2, 2, [
          "Taking damage grants 0.9 seconds during which further damage is cut by 40%.",
          "The window lasts 1.3 seconds and cuts 55%.",
        ]),
      t("vigil_last_lantern", "vigil", "The Last Lantern",
        "One death deferred.", 3, 4, [
          "A lethal blow instead leaves the Vigil at 45 vitality. Once every 95 seconds.",
          "It leaves 70 vitality, once every 70 seconds.",
        ]),
    ],
    capstone: cap("vigil_white_vigil", "vigil", "The White Vigil",
      "Hold still, and be unseen for it.",
      "Standing still for 1.6 seconds veils the Vigil: enemies lose track, and the next crescent volley fired from the veil deals 160% more damage. The veil holds for 6 seconds or until the volley is spent."),
  }),
  /* ============================================================
     THE FIFTH ORDER. Everything above improves what the operative
     does; this improves what she ASKS FOR. It is the only Order in
     either tree whose rites touch the command wheel, and it is
     deliberately last: a doctrine that makes the sky answer faster
     is worth nothing until there is something worth calling it on.
     ============================================================ */
  withIcons({
    id: "antiphon",
    name: "Order of the Antiphon",
    shortName: "Antiphon",
    focus: "Call and response: what is asked for, and how fast it answers.",
    accent: "violet",
    art: { colour: "#c9a8ff", accent: "#f2e9ff", folds: 5, spin: 0.44 },
    talents: [
      t("antiphon_swift_verse", "antiphon", "Swift Verse",
        "Ask more often.", 1, 0, [
          "Every field command comes back 14% sooner.",
          "Every field command comes back 26% sooner.",
        ]),
      t("antiphon_answering_step", "antiphon", "Answering Step",
        "The Step is itself a signal.", 1, 0, [
          "Completing a Vigil Step takes 3 seconds off every command cooldown.",
          "It takes 5 seconds off every command cooldown.",
        ]),
      t("antiphon_wider_verse", "antiphon", "The Wider Verse",
        "Ask for more of it.", 2, 2, [
          "Field commands cover 18% more ground and hit 16% harder.",
          "They cover 32% more ground and hit 30% harder.",
        ]),
      t("antiphon_lingering_verse", "antiphon", "The Lingering Verse",
        "The ground remembers being asked.", 3, 4, [
          "A command leaves its mark standing for 5 seconds; enemies inside it move at 55% speed.",
          "The mark stands for 8 seconds and slows to 38% speed.",
        ]),
    ],
    capstone: cap("antiphon_the_response", "antiphon", "The Response",
      "One verse, answered by the rest of them.",
      "Every field command you call is answered by lesser echoes of your other two, landing a fraction of a second apart at 45% radius and 40% damage. One call becomes three, and the two that follow cost nothing."),
  }),
];

/* ============================================================
   THE IRON LITURGY - Bastion Penitent
   A bulwark's doctrine: weight taken, weight returned, weight thrown.
   ============================================================ */
const BASTION_ORDERS = [
  withIcons({
    id: "bulwark",
    name: "Order of the Bulwark",
    shortName: "Bulwark",
    focus: "The tower shield, and the arithmetic of a blow that did not land.",
    accent: "amber",
    art: { colour: "#ff9540", accent: "#ffe0b0", folds: 8, spin: -0.22 },
    talents: [
      t("bulwark_anvil_stance", "bulwark", "Anvil Stance",
        "A guard that is kept becomes armour.", 1, 0, [
          "Each blow taken on the shield grants 5% damage reduction, stacking to 5 and lasting while the guard holds.",
          "Each stack grants 7.5%, to a maximum of 6.",
        ]),
      t("bulwark_bell_and_board", "bulwark", "Bell and Board",
        "Answer a blow on the beat.", 1, 0, [
          "A perfect guard rings the shield: everything within 5.5 metres is staggered for 1.3 seconds.",
          "The ring reaches 7 metres and staggers for 1.9 seconds.",
        ]),
      t("bulwark_returned_weight", "bulwark", "Returned Weight",
        "Nothing is absorbed. It is only held.", 2, 2, [
          "50% of damage taken on the shield is banked, up to 220, and added to the next hammer blow.",
          "80% is banked, up to 340.",
        ]),
      t("bulwark_immovable", "bulwark", "Immovable",
        "Walk behind the wall.", 3, 4, [
          "Guarding no longer slows to a crawl - the Bastion advances at 2.6 m/s and resists 50% of knockback.",
          "It advances at 3.1 m/s and resists 80% of knockback.",
        ]),
    ],
    capstone: cap("bulwark_the_shut_gate", "bulwark", "The Shut Gate",
      "Refuse a blow loudly enough to end the argument.",
      "A perfect guard slams the gate: a 9-metre shockwave for 210 damage, staggering everything caught for 2.6 seconds, and the Bastion cannot be moved for the next 2 seconds."),
  }),
  withIcons({
    id: "cast",
    name: "Order of the Cast",
    shortName: "Cast",
    focus: "The thrown reliquary, and the certainty of its return.",
    accent: "gold",
    art: { colour: "#ffc453", accent: "#fff4d8", folds: 5, spin: 0.32 },
    talents: [
      t("cast_true_return", "cast", "True Return",
        "The journey home is also a journey.", 1, 0, [
          "The returning hammer deals 60% of the outbound damage to everything it passes.",
          "It deals 85%.",
        ]),
      t("cast_iron_bell", "cast", "Iron Bell",
        "A struck body should ring.", 1, 0, [
          "The cast staggers everything it strikes for 1.4 seconds.",
          "It staggers for 2.1 seconds.",
        ]),
      /* Authored as a second charge, shipped as a faster return: two
         reliquaries in flight needs a second thrown visual and a
         second return solve, and a rite whose copy promises what the
         kit does not do is the drift this file exists to avoid. */
      t("cast_second_reliquary", "cast", "The Second Reliquary",
        "A hammer that comes back sooner is a second hammer.", 2, 2, [
          "The Cast's cooldown falls from 8 seconds to 6.5.",
          "It falls to 5.5 seconds.",
        ]),
      t("cast_hooked_chain", "cast", "Hooked Chain",
        "What is felled stays felled.", 3, 4, [
          "A flyer struck by the cast is grounded for 4 seconds and dragged 6 metres toward the Bastion.",
          "It is grounded for 5.5 seconds and dragged 9 metres.",
        ]),
    ],
    capstone: cap("cast_the_thrown_choir", "cast", "The Thrown Choir",
      "One reliquary is a hammer. Three are a verdict.",
      "The Cast splits into three arcs thrown across a 22-degree spread, each dealing 175 damage, each returning on its own line. The whole choir must come home before it can be thrown again."),
  }),
  withIcons({
    id: "forge",
    name: "Order of the Forge",
    shortName: "Forge",
    focus: "The Censer boiler: heat spent as height, and paid on landing.",
    accent: "amber",
    art: { colour: "#ff6a2a", accent: "#ffc07a", folds: 3, spin: 0.42 },
    talents: [
      t("forge_stoked", "forge", "Stoked",
        "A leap is a firebox opening.", 1, 0, [
          "Leaping vents the boiler: 55 damage within 5 metres of the launch.",
          "85 damage within 6.5 metres.",
        ]),
      t("forge_hard_landing", "forge", "Hard Landing",
        "Two tonnes has to go somewhere.", 1, 0, [
          "Landing from a leap deals 70 damage within 4.5 metres.",
          "115 damage within 6 metres.",
        ]),
      t("forge_bellows", "forge", "Bellows",
        "Being hit stokes the fire.", 2, 2, [
          "Every blow taken cuts 0.2 seconds from the leap's cooldown.",
          "Every blow cuts 0.32 seconds.",
        ]),
      t("forge_furnace_gait", "forge", "Furnace Gait",
        "Land running.", 3, 4, [
          "For 3.5 seconds after landing a leap, the Bastion moves 35% faster.",
          "50% faster, for 4.5 seconds.",
        ]),
    ],
    capstone: cap("forge_the_open_firebox", "forge", "The Open Firebox",
      "Arrive as the furnace.",
      "The leap becomes a comet: it trails fire for its whole arc and lands for 300 damage in 10 metres, staggering for 2.8 seconds. Everything within the mark burns for a further 4 seconds."),
  }),
  withIcons({
    id: "anvil",
    name: "Order of the Anvil",
    shortName: "Anvil",
    focus: "The hammer itself, swung slowly and exactly once per opening.",
    accent: "amber",
    art: { colour: "#e8503a", accent: "#ffd0b0", folds: 4, spin: -0.28 },
    talents: [
      t("anvil_dead_weight", "anvil", "Dead Weight",
        "Nothing struck by this keeps its footing.", 1, 0, [
          "Hammer blows stagger for 0.55 seconds.",
          "They stagger for 0.85 seconds.",
        ]),
      t("anvil_measured_swing", "anvil", "Measured Swing",
        "The third blow is the one that was aimed.", 1, 0, [
          "The third blow of a chain deals 50% more damage.",
          "It deals 90% more.",
        ]),
      t("anvil_ring_true", "anvil", "Ring True",
        "A clean kill is a breath.", 2, 2, [
          "A hammer kill restores 14 vitality.",
          "It restores 22.",
        ]),
      t("anvil_shatterpoint", "anvil", "Shatterpoint",
        "Hit what is already falling.", 3, 4, [
          "Hammer blows against a staggered enemy deal 60% more damage.",
          "They deal 110% more.",
        ]),
    ],
    capstone: cap("anvil_the_last_nail", "anvil", "The Last Nail",
      "Drive it home.",
      "The finisher of a hammer chain plants the reliquary in the ground: a 7.5-metre shockwave for 240 damage that staggers for 2.2 seconds, and every enemy caught is left staggered long enough for the next chain to open on them."),
  }),
  /* ============================================================
     THE FIFTH ORDER. The Bastion's counterpart to the Antiphon and
     the same argument: four Orders of weight carried, thrown and
     taken, and then one that decides what the sky does about it.
     Where the Vigil's call Order makes commands FASTER and WIDER,
     this one makes them SOONER and HEAVIER - the same axis the two
     kits differ on everywhere else.
     ============================================================ */
  withIcons({
    id: "tocsin",
    name: "Order of the Tocsin",
    shortName: "Tocsin",
    focus: "Strike the bell, and stand still while the sky answers.",
    accent: "verdigris",
    art: { colour: "#6fd3b0", accent: "#dffaf0", folds: 6, spin: -0.3 },
    talents: [
      t("tocsin_short_fuse", "tocsin", "The Short Fuse",
        "Do not make him wait.", 1, 0, [
          "Field commands land 28% sooner after the beacon is thrown.",
          "They land 48% sooner.",
        ]),
      t("tocsin_braced_call", "tocsin", "Braced Call",
        "Plant, and let it come.", 1, 0, [
          "Calling a command braces the Bastion: 28% less damage taken for 4 seconds.",
          "48% less damage taken for 5.5 seconds.",
        ]),
      t("tocsin_heavy_ordnance", "tocsin", "Heavy Ordnance",
        "Ask for the big one.", 2, 2, [
          "Field commands hit 22% harder across 10% more ground.",
          "They hit 40% harder across 18% more ground.",
        ]),
      t("tocsin_two_bells", "tocsin", "Two Bells",
        "Ring it twice.", 3, 4, [
          "Every field command banks a second use before its cooldown begins.",
          "It also comes back 16% sooner.",
        ]),
    ],
    capstone: cap("tocsin_the_great_bell", "tocsin", "The Great Bell",
      "The one call that does not wait.",
      "A field command called from behind a raised shield skips its fuse entirely: the beacon lands at the Bastion's own feet the instant he asks, and everything flying within 12 metres is dragged out of the air and left staggered for 2.6 seconds."),
  }),
];

/* The board reads `orders`; the rules keys are the fallbacks
   `ui.js` would otherwise guess at (`maxPointsPerOrder || 8`,
   `capstoneEligibilityPoints || 6`, `rankCap || 25`). */
function tree(id, title, subtitle, orders) {
  return Object.freeze({
    id,
    title,
    subtitle,
    orders,
    maxPointsPerOrder: KENOSIS_MAX_POINTS_PER_ORDER,
    capstoneEligibilityPoints: KENOSIS_CAPSTONE_POINTS,
    maxActiveCapstones: KENOSIS_MAX_ACTIVE_CAPSTONES,
    rankCap: KENOSIS_RANK_CAP,
    vowSealRanks: KENOSIS_VOW_SEAL_RANKS,
  });
}

export const KENOSIS_TREES = Object.freeze({
  "white-vigil": tree("white-vigil", "The Kenotic Rite",
    "Displacement, edges, and the line of a dive.", VIGIL_ORDERS),
  "bastion-penitent": tree("bastion-penitent", "The Iron Liturgy",
    "Weight taken, weight returned, weight thrown.", BASTION_ORDERS),
});

/** The tree a given operative carries, or null for anyone else. */
export function kenosisTreeFor(characterId) {
  return KENOSIS_TREES[characterId] || null;
}

/** Every node id in a tree, in board order. Used by the runtime's
 *  allowlist and by the audit harness. */
export function kenosisNodeIds(treeId) {
  const found = KENOSIS_TREES[treeId];
  if (!found) return [];
  const ids = [];
  for (const order of found.orders) {
    for (const talent of order.talents) ids.push(talent.id);
    if (order.capstone) ids.push(order.capstone.id);
  }
  return ids;
}
