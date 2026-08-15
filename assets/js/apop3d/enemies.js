/* ============================================================
   APOP DEMON MOGGERS 3D - enemies

   The eight demon archetypes, their AI, and the spawner that keeps
   sixty of them on a course without costing sixty draw calls.

   WHAT AN SM64 ENEMY IS FOR

   Every enemy in that game teaches exactly one thing, and it teaches
   it by being survivable while you learn. A Goomba teaches the stomp.
   A Bob-omb teaches the throw. A Whomp teaches that some things are
   only soft from behind. None of them is a damage-per-second problem;
   each is a small readable question with one correct answer. So each
   archetype here owns one lesson and nothing else:

     Auto-Tune Imp      the wind-up. It tells you before it charges.
     Lip-Sync Lackey    the crowd. Harmless alone, a wall in a pack.
     Industry Plant     the arc. Something you dodge or send back.
     Pay-Pig Demon      the pound. Armoured in front, only the pound
                        or a rear hit gets through.
     Stan-Account Bat   look up. It owns the air until you aim there.
     Backup Dancer      the beat. It only moves on it, so you can
                        read it in advance if you listen.
     VIP Bouncer        the bait. Too strong to fight, so use a wall.
     Paparazzi Drone    the approach. It punishes standing still and
                        folds the moment you close.

   THREE STRUCTURAL RULES, AND WHY

   1. TELEGRAPH EVERYTHING. No attack fires without a wind-up that is
      visible as a POSE (anticipation - the body compresses and leans
      away from where it is about to go), as COLOUR (the per-instance
      tint ramps toward the archetype's telegraph hue), and as a VFX
      and audio cue. An untelegraphed hit does not read as difficulty,
      it reads as a bug, and a hundred small unfair hits is what makes
      an AI read as cheap.

   2. THE DOUBLE-TAKE IS THE CHARACTER. An enemy that starts chasing
      the frame it sees you is a trigger volume. An enemy that flinches
      back, pops upright, and THEN comes is a creature. The whole
      perception chain - idle -> alert -> engaged -> lost-you ->
      return-to-post - exists so the player can read intent from the
      body at any moment.

   3. DEATH IS THE PAYOFF. Squash, hold, pop, coin spray, sound. The
      feedback on killing an enemy is most of a platformer's texture,
      and it is the one thing that gets cut first and noticed most.

   PRESENTATION: TWO TIERS, AND WHY THE PROXY IS NOT A PLACEHOLDER

   character.js builds skinned rigs, anim.js drives them, and a skinned
   mesh is one draw call, one skeleton update and one bone-texture
   upload each. Sixty of those is the frame budget gone. So:

     RIG TIER    the nearest few enemies, budgeted globally, get a real
                 rig from character.js and a real anim controller.
     PROXY TIER  everything else draws from ONE InstancedMesh per
                 archetype - eight draw calls for the whole course -
                 posed by matrix alone (squash, stretch, lean, hop)
                 and tinted per instance for telegraph and damage.

   The proxy geometry is lit at BUILD TIME into its vertex colours and
   drawn with an unlit material. That is deliberate: it makes the crowd
   independent of whatever state sky.js and materials.js are in, it
   costs nothing per frame, and it can never render as a black
   silhouette because a course has not allocated its lights yet.

   Contact shadows for the entire crowd are a second InstancedMesh
   using multiply blending, so every enemy is grounded (CONTRACT §2.2)
   for one draw call.

   OWNERSHIP NOTE. main.js's LATE_ORDER does not include this module,
   so all work - AI, physics and the instance-buffer upload - happens
   in update(). lateUpdate() is exported anyway and guarded by the
   frame counter, so if the spine ever moves us it stays correct
   instead of double-posing.
   ============================================================ */

import * as THREE from "three";
import {
  TAU, clamp, clamp01, lerp, damp, dampAngle, angleDelta, ease, makeRng, Bus,
} from "apop3d/core.js";

const GRAVITY = -22;                 // CONTRACT §5
const TILE = 2;                      // level grid, metres

/* AI runs at full rate near the player and on a stagger further out.
   A patrolling imp forty metres away does not need a perception test
   sixty times a second, and a course full of them is exactly where
   the CPU goes. */
const FULL_TICK_RANGE = 34;
const COARSE_TICK_FRAMES = 4;

/* How many enemies may hold a skinned rig at once. Kept small on
   purpose - past a handful, nobody can tell a rig from a posed proxy
   at SM64 framing (character at ~1/6 frame height), and the draw calls
   are gone either way. */
const RIG_BUDGET = 10;
const RIG_RANGE = 22;

/* ARCHETYPES THAT NEVER TAKE A RIG.

   Round six of the blind review, on the `collect` framing: the enemy
   over the ball pit is "a black slab with cyan sticks and a white tuft
   - at 100% it reads as a broken sprite or a debug gizmo, and it is
   the darkest object in the frame, so the eye lands on it first."
   Measured against the harness's own pose, that body was the
   Stan-Account Bat holding a rig: the player had been teleported onto
   the pit rim thirteen metres away, inside RIG_RANGE, so the skinned
   figure won the claim and drew instead of the proxy.

   The rig is the wrong tier for it. A Stan-Account Bat is 0.80 m tall
   and a Paparazzi Drone 0.55 m; at the framing these captures use they
   occupy something like thirty screen pixels, and a skinned figure at
   thirty pixels is not a figure, it is the average of its own dark
   parts - which is exactly what a black slab with sticks is. The proxy
   is the opposite trade: big rounded masses, values baked in at build
   time, and it can never render dark because it does not depend on the
   scene's lights at all.

   This is the rule the module's own header already states ("past a
   handful, nobody can tell a rig from a posed proxy at SM64 framing")
   applied at the small end. Nothing else changes: play() is a no-op
   without a rig by design, the procedural pose layer carries these two
   anyway, and both already have baked wing poses. */
const PROXY_ONLY = Object.freeze({ bat: true, drone: true });

/* Perception is not free and it is not urgent. Each enemy re-tests
   sight on its own phase-offset clock. */
const SENSE_PERIOD = 0.14;

/* How far a spawner post is simulated from.

   These were 68/86, which is a corridor number: on a course 120m across
   it puts half the population out of existence at any moment, and the
   screenshot harness - which teleports the player to whatever the
   capture preset is looking at - kept landing in the empty half. An
   SM64 course is populated everywhere you can SEE, not everywhere you
   can reach, and a sleeping enemy 90m away is not a saving worth
   having: the AI level-of-detail below already ticks anything past 34m
   at a quarter rate, and the whole crowd is eight instanced draws. */
const WAKE_RANGE = 130;
const SLEEP_RANGE = 155;

/* Default brood size per archetype, used when the course did not ask
   for a count.

   A course post says "an enemy lives here"; how MANY is a property of
   the archetype, not of the level. A Lip-Sync Lackey whose entire
   design note is "harmless alone, a wall in a pack" - it even carries a
   packSize of 3 - is a contradiction when a post spawns exactly one of
   them, and a Backup Dancer is a chorus line or it is nothing. The set
   pieces (plant, pig, bouncer, drone) stay singular on purpose: those
   read as encounters, and two of them is two encounters. */
const BROOD = Object.freeze({
  imp: 2, lackey: 4, plant: 1, pig: 1,
  bat: 2, dancer: 4, bouncer: 1, drone: 1,
});

/* A brood that big wants to stand as a group rather than in a scatter,
   so the pack archetypes get a ring by default. */
const BROOD_FORMATION = Object.freeze({
  lackey: "ring", dancer: "ring", bat: "line",
});

/* ------------------------------------------------------------
   THE CHORUS - what a line of Backup Dancers is shaped like

   Measured, on the one capture preset named after a confrontation:
   the Backup Dancer group owned 1.7% of the frame against a 2.8-9.5%
   band, and the character read only 22 luma against the field around
   her where every other preset in the set separates by 50 to 164.
   Both numbers come out of the same defect and it is a LAYOUT one.

   A `line` used to be laid out along the spawner's own +X axis while
   the members were turned to `facing`, and those two are not the same
   direction - worse, the offset frame rotated by +facing while a yaw
   rotates forward by -facing, so the two were MIRRORED and the error
   grew with the angle. Course 1's encounter post faces -0.62 rad,
   which put the rank within 19 degrees of the axis it was being
   photographed down: four dancers standing in single file behind one
   another. A queue seen end-on is one body wide - which is the 1.7% -
   and the nearest member of it stands exactly where the camera puts
   the character, which is the 22.

   So a rank now runs ACROSS its facing (shoulder to shoulder, all
   looking the same way, which is the only thing "a chorus line" can
   mean), and a beat-driven one is laid out as a chorus rather than as
   a picket fence:

   POCKET. The centre of the line is empty. It is the star's mark -
   the place a backup line exists to leave open - and it is also the
   only formation change that can fix the separation number, because
   the capture harness stands the character on the group's own centre
   line. The art direction note is "a hero not touching or overlapped
   by any other actor"; a gap three times her width, at the range this
   shot is taken from, is that note expressed in metres.

   RAKE. Outer pairs stand further back, so the rank has depth, the
   silhouettes overlap from any bearing that is not dead-on, and every
   member of the group is further from the lens than she is - which is
   also what keeps them out of the camera's near-actor veto.

   The scale is deliberately tighter than the spacing a level author
   writes: a post says how wide the knot is, not how a chorus stands
   in it, and at the 2.8 m course 1 asks for, four dancers spread over
   8.4 m and stop being one subject at all (the group search treats
   bodies more than 6.5 m apart as two groups). These numbers hold the
   whole rank inside that radius.
   ------------------------------------------------------------ */
const CHORUS_POCKET = 0.86;   // the empty centre, in units of spacing
const CHORUS_SPREAD = 0.62;   // rank-to-rank step, same units
const CHORUS_RAKE = 0.55;     // how far each outer pair stands back

const STATE = Object.freeze({
  IDLE: "idle",
  PATROL: "patrol",
  ALERT: "alert",           // the double-take
  ENGAGE: "engage",
  WINDUP: "windup",         // the telegraph
  STRIKE: "strike",
  RECOVER: "recover",
  HURT: "hurt",
  STUNNED: "stunned",       // charged into a wall, flipped, dazed
  RETREAT: "retreat",
  LOST: "lost",             // saw you, lost you, looking around
  RETURN: "return",         // walking back to post
  DEAD: "dead",             // squash, hold, pop
});

/* ============================================================
   THE ROSTER

   Fixed by CONTRACT §1. Tuning lives here rather than inline so the
   whole cast can be read side by side - which is the only way to tell
   whether eight archetypes actually feel different or whether four of
   them are the same enemy with a different hat.

   `palette.base` is the body's identity colour, `telegraph` is what
   the wind-up ramps toward, and the two are chosen far enough apart in
   VALUE (not just hue) that the ramp reads on a 240p frame and in
   monochrome, which is the test CONTRACT §2.3 actually applies.
   ============================================================ */
export const ROSTER = Object.freeze({
  imp: {
    label: "Auto-Tune Imp",
    spec: "imp",
    capacity: 18,
    radius: 0.42, height: 1.25, mass: 26, gravityScale: 1,
    hp: 1,
    walk: 1.9, run: 6.8,
    sight: { range: 15, halfAngle: 1.10, memory: 2.4 },
    stomp: "kill",
    clout: 3,
    palette: { base: 0xe0245f, trim: 0x2a0713, telegraph: 0xffd23f },
    attack: { windup: 0.62, active: 1.15, recover: 0.85, range: 11, damage: 1 },
    clips: { idle: "idle", walk: "walk", run: "run", alert: "idleFidget", windup: "beamCharge", strike: "dive", hurt: "hurt", stun: "dizzy" },
  },

  lackey: {
    label: "Lip-Sync Lackey",
    spec: "lackey",
    capacity: 26,
    radius: 0.34, height: 1.5, mass: 16, gravityScale: 1,
    hp: 1,
    walk: 2.6, run: 5.4,
    sight: { range: 13, halfAngle: 1.5, memory: 1.6 },
    stomp: "kill",
    clout: 1,
    palette: { base: 0x9ef0d2, trim: 0x123b34, telegraph: 0xff5ea8 },
    /* Harmless on its own - a lackey that cannot reach three friends
       does nothing but flail. `packSize` is the count within
       `packRadius` at which the mob starts actually biting. */
    attack: { windup: 0.34, active: 0.3, recover: 0.5, range: 1.6, damage: 1 },
    pack: { radius: 6.5, size: 3 },
    clips: { idle: "idle", walk: "run", run: "run", alert: "idleFidget", windup: "crouch", strike: "sideFlip", hurt: "hurt", stun: "dizzy" },
  },

  plant: {
    label: "Industry Plant",
    spec: "plant",
    capacity: 10,
    radius: 0.62, height: 1.9, mass: 90, gravityScale: 1,
    hp: 2,
    walk: 0, run: 0,                    // rooted; it is a turret
    sight: { range: 26, halfAngle: 1.6, memory: 4.0 },
    stomp: "kill",
    clout: 5,
    palette: { base: 0x37d67a, trim: 0x0d2b1c, telegraph: 0xfff45e },
    attack: { windup: 0.92, active: 0.2, recover: 1.6, range: 24, damage: 1 },
    shot: { speed: 15, flight: 1.15, radius: 0.55, damage: 1 },
    clips: { idle: "idle", alert: "idleFidget", windup: "beamCharge", strike: "beam", hurt: "hurt", stun: "dizzy" },
  },

  pig: {
    label: "Pay-Pig Demon",
    spec: "pig",
    capacity: 10,
    radius: 0.85, height: 1.5, mass: 240, gravityScale: 1,
    hp: 3,
    walk: 1.5, run: 5.2,
    sight: { range: 14, halfAngle: 0.95, memory: 3.2 },
    /* THE LESSON. A stomp on the plated front bounces you off with a
       clang and no damage either way; the pound flips it, and a
       flipped pig is soft everywhere. */
    stomp: "armoured",
    armourArc: 1.25,                    // half-angle of the front plate
    flipSeconds: 3.4,
    clout: 8,
    palette: { base: 0xf2b13c, trim: 0x3c2408, telegraph: 0xff4d2e },
    attack: { windup: 1.05, active: 1.4, recover: 1.1, range: 9, damage: 2 },
    clips: { idle: "idle", walk: "walk", run: "run", alert: "idleFidget", windup: "crouch", strike: "dive", hurt: "hurt", stun: "dizzy" },
  },

  bat: {
    label: "Stan-Account Bat",
    spec: "bat",
    capacity: 14,
    radius: 0.4, height: 0.8, mass: 12, gravityScale: 0,
    hp: 1,
    walk: 3.4, run: 9.5,
    sight: { range: 12, halfAngle: 3.2, memory: 2.0 },   // it looks down; no cone
    stomp: "kill",
    clout: 3,
    /* `wing` and `wingEdge` are extra keys this archetype's proxy
        reads; nothing else in the module requires them, and the three
        contract colours are unchanged. `trim` stays near-black because
        it is now only the phone case - a hand-sized object - rather
        than most of the silhouette. */
    palette: {
      base: 0x9b5cf0, trim: 0x2a1440, telegraph: 0xffb6e2,
      wing: 0x6f43b8, wingEdge: 0xc9a6f4,
    },
    /* THE LANE. It patrols a horizontal sine and dives when the player
       crosses underneath, which is what makes "look up" a lesson
       rather than an instruction. */
    lane: { length: 9, amplitude: 1.35, period: 3.6, height: 4.4 },
    dive: { trigger: 3.6, drop: 2.2, speed: 12, windup: 0.42 },
    attack: { windup: 0.42, active: 0.9, recover: 1.2, range: 1.8, damage: 1 },
    clips: { idle: "fall", alert: "idleFidget", windup: "beamCharge", strike: "dive", hurt: "hurt", stun: "dizzy" },
  },

  dancer: {
    label: "Backup Dancer Demon",
    spec: "dancer",
    capacity: 18,
    /* 1.78, which is character.js's `specs.dancer.height` to the
       centimetre, and it used to be 1.65. Two tiers of the same
       creature may not be two sizes: the proxy geometry is authored
       at its true height and never scaled, so the rig stood 8% taller
       than the proxy standing next to it in the same rank, and
       heroGroup - which sizes the confrontation shot off
       `spec.height` - under-reported every dancer's silhouette by the
       same 8%. */
    radius: 0.4, height: 1.78, mass: 40, gravityScale: 1,
    hp: 1,
    walk: 0, run: 0,                    // it does not walk; it steps, on the beat
    sight: { range: 18, halfAngle: 3.2, memory: 8 },
    stomp: "kill",
    clout: 4,
    /* ONE ARCHETYPE, ONE COLOUR, ACROSS TWO RENDERING PATHS.
       These three hexes are the Backup Dancer's identity and
       `character.js specs.dancer` carries the same identity in its own
       palette - teal body, near-black limbs, pale-teal crest and
       hands. It did not: the rig was gold and the proxy was teal, and
       because RIG_BUDGET puts at most three rigs of a kind on a course
       a chorus line of four showed both. Two colours of one creature
       standing in one rank reads as a bug, not as variety.
       The two paths do NOT share hex values, and cannot: this tier
       draws unlit, so its authored colour IS its screen value, while
       the rig's is albedo that the key light, the atlas and the rim
       all get a say in. What they share is the SCREEN value and the
       hue: measured on one captured frame with a proxy and a rig
       standing at the same distance, torso median 77.0 here against
       76.4 on the rig, mean RGB (39,85,94) against (53,93,95).
       Value stays UNDER the concourse it stands on (floor median 181
       in the same frame) and well over the character (28), so the
       crowd is a mid step and she is still the only true dark in the
       picture.

       base IS NOT 0x3ad7ff ANY MORE, and the reason is a measurement
       rather than a preference. At full value that cyan is the highest
       chroma and the highest VALUE surface in the game: the proxy tier
       draws through an unlit MeshBasicMaterial, so the scene's lights
       cannot pull it down, and mergeParts' bake tops out at 1.14 - so a
       key-facing face of a 0xff blue channel arrives clipped at 255 in
       every frame, in every room, at any time of day. Against course
       1's tan concourse a blind pass called it "an untextured
       placeholder" and, in the two frames named after a subject, it
       out-punched the character it was supposed to be threatening.
       Value * 0.75 with hue and saturation held, so the archetype's
       identity colour is unchanged and only its punch moves.
       `crest` is this archetype's extra key - the bat already carries
       two - because the accent on its head must NOT be `telegraph`.
       Telegraph is a white windup FLASH that the tint channel drives
       per frame; baking it into the geometry gave every dancer a
       permanent white disc wider than its own skull, which reads as a
       bar and not as a head. */
    palette: {
      base: 0x2ca1bf, trim: 0x08283a, telegraph: 0xffffff,
      crest: 0xa9dbe8,
    },
    /* One bar is four beats. The strike always lands on beat 4 and the
       crouch always sits on beat 3, so the telegraph is the music -
       a player who hears the bar knows where the hit is before the
       body moves. */
    attack: { windup: 0, active: 0.28, recover: 0, range: 2.4, damage: 1 },
    step: { distance: 1.6, seconds: 0.24, hop: 0.45 },
    /* It never stops dancing, so it never has a lost-you beat - the
       routine runs whether or not anybody is watching, which is the
       whole reason a course with dancers in it feels staged. */
    beatDriven: true,
    clips: { idle: "idle", alert: "idleFidget", windup: "crouch", strike: "sideFlip", hurt: "hurt", stun: "dizzy" },
  },

  bouncer: {
    label: "VIP Bouncer Demon",
    spec: "bouncer",
    capacity: 8,
    radius: 0.95, height: 2.3, mass: 320, gravityScale: 1,
    hp: 4,
    walk: 1.2, run: 13.5,
    sight: { range: 13, halfAngle: 1.25, memory: 5 },
    /* Nothing lands on this one while it is on its feet. The route it
       blocks opens by making it charge into the wall behind you. */
    stomp: "reject",
    guard: { post: 5.5, dazeSeconds: 3.8, dashSeconds: 0.95 },
    clout: 10,
    palette: { base: 0x1b1b22, trim: 0xd9b25a, telegraph: 0xffe17a },
    attack: { windup: 0.82, active: 0.95, recover: 1.3, range: 9.5, damage: 2 },
    clips: { idle: "idle", walk: "walk", run: "run", alert: "idleFidget", windup: "crouch", strike: "dive", hurt: "hurt", stun: "dizzy" },
  },

  drone: {
    label: "Paparazzi Drone",
    spec: "drone",
    capacity: 10,
    radius: 0.45, height: 0.55, mass: 8, gravityScale: 0,
    hp: 1,
    walk: 3.2, run: 6.4,
    sight: { range: 20, halfAngle: 3.2, memory: 3 },
    stomp: "kill",
    clout: 4,
    palette: { base: 0xe8ecf5, trim: 0x2b3350, telegraph: 0xfff9c4 },
    /* Standoff, not chase. It holds `standoff` metres of air, charges
       a flash that blinds, and backs away the moment the player is
       inside `flee` - slower than a run, so closing beats it. */
    hover: { height: 3.1, standoff: 9.5, flee: 6.5, fleeSpeed: 5.0 },
    flash: { windup: 1.05, radius: 8, stun: 1.6, damage: 1 },
    attack: { windup: 1.05, active: 0.25, recover: 2.1, range: 12, damage: 1 },
    clips: { idle: "fall", alert: "idleFidget", windup: "beamCharge", strike: "beam", hurt: "hurt", stun: "dizzy" },
  },
});

export const KINDS = Object.freeze(Object.keys(ROSTER));

/* ============================================================
   PROXY GEOMETRY

   Big, rounded, value-separated shapes (CONTRACT §2.3). Each is a
   handful of primitives merged into one buffer with a directional key
   light, a cool fill and a rim baked into the vertex colours, so the
   crowd reads as lit without depending on the scene's light set and
   without a per-frame cost.
   ============================================================ */

const KEY_DIR = new THREE.Vector3(0.42, 0.86, 0.30).normalize();
const FILL_DIR = new THREE.Vector3(-0.5, 0.25, -0.6).normalize();

/** Merge a parts list into one non-indexed buffer with baked shading.
 *  Written locally rather than pulled from three/addons so this module
 *  keeps the dependency list CONTRACT §3 gives it (physics, anim). */
