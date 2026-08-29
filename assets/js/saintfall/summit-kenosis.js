/* ============================================================
   SAINTFALL - Kenosis operative kits ("doctrines")

   The White Vigil and the Bastion Penitent each get a complete
   verb set here, at parity with Vesper's campaign kit: every
   ability has an input, a refusal reason, an animation, VFX, SFX
   and a status() the HUD and the harness can read.

   THE DOCTRINE OF THE WING - White Vigil, reliquary scout:
   - paired crescent volley (LMB; RMB raises/focuses the guns),
     resolved by summit-discharge with this kit's weapon numbers;
   - Vigil Step (E): a 12m combat translation on charges, walked
     through the collision field rather than through walls;
   - quick blades: the shared melee procession at 1.30x tempo,
     swung by the crescents themselves (dual pistol-whip);
   - the Augur pack carries 30% more reliquary charge and refills
     faster (figure.jetpackProfile, jetpack.js).

   THE DOCTRINE OF THE CENSER - Bastion Penitent, reliquary
   bulwark:
   - the tower shield (E, held): an unlimited physical guard with
     no charge cost, installed as the level's `ctx.shield` so the
     player controller and combat's hurtPlayer treat it exactly
     like an Aegis that never runs dry. Frontal only, and wider
     than the Aegis - a wall, not a bubble;
   - the Hammer Cast (RMB): the reliquary hammer thrown flat
     through everything in its line, knocking flyers out of the
     sky (combat.groundFlyer), then RETURNING to the fist;
   - the shared melee procession at 0.78x tempo with bulwark
     damage - each blow a bell;
   - the Censer pack cannot fly: the flight chord is a single
     jet-boosted leap (jetpack.js leap mode), and the airborne
     melee press is the Penitent's Fall it always was.

   Built AFTER player, loadout, jetpack, and (when the level
   carries them) combat/enemies/boost/slam. This module wraps the
   loadout's arm hooks - the swings are additive offsets over the
   carry, driven by the player's own action clock - and publishes
   `ctx.loadout.meleeSpec`, which is what opens player.meleeSwing
   and combat.meleeStrike on a level with no ctx.weapons.
   ============================================================ */

import { clamp01 } from "saintfall/core.js";
import { GUARD_TYPES, normalizeGuardDetail } from "saintfall/guard-rules.js";

/* One kit per operative. Damage numbers are authored against the
   campaign bestiary (Thresher 60 / Gleaner 150 / Harrow 420) so the
   trials ground plays at campaign weight. */
const KITS = {
  "white-vigil": {
    doctrine: "Doctrine of the Wing",
    melee: {
      /* Read by player.meleeSwing and combat.meleeStrike in place of
         a weapons-module spec. Reach is a blade in each fist, not a
         polearm; the tempo advantage is the identity. */
      melee: true, reach: 1.85, damage: 46,
    },
    blink: {
      range: 12.0, charges: 2, recharge: 5.5,
      /* Post-step momentum: arriving dead-stopped reads as a hitch,
         not a technique. */
      exitSpeed: 9.0,
    },
    discharge: {
      /* Consumed by summit-discharge: the crescents become a real
         mid-range weapon. Sustained 137 dps at the muzzle, falling
         past focusStart toward rangeM. */
      damage: 26, range: 42, speed: 46, falloffStart: 26, falloffFloor: 0.55,
      spreadHip: 0.030, spreadAds: 0.007,
    },
  },
  "bastion-penitent": {
    doctrine: "Doctrine of the Censer",
    melee: { melee: true, reach: 2.60, damage: 132 },
    block: {
      moveSpeed: 2.0, frontDot: 0.30, perfectWindow: 0.25,
      distance: 0.98, centreY: 1.15,
    },
    hammer: {
      damage: 260, returnDamage: 130, speed: 34, returnSpeed: 40,
      range: 46, cooldown: 8.0, knockdownStun: 3.0, knockback: 14,
    },
  },
};

/* An additive arm track: [u, outboard, up, forward] control points,
   linearly interpolated on the action's own normalized clock. The
   outboard column is side-signed at evaluation so one authored curve
   serves either fist. Amplitudes are rest-target offsets in
   figure-root metres - the same channel as the loadout's carry and
   fire poses - and the arm solver's own reach clamps keep any of
   them anatomical. */
