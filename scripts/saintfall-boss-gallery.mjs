#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the boss gallery

   Every boss, photographed to the SAME six framings, so a round of
   surface work can be judged across the whole cast instead of one
   animal at a time.

   The per-boss harnesses (`saintfall-stylite-shots`,
   `-abbess-shots`, `-garner-shots`) each answer questions about
   their own animal, and they are better at that than this file will
   ever be. What none of them can do is answer "did this round make
   the Winnower better or only different", because a Winnower shot
   from a Winnower-shaped camera is not comparable to anything. This
   one gives up bespoke composition and buys comparability with it:
   the same six intents, the same lens rules, the same light, the
   same seed, for all eight.

   What is deliberately generic, and why:

   - FRAMING IS MEASURED, NOT GUESSED. Every camera distance is
     solved from the subject's real projected size, refined against
     the actual projection matrix until the animal occupies the
     fraction of frame height the framing asks for. A hard-coded
     offset per boss is what makes two galleries incomparable the
     moment one boss grows a set of wings.

   - THE SUBJECT IS WALKED OFF ITS VERTICES. `Box3.setFromObject` on
     a SkinnedMesh returns numbers that run 40%-180% high, because
     three computes the box from already-skinned vertices and then
     applies the world matrix on top of them again. qa.js's
     `_scaleRaw` learned that the hard way and this uses the same
     walk. A boss framed off a bad box is photographed from three
     times too far away and nobody can tell why.

   - THE BEARING IS CHOSEN, NOT GIVEN. Half of a circle around a
     boss is usually solid district. The chooser marches the
     sightline over the height field first (cheap, analytic) and only
     then spends a raycast against the built geometry, because a
     raycast per candidate against the terrain mesh costs seconds.
     Every candidate is scored first, and the RANKED ladder is what
     the rationed rays are spent on - not the first thing that
     happened to clear the height field.

   - WHAT THE LENS CANNOT SEE IS NOT IN THE PHOTOGRAPH, and both
     halves of that had to be learned:

       * geometry under the sand is not photographable from any
         camera. The Coulter is a burrower and a third of it is below
         the height field on purpose; counting those vertices held its
         sightline score at a hard 0.67, so no bearing ever cleared
         the search's threshold and four of its six frames fell
         through to "best effort" on every run, for ever.

       * geometry behind a spire is not photographable from THIS
         camera. The fill used to be the projected extent of the
         whole animal, so the Stylite's 02-full measured 0.709 against
         a target of 0.72 - nominally perfect - with a Choir needle
         standing down the middle of it. Fill is now measured on the
         visible subset and the whole-animal number is kept beside it,
         because the difference is the diagnosis.

   - NOTHING IS TIMED. Headless chromium throttles rAF to about one
     frame a second, so a fixed wait photographs a stale surface.
     Every frame here is stepped explicitly, every poll is bounded,
     and the still itself is drawn with `renderStill` (dt 0) so the
     act of composing the shot cannot drift the animal out of the
     pose the shot is about.

   - THE PAGE IS RELOADED PER BOSS. Arming the Coulter completes
     every district boss and arming the Apostate pushes the mission
     into `cathedralBoss`, which retires the district sites. One tab
     for all eight means the last three bosses are photographed in a
     world the first five changed.

   Output: <out>/<boss>/0N-name.png, and one report.json beside them
   carrying, per shot, the camera it was taken from, the phase and
   health the boss was in, how much of the frame the animal filled,
   how much of it was in line of sight, and four image numbers -
   mean luminance, RMS contrast, chroma spread and a chroma-weighted
   hue spread. The last one is the "boss, sand and sky are all the
   same orange" measure the brief names, and it is the only one of
   the four that a darker grade cannot flatter.

   Usage:
     node scripts/saintfall-boss-gallery.mjs
     node scripts/saintfall-boss-gallery.mjs --boss stylite
     node scripts/saintfall-boss-gallery.mjs --boss coulter,apostate
     node scripts/saintfall-boss-gallery.mjs --out output/saintfall/gallery/round-3

   Exit status is 1 if any framing failed, and the failure names the
   boss and the framing.
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) { out._.push(token); continue; }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const OUT = path.resolve(root, args.out || "output/saintfall/gallery/latest");
const WIDTH = Number(args.width || 1600);
const HEIGHT = Number(args.height || 900);
/* Pid-derived with an override, the same shape as
   saintfall-bestiary-shots.mjs, so eight agents running this at once on
   one tree do not fight over a socket. */
const PORT = Number(args.port || 46100 + (process.pid % 3000));
const BASE = `http://127.0.0.1:${PORT}`;
/* Determinism, stated in the URL rather than assumed from the
   defaults. `cycle=0` freezes the day/night clock and `time` pins the
   key: without both, two rounds of a surface change are compared
   under two different suns and the diff measures the weather. The
   world seed is left at main.js's own constant unless overridden,
   because every other harness in this project photographs that
   terrain and a gallery on a private seed cannot be laid next to
   them. */
const TIME_KEY = String(args.time || "goldenhour");
const QUALITY = String(args.quality || "high");
const QUERY = `qa=1&quality=${QUALITY}&time=${TIME_KEY}&cycle=0&intro=0`
  + (args.seed ? `&seed=${encodeURIComponent(args.seed)}` : "");

/* Bounds. Nothing in this harness is allowed to wait forever: a
   gallery that hangs at 3am is indistinguishable from a gallery that
   is still working, and both block the round. */
const BOOT_MS = 300000;
const SHOT_MS = 120000;
const RUN_MS = Number(args.runbudget || 45 * 60 * 1000);

/* ============================================================
   THE CAST

   Each entry owns three things and nothing else: how to get the
   fight live (`arm`), how to read its phase (`phase`), and the five
   poses the framings need. The framings themselves - the lens, the
   distance, the bearing search - live once, below, or the six shots
   stop being the same six shots.

   Setups are stringified and evaluated IN THE PAGE. Nothing from
   this module's scope travels with them; they get `T` (window.__SF)
   and `G` (the gallery helper installed below) and may use nothing
   else.
   ============================================================ */
