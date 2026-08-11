/* ============================================================
   BLACKSAND - weapons and ballistics

   Weapon definitions, the firing state machine, and hit resolution.

   Ballistics are hitscan with a travel delay rather than simulated
   projectiles - one raycast chain resolved at the instant of firing,
   with the damage and the impact effect scheduled for when the round
   would actually arrive. That keeps hit registration exact and
   untunnellable while still making a 400m shot take half a second to
   land, which is the thing players actually feel.

   The trajectory is marched in chords rather than cast as a single
   straight line. A chord of 0.1s deviates from the true parabola by
   g*t^2/8 - about 12mm - which is inside the size of a soldier's arm,
   so the cheap version and the expensive version hit the same pixel.
   Straight-line hitscan does not: an M24 round drops 1.08m over 400m,
   and a marksman rifle that ignores that is not a marksman rifle.

   Spread is a cone whose half-angle grows with sustained fire and
   shrinks with stillness, stance and aiming. The first round from a
   stationary, aimed rifle is exact - that is what makes marksmanship
   feel rewarded rather than random.
   ============================================================ */

import { clamp, clamp01, lerp, damp, smoothstep, makePool, makeRng, DEG } from "./core.js";
import { LAYER, SURFACE } from "./physics.js";

/** Real gravity, not the 22 m/s^2 the player uses. Movement gravity is
 *  tuned for feel; a bullet that fell at that rate would be a mortar. */
const BULLET_GRAVITY = 9.81;

/**
 * How hard each material is to shoot through, in "effective metres of
 * penetration budget per metre of material". Derived from what stops a
 * 5.56 round in practice rather than from density - glass is dense but
 * offers almost no resistance, and sandbags are light but are the whole
 * reason sandbags exist.
 */
const PENETRATION_COST = {
  [SURFACE.METAL]: 3.4,
  [SURFACE.ROCK]: 3.6,
  [SURFACE.CONCRETE]: 2.6,
  [SURFACE.WOOD]: 0.85,
  [SURFACE.GLASS]: 0.22,
  [SURFACE.SAND]: 2.1,
  [SURFACE.DIRT]: 2.4,
  [SURFACE.FOLIAGE]: 0.10,
  [SURFACE.FLESH]: 0.6,
  [SURFACE.WATER]: 4.0,
};

/** Chance a grazing hit skips off instead of biting in. Sand and wood
 *  swallow a round; rock and steel throw it. */
const RICOCHET_SURFACE = {
  [SURFACE.METAL]: 0.72,
  [SURFACE.ROCK]: 0.58,
  [SURFACE.CONCRETE]: 0.44,
  [SURFACE.SAND]: 0.16,
  [SURFACE.DIRT]: 0.12,
  [SURFACE.WOOD]: 0.05,
  [SURFACE.GLASS]: 0.0,
  [SURFACE.FLESH]: 0.0,
  [SURFACE.WATER]: 0.30,
  [SURFACE.FOLIAGE]: 0.0,
};

/** Damage falls off with range, per weapon, as a piecewise curve.
 *  A flat damage number makes every engagement distance identical. */
