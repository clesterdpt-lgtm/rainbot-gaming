/* ============================================================
   APOP DEMON MOGGERS 3D - bosses

   The Algorithm Twins, the Payola Phantom, and Lucifer Lipsync.

   WHAT A BOSS IS FOR, IN THIS KIND OF GAME

   A collectathon boss is not a damage race. It is an EXAM: it asks
   the player to demonstrate, under pressure, the one idea the course
   has spent seven Platinum Records teaching. So each of these three
   is built around a single mechanic that cannot be brute-forced, and
   each mechanic is one the rest of the game already uses:

     THE ALGORITHM TWINS   your own movement, played back at you.
                           The fight is won at the moment the player
                           realises the thing killing them is a
                           recording of themselves, and starts moving
                           on purpose instead of reacting.

     THE PAYOLA PHANTOM    the beat. It is shielded except during a
                           window it opens on a musical cue, and a hit
                           only lands if it lands ON the beat. This is
                           what makes the 124 BPM clock load-bearing
                           rather than decorative.

     LUCIFER LIPSYNC       everything, in three acts. Ranged pop over
                           a rotating stage; then the arena itself
                           turns into a platforming problem while the
                           LED walls fire; then he drops the lipsync
                           and it is a close-quarters fight with a
                           real tell before every strike.

   FIVE RULES EVERY FIGHT IN HERE OBEYS

   1. A PHASE TRANSITION IS AN EVENT, not a threshold. Invulnerable
      window, a staged animation, a camera handoff, an audio cue, a
      HUD change. A boss whose behaviour silently changes at 66% health
      reads as a difficulty spike; the same change announced reads as
      an escalation the player caused.

   2. EVERY STRIKE HAS A TELL. Not a wind-up animation somewhere in the
      general vicinity - a distinct pose, a distinct colour and a
      distinct sound PER ATTACK, so the answer is recognition and not
      reflex.

   3. THE ARENA IS REQUESTED, NOT BUILT. This module owns fights, not
      geometry. It publishes what each fight needs (`ARENAS`) and
      world.js builds it and hands back the pieces it can drive
      (`provideArena`). Every fight degrades to a flat circle if that
      never happens, because a boss that cannot start because a prop
      is missing is worse than a boss in an empty room.

   4. IT LEASHES AND IT RESETS. Leave the arena or die, and the boss
      heals, walks or floats back to its start pose and re-arms
      cleanly. The saintfall bosses do exactly this and for exactly
      this reason: a boss that can be ground down across five deaths
      is a boss with no fight in it, and a boss left frozen mid-phase
      by a player who walked away is a soft-lock.

   5. EVERY CROSS-MODULE CALL IS OPTIONAL-CHAINED. vfx, hud, audio,
      camera, collect and world are all being written in parallel with
      this file. A fight must degrade, never throw.
   ============================================================ */

import * as THREE from "three";
import {
  TAU, clamp, clamp01, lerp, damp, dampAngle, angleDelta, ease, makeRng, Bus,
} from "apop3d/core.js";
import { mergeParts, makePlayerProbe, probePlayer } from "apop3d/enemies.js";

const GRAVITY = -22;
const BPM = 124;
const SEC_PER_BEAT = 60 / BPM;
const ON_BEAT_SECONDS = 0.14;      // matches main.js's window exactly

/* ============================================================
   ARENA REQUESTS

   The contract between this module and world.js. Each entry says
   what the fight needs built, where the fight happens, and which
   pieces of it this module wants a live reference to so it can drive
   them (a rotating stage is a boss behaviour that happens to be made
   of level geometry).

   world.js is expected to call `bosses.provideArena(id, { ... })`
   after it has built a course containing one of these.
   ============================================================ */
export const ARENAS = Object.freeze({
  twins: Object.freeze({
    id: "twins",
    name: "The Algorithm Twins",
    course: 2,                       // The Awards-Show Red Carpet
    center: Object.freeze([0, 0, 0]),
    radius: 21,
    leashRadius: 34,
    /* A MIRROR NEEDS A CENTRE THE PLAYER CAN SEE. The whole fight is
       reflection through this point, so the floor is authored to say
       so: a circular carpet with an axis inlay, and mirror panels on
       the ring wall that show the reflection the twins are already
       performing. Without the visual axis the player never works out
       what the rule is. */
    request: Object.freeze({
      floor: { shape: "circle", radius: 21, material: "carpet.red", inlay: "mirror.axis" },
      wall: { kind: "ring", radius: 21.5, height: 7, material: "stage.truss" },
      props: Object.freeze([
        { kind: "mirrorPanel", count: 8, ring: 20, height: 5.2, facing: "in" },
        { kind: "camera.flashbank", count: 16, ring: 22.5, height: 3 },
        { kind: "riser", count: 4, ring: 11, height: 1.6, size: 3 },
      ]),
      lights: Object.freeze(["spot.magenta", "spot.cyan", "bounce.warm"]),
      spawn: Object.freeze([0, 0, 15]),
      cameraAnchors: Object.freeze({
        intro: [7, 4.2, 12], boss: [0, 11, -27], defeat: [0, 3.5, 9],
      }),
    }),
    // Nothing here moves under this module's control.
    hooks: Object.freeze([]),
  }),

  phantom: Object.freeze({
    id: "phantom",
    name: "The Payola Phantom",
    course: 3,                       // The Streaming Farm Basement
    center: Object.freeze([0, 0, 0]),
    radius: 18,
    leashRadius: 30,
    /* A ROOM THAT KEEPS TIME. Four pylons on the cardinal points,
       because the contract window is announced by them lighting in
       sequence - the player learns to read the room before the sound
       cue, which is what makes the window feel fair on a muted
       browser tab. */
    request: Object.freeze({
      floor: { shape: "circle", radius: 18, material: "basement.grate", inlay: "ledger.grid" },
      wall: { kind: "ring", radius: 18.5, height: 9, material: "server.rack" },
      props: Object.freeze([
        { kind: "pylon", count: 4, ring: 15, height: 4.5, hook: "shieldPylons" },
        { kind: "serverStack", count: 12, ring: 17, height: 3.4 },
        { kind: "cableRun", count: 8, ring: 16 },
      ]),
      lights: Object.freeze(["spot.green", "spot.gold", "bounce.cool"]),
      spawn: Object.freeze([0, 0, 13]),
      cameraAnchors: Object.freeze({
        intro: [5, 3.6, 10], boss: [0, 10, -24], defeat: [0, 3, 8],
      }),
    }),
    hooks: Object.freeze(["shieldPylons"]),
  }),

  lucifer: Object.freeze({
    id: "lucifer",
    name: "Lucifer Lipsync",
    course: 5,                       // Boyz II Hell - Final Livestream
    center: Object.freeze([0, 0, 0]),
    radius: 26,
    leashRadius: 40,
    /* A STADIUM STAGE IN THREE CONFIGURATIONS, because the fight has
       three acts and the room is the thing that changes between them.
       Every hook below is a piece this module actively drives - the
       stage spins in act one, the floor panels drop in act two, and
       the LED walls fire in both. */
    request: Object.freeze({
      floor: { shape: "circle", radius: 26, material: "stage.deck", inlay: "stage.marks" },
      wall: { kind: "ring", radius: 26.5, height: 14, material: "led.wall" },
      props: Object.freeze([
        { kind: "rotatingStage", radius: 15, height: 1.2, hook: "stage" },
        { kind: "ledPanel", count: 12, ring: 25.5, height: 9, hook: "ledWalls" },
        { kind: "floorPanel", count: 12, ring: 9.5, size: 4.5, hook: "floorPanels", drop: 7 },
        { kind: "lift", count: 2, ring: 18, height: 8, hook: "lifts" },
        { kind: "truss", count: 4, ring: 24, height: 13 },
        { kind: "crowdBarrier", count: 1, ring: 26 },
      ]),
      lights: Object.freeze(["spot.red", "spot.white", "spot.violet", "bounce.hot"]),
      spawn: Object.freeze([0, 0, 20]),
      cameraAnchors: Object.freeze({
        intro: [9, 5, 15], boss: [0, 13, -32], phase2: [0, 18, -30], phase3: [0, 6, -16],
        defeat: [0, 4, 11],
      }),
    }),
    hooks: Object.freeze(["stage", "ledWalls", "floorPanels", "lifts"]),
  }),
});

export const BOSS_IDS = Object.freeze(Object.keys(ARENAS));

/* ============================================================
   COURSE BOOKINGS

   Five courses, three fights. The contract fixes the roster at three
   and that is the right number - a collectathon boss is an exam on a
   mechanic, and there are three mechanics worth examining - so the
   extra two courses BOOK an existing act rather than inventing a
   fourth identity nobody has written a fight for.

   A booking is not a reskin. It carries the course's own arena size,
   the phase the fight OPENS in, and the marquee the HUD shows, so the
   second time a player meets an act it is the harder half of it in a
   room the right shape for the course.

     COURSE 1  The Payola Phantom, tight room, act one only. It is the
               first boss in the game and the tutorial for the beat.
     COURSE 2  The Algorithm Twins, in full.
     COURSE 3  The Payola Phantom, in full. This is its home course.
     COURSE 4  The Algorithm Twins, opening DESYNCED. levels.js calls
               this one `bouncer` after the VIP Bouncer Demon on the
               door; there has never been a bouncer FIGHT, and the
               Platinum Record `roof-2` was gated on one. Two identical
               influencers running the door of an afterparty is the
               same joke the twins already are, so the twins take the
               booking and arrive already out of step - the phase a
               player who cleared course 2 has earned.
     COURSE 5  Lucifer Lipsync, in full.

   `id` is the name levels.js uses. It is matched FIRST against the
   course, so one name can mean different things in different courses
   and an unknown one is still an unknown one.
   ============================================================ */
export const BOOKINGS = Object.freeze([
  Object.freeze({
    course: 1, id: "phantom", fight: "phantom",
    title: "THE PAYOLA PHANTOM", subtitle: "THE RETAINER",
    radius: 16, leashRadius: 27, openPhase: 0, closePhase: 0,
  }),
  Object.freeze({ course: 2, id: "twins", fight: "twins" }),
  Object.freeze({ course: 3, id: "phantom", fight: "phantom" }),
  Object.freeze({
    course: 4, id: "bouncer", fight: "twins",
    title: "THE ALGORITHM TWINS", subtitle: "THE DOOR POLICY",
    radius: 13, leashRadius: 21, openPhase: 1,
  }),
  /* Course 5 puts its spawn point sixteen metres from the stage, and
     the stadium arena the fight asks for is twenty-six across - so the
     player used to spawn already inside the trigger ring and the final
     fight began on the load frame, with the camera cutting to an intro
     before the room had been seen. The level is the size it is; the
     ARENA is the part a booking gets to resize. */
  Object.freeze({ course: 5, id: "lucifer", fight: "lucifer", radius: 15, leashRadius: 26 }),
]);

/**
 * Which fight a course means by a name.
 *
 * Exact (course, id) first, then the id as a fight id, then the id as
 * a booking in any course. Returns null for a name no course has ever
 * booked, which is the case `provideArena` has to be loud about: an
 * unknown id used to no-op in silence, and two courses shipped with a
 * Platinum Record gated on a fight that never armed because of it.
 */
export function resolveBooking(id, courseId) {
  const key = String(id || "");
  if (Number.isFinite(courseId)) {
    for (const b of BOOKINGS) if (b.course === courseId && b.id === key) return b;
  }
  if (ARENAS[key]) {
    if (Number.isFinite(courseId)) {
      for (const b of BOOKINGS) if (b.course === courseId && b.fight === key) return b;
    }
    return { course: ARENAS[key].course, id: key, fight: key };
  }
  for (const b of BOOKINGS) if (b.id === key) return b;
  return null;
}

/* ============================================================
   PROXY BODIES

   Same reasoning as the enemy proxies: built from primitives with the
   shading baked into the vertex colours, so a boss is never a black
   silhouette because a course has not allocated its lights yet, and
   never a missing object because character.js is mid-rewrite. A boss
   IS given a rig the moment character.js can build one - see
   `attachRig` - but the fight never depends on that happening.

   Unlike the enemies these are built as a small hierarchy rather than
   one merged mesh, because a boss tell is a POSE: an arm cocked back,
   a body coiled low, a head thrown up. That needs joints.

   SIZE IS A READABILITY REQUIREMENT, NOT A FLOURISH

   A blind critic scored our frames against real Super Mario 64 and the
   single biggest finding was "no subject": figures thirty pixels tall
   lost in a field of props. SM64 answers this by making a boss two to
   five times Mario's height - King Bob-omb, Big Bully, Bowser - so the
   silhouette alone tells you what the room is for at 240p.

   So every body here is authored at roughly human proportion and then
   worn at a SCALE (see `makeActor`), which keeps the pose maths in
   sensible units while putting a shape on screen that cannot be
   confused with an enemy. Reach, stomp radius and effect offsets all
   read the scale, so making a boss bigger makes it bigger, not
   unfair.
   ============================================================ */

function buildTwinBody(palette) {
  const B = THREE.BoxGeometry, S = THREE.SphereGeometry, Cy = THREE.CylinderGeometry;
  const C = THREE.ConeGeometry;
  const root = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true });
  material.name = "apop-boss-proxy";

  const torso = new THREE.Mesh(mergeParts([
    { geo: new Cy(0.34, 0.44, 0.95, 8), colour: palette.base, pos: [0, 0.48, 0] },
    { geo: new B(0.92, 0.16, 0.34), colour: palette.base, pos: [0, 0.92, 0], emissive: 0.15 },
    /* Shoulder flares, in the IDENTITY colour. The mirror only reads
       if the outline does, and the outline of a figure is its
       shoulders - putting the dark trim there made both twins read as
       the same black wedge from ten metres, which is the one thing a
       mirror match cannot afford. */
    { geo: new C(0.30, 0.42, 6), colour: palette.base, pos: [-0.50, 0.86, 0], rot: [0, 0, 0.9], emissive: 0.2 },
    { geo: new C(0.30, 0.42, 6), colour: palette.base, pos: [0.50, 0.86, 0], rot: [0, 0, -0.9], emissive: 0.2 },
    { geo: new B(0.26, 0.70, 0.26), colour: palette.trim, pos: [-0.16, -0.35, 0] },
    { geo: new B(0.26, 0.70, 0.26), colour: palette.trim, pos: [0.16, -0.35, 0] },
  ]), material);
  torso.position.y = 0.72;
  root.add(torso);

  const head = new THREE.Mesh(mergeParts([
    { geo: new S(0.30, 10, 8), colour: palette.base },
    // A visor, not a face. It is a copy of you, and a copy does not
    // get to have an expression.
    { geo: new B(0.52, 0.14, 0.06), colour: palette.visor, pos: [0, 0.04, -0.26], emissive: 0.8 },
    { geo: new Cy(0.33, 0.36, 0.07, 10), colour: palette.trim, pos: [0, 0.30, 0] },
    /* THE RING LIGHT. A halo of it behind the head, which is the one
       shape in this game that reads as "influencer" from across an
       arena and the only thing separating a twin's silhouette from
       the player's own. It is also most of why they are findable in
       a screenshot at all. */
    { geo: new THREE.TorusGeometry(0.62, 0.075, 6, 20), colour: palette.visor, pos: [0, 0.12, 0.30], emissive: 0.9 },
  ]), material);
  head.position.y = 1.12;
  torso.add(head);

  const armGeo = mergeParts([
    { geo: new B(0.17, 0.62, 0.17), colour: palette.trim, pos: [0, -0.28, 0] },
    { geo: new S(0.14, 7, 6), colour: palette.base, pos: [0, -0.62, 0] },
  ]);
  const armL = new THREE.Mesh(armGeo, material);
  armL.position.set(-0.48, 0.82, 0);
  torso.add(armL);
  const armR = new THREE.Mesh(armGeo.clone(), material);
  armR.position.set(0.48, 0.82, 0);
  torso.add(armR);

  /* `top` is NOT `height`. See the FIGHT EXTENT note above
     `extentOf`: `height` is the body a fight's own reach and stomp
     maths is scaled by, and it stops at the shoulders of the figure.
     What a camera has to fit is the whole visible mass, and on a twin
     that is the ring light - torso 0.72, head 1.12 above it, halo
     0.62 + 0.075 of tube standing 0.12 proud of the crown. */
  return {
    root, material, parts: { torso, head, armL, armR },
    height: 1.85, top: 0.72 + 1.12 + 0.12 + 0.62 + 0.075,
  };
}

/* ------------------------------------------------------------
   THE RETAINER - the Payola Phantom's shield

   Sizes live up here because both the body and the shield are built
   against them: the shell is authored to HUG the figure rather than to
   be a generous sphere around it. The old shell cleared the hat by
   half a metre and the hem by two thirds of one, and at the `boss`
   framing that surplus was the part of the boss the top of the screen
   cut off - the shield was cropping the character it belongs to.
   ------------------------------------------------------------ */
const SHIELD_R = 2.10;          // shell radius, authored units
const SHIELD_Y = 1.81;          // shell centre, in the actor's root space
const SHIELD_LIFT = 0.62;       // how far the lid rises when it unlocks
const SHIELD_TIP = 0.34;        // and how far it tips while it does
const SHIELD_IDLE_GLOW = 0.85;  // membrane strength with the contract closed

/**
 * A matcap that is black facing the camera and glows at the rim.
 *
 * A matcap is sampled by the VIEW-SPACE normal, so the centre of the
 * image is the surface pointing at the lens and the edge is the
 * surface turning away from it. Painting a radial ramp into it
 * therefore buys a genuine view-dependent fresnel with no custom
 * shader - and a built-in material keeps three's output colour-space
 * encode, which a hand-written ShaderMaterial silently loses (an
 * authored near-black arrived on screen as (1,1,2) the last time this
 * engine tried it).
 *
 * The centre is black on purpose: under additive blending that adds
 * nothing at all, so the boss inside the shell is never veiled - only
 * its rim is. A smooth ramp is also close to free on the metric the
 * `boss` frame keeps failing, because a gradient has no Laplacian
 * energy while a wireframe is nothing but Laplacian energy.
 */
