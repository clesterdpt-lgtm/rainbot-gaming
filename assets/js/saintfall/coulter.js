/* ============================================================
   SAINTFALL - the Coulter

   The burrowing boss, and everything about it that is not geometry:
   how it hunts under the sand, how it comes out, what it spits, and
   what standing in that does to you.

   WHY THIS IS ITS OWN MODULE

   combat.js is a four-state machine driven by distance and line of
   sight, and it is the right shape for every walker in the game: they
   are always visible, always hittable, and always either closing or
   shooting. None of that is true here. This animal is INVULNERABLE
   for most of its cycle because it is eight metres underground, it has
   a trail of its own past positions instead of a position, and it
   spawns hazards that outlive it. Bolting those onto `stepEnemy` would
   have put four `if (key === "coulter")` branches into the file every
   other enemy depends on.

   So combat.js keeps what it is authoritative about - hit volumes,
   damage, the player's health - and hands the behaviour of anything
   with a body chain to this module.

   THE CYCLE IS THE ENCOUNTER

     BURROW   4-8s. Untouchable. A ridge of displaced sand crossing
              the basin toward the player, and nothing else. The player
              cannot fight this phase, only read it and move.
     RISE     1.4s. It erupts where the ridge was, hitting anything
              standing on it, and rears eleven metres of body out of
              the ground.
     CREST    9.5s. THE FIGHT. Anchored, reared, and hittable - it
              bites what is close and spits venom at what is not, and
              the mouth it does both with is the weak point.
     DIVE     It goes back down through its own hole and the venom it
              left stays where it landed.

   Every number in COULTER_CONFIG below is in service of one property:
   the player must never be punished for a phase they could not read.
   The wake is visible for seconds before the eruption, the eruption is
   avoidable by moving off the ridge, and the spew is telegraphed by
   the sacs filling and the mouth opening green.
   ============================================================ */

import { TAU, clamp, clamp01, damp, dampAngle, lerp, makeBus } from "saintfall/core.js";
import { patchMaterial } from "saintfall/art.js";
import { SURVIVAL_CONFIG } from "saintfall/combat.js";

export const COULTER_CONFIG = Object.freeze({
  /* Deep enough that the body is unambiguously gone - a worm you can
     see the top of is a worm the player will try to shoot - and
     shallow enough that the ridge it pushes up is a strong read. */
  burrowDepth: 5.6,
  /* The submerged window, and the difficulty curve. It is the only
     value the boss escalates on, because it is the one the player
     feels: a wounded Coulter gives you less time to reposition
     between surfacings, rather than more health to chew through. */
  huntSecondsMax: 8.0,
  huntSecondsMin: 4.2,
  /* How close it gets before it commits to coming up. Well inside the
     bite reach on purpose: the eruption should land beside the player,
     not politely across the arena. */
  /* Where it commits, and it is tuned against the ARC below rather than
     chosen: the rise carries the head about eighteen metres forward, so
     committing at this range puts the mouth over the player rather than
     leaving it towering politely in the middle distance. */
  riseRange: 22,
  riseSeconds: 1.95,
  riseSpeed: 12.5,
  /* How high the head has to get before the rise is called done. Raised
     from 7.2 with the arc: the animal was cutting its own eruption short
     and standing up like a post, with three vertebrae out of the sand
     and the rest of the body buried directly underneath them. */
  riseClearance: 10.8,
  crestSeconds: 9.5,
  diveSpeed: 14.0,
  diveDepth: 7.0,
  turnRate: { burrow: 0.95, rise: 0.35, crest: 1.15, dive: 0.45 },
  /* The eruption. Survivable at full health and only just - it is the
     price of ignoring a ridge of sand travelling toward you. */
  breachDamage: 42,
  breachRadius: 6.4,
  breachKnock: 13,
  biteDamage: 56,
  biteReach: 9.4,
  biteCadence: 2.05,
  /* The contact frame of the `strike` clip. Authored at frame 10 of
     32 - see the Blender script - so the damage lands as the petals
     close rather than as they open. */
  biteContact: 0.17,
  /* The launch frame of the `spew` clip, likewise a contract with the
     model: frame 18 of 54. */
  spewLaunch: 0.30,
  spewCadence: 2.9,
  spewGlobules: 3,
  spewSpeed: 27,
  spewSpread: 0.085,
  spewDirect: 16,
  spewsPerCrest: [2, 4],
  poolRadius: 4.4,
  poolSeconds: 9.0,
  poolMax: 12,
  /* Venom is not burst damage, it is a DENIAL. Standing in a pool for
     a full second costs less than a Thresher's swipe; standing in one
     because you did not notice it costs the fight. */
  toxinRise: 0.66,
  toxinDecay: 0.20,
  toxinDps: 9.5,
  toxinTick: 0.5,
  /* Simulated far past combat.js's own 240m horizon. It is a landmark
     with a wake, and a boss that stops moving because the player
     walked away is a boss that is never where they left it. */
  simRange: 520,
});

const GLOBULES = 18;
const VENOM_COLOUR = "#4f7a12";
const VENOM_EMISSIVE = "#b8f23e";

