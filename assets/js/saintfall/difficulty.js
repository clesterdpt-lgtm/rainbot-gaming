/* ============================================================
   SAINTFALL - difficulty tiers

   Three tiers, one table, and a rule about WHICH numbers a tier is
   allowed to move.

   The rule comes from `scripts/saintfall-melee-duel-probe.mjs`. It runs a
   Volley bot and a lance bot against the same rosters, and where each
   build's health goes is not symmetric: the rifle loses health only to
   Gleaner bolts (the swarm dies at twenty-five metres and 8.6 m/s outruns
   7.4), the lance loses it to Gleaner fire while pinned and to the one
   armoured Harrow bite per kill. So:

     - enemy DAMAGE is a melee tax. It touches whoever gets touched, and at
       range nothing does. It moves least.
     - enemy HEALTH is a ranged tax. The lance one-shots the light caste at
       any health (combat.js `Math.max(dmg, health)`); the Volley loses its
       frontal one-shot the moment a Thresher has more than 62.
     - COUNT, wave pace and Thresher speed are ranged taxes: the attack-slot
       cap bounds the lance's incoming bites at two a second however many
       bodies surround it, and a Thresher faster than 8.6 m/s cannot be
       kited.
     - Volley HEAT is a ranged tax that costs no health at all: a vent
       mid-wave is a 2.4s lockout with the pack arriving.
     - melee SUSTAIN scales with damage, so bites paid per kill hold.

   And three things a tier never moves, because they are the melee build's
   skill floor rather than its difficulty: the tell durations (a Thresher
   wind-up under the lance opener's 0.31s makes the pounce un-pre-emptable),
   the first-contact hold, and the post-hit grace. Hard is more to read,
   not less time to read it.

   The tier is a player setting (ui.js `difficulty`, both menus show the
   LIVE tier), a `?difficulty=` URL is a session override for harnesses,
   and every save records the tier it was played on. Values are read live
   from `ctx.difficulty.current` at the point of use, so a change in the
   entry panel or the field menu takes effect on the next frame.
   ============================================================ */

export const DIFFICULTY = Object.freeze({
  pilgrim: Object.freeze({
    label: "PILGRIM",
    blurb: "A gentler road. Lighter bites, thinner broods, a cooler barrel.",
    /* All incoming damage, applied once in combat.hurtPlayer. Relative to
       Penitent, so boss and hazard numbers stay authored at 1.0. */
    incoming: 0.82,
    lightHealth: 0.85,   // thresher, gleaner
    heavyHealth: 0.85,   // harrow, precentor, cantor, matriarch
    bossHealth: 0.85,    // everything with its own module (where it uses inst.health)
    roster: 0.8,         // breach roster counts
    gleanerDelta: -1,    // per roster that already fields Gleaners
    gleanerDirectAim: 0.32,
    breachPace: 1.25,    // multiplies the breach timers (larger = slower)
    thresherSpeed: 0.9,  // charge speed and the pounce that rides on it
    heat: 0.88,          // Volley heat per shot (34 rounds before overheat)
    slotCap: 2,
    sustain: 1.0,        // melee kill-heal and regen rebate
    regenDelay: 4.5,
  }),
  penitent: Object.freeze({
    label: "PENITENT",
    blurb: "The road as it was walked. Every number the game was tuned at.",
    incoming: 1.0,
    lightHealth: 1.0,
    heavyHealth: 1.0,
    bossHealth: 1.0,
    roster: 1.0,
    gleanerDelta: 0,
    gleanerDirectAim: 0.42,
    breachPace: 1.0,
    thresherSpeed: 1.0,
    heat: 1.0,           // 30 rounds
    slotCap: 2,
    sustain: 1.0,
    regenDelay: 5.5,
  }),
  martyr: Object.freeze({
    label: "MARTYR",
    blurb: "Thicker broods that come sooner and cannot be outrun; a barrel that runs hot; a Thresher that takes two rounds. The lance pays a little more per bite and heals a little more per kill.",
    /* Measured with `--tiers all`: at 1.24 / roster 1.3 / aim 0.50 Martyr
       killed BOTH bots inside Breaker Brood (the rifle at 6.8s, to three
       Gleaners it could not out-shoot while every Thresher took two rounds)
       - a wall, not a hard tier. These land W3 as clearable-with-effort and
       leave Crowned Surge as the wall. */
    incoming: 1.20,
    lightHealth: 1.30,   // Thresher 78: no frontal one-shot for the Volley
    heavyHealth: 1.15,
    bossHealth: 1.15,
    roster: 1.2,
    /* Not +1: an extra Gleaner is the one thing that taxes the lance MORE
       than the rifle (it is fired on while pinned), and the naive lance bot
       died to it in Breaker Brood while the rifle cleared. Aim goes up
       instead, which both builds pay for. */
    gleanerDelta: 0,
    gleanerDirectAim: 0.46,
    breachPace: 0.8,
    thresherSpeed: 1.2,  // 8.88 m/s, past the trooper's 8.6
    heat: 1.25,          // 24 rounds
    slotCap: 3,
    sustain: 1.25,
    regenDelay: 6.5,
  }),
});