function makeFresnelMatcap(hex, opts) {
  const o = opts || {};
  const size = 128;
  /* A TIGHT ramp, measured rather than guessed. Additive light does
     almost nothing over the food court's bright tan and a great deal
     over the boss's dark coat, so a generous falloff does not read as
     a shell at all - it reads as the boss being washed out from the
     inside, which costs the figure the very value separation the
     silhouette work just bought it. Confining the light to the outer
     quarter makes it an edge, which is what a fresnel is. */
  const power = o.power === undefined ? 6.0 : o.power;
  /* Under the peak the rim clips to white and the jade identity - the
     colour the pylons, the HUD flash and the projectiles all share -
     goes with it, because an additive saturated hue runs its strongest
     channel into 1.0 long before the other two arrive. */
  const peak = o.peak === undefined ? 0.82 : o.peak;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const g = canvas.getContext("2d");
  const image = g.createImageData(size, size);
  const data = image.data;
  /* The canvas is sRGB and so is the texture that wraps it, so the
     bytes have to be sRGB components. `THREE.Color` stores LINEAR ones
     - writing those straight out re-encodes an already-linear value
     and lands a different hue on screen (jade came out green-heavy and
     dark). Take the sRGB triple off the literal instead. */
  const sr = ((hex >> 16) & 255) / 255;
  const sg = ((hex >> 8) & 255) / 255;
  const sb = (hex & 255) / 255;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = ((x + 0.5) / size) * 2 - 1;
      const ny = ((y + 0.5) / size) * 2 - 1;
      const r = Math.min(1, Math.hypot(nx, ny));
      /* A soft off-axis hot spot riding on the rim. Without it the
         shell is a vignette and reads as a post effect; with it the
         highlight slides around the surface as the camera moves, which
         is the cue that says "this is an object". Multiplied by the
         ramp so it can never light the middle of the shell. */
      const hx = nx + 0.34, hy = ny - 0.42;
      const spec = Math.exp(-(hx * hx + hy * hy) * 9) * 0.38;
      const f = Math.pow(r, power) * (peak + spec);
      const i = (y * size + x) * 4;
      data[i] = clamp01(sr * f) * 255;
      data[i + 1] = clamp01(sg * f) * 255;
      data[i + 2] = clamp01(sb * f) * 255;
      data[i + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;   // CONTRACT §5: colour maps are sRGB
  texture.needsUpdate = true;
  return texture;
}

/**
 * Hard facets, in place of a lathe's smooth normals.
 *
 * A four-sided torus already HAS a square cross-section; three just
 * smooths its normals around the tube, so it renders as a soft plastic
 * pipe and the band's four flat sides never separate in value. Merged
 * shading is baked per vertex here, so flattening the normals first is
 * what turns each side into its own tone - CONTRACT §2.3's "edges
 * catch a different value from their faces", which is the difference
 * between reading as fabricated metal and reading as a tube primitive.
 */
function faceted(geo) {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  if (flat !== geo) geo.dispose();
  flat.computeVertexNormals();
  return flat;
}

/**
 * Half of the cage, as one merged buffer.
 *
 * `sign` +1 builds the lid, -1 the bowl. Two halves rather than one
 * sphere because the fight's single rule is "it is only hittable while
 * the contract window is open", and a thing that OPENS says that in a
 * still frame. A shell that merely dimmed did not: a critic reviewing
 * the frame blind could not tell the shield from a leftover debug
 * volume, which is the whole reason this asset was rebuilt.
 *
 * Everything here has a real cross-section. A four-sided torus is a
 * square-section band, not a wire, so it holds a shaded face at any
 * distance instead of collapsing into the one-pixel line that the
 * old icosphere wireframe was made entirely of.
 *
 * WHY THE HARDWARE ON THE OUTSIDE IS NOT DECORATION
 *
 * Rendered as a pure black shape - CONTRACT §2.3, the test every model
 * in this game has to pass - the assembled boss came back as a FILLED
 * CIRCLE. The figure's own silhouette passes that test easily (brim,
 * collar blade, torn hem, the pen arm held out as a diagonal), and the
 * shell was swallowing every bit of it: a sphere's outline is a circle
 * from every angle a camera can find, which is the same failure the
 * body was rebuilt out of. Ribs that hug the sphere do not help - they
 * are inside the circle by construction.
 * So the outline is broken from the OUTSIDE, at and above the equator:
 * an uneven ring of lugs, one heavy clamp, one instrument housing.
 * Nothing is added at the north pole, which the `boss` framing already
 * crops, and nothing hangs far below the south pole, which floats only
 * about two thirds of a metre over the floor.
 */
function buildShieldHalf(palette, sign) {
  const T = THREE.TorusGeometry, I = THREE.IcosahedronGeometry;
  const B = THREE.BoxGeometry, Cy = THREE.CylinderGeometry;
  const parts = [];
  const R = SHIELD_R;
  const HOOP_LAT = 0.92;                     // radians north/south of the equator
  const hoopR = R * Math.cos(HOOP_LAT);
  const hoopY = sign * R * Math.sin(HOOP_LAT);
  const top = sign > 0;

  /* Four meridian ribs. A quarter torus lies in the XY plane running
     from (R,0,0) to (0,R,0); a Y rotation stations its azimuth and the
     X flip turns the lid's quarter into the bowl's. */
  for (let i = 0; i < 4; i += 1) {
    parts.push({
      geo: faceted(new T(R, 0.125, 4, 7, Math.PI / 2)),
      colour: palette.frame,
      rot: [sign > 0 ? 0 : Math.PI, (i * Math.PI) / 2, 0],
      emissive: 0.05,
    });
  }
  // The latitude hoop the ribs are braced to.
  parts.push({
    geo: faceted(new T(hoopR, 0.115, 4, 20)), colour: palette.frame,
    pos: [0, hoopY, 0], rot: [Math.PI / 2, 0, 0], emissive: 0.05,
  });
  /* Half of the equator band. Closed, the two halves read as one heavy
     seamed ring; open, that ring is visibly torn in two, which is the
     single clearest way to say "unlocked" from across an arena. */
  parts.push({
    geo: faceted(new T(R, 0.13, 4, 26)), colour: palette.frame,
    pos: [0, sign * 0.145, 0], rot: [Math.PI / 2, 0, 0], emissive: 0.09,
  });
  /* The pole lock, and a bolt where each rib crosses the hoop. They sit
     ON the rib azimuths: offset between them they read as loose beads
     threaded onto a hoop rather than as the fasteners holding the cage
     together, which is the whole point of putting them there. */
  parts.push({ geo: new I(0.24, 0), colour: palette.gold, pos: [0, sign * R, 0], emissive: 0.3 });
  for (let i = 0; i < 4; i += 1) {
    const a = (i * Math.PI) / 2;
    parts.push({
      geo: new I(0.15, 0), colour: palette.gold, emissive: 0.26,
      pos: [Math.cos(a) * hoopR, hoopY, -Math.sin(a) * hoopR],
    });
  }

  /* THE LUGS. Deliberately UNEVEN azimuths and a different count per
     half: evenly spaced teeth on a spinning ring average out into a
     slightly fatter circle, which is the shape we are trying to get
     away from. Uneven ones give the outline a beat. Each is a solid
     block roughly half an authored metre across - at 1.35x and twenty
     metres that is tens of pixels, well clear of the sub-pixel width
     that made the old wire shell read as noise. */
  /* Azimuth `a` measures from +X toward -Z, matching the bolt ring
     above; a Y rotation of `a` therefore points a part's local +X
     straight out along that radius, and `[0, a, PI/2]` stands a
     cylinder's axis on the same radius. Both are used below - getting
     either wrong leaves hardware lying tangentially against the shell
     where it adds nothing to the outline. */
  const lugs = top ? [0.0, 0.9, 2.0, 3.3, 4.6] : [0.5, 2.6, 4.3];
  for (const a of lugs) {
    const rr = R * 1.06;
    parts.push({
      geo: new B(0.56, 0.26, 0.34), colour: palette.frame, emissive: 0.12,
      pos: [Math.cos(a) * rr, sign * 0.20, -Math.sin(a) * rr], rot: [0, a, 0],
    });
    parts.push({
      geo: new Cy(0.11, 0.11, 0.16, 6), colour: palette.gold, emissive: 0.34,
      pos: [Math.cos(a) * (rr + 0.30), sign * 0.20, -Math.sin(a) * (rr + 0.30)],
      rot: [0, a, Math.PI / 2],
    });
  }

  /* ONE clamp, on ONE side, spanning the seam. Its jaw is on the lid
     and its catch on the bowl, so the thing that most obviously says
     "locked" is also the thing that most obviously comes apart when
     presentShield lifts the lid. It is the heaviest mass outside the
     sphere and it is what makes the silhouette lopsided. */
  {
    const a = 1.45, rr = R * 1.05;
    const cx = Math.cos(a) * rr, cz = -Math.sin(a) * rr;
    if (top) {
      parts.push({
        geo: new B(0.62, 0.86, 0.34), colour: palette.frame, emissive: 0.14,
        pos: [cx, 0.42, cz], rot: [0, a, -0.10],
      });
      parts.push({
        geo: new B(0.74, 0.22, 0.42), colour: palette.gold, emissive: 0.30,
        pos: [Math.cos(a) * (rr + 0.14), 0.74, -Math.sin(a) * (rr + 0.14)], rot: [0, a, -0.10],
      });
      parts.push({
        geo: new Cy(0.14, 0.14, 0.50, 6), colour: palette.gold, emissive: 0.38,
        pos: [Math.cos(a) * (rr + 0.30), 0.30, -Math.sin(a) * (rr + 0.30)], rot: [0, a, 0.12],
      });
    } else {
      parts.push({
        geo: new B(0.54, 0.52, 0.30), colour: palette.frame, emissive: 0.10,
        pos: [cx, -0.30, cz], rot: [0, a, 0.10],
      });
      parts.push({
        geo: new B(0.66, 0.18, 0.38), colour: palette.trim, emissive: 0.26,
        pos: [Math.cos(a) * (rr + 0.10), -0.54, -Math.sin(a) * (rr + 0.10)], rot: [0, a, 0.10],
      });
    }
  }

  /* THE GOLD RECORD - the one thing here that actually beats the
     circle.
     Lugs and brackets were the first attempt and they failed the black
     shape test outright: against a sphere of radius 2.1 a bump of 0.4
     is a fifth of the radius and the outline still resolved to a
     circle with pimples. Nothing SITTING ON a sphere can win, because
     the sphere sets the scale. What wins is a second mass on a
     different axis - a broad flat annulus, canted well off level,
     reaching 40% past the shell.
     A tipped ellipse crossing a circle is unmistakable at any size and
     it hands the shape the diagonal the body's outstretched arm gives
     the figure, which is the same fix and the same reason: the eye
     finds a diagonal before it finds anything else.
     It is a RECORD, cut into three uneven arcs with a counterweight on
     the longest. On theme - this is the payola boss and the game's
     collectible is a Platinum Record - and, being broken and uneven,
     it reads as fabricated rather than as a primitive.
     Cheap on the metric that matters, too: a wide flat band has a
     large uniform interior, so it OCCLUDES more busy background than
     the two outlines it adds. It is on the bowl so that the lid lifts
     out of it - the ring stays put and the separation reads. */
  if (!top) {
    const RING_R = R * 1.42, RING_W = 0.40, RING_Y = 0.52;
    /* A torus is authored in its own XY plane starting at angle zero,
       and mergeParts applies one Euler in XYZ order - which rotates by
       Z FIRST. So the Z slot places an arc's start angle inside the
       ring's own plane, and X/Y then cant the whole plane. Both facts
       are used: the arcs differ only in that Z. */
    /* Cant and height, chosen against the FLOOR rather than by eye.
       The OPEN frame is what constrains this, not the closed one:
       presentShield drops the bowl by 0.55 of SHIELD_LIFT, tips it by
       0.4 of SHIELD_TIP and swells the group to 1.1, and all three
       stack on the ring's own reach. Measured on the live open frame,
       a 0.58 cant on the equator put the rim 0.24 m UNDER the food
       court floor while the split was still only a quarter of the way
       out. Solving for half a metre of clearance at full split gives
       roughly 0.46, with the ring carried a little above the seam.
       sin(0.46) is still 0.44, so this is a plainly slanted ellipse
       and not a brim - the silhouette read survives the constraint.
       Re-derive both if SHIELD_LIFT, SHIELD_TIP or PHANTOM_HOVER move. */
    const TILT_X = Math.PI / 2 - 0.42, TILT_Y = 0.25;
    const ringQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(TILT_X, TILT_Y, 0, "XYZ"));
    const ringPoint = (angle, radius) => {
      const v = new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      v.applyQuaternion(ringQuat);
      return [v.x, v.y + RING_Y, v.z];
    };
    // Uneven arcs, uneven gaps. An unbroken ring is another perfect
    // curve and we are trying to get away from those.
    const arcs = [[0.35, 2.45], [3.15, 1.55], [5.15, 0.85]];
    for (const [from, len] of arcs) {
      const seg = Math.max(6, Math.round(len * 9));
      parts.push({
        geo: faceted(new T(RING_R, RING_W, 4, seg, len)),
        colour: palette.coat, scale: [1, 1, 0.24], emissive: 0.06,
        pos: [0, RING_Y, 0], rot: [TILT_X, TILT_Y, from],
      });
      /* The gold is a LABEL on one arc, not a lip around all three.
         Ringing the whole rim in gold cost 0.3 of Laplacian energy on
         the `boss` frame all by itself, measured in one session against
         the same pose - which is a third of what replacing the old wire
         shell had just bought back. A long, bright, high-contrast edge
         is the same thing the wireframe was, only curved. Confined to
         the short arc it is an accent the eye can find and a fifth of
         the edge length. */
      if (len < 1.0) {
        parts.push({
          geo: faceted(new T(RING_R + RING_W * 0.80, 0.15, 4, seg, len)),
          colour: palette.gold, scale: [1, 1, 0.58], emissive: 0.22,
          pos: [0, RING_Y, 0], rot: [TILT_X, TILT_Y, from],
        });
      }
    }
    /* The counterweight. One heavy block on one arc: the ring is now
       lopsided in its own plane as well as tipped out of the shell's,
       so no rotation of the group brings the silhouette back to
       something symmetrical. */
    parts.push({
      geo: new B(0.80, 0.42, 0.58), colour: palette.frame, emissive: 0.14,
      pos: ringPoint(1.15, RING_R + 0.02), rot: [TILT_X, TILT_Y, 1.15],
    });
    parts.push({
      geo: new Cy(0.16, 0.16, 0.30, 6), colour: palette.gold, emissive: 0.36,
      pos: ringPoint(1.15, RING_R + 0.44), rot: [TILT_X, TILT_Y, 1.15 + Math.PI / 2],
    });
  }

  /* THE PAYOLA METER, on the bowl and nowhere near the clamp. A second
     lopsided mass at a different height and a different azimuth, so the
     shape does not resolve back into a circle with one bump on it as
     the cage turns. It is the fight's own jade, because the one thing
     an instrument on a shield can usefully say is how much of the
     contract is left. */
  if (!top) {
    const a = 4.05, rr = R * 1.00;
    parts.push({
      geo: new B(0.46, 0.58, 0.40), colour: palette.frame, emissive: 0.12,
      pos: [Math.cos(a) * rr, -0.46, -Math.sin(a) * rr], rot: [0, a, 0.16],
    });
    parts.push({
      geo: new Cy(0.19, 0.19, 0.16, 8), colour: palette.trim, emissive: 0.44,
      pos: [Math.cos(a) * (rr + 0.30), -0.52, -Math.sin(a) * (rr + 0.30)],
      rot: [0, a, Math.PI / 2],
    });
    parts.push({
      geo: new B(0.16, 0.34, 0.16), colour: palette.gold, emissive: 0.28,
      pos: [Math.cos(a) * (rr + 0.06), -0.82, -Math.sin(a) * (rr + 0.06)], rot: [0, a, 0.28],
    });
  }
  return mergeParts(parts);
}

function buildPhantomBody(palette) {
  const S = THREE.SphereGeometry, Cy = THREE.CylinderGeometry, C = THREE.ConeGeometry, B = THREE.BoxGeometry;
  const root = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true });

  /* THE SILHOUETTE, which is the only test this figure has to pass.
     It used to be a smooth cone with a ball on top - reviewed blind as
     "a cone", and elsewhere "the most inert silhouette available".
     CONTRACT §2.3 says test every model as a black shape, and a cone
     fails that test at any resolution because it is symmetric about
     every axis a camera can find and has no interior edges at all.

     So the read is built from four deliberately unbalanced masses:
     a wide TILTED brim, a tall collar fan canted off the spine, a
     heavy shoulder bar, and a hem that TEARS into tatters of unequal
     length instead of closing to a point. Then one long diagonal - an
     outstretched arm holding a contract pen - because a diagonal is
     the one thing the old shape had none of, and the eye finds a
     diagonal in a still frame before it finds anything else. */
  const torso = new THREE.Mesh(mergeParts([
    /* A FLARED coat, not a spike. An inverted cone narrows to nothing
       exactly where a hovering figure needs its mass, which is what
       made the old body read as traffic furniture. */
    { geo: new Cy(0.62, 1.02, 1.35, 8), colour: palette.base, pos: [0, -0.08, 0] },
    // An overlapping panel of the coat, off-axis, so the drape is not
    // a lathe.
    { geo: new Cy(0.50, 0.86, 1.10, 6), colour: palette.coat, pos: [0.15, -0.16, -0.10], rot: [0, 0.42, 0.11] },
    { geo: new Cy(0.66, 0.66, 0.14, 8), colour: palette.gold, pos: [0, 0.56, 0], emissive: 0.22 },

    /* The hem, torn. Seven tails at uneven lengths and lean - and
       TAPERED STRIPS, not spikes: a cone comes to a needle point and
       seven needles read as teeth, which is a different creature. Each
       is flattened across its width so it is a strip of cloth seen
       edge-on rather than a stalactite. */
    { geo: new Cy(0.24, 0.07, 1.14, 4), colour: palette.coat, scale: [1.5, 1, 0.55], pos: [-0.44, -1.25, 0.30], rot: [0, 0.4, 0.16] },
    { geo: new Cy(0.20, 0.09, 0.55, 4), colour: palette.coat, scale: [1.4, 1, 0.5], pos: [0.52, -0.95, 0.34], rot: [0, -0.5, -0.20] },
    { geo: new Cy(0.22, 0.06, 0.86, 4), colour: palette.coat, scale: [1.5, 1, 0.5], pos: [0.14, -1.10, -0.70], rot: [0, 1.4, 0.07] },
    { geo: new Cy(0.25, 0.08, 1.02, 4), colour: palette.coat, scale: [1.4, 1, 0.55], pos: [-0.62, -1.18, -0.36], rot: [0, -1.1, 0.22] },
    { geo: new Cy(0.18, 0.07, 0.42, 4), colour: palette.coat, scale: [1.3, 1, 0.5], pos: [0.70, -0.88, -0.22], rot: [0, 0.9, -0.26] },
    { geo: new Cy(0.23, 0.06, 0.95, 4), colour: palette.coat, scale: [1.5, 1, 0.5], pos: [0.30, -1.14, 0.62], rot: [0, -0.3, -0.12] },
    { geo: new Cy(0.19, 0.08, 0.68, 4), colour: palette.coat, scale: [1.4, 1, 0.55], pos: [-0.20, -1.00, 0.74], rot: [0, 0.2, 0.09] },

    // Chest and the shoulder bar. Width is the read; the bar is nearly
    // two authored metres across and it is the widest thing on the
    // figure after the collar.
    { geo: new B(1.14, 0.74, 0.62), colour: palette.base, pos: [0, 0.98, 0] },
    { geo: new B(1.98, 0.24, 0.66), colour: palette.coat, pos: [0, 1.30, 0], emissive: 0.08 },
    // Pauldrons, one plainly bigger than the other.
    { geo: new C(0.52, 0.56, 5), colour: palette.coat, pos: [-0.92, 1.34, 0], rot: [0, 0, 1.05], emissive: 0.1 },
    { geo: new C(0.36, 0.40, 5), colour: palette.coat, pos: [0.94, 1.28, 0], rot: [0, 0, -1.25], emissive: 0.1 },
    // The jade placket and the label badge: the only two bright things
    // on the body, both on the centre line, both facing the player.
    { geo: new B(0.22, 0.92, 0.10), colour: palette.trim, pos: [0, 0.92, -0.34], emissive: 0.3 },
    { geo: new B(0.30, 0.16, 0.12), colour: palette.gold, pos: [0, 1.20, -0.36], emissive: 0.5 },

    /* THE COLLAR. One fan, swept up and back and canted off the spine.
       Two symmetric blades would have handed the silhouette its axis
       back; one blade is what makes the top of this shape unmistakably
       lopsided at any distance. */
    { geo: new C(0.80, 1.20, 4), colour: palette.coat, scale: [1.30, 1, 0.30],
      pos: [-0.12, 1.72, 0.30], rot: [-0.50, 0.18, 0.22] },
    { geo: new C(0.64, 0.98, 4), colour: palette.trim, scale: [1.28, 1, 0.26],
      pos: [-0.10, 1.66, 0.16], rot: [-0.50, 0.18, 0.22], emissive: 0.3 },

    // The retainer's ledger, chained to the belt on one side. A
    // hanging object is the cheapest asymmetry there is.
    { geo: new Cy(0.025, 0.025, 0.70, 4), colour: palette.gold, pos: [0.62, 0.52, -0.20], rot: [0, 0, -0.10] },
    { geo: new B(0.32, 0.42, 0.14), colour: palette.frame, pos: [0.58, 0.14, -0.22], rot: [0, 0.25, -0.12] },
    { geo: new B(0.34, 0.08, 0.17), colour: palette.gold, pos: [0.58, 0.32, -0.22], rot: [0, 0.25, -0.12], emissive: 0.3 },
  ]), material);
  torso.position.y = 1.62;
  root.add(torso);

  /* No face. A wide brim with a void under it, tilted off level, and
     two gold points where the eyes would be - which is the whole
     expression this character is allowed and the reason the head does
     not read as a ball. */
  const head = new THREE.Mesh(mergeParts([
    { geo: new S(0.34, 8, 6), colour: palette.head, scale: [1, 1.05, 0.94] },
    { geo: new Cy(0.84, 0.84, 0.075, 12), colour: palette.coat, pos: [0.02, 0.20, 0.01], rot: [0.15, 0, -0.14] },
    { geo: new Cy(0.545, 0.545, 0.13, 10), colour: palette.trim, pos: [0.02, 0.29, 0.01], rot: [0.15, 0, -0.14], emissive: 0.32 },
    { geo: new Cy(0.42, 0.52, 0.62, 10), colour: palette.coat, pos: [0.03, 0.56, 0.02], rot: [0.15, 0, -0.14] },
    { geo: new S(0.075, 6, 5), colour: palette.gold, pos: [-0.145, 0.01, -0.29], emissive: 0.95 },
    { geo: new S(0.075, 6, 5), colour: palette.gold, pos: [0.145, 0.01, -0.29], emissive: 0.95 },
  ]), material);
  head.position.y = 1.38;
  torso.add(head);

  /* THE ARMS ARE NOT A PAIR. The right one is long and already
     extended, holding the pen it wants you to sign with; the left is
     cocked up under a fan of paper. Both are one rigid buffer each -
     poseActor turns them at the shoulder - so the elbow bend is baked
     into the geometry rather than jointed. */
  /* THE OFFER. Reaching out and down-forward with the pen presented,
     not hanging at the side: an arm that hangs is inside the coat's
     own outline and contributes nothing to the silhouette, which is
     exactly what the first pass of this figure did with it. Held out,
     it is the one long diagonal in the shape - and it stays a hair
     inside the shell, because a pen through a sealed cage would say
     the cage is not sealed. */
  const armR = new THREE.Mesh(mergeParts([
    { geo: new B(0.21, 0.66, 0.21), colour: palette.base, pos: [0.05, -0.225, -0.20], rot: [0.727, 0, 0.165] },
    { geo: new Cy(0.19, 0.21, 0.13, 8), colour: palette.trim, pos: [0.115, -0.56, -0.53], rot: [0.843, 0, 0.115], emissive: 0.28 },
    { geo: new B(0.17, 0.64, 0.17), colour: palette.base, pos: [0.135, -0.65, -0.625], rot: [0.843, 0, 0.115] },
    { geo: new S(0.155, 7, 6), colour: palette.head, pos: [0.17, -0.87, -0.87] },
    { geo: new Cy(0.022, 0.085, 0.80, 6), colour: 0x14161f, pos: [0.270, -1.089, -1.189], rot: [-2.17, 0, -0.252] },
    { geo: new Cy(0.10, 0.10, 0.12, 6), colour: palette.gold, pos: [0.200, -0.936, -0.966], rot: [-2.17, 0, -0.252], emissive: 0.3 },
    { geo: new C(0.085, 0.20, 6), colour: palette.gold, pos: [0.357, -1.281, -1.468], rot: [-2.17, 0, -0.252], emissive: 0.45 },
  ]), material);
  armR.position.set(0.88, 1.20, 0);
  torso.add(armR);

  const armL = new THREE.Mesh(mergeParts([
    { geo: new B(0.21, 0.50, 0.21), colour: palette.base, pos: [0, -0.25, 0] },
    { geo: new Cy(0.19, 0.21, 0.13, 8), colour: palette.trim, pos: [0, -0.48, 0], emissive: 0.28 },
    { geo: new B(0.17, 0.52, 0.17), colour: palette.base, pos: [-0.04, -0.62, -0.22], rot: [-1.05, 0, 0.16] },
    { geo: new S(0.155, 7, 6), colour: palette.head, pos: [-0.05, -0.46, -0.52] },
    // The contract, fanned. Paper is the brightest value on the figure
    // and it sits at the end of the raised arm on purpose.
    { geo: new B(0.46, 0.60, 0.06), colour: palette.paper, pos: [-0.10, -0.34, -0.60], rot: [-0.30, 0.22, 0.16] },
    { geo: new B(0.38, 0.52, 0.06), colour: 0xcfcab4, pos: [0.08, -0.40, -0.55], rot: [-0.22, -0.30, -0.14] },
    { geo: new Cy(0.09, 0.09, 0.05, 6), colour: palette.trim, pos: [-0.17, -0.29, -0.65], rot: [-0.30, 0.22, 0.16], emissive: 0.4 },
  ]), material);
  armL.position.set(-0.86, 1.24, 0);
  torso.add(armL);

  /* THE SHIELD. Its own object because it is the fight: it has to be
     unmistakably ON, unmistakably OFF, and readable in the half second
     between. It is now a brass cage in two halves around a fresnel
     membrane, and it OPENS - see presentShield. What it replaced was a
     thin uniform green wireframe icosphere, which reviewed blind as a
     leftover debug volume and, being nothing but bright one-pixel
     lines on a dark field, was also the worst possible shape for the
     high-frequency metric the `boss` capture keeps failing. */
  const shieldFrameMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  shieldFrameMat.name = "apop-phantom-shield-frame";
  const shieldMat = new THREE.MeshMatcapMaterial({
    matcap: makeFresnelMatcap(palette.shield),
    transparent: true,
    opacity: SHIELD_IDLE_GLOW,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: true,
    /* FOG OFF, and this is not optional on an additive surface. Fog
       mixes the fragment toward the airlight before the blend, so an
       additive object ADDS the whole airlight colour across its entire
       area - the shell came back as a flat mint disc with no fresnel
       left in it at all. Distance knockdown is for surfaces that
       occlude; this one only ever adds light. */
    fog: false,
  });
  shieldMat.name = "apop-phantom-shield-field";

  const shield = new THREE.Group();
  shield.position.y = SHIELD_Y;
  const shieldTop = new THREE.Mesh(buildShieldHalf(palette, 1), shieldFrameMat);
  const shieldBottom = new THREE.Mesh(buildShieldHalf(palette, -1), shieldFrameMat);
  const shieldField = new THREE.Mesh(new THREE.SphereGeometry(SHIELD_R - 0.16, 26, 18), shieldMat);
  shield.add(shieldTop, shieldBottom, shieldField);
  root.add(shield);

  return {
    root, material, shieldMat, shieldFrameMat, shieldTop, shieldBottom,
    parts: { torso, head, armL, armR, shield, shieldTop, shieldBottom, shieldField },
    height: 3.9,
    /* The shell, not the figure. The brim tops out at 3.87 and the
       collar fan at 3.87, so the north pole of the retainer is the
       highest thing on this boss by four centimetres.
       SHIELD_LIFT is deliberately NOT added. The lid does rise by that
       much while the contract window is open, but it is open for a
       beat and a half out of eight, and measured, budgeting for it
       cost the `boss` capture outright: at 1.35 scale it adds 0.84 m
       to the fight's extent, camera.js lifts its aim by half of
       whatever this returns, and the boss left the top of the frame.
       The steady silhouette is what a still is framed on. */
    top: SHIELD_Y + SHIELD_R,
  };
}