const VIGIL_TRACKS = {
  strike: [
    [0.00, 0.000, 0.000, 0.000],
    [0.24, 0.120, 0.030, -0.170],
    [0.46, -0.150, 0.170, 0.430],
    [0.72, -0.040, 0.070, 0.140],
    [1.00, 0.000, 0.000, 0.000],
  ],
  turn: [
    [0.00, 0.000, 0.000, 0.000],
    [0.30, 0.220, 0.110, 0.060],
    [0.60, -0.090, 0.130, 0.300],
    [1.00, 0.000, 0.000, 0.000],
  ],
  lunge: [
    [0.00, 0.000, 0.000, 0.000],
    [0.25, 0.050, 0.050, -0.220],
    [0.45, -0.100, 0.150, 0.540],
    [0.75, -0.020, 0.060, 0.180],
    [1.00, 0.000, 0.000, 0.000],
  ],
};
const BASTION_TRACKS = {
  sweep: [
    [0.00, 0.000, 0.000, 0.000],
    [0.30, 0.180, 0.100, -0.240],
    [0.52, -0.200, 0.160, 0.480],
    [0.80, -0.060, 0.040, 0.160],
    [1.00, 0.000, 0.000, 0.000],
  ],
  rise: [
    [0.00, 0.000, 0.000, 0.000],
    [0.30, 0.130, -0.140, -0.180],
    [0.55, -0.140, 0.340, 0.420],
    [1.00, 0.000, 0.000, 0.000],
  ],
  crown: [
    [0.00, 0.000, 0.000, 0.000],
    [0.34, 0.060, 0.440, -0.180],
    [0.56, -0.040, -0.100, 0.500],
    [0.80, 0.000, 0.020, 0.200],
    [1.00, 0.000, 0.000, 0.000],
  ],
  turn: [
    [0.00, 0.000, 0.000, 0.000],
    [0.30, 0.300, 0.120, 0.000],
    [0.60, -0.150, 0.140, 0.350],
    [1.00, 0.000, 0.000, 0.000],
  ],
  lunge: [
    [0.00, 0.000, 0.000, 0.000],
    [0.28, 0.100, 0.060, -0.260],
    [0.50, -0.080, 0.120, 0.550],
    [1.00, 0.000, 0.000, 0.000],
  ],
  throwWind: [
    [0.00, 0.000, 0.000, 0.000],
    [0.30, 0.160, 0.340, -0.300],
    [0.44, -0.100, 0.230, 0.500],
    [0.62, -0.020, 0.080, 0.240],
    [1.00, 0.000, 0.000, 0.000],
  ],
  catch: [
    [0.00, 0.000, 0.000, 0.000],
    [0.25, -0.060, 0.190, 0.310],
    [0.60, 0.020, 0.050, 0.100],
    [1.00, 0.000, 0.000, 0.000],
  ],
};
/* The tower shield's guard, by blend rather than clock: inboard,
   up to the chest line, forward into a wall. */
const GUARD_OFFSET = { out: -0.045, up: 0.270, fwd: 0.240 };

function sampleTrack(track, u, out) {
  out.out = 0; out.up = 0; out.fwd = 0;
  if (!track || !track.length) return out;
  const t = clamp01(u);
  let i = 0;
  while (i < track.length - 2 && t >= track[i + 1][0]) i += 1;
  const a = track[i];
  const b = track[Math.min(track.length - 1, i + 1)];
  const span = Math.max(1e-5, b[0] - a[0]);
  const k = clamp01((t - a[0]) / span);
  out.out = a[1] + (b[1] - a[1]) * k;
  out.up = a[2] + (b[2] - a[2]) * k;
  out.fwd = a[3] + (b[3] - a[3]) * k;
  return out;
}

