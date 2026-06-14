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
      for (const { survivor, eaten } of merges) {
        const i = tiles.indexOf(eaten);
        if (i >= 0) tiles.splice(i, 1);
        if (eaten.el.parentNode) eaten.el.parentNode.removeChild(eaten.el);
        survivor.val += 1;
        styleTile(survivor);
        flash(survivor.el, "merge-tile--pop", 200);
        score += Math.pow(2, survivor.val);
        if (survivor.val > topTier) topTier = survivor.val;
      }
      spawnTile();
      api.recordScore(GAME_ID, score);
      updateHud();

      if (!won && topTier >= MAX) {
        won = true;
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
  grid = [];
  for (let r = 0; r < SIZE; r++) grid.push(new Array(SIZE).fill(null));
  tiles = [];
  updateHud();
  btnPrimary.onclick = newGame;

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
  };
})();