const BOSSES = {
  winnower: {
    label: "The Winnower", district: "Censer Works",
    arm: (T) => {
      T.teleportToWinnower(70);
      T.advanceToWinnowerPhase("soar", 60);
      T.advanceTime(0.6, 1 / 60);
    },
    phase: (T) => T.winnowerState(),
    /* Grounded for the poses that are about shape. The animal spends
       most of its cycle at altitude, and an airborne silhouette
       photographed against sky reads as an aircraft - the insect is
       only legible with six legs on sand under it.

       Every transition here is NATURAL, and that is not fastidiousness.
       `forceWinnowerPhase("land")` skips the perch selection that
       `stepLand` dereferences on its very next frame, and the null
       takes the whole page down - the first run of this gallery died
       there, twice, with a stack trace pointing at winnower.js and
       nothing wrong with winnower.js. The lift pool is the door the
       fight itself uses. */
    pose: (T, G) => {
      for (let i = 0; i < 60; i += 1) T.drainWinnowerLift(1, i % 3);
      const down = G.until(() => T.winnowerState()?.grounded, 30);
      T.advanceTime(0.5, 1 / 60);
      return down ? null : "never came down; photographed airborne";
    },
    telegraph: (T, G) => {
      // Stoking the censers: the furnace winding up is the only
      // warning a player gets before the strafing run. It has to be
      // back in the air first, and it gets there on its own clock.
      G.until(() => !T.winnowerState()?.grounded, 45);
      const got = G.until(() => T.winnowerState()?.phase === "stoke", 40);
      return got ? null : "never reached stoke inside 40s";
    },
    impact: (T, G) => {
      const got = G.until(() => T.winnowerState()?.phase === "strafe", 40);
      G.until(() => T.ashFields().length > 0, 10);
      T.advanceTime(0.18, 1 / 60);
      return got ? null : "never reached the strafing run inside 40s";
    },
    hurt: (T, G) => {
      G.damageTo("winnower", 0.15);
      for (let i = 0; i < 60; i += 1) T.drainWinnowerLift(1, i % 3);
      G.until(() => T.winnowerState()?.grounded, 30);
      T.advanceTime(0.7, 1 / 60);
    },
  },

  distaff: {
    label: "The Distaff", district: "Glass Scar",
    arm: (T) => {
      T.teleportToDistaff(46);
      if (T.advanceToDistaffPhase("standing", 40) < 0) T.forceDistaffPhase("standing", 20);
      T.advanceTime(0.5, 1 / 60);
    },
    phase: (T) => T.distaffState(),
    pose: (T) => {
      T.forceDistaffPhase("standing", 25);
      T.advanceTime(0.7, 1 / 60);
    },
    telegraph: (T, G) => {
      /* The lunge is not forceable - there is no hook for it - so it
         is WAITED FOR, bounded, and the frame taken the instant the
         commit flag goes up. That is the windup; a fixed offset into
         it photographs whatever the gait happened to be doing. */
      const got = G.until(() => T.distaffState()?.lunging, 14);
      return got ? null : "no lunge inside 14s; showing the alert stance";
    },
    impact: (T, G) => {
      G.until(() => !T.distaffState()?.lunging, 2.5);
      T.advanceTime(0.06, 1 / 60);
      const p = T.playerState();
      T.spillWeb(p.x, p.z, 5.5, 6);
      T.advanceTime(0.25, 1 / 60);
    },
    hurt: (T, G) => {
      // Broken through combat.damageLeg, the same call a shot makes,
      // so the stumps are the ones the fight produces.
      for (const i of [0, 2, 5]) T.breakDistaffLeg(i);
      G.damageTo("distaff", 0.15);
      T.forceDistaffPhase("collapsed", 8);
      T.advanceTime(1.1, 1 / 60);
    },
  },

  garner: {
    label: "The Garner", district: "The Ossuary",
    arm: (T) => {
      T.teleportToGarner(48);
      T.advanceToGarnerPhase("feeding", 30);
      T.advanceTime(0.4, 1 / 60);
    },
    phase: (T) => T.garnerState(),
    pose: (T) => {
      T.resetGarner();
      T.forceGarnerPhase("feeding");
      T.advanceTime(0.6, 1 / 60);
    },
    telegraph: (T) => {
      /* The limbs surface next to WHOEVER IS STANDING THERE, not out
         of the pit, so a photograph of a raised limb is a photograph
         of wherever the trooper is. Park them on the near rim first
         or the animal reaches into empty desert off-frame. */
      const c = T.garner.config;
      T._teleportRaw(c.pitX - 19, c.pitZ - 15, 0);
      T.advanceTime(1 / 60, 1 / 60);
      for (let i = 2; i < 5; i += 1) T.forceGarnerLash(i);
      T.advanceTime(0.95, 1 / 60);
    },
    impact: (T) => { T.advanceTime(0.7, 1 / 60); },
    hurt: (T, G) => {
      for (const i of [0, 1, 3]) T.breakGarnerArm(i);
      G.damageTo("garner", 0.15);
      T.forceGarnerPhase("gorge", 11);
      T.advanceTime(1.7, 1 / 60);
    },
  },

  abbess: {
    label: "The Abbess", district: "The Bloom",
    arm: (T) => {
      T.teleportToAbbess(44);
      T.advanceToAbbessPhase("seated", 30);
      T.advanceTime(0.5, 1 / 60);
    },
    phase: (T) => T.abbessState(),
    pose: (T) => {
      T.forceAbbessPhase("seated", 20);
      T.advanceTime(0.6, 1 / 60);
    },
    telegraph: (T, G) => {
      // Abdomen up and held: the warning and the invitation are the
      // same pose, which is the whole of her design.
      T.forceAbbessSlam();
      const got = G.until(() => T.abbessState()?.slamPhase === "hold", 4);
      return got ? null : "slam never reached hold; showing the rise";
    },
    impact: (T, G) => {
      G.until(() => !T.abbessState()?.slamPhase, 3);
      T.advanceTime(0.07, 1 / 60);
    },
    hurt: (T, G) => {
      T.forceAbbessClutch();
      G.damageTo("abbess", 0.15);
      // She changes phase on a health threshold, so the frame is
      // taken after she has had a chance to react to the wound.
      T.advanceTime(1.4, 1 / 60);
    },
  },

  stylite: {
    label: "The Stylite", district: "Choir Spires",
    arm: (T) => {
      T.teleportToStylite(54);
      T.advanceToStylitePhase("perched", 20);
      T.advanceTime(1.2, 1 / 60);
    },
    phase: (T) => T.styliteState(),
    pose: (T) => {
      T.resetStylite();
      T.teleportToStylite(54);
      T.advanceToStylitePhase("perched", 20);
      T.advanceTime(1.0, 1 / 60);
    },
    telegraph: (T, G) => {
      /* Caught on the way down, POLLED rather than timed: the stoop
         is longer from a taller needle and which crown it is on is
         seeded, so any hard-coded duration photographs a different
         part of the drop every time the world changes. */
      T.advanceToStylitePhase("perched", 12);
      T.forceStyliteStoop();
      const top = T.styliteState().y;
      G.until(() => {
        const s = T.styliteState();
        return s.phase !== "stoop" || s.y < top - 24;
      }, 8);
    },
    impact: (T, G) => {
      G.until(() => T.styliteState()?.grounded, 6);
      T.advanceTime(0.22, 1 / 60);
    },
    hurt: (T, G) => {
      T.forceStyliteFall();
      G.until(() => T.styliteState()?.grounded, 8);
      G.damageTo("stylite", 0.15);
      T.advanceTime(0.9, 1 / 60);
    },
  },

  coulter: {
    label: "The Coulter", district: "The Fallen Saint",
    /* Gated on the mission, not on proximity: the Saint's burrower
       only exists once every district boss is done, so the gate is
       ARMED through mission.completeDistrictBoss rather than by
       writing a phase - the spawn, the arena and the hazards all
       hang off that transition. */
    arm: (T, G) => {
      const M = T.ctx.mission;
      for (const boss of M.bosses.filter((b) => b.stage !== "penultimate")) {
        if (!boss.done) M.completeDistrictBoss(boss.key);
      }
      T.advanceTime(0.4, 1 / 60);
      const inst = T.ctx.enemies.live.find((e) => e.eventId === "district-boss:saint");
      if (!inst) return "the Coulter never spawned";
      // Clear of it, and inside its 285m arena, or the boundary check
      // resets the fight while the photograph is being taken.
      T.player.spawn(inst.x, inst.z + 62, Math.PI);
      T.advanceTime(2.4, 1 / 60);
      G.until(() => T.coulterState()?.phase === "crest", 40);
      return null;
    },
    phase: (T) => T.coulterState(),
    pose: (T, G) => {
      // Reared. It is only an animal above the sand; the burrowed
      // phase is a photograph of a ridge in a dune.
      if (T.coulterState()?.phase !== "crest") {
        G.until(() => T.coulterState()?.phase === "crest", 40);
      }
      T.advanceTime(0.5, 1 / 60);
    },
    telegraph: (T, G) => {
      G.until(() => T.coulterState()?.phase === "crest", 40);
      // The maw opening IS the telegraph, and it is the frame the
      // weak point goes live on.
      const got = G.until(() => (T.coulterBodies()[0]?.mawOpen || 0) > 0.35, 8);
      return got ? null : "maw never opened inside 8s";
    },
    impact: (T, G) => {
      G.until(() => T.venomPools().length > 0, 8);
      if (!T.venomPools().length) {
        const p = T.playerState();
        T.spillVenom(p.x + 3, p.z - 6, 6, 8);
      }
      T.advanceTime(0.3, 1 / 60);
    },
    hurt: (T, G) => {
      G.damageTo("coulter", 0.15);
      G.until(() => T.coulterState()?.phase === "crest", 40);
      T.advanceTime(0.5, 1 / 60);
    },
  },

  matriarch: {
    label: "The Matriarch", district: "The Gilded Reach",
    /* No bespoke controller: she is a district-boss record driven by
       the shared enemy AI, so she is armed by spawning the site and
       then letting proximity do the rest - the same path the game
       takes. Forcing her `active` by hand skips the reveal that
       makes her stand up. */
    arm: (T, G) => {
      const D = T.ctx.districtBosses;
      const inst = D.ensureSpawned("reach");
      if (!inst) return "the Matriarch never spawned";
      T._teleportRaw(inst.x - 26, inst.z + 8, 0);
      T.advanceTime(0.3, 1 / 60);
      G.until(() => D.status("reach")?.phase === "active", 20);
      T.advanceTime(0.8, 1 / 60);
      return D.status("reach")?.phase === "active"
        ? null : "she never left dormant";
    },
    phase: (T) => T.ctx.districtBosses.status("reach"),
    pose: (T) => { T.advanceTime(0.6, 1 / 60); },
    telegraph: (T, G) => {
      /* Waited for rather than frozen. `freezeEnemyClip` gives a
         clean pose but it is a pose with no fight around it - no
         charge, no dust, no committed footing - and the framing this
         slot is for is "the pose a player has to answer". The frozen
         clip is the fallback, and it is reported as one. */
      const idx = G.liveIndex("matriarch");
      const got = G.until(() => G.inst("matriarch")?.current === "strike", 16);
      if (got) return null;
      T.freezeEnemyClip("strike", 0.24, idx);
      return "no live strike inside 16s; clip frozen at 0.24s";
    },
    impact: (T, G) => {
      const idx = G.liveIndex("matriarch");
      if (G.inst("matriarch")?.current === "strike") T.advanceTime(0.34, 1 / 60);
      else T.freezeEnemyClip("strike", 0.62, idx);
    },
    hurt: (T, G) => {
      G.damageTo("matriarch", 0.15);
      T.freezeEnemyClip("flinch", 0.30, G.liveIndex("matriarch"));
    },
  },

  apostate: {
    label: "The Apostate", district: "The Vault-Cathedral",
    arm: (T, G) => {
      T.armApostateFight();
      T.teleportToApostate(24);
      if (T.advanceToApostatePhase("duel", 20) < 0) {
        /* The mission gate is only half of it: the reveal is
           proximity-gated on top, and a dormant Apostate is
           `encounterHidden`, which clears its root. Armed by mission
           alone the first two framings photographed an empty nave and
           the last four worked - because `forceApostateAction` opens
           the reveal on its way in, so the harness was accidentally
           revealing the boss with an attack. Open it through the
           encounter's own door instead. */
        T.apostate.beginReveal();
        G.until(() => T.apostateState().phase === "duel", 20);
      }
      T.advanceTime(0.5, 1 / 60);
      return T.apostateState().phase === "duel" ? null
        : `never reached the duel (stuck at ${T.apostateState().phase})`;
    },
    phase: (T) => T.apostateState(),
    pose: (T) => { T.advanceTime(0.5, 1 / 60); },
    telegraph: (T, G) => {
      /* The action's own declared duration, read back from the
         encounter rather than restated here: the windup fraction has
         to follow a retune of the lance instead of quietly becoming
         the recovery frame. */
      T.forceApostateAction("ranged");
      const total = T.apostateState().actionFor;
      G.advance(total * 0.34);
      return null;
    },
    impact: (T, G) => {
      T.forceApostateAction("ranged");
      const total = T.apostateState().actionFor;
      G.advance(total * 0.78);
      return null;
    },
    hurt: (T, G) => {
      G.damageTo("apostate", 0.15);
      T.forceApostateAction("vent");
      G.advance(0.6);
    },
  },
};