function buildLuciferBody(palette) {
  const S = THREE.SphereGeometry, B = THREE.BoxGeometry, Cy = THREE.CylinderGeometry, C = THREE.ConeGeometry;
  const root = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true });

  const torso = new THREE.Mesh(mergeParts([
    { geo: new B(1.05, 1.15, 0.62), colour: palette.base, pos: [0, 0.30, 0] },
    { geo: new B(1.55, 0.26, 0.72), colour: palette.trim, pos: [0, 0.86, 0], emissive: 0.2 },
    // A jacket flare, so the silhouette is a wedge rather than a box.
    { geo: new C(0.95, 1.0, 6), colour: palette.trim, pos: [0, -0.30, 0], rot: [Math.PI, 0, 0] },
    { geo: new B(0.30, 1.1, 0.10), colour: palette.gold, pos: [0, 0.34, -0.33], emissive: 0.5 },
    /* THE COLLAR. Swept up and back behind the head, so the top of
       the silhouette is a fan and not a ball on a box - the read that
       says "final boss" from the back of a stadium. */
    { geo: new C(1.30, 1.45, 5), colour: palette.trim, pos: [0, 1.30, 0.34], rot: [-0.42, 0, 0], emissive: 0.22 },
    { geo: new B(0.34, 0.80, 0.34), colour: palette.dark, pos: [-0.28, -0.72, 0] },
    { geo: new B(0.34, 0.80, 0.34), colour: palette.dark, pos: [0.28, -0.72, 0] },
  ]), material);
  torso.position.y = 1.35;
  root.add(torso);

  const head = new THREE.Mesh(mergeParts([
    { geo: new S(0.36, 10, 8), colour: palette.head },
    { geo: new S(0.40, 8, 6), colour: palette.hair, pos: [0, 0.16, 0.05], scale: [1.05, 0.8, 1.05] },
    // Horns. Two of them, swept back, and they are the whole read at
    // stadium distance - so they are sized for that distance, not for
    // a portrait.
    { geo: new C(0.15, 0.86, 6), colour: palette.gold, pos: [-0.30, 0.54, 0.10], rot: [0.5, 0, 0.45], emissive: 0.3 },
    { geo: new C(0.15, 0.86, 6), colour: palette.gold, pos: [0.30, 0.54, 0.10], rot: [0.5, 0, -0.45], emissive: 0.3 },
    { geo: new B(0.44, 0.11, 0.06), colour: 0x120206, pos: [0, 0.02, -0.31], emissive: 0.3 },
  ]), material);
  head.position.y = 1.16;
  torso.add(head);

  const armGeo = mergeParts([
    { geo: new B(0.24, 0.95, 0.24), colour: palette.base, pos: [0, -0.44, 0] },
    { geo: new S(0.19, 7, 6), colour: palette.head, pos: [0, -0.94, 0] },
  ]);
  const armL = new THREE.Mesh(armGeo, material);
  armL.position.set(-0.72, 0.72, 0);
  torso.add(armL);
  const armR = new THREE.Mesh(armGeo.clone(), material);
  armR.position.set(0.72, 0.72, 0);
  torso.add(armR);

  /* THE MIC. Phase 3 opens with him throwing it away, so it has to be
     an object and not a decoration painted on his hand. */
  const mic = new THREE.Mesh(mergeParts([
    { geo: new Cy(0.055, 0.055, 0.36, 6), colour: palette.dark },
    { geo: new S(0.11, 7, 6), colour: palette.gold, pos: [0, 0.24, 0], emissive: 0.4 },
  ]), material);
  mic.position.set(0, -0.98, -0.06);
  armR.add(mic);

  /* The horns are the top of him, not the collar: head origin 2.51
     above the root, and a 0.86 cone raked back off it reaches 0.88
     more. The collar apex lands 3.31, nine centimetres under. */
  return {
    root, material, parts: { torso, head, armL, armR, mic },
    height: 2.55, top: 3.42,
  };
}

/* ============================================================
   THE BEAT CLOCK

   ctx.clock carries the beat, written by main.js until audio.js takes
   over. The Payola Phantom's entire fight is built on it, and
   Lucifer's phase one fires on it, so this wrapper does two things
   the raw field cannot: it detects the EDGE (a beat that has just
   happened, which is what a schedule needs), and it notices if the
   authority has gone quiet and falls back to deriving the beat from
   clock.t rather than letting a boss freeze mid-cycle.
   ============================================================ */
function makeBeatClock(ctx) {
  let lastIndex = -1;
  let lastChangeAt = 0;
  let ownIndex = -1;
  let fired = false;

  return {
    /** Called once per frame, before anything reads the beat. */
    tick() {
      const c = ctx.clock || {};
      const t = c.t || 0;
      const external = Number.isFinite(c.beatIndex) ? c.beatIndex : -1;
      if (external !== lastIndex) {
        lastIndex = external;
        lastChangeAt = t;
      }
      // The authority has stalled: derive our own so the schedule
      // keeps running. Two seconds is four beats at 124 BPM - long
      // enough that a paused frame does not trip it.
      const stalled = t - lastChangeAt > 2.0;
      const index = stalled ? Math.floor(t / SEC_PER_BEAT) : external;
      fired = index !== ownIndex && ownIndex !== -1;
      if (index !== ownIndex) ownIndex = index;
      this.index = ownIndex;
      this.phase = stalled || !Number.isFinite(c.beat)
        ? (t / SEC_PER_BEAT) - Math.floor(t / SEC_PER_BEAT)
        : c.beat;
      const toNearest = Math.min(this.phase, 1 - this.phase) * SEC_PER_BEAT;
      this.onBeat = stalled || c.onBeat === undefined
        ? toNearest <= ON_BEAT_SECONDS
        : !!c.onBeat;
      this.fired = fired;
    },
    index: 0, phase: 0, onBeat: false, fired: false,
  };
}

/* ============================================================
   MODULE
   ============================================================ */

let instance = null;

