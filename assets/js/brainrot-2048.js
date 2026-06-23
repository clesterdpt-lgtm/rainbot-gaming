/* ============================================
   BRAINROT 2048 - sliding-tile merge game
   - DOM-based 4x4 board with CSS slide/merge animation
   - Tier ladder: NPC -> Skibidi -> ... -> Galaxy Brain
   - Debug hook: window.__MERGE
   ============================================ */
(function () {
  "use strict";

  const GAME_ID = "brainrot2048";
  const SIZE = 4;
  const ANIM = 120; // ms - must match the CSS transform transition on .merge-tile
  const scriptUrl = document.currentScript ? document.currentScript.src : location.href;
  const tileImageBase = new URL("../img/brainrot-2048/", scriptUrl).href;

  // Tier ladder. Index 1..MAX. Each tier: display name, tile colours, generated image.
  // Colours remain a fallback while image files are loading.
  const TIERS = [
    null,
    { name: "NPC",          bg: "#26243f", fg: "#ffffff", image: "tile-npc.png" },
    { name: "Skibidi",      bg: "#243a5e", fg: "#ffffff", image: "tile-skibidi.png" },
    { name: "Rizz",         bg: "#194e5c", fg: "#ffffff", image: "tile-rizz.png" },
    { name: "Gyatt",        bg: "#155e44", fg: "#ffffff", image: "tile-gyatt.png" },
    { name: "Sigma",        bg: "#4f5016", fg: "#ffffff", image: "tile-sigma.png" },
    { name: "Mogger",       bg: "#5e3a12", fg: "#ffffff", image: "tile-mogger.png" },
    { name: "Aura",         bg: "#5a1f48", fg: "#ffffff", image: "tile-aura.png" },
    { name: "Gigachad",     bg: "#ff2e88", fg: "#ffffff", image: "tile-gigachad.png" },
    { name: "Fanum Tax",    bg: "#2ee0ff", fg: "#ffffff", image: "tile-fanum-tax.png" },
    { name: "Ohio",         bg: "#ffd43b", fg: "#ffffff", image: "tile-ohio.png" },
    { name: "Galaxy Brain", bg: "#ff2e88", fg: "#ffffff", image: "tile-galaxy-brain.png" },
  ];
  const MAX = TIERS.length - 1;

  const api =
    typeof RB !== "undefined"
      ? RB
      : { recordScore: () => false, getHighScore: () => 0, toast: () => {} };

  const boardEl = document.getElementById("board");
  const cellsEl = document.getElementById("cells");
  const tilesEl = document.getElementById("tiles");
  const overlayEl = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlaySub = document.getElementById("overlay-sub");
  const overlayScore = document.getElementById("overlay-score");
  const btnPrimary = document.getElementById("btn-primary");
  const btnNew = document.getElementById("btn-new");
  const btnSound = document.getElementById("btn-sound");
  const scoreEl = document.getElementById("hud-score");
  const bestEl = document.getElementById("hud-best");
  const topEl = document.getElementById("hud-top");
  const ladderEl = document.getElementById("ladder");

  let grid;
  let tiles;
  let score = 0;
  let topTier = 1;
  let uid = 0;
  let animating = false;
  let running = false;
  let won = false;
  let bestAtStart = 0;
  const saveSlot = window.RBGameSaves && window.RBGameSaves.create(GAME_ID, { version: 1 });
  let saveMenu = null;
  const SOUND_PREF_KEY = GAME_ID + ":sound";
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;
  let audioMaster = null;
  let soundOn = readSoundPreference();

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

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

  function updateSoundButton() {
    if (!btnSound) return;
    if (!AudioContextCtor) {
      btnSound.textContent = "Sound Off";
      btnSound.setAttribute("aria-pressed", "false");
      btnSound.disabled = true;
      return;
    }
    btnSound.textContent = soundOn ? "Sound On" : "Sound Off";
    btnSound.setAttribute("aria-pressed", soundOn ? "true" : "false");
  }

  function ensureAudio() {
    if (!soundOn || !AudioContextCtor) return null;
    if (!audioCtx) {
      audioCtx = new AudioContextCtor();
      audioMaster = audioCtx.createGain();
      audioMaster.gain.value = 0.12;
      audioMaster.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    if (audioMaster) audioMaster.gain.setTargetAtTime(0.12, audioCtx.currentTime, 0.03);
    return audioCtx;
  }

  function playTone(freq, duration, options = {}) {
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime + (options.delay || 0);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const attack = Math.min(options.attack || 0.012, duration * 0.45);
    osc.type = options.type || "sine";
    osc.frequency.setValueAtTime(Math.max(1, freq), t0);
    if (options.to) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, options.to), t0 + duration);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(options.gain || 0.032, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(audioMaster || ac.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.04);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  function playNoise(duration, options = {}) {
    const ac = ensureAudio();
    if (!ac) return;
    const length = Math.max(1, Math.floor(ac.sampleRate * duration));
    const buffer = ac.createBuffer(1, length, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const fade = 1 - i / length;
      data[i] = (Math.random() * 2 - 1) * fade * fade;
    }

    const t0 = ac.currentTime + (options.delay || 0);
    const source = ac.createBufferSource();
    const filter = ac.createBiquadFilter();
    const gain = ac.createGain();
    source.buffer = buffer;
    filter.type = options.filter || "bandpass";
    filter.frequency.setValueAtTime(options.frequency || 900, t0);
    filter.Q.value = options.q || 0.8;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(options.gain || 0.024, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioMaster || ac.destination);
    source.start(t0);
    source.stop(t0 + duration + 0.04);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  function playTileSfx(tier, index = 0) {
    if (!soundOn) return;
    const t = clamp(Number(tier) || 1, 1, MAX);
    const delay = Math.min(index, 3) * 0.055;

    if (t === 1) {
      playTone(86, 0.18, { type: "sawtooth", to: 43, gain: 0.07, delay, attack: 0.018 });
      playTone(52, 0.24, { type: "sine", to: 36, gain: 0.038, delay: delay + 0.045 });
      playNoise(0.24, { filter: "lowpass", frequency: 220, q: 0.9, gain: 0.036, delay: delay + 0.02 });
    } else if (t === 2) {
      [330, 440, 392].forEach((freq, i) =>
        playTone(freq, 0.07, { type: "square", to: freq * 1.28, gain: 0.028, delay: delay + i * 0.045 })
      );
      playNoise(0.08, { filter: "bandpass", frequency: 1200, q: 2.2, gain: 0.012, delay: delay + 0.04 });
    } else if (t === 3) {
      [523, 659, 880].forEach((freq, i) =>
        playTone(freq, 0.095, { type: "triangle", gain: 0.03, delay: delay + i * 0.04 })
      );
      playNoise(0.12, { filter: "highpass", frequency: 2600, gain: 0.01, delay: delay + 0.08 });
    } else if (t === 4) {
      playTone(130, 0.13, { type: "sine", to: 260, gain: 0.052, delay });
      playTone(260, 0.16, { type: "triangle", to: 120, gain: 0.034, delay: delay + 0.07 });
    } else if (t === 5) {
      playTone(98, 0.2, { type: "triangle", to: 74, gain: 0.05, delay });
      playTone(294, 0.08, { type: "square", gain: 0.018, delay: delay + 0.12 });
    } else if (t === 6) {
      playNoise(0.055, { filter: "highpass", frequency: 1800, q: 1.7, gain: 0.035, delay });
      playTone(185, 0.12, { type: "sawtooth", to: 370, gain: 0.032, delay: delay + 0.035 });
      playNoise(0.05, { filter: "bandpass", frequency: 900, gain: 0.022, delay: delay + 0.11 });
    } else if (t === 7) {
      playNoise(0.24, { filter: "highpass", frequency: 1400, q: 0.7, gain: 0.022, delay });
      playTone(440, 0.22, { type: "sine", to: 1320, gain: 0.024, delay: delay + 0.015 });
      playTone(880, 0.18, { type: "triangle", to: 1760, gain: 0.018, delay: delay + 0.08 });
    } else if (t === 8) {
      [147, 220, 294].forEach((freq, i) =>
        playTone(freq, 0.18, { type: "sawtooth", gain: 0.026, delay: delay + i * 0.035 })
      );
      playNoise(0.1, { filter: "lowpass", frequency: 320, gain: 0.026, delay: delay + 0.06 });
    } else if (t === 9) {
      [988, 1319, 1568].forEach((freq, i) =>
        playTone(freq, 0.045, { type: "square", gain: 0.022, delay: delay + i * 0.05 })
      );
      playNoise(0.08, { filter: "bandpass", frequency: 3200, q: 3, gain: 0.014, delay: delay + 0.06 });
    } else if (t === 10) {
      playTone(740, 0.22, { type: "sawtooth", to: 196, gain: 0.04, delay });
      playTone(330, 0.09, { type: "square", to: 660, gain: 0.021, delay: delay + 0.13 });
    } else {
      [392, 587, 784, 1175, 1568].forEach((freq, i) =>
        playTone(freq, 0.16, { type: "triangle", gain: 0.026, delay: delay + i * 0.055 })
      );
      playNoise(0.34, { filter: "highpass", frequency: 2400, q: 0.9, gain: 0.026, delay: delay + 0.12 });
    }
  }

  function playUiSfx(name) {
    if (!soundOn) return;
    if (name === "start") {
      playTone(196, 0.08, { type: "triangle", to: 294, gain: 0.032 });
      playTone(392, 0.1, { type: "triangle", to: 523, gain: 0.026, delay: 0.065 });
    } else if (name === "win") {
      playTileSfx(MAX);
    } else if (name === "gameOver") {
      playTone(180, 0.16, { type: "sawtooth", to: 92, gain: 0.045 });
      playTone(82, 0.28, { type: "sine", to: 45, gain: 0.038, delay: 0.1 });
      playNoise(0.18, { filter: "lowpass", frequency: 240, gain: 0.022, delay: 0.04 });
    } else if (name === "toggle") {
      playTone(440, 0.07, { type: "triangle", gain: 0.026 });
      playTone(660, 0.08, { type: "triangle", gain: 0.022, delay: 0.055 });
    }
  }

  function toggleSound() {
    if (!AudioContextCtor) return;
    soundOn = !soundOn;
    writeSoundPreference();
    updateSoundButton();
    if (!soundOn && audioMaster && audioCtx) {
      audioMaster.gain.setTargetAtTime(0.0001, audioCtx.currentTime, 0.03);
    }
    if (soundOn) {
      ensureAudio();
      playUiSfx("toggle");
    }
  }

  function tileImageUrl(tier) {
    return tileImageBase + tier.image;
  }

  function makeCells() {
    cellsEl.innerHTML = "";
    for (let i = 0; i < SIZE * SIZE; i++) {
      const cell = document.createElement("div");
      cell.className = "merge-cell";
      cellsEl.appendChild(cell);
    }
  }

  function makeLadder() {
    if (!ladderEl) return;
    ladderEl.innerHTML = "";
    for (let v = 1; v <= MAX; v++) {
      const tier = TIERS[v];
      const li = document.createElement("li");
      li.style.background = tier.bg;
      li.style.color = tier.fg;
      li.innerHTML =
        '<img src="' + tileImageUrl(tier) + '" alt="" loading="lazy" />' +
        '<span>' + tier.name + "</span>";
      ladderEl.appendChild(li);
    }
  }

  function placeTile(tile) {
    tile.el.style.setProperty("--c", tile.c);
    tile.el.style.setProperty("--r", tile.r);
  }

  function styleTile(tile) {
    const tier = TIERS[tile.val];
    tile.el.style.background = tier.bg;
    tile.el.style.color = tier.fg;
    tile.el.style.setProperty("--tile-image", 'url("' + tileImageUrl(tier) + '")');
    tile.el.classList.toggle("merge-tile--boss", tile.val === MAX);
    tile.el.innerHTML =
      '<span class="merge-tile__art" aria-hidden="true"></span>' +
      '<span class="merge-tile__n">' + tile.val + "</span>" +
      '<span class="merge-tile__name">' + tier.name + "</span>";
  }

  function flash(el, cls, ms) {
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  function emptyCells() {
    const out = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) if (!grid[r][c]) out.push({ r, c });
    return out;
  }

  function addTile(r, c, val, isNew) {
    const tile = { id: ++uid, val, r, c, el: document.createElement("div"), mergedInto: false };
    tile.el.className = "merge-tile" + (isNew ? " merge-tile--new" : "");
    placeTile(tile);
    styleTile(tile);
    tilesEl.appendChild(tile.el);
    grid[r][c] = tile;
    tiles.push(tile);
    if (isNew) setTimeout(() => tile.el.classList.remove("merge-tile--new"), 200);
    return tile;
  }

  function spawnTile(forced) {
    const cells = emptyCells();
    if (!cells.length) return null;
    const spot = cells[(Math.random() * cells.length) | 0];
    const val = forced || (Math.random() < 0.1 ? 2 : 1);
    const tile = addTile(spot.r, spot.c, val, true);
    if (val > topTier) topTier = val;
    return tile;
  }

  const VEC = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

  function traversal(dir) {
    const order = [];
    if (dir === "left") {
      for (let c = 0; c < SIZE; c++) for (let r = 0; r < SIZE; r++) order.push([r, c]);
    } else if (dir === "right") {
      for (let c = SIZE - 1; c >= 0; c--) for (let r = 0; r < SIZE; r++) order.push([r, c]);
    } else if (dir === "up") {
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) order.push([r, c]);
    } else {
      for (let r = SIZE - 1; r >= 0; r--) for (let c = 0; c < SIZE; c++) order.push([r, c]);
    }
    return order;
  }

  function move(dir) {
    if (!running || animating || !VEC[dir]) return false;
    ensureAudio();
    const [dr, dc] = VEC[dir];
    let moved = false;
    const merges = [];

    for (const tile of tiles) tile.mergedInto = false;

    for (const [r, c] of traversal(dir)) {
      const tile = grid[r][c];
      if (!tile) continue;
      let nr = r;
      let nc = c;
      while (true) {
        const tr = nr + dr;
        const tc = nc + dc;
        if (tr < 0 || tr >= SIZE || tc < 0 || tc >= SIZE) break;
        const occ = grid[tr][tc];
        if (!occ) {
          nr = tr;
          nc = tc;
          continue;
        }
        if (occ.val === tile.val && occ.val < MAX && !occ.mergedInto) {
          nr = tr;
          nc = tc;
        }
        break;
      }
      if (nr === r && nc === c) continue;

      moved = true;
      const dest = grid[nr][nc];
      grid[r][c] = null;
      tile.r = nr;
      tile.c = nc;
      placeTile(tile);
      if (dest) {
        dest.mergedInto = true;
        merges.push({ survivor: dest, eaten: tile });
      } else {
        grid[nr][nc] = tile;
      }
    }

    if (!moved) return false;

    animating = true;
    setTimeout(() => {
      let highestMergedTier = 0;
      for (const { survivor, eaten } of merges) {
        const i = tiles.indexOf(eaten);
        if (i >= 0) tiles.splice(i, 1);
        if (eaten.el.parentNode) eaten.el.parentNode.removeChild(eaten.el);
        highestMergedTier = Math.max(highestMergedTier, survivor.val);
        survivor.val += 1;
        styleTile(survivor);
        flash(survivor.el, "merge-tile--pop", 200);
        score += Math.pow(2, survivor.val);
        if (survivor.val > topTier) topTier = survivor.val;
      }
      if (highestMergedTier) playTileSfx(highestMergedTier);
      spawnTile();
      api.recordScore(GAME_ID, score);
      updateHud();
      saveProgress();

      if (!won && topTier >= MAX) {
        won = true;
        saveProgress();
        showWin();
      } else if (isGameOver()) {
        showGameOver();
      }
      animating = false;
    }, ANIM);

    return true;
  }

  function isGameOver() {
    if (emptyCells().length) return false;
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        const v = grid[r][c].val;
        if (c < SIZE - 1 && grid[r][c + 1].val === v) return false;
        if (r < SIZE - 1 && grid[r + 1][c].val === v) return false;
      }
    return true;
  }

  function updateHud() {
    if (scoreEl) scoreEl.textContent = score.toLocaleString();
    if (bestEl) bestEl.textContent = api.getHighScore(GAME_ID).toLocaleString();
    if (topEl) topEl.textContent = TIERS[topTier] ? TIERS[topTier].name : "-";
  }

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

  function showGameOver() {
    running = false;
    if (saveSlot) saveSlot.clear();
    playUiSfx("gameOver");
    const best = api.getHighScore(GAME_ID);
    if (score > 0 && score >= best && score > bestAtStart) {
      setTimeout(() => api.toast("New high score!", "good"), 300);
    }
    showOverlay(
      "Brain Full.",
      "No moves left - the grid is wall-to-wall NPCs and nothing else will merge.",
      "Run it back",
      "Score: <strong>" + score.toLocaleString() +
        "</strong> / Best tier: <strong>" + TIERS[topTier].name +
        "</strong> / High: <strong>" + best.toLocaleString() + "</strong>",
      newGame
    );
  }

  function showWin() {
    const best = api.getHighScore(GAME_ID);
    saveProgress();
    playUiSfx("win");
    showOverlay(
      "GALAXY BRAIN",
      "You merged all the way to the top of the brainrot food chain. Keep going for a higher score, or reset.",
      "Keep merging",
      "Score: <strong>" + score.toLocaleString() +
        "</strong> / High: <strong>" + best.toLocaleString() + "</strong>",
      hideOverlay
    );
  }

  function newGame() {
    ensureAudio();
    playUiSfx("start");
    if (saveSlot) saveSlot.clear();
    tilesEl.innerHTML = "";
    grid = [];
    for (let r = 0; r < SIZE; r++) grid.push(new Array(SIZE).fill(null));
    tiles = [];
    score = 0;
    topTier = 1;
    uid = 0;
    won = false;
    animating = false;
    running = true;
    bestAtStart = api.getHighScore(GAME_ID);
    spawnTile(1);
    spawnTile(Math.random() < 0.5 ? 1 : 2);
    hideOverlay();
    updateHud();
    saveProgress();
  }

  function snapshot() {
    return {
      grid: grid.map((row) => row.map((tile) => (tile ? tile.val : 0))),
      score,
      topTier,
      uid,
      won,
      running: running && !animating,
    };
  }

  function saveProgress() {
    if (!saveSlot || !running) return;
    saveSlot.save(snapshot());
  }

  function restoreGame(saved) {
    const data = saved && saved.data;
    if (!data || !Array.isArray(data.grid)) return;
    tilesEl.innerHTML = "";
    grid = [];
    tiles = [];
    uid = Number(data.uid) || 0;
    score = Number(data.score) || 0;
    topTier = Number(data.topTier) || 1;
    won = Boolean(data.won);
    animating = false;
    running = data.running !== false;
    for (let r = 0; r < SIZE; r++) {
      grid.push(new Array(SIZE).fill(null));
      const row = Array.isArray(data.grid[r]) ? data.grid[r] : [];
      for (let c = 0; c < SIZE; c++) {
        const val = Number(row[c]) || 0;
        if (val > 0 && val <= MAX) addTile(r, c, val, false);
      }
    }
    bestAtStart = api.getHighScore(GAME_ID);
    hideOverlay();
    updateHud();
  }

  const KEYS = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    w: "up", s: "down", a: "left", d: "right",
    W: "up", S: "down", A: "left", D: "right",
  };

  document.addEventListener("keydown", (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const dir = KEYS[e.key];
    if (!dir) return;
    e.preventDefault();
    move(dir);
  });

  document.querySelectorAll("[data-mobile-dir]").forEach((btn) => {
    btn.addEventListener("click", () => move(btn.getAttribute("data-mobile-dir")));
  });

  if (btnNew) btnNew.addEventListener("click", newGame);
  if (btnSound) btnSound.addEventListener("click", toggleSound);

  let sx = 0;
  let sy = 0;
  let swiping = false;
  boardEl.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    sx = t.clientX;
    sy = t.clientY;
    swiping = true;
  }, { passive: true });
  boardEl.addEventListener("touchend", (e) => {
    if (!swiping) return;
    swiping = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? "right" : "left");
    else move(dy > 0 ? "down" : "up");
  }, { passive: true });

  makeCells();
  makeLadder();
  updateSoundButton();
  grid = [];
  for (let r = 0; r < SIZE; r++) grid.push(new Array(SIZE).fill(null));
  tiles = [];
  updateHud();
  btnPrimary.onclick = newGame;
  if (saveSlot) {
    saveMenu = saveSlot.attachButtons({
      primary: btnPrimary,
      scoreEl: overlayScore,
      continueLabel: "Continue",
      newLabel: "New game",
      onContinue: restoreGame,
      summary: (saved) => {
        const data = saved.data || {};
        const tier = TIERS[data.topTier] ? TIERS[data.topTier].name : "NPC";
        return `${window.RBGameSaves.formatSavedAt(saved.savedAt)} · Score <strong>${Number(data.score || 0).toLocaleString()}</strong> · ${tier}`;
      },
    });
    saveSlot.startAutosave(snapshot, () => running && !animating);
    saveMenu.refresh();
  }

  function setCell(r, c, val) {
    if (!grid[r][c] && !val) return;
    if (grid[r][c]) {
      const old = grid[r][c];
      const i = tiles.indexOf(old);
      if (i >= 0) tiles.splice(i, 1);
      if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
      grid[r][c] = null;
    }
    if (val > 0) {
      addTile(r, c, val, false);
      if (val > topTier) topTier = val;
    }
    updateHud();
  }

  function clearBoard() {
    tilesEl.innerHTML = "";
    grid = [];
    for (let r = 0; r < SIZE; r++) grid.push(new Array(SIZE).fill(null));
    tiles = [];
    topTier = 1;
    updateHud();
  }

  window.__MERGE = {
    TIERS,
    MAX,
    move,
    newGame,
    spawn: spawnTile,
    set: setCell,
    clear: clearBoard,
    vals: () => grid.map((row) => row.map((tile) => (tile ? tile.val : 0))),
    get score() { return score; },
    get topTier() { return topTier; },
    get animating() { return animating; },
    get running() { return running; },
    get soundOn() { return soundOn; },
    playTileSfx,
    save: saveProgress,
    restore: () => restoreGame(saveSlot && saveSlot.read()),
  };
})();