export const WEAPONS = {
  rifle: {
    id: "rifle",
    name: "M4A1",
    class: "assault",
    fireMode: ["auto", "burst", "single"],
    rpm: 780,
    damage: 26,
    damageFalloff: [[0, 1], [60, 1], [180, 0.72], [400, 0.55]],
    muzzleVelocity: 900,
    /** Fraction of velocity shed per 100m. Keeps a 5.56 round supersonic
     *  well past this map's longest sightline. */
    dragPer100: 0.055,
    /** Sights are zeroed here: the bore is tilted up just enough that
     *  the trajectory crosses the line of sight at this range. Without
     *  it every shot lands low and players call it a bug. */
    zeroRange: 150,
    magazine: 30,
    reserve: 210,
    reloadTime: 2.25,
    reloadEmptyTime: 3.0,
    /** Cone half-angle in degrees. */
    spreadBase: 0.14,
    spreadMoving: 1.35,
    spreadHipfire: 2.4,
    spreadPerShot: 0.16,
    spreadMax: 4.2,
    spreadRecovery: 3.6,
    recoilPitch: 0.42,
    recoilYaw: 0.16,
    recoilRise: 1.18,
    /** Deterministic horizontal signature. Amplitude in degrees, `freq`
     *  in radians per shot, `drift` a constant lateral pull. Learnable
     *  because it repeats; not a laser because of `recoilYaw` on top. */
    recoilPattern: { amp: 0.16, freq: 0.85, phase: 0.4, drift: 0.05 },
    adsTime: 0.22,
    penetration: 0.42,
    tracerEvery: 3,
    zoom: 1.35,
  },
  carbine: {
    id: "carbine",
    name: "AKM",
    class: "assault",
    fireMode: ["auto", "single"],
    rpm: 600,
    damage: 34,
    damageFalloff: [[0, 1], [50, 1], [150, 0.7], [350, 0.5]],
    muzzleVelocity: 715,
    dragPer100: 0.075,
    zeroRange: 130,
    magazine: 30,
    reserve: 180,
    reloadTime: 2.5,
    reloadEmptyTime: 3.3,
    spreadBase: 0.19,
    spreadMoving: 1.6,
    spreadHipfire: 2.9,
    spreadPerShot: 0.23,
    spreadMax: 5.0,
    spreadRecovery: 3.2,
    recoilPitch: 0.58,
    recoilYaw: 0.24,
    recoilRise: 1.3,
    // Wide, slow zigzag with a hard left pull - the AK signature.
    recoilPattern: { amp: 0.34, freq: 1.15, phase: 0, drift: -0.09 },
    adsTime: 0.26,
    penetration: 0.58,
    tracerEvery: 3,
    zoom: 1.3,
  },
  marksman: {
    id: "marksman",
    name: "M24",
    class: "recon",
    fireMode: ["single"],
    rpm: 48,
    damage: 92,
    damageFalloff: [[0, 1], [300, 1], [600, 0.86]],
    muzzleVelocity: 850,
    dragPer100: 0.035,
    zeroRange: 300,
    magazine: 5,
    reserve: 40,
    reloadTime: 3.2,
    reloadEmptyTime: 3.6,
    boltTime: 1.15,
    spreadBase: 0.02,
    spreadMoving: 3.2,
    spreadHipfire: 6.5,
    spreadPerShot: 0.9,
    spreadMax: 8,
    spreadRecovery: 2.2,
    recoilPitch: 1.9,
    recoilYaw: 0.3,
    recoilRise: 0.9,
    recoilPattern: { amp: 0.10, freq: 2.4, phase: 1.1, drift: 0.02 },
    adsTime: 0.42,
    penetration: 1.15,
    tracerEvery: 0,
    zoom: 5.5,
  },
  smg: {
    id: "smg",
    name: "MP5",
    class: "support",
    fireMode: ["auto", "burst", "single"],
    rpm: 900,
    damage: 19,
    damageFalloff: [[0, 1], [25, 1], [80, 0.62], [180, 0.4]],
    muzzleVelocity: 400,
    // Subsonic pistol calibre: sheds velocity fast and drops visibly by
    // 100m, which is what keeps an 900rpm weapon from owning every range.
    dragPer100: 0.16,
    zeroRange: 50,
    magazine: 30,
    reserve: 240,
    reloadTime: 2.1,
    reloadEmptyTime: 2.7,
    spreadBase: 0.28,
    spreadMoving: 1.1,
    spreadHipfire: 1.9,
    spreadPerShot: 0.19,
    spreadMax: 4.8,
    spreadRecovery: 4.6,
    recoilPitch: 0.3,
    recoilYaw: 0.2,
    recoilRise: 1.0,
    recoilPattern: { amp: 0.12, freq: 2.05, phase: 0.7, drift: 0.02 },
    adsTime: 0.18,
    penetration: 0.20,
    tracerEvery: 4,
    zoom: 1.2,
  },
  lmg: {
    id: "lmg",
    name: "M249",
    class: "support",
    fireMode: ["auto"],
    rpm: 720,
    damage: 28,
    damageFalloff: [[0, 1], [80, 1], [220, 0.72], [450, 0.55]],
    muzzleVelocity: 915,
    dragPer100: 0.05,
    zeroRange: 200,
    magazine: 100,
    reserve: 300,
    reloadTime: 5.6,
    reloadEmptyTime: 6.2,
    spreadBase: 0.34,
    spreadMoving: 2.4,
    spreadHipfire: 3.8,
    spreadPerShot: 0.12,
    spreadMax: 5.5,
    spreadRecovery: 2.4,
    recoilPitch: 0.36,
    recoilYaw: 0.26,
    recoilRise: 1.5,
    // Long-period wander: it walks off target over a 30-round burst
    // rather than climbing, which is what a belt-fed actually does.
    recoilPattern: { amp: 0.46, freq: 0.42, phase: 2.1, drift: 0.06 },
    adsTime: 0.34,
    penetration: 0.72,
    tracerEvery: 2,
    zoom: 1.25,
    /** Deploying a bipod cuts spread hard. Rewards holding an angle. */
    bipod: true,
  },
  pistol: {
    id: "pistol",
    name: "M9",
    class: "sidearm",
    fireMode: ["single"],
    rpm: 420,
    damage: 22,
    damageFalloff: [[0, 1], [20, 1], [60, 0.6], [120, 0.4]],
    muzzleVelocity: 380,
    dragPer100: 0.17,
    zeroRange: 25,
    magazine: 15,
    reserve: 60,
    reloadTime: 1.7,
    reloadEmptyTime: 2.3,
    spreadBase: 0.32,
    spreadMoving: 1.2,
    spreadHipfire: 2.0,
    spreadPerShot: 0.42,
    spreadMax: 5,
    spreadRecovery: 5.2,
    recoilPitch: 0.55,
    recoilYaw: 0.25,
    recoilRise: 0.8,
    recoilPattern: { amp: 0.08, freq: 3.1, phase: 0.2, drift: 0.0 },
    adsTime: 0.16,
    penetration: 0.14,
    tracerEvery: 0,
    zoom: 1.15,
  },
};

