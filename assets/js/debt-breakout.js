/* ============================================
   DEBT BREAKOUT
   - A Breakout / Arkanoid parody where every brick is a bill.
   - Paddle = paycheck. Ball = payment. Wall = your monthly statement.
   - Smash the debt before inflation shrinks your paddle and interest
     spawns new charges.
   - 100% synthesized Web Audio (respects window.RBSfx mute).
   - Debug hook: window.__DEBT_BREAKOUT
   ============================================ */
(function () {
  "use strict";

  const GAME_ID = "debt-breakout";
  const W = 900;
  const H = 600;

  /* ---- palette ---- */
  const C = {
    bg0: "#05070d",
    bg1: "#0a1120",
    grid: "rgba(46, 224, 255, 0.10)",
    ink: "#fbfaf4",
    dim: "#aeb5c7",
    cyan: "#2ee0ff",
    pink: "#ff2e88",
    yellow: "#ffd43b",
    green: "#58ff8a",
    red: "#ff4f68",
    purple: "#b06cff",
    orange: "#ff9f45",
    dark: "#020409",
  };

  /* ---- layout geometry ---- */
  const BAND_H = 46;          // on-canvas status band height
  const GRID_TOP = 92;        // first brick row y
  const MARGIN_X = 46;
  const COLS = 11;
  const COL_GAP = 7;
  const ROW_GAP = 8;
  const CELL_H = 30;
  const CELL_W = (W - MARGIN_X * 2 - COL_GAP * (COLS - 1)) / COLS;
  const PADDLE_Y = H - 46;
  const PADDLE_H = 16;
  const BASE_PADDLE_W = 150;
  const BALL_R = 8.5;
  const MAX_MICROBILLS = 14;
  const MAX_BRICKS = 120;     // hard safety cap

  /* ---- brick registry ---------------------------------------------------
     value = the dollar figure printed on the bill (feeds Total Debt meter).
     score = points for clearing it (net relief).                          */
  const TYPES = {
    rent:        { label: "RENT",        color: C.red,    hp: 3, score: 300, value: 1800, tall: true },
    subscription:{ label: "SUB STACK",   color: C.purple, hp: 2, score: 180, value: 29 },
    subscriptionPlus:{ label: "RENEWAL", color: "#8a4bff",hp: 3, score: 120, value: 59 },
    medical:     { label: "COPAY",       color: "#eef2ff",hp: 2, score: 220, value: 420, dark: true },
    studentLoan: { label: "STUDENT LOAN",color: C.cyan,   hp: 4, score: 500, value: 2500 },
    crypto:      { label: "CRYPTO LOSS", color: C.yellow, hp: 1, score: 80,  value: 200, dark: true },
    utilities:   { label: "UTILITIES",   color: "#b6ff3b",hp: 2, score: 160, value: 140, dark: true },
    bnpl:        { label: "BNPL",        color: C.orange, hp: 2, score: 140, value: 96, dark: true },
    zombie:      { label: "ZOMBIE SUB",  color: "#8a9a6a",hp: 1, score: 60,  value: 13, small: true },
    locked:      { label: "ANNUAL RENEWAL", color: "#5b6472", hp: 4, score: 400, value: 899, boss: true },
    refund:      { label: "REFUND",      color: C.green,  hp: 1, score: 500, value: 0, gift: true },
    microbill:   { label: "$2.99",       color: "#d8c48f",hp: 1, score: 40,  value: 9, strip: true },
  };

  /* char -> type for handcrafted layouts */
  const CHAR_TYPE = {
    R: "rent", S: "subscription", s: "subscription", M: "medical", L: "studentLoan",
    C: "crypto", U: "utilities", B: "bnpl", K: "locked", Z: "zombie",
  };

  const MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  /* 12 handcrafted "monthly statement" layouts (11 wide). The cell directly
     below an R is left blank because rent bricks render two cells tall. */
  const LAYOUTS = [
    // 1 — rent + subscriptions (tutorial)
    ["..R.....R..",
     "...........",
     ".SSSSSSSSS.",
     "..SSSSSSS.."],
    // 2 — introduce utilities + inflation
    ["..R.....R..",
     "...........",
     ".USUSUSUSU.",
     ".SSSSSSSSS.",
     "..S.S.S.S.."],
    // 3 — medical splits + BNPL  (boss month; boss row on top)
    ["....KKK....",
     "...........",
     ".M.B.M.B.M.",
     ".SUSUSUSUS."],
    // 4 — student loan enters
    [".R..R..R..",
     "..........",
     ".LSLSLSLS.",
     ".UBUBUBUB.",
     "..S.S.S..."],
    // 5 — crypto volatility
    ["..C..C..C..",
     ".R..R..R..R",
     "...........",
     ".SUMSUMSUM.",
     ".BBB...BBB."],
    // 6 — boss + zombies
    ["....KKK....",
     ".R.......R.",
     "...........",
     ".LCLCLCLCL.",
     ".SUSUSUSUS.",
     "..Z.Z.Z.Z.."],
    // 7 — dense stack
    [".SSSSSSSSS.",
     ".UMUMUMUMU.",
     ".BLBLBLBLB.",
     "..R.....R..",
     "...........",
     ".C.C.C.C.C."],
    // 8 — spread out
    ["R..C..C..R.",
     "...........",
     ".M.L.M.L.M.",
     ".UBUBUBUBU.",
     ".SSS.Z.SSS."],
    // 9 — boss sandwich
    ["...KKKKK...",
     ".R.......R.",
     "...........",
     ".LSLSLSLSL.",
     ".MUMUMUMUM.",
     ".CBCBCBCBC."],
    // 10 — long money pit
    [".LLLLLLLLL.",
     ".SUSUSUSUS.",
     ".MBMBMBMBM.",
     "..R..C..R..",
     "...........",
     ".Z.Z.Z.Z.Z."],
    // 11 — checkerbill
    ["C.C.C.C.C.C",
     ".R..R..R..R",
     "...........",
     "S.U.S.U.S.U",
     ".M.B.M.B.M.",
     "L.L.L.L.L.L"],
    // 12 — annual renewal finale (boss month)
    ["..KK.KK.KK.",
     ".R.......R.",
     "...........",
     ".LMLMLMLML.",
     ".CUBCUBCUB.",
     ".SSSSSSSSS."],
  ];

  /* Accountant / system barks (>= 35) */
  const BARKS = [
    "Interest accrued. Happy now?",
    "That subscription renewed while you were playing.",
    "Congratulations, you paid the minimum.",
    "Your paddle is now worth less due to inflation.",
    "A $2.99 charge became a lifestyle.",
    "Free trial ended. So did your hope.",
    "The rent is, in fact, too damn high.",
    "New statement generated. You're welcome.",
    "Compounding never sleeps. Neither should you.",
    "We noticed unusual activity: you nearly saved money.",
    "Your credit score is a suggestion at this point.",
    "That copay split into two copays. Standard.",
    "Autopay is a lifestyle, not a choice.",
    "Please hold. Your debt is important to us.",
    "You've unlocked: more debt.",
    "The annual renewal you forgot about says hi.",
    "Buy now, cry later.",
    "Inflation is transitory. This bill is not.",
    "A crypto opportunity turned into a crypto loss.",
    "Utilities went up. Again. For reasons.",
    "Your emergency fund is having its own emergency.",
    "Statement cycle complete. Anxiety cycle continues.",
    "We've refreshed your terms and conditions to be worse.",
    "That was the introductory rate. This is the real one.",
    "Somewhere, a subscription is renewing in your name.",
    "You're pre-approved for even more of this.",
    "The line goes down when it's your money.",
    "Financial literacy has left the chat.",
    "Your paycheck shrank but your bills did not.",
    "Refund incoming — don't let free money hit the floor.",
    "Every bill you ignore invites a friend.",
    "Minimum payment made. Maximum regret unlocked.",
    "The bank thanks you for your continued suffering.",
    "Zombie subscriptions rise from the grave at 12 seconds.",
    "You can't outrun the statement. But you can bounce.",
    "Late fee applied out of spite.",
    "We turned your late fee into a subscription.",
    "Numbers go up. Sadly, they're your bills.",
    "This is fine. This is a fine you now owe.",
    "Please clap. Then please pay.",
  ];

  /* --------------------------------------------------------------------- */
  const api =
    (typeof RB !== "undefined" && RB) ||
    window.RB || {
      recordScore() { return false; },
      getHighScore() { return 0; },
      toast() {},
    };

  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const wrap = canvas.closest(".canvas-wrap");
  const overlayEl = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlaySub = document.getElementById("overlay-sub");
  const overlayScore = document.getElementById("overlay-score");
  const btnPrimary = document.getElementById("btn-primary");
  const btnNew = document.getElementById("btn-new");
  const btnPause = document.getElementById("btn-pause");
  const btnSound = document.getElementById("btn-sound");

  const els = {
    score: document.getElementById("hud-score"),
    credit: document.getElementById("hud-credit"),
    inflation: document.getElementById("hud-inflation"),
    debt: document.getElementById("hud-debt"),
    level: document.getElementById("hud-level"),
    combo: document.getElementById("hud-combo"),
    best: document.getElementById("hud-best"),
  };

  const saveSlot = window.RBGameSaves && window.RBGameSaves.create(GAME_ID, { version: 1 });
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const SOUND_PREF_KEY = GAME_ID + ":sound";
  let audioCtx = null;
  let soundOn = readSoundPreference();

  /* ---- helpers ---- */
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function fmt(v) { return Math.round(v).toLocaleString(); }
  function money(v) { return "$" + Math.round(v).toLocaleString(); }
  function sign(v) { return v < 0 ? -1 : 1; }

  function readSoundPreference() {
    try { return localStorage.getItem(SOUND_PREF_KEY) !== "off"; } catch (_) { return true; }
  }
  function writeSoundPreference() {
    try { localStorage.setItem(SOUND_PREF_KEY, soundOn ? "on" : "off"); } catch (_) {}
  }
  function sfxMuted() {
    return !soundOn || (window.RBSfx && typeof window.RBSfx.isMuted === "function" && window.RBSfx.isMuted());
  }

  /* ---- synthesized audio ---- */
  function ensureAudio() {
    if (sfxMuted() || !AudioContextCtor) return null;
    if (!audioCtx) audioCtx = new AudioContextCtor();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }
  function tone(freq, dur, opts) {
    const ac = ensureAudio();
    if (!ac) return;
    const o = opts || {};
    const t0 = ac.currentTime + (o.delay || 0);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(Math.max(1, freq), t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(o.gain || 0.03, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain); gain.connect(ac.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.04);
  }
  function noise(dur, gainValue) {
    const ac = ensureAudio();
    if (!ac) return;
    const len = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    const gain = ac.createGain();
    src.buffer = buf;
    gain.gain.setValueAtTime(gainValue || 0.04, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    src.connect(gain); gain.connect(ac.destination);
    src.start();
  }
  function sfx(name) {
    if (sfxMuted()) return;
    switch (name) {
      case "paddle": tone(300, 0.06, { type: "triangle", to: 220, gain: 0.03 }); break;
      case "tap": tone(520, 0.045, { type: "square", gain: 0.02 }); break;
      case "pay": tone(680, 0.07, { type: "square", gain: 0.026 }); tone(1020, 0.08, { type: "triangle", delay: 0.05, gain: 0.02 }); break;
      case "wall": tone(220, 0.04, { type: "sine", gain: 0.018 }); break;
      case "launch": tone(440, 0.09, { type: "triangle", to: 720, gain: 0.03 }); break;
      case "power": tone(560, 0.08, { type: "square", gain: 0.024 }); tone(840, 0.1, { type: "triangle", delay: 0.06, gain: 0.022 }); tone(1120, 0.1, { type: "triangle", delay: 0.12, gain: 0.02 }); break;
      case "refund": tone(720, 0.09, { type: "sine", gain: 0.03 }); tone(960, 0.09, { type: "sine", delay: 0.07, gain: 0.026 }); tone(1240, 0.12, { type: "sine", delay: 0.14, gain: 0.024 }); break;
      case "interest": tone(180, 0.12, { type: "sawtooth", to: 90, gain: 0.03 }); noise(0.1, 0.03); break;
      case "crypto": noise(0.16, 0.05); tone(140, 0.16, { type: "sawtooth", to: 70, gain: 0.03 }); break;
      case "bad": tone(200, 0.12, { type: "sawtooth", to: 110, gain: 0.03 }); break;
      case "boss": tone(160, 0.3, { type: "sawtooth", to: 80, gain: 0.045 }); noise(0.24, 0.05); break;
      case "drop": tone(260, 0.05, { type: "sine", gain: 0.014 }); break;
      case "levelup": tone(523, 0.1, { type: "square", gain: 0.028 }); tone(659, 0.1, { type: "square", delay: 0.09, gain: 0.026 }); tone(784, 0.16, { type: "square", delay: 0.18, gain: 0.024 }); break;
      case "over": tone(280, 0.22, { type: "sawtooth", to: 80, gain: 0.045 }); noise(0.26, 0.045); break;
      case "miss": tone(240, 0.14, { type: "sawtooth", to: 90, gain: 0.035 }); break;
      case "pause": tone(260, 0.07, { type: "sine", gain: 0.02 }); break;
      default: break;
    }
  }

  /* ---- state ---- */
  let phase = "idle";   // idle | serve | play | intermission | over
  let paused = false;
  let running = false;
  let lastT = 0;
  let rafId = 0;
  let timeMs = 0;

  let score = 0;
  let best = 0;
  let credit = 100;
  let inflation = 0;
  let level = 1;
  let combo = 0;
  let bestCombo = 0;
  let totalDebt = 0;
  let debtCap = 99999;
  let startDebt = 0;
  let destroyedThisLevel = 0;

  let paddle = { x: W / 2, w: BASE_PADDLE_W, targetX: W / 2, vx: 0 };
  let balls = [];
  let bricks = [];
  let drops = [];
  let particles = [];
  let floats = [];
  let shake = 0;

  let statementTimer = 0;
  let statementCycle = 38;
  let interestPipT = 0;
  let interestSpawnT = 0;
  let interMs = 0;
  let currentBark = "";
  let nextDebtPreview = 0;
  let refundSpawnT = -1;   // < 0 means none scheduled this level

  /* buffs (one stateful buff at a time) */
  let overpaymentPending = false;
  let balanceTransferT = 0;
  let pierceBudget = 0;
  let emergencyCharged = false;

  const keys = { left: false, right: false };
  let usingMouse = false;

  /* ---- level speed / difficulty ---- */
  function ballSpeed() { return clamp(360 * Math.pow(1.04, level - 1), 360, 560); }
  function paddleWidth() {
    const shrink = clamp(1 - inflation * 0.006, 0.55, 1);
    let w = BASE_PADDLE_W * shrink;
    if (balanceTransferT > 0) w *= 1.35;
    return clamp(w, BASE_PADDLE_W * 0.55, BASE_PADDLE_W * 1.35);
  }
  function comboMult() { return 1 + Math.floor(combo / 6) * 0.5; }
  // Growth mechanics ramp in so early months stay learnable (tutorial curve).
  function interestActive() { return level >= 3; }   // interest pips + micro-bill spawns
  function zombiesActive() { return level >= 4; }     // zombie-sub renewals

  /* ---- brick construction ---- */
  function makeBrick(typeKey, x, y, w, h) {
    const def = TYPES[typeKey];
    return {
      type: typeKey, def,
      x, y, w, h,
      hp: def.hp, maxHp: def.hp,
      value: def.value,
      color: def.color,
      alive: true,
      interest: 0, interestT: 0,
      hitFlash: 0, spawnT: 0,
      age: 0, age2: 0, renewAt: 8 + Math.random() * 5,
      upgraded: false, spawnedZombie: false, split: false,
      locked: typeKey === "locked",
      immune: typeKey === "studentLoan",
      falling: false, vy: 0,
      glitch: Math.random() * Math.PI * 2,
    };
  }

  function colX(col) { return MARGIN_X + col * (CELL_W + COL_GAP); }
  function rowY(row) { return GRID_TOP + row * (CELL_H + ROW_GAP); }

  function buildLayout(layout) {
    const out = [];
    for (let r = 0; r < layout.length; r += 1) {
      const line = layout[r];
      for (let c = 0; c < COLS; c += 1) {
        const ch = line[c];
        if (!ch || ch === "." || ch === " ") continue;
        const typeKey = CHAR_TYPE[ch];
        if (!typeKey) continue;
        const def = TYPES[typeKey];
        const x = colX(c);
        const y = rowY(r);
        let w = CELL_W;
        let h = CELL_H;
        if (def.tall) h = CELL_H * 2 + ROW_GAP;
        if (def.small) { w = CELL_W * 0.66; h = CELL_H * 0.72; }
        const bx = def.small ? x + (CELL_W - w) / 2 : x;
        const by = def.small ? y + (CELL_H - h) / 2 : y;
        out.push(makeBrick(typeKey, bx, by, w, h));
      }
    }
    return out;
  }

  const PROC_POOL = ["S", "U", "M", "B", "C", "L", "R"];
  function proceduralLayout(lv) {
    // unlock pool progressively even in remix (keeps variety)
    const rows = 4 + (Math.random() < 0.5 ? 1 : 0);
    const grid = [];
    for (let r = 0; r < rows; r += 1) {
      let line = "";
      for (let c = 0; c < COLS; c += 1) {
        // keep the cell below a rent empty
        const above = r > 0 ? grid[r - 1][c] : ".";
        if (above === "R") { line += "."; continue; }
        if (Math.random() < 0.34) { line += "."; continue; }
        let ch = choice(PROC_POOL);
        if (ch === "R" && r >= rows - 1) ch = "U"; // no rent on last row (needs space below)
        line += ch;
      }
      grid.push(line);
    }
    // boss every 3rd month
    if (lv % 3 === 0) {
      const mid = "....KKK....";
      grid[0] = mid;
      if (grid[1]) grid[1] = "...........";
    }
    return grid;
  }

  function recomputeDebt() {
    let sum = 0;
    for (const b of bricks) if (b.alive && !b.falling) sum += b.value;
    totalDebt = sum;
  }

  /* ---- level flow ---- */
  function buildLevel() {
    const layout = level <= LAYOUTS.length ? LAYOUTS[level - 1] : proceduralLayout(level);
    bricks = buildLayout(layout);
    drops = [];
    destroyedThisLevel = 0;
    recomputeDebt();
    startDebt = totalDebt;
    debtCap = Math.round(startDebt * 1.3 + 260);
    statementCycle = Math.max(22, 40 - level * 1.2);
    statementTimer = statementCycle;
    interestPipT = 5;
    interestSpawnT = 10;
    // schedule a refund on some months (2,5,8,11 and ~1/3 of remix months)
    const scheduled = (level % 3 === 2) || (level > 12 && Math.random() < 0.4);
    refundSpawnT = scheduled ? rand(6, 12) : -1;
  }

  function startGame() {
    phase = "serve";
    paused = false;
    running = true;
    score = 0;
    credit = 100;
    inflation = 0;
    level = 1;
    combo = 0;
    bestCombo = 0;
    particles = [];
    floats = [];
    shake = 0;
    clearBuffs();
    emergencyCharged = false;
    paddle.w = BASE_PADDLE_W;
    paddle.x = W / 2;
    paddle.targetX = W / 2;
    buildLevel();
    serveBall();
    hideOverlay();
    if (wrap) wrap.classList.remove("is-paused");
    updateHud();
    canvas.focus({ preventScroll: true });
    sfx("launch");
  }

  function serveBall() {
    balls = [{
      x: paddle.x, y: PADDLE_Y - BALL_R - 1,
      vx: 0, vy: 0, r: BALL_R,
      stuck: true, trail: [],
      vertBounces: 0, horizBounces: 0,
    }];
    phase = "serve";
    // reset student-loan "first hit each ball life" immunity
    for (const b of bricks) if (b.type === "studentLoan" && b.alive) b.immune = true;
  }

  function launchBall() {
    if (phase !== "serve") return;
    const s = ballSpeed();
    const a = rand(-0.42, 0.42);
    for (const ball of balls) {
      ball.stuck = false;
      ball.vx = Math.sin(a) * s * 0.6;
      ball.vy = -Math.abs(Math.cos(a) * s);
      normalizeBall(ball);
    }
    phase = "play";
    sfx("launch");
  }

  function nextLevel() {
    level += 1;
    inflation += 3;                         // each new statement bumps inflation
    combo = 0;
    clearBuffs();
    buildLevel();
    serveBall();
    updateHud();
  }

  function previewDebt(lv) {
    const layout = lv <= LAYOUTS.length ? LAYOUTS[lv - 1] : proceduralLayout(lv);
    let sum = 0;
    for (const line of layout) {
      for (let c = 0; c < COLS; c += 1) {
        const tk = CHAR_TYPE[line[c]];
        if (tk) sum += TYPES[tk].value;
      }
    }
    return sum;
  }

  function enterIntermission() {
    phase = "intermission";
    interMs = 0;
    currentBark = choice(BARKS);
    nextDebtPreview = previewDebt(level + 1);
    sfx("levelup");
    updateHud();
  }

  function clearBuffs() {
    overpaymentPending = false;
    balanceTransferT = 0;
    pierceBudget = 0;
  }

  /* ---- lose / win ---- */
  function loseBallLife() {
    combo = 0;
    credit -= 18;
    addFloat(paddle.x, PADDLE_Y - 30, "PAYMENT BOUNCED -18", C.red);
    sfx("miss");
    if (credit <= 0) { gameOver("Declined everywhere."); return; }
    serveBall();
    updateHud();
  }

  function checkLevelClear() {
    const remaining = bricks.filter((b) => b.alive && !b.falling);
    if (remaining.length === 0) { enterIntermission(); return; }
    // if only locked bricks remain, force-unlock so the level is winnable
    if (remaining.every((b) => b.type === "locked")) unlockBosses(true);
  }

  function gameOver(reason) {
    if (phase === "over") return;
    phase = "over";
    running = false;
    shake = 22;
    sfx("over");
    for (let i = 0; i < 26; i += 1) addParticles(paddle.x, PADDLE_Y, C.red, 1, rand(-160, 160));
    const newHigh = api.recordScore(GAME_ID, score);
    best = Math.max(best, score);
    if (saveSlot) {
      saveSlot.save({
        best, lastScore: score, lastLevel: level, reason,
      }, { score, label: "Debt Breakout" });
    }
    if (newHigh && score > 0) api.toast("New Debt Breakout high score!", "good");
    updateHud();
    showOverlay(
      "STATEMENT OVERDUE",
      reason + " You survived <strong>" + monthName(level) + "</strong>.",
      "Open new statement",
      "Net relief: <strong>" + fmt(score) + "</strong>" + (newHigh && score > 0 ? " — <strong>New high</strong>" : "")
    );
  }

  function monthName(lv) {
    const idx = (lv - 1) % 12;
    const year = Math.floor((lv - 1) / 12);
    return MONTHS[idx] + (year > 0 ? " '2" + (6 + year) : "");
  }

  /* ---- brick interactions ---- */
  function unlockBosses(force) {
    let any = false;
    for (const b of bricks) {
      if (b.alive && b.type === "locked" && b.locked) {
        b.locked = false;
        b.color = C.pink;
        any = true;
        addFloat(b.x + b.w / 2, b.y - 6, "FREE TRIAL ENDED", C.pink);
      }
    }
    if (any && !force) sfx("boss");
  }

  function addScore(base) {
    const gained = Math.round(base * comboMult());
    score += gained;
    return gained;
  }

  function destroyBrick(b, atX, atY) {
    if (!b.alive) return;
    b.alive = false;
    destroyedThisLevel += 1;
    const gained = addScore(b.def.score);
    combo += 1;
    bestCombo = Math.max(bestCombo, combo);
    addFloat(atX, atY, "+" + fmt(gained), C.green);
    addParticles(atX, atY, C.green, 12, 0);
    sfx("pay");

    if (b.type === "subscriptionPlus" && zombiesActive() && Math.random() < 0.25) spawnZombieNear(b);
    if (b.type === "locked" || b.def.boss) {
      shake = Math.max(shake, 16);
      sfx("boss");
      spawnDrop(atX, atY, true);        // guaranteed power-up
    } else if (Math.random() < 0.1) {
      spawnDrop(atX, atY, false);
    }

    if (destroyedThisLevel >= 3) unlockBosses(false);
    recomputeDebt();
  }

  // returns true if the ball should bounce off this brick
  function hitBrick(b, ball) {
    if (!b.alive) return false;

    if (b.type === "locked" && b.locked) { sfx("wall"); return true; }

    if (b.type === "studentLoan" && b.immune) {
      b.immune = false;
      b.hitFlash = 1;
      addFloat(b.x + b.w / 2, b.y - 4, "COMPOUNDING", C.cyan);
      sfx("wall");
      return true;
    }

    b.interest = 0; b.interestT = 0; b.hitFlash = 1;

    // Overpayment — pay off fully regardless of HP / split rules
    if (overpaymentPending) {
      overpaymentPending = false;
      addFloat(b.x + b.w / 2, b.y - 4, "PAID IN FULL", C.yellow);
      destroyBrick(b, b.x + b.w / 2, b.y + b.h / 2);
      return pierceBudget <= 0;
    }

    // Medical splits into 2 microbills on first hit
    if (b.type === "medical" && !b.split) {
      b.split = true; b.alive = false;
      addFloat(b.x + b.w / 2, b.y - 4, "SPLIT!", C.pink);
      addParticles(b.x + b.w / 2, b.y + b.h / 2, "#eef2ff", 8, 0);
      spawnMicrobillAt(b.x - 2, b.y + 2);
      spawnMicrobillAt(b.x + b.w * 0.5 + 2, b.y + 2);
      sfx("tap");
      recomputeDebt();
      return handleBounceReturn();
    }

    // BNPL splits horizontally into two half-width bricks on first hit
    if (b.type === "bnpl" && !b.split) {
      b.split = true; b.alive = false;
      const halfW = (b.w - 3) / 2;
      const left = makeBrick("bnpl", b.x, b.y, halfW, b.h);
      const right = makeBrick("bnpl", b.x + halfW + 3, b.y, halfW, b.h);
      left.split = true; right.split = true;
      left.hp = 1; right.hp = 1; left.maxHp = 1; right.maxHp = 1;
      left.value = Math.round(b.value / 2); right.value = Math.round(b.value / 2);
      pushBrick(left); pushBrick(right);
      addFloat(b.x + b.w / 2, b.y - 4, "4 EASY PAYMENTS", C.orange);
      sfx("tap");
      recomputeDebt();
      return handleBounceReturn();
    }

    // Utilities bump inflation on every hit
    if (b.type === "utilities") {
      inflation += 2;
      addFloat(b.x + b.w / 2, b.y - 4, "INFLATION +2%", "#b6ff3b");
    }

    // Crypto volatility (hp 1, so this also destroys it)
    if (b.type === "crypto") {
      shake = Math.max(shake, 10);
      if (Math.random() < 0.55) {
        score += 50;
        addFloat(b.x + b.w / 2, b.y - 14, "+50 PUMP", C.green);
      } else {
        score = Math.max(0, score - 30);
        credit -= 10;
        addFloat(b.x + b.w / 2, b.y - 14, "-30 / -10 CR RUG", C.red);
      }
      sfx("crypto");
    }

    b.hp -= 1;
    if (b.hp <= 0) {
      destroyBrick(b, b.x + b.w / 2, b.y + b.h / 2);
    } else {
      addParticles(b.x + b.w / 2, b.y + b.h / 2, b.color, 4, 0);
      sfx("tap");
    }
    return handleBounceReturn();
  }

  function handleBounceReturn() {
    if (pierceBudget > 0) { pierceBudget -= 1; return false; }
    return true;
  }

  function pushBrick(b) { if (bricks.length < MAX_BRICKS) bricks.push(b); }

  function countMicrobills() {
    let n = 0;
    for (const b of bricks) if (b.alive && b.type === "microbill") n += 1;
    return n;
  }

  function spawnMicrobillAt(x, y) {
    if (countMicrobills() >= MAX_MICROBILLS) return null;
    const w = CELL_W * 0.5;
    const h = CELL_H * 0.5;
    const bx = clamp(x, MARGIN_X, W - MARGIN_X - w);
    const by = clamp(y, GRID_TOP, PADDLE_Y - 160);
    const b = makeBrick("microbill", bx, by, w, h);
    b.value = 8 + level * 4;                 // debt contribution grows with level
    b.spawnT = 0.3;
    pushBrick(b);
    return b;
  }

  function spawnZombieNear(parent) {
    const w = CELL_W * 0.66, h = CELL_H * 0.72;
    const bx = clamp(parent.x + rand(-20, 20), MARGIN_X, W - MARGIN_X - w);
    const by = clamp(parent.y + rand(-6, 24), GRID_TOP, PADDLE_Y - 150);
    const b = makeBrick("zombie", bx, by, w, h);
    b.spawnT = 0.3;
    pushBrick(b);
    addFloat(bx + w / 2, by - 4, "ZOMBIE SUB", "#b6ff3b");
    recomputeDebt();
  }

  function trySpawnInterest(b) {
    // spawn an adjacent microbill if there's room
    const candidates = [
      [b.x + b.w + 4, b.y],
      [b.x - CELL_W * 0.5 - 4, b.y],
      [b.x, b.y + b.h + 4],
    ];
    for (const [cx, cy] of candidates) {
      if (cx < MARGIN_X || cx > W - MARGIN_X - CELL_W * 0.5) continue;
      if (cy > PADDLE_Y - 150) continue;
      const mb = spawnMicrobillAt(cx, cy);
      if (mb) {
        addFloat(cx + CELL_W * 0.25, cy - 4, "INTEREST", C.red);
        addParticles(cx + CELL_W * 0.25, cy, C.red, 6, 0);
        sfx("interest");
        recomputeDebt();
        return true;
      }
    }
    return false;
  }

  function spawnRefund() {
    const w = CELL_W * 0.9, h = CELL_H;
    const bx = clamp(rand(MARGIN_X, W - MARGIN_X - w), MARGIN_X, W - MARGIN_X - w);
    const b = makeBrick("refund", bx, GRID_TOP + 6, w, h);
    b.falling = true;
    b.vy = 72;
    b.spawnT = 0.4;
    pushBrick(b);
    addFloat(bx + w / 2, GRID_TOP - 2, "FREE MONEY!", C.green);
    sfx("refund");
  }

  function collectRefund(b) {
    b.alive = false;
    const gained = addScore(b.def.score);
    credit = Math.min(120, credit + 5);
    addFloat(b.x + b.w / 2, b.y - 6, "REFUND +" + fmt(gained), C.green);
    addParticles(b.x + b.w / 2, b.y + b.h / 2, C.green, 18, 0);
    sfx("refund");
  }

  /* ---- power-up drops ---- */
  const POWERUPS = {
    overpayment:     { label: "OVERPAYMENT", color: C.yellow },
    balanceTransfer: { label: "BAL. TRANSFER", color: C.cyan },
    sideHustle:      { label: "SIDE HUSTLE", color: C.green },
    autopay:         { label: "AUTOPAY", color: C.pink },
    chargeback:      { label: "CHARGEBACK", color: C.orange },
    emergencyFund:   { label: "EMERGENCY FUND", color: "#ff6f9d" },
  };
  const POWER_KEYS = Object.keys(POWERUPS);
  const BOSS_POWER_KEYS = ["overpayment", "sideHustle", "balanceTransfer", "autopay"];

  function spawnDrop(x, y, boss) {
    const kind = boss ? choice(BOSS_POWER_KEYS) : choice(POWER_KEYS);
    drops.push({ x, y, vy: 88, kind, w: 78, h: 22, t: 0 });
    sfx("drop");
  }

  function applyPowerup(kind) {
    sfx("power");
    const def = POWERUPS[kind];
    addFloat(paddle.x, PADDLE_Y - 30, def.label + "!", def.color);
    if (kind === "overpayment") {
      clearBuffs(); overpaymentPending = true;
    } else if (kind === "balanceTransfer") {
      clearBuffs(); balanceTransferT = 8;
    } else if (kind === "autopay") {
      clearBuffs(); pierceBudget = 4;
    } else if (kind === "sideHustle") {
      splitBalls();
    } else if (kind === "chargeback") {
      chargeback();
    } else if (kind === "emergencyFund") {
      emergencyCharged = true;
    }
    updateHud();
  }

  function splitBalls() {
    const live = balls.filter((b) => !b.stuck);
    const src = live.length ? live : balls;
    const added = [];
    for (const ball of src.slice(0, 2)) {
      for (let i = 0; i < 1; i += 1) {
        const s = ballSpeed();
        const a = rand(-0.9, 0.9);
        added.push({
          x: ball.x, y: ball.y,
          vx: Math.sin(a) * s, vy: -Math.abs(Math.cos(a) * s),
          r: BALL_R, stuck: false, trail: [],
          vertBounces: 0, horizBounces: 0,
        });
      }
    }
    for (const b of added) { normalizeBall(b); balls.push(b); }
    if (phase === "serve" && balls.some((b) => !b.stuck)) phase = "play";
  }

  function chargeback() {
    let removed = 0;
    for (const b of bricks) {
      if (b.alive && (b.type === "zombie" || b.type === "microbill")) {
        b.alive = false; removed += 1;
        addParticles(b.x + b.w / 2, b.y + b.h / 2, C.orange, 6, 0);
      }
    }
    if (removed) addFloat(W / 2, H * 0.5, "CHARGEBACK CLEARED " + removed, C.orange);
    recomputeDebt();
    checkLevelClear();
  }

  function consumeEmergencyFund(manual) {
    if (!emergencyCharged) return;
    emergencyCharged = false;
    credit = Math.min(120, credit + 15);
    addFloat(paddle.x, PADDLE_Y - 34, "EMERGENCY FUND +15", "#ff6f9d");
    sfx("power");
    updateHud();
  }

  /* ---- effects ---- */
  function addFloat(x, y, text, color) {
    floats.push({ x, y, text, color, life: 900, ttl: 900 });
  }
  function addParticles(x, y, color, count, vxBias) {
    for (let i = 0; i < count; i += 1) {
      particles.push({
        x, y,
        vx: (vxBias || 0) + rand(-90, 90),
        vy: rand(-150, 40),
        r: rand(1.6, 4), color,
        life: rand(300, 640), ttl: 640,
      });
    }
  }

  /* ---- ball physics ---- */
  function normalizeBall(ball) {
    const s = ballSpeed();
    let m = Math.hypot(ball.vx, ball.vy) || 1;
    ball.vx = ball.vx / m * s;
    ball.vy = ball.vy / m * s;
    // avoid too-horizontal trajectories (anti-stuck)
    const minVy = s * 0.26;
    if (Math.abs(ball.vy) < minVy) {
      ball.vy = (ball.vy < 0 ? -1 : 1) * minVy;
      const vx2 = s * s - ball.vy * ball.vy;
      ball.vx = (ball.vx < 0 ? -1 : 1) * Math.sqrt(Math.max(0, vx2));
    }
  }

  function circleRectHit(cx, cy, r, rx, ry, rw, rh) {
    const nx = clamp(cx, rx, rx + rw);
    const ny = clamp(cy, ry, ry + rh);
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy <= r * r;
  }

  function reflectOffRect(ball, b) {
    // decide reflection axis from normalized center offset
    const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    const px = (ball.x - bcx) / (b.w / 2 + ball.r);
    const py = (ball.y - bcy) / (b.h / 2 + ball.r);
    if (Math.abs(px) > Math.abs(py)) {
      ball.vx = Math.abs(ball.vx) * sign(px);
      ball.x = px > 0 ? b.x + b.w + ball.r + 0.5 : b.x - ball.r - 0.5;
      ball.horizBounces += 1; ball.vertBounces = 0;
    } else {
      ball.vy = Math.abs(ball.vy) * sign(py);
      ball.y = py > 0 ? b.y + b.h + ball.r + 0.5 : b.y - ball.r - 0.5;
      ball.vertBounces += 1; ball.horizBounces = 0;
    }
  }

  function moveBall(ball, dts) {
    const dist = Math.hypot(ball.vx, ball.vy) * dts;
    const steps = Math.max(1, Math.ceil(dist / (BALL_R * 0.9)));
    const sx = (ball.vx * dts) / steps;
    const sy = (ball.vy * dts) / steps;
    for (let i = 0; i < steps; i += 1) {
      ball.x += sx; ball.y += sy;

      // walls
      if (ball.x - ball.r < MARGIN_X * 0.35) { ball.x = MARGIN_X * 0.35 + ball.r; ball.vx = Math.abs(ball.vx); ball.horizBounces += 1; sfx("wall"); }
      else if (ball.x + ball.r > W - MARGIN_X * 0.35) { ball.x = W - MARGIN_X * 0.35 - ball.r; ball.vx = -Math.abs(ball.vx); ball.horizBounces += 1; sfx("wall"); }
      if (ball.y - ball.r < BAND_H + 4) { ball.y = BAND_H + 4 + ball.r; ball.vy = Math.abs(ball.vy); ball.vertBounces += 1; sfx("wall"); }

      // paddle
      const pw = paddle.w;
      const pxL = paddle.x - pw / 2, pxR = paddle.x + pw / 2;
      if (ball.vy > 0 && ball.y + ball.r >= PADDLE_Y && ball.y - ball.r <= PADDLE_Y + PADDLE_H &&
          ball.x >= pxL - ball.r && ball.x <= pxR + ball.r) {
        ball.y = PADDLE_Y - ball.r - 0.5;
        const nx = clamp((ball.x - paddle.x) / (pw / 2), -1, 1);
        const angle = nx * 1.05;                      // classic paddle steering
        const s = ballSpeed();
        ball.vx = Math.sin(angle) * s + paddle.vx * 0.18;
        ball.vy = -Math.abs(Math.cos(angle) * s);
        ball.vertBounces = 0; ball.horizBounces = 0;
        normalizeBall(ball);
        sfx("paddle");
        continue;
      }

      // bricks
      for (let bi = 0; bi < bricks.length; bi += 1) {
        const b = bricks[bi];
        if (!b.alive) continue;
        if (!circleRectHit(ball.x, ball.y, ball.r, b.x, b.y, b.w, b.h)) continue;
        if (b.type === "refund") { collectRefund(b); continue; }
        const shouldBounce = hitBrick(b, ball);
        if (shouldBounce) { reflectOffRect(ball, b); normalizeBall(ball); }
        break; // one brick interaction per micro-step
      }

      // anti-stuck nudges
      if (ball.horizBounces > 6) { ball.vy += (ball.vy < 0 ? -1 : 1) * 30; ball.horizBounces = 0; normalizeBall(ball); }
      if (ball.vertBounces > 8) { ball.vx += (ball.vx < 0 ? -1 : 1) * 30 + rand(-10, 10); ball.vertBounces = 0; normalizeBall(ball); }
    }
  }

  /* ---- update ---- */
  function update(dt) {
    timeMs += dt;
    const dts = dt / 1000;

    if (phase === "intermission") {
      interMs += dt;
      updateEffects(dt);
      if (interMs >= 1500) nextLevel();
      return;
    }

    if (!running || paused) { updateEffects(dt); return; }

    // paddle movement
    paddle.w = paddleWidth();
    const prevX = paddle.x;
    if (usingMouse) {
      paddle.x = lerp(paddle.x, paddle.targetX, 0.35);
    } else {
      const spd = 620;
      if (keys.left) paddle.x -= spd * dts;
      if (keys.right) paddle.x += spd * dts;
    }
    paddle.x = clamp(paddle.x, paddle.w / 2 + 6, W - paddle.w / 2 - 6);
    paddle.vx = (paddle.x - prevX) / Math.max(0.0001, dts);

    // buffs
    if (balanceTransferT > 0) balanceTransferT = Math.max(0, balanceTransferT - dts);

    if (phase === "serve") {
      for (const ball of balls) if (ball.stuck) { ball.x = paddle.x; ball.y = PADDLE_Y - ball.r - 1; }
      updateEffects(dt);
      updateDropsAndRefunds(dt);
      updateHud();
      return;
    }

    // time-based inflation drift
    inflation += dts * 0.05;

    // statement timer (recurring rent)
    statementTimer -= dts;
    if (statementTimer <= 0) {
      let rentAlive = 0;
      for (const b of bricks) if (b.alive && b.type === "rent") rentAlive += 1;
      if (rentAlive > 0) {
        credit -= 5 * rentAlive;
        inflation += 1;
        addFloat(W / 2, BAND_H + 24, "RENT DUE -" + (5 * rentAlive) + " CREDIT", C.red);
        sfx("bad");
        if (credit <= 0) { gameOver("Rent came due and you couldn't cover it."); return; }
      }
      statementTimer = Math.max(16, statementCycle * 0.7);
    }

    // interest pips (starts month 3 — early months stay calm)
    interestPipT -= dts;
    if (interestPipT <= 0) {
      interestPipT = 5;
      if (interestActive()) {
        for (const b of bricks) {
          if (!b.alive || b.falling) continue;
          if (b.type === "microbill" || (b.type === "locked" && b.locked)) continue;
          b.interest = Math.min(3, b.interest + 1);
        }
      }
    }
    // interest spawns microbills from anything with >= 2 pips
    interestSpawnT -= dts;
    if (interestSpawnT <= 0) {
      interestSpawnT = 10;
      if (interestActive()) {
        const ripe = bricks.filter((b) => b.alive && !b.falling && b.interest >= 2 && b.type !== "microbill");
        let spawned = 0;
        for (const b of ripe) { if (spawned >= 3) break; if (trySpawnInterest(b)) spawned += 1; else break; }
      }
    }

    // per-brick timers (subscription upgrades, zombie renewals)
    for (const b of bricks) {
      if (!b.alive) continue;
      b.hitFlash = Math.max(0, b.hitFlash - dts * 4);
      b.spawnT = Math.max(0, b.spawnT - dts);
      if (b.type === "subscription") {
        b.age += dts;
        if (b.age >= b.renewAt && !b.upgraded) {
          b.upgraded = true;
          b.type = "subscriptionPlus";
          b.def = TYPES.subscriptionPlus;
          b.color = TYPES.subscriptionPlus.color;
          b.hp += 1; b.maxHp = b.hp;
          b.value = TYPES.subscriptionPlus.value;
          addFloat(b.x + b.w / 2, b.y - 4, "RENEWED", C.purple);
          if (interestActive()) spawnMicrobillAt(b.x + b.w * 0.5, b.y + b.h + 4);
          recomputeDebt();
        }
      } else if (b.type === "subscriptionPlus") {
        b.age2 += dts;
        if (b.age2 >= 12 && !b.spawnedZombie && zombiesActive()) {
          b.spawnedZombie = true;
          spawnZombieNear(b);
        }
      }
    }

    // refund scheduling
    if (refundSpawnT >= 0) {
      refundSpawnT -= dts;
      if (refundSpawnT <= 0) { refundSpawnT = -1; spawnRefund(); }
    }

    updateDropsAndRefunds(dt);

    // balls
    for (const ball of balls) if (!ball.stuck) {
      ball.trail.push({ x: ball.x, y: ball.y });
      if (ball.trail.length > 8) ball.trail.shift();
      moveBall(ball, dts);
    }
    // remove fallen balls
    const before = balls.length;
    balls = balls.filter((b) => b.y - b.r <= H + 4);
    if (balls.length === 0 && before > 0 && phase === "play") { loseBallLife(); }

    // emergency fund auto-consume
    if (emergencyCharged && credit <= 15 && credit > 0) consumeEmergencyFund(false);

    recomputeDebt();

    // lose: underwater
    if (totalDebt > debtCap) { gameOver("You're underwater."); return; }
    if (credit <= 0) { gameOver("Declined everywhere."); return; }

    // win level
    if (phase === "play") checkLevelClear();

    updateEffects(dt);
    updateHud();
  }

  function updateDropsAndRefunds(dt) {
    const dts = dt / 1000;
    // power-up drops
    for (const d of drops) {
      d.y += d.vy * dts; d.t += dts;
      const pw = paddle.w;
      if (d.y + d.h / 2 >= PADDLE_Y && d.y - d.h / 2 <= PADDLE_Y + PADDLE_H &&
          d.x >= paddle.x - pw / 2 - 8 && d.x <= paddle.x + pw / 2 + 8) {
        d.caught = true;
        applyPowerup(d.kind);
      }
    }
    drops = drops.filter((d) => !d.caught && d.y - d.h / 2 < H + 10);

    // falling refunds
    for (const b of bricks) {
      if (!b.alive || !b.falling) continue;
      b.y += b.vy * dts;
      if (b.y > PADDLE_Y + 6) {
        b.alive = false;
        credit -= 20;
        addFloat(b.x + b.w / 2, PADDLE_Y - 10, "MISSED FREE MONEY -20", C.red);
        sfx("bad");
        if (credit <= 0 && phase === "play") { gameOver("You left free money on the floor."); return; }
      }
    }
  }

  function updateEffects(dt) {
    shake = Math.max(0, shake - dt * 0.05);
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt / 1000;
      p.y += p.vy * dt / 1000;
      p.vy += 360 * dt / 1000;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const f of floats) { f.life -= dt; f.y -= dt * 0.03; }
    floats = floats.filter((f) => f.life > 0);
  }

  /* ---- rendering ---- */
  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.bg1);
    g.addColorStop(1, C.bg0);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < W; x += 45) { ctx.moveTo(x, BAND_H); ctx.lineTo(x, H); }
    for (let y = BAND_H; y < H; y += 45) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }

  function bar(x, y, w, h, t, color, bg) {
    ctx.fillStyle = bg || "rgba(255,255,255,0.08)";
    roundRect(x, y, w, h, 4); ctx.fill();
    ctx.fillStyle = color;
    roundRect(x, y, w * clamp(t, 0, 1), h, 4); ctx.fill();
  }

  function drawStatusBand() {
    ctx.save();
    ctx.fillStyle = "rgba(2,4,9,0.82)";
    ctx.fillRect(0, 0, W, BAND_H);
    ctx.strokeStyle = "rgba(46,224,255,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, BAND_H + 0.5); ctx.lineTo(W, BAND_H + 0.5); ctx.stroke();

    ctx.font = "800 10px JetBrains Mono, monospace";
    ctx.textBaseline = "middle";

    // inflation
    ctx.textAlign = "left";
    ctx.fillStyle = C.dim;
    ctx.fillText("INFLATION", 16, 15);
    const infT = clamp(inflation / 75, 0, 1);
    bar(16, 24, 200, 10, infT, inflation > 55 ? C.red : (inflation > 30 ? C.orange : "#b6ff3b"));
    ctx.fillStyle = C.ink;
    ctx.fillText(inflation.toFixed(0) + "%  (paddle -" + Math.round((1 - clamp(1 - inflation * 0.006, 0.55, 1)) * 100) + "%)", 222, 29);

    // debt
    ctx.textAlign = "left";
    ctx.fillStyle = C.dim;
    ctx.fillText("DEBT ON STATEMENT", 430, 15);
    const debtT = clamp(totalDebt / debtCap, 0, 1);
    bar(430, 24, 200, 10, debtT, debtT > 0.8 ? C.red : (debtT > 0.6 ? C.orange : C.cyan));
    ctx.fillStyle = C.ink;
    ctx.fillText(money(totalDebt) + " / " + money(debtCap), 636, 29);

    // statement countdown + combo
    ctx.textAlign = "right";
    ctx.fillStyle = C.dim;
    ctx.fillText("STATEMENT DUE", W - 16, 15);
    const secs = Math.max(0, Math.ceil(statementTimer));
    ctx.fillStyle = statementTimer < 6 ? C.red : C.yellow;
    ctx.font = "800 13px JetBrains Mono, monospace";
    ctx.fillText("0:" + (secs < 10 ? "0" : "") + secs, W - 16, 30);
    ctx.restore();
  }

  function drawBrick(b) {
    if (!b.alive) return;
    const flashed = b.hitFlash > 0;
    ctx.save();
    if (b.spawnT > 0) ctx.globalAlpha = clamp(1 - b.spawnT * 2, 0.2, 1);

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    roundRect(b.x + 2, b.y + 3, b.w, b.h, 5); ctx.fill();

    // glitch border for crypto
    if (b.type === "crypto") {
      b.glitch += 0.2;
      ctx.strokeStyle = Math.sin(b.glitch) > 0 ? C.pink : C.cyan;
      ctx.lineWidth = 2;
      roundRect(b.x - 1 + Math.sin(b.glitch * 3) * 1.5, b.y - 1, b.w + 2, b.h + 2, 5);
      ctx.stroke();
    }

    // body
    let col = b.color;
    ctx.fillStyle = col;
    roundRect(b.x, b.y, b.w, b.h, 5); ctx.fill();

    // compounding glow for student loan (immune)
    if (b.type === "studentLoan" && b.immune) {
      ctx.strokeStyle = "rgba(46,224,255," + (0.4 + Math.sin(timeMs * 0.006) * 0.3) + ")";
      ctx.lineWidth = 3;
      roundRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2, 6); ctx.stroke();
    }
    // boss (unlocked renewal) pulse
    if (b.def.boss && !b.locked) {
      ctx.strokeStyle = "rgba(255,46,136," + (0.4 + Math.sin(timeMs * 0.008) * 0.35) + ")";
      ctx.lineWidth = 3;
      roundRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2, 6); ctx.stroke();
    }
    // refund gift sparkle
    if (b.type === "refund") {
      ctx.strokeStyle = "rgba(88,255,138," + (0.5 + Math.sin(timeMs * 0.012) * 0.4) + ")";
      ctx.lineWidth = 3;
      roundRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2, 6); ctx.stroke();
    }

    // top hp/highlight strip
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    roundRect(b.x + 3, b.y + 3, b.w - 6, 4, 2); ctx.fill();

    // flash on hit
    if (flashed) {
      ctx.globalAlpha = b.hitFlash * 0.5;
      ctx.fillStyle = "#ffffff";
      roundRect(b.x, b.y, b.w, b.h, 5); ctx.fill();
      ctx.globalAlpha = b.spawnT > 0 ? clamp(1 - b.spawnT * 2, 0.2, 1) : 1;
    }

    // text
    const dark = b.def.dark || b.type === "refund";
    ctx.fillStyle = dark ? "#10131c" : C.ink;
    ctx.textAlign = "center";
    if (!b.def.strip && !b.def.small) {
      ctx.font = "800 7.5px JetBrains Mono, monospace";
      ctx.textBaseline = "top";
      ctx.fillText(labelFor(b), b.x + b.w / 2, b.y + (b.def.tall ? 8 : 6));
      ctx.font = b.def.tall ? "900 15px JetBrains Mono, monospace" : "900 11px JetBrains Mono, monospace";
      ctx.textBaseline = "middle";
      ctx.fillText(b.type === "refund" ? "+$" + b.value : money(b.value), b.x + b.w / 2, b.y + b.h / 2 + (b.def.tall ? 4 : 3));
    } else {
      ctx.font = "800 8px JetBrains Mono, monospace";
      ctx.textBaseline = "middle";
      ctx.fillText(b.type === "microbill" ? money(b.value) : "SUB", b.x + b.w / 2, b.y + b.h / 2);
    }

    // icon adornments
    drawBrickIcon(b, dark);

    // HP pips (multi-hit bricks)
    if (b.maxHp > 1 && !b.def.strip && b.hp > 0) {
      const pipW = 5, gap = 2;
      const totalW = b.maxHp * pipW + (b.maxHp - 1) * gap;
      let px = b.x + b.w / 2 - totalW / 2;
      const py = b.y + b.h - 6;
      for (let i = 0; i < b.maxHp; i += 1) {
        ctx.fillStyle = i < b.hp ? (dark ? "#10131c" : "rgba(255,255,255,0.9)") : "rgba(0,0,0,0.25)";
        ctx.fillRect(px, py, pipW, 3);
        px += pipW + gap;
      }
    }

    // interest pips (top-right dots)
    if (b.interest > 0) {
      for (let i = 0; i < b.interest; i += 1) {
        ctx.fillStyle = i >= 2 ? C.red : C.orange;
        ctx.beginPath();
        ctx.arc(b.x + b.w - 6 - i * 6, b.y + 6, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function labelFor(b) {
    if (b.type === "locked" && b.locked) return "LOCKED";
    return b.def.label;
  }

  function drawBrickIcon(b, dark) {
    const cx = b.x + b.w / 2;
    const iy = b.y + b.h - 13;
    ctx.strokeStyle = dark ? "#10131c" : C.ink;
    ctx.fillStyle = dark ? "#10131c" : C.ink;
    ctx.lineWidth = 1.4;
    if (b.type === "medical") {
      ctx.fillStyle = C.red;
      ctx.fillRect(b.x + 6, b.y + 6, 4, 12);
      ctx.fillRect(b.x + 2, b.y + 10, 12, 4);
    } else if (b.type === "locked") {
      const lx = b.x + b.w - 14, ly = b.y + 6;
      ctx.strokeRect(lx, ly + 4, 9, 7);
      ctx.beginPath(); ctx.arc(lx + 4.5, ly + 4, 3, Math.PI, 0); ctx.stroke();
    } else if (b.type === "utilities") {
      ctx.beginPath();
      ctx.moveTo(cx + 3, iy - 4); ctx.lineTo(cx - 3, iy + 1);
      ctx.lineTo(cx, iy + 1); ctx.lineTo(cx - 2, iy + 5);
      ctx.lineTo(cx + 4, iy - 1); ctx.lineTo(cx + 1, iy - 1);
      ctx.closePath(); ctx.fill();
    } else if (b.type === "refund") {
      // gift bow
      ctx.fillStyle = "#10131c";
      ctx.beginPath();
      ctx.moveTo(cx, b.y + 5);
      ctx.lineTo(cx - 5, b.y + 2); ctx.lineTo(cx - 5, b.y + 8);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, b.y + 5);
      ctx.lineTo(cx + 5, b.y + 2); ctx.lineTo(cx + 5, b.y + 8);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawPaddle() {
    const pw = paddle.w;
    const x = paddle.x - pw / 2;
    const stress = clamp((inflation - 10) / 60, 0, 1);
    const col = stress > 0 ? mixHex(C.green, C.orange, stress) : C.green;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    roundRect(x + 2, PADDLE_Y + 3, pw, PADDLE_H, 7); ctx.fill();
    ctx.fillStyle = col;
    roundRect(x, PADDLE_Y, pw, PADDLE_H, 7); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    roundRect(x + 3, PADDLE_Y + 2, pw - 6, 4, 2); ctx.fill();
    ctx.fillStyle = "#0a1a10";
    ctx.font = "800 9px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (pw > 90) ctx.fillText("PAYCHECK", paddle.x, PADDLE_Y + PADDLE_H / 2);
    else ctx.fillText("$", paddle.x, PADDLE_Y + PADDLE_H / 2);
    if (balanceTransferT > 0) {
      ctx.strokeStyle = "rgba(46,224,255,0.7)";
      ctx.lineWidth = 2;
      roundRect(x - 2, PADDLE_Y - 2, pw + 4, PADDLE_H + 4, 8); ctx.stroke();
    }
    ctx.restore();
  }

  function drawBalls() {
    for (const ball of balls) {
      // trail
      for (let i = 0; i < ball.trail.length; i += 1) {
        const t = ball.trail[i];
        ctx.globalAlpha = (i / ball.trail.length) * 0.4;
        ctx.fillStyle = pierceBudget > 0 ? C.pink : C.yellow;
        ctx.beginPath(); ctx.arc(t.x, t.y, ball.r * 0.7, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // coin
      ctx.fillStyle = pierceBudget > 0 ? C.pink : C.yellow;
      ctx.strokeStyle = "#7a5b00";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#3a2c00";
      ctx.font = "900 10px JetBrains Mono, monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("$", ball.x, ball.y + 0.5);
    }
    ctx.globalAlpha = 1;
  }

  function drawDrops() {
    for (const d of drops) {
      const def = POWERUPS[d.kind];
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(Math.sin(d.t * 3) * 0.08);
      ctx.fillStyle = "rgba(2,4,9,0.9)";
      roundRect(-d.w / 2, -d.h / 2, d.w, d.h, 5); ctx.fill();
      ctx.strokeStyle = def.color; ctx.lineWidth = 2;
      roundRect(-d.w / 2, -d.h / 2, d.w, d.h, 5); ctx.stroke();
      // little "receipt" tear at the bottom
      ctx.fillStyle = def.color;
      ctx.fillRect(-d.w / 2, d.h / 2 - 2, d.w, 2);
      ctx.fillStyle = def.color;
      ctx.font = "800 9px JetBrains Mono, monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(def.label, 0, 0);
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.ttl, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFloats() {
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "900 13px JetBrains Mono, monospace";
    for (const f of floats) {
      ctx.globalAlpha = clamp(f.life / f.ttl, 0, 1);
      ctx.fillStyle = f.color;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.lineWidth = 4;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }

  function drawBuffChip() {
    const chips = [];
    if (overpaymentPending) chips.push(["OVERPAYMENT READY", C.yellow]);
    if (balanceTransferT > 0) chips.push(["BAL. TRANSFER " + balanceTransferT.toFixed(0) + "s", C.cyan]);
    if (pierceBudget > 0) chips.push(["AUTOPAY x" + pierceBudget, C.pink]);
    if (emergencyCharged) chips.push(["EMERGENCY FUND [E]", "#ff6f9d"]);
    if (!chips.length) return;
    ctx.save();
    ctx.font = "800 10px JetBrains Mono, monospace";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    let y = PADDLE_Y - 4;
    for (const [text, color] of chips) {
      const w = ctx.measureText(text).width + 16;
      const x = 14;
      ctx.fillStyle = "rgba(2,4,9,0.82)";
      roundRect(x, y - 9, w, 16, 5); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 1.4;
      roundRect(x, y - 9, w, 16, 5); ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(text, x + 8, y);
      y -= 20;
    }
    ctx.restore();
  }

  function drawServeHint() {
    if (phase !== "serve") return;
    ctx.save();
    ctx.globalAlpha = 0.6 + Math.sin(timeMs * 0.006) * 0.3;
    ctx.fillStyle = C.ink;
    ctx.font = "800 13px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText("CLICK / SPACE / ↑ TO SEND THE PAYMENT", W / 2, PADDLE_Y - 40);
    ctx.restore();
  }

  function drawIntermission() {
    if (phase !== "intermission") return;
    ctx.save();
    ctx.fillStyle = "rgba(2,4,9,0.7)";
    ctx.fillRect(0, BAND_H, W, H - BAND_H);
    ctx.textAlign = "center";
    ctx.fillStyle = C.yellow;
    ctx.font = "900 30px Bungee, Impact, sans-serif";
    ctx.fillText(monthName(level) + " CLEARED", W / 2, H * 0.36);
    ctx.fillStyle = C.ink;
    ctx.font = "800 14px JetBrains Mono, monospace";
    wrapText('"' + currentBark + '"', W / 2, H * 0.48, 640, 22);
    ctx.fillStyle = C.dim;
    ctx.font = "800 13px JetBrains Mono, monospace";
    ctx.fillText("NEXT: " + monthName(level + 1).toUpperCase() + " STATEMENT", W / 2, H * 0.60);
    ctx.fillStyle = C.red;
    ctx.fillText("Debt incoming: " + money(nextDebtPreview), W / 2, H * 0.66);
    ctx.fillStyle = C.cyan;
    ctx.fillText("Net relief so far: " + fmt(score), W / 2, H * 0.72);
    ctx.restore();
  }

  function wrapText(text, x, y, maxW, lineH) {
    const words = text.split(" ");
    let line = "";
    let yy = y;
    for (const word of words) {
      const test = line + word + " ";
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line.trim(), x, yy);
        line = word + " "; yy += lineH;
      } else line = test;
    }
    ctx.fillText(line.trim(), x, yy);
  }

  function drawScanlines() {
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = "#000";
    for (let y = BAND_H; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    ctx.restore();
  }

  function render() {
    ctx.save();
    if (shake > 0) ctx.translate(rand(-shake, shake) * 0.3, rand(-shake, shake) * 0.3);
    drawBackground();
    for (const b of bricks) drawBrick(b);
    drawDrops();
    drawPaddle();
    drawBalls();
    drawParticles();
    drawServeHint();
    drawBuffChip();
    drawFloats();
    drawStatusBand();
    drawScanlines();
    drawIntermission();
    ctx.restore();
  }

  function mixHex(a, b, t) {
    const pa = hexToRgb(a), pb = hexToRgb(b);
    const r = Math.round(lerp(pa[0], pb[0], t));
    const g = Math.round(lerp(pa[1], pb[1], t));
    const bl = Math.round(lerp(pa[2], pb[2], t));
    return "rgb(" + r + "," + g + "," + bl + ")";
  }
  function hexToRgb(h) {
    const s = h.replace("#", "");
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  /* ---- HUD / overlay ---- */
  function updateHud() {
    if (els.score) els.score.textContent = fmt(score);
    if (els.credit) { els.credit.textContent = Math.max(0, Math.round(credit)); els.credit.style.color = credit <= 20 ? C.red : ""; }
    if (els.inflation) els.inflation.textContent = inflation.toFixed(0) + "%";
    if (els.debt) els.debt.textContent = money(totalDebt);
    if (els.level) els.level.textContent = monthName(level);
    if (els.combo) els.combo.textContent = "x" + comboMult().toFixed(1);
    if (els.best) els.best.textContent = fmt(Math.max(best, score));
  }

  function showOverlay(title, sub, button, scoreHtml) {
    overlayTitle.textContent = title;
    overlaySub.innerHTML = sub;
    overlayScore.innerHTML = scoreHtml || "";
    btnPrimary.textContent = button;
    overlayEl.classList.add("overlay--show");
  }
  function hideOverlay() { overlayEl.classList.remove("overlay--show"); }

  /* ---- pause ---- */
  function togglePause(playSound) {
    if (phase !== "play" && phase !== "serve") return;
    paused = !paused;
    running = !paused;
    if (wrap) wrap.classList.toggle("is-paused", paused);
    if (btnPause) btnPause.textContent = paused ? "Resume" : "Pause";
    if (paused) {
      showOverlay("PAYMENT ON HOLD",
        "The statement waits. Interest is technically still thinking about it.",
        "Resume run",
        "Net relief: <strong>" + fmt(score) + "</strong> — " + monthName(level));
    } else {
      hideOverlay();
      lastT = performance.now();
      canvas.focus({ preventScroll: true });
    }
    if (playSound !== false) sfx("pause");
  }

  /* ---- input ---- */
  function primaryAction() {
    if (phase === "idle" || phase === "over") { startGame(); return; }
    if (paused) { togglePause(false); return; }
    if (phase === "serve") { launchBall(); return; }
  }

  function pointerX(e) {
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX == null && e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
    return ((cx - rect.left) / Math.max(1, rect.width)) * W;
  }

  function bindInput() {
    canvas.addEventListener("pointermove", (e) => {
      usingMouse = true;
      paddle.targetX = clamp(pointerX(e), 0, W);
    });
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      usingMouse = true;
      paddle.targetX = clamp(pointerX(e), 0, W);
      primaryAction();
    });
    // touch drag
    canvas.addEventListener("touchmove", (e) => {
      if (e.touches && e.touches[0]) {
        usingMouse = true;
        paddle.targetX = clamp(pointerX(e), 0, W);
        e.preventDefault();
      }
    }, { passive: false });

    document.addEventListener("keydown", (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key;
      if (k === "ArrowLeft" || k === "a" || k === "A") { keys.left = true; usingMouse = false; e.preventDefault(); }
      else if (k === "ArrowRight" || k === "d" || k === "D") { keys.right = true; usingMouse = false; e.preventDefault(); }
      else if (k === " " || k === "ArrowUp" || k === "w" || k === "W") { e.preventDefault(); primaryAction(); }
      else if (k === "p" || k === "P" || k === "Escape") { e.preventDefault(); togglePause(); }
      else if (k === "e" || k === "E") { e.preventDefault(); if (emergencyCharged) consumeEmergencyFund(true); }
      else if (k === "Enter" && (phase === "idle" || phase === "over")) { e.preventDefault(); startGame(); }
    });
    document.addEventListener("keyup", (e) => {
      const k = e.key;
      if (k === "ArrowLeft" || k === "a" || k === "A") keys.left = false;
      else if (k === "ArrowRight" || k === "d" || k === "D") keys.right = false;
    });

    if (btnPrimary) btnPrimary.addEventListener("click", () => {
      if (paused) togglePause(false);
      else if (phase === "serve") launchBall();
      else startGame();
    });
    if (btnNew) btnNew.addEventListener("click", startGame);
    if (btnPause) btnPause.addEventListener("click", () => togglePause());
    if (btnSound) btnSound.addEventListener("click", toggleSound);

    document.addEventListener("rainbot:sfx-muted", setSoundLabel);
  }

  function setSoundLabel() {
    if (!btnSound) return;
    const effectiveOff = sfxMuted();
    btnSound.textContent = effectiveOff ? "Sound Off" : "Sound On";
    btnSound.setAttribute("aria-pressed", String(!effectiveOff));
  }
  function toggleSound() {
    soundOn = !soundOn;
    writeSoundPreference();
    setSoundLabel();
    if (!sfxMuted()) sfx("pay");
  }

  function bindFullscreen() {
    const fsBtn = document.getElementById("btn-fullscreen");
    const fsTarget = wrap || canvas.parentElement;
    if (!fsBtn || !fsTarget) return;
    const isMaxed = () => fsTarget.classList.contains("is-maxed");
    const nativeFsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    const updateBtn = () => {
      const on = isMaxed();
      fsBtn.textContent = on ? "✕" : "⛶";
      fsBtn.setAttribute("aria-label", on ? "Exit max screen" : "Max screen");
      fsBtn.setAttribute("title", on ? "Exit" : "Max screen");
    };
    const setMaxed = (on) => {
      fsTarget.classList.toggle("is-maxed", on);
      document.body.classList.toggle("rb-game-maxed", on);
      updateBtn();
      if (on) canvas.focus({ preventScroll: true });
    };
    fsBtn.addEventListener("click", () => {
      const on = !isMaxed();
      setMaxed(on);
      if (on) {
        const req = fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen;
        if (req) { try { const r = req.call(fsTarget); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
      } else if (nativeFsEl()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) { try { exit.call(document); } catch (_) {} }
      }
    });
    const onNativeFsChange = () => { if (!nativeFsEl() && isMaxed()) setMaxed(false); };
    document.addEventListener("fullscreenchange", onNativeFsChange);
    document.addEventListener("webkitfullscreenchange", onNativeFsChange);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isMaxed() && !nativeFsEl()) setMaxed(false); });
    updateBtn();
  }

  /* ---- loop ---- */
  function frame(t) {
    const dt = Math.min(50, t - (lastT || t));
    lastT = t;
    update(dt || 16);
    render();
    rafId = requestAnimationFrame(frame);
  }

  // deterministic stepper for headless / preview testing
  function step(n, dtMs) {
    const count = n || 60;
    const dt = dtMs || 1000 / 60;
    for (let i = 0; i < count; i += 1) update(dt);
    render();
  }

  function loadBest() {
    best = api.getHighScore(GAME_ID) || 0;
    if (!best && saveSlot) {
      const saved = saveSlot.read();
      if (saved && saved.data) best = Number(saved.data.best || 0);
    }
  }

  function idleScene() {
    phase = "idle";
    level = 1; inflation = 0; credit = 100; score = 0; combo = 0;
    buildLevel();
    balls = [{ x: paddle.x, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0, r: BALL_R, stuck: true, trail: [] }];
    updateHud();
    render();
    showOverlay(
      "DEBT BREAKOUT",
      "Your paddle is your paycheck. The ball is a payment. Every brick is a bill — rent, subs, copays, BNPL. Smash the debt before inflation shrinks your paddle and interest spawns new charges.",
      "Open statement",
      best > 0 ? "High score: <strong>" + fmt(best) + "</strong>" : ""
    );
  }

  /* ---- boot ---- */
  loadBest();
  bindInput();
  bindFullscreen();
  setSoundLabel();
  idleScene();
  if (saveSlot) {
    const saved = saveSlot.read();
    if (saved && saved.data && saved.data.lastScore) {
      overlayScore.innerHTML = "Last statement: <strong>" + fmt(saved.data.lastScore) +
        "</strong> relief through <strong>" + monthName(saved.data.lastLevel || 1) + "</strong>";
    }
  }
  lastT = performance.now();
  rafId = requestAnimationFrame(frame);

  window.__DEBT_BREAKOUT = {
    start: startGame,
    launchBall: () => { if (phase === "serve") launchBall(); else { serveBall(); launchBall(); } },
    clearLevel: () => { for (const b of bricks) if (b.type !== "refund") b.alive = false; recomputeDebt(); checkLevelClear(); },
    spawnBrick: (typeKey, col, row) => {
      const key = TYPES[typeKey] ? typeKey : "subscription";
      const b = makeBrick(key, colX(col || 0), rowY(row || 0), CELL_W, CELL_H);
      pushBrick(b); recomputeDebt(); return b;
    },
    powerup: (kind) => applyPowerup(POWERUPS[kind] ? kind : "overpayment"),
    spawnRefund,
    setInflation: (v) => { inflation = Number(v) || 0; updateHud(); },
    setCredit: (v) => { credit = Number(v) || 0; updateHud(); },
    god: () => { credit = 999; },
    aim: (x) => { usingMouse = true; paddle.targetX = clamp(Number(x) || W / 2, 0, W); },
    get ballX() { const b = balls.find((bb) => !bb.stuck) || balls[0]; return b ? Math.round(b.x) : W / 2; },
    step,
    over: () => gameOver("manually closed"),
    get state() {
      return {
        phase, paused, level, month: monthName(level),
        score, credit: Math.round(credit),
        inflation: Number(inflation.toFixed(1)),
        totalDebt, debtCap, combo, comboMult: comboMult(),
        paddleW: Math.round(paddle.w),
        balls: balls.length,
        bricks: bricks.filter((b) => b.alive && !b.falling).length,
        types: (() => { const t = {}; for (const b of bricks) if (b.alive) t[b.type] = (t[b.type] || 0) + 1; return t; })(),
        lockedStill: bricks.filter((b) => b.alive && b.type === "locked" && b.locked).length,
        refunds: bricks.filter((b) => b.alive && b.falling).length,
        microbills: countMicrobills(),
        drops: drops.length,
        buffs: { overpaymentPending, balanceTransferT: Number(balanceTransferT.toFixed(1)), pierceBudget, emergencyCharged },
      };
    },
  };

  window.addEventListener("beforeunload", () => { if (rafId) cancelAnimationFrame(rafId); });
})();
