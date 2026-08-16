/* ============================================================
   SAINTFALL - the Stylite

   The Choir Spires' own animal, and everything about it that is not
   geometry: why it is never on the ground, what it takes to put it
   there, and what those few seconds are worth.

   THE NAME

   A stylite is an ascetic who lives on top of a pillar. Simeon spent
   thirty-seven years on one. This district is fifty-four wind-carved
   needles standing eighty to a hundred and thirty metres out of the
   rock, and something has been living on the crowns of them.

   WHAT IT IS

   A leaping bug. Compact, armoured, and mostly hind leg: two enormous
   coiled springs that visibly compress before every jump and unload on
   the frame it leaves. Four small grasping forelegs that hold it to
   the rock, and a downward-pointing spinneret it fires through.

   THE FIGHT IS VERTICAL, AND THAT IS THE WHOLE POINT

   Every other boss in the game is a thing you stand in front of. The
   Winnower flies, but it flies over open ground and comes down when
   its lift runs out. This one is anchored to DISCRETE PERCHES - the
   district's own needles, read from the world builder rather than
   invented - so the question is never "where is it" but "which spire,
   and what is between us".

     DORMANT   Folded on a crown, dark, indistinguishable from the
               rock it is on. Nothing until the player crosses the
               aggro radius.
     ROUSE     3.4s. It unfolds, the plates open, and it looks down.
     PERCHED   THE FIGHT. It rakes the ground beneath it with its
               spinneret and picks a new needle every few seconds.
               Hard to hit: small, ninety metres up, and behind its
               own rock as often as not.
     LEAP      A compressed spring, a launch, an arc, and a landing
               that cracks whatever it lands on.
     STOOP     The answer to a player who camps out of its arc: it
               jumps AT them instead, telegraphed by a shadow, and
               lands with a shockwave.
     PLUMMET   THE MECHANIC. Its GRIP is a separate pool from its
               health, it only takes damage while the animal is
               perched, and emptying it tears the forelegs off the
               rock. It falls - properly falls, tumbling, taking its
               own impact - and lies stunned on the ground where a
               polearm can reach it. This is the only window in which
               it is cheap to kill, and the player makes it happen.
     RECOVER   It gathers itself and goes back up.

   Nothing here is a flyer. It cannot hover, cannot correct mid-air,
   and cannot choose not to land - which is what makes breaking its
   grip meaningful rather than merely inconvenient.
   ============================================================ */

import {
  TAU, clamp, clamp01, damp, dampAngle, lerp, makeBus, makeRng, smoothstep,
} from "saintfall/core.js";
import { patchMaterial } from "saintfall/art.js";
import { DISTRICTS } from "saintfall/terrain.js";
import { SURVIVAL_CONFIG } from "saintfall/combat.js";

export const STYLITE_CONFIG = Object.freeze({
  homeX: DISTRICTS.choir.x,
  homeZ: DISTRICTS.choir.z,

  aggroRadius: 78,
  rouseSeconds: 3.4,
  arenaRadius: 96,
  disengageRadius: 220,
  disengageSeconds: 14,
  retireSeconds: 4.0,

  /* ------------------------------------------------------------
     THE PERCHES
     ------------------------------------------------------------ */
  /* Which of the district's needles it will use. Tall enough that the
     player has to look up, near enough the middle that the fight does
     not wander out of the arena, and at least this far apart so a leap
     is a real relocation rather than a hop. */
  perchMinHeight: 46,
  perchMaxRange: 150,
  perchMinSpacing: 46,
  perchCount: 7,
  /* How far down the crown it grips, AS A FRACTION OF THE NEEDLE.

     A fixed three metres was the first try and it put the animal on
     the very point: these needles taper hard - the world builder runs
     `shrink` to 0.34 over the last fifth - so three metres below the
     tip the rock is barely a metre across, narrower than the creature
     standing on it, and it read as hovering beside a spike. An eighth
     of the way down the shoulder is seven or eight metres wide and it
     reads as something gripping a tower. */
  perchDropFraction: 0.13,
  /* And how far its body rides above whatever it is gripping - hip to
     foot in the clinging pose, so the legs reach the rock instead of
     hanging through it. */
  standHeight: 2.4,
  /* Off the axis, toward the middle of the district: it clings to the
     SHOULDER facing the arena rather than balancing on the crown, so
     it is overlooking the fight rather than sitting on a post. */
  shoulderOffset: 0.45,

  /* ------------------------------------------------------------
     THE BARRAGE
     ------------------------------------------------------------ */
  volleyCadence: 2.35,
  volleyWindup: 0.55,
  volleyShots: 3,
  volleyGap: 0.14,
  volleySpeed: 78,
  volleyDamage: 15,
  /* Lobbed rather than hitscan, and slow enough to walk out of. From
     ninety metres up a hitscan weapon is not a threat, it is a tax:
     there is no reaction to make. A visible bolt with a travel time
     turns "it is shooting at me" into "it is shooting at where I was". */
  volleyLead: 0.55,
  volleyMax: 24,

  /* ------------------------------------------------------------
     THE LEAP
     ------------------------------------------------------------ */
  perchSeconds: [4.6, 7.4],
  /* The coil, the flight, and the grab. The coil is the read - a
     spring visibly loading is the clearest telegraph an animal can
     give - and the flight is deliberately slow enough to track with
     the eye and shoot at. It is at its most vulnerable in the air. */
  coilSeconds: 0.75,
  flightSeconds: 1.35,
  landSeconds: 0.45,
  /* How high above the straight line between two crowns the arc goes,
     as a fraction of the distance. Real jumping insects throw
     themselves far higher than they need to. */
  arcRise: 0.42,

  /* ------------------------------------------------------------
     THE STOOP
     ------------------------------------------------------------ */
  stoopCadence: 13,
  /* Only thrown at a player who is standing where the barrage cannot
     reach - which is the point of it. A stoop at somebody already
     being shot at is just a second attack; a stoop at somebody hiding
     behind a needle is an eviction. */
  stoopMinRange: 26,
  stoopRadius: 13,
  stoopDamage: 46,
  stoopSlowFactor: 0.36,
  stoopSlowSeconds: 1.2,

  /* ------------------------------------------------------------
     THE GRIP, AND THE FALL
     ------------------------------------------------------------ */
  /* A pool entirely separate from its health, and the only one the
     player can empty on purpose. Sized so that a committed magazine
     into a perched target brings it down: the fight should reward
     shooting UP, which is the awkward thing to do, over waiting.

     It refills while the animal is on a perch it has just taken, so a
     player who chips at it between leaps achieves nothing - the grip
     has to be broken in one sustained effort. */
  gripMax: 900,
  gripRegen: 55,
  /* Damage to the grip is a fraction of damage dealt, so every weapon
     contributes in proportion and nothing needs its own rule. Above
     one, because the forelegs are a smaller target than the body and
     hitting them at all is the skill being paid for. */
  gripShare: 1.35,
  /* The fall itself. Long enough to watch, and it does its own damage
     on landing - an animal that drops ninety metres and stands up
     unharmed teaches the player that the mechanic is a formality. */
  fallSeconds: 1.15,
  fallSelfDamage: 420,
  /* Metres past the foot of its own needle that a falling Stylite
     lands. Big enough that the animal, its crash crater and the
     player swinging at it are all on open sand. */
  fallClearance: 11,
  /* Where the body's ORIGIN rests once it has crashed. The thorax is
     a 1.33m half-height sphere carrying a 1.7x body scale, so its
     underside sits 2.26m below the origin - and the 0.9 this was
     written at, before the animal was scaled up to read from the
     ground, buried the whole belly and both hind springs in the sand.
     Slightly under the full 2.26 on purpose: it has just fallen
     eighty metres and should be settled into its own crater, not
     parked on top of the dune. */
  crashRestHeight: 1.95,
  crashRadius: 9,
  crashDamage: 26,
  /* THE WINDOW. Everything the player did to earn it is spent here. */
  stunnedSeconds: 6.5,
  stunnedMeleeMult: 2.8,
  recoverSeconds: 1.4,
  /* It cannot be brought down twice in a row without going back up:
     the grip is restored in full on landing, and a fresh perch has to
     be taken before the next fall is possible. */
  simRange: 620,
});

