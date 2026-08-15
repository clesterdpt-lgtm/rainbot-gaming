/**
 * Quiet Quitting - Rainbot Gaming
 * Satirical office maze. Pac-Man rules, cubicle-farm look.
 *
 * 8-bit office floor plan: beige carpet, fabric partitions, desks and
 * monitors, upright worker/boss sprites. Mechanics stay maze-chase.
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

  /* NES-ish office swatch. No neon cyan maze tubes. */
  const P = {
    carpet: "#b7a57a",
    carpetAlt: "#a89468",
    carpetLine: "#8f7d55",
    aisleShadow: "#8a7852",
    cubicle: "#6e7d70",
    cubicleDark: "#556358",
    cubicleLite: "#879488",
    trim: "#d4c6a3",
    trimDark: "#b3a37d",
    desk: "#8a5a2b",
    deskDark: "#6a4320",
    monitor: "#2b3340",
    screen: "#7ec87a",
    screenDim: "#3d6b42",
    plant: "#3f7a3a",
    plantDark: "#2c5a29",
    pot: "#8b4d2a",
    conference: "#cfc0a0",
    table: "#6b4634",
    tableLite: "#8a5e46",
    chair: "#4a5560",
    glass: "#9db8bc",
    glassLite: "#c5d6d8",
    elevator: "#5a6570",
    elevatorDark: "#3d4650",
    paper: "#f3ead4",
    ink: "#2d4a32",
    coffee: "#5a3318",
    mug: "#eee6d4",
    gold: "#d4a017",
    goldLite: "#f0c94d",
    skin: "#e6c29a",
    skinDark: "#c9a07a",
    hair: "#5a3a22",
    shirt: "#3d5c86",
    pants: "#2c3540",
    shoe: "#2a2018",
    collar: "#efe8d8",
    phone: "#1c2430",
    phoneGlow: "#7ec87a",
    shadow: "rgba(40, 32, 18, 0.28)",
    fluoro: "rgba(255, 248, 220, 0.04)",
  };

  function px(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  // --- MAIN GAME ENGINE ---
  class QuietQuittingGame {
    constructor() {
      this.canvas = document.getElementById("gameCanvas");
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext("2d");
      this.ctx.imageSmoothingEnabled = false;
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
        this.drawPerk(this.fruit);
      }

      // 3. Draw Entities (Player & Bosses)
      if (this.player && this.state !== "DYING") {
        this.player.render(this.ctx);
      }

      this.ghosts.forEach((g) => g.render(this.ctx));

      // 4. Draw Particles & Score Popups
      this.renderEffects();
    }

    isCubicle(row, col) {
      if (row < 0 || col < 0 || row >= ROWS || col >= COLS) return true;
      return this.maze[row][col] === 1;
    }

    drawPerk(fruit) {
      const ts = this.tileSize;
      const x = Math.round(fruit.col * ts);
      const y = Math.round(fruit.row * ts);
      const ctx = this.ctx;
      px(ctx, x + 4, y + 16, 16, 3, P.shadow);
      px(ctx, x + 5, y + 8, 14, 8, P.desk);
      px(ctx, x + 6, y + 9, 12, 2, P.deskDark);
      const kind = fruit.name;
      if (kind === "Free Pizza") {
        px(ctx, x + 8, y + 4, 8, 8, "#c45c2a");
        px(ctx, x + 9, y + 5, 6, 6, "#e8c86a");
        px(ctx, x + 10, y + 6, 2, 2, "#b83a2a");
        px(ctx, x + 13, y + 8, 2, 2, "#b83a2a");
      } else if (kind === "Cold Brew") {
        px(ctx, x + 9, y + 3, 6, 8, P.mug);
        px(ctx, x + 10, y + 4, 4, 5, P.coffee);
        px(ctx, x + 15, y + 5, 2, 3, P.mug);
      } else if (kind === "Standing Desk") {
        px(ctx, x + 7, y + 5, 10, 2, P.desk);
        px(ctx, x + 8, y + 7, 2, 5, P.deskDark);
        px(ctx, x + 14, y + 7, 2, 5, P.deskDark);
      } else if (kind === "Stock Options") {
        px(ctx, x + 8, y + 4, 8, 8, P.paper);
        px(ctx, x + 9, y + 9, 2, 2, P.ink);
        px(ctx, x + 11, y + 7, 2, 4, P.ink);
        px(ctx, x + 13, y + 5, 2, 6, "#2f6b3a");
      } else {
        px(ctx, x + 8, y + 3, 8, 10, P.gold);
        px(ctx, x + 9, y + 4, 6, 2, P.goldLite);
        px(ctx, x + 10, y + 7, 4, 4, P.paper);
      }
    }

    renderOfficeMap() {
      const ts = this.tileSize;
      const t = this.globalTimer;
      const ctx = this.ctx;
      ctx.imageSmoothingEnabled = false;

      for (let y = 0; y < this.canvas.height; y += 8) {
        for (let x = 0; x < this.canvas.width; x += 8) {
          ctx.fillStyle = ((x + y) / 8) % 2 === 0 ? P.carpet : P.carpetAlt;
          ctx.fillRect(x, y, 8, 8);
        }
      }
      ctx.fillStyle = P.carpetLine;
      for (let y = 0; y < this.canvas.height; y += 24) {
        ctx.fillRect(0, y, this.canvas.width, 1);
      }
      for (let x = 0; x < this.canvas.width; x += 24) {
        ctx.fillRect(x, 0, 1, this.canvas.height);
      }

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = this.maze[r][c];
          const x = c * ts;
          const y = r * ts;
          const n = this.isCubicle(r - 1, c);
          const s = this.isCubicle(r + 1, c);
          const e = this.isCubicle(r, c + 1);
          const w = this.isCubicle(r, c - 1);

          if (cell === 1) {
            px(ctx, x, y, ts, ts, P.cubicle);
            px(ctx, x + 2, y + 2, ts - 4, ts - 4, P.cubicleDark);
            if (!n) px(ctx, x, y, ts, 3, P.trim);
            if (!s) px(ctx, x, y + ts - 3, ts, 3, P.trimDark);
            if (!w) px(ctx, x, y, 3, ts, P.trim);
            if (!e) px(ctx, x + ts - 3, y, 3, ts, P.trimDark);

            if (!s) {
              px(ctx, x + 3, y + 10, ts - 6, 8, P.desk);
              px(ctx, x + 4, y + 11, ts - 8, 2, P.deskDark);
              if ((r + c) % 3 === 0) {
                px(ctx, x + 6, y + 4, 12, 8, P.monitor);
                px(ctx, x + 8, y + 6, 8, 4, Math.sin(t * 3 + c) > 0 ? P.screen : P.screenDim);
                px(ctx, x + 10, y + 12, 4, 3, P.deskDark);
              } else if ((r + c) % 3 === 1) {
                px(ctx, x + 7, y + 6, 10, 6, P.paper);
                px(ctx, x + 8, y + 7, 8, 1, P.ink);
                px(ctx, x + 8, y + 9, 6, 1, P.ink);
              }
            } else if (!n && (r + c) % 7 === 0) {
              px(ctx, x + 8, y + 4, 8, 6, P.plant);
              px(ctx, x + 10, y + 2, 4, 4, P.plantDark);
              px(ctx, x + 9, y + 10, 6, 4, P.pot);
            } else if (!w && (c + r) % 6 === 2) {
              px(ctx, x + 4, y + 6, 8, 12, P.chair);
              px(ctx, x + 5, y + 8, 6, 3, P.cubicleLite);
            }
          } else if (cell === 4) {
            px(ctx, x, y, ts, ts, P.conference);
            px(ctx, x, y, ts, 1, P.trimDark);
            px(ctx, x, y, 1, ts, P.trimDark);
            if (c >= 12 && c <= 16 && r >= 13 && r <= 14) {
              px(ctx, x + 2, y + 6, ts - 4, 10, P.table);
              px(ctx, x + 3, y + 7, ts - 6, 2, P.tableLite);
            }
            if ((c === 11 || c === 17) && (r === 13 || r === 14)) {
              px(ctx, x + 8, y + 10, 8, 8, P.chair);
            }
          } else if (cell === 5) {
            px(ctx, x, y + 8, ts, 8, P.glass);
            px(ctx, x, y + 8, ts, 2, P.glassLite);
            px(ctx, x + 10, y + 10, 4, 4, Math.sin(t * 6) > 0 ? "#c45c4a" : "#7a8a6a");
          } else if (cell === 6) {
            px(ctx, x + 4, y + 2, 16, 20, P.elevatorDark);
            px(ctx, x + 6, y + 4, 6, 16, P.elevator);
            px(ctx, x + 12, y + 4, 6, 16, P.elevator);
            px(ctx, x + 11, y + 4, 2, 16, P.elevatorDark);
            px(ctx, x + 8, y + 12, 2, 2, P.gold);
          } else if (cell === 2) {
            const cx = x + 8;
            const cy = y + 9;
            const kind = (r * 3 + c) % 4;
            if (kind === 0) {
              px(ctx, cx, cy, 8, 6, P.paper);
              px(ctx, cx + 1, cy + 1, 6, 1, P.ink);
              px(ctx, cx + 3, cy + 3, 2, 2, "#2f6b3a");
            } else if (kind === 1) {
              px(ctx, cx + 1, cy, 6, 7, P.mug);
              px(ctx, cx + 2, cy + 1, 4, 4, P.coffee);
              px(ctx, cx + 7, cy + 2, 2, 3, P.mug);
            } else if (kind === 2) {
              px(ctx, cx, cy, 8, 6, "#e8d36a");
              px(ctx, cx + 1, cy + 2, 6, 1, "#6a5420");
            } else {
              px(ctx, cx + 1, cy + 2, 7, 2, "#8a8f96");
              px(ctx, cx + 5, cy, 2, 6, "#8a8f96");
            }
          } else if (cell === 3) {
            const pulse = Math.sin(t * 6) > 0;
            px(ctx, x + 8, y + 4, 8, 10, pulse ? P.goldLite : P.gold);
            px(ctx, x + 9, y + 5, 6, 8, P.paper);
            px(ctx, x + 10, y + 6, 4, 3, P.skin);
            px(ctx, x + 10, y + 10, 4, 2, P.shirt);
            px(ctx, x + 11, y + 2, 2, 3, "#6a2424");
          } else if (cell === 0 || cell === 7) {
            if ((r + c) % 11 === 0) {
              px(ctx, x + 18, y + 2, 4, 6, P.aisleShadow);
            }
          }
        }
      }

      ctx.fillStyle = P.fluoro;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    renderEffects() {
      // Particles
      for (const p of this.particles) {
        this.ctx.fillStyle = p.color;
        this.ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        const s = Math.max(2, Math.round(p.size));
        this.ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
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
      const ox = Math.round((this.x + 0.5) * ts);
      const oy = Math.round((this.y + 0.5) * ts);
      const isConsultant = this.game.frightenedTimer > 0;
      const faceLeft = this.dir === DIRECTIONS.LEFT;
      const step = Math.sin(this.walkTimer) > 0 ? 1 : 0;

      ctx.save();
      ctx.translate(ox, oy);
      if (faceLeft) ctx.scale(-1, 1);
      ctx.imageSmoothingEnabled = false;

      px(ctx, -6, 9, 12, 2, P.shadow);

      if (isConsultant) {
        px(ctx, -9, -12, 18, 2, P.gold);
        px(ctx, -8, -11, 16, 1, P.goldLite);
      }

      px(ctx, -5 + step, 6, 4, 3, P.shoe);
      px(ctx, 1 - step, 6, 4, 3, P.shoe);
      px(ctx, -4, 1, 3, 6, P.pants);
      px(ctx, 1, 1, 3, 6, P.pants);

      px(ctx, -5, -5, 10, 8, isConsultant ? "#1e2430" : P.shirt);
      px(ctx, -1, -5, 2, 4, P.collar);

      px(ctx, -4, -12, 8, 7, P.skin);
      px(ctx, -4, -14, 8, 3, P.hair);
      px(ctx, -5, -12, 2, 3, P.hair);
      px(ctx, 1, -10, 2, 2, "#2a2018");

      px(ctx, -6, -11, 2, 4, "#2c3a4a");
      px(ctx, 4, -11, 2, 4, "#2c3a4a");
      px(ctx, -5, -14, 10, 2, "#2c3a4a");

      if (isConsultant) {
        px(ctx, 5, -4, 6, 5, P.gold);
        px(ctx, 6, -3, 4, 3, P.goldLite);
      } else {
        px(ctx, 5, -3, 5, 5, P.mug);
        px(ctx, 6, -2, 3, 3, P.coffee);
        if (Math.sin(this.game.globalTimer * 8) > 0) px(ctx, 7, -6, 1, 2, P.collar);
      }

      px(ctx, 5, 2, 4, 4, P.phone);
      px(ctx, 6, 3, 2, 2, P.phoneGlow);

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
      const ox = Math.round((this.x + 0.5) * ts);
      const oy = Math.round((this.y + 0.5) * ts);
      const faceLeft = this.dir === DIRECTIONS.LEFT;
      const step = Math.sin(this.walkTimer) > 0 ? 1 : 0;

      ctx.save();
      ctx.translate(ox, oy);
      if (faceLeft) ctx.scale(-1, 1);
      ctx.imageSmoothingEnabled = false;

      if (this.mode === "EATEN") {
        px(ctx, -6 + step, 6, 5, 3, P.shoe);
        px(ctx, 1 - step, 6, 5, 3, P.shoe);
        ctx.restore();
        return;
      }

      const isFrightened = this.mode === "FRIGHTENED";
      const isExpiring = this.game.frightenedTimer < 2.5;
      const flash = Math.sin(this.game.globalTimer * 14) > 0;
      let suit = this.color;
      if (isFrightened) suit = isExpiring && flash ? "#efe8d8" : "#5a6a8a";

      px(ctx, -6, 9, 12, 2, P.shadow);
      px(ctx, -5 + step, 6, 4, 3, P.shoe);
      px(ctx, 1 - step, 6, 4, 3, P.shoe);
      px(ctx, -4, 1, 3, 6, "#2a2430");
      px(ctx, 1, 1, 3, 6, "#2a2430");
      px(ctx, -5, -5, 10, 8, suit);
      px(ctx, -1, -4, 2, 5, isFrightened ? P.paper : "#7a1f1f");

      px(ctx, -4, -12, 8, 7, isFrightened ? "#c9d4dc" : P.skin);
      px(ctx, 1, -10, 2, 2, "#2a2018");

      if (isFrightened) {
        px(ctx, 5, -14, 6, 4, P.paper);
        px(ctx, 5, -10, 1, 5, P.chair);
        px(ctx, -6, -8, 2, 2, "#8ab4c8");
      } else if (this.type === "MICROMANAGER") {
        px(ctx, -4, -14, 8, 2, "#4a2e18");
        px(ctx, -5, -12, 2, 3, "#4a2e18");
        px(ctx, 5, -6, 5, 4, P.phone);
        px(ctx, 6, -5, 3, 2, "#c45c4a");
      } else if (this.type === "CALENDAR_BLOCKER") {
        px(ctx, -5, -14, 10, 4, "#d4b45a");
        px(ctx, -5, -11, 2, 3, "#d4b45a");
        px(ctx, 5, -5, 6, 5, P.paper);
        px(ctx, 6, -4, 4, 3, "#c45a7a");
      } else if (this.type === "INTERN") {
        px(ctx, -5, -15, 10, 4, "#3d6b62");
        px(ctx, 3, -14, 5, 2, "#3d6b62");
        px(ctx, 5, 2, 4, 5, "#3f7a3a");
        px(ctx, 6, 3, 2, 3, "#7ec87a");
      } else if (this.type === "HR_BOT") {
        px(ctx, -4, -14, 8, 3, "#6a7080");
        px(ctx, -2, -16, 4, 3, "#6a7080");
        px(ctx, 5, -5, 6, 6, "#e8d36a");
        px(ctx, 7, -3, 2, 2, "#c45c4a");
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
