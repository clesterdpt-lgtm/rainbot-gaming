/* ============================================================
   SAINTFALL - The Vigil Trials

   The proving ground that makes the Kenosis kits REAL: a small
   bestiary cohort that assaults the basecamp trial yard when an
   operative walks into it, and a trio of flying censer-kites -
   lantern drones on slow orbits - that exist to be shot at range
   and knocked out of the sky by the Bastion's hammer cast.

   This module owns no combat rules. The cohort is the campaign's
   own bestiary driven by the campaign's own combat module (both
   built by summit-main since m107); the kites are targets, not
   creatures - they carry the `flies` contract (grounded flag, a
   crash, a stun on the floor) so the anti-air verbs can prove
   themselves, but they never attack.

   Also owns the level's death flow: the campaign answers death
   with the save screen, and this level has no saves - so the
   trooper is revived at basecamp BEFORE the death screen's
   0.8-second threshold, with the yard cleared and the cohort's
   next assault held back.
   ============================================================ */

import { TAU } from "saintfall/core.js";

const COHORT = Object.freeze([
  { key: "thresher", count: 4 },
  { key: "gleaner", count: 2 },
  { key: "harrow", count: 1 },
]);
const TRIALS = Object.freeze({
  /* Engage at 40 with the yard sited 70m out (summit-main): the
     basecamp spawn must sit OUTSIDE the wake radius, or the cohort
     ambushes every fresh operative - and every probe - the moment
     the level opens. Walking to the trial is the consent. */
  engageRadius: 40,     // walking this close to the yard wakes it
  spawnRing: [14, 22],  // cohort appears this far from the yard centre
  respawnDelay: 18,     // seconds after a cleared cohort
  droneCount: 3,
  droneHp: 140,
  droneRadius: 0.95,    // sweep sphere
  droneRespawn: 12,
  droneOrbit: [9, 15],
  droneAltitude: [8, 14],
  reviveAt: 1.0,        // combat.respawnIn threshold - before the death screen's 0.8
});