/* Chitin, and it is the Choir's own palette rather than the Bloom's.
   This animal has been living on that rock long enough to be the
   colour of it: a dark stone-grey shell with the district's warm
   sandstone in its highlights, and only the spinneret and the eyes
   carry any of the brood's violet. */
const SHELL_DARK = [0.045, 0.038, 0.042];
const SHELL_LIT = [0.235, 0.185, 0.150];
const SHELL_EDGE = [0.42, 0.33, 0.25];
const SPRING_DARK = [0.075, 0.055, 0.062];
const SPRING_LIT = [0.28, 0.16, 0.19];
const GLOW_VIOLET = [0.44, 0.16, 0.52];

export function buildStylite(ctx) {
  const { THREE, scene, atmos, enemies } = ctx;
  const bus = makeBus();
  const C = STYLITE_CONFIG;
  const rng = makeRng(0x571e);
  const groundAt = (x, z) => (ctx.collide
    ? ctx.collide.groundHeight(x, z)
    : ctx.terrain.heightAt(x, z));

  const group = new THREE.Group();
  group.name = "stylite";
  group.visible = false;
  scene.add(group);

  let inst = null;

  /* ============================================================
     THE PERCHES

     Read from the world builder's own list of standing needles, not
     invented here. They are the rock the district is made of: the
     same rock in the collision grid, the same rock the light shafts
     hang off. An encounter that guessed at ledge positions would put
     the animal inside a spire the first time the spire field moved.
     ============================================================ */
  const perches = (() => {
    const all = ctx.world?.choirNeedles || [];
    const near = all
      .filter((n) => n.h >= C.perchMinHeight
        && Math.hypot(n.x - C.homeX, n.z - C.homeZ) <= C.perchMaxRange)
      // Tallest first: the crowns that already carry the skyline.
      .sort((a, b) => b.h - a.h);
    const out = [];
    for (const n of near) {
      if (out.length >= C.perchCount) break;
      if (out.some((p) => Math.hypot(p.x - n.x, p.z - n.z) < C.perchMinSpacing)) continue;
      /* Toward the district centre, so every crown it uses overlooks
         the ground the fight happens on. */
      const bx = C.homeX - n.x;
      const bz = C.homeZ - n.z;
      const bd = Math.hypot(bx, bz) || 1;
      /* The rock's own width where it grips - the world builder's own
         taper, so the offset follows the needle rather than a guess. */
      const drop = n.h * C.perchDropFraction;
      const localRad = n.rad * lerp(1, 0.34,
        Math.pow(clamp01((n.h - drop) / n.h), 2.3));
      out.push({
        x: n.x + (bx / bd) * localRad * C.shoulderOffset,
        z: n.z + (bz / bd) * localRad * C.shoulderOffset,
        y: n.baseY + n.h - drop + C.standHeight,
        rad: localRad,
        /* The needle's full footprint, kept alongside the crown
           radius. A caller asking "can I see the crown from over
           there" is really asking about the whole cone, and the
           taper between the two is most of a needle. */
        baseRad: n.rad,
        baseY: n.baseY,
      });
    }
    /* A fallback ring, for a world that produced no needles tall
       enough - a seeded spire field is not guaranteed, and a boss with
       nowhere to stand is a boss that never appears. Deliberately
       placed at plausible crown height rather than on the ground, so
       the failure is visible in a screenshot rather than silent. */
    if (out.length < 3) {
      for (let i = out.length; i < 3; i += 1) {
        const a = (i / 3) * TAU;
        const x = C.homeX + Math.cos(a) * 62;
        const z = C.homeZ + Math.sin(a) * 62;
        out.push({ x, z, y: groundAt(x, z) + 58, rad: 6, baseRad: 6, baseY: groundAt(x, z) });
      }
    }
    return out;
  })();

  const state = {
    phase: "dormant",   // dormant, rouse, perched, leap, stoop, plummet, stunned, recover, retire, dead
    timer: 0,
    woken: 0,
    perch: 0,           // index into `perches`
    /* Where the body actually is. On a perch this is the perch; in
       flight it is interpolated along the arc; on the ground it is
       wherever it came down. */
    pos: new THREE.Vector3(),
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
    arcHeight: 0,
    flight: 0,
    /* 0 relaxed, 1 fully compressed. Drives the hind legs and is the
       single most important read the animal has. */
    coil: 0,
    facing: 0,
    grip: C.gripMax,
    volleyTimer: 0,
    volleyWind: 0,
    volleyLeft: 0,
    volleyGap: 0,
    stoopTimer: 0,
    perchTimer: 0,
    falls: 0,
    disengageFor: 0,
    defeated: false,
    revealed: false,
    releaseCameraAt: undefined,
    tumble: 0,
    dustTick: 0,
  };

  /* ============================================================
     MATERIALS
     ============================================================ */
  const shellMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.58,
    metalness: 0.06,
  });
  shellMat.name = "sf-stylite-shell";
  shellMat.side = THREE.DoubleSide;
  /* Rim LOW, for the reason the Garner's collar and the Abbess's sac
     both established: the atmosphere patch's sky-tinted rim is additive
     and albedo-independent, and this animal spends the whole fight
     silhouetted against open sky where every facet catches it at once.
     At a walker's usual 1.3 it read as a bright blob on a spire. */
  patchMaterial(shellMat, atmos, { rim: 0.42, glitter: 0.10, bio: 1.5 });

  /* THE SEAMS get their own material, and it is the only material on
     this animal whose emissive is driven per frame.

     The carapace is deliberate camouflage - a treehopper crest that
     echoes the needles, warm shell against warm sandstone - and
     photographed from the flats that worked far too well: the boss
     was four tan pixels on tan rock, and a player standing under the
     spire could not find the thing shooting at them. The answer is
     not to repaint the animal, because a Stylite that is obvious
     while it sleeps throws away its own reveal. The answer is that
     the camouflage BREAKS. Dormant it is rock; roused, the plates
     lift off the seams underneath and it becomes the brightest thing
     in the district.

     And what the seams then report is the GRIP. They run hotter and
     faster as it slips, so the fall - the whole fight's payoff - is
     legible from the ground for two full seconds before it happens,
     to a player who cannot read a health bar at ninety metres. */
  const seamMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.34,
    metalness: 0,
    color: new THREE.Color("#3b0f4d"),
    emissive: new THREE.Color("#c268ff"),
    emissiveIntensity: 0,
    transparent: true,
    opacity: 1,
  });
  seamMat.name = "sf-stylite-seam";
  patchMaterial(seamMat, atmos, { rim: 0.2, glitter: 0 });
  const _seamHot = new THREE.Color("#ffd9f4");
  const _seamCool = new THREE.Color("#a94dff");

  const boltMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#b45cf0"),
    emissive: new THREE.Color("#e5b0ff"),
    emissiveIntensity: 1.7,
    roughness: 0.3,
    metalness: 0,
    flatShading: true,
  });
  boltMat.name = "sf-stylite-bolt";
  patchMaterial(boltMat, atmos, { rim: 0.5, glitter: 0 });

  /* ============================================================
     THE BODY

     A jointed insect, built as a hierarchy of groups and animated by
     ROTATING them - not by rewriting vertices.

     This is the opposite choice to the Garner's tentacles and the
     Abbess's sac, and for a reason: those two are surfaces that
     deform, and no skeleton expresses a swelling. This one is a rigid
     shell on hinges. Its whole read is a spring compressing, which is
     three angles per leg, and driving that through a vertex rewrite
     would be doing arithmetic on nine hundred points to express six
     numbers.
     ============================================================ */
  const body = new THREE.Group();
  body.name = "sf-stylite-body";
  group.add(body);
  let seamGlow = null;

  /** Paint a geometry on the shell ramp. */
  function paint(geo, lit, glow = 0, ramp = null) {
    const count = geo.attributes.position.count;
    const colour = new Float32Array(count * 4);
    const from = ramp ? ramp[0] : SHELL_DARK;
    const to = ramp ? ramp[1] : SHELL_LIT;
    for (let i = 0; i < count; i += 1) {
      const t = lit * (0.82 + rng() * 0.36);
      colour[i * 4] = lerp(from[0], to[0], t);
      colour[i * 4 + 1] = lerp(from[1], to[1], t);
      colour[i * 4 + 2] = lerp(from[2], to[2], t);
      colour[i * 4 + 3] = glow;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    return geo;
  }

  /** Minimal merge - same reasoning as abbess.js's. */
  function mergeAll(geos) {
    let verts = 0;
    let idx = 0;
    for (const g of geos) {
      if (!g.attributes.normal) g.computeVertexNormals();
      verts += g.attributes.position.count;
      idx += g.index ? g.index.count : g.attributes.position.count;
    }
    const position = new Float32Array(verts * 3);
    const normal = new Float32Array(verts * 3);
    const colour = new Float32Array(verts * 4);
    const index = new Uint32Array(idx);
    let vo = 0;
    let io = 0;
    for (const g of geos) {
      const n = g.attributes.position.count;
      position.set(g.attributes.position.array.subarray(0, n * 3), vo * 3);
      normal.set(g.attributes.normal.array.subarray(0, n * 3), vo * 3);
      colour.set(g.attributes.color.array.subarray(0, n * 4), vo * 4);
      if (g.index) {
        for (let i = 0; i < g.index.count; i += 1) index[io + i] = g.index.getX(i) + vo;
        io += g.index.count;
      } else {
        for (let i = 0; i < n; i += 1) index[io + i] = i + vo;
        io += n;
      }
      vo += n;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(position, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    out.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    out.setIndex(new THREE.BufferAttribute(index, 1));
    return out;
  }

  /* --- the carapace ---------------------------------------------
     A treehopper's pronotum: a single swept crest of shell over the
     whole animal, and the reason it disappears against the rock while
     it is folded. It echoes the needles it lives on deliberately -
     the district's silhouette is spikes, and so is its tenant's. */
  {
    const parts = [];
    const crest = new THREE.ConeGeometry(1.9, 5.4, 5);
    crest.rotateX(-Math.PI * 0.46);
    crest.scale(1, 1, 0.55);
    crest.translate(0, 1.15, -1.1);
    parts.push(paint(crest, 0.9, 0, [SHELL_DARK, SHELL_EDGE]));
    // The thorax under it.
    const thorax = new THREE.SphereGeometry(1.55, 9, 7);
    thorax.scale(1.05, 0.86, 1.35);
    parts.push(paint(thorax, 0.65));
    // Head, low and forward, with two lit eyes.
    const skull = new THREE.SphereGeometry(0.82, 8, 6);
    skull.scale(1, 0.8, 1.15);
    skull.translate(0, -0.18, 1.75);
    parts.push(paint(skull, 0.8));
    for (const side of [-1, 1]) {
      const eye = new THREE.SphereGeometry(0.3, 6, 5);
      eye.scale(1, 0.75, 1.3);
      eye.translate(side * 0.5, 0.06, 2.25);
      parts.push(paint(eye, 1, 1, [GLOW_VIOLET, GLOW_VIOLET]));
    }
    body.add(new THREE.Mesh(mergeAll(parts), shellMat));

    /* The seams themselves, and they go on the BELLY.

       The first pass put them along the crest, which is where a
       treehopper's markings would actually be and which photographed
       as nothing at all: the crest is a metre and a half of shell
       arching over them, and the one direction it hides them from is
       DOWN. That is the only direction this fight is ever watched
       from. The player is underneath the animal for the entire
       encounter - that is the premise - so the ventral plates are the
       only surface with a guaranteed line to the camera, and a bug
       that lights its underside is a firefly rather than an
       inconsistency. It also keeps the reveal: seen from across the
       flats on the approach, before it wakes, there is still nothing
       on that spire but rock. */
    const seams = [];
    for (let i = 0; i < 4; i += 1) {
      const t = i / 3;
      const z = lerp(1.05, -1.95, t);
      const w = lerp(0.62, 1.35, Math.sin(t * Math.PI) * 0.7 + 0.3);
      for (const side of [-1, 1]) {
        const g = new THREE.BoxGeometry(0.2, 0.17, w);
        g.rotateX(0.12);
        g.translate(side * lerp(0.5, 0.92, t), lerp(-1.02, -0.72, t), z);
        seams.push(paint(g, 1, 1, [GLOW_VIOLET, GLOW_VIOLET]));
      }
    }
    // A keel down the midline, and a throat pip under the head.
    const keel = new THREE.BoxGeometry(0.26, 0.2, 3.3);
    keel.translate(0, -1.12, -0.45);
    seams.push(paint(keel, 1, 1, [GLOW_VIOLET, GLOW_VIOLET]));
    const throat = new THREE.SphereGeometry(0.34, 7, 5);
    throat.scale(1.25, 0.7, 1);
    throat.translate(0, -0.72, 1.62);
    seams.push(paint(throat, 1, 1, [GLOW_VIOLET, GLOW_VIOLET]));
    seamGlow = new THREE.Mesh(mergeAll(seams), seamMat);
    seamGlow.name = "sf-stylite-seams";
    body.add(seamGlow);
  }

  /* --- the spinneret --------------------------------------------
     Slung under the abdomen and pointing DOWN, because everything it
     shoots at is beneath it. It is also the only part of the animal
     that glows, which is what makes a perched Stylite findable
     against a hundred metres of dark rock. */
  const spinneret = new THREE.Group();
  spinneret.position.set(0, -0.9, -1.4);
  body.add(spinneret);
  {
    const g = new THREE.ConeGeometry(0.52, 2.6, 6);
    g.rotateX(Math.PI * 0.5);
    g.translate(0, 0, -0.9);
    spinneret.add(new THREE.Mesh(paint(g, 0.55, 0.85, [SHELL_DARK, GLOW_VIOLET]), shellMat));
    /* And a muzzle on `seamMat`, so the thing shooting at you is the
       brightest point on the animal and the direction it is pointing
       is readable before the first bolt leaves it. */
    const muz = new THREE.SphereGeometry(0.4, 8, 6);
    muz.scale(1, 1, 1.5);
    muz.translate(0, 0, -2.05);
    spinneret.add(new THREE.Mesh(paint(muz, 1, 1, [GLOW_VIOLET, GLOW_VIOLET]), seamMat));
  }

  /* --- the legs --------------------------------------------------
     Two hind springs and four graspers, each a chain of nested groups
     so a pose is three numbers rather than a mesh rewrite.
     ------------------------------------------------------------- */
  function limb(spec) {
    const hip = new THREE.Group();
    hip.position.set(spec.x, spec.y, spec.z);
    const knee = new THREE.Group();
    knee.position.set(0, -spec.femur, 0);
    const foot = new THREE.Group();
    foot.position.set(0, -spec.tibia, 0);
    hip.add(knee);
    knee.add(foot);

    const seg = (len, r0, r1, lit, ramp) => {
      const g = new THREE.CylinderGeometry(r0, r1, len, spec.sides || 5);
      g.translate(0, -len * 0.5, 0);
      return new THREE.Mesh(paint(g, lit, 0, ramp), shellMat);
    };
    /* A lit collar at the knee of each hind spring. This is the coil
       tell: two points of light that fold up against the body and then
       snap apart, which survives the ninety metres that the shape of a
       bent leg does not. */
    if (spec.sides === 6) {
      const pip = new THREE.SphereGeometry(spec.thick * 0.62, 7, 5);
      pip.scale(1, 0.8, 1);
      const mesh = new THREE.Mesh(paint(pip, 1, 1, [GLOW_VIOLET, GLOW_VIOLET]), seamMat);
      knee.add(mesh);
    }
    hip.add(seg(spec.femur, spec.thick, spec.thick * 0.72, 0.6, spec.ramp));
    knee.add(seg(spec.tibia, spec.thick * 0.72, spec.thick * 0.4, 0.5, spec.ramp));
    // The tarsus: short, and angled so the animal reads as gripping.
    const tar = seg(spec.tarsus, spec.thick * 0.4, spec.thick * 0.16, 0.85, spec.ramp);
    tar.rotation.x = -1.15;
    foot.add(tar);
    body.add(hip);
    return { hip, knee, foot, spec };
  }

  /* THE SPRINGS. Deliberately out of proportion - a jumping insect's
     hind femora are thicker than its whole thorax, and understating
     that makes the leap arrive from nowhere. */
  const springs = [-1, 1].map((side) => limb({
    x: side * 1.15, y: -0.35, z: -0.95,
    femur: 3.5, tibia: 3.9, tarsus: 1.1, thick: 0.78, sides: 6,
    ramp: [SPRING_DARK, SPRING_LIT], side,
  }));
  /* The graspers. Small, and they are what the grip pool represents:
     break these and nothing is holding the animal on. */
  const graspers = [];
  for (let i = 0; i < 2; i += 1) {
    for (const side of [-1, 1]) {
      graspers.push(limb({
        x: side * 1.0, y: -0.3, z: 0.95 - i * 1.0,
        femur: 1.5, tibia: 1.7, tarsus: 0.7, thick: 0.3,
        ramp: [SHELL_DARK, SHELL_LIT], side, index: i,
      }));
    }
  }

  /* ============================================================
     THE BARRAGE
     ============================================================ */
  const boltGeo = new THREE.IcosahedronGeometry(0.34, 0);
  const bolts = [];
  for (let i = 0; i < C.volleyMax; i += 1) {
    const mesh = new THREE.Mesh(boltGeo, boltMat);
    mesh.visible = false;
    mesh.castShadow = false;
    group.add(mesh);
    bolts.push({ mesh, live: false, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
  }
  let boltCursor = 0;

  function fireBolt() {
    const ps = ctx.player.state;
    spinneret.updateWorldMatrix(true, false);
    const o = new THREE.Vector3().setFromMatrixPosition(spinneret.matrixWorld);
    /* Led, and led by the bolt's own travel time rather than a
       constant. From ninety metres up the flight is over a second, and
       a shot aimed at where the player is standing lands behind them
       every time - which reads as the animal being harmless rather
       than as the player dodging. */
    const tx = ps.x + lead.vx * C.volleyLead;
    const tz = ps.z + lead.vz * C.volleyLead;
    const dx = tx - o.x;
    const dy = (ps.y + 1.0) - o.y;
    const dz = tz - o.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const spread = 0.035;
    const b = bolts[boltCursor];
    boltCursor = (boltCursor + 1) % bolts.length;
    b.live = true;
    b.life = 4.5;
    b.x = o.x; b.y = o.y; b.z = o.z;
    b.vx = (dx / d) * C.volleySpeed + (rng() - 0.5) * C.volleySpeed * spread;
    b.vy = (dy / d) * C.volleySpeed + (rng() - 0.5) * C.volleySpeed * spread;
    b.vz = (dz / d) * C.volleySpeed + (rng() - 0.5) * C.volleySpeed * spread;
    b.mesh.position.copy(o);
    b.mesh.visible = true;
    ctx.vfx?.spark?.(o.x, o.y, o.z, 1.0, false, true);
    bus.emit("shot", { x: o.x, y: o.y, z: o.z });
  }

  function updateBolts(dt) {
    const ps = ctx.player?.state;
    for (const b of bolts) {
      if (!b.live) continue;
      b.life -= dt;
      const px = b.x;
      const py = b.y;
      const pz = b.z;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.mesh.position.set(b.x, b.y, b.z);
      b.mesh.rotation.x += dt * 9;
      b.mesh.rotation.y += dt * 7;

      let hit = null;
      const step = Math.hypot(b.x - px, b.y - py, b.z - pz);
      if (step > 1e-4 && ctx.collide?.rayBlock) {
        const blocked = ctx.collide.rayBlock(px, py, pz,
          (b.x - px) / step, (b.y - py) / step, (b.z - pz) / step, step);
        if (blocked < step) {
          hit = {
            x: px + ((b.x - px) / step) * blocked,
            y: py + ((b.y - py) / step) * blocked,
            z: pz + ((b.z - pz) / step) * blocked,
            direct: false,
          };
        }
      }
      if (!hit && ps && !ctx.combat?.player?.dead) {
        const dx = b.x - ps.x;
        const dz = b.z - ps.z;
        const dy = b.y - (ps.y + 1.0);
        if (dx * dx + dz * dz < 1.7 * 1.7 && Math.abs(dy) < 1.6) {
          hit = { x: b.x, y: b.y, z: b.z, direct: true };
        }
      }
      if (!hit && b.y <= groundAt(b.x, b.z) + 0.2) {
        hit = { x: b.x, y: groundAt(b.x, b.z), z: b.z, direct: false };
      }
      if (hit) {
        b.live = false;
        b.mesh.visible = false;
        if (hit.direct) {
          ctx.combat?.hurtPlayer?.(C.volleyDamage * SURVIVAL_CONFIG.enemyDamageMultiplier, {
            source: "stylite-bolt", x: hit.x, y: hit.y, z: hit.z,
          });
          ctx.player?.punch?.(0.6);
        }
        ctx.vfx?.spark?.(hit.x, hit.y, hit.z, hit.direct ? 1.8 : 1.0, !hit.direct, true);
        bus.emit(hit.direct ? "boltHit" : "boltSplash", hit);
        continue;
      }
      if (b.life <= 0) { b.live = false; b.mesh.visible = false; }
    }
  }

  /* Player velocity, for the lead. Measured here because nothing else
     wants it - the same arrangement the Garner's lash uses. */
  const lead = { x: 0, z: 0, vx: 0, vz: 0 };
  let seamClock = 0;

  /* ============================================================
     POSE

     One function, driven by `state`. Every limb angle in the animal
     is a blend of four postures - gripping, coiled, extended and
     sprawled - and which blend is active is the phase.
     ============================================================ */
  function poseBody(dt) {
    const wake = clamp01(state.woken);
    const coil = state.coil;
    const sprawl = state.phase === "plummet" || state.phase === "stunned"
      ? 1 : state.phase === "recover" ? 1 - clamp01(1 - state.timer / C.recoverSeconds) : 0;
    const flying = state.phase === "leap" || state.phase === "stoop";

    body.position.copy(state.pos);
    /* Facing, and the tumble. A falling Stylite is not a creature
       holding a pose - it is a mass with the wrong side down, and the
       roll it accumulates is what makes the landing read as a crash
       rather than as a controlled descent. */
    body.rotation.set(
      state.tumble * 2.4,
      state.facing,
      state.tumble * 1.3
    );
    /* On a perch it clings to the SIDE of the crown, not the top: the
       whole animal pitches nose-down over the drop so its spinneret
       points at the ground it is shooting at. */
    if (!flying && sprawl < 0.5) {
      body.rotation.x += lerp(0, 0.42, wake) * (1 - sprawl);
    }
    /* SCALED UP, and the number is set by the read rather than by
       anatomy. Fought from directly underneath at ninety metres, a
       four-metre bug is a speck: the player cannot see the coil load,
       cannot see the graspers slip as the grip fails, and cannot tell a
       leap from a stoop. At 1.7 it is a seven-metre animal and every
       tell it has survives the distance it is meant to be read at. */
    body.scale.setScalar(lerp(0.55, 1, wake) * 1.7);
    body.updateMatrixWorld(true);

    /* THE SEAMS. Off entirely while it is rock, up with the rouse,
       and then reporting the grip for the rest of the fight.

       `seamSlip` is how far through the grip it is, so a full hold sits at
       a slow violet idle and an empty one is a fast white flicker. The
       pulse is driven off elapsed time rather than a phase timer
       because the fall can be started from any phase, and a tell that
       resets its own beat every time the animal jumps is not a tell.
       While it is down the seams go nearly out - a stunned Stylite in
       its crater should read as SPENT, and the light coming back is
       the honest warning that the melee window is closing. */
    const seamSlip = clamp01(1 - state.grip / Math.max(1, C.gripMax));
    const downed = state.phase === "plummet" || state.phase === "stunned"
      || state.phase === "recover";
    seamClock += dt * lerp(2.1, 9.5, seamSlip * seamSlip);
    const beat = 0.5 + 0.5 * Math.sin(seamClock);
    const lit = wake * (downed ? 0.14 : 1)
      * lerp(0.55 + beat * 0.25, 0.75 + beat * 0.85, seamSlip);
    seamMat.emissiveIntensity = lit * 3.4;
    seamMat.emissive.copy(_seamCool).lerp(_seamHot, seamSlip * (0.45 + beat * 0.55));
    if (seamGlow) seamGlow.visible = lit > 0.01;

    /* THE SPRINGS. Three angles, and the whole leap lives in them.
       Gripping is a wide low stance; coiled folds the femur up against
       the body and the tibia back under it, which is what a locust
       does and is visually a spring; extended throws both open. */
    const extend = flying ? clamp01(1 - state.flight * 2.2) : 0;
    for (const leg of springs) {
      const side = leg.spec.side;
      const gripPose = { hip: -0.55, knee: 1.45, foot: -0.75 };
      const coilPose = { hip: -1.55, knee: 2.55, foot: -1.05 };
      const outPose = { hip: 0.75, knee: 0.18, foot: 0.35 };
      const sprawlPose = { hip: -1.15, knee: 0.55, foot: 0.15 };
      const t = Math.max(coil, extend);
      const base = {
        hip: lerp(gripPose.hip, coil > extend ? coilPose.hip : outPose.hip, t),
        knee: lerp(gripPose.knee, coil > extend ? coilPose.knee : outPose.knee, t),
        foot: lerp(gripPose.foot, coil > extend ? coilPose.foot : outPose.foot, t),
      };
      leg.hip.rotation.x = damp(leg.hip.rotation.x,
        lerp(base.hip, sprawlPose.hip, sprawl), 18, dt);
      leg.hip.rotation.z = damp(leg.hip.rotation.z,
        side * lerp(0.42, 0.16, t) + side * sprawl * 0.55, 14, dt);
      leg.knee.rotation.x = damp(leg.knee.rotation.x,
        lerp(base.knee, sprawlPose.knee, sprawl), 18, dt);
      leg.foot.rotation.x = damp(leg.foot.rotation.x,
        lerp(base.foot, sprawlPose.foot, sprawl), 16, dt);
    }

    /* THE GRASPERS, and they carry the grip pool's own read: as the
       grip fails they splay wider and lose their bite on the rock,
       so the player can see the fall coming before it happens. */
    const slip = 1 - clamp01(state.grip / C.gripMax);
    for (let i = 0; i < graspers.length; i += 1) {
      const leg = graspers[i];
      const side = leg.spec.side;
      const held = flying || sprawl > 0.5 ? 0 : 1;
      leg.hip.rotation.x = damp(leg.hip.rotation.x,
        lerp(0.55, -0.35, held) + slip * 0.5 + sprawl * 0.7, 12, dt);
      leg.hip.rotation.z = damp(leg.hip.rotation.z,
        side * (0.65 + slip * 0.55 + (1 - held) * 0.4), 12, dt);
      leg.knee.rotation.x = damp(leg.knee.rotation.x,
        lerp(0.9, 1.5, held) - slip * 0.6, 12, dt);
    }

    // The spinneret tracks the ground it is firing at.
    const ps = ctx.player?.state;
    if (ps && !flying) {
      const want = Math.atan2(
        state.pos.y - (ps.y + 1),
        Math.hypot(ps.x - state.pos.x, ps.z - state.pos.z)) - Math.PI * 0.5;
      spinneret.rotation.x = damp(spinneret.rotation.x,
        clamp(-want, -1.4, 0.35), 6, dt);
    }
  }

  /* ============================================================
     BEHAVIOUR
     ============================================================ */

  function perchPos(i) {
    const p = perches[clamp(Math.round(i), 0, perches.length - 1)];
    return p;
  }

  function faceThe(x, z, rate, dt) {
    const want = Math.atan2(x - state.pos.x, z - state.pos.z);
    state.facing = dampAngle(state.facing, want, rate, dt);
  }

  /** Pick the next crown: not the one it is on, and biased toward
   *  needles that actually overlook the player. */
  function pickPerch() {
    const ps = ctx.player.state;
    let best = state.perch;
    let bestScore = -Infinity;
    for (let i = 0; i < perches.length; i += 1) {
      if (i === state.perch) continue;
      const p = perches[i];
      const d = Math.hypot(p.x - ps.x, p.z - ps.z);
      /* Wants to be near enough to shoot and far enough to be awkward
         to shoot back at, plus a little noise so a fight never runs
         the same circuit twice. */
      const score = -Math.abs(d - 46) + rng() * 26;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  function beginLeap(toIndex) {
    const p = perchPos(toIndex);
    state.phase = "leap";
    state.timer = C.coilSeconds + C.flightSeconds + C.landSeconds;
    state.from.copy(state.pos);
    state.to.set(p.x, p.y, p.z);
    state.flight = 0;
    state.perch = toIndex;
    const span = state.from.distanceTo(state.to);
    state.arcHeight = Math.max(14, span * C.arcRise);
    bus.emit("coil", { x: state.pos.x, y: state.pos.y, z: state.pos.z });
  }

  function beginStoop() {
    const ps = ctx.player.state;
    state.phase = "stoop";
    state.timer = C.coilSeconds + C.flightSeconds * 0.8 + C.landSeconds;
    state.from.copy(state.pos);
    /* At the player's feet, not their head, and captured now rather
       than tracked: a leap that homes is not a leap, it is a missile,
       and the whole answer to this attack is to not be there. */
    state.to.set(ps.x, groundAt(ps.x, ps.z) + 1.2, ps.z);
    state.flight = 0;
    state.arcHeight = Math.max(16, state.from.distanceTo(state.to) * 0.34);
    state.stoopTimer = C.stoopCadence;
    ctx.player?.doctrineKick?.(0.4, 0.3);
    bus.emit("stoopTelegraph", { x: state.to.x, y: state.to.y, z: state.to.z });
  }

  /** Landing, from a leap or a stoop. */
  function land(fromStoop) {
    const p = state.to;
    ctx.vfx?.blast?.(p.x, p.y, p.z, fromStoop ? C.stoopRadius * 0.7 : 5);
    if (fromStoop) {
      ctx.vfx?.breach?.(p.x, groundAt(p.x, p.z), p.z, C.stoopRadius, 2.0);
      ctx.player?.punch?.(1.5);
      ctx.player?.doctrineKick?.(1.0, 0.9);
      const ps = ctx.player?.state;
      if (ps && !ctx.combat?.player?.dead) {
        const d = Math.hypot(ps.x - p.x, ps.z - p.z);
        if (d < C.stoopRadius) {
          const falloff = 1 - 0.5 * (d / C.stoopRadius);
          ctx.combat.hurtPlayer(C.stoopDamage * falloff
            * SURVIVAL_CONFIG.enemyDamageMultiplier, {
            source: "stylite-stoop", x: ps.x, y: ps.y + 1.0, z: ps.z,
          });
          ctx.player?.applySlow?.(C.stoopSlowFactor, C.stoopSlowSeconds);
        }
      }
      ctx.combat?.shockwave?.(p.x, groundAt(p.x, p.z), p.z, {
        radius: C.stoopRadius, innerRadius: C.stoopRadius * 0.3,
        damage: 0, stun: 1.2, knockSpeed: 9, source: "stylite-stoop",
      });
      bus.emit("stoop", { x: p.x, y: p.y, z: p.z });
      /* A stoop puts it ON THE GROUND, but standing and dangerous -
         not the plummet window. It goes straight back up. */
      state.phase = "perched";
      state.perchTimer = 1.1;
      return;
    }
    bus.emit("land", { x: p.x, y: p.y, z: p.z });
    state.phase = "perched";
    state.perchTimer = lerp(C.perchSeconds[0], C.perchSeconds[1], rng());
    /* A fresh crown is a fresh grip. This is what stops a player
       chipping the pool down over several perches and getting the fall
       for free: it has to be broken inside one perch. */
    state.grip = C.gripMax;
  }

  /* ------------------------------------------------------------
     THE FALL
     ------------------------------------------------------------ */
  function beginPlummet() {
    state.phase = "plummet";
    state.timer = C.fallSeconds;
    state.from.copy(state.pos);
    /* IT HAS TO FALL CLEAR OF THE NEEDLE.

       Dropping straight down looks like the honest thing to do and is
       not: the crowns it perches on are the narrow ends of cones
       fifteen metres wide at the sand, so a plumb-line fall lands the
       animal INSIDE the rock. Not near it - measured at zero metres
       from the axis. Everything after that is broken and none of it
       is obviously broken: the stunned boss is buried in a spire, the
       player is shoved out by the needle's collision before they can
       reach it, and the melee window that the entire fight is built
       to earn cannot be taken. The screenshots read as a black frame,
       which is the only reason this was ever noticed.

       So it peels off. The bearing is toward the player, both because
       a bug losing its grip on a leaning face falls off that face and
       because the reward for breaking the grip should land where the
       person who broke it is standing, not a needle's width behind
       it. The distance clears the widest part of the cone. */
    const p0 = perches[state.perch] || null;
    const ps = ctx.player?.state;
    let dx = ps ? ps.x - state.pos.x : 1;
    let dz = ps ? ps.z - state.pos.z : 0;
    let dd = Math.hypot(dx, dz);
    if (dd < 1e-3) { dx = 1; dz = 0; dd = 1; }
    const clearOf = (p0?.baseRad || 0) + C.fallClearance;
    const tx = state.pos.x + (dx / dd) * clearOf;
    const tz = state.pos.z + (dz / dd) * clearOf;
    const gy = groundAt(tx, tz);
    state.to.set(tx, gy + C.crashRestHeight, tz);
    state.tumble = 0;
    state.volleyWind = 0;
    state.volleyLeft = 0;
    state.falls += 1;
    ctx.player?.doctrineKick?.(0.8, 0.7);
    bus.emit("gripBroken", { x: state.pos.x, y: state.pos.y, z: state.pos.z });
  }

  function crash() {
    const p = state.to;
    const gy = groundAt(p.x, p.z);
    state.phase = "stunned";
    state.timer = C.stunnedSeconds;
    state.tumble = 0;
    state.coil = 0;
    state.grip = C.gripMax;
    /* IT HURTS ITSELF. An animal that drops ninety metres onto rock and
       stands up unmarked teaches the player that breaking the grip was
       decoration. This is most of the reward; the melee window is the
       rest. */
    ctx.combat?.damageEnemy?.(inst, C.fallSelfDamage, {
      source: "stylite-fall", x: p.x, y: gy + 1, z: p.z,
    });
    ctx.vfx?.breach?.(p.x, gy, p.z, C.crashRadius * 1.4, 2.6);
    ctx.vfx?.blast?.(p.x, gy + 0.4, p.z, C.crashRadius * 0.8);
    ctx.player?.punch?.(1.7);
    ctx.player?.doctrineKick?.(1.2, 1.0);
    const ps = ctx.player?.state;
    if (ps && !ctx.combat?.player?.dead) {
      const d = Math.hypot(ps.x - p.x, ps.z - p.z);
      if (d < C.crashRadius) {
        ctx.combat.hurtPlayer(C.crashDamage * (1 - d / C.crashRadius)
          * SURVIVAL_CONFIG.enemyDamageMultiplier, {
          source: "stylite-crash", x: ps.x, y: ps.y + 1.0, z: ps.z,
        });
      }
    }
    bus.emit("crash", { x: p.x, y: gy, z: p.z });
  }

  /**
   * Damage the grip. Called from combat.js's authoritative damage path
   * so every weapon contributes in proportion and nothing needs a rule
   * of its own - see `ctx.stylite.wearGrip`.
   *
   * Only while perched: a shot at an animal in mid-air has nothing to
   * tear off a rock, and one at an animal already on the ground has
   * nothing left to break.
   */
  function wearGrip(amount) {
    if (!inst || state.phase !== "perched") return 0;
    const before = state.grip;
    state.grip = Math.max(0, state.grip - Math.max(0, amount) * C.gripShare);
    const worn = before - state.grip;
    if (worn > 0) bus.emit("grip", { grip: state.grip, max: C.gripMax });
    if (state.grip <= 0) beginPlummet();
    return worn;
  }

  /* ------------------------------------------------------------
     PHASES
     ------------------------------------------------------------ */
  function setEncounterGate(hidden, locked = hidden) {
    if (!inst) return;
    inst.encounterHidden = !!hidden;
    inst.encounterLocked = !!locked;
    if (inst.root) inst.root.visible = false;   // an empty anchor
    group.visible = !hidden;
  }

  function beginRouse() {
    state.phase = "rouse";
    state.timer = C.rouseSeconds;
    setEncounterGate(false, true);
    ctx.mission?.announce?.("SOMETHING MOVES ON THE NEEDLES", 3.4);
    bus.emit("aggro", { x: state.pos.x, y: state.pos.y, z: state.pos.z });
    if (state.revealed) return;
    state.revealed = true;
    if (ctx.player?.setFree && !ctx.player.state.free) {
      /* Framed from BELOW, looking up the needle it is on. The whole
         proposition of this fight is that the boss is above you, and
         the reveal should be the shot that says so. */
      const px = ctx.player.state.x;
      const pz = ctx.player.state.z;
      const dx = state.pos.x - px;
      const dz = state.pos.z - pz;
      const d = Math.hypot(dx, dz) || 1;
      const camX = state.pos.x - (dx / d) * 34;
      const camZ = state.pos.z - (dz / d) * 34;
      ctx.player.setFree(true, [camX, groundAt(camX, camZ) + 4, camZ],
        [state.pos.x, state.pos.y, state.pos.z], 54);
      state.releaseCameraAt = 0.7;
    }
  }

  function beginRetire() {
    healToFull();
    clearHazards();
    state.phase = "retire";
    state.timer = C.retireSeconds;
    state.disengageFor = 0;
    bus.emit("retiring", { x: state.pos.x, z: state.pos.z });
  }

  function stepPerched(dt) {
    const ps = ctx.player.state;
    faceThe(ps.x, ps.z, 2.4, dt);
    state.coil = damp(state.coil, 0, 6, dt);
    /* The grip knits back together on a crown it has held for a while,
       which is what makes the pool a burst-damage problem rather than a
       chip-damage one. */
    state.grip = Math.min(C.gripMax, state.grip + C.gripRegen * dt);

    state.perchTimer -= dt;
    state.stoopTimer -= dt;
    state.volleyTimer -= dt;

    if (state.volleyWind > 0) {
      state.volleyWind -= dt;
      if (state.volleyWind <= 0) {
        state.volleyLeft = C.volleyShots;
        state.volleyGap = 0;
      }
    } else if (state.volleyLeft > 0) {
      state.volleyGap -= dt;
      if (state.volleyGap <= 0) {
        fireBolt();
        state.volleyLeft -= 1;
        state.volleyGap = C.volleyGap;
      }
    } else if (state.volleyTimer <= 0) {
      state.volleyTimer = C.volleyCadence;
      state.volleyWind = C.volleyWindup;
      bus.emit("aim", { x: state.pos.x, y: state.pos.y, z: state.pos.z });
    }

    const dist = Math.hypot(ps.x - state.pos.x, ps.z - state.pos.z);
    if (state.stoopTimer <= 0 && dist > C.stoopMinRange) { beginStoop(); return; }
    if (state.perchTimer <= 0) beginLeap(pickPerch());
  }

  function stepFlight(dt, isStoop) {
    state.timer -= dt;
    const total = C.coilSeconds + (isStoop ? C.flightSeconds * 0.8 : C.flightSeconds)
      + C.landSeconds;
    const elapsed = total - state.timer;

    if (elapsed < C.coilSeconds) {
      // The load. Everything about the animal winds down and inward.
      state.coil = smoothstep(elapsed / C.coilSeconds);
      faceThe(state.to.x, state.to.z, 4.5, dt);
      state.pos.lerp(state.from, clamp01(dt * 8));
      return;
    }
    const flightSpan = isStoop ? C.flightSeconds * 0.8 : C.flightSeconds;
    const f = clamp01((elapsed - C.coilSeconds) / flightSpan);
    state.flight = f;
    if (f < 1) {
      if (state.coil > 0) {
        state.coil = 0;
        ctx.vfx?.blast?.(state.from.x, state.from.y, state.from.z, 4.2);
        bus.emit("launch", { x: state.from.x, y: state.from.y, z: state.from.z });
      }
      /* A ballistic arc, not a lerp with a sine on it: the animal
         should visibly slow at the top and accelerate into the landing,
         which is what tells the player when it is going to arrive. */
      state.pos.lerpVectors(state.from, state.to, f);
      state.pos.y += Math.sin(f * Math.PI) * state.arcHeight;
      // Pitched into its own trajectory.
      faceThe(state.to.x, state.to.z, 8, dt);
      state.tumble = Math.sin(f * Math.PI) * 0.12;
      return;
    }
    state.tumble = 0;
    if (state.phase !== "perched") land(isStoop);
  }

  function stepPlummet(dt) {
    state.timer -= dt;
    const f = clamp01(1 - state.timer / C.fallSeconds);
    /* Gravity, not a lerp: it hangs for a moment as the grip goes and
       then arrives fast, which is the difference between falling and
       being lowered. */
    state.pos.lerpVectors(state.from, state.to, f * f);
    state.tumble += dt * (2.2 + f * 5.5);
    state.coil = damp(state.coil, 0.25, 4, dt);
    state.dustTick -= dt;
    if (state.dustTick <= 0) {
      state.dustTick = 0.07;
      ctx.vfx?.spark?.(state.pos.x, state.pos.y, state.pos.z, 0.9, false, true);
    }
    if (state.timer <= 0) crash();
  }

  function stepInstance(dt) {
    if (!inst) return;
    if (inst.state === "death" || inst.health <= 0) {
      if (!state.defeated) {
        state.defeated = true;
        state.phase = "dead";
        if (inst.state !== "death") enemies.kill?.(inst);
        clearHazards();
        ctx.vfx?.breach?.(state.pos.x, groundAt(state.pos.x, state.pos.z),
          state.pos.z, 16, 2.6);
        ctx.player?.doctrineKick?.(1.6, 1.4);
        bus.emit("defeated", { x: state.pos.x, z: state.pos.z });
      }
      return;
    }

    const ps = ctx.player.state;
    const dist = Math.hypot(ps.x - state.pos.x, ps.z - state.pos.z);

    if (state.phase === "dormant") {
      if (!ctx.combat?.player?.dead && dist <= C.aggroRadius) beginRouse();
      return;
    }

    if (state.phase === "retire") {
      state.timer -= dt;
      if (dist <= C.aggroRadius && !ctx.combat?.player?.dead) {
        state.phase = "rouse";
        state.timer = C.rouseSeconds * (1 - state.woken);
        setEncounterGate(false, true);
        bus.emit("aggro", { x: state.pos.x, z: state.pos.z });
        return;
      }
      if (state.timer <= 0) {
        state.phase = "dormant";
        state.revealed = false;
        setEncounterGate(true, true);
        bus.emit("reset", { x: state.pos.x, z: state.pos.z });
      }
      return;
    }

    if (dist > C.disengageRadius) {
      state.disengageFor += dt;
      if (state.disengageFor > C.disengageSeconds) { beginRetire(); return; }
    } else {
      state.disengageFor = 0;
    }

    if (state.phase === "rouse") {
      state.timer = Math.max(0, state.timer - dt);
      faceThe(ps.x, ps.z, 1.6, dt);
      if (state.releaseCameraAt !== undefined && state.timer <= state.releaseCameraAt) {
        ctx.player?.setFree?.(false);
        state.releaseCameraAt = undefined;
      }
      if (state.timer <= 0) {
        state.phase = "perched";
        state.perchTimer = C.perchSeconds[0];
        state.volleyTimer = 1.2;
        state.stoopTimer = C.stoopCadence * 0.6;
        setEncounterGate(false, false);
        bus.emit("engaged", { x: state.pos.x, z: state.pos.z });
      }
      return;
    }

    if (state.phase === "perched") { stepPerched(dt); return; }
    if (state.phase === "leap") { stepFlight(dt, false); return; }
    if (state.phase === "stoop") { stepFlight(dt, true); return; }
    if (state.phase === "plummet") { stepPlummet(dt); return; }

    if (state.phase === "stunned") {
      state.timer = Math.max(0, state.timer - dt);
      state.tumble = damp(state.tumble, 0, 4, dt);
      faceThe(ps.x, ps.z, 0.7, dt);
      if (state.timer <= 0) {
        state.phase = "recover";
        state.timer = C.recoverSeconds;
        bus.emit("recover", { x: state.pos.x, z: state.pos.z });
      }
      return;
    }

    if (state.phase === "recover") {
      state.timer = Math.max(0, state.timer - dt);
      state.coil = damp(state.coil, 0.8, 5, dt);
      if (state.timer <= 0) beginLeap(pickPerch());
    }
  }

  /* ------------------------------------------------------------
     PER-FRAME
     ------------------------------------------------------------ */
  function update(dt) {
    const d = Math.min(0.1, Math.max(0, dt));
    if (!inst) { ensureSpawned(); return; }

    const ps = ctx.player?.state;
    if (ps) {
      lead.vx = damp(lead.vx, (ps.x - lead.x) / Math.max(1e-4, d), 9, d);
      lead.vz = damp(lead.vz, (ps.z - lead.z) / Math.max(1e-4, d), 9, d);
      lead.x = ps.x;
      lead.z = ps.z;
    }

    stepInstance(d);

    const wantWoken = state.phase === "dormant" || state.phase === "retire" ? 0 : 1;
    state.woken = state.phase === "rouse"
      ? clamp01(1 - state.timer / Math.max(1e-4, C.rouseSeconds))
      : damp(state.woken, wantWoken, 2.2, d);

    /* DON'T POSE A HIDDEN ANIMAL.

       `poseBody` damps eighteen joints and then calls
       updateMatrixWorld(true) over the whole rig, and it was running
       every frame from the moment the level loaded - including while
       the Stylite sat dormant and invisible on a needle six hundred
       metres from the player, in every other district's fight. It
       measured as about 1.3ms a frame added to the ENTIRE GAME, which
       is the kind of cost that never shows up in this boss's own
       budget check and quietly pushes somebody else's over.

       `group.visible` is the honest test rather than a distance,
       because the encounter gate already owns that decision: dormant
       means hidden means nothing to draw. Bolts cannot exist while it
       is hidden either - the gate is only closed when it is dormant
       or retired, and both clear the air on the way in. The instance
       mirror below still runs, so the HUD, the hit tests and the
       mission marker keep agreeing about where it is. */
    if (group.visible) {
      poseBody(d);
      updateBolts(d);
    } else {
      body.position.copy(state.pos);
    }

    /* Mirrored onto the instance. Its Y is the live body height, which
       is the whole point: the HUD's range readout, the minimap and
       every hit test have to agree that this animal is ninety metres
       up, because that is the fight. */
    inst.x = state.pos.x;
    inst.y = state.pos.y;
    inst.z = state.pos.z;
    inst.yaw = state.facing;
    /* Read by combat.js's HITBOX.stylite: the melee gate and the
       stunned multiplier both hang off it. */
    inst.grounded = state.phase === "stunned" || state.phase === "recover";
    inst.alerted = state.phase !== "dormant";
    inst.suspicion = inst.alerted ? 1 : 0;
    inst.root.position.set(inst.x, inst.y, inst.z);
  }

  /* ============================================================
     LIFECYCLE
     ============================================================ */
  function healToFull() {
    if (!inst) return;
    inst.health = inst.maxHealth;
    state.grip = C.gripMax;
  }

  function clearHazards() {
    for (const b of bolts) { b.live = false; b.mesh.visible = false; }
  }

  function seat(index) {
    const p = perchPos(index);
    state.perch = clamp(Math.round(index), 0, perches.length - 1);
    state.pos.set(p.x, p.y, p.z);
    state.from.copy(state.pos);
    state.to.copy(state.pos);
    state.facing = Math.atan2(C.homeX - p.x, C.homeZ - p.z);
  }

  function ensureSpawned() {
    if (state.defeated) return null;
    if (inst) return inst;
    seat(0);
    inst = enemies.spawn("stylite", state.pos.x, state.pos.z, {
      yaw: state.facing,
      eventId: "district-boss:choir",
    });
    if (!inst) return null;
    inst.y = state.pos.y;
    inst.grounded = false;
    poseBody(0);
    setEncounterGate(true, true);
    return inst;
  }

  function resetToPerch() {
    state.defeated = false;
    if (!inst) ensureSpawned();
    if (!inst) return;
    healToFull();
    clearHazards();
    state.phase = "dormant";
    state.timer = 0;
    state.woken = 0;
    state.coil = 0;
    state.tumble = 0;
    state.flight = 0;
    state.falls = 0;
    state.revealed = false;
    state.disengageFor = 0;
    state.releaseCameraAt = undefined;
    state.volleyWind = 0;
    state.volleyLeft = 0;
    seat(0);
    inst.grounded = false;
    poseBody(0);
    setEncounterGate(true, true);
    bus.emit("reset", { x: state.pos.x, z: state.pos.z });
  }

  function status() {
    if (!inst) {
      return state.defeated ? {
        phase: "dead", dead: true, defeated: true,
        health: 0, maxHealth: 5400, x: C.homeX, z: C.homeZ,
      } : null;
    }
    return {
      phase: state.phase,
      instanceId: state.defeated || inst.state === "death" ? null : inst.id,
      health: Math.max(0, Math.round(inst.health)),
      maxHealth: Math.round(inst.maxHealth),
      grip: Math.round(state.grip),
      gripMax: C.gripMax,
      gripFraction: Number((state.grip / C.gripMax).toFixed(3)),
      perch: state.perch,
      perches: perches.length,
      grounded: !!inst.grounded,
      airborne: state.phase === "leap" || state.phase === "stoop"
        || state.phase === "plummet",
      altitude: Number((state.pos.y - groundAt(state.pos.x, state.pos.z)).toFixed(1)),
      falls: state.falls,
      coil: Number(state.coil.toFixed(3)),
      bolts: bolts.filter((b) => b.live).length,
      hidden: !!inst.encounterHidden,
      locked: !!inst.encounterLocked,
      dead: inst.state === "death",
      x: Number(state.pos.x.toFixed(2)),
      y: Number(state.pos.y.toFixed(2)),
      z: Number(state.pos.z.toFixed(2)),
    };
  }

  function snapshot() {
    if (!inst) {
      return state.defeated ? {
        phase: "dead", timer: 0, instanceId: null, health: 0,
        maxHealth: 5400, perch: 0, falls: 0, defeated: true,
      } : null;
    }
    /* Bolts in the air are not saved, for the Coulter's reason. The
       PERCH is, because "which needle it is on" is the whole of where
       this boss is, and restoring it to the wrong crown would put it
       across the district from where the player left it.

       AND THE PHASE IS NARROWED HERE, not just on the way back in.
       `restore` already refuses to rebuild a leap or a plummet - those
       are a position on a curve plus a destination, and re-deriving
       them from a name alone would drop the animal through the district
       - but writing the live name into the file anyway meant the SAVE
       SCHEMA saw a phase it did not accept, and rejected the entire
       record. Not the Stylite's record: the whole save, with the
       player's position and mission in it, and no indication that a
       boss caught mid-jump was the reason. A snapshot may only ever
       contain a state the restore path can actually take. */
    const SAVED = new Set(["dormant", "rouse", "perched", "retire", "dead"]);
    return {
      phase: SAVED.has(state.phase) ? state.phase : "perched",
      instanceId: state.defeated || inst.state === "death" ? null : inst.id,
      timer: Number(Math.max(0, state.timer).toFixed(2)),
      health: Math.round(inst.health),
      maxHealth: Math.round(inst.maxHealth),
      perch: state.perch,
      grip: Math.round(state.grip),
      falls: state.falls,
      defeated: state.defeated,
    };
  }

  function restore(saved, restoredEnemies = {}) {
    if (!saved || typeof saved !== "object") return false;
    const byId = restoredEnemies?.byId instanceof Map ? restoredEnemies.byId : new Map();
    const rebound = (typeof saved.instanceId === "string" && byId.get(saved.instanceId))
      || enemies.live.find((c) => c.eventId === "district-boss:choir" && c.key === "stylite")
      || enemies.live.find((c) => c.key === "stylite");
    state.defeated = !!saved.defeated || saved.phase === "dead" || saved.health <= 0;
    if (state.defeated) {
      if (rebound) enemies.remove?.(rebound);
      inst = null;
      state.phase = "dead";
      group.visible = false;
      clearHazards();
      return true;
    }
    inst = rebound || null;
    ensureSpawned();
    if (!inst) return false;
    /* Restored ON A PERCH, whatever it was doing. Mid-leap and
       mid-plummet are both a position on a curve plus a destination,
       and re-deriving those from a phase name alone would drop the
       animal through the district or leave it hanging in open air. */
    const phase = ["dormant", "rouse", "perched", "retire", "dead"]
      .includes(saved.phase) ? saved.phase : "perched";
    state.phase = phase;
    state.revealed = phase !== "dormant";
    state.timer = Math.max(0, Number(saved.timer) || 0);
    state.woken = phase === "dormant" || phase === "retire" ? 0 : 1;
    state.falls = Math.max(0, Math.round(Number(saved.falls) || 0));
    state.grip = clamp(Number(saved.grip) || C.gripMax, 0, C.gripMax);
    state.coil = 0;
    state.tumble = 0;
    state.flight = 0;
    state.disengageFor = 0;
    state.releaseCameraAt = undefined;
    state.volleyWind = 0;
    state.volleyLeft = 0;
    state.perchTimer = C.perchSeconds[0];
    state.stoopTimer = C.stoopCadence;
    seat(Number.isFinite(saved.perch) ? saved.perch : 0);
    clearHazards();
    if (Number.isFinite(saved.health)) {
      inst.health = clamp(saved.health, 1, inst.maxHealth);
    }
    inst.grounded = false;
    poseBody(0);
    setEncounterGate(phase === "dormant", phase === "dormant" || phase === "rouse");
    return true;
  }

  return {
    bus,
    config: C,
    group,
    update,
    status,
    snapshot,
    restore,
    clearHazards,
    ensureSpawned,
    /** Called from combat.js's one authoritative damage path, so every
     *  weapon wears the grip in proportion to what it dealt. */
    wearGrip,
    /** The crowns it uses, for the HUD and for checks. */
    perches() {
      return perches.map((p) => ({
        x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)),
        z: Number(p.z.toFixed(2)),
        /* The crown's radius at the height the animal stands on. Any
           caller reasoning about a LINE to a perch needs it - a camera
           choosing an angle, a marker deciding it is occluded - and
           without it a needle is a point and every one of them looks
           clear. */
        rad: Number(p.rad.toFixed(2)),
        baseRad: Number(p.baseRad.toFixed(2)),
        baseY: Number(p.baseY.toFixed(2)),
      }));
    },
    /** Fold it back onto its needle, with the animation. The arena
     *  boundary's reset path - see district-bosses.js. */
    retire() {
      if (!inst || state.defeated) return null;
      if (state.phase === "dormant" || state.phase === "retire") return null;
      beginRetire();
      return { phase: state.phase };
    },
    resetToPerch,
    forcePhase(phase, timer) {
      if (!inst) return null;
      state.phase = String(phase);
      if (Number.isFinite(timer)) state.timer = timer;
      state.woken = state.phase === "dormant" || state.phase === "retire" ? 0 : 1;
      if (state.phase === "perched") {
        seat(state.perch);
        state.perchTimer = C.perchSeconds[1];
      }
      inst.grounded = state.phase === "stunned" || state.phase === "recover";
      setEncounterGate(state.phase === "dormant",
        state.phase === "dormant" || state.phase === "rouse");
      poseBody(0);
      return { phase: state.phase, timer: state.timer };
    },
    /** Break the grip now, for checks about the fall rather than about
     *  the shooting that earns it. */
    forceFall() {
      if (!inst || state.phase !== "perched") return null;
      state.grip = 0;
      beginPlummet();
      return { phase: state.phase };
    },
    forceLeap(index) {
      if (!inst || state.phase !== "perched") return null;
      beginLeap(Number.isFinite(index) ? index : pickPerch());
      return { phase: state.phase, to: state.perch };
    },
    forceStoop() {
      if (!inst || state.phase !== "perched") return null;
      beginStoop();
      return { phase: state.phase };
    },
    instance() { return inst; },
    dispose() { scene.remove(group); },
  };
}
