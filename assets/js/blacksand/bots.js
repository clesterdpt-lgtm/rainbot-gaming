/* ============================================================
   BLACKSAND - AI soldiers

   Conquest with only human players needs thirty-two of them. Bots are
   what make the mode playable solo and what keep a half-full server
   feeling like a battle, so they are a first-class system rather than
   target practice.

   ---- the shape of it ----
   Three layers, each running at its own rate:

     squad   (2 Hz)   picks the objective, assigns roles, holds the
                      shared contact list
     think  (12 Hz)   perception, target selection, cover choice,
                      grenades, reloads, retreats
     step  (120 Hz)   aiming, firing, movement, physics

   Perception is the only expensive part and it is the part that is
   time-sliced hardest. A bot never raycasts at every enemy: it filters
   by distance and view cone first, spends at most three line-of-sight
   rays per think, and inherits everything its squad already knows for
   free. Forty bots cost roughly 0.06ms per 120Hz step - see report().

   ---- the thing that must not be lost ----
   Perception is deliberately imperfect. A bot has a view cone, needs
   line of sight, takes time to acquire, and aims with a lagged spring
   plus an error cone that only shrinks with exposure. A bot that snaps
   to your head the frame it sees you is not difficult, it is unfair,
   and every player recognises it instantly.
   ============================================================ */

import { makeRng, hashString, clamp, clamp01, lerp, damp, dampAngle, DEG } from "./core.js";
import { LAYER, SURFACE } from "./physics.js";
import { TEAM } from "./world.js";

const STATE = {
  IDLE: "idle",
  ADVANCE: "advance",
  ENGAGE: "engage",
  SUPPRESS: "suppress",
  FLANK: "flank",
  COVER: "cover",
  RETREAT: "retreat",
  MOUNT: "mount",
  DRIVE: "drive",
  REGROUP: "regroup",
  DEAD: "dead",
};

/**
 * Difficulty. Every entry is [worst, best] and is sampled by the bot's
 * skill, so a firefight contains a conscript who sprays and a veteran
 * who does not miss twice - which is what gives a fight texture. A
 * population that is uniformly "medium" feels synthetic even when the
 * average is right.
 */
const SKILL = {
  acquireTime: [1.35, 0.45],      // seconds from "visible" to accurate
  aimErrorStart: [8.5, 3.0],      // degrees at acquisition
  aimErrorSettled: [2.6, 0.42],   // degrees once settled
  reaction: [0.55, 0.14],         // delay before the first shot
  turnRate: [3.0, 10.0],
  burstLength: [3, 7],            // rounds per burst
  burstPause: [0.85, 0.28],
  coverUse: [0.30, 0.95],         // probability of taking cover at all
  grenadeSkill: [0.15, 0.85],
  retreatAt: [55, 22],            // health at which they break contact
  leadTarget: [0.1, 0.95],        // how well they lead a moving target
};

const MAG_SIZE = 30;
const RELOAD_TIME = 2.6;
const THINK_HZ = 12;

/** Surnames, so the killfeed is not a list of "bot-1-7". */
const NAMES = [
  "REYES", "HOLLAND", "VOSS", "TANAKA", "OKONKWO", "MARSH", "DUBOIS", "KELLER",
  "SOKOLOV", "NAJJAR", "PETROV", "HADDAD", "KOVAC", "AMARI", "BRENNAN", "SILVA",
  "NOVAK", "IBRAHIM", "LARSEN", "MENDOZA", "FAROOQ", "WHITAKER", "ANAND", "COLE",
  "DRAGO", "ESPARZA", "FINCH", "GALLO", "HOLT", "IRVINE", "JANSSEN", "KHOURY",
  "LOWRY", "MAZUR", "NGUYEN", "ORTEGA", "PRICE", "QUINN", "RASMUSSEN", "STROUD",
];