export function buildKenosisKit(ctx, player, loadout) {
  const { THREE } = ctx;
  const id = ctx.playerCharacter?.id || null;
  const KIT = KITS[id];
  if (!KIT || !loadout) return null;
  const isVigil = id === "white-vigil";
  const isBastion = id === "bastion-penitent";

  /* This is the line that arms melee on a weaponless level: both
     player.meleeSwing and combat.meleeStrike read it when there is
     no ctx.weapons. Published on the loadout object ctx.loadout
     points at. */
  loadout.meleeSpec = { ...KIT.melee };
  if (ctx.loadout && ctx.loadout !== loadout) ctx.loadout.meleeSpec = loadout.meleeSpec;

  /* ----------------------------------------------------------
     ARM OVERLAYS. The loadout's own hooks stay authoritative for
     the carry; the kit adds the swing on top. Wrapped ONCE, here,
     after summit-main has pointed ctx.loadout at the loadout's
     returned object - the same late-patch pattern the loadout
     itself uses for handBasis.
     ---------------------------------------------------------- */
  const overlay = { out: 0, up: 0, fwd: 0 };
  const guard = { blend: 0 };

  /* Which fists a named swing animates. The Vigil alternates blades
     through the procession; the Bastion's every blow is the hammer
     hand, with the shield hand holding its wall. */
  function strikingHands(name) {
    if (isBastion) return HANDS_1;
    if (name === "melee1" || name === "meleeLunge") return HANDS_1;
    if (name === "melee2") return HANDS_0;
    return HANDS_BOTH;
  }
  const HANDS_0 = [0];
  const HANDS_1 = [1];
  const HANDS_BOTH = [0, 1];

  function trackFor(name) {
    if (isVigil) {
      if (name === "meleeTurn" || name === "meleeTurnCw") return VIGIL_TRACKS.turn;
      if (name === "meleeLunge") return VIGIL_TRACKS.lunge;
      return VIGIL_TRACKS.strike;
    }
    if (name === "melee1") return BASTION_TRACKS.sweep;
    if (name === "melee2") return BASTION_TRACKS.rise;
    if (name === "melee3") return BASTION_TRACKS.crown;
    if (name === "meleeTurn" || name === "meleeTurnCw") return BASTION_TRACKS.turn;
    if (name === "meleeLunge") return BASTION_TRACKS.lunge;
    if (name === "hammerThrow") return BASTION_TRACKS.throwWind;
    if (name === "hammerCatch") return BASTION_TRACKS.catch;
    return null;
  }

  function overlayArm(i, out) {
    /* The RECORD, not the name - the overlay runs on the clip's own
       clock. (`player.action` answers only the name; reading `.t` off
       a string is the exact silent no-op the fail-silent memory
       warns about, and it was this module's first shipped bug.) */
    const action = player.actionState;
    const side = i === 0 ? 1 : -1;
    if (action?.name && action.spec) {
      const track = trackFor(action.name);
      if (track && strikingHands(action.name).includes(i)) {
        const u = action.t / Math.max(1e-4, action.spec.dur);
        sampleTrack(track, u, overlay);
        /* A mirrored spin leads with the other edge. */
        const mirror = action.name === "meleeTurnCw" ? -1 : 1;
        out.x += side * overlay.out * mirror;
        out.y += overlay.up;
        out.z += overlay.fwd;
      }
    }
    if (isBastion && i === 0 && guard.blend > 0.001) {
      out.x += side * GUARD_OFFSET.out * guard.blend;
      out.y += GUARD_OFFSET.up * guard.blend;
      out.z += GUARD_OFFSET.fwd * guard.blend;
    }
  }

  function overlaySwingScale(i) {
    const action = player.actionState;
    let scale = 1;
    if (action?.name && trackFor(action.name)
      && strikingHands(action.name).includes(i)) scale = 0.12;
    if (isBastion && i === 0 && guard.blend > 0.001) {
      scale = Math.min(scale, 1 - guard.blend * 0.95);
    }
    return scale;
  }

  const baseArmPose = ctx.loadout.armPose;
  const baseArmSwing = ctx.loadout.armSwing;
  ctx.loadout.armPose = (i, out, gait) => {
    baseArmPose?.(i, out, gait);
    overlayArm(i, out);
  };
  ctx.loadout.armSwing = (i) => {
    const base = baseArmSwing ? baseArmSwing(i) : 1;
    const carried = Number.isFinite(base) ? base : 1;
    return carried * overlaySwingScale(i);
  };

  /* ----------------------------------------------------------
     THE VIGIL STEP.
     ---------------------------------------------------------- */
  const blink = {
    charges: KIT.blink?.charges ?? 0,
    maxCharges: KIT.blink?.charges ?? 0,
    rechargeIn: 0,
    casts: 0,
    lastReason: null,
    lastDistance: 0,
  };
  const blinkFrom = new THREE.Vector3();

  function tryBlink() {
    if (!isVigil) return false;
    const ps = player.state;
    const reason = ctx.combat?.player?.dead ? "dead"
      : ps.free ? "free-camera"
        : (ps.stunFor || 0) > 0 ? "stunned"
          : player.action ? "busy"
            : ctx.jetpack?.state?.inFlight ? "flight"
              : ctx.boost?.state?.active ? "boosting"
                : ctx.slam?.state?.active ? "slam"
                  : !ps.grounded ? "airborne"
                    : blink.charges < 1 ? "no-charge" : null;
    if (reason) {
      blink.lastReason = reason;
      ctx.audio?.blip?.(220, 0.05, 0.07, "square");
      return false;
    }
    /* Direction is the stick's, in camera space; an idle stick steps
       straight ahead of the lens. `move.y` is -1 for a held W. */
    const mv = player.input?.state?.move || { x: 0, y: 0 };
    const camYaw = ps.camYaw;
    let dx; let dz;
    if (Math.hypot(mv.x, mv.y) > 0.25) {
      const f = -mv.y;
      const s = mv.x;
      dx = Math.sin(camYaw) * f + Math.cos(camYaw) * s;
      dz = Math.cos(camYaw) * f - Math.sin(camYaw) * s;
    } else {
      dx = Math.sin(camYaw);
      dz = Math.cos(camYaw);
    }
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    blinkFrom.set(ps.x, ps.y, ps.z);
    /* `player.drag` is the one displacement primitive that already
       respects the collision field: it slides, refuses walls and
       impossible grades, and reports how far the body actually went.
       A step the world mostly refuses is not paid for. */
    const moved = player.drag?.(dx * KIT.blink.range, dz * KIT.blink.range) ?? 0;
    if (moved < 1.0) {
      blink.lastReason = "blocked";
      ctx.audio?.blip?.(220, 0.05, 0.07, "square");
      return false;
    }
    const gy = ctx.collide?.groundHeight?.(ps.x, ps.z);
    if (Number.isFinite(gy)) ps.y = gy;
    blink.charges -= 1;
    if (blink.rechargeIn <= 0) blink.rechargeIn = KIT.blink.recharge;
    blink.casts += 1;
    blink.lastReason = null;
    blink.lastDistance = moved;
    ps.speed = Math.max(ps.speed || 0, KIT.blink.exitSpeed);
    ctx.vfx?.blinkFx?.(blinkFrom.x, blinkFrom.y, blinkFrom.z, ps.x, ps.y, ps.z);
    ctx.audio?.blinkCast?.(blinkFrom.x, blinkFrom.z);
    ctx.audio?.blinkArrive?.(ps.x, ps.z);
    player.punch?.(0.4);
    return true;
  }

  /* ----------------------------------------------------------
     THE TOWER SHIELD - a ctx.shield-compatible module. The player
     controller gets its shield walk (slow, camera-faced) and
     combat.hurtPlayer gets its tryBlock for free; what changes
     from the Aegis is the economics (no drain, no cooldown, no
     charge floor) and the geometry (a wider frontal wall, never a
     dome).
     ---------------------------------------------------------- */
  const blockConfig = isBastion ? {
    drainRate: 0,
    moveSpeed: KIT.block.moveSpeed,
    frontDot: KIT.block.frontDot,
    distance: KIT.block.distance,
    centreY: KIT.block.centreY,
    perfectWindow: KIT.block.perfectWindow,
  } : null;
  const blockState = {
    active: false,
    requested: false,
    activeFor: 0,
    raises: 0,
    blocks: 0,
    absorbed: 0,
    perfectBlocks: 0,
    blockedReason: null,
    lastBlock: null,
    lastAttempt: null,
  };

  function blockBeginFrame(dt, ps, inputState) {
    blockState.requested = !!inputState.block;
    const reason = ctx.combat?.player?.dead ? "dead"
      : ps.free ? "free-camera"
        : !ps.grounded ? "airborne"
          : player.action ? "busy"
            : ctx.boost?.state?.active ? "boosting"
              : ctx.slam?.state?.active ? "slam"
                : (ps.stunFor || 0) > 0 ? "stunned" : null;
    const wasActive = blockState.active;
    blockState.active = blockState.requested && !reason;
    blockState.blockedReason = blockState.requested ? reason : null;
    if (blockState.active) {
      if (!wasActive) {
        blockState.raises += 1;
        blockState.activeFor = 0;
        ctx.audio?.blip?.(180, 0.06, 0.08, "triangle");
      }
      blockState.activeFor += dt;
    } else {
      blockState.activeFor = 0;
    }
    guard.blend += ((blockState.active ? 1 : 0) - guard.blend)
      * (1 - Math.exp(-(blockState.active ? 14 : 9) * Math.max(0, dt)));
    return { active: blockState.active, moveSpeed: blockConfig.moveSpeed };
  }

  function blockVerdict(sourceX, sourceZ, guardType = GUARD_TYPES.FRONTAL) {
    if (!blockState.active) return { ok: false, reason: "inactive" };
    if (guardType === GUARD_TYPES.UNBLOCKABLE) return { ok: false, reason: "unblockable" };
    if (!Number.isFinite(sourceX) || !Number.isFinite(sourceZ)) {
      return { ok: false, reason: "no-origin" };
    }
    const ps = player.state;
    const dx = sourceX - ps.x;
    const dz = sourceZ - ps.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-5) return { ok: false, reason: "no-direction" };
    if (guardType === GUARD_TYPES.PERFECT_ONLY
      && blockState.activeFor > blockConfig.perfectWindow) {
      return { ok: false, reason: "perfect-timing" };
    }
    const dot = (dx * Math.sin(ps.yaw) + dz * Math.cos(ps.yaw)) / distance;
    return dot >= blockConfig.frontDot
      ? { ok: true, reason: "frontal", dot }
      : { ok: false, reason: "angle", dot };
  }

  function blockTryBlock(amount, detail = {}) {
    if (!(amount > 0)) return false;
    const normalized = normalizeGuardDetail(detail, player.state);
    const verdict = blockVerdict(normalized.originX, normalized.originZ,
      normalized.guardType);
    blockState.lastAttempt = {
      ok: verdict.ok,
      reason: verdict.reason,
      guardType: normalized.guardType,
      activeFor: blockState.activeFor,
    };
    if (!verdict.ok) return false;
    const perfect = blockState.activeFor <= blockConfig.perfectWindow;
    blockState.blocks += 1;
    blockState.absorbed += amount;
    if (perfect) blockState.perfectBlocks += 1;
    blockState.lastBlock = {
      perfect,
      amount,
      timing: {
        elapsedSeconds: blockState.activeFor,
        windowSeconds: blockConfig.perfectWindow,
      },
    };
    const ps = player.state;
    const nx = Math.sin(ps.yaw);
    const nz = Math.cos(ps.yaw);
    const fx = ps.x + nx * blockConfig.distance;
    const fz = ps.z + nz * blockConfig.distance;
    if (ctx.vfx?.shieldBlock) {
      ctx.vfx.shieldBlock(fx, ps.y + blockConfig.centreY, fz, nx, nz,
        perfect, amount, false);
    } else {
      ctx.vfx?.spark?.(fx, ps.y + blockConfig.centreY, fz, 1.3, false, true);
    }
    ctx.audio?.blockImpact?.(ps.x, ps.z, perfect);
    player.doctrineKick?.(perfect ? 0.42 : 0.26, 0.85);
    return true;
  }

  const blockModule = isBastion ? {
    config: blockConfig,
    state: blockState,
    beginFrame: blockBeginFrame,
    blockVerdict,
    blocksFrom: (x, z, guardType) => blockVerdict(x, z, guardType).ok,
    tryBlock: blockTryBlock,
    lastBlock: () => blockState.lastBlock,
    lastAttempt: () => blockState.lastAttempt,
    updateVisual: () => {},
    reset: () => {
      blockState.active = false;
      blockState.requested = false;
      blockState.activeFor = 0;
      guard.blend = 0;
    },
    status: () => ({
      active: blockState.active,
      requested: blockState.requested,
      activeFor: Number(blockState.activeFor.toFixed(3)),
      raises: blockState.raises,
      blocks: blockState.blocks,
      absorbed: Math.round(blockState.absorbed),
      perfectBlocks: blockState.perfectBlocks,
      blockedReason: blockState.blockedReason,
      frontDot: blockConfig.frontDot,
      guardBlend: Number(guard.blend.toFixed(3)),
    }),
  } : null;

  /* ----------------------------------------------------------
     THE HAMMER CAST.
     ---------------------------------------------------------- */
  const hammer = {
    phase: "held",           // held | windup | out | return
    cooldown: 0,
    distance: 0,
    casts: 0,
    hits: 0,
    grounded: 0,             // flyers knocked down, lifetime
    catches: 0,
    lastReason: null,
    pendingLaunch: false,
    wakeAt: 0,
    spinPhase: 0,
  };
  const hammerPart = isBastion
    ? (loadout.parts || []).find((part) => part.spec.id === "bastion-hammer") || null
    : null;
  const hammerPos = new THREE.Vector3();
  const hammerVel = new THREE.Vector3();
  const hammerStep = new THREE.Vector3();
  const hammerAim = new THREE.Vector3();
  const handWorld = new THREE.Vector3();
  const spinAxis = new THREE.Vector3();
  const alignQ = new THREE.Quaternion();
  const spinQ = new THREE.Quaternion();
  const AX = new THREE.Vector3(1, 0, 0);
  let hammerVisual = null;
  const hammerHits = new Set();

  function buildHammerVisual() {
    if (hammerVisual || !hammerPart) return;
    const wrap = new THREE.Group();
    wrap.name = "kenosis-hammer-cast";
    const clone = hammerPart.asset.clone(true);
    clone.position.set(0, 0, 0);
    clone.quaternion.identity();
    wrap.add(clone);
    wrap.visible = false;
    ctx.scene.add(wrap);
    wrap.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrap);
    const centre = box.getCenter(new THREE.Vector3());
    clone.position.sub(centre);
    hammerVisual = wrap;
  }

  function handPosition(out) {
    const pivot = player.figure?.palmLocators?.[1] || player.figure?.handPivots?.[1];
    if (!pivot) return out.set(player.state.x, player.state.y + 1.2, player.state.z);
    return pivot.getWorldPosition(out);
  }

  function tryThrowHammer() {
    if (!isBastion || !hammerPart) return false;
    const ps = player.state;
    const reason = ctx.combat?.player?.dead ? "dead"
      : ps.free ? "free-camera"
        : (ps.stunFor || 0) > 0 ? "stunned"
          : hammer.phase !== "held" ? "hammer-away"
            : hammer.cooldown > 0 ? "cooldown"
              : blockState.active ? "guarding"
                : player.action ? "busy"
                  : ctx.slam?.state?.active ? "slam"
                    : ctx.boost?.state?.active ? "boosting" : null;
    if (reason) {
      hammer.lastReason = reason;
      ctx.audio?.blip?.(200, 0.05, 0.07, "square");
      return false;
    }
    player.beginAction?.("hammerThrow");
    hammer.phase = "windup";
    hammer.pendingLaunch = true;
    hammer.lastReason = null;
    return true;
  }

  function launchHammer() {
    buildHammerVisual();
    handPosition(handWorld);
    /* Aimed exactly like the crescents: at the camera's convergence
       point, so the reticle is the promise. Falls back to the body's
       own facing if the loadout cannot supply a camera. */
    const aimed = loadout.aimPoint?.(hammerAim) || null;
    if (aimed) {
      hammerVel.copy(hammerAim).sub(handWorld);
    } else {
      const ps = player.state;
      hammerVel.set(Math.sin(ps.yaw), 0, Math.cos(ps.yaw));
    }
    if (hammerVel.lengthSq() < 1e-8) hammerVel.set(0, 0, 1);
    hammerVel.normalize().multiplyScalar(KIT.hammer.speed);
    hammerPos.copy(handWorld);
    hammerHits.clear();
    hammer.phase = "out";
    hammer.distance = 0;
    hammer.casts += 1;
    hammer.cooldown = KIT.hammer.cooldown;
    hammer.spinPhase = 0;
    if (hammerPart.asset) hammerPart.asset.visible = false;
    if (hammerVisual) hammerVisual.visible = true;
    ctx.audio?.hammerThrow?.(handWorld.x, handWorld.z);
    player.punch?.(0.5);
  }

  function hammerImpact(x, y, z, heavy) {
    ctx.vfx?.hammerImpactFx?.(x, y, z, heavy);
    ctx.audio?.hammerImpact?.(x, z, heavy);
    if (heavy) player.doctrineKick?.(0.4, 0.9);
  }

  /* One flight substep of at most `maxStep` metres: walls, enemies
     and trials targets, in that order. Returns false when the flight
     ended (wall) - enemies are pierced, not stopped. */
  function sweepHammer(stepLen, returning) {
    const dirX = hammerVel.x; const dirY = hammerVel.y; const dirZ = hammerVel.z;
    const mag = Math.hypot(dirX, dirY, dirZ) || 1;
    const ux = dirX / mag; const uy = dirY / mag; const uz = dirZ / mag;
    if (!returning) {
      /* rayBlock answers in METRES - the distance to the first wall,
         or Infinity for a clear line. */
      const wallAt = ctx.collide?.rayBlock?.(hammerPos.x, hammerPos.y, hammerPos.z,
        ux, uy, uz, stepLen) ?? Infinity;
      if (Number.isFinite(wallAt) && wallAt <= stepLen) {
        const d = Math.max(0.1, wallAt - 0.2);
        hammerImpact(hammerPos.x + ux * d, hammerPos.y + uy * d,
          hammerPos.z + uz * d, false);
        beginHammerReturn();
        return false;
      }
    }
    if (ctx.combat?.raycastEnemies) {
      /* March the ray past every body it finds inside the step - the
         cast goes THROUGH the line, that is the point of it. */
      let from = 0;
      for (let guardCount = 0; guardCount < 6 && from < stepLen; guardCount += 1) {
        const hit = ctx.combat.raycastEnemies(
          hammerPos.x + ux * from, hammerPos.y + uy * from, hammerPos.z + uz * from,
          ux, uy, uz, stepLen - from);
        if (!hit || !hit.inst) break;
        from += Math.max(0.35, hit.t + 0.35);
        if (hammerHits.has(hit.inst)) continue;
        hammerHits.add(hit.inst);
        const dmg = returning ? KIT.hammer.returnDamage : KIT.hammer.damage;
        ctx.combat.damageEnemy(hit.inst, dmg, {
          source: "hammer-cast", x: hit.x, y: hit.y, z: hit.z,
          head: !!hit.head, weak: !!hit.weak,
        });
        const downed = ctx.combat.groundFlyer?.(hit.inst,
          { stun: KIT.hammer.knockdownStun });
        if (downed) hammer.grounded += 1;
        ctx.enemies?.knockback?.(hit.inst, ux, uz, KIT.hammer.knockback);
        hammer.hits += 1;
        hammerImpact(hit.x, hit.y, hit.z, true);
      }
    }
    if (ctx.trials?.sweep) {
      const swept = ctx.trials.sweep(hammerPos.x, hammerPos.y, hammerPos.z,
        ux, uy, uz, stepLen, {
          damage: returning ? KIT.hammer.returnDamage : KIT.hammer.damage,
          stun: KIT.hammer.knockdownStun,
          knockdown: true,
          exclude: hammerHits,
        });
      if (swept) {
        for (const swipe of swept) {
          hammerHits.add(swipe.target);
          hammer.hits += 1;
          hammerImpact(swipe.x, swipe.y, swipe.z, true);
          hammer.grounded += swipe.grounded ? 1 : 0;
        }
      }
    }
    return true;
  }

  function beginHammerReturn() {
    hammer.phase = "return";
    hammerHits.clear();
  }

  function catchHammer() {
    hammer.phase = "held";
    hammer.catches += 1;
    if (hammerVisual) hammerVisual.visible = false;
    if (hammerPart?.asset) hammerPart.asset.visible = true;
    const ps = player.state;
    ctx.audio?.hammerCatch?.(ps.x, ps.z);
    ctx.vfx?.spark?.(handWorld.x, handWorld.y, handWorld.z, 0.9, false, true);
    if (!player.action) player.beginAction?.("hammerCatch");
    player.punch?.(0.3);
  }

  function updateHammer(dt) {
    if (!isBastion) return;
    hammer.cooldown = Math.max(0, hammer.cooldown - dt);
    const action = player.actionState;
    if (hammer.pendingLaunch) {
      if (!action?.name || action.name !== "hammerThrow") {
        /* The wind-up was cut (stun, death): the cast never happened
           and the rite is not spent. */
        hammer.pendingLaunch = false;
        if (hammer.phase === "windup") hammer.phase = "held";
      } else {
        const releaseAt = action.spec?.throwAt ?? 0.40;
        if (action.t >= releaseAt) {
          hammer.pendingLaunch = false;
          launchHammer();
        }
      }
    }
    if (hammer.phase === "out") {
      const step = Math.max(1e-4, KIT.hammer.speed * dt);
      let remaining = step;
      let flying = true;
      while (flying && remaining > 1e-4) {
        const sub = Math.min(0.6, remaining);
        flying = sweepHammer(sub, false);
        if (!flying) break;
        hammerStep.copy(hammerVel).normalize().multiplyScalar(sub);
        hammerPos.add(hammerStep);
        hammer.distance += sub;
        remaining -= sub;
        const ground = ctx.collide?.groundHeight?.(hammerPos.x, hammerPos.z);
        if (Number.isFinite(ground) && hammerPos.y <= ground + 0.25) {
          hammerPos.y = ground + 0.3;
          hammerImpact(hammerPos.x, ground + 0.15, hammerPos.z, false);
          beginHammerReturn();
          flying = false;
        } else if (hammer.distance >= KIT.hammer.range) {
          beginHammerReturn();
          flying = false;
        }
      }
    } else if (hammer.phase === "return") {
      handPosition(handWorld);
      hammerVel.copy(handWorld).sub(hammerPos);
      const dist = hammerVel.length();
      const step = KIT.hammer.returnSpeed * dt;
      if (dist <= Math.max(1.4, step)) {
        hammerPos.copy(handWorld);
        catchHammer();
      } else {
        hammerVel.normalize().multiplyScalar(KIT.hammer.returnSpeed);
        sweepHammer(Math.min(0.6, step), true);
        hammerStep.copy(hammerVel).normalize().multiplyScalar(step);
        hammerPos.add(hammerStep);
      }
    }
    if ((hammer.phase === "out" || hammer.phase === "return") && hammerVisual) {
      hammer.spinPhase += dt * 17;
      hammerVisual.position.copy(hammerPos);
      /* End over end: aligned to the flight, spun about the lateral
         axis so the head leads twice a revolution. */
      const speed = hammerVel.length() || 1;
      alignQ.setFromUnitVectors(AX,
        hammerStep.copy(hammerVel).multiplyScalar(1 / speed));
      spinAxis.set(-hammerVel.z, 0, hammerVel.x).normalize();
      if (spinAxis.lengthSq() < 0.5) spinAxis.set(0, 0, 1);
      spinQ.setFromAxisAngle(spinAxis, hammer.spinPhase);
      hammerVisual.quaternion.copy(spinQ).multiply(alignQ);
      hammerVisual.updateMatrixWorld(true);
      hammer.wakeAt -= dt;
      if (hammer.wakeAt <= 0) {
        hammer.wakeAt = 0.05;
        ctx.vfx?.hammerWake?.(hammerPos.x, hammerPos.y, hammerPos.z,
          hammerVel.x / speed, hammerVel.y / speed, hammerVel.z / speed);
      }
    }
  }

  /* ----------------------------------------------------------
     INPUT. The kit is this level's one consumer of the player's
     buffered input events (the campaign's main.js is not here),
     plus edge-detection on the two held states that double as
     ability triggers: RMB for the Bastion's cast, E for the
     Vigil's step, LMB for the Bastion's swing.
     ---------------------------------------------------------- */
  let prevAds = false;
  let prevBlock = false;
  let prevFiring = false;

  function airborne() {
    return !player.state.grounded;
  }

  function routeMeleePress(aimYaw) {
    if (ctx.slam?.state?.active) return;
    if (isBastion && blockState.active) return;
    if (isBastion && hammer.phase !== "held") {
      hammer.lastReason = "hammer-away";
      ctx.audio?.blip?.(200, 0.05, 0.06, "square");
      return;
    }
    player.meleeSwing?.(aimYaw);
  }

  function update(dt) {
    const dead = !!ctx.combat?.player?.dead;
    const stunned = (player.state.stunFor || 0) > 0;
    const events = player.input?.drain?.() || [];
    for (const ev of events) {
      if (dead || stunned || player.state.free) continue;
      if (ev.type === "boost") {
        if (!ctx.jetpack?.state?.inFlight) ctx.boost?.trigger?.();
        continue;
      }
      if (ev.type === "melee") {
        /* One key, two rites, decided by altitude - exactly the
           campaign's routing: a press in the air is the Fall, and a
           refused Fall falls back to the swing. */
        if (airborne()) {
          if (ctx.slam?.trigger?.()) continue;
          if (ctx.jetpack?.state?.inFlight || ctx.slam?.state?.active) continue;
        }
        routeMeleePress(ev.aimYaw);
      }
    }
    const input = player.input?.state || {};
    if (!dead && !stunned && !player.state.free) {
      if (isBastion && input.ads && !prevAds) tryThrowHammer();
      if (isVigil && input.block && !prevBlock) tryBlink();
      if (isBastion && input.firing && !prevFiring) {
        routeMeleePress(player.state.aimViewYaw);
      }
    }
    prevAds = !!input.ads;
    prevBlock = !!input.block;
    prevFiring = !!input.firing;

    if (isVigil && blink.charges < blink.maxCharges) {
      blink.rechargeIn -= dt;
      if (blink.rechargeIn <= 0) {
        blink.charges += 1;
        blink.rechargeIn = blink.charges < blink.maxCharges
          ? KIT.blink.recharge : 0;
        ctx.audio?.blip?.(660, 0.05, 0.05, "triangle");
      }
    }
    updateHammer(dt);
  }

  function reset() {
    blink.charges = blink.maxCharges;
    blink.rechargeIn = 0;
    if (isBastion) {
      hammer.cooldown = 0;
      hammer.pendingLaunch = false;
      if (hammer.phase !== "held") {
        hammer.phase = "held";
        if (hammerVisual) hammerVisual.visible = false;
        if (hammerPart?.asset) hammerPart.asset.visible = true;
      }
      blockModule?.reset();
    }
  }

  function status() {
    return {
      id,
      doctrine: KIT.doctrine,
      meleeSpec: { ...loadout.meleeSpec },
      blink: isVigil ? {
        charges: blink.charges,
        maxCharges: blink.maxCharges,
        rechargeIn: Number(blink.rechargeIn.toFixed(2)),
        rechargeSeconds: KIT.blink.recharge,
        rangeM: KIT.blink.range,
        casts: blink.casts,
        lastReason: blink.lastReason,
        lastDistance: Number(blink.lastDistance.toFixed(2)),
      } : null,
      hammer: isBastion ? {
        phase: hammer.phase,
        cooldown: Number(hammer.cooldown.toFixed(2)),
        cooldownSeconds: KIT.hammer.cooldown,
        casts: hammer.casts,
        hits: hammer.hits,
        grounded: hammer.grounded,
        catches: hammer.catches,
        distance: Number(hammer.distance.toFixed(2)),
        lastReason: hammer.lastReason,
        position: hammer.phase === "out" || hammer.phase === "return"
          ? hammerPos.toArray().map((value) => Number(value.toFixed(2))) : null,
      } : null,
      block: blockModule ? blockModule.status() : null,
      discharge: isVigil ? { ...KIT.discharge } : null,
    };
  }

  return {
    id,
    doctrine: KIT.doctrine,
    dischargeSpec: isVigil ? { ...KIT.discharge } : null,
    blockModule,
    update,
    reset,
    status,
    /* Direct verbs for the harness - the same paths the inputs take. */
    tryBlink,
    tryThrowHammer,
  };
}
