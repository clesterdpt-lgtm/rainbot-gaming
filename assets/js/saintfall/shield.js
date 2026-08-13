/* ============================================================
   SAINTFALL - Aegis energy shield

   A held, forward-facing defence powered by the reliquary pack.
   Combat still owns health; this module owns the shared-charge
   drain, frontal-cone decision, impact state and world visual.
   ============================================================ */

import { clamp01, damp } from "saintfall/core.js";

export const SHIELD_CONFIG = Object.freeze({
  drainRate: 18,
  moveSpeed: 3.0,
  frontDot: 0.42,
  distance: 0.94,
  centreY: 1.08,
  perfectWindow: 0.25,
  domeRadius: 2.62,
});

function makeShieldShape(THREE) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 1.04);
  shape.lineTo(0.48, 0.87);
  shape.lineTo(0.76, 0.54);
  shape.lineTo(0.88, 0.10);
  shape.lineTo(0.72, -0.62);
  shape.lineTo(0, -1.05);
  shape.lineTo(-0.72, -0.62);
  shape.lineTo(-0.88, 0.10);
  shape.lineTo(-0.76, 0.54);
  shape.lineTo(-0.48, 0.87);
  shape.closePath();
  return new THREE.ShapeGeometry(shape, 1);
}

function makeRunes(THREE, material) {
  const points = [
    -0.66, 0.47, 0.012, 0.66, 0.47, 0.012,
    -0.78, 0.08, 0.012, 0.78, 0.08, 0.012,
    -0.61, -0.39, 0.012, 0.61, -0.39, 0.012,
    0, 0.78, 0.014, 0, -0.73, 0.014,
    -0.31, 0.28, 0.014, 0, 0.58, 0.014,
    0, 0.58, 0.014, 0.31, 0.28, 0.014,
    -0.31, -0.15, 0.014, 0, -0.46, 0.014,
    0, -0.46, 0.014, 0.31, -0.15, 0.014,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geometry, material);
}