/** Sample a piecewise-linear falloff curve. */
function falloffAt(curve, distance) {
  if (distance <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i += 1) {
    const [d0, v0] = curve[i - 1];
    const [d1, v1] = curve[i];
    if (distance <= d1) return lerp(v0, v1, (distance - d0) / (d1 - d0));
  }
  return curve[curve.length - 1][1];
}

/** Time of flight and drop for a weapon at a range. Exported so the HUD
 *  and the range card can show honest numbers rather than guesses. */
export function ballisticsAt(def, range) {
  const v0 = def.muzzleVelocity;
  const k = (def.dragPer100 ?? 0.06) / 100;
  // Linear velocity decay integrates to a closed form; good enough over
  // the ranges this map supports and far cheaper than integrating.
  const vAvg = v0 * (1 - k * range * 0.5);
  const time = range / Math.max(vAvg, 60);
  return { time, drop: 0.5 * BULLET_GRAVITY * time * time, velocity: v0 * (1 - k * range) };
}

export async function createWeapons(ctx) {
  const { THREE, physics, player, vfx, audio, settings, input } = ctx;
  const rng = makeRng(ctx.seed ^ 0x0bee5);

  /* ---------------------------- loadout ---------------------------- */

  function makeSlot(def) {
    return {
      def,
      ammo: def.magazine,
      reserve: def.reserve,
      /** Seconds until the next shot is allowed. */
      cooldown: 0,
      reloading: 0,
      /** Total length of the reload in progress, so the view model can
       *  compute an exact phase instead of guessing which of the two
       *  reload times is running. */
      reloadDuration: 0,
      reloadEmpty: false,
      /** Current cone half-angle, degrees. */
      spread: def.spreadBase,
      /** Index into def.fireMode. */
      modeIndex: 0,
      burstRemaining: 0,
      shotsThisBurst: 0,
      /** Seconds the player has held still. Drives first-shot accuracy. */
      stillness: 0,
      lastFireTime: -10,
      bipodDeployed: false,
    };
  }

  const loadout = [
    makeSlot(WEAPONS.rifle),
    makeSlot(WEAPONS.marksman),
    makeSlot(WEAPONS.pistol),
  ];
  let activeIndex = 0;
  let switching = 0;

  const state = {
    get slot() { return loadout[activeIndex]; },
    get def() { return loadout[activeIndex].def; },
    firing: false,
    /** 0..1, drives the muzzle flash and any HUD feedback. */
    fireImpulse: 0,
    lastShotAt: -10,
    shotsFired: 0,
    hits: 0,
    kills: 0,
    penetrations: 0,
    ricochets: 0,
    /** Metres to whatever the player is looking at. The HUD's range
     *  readout and the marksman's hold-over both want this. */
    aimRange: 0,
  };

  /* --------------------------- pending hits --------------------------- */

  /**
   * A round in flight. The trajectory is already resolved; this is only
   * the delay before the consequence lands. Pooled because a belt-fed
   * weapon plus five bots can have thirty rounds airborne and a shooter
   * that allocates per bullet stutters under GC.
   */
  const pending = makePool(() => ({
    active: false,
    at: 0,
    kind: "impact",
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    surface: SURFACE.SAND,
    energy: 1,
    damage: 0,
    target: null,
    headshot: false,
    distance: 0,
  }), 96, (item) => { item.active = false; item.target = null; });

  function schedule(kind, delay, fill) {
    const item = pending.acquire();
    if (!item) return null;
    item.active = true;
    item.kind = kind;
    item.at = ctx.time + delay;
    item.target = null;
    fill(item);
    return item;
  }

  function resolvePending() {
    for (const item of pending.items) {
      if (!item.active || ctx.time < item.at) continue;
      if (item.kind === "impact") {
        vfx.impact(item.point, item.normal, item.surface, item.energy);
      } else if (item.kind === "hit") {
        const target = item.target;
        const damage = item.damage;
        const headshot = item.headshot;
        const distance = item.distance;
        if (target) {
          state.hits += 1;
          vfx.impact(item.point, item.normal, SURFACE.FLESH, 1);
        }
        // Release before the damage call: applyDamage can kill a bot,
        // which respawns it, which can fire, which can schedule into
        // this same pool on the same tick.
        pending.release(item);
        if (!target) continue;
        const killed = ctx.bots.applyDamage(target, damage, {
          source: "player", headshot,
        });
        ctx.bus.emit("weapon:hit", { headshot, killed, distance });
        if (killed) {
          state.kills += 1;
          player.state.kills += 1;
          player.state.score += headshot ? 150 : 100;
        }
        continue;
      }
      pending.release(item);
    }
  }

  /* ----------------------------- spread ----------------------------- */

  function currentSpread(slot, dt) {
    const def = slot.def;
    const p = player.state;

    // Stillness: a settle timer that a step, a jump or a shot resets.
    // This is what makes "stop, then shoot" the correct play without
    // needing a UI element to teach it.
    if (p.speed < 0.35 && p.grounded) slot.stillness = Math.min(1.4, slot.stillness + dt);
    else slot.stillness = 0;

    let target = def.spreadBase;
    if (!p.ads) target += def.spreadHipfire;
    // Movement penalty scales with actual speed, so a slow walk is
    // barely penalised and a sprint is unusable.
    target += def.spreadMoving * clamp01(p.speed / 5.2);
    if (!p.grounded) target += def.spreadMoving * 1.4;
    // Being shot at costs accuracy - not just the screen effect.
    target += def.spreadHipfire * 0.28 * p.suppression;
    // So does being out of breath.
    target += def.spreadMoving * 0.35 * clamp01((1 - p.stamina) * 1.2);
    if (p.stance === "crouch") target *= 0.72;
    if (p.stance === "prone") target *= 0.48;
    if (def.bipod && slot.bipodDeployed) target *= 0.28;

    // The floor drops below spreadBase once the player has been still
    // and aimed for a moment. A stationary aimed rifle should put its
    // first round exactly where the sight is.
    const settle = smoothstep(slot.stillness / 0.55) * p.adsAmount;
    const floor = def.spreadBase * lerp(1, 0.25, settle);
    target = Math.max(target, floor);

    // Bloom recovers towards the target rather than snapping, so a burst
    // has a memory.
    slot.spread = damp(slot.spread, target, def.spreadRecovery, dt);
    return clamp(slot.spread, floor, def.spreadMax);
  }

  /* --------------------------- trajectory --------------------------- */

  const _origin = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _pos = new THREE.Vector3();
  const _vel = new THREE.Vector3();
  const _step = new THREE.Vector3();
  const _muzzle = new THREE.Vector3();
  const _toEnd = new THREE.Vector3();
  const _probe = new THREE.Vector3();
  const _back = new THREE.Vector3();

  /** Longest chord of the marched trajectory. 0.1s of flight deviates
   *  from the true parabola by about 12mm - inside the width of a
   *  forearm, so the cheap solve and the exact solve hit the same box. */
  const SEGMENT_TIME = 0.1;
  const MAX_SEGMENTS = 9;
  const MAX_RANGE = 720;

  /**
   * March a round from the muzzle until it stops, scheduling every
   * consequence for the time it would actually happen.
   *
   * Returns the final endpoint and total flight time, which the tracer
   * needs so the streak and the impact agree.
   */
  const trace = {
    end: new THREE.Vector3(),
    time: 0,
    distance: 0,
    hitCharacter: false,
    penetrations: 0,
    ricochets: 0,
  };

  function marchBullet(origin, direction, def, damageScale) {
    _pos.copy(origin);
    const speed0 = def.muzzleVelocity;
    _vel.copy(direction).multiplyScalar(speed0);

    let time = 0;
    let travelled = 0;
    let energy = damageScale;
    let penetrationLeft = def.penetration;
    let ricochets = 0;
    let penetrations = 0;

    trace.hitCharacter = false;

    for (let segment = 0; segment < MAX_SEGMENTS; segment += 1) {
      const speed = _vel.length();
      if (speed < 60 || energy < 0.06) break;

      const remaining = MAX_RANGE - travelled;
      if (remaining <= 0.01) break;
      const dt = Math.min(SEGMENT_TIME, remaining / speed);
      const length = speed * dt;
      _step.copy(_vel).multiplyScalar(1 / speed);

      // Soldiers are not in the collider set - they move every frame and
      // rebuilding the broadphase for them would cost more than testing
      // them directly. Test the short list of live characters against
      // this chord and take whichever is nearer.
      const world = physics.raycast(_pos, _step, length, {
        layer: LAYER.TERRAIN | LAYER.STATIC | LAYER.DYNAMIC | LAYER.VEHICLE,
      });
      const character = ctx.bots
        ? ctx.bots.raycast(_pos, _step, world.hit ? world.distance : length)
        : null;

      if (character) {
        const distance = travelled + character.distance;
        const arrival = time + character.distance / speed;
        const falloff = falloffAt(def.damageFalloff, distance);
        const damage = def.damage * falloff * character.multiplier * energy;
        const headshot = character.part === "head";
        const target = character.target;
        schedule("hit", arrival, (item) => {
          item.point.copy(character.point);
          item.normal.copy(character.normal);
          item.damage = damage;
          item.target = target;
          item.headshot = headshot;
          item.distance = distance;
        });
        trace.end.copy(character.point);
        trace.time = arrival;
        trace.distance = distance;
        trace.hitCharacter = true;
        trace.penetrations = penetrations;
        trace.ricochets = ricochets;
        return trace;
      }

      if (world.hit) {
        const distance = travelled + world.distance;
        const arrival = time + world.distance / speed;
        const surface = world.surface || SURFACE.SAND;
        // Incidence: 1 head-on, 0 perfectly grazing.
        const incidence = clamp01(-_step.dot(world.normal));

        /* ---- ricochet ---- */
        const skipChance = (RICOCHET_SURFACE[surface] ?? 0)
          * (1 - smoothstep(incidence / 0.33));
        if (ricochets < 2 && skipChance > 0.02 && rng() < skipChance) {
          ricochets += 1;
          schedule("impact", arrival, (item) => {
            item.point.copy(world.point);
            item.normal.copy(world.normal);
            item.surface = surface;
            item.energy = 0.55 * energy;
          });
          // Reflect, scatter, and lose most of the energy. A ricochet
          // that keeps full damage turns every rock into a wallhack.
          const along = _vel.dot(world.normal);
          _vel.addScaledVector(world.normal, -2 * along);
          _vel.multiplyScalar(0.62);
          _vel.x += rng.gauss() * speed * 0.045;
          _vel.y += rng.gauss() * speed * 0.045;
          _vel.z += rng.gauss() * speed * 0.045;
          energy *= 0.45;
          _pos.copy(world.point).addScaledVector(world.normal, 0.02);
          travelled = distance;
          time = arrival;
          ctx.bus.emit("weapon:ricochet", { point: world.point, surface });
          audio?.bulletCrack?.(world.point, 0.5);
          continue;
        }

        /* ---- penetration ---- */
        // Terrain is never penetrable: a hill is not a wall.
        const permeable = !world.terrain && world.collider && world.collider.penetrable > 0;
        if (permeable && penetrationLeft > 0.02) {
          const thickness = measureThickness(world.point, _step, world.collider);
          const cost = thickness * (PENETRATION_COST[surface] ?? 2.5)
            / Math.max(world.collider.penetrable, 0.05);
          if (cost <= penetrationLeft) {
            penetrations += 1;
            penetrationLeft -= cost;
            // Entry spall on the near face...
            schedule("impact", arrival, (item) => {
              item.point.copy(world.point);
              item.normal.copy(world.normal);
              item.surface = surface;
              item.energy = 0.85 * energy;
            });
            // ...and a smaller burst where it comes out.
            _probe.copy(world.point).addScaledVector(_step, thickness + 0.01);
            schedule("impact", arrival + thickness / speed, (item) => {
              item.point.copy(_probe);
              item.normal.copy(_step).multiplyScalar(-1);
              item.surface = surface;
              item.energy = 0.5 * energy;
            });
            // Damage bleeds off through the material, and the round is
            // deflected a little by whatever it went through.
            energy *= clamp01(1 - cost / Math.max(def.penetration, 0.01)) * 0.85 + 0.1;
            _vel.x += rng.gauss() * speed * 0.006;
            _vel.y += rng.gauss() * speed * 0.006;
            _pos.copy(_probe);
            travelled = distance + thickness;
            time = arrival + thickness / speed;
            continue;
          }
        }

        /* ---- stop ---- */
        schedule("impact", arrival, (item) => {
          item.point.copy(world.point);
          item.normal.copy(world.normal);
          item.surface = surface;
          item.energy = clamp01(0.4 + energy * 0.6);
        });
        trace.end.copy(world.point);
        trace.time = arrival;
        trace.distance = distance;
        trace.penetrations = penetrations;
        trace.ricochets = ricochets;
        return trace;
      }

      /* ---- free flight ---- */
      _pos.addScaledVector(_step, length);
      travelled += length;
      time += dt;
      // Gravity, then linear drag. Applying drag to the whole velocity
      // rather than only the forward component is wrong by a fraction of
      // a percent and saves decomposing the vector every step.
      _vel.y -= BULLET_GRAVITY * dt;
      _vel.multiplyScalar(1 - (def.dragPer100 ?? 0.06) * 0.01 * length);
    }

    trace.end.copy(_pos);
    trace.time = time;
    trace.distance = travelled;
    trace.penetrations = penetrations;
    trace.ricochets = ricochets;
    return trace;
  }

  /**
   * How thick the thing we just hit is, along the shot line.
   *
   * A ray cast from inside an OBB reports an entry distance of zero, so
   * the far face cannot be found by casting forward. Casting BACKWARDS
   * from a point past the wall finds it exactly, and only costs one
   * extra query on the rare shot that actually penetrates.
   */
  const MAX_WALL = 1.2;
  function measureThickness(point, direction, collider) {
    _probe.copy(point).addScaledVector(direction, MAX_WALL);
    _back.copy(direction).multiplyScalar(-1);
    const backHit = physics.raycast(_probe, _back, MAX_WALL, {
      layer: collider.layer,
      ignore: (c) => c !== collider,
    });
    if (!backHit.hit) return MAX_WALL;
    return clamp(MAX_WALL - backHit.distance, 0.01, MAX_WALL);
  }

  /* ------------------------------ fire ------------------------------ */

  function fireOnce() {
    const slot = state.slot;
    const def = slot.def;

    if (slot.ammo <= 0) {
      audio?.playAt?.("click", player.position, { volume: 0.5 });
      slot.cooldown = 0.28;
      return false;
    }
    // Pressed against a wall: the view model has already swung the
    // muzzle out of the geometry, so firing would send the round
    // somewhere the player is not looking.
    if (ctx.viewmodel && ctx.viewmodel.blocked) return false;

    slot.ammo -= 1;
    state.shotsFired += 1;
    state.lastShotAt = ctx.time;
    state.fireImpulse = 1;
    slot.stillness = 0;
    slot.cooldown = 60 / def.rpm;
    if (def.boltTime) slot.cooldown = Math.max(slot.cooldown, def.boltTime);

    /* ---- aim ---- */
    _origin.copy(player.eyePosition);
    _dir.copy(player.aimDirection);
    _right.set(_dir.z, 0, -_dir.x).normalize();
    _up.crossVectors(_right, _dir).normalize();

    // Zero the sights: tilt the bore up so the trajectory crosses the
    // line of sight at the weapon's zero range. theta ~= gR / 2v^2.
    const zero = def.zeroRange ?? 100;
    const elevation = (BULLET_GRAVITY * zero)
      / (2 * def.muzzleVelocity * def.muzzleVelocity);
    _dir.addScaledVector(_up, elevation).normalize();

    // Cone spread. Sampling uniformly in the disc (sqrt of the radius)
    // rather than uniformly in the radius matters: without the sqrt,
    // shots cluster at the centre and the effective cone is half what
    // the number says.
    const halfAngle = slot.spread * DEG;
    if (halfAngle > 1e-5) {
      const angle = rng() * Math.PI * 2;
      const radius = Math.sqrt(rng()) * Math.tan(halfAngle);
      _dir.addScaledVector(_right, Math.cos(angle) * radius);
      _dir.addScaledVector(_up, Math.sin(angle) * radius);
      _dir.normalize();
    }

    slot.spread = Math.min(def.spreadMax, slot.spread + def.spreadPerShot);

    /* ---- trajectory ---- */
    const result = marchBullet(_origin, _dir, def, 1);
    state.penetrations += result.penetrations;
    state.ricochets += result.ricochets;

    /* ---- effects ---- */
    // Flash and tracer start at the weapon's real muzzle, not at the
    // camera. The trace still starts at the eye - that is what makes a
    // shot go where the crosshair is - but the visual has to come out of
    // the barrel or the whole first-person illusion breaks.
    if (ctx.viewmodel && ctx.viewmodel.muzzleWorld) {
      ctx.viewmodel.muzzleWorld(_muzzle);
    } else {
      _muzzle.copy(_origin).addScaledVector(_dir, 0.55).addScaledVector(_right, 0.12);
    }

    vfx.muzzleFlash(_muzzle, _dir, def.id === "lmg" ? 1.3 : def.id === "pistol" ? 0.7 : 1.0, {
      weapon: def.id,
      suppressed: false,
    });
    audio.gunshot(_muzzle, {
      gain: def.id === "marksman" ? 1.3 : 1.0,
      pitch: lerp(1.15, 0.85, def.damage / 92),
    });

    const showTracer = def.tracerEvery > 0 && state.shotsFired % def.tracerEvery === 0;
    if (showTracer) {
      _toEnd.copy(result.end).sub(_muzzle);
      const length = _toEnd.length();
      if (length > 0.5) {
        _toEnd.multiplyScalar(1 / length);
        vfx.tracer(_muzzle, _toEnd, length, {
          speed: def.muzzleVelocity,
          colour: 0xffd08a,
          length: clamp(def.muzzleVelocity * 0.014, 6, 14),
        });
      }
    }

    /* ---- recoil ---- */
    // Vertical is deterministic, horizontal is a repeating signature
    // plus a bounded random band. That combination is what lets a
    // skilled player pull down and counter-drift through a burst while
    // still being unable to laser at range.
    const shotIndex = slot.shotsThisBurst;
    const rise = 1 + Math.min(shotIndex, 8) * 0.09 * def.recoilRise;
    const adsScale = lerp(1, 0.62, player.state.adsAmount);
    const stanceScale = player.state.stance === "prone" ? 0.62
      : player.state.stance === "crouch" ? 0.84 : 1;
    const pattern = def.recoilPattern || { amp: 0, freq: 1, phase: 0, drift: 0 };
    const signature = Math.sin(shotIndex * pattern.freq + pattern.phase) * pattern.amp
      + pattern.drift * Math.min(shotIndex, 12);
    const scale = adsScale * stanceScale;
    player.addRecoil(
      def.recoilPitch * DEG * rise * scale,
      (signature + (rng() - 0.5) * 2 * def.recoilYaw) * DEG * rise * scale
    );
    slot.shotsThisBurst += 1;
    input.rumble(0.28, 0.16, 45);

    ctx.bus.emit("weapon:fire", { def, ammo: slot.ammo, muzzle: _muzzle, direction: _dir });
    return true;
  }

  /* ----------------------------- reload ----------------------------- */

  function startReload() {
    const slot = state.slot;
    if (slot.reloading > 0) return;
    if (slot.ammo >= slot.def.magazine) return;
    if (slot.reserve <= 0) return;
    slot.reloadEmpty = slot.ammo === 0;
    slot.reloadDuration = slot.reloadEmpty ? slot.def.reloadEmptyTime : slot.def.reloadTime;
    slot.reloading = slot.reloadDuration;
    audio?.playAt?.("reload", player.position, { volume: 0.7 });
    ctx.bus.emit("weapon:reloadstart", {
      def: slot.def, duration: slot.reloading, empty: slot.reloadEmpty,
    });
  }

  function finishReload() {
    const slot = state.slot;
    const needed = slot.def.magazine - slot.ammo;
    const taken = Math.min(needed, slot.reserve);
    slot.ammo += taken;
    slot.reserve -= taken;
    slot.reloadDuration = 0;
    ctx.bus.emit("weapon:reloadend", { def: slot.def, ammo: slot.ammo });
  }

  /* ----------------------------- switch ----------------------------- */

  function switchTo(index) {
    if (index === activeIndex || index < 0 || index >= loadout.length) return;
    if (switching > 0) return;
    activeIndex = index;
    switching = 0.42;
    state.slot.reloading = 0;
    state.slot.shotsThisBurst = 0;
    ctx.bus.emit("weapon:switch", { def: state.def, index });
  }

  /* ------------------------------ tick ------------------------------ */

  const _aimProbe = new THREE.Vector3();

  function fixedUpdate(dt) {
    // Rounds in flight land whether or not the player is still holding
    // the trigger, alive, or looking at them.
    resolvePending();

    const slot = state.slot;
    const def = slot.def;

    if (switching > 0) { switching -= dt; return; }
    if (!player.state.alive) { state.firing = false; return; }

    /* weapon select */
    if (input.wasPressed("weapon1")) switchTo(0);
    if (input.wasPressed("weapon2")) switchTo(1);
    if (input.wasPressed("weapon3")) switchTo(2);
    if (input.wasPressed("nextWeapon")) switchTo((activeIndex + 1) % loadout.length);

    /* reload */
    if (slot.reloading > 0) {
      slot.reloading -= dt;
      if (slot.reloading <= 0) { slot.reloading = 0; finishReload(); }
    } else if (input.wasPressed("reload")) {
      startReload();
    } else if (slot.ammo === 0 && slot.reserve > 0) {
      // Auto-reload on empty. Not doing this is a design choice some
      // games make; here it removes a frustration with no upside.
      startReload();
    }

    /* bipod */
    if (def.bipod) {
      slot.bipodDeployed = player.state.stance === "prone"
        || (player.state.stance === "crouch" && player.state.speed < 0.4);
    }

    currentSpread(slot, dt);

    /* fire control */
    slot.cooldown = Math.max(0, slot.cooldown - dt);
    const mode = def.fireMode[slot.modeIndex % def.fireMode.length];
    const trigger = input.state.fire;
    const triggerPressed = input.wasPressed("fire");

    if (!trigger) {
      slot.shotsThisBurst = 0;
      slot.burstRemaining = 0;
    }

    const canFire = slot.cooldown <= 0 && slot.reloading <= 0
      && !player.state.sprinting && player.state.alive;

    if (canFire) {
      if (mode === "auto" && trigger) fireOnce();
      else if (mode === "single" && triggerPressed) fireOnce();
      else if (mode === "burst") {
        if (triggerPressed) slot.burstRemaining = 3;
        if (slot.burstRemaining > 0) {
          if (fireOnce()) slot.burstRemaining -= 1;
        }
      }
    }

    state.firing = trigger && canFire;
    state.fireImpulse = damp(state.fireImpulse, 0, 16, dt);
  }

  /** Range to whatever is under the crosshair. One raycast per frame,
   *  not per fixed step - nothing reads it at 120Hz. */
  function update() {
    _aimProbe.copy(player.aimDirection);
    const hit = physics.raycast(player.eyePosition, _aimProbe, 700, {
      layer: LAYER.TERRAIN | LAYER.STATIC | LAYER.DYNAMIC | LAYER.VEHICLE,
    });
    state.aimRange = hit.hit ? hit.distance : 0;
  }

  /* ------------------------------- api ------------------------------- */

  return {
    WEAPONS,
    state,
    loadout,
    get activeIndex() { return activeIndex; },
    get switching() { return switching; },

    fixedUpdate,
    update,
    fireOnce,
    startReload,
    switchTo,
    falloffAt,
    ballisticsAt,

    cycleFireMode() {
      const slot = state.slot;
      slot.modeIndex = (slot.modeIndex + 1) % slot.def.fireMode.length;
      return slot.def.fireMode[slot.modeIndex];
    },

    /** Cone half-angle in degrees, for the dynamic crosshair. */
    get spread() { return state.slot.spread; },

    /** Drop and time of flight to the point under the crosshair, so a
     *  marksman can be told what the hold-over is. */
    holdover(range = state.aimRange) {
      if (!range) return { time: 0, drop: 0, velocity: state.def.muzzleVelocity };
      return ballisticsAt(state.def, range);
    },

    addAmmo(amount) {
      const slot = state.slot;
      slot.reserve = Math.min(slot.def.reserve, slot.reserve + amount);
    },

    report() {
      const b = ballisticsAt(state.def, 300);
      return {
        weapon: state.def.name,
        ammo: state.slot.ammo,
        reserve: state.slot.reserve,
        spread: Number(state.slot.spread.toFixed(3)),
        stillness: Number(state.slot.stillness.toFixed(2)),
        shotsFired: state.shotsFired,
        hits: state.hits,
        accuracy: state.shotsFired ? Number((state.hits / state.shotsFired).toFixed(3)) : 0,
        penetrations: state.penetrations,
        ricochets: state.ricochets,
        inFlight: pending.active,
        aimRange: Number(state.aimRange.toFixed(1)),
        dropAt300: Number(b.drop.toFixed(2)),
        flightAt300: Number(b.time.toFixed(3)),
      };
    },
  };
}
