/**
 * Quiet Quitting - Rainbot Gaming
 * Satirical Pac-Man arcade maze chaser
 * 
 * You're a burned-out worker dodging micromanagers, HR bots, and calendar blockers.
 * Grab coffee, snatch paychecks, and become a $350/hr Consultant to fire the bosses.
 */

(function () {
  "use strict";

  // --- AUDIO SYNTHESIS (Zero external audio dependency) ---
  class SoundManager {
    constructor() {
      this.ctx = null;
      this.muted = localStorage.getItem("quiet-quitting-muted") === "true";
      this.lastChompTone = 0;
    }

    init() {
      if (this.ctx) {
        if (this.ctx.state === "suspended") {
          this.ctx.resume().catch(() => {});
        }
        return;
      }
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      } catch (e) {
        console.warn("WebAudio not supported", e);
      }
    }

    toggleMute() {
      this.muted = !this.muted;
      localStorage.setItem("quiet-quitting-muted", this.muted ? "true" : "false");
      return !this.muted;
    }

    playChomp() {
      if (this.muted) return;
      this.init();
      if (!this.ctx || this.ctx.state !== "running") return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const now = this.ctx.currentTime;

      this.lastChompTone = this.lastChompTone === 0 ? 1 : 0;
      const freq = this.lastChompTone === 0 ? 280 : 380;

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.6, now + 0.08);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.08);
    }

    playPowerPellet() {
      if (this.muted) return;
      this.init();
      if (!this.ctx || this.ctx.state !== "running") return;

      const now = this.ctx.currentTime;
      [440, 554, 659, 880].forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const t = now + i * 0.06;

        osc.type = "square";
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(t);
        osc.stop(t + 0.12);
      });
    }

    playEatGhost() {
      if (this.muted) return;
      this.init();
      if (!this.ctx || this.ctx.state !== "running") return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.25);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.25);
    }

    playEatBonus() {
      if (this.muted) return;
      this.init();
      if (!this.ctx || this.ctx.state !== "running") return;

      const now = this.ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const t = now + i * 0.05;

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(t);
        osc.stop(t + 0.18);
      });
    }

    playDeath() {
      if (this.muted) return;
      this.init();
      if (!this.ctx || this.ctx.state !== "running") return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.linearRampToValueAtTime(80, now + 0.7);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.7);
    }

    playLevelClear() {
      if (this.muted) return;
      this.init();
      if (!this.ctx || this.ctx.state !== "running") return;

      const notes = [
        { f: 523.25, d: 0.1 },
        { f: 659.25, d: 0.1 },
        { f: 783.99, d: 0.1 },
        { f: 1046.5, d: 0.25 },
        { f: 880.0, d: 0.1 },
        { f: 1046.5, d: 0.4 }
      ];

      let t = this.ctx.currentTime;
      notes.forEach((n) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = "square";
        osc.frequency.setValueAtTime(n.f, t);
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + n.d);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(t);
        osc.stop(t + n.d);
        t += n.d;
      });
    }
  }

  // --- MAZE DEFINITION ---
  // 28 cols x 31 rows (Authentic arcade layout)
  // 1: Wall, 2: Dot (Paycheck/Coffee), 3: Energizer (Consultant Badge),
  // 0: Empty path, 4: Ghost House interior, 5: Ghost Door, 6: Warp Tunnel, 7: Fruit spawn
  const COLS = 28;
  const ROWS = 31;

  const RAW_MAZE = [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,3,2,2,2,2,2,2,2,2,2,2,2,1,1,2,2,2,2,2,2,2,2,2,2,2,3,1],
    [1,2,1,1,1,1,2,1,1,1,1,1,2,1,1,2,1,1,1,1,1,2,1,1,1,1,2,1],
    [1,2,1,1,1,1,2,1,1,1,1,1,2,1,1,2,1,1,1,1,1,2,1,1,1,1,2,1],
    [1,2,1,1,1,1,2,1,1,1,1,1,2,1,1,2,1,1,1,1,1,2,1,1,1,1,2,1],
    [1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1],
    [1,2,1,1,1,1,2,1,1,2,1,1,1,1,1,1,1,1,2,1,1,2,1,1,1,1,2,1],
    [1,2,1,1,1,1,2,1,1,2,1,1,1,1,1,1,1,1,2,1,1,2,1,1,1,1,2,1],
    [1,2,2,2,2,2,2,1,1,2,2,2,2,1,1,2,2,2,2,1,1,2,2,2,2,2,2,1],
    [1,1,1,1,1,1,2,1,1,1,1,1,0,1,1,0,1,1,1,1,1,2,1,1,1,1,1,1],
    [0,0,0,0,0,1,2,1,1,1,1,1,0,1,1,0,1,1,1,1,1,2,1,0,0,0,0,0],
    [0,0,0,0,0,1,2,1,1,0,0,0,0,0,0,0,0,0,0,1,1,2,1,0,0,0,0,0],
    [0,0,0,0,0,1,2,1,1,0,1,1,1,5,5,1,1,1,0,1,1,2,1,0,0,0,0,0],
    [1,1,1,1,1,1,2,1,1,0,1,4,4,4,4,4,4,1,0,1,1,2,1,1,1,1,1,1],
    [6,0,0,0,0,0,2,0,0,0,1,4,4,4,4,4,4,1,0,0,0,2,0,0,0,0,0,6],
    [1,1,1,1,1,1,2,1,1,0,1,4,4,4,4,4,4,1,0,1,1,2,1,1,1,1,1,1],
    [0,0,0,0,0,1,2,1,1,0,1,1,1,1,1,1,1,1,0,1,1,2,1,0,0,0,0,0],
    [0,0,0,0,0,1,2,1,1,0,0,0,0,7,0,0,0,0,0,1,1,2,1,0,0,0,0,0],
    [0,0,0,0,0,1,2,1,1,0,1,1,1,1,1,1,1,1,0,1,1,2,1,0,0,0,0,0],
    [1,1,1,1,1,1,2,1,1,0,1,1,1,1,1,1,1,1,0,1,1,2,1,1,1,1,1,1],
    [1,2,2,2,2,2,2,2,2,2,2,2,2,1,1,2,2,2,2,2,2,2,2,2,2,2,2,1],
    [1,2,1,1,1,1,2,1,1,1,1,1,2,1,1,2,1,1,1,1,1,2,1,1,1,1,2,1],
    [1,2,1,1,1,1,2,1,1,1,1,1,2,1,1,2,1,1,1,1,1,2,1,1,1,1,2,1],
    [1,3,2,2,1,1,2,2,2,2,2,2,2,0,0,2,2,2,2,2,2,2,1,1,2,2,3,1],
    [1,1,1,2,1,1,2,1,1,2,1,1,1,1,1,1,1,1,2,1,1,2,1,1,2,1,1,1],
    [1,1,1,2,1,1,2,1,1,2,1,1,1,1,1,1,1,1,2,1,1,2,1,1,2,1,1,1],
    [1,2,2,2,2,2,2,1,1,2,2,2,2,1,1,2,2,2,2,1,1,2,2,2,2,2,2,1],
    [1,2,1,1,1,1,1,1,1,1,1,1,2,1,1,2,1,1,1,1,1,1,1,1,1,1,2,1],
    [1,2,1,1,1,1,1,1,1,1,1,1,2,1,1,2,1,1,1,1,1,1,1,1,1,1,2,1],
    [1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  ];

  const DIRECTIONS = {
    NONE:  { x:  0, y:  0, name: "NONE" },
    UP:    { x:  0, y: -1, name: "UP" },
    DOWN:  { x:  0, y:  1, name: "DOWN" },
    LEFT:  { x: -1, y:  0, name: "LEFT" },
    RIGHT: { x:  1, y:  0, name: "RIGHT" },
  };

  const FRUITS = [
    { name: "Free Pizza", emoji: "🍕", pts: 100, desc: "Breakroom pizza instead of a raise" },
    { name: "Cold Brew", emoji: "☕", pts: 300, desc: "Triple-shot energy surge" },
    { name: "Standing Desk", emoji: "🪑", pts: 500, desc: "Ergonomic posture unlocked" },
    { name: "Stock Options", emoji: "📈", pts: 1000, desc: "Vested on a 4-year cliff" },
    { name: "Golden Parachute", emoji: "🪂", pts: 3000, desc: "Executive severance package!" }
  ];

  // --- GAME ENGINE ---
  class QuietQuittingGame {
    constructor() {
      this.canvas = document.getElementById("gameCanvas");
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext("2d");
      this.sound = new SoundManager();

      // UI Elements
      this.hudScore = document.getElementById("hud-score");
      this.hudBest = document.getElementById("hud-best");
      this.hudLives = document.getElementById("hud-lives");
      this.hudLevel = document.getElementById("hud-level");
      this.hudStatus = document.getElementById("hud-status");
      this.overlay = document.getElementById("overlay");
      this.overlayTitle = document.getElementById("overlay-title");
      this.overlaySub = document.getElementById("overlay-sub");
      this.overlayScore = document.getElementById("overlay-score");
      this.btnPrimary = document.getElementById("btn-primary");
      this.btnNew = document.getElementById("btn-new");
      this.btnPause = document.getElementById("btn-pause");
      this.btnSound = document.getElementById("btn-sound");
      this.feedList = document.getElementById("office-feed");

      // Game Parameters
      this.tileSize = 24;
      this.gridWidth = COLS * this.tileSize; // 672
      this.gridHeight = ROWS * this.tileSize; // 744
      this.canvas.width = this.gridWidth;
      this.canvas.height = this.gridHeight;

      this.state = "INIT"; // INIT, PLAYING, PAUSED, DYING, LEVEL_CLEAR, GAME_OVER
      this.score = 0;
      this.bestScore = parseInt(localStorage.getItem("quiet-quitting-best") || "0", 10);
      this.level = 1;
      this.lives = 3;
      this.dotsLeft = 0;
      this.totalDots = 0;

      this.maze = [];
      this.particles = [];
      this.popups = [];
      this.fruit = null;
      this.fruitLifeTimer = 0;

      this.frightenedTimer = 0;
      this.frightenedDuration = 8.0;
      this.ghostsEatenInSurge = 0;

      this.globalTimer = 0;
      this.lastFrameTime = performance.now();

      // Entities
      this.player = null;
      this.ghosts = [];

      // Pre-initialize round so game board renders immediately
      this.resetMaze();
      this.initRound();

      this.initEvents();
      this.updateHud();
      this.showStartOverlay();

      // Start loop
      requestAnimationFrame((t) => this.loop(t));
    }

    initEvents() {
      // Keyboard Controls
      window.addEventListener("keydown", (e) => {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", " "].includes(e.key)) {
          e.preventDefault();
        }

        this.sound.init();

        if (e.key === "p" || e.key === "P") {
          this.togglePause();
          return;
        }
        if (e.key === "m" || e.key === "M") {
          this.toggleSound();
          return;
        }

        if (this.state === "INIT" || this.state === "GAME_OVER" || this.state === "LEVEL_CLEAR") {
          if (e.key === "Enter" || e.key === " " || e.key === "Space") {
            this.handlePrimaryClick();
            return;
          }
        }

        if (!this.player) return;

        switch (e.key) {
          case "ArrowUp":
          case "w":
          case "W":
            this.player.setNextDir(DIRECTIONS.UP);
            break;
          case "ArrowDown":
          case "s":
          case "S":
            this.player.setNextDir(DIRECTIONS.DOWN);
            break;
          case "ArrowLeft":
          case "a":
          case "A":
            this.player.setNextDir(DIRECTIONS.LEFT);
            break;
          case "ArrowRight":
          case "d":
          case "D":
            this.player.setNextDir(DIRECTIONS.RIGHT);
            break;
        }
      });

      // Mobile D-pad & Buttons
      document.querySelectorAll("[data-mobile-dir]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          this.sound.init();
          if (this.state === "INIT") {
            this.handlePrimaryClick();
          }
          if (!this.player) return;
          const dir = btn.getAttribute("data-mobile-dir");
          if (dir === "up") this.player.setNextDir(DIRECTIONS.UP);
          if (dir === "down") this.player.setNextDir(DIRECTIONS.DOWN);
          if (dir === "left") this.player.setNextDir(DIRECTIONS.LEFT);
          if (dir === "right") this.player.setNextDir(DIRECTIONS.RIGHT);
        });
      });

      // Swipe Gestures on Canvas
      let touchStartX = 0;
      let touchStartY = 0;
      this.canvas.addEventListener("touchstart", (e) => {
        if (!e.touches[0]) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        this.sound.init();
        if (this.state === "INIT") {
          this.handlePrimaryClick();
        }
      }, { passive: true });

      this.canvas.addEventListener("touchend", (e) => {
        if (!e.changedTouches[0] || !this.player) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.hypot(dx, dy) < 20) return;

        if (Math.abs(dx) > Math.abs(dy)) {
          this.player.setNextDir(dx > 0 ? DIRECTIONS.RIGHT : DIRECTIONS.LEFT);
        } else {
          this.player.setNextDir(dy > 0 ? DIRECTIONS.DOWN : DIRECTIONS.UP);
        }
      }, { passive: true });

      // Buttons
      if (this.btnPrimary) {
        this.btnPrimary.addEventListener("click", () => {
          this.sound.init();
          this.handlePrimaryClick();
        });
      }
      if (this.btnNew) {
        this.btnNew.addEventListener("click", () => {
          this.sound.init();
          this.startNewGame();
        });
      }
      if (this.btnPause) {
        this.btnPause.addEventListener("click", () => {
          this.sound.init();
          this.togglePause();
        });
      }
      if (this.btnSound) {
        this.btnSound.addEventListener("click", () => {
          this.toggleSound();
        });
      }

      this.updateSoundButton();
    }

    handlePrimaryClick() {
      if (this.state === "INIT" || this.state === "GAME_OVER") {
        this.startNewGame();
      } else if (this.state === "LEVEL_CLEAR") {
        this.startNextLevel();
      } else if (this.state === "PAUSED") {
        this.togglePause();
      }
    }

    togglePause() {
      if (this.state === "PLAYING") {
        this.state = "PAUSED";
        this.showOverlay("⏸️ BREAK TIME (PAUSED)", "Slack status set to 'Away'. Press P or Resume to get back to quiet quitting.", "Resume");
        if (this.btnPause) this.btnPause.textContent = "Resume";
      } else if (this.state === "PAUSED") {
        this.state = "PLAYING";
        this.hideOverlay();
        if (this.btnPause) this.btnPause.textContent = "Pause";
      }
    }

    toggleSound() {
      const active = this.sound.toggleMute();
      this.updateSoundButton();
      this.addOfficeFeed(active ? "🔊 Sound unmuted" : "🔇 Sound muted");
    }

    updateSoundButton() {
      if (!this.btnSound) return;
      const isSoundOn = !this.sound.muted;
      this.btnSound.textContent = isSoundOn ? "Sound On" : "Sound Off";
      this.btnSound.setAttribute("aria-pressed", isSoundOn ? "true" : "false");
    }

    showStartOverlay() {
      this.showOverlay(
        "💼 QUIET QUITTING",
        "Dodge micromanagers, avoid calendar blockers, and grab paychecks while doing the bare minimum.<br><br>" +
        "Grab the <strong>$350/hr Consultant Badge</strong> to flip the hierarchy and bill the bosses into oblivion!<br><br>" +
        "<strong>Controls:</strong> <kbd>WASD</kbd> or <kbd>Arrow Keys</kbd> / Swipe.",
        "Clock In"
      );
    }

    showOverlay(title, sub, btnText) {
      if (this.overlayTitle) this.overlayTitle.innerHTML = title;
      if (this.overlaySub) this.overlaySub.innerHTML = sub;
      if (this.btnPrimary) this.btnPrimary.textContent = btnText;
      if (this.overlayScore) this.overlayScore.innerHTML = `Score: <strong>${this.score}</strong> · Best: <strong>${this.bestScore}</strong>`;
      if (this.overlay) this.overlay.classList.add("overlay--show");
    }

    hideOverlay() {
      if (this.overlay) this.overlay.classList.remove("overlay--show");
    }

    addOfficeFeed(text) {
      if (!this.feedList) return;
      const li = document.createElement("li");
      li.className = "feed-item feed-item--fresh";
      li.innerHTML = text;
      this.feedList.prepend(li);
      while (this.feedList.children.length > 5) {
        this.feedList.removeChild(this.feedList.lastChild);
      }
    }

    resetMaze() {
      this.maze = [];
      this.dotsLeft = 0;
      this.totalDots = 0;

      for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) {
          const cell = RAW_MAZE[r][c];
          row.push(cell);
          if (cell === 2 || cell === 3) {
            this.dotsLeft++;
            this.totalDots++;
          }
        }
        this.maze.push(row);
      }
    }

    startNewGame() {
      this.score = 0;
      this.level = 1;
      this.lives = 3;
      this.resetMaze();
      this.initRound();
      this.state = "PLAYING";
      this.hideOverlay();
      this.updateHud();
      this.addOfficeFeed("📋 Clocked in for shift. Minimizing browser tabs.");
    }

    startNextLevel() {
      this.level++;
      this.resetMaze();
      this.initRound();
      this.state = "PLAYING";
      this.hideOverlay();
      this.updateHud();
      this.sound.playLevelClear();
      this.addOfficeFeed(`🏆 Survived level ${this.level - 1}. Title changed to 'Senior Associate'.`);
    }

    initRound() {
      this.player = new Player(this, 13.5, 23);

      this.ghosts = [
        new Ghost(this, "MICROMANAGER", "#ff3366", 13.5, 11, { x: COLS - 2, y: 0 }, 0),
        new Ghost(this, "CALENDAR_BLOCKER", "#ff77aa", 13.5, 14, { x: 1, y: 0 }, 3.0),
        new Ghost(this, "INTERN", "#2ee0ff", 11.5, 14, { x: COLS - 1, y: ROWS - 1 }, 7.0),
        new Ghost(this, "HR_BOT", "#ff9933", 15.5, 14, { x: 0, y: ROWS - 1 }, 12.0),
      ];

      this.fruit = null;
      this.fruitLifeTimer = 0;
      this.frightenedTimer = 0;
      this.ghostsEatenInSurge = 0;
      this.frightenedDuration = Math.max(3.0, 8.5 - this.level * 0.7);
    }

    isWall(col, row, isGhost = false, ghostEaten = false) {
      if (col < 0 || col >= COLS) return false; // tunnels wrap
      if (row < 0 || row >= ROWS) return true;

      const cell = this.maze[row][col];
      if (cell === 1) return true;
      if (cell === 5) {
        return !(isGhost || ghostEaten);
      }
      if (cell === 4) {
        return !isGhost;
      }
      return false;
    }

    triggerConsultantMode() {
      this.frightenedTimer = this.frightenedDuration;
      this.ghostsEatenInSurge = 0;
      this.sound.playPowerPellet();

      this.ghosts.forEach((g) => {
        if (g.mode !== "EATEN") {
          g.setFrightened();
        }
      });

      this.addOfficeFeed("⭐ PROMOTED TO CONSULTANT! Billing $350/hr — Chase the managers!");
      this.spawnFloatText(this.player.x * this.tileSize, this.player.y * this.tileSize, "CONSULTANT!", "#ffd700");
    }

    spawnFruit() {
      const fruitIndex = Math.min(this.level - 1, FRUITS.length - 1);
      const fruitData = FRUITS[fruitIndex];
      this.fruit = {
        col: 13.5,
        row: 17,
        ...fruitData,
      };
      this.fruitLifeTimer = 9.0;
      this.addOfficeFeed(`🎁 ${fruitData.emoji} ${fruitData.name} appeared in the Breakroom!`);
    }

    eatFruit() {
      if (!this.fruit) return;
      const pts = this.fruit.pts;
      this.addScore(pts);
      this.sound.playEatBonus();
      this.spawnFloatText(this.fruit.col * this.tileSize, this.fruit.row * this.tileSize, `+${pts}`, "#00ffcc");
      this.addOfficeFeed(`😋 Ate ${this.fruit.name}! (+${pts} pts)`);
      this.fruit = null;
    }

    eatGhost(ghost) {
      this.ghostsEatenInSurge++;
      const multiplier = Math.pow(2, this.ghostsEatenInSurge);
      const pts = 100 * multiplier; // 200, 400, 800, 1600
      this.addScore(pts);
      this.sound.playEatGhost();

      ghost.setEaten();

      const names = {
        MICROMANAGER: "Micromanager",
        CALENDAR_BLOCKER: "Calendar Blocker",
        INTERN: "Intern",
        HR_BOT: "HR Bot"
      };

      this.spawnFloatText(ghost.x * this.tileSize, ghost.y * this.tileSize, `+$${pts}`, "#ffff00");
      this.addOfficeFeed(`💼 Invoiced ${names[ghost.type] || "Boss"} for $${pts} severance!`);
    }

    addScore(pts) {
      this.score += pts;
      if (this.score > this.bestScore) {
        this.bestScore = this.score;
        localStorage.setItem("quiet-quitting-best", this.bestScore.toString());
      }
      this.updateHud();
    }

    updateHud() {
      if (this.hudScore) this.hudScore.textContent = this.score.toLocaleString();
      if (this.hudBest) this.hudBest.textContent = this.bestScore.toLocaleString();
      if (this.hudLevel) this.hudLevel.textContent = this.level.toString();
      if (this.hudLives) {
        this.hudLives.innerHTML = "☕".repeat(Math.max(0, this.lives));
      }
      if (this.hudStatus) {
        if (this.frightenedTimer > 0) {
          this.hudStatus.textContent = `CONSULTANT (${this.frightenedTimer.toFixed(1)}s)`;
          this.hudStatus.className = "hud__status hud__status--consultant";
        } else {
          this.hudStatus.textContent = "QUIET QUITTING";
          this.hudStatus.className = "hud__status";
        }
      }
    }

    spawnFloatText(x, y, text, color) {
      this.popups.push({
        x: x + this.tileSize / 2,
        y: y,
        text: text,
        color: color || "#fff",
        life: 1.0,
        maxLife: 1.0,
      });
    }

    spawnCoffeeParticles(x, y, count = 12) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 80 + 20;
        this.particles.push({
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0.6 + Math.random() * 0.4,
          maxLife: 0.8,
          color: Math.random() > 0.4 ? "#8b4513" : "#d2b48c",
          size: Math.random() * 4 + 2,
        });
      }
    }

    handlePlayerDeath() {
      this.state = "DYING";
      this.lives--;
      this.sound.playDeath();
      this.spawnCoffeeParticles(this.player.x * this.tileSize, this.player.y * this.tileSize, 25);
      this.addOfficeFeed("🛑 Caught slacking! Placed on Performance Improvement Plan (PIP).");

      setTimeout(() => {
        if (this.lives > 0) {
          this.initRound();
          this.state = "PLAYING";
          this.updateHud();
        } else {
          this.state = "GAME_OVER";
          this.showOverlay(
            "💥 TERMINATED",
            `Your lack of synergy was noticed. You reached Level <strong>${this.level}</strong> with a final payout of <strong>$${this.score}</strong>.`,
            "Apply Again"
          );
          this.updateHud();
        }
      }, 1500);
    }

    checkLevelClear() {
      if (this.dotsLeft <= 0) {
        this.state = "LEVEL_CLEAR";
        this.sound.playLevelClear();
        this.addScore(1000 * this.level);
        setTimeout(() => {
          this.startNextLevel();
        }, 1200);
      }
    }

    // --- GAME LOOP ---
    loop(timestamp) {
      const dt = Math.min((timestamp - this.lastFrameTime) / 1000, 0.1);
      this.lastFrameTime = timestamp;

      this.update(dt);
      this.render();

      requestAnimationFrame((t) => this.loop(t));
    }

    update(dt) {
      this.globalTimer += dt;

      // Update Popups & Particles
      for (let i = this.popups.length - 1; i >= 0; i--) {
        const p = this.popups[i];
        p.life -= dt;
        p.y -= 25 * dt;
        if (p.life <= 0) this.popups.splice(i, 1);
      }

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 80 * dt;
        if (p.life <= 0) this.particles.splice(i, 1);
      }

      if (this.state !== "PLAYING") return;

      // Consultant Power Mode timer
      if (this.frightenedTimer > 0) {
        this.frightenedTimer -= dt;
        if (this.frightenedTimer <= 0) {
          this.frightenedTimer = 0;
          this.ghosts.forEach((g) => {
            if (g.mode === "FRIGHTENED") g.mode = "CHASE";
          });
          this.addOfficeFeed("⌛ Consultant contract expired. Back to hiding!");
        }
        this.updateHud();
      }

      // Fruit Spawner (at ~70% dots and ~30% dots)
      if (!this.fruit && (this.dotsLeft === Math.floor(this.totalDots * 0.7) || this.dotsLeft === Math.floor(this.totalDots * 0.3))) {
        this.spawnFruit();
      }

      if (this.fruit) {
        this.fruitLifeTimer -= dt;
        if (this.fruitLifeTimer <= 0) {
          this.fruit = null;
        }
      }

      // Update entities
      if (this.player) {
        this.player.update(dt);
      }

      this.ghosts.forEach((g) => g.update(dt));

      // Check Fruit Collision
      if (this.fruit && this.player) {
        const dist = Math.hypot(this.player.x - this.fruit.col, this.player.y - this.fruit.row);
        if (dist < 0.75) {
          this.eatFruit();
        }
      }

      // Check Ghost Collisions
      if (this.player) {
        for (const ghost of this.ghosts) {
          const dist = Math.hypot(this.player.x - ghost.x, this.player.y - ghost.y);
          if (dist < 0.7) {
            if (ghost.mode === "FRIGHTENED") {
              this.eatGhost(ghost);
            } else if (ghost.mode === "CHASE" || ghost.mode === "SCATTER") {
              this.handlePlayerDeath();
              break;
            }
          }
        }
      }
    }

    render() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      // 1. Draw Maze
      this.renderMaze();

      // 2. Draw Fruit
      if (this.fruit) {
        const fx = (this.fruit.col + 0.5) * this.tileSize;
        const fy = (this.fruit.row + 0.5) * this.tileSize;
        this.ctx.font = "20px sans-serif";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.fillText(this.fruit.emoji, fx, fy);
      }

      // 3. Draw Entities
      if (this.player && this.state !== "DYING") {
        this.player.render(this.ctx);
      }

      this.ghosts.forEach((g) => g.render(this.ctx));

      // 4. Draw Particles & Popups
      this.renderEffects();
    }

    renderMaze() {
      const ts = this.tileSize;
      const t = this.globalTimer;

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = this.maze[r][c];
          const x = c * ts;
          const y = r * ts;

          if (cell === 1) {
            // Cubicle Wall
            this.ctx.fillStyle = "#111625";
            this.ctx.fillRect(x, y, ts, ts);

            // Neon top-edge cubicle border
            this.ctx.strokeStyle = "#23dff2";
            this.ctx.lineWidth = 1.5;
            this.ctx.strokeRect(x + 1, y + 1, ts - 2, ts - 2);

            // Subtle inner partition accent
            this.ctx.fillStyle = "rgba(35, 223, 242, 0.08)";
            this.ctx.fillRect(x + 3, y + 3, ts - 6, ts - 6);
          } else if (cell === 5) {
            // Ghost Door (Security turnstile)
            this.ctx.strokeStyle = "#ff77aa";
            this.ctx.lineWidth = 3;
            this.ctx.beginPath();
            this.ctx.moveTo(x, y + ts / 2);
            this.ctx.lineTo(x + ts, y + ts / 2);
            this.ctx.stroke();
          } else if (cell === 2) {
            // Normal Dot (Paycheck coin / coffee bean)
            const cx = x + ts / 2;
            const cy = y + ts / 2;
            this.ctx.fillStyle = "#f7d924";
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
            this.ctx.fill();
          } else if (cell === 3) {
            // Consultant Power Badge (Energizer)
            const cx = x + ts / 2;
            const cy = y + ts / 2;
            const pulse = (Math.sin(t * 8) + 1) * 0.5;
            const radius = 7 + pulse * 2.5;

            this.ctx.fillStyle = "#ff007f";
            this.ctx.shadowColor = "#ff007f";
            this.ctx.shadowBlur = 8;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            this.ctx.fill();

            // Inner badge star
            this.ctx.fillStyle = "#fff";
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, radius * 0.45, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.shadowBlur = 0;
          }
        }
      }
    }

    renderEffects() {
      // Particles
      for (const p of this.particles) {
        this.ctx.fillStyle = p.color;
        this.ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        this.ctx.fill();
      }
      this.ctx.globalAlpha = 1.0;

      // Popups
      for (const pop of this.popups) {
        this.ctx.font = "bold 13px 'JetBrains Mono', monospace";
        this.ctx.fillStyle = pop.color;
        this.ctx.textAlign = "center";
        this.ctx.shadowColor = "#000";
        this.ctx.shadowBlur = 4;
        this.ctx.fillText(pop.text, pop.x, pop.y);
        this.ctx.shadowBlur = 0;
      }
    }
  }

  // --- PLAYER (The Quiet Quitter) ---
  class Player {
    constructor(game, col, row) {
      this.game = game;
      this.x = col;
      this.y = row;
      this.dir = DIRECTIONS.NONE;
      this.nextDir = DIRECTIONS.NONE;
      this.speed = 10.5;
      this.mouthAngle = 0.2;
      this.mouthDir = 1;
    }

    setNextDir(dir) {
      this.nextDir = dir;
      if (this.dir.x === -dir.x && this.dir.y === -dir.y && dir !== DIRECTIONS.NONE) {
        this.dir = dir;
      }
    }

    update(dt) {
      const speedMultiplier = this.game.frightenedTimer > 0 ? 1.2 : 1.0;
      const currentSpeed = this.speed * speedMultiplier;

      // Try turning if aligned with grid
      const isAlignedX = Math.abs(this.x - Math.round(this.x)) < 0.12;
      const isAlignedY = Math.abs(this.y - Math.round(this.y)) < 0.12;

      if (this.nextDir !== this.dir && isAlignedX && isAlignedY) {
        const nextCol = Math.round(this.x) + this.nextDir.x;
        const nextRow = Math.round(this.y) + this.nextDir.y;

        if (!this.game.isWall(nextCol, nextRow)) {
          this.x = Math.round(this.x);
          this.y = Math.round(this.y);
          this.dir = this.nextDir;
        }
      }

      // Move in current direction
      if (this.dir !== DIRECTIONS.NONE) {
        const nextX = this.x + this.dir.x * currentSpeed * dt;
        const nextY = this.y + this.dir.y * currentSpeed * dt;

        const targetCol = Math.round(nextX + this.dir.x * 0.45);
        const targetRow = Math.round(nextY + this.dir.y * 0.45);

        if (this.game.isWall(targetCol, targetRow)) {
          this.x = Math.round(this.x);
          this.y = Math.round(this.y);
          this.dir = DIRECTIONS.NONE;
        } else {
          this.x = nextX;
          this.y = nextY;
        }
      }

      // Handle Warp Tunnels
      if (this.x < -0.5) this.x = COLS - 0.5;
      if (this.x > COLS - 0.5) this.x = -0.5;

      // Mouth animation
      this.mouthAngle += this.mouthDir * dt * 8;
      if (this.mouthAngle > 0.45) {
        this.mouthAngle = 0.45;
        this.mouthDir = -1;
      } else if (this.mouthAngle < 0.05) {
        this.mouthAngle = 0.05;
        this.mouthDir = 1;
      }

      // Eat Pellets
      const currentCol = Math.round(this.x);
      const currentRow = Math.round(this.y);
      if (currentCol >= 0 && currentCol < COLS && currentRow >= 0 && currentRow < ROWS) {
        const cell = this.game.maze[currentRow][currentCol];
        if (cell === 2) {
          this.game.maze[currentRow][currentCol] = 0;
          this.game.dotsLeft--;
          this.game.addScore(10);
          this.game.sound.playChomp();
          this.game.checkLevelClear();
        } else if (cell === 3) {
          this.game.maze[currentRow][currentCol] = 0;
          this.game.dotsLeft--;
          this.game.addScore(50);
          this.game.triggerConsultantMode();
          this.game.checkLevelClear();
        }
      }
    }

    render(ctx) {
      const ts = this.game.tileSize;
      const px = (this.x + 0.5) * ts;
      const py = (this.y + 0.5) * ts;
      const r = ts * 0.44;

      ctx.save();
      ctx.translate(px, py);

      let angle = 0;
      if (this.dir === DIRECTIONS.RIGHT) angle = 0;
      else if (this.dir === DIRECTIONS.DOWN) angle = Math.PI * 0.5;
      else if (this.dir === DIRECTIONS.LEFT) angle = Math.PI;
      else if (this.dir === DIRECTIONS.UP) angle = -Math.PI * 0.5;
      ctx.rotate(angle);

      // Consultant Aura
      if (this.game.frightenedTimer > 0) {
        ctx.strokeStyle = "#ffd700";
        ctx.lineWidth = 3;
        ctx.shadowColor = "#ffd700";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Pac-Man Body (Golden/Yellow Worker)
      ctx.fillStyle = this.game.frightenedTimer > 0 ? "#ffd700" : "#ffea00";
      ctx.beginPath();
      ctx.arc(0, 0, r, this.mouthAngle * Math.PI, (2 - this.mouthAngle) * Math.PI, false);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fill();

      // Eye
      ctx.fillStyle = "#05070d";
      ctx.beginPath();
      ctx.arc(r * 0.15, -r * 0.5, r * 0.18, 0, Math.PI * 2);
      ctx.fill();

      // Headphones Arc (Blue band)
      ctx.strokeStyle = "#23dff2";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, r + 1.5, Math.PI * 0.9, Math.PI * 2.1);
      ctx.stroke();

      // Headphone Cup
      ctx.fillStyle = "#ff1490";
      ctx.fillRect(-r * 0.3, -r - 3, r * 0.6, 3);

      ctx.restore();
    }
  }

  // --- GHOST (The Office Bosses) ---
  class Ghost {
    constructor(game, type, color, startCol, startRow, scatterTarget, releaseDelay = 0) {
      this.game = game;
      this.type = type;
      this.color = color;
      this.startCol = startCol;
      this.startRow = startRow;
      this.scatterTarget = scatterTarget;
      this.releaseDelay = releaseDelay;

      this.x = startCol;
      this.y = startRow;
      this.dir = DIRECTIONS.UP;
      this.mode = "IN_HOUSE";
      this.speed = 9.0;
      this.houseTimer = releaseDelay;
    }

    setFrightened() {
      this.mode = "FRIGHTENED";
      this.dir = { x: -this.dir.x, y: -this.dir.y, name: "REV" };
    }

    setEaten() {
      this.mode = "EATEN";
    }

    update(dt) {
      if (this.mode === "IN_HOUSE") {
        this.houseTimer -= dt;
        this.y = this.startRow + Math.sin(this.game.globalTimer * 4) * 0.3;
        if (this.houseTimer <= 0) {
          this.mode = "CHASE";
          this.x = 13.5;
          this.y = 11.0;
          this.dir = DIRECTIONS.LEFT;
        }
        return;
      }

      let currentSpeed = this.speed;
      if (this.mode === "FRIGHTENED") {
        currentSpeed = this.speed * 0.6;
      } else if (this.mode === "EATEN") {
        currentSpeed = this.speed * 1.8;
      } else if (this.type === "MICROMANAGER" && this.game.dotsLeft < 20) {
        currentSpeed = this.speed * 1.15;
      }

      const nextX = this.x + this.dir.x * currentSpeed * dt;
      const nextY = this.y + this.dir.y * currentSpeed * dt;

      const passedCenterX = (this.dir.x > 0 && nextX >= Math.round(this.x) && this.x < Math.round(this.x)) ||
                            (this.dir.x < 0 && nextX <= Math.round(this.x) && this.x > Math.round(this.x));
      const passedCenterY = (this.dir.y > 0 && nextY >= Math.round(this.y) && this.y < Math.round(this.y)) ||
                            (this.dir.y < 0 && nextY <= Math.round(this.y) && this.y > Math.round(this.y));

      this.x = nextX;
      this.y = nextY;

      if (this.x < -0.5) this.x = COLS - 0.5;
      if (this.x > COLS - 0.5) this.x = -0.5;

      if (this.mode === "EATEN") {
        if (Math.abs(this.x - 13.5) < 0.5 && Math.abs(this.y - 11.0) < 0.5) {
          this.mode = "CHASE";
        }
      }

      if (passedCenterX || passedCenterY || Math.hypot(this.x - Math.round(this.x), this.y - Math.round(this.y)) < 0.05) {
        this.x = Math.round(this.x);
        this.y = Math.round(this.y);
        this.pickNextDirection();
      }
    }

    pickNextDirection() {
      const col = Math.round(this.x);
      const row = Math.round(this.y);

      let target = { x: 13, y: 14 };

      if (this.mode === "EATEN") {
        target = { x: 13, y: 11 };
      } else if (this.mode === "FRIGHTENED") {
        target = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
      } else if (this.mode === "SCATTER") {
        target = this.scatterTarget;
      } else {
        const player = this.game.player;
        if (!player) return;

        if (this.type === "MICROMANAGER") {
          target = { x: Math.round(player.x), y: Math.round(player.y) };
        } else if (this.type === "CALENDAR_BLOCKER") {
          target = {
            x: Math.round(player.x) + player.dir.x * 4,
            y: Math.round(player.y) + player.dir.y * 4,
          };
        } else if (this.type === "INTERN") {
          const blinky = this.game.ghosts[0];
          const pivotX = Math.round(player.x) + player.dir.x * 2;
          const pivotY = Math.round(player.y) + player.dir.y * 2;
          target = {
            x: pivotX + (pivotX - Math.round(blinky ? blinky.x : pivotX)),
            y: pivotY + (pivotY - Math.round(blinky ? blinky.y : pivotY)),
          };
        } else if (this.type === "HR_BOT") {
          const dist = Math.hypot(this.x - player.x, this.y - player.y);
          if (dist > 8) {
            target = { x: Math.round(player.x), y: Math.round(player.y) };
          } else {
            target = this.scatterTarget;
          }
        }
      }

      const possibleDirs = [DIRECTIONS.UP, DIRECTIONS.LEFT, DIRECTIONS.DOWN, DIRECTIONS.RIGHT].filter((d) => {
        if (d.x === -this.dir.x && d.y === -this.dir.y) return false;
        const nc = col + d.x;
        const nr = row + d.y;
        return !this.game.isWall(nc, nr, true, this.mode === "EATEN");
      });

      if (possibleDirs.length === 0) {
        this.dir = { x: -this.dir.x, y: -this.dir.y, name: "REV" };
        return;
      }

      let bestDir = possibleDirs[0];
      let bestDist = Infinity;

      for (const d of possibleDirs) {
        const nextCol = col + d.x;
        const nextRow = row + d.y;
        const dist = Math.hypot(nextCol - target.x, nextRow - target.y);
        if (dist < bestDist) {
          bestDist = dist;
          bestDir = d;
        }
      }

      this.dir = bestDir;
    }

    render(ctx) {
      const ts = this.game.tileSize;
      const gx = (this.x + 0.5) * ts;
      const gy = (this.y + 0.5) * ts;
      const r = ts * 0.44;

      ctx.save();
      ctx.translate(gx, gy);

      if (this.mode === "EATEN") {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(-r * 0.35, -r * 0.2, r * 0.28, 0, Math.PI * 2);
        ctx.arc(r * 0.35, -r * 0.2, r * 0.28, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#0044ff";
        const pupilDx = this.dir.x * 2;
        const pupilDy = this.dir.y * 2;
        ctx.beginPath();
        ctx.arc(-r * 0.35 + pupilDx, -r * 0.2 + pupilDy, r * 0.14, 0, Math.PI * 2);
        ctx.arc(r * 0.35 + pupilDx, -r * 0.2 + pupilDy, r * 0.14, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
        return;
      }

      let fillColor = this.color;
      if (this.mode === "FRIGHTENED") {
        const isExpiring = this.game.frightenedTimer < 2.5;
        const flash = Math.sin(this.game.globalTimer * 16) > 0;
        fillColor = isExpiring && flash ? "#ffffff" : "#1e40af";
      }

      ctx.fillStyle = fillColor;

      ctx.beginPath();
      ctx.arc(0, -r * 0.2, r, Math.PI, 0, false);
      ctx.lineTo(r, r * 0.8);

      const waveCount = 3;
      const waveWidth = (r * 2) / waveCount;
      for (let i = 0; i < waveCount; i++) {
        const startX = r - i * waveWidth;
        const endX = startX - waveWidth;
        const midX = (startX + endX) / 2;
        const bottomY = (i % 2 === 0 ? r * 0.6 : r * 1.0) + Math.sin(this.game.globalTimer * 10 + i) * 1.5;
        ctx.quadraticCurveTo(midX, bottomY, endX, r * 0.8);
      }

      ctx.closePath();
      ctx.fill();

      if (this.mode === "FRIGHTENED") {
        ctx.fillStyle = "#ffdddd";
        ctx.fillRect(-r * 0.4, -r * 0.3, r * 0.25, r * 0.25);
        ctx.fillRect(r * 0.15, -r * 0.3, r * 0.25, r * 0.25);

        ctx.strokeStyle = "#ff4444";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, r * 0.3);
        ctx.lineTo(-r * 0.2, r * 0.15);
        ctx.lineTo(0.1, r * 0.3);
        ctx.lineTo(r * 0.4, r * 0.15);
        ctx.stroke();
      } else {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(-r * 0.35, -r * 0.25, r * 0.26, 0, Math.PI * 2);
        ctx.arc(r * 0.35, -r * 0.25, r * 0.26, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#05070d";
        const pupilDx = this.dir.x * 2.5;
        const pupilDy = this.dir.y * 2.5;
        ctx.beginPath();
        ctx.arc(-r * 0.35 + pupilDx, -r * 0.25 + pupilDy, r * 0.14, 0, Math.PI * 2);
        ctx.arc(r * 0.35 + pupilDx, -r * 0.25 + pupilDy, r * 0.14, 0, Math.PI * 2);
        ctx.fill();

        if (this.type === "MICROMANAGER") {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(-r * 0.6, -r * 0.55);
          ctx.lineTo(-r * 0.1, -r * 0.35);
          ctx.moveTo(r * 0.6, -r * 0.55);
          ctx.lineTo(r * 0.1, -r * 0.35);
          ctx.stroke();

          ctx.fillStyle = "#ff0033";
          ctx.beginPath();
          ctx.moveTo(-2, r * 0.1);
          ctx.lineTo(2, r * 0.1);
          ctx.lineTo(4, r * 0.7);
          ctx.lineTo(0, r * 0.9);
          ctx.lineTo(-4, r * 0.7);
          ctx.closePath();
          ctx.fill();
        } else if (this.type === "CALENDAR_BLOCKER") {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(-r * 0.3, r * 0.15, r * 0.6, r * 0.45);
          ctx.fillStyle = "#ff1490";
          ctx.fillRect(-r * 0.2, r * 0.22, r * 0.4, r * 0.12);
        } else if (this.type === "INTERN") {
          ctx.strokeStyle = "#00ffff";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-r * 0.55, -r * 0.45, r * 0.4, r * 0.35);
          ctx.strokeRect(r * 0.15, -r * 0.45, r * 0.4, r * 0.35);
        } else if (this.type === "HR_BOT") {
          ctx.fillStyle = "#d2b48c";
          ctx.fillRect(-r * 0.25, r * 0.1, r * 0.5, r * 0.6);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(-r * 0.18, r * 0.2, r * 0.36, r * 0.4);
        }
      }

      ctx.restore();
    }
  }

  function boot() {
    if (!window.quietQuittingGame) {
      window.quietQuittingGame = new QuietQuittingGame();
    }
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
  }
})();