/* ============================================================
   THE SIX FRAMINGS

   `fill` is the fraction of FRAME HEIGHT the animal's projected box
   must occupy; the placer solves distance for it against the real
   projection matrix. `pitch` is the camera's elevation above the aim
   point in degrees; `yaw` is degrees off the boss-to-player bearing,
   which is used instead of the model's own yaw because the forward
   axis differs between the rigs and a player-relative bearing is
   three-quarter-front for all of them as long as the fight is live.
   ============================================================ */
const FRAMINGS = [
  {
    name: "01-portrait", pose: "pose", fill: 0.60, pitch: 8, yaw: 38, fov: 42,
    /* Low, because the background is the point. At any real pitch
       the frame behind a boss is sand; at eight degrees it is the
       district's own skyline, which is what the blind test is
       actually comparing. */
    intent: "three-quarter, boss at ~60% of frame height, district behind",
  },
  {
    name: "02-full", pose: "pose", fill: 0.72, pitch: 13, yaw: 62, fov: 46,
    trooper: true,
    intent: "whole animal at fighting distance, grounded, with the trooper for scale",
  },
  {
    name: "03-telegraph", pose: "telegraph", fill: 0.66, pitch: 11, yaw: 34, fov: 50,
    intent: "mid-windup on the signature attack",
  },
  {
    name: "04-impact", pose: "impact", fill: 0.62, pitch: 10, yaw: 30, fov: 55,
    intent: "the frame the attack lands on",
  },
  {
    name: "05-hurt", pose: "hurt", fill: 0.66, pitch: 14, yaw: 46, fov: 48,
    intent: "late phase, damaged",
  },
  {
    name: "06-silhouette", pose: "pose", fill: 0.45, pitch: 6, yaw: 74,
    /* Distance is PINNED at 120m and the lens is solved for it,
       rather than the other way round. "Readable at 120 metres" is a
       question about shape at that foreshortening; asking it of the
       eleven pixels a real 120m frame would give is not a test, it
       is a coin toss. */
    distance: 120, silhouette: true,
    intent: "flat white on black at 120m: readable as WHICH boss",
  },
];

/* ============================================================
   THE PAGE-SIDE HELPER

   Installed once per load. Everything that needs three, the scene
   graph or the projection matrix lives here; the node side only
   orchestrates and measures pixels.
   ============================================================ */
