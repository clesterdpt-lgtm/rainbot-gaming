/* ============================================================
   SAINTFALL - the mission

   OPERATION: SAINTFALL. Three vox-relays on Vesper-IX still carry
   the Concord's standing order, and the order is why the servitors
   in the Cathedral are still walking their round. Silence all three,
   call the shuttle, hold the pad until it lifts.

   The structure is deliberately Helldivers-shaped: objectives are
   spread far enough apart that crossing between them IS the game,
   and the extraction timer is the part that turns a cleared map back
   into a fight.

   Stratagems are the signature mechanic and they are implemented as
   the real thing: a directional code entered under pressure, then a
   beacon, then a delay, then something arrives whether or not you
   are still standing where you threw it.
   ============================================================ */

import { clamp, clamp01, makeBus, makeRng } from "saintfall/core.js";
import { roadPointAtZ } from "saintfall/terrain.js";

/* Codes are entered on the arrow keys / WASD-adjacent direction
   pad. Short enough to be muscle memory, long enough that entering
   one while something is charging you is a decision. */
export const STRATAGEMS = {
  orbital: {
    name: "Orbital Lance",
    code: ["up", "right", "down", "down", "down"],
    cooldown: 95,
    delay: 4.2,
    radius: 26,
    damage: 420,
    colour: "#7fd4ff",
  },
  cluster: {
    name: "Eagle Cluster",
    code: ["up", "right", "down", "down", "right"],
    cooldown: 52,
    delay: 2.4,
    radius: 17,
    damage: 190,
    colour: "#ffbe4d",
  },
  resupply: {
    name: "Resupply",
    code: ["down", "down", "up", "right"],
    cooldown: 74,
    delay: 3.0,
    radius: 0,
    damage: 0,
    colour: "#9df58c",
    heals: true,
  },
};

const RELAY_SITES = [
  { key: "censer", x: 655, z: 700, name: "Relay ALPHA - Censer Works" },
  { key: "choir", x: -820, z: -95, name: "Relay BETA - Choir Spires" },
  { key: "cathedral", x: -95, z: -725, name: "Relay GAMMA - Vault-Cathedral" },
];

// The Threshold, at the south rim - ON the causeway, not beside it.
const SPAWN = roadPointAtZ(815);
const EXTRACT = { x: 0, z: -20 };        // beneath the Fallen Saint