export const DIFFICULTY_TIERS = Object.freeze(Object.keys(DIFFICULTY));
export const DEFAULT_DIFFICULTY = "penitent";

const LIGHT = new Set(["thresher", "gleaner"]);
const HEAVY = new Set(["harrow", "precentor", "cantor", "matriarch"]);

export function normalizeDifficulty(tier) {
  return typeof tier === "string" && Object.prototype.hasOwnProperty.call(DIFFICULTY, tier)
    ? tier : DEFAULT_DIFFICULTY;
}

export function difficultyLabel(tier) {
  return DIFFICULTY[normalizeDifficulty(tier)].label;
}

export function difficultyBlurb(tier) {
  return DIFFICULTY[normalizeDifficulty(tier)].blurb;
}

export function difficultyValues(tier) {
  return DIFFICULTY[normalizeDifficulty(tier)];
}

/** Which health multiplier a caste takes. */
export function difficultyHealthScale(tier, key) {
  const values = difficultyValues(tier);
  if (LIGHT.has(key)) return values.lightHealth;
  if (HEAVY.has(key)) return values.heavyHealth;
  return values.bossHealth;
}

/**
 * The live tier for a session. Pure data: no module reads this at build
 * time, every consumer reads `current` when it needs a number, and
 * listeners (main.js: menus, live-enemy rescale) hear each change.
 */
export function buildDifficulty() {
  const listeners = new Set();
  const state = { tier: DEFAULT_DIFFICULTY, source: "default" };
  const api = {
    get tier() { return state.tier; },
    get source() { return state.source; },
    get current() { return DIFFICULTY[state.tier]; },
    tiers: DIFFICULTY_TIERS,
    label(tier = state.tier) { return difficultyLabel(tier); },
    blurb(tier = state.tier) { return difficultyBlurb(tier); },
    values(tier = state.tier) { return difficultyValues(tier); },
    healthScale(key, tier = state.tier) { return difficultyHealthScale(tier, key); },
    /** Returns the tier now in force. Listeners fire only on a change. */
    set(tier, source = "menu") {
      const next = normalizeDifficulty(tier);
      const previous = state.tier;
      state.tier = next;
      state.source = source;
      if (next !== previous) {
        for (const listener of Array.from(listeners)) {
          try { listener(next, previous, source); } catch (error) {
            console.error("[saintfall] difficulty listener threw", error);
          }
        }
      }
      return next;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status() {
      return {
        tier: state.tier,
        label: difficultyLabel(state.tier),
        source: state.source,
        tiers: [...DIFFICULTY_TIERS],
        values: { ...DIFFICULTY[state.tier] },
      };
    },
  };
  return api;
}