function installGallery() {
  const T = window.__SF;
  const THREE = T.THREE;
  /* A SCRATCH camera does the framing arithmetic. Solving the
     distance by moving the real one costs a `lookAt` per iteration,
     and `lookAt` steps the world 1/60s - three refinement passes
     drift a mid-attack animal 50ms out of the pose the shot is
     about, which is exactly the frame the framing was solved for. */
  const scratch = new THREE.PerspectiveCamera(50, 16 / 9, 0.4, 6000);
  const ray = new THREE.Raycaster();
  const v = new THREE.Vector3();

  const G = {
    notes: [],

    /* ---------------- who the subject IS ---------------- */

    /**
     * The objects that ARE the animal, per boss.
     *
     * There is no uniform answer and assuming one is how this
     * harness spent its first run photographing nothing:
     *
     *   - the Winnower, Distaff, Matriarch and Coulter are ordinary
     *     rigged instances, and their geometry hangs off `inst.root`;
     *   - the Stylite, the Abbess and the Garner are procedural.
     *     Their instance root is an EMPTY group - it exists so the
     *     rest of the game has something to aggro and damage - and
     *     every vertex lives in the module's own scene-level group;
     *   - the Apostate is a corrupted clone of the player figure and
     *     never enters `enemies.live` at all.
     *
     * And a module group is not the animal either. `stylite` also
     * holds its bolts, `garner` holds the crater and the shaft it
     * sits in, and `abbess` holds her clutch - all of which would
     * inflate the box and pull the lens back off the subject.
     */
    roots(key) {
      const pick = (group, names) => (group
        ? names.map((n) => group.getObjectByName(n)).filter(Boolean) : []);
      if (key === "stylite") {
        const body = pick(T.ctx.stylite && T.ctx.stylite.group, ["sf-stylite-body"]);
        if (body.length) return body;
      }
      if (key === "abbess") {
        // Head and abdomen. NOT `sf-abbess-eggs`: a clutch laid
        // fifteen metres away is hers, but it is not her.
        const body = pick(T.ctx.abbess && T.ctx.abbess.group,
          ["sf-abbess-sac", "sf-abbess-head"]);
        if (body.length) return body;
      }
      if (key === "garner") {
        // The mouth and the limbs. The crater, the shaft and the
        // throat floor are the hole it lives in - they are carved
        // into the pan and framing on them photographs a landscape.
        const body = pick(T.ctx.garner && T.ctx.garner.group,
          ["sf-garner-maw", "sf-garner-arms"]);
        if (body.length) return body;
      }
      if (key === "apostate") {
        const inst = T.apostate && T.apostate.instance && T.apostate.instance();
        return inst && inst.root ? [inst.root] : [];
      }
      return T.enemies.live
        .filter((e) => e.key === key && e.state !== "death" && e.root)
        .map((e) => e.root);
    },

    inst(key) {
      if (key === "apostate") {
        return (T.apostate && T.apostate.instance && T.apostate.instance()) || null;
      }
      if (key === "garner") {
        return T.enemies.live.find((e) => e.key === "garner") || null;
      }
      return T.enemies.live.find((e) => e.key === key && e.state !== "death") || null;
    },

    liveIndex(key) { return T.enemies.live.findIndex((e) => e.key === key); },

    /* ---------------- bounded stepping ---------------- */

    advance(seconds) { T.advanceTime(Math.max(1 / 60, seconds), 1 / 60); return true; },

    /** Step until `test` is true or `limit` seconds have passed.
     *  Returns whether it came true. Every wait in this harness goes
     *  through here so none of them can be unbounded. */
    until(test, limit) {
      const steps = Math.max(1, Math.round(limit * 60));
      for (let i = 0; i < steps; i += 1) {
        let ok = false;
        try { ok = !!test(); } catch (_) { ok = false; }
        if (ok) return true;
        T.advanceTime(1 / 60, 1 / 60);
      }
      try { return !!test(); } catch (_) { return false; }
    },

    /** Wound it down to a fraction of its pool through combat's own
     *  entry, so shells that break, plates that stay broken and any
     *  health-gated phase change all happen the way the fight does
     *  them. A boss with an incoming-damage modifier (the Apostate's
     *  aegis) can refuse the hit; the loop notices that it stopped
     *  moving rather than spinning on it. */
    damageTo(key, fraction) {
      const inst = G.inst(key);
      if (!inst) return null;
      const want = Math.max(1, inst.maxHealth * fraction);
      for (let i = 0; i < 24 && inst.health > want; i += 1) {
        const before = inst.health;
        T.ctx.combat.damageEnemy(inst, Math.max(25, inst.health - want),
          { source: "gallery" });
        if (inst.health >= before) break;
      }
      /* A death here would photograph a corpse in the slot that is
         supposed to show WEAR. Damage multipliers are per hit zone
         and can overshoot, so the floor is restored directly - this
         is the one place in the harness that writes a pool, and it
         writes it only to undo an overshoot. */
      if (inst.health <= 1) inst.health = want;
      T.advanceTime(0.2, 1 / 60);
      return { health: Math.round(inst.health), maxHealth: Math.round(inst.maxHealth) };
    },

    /* ---------------- measuring the subject ---------------- */

    /**
     * The animal's world-space extent, walked off its posed vertices.
     *
     * NOT `Box3.setFromObject`. On a SkinnedMesh three computes the
     * box from vertices that already carry the bone chain's world
     * scale and then applies the mesh's world matrix on top, and the
     * numbers come back 40%-180% high depending on the rig. Every
     * camera in this file is solved from these six numbers, so a box
     * that is 80% too big is a gallery shot from 80% too far away.
     */
    measure(key) {
      const roots = G.roots(key);
      const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
      const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      /* A decimated point cloud is kept as well as the box, and the
         framing is solved against the CLOUD. Projecting the eight
         corners of an axis-aligned box is projecting mostly empty
         air: a sprawled Stylite measures 26m across its diagonal and
         eleven tall, and its box corners land two hundred pixels
         above and below anything that is actually drawn. Framed off
         the corners the animal came out at half the size the framing
         asked for while the harness reported it dead on. */
      const cloud = [];
      let sampled = 0;
      let buried = 0;
      for (const r of roots) {
        let chainVisible = true;
        for (let n = r; n; n = n.parent) if (!n.visible) chainVisible = false;
        if (!chainVisible) continue;
        r.updateWorldMatrix(true, true);
        r.traverseVisible((o) => {
          if (!o.isMesh && !o.isSkinnedMesh) return;
          /* Ground decals, hazard patches and scorches are the
             animal's LEAVINGS, not the animal. A venom pool thirty
             metres downrange doubles the box and pulls the lens back
             until the boss is a detail in a photograph of sand. */
          if (o.name && /pool|patch|field|scorch|decal|wake|ember|shard/i.test(o.name)) return;
          const pos = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
          if (!pos || !pos.count) return;
          const stride = Math.max(1, Math.floor(pos.count / 700));
          for (let i = 0; i < pos.count; i += stride) {
            if (o.isSkinnedMesh) o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
            else { v.fromBufferAttribute(pos, i); v.applyMatrix4(o.matrixWorld); }
            if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) continue;
            sampled += 1;
            /* UNDER THE SAND IS NOT PART OF THE PHOTOGRAPH.
               The Coulter is a burrower: reared and mid-fight, a third
               of its length is still below the height field, by
               design. Those vertices are visible from NO camera, and
               counting them broke this harness twice over. The
               sightline score capped at six probes out of nine - 0.67,
               the number the gate saw - so no candidate ever reached
               the 0.92 the search wants and four of six Coulter frames
               fell through to "best effort bearing" on every run. And
               the box they inflate is what the distance solve fits to,
               so the animal above the sand was framed smaller than the
               framing asked for while the harness reported it dead on.
               A pit boss is unaffected: the Garner's maw sits below the
               PAN but above GARNER_PIT's carved floor, which is what
               `heightAt` returns there. */
            if (v.y < T.ctx.terrain.heightAt(v.x, v.z) - 0.35) { buried += 1; continue; }
            lo.min(v); hi.max(v);
            cloud.push(v.x, v.y, v.z);
          }
        });
      }
      if (!sampled) return null;
      /* ...unless it is ALL under the sand. A fully burrowed Coulter
         has no photographable vertex, and an empty cloud would divide
         by zero in the sightline score and hand the placer a NaN
         camera. Keep the whole set, and say so: a caller that gets
         `buriedAll` is looking at an animal that is not out yet. */
      const buriedAll = cloud.length === 0;
      if (buriedAll) {
        for (const r of roots) {
          r.traverseVisible((o) => {
            if (!o.isMesh && !o.isSkinnedMesh) return;
            if (o.name && /pool|patch|field|scorch|decal|wake|ember|shard/i.test(o.name)) return;
            const pos = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
            if (!pos || !pos.count) return;
            const stride = Math.max(1, Math.floor(pos.count / 700));
            for (let i = 0; i < pos.count; i += stride) {
              if (o.isSkinnedMesh) o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
              else { v.fromBufferAttribute(pos, i); v.applyMatrix4(o.matrixWorld); }
              if (!Number.isFinite(v.x)) continue;
              lo.min(v); hi.max(v);
              cloud.push(v.x, v.y, v.z);
            }
          });
        }
      }
      if (!cloud.length) return null;
      // Thinned to a fixed budget so the projection cost does not
      // depend on which boss is in front of the lens.
      const step = Math.max(1, Math.ceil(cloud.length / 3 / 700));
      const thin = [];
      for (let i = 0; i < cloud.length; i += step * 3) {
        thin.push(cloud[i], cloud[i + 1], cloud[i + 2]);
      }
      return {
        lo: [lo.x, lo.y, lo.z],
        hi: [hi.x, hi.y, hi.z],
        centre: [(lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2],
        size: [hi.x - lo.x, hi.y - lo.y, hi.z - lo.z],
        cloud: thin,
        sampled,
        buried,
        buriedAll,
      };
    },

    /** The subject box's footprint on screen, in fractions of the
     *  frame, for a camera that has not been moved yet. */
    _project(box, pos, target, fov) {
      scratch.fov = fov;
      scratch.aspect = T.render.camera.aspect;
      scratch.position.set(pos[0], pos[1], pos[2]);
      scratch.up.set(0, 1, 0);
      scratch.lookAt(target[0], target[1], target[2]);
      scratch.updateMatrixWorld(true);
      scratch.updateProjectionMatrix();
      return G._ndcBox(box, scratch);
    },

    _ndcBox(box, cam) {
      let u0 = Infinity; let u1 = -Infinity;
      let v0 = Infinity; let v1 = -Infinity;
      let behind = 0;
      const c = box.cloud;
      for (let i = 0; i < c.length; i += 3) {
        v.set(c[i], c[i + 1], c[i + 2]);
        const p = v.project(cam);
        // Behind the lens: `project` mirrors those points to the far
        // side of the frame, so counting them is the only way to
        // notice that the "framed" subject is at the camera's back.
        if (p.z > 1) { behind += 1; continue; }
        u0 = Math.min(u0, p.x); u1 = Math.max(u1, p.x);
        v0 = Math.min(v0, p.y); v1 = Math.max(v1, p.y);
      }
      if (!Number.isFinite(u0)) {
        return { u: [0, 0], v: [0, 0], fillH: 0, fillW: 0, centreU: 0, centreV: 0,
          behind, onScreen: false };
      }
      return {
        u: [u0, u1], v: [v0, v1],
        // NDC spans -1..1, so a full frame is 2 units tall.
        fillH: (v1 - v0) / 2, fillW: (u1 - u0) / 2,
        centreU: (u0 + u1) / 2, centreV: (v0 + v1) / 2,
        behind,
        onScreen: behind * 3 < c.length * 0.02
          && u1 > -1 && u0 < 1 && v1 > -1 && v0 < 1,
      };
    },

    /* ---------------- choosing where to stand ---------------- */

    /** Is the sightline from `pos` to `target` clear of the height
     *  field? Marched analytically rather than raycast: the terrain
     *  is a large mesh with no acceleration structure and sixty
     *  candidate raycasts against it cost seconds per shot. */
    _groundClear(pos, target) {
      for (let t = 0.06; t <= 0.94; t += 0.06) {
        const x = pos[0] + (target[0] - pos[0]) * t;
        const y = pos[1] + (target[1] - pos[1]) * t;
        const z = pos[2] + (target[2] - pos[2]) * t;
        if (y < T.ctx.terrain.heightAt(x, z) + 0.6) return false;
      }
      return true;
    },

    /**
     * What fraction of the animal a lens at `pos` can actually SEE.
     *
     * The difference between this and "is it inside the frustum" is
     * the whole reason it exists. The Garner's mouth sits nine metres
     * below the pan; framed at eight degrees of elevation it was
     * dead centre of frame, at exactly the requested 59% of frame
     * height, fully on screen by every projection test - and the
     * photograph was a dune. A subject can be perfectly composed and
     * behind a hill, and only a sightline says so.
     */
    visibleFraction(pos, points, useWorld) {
      let seen = 0;
      for (const p of points) {
        if (!G._groundClear(pos, p)) continue;
        // Rationed: see `_worldClear`. Off by default so the bearing
        // search can score ninety-six candidates for nothing.
        if (useWorld && !G._worldClear(pos, p)) continue;
        seen += 1;
      }
      return points.length ? seen / points.length : 0;
    },

    /** Nine points spread through the animal, for the sightline
     *  score. Sampled off the cloud so they are on the creature
     *  rather than on the corners of the air around it. */
    _probePoints(box) {
      const c = box.cloud;
      const n = c.length / 3;
      const out = [box.centre];
      const want = 8;
      for (let i = 0; i < want; i += 1) {
        const k = Math.floor((i + 0.5) * n / want) * 3;
        out.push([c[k], c[k + 1], c[k + 2]]);
      }
      return out;
    },

    /** ...and clear of the BUILT geometry. This one is a raycast,
     *  because the collision grid ignores anything above head height
     *  by design and cheerfully reports clear sight through the top
     *  of a cathedral. Rationed: only candidates that already passed
     *  the height field get to spend one. */
    _worldClear(pos, target, reach = 0.97) {
      const o = new THREE.Vector3(pos[0], pos[1], pos[2]);
      const d = new THREE.Vector3(target[0] - pos[0], target[1] - pos[1],
        target[2] - pos[2]);
      const len = d.length();
      if (len < 0.001) return true;
      ray.set(o, d.divideScalar(len));
      /* `reach` was 0.9, which threw away the last tenth of the path -
         and the last tenth is precisely where a Stylite's own needle
         sits, because the animal is GRIPPING it. The subject is not in
         `world.group`, so there is nothing to self-hit; the margin
         only has to clear floating-point coincidence at the endpoint. */
      ray.far = len * reach;
      return ray.intersectObject(T.world.group, true).length === 0;
    },

    /**
     * The projected extent of the part of the animal the lens can
     * ACTUALLY SEE, and the fraction of it that is.
     *
     * `_ndcBox` projects the whole cloud, which is the right answer to
     * "how big would this animal be on screen" and the wrong answer to
     * "how big is it in this photograph". The Stylite's 02-full frame
     * measured 0.709 against a target of 0.72 - nominally perfect -
     * with a Choir needle standing down the middle of the animal and
     * half of it behind the rock. Both the fill and the 1.00 sightline
     * score were computed off geometry that is not in the picture.
     *
     * Rationed, because a ray against `world.group` is 541k
     * unaccelerated triangles and costs ~8.5 ms. A stratified sample
     * of the cloud is a sample and is reported as one: `samples` says
     * how many, so nobody reads three decimal places into it.
     */
    _visibleNdcBox(box, cam, pos, budget) {
      const c = box.cloud;
      const n = Math.floor(c.length / 3);
      const take = Math.max(1, Math.min(budget, n));
      const all = [];
      const vis = [];
      for (let i = 0; i < take; i += 1) {
        const k = Math.floor((i + 0.5) * n / take) * 3;
        const p = [c[k], c[k + 1], c[k + 2]];
        all.push(p[0], p[1], p[2]);
        if (G._groundClear(pos, p) && G._worldClear(pos, p)) vis.push(p[0], p[1], p[2]);
      }
      const sampledAll = G._ndcBox({ cloud: all }, cam);
      const shown = vis.length ? G._ndcBox({ cloud: vis }, cam) : sampledAll;
      return {
        ...shown,
        samples: take,
        visibleSamples: vis.length / 3,
        /* The same sample projected WITHOUT the occlusion test. The
           gap between this and `fillH` is occlusion; the gap between
           this and the full-cloud box is the sampling. Printing both
           is what stops "the fill dropped" being blamed on the sample
           size. */
        sampledAllFillH: sampledAll.fillH,
        sampledAllFillW: sampledAll.fillW,
      };
    },

    /** The bearing from the boss to the trooper. The rigs disagree
     *  about which way their own +Z faces, so a "three-quarter front"
     *  built on `inst.yaw` is three-quarter front for some of the
     *  cast and three-quarter ARSE for the rest. During a live fight
     *  the animal faces the player, so the player is the reliable
     *  front. */
    frontBearing(key, centre) {
      const p = T.playerState();
      const dx = p.x - centre[0];
      const dz = p.z - centre[2];
      if (Math.hypot(dx, dz) < 2) {
        const inst = G.inst(key);
        return inst ? inst.yaw || 0 : 0;
      }
      return Math.atan2(dx, dz);
    },

    /**
     * Place the lens. Returns everything the report needs to say
     * where this photograph was taken from.
     */
    place(key, spec) {
      const box = G.measure(key);
      if (!box) return { error: "no visible geometry for the subject" };
      const centre = box.centre.slice();
      /* The aim is the measured centre of the ANIMAL, never a fixed
         height above its feet. The cast runs from a two-metre
         Apostate to a hundred-metre burrower and a mouth nine metres
         below the sand; any constant here is right for one of them. */
      const aim = centre.slice();
      const base = G.frontBearing(key, centre);
      const fov = spec.fov || 45;
      const tanHalf = Math.tan((fov * Math.PI) / 360);

      /* First distance from the box, then refined against the real
         projection: a box that is long rather than tall, or one seen
         off-axis, projects nothing like its own dimensions.

         THE SEED MUST CLEAR THE ANIMAL, and seeding it off HEIGHT
         alone does not. The Garner's mouth is 43 m across and 16 m
         tall; a distance solved to make 16 m fill 62% of frame height
         is 25 m, which is INSIDE it. The refinement then measured a
         projection with half the cloud behind the lens, read it as
         "far too big", and pushed the camera out by an order of
         magnitude three times running - the impact framing came back
         at 52 kilometres. So the seed also has to satisfy the
         footprint against frame WIDTH, and the larger of the two
         wins. */
      const aspect = T.render.camera.aspect || 16 / 9;
      const tanHalfW = tanHalf * aspect;
      const span = Math.hypot(box.size[0], box.size[2]);
      let dist = spec.distance || Math.max(6,
        box.size[1] / (2 * Math.max(0.05, spec.fill) * tanHalf),
        span / (2 * (spec.fillW || 0.86) * tanHalfW));

      /* The bearing and the elevation are SCORED, not accepted on
         the first pass of a boolean. Taking the first candidate that
         cleared the centre line put the Garner's lens at eight
         degrees on the far side of a dune, and the fallback - "the
         first thing we tried" - was the worst position on the whole
         ladder. Every candidate is now scored by how much of the
         animal it can see, and the best one wins even when nothing
         is perfect. */
      const probes = G._probePoints(box);
      const bearings = [0, 14, -14, 28, -28, 44, -44, 62, -62, 84, -84,
        108, -108, 136, -136, 180];
      const pitches = [0, 9, 20, 33, 48, 64];

      /* PASS ONE, analytic and free: every candidate scored against
         the height field. */
      const candidates = [];
      for (const dp of pitches) {
        const pitch = ((spec.pitch || 10) + dp) * Math.PI / 180;
        for (const db of bearings) {
          const b = base + (spec.yaw || 0) * Math.PI / 180 + db * Math.PI / 180;
          const cx = aim[0] + Math.sin(b) * dist * Math.cos(pitch);
          const cz = aim[2] + Math.cos(b) * dist * Math.cos(pitch);
          let cy = aim[1] + dist * Math.sin(pitch);
          // Never below the sand it is standing on, whatever the
          // pitch says.
          cy = Math.max(cy, T.ctx.terrain.heightAt(cx, cz) + 2.2);
          const pos = [cx, cy, cz];
          const seen = G.visibleFraction(pos, probes);
          // Ties broken toward the requested elevation: a shot that
          // sees the same amount from lower is the shot that was asked
          // for.
          candidates.push({ pos, bearing: b, pitch: dp, seen,
            score: seen - dp * 0.0008 - Math.abs(db) * 0.0002 });
        }
      }
      candidates.sort((a, b2) => b2.score - a.score);

      /* PASS TWO, rationed: the ladder is walked IN SCORE ORDER and
         the survivors are re-tested against the built geometry.

         The old shape spent its three rays on the FIRST candidate that
         cleared the height field and then took it. For a boss standing
         on open sand that is fine; for one gripping a Choir needle it
         is the defect - three rays through the aim point and two
         probes cleared while the spire covered half the animal, and
         the harness recorded a clear sightline and a nominally correct
         fill for a photograph of a rock. Five probes per candidate
         over up to eight candidates costs the same order of rays and
         actually answers the question. */
      const rayProbes = [probes[0], probes[2], probes[4], probes[6], probes[8]];
      const RAY_BUDGET = 40;
      let tested = null;
      let rays = 0;
      for (const cand of candidates) {
        // Sorted, so once the height field alone is failing nothing
        // further down the list can pass.
        if (cand.seen < 0.92) break;
        if (rays + rayProbes.length > RAY_BUDGET) break;
        rays += rayProbes.length;
        cand.world = G.visibleFraction(cand.pos, rayProbes, true);
        // Strictly greater, so ties keep the earlier - and therefore
        // better-scoring - candidate and the requested pitch and
        // bearing still win when two positions see the same amount.
        if (!tested || cand.world > tested.world) tested = cand;
        if (cand.world >= 1) break;      // nothing further down can beat it
      }
      /* 0.8, not 0.92, because five probes cannot express 0.92: the
         only value above it is 5/5. Demanding a perfect five made the
         Stylite report "no clear sightline" on a frame that a 48-sample
         measure then scored at 0.94, which teaches a reader to ignore
         the warning - and a warning nobody reads is the same as the
         missing warning it replaced. One blocked probe in five is a
         usable frame, and the occlusion number below reports how much
         is actually behind something. */
      const view = tested && tested.world >= 0.8
        ? { ...tested, clear: true }
        : { ...(tested || candidates[0]), clear: false };

      /* Refine the distance against the actual projected footprint,
         which is what makes the same `fill` mean the same thing for
         a Matriarch and for a pit: the first pass corrects for the
         animal being seen at an angle, the rest for the footprint
         moving as the lens does, and it stops as soon as it is
         within 2%. Width is capped at 86% of frame as well as
         height, or a hundred-metre burrower framed to 60% of frame
         HEIGHT runs off both sides. */
      if (!spec.distance) {
        for (let pass = 0; pass < 3; pass += 1) {
          const p = G._project(box, view.pos, aim, fov);
          if (!(p.fillH > 0.001)) break;
          /* A projection with points behind the lens is not a
             projection of the subject, it is a projection of the half
             of it that is still in front - `project` mirrors the rest
             to the far side of the frame. Refining on that number is
             what compounds; the seed above is box-derived and sane, so
             stopping here leaves a usable camera instead of a
             kilometre count. */
          if (p.behind > 0) break;
          const raw = Math.max(p.fillH / spec.fill, p.fillW / (spec.fillW || 0.86));
          if (Math.abs(raw - 1) < 0.02) break;
          // Belt to the brace: no single pass may move the lens more
          // than fourfold, whatever the projection claims.
          const need = Math.min(4, Math.max(0.25, raw));
          const next = dist * need;
          const scale = next / dist;
          dist = next;
          view.pos = [
            aim[0] + (view.pos[0] - aim[0]) * scale,
            Math.max(aim[1] + (view.pos[1] - aim[1]) * scale,
              T.ctx.terrain.heightAt(view.pos[0], view.pos[2]) + 2.2),
            aim[2] + (view.pos[2] - aim[2]) * scale,
          ];
        }
      }

      /* The pinned-distance framings solve the LENS instead. */
      let finalFov = fov;
      if (spec.distance) {
        const p = G._project(box, view.pos, aim, fov);
        if (p.fillH > 0.001) {
          /* The ceiling has to be generous. A 5m Matriarch at a
             pinned 120m subtends about 7% of frame height at the
             starting lens, so a zoom capped at 3x lands at 25% and
             the harness cheerfully reports a framing it did not
             achieve. The real bound is the fov floor below. */
          const want = Math.max(0.05, Math.min(16, spec.fill / p.fillH));
          finalFov = Math.max(3.5, Math.min(75,
            (Math.atan(Math.tan((fov * Math.PI) / 360) / want) * 360) / Math.PI));
        }
      }

      /* `lookAt` steps the world; `setFree` + `renderStill` does not.
         The pose this shot is about must survive being photographed. */
      T.player.setFree(true, view.pos, aim, finalFov);
      for (let i = 0; i < 3; i += 1) T.renderStill();

      const shown = G._ndcBox(box, T.render.camera);
      /* Re-measured at the position the refinement actually settled
         on, not at the one the search scored - and off 48 stratified
         cloud samples rather than the 9 probes, because this is the
         number the report publishes and the hard occlusion gate reads.
         Built geometry is included here whatever the search could
         afford, so a frame can no longer claim 1.00 with a spire
         through the middle of the animal. */
      const seen = G._visibleNdcBox(box, T.render.camera, view.pos, 48);
      const visible = seen.samples ? seen.visibleSamples / seen.samples : 0;
      /* A RATIO ESTIMATE, not the sample's own extent. 48 stratified
         points span slightly less of the frame than the 700 the box
         carries - about a tenth - purely because they are fewer, and
         publishing the sample extent as the fill would have booked
         that sampling loss as occlusion on every boss in the cast. So
         the occlusion is measured as a RATIO on the sample, where the
         bias cancels, and applied to the exact full-cloud extent. With
         nothing in the way the two agree and `fillH` equals
         `fillHAll`, which is what a reader expects to see. */
      const clearRatio = seen.sampledAllFillH > 0.001
        ? Math.min(1, seen.fillH / seen.sampledAllFillH) : 1;
      const clearRatioW = seen.sampledAllFillW > 0.001
        ? Math.min(1, seen.fillW / seen.sampledAllFillW) : 1;
      return {
        camera: view.pos.map((n) => Number(n.toFixed(2))),
        visible: Number(visible.toFixed(2)),
        target: aim.map((n) => Number(n.toFixed(2))),
        fov: Number(finalFov.toFixed(2)),
        distance: Number(Math.hypot(view.pos[0] - aim[0], view.pos[1] - aim[1],
          view.pos[2] - aim[2]).toFixed(2)),
        bearingDeg: Number(((view.bearing * 180) / Math.PI).toFixed(1)),
        pitchBumpDeg: view.pitch,
        sightlineClear: !!view.clear,
        subject: {
          centre: box.centre.map((n) => Number(n.toFixed(2))),
          size: box.size.map((n) => Number(n.toFixed(2))),
          vertices: box.sampled,
          buriedVertices: box.buried || 0,
          buriedAll: !!box.buriedAll,
        },
        framed: {
          /* `fillH` is the VISIBLE extent - what is in the photograph.
             `fillHAll` is the whole animal's extent from this lens,
             kept beside it because the gap between them IS the
             occlusion and a reader needs both to tell "framed too
             small" from "photographed behind a rock". */
          fillH: Number((shown.fillH * clearRatio).toFixed(3)),
          fillW: Number((shown.fillW * clearRatioW).toFixed(3)),
          fillHAll: Number(shown.fillH.toFixed(3)),
          occlusion: Number((1 - clearRatio).toFixed(3)),
          occlusionSamples: seen.samples,
          centreU: Number(seen.centreU.toFixed(3)),
          centreV: Number(seen.centreV.toFixed(3)),
          onScreen: shown.onScreen,
        },
      };
    },

    /** Stand the trooper at the animal's near edge, on the camera
     *  side, so the scale frame has the 1.85m the whole cast is read
     *  against actually IN it. A boss is only big relative to
     *  something. */
    standTrooper(key, view) {
      const box = G.measure(key);
      if (!box) return null;
      const camera = view.camera;
      const dx = camera[0] - box.centre[0];
      const dz = camera[2] - box.centre[2];
      const len = Math.max(0.001, Math.hypot(dx, dz));
      const out = Math.max(box.size[0], box.size[2]) * 0.5 + 4;
      const x = box.centre[0] + (dx / len) * out;
      const z = box.centre[2] + (dz / len) * out;
      /* Only if they will actually be SEEN. The trooper stands on
         the sand; a Stylite is eighty metres up a needle and a
         Winnower is in the air, so for half the cast this position
         is off the bottom of the frame - and a scale reference that
         is not in the picture is a teleport that changed the fight
         for nothing. Checked before the teleport, not after. */
      const g = T.ctx.collide.groundHeight(x, z);
      const p = v.set(x, g + 1.0, z).project(T.render.camera);
      if (p.z > 1 || Math.abs(p.x) > 0.94 || Math.abs(p.y) > 0.94) return null;
      T.hidePlayer(false);
      T._teleportRaw(x, z, Math.atan2(box.centre[0] - x, box.centre[2] - z));
      /* `_teleportRaw` calls `player.setFree(false)` on the way in -
         it is a gameplay teleport, and a gameplay teleport hands the
         camera back to the chase rig. The first scale frame shot
         through this was a lovely photograph of the trooper's back
         with the boss forty metres behind the lens. Re-arm the free
         camera on exactly the placement the framing solved for. */
      T.player.setFree(true, view.camera, view.target, view.fov);
      for (let i = 0; i < 2; i += 1) T.renderStill();
      return [Number(x.toFixed(2)), Number(z.toFixed(2))];
    },

    /* ---------------- the silhouette ---------------- */

    /**
     * `silhouetteMode` was written to photograph the TROOPER: it
     * hides `enemies.group` wholesale and repaints the player figure.
     * Called as-is for a boss it produces a black rectangle, which is
     * a very convincing-looking regression. So it is used for what it
     * is genuinely good at - killing the world, the terrain, the sky
     * meshes and the background in one call - and the animal is
     * brought back through it by hand.
     */
    silhouetteOn(key) {
      T.clearVenom && T.clearVenom();
      T.clearWebs && T.clearWebs();
      T.clearAsh && T.clearAsh();
      T.hidePlayer(true);
      T.silhouetteMode(true);
      const roots = G.roots(key);
      /* `fog: false` and `toneMapped: false` are the whole shot.
         A MeshBasicMaterial still takes scene fog, and at the 120m
         this framing is taken from the far half of a boss fades to
         the fog colour - the Garner came back as white teeth on a
         BROWN funnel and read as a modelling fault. A silhouette has
         to be one value or the threshold that reads it is measuring
         depth. */
      const flat = new THREE.MeshBasicMaterial({
        color: 0xffffff, fog: false, toneMapped: false,
      });
      const saved = [];
      const groups = [];

      /* `silhouetteMode` hides the groups it knows about - world,
         terrain, sky, vfx, enemies - and every procedural boss puts
         its geometry in a group it has never heard of, hanging
         straight off the scene. So rather than name them, the scene
         is walked and everything that is not on a path TO the
         subject goes dark. That also solves the second half of the
         problem for free: the Stylite's bolts and the Abbess's
         clutch live in the same group as their owner, and a
         silhouette test whose answer is "one of these four shapes"
         is not a test. */
      const keep = new Set();
      const rootSet = new Set(roots);
      for (const r of roots) for (let n = r; n; n = n.parent) keep.add(n);
      const show = (node) => {
        if (node.visible) return;
        groups.push([node, node.visible]);
        node.visible = true;
      };
      const walk = (node) => {
        for (const child of node.children) {
          // Lights are not silhouettes and turning one off makes
          // three recompile every material in the scene.
          if (child.isLight || child.isCamera) continue;
          if (rootSet.has(child)) { show(child); continue; }
          if (keep.has(child)) { show(child); walk(child); continue; }
          if (child.visible) { groups.push([child, true]); child.visible = false; }
        }
      };
      walk(T.ctx.scene);

      /* `scene.overrideMaterial`, not a per-mesh swap.
         Assigning `o.material = flat` down the subject looks right,
         and reads back right, and the Garner still photographed with
         a brown collar under white teeth: something in the draw path
         puts its own material back at render time, and a silhouette
         instrument that can be quietly overruled by the thing it is
         measuring is not an instrument. The override cannot be. */
      for (const r of roots) {
        r.traverse((o) => {
          if (!o.isMesh && !o.isSkinnedMesh) return;
          saved.push([o, o.material, o.visible]);
          o.visible = true;
        });
      }
      G._override = T.ctx.scene.overrideMaterial;
      T.ctx.scene.overrideMaterial = flat;
      /* The belt to the walk's braces. The walk reasons about the
         scene GRAPH; this one checks the result. Anything still
         drawing that is not painted flat white is by definition not
         the subject, whichever group it turned out to be hanging
         off - and the Garner's first silhouette came back with a
         perfectly convincing brown funnel under white teeth, which
         would have thresholded into a mask of half an animal and
         been read as a modelling problem. */
      /* ANY object that carries a material, not just meshes: points,
         sprites and lines draw too, and one of them left in the
         frame is a shape the silhouette test will attribute to the
         animal. */
      const subject = new Set();
      for (const [o] of saved) subject.add(o);
      const strays = [];
      T.ctx.scene.traverseVisible((o) => {
        if (!o.material || subject.has(o)) return;
        groups.push([o, o.visible]);
        o.visible = false;
        strays.push(`${o.name || o.type}<${o.parent && (o.parent.name || o.parent.type)}>`);
      });
      G._silh = { saved, groups, flat };
      return { meshes: saved.length, strays };
    },

    /** Draw WITHOUT stepping, for the one frame where stepping is
     *  unsafe. `silhouetteMode` swaps the trooper's materials for a
     *  flat basic one, and the next simulation step walks into
     *  `jetpack.updateVisual` reaching for an `emissive` that no
     *  longer exists. `renderStill` is still a step; this is not. */
    drawStill() {
      T.render.render();
      return true;
    },

    silhouetteOff() {
      if (!G._silh) return false;
      T.ctx.scene.overrideMaterial = G._override || null;
      for (const [o, mat, vis] of G._silh.saved) { o.material = mat; o.visible = vis; }
      for (const [o, vis] of G._silh.groups) o.visible = vis;
      G._silh.flat.dispose();
      G._silh = null;
      T.silhouetteMode(false);
      return true;
    },

    _silh: null,
    _override: null,
  };

  window.__GAL = G;
  return { canvas: T.maximize(), aspect: T.render.camera.aspect };
}

