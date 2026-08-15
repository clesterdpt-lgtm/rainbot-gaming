/* ==========================================================================
   BOOMER MONOPOLY — DELUXE SATIRICAL HOUSING BOARD GAME
   --------------------------------------------------------------------------
   Loud, juicy, satirical housing market simulator:
   - 3D Tumbling Dice Physics with dynamic tumble rotation & clatter audio.
   - Parabolic Pawn Hopping with squash-and-stretch and landing dust.
   - Flying Cash Bezier Particles for rent extractions and tax audits.
   - Rubber Stamp Purchase Slam VFX ("SOLD!", "ALL CASH!", "OVER ASKING").
   - 3D Isometric Houses and Luxury Boomer McMansions on upgraded deeds.
   - Animated 3D Satirical Card Flips for HOA notices and cable news chaos.
   - Procedural Web Audio Engine (dice clatter, hops, cash register, stamps).
   - Country-Club Mahogany & Felt Board with animated market heat gauge.
   ========================================================================== */

(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const GAME_ID = "boomer_monopoly";
  const MAX_ROUNDS = 16;

  const api = window.RB || {
    showRewarded: () => Promise.resolve(true),
    isAdFree: () => false,
    recordScore: () => false,
    getHighScore: () => 0,
    toast: (message) => console.log(message),
  };

  const el = {
    cash: document.getElementById("hud-cash"),
    worth: document.getElementById("hud-worth"),
    round: document.getElementById("hud-round"),
    high: document.getElementById("hud-high"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlaySub: document.getElementById("overlay-sub"),
    overlayScore: document.getElementById("overlay-score"),
    primary: document.getElementById("btn-primary"),
    roll: document.getElementById("btn-roll"),
    buy: document.getElementById("btn-buy"),
    pass: document.getElementById("btn-pass"),
    pause: document.getElementById("btn-pause"),
    restart: document.getElementById("btn-restart"),
    decisionKicker: document.getElementById("decision-kicker"),
    decisionText: document.getElementById("decision-text"),
    decisionMeta: document.getElementById("decision-meta"),
    playerList: document.getElementById("player-list"),
    eventLog: document.getElementById("event-log"),
    powerups: document.getElementById("powerups"),
  };

  // =========================================================================
  // 1. PROCEDURAL WEB AUDIO SYNTHESIZER
  // =========================================================================

  const audio = {
    ctx: null,
    master: null,
    enabled: localStorage.getItem("rb-boomer-sound") !== "off"
  };

  function initAudio() {
    if (!audio.enabled || audio.ctx) return audio.ctx;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      audio.ctx = new AudioCtx();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.28;
      audio.master.connect(audio.ctx.destination);
      return audio.ctx;
    } catch (e) {
      audio.enabled = false;
      return null;
    }
  }

  function playTone(freq, dur = 0.12, type = "sine", gainVal = 0.2, delay = 0) {
    if (!audio.enabled) return;
    const actx = initAudio();
    if (!actx || !audio.master) return;
    const t = actx.currentTime + delay;
    const osc = actx.createOscillator();
    const g = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gainVal, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(audio.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function playNoise(dur = 0.15, gainVal = 0.2, filterFreq = 1000) {
    if (!audio.enabled) return;
    const actx = initAudio();
    if (!actx || !audio.master) return;
    const buffer = actx.createBuffer(1, Math.floor(actx.sampleRate * dur), actx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const src = actx.createBufferSource();
    src.buffer = buffer;
    const filter = actx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterFreq;

    const g = actx.createGain();
    g.gain.setValueAtTime(gainVal, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);

    src.connect(filter);
    filter.connect(g);
    g.connect(audio.master);
    src.start();
  }

  function playSfx(type) {
    if (!audio.enabled) return;
    initAudio();
    if (audio.ctx?.state === "suspended") audio.ctx.resume();

    switch (type) {
      case "dice_rattle":
        playNoise(0.08, 0.18, 1600);
        playTone(320 + Math.random() * 200, 0.05, "triangle", 0.15);
        break;

      case "dice_land":
        playNoise(0.12, 0.28, 900);
        playTone(180, 0.12, "triangle", 0.25);
        break;

      case "hop":
        playTone(380 + Math.random() * 60, 0.08, "sine", 0.14);
        break;

      case "cash":
        // Classic cash register bell & cha-ching
        playTone(987.77, 0.14, "sine", 0.22);
        playTone(1318.51, 0.25, "sine", 0.26, 0.08);
        playTone(1975.53, 0.35, "triangle", 0.20, 0.14);
        break;

      case "stamp":
        playNoise(0.20, 0.35, 450);
        playTone(90, 0.18, "sawtooth", 0.30);
        break;

      case "card_flip":
        playNoise(0.10, 0.15, 2400);
        playTone(520, 0.10, "triangle", 0.16);
        break;

      case "buzzer":
        playTone(140, 0.25, "sawtooth", 0.24);
        playTone(120, 0.30, "sawtooth", 0.24, 0.10);
        break;

      case "upgrade":
        playTone(440, 0.08, "triangle", 0.18);
        playTone(554.37, 0.10, "triangle", 0.20, 0.06);
        playTone(659.25, 0.16, "sine", 0.24, 0.12);
        break;

      case "fanfare":
        playTone(523.25, 0.12, "triangle", 0.22);
        playTone(659.25, 0.12, "triangle", 0.22, 0.10);
        playTone(783.99, 0.14, "triangle", 0.25, 0.20);
        playTone(1046.50, 0.40, "sine", 0.30, 0.32);
        break;
    }
  }

  function setSoundEnabled(enabled) {
    audio.enabled = enabled;
    localStorage.setItem("rb-boomer-sound", enabled ? "on" : "off");
    updateSoundButton();
    if (enabled) {
      initAudio();
      if (audio.ctx?.state === "suspended") audio.ctx.resume();
      api.toast("Sound on");
    } else {
      api.toast("Sound muted");
    }
  }

  function updateSoundButton() {
    const btn = document.getElementById("btn-sound");
    if (!btn) return;
    btn.textContent = audio.enabled ? "Sound on" : "Muted";
    btn.setAttribute("aria-pressed", audio.enabled ? "true" : "false");
  }

  // =========================================================================
  // 2. PALETTE & THEME CONFIGURATION
  // =========================================================================

  const COLORS = {
    bg: "#05090f",
    panel: "#0b1420",
    inner: "#122019",
    ink: "#fbfaf4",
    muted: "#9ba8ba",
    cream: "#fff2c2",
    navy: "#07111f",
    brown: "#6e3f22",
    lawn: "#4ade80",
    pink: "#ff2e88",
    cyan: "#2ee0ff",
    yellow: "#ffd43b",
    green: "#4ade80",
    red: "#ff3b56",
    orange: "#ff9f43",
    purple: "#b16cff",
    gold: "#f59e0b",
  };

  const SPACE_TEMPLATES = [
    { type: "start", name: "Paid-Off Start", label: ["PAID-OFF", "START"], note: "Collect $200 when you pass." },
    { type: "property", name: "Split-Level Starter", label: ["SPLIT", "LEVEL"], group: COLORS.pink, cost: 120, rent: 18, upgrade: 60 },
    { type: "property", name: "Carpeted Den Duplex", label: ["CARPET", "DEN"], group: COLORS.pink, cost: 140, rent: 22, upgrade: 65 },
    { type: "card", name: "HOA Notice", label: ["HOA", "NOTICE"] },
    { type: "property", name: "Lake House Tax Shelter", label: ["LAKE", "HOUSE"], group: COLORS.cyan, cost: 180, rent: 28, upgrade: 75 },
    { type: "tax", name: "Property Tax Surprise", label: ["PROPERTY", "TAX"], amount: 95 },
    { type: "property", name: "Duplex Empire", label: ["DUPLEX", "EMPIRE"], group: COLORS.cyan, cost: 210, rent: 34, upgrade: 90 },
    { type: "bonus", name: "Early Bird Dinner", label: ["EARLY", "BIRD"], amount: 75 },
    { type: "property", name: "Boat Garage Ranch", label: ["BOAT", "GARAGE"], group: COLORS.yellow, cost: 230, rent: 38, upgrade: 105 },
    { type: "card", name: "Neighborhood App", label: ["NEIGHBOR", "APP"] },
    { type: "property", name: "Golf Cart Villas", label: ["GOLF", "VILLAS"], group: COLORS.yellow, cost: 260, rent: 44, upgrade: 115 },
    { type: "property", name: "Basement Rental Suite", label: ["BASEMENT", "SUITE"], group: COLORS.yellow, cost: 280, rent: 48, upgrade: 125 },
    { type: "tax", name: "Student Loan Lecture", label: ["LOAN", "LECTURE"], amount: 110 },
    { type: "property", name: "Cul-de-sac Castle", label: ["CUL-DE", "SAC"], group: COLORS.green, cost: 310, rent: 55, upgrade: 145 },
    { type: "bonus", name: "Garage Sale Flip", label: ["GARAGE", "SALE"], amount: 90 },
    { type: "property", name: "Timeshare Mirage", label: ["TIME", "SHARE"], group: COLORS.green, cost: 340, rent: 62, upgrade: 160 },
    { type: "card", name: "Cable News Card", label: ["CABLE", "NEWS"] },
    { type: "property", name: "Reverse Mortgage Row", label: ["REVERSE", "ROW"], group: COLORS.green, cost: 380, rent: 70, upgrade: 175 },
    { type: "skip", name: "Zoning Board", label: ["ZONING", "BOARD"] },
    { type: "property", name: "Airbnb Adjacent ADU", label: ["AIRBNB", "ADU"], group: COLORS.orange, cost: 420, rent: 82, upgrade: 190 },
    { type: "property", name: "Pickleball Preserve", label: ["PICKLE", "BALL"], group: COLORS.orange, cost: 455, rent: 90, upgrade: 210 },
    { type: "bonus", name: "Inheritance Rumor", label: ["INHERIT", "RUMOR"], amount: 130 },
    { type: "property", name: "Gated Community Gate", label: ["GATED", "GATE"], group: COLORS.purple, cost: 500, rent: 105, upgrade: 240 },
    { type: "card", name: "Market Mood", label: ["MARKET", "MOOD"] },
    { type: "property", name: "Pension Pointe", label: ["PENSION", "POINTE"], group: COLORS.purple, cost: 540, rent: 118, upgrade: 260 },
    { type: "market", name: "Rate Hike", label: ["RATE", "HIKE"], amount: -0.08 },
    { type: "property", name: "Legacy Lane", label: ["LEGACY", "LANE"], group: COLORS.purple, cost: 600, rent: 135, upgrade: 290 },
    { type: "market", name: "Market Rally", label: ["MARKET", "RALLY"], amount: 0.1 },
  ];

  const CARD_DECK = [
    { title: "Refinance Window", kicker: "BANKER FAVORS", text: "A loan officer remembers your golf handicap. Instant equity tap.", cash: 150, icon: "🏦" },
    { title: "Avocado Toast Lecture", kicker: "UNSOLICITED ADVICE", text: "You monologue for 45 minutes at brunch and lose your wallet.", cash: -75, icon: "🥑" },
    { title: "Inherited China Cabinet", kicker: "ESTATE APPRAISAL", text: "Dusty floral plates appraised for outrageous antique value.", cash: 120, icon: "🏺" },
    { title: "County Reassessment", kicker: "TAX AUDIT", text: "The satellite drone spotted your illegal gazebo and deck extension.", cash: -135, icon: "📋" },
    { title: "Zoning Board Coup", kicker: "SPECIAL PERMIT", text: "Your brother-in-law approves a free instant renovation.", upgrade: true, icon: "🔨" },
    { title: "Real Estate Euphoria", kicker: "MARKET FRENZY", text: "National cable news says home values only go up forever.", heat: 0.09, icon: "📈" },
    { title: "Interest Rate Hike", kicker: "PANIC SELLERS", text: "Mortgage rates tick up 0.5% and open houses go dead silent.", heat: -0.08, icon: "📉" },
    { title: "Basement Rental", kicker: "CASH FLOW", text: "Rented your unfinished crawlspace to a digital nomad for top dollar.", cash: 140, icon: "💵" },
    { title: "HOA Lawn Violation", kicker: "FINE ISSUED", text: "Grass measured 0.25 inches over the neighborhood covenant limit.", cash: -90, icon: "🌾" },
    { title: "Curb Appeal Crown", kicker: "BLOCK LEADER", text: "Each rival pays you $40 tribute for your manicured front yard.", collectFromAll: 40, icon: "👑" },
  ];

  const HEADLINES = [
    "Local 2-bedroom shed listed as 'Rustic Luxury' for $950,000.",
    "HOA bans passing clouds for casting shadows on artificial turf.",
    "Gary insists 18% mortgage rates in 1982 built character.",
    "Neighborhood app sounds 5-alarm alert over jogger stretching on sidewalk.",
    "Open house attendees fight over last warm cheese cube.",
    "Barb calls her 14th rental acquisition 'just a humble hobby'.",
  ];

  const CASH_BITS = {
    buy: ["DEED ACQUIRED!", "ESCROW CLOSED!", "ALL CASH OFFER!", "NO CONTINGENCIES!"],
    upgrade: ["GRANITE COUNTERS!", "RVO POPPED!", "RENT TRIPLED!", "OPEN FLOOR PLAN!"],
    rent: ["RENT EXTRACTED!", "MAILBOX MONEY!", "PASSIVE INCOME!", "YIELD COLLECTED!"],
    bad: ["TAX PENALTY!", "HOA CITATION!", "WALLET DRAINED!", "ESCROW SHOCK!"],
    good: ["EQUITY SURGE!", "BONUS DIVIDEND!", "WINDFALL CASH!", "COUPON CLIPPED!"],
  };

  // =========================================================================
  // 3. GAME STATE
  // =========================================================================

  const state = {
    board: [],
    players: [],
    current: 0,
    round: 1,
    dice: [1, 1],
    phase: "intro",
    pendingDecision: null,
    selectedSpace: 0,
    marketHeat: 0.05,
    paused: false,
    gameOver: false,
    busy: false,
    log: [],

    // Visual FX & Animations
    particles: [],            // Floating cash, dust, confetti
    callouts: [],             // Floating text banners
    flyingBills: [],          // Curved flying dollar bill transfers
    stamps: [],               // Red rubber stamp slam animations
    activeCard: null,         // 3D Card flip modal entity
    diceAnim: {
      active: false,
      timer: 0,
      maxTimer: 0.7,
      dice1: { x: 0, y: 0, vx: 0, vy: 0, rot: 0, vrot: 0, val: 1 },
      dice2: { x: 0, y: 0, vx: 0, vy: 0, rot: 0, vrot: 0, val: 1 },
    },
    pawnAnim: {
      active: false,
      player: null,
      startPos: 0,
      targetPos: 0,
      currentStep: 0,
      totalSteps: 0,
      stepT: 0,
      onComplete: null,
    },

    headline: HEADLINES[0],
    shake: 0,
    actionPulse: 0,
    lastTime: 0,
    boardRects: [],
  };

  const saveSlot = window.RBGameSaves && window.RBGameSaves.create(GAME_ID, { version: 2 });
  const CENTER_PANEL = { x: 116, y: 116, w: 488, h: 488 };

  const money = (amount) => {
    const sign = amount < 0 ? "-" : "";
    return `${sign}$${Math.abs(Math.round(amount)).toLocaleString()}`;
  };

  const choice = (items) => items[Math.floor(Math.random() * items.length)];

  function randomHeadline() {
    return choice(HEADLINES);
  }

  function spaceCenter(index) {
    const rect = state.boardRects[index];
    if (!rect) return { x: W / 2, y: H / 2 };
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  }

  function addImpact(spaceIndex, text, color, intensity = 1) {
    const pos = typeof spaceIndex === "number" ? spaceCenter(spaceIndex) : { x: W / 2, y: H / 2 };
    spawnParticles(pos.x, pos.y, color, 18 + Math.round(intensity * 10));
    spawnCallout(pos.x, pos.y - 20, text, color);
    state.shake = Math.max(state.shake, 0.22 * intensity);
    state.actionPulse = Math.max(state.actionPulse, 0.85);
  }

  function cloneBoard() {
    return SPACE_TEMPLATES.map((space, index) => ({
      ...space,
      index,
      owner: null,
      level: 0,
    }));
  }

  function makePlayers() {
    return [
      { id: "you", name: "You", color: COLORS.yellow, chipColor: "#ffd43b", cash: 1500, pos: 0, skip: 0, bankrupt: false, rentShield: 0, isHuman: true, hopY: 0, squash: 1 },
      { id: "gary", name: "Gary", color: COLORS.cyan, chipColor: "#2ee0ff", cash: 1500, pos: 0, skip: 0, bankrupt: false, rentShield: 0, buyBias: 0.68, hopY: 0, squash: 1 },
      { id: "linda", name: "Linda", color: COLORS.pink, chipColor: "#ff2e88", cash: 1500, pos: 0, skip: 0, bankrupt: false, rentShield: 0, buyBias: 0.56, hopY: 0, squash: 1 },
      { id: "barb", name: "Barb", color: COLORS.green, chipColor: "#4ade80", cash: 1500, pos: 0, skip: 0, bankrupt: false, rentShield: 0, buyBias: 0.74, hopY: 0, squash: 1 },
    ];
  }

  function resetGame() {
    if (saveSlot) saveSlot.clear();
    state.board = cloneBoard();
    state.players = makePlayers();
    state.current = 0;
    state.round = 1;
    state.dice = [1, 1];
    state.phase = "await_roll";
    state.pendingDecision = null;
    state.selectedSpace = 0;
    state.marketHeat = 0.05;
    state.paused = false;
    state.gameOver = false;
    state.busy = false;
    state.log = [];
    state.particles = [];
    state.callouts = [];
    state.flyingBills = [];
    state.stamps = [];
    state.activeCard = null;
    state.diceAnim.active = false;
    state.pawnAnim.active = false;
    state.headline = randomHeadline();
    state.shake = 0;
    state.actionPulse = 0;
    hideOverlay();
    log("Entered the housing market with $1,500 and aggressive confidence.");
    beginTurn();
    renderPowerups();
    updateUI();
  }

  function activePlayer() {
    return state.players[state.current];
  }

  function humanPlayer() {
    return state.players[0];
  }

  function netWorth(player) {
    const deedValue = state.board.reduce((sum, space) => {
      if (space.owner !== player.id || space.type !== "property") return sum;
      const market = 1 + state.marketHeat;
      return sum + space.cost * market + space.level * space.upgrade * 0.85;
    }, 0);
    return Math.round(player.cash + deedValue);
  }

  function ownedSpaces(player) {
    return state.board.filter((space) => space.owner === player.id && space.type === "property");
  }

  function rentFor(space) {
    const heat = 1 + Math.max(-0.15, Math.min(0.40, state.marketHeat));
    return Math.max(8, Math.round(space.rent * (1 + space.level * 0.8) * heat));
  }

  function log(message) {
    state.log.unshift(message);
    state.log = state.log.slice(0, 8);
    if (Math.random() < 0.42) state.headline = randomHeadline();
  }

  // =========================================================================
  // 4. TURN PROGRESSION & GAME LOGIC
  // =========================================================================

  function beginTurn() {
    if (state.gameOver) return;

    const player = activePlayer();
    state.pendingDecision = null;

    if (player.bankrupt) {
      nextTurn(300);
      return;
    }

    if (state.current === 0 && state.round > MAX_ROUNDS) {
      finishByWorth();
      return;
    }

    if (player.skip > 0) {
      player.skip -= 1;
      log(`${player.name} stuck arguing at the zoning board.`);
      playSfx("buzzer");
      nextTurn(player.isHuman ? 900 : 550);
      updateUI();
      return;
    }

    state.phase = player.isHuman ? "await_roll" : "ai_thinking";
    setDecision(
      player.isHuman ? "Your Turn" : `${player.name}'s Turn`,
      player.isHuman ? "Roll the dice to advance your real estate empire." : `${player.name} is examining mortgage rates...`,
      `Market Heat: ${Math.round(state.marketHeat * 100)}%`
    );
    updateUI();

    if (!player.isHuman) {
      setTimeout(() => {
        if (!state.paused && !state.gameOver) rollForActive();
      }, 700);
    }
  }

  function nextTurn(delay = 600) {
    if (state.gameOver) return;
    state.pendingDecision = null;
    state.phase = "between_turns";
    updateUI();

    setTimeout(() => {
      if (state.gameOver) return;
      state.current = (state.current + 1) % state.players.length;
      if (state.current === 0) state.round += 1;
      beginTurn();
    }, delay);
  }

  function rollForActive() {
    const player = activePlayer();
    if (state.paused || state.gameOver || state.busy || player.bankrupt) return;
    if (player.isHuman && state.phase !== "await_roll") return;
    if (!player.isHuman && state.phase !== "ai_thinking") return;

    const d1 = rollDie();
    const d2 = rollDie();
    state.dice = [d1, d2];
    const steps = d1 + d2;
    state.busy = true;
    state.phase = "moving";

    setDecision("Rolling Dice...", `${player.name} rolls for equity!`, "Tumbling across the board...");
    updateUI();

    startDiceAnimation(d1, d2, () => {
      setDecision("Moving", `${player.name} rolled ${d1} + ${d2} (${steps}).`, "Advancing through the cul-de-sacs.");
      updateUI();

      startPawnHopAnimation(player, steps, () => {
        state.busy = false;
        resolveSpace(player);
      });
    });
  }

  function rollDie() {
    return 1 + Math.floor(Math.random() * 6);
  }

  // =========================================================================
  // 5. ANIMATION CONTROLLERS (DICE, PAWN HOPS, FLYING CASH, STAMPS)
  // =========================================================================

  function startDiceAnimation(finalD1, finalD2, onComplete) {
    playSfx("dice_rattle");
    state.diceAnim = {
      active: true,
      timer: 0,
      maxTimer: 0.65,
      onComplete,
      dice1: {
        x: W * 0.5 - 75 + rand(-20, 20),
        y: H * 0.5 - 20 + rand(-15, 15),
        vx: rand(-40, 40),
        vy: rand(-40, 40),
        rot: rand(0, Math.PI * 2),
        vrot: rand(14, 24),
        val: randi(1, 7),
        finalVal: finalD1
      },
      dice2: {
        x: W * 0.5 + 25 + rand(-20, 20),
        y: H * 0.5 - 20 + rand(-15, 15),
        vx: rand(-40, 40),
        vy: rand(-40, 40),
        rot: rand(0, Math.PI * 2),
        vrot: rand(14, 24),
        val: randi(1, 7),
        finalVal: finalD2
      }
    };
  }

  function updateDiceAnimation(dt) {
    const da = state.diceAnim;
    if (!da.active) return;
    da.timer += dt;
    const progress = da.timer / da.maxTimer;

    // Tumble physics
    [da.dice1, da.dice2].forEach((d) => {
      d.x += d.vx * dt * 4;
      d.y += d.vy * dt * 4;
      d.rot += d.vrot * dt;
      d.vrot *= 0.94;
      d.vx *= 0.92;
      d.vy *= 0.92;
      if (Math.random() < 0.3) d.val = randi(1, 7);
    });

    if (progress >= 1) {
      da.active = false;
      da.dice1.val = da.dice1.finalVal;
      da.dice2.val = da.dice2.finalVal;
      da.dice1.rot = 0;
      da.dice2.rot = 0;
      state.shake = 0.22;
      playSfx("dice_land");
      spawnParticles(W * 0.5, H * 0.5, COLORS.yellow, 14);
      if (da.onComplete) da.onComplete();
    }
  }

  function startPawnHopAnimation(player, totalSteps, onComplete) {
    state.pawnAnim = {
      active: true,
      player,
      startPos: player.pos,
      totalSteps,
      currentStep: 0,
      stepT: 0,
      stepDuration: 0.18,
      onComplete
    };
  }

  function updatePawnHopAnimation(dt) {
    const pa = state.pawnAnim;
    if (!pa.active) return;

    pa.stepT += dt / pa.stepDuration;
    const t = clamp(pa.stepT, 0, 1);

    // Parabolic Arc & Squash-and-Stretch
    pa.player.hopY = -Math.sin(t * Math.PI) * 24;
    pa.player.squash = 1 + Math.sin(t * Math.PI) * 0.35;

    if (pa.stepT >= 1) {
      pa.stepT = 0;
      pa.currentStep++;
      pa.player.pos = (pa.player.pos + 1) % state.board.length;
      state.selectedSpace = pa.player.pos;
      pa.player.hopY = 0;
      pa.player.squash = 0.8;

      playSfx("hop");
      const pCenter = spaceCenter(pa.player.pos);
      spawnDustPuff(pCenter.x, pCenter.y + 10);

      // Pass Start bonus ($200)
      if (pa.player.pos === 0) {
        pa.player.cash += 200;
        playSfx("cash");
        spawnParticles(W * 0.5, H * 0.5, COLORS.yellow, 20);
        spawnCallout(pCenter.x, pCenter.y - 24, "+$200 START", COLORS.green);
        log(`${pa.player.name} passed Start and collected $200.`);
      }

      updateUI();

      if (pa.currentStep >= pa.totalSteps) {
        pa.active = false;
        pa.player.squash = 1.0;
        if (pa.onComplete) pa.onComplete();
      }
    }
  }

  function spawnFlyingCash(fromX, fromY, toX, toY, amount = 100) {
    const count = Math.min(8, Math.max(3, Math.floor(amount / 40)));
    playSfx("cash");
    for (let i = 0; i < count; i++) {
      const midX = (fromX + toX) * 0.5 + rand(-60, 60);
      const midY = Math.min(fromY, toY) - rand(40, 100);
      state.flyingBills.push({
        x1: fromX, y1: fromY,
        cx: midX, cy: midY,
        x2: toX, y2: toY,
        t: -i * 0.08,
        speed: 1.4,
        rot: rand(-0.4, 0.4),
        amount
      });
    }
  }

  function updateFlyingCash(dt) {
    for (let i = state.flyingBills.length - 1; i >= 0; i--) {
      const b = state.flyingBills[i];
      b.t += dt * b.speed;
      if (b.t >= 1) {
        state.flyingBills.splice(i, 1);
        spawnParticles(b.x2, b.y2, COLORS.green, 6);
      }
    }
  }

  function spawnStampVFX(spaceIndex, text, color = "#ff3b56") {
    const pos = spaceCenter(spaceIndex);
    playSfx("stamp");
    state.shake = 0.35;
    state.stamps.push({
      x: pos.x,
      y: pos.y,
      text,
      color,
      scale: 2.5,
      targetScale: 1.0,
      rot: rand(-0.25, 0.25),
      alpha: 1.0,
      life: 2.2
    });
  }

  function updateStamps(dt) {
    for (let i = state.stamps.length - 1; i >= 0; i--) {
      const st = state.stamps[i];
      st.scale += (st.targetScale - st.scale) * Math.min(1, dt * 14.0);
      st.life -= dt;
      if (st.life < 0.6) st.alpha = st.life / 0.6;
      if (st.life <= 0) state.stamps.splice(i, 1);
    }
  }

  // =========================================================================
  // 6. TILE RESOLUTION & ACTIONS
  // =========================================================================

  function resolveSpace(player) {
    const space = state.board[player.pos];
    state.selectedSpace = space.index;

    if (space.type === "property") {
      resolveProperty(player, space);
    } else if (space.type === "tax") {
      changeCash(player, -space.amount, `${player.name} paid ${money(space.amount)} for ${space.name}.`);
      playSfx("buzzer");
      spawnFlyingCash(spaceCenter(player.pos).x, spaceCenter(player.pos).y, W * 0.5, H * 0.5, space.amount);
      afterResolved(player);
    } else if (space.type === "bonus") {
      changeCash(player, space.amount, `${player.name} gained ${money(space.amount)} from ${space.name}.`);
      playSfx("cash");
      spawnFlyingCash(W * 0.5, H * 0.5, spaceCenter(player.pos).x, spaceCenter(player.pos).y, space.amount);
      afterResolved(player);
    } else if (space.type === "card") {
      drawCard(player);
    } else if (space.type === "skip") {
      player.skip += 1;
      playSfx("buzzer");
      log(`${player.name} trapped at the zoning board, will miss next turn.`);
      afterResolved(player);
    } else if (space.type === "market") {
      adjustMarket(space.amount);
      log(`${space.name}: Market heat is now ${Math.round(state.marketHeat * 100)}%.`);
      afterResolved(player);
    } else {
      log(`${player.name} landed on ${space.name}. Quiet day on the cul-de-sac.`);
      afterResolved(player);
    }

    updateUI();
  }

  function resolveProperty(player, space) {
    if (!space.owner) {
      const canAfford = player.cash >= space.cost;
      if (player.isHuman && canAfford) {
        state.pendingDecision = { type: "buy", playerId: player.id, spaceIndex: space.index };
        state.phase = "decision";
        setDecision(
          "Buy Property?",
          `${space.name} costs ${money(space.cost)} (Rents for ${money(rentFor(space))}).`,
          "Acquire now before private equity sweeps in."
        );
        return;
      }

      if (!player.isHuman && canAfford && shouldAiBuy(player, space)) {
        buyProperty(player, space);
      } else {
        log(`${player.name} passed on ${space.name}.`);
      }
      afterResolved(player);
      return;
    }

    if (space.owner === player.id) {
      const canUpgrade = space.level < 3 && player.cash >= space.upgrade;
      if (player.isHuman && canUpgrade) {
        state.pendingDecision = { type: "upgrade", playerId: player.id, spaceIndex: space.index };
        state.phase = "decision";
        setDecision(
          "Renovate & Upgrade?",
          `${space.name} is yours. Spend ${money(space.upgrade)} to raise rent to ${money(rentFor({ ...space, level: space.level + 1 }))}.`,
          `Current Tier: Level ${space.level}/3`
        );
        return;
      }

      if (!player.isHuman && canUpgrade && player.cash > 400 && Math.random() < 0.60) {
        upgradeProperty(player, space);
      } else {
        log(`${player.name} admires ${space.name} and checks market equity.`);
      }
      afterResolved(player);
      return;
    }

    // Rent Payment to Rival Landlord
    const owner = state.players.find((p) => p.id === space.owner);
    const rent = rentFor(space);

    if (player.rentShield > 0) {
      player.rentShield -= 1;
      log(`${player.name}'s Rent Shield blocked ${money(rent)} at ${space.name}!`);
      addImpact(space.index, "RENT BLOCKED!", COLORS.cyan, 1.0);
    } else {
      player.cash -= rent;
      owner.cash += rent;
      log(`${player.name} paid ${owner.name} ${money(rent)} rent for ${space.name}.`);
      addImpact(space.index, choice(CASH_BITS.rent), owner.color, 1.2);

      const pPos = spaceCenter(player.pos);
      const oPos = spaceCenter(owner.pos);
      spawnFlyingCash(pPos.x, pPos.y, oPos.x, oPos.y, rent);
    }

    afterResolved(player);
  }

  function shouldAiBuy(player, space) {
    const reserve = 180 + state.round * 8;
    const appetite = player.buyBias + (space.rent / 220) - (space.cost / 2200);
    return player.cash - space.cost > reserve && Math.random() < appetite;
  }

  function buyProperty(player, space) {
    player.cash -= space.cost;
    space.owner = player.id;
    space.level = 0;
    log(`${player.name} bought ${space.name} for ${money(space.cost)}.`);
    spawnStampVFX(space.index, choice(CASH_BITS.buy), player.color);
    addImpact(space.index, "BOUGHT!", player.color, 1.1);
  }

  function upgradeProperty(player, space) {
    player.cash -= space.upgrade;
    space.level = Math.min(3, space.level + 1);
    playSfx("upgrade");
    log(`${player.name} renovated ${space.name} to Level ${space.level}!`);
    spawnStampVFX(space.index, choice(CASH_BITS.upgrade), space.group);
    addImpact(space.index, `TIER ${space.level}!`, space.group, 1.2);
  }

  function acceptDecision() {
    const decision = state.pendingDecision;
    if (!decision || state.phase !== "decision") return;
    const player = state.players.find((p) => p.id === decision.playerId);
    const space = state.board[decision.spaceIndex];
    if (!player || !space) return;

    if (decision.type === "buy") {
      buyProperty(player, space);
    } else if (decision.type === "upgrade") {
      upgradeProperty(player, space);
    }

    state.pendingDecision = null;
    afterResolved(player);
    updateUI();
  }

  function declineDecision() {
    const decision = state.pendingDecision;
    if (!decision || state.phase !== "decision") return;
    const player = state.players.find((p) => p.id === decision.playerId);
    const space = state.board[decision.spaceIndex];

    log(`${player.name} declined to ${decision.type} ${space.name}.`);
    state.pendingDecision = null;
    afterResolved(player);
    updateUI();
  }

  function drawCard(player) {
    const card = choice(CARD_DECK);
    playSfx("card_flip");

    state.activeCard = {
      card,
      player,
      timer: 0,
      maxTimer: 2.2,
      scale: 0.2,
      flipRot: Math.PI
    };

    log(`[${card.kicker}] ${card.title}: ${card.text}`);

    if (typeof card.cash === "number") {
      changeCash(player, card.cash, `${player.name} ${card.cash >= 0 ? "received" : "lost"} ${money(card.cash)}.`);
      if (card.cash > 0) {
        spawnFlyingCash(W * 0.5, H * 0.5, spaceCenter(player.pos).x, spaceCenter(player.pos).y, card.cash);
      }
    }

    if (card.upgrade) {
      const deeds = ownedSpaces(player).filter((s) => s.level < 3);
      if (deeds.length > 0) {
        const target = choice(deeds);
        target.level += 1;
        playSfx("upgrade");
        spawnStampVFX(target.index, "FREE REZONING!", target.group);
        log(`Free renovation granted to ${target.name} (Now Level ${target.level})!`);
      }
    }

    if (typeof card.heat === "number") {
      adjustMarket(card.heat);
    }

    if (card.collectFromAll) {
      let total = 0;
      state.players.forEach((other) => {
        if (other.id !== player.id && !other.bankrupt) {
          other.cash -= card.collectFromAll;
          total += card.collectFromAll;
          spawnFlyingCash(spaceCenter(other.pos).x, spaceCenter(other.pos).y, spaceCenter(player.pos).x, spaceCenter(player.pos).y, card.collectFromAll);
        }
      });
      player.cash += total;
      playSfx("cash");
      log(`${player.name} extracted ${money(card.collectFromAll)} from each neighbor.`);
    }

    setTimeout(() => {
      state.activeCard = null;
      afterResolved(player);
      updateUI();
    }, 2000);
  }

  function changeCash(player, delta, reason) {
    player.cash += delta;
    log(reason);
    if (delta > 0) {
      addImpact(player.pos, `+${money(delta)}`, COLORS.green, 1);
    } else if (delta < 0) {
      addImpact(player.pos, `${money(delta)}`, COLORS.red, 1);
    }
  }

  function adjustMarket(amount) {
    state.marketHeat = clamp(state.marketHeat + amount, -0.25, 0.40);
    state.actionPulse = 0.9;
  }

  function afterResolved(player) {
    if (player.cash < 0) {
      player.bankrupt = true;
      playSfx("buzzer");
      log(`💥 ${player.name} went BANKRUPT and was evicted from the board.`);
      state.board.forEach((space) => {
        if (space.owner === player.id) {
          space.owner = null;
          space.level = 0;
        }
      });
      addImpact(player.pos, "BANKRUPT!", COLORS.red, 1.4);

      if (player.isHuman) {
        setTimeout(() => triggerGameOver(false), 900);
        return;
      }
    }

    const alive = state.players.filter((p) => !p.bankrupt);
    if (alive.length === 1 && alive[0].isHuman) {
      setTimeout(() => triggerGameOver(true), 900);
      return;
    }

    nextTurn(player.isHuman ? 750 : 500);
  }

  function finishByWorth() {
    const human = humanPlayer();
    const highest = [...state.players].sort((a, b) => netWorth(b) - netWorth(a))[0];
    const won = highest.id === human.id;
    triggerGameOver(won);
  }

  function triggerGameOver(won) {
    state.gameOver = true;
    state.phase = "game_over";
    if (saveSlot) saveSlot.clear();

    const human = humanPlayer();
    const worth = netWorth(human);
    const isHigh = api.recordScore(GAME_ID, worth);
    if (isHigh) playSfx("fanfare");

    const sorted = [...state.players].sort((a, b) => netWorth(b) - netWorth(a));
    const rank = sorted.findIndex((p) => p.id === human.id) + 1;

    showOverlay(
      won ? "🏆 HOUSING MARKET CONQUERED!" : "📜 RETIREMENT COLLAPSED",
      won
        ? `You finished #1 with ${money(worth)} net worth and crushed the local housing market!`
        : `Ranked #${rank} of 4 with ${money(worth)} net worth. The HOA won this round.`
    );
  }

  // =========================================================================
  // 7. PARTICLES & VISUAL FX SYSTEM
  // =========================================================================

  function spawnParticles(x, y, color, count = 18) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = rand(30, 160);
      state.particles.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 30,
        color,
        size: rand(3, 6),
        spin: rand(0, 6.28),
        age: 0,
        life: rand(0.5, 0.9),
        shape: Math.random() < 0.4 ? "cash" : "sparkle"
      });
    }
  }

  function spawnDustPuff(x, y) {
    for (let i = 0; i < 6; i++) {
      state.particles.push({
        x: x + rand(-8, 8),
        y: y + rand(-3, 3),
        vx: rand(-20, 20),
        vy: rand(-15, -5),
        color: "rgba(240, 230, 210, 0.5)",
        size: rand(3, 5),
        age: 0,
        life: rand(0.3, 0.5),
        shape: "dust"
      });
    }
  }

  function spawnCallout(x, y, text, color) {
    state.callouts.push({
      x,
      y,
      vy: -28,
      text,
      color,
      age: 0,
      life: 1.3
    });
  }

  function updateVisuals(dt) {
    state.shake = Math.max(0, state.shake - dt * 2.0);
    state.actionPulse = Math.max(0, state.actionPulse - dt * 1.8);

    updateDiceAnimation(dt);
    updatePawnHopAnimation(dt);
    updateFlyingCash(dt);
    updateStamps(dt);

    if (state.activeCard) {
      const ac = state.activeCard;
      ac.timer += dt;
      ac.scale += (1.0 - ac.scale) * Math.min(1, dt * 10);
      ac.flipRot += (0 - ac.flipRot) * Math.min(1, dt * 8);
    }

    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 120 * dt;
      if (p.age >= p.life) state.particles.splice(i, 1);
    }

    for (let i = state.callouts.length - 1; i >= 0; i--) {
      const c = state.callouts[i];
      c.age += dt;
      c.y += c.vy * dt;
      if (c.age >= c.life) state.callouts.splice(i, 1);
    }
  }

  // =========================================================================
  // 8. BOARD RENDERING & LUXURY CASINO FELT AESTHETICS
  // =========================================================================

  function buildBoardRects() {
    const margin = 20;
    const cells = 8;
    const cell = (W - margin * 2) / cells;
    const rects = [];

    for (let col = 7; col >= 0; col--) rects.push({ x: margin + col * cell, y: margin + 7 * cell, w: cell, h: cell });
    for (let row = 6; row >= 0; row--) rects.push({ x: margin, y: margin + row * cell, w: cell, h: cell });
    for (let col = 1; col <= 7; col++) rects.push({ x: margin + col * cell, y: margin, w: cell, h: cell });
    for (let row = 1; row <= 6; row++) rects.push({ x: margin + 7 * cell, y: margin + row * cell, w: cell, h: cell });

    state.boardRects = rects;
  }

  function draw(now) {
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    if (state.shake > 0) {
      ctx.translate((Math.random() - 0.5) * state.shake * 14, (Math.random() - 0.5) * state.shake * 14);
    }

    // 1. Country-Club Mahogany & Green Velvet Felt Backdrop
    drawBoardBackdrop(now);

    // 2. Tiles & Properties
    drawBoardTiles(now);

    // 3. Center Luxury Dashboard & Market Ticker
    drawCenterDashboard(now);

    // 4. Upgraded 3D Isometric Houses & Mansions
    drawIsometricHouses();

    // 5. Pawns & Tokens (With Hopping Physics)
    drawPawns(now);

    // 6. Flying Cash & Bezier Dollar Trails
    drawFlyingCash();

    // 7. Rubber Stamp Purchase Slams
    drawRubberStamps();

    // 8. Particles & Callouts
    drawParticles();
    drawCallouts();

    // 9. 3D Tumbling Dice Roll
    if (state.diceAnim.active) {
      draw3DDice(state.diceAnim.dice1);
      draw3DDice(state.diceAnim.dice2);
    }

    // 10. Active 3D Satirical Card Flip Modal
    if (state.activeCard) {
      drawCardModal(state.activeCard);
    }

    ctx.restore();

    if (state.paused && !state.gameOver) {
      ctx.fillStyle = "rgba(4, 8, 16, 0.78)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = COLORS.yellow;
      ctx.font = "800 32px Bungee, Impact, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", W * 0.5, H * 0.5);
    }
  }

  function drawBoardBackdrop(now) {
    // Rich Mahogany Wood Border
    const woodGrad = ctx.createLinearGradient(0, 0, W, H);
    woodGrad.addColorStop(0, "#2c1508");
    woodGrad.addColorStop(0.5, "#48220f");
    woodGrad.addColorStop(1, "#1e0e05");
    ctx.fillStyle = woodGrad;
    ctx.fillRect(0, 0, W, H);

    // Inner Velvet Green Casino Felt
    const feltGrad = ctx.createRadialGradient(W * 0.5, H * 0.5, 80, W * 0.5, H * 0.5, 480);
    feltGrad.addColorStop(0, "#0e3a24");
    feltGrad.addColorStop(0.65, "#082618");
    feltGrad.addColorStop(1, "#04130c");
    ctx.fillStyle = feltGrad;
    ctx.fillRect(16, 16, W - 32, H - 32);

    // Subtle Gold Inlay Border
    ctx.strokeStyle = "rgba(255, 212, 59, 0.4)";
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 18, W - 36, H - 36);
  }

  function drawBoardTiles(now) {
    for (const space of state.board) {
      const rect = state.boardRects[space.index];
      if (!rect) continue;
      drawSingleTile(space, rect, now);
    }
  }

  function drawSingleTile(space, rect, now) {
    const isSelected = state.selectedSpace === space.index;
    const owner = state.players.find((p) => p.id === space.owner);
    const pad = 2.5;
    const x = rect.x + pad;
    const y = rect.y + pad;
    const w = rect.w - pad * 2;
    const h = rect.h - pad * 2;

    ctx.save();

    // Tile Surface Gradient
    const tileGrad = ctx.createLinearGradient(x, y, x + w, y + h);
    if (space.type === "property") {
      tileGrad.addColorStop(0, "#fffbe8");
      tileGrad.addColorStop(0.7, "#f5e6ba");
      tileGrad.addColorStop(1, "#dfcca0");
    } else {
      tileGrad.addColorStop(0, specialTileBg(space.type));
      tileGrad.addColorStop(1, "#090d16");
    }

    ctx.fillStyle = tileGrad;
    ctx.shadowColor = isSelected ? COLORS.yellow : "rgba(0,0,0,0.4)";
    ctx.shadowBlur = isSelected ? 16 : 4;
    roundRect(x, y, w, h, 6, true, false);
    ctx.shadowBlur = 0;

    // Tile Border
    ctx.strokeStyle = isSelected ? COLORS.yellow : "rgba(10, 16, 26, 0.75)";
    ctx.lineWidth = isSelected ? 3.5 : 1.5;
    roundRect(x, y, w, h, 6, false, true);

    // Property Header Awning
    if (space.type === "property") {
      ctx.fillStyle = space.group;
      roundRect(x + 4, y + 4, w - 8, 14, 4, true, false);

      // Landlord Ownership Ribbon
      if (owner) {
        ctx.fillStyle = owner.color;
        roundRect(x + 5, y + h - 16, w - 10, 11, 4, true, false);
        ctx.fillStyle = "#05090f";
        ctx.font = "800 8.5px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.fillText(owner.name.toUpperCase(), x + w * 0.5, y + h - 7);
      }
    }

    // Tile Text
    ctx.fillStyle = space.type === "property" ? "#0f172a" : "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 12px JetBrains Mono, monospace";

    const lines = space.label || [space.name];
    lines.slice(0, 2).forEach((line, i) => {
      ctx.fillText(line, rect.x + rect.w * 0.5, rect.y + 28 + i * 14, rect.w - 8);
    });

    // Price / Rent Label
    if (space.type === "property") {
      if (!owner) {
        ctx.fillStyle = "#1e293b";
        ctx.font = "800 10.5px JetBrains Mono, monospace";
        ctx.fillText(money(space.cost), rect.x + rect.w * 0.5, rect.y + rect.h - 22);
      }
    } else {
      ctx.fillStyle = COLORS.yellow;
      ctx.font = "800 10px JetBrains Mono, monospace";
      ctx.fillText(specialBadge(space), rect.x + rect.w * 0.5, rect.y + rect.h - 14);
    }

    ctx.restore();
  }

  function specialTileBg(type) {
    switch (type) {
      case "start": return "#1b4d2e";
      case "card": return "#3b1e54";
      case "tax": return "#5c1d1d";
      case "bonus": return "#54441b";
      case "skip": return "#1d3557";
      case "market": return "#1d4e5b";
      default: return "#141e2b";
    }
  }

  function specialBadge(space) {
    if (space.type === "start") return "+$200";
    if (space.type === "card") return "CARD";
    if (space.type === "tax") return `-${money(space.amount)}`;
    if (space.type === "bonus") return `+${money(space.amount)}`;
    if (space.type === "skip") return "SKIP";
    if (space.type === "market") return `${space.amount > 0 ? "+" : ""}${Math.round(space.amount * 100)}%`;
    return "";
  }

  // =========================================================================
  // 9. 3D ISOMETRIC HOUSES & MANSIONS ON TILES
  // =========================================================================

  function drawIsometricHouses() {
    for (const space of state.board) {
      if (space.type !== "property" || space.level <= 0) continue;
      const rect = state.boardRects[space.index];
      if (!rect) continue;

      const cx = rect.x + rect.w * 0.5;
      const cy = rect.y + rect.h - 26;

      if (space.level === 1) {
        drawSmallCottage(cx, cy, space.group);
      } else if (space.level === 2) {
        drawSmallCottage(cx - 10, cy, space.group);
        drawSmallCottage(cx + 10, cy, space.group);
      } else if (space.level >= 3) {
        drawLuxuryMcMansion(cx, cy);
      }
    }
  }

  function drawSmallCottage(x, y, roofColor) {
    ctx.save();
    ctx.translate(x, y);

    // House Base
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(-8, -6, 16, 12);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 1;
    ctx.strokeRect(-8, -6, 16, 12);

    // Gabled Roof
    ctx.fillStyle = roofColor;
    ctx.beginPath();
    ctx.moveTo(-10, -6);
    ctx.lineTo(0, -15);
    ctx.lineTo(10, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Door & Window
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(-2, 0, 4, 6);
    ctx.fillStyle = "#2ee0ff";
    ctx.fillRect(3, -3, 3, 3);

    ctx.restore();
  }

  function drawLuxuryMcMansion(x, y) {
    ctx.save();
    ctx.translate(x, y);

    // Golden McMansion Base
    ctx.fillStyle = "#fef08a";
    ctx.fillRect(-14, -8, 28, 16);
    ctx.strokeStyle = "#854d0e";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-14, -8, 28, 16);

    // Mansard Gold Roof
    ctx.fillStyle = "#ca8a04";
    ctx.beginPath();
    ctx.moveTo(-16, -8);
    ctx.lineTo(-8, -18);
    ctx.lineTo(8, -18);
    ctx.lineTo(16, -8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Roman Columns
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-10, -8, 3, 16);
    ctx.fillRect(7, -8, 3, 16);

    // Gold Weather Vane / Star
    ctx.fillStyle = "#ffd43b";
    ctx.font = "8px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("👑", 0, -19);

    ctx.restore();
  }

  // =========================================================================
  // 10. CENTER LUXURY DASHBOARD & MARKET HEAT
  // =========================================================================

  function drawCenterDashboard(now) {
    const { x, y, w, h } = CENTER_PANEL;
    const human = humanPlayer();
    const active = activePlayer();

    ctx.save();

    // Dashboard Container with Gold Rim
    const dashGrad = ctx.createLinearGradient(x, y, x + w, y + h);
    dashGrad.addColorStop(0, "rgba(8, 14, 24, 0.97)");
    dashGrad.addColorStop(0.5, "rgba(12, 22, 18, 0.98)");
    dashGrad.addColorStop(1, "rgba(24, 14, 8, 0.97)");

    ctx.fillStyle = dashGrad;
    ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
    ctx.shadowBlur = 24;
    roundRect(x, y, w, h, 14, true, false);
    ctx.shadowBlur = 0;

    ctx.strokeStyle = "rgba(255, 212, 59, 0.45)";
    ctx.lineWidth = 2;
    roundRect(x, y, w, h, 14, false, true);

    // Title Foil Emboss
    ctx.fillStyle = COLORS.yellow;
    ctx.shadowColor = "rgba(255, 212, 59, 0.5)";
    ctx.shadowBlur = 10;
    ctx.font = "800 28px Bungee, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("BOOMER MONOPOLY", x + w * 0.5, y + 36);
    ctx.shadowBlur = 0;

    ctx.fillStyle = COLORS.cyan;
    ctx.font = "800 10.5px JetBrains Mono, monospace";
    ctx.letterSpacing = "1.5px";
    ctx.fillText("BUY LOW · RENT FOREVER · EQUITY CASINO", x + w * 0.5, y + 54);

    // Animated News Ticker
    ctx.fillStyle = "rgba(255, 46, 136, 0.12)";
    ctx.strokeStyle = "rgba(255, 46, 136, 0.35)";
    roundRect(x + 30, y + 68, w - 60, 24, 6, true, true);
    ctx.fillStyle = COLORS.pink;
    ctx.font = "800 10.5px JetBrains Mono, monospace";
    ctx.fillText(`🚨 NEWS: ${state.headline}`, x + w * 0.5, y + 83, w - 80);

    // Interactive Dice Stand in Center (when not tumbling)
    if (!state.diceAnim.active) {
      drawRestingDice(x + w * 0.5 - 54, y + 106, state.dice[0]);
      drawRestingDice(x + w * 0.5 + 10, y + 106, state.dice[1]);
    }

    // Active Status / Turn Prompter
    if (state.phase === "await_roll") {
      const pulse = 0.6 + 0.4 * Math.sin(now * 0.008);
      ctx.fillStyle = `rgba(255, 212, 59, ${pulse})`;
      ctx.font = "800 15px Bungee, Impact, sans-serif";
      ctx.fillText("🎲 CLICK OR PRESS SPACE TO ROLL", x + w * 0.5, y + 172);
    } else {
      ctx.fillStyle = active.color;
      ctx.font = "800 13px JetBrains Mono, monospace";
      ctx.fillText(`${active.name.toUpperCase()}'S TURN · ROUND ${Math.min(state.round, MAX_ROUNDS)}/${MAX_ROUNDS}`, x + w * 0.5, y + 172);
    }

    // Human Player Stats Card
    ctx.fillStyle = "rgba(6, 12, 20, 0.9)";
    ctx.strokeStyle = "rgba(46, 224, 255, 0.3)";
    roundRect(x + 28, y + 192, w - 56, 88, 10, true, true);

    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.ink;
    ctx.font = "800 14px JetBrains Mono, monospace";
    ctx.fillText(`Net Worth: ${money(netWorth(human))}`, x + 44, y + 216);

    ctx.fillStyle = COLORS.muted;
    ctx.font = "700 11.5px JetBrains Mono, monospace";
    ctx.fillText(`Liquid Cash: ${money(human.cash)}  ·  Deeds: ${ownedSpaces(human).length}`, x + 44, y + 238);

    ctx.fillStyle = COLORS.yellow;
    const currSpace = state.board[human.pos] || state.board[0];
    ctx.fillText(`Current Tile: ${currSpace.name}`, x + 44, y + 260, w - 88);

    // Market Heat Gauge
    const heatPercent = Math.round(state.marketHeat * 100);
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.muted;
    ctx.font = "800 10.5px JetBrains Mono, monospace";
    ctx.fillText(`Market Heat: ${heatPercent >= 0 ? "+" : ""}${heatPercent}%`, x + 30, y + 302);

    const barW = w - 60;
    const barH = 14;
    ctx.fillStyle = "#080e14";
    roundRect(x + 30, y + 312, barW, barH, 7, true, false);

    const fillRatio = clamp((state.marketHeat + 0.25) / 0.65, 0.05, 1.0);
    const heatGrad = ctx.createLinearGradient(x + 30, 0, x + 30 + barW, 0);
    heatGrad.addColorStop(0, COLORS.cyan);
    heatGrad.addColorStop(0.5, COLORS.yellow);
    heatGrad.addColorStop(1, COLORS.red);
    ctx.fillStyle = heatGrad;
    roundRect(x + 30, y + 312, barW * fillRatio, barH, 7, true, false);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    roundRect(x + 30, y + 312, barW, barH, 7, false, true);

    ctx.restore();
  }

  function drawRestingDice(x, y, value) {
    ctx.save();
    const grad = ctx.createLinearGradient(x, y, x + 44, y + 44);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(1, "#fde047");
    ctx.fillStyle = grad;
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = 8;
    roundRect(x, y, 44, 44, 8, true, false);
    ctx.shadowBlur = 0;

    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.5;
    roundRect(x, y, 44, 44, 8, false, true);

    ctx.fillStyle = "#0f172a";
    const dots = getDiceDots(value, 44);
    for (const [dx, dy] of dots) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw3DDice(d) {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.rot);

    const size = 46;
    const grad = ctx.createLinearGradient(-size * 0.5, -size * 0.5, size * 0.5, size * 0.5);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(1, "#facc15");

    ctx.fillStyle = grad;
    ctx.shadowColor = "rgba(255, 212, 59, 0.6)";
    ctx.shadowBlur = 12;
    roundRect(-size * 0.5, -size * 0.5, size, size, 9, true, false);
    ctx.shadowBlur = 0;

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 3;
    roundRect(-size * 0.5, -size * 0.5, size, size, 9, false, true);

    ctx.fillStyle = "#0f172a";
    const dots = getDiceDots(d.val, size);
    for (const [dx, dy] of dots) {
      ctx.beginPath();
      ctx.arc(-size * 0.5 + dx, -size * 0.5 + dy, 3.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function getDiceDots(val, size) {
    const a = size * 0.25;
    const b = size * 0.50;
    const c = size * 0.75;
    const map = {
      1: [[b, b]],
      2: [[a, a], [c, c]],
      3: [[a, a], [b, b], [c, c]],
      4: [[a, a], [c, a], [a, c], [c, c]],
      5: [[a, a], [c, a], [b, b], [a, c], [c, c]],
      6: [[a, a], [c, a], [a, b], [c, b], [a, c], [c, c]]
    };
    return map[val] || map[1];
  }

  // =========================================================================
  // 11. PAWNS, TOKENS & HOPPING PHYSICS
  // =========================================================================

  function drawPawns(now) {
    const grouped = new Map();
    for (const player of state.players) {
      if (player.bankrupt) continue;
      if (!grouped.has(player.pos)) grouped.set(player.pos, []);
      grouped.get(player.pos).push(player);
    }

    for (const [spaceIdx, players] of grouped.entries()) {
      const rect = state.boardRects[spaceIdx];
      if (!rect) continue;

      players.forEach((player, i) => {
        const offset = (i - (players.length - 1) * 0.5) * 14;
        const cx = rect.x + rect.w * 0.5 + offset;
        const cy = rect.y + rect.h * 0.5 + (player.hopY || 0);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(player.squash || 1, 1 / (player.squash || 1));

        // Token Drop Shadow
        ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
        ctx.beginPath();
        ctx.ellipse(0, 10 - (player.hopY || 0) * 0.5, 9, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // High-Quality Wooden Pawn Body
        ctx.shadowColor = player.color;
        ctx.shadowBlur = player.isHuman ? 14 : 8;

        const pawnGrad = ctx.createLinearGradient(-8, -14, 8, 8);
        pawnGrad.addColorStop(0, player.color);
        pawnGrad.addColorStop(1, "#0f172a");
        ctx.fillStyle = pawnGrad;

        // Pawn Head
        ctx.beginPath();
        ctx.arc(0, -9, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Pawn Skirt Base
        ctx.fillStyle = player.color;
        ctx.beginPath();
        ctx.moveTo(-7, 7);
        ctx.lineTo(7, 7);
        ctx.lineTo(4, -3);
        ctx.lineTo(-4, -3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;

        // Player Initial
        ctx.fillStyle = "#05090f";
        ctx.font = "800 8.5px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.fillText(player.name[0].toUpperCase(), 0, -8);

        ctx.restore();
      });
    }
  }

  // =========================================================================
  // 12. FLYING CASH & RUBBER STAMP RENDERING
  // =========================================================================

  function drawFlyingCash() {
    for (const b of state.flyingBills) {
      if (b.t < 0 || b.t > 1) continue;
      const u = b.t;
      const x = (1 - u) * (1 - u) * b.x1 + 2 * (1 - u) * u * b.cx + u * u * b.x2;
      const y = (1 - u) * (1 - u) * b.y1 + 2 * (1 - u) * u * b.cy + u * u * b.y2;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(b.rot + u * 4);

      ctx.fillStyle = "#4ade80";
      ctx.shadowColor = "#4ade80";
      ctx.shadowBlur = 8;
      ctx.fillRect(-12, -7, 24, 14);
      ctx.shadowBlur = 0;

      ctx.strokeStyle = "#14532d";
      ctx.lineWidth = 1;
      ctx.strokeRect(-12, -7, 24, 14);

      ctx.fillStyle = "#14532d";
      ctx.font = "800 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText("$", 0, 3);

      ctx.restore();
    }
  }

  function drawRubberStamps() {
    for (const st of state.stamps) {
      ctx.save();
      ctx.globalAlpha = st.alpha;
      ctx.translate(st.x, st.y);
      ctx.scale(st.scale, st.scale);
      ctx.rotate(st.rot);

      ctx.strokeStyle = st.color;
      ctx.lineWidth = 3;
      roundRect(-42, -14, 84, 28, 6, false, true);

      ctx.fillStyle = st.color;
      ctx.font = "800 11px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(st.text, 0, 0, 78);

      ctx.restore();
    }
  }

  function drawCardModal(ac) {
    const card = ac.card;
    ctx.save();
    ctx.translate(W * 0.5, H * 0.5);
    ctx.scale(ac.scale, ac.scale);

    // 3D Card Backdrop
    const cardW = 280;
    const cardH = 170;

    ctx.fillStyle = "rgba(4, 8, 16, 0.96)";
    ctx.shadowColor = COLORS.pink;
    ctx.shadowBlur = 30;
    roundRect(-cardW * 0.5, -cardH * 0.5, cardW, cardH, 12, true, false);
    ctx.shadowBlur = 0;

    ctx.strokeStyle = COLORS.pink;
    ctx.lineWidth = 3;
    roundRect(-cardW * 0.5, -cardH * 0.5, cardW, cardH, 12, false, true);

    // Kicker & Title
    ctx.fillStyle = COLORS.pink;
    ctx.font = "800 11px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`🚨 ${card.kicker}`, 0, -cardH * 0.5 + 24);

    ctx.fillStyle = COLORS.yellow;
    ctx.font = "800 17px Bungee, Impact, sans-serif";
    ctx.fillText(card.title, 0, -cardH * 0.5 + 48, cardW - 24);

    // Body Text
    ctx.fillStyle = COLORS.ink;
    ctx.font = "700 11.5px Inter, sans-serif";
    wrapText(ctx, card.text, 0, -cardH * 0.5 + 78, cardW - 32, 16);

    ctx.restore();
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(" ");
    let line = "";
    let curY = y;
    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + " ";
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        ctx.fillText(line, x, curY);
        line = words[n] + " ";
        curY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, curY);
  }

  function drawParticles() {
    for (const p of state.particles) {
      const alpha = 1 - p.age / p.life;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin || 0);

      if (p.shape === "cash") {
        ctx.fillRect(-5, -3, 10, 6);
      } else if (p.shape === "dust") {
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size * 0.5, -p.size * 0.5, p.size, p.size);
      }
      ctx.restore();
    }
  }

  function drawCallouts() {
    for (const c of state.callouts) {
      const alpha = 1 - c.age / c.life;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = c.color;
      ctx.font = "800 13px Bungee, Impact, sans-serif";
      ctx.shadowColor = "#000000";
      ctx.shadowBlur = 6;
      ctx.textAlign = "center";
      ctx.fillText(c.text, c.x, c.y);
      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }

  function roundRect(x, y, w, h, r, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const rand = (min, max) => min + Math.random() * (max - min);
  const randi = (min, max) => Math.floor(rand(min, max));

  // =========================================================================
  // 13. UI BINDINGS & POWERUPS
  // =========================================================================

  function setDecision(kicker, text, meta) {
    if (el.decisionKicker) el.decisionKicker.textContent = kicker;
    if (el.decisionText) el.decisionText.textContent = text;
    if (el.decisionMeta) el.decisionMeta.textContent = meta;
  }

  function updateUI() {
    const human = humanPlayer();
    if (el.cash) el.cash.textContent = money(human.cash);
    if (el.worth) el.worth.textContent = money(netWorth(human));
    if (el.round) el.round.textContent = `${Math.min(state.round, MAX_ROUNDS)}/${MAX_ROUNDS}`;
    if (el.high) el.high.textContent = money(api.getHighScore(GAME_ID));

    if (el.roll) el.roll.disabled = state.phase !== "await_roll" || state.busy;
    if (el.buy) el.buy.disabled = state.phase !== "decision";
    if (el.pass) el.pass.disabled = state.phase !== "decision";

    if (el.playerList) {
      el.playerList.innerHTML = state.players
        .map((p, i) => {
          const isActive = i === state.current;
          const status = p.bankrupt ? "BANKRUPT" : p.skip > 0 ? `Zoning (${p.skip})` : "Active";
          return `
            <li class="boomer-player ${isActive ? "is-active" : ""}">
              <span class="boomer-player__chip" style="background:${p.color}"></span>
              <div>
                <strong>${p.name} ${p.isHuman ? "(You)" : ""}</strong>
                <span>Cash: ${money(p.cash)} · Worth: ${money(netWorth(p))}</span>
              </div>
              <em>${status}</em>
            </li>
          `;
        })
        .join("");
    }

    if (el.eventLog) {
      el.eventLog.innerHTML = state.log.map((entry) => `<li>${entry}</li>`).join("");
    }
  }

  function renderPowerups() {
    if (!el.powerups) return;
    el.powerups.innerHTML = `
      <div class="powerup-item" id="pup-heloc" style="cursor:pointer;padding:8px 10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:6px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <strong style="color:var(--ink);font-size:12px;">💰 HELOC Tap</strong>
          <div style="font-size:10.5px;color:var(--ink-dim);">Get +$350 instant equity cash</div>
        </div>
        <button class="btn btn--secondary" style="font-size:11px;padding:4px 8px;">Claim</button>
      </div>
      <div class="powerup-item" id="pup-shield" style="cursor:pointer;padding:8px 10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:6px;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <strong style="color:var(--ink);font-size:12px;">🛡️ Rent Shield</strong>
          <div style="font-size:10.5px;color:var(--ink-dim);">Blocks next 2 rent extractions</div>
        </div>
        <button class="btn btn--secondary" style="font-size:11px;padding:4px 8px;">Claim</button>
      </div>
    `;

    document.getElementById("pup-heloc")?.addEventListener("click", () => {
      api.showRewarded().then((ok) => {
        if (ok) {
          humanPlayer().cash += 350;
          playSfx("cash");
          api.toast("+$350 HELOC Cash injected!", "good");
          updateUI();
        }
      });
    });

    document.getElementById("pup-shield")?.addEventListener("click", () => {
      api.showRewarded().then((ok) => {
        if (ok) {
          humanPlayer().rentShield += 2;
          playSfx("upgrade");
          api.toast("🛡️ Rent Shield active for 2 turns!", "good");
          updateUI();
        }
      });
    });
  }

  function showOverlay(title, sub) {
    if (!el.overlay) return;
    if (el.overlayTitle) el.overlayTitle.textContent = title;
    if (el.overlaySub) el.overlaySub.innerHTML = sub;
    el.overlay.classList.add("overlay--show");
  }

  function hideOverlay() {
    if (el.overlay) el.overlay.classList.remove("overlay--show");
  }

  // =========================================================================
  // 14. MAIN GAME LOOP
  // =========================================================================

  function loop(now) {
    const dt = Math.min(0.045, (now - state.lastTime) / 1000 || 0);
    state.lastTime = now;

    if (!state.paused) {
      updateVisuals(dt);
    }

    draw(now);
    requestAnimationFrame(loop);
  }

  // =========================================================================
  // 15. INPUT CONTROLS & LISTENERS
  // =========================================================================

  window.addEventListener("keydown", (e) => {
    if (e.target?.matches?.("input, textarea, select, [contenteditable='true']")) return;
    if (["Space", "KeyR"].includes(e.code) && state.phase === "await_roll") {
      e.preventDefault();
      rollForActive();
    }
    if (["KeyB", "Enter"].includes(e.code) && state.phase === "decision") {
      e.preventDefault();
      acceptDecision();
    }
    if (["KeyP", "Escape"].includes(e.code) && state.phase === "decision") {
      e.preventDefault();
      declineDecision();
    }
  });

  el.primary?.addEventListener("click", resetGame);
  el.roll?.addEventListener("click", rollForActive);
  el.buy?.addEventListener("click", acceptDecision);
  el.pass?.addEventListener("click", declineDecision);
  el.pause?.addEventListener("click", () => {
    state.paused = !state.paused;
    el.pause.textContent = state.paused ? "Resume" : "Pause";
  });
  el.restart?.addEventListener("click", resetGame);

  canvas.addEventListener("click", (e) => {
    if (state.phase === "await_roll" && !state.busy) {
      rollForActive();
    }
  });

  buildBoardRects();
  updateSoundButton();
  resetGame();
  requestAnimationFrame(loop);
})();
