/* ============================================================
   BLACKSAND - netcode

   Online play rides on RBNet (Supabase Realtime broadcast), the same
   transport the rest of the site uses. There is no dedicated server,
   so the model is host-authoritative: whoever created the room owns
   the match state, everyone else predicts locally and reconciles.

   The five things this file has to get right, and why each is shaped
   the way it is:

   1. THERE IS NO SHARED CLOCK. Two browsers' `performance.now()` have
      unrelated origins and drift against each other by milliseconds a
      minute. Every timestamp on the wire is in *net time*, an NTP-style
      estimate of the host's clock built from round-trip samples that
      ride along inside the normal tick messages. Interpolation,
      rewind and rate-of-fire checks are all meaningless without it.

   2. MOVEMENT IS A SNAPSHOT STREAM, NOT AN INPUT STREAM. Input
      replication needs a deterministic simulation and a rollback
      buffer; over a broadcast relay with 60-120ms of jitter, snapshot
      interpolation with local prediction is both simpler and more
      forgiving. Remote players are drawn in the past by an adaptive
      delay derived from that peer's own measured jitter, and a brief
      dropout is bridged by *decaying* extrapolation - a linear
      extrapolation that keeps its velocity is exactly what makes a
      player who stopped walking slide past the corner and snap back.

   3. SHOTS RESOLVE ON THE SHOOTER, THE HOST VALIDATES WITH REWIND.
      The shooter hits what is on their screen, which is where the
      target was `interpDelay` ago. The host therefore rewinds every
      candidate victim to the shooter's *view time* before testing the
      hit, using the same packets the shooter had. Without this, a
      120ms ping means leading a running target by a body width and
      the game feels broken. What the host does not do is trust the
      client: it re-derives the damage number, re-runs the wall test,
      re-checks that the shooter was where it claims, and meters the
      rate of fire with a token bucket.

   4. A BROADCAST RELAY IS NOT A GAME SERVER. Every message is fanned
      out to all sixteen peers, so the interesting budget is *inbound*:
      fifteen senders times whatever each of them sends. Two facts
      drive the whole encoding:
        - the Supabase/Phoenix envelope is ~150 bytes, far larger than
          a snapshot payload, so message *count* dominates byte count.
          Nothing gets its own message: shots, pings, damage awards and
          match state all ride inside the sender's next tick.
        - directed sends are not cheaper. RBNet's `sendTo` still
          broadcasts and filters on arrival, so per-receiver relevance
          culling would cost N messages instead of one. Relevance is
          therefore applied to the sender's *rate*: the rate demanded
          by the closest peer who can see you, and 2Hz when nobody can.

   5. THE MATCH MUST SURVIVE THE HOST CLOSING A TAB. Control points,
      tickets, the round clock and the scoreboard are host-owned and
      replicated; on migration the new host adopts the last replica it
      received and keeps its own net time as the continuing timebase,
      so nobody's interpolation buffer jumps.

   The world itself is never transmitted. A 1024m heightfield plus 40
   buildings is megabytes; the seed that generates them is four bytes.
   ============================================================ */

import { clamp, clamp01, lerp, damp, angleDelta, makeRng } from "./core.js";
import { LAYER } from "./physics.js";
import { TEAM } from "./world.js";

/* ------------------------------ tuning ------------------------------ */

const PROTOCOL = 4;

/** Snapshot rates, by how relevant the sender currently is to the peer
 *  that cares most. A 1024m map means most of the lobby is irrelevant
 *  to most of the lobby most of the time, and that is where the
 *  bandwidth budget is won. */
const RATE = {
  NEAR: 20,     // someone within 60m
  MID: 12,      // 60-140m
  FAR: 6,       // 140-260m, or further but with line of sight
  IDLE: 2,      // nobody can see you and nobody is close
};
const RATE_HYSTERESIS = 0.35; // seconds a rate must hold before dropping

/** A full state every second. Deltas are coded against the last
 *  keyframe rather than the previous packet: a packet lost between
 *  them then costs one frame of that peer's motion instead of
 *  desynchronising the stream until the next keyframe. */
const KEYFRAME_INTERVAL = 1.0;
const KEYFRAME_MAX_PACKETS = 24;

/** Interpolation delay bounds. The floor is two snapshot intervals at
 *  20Hz; the ceiling is what a 300ms-RTT peer needs before every
 *  corner turn becomes a teleport. */
const INTERP_MIN = 0.10;
const INTERP_MAX = 0.40;

/** How far past the newest snapshot we will invent motion. 250ms is
 *  about five dropped packets; past that a peer freezes, which reads
 *  as "their connection died" rather than as a lie. */
const EXTRAP_MAX = 0.25;

/** Seconds of positional history kept for rewind. Longer than the
 *  worst rewind we will honour, so the buffer is never the limit. */
const HISTORY_SPAN = 1.6;
const MAX_REWIND = 0.60;

/** Envelope estimate per relayed message: Phoenix frame + topic +
 *  event + RBNet's {t,f,d} wrapper, measured against the real thing.
 *  It is bigger than most payloads, which is the single most important
 *  fact about this transport. */
const ENVELOPE_BYTES = 148;

const PING_INTERVAL = 1.0;
const MATCH_INTERVAL = 0.5;
const SCORE_EVERY = 4;        // score table on every 4th match message
const PEER_TIMEOUT = 6.0;
const RECONNECT_DELAYS = [1.2, 2.5, 5.0, 9.0];

/* --------------------------- quantisation --------------------------- */

const POS_SCALE = 50;                          // 2 cm
const YAW_STEPS = 4096;
const YAW_SCALE = YAW_STEPS / (Math.PI * 2);   // 0.088 degrees
const PITCH_SCALE = 127 / (Math.PI * 0.5);     // 0.7 degrees, invisible on a spine bend
const SPEED_SCALE = 16;
const DIR_SCALE = 2000;                        // 0.03 degrees on a shot ray

/** Wire field order. Position is delta-coded against the keyframe
 *  baseline; everything else is small enough that absolute is shorter
 *  than a sign plus a delta. */
const FIELDS = ["qx", "qy", "qz", "qyaw", "qpitch", "qspeed", "flags", "health"];
const DELTA_FIELD = { qx: 1, qy: 1, qz: 1 };
const MASK_KEYFRAME = 1 << 8;
const MASK_EPOCH_SHIFT = 9;

const STANCE_BY_CODE = ["stand", "crouch", "prone"];
const STATE_BY_CODE = ["warmup", "playing", "ended"];

/* ---------------------------- URL options ---------------------------- */

function netOptions() {
  let params;
  try {
    params = new URLSearchParams(window.location.search);
  } catch (_) {
    params = new URLSearchParams("");
  }
  const num = (key, fallback) => {
    const raw = params.get(key);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    /** "rbnet" (default), "loop" (dev-only in-browser relay), "off". */
    transport: String(params.get("bsnet") || "rbnet").toLowerCase(),
    room: params.get("bsroom") || null,
    ghosts: Math.max(0, Math.min(30, num("bsghosts", 0))),
    /** Loopback link simulation, in ms / fraction. */
    latency: num("bslat", 0),
    jitter: num("bsjit", 0),
    loss: clamp01(num("bsloss", 0)),
    name: params.get("bsname") || null,
  };
}

/* ============================================================
   LOOPBACK TRANSPORT (development only)

   Selected by ?bsnet=loop and never reachable otherwise. A
   BroadcastChannel is a genuine multi-tab fan-out relay with the same
   shape as the real one - one send, N deliveries, no server authority
   - which makes it the right harness for the replication path. It
   also lets the probe dial in latency, jitter and loss exactly, which
   no amount of poking at a real Supabase project will give you.
   ============================================================ */

function createLoopLink({ code, name, meta, sim, onLog }) {
  if (typeof BroadcastChannel === "undefined") {
    throw new Error("Loopback transport needs BroadcastChannel.");
  }
  const id = `L${Math.random().toString(36).slice(2, 10)}`;
  const channel = new BroadcastChannel(`bs-loop:${code}`);
  const rng = makeRng((Date.now() ^ (Math.random() * 1e9)) >>> 0);

  const handlers = new Map();
  const roster = new Map();
  const me = { ...meta, id, name, joinedAt: Date.now() };
  roster.set(id, { player: me, at: Date.now() });

  let closed = false;
  let hostId = id;
  let rosterDirty = true;

  function emit(type, data, from) {
    const set = handlers.get(type);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try { fn(data, from); } catch (error) { console.warn("[blacksand/net] loop handler", type, error); }
    }
  }

  function sortPlayers() {
    return Array.from(roster.values())
      .map((entry) => entry.player)
      .sort((a, b) => (a.joinedAt - b.joinedAt) || (a.id < b.id ? -1 : 1));
  }

  function syncRoster() {
    const now = Date.now();
    let changed = false;
    for (const [key, entry] of Array.from(roster.entries())) {
      // Same 1.5s liveness window RBNet's presence effectively gives us.
      if (key !== id && now - entry.at > 1500) {
        roster.delete(key);
        changed = true;
        emit("peerleave", key);
      }
    }
    const players = sortPlayers();
    const nextHost = players.length ? players[0].id : id;
    if (nextHost !== hostId) {
      hostId = nextHost;
      changed = true;
      emit("host", hostId);
    }
    if (changed || rosterDirty) {
      rosterDirty = false;
      emit("players", players);
    }
  }

  function deliver(message) {
    if (closed) return;
    if (message.k === "pres") {
      const known = roster.get(message.p.id);
      roster.set(message.p.id, { player: message.p, at: Date.now() });
      if (!known) rosterDirty = true;
      syncRoster();
      return;
    }
    if (message.k === "bye") {
      if (roster.delete(message.f)) {
        emit("peerleave", message.f);
        rosterDirty = true;
        syncRoster();
      }
      return;
    }
    if (message.k === "msg") {
      if (message.f === id) return;
      emit(message.t, message.d, message.f);
    }
  }

  channel.onmessage = (event) => {
    const message = event.data;
    if (!message) return;
    // Loss and jitter are applied on arrival: half the round trip each
    // way, and no ordering guarantee, so reordering gets exercised.
    if (message.k === "msg" && sim.loss > 0 && rng() < sim.loss) {
      if (onLog) onLog("drop");
      return;
    }
    const jitter = sim.jitter > 0 ? rng.gauss() * sim.jitter : 0;
    const delayMs = Math.max(0, sim.latency * 0.5 + jitter);
    if (delayMs < 0.5) deliver(message);
    else setTimeout(() => deliver(message), delayMs);
  };

  const heartbeat = setInterval(() => {
    if (closed) return;
    channel.postMessage({ k: "pres", p: me });
    syncRoster();
  }, 250);
  channel.postMessage({ k: "pres", p: me });

  return {
    kind: "loop",
    id,
    code,
    get me() { return me; },
    get players() { return sortPlayers(); },
    get hostId() { return hostId; },
    get isHost() { return hostId === id; },
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
    send(type, data) {
      if (closed) return;
      channel.postMessage({ k: "msg", t: type, f: id, d: data });
    },
    setMeta(patch) {
      Object.assign(me, patch, { id });
      channel.postMessage({ k: "pres", p: me });
      rosterDirty = true;
      syncRoster();
    },
    leave() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      try { channel.postMessage({ k: "bye", f: id }); } catch (_) { /* closing */ }
      try { channel.close(); } catch (_) { /* already gone */ }
      emit("closed", null);
    },
  };
}

