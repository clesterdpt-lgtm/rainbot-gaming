/*
 * Rainbot Multiplayer (RBNet + RBNetUI)
 * Online rooms for Rainbot games, powered by Supabase Realtime broadcast + presence.
 * No game server: peers exchange state through a channel named rbmp:{game}:{CODE}.
 *
 * Usage (game side):
 *   RBNetUI.open({
 *     game: "scrap-circuit", title: "SCRAP CIRCUIT ONLINE", accent: "#27e6ff",
 *     minPlayers: 2, maxPlayers: 6,
 *     playerTag: (meta) => meta.vehicle || "",
 *     getStartPayload: () => ({ arena: "junkyard", seed: 12345 }),
 *     onLobby: (room) => { ... },
 *     onStart: ({ room, players, slot, payload }) => { ... },
 *     onClose: () => { ... },
 *   });
 *
 * Room API: code, id, me, players, isHost, slot(), on(type, cb), send(type, data),
 *           sendTo(peerId, type, data), setMeta(patch), ping(peerId), leave().
 * Built-in room events: "players", "host", "peerleave", "closed".
 */
const RBNet = (() => {
  const SUPABASE_MODULE_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
  const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1
  const NAME_KEY = "rb-mp-name";

  let clientPromise = null;

  function config() {
    const raw = window.RB_SUPABASE_CONFIG || {};
    const url = String(raw.url || "").trim();
    const anonKey = String(raw.anonKey || "").trim();
    if (!raw.enabled || !url || !anonKey) return null;
    return { url, anonKey };
  }

  function available() {
    return !!config();
  }

  async function getClient() {
    const cfg = config();
    if (!cfg) throw new Error("Online play is not configured.");
    if (!clientPromise) {
      clientPromise = import(SUPABASE_MODULE_URL).then((supabase) =>
        supabase.createClient(cfg.url, cfg.anonKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "rb-mp-auth" },
          realtime: { params: { eventsPerSecond: 30 } },
        })
      );
    }
    return clientPromise;
  }

  function makeCode() {
    let out = "";
    for (let i = 0; i < 4; i++) out += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0];
    return out;
  }

  function makeId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function randomName() {
    const A = ["Slop", "Rizz", "Sigma", "Gyatt", "NPC", "Brain", "Skibidi", "Feast", "Turbo", "Mog"];
    const B = ["Lord", "Goblin", "Wizard", "Rat", "Boss", "Gamer", "Enjoyer", "Maxxer", "Unit", "Legend"];
    return A[(Math.random() * A.length) | 0] + B[(Math.random() * B.length) | 0] + ((Math.random() * 90 + 10) | 0);
  }

  function getSavedName() {
    try {
      return localStorage.getItem(NAME_KEY) || "";
    } catch (_) {
      return "";
    }
  }

  function saveName(name) {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch (_) {}
  }

  function sortPlayers(list) {
    return list.slice().sort((a, b) => (a.joinedAt - b.joinedAt) || (a.id < b.id ? -1 : 1));
  }

  class Room {
    constructor(channel, code, me) {
      this.channel = channel;
      this.code = code;
      this.id = me.id;
      this.me = me;
      this.players = [me];
      this.hostId = me.id;
      this.rtt = null;
      this.closed = false;
      this.visibility = "private";
      this.maxPlayers = 8;
      this._handlers = new Map();
      this._pingTimer = null;
      this._lastPingSent = 0;
      this._dir = null;      // directory channel while advertising a public room
      this._openDir = null;  // factory injected by RBNet (captures the client)
    }

    get isHost() {
      return this.hostId === this.id;
    }

    slot() {
      return Math.max(0, this.players.findIndex((p) => p.id === this.id));
    }

    player(peerId) {
      return this.players.find((p) => p.id === peerId) || null;
    }

    on(type, cb) {
      if (!this._handlers.has(type)) this._handlers.set(type, new Set());
      this._handlers.get(type).add(cb);
      return () => this._handlers.get(type)?.delete(cb);
    }

    _emit(type, data, from) {
      const set = this._handlers.get(type);
      if (set) set.forEach((cb) => {
        try {
          cb(data, from);
        } catch (err) {
          console.warn("[RBNet] handler error for", type, err);
        }
      });
    }

    send(type, data) {
      if (this.closed) return;
      this.channel.send({
        type: "broadcast",
        event: "msg",
        payload: { t: type, f: this.id, d: data },
      });
    }

    sendTo(peerId, type, data) {
      if (this.closed) return;
      this.channel.send({
        type: "broadcast",
        event: "msg",
        payload: { t: type, f: this.id, to: peerId, d: data },
      });
    }

    async setMeta(patch) {
      if (this.closed) return;
      this.me = { ...this.me, ...patch, id: this.id };
      const mine = this.players.findIndex((p) => p.id === this.id);
      if (mine >= 0) this.players[mine] = this.me;
      try {
        await this.channel.track(this.me);
      } catch (err) {
        console.warn("[RBNet] presence update failed", err);
      }
      this._refreshDir();
    }

    _syncPresence() {
      const state = this.channel.presenceState();
      const flat = [];
      Object.keys(state).forEach((key) => {
        const metas = state[key];
        if (metas && metas.length) flat.push({ ...metas[metas.length - 1] });
      });
      const prevIds = new Set(this.players.map((p) => p.id));
      this.players = sortPlayers(flat.filter((p) => p && p.id));
      const mine = this.players.find((p) => p.id === this.id);
      if (mine) this.me = mine;
      const newHost = this.players.length ? this.players[0].id : this.id;
      const hostChanged = newHost !== this.hostId;
      this.hostId = newHost;
      // adopt the room's visibility from the current host's meta (survives migration)
      const host = this.players[0];
      if (host && host.vis) this.visibility = host.vis === "pub" ? "public" : "private";
      this._emit("players", this.players);
      const nowIds = new Set(this.players.map((p) => p.id));
      prevIds.forEach((pid) => {
        if (!nowIds.has(pid) && pid !== this.id) this._emit("peerleave", pid);
      });
      if (hostChanged) this._emit("host", this.hostId);
      this._refreshDir();
    }

    // Public rooms advertise themselves on a per-game directory channel so
    // Quick Match can find them. Only the current host keeps the listing.
    async _refreshDir() {
      if (this.closed || this.visibility !== "public") return;
      const locked = !!(this.players[0] && this.players[0].locked);
      if (!this.isHost || locked || this.players.length >= this.maxPlayers) {
        if (this._dir) {
          const dir = this._dir;
          this._dir = null;
          try { dir.untrack(); } catch (_) {}
          try { dir.unsubscribe(); } catch (_) {}
        }
        return;
      }
      if (!this._dir && this._openDir) {
        try {
          this._dir = await this._openDir(this.code);
        } catch (_) {
          this._dir = null;
          return;
        }
        if (!this._dir) return;
      }
      if (this._dir) {
        try {
          await this._dir.track({ code: this.code, n: this.players.length, max: this.maxPlayers, at: Date.now() });
        } catch (_) {}
      }
    }

    _startPingLoop() {
      this._pingTimer = setInterval(() => {
        if (this.closed || this.players.length < 2) return;
        const other = this.players.find((p) => p.id !== this.id);
        if (!other) return;
        this._lastPingSent = performance.now();
        this.sendTo(other.id, "_ping", null);
      }, 5000);
    }

    _handleMsg(payload) {
      if (!payload || payload.f === this.id) return;
      if (payload.to && payload.to !== this.id) return;
      if (payload.t === "_ping") {
        this.sendTo(payload.f, "_pong", null);
        return;
      }
      if (payload.t === "_pong") {
        this.rtt = Math.round(performance.now() - this._lastPingSent);
        return;
      }
      this._emit(payload.t, payload.d, payload.f);
    }

    leave() {
      if (this.closed) return;
      this.closed = true;
      if (this._pingTimer) clearInterval(this._pingTimer);
      if (this._dir) {
        try { this._dir.untrack(); } catch (_) {}
        try { this._dir.unsubscribe(); } catch (_) {}
        this._dir = null;
      }
      try {
        this.channel.unsubscribe();
      } catch (_) {}
      this._emit("closed", null);
    }
  }

  async function openChannel(client, topic, me) {
    const channel = client.channel(topic, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: me.id },
      },
    });
    const room = new Room(channel, topic.split(":").pop(), me);
    channel.on("presence", { event: "sync" }, () => room._syncPresence());
    channel.on("broadcast", { event: "msg" }, ({ payload }) => room._handleMsg(payload));

    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Connection timed out."));
        }
      }, 10000);
      channel.subscribe((status) => {
        if (settled) return;
        if (status === "SUBSCRIBED") {
          settled = true;
          clearTimeout(timer);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          settled = true;
          clearTimeout(timer);
          reject(new Error("Could not reach the game server."));
        }
      });
    });

    // Channel drops after successful join surface as a "closed" room event.
    channel.subscribe((status) => {
      if (room.closed) return;
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        room.closed = true;
        if (room._pingTimer) clearInterval(room._pingTimer);
        room._emit("closed", null);
      }
    });
    return room;
  }

  // Presence sync after subscribe is not instant; wait briefly so we can see who's here.
  function waitForPresence(room, ms) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      room.on("players", () => {
        clearTimeout(t);
        setTimeout(resolve, 120); // allow one more sync tick to settle
      });
    });
  }

  // One directory channel per game holds a presence entry per open PUBLIC room
  // (tracked by that room's host, keyed by room code). Scanners subscribe
  // without tracking, read the state, and leave — invisible and serverless.
  function dirTopic(game) {
    return `rbmp-dir:${game}`;
  }

  function subscribeChannel(channel, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error("Connection timed out.")); }
      }, timeoutMs);
      channel.subscribe((status) => {
        if (settled) return;
        if (status === "SUBSCRIBED") {
          settled = true;
          clearTimeout(timer);
          resolve(channel);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          settled = true;
          clearTimeout(timer);
          reject(new Error("Could not reach the lobby directory."));
        }
      });
    });
  }

  function attachDirFactory(room, client, game) {
    room._openDir = async (code) => {
      const dir = client.channel(dirTopic(game), { config: { presence: { key: code } } });
      await subscribeChannel(dir);
      return dir;
    };
  }

  // Read the public-room listings for a game. Returns [{code, n, max, at}].
  async function listPublicRooms(game) {
    const client = await getClient();
    const scan = client.channel(dirTopic(game), { config: { presence: { key: "scan-" + makeId() } } });
    try {
      let sawSync = false;
      scan.on("presence", { event: "sync" }, () => { sawSync = true; });
      await subscribeChannel(scan, 6000);
      await new Promise((resolve) => {
        const started = Date.now();
        const poll = setInterval(() => {
          if (sawSync || Date.now() - started > 1400) {
            clearInterval(poll);
            setTimeout(resolve, 150);
          }
        }, 60);
      });
      const state = scan.presenceState();
      const rooms = [];
      Object.keys(state).forEach((key) => {
        const metas = state[key];
        const m = metas && metas[metas.length - 1];
        if (m && m.code && m.n < m.max) rooms.push({ code: m.code, n: m.n, max: m.max, at: m.at || 0 });
      });
      return rooms;
    } finally {
      try { scan.unsubscribe(); } catch (_) {}
    }
  }

  async function createRoom({ game, name, meta = {}, visibility = "private", maxPlayers = 8 }) {
    const client = await getClient();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      const me = {
        id: makeId(), name, joinedAt: Date.now(), ready: false,
        vis: visibility === "public" ? "pub" : "priv",
        ...meta,
      };
      const room = await openChannel(client, `rbmp:${game}:${code}`, me);
      room.visibility = visibility;
      room.maxPlayers = maxPlayers;
      attachDirFactory(room, client, game);
      await waitForPresence(room, 700);
      const others = room.players.filter((p) => p.id !== me.id);
      if (others.length) {
        room.leave(); // code collision, try another
        continue;
      }
      await room.setMeta({});
      room._syncPresence();
      return room;
    }
    throw new Error("Could not create a room. Try again.");
  }

  async function joinRoom({ game, code, name, maxPlayers = 8, meta = {} }) {
    const client = await getClient();
    const clean = String(code || "").trim().toUpperCase();
    if (!/^[A-Z2-9]{4}$/.test(clean)) throw new Error("Room codes are 4 letters.");
    const me = { id: makeId(), name, joinedAt: Date.now(), ready: false, ...meta };
    const room = await openChannel(client, `rbmp:${game}:${clean}`, me);
    room.maxPlayers = maxPlayers;
    attachDirFactory(room, client, game);
    await room.setMeta({});
    await waitForPresence(room, 1500);
    const others = room.players.filter((p) => p.id !== me.id);
    if (!others.length) {
      room.leave();
      throw new Error(`Room ${clean} not found.`);
    }
    const host = room.players[0];
    if (host && host.locked) {
      room.leave();
      throw new Error("That match already started.");
    }
    if (room.players.length > maxPlayers) {
      room.leave();
      throw new Error("That room is full.");
    }
    return room;
  }

  // Quick Match: join a random open public room; if none exist, become one.
  // onStatus(text) lets the UI narrate the search.
  async function quickJoin({ game, name, meta = {}, maxPlayers = 8, onStatus }) {
    const say = (t) => { if (onStatus) onStatus(t); };
    for (let round = 0; round < 2; round++) {
      say("Searching for a public lobby…");
      let rooms = [];
      try {
        rooms = await listPublicRooms(game);
      } catch (_) {
        rooms = [];
      }
      // shuffle so simultaneous seekers spread across rooms
      for (let i = rooms.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [rooms[i], rooms[j]] = [rooms[j], rooms[i]];
      }
      for (const entry of rooms.slice(0, 4)) {
        say(`Joining lobby ${entry.code}…`);
        try {
          return await joinRoom({ game, code: entry.code, name, maxPlayers, meta });
        } catch (_) {
          // full / started / vanished — try the next listing
        }
      }
      if (round === 0) {
        // brief random backoff so two empty-directory seekers don't both host
        await new Promise((r) => setTimeout(r, 250 + Math.random() * 650));
      }
    }
    say("No open lobbies — hosting a public one…");
    return createRoom({ game, name, meta, visibility: "public", maxPlayers });
  }

  return { available, createRoom, joinRoom, quickJoin, listPublicRooms, randomName, getSavedName, saveName };
})();

