/* ============================================================
   SAINTFALL - the Winnower

   The Censer Works' flyer, and everything about it that is not
   geometry: how it holds altitude, what it drops, and the two
   different ways it ends up on the ground.

   THE PROBLEM A FLYING BOSS HAS

   An enemy the player cannot reach is not a fight, it is weather.
   Every melee build in the game would be a spectator, and even a
   rifle build spends the encounter looking up at a shape that never
   answers. So the whole design is built backwards from one
   requirement: IT MUST COME DOWN, and it must come down often enough
   that a lance is a legitimate way to fight it.

   It comes down two ways, and both matter:

     THE STOKE, on a timer, whatever the player does. Its gut is a
     furnace and the furnace burns out - so it returns to a flare
     stack to re-light, folds its wings, and is grounded and
     defenceless for a fixed window. A player who owns nothing but a
     censer-lance still gets this, every cycle, for free. That is the
     floor, and it is deliberately generous.

     THE STALL, when the heat sacs on its wing roots are shot out.
     That drains the lift pool in combat.js, and an empty pool means
     it drops NOW rather than on schedule - into a longer, clumsier
     window than the stoke, because it did not choose the landing.
     That is the ceiling, and it is what a ranged build buys with its
     damage.

   The two are the same fight seen from two builds: everybody gets the
   window, and aiming well gets it sooner and for longer.

   WHY THE CENSER WORKS

   The district already burns. Three flare stacks throw real light and
   real heat sixty metres into the sky, and they were in the level
   long before this animal was. It rides them, it re-lights at them,
   and the fight moves between them - so the encounter is anchored to
   landmarks the player has already been navigating by.
   ============================================================ */

import { TAU, clamp, clamp01, damp, dampAngle, lerp, makeBus } from "saintfall/core.js";
import { patchMaterial } from "saintfall/art.js";
import { DISTRICTS } from "saintfall/terrain.js";

export const WINNOWER_CONFIG = Object.freeze({
  /* The three flare stacks, from world.js's own Censer Works block.
     Mirrored here rather than imported because world.js builds them
     as merged geometry and keeps no table - if the stacks move, this
     moves with them, and the harness asserts they still line up with
     real terrain. */
  stacks: Object.freeze([
    Object.freeze({ x: DISTRICTS.censer.x - 46, z: DISTRICTS.censer.z - 30, h: 58 }),
    Object.freeze({ x: DISTRICTS.censer.x + 8, z: DISTRICTS.censer.z + 18, h: 48 }),
    Object.freeze({ x: DISTRICTS.censer.x + 54, z: DISTRICTS.censer.z - 52, h: 66 }),
  ]),

  /* Walked into, like the Distaff's lair - not a wave that finds the
     player. Wider than the Distaff's 52m because this one is visible
     from much further away and the approach is most of the drama. */
  aggroRadius: 78,
  disengageRadius: 300,
  disengageSeconds: 16,

  // Long enough to establish the silhouette, altitude and arena;
  // the previous threshold released the camera after only 0.42s.
  alertSeconds: 4.8,

  /* CRUISE ALTITUDE. High enough to be unmistakably out of reach,
     low enough that it is still a creature rather than a dot - and
     well under the stacks it circles, so it reads as flying BETWEEN
     them rather than over the whole district. */
  /* ITS TERRITORY. The soar orbits the PLAYER - which, unclamped,
     means it will follow them across the entire map and the leash
     below can never fire, because its distance to the player never
     grows. The orbit anchor is clamped inside this ring around the
     works: chase a player who leaves and it patrols the boundary
     nearest them instead, they keep walking, the distance opens, and
     the disengage finally counts. */
  territoryRadius: 230,
  cruiseHeight: 26,
  orbitRadius: 34,
  orbitSpeed: 0.34,
  bankLimit: 0.55,

  /* How long it can stay up before the furnace runs dry. The floor
     of the whole design: a melee player is never more than this far
     from a window. */
  soarSeconds: 21,
  /* And how long the window itself lasts. Long enough to cross open
     ground and land several swings; short enough that it is a raid
     rather than a free kill. */
  stokeSeconds: 9.5,
  /* A stall is worse for it than a chosen landing - it hits hard and
     takes longer to get back up. */
  stallStokeSeconds: 13.5,
  /* THE CRASH IS THE REWARD. A stall landing opens with this many
     seconds of the animal simply DOWN - no sweeps, no tracking, no
     answer at all - because the player just spent a whole lift pool
     buying this moment and an immediate counter-attack would refund
     none of it. The grace spends out of the stall window rather than
     extending it: stallStokeSeconds already prices the total. */
  crashStunSeconds: 4.0,
  /* Flying home after a disengage. Presentation speed only - the
     heal has already happened when the flight starts. */
  returnSpeed: 12.0,

  landSeconds: 1.9,
  launchSeconds: 1.3,
  /* HOW HIGH THE BODY RIDES WHEN IT IS DOWN.
     The model is authored IN FLIGHT: its origin is the body, the
     landing limbs reach to -2.05 and the furnace gut hangs at -1.85.
     Setting `y` straight to the terrain therefore puts the animal's
     talons and its gut UNDERGROUND - and the gut is the melee target
     the whole encounter exists to offer. It stands on its limbs
     instead, which leaves the gut at about knee height: low enough
     that a player has to get in under the wing, high enough that it
     is visible and a lance can reach it. */
  landedLift: 2.15,

  /* Ash bombardment: the airborne attack. Ballistic so it can be
     walked out from under, which is the only fair way to attack from
     a place the player cannot reach. */
  bombardCadence: 5.2,
  /* SECONDS, DERIVED FROM FRAMES OVER FPS - not frames over frames.
     This was 0.42, which is 22/52: the contact FRAME divided by the
     clip LENGTH, a fraction spent as a duration. Every clip in this
     project exports at 24fps (measured: the 52-frame bombard arrives
     as a 2.167s clip), so frame 22 is 0.917s - and the coals were
     being thrown at 0.42s, which is clip frame 10, the exact frame
     the censers are at their furthest BACKWARD anticipation. The
     payload left half a second before the whip that throws it. */
  bombardContact: 0.917,      // frame 22 of 52 at 24fps
  bombardCount: 4,
  bombardSpeed: 19,
  bombardSpread: 5.5,
  emberDamage: 26,
  ashRadius: 5.4,
  ashSeconds: 9.0,
  ashDps: 11,
  ashTick: 0.5,
  ashMax: 6,

  /* The strafing run: it drops to just above head height and crosses
     the player in a straight line. The one airborne attack a jetpack
     can actually intercept, and the reason to carry one. */
  strafeCadence: 12.0,
  strafeHeight: 7.5,
  strafeSpeed: 30,
  strafeDamage: 42,
  strafeRadius: 4.6,

  /* What a landed Winnower does to anything standing next to it. It
     is not helpless on the ground, it is just REACHABLE. */
  sweepCadence: 2.6,
  sweepContact: 0.583,        // frame 14 of 40 at 24fps
  sweepReach: 7.2,
  sweepDamage: 48,

  simRange: 700,
});