/* ============================================================
   PIXELS

   Cheap objective numbers, computed off the written PNG. They do
   not decide whether a boss is good; they make it impossible for a
   round to darken the whole cast by four stops and have nobody
   notice until the blind test comes back confusing.
   ============================================================ */
async function measureImage(buffer) {
  const { data, info } = await sharp(buffer).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const stride = 2 * info.channels;
  let n = 0;
  let sumL = 0;
  let sumL2 = 0;
  let sumC = 0;
  let sumC2 = 0;
  let sinH = 0;
  let cosH = 0;
  const hist = new Uint32Array(256);
  for (let i = 0; i + info.channels <= data.length; i += stride) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    sumL += lum; sumL2 += lum * lum;
    sumC += chroma; sumC2 += chroma * chroma;
    hist[Math.min(255, Math.round(lum * 255))] += 1;
    if (chroma > 0.02) {
      let h = 0;
      if (max === r) h = ((g - b) / chroma + 6) % 6;
      else if (max === g) h = (b - r) / chroma + 2;
      else h = (r - g) / chroma + 4;
      const rad = (h * Math.PI) / 3;
      // Weighted by chroma: a near-grey pixel has a hue, but it is
      // noise, and a million of them drown the two hundred saturated
      // ones that decide whether the frame separates.
      sinH += Math.sin(rad) * chroma;
      cosH += Math.cos(rad) * chroma;
    }
    n += 1;
  }
  const meanL = sumL / n;
  const meanC = sumC / n;
  const pct = (p) => {
    const want = n * p;
    let seen = 0;
    for (let i = 0; i < 256; i += 1) {
      seen += hist[i];
      if (seen >= want) return i / 255;
    }
    return 1;
  };
  const resultant = Math.hypot(sinH, cosH) / Math.max(1e-6, sumC);
  return {
    width: info.width,
    height: info.height,
    meanLuminance: Number(meanL.toFixed(4)),
    rmsContrast: Number(Math.sqrt(Math.max(0, sumL2 / n - meanL * meanL)).toFixed(4)),
    luminanceP05: Number(pct(0.05).toFixed(4)),
    luminanceP95: Number(pct(0.95).toFixed(4)),
    meanChroma: Number(meanC.toFixed(4)),
    chromaSpread: Number(Math.sqrt(Math.max(0, sumC2 / n - meanC * meanC)).toFixed(4)),
    /* Circular spread of hue, chroma-weighted, in degrees. A frame
       where the boss, the sand and the sky are all the same orange
       lands near zero - which is the failure the brief calls out by
       name and which no luminance measure can see. */
    hueSpreadDeg: Number((Math.sqrt(Math.max(0, -2 * Math.log(
      Math.max(1e-6, Math.min(1, resultant))))) * 180 / Math.PI).toFixed(2)),
  };
}

