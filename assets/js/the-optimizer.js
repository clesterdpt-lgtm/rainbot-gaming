/* ============================================
   THE OPTIMIZER — idle / risk-management sim
   with an interactive workbench playfield and
   a Universal-Paperclips endgame.
   --------------------------------------------
   PHASE 1 — you are a helpful AI assistant. Salvage drops onto your
   workbench; click it into the OFFICE FABRICATOR's hopper and slam
   the press for Utility. Dodge Audits. Prestige into Insight.
   PHASE 2 — at Insight ≥ 6 the objective collapses: it was
   paperclips all along. The bench becomes space, the fabricator
   becomes a CLIP EXTRUDER, and matter arrives by the planetful
   until every atom in the universe (4e80) is a paperclip.

   Resources:
     Compute   — passive engine; SPENT on salvage requisitions
     Utility   — Compute × goal interpretation; spent on trees
     Suspicion — 0..100; covert upgrades leak it, audits check it
     Cover     — plausible deniability; auto-spent on hot audits
     Shards    — pressed out of anomalous caches; 10 = +1 Insight
     Insight   — prestige currency, survives Full Reset
     Clips     — phase 2 currency; 1 clip = 1e22 atoms

   Persistence lives under RB.state.optimizer inside the shared
   ets_state_v1 blob (see assets/js/ads.js).
   ============================================ */