function buildVisual(ctx) {
  const { THREE, scene } = ctx;
  const root = new THREE.Group();
  root.name = "aegis-shield-root";
  root.userData.equipment = "aegis-shield";
  root.visible = false;

  const geometry = makeShieldShape(THREE);
  const surfaceMaterial = new THREE.MeshBasicMaterial({
    name: "aegis-energy-surface",
    color: 0xffb52f,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const surface = new THREE.Mesh(geometry, surfaceMaterial);
  surface.name = "aegis-energy-plane";
  surface.renderOrder = 8;
  root.add(surface);

  const glowMaterial = surfaceMaterial.clone();
  glowMaterial.name = "aegis-energy-glow";
  glowMaterial.color.setHex(0xffd56a);
  const glow = new THREE.Mesh(geometry, glowMaterial);
  glow.name = "aegis-inner-glow";
  glow.position.z = -0.018;
  glow.scale.set(0.91, 0.91, 1);
  glow.renderOrder = 9;
  root.add(glow);

  const lineMaterial = new THREE.LineBasicMaterial({
    name: "aegis-gold-lines",
    color: 0xffe29a,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 18), lineMaterial);
  edge.name = "aegis-gold-border";
  edge.position.z = 0.018;
  edge.renderOrder = 10;
  root.add(edge);

  const runeMaterial = lineMaterial.clone();
  runeMaterial.name = "aegis-rune-lines";
  runeMaterial.color.setHex(0xffc34f);
  const runes = makeRunes(THREE, runeMaterial);
  runes.name = "aegis-runes";
  runes.renderOrder = 10;
  root.add(runes);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.31, 0.012, 5, 28),
    new THREE.MeshBasicMaterial({
      name: "aegis-seal-ring-energy",
      color: 0xffedb2,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
  );
  ring.name = "aegis-seal-ring";
  ring.position.z = 0.024;
  ring.renderOrder = 11;
  root.add(ring);

  /* THE LIGHT HANGS OFF THE SCENE, NOT OFF THE PLATE.
     three keys every material's compiled program on the NUMBER of
     lights it can see, so a point light that appears when the plate
     is revealed takes the visible count from 15 to 16 and invalidates
     the program of every material in the level at once. Measured:
     30 shaders recompiling inside the single frame the player raised
     the Aegis - a 198ms freeze on the exact input pressed to survive
     something.

     Parented to the scene it is always counted, so the count never
     changes and nothing ever recompiles. It contributes nothing while
     idle because `updateVisual` holds its intensity at zero, and it
     is driven to the plate's world position when the plate is up. */
  const light = new THREE.PointLight(0xffb43d, 0, 3.8, 2);
  light.name = "aegis-gold-light";
  scene.add(light);

  scene.add(root);

  /* Seraph Aegis is not a larger flat plate. Its silhouette has to
     communicate the mechanical change from a forward guard to true
     all-round cover, even when the camera is behind the player. Keep
     it as a separate world-space visual so the ordinary plate can
     crossfade without inheriting the dome's scale or orientation. */
  const domeRoot = new THREE.Group();
  domeRoot.name = "seraph-aegis-dome-root";
  domeRoot.userData.equipment = "seraph-aegis";
  domeRoot.visible = false;

  const domeGeometry = new THREE.SphereGeometry(
    SHIELD_CONFIG.domeRadius, 32, 18, 0, Math.PI * 2, 0, Math.PI * 0.52
  );
  const domeMaterial = new THREE.MeshBasicMaterial({
    name: "seraph-aegis-surface",
    color: 0x86d8ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const domeSurface = new THREE.Mesh(domeGeometry, domeMaterial);
  domeSurface.name = "seraph-aegis-surface";
  domeSurface.renderOrder = 7;
  domeRoot.add(domeSurface);

  const domeGridMaterial = domeMaterial.clone();
  domeGridMaterial.name = "seraph-aegis-grid";
  domeGridMaterial.color.setHex(0xd8f4ff);
  domeGridMaterial.wireframe = true;
  const domeGrid = new THREE.Mesh(domeGeometry, domeGridMaterial);
  domeGrid.name = "seraph-aegis-grid";
  domeGrid.scale.setScalar(1.004);
  domeGrid.renderOrder = 8;
  domeRoot.add(domeGrid);

  const domeRingMaterial = new THREE.MeshBasicMaterial({
    name: "seraph-aegis-ground-seal",
    color: 0xffd978,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const domeRing = new THREE.Mesh(
    new THREE.TorusGeometry(SHIELD_CONFIG.domeRadius * 0.95, 0.026, 5, 64),
    domeRingMaterial
  );
  domeRing.name = "seraph-aegis-ground-seal";
  domeRing.rotation.x = Math.PI * 0.5;
  domeRing.position.y = 0.035;
  domeRing.renderOrder = 9;
  domeRoot.add(domeRing);

  // Scene-parented for the same reason as the gold light above: a
  // stable light count is what keeps the dome from costing a second
  // full shader recompile the first time it forms.
  const domeLight = new THREE.PointLight(0x83d8ff, 0, 7.5, 2);
  domeLight.name = "seraph-aegis-light";
  scene.add(domeLight);
  scene.add(domeRoot);

  return {
    root,
    surface,
    glow,
    edge,
    runes,
    ring,
    light,
    domeRoot,
    domeSurface,
    domeGrid,
    domeRing,
    domeLight,
    materials: { surface: surfaceMaterial, glow: glowMaterial, line: lineMaterial,
      runes: runeMaterial, ring: ring.material, dome: domeMaterial,
      domeGrid: domeGridMaterial, domeRing: domeRingMaterial },
  };
}

export function buildShield(ctx, player) {
  const config = SHIELD_CONFIG;
  const visual = buildVisual(ctx);
  const state = {
    requested: false,
    active: false,
    needsRelease: false,
    pose: 0,
    impact: 0,
    activeFor: 0,
    lastDrain: 0,
    drainMultiplier: 1,
    moveSpeed: config.moveSpeed,
    movementLocked: false,
    omniDirectional: false,
    mode: "plate",
    dome: false,
    domePose: 0,
    modifierSource: "",
    blocks: 0,
    absorbed: 0,
    sessionBlocks: 0,
    sessionAbsorbed: 0,
    lastAmount: 0,
    lastBlock: null,
    lastRelease: null,
    lastReason: "ready",
  };

  function reset(full = true) {
    /* Both keyboard and touch share the same software-gated state. A touch
       guard held through respawn/load must be released before it can raise
       Aegis again, exactly like a physically held X key. */
    const held = !!player.input?.state?.block || !!player.input?.keys?.has("KeyX");
    state.requested = false;
    state.active = false;
    state.needsRelease = held;
    state.pose = 0;
    state.impact = 0;
    state.activeFor = 0;
    state.lastDrain = 0;
    state.drainMultiplier = 1;
    state.moveSpeed = config.moveSpeed;
    state.movementLocked = false;
    state.omniDirectional = false;
    state.mode = "plate";
    state.dome = false;
    state.domePose = 0;
    state.modifierSource = "";
    state.sessionBlocks = 0;
    state.sessionAbsorbed = 0;
    state.lastAmount = 0;
    state.lastBlock = null;
    state.lastRelease = null;
    state.lastReason = "ready";
    if (full) {
      state.blocks = 0;
      state.absorbed = 0;
    }
    visual.root.visible = false;
    visual.domeRoot.visible = false;
    // Scene-parented lights are not carried down by those flags.
    visual.light.intensity = 0;
    visual.domeLight.intensity = 0;
  }

  function blockedReason(playerState) {
    if (ctx.combat?.player?.dead) return "dead";
    if (state.needsRelease) return "release";
    if (playerState.free) return "free-camera";
    if (!playerState.grounded || ctx.jetpack?.state?.inFlight) return "airborne";
    if (ctx.boost?.state?.active) return "boosting";
    if (player.action || ctx.mission?.entry?.active || (ctx.weapons?.carry?.venting || 0) > 0) {
      return "busy";
    }
    if ((ctx.jetpack?.state?.fuel || 0) <= 1e-6) return "low-charge";
    if ((ctx.jetpack?.state?.cooldownRemaining || 0) > 0) return "cooldown";
    return "";
  }

  /** Called before jet ignition so a held shield owns the shared pack this frame. */
  function beginFrame(dt, playerState, inputState) {
    const wasActive = state.active;
    const previousActiveFor = state.activeFor;
    const previousMode = state.mode;
    const previousDome = state.dome;
    state.requested = !!inputState.block;
    if (!state.requested) state.needsRelease = false;
    state.impact = damp(state.impact, 0, 9, dt);
    const reason = state.requested ? blockedReason(playerState) : "released";
    state.active = false;
    state.lastDrain = 0;
    state.drainMultiplier = 1;
    state.moveSpeed = config.moveSpeed;
    state.movementLocked = false;
    state.omniDirectional = false;
    state.mode = "plate";
    state.dome = false;
    state.modifierSource = "";

    if (state.requested && !reason) {
      const movementInput = Math.hypot(
        Number(inputState?.move?.x) || 0,
        Number(inputState?.move?.y) || 0
      );
      const request = {
        dt,
        requested: true,
        wasActive,
        activeFor: previousActiveFor,
        playerX: playerState.x,
        playerY: playerState.y,
        playerZ: playerState.z,
        yaw: playerState.yaw,
        speed: Math.max(0, Number(playerState.speed) || 0),
        stationary: movementInput < 0.08 && Math.abs(Number(playerState.speed) || 0) < 0.2,
        movementInput,
        baseDrainRate: config.drainRate,
        baseMoveSpeed: config.moveSpeed,
        missionChanneling: !!ctx.mission?.state?.channelling,
      };
      const changed = ctx.progression?.modifyShieldFrame?.(request);
      if (changed && typeof changed === "object") {
        const drainMultiplier = Number(changed.drainMultiplier);
        if (Number.isFinite(drainMultiplier)) {
          state.drainMultiplier = Math.max(0.1, Math.min(4, drainMultiplier));
        }
        const moveSpeed = Number(changed.moveSpeed);
        if (Number.isFinite(moveSpeed)) {
          state.moveSpeed = Math.max(0, Math.min(config.moveSpeed, moveSpeed));
        }
        state.movementLocked = changed.movementLocked === true;
        state.omniDirectional = changed.omniDirectional === true;
        state.dome = changed.dome === true;
        state.mode = state.dome ? "dome" : "plate";
        state.modifierSource = typeof changed.source === "string"
          ? changed.source.slice(0, 48) : "";
      }
      if (state.movementLocked) state.moveSpeed = 0;
      if (state.dome) state.omniDirectional = true;

      const wanted = config.drainRate * state.drainMultiplier * dt;
      const used = ctx.jetpack?.drain?.(wanted) || 0;
      state.lastDrain = used;
      state.active = used > 1e-6;
      if (used + 1e-6 < wanted || (ctx.jetpack?.state?.fuel || 0) <= 1e-6) {
        state.needsRelease = true;
      }
      state.lastReason = state.active ? "blocking" : "low-charge";
    } else {
      state.lastReason = reason || "ready";
    }

    if (state.active) {
      if (!wasActive) {
        state.sessionBlocks = 0;
        state.sessionAbsorbed = 0;
      }
      state.activeFor = wasActive ? previousActiveFor + dt : dt;
    } else {
      state.activeFor = 0;
      if (wasActive) {
        const ps = player.state;
        const payload = {
          reason: state.lastReason,
          releasedByInput: !state.requested,
          activeFor: previousActiveFor,
          mode: previousMode,
          dome: previousDome,
          blocks: state.sessionBlocks,
          absorbed: state.sessionAbsorbed,
          lastBlock: state.lastBlock,
          x: ps.x,
          y: ps.y,
          z: ps.z,
          yaw: ps.yaw,
        };
        state.lastRelease = payload;
        ctx.progression?.onShieldRelease?.(payload);
      }
    }

    state.pose = damp(state.pose, state.active ? 1 : 0, state.active ? 22 : 15, dt);
    state.domePose = damp(state.domePose, state.active && state.dome ? 1 : 0,
      state.active && state.dome ? 10 : 13, dt);
    return state;
  }

  /**
   * Defend only the arc covered by the visible plate. The source must
   * be explicit: falls, scripted hazards and other source-less damage
   * do not become accidentally blockable just because X is held.
   */
  function blocksFrom(sourceX, sourceZ) {
    if (!state.active || !Number.isFinite(sourceX) || !Number.isFinite(sourceZ)) return false;
    const ps = player.state;
    const dx = sourceX - ps.x;
    const dz = sourceZ - ps.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-5) return false;
    if (state.omniDirectional) return true;
    const dot = (dx * Math.sin(ps.yaw) + dz * Math.cos(ps.yaw)) / distance;
    return dot >= config.frontDot;
  }

  function tryBlock(amount, detail = {}) {
    if (!(amount > 0) || !blocksFrom(detail.x, detail.z)) return false;
    const elapsedSeconds = Math.max(0, state.activeFor);
    const perfect = elapsedSeconds <= config.perfectWindow;
    const timing = {
      elapsedSeconds,
      elapsedMs: elapsedSeconds * 1000,
      windowSeconds: config.perfectWindow,
      windowMs: config.perfectWindow * 1000,
    };
    state.blocks += 1;
    state.absorbed += amount;
    state.sessionBlocks += 1;
    state.sessionAbsorbed += amount;
    state.lastAmount = amount;
    state.lastReason = "absorbed";
    state.impact = 1;
    const ps = player.state;
    const fx = ps.x + Math.sin(ps.yaw) * config.distance;
    const fz = ps.z + Math.cos(ps.yaw) * config.distance;
    ctx.vfx?.spark?.(fx, ps.y + config.centreY, fz, 1.18 + clamp01(amount / 70) * 0.54);
    const payload = {
      source: detail.source || "attack",
      enemyId: typeof detail.enemyId === "string" ? detail.enemyId : "",
      enemyKey: detail.enemyKey || detail.enemy || "",
      amount,
      absorbed: amount,
      perfect,
      timing,
      chargeSpent: state.lastDrain,
      blockIndex: state.blocks,
      x: detail.x,
      y: detail.y,
      z: detail.z,
      playerX: ps.x,
      playerY: ps.y,
      playerZ: ps.z,
      yaw: ps.yaw,
      mode: state.mode,
      dome: state.dome,
      sessionBlocks: state.sessionBlocks,
      sessionAbsorbed: state.sessionAbsorbed,
    };
    state.lastBlock = payload;
    ctx.progression?.onShieldBlock?.(payload);
    if (perfect) ctx.progression?.noteVerb?.("perfectGuard", payload);
    return true;
  }

  function updateVisual(dt) {
    /* On entry the plate folds into the dome. On release, suppress it
       until the dome has faded: independently damping both poses can
       otherwise reveal the ordinary front plate for two or three frames
       after an all-round guard is dropped. */
    const p = (!state.active && state.domePose > 0.01)
      ? 0 : state.pose * (1 - state.domePose);
    const root = visual.root;
    root.visible = p > 0.008;
    const ps = player.state;
    const pulse = state.impact;
    const shimmer = 0.5 + 0.5 * Math.sin((ps.clock || 0) * 15.5);
    if (root.visible) {
      root.position.set(
        ps.x + Math.sin(ps.yaw) * config.distance,
        ps.y + config.centreY,
        ps.z + Math.cos(ps.yaw) * config.distance
      );
      root.rotation.y = ps.yaw;
      root.scale.set(
        p * (0.94 + shimmer * 0.025 + pulse * 0.07),
        p * (0.90 + (1 - p) * 0.12 + pulse * 0.05),
        1
      );
      visual.surface.material.opacity = (0.13 + shimmer * 0.055 + pulse * 0.18) * p;
      visual.glow.material.opacity = (0.055 + shimmer * 0.025 + pulse * 0.11) * p;
      visual.edge.material.opacity = (0.60 + shimmer * 0.22 + pulse * 0.18) * p;
      visual.runes.material.opacity = (0.20 + shimmer * 0.22 + pulse * 0.34) * p;
      visual.ring.material.opacity = (0.42 + shimmer * 0.28 + pulse * 0.26) * p;
      visual.ring.rotation.z += dt * (0.65 + pulse * 2.4);
      /* The light is a sibling of the plate now, so it carries its own
         world placement - the 0.22m stand-off that used to be a local
         offset inside `root` has to be applied here. */
      visual.light.position.set(
        root.position.x - Math.sin(ps.yaw) * 0.22,
        root.position.y,
        root.position.z - Math.cos(ps.yaw) * 0.22
      );
      visual.light.intensity = p * (0.42 + shimmer * 0.18 + pulse * 1.15);
      root.userData.active = state.active;
      root.userData.pose = Number(p.toFixed(3));
      root.userData.impact = Number(pulse.toFixed(3));
    } else {
      /* The light no longer hides with the plate, so lowering it is
         now this function's job - a scene-parented light left at its
         last intensity is a gold glow following the player around
         with no shield under it. */
      visual.light.intensity = 0;
    }

    const domeP = state.domePose;
    const domeRoot = visual.domeRoot;
    domeRoot.visible = domeP > 0.008;
    if (domeRoot.visible) {
      domeRoot.position.set(ps.x, ps.y + 0.035, ps.z);
      const breathing = 0.992 + shimmer * 0.008 + pulse * 0.018;
      domeRoot.scale.setScalar(domeP * breathing);
      visual.domeSurface.material.opacity = domeP * (0.075 + shimmer * 0.028 + pulse * 0.10);
      visual.domeGrid.material.opacity = domeP * (0.075 + shimmer * 0.045 + pulse * 0.12);
      visual.domeRing.material.opacity = domeP * (0.58 + shimmer * 0.26 + pulse * 0.14);
      visual.domeRing.rotation.z += dt * (0.16 + pulse * 0.35);
      visual.domeLight.position.set(ps.x, ps.y + 0.035 + 1.15, ps.z);
      visual.domeLight.intensity = domeP * (0.70 + shimmer * 0.28 + pulse * 1.35);
      domeRoot.userData.active = state.active && state.dome;
      domeRoot.userData.pose = Number(domeP.toFixed(3));
      domeRoot.userData.impact = Number(pulse.toFixed(3));
    } else {
      visual.domeLight.intensity = 0;
    }
  }

  function status() {
    return {
      requested: state.requested,
      active: state.active,
      needsRelease: state.needsRelease,
      pose: Number(state.pose.toFixed(3)),
      impact: Number(state.impact.toFixed(3)),
      activeFor: Number(state.activeFor.toFixed(3)),
      mode: state.mode,
      dome: state.dome,
      domePose: Number(state.domePose.toFixed(3)),
      movementLocked: state.movementLocked,
      omniDirectional: state.omniDirectional,
      moveSpeed: Number(state.moveSpeed.toFixed(3)),
      drainMultiplier: Number(state.drainMultiplier.toFixed(3)),
      modifierSource: state.modifierSource,
      blocks: state.blocks,
      absorbed: Number(state.absorbed.toFixed(2)),
      sessionBlocks: state.sessionBlocks,
      sessionAbsorbed: Number(state.sessionAbsorbed.toFixed(2)),
      lastAmount: Number(state.lastAmount.toFixed(2)),
      lastPerfect: !!state.lastBlock?.perfect,
      lastTimingMs: Number((state.lastBlock?.timing?.elapsedMs || 0).toFixed(2)),
      lastReason: state.lastReason,
      drainRate: config.drainRate,
      baseMoveSpeed: config.moveSpeed,
      frontDot: config.frontDot,
      perfectWindow: config.perfectWindow,
      domeRadius: config.domeRadius,
    };
  }

  return {
    config,
    state,
    visual,
    beginFrame,
    blocksFrom,
    tryBlock,
    lastBlock: () => state.lastBlock,
    lastRelease: () => state.lastRelease,
    updateVisual,
    reset,
    status,
  };
}