export async function createBots(ctx) {
  const { THREE, render, terrain, physics, world, characters, settings } = ctx;
  const rng = makeRng(ctx.seed ^ 0xb075);

  /* A QA override so the perf harness can measure a full round without
   * having to fake a quality tier. Nothing in the game reads it. */
  const params = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search) : null;
  const forced = params && params.get("bots") ? Number(params.get("bots")) : 0;
  const COUNT = forced > 0
    ? clamp(Math.round(forced), 0, 64)
    : (settings.qa ? 16 : clamp(Math.round(settings.q.maxLights * 1.4), 12, 40));

  const bots = [];
  const squads = [];

  /* ================================================================
     cover map

     Built once, from the physics colliders the structures module has
     already registered. Deriving it from collision rather than from
     the structures module's own data means it stays correct no matter
     what that module builds next, and it automatically includes
     sandbags, containers and barriers as well as buildings.
     ================================================================ */

  const COVER_CELL = 14;
  const coverGrid = new Map();
  let coverCount = 0;

  function coverKey(x, z) {
    return `${Math.floor(x / COVER_CELL)},${Math.floor(z / COVER_CELL)}`;
  }

  function buildCoverMap() {
    const _c = new THREE.Vector3();
    const _n = new THREE.Vector3();
    const candidates = [];

    for (const collider of physics.colliders) {
      if (!collider.active || !(collider.layer & LAYER.STATIC)) continue;
      const he = collider.halfExtents;
      const height = he.y * 2;
      // Cover is something you can stand or crouch behind. A kerb is
      // not cover; a roof slab three metres up is not cover either.
      if (height < 0.6 || height > 5.5) continue;
      if (Math.max(he.x, he.z) < 0.5) continue;
      const topY = collider.center.y + he.y;

      for (const axis of [0, 1]) {
        for (const sign of [-1, 1]) {
          const halfAlong = axis === 0 ? he.z : he.x;
          const halfOut = axis === 0 ? he.x : he.z;
          const stepCount = Math.min(6, Math.max(1, Math.round(halfAlong * 2 / 2.2)));
          for (let i = 0; i < stepCount; i += 1) {
            const t = stepCount === 1 ? 0 : (i / (stepCount - 1) - 0.5) * 2 * (halfAlong - 0.4);
            _n.set(axis === 0 ? sign : 0, 0, axis === 0 ? 0 : sign);
            _c.set(
              axis === 0 ? sign * (halfOut + 0.62) : t,
              -he.y,
              axis === 0 ? t : sign * (halfOut + 0.62)
            );
            _c.applyQuaternion(collider.quaternion).add(collider.center);
            _n.applyQuaternion(collider.quaternion);
            const groundY = terrain.heightAt(_c.x, _c.z);
            // Reject anything hanging in the air or buried.
            if (topY - groundY < 0.55 || topY - groundY > 4.5) continue;
            if (Math.abs(collider.center.y - he.y - groundY) > 1.6) continue;
            candidates.push({
              x: _c.x, y: groundY, z: _c.z,
              nx: _n.x, nz: _n.z,
              /** How much of a soldier this hides: 1 = full standing. */
              value: clamp01((topY - groundY) / 1.75),
              claimed: null,
            });
          }
        }
      }
    }

    // Cap the set. Ten thousand cover points would be a memory and a
    // search cost for no behavioural gain - a bot only ever looks at
    // the handful inside 30m.
    const CAP = 900;
    const chosen = candidates.length > CAP
      ? rng.shuffle(candidates).slice(0, CAP)
      : candidates;
    for (const point of chosen) {
      const key = coverKey(point.x, point.z);
      if (!coverGrid.has(key)) coverGrid.set(key, []);
      coverGrid.get(key).push(point);
    }
    coverCount = chosen.length;
  }

  buildCoverMap();

  const _scratch = [];
  function coverNear(x, z, radius, out) {
    out.length = 0;
    const r = Math.ceil(radius / COVER_CELL);
    const cx = Math.floor(x / COVER_CELL);
    const cz = Math.floor(z / COVER_CELL);
    for (let i = -r; i <= r; i += 1) {
      for (let j = -r; j <= r; j += 1) {
        const cell = coverGrid.get(`${cx + i},${cz + j}`);
        if (cell) for (const p of cell) out.push(p);
      }
    }
    return out;
  }

  /* ================================================================
     squads
     ================================================================ */

  function makeSquad(team, index) {
    const squad = {
      id: `${team === TEAM.BLUE ? "B" : "R"}${index + 1}`,
      team,
      members: [],
      objective: null,
      role: "attack",
      /** Shared contacts: everything any member has seen recently.
       *  This is both a tactic (squads call targets) and the single
       *  biggest saving in the perception budget. */
      contacts: new Map(),
      rally: new THREE.Vector3(),
      orderTimer: 0,
      /** Which member is currently swinging wide. */
      flanker: null,
      vehicle: null,
    };
    squads.push(squad);
    return squad;
  }

  function shareContact(squad, entity, position, now) {
    const key = entity.isPlayer ? "player" : entity.ref.id;
    let record = squad.contacts.get(key);
    if (!record) {
      record = { entity, position: position.clone(), time: now, firstSeen: now };
      squad.contacts.set(key, record);
    } else {
      record.entity = entity;
      record.position.copy(position);
      record.time = now;
    }
    return record;
  }

  function pruneContacts(squad, now) {
    for (const [key, record] of squad.contacts) {
      if (now - record.time > 12) squad.contacts.delete(key);
    }
  }

  /* ================================================================
     bots
     ================================================================ */

  function makeBot(team, index, squad) {
    const seed = hashString(`bs-bot-${team}-${index}-${ctx.seed}`);
    const character = characters.build(team, { seed });
    characters.add(character);

    // Skill is gaussian rather than uniform: most soldiers are average
    // and the ends of the distribution are what people remember.
    const skill = clamp(rng.gauss() * 0.23 + 0.52, 0.04, 0.99);
    const pick = (pair) => lerp(pair[0], pair[1], skill);

    const bot = {
      id: `bot-${team}-${index}`,
      name: NAMES[(index * 7 + team * 13) % NAMES.length],
      team,
      squad,
      character,
      root: character.root,
      skill,
      /** Independent of skill: a poor shot can still be brave. */
      aggression: clamp(rng.gauss() * 0.25 + 0.5, 0.05, 0.98),
      cfg: {
        acquireTime: pick(SKILL.acquireTime),
        aimErrorStart: pick(SKILL.aimErrorStart),
        aimErrorSettled: pick(SKILL.aimErrorSettled),
        reaction: pick(SKILL.reaction),
        turnRate: pick(SKILL.turnRate),
        burstLength: Math.round(pick(SKILL.burstLength)),
        burstPause: pick(SKILL.burstPause),
        coverUse: pick(SKILL.coverUse),
        grenadeSkill: pick(SKILL.grenadeSkill),
        retreatAt: pick(SKILL.retreatAt),
        leadTarget: pick(SKILL.leadTarget),
      },

      alive: true,
      health: 100,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      lastPosition: new THREE.Vector3(),
      yaw: rng.range(0, Math.PI * 2),
      pitch: 0,
      aimYaw: 0,
      aimPitch: 0,
      state: STATE.ADVANCE,

      target: null,
      targetSeenFor: 0,
      targetLostFor: 0,
      lastKnown: new THREE.Vector3(),
      hasLastKnown: false,
      reactionTimer: 0,
      fireTimer: 0,
      burstLeft: 0,
      ammo: MAG_SIZE,
      reloadTimer: 0,
      grenadeTimer: rng.range(6, 26),
      grenadesLeft: 2,

      objective: null,
      pathTarget: new THREE.Vector3(),
      repathTimer: 0,
      detour: null,
      detourTimer: 0,
      vaultTimer: 0,
      vaultProgress: 0,

      cover: null,
      coverTimer: 0,
      peekTimer: rng.range(0.5, 2.5),
      peeking: 1,
      lean: 0,

      stance: "stand",
      wantStance: "stand",
      speed: 0,
      moveAngle: 0,
      sprint: 0,
      firing: 0,
      suppression: 0,
      lastHitAt: -99,
      respawnTimer: 0,
      kills: 0,
      deaths: 0,

      vehicle: null,
      vehicleTimer: 0,

      stanceTimer: 0,
      vaultCooldown: 0,
      vaultTo: new THREE.Vector3(),

      /** Cached steering, recomputed on the think tick. */
      wish: new THREE.Vector3(),
      separation: new THREE.Vector3(),
      thinkPhase: rng.range(0, 1 / THINK_HZ),
    };

    // A stable wrapper, allocated once. Rebuilding these every
    // perception pass was twenty thousand short-lived objects a second
    // for forty bots - invisible in a profile, obvious in the GC saw.
    bot.entity = { isPlayer: false, position: bot.position, ref: bot };

    squad.members.push(bot);
    respawn(bot);
    bots.push(bot);
    return bot;
  }

  function respawn(bot) {
    const enemies = [];
    for (const other of bots) if (other.team !== bot.team && other.alive) enemies.push(other.position);
    if (ctx.player && ctx.player.state.team !== bot.team && ctx.player.state.alive) {
      enemies.push(ctx.player.position);
    }
    const spawn = world.pickSpawn(bot.team, enemies);
    bot.position.copy(spawn);
    bot.position.y = terrain.heightAt(spawn.x, spawn.z);
    bot.lastPosition.copy(bot.position);
    bot.velocity.set(0, 0, 0);
    bot.alive = true;
    bot.health = 100;
    bot.ammo = MAG_SIZE;
    bot.reloadTimer = 0;
    bot.grenadesLeft = 2;
    bot.state = STATE.ADVANCE;
    bot.target = null;
    bot.hasLastKnown = false;
    bot.releaseCover?.();
    releaseCover(bot);
    bot.stance = "stand";
    bot.root.visible = true;
    pickObjective(bot);
  }

  const SQUAD_SIZE = 4;
  for (let i = 0; i < COUNT; i += 1) {
    const team = i % 2 === 0 ? TEAM.BLUE : TEAM.RED;
    const teamIndex = Math.floor(i / 2);
    const squadIndex = Math.floor(teamIndex / SQUAD_SIZE);
    let squad = squads.find((s) => s.team === team && s.id.endsWith(String(squadIndex + 1))
      && s.members.length < SQUAD_SIZE);
    if (!squad) squad = makeSquad(team, squadIndex);
    makeBot(team, i, squad);
  }
  for (const squad of squads) squad.leader = squad.members[0] || null;

  /* ================================================================
     objectives
     ================================================================ */

  /**
   * Squad-level objective choice.
   *
   * The important behaviours are: do not send every squad to the same
   * flag, defend what you own when you own enough of it to be winning,
   * and go straight at whatever is currently being taken off you.
   */
  function chooseSquadObjective(squad) {
    const owned = world.controlPoints.filter((p) => p.owner === squad.team).length;
    const total = world.controlPoints.length;
    const winning = owned > total / 2;

    let centre = null;
    let alive = 0;
    for (const member of squad.members) {
      if (!member.alive) continue;
      if (!centre) centre = member.position.clone();
      else centre.add(member.position);
      alive += 1;
    }
    if (!alive) return;
    centre.multiplyScalar(1 / alive);

    let best = null;
    let bestScore = -Infinity;
    for (const point of world.controlPoints) {
      const distance = centre.distanceTo(point.position);
      let score = -distance * 0.035;
      if (point.owner !== squad.team) score += 6;
      if (point.owner === TEAM.NONE) score += 2.5;
      // A flag actively flipping outranks everything: that is the one
      // that decides the match in the next thirty seconds.
      if (point.contested) score += 9;
      if (point.owner === squad.team) {
        score += winning ? 3.2 : 0.5;
        // Defend the one nearest the enemy, not the one nearest home.
        score += clamp01(1 - distance / 400) * 1.5;
      }
      // Spread the effort: two squads on the same flag is one wasted.
      let taken = 0;
      for (const other of squads) {
        if (other !== squad && other.team === squad.team && other.objective === point) taken += 1;
      }
      score -= taken * 3.4;
      score += rng() * 1.6;
      if (score > bestScore) { bestScore = score; best = point; }
    }

    squad.objective = best;
    squad.role = best && best.owner === squad.team ? "defend" : "attack";
    if (best) {
      const a = rng.range(0, Math.PI * 2);
      const d = best.radius * (squad.role === "defend" ? rng.range(0.35, 0.9) : rng.range(0.2, 0.8));
      squad.rally.set(
        best.position.x + Math.cos(a) * d, 0, best.position.z + Math.sin(a) * d
      );
      squad.rally.y = terrain.heightAt(squad.rally.x, squad.rally.z);
    }
    for (const member of squad.members) pickObjective(member);
  }

  function pickObjective(bot) {
    const squad = bot.squad;
    if (!squad.objective) chooseSquadObjective(squad);
    bot.objective = squad.objective;
    if (!bot.objective) return;
    // Individual scatter around the squad's rally point, so four
    // soldiers arrive as a formation rather than as a conga line.
    const a = rng.range(0, Math.PI * 2);
    const spread = bot.squad.role === "defend" ? rng.range(3, 14) : rng.range(2, 9);
    bot.pathTarget.set(
      squad.rally.x + Math.cos(a) * spread, 0, squad.rally.z + Math.sin(a) * spread
    );
    bot.pathTarget.y = terrain.heightAt(bot.pathTarget.x, bot.pathTarget.z);
    bot.repathTimer = rng.range(5, 12);
  }

  // A flag changing hands is the loudest event in Conquest. Every squad
  // reconsiders immediately rather than waiting out its own timer.
  world.onCapture?.(() => {
    for (const squad of squads) squad.orderTimer = rng.range(0, 0.6);
  });

  /* ================================================================
     perception
     ================================================================ */

  const _toTarget = new THREE.Vector3();
  const _eye = new THREE.Vector3();
  const _targetEye = new THREE.Vector3();
  const _facing = new THREE.Vector3();
  const _tmp = new THREE.Vector3();

  let losRays = 0;
  let thinkMs = 0;
  let thinkCalls = 0;

  function eyeHeight(entity) {
    if (entity.isPlayer) return 0;
    const stance = entity.ref.stance;
    return stance === "prone" ? 0.42 : stance === "crouch" ? 1.10 : 1.58;
  }

  function eyeOf(entity, out) {
    if (entity.isPlayer) return out.copy(entity.ref.eyePosition);
    return out.set(
      entity.position.x, entity.position.y + eyeHeight(entity), entity.position.z
    );
  }

  function botEye(bot, out) {
    const h = bot.stance === "prone" ? 0.42 : bot.stance === "crouch" ? 1.10 : 1.58;
    return out.set(bot.position.x, bot.position.y + h, bot.position.z);
  }

  /** Everything a bot could shoot at, filled into a reused array. */
  const _enemies = [];
  function enemiesOf(bot) {
    _enemies.length = 0;
    for (const other of bots) {
      if (other.team === bot.team || !other.alive) continue;
      _enemies.push({ isPlayer: false, position: other.position, ref: other });
    }
    if (ctx.player && ctx.player.state.team !== bot.team && ctx.player.state.alive) {
      _enemies.push({ isPlayer: true, position: ctx.player.position, ref: ctx.player });
    }
    return _enemies;
  }

  const VIEW_RANGE = 280;
  const VIEW_COS = Math.cos(58 * DEG);
  /** Rays a single bot may spend on line of sight in one think. The
   *  whole perception budget is this number times the think rate. */
  const LOS_BUDGET = 3;

  function hasLineOfSight(bot, entity) {
    botEye(bot, _eye);
    eyeOf(entity, _targetEye);
    losRays += 1;
    return physics.lineOfSight(_eye, _targetEye, LAYER.TERRAIN | LAYER.STATIC);
  }

  /**
   * One perception pass.
   *
   * Cheap rejections first and in this order - team, alive, distance,
   * view cone - because each one removes candidates before the only
   * expensive test. What actually keeps this affordable is that at most
   * LOS_BUDGET rays are fired per bot per think, spent on the closest
   * candidates, and that the squad's shared contacts fill in the rest.
   */
  const _candidates = [];
  function perceive(bot, now) {
    const enemies = enemiesOf(bot);
    _candidates.length = 0;

    _facing.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    // Awareness widens when you are being shot at, and a bot that has
    // just taken a round should be able to find the shooter behind it.
    const cone = bot.suppression > 0.1 || now - bot.lastHitAt < 3 ? -0.2 : VIEW_COS;
    const range = VIEW_RANGE * lerp(0.65, 1.0, bot.skill);

    for (const enemy of enemies) {
      const dx = enemy.position.x - bot.position.x;
      const dz = enemy.position.z - bot.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > range * range) continue;
      const distance = Math.sqrt(distSq) || 1e-4;
      const dot = (_facing.x * dx + _facing.z * dz) / distance;
      if (dot < cone) continue;
      // A prone soldier at 200m is genuinely hard to pick out; a
      // sprinting one at 40m is not. Movement and stance bias the
      // effective range so bots reward the same play a human does.
      let ease = 1;
      if (!enemy.isPlayer) {
        if (enemy.ref.stance === "prone") ease *= 0.45;
        else if (enemy.ref.stance === "crouch") ease *= 0.75;
        ease *= lerp(0.8, 1.35, clamp01(enemy.ref.speed / 5));
      } else {
        const p = ctx.player.state;
        if (p.stance === "prone") ease *= 0.45;
        else if (p.stance === "crouch") ease *= 0.75;
        ease *= lerp(0.8, 1.35, clamp01((p.speed || 0) / 5));
      }
      if (distance > range * ease) continue;
      _candidates.push({ enemy, distance, dot });
    }

    if (!_candidates.length) return null;
    // Closest first: what will kill you soonest is what you look at.
    _candidates.sort((a, b) => a.distance - b.distance);

    let seen = null;
    const budget = Math.min(LOS_BUDGET, _candidates.length);
    for (let i = 0; i < budget; i += 1) {
      const candidate = _candidates[i];
      if (!hasLineOfSight(bot, candidate.enemy)) continue;
      seen = candidate.enemy;
      shareContact(bot.squad, candidate.enemy, candidate.enemy.position, now);
      break;
    }
    return seen;
  }

  /** A target the squad knows about but this bot cannot see. Used to
   *  move onto contacts and to suppress a position. */
  function bestSharedContact(bot, now) {
    let best = null;
    let bestScore = -Infinity;
    for (const record of bot.squad.contacts.values()) {
      const age = now - record.time;
      if (age > 9) continue;
      const alive = record.entity.isPlayer
        ? ctx.player.state.alive : record.entity.ref.alive;
      if (!alive) continue;
      const distance = bot.position.distanceTo(record.position);
      const score = -distance * 0.02 - age * 0.7;
      if (score > bestScore) { bestScore = score; best = record; }
    }
    return best;
  }

  /* ================================================================
     cover
     ================================================================ */

  function releaseCover(bot) {
    if (bot.cover && bot.cover.claimed === bot) bot.cover.claimed = null;
    bot.cover = null;
  }

  /**
   * Find a position that breaks line of sight to a threat but is close
   * enough to shoot from.
   *
   * The scoring matters more than the search: a bot that takes the
   * nearest cover regardless of direction ends up hiding behind a wall
   * with the enemy on its side of it. The face normal has to point back
   * at the threat, and the final candidates are verified with a real
   * ray, because the normal alone does not know how tall the thing is.
   */
  function findCover(bot, threat, radius = 30) {
    coverNear(bot.position.x, bot.position.z, radius, _scratch);
    if (!_scratch.length) return null;

    let ranked = null;
    let rankedScore = -Infinity;
    let second = null;
    let secondScore = -Infinity;

    for (const point of _scratch) {
      if (point.claimed && point.claimed !== bot && point.claimed.alive) continue;
      const dx = point.x - bot.position.x;
      const dz = point.z - bot.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > radius) continue;

      const tx = threat.x - point.x;
      const tz = threat.z - point.z;
      const tLen = Math.hypot(tx, tz) || 1e-4;
      // The protected face must be between the soldier and the threat.
      const facing = (point.nx * tx + point.nz * tz) / tLen;
      if (facing > -0.30) continue;
      // Do not run through the enemy to reach cover, and do not pick
      // cover so far back it leaves the fight.
      if (tLen > 130 || tLen < 6) continue;

      let score = point.value * 6 - distance * 0.30 - facing * 3;
      if (bot.objective) score -= point.value * 0 + Math.abs(
        bot.objective.position.distanceTo(_tmp.set(point.x, point.y, point.z))
        - bot.objective.radius
      ) * 0.012;
      if (score > rankedScore) {
        second = ranked; secondScore = rankedScore;
        ranked = point; rankedScore = score;
      } else if (score > secondScore) { second = point; secondScore = score; }
    }

    for (const candidate of [ranked, second]) {
      if (!candidate) continue;
      // Verified two ways: the soldier must fit, and the cover must
      // actually block. `capsuleFree` is the physics module's own test,
      // so a bot cannot pick a spot inside a wall.
      if (physics.capsuleFree
        && !physics.capsuleFree(
          _tmp.set(candidate.x, candidate.y + 0.1, candidate.z), 0.34, 1.8,
          LAYER.STATIC | LAYER.VEHICLE
        )) continue;
      _eye.set(candidate.x, candidate.y + 1.05, candidate.z);
      _targetEye.set(threat.x, threat.y + 1.5, threat.z);
      losRays += 1;
      if (physics.lineOfSight(_eye, _targetEye, LAYER.TERRAIN | LAYER.STATIC)) continue;
      return candidate;
    }
    return null;
  }

  /* ================================================================
     grenades
     ================================================================ */

  const GRENADE_CAP = 12;
  const grenadeMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.06, 0),
    new THREE.MeshStandardMaterial({ color: 0x3c4235, roughness: 0.75, metalness: 0.35 }),
    GRENADE_CAP
  );
  grenadeMesh.frustumCulled = false;
  grenadeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  grenadeMesh.count = 0;
  grenadeMesh.castShadow = false;
  grenadeMesh.userData.qaOpaque = false;
  render.scene.add(grenadeMesh);

  const grenades = [];
  const _gm = new THREE.Matrix4();
  const _gq = new THREE.Quaternion();
  const _gs = new THREE.Vector3(1, 1, 1);

  function throwGrenade(bot, targetPos) {
    if (grenades.length >= GRENADE_CAP || bot.grenadesLeft <= 0) return false;
    botEye(bot, _eye);
    const dx = targetPos.x - _eye.x;
    const dz = targetPos.z - _eye.z;
    const flat = Math.hypot(dx, dz);
    if (flat < 9 || flat > 34) return false;

    // Ballistic solve for a 45-degree-ish lob. The skill term is
    // applied as an error on the aim point, not on the physics, so a
    // bad throw still travels like a grenade.
    const g = 22;
    const rise = Math.max(0.6, (targetPos.y - _eye.y) + 1.0);
    const angle = lerp(0.62, 0.80, 1 - clamp01(flat / 34));
    const speed = Math.sqrt(
      (g * flat * flat) / (2 * Math.cos(angle) * Math.cos(angle) * (flat * Math.tan(angle) - rise))
    );
    if (!Number.isFinite(speed) || speed <= 0 || speed > 40) return false;

    const spread = lerp(3.6, 0.9, bot.cfg.grenadeSkill);
    const dir = new THREE.Vector3(dx / flat, 0, dz / flat);
    const right = new THREE.Vector3(dir.z, 0, -dir.x);
    const aim = dir.clone()
      .multiplyScalar(Math.cos(angle) * speed)
      .addScaledVector(right, rng.gauss() * spread * 0.4);
    aim.y = Math.sin(angle) * speed;

    grenades.push({
      position: _eye.clone().addScaledVector(dir, 0.4),
      velocity: aim,
      fuse: rng.range(2.4, 3.2),
      owner: bot,
      bounces: 0,
    });
    bot.grenadesLeft -= 1;
    bot.grenadeTimer = rng.range(18, 40);
    ctx.audio?.playAt?.("click", bot.position, { volume: 0.4 });
    return true;
  }

  function updateGrenades(dt) {
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.velocity.y -= 22 * dt;
      _tmp.copy(g.velocity).multiplyScalar(dt);
      const travel = _tmp.length();
      if (travel > 0.001) {
        const hit = physics.raycast(g.position, _tmp.clone().multiplyScalar(1 / travel), travel, {
          layer: LAYER.TERRAIN | LAYER.STATIC | LAYER.VEHICLE,
        });
        if (hit.hit) {
          g.position.copy(hit.point).addScaledVector(hit.normal, 0.05);
          g.velocity.reflect(hit.normal).multiplyScalar(0.34);
          g.bounces += 1;
        } else {
          g.position.add(_tmp);
        }
      }
      const ground = terrain.heightAt(g.position.x, g.position.z);
      if (g.position.y < ground + 0.06) {
        g.position.y = ground + 0.06;
        g.velocity.y = Math.abs(g.velocity.y) * 0.3;
        g.velocity.x *= 0.6; g.velocity.z *= 0.6;
      }

      g.fuse -= dt;
      if (g.fuse <= 0) {
        detonate(g);
        grenades.splice(i, 1);
      }
    }

    grenadeMesh.count = grenades.length;
    for (let i = 0; i < grenades.length; i += 1) {
      _gm.compose(grenades[i].position, _gq, _gs);
      grenadeMesh.setMatrixAt(i, _gm);
    }
    if (grenades.length) grenadeMesh.instanceMatrix.needsUpdate = true;
  }

  function detonate(g) {
    const RADIUS = 7.5;
    ctx.vfx?.explosion?.(g.position, RADIUS, {});
    ctx.audio?.explosion?.(g.position, 1);

    const falloff = (position) => {
      const d = position.distanceTo(g.position);
      if (d > RADIUS) return 0;
      // Anything solid between the blast and the body stops most of it.
      _eye.copy(g.position); _eye.y += 0.2;
      _targetEye.set(position.x, position.y + 1.0, position.z);
      losRays += 1;
      if (!physics.lineOfSight(_eye, _targetEye, LAYER.TERRAIN | LAYER.STATIC)) return 0;
      return clamp01(1 - d / RADIUS) ** 1.4;
    };

    for (const bot of bots) {
      if (!bot.alive) continue;
      const f = falloff(bot.position);
      if (f > 0.02) applyDamage(bot, 115 * f, { source: g.owner, cause: "explosive" });
    }
    if (ctx.player && ctx.player.state.alive) {
      const f = falloff(ctx.player.position);
      if (f > 0.02) ctx.player.applyDamage(115 * f, g.owner, "explosive");
      if (f > 0.005) ctx.player.addSuppression?.(f * 1.4);
    }
    ctx.vehicles?.vehicles?.forEach((vehicle) => {
      if (!vehicle.alive) return;
      const d = vehicle.position.distanceTo(g.position);
      if (d < RADIUS) ctx.vehicles.damage?.(vehicle, 60 * clamp01(1 - d / RADIUS), g.owner);
    });
  }

  /* ================================================================
     combat
     ================================================================ */

  const _aimDir = new THREE.Vector3();
  const _lead = new THREE.Vector3();

  function targetVelocity(entity, out) {
    if (entity.isPlayer) return out.copy(ctx.player.velocity || _tmp.set(0, 0, 0));
    return out.copy(entity.ref.velocity);
  }

  function aimAt(bot, target, dt) {
    eyeOf(target, _targetEye);
    botEye(bot, _eye);
    _toTarget.copy(_targetEye).sub(_eye);
    const distance = _toTarget.length();
    if (distance < 1e-3) return 0;

    // Lead the target. Poor bots do not, and the difference is exactly
    // what makes strafing work against some of them and not others.
    targetVelocity(target, _lead);
    const flight = distance / 780;
    _toTarget.addScaledVector(_lead, flight * bot.cfg.leadTarget);
    _toTarget.normalize();

    const wantYaw = Math.atan2(-_toTarget.x, -_toTarget.z);
    const wantPitch = Math.asin(clamp(_toTarget.y, -1, 1));
    // Turning slows down the closer the weapon already is: a spring
    // that is fast everywhere snaps, and a snap is what players read as
    // an aimbot even when the shot misses.
    const rate = bot.cfg.turnRate * lerp(1.4, 0.7, clamp01(bot.targetSeenFor));
    bot.aimYaw = dampAngle(bot.aimYaw, wantYaw, rate, dt);
    bot.aimPitch = damp(bot.aimPitch, wantPitch, rate, dt);
    return distance;
  }

  function shoot(bot, target, dt) {
    if (bot.reloadTimer > 0) return;
    const distance = aimAt(bot, target, dt);
    if (distance <= 0) return;

    bot.reactionTimer -= dt;
    if (bot.reactionTimer > 0) return;

    // Do not fire while the weapon is still swinging onto the target.
    const aimOff = Math.abs(
      Math.atan2(Math.sin(bot.aimYaw - bot.yaw), Math.cos(bot.aimYaw - bot.yaw))
    );
    if (aimOff > 0.22) return;

    bot.fireTimer -= dt;
    if (bot.fireTimer > 0) return;

    if (bot.ammo <= 0) {
      bot.reloadTimer = RELOAD_TIME;
      return;
    }

    // Bursts, not a continuous stream. Forty bots on full auto is white
    // noise; bursts with gaps is a firefight you can hear the shape of.
    if (bot.burstLeft <= 0) {
      bot.burstLeft = Math.max(1, bot.cfg.burstLength + rng.int(-1, 2));
      bot.fireTimer = bot.cfg.burstPause * rng.range(0.7, 1.5);
      return;
    }
    bot.burstLeft -= 1;
    bot.fireTimer = 60 / 620;
    bot.ammo -= 1;
    bot.firing = 1;

    const settle = clamp01(bot.targetSeenFor / bot.cfg.acquireTime);
    let errorDeg = lerp(bot.cfg.aimErrorStart, bot.cfg.aimErrorSettled, settle);
    // Everything that should make a bot miss, does.
    errorDeg *= lerp(1, 2.1, clamp01(bot.speed / 5));
    errorDeg *= lerp(1, 1.9, clamp01(bot.suppression));
    errorDeg *= bot.stance === "prone" ? 0.6 : bot.stance === "crouch" ? 0.8 : 1;
    errorDeg *= lerp(1.0, 1.45, clamp01((distance - 60) / 180));

    botEye(bot, _eye);
    eyeOf(target, _targetEye);
    _aimDir.copy(_targetEye).sub(_eye).normalize();

    const spread = errorDeg * DEG;
    const angle = rng() * Math.PI * 2;
    const radius = Math.sqrt(rng()) * Math.tan(spread);
    const right = _tmp.set(_aimDir.z, 0, -_aimDir.x);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, _aimDir).normalize();
    const dir = _aimDir.clone()
      .addScaledVector(right, Math.cos(angle) * radius)
      .addScaledVector(up, Math.sin(angle) * radius)
      .normalize();

    const muzzle = _eye.clone().addScaledVector(dir, 0.5);
    ctx.vfx?.muzzleFlash?.(muzzle, dir, 0.75);
    ctx.audio?.gunshot?.(muzzle, { gain: 0.85 });
    if (rng.chance(0.3)) {
      ctx.vfx?.tracer?.(muzzle, dir, Math.min(distance + 20, 400), { speed: 880, colour: 0xffbe6a });
    }

    const worldHit = physics.raycast(muzzle, dir, 400, {
      layer: LAYER.TERRAIN | LAYER.STATIC | LAYER.VEHICLE,
    });
    const characterHit = raycastCharacters(
      muzzle, dir, worldHit.hit ? worldHit.distance : 400, bot.team
    );

    if (characterHit) {
      const damage = 24 * characterHit.multiplier;
      ctx.vfx?.impact?.(characterHit.point, characterHit.normal, SURFACE.FLESH, 1);
      if (characterHit.target.isPlayerTarget) {
        ctx.player.applyDamage(damage, bot, "bullet");
      } else {
        const killed = applyDamage(characterHit.target, damage, {
          source: bot, headshot: characterHit.part === "head",
        });
        if (killed) bot.kills += 1;
      }
    } else if (worldHit.hit) {
      ctx.vfx?.impact?.(worldHit.point, worldHit.normal, worldHit.surface, 0.8);
    }

    // Near-miss crack. This is what tells a player they are under fire
    // and drives both the player's suppression and the bots' own.
    crackAlong(bot, muzzle, dir, distance);
  }

  function crackAlong(bot, muzzle, dir, distance) {
    if (ctx.player && ctx.player.state.alive && ctx.player.state.team !== bot.team) {
      _tmp.copy(ctx.player.eyePosition).sub(muzzle);
      const along = _tmp.dot(dir);
      if (along > 0 && along < 300) {
        const perpendicular = _tmp.addScaledVector(dir, -along).length();
        if (perpendicular < 3.2) {
          const intensity = 1 - perpendicular / 3.2;
          ctx.audio?.bulletCrack?.(ctx.player.eyePosition, intensity);
          ctx.player.addSuppression?.(0.34 * intensity);
        }
      }
    }
    // Bots are suppressed too. A squad pinned by fire it cannot answer
    // is the behaviour that makes a machine gun worth carrying.
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      if (other.position.distanceToSquared(muzzle) > 90000) continue;
      _tmp.copy(other.position).sub(muzzle);
      _tmp.y += 1.0;
      const along = _tmp.dot(dir);
      if (along <= 0 || along > distance + 30) continue;
      const perpendicular = _tmp.addScaledVector(dir, -along).length();
      if (perpendicular < 2.6) {
        other.suppression = clamp01(other.suppression + 0.30 * (1 - perpendicular / 2.6));
        if (!other.hasLastKnown) {
          other.lastKnown.copy(bot.position);
          other.hasLastKnown = true;
        }
      }
    }
  }

  /* ================================================================
     hit detection
     ================================================================ */

  const _boxMin = new THREE.Vector3();
  const _boxMax = new THREE.Vector3();

  /** Slab test against an axis-aligned hitbox in world space. Bots do
   *  not rotate their hitboxes: at soldier proportions the error is
   *  under 10cm and it removes a quaternion inverse per box per shot. */
  function rayAabb(origin, direction, min, max, maxDist) {
    let tMin = 0;
    let tMax = maxDist;
    for (const axis of ["x", "y", "z"]) {
      const d = direction[axis];
      const o = origin[axis];
      if (Math.abs(d) < 1e-8) {
        if (o < min[axis] || o > max[axis]) return -1;
      } else {
        const inv = 1 / d;
        let t1 = (min[axis] - o) * inv;
        let t2 = (max[axis] - o) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) return -1;
      }
    }
    return tMin;
  }

  function raycastCharacters(origin, direction, maxDist, excludeTeam = null) {
    let best = null;

    const test = (entity, position, isPlayerTarget, stance) => {
      const toEntity = _tmp.copy(position).sub(origin);
      const along = toEntity.dot(direction);
      if (along < -2 || along > maxDist + 2) return;
      const perpendicular = toEntity.addScaledVector(direction, -along).length();
      if (perpendicular > 1.6) return;

      // A crouching soldier really is a smaller target. Taking the
      // boxes from the same place the pose does means the thing you see
      // and the thing you can hit cannot drift apart.
      const boxes = characters.hitboxesFor ? characters.hitboxesFor(stance) : characters.HITBOXES;
      for (const box of boxes) {
        _boxMin.set(
          position.x + box.offset[0] - box.size[0] * 0.5,
          position.y + box.offset[1] - box.size[1] * 0.5,
          position.z + box.offset[2] - box.size[2] * 0.5
        );
        _boxMax.set(
          position.x + box.offset[0] + box.size[0] * 0.5,
          position.y + box.offset[1] + box.size[1] * 0.5,
          position.z + box.offset[2] + box.size[2] * 0.5
        );
        const t = rayAabb(origin, direction, _boxMin, _boxMax, best ? best.distance : maxDist);
        if (t < 0) continue;
        if (best && t >= best.distance) continue;
        best = {
          distance: t,
          point: origin.clone().addScaledVector(direction, t),
          normal: direction.clone().negate(),
          target: entity,
          part: box.name,
          multiplier: box.multiplier,
        };
      }
    };

    for (const bot of bots) {
      if (!bot.alive || bot.vehicle) continue;
      if (excludeTeam !== null && bot.team === excludeTeam) continue;
      test(bot, bot.position, false, bot.stance);
    }
    if (excludeTeam !== null && ctx.player && ctx.player.state.alive
      && ctx.player.state.team !== excludeTeam) {
      const marker = { isPlayerTarget: true, ref: ctx.player };
      test(marker, ctx.player.position, true, ctx.player.state.stance);
    }
    return best;
  }

  /* ================================================================
     damage
     ================================================================ */

  function applyDamage(bot, amount, options = {}) {
    if (!bot || !bot.alive) return false;
    bot.health -= amount;
    bot.lastHitAt = ctx.time;
    bot.suppression = clamp01(bot.suppression + 0.4);

    // Being shot at makes a bot react even if it had not seen the
    // shooter - otherwise flanking is free and firefights never move.
    if (options.source && options.source.position) {
      bot.lastKnown.copy(options.source.position);
      bot.hasLastKnown = true;
      if (!bot.target) {
        bot.target = options.source.isPlayer || options.source === ctx.player
          ? { isPlayer: true, position: ctx.player.position, ref: ctx.player }
          : { isPlayer: false, position: options.source.position, ref: options.source };
        bot.reactionTimer = lerp(1.0, 0.30, bot.skill);
      }
      shareContact(bot.squad, bot.target, bot.lastKnown, ctx.time);
    }

    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.deaths += 1;
      bot.state = STATE.DEAD;
      bot.respawnTimer = rng.range(6, 12);
      bot.firing = 0;
      releaseCover(bot);
      if (bot.vehicle) dismount(bot);
      ctx.bus.emit("bot:death", { bot, headshot: options.headshot, source: options.source });
      ctx.audio?.playAt?.("death", bot.position, { volume: 0.5 });
      return true;
    }
    return false;
  }

  /* ================================================================
     vehicles
     ================================================================ */

  function tryMount(bot) {
    const vehicles = ctx.vehicles;
    if (!vehicles || !bot.objective) return false;
    const toObjective = bot.position.distanceTo(bot.objective.position);
    if (toObjective < 140) return false;

    let best = null;
    let bestDistance = 45;
    for (const vehicle of vehicles.vehicles) {
      if (!vehicle.alive || vehicle.spec.aircraft) continue;
      if (vehicle.occupants.length >= vehicle.spec.seats) continue;
      // Do not steal a ride that is going the other way.
      if (vehicle.team && vehicle.team !== bot.team && vehicle.occupants.length) continue;
      const distance = vehicle.position.distanceTo(bot.position);
      if (distance < bestDistance) { bestDistance = distance; best = vehicle; }
    }
    if (!best) return false;

    if (bestDistance < 3.4) {
      if (vehicles.enter(best, bot)) {
        bot.vehicle = best;
        bot.state = STATE.DRIVE;
        bot.vehicleTimer = 40;
        releaseCover(bot);
        return true;
      }
      return false;
    }
    bot.state = STATE.MOUNT;
    bot.pathTarget.copy(best.position);
    return true;
  }

  function dismount(bot) {
    const vehicle = bot.vehicle;
    if (!vehicle) return;
    ctx.vehicles?.exit?.(vehicle, bot);
    bot.vehicle = null;
    // Step out to the side, not into the wheels.
    const side = new THREE.Vector3(1.6, 0, 0).applyQuaternion(vehicle.quaternion);
    bot.position.copy(vehicle.position).add(side);
    bot.position.y = terrain.heightAt(bot.position.x, bot.position.z);
    bot.velocity.set(0, 0, 0);
    bot.state = STATE.ADVANCE;
  }

  function driveVehicle(bot, dt) {
    const vehicle = bot.vehicle;
    if (!vehicle || !vehicle.alive) { bot.vehicle = null; bot.state = STATE.ADVANCE; return; }

    // Passengers just ride.
    bot.position.copy(vehicle.position);
    bot.position.y = vehicle.position.y - 0.4;
    bot.velocity.copy(vehicle.velocity);
    bot.speed = 0;
    bot.root.visible = false;

    bot.vehicleTimer -= dt;
    const goal = bot.objective ? bot.objective.position : bot.pathTarget;
    const distance = vehicle.position.distanceTo(goal);
    if (distance < 38 || bot.vehicleTimer <= 0 || bot.target) {
      bot.root.visible = true;
      dismount(bot);
      return;
    }

    if (vehicle.driver !== bot) return;

    // Steer toward the objective. The vehicle module only overwrites
    // these for the local player, so a bot driver's inputs persist.
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(vehicle.quaternion);
    const to = _tmp.copy(goal).sub(vehicle.position).setY(0).normalize();
    const cross = forward.x * to.z - forward.z * to.x;
    const dot = forward.x * to.x + forward.z * to.z;
    vehicle.steer = clamp(-cross * 2.4, -1, 1);
    vehicle.throttle = dot > 0.2 ? -1 : -0.35;
    vehicle.brake = 0;
  }

  /* ================================================================
     think - the AI proper, run at THINK_HZ per bot
     ================================================================ */

  function think(bot, now) {
    const dt = 1 / THINK_HZ;

    /* ---- perception ---- */
    let visible = null;
    if (bot.target) {
      const stillThere = bot.target.isPlayer
        ? ctx.player.state.alive : bot.target.ref.alive;
      if (stillThere && hasLineOfSight(bot, bot.target)) {
        // Still on the same contact: one ray, not a rescan.
        const distance = bot.position.distanceTo(bot.target.position);
        if (distance < VIEW_RANGE) {
          visible = bot.target;
          shareContact(bot.squad, bot.target, bot.target.position, now);
        }
      }
    }
    if (!visible) {
      const found = perceive(bot, now);
      if (found) {
        if (bot.target !== found) {
          bot.targetSeenFor = 0;
          bot.reactionTimer = bot.cfg.reaction * rng.range(0.7, 1.5);
        }
        bot.target = found;
        visible = found;
      }
    }

    if (visible) {
      bot.targetSeenFor += dt;
      bot.targetLostFor = 0;
      bot.lastKnown.copy(visible.position);
      bot.hasLastKnown = true;
    } else {
      bot.targetLostFor += dt;
      if (bot.targetLostFor > 5) {
        bot.target = null;
        bot.targetSeenFor = 0;
      }
    }

    /* ---- reload, wounds, grenades ---- */
    if (bot.ammo <= 0 && bot.reloadTimer <= 0) bot.reloadTimer = RELOAD_TIME;
    // Reload behind cover if there is any to be had. Reloading in the
    // open with a target on you is what separates a bot from a soldier.
    if (bot.ammo < 8 && !visible && bot.reloadTimer <= 0 && rng.chance(0.5)) {
      bot.reloadTimer = RELOAD_TIME;
    }

    if (bot.health < 100 && now - bot.lastHitAt > 6) {
      bot.health = Math.min(100, bot.health + 6);
    }

    bot.grenadeTimer -= dt;
    if (bot.grenadeTimer <= 0 && bot.grenadesLeft > 0 && bot.hasLastKnown
      && bot.reloadTimer <= 0) {
      const distance = bot.position.distanceTo(bot.lastKnown);
      // Grenades are for a target that is dug in or that has just
      // broken line of sight, not for one standing in the open.
      const worth = (!visible && bot.targetLostFor < 4) || (visible && distance < 22);
      if (worth && distance > 9 && distance < 32 && rng.chance(0.5 + bot.aggression * 0.4)) {
        throwGrenade(bot, bot.lastKnown);
      } else {
        bot.grenadeTimer = rng.range(3, 8);
      }
    }

    /* ---- state ---- */
    const wounded = bot.health < bot.cfg.retreatAt;
    const outnumbered = countThreatsNear(bot, 45) >= 2 && bot.aggression < 0.6;

    if (bot.vehicle) {
      bot.state = STATE.DRIVE;
    } else if (wounded && (visible || bot.targetLostFor < 3)) {
      bot.state = STATE.RETREAT;
    } else if (visible) {
      bot.state = pickCombatState(bot, visible, outnumbered);
    } else if (bot.hasLastKnown && bot.targetLostFor < 6) {
      bot.state = STATE.SUPPRESS;
    } else {
      const shared = bestSharedContact(bot, now);
      if (shared && bot.position.distanceTo(shared.position) < 120) {
        // Squad-mate has eyes on: move onto the contact without ever
        // having seen it. This is what makes a fireteam feel like one.
        bot.lastKnown.copy(shared.position);
        bot.hasLastKnown = true;
        bot.state = STATE.ADVANCE;
        bot.pathTarget.copy(shared.position);
        bot.repathTimer = Math.min(bot.repathTimer, 3);
      } else {
        if (bot.state !== STATE.MOUNT) bot.state = STATE.ADVANCE;
        bot.hasLastKnown = false;
        releaseCover(bot);
      }
    }

    /* ---- cover ---- */
    if (bot.state === STATE.ENGAGE || bot.state === STATE.SUPPRESS
      || bot.state === STATE.RETREAT) {
      bot.coverTimer -= dt;
      const threat = visible ? visible.position : bot.lastKnown;
      const needCover = !bot.cover
        || bot.position.distanceTo(_tmp.set(bot.cover.x, bot.cover.y, bot.cover.z)) > 34
        || bot.coverTimer <= 0;
      if (needCover && rng() < bot.cfg.coverUse) {
        releaseCover(bot);
        const found = findCover(bot, threat, bot.state === STATE.RETREAT ? 40 : 30);
        if (found) {
          found.claimed = bot;
          bot.cover = found;
          bot.coverTimer = rng.range(5, 13);
        } else {
          bot.coverTimer = rng.range(1.5, 3.5);
        }
      }
    } else {
      releaseCover(bot);
    }

    /* ---- movement intent ---- */
    planMovement(bot, visible, now);

    /* ---- separation, recomputed here rather than every step ---- */
    bot.separation.set(0, 0, 0);
    for (const other of bots) {
      if (other === bot || !other.alive || other.team !== bot.team || other.vehicle) continue;
      const dx = bot.position.x - other.position.x;
      const dz = bot.position.z - other.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > 12 || distSq < 1e-4) continue;
      const distance = Math.sqrt(distSq);
      bot.separation.x += (dx / distance) * (1 - distance / 3.5);
      bot.separation.z += (dz / distance) * (1 - distance / 3.5);
    }

    bot.suppression = Math.max(0, bot.suppression - dt * 0.55);
  }

  function countThreatsNear(bot, radius) {
    let n = 0;
    const r2 = radius * radius;
    for (const record of bot.squad.contacts.values()) {
      if (ctx.time - record.time > 4) continue;
      if (record.position.distanceToSquared(bot.position) < r2) n += 1;
    }
    return n;
  }

  /**
   * Which way to fight.
   *
   * A fireteam that all does the same thing is four targets in a row.
   * One member is nominated to swing wide while the others hold the
   * enemy's attention, and who that is rotates as people die.
   */
  function pickCombatState(bot, visible, outnumbered) {
    const squad = bot.squad;
    const distance = bot.position.distanceTo(visible.position);

    if (outnumbered && bot.aggression < 0.35) return STATE.COVER;

    if (!squad.flanker || !squad.flanker.alive || squad.flanker.state !== STATE.FLANK) {
      // The most aggressive member with a target is the one who moves.
      let candidate = null;
      for (const member of squad.members) {
        if (!member.alive || member.vehicle) continue;
        if (!candidate || member.aggression > candidate.aggression) candidate = member;
      }
      squad.flanker = candidate;
    }
    if (squad.flanker === bot && distance > 18 && distance < 110
      && squad.members.filter((m) => m.alive).length > 1) {
      return STATE.FLANK;
    }
    return STATE.ENGAGE;
  }

  function planMovement(bot, visible, now) {
    const wish = bot.wish;
    wish.set(0, 0, 0);
    const to = _tmp;

    switch (bot.state) {
      case STATE.ENGAGE:
      case STATE.COVER: {
        if (bot.cover) {
          to.set(bot.cover.x, 0, bot.cover.z).sub(bot.position).setY(0);
          if (to.lengthSq() > 1.6) wish.copy(to).normalize();
        } else if (visible) {
          const distance = bot.position.distanceTo(visible.position);
          const ideal = lerp(24, 62, bot.skill);
          if (distance > ideal * 1.35) {
            wish.copy(visible.position).sub(bot.position).setY(0).normalize();
          } else if (distance < ideal * 0.5) {
            wish.copy(bot.position).sub(visible.position).setY(0).normalize();
          } else {
            // Strafe, so a firefight is not two statues shooting.
            const strafe = Math.sin(now * 0.55 + bot.thinkPhase * 40) > 0 ? 1 : -1;
            wish.set(Math.cos(bot.yaw) * strafe, 0, -Math.sin(bot.yaw) * strafe)
              .multiplyScalar(0.6);
          }
        }
        break;
      }

      case STATE.FLANK: {
        // Swing wide of the contact axis, then close. Recomputed only
        // when the detour is used up so the bot commits to the move.
        if (!bot.detour || bot.detourTimer <= 0) {
          const axis = _tmp.copy(bot.lastKnown).sub(bot.position).setY(0);
          const length = axis.length() || 1;
          axis.multiplyScalar(1 / length);
          const side = rng.chance(0.5) ? 1 : -1;
          const wide = new THREE.Vector3(-axis.z * side, 0, axis.x * side)
            .multiplyScalar(lerp(18, 38, bot.skill));
          bot.detour = bot.position.clone()
            .addScaledVector(axis, length * 0.55).add(wide);
          bot.detour.y = terrain.heightAt(bot.detour.x, bot.detour.z);
          bot.detourTimer = 9;
        }
        to.copy(bot.detour).sub(bot.position).setY(0);
        if (to.lengthSq() > 4) wish.copy(to).normalize();
        else bot.detourTimer = 0;
        break;
      }

      case STATE.SUPPRESS: {
        if (bot.cover) {
          to.set(bot.cover.x, 0, bot.cover.z).sub(bot.position).setY(0);
          if (to.lengthSq() > 1.6) wish.copy(to).normalize();
        } else if (bot.hasLastKnown) {
          to.copy(bot.lastKnown).sub(bot.position).setY(0);
          // Close on the last known position, but carefully.
          if (to.length() > 12) wish.copy(to).normalize().multiplyScalar(0.7);
        }
        break;
      }

      case STATE.RETREAT: {
        if (bot.cover) {
          to.set(bot.cover.x, 0, bot.cover.z).sub(bot.position).setY(0);
          if (to.lengthSq() > 1.0) wish.copy(to).normalize();
        } else {
          to.copy(bot.position).sub(bot.lastKnown).setY(0);
          if (to.lengthSq() > 1e-4) wish.copy(to).normalize();
        }
        break;
      }

      case STATE.MOUNT: {
        to.copy(bot.pathTarget).sub(bot.position).setY(0);
        if (to.lengthSq() > 1e-4) wish.copy(to).normalize();
        if (to.length() < 3.4) tryMount(bot);
        break;
      }

      default: {
        bot.repathTimer -= 1 / THINK_HZ;
        const arrived = bot.position.distanceTo(bot.pathTarget) < 5;
        if (bot.repathTimer <= 0 || arrived) pickObjective(bot);
        if (bot.objective && !bot.vehicle && rng.chance(0.05)) tryMount(bot);
        to.copy(bot.pathTarget).sub(bot.position).setY(0);
        if (to.lengthSq() > 1e-4) wish.copy(to).normalize();
        break;
      }
    }

    /* ---- stance ---- */
    if (bot.state === STATE.ENGAGE || bot.state === STATE.SUPPRESS
      || bot.state === STATE.COVER) {
      const stationary = wish.lengthSq() < 0.05;
      if (stationary && bot.cover) {
        // Behind low cover, get behind it properly.
        bot.wantStance = bot.cover.value < 0.72 ? "crouch" : "stand";
      } else if (stationary && bot.skill > 0.7 && bot.suppression > 0.4) {
        bot.wantStance = "prone";
      } else {
        bot.wantStance = stationary ? "crouch" : "stand";
      }
    } else if (bot.state === STATE.RETREAT || bot.state === STATE.FLANK) {
      bot.wantStance = "stand";
    } else {
      bot.wantStance = "stand";
    }
  }

  /* ================================================================
     per-step simulation
     ================================================================ */

  const _wish = new THREE.Vector3();
  const _fwd = new THREE.Vector3();

  function stepBot(bot, dt) {
    if (!bot.alive) {
      bot.respawnTimer -= dt;
      if (bot.respawnTimer <= 0) respawn(bot);
      return;
    }

    if (bot.vehicle) {
      driveVehicle(bot, dt);
      return;
    }
    if (!bot.root.visible) bot.root.visible = true;

    bot.reloadTimer = Math.max(0, bot.reloadTimer - dt);
    if (bot.reloadTimer > 0 && bot.reloadTimer <= dt) bot.ammo = MAG_SIZE;
    bot.detourTimer = Math.max(0, bot.detourTimer - dt);
    bot.firing = Math.max(0, bot.firing - dt * 7);

    /* ---- aim and fire ---- */
    const target = bot.target;
    const engaging = target && (bot.state === STATE.ENGAGE || bot.state === STATE.FLANK
      || bot.state === STATE.COVER || bot.state === STATE.RETREAT);
    const alive = target && (target.isPlayer ? ctx.player.state.alive : target.ref.alive);

    if (engaging && alive) {
      // Peeking: a soldier in cover is not standing in the open with
      // his head out permanently. He exposes himself in bursts.
      bot.peekTimer -= dt;
      if (bot.peekTimer <= 0) {
        bot.peeking = bot.peeking > 0.5 ? 0 : 1;
        bot.peekTimer = bot.peeking
          ? lerp(0.8, 2.4, bot.aggression) : lerp(1.6, 0.5, bot.aggression);
      }
      const exposed = !bot.cover || bot.peeking > 0.5;
      bot.lean = damp(bot.lean, bot.cover ? (bot.peeking ? 0.8 : -0.2) : 0, 6, dt);
      if (exposed && bot.reloadTimer <= 0) {
        shoot(bot, target, dt);
      } else {
        aimAt(bot, target, dt);
      }
    } else if (bot.state === STATE.SUPPRESS && bot.hasLastKnown) {
      // Fire on the last known position. Inaccurate by construction:
      // the point is the noise, not the hit.
      const ghost = { isPlayer: false, position: bot.lastKnown, ref: { stance: "stand", velocity: _fwd.set(0, 0, 0), alive: true } };
      aimAt(bot, ghost, dt);
      if (rng.chance(dt * 0.55) && bot.reloadTimer <= 0 && bot.ammo > 0) {
        bot.targetSeenFor = 0;
        shoot(bot, ghost, dt);
      }
      bot.lean = damp(bot.lean, 0, 5, dt);
    } else {
      bot.lean = damp(bot.lean, 0, 5, dt);
    }

    /* ---- facing ---- */
    if (engaging && alive) {
      bot.yaw = dampAngle(bot.yaw, bot.aimYaw, bot.cfg.turnRate * 0.7, dt);
      bot.pitch = bot.aimPitch;
    } else {
      const heading = bot.wish.lengthSq() > 0.01
        ? Math.atan2(-bot.wish.x, -bot.wish.z)
        : (bot.hasLastKnown
          ? Math.atan2(bot.position.x - bot.lastKnown.x, bot.position.z - bot.lastKnown.z) + Math.PI
          : bot.yaw);
      bot.yaw = dampAngle(bot.yaw, heading, 4.5, dt);
      bot.aimYaw = dampAngle(bot.aimYaw, bot.yaw, 4.0, dt);
      bot.aimPitch = damp(bot.aimPitch, 0, 3, dt);
      bot.pitch = bot.aimPitch;
    }

    /* ---- stance transition ---- */
    if (bot.stance !== bot.wantStance) {
      bot.stanceTimer = (bot.stanceTimer || 0) - dt;
      if (bot.stanceTimer <= 0) {
        bot.stance = bot.wantStance;
        bot.stanceTimer = 0.45;
      }
    }

    /* ---- movement ---- */
    _wish.copy(bot.wish).addScaledVector(bot.separation, 1.1);
    if (bot.detour && bot.detourTimer > 0 && bot.state === STATE.FLANK) {
      // already folded into wish
    }
    if (_wish.lengthSq() > 1) _wish.normalize();

    let maxSpeed = 5.0;
    if (bot.state === STATE.ENGAGE || bot.state === STATE.COVER) maxSpeed = 3.3;
    else if (bot.state === STATE.SUPPRESS) maxSpeed = 3.0;
    else if (bot.state === STATE.RETREAT || bot.state === STATE.FLANK) maxSpeed = 5.6;
    if (bot.stance === "crouch") maxSpeed = Math.min(maxSpeed, 1.9);
    else if (bot.stance === "prone") maxSpeed = Math.min(maxSpeed, 0.9);
    // A bot with nothing in front of it should sprint, and sprinting is
    // what stops a 1024m map feeling empty between the flags.
    const sprinting = bot.state === STATE.ADVANCE && !bot.target
      && bot.position.distanceTo(bot.pathTarget) > 18;
    if (sprinting) maxSpeed = 6.9;
    bot.sprint = damp(bot.sprint, sprinting ? 1 : 0, 5, dt);

    bot.velocity.x = damp(bot.velocity.x, _wish.x * maxSpeed, 9, dt);
    bot.velocity.z = damp(bot.velocity.z, _wish.z * maxSpeed, 9, dt);
    bot.velocity.y -= 22 * dt;

    if (bot.vaultTimer > 0) {
      // Riding a vault: driven forward and up, physics off for the arc.
      bot.vaultTimer -= dt;
      bot.vaultProgress = clamp01(1 - bot.vaultTimer / 0.55);
      bot.position.lerp(bot.vaultTo, clamp01(dt * 9));
      if (bot.vaultTimer <= 0) {
        bot.position.copy(bot.vaultTo);
        bot.velocity.set(0, 0, 0);
        bot.vaultProgress = 0;
      }
      bot.speed = 4.0;
    } else {
      const result = physics.moveCapsule(bot.position, bot.velocity, 0.34, 1.8, dt, {
        layer: LAYER.STATIC | LAYER.DYNAMIC | LAYER.VEHICLE,
        stepHeight: 0.42,
      });

      if (result.hitWall) {
        // Try to go over it before deciding to go around it. Using the
        // player's own mantle probe means a bot can traverse exactly
        // what a player can, which is what stops them looking like they
        // are pathing around invisible walls.
        let vaulted = false;
        if (physics.mantleProbe && bot.vaultCooldown <= 0) {
          _fwd.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
          const spot = physics.mantleProbe(bot.position, _fwd, {
            radius: 0.34, height: 1.8, maxHeight: 1.6, minHeight: 0.4, reach: 1.4,
            layer: LAYER.STATIC | LAYER.VEHICLE,
          });
          if (spot && spot.position) {
            bot.vaultTo = spot.position.clone();
            bot.vaultTimer = 0.55;
            bot.vaultCooldown = 1.6;
            vaulted = true;
          }
        }
        if (!vaulted) {
          bot.vaultCooldown = Math.max(bot.vaultCooldown || 0, 0.4);
          // Slide along the wall rather than grinding into it, and
          // re-path soon.
          if (bot.state === STATE.ADVANCE || bot.state === STATE.MOUNT) {
            bot.repathTimer = Math.min(bot.repathTimer, 0.5);
          }
        }
      }
      bot.speed = Math.hypot(bot.velocity.x, bot.velocity.z);
    }
    bot.vaultCooldown = Math.max(0, (bot.vaultCooldown || 0) - dt);

    // Direction of travel in the body's frame - the input the animation
    // needs to tell a strafe from a walk.
    if (bot.speed > 0.15) {
      const travel = Math.atan2(-bot.velocity.x, -bot.velocity.z);
      bot.moveAngle = Math.atan2(
        Math.sin(travel - bot.yaw), Math.cos(travel - bot.yaw)
      );
    } else {
      bot.moveAngle = damp(bot.moveAngle, 0, 6, dt);
    }

    world.reportPresence(bot.team, bot.position);
  }

  /* ================================================================
     update
     ================================================================ */

  let thinkCursor = 0;
  let squadCursor = 0;
  let squadTimer = 0;

  function fixedUpdate(dt) {
    const now = ctx.time;

    /* ---- squad orders: one squad per pass, ~2Hz each ---- */
    squadTimer -= dt;
    if (squadTimer <= 0 && squads.length) {
      squadTimer = 0.5 / squads.length;
      const squad = squads[squadCursor % squads.length];
      squadCursor += 1;
      squad.orderTimer -= 0.5;
      pruneContacts(squad, now);
      if (squad.orderTimer <= 0) {
        squad.orderTimer = rng.range(6, 14);
        chooseSquadObjective(squad);
      }
    }

    /* ---- think slice ----
       Every bot thinks THINK_HZ times a second, spread evenly across
       steps. Deriving the slice size from the population means the
       cost per step is flat whether there are twelve bots or forty. */
    if (bots.length) {
      const perStep = Math.max(1, Math.ceil((bots.length * THINK_HZ) / 120));
      const t0 = performance.now();
      for (let i = 0; i < perStep; i += 1) {
        const bot = bots[thinkCursor % bots.length];
        thinkCursor += 1;
        if (bot.alive) { think(bot, now); thinkCalls += 1; }
      }
      thinkMs += performance.now() - t0;
    }

    for (const bot of bots) stepBot(bot, dt);
    updateGrenades(dt);
  }

  /** Posing is per frame, not per step. A soldier animated at 120Hz
   *  looks identical to one animated at the display rate and costs
   *  twice as much; the simulation still runs at 120. */
  function update(dt) {
    for (const bot of bots) {
      if (bot.vehicle) { bot.root.visible = false; continue; }
      bot.root.position.copy(bot.position);
      bot.root.rotation.y = bot.yaw;
      if (!bot.alive) {
        characters.pose(bot.character, { dead: true }, dt);
        continue;
      }
      characters.pose(bot.character, {
        // The capsule's own resting height, so foot IK plants on a
        // rooftop or a stair tread instead of reaching for the terrain
        // that is six metres below it.
        groundY: bot.position.y,
        speed: bot.speed,
        moveAngle: bot.moveAngle,
        aimPitch: bot.aimPitch,
        aimYaw: Math.atan2(
          Math.sin(bot.aimYaw - bot.yaw), Math.cos(bot.aimYaw - bot.yaw)
        ),
        stance: bot.stance,
        sprint: bot.sprint,
        firing: bot.firing,
        reload: bot.reloadTimer > 0 ? 1 - bot.reloadTimer / RELOAD_TIME : 0,
        vault: bot.vaultProgress,
        lean: bot.lean,
        // The head goes to whatever the soldier is actually aware of,
        // which is not always what the weapon is pointing at.
        lookYaw: bot.hasLastKnown && !bot.target
          ? clamp(Math.atan2(
            Math.sin(Math.atan2(-(bot.lastKnown.x - bot.position.x),
              -(bot.lastKnown.z - bot.position.z)) - bot.yaw),
            Math.cos(Math.atan2(-(bot.lastKnown.x - bot.position.x),
              -(bot.lastKnown.z - bot.position.z)) - bot.yaw)
          ), -1.1, 1.1)
          : undefined,
      }, dt);
    }
  }

  /* ================================================================
     api
     ================================================================ */

  let reportedAt = ctx.time;

  return {
    STATE,
    bots,
    squads,
    fixedUpdate,
    update,

    raycast(origin, direction, maxDist) {
      const team = ctx.player ? ctx.player.state.team : TEAM.BLUE;
      return raycastCharacters(origin, direction, maxDist, team);
    },

    applyDamage,

    positionsFor(team) {
      const out = [];
      for (const bot of bots) if (bot.team === team && bot.alive) out.push(bot.position);
      return out;
    },

    countFor(team) {
      let n = 0;
      for (const bot of bots) if (bot.team === team && bot.alive) n += 1;
      return n;
    },

    /** Cover points, for a debug overlay. */
    coverPoints() {
      const out = [];
      for (const cell of coverGrid.values()) out.push(...cell);
      return out;
    },

    report() {
      const elapsed = Math.max(0.001, ctx.time - reportedAt);
      const counts = {};
      for (const key of Object.values(STATE)) counts[key] = 0;
      let alive = 0; let blue = 0; let red = 0; let inCover = 0; let mounted = 0;
      for (const bot of bots) {
        counts[bot.state] = (counts[bot.state] || 0) + 1;
        if (!bot.alive) continue;
        alive += 1;
        if (bot.team === TEAM.BLUE) blue += 1; else red += 1;
        if (bot.cover) inCover += 1;
        if (bot.vehicle) mounted += 1;
      }
      const out = {
        total: bots.length,
        alive, blue, red,
        squads: squads.length,
        engaging: counts[STATE.ENGAGE] || 0,
        states: counts,
        inCover,
        mounted,
        grenadesInFlight: grenades.length,
        coverPoints: coverCount,
        /** Perception cost. thinkMs is wall time inside think(), which
         *  is where every line-of-sight ray and every cover search
         *  lives; everything else in the bot loop is arithmetic. */
        perception: {
          thinkHz: THINK_HZ,
          thinksPerSecond: Number((thinkCalls / elapsed).toFixed(1)),
          losRaysPerSecond: Number((losRays / elapsed).toFixed(1)),
          thinkMsPerSecond: Number((thinkMs / elapsed).toFixed(3)),
          thinkMsPerCall: Number((thinkMs / Math.max(1, thinkCalls)).toFixed(4)),
        },
      };
      losRays = 0; thinkMs = 0; thinkCalls = 0; reportedAt = ctx.time;
      return out;
    },

    dispose() {
      for (const bot of bots) characters.remove(bot.character);
      render.scene.remove(grenadeMesh);
      grenadeMesh.geometry.dispose();
      grenadeMesh.material.dispose();
      bots.length = 0;
      squads.length = 0;
    },
  };
}