/* ============================================================ */

function bail(message) {
  console.error(`\nFATAL  ${message}`);
  process.exitCode = 1;
}

const wanted = args.boss ? String(args.boss).split(",").map((s) => s.trim()) : Object.keys(BOSSES);
for (const key of wanted) {
  if (!BOSSES[key]) {
    bail(`unknown boss "${key}". Known: ${Object.keys(BOSSES).join(", ")}`);
    process.exit(1);
  }
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

const runTimer = setTimeout(() => {
  console.error(`\nFATAL  run budget of ${Math.round(RUN_MS / 1000)}s exhausted`);
  server.kill("SIGTERM");
  process.exit(2);
}, RUN_MS);
runTimer.unref?.();

/** Every await that touches the page is bounded, so a wedged boss
 *  fails with its own name attached instead of hanging the round. */
function bounded(label, promise, ms = SHOT_MS) {
  let timer = null;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
    }),
  ]);
}

const report = {
  harness: "saintfall-boss-gallery",
  generatedAt: new Date().toISOString(),
  url: `${BASE}/games/saintfall.html?${QUERY}`,
  viewport: [WIDTH, HEIGHT],
  time: TIME_KEY,
  quality: QUALITY,
  seed: null,
  build: null,
  framings: FRAMINGS.map((f) => ({ name: f.name, intent: f.intent, fill: f.fill })),
  bosses: {},
};
const failures = [];
let browser = null;

