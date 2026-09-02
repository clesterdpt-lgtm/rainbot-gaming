/* ============================================================
   SAINTFALL - White Vigil crescent discharge

   The paired hybrids' primary fire: alternating hands launch a
   crescent slice from an authored locator on the BLADE side of
   each Meshy model. Since the Kenosis kits (m107) this is a REAL
   mid-range weapon, not a firing proof: each pulse carries the
   kit's damage numbers, sweeps the enemy field and the trials
   targets as it flies, sparks what it hits, and pays a muzzle
   flash and a report per shot. Where the level carries no combat
   module the pulses still fly and die on the world exactly as
   before - every combat reference is optional.
   ============================================================ */

const DEFAULTS = Object.freeze({
  cooldown: 0.165,
  warmup: 0.11,
  speed: 48,
  range: 45,
  radius: 0.32,
  maxActive: 24,
  damage: 36,
  falloffStart: 30,
  falloffFloor: 0.65,
  farFloor: 0.25,
  spreadHip: 0.028,
  spreadAds: 0.006,
});

export function buildSummitDischarge(ctx, player, loadout, spec = null) {
  const { THREE } = ctx;
  const DISCHARGE = { ...DEFAULTS, ...(spec || {}) };
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
  const jitterA = new THREE.Vector3();
  const jitterB = new THREE.Vector3();
  const shots = [];
  let cooldown = 0;
  let warmup = 0;
  let alternating = 0;
  let heldLast = false;
  let fired = 0;
  let hitsLanded = 0;
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
    /* ONE CONE. The right button became the Vigil's melee hand, so
       there is no aim state to narrow on - and these barrels already
       converge on the reticle, which is what "aiming" meant here. The
       cone stays tight enough to hit at range on its own. */
    const cone = DISCHARGE.spreadHip;
    if (cone > 0) {
      jitterA.set(0, 1, 0).addScaledVector(direction, -direction.y);
      if (jitterA.lengthSq() < 1e-6) jitterA.set(1, 0, 0);
      jitterA.normalize();
      jitterB.crossVectors(direction, jitterA);
      const r = Math.sqrt(Math.random()) * cone;
      const a = Math.random() * Math.PI * 2;
      direction.addScaledVector(jitterA, Math.cos(a) * r)
        .addScaledVector(jitterB, Math.sin(a) * r)
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
    /* The report and the flash. Both optional-chained: a page with no
       audio module fires silently, exactly as the whole site's
       degraded path is meant to. */
    ctx.vfx?.muzzle?.(position.x, position.y, position.z,
      direction.x, direction.y, direction.z, 0.62, true);
    ctx.audio?.crescentShot?.(position.x, position.z, { hand: part.spec.hand });
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

  /* Damage falls from full to `falloffFloor` between falloffStart and
     the end of the range: a mid-range weapon, honest about it. */
  /* TWO FALLOFFS, because there are two ranges. Inside `range` this is
     the mid-range weapon it always was, decaying to `falloffFloor`.
     Past it the crescent still flies - out to `travel` - but its
     damage collapses toward `farFloor`, which is what lets Veyra wear
     down something perched far out of her fight without turning her
     into a sniper. A kit that simply cannot reach an encounter is
     worse than one that is bad at it. */
  const FAR_TRAVEL = Math.max(DISCHARGE.range,
    Number(DISCHARGE.travel) || DISCHARGE.range);
  const FAR_FLOOR = Number.isFinite(DISCHARGE.farFloor) ? DISCHARGE.farFloor : 0;

  function damageAt(distance) {
    if (distance <= DISCHARGE.falloffStart) return DISCHARGE.damage;
    if (distance <= DISCHARGE.range) {
      const t = Math.min(1, (distance - DISCHARGE.falloffStart)
        / Math.max(1e-4, DISCHARGE.range - DISCHARGE.falloffStart));
      return DISCHARGE.damage * (1 - t * (1 - DISCHARGE.falloffFloor));
    }
    const far = Math.min(1, (distance - DISCHARGE.range)
      / Math.max(1e-4, FAR_TRAVEL - DISCHARGE.range));
    return DISCHARGE.damage
      * (DISCHARGE.falloffFloor + far * (FAR_FLOOR - DISCHARGE.falloffFloor));
  }

  function update(dt) {
    const d = Math.max(0, dt);
    const held = supported && !!player.input?.state?.firing
      && !player.action && !player.state.free
      && !ctx.combat?.player?.dead;
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
      const px = shot.root.position.x;
      const py = shot.root.position.y;
      const pz = shot.root.position.z;
      /* The pulse is swept, not point-tested: at 46 m/s it crosses
         three quarters of a metre a frame, and a Thresher is smaller
         than that. Enemies first (the pulse dies on what it hits),
         then the trials targets, then masonry, then the ground. */
      let consumed = false;
      if (ctx.combat?.raycastEnemies) {
        const hit = ctx.combat.raycastEnemies(px, py, pz,
          shot.direction.x, shot.direction.y, shot.direction.z, step + 0.3);
        if (hit && hit.inst) {
          /* Alternate projectiles still resolve through the shared
             analytic hit volumes.  Preserve the heat-sac verdict:
             dropping `sacIndex` here made Veyra visibly hit every
             glowing sac while spending none of the lift pool, and on
             Martyr also misclassified the hit as armoured body fire. */
          const box = ctx.combat.hitbox?.[hit.inst.key];
          if (hit.sacIndex >= 0 && box?.sacs) {
            ctx.combat.drainLift?.(hit.inst, box.sacs.lift || 1, hit.sacIndex, {
              source: "crescent", x: hit.x, y: hit.y, z: hit.z,
            });
          }
          const jointMult = hit.legIndex >= 0 && hit.joint
            ? (box?.joints?.mult || 1) : 1;
          const damage = damageAt(shot.distance + hit.t) * jointMult;
          if (hit.legIndex >= 0) {
            ctx.combat.damageLeg?.(hit.inst, hit.legIndex, damage, {
              source: "crescent", x: hit.x, y: hit.y, z: hit.z,
              joint: !!hit.joint,
            });
          } else {
            ctx.combat.damageEnemy(hit.inst, damage, {
              source: "crescent", x: hit.x, y: hit.y, z: hit.z,
              head: !!hit.head, weak: !!hit.weak, sac: hit.sacIndex >= 0,
            });
          }
          hitsLanded += 1;
          ctx.vfx?.spark?.(hit.x, hit.y, hit.z, 1.0, false, true);
          ctx.audio?.crescentImpact?.(hit.x, hit.z, {
            solid: hit.legIndex >= 0 || !!hit.strong || !!hit.surface,
          });
          removeShot(shot);
          consumed = true;
        }
      }
      if (!consumed && ctx.trials?.sweep) {
        const swept = ctx.trials.sweep(px, py, pz,
          shot.direction.x, shot.direction.y, shot.direction.z, step + 0.3, {
            damage: damageAt(shot.distance),
          });
        if (swept && swept.length) {
          hitsLanded += 1;
          ctx.vfx?.spark?.(swept[0].x, swept[0].y, swept[0].z, 1.0, false, true);
          ctx.audio?.crescentImpact?.(swept[0].x, swept[0].z);
          removeShot(shot);
          consumed = true;
        }
      }
      if (!consumed && ctx.collide?.rayBlock) {
        const wallAt = ctx.collide.rayBlock(px, py, pz,
          shot.direction.x, shot.direction.y, shot.direction.z, step + 0.2);
        if (Number.isFinite(wallAt) && wallAt <= step + 0.2) {
          const wx = px + shot.direction.x * wallAt;
          const wy = py + shot.direction.y * wallAt;
          const wz = pz + shot.direction.z * wallAt;
          ctx.vfx?.spark?.(wx, wy, wz, 0.8, true, true);
          ctx.audio?.crescentImpact?.(wx, wz, { solid: true });
          removeShot(shot);
          consumed = true;
        }
      }
      if (consumed) continue;
      shot.root.position.addScaledVector(shot.direction, step);
      /* No spin. The face-first pulse span like a shuriken to sell
         its disc; a slice holds its plane, or the horns would swing
         off the vertical in flight. */
      shot.distance += step;
      /* Faded and culled against TRAVEL, not against the damage
         range - culling at `range` was what kept the crescent from
         ever arriving at a distant target however far it was allowed
         to hurt. */
      const fade = Math.max(0, Math.min(1, (FAR_TRAVEL - shot.distance) / 2.2));
      shot.coreMaterial.opacity = 0.96 * fade;
      shot.glowMaterial.opacity = 0.34 * fade;
      const ground = ctx.collide?.groundHeight?.(shot.root.position.x, shot.root.position.z);
      const struckGround = Number.isFinite(ground) && shot.root.position.y <= ground + 0.04;
      if (struckGround) {
        ctx.vfx?.spark?.(shot.root.position.x, ground + 0.06, shot.root.position.z,
          0.7, true, true);
        ctx.audio?.crescentImpact?.(shot.root.position.x, shot.root.position.z,
          { solid: true });
      }
      if (shot.distance >= FAR_TRAVEL || struckGround) removeShot(shot);
    }
  }

  function status() {
    return {
      supported,
      active: shots.length,
      fired,
      hits: hitsLanded,
      damage: DISCHARGE.damage,
      falloffStart: DISCHARGE.falloffStart,
      falloffFloor: DISCHARGE.falloffFloor,
      spreadHip: DISCHARGE.spreadHip,
      spreadAds: DISCHARGE.spreadAds,
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

  function reset() {
    while (shots.length) removeShot(shots[0]);
    cooldown = 0;
    warmup = 0;
    alternating = 0;
    heldLast = false;
  }

  function destroy() {
    reset();
    geometry.dispose();
    ctx.scene.remove(group);
  }

  return { group, update, fireOnce, status, reset, destroy };
}