export function buildCoulter(ctx) {
  const { THREE, scene, atmos, enemies } = ctx;
  const bus = makeBus();
  const C = COULTER_CONFIG;
  const groundAt = (x, z) => (ctx.collide
    ? ctx.collide.groundHeight(x, z)
    : ctx.terrain.heightAt(x, z));

  const group = new THREE.Group();
  group.name = "coulter-venom";
  group.matrixWorldAutoUpdate = true;
  scene.add(group);

  /* ============================================================
     THE WAKE

     What the player actually fights for two thirds of the cycle. It
     has to say three things at once - where the animal is, which way
     it is going, and how fast - from any distance, with nothing above
     the sand to say them with.

     A mound alone says the first. The spray off its leading edge says
     the other two, which is why it is not decoration: a ridge with no
     spray reads as a static lump of terrain and the player does not
     understand they are being chased.
     ============================================================ */
  const wakeGeo = new THREE.SphereGeometry(1, 13, 7);
  /* Sand, and only just darker than the sand it is made of. The first
     pass used a saturated mid-brown, which at any distance read as a
     boat hull parked on a dune rather than as ground being pushed up
     from underneath - a foreign object, and the eye files foreign
     objects as scenery. Freshly turned sand is the same colour with the
     ripples knocked off it, so what has to carry the read is the SHAPE
     and the spray, not the tint. */
  const wakeMat = new THREE.MeshStandardMaterial({
    color: 0xe0ad74,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  wakeMat.name = "sf-coulter-wake";
  patchMaterial(wakeMat, atmos, { rim: 0.35, glitter: 0.55 });
  // The crest line: a thin dark wedge along the top of the ridge, which
  // is the shadow a real furrow's lip throws down its own flank.
  const ridgeGeo = new THREE.ConeGeometry(0.5, 1, 4, 1);
  const ridgeMat = new THREE.MeshStandardMaterial({
    color: 0xc78c56,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  ridgeMat.name = "sf-coulter-ridge";
  patchMaterial(ridgeMat, atmos, { rim: 0.2, glitter: 0 });

  const wakes = new Map();

  function wakeFor(inst) {
    let rig = wakes.get(inst.id);
    if (rig) return rig;
    const root = new THREE.Group();
    root.name = `sf-wake-${inst.id}`;
    const mound = new THREE.Mesh(wakeGeo, wakeMat);
    /* SUNK DEEP AND SCALED BIG, which is the whole trick.
       An ellipsoid intersecting the ground shows a hard-edged ellipse
       where it cuts, and the smaller the exposed cap the harder that
       edge reads. Sinking a much larger body so that only its top sixth
       is above the sand gives a swell fourteen metres long and five
       across whose crest is barely a metre proud - a shape the eye reads
       as ground rather than as an object sitting on it. */
    mound.position.y = -2.9;
    mound.scale.set(2.9, 3.5, 7.2);
    mound.castShadow = false;
    mound.receiveShadow = true;
    const crack = new THREE.Mesh(ridgeGeo, ridgeMat);
    crack.rotation.x = Math.PI;
    crack.position.y = 0.34;
    crack.scale.set(0.44, 0.44, 6.8);
    root.add(mound, crack);
    root.visible = false;
    group.add(root);
    rig = { root, mound, crack, spray: 0, rumble: 0 };
    wakes.set(inst.id, rig);
    return rig;
  }

  function hideWake(inst) {
    const rig = wakes.get(inst.id);
    if (rig) rig.root.visible = false;
  }

  function disposeWake(id) {
    const rig = wakes.get(id);
    if (!rig) return;
    group.remove(rig.root);
    wakes.delete(id);
  }

  /* ============================================================
     GLOBULES

     A travelling ballistic projectile, distinct from the Gleaner's
     straight swept bolt. Venom has to arc and actually fly, because the
     whole point of it is that it can be walked out from under - a
     hitscan spew would just be a stronger Gleaner attack.
     ============================================================ */
  const globuleGeo = new THREE.IcosahedronGeometry(0.42, 1);
  const globuleMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(VENOM_COLOUR),
    emissive: new THREE.Color(VENOM_EMISSIVE),
    emissiveIntensity: 1.55,
    roughness: 0.34,
    metalness: 0,
    flatShading: true,
  });
  globuleMat.name = "sf-venom-globule";
  patchMaterial(globuleMat, atmos, { rim: 0.55, glitter: 0 });

  const globules = [];
  for (let i = 0; i < GLOBULES; i += 1) {
    const mesh = new THREE.Mesh(globuleGeo, globuleMat);
    mesh.visible = false;
    mesh.castShadow = false;
    group.add(mesh);
    globules.push({
      mesh, live: false, life: 0,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, scale: 1,
    });
  }
  let globuleCursor = 0;

  function launchGlobule(x, y, z, vx, vy, vz, scale = 1) {
    const g = globules[globuleCursor];
    globuleCursor = (globuleCursor + 1) % GLOBULES;
    g.live = true;
    g.life = 4.5;
    g.x = x; g.y = y; g.z = z;
    g.vx = vx; g.vy = vy; g.vz = vz;
    g.scale = scale;
    g.spin = (Math.random() - 0.5) * 9;
    g.mesh.position.set(x, y, z);
    g.mesh.scale.setScalar(scale);
    g.mesh.visible = true;
    return g;
  }

  /* ============================================================
     POOLS

     The hazard that outlives the animal. Pooled meshes rather than
     allocated ones, and each one's geometry is REWRITTEN on landing so
     its rim sits on the sand it actually landed on - a flat disc laid
     across a dune slip face is half buried and half floating, which
     reads as a decal from a different game.
     ============================================================ */
  const POOL_RINGS = 3;
  const POOL_SIDES = 22;
  const POOL_VERTS = 1 + POOL_RINGS * POOL_SIDES;

  const poolVertex = /* glsl */`
    attribute float aRadial;
    varying float vRadial;
    varying vec3 vWorld;
    void main() {
      vRadial = aRadial;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;
  /* NOT ADDITIVE, and that is the whole difference between this reading
     as venom and reading as a light on the floor.

     The first version added bright green to the ground, which on lit
     orange sand mostly cancels: the pool came out as a pale wash you
     had to be told about. A liquid on sand is DARKER than the sand -
     it soaks in - so the bed is drawn as a dark stain over the top with
     ordinary alpha, and only the creeping rim is bright. Darkening is
     something additive blending cannot do at any intensity. */
  const poolFragment = /* glsl */`
    precision highp float;
    uniform vec3 uCore;
    uniform vec3 uEdge;
    uniform vec3 uBed;
    uniform float uFade;
    uniform float uTime;
    varying float vRadial;
    varying vec3 vWorld;
    void main() {
      float r = clamp(vRadial, 0.0, 1.0);
      // A soaked bed, a bright creeping rim, and a slow crawl outward so
      // the pool reads as spreading rather than as painted on.
      float bed = 1.0 - smoothstep(0.42, 1.0, r);
      float crawl = 0.55 + 0.45 * sin(uTime * 1.6 - r * 6.0);
      float rim = smoothstep(0.48, 0.88, r) * (1.0 - smoothstep(0.88, 1.0, r));
      vec3 c = mix(uBed, uEdge, bed * 0.6);
      c = mix(c, uCore, clamp(rim * crawl * 1.6, 0.0, 1.0));
      // Faded with distance so a pool two districts away does not draw a
      // hard green disc through the aerial perspective everything else
      // obeys.
      float dist = length(cameraPosition - vWorld);
      float far = 1.0 - smoothstep(180.0, 300.0, dist);
      float a = (bed * 0.74 + rim * 0.86) * uFade * far;
      if (a < 0.006) discard;
      gl_FragColor = vec4(c, clamp(a, 0.0, 0.94));
    }
  `;

  const pools = [];
  for (let i = 0; i < C.poolMax; i += 1) {
    const geo = new THREE.BufferGeometry();
    const position = new Float32Array(POOL_VERTS * 3);
    const radial = new Float32Array(POOL_VERTS);
    const index = [];
    for (let s = 0; s < POOL_SIDES; s += 1) {
      const n = (s + 1) % POOL_SIDES;
      index.push(0, 1 + s, 1 + n);
      for (let r = 0; r < POOL_RINGS - 1; r += 1) {
        const a0 = 1 + r * POOL_SIDES + s;
        const a1 = 1 + r * POOL_SIDES + n;
        const b0 = 1 + (r + 1) * POOL_SIDES + s;
        const b1 = 1 + (r + 1) * POOL_SIDES + n;
        index.push(a0, b0, b1, a0, b1, a1);
      }
    }
    for (let r = 0; r < POOL_RINGS; r += 1) {
      const t = (r + 1) / POOL_RINGS;
      for (let s = 0; s < POOL_SIDES; s += 1) radial[1 + r * POOL_SIDES + s] = t;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("aRadial", new THREE.BufferAttribute(radial, 1));
    geo.setIndex(index);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uCore: { value: new THREE.Color(VENOM_EMISSIVE) },
        uEdge: { value: new THREE.Color("#5c8f14") },
        uBed: { value: new THREE.Color("#15250a") },
        uFade: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: poolVertex,
      fragmentShader: poolFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `sf-venom-pool-${i}`;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 5;
    group.add(mesh);
    pools.push({
      mesh, mat, position, life: 0, span: 1, x: 0, y: 0, z: 0,
      radius: C.poolRadius, gas: 0,
    });
  }
  let poolCursor = 0;

  function spillPool(x, z, radius = C.poolRadius, seconds = C.poolSeconds) {
    const pool = pools[poolCursor];
    poolCursor = (poolCursor + 1) % pools.length;
    const y = groundAt(x, z);
    pool.x = x; pool.y = y; pool.z = z;
    pool.radius = radius;
    pool.span = seconds;
    pool.life = seconds;
    pool.gas = 0;
    const p = pool.position;
    p[0] = 0; p[1] = 0.09; p[2] = 0;
    for (let r = 0; r < POOL_RINGS; r += 1) {
      const rr = radius * ((r + 1) / POOL_RINGS);
      for (let s = 0; s < POOL_SIDES; s += 1) {
        const a = (s / POOL_SIDES) * TAU + r * 0.14;
        // Wobbled, so a pool is never a circle. A circle is a decal.
        const wob = 1 - 0.13 * Math.sin(a * 3 + r * 1.7) - 0.07 * Math.cos(a * 5);
        const px = Math.cos(a) * rr * wob;
        const pz = Math.sin(a) * rr * wob;
        const i = (1 + r * POOL_SIDES + s) * 3;
        p[i] = px;
        // Every rim vertex put on the sand under it. This is the whole
        // difference between a puddle and a sticker.
        p[i + 1] = groundAt(x + px, z + pz) - y + 0.085;
        p[i + 2] = pz;
      }
    }
    pool.mesh.position.set(x, y, z);
    pool.mesh.geometry.attributes.position.needsUpdate = true;
    pool.mesh.geometry.computeBoundingSphere();
    pool.mesh.visible = true;
    ctx.vfx?.venomBurst?.(x, y + 0.35, z, radius * 0.42);
    bus.emit("spill", { x, y, z, radius });
    return pool;
  }

  /* ============================================================
     THE PLAYER'S PROBLEM

     Venom is tracked as one scalar that fills while standing in it and
     drains slowly afterwards, and the damage is applied in HALF-SECOND
     TICKS rather than per frame. Per frame is the obvious way and it
     is wrong twice: it fires the hurt bus sixty times a second, so the
     audio layer stutters a wince every frame, and it makes the number
     the player sees depend on their frame rate.
     ============================================================ */
  const toxin = { level: 0, tick: 0, inPool: false, source: null };

  function poolAt(x, y, z) {
    for (const pool of pools) {
      if (pool.life <= 0) continue;
      const dx = x - pool.x;
      const dz = z - pool.z;
      if (dx * dx + dz * dz > pool.radius * pool.radius) continue;
      // Standing on a roof above a pool is not standing in it.
      if (Math.abs(y - pool.y) > 3.4) continue;
      return pool;
    }
    return null;
  }

  function updateToxin(dt) {
    const combat = ctx.combat;
    const ps = ctx.player?.state;
    if (!combat || !ps) return;
    const standing = combat.player.dead ? null : poolAt(ps.x, ps.y, ps.z);
    toxin.inPool = !!standing;
    if (standing) {
      if (toxin.level <= 0.001) bus.emit("poisoned", { x: ps.x, z: ps.z });
      toxin.level = clamp01(toxin.level + dt * C.toxinRise);
    } else {
      toxin.level = Math.max(0, toxin.level - dt * C.toxinDecay);
    }
    if (toxin.level <= 0) { toxin.tick = 0; return; }
    toxin.tick += dt;
    if (toxin.tick < C.toxinTick) return;
    const seconds = toxin.tick;
    toxin.tick = 0;
    combat.hurtPlayer(C.toxinDps * toxin.level * seconds, {
      source: "venom",
      x: ps.x,
      y: ps.y + 1.0,
      z: ps.z,
    });
  }

  /** A direct hit, which is worth a fifth of a pool's worth of toxin
   *  on its own so that dodging the globules matters. */
  function splash(x, y, z, direct) {
    if (direct && ctx.combat) {
      ctx.combat.hurtPlayer(C.spewDirect * SURVIVAL_CONFIG.enemyDamageMultiplier, {
        source: "venom-globule", x, y, z,
      });
      toxin.level = clamp01(toxin.level + 0.34);
    }
    spillPool(x, z, C.poolRadius * (direct ? 0.82 : 1));
  }

  /* ============================================================
     BEHAVIOUR
     ============================================================ */

  function headTarget() {
    const ps = ctx.player.state;
    return { x: ps.x, y: ps.y + 1.1, z: ps.z };
  }

  /** Advance the head along its heading. */
  function travel(inst, dt, speed) {
    const b = inst.body;
    const cp = Math.cos(b.pitch);
    b.dir.set(Math.sin(b.heading) * cp, Math.sin(b.pitch), Math.cos(b.heading) * cp);
    b.head.addScaledVector(b.dir, speed * dt);
    b.head.x = clamp(b.head.x, -955, 955);
    b.head.z = clamp(b.head.z, -955, 955);
  }

  /**
   * THE TRAIL. Called once per frame, AFTER every other thing that can
   * move the head.
   *
   * Each sample carries its distance behind the head, and that distance
   * is bumped by how far the head ACTUALLY moved this frame - measured
   * from its previous position rather than taken from the travel speed.
   * Those two numbers are not the same and the difference is a real bug
   * with a very confusing signature: the crest phase also lifts the head
   * out of the sand, and a version of this that trusted `speed * dt`
   * recorded a hundredth of a metre of arc for most of a metre of real
   * movement. The body was then sampled at arc lengths that no longer
   * matched the path, so consecutive vertebrae ended up nine metres
   * apart and the animal came out as a row of disconnected chunks.
   *
   * New samples are only laid every 0.9m. Denser is wasted - the body is
   * sampled at 1.72m intervals - and sparser lets a hard turn cut a
   * corner the body then visibly straightens out.
   */
  function layTrail(inst) {
    const b = inst.body;
    const trail = b.trail;
    const moved = Math.hypot(b.head.x - b.prev.x, b.head.y - b.prev.y,
      b.head.z - b.prev.z);
    b.prev.copy(b.head);
    if (moved > 1e-6) {
      for (let i = 0; i < trail.length; i += 1) trail[i].d += moved;
    }
    /* Laid, never moved. A sample records where the head WAS, and the
       gap between the newest sample and the head is covered by the
       sampler, which anchors on the live head position - see
       `trailAt`. */
    if (!trail.length || trail[0].d >= 0.9) {
      trail.unshift({ x: b.head.x, y: b.head.y, z: b.head.z, d: 0 });
    }
    // Keep just enough tail to lay the body along, plus a margin.
    const keep = inst.spineLength + 4;
    while (trail.length > 4 && trail[trail.length - 2].d > keep) trail.pop();
  }

  /** Is every part of the animal under the sand? */
  function submergedFully(inst) {
    const b = inst.body;
    const surface = groundAt(b.head.x, b.head.z);
    if (b.head.y > surface - 1.2) return false;
    for (const joint of b.joints) {
      if (joint.y > groundAt(joint.x, joint.z) - 1.2) return false;
    }
    return true;
  }

  function setPhase(inst, phase, seconds) {
    const b = inst.body;
    b.phase = phase;
    b.timer = seconds;
    return b;
  }

  function huntSeconds(inst) {
    // The one place the boss escalates: a wounded Coulter gives the
    // player less time between surfacings, not more health.
    const hurt = 1 - clamp01(inst.health / Math.max(1, inst.maxHealth));
    return lerp(C.huntSecondsMax, C.huntSecondsMin, hurt);
  }

  function stepBurrow(inst, dt, target) {
    const b = inst.body;
    b.hidden = submergedFully(inst);
    b.mawOpen = 0;
    if (inst.state !== "idle" && inst.state !== "alert") enemies.play(inst, "idle", 0.4);

    const dx = target.x - b.head.x;
    const dz = target.z - b.head.z;
    const dist = Math.hypot(dx, dz);
    b.heading = dampAngle(b.heading, Math.atan2(dx, dz), C.turnRate.burrow, dt);

    /* Depth autopilot: aim the head at where the floor will be a few
       metres ahead, rather than at where it is now. Chasing the
       current height makes the animal climb dune faces in steps; a
       lookahead makes it swim. */
    const ahead = 11;
    const wantY = groundAt(b.head.x + Math.sin(b.heading) * ahead,
      b.head.z + Math.cos(b.heading) * ahead) - C.burrowDepth;
    b.pitch = clamp(Math.atan2(wantY - b.head.y, ahead), -0.5, 0.5);
    travel(inst, dt, inst.spec.speed.charge);

    // Floored rather than left to run away negative: a timer at -400
    // is a save file that fails validation, and "ready" is a state
    // rather than a quantity.
    b.timer = Math.max(-1, b.timer - dt);
    if (b.timer <= 0 && dist < C.riseRange) {
      /* Commit. The heading is snapped at the player on the way up so
         the eruption arrives facing them - a worm that surfaces
         side-on has to spend its whole crest turning. */
      b.heading = Math.atan2(dx, dz);
      setPhase(inst, "rise", C.riseSeconds);
      b.spewsLeft = Math.round(lerp(C.spewsPerCrest[0], C.spewsPerCrest[1],
        1 - clamp01(inst.health / Math.max(1, inst.maxHealth))));
      b.hidden = false;
      breach(inst);
    }
  }

  /** The eruption, resolved at the moment it starts. */
  function breach(inst) {
    const b = inst.body;
    const surface = groundAt(b.head.x, b.head.z);
    const combat = ctx.combat;
    enemies.play(inst, "alert", 0.08);
    ctx.vfx?.breach?.(b.head.x, surface, b.head.z, C.breachRadius * 1.5, 2.2);
    ctx.vfx?.sandSpray?.(b.head.x, surface + 0.4, b.head.z, 2.6,
      Math.sin(b.heading), Math.cos(b.heading));
    bus.emit("breach", { x: b.head.x, y: surface, z: b.head.z, id: inst.id });

    const ps = ctx.player?.state;
    if (!combat || !ps || combat.player.dead) return;
    const d = Math.hypot(ps.x - b.head.x, ps.z - b.head.z);
    if (d > C.breachRadius) return;
    /* Falls off to nothing at the rim, so being caught by the edge of
       an eruption is a warning and being caught by the middle of it is
       most of a life. */
    const falloff = 1 - 0.55 * (d / C.breachRadius);
    combat.hurtPlayer(C.breachDamage * falloff * SURVIVAL_CONFIG.enemyDamageMultiplier
      * (Number.isFinite(inst.damageScale) ? inst.damageScale : 1), {
      source: "coulter-breach",
      x: b.head.x, y: surface + 1.5, z: b.head.z, enemy: inst.key,
    });
    ctx.player.punch?.(1.6);
  }

  function stepRise(inst, dt, target) {
    const b = inst.body;
    b.hidden = false;
    const t = 1 - clamp01(b.timer / C.riseSeconds);
    /* THE PITCH CURVE IS THE ARC, because the body is laid along the
       path the head took. Three stages, and each one is answering
       something a review frame showed:

         BREAK OUT, steeply, for the first third. It starts 5.6m under
         the sand and every metre of path spent underground is a metre
         of body that will not be visible, so the fastest way out is up.

         FLATTEN through the middle. This is where the arch is made: the
         head keeps climbing but the path turns over, so what follows it
         out of the ground is a CURVE. A constant pitch here gave a
         straight ramp - a submarine surfacing - and finishing the rise
         steep gave a black post standing in a dune with the whole
         animal buried under it.

         LEVEL at the top, so the last few metres of travel carry the
         head forward over the player rather than further up away from
         them. Nine metres of clearance is a landmark; fifteen is a
         creature the player cannot shoot. */
    b.pitch = t < 0.34
      ? lerp(0.62, 1.22, t / 0.34)
      : t < 0.72
        ? lerp(1.22, 0.44, (t - 0.34) / 0.38)
        : lerp(0.44, 0.06, (t - 0.72) / 0.28);
    const dx = target.x - b.head.x;
    const dz = target.z - b.head.z;
    b.heading = dampAngle(b.heading, Math.atan2(dx, dz), C.turnRate.rise, dt);
    travel(inst, dt, C.riseSpeed);
    b.mawOpen = clamp01(t * 1.6) * 0.45;

    const clearance = b.head.y - groundAt(b.head.x, b.head.z);
    b.timer -= dt;
    if (b.timer <= 0 || clearance > C.riseClearance) {
      setPhase(inst, "crest", C.crestSeconds);
      b.surfacings += 1;
      b.fireTimer = 0.55;
      bus.emit("crest", { x: b.head.x, y: b.head.y, z: b.head.z, id: inst.id });
    }
  }

  function stepCrest(inst, dt, target) {
    const b = inst.body;
    b.hidden = false;
    b.timer -= dt;

    /* Reared and anchored. It creeps rather than freezing, because a
       boss that is exactly still for nine seconds looks like the
       simulation stopped - but the creep is slow enough that the arc
       it came up in is preserved, which is what makes it read as
       standing rather than as swimming through the air. */
    const dx = target.x - b.head.x;
    const dz = target.z - b.head.z;
    const flat = Math.hypot(dx, dz);
    b.heading = dampAngle(b.heading, Math.atan2(dx, dz), C.turnRate.crest, dt);
    /* Crane over toward the player: pitch down as they get closer, so
       the animal is looking AT them rather than at the horizon. The
       floor of the clamp is steep enough to reach a player standing
       directly under a nine-metre head - anything shallower and the
       most dangerous place to stand is also the one place the mouth
       cannot point. */
    const wantPitch = clamp(Math.atan2(target.y - b.head.y, Math.max(3, flat)),
      -0.95, 0.30);
    b.pitch = damp(b.pitch, wantPitch, 2.4, dt);
    travel(inst, dt, inst.spec.speed.walk * 0.24);

    // Keep the head out of the sand: a crane-down that drives the
    // mouth into a dune would bury the weak point.
    const floor = groundAt(b.head.x, b.head.z) + 3.4;
    if (b.head.y < floor) b.head.y = damp(b.head.y, floor, 6, dt);

    b.fireTimer = (b.fireTimer || 0) - dt;
    b.action = Math.max(0, (b.action || 0) - dt);

    if (b.action > 0) {
      // Mid-attack: the clip owns the mouth, so only the pending
      // damage/launch beat is resolved here.
      resolveAction(inst, dt, target);
    } else if (b.fireTimer <= 0) {
      const vertical = Math.abs(target.y - b.head.y);
      if (flat < C.biteReach && vertical < 11) beginBite(inst);
      else if (b.spewsLeft > 0) beginSpew(inst, target);
      else b.fireTimer = 0.6;
    }

    if (b.timer <= 0 && b.action <= 0) {
      setPhase(inst, "dive", 6);
      enemies.play(inst, "idle", 0.3);
      bus.emit("dive", { x: b.head.x, y: b.head.y, z: b.head.z, id: inst.id });
    }
    /* The maw's opening is read off the clip's own progress rather than
       tracked separately: it is what gates the weak point, so a
       divergence between "the mouth looks open" and "the mouth counts
       as open" would be the single most unfair bug this fight could
       have. */
    b.mawOpen = mawFromClip(inst);
  }

  function mawFromClip(inst) {
    const b = inst.body;
    if (!b.action || !b.actionKind) return inst.state === "alert" ? 0.34 : 0.12;
    const spec = b.actionKind === "spew"
      ? { total: 0.90, peak: C.spewLaunch }
      : { total: 0.53, peak: C.biteContact };
    const elapsed = spec.total - b.action;
    if (elapsed < 0) return 0.12;
    // Up to the contact frame, then shut.
    return elapsed < spec.peak
      ? clamp01(elapsed / Math.max(0.05, spec.peak))
      : clamp01(1 - (elapsed - spec.peak) / Math.max(0.05, spec.total - spec.peak));
  }

  function beginBite(inst) {
    const b = inst.body;
    enemies.play(inst, "strike", 0.08);
    b.action = 0.53;
    b.actionKind = "bite";
    b.pending = C.biteContact;
    b.fireTimer = C.biteCadence;
    bus.emit("bite", { x: b.head.x, y: b.head.y, z: b.head.z, id: inst.id });
  }

  function beginSpew(inst, target) {
    const b = inst.body;
    enemies.play(inst, "spew", 0.1);
    b.action = 0.90;
    b.actionKind = "spew";
    b.pending = C.spewLaunch;
    b.spewsLeft -= 1;
    b.fireTimer = C.spewCadence;
    b.aim = { x: target.x, y: target.y, z: target.z };
  }

  function resolveAction(inst, dt, target) {
    const b = inst.body;
    if (!(b.pending > 0)) return;
    b.pending -= dt;
    if (b.pending > 0) return;
    b.pending = 0;
    if (b.actionKind === "bite") landBite(inst, target);
    else launchSpew(inst);
  }

  function landBite(inst, target) {
    const b = inst.body;
    const combat = ctx.combat;
    if (!combat || combat.player.dead) return;
    const flat = Math.hypot(target.x - b.head.x, target.z - b.head.z);
    // Re-tested at the contact frame, not at the wind-up: the mouth
    // closing on where the player WAS is what makes backing out of
    // reach a real answer.
    if (flat > C.biteReach + 1.6 || Math.abs(target.y - b.head.y) > 12) {
      bus.emit("biteMiss", { x: b.head.x, z: b.head.z });
      return;
    }
    combat.hurtPlayer(C.biteDamage * SURVIVAL_CONFIG.enemyDamageMultiplier
      * (Number.isFinite(inst.damageScale) ? inst.damageScale : 1), {
      source: "coulter-bite",
      x: b.head.x, y: b.head.y, z: b.head.z, enemy: inst.key,
    });
    ctx.player.punch?.(1.35);
  }

  /** Throw the clutch of globules the sacs have been filling for. */
  function launchSpew(inst) {
    const b = inst.body;
    const aim = b.aim || headTarget(inst);
    // Out of the mouth, not out of the origin: the mouth is 1.5m in
    // front of the head joint and it is where the player is looking.
    const cp = Math.cos(b.pitch);
    const mx = b.head.x + Math.sin(b.heading) * cp * 1.5;
    const my = b.head.y + Math.sin(b.pitch) * 1.5;
    const mz = b.head.z + Math.cos(b.heading) * cp * 1.5;
    const count = C.spewGlobules;
    for (let i = 0; i < count; i += 1) {
      const spread = count > 1 ? (i / (count - 1) - 0.5) * 2 : 0;
      const tx = aim.x + spread * 3.6;
      const tz = aim.z + spread * 2.4;
      const v = ballistic(mx, my, mz, tx, aim.y, tz, C.spewSpeed);
      launchGlobule(mx, my, mz,
        v.x + (Math.random() - 0.5) * C.spewSpread * C.spewSpeed,
        v.y + (Math.random() - 0.5) * C.spewSpread * C.spewSpeed,
        v.z + (Math.random() - 0.5) * C.spewSpread * C.spewSpeed,
        0.85 + Math.random() * 0.4);
    }
    ctx.vfx?.venomBurst?.(mx, my, mz, 1.5);
    bus.emit("spew", { x: mx, y: my, z: mz, id: inst.id, count });
  }

  /**
   * A lobbed solution, falling back to a flat one.
   *
   * The low-arc root of the ballistic equation, because a mortar arc
   * over a nine-metre-tall animal takes three seconds to arrive and
   * the player has walked out of it. When the target is out of range
   * for any arc the shot is thrown flat and short, which reads as the
   * animal trying and failing rather than as it declining to fire.
   */
  function ballistic(x, y, z, tx, ty, tz, speed) {
    const dx = tx - x;
    const dz = tz - z;
    const flat = Math.hypot(dx, dz) || 1e-4;
    const dy = ty - y;
    const g = 22;
    const s2 = speed * speed;
    const root = s2 * s2 - g * (g * flat * flat + 2 * dy * s2);
    const ux = dx / flat;
    const uz = dz / flat;
    if (root < 0) {
      const pitch = 0.42;
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

  function stepDive(inst, dt, target) {
    const b = inst.body;
    b.mawOpen = 0;
    const dx = target.x - b.head.x;
    const dz = target.z - b.head.z;
    b.heading = dampAngle(b.heading, Math.atan2(dx, dz), C.turnRate.dive, dt);
    b.pitch = damp(b.pitch, -0.92, 3.2, dt);
    travel(inst, dt, C.diveSpeed);
    b.timer -= dt;

    const surface = groundAt(b.head.x, b.head.z);
    const under = surface - b.head.y;
    if (under > C.diveDepth && submergedFully(inst)) {
      b.hidden = true;
      setPhase(inst, "burrow", huntSeconds(inst));
    } else if (b.timer <= 0) {
      // Failsafe: a dive that cannot finish - wedged against masonry,
      // or driven into a ceiling - must not strand the boss half out
      // of the ground where it can be shot with impunity.
      b.head.y = surface - C.diveDepth - 1;
      b.hidden = true;
      setPhase(inst, "burrow", huntSeconds(inst));
    } else {
      b.hidden = submergedFully(inst);
    }
  }

  /**
   * Going limp.
   *
   * The clips deliberately do not own the body - see the Blender
   * script - so this is what death looks like: the trail itself falls.
   * Each sample sinks toward the sand under it, which drops whatever
   * arc the animal happened to be in at the moment it died instead of
   * snapping it back to a straight bind pose first. A twenty-five
   * metre body reared eight metres out of the ground has to be able to
   * FALL, and nothing baked can do that.
   */
  function stepDeath(inst, dt) {
    const b = inst.body;
    if (!b.trail.length) return;
    if (b.phase !== "dead") {
      b.phase = "dead";
      b.timer = 0;
      b.hidden = false;
      b.mawOpen = 0.8;
      hideWake(inst);
    }
    b.timer += dt;
    const settle = Math.min(1, b.timer * 0.5);
    for (const sample of b.trail) {
      const rest = groundAt(sample.x, sample.z) + 0.55;
      if (sample.y > rest) {
        sample.y = damp(sample.y, rest, 1.1 + settle * 2.2, dt);
      } else {
        // And then it sinks. The sand takes it back, slowly, which is
        // also how the corpse leaves without being deleted on screen.
        sample.y = damp(sample.y, rest - 2.4, 0.16, dt);
      }
    }
    b.head.set(b.trail[0].x, b.trail[0].y, b.trail[0].z);
    b.prev.copy(b.head);
    b.pitch = damp(b.pitch, -0.15, 0.8, dt);
    const cp = Math.cos(b.pitch);
    b.dir.set(Math.sin(b.heading) * cp, Math.sin(b.pitch), Math.cos(b.heading) * cp);
    enemies.poseBody(inst);
  }

  /* ============================================================
     PER-FRAME
     ============================================================ */

  function stepInstance(inst, dt) {
    const b = inst.body;
    if (!b) return;
    /* Parked: the pose is still resolved from the trail, but nothing
       decides anything. Set only by review harnesses, which need the
       animal to hold a pose for a photograph - a boss that swims out of
       frame between two camera moves cannot be reviewed. */
    if (b.parked) {
      layTrail(inst);
      enemies.poseBody(inst);
      // Both still answered honestly, or a parked animal keeps whatever
      // it had when it stopped: spawned underground it stays flagged as
      // buried and renders as nothing at all, and its wake stays sitting
      // on the sand somewhere it no longer is.
      b.hidden = submergedFully(inst);
      updateWake(inst, dt);
      return;
    }
    if (inst.state === "death") { stepDeath(inst, dt); return; }
    if (inst.stunTime > 0) {
      /* A slam can stagger it, and while it is staggered it holds
         position - but it does NOT hold its breath: a stunned animal
         underground would otherwise be a boss the player can freeze
         out of the fight entirely by timing a slam on the wake. */
      inst.stunTime = Math.max(0, inst.stunTime - dt);
      if (b.phase === "crest") {
        b.timer = Math.max(b.timer, 0.6);
        enemies.poseBody(inst);
        return;
      }
    }

    const target = headTarget(inst);
    if (b.phase === "rise") stepRise(inst, dt, target);
    else if (b.phase === "crest") stepCrest(inst, dt, target);
    else if (b.phase === "dive") stepDive(inst, dt, target);
    else stepBurrow(inst, dt, target);

    /* Where the walkers keep their (x, z). Combat's hit capsules, the
       HUD's mini-map and the stow-the-weapon threat check all read
       those fields on every enemy, so the burrower keeps them honest by
       mirroring its head into them rather than by every one of those
       systems learning what a body chain is. */
    inst.x = b.head.x;
    inst.z = b.head.z;
    inst.y = b.head.y;
    inst.yaw = b.heading;
    inst.alerted = true;
    inst.suspicion = 1;
    layTrail(inst);
    enemies.poseBody(inst);
    updateWake(inst, dt);
  }

  function updateWake(inst, dt) {
    const b = inst.body;
    const rig = wakeFor(inst);
    const surface = groundAt(b.head.x, b.head.z);
    const depth = surface - b.head.y;
    // Only while it is shallow enough to be pushing sand up. Deeper
    // than this and the ridge would be a lie.
    const showing = b.phase !== "dead" && depth > 0.4 && depth < 9.5;
    if (rig.root.visible !== showing) rig.root.visible = showing;
    if (!showing) return;
    const strength = clamp01((9.5 - depth) / 6.5);
    /* Parked a little BEHIND the head. The animal's shoulders are what
       displace the most sand, not its mouth, and a ridge centred on the
       head puts the crest ahead of the thing making it - which reads as
       the ground bulging in front of a hole rather than around one. */
    rig.root.position.set(
      b.head.x - Math.sin(b.heading) * 2.4,
      surface + 0.05,
      b.head.z - Math.cos(b.heading) * 2.4
    );
    rig.root.rotation.y = b.heading;
    rig.root.scale.set(0.70 + strength * 0.50, 0.72 + strength * 0.46,
      0.80 + strength * 0.40);

    /* The wake's own voice, on its own clock. A shallow Coulter is
       audible before it is visible and from any direction, which is
       what makes the submerged phase playable for a player who happens
       to be facing the wrong way when it starts. */
    rig.rumble -= dt;
    if (rig.rumble <= 0) {
      rig.rumble = 0.62;
      bus.emit("wake", {
        x: b.head.x, z: b.head.z, strength: 0.35 + strength * 0.65, id: inst.id,
      });
    }

    rig.spray -= dt;
    if (rig.spray > 0) return;
    rig.spray = 0.055;
    /* THE SPRAY IS THE READ, and it is the half of this that survives
       distance. A metre-high ridge is a few pixels tall at sixty metres
       and the player is not looking at the ground; a fountain of sand is
       a bright moving cluster that carries to the horizon, because point
       sprites have a floor on how small they can draw.

       Thrown from two places for two different reasons: off the leading
       edge, which says which way it is going, and off the crest behind
       it, which says how big it is. */
    const sx = Math.sin(b.heading);
    const sz = Math.cos(b.heading);
    const power = 0.9 + strength * 1.5;
    ctx.vfx?.sandSpray?.(b.head.x + sx * 3.4, surface + 0.30, b.head.z + sz * 3.4,
      power, sx, sz);
    ctx.vfx?.sandSpray?.(b.head.x - sx * 2.2, surface + 0.55, b.head.z - sz * 2.2,
      power * 0.72, -sx * 0.35, -sz * 0.35);
  }

  function updateGlobules(dt) {
    const ps = ctx.player?.state;
    for (const g of globules) {
      if (!g.live) continue;
      g.life -= dt;
      const px = g.x;
      const py = g.y;
      const pz = g.z;
      g.vy -= 22 * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.z += g.vz * dt;
      g.mesh.position.set(g.x, g.y, g.z);
      g.mesh.rotation.x += g.spin * dt;
      g.mesh.rotation.z += g.spin * 0.7 * dt;

      let hit = null;
      const step = Math.hypot(g.x - px, g.y - py, g.z - pz);
      /* Masonry, and the nave is full of it. A globule that sails
         through a wall makes cover meaningless against the one attack
         cover is supposed to answer. */
      if (step > 1e-4 && ctx.collide?.rayBlock) {
        const blocked = ctx.collide.rayBlock(px, py, pz,
          (g.x - px) / step, (g.y - py) / step, (g.z - pz) / step, step);
        if (blocked < step) {
          hit = {
            x: px + ((g.x - px) / step) * blocked,
            y: py + ((g.y - py) / step) * blocked,
            z: pz + ((g.z - pz) / step) * blocked,
            direct: false,
          };
        }
      }
      if (!hit && ps && !ctx.combat?.player?.dead) {
        const dx = g.x - ps.x;
        const dz = g.z - ps.z;
        const dy = g.y - (ps.y + 1.0);
        if (dx * dx + dz * dz < 1.9 * 1.9 && Math.abs(dy) < 1.5) {
          hit = { x: g.x, y: g.y, z: g.z, direct: true };
        }
      }
      if (!hit && g.y <= groundAt(g.x, g.z) + 0.2) {
        hit = { x: g.x, y: groundAt(g.x, g.z), z: g.z, direct: false };
      }
      if (hit) {
        g.live = false;
        g.mesh.visible = false;
        splash(hit.x, hit.y, hit.z, hit.direct);
        continue;
      }
      if (g.life <= 0) {
        g.live = false;
        g.mesh.visible = false;
      }
    }
  }

  function updatePools(dt) {
    for (const pool of pools) {
      if (pool.life <= 0) {
        if (pool.mesh.visible) pool.mesh.visible = false;
        continue;
      }
      pool.life -= dt;
      if (pool.life <= 0) {
        pool.mesh.visible = false;
        pool.mat.uniforms.uFade.value = 0;
        continue;
      }
      const t = pool.life / pool.span;
      // Swells for the first fifth, then thins for the rest of its
      // life: a hazard that vanishes at full brightness cannot be
      // timed, and timing it is the skill.
      const fade = t > 0.8 ? clamp01((1 - t) / 0.2) : clamp01(t / 0.8) ** 0.7;
      pool.mat.uniforms.uFade.value = fade;
      pool.mat.uniforms.uTime.value = atmos.elapsed;
      pool.gas -= dt;
      if (pool.gas > 0) continue;
      pool.gas = 0.34;
      ctx.vfx?.venomGas?.(pool.x, pool.y + 0.2, pool.z, pool.radius * 0.8,
        fade * 1.1);
    }
  }

  function update(dt) {
    const d = Math.min(0.1, Math.max(0, dt));
    const ps = ctx.player?.state;
    for (const inst of enemies.live) {
      if (!inst.body) continue;
      if (ps) {
        const far = (inst.x - ps.x) ** 2 + (inst.z - ps.z) ** 2
          > C.simRange * C.simRange;
        if (far && inst.state !== "death") continue;
      }
      stepInstance(inst, d);
    }
    // Wakes for anything that has gone.
    if (wakes.size) {
      for (const id of [...wakes.keys()]) {
        if (!enemies.live.some((inst) => inst.id === id)) disposeWake(id);
      }
    }
    updateGlobules(d);
    updatePools(d);
    updateToxin(d);
  }

  /* ============================================================
     STATE
     ============================================================ */

  function status() {
    const live = enemies.live.filter((inst) => inst.body && inst.state !== "death");
    const inst = live[0] || null;
    return {
      live: live.length,
      phase: inst ? inst.body.phase : null,
      timer: inst ? Number(inst.body.timer.toFixed(2)) : 0,
      submerged: inst ? !!inst.body.hidden : false,
      surfacings: inst ? inst.body.surfacings : 0,
      mawOpen: inst ? Number(inst.body.mawOpen.toFixed(3)) : 0,
      depth: inst
        ? Number((groundAt(inst.body.head.x, inst.body.head.z) - inst.body.head.y).toFixed(2))
        : 0,
      health: inst ? Math.max(0, Math.round(inst.health)) : 0,
      maxHealth: inst ? Math.round(inst.maxHealth) : 0,
      toxin: Number(toxin.level.toFixed(3)),
      inVenom: toxin.inPool,
      pools: pools.filter((p) => p.life > 0).length,
      globules: globules.filter((g) => g.live).length,
    };
  }

  function snapshot() {
    // Pools and globules are deliberately NOT persisted. They are
    // seconds-long consequences of an attack, and restoring a save
    // into a cloud of venom the player never saw thrown is worse than
    // losing it.
    return { toxin: Number(toxin.level.toFixed(4)) };
  }

  function restore(saved = {}) {
    toxin.level = clamp01(Number(saved.toxin) || 0);
    toxin.tick = 0;
    clearHazards();
    return true;
  }

  function clearHazards() {
    for (const pool of pools) {
      pool.life = 0;
      pool.mesh.visible = false;
      pool.mat.uniforms.uFade.value = 0;
    }
    for (const g of globules) {
      g.live = false;
      g.mesh.visible = false;
    }
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
    spillPool,
    /** True while the animal cannot be touched, and the reason the
     *  fight has a rhythm. Read by combat's every damage path. */
    submerged(inst) { return !!(inst && inst.body && inst.body.hidden); },
    toxinLevel() { return toxin.level; },
    setToxin(v) { toxin.level = clamp01(Number(v) || 0); return toxin.level; },
    dispose() {
      for (const id of [...wakes.keys()]) disposeWake(id);
      scene.remove(group);
    },
  };
}