export function buildMission(ctx) {
  const { THREE, terrain, world, combat, enemies } = ctx;
  const groundY = (x, z) => ctx.collide
    ? ctx.collide.groundHeight(x, z)
    : (terrain.groundHeightAt ? terrain.groundHeightAt(x, z) : terrain.heightAt(x, z));
  const bus = makeBus();
  const rng = makeRng(0x4d15);

  const group = new THREE.Group();
  group.name = "mission";
  ctx.scene.add(group);

  /* ------------------------------------------------------------
     MARKERS
     A relay is a mast with a light on it. It has to be findable
     from a kilometre away across dunes, so the readable part is a
     vertical beam rather than the geometry.
     ------------------------------------------------------------ */

  function makeBeacon(x, z, hex, height) {
    const g = new THREE.Group();
    const y = groundY(x, z);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 1.9, height, 6, 1, true),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(hex),
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
    );
    beam.position.set(x, y + height * 0.5, z);
    // Additive geometry must fade to BLACK with distance, never
    // toward the sky - a hazed additive surface ADDS the sky colour
    // and gets BRIGHTER the further away it is.
    if (ctx.atmos && ctx.patchBasic) ctx.patchBasic(beam.material, 0.55);
    g.add(beam);

    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, height * 0.82, 5),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(hex) })
    );
    // 0.41 * height centres an 0.82-height core exactly on the
    // ground. The previous 0.42 factor left the relay cores visibly
    // hovering by up to 0.62m.
    core.position.set(x, y + height * 0.41, z);
    g.add(core);
    group.add(g);
    return { group: g, beam, core, x, z, y };
  }

  const relays = RELAY_SITES.map((site) => {
    // Nudged off the district centre so the relay is not buried
    // inside whatever the world builder put at the middle.
    const ox = site.x + Math.cos(rng() * 7) * 26;
    const oz = site.z + Math.sin(rng() * 7) * 26;
    return {
      ...site,
      x: ox,
      z: oz,
      y: groundY(ox, oz),
      done: false,
      progress: 0,
      beacon: makeBeacon(ox, oz, "#ff8a3c", 62),
    };
  });

  const pad = makeBeacon(EXTRACT.x, EXTRACT.z, "#7fd4ff", 46);
  pad.group.visible = false;

  /* ------------------------------------------------------------
     STATE
     ------------------------------------------------------------ */

  const state = {
    phase: "relays",          // relays -> extract -> won | lost
    relaysDone: 0,
    channelling: null,
    extractCalled: false,
    extractTimer: 0,
    elapsed: 0,
    deaths: 0,
    reinforcements: 5,
    banner: null,
    bannerFor: 0,
  };

  const cooldowns = {};
  for (const key of Object.keys(STRATAGEMS)) cooldowns[key] = 0;

  const pending = [];       // stratagems in flight

  function say(text, seconds = 4) {
    state.banner = text;
    state.bannerFor = seconds;
    bus.emit("banner", { text });
  }

  /* ------------------------------------------------------------
     STRATAGEMS
     ------------------------------------------------------------ */

  const entry = { active: false, keys: [], since: 0 };

  function beginEntry() {
    if (combat.player.dead) return false;
    entry.active = true;
    entry.keys = [];
    entry.since = 0;
    return true;
  }

  function cancelEntry() {
    entry.active = false;
    entry.keys = [];
  }

  /** Feed one direction into the code buffer. */
  function pushDirection(dir) {
    if (!entry.active || combat.player.dead) return null;
    entry.keys.push(dir);
    entry.since = 0;

    // Any stratagem still matching this prefix keeps the entry alive.
    let alive = 0;
    for (const [key, spec] of Object.entries(STRATAGEMS)) {
      const code = spec.code;
      if (entry.keys.length > code.length) continue;
      let ok = true;
      for (let i = 0; i < entry.keys.length; i += 1) {
        if (entry.keys[i] !== code[i]) { ok = false; break; }
      }
      if (!ok) continue;
      alive += 1;
      if (entry.keys.length === code.length) {
        cancelEntry();
        return call(key);
      }
    }
    if (alive === 0) {
      cancelEntry();
      say("CODE REJECTED", 1.4);
      bus.emit("code", { ok: false });
    } else {
      bus.emit("code", { ok: true });
    }
    return null;
  }

  function call(key) {
    if (combat.player.dead) return null;
    const spec = STRATAGEMS[key];
    if (cooldowns[key] > 0) {
      say(`${spec.name.toUpperCase()} ON COOLDOWN`, 1.6);
      return null;
    }
    cooldowns[key] = spec.cooldown;
    const ps = ctx.player.state;
    // The beacon lands ahead of where the player is looking, not on
    // top of them. Throwing an orbital lance at your own feet should
    // be possible, but it should take aiming down.
    const throwDist = 22;
    const x = ps.x + Math.sin(ps.camYaw) * throwDist;
    const z = ps.z + Math.cos(ps.camYaw) * throwDist;
    const shot = {
      key, spec, x, z,
      y: groundY(x, z),
      t: spec.delay,
      marker: makeBeacon(x, z, spec.colour, 30),
    };
    pending.push(shot);
    say(`${spec.name.toUpperCase()} INBOUND`, 2.6);
    bus.emit("stratagem", { key });
    bus.emit("inbound", { x, z, seconds: spec.delay });
    return key;
  }

  function resolve(shot) {
    const spec = shot.spec;
    if (spec.heals) {
      combat.player.hp = combat.player.maxHp;
      if (ctx.weapons && ctx.weapons.resupply) ctx.weapons.resupply();
      say("RESUPPLY DELIVERED", 2.4);
    } else {
      combat.explode(shot.x, shot.y + 1, shot.z, spec.radius, spec.damage);
      say(`${spec.name.toUpperCase()} IMPACT`, 2.0);
      bus.emit("impact", { x: shot.x, z: shot.z, radius: spec.radius });
    }
    group.remove(shot.marker.group);
  }

  /* ------------------------------------------------------------
     OBJECTIVES
     ------------------------------------------------------------ */

  const CHANNEL_RADIUS = 9;
  const CHANNEL_TIME = 7.5;

  function nearestRelay(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const r of relays) {
      if (r.done) continue;
      const d = Math.hypot(r.x - x, r.z - z);
      if (d < bestD) { bestD = d; best = r; }
    }
    return { relay: best, dist: bestD };
  }

  function callExtraction() {
    if (state.extractCalled || state.phase !== "extract" || combat.player.dead) return;
    state.extractCalled = true;
    state.extractTimer = 95;
    say("SHUTTLE INBOUND - HOLD THE PAD", 5);
    bus.emit("extractCalled", {});
    /* Calling the shuttle wakes every garrison on the map. A cleared
       level is not an ending; it is the setup for the last fight,
       which is the whole reason extraction exists as a mechanic. */
    for (const inst of enemies.live) {
      if (inst.state === "death") continue;
      inst.suspicion = 1;
      inst.alerted = true;
      if (inst.fireTimer === undefined) inst.fireTimer = 0;
      if (inst.burstLeft === undefined) inst.burstLeft = 0;
      inst.home = { x: EXTRACT.x + (Math.random() - 0.5) * 90,
        z: EXTRACT.z + (Math.random() - 0.5) * 90 };
    }
  }

  /* ------------------------------------------------------------
     UPDATE
     ------------------------------------------------------------ */

  function update(dt) {
    if (state.phase === "won" || state.phase === "lost") return;
    state.elapsed += dt;
    state.bannerFor = Math.max(0, state.bannerFor - dt);
    if (state.bannerFor <= 0) state.banner = null;

    for (const key of Object.keys(cooldowns)) {
      cooldowns[key] = Math.max(0, cooldowns[key] - dt);
    }
    if (entry.active) {
      entry.since += dt;
      if (entry.since > 3.2) { cancelEntry(); say("CODE TIMED OUT", 1.4); }
    }

    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const shot = pending[i];
      shot.t -= dt;
      const pulse = 0.24 + Math.sin(state.elapsed * 9) * 0.16;
      shot.marker.beam.material.opacity = pulse;
      if (shot.t <= 0) { resolve(shot); pending.splice(i, 1); }
    }

    const ps = ctx.player.state;

    // Beacon pulse, so an objective reads as live from across a dune.
    for (const r of relays) {
      if (r.done) continue;
      r.beacon.beam.material.opacity = 0.18
        + Math.sin(state.elapsed * 1.9 + r.x) * 0.09;
    }

    if (state.phase === "relays") {
      const { relay, dist } = nearestRelay(ps.x, ps.z);
      if (relay && dist < CHANNEL_RADIUS && ps.grounded && !combat.player.dead) {
        state.channelling = relay;
        relay.progress = clamp01(relay.progress + dt / CHANNEL_TIME);
        if (relay.progress >= 1) {
          relay.done = true;
          state.channelling = null;
          state.relaysDone += 1;
          group.remove(relay.beacon.group);
          say(`${relay.name.toUpperCase()} SILENCED`, 3.4);
          bus.emit("relayDone", { key: relay.key, done: state.relaysDone });
          if (state.relaysDone >= relays.length) {
            state.phase = "extract";
            pad.group.visible = true;
            say("ALL RELAYS SILENCED - REACH THE PAD", 6);
          }
        }
      } else {
        // Channelling is interrupted, not paused. Walking away from a
        // relay under fire has to cost something.
        if (state.channelling) state.channelling.progress *= 0.35;
        state.channelling = null;
      }
    } else if (state.phase === "extract") {
      pad.beam.material.opacity = 0.2 + Math.sin(state.elapsed * 3.1) * 0.1;
      const d = Math.hypot(ps.x - EXTRACT.x, ps.z - EXTRACT.z);
      if (!state.extractCalled && d < 16 && ps.grounded && !combat.player.dead) callExtraction();
      if (state.extractCalled) {
        state.extractTimer -= dt;
        if (state.extractTimer <= 0) {
          if (d < 24 && ps.grounded && !combat.player.dead) {
            state.phase = "won";
            say("EXTRACTION COMPLETE", 99);
            bus.emit("won", {});
          } else {
            state.extractTimer = 12;
            say("SHUTTLE HOLDING - GET TO THE PAD", 4);
          }
        }
      }
    }

    // Deaths and the reinforcement budget.
    if (combat.player.dead && !state.countedDeath) {
      state.countedDeath = true;
      state.deaths += 1;
      state.reinforcements -= 1;
      if (state.reinforcements < 0) {
        state.phase = "lost";
        say("MISSION FAILED - NO REINFORCEMENTS", 99);
        bus.emit("lost", {});
      }
    } else if (!combat.player.dead) {
      state.countedDeath = false;
    }
  }

  void world; void clamp;

  return {
    group,
    bus,
    state,
    relays,
    cooldowns,
    stratagems: STRATAGEMS,
    spawn: SPAWN,
    extract: EXTRACT,
    entry,
    beginEntry,
    cancelEntry,
    pushDirection,
    call,
    update,
    nearestRelay,
    /** Compass bearing and range to whatever matters right now. */
    objective() {
      const ps = ctx.player.state;
      if (state.phase === "relays") {
        const { relay, dist } = nearestRelay(ps.x, ps.z);
        if (!relay) return null;
        return { name: relay.name, x: relay.x, z: relay.z, dist, progress: relay.progress };
      }
      const dist = Math.hypot(ps.x - EXTRACT.x, ps.z - EXTRACT.z);
      return { name: "EXTRACTION - The Fallen Saint", x: EXTRACT.x, z: EXTRACT.z, dist, progress: 0 };
    },
    stats() {
      return {
        phase: state.phase,
        relays: `${state.relaysDone}/${relays.length}`,
        reinforcements: state.reinforcements,
        elapsed: Math.round(state.elapsed),
      };
    },
  };
}