export function mergeParts(parts) {
  const mat4 = new THREE.Matrix4();
  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const colour = new THREE.Color();
  const chunks = [];
  let total = 0;

  for (const part of parts) {
    // toNonIndexed() warns and hands back `this` when a geometry is
    // already non-indexed - which IcosahedronGeometry and everything
    // else derived from PolyhedronGeometry is. Test first, or the
    // console fills with warnings from this module at boot.
    const src = part.geo;
    const geo = src.index ? src.toNonIndexed() : src;
    if (geo !== src) src.dispose();
    const p = part.pos || [0, 0, 0];
    const r = part.rot || [0, 0, 0];
    const s = part.scale || [1, 1, 1];
    pos.set(p[0], p[1], p[2]);
    euler.set(r[0], r[1], r[2]);
    quat.setFromEuler(euler);
    scl.set(s[0], s[1], s[2]);
    mat4.compose(pos, quat, scl);
    geo.applyMatrix4(mat4);   // transforms normals by its own normal matrix
    chunks.push({ geo, colour: part.colour, emissive: part.emissive || 0 });
    total += geo.attributes.position.count;
  }

  const position = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const colours = new Float32Array(total * 3);
  let cursor = 0;

  for (const chunk of chunks) {
    const src = chunk.geo;
    const sp = src.attributes.position.array;
    const sn = src.attributes.normal.array;
    const count = src.attributes.position.count;
    colour.setHex(chunk.colour);
    for (let i = 0; i < count; i += 1) {
      const o = (cursor + i) * 3;
      position[o] = sp[i * 3];
      position[o + 1] = sp[i * 3 + 1];
      position[o + 2] = sp[i * 3 + 2];
      normal.set(sn[i * 3], sn[i * 3 + 1], sn[i * 3 + 2]).normalize();
      normals[o] = normal.x; normals[o + 1] = normal.y; normals[o + 2] = normal.z;
      // Key + cool fill + a rim that lifts the edge away from whatever
      // is behind it. The same three-term recipe the level art uses;
      // baked here because these vertices never move relative to each
      // other, so there is nothing to gain by doing it per frame.
      const key = Math.max(0, normal.dot(KEY_DIR));
      const fill = Math.max(0, normal.dot(FILL_DIR));
      const rim = Math.pow(1 - Math.abs(normal.z), 3) * 0.16;
      const lum = 0.46 + 0.54 * key + 0.14 * fill + chunk.emissive;
      colours[o] = clamp01(colour.r * lum + rim * 0.7);
      colours[o + 1] = clamp01(colour.g * lum + rim * 0.75);
      colours[o + 2] = clamp01(colour.b * lum + rim * 0.9);
    }
    cursor += count;
    src.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(position, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  out.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  out.computeBoundingSphere();
  return out;
}

/** A limb that is ATTACHED, by construction.
 *
 *  Every proxy in this file authors its arms as a position plus an
 *  Euler triple, and the two are maintained by hand. A blind pass on
 *  the Backup Dancer called out "a detached rectangle arm" and it was
 *  reading the asset correctly: pose two's left arm sat at z -0.22
 *  against a torso whose back face is at -0.14, so a 0.13 m stick was
 *  floating 0.015 m clear of the body with nothing joining them, and
 *  no pose had a shoulder at all. A limb described by the JOINT it
 *  hangs from and the DIRECTION it points cannot come off, because its
 *  centre is derived from the joint rather than typed next to it.
 *
 *  The Euler is derived too. THREE composes an "XYZ" euler as
 *  Rx*Ry*Rz, so with rotY held at zero it takes the box's own +Y axis
 *  to (-sin z, cos z cos x, cos z sin x); that inverts exactly, to
 *  z = asin(-dx) and x = atan2(dz, dy). Solving it rather than
 *  eyeballing it is what lets a pose be authored as "where the hand
 *  goes", which is the only way three counts of one routine stay
 *  recognisably the same routine. */
function limbPart(joint, dir, len, thick, colour) {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const dx = dir[0] / l, dy = dir[1] / l, dz = dir[2] / l;
  return {
    geo: new THREE.BoxGeometry(thick, len, thick),
    colour,
    pos: [joint[0] + dx * len * 0.5, joint[1] + dy * len * 0.5, joint[2] + dz * len * 0.5],
    rot: [Math.atan2(dz, dy), 0, Math.asin(clamp(-dx, -1, 1))],
  };
}

/** Where that limb ends - the hand or the foot. */
function limbTip(joint, dir, len) {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  return [
    joint[0] + (dir[0] / l) * len,
    joint[1] + (dir[1] / l) * len,
    joint[2] + (dir[2] / l) * len,
  ];
}

/* Every proxy is authored with its origin at the FEET, because that is
   where a physics body's position sits and because a shape whose
   pivot is its own contact point can be squashed toward the ground
   without drifting off it. */
/* ------------------------------------------------------------
   POSE VARIANTS - how many baked poses each archetype gets

   The proxy tier is the MAJORITY of any crowd, not a fallback:
   RIG_BUDGET is ten rigs across the whole course and three per kind,
   so a chorus line of four dancers has at most three real rigs behind
   it and usually fewer. Whatever the proxy geometry does is therefore
   what most figures on screen are doing.

   Which is why one baked pose was the single loudest "unfinished"
   signal in the review set: the Backup Dancer's arms are welded into a
   symmetric V at +/-0.85 rad, its brood is four, and its default
   formation is a ring - so the frame showed five to eight identical
   figures, arms straight out, evenly spaced. A rigged pose pool cannot
   reach any of them; these are vertices, not bones.

   A pose here is a whole separate merged buffer and therefore a
   separate InstancedMesh, so the count is deliberately small. Two or
   three is all it takes: the failure is not "insufficient variety", it
   is "the same silhouette repeated at equal spacing", and breaking the
   repeat is what costs nothing. Kinds that spawn alone (plant, pig,
   bouncer, drone) stay at one - a set piece is never a crowd.

   Empty variant batches are free: three's WebGLBufferRenderer returns
   before it issues a draw when instance count is zero, so an unused
   pose costs neither a draw call nor a line in renderer.info.
   ------------------------------------------------------------ */
const PROXY_POSES = Object.freeze({
  imp: 2, lackey: 3, dancer: 3, bat: 2,
});

/** How many baked poses a kind has. One unless listed above. */
export function proxyPoseCount(kind) {
  return PROXY_POSES[kind] || 1;
}

const PROXY_BUILDERS = {
  imp(p, v) {
    const S = THREE.SphereGeometry, C = THREE.ConeGeometry, B = THREE.BoxGeometry;
    // Variant 1 holds the mic overhead and cocks its head the other
    // way, so two imps side by side do not mirror each other.
    const mic = v === 1 ? [0.30, 1.32, -0.16] : [0.28, 0.86, -0.30];
    const bulb = v === 1 ? [0.32, 1.50, -0.24] : [0.28, 0.86, -0.50];
    const hornTilt = v === 1 ? 0.60 : 0.34;
    return mergeParts([
      { geo: new S(0.46, 10, 8), colour: p.base, pos: [0, 0.52, 0], scale: [1, 0.95, 1] },
      { geo: new S(0.30, 8, 6), colour: p.base, pos: [0, 1.02, 0.02] },
      { geo: new C(0.10, 0.30, 5), colour: p.trim, pos: [-0.19, 1.24, 0], rot: [0, 0, hornTilt] },
      { geo: new C(0.10, 0.30, 5), colour: p.trim, pos: [0.19, 1.24, 0], rot: [0, 0, -0.20] },
      // The mic it is auto-tuning through - the read at distance.
      { geo: new B(0.11, 0.11, 0.34), colour: p.trim, pos: mic, rot: v === 1 ? [0.9, 0, 0] : [0, 0, 0] },
      { geo: new S(0.13, 6, 5), colour: p.telegraph, pos: bulb, emissive: 0.35 },
      { geo: new B(0.42, 0.13, 0.06), colour: 0x120207, pos: [0, 1.06, -0.26] },
    ]);
  },

  lackey(p, v) {
    const S = THREE.SphereGeometry, Cy = THREE.CylinderGeometry, B = THREE.BoxGeometry;
    /* Three arm sets, and one of them is not a mirror pair. A ring of
       four lackeys used to be four identical figures at 90 degrees to
       each other; with three poses cycled by formation index, no two
       neighbours in that ring ever match. */
    const ARMS = [
      [{ pos: [-0.30, 0.72, 0], rot: [0, 0, 0.5] }, { pos: [0.30, 0.72, 0], rot: [0, 0, -0.5] }],
      [{ pos: [-0.34, 0.92, -0.06], rot: [0.3, 0, 1.15] }, { pos: [0.26, 0.60, 0.10], rot: [-0.2, 0, -0.15] }],
      [{ pos: [-0.24, 0.58, -0.16], rot: [-0.5, 0, 0.18] }, { pos: [0.24, 0.58, -0.16], rot: [-0.5, 0, -0.18] }],
    ];
    const arms = ARMS[v % ARMS.length];
    // A shoulder tilt on the odd pose, so the whole body reads as
    // leaning rather than as a torso with different arms bolted on.
    const tilt = v === 1 ? 0.10 : 0;
    return mergeParts([
      { geo: new Cy(0.24, 0.30, 0.85, 7), colour: p.base, pos: [0, 0.44, 0], rot: [0, 0, tilt] },
      { geo: new S(0.36, 9, 7), colour: p.base, pos: [tilt * 0.9, 1.18, 0] },
      // Permanently mid-word. A mouth this size is most of the
      // silhouette and all of the joke.
      { geo: new S(0.19, 7, 6), colour: 0x150c1c, pos: [tilt * 0.9, 1.10, -0.26], scale: [1, 1.25, 0.6] },
      { geo: new B(0.10, 0.52, 0.10), colour: p.trim, pos: arms[0].pos, rot: arms[0].rot },
      { geo: new B(0.10, 0.52, 0.10), colour: p.trim, pos: arms[1].pos, rot: arms[1].rot },
      { geo: new Cy(0.30, 0.30, 0.08, 8), colour: p.telegraph, pos: [tilt * 0.9, 1.48, 0], emissive: 0.2 },
    ]);
  },

  /* THE INDUSTRY PLANT, REBUILT AS A CREATURE IN A POT.

     A blind pass on the frame named after a confrontation: "the enemies
     are potted plants at the right edge - the frame reads as a
     furniture showroom." It was a fair reading of the asset. The old
     proxy was a pot, a straight stem, a ball and a cone, symmetric
     about its own axis, with two flat leaves at matching angles: from
     any bearing that is a houseplant, and a houseplant is set dressing
     however it behaves.

     The pot stays - it is the joke, and it is what says "rooted" - but
     nothing above it is symmetric any more. The stem LEANS at the
     player in two segments, so the head is carried forward of its own
     base and the shape has a front. The head is a hood over a JAW with
     a dark mouth line between them, which is the one detail that turns
     a ball into a face at 240p. The leaf arms are at different heights,
     different angles and different lengths, and one of them is raised
     like an arm about to come down.

     Judged as a pure black shape - CONTRACT 2.3 - it now has a clear
     top (the hood), a clear front (the jaw and the lean) and no axis of
     symmetry at all. */
  plant(p) {
    const Cy = THREE.CylinderGeometry, S = THREE.SphereGeometry, C = THREE.ConeGeometry;
    const B = THREE.BoxGeometry;
    const leaf = 0x1d6b3f;
    return mergeParts([
      // The pot, and a rim that overhangs it - a hard horizontal under
      // everything else, which is what keeps the base reading as
      // furniture the creature is planted IN rather than as its feet.
      { geo: new Cy(0.62, 0.50, 0.60, 10), colour: p.trim, pos: [0, 0.30, 0] },
      { geo: new Cy(0.70, 0.70, 0.11, 10), colour: 0x0a1c12, pos: [0, 0.63, 0] },
      // Soil, so the pot is not an open tube seen from above.
      { geo: new Cy(0.60, 0.60, 0.06, 10), colour: 0x241a10, pos: [0, 0.66, 0] },

      /* The stem, in two leaning segments. The lower one rakes forward
         and a little to one side; the upper one straightens as it
         carries the head out over the rim. A curve reads as a neck; a
         cylinder reads as a stake. */
      { geo: new Cy(0.17, 0.22, 0.62, 6), colour: leaf,
        pos: [0.05, 0.94, -0.10], rot: [-0.30, 0, -0.13] },
      { geo: new Cy(0.15, 0.18, 0.52, 6), colour: leaf,
        pos: [0.10, 1.36, -0.34], rot: [-0.62, 0, -0.10] },

      /* The head: a hood over a jaw, with the mouth between them. The
         hood overhangs the jaw at the front, which is what makes the
         gap read as a mouth rather than as a seam. */
      { geo: new S(0.50, 10, 7), colour: p.base,
        pos: [0.12, 1.66, -0.46], scale: [1, 0.80, 1.12], rot: [-0.34, 0.16, 0] },
      { geo: new S(0.40, 9, 6), colour: p.base,
        pos: [0.13, 1.42, -0.56], scale: [0.92, 0.55, 1.05], rot: [-0.20, 0.16, 0] },
      { geo: new B(0.62, 0.07, 0.44), colour: 0x07160d,
        pos: [0.13, 1.55, -0.62], rot: [-0.26, 0.16, 0] },
      // The throat, which is the gun. It sits INSIDE the mouth rather
      // than on the end of a snout: the telegraph now lights up a face.
      { geo: new C(0.20, 0.34, 7), colour: p.telegraph,
        pos: [0.13, 1.55, -0.70], rot: [-1.75, 0, 0], emissive: 0.5 },
      // Two eyes under the hood, uneven - a pair of matching dots is a
      // logo, and one lower than the other is a face.
      { geo: new S(0.085, 6, 5), colour: p.telegraph,
        pos: [-0.10, 1.76, -0.72], emissive: 0.7 },
      { geo: new S(0.070, 6, 5), colour: p.telegraph,
        pos: [0.31, 1.73, -0.68], emissive: 0.7 },

      /* THE ARMS. Different heights, lengths and angles, and the raised
         one is nearly vertical - the shape a thing makes just before it
         swings. Flattened across the width so each is a leaf seen
         broadside and not a bat. */
      { geo: new S(0.40, 6, 4), colour: leaf,
        pos: [-0.62, 1.34, -0.06], scale: [1.55, 0.20, 0.75], rot: [0.10, 0.35, 0.85] },
      { geo: new S(0.30, 6, 4), colour: p.base,
        pos: [0.58, 1.06, 0.12], scale: [1.35, 0.20, 0.70], rot: [-0.15, -0.5, -0.42] },
      // ...and one dead leaf hanging off the back, low. A hanging mass
      // is the cheapest asymmetry there is, and it stops the base of
      // the silhouette being a clean cone.
      { geo: new S(0.26, 6, 4), colour: 0x2f6b33,
        pos: [0.30, 0.84, 0.44], scale: [0.9, 0.22, 1.3], rot: [0.85, -0.2, 0.2] },
    ]);
  },

  pig(p) {
    const B = THREE.BoxGeometry, S = THREE.SphereGeometry, Cy = THREE.CylinderGeometry;
    return mergeParts([
      // WIDE AND LOW. Heaviness is horizontal mass, not height - this
      // one is shorter than the bouncer and reads as denser.
      { geo: new S(0.9, 10, 8), colour: p.base, pos: [0, 0.72, 0], scale: [1.15, 0.75, 1.0] },
      // The plate. Darker than the body on purpose: the armoured face
      // has to be identifiable from the front at a glance, because
      // that is the entire mechanic.
      { geo: new B(1.5, 0.95, 0.22), colour: p.trim, pos: [0, 0.74, -0.78] },
      { geo: new B(1.62, 0.16, 0.30), colour: 0xd9b25a, pos: [0, 1.16, -0.80] },
      { geo: new Cy(0.26, 0.30, 0.26, 8), colour: 0xf7c9d8, pos: [0, 0.70, -0.98], rot: [1.5708, 0, 0] },
      { geo: new S(0.13, 6, 5), colour: 0x120a02, pos: [-0.34, 1.02, -0.86] },
      { geo: new S(0.13, 6, 5), colour: 0x120a02, pos: [0.34, 1.02, -0.86] },
      { geo: new B(0.26, 0.34, 0.26), colour: p.trim, pos: [-0.52, 0.17, -0.34] },
      { geo: new B(0.26, 0.34, 0.26), colour: p.trim, pos: [0.52, 0.17, -0.34] },
      { geo: new B(0.26, 0.34, 0.26), colour: p.trim, pos: [-0.52, 0.17, 0.36] },
      { geo: new B(0.26, 0.34, 0.26), colour: p.trim, pos: [0.52, 0.17, 0.36] },
    ]);
  },

  /* THE STAN-ACCOUNT BAT, REBUILT AS THE ONLY TIER IT NOW HAS.
     PROXY_ONLY sends every bat here, so this shape is what the enemy
     is - which raises the bar on it. The two things a blind pass named
     were "reads as a broken sprite or a debug gizmo" and "the darkest
     object in the frame", and both were about the same thing: the
     figure had no lit, coloured MASS. The old proxy was a 0.34 m body
     with two 0.86 m wings hanging off it in `trim` - a near-black
     0x1e0b3c - so seven-eighths of its silhouette was the darkest
     colour on the roster, painted onto the thinnest geometry.

     Now the wings are `wing`, a mid-value violet a stop under the body
     rather than four stops, and they are membranes with a lit leading
     edge and a dark rib, which is the shape a bat wing actually makes
     against a bright surface. The body doubled in radius, took a
     snout, ears with a lit inner, and a hooked phone charm hanging off
     it - the joke, and a second mass on a different axis, which is the
     lesson from the Payola Phantom's shield: a silhouette test is run
     on the assembled object, and a wide horizontal bar needs something
     hanging under it or it is a dash. */
  bat(p, v) {
    const S = THREE.SphereGeometry, B = THREE.BoxGeometry, C = THREE.ConeGeometry;
    /* Two points of the same wingbeat: held out flat, and part way
       through the downstroke. Bats fly in pairs on a shared lane, so
       two of them frozen at identical wing angles is a mirror the eye
       catches immediately. */
    const down = v === 1;
    const wingZ = down ? 0.58 : 0.22;
    const wingY = down ? 0.30 : 0.46;
    const span = down ? 0.80 : 0.90;
    const parts = [
      // Body: a plump ellipsoid rather than a ball, so the wings read
      // as attached to something instead of crossing at a point.
      { geo: new S(0.46, 10, 8), colour: p.base, pos: [0, 0.42, 0], scale: [1, 0.92, 1.06] },
      { geo: new S(0.24, 8, 6), colour: p.base, pos: [0, 0.44, -0.36], scale: [1, 0.9, 1.3] },
      // Ears, with a lit inner face - a dark cone on a dark head is
      // a bump; a pale inner is what makes it an ear.
      { geo: new C(0.13, 0.34, 5), colour: p.base, pos: [-0.19, 0.86, 0.00], rot: [0, 0, 0.34] },
      { geo: new C(0.13, 0.34, 5), colour: p.base, pos: [0.19, 0.86, 0.00], rot: [0, 0, -0.34] },
      { geo: new C(0.07, 0.24, 4), colour: p.telegraph, pos: [-0.19, 0.86, -0.05], rot: [0, 0, 0.34], emissive: 0.18 },
      { geo: new C(0.07, 0.24, 4), colour: p.telegraph, pos: [0.19, 0.86, -0.05], rot: [0, 0, -0.34], emissive: 0.18 },
      { geo: new S(0.13, 7, 6), colour: p.telegraph, pos: [0, 0.34, -0.52], scale: [1, 0.8, 1.1] },
      { geo: new S(0.10, 6, 5), colour: p.telegraph, pos: [-0.15, 0.48, -0.36], emissive: 0.5 },
      { geo: new S(0.10, 6, 5), colour: p.telegraph, pos: [0.15, 0.48, -0.36], emissive: 0.5 },
      // The phone it will not put down. It hangs BELOW the wing line,
      // which is the only vertical this silhouette has.
      { geo: new B(0.20, 0.30, 0.06), colour: p.trim, pos: [0, 0.06, -0.16], rot: [0.3, 0, 0.2] },
      { geo: new B(0.15, 0.22, 0.03), colour: p.telegraph, pos: [0, 0.07, -0.19], rot: [0.3, 0, 0.2], emissive: 0.45 },
    ];
    /* Wings. Three panels per side reads as a membrane stretched over
       fingers; one slab reads as a plank. The chord widens outward and
       the arm bends a little at each joint, so the wing has a curve.

       THE PANELS ARE WALKED ALONG A HINGE, not spaced by index, and
       that is not tidiness. A first pass placed each panel at a fixed
       stride and gave each its own droop about its OWN centre, so on
       the down-stroke pose the three ends fanned apart and the wing
       photographed as three floating slats with sky between them -
       the same "debug gizmo" read this rebuild exists to remove. Here
       the joint advances by exactly half a panel before and after each
       one, and every panel is eight percent longer than its step, so
       consecutive panels always overlap however far the arm bends. */
    for (const side of [-1, 1]) {
      let px = side * 0.30, py = wingY;
      let ang = wingZ * 0.55;
      /* TWO PANELS, NOT THREE, AND A WIDE CHORD. Three narrow ones
         were tried first and photographed from along the wing as a
         row of separate bars with sky between them: seen edge-on a
         flat panel has no width to hide the step to the next one, so
         every joint is a gap from somewhere. Two panels 0.42-0.52 m
         deep overlap enough that no viewing angle opens them, and at
         the thirty screen pixels this creature actually occupies the
         extra finger was never resolvable anyway. */
      for (let k = 0; k < 2; k += 1) {
        const w = span * (0.50 - k * 0.06);
        px += side * Math.cos(ang) * w * 0.5;
        py -= Math.sin(ang) * w * 0.5;
        parts.push({
          geo: new B(w * 1.30, 0.06, 0.52 - k * 0.10),
          colour: p.wing,
          pos: [px, py, 0.04 - k * 0.05],
          rot: [0, side * (0.12 + k * 0.14), side * ang],
        });
        px += side * Math.cos(ang) * w * 0.5;
        py -= Math.sin(ang) * w * 0.5;
        ang += wingZ * 0.34;
      }
      /* The arm bone along the leading edge. Light, thin, and the one
         hard line in the shape - it is what gives the wing a direction
         even when the whole figure is a black silhouette. It rides on
         the first two panels rather than floating past them. */
      const a0 = wingZ * 0.70;
      parts.push({
        geo: new B(span * 0.78, 0.06, 0.07),
        colour: p.wingEdge,
        pos: [side * (0.30 + Math.cos(a0) * span * 0.39), wingY - Math.sin(a0) * span * 0.39, 0.21],
        rot: [0, side * 0.16, side * a0],
      });
    }
    return mergeParts(parts);
  },

  /* THE BACKUP DANCER, in three counts of the same routine.
     The read is still "a dancer": arms are doing something, and none
     of the three is the arms-down shape that would make it a lackey at
     distance. What has gone is the SYMMETRY. Every pose here is
     lopsided - different shoulder heights, a hip pushed to one side, a
     leg carrying the weight - because a symmetric figure is what a
     placeholder looks like, and four symmetric figures at equal
     spacing around a fountain is what a placeholder CROWD looks like.
     That exact frame is what a blind critic called "the loudest
     placeholder signal in the set".
     Poses are also a beat apart in the same choreography rather than
     three unrelated stances, so a line of them reads as a routine
     caught mid-count instead of as three different creatures. */
  /* ...and what round fifteen changed, which is the SHAPE and not the
     choreography. Blind, in the two frames named after a subject:
     "a flat cyan slab, a white bar head, a detached rectangle arm -
     it reads as an untextured placeholder". Three defects, three
     separate causes, all of them in the parts list rather than in the
     poses:

     SLAB. The torso was one Box(0.46, 0.72, 0.28) in the base colour.
     A box has no waist and no shoulders, so the largest, brightest
     surface of the whole crowd was a rectangle - and at the distance
     this creature is actually framed from, a rectangle is the entire
     read. It is now a hip drum in the DARK trim under a chest that
     tapers the other way, wide at the shoulder and narrow at the
     waist, which halves the bright area as a side effect of fixing
     the silhouette.

     BAR HEAD. The crest was a Cylinder(0.30, 0.34) - 0.68 m across a
     0.52 m skull - in `telegraph`, which is pure white, at emissive
     0.4. Wider than the head it sits on, flat, and the brightest thing
     in the frame: that is a bar, not a head. Telegraph belongs to the
     tint channel that flashes during a windup, not to the geometry; the
     crest is now a swept fin in `crest`, narrower than the skull, and
     it gives the silhouette a FRONT.

     DETACHED ARM. See limbPart. Arms and legs now hang off named
     joints, with shoulder caps over the joints and hands and feet at
     the ends, so no pose can leave a stick floating beside the body. */
  dancer(p, v) {
    const B = THREE.BoxGeometry, S = THREE.SphereGeometry;
    const Cy = THREE.CylinderGeometry, C = THREE.ConeGeometry;
    /* The three counts, re-authored as WHERE THE HAND GOES. Same
       routine, same beats, same lopsidedness - a hand direction is
       simply the honest way to say a pose when the limb is built from
       its joint outward. */
    const POSES = [
      /* ONE: hands up, but not level. One arm driven higher than the
         other, the weight on the left leg. */
      {
        armL: [-0.66, 0.74, -0.06], armR: [0.62, 0.32, 0.14],
        legL: [-0.08, -0.99, 0.03], legR: [0.20, -0.95, -0.22],
        hip: -0.05, tilt: 0.09, headAt: [0.04, 1.53, 0.02], crest: 0.34,
      },
      /* TWO: mid-turn. One arm sweeps across the chest, the other
         trails out low behind - the strongest diagonal of the three and
         the one that least resembles a standing figure. */
      {
        armL: [0.34, 0.30, -0.62], armR: [0.72, -0.44, 0.46],
        legL: [-0.24, -0.93, -0.26], legR: [0.15, -0.96, 0.22],
        hip: 0.07, tilt: -0.12, headAt: [-0.03, 1.52, -0.04], crest: -0.22,
      },
      /* THREE: the clap. Arms up and IN over the head, hands nearly
         meeting - a lambda where pose one is a V, which is the clearest
         possible separation between two arms-up shapes at 240p. */
      {
        armL: [-0.30, 0.94, 0.07], armR: [0.26, 0.95, 0.09],
        legL: [-0.11, -0.98, 0.13], legR: [0.19, -0.96, -0.10],
        hip: 0.03, tilt: 0.05, headAt: [0, 1.55, 0.03], crest: 0.10,
      },
    ];
    const q = POSES[v % POSES.length];
    const hd = q.headAt;
    // Named joints. Every limb below leaves one of these, so the pose
    // table cannot author a gap.
    const shL = [q.hip * 0.6 - 0.23, 1.30, 0];
    const shR = [q.hip * 0.6 + 0.23, 1.29, 0];
    const hipL = [q.hip - 0.13, 0.70, 0];
    const hipR = [q.hip + 0.14, 0.70, 0];
    const ARM = 0.60, LEG = 0.66;
    const handL = limbTip(shL, q.armL, ARM);
    const handR = limbTip(shR, q.armR, ARM);
    const footL = limbTip(hipL, q.legL, LEG);
    const footR = limbTip(hipR, q.legR, LEG);
    return mergeParts([
      // Hips: a dark drum, narrower than the shoulders above it.
      { geo: new Cy(0.20, 0.17, 0.32, 7), colour: p.trim,
        pos: [q.hip, 0.74, 0], rot: [0, 0, q.tilt] },
      // Chest: wide at the top, pinched at the waist. The taper is the
      // whole difference between a figure and a crate.
      { geo: new Cy(0.27, 0.17, 0.52, 7), colour: p.base,
        pos: [q.hip * 0.6, 1.06, 0], rot: [0, 0, q.tilt] },
      { geo: new S(0.135, 6, 5), colour: p.base, pos: shL },
      { geo: new S(0.135, 6, 5), colour: p.base, pos: shR },
      // The neck pinch. Without it the head is a bump on the torso and
      // the silhouette has no join to read.
      { geo: new Cy(0.085, 0.095, 0.14, 6), colour: p.trim,
        pos: [q.hip * 0.5, 1.36, 0] },
      { geo: new S(0.23, 8, 7), colour: p.base, pos: hd },
      /* The crest, swept back over the skull. A cone lying down has a
         point, so the head reads as facing somewhere - which is the one
         thing a disc could never do, and the reason four of these in a
         ring used to read as four identical lamps. */
      { geo: new C(0.115, 0.36, 5), colour: p.crest,
        pos: [hd[0], hd[1] + 0.17, hd[2] + 0.10], rot: [-1.15 + q.crest * 0.25, 0, q.crest],
        emissive: 0.18 },
      // Visor: narrower than the skull now, so it is a face and not a
      // band across the whole head.
      { geo: new B(0.30, 0.10, 0.06), colour: 0x061520,
        pos: [hd[0], hd[1] + 0.02, hd[2] - 0.20] },
      limbPart(shL, q.armL, ARM, 0.115, p.trim),
      limbPart(shR, q.armR, ARM, 0.115, p.trim),
      { geo: new S(0.075, 5, 4), colour: p.crest, pos: handL },
      { geo: new S(0.075, 5, 4), colour: p.crest, pos: handR },
      limbPart(hipL, q.legL, LEG, 0.145, p.trim),
      limbPart(hipR, q.legR, LEG, 0.145, p.trim),
      { geo: new B(0.15, 0.07, 0.24), colour: p.trim, pos: footL },
      { geo: new B(0.15, 0.07, 0.24), colour: p.trim, pos: footR },
    ]);
  },

  bouncer(p) {
    const B = THREE.BoxGeometry, S = THREE.SphereGeometry;
    return mergeParts([
      // A slab with a tiny head. Shoulders wider than the route it is
      // standing in is the whole design brief.
      { geo: new B(1.7, 1.35, 0.85), colour: p.base, pos: [0, 1.35, 0] },
      { geo: new B(1.86, 0.22, 0.92), colour: p.trim, pos: [0, 1.98, 0] },
      { geo: new S(0.30, 8, 7), colour: 0x2c2c36, pos: [0, 2.24, 0] },
      { geo: new B(0.66, 0.16, 0.30), colour: 0x0a0a0e, pos: [0, 2.26, -0.24] },
      // Arms folded across the chest: reads as "no" from any angle.
      { geo: new B(1.30, 0.26, 0.26), colour: p.base, pos: [0, 1.28, -0.52], rot: [0, 0, 0.12] },
      { geo: new B(1.30, 0.26, 0.26), colour: p.base, pos: [0, 1.05, -0.50], rot: [0, 0, -0.12] },
      { geo: new B(0.42, 0.66, 0.42), colour: 0x101016, pos: [-0.44, 0.33, 0] },
      { geo: new B(0.42, 0.66, 0.42), colour: 0x101016, pos: [0.44, 0.33, 0] },
      { geo: new B(0.20, 0.30, 0.06), colour: p.trim, pos: [0.62, 1.52, -0.44] },
    ]);
  },

  /* NOTHING ON THIS ONE MAY BE THINNER THAN IT IS FAR AWAY.
     The Paparazzi Drone holds nine and a half metres of standoff by
     design, so it is almost always the most distant figure in frame -
     and it used to be built out of 2cm rotor discs on 5cm booms. Two
     centimetres at twenty metres is well under a pixel, which does not
     render as a thin part: it renders as a flickering bright line that
     the high-frequency metric counts and the eye reads as noise. Every
     plate here is now a solid with a cross-section, and the rotors are
     DUCTS - a square-section ring holds a shaded face from any angle,
     where a disc vanishes the moment it turns edge-on. */
  drone(p) {
    const Cy = THREE.CylinderGeometry, S = THREE.SphereGeometry, B = THREE.BoxGeometry;
    const T = THREE.TorusGeometry;
    return mergeParts([
      { geo: new Cy(0.34, 0.40, 0.24, 10), colour: p.base, pos: [0, 0.30, 0] },
      // A belly plate, so the underside is a mass rather than an edge.
      { geo: new Cy(0.40, 0.30, 0.13, 10), colour: p.trim, pos: [0, 0.13, 0] },
      { geo: new S(0.20, 8, 6), colour: p.trim, pos: [0, 0.22, -0.28], scale: [1, 1, 1.4] },
      { geo: new Cy(0.15, 0.19, 0.18, 8), colour: 0x0b0e18, pos: [0, 0.22, -0.47], rot: [1.5708, 0, 0] },
      { geo: new Cy(0.155, 0.155, 0.06, 8), colour: 0x6d84b0, pos: [0, 0.22, -0.57], rot: [1.5708, 0, 0], emissive: 0.35 },
      // The flash bulb. It is the thing that hurts you, so it is the
      // brightest thing on the body even at rest.
      { geo: new B(0.30, 0.17, 0.13), colour: p.telegraph, pos: [0, 0.46, -0.29], emissive: 0.6 },
      { geo: new B(0.34, 0.08, 0.17), colour: 0x0b0e18, pos: [0, 0.57, -0.29] },
      // Booms.
      { geo: new B(0.64, 0.10, 0.13), colour: p.trim, pos: [-0.30, 0.40, 0.18], rot: [0, 0.6, 0] },
      { geo: new B(0.64, 0.10, 0.13), colour: p.trim, pos: [0.30, 0.40, 0.18], rot: [0, -0.6, 0] },
      // Ducted rotors: ring, hub, and a solid blur cap between them.
      { geo: new T(0.235, 0.055, 4, 12), colour: p.base, pos: [-0.52, 0.45, 0.34], rot: [1.5708, 0, 0] },
      { geo: new T(0.235, 0.055, 4, 12), colour: p.base, pos: [0.52, 0.45, 0.34], rot: [1.5708, 0, 0] },
      { geo: new Cy(0.185, 0.185, 0.07, 10), colour: 0x8fa4c8, pos: [-0.52, 0.45, 0.34], emissive: 0.2 },
      { geo: new Cy(0.185, 0.185, 0.07, 10), colour: 0x8fa4c8, pos: [0.52, 0.45, 0.34], emissive: 0.2 },
      { geo: new Cy(0.075, 0.095, 0.14, 6), colour: 0x0b0e18, pos: [-0.52, 0.47, 0.34] },
      { geo: new Cy(0.075, 0.095, 0.14, 6), colour: 0x0b0e18, pos: [0.52, 0.47, 0.34] },
    ]);
  },
};

/** Radial multiply-blend blob for grounded contact shadows. Drawn once
 *  into a small canvas rather than asked of textures.js, because this
 *  module must be able to ground its own crowd whatever state that
 *  module is in - a floating character is CONTRACT §2's loudest tell. */
function makeBlobTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const g = canvas.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Multiply blending: white leaves the ground alone, dark darkens it.
  grad.addColorStop(0.0, "#2a2430");
  grad.addColorStop(0.45, "#6b6474");
  grad.addColorStop(0.8, "#d8d5dd");
  grad.addColorStop(1.0, "#ffffff");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* ============================================================
   THE PLAYER PROBE

   player.js is being written in parallel and has at least three
   plausible shapes for where it keeps its transform. All of them are
   cheap to test and none of them may throw, so this probes rather
   than assumes - and it is exported so bosses.js reads the player
   through exactly the same code rather than a second copy that can
   drift away from this one.
   ============================================================ */

export function makePlayerProbe(THREE_NS) {
  const NS = THREE_NS || THREE;
  return {
    pos: new NS.Vector3(), vel: new NS.Vector3(),
    ok: false, action: "", pounding: false, beaming: false,
  };
}

export function probePlayer(ctx, out) {
  const p = ctx.player;
  out.ok = false;
  out.pounding = false;
  out.beaming = false;
  out.action = "";
  if (!p) return out;
  let src = null;
  if (p.position && Number.isFinite(p.position.x)) src = p.position;
  else if (p.body && p.body.position && Number.isFinite(p.body.position.x)) src = p.body.position;
  else if (p.state && Number.isFinite(p.state.x)) src = p.state;
  if (!src) return out;
  out.pos.set(src.x, Number.isFinite(src.y) ? src.y : 0, src.z);
  const vel = (p.velocity && Number.isFinite(p.velocity.y)) ? p.velocity
    : (p.body && p.body.velocity && Number.isFinite(p.body.velocity.y)) ? p.body.velocity : null;
  if (vel) out.vel.set(vel.x, vel.y, vel.z); else out.vel.set(0, 0, 0);
  out.action = typeof p.action === "string" ? p.action
    : (p.state && typeof p.state.action === "string") ? p.state.action : "";
  out.pounding = /pound/i.test(out.action);
  out.beaming = /beam/i.test(out.action);
  out.ok = true;
  return out;
}

/* ============================================================
   MODULE
   ============================================================ */

let instance = null;

export function create(ctx) {
  const THREE_NS = ctx.THREE || THREE;
  const bus = new Bus();

  /* A private stream. Enemy jitter must not consume ctx.rng, or adding
     one enemy to a course shifts every texture seed and prop placement
     downstream of it and the goldens all move. */
  const rng = makeRng(0x4D06);

  const group = new THREE_NS.Group();
  group.name = "apop-enemies";
  ctx.scene.add(group);

  /** Put the crowd back on the scene if anything re-parented or
   *  detached it. Cheap, and it is the last line of defence against the
   *  failure documented in wire(): a course teardown that walks off
   *  with the one group every enemy in the game is drawn from. */
  function attachGroup() {
    if (group.parent !== ctx.scene) ctx.scene.add(group);
  }

  const scratch = {
    v1: new THREE_NS.Vector3(), v2: new THREE_NS.Vector3(),
    m4: new THREE_NS.Matrix4(), quat: new THREE_NS.Quaternion(),
    euler: new THREE_NS.Euler(0, 0, 0, "YXZ"),
    scale: new THREE_NS.Vector3(1, 1, 1),
    colour: new THREE_NS.Color(),
    colourB: new THREE_NS.Color(),
    ray: {},
  };

  /* ---------------------------------------------------------------
     Presentation: one instanced mesh per archetype, one for every
     contact shadow on the course, one for every projectile.
     --------------------------------------------------------------- */
  const proxyMaterial = new THREE_NS.MeshBasicMaterial({
    vertexColors: true,
    toneMapped: true,
  });
  proxyMaterial.name = "apop-enemy-proxy";

  const shadowTex = makeBlobTexture();
  const shadowMaterial = new THREE_NS.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
    /* Normal alpha blending, NOT MultiplyBlending.
       Three rejects MultiplyBlending unless premultipliedAlpha is set
       and logs the complaint every single frame, which is where the
       per-frame console error in every capture was coming from. It is
       also the wrong choice on its own terms: multiply ignores the
       alpha channel, so a multiplied blob cannot fade - it can only be
       present or absent, and it pops on every spawn. vfx.js reached
       the same conclusion for the player's blob and documents it;
       this now matches. */
    toneMapped: false,
  });
  shadowMaterial.color.setHex(0x6b5a70);
  shadowMaterial.name = "apop-enemy-blob";

  /* One InstancedMesh per (kind, POSE). A baked pose is its own vertex
     buffer, so it cannot share a batch with another pose - and an
     instanced draw cannot select geometry per instance. The whole cost
     of the variety is therefore batches that mostly sit at count 0,
     which three skips before it issues a draw. Full capacity is
     allocated per pose because any one pose may end up carrying the
     entire brood; the buffers are a few hundred floats each. */
  const batches = new Map();
  for (const kind of KINDS) {
    const spec = ROSTER[kind];
    const meshes = [];
    for (let v = 0; v < proxyPoseCount(kind); v += 1) {
      const geo = PROXY_BUILDERS[kind](spec.palette, v);
      const mesh = new THREE_NS.InstancedMesh(geo, proxyMaterial, spec.capacity);
      mesh.name = `apop-enemy-${kind}${v ? `-pose${v}` : ""}`;
      mesh.instanceMatrix.setUsage(THREE_NS.DynamicDrawUsage);
      mesh.frustumCulled = false;    // one bound for the whole course; culling per-instance is what the sleep pass is for
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.count = 0;
      // Pre-create the colour attribute so no frame ever allocates it.
      mesh.instanceColor = new THREE_NS.InstancedBufferAttribute(
        new Float32Array(spec.capacity * 3).fill(1), 3
      );
      mesh.instanceColor.setUsage(THREE_NS.DynamicDrawUsage);
      group.add(mesh);
      meshes.push(mesh);
    }
    batches.set(kind, meshes);
  }

  const TOTAL_CAPACITY = KINDS.reduce((n, k) => n + ROSTER[k].capacity, 0);

  const shadowGeo = new THREE_NS.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadowMesh = new THREE_NS.InstancedMesh(shadowGeo, shadowMaterial, TOTAL_CAPACITY);
  shadowMesh.name = "apop-enemy-shadows";
  shadowMesh.instanceMatrix.setUsage(THREE_NS.DynamicDrawUsage);
  shadowMesh.frustumCulled = false;
  shadowMesh.renderOrder = -1;
  shadowMesh.count = 0;
  shadowMesh.instanceColor = new THREE_NS.InstancedBufferAttribute(
    new Float32Array(TOTAL_CAPACITY * 3).fill(1), 3
  );
  shadowMesh.instanceColor.setUsage(THREE_NS.DynamicDrawUsage);
  group.add(shadowMesh);

  /* ---------------------------------------------------------------
     Projectiles. The Industry Plant's arcs, pooled, instanced and
     reflectable. One mesh for every shot on the course.
     --------------------------------------------------------------- */
  const SHOT_MAX = 24;
  const shotGeo = mergeParts([
    { geo: new THREE_NS.IcosahedronGeometry(0.3, 0), colour: 0xfff45e, emissive: 0.55 },
    { geo: new THREE_NS.TorusGeometry(0.34, 0.07, 4, 8), colour: 0x1d6b3f, rot: [1.5708, 0, 0] },
  ]);
  const shotMesh = new THREE_NS.InstancedMesh(shotGeo, proxyMaterial, SHOT_MAX);
  shotMesh.name = "apop-enemy-shots";
  shotMesh.instanceMatrix.setUsage(THREE_NS.DynamicDrawUsage);
  shotMesh.frustumCulled = false;
  shotMesh.count = 0;
  shotMesh.instanceColor = new THREE_NS.InstancedBufferAttribute(
    new Float32Array(SHOT_MAX * 3).fill(1), 3
  );
  group.add(shotMesh);

  const shots = [];
  for (let i = 0; i < SHOT_MAX; i += 1) {
    shots.push({
      live: false, life: 0, spin: 0, owner: "enemy", from: null,
      damage: 1, radius: 0.55,
      pos: new THREE_NS.Vector3(), vel: new THREE_NS.Vector3(),
    });
  }
  let shotCursor = 0;

  /* ---------------------------------------------------------------
     The pool. Every record, body and vector this module will ever use
     is allocated here, once. Spawning is a flag flip.
     --------------------------------------------------------------- */
  const pools = new Map();
  const live = [];
  let nextSlot = 0;

  /* Reference speeds for the locomotion blend: the horizontal speed at
     which this archetype should read as a full run, and the one that
     should read as a plain walk.

     These are NOT just `spec.run` / `spec.walk`, because the ROSTER
     sets both to 0 for the kinds that do not walk - the Plant, which
     is a rooted turret, and the Dancer, which "does not walk; it
     steps, on the beat". `spec.walk || 2.6` would invent a gait speed
     the roster deliberately withheld, and this module's own behaviour
     code reads walk <= 0 as "cannot walk" (see stepReturn). A stepper
     has a perfectly good tempo of its own - one step.distance every
     step.seconds - so use that, and leave a genuinely rooted enemy at
     reference 0 so it never blends a gait at all. */
  function locoRunRef(spec) {
    if (spec.run > 0) return spec.run;
    if (spec.walk > 0) return spec.walk * 2;
    if (spec.step && spec.step.seconds > 0) {
      return (spec.step.distance || 0) / spec.step.seconds;
    }
    return 0;
  }

  function makeRecord(kind, spec) {
    const slot = nextSlot; nextSlot += 1;
    const runRef = locoRunRef(spec);
    return {
      slot, kind, spec,
      live: false, id: 0,
      state: STATE.IDLE, prevState: STATE.IDLE, stateT: 0, aliveT: 0,
      body: makeBody(spec),
      home: new THREE_NS.Vector3(),
      homeYaw: 0,
      look: new THREE_NS.Vector3(),
      yaw: 0, yawWant: 0,
      lean: 0, roll: 0,
      squashX: 1, squashY: 1,
      tint: new THREE_NS.Color(1, 1, 1),
      tintWant: new THREE_NS.Color(1, 1, 1),
      hp: 1, iframes: 0,
      sees: false, senseT: 0, memoryT: 0,
      hurtFlash: 0,
      tickPhase: slot % COARSE_TICK_FRAMES,
      rigSlot: -1, rig: null, ctrl: null, clip: "",
      /* Locomotion blend state, per record so nothing allocates in the
         presentation pass. locoX/locoZ/prevYaw are last frame's pose,
         locoNorm the smoothed 0..1 handed to the anim controller.
         All four MUST be re-seeded in spawn(): records are pooled, and
         a recycled one carries the previous occupant's pose, which
         reads as a map-wide teleport on its first frame. */
      locoX: 0, locoZ: 0, locoNorm: 0, prevYaw: 0,
      locoRunRef: runRef,
      locoWalkRef: spec.walk > 0 ? spec.walk : runRef * 0.45,
      spawner: null, formIndex: 0,
      // Presentation-only individuality: which baked pose this body
      // draws from, and its own small yaw and size offset. Declared
      // here so the record shape never changes after allocation.
      pose: 0, poseYaw: 0, poseScale: 1,
      patrol: null, patrolIndex: 0, patrolWait: 0,
      // Union of every archetype's scratch. Allocated with the record
      // so no behaviour ever allocates mid-frame.
      k: {
        phase: 0, timer: 0, cadence: 0,
        dashX: 0, dashZ: 0, dashT: 0, dashTravel: 0,
        laneT: 0, laneDir: 1, laneX: 0, laneZ: 0, laneBaseY: 0,
        packN: 0, packT: 0,
        flipT: 0, dazeT: 0, spinT: 0,
        beatSeen: -1, bar: 0, beatInBar: 0,
        fromX: 0, fromZ: 0, toX: 0, toZ: 0, hopT: 0, hopSpan: 0,
        aimYaw: 0, retreat: 0, charge: 0,
      },
    };
  }

  for (const kind of KINDS) {
    const spec = ROSTER[kind];
    const arr = new Array(spec.capacity);
    for (let i = 0; i < spec.capacity; i += 1) arr[i] = makeRecord(kind, spec);
    pools.set(kind, arr);
  }

  /* ---------------------------------------------------------------
     Spatial hash. Zero-allocation: a bucket head table plus a next
     link per slot, rebuilt each frame. Used for the Lackey's pack
     check and for every area query (pound, aura, beam sweep).
     --------------------------------------------------------------- */
  const GRID_CELL = 5;
  const GRID_BUCKETS = 512;
  const gridHead = new Int32Array(GRID_BUCKETS);
  const gridNext = new Int32Array(TOTAL_CAPACITY);
  const bySlot = new Array(TOTAL_CAPACITY);
  for (const kind of KINDS) for (const e of pools.get(kind)) bySlot[e.slot] = e;

  function gridBucket(x, z) {
    const cx = Math.floor(x / GRID_CELL);
    const cz = Math.floor(z / GRID_CELL);
    return (((cx * 73856093) ^ (cz * 19349663)) >>> 0) % GRID_BUCKETS;
  }

  function gridRebuild() {
    gridHead.fill(-1);
    for (let i = 0; i < live.length; i += 1) {
      const e = live[i];
      const b = gridBucket(e.body.position.x, e.body.position.z);
      gridNext[e.slot] = gridHead[b];
      gridHead[b] = e.slot;
    }
  }

  /** Visit every live enemy whose centre is within `radius` of (x,z).
   *  `fn` returns true to stop early. */
  function gridQuery(x, z, radius, fn) {
    const r2 = radius * radius;
    const minX = Math.floor((x - radius) / GRID_CELL);
    const maxX = Math.floor((x + radius) / GRID_CELL);
    const minZ = Math.floor((z - radius) / GRID_CELL);
    const maxZ = Math.floor((z + radius) / GRID_CELL);
    for (let cx = minX; cx <= maxX; cx += 1) {
      for (let cz = minZ; cz <= maxZ; cz += 1) {
        const b = (((cx * 73856093) ^ (cz * 19349663)) >>> 0) % GRID_BUCKETS;
        for (let s = gridHead[b]; s !== -1; s = gridNext[s]) {
          const e = bySlot[s];
          if (!e || !e.live) continue;
          const dx = e.body.position.x - x;
          const dz = e.body.position.z - z;
          if (dx * dx + dz * dz > r2) continue;
          if (fn(e) === true) return;
        }
      }
    }
  }

  /* ---------------------------------------------------------------
     Physics. ctx.physics owns bodies when it exists; when it does not
     (and while it is a stub, it does not) a minimal integrator keeps
     the crowd on the ground so behaviour can be built and reviewed
     ahead of that module. Both paths write the same fields, so
     nothing above here knows which one is running.
     --------------------------------------------------------------- */
  function makeBody(spec) {
    if (ctx.physics && typeof ctx.physics.createBody === "function") {
      const body = ctx.physics.createBody({
        radius: spec.radius,
        height: spec.height,
        mass: spec.mass,
        gravityScale: spec.gravityScale,
        maxSlope: 0.9,
      });
      if (body) { body.__external = true; return body; }
    }
    return {
      __external: false,
      position: new THREE_NS.Vector3(),
      velocity: new THREE_NS.Vector3(),
      grounded: false,
      groundNormal: new THREE_NS.Vector3(0, 1, 0),
      groundMaterial: "stone",
      slopeAngle: 0,
      platform: null,
      inWater: false,
      waterDepth: 0,
      radius: spec.radius,
      height: spec.height,
      gravityScale: spec.gravityScale,
    };
  }

  function groundHeight(x, z, fromY) {
    const hit = ctx.collision && typeof ctx.collision.groundAt === "function"
      ? ctx.collision.groundAt(x, z, (fromY === undefined ? 200 : fromY + 2), 400)
      : null;
    return hit && Number.isFinite(hit.y) ? hit.y : 0;
  }

  function stepBody(e, dt) {
    const body = e.body;
    if (body.__external && ctx.physics && typeof ctx.physics.step === "function") {
      ctx.physics.step(body, dt);
      return;
    }
    const p = body.position;
    const v = body.velocity;
    if (body.gravityScale) v.y += GRAVITY * body.gravityScale * dt;
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;
    if (!body.gravityScale) { body.grounded = false; return; }
    const gy = groundHeight(p.x, p.z, p.y);
    if (p.y <= gy) {
      p.y = gy;
      if (v.y < 0) v.y = 0;
      body.grounded = true;
    } else {
      body.grounded = false;
    }
    // Ground friction. Behaviours set velocity directly; this is what
    // stops a knocked-back body sliding forever.
    if (body.grounded) {
      const drag = Math.exp(-9 * dt);
      v.x *= drag;
      v.z *= drag;
    }
  }

  /* ---------------------------------------------------------------
     The player, read defensively. player.js is being written in
     parallel and has at least three plausible shapes for where it
     keeps its position; all of them are cheap to probe and none of
     them may throw.
     --------------------------------------------------------------- */
  const playerCache = makePlayerProbe(THREE_NS);

  function readPlayer() {
    return probePlayer(ctx, playerCache);
  }

  function hurtPlayer(e, damage, knock) {
    const pl = playerCache;
    if (!pl.ok) return;
    const dx = pl.pos.x - e.body.position.x;
    const dz = pl.pos.z - e.body.position.z;
    const d = Math.hypot(dx, dz) || 1;
    const payload = {
      amount: damage,
      source: e.kind,
      from: { x: e.body.position.x, y: e.body.position.y, z: e.body.position.z },
      knock: { x: (dx / d) * (knock || 6), y: 4.5, z: (dz / d) * (knock || 6) },
    };
    // player.js owns hp; this module never writes ctx.state.hp itself,
    // or two systems end up racing over the same number.
    if (ctx.player && typeof ctx.player.hurt === "function") {
      ctx.player.hurt(damage, payload);
    }
    ctx.bus?.emit?.("enemy:strike", payload);
    bus.emit("strike", payload);
    ctx.vfx?.burst?.("beamHit", e.body.position, { color: e.spec.palette.telegraph, count: 8 });
    ctx.audio?.play?.("enemy.hit", { pos: e.body.position });
  }

  function stunPlayer(seconds, source) {
    if (ctx.player && typeof ctx.player.stun === "function") ctx.player.stun(seconds, source);
    ctx.bus?.emit?.("enemy:stun", { seconds, source });
  }

  /* ---------------------------------------------------------------
     Rig tier. A budgeted handful of the nearest enemies borrow a real
     skinned rig and anim controller; everyone else is posed as an
     instance. The claim is re-evaluated on a slow clock because
     swapping representation every frame would strobe.
     --------------------------------------------------------------- */
  const rigPool = new Map();     // kind -> [{ root, rig, ctrl, taken }]
  let rigRebuildT = 0;
  let rigsAvailable = false;

  function buildRig(kind) {
    const specs = ctx.character && ctx.character.specs;
    const build = ctx.character && ctx.character.build;
    if (!specs || typeof build !== "function") return null;
    const spec = specs[ROSTER[kind].spec] || specs[kind];
    if (!spec) return null;
    let rig = null;
    try { rig = build(spec); } catch (error) { return null; }
    if (!rig || !rig.root) return null;
    rig.root.visible = false;
    group.add(rig.root);
    let ctrl = null;
    if (ctx.anim && typeof ctx.anim.attach === "function") {
      try { ctrl = ctx.anim.attach(rig); } catch (error) { ctrl = null; }
    }
    return { root: rig.root, rig, ctrl, taken: false };
  }

  /* Re-seed the locomotion history at the enemy's CURRENT pose.
     Rig slots are claimed and released by distance, and the blend reads
     frame-over-frame displacement, so an enemy that walked half the
     course while unrigged would otherwise measure that whole distance
     in the single frame it gets a rig back and snap to a full run. */
  function seedLocomotion(e) {
    e.locoX = e.body.position.x;
    e.locoZ = e.body.position.z;
    e.prevYaw = e.yaw;
    e.locoNorm = 0;
  }

  function claimRig(e) {
    if (e.rigSlot >= 0) return true;
    if (PROXY_ONLY[e.kind]) return false;
    let slots = rigPool.get(e.kind);
    if (!slots) { slots = []; rigPool.set(e.kind, slots); }
    for (let i = 0; i < slots.length; i += 1) {
      if (!slots[i].taken) {
        slots[i].taken = true;
        e.rigSlot = i; e.rig = slots[i].rig; e.ctrl = slots[i].ctrl;
        slots[i].root.visible = true;
        seedLocomotion(e);
        return true;
      }
    }
    if (slots.length >= 3) return false;      // per-kind ceiling
    const made = buildRig(e.kind);
    if (!made) return false;
    made.taken = true;
    slots.push(made);
    e.rigSlot = slots.length - 1; e.rig = made.rig; e.ctrl = made.ctrl;
    made.root.visible = true;
    seedLocomotion(e);
    return true;
  }

  function releaseRig(e) {
    if (e.rigSlot < 0) return;
    const slots = rigPool.get(e.kind);
    const slot = slots && slots[e.rigSlot];
    if (slot) { slot.taken = false; slot.root.visible = false; }
    e.rigSlot = -1; e.rig = null; e.ctrl = null; e.clip = "";
  }

  function updateRigClaims(dt) {
    rigRebuildT -= dt;
    if (rigRebuildT > 0) return;
    rigRebuildT = 0.3;
    rigsAvailable = !!(ctx.character && typeof ctx.character.build === "function");
    if (!rigsAvailable) return;
    const pl = playerCache;
    if (!pl.ok) return;
    let held = 0;
    for (let i = 0; i < live.length; i += 1) if (live[i].rigSlot >= 0) held += 1;
    for (let i = 0; i < live.length; i += 1) {
      const e = live[i];
      const d = Math.hypot(e.body.position.x - pl.pos.x, e.body.position.z - pl.pos.z);
      if (e.rigSlot >= 0 && d > RIG_RANGE * 1.35) { releaseRig(e); held -= 1; }
    }
    for (let i = 0; i < live.length && held < RIG_BUDGET; i += 1) {
      const e = live[i];
      if (e.rigSlot >= 0 || PROXY_ONLY[e.kind]) continue;
      const d = Math.hypot(e.body.position.x - pl.pos.x, e.body.position.z - pl.pos.z);
      if (d > RIG_RANGE) continue;
      if (claimRig(e)) held += 1;
    }
  }

  /** Play a clip if the enemy currently holds a rig. Every archetype
   *  calls this unconditionally; without a rig it is a no-op and the
   *  procedural pose layer carries the read on its own. */
  function play(e, clipKey, fade) {
    const name = e.spec.clips ? e.spec.clips[clipKey] : null;
    if (!name || e.clip === name) return;
    e.clip = name;
    if (e.ctrl && typeof e.ctrl.play === "function") {
      try { e.ctrl.play(name, { fade: fade === undefined ? 0.16 : fade, loop: true }); } catch (error) { /* anim still a stub */ }
    }
  }

  /* ---------------------------------------------------------------
     State plumbing
     --------------------------------------------------------------- */
  function setState(e, next) {
    if (e.state === next) return;
    e.prevState = e.state;
    e.state = next;
    e.stateT = 0;
  }

  function faceTowards(e, x, z, rate, dt) {
    const dx = x - e.body.position.x;
    const dz = z - e.body.position.z;
    if (dx * dx + dz * dz < 1e-6) return;
    e.yawWant = Math.atan2(dx, dz);
    e.yaw = dampAngle(e.yaw, e.yawWant, rate, dt);
  }

  function moveTowards(e, x, z, speed, dt) {
    const dx = x - e.body.position.x;
    const dz = z - e.body.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return 0;
    const v = e.body.velocity;
    v.x = damp(v.x, (dx / d) * speed, 12, dt);
    v.z = damp(v.z, (dz / d) * speed, 12, dt);
    return d;
  }

  function stopMoving(e, dt) {
    const v = e.body.velocity;
    v.x = damp(v.x, 0, 14, dt);
    v.z = damp(v.z, 0, 14, dt);
  }

  /* ---------------------------------------------------------------
     PERCEPTION and THE DOUBLE-TAKE

     Range, cone and line of sight. The cone is the important half:
     an enemy that can see through the back of its own head cannot be
     snuck past, and being able to sneak past is what makes deciding
     to fight one mean anything.
     --------------------------------------------------------------- */
  function testSight(e) {
    const pl = playerCache;
    if (!pl.ok) return false;
    const s = e.spec.sight;
    const px = pl.pos.x, pz = pl.pos.z;
    const dx = px - e.body.position.x;
    const dz = pz - e.body.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > s.range * s.range) return false;
    if (s.halfAngle < 3.0) {
      const toward = Math.atan2(dx, dz);
      if (Math.abs(angleDelta(e.yaw, toward)) > s.halfAngle) return false;
    }
    if (ctx.collision && typeof ctx.collision.raycast === "function") {
      const d = Math.sqrt(d2) || 1;
      scratch.v1.set(e.body.position.x, e.body.position.y + e.spec.height * 0.7, e.body.position.z);
      scratch.v2.set(dx / d, ((pl.pos.y + 0.9) - scratch.v1.y) / d, dz / d).normalize();
      let hit = null;
      try { hit = ctx.collision.raycast(scratch.v1, scratch.v2, d - 0.4, scratch.ray); } catch (error) { hit = null; }
      if (hit && Number.isFinite(hit.dist) && hit.dist < d - 0.5) return false;
    }
    return true;
  }

  /** The double-take. Recoil, then snap upright and commit. It is
   *  0.45 seconds of doing nothing, and it is what separates a
   *  creature noticing you from a trigger volume firing. */
  function beginAlert(e) {
    setState(e, STATE.ALERT);
    e.memoryT = e.spec.sight.memory;
    play(e, "alert", 0.08);
    scratch.v1.copy(e.body.position);
    scratch.v1.y += e.spec.height + 0.35;
    ctx.vfx?.burst?.("sparkle", scratch.v1, {
      color: e.spec.palette.telegraph, count: 10, spread: 0.6, rise: 1.4,
    });
    ctx.audio?.play?.("enemy.alert", { pos: e.body.position, rate: 0.94 + rng() * 0.12 });
    bus.emit("alert", { kind: e.kind, id: e.id });
  }

  function stepAlert(e, dt) {
    const pl = playerCache;
    if (pl.ok) faceTowards(e, pl.pos.x, pl.pos.z, 14, dt);
    stopMoving(e, dt);
    // Recoil for the first third, then over-extend and settle: the
    // anticipation curve every readable animation is built on.
    const t = clamp01(e.stateT / 0.45);
    if (t < 0.34) {
      const k = t / 0.34;
      e.squashY = lerp(1, 0.82, ease.outQuad(k));
      e.squashX = lerp(1, 1.16, ease.outQuad(k));
      e.lean = lerp(0, -0.30, ease.outQuad(k));
    } else {
      const k = (t - 0.34) / 0.66;
      e.squashY = lerp(0.82, 1, ease.outBack(k));
      e.squashX = lerp(1.16, 1, ease.outBack(k));
      e.lean = lerp(-0.30, 0.06, ease.outCubic(k));
    }
    if (e.stateT >= 0.45) setState(e, STATE.ENGAGE);
  }

  /* --------------------------------------------------------------
     TELEGRAPH

     One entry point, used by every archetype, so no attack can be
     added later that forgets to announce itself. Pose, tint, spark
     and sound all start here.
     -------------------------------------------------------------- */
  function beginWindup(e, seconds, opts) {
    setState(e, STATE.WINDUP);
    e.k.timer = seconds;
    e.k.phase = seconds;
    e.tintWant.setHex((opts && opts.color) || e.spec.palette.telegraph);
    play(e, "windup", 0.08);
    scratch.v1.copy(e.body.position);
    scratch.v1.y += e.spec.height * 0.9;
    ctx.vfx?.burst?.("sparkle", scratch.v1, {
      color: (opts && opts.color) || e.spec.palette.telegraph,
      count: 6, spread: 0.4, rise: 0.9,
    });
    ctx.audio?.play?.(`enemy.windup.${e.kind}`, { pos: e.body.position });
    bus.emit("windup", { kind: e.kind, id: e.id, seconds });
  }

  /** The wind-up pose: compress and lean AWAY from the strike, harder
   *  as the release approaches, so the last frame before the hit is
   *  the most extreme one the player sees. */
  function poseWindup(e) {
    const t = 1 - clamp01(e.k.timer / Math.max(0.0001, e.k.phase));
    const k = ease.inQuad(t);
    e.squashY = lerp(1, 0.80, k);
    e.squashX = lerp(1, 1.20, k);
    e.lean = lerp(0, -0.42, k);
  }

  function windupDone(e, dt) {
    e.k.timer -= dt;
    poseWindup(e);
    return e.k.timer <= 0;
  }

  /* --------------------------------------------------------------
     DAMAGE, SQUASH AND THE POP

     The kill is four beats: squash (0.12s), hold (0.10s), pop
     (0.22s), spray. Skipping the hold is the difference between a
     kill that lands and an object being deleted.
     -------------------------------------------------------------- */
  function hurt(e, amount, opts) {
    if (!e.live || e.state === STATE.DEAD) return false;
    if (e.iframes > 0 && !(opts && opts.ignoreIframes)) return false;
    e.hp -= (amount || 1);
    e.iframes = 0.22;
    e.hurtFlash = 1;
    ctx.vfx?.burst?.("beamHit", e.body.position, { color: 0xffffff, count: 6 });
    if (e.hp <= 0) { kill(e, (opts && opts.cause) || "hit"); return true; }
    setState(e, STATE.HURT);
    e.k.timer = 0.32;
    play(e, "hurt", 0.05);
    ctx.audio?.play?.("enemy.hurt", { pos: e.body.position });
    if (opts && opts.knock) {
      e.body.velocity.x += opts.knock.x || 0;
      e.body.velocity.z += opts.knock.z || 0;
      if (e.body.gravityScale) e.body.velocity.y = Math.max(e.body.velocity.y, 3.5);
    }
    bus.emit("hurt", { kind: e.kind, id: e.id, hp: e.hp });
    return true;
  }

  function kill(e, cause) {
    if (e.state === STATE.DEAD) return;
    setState(e, STATE.DEAD);
    e.k.timer = 0.44;
    releaseRig(e);
    e.body.velocity.set(0, 0, 0);
    e.tintWant.setHex(0xffffff);

    const p = e.body.position;
    ctx.vfx?.burst?.("landRing", p, { color: e.spec.palette.base, radius: e.spec.radius * 3 });
    ctx.vfx?.burst?.("dust", p, { count: 12, spread: 1.2 });
    ctx.audio?.play?.("enemy.squash", { pos: p, rate: 0.95 + rng() * 0.1 });

    // The spray. Clout arcs out and settles; collect.js owns the
    // pickup, so if it is not up yet this degrades to a coin pop
    // rather than dropping the reward silently.
    const n = e.spec.clout;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * TAU + rng() * 0.6;
      scratch.v1.set(p.x + Math.cos(a) * 0.65, p.y + 0.8, p.z + Math.sin(a) * 0.65);
      if (ctx.collect && typeof ctx.collect.spawnClout === "function") {
        try { ctx.collect.spawnClout(scratch.v1, i === 0 && n >= 8 ? "red" : "yellow"); } catch (error) { /* collect still a stub */ }
      }
    }
    ctx.vfx?.burst?.("coinPop", p, { count: n, color: 0xffd23f });
    ctx.bus?.emit?.("enemy:defeated", { kind: e.kind, id: e.id, cause, x: p.x, y: p.y, z: p.z, clout: n });
    bus.emit("defeated", { kind: e.kind, id: e.id, cause });
    stats.killed += 1;
  }

  function stepDead(e, dt) {
    e.k.timer -= dt;
    const t = 1 - clamp01(e.k.timer / 0.44);
    if (t < 0.27) {                      // squash
      const k = t / 0.27;
      e.squashY = lerp(1, 0.18, ease.outQuad(k));
      e.squashX = lerp(1, 1.75, ease.outQuad(k));
    } else if (t < 0.50) {               // hold - the beat that sells it
      e.squashY = 0.18; e.squashX = 1.75;
    } else {                             // pop
      const k = (t - 0.50) / 0.50;
      e.squashY = lerp(0.18, 0.05, ease.outCubic(k));
      e.squashX = lerp(1.75, 0.05, ease.inQuad(k));
      if (e.prevState !== "popped" && k > 0.05) {
        e.prevState = "popped";
        ctx.vfx?.burst?.("sparkle", e.body.position, { color: e.spec.palette.base, count: 14, rise: 2.2 });
        ctx.audio?.play?.("enemy.pop", { pos: e.body.position });
      }
    }
    stopMoving(e, dt);
    if (e.k.timer <= 0) despawn(e);
  }

  /* --------------------------------------------------------------
     PLAYER INTERACTIONS

     player.js may call these directly; this module also runs its own
     overlap test each frame so the stomp works before that module
     lands. Both paths funnel through `resolveStomp` so there is one
     armour rule per archetype, not two.
     -------------------------------------------------------------- */
  function resolveStomp(e, fromPos, opts) {
    const rule = e.spec.stomp;
    const pounded = !!(opts && opts.pound);

    // Pay-Pig: the plate only faces one way, and the pound ignores it
    // entirely. That contrast IS the lesson.
    if (e.kind === "pig") {
      if (e.k.flipT > 0 || pounded || !isFrontal(e, fromPos, e.spec.armourArc)) {
        if (pounded && e.k.flipT <= 0) { flipPig(e); return "flip"; }
        kill(e, pounded ? "pound" : "stomp");
        return "kill";
      }
      clang(e);
      return "bounce";
    }

    if (rule === "reject") {
      // Bouncer. Only a dazed one is soft, and the daze only comes
      // from a wall.
      if (e.k.dazeT > 0) { hurt(e, pounded ? 4 : 2, { cause: "stomp", ignoreIframes: true }); return "kill"; }
      clang(e);
      return "bounce";
    }

    kill(e, pounded ? "pound" : "stomp");
    return "kill";
  }

  function clang(e) {
    ctx.vfx?.burst?.("beamHit", e.body.position, { color: 0xd9b25a, count: 10 });
    ctx.vfx?.shake?.(0.22, 0.18);
    ctx.audio?.play?.("enemy.clang", { pos: e.body.position });
    e.hurtFlash = 1;
    e.squashX = 1.2; e.squashY = 0.86;
    bus.emit("clang", { kind: e.kind, id: e.id });
  }

  function isFrontal(e, fromPos, halfAngle) {
    if (!fromPos) return false;
    const toward = Math.atan2(fromPos.x - e.body.position.x, fromPos.z - e.body.position.z);
    return Math.abs(angleDelta(e.yaw, toward)) < halfAngle;
  }

  function flipPig(e) {
    setState(e, STATE.STUNNED);
    e.k.flipT = e.spec.flipSeconds;
    e.k.dazeT = e.spec.flipSeconds;
    e.roll = Math.PI;                    // on its back, wallet exposed
    e.body.velocity.set(0, 6, 0);
    play(e, "stun", 0.05);
    ctx.vfx?.burst?.("poundShock", e.body.position, { color: e.spec.palette.base, radius: 3.4 });
    ctx.vfx?.shake?.(0.5, 0.25);
    ctx.audio?.play?.("enemy.flip", { pos: e.body.position });
    bus.emit("flip", { kind: e.kind, id: e.id });
  }

  /** The self-run stomp test. A player falling onto an enemy's head
   *  is the single most common interaction in the game, so it does
   *  not wait on another module to notice it. */
  function autoStompTest() {
    const pl = playerCache;
    if (!pl.ok) return;
    if (pl.vel.y > 0.5 && !pl.pounding) return;
    const reach = pl.pounding ? 2.4 : 1.05;
    gridQuery(pl.pos.x, pl.pos.z, 3.2, (e) => {
      if (e.state === STATE.DEAD) return false;
      const top = e.body.position.y + e.spec.height;
      const dy = pl.pos.y - e.body.position.y;
      const dx = pl.pos.x - e.body.position.x;
      const dz = pl.pos.z - e.body.position.z;
      const flat = Math.hypot(dx, dz);
      if (flat > e.spec.radius + reach) return false;
      if (dy < e.spec.height * 0.45 || pl.pos.y > top + 1.6) return false;
      const result = resolveStomp(e, pl.pos, { pound: pl.pounding });
      const bounce = result === "bounce" ? 7.5 : 11;
      if (ctx.player && typeof ctx.player.bounce === "function") ctx.player.bounce(bounce, result);
      ctx.bus?.emit?.("enemy:stomped", { kind: e.kind, id: e.id, result, bounce });
      return true;
    });
  }

  /* --------------------------------------------------------------
     ARCHETYPE BEHAVIOUR
     -------------------------------------------------------------- */

  /** Shared patrol/return spine. Everything that walks a beat when it
   *  has not seen anybody comes through here. */
  function stepIdle(e, dt) {
    const spec = e.spec;
    if (spec.walk <= 0) { stopMoving(e, dt); play(e, "idle", 0.3); return; }
    if (e.patrol && e.patrol.length > 1) {
      const target = e.patrol[e.patrolIndex % e.patrol.length];
      const d = moveTowards(e, target.x, target.z, spec.walk, dt);
      faceTowards(e, target.x, target.z, 5, dt);
      play(e, "walk", 0.25);
      if (d < 0.6) {
        e.patrolWait -= dt;
        if (e.patrolWait <= 0) {
          e.patrolIndex = (e.patrolIndex + 1) % e.patrol.length;
          e.patrolWait = 0.45 + rng() * 0.6;
        }
      } else e.patrolWait = 0.45;
      // A little vertical life so an idle crowd is not a still frame.
      e.squashY = 1 + Math.sin(e.aliveT * 6 + e.slot) * 0.03;
      return;
    }
    // No path: a slow scan from the post. Standing perfectly still is
    // the other way an enemy reads as scenery.
    stopMoving(e, dt);
    play(e, "idle", 0.3);
    e.yaw = e.homeYaw + Math.sin(e.aliveT * 0.55 + e.slot * 1.7) * 0.7;
    e.squashY = 1 + Math.sin(e.aliveT * 2.4 + e.slot) * 0.025;
  }

  function stepLost(e, dt) {
    // Two sweeps and then home. Visible confusion is a courtesy: it
    // tells the player they successfully broke line of sight.
    stopMoving(e, dt);
    play(e, "alert", 0.2);
    e.yaw = e.yawWant + Math.sin(e.stateT * 4.2) * 1.0;
    e.squashY = 1 + Math.sin(e.stateT * 8) * 0.04;
    if (e.stateT > 1.5) setState(e, STATE.RETURN);
  }

  function stepReturn(e, dt) {
    if (e.spec.walk <= 0) { setState(e, STATE.IDLE); return; }
    const d = moveTowards(e, e.home.x, e.home.z, e.spec.walk * 1.15, dt);
    faceTowards(e, e.home.x, e.home.z, 5, dt);
    play(e, "walk", 0.2);
    if (d < 0.7) {
      e.yaw = e.homeYaw;
      setState(e, e.patrol ? STATE.PATROL : STATE.IDLE);
    }
  }

  /* --- Auto-Tune Imp: patrol, see, wind up, charge, hit a wall ---- */
  function stepImp(e, dt) {
    const pl = playerCache;
    const spec = e.spec;
    if (e.state === STATE.ENGAGE) {
      const d = Math.hypot(pl.pos.x - e.body.position.x, pl.pos.z - e.body.position.z);
      faceTowards(e, pl.pos.x, pl.pos.z, 7, dt);
      if (d < spec.attack.range && e.k.cadence <= 0) {
        beginWindup(e, spec.attack.windup);
        // Committed to a straight line, chosen at the START of the
        // wind-up. A charge that re-aims at release is not a charge,
        // it is a homing missile with extra steps.
        const dx = pl.pos.x - e.body.position.x;
        const dz = pl.pos.z - e.body.position.z;
        const m = Math.hypot(dx, dz) || 1;
        e.k.dashX = dx / m; e.k.dashZ = dz / m;
        return;
      }
      moveTowards(e, pl.pos.x, pl.pos.z, spec.walk * 1.6, dt);
      play(e, "walk", 0.2);
      e.k.cadence -= dt;
      return;
    }
    if (e.state === STATE.WINDUP) {
      stopMoving(e, dt);
      e.yaw = dampAngle(e.yaw, Math.atan2(e.k.dashX, e.k.dashZ), 10, dt);
      if (windupDone(e, dt)) {
        setState(e, STATE.STRIKE);
        e.k.timer = spec.attack.active;
        e.k.dashTravel = 0;
        play(e, "strike", 0.05);
        ctx.audio?.play?.("enemy.charge.imp", { pos: e.body.position });
        ctx.vfx?.burst?.("dust", e.body.position, { count: 8, spread: 0.8 });
      }
      return;
    }
    if (e.state === STATE.STRIKE) {
      e.k.timer -= dt;
      e.body.velocity.x = e.k.dashX * spec.run;
      e.body.velocity.z = e.k.dashZ * spec.run;
      e.k.dashTravel += spec.run * dt;
      e.squashX = 0.86; e.squashY = 1.14; e.lean = 0.34;
      if (dashHitWall(e, spec.run * dt + spec.radius)) {
        stunSelf(e, 1.7);
        return;
      }
      if (contactPlayer(e, spec.radius + 0.7)) {
        hurtPlayer(e, spec.attack.damage, 8);
        e.k.timer = 0;
      }
      if (e.k.timer <= 0) {
        setState(e, STATE.RECOVER);
        e.k.timer = spec.attack.recover;
        e.k.cadence = 1.1;
      }
      return;
    }
    if (e.state === STATE.RECOVER) {
      stopMoving(e, dt);
      e.k.timer -= dt;
      e.squashY = lerp(0.9, 1, clamp01(e.stateT / spec.attack.recover));
      play(e, "idle", 0.2);
      if (e.k.timer <= 0) setState(e, STATE.ENGAGE);
      return;
    }
    stepIdle(e, dt);
  }

  /* --- Lip-Sync Lackey: jitter alone, a wall in a pack ------------ */
  function stepLackey(e, dt) {
    const pl = playerCache;
    const spec = e.spec;
    // Pack census on a slow clock. Being brave is a property of the
    // crowd, so it has to be measured, not assumed.
    e.k.packT -= dt;
    if (e.k.packT <= 0) {
      e.k.packT = 0.35;
      let n = 0;
      gridQuery(e.body.position.x, e.body.position.z, spec.pack.radius, (o) => {
        if (o !== e && o.kind === "lackey" && o.state !== STATE.DEAD) n += 1;
        return false;
      });
      e.k.packN = n;
    }
    const brave = e.k.packN >= spec.pack.size - 1;

    if (e.state === STATE.ENGAGE) {
      // Erratic on purpose: the approach wanders, so a single lackey
      // is comic and six of them are a net.
      const wob = Math.sin(e.aliveT * 5.5 + e.slot * 2.1) * (brave ? 0.5 : 1.4);
      const dx = pl.pos.x - e.body.position.x;
      const dz = pl.pos.z - e.body.position.z;
      const d = Math.hypot(dx, dz) || 1;
      const tx = pl.pos.x - (dz / d) * wob;
      const tz = pl.pos.z + (dx / d) * wob;
      moveTowards(e, tx, tz, brave ? spec.run : spec.walk, dt);
      faceTowards(e, pl.pos.x, pl.pos.z, 9, dt);
      play(e, "run", 0.15);
      // The flail. Constant, silly, and the reason a crowd of them
      // reads as a crowd rather than as a formation.
      e.squashY = 1 + Math.sin(e.aliveT * 14 + e.slot) * 0.11;
      e.squashX = 1 - Math.sin(e.aliveT * 14 + e.slot) * 0.07;
      e.lean = Math.sin(e.aliveT * 7 + e.slot) * 0.14;
      if (brave && d < spec.attack.range + 0.8 && e.k.cadence <= 0) {
        beginWindup(e, spec.attack.windup, { color: spec.palette.telegraph });
        return;
      }
      e.k.cadence -= dt;
      return;
    }
    if (e.state === STATE.WINDUP) {
      stopMoving(e, dt);
      if (windupDone(e, dt)) {
        setState(e, STATE.STRIKE);
        e.k.timer = spec.attack.active;
        play(e, "strike", 0.05);
        ctx.audio?.play?.("enemy.attack.lackey", { pos: e.body.position });
      }
      return;
    }
    if (e.state === STATE.STRIKE) {
      e.k.timer -= dt;
      e.squashY = 1.2; e.squashX = 0.86; e.lean = 0.4;
      if (contactPlayer(e, spec.attack.range)) { hurtPlayer(e, spec.attack.damage, 5); e.k.timer = 0; }
      if (e.k.timer <= 0) { setState(e, STATE.ENGAGE); e.k.cadence = 0.9 + rng() * 0.5; }
      return;
    }
    stepIdle(e, dt);
  }

  /* --- Industry Plant: a turret you dodge or answer -------------- */
  function stepPlant(e, dt) {
    const pl = playerCache;
    const spec = e.spec;
    stopMoving(e, dt);
    if (e.state === STATE.ENGAGE) {
      faceTowards(e, pl.pos.x, pl.pos.z, 3.2, dt);
      e.k.cadence -= dt;
      e.squashY = 1 + Math.sin(e.aliveT * 3) * 0.03;
      play(e, "idle", 0.25);
      const d = Math.hypot(pl.pos.x - e.body.position.x, pl.pos.z - e.body.position.z);
      if (e.k.cadence <= 0 && d < spec.attack.range) beginWindup(e, spec.attack.windup);
      return;
    }
    if (e.state === STATE.WINDUP) {
      faceTowards(e, pl.pos.x, pl.pos.z, 5, dt);
      // The pod swells rather than crouching: a rooted thing cannot
      // wind up with its legs, so it does it with its volume.
      const t = 1 - clamp01(e.k.timer / Math.max(0.0001, e.k.phase));
      e.squashY = 1 + 0.18 * ease.inQuad(t);
      e.squashX = 1 + 0.22 * ease.inQuad(t);
      e.k.timer -= dt;
      if (e.k.timer <= 0) {
        setState(e, STATE.STRIKE);
        e.k.timer = spec.attack.active;
        launchArc(e, pl.pos);
        play(e, "strike", 0.05);
        ctx.audio?.play?.("enemy.attack.plant", { pos: e.body.position });
      }
      return;
    }
    if (e.state === STATE.STRIKE) {
      e.k.timer -= dt;
      e.squashY = lerp(1.2, 0.9, clamp01(e.stateT / spec.attack.active));
      if (e.k.timer <= 0) { setState(e, STATE.RECOVER); e.k.timer = spec.attack.recover; }
      return;
    }
    if (e.state === STATE.RECOVER) {
      e.k.timer -= dt;
      e.squashY = damp(e.squashY, 1, 8, dt);
      e.squashX = damp(e.squashX, 1, 8, dt);
      if (e.k.timer <= 0) { setState(e, STATE.ENGAGE); e.k.cadence = 0.6; }
      return;
    }
    stepIdle(e, dt);
  }

  /** Ballistic solve for a fixed flight time. Solving for TIME rather
   *  than for speed is what makes the arc consistent - the player
   *  learns one rhythm and it holds at every range. */
  function launchArc(e, target) {
    const s = shots[shotCursor];
    shotCursor = (shotCursor + 1) % SHOT_MAX;
    const spec = e.spec.shot;
    const from = scratch.v1.set(
      e.body.position.x + Math.sin(e.yaw) * -0.7,
      e.body.position.y + 1.66,
      e.body.position.z + Math.cos(e.yaw) * -0.7
    );
    const T = spec.flight;
    s.live = true;
    s.life = T * 2.2;
    s.owner = "enemy";
    s.from = e;
    s.damage = spec.damage;
    s.radius = spec.radius;
    s.spin = 0;
    s.pos.copy(from);
    s.vel.set(
      (target.x - from.x) / T,
      ((target.y + 0.9) - from.y) / T - 0.5 * GRAVITY * T,
      (target.z - from.z) / T
    );
    ctx.vfx?.burst?.("sparkle", from, { color: e.spec.palette.telegraph, count: 6 });
    bus.emit("shot", { kind: e.kind, id: e.id });
  }

  function updateShots(dt) {
    const pl = playerCache;
    for (let i = 0; i < shots.length; i += 1) {
      const s = shots[i];
      if (!s.live) continue;
      s.life -= dt;
      s.spin += dt * 7;
      s.vel.y += GRAVITY * dt;
      s.pos.x += s.vel.x * dt;
      s.pos.y += s.vel.y * dt;
      s.pos.z += s.vel.z * dt;

      if (s.owner === "enemy" && pl.ok) {
        const dx = s.pos.x - pl.pos.x;
        const dz = s.pos.z - pl.pos.z;
        const dy = s.pos.y - (pl.pos.y + 0.85);
        if (dx * dx + dz * dz < (s.radius + 0.5) ** 2 && Math.abs(dy) < 1.1) {
          ctx.player?.hurt?.(s.damage, { source: "plant.shot", from: s.pos });
          ctx.bus?.emit?.("enemy:strike", { amount: s.damage, source: "plant.shot" });
          ctx.vfx?.burst?.("beamHit", s.pos, { color: 0xfff45e, count: 10 });
          s.live = false;
          continue;
        }
      } else if (s.owner === "player") {
        // Reflected. It hunts whatever fired it, which is the reward
        // for a well-timed answer.
        let hitOne = false;
        gridQuery(s.pos.x, s.pos.z, s.radius + 1.4, (e) => {
          if (e.state === STATE.DEAD) return false;
          if (Math.abs(s.pos.y - (e.body.position.y + e.spec.height * 0.5)) > e.spec.height) return false;
          hurt(e, 3, { cause: "reflect", ignoreIframes: true });
          hitOne = true;
          return true;
        });
        if (hitOne) {
          ctx.vfx?.burst?.("beamHit", s.pos, { color: 0xffffff, count: 12 });
          s.live = false;
          continue;
        }
      }

      const gy = groundHeight(s.pos.x, s.pos.z, s.pos.y);
      if (s.pos.y <= gy + 0.15 || s.life <= 0) {
        s.live = false;
        ctx.vfx?.burst?.("dust", s.pos, { count: 8, spread: 0.8 });
        ctx.audio?.play?.("enemy.shot.land", { pos: s.pos });
      }
    }
  }

  /* --- Pay-Pig Demon: the pound lesson ---------------------------- */
  function stepPig(e, dt) {
    const pl = playerCache;
    const spec = e.spec;
    if (e.k.flipT > 0) {
      e.k.flipT -= dt;
      e.k.dazeT = e.k.flipT;
      stopMoving(e, dt);
      e.roll = dampAngle(e.roll, Math.PI, 6, dt);
      e.squashY = 0.72; e.squashX = 1.2;
      // Legs kicking. It is helpless and it should look ridiculous.
      e.lean = Math.sin(e.aliveT * 12) * 0.16;
      if (e.k.flipT <= 0) {
        e.roll = 0;
        setState(e, STATE.ENGAGE);
        ctx.audio?.play?.("enemy.recover", { pos: e.body.position });
      }
      return;
    }
    if (e.state === STATE.ENGAGE) {
      const d = Math.hypot(pl.pos.x - e.body.position.x, pl.pos.z - e.body.position.z);
      faceTowards(e, pl.pos.x, pl.pos.z, 2.6, dt);   // slow: flanking is the counter-play
      moveTowards(e, pl.pos.x, pl.pos.z, spec.walk, dt);
      play(e, "walk", 0.25);
      e.squashY = 1 + Math.sin(e.aliveT * 4.5) * 0.05;
      e.k.cadence -= dt;
      if (d < spec.attack.range && e.k.cadence <= 0) {
        beginWindup(e, spec.attack.windup, { color: spec.palette.telegraph });
        const dx = pl.pos.x - e.body.position.x;
        const dz = pl.pos.z - e.body.position.z;
        const m = Math.hypot(dx, dz) || 1;
        e.k.dashX = dx / m; e.k.dashZ = dz / m;
      }
      return;
    }
    if (e.state === STATE.WINDUP) {
      stopMoving(e, dt);
      // A heavy thing paws the ground before it goes.
      if (Math.floor(e.stateT * 6) !== Math.floor((e.stateT - dt) * 6)) {
        ctx.vfx?.burst?.("dust", e.body.position, { count: 5, spread: 0.9 });
      }
      if (windupDone(e, dt)) {
        setState(e, STATE.STRIKE);
        e.k.timer = spec.attack.active;
        play(e, "strike", 0.05);
        ctx.audio?.play?.("enemy.charge.pig", { pos: e.body.position });
      }
      return;
    }
    if (e.state === STATE.STRIKE) {
      e.k.timer -= dt;
      e.body.velocity.x = e.k.dashX * spec.run;
      e.body.velocity.z = e.k.dashZ * spec.run;
      e.squashX = 1.12; e.squashY = 0.92; e.lean = 0.28;
      if (Math.floor(e.stateT * 9) !== Math.floor((e.stateT - dt) * 9)) {
        ctx.vfx?.burst?.("dust", e.body.position, { count: 4, spread: 1.1 });
      }
      if (contactPlayer(e, spec.radius + 0.9)) { hurtPlayer(e, spec.attack.damage, 11); e.k.timer = 0; }
      if (dashHitWall(e, spec.run * dt + spec.radius)) { stunSelf(e, 1.4); return; }
      if (e.k.timer <= 0) { setState(e, STATE.RECOVER); e.k.timer = spec.attack.recover; }
      return;
    }
    if (e.state === STATE.RECOVER) {
      stopMoving(e, dt);
      e.k.timer -= dt;
      e.lean = damp(e.lean, 0, 6, dt);
      if (e.k.timer <= 0) { setState(e, STATE.ENGAGE); e.k.cadence = 1.6; }
      return;
    }
    stepIdle(e, dt);
  }

  /* --- Stan-Account Bat: the lane and the dive ------------------- */
  function stepBat(e, dt) {
    const pl = playerCache;
    const spec = e.spec;
    const lane = spec.lane;
    const p = e.body.position;

    if (e.state === STATE.IDLE || e.state === STATE.PATROL || e.state === STATE.RETURN
      || e.state === STATE.LOST || e.state === STATE.ENGAGE) {
      // The sine. It patrols a fixed segment and bobs; the lane is
      // what makes "walk under it and it drops" a rule the player can
      // see coming rather than an ambush.
      e.k.laneT += dt * (TAU / lane.period);
      const t = Math.sin(e.k.laneT);
      const tx = e.home.x + e.k.laneX * t * lane.length * 0.5;
      const tz = e.home.z + e.k.laneZ * t * lane.length * 0.5;
      const ty = e.k.laneBaseY + lane.height + Math.sin(e.k.laneT * 2.1) * lane.amplitude;
      const v = e.body.velocity;
      v.x = damp(v.x, (tx - p.x) * 3.2, 10, dt);
      v.z = damp(v.z, (tz - p.z) * 3.2, 10, dt);
      v.y = damp(v.y, (ty - p.y) * 3.4, 10, dt);
      e.yaw = dampAngle(e.yaw, Math.atan2(v.x, v.z), 6, dt);
      e.roll = Math.sin(e.k.laneT * 2) * 0.25;
      // Wing beat, as a whole-body stretch. Enough to sell flight at
      // proxy fidelity, and free.
      e.squashY = 1 + Math.sin(e.aliveT * 13) * 0.12;
      e.squashX = 1 - Math.sin(e.aliveT * 13) * 0.08;
      play(e, "idle", 0.3);

      if (pl.ok && e.k.cadence <= 0) {
        const flat = Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z);
        const below = p.y - pl.pos.y;
        if (flat < spec.dive.trigger && below > spec.dive.drop) {
          beginWindup(e, spec.dive.windup, { color: spec.palette.telegraph });
          e.k.toX = pl.pos.x; e.k.toZ = pl.pos.z;
        }
      }
      e.k.cadence -= dt;
      return;
    }
    if (e.state === STATE.WINDUP) {
      // It rises before it drops. The lift is the telegraph, and it
      // buys the player the frames to move.
      const v = e.body.velocity;
      v.y = damp(v.y, 4.5, 8, dt);
      v.x = damp(v.x, 0, 8, dt);
      v.z = damp(v.z, 0, 8, dt);
      e.squashY = 1.25; e.squashX = 0.85;
      faceTowards(e, e.k.toX, e.k.toZ, 8, dt);
      if (windupDone(e, dt)) {
        setState(e, STATE.STRIKE);
        e.k.timer = spec.attack.active;
        play(e, "strike", 0.05);
        ctx.audio?.play?.("enemy.dive.bat", { pos: p });
      }
      return;
    }
    if (e.state === STATE.STRIKE) {
      e.k.timer -= dt;
      const tx = pl.ok ? e.k.toX : p.x;
      const tz = pl.ok ? e.k.toZ : p.z;
      const ty = groundHeight(p.x, p.z, p.y) + 0.7;
      const v = e.body.velocity;
      v.x = damp(v.x, (tx - p.x) * 3.5, 9, dt);
      v.z = damp(v.z, (tz - p.z) * 3.5, 9, dt);
      v.y = damp(v.y, (ty - p.y) * 4.0, 9, dt);
      e.squashY = 0.8; e.squashX = 1.25; e.lean = 0.5;
      if (contactPlayer(e, spec.attack.range)) { hurtPlayer(e, spec.attack.damage, 6); e.k.timer = 0; }
      if (e.k.timer <= 0 || p.y < ty + 0.3) { setState(e, STATE.RECOVER); e.k.timer = spec.attack.recover; }
      return;
    }
    if (e.state === STATE.RECOVER) {
      // Climbing back to the lane. Slow, and stompable at the bottom
      // of the arc - the window a player earns by baiting the dive.
      e.k.timer -= dt;
      const ty = e.k.laneBaseY + spec.lane.height;
      const v = e.body.velocity;
      v.y = damp(v.y, (ty - p.y) * 2.2, 6, dt);
      v.x = damp(v.x, 0, 6, dt);
      v.z = damp(v.z, 0, 6, dt);
      e.lean = damp(e.lean, 0, 5, dt);
      e.squashY = damp(e.squashY, 1, 6, dt);
      e.squashX = damp(e.squashX, 1, 6, dt);
      if (e.k.timer <= 0) { setState(e, STATE.ENGAGE); e.k.cadence = 1.3; }
      return;
    }
    stepIdle(e, dt);
  }

  /* --- Backup Dancer Demon: the beat ------------------------------
     The one archetype whose telegraph is the SOUNDTRACK. It never
     moves off the beat, the crouch is always beat 3 and the strike is
     always beat 4, so a player who is listening knows where the hit
     lands a full beat before it does. It is also the cheapest way to
     make a course feel choreographed rather than populated.
     --------------------------------------------------------------- */
  /* A BAR IS A CLOSED LOOP AND IT ENDS ON THE DANCER'S OWN MARK.

     Every entry below is a MARK - where the body stands at the end of
     that beat, in formation space, in units of step.distance, relative
     to `e.home`. It used to be a DELTA applied to wherever the body
     happened to be, which is a random walk: the four bars sum to a net
     translation, so the whole rank marched 1.6 m a beat away from the
     post the level author placed it on, and the strike added another
     1.28 m in whatever direction the last spin had left it pointing.
     Two measured consequences. `heroGroup` scores the dancer 1.00 on a
     "holds its mark" axis it did not hold, so the confrontation shot
     was composed on a group that had left; and the harness stands the
     character on the group's centre line about two thirds of a second
     before the shutter, so a rank walking forward walks onto her -
     which is the frame we have, with a dancer touching the hero.

     x is along the rank, +z is behind it. Every bar starts from (0,0)
     and returns there before its strike, so the routine reads as a
     routine - it repeats - and the formation is still the formation
     four bars later. */
  const CHOREO = [
    [[0, 0.55], [0, 0], [0, 0.55], "strike"],
    [[-0.8, 0], [-0.8, 0.4], [0, 0], "strike"],
    ["spin", [0.8, 0], [0, 0], "strike"],
    [[0.8, -0.3], [0, 0.5], [0, 0], "strike"],
  ];
  /* The lunge, and it is FORWARD. `p + (sin yaw, cos yaw) * d` is the
     reverse of forward - a yaw t takes forward to (-sin t, -cos t) -
     so the strike used to step the dancer backwards out of its own
     attack. */
  const CHOREO_STRIKE = [0, -0.8];
  const CHOREO_SPIN = [0, 0];

  function stepDancer(e, dt, beatFired) {
    const spec = e.spec;
    const p = e.body.position;
    if (beatFired) {
      /* THE COUNT IS THE MUSIC'S, NOT THE DANCER'S.
         These were per-enemy counters started at spawn and advanced
         one per beat, so "the strike always lands on beat 4" was only
         ever true of each dancer's own private bar: two that woke a
         beat apart, or one that broke off into an ALERT and came back,
         counted different fours forever. A rank whose members are on
         different counts is four soloists - which is what the
         confrontation frame showed, bodies at four depths where the
         formation puts them in two - and a player listening for the
         hit gets a different answer from each of them.
         Reading the bar off ctx.clock.beatIndex costs nothing and
         makes the claim true across the whole course: every dancer
         alive is on the same count, and one rejoining the routine
         rejoins it in step. */
      const idx = ctx.clock ? (ctx.clock.beatIndex | 0) : 0;
      e.k.beatInBar = ((idx % 4) + 4) % 4;
      e.k.bar = ((Math.floor(idx / 4) % CHOREO.length) + CHOREO.length) % CHOREO.length;
      const move = CHOREO[e.k.bar][e.k.beatInBar];
      e.k.fromX = p.x; e.k.fromZ = p.z;
      e.k.hopT = 0;
      e.k.hopSpan = spec.step.seconds;
      const mark = move === "spin" ? CHOREO_SPIN
        : move === "strike" ? CHOREO_STRIKE : move;
      /* Formation space, anchored on the mark: the whole line moves as
         one body, so a row of five reads as choreography and not as
         five enemies that happen to be near each other. */
      const ax = Math.cos(e.homeYaw), az = -Math.sin(e.homeYaw);
      e.k.toX = e.home.x + (ax * mark[0] - az * mark[1]) * spec.step.distance;
      e.k.toZ = e.home.z + (az * mark[0] + ax * mark[1]) * spec.step.distance;
      if (move === "spin") {
        /* A WHOLE turn, not a quarter one. `homeYaw += PI/2` was
           permanent and cumulative: it re-aimed the formation basis
           every fourth bar, so a rank posed to face the camera was
           side-on to it eight seconds later and its marks had rotated
           with it. This spins the body and puts it back. */
        e.k.spinT = spec.step.seconds;
      } else if (move === "strike") {
        setState(e, STATE.STRIKE);
        e.k.timer = spec.attack.active;
        play(e, "strike", 0.04);
        ctx.audio?.play?.("enemy.attack.dancer", { pos: p });
        ctx.vfx?.burst?.("landRing", p, { color: spec.palette.base, radius: spec.attack.range });
      }
      // Beat 3 is the crouch. Always. That is the telegraph.
      if (e.k.beatInBar === 2) {
        e.tintWant.setHex(spec.palette.telegraph);
        ctx.vfx?.burst?.("sparkle", p, { color: spec.palette.telegraph, count: 4 });
      } else if (e.k.beatInBar !== 3) {
        e.tintWant.setRGB(1, 1, 1);
      }
    }

    // The step itself: an eased hop that LANDS on the beat rather
    // than starting on it, which is the difference between dancing
    // and marching.
    e.k.hopT = Math.min(e.k.hopSpan, e.k.hopT + dt);
    const t = clamp01(e.k.hopT / Math.max(0.0001, e.k.hopSpan));
    const k = ease.outCubic(t);
    const wantX = lerp(e.k.fromX, e.k.toX, k);
    const wantZ = lerp(e.k.fromZ, e.k.toZ, k);
    const v = e.body.velocity;
    v.x = (wantX - p.x) / Math.max(dt, 1e-4);
    v.z = (wantZ - p.z) / Math.max(dt, 1e-4);
    if (e.body.grounded && t < 0.5 && spec.step.hop > 0) v.y = spec.step.hop * 6;
    if (e.k.spinT > 0) {
      // Driven, not damped: a damped yaw takes the short way round and
      // a whole turn has no short way round, so it would stand still.
      e.k.spinT = Math.max(0, e.k.spinT - dt);
      e.yaw = e.homeYaw + TAU * (1 - e.k.spinT / Math.max(1e-4, spec.step.seconds));
    } else {
      e.yaw = dampAngle(e.yaw, e.homeYaw, 9, dt);
    }
    const air = Math.sin(t * Math.PI);
    e.squashY = 1 + air * 0.14 - (e.k.beatInBar === 2 ? 0.22 * (1 - t) : 0);
    e.squashX = 1 - air * 0.09 + (e.k.beatInBar === 2 ? 0.16 * (1 - t) : 0);

    if (e.state === STATE.STRIKE) {
      e.k.timer -= dt;
      e.lean = 0.35;
      if (contactPlayer(e, spec.attack.range)) { hurtPlayer(e, spec.attack.damage, 7); e.k.timer = 0; }
      if (e.k.timer <= 0) { setState(e, STATE.ENGAGE); e.tintWant.setRGB(1, 1, 1); }
    } else {
      e.lean = damp(e.lean, 0, 6, dt);
      play(e, e.k.beatInBar === 2 ? "windup" : "idle", 0.12);
    }
  }

  /* --- VIP Bouncer Demon: bait it into a wall --------------------- */
  function stepBouncer(e, dt) {
    const pl = playerCache;
    const spec = e.spec;
    if (e.k.dazeT > 0) {
      e.k.dazeT -= dt;
      stopMoving(e, dt);
      e.lean = 0.5;
      e.yaw += dt * 1.4;                       // seeing stars
      e.squashY = 0.9; e.squashX = 1.1;
      play(e, "stun", 0.1);
      if (e.k.dazeT <= 0) {
        setState(e, STATE.ENGAGE);
        e.lean = 0;
        e.yaw = e.homeYaw;
      }
      return;
    }
    if (e.state === STATE.ENGAGE) {
      // It does not leave its post. That is the whole point of it:
      // it is a locked door, and the key is the wall behind you.
      const homeDist = Math.hypot(e.body.position.x - e.home.x, e.body.position.z - e.home.z);
      if (homeDist > spec.guard.post) {
        moveTowards(e, e.home.x, e.home.z, spec.walk * 1.4, dt);
        faceTowards(e, e.home.x, e.home.z, 4, dt);
        play(e, "walk", 0.2);
        return;
      }
      stopMoving(e, dt);
      faceTowards(e, pl.pos.x, pl.pos.z, 3.4, dt);
      play(e, "idle", 0.25);
      e.squashY = 1 + Math.sin(e.aliveT * 2.2) * 0.03;
      e.k.cadence -= dt;
      const d = Math.hypot(pl.pos.x - e.body.position.x, pl.pos.z - e.body.position.z);
      if (d < spec.attack.range && e.k.cadence <= 0 && isFrontal(e, pl.pos, 0.9)) {
        beginWindup(e, spec.attack.windup, { color: spec.palette.telegraph });
        const dx = pl.pos.x - e.body.position.x;
        const dz = pl.pos.z - e.body.position.z;
        const m = Math.hypot(dx, dz) || 1;
        e.k.dashX = dx / m; e.k.dashZ = dz / m;
      }
      return;
    }
    if (e.state === STATE.WINDUP) {
      stopMoving(e, dt);
      if (windupDone(e, dt)) {
        setState(e, STATE.STRIKE);
        e.k.timer = spec.guard.dashSeconds;
        e.k.dashTravel = 0;
        play(e, "strike", 0.04);
        ctx.audio?.play?.("enemy.charge.bouncer", { pos: e.body.position });
        ctx.vfx?.burst?.("dust", e.body.position, { count: 12, spread: 1.4 });
      }
      return;
    }
    if (e.state === STATE.STRIKE) {
      e.k.timer -= dt;
      e.body.velocity.x = e.k.dashX * spec.run;
      e.body.velocity.z = e.k.dashZ * spec.run;
      e.k.dashTravel += spec.run * dt;
      e.squashX = 1.1; e.squashY = 0.94; e.lean = 0.36;
      if (Math.floor(e.stateT * 12) !== Math.floor((e.stateT - dt) * 12)) {
        ctx.vfx?.burst?.("dust", e.body.position, { count: 4, spread: 1.3 });
      }
      if (contactPlayer(e, spec.radius + 1.0)) { hurtPlayer(e, spec.attack.damage, 16); }
      if (dashHitWall(e, spec.run * dt + spec.radius + 0.4)) {
        // The payoff. A wall is the only thing on the course that can
        // stop it, and a dazed bouncer is a soft one.
        e.k.dazeT = spec.guard.dazeSeconds;
        setState(e, STATE.STUNNED);
        e.body.velocity.set(-e.k.dashX * 3, 4, -e.k.dashZ * 3);
        ctx.vfx?.burst?.("poundShock", e.body.position, { color: spec.palette.trim, radius: 4 });
        ctx.vfx?.shake?.(0.7, 0.3);
        ctx.audio?.play?.("enemy.wallhit", { pos: e.body.position });
        bus.emit("dazed", { kind: e.kind, id: e.id });
        return;
      }
      if (e.k.timer <= 0) { setState(e, STATE.RECOVER); e.k.timer = spec.attack.recover; }
      return;
    }
    if (e.state === STATE.RECOVER) {
      stopMoving(e, dt);
      e.k.timer -= dt;
      e.lean = damp(e.lean, 0, 5, dt);
      if (e.k.timer <= 0) { setState(e, STATE.ENGAGE); e.k.cadence = 1.4; }
      return;
    }
    stepIdle(e, dt);
  }

  /* --- Paparazzi Drone: hold the distance, flash, run ------------- */
  function stepDrone(e, dt) {
    const pl = playerCache;
    const spec = e.spec;
    const p = e.body.position;
    const groundY = groundHeight(p.x, p.z, p.y);
    const wantY = groundY + spec.hover.height;
    const v = e.body.velocity;
    v.y = damp(v.y, (wantY - p.y) * 3.0, 8, dt);
    // Idle drift, always. A hovering thing that holds still looks
    // parented to the camera.
    const bobble = Math.sin(e.aliveT * 2.6 + e.slot) * 0.12;
    e.roll = Math.sin(e.aliveT * 1.7 + e.slot) * 0.12;
    e.lean = bobble;

    if (e.state === STATE.ENGAGE || e.state === STATE.RETREAT) {
      const dx = pl.pos.x - p.x;
      const dz = pl.pos.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      faceTowards(e, pl.pos.x, pl.pos.z, 6, dt);
      play(e, "idle", 0.25);
      if (d < spec.hover.flee) {
        // Backs off, but slower than a run. Closing the distance is
        // the answer and the game has to let the player have it.
        setState(e, STATE.RETREAT);
        v.x = damp(v.x, (-dx / d) * spec.hover.fleeSpeed, 9, dt);
        v.z = damp(v.z, (-dz / d) * spec.hover.fleeSpeed, 9, dt);
        e.k.cadence = Math.max(e.k.cadence, 0.6);
        e.k.charge = 0;
        return;
      }
      setState(e, STATE.ENGAGE);
      const err = d - spec.hover.standoff;
      v.x = damp(v.x, (dx / d) * clamp(err, -spec.walk, spec.walk), 6, dt);
      v.z = damp(v.z, (dz / d) * clamp(err, -spec.walk, spec.walk), 6, dt);
      e.k.cadence -= dt;
      if (e.k.cadence <= 0 && d < spec.attack.range) {
        beginWindup(e, spec.flash.windup, { color: spec.palette.telegraph });
      }
      return;
    }
    if (e.state === STATE.WINDUP) {
      // The bulb charges. The tint ramp IS the countdown, and it is
      // visible from anywhere on the course.
      const t = 1 - clamp01(e.k.timer / Math.max(0.0001, e.k.phase));
      e.tintWant.setRGB(1, lerp(1, 0.95, t), lerp(1, 0.55, t));
      e.squashX = 1 + t * 0.2; e.squashY = 1 + t * 0.2;
      faceTowards(e, pl.pos.x, pl.pos.z, 8, dt);
      v.x = damp(v.x, 0, 8, dt); v.z = damp(v.z, 0, 8, dt);
      e.k.timer -= dt;
      if (e.k.timer <= 0) {
        setState(e, STATE.STRIKE);
        e.k.timer = spec.attack.active;
        const d = pl.ok ? Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z) : 999;
        ctx.vfx?.flash?.(0xffffff, clamp01(1 - d / spec.flash.radius) * 0.85, 0.28);
        ctx.vfx?.burst?.("auraWave", p, { color: 0xffffff, radius: spec.flash.radius });
        ctx.audio?.play?.("enemy.flash", { pos: p });
        if (d < spec.flash.radius) {
          stunPlayer(spec.flash.stun, "drone.flash");
          hurtPlayer(e, spec.flash.damage, 3);
        }
        bus.emit("flash", { kind: e.kind, id: e.id });
      }
      return;
    }
    if (e.state === STATE.STRIKE) {
      e.k.timer -= dt;
      e.tintWant.setRGB(1, 1, 1);
      if (e.k.timer <= 0) { setState(e, STATE.RECOVER); e.k.timer = spec.attack.recover; }
      return;
    }
    if (e.state === STATE.RECOVER) {
      // Spent. It sags toward the ground while it recycles, and this
      // dip is the only window in which it can be stomped.
      e.k.timer -= dt;
      v.y = damp(v.y, ((groundY + 1.15) - p.y) * 2.4, 6, dt);
      e.squashY = damp(e.squashY, 0.88, 6, dt);
      e.squashX = damp(e.squashX, 1.1, 6, dt);
      if (e.k.timer <= 0) {
        setState(e, STATE.ENGAGE);
        e.k.cadence = 1.0;
        e.squashY = 1; e.squashX = 1;
      }
      return;
    }
    // Unengaged: hold station over the post.
    v.x = damp(v.x, (e.home.x - p.x) * 1.2, 5, dt);
    v.z = damp(v.z, (e.home.z - p.z) * 1.2, 5, dt);
    e.yaw += dt * 0.5;
    play(e, "idle", 0.3);
  }

  /* --------------------------------------------------------------
     Shared helpers used by the archetype steps
     -------------------------------------------------------------- */
  function contactPlayer(e, reach) {
    const pl = playerCache;
    if (!pl.ok) return false;
    const dx = pl.pos.x - e.body.position.x;
    const dz = pl.pos.z - e.body.position.z;
    if (dx * dx + dz * dz > reach * reach) return false;
    const dy = pl.pos.y - e.body.position.y;
    return dy > -1.2 && dy < e.spec.height + 1.0;
  }

  /** Did a charge run into level geometry? collision.js answers this
   *  properly; without it the charge simply runs its full duration,
   *  which is the graceful degradation - the attack still resolves,
   *  it just cannot be countered until that module lands. */
  function dashHitWall(e, lookahead) {
    if (!ctx.collision || typeof ctx.collision.wallProbe !== "function") return false;
    scratch.v1.copy(e.body.position);
    scratch.v1.y += e.spec.height * 0.5;
    scratch.v2.set(e.k.dashX, 0, e.k.dashZ);
    let hit = null;
    try {
      hit = ctx.collision.wallProbe(scratch.v1, scratch.v2, e.spec.radius, e.spec.height);
    } catch (error) { hit = null; }
    return !!(hit && Number.isFinite(hit.dist) && hit.dist <= lookahead);
  }

  function stunSelf(e, seconds) {
    setState(e, STATE.STUNNED);
    e.k.dazeT = seconds;
    e.body.velocity.set(-e.k.dashX * 4, 3, -e.k.dashZ * 4);
    play(e, "stun", 0.05);
    ctx.vfx?.burst?.("poundShock", e.body.position, { color: e.spec.palette.base, radius: 2.4 });
    ctx.audio?.play?.("enemy.wallhit", { pos: e.body.position });
    bus.emit("stunned", { kind: e.kind, id: e.id });
  }

  function stepStunned(e, dt) {
    e.k.dazeT -= dt;
    stopMoving(e, dt);
    e.yaw += dt * 2.2;
    e.squashY = 0.9; e.squashX = 1.08;
    if (e.k.dazeT <= 0) { setState(e, STATE.ENGAGE); e.k.cadence = 0.9; }
  }

  const KIND_STEP = {
    imp: stepImp, lackey: stepLackey, plant: stepPlant, pig: stepPig,
    bat: stepBat, dancer: stepDancer, bouncer: stepBouncer, drone: stepDrone,
  };

  /* --------------------------------------------------------------
     Per-enemy frame
     -------------------------------------------------------------- */
  function stepEnemy(e, dt, beatFired) {
    e.aliveT += dt;
    e.stateT += dt;
    if (e.iframes > 0) e.iframes -= dt;
    if (e.hurtFlash > 0) e.hurtFlash = Math.max(0, e.hurtFlash - dt * 5);

    if (e.state === STATE.DEAD) { stepDead(e, dt); stepBody(e, dt); return; }
    if (e.state === STATE.STUNNED) {
      // Two archetypes own their own downed state because it means
      // something different for them - a pig is FLIPPED and a bouncer
      // is DAZED, and both are windows the player earned. Everyone
      // else gets the generic see-stars.
      const owned = (e.kind === "pig" && e.k.flipT > 0)
        || (e.kind === "bouncer" && e.k.dazeT > 0);
      if (!owned) { stepStunned(e, dt); stepBody(e, dt); return; }
    }
    if (e.state === STATE.HURT) {
      e.k.timer -= dt;
      e.squashX = lerp(1.18, 1, clamp01(e.stateT / 0.32));
      e.squashY = lerp(0.86, 1, clamp01(e.stateT / 0.32));
      stopMoving(e, dt);
      if (e.k.timer <= 0) setState(e, STATE.ENGAGE);
      stepBody(e, dt);
      return;
    }

    // Perception, on a per-enemy staggered clock.
    e.senseT -= dt;
    if (e.senseT <= 0) {
      e.senseT = SENSE_PERIOD;
      const saw = e.sees;
      e.sees = testSight(e);
      if (e.sees) {
        e.memoryT = e.spec.sight.memory;
        if (!saw && (e.state === STATE.IDLE || e.state === STATE.PATROL
          || e.state === STATE.RETURN || e.state === STATE.LOST)) {
          beginAlert(e);
        }
      }
    }
    if (!e.sees && e.memoryT > 0) e.memoryT -= dt;
    // Lost-you. Only from the calm combat states: interrupting a
    // committed charge because the player stepped behind a pillar
    // would break the one promise the telegraph makes. A flyer has
    // nowhere to walk back to, and a dancer never stopped, so both
    // go straight back to their own resting behaviour.
    if (!e.sees && e.memoryT <= 0 && e.state === STATE.ENGAGE) {
      if (e.spec.beatDriven) { /* the routine continues */ }
      else if (!e.spec.gravityScale) setState(e, STATE.IDLE);
      else setState(e, STATE.LOST);
    }

    if (e.state === STATE.ALERT) { stepAlert(e, dt); stepBody(e, dt); return; }
    if (e.state === STATE.LOST) { stepLost(e, dt); stepBody(e, dt); return; }
    if (e.state === STATE.RETURN) { stepReturn(e, dt); stepBody(e, dt); return; }

    const step = KIND_STEP[e.kind];
    if (step) step(e, dt, beatFired);
    stepBody(e, dt);
  }

  /* --------------------------------------------------------------
     SPAWNERS

     world.js registers posts; this module decides when they are worth
     simulating. Beyond the wake range a spawner is one distance check
     per frame and nothing else exists - which is what makes a course
     of sixty affordable.
     -------------------------------------------------------------- */
  const spawners = [];
  let spawnerSeq = 1;
  let idSeq = 1;
  const stats = { spawned: 0, killed: 0, peak: 0 };

  function spawn(kind, position, opts) {
    const pool = pools.get(kind);
    if (!pool) return null;
    let e = null;
    for (let i = 0; i < pool.length; i += 1) if (!pool[i].live) { e = pool[i]; break; }
    // Saturated. Dropping the spawn is correct here: recycling a live
    // enemy would delete something the player can see.
    if (!e) return null;

    const spec = e.spec;
    const x = position.x !== undefined ? position.x : position[0];
    const z = position.z !== undefined ? position.z : position[2];
    const yIn = position.y !== undefined ? position.y : position[1];
    const y = Number.isFinite(yIn) ? yIn : groundHeight(x, z, 100);

    e.live = true;
    e.id = idSeq; idSeq += 1;
    e.hp = spec.hp;
    e.iframes = 0;
    e.hurtFlash = 0;
    e.aliveT = 0;
    e.sees = false;
    e.memoryT = 0;
    e.senseT = rng() * SENSE_PERIOD;
    e.squashX = 1; e.squashY = 1; e.lean = 0; e.roll = 0;
    e.tint.setRGB(1, 1, 1);
    e.tintWant.setRGB(1, 1, 1);
    e.clip = "";
    e.rigSlot = -1; e.rig = null; e.ctrl = null;
    e.body.position.set(x, y, z);
    e.body.velocity.set(0, 0, 0);
    e.body.grounded = false;
    e.home.set(x, y, z);
    e.homeYaw = (opts && Number.isFinite(opts.yaw)) ? opts.yaw : rng() * TAU;
    e.yaw = e.homeYaw;
    e.yawWant = e.homeYaw;
    /* Seed the locomotion history to where this enemy is STARTING, not
       to wherever the recycled record last stood: records are pooled,
       and the blend reads frame-over-frame displacement. */
    seedLocomotion(e);
    e.patrol = (opts && opts.patrol) || null;
    e.patrolIndex = 0;
    e.patrolWait = 0;
    e.spawner = (opts && opts.spawner) || null;
    e.formIndex = (opts && opts.formIndex) || 0;

    /* WHICH BAKED POSE, AND HOW FAR OFF THE GRID.

       The pose is chosen by FORMATION INDEX plus a seeded offset, not
       at random. Random selection over three poses puts two matching
       neighbours in a ring of four about half the time, which is the
       exact artefact this exists to remove; stepping by index
       guarantees adjacent members of a brood differ, and the offset
       keeps two broods of the same kind from being the same sequence.

       poseYaw and poseScale then break the two things a shared pose
       still shares. Both are render-only: nothing in the AI, the
       physics or the hit tests reads them, so a crowd can stand at
       different angles and heights without any of them aiming or
       reaching differently. The scale range is deliberately small -
       CONTRACT §5 fixes these creatures' sizes, and this is meant to
       read as individuals rather than as a size lottery. */
    const poses = proxyPoseCount(kind);
    e.pose = poses > 1 ? (e.formIndex + ((rng() * poses) | 0)) % poses : 0;
    e.poseYaw = (rng() - 0.5) * 0.85;
    e.poseScale = 0.94 + rng() * 0.12;
    const k = e.k;
    k.phase = 0; k.timer = 0; k.cadence = 0.4 + rng() * 0.8;
    k.dashX = 0; k.dashZ = 0; k.dashT = 0; k.dashTravel = 0;
    k.laneT = rng() * TAU; k.laneDir = 1;
    k.packN = 0; k.packT = 0;
    k.flipT = 0; k.dazeT = 0; k.spinT = 0;
    k.beatSeen = -1; k.bar = 0; k.beatInBar = 3;
    k.fromX = x; k.fromZ = z; k.toX = x; k.toZ = z; k.hopT = 1; k.hopSpan = 1;
    k.aimYaw = e.yaw; k.retreat = 0; k.charge = 0;

    if (kind === "bat") {
      // The lane axis comes from the spawn facing, so world.js can aim
      // a bat across a corridor simply by facing it that way.
      k.laneX = Math.cos(e.homeYaw);
      k.laneZ = -Math.sin(e.homeYaw);
      k.laneBaseY = groundHeight(x, z, y + 8);
      e.body.position.y = k.laneBaseY + spec.lane.height;
      e.home.y = k.laneBaseY;
    } else if (kind === "drone") {
      e.body.position.y = groundHeight(x, z, y + 8) + spec.hover.height;
    }

    setState(e, e.patrol ? STATE.PATROL : STATE.IDLE);
    e.stateT = rng();       // desynchronise idle bobbing across a crowd
    live.push(e);
    stats.spawned += 1;
    if (live.length > stats.peak) stats.peak = live.length;
    bus.emit("spawn", { kind, id: e.id });
    return e;
  }

  function despawn(e) {
    if (!e.live) return;
    e.live = false;
    releaseRig(e);
    const i = live.indexOf(e);
    if (i >= 0) live.splice(i, 1);
    if (e.spawner) e.spawner.alive -= 1;
    e.spawner = null;
  }

  function addSpawner(def) {
    if (!def || !ROSTER[def.kind]) return null;
    const pos = def.position || def.at || [0, 0, 0];
    const brood = BROOD[def.kind] || 1;
    const count = Math.max(1, def.count || brood);
    const s = {
      id: spawnerSeq, kind: def.kind,
      x: pos.x !== undefined ? pos.x : pos[0],
      y: pos.y !== undefined ? pos.y : (pos[1] || 0),
      z: pos.z !== undefined ? pos.z : pos[2],
      count,
      formation: def.formation
        || (count > 2 ? (BROOD_FORMATION[def.kind] || "none") : "none"),
      spacing: def.spacing || TILE,
      facing: Number.isFinite(def.facing) ? def.facing : 0,
      // Path points arrive as {x,y,z}, [x,y,z] or the flat [x,z] the
      // level grid is actually authored in.
      patrol: def.patrol ? def.patrol.map((p) => {
        if (p && p.x !== undefined) return p;
        if (p.length >= 3) return { x: p[0], y: p[1], z: p[2] };
        return { x: p[0], y: 0, z: p[1] };
      }) : null,
      wake: def.wakeRange || WAKE_RANGE,
      sleep: def.sleepRange || SLEEP_RANGE,
      respawn: def.respawn !== false,
      awake: false, alive: 0,
    };
    spawnerSeq += 1;
    spawners.push(s);
    return s.id;
  }

  // Reused across every wake so spawning a brood allocates nothing
  // beyond the records that already exist in the pool.
  const spawnOpts = { yaw: 0, patrol: null, spawner: null, formIndex: 0 };

  function wakeSpawner(s) {
    let born = 0;
    for (let i = 0; i < s.count; i += 1) {
      // Formation offsets are what makes a dancer line a line and a
      // patrol a patrol. `none` jitters so a group of imps does not
      // stand in a queue.
      /* EVEN SPACING IS THE SECOND HALF OF THE PLACEHOLDER READ.
         A ring divided exactly into `count` and a line at exactly
         `spacing` produce the regular structure a viewer registers as
         "spawned by a loop" before they register anything about the
         creatures - and it is what a blind review actually named:
         identical figures "evenly scattered around the fountain rim".
         So every formation now carries a seeded wobble: enough to kill
         the lattice, small enough that a line is still a line and a
         ring still surrounds what it is meant to surround. rng() is
         the course's seeded generator, so two runs of a build still
         place every body identically. */
      /* `ox` runs along the rank's shoulder axis and `oz` runs along
         its facing, negative being forward. See the CHORUS block: they
         used to be the spawner's own axes, which is a different frame
         and, past a few degrees, a different picture. */
      let ox = 0, oz = 0;
      let faceYaw = s.facing;
      if (s.formation === "line" && ROSTER[s.kind].beatDriven) {
        /* Pairs, out from an empty centre. i 0,1 are the inner pair,
           2,3 the next one out and a step further back. */
        const rank = Math.floor(i / 2);
        const side = (i % 2) ? 1 : -1;
        ox = side * (s.spacing * CHORUS_POCKET * 0.5 + rank * s.spacing * CHORUS_SPREAD)
          * (0.94 + rng() * 0.12);
        oz = rank * s.spacing * CHORUS_RAKE + rng() * s.spacing * 0.10;
      } else if (s.formation === "line") {
        ox = (i - (s.count - 1) / 2) * s.spacing * (0.86 + rng() * 0.28);
        oz = (rng() - 0.5) * s.spacing * 0.34;
      } else if (s.formation === "grid") {
        const w = Math.ceil(Math.sqrt(s.count));
        ox = ((i % w) - (w - 1) / 2) * s.spacing + (rng() - 0.5) * s.spacing * 0.3;
        oz = (Math.floor(i / w) - (w - 1) / 2) * s.spacing + (rng() - 0.5) * s.spacing * 0.3;
      } else if (s.formation === "ring") {
        const step = TAU / s.count;
        const a = i * step + (rng() - 0.5) * step * 0.55;
        const r = s.spacing * (0.78 + rng() * 0.44);
        ox = Math.cos(a) * r;
        oz = Math.sin(a) * r;
        /* Face along your own radius, not along the spawner's. A ring
           whose members all share one facing is a rank standing in a
           circle; one that faces outward is a chorus around something,
           which is what a ring formation is for. The AI overrides this
           the moment any of them sees the player.
           `facing + a` is not that yaw and never was. -Z is forward, so
           a yaw t takes forward to (-sin t, -cos t) - a quarter turn
           and a reflection away from the (cos, sin) the offset above is
           built from. Solved rather than eyeballed, an outward radius
           at local angle `a` is yaw `facing - a - TAU/4`. */
        faceYaw = s.facing - a - TAU * 0.25;
      } else if (s.count > 1) {
        ox = (rng() - 0.5) * s.spacing * 2;
        oz = (rng() - 0.5) * s.spacing * 2;
      }
      /* THE FORMATION FRAME IS THE FACING FRAME.
         This used to rotate the offsets by +facing while a yaw rotates
         forward by -facing, so the two disagreed by twice the angle and
         a rank turned to face the camera was laid out running away from
         it. Both axes are now derived from the same forward vector the
         yaw produces: `ox` along the shoulders, `oz` behind. */
      const fx = -Math.sin(s.facing), fz = -Math.cos(s.facing);
      scratch.v1.set(s.x + ox * -fz + oz * -fx, s.y, s.z + ox * fx + oz * -fz);
      spawnOpts.yaw = faceYaw;
      spawnOpts.patrol = s.patrol;
      spawnOpts.spawner = s;
      spawnOpts.formIndex = i;
      const e = spawn(s.kind, scratch.v1, spawnOpts);
      if (e) { s.alive += 1; born += 1; }
    }
    // Only count as awake if the pool actually had room. Latching the
    // flag on a wake that spawned nothing means the post stays empty
    // for the rest of the course, because nothing ever retries it.
    s.awake = born > 0;
  }

  function sleepSpawner(s) {
    s.awake = false;
    for (let i = live.length - 1; i >= 0; i -= 1) {
      if (live[i].spawner === s) despawn(live[i]);
    }
    s.alive = 0;
  }

  /**
   * Where the world is being watched from.
   *
   * The player is the answer whenever there is one. The camera is the
   * fallback, and it is not a nicety: the screenshot harness can pose a
   * capture framing before player.js has a position, and a course that
   * decides it is unobserved deletes its whole cast - which is exactly
   * how a contact sheet full of empty rooms gets made.
   */
  const watch = { x: 0, z: 0, ok: false };

  function readWatcher() {
    const pl = playerCache;
    if (pl.ok) { watch.x = pl.pos.x; watch.z = pl.pos.z; watch.ok = true; return watch; }
    const cam = ctx.camera;
    if (cam && Number.isFinite(cam.position.x)) {
      watch.x = cam.position.x; watch.z = cam.position.z; watch.ok = true;
      return watch;
    }
    watch.ok = false;
    return watch;
  }

  function updateSpawners() {
    const w = readWatcher();
    if (!w.ok) return;
    for (let i = 0; i < spawners.length; i += 1) {
      const s = spawners[i];
      const d = Math.hypot(s.x - w.x, s.z - w.z);
      if (!s.awake && d < s.wake) {
        if (s.respawn || s.alive === 0) wakeSpawner(s);
      } else if (s.awake && d > s.sleep) {
        sleepSpawner(s);
      }
    }
  }

  /* --------------------------------------------------------------
     THE BEAT

     audio.js owns the transport when it exists; until then the clock
     in main.js keeps the same 124 BPM from the wall clock. Either
     way this module only needs the EDGE, so it watches beatIndex.
     -------------------------------------------------------------- */
  let lastBeat = -1;
  function consumeBeat() {
    const index = ctx.clock ? ctx.clock.beatIndex : 0;
    if (index === lastBeat) return false;
    lastBeat = index;
    return true;
  }

  /* --------------------------------------------------------------
     PRESENTATION SYNC

     One pass at the end of the frame: pack every live enemy into its
     archetype's instance buffer, its shadow into the shared one, and
     upload. A rigged enemy is skipped in the proxy batch and posed on
     its rig instead.
     -------------------------------------------------------------- */
  let syncedFrame = -1;
  // Allocated once. A Map built per frame is a garbage-collector
  // hitch waiting for the busiest fight in the game to happen.
  // One running count per (kind, pose), allocated once. Arrays rather
  // than a second Map so the inner loop never hashes a composite key.
  const batchCount = new Map();
  for (const kind of KINDS) batchCount.set(kind, new Int32Array(proxyPoseCount(kind)));

  /* True once vfx.js is up and therefore drawing a blob under every
     rig this module hands out. Read through a getter rather than
     latched at create, because vfx.js is built after this module. */
  let vfxBlobs = false;

  /* Presentation A/B switch. "varied" is what ships; the other two
     exist so a capture harness can attribute the crowd-variety work in
     ONE process from ONE camera pose. That is not a convenience:
     several modules of this engine are edited concurrently, so two
     runs of the same harness differ by other people's work and a
     cross-run number means nothing. Nothing but debugPose writes it. */
  let poseMode = "varied";
  const latticeSaved = new Map();

  function syncPresentation(dt) {
    const counts = batchCount;
    for (const kind of KINDS) counts.get(kind).fill(0);
    let shadowCount = 0;

    for (let i = 0; i < live.length; i += 1) {
      const e = live[i];
      const p = e.body.position;

      // Tint: telegraph target, then the hurt flash on top of it.
      e.tint.lerp(e.tintWant, clamp01(dt * 12));
      scratch.colour.copy(e.tint);
      if (e.hurtFlash > 0) {
        scratch.colourB.setRGB(2.6, 2.6, 2.6);
        scratch.colour.lerp(scratch.colourB, e.hurtFlash);
      }

      /* The per-body yaw offset is FADED OUT when the enemy is
         committing to something. A crowd standing at eight slightly
         different angles is what stops it reading as a formation; an
         attacker whose swing lands half a metre to the side of where
         its body points is a bug the player feels. Idle, patrolling
         and searching keep the full offset - those are the states a
         crowd spends its time in and the ones the screenshots catch -
         and anything aimed keeps a quarter of it. */
      const aimed = e.state === STATE.WINDUP || e.state === STATE.STRIKE
        || e.state === STATE.ENGAGE || e.state === STATE.ALERT;
      const flat = poseMode !== "varied";
      scratch.euler.set(e.lean, e.yaw + (flat ? 0 : e.poseYaw * (aimed ? 0.25 : 1)), e.roll, "YXZ");
      scratch.quat.setFromEuler(scratch.euler);
      const ps = flat ? 1 : e.poseScale;
      scratch.scale.set(e.squashX * ps, e.squashY * ps, e.squashX * ps);

      if (e.rigSlot >= 0 && e.rig && e.rig.root) {
        e.rig.root.position.copy(p);
        e.rig.root.quaternion.copy(scratch.quat);
        e.rig.root.scale.copy(scratch.scale);
        /* Drive the locomotion blend.
           Nothing in this module ever called setLocomotion, so every
           rigged demon sat at loco 0 forever. Two consequences, both
           visible: the idle layer kept full weight and the walk/run
           gait got none, so a demon crossing the floor played a
           standing pose while translating - it SLID; and in anim.js's
           applySecondary the target is
             -(loco * swing * SEC_SWING) - gravity
           so the `swing` channel was dead on every enemy and only
           gravity and drive survived. A blind critic repeatedly marked
           these frames as static and lifeless; this is a real part of
           why. */
        if (e.ctrl && typeof e.ctrl.setLocomotion === "function") {
          /* Measure the speed the body ACTUALLY travelled, from
             frame-over-frame displacement - not from body.velocity.
             For most archetypes the two agree, but the Dancer writes a
             single-frame position CORRECTION into its velocity
             (`v.x = (wantX - p.x) / dt` in stepDancer, feeding an eased
             hop), so its velocity swings between about 2 and 18 m/s
             inside one 0.24s step. Blending on that made the gait weight
             flap between walk and full run every frame. Displacement is
             also exactly how anim.js derives the player root's own
             speed, so the two paths now measure the same quantity. */
          const dx = p.x - e.locoX;
          const dz = p.z - e.locoZ;
          e.locoX = p.x; e.locoZ = p.z;
          const runRef = e.locoRunRef;
          let norm = 0;
          if (runRef > 0) {
            const planar = Math.sqrt(dx * dx + dz * dz) / Math.max(1e-4, dt);
            const walkRef = e.locoWalkRef;
            // Map onto the same 0..1 the player uses: idle -> walk is
            // the lower half, walk -> run the upper, so a demon ambling
            // at its own walk speed blends the walk cycle, not a
            // half-run.
            norm = planar <= walkRef
              ? (walkRef > 0 ? 0.5 * (planar / walkRef) : 0)
              : 0.5 + 0.5 * clamp01((planar - walkRef) / Math.max(0.01, runRef - walkRef));
          }
          /* Smooth it. A hop, a knockback or a one-frame collision
             resolve all spike the raw measurement, and anim.js turns
             loco straight into gait weight AND cycle rate, so an
             unsmoothed value shows up as the legs changing amplitude at
             60Hz. Fast enough to still start and stop crisply. */
          e.locoNorm = damp(e.locoNorm, clamp01(norm), 14, dt);
          /* Yaw rate, for the controller contract. Note that anim.js
             stores this on state.turnRate and currently never reads it:
             applySecondary derives its own yaw rate from the rig root's
             rotation, which this pass has already written above. So the
             swing channel's turn contribution is live either way, and
             this argument is here to be correct rather than to be
             load-bearing - do not "optimise" it away without checking
             whether anim.js has started reading it. */
          const turn = angleDelta(e.prevYaw, e.yaw) / Math.max(1e-4, dt);
          e.prevYaw = e.yaw;
          try { e.ctrl.setLocomotion(e.locoNorm, turn); } catch (error) { /* anim still a stub */ }
        }
        if (e.ctrl && typeof e.ctrl.squash === "function" && e.squashY < 0.9) {
          try { e.ctrl.squash(1 - e.squashY, 0.1); } catch (error) { /* anim still a stub */ }
        }
      } else {
        const meshes = batches.get(e.kind);
        const slot = counts.get(e.kind);
        const vi = (meshes.length > 1 && !flat) ? e.pose % meshes.length : 0;
        const mesh = meshes[vi];
        const n = slot[vi];
        if (mesh && n < e.spec.capacity) {
          scratch.m4.compose(p, scratch.quat, scratch.scale);
          mesh.setMatrixAt(n, scratch.m4);
          mesh.setColorAt(n, scratch.colour);
          slot[vi] = n + 1;
        }
      }

      // Contact shadow. Shrinks and fades with altitude, which is the
      // only cue a player has for how high a flyer actually is.
      //
      // A rigged enemy is skipped: character.js declares
      // userData.contactShadow on the SkinnedMesh and vfx.js's blob
      // pass already draws one for it. Both at once stack two dark
      // quads on the same patch of floor, and the nearest enemy in the
      // frame - the one the eye is on - is exactly the one that gets
      // the double.
      if (shadowCount < TOTAL_CAPACITY && !(e.rigSlot >= 0 && vfxBlobs)) {
        const gy = groundHeight(p.x, p.z, p.y);
        const airborne = clamp01((p.y - gy) / 6);
        const size = e.spec.radius * 2.6 * lerp(1, 1.9, airborne) * e.squashX * e.poseScale;
        scratch.v1.set(p.x, gy + 0.035, p.z);
        scratch.quat.identity();
        scratch.scale.set(size, 1, size);
        scratch.m4.compose(scratch.v1, scratch.quat, scratch.scale);
        shadowMesh.setMatrixAt(shadowCount, scratch.m4);
        const strength = lerp(1, 0.25, airborne) * (e.state === STATE.DEAD ? clamp01(e.k.timer / 0.44) : 1);
        scratch.colourB.setRGB(
          lerp(1, 0.55, strength), lerp(1, 0.55, strength), lerp(1, 0.6, strength)
        );
        shadowMesh.setColorAt(shadowCount, scratch.colourB);
        shadowCount += 1;
      }
    }

    for (const kind of KINDS) {
      const meshes = batches.get(kind);
      const slot = counts.get(kind);
      for (let v = 0; v < meshes.length; v += 1) {
        const mesh = meshes[v];
        mesh.count = slot[v];
        if (mesh.count > 0) {
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      }
    }
    shadowMesh.count = shadowCount;
    if (shadowCount > 0) {
      shadowMesh.instanceMatrix.needsUpdate = true;
      if (shadowMesh.instanceColor) shadowMesh.instanceColor.needsUpdate = true;
    }

    // Projectiles
    let sn = 0;
    for (let i = 0; i < shots.length; i += 1) {
      const s = shots[i];
      if (!s.live) continue;
      scratch.euler.set(s.spin, s.spin * 0.7, 0, "YXZ");
      scratch.quat.setFromEuler(scratch.euler);
      scratch.scale.set(1, 1, 1);
      scratch.m4.compose(s.pos, scratch.quat, scratch.scale);
      shotMesh.setMatrixAt(sn, scratch.m4);
      scratch.colourB.setRGB(s.owner === "player" ? 2.0 : 1, 1, s.owner === "player" ? 2.0 : 1);
      shotMesh.setColorAt(sn, scratch.colourB);
      sn += 1;
      if (sn >= SHOT_MAX) break;
    }
    shotMesh.count = sn;
    if (sn > 0) {
      shotMesh.instanceMatrix.needsUpdate = true;
      if (shotMesh.instanceColor) shotMesh.instanceColor.needsUpdate = true;
    }
  }

  /* --------------------------------------------------------------
     Frame
     -------------------------------------------------------------- */
  let frameCount = 0;

  let frozen = false;

  function update() {
    /* Hold the cast still for a capture.
       The shot harness verifies a composition and then advances 0.2 s
       before the shutter; a Lip-Sync Lackey covers 5.4 m/s, so it can
       walk to within two metres of the lens AFTER the frame was
       checked and stand beside the character. No camera-side test can
       see that, because it happens after the test. */
    if (frozen) return;
    const dt = ctx.clock ? ctx.clock.dt : 0;
    frameCount += 1;
    readPlayer();
    updateSpawners();
    gridRebuild();
    updateRigClaims(dt);
    const beatFired = consumeBeat();

    if (dt > 0) {
      const pl = playerCache;
      for (let i = live.length - 1; i >= 0; i -= 1) {
        const e = live[i];
        if (!e.live) continue;
        // AI level of detail. Far enemies think on a stagger and are
        // handed the accumulated dt, so their behaviour is identical -
        // it just costs a quarter as much.
        let step = dt;
        if (pl.ok && e.state !== STATE.DEAD) {
          const d2 = (e.body.position.x - pl.pos.x) ** 2 + (e.body.position.z - pl.pos.z) ** 2;
          if (d2 > FULL_TICK_RANGE * FULL_TICK_RANGE) {
            if ((frameCount + e.tickPhase) % COARSE_TICK_FRAMES !== 0) continue;
            step = dt * COARSE_TICK_FRAMES;
          }
        }
        stepEnemy(e, step, beatFired);
      }
      updateShots(dt);
      autoStompTest();
    }

    syncedFrame = ctx.clock ? ctx.clock.frame : frameCount;
    syncPresentation(Math.max(dt, 1 / 240));
  }

  /* The pool behind api.actors(). Entries are reused across calls, so
     a caller that wants to keep one past the next call must copy it -
     the same contract every pooled result in this engine carries. */
  const actorList = [];
  const actorPool = [];

  function actorSlot(i) {
    let a = actorPool[i];
    if (!a) {
      a = { x: 0, y: 0, z: 0, height: 0, width: 0, kind: "", label: "" };
      actorPool[i] = a;
    }
    return a;
  }

  /* --------------------------------------------------------------
     Lifecycle and the public surface
     -------------------------------------------------------------- */
  function clear() {
    for (let i = live.length - 1; i >= 0; i -= 1) despawn(live[i]);
    for (let i = 0; i < shots.length; i += 1) shots[i].live = false;
    for (const kind of KINDS) for (const mesh of batches.get(kind)) mesh.count = 0;
    shadowMesh.count = 0;
    shotMesh.count = 0;
  }

  const api = {
    ROSTER, KINDS, STATE,
    bus,
    group,

    /* --- world.js seam ------------------------------------------- */
    addSpawner,
    removeSpawner(id) {
      const i = spawners.findIndex((s) => s.id === id);
      if (i < 0) return false;
      sleepSpawner(spawners[i]);
      spawners.splice(i, 1);
      return true;
    },
    clearSpawners() {
      for (let i = 0; i < spawners.length; i += 1) sleepSpawner(spawners[i]);
      spawners.length = 0;
    },
    /** Direct spawn, outside the sleep/wake system. Bosses use it for
     *  summoned adds; qa.js uses it for encounter shots. */
    spawn,
    despawn,

    /* --- player.js seam ------------------------------------------
       player.js may drive these explicitly. Everything here is also
       reachable from this module's own overlap tests, so the game is
       playable before that module lands and correct after it. */
    stomp(position, opts) {
      let out = null;
      gridQuery(position.x, position.z, 2.2, (e) => {
        if (e.state === STATE.DEAD) return false;
        out = { kind: e.kind, id: e.id, result: resolveStomp(e, position, opts) };
        return true;
      });
      return out;
    },
    /** The ground pound shockwave: flips pigs, kills everything soft
     *  inside the ring, regardless of facing. */
    pound(position, radius) {
      const r = radius || 4.2;
      let hits = 0;
      gridQuery(position.x, position.z, r, (e) => {
        if (e.state === STATE.DEAD) return false;
        if (Math.abs(e.body.position.y - position.y) > 3) return false;
        resolveStomp(e, position, { pound: true });
        hits += 1;
        return false;
      });
      if (hits) ctx.vfx?.burst?.("poundShock", position, { radius: r });
      return hits;
    },
    /** Mog Beam. A capsule sweep along the shot, plus a reflect pass
     *  over any live projectile it crosses - which is what makes the
     *  Industry Plant answerable rather than merely dodgeable. */
    beam(origin, direction, range, opts) {
      const len = range || 14;
      const dirX = direction.x, dirZ = direction.z;
      const m = Math.hypot(dirX, dirZ) || 1;
      const ux = dirX / m, uz = dirZ / m;
      let hits = 0;
      for (let s = 1; s <= Math.ceil(len / 2); s += 1) {
        const px = origin.x + ux * s * 2;
        const pz = origin.z + uz * s * 2;
        gridQuery(px, pz, 1.7, (e) => {
          if (e.state === STATE.DEAD) return false;
          if (Math.abs(e.body.position.y + e.spec.height * 0.5 - origin.y) > 3.2) return false;
          if (e.spec.stomp === "reject" && e.k.dazeT <= 0) { clang(e); return false; }
          hurt(e, (opts && opts.damage) || 1, { cause: "beam" });
          hits += 1;
          return false;
        });
      }
      hits += api.reflect(origin, len, ux, uz);
      return hits;
    },
    /** Send a live enemy projectile back the way it came. */
    reflect(origin, range, ux, uz) {
      let n = 0;
      for (let i = 0; i < shots.length; i += 1) {
        const s = shots[i];
        if (!s.live || s.owner === "player") continue;
        const dx = s.pos.x - origin.x;
        const dz = s.pos.z - origin.z;
        if (dx * dx + dz * dz > (range || 6) ** 2) continue;
        if (Math.abs(s.pos.y - origin.y) > 3) continue;
        s.owner = "player";
        s.life = 3;
        const speed = s.vel.length() || 12;
        if (Number.isFinite(ux) && Number.isFinite(uz)) {
          s.vel.set(ux * speed, Math.abs(s.vel.y) * 0.4, uz * speed);
        } else {
          s.vel.multiplyScalar(-1);
        }
        ctx.vfx?.burst?.("beamHit", s.pos, { color: 0xffffff, count: 10 });
        ctx.audio?.play?.("enemy.reflect", { pos: s.pos });
        n += 1;
      }
      return n;
    },
    /** Mog Aura. Screen-clearing, so it ignores armour by design -
     *  it is the special, and a special that a pig shrugs off is not
     *  worth charging. */
    aura(position, radius) {
      const r = radius || 9;
      let n = 0;
      gridQuery(position.x, position.z, r, (e) => {
        if (e.state === STATE.DEAD) return false;
        kill(e, "aura");
        n += 1;
        return false;
      });
      if (n) ctx.vfx?.burst?.("auraWave", position, { radius: r });
      return n;
    },
    hurt(target, amount, opts) {
      const e = typeof target === "object" ? target : live.find((x) => x.id === target);
      return e ? hurt(e, amount, opts) : false;
    },

    /* --- lifecycle ----------------------------------------------- */
    enter() { attachGroup(); clear(); lastBeat = -1; },
    exit() { clear(); api.clearSpawners(); },
    clear,

    update,
    setFrozen(on) { frozen = !!on; return frozen; },
    /** Not in main.js's LATE_ORDER today. Guarded so that if the spine
     *  ever adds us, presentation runs once per frame and not twice. */
    lateUpdate() {
      const f = ctx.clock ? ctx.clock.frame : frameCount;
      if (f === syncedFrame) return;
      syncedFrame = f;
      syncPresentation(1 / 60);
    },

    /* --- introspection: qa.js and the harness -------------------- */

    /**
     * WHICH ENEMIES MAKE A PICTURE - the answer camera.js's
     * `enemy-encounter` preset needs and could not previously get.
     *
     * It used to take the NEAREST body, through a generic accessor
     * probe that returns a bare {x,y,z}. Two things follow from that
     * and a blind review named both: course 1's east knot is three
     * rooted Industry Plants and a line of four Backup Dancers, the
     * plants stand two metres nearer, so the frame named after a
     * confrontation was fronted by a potted plant - "the enemies are
     * potted plants at the right edge, one cropped, and the frame reads
     * as a furniture showroom". And a single body cannot be the subject
     * of a frame at all: camera.js now sizes a subject by the AREA of
     * its silhouette, and one 1.8 m enemy at a distance that also holds
     * the character at a sixth of frame height covers half a percent of
     * the picture. A line of four covers six.
     *
     * So the question asked here is the composition's, not the
     * proximity test's: which GROUP of enemies, taken together, reads
     * as a creature encounter - and how big is it. Returns the group's
     * centre at FOOT height (camera.js lifts by half the height
     * itself), its extent, and how much of that extent is actually
     * body, or null when there is nothing alive to photograph.
     */
    heroGroup(origin, opts) {
      const o = opts || {};
      const maxD = o.maxDist || 140;
      const ox = origin ? origin.x : 0;
      const oz = origin ? origin.z : 0;
      /* An optional veto on SEEDS, supplied by the caller, because the
         one thing this function cannot know is what the picture looks
         like. camera.js passes a sight test through its own drawn-mesh
         soup: course 1's best-scoring knot of dancers stands behind an
         escalator truss, and a shot named after a confrontation cannot
         be built on a mob nobody can see. Seeds only - a group chosen
         on a body in the open may still have members behind a pillar,
         which is a normal picture and not a defect. */
      const accept = typeof o.accept === "function" ? o.accept : null;
      /* HOW MUCH OF A CREATURE each archetype reads as, as one number.
         It is a silhouette judgement and it is the critic's, not a
         gameplay weight: a Backup Dancer has a head, two arms and two
         legs in a lopsided pose and holds its mark on the beat; an
         Industry Plant is a pot with a bulb in it, is rooted by design,
         and is the single least creature-like thing on the roster.
         A body that CHARGES is discounted as well as a body that reads
         badly - the harness advances two thirds of a second between
         posing the camera and taking the frame, and a Lackey mob covers
         three and a half metres in that time, which is how four of them
         arrived stacked on top of the character. */
      const PHOTOGENIC = {
        dancer: 1.00,   // humanoid, three poses, holds its mark
        bouncer: 0.90,  // a slab with shoulders, and it guards a post
        imp: 0.74,      // horns and a mic
        pig: 0.72,      // a real mass
        lackey: 0.70,   // humanoid
        bat: 0.50,      // small, and it is usually above the frame
        drone: 0.30,    // a machine, and a small one
        plant: 0.24,    // a pot. This is the one that lost the round.
      };
      /* ...AND WHETHER IT WILL STILL BE THERE WHEN THE SHUTTER FALLS,
         which is a separate fact and had to be measured to be believed.
         The harness advances two thirds of a second between posing the
         camera and taking the frame. A Lip-Sync Lackey runs at 5.4 m/s,
         so it covers three and a half metres in that window: a group
         chosen and framed at nine metres arrived at point-blank range,
         standing between the lens and the character with its shoulders
         across her chest. No camera check can catch that - every one of
         them ran before the enemy moved - so the only defence is not to
         build the shot on a body that is about to leave. */
      const HOLDS = {
        dancer: 1.00,   // beat-driven; the routine runs whether or not you watch
        plant: 1.00,    // rooted, by design
        drone: 0.90,    // holds a standoff and backs away, never closes
        bouncer: 0.85,  // guards a post until the route is crossed
        bat: 0.80,      // patrols a lane overhead
        imp: 0.55,
        pig: 0.55,
        lackey: 0.45,   // the fastest thing on the floor
      };
      /* Bodies further apart than this are two groups, not one subject.
         6.5 rather than the 8.5 this started at, measured: at 8.5 the
         seed picked up strays two rooms away and reported a group
         FOURTEEN METRES wide, whose bounding ellipse is almost entirely
         air - camera.js sized the shot off that and stood the lens
         three times too far back. */
      const GROUP_RADIUS = 6.5;

      let best = null;
      for (let i = 0; i < live.length; i += 1) {
        const seed = live[i];
        if (seed.state === STATE.DEAD) continue;
        const sp = seed.body.position;
        const seedD = Math.hypot(sp.x - ox, sp.z - oz);
        if (seedD > maxD) continue;
        if (accept && !accept(sp.x, sp.y, sp.z, seed.spec.height)) continue;

        let n = 0, sx = 0, sy = 0, sz = 0, weight = 0, area = 0, solid = 0;
        let lox = Infinity, hix = -Infinity, loz = Infinity, hiz = -Infinity;
        let tallest = 0, widestBody = 0, top = null;
        for (let j = 0; j < live.length; j += 1) {
          const e = live[j];
          if (e.state === STATE.DEAD) continue;
          const p = e.body.position;
          if (Math.hypot(p.x - sp.x, p.z - sp.z) > GROUP_RADIUS) continue;
          /* A flyer four metres up is not standing with the group even
             when its shadow is: it belongs to a different band of the
             picture and averaging it into the centre drags the aim off
             every body on the floor. */
          if (Math.abs(p.y - sp.y) > 2.5) continue;
          const w = (PHOTOGENIC[e.kind] === undefined ? 0.5 : PHOTOGENIC[e.kind])
            * (HOLDS[e.kind] === undefined ? 0.6 : HOLDS[e.kind]);
          /* THE CENTRE IS WEIGHTED BY THE SAME TASTE THE GROUP WAS
             CHOSEN WITH. `weight` was accumulated here and never read;
             the centre was a plain mean, so a knot ranked as a chorus
             line on the strength of its dancers was AIMED at wherever
             its rooted pots happened to be. That is not a cosmetic
             half-metre: camera.js stands the character a solved
             distance in front of this point, and measured over two
             otherwise identical captures, 0.35 m of centre drift put
             an Industry Plant directly behind her and took the field
             she reads against from 116 to 92. A pot that is worth a
             quarter of a dancer to the ranking is worth a quarter of
             one to the aim. */
          n += 1; weight += w;
          sx += p.x * w; sy += p.y * w; sz += p.z * w;
          if (p.x < lox) lox = p.x; if (p.x > hix) hix = p.x;
          if (p.z < loz) loz = p.z; if (p.z > hiz) hiz = p.z;
          const eh = e.spec.height * 1.12;      // proxy tops out over the capsule
          const ew = e.spec.radius * 2;
          /* How much PICTURE this body is worth, which is the quantity
             the shot is chosen on. A VIP Bouncer is three times the
             silhouette of a Lackey and an Industry Plant is a wide
             short pot; ranking a group by headcount treats those three
             as the same enemy. */
          area += w * eh * ew;
          /* ...and the same sum WITHOUT the taste weighting, which is
             the one camera.js needs: how many square metres of creature
             this group actually puts on screen. */
          solid += eh * ew * (Math.PI / 4);
          if (eh > tallest) tallest = eh;
          if (ew > widestBody) widestBody = ew;
          if (!top || w > top.w) top = { w, kind: e.kind, label: e.spec.label };
        }
        if (!n) continue;

        /* The group's own reach, taken as the diagonal of its footprint
           rather than either axis: the camera has not chosen a bearing
           yet, so the honest answer is the largest width it could be
           asked to frame. */
        const spread = Math.hypot(hix - lox, hiz - loz);
        const span = spread + widestBody;
        /* THE WIDTH CAMERA.JS IS GIVEN IS NOT THAT SPAN, and the
           difference was measured at three times: an ellipse drawn round
           four bodies scattered over nine metres is nearly all air, so
           sizing the shot by it stood the lens far enough back to put
           the whole mob at one and a half percent of the picture.
           What camera.js needs is the width of an ellipse of the same
           AREA as the bodies themselves - so the share it computes is
           the sum of the silhouettes and not the size of the gaps. The
           real span still travels, separately, because "is the group
           inside the frame" is a question about the gaps too. */
        const width = (4 / Math.PI) * solid / Math.max(0.5, tallest);
        const fill = clamp01((n * widestBody) / Math.max(0.5, span));
        const wsum = Math.max(1e-3, weight);
        const cx = sx / wsum, cy = sy / wsum, cz = sz / wsum;
        const centreD = Math.hypot(cx - ox, cz - oz);
        /* SILHOUETTE AREA first, then proximity - and proximity last on
           purpose. A nearer knot of plants beat a line of dancers two
           metres behind it under the old rule, which is the whole
           defect, and headcount alone would have ranked four Paparazzi
           Drones over a Pay-Pig and its escort.
           Tightness is worth a little on top: the same four bodies in a
           three-metre knot and in a nine-metre ring hold the same area
           and only the knot reads as a group. */
        const score = (area / (1 + centreD / 22)) * (0.75 + 0.45 * fill);
        if (!best || score > best.score) {
          best = {
            score,
            x: cx, y: cy, z: cz,
            /* `width` is the area-equivalent one; `span` is how far the
               group really reaches, which is what has to fit inside the
               frame. `fill` is 1 because the area is already exact. */
            height: tallest, width, span, fill: 1, tightness: fill,
            count: n, kind: top ? top.kind : seed.kind,
            label: top ? top.label : seed.spec.label,
          };
        }
      }
      return best;
    },

    /**
     * EVERY LIVE BODY, AS A THING THAT CAN STAND IN FRONT OF THE HERO.
     *
     * `heroGroup` answers "which enemies make a picture". This answers
     * the opposite question, and nothing could ask it before: which
     * enemies are in the picture WITHOUT having been chosen for it.
     * Round fourteen lost two frames to that gap - a Backup Dancer
     * happened to be standing between the lens and the character in
     * both, nearer than her and covering more of the crop, and every
     * composition test in camera.js was measuring architecture. The AI
     * is frozen before the shutter, which does not help at all: the
     * body was already standing there when the composition was checked.
     *
     * Pooled. camera.js's veto asks once per candidate pose, several
     * hundred times per capture, and a fresh object per body per
     * candidate is a guaranteed GC saw-tooth in the middle of a solve.
     * The entries are therefore only valid until the NEXT call.
     */
    actors(out) {
      const list = out || actorList;
      list.length = 0;
      for (let i = 0; i < live.length; i += 1) {
        const e = live[i];
        if (e.state === STATE.DEAD) continue;
        const p = e.body.position;
        const a = actorSlot(list.length);
        a.x = p.x; a.y = p.y; a.z = p.z;
        // The same two numbers heroGroup reports, so a member of the
        // named group measures identically whichever side asks.
        a.height = e.spec.height * 1.12;
        a.width = e.spec.radius * 2;
        a.kind = e.kind;
        a.label = e.spec.label;
        list.push(a);
      }
      return list;
    },

    count() { return live.length; },
    countOf(kind) { let n = 0; for (const e of live) if (e.kind === kind) n += 1; return n; },
    stats() {
      return {
        live: live.length, spawned: stats.spawned, killed: stats.killed,
        peak: stats.peak, spawners: spawners.length,
        rigs: live.reduce((n, e) => n + (e.rigSlot >= 0 ? 1 : 0), 0),
        /* Batches that will actually issue a draw, not the number of
           archetypes: pose variants add batches, and empty ones are
           skipped by three before the draw call. Reporting the old
           `KINDS.length + 2` after that change would have been a
           number this module made up. */
        draws: KINDS.reduce((n, k) => (
          n + batches.get(k).reduce((m, mesh) => m + (mesh.count > 0 ? 1 : 0), 0)
        ), 0) + 2,
        shots: shots.reduce((n, s) => n + (s.live ? 1 : 0), 0),
      };
    },
    debugList() {
      return live.map((e) => ({
        id: e.id, kind: e.kind, state: e.state, hp: e.hp,
        sees: e.sees, rig: e.rigSlot >= 0,
        x: Number(e.body.position.x.toFixed(2)),
        y: Number(e.body.position.y.toFixed(2)),
        z: Number(e.body.position.z.toFixed(2)),
      }));
    },
    /**
     * Force a presentation mode, for one-session A/B captures.
     *
     *   "varied"  what ships - baked pose per body, per-body yaw and
     *             scale, wobbled formations
     *   "flat"    every body on pose 0, no yaw or scale offset, but
     *             standing exactly where it already stands
     *   "lattice" "flat" AND re-laid on the un-wobbled formation, i.e.
     *             the frame a blind critic called "identical figures,
     *             evenly scattered"
     *
     * "lattice" moves bodies, so the positions it overwrites are saved
     * and put back when the mode leaves - a debug switch that quietly
     * relocated a live crowd would poison every capture after it.
     */
    debugPose(mode) {
      const next = mode === "flat" || mode === "lattice" ? mode : "varied";
      if (next !== "lattice" && latticeSaved.size) {
        for (const e of live) {
          const at = latticeSaved.get(e.id);
          if (at) { e.body.position.set(at.x, at.y, at.z); e.yaw = at.yaw; e.yawWant = at.yaw; }
        }
        latticeSaved.clear();
      }
      if (next === "lattice") {
        for (const e of live) {
          const s = e.spawner;
          if (!s || s.count <= 1) continue;
          if (!latticeSaved.has(e.id)) {
            latticeSaved.set(e.id, {
              x: e.body.position.x, y: e.body.position.y, z: e.body.position.z, yaw: e.yaw,
            });
          }
          let ox = 0, oz = 0;
          if (s.formation === "ring") {
            const a = (e.formIndex / s.count) * TAU;
            ox = Math.cos(a) * s.spacing; oz = Math.sin(a) * s.spacing;
          } else if (s.formation === "line") {
            ox = (e.formIndex - (s.count - 1) / 2) * s.spacing;
          } else if (s.formation === "grid") {
            const w = Math.ceil(Math.sqrt(s.count));
            ox = ((e.formIndex % w) - (w - 1) / 2) * s.spacing;
            oz = (Math.floor(e.formIndex / w) - (w - 1) / 2) * s.spacing;
          } else continue;
          const ca = Math.cos(s.facing), sa = Math.sin(s.facing);
          const x = s.x + ox * ca - oz * sa;
          const z = s.z + ox * sa + oz * ca;
          e.body.position.set(x, groundHeight(x, z, e.body.position.y + 4), z);
          e.yaw = s.facing; e.yawWant = s.facing;
        }
      }
      poseMode = next;
      return poseMode;
    },

    /** Drop one of each archetype in a ring. The encounter-preset
     *  screenshot needs a populated frame before world.js has any
     *  spawn tables in it. */
    debugPopulate(center, radius) {
      const c = center || { x: 0, y: 0, z: 0 };
      const r = radius || 8;
      KINDS.forEach((kind, i) => {
        const a = (i / KINDS.length) * TAU;
        scratch.v1.set(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r);
        spawn(kind, scratch.v1, { yaw: a + Math.PI });
      });
      return live.length;
    },

    dispose() {
      clear();
      ctx.scene.remove(group);
      for (const kind of KINDS) {
        for (const mesh of batches.get(kind)) {
          mesh.geometry.dispose();
          mesh.dispose();
        }
      }
      shotMesh.geometry.dispose(); shotMesh.dispose();
      shadowMesh.geometry.dispose(); shadowMesh.dispose();
      shadowTex.dispose();
      proxyMaterial.dispose();
      shadowMaterial.dispose();
    },

    /** Called by `ready()` once every module exists. */
    wire() {
      /* NOT ctx.world.register(group, "dynamic").
         world.js's register() parents whatever it is given into the
         course root, and unload() disposes the geometry of every mesh
         under that root before emptying it. Handing it this group
         therefore destroyed all eight proxy geometries, the blob mesh
         and the projectile mesh the first time anybody changed course:
         enemies stayed live and simulating, and nothing was ever drawn
         again for the rest of the session. This group is owned here,
         lives on ctx.scene, and outlives every course. */
      attachGroup();
      vfxBlobs = !!(ctx.vfx && typeof ctx.vfx.burst === "function");
      // Course lifecycle. world.js emits "world:load"; it also calls
      // enter() directly, and both paths are idempotent.
      ctx.bus?.on?.("world:load", () => api.enter());
      ctx.bus?.on?.("world:unload", () => api.exit());
      ctx.bus?.on?.("player:died", () => { for (const e of live) setState(e, STATE.RETURN); });
      // player.js may prefer events to direct calls; accept both.
      ctx.bus?.on?.("player:pound", (p) => { if (p) api.pound(p.position || p, p.radius); });
      ctx.bus?.on?.("player:beam", (p) => {
        if (p && p.origin && p.direction) api.beam(p.origin, p.direction, p.range, p);
      });
      ctx.bus?.on?.("player:aura", (p) => { if (p) api.aura(p.position || p, p.radius); });
    },
  };

  instance = api;
  return api;
}

/** main.js runs this after every module has been created, which is
 *  the only point at which audio.js, world.js and vfx.js exist. */
export function ready(ctx) {
  if (instance && typeof instance.wire === "function") instance.wire(ctx);
}