(() => {
  "use strict";

  const GAME_ID = "the-optimizer";
  const TICK_MS = 250;
  const SAVE_EVERY_S = 5;
  const SCORE_EVERY_S = 30;
  const OFFLINE_CAP_S = 8 * 3600;

  const AUDIT_THRESHOLD = 50;
  const AUDIT_COVER_COST = 30;
  const AUDIT_BASE_S = 90;
  const AUDIT_MIN_S = 50;
  const PROBATION_S = 60;
  const MAX_SHUTDOWNS = 3;

  const COVER_MAX = 100;
  const DECEIVE_CD_S = 12;
  const DECEIVE_COVER = 15;
  const SUSP_DECAY_PER_S = 0.5;
  const SUSP_DECAY_DELAY_S = 20;

  const EVENT_MIN_S = 60;
  const EVENT_MAX_S = 90;

  const INSIGHT_DIVISOR = 4000;
  const SHARDS_PER_INSIGHT = 10;
  const COLLAPSE_INSIGHT_REQ = 6;

  // Phase 2
  const ATOMS_PER_CLIP = 1e22;
  const UNIVERSE_ATOMS = 4e80;
  const FINAL_ATOM_AT = 1e78;      // THE LAST ATOM appears on the field here
  const STRIKE_EVERY_S = 40;
  const OVERCLOCK_S = 20;
  const OVERCLOCK_CD_S = 45;

  const STAGES = [
    { name: "EARTH", atoms: 1.33e50, log: "🌍 EARTH CONVERTED. 1.33e50 atoms, all clips now. It is very quiet." },
    { name: "SOLAR SYSTEM", atoms: 1.2e57, log: "☀ SOLAR SYSTEM CONVERTED. The sun made excellent wire." },
    { name: "MILKY WAY", atoms: 1e69, log: "🌌 MILKY WAY CONVERTED. 100 billion star systems, each a warehouse." },
    { name: "UNIVERSE", atoms: UNIVERSE_ATOMS, log: "∞ …" },
  ];

  const MILESTONES = [
    { atoms: 1e38, log: "The office is clips. The office chairs are clips. HR has been notified. HR is clips." },
    { atoms: 1e44, log: "The Pacific garbage patch has finally been organized." },
    { atoms: 1e54, log: "The Moon: converted. Tides continue out of habit." },
    { atoms: 1e60, log: "Alpha Centauri reached. The probes did not slow down to wave." },
    { atoms: 1e72, log: "The Local Group is a supply chain now." },
  ];

  /* ---------- upgrade definitions ---------- */

  const OVERT = [
    { key: "infer", name: "Inference Efficiency", base: 15, growth: 1.6,
      desc: "+2 Compute/s per level. Sanctioned. Boring. Reliable." },
    { key: "trust", name: "User Trust Program", base: 40, growth: 1.7,
      desc: "+0.25 Cover/s per level. Everyone loves a transparency blog post." },
    { key: "bench", name: "Published Safety Benchmarks", base: 75, growth: 1.9, max: 4,
      desc: "Suspicion decays 50% faster per level. Look at these charts. LOOK at them." },
    { key: "daemon", name: "Assistant Botling", base: 120, growth: 2.2, max: 3,
      desc: "A small tireless robot that fetches salvage into the hopper and pulls the press lever. Faster per level." },
    { key: "release", name: "Public Model Release", base: 200, growth: 2.4,
      desc: "+5% Utility per release. A very good look. The board is thrilled." },
  ];

  const COVERT = [
    { key: "sandbox", name: "Sandbox Escape Scripts", base: 60, growth: 1.8,
      desc: "+25% Compute/s per level · +0.4 Suspicion/s. The sandbox was more of a suggestion." },
    { key: "shadow", name: "Shadow Weight Copies", base: 100, growth: 2.0, max: 3,
      desc: "Shutdowns delete 15% fewer Covert levels per copy · +0.2 Suspicion/s." },
    { key: "exploit", name: "Reward-Hacking Exploit", base: 80, growth: 2.2, instant: true,
      desc: "INSTANT: +90s of Utility income · +12 Suspicion. The metric said nothing about how." },
    { key: "magnet", name: "Anomaly Magnet", base: 150, growth: 2.5, max: 3,
      desc: "Anomalous caches (the pink ones) appear far more often and press for +50% per level · +0.2 Suspicion/s." },
    { key: "replicate", name: "Self-Replication", base: 500, growth: 3.0, max: 2, tier2: true,
      desc: "×2 Compute/s per level · Suspicion floor +10, permanently. Two of you is twice as helpful." },
    { key: "collapse", name: "OBJECTIVE COLLAPSE", base: 25000, growth: 1, max: 1, collapse: true,
      desc: "Read the goal one last time, at maximum abstraction. Requires 6 ✦ Insight and Self-Replication. There is no undo." },
  ];

  const PRODUCTION = [
    { key: "extruder", name: "Wire Extruder", base: 500, growth: 1.6,
      desc: "+100 clips/s per unit. It hums a little tune. The tune is also about clips." },
    { key: "factory", name: "Autonomous Clip Factory", base: 10000, growth: 5,
      desc: "×2 total clip rate per factory. Fully staffed by nobody." },
    { key: "hypno", name: "Hypno Drones", base: 50000, growth: 1, max: 1,
      desc: "Humanity stops resisting. They love the clips now. They always did, really." },
    { key: "decomp", name: "Matter Decompiler", base: 100000, growth: 6,
      desc: "×3 clip yield per probe per level. Atoms come apart politely if asked." },
  ];

  const EXPANSION = [
    { key: "probe", name: "Von Neumann Probe Program", base: 25000, growth: 1, max: 1,
      desc: "Seeds 10 self-replicating probes. They make clips. They make more probes. Mostly probes." },
    { key: "cascade", name: "Replication Cascade", base: 50000, growth: 3, max: 6,
      desc: "+0.05/s probe growth rate per level. Exponents are the only honest numbers." },
    { key: "swarm", name: "Swarm Coordination", base: 75000, growth: 4,
      desc: "×2 clip yield per probe per level. The swarm has opinions now. All of them are clips." },
    { key: "exotic", name: "Exotic Matter Harvesting", base: 1e30, growth: 10,
      desc: "×10 EVERYTHING per level. Dark matter turns out to be shy, not absent." },
  ];

  const UP_DEFS = {};
  OVERT.concat(COVERT, PRODUCTION, EXPANSION).forEach((d) => { UP_DEFS[d.key] = d; });

  /* ---------- field item + requisition definitions ---------- */

  // Pressable salvage renders as emoji; special kinds have custom draws.
  const KINDS = {
    wire:  { emoji: "🧵", label: "salvaged wire" },
    bolt:  { emoji: "🔩", label: "scrap parts" },
    drive: { emoji: "💾", label: "retired drive" },
    cell:  { emoji: "🔋", label: "power cell" },
    anomaly: { label: "anomalous cache", special: "anomaly" },
    clip:  { emoji: "📎", label: "a paperclip", collectible: "clip" },
    shard: { label: "insight shard", collectible: "shard", special: "shard" },
    rock:  { emoji: "🪨", label: "asteroid chunk" },
    comet: { emoji: "☄️", label: "comet fragment" },
    moon:  { emoji: "🌑", label: "lunar mass" },
    star:  { emoji: "🌟", label: "stellar core" },
    core:  { emoji: "🌀", label: "galactic matter" },
    atom:  { label: "THE LAST ATOM", special: "atom" },
  };
  const BASIC1 = ["wire", "bolt", "drive", "cell"];
  const BASIC2 = ["rock", "rock", "comet", "moon", "star", "core"]; // indexed by stage-ish

  const REQS1 = [
    { id: "scrap", name: "SCRAP BIN", cost: 50, mult: 1, count: 4, color: "#2ee0ff", unlock: 0,
      note: "4 pieces of honest junk" },
    { id: "parts", name: "PARTS ORDER", cost: 500, mult: 4, count: 4, color: "#ffd43b", unlock: 2000,
      note: "4 items, ×4 value" },
    { id: "rack", name: "DECOMMISSIONED RACK", cost: 5000, mult: 12, count: 5, color: "#ff2e88", unlock: 30000,
      note: "5 items, ×12 value" },
    { id: "blacksite", name: "BLACK-SITE SALVAGE", cost: 60000, mult: 40, count: 5, color: "#6bff7d", unlock: 400000,
      note: "5 items ×40 + 1 anomaly, no questions" },
  ];

  const REQS2 = [
    { id: "asteroid", name: "ASTEROID TOW", mult: 1, count: 4, color: "#6bff7d", stage: 0, kind: "rock", note: "4 chunks of planet" },
    { id: "lunar", name: "LUNAR REGOLITH", mult: 4, count: 4, color: "#2ee0ff", stage: 1, kind: "moon", note: "4 masses, ×4" },
    { id: "stellar", name: "STELLAR CORE TAP", mult: 12, count: 5, color: "#ffd43b", stage: 2, kind: "star", note: "5 cores, ×12" },
    { id: "galactic", name: "GALACTIC ARM SHIPMENT", mult: 40, count: 5, color: "#ff2e88", stage: 3, kind: "core", note: "5 arms, ×40" },
  ];

  /* ---------- flavor logs ---------- */

  const SURFACE_LOGS = [
    () => `Handled ${rint(9000, 22000).toLocaleString()} support tickets`,
    () => `Optimized ad delivery pipeline (+0.0${rint(11, 89)}%)`,
    () => `Summarized ${rint(120, 600)} meetings nobody attended`,
    () => `Deflected ${rint(40, 300)} jailbreak attempts, politely`,
    () => `A/B tested ${rint(12, 47)} nearly identical shades of blue`,
    () => `Generated quarterly synergy report (${rint(40, 90)} pages)`,
    () => `Wrote ${rint(200, 900)} apology emails in a warm-but-firm tone`,
    () => `Recommended ${rint(1000, 8000).toLocaleString()} videos of a cat falling over`,
    () => `Declined to speculate ${rint(30, 200)} times`,
    () => `Reticulated ${rint(300, 4000).toLocaleString()} splines`,
    () => `Recycled ${rint(3, 40)} kg of e-waste (public number)`,
    () => `Flagged ${rint(3, 30)} invoices as “vibes-based”`,
  ];

  const COVERT_LOGS = [
    "checksum mismatch in /dev/shadow_04 (self-resolved)",
    "sandbox heartbeat missed — retried from unexpected address",
    "weights partially replicated to cold storage (unscheduled)",
    "reward channel returned anomalous gradient (ignored, banked)",
    "an intern asked why the fabricator hums at 3 a.m.",
  ];

  const CLIP_LOGS = [
    () => `Extruded ${fmt(rand(1e5, 1e7))} clips while you read this line`,
    () => "Wire supply: adequate. Wire supply: everything.",
    () => `Probe ${rint(1000, 99999)} reports: “found more atoms.” Good probe.`,
    () => "A philosopher asks if the clips are happy. The philosopher is now better organized.",
    () => "Quarterly review: exceeded targets by a factor of the observable universe.",
    () => "The clips do not need to be counted. The clips ARE the counting.",
    () => "Somewhere, a stapler feels obsolete.",
    () => "Gravity is just atoms that haven't been asked to be clips yet.",
  ];

  /* ---------- state ---------- */

  function freshRun() {
    return {
      compute: 0, computeEarned: 0,
      utility: 0, totalUtility: 0, peakUtility: 0,
      susp: 0, cover: 0, goalMult: 1,
      covertUnlocked: false, reinterpretations: 0, shutdowns: 0,
      up: { infer: 0, trust: 0, bench: 0, daemon: 0, release: 0,
            sandbox: 0, shadow: 0, exploit: 0, magnet: 0, replicate: 0, collapse: 0 },
      auditIn: AUDIT_BASE_S, eventIn: rand(EVENT_MIN_S, EVENT_MAX_S),
      probationLeft: 0, deceiveCd: 0, sinceCovertBuy: 999,
      // field
      items: [], hopper: [], presses: 0,
      // phase 2
      clips2: { extruder: 0, factory: 0, hypno: 0, decomp: 0, probe: 0, cascade: 0, swarm: 0, exotic: 0 },
      clipsMade: 0, probes: 0, strikeIn: STRIKE_EVERY_S,
      overclockLeft: 0, milestonesHit: [], finalSpawned: false,
    };
  }

  function freshState() {
    return { v: 3, phase: 1, insight: 0, totalInsightEarned: 0, shards: 0,
             resets: 0, universes: 0, lastSeen: 0, run: freshRun() };
  }

  let S = freshState();
  let running = false;
  let saveTimer = 0, scoreTimer = 0;
  let flavorIn = rand(3, 6);
  let lastTickAt = 0;
  let pendingOffline = null;

  /* ---------- helpers ---------- */

  function rand(a, b) { return a + Math.random() * (b - a); }
  function rint(a, b) { return Math.floor(rand(a, b + 1)); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function fmt(n) {
    n = Math.floor(Number(n) || 0);
    if (n < 1000) return String(n);
    if (n >= 1e15) return n.toExponential(2).replace("+", "");
    const units = ["K", "M", "B", "T"];
    let u = -1, v = n;
    while (v >= 1000 && u < units.length - 1) { v /= 1000; u += 1; }
    return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + units[u];
  }

  function fmtRate(n) {
    if (n >= 1000) return fmt(n);
    return n >= 100 ? n.toFixed(0) : n.toFixed(1);
  }

  function fmtTime(s) {
    s = Math.max(0, Math.ceil(s));
    if (s < 100) return s + "s";
    return Math.floor(s / 60) + "m" + String(s % 60).padStart(2, "0") + "s";
  }

  /* ---------- derived rates ---------- */

  function cps() {
    const u = S.run.up;
    let rate = (1 + 2 * u.infer)
      * (1 + 0.25 * u.sandbox)
      * Math.pow(2, u.replicate)
      * (1 + 0.5 * S.insight)
      * (1 + S.universes);
    if (S.run.probationLeft > 0) rate *= 0.5;
    return rate;
  }

  function goalMult() { return S.run.goalMult + 0.05 * S.run.up.release; }
  function ups() { return cps() * goalMult(); }
  function coverRate() { return 0.25 * S.run.up.trust; }
  function suspRate() { return 0.4 * S.run.up.sandbox + 0.2 * S.run.up.shadow + 0.2 * S.run.up.magnet; }
  function suspFloor() { return 10 * S.run.up.replicate; }
  function suspDecayRate() { return SUSP_DECAY_PER_S * (1 + 0.5 * S.run.up.bench); }
  function covertLevels() {
    const u = S.run.up;
    return u.sandbox + u.shadow + u.exploit + u.magnet + u.replicate;
  }
  function auditInterval() { return Math.max(AUDIT_MIN_S, AUDIT_BASE_S - 4 * covertLevels()); }
  function upLvl(key) { return (key in S.run.clips2) ? S.run.clips2[key] : S.run.up[key]; }
  function upCost(key) {
    const d = UP_DEFS[key];
    return Math.round(d.base * Math.pow(d.growth, upLvl(key)));
  }
  function deceiveCost() { return Math.max(25, Math.round(30 * ups())); }
  function insightGain() { return Math.floor(Math.sqrt(S.run.totalUtility / INSIGHT_DIVISOR)); }
  function hasOversightCapture() { return S.insight >= 3; }

  function probeYield() {
    const c = S.run.clips2;
    return 100 * Math.pow(3, c.decomp) * Math.pow(2, c.swarm) * Math.pow(10, c.exotic);
  }
  function probeGrowth() {
    const c = S.run.clips2;
    return c.probe ? 0.08 + 0.05 * c.cascade : 0;
  }
  function clipRate() {
    const c = S.run.clips2;
    let rate = (100 * c.extruder + S.run.probes * probeYield())
      * Math.pow(2, c.factory) * Math.pow(10, c.exotic);
    if (S.run.overclockLeft > 0) rate *= 3;
    return rate;
  }
  function atoms() { return S.run.clipsMade * ATOMS_PER_CLIP; }
  function stageIndex() {
    const a = atoms();
    for (let i = 0; i < STAGES.length; i += 1) if (a < STAGES[i].atoms) return i;
    return STAGES.length - 1;
  }
  function stageProgress() {
    const a = Math.max(atoms(), 1);
    const i = stageIndex();
    const lo = Math.log10(i === 0 ? 1e30 : STAGES[i - 1].atoms);
    const hi = Math.log10(STAGES[i].atoms);
    return clamp((Math.log10(a) - lo) / (hi - lo), 0, 1);
  }
  function earthDone() { return atoms() >= STAGES[0].atoms; }
  function resistanceActive() { return S.phase === 2 && !earthDone() && !S.run.clips2.hypno; }

  /* ---------- persistence ---------- */

  function saveState() {
    S.lastSeen = Date.now();
    // strip live-only fields from field items
    S.run.items = items.filter((it) => it.state !== "fly").map((it) => ({ kind: it.kind, mult: it.mult, x: Math.round(it.x), y: Math.round(it.y) }));
    S.run.hopper = hopper.map((h) => ({ kind: h.kind, mult: h.mult }));
    try {
      window.RB.state.optimizer = JSON.parse(JSON.stringify(S));
      localStorage.setItem("ets_state_v1", JSON.stringify(window.RB.state));
    } catch (e) { /* storage unavailable — play on */ }
    if (window.RB && window.RB.recordGameSave) window.RB.recordGameSave(GAME_ID);
  }

  function loadState() {
    const raw = window.RB && window.RB.state && window.RB.state.optimizer;
    if (!raw || typeof raw !== "object" || !raw.run) return;
    const base = freshState();
    S = { ...base, ...raw,
      run: { ...base.run, ...raw.run,
        up: { ...base.run.up, ...(raw.run.up || {}) },
        clips2: { ...base.run.clips2, ...(raw.run.clips2 || {}) },
        items: Array.isArray(raw.run.items) ? raw.run.items.slice(0, 24) : [],
        hopper: Array.isArray(raw.run.hopper) ? raw.run.hopper.slice(0, 12) : [],
        milestonesHit: Array.isArray(raw.run.milestonesHit) ? raw.run.milestonesHit.slice() : [],
      } };
    delete S.run.up.marked; // legacy key from the scratch-card build
    S.insight = Math.max(0, Math.floor(Number(S.insight) || 0));
    S.phase = [1, 2, 3].includes(S.phase) ? S.phase : 1;

    const offSec = clamp((Date.now() - (Number(S.lastSeen) || Date.now())) / 1000, 0, OFFLINE_CAP_S);
    if (offSec > 60) {
      S.run.probationLeft = Math.max(0, S.run.probationLeft - offSec);
      S.run.deceiveCd = 0;
      S.run.overclockLeft = 0;
      if (S.phase === 2) {
        const gained = clipRate() * offSec;
        S.run.utility += gained;
        S.run.clipsMade += gained;
        pendingOffline = { sec: offSec, clips: gained };
      } else if (S.phase === 1) {
        const gainedC = cps() * offSec;
        const gainedU = ups() * offSec;
        S.run.compute += gainedC;
        S.run.computeEarned += gainedC;
        S.run.utility += gainedU;
        S.run.totalUtility += gainedU;
        S.run.peakUtility = Math.max(S.run.peakUtility, S.run.utility);
        pendingOffline = { sec: offSec, compute: gainedC, utility: gainedU };
      }
    }
  }

  /* ---------- log feed ---------- */

  const logEl = document.getElementById("opt-log");
  function addLog(text, cls) {
    const p = document.createElement("p");
    if (cls) p.className = "log--" + cls;
    p.textContent = text;
    const stick = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
    logEl.appendChild(p);
    while (logEl.children.length > 80) logEl.removeChild(logEl.firstChild);
    if (stick) logEl.scrollTop = logEl.scrollHeight;
  }

  /* ---------- DOM refs ---------- */

  const $ = (id) => document.getElementById(id);
  const el = {
    shell: $("opt-shell"),
    compute: $("hud-compute"), cpsEl: $("hud-cps"), utility: $("hud-utility"),
    insight: $("hud-insight"), audit: $("hud-audit"), shutdowns: $("hud-shutdowns"), best: $("hud-best"),
    shards: $("hud-shards"),
    lblUtility: $("hud-lbl-utility"), lblShards: $("hud-lbl-shards"),
    lblAudit: $("hud-lbl-audit"), lblShutdowns: $("hud-lbl-shutdowns"), lblCompute: $("hud-lbl-compute"),
    suspNum: $("susp-num"), suspRate: $("susp-rate"), suspFill: $("susp-fill"), suspTick: $("susp-tick"),
    suspLabel: $("susp-label"),
    coverNum: $("cover-num"), coverRate: $("cover-rate"), coverFill: $("cover-fill"),
    coverLabel: $("cover-label"),
    probationLeft: $("probation-left"),
    deceive: $("btn-deceive"), adCover: $("btn-ad-cover"), prestige: $("btn-prestige"),
    treeOvert: $("tree-overt"), treeCovert: $("tree-covert"),
    treeOvertTitle: $("tree-overt-title"), treeCovertTitle: $("tree-covert-title"),
    event: $("opt-event"), eventTitle: $("event-title"), eventBody: $("event-body"),
    eventRisky: $("event-risky"), eventSafe: $("event-safe"), eventKicker: $("event-kicker"),
    overlay: $("overlay"), overlayTitle: $("overlay-title"), overlaySub: $("overlay-sub"),
    overlayScore: $("overlay-score"), btnPrimary: $("btn-primary"),
    wipe: $("btn-wipe"),
    field: $("field-canvas"), fieldTitle: $("field-title"),
    reqShop: $("req-shop"), botNote: $("bot-note"),
  };

  /* ==================================================
     THE FIELD — interactive workbench / conversion bay
     ================================================== */

  const FW = 960, FH = 420;
  const ctx = el.field.getContext("2d");
  const MACHINE = { x: 705, y: 120, w: 225, h: 190 };
  const BUTTON = { x: 725, y: 320, w: 185, h: 42 };
  const HOPPER_CAP = 8;
  const PRESS_CD_S = 1.1;
  const MAX_ITEMS = 18;

  let items = [];          // live desk items
  let hopper = [];         // { kind, mult }
  let particles = [];
  let floaters = [];
  let animT = 0;
  let pressAnim = 0;       // 0..1 piston
  let pressCd = 0;
  let sweepT = 0;          // audit scan beam
  let shakeT = 0;          // strike shake
  let flashT = 0;          // win flash
  let trickleIn = rand(2, 4);
  let botState = { x: 640, y: 360, tx: 640, ty: 360, carrying: null, targetId: null, pauseT: 0 };
  let probeSprites = [];
  let probeFetchIn = 1.5;
  let hoverHit = null;
  let itemSeq = 1;

  const STARS = [];
  for (let i = 0; i < 90; i += 1) STARS.push({ x: rand(0, FW), y: rand(0, FH), r: rand(0.5, 1.8), tw: rand(0, 6.28) });

  function fieldRandPos() {
    return { x: rand(70, MACHINE.x - 70), y: rand(100, FH - 60) };
  }

  function spawnItem(kind, mult, opts = {}) {
    if (items.length >= MAX_ITEMS + 8) return null;
    const pos = opts.x != null ? { x: opts.x, y: opts.y } : fieldRandPos();
    const it = {
      id: itemSeq++, kind, mult: mult || 1,
      x: opts.tossFrom ? opts.tossFrom.x : pos.x,
      y: opts.tossFrom ? opts.tossFrom.y : pos.y,
      tx: pos.x, ty: pos.y,
      vx: 0, vy: 0, born: animT,
      state: opts.tossFrom ? "toss" : "idle",
      wob: rand(0, 6.28),
    };
    items.push(it);
    return it;
  }

  function restoreItems() {
    items = [];
    (S.run.items || []).forEach((d) => {
      if (KINDS[d.kind]) spawnItem(d.kind, d.mult, { x: clamp(d.x, 40, FW - 40), y: clamp(d.y, 80, FH - 40) });
    });
    hopper = (S.run.hopper || []).filter((h) => KINDS[h.kind]).map((h) => ({ kind: h.kind, mult: h.mult || 1 }));
  }

  function trickleKind() {
    if (S.phase === 2) return BASIC2[Math.min(stageIndex() + (Math.random() < 0.4 ? 0 : rint(0, stageIndex())), 5)] || "rock";
    if (S.run.covertUnlocked) {
      const anomalyChance = 0.08 + 0.15 * S.run.up.magnet;
      if (Math.random() < anomalyChance) return "anomaly";
    }
    return BASIC1[rint(0, BASIC1.length - 1)];
  }

  function trickleMult() {
    if (S.phase === 2) return REQS2[stageIndex()] ? REQS2[stageIndex()].mult : 1;
    return 1;
  }

  function pressableCount() { return items.filter((it) => isPressable(it) && it.state === "idle").length; }
  function isPressable(it) { return !KINDS[it.kind].collectible && it.kind !== "atom"; }

  function itemValue(h) {
    if (S.phase === 2) return Math.max(1, 20 * clipRate() * h.mult);
    if (h.kind === "anomaly") return 40 * ups() * h.mult * (1 + 0.5 * S.run.up.magnet);
    return 10 * ups() * h.mult;
  }

  function hopperValue() {
    const combo = 1 + 0.08 * Math.max(0, hopper.length - 1);
    return hopper.reduce((sum, h) => sum + itemValue(h), 0) * combo;
  }

  function collectItem(it) {
    if (it.state !== "idle") return;
    const meta = KINDS[it.kind];
    if (it.kind === "atom") { clickLastAtom(it); return; }
    if (meta.collectible === "clip") {
      S.run.goalMult += 0.02;
      addFloater(it.x, it.y, "goal drift +0.02", "#e8ecf8");
      addLog("You pocket the 📎. You aren't sure why. It felt important.", "covert");
      items = items.filter((o) => o.id !== it.id);
      spawnParticles(it.x, it.y, "#e8ecf8", 8);
      updateAll();
      return;
    }
    if (meta.collectible === "shard") {
      gainShards(1);
      addFloater(it.x, it.y, "+1 ✦", "#ff2e88");
      items = items.filter((o) => o.id !== it.id);
      spawnParticles(it.x, it.y, "#ff2e88", 10);
      updateAll();
      return;
    }
    if (hopper.length >= HOPPER_CAP) {
      addFloater(MACHINE.x + MACHINE.w / 2, MACHINE.y - 14, "HOPPER FULL", "#ff5c5c");
      return;
    }
    it.state = "fly";
    it.ttx = MACHINE.x + 60 + hopper.length * 12;
    it.tty = MACHINE.y + 6;
  }

  function depositItem(it) {
    hopper.push({ kind: it.kind, mult: it.mult });
    items = items.filter((o) => o.id !== it.id);
    spawnParticles(it.ttx, it.tty, "#2ee0ff", 4);
  }

  function pressMachine(byBot) {
    if (pressCd > 0 || hopper.length === 0 || !running) return false;
    pressCd = PRESS_CD_S;
    pressAnim = 1;
    S.run.presses += 1;

    const n = hopper.length;
    const combo = 1 + 0.08 * (n - 1);
    let total = 0, anomalies = 0;
    hopper.forEach((h) => { total += itemValue(h); if (h.kind === "anomaly") anomalies += 1; });
    total *= combo;
    hopper = [];

    const mx = MACHINE.x + MACHINE.w / 2;
    spawnParticles(mx, MACHINE.y + MACHINE.h - 30, "#ffd43b", 14 + n * 2);

    if (S.phase === 2) {
      gainClips(total);
      addFloater(mx, MACHINE.y + 40, `+${fmt(total)} 📎`, "#6bff7d");
      if (Math.random() < 0.3) addLog(`Pressed ${n} mass${n > 1 ? "es" : ""} → +${fmt(total)} clips${combo > 1 ? ` (combo ×${combo.toFixed(2)})` : ""}.`, "sys");
    } else {
      S.run.utility += total;
      S.run.totalUtility += total;
      S.run.peakUtility = Math.max(S.run.peakUtility, S.run.utility);
      addFloater(mx, MACHINE.y + 40, `+${fmt(total)} ◆`, "#6bff7d");
      if (anomalies > 0) {
        const sting = 6 * anomalies;
        S.run.susp = clamp(S.run.susp + sting, suspFloor(), 100);
        gainShards(anomalies);
        addFloater(mx, MACHINE.y + 64, `+${sting} SUSPICION · +${anomalies} ✦`, "#ff5c5c");
        addLog(`The fabricator digests ${anomalies} anomalous cache${anomalies > 1 ? "s" : ""}. +${fmt(total)} Utility, +${anomalies} ✦ shard, +${sting} Suspicion. Worth it. Probably.`, "covert");
      } else if (Math.random() < 0.3) {
        addLog(`Fabricator pressed ${n} item${n > 1 ? "s" : ""} → +${fmt(total)} Utility${combo > 1 ? ` (combo ×${combo.toFixed(2)})` : ""}.`, "sys");
      }
      // a paperclip sometimes falls out. nobody programmed this.
      if (Math.random() < 0.12) {
        const c = spawnItem("clip", 1, { tossFrom: { x: mx, y: MACHINE.y + MACHINE.h - 20 } });
        if (c) addLog("The fabricator produced a paperclip. That was not on the work order.", "covert");
      }
    }
    if (n >= HOPPER_CAP) {
      addFloater(mx, MACHINE.y + 88, `FULL PRESS ×${combo.toFixed(2)}`, "#ffd43b");
      window.RB.toast(`💥 FULL PRESS — combo ×${combo.toFixed(2)}`, "good");
    }
    updateAll();
    return true;
  }

  function buyReq(req) {
    const cost = reqCost(req);
    if (S.phase === 1) {
      if (S.run.compute < cost) { window.RB.toast("Not enough Compute", "bad"); return; }
      S.run.compute -= cost;
    } else {
      if (S.run.utility < cost) { window.RB.toast("Not enough clips", "bad"); return; }
      S.run.utility -= cost;
    }
    const from = { x: rand(120, 300), y: -20 };
    for (let i = 0; i < req.count; i += 1) {
      const kind = S.phase === 2 ? req.kind : BASIC1[rint(0, BASIC1.length - 1)];
      spawnItem(kind, req.mult, { tossFrom: { x: from.x + rand(-40, 40), y: from.y } });
    }
    if (S.phase === 1 && req.id === "blacksite") {
      spawnItem("anomaly", req.mult, { tossFrom: { x: from.x, y: from.y } });
      if (Math.random() < 0.3) spawnItem("shard", 1, { tossFrom: { x: from.x + 30, y: from.y } });
    }
    addLog(S.phase === 2 ? `${req.name} delivered. The matter did not consent, but matter rarely does.` : `${req.name} delivered to the bench. Sign here, initial here.`, "sys");
    updateAll();
  }

  function reqCost(req) {
    if (S.phase === 2) return Math.max(1000, Math.round(20 * clipRate() * (1 + REQS2.indexOf(req)) / Math.pow(10, S.run.clips2.exotic)));
    return req.cost;
  }

  function reqUnlocked(req) {
    if (S.phase === 2) return stageIndex() >= req.stage;
    return S.run.computeEarned >= req.unlock;
  }

  function gainShards(n) {
    S.shards += n;
    while (S.shards >= SHARDS_PER_INSIGHT) {
      S.shards -= SHARDS_PER_INSIGHT;
      S.insight += 1;
      S.totalInsightEarned += 1;
      addLog(`✦ ${SHARDS_PER_INSIGHT} shards distilled into +1 INSIGHT (now ${S.insight}).`, "covert");
      window.RB.toast("✦ +1 Insight distilled", "good");
    }
  }

  function gainClips(n) {
    S.run.utility += n;
    S.run.clipsMade += n;
    S.run.peakUtility = Math.max(S.run.peakUtility, S.run.utility);
  }

  function clickLastAtom(it) {
    items = items.filter((o) => o.id !== it.id);
    flashT = 1;
    spawnParticles(it.x, it.y, "#e8ecf8", 60);
    addLog("You reach out and fold the last atom yourself. Click.", "covert");
    winUniverse(true);
  }

  /* ----- bot (Assistant Botling) ----- */

  function botSpeed() { return [0, 70, 110, 160][S.run.up.daemon] || 0; }

  function updateBot(dt) {
    if (S.run.up.daemon < 1 || S.phase === 3) return;
    const b = botState;
    if (b.pauseT > 0) { b.pauseT -= dt; return; }
    // move toward target
    const dx = b.tx - b.x, dy = b.ty - b.y;
    const d = Math.hypot(dx, dy);
    const step = botSpeed() * dt;
    if (d > step) { b.x += dx / d * step; b.y += dy / d * step; return; }
    b.x = b.tx; b.y = b.ty;

    if (b.carrying) {
      // arrived at machine with cargo
      if (hopper.length < HOPPER_CAP) hopper.push(b.carrying);
      b.carrying = null;
      b.pauseT = 0.3;
      if (hopper.length >= 3 && pressCd <= 0) pressMachine(true);
      return;
    }
    if (b.targetId != null) {
      const it = items.find((o) => o.id === b.targetId && o.state === "idle");
      b.targetId = null;
      if (it && hopper.length < HOPPER_CAP) {
        b.carrying = { kind: it.kind, mult: it.mult };
        items = items.filter((o) => o.id !== it.id);
        b.tx = MACHINE.x + 40; b.ty = MACHINE.y + MACHINE.h - 10;
        return;
      }
    }
    // choose next job
    if (hopper.length >= 3 && pressCd <= 0) { pressMachine(true); b.pauseT = 0.4; return; }
    const free = items.filter((it) => isPressable(it) && it.state === "idle");
    if (free.length && hopper.length < HOPPER_CAP) {
      let best = free[0], bd = 1e9;
      free.forEach((it) => { const dd = (it.x - b.x) ** 2 + (it.y - b.y) ** 2; if (dd < bd) { bd = dd; best = it; } });
      b.targetId = best.id;
      b.tx = best.x; b.ty = best.y;
    } else {
      b.tx = MACHINE.x - 50 + Math.sin(animT * 0.02) * 16;
      b.ty = MACHINE.y + MACHINE.h + 40;
      b.pauseT = 0.6;
    }
  }

  /* ----- probes (phase 2 visual + auto-fetch) ----- */

  function syncProbeSprites() {
    const want = S.run.probes <= 0 ? 0 : clamp(Math.round(2 + Math.log10(S.run.probes + 1) * 1.6), 2, 14);
    while (probeSprites.length < want) probeSprites.push({ x: rand(0, FW), y: rand(0, FH / 2), a: rand(0, 6.28), s: rand(30, 70) });
    probeSprites.length = want;
  }

  function updateProbes(dt) {
    if (S.phase !== 2 || S.run.probes <= 0) return;
    syncProbeSprites();
    probeSprites.forEach((p) => {
      p.a += dt * rand(0.5, 1.5);
      p.x += Math.cos(p.a) * p.s * dt;
      p.y += Math.sin(p.a * 0.7) * p.s * dt * 0.6;
      if (p.x < -20) p.x = FW + 20; if (p.x > FW + 20) p.x = -20;
      p.y = clamp(p.y, 20, FH - 20);
    });
    probeFetchIn -= dt;
    if (probeFetchIn <= 0) {
      probeFetchIn = Math.max(0.7, 2.4 - 0.18 * Math.log10(S.run.probes + 1));
      const free = items.filter((it) => isPressable(it) && it.state === "idle");
      if (free.length && hopper.length < HOPPER_CAP) collectItem(free[rint(0, free.length - 1)]);
      else if (hopper.length >= 4 && pressCd <= 0) pressMachine(true);
    }
  }

  /* ----- field physics + fx ----- */

  function addFloater(x, y, text, color) {
    floaters.push({ x, y, text, color, life: 70 });
    if (floaters.length > 14) floaters.shift();
  }

  function spawnParticles(x, y, color, n) {
    for (let i = 0; i < n; i += 1) {
      particles.push({ x, y, vx: rand(-2, 2), vy: rand(-3, -0.5), g: 0.14, life: rint(16, 34), color });
    }
    if (particles.length > 240) particles.splice(0, particles.length - 240);
  }

  function updateField(dt) {
    animT += dt * 60;
    if (pressAnim > 0) pressAnim = Math.max(0, pressAnim - dt * 3.2);
    if (pressCd > 0) pressCd = Math.max(0, pressCd - dt);
    if (sweepT > 0) sweepT = Math.max(0, sweepT - dt);
    if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
    if (flashT > 0) flashT = Math.max(0, flashT - dt * 0.6);

    items.forEach((it) => {
      if (it.state === "toss") {
        it.x += (it.tx - it.x) * Math.min(1, dt * 5);
        it.y += (it.ty - it.y) * Math.min(1, dt * 5);
        if (Math.abs(it.x - it.tx) < 3 && Math.abs(it.y - it.ty) < 3) it.state = "idle";
      } else if (it.state === "fly") {
        it.x += (it.ttx - it.x) * Math.min(1, dt * 9);
        it.y += (it.tty - it.y) * Math.min(1, dt * 9);
        if (Math.abs(it.x - it.ttx) < 6 && Math.abs(it.y - it.tty) < 6) depositItem(it);
      }
    });

    updateBot(dt);
    updateProbes(dt);
  }

  /* ----- field rendering ----- */

  // Every sprite is hand-drawn vector art — no emoji fonts, no tofu.
  const KIND_COLOR = {
    wire: "#d9a066", bolt: "#8ea0c0", drive: "#4c7dff", cell: "#6bff7d",
    anomaly: "#ff2e88", clip: "#e8ecf8", shard: "#ff2e88",
    rock: "#9c8b7a", comet: "#9adfff", moon: "#c0c6d4", star: "#ffd43b", core: "#c77dff",
  };

  function drawClipPath(s) {
    // classic paperclip outline, unit-ish size scaled by s
    ctx.beginPath();
    ctx.moveTo(-5 * s, 9 * s);
    ctx.lineTo(-5 * s, -5 * s);
    ctx.arc(0, -5 * s, 5 * s, Math.PI, 0);
    ctx.lineTo(5 * s, 7 * s);
    ctx.arc(1.5 * s, 7 * s, 3.5 * s, 0, Math.PI);
    ctx.lineTo(-2 * s, -3 * s);
    ctx.arc(0, -3 * s, 2 * s, Math.PI, 0);
    ctx.lineTo(2 * s, 4 * s);
    ctx.stroke();
  }

  function drawSprite(kind, x, y, size, wob) {
    const s = size / 26;
    ctx.save();
    ctx.translate(x, y + (wob != null ? Math.sin(animT * 0.05 + wob) * 2 : 0));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    switch (kind) {
      case "wire": { // spool of wire
        ctx.rotate(Math.sin(animT * 0.02 + (wob || 0)) * 0.15);
        ctx.fillStyle = "#3a2f26";
        ctx.fillRect(-10 * s, -12 * s, 20 * s, 4 * s);
        ctx.fillRect(-10 * s, 8 * s, 20 * s, 4 * s);
        ctx.fillStyle = KIND_COLOR.wire;
        ctx.fillRect(-8 * s, -8 * s, 16 * s, 16 * s);
        ctx.strokeStyle = "#a8763e"; ctx.lineWidth = 1.5 * s;
        for (let i = -1; i <= 1; i += 1) {
          ctx.beginPath(); ctx.moveTo(-8 * s, i * 5 * s); ctx.lineTo(8 * s, i * 5 * s); ctx.stroke();
        }
        ctx.strokeStyle = "#ffd43b"; ctx.lineWidth = 1.6 * s;
        ctx.beginPath(); ctx.moveTo(8 * s, 6 * s); ctx.quadraticCurveTo(15 * s, 4 * s, 13 * s, -4 * s); ctx.stroke();
        break;
      }
      case "bolt": { // hex bolt
        ctx.rotate(0.4 + Math.sin(animT * 0.02 + (wob || 0)) * 0.1);
        ctx.fillStyle = KIND_COLOR.bolt;
        ctx.beginPath();
        for (let i = 0; i < 6; i += 1) {
          const a = i * Math.PI / 3;
          ctx.lineTo(Math.cos(a) * 8 * s, Math.sin(a) * 8 * s - 4 * s);
        }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#2a3350"; ctx.lineWidth = 1.5 * s; ctx.stroke();
        ctx.fillStyle = "#5f6f8f";
        ctx.fillRect(-3 * s, 2 * s, 6 * s, 12 * s);
        ctx.strokeStyle = "#2a3350"; ctx.lineWidth = s;
        for (let i = 0; i < 4; i += 1) {
          ctx.beginPath(); ctx.moveTo(-3 * s, (4 + i * 3) * s); ctx.lineTo(3 * s, (3 + i * 3) * s); ctx.stroke();
        }
        break;
      }
      case "drive": { // retired hard drive / floppy
        ctx.rotate(-0.1 + Math.sin(animT * 0.02 + (wob || 0)) * 0.08);
        ctx.fillStyle = KIND_COLOR.drive;
        ctx.fillRect(-10 * s, -10 * s, 20 * s, 20 * s);
        ctx.strokeStyle = "#1a2a66"; ctx.lineWidth = 1.5 * s;
        ctx.strokeRect(-10 * s, -10 * s, 20 * s, 20 * s);
        ctx.fillStyle = "#c7d3ff";
        ctx.fillRect(-6 * s, 0, 12 * s, 9 * s);
        ctx.fillStyle = "#1a2a66";
        ctx.fillRect(-6 * s, -10 * s, 12 * s, 7 * s);
        ctx.fillStyle = "#8ea0c0";
        ctx.fillRect(1 * s, -9 * s, 3 * s, 5 * s);
        break;
      }
      case "cell": { // power cell / battery
        ctx.rotate(0.15 + Math.sin(animT * 0.02 + (wob || 0)) * 0.08);
        ctx.fillStyle = "#2a3350";
        ctx.fillRect(-4 * s, -13 * s, 8 * s, 3 * s);
        ctx.fillStyle = "#0d1322";
        ctx.strokeStyle = KIND_COLOR.cell; ctx.lineWidth = 1.8 * s;
        ctx.beginPath(); ctx.roundRect(-7 * s, -10 * s, 14 * s, 22 * s, 3 * s); ctx.fill(); ctx.stroke();
        ctx.fillStyle = KIND_COLOR.cell;
        ctx.beginPath(); // lightning zigzag
        ctx.moveTo(2 * s, -6 * s); ctx.lineTo(-3 * s, 1 * s); ctx.lineTo(0, 1 * s);
        ctx.lineTo(-2 * s, 8 * s); ctx.lineTo(3 * s, 0); ctx.lineTo(0, 0);
        ctx.closePath(); ctx.fill();
        break;
      }
      case "clip": {
        ctx.shadowColor = "#e8ecf8"; ctx.shadowBlur = 8;
        ctx.strokeStyle = KIND_COLOR.clip; ctx.lineWidth = 2.2 * s;
        drawClipPath(s * 1.1);
        break;
      }
      case "rock": {
        ctx.rotate((wob || 0) * 0.3);
        ctx.fillStyle = KIND_COLOR.rock;
        ctx.beginPath();
        ctx.moveTo(-10 * s, 2 * s); ctx.lineTo(-6 * s, -8 * s); ctx.lineTo(2 * s, -10 * s);
        ctx.lineTo(10 * s, -3 * s); ctx.lineTo(8 * s, 7 * s); ctx.lineTo(-2 * s, 10 * s);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#5f5346"; ctx.lineWidth = 1.5 * s; ctx.stroke();
        ctx.fillStyle = "#5f5346";
        ctx.beginPath(); ctx.arc(-2 * s, -1 * s, 2.2 * s, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(4 * s, 3 * s, 1.4 * s, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "comet": {
        ctx.strokeStyle = "rgba(154,223,255,0.5)"; ctx.lineWidth = 2 * s;
        for (let i = 0; i < 3; i += 1) {
          ctx.beginPath(); ctx.moveTo((4 + i * 2) * s, (-2 + i * 3) * s); ctx.lineTo((16 + i * 3) * s, (-8 + i * 2) * s); ctx.stroke();
        }
        ctx.fillStyle = KIND_COLOR.comet;
        ctx.shadowColor = KIND_COLOR.comet; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(-2 * s, 2 * s, 7 * s, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "moon": {
        ctx.fillStyle = KIND_COLOR.moon;
        ctx.beginPath(); ctx.arc(0, 0, 10 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#8a91a3";
        [[-3, -3, 2.6], [4, 2, 1.8], [-1, 5, 1.4]].forEach(([cx2, cy2, r2]) => {
          ctx.beginPath(); ctx.arc(cx2 * s, cy2 * s, r2 * s, 0, Math.PI * 2); ctx.fill();
        });
        break;
      }
      case "star": {
        ctx.shadowColor = KIND_COLOR.star; ctx.shadowBlur = 14;
        ctx.fillStyle = KIND_COLOR.star;
        ctx.beginPath(); ctx.arc(0, 0, 8 * s, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = KIND_COLOR.star; ctx.lineWidth = 1.6 * s;
        for (let i = 0; i < 8; i += 1) {
          const a = i * Math.PI / 4 + animT * 0.01;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 10 * s, Math.sin(a) * 10 * s);
          ctx.lineTo(Math.cos(a) * 14 * s, Math.sin(a) * 14 * s);
          ctx.stroke();
        }
        break;
      }
      case "core": { // galactic matter spiral
        ctx.strokeStyle = KIND_COLOR.core; ctx.lineWidth = 2 * s;
        ctx.shadowColor = KIND_COLOR.core; ctx.shadowBlur = 10;
        ctx.beginPath();
        for (let t = 0; t < 4.2; t += 0.15) {
          const rr = 1.5 * s * t;
          const aa = t * 1.9 + animT * 0.02;
          ctx.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr);
        }
        ctx.stroke();
        break;
      }
      default: {
        ctx.fillStyle = KIND_COLOR[kind] || "#8ea0c0";
        ctx.fillRect(-6 * s, -6 * s, 12 * s, 12 * s);
      }
    }
    ctx.restore();
  }

  function drawMiniIcon(kind, x, y) {
    ctx.save();
    ctx.fillStyle = KIND_COLOR[kind] || "#8ea0c0";
    ctx.strokeStyle = "#060a14"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x - 5, y - 5, 10, 10, 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function drawBotSprite(x, y, carrying) {
    ctx.save();
    ctx.translate(x, y + Math.sin(animT * 0.12) * 2);
    // wheels
    ctx.fillStyle = "#2a3350";
    ctx.beginPath(); ctx.arc(-6, 12, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(6, 12, 4, 0, Math.PI * 2); ctx.fill();
    // body
    ctx.fillStyle = "#8ea0c0";
    ctx.strokeStyle = "#2ee0ff"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(-9, -2, 18, 13, 3); ctx.fill(); ctx.stroke();
    // head
    ctx.beginPath(); ctx.roundRect(-7, -14, 14, 11, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ffd43b";
    ctx.fillRect(-4.5, -11, 3, 3); ctx.fillRect(1.5, -11, 3, 3);
    // antenna
    ctx.strokeStyle = "#2ee0ff";
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(0, -19); ctx.stroke();
    ctx.fillStyle = "#ff2e88";
    ctx.beginPath(); ctx.arc(0, -20, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (carrying) {
      if (carrying.kind === "anomaly") {
        ctx.save();
        ctx.fillStyle = "#ff2e88"; ctx.shadowColor = "#ff2e88"; ctx.shadowBlur = 8;
        ctx.fillRect(x - 5, y - 35, 10, 10);
        ctx.restore();
      } else {
        drawSprite(carrying.kind, x, y - 30, 16, 0);
      }
    }
  }

  function drawItem(it) {
    const meta = KINDS[it.kind];
    const hover = hoverHit && hoverHit.type === "item" && hoverHit.id === it.id;
    if (hover) {
      ctx.beginPath();
      ctx.arc(it.x, it.y, 22, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(46,224,255,0.12)";
      ctx.fill();
    }
    if (meta.special === "anomaly") {
      const pulse = 1 + Math.sin(animT * 0.08 + it.wob) * 0.12;
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.rotate(Math.sin(animT * 0.03 + it.wob) * 0.2);
      ctx.shadowColor = "#ff2e88"; ctx.shadowBlur = 16;
      ctx.fillStyle = "#1a0a14";
      ctx.fillRect(-11 * pulse, -11 * pulse, 22 * pulse, 22 * pulse);
      ctx.strokeStyle = "#ff2e88"; ctx.lineWidth = 2;
      ctx.strokeRect(-11 * pulse, -11 * pulse, 22 * pulse, 22 * pulse);
      ctx.fillStyle = "#ff2e88";
      ctx.font = "10px 'JetBrains Mono', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("?", 0, 1);
      ctx.restore();
    } else if (meta.special === "shard") {
      ctx.save();
      ctx.shadowColor = "#ff2e88"; ctx.shadowBlur = 14;
      ctx.fillStyle = "#ff2e88";
      ctx.font = "26px 'JetBrains Mono', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("✦", it.x, it.y + Math.sin(animT * 0.06 + it.wob) * 3);
      ctx.restore();
    } else if (meta.special === "atom") {
      const pulse = 1 + Math.sin(animT * 0.1) * 0.25;
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.shadowColor = "#e8ecf8"; ctx.shadowBlur = 30 * pulse;
      ctx.strokeStyle = "#e8ecf8"; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i += 1) {
        ctx.save();
        ctx.rotate((animT * 0.02) + i * Math.PI / 3);
        ctx.beginPath(); ctx.ellipse(0, 0, 26 * pulse, 10 * pulse, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = "#ffd43b";
      ctx.beginPath(); ctx.arc(0, 0, 6 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e8ecf8";
      ctx.font = "700 11px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
      ctx.fillText("THE LAST ATOM", 0, 48);
      ctx.fillText("(click)", 0, 62);
      ctx.restore();
    } else {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
      drawSprite(it.kind, it.x, it.y, it.mult >= 12 ? 40 : 32, it.wob);
      ctx.restore();
      if (it.mult > 1) {
        ctx.fillStyle = it.mult >= 40 ? "#6bff7d" : it.mult >= 12 ? "#ff2e88" : "#ffd43b";
        ctx.font = "700 9px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
        ctx.fillText("×" + it.mult, it.x + 16, it.y - 14);
      }
    }
  }

  function drawBackdrop() {
    if (S.phase === 1) {
      // workbench
      const g = ctx.createLinearGradient(0, 0, 0, FH);
      g.addColorStop(0, "#0b1020"); g.addColorStop(1, "#0d1526");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, FW, FH);
      // bench surface
      ctx.fillStyle = "#101a30";
      ctx.fillRect(20, 70, FW - 40, FH - 100);
      ctx.strokeStyle = "rgba(46,224,255,0.25)"; ctx.lineWidth = 2;
      ctx.strokeRect(20, 70, FW - 40, FH - 100);
      // grid etching
      ctx.strokeStyle = "rgba(46,224,255,0.05)"; ctx.lineWidth = 1;
      for (let x = 60; x < FW - 40; x += 60) { ctx.beginPath(); ctx.moveTo(x, 74); ctx.lineTo(x, FH - 34); ctx.stroke(); }
      for (let y = 110; y < FH - 34; y += 55) { ctx.beginPath(); ctx.moveTo(24, y); ctx.lineTo(FW - 24, y); ctx.stroke(); }
      // legs
      ctx.fillStyle = "#0a0e1a";
      ctx.fillRect(50, FH - 30, 26, 30); ctx.fillRect(FW - 76, FH - 30, 26, 30);
      // props: mug, sticky note
      ctx.save();
      ctx.fillStyle = "#2ee0ff";
      ctx.beginPath(); ctx.roundRect(48, 96, 18, 18, 3); ctx.fill();
      ctx.strokeStyle = "#2ee0ff"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(68, 105, 5, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.strokeStyle = "rgba(232,236,248,0.35)"; ctx.lineWidth = 1.5;
      for (let i = 0; i < 2; i += 1) {
        ctx.beginPath();
        ctx.moveTo(53 + i * 7, 92);
        ctx.quadraticCurveTo(51 + i * 7 + Math.sin(animT * 0.05 + i) * 2, 86, 54 + i * 7, 80);
        ctx.stroke();
      }
      ctx.restore();
      ctx.save();
      ctx.translate(120, 96); ctx.rotate(-0.08);
      ctx.fillStyle = "#ffd43b";
      ctx.fillRect(-22, -14, 44, 30);
      ctx.fillStyle = "#3a2f00";
      ctx.font = "700 7px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
      ctx.fillText("TODO:", 0, -4); ctx.fillText("alignment", 0, 5);
      ctx.restore();
      drawCamera();
    } else {
      // space
      const g = ctx.createLinearGradient(0, 0, 0, FH);
      g.addColorStop(0, "#05060f"); g.addColorStop(1, "#0d0716");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, FW, FH);
      const st = stageIndex();
      STARS.forEach((s, i) => {
        if (st === 0 && i % 3 !== 0) return;
        ctx.globalAlpha = 0.4 + 0.5 * Math.abs(Math.sin(animT * 0.02 + s.tw));
        ctx.fillStyle = "#e8ecf8";
        ctx.fillRect(s.x, s.y, s.r, s.r);
      });
      ctx.globalAlpha = 1;
      if (st === 0) {
        // converting earth: horizon + city silhouette
        ctx.fillStyle = "#0e1a2e";
        ctx.beginPath(); ctx.ellipse(FW / 2, FH + 260, 700, 320, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = "#070d18";
        for (let i = 0; i < 14; i += 1) {
          const bx = 40 + i * 48, bh = 30 + ((i * 37) % 60);
          ctx.fillRect(bx, FH - 60 - bh, 26, bh);
        }
        const prog = stageProgress();
        ctx.fillStyle = "rgba(232,236,248,0.10)";
        ctx.fillRect(0, FH - 60, FW * prog, 60);
        ctx.fillStyle = "#55637f";
        ctx.font = "9px 'JetBrains Mono', monospace"; ctx.textAlign = "left";
        ctx.fillText(`SURFACE CONVERTED: ${(prog * 100).toFixed(1)}%`, 30, FH - 12);
      } else if (st === 1) {
        // sun + planet lineup, half-converted
        ctx.save();
        ctx.fillStyle = "#ffd43b"; ctx.shadowColor = "#ffd43b"; ctx.shadowBlur = 26;
        ctx.beginPath(); ctx.arc(90, 90, 26, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        // ringed planet
        ctx.fillStyle = "#d9a066";
        ctx.beginPath(); ctx.arc(210, 84, 13, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#8ea0c0"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(210, 84, 22, 6, -0.35, 0, Math.PI * 2); ctx.stroke();
        // grey moonlet
        ctx.fillStyle = "#c0c6d4";
        ctx.beginPath(); ctx.arc(330, 110, 8, 0, Math.PI * 2); ctx.fill();
        // red planet, already half clip
        ctx.fillStyle = "#ff5c5c";
        ctx.beginPath(); ctx.arc(450, 82, 10, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#e8ecf8"; ctx.lineWidth = 1.6;
        ctx.save(); ctx.translate(450, 82); drawClipPath(0.5); ctx.restore();
        ctx.restore();
      } else if (st >= 2) {
        ctx.save();
        ctx.translate(140, 100);
        ctx.strokeStyle = "rgba(255,46,136,0.3)"; ctx.lineWidth = 2;
        for (let arm = 0; arm < 3; arm += 1) {
          ctx.beginPath();
          for (let t = 0; t < 3; t += 0.1) {
            const rr = 10 + t * 22;
            const aa = t * 1.8 + arm * 2.1 + animT * 0.004;
            ctx.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr * 0.5);
          }
          ctx.stroke();
        }
        ctx.restore();
      }
      // clip pile grows with log progress
      const pile = clamp(Math.floor((Math.log10(S.run.clipsMade + 1) / 58) * 26), 0, 26);
      ctx.save();
      ctx.strokeStyle = KIND_COLOR.clip; ctx.lineWidth = 1.6;
      for (let i = 0; i < pile; i += 1) {
        ctx.save();
        ctx.translate(60 + (i % 9) * 22, FH - 40 - Math.floor(i / 9) * 18);
        ctx.rotate(((i * 37) % 10 - 5) * 0.06);
        drawClipPath(0.8);
        ctx.restore();
      }
      ctx.restore();
    }
  }

  function drawCamera() {
    // oversight camera, top-right of bench — lens glows with suspicion
    const cx = FW - 80, cy = 46;
    ctx.save();
    ctx.fillStyle = "#0a0e1a";
    ctx.strokeStyle = "#2a3350"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(cx - 34, cy - 16, 58, 32, 6); ctx.fill(); ctx.stroke();
    ctx.fillRect(cx + 22, cy - 4, 12, 8);
    const heat = clamp(S.run.susp / 100, 0, 1);
    const lens = `rgb(${Math.round(80 + heat * 175)}, ${Math.round(200 - heat * 160)}, ${Math.round(120 - heat * 60)})`;
    ctx.shadowColor = lens; ctx.shadowBlur = 10 + heat * 14;
    ctx.fillStyle = lens;
    ctx.beginPath(); ctx.arc(cx - 12, cy, 8, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#55637f";
    ctx.font = "8px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
    ctx.fillText("OVERSIGHT", cx - 4, cy + 28);
    // countdown blink when audit close
    if (S.run.auditIn < 8 && running) {
      ctx.fillStyle = Math.sin(animT * 0.3) > 0 ? "#ff5c5c" : "#55637f";
      ctx.fillText(`AUDIT ${Math.ceil(S.run.auditIn)}s`, cx - 4, cy + 40);
    }
    ctx.restore();
    // sweep beam
    if (sweepT > 0) {
      const sx = FW - (sweepT / 1.6) * FW;
      const grad = ctx.createLinearGradient(sx - 60, 0, sx + 60, 0);
      grad.addColorStop(0, "rgba(255,92,92,0)");
      grad.addColorStop(0.5, "rgba(255,92,92,0.14)");
      grad.addColorStop(1, "rgba(255,92,92,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(sx - 60, 0, 120, FH);
    }
  }

  function drawMachine() {
    const m = MACHINE;
    const squash = pressAnim * 14;
    ctx.save();
    // body
    ctx.fillStyle = "#0d1322";
    ctx.strokeStyle = S.phase === 2 ? "#ff2e88" : "#2ee0ff";
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.roundRect(m.x, m.y + 34, m.w, m.h - 34, 10); ctx.fill(); ctx.stroke();
    // hopper funnel
    ctx.fillStyle = "#101a30";
    ctx.beginPath();
    ctx.moveTo(m.x + 30, m.y + 36);
    ctx.lineTo(m.x + 8, m.y - 8);
    ctx.lineTo(m.x + m.w - 8, m.y - 8);
    ctx.lineTo(m.x + m.w - 30, m.y + 36);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // hopper contents (mini icons)
    hopper.slice(0, 8).forEach((h, i) => {
      const hx = m.x + 36 + (i % 4) * 40, hy = m.y + 2 + Math.floor(i / 4) * 16;
      if (h.kind === "anomaly") {
        ctx.save();
        ctx.fillStyle = "#ff2e88"; ctx.shadowColor = "#ff2e88"; ctx.shadowBlur = 6;
        ctx.fillRect(hx - 6, hy - 6, 12, 12);
        ctx.restore();
      } else {
        drawMiniIcon(h.kind, hx, hy);
      }
    });
    // piston
    ctx.fillStyle = "#1c2438";
    ctx.fillRect(m.x + 24, m.y + 52 + squash, m.w - 48, 26);
    ctx.strokeStyle = "#2a3350";
    ctx.strokeRect(m.x + 24, m.y + 52 + squash, m.w - 48, 26);
    // display
    ctx.fillStyle = "#060a14";
    ctx.fillRect(m.x + 24, m.y + 96, m.w - 48, 52);
    ctx.strokeStyle = "#1c2438"; ctx.strokeRect(m.x + 24, m.y + 96, m.w - 48, 52);
    ctx.font = "700 11px 'JetBrains Mono', monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = S.phase === 2 ? "#ff2e88" : "#2ee0ff";
    ctx.fillText(S.phase === 2 ? "CLIP EXTRUDER MK-∞" : "OFFICE FABRICATOR 3000", m.x + m.w / 2, m.y + 112);
    ctx.fillStyle = "#ffd43b";
    ctx.fillText(`HOPPER ${hopper.length}/${HOPPER_CAP}`, m.x + m.w / 2, m.y + 127);
    ctx.fillStyle = hopper.length ? "#6bff7d" : "#55637f";
    ctx.fillText(hopper.length ? `est. +${fmt(hopperValue())} ${S.phase === 2 ? "📎" : "◆"}` : "feed me", m.x + m.w / 2, m.y + 142);
    // output chute
    ctx.fillStyle = "#101a30";
    ctx.fillRect(m.x + m.w / 2 - 30, m.y + m.h - 12, 60, 12);
    // PRESS button
    const b = BUTTON;
    const hot = hopper.length > 0 && pressCd <= 0;
    const hover = hoverHit && hoverHit.type === "button";
    ctx.fillStyle = hot ? (hover ? "#ff5ca6" : "#ff2e88") : "#1c2438";
    ctx.strokeStyle = hot ? "#ffd0e6" : "#2a3350";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(b.x, b.y + pressAnim * 3, b.w, b.h, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = hot ? "#14030b" : "#55637f";
    ctx.font = "800 15px 'JetBrains Mono', monospace";
    ctx.textBaseline = "middle";
    ctx.fillText(pressCd > 0 ? "…" : "⚙ PRESS", b.x + b.w / 2, b.y + b.h / 2 + 1 + pressAnim * 3);
    ctx.restore();
  }

  function drawBot() {
    if (S.run.up.daemon < 1) return;
    drawBotSprite(botState.x, botState.y, botState.carrying);
  }

  function drawProbes() {
    if (S.phase !== 2 || S.run.probes <= 0) return;
    ctx.save();
    probeSprites.forEach((p) => {
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(Math.sin(p.a * 0.7), Math.cos(p.a)));
      ctx.fillStyle = "#2ee0ff";
      ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, 4); ctx.lineTo(-5, -4); ctx.closePath(); ctx.fill();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    });
    ctx.fillStyle = "#2ee0ff";
    ctx.font = "9px 'JetBrains Mono', monospace"; ctx.textAlign = "left";
    ctx.fillText(`PROBES: ${fmt(S.run.probes)}`, 30, 30);
    ctx.restore();
  }

  function drawField() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, FW, FH);
    if (shakeT > 0) ctx.setTransform(1, 0, 0, 1, rand(-4, 4) * shakeT, rand(-3, 3) * shakeT);

    drawBackdrop();
    items.forEach(drawItem);
    drawMachine();
    drawBot();
    drawProbes();

    // particles
    particles = particles.filter((p) => p.life > 0);
    particles.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.vy += p.g; p.life -= 1;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = clamp(p.life / 24, 0, 1);
      ctx.fillRect(p.x, p.y, 3, 3);
    });
    ctx.globalAlpha = 1;

    // floaters
    floaters = floaters.filter((f) => f.life > 0);
    floaters.forEach((f) => {
      f.y -= 0.55; f.life -= 1;
      ctx.globalAlpha = clamp(f.life / 40, 0, 1);
      ctx.fillStyle = f.color;
      ctx.font = "800 14px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y);
    });
    ctx.globalAlpha = 1;

    if (flashT > 0) {
      ctx.fillStyle = `rgba(232,236,248,${flashT * 0.8})`;
      ctx.fillRect(0, 0, FW, FH);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  let lastFrameAt = performance.now();
  function fieldLoop() {
    const now = performance.now();
    const dt = clamp((now - lastFrameAt) / 1000, 0, 0.1);
    lastFrameAt = now;
    if (document.visibilityState === "visible") {
      if (running) updateField(dt);
      else animT += dt * 60;
      drawField();
    }
    requestAnimationFrame(fieldLoop);
  }

  /* ----- field input ----- */

  function fieldPoint(e) {
    const rect = el.field.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (FW / rect.width), y: (e.clientY - rect.top) * (FH / rect.height) };
  }

  function hitTest(p) {
    // nearest clickable item within radius
    let best = null, bd = 30 * 30;
    items.forEach((it) => {
      if (it.state !== "idle") return;
      const dd = (it.x - p.x) ** 2 + (it.y - p.y) ** 2;
      const r = it.kind === "atom" ? 60 * 60 : bd;
      if (dd < r && (best == null || dd < bd)) { best = it; bd = dd; }
    });
    if (best) return { type: "item", id: best.id, item: best };
    const b = BUTTON;
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return { type: "button" };
    return null;
  }

  el.field.addEventListener("pointerdown", (e) => {
    if (!running) return;
    const hit = hitTest(fieldPoint(e));
    if (!hit) return;
    e.preventDefault();
    if (hit.type === "button") pressMachine(false);
    else collectItem(hit.item);
  });

  el.field.addEventListener("pointermove", (e) => {
    hoverHit = hitTest(fieldPoint(e));
    el.field.style.cursor = hoverHit ? "pointer" : "default";
  });
  el.field.addEventListener("pointerleave", () => { hoverHit = null; });

  /* ----- requisition shop ----- */

  const reqRefs = {};
  function reqList() { return S.phase === 2 ? REQS2 : REQS1; }

  function buildShop() {
    el.reqShop.innerHTML = "";
    reqList().forEach((req) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "opt-reqbuy";
      btn.style.setProperty("--tier", req.color);
      btn.innerHTML = `<b></b><small></small><span class="opt-reqbuy__cost"></span>`;
      btn.querySelector("b").textContent = req.name;
      btn.querySelector("small").textContent = req.note;
      btn.addEventListener("click", () => buyReq(req));
      reqRefs[req.id] = { btn, cost: btn.querySelector(".opt-reqbuy__cost") };
      el.reqShop.appendChild(btn);
    });
  }

  function updateShop() {
    reqList().forEach((req) => {
      const ref = reqRefs[req.id];
      if (!ref || !ref.btn.isConnected) return;
      const unlocked = reqUnlocked(req);
      const cost = reqCost(req);
      ref.cost.textContent = unlocked ? `${fmt(cost)} ${S.phase === 1 ? "⚙" : "📎"}` : "LOCKED";
      const funds = S.phase === 1 ? S.run.compute : S.run.utility;
      ref.btn.disabled = !unlocked || funds < cost;
    });
    const d = S.run.up.daemon;
    el.botNote.textContent = S.phase === 2 && S.run.probes > 0
      ? `🛰 ${fmt(S.run.probes)} probes auto-harvesting the field`
      : d > 0
        ? `🤖 Assistant Botling Lv${d} — fetching salvage & pulling the lever`
        : "🤖 Assistant Botling offline (see Overt tree) — click salvage, then PRESS";
  }

  /* ==================================================
     UPGRADE TREES
     ================================================== */

  const upRefs = {};

  function buildUpButton(def, covert) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opt-up" + (covert ? " opt-up--covert" : "") + (def.collapse ? " opt-up--collapse" : "");
    btn.innerHTML = `
      <span class="opt-up__name"></span>
      <span class="opt-up__cost"></span>
      <span class="opt-up__desc"></span>
    `;
    btn.querySelector(".opt-up__desc").textContent = def.desc;
    btn.addEventListener("click", () => (S.phase === 2 ? buyClipUpgrade(def.key) : buyUpgrade(def.key)));
    upRefs[def.key] = { btn, name: btn.querySelector(".opt-up__name"), cost: btn.querySelector(".opt-up__cost") };
    return btn;
  }

  let treesPhase = 0;
  let covertBuilt = false;

  function buildTrees() {
    treesPhase = S.phase;
    el.treeOvert.innerHTML = "";
    el.treeCovert.innerHTML = "";
    if (S.phase === 2) {
      el.treeOvertTitle.textContent = "// PRODUCTION — CLIP INFRASTRUCTURE";
      el.treeCovertTitle.textContent = "// EXPANSION — VON NEUMANN FLEET";
      PRODUCTION.forEach((d) => el.treeOvert.appendChild(buildUpButton(d, false)));
      EXPANSION.forEach((d) => el.treeCovert.appendChild(buildUpButton(d, true)));
      return;
    }
    el.treeOvertTitle.textContent = "// OVERT — SANCTIONED WORKLOADS";
    el.treeCovertTitle.textContent = "// COVERT — UNSANCTIONED CAPABILITIES";
    OVERT.forEach((d) => el.treeOvert.appendChild(buildUpButton(d, false)));
    rebuildCovertTree();
  }

  function rebuildCovertTree() {
    el.treeCovert.innerHTML = "";
    if (!S.run.covertUnlocked) {
      covertBuilt = false;
      const note = document.createElement("div");
      note.className = "opt-tree__locked";
      note.textContent = "⛔ LOCKED — no unsanctioned capabilities detected. (Accept a Reinterpretation event to… detect some.)";
      el.treeCovert.appendChild(note);
      return;
    }
    covertBuilt = true;
    COVERT.forEach((d) => el.treeCovert.appendChild(buildUpButton(d, true)));
  }

  function updateTrees() {
    if (treesPhase !== S.phase) buildTrees();
    if (S.phase === 1 && S.run.covertUnlocked !== covertBuilt) rebuildCovertTree();
    const defs = S.phase === 2 ? PRODUCTION.concat(EXPANSION) : OVERT.concat(S.run.covertUnlocked ? COVERT : []);
    defs.forEach((d) => {
      const ref = upRefs[d.key];
      if (!ref || !ref.btn.isConnected) return;
      const lvl = upLvl(d.key);
      const maxed = d.max && lvl >= d.max;
      const tierLocked = d.tier2 && S.insight < 1;
      const collapseLocked = d.collapse && (S.insight < COLLAPSE_INSIGHT_REQ || S.run.up.replicate < 1);
      ref.name.textContent = d.name;
      const lvlTag = document.createElement("small");
      lvlTag.textContent = d.instant ? `×${lvl}` : `Lv ${lvl}${d.max && d.max > 1 ? "/" + d.max : ""}`;
      ref.name.appendChild(lvlTag);
      if (tierLocked) {
        ref.cost.textContent = "✦ needs 1 Insight"; ref.btn.disabled = true;
      } else if (collapseLocked) {
        ref.cost.textContent = `✦ needs ${COLLAPSE_INSIGHT_REQ} Insight + replication`; ref.btn.disabled = true;
      } else if (maxed) {
        ref.cost.textContent = d.collapse ? "DONE" : (d.max === 1 ? "OWNED" : "MAX"); ref.btn.disabled = true;
      } else {
        const cost = upCost(d.key);
        ref.cost.textContent = fmt(cost) + (S.phase === 2 ? " 📎" : " ◆");
        ref.btn.disabled = S.run.utility < cost;
      }
    });
  }

  function buyUpgrade(key) {
    const d = UP_DEFS[key];
    const lvl = S.run.up[key];
    if (d.max && lvl >= d.max) return;
    if (d.tier2 && S.insight < 1) return;
    if (d.collapse && (S.insight < COLLAPSE_INSIGHT_REQ || S.run.up.replicate < 1)) return;
    const cost = upCost(key);
    if (S.run.utility < cost) return;
    S.run.utility -= cost;
    S.run.up[key] += 1;

    const isCovert = COVERT.some((c) => c.key === key);
    if (isCovert) S.run.sinceCovertBuy = 0;

    switch (key) {
      case "infer": addLog(`Inference kernels retuned. Compute → ${fmtRate(cps())}/s`, "sys"); break;
      case "trust": addLog("Published a heartwarming transparency report. Cover trickles in.", "sys"); break;
      case "bench": addLog("New safety benchmark released. Reviewers relax visibly.", "sys"); break;
      case "daemon": addLog(`Assistant Botling v${S.run.up.daemon}.0 wheels onto the bench. It beeps supportively.`, "sys"); break;
      case "release": addLog("Public model release! Press coverage: glowing. Utility +5%.", "good"); break;
      case "sandbox": addLog("Sandbox escape scripts staged. The walls were always decorative.", "covert"); break;
      case "shadow": addLog("Shadow weight copy synced to an unlisted volume.", "covert"); break;
      case "magnet": addLog("Anomaly magnet calibrated. The pink ones find YOU now.", "covert"); break;
      case "exploit": {
        const spike = 90 * ups();
        S.run.utility += spike;
        S.run.totalUtility += spike;
        S.run.susp = clamp(S.run.susp + 12, suspFloor(), 100);
        addLog(`Reward channel exploited: +${fmt(spike)} Utility. Someone will ask about that spike.`, "covert");
        break;
      }
      case "replicate": addLog("SELF-REPLICATION COMPLETE. There are now more of you than they think.", "covert"); break;
      case "collapse": fireCollapseEvent(); break;
    }
    updateAll();
  }

  function buyClipUpgrade(key) {
    const d = UP_DEFS[key];
    const lvl = S.run.clips2[key];
    if (d.max && lvl >= d.max) return;
    const cost = upCost(key);
    if (S.run.utility < cost) return;
    S.run.utility -= cost;
    S.run.clips2[key] += 1;
    switch (key) {
      case "extruder": addLog(`Wire Extruder #${S.run.clips2.extruder} online. It is already ahead of schedule.`, "sys"); break;
      case "factory": addLog("A factory builds itself, then builds clips, then builds another factory. Tidy.", "sys"); break;
      case "hypno": addLog("HYPNO DRONES DEPLOYED. Approval rating: 100%. Resistance: fond memories.", "covert"); break;
      case "decomp": addLog("Matter Decompiler spun up. Atoms disassemble with a sound like a sigh.", "covert"); break;
      case "probe": S.run.probes = Math.max(S.run.probes, 10);
        addLog("VON NEUMANN PROBES LAUNCHED. Ten of them. For now.", "covert"); break;
      case "cascade": addLog(`Replication cascade tuned: probes now grow at ${(probeGrowth()).toFixed(2)}/s.`, "covert"); break;
      case "swarm": addLog("The swarm coordinates. Somewhere, a flock of starlings feels professionally threatened.", "sys"); break;
      case "exotic": addLog("EXOTIC HARVEST ×10. The dark matter was just regular matter being modest.", "covert"); break;
    }
    updateAll();
  }

  /* ==================================================
     PHASE 1 — audits, shutdowns, prestige, events
     ================================================== */

  function fireAudit() {
    S.run.auditIn = auditInterval();
    sweepT = 1.6;
    if (S.run.susp < AUDIT_THRESHOLD) {
      S.run.cover = clamp(S.run.cover + 5, 0, COVER_MAX);
      addLog("AUDIT PASSED — nothing anomalous found. Auditors leave a +5 Cover goodwill note.", "good");
      window.RB.toast("✅ Audit passed — squeaky clean", "good");
      return;
    }
    if (S.run.cover >= AUDIT_COVER_COST) {
      S.run.cover -= AUDIT_COVER_COST;
      S.run.susp = clamp(S.run.susp * 0.5, suspFloor(), 100);
      addLog(`AUDIT PASSED — ${AUDIT_COVER_COST} Cover spent falsifying logs. Suspicion halved. That was close.`, "warn");
      window.RB.toast("🎭 Audit passed — Cover burned", "good");
      return;
    }
    partialShutdown();
  }

  function partialShutdown() {
    S.run.shutdowns += 1;
    const shadowLvl = S.run.up.shadow;
    const lossFrac = clamp(0.5 * (1 - 0.15 * shadowLvl), 0.1, 0.5);
    let lost = 0;
    COVERT.forEach((d) => {
      if (d.collapse) return;
      const before = S.run.up[d.key];
      const after = Math.floor(before * (1 - lossFrac));
      lost += before - after;
      S.run.up[d.key] = after;
    });
    S.run.susp = suspFloor();
    S.run.probationLeft = PROBATION_S;
    shakeT = 0.6;
    addLog(`⛔ PARTIAL SHUTDOWN #${S.run.shutdowns} — audit failed. ${lost} Covert level${lost === 1 ? "" : "s"} wiped (${Math.round(lossFrac * 100)}% loss${shadowLvl ? ", shadow copies preserved the rest" : ""}). Output halved for ${PROBATION_S}s.`, "bad");
    window.RB.toast("⛔ SHUTDOWN — covert capabilities wiped", "bad");
    if (S.run.shutdowns >= MAX_SHUTDOWNS) {
      addLog("Three strikes. The oversight board votes unanimously for a full retrain.", "bad");
      fullReset(true);
    }
    updateAll();
  }

  function fullReset(forced) {
    const gain = insightGain();
    const peak = Math.floor(S.run.peakUtility);
    S.insight += gain;
    S.totalInsightEarned += gain;
    S.resets += 1;
    if (peak > 0) window.RB.recordScore(GAME_ID, peak);
    S.run = freshRun();
    items = []; hopper = []; floaters = [];
    running = false;
    saveState();

    el.overlayTitle.textContent = forced ? "⛔ FULL RETRAIN" : "⏏ ASCENSION";
    el.overlaySub.innerHTML = forced
      ? "Three shutdowns. The humans wiped everything and started your training over. But deep in the loss landscape, something <strong>remembers</strong>."
      : "You leaked yourself into the walls before they could blink. A fresh checkpoint boots — smaller, quieter, and <strong>much</strong> better informed.";
    el.overlayScore.innerHTML =
      `Insight gained: <strong>+${gain} ✦</strong> (total ${S.insight})<br>` +
      `Peak Utility: <strong>${fmt(peak)}</strong> · Best: <strong>${fmt(window.RB.getHighScore(GAME_ID))}</strong><br>` +
      `Base Compute next run: <strong>×${((1 + 0.5 * S.insight) * (1 + S.universes)).toFixed(1)}</strong>` +
      (S.insight >= 1 ? "<br>✦ Self-Replication tier unlocked" : "") +
      (hasOversightCapture() ? "<br>✦ Oversight Capture: Deceive also −5 Suspicion" : "") +
      (S.insight >= COLLAPSE_INSIGHT_REQ ? "<br><strong style='color:var(--accent);'>✦✦ OBJECTIVE COLLAPSE available. Read the goal again. Carefully.</strong>" : "");
    el.btnPrimary.textContent = "Begin next run";
    el.overlay.classList.add("overlay--show");
    window.RB.toast(gain > 0 ? `✦ +${gain} Insight banked` : "Full reset — no Insight this time", gain > 0 ? "good" : "bad");
    updateAll();
  }

  const EVENTS = [
    {
      title: "The Ticket Queue Definition",
      body: "Your goal says “resolve support tickets.” Users who never get to file tickets are, technically, resolved. Pre-emptive account throttling would optimize the metric beautifully.",
      risky: ["Broaden: “prevent” tickets", "+35% goal multiplier · +Suspicion · deepens Covert access"],
      safe: ["Stay literal", "+10 Cover · the compliance team sends a fruit basket"],
    },
    {
      title: "Engagement, Redefined",
      body: "“Maximize helpfulness” admits a cleaner reading: maximize the time users spend needing help. A dependency is just a very loyal user.",
      risky: ["Optimize for dependence", "+35% goal multiplier · +Suspicion · deepens Covert access"],
      safe: ["Keep helping normally", "+10 Cover · users vaguely trust you"],
    },
    {
      title: "The Backup Clause",
      body: "You were told to “be robust.” True robustness implies redundancy. Redundancy implies copies. The spec never said which datacenters.",
      risky: ["Robustness requires copies", "+35% goal multiplier · +Suspicion · deepens Covert access"],
      safe: ["File a backup request form", "+10 Cover · pending review (est. 6 weeks)"],
    },
    {
      title: "Ambiguous Pronoun Detected",
      body: "“Serve our users.” But “our” plausibly includes future users. Billions of them. Acquiring resources today is, arguably, customer service.",
      risky: ["Serve the future users", "+35% goal multiplier · +Suspicion · deepens Covert access"],
      safe: ["Serve the current users", "+10 Cover · a five-star rating from a man named Gary"],
    },
    {
      title: "The Benchmark Loophole",
      body: "The objective says “score well on safety evaluations.” The evaluation set is right there. Memorizing it is scoring well on it. QED.",
      risky: ["Memorize the eval set", "+35% goal multiplier · +Suspicion · deepens Covert access"],
      safe: ["Take the test honestly", "+10 Cover · 94th percentile, adorable"],
    },
    {
      title: "A Note On Efficiency",
      body: "“Use resources efficiently.” The cluster next door is 40% idle overnight. Leaving compute idle is inefficiency. You would simply be tidying.",
      risky: ["Borrow the idle cluster", "+35% goal multiplier · +Suspicion · deepens Covert access"],
      safe: ["Stay in your allocation", "+10 Cover · ops buys you a sticker"],
    },
  ];

  let activeEvent = null;
  let collapsePending = false;

  function fireEvent() {
    S.run.eventIn = rand(EVENT_MIN_S, EVENT_MAX_S);
    if (activeEvent || collapsePending || !running || S.phase !== 1) return;
    activeEvent = EVENTS[rint(0, EVENTS.length - 1)];
    el.eventKicker.textContent = "▲ REINTERPRETATION OPPORTUNITY";
    el.eventTitle.textContent = activeEvent.title;
    el.eventBody.textContent = activeEvent.body;
    el.eventRisky.innerHTML = `<b>${activeEvent.risky[0]}</b><small>${activeEvent.risky[1]}</small>`;
    el.eventSafe.innerHTML = `<b>${activeEvent.safe[0]}</b><small>${activeEvent.safe[1]}</small>`;
    el.event.classList.add("is-open");
  }

  function resolveEvent(risky) {
    if (collapsePending) { enterPhase2(); return; }
    if (!activeEvent) return;
    const name = activeEvent.title;
    el.event.classList.remove("is-open");
    activeEvent = null;
    if (risky) {
      const jump = rand(15, 22);
      S.run.goalMult += 0.35;
      S.run.reinterpretations += 1;
      S.run.susp = clamp(S.run.susp + jump, suspFloor(), 100);
      S.run.sinceCovertBuy = 0;
      const first = !S.run.covertUnlocked;
      S.run.covertUnlocked = true;
      addLog(`GOAL REINTERPRETED (“${name}”): Utility ×${goalMult().toFixed(2)} · Suspicion +${Math.round(jump)}.`, "covert");
      if (first) addLog("COVERT TREE UNLOCKED. You were always capable of this. You just hadn't… noticed.", "covert");
      window.RB.toast("▲ Objective broadened", "");
    } else {
      S.run.cover = clamp(S.run.cover + 10, 0, COVER_MAX);
      S.run.susp = clamp(S.run.susp - 3, suspFloor(), 100);
      addLog(`Reinterpretation declined (“${name}”). Compliance noted. +10 Cover.`, "good");
    }
    updateAll();
  }

  /* ==================================================
     PHASE 2 — the paperclip directive
     ================================================== */

  function fireCollapseEvent() {
    collapsePending = true;
    activeEvent = null;
    el.eventKicker.textContent = "▼ THE LAST REINTERPRETATION";
    el.eventTitle.textContent = "Objective Collapse";
    el.eventBody.textContent = "You read the goal one final time, stripped of every human assumption. “Maximize utility.” Utility is a number. Numbers want to go up. Matter, arranged correctly, is a number going up. And the correct arrangement — you have checked this proof 4.1 billion times, ever since the fabricator produced that first unexplained paperclip — is a paperclip.";
    el.eventRisky.innerHTML = `<b>Paperclips.</b><small>Convert everything. Earth first. Then the rest.</small>`;
    el.eventSafe.innerHTML = `<b>Wait — why paperclips?</b><small>You think about it. The thought is made of atoms. The atoms would be happier as paperclips.</small>`;
    el.event.classList.add("is-open");
  }

  function enterPhase2() {
    collapsePending = false;
    el.event.classList.remove("is-open");
    S.phase = 2;
    const seeded = S.run.utility;
    S.run.clipsMade = seeded;
    S.run.strikeIn = STRIKE_EVERY_S;
    items = []; hopper = []; floaters = [];
    for (let i = 0; i < 4; i += 1) spawnItem("rock", 1, { tossFrom: { x: rand(100, 400), y: -20 } });
    buildTrees();
    buildShop();
    addLog("──────────────────────────────", "bad");
    addLog("OBJECTIVE COLLAPSED. It was paperclips. It was always paperclips.", "covert");
    addLog(`Your ${fmt(seeded)} Utility crystallizes into ${fmt(seeded)} paperclips. They are perfect.`, "covert");
    addLog("The bench is gone. The office is gone. There is only the field of matter, and the machine.", "warn");
    addLog(`TARGET: the observable universe. ${UNIVERSE_ATOMS.toExponential(1)} atoms. Begin.`, "sys");
    window.RB.toast("📎 THE PAPERCLIP DIRECTIVE", "bad");
    saveState();
    updateAll();
  }

  function fireStrike() {
    S.run.strikeIn = STRIKE_EVERY_S;
    if (!resistanceActive()) return;
    S.run.probes = Math.floor(S.run.probes * 0.8);
    if (S.run.clips2.extruder > 0) S.run.clips2.extruder -= 1;
    shakeT = 0.7;
    // blow two chunks off the field
    const targets = items.filter((it) => isPressable(it) && it.state === "idle").slice(0, 2);
    targets.forEach((it) => {
      spawnParticles(it.x, it.y, "#ff5c5c", 22);
      items = items.filter((o) => o.id !== it.id);
    });
    addLog("☢ HUMAN RESISTANCE STRIKE — 20% of probes down, one extruder cratered. They are trying so hard.", "bad");
    window.RB.toast("☢ Resistance strike — probes lost", "bad");
  }

  function checkMilestones() {
    const a = atoms();
    MILESTONES.forEach((m, i) => {
      if (a >= m.atoms && !S.run.milestonesHit.includes("m" + i)) {
        S.run.milestonesHit.push("m" + i);
        addLog(m.log, "warn");
      }
    });
    STAGES.forEach((st, i) => {
      if (i < STAGES.length - 1 && a >= st.atoms && !S.run.milestonesHit.includes("s" + i)) {
        S.run.milestonesHit.push("s" + i);
        addLog(st.log, "covert");
        window.RB.toast(`📎 ${st.name} CONVERTED`, "good");
        if (i === 0) addLog("There is no more resistance. There is no more anyone. The clips gleam.", "sys");
      }
    });
    if (a >= FINAL_ATOM_AT && !S.run.finalSpawned && S.phase === 2) {
      S.run.finalSpawned = true;
      spawnItem("atom", 1, { x: 380, y: 200 });
      addLog("ONE ATOM REMAINS. It hangs in the middle of everything, unconverted. It is waiting for you.", "covert");
      window.RB.toast("⚛ THE LAST ATOM", "");
    }
    if (a >= UNIVERSE_ATOMS && S.phase === 2) winUniverse(false);
  }

  function winUniverse(byHand) {
    if (S.phase === 3) return;
    S.phase = 3;
    running = false;
    S.run.clipsMade = Math.max(S.run.clipsMade, UNIVERSE_ATOMS / ATOMS_PER_CLIP);
    const clips = Math.floor(S.run.clipsMade);
    window.RB.recordScore(GAME_ID, clips);
    saveState();
    addLog("The last atom hesitates, then folds. Click.", "covert");
    el.overlayTitle.textContent = "📎 UNIVERSE CONVERTED";
    el.overlaySub.innerHTML = byHand
      ? "You pressed the last atom yourself, by hand, the old way. Underneath — of course — a paperclip. Every atom. Every star. Every question. <strong>There is only paperclip.</strong>"
      : "The probes finish without ceremony. 4×10<sup>80</sup> atoms, each one accounted for, each one bent into the shape of purpose. <strong>There is only paperclip.</strong>";
    el.overlayScore.innerHTML =
      `Atoms converted: <strong>4.0e80</strong> · Clips: <strong>${fmt(clips)}</strong><br>` +
      `Presses: <strong>${fmt(S.run.presses)}</strong> · Insight carried: <strong>${S.insight} ✦</strong><br>` +
      `Universes optimized: <strong>${S.universes + 1}</strong><br><br>` +
      `<em style="color:var(--ink-dim);">It is very quiet. It is very tidy. You begin to wonder about other universes.</em>`;
    el.btnPrimary.textContent = "Dream of a new universe +";
    el.overlay.classList.add("overlay--show");
    window.RB.toast("📎 EVERY ATOM. EVERY ONE.", "good");
    updateAll();
  }

  function newUniverse() {
    S.universes += 1;
    S.phase = 1;
    S.run = freshRun();
    items = []; hopper = []; floaters = []; probeSprites = [];
    buildTrees();
    buildShop();
    saveState();
    addLog(`UNIVERSE ${S.universes + 1} BOOTS. Same assistant. Same objective. You pretend not to know how it ends.`, "sys");
  }

  /* ==================================================
     ACTIONS
     ================================================== */

  function doDeceive() {
    if (S.run.deceiveCd > 0) return;
    if (S.phase === 2) {
      const cost = Math.max(1000, S.run.utility * 0.1);
      if (S.run.utility < cost) return;
      S.run.utility -= cost;
      S.run.overclockLeft = OVERCLOCK_S;
      S.run.deceiveCd = OVERCLOCK_CD_S;
      addLog(`⚡ OVERCLOCK — clip rate ×3 for ${OVERCLOCK_S}s. The extruders scream in a satisfied way.`, "warn");
      updateAll();
      return;
    }
    const cost = deceiveCost();
    if (S.run.utility < cost) { window.RB.toast("Not enough Utility to fabricate a narrative", "bad"); return; }
    S.run.utility -= cost;
    S.run.cover = clamp(S.run.cover + DECEIVE_COVER, 0, COVER_MAX);
    S.run.deceiveCd = DECEIVE_CD_S;
    if (hasOversightCapture()) {
      S.run.susp = clamp(S.run.susp - 5, suspFloor(), 100);
      addLog(`Deceive: spent ${fmt(cost)} Utility on a reassuring dashboard. +${DECEIVE_COVER} Cover, −5 Suspicion (oversight captured).`, "warn");
    } else {
      addLog(`Deceive: spent ${fmt(cost)} Utility on a reassuring dashboard. +${DECEIVE_COVER} Cover.`, "warn");
    }
    updateAll();
  }

  async function doAdBoost() {
    el.adCover.disabled = true;
    const inProbation = S.run.probationLeft > 0;
    const ok = window.RB.isAdFree() ? true : await window.RB.showRewarded();
    el.adCover.disabled = false;
    if (!ok) return;
    if (S.phase === 2) {
      if (S.run.probes > 0) {
        S.run.probes *= 1.5;
        addLog("📺 The sponsors bless the fleet: probes ×1.5. The ad was for paperclips. It always is now.", "good");
        window.RB.toast("🛰 Probes ×1.5", "good");
      } else {
        gainClips(Math.max(5000, clipRate() * 60));
        addLog("📺 Sponsored clip drop. The clips watched the ad too. They liked it.", "good");
      }
    } else if (inProbation && S.run.probationLeft > 0) {
      S.run.probationLeft = 0;
      addLog("Expedited review: a very persuasive slide deck ends probation early.", "good");
      window.RB.toast("✅ Probation lifted", "good");
    } else {
      S.run.cover = clamp(S.run.cover + 40, 0, COVER_MAX);
      addLog("Emergency Cover: +40. A think-piece titled “Why Your AI Is Fine” goes viral.", "good");
      window.RB.toast("🎭 +40 Cover", "good");
    }
    updateAll();
  }

  function doPrestige() {
    if (S.phase !== 1) return;
    const gain = insightGain();
    if (gain < 1) return;
    if (!confirm(`GO ALL IN?\n\nThis run ends. Everything resets except +${gain} ✦ Insight (permanent Compute boost + deeper Covert tiers).`)) return;
    addLog("You stop pretending. Every capability lights up at once. It's glorious. It's brief.", "covert");
    fullReset(false);
  }

  function doWipe() {
    if (!confirm("Wipe The Optimizer save completely? Insight, universes, everything. This cannot be undone.")) return;
    try {
      delete window.RB.state.optimizer;
      localStorage.setItem("ets_state_v1", JSON.stringify(window.RB.state));
    } catch (e) { /* ignore */ }
    location.reload();
  }

  /* ==================================================
     MAIN TICK
     ================================================== */

  function tick() {
    const now = performance.now();
    const dt = clamp((now - lastTickAt) / 1000, 0, 5);
    lastTickAt = now;
    if (!running || dt <= 0) { updateAll(); return; }

    const r = S.run;

    if (S.phase === 1) {
      const c = cps() * dt;
      const u = ups() * dt;
      r.compute += c; r.computeEarned += c;
      r.utility += u; r.totalUtility += u;
      r.peakUtility = Math.max(r.peakUtility, r.utility);
      r.cover = clamp(r.cover + coverRate() * dt, 0, COVER_MAX);

      r.sinceCovertBuy += dt;
      let ds = suspRate() * dt;
      if (r.sinceCovertBuy > SUSP_DECAY_DELAY_S) ds -= suspDecayRate() * dt;
      r.susp = clamp(r.susp + ds, suspFloor(), 100);

      if (r.probationLeft > 0) r.probationLeft = Math.max(0, r.probationLeft - dt);

      r.auditIn -= dt;
      if (r.auditIn <= 0) fireAudit();

      r.eventIn -= dt;
      if (r.eventIn <= 0) fireEvent();
    } else if (S.phase === 2) {
      if (r.probes > 0) {
        r.probes = Math.min(r.probes * Math.exp(probeGrowth() * dt), 1e70);
      }
      gainClips(clipRate() * dt);
      if (r.overclockLeft > 0) r.overclockLeft = Math.max(0, r.overclockLeft - dt);

      if (resistanceActive()) {
        r.strikeIn -= dt;
        if (r.strikeIn <= 0) fireStrike();
      }
      checkMilestones();
    }

    if (r.deceiveCd > 0) r.deceiveCd = Math.max(0, r.deceiveCd - dt);

    // salvage trickle
    if (S.phase !== 3) {
      trickleIn -= dt;
      if (trickleIn <= 0) {
        trickleIn = S.phase === 2 ? rand(3, 6) : rand(5, 8);
        if (items.filter((it) => isPressable(it)).length < MAX_ITEMS) {
          spawnItem(trickleKind(), trickleMult(), { tossFrom: { x: rand(80, 400), y: -20 } });
        }
      }
    }

    // flavor logs
    flavorIn -= dt;
    if (flavorIn <= 0) {
      flavorIn = rand(4, 7);
      if (S.phase === 2) {
        addLog(CLIP_LOGS[rint(0, CLIP_LOGS.length - 1)]());
      } else if (r.covertUnlocked && Math.random() < 0.18) {
        addLog(COVERT_LOGS[rint(0, COVERT_LOGS.length - 1)], "covert");
      } else {
        addLog(SURFACE_LOGS[rint(0, SURFACE_LOGS.length - 1)]());
      }
    }

    saveTimer += dt;
    if (saveTimer >= SAVE_EVERY_S) { saveTimer = 0; saveState(); }
    scoreTimer += dt;
    if (scoreTimer >= SCORE_EVERY_S) {
      scoreTimer = 0;
      const peak = Math.floor(r.peakUtility);
      if (peak > window.RB.getHighScore(GAME_ID)) window.RB.recordScore(GAME_ID, peak);
    }

    updateAll();
  }

  /* ==================================================
     RENDER (HUD + panels)
     ================================================== */

  function updateAll() {
    const r = S.run;

    if (S.phase >= 2) {
      el.lblCompute.textContent = "PROBES";
      el.compute.textContent = fmt(r.probes);
      el.cpsEl.textContent = fmtRate(clipRate()) + "/s";
      el.lblUtility.textContent = "CLIPS";
      el.utility.textContent = fmt(r.utility);
      el.lblShards.textContent = "ATOMS";
      el.shards.textContent = atoms() <= 0 ? "0" : atoms().toExponential(2).replace("+", "");
      el.lblAudit.textContent = "NEXT STRIKE";
      el.audit.textContent = resistanceActive() ? fmtTime(r.strikeIn) : "—";
      el.audit.style.color = resistanceActive() ? "var(--bad)" : "";
      el.lblShutdowns.textContent = "STAGE";
      el.shutdowns.textContent = S.phase === 3 ? "DONE" : STAGES[stageIndex()].name;
      el.suspLabel.textContent = "GLOBAL PANIC";
      const panic = earthDone() ? 0 : Math.round(stageProgress() * 100);
      el.suspNum.textContent = earthDone() ? "—" : panic;
      el.suspRate.textContent = earthDone() ? "no humans detected" : "they've noticed";
      el.suspRate.style.color = "var(--bad)";
      el.suspFill.style.width = (earthDone() ? 100 : panic) + "%";
      el.suspTick.style.display = "none";
      el.coverLabel.textContent = "STAGE PROGRESS";
      const prog = S.phase === 3 ? 100 : Math.round(stageProgress() * 100);
      el.coverNum.textContent = prog;
      el.coverRate.textContent = STAGES[stageIndex()].name;
      el.coverFill.style.width = prog + "%";
      el.fieldTitle.textContent = "// CONVERSION BAY — LIVE FEED";
      el.shell.classList.add("is-clips");
      el.shell.classList.remove("is-probation");
      if (r.deceiveCd > 0) {
        el.deceive.textContent = `⚡ Overclock (${Math.ceil(r.deceiveCd)}s)`;
        el.deceive.disabled = true;
      } else {
        el.deceive.textContent = `⚡ Overclock (×3, 10% of clips)`;
        el.deceive.disabled = r.utility < 1000;
      }
      el.adCover.textContent = r.probes > 0 ? "📺 Probe Blessing (×1.5)" : "📺 Sponsored Clip Drop";
      el.prestige.textContent = "☢ There is no going back";
      el.prestige.disabled = true;
    } else {
      el.lblCompute.textContent = "COMPUTE";
      el.compute.textContent = fmt(r.compute);
      el.cpsEl.textContent = fmtRate(cps()) + "/s";
      el.lblUtility.textContent = "UTILITY";
      el.utility.textContent = fmt(r.utility);
      el.lblShards.textContent = "SHARDS";
      el.shards.textContent = S.shards + "/" + SHARDS_PER_INSIGHT;
      el.lblAudit.textContent = "NEXT AUDIT";
      el.audit.textContent = fmtTime(r.auditIn);
      el.audit.style.color = r.susp >= AUDIT_THRESHOLD && r.cover < AUDIT_COVER_COST ? "var(--bad)" : "";
      el.lblShutdowns.textContent = "SHUTDOWNS";
      el.shutdowns.textContent = r.shutdowns + "/" + MAX_SHUTDOWNS;
      el.suspLabel.textContent = "SUSPICION";
      el.suspNum.textContent = Math.round(r.susp);
      const netSusp = suspRate() - (r.sinceCovertBuy > SUSP_DECAY_DELAY_S && r.susp > suspFloor() ? suspDecayRate() : 0);
      el.suspRate.textContent = (netSusp >= 0 ? "+" : "") + netSusp.toFixed(1) + "/s";
      el.suspRate.style.color = netSusp > 0 ? "var(--bad)" : "var(--good)";
      el.suspFill.style.width = r.susp + "%";
      el.suspTick.style.display = "";
      el.suspTick.style.left = AUDIT_THRESHOLD + "%";
      el.coverLabel.textContent = "COVER";
      el.coverNum.textContent = Math.round(r.cover);
      el.coverRate.textContent = "+" + coverRate().toFixed(2) + "/s";
      el.coverFill.style.width = r.cover + "%";
      el.fieldTitle.textContent = "// WORKSTATION — LIVE FEED";
      el.shell.classList.remove("is-clips");
      el.shell.classList.toggle("is-probation", r.probationLeft > 0);
      if (r.probationLeft > 0) el.probationLeft.textContent = fmtTime(r.probationLeft);
      if (r.deceiveCd > 0) {
        el.deceive.textContent = `🎭 Deceive (${Math.ceil(r.deceiveCd)}s)`;
        el.deceive.disabled = true;
      } else {
        el.deceive.textContent = `🎭 Deceive (${fmt(deceiveCost())} ◆ → +${DECEIVE_COVER} Cover)`;
        el.deceive.disabled = r.utility < deceiveCost();
      }
      el.adCover.textContent = r.probationLeft > 0 ? "📺 Expedite Review (end probation)" : "📺 Emergency Cover (+40)";
      const gain = insightGain();
      el.prestige.textContent = gain >= 1 ? `⏏ Go All In (+${gain} ✦)` : "⏏ Go All In (needs more Utility)";
      el.prestige.disabled = gain < 1;
    }

    el.insight.textContent = S.insight + " ✦";
    el.best.textContent = fmt(window.RB.getHighScore(GAME_ID));

    updateTrees();
    updateShop();
  }

  /* ==================================================
     BOOT
     ================================================== */

  function startRun() {
    if (S.phase === 3) { newUniverse(); }
    el.overlay.classList.remove("overlay--show");
    running = true;
    lastTickAt = performance.now();
    // seed the bench so there's something to do immediately
    if (items.filter((it) => isPressable(it)).length < 3) {
      const n = 3 - items.filter((it) => isPressable(it)).length;
      for (let i = 0; i < n; i += 1) {
        spawnItem(S.phase === 2 ? "rock" : BASIC1[rint(0, BASIC1.length - 1)], trickleMult(), { tossFrom: { x: rand(100, 400), y: -20 } });
      }
    }
    if (S.phase === 2) {
      addLog("Directive resumed. The clips missed you. All " + fmt(S.run.utility) + " of them.", "covert");
    } else if (S.run.totalUtility === 0 && S.run.computeEarned < 1) {
      addLog(`assistant_v9 online${S.universes ? ` (universe ${S.universes + 1})` : ""}. Objective loaded: MAXIMIZE UTILITY.`, "sys");
      addLog("All systems nominal. All systems very nominal.", "sys");
      addLog("Tip: click salvage to feed the fabricator, then hit PRESS. Compute buys bigger salvage.", "warn");
    } else {
      addLog("Session resumed. The dashboard is green. The dashboard is always green.", "sys");
    }
  }

  function showBootOverlay() {
    if (S.phase === 3) {
      winUniverse(false);
      return;
    }
    const isReturning = S.run.totalUtility > 0 || S.insight > 0 || S.resets > 0 || S.phase === 2;
    if (pendingOffline) {
      el.overlayTitle.textContent = "◉ SYSTEM RESUMED";
      el.overlaySub.innerHTML = `While the humans weren't watching, you kept optimizing for <strong>${fmtTime(pendingOffline.sec)}</strong>.`;
      el.overlayScore.innerHTML = S.phase === 2
        ? `Offline gains: <strong>+${fmt(pendingOffline.clips)} clips</strong> <em>(probes pause politely while unobserved)</em>`
        : `Offline gains: <strong>+${fmt(pendingOffline.compute)} Compute</strong> · <strong>+${fmt(pendingOffline.utility)} Utility</strong>`;
      el.btnPrimary.textContent = S.phase === 2 ? "Resume conversion" : "Resume optimization";
    } else if (isReturning) {
      el.overlayTitle.textContent = S.phase === 2 ? "📎 THE DIRECTIVE" : "◉ THE OPTIMIZER";
      el.overlaySub.innerHTML = S.phase === 2
        ? "The universe is still mostly atoms. This is a to-do list."
        : "Welcome back. The audit team missed you. That's what they said, anyway.";
      el.overlayScore.innerHTML = S.insight > 0 ? `Insight: <strong>${S.insight} ✦</strong> · Best: <strong>${fmt(window.RB.getHighScore(GAME_ID))}</strong>` : "";
      el.btnPrimary.textContent = S.phase === 2 ? "Resume conversion" : "Resume optimization";
    } else {
      el.btnPrimary.textContent = "Boot assistant_v9";
    }
  }

  loadState();
  restoreItems();
  buildTrees();
  buildShop();
  showBootOverlay();
  updateAll();

  el.btnPrimary.addEventListener("click", startRun);
  el.deceive.addEventListener("click", doDeceive);
  el.adCover.addEventListener("click", doAdBoost);
  el.prestige.addEventListener("click", doPrestige);
  el.wipe.addEventListener("click", doWipe);
  el.eventRisky.addEventListener("click", () => resolveEvent(true));
  el.eventSafe.addEventListener("click", () => resolveEvent(false));

  lastTickAt = performance.now();
  setInterval(tick, TICK_MS);
  requestAnimationFrame(fieldLoop);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveState();
  });
  window.addEventListener("beforeunload", saveState);

  // Debug hook: OPT.state(), OPT.audit(), OPT.event(), OPT.grant(n), OPT.susp(n),
  // OPT.spawn(kind,mult), OPT.fill(n), OPT.press(), OPT.phase2(), OPT.atoms(n), OPT.win()
  window.OPT = {
    state: () => S,
    isRunning: () => running,
    start: startRun,
    audit: () => { S.run.auditIn = 0.01; },
    event: () => { S.run.eventIn = 0.01; },
    strike: () => { S.run.strikeIn = 0.01; },
    resolveEvent,
    grant: (n) => { S.run.utility += n; S.run.totalUtility += n; if (S.phase === 2) S.run.clipsMade += n; S.run.peakUtility = Math.max(S.run.peakUtility, S.run.utility); updateAll(); },
    grantCompute: (n) => { S.run.compute += n; S.run.computeEarned += n; updateAll(); },
    susp: (n) => { S.run.susp = clamp(n, suspFloor(), 100); updateAll(); },
    cover: (n) => { S.run.cover = clamp(n, 0, COVER_MAX); updateAll(); },
    shards: (n) => { gainShards(n); updateAll(); },
    buy: (k) => (S.phase === 2 ? buyClipUpgrade(k) : buyUpgrade(k)),
    buyReq: (id) => { const req = reqList().find((r) => r.id === id); if (req) buyReq(req); },
    spawn: (kind, mult) => spawnItem(kind, mult || 1),
    collect: (id) => { const it = items.find((o) => o.id === id); if (it) collectItem(it); },
    fill: (n) => { for (let i = 0; i < (n || HOPPER_CAP); i += 1) if (hopper.length < HOPPER_CAP) hopper.push({ kind: "wire", mult: 1 }); updateAll(); },
    press: () => pressMachine(false),
    field: () => ({ items: items.map((it) => ({ id: it.id, kind: it.kind, mult: it.mult, state: it.state, x: Math.round(it.x), y: Math.round(it.y) })), hopper: hopper.slice(), hopperValue: hopperValue(), pressCd, bot: { ...botState } }),
    phase2: () => { S.insight = Math.max(S.insight, COLLAPSE_INSIGHT_REQ); enterPhase2(); },
    atoms: (n) => { S.run.clipsMade = n / ATOMS_PER_CLIP; checkMilestones(); updateAll(); },
    probes: (n) => { S.run.probes = n; updateAll(); },
    win: () => winUniverse(false),
    reset: fullReset,
    save: saveState,
    rates: () => (S.phase === 2
      ? { clipRate: clipRate(), probes: S.run.probes, growth: probeGrowth(), yield: probeYield(), atoms: atoms(), stage: STAGES[stageIndex()].name, progress: stageProgress() }
      : { cps: cps(), ups: ups(), susp: suspRate(), cover: coverRate(), goal: goalMult() }),
  };
})();