export function buildSummitTrials(ctx, player, options = {}) {
  const { THREE } = ctx;
  const yard = {
    x: Number.isFinite(options.x) ? options.x : 0,
    z: Number.isFinite(options.z) ? options.z : 0,
    yaw: Number.isFinite(options.yaw) ? options.yaw : 0,
  };
  const home = {
    x: Number.isFinite(options.homeX) ? options.homeX : yard.x,
    z: Number.isFinite(options.homeZ) ? options.homeZ : yard.z,
    yaw: Number.isFinite(options.homeYaw) ? options.homeYaw : 0,
  };

  const group = new THREE.Group();
  group.name = "vigil-trials";
  ctx.scene.add(group);

  /* ----------------------------------------------------------
     CENSER-KITES. One shared geometry/material set; per-drone glow
     is vertex-free (emissive on a cloned material would recompile
     nothing - same program, new uniforms - but even that is not
     needed: the state reads through scale and attitude).
     ---------------------------------------------------------- */
  const droneGeo = new THREE.IcosahedronGeometry(0.42, 1);
  const ringGeo = new THREE.TorusGeometry(0.62, 0.05, 6, 24);
  const vaneGeo = new THREE.ConeGeometry(0.16, 0.5, 5);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x8a2f24, metalness: 0.42, roughness: 0.5,
    emissive: 0xff9540, emissiveIntensity: 0.85,
  });
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xc8a24a, metalness: 0.6, roughness: 0.42,
    emissive: 0x552200, emissiveIntensity: 0.4,
  });
  const drones = [];
  for (let i = 0; i < TRIALS.droneCount; i += 1) {
    const root = new THREE.Group();
    root.name = `censer-kite-${i}`;
    const body = new THREE.Mesh(droneGeo, bodyMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    const vane = new THREE.Mesh(vaneGeo, ringMat);
    vane.position.y = -0.55;
    vane.rotation.x = Math.PI;
    root.add(body, ring, vane);
    group.add(root);
    const orbitR = TRIALS.droneOrbit[0]
      + (TRIALS.droneOrbit[1] - TRIALS.droneOrbit[0]) * (i / Math.max(1, TRIALS.droneCount - 1));
    const alt = TRIALS.droneAltitude[0]
      + (TRIALS.droneAltitude[1] - TRIALS.droneAltitude[0]) * (i / Math.max(1, TRIALS.droneCount - 1));
    drones.push({
      index: i,
      root,
      spec: { flies: true, key: "censer-kite" },
      hp: TRIALS.droneHp,
      maxHp: TRIALS.droneHp,
      grounded: false,
      stunFor: 0,
      respawnIn: 0,
      vy: 0,
      orbitR,
      alt,
      phase: Math.random() * TAU,
      speed: 0.24 + i * 0.07,
      x: yard.x, y: 0, z: yard.z,
      kills: 0,
      knockdowns: 0,
    });
  }

  function droneAlive(drone) {
    return drone.respawnIn <= 0;
  }

  function killDrone(drone) {
    drone.kills += 1;
    drone.respawnIn = TRIALS.droneRespawn;
    drone.root.visible = false;
    ctx.vfx?.deathBurst?.(drone.x, drone.y, drone.z, 1.1, false);
    ctx.audio?.explosion?.(drone.x, drone.z, 8);
  }

  function groundDrone(drone, stun) {
    if (drone.grounded) return false;
    drone.grounded = true;
    drone.vy = 0;
    drone.stunFor = Math.max(drone.stunFor, stun || 2.6);
    return true;
  }

  /* The one query the weapons make: a swept segment against every
     live target. Returns what was struck (never the same target twice
     per caller pass - `exclude` is the caller's own hit set). */
  const toDrone = new THREE.Vector3();
  function sweep(px, py, pz, ux, uy, uz, dist, opts = {}) {
    const hits = [];
    for (const drone of drones) {
      if (!droneAlive(drone) || (opts.exclude && opts.exclude.has(drone))) continue;
      toDrone.set(drone.x - px, drone.y - py, drone.z - pz);
      const along = toDrone.x * ux + toDrone.y * uy + toDrone.z * uz;
      if (along < -TRIALS.droneRadius || along > dist + TRIALS.droneRadius) continue;
      const t = Math.max(0, Math.min(dist, along));
      const cx = px + ux * t - drone.x;
      const cy = py + uy * t - drone.y;
      const cz = pz + uz * t - drone.z;
      if (cx * cx + cy * cy + cz * cz > TRIALS.droneRadius * TRIALS.droneRadius) continue;
      const damage = Math.max(0, Number(opts.damage) || 0);
      drone.hp -= damage;
      let grounded = false;
      if (opts.knockdown && drone.hp > 0) {
        grounded = groundDrone(drone, opts.stun);
        if (grounded) drone.knockdowns += 1;
      }
      hits.push({ target: drone, x: drone.x, y: drone.y, z: drone.z, grounded });
      if (drone.hp <= 0) killDrone(drone);
    }
    return hits.length ? hits : null;
  }

  function updateDrones(dt) {
    for (const drone of drones) {
      if (drone.respawnIn > 0) {
        drone.respawnIn -= dt;
        if (drone.respawnIn <= 0) {
          drone.hp = drone.maxHp;
          drone.grounded = false;
          drone.stunFor = 0;
          drone.root.visible = true;
          drone.phase = Math.random() * TAU;
        } else {
          continue;
        }
      }
      const ground = ctx.collide?.groundHeight?.(drone.x, drone.z) ?? 0;
      if (drone.grounded) {
        /* Knocked down: fall, crash once, lie stunned, then rise. */
        if (drone.y > ground + 0.5) {
          drone.vy -= 16 * dt;
          drone.y += drone.vy * dt;
          if (drone.y <= ground + 0.5) {
            drone.y = ground + 0.5;
            drone.vy = 0;
            ctx.vfx?.blast?.(drone.x, ground + 0.4, drone.z, 3.4);
            ctx.audio?.explosion?.(drone.x, drone.z, 6);
          }
          drone.root.rotation.z += dt * 3.2;
        } else {
          drone.stunFor -= dt;
          drone.root.rotation.z = Math.PI * 0.42;
          if (drone.stunFor <= 0) {
            drone.grounded = false;
          }
        }
      } else {
        drone.phase += dt * drone.speed;
        const wantY = ground + drone.alt + Math.sin(drone.phase * 2.3) * 0.8;
        drone.x = yard.x + Math.cos(drone.phase) * drone.orbitR;
        drone.z = yard.z + Math.sin(drone.phase) * drone.orbitR;
        /* Risen through, not teleported: after a crash the kite climbs
           back to its lane at a readable rate. */
        drone.y += (wantY - drone.y) * (1 - Math.exp(-1.6 * dt));
        drone.root.rotation.z *= Math.max(0, 1 - dt * 4);
        drone.root.rotation.y += dt * 0.8;
      }
      drone.root.position.set(drone.x, drone.y, drone.z);
    }
  }

  /* ----------------------------------------------------------
     THE COHORT.
     ---------------------------------------------------------- */
  const cohort = {
    live: [],
    state: "idle",       // idle | engaged | cooldown
    cooldown: 0,
    assaults: 0,
    cleared: 0,
  };

  function spawnCohort() {
    if (!ctx.enemies?.spawn) return false;
    cohort.live.length = 0;
    let ordinal = 0;
    for (const entry of COHORT) {
      for (let i = 0; i < entry.count; i += 1) {
        const bearing = (ordinal / 7) * TAU + Math.random() * 0.35;
        const ring = TRIALS.spawnRing[0]
          + Math.random() * (TRIALS.spawnRing[1] - TRIALS.spawnRing[0]);
        let x = yard.x + Math.sin(bearing) * ring;
        let z = yard.z + Math.cos(bearing) * ring;
        /* findOpen answers [x, z] - the nearest cell not inside
           masonry - or null when the whole search ring is solid. */
        const open = ctx.collide?.findOpen?.(x, z,
          ctx.collide.groundHeight(x, z), 12, 2.0, 0.8);
        if (Array.isArray(open)) { x = open[0]; z = open[1]; }
        const inst = ctx.enemies.spawn(entry.key, x, z, {});
        if (!inst) continue;
        /* The trial is an ambush, not a patrol: everything wakes
           already hunting. */
        inst.alerted = true;
        inst.suspicion = 1;
        cohort.live.push(inst);
        ordinal += 1;
      }
    }
    if (cohort.live.length) {
      cohort.state = "engaged";
      cohort.assaults += 1;
      ctx.vfx?.breach?.(yard.x, ctx.collide?.groundHeight?.(yard.x, yard.z) ?? 0,
        yard.z, 9, 0.8);
      ctx.audio?.rumble?.(yard.x, yard.z, 0.9);
      ctx.gameUi?.announce?.("The trial yard answers.");
      return true;
    }
    return false;
  }

  function clearCohort() {
    for (const inst of cohort.live) {
      if (inst && inst.state !== "death") ctx.enemies?.remove?.(inst);
    }
    cohort.live.length = 0;
  }

  function updateCohort(dt) {
    const ps = player.state;
    const near = Math.hypot(ps.x - yard.x, ps.z - yard.z) <= TRIALS.engageRadius;
    if (cohort.state === "idle") {
      if (near && !ctx.combat?.player?.dead) spawnCohort();
    } else if (cohort.state === "engaged") {
      let alive = 0;
      for (const inst of cohort.live) {
        if (inst && inst.state !== "death" && inst.health > 0) alive += 1;
      }
      if (!alive) {
        cohort.state = "cooldown";
        cohort.cooldown = TRIALS.respawnDelay;
        cohort.cleared += 1;
        ctx.gameUi?.announce?.("Trial cohort broken. The yard resets.");
      }
    } else if (cohort.state === "cooldown") {
      cohort.cooldown -= dt;
      if (cohort.cooldown <= 0) cohort.state = "idle";
    }
  }

  /* ----------------------------------------------------------
     DEATH AND THE REVIVE. This level has no field records, so the
     campaign's death screen (which offers them) must never get the
     chance to open: the fall plays, and at `reviveAt` seconds
     before the screen's own threshold the trooper is stood back up
     at basecamp with the yard held quiet.
     ---------------------------------------------------------- */
  let reviveArmed = false;

  function updateRevive() {
    const combatPlayer = ctx.combat?.player;
    if (!combatPlayer) return;
    if (combatPlayer.dead) {
      reviveArmed = true;
      if ((combatPlayer.respawnIn ?? 0) <= TRIALS.reviveAt) {
        clearCohort();
        cohort.state = "cooldown";
        cohort.cooldown = TRIALS.respawnDelay * 0.5;
        ctx.combat.respawn?.();
        player.spawn?.(home.x, home.z, home.yaw);
        ctx.kenosis?.reset?.();
        ctx.gameUi?.announce?.("The Vigil stands again at basecamp.");
        reviveArmed = false;
      }
    } else {
      reviveArmed = false;
    }
  }

  function update(dt) {
    updateDrones(dt);
    updateCohort(dt);
    updateRevive();
  }

  function status() {
    return {
      yard: { ...yard },
      cohort: {
        state: cohort.state,
        cooldown: Number(cohort.cooldown.toFixed(2)),
        assaults: cohort.assaults,
        cleared: cohort.cleared,
        live: cohort.live.filter((inst) => inst && inst.state !== "death"
          && inst.health > 0).length,
      },
      drones: drones.map((drone) => ({
        index: drone.index,
        hp: Math.round(drone.hp),
        maxHp: drone.maxHp,
        alive: droneAlive(drone),
        grounded: drone.grounded,
        stunFor: Number(Math.max(0, drone.stunFor).toFixed(2)),
        respawnIn: Number(Math.max(0, drone.respawnIn).toFixed(2)),
        position: [drone.x, drone.y, drone.z].map((value) => Number(value.toFixed(2))),
        kills: drone.kills,
        knockdowns: drone.knockdowns,
      })),
      reviveArmed,
    };
  }

  return {
    group,
    yard,
    update,
    sweep,
    spawnCohort,
    clearCohort,
    drones,
    status,
  };
}
