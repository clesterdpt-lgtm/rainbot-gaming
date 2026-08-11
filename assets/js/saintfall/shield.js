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

  const light = new THREE.PointLight(0xffb43d, 0, 3.8, 2);
  light.name = "aegis-gold-light";
  light.position.set(0, 0, -0.22);
  root.add(light);

  scene.add(root);
  return {
    root,
    surface,
    glow,
    edge,
    runes,
    ring,
    light,
    materials: { surface: surfaceMaterial, glow: glowMaterial, line: lineMaterial,
      runes: runeMaterial, ring: ring.material },
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
    blocks: 0,
    absorbed: 0,
    lastAmount: 0,
    lastReason: "ready",
  };

  function reset(full = true) {
    const held = !!player.input?.keys?.has("KeyX");
    state.requested = false;
    state.active = false;
    state.needsRelease = held;
    state.pose = 0;
    state.impact = 0;
    state.lastAmount = 0;
    state.lastReason = "ready";
    if (full) {
      state.blocks = 0;
      state.absorbed = 0;
    }
    visual.root.visible = false;
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
    state.requested = !!inputState.block;
    if (!state.requested) state.needsRelease = false;
    state.impact = damp(state.impact, 0, 9, dt);
    const reason = state.requested ? blockedReason(playerState) : "released";
    state.active = false;

    if (state.requested && !reason) {
      const wanted = config.drainRate * dt;
      const used = ctx.jetpack?.drain?.(wanted) || 0;
      state.active = used > 1e-6;
      if (used + 1e-6 < wanted || (ctx.jetpack?.state?.fuel || 0) <= 1e-6) {
        state.needsRelease = true;
      }
      state.lastReason = state.active ? "blocking" : "low-charge";
    } else {
      state.lastReason = reason || "ready";
    }

    state.pose = damp(state.pose, state.active ? 1 : 0, state.active ? 22 : 15, dt);
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
    const dot = (dx * Math.sin(ps.yaw) + dz * Math.cos(ps.yaw)) / distance;
    return dot >= config.frontDot;
  }

  function tryBlock(amount, detail = {}) {
    if (!(amount > 0) || !blocksFrom(detail.x, detail.z)) return false;
    state.blocks += 1;
    state.absorbed += amount;
    state.lastAmount = amount;
    state.lastReason = "absorbed";
    state.impact = 1;
    const ps = player.state;
    const fx = ps.x + Math.sin(ps.yaw) * config.distance;
    const fz = ps.z + Math.cos(ps.yaw) * config.distance;
    ctx.vfx?.spark?.(fx, ps.y + config.centreY, fz, 1.18 + clamp01(amount / 70) * 0.54);
    return true;
  }

  function updateVisual(dt) {
    const p = state.pose;
    const root = visual.root;
    root.visible = p > 0.008;
    if (!root.visible) return;

    const ps = player.state;
    const pulse = state.impact;
    const shimmer = 0.5 + 0.5 * Math.sin((ps.clock || 0) * 15.5);
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
    visual.light.intensity = p * (0.42 + shimmer * 0.18 + pulse * 1.15);
    root.userData.active = state.active;
    root.userData.pose = Number(p.toFixed(3));
    root.userData.impact = Number(pulse.toFixed(3));
  }

  function status() {
    return {
      requested: state.requested,
      active: state.active,
      needsRelease: state.needsRelease,
      pose: Number(state.pose.toFixed(3)),
      impact: Number(state.impact.toFixed(3)),
      blocks: state.blocks,
      absorbed: Number(state.absorbed.toFixed(2)),
      lastAmount: Number(state.lastAmount.toFixed(2)),
      lastReason: state.lastReason,
      drainRate: config.drainRate,
      moveSpeed: config.moveSpeed,
      frontDot: config.frontDot,
    };
  }

  return { config, state, visual, beginFrame, blocksFrom, tryBlock, updateVisual, reset, status };
}