/* ---------------------------------------------------------------------------
 * RBNetUI — shared lobby overlay (host / join / roster / ready / countdown).
 * ------------------------------------------------------------------------- */
const RBNetUI = (() => {
  let styleInjected = false;
  let active = null;

  function injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    const css = `
.rbmp-overlay{position:fixed;inset:0;z-index:99990;display:flex;align-items:center;justify-content:center;background:rgba(4,6,14,.88);backdrop-filter:blur(4px);font-family:'Bungee',Impact,'Arial Black',sans-serif;color:#f4f7ff;}
.rbmp-panel{position:relative;width:min(480px,92vw);max-height:88vh;overflow:auto;background:linear-gradient(160deg,#101529,#0a0d1c);border:2px solid var(--rbmp-accent,#27e6ff);border-radius:18px;box-shadow:0 0 34px rgba(39,230,255,.28),0 18px 50px rgba(0,0,0,.6);padding:22px 22px 20px;}
.rbmp-title{font-size:19px;letter-spacing:.06em;margin:0 0 2px;color:var(--rbmp-accent,#27e6ff);text-shadow:0 0 14px rgba(39,230,255,.5);}
.rbmp-sub{font-family:'Trebuchet MS',system-ui,sans-serif;font-size:12px;opacity:.72;margin:0 0 16px;letter-spacing:.03em;}
.rbmp-close{position:absolute;top:10px;right:12px;background:none;border:none;color:#8b93ad;font:700 18px/1 system-ui;cursor:pointer;padding:6px;}
.rbmp-close:hover{color:#fff;}
.rbmp-label{display:block;font-size:10px;letter-spacing:.14em;opacity:.65;margin:14px 0 6px;}
.rbmp-input{width:100%;box-sizing:border-box;background:#070a16;border:1px solid #2b3352;border-radius:10px;color:#fff;font:700 16px/1.2 'Trebuchet MS',system-ui,sans-serif;padding:11px 12px;outline:none;letter-spacing:.04em;}
.rbmp-input:focus{border-color:var(--rbmp-accent,#27e6ff);}
.rbmp-input--code{text-transform:uppercase;font-family:'Bungee',Impact,sans-serif;font-size:20px;text-align:center;letter-spacing:.45em;}
.rbmp-row{display:flex;gap:10px;margin-top:14px;}
.rbmp-btn{flex:1;cursor:pointer;border:none;border-radius:12px;padding:13px 10px;font-family:'Bungee',Impact,sans-serif;font-size:14px;letter-spacing:.05em;color:#0b0e1c;background:var(--rbmp-accent,#27e6ff);box-shadow:0 4px 0 rgba(0,0,0,.45),0 0 18px rgba(39,230,255,.35);transition:transform .08s;}
.rbmp-btn:hover{transform:translateY(-1px);}
.rbmp-btn:disabled{opacity:.38;cursor:not-allowed;transform:none;}
.rbmp-btn--ghost{background:#1a2140;color:#dfe6ff;box-shadow:0 4px 0 rgba(0,0,0,.45);}
.rbmp-btn--warn{background:#ff2f6d;color:#fff;}
.rbmp-code{display:flex;align-items:center;justify-content:center;gap:12px;background:#070a16;border:1px dashed var(--rbmp-accent,#27e6ff);border-radius:12px;padding:12px;margin:4px 0 6px;}
.rbmp-code b{font-size:30px;letter-spacing:.4em;text-indent:.4em;color:var(--rbmp-accent,#27e6ff);text-shadow:0 0 16px rgba(39,230,255,.55);}
.rbmp-copy{background:#1a2140;border:none;border-radius:8px;color:#cdd6f4;font:700 11px/1 system-ui;padding:8px 10px;cursor:pointer;}
.rbmp-copy:hover{color:#fff;}
.rbmp-hint{font-family:'Trebuchet MS',system-ui,sans-serif;font-size:11.5px;opacity:.6;text-align:center;margin:2px 0 10px;}
.rbmp-list{list-style:none;margin:6px 0 4px;padding:0;display:flex;flex-direction:column;gap:7px;}
.rbmp-player{display:flex;align-items:center;gap:10px;background:#0d1226;border:1px solid #232b4d;border-radius:10px;padding:9px 12px;font-family:'Trebuchet MS',system-ui,sans-serif;font-size:14px;font-weight:700;}
.rbmp-player--me{border-color:var(--rbmp-accent,#27e6ff);}
.rbmp-player .rbmp-dot{width:9px;height:9px;border-radius:50%;background:#4a5372;flex:none;box-shadow:0 0 8px transparent;}
.rbmp-player.is-ready .rbmp-dot{background:#3dff8a;box-shadow:0 0 8px #3dff8a;}
.rbmp-player .rbmp-tag{margin-left:auto;font-size:11px;opacity:.75;letter-spacing:.04em;white-space:nowrap;}
.rbmp-player .rbmp-crown{font-size:12px;}
.rbmp-empty{opacity:.45;font-family:'Trebuchet MS',system-ui,sans-serif;font-size:12px;text-align:center;padding:10px 0;}
.rbmp-error{background:rgba(255,47,109,.12);border:1px solid rgba(255,47,109,.55);color:#ff9dbd;border-radius:10px;font-family:'Trebuchet MS',system-ui,sans-serif;font-size:12.5px;font-weight:700;padding:9px 12px;margin-top:12px;display:none;}
.rbmp-error.is-on{display:block;}
.rbmp-status{font-family:'Trebuchet MS',system-ui,sans-serif;font-size:12px;opacity:.7;text-align:center;margin-top:10px;min-height:16px;}
.rbmp-count{position:fixed;inset:0;z-index:99991;display:flex;align-items:center;justify-content:center;pointer-events:none;}
.rbmp-count b{font-family:'Bungee',Impact,sans-serif;font-size:120px;color:var(--rbmp-accent,#27e6ff);text-shadow:0 0 40px rgba(39,230,255,.8);animation:rbmpPop .9s ease-out;}
@keyframes rbmpPop{0%{transform:scale(1.7);opacity:0}22%{transform:scale(1);opacity:1}80%{opacity:1}100%{opacity:0}}
.rbmp-settings{margin-top:12px;}
@media (max-width:520px){.rbmp-panel{padding:16px 14px 14px}.rbmp-code b{font-size:24px}}
`;
    const tag = document.createElement("style");
    tag.id = "rbmp-styles";
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function el(tag, cls, html) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function open(opts) {
    injectStyles();
    close();

    const state = {
      opts,
      room: null,
      started: false,
      overlay: null,
      unsubs: [],
    };
    active = state;

    const overlay = el("div", "rbmp-overlay");
    overlay.style.setProperty("--rbmp-accent", opts.accent || "#27e6ff");
    const panel = el("div", "rbmp-panel");
    overlay.appendChild(panel);
    state.overlay = overlay;
    document.body.appendChild(overlay);

    const errBox = el("div", "rbmp-error");
    const showErr = (msg) => {
      errBox.textContent = msg;
      errBox.classList.add("is-on");
    };
    const clearErr = () => errBox.classList.remove("is-on");

    function teardownRoomHooks() {
      state.unsubs.forEach((fn) => fn && fn());
      state.unsubs = [];
    }

    function bail() {
      teardownRoomHooks();
      if (state.room) state.room.leave();
      state.room = null;
      close();
      if (opts.onClose) opts.onClose();
    }

    /* ------------------------- screen 1: host / join ------------------------ */
    function renderEntry(prefillErr) {
      teardownRoomHooks();
      if (state.room) {
        state.room.leave();
        state.room = null;
      }
      panel.innerHTML = "";
      panel.appendChild(el("h2", "rbmp-title", opts.title || "ONLINE MULTIPLAYER"));
      panel.appendChild(el("p", "rbmp-sub", "Jump into a public lobby, or host a private room and share the 4-letter code."));
      const closeBtn = el("button", "rbmp-close", "✕");
      closeBtn.onclick = bail;
      panel.appendChild(closeBtn);

      if (!RBNet.available()) {
        panel.appendChild(el("div", "rbmp-error is-on", "Online play is not configured on this site build."));
        return;
      }

      panel.appendChild(el("label", "rbmp-label", "YOUR NAME"));
      const nameInput = el("input", "rbmp-input");
      nameInput.maxLength = 18;
      nameInput.value = RBNet.getSavedName() || RBNet.randomName();
      panel.appendChild(nameInput);

      const quickRow = el("div", "rbmp-row");
      const quickBtn = el("button", "rbmp-btn", "⚡ QUICK MATCH");
      quickBtn.title = "Join a random public lobby — or open one if none exist";
      quickRow.appendChild(quickBtn);
      panel.appendChild(quickRow);
      panel.appendChild(el("div", "rbmp-hint", "Public: joins any open lobby, or opens one for randoms to find."));

      panel.appendChild(el("label", "rbmp-label", "PRIVATE — ROOM CODE"));
      const codeInput = el("input", "rbmp-input rbmp-input--code");
      codeInput.maxLength = 4;
      codeInput.placeholder = "····";
      codeInput.autocapitalize = "characters";
      codeInput.spellcheck = false;
      panel.appendChild(codeInput);

      const row = el("div", "rbmp-row");
      const hostBtn = el("button", "rbmp-btn rbmp-btn--ghost", "HOST PRIVATE");
      const joinBtn = el("button", "rbmp-btn rbmp-btn--ghost", "JOIN CODE");
      row.appendChild(hostBtn);
      row.appendChild(joinBtn);
      panel.appendChild(row);
      panel.appendChild(errBox);
      clearErr();
      if (prefillErr) showErr(prefillErr);
      const status = el("div", "rbmp-status", "");
      panel.appendChild(status);

      const myName = () => {
        const name = nameInput.value.trim() || RBNet.randomName();
        RBNet.saveName(name);
        return name;
      };

      async function go(kind) {
        clearErr();
        quickBtn.disabled = hostBtn.disabled = joinBtn.disabled = true;
        status.textContent = kind === "quick" ? "Searching for a public lobby…" : kind === "host" ? "Opening room…" : "Joining room…";
        try {
          const base = { game: opts.game, name: myName(), meta: opts.meta || {}, maxPlayers: opts.maxPlayers || 8 };
          state.room = kind === "quick"
            ? await RBNet.quickJoin({ ...base, onStatus: (t) => { status.textContent = t; } })
            : kind === "host"
              ? await RBNet.createRoom({ ...base, visibility: "private" })
              : await RBNet.joinRoom({ ...base, code: codeInput.value });
          renderLobby();
          if (opts.onLobby) opts.onLobby(state.room);
        } catch (err) {
          showErr(err.message || "Something went wrong.");
          quickBtn.disabled = hostBtn.disabled = joinBtn.disabled = false;
          status.textContent = "";
        }
      }

      quickBtn.onclick = () => go("quick");
      hostBtn.onclick = () => go("host");
      joinBtn.onclick = () => go("join");
      codeInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") go("join");
      });
      codeInput.addEventListener("input", () => {
        codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      });
    }

    /* ---------------------------- screen 2: lobby --------------------------- */
    function renderLobby() {
      teardownRoomHooks();
      const room = state.room;
      panel.innerHTML = "";
      panel.appendChild(el("h2", "rbmp-title", opts.title || "ONLINE MULTIPLAYER"));
      const closeBtn = el("button", "rbmp-close", "✕");
      closeBtn.onclick = bail;
      panel.appendChild(closeBtn);

      const codeBox = el("div", "rbmp-code");
      codeBox.appendChild(el("b", null, room.code));
      const copyBtn = el("button", "rbmp-copy", "COPY");
      copyBtn.onclick = () => {
        try {
          navigator.clipboard.writeText(room.code);
          copyBtn.textContent = "COPIED!";
          setTimeout(() => (copyBtn.textContent = "COPY"), 1400);
        } catch (_) {}
      };
      codeBox.appendChild(copyBtn);
      panel.appendChild(codeBox);
      const visBadge = el("div", "rbmp-hint", "");
      panel.appendChild(visBadge);

      const list = el("ul", "rbmp-list");
      panel.appendChild(list);

      let settingsWrap = null;
      if (opts.settingsEl) {
        settingsWrap = el("div", "rbmp-settings");
        settingsWrap.appendChild(opts.settingsEl);
        panel.appendChild(settingsWrap);
      }

      const row = el("div", "rbmp-row");
      const readyBtn = el("button", "rbmp-btn rbmp-btn--ghost", "READY UP");
      const startBtn = el("button", "rbmp-btn", "START");
      row.appendChild(readyBtn);
      row.appendChild(startBtn);
      panel.appendChild(row);
      panel.appendChild(errBox);
      clearErr();
      const status = el("div", "rbmp-status", "");
      panel.appendChild(status);

      const minPlayers = opts.minPlayers || 2;

      function repaint() {
        const players = room.players;
        visBadge.innerHTML = room.visibility === "public"
          ? "🌐 <b>PUBLIC LOBBY</b> — random players can join. Friends can also use the code."
          : "🔒 <b>PRIVATE ROOM</b> — friends: open this game → ONLINE → enter the code.";
        list.innerHTML = "";
        players.forEach((p) => {
          const li = el("li", "rbmp-player" + (p.ready || p.id === room.hostId ? " is-ready" : "") + (p.id === room.id ? " rbmp-player--me" : ""));
          li.appendChild(el("span", "rbmp-dot"));
          const nm = el("span", null, "");
          nm.textContent = p.name || "???";
          li.appendChild(nm);
          if (p.id === room.hostId) li.appendChild(el("span", "rbmp-crown", "👑"));
          const tagText = opts.playerTag ? opts.playerTag(p) : "";
          if (tagText) li.appendChild(el("span", "rbmp-tag", tagText));
          list.appendChild(li);
        });
        if (players.length < 2) list.appendChild(el("div", "rbmp-empty", "Waiting for players…"));

        const iAmHost = room.isHost;
        readyBtn.style.display = iAmHost ? "none" : "";
        startBtn.style.display = iAmHost ? "" : "none";
        if (settingsWrap) settingsWrap.style.display = iAmHost ? "" : "none";
        readyBtn.textContent = room.me.ready ? "UNREADY" : "READY UP";
        readyBtn.classList.toggle("rbmp-btn--ghost", !room.me.ready);
        const guests = players.filter((p) => p.id !== room.hostId);
        const allReady = guests.length > 0 && guests.every((p) => p.ready);
        startBtn.disabled = !(iAmHost && players.length >= minPlayers && allReady);
        if (iAmHost) {
          status.textContent = players.length < minPlayers
            ? `Need at least ${minPlayers} players.`
            : allReady ? "All ready — hit START!" : "Waiting for everyone to ready up…";
        } else {
          status.textContent = room.me.ready ? "Waiting for the host to start…" : "Hit READY when you're set.";
        }
      }

      readyBtn.onclick = () => {
        room.setMeta({ ready: !room.me.ready });
        repaint();
      };

      startBtn.onclick = () => {
        if (!room.isHost) return;
        let payload = {};
        try {
          payload = (opts.getStartPayload && opts.getStartPayload()) || {};
        } catch (err) {
          console.warn("[RBNetUI] getStartPayload failed", err);
        }
        payload.seed = payload.seed ?? ((Math.random() * 1e9) | 0);
        room.setMeta({ locked: true });
        room.send("_start", payload);
        beginCountdown(payload);
      };

      state.unsubs.push(room.on("players", repaint));
      state.unsubs.push(room.on("host", repaint));
      state.unsubs.push(room.on("_start", (payload) => beginCountdown(payload)));
      state.unsubs.push(
        room.on("closed", () => {
          if (state.started) return;
          renderEntry("Connection lost. Host a new room or rejoin.");
        })
      );
      repaint();
    }

    /* ------------------------------ countdown ------------------------------- */
    function beginCountdown(payload) {
      if (state.started) return;
      state.started = true;
      const room = state.room;
      teardownRoomHooks();
      panel.style.display = "none";

      const countEl = el("div", "rbmp-count");
      countEl.style.setProperty("--rbmp-accent", opts.accent || "#27e6ff");
      overlay.style.background = "rgba(4,6,14,.4)";
      overlay.appendChild(countEl);
      let n = 3;
      const tick = () => {
        if (n === 0) {
          const players = room.players.slice();
          const slot = room.slot();
          close();
          if (opts.onStart) opts.onStart({ room, players, slot, payload });
          return;
        }
        countEl.innerHTML = "";
        countEl.appendChild(el("b", null, String(n)));
        n--;
        setTimeout(tick, 900);
      };
      tick();
    }

    renderEntry();
    return {
      close: bail,
    };
  }

  function close() {
    if (active && active.overlay && active.overlay.parentNode) {
      active.overlay.parentNode.removeChild(active.overlay);
    }
    active = null;
  }

  return { open, close };
})();

window.RBNet = RBNet;
window.RBNetUI = RBNetUI;
