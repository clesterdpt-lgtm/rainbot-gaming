/* ============================================
   DRONE HUNTER — a Duck Hunt parody for the surveillance age
   - Snipe drones out of the neon sky with a crosshair.
   - 3 shots per wave. Hit your quota each round to advance.
   - Don't shoot the protected 🕊️ peace doves.
   - A robo-retriever dog fetches your kills and laughs at your misses.
   - Canvas game. Debug hook: window.__DRONE
   ============================================ */
(function () {
  "use strict";

  const GAME_ID = "dronehunter";
  const W = 900;
  const H = 600;
  const GROUND_Y = H - 86; // top of the grass band
  const SHOTS_PER_WAVE = 3;

  // Brand palette (mirrors styles.css :root)
  const C = {
    ink: "#fbfaf4",
    dim: "#b6b3c9",
    pink: "#ff2e88",
    cyan: "#2ee0ff",
    yellow: "#ffd43b",
    purple: "#b06cff",
    green: "#6bff7d",
    red: "#ff4f68",
  };

  // Drone/target archetypes.
  const TYPES = {
    delivery: { glyph: "📦", color: C.cyan, pts: 100, r: 34, speed: 1.0, label: "DELIVERY" },
    surveil: { glyph: "👁️", color: C.pink, pts: 250, r: 30, speed: 1.55, label: "SURVEIL" },
    mega: { glyph: "👑", color: C.yellow, pts: 500, r: 44, speed: 0.78, label: "MEGA AD" },
    dove: { glyph: "🕊️", color: C.green, pts: -100, r: 30, speed: 1.2, label: "PROTECTED" },
    supply: { glyph: "🎁", color: C.purple, pts: 50, r: 30, speed: 0.95, label: "SUPPLY" },
  };

  const api =
    typeof RB !== "undefined"
      ? RB
      : { recordScore: () => false, getHighScore: () => 0, toast: () => {} };

  // ---------- DOM ----------
  const canvas = document.getElementById("gameCanvas");
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
  const scoreEl = document.getElementById("hud-score");
  const roundEl = document.getElementById("hud-round");
  const hitsEl = document.getElementById("hud-hits");
  const ammoEl = document.getElementById("hud-ammo");
  const comboEl = document.getElementById("hud-combo");
  const strikesEl = document.getElementById("hud-strikes");
  const bestEl = document.getElementById("hud-best");

  // ---------- State ----------
  let phase = "idle"; // idle | play | dog | boss | bonus | over
  let round = 1;
  let score = 0;
  let bestAtStart = 0;
  let combo = 1;
  let ammo = SHOTS_PER_WAVE;
  let ammoCap = SHOTS_PER_WAVE; // how many bullet slots to draw this load

  // per-round bookkeeping
  let dronesPerRound = 6;
  let roundQuota = 3;
  let roundReleased = 0;
  let roundHits = 0;
  let waveSize = 1;
  let speedMul = 1;
  let flyTimeBase = 4200;
  let doveChance = 0;
  let doveFlockMax = 1;
  let doveSpeedMul = 1;
  let supplyChance = 0;
  let isBonusRound = false;

  // dove "strikes" — three protected doves down = license revoked
  let strikes = 0;
  const MAX_STRIKES = 3;

  // per-wave purity (for the PERFECT no-miss bonus)
  let waveDrones = 0; // wave-tagged drones spawned this wave
  let waveMisses = 0;
  let waveEscaped = 0;
  let perfectWave = true;
  let bonusAmmo = 0; // bonus bullet(s) carried into the NEXT wave after a PERFECT

  // power-ups
  const POWERUPS = ["ammo", "emp", "slowmo"];
  let slowmoMs = 0; // slow-motion timer
  let flashMs = 0; // EMP white flash
  let reloadT = 0; // auto-reload timer (boss / bonus rounds)

  // boss
  let boss = null; // { x, y, vx, dir, hp, maxHp, r, hitFlash, bob }
  let bossTimer = 0;
  let bonusTimer = 0; // bonus-round countdown
  let bonusSpawnT = 0;

  let targets = []; // flying drones + doves + supply crates
  let particles = []; // explosion bits
  let floats = []; // floating score text
  let shotFx = []; // muzzle/scan ping fx
  let waveHits = 0; // drones bagged in the current wave (drives dog pose)
  let banner = null; // { text, sub, ttl, life }

  // crosshair
  const aim = { x: W / 2, y: H / 2, has: false };
  let shake = 0;

  // dog
  const dog = { active: false, mode: "happy", count: 0, t: 0, dur: 1500, rise: 0, perfect: false };

  let running = false; // loop is integrating play
  let paused = false;
  let started = false;
  let lastT = 0;
  let rafId = 0;
  let timeMs = 0; // monotonic animation clock for rotors/flap
  let cursorHidden = false; // mirrors the .is-aiming class on the canvas wrap

  // Hide the OS cursor only while actively aiming (we draw our own crosshair then);
  // keep it visible over the start / round / game-over overlays so buttons are clickable.
  function updateCursor() {
    const hide = phase === "play" && running && !paused;
    if (hide !== cursorHidden) {
      cursorHidden = hide;
      if (wrap) wrap.classList.toggle("is-aiming", hide);
    }
  }

  // ---------- Sound ----------
  const SOUND_PREF_KEY = "rainbot_dronehunter_sound";
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;
  let soundOn = readSoundPreference();

  function readSoundPreference() {
    try {
      return localStorage.getItem(SOUND_PREF_KEY) !== "off";
    } catch (_) {
      return true;
    }
  }
  function writeSoundPreference() {
    try {
      localStorage.setItem(SOUND_PREF_KEY, soundOn ? "on" : "off");
    } catch (_) {}
  }
  function ensureAudio() {
    if (!soundOn || !AudioContextCtor) return null;
    if (!audioCtx) audioCtx = new AudioContextCtor();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }
  function playTone(freq, duration, options) {
    const ac = ensureAudio();
    if (!ac) return;
    const opts = options || {};
    const t0 = ac.currentTime + (opts.delay || 0);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = opts.type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.gain || 0.04, t0 + (opts.attack || 0.01));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }
  function noiseBurst(duration, gainVal) {
    const ac = ensureAudio();
    if (!ac) return;
    const len = Math.max(1, Math.floor(ac.sampleRate * duration));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(gainVal || 0.05, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
    src.connect(gain);
    gain.connect(ac.destination);
    src.start();
  }
  function playSfx(name) {
    if (!soundOn) return;
    if (name === "shoot") {
      playTone(880, 0.08, { type: "square", to: 180, gain: 0.05 });
      noiseBurst(0.05, 0.05);
    } else if (name === "empty") {
      playTone(150, 0.05, { type: "square", to: 90, gain: 0.03 });
    } else if (name === "hit") {
      noiseBurst(0.18, 0.07);
      playTone(220, 0.16, { type: "sawtooth", to: 60, gain: 0.04 });
    } else if (name === "mega") {
      [392, 523, 659, 784].forEach((f, i) =>
        playTone(f, 0.12, { type: "triangle", delay: i * 0.05, gain: 0.035 })
      );
    } else if (name === "dove") {
      playTone(330, 0.18, { type: "sine", to: 110, gain: 0.045 });
      playTone(160, 0.22, { type: "sawtooth", delay: 0.05, gain: 0.03 });
    } else if (name === "escape") {
      playTone(300, 0.3, { type: "sine", to: 760, gain: 0.03 });
    } else if (name === "laugh") {
      [240, 210, 190, 170].forEach((f, i) =>
        playTone(f, 0.1, { type: "square", delay: i * 0.12, gain: 0.03 })
      );
    } else if (name === "fetch") {
      playTone(523, 0.09, { type: "triangle", gain: 0.03 });
      playTone(784, 0.1, { type: "triangle", delay: 0.07, gain: 0.026 });
    } else if (name === "round") {
      [523, 659, 784, 1046].forEach((f, i) =>
        playTone(f, 0.14, { type: "triangle", delay: i * 0.08, gain: 0.035 })
      );
    } else if (name === "start") {
      playTone(330, 0.08, { type: "triangle", gain: 0.03 });
      playTone(660, 0.12, { type: "triangle", delay: 0.07, gain: 0.026 });
    } else if (name === "over") {
      playTone(300, 0.3, { type: "sawtooth", to: 80, gain: 0.05 });
      playTone(150, 0.4, { type: "sine", delay: 0.12, gain: 0.035 });
    } else if (name === "pause") {
      playTone(220, 0.08, { type: "sine", to: 150, gain: 0.022 });
    } else if (name === "resume") {
      playTone(260, 0.08, { type: "sine", to: 390, gain: 0.022 });
    } else if (name === "toggle") {
      playTone(440, 0.07, { type: "triangle", gain: 0.026 });
      playTone(660, 0.08, { type: "triangle", delay: 0.05, gain: 0.022 });
    }
  }

  function setSoundLabel() {
    if (!btnSound) return;
    if (!AudioContextCtor) {
      btnSound.textContent = "Sound Off";
      btnSound.setAttribute("aria-pressed", "false");
      btnSound.disabled = true;
      return;
    }
    btnSound.textContent = soundOn ? "Sound On" : "Sound Off";
    btnSound.setAttribute("aria-pressed", String(soundOn));
  }
  function toggleSound() {
    if (!AudioContextCtor) return;
    soundOn = !soundOn;
    writeSoundPreference();
    setSoundLabel();
    if (soundOn) {
      ensureAudio();
      playSfx("toggle");
    }
  }

  // ---------- Decorative scenery (precomputed so it doesn't flicker) ----------
  const stars = [];
  for (let i = 0; i < 60; i++) {
    stars.push({ x: Math.random() * W, y: Math.random() * (GROUND_Y - 120), r: Math.random() * 1.6 + 0.4, tw: Math.random() * Math.PI * 2 });
  }
  const buildings = [];
  (function makeSkyline() {
    let x = -10;
    while (x < W + 10) {
      const bw = 36 + Math.random() * 64;
      const bh = 80 + Math.random() * 190;
      const wins = [];
      for (let wy = GROUND_Y - bh + 14; wy < GROUND_Y - 18; wy += 20) {
        for (let wx = x + 8; wx < x + bw - 10; wx += 16) {
          if (Math.random() < 0.6) wins.push({ x: wx, y: wy, on: Math.random() < 0.5 });
        }
      }
      buildings.push({ x, w: bw, h: bh, wins });
      x += bw + 4 + Math.random() * 14;
    }
  })();

  // ---------- Round setup / waves ----------
  function setupRound(n) {
    round = n;
    dronesPerRound = 6 + (n - 1) * 2;
    waveSize = n < 3 ? 1 : n < 6 ? 2 : 3;
    const ratio = Math.min(0.7, 0.45 + n * 0.04);
    roundQuota = Math.max(1, Math.ceil(dronesPerRound * ratio));
    speedMul = 1 + (n - 1) * 0.16;
    flyTimeBase = Math.max(2500, 4200 - n * 200);
    doveChance = Math.min(0.88, 0.26 + n * 0.075);
    doveFlockMax = n < 3 ? 1 : n < 6 ? 2 : 3;
    doveSpeedMul = 1 + Math.min(0.45, (n - 1) * 0.06);
    supplyChance = n >= 2 ? 0.16 : 0;
    isBonusRound = n % 4 === 0; // every 4th round is a frenzy bonus round
    roundReleased = 0;
    roundHits = 0;
  }

  function pickDroneType() {
    if (round >= 2 && Math.random() < 0.09) return "mega";
    if (round >= 2 && Math.random() < 0.45) return "surveil";
    return "delivery";
  }

  function spawnTarget(kind, opts) {
    const t = TYPES[kind];
    const fromLeft = Math.random() < 0.5;
    const o = opts || {};
    const x = o.x != null ? o.x : fromLeft ? 80 + Math.random() * 120 : W - 80 - Math.random() * 120;
    const y = o.y != null ? o.y : GROUND_Y - 50 - Math.random() * 80;
    const base = (1.7 + Math.random() * 0.7) * t.speed * (kind === "dove" ? doveSpeedMul : speedMul);
    const dirX = o.dirX != null ? o.dirX : fromLeft ? 1 : -1;
    const drone = {
      kind,
      x,
      y,
      vx: dirX * base,
      vy: kind === "dove" ? 0 : -(0.3 + Math.random() * 0.5) * t.speed,
      r: t.r,
      pts: t.pts,
      glyph: t.glyph,
      color: t.color,
      label: t.label,
      inWave: !!o.inWave,
      status: "alive",
      age: 0,
      flyTime: kind === "dove" ? 99999 : flyTimeBase + Math.random() * 800,
      turnT: 600 + Math.random() * 700,
      spin: 0,
      fallVy: 0,
      tilt: 0,
      bob: Math.random() * Math.PI * 2,
    };
    targets.push(drone);
    return drone;
  }

  function spawnDoveFlock() {
    const count = 1 + Math.floor(Math.random() * doveFlockMax);
    const fromLeft = Math.random() < 0.5;
    const dirX = fromLeft ? 1 : -1;
    const startX = fromLeft ? -30 - Math.random() * 40 : W + 30 + Math.random() * 40;
    const y = 104 + Math.random() * (GROUND_Y - 214);
    for (let i = 0; i < count; i++) {
      spawnTarget("dove", {
        inWave: false,
        dirX,
        x: startX + dirX * i * (42 + Math.random() * 30),
        y: y + (Math.random() - 0.5) * 46,
      });
    }
  }

  function startWave() {
    phase = "play";
    ammo = SHOTS_PER_WAVE + bonusAmmo; // PERFECT-wave bonus bullet rolls in here
    ammoCap = ammo;
    bonusAmmo = 0;
    waveHits = 0;
    waveMisses = 0;
    waveEscaped = 0;
    perfectWave = true;
    const n = Math.min(waveSize, dronesPerRound - roundReleased);
    waveDrones = n;
    for (let i = 0; i < n; i++) {
      const kind = pickDroneType();
      spawnTarget(kind, { inWave: true });
      roundReleased++;
    }
    // Protected dove flocks cross the sightline as distractors (not part of the quota).
    if (doveChance > 0 && Math.random() < doveChance) {
      spawnDoveFlock();
    }
    // Rare supply crate — shoot it for a random power-up.
    if (supplyChance > 0 && Math.random() < supplyChance) {
      spawnTarget("supply", { inWave: false });
    }
    updateHud();
  }

  function inWaveRemaining() {
    let c = 0;
    for (const t of targets) if (t.inWave) c++;
    return c;
  }

  function forceFlee() {
    // Out of ammo: send any still-alive wave drones packing so the wave resolves.
    for (const t of targets) {
      if (t.inWave && t.status === "alive") {
        t.age = Math.max(t.age, t.flyTime - 250);
      }
    }
  }

  function endWave() {
    // PERFECT wave: every wave drone bagged, no misses, no escapes, no doves shot.
    const perfect = perfectWave && waveHits > 0 && waveHits === waveDrones && waveMisses === 0 && waveEscaped === 0;
    let perfectBonus = 0;
    if (perfect) {
      perfectBonus = 300 * waveHits;
      score += perfectBonus;
      bonusAmmo = 1; // carry a bonus 4th bullet into the next wave
      addFloat(W / 2, 150, "PERFECT +" + perfectBonus, C.yellow);
      playSfx("mega");
      api.recordScore(GAME_ID, score);
    }
    phase = "dog";
    dog.active = true;
    dog.mode = waveHits > 0 ? "happy" : "laugh";
    dog.perfect = perfect;
    dog.count = waveHits;
    dog.t = 0;
    dog.rise = 0;
    // clear any lingering doves/crates so they don't sit frozen during the dog beat
    targets = targets.filter((t) => t.status === "falling");
    playSfx(waveHits > 0 ? "fetch" : "laugh");
  }

  function afterDog() {
    dog.active = false;
    targets = [];
    if (roundReleased >= dronesPerRound) {
      endRound();
    } else {
      startWave();
    }
  }

  function endRound() {
    if (roundHits >= roundQuota) {
      // Boss reward fight after every 3rd round; otherwise straight to the next round.
      if (round % 3 === 0) {
        startBoss();
      } else {
        roundClearOverlay(
          "Round " + round + " cleared!",
          "You bagged <strong>" + roundHits + "</strong> of " + dronesPerRound +
            " drones (needed " + roundQuota + "). The airspace gets busier from here."
        );
      }
    } else {
      gameOver("Quota missed.");
    }
  }

  // Shared "you cleared this stage" overlay → continues to the next round.
  function roundClearOverlay(title, sub) {
    api.recordScore(GAME_ID, score);
    playSfx("round");
    phase = "over";
    showOverlay(title, sub, "Next round →", scoreLine(), () => {
      setupRound(round + 1);
      hideOverlay();
      startRoundFlow();
    });
  }

  // Decide what kind of round to launch (normal vs bonus frenzy).
  function startRoundFlow() {
    if (isBonusRound) {
      startBonusRound();
    } else {
      banner = { text: "ROUND " + round, sub: "Quota: " + roundQuota + " drones", ttl: 1600, life: 1600 };
      phase = "play";
      startWave();
    }
  }

  // ---------- Bonus round (frenzy) ----------
  function startBonusRound() {
    phase = "bonus";
    targets = [];
    bonusTimer = 18000;
    bonusSpawnT = 0;
    reloadT = 0;
    ammo = SHOTS_PER_WAVE + 2;
    ammoCap = ammo;
    banner = { text: "BONUS!", sub: "Blast everything — no penalties!", ttl: 1900, life: 1900 };
    playSfx("round");
    updateHud();
  }

  function spawnBonusDrone() {
    const r = Math.random();
    const kind = r < 0.12 ? "mega" : r < 0.55 ? "surveil" : "delivery";
    const d = spawnTarget(kind, { inWave: false });
    d.vx *= 1.3; // friskier in the frenzy
    d.flyTime = 6000; // they linger so you can rack up points
    return d;
  }

  function bonusEnd() {
    targets = targets.filter((t) => t.status === "falling");
    if (round % 3 === 0) {
      startBoss();
    } else {
      roundClearOverlay("Bonus Round Over!", "Nice frenzy. Back to the regular (heavily surveilled) skies.");
    }
  }

  // ---------- Boss (Prime Mothership) ----------
  function startBoss() {
    phase = "boss";
    targets = [];
    reloadT = 0;
    const hp = 6 + Math.floor(round / 3) * 2;
    boss = { x: W / 2, y: 150, vx: 1.7 + round * 0.12, dir: Math.random() < 0.5 ? 1 : -1, hp, maxHp: hp, r: 82, hitFlash: 0, bob: Math.random() * 6 };
    bossTimer = 16000;
    ammo = 6;
    ammoCap = 6;
    banner = { text: "BOSS", sub: "PRIME MOTHERSHIP", ttl: 1900, life: 1900 };
    playSfx("mega");
    updateHud();
  }

  function updateBoss(dt) {
    bossTimer -= dt;
    boss.bob += dt * 0.004;
    boss.x += boss.vx * boss.dir * (dt / 16.67);
    if (boss.x < boss.r + 20) { boss.x = boss.r + 20; boss.dir = 1; }
    if (boss.x > W - boss.r - 20) { boss.x = W - boss.r - 20; boss.dir = -1; }
    boss.y = 150 + Math.sin(boss.bob) * 28;
    if (boss.hitFlash > 0) boss.hitFlash -= dt;
    if (ammo <= 0) {
      reloadT -= dt;
      if (reloadT <= 0) { ammo = 6; ammoCap = 6; reloadT = 850; playSfx("empty"); updateHud(); }
    }
    if (bossTimer <= 0) bossEscape();
  }

  function handleBossShot(px, py) {
    if (!boss) return;
    if (Math.hypot(boss.x - px, boss.y - py) <= boss.r) {
      boss.hp--;
      boss.hitFlash = 130;
      score += 60;
      combo = Math.min(8, combo + 1);
      burst(px, py, C.yellow, 9);
      addFloat(px, py, "+60", C.yellow);
      playSfx("hit");
      api.recordScore(GAME_ID, score);
      if (boss.hp <= 0) bossKilled();
    } else {
      combo = 1;
    }
  }

  function bossKilled() {
    const bonus = 2000 + round * 200;
    score += bonus;
    api.recordScore(GAME_ID, score);
    for (let i = 0; i < 6; i++) {
      burst(boss.x + (Math.random() - 0.5) * boss.r, boss.y + (Math.random() - 0.5) * boss.r, i % 2 ? C.yellow : C.pink, 16);
    }
    shake = 16;
    playSfx("mega");
    boss = null;
    roundClearOverlay("Mothership Down!", "You splashed the Prime Mothership for a <strong>+" + bonus.toLocaleString() + "</strong> bonus. The dog is speechless.");
  }

  function bossEscape() {
    boss = null;
    playSfx("escape");
    api.toast("🛸 The Mothership jumped to hyperspace. No bonus.", "bad");
    roundClearOverlay("It Got Away.", "The Prime Mothership escaped before you could down it. No bonus this time — get it next cycle.");
  }

  // ---------- Power-ups ----------
  function grantPowerup(px, py, forced) {
    const kind = forced || POWERUPS[(Math.random() * POWERUPS.length) | 0];
    if (kind === "ammo") {
      ammo = SHOTS_PER_WAVE + 3;
      ammoCap = ammo;
      addFloat(px, py, "AMMO CRATE!", C.yellow);
      api.toast("📦 Supply drop: ammo loaded!", "good");
      playSfx("fetch");
    } else if (kind === "emp") {
      flashMs = 320;
      shake = 14;
      let n = 0;
      for (const t of targets) {
        if (t.status === "alive" && (t.kind === "delivery" || t.kind === "surveil" || t.kind === "mega")) {
          t.status = "falling";
          t.fallVy = 0.6;
          n++;
          score += t.pts;
          if (t.inWave) { roundHits++; waveHits++; }
          burst(t.x, t.y, t.color, 10);
        }
      }
      addFloat(W / 2, 150, "EMP! " + n + " ZAPPED", C.cyan);
      api.toast("💥 EMP burst — sky cleared!", "good");
      api.recordScore(GAME_ID, score);
      playSfx("mega");
    } else {
      slowmoMs = 5000;
      addFloat(px, py, "SLOW-MO!", C.purple);
      api.toast("🐢 Time dilation engaged.", "good");
      playSfx("fetch");
    }
    updateHud();
  }

  function gameOver(reason, title) {
    phase = "over";
    running = false;
    boss = null;
    playSfx("over");
    const isBest = score > bestAtStart && score >= api.getHighScore(GAME_ID) && score > 0;
    api.recordScore(GAME_ID, score);
    if (isBest) setTimeout(() => api.toast("🏆 New high score!", "good"), 250);
    showOverlay(
      title || "Drone Got Away.",
      reason + " The robo-dog is updating your performance review.",
      "Hunt again",
      scoreLine(),
      newGame
    );
  }

  function scoreLine() {
    return (
      "Score: <strong>" + score.toLocaleString() +
      "</strong> · Round: <strong>" + round +
      "</strong> · High: <strong>" + api.getHighScore(GAME_ID).toLocaleString() + "</strong>"
    );
  }

  // ---------- Shooting ----------
  function fireAt(px, py) {
    if (paused) return;
    if (phase !== "play" && phase !== "boss" && phase !== "bonus") return;
    if (ammo <= 0) {
      playSfx("empty");
      shotFx.push({ x: px, y: py, ttl: 240, life: 240, empty: true });
      return;
    }
    ammo--;
    shake = Math.min(shake + 6, 12);
    playSfx("shoot");
    shotFx.push({ x: px, y: py, ttl: 260, life: 260, empty: false });

    if (phase === "boss") {
      handleBossShot(px, py);
      updateHud();
      return;
    }

    // Find the best (closest, on-target) hittable thing.
    let best = null;
    let bestD = Infinity;
    for (const t of targets) {
      if (t.status !== "alive") continue;
      const dx = t.x - px;
      const dy = t.y - py;
      const d = Math.hypot(dx, dy);
      if (d <= t.r + 14 && d < bestD) {
        bestD = d;
        best = t;
      }
    }

    if (!best) {
      combo = 1;
      if (phase === "play") { waveMisses++; perfectWave = false; }
      updateHud();
      if (ammo <= 0 && phase === "play") forceFlee();
      return;
    }

    if (best.kind === "dove") {
      best.status = "falling";
      best.fallVy = 0.5;
      best.tilt = 0;
      combo = 1;
      perfectWave = false;
      score = Math.max(0, score + best.pts);
      strikes++;
      playSfx("dove");
      addFloat(best.x, best.y, "−100 DOVE! STRIKE " + strikes, C.red);
      burst(best.x, best.y, C.green, 10);
      if (strikes >= MAX_STRIKES) {
        updateHud();
        gameOver("Three protected doves down — that's a strike-out.", "License Revoked.");
        return;
      }
      api.toast("🕊️ Protected dove! Strike " + strikes + " of " + MAX_STRIKES + ".", "bad");
      updateHud();
      if (ammo <= 0 && phase === "play") forceFlee();
      return;
    }

    if (best.kind === "supply") {
      best.status = "falling";
      best.fallVy = 0.5;
      score += best.pts;
      combo = Math.min(8, combo + 1);
      burst(best.x, best.y, best.color, 12);
      grantPowerup(best.x, best.y);
      updateHud();
      if (ammo <= 0 && phase === "play") forceFlee();
      return;
    }

    // A real drone — bag it.
    best.status = "falling";
    best.fallVy = 0.6;
    const gained = Math.round(best.pts * combo);
    score += gained;
    if (best.inWave) { roundHits++; waveHits++; }
    addFloat(best.x, best.y, "+" + gained + (combo > 1 ? " x" + combo : ""), best.color);
    burst(best.x, best.y, best.color, best.kind === "mega" ? 22 : 14);
    playSfx(best.kind === "mega" ? "mega" : "hit");
    combo = Math.min(8, combo + 1);
    api.recordScore(GAME_ID, score);
    updateHud();
    if (ammo <= 0 && phase === "play") forceFlee();
  }

  // ---------- Particles / floats ----------
  function burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 4;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1,
        ttl: 500 + Math.random() * 400,
        life: 900,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }
  function addFloat(x, y, text, color) {
    floats.push({ x, y, text, color, ttl: 900, life: 900 });
    if (floats.length > 12) floats.shift();
  }

  // ---------- Update ----------
  // Move every flying/falling target one tick. `ts` is the time-scale (slow-mo).
  function stepTargets(dt, ts) {
    for (const t of targets) {
      t.bob += dt * 0.006;
      if (t.status === "alive") {
        t.age += dt * ts;
        if (t.kind !== "dove") {
          // wandering: occasionally retarget heading
          t.turnT -= dt * ts;
          if (t.turnT <= 0) {
            t.turnT = 500 + Math.random() * 700;
            const sp = Math.hypot(t.vx, t.vy) || 2;
            const ang = Math.random() * Math.PI * 2;
            t.vx = Math.cos(ang) * sp;
            t.vy = Math.sin(ang) * sp * 0.7 - 0.4; // bias slightly upward
          }
          // escape run once the patience timer expires
          if (t.age >= t.flyTime) {
            t.vy = -3.4 * speedMul;
            t.vx *= 0.98;
          }
        }
        const dtf = (dt / 16.67) * ts;
        t.x += t.vx * dtf;
        t.y += t.vy * dtf;
        t.tilt = Math.max(-0.4, Math.min(0.4, t.vx * 0.05));

        // bounce off side + ceiling while still patrolling
        if (t.age < t.flyTime && t.kind !== "dove") {
          if (t.x < t.r + 8) { t.x = t.r + 8; t.vx = Math.abs(t.vx); }
          if (t.x > W - t.r - 8) { t.x = W - t.r - 8; t.vx = -Math.abs(t.vx); }
          if (t.y < t.r + 40) { t.y = t.r + 40; t.vy = Math.abs(t.vy) * 0.6; }
          if (t.y > GROUND_Y - t.r - 6) { t.y = GROUND_Y - t.r - 6; t.vy = -Math.abs(t.vy); }
        }

        // resolved by escaping
        if (t.y < -60 || t.x < -80 || t.x > W + 80) {
          t.status = "gone";
          if (t.kind !== "dove" && t.inWave) { playSfx("escape"); waveEscaped++; perfectWave = false; }
        }
      } else if (t.status === "falling") {
        t.fallVy += dt * 0.0009 * 16.67;
        const dtf = dt / 16.67;
        t.y += t.fallVy * 6 * dtf;
        t.x += t.vx * 0.3 * dtf;
        t.spin += dt * 0.012;
        if (t.y > GROUND_Y + 50) t.status = "gone";
      }
    }
  }

  function update(dt) {
    timeMs += dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 0.03);
    if (slowmoMs > 0) slowmoMs = Math.max(0, slowmoMs - dt);
    if (flashMs > 0) flashMs = Math.max(0, flashMs - dt);
    const ts = slowmoMs > 0 ? 0.45 : 1;

    if (phase === "play" && !paused) {
      const before = inWaveRemaining();
      stepTargets(dt, ts);
      targets = targets.filter((t) => t.status !== "gone");
      // wave resolves once no wave drones are left flying or falling
      if (before > 0 && inWaveRemaining() === 0) endWave();
    } else if (phase === "bonus" && !paused) {
      bonusTimer -= dt;
      bonusSpawnT -= dt;
      if (ammo <= 0) {
        reloadT -= dt;
        if (reloadT <= 0) { ammo = SHOTS_PER_WAVE + 2; ammoCap = ammo; reloadT = 600; playSfx("empty"); updateHud(); }
      }
      if (bonusSpawnT <= 0 && targets.filter((t) => t.status === "alive").length < 7) {
        bonusSpawnT = 320 + Math.random() * 300;
        spawnBonusDrone();
      }
      stepTargets(dt, ts);
      targets = targets.filter((t) => t.status !== "gone");
      if (bonusTimer <= 0) bonusEnd();
    } else if (phase === "boss" && !paused) {
      updateBoss(dt);
    }

    if (phase === "dog") {
      dog.t += dt;
      const half = dog.dur / 2;
      dog.rise = dog.t < half ? Math.min(1, dog.t / 300) : Math.max(0, 1 - (dog.t - half) / 300);
      // let any still-falling drones settle behind the grass
      for (const t of targets) {
        if (t.status === "falling") {
          t.fallVy += dt * 0.0009 * 16.67;
          t.y += t.fallVy * 6 * (dt / 16.67);
          t.spin += dt * 0.012;
          if (t.y > GROUND_Y + 50) t.status = "gone";
        }
      }
      targets = targets.filter((t) => t.status !== "gone");
      if (dog.t >= dog.dur) afterDog();
    }

    // fx decay (always, even when paused stops play)
    if (!paused) {
      for (const p of particles) {
        p.ttl -= dt;
        p.vy += dt * 0.012;
        p.x += p.vx * (dt / 16.67);
        p.y += p.vy * (dt / 16.67);
      }
      particles = particles.filter((p) => p.ttl > 0 && p.y < H + 20);
      for (const f of floats) { f.ttl -= dt; f.y -= dt * 0.02; }
      floats = floats.filter((f) => f.ttl > 0);
      for (const s of shotFx) s.ttl -= dt;
      shotFx = shotFx.filter((s) => s.ttl > 0);
      if (banner) { banner.ttl -= dt; if (banner.ttl <= 0) banner = null; }
    }
  }

  // ---------- Rendering ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    g.addColorStop(0, "#0a0820");
    g.addColorStop(0.5, "#221347");
    g.addColorStop(0.82, "#5a1f5e");
    g.addColorStop(1, "#a8324f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, GROUND_Y);

    // stars
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(timeMs * 0.002 + s.tw);
      ctx.globalAlpha = 0.3 + tw * 0.6;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // moon
    ctx.save();
    ctx.shadowColor = "rgba(255,225,180,0.5)";
    ctx.shadowBlur = 40;
    ctx.fillStyle = "#f4e6c6";
    ctx.beginPath();
    ctx.arc(760, 110, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "rgba(180,150,110,0.35)";
    ctx.beginPath(); ctx.arc(748, 96, 9, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(778, 124, 12, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(770, 100, 6, 0, Math.PI * 2); ctx.fill();
  }

  function drawSkyline() {
    for (const b of buildings) {
      ctx.fillStyle = "#100a26";
      ctx.fillRect(b.x, GROUND_Y - b.h, b.w, b.h);
      ctx.fillStyle = "rgba(46,224,255,0.08)";
      ctx.fillRect(b.x, GROUND_Y - b.h, 2, b.h);
      for (const win of b.wins) {
        const on = win.on && (Math.sin(timeMs * 0.0007 + win.x) > -0.6);
        ctx.fillStyle = on ? "rgba(255,212,59,0.8)" : "rgba(120,130,180,0.12)";
        ctx.fillRect(win.x, win.y, 5, 7);
      }
    }
  }

  function drawGrass() {
    const g = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    g.addColorStop(0, "#1f7a3a");
    g.addColorStop(1, "#0c3a1d");
    ctx.fillStyle = g;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    // neon grass blades along the top edge
    ctx.strokeStyle = "rgba(107,255,125,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 6; x < W; x += 16) {
      const sway = Math.sin(timeMs * 0.002 + x) * 3;
      ctx.moveTo(x, GROUND_Y + 2);
      ctx.lineTo(x + sway, GROUND_Y - 12);
    }
    ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, GROUND_Y, W, 3);
  }

  function drawDrone(t) {
    ctx.save();
    ctx.translate(t.x, t.y);
    const bobY = t.status === "alive" ? Math.sin(t.bob) * 3 : 0;
    if (t.status === "falling") ctx.rotate(t.spin);
    else ctx.rotate(t.tilt);
    ctx.translate(0, bobY);

    const s = t.r / 34; // scale relative to the base delivery drone

    if (t.kind === "dove") {
      drawDove(t, s);
      ctx.restore();
      return;
    }

    // rotor arms
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 4 * s;
    const arm = 26 * s;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(sx * arm, -10 * s);
      ctx.stroke();
    }
    // spinning rotors
    const spin = timeMs * 0.05;
    for (const sx of [-1, 1]) {
      const rx = sx * arm;
      const ry = -12 * s;
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(spin * sx);
      ctx.strokeStyle = "rgba(220,235,255,0.85)";
      ctx.lineWidth = 2.5 * s;
      ctx.beginPath();
      ctx.ellipse(0, 0, 14 * s, 3 * s, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "#cdd6e6";
      ctx.beginPath();
      ctx.arc(rx, ry, 3 * s, 0, Math.PI * 2);
      ctx.fill();
    }

    // glow
    ctx.shadowColor = t.color;
    ctx.shadowBlur = 18;
    // body
    ctx.fillStyle = t.color;
    roundRect(-20 * s, -8 * s, 40 * s, 26 * s, 8 * s);
    ctx.fill();
    ctx.shadowBlur = 0;
    // darker belly
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    roundRect(-20 * s, 6 * s, 40 * s, 12 * s, 6 * s);
    ctx.fill();
    // camera eye / glyph
    ctx.font = Math.round(20 * s) + "px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t.glyph, 0, 4 * s);
    // little landing legs
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(-12 * s, 18 * s); ctx.lineTo(-16 * s, 26 * s);
    ctx.moveTo(12 * s, 18 * s); ctx.lineTo(16 * s, 26 * s);
    ctx.stroke();

    ctx.restore();
  }

  function drawDove(t, s) {
    // body
    ctx.shadowColor = t.color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#eef6ff";
    ctx.beginPath();
    ctx.ellipse(0, 0, 16 * s, 10 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // flapping wings
    const flap = Math.sin(timeMs * 0.02) * 0.6;
    ctx.fillStyle = "#dfeafb";
    for (const sx of [-1, 1]) {
      ctx.save();
      ctx.rotate(sx * (0.5 + flap));
      ctx.beginPath();
      ctx.ellipse(sx * 6 * s, -6 * s, 16 * s, 7 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // head + beak
    ctx.fillStyle = "#eef6ff";
    ctx.beginPath();
    ctx.arc(13 * s * Math.sign(t.vx || 1), -4 * s, 6 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.yellow;
    ctx.beginPath();
    const hx = 13 * s * Math.sign(t.vx || 1);
    ctx.moveTo(hx + Math.sign(t.vx || 1) * 6 * s, -4 * s);
    ctx.lineTo(hx + Math.sign(t.vx || 1) * 12 * s, -2 * s);
    ctx.lineTo(hx + Math.sign(t.vx || 1) * 6 * s, 0);
    ctx.fill();
    // glyph badge so it's unmistakable
    ctx.font = Math.round(15 * s) + "px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🕊️", 0, 2 * s);
  }

  function drawDog() {
    if (!dog.active) return;
    const baseY = GROUND_Y + 30;
    const peek = 150 * dog.rise;
    const cx = W / 2;
    const cy = baseY - peek;
    ctx.save();
    ctx.translate(cx, cy);

    // shadow ground contact
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, GROUND_Y - cy + 6, 60, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    // body
    ctx.fillStyle = "#8a5a2b";
    roundRect(-46, 0, 92, 110, 24);
    ctx.fill();
    // belly
    ctx.fillStyle = "#d9b483";
    roundRect(-26, 36, 52, 70, 18);
    ctx.fill();

    // head
    ctx.fillStyle = "#8a5a2b";
    ctx.beginPath();
    ctx.arc(0, -8, 42, 0, Math.PI * 2);
    ctx.fill();
    // ear
    ctx.fillStyle = "#5e3c1c";
    ctx.beginPath();
    ctx.ellipse(-40, -10, 14, 30, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(40, -10, 14, 30, -0.2, 0, Math.PI * 2);
    ctx.fill();
    // snout
    ctx.fillStyle = "#d9b483";
    ctx.beginPath();
    ctx.ellipse(0, 8, 26, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a1a0c";
    ctx.beginPath();
    ctx.arc(0, 2, 7, 0, Math.PI * 2);
    ctx.fill();
    // little robo antenna (Rainbot retriever)
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -48); ctx.lineTo(0, -64);
    ctx.stroke();
    ctx.fillStyle = C.cyan;
    ctx.beginPath();
    ctx.arc(0, -66, 4, 0, Math.PI * 2);
    ctx.fill();

    if (dog.mode === "laugh") {
      // squinty laughing eyes
      ctx.strokeStyle = "#2a1a0c";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-22, -16); ctx.lineTo(-8, -10);
      ctx.moveTo(22, -16); ctx.lineTo(8, -10);
      ctx.stroke();
      // open laughing mouth
      ctx.fillStyle = "#6a1020";
      ctx.beginPath();
      ctx.ellipse(0, 18, 14, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ff7a8f";
      ctx.beginPath();
      ctx.ellipse(0, 22, 7, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // "HEH HEH HEH"
      ctx.font = "900 20px 'Bungee', sans-serif";
      ctx.fillStyle = C.yellow;
      ctx.textAlign = "center";
      ctx.fillText("HEH HEH HEH", 0, -90);
    } else {
      // happy eyes
      ctx.fillStyle = "#2a1a0c";
      ctx.beginPath(); ctx.arc(-16, -14, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(16, -14, 5, 0, Math.PI * 2); ctx.fill();
      // grin
      ctx.strokeStyle = "#2a1a0c";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 8, 14, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
      // held-up retrieved drone(s)
      ctx.font = "30px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const held = Math.min(dog.count, 3);
      for (let i = 0; i < held; i++) {
        const ox = (i - (held - 1) / 2) * 34;
        ctx.fillText("📦", ox, -64);
      }
      ctx.font = "900 18px 'Bungee', sans-serif";
      ctx.fillStyle = dog.perfect ? C.yellow : C.green;
      ctx.fillText(dog.perfect ? "⭐ PERFECT!" : dog.count + " BAGGED", 0, -92);
    }

    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.ttl / p.life));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawFloats() {
    for (const f of floats) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.ttl / f.life));
      ctx.font = "900 18px 'Bungee', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillText(f.text, f.x + 2, f.y + 2);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawShotFx() {
    for (const s of shotFx) {
      const k = s.ttl / s.life;
      if (s.empty) {
        ctx.strokeStyle = "rgba(255,79,104," + k + ")";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(s.x - 10, s.y - 10); ctx.lineTo(s.x + 10, s.y + 10);
        ctx.moveTo(s.x + 10, s.y - 10); ctx.lineTo(s.x - 10, s.y + 10);
        ctx.stroke();
      } else {
        ctx.strokeStyle = "rgba(255,212,59," + k + ")";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, (1 - k) * 26 + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawCrosshair() {
    if (!aim.has || (phase !== "play" && phase !== "boss" && phase !== "bonus")) return;
    const x = aim.x;
    const y = aim.y;
    const dim = phase === "play" && ammo > 0 ? 1 : 0.4;
    ctx.save();
    ctx.globalAlpha = dim;
    ctx.strokeStyle = ammo > 0 ? C.cyan : C.red;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 26, y); ctx.lineTo(x - 12, y);
    ctx.moveTo(x + 12, y); ctx.lineTo(x + 26, y);
    ctx.moveTo(x, y - 26); ctx.lineTo(x, y - 12);
    ctx.moveTo(x, y + 12); ctx.lineTo(x, y + 26);
    ctx.stroke();
    ctx.fillStyle = ammo > 0 ? C.pink : C.red;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawAmmo() {
    const x0 = 18;
    const y0 = H - 30;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "900 14px 'JetBrains Mono', monospace";
    ctx.fillStyle = C.dim;
    ctx.fillText("AMMO", x0, y0 - 22);
    const slots = Math.min(8, Math.max(SHOTS_PER_WAVE, ammoCap));
    for (let i = 0; i < slots; i++) {
      const live = i < ammo;
      ctx.save();
      ctx.translate(x0 + 10 + i * 26, y0);
      ctx.fillStyle = live ? C.yellow : "rgba(255,255,255,0.18)";
      if (live) { ctx.shadowColor = C.yellow; ctx.shadowBlur = 8; }
      roundRect(-6, -10, 12, 20, 4);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = live ? "#7a5a00" : "transparent";
      roundRect(-6, -10, 12, 6, 3);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawBoss() {
    const flash = boss.hitFlash > 0;
    ctx.save();
    ctx.translate(boss.x, boss.y);

    // glow
    ctx.shadowColor = flash ? "#fff" : C.pink;
    ctx.shadowBlur = flash ? 40 : 24;

    // big saucer body
    ctx.fillStyle = flash ? "#ffffff" : "#241433";
    ctx.beginPath();
    ctx.ellipse(0, 8, boss.r, boss.r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // hull stripe
    ctx.fillStyle = flash ? "#ffd9ec" : "#3a2150";
    ctx.beginPath();
    ctx.ellipse(0, 2, boss.r * 0.92, boss.r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // dome
    ctx.fillStyle = flash ? "#fff" : C.pink;
    ctx.beginPath();
    ctx.ellipse(0, -16, boss.r * 0.42, boss.r * 0.36, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    // angry eye
    ctx.fillStyle = "#0a0512";
    ctx.beginPath();
    ctx.arc(0, -18, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = flash ? "#fff" : C.red;
    ctx.beginPath();
    ctx.arc(0, -18, 6, 0, Math.PI * 2);
    ctx.fill();

    // running lights
    for (let i = -3; i <= 3; i++) {
      const lit = (Math.floor(timeMs / 120) + i) % 2 === 0;
      ctx.fillStyle = lit ? C.yellow : "rgba(255,255,255,0.18)";
      ctx.beginPath();
      ctx.arc(i * (boss.r / 3.4), 16, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // PRIME label
    ctx.font = "900 13px 'JetBrains Mono', monospace";
    ctx.fillStyle = flash ? "#241433" : C.cyan;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("PRIME", 0, 6);

    // HP bar
    const bw = boss.r * 2;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(-bw / 2, -boss.r * 0.6 - 16, bw, 10, 4);
    ctx.fill();
    ctx.fillStyle = C.red;
    const frac = Math.max(0, boss.hp / boss.maxHp);
    roundRect(-bw / 2, -boss.r * 0.6 - 16, bw * frac, 10, 4);
    ctx.fill();
    ctx.restore();
  }

  function drawBossTimer() {
    const frac = Math.max(0, bossTimer / 16000);
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(0, 0, W, 6);
    ctx.fillStyle = C.yellow;
    ctx.fillRect(0, 0, W * frac, 6);
  }

  function drawBonusTimer() {
    const frac = Math.max(0, bonusTimer / 18000);
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(0, 0, W, 6);
    ctx.fillStyle = C.green;
    ctx.fillRect(0, 0, W * frac, 6);
  }

  function drawSlowmo() {
    ctx.save();
    ctx.fillStyle = "rgba(176,108,255,0.10)";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = Math.min(1, slowmoMs / 800);
    ctx.font = "900 16px 'JetBrains Mono', monospace";
    ctx.fillStyle = C.purple;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("◀◀ SLOW-MO", W - 16, 14);
    ctx.restore();
  }

  function drawBanner() {
    if (!banner) return;
    const k = Math.min(1, banner.ttl / 400);
    ctx.save();
    ctx.globalAlpha = k;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 52px 'Bungee', sans-serif";
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillText(banner.text, W / 2 + 3, H / 2 - 20 + 3);
    ctx.fillStyle = C.cyan;
    ctx.fillText(banner.text, W / 2, H / 2 - 20);
    if (banner.sub) {
      ctx.font = "900 20px 'JetBrains Mono', monospace";
      ctx.fillStyle = C.yellow;
      ctx.fillText(banner.sub, W / 2, H / 2 + 26);
    }
    ctx.restore();
  }

  function draw() {
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    drawSky();
    drawSkyline();

    if (boss) drawBoss();

    // drones + doves + crates (above grass)
    for (const t of targets) drawDrone(t);
    drawParticles();

    drawGrass();
    drawDog();

    drawFloats();
    drawShotFx();
    drawAmmo();
    if (slowmoMs > 0) drawSlowmo();
    if (phase === "boss" && boss) drawBossTimer();
    if (phase === "bonus") drawBonusTimer();
    drawBanner();
    drawCrosshair();
    if (flashMs > 0) {
      ctx.fillStyle = "rgba(220,240,255," + Math.min(0.7, flashMs / 320) + ")";
      ctx.fillRect(0, 0, W, H);
    }

    if (paused && (phase === "play" || phase === "boss" || phase === "bonus")) {
      ctx.fillStyle = "rgba(8,8,16,0.62)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = C.ink;
      ctx.font = "900 40px 'Bungee', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("PAUSED", W / 2, H / 2 - 8);
      ctx.font = "600 14px 'JetBrains Mono', monospace";
      ctx.fillStyle = C.dim;
      ctx.fillText("press P or tap Resume", W / 2, H / 2 + 28);
    }
    ctx.restore();
  }

  // ---------- HUD ----------
  function updateHud() {
    if (scoreEl) scoreEl.textContent = score.toLocaleString();
    if (roundEl) roundEl.textContent = isBonusRound ? round + " ★" : String(round);
    if (hitsEl) hitsEl.textContent = phase === "boss" ? "BOSS" : phase === "bonus" ? "FRENZY" : roundHits + "/" + roundQuota;
    if (comboEl) comboEl.textContent = "x" + combo;
    if (bestEl) bestEl.textContent = api.getHighScore(GAME_ID).toLocaleString();
    if (ammoEl) {
      const slots = Math.min(8, Math.max(SHOTS_PER_WAVE, ammoCap));
      let s = "";
      for (let i = 0; i < slots; i++) s += i < ammo ? "🟡" : "⚫";
      ammoEl.textContent = s;
    }
    if (strikesEl) {
      let s = "";
      for (let i = 0; i < MAX_STRIKES; i++) s += i < strikes ? "❌" : "🕊️";
      strikesEl.textContent = s;
    }
  }

  // ---------- Overlay ----------
  function showOverlay(title, sub, btnLabel, scoreHtml, onClick) {
    overlayTitle.innerHTML = title;
    overlaySub.innerHTML = sub;
    overlayScore.innerHTML = scoreHtml || "";
    btnPrimary.textContent = btnLabel;
    btnPrimary.onclick = onClick;
    overlayEl.classList.add("overlay--show");
  }
  function hideOverlay() {
    overlayEl.classList.remove("overlay--show");
  }

  // ---------- Lifecycle ----------
  function newGame() {
    ensureAudio();
    playSfx("start");
    score = 0;
    combo = 1;
    strikes = 0;
    bonusAmmo = 0;
    slowmoMs = 0;
    flashMs = 0;
    boss = null;
    targets = [];
    particles = [];
    floats = [];
    shotFx = [];
    dog.active = false;
    started = true;
    running = true;
    paused = false;
    bestAtStart = api.getHighScore(GAME_ID);
    setupRound(1);
    hideOverlay();
    setPauseLabel();
    updateHud();
    lastT = performance.now();
    startRoundFlow();
  }

  function togglePause() {
    if (phase !== "play" && phase !== "boss" && phase !== "bonus") return;
    paused = !paused;
    playSfx(paused ? "pause" : "resume");
    setPauseLabel();
    if (!paused) lastT = performance.now();
  }
  function setPauseLabel() {
    if (btnPause) btnPause.textContent = paused ? "Resume" : "Pause";
  }

  // ---------- Main loop ----------
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    let dt = now - lastT;
    lastT = now;
    if (dt < 0) dt = 0;
    if (dt > 100) dt = 100; // clamp big gaps (backgrounded tab)
    if (running && !paused) update(dt);
    else timeMs += dt; // keep scenery breathing on the menu / pause
    updateCursor();
    draw();
  }

  // ---------- Input ----------
  function toCanvas(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * H,
    };
  }

  canvas.addEventListener("mousemove", (e) => {
    const p = toCanvas(e.clientX, e.clientY);
    aim.x = p.x; aim.y = p.y; aim.has = true;
  });
  canvas.addEventListener("mouseleave", () => { aim.has = false; });

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    ensureAudio();
    const p = toCanvas(e.clientX, e.clientY);
    aim.x = p.x; aim.y = p.y; aim.has = true;
    fireAt(p.x, p.y);
  });

  // Mobile: drag to aim (the crosshair floats ABOVE the fingertip so you can see
  // the target), lift to fire. Beats tap-to-shoot where the thumb hides the target.
  let touchAiming = false;
  const TOUCH_LIFT = 90; // canvas px the crosshair sits above the finger
  function touchPoint(t) {
    const p = toCanvas(t.clientX, t.clientY);
    return { x: p.x, y: Math.max(18, p.y - TOUCH_LIFT) };
  }
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    ensureAudio();
    const p = touchPoint(e.touches[0]);
    aim.x = p.x; aim.y = p.y; aim.has = true;
    touchAiming = true;
  }, { passive: false });

  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const t = e.touches[0];
    if (!t) return;
    const p = touchPoint(t);
    aim.x = p.x; aim.y = p.y; aim.has = true;
  }, { passive: false });

  canvas.addEventListener("touchend", (e) => {
    e.preventDefault();
    if (!touchAiming) return;
    touchAiming = false;
    fireAt(aim.x, aim.y);
  }, { passive: false });

  canvas.addEventListener("touchcancel", () => { touchAiming = false; });

  document.addEventListener("keydown", (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "p" || e.key === "P") {
      if (phase === "play") { e.preventDefault(); togglePause(); }
      return;
    }
    if ((e.key === " " || e.key === "Enter") && phase === "idle") {
      e.preventDefault();
      newGame();
      return;
    }
    if (e.key === " " && (phase === "play" || phase === "boss" || phase === "bonus") && !paused) {
      // keyboard fallback: fire at current crosshair
      e.preventDefault();
      fireAt(aim.x, aim.y);
    }
  });

  if (btnNew) btnNew.addEventListener("click", newGame);
  if (btnPause) btnPause.addEventListener("click", togglePause);
  if (btnSound) btnSound.addEventListener("click", toggleSound);

  // ---------- Fullscreen (Max) ----------
  (function bindFullscreen() {
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
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isMaxed() && !nativeFsEl()) { setMaxed(false); }
    });
    updateBtn();
  })();

  // ---------- Init ----------
  setupRound(1);
  setSoundLabel();
  updateHud();
  btnPrimary.onclick = newGame;
  // seed a couple of idle drones drifting behind the menu so the canvas isn't empty
  spawnTarget("delivery", { x: 240, y: GROUND_Y - 150, inWave: false });
  spawnTarget("surveil", { x: 640, y: GROUND_Y - 200, inWave: false });
  lastT = performance.now();
  rafId = requestAnimationFrame(frame);

  // ---------- Debug hook ----------
  window.__DRONE = {
    start: newGame,
    pause: togglePause,
    shootAt: (x, y) => fireAt(x, y),
    spawn: (kind) => spawnTarget(kind || "delivery", { inWave: phase === "play" }),
    nextRound: () => { setupRound(round + 1); startRoundFlow(); },
    startBoss: () => startBoss(),
    startBonus: () => { isBonusRound = true; startBonusRound(); },
    powerup: (kind) => grantPowerup(W / 2, 300, kind),
    addAmmo: (n) => { ammo += n || 3; ammoCap = Math.max(ammoCap, ammo); updateHud(); },
    win: () => { roundHits = roundQuota; roundReleased = dronesPerRound; targets = []; endWave(); },
    get phase() { return phase; },
    get round() { return round; },
    get score() { return score; },
    get ammo() { return ammo; },
    get combo() { return combo; },
    get quota() { return roundQuota; },
    get hits() { return roundHits; },
    get released() { return roundReleased; },
    get strikes() { return strikes; },
    get slowmo() { return slowmoMs; },
    get bonusRound() { return isBonusRound; },
    get targets() { return targets.map((t) => ({ kind: t.kind, x: Math.round(t.x), y: Math.round(t.y), status: t.status, inWave: t.inWave })); },
    get boss() { return boss ? { x: Math.round(boss.x), y: Math.round(boss.y), hp: boss.hp, maxHp: boss.maxHp } : null; },
    get dog() { return { active: dog.active, mode: dog.mode, count: dog.count, perfect: dog.perfect }; },
  };
})();
