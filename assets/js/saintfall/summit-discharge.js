/* ============================================================
   SAINTFALL - White Vigil crescent discharge

   Kenosis deliberately has no campaign combat stack. This is a
   level-local firing proof for the paired hybrid props: primary fire
   alternates hands and launches a short-lived crescent from an
   authored locator on the BLADE side of each Meshy model. There is no
   damage or target query here; guardians will own that later.
   ============================================================ */

const DISCHARGE = Object.freeze({
  cooldown: 0.19,
  warmup: 0.11,
  speed: 24,
  range: 10,
  radius: 0.30,
  maxActive: 16,
});

export function buildSummitDischarge(ctx, player, loadout) {
  const { THREE } = ctx;
  const group = new THREE.Group();
  group.name = "white-vigil-crescent-discharges";
  ctx.scene.add(group);

  const emitters = (loadout?.parts || []).filter((part) => (
    part.emitter && Array.isArray(part.spec.emitterAxis)
  ));
  const supported = ctx.playerCharacter?.id === "white-vigil" && emitters.length === 2;
  /* Tapered annular strip rather than RingGeometry. A ring sector has
     square caps and reads as the letter C; the concept's weapon has
     points, so the pulse narrows to 2% thickness at both ends and
     carries the same blade-wave silhouette at a distance. */
  const segments = 32;
  const vertices = [];
  const indices = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const angle = -Math.PI * 0.64 + t * Math.PI * 1.28;
    const outer = DISCHARGE.radius;
    const taper = Math.pow(Math.sin(Math.PI * t), 0.66);
    const inner = outer - DISCHARGE.radius * (0.02 + 0.42 * taper);
    vertices.push(
      Math.cos(angle) * outer, Math.sin(angle) * outer, 0,
      Math.cos(angle) * inner, Math.sin(angle) * inner, 0,
    );
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  /* A VERTICAL SLICE, not a frisbee. The first pulse mapped its face
     normal onto the flight direction, so the crescent flew face-first
     and showed its full disc to the chase camera. It now flies
     edge-first in a vertical plane: local +X (the belly of the arc)
     leads along the flight direction, local +Y holds the world
     vertical, and the face normal ends up horizontal - so the full
     crescent reads only from a side profile, while from behind or
     ahead it is a thin vertical slash. The geometry's horns trail
     up-back and down-back, which is the slice silhouette. */
  const sliceX = new THREE.Vector3();
  const sliceY = new THREE.Vector3();
  const sliceZ = new THREE.Vector3();
  const sliceBasis = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const shots = [];
  let cooldown = 0;
  let warmup = 0;
  let alternating = 0;
  let heldLast = false;
  let fired = 0;
  let lastShot = null;
  const recentShots = [];

  const aimTarget = new THREE.Vector3();
  function makeShot(part) {
    part.mount.updateWorldMatrix(true, true);
    part.emitter.getWorldPosition(position);
    /* AIMED AT THE CROSSHAIR, not merely along the model's own axis.
       The emit axis is where the weapon is POINTING, and the weapon
       is posed by a damped blend - so at the moment a shot leaves,
       the barrel is still swinging onto the target and the pulse
       inherits whatever fraction of the turn had happened. Firing at
       the reticle's own world point makes the shot go where the
       player is looking on the first frame of the press, and makes
       the pair converge rather than run parallel.

       The model axis remains the fallback, so a level without a
       camera - or a figure without the aim - still fires forward. */
    const target = loadout?.aimPoint?.(aimTarget);
    if (target) {
      direction.copy(target).sub(position).normalize();
    } else {
      direction.fromArray(part.spec.emitterAxis)
        .transformDirection(part.asset.matrixWorld)
        .normalize();
    }

    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xffe6a2,
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xff9f2f,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const root = new THREE.Group();
    root.name = `crescent-pulse-${fired + 1}`;
    const core = new THREE.Mesh(geometry, coreMaterial);
    const glow = new THREE.Mesh(geometry, glowMaterial);
    glow.scale.setScalar(1.34);
    root.add(glow, core);
    root.position.copy(position).addScaledVector(direction, 0.06);
    /* Belly leads, plane holds the vertical. The in-plane axis is the
       world up made perpendicular to the flight direction; firing
       near straight up or down leaves no vertical to hold, so the
       plane falls back to world +Z and the slice stays a slice. */
    sliceX.copy(direction);
    sliceY.set(0, 1, 0).addScaledVector(sliceX, -sliceX.y);
    if (sliceY.lengthSq() < 1e-4) {
      sliceY.set(0, 0, 1).addScaledVector(sliceX, -sliceX.z);
    }
    sliceY.normalize();
    sliceZ.crossVectors(sliceX, sliceY);
    sliceBasis.makeBasis(sliceX, sliceY, sliceZ);
    root.quaternion.setFromRotationMatrix(sliceBasis);
    /* A few degrees of in-plane tilt, opposite per hand, so the pair
       does not read as one stamped sprite. Tilt is about the face
       normal - the plane itself stays vertical. */
    root.rotateZ((part.spec.hand === 0 ? -1 : 1) * 0.14);
    group.add(root);

    const shot = {
      root,
      coreMaterial,
      glowMaterial,
      direction: direction.clone(),
      distance: 0,
      hand: part.spec.hand,
    };
    shots.push(shot);
    fired += 1;
    lastShot = {
      hand: part.spec.hand === 0 ? "left" : "right",
      origin: position.toArray(),
      direction: direction.toArray(),
    };
    recentShots.push(lastShot);
    if (recentShots.length > 8) recentShots.shift();
    while (shots.length > DISCHARGE.maxActive) removeShot(shots[0]);
    return shot;
  }

  function removeShot(shot) {
    const index = shots.indexOf(shot);
    if (index >= 0) shots.splice(index, 1);
    group.remove(shot.root);
    shot.coreMaterial.dispose();
    shot.glowMaterial.dispose();
  }

  function fireOnce(hand = null) {
    if (!supported) return false;
    const index = Number.isInteger(hand)
      ? Math.max(0, Math.min(emitters.length - 1, hand))
      : alternating++ % emitters.length;
    makeShot(emitters[index]);
    return true;
  }

  function update(dt) {
    const d = Math.max(0, dt);
    const held = supported && !!player.input?.state?.firing;
    cooldown = Math.max(0, cooldown - d);
    if (held && !heldLast) warmup = DISCHARGE.warmup;
    heldLast = held;
    warmup = Math.max(0, warmup - d);
    if (held && warmup <= 0 && cooldown <= 0) {
      fireOnce();
      cooldown = DISCHARGE.cooldown;
    }

    for (let i = shots.length - 1; i >= 0; i -= 1) {
      const shot = shots[i];
      const step = DISCHARGE.speed * d;
      shot.root.position.addScaledVector(shot.direction, step);
      /* No spin. The face-first pulse span like a shuriken to sell
         its disc; a slice holds its plane, or the horns would swing
         off the vertical in flight. */
      shot.distance += step;
      const fade = Math.max(0, Math.min(1, (DISCHARGE.range - shot.distance) / 2.2));
      shot.coreMaterial.opacity = 0.96 * fade;
      shot.glowMaterial.opacity = 0.34 * fade;
      const ground = ctx.collide?.groundHeight?.(shot.root.position.x, shot.root.position.z);
      const struckGround = Number.isFinite(ground) && shot.root.position.y <= ground + 0.04;
      if (shot.distance >= DISCHARGE.range || struckGround) removeShot(shot);
    }
  }

  function status() {
    return {
      supported,
      active: shots.length,
      fired,
      rangeM: DISCHARGE.range,
      speedMps: DISCHARGE.speed,
      alternatingNext: alternating % 2 === 0 ? "left" : "right",
      lastShot: lastShot ? {
        hand: lastShot.hand,
        origin: lastShot.origin.map((value) => Number(value.toFixed(3))),
        direction: lastShot.direction.map((value) => Number(value.toFixed(3))),
      } : null,
      recentShots: recentShots.map((shot) => ({
        hand: shot.hand,
        origin: shot.origin.map((value) => Number(value.toFixed(3))),
        direction: shot.direction.map((value) => Number(value.toFixed(3))),
      })),
    };
  }

  function destroy() {
    while (shots.length) removeShot(shots[0]);
    geometry.dispose();
    ctx.scene.remove(group);
  }

  return { group, update, fireOnce, status, destroy };
}