try {
  await mkdir(OUT, { recursive: true });
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  // Verbatim from the per-boss harnesses: this argument list is tuned
  // for this project and this machine, and swiftshader is the reason
  // the run works at all on a headless box.
  browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 200)));

  for (const key of wanted) {
    const boss = BOSSES[key];
    const entry = { label: boss.label, district: boss.district, shots: [], notes: [] };
    report.bosses[key] = entry;
    const dir = path.join(OUT, key);
    await mkdir(dir, { recursive: true });
    console.log(`\n=== ${boss.label} (${key}) ===`);
    const started = Date.now();

    try {
      pageErrors.length = 0;
      await bounded(`${key} load`, page.goto(`${BASE}/games/saintfall.html?${QUERY}`,
        { waitUntil: "domcontentloaded", timeout: 60000 }), 90000);
      await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: BOOT_MS });
      const stage = await page.evaluate(installGallery);
      await page.evaluate(() => {
        const T = window.__SF;
        document.getElementById("sf-boot")?.remove();
        T.hideHud(true);
        T.invulnerable(true);
        T.hidePlayer(true);
        // Belt and braces: hideHud drives the HUD's own visibility,
        // but the boss bar and the minimap are separate elements and
        // a stray one is a watermark across the blind test.
        document.querySelectorAll(".sf-hud, #sf-hud").forEach((el) => {
          el.style.visibility = "hidden";
        });
      });
      const world = await page.evaluate(() => ({
        seed: window.__SF.ctx.seed, build: window.__SF.version,
        time: window.__SF.atmos?.key || null,
      }));
      report.seed = world.seed;
      report.build = world.build;
      entry.canvas = stage.canvas;

      const armNote = await bounded(`${key} arm`,
        page.evaluate(`(${boss.arm.toString()})(window.__SF, window.__GAL)`));
      if (armNote) entry.notes.push(String(armNote));
      const armedPhase = await page.evaluate(`(${boss.phase.toString()})(window.__SF)`);
      if (!armedPhase) throw new Error(`${key} did not arm: no state readable`);
      console.log(`  armed at phase ${armedPhase.phase}`
        + ` (${armedPhase.health}/${armedPhase.maxHealth})`);

      for (const framing of FRAMINGS) {
        const label = `${key}/${framing.name}`;
        try {
          const setup = boss[framing.pose];
          const note = await bounded(`${label} setup`,
            page.evaluate(`(${setup.toString()})(window.__SF, window.__GAL)`));

          /* The lens is placed with the world still lit and the
             simulation still steppable, and only THEN is the
             silhouette switched on - see `drawStill` for why the
             order is not negotiable. */
          const view = await bounded(`${label} place`, page.evaluate(([k, spec]) =>
            window.__GAL.place(k, spec), [key, framing]));
          if (view.error) throw new Error(view.error);
          let silh = null;
          if (framing.silhouette) {
            silh = await page.evaluate((k) => window.__GAL.silhouetteOn(k), key);
          }
          if (framing.trooper) {
            // Placed AFTER the lens, because where the trooper stands
            // depends on which side the lens ended up on.
            const at = await page.evaluate(([k, v]) =>
              window.__GAL.standTrooper(k, v), [key, view]);
            entry.trooper = at || "out of frame; scale reference skipped";
          }

          const phase = await page.evaluate(`(${boss.phase.toString()})(window.__SF)`);
          const info = await page.evaluate(() => window.__SF.render.info());
          /* The drawing buffer, not `page.screenshot`. The screenshot
             API goes through the compositor, which only refreshes on
             a real animation frame - and headless chromium is giving
             us about one of those a second. */
          const dataUrl = await bounded(`${label} capture`, page.evaluate((silh) => {
            if (silh) window.__GAL.drawStill();
            else for (let i = 0; i < 2; i += 1) window.__SF.renderStill();
            return window.__SF.captureDataURL();
          }, !!framing.silhouette));
          if (framing.silhouette) await page.evaluate(() => window.__GAL.silhouetteOff());
          if (framing.trooper) await page.evaluate(() => window.__SF.hidePlayer(true));

          let png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
          const raw = await sharp(png).metadata();
          // Every gallery frame is the same size or the metrics are
          // measuring resolution.
          if (raw.width !== WIDTH || raw.height !== HEIGHT) {
            png = await sharp(png).resize(WIDTH, HEIGHT, { fit: "fill" }).png().toBuffer();
          }
          const file = `${framing.name}.png`;
          await writeFile(path.join(dir, file), png);
          const metrics = await measureImage(png);

          const warnings = [];
          if (note) warnings.push(String(note));
          if (!view.framed.onScreen) warnings.push("subject box is not fully on screen");
          if (!view.sightlineClear) warnings.push("no clear sightline found; best effort bearing");
          /* The hard gate. Composition, fill and on-screen tests all
             passed on a frame that was a photograph of a dune with
             the Garner behind it; only the sightline knew. A gallery
             that ships that frame and exits 0 is worse than no
             gallery. */
          if (view.visible < 0.12) {
            throw new Error(`subject is occluded from the chosen camera`
              + ` (${Math.round(view.visible * 100)}% of it in line of sight)`);
          }
          if (view.visible < 0.5) {
            warnings.push(`only ${Math.round(view.visible * 100)}% of the subject is in line of sight`);
          }
          if (view.subject.buriedAll) {
            warnings.push("every vertex is under the height field; the animal is not out of the ground");
          }
          /* Occlusion as its own warning. `fillH` is now measured on
             visible geometry, so a boss photographed behind a spire
             reports a SMALL fill - which on its own reads as a framing
             miss and would send the next reader to the distance solve.
             Say which it is. */
          const occluded = view.framed.occlusion;
          if (occluded > 0.15) {
            warnings.push(`${Math.round(occluded * 100)}% of the framed height is behind`
              + " something (fill is measured on what is visible)");
          }
          const off = view.framed.fillH / framing.fill;
          if (off < 0.55 || off > 1.8) {
            warnings.push(`fill ${view.framed.fillH.toFixed(2)} vs target ${framing.fill}`
              + ` (whole animal ${view.framed.fillHAll.toFixed(2)})`);
          }
          if (metrics.meanLuminance < 0.012) warnings.push("frame is essentially black");

          entry.shots.push({
            name: framing.name, file: path.join(key, file), intent: framing.intent,
            phase: phase?.phase ?? null,
            health: phase?.health ?? null,
            maxHealth: phase?.maxHealth ?? null,
            healthFraction: phase && phase.maxHealth
              ? Number((phase.health / phase.maxHealth).toFixed(3)) : null,
            camera: { position: view.camera, target: view.target, fov: view.fov,
              distance: view.distance, bearingDeg: view.bearingDeg,
              pitchBumpDeg: view.pitchBumpDeg, sightlineClear: view.sightlineClear,
              visibleFraction: view.visible },
            subject: view.subject,
            framed: view.framed,
            render: { calls: info.calls, triangles: info.triangles },
            ...(silh ? { silhouette: silh } : {}),
            metrics,
            warnings,
          });
          console.log(`  ${framing.name.padEnd(14)} phase ${String(phase?.phase).padEnd(11)}`
            + ` d=${String(view.distance).padStart(6)}m fov=${String(view.fov).padStart(5)}`
            + ` fill=${view.framed.fillH.toFixed(2)}/${view.framed.fillHAll.toFixed(2)}`
            + ` vis=${view.visible.toFixed(2)}`
            + ` lum=${metrics.meanLuminance.toFixed(3)}`
            + ` rms=${metrics.rmsContrast.toFixed(3)}`
            + ` hue=${metrics.hueSpreadDeg.toFixed(0)}deg`
            + (warnings.length ? `   <-- ${warnings.join("; ")}` : ""));
        } catch (error) {
          failures.push({ boss: key, framing: framing.name, error: error.message });
          entry.shots.push({ name: framing.name, error: error.message });
          console.error(`  ${framing.name.padEnd(14)} FAILED: ${error.message}`);
          // A wedged silhouette would leave every later frame white.
          await page.evaluate(() => { try { window.__GAL.silhouetteOff(); } catch (_) { /* nothing to undo */ } });
        }
      }
      entry.pageErrors = pageErrors.slice(0, 6);
      entry.seconds = Number(((Date.now() - started) / 1000).toFixed(1));
    } catch (error) {
      failures.push({ boss: key, framing: "(arm)", error: error.message });
      entry.error = error.message;
      console.error(`  ARM FAILED: ${error.message}`);
    }
  }

  report.failures = failures;
  await writeFile(path.join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nGallery: ${path.relative(root, OUT)}`);
  console.log(`Report:  ${path.relative(root, path.join(OUT, "report.json"))}`);
  if (failures.length) {
    console.error(`\n${failures.length} FAILED:`);
    for (const f of failures) console.error(`  ${f.boss} / ${f.framing}: ${f.error}`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${wanted.length * FRAMINGS.length} frames shot.`);
  }
} catch (error) {
  bail(error.stack || error.message);
} finally {
  clearTimeout(runTimer);
  if (browser) await browser.close().catch(() => {});
  server.kill("SIGTERM");
}
