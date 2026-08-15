/**
 * Quiet Quitting - Rainbot Gaming
 * Satirical Corporate Pac-Man Maze Chaser
 *
 * Full thematic visual overhaul: Office cubicle floor plan, custom office worker sprite,
 * 4 distinct corporate bosses, paycheck/coffee collectibles, consultant surge mode,
 * and rock-solid mobile touch/swipe controls.
 */

(function () {
  "use strict";

  // --- PROCEDURAL AUDIO SYNTHESIZER ---
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
      const freq = this.lastChompTone === 0 ? 320 : 420;

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + 0.07);

      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.07);
    }

    playPowerPellet() {
      if (this.muted) return;
      this.init();
      if (!this.ctx || this.ctx.state !== "running") return;

      const now = this.ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const t = now + i * 0.06;

        osc.type = "square";
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.14, t);
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
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(1400, now + 0.22);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.22);
    }

    playEatBonus() {
      if (this.muted) return;
      this.init();
      if (!this.ctx || this.ctx.state !== "running") return;

      const now = this.ctx.currentTime;
      [440, 554.37, 659.25, 880, 1108.73].forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const t = now + i * 0.04;

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(t);
        osc.stop(t + 0.14);
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
      osc.frequency.setValueAtTime(550, now);
      osc.frequency.linearRampToValueAtTime(70, now + 0.65);

      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.65);
    }

    playLevelClear() {
      if (this.muted) return;
      this.init();
      if (!this.ctx || this.ctx.state !== "running") return;

      const notes = [
        { f: 523.25, d: 0.08 },
        { f: 659.25, d: 0.08 },
        { f: 783.99, d: 0.08 },
        { f: 1046.5, d: 0.2 },
        { f: 880.0, d: 0.08 },
        { f: 1046.5, d: 0.35 }
      ];

      let t = this.ctx.currentTime;
      notes.forEach((n) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = "square";
        osc.frequency.setValueAtTime(n.f, t);
        gain.gain.setValueAtTime(0.16, t);
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
  // 28 cols x 31 rows
  // 1: Cubicle Wall, 2: Paycheck/Coffee, 3: Consultant Lanyard Badge,
  // 0: Office Hallway, 4: Management Pen / Breakroom, 5: Security Gate, 6: Smoke Break Warp Tunnel, 7: Fruit Desk
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

  // --- MAIN GAME ENGINE ---
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
      // 1. Keyboard Controls
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

      // 2. Direct On-Screen Touch Controls (Mobile D-Pad)
      const bindDirButton = (btn) => {
        const triggerDir = (e) => {
          if (e.cancelable) e.preventDefault();
          this.sound.init();
          if (this.state === "INIT") {
            this.startNewGame();
          }
          if (!this.player) return;
          const dir = btn.getAttribute("data-mobile-dir");
          if (dir === "up") this.player.setNextDir(DIRECTIONS.UP);
          if (dir === "down") this.player.setNextDir(DIRECTIONS.DOWN);
          if (dir === "left") this.player.setNextDir(DIRECTIONS.LEFT);
          if (dir === "right") this.player.setNextDir(DIRECTIONS.RIGHT);
        };

        btn.addEventListener("pointerdown", triggerDir);
        btn.addEventListener("touchstart", triggerDir, { passive: false });
        btn.addEventListener("click", triggerDir);
      };

      document.querySelectorAll("[data-mobile-dir]").forEach(bindDirButton);

      // 3. Fluid Canvas Touch Swipe & Drag & Tap Controls
      let touchActive = false;
      let startX = 0;
      let startY = 0;

      const handleTouchStart = (clientX, clientY) => {
        this.sound.init();
        if (this.state === "INIT") {
          this.startNewGame();
          return;
        }
        touchActive = true;
        startX = clientX;
        startY = clientY;
      };

      const handleTouchMove = (clientX, clientY) => {
        if (!touchActive || !this.player) return;
        const dx = clientX - startX;
        const dy = clientY - startY;
        const threshold = 18; // responsive drag threshold

        if (Math.hypot(dx, dy) >= threshold) {
          if (Math.abs(dx) > Math.abs(dy)) {
            this.player.setNextDir(dx > 0 ? DIRECTIONS.RIGHT : DIRECTIONS.LEFT);
          } else {
            this.player.setNextDir(dy > 0 ? DIRECTIONS.DOWN : DIRECTIONS.UP);
          }
          // Reset anchor for fluid continuous steering
          startX = clientX;
          startY = clientY;
        }
      };

      const handleTouchEnd = (clientX, clientY) => {
        if (!touchActive) return;
        touchActive = false;

        // If tap without significant drag, steer towards tapped quadrant relative to player
        if (this.player && startX && startY) {
          const rect = this.canvas.getBoundingClientRect();
          const tapCanvasX = (clientX - rect.left) * (this.canvas.width / rect.width);
          const tapCanvasY = (clientY - rect.top) * (this.canvas.height / rect.height);
          const playerCanvasX = (this.player.x + 0.5) * this.tileSize;
          const playerCanvasY = (this.player.y + 0.5) * this.tileSize;

          const dx = tapCanvasX - playerCanvasX;
          const dy = tapCanvasY - playerCanvasY;

          if (Math.abs(dx) > Math.abs(dy)) {
            this.player.setNextDir(dx > 0 ? DIRECTIONS.RIGHT : DIRECTIONS.LEFT);
          } else {
            this.player.setNextDir(dy > 0 ? DIRECTIONS.DOWN : DIRECTIONS.UP);
          }
        }
      };

      // Pointer Events on Canvas
      this.canvas.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        handleTouchStart(e.clientX, e.clientY);
      });
      window.addEventListener("pointermove", (e) => {
        handleTouchMove(e.clientX, e.clientY);
      });
      window.addEventListener("pointerup", (e) => {
        handleTouchEnd(e.clientX, e.clientY);
      });

      // Touch fallback for older webviews
      this.canvas.addEventListener("touchstart", (e) => {
        if (!e.touches[0]) return;
        e.preventDefault();
        handleTouchStart(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: false });

      this.canvas.addEventListener("touchmove", (e) => {
        if (!e.touches[0]) return;
        e.preventDefault();
        handleTouchMove(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: false });

      this.canvas.addEventListener("touchend", (e) => {
        if (!e.changedTouches[0]) return;
        e.preventDefault();
        handleTouchEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      }, { passive: false });

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
        this.showOverlay("⏸️ BREAK TIME (PAUSED)", "Slack status set to 'Focus Time'. Press Resume to keep dodging syncs.", "Resume Shift");
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
        "Navigate the cubicle maze, collect paycheck envelopes, and avoid managers trying to assign extra work.<br><br>" +
        "Grab the <strong>$350/hr Consultant Badge</strong> to bill the bosses for severance!<br><br>" +
        "<strong>Controls:</strong> Touch swipe / On-screen D-Pad or <kbd>WASD</kbd> / <kbd>Arrows</kbd>.",
        "Clock In"
      );
    }

    showOverlay(title, sub, btnText) {
      if (this.overlayTitle) this.overlayTitle.innerHTML = title;
      if (this.overlaySub) this.overlaySub.innerHTML = sub;
      if (this.btnPrimary) this.btnPrimary.textContent = btnText;
      if (this.overlayScore) this.overlayScore.innerHTML = `Payout: <strong>$${this.score}</strong> · Best Record: <strong>$${this.bestScore}</strong>`;
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
      this.addOfficeFeed("📋 Clocked in. Minimized browser, opened fake spreadsheet.");
    }

    startNextLevel() {
      this.level++;
      this.resetMaze();
      this.initRound();
      this.state = "PLAYING";
      this.hideOverlay();
      this.updateHud();
      this.sound.playLevelClear();
      this.addOfficeFeed(`📈 Shift survived! Promoted to Level ${this.level}. More syncs inbound!`);
    }

    initRound() {
      this.player = new Player(this, 13.5, 23);

      this.ghosts = [
        new Ghost(this, "MICROMANAGER", "#ff3344", 13.5, 11, { x: COLS - 2, y: 0 }, 0),
        new Ghost(this, "CALENDAR_BLOCKER", "#ff66aa", 13.5, 14, { x: 1, y: 0 }, 3.0),
        new Ghost(this, "INTERN", "#00d4ff", 11.5, 14, { x: COLS - 1, y: ROWS - 1 }, 7.0),
        new Ghost(this, "HR_BOT", "#ff9922", 15.5, 14, { x: 0, y: ROWS - 1 }, 12.0),
      ];

      this.fruit = null;
      this.fruitLifeTimer = 0;
      this.frightenedTimer = 0;
      this.ghostsEatenInSurge = 0;
      this.frightenedDuration = Math.max(3.0, 8.5 - this.level * 0.7);
    }

    isWall(col, row, isGhost = false, ghostEaten = false) {
      if (col < 0 || col >= COLS) return false;
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

      this.addOfficeFeed("⭐ PROMOTED TO $350/HR CONSULTANT! Bill the managers for severance!");
      this.spawnFloatText(this.player.x * this.tileSize, this.player.y * this.tileSize, "CONSULTANT SURGE!", "#ffd700");
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
      this.addOfficeFeed(`🎁 ${fruitData.emoji} ${fruitData.name} in the Breakroom!`);
    }

    eatFruit() {
      if (!this.fruit) return;
      const pts = this.fruit.pts;
      this.addScore(pts);
      this.sound.playEatBonus();
      this.spawnFloatText(this.fruit.col * this.tileSize, this.fruit.row * this.tileSize, `+$${pts}`, "#00ffcc");
      this.addOfficeFeed(`😋 Grabbed ${this.fruit.name}! (+$${pts})`);
      this.fruit = null;
    }

    eatGhost(ghost) {
      this.ghostsEatenInSurge++;
      const multiplier = Math.pow(2, this.ghostsEatenInSurge);
      const pts = 100 * multiplier; // 200, 400, 800, 1600
      this.addScore(pts);
      this.sound.playEatGhost();

      ghost.setEaten();

      const titles = {
        MICROMANAGER: "Micromanager",
        CALENDAR_BLOCKER: "Calendar Blocker",
        INTERN: "Intern",
        HR_BOT: "HR Bot"
      };

      this.spawnFloatText(ghost.x * this.tileSize, ghost.y * this.tileSize, `+$${pts} INVOICED`, "#ffd700");
      this.addOfficeFeed(`💼 Billed ${titles[ghost.type] || "Boss"} $${pts} severance!`);
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
      if (this.hudScore) this.hudScore.textContent = `$${this.score.toLocaleString()}`;
      if (this.hudBest) this.hudBest.textContent = `$${this.bestScore.toLocaleString()}`;
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
        life: 1.1,
        maxLife: 1.1,
      });
    }

    spawnCoffeeParticles(x, y, count = 14) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 90 + 25;
        this.particles.push({
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0.6 + Math.random() * 0.4,
          maxLife: 0.8,
          color: Math.random() > 0.4 ? "#78350f" : "#d97706",
          size: Math.random() * 4 + 2,
        });
      }
    }

    handlePlayerDeath() {
      this.state = "DYING";
      this.lives--;
      this.sound.playDeath();
      this.spawnCoffeeParticles(this.player.x * this.tileSize, this.player.y * this.tileSize, 28);
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
            `Your lack of synergy was noticed. You survived to Level <strong>${this.level}</strong> with a total payout of <strong>$${this.score.toLocaleString()}</strong>.`,
            "Apply Again"
          );
          this.updateHud();
        }
      }, 1400);
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
        p.y -= 24 * dt;
        if (p.life <= 0) this.popups.splice(i, 1);
      }

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 70 * dt;
        if (p.life <= 0) this.particles.splice(i, 1);
      }

      if (this.state !== "PLAYING") return;

      // Consultant Timer
      if (this.frightenedTimer > 0) {
        this.frightenedTimer -= dt;
        if (this.frightenedTimer <= 0) {
          this.frightenedTimer = 0;
          this.ghosts.forEach((g) => {
            if (g.mode === "FRIGHTENED") g.mode = "CHASE";
          });
          this.addOfficeFeed("⌛ Consultant billing expired. Back to pretending to type!");
        }
        this.updateHud();
      }

      // Fruit Spawner
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

      // 1. Draw Office Carpet & Maze
      this.renderOfficeMap();

      // 2. Draw Breakroom Bonus Fruit
      if (this.fruit) {
        const fx = (this.fruit.col + 0.5) * this.tileSize;
        const fy = (this.fruit.row + 0.5) * this.tileSize;

        // Desk plate
        this.ctx.fillStyle = "rgba(0, 240, 255, 0.2)";
        this.ctx.beginPath();
        this.ctx.arc(fx, fy, 14, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.font = "18px sans-serif";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.fillText(this.fruit.emoji, fx, fy);
      }

      // 3. Draw Entities (Player & Bosses)
      if (this.player && this.state !== "DYING") {
        this.player.render(this.ctx);
      }

      this.ghosts.forEach((g) => g.render(this.ctx));

      // 4. Draw Particles & Score Popups
      this.renderEffects();
    }

    renderOfficeMap() {
      const ts = this.tileSize;
      const t = this.globalTimer;

      // Dark Commercial Office Carpet base
      this.ctx.fillStyle = "#0a0e1a";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      // Micro carpet grid pattern
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.015)";
      for (let y = 0; y < this.canvas.height; y += 8) {
        this.ctx.fillRect(0, y, this.canvas.width, 1);
      }

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = this.maze[r][c];
          const x = c * ts;
          const y = r * ts;

          if (cell === 1) {
            // --- CUBICLE PARTITION WALL ---
            // Wall body
            this.ctx.fillStyle = "#162036";
            this.ctx.fillRect(x, y, ts, ts);

            // Fabric panel inlay
            this.ctx.fillStyle = "#1e293b";
            this.ctx.fillRect(x + 2, y + 2, ts - 4, ts - 4);

            // Top aluminum / cyan trim
            this.ctx.strokeStyle = "#38bdf8";
            this.ctx.lineWidth = 1.2;
            this.ctx.strokeRect(x + 1, y + 1, ts - 2, ts - 2);

            // Corner desk computer monitors on select wall clusters
            if ((r + c) % 5 === 0) {
              this.ctx.fillStyle = "#0f172a";
              this.ctx.fillRect(x + 4, y + 4, ts - 8, ts - 8);
              this.ctx.fillStyle = "#22d3ee";
              this.ctx.fillRect(x + 6, y + 6, ts - 12, 4); // glowing screen
            }
          } else if (cell === 4) {
            // --- MANAGEMENT BREAKROOM PEN ---
            this.ctx.fillStyle = "#1c1917";
            this.ctx.fillRect(x, y, ts, ts);
            // Tile grid
            this.ctx.strokeStyle = "rgba(217, 119, 6, 0.15)";
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(x, y, ts, ts);
          } else if (cell === 5) {
            // --- SECURITY KEYCARD TURNSTILE GATE ---
            this.ctx.strokeStyle = "#f43f5e";
            this.ctx.lineWidth = 2.5;
            this.ctx.beginPath();
            this.ctx.moveTo(x, y + ts / 2);
            this.ctx.lineTo(x + ts, y + ts / 2);
            this.ctx.stroke();

            // Blinking laser status
            this.ctx.fillStyle = Math.sin(t * 8) > 0 ? "#f43f5e" : "#fda4af";
            this.ctx.beginPath();
            this.ctx.arc(x + ts / 2, y + ts / 2, 2.5, 0, Math.PI * 2);
            this.ctx.fill();
          } else if (cell === 6) {
            // --- SMOKE BREAK WARP TUNNEL ---
            this.ctx.fillStyle = "#059669";
            this.ctx.font = "bold 9px 'JetBrains Mono', monospace";
            this.ctx.textAlign = "center";
            this.ctx.textBaseline = "middle";
            this.ctx.fillText("EXIT", x + ts / 2, y + ts / 2);
          } else if (cell === 2) {
            // --- PAYCHECK ENVELOPE / COFFEE DOTS ---
            const cx = x + ts / 2;
            const cy = y + ts / 2;

            if ((r + c) % 2 === 0) {
              // Miniature Paycheck Envelope ✉️
              this.ctx.fillStyle = "#f8fafc";
              this.ctx.fillRect(cx - 4, cy - 3, 8, 6);
              this.ctx.strokeStyle = "#16a34a";
              this.ctx.lineWidth = 1;
              this.ctx.strokeRect(cx - 4, cy - 3, 8, 6);
              this.ctx.fillStyle = "#15803d";
              this.ctx.fillRect(cx - 1, cy - 1.5, 2, 3);
            } else {
              // Miniature Coffee Cup ☕
              this.ctx.fillStyle = "#ffffff";
              this.ctx.fillRect(cx - 3, cy - 3, 6, 6);
              this.ctx.fillStyle = "#78350f";
              this.ctx.fillRect(cx - 2, cy - 2, 4, 3); // coffee liquid
              this.ctx.strokeStyle = "#cbd5e1";
              this.ctx.lineWidth = 1;
              this.ctx.strokeRect(cx - 3, cy - 3, 6, 6);
            }
          } else if (cell === 3) {
            // --- CONSULTANT VIP LANYARD BADGE (POWER PELLET) ---
            const cx = x + ts / 2;
            const cy = y + ts / 2;
            const pulse = (Math.sin(t * 8) + 1) * 0.5;

            // Radiant golden aura
            this.ctx.fillStyle = "rgba(250, 204, 21, 0.25)";
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, 9 + pulse * 3, 0, Math.PI * 2);
            this.ctx.fill();

            // VIP Lanyard Badge
            this.ctx.fillStyle = "#f59e0b";
            this.ctx.fillRect(cx - 6, cy - 6, 12, 12);
            this.ctx.strokeStyle = "#ffd700";
            this.ctx.lineWidth = 1.5;
            this.ctx.strokeRect(cx - 6, cy - 6, 12, 12);

            // Inner VIP star
            this.ctx.fillStyle = "#ffffff";
            this.ctx.font = "bold 9px sans-serif";
            this.ctx.textAlign = "center";
            this.ctx.textBaseline = "middle";
            this.ctx.fillText("★", cx, cy + 0.5);
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
        this.ctx.font = "bold 12px 'JetBrains Mono', monospace";
        this.ctx.fillStyle = pop.color;
        this.ctx.textAlign = "center";
        this.ctx.shadowColor = "#000";
        this.ctx.shadowBlur = 4;
        this.ctx.fillText(pop.text, pop.x, pop.y);
        this.ctx.shadowBlur = 0;
      }
    }
  }

  // --- THE QUIET QUITTER (OFFICE WORKER SPRITE) ---
  class Player {
    constructor(game, col, row) {
      this.game = game;
      this.x = col;
      this.y = row;
      this.dir = DIRECTIONS.NONE;
      this.nextDir = DIRECTIONS.NONE;
      this.speed = 10.5;
      this.walkTimer = 0;
    }

    setNextDir(dir) {
      this.nextDir = dir;
      if (this.dir.x === -dir.x && this.dir.y === -dir.y && dir !== DIRECTIONS.NONE) {
        this.dir = dir;
      }
    }

    update(dt) {
      const speedMultiplier = this.game.frightenedTimer > 0 ? 1.25 : 1.0;
      const currentSpeed = this.speed * speedMultiplier;

      // Try turning if aligned with grid
      const isAlignedX = Math.abs(this.x - Math.round(this.x)) < 0.14;
      const isAlignedY = Math.abs(this.y - Math.round(this.y)) < 0.14;

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
          this.walkTimer += dt * 12;
        }
      }

      // Handle Warp Tunnels
      if (this.x < -0.5) this.x = COLS - 0.5;
      if (this.x > COLS - 0.5) this.x = -0.5;

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
      const isConsultant = this.game.frightenedTimer > 0;

      ctx.save();
      ctx.translate(px, py);

      // Rotate based on direction
      let angle = 0;
      if (this.dir === DIRECTIONS.RIGHT) angle = 0;
      else if (this.dir === DIRECTIONS.DOWN) angle = Math.PI * 0.5;
      else if (this.dir === DIRECTIONS.LEFT) angle = Math.PI;
      else if (this.dir === DIRECTIONS.UP) angle = -Math.PI * 0.5;
      ctx.rotate(angle);

      // 1. Consultant Aura & Dollars
      if (isConsultant) {
        ctx.fillStyle = "rgba(250, 204, 21, 0.25)";
        ctx.beginPath();
        ctx.arc(0, 0, 16, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "#ffd700";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 14, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 2. Animated Feet (Walking)
      const legSwing = Math.sin(this.walkTimer) * 4;
      ctx.fillStyle = "#334155"; // shoes
      ctx.fillRect(-8 + legSwing, -10, 5, 3);
      ctx.fillRect(-8 - legSwing, 7, 5, 3);

      // 3. Worker Body (Blue Oxford Shirt / Executive Blazer)
      ctx.fillStyle = isConsultant ? "#0f172a" : "#2563eb";
      ctx.beginPath();
      ctx.roundRect(-8, -7, 16, 14, 4);
      ctx.fill();

      // White collar
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(2, -3);
      ctx.lineTo(6, 0);
      ctx.lineTo(2, 3);
      ctx.fill();

      // 4. Head & Messy Hair
      ctx.fillStyle = "#fbcfe8"; // Skin tone
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();

      // Messy Brown Hair
      ctx.fillStyle = "#5c3a21";
      ctx.beginPath();
      ctx.arc(-2, 0, 5.5, Math.PI * 0.5, Math.PI * 1.5);
      ctx.fill();

      // 5. Noise-Cancelling Headphones (Blue band + Pink earcups)
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 7.5, Math.PI * 0.8, Math.PI * 2.2);
      ctx.stroke();

      ctx.fillStyle = "#ec4899";
      ctx.fillRect(-2, -8.5, 4, 3);
      ctx.fillRect(-2, 5.5, 4, 3);

      // 6. Right Hand: Coffee Mug with Steam / Consultant Briefcase
      if (isConsultant) {
        // Golden Briefcase
        ctx.fillStyle = "#f59e0b";
        ctx.fillRect(4, -8, 6, 5);
        ctx.strokeStyle = "#ffd700";
        ctx.lineWidth = 1;
        ctx.strokeRect(4, -8, 6, 5);
      } else {
        // Coffee Mug with Steam
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(5, -6, 5, 5);
        ctx.fillStyle = "#78350f";
        ctx.fillRect(6, -5, 3, 3); // dark roast

        // Steam curl
        ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(7, -8);
        ctx.lineTo(8, -11 + Math.sin(this.game.globalTimer * 6) * 1.5);
        ctx.stroke();
      }

      // 7. Left Hand: Secret Phone Scroll
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(4, 3, 5, 4);
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(5, 4, 3, 2); // screen glow

      ctx.restore();
    }
  }

  // --- THE 4 CORPORATE BOSSES ---
  class Ghost {
    constructor(game, type, color, startCol, startRow, scatterTarget, releaseDelay = 0) {
      this.game = game;
      this.type = type; // MICROMANAGER, CALENDAR_BLOCKER, INTERN, HR_BOT
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
      this.walkTimer = 0;
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
      this.walkTimer += dt * 10;

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

      ctx.save();
      ctx.translate(gx, gy);

      // Rotate based on direction
      let angle = 0;
      if (this.dir === DIRECTIONS.RIGHT) angle = 0;
      else if (this.dir === DIRECTIONS.DOWN) angle = Math.PI * 0.5;
      else if (this.dir === DIRECTIONS.LEFT) angle = Math.PI;
      else if (this.dir === DIRECTIONS.UP) angle = -Math.PI * 0.5;
      ctx.rotate(angle);

      if (this.mode === "EATEN") {
        // --- EATEN: EMPTY WINGTIP SHOES FLEEING ---
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(-6, -6, 12, 4);
        ctx.fillRect(-6, 2, 12, 4);
        ctx.restore();
        return;
      }

      const isFrightened = this.mode === "FRIGHTENED";
      const isExpiring = this.game.frightenedTimer < 2.5;
      const flash = Math.sin(this.game.globalTimer * 16) > 0;

      // 1. Boss Suit / Body
      let bodyColor = this.color;
      if (isFrightened) {
        bodyColor = isExpiring && flash ? "#ffffff" : "#3b82f6";
      }

      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.roundRect(-8, -7, 16, 14, 4);
      ctx.fill();

      // 2. Boss Head & Face
      ctx.fillStyle = isFrightened ? "#bfdbfe" : "#fed7aa"; // pale blue if panicking, else skin
      ctx.beginPath();
      ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
      ctx.fill();

      if (isFrightened) {
        // Panicked Sweat Droplets & White Surrender Flag
        ctx.fillStyle = "#38bdf8";
        ctx.beginPath();
        ctx.arc(-4, -6, 1.5, 0, Math.PI * 2);
        ctx.arc(4, -6, 1.5, 0, Math.PI * 2);
        ctx.fill();

        // Surrender White Flag
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(4, -8, 6, 4);
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 1;
        ctx.strokeRect(4, -8, 6, 4);
      } else {
        // Specific Character Details
        if (this.type === "MICROMANAGER") {
          // Balding Hair + Red Angry Tie + Smartphone
          ctx.fillStyle = "#78350f";
          ctx.beginPath();
          ctx.arc(-2, 0, 5.5, Math.PI * 0.6, Math.PI * 1.4);
          ctx.fill();

          // Red Tie
          ctx.fillStyle = "#dc2626";
          ctx.beginPath();
          ctx.moveTo(3, -2);
          ctx.lineTo(8, 0);
          ctx.lineTo(3, 2);
          ctx.fill();

          // Angry Phone Pinging
          ctx.fillStyle = "#0f172a";
          ctx.fillRect(4, -7, 5, 4);
          ctx.fillStyle = "#ef4444";
          ctx.fillRect(5, -6, 3, 2); // red notification dot
        } else if (this.type === "CALENDAR_BLOCKER") {
          // Pink Bob Hair + 30m Calendar Tablet
          ctx.fillStyle = "#fde047"; // Blonde
          ctx.beginPath();
          ctx.arc(-1, 0, 5.8, Math.PI * 0.4, Math.PI * 1.6);
          ctx.fill();

          // Pink Calendar Tablet
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(3, -6, 6, 5);
          ctx.fillStyle = "#ec4899";
          ctx.fillRect(4, -5, 4, 3);
        } else if (this.type === "INTERN") {
          // Backwards Cyan Cap + Energy Drink
          ctx.fillStyle = "#06b6d4";
          ctx.beginPath();
          ctx.arc(-1, 0, 6, Math.PI * 0.4, Math.PI * 1.6);
          ctx.fill();

          // Neon Energy Drink Can
          ctx.fillStyle = "#10b981";
          ctx.fillRect(4, 3, 5, 4);
        } else if (this.type === "HR_BOT") {
          // Gray Bun Hair + Yellow Compliance Clipboard
          ctx.fillStyle = "#64748b";
          ctx.beginPath();
          ctx.arc(-3, 0, 4, 0, Math.PI * 2);
          ctx.fill();

          // Yellow Legal Clipboard
          ctx.fillStyle = "#fef08a";
          ctx.fillRect(3, -6, 6, 6);
          ctx.fillStyle = "#ef4444";
          ctx.fillRect(5, -4, 2, 2); // violation checkmark
        }
      }

      ctx.restore();
    }
  }

  // --- BOOTSTRAP ---
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