/* ------------------------------ RBNet ------------------------------ */

/**
 * Adapt an RBNet Room to the same link shape.
 *
 * RBNet hands handlers `(data, from)` and emits `peerleave` with a raw
 * id - not the `{from, data}` objects an earlier draft of this file
 * assumed, and its entry points are createRoom/joinRoom/quickJoin, not
 * host/join. Everything RBNet-shaped is confined to this function.
 */
function wrapRbnetRoom(room) {
  return {
    kind: "rbnet",
    room,
    get id() { return room.id; },
    get code() { return room.code; },
    get me() { return room.me; },
    get players() { return room.players; },
    get hostId() { return room.hostId; },
    get isHost() { return room.isHost; },
    on(type, fn) { return room.on(type, fn); },
    send(type, data) { room.send(type, data); },
    setMeta(patch) { room.setMeta(patch); },
    leave() { room.leave(); },
  };
}

/* ============================================================
   MODULE
   ============================================================ */

export async function createNet(ctx) {
  const { THREE, characters, world, physics } = ctx;
  const options = netOptions();
  const devTransport = options.transport === "loop";

  /** Stable identity across a reconnect. RBNet mints a fresh peer id
   *  every time you subscribe, so score and team would be lost on a
   *  dropped connection if peers were keyed by that. */
  const myUid = (() => {
    try {
      const stored = sessionStorage.getItem("bs-net-uid");
      if (stored) return stored;
      const fresh = Math.random().toString(36).slice(2, 6);
      sessionStorage.setItem("bs-net-uid", fresh);
      return fresh;
    } catch (_) {
      return Math.random().toString(36).slice(2, 6);
    }
  })();

  const WEAPON_ORDER = Object.keys((ctx.weapons && ctx.weapons.WEAPONS) || {});
  const HITBOXES = characters.HITBOXES || [];

  const state = {
    online: false,
    connecting: false,
    status: "offline",       // offline|connecting|connected|reconnecting|failed|degraded
    isHost: false,
    hostId: null,
    room: null,
    code: null,
    uid: myUid,
    name: options.name || "Soldier",
    team: TEAM.BLUE,
    /** Remote players, keyed by transport peer id. */
    peers: new Map(),
    /** Same peers keyed by their stable uid. */
    byUid: new Map(),
    ping: 0,
    jitter: 0,
    loss: 0,
    interpDelay: INTERP_MIN,
    sent: 0,
    received: 0,
    dropped: 0,
    rejected: 0,
    error: null,
    lastSnapshotAt: 0,
  };

  const clock = {
    /** netTime = performance.now()/1000 + offset. The host pins its own
     *  offset so net time starts at zero when the room opens; everyone
     *  else converges on that. */
    offset: 0,
    target: 0,
    have: false,
    rtt: 0,
    samples: [],
    lastPingAt: 0,
    pending: new Map(),
  };

  const bandwidth = {
    upBytes: 0, downBytes: 0, upMsgs: 0, downMsgs: 0,
    windowStart: 0,
    up: 0, down: 0, upRate: 0, downRate: 0,
    peakDown: 0,
    totalUp: 0, totalDown: 0,
  };

  const hitStats = { claimed: 0, accepted: 0, rejected: 0, reasons: {} };

  /* -------------------------- local clock -------------------------- */

  const perfNow = () => performance.now() / 1000;
  const netNow = () => perfNow() + clock.offset;

  /**
   * Fold one NTP-style round trip into the offset estimate.
   *
   * The minimum-RTT sample in the window is the best one - a sample
   * that took longer than the floor took longer in some unknown
   * split between the two directions, and averaging those in is how
   * you get an offset that wanders with congestion. The estimate is
   * then slewed rather than snapped: yanking net time sideways would
   * yank every remote player's interpolation with it.
   */
  function addClockSample(offset, rtt) {
    clock.samples.push({ offset, rtt, at: perfNow() });
    while (clock.samples.length > 12) clock.samples.shift();
    let best = clock.samples[0];
    for (const sample of clock.samples) if (sample.rtt < best.rtt) best = sample;
    clock.rtt = best.rtt;

    let spread = 0;
    for (const sample of clock.samples) spread = Math.max(spread, sample.rtt - best.rtt);
    state.jitter = spread * 1000;
    state.ping = Math.round(best.rtt * 1000);

    clock.target = best.offset;
    if (!clock.have) {
      clock.have = true;
      clock.offset = best.offset;
      resetTimebase();
    }
  }

  /** Every timestamp in every buffer is in net time, so moving net time
   *  invalidates all of them at once. Cheaper and far more honest than
   *  trying to rebase them: one frame of frozen remote players against
   *  a lobby that would otherwise interpolate towards garbage. */
  function resetTimebase() {
    localHistory.length = 0;
    for (const peer of state.peers.values()) {
      peer.history.length = 0;
      peer.baselines.clear();
      peer.smoothError.set(0, 0, 0);
      peer.lastArrivalAt = 0;
    }
  }

  function slewClock(dt) {
    if (!clock.have) return;
    const error = clock.target - clock.offset;
    if (Math.abs(error) > 0.25) {
      // A quarter second out is not drift, it is a new host or a tab
      // that was frozen. Snap, and let the interpolators re-seed.
      clock.offset = clock.target;
      resetTimebase();
      return;
    }
    // 50ms per second of correction: fast enough to track real drift,
    // slow enough that nothing visibly stutters.
    clock.offset += clamp(error, -0.05 * dt, 0.05 * dt);
  }

  /* --------------------------- serialisation --------------------------- */

  function packFlags(p) {
    const stance = p.stance === "prone" ? 2 : p.stance === "crouch" ? 1 : 0;
    const weapon = ctx.weapons ? clamp(ctx.weapons.activeIndex | 0, 0, 7) : 0;
    return stance
      | ((ctx.weapons && ctx.weapons.state.firing ? 1 : 0) << 2)
      | ((p.alive ? 1 : 0) << 3)
      | ((p.grounded ? 1 : 0) << 4)
      | (weapon << 5);
  }

  function sampleLocal() {
    const player = ctx.player;
    const p = player.state;
    return {
      qx: Math.round(player.position.x * POS_SCALE),
      qy: Math.round(player.position.y * POS_SCALE),
      qz: Math.round(player.position.z * POS_SCALE),
      qyaw: ((Math.round(p.yaw * YAW_SCALE) % YAW_STEPS) + YAW_STEPS) % YAW_STEPS,
      qpitch: clamp(Math.round(p.pitch * PITCH_SCALE), -127, 127),
      qspeed: clamp(Math.round(p.speed * SPEED_SCALE), 0, 255),
      flags: packFlags(p),
      health: clamp(Math.round(p.health), 0, 255),
    };
  }

  function encodeSnapshot(sample, baseline, keyframe, epoch) {
    let mask = (keyframe ? MASK_KEYFRAME : 0) | ((epoch & 3) << MASK_EPOCH_SHIFT);
    const values = [];
    for (let i = 0; i < FIELDS.length; i += 1) {
      const key = FIELDS[i];
      const value = sample[key];
      if (keyframe) {
        mask |= 1 << i;
        values.push(value);
        continue;
      }
      const base = baseline[key];
      if (value === base) continue;
      mask |= 1 << i;
      values.push(DELTA_FIELD[key] ? value - base : value);
    }
    return { mask, values };
  }

  function decodeSnapshot(mask, values, baseline) {
    const keyframe = (mask & MASK_KEYFRAME) !== 0;
    const out = {
      qx: baseline.qx, qy: baseline.qy, qz: baseline.qz,
      qyaw: baseline.qyaw, qpitch: baseline.qpitch, qspeed: baseline.qspeed,
      flags: baseline.flags, health: baseline.health,
    };
    let vi = 0;
    for (let i = 0; i < FIELDS.length; i += 1) {
      if ((mask & (1 << i)) === 0) continue;
      const key = FIELDS[i];
      const raw = values[vi];
      vi += 1;
      if (raw === undefined) return null;
      out[key] = (!keyframe && DELTA_FIELD[key]) ? baseline[key] + raw : raw;
    }
    return out;
  }

  const ZERO_BASELINE = {
    qx: 0, qy: 0, qz: 0, qyaw: 0, qpitch: 0, qspeed: 0, flags: 8, health: 100,
  };

  /* ------------------------------ peers ------------------------------ */

  function makeHistorySlot(t, sample) {
    return {
      t,
      x: sample.qx / POS_SCALE,
      y: sample.qy / POS_SCALE,
      z: sample.qz / POS_SCALE,
      yaw: sample.qyaw / YAW_SCALE,
      pitch: sample.qpitch / PITCH_SCALE,
      speed: sample.qspeed / SPEED_SCALE,
      stance: STANCE_BY_CODE[sample.flags & 3] || "stand",
      firing: (sample.flags >> 2) & 1,
      alive: ((sample.flags >> 3) & 1) === 1,
      grounded: ((sample.flags >> 4) & 1) === 1,
      weapon: (sample.flags >> 5) & 7,
      health: sample.health,
    };
  }

  function ensurePeer(id, meta = {}) {
    const existing = state.peers.get(id);
    if (existing) return existing;

    const team = meta.team === TEAM.RED ? TEAM.RED : TEAM.BLUE;
    const character = characters.build(team);
    characters.add(character);

    const peer = {
      id,
      uid: meta.uid || id.slice(0, 4),
      name: meta.name || "Soldier",
      team,
      character,
      root: character.root,
      /** Time-sorted snapshot history, ascending. Doubles as the
       *  rewind buffer the host uses for lag compensation. */
      history: [],
      baselines: new Map(),
      position: new THREE.Vector3(),
      /** Residual between where the peer was drawn last frame and where
       *  the new solution puts them. Decayed to zero over ~150ms so a
       *  correction is a glide, not a teleport. */
      smoothError: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      speed: 0,
      animPhase: 0,
      stance: "stand",
      firing: 0,
      alive: true,
      health: 100,
      weapon: 0,
      kills: 0,
      deaths: 0,
      score: 0,
      ping: 0,
      /** Per-peer interpolation delay, from that peer's own arrival
       *  jitter. One global number would either stutter for the worst
       *  connection or over-delay everyone for it. */
      interpDelay: INTERP_MIN,
      arrivalGap: 1 / RATE.NEAR,
      arrivalJitter: 0,
      lastArrivalAt: 0,
      lastSeq: -1,
      seqSeen: 0,
      seqSpan: 0,
      lastSeen: perfNow(),
      extrapolating: 0,
      shotBucket: 3,
      shotBucketAt: 0,
      hidden: false,
      spawnedAt: perfNow(),
    };
    state.peers.set(id, peer);
    state.byUid.set(peer.uid, peer);
    ctx.bus.emit("net:peerjoin", { id, uid: peer.uid, name: peer.name, team: peer.team, peer });
    return peer;
  }

  function setPeerTeam(peer, team) {
    const next = team === TEAM.RED ? TEAM.RED : TEAM.BLUE;
    if (next === peer.team) return;
    // The kit is baked into the meshes, so a side switch is a rebuild.
    characters.remove(peer.character);
    peer.team = next;
    peer.character = characters.build(next);
    peer.root = peer.character.root;
    characters.add(peer.character);
  }

  function dropPeer(id, reason = "left") {
    const peer = state.peers.get(id);
    if (!peer) return;
    characters.remove(peer.character);
    state.peers.delete(id);
    if (state.byUid.get(peer.uid) === peer) state.byUid.delete(peer.uid);
    ctx.bus.emit("net:peerleave", { id, uid: peer.uid, name: peer.name, reason, peer });
  }

  function clearPeers(reason) {
    for (const id of Array.from(state.peers.keys())) dropPeer(id, reason);
  }

  /* --------------------------- local history --------------------------- */

  /** What every other peer has been shown of us, in net time. The host
   *  rewinds against this when we are the victim, so it has to be the
   *  broadcast positions and not the per-frame ones. */
  const localHistory = [];

  function pushHistory(list, entry) {
    if (list.length && entry.t <= list[list.length - 1].t) {
      // Reordered arrival. Insert in place: interpolation reads by
      // time, so an out-of-order packet is still useful data.
      let i = list.length - 1;
      while (i >= 0 && list[i].t > entry.t) i -= 1;
      if (i >= 0 && Math.abs(list[i].t - entry.t) < 1e-4) return;
      list.splice(i + 1, 0, entry);
    } else {
      list.push(entry);
    }
    const cutoff = entry.t - HISTORY_SPAN;
    while (list.length > 2 && list[0].t < cutoff) list.shift();
    while (list.length > 64) list.shift();
  }

  const _sampleOut = { x: 0, y: 0, z: 0, yaw: 0, valid: false, clamped: false };

  /** Position of a history buffer at an arbitrary net time. */
  function sampleAt(list, t) {
    _sampleOut.valid = false;
    _sampleOut.clamped = false;
    if (!list.length) return _sampleOut;
    if (t <= list[0].t) {
      const e = list[0];
      _sampleOut.x = e.x; _sampleOut.y = e.y; _sampleOut.z = e.z; _sampleOut.yaw = e.yaw;
      _sampleOut.valid = true; _sampleOut.clamped = true;
      return _sampleOut;
    }
    const newest = list[list.length - 1];
    if (t >= newest.t) {
      _sampleOut.x = newest.x; _sampleOut.y = newest.y; _sampleOut.z = newest.z;
      _sampleOut.yaw = newest.yaw;
      _sampleOut.valid = true;
      _sampleOut.clamped = t - newest.t > 0.05;
      return _sampleOut;
    }
    for (let i = list.length - 1; i > 0; i -= 1) {
      const b = list[i];
      const a = list[i - 1];
      if (t >= a.t && t <= b.t) {
        const span = b.t - a.t;
        const f = span > 1e-5 ? (t - a.t) / span : 1;
        _sampleOut.x = lerp(a.x, b.x, f);
        _sampleOut.y = lerp(a.y, b.y, f);
        _sampleOut.z = lerp(a.z, b.z, f);
        _sampleOut.yaw = a.yaw + angleDelta(a.yaw, b.yaw) * f;
        _sampleOut.valid = true;
        return _sampleOut;
      }
    }
    return _sampleOut;
  }

  /* --------------------------- interpolation --------------------------- */

  const _extrap = new THREE.Vector3();

  /**
   * Draw a remote player `peer.interpDelay` in the past, between the
   * two snapshots that bracket that instant.
   *
   * Beyond the newest snapshot we extrapolate, but with the velocity
   * decayed quadratically over the window and suppressed entirely when
   * the last snapshot said the player had stopped. Plain linear
   * extrapolation is what makes a player who stopped at a corner slide
   * two metres past it and snap back - the rubber-banding people blame
   * on their connection is almost always this, not packet loss.
   */
  function interpolatePeer(peer, dt, now) {
    const list = peer.history;
    if (!list.length) return;

    const target = now - peer.interpDelay;
    const newest = list[list.length - 1];

    let px = newest.x;
    let py = newest.y;
    let pz = newest.z;
    let yaw = newest.yaw;
    let pitch = newest.pitch;
    let speed = newest.speed;

    if (target <= list[0].t) {
      const oldest = list[0];
      px = oldest.x; py = oldest.y; pz = oldest.z;
      yaw = oldest.yaw; pitch = oldest.pitch; speed = oldest.speed;
      peer.extrapolating = 0;
    } else if (target < newest.t) {
      peer.extrapolating = 0;
      for (let i = list.length - 1; i > 0; i -= 1) {
        const b = list[i];
        const a = list[i - 1];
        if (target >= a.t && target <= b.t) {
          const span = b.t - a.t;
          const f = span > 1e-5 ? clamp01((target - a.t) / span) : 1;
          px = lerp(a.x, b.x, f);
          py = lerp(a.y, b.y, f);
          pz = lerp(a.z, b.z, f);
          yaw = a.yaw + angleDelta(a.yaw, b.yaw) * f;
          pitch = lerp(a.pitch, b.pitch, f);
          speed = lerp(a.speed, b.speed, f);
          peer.stance = b.stance;
          peer.firing = b.firing;
          peer.alive = b.alive;
          peer.health = b.health;
          peer.weapon = b.weapon;
          break;
        }
      }
    } else {
      const ahead = target - newest.t;
      peer.extrapolating = clamp01(ahead / EXTRAP_MAX);
      const previous = list.length > 1 ? list[list.length - 2] : null;
      // A peer whose last packet said "stopped" gets no extrapolation
      // at all. This is the whole fix for overshoot on a stop.
      if (previous && newest.speed > 0.35 && ahead < EXTRAP_MAX) {
        const span = newest.t - previous.t;
        if (span > 1e-4) {
          _extrap.set(
            (newest.x - previous.x) / span,
            (newest.y - previous.y) / span,
            (newest.z - previous.z) / span
          );
          const decay = (1 - clamp01(ahead / EXTRAP_MAX)) ** 2;
          const step = Math.min(ahead, EXTRAP_MAX) * decay;
          px += _extrap.x * step;
          py += _extrap.y * step;
          pz += _extrap.z * step;
        }
      }
      peer.stance = newest.stance;
      peer.firing = newest.firing;
      peer.alive = newest.alive;
      peer.health = newest.health;
      peer.weapon = newest.weapon;
    }

    // Absorb the jump from wherever we were drawing them into a decaying
    // offset, so a late packet corrects over ~150ms instead of snapping.
    const errX = peer.position.x - px;
    const errY = peer.position.y - py;
    const errZ = peer.position.z - pz;
    const errSq = errX * errX + errY * errY + errZ * errZ;
    if (errSq > 0.0004 && errSq < 36) {
      peer.smoothError.set(errX, errY, errZ);
    } else if (errSq >= 36) {
      // More than 6m out is a respawn or a long stall, not a
      // correction. Teleport; smoothing that would be a slow slide
      // across the map.
      peer.smoothError.set(0, 0, 0);
    }
    const keep = Math.exp(-dt * 14);
    peer.smoothError.multiplyScalar(keep);
    if (peer.smoothError.lengthSq() < 1e-6) peer.smoothError.set(0, 0, 0);

    peer.position.set(px + peer.smoothError.x, py + peer.smoothError.y, pz + peer.smoothError.z);
    peer.yaw = yaw;
    peer.pitch = pitch;
    peer.speed = speed;

    peer.animPhase += peer.speed * dt * 2.1;
    peer.root.visible = peer.alive && !peer.hidden;
    peer.root.position.copy(peer.position);
    peer.root.rotation.y = peer.yaw;
    characters.pose(peer.character, {
      speed: peer.speed,
      phase: peer.animPhase,
      aimPitch: peer.pitch,
      stance: peer.stance,
      firing: peer.firing,
      dead: !peer.alive,
    }, dt);
  }

  /** Where a peer's body actually was at a given net time, for rewind.
   *  This deliberately ignores smoothError - the shooter saw the
   *  smoothed body, but the difference is under 20cm and using the raw
   *  history keeps the host's reconstruction identical to the data
   *  every client received. */
  function rewindPeer(peer, t) {
    return sampleAt(peer.history, t);
  }

  /* ---------------------------- hit testing ---------------------------- */

  const _boxMin = new THREE.Vector3();
  const _boxMax = new THREE.Vector3();

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

  /** Test one soldier standing at `pos` against a ray. `pad` grows every
   *  box, used on the host to absorb quantisation between what the
   *  shooter interpolated and what we reconstruct. */
  function testSoldier(origin, direction, pos, maxDist, pad = 0) {
    const dx = pos.x - origin.x;
    const dy = pos.y - origin.y;
    const dz = pos.z - origin.z;
    const along = dx * direction.x + dy * direction.y + dz * direction.z;
    if (along < -2 || along > maxDist + 2) return null;
    const perpSq = (dx - direction.x * along) ** 2
      + (dy - direction.y * along) ** 2
      + (dz - direction.z * along) ** 2;
    if (perpSq > (1.6 + pad) ** 2) return null;

    let best = null;
    for (let i = 0; i < HITBOXES.length; i += 1) {
      const box = HITBOXES[i];
      _boxMin.set(
        pos.x + box.offset[0] - box.size[0] * 0.5 - pad,
        pos.y + box.offset[1] - box.size[1] * 0.5 - pad,
        pos.z + box.offset[2] - box.size[2] * 0.5 - pad
      );
      _boxMax.set(
        pos.x + box.offset[0] + box.size[0] * 0.5 + pad,
        pos.y + box.offset[1] + box.size[1] * 0.5 + pad,
        pos.z + box.offset[2] + box.size[2] * 0.5 + pad
      );
      const t = rayAabb(origin, direction, _boxMin, _boxMax, best ? best.distance : maxDist);
      if (t < 0) continue;
      if (best && t >= best.distance) continue;
      best = { distance: t, part: i, name: box.name, multiplier: box.multiplier };
    }
    return best;
  }

  function weaponDef(index) {
    const table = (ctx.weapons && ctx.weapons.WEAPONS) || {};
    const id = WEAPON_ORDER[index] || WEAPON_ORDER[0];
    return table[id] || null;
  }

  function falloffAt(curve, distance) {
    if (!curve || !curve.length) return 1;
    if (distance <= curve[0][0]) return curve[0][1];
    for (let i = 1; i < curve.length; i += 1) {
      const [d0, v0] = curve[i - 1];
      const [d1, v1] = curve[i];
      if (distance <= d1) return lerp(v0, v1, (distance - d0) / (d1 - d0));
    }
    return curve[curve.length - 1][1];
  }

  /* --------------------------- outgoing events --------------------------- */

  /** Everything that would otherwise be its own message queues here and
   *  rides the next tick. With a ~150 byte envelope, a message per
   *  gunshot at 780rpm costs more than the entire movement stream. */
  let outEvents = [];
  let urgent = false;

  /** Codes that must not wait out a 500ms idle-rate interval. A shot
   *  or a damage award arriving half a second late is a different game
   *  from one arriving in 50ms; a movement snapshot is not. */
  const URGENT_CODES = { f: 1, h: 1, j: 1, w: 1, r: 1, p: 1, q: 1 };

  function queueEvent(event) {
    if (!state.online) return;
    if (outEvents.length > 24) return;
    outEvents.push(event);
    if (URGENT_CODES[event[0]]) urgent = true;
  }

  /* ------------------------------ sending ------------------------------ */

  let seq = 0;
  let epoch = 0;
  let baseline = { ...ZERO_BASELINE };
  let packetsSinceKeyframe = 999;
  let lastKeyframeAt = -99;
  let nextSendAt = 0;
  let lastSendAt = -1;
  let currentRate = RATE.NEAR;
  let rateHoldUntil = 0;
  let burstUntil = 0;
  const relevance = new Map();

  /**
   * Pick our own snapshot rate.
   *
   * On a broadcast relay you cannot cull per receiver - RBNet's
   * `sendTo` still fans out to everyone and filters on arrival, so a
   * directed update costs N messages instead of one. The only lever
   * that actually reduces relay traffic is how often we speak, so the
   * rate becomes the maximum any single peer needs: close peers, or
   * peers who can see us, force 20Hz; a lobby spread across a
   * kilometre with walls in between runs at 2Hz.
   */
  function pickRate(now) {
    if (!state.peers.size) return RATE.IDLE;
    const me = ctx.player.position;
    let required = RATE.IDLE;

    for (const peer of state.peers.values()) {
      const distance = peer.position.distanceTo(me);
      let rate;
      if (distance < 60) rate = RATE.NEAR;
      else if (distance < 140) rate = RATE.MID;
      else if (distance < 260) rate = RATE.FAR;
      else rate = RATE.IDLE;

      if (rate <= RATE.FAR && distance < 420) {
        // One line-of-sight test per peer at 4Hz. A sniper at 300m with
        // a clear lane is exactly the case where dropping to 2Hz makes
        // a player look like a slideshow.
        let record = relevance.get(peer.id);
        if (!record || now - record.at > 0.25) {
          const from = ctx.player.eyePosition;
          const to = peer.position.clone();
          to.y += 1.4;
          const visible = physics.lineOfSight(from, to, LAYER.TERRAIN | LAYER.STATIC);
          record = { at: now, visible };
          relevance.set(peer.id, record);
        }
        if (record.visible) rate = Math.max(rate, RATE.FAR);
      }
      if (rate > required) required = rate;
    }

    if (now < burstUntil) required = RATE.NEAR;
    if (!ctx.player.state.alive) required = Math.min(required, RATE.MID);

    // Rising is instant, falling waits: a peer walking in and out of
    // 60m should not make our send rate chatter.
    if (required >= currentRate) {
      currentRate = required;
      rateHoldUntil = now + RATE_HYSTERESIS;
    } else if (now >= rateHoldUntil) {
      currentRate = required;
      rateHoldUntil = now + RATE_HYSTERESIS;
    }
    return currentRate;
  }

  function accountSend(payload) {
    const bytes = JSON.stringify(payload).length + ENVELOPE_BYTES;
    bandwidth.upBytes += bytes;
    bandwidth.upMsgs += 1;
    bandwidth.totalUp += bytes;
    state.sent += 1;
    return bytes;
  }

  function sendTick(now) {
    const link = state.room;
    if (!link || !ctx.player) return;

    const sample = sampleLocal();
    const forceKey = packetsSinceKeyframe >= KEYFRAME_MAX_PACKETS
      || now - lastKeyframeAt >= KEYFRAME_INTERVAL;
    if (forceKey) {
      epoch = (epoch + 1) & 3;
      baseline = { ...sample };
      packetsSinceKeyframe = 0;
      lastKeyframeAt = now;
    } else {
      packetsSinceKeyframe += 1;
    }

    const t = netNow();
    const { mask, values } = encodeSnapshot(sample, baseline, forceKey, epoch);
    seq = (seq + 1) & 0xffff;

    const payload = [seq, Math.round(t * 1000), mask, values];
    if (forceKey) {
      // Identity and measured ping ride the keyframe. Once a second is
      // plenty for a scoreboard and it costs no extra message.
      outEvents.push(["s", myUid, state.name, state.team, Math.round(clock.rtt * 1000)]);
    }
    for (const event of outEvents) {
      // Timestamp the clock-sync events at the instant they actually
      // leave, not when they were queued. Queue latency at the 2Hz idle
      // rate is half a second, which would put the RTT estimate - and
      // therefore every rewind - out by more than the ping it measures.
      if (event[0] === "p") clock.pending.set(event[1], now);
      else if (event[0] === "q") event[4] = Math.max(0, Math.round((t - event[3] / 1000) * 1000));
    }
    if (outEvents.length) payload.push(outEvents);

    link.send("t", payload);
    accountSend(payload);
    outEvents = [];
    urgent = false;
    lastSendAt = now;

    pushHistory(localHistory, makeHistorySlot(t, sample));
    state.lastSnapshotAt = t;
  }

  /* ----------------------------- receiving ----------------------------- */

  function onTick(data, from) {
    if (!Array.isArray(data) || data.length < 4) return;
    const bytes = JSON.stringify(data).length + ENVELOPE_BYTES;
    bandwidth.downBytes += bytes;
    bandwidth.downMsgs += 1;
    bandwidth.totalDown += bytes;
    state.received += 1;

    const peer = ensurePeer(from);
    const now = perfNow();
    const [packetSeq, tms, mask, values, events] = data;

    /* ---- arrival statistics, which set this peer's interp delay ---- */
    if (peer.lastArrivalAt > 0) {
      const gap = now - peer.lastArrivalAt;
      // Track the gap and how much it varies. Both feed the delay: the
      // delay has to cover one whole send interval plus the jitter, or
      // a peer sending at 6Hz stutters no matter how good the link is.
      const deviation = Math.abs(gap - peer.arrivalGap);
      peer.arrivalGap = damp(peer.arrivalGap, gap, 4, Math.min(gap, 0.5));
      peer.arrivalJitter = damp(peer.arrivalJitter, deviation, 2.5, Math.min(gap, 0.5));
    }
    peer.lastArrivalAt = now;
    peer.lastSeen = now;

    /* ---- loss / reorder bookkeeping ---- */
    if (peer.lastSeq >= 0) {
      let delta = (packetSeq - peer.lastSeq) & 0xffff;
      if (delta > 0x8000) delta -= 0x10000;
      if (delta > 0) {
        peer.seqSpan += delta;
        peer.seqSeen += 1;
        if (delta > 1) state.dropped += delta - 1;
        peer.lastSeq = packetSeq;
      } else {
        // Reordered. Baseline-delta coding means it still decodes on
        // its own, and history insert is time-sorted, so it is data we
        // can simply use.
        peer.seqSeen += 1;
      }
    } else {
      peer.lastSeq = packetSeq;
      peer.seqSeen = 1;
      peer.seqSpan = 1;
    }

    /* ---- state ---- */
    const packetEpoch = (mask >> MASK_EPOCH_SHIFT) & 3;
    const keyframe = (mask & MASK_KEYFRAME) !== 0;
    let base = peer.baselines.get(packetEpoch);
    if (keyframe) base = ZERO_BASELINE;
    if (!base) {
      // A delta against a keyframe we never got. Ask for a fresh one
      // rather than guessing; without this a peer who joins mid-stream
      // stands still until the next scheduled keyframe.
      requestKeyframe(peer);
    } else {
      const decoded = decodeSnapshot(mask, values || [], base);
      if (decoded) {
        if (keyframe) {
          peer.baselines.set(packetEpoch, decoded);
          // Two epochs is enough: a delta can only reference the
          // current keyframe or the one it crossed over from.
          for (const key of Array.from(peer.baselines.keys())) {
            if (((packetEpoch - key) & 3) > 1) peer.baselines.delete(key);
          }
        }
        pushHistory(peer.history, makeHistorySlot(tms / 1000, decoded));
      }
    }

    /* ---- piggybacked events ---- */
    if (Array.isArray(events)) {
      for (const event of events) {
        if (Array.isArray(event)) handleEvent(peer, event);
      }
    }
  }

  let keyframeRequestAt = 0;
  function requestKeyframe(peer) {
    const now = perfNow();
    if (now - keyframeRequestAt < 0.5) return;
    keyframeRequestAt = now;
    queueEvent(["r", peer.uid]);
  }

  /* ------------------------------ events ------------------------------ */

  function handleEvent(peer, event) {
    const code = event[0];
    switch (code) {
      case "s": {                       // identity + ping
        const [, uid, name, team, rttMs] = event;
        if (uid && peer.uid !== uid) {
          if (state.byUid.get(peer.uid) === peer) state.byUid.delete(peer.uid);
          peer.uid = uid;
          state.byUid.set(uid, peer);
        }
        if (name) peer.name = name;
        if (team) setPeerTeam(peer, team);
        peer.ping = rttMs || 0;
        break;
      }
      case "p": {                       // ping, host answers
        if (!state.isHost) break;
        const t1 = netNow();
        queueEvent(["q", peer.uid, event[1], Math.round(t1 * 1000), 0]);
        break;
      }
      case "q": {                       // pong
        if (event[1] !== myUid) break;
        const t0 = clock.pending.get(event[2]);
        if (t0 === undefined) break;
        clock.pending.delete(event[2]);
        const t3 = perfNow();
        const t1 = event[3] / 1000;
        // The host answers on its next tick, so subtract however long
        // it held the ping. Without this the offset is biased by half
        // a send interval and drifts with the host's frame rate.
        const hold = Math.max(0, (event[4] || 0) / 1000);
        const rtt = Math.max(0, (t3 - t0) - hold);
        const offset = (t1 - hold * 0.5) - (t0 + rtt * 0.5);
        addClockSample(offset, rtt);
        break;
      }
      case "r": {                       // keyframe request aimed at us
        if (event[1] === myUid) {
          packetsSinceKeyframe = KEYFRAME_MAX_PACKETS;
          lastKeyframeAt = -99;
        }
        break;
      }
      case "j": handleHello(peer, event); break;
      case "w": handleWelcome(peer, event); break;
      case "f": handleShot(peer, event); break;
      case "h": handleAward(peer, event); break;
      case "m": handleMatch(peer, event); break;
      default: break;
    }
  }

  /* ----------------------------- join flow ----------------------------- */

  function teamCounts() {
    const counts = { [TEAM.BLUE]: 0, [TEAM.RED]: 0 };
    counts[state.team] += 1;
    for (const peer of state.peers.values()) counts[peer.team] += 1;
    return counts;
  }

  function handleHello(peer, event) {
    const [, uid, name] = event;
    if (uid) {
      if (state.byUid.get(peer.uid) === peer) state.byUid.delete(peer.uid);
      peer.uid = uid;
      state.byUid.set(uid, peer);
    }
    if (name) peer.name = name;
    if (!state.isHost) return;

    // Team balance is the host's call, made once, on arrival. Letting
    // clients choose produces 11-v-5 within a minute.
    const counts = teamCounts();
    const assigned = counts[TEAM.BLUE] <= counts[TEAM.RED] ? TEAM.BLUE : TEAM.RED;
    setPeerTeam(peer, assigned);

    const scores = [];
    for (const other of state.peers.values()) {
      scores.push(other.uid, other.kills, other.deaths, other.score);
    }
    queueEvent(["w", peer.uid, assigned, ctx.seed, Math.round(netNow() * 1000), scores]);
    queueEvent(matchEvent(true));
    // Everyone re-keyframes so the newcomer has a baseline immediately.
    packetsSinceKeyframe = KEYFRAME_MAX_PACKETS;
    lastKeyframeAt = -99;
  }

  function handleWelcome(peer, event) {
    const [, toUid, team, seed, hostTimeMs, scores] = event;
    if (toUid !== myUid) return;
    if (!clock.have && typeof hostTimeMs === "number") {
      // Seed the clock from the welcome so the first snapshots are not
      // discarded as impossibly old while the first ping round trips.
      clock.offset = hostTimeMs / 1000 - perfNow();
      clock.target = clock.offset;
      clock.have = true;
    }
    if (seed !== undefined && seed !== ctx.seed) {
      ctx.bus.emit("net:error", {
        message: "The host is playing a different map seed.",
        fatal: false,
      });
    }
    applyLocalTeam(team, "assigned");
    if (Array.isArray(scores)) {
      for (let i = 0; i + 3 < scores.length; i += 4) {
        const other = state.byUid.get(scores[i]);
        if (!other) continue;
        other.kills = scores[i + 1];
        other.deaths = scores[i + 2];
        other.score = scores[i + 3];
      }
    }
    ctx.bus.emit("net:status", statusPayload());
  }

  function applyLocalTeam(team, reason) {
    const next = team === TEAM.RED ? TEAM.RED : TEAM.BLUE;
    if (next === state.team) return;
    state.team = next;
    if (ctx.player) {
      ctx.player.state.team = next;
      ctx.player.respawn();
    }
    if (state.room) state.room.setMeta({ team: next });
    ctx.bus.emit("net:team", { team: next, reason });
  }

  /* --------------------------- shot pipeline --------------------------- */

  const _shotOrigin = new THREE.Vector3();
  const _shotDir = new THREE.Vector3();
  const _peerAt = new THREE.Vector3();

  let explicitShots = false;
  const shotBudget = { count: 0, at: 0 };

  /**
   * The local player fired. Resolve against remote players *as they are
   * currently drawn* - that is what the shooter aimed at - and ship the
   * claim with the view time it was made at, so the host can rewind to
   * the same instant.
   */
  function reportShot(origin, direction, range = 600, tracer = false) {
    if (!state.online || !state.room) return null;
    explicitShots = true;
    return emitShot(origin, direction, range, tracer);
  }

  function emitShot(origin, direction, range, tracer) {
    const now = perfNow();
    if (now - shotBudget.at > 1) { shotBudget.at = now; shotBudget.count = 0; }
    shotBudget.count += 1;
    // Hard ceiling on shots per second we will even describe. Above
    // this the extra rounds are cosmetic and the host would reject
    // them anyway.
    if (shotBudget.count > 24) return null;

    _shotOrigin.copy(origin);
    _shotDir.copy(direction).normalize();
    burstUntil = now + 0.8;

    const t = netNow();
    const weaponIndex = ctx.weapons ? clamp(ctx.weapons.activeIndex | 0, 0, 7) : 0;
    const def = weaponDef(weaponIndex);
    const maxRange = Math.min(range || 600, 700);

    // How far the ray gets before it hits the world. Shooting a peer
    // standing behind a wall has to fail on the shooter too, or every
    // client shows a hitmarker the host then throws away.
    const worldHit = physics.raycast(_shotOrigin, _shotDir, maxRange, {
      layer: LAYER.TERRAIN | LAYER.STATIC | LAYER.DYNAMIC | LAYER.VEHICLE,
    });
    const limit = worldHit.hit ? worldHit.distance : maxRange;

    const hits = [];
    let best = null;
    for (const peer of state.peers.values()) {
      if (!peer.alive || peer.team === state.team) continue;
      const test = testSoldier(_shotOrigin, _shotDir, peer.position, limit, 0);
      if (!test) continue;
      if (best && test.distance >= best.test.distance) continue;
      best = { peer, test };
    }
    if (best) {
      const falloff = def ? falloffAt(def.damageFalloff, best.test.distance) : 1;
      const damage = (def ? def.damage : 25) * falloff * best.test.multiplier;
      hits.push([best.peer.uid, best.test.part, Math.round(damage * 10)]);
      hitStats.claimed += 1;
      ctx.bus.emit("net:hit", {
        uid: best.peer.uid,
        name: best.peer.name,
        headshot: best.test.name === "head",
        distance: best.test.distance,
      });
    }

    // The view time: what instant of the world the shooter was looking
    // at. Everything downstream of lag compensation hangs off this one
    // number being honest.
    const viewTime = t - viewDelay();

    const event = [
      "f",
      Math.round(_shotOrigin.x * POS_SCALE),
      Math.round(_shotOrigin.y * POS_SCALE),
      Math.round(_shotOrigin.z * POS_SCALE),
      Math.round(_shotDir.x * DIR_SCALE),
      Math.round(_shotDir.y * DIR_SCALE),
      Math.round(_shotDir.z * DIR_SCALE),
      weaponIndex,
      Math.round(t * 1000),
      Math.round(viewTime * 1000),
      tracer ? 1 : 0,
    ];
    if (hits.length) event.push(hits);
    queueEvent(event);

    if (state.isHost && hits.length) {
      // We are the authority; no round trip to wait for.
      validateShot(localAsShooter(), event, true);
    }
    return { hits, viewTime };
  }

  /** The mean interpolation delay we are currently drawing enemies at. */
  function viewDelay() {
    let sum = 0;
    let count = 0;
    for (const peer of state.peers.values()) {
      if (peer.team === state.team) continue;
      sum += peer.interpDelay;
      count += 1;
    }
    return count ? sum / count : state.interpDelay;
  }

  function localAsShooter() {
    return {
      uid: myUid,
      name: state.name,
      team: state.team,
      history: localHistory,
      shotBucket: localShooter.shotBucket,
      shotBucketAt: localShooter.shotBucketAt,
      kills: ctx.player ? ctx.player.state.kills : 0,
      score: ctx.player ? ctx.player.state.score : 0,
      isLocal: true,
    };
  }
  const localShooter = { shotBucket: 3, shotBucketAt: 0 };

  function handleShot(peer, event) {
    // Everyone plays the muzzle flash and the crack; only the host
    // decides whether anybody bled.
    const origin = new THREE.Vector3(
      event[1] / POS_SCALE, event[2] / POS_SCALE, event[3] / POS_SCALE
    );
    const dir = new THREE.Vector3(
      event[4] / DIR_SCALE, event[5] / DIR_SCALE, event[6] / DIR_SCALE
    );
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();

    if (ctx.vfx) {
      ctx.vfx.muzzleFlash(origin, dir, 1);
      if (event[10]) ctx.vfx.tracer(origin, dir, 300, { speed: 880, colour: 0xffbe6a });
    }
    ctx.audio?.gunshot?.(origin, { gain: 0.9 });

    // Near-miss crack for the local player, so incoming fire from a
    // human suppresses exactly like incoming fire from a bot.
    if (ctx.player && ctx.player.state.alive && peer.team !== state.team) {
      const toMe = ctx.player.eyePosition.clone().sub(origin);
      const along = toMe.dot(dir);
      if (along > 0 && along < 300) {
        const perpendicular = toMe.addScaledVector(dir, -along).length();
        if (perpendicular < 3.2) {
          ctx.audio?.bulletCrack?.(ctx.player.eyePosition, 1 - perpendicular / 3.2);
          ctx.player.addSuppression(0.34 * (1 - perpendicular / 3.2));
        }
      }
    }

    if (state.isHost) validateShot(peer, event, false);
  }

  /* ------------------------- host: lag compensation ------------------------- */

  let lagCompensation = true;

  function reject(reason) {
    hitStats.rejected += 1;
    hitStats.reasons[reason] = (hitStats.reasons[reason] || 0) + 1;
    state.rejected += 1;
    ctx.bus.emit("net:rejected", { reason });
    return false;
  }

  /**
   * Host-side validation of one claimed shot.
   *
   * The client is trusted for *what it aimed at*, because that is the
   * only thing it can know better than we can. It is trusted for
   * nothing else: the damage number is re-derived, the wall test is
   * re-run against our own collision world, the origin is checked
   * against where our history says the shooter actually was, and the
   * rate of fire is metered.
   */
  function validateShot(shooter, event, isLocal) {
    const now = netNow();
    const shotTime = event[8] / 1000;
    const viewTime = event[9] / 1000;
    const claims = event[11];
    if (!Array.isArray(claims) || !claims.length) return true;

    /* ---- rate of fire ---- */
    const weaponIndex = event[7];
    const def = weaponDef(weaponIndex);
    const rpm = def ? def.rpm : 700;
    const refill = rpm / 60;
    const elapsed = shotTime - (shooter.shotBucketAt || 0);
    shooter.shotBucket = Math.min(3, (shooter.shotBucket ?? 3) + Math.max(0, elapsed) * refill);
    shooter.shotBucketAt = shotTime;
    if (shooter.shotBucket < 1) return reject("rate-of-fire");
    shooter.shotBucket -= 1;
    if (isLocal) {
      localShooter.shotBucket = shooter.shotBucket;
      localShooter.shotBucketAt = shooter.shotBucketAt;
    }

    /* ---- rewind window ---- */
    const rewindAge = now - viewTime;
    if (rewindAge > MAX_REWIND || rewindAge < -0.15) return reject("stale-view");
    if (Math.abs(now - shotTime) > MAX_REWIND) return reject("stale-shot");

    const origin = new THREE.Vector3(
      event[1] / POS_SCALE, event[2] / POS_SCALE, event[3] / POS_SCALE
    );
    const dir = new THREE.Vector3(
      event[4] / DIR_SCALE, event[5] / DIR_SCALE, event[6] / DIR_SCALE
    );
    if (dir.lengthSq() < 1e-6) return reject("bad-direction");
    dir.normalize();

    /* ---- was the shooter there? ---- */
    if (!isLocal) {
      const where = sampleAt(shooter.history, shotTime);
      if (!where.valid) return reject("no-history");
      const dx = origin.x - where.x;
      const dy = origin.y - (where.y + 1.66);
      const dz = origin.z - where.z;
      // Generous, because the client predicts a whole send interval
      // past its last snapshot, but nowhere near generous enough to
      // let someone shoot from across the map.
      const tolerance = 2.6 + (where.clamped ? 1.4 : 0);
      if (dx * dx + dy * dy + dz * dz > tolerance * tolerance) {
        return reject("bad-origin");
      }
    }

    /* ---- rewind each victim and re-test ---- */
    let accepted = 0;
    for (const claim of claims) {
      if (!Array.isArray(claim) || claim.length < 3) continue;
      const [victimUid, part, dmg10] = claim;
      const victim = victimUid === myUid ? null : state.byUid.get(victimUid);
      const victimIsMe = victimUid === myUid;
      if (!victim && !victimIsMe) { reject("unknown-victim"); continue; }

      const victimTeam = victimIsMe ? state.team : victim.team;
      if (victimTeam === shooter.team) { reject("friendly-fire"); continue; }
      if (!victimIsMe && !victim.alive) { reject("already-dead"); continue; }
      if (victimIsMe && !ctx.player.state.alive) { reject("already-dead"); continue; }

      const list = victimIsMe ? localHistory : victim.history;
      const at = lagCompensation ? rewindPeer({ history: list }, viewTime) : sampleAt(list, now);
      if (!at.valid) { reject("no-rewind"); continue; }
      _peerAt.set(at.x, at.y, at.z);

      // 15cm of pad: the reconstruction uses the same packets the
      // shooter had, so the only real error is 2cm quantisation plus
      // the 150ms visual smoothing offset.
      const test = testSoldier(origin, dir, _peerAt, 700, 0.15);
      if (!test) { reject("no-intersect"); continue; }

      const blocked = physics.raycast(
        origin.clone().addScaledVector(dir, 0.12), dir,
        Math.max(0.1, test.distance - 0.35),
        { layer: LAYER.TERRAIN | LAYER.STATIC | LAYER.DYNAMIC }
      );
      if (blocked.hit) { reject("wall"); continue; }

      const falloff = def ? falloffAt(def.damageFalloff, test.distance) : 1;
      const authoritative = (def ? def.damage : 25) * falloff * test.multiplier;
      // The claim is capped, never trusted upward. A client that says
      // 900 gets whatever this weapon does at this range to this box.
      const damage = Math.min(dmg10 / 10, authoritative * 1.05);

      awardDamage(shooter, victimIsMe ? null : victim, damage, test, event);
      accepted += 1;
      hitStats.accepted += 1;
    }
    return accepted > 0;
  }

  function awardDamage(shooter, victim, damage, test, event) {
    const headshot = test.name === "head";
    const victimUid = victim ? victim.uid : myUid;
    let killed = false;

    if (victim) {
      victim.health = Math.max(0, victim.health - damage);
      killed = victim.health <= 0;
      if (killed) {
        victim.deaths += 1;
        victim.health = 100;
      }
    } else {
      killed = ctx.player.state.health - damage <= 0;
      ctx.player.applyDamage(damage, null, "bullet");
    }

    if (killed) {
      if (shooter.isLocal) {
        ctx.player.state.kills += 1;
        ctx.player.state.score += headshot ? 150 : 100;
        // Conquest bleeds a ticket per casualty on top of the flag
        // bleed, which is what makes a losing push actually cost.
        const victimTeam = victim ? victim.team : state.team;
        world.match.tickets[victimTeam] = Math.max(0, world.match.tickets[victimTeam] - 1);
      } else {
        shooter.kills = (shooter.kills || 0) + 1;
        shooter.score = (shooter.score || 0) + (headshot ? 150 : 100);
        const victimTeam = victim ? victim.team : state.team;
        world.match.tickets[victimTeam] = Math.max(0, world.match.tickets[victimTeam] - 1);
      }
    }

    queueEvent(["h", victimUid, shooter.uid, Math.round(damage * 10),
      test.part, killed ? 1 : 0]);

    ctx.bus.emit("net:kill", {
      killer: shooter.name || "Soldier",
      killerUid: shooter.uid,
      victim: victim ? victim.name : state.name,
      victimUid,
      headshot,
      killed,
      weapon: WEAPON_ORDER[event[7]] || "rifle",
    });
  }

  /** A damage award from the host. This is the authority - the client
   *  does not predict its own health, because a health bar that
   *  guesses wrong is worse than one that arrives half an RTT late. */
  function handleAward(peer, event) {
    if (peer.id !== state.hostId) return;   // only the host awards damage
    const [, victimUid, shooterUid, dmg10, part, killed] = event;
    const damage = dmg10 / 10;
    const shooter = state.byUid.get(shooterUid);
    const headshot = HITBOXES[part] && HITBOXES[part].name === "head";

    if (victimUid === myUid) {
      ctx.player.applyDamage(damage, null, "bullet");
      ctx.bus.emit("net:damage", {
        amount: damage,
        from: shooter ? shooter.name : "Enemy",
        headshot,
        killed: Boolean(killed),
      });
    } else {
      const victim = state.byUid.get(victimUid);
      if (victim) {
        victim.health = Math.max(0, victim.health - damage);
        if (killed) { victim.deaths += 1; victim.health = 100; }
      }
      if (shooterUid === myUid) {
        ctx.bus.emit("net:hitconfirm", { uid: victimUid, headshot, killed: Boolean(killed) });
        if (killed && ctx.player) {
          ctx.player.state.kills += 1;
          ctx.player.state.score += headshot ? 150 : 100;
        }
      }
    }

    if (killed) {
      const victim = victimUid === myUid ? null : state.byUid.get(victimUid);
      ctx.bus.emit("net:kill", {
        killer: shooter ? shooter.name : "Enemy",
        killerUid: shooterUid,
        victim: victim ? victim.name : state.name,
        victimUid,
        headshot,
        killed: true,
      });
    }
  }

  /* --------------------------- match replication --------------------------- */

  let matchTimer = 0;
  let matchSends = 0;
  /** Last replica we received. The new host adopts this on migration
   *  so a match does not restart because someone closed a tab. */
  let lastMatchReplica = null;

  function matchEvent(withScores) {
    const match = world.match;
    const caps = world.controlPoints.map((point) => {
      const capture = clamp(Math.round(point.capture * 100), -100, 100);
      return (capture + 100) * 4 + (point.owner & 3);
    });
    const event = [
      "m",
      Math.round(match.tickets[TEAM.BLUE]),
      Math.round(match.tickets[TEAM.RED]),
      Math.round(match.timeRemaining * 10),
      Math.max(0, STATE_BY_CODE.indexOf(match.state)),
      match.winner | 0,
      caps,
    ];
    if (withScores) {
      const scores = [];
      for (const peer of state.peers.values()) {
        scores.push(peer.uid, peer.kills, peer.deaths, peer.score);
      }
      if (ctx.player) {
        scores.push(myUid, ctx.player.state.kills, ctx.player.state.deaths, ctx.player.state.score);
      }
      event.push(scores);
    }
    return event;
  }

  function handleMatch(peer, event) {
    if (peer.id !== state.hostId) return;
    lastMatchReplica = event;
    applyMatch(event);
  }

  /**
   * Apply the host's match state.
   *
   * This runs in `update`, after world.update has already advanced its
   * own local simulation for the frame. That ordering is deliberate:
   * the local sim acts as prediction between the host's 2Hz messages,
   * and the replica overwrites it, so the clock and the tickets never
   * freeze between packets but never drift either.
   */
  function applyMatch(event) {
    const match = world.match;
    match.tickets[TEAM.BLUE] = event[1];
    match.tickets[TEAM.RED] = event[2];
    match.timeRemaining = event[3] / 10;
    match.state = STATE_BY_CODE[event[4]] || "playing";
    match.winner = event[5];
    const caps = event[6] || [];
    for (let i = 0; i < world.controlPoints.length && i < caps.length; i += 1) {
      const point = world.controlPoints[i];
      const packed = caps[i];
      const owner = packed & 3;
      const capture = (Math.floor(packed / 4) - 100) / 100;
      // Capture bars are eased rather than snapped: a bar that jumps
      // twice a second reads as a bug even when the number is right.
      point.capture = lerp(point.capture, capture, 0.5);
      point.owner = owner;
    }
    const scores = event[7];
    if (Array.isArray(scores)) {
      for (let i = 0; i + 3 < scores.length; i += 4) {
        if (scores[i] === myUid) continue;
        const peer = state.byUid.get(scores[i]);
        if (!peer) continue;
        peer.kills = scores[i + 1];
        peer.deaths = scores[i + 2];
        peer.score = scores[i + 3];
      }
    }
    ctx.bus.emit("net:match", {
      tickets: { blue: match.tickets[TEAM.BLUE], red: match.tickets[TEAM.RED] },
      timeRemaining: match.timeRemaining,
      state: match.state,
      winner: match.winner,
    });
  }

  /* ---------------------------- host migration ---------------------------- */

  function onHostChanged(hostId) {
    const wasHost = state.isHost;
    state.hostId = hostId;
    state.isHost = state.room ? state.room.isHost : false;
    if (state.isHost && !wasHost) {
      // Adopt the last replica we received and carry on. Net time is
      // already within a few ms of the departed host's, so keeping our
      // own offset keeps every interpolation buffer continuous - the
      // alternative, re-basing the timebase, makes every remote player
      // in the lobby jump at once.
      if (lastMatchReplica) applyMatch(lastMatchReplica);
      clock.target = clock.offset;
      matchTimer = MATCH_INTERVAL;
      for (const peer of state.peers.values()) {
        peer.shotBucket = 3;
        peer.shotBucketAt = netNow();
      }
    }
    if (!state.isHost) {
      // New host, new clock reference. Keep the old estimate as the
      // starting point and let the slew walk it in.
      clock.samples.length = 0;
      clock.pending.clear();
    }
    ctx.bus.emit("net:host", { hostId, isHost: state.isHost, migrated: wasHost !== state.isHost });
    ctx.bus.emit("net:status", statusPayload());
  }

  /* ------------------------------ link wiring ------------------------------ */

  function statusPayload() {
    return {
      status: state.status,
      online: state.online,
      code: state.code,
      isHost: state.isHost,
      peers: state.peers.size,
      ping: state.ping,
      error: state.error,
    };
  }

  function setStatus(status, detail) {
    state.status = status;
    if (detail !== undefined) state.error = detail;
    ctx.bus.emit("net:status", statusPayload());
  }

  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let intentionalLeave = false;

  function wireLink(link) {
    state.room = link;
    state.code = link.code;
    state.hostId = link.hostId;
    state.isHost = link.isHost;
    state.online = true;
    state.connecting = false;
    reconnectAttempt = 0;
    clock.have = link.isHost;
    if (link.isHost) {
      // The host defines the timebase: net time starts at zero when the
      // room opens, so every wire timestamp stays a small integer.
      clock.offset = -perfNow();
      clock.target = clock.offset;
    }
    seq = 0;
    epoch = 0;
    packetsSinceKeyframe = KEYFRAME_MAX_PACKETS;
    lastKeyframeAt = -99;
    nextSendAt = 0;
    localHistory.length = 0;
    bandwidth.windowStart = perfNow();

    link.on("players", (players) => {
      const live = new Set();
      for (const p of players) {
        if (!p || !p.id) continue;
        live.add(p.id);
        if (p.id === link.id) continue;
        const peer = ensurePeer(p.id, p);
        if (p.name) peer.name = p.name;
        if (p.uid && peer.uid !== p.uid) {
          if (state.byUid.get(peer.uid) === peer) state.byUid.delete(peer.uid);
          peer.uid = p.uid;
          state.byUid.set(p.uid, peer);
        }
        if (p.team) setPeerTeam(peer, p.team);
      }
      for (const id of Array.from(state.peers.keys())) {
        if (!live.has(id)) dropPeer(id, "left");
      }
      if (state.isHost) {
        packetsSinceKeyframe = KEYFRAME_MAX_PACKETS;
        lastKeyframeAt = -99;
      }
      ctx.bus.emit("net:status", statusPayload());
    });

    link.on("peerleave", (id) => dropPeer(typeof id === "string" ? id : id && id.id, "left"));
    link.on("host", (hostId) => onHostChanged(hostId));
    link.on("t", onTick);
    link.on("closed", () => {
      state.online = false;
      state.room = null;
      clearPeers("disconnected");
      if (intentionalLeave) {
        setStatus("offline", null);
        ctx.bus.emit("net:closed", { reason: "left" });
      } else {
        ctx.bus.emit("net:closed", { reason: "dropped" });
        scheduleReconnect();
      }
    });

    setStatus("connected", null);
    ctx.bus.emit("net:open", {
      code: link.code, isHost: link.isHost, uid: myUid, transport: link.kind,
    });

    // Announce ourselves. The host answers with a team and the match
    // state, which is what makes a late join a join and not a restart.
    queueEvent(["j", myUid, state.name, state.team]);
    if (link.isHost) queueEvent(matchEvent(true));
  }

  function scheduleReconnect() {
    if (intentionalLeave || !state.code) { setStatus("offline"); return; }
    if (reconnectAttempt >= RECONNECT_DELAYS.length) {
      setStatus("degraded", "Connection lost. Playing offline against bots.");
      ctx.bus.emit("net:degraded", { reason: "reconnect-failed" });
      return;
    }
    const wait = RECONNECT_DELAYS[reconnectAttempt];
    reconnectAttempt += 1;
    setStatus("reconnecting", `Reconnecting (${reconnectAttempt}/${RECONNECT_DELAYS.length})…`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      api.join(state.code).catch(() => {});
    }, wait * 1000);
  }

  /* ------------------------------- ghosts ------------------------------- */

  /**
   * Development-only synthetic senders. Each ghost owns its own link on
   * the loopback channel and pushes real, fully encoded snapshots, so
   * the probe can measure a genuine sixteen-player wire load without
   * booting sixteen copies of a Three.js FPS. They are unreachable
   * outside ?bsnet=loop.
   */
  const ghosts = [];
  function spawnGhosts(count, code) {
    if (!devTransport) return 0;
    const size = world.mapSize || 1024;
    for (let i = 0; i < count; i += 1) {
      const rng = makeRng((0x9e37 + i * 2654435761) >>> 0);
      const link = createLoopLink({
        code,
        name: `Ghost${i + 1}`,
        meta: { uid: `g${i.toString(36)}${rng.int(10, 35).toString(36)}`, team: i % 2 ? TEAM.RED : TEAM.BLUE },
        sim: { latency: options.latency, jitter: options.jitter, loss: options.loss },
      });
      ghosts.push({
        link,
        rng,
        seq: 0,
        epoch: 0,
        baseline: { ...ZERO_BASELINE },
        since: 999,
        lastKey: -99,
        next: 0,
        angle: rng.range(0, Math.PI * 2),
        radius: rng.range(size * 0.12, size * 0.42),
        centreX: rng.range(-size * 0.2, size * 0.2),
        centreZ: rng.range(-size * 0.2, size * 0.2),
        speed: rng.range(2.4, 5.6),
        team: i % 2 ? TEAM.RED : TEAM.BLUE,
        uid: `g${i.toString(36)}${rng.int(10, 35).toString(36)}`,
      });
    }
    return ghosts.length;
  }

  function updateGhosts(now, dt) {
    for (const ghost of ghosts) {
      ghost.angle += (ghost.speed / Math.max(1, ghost.radius)) * dt;
      const x = ghost.centreX + Math.cos(ghost.angle) * ghost.radius;
      const z = ghost.centreZ + Math.sin(ghost.angle) * ghost.radius;
      const y = ctx.terrain ? ctx.terrain.heightAt(x, z) : 0;

      // Ghosts obey the same relevance policy as a real client, so the
      // measured load is the load the policy actually produces.
      const distance = Math.hypot(x - ctx.player.position.x, z - ctx.player.position.z);
      const rate = distance < 60 ? RATE.NEAR : distance < 140 ? RATE.MID
        : distance < 260 ? RATE.FAR : RATE.IDLE;
      if (now < ghost.next) continue;
      ghost.next = Math.max(now, ghost.next + 1 / rate);

      const sample = {
        qx: Math.round(x * POS_SCALE),
        qy: Math.round(y * POS_SCALE),
        qz: Math.round(z * POS_SCALE),
        qyaw: ((Math.round((ghost.angle + Math.PI * 0.5) * YAW_SCALE) % YAW_STEPS) + YAW_STEPS) % YAW_STEPS,
        qpitch: 0,
        qspeed: Math.round(ghost.speed * SPEED_SCALE),
        flags: 8,
        health: 100,
      };
      const keyframe = ghost.since >= KEYFRAME_MAX_PACKETS || now - ghost.lastKey >= KEYFRAME_INTERVAL;
      if (keyframe) {
        ghost.epoch = (ghost.epoch + 1) & 3;
        ghost.baseline = { ...sample };
        ghost.since = 0;
        ghost.lastKey = now;
      } else ghost.since += 1;

      const { mask, values } = encodeSnapshot(sample, ghost.baseline, keyframe, ghost.epoch);
      ghost.seq = (ghost.seq + 1) & 0xffff;
      const payload = [ghost.seq, Math.round(netNow() * 1000), mask, values];
      if (keyframe) payload.push([["s", ghost.uid, `Ghost`, ghost.team, 60]]);
      ghost.link.send("t", payload);
    }
  }

  /* -------------------------------- update -------------------------------- */

  let statsTimer = 0;

  function update(dt) {
    if (!state.online || !state.room || !ctx.player) return;
    const now = perfNow();
    slewClock(dt);

    /* ---- clock sync ---- */
    if (!state.isHost && now - clock.lastPingAt >= PING_INTERVAL) {
      clock.lastPingAt = now;
      const token = (Math.random() * 0xffffff) | 0;
      clock.pending.set(token, now);
      if (clock.pending.size > 8) {
        const oldest = clock.pending.keys().next().value;
        clock.pending.delete(oldest);
      }
      queueEvent(["p", token]);
    }

    /* ---- match replication (host) ---- */
    if (state.isHost) {
      matchTimer += dt;
      if (matchTimer >= MATCH_INTERVAL) {
        matchTimer = 0;
        matchSends += 1;
        queueEvent(matchEvent(matchSends % SCORE_EVERY === 0));
      }
    }

    /* ---- send ---- */
    const rate = pickRate(now);
    if (now >= nextSendAt) {
      // Pace on wall time, not accumulated dt: a client running at 20fps
      // still owes the lobby 20 snapshots a second, and a client forced
      // through frames by the QA harness must not send 200.
      nextSendAt = Math.max(now, nextSendAt) + 1 / rate;
      if (nextSendAt < now) nextSendAt = now + 1 / rate;
      sendTick(now);
    } else if (outEvents.length && now >= nextSendAt - 0.001) {
      sendTick(now);
    }

    if (ghosts.length) updateGhosts(now, dt);

    /* ---- peers ---- */
    const netTime = netNow();
    for (const peer of state.peers.values()) {
      if (now - peer.lastSeen > PEER_TIMEOUT) {
        // A disconnect that never fired "peerleave" otherwise leaves a
        // statue standing on the objective.
        dropPeer(peer.id, "timeout");
        continue;
      }
      // The delay has to cover one send interval plus this peer's own
      // jitter plus a margin. Per peer, because one number for the
      // lobby either stutters for the worst link or over-delays the
      // player standing next to you for it.
      const want = clamp(
        peer.arrivalGap * 1.35 + peer.arrivalJitter * 2.2 + 0.02,
        INTERP_MIN, INTERP_MAX
      );
      peer.interpDelay = damp(peer.interpDelay, want, 1.4, dt);
      interpolatePeer(peer, dt, netTime);
    }
    state.interpDelay = viewDelay();

    /* ---- bandwidth window ---- */
    statsTimer += dt;
    if (statsTimer >= 1) {
      const span = Math.max(0.25, now - bandwidth.windowStart);
      bandwidth.up = bandwidth.upBytes / span;
      bandwidth.down = bandwidth.downBytes / span;
      bandwidth.upRate = bandwidth.upMsgs / span;
      bandwidth.downRate = bandwidth.downMsgs / span;
      bandwidth.peakDown = Math.max(bandwidth.peakDown, bandwidth.down);
      bandwidth.upBytes = 0; bandwidth.downBytes = 0;
      bandwidth.upMsgs = 0; bandwidth.downMsgs = 0;
      bandwidth.windowStart = now;
      statsTimer = 0;

      let lostTotal = 0;
      let spanTotal = 0;
      for (const peer of state.peers.values()) { lostTotal += peer.seqSeen; spanTotal += peer.seqSpan; }
      state.loss = spanTotal > 0 ? clamp01(1 - lostTotal / spanTotal) : 0;

      ctx.bus.emit("net:stats", {
        ping: state.ping,
        jitter: Math.round(state.jitter),
        loss: Number(state.loss.toFixed(3)),
        upBytesPerSec: Math.round(bandwidth.up),
        downBytesPerSec: Math.round(bandwidth.down),
        upMsgsPerSec: Number(bandwidth.upRate.toFixed(1)),
        downMsgsPerSec: Number(bandwidth.downRate.toFixed(1)),
        interpDelayMs: Math.round(state.interpDelay * 1000),
        sendHz: rate,
        peers: state.peers.size,
      });
    }
  }

  /* --------------------------- weapon plumbing --------------------------- */

  // weapons.js does not know about the network. Until it calls
  // reportShot directly it never will, so mirror its fire event: the
  // origin and aim are on ctx.player at emit time. The one thing this
  // loses is the per-shot cone deviation, which is why reportShot
  // takes precedence the moment anybody calls it.
  ctx.bus.on("weapon:fire", () => {
    if (!state.online || explicitShots || !ctx.player) return;
    const def = ctx.weapons ? ctx.weapons.state.def : null;
    emitShot(ctx.player.eyePosition, ctx.player.aimDirection, 600,
      def ? def.tracerEvery > 0 : false);
  });

  ctx.bus.on("player:death", () => {
    if (state.online) burstUntil = perfNow() + 1.5;
  });
  ctx.bus.on("player:respawn", () => {
    if (state.online) {
      burstUntil = perfNow() + 1.5;
      packetsSinceKeyframe = KEYFRAME_MAX_PACKETS;
      lastKeyframeAt = -99;
    }
  });

  /* -------------------------------- api -------------------------------- */

  function transportAvailable() {
    if (options.transport === "off") return false;
    if (devTransport) return typeof BroadcastChannel !== "undefined";
    return typeof window.RBNet !== "undefined" && typeof window.RBNet.available === "function"
      ? window.RBNet.available()
      : false;
  }

  async function openLink(mode, code) {
    if (!transportAvailable()) {
      state.error = "Online play is not configured.";
      setStatus("failed", state.error);
      ctx.bus.emit("net:error", { message: state.error, fatal: true });
      ctx.bus.emit("net:degraded", { reason: "unconfigured" });
      return null;
    }
    intentionalLeave = false;
    state.connecting = true;
    setStatus("connecting", null);

    try {
      let link;
      if (devTransport) {
        link = createLoopLink({
          code: code || options.room || "LOOP",
          name: state.name,
          meta: { uid: myUid, team: state.team },
          sim: { latency: options.latency, jitter: options.jitter, loss: options.loss },
        });
        // Loopback has no create/join distinction: the earliest
        // joinedAt wins the host election, exactly like RBNet presence.
        await new Promise((resolve) => setTimeout(resolve, 350));
      } else {
        const base = {
          game: "blacksand",
          name: state.name,
          maxPlayers: 16,
          meta: { uid: myUid, team: state.team, seed: ctx.seed, proto: PROTOCOL },
        };
        const room = mode === "host"
          ? await window.RBNet.createRoom({ ...base, visibility: "private" })
          : mode === "quick"
            ? await window.RBNet.quickJoin(base)
            : await window.RBNet.joinRoom({ ...base, code });
        link = wrapRbnetRoom(room);
      }
      wireLink(link);
      if (devTransport && options.ghosts > 0 && !ghosts.length) {
        spawnGhosts(options.ghosts, link.code);
      }
      return link;
    } catch (error) {
      state.connecting = false;
      state.error = (error && error.message) || String(error);
      setStatus("failed", state.error);
      ctx.bus.emit("net:error", { message: state.error, fatal: false });
      if (reconnectAttempt > 0) scheduleReconnect();
      return null;
    }
  }

  const api = {
    state,
    TEAM,
    PROTOCOL,

    get available() { return transportAvailable(); },
    get isHost() { return state.isHost; },
    get netTime() { return netNow(); },

    host() { return openLink("host"); },
    join(code) { return openLink("join", code); },
    quickMatch() { return openLink("quick"); },

    setName(name) {
      state.name = String(name || "Soldier").slice(0, 18);
      if (state.room) state.room.setMeta({ name: state.name });
    },

    leave() {
      intentionalLeave = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (state.room) state.room.leave();
      state.room = null;
      state.online = false;
      clearPeers("left");
      setStatus("offline", null);
    },

    reportShot,

    /** Kept for callers that resolved their own damage. The host still
     *  re-derives the number; this only says who was aimed at. */
    reportDamage(uid, amount, cause = "bullet") {
      if (!state.online) return;
      queueEvent(["h", uid, myUid, Math.round(amount * 10), 1, 0, cause]);
    },

    update,

    /* ----------------------------- QA hooks ----------------------------- */

    qa: {
      netTime: () => netNow(),
      clock: () => ({
        offset: Number(clock.offset.toFixed(4)),
        target: Number(clock.target.toFixed(4)),
        rtt: Number(clock.rtt.toFixed(4)),
        have: clock.have,
        samples: clock.samples.length,
      }),
      /** Where we told everyone we were at net time `t`. */
      positionAt(t) {
        const at = sampleAt(localHistory, t);
        return at.valid ? { x: at.x, y: at.y, z: at.z, clamped: at.clamped } : null;
      },
      /** What we are currently drawing for a peer, and at what instant. */
      peerView(uid) {
        const peer = state.byUid.get(uid);
        if (!peer) return null;
        return {
          uid,
          name: peer.name,
          position: [peer.position.x, peer.position.y, peer.position.z],
          viewTime: netNow() - peer.interpDelay,
          interpDelayMs: Math.round(peer.interpDelay * 1000),
          extrapolating: Number(peer.extrapolating.toFixed(2)),
          historyLength: peer.history.length,
          arrivalGapMs: Math.round(peer.arrivalGap * 1000),
          arrivalJitterMs: Math.round(peer.arrivalJitter * 1000),
          smoothErrorM: Number(peer.smoothError.length().toFixed(3)),
        };
      },
      peers() {
        return Array.from(state.peers.values()).map((p) => p.uid);
      },
      /** Fire at a peer's centre of mass as we currently see them. */
      fireAt(uid, aimAt = "chest") {
        const peer = state.byUid.get(uid);
        if (!peer || !ctx.player) return null;
        const box = HITBOXES.find((b) => b.name === aimAt) || HITBOXES[1];
        const target = new THREE.Vector3(
          peer.position.x + box.offset[0],
          peer.position.y + box.offset[1],
          peer.position.z + box.offset[2]
        );
        const origin = ctx.player.eyePosition;
        const dir = target.clone().sub(origin).normalize();
        const result = emitShot(origin, dir, 700, false);
        return result ? { hits: result.hits.length, viewTime: result.viewTime } : null;
      },
      setLagCompensation(on) { lagCompensation = Boolean(on); return lagCompensation; },
      hitStats: () => ({ ...hitStats, reasons: { ...hitStats.reasons } }),
      resetHitStats() {
        hitStats.claimed = 0; hitStats.accepted = 0; hitStats.rejected = 0;
        hitStats.reasons = {};
      },
      bandwidth: () => ({
        upBytesPerSec: Math.round(bandwidth.up),
        downBytesPerSec: Math.round(bandwidth.down),
        peakDownBytesPerSec: Math.round(bandwidth.peakDown),
        upMsgsPerSec: Number(bandwidth.upRate.toFixed(1)),
        downMsgsPerSec: Number(bandwidth.downRate.toFixed(1)),
        totalUp: bandwidth.totalUp,
        totalDown: bandwidth.totalDown,
        envelopeBytes: ENVELOPE_BYTES,
      }),
      ghosts: () => ghosts.length,
      /** Yank the transport out from under the game. */
      killLink() {
        if (state.room) {
          const link = state.room;
          state.room = null;
          state.online = false;
          link.leave();
        }
      },
    },

    report() {
      return {
        transport: state.room ? state.room.kind : (devTransport ? "loop" : "rbnet"),
        status: state.status,
        online: state.online,
        isHost: state.isHost,
        code: state.code,
        uid: myUid,
        team: state.team,
        peers: state.peers.size,
        ghosts: ghosts.length,
        ping: state.ping,
        jitter: Math.round(state.jitter),
        loss: Number(state.loss.toFixed(3)),
        interpDelayMs: Math.round(state.interpDelay * 1000),
        sendHz: currentRate,
        clockSynced: clock.have,
        upBytesPerSec: Math.round(bandwidth.up),
        downBytesPerSec: Math.round(bandwidth.down),
        upMsgsPerSec: Number(bandwidth.upRate.toFixed(1)),
        downMsgsPerSec: Number(bandwidth.downRate.toFixed(1)),
        sent: state.sent,
        received: state.received,
        dropped: state.dropped,
        hits: { ...hitStats, reasons: { ...hitStats.reasons } },
        error: state.error,
      };
    },

    dispose() {
      api.leave();
      for (const ghost of ghosts) ghost.link.leave();
      ghosts.length = 0;
    },
  };

  /* ---------------------------- auto connect ---------------------------- */

  // ?bsroom=CODE joins on boot. Only the loopback transport can honour
  // a caller-chosen code; RBNet mints its own, so the real transport is
  // driven from the lobby UI instead.
  if (options.room && transportAvailable()) {
    ctx.bus.once("game:ready", () => {
      openLink(devTransport ? "join" : "join", options.room).catch(() => {});
    });
  }

  setStatus("offline", null);
  return api;
}
