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
export const STRATAGEM_WHEEL_ORDER = Object.freeze(["orbital", "cluster", "resupply"]);

export const STRATAGEMS = {
  orbital: {
    name: "Orbital Lance",
    short: "Lance",
    role: "Precision strike",
    code: ["up", "right", "down", "down", "down"],
    cooldown: 95,
    delay: 4.2,
    radius: 26,
    damage: 420,
    colour: "#7fd4ff",
  },
  cluster: {
    name: "Cluster Salvo",
    short: "Cluster",
    role: "Wide suppression",
    code: ["up", "right", "down", "down", "right"],
    cooldown: 52,
    delay: 2.4,
    radius: 17,
    damage: 190,
    colour: "#ffbe4d",
  },
  resupply: {
    name: "Reinforcement Drop",
    short: "Reinforce",
    role: "Recover and rearm",
    code: ["down", "down", "up", "right"],
    cooldown: 74,
    delay: 3.0,
    radius: 0,
    damage: 0,
    colour: "#9df58c",
    heals: true,
    reinforcements: 1,
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
    maxReinforcements: 5,
    banner: null,
    bannerFor: 0,
  };

  const cooldowns = {};
  for (const key of Object.keys(STRATAGEMS)) cooldowns[key] = 0;

  const pending = [];       // stratagems in flight
  const sigils = [];        // Combined Liturgy impact memories
  const sanctuaries = [];   // Field Chapel / Halo Bastion recovery fields
  const mines = [];         // Reliquary Minefield proximity shards
  let commandSerial = 0;
  let fieldSerial = 0;

  const finite = (value, fallback = 0) => Number.isFinite(Number(value))
    ? Number(value) : fallback;
  const nextCommandId = () => `command-${++commandSerial}`;
  const nextFieldId = (kind) => `${kind}-${++fieldSerial}`;

  function makeFieldDisc(x, z, radius, colour, opacity = 0.12) {
    const y = groundY(x, z) + 0.11;
    const field = new THREE.Group();
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 48),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(colour),
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
    );
    fill.rotation.x = -Math.PI * 0.5;
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(0.1, radius - 0.22), radius, 64),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(colour),
        transparent: true,
        opacity: Math.min(0.82, opacity * 4.5),
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
    );
    rim.rotation.x = -Math.PI * 0.5;
    field.position.set(x, y, z);
    field.add(fill, rim);
    group.add(field);
    return { group: field, fill, rim };
  }

  function disposeField(field) {
    if (!field?.marker) return;
    group.remove(field.marker.group);
    for (const mesh of [field.marker.fill, field.marker.rim]) {
      mesh?.geometry?.dispose?.();
      mesh?.material?.dispose?.();
    }
  }

  function commandRecord(shot) {
    return {
      id: shot.id,
      key: shot.key,
      x: shot.x,
      y: shot.y,
      z: shot.z,
      remaining: Math.max(0, shot.t),
      initialDelay: shot.initialDelay,
      reducedBy: shot.reducedBy || 0,
      relocated: !!shot.relocated,
      siren: shot.siren ? { ...shot.siren } : null,
      liveFuse: shot.liveFuse ? { ...shot.liveFuse } : null,
      sanctuary: shot.sanctuary ? { ...shot.sanctuary } : null,
      sigil: shot.sigil ? { ...shot.sigil } : null,
      fusion: shot.fusion ? {
        ...shot.fusion,
        anchor: shot.fusion.anchor ? { ...shot.fusion.anchor } : null,
      } : null,
    };
  }

  function fieldRecord(field) {
    return {
      id: field.id,
      kind: field.kind,
      x: field.x,
      y: field.y,
      z: field.z,
      radius: field.radius,
      remaining: Math.max(0, field.remaining),
      commandId: field.commandId || null,
      commandKey: field.commandKey || null,
      blocksProjectiles: field.blocksProjectiles || false,
      fusionId: field.fusionId || null,
      impactTargets: Array.isArray(field.impactTargets)
        ? field.impactTargets.map((target) => ({ ...target })) : [],
    };
  }

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
    const baseSpec = STRATAGEMS[key];
    if (!baseSpec) return null;
    const commandModifier = ctx.progression?.modifyCommandCall;
    if (!commandModifier && cooldowns[key] > 0) {
      say(`${baseSpec.name.toUpperCase()} ON COOLDOWN`, 1.6);
      return null;
    }
    const ps = ctx.player.state;
    // The beacon lands ahead of where the player is looking, not on
    // top of them. Throwing an orbital lance at your own feet should
    // be possible, but it should take aiming down.
    const throwDist = 22;
    const baseX = ps.x + Math.sin(ps.camYaw) * throwDist;
    const baseZ = ps.z + Math.cos(ps.camYaw) * throwDist;
    const baseY = groundY(baseX, baseZ);
    const request = {
      key,
      spec: baseSpec,
      target: { x: baseX, y: baseY, z: baseZ },
      cooldownRemaining: cooldowns[key],
      // Live records are intentional: advanced command rules may handle a
      // relocation themselves and return `{ handled: true }` without this
      // low-level module learning doctrine-specific semantics.
      pending,
      sigils: sigils.map(fieldRecord),
      player: {
        x: ps.x,
        y: ps.y,
        z: ps.z,
        yaw: ps.yaw,
        camYaw: ps.camYaw,
      },
    };
    const modified = commandModifier?.call(ctx.progression, request);
    if (modified === false || modified?.cancel === true) return null;
    if (modified?.handled === true) return modified.result ?? key;
    const change = modified && typeof modified === "object" ? modified : {};

    /* Recall Rite is authored by progression but performed here, where the
       live marker and authoritative flight timer reside. A relocation never
       starts a second cooldown or creates a second command. */
    if (change.relocate) {
      const directive = change.relocate === true ? {} : change.relocate;
      let shot = directive.shotId
        ? pending.find((record) => record.id === directive.shotId)
        : null;
      if (!shot) {
        for (let i = pending.length - 1; i >= 0; i -= 1) {
          if (pending[i].key === key) { shot = pending[i]; break; }
        }
      }
      if (!shot || shot.relocated) return null;
      const relocatedTarget = directive.target && typeof directive.target === "object"
        ? directive.target : (change.target && typeof change.target === "object"
          ? change.target : { x: baseX, y: baseY, z: baseZ });
      const x = Number.isFinite(relocatedTarget.x) ? relocatedTarget.x : baseX;
      const z = Number.isFinite(relocatedTarget.z) ? relocatedTarget.z : baseZ;
      const y = Number.isFinite(relocatedTarget.y) ? relocatedTarget.y : groundY(x, z);
      const addedDelay = Math.max(0, finite(directive.addedDelay,
        finite(change.addedDelay, 0)));
      group.remove(shot.marker.group);
      shot.marker = makeBeacon(x, z, shot.spec.colour, 30);
      shot.x = x; shot.y = y; shot.z = z;
      shot.t += addedDelay;
      shot.relocated = true;
      if (!directive.preserveSiren && shot.siren) {
        /* Rank one keeps the talent, but the acquired crowd must reacquire
           the moved tone instead of teleporting its current lure lock. */
        shot.siren.reacquireFor = 0.35;
      }
      const event = {
        id: shot.id,
        key: shot.key,
        x,
        y,
        z,
        addedDelay,
        remaining: shot.t,
        preserveSiren: !!directive.preserveSiren,
      };
      say(`${shot.spec.name.toUpperCase()} RELOCATED`, 1.8);
      bus.emit("relocated", event);
      return key;
    }

    if (cooldowns[key] > 0 && !change.allowWhileCooldown) {
      say(`${baseSpec.name.toUpperCase()} ON COOLDOWN`, 1.6);
      return null;
    }
    const specPatch = change.spec && typeof change.spec === "object" ? change.spec : {};
    const spec = { ...baseSpec, ...specPatch };
    for (const field of ["cooldown", "delay", "radius", "damage"]) {
      const value = Number.isFinite(change[field]) ? change[field] : spec[field];
      spec[field] = Number.isFinite(value) ? Math.max(0, value) : baseSpec[field];
    }
    const target = change.target && typeof change.target === "object" ? change.target : change;
    const x = Number.isFinite(target.x) ? target.x : baseX;
    const z = Number.isFinite(target.z) ? target.z : baseZ;
    const y = Number.isFinite(target.y) ? target.y
      : (x === baseX && z === baseZ ? baseY : groundY(x, z));
    cooldowns[key] = Math.max(0, Number(spec.cooldown) || 0);
    const id = nextCommandId();
    const shot = {
      id,
      key, spec, x, z,
      y,
      t: spec.delay,
      initialDelay: spec.delay,
      reducedBy: 0,
      relocated: false,
      siren: change.siren && typeof change.siren === "object"
        ? { ...change.siren } : null,
      liveFuse: change.liveFuse && typeof change.liveFuse === "object"
        ? { ...change.liveFuse } : null,
      sanctuary: change.sanctuary && typeof change.sanctuary === "object"
        ? { ...change.sanctuary } : null,
      sigil: change.sigil && typeof change.sigil === "object"
        ? { ...change.sigil } : null,
      fusion: change.fusion && typeof change.fusion === "object"
        ? {
          ...change.fusion,
          anchor: change.fusion.anchor && typeof change.fusion.anchor === "object"
            ? { ...change.fusion.anchor } : null,
        } : null,
      marker: makeBeacon(x, z, spec.colour, 30),
    };
    if (change.consumeSigilId) {
      const consumed = removeSigil(change.consumeSigilId, "fusion");
      if (consumed && shot.fusion) {
        shot.fusion.anchor = {
          ...(shot.fusion.anchor || {}),
          id: consumed.id,
          key: consumed.commandKey,
          x: consumed.x,
          y: consumed.y,
          z: consumed.z,
          impactTargets: Array.isArray(consumed.impactTargets)
            ? consumed.impactTargets.map((target) => ({ ...target })) : [],
        };
      }
    }
    pending.push(shot);
    say(`${spec.name.toUpperCase()} INBOUND`, 2.6);
    const event = {
      id,
      key,
      x,
      y,
      z,
      seconds: spec.delay,
      cooldown: cooldowns[key],
      modified: Object.keys(change).length > 0,
    };
    bus.emit("stratagem", event);
    bus.emit("inbound", event);
    return key;
  }

  function removeSigil(id, reason = "expired") {
    const index = sigils.findIndex((field) => field.id === id);
    if (index < 0) return null;
    const [field] = sigils.splice(index, 1);
    disposeField(field);
    bus.emit("sigilEnded", { ...fieldRecord(field), reason });
    return field;
  }

  function createSigil(shot, impactTargets = []) {
    if (!shot.sigil) return null;
    const radius = Math.max(2, finite(shot.sigil.radius, 9));
    const remaining = Math.max(0.5, finite(shot.sigil.duration, 8));
    const field = {
      id: nextFieldId("sigil"),
      kind: "sigil",
      commandId: shot.id,
      commandKey: shot.key,
      x: shot.x,
      y: groundY(shot.x, shot.z),
      z: shot.z,
      radius,
      remaining,
      impactTargets: Array.isArray(impactTargets)
        ? impactTargets.map((target) => ({ ...target })) : [],
      marker: makeFieldDisc(shot.x, shot.z, radius, shot.spec.colour, 0.075),
    };
    sigils.push(field);
    bus.emit("sigil", fieldRecord(field));
    return field;
  }

  function createSanctuary(source, directive = {}, extras = {}) {
    const radius = Math.max(3, finite(directive.radius, 9));
    const field = {
      id: nextFieldId("sanctuary"),
      kind: "sanctuary",
      commandId: source.id || null,
      commandKey: source.key || "resupply",
      x: finite(extras.x, source.x),
      y: finite(extras.y, source.y),
      z: finite(extras.z, source.z),
      radius,
      remaining: Math.max(0.5, finite(extras.duration,
        finite(directive.duration, 10))),
      heatPerSecond: Math.max(0, finite(directive.heatPerSecond, 0)),
      chargePerSecond: Math.max(0, finite(directive.chargePerSecond, 0)),
      drawRadius: Math.max(0, finite(directive.drawRadius, 0)),
      blocksProjectiles: extras.blocksProjectiles ?? directive.blocksProjectiles ?? false,
      fusionId: extras.fusionId || null,
    };
    field.marker = makeFieldDisc(field.x, field.z, radius,
      field.fusionId ? "#a9eaff" : "#9df58c", field.fusionId ? 0.12 : 0.09);
    sanctuaries.push(field);
    bus.emit("sanctuary", fieldRecord(field));
    return field;
  }

  function createMinefield(source, x, z) {
    const count = 7;
    const created = [];
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + Math.PI * 0.16;
      const ring = i === count - 1 ? 0 : 6.4;
      const mx = x + Math.cos(angle) * ring;
      const mz = z + Math.sin(angle) * ring;
      const mine = {
        id: nextFieldId("mine"),
        kind: "mine",
        commandId: source.id,
        commandKey: source.key,
        x: mx,
        y: groundY(mx, mz),
        z: mz,
        radius: 3.4,
        damage: 105,
        remaining: 16,
        fusionId: "reliquary_minefield",
        marker: makeFieldDisc(mx, mz, 0.72, "#ffd15c", 0.21),
      };
      mines.push(mine);
      created.push(fieldRecord(mine));
    }
    return created;
  }

  function fusionPoint(shot, key) {
    if (shot.key === key) return { x: shot.x, y: shot.y, z: shot.z };
    const anchor = shot.fusion?.anchor;
    if (anchor?.key === key) {
      return { x: finite(anchor.x), y: finite(anchor.y), z: finite(anchor.z) };
    }
    return null;
  }

  function resolveFusion(shot) {
    const fusion = shot.fusion;
    if (!fusion?.id) return null;
    let outcome = {};
    if (fusion.id === "sunshard") {
      const orbital = fusionPoint(shot, "orbital") || { x: shot.x, y: shot.y, z: shot.z };
      const identities = shot.key === "orbital"
        ? (Array.isArray(shot.impactTargets) ? shot.impactTargets : [])
        : (Array.isArray(fusion.anchor?.impactTargets) ? fusion.anchor.impactTargets : []);
      const ids = new Set(identities.map((record) => record.id).filter(Boolean));
      let target = null;
      for (const inst of enemies.live) {
        if (inst.state === "death" || !combat.targetable?.(inst)) continue;
        /* Exact identities come from combat.explode. Radius is retained only
           for an old/incomplete sigil restored without that payload. */
        if (ids.size > 0 ? !ids.has(inst.id)
          : Math.hypot(inst.x - orbital.x, inst.z - orbital.z) > STRATAGEMS.orbital.radius) continue;
        if (!target || finite(inst.health) > finite(target.health)) target = inst;
      }
      if (target) {
        const damage = STRATAGEMS.cluster.damage * 0.78;
        const dealt = combat.damageEnemy(target, damage, {
          source: "sunshard",
          x: target.x,
          y: target.y + 1,
          z: target.z,
        });
        ctx.vfx?.blast?.(target.x, target.y + 0.8, target.z, 5.5);
        outcome = {
          targetId: target.id || null,
          targetKey: target.key,
          damage: dealt,
        };
      }
    } else if (fusion.id === "halo_bastion") {
      const recovery = fusionPoint(shot, "resupply") || { x: shot.x, y: shot.y, z: shot.z };
      let field = sanctuaries.find((item) => item.commandKey === "resupply"
        && Math.hypot(item.x - recovery.x, item.z - recovery.z) <= 2);
      if (field) {
        field.blocksProjectiles = true;
        field.remaining = Math.max(field.remaining, 10);
        field.fusionId = fusion.id;
        field.marker.fill.material.opacity = Math.max(field.marker.fill.material.opacity, 0.12);
      } else {
        field = createSanctuary(shot, { radius: 10 }, {
          ...recovery,
          duration: 10,
          blocksProjectiles: true,
          fusionId: fusion.id,
        });
      }
      outcome = { fieldId: field.id, radius: field.radius, duration: field.remaining };
    } else if (fusion.id === "reliquary_minefield") {
      const recovery = fusionPoint(shot, "resupply") || { x: shot.x, y: shot.y, z: shot.z };
      const created = createMinefield(shot, recovery.x, recovery.z);
      outcome = { mineIds: created.map((field) => field.id), count: created.length };
    }
    const event = {
      id: fusion.id,
      commandId: shot.id,
      commandKey: shot.key,
      first: fusion.anchor?.key || "",
      second: shot.key,
      anchor: fusion.anchor ? {
        id: fusion.anchor.id || null,
        key: fusion.anchor.key || "",
        x: finite(fusion.anchor.x),
        y: finite(fusion.anchor.y),
        z: finite(fusion.anchor.z),
      } : null,
      x: shot.x,
      y: shot.y,
      z: shot.z,
      outcome,
    };
    bus.emit("fusion", event);
    say(`${String(fusion.id).replaceAll("_", " ").toUpperCase()} FORMED`, 2.4);
    return event;
  }

  function resolve(shot) {
    const resolution = ctx.progression?.modifyCommandResolution?.({
      shot: commandRecord(shot),
      sigils: sigils.map(fieldRecord),
      sanctuaries: sanctuaries.map(fieldRecord),
    });
    if (resolution && typeof resolution === "object") {
      for (const key of ["sanctuary", "sigil", "fusion"]) {
        if (resolution[key] && typeof resolution[key] === "object") {
          shot[key] = { ...(shot[key] || {}), ...resolution[key] };
        }
      }
    }

    const spec = shot.spec;
    let impactTargets = [];
    if (spec.heals) {
      combat.player.hp = combat.player.maxHp;
      if (ctx.weapons && ctx.weapons.resupply) ctx.weapons.resupply();
      state.reinforcements = Math.min(
        state.maxReinforcements,
        state.reinforcements + (spec.reinforcements || 0)
      );
      if (shot.sanctuary) createSanctuary(shot, shot.sanctuary);
      say("REINFORCEMENT DROP DELIVERED", 2.4);
    } else {
      const explosion = combat.explode(shot.x, shot.y + 1, shot.z, spec.radius, spec.damage);
      impactTargets = Array.isArray(explosion?.targets) ? explosion.targets : [];
      shot.impactTargets = impactTargets;
      say(`${spec.name.toUpperCase()} IMPACT`, 2.0);
    }
    const fusion = resolveFusion(shot);
    const sigil = createSigil(shot, impactTargets);
    const impact = {
      id: shot.id,
      key: shot.key,
      x: shot.x,
      y: shot.y,
      z: shot.z,
      radius: spec.radius,
      damage: spec.damage,
      heals: !!spec.heals,
      fusionId: fusion?.id || null,
      sigilId: sigil?.id || null,
    };
    bus.emit("impact", impact);
    group.remove(shot.marker.group);
  }

  /**
   * Test the live command markers against one accepted rifle ray.
   * A beacon is intentionally a small precision target. This runs alongside
   * enemy/wall hits rather than consuming them: shooting the fuse spends the
   * same real round and heat as any other shot.
   */
  function tryHitCommandBeacon(origin, direction, detail = {}) {
    if (!origin || !direction) return null;
    const ox = finite(origin.x, NaN);
    const oy = finite(origin.y, NaN);
    const oz = finite(origin.z, NaN);
    let dx = finite(direction.x, NaN);
    let dy = finite(direction.y, NaN);
    let dz = finite(direction.z, NaN);
    const length = Math.hypot(dx, dy, dz);
    if (![ox, oy, oz, length].every(Number.isFinite) || length < 1e-5) return null;
    dx /= length; dy /= length; dz /= length;

    let best = null;
    let bestT = Infinity;
    for (const shot of pending) {
      if (!shot.liveFuse || (shot.key !== "orbital" && shot.key !== "cluster")) continue;
      const height = 25;
      const cx = shot.x;
      const cy = shot.y + height * 0.5;
      const cz = shot.z;
      const t = (cx - ox) * dx + (cy - oy) * dy + (cz - oz) * dz;
      if (t < 0 || t >= bestT) continue;
      const qx = ox + dx * t;
      const qy = oy + dy * t;
      const qz = oz + dz * t;
      /* The vertical beam is the target. Keep a generous height but a narrow
         radius, so an aimed shot works without turning every nearby miss into
         fuse acceleration. */
      if (Math.abs(qy - cy) > height * 0.5 + 0.5) continue;
      if (Math.hypot(qx - cx, qz - cz) > 1.45) continue;
      const wall = ctx.collide?.rayBlock?.(ox, oy, oz, dx, dy, dz, t);
      if (Number.isFinite(wall) && wall < t - 0.08) continue;
      best = shot;
      bestT = t;
    }
    if (!best) return null;

    const precision = detail.precision !== false;
    const hook = ctx.progression?.modifyCommandBeaconHit?.({
      shot: commandRecord(best),
      precision,
      point: { x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT },
      alreadyReduced: best.reducedBy || 0,
    });
    if (hook === false || hook?.cancel) return null;
    const directive = hook && typeof hook === "object" ? hook : best.liveFuse;
    const baseSeconds = precision
      ? finite(directive.precisionSeconds, finite(directive.seconds, 0))
      : finite(directive.seconds, 0);
    const maxReduction = Math.max(0, finite(directive.maxReduction,
      finite(best.liveFuse.maxReduction, 0)));
    const room = Math.max(0, maxReduction - (best.reducedBy || 0));
    const reduced = Math.min(Math.max(0, baseSeconds), room, Math.max(0, best.t - 0.08));
    if (reduced <= 0) return null;
    best.t -= reduced;
    best.reducedBy = (best.reducedBy || 0) + reduced;
    const point = { x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT };
    const event = {
      hit: true,
      commandId: best.id,
      key: best.key,
      precision,
      reduced,
      totalReduced: best.reducedBy,
      remaining: best.t,
      x: best.x,
      y: best.y,
      z: best.z,
      point,
    };
    best.marker.beam.material.opacity = 0.92;
    ctx.vfx?.spark?.(point.x, point.y, point.z, 1.25, false, true);
    bus.emit("beaconHit", event);
    return event;
  }

  function blocksEnemyProjectile(detail = {}) {
    if (detail.source && detail.source !== "enemy-fire") return false;
    const enemyKey = detail.enemyKey || detail.enemy || "";
    if (enemyKey && enemyKey !== "gleaner") return false;
    const ps = ctx.player?.state;
    if (!ps) return false;
    for (const field of sanctuaries) {
      if (!field.blocksProjectiles || field.remaining <= 0) continue;
      if (Math.hypot(ps.x - field.x, ps.z - field.z) > field.radius) continue;
      /* A shot originating inside never crossed the boundary. */
      if (Number.isFinite(detail.x) && Number.isFinite(detail.z)
        && Math.hypot(detail.x - field.x, detail.z - field.z) <= field.radius) continue;
      return true;
    }
    return false;
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
    if (state.phase === "won" || state.phase === "lost") {
      if (pending.length || sigils.length || sanctuaries.length || mines.length) {
        clearPending();
        clearFields();
      }
      return;
    }
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

    /* Clear last frame's command orders first. Live fields below repopulate
       them, which prevents an expired beacon from leaving permanent AI state. */
    for (const inst of enemies.live) {
      if (inst.commandLure?.owner === "mission") inst.commandLure = null;
    }

    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const shot = pending[i];
      shot.t -= dt;
      const pulse = 0.24 + Math.sin(state.elapsed * 9) * 0.16;
      shot.marker.beam.material.opacity = pulse;
      if (shot.siren) {
        shot.siren.reacquireFor = Math.max(0, finite(shot.siren.reacquireFor) - dt);
        if (shot.siren.reacquireFor <= 0) {
          const radius = Math.max(0, finite(shot.siren.radius));
          const pullKeys = new Set(Array.isArray(shot.siren.pullKeys)
            ? shot.siren.pullKeys : ["thresher", "gleaner"]);
          const faceKeys = new Set(Array.isArray(shot.siren.faceKeys)
            ? shot.siren.faceKeys : []);
          for (const inst of enemies.live) {
            if (inst.state === "death") continue;
            if (Math.hypot(inst.x - shot.x, inst.z - shot.z) > radius) continue;
            const mode = pullKeys.has(inst.key) ? "pull"
              : (faceKeys.has(inst.key) ? "face" : null);
            if (!mode) continue;
            inst.commandLure = {
              owner: "mission",
              commandId: shot.id,
              x: shot.x,
              z: shot.z,
              mode,
              speedScale: Math.max(0.2, finite(shot.siren.speedScale, 0.72)),
              until: state.elapsed + dt + 0.12,
            };
          }
        }
      }
      if (shot.t <= 0) { resolve(shot); pending.splice(i, 1); }
    }

    const ps = ctx.player.state;
    for (let i = sanctuaries.length - 1; i >= 0; i -= 1) {
      const field = sanctuaries[i];
      field.remaining -= dt;
      const inside = Math.hypot(ps.x - field.x, ps.z - field.z) <= field.radius;
      if (inside && ps.grounded && !combat.player.dead) {
        if (field.heatPerSecond > 0) {
          ctx.weapons?.coolHeat?.(field.heatPerSecond * dt, { reason: "field-chapel" });
        }
        if (field.chargePerSecond > 0) {
          ctx.jetpack?.restoreCharge?.(field.chargePerSecond * dt, "field-chapel");
        }
      }
      if (field.drawRadius > 0) {
        for (const inst of enemies.live) {
          if (inst.state === "death") continue;
          if (Math.hypot(inst.x - field.x, inst.z - field.z) > field.drawRadius) continue;
          inst.commandLure = {
            owner: "mission",
            commandId: field.commandId,
            x: field.x,
            z: field.z,
            mode: "pull",
            speedScale: 0.66,
            until: state.elapsed + dt + 0.12,
          };
        }
      }
      const ratio = Math.max(0, Math.min(1, field.remaining / 14));
      field.marker.fill.material.opacity = 0.045 + ratio * 0.08;
      field.marker.rim.material.opacity = 0.18 + Math.sin(state.elapsed * 5.2) * 0.08;
      if (field.remaining <= 0) {
        disposeField(field);
        sanctuaries.splice(i, 1);
        bus.emit("sanctuaryEnded", fieldRecord(field));
      }
    }

    for (let i = sigils.length - 1; i >= 0; i -= 1) {
      const field = sigils[i];
      field.remaining -= dt;
      field.marker.rim.rotation.z += dt * 0.24;
      field.marker.rim.material.opacity = 0.24 + Math.sin(state.elapsed * 4.4) * 0.1;
      if (field.remaining <= 0) removeSigil(field.id);
    }

    for (let i = mines.length - 1; i >= 0; i -= 1) {
      const mine = mines[i];
      mine.remaining -= dt;
      let target = null;
      for (const inst of enemies.live) {
        if (inst.state === "death" || !combat.targetable?.(inst)) continue;
        if (Math.hypot(inst.x - mine.x, inst.z - mine.z) <= mine.radius) {
          target = inst;
          break;
        }
      }
      if (target) {
        combat.explode(mine.x, mine.y + 0.45, mine.z, mine.radius, mine.damage);
        bus.emit("mine", {
          ...fieldRecord(mine),
          triggered: true,
          targetId: target.id || null,
          targetKey: target.key,
        });
        mine.remaining = 0;
      }
      mine.marker.fill.material.opacity = 0.13 + Math.sin(state.elapsed * 8 + i) * 0.09;
      if (mine.remaining <= 0) {
        disposeField(mine);
        mines.splice(i, 1);
      }
    }

    // Beacon pulse, so an objective reads as live from across a dune.
    for (const r of relays) {
      if (r.done) continue;
      r.beacon.beam.material.opacity = 0.18
        + Math.sin(state.elapsed * 1.9 + r.x) * 0.09;
    }

    if (state.phase === "relays") {
      const { relay, dist } = nearestRelay(ps.x, ps.z);
      if (relay && dist < CHANNEL_RADIUS && ps.grounded && !combat.player.dead) {
        const shieldActive = !!ctx.shield?.state?.active;
        const baseRate = shieldActive ? 0 : 1;
        const objectiveChange = ctx.progression?.modifyObjectiveChannel?.({
          kind: "relay",
          baseRate,
          shieldActive,
          shieldRequested: !!ctx.shield?.state?.requested,
          grounded: !!ps.grounded,
          dt,
          objective: { key: relay.key, x: relay.x, z: relay.z, progress: relay.progress },
          player: { x: ps.x, y: ps.y, z: ps.z },
        });
        const channelRate = Number.isFinite(objectiveChange)
          ? Math.max(0, objectiveChange)
          : Math.max(0, finite(objectiveChange?.progressMultiplier, baseRate));
        state.channelling = channelRate > 0 ? relay : null;
        relay.progress = clamp01(relay.progress + dt * channelRate / CHANNEL_TIME);
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
          const breachesClear = !ctx.breaches || ctx.breaches.state.complete;
          if (d < 24 && ps.grounded && !combat.player.dead && breachesClear) {
            state.phase = "won";
            say("EXTRACTION COMPLETE", 99);
            bus.emit("won", {});
          } else {
            state.extractTimer = 12;
            say(breachesClear
              ? "SHUTTLE HOLDING - GET TO THE PAD"
              : "SHUTTLE HOLDING - PURGE THE BLOOM", 4);
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
        state.reinforcements = 0;
        state.phase = "lost";
        say("MISSION FAILED - NO REINFORCEMENTS", 99);
        bus.emit("lost", {});
      }
    } else if (!combat.player.dead) {
      state.countedDeath = false;
    }
  }

  void world; void clamp;

  function snapshotState() {
    return {
      phase: state.phase,
      relaysDone: state.relaysDone,
      extractCalled: state.extractCalled,
      extractTimer: Number(Math.max(0, state.extractTimer).toFixed(3)),
      elapsed: Number(state.elapsed.toFixed(3)),
      deaths: state.deaths,
      reinforcements: state.reinforcements,
      maxReinforcements: state.maxReinforcements,
      relays: relays.map((relay) => ({
        key: relay.key,
        done: relay.done,
        progress: Number(relay.progress.toFixed(4)),
      })),
      cooldowns: Object.fromEntries(Object.entries(cooldowns)
        .map(([key, value]) => [key, Number(value.toFixed(3))])),
      /* Public field saves are gated while a command is inbound, so this is
         normally empty on disk. Keeping the authoritative flight data in
         snapshots also makes apply() rollback transactional if a later
         subsystem rejects a load while the current command is still spent. */
      pending: pending.map((shot) => ({
        key: shot.key,
        x: Number(shot.x.toFixed(4)),
        z: Number(shot.z.toFixed(4)),
        remaining: Number(Math.max(0, shot.t).toFixed(4)),
      })),
    };
  }

  function clearPending() {
    for (const shot of pending) group.remove(shot.marker.group);
    pending.length = 0;
  }

  function clearFields() {
    for (const field of [...sigils, ...sanctuaries, ...mines]) disposeField(field);
    sigils.length = 0;
    sanctuaries.length = 0;
    mines.length = 0;
    for (const inst of enemies.live) {
      if (inst.commandLure?.owner === "mission") inst.commandLure = null;
    }
  }

  function canFieldSave() {
    return pending.length === 0 && sigils.length === 0
      && sanctuaries.length === 0 && mines.length === 0
      && !state.channelling && !entry.active;
  }

  function restore(saved = {}) {
    clearPending();
    clearFields();
    cancelEntry();
    const phases = new Set(["relays", "extract", "won", "lost"]);
    state.phase = phases.has(saved.phase) ? saved.phase : "relays";
    state.extractCalled = !!saved.extractCalled && state.phase === "extract";
    state.extractTimer = Math.max(0, Number(saved.extractTimer) || 0);
    state.elapsed = Math.max(0, Number(saved.elapsed) || 0);
    state.deaths = Math.max(0, Math.round(Number(saved.deaths) || 0));
    state.maxReinforcements = Math.max(1,
      Math.round(Number(saved.maxReinforcements) || 5));
    state.reinforcements = Math.max(0, Math.min(state.maxReinforcements,
      Math.round(Number(saved.reinforcements) || 0)));
    state.channelling = null;
    state.countedDeath = false;
    state.banner = null;
    state.bannerFor = 0;

    const relayState = new Map((Array.isArray(saved.relays) ? saved.relays : [])
      .filter((relay) => relay && typeof relay.key === "string")
      .map((relay) => [relay.key, relay]));
    let done = 0;
    for (const relay of relays) {
      const restored = relayState.get(relay.key) || {};
      relay.done = !!restored.done;
      relay.progress = relay.done ? 1 : clamp01(Number(restored.progress) || 0);
      if (relay.done) {
        done += 1;
        group.remove(relay.beacon.group);
      } else if (relay.beacon.group.parent !== group) {
        group.add(relay.beacon.group);
      }
    }
    state.relaysDone = done;
    if (state.phase === "relays" && done >= relays.length) state.phase = "extract";
    if (state.phase !== "relays" && done < relays.length) {
      for (const relay of relays) {
        relay.done = true;
        relay.progress = 1;
        group.remove(relay.beacon.group);
      }
      state.relaysDone = relays.length;
    }
    pad.group.visible = state.phase === "extract";

    for (const key of Object.keys(cooldowns)) {
      const value = Number(saved.cooldowns?.[key]);
      cooldowns[key] = Math.max(0, Math.min(STRATAGEMS[key].cooldown,
        Number.isFinite(value) ? value : 0));
    }
    for (const record of Array.isArray(saved.pending) ? saved.pending : []) {
      const spec = STRATAGEMS[record?.key];
      if (!spec) continue;
      const x = Number(record.x);
      const z = Number(record.z);
      const remaining = Number(record.remaining);
      if (![x, z, remaining].every(Number.isFinite) || remaining <= 0) continue;
      pending.push({
        id: nextCommandId(),
        key: record.key,
        spec,
        x,
        z,
        y: groundY(x, z),
        t: Math.min(spec.delay, remaining),
        initialDelay: spec.delay,
        reducedBy: 0,
        relocated: false,
        siren: null,
        liveFuse: null,
        sanctuary: null,
        sigil: null,
        fusion: null,
        marker: makeBeacon(x, z, spec.colour, 30),
      });
    }
    bus.emit("restored", snapshotState());
    return snapshotState();
  }

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
    tryHitCommandBeacon,
    blocksEnemyProjectile,
    pending: () => pending.map(commandRecord),
    activeFields: () => ({
      sigils: sigils.map(fieldRecord),
      sanctuaries: sanctuaries.map(fieldRecord),
      mines: mines.map(fieldRecord),
    }),
    wheelOrder: STRATAGEM_WHEEL_ORDER,
    announce: say,
    snapshot: snapshotState,
    restore,
    canFieldSave,
    update,
    nearestRelay,
    /** Compass bearing and range to whatever matters right now. */
    objective() {
      const ps = ctx.player.state;
      const breach = ctx.breaches?.objective?.();
      if (breach) return breach;
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