const EMBER_MAX = 12;
/* The territory's centre: the stacks' own centroid, computed once -
   the animal patrols the works, not the map. */
const TERRITORY_X = WINNOWER_CONFIG.stacks.reduce((a, s2) => a + s2.x, 0) / 3;
const TERRITORY_Z = WINNOWER_CONFIG.stacks.reduce((a, s2) => a + s2.z, 0) / 3;
/* Mirrors BESTIARY.winnower.collisionRadius. Used before the
   instance exists, which is why it is not read off `inst.spec`. */
const BESTIARY_RADIUS = 1.8;
const ASH_COLOUR = "#ff7a26";
const ASH_EDGE = "#8f2b08";
const ASH_BED = "#1a0d07";

export function buildWinnower(ctx) {
  const { THREE, scene, atmos, enemies } = ctx;
  const bus = makeBus();
  const C = WINNOWER_CONFIG;
  const groundAt = (x, z) => (ctx.collide
    ? ctx.collide.groundHeight(x, z)
    : ctx.terrain.heightAt(x, z));

  const group = new THREE.Group();
  group.name = "winnower-ash";
  scene.add(group);

  const state = {
    phase: "dormant",   // dormant, alert, soar, strafe, land, stoke, launch, dead
    timer: 0,
    /* SECONDS OF FLIGHT LEFT IN THE FURNACE, and deliberately its own
       accumulator rather than the phase timer.

       It was the phase timer once, and that quietly broke the single
       promise this encounter makes: every strafing run ends by
       re-entering `soar`, which reset the timer, so a Winnower that
       strafed on its twelve-second cadence refilled its own fuel
       every twelve seconds and NEVER came down on schedule. A melee
       build would have waited forever for a window the design says
       it is owed. This burns across every airborne phase and is
       refilled in exactly one place: the launch, after it has
       actually re-lit at a stack. */
    fuel: 0,
    orbit: 0,
    bombardTimer: C.bombardCadence * 0.6,
    strafeTimer: C.strafeCadence * 0.7,
    sweepTimer: 0,
    action: 0,
    actionKind: null,
    pending: 0,
    stackIndex: 0,
    stalled: false,
    stunFor: 0,
    revealed: false,
    disengageFor: 0,
    defeated: false,
    releaseCameraAt: undefined,
    strafeFrom: null,
    strafeTo: null,
    strafeT: 0,
    landFrom: null,
    landTo: null,
  };
  let inst = null;

  /** Keep the dormant encounter allocated but absent from both the
   *  renderer and every authoritative damage path. Alert reveals the
   *  animal while keeping it protected; combat clears the lock only
   *  when the camera returns. */
  function setEncounterGate(hidden, locked = hidden) {
    if (!inst) return;
    inst.encounterHidden = !!hidden;
    inst.encounterLocked = !!locked;
    if (inst.root) inst.root.visible = !inst.encounterHidden;
  }

  /* ============================================================
     EMBER SHOT - a lobbed coal from the censers. Ballistic, exactly
     like the Coulter's venom, because an attack from thirty metres
     up that arrives instantly cannot be answered.
     ============================================================ */
  const emberGeo = new THREE.IcosahedronGeometry(0.38, 0);
  const emberMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(ASH_EDGE),
    emissive: new THREE.Color(ASH_COLOUR),
    emissiveIntensity: 1.85,
    roughness: 0.42,
    metalness: 0,
    flatShading: true,
  });
  emberMat.name = "sf-winnower-ember";
  patchMaterial(emberMat, atmos, { rim: 0.55, glitter: 0 });
  const embers = [];
  for (let i = 0; i < EMBER_MAX; i += 1) {
    const mesh = new THREE.Mesh(emberGeo, emberMat);
    mesh.visible = false;
    mesh.castShadow = false;
    group.add(mesh);
    embers.push({
      mesh, live: false, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0,
    });
  }
  let emberCursor = 0;

  function launchEmber(x, y, z, vx, vy, vz) {
    const e = embers[emberCursor];
    emberCursor = (emberCursor + 1) % EMBER_MAX;
    e.live = true;
    e.life = 5.0;
    e.x = x; e.y = y; e.z = z;
    e.vx = vx; e.vy = vy; e.vz = vz;
    e.spin = (Math.random() - 0.5) * 8;
    e.mesh.position.set(x, y, z);
    e.mesh.visible = true;
    return e;
  }

  /* ============================================================
     ASH FIELDS - the burning ground the embers leave.

     Same pooled, terrain-conformed construction as the Coulter's
     venom and the Distaff's webbing, and deliberately so: three
     hazards built three different ways would each need their own
     bugs found. What differs is what it DOES - this one burns rather
     than poisoning or slowing, so it is the hazard that punishes
     standing still rather than the one that punishes moving.
     ============================================================ */
  const ASH_RINGS = 3;
  const ASH_SIDES = 22;
  const ASH_VERTS = 1 + ASH_RINGS * ASH_SIDES;

  const ashVertex = /* glsl */`
    attribute float aRadial;
    attribute float aAngle;
    varying float vRadial;
    varying float vAngle;
    varying vec3 vWorld;
    void main() {
      vRadial = aRadial;
      vAngle = aAngle;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;
  /* Burning ground is BRIGHT at its cracks and dark everywhere else,
     which is the opposite of the venom pool's soaked bed. Drawn with
     ordinary alpha rather than additively for the same reason the
     venom is: the char has to be able to darken the sand under it,
     and additive blending cannot subtract. The heat is then added
     back only in the cracks, where it belongs. */
  const ashFragment = /* glsl */`
    precision highp float;
    uniform vec3 uCore;
    uniform vec3 uEdge;
    uniform vec3 uBed;
    uniform float uFade;
    uniform float uTime;
    varying float vRadial;
    varying float vAngle;
    varying vec3 vWorld;
    void main() {
      float r = clamp(vRadial, 0.0, 1.0);
      // A crust that cools from the rim inward, cracked by a slow
      // radial break-up so it never reads as a painted disc.
      float crack = pow(abs(sin(vAngle * 5.0 + r * 7.0)), 12.0)
        + pow(abs(sin(vAngle * 9.0 - r * 4.0)), 16.0);
      float breathe = 0.62 + 0.38 * sin(uTime * 1.9 - r * 5.0);
      float bed = 1.0 - smoothstep(0.30, 1.0, r);
      float heat = clamp(crack * breathe * (1.0 - r * 0.55), 0.0, 1.0);
      vec3 c = mix(uBed, uEdge, bed * 0.75);
      c = mix(c, uCore, heat);
      float dist = length(cameraPosition - vWorld);
      float far = 1.0 - smoothstep(190.0, 320.0, dist);
      float a = (bed * 0.80 + heat * 0.75) * uFade * far;
      if (a < 0.006) discard;
      gl_FragColor = vec4(c, clamp(a, 0.0, 0.92));
    }
  `;

  const fields = [];
  for (let i = 0; i < C.ashMax; i += 1) {
    const geo = new THREE.BufferGeometry();
    const position = new Float32Array(ASH_VERTS * 3);
    const radial = new Float32Array(ASH_VERTS);
    const angle = new Float32Array(ASH_VERTS);
    const index = [];
    for (let s = 0; s < ASH_SIDES; s += 1) {
      const n = (s + 1) % ASH_SIDES;
      index.push(0, 1 + s, 1 + n);
      for (let r = 0; r < ASH_RINGS - 1; r += 1) {
        const a0 = 1 + r * ASH_SIDES + s;
        const a1 = 1 + r * ASH_SIDES + n;
        const b0 = 1 + (r + 1) * ASH_SIDES + s;
        const b1 = 1 + (r + 1) * ASH_SIDES + n;
        index.push(a0, b0, b1, a0, b1, a1);
      }
    }
    for (let r = 0; r < ASH_RINGS; r += 1) {
      const t = (r + 1) / ASH_RINGS;
      for (let s = 0; s < ASH_SIDES; s += 1) {
        radial[1 + r * ASH_SIDES + s] = t;
        angle[1 + r * ASH_SIDES + s] = (s / ASH_SIDES) * TAU;
      }
    }
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("aRadial", new THREE.BufferAttribute(radial, 1));
    geo.setAttribute("aAngle", new THREE.BufferAttribute(angle, 1));
    geo.setIndex(index);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uCore: { value: new THREE.Color(ASH_COLOUR) },
        uEdge: { value: new THREE.Color(ASH_EDGE) },
        uBed: { value: new THREE.Color(ASH_BED) },
        uFade: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: ashVertex,
      fragmentShader: ashFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `sf-ash-field-${i}`;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 5;
    group.add(mesh);
    fields.push({
      mesh, mat, position, life: 0, span: 1, x: 0, y: 0, z: 0,
      radius: C.ashRadius, smoke: 0,
    });
  }
  let fieldCursor = 0;

  function spillAsh(x, z, radius = C.ashRadius, seconds = C.ashSeconds) {
    const field = fields[fieldCursor];
    fieldCursor = (fieldCursor + 1) % fields.length;
    const y = groundAt(x, z);
    field.x = x; field.y = y; field.z = z;
    field.radius = radius;
    field.span = seconds;
    field.life = seconds;
    field.smoke = 0;
    const p = field.position;
    p[0] = 0; p[1] = 0.08; p[2] = 0;
    for (let r = 0; r < ASH_RINGS; r += 1) {
      const rr = radius * ((r + 1) / ASH_RINGS);
      for (let s = 0; s < ASH_SIDES; s += 1) {
        const a = (s / ASH_SIDES) * TAU + r * 0.12;
        const wob = 1 - 0.14 * Math.sin(a * 3 + r * 1.9) - 0.06 * Math.cos(a * 7);
        const px = Math.cos(a) * rr * wob;
        const pz = Math.sin(a) * rr * wob;
        const i = (1 + r * ASH_SIDES + s) * 3;
        p[i] = px;
        // Every rim vertex on the sand beneath it - the difference
        // between a burn and a sticker, same as the venom pool.
        p[i + 1] = groundAt(x + px, z + pz) - y + 0.08;
        p[i + 2] = pz;
      }
    }
    field.mesh.position.set(x, y, z);
    field.mesh.geometry.attributes.position.needsUpdate = true;
    field.mesh.geometry.computeBoundingSphere();
    field.mesh.visible = true;
    ctx.vfx?.blast?.(x, y + 0.4, z, radius * 0.5);
    bus.emit("ash", { x, y, z, radius });
    return field;
  }

  function ashAt(x, y, z) {
    for (const field of fields) {
      if (field.life <= 0) continue;
      const dx = x - field.x;
      const dz = z - field.z;
      if (dx * dx + dz * dz > field.radius * field.radius) continue;
      if (Math.abs(y - field.y) > 3.2) continue;
      return field;
    }
    return null;
  }

  const burn = { tick: 0, standing: false };

  function updateFields(dt) {
    for (const field of fields) {
      if (field.life <= 0) {
        if (field.mesh.visible) field.mesh.visible = false;
        continue;
      }
      field.life -= dt;
      if (field.life <= 0) {
        field.mesh.visible = false;
        field.mat.uniforms.uFade.value = 0;
        continue;
      }
      const t = field.life / field.span;
      const fade = t > 0.85 ? clamp01((1 - t) / 0.15) : clamp01(t / 0.85) ** 0.65;
      field.mat.uniforms.uFade.value = fade;
      field.mat.uniforms.uTime.value = atmos.elapsed;
      field.smoke -= dt;
      if (field.smoke <= 0) {
        field.smoke = 0.42;
        ctx.vfx?.venomGas?.(field.x, field.y + 0.25, field.z,
          field.radius * 0.7, fade * 0.5);
      }
    }
    /* Burning ground applies in HALF-SECOND TICKS, not per frame -
       the same reasoning as the Coulter's toxin: per frame fires the
       hurt bus sixty times a second and makes the damage the player
       sees depend on their frame rate. */
    const ps = ctx.player?.state;
    if (!ps || ctx.combat?.player?.dead) { burn.standing = false; return; }
    const field = ashAt(ps.x, ps.y, ps.z);
    burn.standing = !!field;
    if (!field) { burn.tick = 0; return; }
    burn.tick += dt;
    if (burn.tick < C.ashTick) return;
    const seconds = burn.tick;
    burn.tick = 0;
    ctx.combat.hurtPlayer(C.ashDps * seconds, {
      source: "winnower-ash", x: ps.x, y: ps.y + 1.0, z: ps.z,
    });
  }

  function updateEmbers(dt) {
    const ps = ctx.player?.state;
    for (const e of embers) {
      if (!e.live) continue;
      e.life -= dt;
      const px = e.x, py = e.y, pz = e.z;
      e.vy -= 20 * dt;
      e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
      e.mesh.position.set(e.x, e.y, e.z);
      e.mesh.rotation.x += e.spin * dt;
      e.mesh.rotation.z += e.spin * 0.6 * dt;
      // A coal in flight sheds its own trail, which is most of what
      // sells it as falling fire rather than a thrown rock.
      ctx.vfx?.spark?.(e.x, e.y, e.z, 0.32, false, false);

      let hit = null;
      const step = Math.hypot(e.x - px, e.y - py, e.z - pz);
      if (step > 1e-4 && ctx.collide?.rayBlock) {
        const blocked = ctx.collide.rayBlock(px, py, pz,
          (e.x - px) / step, (e.y - py) / step, (e.z - pz) / step, step);
        if (blocked < step) {
          hit = {
            x: px + ((e.x - px) / step) * blocked,
            y: py + ((e.y - py) / step) * blocked,
            z: pz + ((e.z - pz) / step) * blocked,
            direct: false,
          };
        }
      }
      if (!hit && ps && !ctx.combat?.player?.dead) {
        const dx = e.x - ps.x;
        const dz = e.z - ps.z;
        const dy = e.y - (ps.y + 1.0);
        if (dx * dx + dz * dz < 1.8 * 1.8 && Math.abs(dy) < 1.6) {
          hit = { x: e.x, y: e.y, z: e.z, direct: true };
        }
      }
      if (!hit && e.y <= groundAt(e.x, e.z) + 0.25) {
        hit = { x: e.x, y: groundAt(e.x, e.z), z: e.z, direct: false };
      }
      if (hit) {
        e.live = false;
        e.mesh.visible = false;
        if (hit.direct) {
          ctx.combat?.hurtPlayer?.(C.emberDamage, {
            source: "winnower-ember", x: hit.x, y: hit.y, z: hit.z,
          });
          ctx.player?.punch?.(1.1);
        }
        spillAsh(hit.x, hit.z);
        continue;
      }
      if (e.life <= 0) { e.live = false; e.mesh.visible = false; }
    }
  }

  /* ============================================================
     FLIGHT
     ============================================================ */

  const _vec = new THREE.Vector3();

  /**
   * Collapse a burst heat sac.
   *
   * `combat.js` has tracked `inst.sacBurst` since the lift pool
   * existed, and its own comment says the flag is "what lets the
   * model stop drawing them" - but for one build the model never drew
   * them at all, so a player emptying the pool got no art, no
   * feedback and no state change for half the fight. The sacs are now
   * real geometry on their own bones, and a burst one deflates.
   *
   * Driven every frame rather than on the event, because a save
   * restored mid-fight has to come back with the right sacs down and
   * there is no event to replay.
   */
  function syncSacs() {
    if (!inst?.sacBurst) return;
    for (let i = 0; i < inst.sacBurst.length; i += 1) {
      const bone = inst.bones.get(i === 0 ? "sac_L" : "sac_R");
      if (!bone) continue;
      const want = inst.sacBurst[i] ? 0.34 : 1;
      if (Math.abs(bone.scale.x - want) > 0.001) bone.scale.setScalar(want);
    }
  }

  function nearestStack(x, z) {
    let best = C.stacks[0];
    let bestD = Infinity;
    for (const s of C.stacks) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /** Altitude it wants right now, measured off the ground below it so
   *  it clears the terrace step rather than flying into it. */
  function cruiseY(x, z) {
    return groundAt(x, z) + C.cruiseHeight;
  }

  function faceTravel(dt, tx, tz, rate = 2.0) {
    const dx = tx - inst.x;
    const dz = tz - inst.z;
    if (Math.hypot(dx, dz) < 1e-3) return;
    const want = Math.atan2(dx, dz);
    const before = inst.yaw;
    inst.yaw = dampAngle(inst.yaw, want, rate, dt);
    /* BANK INTO THE TURN. The roll is derived from how fast the yaw
       is actually changing rather than authored per phase, so every
       turn in the encounter banks by the same rule and a tight one
       banks harder by construction. */
    const turn = ((inst.yaw - before + Math.PI * 3) % TAU) - Math.PI;
    const wantRoll = clamp(-turn / Math.max(1e-4, dt) * 0.22,
      -C.bankLimit, C.bankLimit);
    inst.roll = damp(inst.roll, wantRoll, 3.0, dt);
  }

  function beginAlert() {
    state.phase = "alert";
    state.timer = C.alertSeconds;
    setEncounterGate(false, true);
    enemies.play(inst, "alert", 0.25);
    bus.emit("aggro", { x: inst.x, y: inst.y, z: inst.z });
    /* Same reveal mechanism the Distaff uses - player.setFree, which
       is the engine's existing review camera. Framed from BELOW here,
       looking up: the whole point of this animal is the angle it is
       seen at, and the reveal should teach that in one shot. Once per
       encounter - re-aggroing out of a return flight is mid-fight,
       and stealing the camera twice punishes the player for staying. */
    if (state.revealed) return;
    state.revealed = true;
    if (ctx.player?.setFree && !ctx.player.state.free) {
      const ps = ctx.player.state;
      const camX = ps.x;
      const camZ = ps.z;
      const camY = groundAt(camX, camZ) + 2.0;
      ctx.player.setFree(true, [camX, camY, camZ],
        [inst.x, inst.y, inst.z], 52);
      state.releaseCameraAt = 0;
    }
  }

  /** Re-enter the orbit. Does NOT touch the fuel - see `state.fuel`.
   *  Coming back from a strafing run is not a refuel, and treating it
   *  as one is what stops the animal ever landing. */
  function beginSoar() {
    state.phase = "soar";
    inst.grounded = false;
    if (inst.state !== "strain") enemies.play(inst, "idle", 0.4);
    state.timer = 0;
  }

  function beginStrafe() {
    const ps = ctx.player.state;
    // Run the line THROUGH the player rather than to them, starting
    // well back so the approach is visible and dodgeable.
    const dx = ps.x - inst.x;
    const dz = ps.z - inst.z;
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d;
    const uz = dz / d;
    state.strafeFrom = { x: ps.x - ux * 52, z: ps.z - uz * 52 };
    state.strafeTo = { x: ps.x + ux * 46, z: ps.z + uz * 46 };
    state.strafeT = 0;
    state.phase = "strafe";
    state.strafeTimer = C.strafeCadence;
    enemies.play(inst, "alert", 0.2);
    bus.emit("strafeTelegraph", { x: inst.x, y: inst.y, z: inst.z });
  }

  function beginLand(stalled) {
    const stack = nearestStack(inst.x, inst.z);
    /* Land at the FOOT of the stack, not on it - the fight has to
       happen on ground the player can stand on - and push the chosen
       spot out of any masonry before committing to it. A refinery is
       the densest district on the map; a landing point picked by
       angle alone puts a twenty-six metre animal inside a cracking
       tower often enough to matter. */
    const a = Math.random() * TAU;
    const r = 16 + Math.random() * 6;
    let lx = stack.x + Math.cos(a) * r;
    let lz = stack.z + Math.sin(a) * r;
    const open = ctx.collide?.findOpen?.(lx, lz, groundAt(lx, lz), 24, 12,
      inst.spec.collisionRadius || 1.8);
    if (open) { lx = open[0]; lz = open[1]; }
    state.landTo = { x: lx, z: lz };
    state.landFrom = { x: inst.x, y: inst.y, z: inst.z };
    state.phase = "land";
    state.timer = stalled ? C.landSeconds * 0.65 : C.landSeconds;
    state.stalled = !!stalled;
    enemies.play(inst, "land", 0.15);
    bus.emit("landing", { x: state.landTo.x, z: state.landTo.z, stalled: !!stalled });
  }

  function beginStoke() {
    state.phase = "stoke";
    state.timer = state.stalled ? C.stallStokeSeconds : C.stokeSeconds;
    state.sweepTimer = 1.2;
    inst.grounded = true;
    inst.y = groundAt(inst.x, inst.z) + C.landedLift;
    inst.pitch = 0;
    inst.roll = 0;
    const y = groundAt(inst.x, inst.z);
    if (state.stalled) {
      /* SHOT DOWN. It arrives as a knockout: the strain clip keeps
         it sprawled rather than tented, the impact is dust and shake
         only - the crash never damages the player; it is their prize,
         not a trade - and `stunFor` holds every attack off long
         enough to spend melee into it freely. */
      state.stunFor = C.crashStunSeconds;
      state.sweepTimer = C.crashStunSeconds + 1.0;
      /* Its own clip: "strain" is an airborne pose whose chains hang
         straight down, which put the thuribles underground for the
         whole knockout. The sprawl throws them forward onto the sand. */
      enemies.play(inst, "sprawl", 0.10);
      ctx.player?.doctrineKick?.(1.3, 1);
      ctx.vfx?.blast?.(inst.x, y + 0.4, inst.z, 9);
      ctx.vfx?.sandSpray?.(inst.x, y + 0.5, inst.z, 3.4, 0, 1);
      bus.emit("stunned", { x: inst.x, z: inst.z, seconds: C.crashStunSeconds });
    } else {
      state.stunFor = 0;
      enemies.play(inst, "stoke", 0.2);
      ctx.player?.doctrineKick?.(1.0, 1);
      ctx.vfx?.blast?.(inst.x, y + 0.4, inst.z, 7);
      ctx.vfx?.sandSpray?.(inst.x, y + 0.5, inst.z, 2.4, 0, 1);
    }
    bus.emit("stoke", {
      x: inst.x, z: inst.z, stalled: state.stalled, seconds: state.timer,
    });
  }

  function beginLaunch() {
    state.phase = "launch";
    state.timer = C.launchSeconds;
    inst.grounded = false;
    enemies.play(inst, "launch", 0.12);
    /* A stall is PAID OFF here rather than at the landing: the pool
       refills only once it is actually back in the air, so a player
       who keeps shooting the sacs while it is down keeps it down. */
    inst.lift = inst.maxLift;
    if (Array.isArray(inst.sacBurst)) inst.sacBurst.fill(false);
    // THE ONLY REFUEL. It has just spent the stoke drinking a flare
    // stack, so this is the one moment the furnace is full again.
    state.fuel = C.soarSeconds;
    state.stalled = false;
    const y = groundAt(inst.x, inst.z);
    ctx.vfx?.sandSpray?.(inst.x, y + 0.5, inst.z, 3.2, 0, 1);
    bus.emit("launch", { x: inst.x, z: inst.z });
  }

  function beginBombard() {
    enemies.play(inst, "bombard", 0.15);
    state.action = 2.167;       // the clip's own measured length
    state.actionKind = "bombard";
    state.pending = C.bombardContact;
    state.bombardTimer = C.bombardCadence;
    bus.emit("bombardTelegraph", { x: inst.x, y: inst.y, z: inst.z });
  }

  function beginSweep() {
    // Its own clip now. This played `flinch` for one build - a
    // forty-eight damage swing animated by the animal recoiling from
    // the player, which reads as the attack hurting the attacker.
    enemies.play(inst, "sweep", 0.08);
    state.action = 1.667;       // 40 frames at 24fps
    state.actionKind = "sweep";
    state.pending = C.sweepContact;
    state.sweepTimer = C.sweepCadence;
    bus.emit("sweepTelegraph", { x: inst.x, z: inst.z });
  }

  function dropEmbers() {
    const ps = ctx.player.state;
    for (let i = 0; i < C.bombardCount; i += 1) {
      const bone = inst.bones.get(`censer${i % 3}`);
      let ox = inst.x;
      let oy = inst.y - 2.2;
      let oz = inst.z;
      if (bone) {
        bone.updateWorldMatrix(true, false);
        bone.getWorldPosition(_vec);
        ox = _vec.x; oy = _vec.y; oz = _vec.z;
      }
      // Lead the player a little and scatter, so a straight-line
      // sprint is not a guaranteed dodge and standing still is not a
      // guaranteed hit.
      const spread = (i / Math.max(1, C.bombardCount - 1) - 0.5) * 2;
      const tx = ps.x + spread * C.bombardSpread + (Math.random() - 0.5) * 2.5;
      const tz = ps.z + spread * C.bombardSpread * 0.6 + (Math.random() - 0.5) * 2.5;
      const v = ballistic(ox, oy, oz, tx, ps.y + 0.6, tz, C.bombardSpeed);
      launchEmber(ox, oy, oz, v.x, v.y, v.z);
    }
    ctx.vfx?.spark?.(inst.x, inst.y - 2.0, inst.z, 2.2, false, false);
    bus.emit("bombard", { x: inst.x, y: inst.y, z: inst.z, count: C.bombardCount });
  }

  /** The low-arc ballistic root, straight out of the Coulter's spew -
   *  a mortar arc from this altitude would take four seconds to land
   *  and the player would simply have walked away. */
  function ballistic(x, y, z, tx, ty, tz, speed) {
    const dx = tx - x;
    const dz = tz - z;
    const flat = Math.hypot(dx, dz) || 1e-4;
    const dy = ty - y;
    const g = 20;
    const s2 = speed * speed;
    const root = s2 * s2 - g * (g * flat * flat + 2 * dy * s2);
    const ux = dx / flat;
    const uz = dz / flat;
    if (root < 0) {
      const pitch = -0.2;
      return {
        x: ux * Math.cos(pitch) * speed,
        y: Math.sin(pitch) * speed,
        z: uz * Math.cos(pitch) * speed,
      };
    }
    const angle = Math.atan2(s2 - Math.sqrt(root), g * flat);
    const horizontal = Math.cos(angle) * speed;
    return { x: ux * horizontal, y: Math.sin(angle) * speed, z: uz * horizontal };
  }

  function landSweep() {
    const ps = ctx.player.state;
    const dist = Math.hypot(ps.x - inst.x, ps.z - inst.z);
    if (dist > C.sweepReach + 1.4 || ctx.combat?.player?.dead) {
      bus.emit("sweepMiss", { x: inst.x, z: inst.z });
      return;
    }
    ctx.combat.hurtPlayer(C.sweepDamage, {
      source: "winnower-sweep", x: ps.x, y: ps.y + 1.0, z: ps.z,
    });
    ctx.player.punch?.(1.4);
    bus.emit("sweep", { x: inst.x, z: inst.z });
  }

  function resolveAction(dt) {
    if (!(state.pending > 0)) return;
    state.pending -= dt;
    if (state.pending > 0) return;
    state.pending = 0;
    if (state.actionKind === "bombard") dropEmbers();
    else if (state.actionKind === "sweep") landSweep();
  }

  /* ============================================================
     PHASES
     ============================================================ */

  function stepSoar(dt) {
    const ps = ctx.player.state;
    /* Orbits the PLAYER rather than a fixed point. A boss that circles
       the middle of its arena while the player stands at the edge is a
       boss that has stopped being in the fight.

       ...clamped to its own territory. Unclamped, "orbit the player"
       is "follow the player anywhere", the distance between them
       never opens, and the leash can never fire. A player who walks
       out watches it wheel at the boundary instead - still in the
       fight to look at, no longer in the fight to chase. */
    state.orbit += dt * C.orbitSpeed;
    let ax = ps.x;
    let az = ps.z;
    const hx = ax - TERRITORY_X;
    const hz = az - TERRITORY_Z;
    const hd = Math.hypot(hx, hz);
    const anchorMax = C.territoryRadius - C.orbitRadius;
    const playerInside = hd < C.territoryRadius;
    if (hd > anchorMax) {
      ax = TERRITORY_X + (hx / hd) * anchorMax;
      az = TERRITORY_Z + (hz / hd) * anchorMax;
    }
    const tx = ax + Math.cos(state.orbit) * C.orbitRadius;
    const tz = az + Math.sin(state.orbit) * C.orbitRadius;
    const speed = inst.spec.speed.walk;
    const dx = tx - inst.x;
    const dz = tz - inst.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.5) {
      inst.x += (dx / d) * Math.min(speed, d / Math.max(dt, 1e-4)) * dt;
      inst.z += (dz / d) * Math.min(speed, d / Math.max(dt, 1e-4)) * dt;
    }
    inst.y = damp(inst.y, cruiseY(inst.x, inst.z), 1.6, dt);
    faceTravel(dt, tx, tz, 1.8);
    inst.pitch = damp(inst.pitch, 0, 2.0, dt);

    /* THE FURNACE RUNS DOWN. Two ways to reach the same landing: the
       fuel, which always runs out, and the lift pool, which the
       player empties by shooting the sacs. The first is the floor a
       melee build is owed; the second is what a rifle build buys. */
    const stalled = inst.lift <= 0;
    if (stalled && inst.state !== "strain") enemies.play(inst, "strain", 0.2);
    if (state.fuel <= 0 || stalled) { beginLand(stalled); return; }

    state.action = Math.max(0, state.action - dt);
    if (state.action > 0) { resolveAction(dt); return; }

    state.bombardTimer -= dt;
    state.strafeTimer -= dt;
    /* It does not attack ground it does not own. A bombardment
       thrown 200m past the boundary at a leaving player is both
       unreadable and unfair - and mechanically it would reset the
       leash fight the player is choosing to walk away from. */
    if (!playerInside) return;
    if (state.strafeTimer <= 0) { beginStrafe(); return; }
    if (state.bombardTimer <= 0) { beginBombard(); return; }
  }

  function stepStrafe(dt) {
    const from = state.strafeFrom;
    const to = state.strafeTo;
    if (!from || !to) { beginSoar(); return; }
    const span = Math.hypot(to.x - from.x, to.z - from.z) || 1;
    state.strafeT += (C.strafeSpeed / span) * dt;
    const t = clamp01(state.strafeT);
    inst.x = lerp(from.x, to.x, t);
    inst.z = lerp(from.z, to.z, t);
    // Dips to strafe height across the middle of the run and climbs
    // out at both ends, so the pass has a shape.
    const dip = Math.sin(t * Math.PI);
    const want = groundAt(inst.x, inst.z)
      + lerp(C.cruiseHeight, C.strafeHeight, dip);
    inst.y = damp(inst.y, want, 6.0, dt);
    faceTravel(dt, to.x, to.z, 4.0);
    inst.pitch = damp(inst.pitch, -0.10 * dip, 3.0, dt);

    // The hit is resolved by proximity along the run rather than at a
    // fixed frame: the player can genuinely step out of the line.
    const ps = ctx.player.state;
    if (!ctx.combat?.player?.dead) {
      const dx = ps.x - inst.x;
      const dz = ps.z - inst.z;
      const dy = (ps.y + 1.0) - inst.y;
      if (dx * dx + dz * dz < C.strafeRadius * C.strafeRadius
        && Math.abs(dy) < 6 && !state.strafeHit) {
        state.strafeHit = true;
        ctx.combat.hurtPlayer(C.strafeDamage, {
          source: "winnower-strafe", x: ps.x, y: ps.y + 1.0, z: ps.z,
        });
        ctx.player.punch?.(1.6);
        ctx.player.doctrineKick?.(0.8, 0.6);
        bus.emit("strafeHit", { x: ps.x, z: ps.z });
      }
    }
    if (t >= 1) {
      state.strafeHit = false;
      beginSoar();
    }
  }

  function stepLand(dt) {
    const to = state.landTo;
    state.timer -= dt;
    const t = 1 - clamp01(state.timer / Math.max(0.01, C.landSeconds));
    inst.x = lerp(state.landFrom.x, to.x, clamp01(t * 1.1));
    inst.z = lerp(state.landFrom.z, to.z, clamp01(t * 1.1));
    const ground = groundAt(inst.x, inst.z) + C.landedLift;
    /* A STALL FALLS, a landing DESCENDS. Squaring the curve makes the
       stalled arrival accelerate into the ground, which is the read
       that says the animal did not choose this. */
    const curve = state.stalled ? t * t : t;
    inst.y = lerp(state.landFrom.y, ground, curve);
    faceTravel(dt, to.x, to.z, 2.4);
    inst.pitch = damp(inst.pitch, state.stalled ? 0.30 : -0.18, 4.0, dt);
    inst.roll = damp(inst.roll, state.stalled ? 0.22 : 0, 3.0, dt);
    if (state.timer <= 0 || inst.y <= ground + 0.05) {
      inst.y = ground;
      beginStoke();
    }
  }

  function stepStoke(dt) {
    state.timer -= dt;
    inst.y = groundAt(inst.x, inst.z) + C.landedLift;
    const ps = ctx.player.state;
    /* Knocked out cold: no tracking, no sweeps, nothing - the free
       window the stall bought. It comes to with the stoke clip (the
       drag up onto its own limbs) and only then starts answering. */
    if (state.stunFor > 0) {
      state.stunFor -= dt;
      if (state.stunFor <= 0) {
        enemies.play(inst, "stoke", 0.3);
        bus.emit("stokeRecover", { x: inst.x, z: inst.z });
      }
      return;
    }
    // Turns to keep the player in front of it, slowly - a grounded
    // Winnower is reachable, not passive.
    faceTravel(dt, ps.x, ps.z, 0.9);
    inst.roll = damp(inst.roll, 0, 4.0, dt);

    state.action = Math.max(0, state.action - dt);
    if (state.action > 0) { resolveAction(dt); return; }
    state.sweepTimer -= dt;
    if (state.sweepTimer <= 0
      && Math.hypot(ps.x - inst.x, ps.z - inst.z) < C.sweepReach) {
      beginSweep();
      return;
    }
    if (state.timer <= 0) beginLaunch();
  }

  function stepLaunch(dt) {
    state.timer -= dt;
    const t = 1 - clamp01(state.timer / C.launchSeconds);
    const ground = groundAt(inst.x, inst.z) + C.landedLift;
    inst.y = lerp(ground, cruiseY(inst.x, inst.z), t * t);
    inst.pitch = damp(inst.pitch, -0.34 * (1 - t), 4.0, dt);
    if (state.timer <= 0) beginSoar();
  }

  function stepInstance(dt) {
    if (!inst) return;
    if (inst.state === "death") {
      if (!state.defeated) {
        state.defeated = true;
        state.phase = "dead";
        bus.emit("defeated", { x: inst.x, y: inst.y, z: inst.z });
      }
      /* IT FALLS. A flyer killed in the air has to arrive on the
         ground - the death clip only folds its wings, and a corpse
         left hanging at cruise altitude is the single most obviously
         broken thing this encounter could ship with. */
      const ground = groundAt(inst.x, inst.z) + C.landedLift * 0.42;
      if (inst.y > ground) {
        inst.fallSpeed = (inst.fallSpeed || 0) + 26 * dt;
        inst.y = Math.max(ground, inst.y - inst.fallSpeed * dt);
        /* Written straight onto the root rather than through
           `inst.pitch`/`inst.roll`: enemies.js guards the flyer's
           rotation write with `if (!dying)`, so a corpse that set
           those fields fell perfectly level holding its last living
           orientation - twenty-six metres of wing gliding down like a
           tray. A thing that has stopped flying has to tumble. */
        inst.pitch = damp(inst.pitch, 0.55, 1.6, dt);
        inst.roll = damp(inst.roll, 0.42, 1.4, dt);
        inst.root.rotation.set(inst.pitch, inst.yaw, inst.roll);
        if (inst.y <= ground + 0.02 && !state.impacted) {
          state.impacted = true;
          inst.grounded = true;
          ctx.vfx?.blast?.(inst.x, ground + 0.5, inst.z, 11);
          ctx.player?.doctrineKick?.(1.2, 1);
          bus.emit("crash", { x: inst.x, z: inst.z });
        }
      }
      return;
    }
    const ps = ctx.player.state;
    const dist = Math.hypot(ps.x - inst.x, ps.z - inst.z);

    if (state.phase === "dormant") {
      if (dist <= C.aggroRadius) beginAlert();
      return;
    }

    if (state.phase === "return") { stepReturn(dt, dist); return; }

    if (dist > C.disengageRadius && state.phase !== "stoke") {
      state.disengageFor += dt;
      if (state.disengageFor > C.disengageSeconds) { beginReturn(); return; }
    } else {
      state.disengageFor = 0;
    }

    if (state.phase === "alert") {
      inst.y = damp(inst.y, cruiseY(inst.x, inst.z), 1.2, dt);
      faceTravel(dt, ps.x, ps.z, 1.4);
      state.timer -= dt;
      if (state.releaseCameraAt !== undefined && state.timer <= state.releaseCameraAt) {
        ctx.player?.setFree?.(false);
        state.releaseCameraAt = undefined;
      }
      // The first tank. Every later one comes from a stoke.
      if (state.timer <= 0) {
        setEncounterGate(false, false);
        state.fuel = C.soarSeconds;
        beginSoar();
      }
      return;
    }

    /* Fuel burns in EVERY airborne phase, in one place, so no future
       phase can accidentally fly for free the way the strafing run
       once did. */
    if (state.phase === "soar" || state.phase === "strafe") {
      state.fuel = Math.max(0, state.fuel - dt);
    }

    if (state.phase === "soar") stepSoar(dt);
    else if (state.phase === "strafe") stepStrafe(dt);
    else if (state.phase === "land") stepLand(dt);
    else if (state.phase === "stoke") stepStoke(dt);
    else if (state.phase === "launch") stepLaunch(dt);
  }

  /** The player left. Heal NOW - the leash's promise must not depend
   *  on the flight home completing - then fly back and circle down. */
  function beginReturn() {
    inst.health = inst.maxHealth;
    inst.lift = inst.maxLift;
    if (Array.isArray(inst.sacBurst)) inst.sacBurst.fill(false);
    inst.grounded = false;
    state.phase = "return";
    state.stalled = false;
    state.stunFor = 0;
    state.disengageFor = 0;
    state.action = 0;
    setEncounterGate(false, false);
    enemies.play(inst, "idle", 0.4);
    bus.emit("returning", { x: inst.x, z: inst.z });
  }

  function stepReturn(dt, dist) {
    /* Crossing its aggro ring on the way home re-engages it - full
       strength, no second camera steal, fuel topped for the fresh
       fight. */
    if (dist <= C.aggroRadius) {
      state.fuel = C.soarSeconds;
      beginSoar();
      bus.emit("aggro", { x: inst.x, y: inst.y, z: inst.z });
      return;
    }
    const perch = perchPoint();
    const dx = perch.x - inst.x;
    const dz = perch.z - inst.z;
    const home = Math.hypot(dx, dz);
    if (home < 8) {
      state.phase = "dormant";
      state.revealed = false;
      setEncounterGate(true, true);
      enemies.play(inst, "idle", 0.5);
      bus.emit("reset", { x: inst.x, z: inst.z });
      return;
    }
    const step = Math.min(C.returnSpeed, home / Math.max(dt, 1e-4));
    inst.x += (dx / home) * step * dt;
    inst.z += (dz / home) * step * dt;
    inst.y = damp(inst.y, cruiseY(inst.x, inst.z), 1.4, dt);
    faceTravel(dt, perch.x, perch.z, 1.8);
  }

  /** The hard variant - QA and save-restore only: snaps home rather
   *  than flying, because a restore has no business animating. */
  function resetToPerch() {
    state.defeated = false;
    if (!inst) ensureSpawned();
    if (!inst) return;
    inst.health = inst.maxHealth;
    inst.lift = inst.maxLift;
    if (Array.isArray(inst.sacBurst)) inst.sacBurst.fill(false);
    const perch = perchPoint();
    inst.x = perch.x;
    inst.z = perch.z;
    inst.y = groundAt(perch.x, perch.z) + C.cruiseHeight;
    inst.grounded = false;
    inst.pitch = 0;
    inst.roll = 0;
    state.phase = "dormant";
    state.stalled = false;
    state.stunFor = 0;
    state.revealed = false;
    state.disengageFor = 0;
    state.releaseCameraAt = undefined;
    setEncounterGate(true, true);
    enemies.play(inst, "idle", 0.4);
    bus.emit("reset", { x: inst.x, z: inst.z });
  }

  /* Its perch: beside a flare stack rather than on top of one.
     Spawning dead-centre on a stack put the animal inside the
     tower's own collision footprint - invisible while it is airborne,
     and a real problem the moment it lands there. Offset clear of the
     masonry and nudged out of anything else it happens to find. */
  function perchPoint() {
    const stack = C.stacks[0];
    let px = stack.x + 19;
    let pz = stack.z + 12;
    const open = ctx.collide?.findOpen?.(px, pz, groundAt(px, pz), 24, 12,
      BESTIARY_RADIUS);
    if (open) { px = open[0]; pz = open[1]; }
    return { x: px, z: pz };
  }

  function ensureSpawned() {
    if (state.defeated) return null;
    if (inst) return inst;
    const perch = perchPoint();
    inst = enemies.spawn("winnower", perch.x, perch.z, {
      yaw: Math.PI * 0.6,
      eventId: "district-boss:censer",
    });
    if (inst) {
      inst.y = groundAt(perch.x, perch.z) + C.cruiseHeight;
      inst.grounded = false;
      inst.root.position.set(inst.x, inst.y, inst.z);
      setEncounterGate(true, true);
    }
    return inst;
  }

  function update(dt) {
    const d = Math.min(0.1, Math.max(0, dt));
    if (!inst) { ensureSpawned(); return; }
    const ps = ctx.player?.state;
    if (ps && inst.state !== "death") {
      const far = (inst.x - ps.x) ** 2 + (inst.z - ps.z) ** 2 > C.simRange * C.simRange;
      if (far) return;
    }
    stepInstance(d);
    syncSacs();
    updateEmbers(d);
    updateFields(d);
  }

  function status() {
    if (!inst) return state.defeated ? {
      phase: "dead", dead: true, defeated: true,
      health: 0, maxHealth: 6200,
      x: C.stacks[0].x, y: 0, z: C.stacks[0].z,
    } : null;
    return {
      phase: state.phase,
      instanceId: state.defeated || inst.state === "death" ? null : inst.id,
      health: Math.max(0, Math.round(inst.health)),
      maxHealth: Math.round(inst.maxHealth),
      lift: Number((inst.lift ?? 0).toFixed(2)),
      maxLift: inst.maxLift ?? 0,
      sacBurst: Array.isArray(inst.sacBurst) ? [...inst.sacBurst] : [],
      grounded: !!inst.grounded,
      stalled: !!state.stalled,
      stunned: state.stunFor > 0,
      stunFor: Number(Math.max(0, state.stunFor).toFixed(2)),
      fuel: Number(state.fuel.toFixed(2)),
      dead: inst.state === "death",
      altitude: Number((inst.y - groundAt(inst.x, inst.z)).toFixed(2)),
      x: Number(inst.x.toFixed(2)),
      y: Number(inst.y.toFixed(2)),
      z: Number(inst.z.toFixed(2)),
      timer: Number(state.timer.toFixed(2)),
      ashFields: fields.filter((f) => f.life > 0).length,
      embers: embers.filter((e) => e.live).length,
      hidden: !!inst.encounterHidden,
      locked: !!inst.encounterLocked,
    };
  }

  function snapshot() {
    if (!inst) return state.defeated ? {
      phase: "dead", timer: 0, instanceId: null,
      fuel: 0, health: 0, lift: 0, sacBurst: null,
      stalled: false, stunFor: 0, revealed: true,
      x: C.stacks[0].x, y: 0, z: C.stacks[0].z, yaw: 0,
      defeated: true,
    } : null;
    return {
      phase: state.phase,
      instanceId: state.defeated || inst.state === "death" ? null : inst.id,
      timer: Number(state.timer.toFixed(2)),
      fuel: Number(state.fuel.toFixed(2)),
      health: Math.round(inst.health),
      lift: inst.lift,
      sacBurst: Array.isArray(inst.sacBurst) ? [...inst.sacBurst] : null,
      stalled: !!state.stalled,
      stunFor: Number(Math.max(0, state.stunFor).toFixed(2)),
      revealed: state.revealed,
      x: inst.x, y: inst.y, z: inst.z, yaw: inst.yaw,
      defeated: state.defeated,
    };
  }

  function restore(saved, restoredEnemies = {}) {
    if (!saved || typeof saved !== "object") return false;
    const byId = restoredEnemies?.byId instanceof Map ? restoredEnemies.byId : new Map();
    const rebound = (typeof saved.instanceId === "string" && byId.get(saved.instanceId))
      || enemies.live.find((candidate) => candidate.eventId === "district-boss:censer")
      || enemies.live.find((candidate) => candidate.key === "winnower"
        && Math.hypot(candidate.x - C.stacks[0].x, candidate.z - C.stacks[0].z) < 140);
    state.defeated = !!saved.defeated || saved.phase === "dead" || saved.health <= 0;
    if (state.defeated) {
      if (rebound) enemies.remove?.(rebound);
      inst = null;
      state.phase = "dead";
      clearHazards();
      return true;
    }
    inst = rebound || null;
    ensureSpawned();
    if (!inst) return false;
    const phase = ["dormant", "alert", "soar", "strafe", "land", "stoke",
      "launch", "return", "dead"].includes(saved.phase) ? saved.phase : "dormant";
    state.phase = phase;
    state.timer = Math.max(0, Number(saved.timer) || 0);
    state.fuel = clamp(Number(saved.fuel) || 0, 0, C.soarSeconds);
    state.stalled = !!saved.stalled;
    state.stunFor = Math.max(0, Number(saved.stunFor) || 0);
    state.revealed = saved.revealed !== undefined
      ? !!saved.revealed : phase !== "dormant";
    state.defeated = false;
    state.disengageFor = 0;
    state.releaseCameraAt = undefined;
    inst.x = Number.isFinite(saved.x) ? saved.x : inst.x;
    inst.z = Number.isFinite(saved.z) ? saved.z : inst.z;
    inst.y = Number.isFinite(saved.y) ? saved.y : inst.y;
    inst.yaw = Number.isFinite(saved.yaw) ? saved.yaw : inst.yaw;
    if (Number.isFinite(saved.health)) inst.health = clamp(saved.health, 0, inst.maxHealth);
    if (Number.isFinite(saved.lift)) inst.lift = clamp(saved.lift, 0, inst.maxLift);
    if (Array.isArray(saved.sacBurst) && inst.sacBurst) {
      for (let i = 0; i < inst.sacBurst.length; i += 1) inst.sacBurst[i] = !!saved.sacBurst[i];
    }
    /* Grounded is DERIVED from the phase rather than trusted from the
       save: those are the only two phases that put it on the sand,
       and a restored `grounded: true` at cruise altitude would make
       the gut shootable from the ground for the rest of the fight. */
    inst.grounded = phase === "stoke" || phase === "land";
    inst.root.position.set(inst.x, inst.y, inst.z);
    inst.root.rotation.set(0, inst.yaw, 0);
    setEncounterGate(phase === "dormant", phase === "dormant" || phase === "alert");
    if (state.defeated || phase === "dead") {
      enemies.play(inst, "death", 0);
      inst.health = 0;
    } else {
      enemies.play(inst, phase === "stoke" ? "stoke"
        : phase === "dormant" ? "idle" : "alert", 0);
    }
    return true;
  }

  function clearHazards() {
    for (const e of embers) { e.live = false; e.mesh.visible = false; }
    for (const f of fields) {
      f.life = 0; f.mesh.visible = false; f.mat.uniforms.uFade.value = 0;
    }
    burn.tick = 0;
    burn.standing = false;
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
    spillAsh,
    ensureSpawned,
    resetToPerch,
    inAsh() { return burn.standing; },
    instance() { return inst; },
    /** Force a phase, for checks about a phase rather than about how
     *  the animal gets into one - see the Coulter's own hook. */
    forcePhase(phase, timer) {
      if (!inst) return null;
      const next = String(phase);
      state.phase = next;
      if (Number.isFinite(timer)) state.timer = timer;
      setEncounterGate(next === "dormant", next === "dormant" || next === "alert");
      if (next === "stoke") {
        inst.grounded = true;
        inst.y = groundAt(inst.x, inst.z) + C.landedLift;
        // The real pose, not whatever clip was last playing - a QA
        // force is a claim about the phase, chains drawn up included.
        enemies.play(inst, "stoke", 0.2);
        enemies.play(inst, "stoke", 0);
      } else if (next === "soar") {
        inst.grounded = false;
        inst.y = cruiseY(inst.x, inst.z);
        // A forced soar needs fuel, or it lands again on the next
        // frame and the check that forced it never sees the phase.
        state.fuel = Number.isFinite(timer) ? timer : C.soarSeconds;
        enemies.play(inst, "idle", 0);
      }
      return { phase: state.phase, timer: state.timer };
    },
    dispose() { scene.remove(group); },
  };
}
