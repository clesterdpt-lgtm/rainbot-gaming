/* ============================================================
   CRESCENDO — a requiem in four movements
   Beat-synced vertical-scrolling shmup (Raiden with rhythm).
   The soundtrack is generated live in WebAudio; enemies attack
   on the beat; tapping ON the beat crescendos your weapon up
   the power ladder — going quiet (or getting hit) decays it.
   ============================================================ */
(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;   // 500
  const H = canvas.height;  // 640

  const STEP = 1 / 60;
  const GAME_ID = "crescendo";

  // Brand palette
  const PINK = "#ff2e88";
  const CYAN = "#2ee0ff";
  const YELLOW = "#ffd43b";
  const GREEN = "#6bff7d";
  const RED = "#ff5c5c";
  const PURPLE = "#b46bff";
  const ORANGE = "#ff9f43";
  const WHITE = "#f4f7ff";

  const TAU = Math.PI * 2;
  const UP = -Math.PI / 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  const hash01 = (n) => { let x = Math.imul(n | 0, 2654435761); x ^= x >>> 13; x = Math.imul(x, 1274126177); return ((x >>> 0) % 100000) / 100000; };

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /* ============================================================
     MOVEMENTS — the four acts of the requiem
     ============================================================ */
  const MOVEMENTS = [
    {
      roman: "I", name: "MOVEMENT I — ADAGIO", sub: "The Silent District",
      story: "The Conductor raised his baton, and the city forgot how to sing.",
      bpm: 112, trans: 0, dur: 55, intensity: 2,
      patterns: [["swoopLine", 5], ["vForm", 3], ["dronePair", 3]],
      boss: "timpanist",
    },
    {
      roman: "II", name: "MOVEMENT II — ANDANTE", sub: "The Frozen Concert Hall",
      story: "The orchestra still sits in the dark. Hollow. Waiting for permission to breathe.",
      bpm: 122, trans: 3, dur: 65, intensity: 3,
      patterns: [["swoopLine", 4], ["vForm", 3], ["dronePair", 3], ["turretPair", 3], ["splitter", 2]],
      boss: "firstchair",
    },
    {
      roman: "III", name: "MOVEMENT III — ALLEGRO", sub: "The Metronome Works",
      story: "Beneath the city, a great machine keeps perfect, merciless time.",
      bpm: 132, trans: 5, dur: 75, intensity: 4,
      patterns: [["swoopLine", 3], ["vForm", 2], ["dronePair", 3], ["turretPair", 3], ["splitter", 2], ["tank", 3], ["diverPair", 3]],
      boss: "metronome",
    },
    {
      roman: "IV", name: "MOVEMENT IV — PRESTO", sub: "The Conductor's Podium",
      story: "He is waiting. He has always been waiting. Finish the requiem.",
      bpm: 142, trans: 7, dur: 40, intensity: 5,
      patterns: [["swoopLine", 3], ["vForm", 3], ["dronePair", 3], ["turretPair", 3], ["splitter", 2], ["tank", 3], ["diverPair", 4]],
      boss: "conductor",
    },
  ];

  /* ============================================================
     WEAPON LADDER — groove level 0..8 (Raiden-style power-ups,
     earned and kept by tapping on the beat)
     ============================================================ */
  const WEAPONS = [
    { name: "TACET",            cd: 0.30, angs: [0],                                    xoffs: [0],                      dmg: 5, homing: 0, pierce: false },
    { name: "SOLO",             cd: 0.22, angs: [0],                                    xoffs: [0],                      dmg: 6, homing: 0, pierce: false },
    { name: "DUET",             cd: 0.22, angs: [0, 0],                                 xoffs: [-8, 8],                  dmg: 6, homing: 0, pierce: false },
    { name: "TRIO",             cd: 0.21, angs: [0, -0.13, 0.13],                       xoffs: [0, -6, 6],               dmg: 6, homing: 0, pierce: false },
    { name: "QUARTET",          cd: 0.20, angs: [0, 0, -0.22, 0.22],                    xoffs: [-9, 9, -12, 12],         dmg: 6, homing: 0, pierce: false },
    { name: "QUINTET",          cd: 0.18, angs: [0, -0.14, 0.14, -0.3, 0.3],            xoffs: [0, -7, 7, -12, 12],      dmg: 6, homing: 0, pierce: false },
    { name: "SEXTET",           cd: 0.18, angs: [0, -0.14, 0.14, -0.3, 0.3],            xoffs: [0, -7, 7, -12, 12],      dmg: 6, homing: 1, pierce: false },
    { name: "SEPTET",           cd: 0.16, angs: [0, -0.12, 0.12, -0.26, 0.26, -0.42, 0.42], xoffs: [0, -7, 7, -11, 11, -14, 14], dmg: 6, homing: 1, pierce: false },
    { name: "TUTTI FORTISSIMO", cd: 0.14, angs: [0, -0.12, 0.12, -0.26, 0.26, -0.42, 0.42], xoffs: [0, -7, 7, -11, 11, -14, 14], dmg: 6, homing: 2, pierce: true },
  ];
  const GROOVE_MAX = 8;
  const GROOVE_DECAY = 3.4;   // seconds per level lost when you go quiet
  const TAP_WINDOW = 0.15;    // beat-phase window for an on-beat tap
  const STREAK_FOR_BOMB = 8;

  /* ============================================================
     AUDIO — synthesized soundtrack + SFX (no assets)
     ============================================================ */
  const Audio = (() => {
    let ac = null, master = null, musGain = null, sfxGain = null;
    let delayNode = null, delaySend = null;
    let noiseBuf = null;
    let lastShootSfx = 0;

    function ensure() {
      if (ac) return true;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try { ac = new AC(); } catch (e) { ac = null; return false; }
      master = ac.createGain(); master.gain.value = 0.8; master.connect(ac.destination);
      musGain = ac.createGain(); musGain.gain.value = 0.5; musGain.connect(master);
      sfxGain = ac.createGain(); sfxGain.gain.value = 0.5; sfxGain.connect(master);
      delayNode = ac.createDelay(1.0); delayNode.delayTime.value = 0.29;
      const fb = ac.createGain(); fb.gain.value = 0.34;
      delayNode.connect(fb); fb.connect(delayNode);
      delaySend = ac.createGain(); delaySend.gain.value = 1;
      delaySend.connect(delayNode);
      const wet = ac.createGain(); wet.gain.value = 0.28;
      delayNode.connect(wet); wet.connect(musGain);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return true;
    }
    function resume() { if (ac && ac.state === "suspended") ac.resume(); }
    function ok() { return !!ac && !G.muted; }
    function now() { return ac ? ac.currentTime : 0; }
    const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

    function env(g, t, a, peak, dur) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    function osc(type, freq, t, dur, peak, dest, a = 0.004) {
      const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
      const g = ac.createGain(); env(g, t, a, peak, dur);
      o.connect(g); g.connect(dest || musGain);
      o.start(t); o.stop(t + dur + 0.05);
      return o;
    }
    function noise(t, dur, peak, filterType, freq, q, dest) {
      const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const f = ac.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q || 1;
      const g = ac.createGain(); env(g, t, 0.002, peak, dur);
      src.connect(f); f.connect(g); g.connect(dest || musGain);
      src.start(t); src.stop(t + dur + 0.05);
    }

    // --- drums ---
    function kick(t) {
      const o = ac.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(155, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
      const g = ac.createGain(); env(g, t, 0.002, 0.9, 0.16);
      o.connect(g); g.connect(musGain); o.start(t); o.stop(t + 0.22);
    }
    function snare(t) {
      noise(t, 0.13, 0.34, "bandpass", 1900, 0.9);
      osc("triangle", 185, t, 0.08, 0.25, musGain);
    }
    function hat(t, open) {
      noise(t, open ? 0.16 : 0.035, open ? 0.16 : 0.13, "highpass", 7500, 0.7);
    }
    // --- tonal ---
    function bass(t, m, dur) {
      const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = midi(m);
      const f = ac.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 6;
      f.frequency.setValueAtTime(700, t);
      f.frequency.exponentialRampToValueAtTime(180, t + dur);
      const g = ac.createGain(); env(g, t, 0.006, 0.34, dur);
      o.connect(f); f.connect(g); g.connect(musGain);
      o.start(t); o.stop(t + dur + 0.05);
    }
    function arp(t, m, dur, bright) {
      const o = ac.createOscillator(); o.type = "square"; o.frequency.value = midi(m);
      const f = ac.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 3;
      f.frequency.value = 900 + bright * 900;
      const g = ac.createGain(); env(g, t, 0.004, 0.11, dur);
      o.connect(f); f.connect(g); g.connect(musGain);
      o.start(t); o.stop(t + dur + 0.05);
    }
    function pad(t, midis, dur) {
      for (const m of midis) {
        for (const det of [-6, 6]) {
          const o = ac.createOscillator(); o.type = "sawtooth";
          o.frequency.value = midi(m); o.detune.value = det;
          const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 750;
          const g = ac.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.05, t + dur * 0.3);
          g.gain.linearRampToValueAtTime(0.0001, t + dur);
          o.connect(f); f.connect(g); g.connect(musGain);
          o.start(t); o.stop(t + dur + 0.05);
        }
      }
    }
    function lead(t, m, dur) {
      const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = midi(m);
      const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 2600; f.Q.value = 2;
      const g = ac.createGain(); env(g, t, 0.01, 0.16, dur);
      o.connect(f); f.connect(g); g.connect(musGain); g.connect(delaySend);
      o.start(t); o.stop(t + dur + 0.1);
    }

    // --- SFX (through sfxGain) ---
    const sfx = {
      shoot() {
        if (!ok()) return;
        const t = now();
        if (t - lastShootSfx < 0.05) return;
        lastShootSfx = t;
        const o = ac.createOscillator(); o.type = "triangle";
        o.frequency.setValueAtTime(920, t);
        o.frequency.exponentialRampToValueAtTime(590, t + 0.05);
        const g = ac.createGain(); env(g, t, 0.002, 0.05, 0.055);
        o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.09);
      },
      hit() { if (!ok()) return; noise(now(), 0.04, 0.09, "highpass", 2400, 1, sfxGain); },
      boom(big) {
        if (!ok()) return; const t = now();
        noise(t, big ? 0.5 : 0.22, big ? 0.5 : 0.3, "lowpass", big ? 900 : 1400, 0.8, sfxGain);
        const o = ac.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(big ? 260 : 200, t);
        o.frequency.exponentialRampToValueAtTime(40, t + (big ? 0.4 : 0.2));
        const g = ac.createGain(); env(g, t, 0.004, big ? 0.5 : 0.32, big ? 0.45 : 0.24);
        o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.6);
      },
      tapGood(level) {
        if (!ok()) return; const t = now();
        // pitch climbs with the groove level — the crescendo you can hear
        const base = 880 * Math.pow(2, Math.min(level, GROOVE_MAX) / 12);
        osc("sine", base, t, 0.22, 0.18, sfxGain, 0.004);
        osc("sine", base * 1.5, t + 0.03, 0.2, 0.1, sfxGain, 0.004);
      },
      tapBad() {
        if (!ok()) return; const t = now();
        const o = ac.createOscillator(); o.type = "square";
        o.frequency.setValueAtTime(196, t);
        o.frequency.linearRampToValueAtTime(158, t + 0.14);
        const g = ac.createGain(); env(g, t, 0.004, 0.14, 0.16);
        o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.2);
      },
      bomb() {
        if (!ok()) return; const t = now();
        sfx.boom(true);
        noise(t, 0.9, 0.35, "lowpass", 500, 0.8, sfxGain);
        [0, 7, 12].forEach((s, i) => osc("sawtooth", midi(45 + s), t + i * 0.05, 0.8, 0.16, sfxGain, 0.02));
      },
      pickup(streak) {
        if (!ok()) return; const t = now();
        const f0 = 620 * Math.pow(2, Math.min(streak || 0, 12) / 14);
        const o = ac.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f0 * 1.5, t + 0.06);
        const g = ac.createGain(); env(g, t, 0.003, 0.09, 0.08);
        o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.12);
      },
      hurt() {
        if (!ok()) return; const t = now();
        const o = ac.createOscillator(); o.type = "square";
        o.frequency.setValueAtTime(140, t);
        o.frequency.exponentialRampToValueAtTime(55, t + 0.25);
        const g = ac.createGain(); env(g, t, 0.004, 0.3, 0.3);
        o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.36);
        noise(t, 0.2, 0.2, "lowpass", 1200, 1, sfxGain);
      },
      fanfare() {
        if (!ok()) return; const t = now();
        [0, 4, 7, 12].forEach((s, i) => osc("triangle", midi(81 + s), t + i * 0.07, 0.22, 0.14, sfxGain, 0.005));
      },
      bossDown() {
        if (!ok()) return; const t = now();
        sfx.boom(true);
        [0, 7, 12, 19].forEach((s, i) => osc("sawtooth", midi(69 + s), t + 0.15 + i * 0.09, 0.5, 0.1, sfxGain, 0.01));
      },
    };

    /* --- sequencer ---------------------------------------------
       The sim owns the musical clock (G.songStep, in 16th notes).
       Every render frame we schedule any 16ths inside a small
       lookahead window, mapping sim-time offsets onto the audio
       clock. Deterministic gameplay stays intact when muted.  */
    const PROG = [{ r: 0, m: 1 }, { r: -4, m: 0 }, { r: 3, m: 0 }, { r: -2, m: 0 }];      // Am F C G
    const PROG_BOSS = [{ r: 0, m: 1 }, { r: 0, m: 1 }, { r: -4, m: 0 }, { r: -5, m: 0 }]; // Am Am F E
    const MELODY = {
      0: [12, 3], 4: [10, 1], 6: [8, 2], 8: [7, 3], 12: [3, 2],
      16: [5, 2], 20: [7, 1], 22: [8, 2], 24: [7, 3], 28: [3, 1], 30: [0, 2],
      32: [0, 2], 36: [3, 1], 38: [5, 2], 40: [7, 2], 44: [8, 1], 46: [10, 2],
      48: [12, 4], 54: [10, 1], 56: [8, 2], 60: [7, 4],
    };

    function playSixteenth(step, t, stepDur) {
      const I = G.intensity;
      const trans = MOVEMENTS[G.movement - 1].trans;
      const prog = G.bossActive ? PROG_BOSS : PROG;
      const bar = Math.floor(step / 16);
      const s = step % 16;
      const chord = prog[bar % 4];
      const third = chord.m ? 3 : 4;

      if (I >= 1 && s % 4 === 0) kick(t);
      if (I >= 2 && (s === 4 || s === 12)) snare(t);
      if (I >= 2 && s % 2 === 1) hat(t, false);
      if (I >= 4 && s % 2 === 0 && s % 4 !== 0) hat(t, false);
      if (I >= 3 && s === 14) hat(t, true);
      if (I >= 1 && s % 2 === 0) bass(t, 45 + trans + chord.r + (s === 14 ? 12 : 0), stepDur * 1.7);
      if (I >= 2 && s === 0) pad(t, [57 + trans + chord.r, 57 + trans + chord.r + third, 57 + trans + chord.r + 7], stepDur * 16);
      if (I >= 3) {
        const tones = [0, 7, 12, third + 12];
        arp(t, 69 + trans + chord.r + tones[step % 4], stepDur * 0.92, (I - 2) / 3);
      }
      if (I >= 4 && Math.floor(step / 64) % 2 === 1) {
        const note = MELODY[step % 64];
        if (note) lead(t, 81 + trans + note[0], stepDur * note[1] * 0.95);
      }
    }

    function schedule() {
      const musical = G.phase === "play" || G.phase === "interlude";
      if (!musical || !ac || G.muted) { G.schedStep = Math.ceil(G.songStep); return; }
      if (ac.state === "suspended") { ac.resume(); return; }
      const stepDur = (60 / MOVEMENTS[G.movement - 1].bpm) / 4;
      const horizon = G.songStep + 0.16 / stepDur;
      let guard = 0;
      while (G.schedStep < horizon && guard++ < 32) {
        const t = ac.currentTime + Math.max(0.001, (G.schedStep - G.songStep) * stepDur);
        playSixteenth(G.schedStep, t, stepDur);
        G.schedStep++;
      }
    }

    function setMuted(m) {
      if (master) master.gain.value = m ? 0 : 0.8;
    }

    return { ensure, resume, schedule, sfx, setMuted };
  })();

  /* ============================================================
     ENEMY TYPES (vertical-scroller roster)
     ============================================================ */
  const ETYPES = {
    swooper:  { hp: 7,   r: 12, col: YELLOW, score: 10 },
    drone:    { hp: 16,  r: 15, col: PINK,   score: 16 },
    turret:   { hp: 22,  r: 14, col: PURPLE, score: 20 },
    tank:     { hp: 46,  r: 19, col: ORANGE, score: 34 },
    diver:    { hp: 10,  r: 13, col: RED,    score: 18 },
    splitter: { hp: 20,  r: 16, col: GREEN,  score: 16 },
    mini:     { hp: 5,   r: 8,  col: GREEN,  score: 6 },
  };
  const BOSSES = {
    timpanist:  { name: "THE TIMPANIST",   hp: 700,  r: 34, col: PINK,   score: 400 },
    firstchair: { name: "THE FIRST CHAIR", hp: 1100, r: 30, col: PURPLE, score: 650 },
    metronome:  { name: "THE METRONOME",   hp: 1600, r: 36, col: ORANGE, score: 1000 },
    conductor:  { name: "THE CONDUCTOR",   hp: 3200, r: 40, col: WHITE,  score: 2500 },
  };

  /* ============================================================
     GAME STATE
     ============================================================ */
  let G = null;

  function newPlayer() {
    return {
      x: W / 2, y: H - 90,
      hp: 4, maxHp: 4,
      r: 7,               // small shmup hitbox; the ship is drawn larger
      speed: 265,
      fireCd: 0,
      groove: 1, decayT: GROOVE_DECAY,
      streak: 0, bombs: 1, maxBombs: 2,
      tapCd: 0,
      invulnT: 0,
      trail: [],
    };
  }

  function newGame() {
    return {
      phase: "title", // title | interlude | play | paused | gameover | win
      time: 0, runTime: 0,
      movement: 1, intensity: 2,
      waveT: 0, spawnCd: 1.6, queue: [],
      songStep: 0, schedStep: 0, beatIndex: -1, beatPhase: 0, pulse: 0,
      scrollY: 0,
      bossActive: false,
      p: newPlayer(),
      enemies: [], bullets: [], shots: [], gems: [], particles: [],
      shocks: [], texts: [], beams: [],
      eid: 1,
      score: 0, best: 0, combo: 0, bestCombo: 0, taps: 0, tapsHit: 0, bestStreak: 0, kills: 0,
      shake: 0, flashW: 0, flashR: 0,
      ilT: 0,
      usedEncore: false, muted: false, pausedFrom: null,
      won: false,
    };
  }

  /* ============================================================
     THE RHYTHM MECHANIC — tap on the beat to crescendo
     ============================================================ */
  function beatDur() { return 60 / MOVEMENTS[G.movement - 1].bpm; }

  function tapBeat() {
    if (G.phase !== "play") return;
    const p = G.p;
    if (p.tapCd > 0) return;
    p.tapCd = 0.18;
    G.taps++;
    const ph = G.beatPhase;
    const onBeat = ph < TAP_WINDOW || ph > 1 - TAP_WINDOW;
    if (onBeat) {
      G.tapsHit++;
      p.streak++;
      G.bestStreak = Math.max(G.bestStreak, p.streak);
      p.decayT = GROOVE_DECAY;
      const before = p.groove;
      p.groove = Math.min(GROOVE_MAX, p.groove + 1);
      G.score += Math.round(5 * multiplier());
      Audio.sfx.tapGood(p.groove);
      G.pulse = 1;
      G.shocks.push({ x: p.x, y: p.y, r: 8, maxR: 54, life: 0.25 });
      if (p.groove !== before) {
        addText(p.x, p.y - 34, "♪ " + WEAPONS[p.groove].name, CYAN, 1.1, 14);
        spark(p.x, p.y, CYAN, 8, 150);
      } else {
        addText(p.x, p.y - 30, "ON BEAT", CYAN, 0.6, 11);
      }
      if (p.streak > 0 && p.streak % STREAK_FOR_BOMB === 0 && p.bombs < p.maxBombs) {
        p.bombs++;
        addText(p.x, p.y - 52, "𝄐 FERMATA READY", YELLOW, 1.6, 15);
        Audio.sfx.fanfare();
      }
    } else {
      p.streak = 0;
      const before = p.groove;
      p.groove = Math.max(0, p.groove - 1);
      Audio.sfx.tapBad();
      addText(p.x, p.y - 30, "OFF BEAT", RED, 0.8, 12);
      if (p.groove !== before) addText(p.x, p.y - 46, WEAPONS[p.groove].name, "rgba(255,92,92,0.8)", 1, 12);
      G.flashR = Math.max(G.flashR, 0.14);
    }
  }

  function dropGroove(n) {
    const p = G.p;
    const before = p.groove;
    p.groove = Math.max(0, p.groove - n);
    p.streak = 0;
    p.decayT = GROOVE_DECAY;
    if (p.groove !== before) addText(p.x, p.y - 46, WEAPONS[p.groove].name, "rgba(255,92,92,0.85)", 1, 12);
  }

  function fireBomb() {
    if (G.phase !== "play") return;
    const p = G.p;
    if (p.bombs <= 0) return;
    p.bombs--;
    p.invulnT = Math.max(p.invulnT, 1.4);
    G.shocks.push({ x: p.x, y: p.y, r: 20, maxR: 700, life: 0.7 });
    clearBullets();
    G.beams.length = 0;
    for (const e of [...G.enemies]) damageEnemy(e, e.boss ? 90 : 999);
    G.flashW = 0.6;
    G.shake = 16;
    addText(W / 2, H / 2 - 40, "𝄐 FERMATA", YELLOW, 1.6, 26);
    Audio.sfx.bomb();
  }

  /* ============================================================
     SPAWNING & COMBAT
     ============================================================ */
  function hpScale() {
    return 1 + (G.movement - 1) * 0.45 + Math.min(G.waveT, 90) * 0.004;
  }

  function spawnEnemy(type, x, y, opts) {
    const d = ETYPES[type];
    const e = {
      id: G.eid++, type, x, y,
      hp: d.hp * hpScale(), maxHp: d.hp * hpScale(),
      r: d.r, col: d.col,
      seed: randi(0, 999), t: 0,
      baseX: x, phase: rand(0, TAU),
      state: null, tele: 0, aimA: 0,
      spin: rand(0, TAU), active: true, alt: 0,
      fade: 0, flash: 0,
      boss: false,
    };
    if (opts) Object.assign(e, opts);
    G.enemies.push(e);
    return e;
  }

  function spawnBoss(key) {
    const b = BOSSES[key];
    const e = spawnEnemy("drone", W / 2, -70);
    e.type = "boss"; e.btype = key; e.boss = true;
    e.name = b.name; e.col = b.col; e.r = b.r;
    e.hp = e.maxHp = b.hp * (1 + (G.movement - 1) * 0.1);
    e.bphase = 1; e.beatCount = 0; e.spinCd = 0;
    G.bossActive = true;
    addText(W / 2, H / 2 - 60, b.name, b.col === WHITE ? PINK : b.col, 2.2, 22);
    return e;
  }

  /* --- formation patterns (queued spawns) --- */
  const PATTERNS = {
    swoopLine() {
      const x = rand(70, W - 70), amp = rand(40, 70) * (Math.random() < 0.5 ? 1 : -1);
      for (let i = 0; i < 5; i++) {
        queueSpawn(i * 0.28, "swooper", x, -24, { baseX: x, amp, phase: 0 });
      }
    },
    vForm() {
      const cx = rand(110, W - 110);
      for (let i = 0; i < 5; i++) {
        const k = i - 2;
        queueSpawn(Math.abs(k) * 0.16, "swooper", cx + k * 44, -24 - Math.abs(k) * 20, { baseX: cx + k * 44, amp: 24, phase: k });
      }
    },
    dronePair() {
      const n = G.movement >= 3 ? 3 : 2;
      for (let i = 0; i < n; i++) queueSpawn(i * 0.5, "drone", rand(50, W - 50), -26);
    },
    turretPair() {
      queueSpawn(0, "turret", rand(30, 90), -20);
      queueSpawn(0.2, "turret", rand(W - 90, W - 30), -20);
    },
    tank() {
      queueSpawn(0, "tank", rand(90, W - 90), -30);
    },
    diverPair() {
      queueSpawn(0, "diver", rand(40, W - 40), -22);
      queueSpawn(0.6, "diver", rand(40, W - 40), -22);
    },
    splitter() {
      queueSpawn(0, "splitter", rand(60, W - 60), -24);
    },
  };

  function queueSpawn(delay, type, x, y, opts) {
    G.queue.push({ t: G.time + delay, type, x, y, opts });
  }

  function pickPattern() {
    const list = MOVEMENTS[G.movement - 1].patterns;
    let total = 0;
    for (const [, w] of list) total += w;
    let roll = Math.random() * total;
    for (const [name, w] of list) { roll -= w; if (roll <= 0) return name; }
    return list[0][0];
  }

  function fireBullet(x, y, a, spd, col, r = 4.5) {
    if (G.bullets.length > 400) return;
    G.bullets.push({ x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r, col, life: 9 });
  }
  function radial(e, n, spd, offset = 0) {
    for (let i = 0; i < n; i++) fireBullet(e.x, e.y, offset + (i / n) * TAU, spd, e.col);
  }
  function aimedFan(e, n, spd, spread) {
    const base = Math.atan2(G.p.y - e.y, G.p.x - e.x);
    for (let i = 0; i < n; i++) {
      const a = base + (n === 1 ? 0 : (i / (n - 1) - 0.5) * spread);
      fireBullet(e.x, e.y, a, spd, e.col);
    }
  }

  function damageEnemy(e, dmg) {
    if (e.dead) return;
    e.hp -= dmg;
    e.flash = 0.09;
    if (e.hp <= 0) { e.dead = true; killEnemy(e); }
  }

  function multiplier() { return 1 + Math.min(G.combo, 80) / 20; }

  function killEnemy(e) {
    const idx = G.enemies.indexOf(e);
    if (idx >= 0) G.enemies.splice(idx, 1);
    G.kills++;
    G.combo++;
    G.bestCombo = Math.max(G.bestCombo, G.combo);
    const base = e.boss ? BOSSES[e.btype].score : ETYPES[e.type].score;
    const gain = Math.round(base * multiplier());
    G.score += gain;
    burst(e.x, e.y, e.col, e.boss ? 46 : 12, e.boss ? 240 : 150);
    Audio.sfx.boom(e.boss);
    G.shake = Math.max(G.shake, e.boss ? 14 : 2.5);
    // note pickups (score) + rare hearts
    const drops = e.boss ? 8 : e.type === "tank" || e.type === "drone" ? 2 : Math.random() < 0.45 ? 1 : 0;
    for (let i = 0; i < drops; i++) {
      G.gems.push({ x: e.x + rand(-12, 12), y: e.y + rand(-8, 8), vx: rand(-30, 30), vy: rand(20, 60), t: 0, heart: false });
    }
    if (!e.boss && Math.random() < 0.03) {
      G.gems.push({ x: e.x, y: e.y, vx: 0, vy: 45, t: 0, heart: true });
    }
    if (e.type === "splitter") {
      for (const dir of [-1, 1]) {
        spawnEnemy("mini", e.x + dir * 12, e.y, { curve: dir });
      }
    }
    if (e.boss) bossDown(e);
    else addText(e.x, e.y - 12, "+" + gain, e.col, 0.7, 12);
  }

  function bossDown(e) {
    Audio.sfx.bossDown();
    clearBullets();
    G.beams.length = 0;
    G.flashW = 0.7;
    G.shake = 18;
    G.bossActive = false;
    addText(W / 2, H / 2 - 40, e.name + " SILENCED", YELLOW, 2.4, 20);
    if (e.btype === "conductor") { winGame(); return; }
    G.movement++;
    const mv = MOVEMENTS[G.movement - 1];
    G.intensity = mv.intensity;
    G.waveT = 0; G.spawnCd = 2.5;
    G.queue.length = 0;
    G.p.hp = Math.min(G.p.maxHp, G.p.hp + 1);
    G.enemies.length = 0;
    startInterlude();
  }

  function clearBullets(cx, cy, rad) {
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      if (rad === undefined || dist2(b.x, b.y, cx, cy) < rad * rad) {
        spark(b.x, b.y, b.col, 2);
        G.bullets.splice(i, 1);
      }
    }
  }

  function playerHit() {
    const p = G.p;
    if (p.invulnT > 0) return;
    p.hp--;
    p.invulnT = 1.5;
    G.combo = 0;
    dropGroove(2);
    G.shake = Math.max(G.shake, 9);
    G.flashR = 0.5;
    Audio.sfx.hurt();
    clearBullets(p.x, p.y, 100);
    burst(p.x, p.y, RED, 16, 190);
    if (p.hp <= 0) die();
  }

  function die() {
    G.phase = "gameover";
    recordScore();
    const acc = G.taps ? Math.round((G.tapsHit / G.taps) * 100) : 0;
    const pro = window.RB && RB.isAdFree && RB.isAdFree();
    showOverlay(
      "THE SILENCE TAKES YOU",
      `The requiem stops in ${MOVEMENTS[G.movement - 1].name.toLowerCase()}. ` +
      `${G.kills} muted freed · ${acc}% beat accuracy · best streak ${G.bestStreak}.`,
      `SCORE ${G.score.toLocaleString()} — BEST ${G.best.toLocaleString()}`,
      "Play again",
      !G.usedEncore ? (pro ? "⭐ Encore (Pro — free)" : "🎬 Encore — watch an ad, keep playing") : null
    );
  }

  function winGame() {
    G.phase = "win";
    G.won = true;
    G.score += 1500 + Math.max(0, Math.round((600 - G.runTime) * 5));
    recordScore();
    const acc = G.taps ? Math.round((G.tapsHit / G.taps) * 100) : 0;
    showOverlay(
      "FINALE — THE WORLD SINGS AGAIN",
      `The baton falls. Four movements, ${G.kills} muted freed, ${acc}% beat accuracy, ` +
      `${fmtTime(G.runTime)} on the podium. Somewhere above the district, a window opens, and someone hums.`,
      `SCORE ${G.score.toLocaleString()} — BEST ${G.best.toLocaleString()}`,
      "Play the requiem again",
      null
    );
  }

  function recordScore() {
    G.best = Math.max(G.best, G.score);
    if (window.RB && RB.recordScore) RB.recordScore(GAME_ID, G.score);
  }

  /* ============================================================
     BEAT EVENTS — enemies attack on the beat
     ============================================================ */
  function onBeat(bi) {
    G.pulse = 1;
    const mv = G.movement;
    for (const e of G.enemies) {
      if (e.boss) { bossBeat(e, bi); continue; }
      if (e.y < 0 || e.y > H || e.x < -10 || e.x > W + 10) continue;
      const k = (bi + e.seed) % 4;
      switch (e.type) {
        case "swooper":
          if ((bi + e.seed) % 8 === 0) aimedFan(e, 1, 165 + mv * 8, 0);
          break;
        case "drone":
          if (k === 0) radial(e, mv >= 3 ? 9 : 7, 100 + mv * 8, e.spin);
          break;
        case "turret":
          if (k === 1) aimedFan(e, 2, 185 + mv * 10, 0.22);
          break;
        case "tank":
          if (k === 2) aimedFan(e, 5, 150 + mv * 8, 0.9);
          break;
        case "diver":
          if (e.state === null && (bi + e.seed) % 2 === 0 && e.y > 60) {
            e.state = "align"; e.tele = beatDur();
          }
          break;
      }
    }
  }

  function bossBeat(e, bi) {
    e.beatCount++;
    const bc = e.beatCount;
    switch (e.btype) {
      case "timpanist":
        if (bc % 2 === 0) { radial(e, 12, 120, e.alt ? TAU / 24 : 0); e.alt = !e.alt; }
        if (bc % 8 === 4) aimedFan(e, 3, 210, 0.5);
        break;
      case "firstchair":
        if (bc % 4 === 0) {
          e.fade = 0.6;
          e.tx = clamp(G.p.x + rand(-140, 140), 50, W - 50);
          e.ty = rand(70, 170);
        }
        if (bc % 4 === 2) aimedFan(e, 5, 235, 0.7);
        if (bc % 8 === 6) {
          spawnEnemy("swooper", e.x - 40, e.y, { baseX: e.x - 40, amp: 30, phase: 0 });
          spawnEnemy("swooper", e.x + 40, e.y, { baseX: e.x + 40, amp: 30, phase: 2 });
        }
        break;
      case "metronome":
        if (bc % 8 === 0) e.active = false;
        if (bc % 8 === 2) { e.active = true; radial(e, 16, 135); }
        if (bc % 4 === 1) aimedFan(e, 3, 195, 0.4);
        break;
      case "conductor":
        if (bc % 2 === 0) aimedFan(e, e.bphase >= 3 ? 5 : 3, 195 + e.bphase * 18, 0.42);
        if (e.bphase >= 2 && bc % 4 === 0) {
          G.beams.push({ x: clamp(G.p.x, 30, W - 30), tele: beatDur(), active: 0 });
          if (e.bphase >= 3) G.beams.push({ x: clamp(G.p.x + (G.p.x < W / 2 ? 120 : -120), 30, W - 30), tele: beatDur(), active: 0 });
        }
        if (e.bphase >= 3 && bc % 8 === 0) {
          spawnEnemy("drone", clamp(e.x - 70, 40, W - 40), e.y + 20);
          spawnEnemy("drone", clamp(e.x + 70, 40, W - 40), e.y + 20);
        }
        break;
    }
  }

  /* ============================================================
     SIMULATION STEP (fixed 60 Hz)
     ============================================================ */
  function scrollSpeed() { return 60 + MOVEMENTS[G.movement - 1].bpm * 0.5; }

  function simStep() {
    const musical = G.phase === "play" || G.phase === "interlude";
    if (musical) {
      const stepDur = beatDur() / 4;
      G.songStep += STEP / stepDur;
      G.beatPhase = (G.songStep / 4) % 1;
      const bi = Math.floor(G.songStep / 4);
      if (bi !== G.beatIndex) {
        G.beatIndex = bi;
        if (G.phase === "play") onBeat(bi);
        else G.pulse = 1;
      }
      G.scrollY += scrollSpeed() * STEP;
    }
    if (G.phase !== "paused" && G.phase !== "title") {
      updateParticles();
    }
    if (G.phase === "interlude") {
      G.ilT -= STEP;
      if (G.ilT <= 0) G.phase = "play";
      return;
    }
    if (G.phase !== "play") return;

    G.time += STEP;
    G.runTime += STEP;
    updatePlayer();
    updateShots();
    updateEnemies();
    updateBullets();
    updateBeams();
    updateGems();
    updateSpawner();
    updateHUD();
  }

  function inputDir() {
    let dx = 0, dy = 0;
    if (keys.ArrowLeft || keys.KeyA) dx -= 1;
    if (keys.ArrowRight || keys.KeyD) dx += 1;
    if (keys.ArrowUp || keys.KeyW) dy -= 1;
    if (keys.ArrowDown || keys.KeyS) dy += 1;
    if (touch.active) { dx = touch.dx; dy = touch.dy; }
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    return [dx, dy];
  }

  function updatePlayer() {
    const p = G.p;
    const [dx, dy] = inputDir();
    p.x = clamp(p.x + dx * p.speed * STEP, 16, W - 16);
    p.y = clamp(p.y + dy * p.speed * STEP, 40, H - 24);
    if (p.invulnT > 0) p.invulnT -= STEP;
    if (p.tapCd > 0) p.tapCd -= STEP;

    // groove decays when you go quiet
    if (p.groove > 0) {
      p.decayT -= STEP;
      if (p.decayT <= 0) {
        p.decayT = GROOVE_DECAY;
        p.groove--;
        p.streak = 0;
        addText(p.x, p.y - 40, "diminuendo… " + WEAPONS[p.groove].name, "rgba(220,230,255,0.7)", 1, 11);
      }
    }

    // engine trail
    p.trail.push({ x: p.x, y: p.y + 12 });
    if (p.trail.length > 10) p.trail.shift();

    // auto-fire straight up (Raiden style)
    p.fireCd -= STEP;
    if (p.fireCd <= 0) {
      const wpn = WEAPONS[p.groove];
      p.fireCd = wpn.cd;
      for (let i = 0; i < wpn.angs.length; i++) {
        const a = UP + wpn.angs[i];
        G.shots.push({
          x: p.x + (wpn.xoffs[i] || 0), y: p.y - 10,
          vx: Math.cos(a) * 540, vy: Math.sin(a) * 540,
          dmg: wpn.dmg, r: 4, life: 1.6,
          pierce: wpn.pierce && i === 0, hit: {},
          missile: false,
        });
      }
      for (let m = 0; m < wpn.homing; m++) {
        G.shots.push({
          x: p.x + (m === 0 ? -16 : 16), y: p.y,
          vx: (m === 0 ? -60 : 60), vy: -320,
          dmg: 9, r: 5, life: 2.4,
          pierce: false, hit: {},
          missile: true,
        });
      }
      Audio.sfx.shoot();
    }
  }

  function updateShots() {
    for (let i = G.shots.length - 1; i >= 0; i--) {
      const s = G.shots[i];
      s.life -= STEP;
      if (s.life <= 0) { G.shots.splice(i, 1); continue; }
      if (s.missile) {
        let tgt = null, td = 1e9;
        for (const e of G.enemies) {
          if (s.hit[e.id] || e.fade > 0 || e.y < -20) continue;
          const d = dist2(s.x, s.y, e.x, e.y);
          if (d < td) { td = d; tgt = e; }
        }
        if (tgt) {
          const want = Math.atan2(tgt.y - s.y, tgt.x - s.x);
          const cur = Math.atan2(s.vy, s.vx);
          let diff = want - cur;
          while (diff > Math.PI) diff -= TAU;
          while (diff < -Math.PI) diff += TAU;
          const turn = clamp(diff, -7 * STEP, 7 * STEP);
          const spd = Math.min(460, Math.hypot(s.vx, s.vy) + 640 * STEP);
          s.vx = Math.cos(cur + turn) * spd;
          s.vy = Math.sin(cur + turn) * spd;
        }
      }
      s.px = s.x; s.py = s.y;
      s.x += s.vx * STEP;
      s.y += s.vy * STEP;
      if (s.x < -30 || s.x > W + 30 || s.y < -40 || s.y > H + 30) { G.shots.splice(i, 1); continue; }
      for (const e of G.enemies) {
        if (e.fade > 0 || s.hit[e.id] || e.y < -20) continue;
        if (dist2(s.x, s.y, e.x, e.y) < (e.r + s.r) * (e.r + s.r)) {
          s.hit[e.id] = true;
          damageEnemy(e, s.dmg);
          spark(s.x, s.y, CYAN, 3);
          Audio.sfx.hit();
          if (!s.pierce) G.shots.splice(i, 1);
          break;
        }
      }
    }
  }

  function updateEnemies() {
    const p = G.p;
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      e.t += STEP;
      if (e.flash > 0) e.flash -= STEP;

      if (e.boss) { updateBoss(e); }
      else {
        switch (e.type) {
          case "swooper":
            e.y += 115 * STEP;
            e.x = e.baseX + Math.sin(e.t * 2.6 + e.phase) * (e.amp || 50);
            break;
          case "drone":
            e.y += 42 * STEP;
            e.x += Math.sin(e.t * 1.4 + e.phase) * 22 * STEP;
            break;
          case "turret":
            e.y += scrollSpeed() * STEP; // rides the terrain
            e.aimA = Math.atan2(p.y - e.y, p.x - e.x);
            break;
          case "tank":
            e.y += 34 * STEP;
            e.aimA = Math.atan2(p.y - e.y, p.x - e.x);
            break;
          case "diver":
            if (e.state === "align") {
              e.tele -= STEP;
              e.x += clamp(p.x - e.x, -220 * STEP, 220 * STEP);
              e.y += 30 * STEP;
              if (e.tele <= 0) e.state = "dive";
            } else if (e.state === "dive") {
              e.y += 460 * STEP;
              e.x += clamp(p.x - e.x, -90 * STEP, 90 * STEP);
            } else {
              e.y += 90 * STEP;
            }
            break;
          case "splitter":
            e.y += 58 * STEP;
            e.x = e.baseX + Math.sin(e.t * 1.8 + e.phase) * 34;
            break;
          case "mini":
            e.y += 150 * STEP;
            e.x += (e.curve || 1) * 130 * STEP * Math.cos(e.t * 3);
            break;
        }
        // gone past the bottom → despawn
        if (e.y > H + 40 || e.x < -60 || e.x > W + 60) { G.enemies.splice(i, 1); continue; }
      }

      // contact damage
      if (!e.dead && e.fade <= 0 && dist2(e.x, e.y, p.x, p.y) < (e.r + p.r) * (e.r + p.r)) {
        playerHit();
      }
    }
  }

  function updateBoss(e) {
    // entrance
    if (e.y < 110 && !e.entered) {
      e.y += 90 * STEP;
      if (e.y >= 110) e.entered = true;
      return;
    }
    if (e.fade > 0) {
      e.fade -= STEP;
      if (e.fade <= 0.3 && e.tx !== undefined) { e.x = e.tx; e.y = e.ty; e.tx = undefined; }
      return;
    }
    switch (e.btype) {
      case "timpanist":
        e.x = W / 2 + Math.sin(e.t * 0.6) * 150;
        e.y = 110 + Math.sin(e.t * 1.1) * 22;
        break;
      case "firstchair":
        // drifts; repositioning happens via teleport on the beat
        e.x = clamp(e.x + Math.sin(e.t * 0.8) * 40 * STEP, 40, W - 40);
        break;
      case "metronome": {
        // pendulum sweep
        e.x = W / 2 + Math.sin(e.t * 1.15) * (W / 2 - 70);
        e.y = 120 + Math.abs(Math.cos(e.t * 1.15)) * 26;
        if (e.active) {
          e.spin += 2.8 * STEP;
          e.spinCd -= STEP;
          if (e.spinCd <= 0) {
            e.spinCd = 0.13;
            fireBullet(e.x, e.y, e.spin, 112, e.col);
            fireBullet(e.x, e.y, e.spin + Math.PI, 112, e.col);
          }
        }
        break;
      }
      case "conductor": {
        const frac = e.hp / e.maxHp;
        const newPhase = frac < 1 / 3 ? 3 : frac < 2 / 3 ? 2 : 1;
        if (newPhase !== e.bphase) {
          e.bphase = newPhase;
          clearBullets();
          G.beams.length = 0;
          G.flashW = 0.5;
          G.shake = 12;
          addText(e.x, e.y + 70, newPhase === 2 ? "THE BATON RISES" : "FORTISSIMO", PINK, 1.8, 17);
          if (window.RB && RB.toast) RB.toast(newPhase === 2 ? "The Conductor draws his baton." : "The final measure. Survive it.", "");
        }
        e.x = W / 2 + Math.sin(e.t * 0.5) * 140;
        e.y = 105 + Math.sin(e.t * 0.9) * 24;
        const arms = e.bphase === 2 ? 3 : 4;
        e.spin += (0.9 + e.bphase * 0.25) * STEP;
        e.spinCd -= STEP;
        if (e.spinCd <= 0) {
          e.spinCd = e.bphase === 2 ? 0.17 : 0.13;
          for (let i = 0; i < arms; i++) {
            fireBullet(e.x, e.y, e.spin + (i / arms) * TAU, 105 + e.bphase * 13, PINK);
          }
        }
        break;
      }
    }
  }

  function updateBullets() {
    const p = G.p;
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      if (!b) continue; // playerHit → clearBullets can shrink the array mid-loop
      b.life -= STEP;
      b.x += b.vx * STEP;
      b.y += b.vy * STEP;
      if (b.life <= 0 || b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) {
        G.bullets.splice(i, 1); continue;
      }
      if (dist2(b.x, b.y, p.x, p.y) < (b.r + p.r) * (b.r + p.r)) {
        G.bullets.splice(i, 1);
        playerHit();
      }
    }
  }

  function updateBeams() {
    const p = G.p;
    for (let i = G.beams.length - 1; i >= 0; i--) {
      const bm = G.beams[i];
      if (bm.tele > 0) {
        bm.tele -= STEP;
        if (bm.tele <= 0) { bm.active = 0.5; G.shake = Math.max(G.shake, 5); Audio.sfx.boom(false); }
        continue;
      }
      bm.active -= STEP;
      if (bm.active <= 0) { G.beams.splice(i, 1); continue; }
      if (Math.abs(p.x - bm.x) < 20 + p.r) playerHit();
    }
  }

  function updateGems() {
    const p = G.p;
    for (let i = G.gems.length - 1; i >= 0; i--) {
      const g = G.gems[i];
      g.t += STEP;
      const d = Math.hypot(p.x - g.x, p.y - g.y);
      if (d < 110) {
        const pull = (1 - d / 110) * 700 + 80;
        g.vx += ((p.x - g.x) / (d || 1)) * pull * STEP * 4;
        g.vy += ((p.y - g.y) / (d || 1)) * pull * STEP * 4;
        g.vx *= 0.9; g.vy *= 0.9;
      } else {
        g.vx *= 0.98;
        g.vy = Math.min(g.vy + 120 * STEP, 95);
      }
      g.x += g.vx * STEP; g.y += g.vy * STEP;
      if (d < 20) {
        G.gems.splice(i, 1);
        if (g.heart) {
          p.hp = Math.min(p.maxHp, p.hp + 1);
          addText(p.x, p.y - 24, "+1 ♥", GREEN, 0.9, 14);
          Audio.sfx.fanfare();
        } else {
          G.score += Math.round(4 * multiplier());
          Audio.sfx.pickup(G.combo);
        }
      } else if (g.y > H + 20) {
        G.gems.splice(i, 1);
      }
    }
  }

  function updateSpawner() {
    // flush queued formation spawns
    for (let i = G.queue.length - 1; i >= 0; i--) {
      const q = G.queue[i];
      if (G.time >= q.t) {
        spawnEnemy(q.type, q.x, q.y, q.opts);
        G.queue.splice(i, 1);
      }
    }
    if (G.bossActive) return;
    const mv = MOVEMENTS[G.movement - 1];
    G.waveT += STEP;
    if (G.waveT >= mv.dur) { spawnBoss(mv.boss); return; }
    G.spawnCd -= STEP;
    const cap = 10 + G.movement * 2;
    if (G.spawnCd <= 0 && G.enemies.length < cap) {
      PATTERNS[pickPattern()]();
      G.spawnCd = Math.max(1.0, 2.4 - G.waveT * 0.012 - (G.movement - 1) * 0.18);
    }
  }

  /* ============================================================
     PARTICLES / TEXT / COSMETICS
     ============================================================ */
  function burst(x, y, col, n, spd) {
    for (let i = 0; i < n; i++) {
      if (G.particles.length > 380) return;
      const a = rand(0, TAU), v = rand(spd * 0.3, spd);
      G.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.3, 0.8), max: 0.8, col, r: rand(1.5, 3.5) });
    }
  }
  function spark(x, y, col, n, spd = 90) {
    for (let i = 0; i < n; i++) {
      if (G.particles.length > 380) return;
      const a = rand(0, TAU), v = rand(20, spd);
      G.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.15, 0.4), max: 0.4, col, r: rand(1, 2.2) });
    }
  }
  function addText(x, y, txt, col, life, size) {
    G.texts.push({ x: clamp(x, 60, W - 60), y, txt, col, life, max: life, size });
  }
  function updateParticles() {
    for (let i = G.particles.length - 1; i >= 0; i--) {
      const q = G.particles[i];
      q.life -= STEP;
      if (q.life <= 0) { G.particles.splice(i, 1); continue; }
      q.x += q.vx * STEP; q.y += q.vy * STEP;
      q.vx *= 0.94; q.vy *= 0.94;
    }
    for (let i = G.texts.length - 1; i >= 0; i--) {
      const t = G.texts[i];
      t.life -= STEP;
      t.y -= 22 * STEP;
      if (t.life <= 0) G.texts.splice(i, 1);
    }
    for (let i = G.shocks.length - 1; i >= 0; i--) {
      const s = G.shocks[i];
      s.life -= STEP;
      s.r = lerp(s.r, s.maxR, 0.22);
      if (s.life <= 0) G.shocks.splice(i, 1);
    }
    if (G.pulse > 0) G.pulse = Math.max(0, G.pulse - 3.2 * STEP);
    if (G.shake > 0) G.shake = Math.max(0, G.shake - 34 * STEP);
    if (G.flashW > 0) G.flashW = Math.max(0, G.flashW - 2.4 * STEP);
    if (G.flashR > 0) G.flashR = Math.max(0, G.flashR - 1.6 * STEP);
  }

  /* ============================================================
     RENDERING
     ============================================================ */
  const glowCache = {};
  function glowSprite(col) {
    let c = glowCache[col];
    if (!c) {
      c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d");
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, "rgba(255,255,255,0.85)");
      grad.addColorStop(0.28, hexToRgba(col, 0.6));
      grad.addColorStop(1, hexToRgba(col, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      glowCache[col] = c;
    }
    return c;
  }
  function drawGlow(x, y, r, col, alpha) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(glowSprite(col), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }

  let noteSprite = null;
  function getNoteSprite() {
    if (!noteSprite) {
      noteSprite = document.createElement("canvas");
      noteSprite.width = noteSprite.height = 30;
      const g = noteSprite.getContext("2d");
      const grad = g.createRadialGradient(15, 15, 0, 15, 15, 15);
      grad.addColorStop(0, hexToRgba(YELLOW, 0.7));
      grad.addColorStop(1, hexToRgba(YELLOW, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, 30, 30);
      g.fillStyle = "#fff8dc";
      g.font = "700 15px 'JetBrains Mono', monospace";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("♪", 15, 16);
    }
    return noteSprite;
  }

  let vignette = null;
  function getVignette() {
    if (!vignette) {
      vignette = document.createElement("canvas");
      vignette.width = W; vignette.height = H;
      const g = vignette.getContext("2d");
      const grad = g.createRadialGradient(W / 2, H / 2, H * 0.38, W / 2, H / 2, H * 0.8);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(2,3,10,0.55)");
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    }
    return vignette;
  }

  const stars = [];
  for (let i = 0; i < 55; i++) {
    stars.push({ x: rand(0, W), y: rand(0, H), r: rand(0.5, 1.7), v: rand(14, 34) });
  }

  function roman(n) { return ["I", "II", "III", "IV"][n - 1] || "IV"; }
  function fmtTime(s) {
    const m = Math.floor(s / 60), ss = Math.floor(s % 60);
    return `${m}:${ss < 10 ? "0" : ""}${ss}`;
  }

  function drawBackground() {
    ctx.fillStyle = "#05060d";
    ctx.fillRect(0, 0, W, H);

    // far stars (slow parallax)
    const tw = 0.6 + 0.4 * G.pulse;
    ctx.fillStyle = `rgba(220,235,255,${0.3 * tw})`;
    for (const s of stars) {
      s.y += s.v * STEP;
      if (s.y > H) { s.y = -2; s.x = rand(0, W); }
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }

    // the scrolling score: staff groups every 170 world-px
    const SPACING = 170;
    const first = Math.floor((G.scrollY - H) / SPACING);
    for (let gi = first; gi * SPACING < G.scrollY + SPACING; gi++) {
      const sy = H - (G.scrollY - gi * SPACING); // screen y of the staff top
      if (sy < -60 || sy > H + 60) continue;
      ctx.strokeStyle = `rgba(46,224,255,${0.07 + G.pulse * 0.03})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let li = 0; li < 5; li++) {
        ctx.moveTo(0, sy + li * 9);
        ctx.lineTo(W, sy + li * 9);
      }
      ctx.stroke();
      // bar line + occasional faint glyph, deterministic per staff index
      const h1 = hash01(gi * 7 + 1);
      if (h1 > 0.4) {
        const gx = 40 + hash01(gi * 13 + 5) * (W - 80);
        ctx.fillStyle = `rgba(255,46,136,${0.1 + h1 * 0.08})`;
        ctx.font = "26px serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(["♩", "♪", "𝄞", "𝄢", "♫"][Math.floor(hash01(gi * 3 + 2) * 5)], gx, sy + 18);
      }
      ctx.strokeStyle = "rgba(46,224,255,0.08)";
      ctx.beginPath();
      const bx = hash01(gi * 17 + 9) * W;
      ctx.moveTo(bx, sy); ctx.lineTo(bx, sy + 36);
      ctx.stroke();
    }
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBackground();

    if (G.shake > 0.2) {
      ctx.translate(rand(-G.shake, G.shake) * 0.5, rand(-G.shake, G.shake) * 0.5);
    }

    ctx.globalCompositeOperation = "lighter";

    // note pickups
    const noteImg = getNoteSprite();
    for (const g of G.gems) {
      if (g.heart) {
        drawGlow(g.x, g.y, 16, GREEN, 0.8);
        ctx.fillStyle = GREEN;
        ctx.font = "700 13px 'JetBrains Mono', monospace";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("♥", g.x, g.y + 1);
      } else {
        const bob = Math.sin(g.t * 5) * 2;
        ctx.drawImage(noteImg, g.x - 15, g.y - 15 + bob);
      }
    }

    // shockwaves
    for (const s of G.shocks) {
      ctx.strokeStyle = hexToRgba(CYAN, Math.max(0, s.life / 0.4) * 0.9);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.stroke();
    }

    // player shots
    for (const s of G.shots) {
      if (s.missile) {
        ctx.strokeStyle = hexToRgba(YELLOW, 0.9);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(s.px !== undefined ? s.px : s.x, s.py !== undefined ? s.py : s.y);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
        drawGlow(s.x, s.y, 10, YELLOW, 0.8);
      } else {
        ctx.strokeStyle = hexToRgba(CYAN, s.pierce ? 1 : 0.8);
        ctx.lineWidth = s.pierce ? 5 : 3;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y + 12);
        ctx.lineTo(s.x, s.y - 4);
        ctx.stroke();
        drawGlow(s.x, s.y, s.pierce ? 12 : 8, CYAN, 0.7);
      }
    }

    ctx.globalCompositeOperation = "source-over";

    // enemies
    for (const e of G.enemies) drawEnemy(e);

    // diver telegraphs
    for (const e of G.enemies) {
      if (e.state === "align" && e.tele > 0) {
        ctx.strokeStyle = hexToRgba(RED, 0.2 + 0.3 * (1 - e.tele / beatDur()));
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x, H);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // conductor beams (vertical columns)
    for (const bm of G.beams) {
      if (bm.tele > 0) {
        ctx.strokeStyle = hexToRgba(PINK, 0.3 + 0.4 * (1 - bm.tele / beatDur()));
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 8]);
        ctx.beginPath(); ctx.moveTo(bm.x, 60); ctx.lineTo(bm.x, H); ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = hexToRgba(PINK, Math.min(1, bm.active * 3));
        ctx.lineWidth = 34;
        ctx.beginPath(); ctx.moveTo(bm.x, 60); ctx.lineTo(bm.x, H); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 8;
        ctx.beginPath(); ctx.moveTo(bm.x, 60); ctx.lineTo(bm.x, H); ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      }
    }

    // enemy bullets
    ctx.globalCompositeOperation = "lighter";
    for (const b of G.bullets) {
      drawGlow(b.x, b.y, b.r * 3.2, b.col, 0.75);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.55, 0, TAU);
      ctx.fill();
    }

    // player
    drawPlayer();

    // particles
    for (const q of G.particles) {
      drawGlow(q.x, q.y, q.r * 3.4, q.col, (q.life / q.max) * 0.85);
    }
    ctx.globalCompositeOperation = "source-over";

    // floating texts
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const t of G.texts) {
      ctx.globalAlpha = clamp(t.life / t.max * 1.6, 0, 1);
      ctx.font = `800 ${t.size}px 'JetBrains Mono', monospace`;
      ctx.fillStyle = t.col;
      ctx.fillText(t.txt, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    drawHUD();

    if (G.phase === "interlude") drawInterlude();
    if (G.phase === "paused") {
      ctx.fillStyle = "rgba(3,4,12,0.66)";
      ctx.fillRect(-20, -20, W + 40, H + 40);
      ctx.fillStyle = WHITE;
      ctx.font = "800 28px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", W / 2, H / 2 - 10);
      ctx.font = "600 13px 'JetBrains Mono', monospace";
      ctx.fillStyle = CYAN;
      ctx.fillText("press P to resume", W / 2, H / 2 + 22);
    }

    if (G.flashW > 0) {
      ctx.fillStyle = `rgba(235,245,255,${G.flashW * 0.5})`;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    if (G.flashR > 0) {
      ctx.fillStyle = `rgba(255,50,60,${G.flashR * 0.35})`;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(getVignette(), 0, 0);
  }

  function drawPlayer() {
    const p = G.p;
    if (G.phase === "gameover") return;
    const blink = p.invulnT > 0 && Math.floor(p.invulnT * 12) % 2 === 0;
    // engine trail
    for (let i = 0; i < p.trail.length; i++) {
      const t = p.trail[i];
      drawGlow(t.x, t.y + (p.trail.length - i) * 3, 4 + i * 0.6, CYAN, (i / p.trail.length) * 0.25);
    }
    if (blink) return;
    drawGlow(p.x, p.y, 26 + G.pulse * 7, CYAN, 0.8);
    ctx.save();
    ctx.translate(p.x, p.y);
    // ship: swept-wing fighter, drawn in bright white with cyan edges
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(4, -2);
    ctx.lineTo(15, 8);
    ctx.lineTo(5, 6);
    ctx.lineTo(3, 12);
    ctx.lineTo(-3, 12);
    ctx.lineTo(-5, 6);
    ctx.lineTo(-15, 8);
    ctx.lineTo(-4, -2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // cockpit
    ctx.fillStyle = CYAN;
    ctx.beginPath();
    ctx.arc(0, -2, 2.6, 0, TAU);
    ctx.fill();
    ctx.restore();
    // hitbox dot (shmup convention)
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, TAU);
    ctx.fill();
  }

  function drawEnemy(e) {
    const alpha = e.fade > 0 ? clamp(1 - e.fade, 0.15, 1) : 1;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    drawGlow(e.x, e.y, e.r * 2.1 + G.pulse * 5, e.col, 0.4 * alpha);
    ctx.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = e.flash > 0 ? "#ffffff" : e.col;
    ctx.fillStyle = "#0a0d18";

    if (e.boss) { drawBossBody(e); ctx.restore(); ctx.globalAlpha = 1; drawBossBar(e); return; }

    switch (e.type) {
      case "swooper": ctx.rotate(Math.PI); polygon(3, e.r, 0); break;
      case "drone": polygon(6, e.r, e.t * 0.7); break;
      case "turret":
        polygon(4, e.r, Math.PI / 4);
        ctx.strokeStyle = e.flash > 0 ? "#fff" : hexToRgba(e.col, 0.9);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(e.aimA || 0) * (e.r + 7), Math.sin(e.aimA || 0) * (e.r + 7));
        ctx.stroke();
        break;
      case "tank":
        roundRectPath(-e.r, -e.r * 0.7, e.r * 2, e.r * 1.4, 5);
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, e.r * 0.5, 0, TAU);
        ctx.fill(); ctx.stroke();
        break;
      case "diver": ctx.rotate(Math.PI); chevron(e.r); break;
      case "splitter": wobbleCircle(e.r, e.t); break;
      case "mini": wobbleCircle(e.r, e.t); break;
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    if (!e.boss && e.hp < e.maxHp && e.r >= 14) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(e.x - 15, e.y - e.r - 10, 30, 4);
      ctx.fillStyle = e.col;
      ctx.fillRect(e.x - 15, e.y - e.r - 10, 30 * clamp(e.hp / e.maxHp, 0, 1), 4);
    }
  }

  function polygon(n, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU - Math.PI / 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  function wobbleCircle(r, t) {
    ctx.beginPath();
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * TAU;
      const rr = r + Math.sin(a * 5 + t * 6) * 2;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  function gearShape(r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = rot + (i / 16) * TAU;
      const rr = i % 2 ? r : r * 0.68;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  function chevron(r) {
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.3);
    ctx.lineTo(r * 0.9, r * 0.7);
    ctx.lineTo(0, r * 0.2);
    ctx.lineTo(-r * 0.9, r * 0.7);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBossBody(e) {
    switch (e.btype) {
      case "timpanist":
        polygon(6, e.r, e.t * 0.5);
        polygon(6, e.r * 0.6, -e.t * 0.8);
        break;
      case "firstchair":
        ctx.rotate(Math.atan2(G.p.y - e.y, G.p.x - e.x) + Math.PI / 2);
        polygon(3, e.r, 0);
        polygon(3, e.r * 0.55, Math.PI);
        break;
      case "metronome":
        gearShape(e.r, e.spin);
        gearShape(e.r * 0.55, -e.spin * 1.6);
        break;
      case "conductor": {
        ctx.strokeStyle = e.flash > 0 ? "#ffffff" : PINK;
        polygon(5, e.r, e.t * 0.3);
        ctx.beginPath();
        ctx.arc(0, -e.r * 0.25, e.r * 0.35, 0, TAU);
        ctx.fillStyle = "#05060d";
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = PINK;
        ctx.beginPath(); ctx.arc(-6, -e.r * 0.3, 3, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(6, -e.r * 0.3, 3, 0, TAU); ctx.fill();
        ctx.strokeStyle = WHITE;
        ctx.lineWidth = 3;
        const ba = e.spin * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ba) * e.r * 1.7, Math.sin(ba) * e.r * 1.7);
        ctx.stroke();
        break;
      }
    }
  }

  function drawBossBar(e) {
    const bw = W - 120;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(W / 2 - bw / 2 - 2, 10, bw + 4, 14);
    ctx.fillStyle = e.col === WHITE ? PINK : e.col;
    ctx.fillRect(W / 2 - bw / 2, 12, bw * clamp(e.hp / e.maxHp, 0, 1), 10);
    ctx.fillStyle = WHITE;
    ctx.font = "800 10px 'JetBrains Mono', monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(e.name, W / 2, 33);
  }

  function drawHUD() {
    const p = G.p;
    if (G.phase === "title" || G.phase === "gameover" || G.phase === "win") return;

    // hearts + bombs, top-left
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.font = "800 16px 'JetBrains Mono', monospace";
    for (let i = 0; i < p.maxHp; i++) {
      ctx.fillStyle = i < p.hp ? PINK : "rgba(255,255,255,0.14)";
      ctx.fillText("♥", 12 + i * 18, 18);
    }
    for (let i = 0; i < p.maxBombs; i++) {
      ctx.fillStyle = i < p.bombs ? YELLOW : "rgba(255,255,255,0.14)";
      ctx.fillText("𝄐", 12 + i * 18, 40);
    }

    // combo, top-right (below boss bar zone)
    if (G.combo > 1) {
      ctx.textAlign = "right";
      ctx.font = "800 16px 'JetBrains Mono', monospace";
      ctx.fillStyle = YELLOW;
      ctx.fillText(`×${multiplier().toFixed(1)}`, W - 10, 56);
      ctx.font = "700 10px 'JetBrains Mono', monospace";
      ctx.fillStyle = "rgba(255,212,59,0.7)";
      ctx.fillText(`${G.combo} combo`, W - 10, 71);
    }

    // GROOVE METER — left edge, vertical pips + weapon name
    const gx = 14, gy0 = H - 60, ph = 16;
    for (let i = 0; i < GROOVE_MAX; i++) {
      const lit = i < p.groove;
      const y = gy0 - i * ph;
      ctx.fillStyle = lit ? (i >= 6 ? PINK : CYAN) : "rgba(255,255,255,0.1)";
      ctx.fillRect(gx, y, 10, ph - 4);
    }
    // decay preview: top lit pip drains
    if (p.groove > 0) {
      const y = gy0 - (p.groove - 1) * ph;
      const frac = clamp(p.decayT / GROOVE_DECAY, 0, 1);
      ctx.fillStyle = "rgba(5,6,13,0.7)";
      ctx.fillRect(gx, y, 10, (ph - 4) * (1 - frac));
    }
    ctx.save();
    ctx.translate(gx + 22, gy0 + 10);
    ctx.rotate(-Math.PI / 2);
    ctx.font = "800 11px 'JetBrains Mono', monospace";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillStyle = p.groove >= 6 ? PINK : CYAN;
    ctx.fillText(WEAPONS[p.groove].name, 0, 0);
    ctx.restore();

    // streak
    if (p.streak >= 2) {
      ctx.font = "700 10px 'JetBrains Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(46,224,255,0.75)";
      ctx.fillText(`streak ${p.streak}`, gx, gy0 + 26);
    }

    // METRONOME BAR — bottom center: ticks converge on the beat
    const mbW = 200, mbY = H - 16, cx = W / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - mbW / 2, mbY); ctx.lineTo(cx + mbW / 2, mbY);
    ctx.stroke();
    const off = (1 - G.beatPhase) * (mbW / 2);
    ctx.fillStyle = CYAN;
    ctx.fillRect(cx - off - 1.5, mbY - 7, 3, 14);
    ctx.fillRect(cx + off - 1.5, mbY - 7, 3, 14);
    const on = G.beatPhase < TAP_WINDOW || G.beatPhase > 1 - TAP_WINDOW;
    ctx.globalCompositeOperation = "lighter";
    drawGlow(cx, mbY, on ? 17 : 9, on ? CYAN : "#3a4a66", on ? 0.95 : 0.45);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = WHITE;
    ctx.save();
    ctx.translate(cx, mbY);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-3.5, -3.5, 7, 7);
    ctx.restore();
  }

  function drawInterlude() {
    const mv = MOVEMENTS[G.movement - 1];
    const a = clamp(Math.min(G.ilT, 3.4 - G.ilT) * 1.4, 0, 1);
    ctx.fillStyle = "rgba(3,4,12,0.6)";
    ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.globalAlpha = a;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = PINK;
    ctx.font = "800 24px 'JetBrains Mono', monospace";
    ctx.fillText(mv.name, W / 2, H / 2 - 44);
    ctx.fillStyle = CYAN;
    ctx.font = "700 15px 'JetBrains Mono', monospace";
    ctx.fillText(mv.sub, W / 2, H / 2 - 12);
    ctx.fillStyle = "rgba(220,230,255,0.8)";
    ctx.font = "600 11px 'JetBrains Mono', monospace";
    wrapText(mv.story, W / 2, H / 2 + 24, W - 90, 16);
    ctx.globalAlpha = 1;
  }

  function wrapText(txt, x, y, maxW, lh) {
    const words = txt.split(" ");
    let line = "", yy = y;
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, yy);
        line = w; yy += lh;
      } else line = test;
    }
    if (line) ctx.fillText(line, x, yy);
  }

  /* ============================================================
     HUD DOM
     ============================================================ */
  const $ = (id) => document.getElementById(id);
  const hudMove = $("hud-move"), hudTime = $("hud-time"), hudWeapon = $("hud-weapon"),
        hudScore = $("hud-score"), hudBest = $("hud-best");
  let hudTick = 0;
  function updateHUD(force) {
    if (!force && ++hudTick % 10 !== 0) return;
    if (hudMove) hudMove.textContent = `${roman(G.movement)}/IV`;
    if (hudTime) hudTime.textContent = fmtTime(G.runTime);
    if (hudWeapon) hudWeapon.textContent = WEAPONS[G.p.groove].name;
    if (hudScore) hudScore.textContent = G.score.toLocaleString();
    if (hudBest) hudBest.textContent = G.best.toLocaleString();
  }

  /* ============================================================
     OVERLAY (DOM)
     ============================================================ */
  const overlay = $("overlay"), ovTitle = $("overlay-title"), ovSub = $("overlay-sub"),
        ovScore = $("overlay-score"), btnPrimary = $("btn-primary"), btnEncore = $("btn-encore");

  function showOverlay(title, sub, score, btnLabel, encoreLabel) {
    if (!overlay) return;
    ovTitle.textContent = title;
    ovSub.textContent = sub;
    ovScore.textContent = score || "";
    btnPrimary.textContent = btnLabel;
    if (btnEncore) {
      btnEncore.style.display = encoreLabel ? "" : "none";
      if (encoreLabel) btnEncore.textContent = encoreLabel;
    }
    overlay.classList.add("overlay--show");
  }
  function hideOverlay() { if (overlay) overlay.classList.remove("overlay--show"); }

  function startInterlude() {
    G.phase = "interlude";
    G.ilT = 3.4;
  }

  function startGame() {
    const best = G ? G.best : 0;
    const muted = G ? G.muted : false;
    G = newGame();
    G.best = best;
    G.muted = muted;
    if (window.RB && RB.getHighScore) G.best = Math.max(G.best, RB.getHighScore(GAME_ID) || 0);
    hideOverlay();
    Audio.ensure();
    Audio.resume();
    Audio.setMuted(G.muted);
    G.intensity = MOVEMENTS[0].intensity;
    startInterlude();
    updateHUD(true);
  }

  function doEncore() {
    const finish = (granted) => {
      if (!granted) return;
      G.usedEncore = true;
      const p = G.p;
      p.hp = p.maxHp;
      p.invulnT = 2.5;
      p.bombs = Math.max(p.bombs, 1);
      clearBullets();
      for (let i = G.enemies.length - 1; i >= 0; i--) {
        const e = G.enemies[i];
        if (!e.boss && dist2(e.x, e.y, p.x, p.y) < 220 * 220) {
          burst(e.x, e.y, e.col, 8, 140);
          G.enemies.splice(i, 1);
        }
      }
      hideOverlay();
      G.phase = "play";
      if (window.RB && RB.toast) RB.toast("Encore! The music swells back to life.", "success");
    };
    if (window.RB && RB.isAdFree && RB.isAdFree()) { finish(true); return; }
    if (window.RB && RB.showRewarded) RB.showRewarded().then(finish);
    else finish(true);
  }

  /* ============================================================
     INPUT
     ============================================================ */
  const keys = {};
  const touch = { active: false, id: null, lx: 0, ly: 0, dx: 0, dy: 0 };

  window.addEventListener("keydown", (e) => {
    if (e.repeat) { keys[e.code] = true; return; }
    keys[e.code] = true;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(e.code)) e.preventDefault();
    if (e.code === "Space") tapBeat();
    if (e.code === "ShiftLeft" || e.code === "KeyB" || e.code === "KeyX") fireBomb();
    if (e.code === "KeyP") togglePause();
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });

  function canvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    return [
      (e.clientX - rect.left) * (W / rect.width),
      (e.clientY - rect.top) * (H / rect.height),
    ];
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (G.phase !== "play") return;
    if (e.pointerType === "touch") {
      // touch drags the ship 1:1 (relative), TAP button handles the beat
      if (!touch.active) {
        touch.active = true;
        touch.id = e.pointerId;
        const [x, y] = canvasPos(e);
        touch.lx = x; touch.ly = y;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      }
    } else {
      tapBeat();
    }
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!touch.active || e.pointerId !== touch.id) return;
    const [x, y] = canvasPos(e);
    // relative 1:1 drag: move the ship by the finger delta
    G.p.x = clamp(G.p.x + (x - touch.lx) * 1.15, 16, W - 16);
    G.p.y = clamp(G.p.y + (y - touch.ly) * 1.15, 40, H - 24);
    touch.lx = x; touch.ly = y;
  });
  const endTouch = (e) => {
    if (touch.active && e.pointerId === touch.id) {
      touch.active = false; touch.dx = 0; touch.dy = 0;
    }
  };
  canvas.addEventListener("pointerup", endTouch);
  canvas.addEventListener("pointercancel", endTouch);

  const tapBtn = $("cr-touch-tap");
  if (tapBtn) tapBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); tapBeat(); });
  const bombBtn = $("cr-touch-bomb");
  if (bombBtn) bombBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); fireBomb(); });

  function togglePause() {
    if (G.phase === "play") { G.pausedFrom = "play"; G.phase = "paused"; }
    else if (G.phase === "paused") { G.phase = G.pausedFrom || "play"; }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && G && G.phase === "play" && !window.__CRES_NO_AUTOPAUSE) {
      G.pausedFrom = "play";
      G.phase = "paused";
    }
  });

  // side-panel buttons
  if (btnPrimary) btnPrimary.addEventListener("click", () => startGame());
  if (btnEncore) btnEncore.addEventListener("click", () => doEncore());
  const btnPause = $("btn-pause");
  if (btnPause) btnPause.addEventListener("click", () => togglePause());
  const btnRestart = $("btn-restart");
  if (btnRestart) btnRestart.addEventListener("click", () => startGame());
  const btnSound = $("btn-sound");
  if (btnSound) {
    const saved = localStorage.getItem("rb_cres_sound");
    const applyLabel = () => {
      btnSound.textContent = G.muted ? "Sound Off" : "Sound On";
      btnSound.setAttribute("aria-pressed", String(!G.muted));
    };
    btnSound.addEventListener("click", () => {
      G.muted = !G.muted;
      localStorage.setItem("rb_cres_sound", G.muted ? "0" : "1");
      Audio.ensure();
      Audio.setMuted(G.muted);
      applyLabel();
    });
    setTimeout(() => { if (saved === "0") { G.muted = true; Audio.setMuted(true); } applyLabel(); }, 0);
  }

  /* ============================================================
     MAIN LOOP
     ============================================================ */
  G = newGame();
  if (window.RB && RB.getHighScore) G.best = RB.getHighScore(GAME_ID) || 0;
  updateHUD(true);

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard++ < 20) {
      simStep();
      acc -= STEP;
    }
    Audio.schedule();
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ============================================================
     DEBUG HOOK — drive the sim without rAF (see project notes)
     ============================================================ */
  window.__CRES = {
    get G() { return G; },
    step(n = 1) { for (let i = 0; i < n; i++) simStep(); },
    key(code, down) { keys[code] = !!down; },
    tap: tapBeat,
    bomb: fireBomb,
    start: startGame,
    render: draw,
    spawn: spawnEnemy,
    pattern(name) { PATTERNS[name](); },
    boss(key) { return spawnBoss(key || MOVEMENTS[G.movement - 1].boss); },
    god() { G.p.hp = G.p.maxHp = 99; },
    skipWaves() { G.waveT = MOVEMENTS[G.movement - 1].dur; },
    groove(n) { G.p.groove = clamp(n, 0, GROOVE_MAX); },
    setPhase(ph) { G.phase = ph; },
    alignBeat() { G.songStep = Math.floor(G.songStep / 4) * 4 + 0.1; G.beatPhase = (G.songStep / 4) % 1; },
    hideOverlay, showOverlay,
    Audio,
  };
})();