export function create(ctx) {
  const NS = ctx.THREE || THREE;
  const bus = new Bus();
  const rng = makeRng(0xB055);
  const beat = makeBeatClock(ctx);

  const group = new NS.Group();
  group.name = "apop-bosses";
  ctx.scene.add(group);

  const player = makePlayerProbe(NS);

  const tmp = {
    v1: new NS.Vector3(), v2: new NS.Vector3(), v3: new NS.Vector3(),
    colour: new NS.Color(), m4: new NS.Matrix4(), quat: new NS.Quaternion(),
    euler: new NS.Euler(0, 0, 0, "YXZ"), scale: new NS.Vector3(1, 1, 1),
  };

  /* ------------------------------------------------------------
     Shared projectile pool. Every fight shoots something; one
     instanced mesh serves all of them, which is one draw call for
     every note, cheque and mic stand on the stage.
     ------------------------------------------------------------ */
  const SHOT_MAX = 48;
  const shotMaterial = new NS.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
  const shotGeo = mergeParts([
    { geo: new NS.IcosahedronGeometry(0.34, 0), colour: 0xffffff, emissive: 0.7 },
    { geo: new NS.TorusGeometry(0.42, 0.08, 4, 8), colour: 0xffffff, rot: [1.5708, 0, 0], emissive: 0.4 },
  ]);
  const shotMesh = new NS.InstancedMesh(shotGeo, shotMaterial, SHOT_MAX);
  shotMesh.name = "apop-boss-shots";
  shotMesh.instanceMatrix.setUsage(NS.DynamicDrawUsage);
  shotMesh.frustumCulled = false;
  shotMesh.count = 0;
  shotMesh.instanceColor = new NS.InstancedBufferAttribute(new Float32Array(SHOT_MAX * 3).fill(1), 3);
  shotMesh.instanceColor.setUsage(NS.DynamicDrawUsage);
  group.add(shotMesh);

  const shots = [];
  for (let i = 0; i < SHOT_MAX; i += 1) {
    shots.push({
      live: false, life: 0, spin: 0, gravity: 1, radius: 0.6, damage: 1,
      homing: 0, colour: 0xffffff, owner: null,
      pos: new NS.Vector3(), vel: new NS.Vector3(),
    });
  }
  let shotCursor = 0;

  function fire(owner, from, velocity, opts) {
    const s = shots[shotCursor];
    shotCursor = (shotCursor + 1) % SHOT_MAX;
    s.live = true;
    s.owner = owner;
    s.life = (opts && opts.life) || 4;
    s.gravity = (opts && opts.gravity !== undefined) ? opts.gravity : 1;
    s.radius = (opts && opts.radius) || 0.6;
    s.damage = (opts && opts.damage) || 1;
    s.homing = (opts && opts.homing) || 0;
    s.colour = (opts && opts.color) || 0xffffff;
    s.spin = 0;
    s.pos.copy(from);
    s.vel.copy(velocity);
    ctx.vfx?.burst?.("sparkle", from, { color: s.colour, count: 5 });
    return s;
  }

  /** Fixed-flight-time ballistic solve. The arc is consistent at every
   *  range, so the player learns one rhythm and it holds. */
  function fireArc(owner, from, target, flight, opts) {
    tmp.v1.set(
      (target.x - from.x) / flight,
      ((target.y + 0.9) - from.y) / flight - 0.5 * GRAVITY * flight,
      (target.z - from.z) / flight
    );
    return fire(owner, from, tmp.v1, opts);
  }

  function updateShots(dt) {
    for (let i = 0; i < shots.length; i += 1) {
      const s = shots[i];
      if (!s.live) continue;
      s.life -= dt;
      s.spin += dt * 6;
      if (s.homing > 0 && player.ok) {
        tmp.v1.set(player.pos.x - s.pos.x, (player.pos.y + 0.9) - s.pos.y, player.pos.z - s.pos.z);
        const d = tmp.v1.length() || 1;
        const speed = s.vel.length() || 1;
        s.vel.x = damp(s.vel.x, (tmp.v1.x / d) * speed, s.homing, dt);
        s.vel.y = damp(s.vel.y, (tmp.v1.y / d) * speed, s.homing, dt);
        s.vel.z = damp(s.vel.z, (tmp.v1.z / d) * speed, s.homing, dt);
      }
      s.vel.y += GRAVITY * s.gravity * dt;
      s.pos.addScaledVector(s.vel, dt);

      if (player.ok) {
        const dx = s.pos.x - player.pos.x;
        const dz = s.pos.z - player.pos.z;
        const dy = s.pos.y - (player.pos.y + 0.85);
        if (dx * dx + dz * dz < (s.radius + 0.5) ** 2 && Math.abs(dy) < 1.2) {
          hurtPlayer(s.damage, s.pos, s.owner ? s.owner.id : "boss");
          ctx.vfx?.burst?.("beamHit", s.pos, { color: s.colour, count: 10 });
          s.live = false;
          continue;
        }
      }
      const gy = groundAt(s.pos.x, s.pos.z, s.pos.y);
      if (s.life <= 0 || s.pos.y < gy - 2) {
        s.live = false;
        ctx.vfx?.burst?.("dust", s.pos, { count: 6 });
      }
    }
  }

  function clearShots() { for (let i = 0; i < shots.length; i += 1) shots[i].live = false; }

  /* ------------------------------------------------------------
     Shared helpers
     ------------------------------------------------------------ */
  function groundOrNull(x, z, fromY) {
    const hit = ctx.collision && typeof ctx.collision.groundAt === "function"
      ? ctx.collision.groundAt(x, z, (fromY === undefined ? 200 : fromY + 2), 400)
      : null;
    return hit && Number.isFinite(hit.y) ? hit.y : null;
  }

  function groundAt(x, z, fromY) {
    const y = groundOrNull(x, z, fromY);
    return y === null ? 0 : y;
  }

  /**
   * The floor of an arena, at a point inside it.
   *
   * THE AUTHORED HEIGHT IS THE TRUTH AND THE PROBE IS THE CORRECTION,
   * not the other way round. groundAt returns the first up-facing
   * surface below its start, and a boss arena is full of up-facing
   * surfaces that are not its floor: a DJ riser, a counter, a hedge,
   * the canopy over the whole thing. Probing from a fixed height put
   * the Algorithm Twins twenty-one metres up on the awards-show canopy
   * and stood Lucifer three metres above his own stage, on a riser,
   * with his head out of the top of every frame he appeared in.
   * So a probe is only believed when it lands near where the course
   * said the fight happens; anything further away is furniture.
   */
  const FLOOR_TOLERANCE = 2.0;
  function arenaFloor(f, x, z) {
    const authored = Number.isFinite(f.arena.center.y) ? f.arena.center.y : 0;
    const base = Number.isFinite(f.arena.floorY) ? f.arena.floorY : authored;
    const y = groundOrNull(x, z, base + 0.6);
    if (y === null) return base;
    return Math.abs(y - base) > FLOOR_TOLERANCE ? base : y;
  }

  function hurtPlayer(amount, from, source) {
    if (!player.ok) return;
    const dx = player.pos.x - from.x;
    const dz = player.pos.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    const payload = {
      amount, source,
      from: { x: from.x, y: from.y, z: from.z },
      knock: { x: (dx / d) * 9, y: 5.5, z: (dz / d) * 9 },
    };
    /* player.js exposes `damage(n, fromPos)`, not `hurt`. Calling only
       the name this module invented meant every boss attack in the game
       was cosmetic: knockback, screen shake, sound, no damage. Try the
       name the player module actually has, then the one it might grow. */
    if (typeof ctx.player?.damage === "function") ctx.player.damage(amount, payload.from);
    else ctx.player?.hurt?.(amount, payload);
    ctx.bus?.emit?.("boss:strike", payload);
    ctx.vfx?.shake?.(0.4, 0.2);
  }

  function playerDist(x, z) {
    if (!player.ok) return Infinity;
    return Math.hypot(player.pos.x - x, player.pos.z - z);
  }

  /* ------------------------------------------------------------
     ACTORS

     One body, its pose state, and its health. A fight owns one to
     three of them. Everything a tell needs - a lean, a cocked arm, a
     tint - lives on the actor rather than in the fight, so a new
     attack is a pose table entry and not a new system.
     ------------------------------------------------------------ */
  function makeActor(id, built, opts) {
    /* One number the whole actor is worn at. See the PROXY BODIES
       header: the bodies are authored human-sized so the pose maths
       stays in readable units, and the fight sees `height`/`girth`
       already multiplied, so nothing downstream has to remember. */
    const scale = opts.scale || 1;
    const a = {
      id,
      built,
      root: built.root,
      parts: built.parts,
      material: built.material,
      scale,
      height: built.height * scale,
      /* How far the VISIBLE mass reaches above the actor's origin, as
         opposed to `height`, which is the body the fight's reach and
         stomp maths is scaled by. The two differ by everything that
         is not the figure - a shell, a halo, a pair of horns - and
         that difference is precisely what crops off the top of a boss
         screenshot. See `extentOf`. */
      top: (built.top || built.height) * scale,
      girth: (opts.girth || 0.55) * scale,
      pos: new NS.Vector3(),
      home: new NS.Vector3(),
      vel: new NS.Vector3(),
      yaw: 0, lean: 0, roll: 0,
      squashX: 1, squashY: 1,
      hp: opts.hp, maxHp: opts.hp,
      invuln: 0, hurtFlash: 0, downed: false,
      state: "idle", stateT: 0, timer: 0,
      // Per-attack pose targets, blended toward every frame so a tell
      // eases in rather than snapping. Snapping is why "it hit me with
      // no warning" happens even when a wind-up exists.
      poseArmL: 0, poseArmR: 0, poseArmLZ: 0, poseArmRZ: 0,
      poseHead: 0, poseLean: 0,
      tint: new NS.Color(1, 1, 1), tintWant: new NS.Color(1, 1, 1),
      rig: null, ctrl: null,
      /* `k0` is the actor's CONFIGURATION; `k` is its scratch for the
         current attempt. They were the same object, and resetActors()
         clears the scratch - so the first leash, death or course change
         deleted the Algorithm Twins' mirror axes and playback delays.
         Both twins then reflected the player identically, stood in the
         same spot forever, and could never collide, which is the only
         thing that makes them vulnerable. The fight was unwinnable
         from the second attempt onwards, and unwinnable from the FIRST
         one in a real course, because arming resets too. */
      k0: Object.freeze({ ...(opts.k || {}) }),
      k: { ...(opts.k || {}) },
    };
    a.root.visible = false;
    group.add(a.root);
    return a;
  }

  /** Give an actor a real rig the moment character.js can build one.
   *  The proxy stays as the fallback and the fight never asks which
   *  one is on screen. */
  function attachRig(actor, specKey) {
    if (actor.rig) return true;
    const specs = ctx.character && ctx.character.specs;
    const build = ctx.character && ctx.character.build;
    if (!specs || typeof build !== "function") return false;
    const spec = specs[specKey];
    if (!spec) return false;
    let rig = null;
    try { rig = build(spec); } catch (error) { return false; }
    if (!rig || !rig.root) return false;
    group.add(rig.root);
    actor.rig = rig;
    actor.root.visible = false;
    rig.root.visible = true;
    if (ctx.anim && typeof ctx.anim.attach === "function") {
      try { actor.ctrl = ctx.anim.attach(rig); } catch (error) { actor.ctrl = null; }
    }
    return true;
  }

  function playClip(actor, name, fade) {
    if (!actor.ctrl || typeof actor.ctrl.play !== "function") return;
    if (actor.clip === name) return;
    actor.clip = name;
    try { actor.ctrl.play(name, { fade: fade === undefined ? 0.15 : fade, loop: true }); } catch (error) { /* anim still a stub */ }
  }

  function poseActor(actor, dt) {
    const visible = actor.rig ? actor.rig.root : actor.root;
    const other = actor.rig ? actor.root : null;
    if (other) other.visible = false;

    actor.lean = damp(actor.lean, actor.poseLean, 12, dt);
    actor.tint.lerp(actor.tintWant, clamp01(dt * 10));
    if (actor.hurtFlash > 0) actor.hurtFlash = Math.max(0, actor.hurtFlash - dt * 5);

    visible.position.copy(actor.pos);
    tmp.euler.set(actor.lean, actor.yaw, actor.roll, "YXZ");
    visible.quaternion.setFromEuler(tmp.euler);
    const s = actor.scale;
    visible.scale.set(actor.squashX * s, actor.squashY * s, actor.squashX * s);

    // Limb poses only exist on the proxy hierarchy; a rigged actor
    // gets its pose from anim.js instead.
    if (!actor.rig && actor.parts) {
      const p = actor.parts;
      if (p.armL) {
        p.armL.rotation.x = damp(p.armL.rotation.x, actor.poseArmL, 14, dt);
        p.armL.rotation.z = damp(p.armL.rotation.z, actor.poseArmLZ, 14, dt);
      }
      if (p.armR) {
        p.armR.rotation.x = damp(p.armR.rotation.x, actor.poseArmR, 14, dt);
        p.armR.rotation.z = damp(p.armR.rotation.z, actor.poseArmRZ, 14, dt);
      }
      if (p.head) p.head.rotation.x = damp(p.head.rotation.x, actor.poseHead, 10, dt);
    }

    if (actor.material) {
      tmp.colour.copy(actor.tint);
      if (actor.hurtFlash > 0) {
        tmp.v1.set(1, 1, 1);
        tmp.colour.setRGB(
          lerp(tmp.colour.r, 3, actor.hurtFlash),
          lerp(tmp.colour.g, 3, actor.hurtFlash),
          lerp(tmp.colour.b, 3, actor.hurtFlash)
        );
      }
      actor.material.color.copy(tmp.colour);
    }
  }

  /* ------------------------------------------------------------
     THE FIGHT RUNTIME

     Everything all three fights share: arming, the intro, phase
     transitions as events, health readout, leash and reset, defeat.
     A specific fight fills in the hooks.
     ------------------------------------------------------------ */
  function makeFight(def) {
    const arena = ARENAS[def.id];
    const f = {
      id: def.id,
      name: arena.name,
      def,
      arena: {
        center: new NS.Vector3(arena.center[0], arena.center[1], arena.center[2]),
        radius: arena.radius,
        leashRadius: arena.leashRadius,
        group: null,
        hooks: {},
        provided: false,
        /* Which course last provided this arena, and under which name.
           `armForCourse` reads it: a fight is reused across courses, so
           "does this fight belong to course N" is a property of the
           BOOKING, not of the frozen `ARENAS[id].course` field it used
           to be read from - which is why a Phantom booked by course 1
           set up its arena and then never armed. */
        courseId: null,
        bookedAs: null,
        record: null,
        floorY: 0,
      },
      actors: [],
      armed: false,
      stage: "dormant",       // dormant | intro | fight | transition | defeat | leash
      stageT: 0,
      phase: 0,
      phaseCount: def.phases,
      /* The phase mix for the current booking. A course that books an
         act for the second time opens it in the phase the first course
         escalated to, rather than making the player sit through a
         lesson they have already passed. */
      openPhase: 0,
      closePhase: def.phases - 1,
      title: arena.name,
      awayFor: 0,
      /* Has the player been OUTSIDE the ring since this was armed? The
         fight starts when they walk in, and walking in requires having
         been out - see stepDormant. */
      sawOutside: false,
      /* Beaten IN WHICH COURSE. A single boolean was enough while a
         fight belonged to one course; three fights covering five means
         beating the Algorithm Twins on the red carpet also marked the
         rooftop booking of them beaten, and course 4's arm() then
         refused - a boss that never appears, and a Platinum Record
         that can never be earned. Two bookings are two fights to win. */
      defeatedIn: new Set(),
      defeated: false,
      hp: 0, maxHp: 0,
      k: {},
    };

    function totalHp() {
      let hp = 0, max = 0;
      for (const a of f.actors) { hp += Math.max(0, a.hp); max += a.maxHp; }
      f.hp = hp; f.maxHp = max;
      return max > 0 ? hp / max : 0;
    }

    function readout(subtitle) {
      totalHp();
      // A boss bar is not in the frozen HUD signature, so it is
      // REQUESTED rather than assumed - hud.js can add setBoss when it
      // gets there, and until then the prompt line carries it.
      if (ctx.hud && typeof ctx.hud.setBoss === "function") {
        ctx.hud.setBoss({
          id: f.id, name: f.title, hp: f.hp, maxHp: f.maxHp,
          phase: f.phase - f.openPhase + 1,
          phases: f.closePhase - f.openPhase + 1,
          subtitle: subtitle || "",
        });
      } else if (subtitle) {
        ctx.hud?.prompt?.(`${f.title} - ${subtitle}`);
      }
    }

    function clearReadout() {
      if (ctx.hud && typeof ctx.hud.clearBoss === "function") ctx.hud.clearBoss();
      else ctx.hud?.clearPrompt?.();
    }

    /** Is something with a stronger claim than a boss driving the
     *  camera? A held capture pose and a running cutscene both are:
     *  camera.js parks in mode "preset" for a screenshot golden, and a
     *  fight that grabbed the rig mid-capture would silently replace
     *  the frame the harness asked for with its own. */
    function cameraBusy() {
      const rig = ctx.cameraRig;
      const s = rig && typeof rig.getState === "function" ? rig.getState() : null;
      return !!(s && (s.mode === "preset" || s.mode === "cutscene"));
    }

    function cameraTo(anchorName, seconds) {
      if (cameraBusy()) return;
      const anchors = arena.request.cameraAnchors || {};
      const anchor = anchors[anchorName];
      const focus = f.actors[0] ? f.actors[0].pos : f.arena.center;
      // The camera handoff is the loudest signal in the whole
      // transition. It says: stop playing for a second, this matters.
      ctx.cameraRig?.setMode?.("boss", {
        center: f.arena.center,
        radius: f.arena.radius,
        target: focus,
        anchor: anchor ? { x: anchor[0], y: anchor[1], z: anchor[2] } : null,
        seconds: seconds || 1.2,
      });
    }

    function cameraRelease() {
      if (cameraBusy()) return;
      ctx.cameraRig?.setMode?.("follow", { seconds: 0.8 });
    }

    /* --- arming and the intro ---------------------------------
       AN ARMED BOSS IS ON SCREEN. It used to be invisible until the
       player crossed the trigger radius, which is why the `boss`
       capture preset produced a frame with no boss in it: the arena
       was loaded, the fight was armed, and there was nothing standing
       in the room. It is also worse as a game. SM64 shows you King
       Bob-omb on his mountain and Big Bully on his platform from the
       moment you can see the arena - the boss IS the landmark, and
       walking towards something that is visibly waiting for you is
       most of what a boss arena is for. */
    function arm() {
      f.defeated = f.arena.courseId !== null && f.defeatedIn.has(f.arena.courseId);
      if (f.defeated) return false;
      f.armed = true;
      f.stage = "dormant";
      f.stageT = 0;
      f.awayFor = 0;
      f.sawOutside = false;
      resetActors();
      def.onArm?.(f);
      takeStation();
      return true;
    }

    /** Put the cast on its marks and show them. Called by arm() and
     *  after a leash, so a boss the player walked away from is waiting
     *  where they left it rather than deleted from the room. */
    function takeStation() {
      for (let i = 0; i < f.actors.length; i += 1) {
        const a = f.actors[i];
        a.pos.copy(a.home);
        a.vel.set(0, 0, 0);
        a.yaw = 0;
        show(a, true);
      }
      def.onStation?.(f);
      // One pose pass so the very first frame after a course load is
      // already posed - a capture can happen before any update runs.
      for (const a of f.actors) poseActor(a, 1 / 60);
    }

    function show(a, on) {
      if (a.rig) { a.rig.root.visible = on; a.root.visible = false; }
      else a.root.visible = on;
    }

    function disarm() {
      f.armed = false;
      f.stage = "dormant";
      for (const a of f.actors) show(a, false);
      clearShots();
      clearReadout();
    }

    function resetActors() {
      for (let i = 0; i < f.actors.length; i += 1) {
        const a = f.actors[i];
        a.hp = a.maxHp;
        a.invuln = 0;
        a.hurtFlash = 0;
        a.downed = false;
        a.state = "idle";
        a.stateT = 0;
        a.timer = 0;
        a.pos.copy(a.home);
        a.vel.set(0, 0, 0);
        a.lean = 0; a.roll = 0; a.squashX = 1; a.squashY = 1;
        a.poseArmL = 0; a.poseArmR = 0; a.poseArmLZ = 0; a.poseArmRZ = 0;
        a.poseHead = 0; a.poseLean = 0;
        a.tint.setRGB(1, 1, 1);
        a.tintWant.setRGB(1, 1, 1);
        a.k = { ...a.k0 };
      }
      f.phase = f.openPhase;
      f.k = {};
      def.onReset?.(f);
    }

    /* --- WAITING --------------------------------------------------
       The idle a boss holds before the player commits. Deliberately
       small: a slow breath, a slow turn to watch whoever walked in.
       It exists so the arena is never a still life, and so a
       screenshot of it is a boss rather than a statue. */
    function stepDormant(dt) {
      const near = playerDist(f.arena.center.x, f.arena.center.z);
      for (let i = 0; i < f.actors.length; i += 1) {
        const a = f.actors[i];
        a.squashY = 1 + Math.sin(f.stageT * 1.5 + i * 1.7) * 0.02;
        if (player.ok && near < f.arena.leashRadius) {
          const yaw = Math.atan2(player.pos.x - a.pos.x, player.pos.z - a.pos.z);
          a.yaw = dampAngle(a.yaw, yaw, 2.2, dt);
        }
      }
      def.onStationStep?.(f, dt);

      /* THE FIGHT STARTS WHEN THE PLAYER WALKS IN, and walking in
         requires having been out. Without the latch a course whose
         spawn point sits inside the trigger ring starts its boss fight
         on the load frame, before the player has seen the room - which
         is what course 5 did, and it is also what happens to any
         capture that teleports the character towards the arena. Six
         seconds of standing in a boss arena counts as walking in, so
         the latch can never strand a player who has no way out. */
      if (near > f.arena.radius) f.sawOutside = true;
      if (near < f.arena.radius * 0.85 && (f.sawOutside || f.stageT > 6)) beginIntro();
    }

    function beginIntro() {
      f.stage = "intro";
      f.stageT = 0;
      for (const a of f.actors) {
        a.invuln = def.introSeconds + 0.3;
        show(a, true);
      }
      cameraTo("intro", 0.9);
      ctx.audio?.music?.(`boss.${f.id}`, { fade: 1.2 });
      ctx.audio?.play?.(`boss.${f.id}.intro`);
      ctx.audio?.duck?.(0.35, 1.4);
      ctx.hud?.toast?.(f.title.toUpperCase(), { style: "boss", seconds: 2.4 });
      readout(def.phaseNames ? def.phaseNames[f.openPhase] : "");
      ctx.bus?.emit?.("boss:intro", { id: f.id, course: f.arena.courseId });
      bus.emit("intro", { id: f.id });
      def.onIntro?.(f);
    }

    function stepIntro(dt) {
      const t = clamp01(f.stageT / def.introSeconds);
      def.onIntroStep?.(f, dt, t);
      if (f.stageT >= def.introSeconds) beginPhase(f.openPhase, true);
    }

    /* --- PHASE TRANSITIONS ARE EVENTS -------------------------- */
    function beginPhase(n, fromIntro) {
      f.phase = n;
      f.k.phaseHp = f.hp;
      if (!fromIntro) {
        f.stage = "transition";
        f.stageT = 0;
        for (const a of f.actors) {
          a.invuln = def.transitionSeconds + 0.2;
          a.state = "transition";
          a.stateT = 0;
        }
        cameraTo(n === 1 ? "phase2" : n === 2 ? "phase3" : "boss", 1.0);
        ctx.audio?.play?.(`boss.${f.id}.phase${n + 1}`);
        ctx.audio?.duck?.(0.5, 1.0);
        ctx.vfx?.flash?.(def.phaseFlash || 0xffffff, 0.55, 0.4);
        ctx.vfx?.shake?.(0.8, 0.5);
        ctx.hud?.toast?.(def.phaseNames ? def.phaseNames[n] : `PHASE ${n + 1}`, { style: "boss" });
        ctx.bus?.emit?.("boss:phase", { id: f.id, phase: n });
        bus.emit("phase", { id: f.id, phase: n });
      } else {
        f.stage = "fight";
        f.stageT = 0;
        cameraTo("boss", 1.1);
      }
      readout(def.phaseNames ? def.phaseNames[n] : "");
      def.onPhase?.(f, n);
    }

    function stepTransition(dt) {
      const t = clamp01(f.stageT / def.transitionSeconds);
      def.onTransitionStep?.(f, dt, t);
      if (f.stageT >= def.transitionSeconds) {
        f.stage = "fight";
        f.stageT = 0;
        cameraTo("boss", 0.8);
      }
    }

    /* --- LEASH AND RESET ---------------------------------------
       Copied wholesale from the saintfall bosses, for their reason:
       heal AT THE MOMENT the leash fires, and treat the return as
       presentation on top of a reset that has already happened. A
       reset that depends on an animation finishing is a reset that
       does not happen when the player quits the course mid-walk. */
    function checkLeash(dt) {
      const dead = ctx.state && ctx.state.hp !== undefined && ctx.state.hp <= 0;
      const away = playerDist(f.arena.center.x, f.arena.center.z) > f.arena.leashRadius;
      if (dead) { beginLeash("died"); return true; }
      if (away) {
        f.awayFor += dt;
        if (f.awayFor > def.leashSeconds) { beginLeash("left"); return true; }
      } else {
        f.awayFor = 0;
      }
      return false;
    }

    function beginLeash(why) {
      // The promise first: full health, hazards gone, phase zero.
      resetActors();
      clearShots();
      f.stage = "leash";
      f.stageT = 0;
      f.awayFor = 0;
      // A player who left is by definition outside; the next approach
      // must re-trigger without making them walk further out first.
      f.sawOutside = true;
      clearReadout();
      cameraRelease();
      ctx.audio?.music?.(`course.${ctx.state ? ctx.state.course : 0}`, { fade: 1.5 });
      ctx.bus?.emit?.("boss:reset", { id: f.id, why });
      bus.emit("reset", { id: f.id, why });
      def.onLeash?.(f, why);
    }

    function stepLeash(dt) {
      // Presentation only. The reset already happened.
      let settled = true;
      for (const a of f.actors) {
        a.pos.lerp(a.home, clamp01(dt * 2.2));
        a.yaw = dampAngle(a.yaw, 0, 3, dt);
        if (a.pos.distanceTo(a.home) > 0.4) settled = false;
      }
      if (settled || f.stageT > 4) {
        f.stage = "dormant";
        f.stageT = 0;
        // Back on station, not deleted. A boss that vanishes when you
        // walk out of its arena means the room you walk back into is
        // empty, and the second approach reads as a bug.
        takeStation();
      }
    }

    /* --- DEFEAT ------------------------------------------------- */
    function beginDefeat() {
      f.stage = "defeat";
      f.stageT = 0;
      f.defeated = true;
      if (f.arena.courseId !== null) f.defeatedIn.add(f.arena.courseId);
      clearShots();
      for (const a of f.actors) { a.invuln = 99; a.state = "defeat"; a.stateT = 0; }
      cameraTo("defeat", 1.0);
      ctx.audio?.play?.(`boss.${f.id}.defeat`);
      ctx.audio?.duck?.(0.7, 2.0);
      ctx.vfx?.flash?.(0xffffff, 0.8, 0.6);
      ctx.vfx?.shake?.(1.2, 0.9);
      clearReadout();
      ctx.hud?.toast?.(`${f.title.toUpperCase()} - DISBANDED`, { style: "boss", seconds: 3 });
      /* THE UNLOCK. levels.js gates a Platinum Record on this fight and
         names the record in the boss's own opts - so the payout carries
         that id rather than an id invented here, and it carries every
         spelling of the flag the courses actually wrote (`miniboss:` on
         the two mini-bosses, `boss:` on Lucifer, plus the name the
         course booked the act under). collect.js does not enforce
         `requires` yet; when it does, this is the event that opens it. */
      const unlock = {
        id: f.id,
        course: f.arena.courseId,
        record: f.arena.record || null,
        flags: [
          `boss:${f.id}`, `miniboss:${f.id}`,
          ...(f.arena.bookedAs && f.arena.bookedAs !== f.id
            ? [`boss:${f.arena.bookedAs}`, `miniboss:${f.arena.bookedAs}`] : []),
        ],
      };
      ctx.bus?.emit?.("boss:defeated", unlock);
      for (const flag of unlock.flags) ctx.collect?.unlock?.(flag);
      bus.emit("defeated", unlock);
      def.onDefeat?.(f);
    }

    function stepDefeat(dt) {
      const t = clamp01(f.stageT / def.defeatSeconds);
      for (const a of f.actors) {
        a.squashY = lerp(1, 0.3, ease.inQuad(t));
        a.squashX = lerp(1, 1.4, ease.inQuad(t));
        a.roll = lerp(a.roll, 1.2, clamp01(dt * 2));
        a.tintWant.setRGB(lerp(1, 2.5, t), lerp(1, 2.5, t), lerp(1, 2.5, t));
        if (rng() < dt * 9) {
          tmp.v1.copy(a.pos);
          tmp.v1.y += rng() * a.height;
          ctx.vfx?.burst?.("sparkle", tmp.v1, { color: 0xffffff, count: 6, rise: 2 });
        }
      }
      def.onDefeatStep?.(f, dt, t);
      if (f.stageT >= def.defeatSeconds) {
        for (const a of f.actors) show(a, false);
        /* The reward. collect.js owns it; if it is not up yet the
           defeat event is still on the bus for whoever is.
           A course that named its own record already has that Record
           standing in the level (world.js spawns every authored one at
           load), so spawning a second copy of it here would put two of
           the same id in the room. Only a fight nobody gated a record
           on drops one. */
        tmp.v1.copy(f.arena.center);
        tmp.v1.y += 2.2;
        if (!f.arena.record) {
          ctx.collect?.spawnRecord?.(`${f.id}.record`, tmp.v1, { fanfare: true });
        }
        ctx.vfx?.burst?.("recordGet", tmp.v1, { count: 30 });
        cameraRelease();
        f.stage = "done";
        f.armed = false;
      }
    }

    /* --- damage intake ------------------------------------------
       One door in. Every fight-specific rule about WHEN a hit counts
       lives in `def.canDamage`, so the gate cannot be bypassed by a
       new attack path being wired straight to an actor's hp. */
    function damage(actor, amount, opts) {
      if (!actor || f.stage !== "fight") return 0;
      if (actor.invuln > 0 || actor.downed) return 0;
      const verdict = def.canDamage ? def.canDamage(f, actor, opts || {}) : true;
      if (verdict === false) return 0;
      const scale = typeof verdict === "number" ? verdict : 1;
      const dealt = Math.max(0, (amount || 1) * scale);
      if (dealt <= 0) return 0;

      actor.hp -= dealt;
      actor.invuln = def.hitInvuln || 0.18;
      actor.hurtFlash = 1;
      tmp.v1.copy(actor.pos);
      tmp.v1.y += actor.height * 0.6;
      ctx.vfx?.burst?.("beamHit", tmp.v1, { color: 0xffffff, count: 12 });
      ctx.vfx?.damageNumber?.(tmp.v1, dealt, { crit: scale > 1 });
      ctx.vfx?.shake?.(0.25, 0.15);
      ctx.audio?.play?.("boss.hit", { pos: actor.pos, rate: scale > 1 ? 1.2 : 1 });
      readout();
      bus.emit("hit", { id: f.id, actor: actor.id, amount: dealt, hp: actor.hp });
      def.onDamage?.(f, actor, dealt, opts || {});

      if (actor.hp <= 0) {
        actor.hp = 0;
        def.onActorDown?.(f, actor);
      }
      // Phase thresholds. Checked here rather than in the fight step
      // so a transition can never be skipped by a burst of damage
      // crossing two thresholds in one frame.
      const frac = totalHp();
      const raw = def.phaseAt ? def.phaseAt(frac) : 0;
      // A booking that opens mid-fight never walks back down into the
      // phases it skipped, and never past the one it closes on.
      const next = clamp(raw, f.openPhase, f.closePhase);
      if (next > f.phase && f.stage === "fight" && !def.holdPhase?.(f)) beginPhase(next, false);
      else if (frac <= 0 && !def.holdDefeat?.(f)) beginDefeat();
      return dealt;
    }

    /* --- frame -------------------------------------------------- */
    function update(dt) {
      f.stageT += dt;
      for (const a of f.actors) {
        a.stateT += dt;
        if (a.invuln > 0) a.invuln -= dt;
      }

      if (f.stage === "dormant") {
        if (f.armed) stepDormant(dt);
      } else if (f.stage === "intro") {
        stepIntro(dt);
      } else if (f.stage === "transition") {
        if (!checkLeash(dt)) stepTransition(dt);
      } else if (f.stage === "fight") {
        if (!checkLeash(dt)) def.onFight?.(f, dt);
      } else if (f.stage === "leash") {
        stepLeash(dt);
      } else if (f.stage === "defeat") {
        stepDefeat(dt);
      }

      for (const a of f.actors) poseActor(a, dt);
    }

    Object.assign(f, {
      arm, disarm, update, damage, resetActors, beginPhase, beginDefeat,
      beginLeash, readout, totalHp, cameraTo, takeStation, show,
    });
    return f;
  }

  /* ============================================================
     1. THE ALGORITHM TWINS

     The mirror match. Two bodies replaying the player's own movement
     on a delay, reflected through the arena's axes.

     WHY A RECORDING AND NOT A CHASE AI

     A boss that copies you has to actually copy you, or the idea does
     not land. An AI that "moves like the player" is just an AI; a
     literal playback of the last four seconds of your own position is
     unmistakable the first time you stop dead and watch your double
     arrive a beat later and stop in exactly the same way.

     And it makes the fight winnable by THINKING. The twins collide
     when the two mirrored paths cross - which the player controls
     completely, because both paths are theirs. Phase one is a lesson:
     walk the centre line and they crash into each other. Phase two
     desyncs the delays so a straight line no longer works and the
     player has to construct a path whose reflections intersect, while
     the twins cover for one another.
     ============================================================ */
  /* THESE ARE FINISHED PIXELS, NOT ALBEDO. The proxies use
     MeshBasicMaterial with the shading baked into the vertex colours
     by mergeParts, whose darkest term is 0.46 - so a colour authored
     as a "dark costume" arrives on screen at a fifth of its value and
     the whole figure reads as a hole. Every trim here was authored
     that way and every boss was a black slab at capture distance,
     which is a large part of why a blind critic could not find the
     subject in our frames. SM64 paints its bosses in saturated
     mid-tones for the same reason. */
  const TWIN_PALETTE_A = { base: 0xff2f7a, trim: 0xb02a52, visor: 0x00e5ff };
  const TWIN_PALETTE_B = { base: 0x00d0ff, trim: 0x1f86ad, visor: 0xff2f7a };

  const MIRROR_HZ = 60;
  const MIRROR_SECONDS = 4;
  const MIRROR_SAMPLES = MIRROR_HZ * MIRROR_SECONDS;

  const twinsFight = makeFight({
    id: "twins",
    phases: 2,
    phaseNames: ["OPENING ACT", "DESYNC"],
    introSeconds: 3.2,
    transitionSeconds: 2.4,
    defeatSeconds: 3.0,
    leashSeconds: 5,
    phaseFlash: 0xff2f7a,
    hitInvuln: 0.15,
    phaseAt: (frac) => (frac <= 0.5 ? 1 : 0),

    onArm(f) {
      f.k.buffer = f.k.buffer || new Float32Array(MIRROR_SAMPLES * 4);
      f.k.cursor = 0;
      f.k.filled = 0;
      f.k.acc = 0;
      f.k.syncTimer = 0;
    },

    /* WAITING. Posed on their marks either side of the arena axis,
       which is also the diagram of the fight: two of them, mirrored
       through the middle. The mark spacing is a fraction of the arena
       so a small booking does not put them through the wall. */
    onStation(f) {
      const spread = Math.min(6, f.arena.radius * 0.34);
      for (let i = 0; i < f.actors.length; i += 1) {
        const a = f.actors[i];
        a.pos.x = f.arena.center.x + (i === 0 ? -spread : spread);
        a.pos.z = f.arena.center.z;
        a.pos.y = arenaFloor(f, a.pos.x, a.pos.z);
        a.yaw = i === 0 ? 0.22 : -0.22;
        // A held photo-op: one arm out, chin up. Nothing about them is
        // casual, and it reads as a pose at any distance.
        a.poseArmR = i === 0 ? -1.25 : -0.35;
        a.poseArmL = i === 0 ? -0.35 : -1.25;
        a.poseArmRZ = i === 0 ? -0.5 : 0;
        a.poseArmLZ = i === 0 ? 0 : 0.5;
        a.poseHead = -0.12;
      }
    },

    onStationStep(f, dt) {
      for (let i = 0; i < f.actors.length; i += 1) {
        // Weight shifting from foot to foot, opposite phase, because
        // two figures breathing in lockstep look like one object.
        f.actors[i].roll = Math.sin(f.stageT * 1.1 + i * Math.PI) * 0.045;
      }
    },

    onReset(f) {
      f.k.cursor = 0;
      f.k.filled = 0;
      f.k.acc = 0;
      f.k.syncTimer = 0;
      if (f.k.buffer) f.k.buffer.fill(0);
    },

    onIntro(f) {
      // They step off their marks and mirror in: the entrance IS the
      // explanation of the mechanic, before a word of it is spoken.
      // Started from wherever they were standing, not from a hard-coded
      // point - they have been on screen since the arena loaded and a
      // boss that teleports to begin its own intro undoes that.
      for (const a of f.actors) a.k.introFrom = a.pos.clone();
      ctx.hud?.prompt?.("They are copying you.");
    },

    onIntroStep(f, dt, t) {
      for (let i = 0; i < f.actors.length; i += 1) {
        const a = f.actors[i];
        const to = tmp.v1.copy(f.arena.center);
        to.x += i === 0 ? -5 : 5;
        to.y = a.k.introFrom.y;
        a.pos.lerpVectors(a.k.introFrom, to, ease.outCubic(t));
        a.yaw = lerp(i === 0 ? -1.2 : 1.2, 0, ease.outCubic(t));
        // The pose is a held photo-op. Nothing about them is casual.
        a.poseArmL = lerp(0, -1.1, ease.outBack(clamp01(t * 1.4)));
        a.poseArmR = lerp(0, -1.1, ease.outBack(clamp01(t * 1.4)));
      }
    },

    onPhase(f, n) {
      if (n === 1) {
        // THE DESYNC. Different delays and a point reflection instead
        // of an axis one, so the phase-one answer stops working.
        f.actors[0].k.delay = 0.75;
        f.actors[1].k.delay = 1.55;
        f.actors[0].k.mirror = "x";
        f.actors[1].k.mirror = "xz";
        ctx.hud?.prompt?.("They are out of step now.");
        window.setTimeout(() => ctx.hud?.clearPrompt?.(), 2600);
      }
    },

    onTransitionStep(f, dt, t) {
      for (const a of f.actors) {
        a.squashY = 1 + Math.sin(t * Math.PI * 6) * 0.12;
        a.poseArmL = -1.6 * ease.outCubic(t);
        a.poseArmR = -1.6 * ease.outCubic(t);
        a.tintWant.setRGB(1 + t, 1 + t, 1 + t);
        a.yaw += dt * 5 * (1 - t);
      }
      if (t > 0.98) for (const a of f.actors) a.tintWant.setRGB(1, 1, 1);
    },

    /* Vulnerable only when the mirror breaks: a crash, a downed twin's
       partner in phase two, or - once desynced - the moment a twin is
       replaying one of YOUR wind-ups and is committed to it. */
    canDamage(f, actor, opts) {
      if (actor.k.state === "crash") return opts.pound ? 2 : 1;
      if (f.phase >= 1 && actor.k.state === "replayStrike") return 1;
      if (f.phase >= 1 && actor.k.covering) return false;
      if (actor.k.state === "replay") {
        // Untouchable while it is perfectly mirroring you. Hitting it
        // here would let the player ignore the entire idea.
        sparkOff(actor);
        return false;
      }
      return false;
    },

    onActorDown(f, actor) {
      actor.downed = true;
      actor.k.state = "downed";
      actor.k.reviveIn = 6;
      actor.poseLean = 0.9;
      ctx.audio?.play?.("boss.twins.down", { pos: actor.pos });
      ctx.vfx?.burst?.("poundShock", actor.pos, { color: 0xffffff, radius: 3.5 });
      ctx.hud?.toast?.("ONE DOWN - FINISH THE OTHER", { seconds: 2 });
    },

    /* Both, or neither. A downed twin its partner had time to cover
       gets back up at a quarter health, which is what forces the
       player to solve the fight rather than grind one of them. */
    holdDefeat(f) {
      return f.actors.some((a) => a.hp > 0);
    },

    onFight(f, dt) {
      recordPlayer(f, dt);
      const centre = f.arena.center;

      for (let i = 0; i < f.actors.length; i += 1) {
        const a = f.actors[i];
        if (a.downed) {
          a.k.reviveIn -= dt;
          a.poseLean = 0.9;
          a.squashY = 0.82;
          a.tintWant.setRGB(0.45, 0.45, 0.45);
          if (a.k.reviveIn <= 0) {
            a.downed = false;
            a.hp = a.maxHp * 0.25;
            a.k.state = "replay";
            a.poseLean = 0;
            a.squashY = 1;
            a.tintWant.setRGB(1, 1, 1);
            a.invuln = 1.0;
            ctx.audio?.play?.("boss.twins.revive", { pos: a.pos });
            ctx.hud?.toast?.("THE OTHER PICKED THEM BACK UP", { seconds: 2 });
            f.readout();
          }
          continue;
        }

        if (a.k.state === "crash") {
          a.k.crashT -= dt;
          a.poseLean = 1.1;
          a.squashY = 0.78; a.squashX = 1.2;
          a.tintWant.setRGB(2.2, 2.2, 2.2);
          a.vel.multiplyScalar(Math.exp(-3 * dt));
          a.pos.addScaledVector(a.vel, dt);
          if (a.k.crashT <= 0) {
            a.k.state = "replay";
            a.poseLean = 0;
            a.squashY = 1; a.squashX = 1;
            a.tintWant.setRGB(1, 1, 1);
            a.invuln = 0.4;
            ctx.vfx?.burst?.("sparkle", a.pos, { color: 0xffffff, count: 12 });
          }
          continue;
        }

        // The replay itself.
        const sample = readSample(f, a.k.delay);
        if (sample) {
          mirrorPoint(centre, sample, a.k.mirror, tmp.v2);
          // Damped rather than snapped: a body that teleports along a
          // recorded path reads as a bug, and the small lag is what
          // makes them look like they are moving rather than being
          // moved.
          a.pos.x = damp(a.pos.x, tmp.v2.x, 16, dt);
          a.pos.z = damp(a.pos.z, tmp.v2.z, 16, dt);
          a.pos.y = damp(a.pos.y, Math.max(tmp.v2.y, groundAt(a.pos.x, a.pos.z, a.pos.y)), 14, dt);
          if (player.ok) {
            const yaw = Math.atan2(player.pos.x - a.pos.x, player.pos.z - a.pos.z);
            a.yaw = dampAngle(a.yaw, yaw, 8, dt);
          }
          const speed = Math.hypot(a.pos.x - a.k.lastX, a.pos.z - a.k.lastZ) / Math.max(dt, 1e-4);
          a.k.lastX = a.pos.x; a.k.lastZ = a.pos.z;
          a.poseLean = clamp(speed * 0.03, 0, 0.35);
          a.squashY = 1 + Math.sin(f.stageT * 9 + i) * 0.05;
          playClip(a, speed > 4 ? "run" : speed > 0.6 ? "walk" : "idle", 0.2);

          // Your own beam, handed back. The flag came out of the same
          // recording the movement did.
          if (sample.beam && !a.k.beamHeld) {
            a.k.beamHeld = true;
            a.k.state = "replayStrike";
            a.k.strikeT = 0.5;
            a.poseArmR = -1.6;
            a.tintWant.setHex(0xffe066);
            ctx.audio?.play?.("boss.twins.beam", { pos: a.pos });
            tmp.v1.copy(a.pos); tmp.v1.y += 1.3;
            ctx.vfx?.burst?.("sparkle", tmp.v1, { color: 0xffe066, count: 8 });
          } else if (!sample.beam) {
            a.k.beamHeld = false;
          }
        }

        if (a.k.state === "replayStrike") {
          a.k.strikeT -= dt;
          if (a.k.strikeT <= 0) {
            a.k.state = "replay";
            a.poseArmR = 0;
            a.tintWant.setRGB(1, 1, 1);
            if (player.ok) {
              tmp.v1.copy(a.pos); tmp.v1.y += 1.35;
              tmp.v2.set(player.pos.x - tmp.v1.x, (player.pos.y + 0.9) - tmp.v1.y, player.pos.z - tmp.v1.z);
              tmp.v2.normalize().multiplyScalar(19);
              fire(a, tmp.v1, tmp.v2, { gravity: 0.12, damage: 1, color: a.k.beamColour, life: 2.4, radius: 0.5 });
            }
          }
        }

        // Contact. They are solid, and running into your own double
        // hurts exactly as much as you would expect.
        if (player.ok && a.k.state === "replay" && playerDist(a.pos.x, a.pos.z) < 0.9 + a.girth) {
          if (!(a.k.touchCd > 0)) {
            a.k.touchCd = 1.1;
            hurtPlayer(1, a.pos, "twins.contact");
          }
        }
        if (a.k.touchCd > 0) a.k.touchCd -= dt;
      }

      // THE CRASH. Both mirrors of the same path, meeting.
      const A = f.actors[0], B = f.actors[1];
      if (A.k.state === "replay" && B.k.state === "replay" && !A.downed && !B.downed) {
        const d = Math.hypot(A.pos.x - B.pos.x, A.pos.z - B.pos.z);
        if (d < 2.4) crashTwins(f, A, B);
      }

      // Phase two cover: whichever twin the player is closer to steps
      // in front of the other and becomes untouchable. Breaking the
      // pair up is the phase-two problem.
      if (f.phase >= 1 && player.ok) {
        const dA = playerDist(A.pos.x, A.pos.z);
        const dB = playerDist(B.pos.x, B.pos.z);
        A.k.covering = dA < dB && A.k.state === "replay";
        B.k.covering = dB <= dA && B.k.state === "replay";
        for (const a of [A, B]) {
          a.tintWant.setRGB(a.k.covering ? 0.55 : 1, a.k.covering ? 0.75 : 1, a.k.covering ? 1.4 : 1);
        }
      }
    },

    onDefeat(f) {
      // They desynchronise for good. The two bodies fall out of step
      // and out of the mirror at the same time.
      for (let i = 0; i < f.actors.length; i += 1) f.actors[i].k.state = "defeat";
    },
  });

  function sparkOff(actor) {
    if (actor.k.sparkCd > 0) return;
    actor.k.sparkCd = 0.3;
    tmp.v1.copy(actor.pos); tmp.v1.y += actor.height * 0.6;
    ctx.vfx?.burst?.("beamHit", tmp.v1, { color: 0x6fd7ff, count: 6 });
    ctx.audio?.play?.("boss.deflect", { pos: actor.pos });
  }

  function crashTwins(f, A, B) {
    for (const a of [A, B]) {
      a.k.state = "crash";
      a.k.crashT = 2.7;
      a.invuln = 0;
    }
    tmp.v1.set((A.pos.x + B.pos.x) * 0.5, A.pos.y + 1, (A.pos.z + B.pos.z) * 0.5);
    A.vel.set((A.pos.x - B.pos.x) * 1.6, 3, (A.pos.z - B.pos.z) * 1.6);
    B.vel.set((B.pos.x - A.pos.x) * 1.6, 3, (B.pos.z - A.pos.z) * 1.6);
    ctx.vfx?.burst?.("poundShock", tmp.v1, { color: 0xffffff, radius: 5 });
    ctx.vfx?.flash?.(0xffffff, 0.35, 0.2);
    ctx.vfx?.shake?.(0.9, 0.4);
    ctx.audio?.play?.("boss.twins.crash", { pos: tmp.v1 });
    ctx.hud?.toast?.("THEY CRASHED - HIT THEM NOW", { seconds: 1.8 });
    bus.emit("crash", { id: "twins" });
  }

  /** Sample the player at a fixed rate regardless of frame rate, so a
   *  delay is a delay in SECONDS and not in frames - otherwise the
   *  whole fight changes character between 60 and 144 fps. */
  function recordPlayer(f, dt) {
    if (!player.ok || !f.k.buffer) return;
    f.k.acc += dt;
    const step = 1 / MIRROR_HZ;
    let guard = 8;
    while (f.k.acc >= step && guard-- > 0) {
      f.k.acc -= step;
      const i = (f.k.cursor % MIRROR_SAMPLES) * 4;
      f.k.buffer[i] = player.pos.x;
      f.k.buffer[i + 1] = player.pos.y;
      f.k.buffer[i + 2] = player.pos.z;
      f.k.buffer[i + 3] = player.beaming ? 1 : 0;
      f.k.cursor += 1;
      if (f.k.filled < MIRROR_SAMPLES) f.k.filled += 1;
    }
  }

  const sampleOut = { x: 0, y: 0, z: 0, beam: false };
  function readSample(f, delaySeconds) {
    if (!f.k.buffer) return null;
    const back = Math.round((delaySeconds || 1) * MIRROR_HZ);
    if (f.k.filled <= back + 1) return null;
    const idx = ((f.k.cursor - back) % MIRROR_SAMPLES + MIRROR_SAMPLES) % MIRROR_SAMPLES;
    const i = idx * 4;
    sampleOut.x = f.k.buffer[i];
    sampleOut.y = f.k.buffer[i + 1];
    sampleOut.z = f.k.buffer[i + 2];
    sampleOut.beam = f.k.buffer[i + 3] > 0.5;
    return sampleOut;
  }

  /** Reflect a point through the arena centre. "x" mirrors across the
   *  z axis, "z" across the x axis, "xz" is a point reflection. */
  function mirrorPoint(centre, p, mode, out) {
    const dx = p.x - centre.x;
    const dz = p.z - centre.z;
    if (mode === "z") out.set(centre.x + dx, p.y, centre.z - dz);
    else if (mode === "xz") out.set(centre.x - dx, p.y, centre.z - dz);
    else out.set(centre.x - dx, p.y, centre.z + dz);
    return out;
  }

  /* ============================================================
     2. THE PAYOLA PHANTOM

     Permanently shielded, except during a contract window it opens on
     a musical cue - and inside that window a hit only counts if it
     lands ON the beat.

     WHY THE BEAT IS THE LOCK

     The game runs at a fixed 124 BPM and every other system nods at
     it: the HUD pulses, the dancers step on it, the on-beat bonus
     exists. All of that is flavour until something REQUIRES it. This
     fight is where the metronome stops being decoration - a player who
     has been ignoring the music has to start listening, in a game
     whose whole identity is pop.

     Mashing is punished specifically: an off-beat hit inside the
     window voids the contract and closes it early. The correct play is
     to wait, count, and land the hit clean, which is exactly the
     rhythm-game verb the fiction is about.
     ============================================================ */
  /* Two darks, one jade and one gold. The coat used to be a mid blue
     with a PALE head on top of it, which put the brightest value in
     the frame on the smallest, roundest part of the figure - the exact
     recipe for a ball on a cone. The body is now a dark mass with the
     brightness rationed to the placket, the badge, the hat band and
     the contract, so the shape is read by its outline and the accents
     only tell you where its front is. */
  const PHANTOM_PALETTE = {
    base: 0x2f3a6e,     // the suit
    coat: 0x1a2145,     // the coat's shadow, the tatters, the hat
    trim: 0x50e3a0,     // jade: the fight's colour, shared with the pylons
    head: 0x090c17,     // there is no face under the brim
    gold: 0xffd23f,
    paper: 0xe8e4d2,
    /* The cage is the specter's own steel, not a second bright object.
       Authored warm brass, it came back lighter in value than the boss
       it surrounds - so the eye went to the furniture and the character
       inside it read as its shadow. mergeParts adds an achromatic rim
       that no dark colour can get under, so the cage cannot be black;
       it can be cool and low-chroma, which is enough to lose against
       the food court's warm tan while the gold bolts carry the money.
       It does have to stay clearly LIGHTER than the coat, though: at
       the coat's own value the cage and the figure merged into one
       navy mass and the boss read as a decorated ball. */
    frame: 0x525c80,
    shield: 0x50e3a0,
  };

  /* How far the specter's ORIGIN floats above the floor. Not how far
     its body does: the body hangs from the origin and it is worn at
     1.35x, so this is about a metre of daylight under the hem and a
     head at four and a half metres. The old 2.4 was set when the body
     was authored size and put the whole figure out of reach. */
  const PHANTOM_HOVER = 1.05;

  const phantomFight = makeFight({
    id: "phantom",
    phases: 3,
    phaseNames: ["THE RETAINER", "THE RENEGOTIATION", "THE BUYOUT"],
    introSeconds: 3.4,
    transitionSeconds: 2.2,
    defeatSeconds: 3.2,
    leashSeconds: 5,
    phaseFlash: 0x50e3a0,
    hitInvuln: 0.12,
    phaseAt: (frac) => (frac <= 0.33 ? 2 : frac <= 0.66 ? 1 : 0),

    onArm(f) {
      f.k.cycleStart = 0;
      f.k.window = false;
      f.k.calling = false;
      f.k.combo = 0;
      f.k.voided = 0;
      f.k.split = 0;
    },

    onReset(f) {
      f.k.window = false;
      f.k.calling = false;
      f.k.combo = 0;
      f.k.voided = 0;
      f.k.split = 0;
      const a = f.actors[0];
      if (a && a.parts.shield) {
        a.parts.shield.visible = true;
        a.parts.shield.scale.setScalar(1);
        presentShield(a, 0, SHIELD_IDLE_GLOW, 0);
      }
    },

    /* WAITING. Hanging over the middle of its room with the shield up.
       Both facts are the fight, so both are visible before it starts:
       it does not stand on the floor, and it is already defended. */
    onStation(f) {
      const a = f.actors[0];
      a.pos.copy(f.arena.center);
      a.pos.y = arenaFloor(f, a.pos.x, a.pos.z) + PHANTOM_HOVER;
      a.poseArmL = -0.35; a.poseArmR = -0.35;
      a.poseArmLZ = 0.30; a.poseArmRZ = -0.30;
      if (a.parts.shield) {
        a.parts.shield.visible = true;
        a.parts.shield.scale.setScalar(1);
      }
      presentShield(a, 0, SHIELD_IDLE_GLOW, 0);
    },

    onStationStep(f, dt) {
      const a = f.actors[0];
      const ground = arenaFloor(f, a.pos.x, a.pos.z);
      a.pos.y = damp(a.pos.y, ground + PHANTOM_HOVER + Math.sin(f.stageT * 0.9) * 0.28, 3, dt);
      a.roll = Math.sin(f.stageT * 0.7) * 0.06;
      if (a.parts.shield) {
        /* Yaw only. The cage splits along its own Y, so letting it
           tumble on X - which it used to - would swing the seam off
           level and the lid would open sideways. */
        a.parts.shield.rotation.y += dt * 0.34;
        a.parts.shield.rotation.x = Math.sin(f.stageT * 0.45) * 0.05;
      }
    },

    onIntro(f) {
      f.actors[0].k.hover = PHANTOM_HOVER;
      ctx.hud?.prompt?.("Shielded. Wait for the window - and hit on the beat.");
    },

    onIntroStep(f, dt, t) {
      const a = f.actors[0];
      // It rises, turns and settles - the specter noticing you. The
      // shield stays up throughout: the player must never see it
      // undefended by accident, or the one rule of the fight is a lie.
      const ground = arenaFloor(f, a.pos.x, a.pos.z);
      a.pos.y = damp(a.pos.y, ground + a.k.hover + 3.4 * Math.sin(t * Math.PI), 6, dt);
      a.yaw += dt * (1 - t) * 5;
      if (a.parts.shield) {
        a.parts.shield.rotation.y += dt * 0.8;
        a.parts.shield.scale.setScalar(lerp(1, 1.16, Math.sin(t * Math.PI)));
        // Sealed, and visibly so, for the whole entrance.
        presentShield(a, 0, SHIELD_IDLE_GLOW + 0.2 * Math.sin(t * Math.PI), 0);
      }
    },

    onPhase(f, n) {
      // Tighter cycle, shorter window, denser fire. The fight gets
      // harder by giving the player LESS time to be in time.
      /* `windowBeats`, NOT `window`.
         These two lived under the same key: the table set f.k.window to
         the window's LENGTH IN BEATS, and the fight used f.k.window as
         the boolean "the window is open". onPhase assigned the length
         and then immediately set the same field back to false, so
         `windowStart = cycle - f.k.window` evaluated to `32 - false`,
         which is 32 - and `open = inCycle >= 32` can never be true when
         inCycle is taken modulo 32. THE CONTRACT WINDOW HAS NEVER
         OPENED. The Payola Phantom was invulnerable in every course it
         appears in, and the only visible symptom was the pylons
         strobing their two-beat call and then nothing happening. */
      const table = [
        { cycle: 32, windowBeats: 6, volley: 2, sweepEvery: 8 },
        { cycle: 24, windowBeats: 4, volley: 3, sweepEvery: 6 },
        { cycle: 16, windowBeats: 3, volley: 3, sweepEvery: 4 },
      ];
      Object.assign(f.k, table[clamp(n, 0, 2)]);
      /* Start the cycle four beats short of the call rather than at
         zero. A phase that opens with twenty-six beats of unanswerable
         shooting - thirteen seconds at 124 BPM - teaches the player
         that the shield is permanent, which is the opposite of the
         lesson. The first window arrives almost immediately, and the
         full cycle takes over from the second one on. */
      f.k.cycleStart = beat.index - Math.max(0, f.k.cycle - f.k.windowBeats - 4);
      f.k.window = false;
      f.k.calling = false;
    },

    /* THE GATE. Two conditions, and the second one is the fight. */
    canDamage(f, actor, opts) {
      if (!f.k.window) { sparkShield(actor); return false; }
      if (!beat.onBeat) { voidContract(f, actor); return false; }
      f.k.combo += 1;
      const mult = f.k.combo >= 4 ? 2 : f.k.combo >= 2 ? 1.5 : 1;
      ctx.hud?.toast?.(mult > 1 ? `ON BEAT x${mult}` : "ON BEAT", { seconds: 0.8, style: "beat" });
      ctx.audio?.play?.("boss.phantom.onbeat", { rate: 1 + f.k.combo * 0.06 });
      ctx.vfx?.flash?.(0x50e3a0, 0.2, 0.15);
      return mult;
    },

    onFight(f, dt) {
      const a = f.actors[0];
      const centre = f.arena.center;
      const ground = arenaFloor(f, a.pos.x, a.pos.z);

      // Drift. It circles the room slowly at hover height and turns to
      // face the player: a specter that holds still is a statue.
      f.k.orbit = (f.k.orbit || 0) + dt * 0.28;
      const r = 6.5;
      a.pos.x = damp(a.pos.x, centre.x + Math.cos(f.k.orbit) * r, 2.2, dt);
      a.pos.z = damp(a.pos.z, centre.z + Math.sin(f.k.orbit) * r, 2.2, dt);
      a.pos.y = damp(a.pos.y, ground + PHANTOM_HOVER + Math.sin(f.stageT * 1.3) * 0.35, 3, dt);
      if (player.ok) {
        a.yaw = dampAngle(a.yaw, Math.atan2(player.pos.x - a.pos.x, player.pos.z - a.pos.z), 4, dt);
      }
      a.roll = Math.sin(f.stageT * 0.9) * 0.08;

      const inCycle = ((beat.index - f.k.cycleStart) % f.k.cycle + f.k.cycle) % f.k.cycle;
      const windowStart = f.k.cycle - f.k.windowBeats;
      const callStart = windowStart - 2;
      // Published so a test can watch the schedule; f.k is dumped by
      // status(). The whole fight is this counter.
      f.k.inCycle = inCycle;
      f.k.windowStart = windowStart;

      /* THE CALL. Two beats of unmistakable telegraph before the
         window: the shield strobes, the pylons light in sequence, the
         HUD says so and a sting plays. A window that opens silently
         would make the whole mechanic feel like luck. */
      const calling = inCycle >= callStart && inCycle < windowStart;
      const open = inCycle >= windowStart;

      if (calling && !f.k.calling) {
        f.k.calling = true;
        ctx.audio?.play?.("boss.phantom.call");
        ctx.hud?.prompt?.("CONTRACT WINDOW INCOMING");
        ctx.hud?.setBeatPulse?.(1);
        pulsePylons(f, 1);
      }
      if (open && !f.k.window) {
        f.k.window = true;
        f.k.calling = false;
        f.k.combo = 0;
        openShield(f, a, true);
        ctx.audio?.play?.("boss.phantom.open");
        ctx.hud?.prompt?.("SIGN IT - ON THE BEAT");
        ctx.bus?.emit?.("boss:window", { id: f.id, open: true });
      }
      if (!open && f.k.window) closeWindow(f, a, "expired");
      if (!calling && f.k.calling) f.k.calling = false;

      /* SHIELD PRESENTATION - the whole rule of the fight, in one
         still frame. Sealed: a locked brass cage over a steady jade
         field. Calling: the brass goes gold and strobes with the
         pylons. Open: the cage cracks at the equator, the lid lifts
         and tips, and the field collapses to almost nothing so the
         body inside it is suddenly the brightest thing in the arena.
         The three states have to be distinguishable with the sound
         off, which is why they differ in SHAPE and not only in
         brightness. */
      const shield = a.parts.shield;
      if (shield) {
        shield.rotation.y += dt * (f.k.window ? 1.25 : 0.34);
        shield.rotation.x = Math.sin(f.stageT * 0.45) * 0.05;
        f.k.split = damp(f.k.split || 0, f.k.window ? 1 : 0, 8, dt);
        const want = f.k.window ? 0.10 : (calling ? SHIELD_IDLE_GLOW + 0.34 : SHIELD_IDLE_GLOW);
        const glow = damp(a.built.shieldMat.opacity, want, 9, dt);
        const call = calling ? 0.55 + Math.sin(f.stageT * 22) * 0.45 : 0;
        presentShield(a, f.k.split, glow, call);
        shield.scale.setScalar(damp(shield.scale.x, f.k.window ? 1.1 : 1, 7, dt));
      }
      a.tintWant.setRGB(f.k.window ? 1.5 : 1, f.k.window ? 1.2 : 1, f.k.window ? 0.9 : 1);

      /* ATTACKS, ALL ON BEATS. Everything this boss does happens on
         the grid, which is what teaches the grid. A player who learns
         to dodge on the beat has already learned to hit on it. */
      if (beat.fired && !f.k.window) {
        if (inCycle % 2 === 0) chequeVolley(f, a);
        if (f.k.sweepEvery && inCycle % f.k.sweepEvery === 0 && inCycle > 0) royaltySweep(f, a);
      }
      updateSweeps(f, dt);
    },

    onDamage(f) {
      // Every landed hit shortens the window slightly - the contract
      // is being torn up as it is signed.
      f.k.windowBias = (f.k.windowBias || 0) + 0.05;
    },

    onDefeat(f) {
      const a = f.actors[0];
      if (a.parts.shield) a.parts.shield.visible = false;
      f.k.sweeps = null;
      ctx.hud?.clearPrompt?.();
    },

    onLeash(f) {
      const a = f.actors[0];
      if (a.parts.shield) {
        a.parts.shield.visible = true;
        f.k.split = 0;
        presentShield(a, 0, SHIELD_IDLE_GLOW, 0);
      }
      f.k.sweeps = null;
      ctx.hud?.clearPrompt?.();
    },
  });

  /**
   * Put the shield into a state. `split` 0 = sealed, 1 = the clamshell
   * fully open; `glow` is the membrane's strength; `call` tints the
   * brass gold for the two-beat telegraph.
   *
   * Every path that touches the shield goes through here on purpose.
   * The cage and the field are two objects saying one thing, and if a
   * reset, a leash or a phase change moved only one of them the boss
   * would spend the rest of the fight showing an open cage over a full
   * field - a shield that lies about whether it is up, in the one
   * fight whose entire rule is whether the shield is up.
   */
  function presentShield(actor, split, glow, call) {
    const b = actor.built;
    if (!b || !b.shieldTop) return;
    const s = clamp01(split);
    b.shieldTop.position.y = SHIELD_LIFT * s;
    b.shieldTop.rotation.x = SHIELD_TIP * s;
    /* The BOWL barely moves, and that is deliberate rather than lazy.
       It used to mirror the lid at 0.55 of the lift and 0.4 of the tip,
       which was fine while the bowl was a bare hemisphere and is not
       now that it carries the record ring: measured on the live open
       frame, the ring's counterweight went 1.4 m THROUGH the food
       court floor at full split, because the drop, the tip and the
       group's 1.1 swell all stack on a part that already reaches half
       again the shell's radius.
       A cradle that holds still while the lid swings off it also reads
       better than two halves parting symmetrically - the eye tracks
       one moving piece, and the ring stays put as the stable thing the
       boss is sitting in. Re-measure with the open probe if either
       fraction changes. */
    b.shieldBottom.position.y = -SHIELD_LIFT * 0.22 * s;
    b.shieldBottom.rotation.x = -SHIELD_TIP * 0.14 * s;
    b.shieldMat.opacity = clamp01(glow);
    /* Sealed brass is lit; an unlocked cage steps back so it stops
       competing with the body the player has finally been given
       permission to hit. Driven through material.color rather than by
       toggling `transparent`, which would recompile the program. */
    const dim = lerp(1, 0.5, s);
    const c = clamp01(call);
    b.shieldFrameMat.color.setRGB(
      dim * (1 + c * 0.75), dim * (1 + c * 0.40), dim * (1 - c * 0.40)
    );
    b.shieldMat.color.setRGB(1 + c * 0.55, 1, 1 - c * 0.55);
  }

  function openShield(f, actor) {
    ctx.vfx?.burst?.("auraWave", actor.pos, { color: 0x50e3a0, radius: 4 });
    ctx.vfx?.flash?.(0x50e3a0, 0.3, 0.25);
    pulsePylons(f, 2);
  }

  function closeWindow(f, actor, why) {
    f.k.window = false;
    f.k.cycleStart = beat.index;
    f.k.combo = 0;
    // The cage slams shut rather than easing: onFight's damp would
    // take a third of a second to reseal it, and a shield that is
    // still visibly open while it is already invulnerable is the one
    // lie this fight cannot tell.
    f.k.split = 0;
    presentShield(actor, 0, SHIELD_IDLE_GLOW, 0);
    ctx.hud?.clearPrompt?.();
    ctx.hud?.setBeatPulse?.(0);
    ctx.audio?.play?.(why === "voided" ? "boss.phantom.void" : "boss.phantom.close");
    ctx.bus?.emit?.("boss:window", { id: f.id, open: false, why });
    pulsePylons(f, 0);
  }

  function voidContract(f, actor) {
    // Off the beat inside the window. The shield slams shut, and the
    // player learns that mashing is the one thing that cannot work.
    f.k.voided += 1;
    tmp.v1.copy(actor.pos); tmp.v1.y += actor.height * 0.5;
    ctx.vfx?.burst?.("beamHit", tmp.v1, { color: 0xff3b30, count: 14 });
    ctx.vfx?.shake?.(0.4, 0.2);
    ctx.hud?.toast?.("OFF BEAT - CONTRACT VOID", { seconds: 1.4, style: "warn" });
    closeWindow(f, actor, "voided");
  }

  function sparkShield(actor) {
    if (actor.k.sparkCd > 0) return;
    actor.k.sparkCd = 0.25;
    tmp.v1.copy(actor.pos); tmp.v1.y += actor.height * 0.55;
    ctx.vfx?.burst?.("beamHit", tmp.v1, { color: 0x50e3a0, count: 8 });
    ctx.audio?.play?.("boss.deflect", { pos: actor.pos });
  }

  /** Drive whatever world.js gave us for the pylons. Level 0 is idle,
   *  1 is the call, 2 is the open window. If the hook was never
   *  provided this does nothing and the audio cue carries it. */
  function pulsePylons(f, level) {
    const pylons = f.arena.hooks.shieldPylons;
    if (!Array.isArray(pylons)) return;
    for (let i = 0; i < pylons.length; i += 1) {
      const p = pylons[i];
      if (!p) continue;
      if (p.material && p.material.emissive) {
        p.material.emissive.setHex(level === 2 ? 0x50e3a0 : level === 1 ? 0xffd23f : 0x101820);
      }
      if (p.userData) p.userData.pylonLevel = level;
    }
  }

  function chequeVolley(f, actor) {
    if (!player.ok) return;
    const n = f.k.volley || 2;
    tmp.v1.copy(actor.pos); tmp.v1.y += 1.2;
    for (let i = 0; i < n; i += 1) {
      const spread = (i - (n - 1) / 2) * 2.2;
      tmp.v3.set(player.pos.x + spread, player.pos.y, player.pos.z + spread * 0.4);
      fireArc(actor, tmp.v1, tmp.v3, 1.1, { damage: 1, color: 0x50e3a0, radius: 0.55, life: 2.6 });
    }
    actor.poseArmR = -1.5;
    window.setTimeout(() => { actor.poseArmR = 0; }, 220);
    ctx.audio?.play?.("boss.phantom.cheque", { pos: actor.pos });
  }

  /** A ring that expands from the boss along the floor. Jumped, not
   *  dodged - and it always arrives on a beat, so the jump is a beat
   *  the player can count into. */
  function royaltySweep(f, actor) {
    if (!f.k.sweeps) f.k.sweeps = [];
    f.k.sweeps.push({ x: actor.pos.x, z: actor.pos.z, r: 1.5, speed: 11, life: 2.4, hit: false });
    ctx.vfx?.burst?.("landRing", actor.pos, { color: 0xffd23f, radius: 3 });
    ctx.audio?.play?.("boss.phantom.sweep", { pos: actor.pos });
  }

  function updateSweeps(f, dt) {
    const list = f.k.sweeps;
    if (!list || !list.length) return;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const s = list[i];
      s.r += s.speed * dt;
      s.life -= dt;
      if (player.ok && !s.hit) {
        const d = Math.hypot(player.pos.x - s.x, player.pos.z - s.z);
        const gy = groundAt(player.pos.x, player.pos.z, player.pos.y);
        if (Math.abs(d - s.r) < 1.1 && player.pos.y - gy < 1.3) {
          s.hit = true;
          tmp.v1.set(s.x, gy + 0.4, s.z);
          hurtPlayer(1, tmp.v1, "phantom.sweep");
        }
      }
      if (s.life <= 0 || s.r > f.arena.radius * 1.3) list.splice(i, 1);
    }
  }

  /* ============================================================
     3. LUCIFER LIPSYNC

     Three acts on a stadium stage, and the arena is a different
     problem in each one.

     ACT 1  THE PLAYBACK. He is up on a lift over a rotating stage,
            throwing ranged pop attacks on the beat. The stage turning
            under the player is what stops act one being a shooting
            gallery: every dodge has to account for the floor moving.
            He descends periodically to work the crowd, and that
            descent is the only way to reach him.

     ACT 2  THE PRODUCTION. The LED walls come alive and the floor
            starts dropping out in panels. This act is a platforming
            challenge that happens to be under fire - the danger is the
            gap, and his attacks are what stops the player taking the
            safe route across it.

     ACT 3  THE VOICE. He drops the mic, the backing track stops, and
            it becomes a close-quarters fight. Three strikes, three
            distinct tells - a cocked arm, a coiled crouch, a low
            lunge - each with its own colour, sound and recovery
            window. This is the act that has to be readable, because
            it is the only one where the player is inside his reach.
     ============================================================ */
  const LUCIFER_PALETTE = {
    base: 0x8c1f42, trim: 0xff3d6e, dark: 0x3d1020, head: 0xf0c9b4,
    hair: 0x2a0a18, gold: 0xffd23f,
  };

  /* Act one's lift height. He is 4.6m tall, so this already puts his
     head eleven metres up - any higher and the act is played against
     an empty sky with the boss out of frame. */
  const LUCIFER_HOVER = 5.6;

  const luciferFight = makeFight({
    id: "lucifer",
    phases: 3,
    phaseNames: ["THE PLAYBACK", "THE PRODUCTION", "THE VOICE"],
    introSeconds: 4.4,
    transitionSeconds: 3.0,
    defeatSeconds: 4.2,
    leashSeconds: 6,
    phaseFlash: 0xd42a55,
    hitInvuln: 0.2,
    phaseAt: (frac) => (frac <= 0.33 ? 2 : frac <= 0.66 ? 1 : 0),

    onArm(f) {
      f.k.stageSpin = 0;
      f.k.panels = null;
      f.k.sweeps = null;
    },

    onReset(f) {
      f.k.stageSpin = 0;
      f.k.attackT = 0;
      f.k.descendT = 9;
      f.k.tell = null;
      f.k.panelT = 0;
      f.k.wallT = 0;
      restorePanels(f);
      const a = f.actors[0];
      if (a && a.parts.mic) a.parts.mic.visible = true;
    },

    /* WAITING. Centre stage, mic in hand, arms down, mid-song. He is
       the largest object in the course and he is standing in the
       middle of it from the moment the arena loads - which is what a
       final boss is for, and what makes the walk down the aisle
       towards him mean anything. */
    onStation(f) {
      const a = f.actors[0];
      a.pos.copy(f.arena.center);
      a.pos.y = arenaFloor(f, a.pos.x, a.pos.z);
      a.poseArmR = -0.95; a.poseArmRZ = -0.55;
      a.poseArmL = 0.25; a.poseArmLZ = 0.30;
      a.poseHead = -0.22;
      if (a.parts.mic) a.parts.mic.visible = true;
    },

    onStationStep(f, dt) {
      const a = f.actors[0];
      // Working the crowd on the beat, because the crowd is there and
      // the backing track has not stopped.
      const swing = Math.sin(f.stageT * 2.4);
      a.roll = swing * 0.07;
      a.poseArmL = 0.25 + swing * 0.35;
      driveStage(f, dt, 0.08);
    },

    onIntro(f) {
      const a = f.actors[0];
      a.k.hover = LUCIFER_HOVER;
      a.k.introFrom = a.pos.y;
      ctx.hud?.prompt?.("BOYZ II HELL - FINAL LIVESTREAM");
    },

    onIntroStep(f, dt, t) {
      const a = f.actors[0];
      const base = arenaFloor(f, a.pos.x, a.pos.z);
      // He goes UP on the lift with his arms out, held in the pose for
      // the whole ride. It is the most expensive-looking thing this
      // module does and it costs one lerp. (It used to be a descent
      // from fourteen metres, which required him to have been hidden
      // in the ceiling until the player walked in.)
      a.pos.y = lerp(a.k.introFrom, base + a.k.hover, ease.inOutCubic(t));
      a.poseArmL = lerp(0, -2.2, ease.outCubic(clamp01(t * 1.6)));
      a.poseArmR = lerp(0, -2.2, ease.outCubic(clamp01(t * 1.6)));
      a.poseArmLZ = lerp(0, 0.5, ease.outCubic(clamp01(t * 1.6)));
      a.poseArmRZ = lerp(0, -0.5, ease.outCubic(clamp01(t * 1.6)));
      a.yaw += dt * (1 - t) * 3;
      if (t > 0.75) a.poseHead = lerp(0, -0.5, (t - 0.75) / 0.25);
      driveStage(f, dt, 0.35 * t);
    },

    onPhase(f, n) {
      const a = f.actors[0];
      /* EVERY ACT HANDS THE ACTOR ITS OPENING MODE. Each act reads a
         different set of mode names off the same field, and act two
         only ever wrote its default through `a.k.mode = a.k.mode ||
         "ride"` - which never fires, because the mode arriving from
         act one is "hover" and "hover" is truthy. Act two then matched
         neither of its branches: Lucifer stopped moving, stopped
         attacking, and stopped being damageable, at 58% health, in the
         middle of the final boss fight. */
      a.k.mode = n === 0 ? "hover" : n === 1 ? "ride" : "stalk";
      a.k.modeT = 0.6;
      if (n === 1) {
        a.k.rechargeT = 4;
        f.k.panelT = 1.5;
        f.k.wallT = 2.2;
        ctx.hud?.prompt?.("The floor is part of the show now.");
      } else if (n === 2) {
        /* THE MIC DROP. He stops pretending, lands, and the fight
           changes shape. Everything about the transition says it:
           the mic leaves his hand, the backing track cuts, and the
           camera comes down to head height. */
        if (a.parts.mic) a.parts.mic.visible = false;
        restorePanels(f);
        ctx.audio?.music?.("boss.lucifer.live", { fade: 0.4 });
        ctx.hud?.prompt?.("HE IS ACTUALLY SINGING");
        f.k.tell = null;
        f.k.attackT = 1.2;
      }
    },

    onTransitionStep(f, dt, t) {
      const a = f.actors[0];
      const base = arenaFloor(f, a.pos.x, a.pos.z);
      if (f.phase === 2) {
        a.pos.y = lerp(a.pos.y, base, clamp01(dt * 3));
        a.poseArmL = lerp(a.poseArmL, 0.4, clamp01(dt * 4));
        a.poseArmR = lerp(a.poseArmR, 0.4, clamp01(dt * 4));
        a.poseLean = lerp(0, -0.25, ease.outCubic(t));
        if (t > 0.4 && !f.k.micDropped) {
          f.k.micDropped = true;
          ctx.vfx?.burst?.("poundShock", a.pos, { color: 0xffd23f, radius: 6 });
          ctx.vfx?.shake?.(1.1, 0.6);
          ctx.audio?.play?.("boss.lucifer.micdrop", { pos: a.pos });
        }
      } else {
        a.pos.y = damp(a.pos.y, base + 9, 2, dt);
        a.yaw += dt * 4 * (1 - t);
      }
      a.tintWant.setRGB(1 + t * 1.2, 1, 1);
      if (t > 0.97) a.tintWant.setRGB(1, 1, 1);
    },

    /* He is only soft when he is close enough to be hit - which is
       exactly when the fight has handed the player a window. Acts one
       and two gate on that; act three is an honest brawl. */
    canDamage(f, actor, opts) {
      if (f.phase === 0) {
        if (actor.k.mode !== "descend") { sparkOff(actor); return false; }
        return opts.pound ? 1.5 : 1;
      }
      if (f.phase === 1) {
        if (actor.k.mode !== "recharge") { sparkOff(actor); return false; }
        return 2;              // the overload window is worth taking
      }
      if (actor.k.mode === "recover") return opts.pound ? 1.6 : 1.2;
      return 1;
    },

    onFight(f, dt) {
      const a = f.actors[0];
      const base = arenaFloor(f, a.pos.x, a.pos.z);
      if (f.phase === 0) luciferAct1(f, a, dt, base);
      else if (f.phase === 1) luciferAct2(f, a, dt, base);
      else luciferAct3(f, a, dt, base);
      updateSweeps(f, dt);
    },

    onDefeat(f) {
      restorePanels(f);
      ctx.hud?.clearPrompt?.();
    },

    onLeash(f) {
      restorePanels(f);
      ctx.hud?.clearPrompt?.();
      const a = f.actors[0];
      if (a && a.parts.mic) a.parts.mic.visible = true;
      f.k.micDropped = false;
    },
  });

  /* --- act one ------------------------------------------------- */
  function luciferAct1(f, a, dt, base) {
    driveStage(f, dt, 0.22);
    a.k.mode = a.k.mode || "hover";
    f.k.descendT -= dt;

    if (a.k.mode === "hover") {
      f.k.orbit = (f.k.orbit || 0) + dt * 0.35;
      a.pos.x = damp(a.pos.x, f.arena.center.x + Math.cos(f.k.orbit) * 7, 1.8, dt);
      a.pos.z = damp(a.pos.z, f.arena.center.z + Math.sin(f.k.orbit) * 7, 1.8, dt);
      a.pos.y = damp(a.pos.y, base + LUCIFER_HOVER + Math.sin(f.stageT * 1.1) * 0.5, 2.4, dt);
      a.poseArmL = damp(a.poseArmL, -0.6, 5, dt);
      a.poseArmR = damp(a.poseArmR, -0.6, 5, dt);
      if (player.ok) a.yaw = dampAngle(a.yaw, Math.atan2(player.pos.x - a.pos.x, player.pos.z - a.pos.z), 4, dt);

      // Ranged pop, on the beat, so the whole act has a pulse.
      if (beat.fired && beat.index % 2 === 0) noteVolley(f, a, 3);
      if (beat.fired && beat.index % 8 === 0) spotlightMark(f, a);

      if (f.k.descendT <= 0) {
        a.k.mode = "descendCall";
        a.k.modeT = 1.0;
        a.tintWant.setHex(0xffd23f);
        ctx.audio?.play?.("boss.lucifer.descend");
        ctx.vfx?.burst?.("sparkle", a.pos, { color: 0xffd23f, count: 16, rise: 2 });
      }
    } else if (a.k.mode === "descendCall") {
      // A full second of telegraph before he comes into reach, so the
      // window reads as an invitation rather than an ambush.
      a.k.modeT -= dt;
      a.poseArmL = damp(a.poseArmL, -2.4, 8, dt);
      a.poseArmR = damp(a.poseArmR, -2.4, 8, dt);
      a.squashY = 1 + Math.sin(f.stageT * 20) * 0.06;
      if (a.k.modeT <= 0) { a.k.mode = "descend"; a.k.modeT = 4.2; }
    } else if (a.k.mode === "descend") {
      a.k.modeT -= dt;
      a.pos.y = damp(a.pos.y, base + 0.05, 3.4, dt);
      a.poseArmL = damp(a.poseArmL, 0.3, 6, dt);
      a.poseArmR = damp(a.poseArmR, 0.3, 6, dt);
      a.tintWant.setRGB(1.4, 1.1, 1.1);
      if (player.ok) {
        a.yaw = dampAngle(a.yaw, Math.atan2(player.pos.x - a.pos.x, player.pos.z - a.pos.z), 6, dt);
        if (playerDist(a.pos.x, a.pos.z) < 1.6 + a.girth && !(a.k.touchCd > 0)) {
          a.k.touchCd = 1.2;
          hurtPlayer(1, a.pos, "lucifer.contact");
        }
      }
      if (a.k.touchCd > 0) a.k.touchCd -= dt;
      if (a.k.modeT <= 0) {
        a.k.mode = "hover";
        f.k.descendT = 11;
        a.tintWant.setRGB(1, 1, 1);
        ctx.vfx?.burst?.("dust", a.pos, { count: 14, spread: 2 });
      }
    }
  }

  /* --- act two -------------------------------------------------- */
  function luciferAct2(f, a, dt, base) {
    a.k.mode = a.k.mode || "ride";
    f.k.panelT -= dt;
    f.k.wallT -= dt;

    if (f.k.panelT <= 0) { dropPanels(f); f.k.panelT = 5.5; }
    if (f.k.wallT <= 0) { ledSweep(f, a); f.k.wallT = 3.4; }
    stepPanels(f, dt);

    if (a.k.mode === "ride") {
      f.k.orbit = (f.k.orbit || 0) + dt * 0.5;
      a.pos.x = damp(a.pos.x, f.arena.center.x + Math.cos(f.k.orbit) * 13, 1.6, dt);
      a.pos.z = damp(a.pos.z, f.arena.center.z + Math.sin(f.k.orbit) * 13, 1.6, dt);
      a.pos.y = damp(a.pos.y, base + 5.5, 2, dt);
      if (player.ok) a.yaw = dampAngle(a.yaw, Math.atan2(player.pos.x - a.pos.x, player.pos.z - a.pos.z), 4, dt);
      if (beat.fired && beat.index % 4 === 0) noteVolley(f, a, 2);
      a.k.rechargeT = (a.k.rechargeT === undefined ? 8 : a.k.rechargeT) - dt;
      if (a.k.rechargeT <= 0) {
        /* THE OVERLOAD. He backs onto a wall panel to recharge, and
           for two and a half seconds the wall is feeding him where the
           player can reach it. Damage here is doubled, because the
           player had to cross the broken floor to get it. */
        a.k.mode = "recharge";
        a.k.modeT = 2.6;
        a.tintWant.setHex(0x6fd7ff);
        ctx.audio?.play?.("boss.lucifer.recharge", { pos: a.pos });
        ctx.hud?.toast?.("HE IS RECHARGING - HIT HIM", { seconds: 1.6 });
      }
    } else if (a.k.mode === "recharge") {
      a.k.modeT -= dt;
      a.pos.y = damp(a.pos.y, base + 0.6, 3, dt);
      a.poseArmL = damp(a.poseArmL, -2.6, 6, dt);
      a.poseArmR = damp(a.poseArmR, -2.6, 6, dt);
      a.squashY = 1 + Math.sin(f.stageT * 26) * 0.07;
      if (rng() < dt * 12) {
        tmp.v1.copy(a.pos); tmp.v1.y += 1.5;
        ctx.vfx?.burst?.("sparkle", tmp.v1, { color: 0x6fd7ff, count: 5 });
      }
      if (a.k.modeT <= 0) {
        a.k.mode = "ride";
        a.k.rechargeT = 9;
        a.tintWant.setRGB(1, 1, 1);
        a.poseArmL = 0; a.poseArmR = 0;
      }
    }
  }

  /* --- act three: the tells ------------------------------------
     Three attacks, and every one of them is announced by a pose the
     player can name. The pose comes first, holds, and only then does
     the strike land - which is the entire difference between a hard
     fight and an unfair one. */
  const LUCIFER_TELLS = {
    hook: {
      windup: 0.52, active: 0.22, recover: 1.35, reach: 4.2, damage: 2,
      colour: 0xff3b30, sound: "boss.lucifer.hook",
      pose(a, t) { a.poseArmR = lerp(0.4, -2.6, t); a.poseArmRZ = lerp(0, 1.1, t); a.poseLean = lerp(0, -0.32, t); },
      strike(a) { a.poseArmR = 1.4; a.poseArmRZ = -0.5; a.poseLean = 0.4; },
    },
    stomp: {
      windup: 0.64, active: 0.24, recover: 1.5, reach: 6.5, damage: 2,
      colour: 0xffffff, sound: "boss.lucifer.stomp",
      pose(a, t) {
        a.poseArmL = lerp(0.4, -2.9, t); a.poseArmR = lerp(0.4, -2.9, t);
        a.squashY = lerp(1, 0.74, t); a.squashX = lerp(1, 1.22, t);
      },
      strike(a) { a.squashY = 1.25; a.squashX = 0.85; a.poseArmL = 0.8; a.poseArmR = 0.8; },
    },
    grab: {
      windup: 0.58, active: 0.34, recover: 1.15, reach: 3.6, damage: 3,
      colour: 0xffd23f, sound: "boss.lucifer.grab",
      pose(a, t) {
        a.poseArmL = lerp(0.4, -1.6, t); a.poseArmR = lerp(0.4, -1.6, t);
        a.poseLean = lerp(0, 0.34, t); a.squashY = lerp(1, 0.88, t);
      },
      strike(a) { a.poseLean = 0.55; a.poseArmL = -1.9; a.poseArmR = -1.9; },
    },
  };
  const TELL_ORDER = ["hook", "grab", "stomp"];

  function luciferAct3(f, a, dt, base) {
    a.pos.y = damp(a.pos.y, base, 8, dt);
    const dist = playerDist(a.pos.x, a.pos.z);
    if (player.ok && a.k.mode !== "strike") {
      a.yaw = dampAngle(a.yaw, Math.atan2(player.pos.x - a.pos.x, player.pos.z - a.pos.z), 5, dt);
    }

    // The encore: below fifteen percent he stops attacking and sings.
    // A screen-wide wave on a long, obvious wind-up - the one attack
    // in the fight that cannot be blocked, only answered by moving.
    if (a.hp / a.maxHp < 0.15 && a.k.mode !== "encore" && !(f.k.encoreDone)) {
      f.k.encoreDone = true;
      a.k.mode = "encore";
      a.k.modeT = 2.6;
      a.tintWant.setHex(0xffd23f);
      ctx.hud?.toast?.("ENCORE - GET OFF THE FLOOR", { style: "warn", seconds: 2.4 });
      ctx.audio?.play?.("boss.lucifer.encore", { pos: a.pos });
      ctx.cameraRig?.setMode?.("boss", { center: f.arena.center, radius: f.arena.radius, target: a.pos, seconds: 0.6 });
    }

    if (a.k.mode === "encore") {
      a.k.modeT -= dt;
      const t = 1 - clamp01(a.k.modeT / 2.6);
      a.poseArmL = -2.9 * t; a.poseArmR = -2.9 * t;
      a.poseHead = -0.7 * t;
      a.squashY = 1 + t * 0.2;
      a.tintWant.setRGB(1 + t * 2, 1 + t, 1);
      if (rng() < dt * 20) ctx.vfx?.burst?.("sparkle", a.pos, { color: 0xffd23f, count: 6, rise: 3 });
      if (a.k.modeT <= 0) {
        royaltySweep(f, a);
        if (!f.k.sweeps) f.k.sweeps = [];
        f.k.sweeps.push({ x: a.pos.x, z: a.pos.z, r: 1, speed: 16, life: 3, hit: false });
        ctx.vfx?.flash?.(0xffd23f, 0.7, 0.5);
        ctx.vfx?.shake?.(1.4, 0.8);
        a.k.mode = "recover";
        a.k.modeT = 2.2;
        a.tintWant.setRGB(1, 1, 1);
      }
      return;
    }

    if (a.k.mode === "windup") {
      a.k.modeT -= dt;
      const tell = LUCIFER_TELLS[a.k.tell];
      const t = 1 - clamp01(a.k.modeT / tell.windup);
      tell.pose(a, ease.inQuad(t));
      a.tintWant.setHex(tell.colour);
      if (a.k.modeT <= 0) {
        a.k.mode = "strike";
        a.k.modeT = tell.active;
        a.k.hitDone = false;
        tell.strike(a);
        ctx.audio?.play?.(tell.sound, { pos: a.pos });
        if (a.k.tell === "stomp") {
          ctx.vfx?.burst?.("poundShock", a.pos, { color: 0xffffff, radius: tell.reach });
          ctx.vfx?.shake?.(0.9, 0.35);
        }
      }
      return;
    }

    if (a.k.mode === "strike") {
      a.k.modeT -= dt;
      const tell = LUCIFER_TELLS[a.k.tell];
      if (!a.k.hitDone && dist < tell.reach * a.scale) {
        const infront = Math.abs(angleDelta(a.yaw, Math.atan2(player.pos.x - a.pos.x, player.pos.z - a.pos.z)));
        if (a.k.tell === "stomp" || infront < 1.25) {
          a.k.hitDone = true;
          hurtPlayer(tell.damage, a.pos, `lucifer.${a.k.tell}`);
        }
      }
      if (a.k.tell === "grab") {
        // He closes on the grab. It is the one attack you cannot walk
        // out of, only jump over.
        if (player.ok) {
          const dx = player.pos.x - a.pos.x, dz = player.pos.z - a.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          a.pos.x += (dx / d) * 9 * dt;
          a.pos.z += (dz / d) * 9 * dt;
        }
      }
      if (a.k.modeT <= 0) {
        a.k.mode = "recover";
        a.k.modeT = tell.recover;
        a.tintWant.setRGB(1, 1, 1);
      }
      return;
    }

    if (a.k.mode === "recover") {
      // THE WINDOW. He is soft here, and the pose says so: dropped
      // guard, head down, no colour on him.
      a.k.modeT -= dt;
      a.poseArmL = damp(a.poseArmL, 0.7, 5, dt);
      a.poseArmR = damp(a.poseArmR, 0.7, 5, dt);
      a.poseLean = damp(a.poseLean, 0.18, 5, dt);
      a.poseHead = damp(a.poseHead, 0.3, 5, dt);
      a.squashY = damp(a.squashY, 0.94, 6, dt);
      a.squashX = damp(a.squashX, 1.05, 6, dt);
      if (a.k.modeT <= 0) { a.k.mode = "stalk"; a.k.modeT = 0.4 + rng() * 0.6; }
      return;
    }

    // Stalking. He closes to reach and picks the next tell from a
    // rotating order with a little jitter, so the fight has a rhythm
    // without becoming a memorised sequence.
    a.k.modeT = (a.k.modeT === undefined ? 0.6 : a.k.modeT) - dt;
    a.poseArmL = damp(a.poseArmL, 0.4, 5, dt);
    a.poseArmR = damp(a.poseArmR, 0.4, 5, dt);
    a.poseLean = damp(a.poseLean, -0.08, 5, dt);
    a.poseHead = damp(a.poseHead, 0, 5, dt);
    a.squashY = damp(a.squashY, 1, 6, dt);
    a.squashX = damp(a.squashX, 1, 6, dt);
    if (player.ok && dist > 3.0 * a.scale) {
      const dx = player.pos.x - a.pos.x, dz = player.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      a.pos.x += (dx / d) * 4.6 * dt;
      a.pos.z += (dz / d) * 4.6 * dt;
      playClip(a, "run", 0.2);
    } else {
      playClip(a, "idle", 0.2);
    }
    if (a.k.modeT <= 0 && dist < 8) {
      a.k.tellIndex = ((a.k.tellIndex === undefined ? -1 : a.k.tellIndex) + 1) % TELL_ORDER.length;
      let tell = TELL_ORDER[a.k.tellIndex];
      if (dist > 5 && rng() < 0.6) tell = "stomp";
      a.k.tell = tell;
      a.k.mode = "windup";
      a.k.modeT = LUCIFER_TELLS[tell].windup;
      tmp.v1.copy(a.pos); tmp.v1.y += 2.2;
      ctx.vfx?.burst?.("sparkle", tmp.v1, { color: LUCIFER_TELLS[tell].colour, count: 8 });
      ctx.audio?.play?.(`${LUCIFER_TELLS[tell].sound}.tell`, { pos: a.pos });
    }
  }

  /* --- Lucifer's arena machinery -------------------------------- */
  function driveStage(f, dt, speed) {
    const stage = f.arena.hooks.stage;
    f.k.stageSpin = (f.k.stageSpin || 0) + dt * speed;
    if (stage && stage.rotation) stage.rotation.y = f.k.stageSpin;
    // world.js is told what the stage is doing even when it did not
    // hand us a pivot, so a course can drive its own riders off this.
    ctx.bus?.emit?.("boss:stage", { id: f.id, angle: f.k.stageSpin, speed });
  }

  function noteVolley(f, a, n) {
    if (!player.ok) return;
    tmp.v1.copy(a.pos); tmp.v1.y += 1.1;
    for (let i = 0; i < n; i += 1) {
      const spread = (i - (n - 1) / 2) * 0.32;
      tmp.v2.set(player.pos.x - tmp.v1.x, (player.pos.y + 0.9) - tmp.v1.y, player.pos.z - tmp.v1.z);
      tmp.v2.normalize();
      tmp.v2.applyAxisAngle(UP, spread);
      tmp.v2.multiplyScalar(17);
      fire(a, tmp.v1, tmp.v2, {
        gravity: 0.1, damage: 1, color: 0xd42a55, life: 3, radius: 0.5, homing: i === 1 ? 1.4 : 0,
      });
    }
    a.poseArmR = -1.9;
    ctx.audio?.play?.("boss.lucifer.note", { pos: a.pos });
  }

  /** A spotlight that finds the player, holds for a beat and a half,
   *  then fires. The mark is the telegraph and it is drawn on the
   *  floor where the player is looking. */
  function spotlightMark(f, a) {
    if (!player.ok) return;
    if (!f.k.marks) f.k.marks = [];
    f.k.marks.push({ x: player.pos.x, z: player.pos.z, t: 1.3, r: 3.2 });
    tmp.v1.set(player.pos.x, groundAt(player.pos.x, player.pos.z, player.pos.y) + 0.05, player.pos.z);
    ctx.vfx?.decal?.("spotlight", tmp.v1, UP, 3.2);
    ctx.vfx?.burst?.("sparkle", tmp.v1, { color: 0xffffff, count: 8 });
    ctx.audio?.play?.("boss.lucifer.spotlight", { pos: tmp.v1 });
  }

  function updateMarks(f, dt) {
    const marks = f.k.marks;
    if (!marks || !marks.length) return;
    for (let i = marks.length - 1; i >= 0; i -= 1) {
      const m = marks[i];
      m.t -= dt;
      if (m.t > 0) continue;
      tmp.v1.set(m.x, arenaFloor(f, m.x, m.z) + 0.2, m.z);
      ctx.vfx?.burst?.("poundShock", tmp.v1, { color: 0xffffff, radius: m.r });
      ctx.vfx?.flash?.(0xffffff, 0.2, 0.15);
      if (player.ok && playerDist(m.x, m.z) < m.r) hurtPlayer(1, tmp.v1, "lucifer.spotlight");
      marks.splice(i, 1);
    }
  }

  /** Drop a third of the floor panels. world.js owns the geometry; we
   *  own which ones and when, and animate the y offset it handed us.
   *  Without the hook the act still runs - it is simply flat. */
  function dropPanels(f) {
    const panels = f.arena.hooks.floorPanels;
    if (!Array.isArray(panels) || !panels.length) return;
    if (!f.k.panels) {
      f.k.panels = panels.map((p) => ({
        obj: p, baseY: p.position ? p.position.y : 0, phase: "up", t: 0,
      }));
    }
    const n = Math.max(1, Math.floor(f.k.panels.length / 3));
    for (let i = 0; i < n; i += 1) {
      const p = f.k.panels[Math.floor(rng() * f.k.panels.length)];
      if (!p || p.phase !== "up") continue;
      p.phase = "warn";
      p.t = 0.9;
      if (p.obj.material && p.obj.material.emissive) p.obj.material.emissive.setHex(0xd42a55);
    }
    ctx.audio?.play?.("boss.lucifer.panels");
  }

  function stepPanels(f, dt) {
    const list = f.k.panels;
    if (!list) return;
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      if (p.phase === "up") continue;
      p.t -= dt;
      if (p.phase === "warn") {
        // Flashing on a fast cycle, because a panel that is about to
        // stop being floor has to be readable while running over it.
        if (p.obj.material && p.obj.material.emissive) {
          const k = (Math.sin(p.t * 30) * 0.5 + 0.5) * 0.9;
          p.obj.material.emissive.setRGB(k, k * 0.15, k * 0.25);
        }
        if (p.t <= 0) { p.phase = "down"; p.t = 4.2; }
      } else if (p.phase === "down") {
        if (p.obj.position) p.obj.position.y = damp(p.obj.position.y, p.baseY - 7, 4, dt);
        if (p.t <= 0) { p.phase = "rise"; p.t = 1.4; }
      } else if (p.phase === "rise") {
        if (p.obj.position) p.obj.position.y = damp(p.obj.position.y, p.baseY, 5, dt);
        if (p.t <= 0) {
          p.phase = "up";
          if (p.obj.position) p.obj.position.y = p.baseY;
          if (p.obj.material && p.obj.material.emissive) p.obj.material.emissive.setHex(0x000000);
        }
      }
    }
  }

  function restorePanels(f) {
    const list = f.k.panels;
    if (!list) return;
    for (const p of list) {
      p.phase = "up";
      p.t = 0;
      if (p.obj.position) p.obj.position.y = p.baseY;
      if (p.obj.material && p.obj.material.emissive) p.obj.material.emissive.setHex(0x000000);
    }
  }

  /** A wall panel lights, then throws a sweep across the arena. The
   *  ring form is reused from the Phantom deliberately: the player has
   *  already learned to jump one of these, and act two is not the
   *  place to teach a new dodge. */
  function ledSweep(f, a) {
    const walls = f.arena.hooks.ledWalls;
    if (Array.isArray(walls) && walls.length) {
      const wall = walls[Math.floor(rng() * walls.length)];
      if (wall && wall.material && wall.material.emissive) wall.material.emissive.setHex(0xd42a55);
      if (wall && wall.userData) wall.userData.firing = 1;
    }
    if (!f.k.sweeps) f.k.sweeps = [];
    f.k.sweeps.push({
      x: f.arena.center.x, z: f.arena.center.z, r: 2, speed: 13, life: 3, hit: false,
    });
    ctx.vfx?.burst?.("landRing", f.arena.center, { color: 0xd42a55, radius: 4 });
    ctx.audio?.play?.("boss.lucifer.ledsweep");
  }

  const UP = new NS.Vector3(0, 1, 0);

  /* ============================================================
     WIRING
     ============================================================ */
  const fights = new Map([
    ["twins", twinsFight],
    ["phantom", phantomFight],
    ["lucifer", luciferFight],
  ]);

  /* Actor construction. Done once at create so no fight ever builds
     geometry mid-frame - a boss appearing is a visibility flip.

     The scales are the readability budget from the PROXY BODIES header,
     against Moggadonna's 1.7m:

       twins    2.6m   half again her height. They are her doubles and
                       the mirror has to still read as a mirror, so they
                       are the one act that cannot tower - the ring
                       light and the shoulder flares do that work
                       instead.
       phantom  5.3m   inside a 5.7m cage that hugs it. Nothing else on
                       any course is this shape.
       lucifer  4.6m   final boss, twice the room's tallest enemy,
                       horns above that. */
  {
    const a = makeActor("twinA", buildTwinBody(TWIN_PALETTE_A), {
      hp: 12, scale: 1.42, girth: 0.6,
      k: { delay: 1.0, mirror: "x", state: "replay", beamColour: 0xff2f7a },
    });
    const b = makeActor("twinB", buildTwinBody(TWIN_PALETTE_B), {
      hp: 12, scale: 1.42, girth: 0.6,
      k: { delay: 1.0, mirror: "z", state: "replay", beamColour: 0x00d0ff },
    });
    twinsFight.actors.push(a, b);
  }
  {
    const p = makeActor("phantom", buildPhantomBody(PHANTOM_PALETTE), { hp: 18, scale: 1.35, girth: 1.1 });
    phantomFight.actors.push(p);
  }
  {
    const l = makeActor("lucifer", buildLuciferBody(LUCIFER_PALETTE), {
      hp: 36, scale: 1.8, girth: 1.0, k: { mode: "hover" },
    });
    luciferFight.actors.push(l);
  }
  for (const f of fights.values()) f.totalHp();

  /** The nearest armed fight the player is actually inside. Only one
   *  boss can be live at a time; the rest cost a distance check. */
  function activeFight() {
    for (const f of fights.values()) {
      if (f.stage !== "dormant" && f.stage !== "done") return f;
    }
    return null;
  }

  /** The fight this course is carrying, live or still waiting. Damage
   *  routing must NOT use this - a dormant boss is not hittable - but
   *  "which boss is in this course" is a different question, and the
   *  answer to it is what a status readout and a camera preset want. */
  function courseFight() {
    for (const f of fights.values()) if (f.armed) return f;
    return null;
  }

  /** Route an incoming hit to whichever actor is nearest the source.
   *  Every player verb funnels through here so the per-fight damage
   *  gate cannot be bypassed. */
  function hitNear(position, amount, opts) {
    const f = activeFight();
    if (!f || f.stage !== "fight") return 0;
    let best = null;
    let bestD = 0;
    for (const a of f.actors) {
      if (a.hp <= 0 && !a.downed) continue;
      // Measured to the SURFACE, not to the origin. A four-metre boss
      // whose hit radius is measured from its centre is a boss the
      // player is standing inside of and still missing.
      const reach = ((opts && opts.radius) || 4.5) + a.girth;
      const d = Math.hypot(a.pos.x - position.x, a.pos.z - position.z) - a.girth;
      if (d < reach && (!best || d < bestD)) { bestD = d; best = a; }
    }
    if (!best) return 0;
    return f.damage(best, amount, opts || {});
  }

  let syncedFrame = -1;

  function syncShots() {
    let n = 0;
    for (let i = 0; i < shots.length; i += 1) {
      const s = shots[i];
      if (!s.live) continue;
      tmp.euler.set(s.spin, s.spin * 0.6, 0, "YXZ");
      tmp.quat.setFromEuler(tmp.euler);
      tmp.scale.set(1, 1, 1);
      tmp.m4.compose(s.pos, tmp.quat, tmp.scale);
      shotMesh.setMatrixAt(n, tmp.m4);
      tmp.colour.setHex(s.colour);
      shotMesh.setColorAt(n, tmp.colour);
      n += 1;
      if (n >= SHOT_MAX) break;
    }
    shotMesh.count = n;
    if (n > 0) {
      shotMesh.instanceMatrix.needsUpdate = true;
      if (shotMesh.instanceColor) shotMesh.instanceColor.needsUpdate = true;
    }
  }

  function update() {
    const dt = ctx.clock ? ctx.clock.dt : 0;
    probePlayer(ctx, player);
    beat.tick();

    // Cooldown scratch that several fights share.
    for (const f of fights.values()) {
      for (const a of f.actors) if (a.k.sparkCd > 0) a.k.sparkCd -= dt;
    }

    if (dt > 0) {
      for (const f of fights.values()) {
        if (!f.armed && f.stage === "dormant") continue;
        f.update(dt);
        if (f.id === "lucifer") updateMarks(f, dt);
      }
      updateShots(dt);
      autoContactTest();
    }
    syncedFrame = ctx.clock ? ctx.clock.frame : -1;
    syncShots();
  }

  /** The player landing on a boss. Runs here as well as through
   *  player.js so a stomp works before that module lands - the same
   *  arrangement enemies.js has, and for the same reason. */
  function autoContactTest() {
    if (!player.ok) return;
    if (player.vel.y > 0.5 && !player.pounding) return;
    const f = activeFight();
    if (!f || f.stage !== "fight") return;
    for (const a of f.actors) {
      const dy = player.pos.y - a.pos.y;
      if (dy < a.height * 0.4 || dy > a.height + 2.2) continue;
      if (Math.hypot(player.pos.x - a.pos.x, player.pos.z - a.pos.z) > 1.1 + a.girth) continue;
      const dealt = f.damage(a, player.pounding ? 2 : 1, { pound: player.pounding, stomp: true });
      ctx.player?.bounce?.(dealt > 0 ? 12 : 8, dealt > 0 ? "kill" : "bounce");
      return;
    }
  }

  const api = {
    ARENAS, BOSS_IDS,
    bus,
    group,

    /* --- world.js seam -------------------------------------------
       world.js asks what to build, builds it, and hands back the
       pieces this module drives. Nothing here builds geometry. */
    arenaRequest(id) { return ARENAS[id] ? ARENAS[id].request : null; },

    /**
     * world.js hands back an arena it has built.
     *
     * AN UNKNOWN ID IS SHOUTED ABOUT, NOT SWALLOWED. This used to
     * return false in silence, and it is exactly how two courses
     * shipped with a Platinum Record gated on a fight that never
     * armed: `out.boss("payola", ...)` and `out.boss("plant", ...)`
     * named nothing, no arena was provided, no boss ever appeared, and
     * the only symptom was a record the player could not earn. A bad
     * id is a level-authoring mistake and it should read like one.
     */
    provideArena(id, payload) {
      const courseId = payload && Number.isFinite(payload.courseId) ? payload.courseId : null;
      const booking = resolveBooking(id, courseId);
      const f = booking ? fights.get(booking.fight) : null;
      if (!f) {
        console.warn(
          `[apop3d] bosses.provideArena("${id}"): no such fight`
          + `${courseId === null ? "" : ` (course ${courseId})`}.`
          + ` Registered fights: ${BOSS_IDS.join(", ")}.`
          + ` Names courses may book: ${BOOKINGS.map((b) => `${b.id}(course ${b.course})`).join(", ")}.`
          + " The arena was NOT built and anything gated on this fight is unwinnable."
        );
        return false;
      }
      if (!payload) return false;

      if (payload.center || payload.position) {
        const c = payload.center || payload.position;
        f.arena.center.set(
          c.x !== undefined ? c.x : c[0],
          c.y !== undefined ? c.y : c[1],
          c.z !== undefined ? c.z : c[2]
        );
      }
      // The booking's shape first, then anything the course said
      // explicitly - a course always outranks a table in this file.
      f.arena.radius = Number.isFinite(booking.radius) ? booking.radius : ARENAS[f.id].radius;
      f.arena.leashRadius = Number.isFinite(booking.leashRadius)
        ? booking.leashRadius : ARENAS[f.id].leashRadius;
      if (Number.isFinite(payload.radius)) f.arena.radius = payload.radius;
      if (Number.isFinite(payload.leashRadius)) f.arena.leashRadius = payload.leashRadius;
      f.openPhase = clamp(booking.openPhase || 0, 0, f.phaseCount - 1);
      f.closePhase = clamp(
        Number.isFinite(booking.closePhase) ? booking.closePhase : f.phaseCount - 1,
        f.openPhase, f.phaseCount - 1
      );
      f.title = booking.title || ARENAS[f.id].name;
      f.arena.group = payload.group || null;
      f.arena.hooks = payload.hooks || {};
      f.arena.provided = true;
      f.arena.courseId = courseId;
      f.arena.bookedAs = booking.id;
      f.arena.record = payload.record || null;
      f.phase = f.openPhase;

      /* Home poses follow the arena, so a course can put the fight
         anywhere without this module knowing where that is. See
         arenaFloor(): the course's own y is the reference and the
         collision probe only refines it. */
      const authored = Number.isFinite(f.arena.center.y) ? f.arena.center.y : 0;
      const probed = groundOrNull(f.arena.center.x, f.arena.center.z, authored + 0.6);
      f.arena.floorY = (probed === null || Math.abs(probed - authored) > FLOOR_TOLERANCE)
        ? authored : probed;
      for (const a of f.actors) {
        a.home.copy(f.arena.center);
        a.home.y = f.arena.floorY;
        a.pos.copy(a.home);
      }
      bus.emit("arena", { id: f.id, as: booking.id, course: courseId, hooks: Object.keys(f.arena.hooks) });
      return true;
    },
    arm(id) { const f = fights.get(id); return f ? f.arm() : false; },
    disarm(id) {
      if (id === undefined || id === null) { for (const f of fights.values()) f.disarm(); return; }
      const f = fights.get(id);
      if (f) f.disarm();
    },
    /**
     * Arm whichever fight this course booked, and disarm the rest.
     *
     * The membership test is the BOOKING, not `ARENAS[id].course`.
     * Three fights cover five courses, so a frozen course number on the
     * arena request can only ever be right for one of them: course 1
     * booked the Payola Phantom, provideArena placed its arena, and
     * then this refused to arm it because the Phantom's `course` field
     * says 3. The arena a course actually provided is the evidence.
     */
    armForCourse(courseId) {
      let armed = null;
      for (const id of BOSS_IDS) {
        const f = fights.get(id);
        const booked = f.arena.provided && f.arena.courseId === courseId;
        const declared = f.arena.courseId === null && ARENAS[id].course === courseId;
        if (!booked && !declared) { f.disarm(); continue; }
        f.arm();
        armed = id;
      }
      return armed;
    },

    /* --- player.js seam ------------------------------------------ */
    hit(id, amount, opts) {
      const f = fights.get(id) || activeFight();
      if (!f) return 0;
      const a = f.actors[0];
      return f.damage(a, amount, opts || {});
    },
    stomp(position, opts) { return hitNear(position, (opts && opts.pound) ? 2 : 1, { ...(opts || {}), stomp: true }); },
    pound(position, radius) { return hitNear(position, 2, { pound: true, radius: radius || 4.5 }); },
    beam(origin, direction, range, opts) {
      const f = activeFight();
      if (!f || f.stage !== "fight") return 0;
      const len = range || 16;
      const m = Math.hypot(direction.x, direction.z) || 1;
      const ux = direction.x / m, uz = direction.z / m;
      let dealt = 0;
      for (const a of f.actors) {
        const dx = a.pos.x - origin.x, dz = a.pos.z - origin.z;
        const along = dx * ux + dz * uz;
        if (along < 0 || along > len) continue;
        const off = Math.abs(dx * -uz + dz * ux);
        if (off > 2.0 + a.girth) continue;
        dealt += f.damage(a, (opts && opts.damage) || 1, { beam: true });
      }
      return dealt;
    },
    aura(position, radius) {
      // The screen-clearing special does NOT ignore a boss's gate.
      // A special that skips the Phantom's contract window would
      // delete the only idea that fight has.
      return hitNear(position, 3, { aura: true, radius: radius || 10 });
    },

    /* --- lifecycle -----------------------------------------------
       enter() ARMS. It used to disarm every fight, and world.js calls
       it AFTER armForCourse - so every boss in the game was armed and
       then immediately switched off again, in every course, and no
       fight had ever run outside a debug hook. Arming here instead
       makes the order of the two calls irrelevant, which is the point:
       world.js should not have to know. */
    enter(c, payload) {
      clearShots();
      const course = payload && payload.course !== undefined
        ? payload.course : (ctx.state ? ctx.state.course : 0);
      return api.armForCourse(course);
    },
    exit() { for (const f of fights.values()) { f.disarm(); f.resetActors(); } clearShots(); },
    update,
    lateUpdate() {
      const fr = ctx.clock ? ctx.clock.frame : -1;
      if (fr === syncedFrame) return;
      syncedFrame = fr;
      syncShots();
    },

    /* --- introspection ------------------------------------------- */
    active() { const f = activeFight(); return f ? f.id : null; },

    /**
     * Where the boss IS - the accessor camera.js's `boss` capture
     * preset probes for.
     *
     * It walks ["nearest", "active", "current", ...] looking for
     * something it can read an {x,y,z} out of, and `active()` returns
     * an id STRING, which is not one. So the preset resolved "no boss
     * in this course" in every course that has one and the boss frame
     * was skipped in every capture run - the same finding a blind
     * review round returned as "no subject".
     *
     * Only reports a boss that is actually on screen: a hidden one
     * would have the camera frame an empty patch of floor, which is
     * the failure this is here to fix.
     *
     * IT REPORTS THE FIGHT'S BASE, NOT ITS CHEST, AND THAT IS A FIX.
     * This used to return `pos.y + height * 0.55` on the reasoning
     * that a camera wants to aim at a chest rather than at a pair of
     * feet. Its only consumer is camera.js's `boss` preset, and that
     * preset does not aim here - it LIFTS from here, by half of
     * whatever `extentOf` reports, to find the middle of the fight.
     * The two together double-counted: for the Payola Phantom the aim
     * landed 2.9 m of chest plus 3.2 m of half-extent above the floor
     * of its own arena, which is above the top of the boss, and the
     * shot was refused outright with "outside the frame" the moment
     * `extentOf` started returning a real number instead of the 5.0 m
     * guess that had been absorbing the error. Base plus half the
     * extent is the fight's actual centre; the lift belongs to the
     * caller, and the caller already has it.
     */
    nearest(origin) {
      let best = null;
      let bestD = Infinity;
      for (const f of fights.values()) {
        if (!f.armed && f.stage === "dormant") continue;
        if (f.stage === "done") continue;
        // Once per fight: both of these cost a raycast or a walk over
        // the actor list, and neither varies between the actors of one
        // fight enough to be worth paying for each of them.
        let extent = null;
        for (const a of f.actors) {
          const node = a.rig ? a.rig.root : a.root;
          if (!node || !node.visible) continue;
          const d = origin
            ? (a.pos.x - origin.x) ** 2 + (a.pos.z - origin.z) ** 2
            : 0;
          if (d < bestD) {
            bestD = d;
            if (extent === null) extent = api.extentOf(f.id);
            // A plain object: camera.js keeps whatever it is handed
            // past the frame, and a live actor vector would then drift
            // under it. The FLOOR the fight stands or hovers over -
            // see the note above - with the chest and the fight's full
            // extent alongside it, so a caller that wants either can
            // take it without guessing at the proportion.
            best = {
              x: a.pos.x, y: arenaFloor(f, a.pos.x, a.pos.z), z: a.pos.z, id: a.id,
              chestY: a.pos.y + a.height * 0.55,
              extent,
            };
          }
        }
      }
      return best;
    },

    /**
     * THE FIGHT EXTENT - how tall the thing camera.js has to fit is.
     *
     * camera.js's `boss` preset asks for this and falls back to a flat
     * 5.0 m when it is missing, which it always was. Five metres is a
     * guess that happens to sit between the three fights in this file
     * and is wrong for all of them: the Algorithm Twins are under four
     * and Lucifer Lipsync, hovering, is nearly twelve. A guess in the
     * middle crops the big fight and shoots the small one from too far
     * back.
     *
     * WHAT THE NUMBER MEANS. Metres from the arena floor to the top of
     * the fight's visible mass, taking the tallest actor. Floor-based
     * rather than origin-based because two of the three fights HOVER,
     * and the hover is part of what has to be in the picture: the
     * Payola Phantom floats 1.05 m up, so its shell - 5.67 m across,
     * centred 2.44 m over its own origin - reaches 6.33 m of room, and
     * with the lid unlocked and the idle bob at the top of its travel,
     * about 7.5. Lucifer at LUCIFER_HOVER is 11.8 m up.
     *
     * A live fight is measured off its actors, so the number tracks
     * the phase - Lucifer stalking on the deck needs half the headroom
     * he does in the air. A dormant one falls back to the arena's
     * authored hover plus the built body, which is what a capture
     * preset posing before the fight arms will read.
     *
     * `name` accepts a fight id, a course's booking id, the string
     * "boss" (camera.js passes its own preset name), or nothing at
     * all - all four mean "the fight this course is about".
     */
    extentOf(name) {
      const key = String(name === undefined || name === null ? "" : name);
      let f = null;
      if (key && key !== "boss") {
        f = fights.get(key) || null;
        if (!f) {
          const booking = resolveBooking(key,
            ctx.state ? ctx.state.course : undefined);
          if (booking) f = fights.get(booking.fight) || null;
        }
      }
      if (!f) f = activeFight() || courseFight();
      if (!f || !f.actors.length) return 0;

      /* The steady hover each fight sits at when it is not being
         measured live. Kept next to the numbers that produce it rather
         than duplicated as a literal. */
      const restHover = f.id === "phantom" ? PHANTOM_HOVER
        : f.id === "lucifer" ? LUCIFER_HOVER : 0;

      let best = 0;
      for (const a of f.actors) {
        const node = a.rig ? a.rig.root : a.root;
        const live = !!(node && node.visible) && f.stage !== "dormant";
        /* Live: read the actor where it actually is, which folds in
           the hover, the bob and any phase that has put it on the
           ground. Dormant: the resting pose, because that is the fight
           a preset solved before the trigger ring is crossed. */
        const lift = live
          ? Math.max(0, a.pos.y - arenaFloor(f, a.pos.x, a.pos.z))
          : restHover;
        best = Math.max(best, lift + a.top);
      }
      return +best.toFixed(2);
    },

    status(id) {
      const f = id ? fights.get(id) : (activeFight() || courseFight());
      if (!f) return null;
      f.totalHp();
      return {
        id: f.id, name: f.name, title: f.title,
        stage: f.stage, phase: f.phase, phases: f.phaseCount,
        openPhase: f.openPhase, closePhase: f.closePhase,
        armed: f.armed, defeated: f.defeated,
        hp: Number(f.hp.toFixed(2)), maxHp: f.maxHp,
        arenaProvided: f.arena.provided,
        course: f.arena.courseId, bookedAs: f.arena.bookedAs, record: f.arena.record,
        center: [
          Number(f.arena.center.x.toFixed(2)),
          Number(f.arena.center.y.toFixed(2)),
          Number(f.arena.center.z.toFixed(2)),
        ],
        radius: f.arena.radius, leashRadius: f.arena.leashRadius,
        visible: f.actors.some((a) => (a.rig ? a.rig.root : a.root).visible),
        hooks: Object.keys(f.arena.hooks),
        window: f.id === "phantom" ? !!f.k.window : undefined,
        beat: { index: beat.index, onBeat: beat.onBeat, phase: Number(beat.phase.toFixed(3)) },
        /* The fight's own scratch, scalars only. A fight's schedule is
           the thing most worth watching from a test - the Phantom's
           contract window in particular is a beat count nothing else
           can see - and a live object here would not survive being
           passed back through page.evaluate. */
        k: Object.fromEntries(Object.entries(f.k).filter(([, v]) => (
          typeof v === "number" || typeof v === "boolean" || typeof v === "string"
        )).map(([n, v]) => [n, typeof v === "number" ? Number(v.toFixed(3)) : v])),
        actors: f.actors.map((a) => ({
          id: a.id, hp: Number(a.hp.toFixed(2)), maxHp: a.maxHp,
          // Which body is on screen: character.js's rig, or the proxy
          // fallback. Worth reporting - they do not look alike, and a
          // palette tuned on one is invisible on the other.
          body: a.rig ? "rig" : "proxy", scale: a.scale,
          mode: a.k.mode || a.k.state || a.state, downed: !!a.downed,
          x: Number(a.pos.x.toFixed(2)), y: Number(a.pos.y.toFixed(2)), z: Number(a.pos.z.toFixed(2)),
        })),
      };
    },
    /** Jump straight into a phase. For checks that are about the phase
     *  rather than about how the fight gets there - the same reasoning
     *  as saintfall's forcePhase. */
    forcePhase(id, n) {
      const f = fights.get(id);
      if (!f) return null;
      if (f.stage === "dormant") { f.arm(); f.beginPhase(f.openPhase, true); f.stage = "fight"; }
      for (const a of f.actors) f.show(a, true);
      f.beginPhase(clamp(n | 0, 0, f.phaseCount - 1), true);
      f.stage = "fight";
      return api.status(id);
    },
    reset(id) {
      const f = fights.get(id);
      if (!f) return false;
      f.beginLeash("qa");
      f.stage = "dormant";
      f.defeated = false;
      f.defeatedIn.clear();
      f.arm();
      return true;
    },
    /** Skip the walk-in: put the player straight into a live fight.
     *  The boss preset screenshot needs this before world.js has any
     *  arenas in it. */
    debugStart(id) {
      const f = fights.get(id);
      if (!f) return null;
      f.arm();
      for (const a of f.actors) f.show(a, true);
      f.beginPhase(f.openPhase, true);
      f.stage = "fight";
      return api.status(id);
    },

    dispose() {
      for (const f of fights.values()) f.disarm();
      ctx.scene.remove(group);
      shotMesh.geometry.dispose();
      shotMesh.dispose();
      shotMaterial.dispose();
      for (const f of fights.values()) {
        for (const a of f.actors) {
          a.material?.dispose?.();
          // The matcap is a canvas texture this module synthesised, so
          // disposing the material it hangs off is not enough.
          a.built.shieldMat?.matcap?.dispose?.();
          a.built.shieldMat?.dispose?.();
          a.built.shieldFrameMat?.dispose?.();
          for (const key of Object.keys(a.parts)) {
            const part = a.parts[key];
            if (part && part.geometry) part.geometry.dispose();
          }
        }
      }
    },

    wire() {
      /* NOT ctx.world.register(group, "dynamic") - the same trap
         enemies.js documents at its own wire(). register() parents
         whatever it is given into the COURSE root, and world.unload()
         calls geometry.dispose() on every mesh under that root and
         then empties it. Handing it this group therefore destroyed all
         four boss proxies and the projectile mesh the first time
         anybody changed course: the fights kept arming, kept posing
         and kept swinging, and nothing was ever drawn for them again
         for the rest of the session - which also means every boss
         screenshot after the first course load was of an empty arena.
         This group is owned here, lives on ctx.scene from create(),
         and outlives every course. */
      if (group.parent !== ctx.scene) ctx.scene.add(group);
      // Rigs, when character.js can supply them. Asked for once, at
      // wire time, because a boss is not spawned and despawned.
      attachRig(twinsFight.actors[0], "twin");
      attachRig(twinsFight.actors[1], "twin");
      attachRig(phantomFight.actors[0], "phantom");
      attachRig(luciferFight.actors[0], "lucifer");

      /* world.js emits "world:load" - not "world:loaded", which is what
         this listened for, so it never fired once. It did not show
         because world.js also calls enter() directly; it would have
         shown the moment anything else loaded a course. */
      ctx.bus?.on?.("world:load", (payload) => {
        const course = payload && payload.course !== undefined
          ? payload.course
          : (payload && payload.id !== undefined ? payload.id
            : (ctx.state ? ctx.state.course : 0));
        api.enter(ctx, { course });
      });
      ctx.bus?.on?.("world:unload", () => api.exit());
      ctx.bus?.on?.("player:died", () => {
        const f = activeFight();
        if (f && f.stage !== "defeat" && f.stage !== "done") f.beginLeash("died");
      });
      ctx.bus?.on?.("player:pound", (p) => { if (p) api.pound(p.position || p, p.radius); });
      /* THE MOG BEAM. moveset.js emits
         { position, dirX, dirZ, range, damage, onBeat } - it has no
         `origin`/`direction` pair, so the old guard here rejected every
         single beam the player has ever fired and no boss in the game
         could be shot. The signature verb of a game called Apop Demon
         MOGGERS did nothing to a boss. Both shapes are accepted now. */
      ctx.bus?.on?.("player:beam", (p) => {
        if (!p) return;
        const origin = p.origin || p.position || p.pos;
        if (!origin || !Number.isFinite(origin.x)) return;
        const dir = p.direction
          || (Number.isFinite(p.dirX) ? { x: p.dirX, y: 0, z: p.dirZ } : null);
        if (!dir) return;
        api.beam(origin, dir, p.range, p);
      });
      ctx.bus?.on?.("player:aura", (p) => { if (p) api.aura(p.position || p, p.radius); });
    },
  };

  instance = api;
  return api;
}

export function ready(ctx) {
  if (instance && typeof instance.wire === "function") instance.wire(ctx);
}
