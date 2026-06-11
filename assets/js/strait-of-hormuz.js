/* ============================================
   ESCAPE THE STRAIT — continuous dodger
   --------------------------------------------
   v3 — replaces the v1 Frogger engine.
   Real-time floaty steering, 3-hit hull, 5
   ad-powered upgrades, container ship boss,
   wipeout share card. 100% vanilla canvas.

   Drop-in replacement for the existing
   strait-of-hormuz.html. Uses the existing
   RB API (ads.js).  Public surface additions
   to RB: powerup keys are now an open set;
   the engine treats them as opaque strings.
   ============================================ */

(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  // =========================================================================
  // 1. TUNING — the numbers that make the game feel right
  // =========================================================================

  // World space
  const STRAIT_LENGTH = 6000;     // virtual units; the "distance" to open water
  const STRAIT_START  = 0;
  const STRAIT_END    = STRAIT_LENGTH;
  const VISIBLE_AHEAD = 600;      // how far ahead of the ship we render
  const VISIBLE_BEHIND = 80;      // trail length behind the ship
  const LANE_HALF_WIDTH = 220;    // total play width is +/- this from centerline

  // Ship — camera-relative controls (see updateShip for the new model).
  // thrust/strafe are ACCELERATIONS (units/sec²). maxSpeed is a velocity cap.
  // Tweak these if the ship feels too sluggish or too twitchy.
  const SHIP_BASE_THRUST    = 180;       // forward acceleration
  const SHIP_BASE_STRAFE    = 0.7;       // strafe is 70% as fast as forward
  const SHIP_BASE_MAX_SPEED = 160;       // top speed in world units/sec
  const SHIP_LINEAR_DAMP    = 0.85;      // 0 = ice, 1 = concrete. Lower = floatier.
  const SHIP_VISUAL_TURN    = 4.0;       // how fast the sprite rotates to match motion
  const SHIP_ANGULAR_DAMP   = 3.5;
  const SHIP_WOBBLE_AMP     = 1.6;       // degrees of roll at idle
  const SHIP_WOBBLE_FREQ    = 1.2;

  // Hull
  const HULL_MAX = 3;
  const IFRAME_DURATION = 1.4;            // seconds of invincibility after a hit
  const HORN_RADIUS = 90;                 // how far the horn pushes mines/subs
  const HORN_COOLDOWN = 0.6;

  // Phases (from the GDD)
  const PHASE_GATES = [0.25, 0.60, 0.90]; // ad-wall checkpoints
  const PHASE_DEFS = [
    { id: 1, name: "OPEN WATER",        width: 220, spawnEvery: 1.4, mix: { mine: 0.85, sub: 0.15, rocket: 0    }, fog: 0    },
    { id: 2, name: "TIGHTEN UP",        width: 180, spawnEvery: 1.0, mix: { mine: 0.55, sub: 0.30, rocket: 0.15 }, fog: 0    },
    { id: 3, name: "FOG OF HORMUZ",     width: 140, spawnEvery: 0.7, mix: { mine: 0.40, sub: 0.30, rocket: 0.30 }, fog: 0.35 },
    { id: 4, name: "NO REFUNDS",        width: 100, spawnEvery: 0.45,mix: { mine: 0.30, sub: 0.30, rocket: 0.40 }, fog: 0.55 },
    { id: 5, name: "THE BOSS WALL",     width: 240, spawnEvery: 999, mix: { mine: 0,    sub: 0,    rocket: 0    }, fog: 0    }, // boss only
  ];

  // Upgrades (5 funny/strong options)
  const UPGRADES = {
    turbo:        { name: "Turbo Propeller",        icon: "🌀", desc: "+60% speed/thrust for 90s. Held on with zip ties." },
    shield:       { name: "Soap-Bubble Shield",     icon: "🫧", desc: "Absorbs 1 hit. Bubbles float away when popped." },
    radar:        { name: "Rubber Duck Radar",      icon: "🦆", desc: "Highlights threats within 80u for 2 minutes. Quacks." },
    plating:      { name: "Duct Tape Plating",      icon: "🩹", desc: "+1 max hull this run. Squeaks on every turn." },
    fuzzyDice:    { name: "Fuzzy Dice of Fate",     icon: "🎲", desc: "50/50: 8s invincibility OR 2x score. You choose. Fate doesn't." }
  };

  // Wipeout captions
  const WIPEOUT_CAPTIONS = [
    "POV: you tried to outrun a rubber duck's prophecy",
    "I meant to do that. (The duck disagreed.)",
    "Current status: marine biodiversity",
    "Skill issue (this run was 70% luck anyway)",
    "The IOC sends their regards",
    "At least the explosion was on-brand",
    "Duck says: quack. Translation: you died.",
    "Have you considered a career in shore leave?",
    "Imagine if I'd watched that ad. (I didn't.)",
    "This is going on TikTok",
    "The mine face is now your wallpaper.",
    "Insurance claim filed. Deductible: one (1) tanker.",
    "Pro Captains wouldn't have died here. (Probably.)"
  ];

  const DEATH_QUOTES = [
    "Your cargo is now property of the IOC. Try again, Captain.",
    "The ducks have spoken. You have been judged.",
    "Insurance claim filed. Deductible: one (1) tanker."
  ];

  // =========================================================================
  // 2. STATE
  // =========================================================================

  const state = {
    running: false,
    paused: false,
    gameOver: false,
    started: false,

    score: 0,
    distance: 0,             // current z position along the strait
    phase: 1,

    // Ship (world-space)
    ship: {
      x: 0,                  // lateral
      y: 0,                  // forward (z)
      vx: 0,
      vy: 0,
      heading: 0,            // radians, 0 = +y
      angVel: 0,
      hull: HULL_MAX,
      maxHull: HULL_MAX,
      iframe: 0,
      hornCooldown: 0,
      flashing: 0,           // 0..1 i-frame alpha
      shipScale: 1,
      turboMult: 1,
      plated: false,
    },

    // Input
    input: { throttle: 0, steer: 0, horn: false },

    // World entities
    obstacles: [],           // {type, x, y, vx, vy, w, h, age, life, ...}
    pickups: [],             // oil barrels
    particles: [],
    splashes: [],            // water wake

    // Boss
    boss: null,              // {x, y, w, h, honks, required, resolved, mode}
    bossActive: false,
    bossArmed: false,        // true once the player has been told to honk

    // Phase gates
    phaseGatesHit: new Set(),
    inGate: false,

    // Upgrades active
    activeUpgrades: {},      // {kind: expiresAt}
    radarPings: [],          // recent radar detections

    // Camera
    cam: { shake: 0, flash: 0 },
    bannerText: null,
    bannerUntil: 0,

    // Frame buffer for wipeout share (last ~3s)
    ringBuffer: [],
    lastRingPush: 0,

    lastTime: 0,
  };

  // =========================================================================
  // 3. UTILITIES
  // =========================================================================

  const rand   = (a, b) => a + Math.random() * (b - a);
  const randi  = (a, b) => Math.floor(rand(a, b));
  const choice = (arr)  => arr[Math.floor(Math.random() * arr.length)];
  const clamp  = (v, a, b) => Math.max(a, Math.min(b, v));
  const TAU    = Math.PI * 2;

  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function dist2(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  function getPhase(progress01) {
    if (progress01 < 0.15) return PHASE_DEFS[0];
    if (progress01 < 0.40) return PHASE_DEFS[1];
    if (progress01 < 0.70) return PHASE_DEFS[2];
    if (progress01 < 0.92) return PHASE_DEFS[3];
    return PHASE_DEFS[4];
  }

  // =========================================================================
  // 4. INPUT
  // =========================================================================

  const keys = {};
  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (e.code === "Space" && state.running && !state.paused && !state.gameOver) {
      tryHonk();
    }
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });

  function readInput() {
    let throttle = 0, steer = 0;
    if (keys["KeyW"] || keys["ArrowUp"])    throttle += 1;
    if (keys["KeyS"] || keys["ArrowDown"])  throttle -= 1;
    if (keys["KeyA"] || keys["ArrowLeft"])  steer    -= 1;
    if (keys["KeyD"] || keys["ArrowRight"]) steer    += 1;
    state.input.throttle = throttle;
    state.input.steer = steer;
  }

  // On-screen d-pad (mobile) — replicates held inputs
  function setupTouch() {
    const dpad = document.getElementById("dpad");
    if (!dpad) return;
    const set = (ctrl, down) => {
      const code = ({
        thrust: "KeyW", brake: "KeyS",
        left:   "KeyA", right:  "KeyD",
        horn:   "Space"
      })[ctrl];
      if (!code) return;
      keys[code] = down;
      if (down && ctrl === "horn" && state.running && !state.paused && !state.gameOver) {
        tryHonk();
      }
    };
    dpad.querySelectorAll("button[data-ctrl]").forEach((btn) => {
      const ctrl = btn.dataset.ctrl;
      const press = (e) => { e.preventDefault(); set(ctrl, true); };
      const release = (e) => { e.preventDefault(); set(ctrl, false); };
      btn.addEventListener("touchstart", press, { passive: false });
      btn.addEventListener("touchend", release);
      btn.addEventListener("touchcancel", release);
      btn.addEventListener("mousedown", press);
      btn.addEventListener("mouseup", release);
      btn.addEventListener("mouseleave", release);
    });
  }

  // =========================================================================
  // 5. SHIP PHYSICS
  // -------------------------------------------------------------------------
  // Camera-relative controls (NOT ship-relative):
  //   W / Up    → +y world (forward, up the strait)
  //   S / Down  → -y world (brake / reverse)
  //   A / Left  → -x world (strafe left)
  //   D / Right → +x world (strafe right)
  // The ship's visual heading still rotates for the floaty look, but it does
  // NOT drive movement. This is the standard arcade-dodger model (think
  // Geometry Wars, Frogger remakes, etc.) — the player presses the direction
  // they want to GO, not the direction they want to FACE.
  // =========================================================================

  function updateShip(dt) {
    if (state.gameOver) return;
    const s = state.ship;

    // i-frame & shield flash
    if (s.iframe > 0) {
      s.iframe -= dt;
      s.flashing = (Math.sin(s.iframe * 30) + 1) * 0.5;
    } else { s.flashing = 0; }
    if (s.hornCooldown > 0) s.hornCooldown -= dt;

    // ---- ACCELERATION (camera-relative) ----
    // Steer is lateral, throttle is forward. Both produce direct velocity changes
    // so the ship responds instantly to input — but with linear damping it still
    // has that "floaty" feel because it takes a moment to accelerate and decelerate.
    const thrust = state.input.throttle * SHIP_BASE_THRUST * s.turboMult;
    const strafe = state.input.steer    * SHIP_BASE_THRUST * s.turboMult * SHIP_BASE_STRAFE;

    // y is "up the strait" — worldToScreen maps +y to -screen-y (forward = up on screen)
    // x is lateral. Positive x = right on screen, negative x = left.
    s.vy += thrust * dt;
    s.vx += strafe * dt;

    // ---- VISUAL HEADING (cosmetic float — does not affect movement) ----
    // Drift the visual heading toward the actual movement direction so the
    // ship appears to "turn into" the turn, but with a delay for comedy.
    let targetHeading = 0;
    if (Math.hypot(s.vx, s.vy) > 8) {
      targetHeading = Math.atan2(s.vx, s.vy); // 0 when moving +y, positive when moving right
    }
    // Smooth visual rotation toward target
    let dh = targetHeading - s.heading;
    // Wrap to shortest path
    while (dh >  Math.PI) dh -= TAU;
    while (dh < -Math.PI) dh += TAU;
    s.heading += dh * Math.min(1, dt * SHIP_VISUAL_TURN);

    // ---- LINEAR DAMPING (the "floaty" feel) ----
    // 0 = no damping (ice), 1 = full damping (concrete). 0.85 feels arcade-floaty.
    s.vx *= Math.max(0, 1 - SHIP_LINEAR_DAMP * dt);
    s.vy *= Math.max(0, 1 - SHIP_LINEAR_DAMP * dt);

    // ---- CAP SPEED ----
    const maxSpd = SHIP_BASE_MAX_SPEED * s.turboMult;
    const spd = Math.hypot(s.vx, s.vy);
    if (spd > maxSpd) {
      s.vx = (s.vx / spd) * maxSpd;
      s.vy = (s.vy / spd) * maxSpd;
    }

    // ---- MOVE ----
    s.x += s.vx * dt;
    s.y += s.vy * dt;

    // ---- CLAMP TO LANE ----
    if (s.x < -LANE_HALF_WIDTH) { s.x = -LANE_HALF_WIDTH; s.vx = 0; }
    if (s.x >  LANE_HALF_WIDTH) { s.x =  LANE_HALF_WIDTH; s.vx = 0; }
    // Don't let the player go backward past start
    if (s.y < 0) { s.y = 0; s.vy = Math.max(0, s.vy); }

    // ---- WAKE SPLASHES ----
    if (spd > 30 && Math.random() < 0.4) {
      state.splashes.push({
        x: s.x,
        y: s.y - 18,  // behind the ship (slightly back from y)
        life: 0.8, age: 0
      });
    }

    // ---- DISTANCE ----
    state.distance = Math.max(state.distance, s.y);
  }

  // =========================================================================
  // 6. HORN
  // =========================================================================

  function tryHonk() {
    const s = state.ship;
    if (s.hornCooldown > 0) return;
    s.hornCooldown = HORN_COOLDOWN;

    // SFX hook (omitted in the mock — RB.toast instead)
    // playHornSfx();

    // Boss interaction
    if (state.bossActive && state.boss && !state.boss.resolved) {
      const dx = s.x - state.boss.x;
      const dy = s.y - state.boss.y;
      if (Math.hypot(dx, dy) < 260) {
        state.boss.honks++;
        const el = document.getElementById("honk-count");
        if (el) el.textContent = `${state.boss.honks}/${state.boss.required}`;
        spawnParticles(state.boss.x, state.boss.y - 10, "#f7d716", 20, 220);
        if (state.boss.honks >= state.boss.required) {
          resolveBoss(true);
        }
      }
      return;
    }

    // Repel obstacles
    let cleared = 0;
    for (let i = state.obstacles.length - 1; i >= 0; i--) {
      const o = state.obstacles[i];
      const d = Math.hypot(s.x - o.x, s.y - o.y);
      if (d < HORN_RADIUS) {
        if (o.type === "mine") { o.dead = true; cleared++; spawnParticles(o.x, o.y, "#ff5c5c", 16, 180); }
        else if (o.type === "sub") { o.retreat = true; cleared++; spawnParticles(o.x, o.y, "#2ee0ff", 14, 160); }
        else if (o.type === "rocket") { o.dead = true; cleared++; spawnParticles(o.x, o.y, "#ff8c1a", 18, 200); }
      }
    }
    if (cleared > 0) RB.toast(`📯 HORN! cleared ${cleared} hazard${cleared === 1 ? "" : "s"}`, "good");
  }

  // =========================================================================
  // 7. OBSTACLES
  // =========================================================================

  function spawnObstacle() {
    const phase = getPhaseProgress().phase;
    const def = PHASE_DEFS[phase - 1];
    const r = Math.random();
    let type;
    if (r < def.mix.mine) type = "mine";
    else if (r < def.mix.mine + def.mix.sub) type = "sub";
    else type = "rocket";

    const s = state.ship;
    const aheadY = s.y + VISIBLE_AHEAD + rand(0, 60);
    const lateral = rand(-LANE_HALF_WIDTH, LANE_HALF_WIDTH);
    const o = { type, x: lateral, y: aheadY, age: 0, life: 18 };

    if (type === "mine") {
      o.vx = 0; o.vy = -40;     // approach speed (world units/sec) toward player
      o.phase_offset = Math.random() * TAU;
      o.bob_amp = 1.5;
      o.face = choice(["smug", "surprised", "offended"]);
      o.w = 22; o.h = 22;
    } else if (type === "sub") {
      o.dir = Math.random() < 0.5 ? 1 : -1;
      o.vx = o.dir * rand(35, 55);
      o.vy = -rand(25, 50);     // sub approaches the player, not just sits still
      o.tell = rand(0.6, 1.2);  // telegraph duration
      o.dove = false;
      o.w = 36; o.h = 18;
    } else if (type === "rocket") {
      o.vx = 0;
      o.vy = -rand(45, 65);     // slow-mo approach
      o.w = 8; o.h = 24;
      o.faceDropped = false;
    }

    state.obstacles.push(o);
  }

  function updateObstacles(dt) {
    for (let i = state.obstacles.length - 1; i >= 0; i--) {
      const o = state.obstacles[i];
      o.age += dt;

      if (o.type === "mine") {
        o.x += o.vx * dt;
        o.y += o.vy * dt + Math.sin((o.age + o.phase_offset) * 1.8) * o.bob_amp * dt * 4;
      } else if (o.type === "sub") {
        o.tell -= dt;
        if (o.tell <= 0 && !o.dove) o.dove = true;
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        // Mid-life switch direction (the "tariff" two-step)
        if (o.age > 2.0) o.vx = -o.vx;
        if (o.retreat) o.vy += 80 * dt; // dive away
      } else if (o.type === "rocket") {
        o.y += o.vy * dt;
        // Gentle homing
        const dx = state.ship.x - o.x;
        const targetVx = clamp(dx * 0.5, -25, 25);
        o.vx += (targetVx - o.vx) * dt * 1.2;
        o.x += o.vx * dt;
        // Face falls off at half life
        if (!o.faceDropped && o.age > 1.2) o.faceDropped = true;
      }

      // Despawn behind ship
      if (o.y < state.ship.y - VISIBLE_BEHIND) o.dead = true;
      if (o.y > state.ship.y + VISIBLE_AHEAD * 1.5) o.dead = true;
      if (o.x < -LANE_HALF_WIDTH - 80 || o.x > LANE_HALF_WIDTH + 80) o.dead = true;
      if (o.age > o.life) o.dead = true;

      if (o.dead) {
        if (o.type === "mine" && !o.silentKill && Math.random() < 0.4) {
          // Mine quip when destroyed by horn/age
          // (we keep it silent on passive despawn to avoid noise)
        }
        state.obstacles.splice(i, 1);
        continue;
      }

      // Collision with ship
      if (!state.ship.iframe && collideShipObstacle(o)) {
        takeHit(o);
      }
    }
  }

  function collideShipObstacle(o) {
    const s = state.ship;
    // Approximate the ship as a small circle for forgiving collision
    const dx = s.x - o.x, dy = s.y - o.y;
    const rShip = 12, rObs = Math.max(o.w, o.h) * 0.5;
    return (dx * dx + dy * dy) < (rShip + rObs) * (rShip + rObs);
  }

  // =========================================================================
  // 8. HULL DAMAGE
  // =========================================================================

  function takeHit(source) {
    const s = state.ship;
    // Shield check first
    if (hasShield()) {
      consumeShield();
      s.iframe = IFRAME_DURATION;
      return;
    }
    s.hull = Math.max(0, s.hull - 1);
    s.iframe = IFRAME_DURATION;
    state.cam.shake = 0.5;
    state.cam.flash = 0.4;
    spawnParticles(s.x, s.y, "#ff5c5c", 24, 240);
    spawnParticles(s.x, s.y, "#ff8c1a", 16, 200);

    let reason = source?.type === "mine" ? "Sentient Mine"
              : source?.type === "sub"  ? "Angry Merchant Sub"
              : source?.type === "rocket" ? "Friendly Fire from a Smiley Rocket"
              : "Mystery Explosion";
    state.lastCauseOfDeath = reason;

    if (s.hull <= 0) {
      wipeout();
    } else {
      const msg = source?.type === "mine" ? "💥 Mine hit — " + s.hull + " hull left"
                : source?.type === "sub"  ? "💥 Sub clipped — " + s.hull + " hull left"
                : "💥 Rocket hit — " + s.hull + " hull left";
      RB.toast(msg, "bad");
      updateHUD();
    }
  }

  function wipeout() {
    if (state.gameOver) return;
    state.gameOver = true;
    state._dethTime = performance.now();
    state.lastDeathScore = state.score;
    state.lastDeathDistance = Math.round((state.distance / STRAIT_LENGTH) * 100);

    // Big explosion
    spawnParticles(state.ship.x, state.ship.y, "#ff5c5c", 60, 320);
    spawnParticles(state.ship.x, state.ship.y, "#ff8c1a", 40, 280);
    spawnParticles(state.ship.x, state.ship.y, "#f7d716", 30, 220);
    state.cam.shake = 0.9;
    state.cam.flash = 0.9;

    // Sad trombone hook (mock)
    setTimeout(() => RB.toast("💀 " + choice(DEATH_QUOTES), "bad"), 600);

    // Record score
    const isHigh = RB.recordScore("hormuz", state.score);
    if (isHigh) RB.toast("🏆 NEW HIGH SCORE!", "good");

    // Show wipeout card after a short delay so the player sees the boom
    setTimeout(showWipeout, 1100);
  }

  // =========================================================================
  // 9. PICKUPS (oil barrels)
  // =========================================================================

  function maybeSpawnPickup() {
    if (Math.random() > 0.012) return; // rare-ish
    const s = state.ship;
    state.pickups.push({
      x: rand(-LANE_HALF_WIDTH + 20, LANE_HALF_WIDTH - 20),
      y: s.y + rand(80, VISIBLE_AHEAD),
      age: 0
    });
  }

  function updatePickups(dt) {
    for (let i = state.pickups.length - 1; i >= 0; i--) {
      const p = state.pickups[i];
      p.age += dt;
      if (p.y < state.ship.y - VISIBLE_BEHIND) { state.pickups.splice(i, 1); continue; }
      if (dist2(p.x, p.y, state.ship.x, state.ship.y) < 22 * 22) {
        state.pickups.splice(i, 1);
        state.score += 50;
        spawnParticles(p.x, p.y, "#f7d716", 14, 200);
        spawnParticles(p.x, p.y, "#ff8c1a", 8, 140);
        RB.toast("+50 OIL", "good");
        updateHUD();
      }
    }
  }

  // =========================================================================
  // 10. PARTICLES + SPLASHES
  // =========================================================================

  function spawnParticles(x, y, color, count = 12, speed = 200) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.5 + Math.random() * 0.7);
      state.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 60,
        life: 0.5 + Math.random() * 0.5,
        age: 0, color, size: 2 + Math.random() * 3
      });
    }
  }

  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.age += dt;
      if (p.age >= p.life) { state.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 200 * dt;
    }
    for (let i = state.splashes.length - 1; i >= 0; i--) {
      const s = state.splashes[i];
      s.age += dt;
      if (s.age >= s.life) state.splashes.splice(i, 1);
    }
  }

  // =========================================================================
  // 11. BOSS
  // =========================================================================

  function armBoss() {
    if (state.boss || state.bossArmed) return;
    state.bossArmed = true;
    state.bossActive = true;
    state.boss = {
      x: 0,
      y: state.ship.y + 400,
      w: 560, h: 80,
      honks: 0,
      required: 5,
      resolved: false,
      mode: "idle"
    };
    state.bannerText = "🚢 CONTAINER SHIP — HONK 5 TIMES!";
    state.bannerUntil = performance.now() + 2400;
    const hud = document.getElementById("boss-honkhud");
    if (hud) hud.style.display = "block";
    const el = document.getElementById("honk-count");
    if (el) el.textContent = `0/${state.boss.required}`;
  }

  function resolveBoss(success) {
    const b = state.boss;
    if (!b || b.resolved) return;
    b.resolved = true;
    b.mode = success ? "success" : "fail";
    if (success) {
      state.score += 5000;
      RB.toast("🚢 +5000 CONTAINER CLEARED!", "good");
      spawnParticles(b.x, b.y - 20, "#6bff7d", 40, 280);
      spawnParticles(b.x, b.y - 20, "#2ee0ff", 30, 220);
    } else {
      RB.toast("🚢 ignored. The ship passed on its own.", "");
    }
    setTimeout(() => {
      const hud = document.getElementById("boss-honkhud");
      if (hud) hud.style.display = "none";
    }, 800);
  }

  // =========================================================================
  // 12. PHASE GATES (ad-wall)
  // =========================================================================

  function getPhaseProgress() {
    const p = clamp(state.distance / STRAIT_LENGTH, 0, 1);
    let phase = 1;
    if (p >= 0.92) phase = 5;
    else if (p >= 0.70) phase = 4;
    else if (p >= 0.40) phase = 3;
    else if (p >= 0.15) phase = 2;
    return { progress: p, phase };
  }

  function checkPhaseGates() {
    const { progress } = getPhaseProgress();
    for (let i = 0; i < PHASE_GATES.length; i++) {
      if (progress >= PHASE_GATES[i] && !state.phaseGatesHit.has(i)) {
        state.phaseGatesHit.add(i);
        openGate(i);
        return;
      }
    }
  }

  function openGate(gateIndex) {
    state.inGate = true;
    state.paused = true;
    // Pick 3 random upgrades
    const keys = Object.keys(UPGRADES);
    const offered = [];
    while (offered.length < Math.min(3, keys.length)) {
      const k = keys[Math.floor(Math.random() * keys.length)];
      if (!offered.includes(k)) offered.push(k);
    }
    renderGate(gateIndex, offered);
  }

  function closeGate() {
    state.inGate = false;
    state.paused = false;
    const mount = document.getElementById("gate-mount");
    if (mount) mount.innerHTML = "";
  }

  // =========================================================================
  // 13. UPGRADE APPLICATION
  // =========================================================================

  function applyUpgrade(kind) {
    const s = state.ship;
    const now = performance.now() / 1000;
    switch (kind) {
      case "turbo":
        s.turboMult = 1.6;
        state.activeUpgrades.turbo = now + 90;
        break;
      case "shield":
        state.activeUpgrades.shield = now + 9999;  // consumed on hit
        break;
      case "radar":
        state.activeUpgrades.radar = now + 120;
        break;
      case "plating":
        if (!s.plated) {
          s.plated = true;
          s.maxHull = HULL_MAX + 1;
          s.hull = Math.min(s.hull + 1, s.maxHull);
        }
        state.activeUpgrades.plating = now + 9999; // permanent this run
        break;
      case "fuzzyDice": {
        const goInv = Math.random() < 0.5;
        if (goInv) {
          s.iframe = Math.max(s.iframe, 8);
          state.activeUpgrades.fuzzyDice = now + 8;
        } else {
          state.activeUpgrades.fuzzyDice = now + 10;
        }
        break;
      }
    }
    updateHUD();
  }

  function tickUpgrades() {
    const s = state.ship;
    const now = performance.now() / 1000;
    // Turbo expiry
    if (state.activeUpgrades.turbo && now > state.activeUpgrades.turbo) {
      s.turboMult = 1;
      delete state.activeUpgrades.turbo;
      RB.toast("⏰ Turbo expired", "");
    }
    // Radar expiry
    if (state.activeUpgrades.radar && now > state.activeUpgrades.radar) {
      delete state.activeUpgrades.radar;
      RB.toast("🦆 Duck radar offline", "");
    }
  }

  function hasShield() {
    return state.activeUpgrades.shield != null;
  }
  function consumeShield() {
    delete state.activeUpgrades.shield;
    state.cam.shake = 0.3;
    state.cam.flash = 0.2;
    spawnParticles(state.ship.x, state.ship.y, "#2ee0ff", 18, 180);
    RB.toast("🫧 Soap-bubble popped! (Shield gone)", "");
  }

  // (shield check is now done inside takeHit itself)

  // =========================================================================
  // 14. WIPEOUT SHARE CARD
  // =========================================================================

  function showWipeout() {
    const mount = document.getElementById("wipeout-mount");
    if (!mount) return;
    const caption = choice(WIPEOUT_CAPTIONS);
    const cause = state.lastCauseOfDeath || "Mystery Explosion";
    const distPct = state.lastDeathDistance ?? Math.round((state.distance / STRAIT_LENGTH) * 100);
    const isHigh = RB.getHighScore("hormuz") === state.score;
    mount.innerHTML = `
      <div class="wipeout-card">
        <div class="wipeout-card__death">💀 ${escapeHtml(cause)}</div>
        <div class="wipeout-card__stats">
          Score: <strong>${state.score.toLocaleString()}</strong> ·
          Distance: <strong>${distPct}%</strong> · Phase: <strong>${state.phase}</strong>
          ${isHigh ? '<br/><span style="color:var(--good)">🏆 NEW HIGH SCORE</span>' : ""}
        </div>
        <div class="wipeout-card__caption">"${escapeHtml(caption)}"</div>
        <div class="wipeout-card__actions">
          <button class="btn btn--primary" id="wipeout-share">📤 Share Wipeout</button>
          <button class="btn btn--secondary" id="wipeout-retry">⛴ Retry</button>
          <button class="btn btn--ghost" id="wipeout-home" style="font-size:13px;padding:10px 14px;">All Games</button>
        </div>
        <div style="margin-top:14px;font-size:11px;color:var(--ink-dim);">
          ${RB.isAdFree() ? "Pro: ads removed" : "Pro Captain removes ads everywhere → $3.99/mo"}
        </div>
      </div>
    `;
    document.getElementById("wipeout-share").addEventListener("click", shareWipeout);
    document.getElementById("wipeout-retry").addEventListener("click", () => { mount.innerHTML = ""; startGame(); });
    document.getElementById("wipeout-home").addEventListener("click", () => { window.location.href = "../games.html"; });
  }

  function escapeHtml(s) {
    return String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  }

  function shareWipeout() {
    // Use the most recent frame in the ring buffer if we have one
    const recent = state.ringBuffer[state.ringBuffer.length - 1];
    const caption = `I just died in Escape the Straight 🚢💥 Score: ${state.score.toLocaleString()} #EscapeTheStraight`;
    if (recent && navigator.canShare && navigator.share) {
      recent.canvas.toBlob((blob) => {
        if (!blob) return fallbackCopy(caption);
        const file = new File([blob], "wipeout.png", { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: "Escape the Straight", text: caption })
            .then(() => RB.toast("📤 Shared!", "good"))
            .catch(() => fallbackCopy(caption));
        } else {
          fallbackCopy(caption);
        }
      }, "image/png");
    } else {
      fallbackCopy(caption);
    }
  }

  function fallbackCopy(caption) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(caption).then(() => RB.toast("📋 Caption copied to clipboard", "good"));
    } else {
      RB.toast("📤 Share not available on this device", "");
    }
  }

  // =========================================================================
  // 15. GATE UI (ad-wall upgrade picker)
  // =========================================================================

  function renderGate(gateIndex, offered) {
    const mount = document.getElementById("gate-mount");
    if (!mount) return;
    const labels = ["FIRST", "SECOND", "FINAL"];
    const label = labels[gateIndex] || "EXTRA";
    mount.innerHTML = `
      <div class="gate-card">
        <div class="gate-card__title">⚡ ${label} AD WALL</div>
        <div class="gate-card__sub">You made it to the ${label} checkpoint. Pick an upgrade — but first, watch a 5s ad.</div>
        <div class="gate-card__grid" id="gate-options">
          ${offered.map((k) => `
            <button class="gate-card__option" data-kind="${k}">
              <span class="gate-card__option-icon">${UPGRADES[k].icon}</span>
              <p class="gate-card__option-name">${UPGRADES[k].name}</p>
              <p class="gate-card__option-desc">${UPGRADES[k].desc}</p>
            </button>
          `).join("")}
        </div>
        <div class="gate-card__ad-hint">Tap an upgrade to watch the ad and claim it. Skip at your peril.</div>
        <button class="gate-card__skip" id="gate-skip">Skip — I'm too tough for ads</button>
      </div>
    `;
    mount.querySelectorAll(".gate-card__option").forEach((btn) => {
      btn.addEventListener("click", () => requestUpgrade(btn.dataset.kind));
    });
    document.getElementById("gate-skip").addEventListener("click", () => {
      RB.toast("Skipped. The duck judges silently.", "bad");
      closeGate();
    });
  }

  function requestUpgrade(kind) {
    if (RB.isAdFree()) {
      // Pro users skip the ad
      applyUpgrade(kind);
      RB.toast(`✨ ${UPGRADES[kind].name} applied (Pro)`, "good");
      closeGate();
      return;
    }
    RB.showRewarded().then((finished) => {
      if (finished) {
        applyUpgrade(kind);
        RB.toast(`✨ ${UPGRADES[kind].name} claimed!`, "good");
      } else {
        RB.toast("Ad not completed — no reward", "bad");
      }
      closeGate();
    });
  }

  // =========================================================================
  // 16. RENDERING
  // =========================================================================

  function worldToScreen(wx, wy) {
    // Ship always at vertical center; horizontal also centered
    return {
      x: W / 2 + wx,
      y: H / 2 - (wy - state.ship.y) * 0.7   // slight perspective: forward moves up
    };
  }

  function draw() {
    // Camera shake
    const shake = state.cam.shake;
    const sx = (Math.random() - 0.5) * shake * 12;
    const sy = (Math.random() - 0.5) * shake * 12;
    ctx.save();
    ctx.translate(sx, sy);

    // Background water — striped for movement
    const phase = getPhaseProgress();
    const phaseDef = PHASE_DEFS[phase.phase - 1];

    // Base color shifts by phase
    const phaseColors = ["#0a3a5a", "#0a3250", "#0a2840", "#082030", "#062028"];
    ctx.fillStyle = phaseColors[phase.phase - 1];
    ctx.fillRect(0, 0, W, H);

    // Fog (later phases)
    if (phaseDef.fog > 0) {
      ctx.fillStyle = `rgba(180, 200, 220, ${phaseDef.fog * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }

    // Lane guides
    const laneLeft = worldToScreen(-LANE_HALF_WIDTH, 0).x;
    const laneRight = worldToScreen( LANE_HALF_WIDTH, 0).x;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 12]);
    ctx.beginPath();
    ctx.moveTo(laneLeft, 0);
    ctx.lineTo(laneLeft, H);
    ctx.moveTo(laneRight, 0);
    ctx.lineTo(laneRight, H);
    ctx.stroke();
    ctx.setLineDash([]);

    // Distance markers (every 500u)
    for (let d = Math.floor(state.ship.y / 500) * 500; d < state.ship.y + VISIBLE_AHEAD; d += 500) {
      const p = worldToScreen(0, d);
      if (p.y < 0 || p.y > H) continue;
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(0, p.y, W, 2);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.font = "10px JetBrains Mono, monospace";
      ctx.textAlign = "left";
      ctx.fillText(`${d}m`, 8, p.y - 4);
    }

    // Boss
    if (state.boss && state.bossActive) {
      drawBoss(state.boss);
    }

    // Obstacles
    for (const o of state.obstacles) {
      if (o.y < state.ship.y - VISIBLE_BEHIND) continue;
      if (o.y > state.ship.y + VISIBLE_AHEAD) continue;
      if (o.type === "mine") drawMine(o);
      else if (o.type === "sub") drawSub(o);
      else if (o.type === "rocket") drawRocket(o);
    }

    // Pickups
    for (const p of state.pickups) {
      if (p.y < state.ship.y - VISIBLE_BEHIND) continue;
      if (p.y > state.ship.y + VISIBLE_AHEAD) continue;
      drawBarrel(p.x, p.y);
    }

    // Splashes
    for (const sp of state.splashes) {
      const p = worldToScreen(sp.x, sp.y);
      if (p.y < -20 || p.y > H + 20) continue;
      const a = 1 - sp.age / sp.life;
      ctx.strokeStyle = `rgba(255,255,255,${a * 0.4})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 + sp.age * 18, 0, TAU);
      ctx.stroke();
    }

    // Particles
    for (const p of state.particles) {
      const s = worldToScreen(p.x, p.y);
      if (s.y < -20 || s.y > H + 20) continue;
      const a = 1 - p.age / p.life;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = a;
      ctx.fillRect(s.x - p.size / 2, s.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // Ship
    if (!state.gameOver) drawShip();
    else if (state.gameOver && performance.now() - (state._dethTime || 0) < 500) drawShip();

    // Radar overlay
    if (state.activeUpgrades.radar) {
      drawRadar();
    }

    // Soap-bubble shield
    if (hasShield()) drawShield();

    // Restore
    ctx.restore();

    // Flash
    if (state.cam.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${state.cam.flash * 0.6})`;
      ctx.fillRect(0, 0, W, H);
      state.cam.flash = Math.max(0, state.cam.flash - 0.04);
    }

    // Phase banner
    if (state.bannerText && performance.now() < state.bannerUntil) {
      const el = document.getElementById("phase-banner");
      if (el) {
        el.textContent = state.bannerText;
        el.classList.add("phase-banner--show");
      }
    } else {
      const el = document.getElementById("phase-banner");
      if (el) el.classList.remove("phase-banner--show");
    }
  }

  function drawShip() {
    const s = state.ship;
    const screen = worldToScreen(s.x, s.y);
    const r = s.heading;

    // Wobble roll
    const wobble = Math.sin(performance.now() * 0.001 * SHIP_WOBBLE_FREQ) * SHIP_WOBBLE_AMP;
    const roll = wobble + (state.input.steer * 12);

    // I-frame flash
    if (s.flashing > 0 && Math.random() < 0.5) ctx.globalAlpha = 0.4;

    ctx.save();
    ctx.translate(screen.x, screen.y);
    // Ship sprite is drawn with bow at -y (pointing up the strait).
    // With the new camera-relative controls, heading=0 means "moving forward",
    // so the rotation is just heading + the cosmetic roll. No π/2 offset.
    // NOTE: r is in radians, roll is in degrees.
    ctx.rotate(r + (roll * Math.PI / 180));
    ctx.scale(s.shipScale, s.shipScale);
    // (r is already radians; -r flips the heading for screen orientation)

    // Hull body (orange tanker, low-poly)
    ctx.fillStyle = "#ff8c1a";
    ctx.beginPath();
    ctx.moveTo(-16, 18);
    ctx.lineTo(16, 18);
    ctx.lineTo(14, -12);
    ctx.lineTo(8, -22);
    ctx.lineTo(-8, -22);
    ctx.lineTo(-14, -12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Bridge
    ctx.fillStyle = "#ffd180";
    ctx.fillRect(-7, -16, 14, 6);
    ctx.strokeRect(-7, -16, 14, 6);

    // Bridge windows
    ctx.fillStyle = "#2ee0ff";
    ctx.fillRect(-5, -14, 3, 2);
    ctx.fillRect(0,  -14, 3, 2);

    // Rubber duck on bow (the mascot)
    ctx.fillStyle = "#f7d716";
    ctx.beginPath();
    ctx.arc(0, -22, 6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ff8c1a";
    ctx.beginPath();
    ctx.arc(2, -24, 2.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(2.5, -24, 0.8, 0, TAU);
    ctx.fill();
    // Duck beak
    ctx.fillStyle = "#ff8c1a";
    ctx.beginPath();
    ctx.moveTo(5, -23);
    ctx.lineTo(8, -22);
    ctx.lineTo(5, -21);
    ctx.closePath();
    ctx.fill();

    // Fuzzy dice hanging from bridge
    ctx.fillStyle = "#ff2e88";
    ctx.fillRect(-4, -10, 3, 3);
    ctx.fillRect(2, -10, 3, 3);
    ctx.fillStyle = "#fff";
    ctx.font = "3px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("•", -2.5, -7.5);
    ctx.fillText("•", 3.5, -7.5);

    // "TURBO" spoiler (cosmetic)
    ctx.fillStyle = "#ff2e88";
    ctx.fillRect(-12, 14, 24, 4);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 3px Arial";
    ctx.textAlign = "center";
    ctx.fillText("TURBO", 0, 17);

    // Hull damage indicator
    if (s.hull < s.maxHull) {
      ctx.strokeStyle = "#ff5c5c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-10, 0); ctx.lineTo(-4, 6);
      ctx.moveTo(0, -4);  ctx.lineTo(8, 4);
      ctx.stroke();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawMine(o) {
    const s = worldToScreen(o.x, o.y);
    if (s.y < -20 || s.y > H + 20) return;
    // Barrel body
    ctx.fillStyle = "#7a3a1a";
    ctx.beginPath();
    ctx.arc(s.x, s.y, o.w * 0.5, 0, TAU);
    ctx.fill();
    // Bands
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x - o.w * 0.5, s.y);
    ctx.lineTo(s.x + o.w * 0.5, s.y);
    ctx.stroke();
    // Face (permanent-marker eyes)
    const fy = s.y - 2;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(s.x - 4, fy, 1.8, 0, TAU);
    ctx.arc(s.x + 4, fy, 1.8, 0, TAU);
    ctx.fill();
    // Mouth based on face state
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (o.face === "smug") {
      ctx.arc(s.x, fy + 4, 3, 0, Math.PI, false);
    } else if (o.face === "surprised") {
      ctx.arc(s.x, fy + 5, 2, 0, TAU);
    } else {
      ctx.moveTo(s.x - 3, fy + 5); ctx.lineTo(s.x + 3, fy + 5);
    }
    ctx.stroke();
    // Highlight
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.beginPath();
    ctx.arc(s.x - o.w * 0.25, s.y - o.w * 0.25, 2, 0, TAU);
    ctx.fill();
  }

  function drawSub(o) {
    const s = worldToScreen(o.x, o.y);
    if (s.y < -20 || s.y > H + 20) return;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(Math.atan2(o.vy, o.vx) - Math.PI / 2);
    // Hull
    ctx.fillStyle = o.dove ? "#3a3a4a" : "#5a5a6a";
    roundRect(ctx, -o.w * 0.5, -o.h * 0.5, o.w, o.h, 6);
    ctx.fill();
    ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.stroke();
    // Conning tower
    ctx.fillStyle = "#444";
    ctx.fillRect(-4, -3, 8, 6);
    // Googly eyes
    if (o.dove) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(-3, -1, 2.5, 0, TAU);
      ctx.arc(3, -1, 2.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(-2.5 + o.dir, -1, 1, 0, TAU);
      ctx.arc(3.5 - o.dir, -1, 1, 0, TAU);
      ctx.fill();
    } else {
      // Periscope tell
      ctx.fillStyle = "#888";
      ctx.fillRect(-1, -8, 2, 5);
    }
    ctx.restore();
  }

  function drawRocket(o) {
    const s = worldToScreen(o.x, o.y);
    if (s.y < -20 || s.y > H + 20) return;
    ctx.save();
    ctx.translate(s.x, s.y);
    const ang = Math.atan2(o.vy, o.vx) + Math.PI / 2;
    ctx.rotate(ang);
    // Body
    ctx.fillStyle = "#ddd";
    ctx.fillRect(-o.w * 0.5, -o.h * 0.5, o.w, o.h);
    ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.strokeRect(-o.w * 0.5, -o.h * 0.5, o.w, o.h);
    // Smiley face (only if not dropped)
    if (!o.faceDropped) {
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(-1.5, -o.h * 0.25, 0.8, 0, TAU);
      ctx.arc( 1.5, -o.h * 0.25, 0.8, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, -o.h * 0.05, 1.5, 0, Math.PI);
      ctx.stroke();
    }
    // Exhaust
    ctx.fillStyle = "#ff8c1a";
    ctx.beginPath();
    ctx.moveTo(-o.w * 0.4, o.h * 0.5);
    ctx.lineTo(0, o.h * 0.5 + 6 + Math.random() * 4);
    ctx.lineTo(o.w * 0.4, o.h * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Dropped face (physics-ish: just drift away)
    if (o.faceDropped && o._faceOffY == null) o._faceOffY = 0;
    if (o.faceDropped) {
      o._faceOffY = (o._faceOffY || 0) + 0.6;
      const fy = s.y - o.h * 0.3 - o._faceOffY;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(s.x, fy, 4, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.beginPath();
      ctx.arc(s.x, fy, 4, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(s.x - 1.5, fy - 0.5, 0.6, 0, TAU);
      ctx.arc(s.x + 1.5, fy - 0.5, 0.6, 0, TAU);
      ctx.fill();
    }
  }

  function drawBoss(b) {
    const s = worldToScreen(b.x, b.y);
    if (s.y < -100 || s.y > H + 100) return;
    // Wide container block
    ctx.fillStyle = b.mode === "success" ? "#3a8a4a" : b.mode === "fail" ? "#8a3a3a" : "#5a3a2a";
    ctx.fillRect(s.x - b.w * 0.5, s.y - b.h * 0.5, b.w, b.h);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.strokeRect(s.x - b.w * 0.5, s.y - b.h * 0.5, b.w, b.h);
    // Container ribs
    for (let i = 0; i < 8; i++) {
      const x = s.x - b.w * 0.5 + (i + 1) * b.w / 9;
      ctx.beginPath();
      ctx.moveTo(x, s.y - b.h * 0.5);
      ctx.lineTo(x, s.y + b.h * 0.5);
      ctx.stroke();
    }
    // Top text
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px Bungee, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(b.mode === "success" ? "MOVE!" : "HONK ME!", s.x, s.y - b.h * 0.5 - 8);
  }

  function drawRadar() {
    // Highlight nearby obstacles
    for (const o of state.obstacles) {
      if (o.y < state.ship.y - 50) continue;
      if (o.y > state.ship.y + 80) continue;
      const s = worldToScreen(o.x, o.y);
      if (s.y < 0 || s.y > H) continue;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.008);
      ctx.strokeStyle = `rgba(247,215,22,${0.4 + 0.4 * pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 18, 0, TAU);
      ctx.stroke();
      // Duck icon
      ctx.fillStyle = `rgba(247,215,22,${0.7 + 0.3 * pulse})`;
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🦆", s.x, s.y - 22);
    }
  }

  function drawShield() {
    const s = state.ship;
    const p = worldToScreen(s.x, s.y);
    const t = performance.now() * 0.003;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.strokeStyle = "rgba(46,224,255,0.6)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, 22 + i * 4, t + i, t + i + Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBarrel(wx, wy) {
    const s = worldToScreen(wx, wy);
    if (s.y < -20 || s.y > H + 20) return;
    // Glow
    ctx.fillStyle = "rgba(247,215,22,0.25)";
    ctx.beginPath();
    ctx.arc(s.x, s.y, 14, 0, TAU);
    ctx.fill();
    // Barrel
    ctx.fillStyle = "#7a3a1a";
    ctx.beginPath();
    ctx.arc(s.x, s.y, 9, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 9, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 6px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("OIL", s.x, s.y + 1);
  }

  // =========================================================================
  // 17. FRAME BUFFER for share card
  // =========================================================================

  function pushRingBuffer() {
    if (state.gameOver) return;
    const now = performance.now();
    if (now - state.lastRingPush < 100) return; // 10fps
    state.lastRingPush = now;

    // Draw ship + nearby obstacles to an offscreen canvas
    const off = document.createElement("canvas");
    off.width = 360; off.height = 360;
    const octx = off.getContext("2d");
    // Save current ctx, swap, draw, restore
    const savedTransform = ctx.getTransform();
    octx.fillStyle = "#0a3a5a";
    octx.fillRect(0, 0, off.width, off.height);
    // Draw the ship large in center
    octx.save();
    octx.translate(off.width / 2, off.height / 2 + 60);
    octx.scale(2.2, 2.2);
    octx.rotate(Math.PI / 2);
    // Inline mini-ship draw (simplified)
    octx.fillStyle = "#ff8c1a";
    octx.beginPath();
    octx.moveTo(-16, 18);
    octx.lineTo(16, 18);
    octx.lineTo(14, -12);
    octx.lineTo(8, -22);
    octx.lineTo(-8, -22);
    octx.lineTo(-14, -12);
    octx.closePath();
    octx.fill();
    octx.strokeStyle = "#000"; octx.lineWidth = 1.5; octx.stroke();
    octx.fillStyle = "#f7d716";
    octx.beginPath();
    octx.arc(0, -22, 6, 0, TAU);
    octx.fill();
    octx.restore();
    // Obstacles
    for (const o of state.obstacles) {
      if (o.y < state.ship.y - 50 || o.y > state.ship.y + 80) continue;
      const dx = (o.x - state.ship.x) * 1.0;
      const dy = (o.y - state.ship.y) * -0.7;
      octx.fillStyle = o.type === "mine" ? "#7a3a1a" : o.type === "sub" ? "#5a5a6a" : "#ddd";
      octx.beginPath();
      octx.arc(off.width / 2 + dx, off.height / 2 + dy + 60, 14, 0, TAU);
      octx.fill();
    }
    state.ringBuffer.push({ canvas: off, t: now });
    while (state.ringBuffer.length > 30) state.ringBuffer.shift();
  }

  // =========================================================================
  // 18. GAME LOOP
  // =========================================================================

  let rafId = null;
  function loop(now) {
    if (!state.running) return;
    if (!state.lastTime) state.lastTime = now;
    const dt = Math.min(0.05, (now - state.lastTime) / 1000);
    state.lastTime = now;

    if (!state.paused && !state.gameOver && !state.inGate) {
      readInput();
      updateShip(dt);
      updateObstacles(dt);
      updatePickups(dt);
      updateParticles(dt);
      tickUpgrades();

      // Spawn obstacles based on phase
      const phase = getPhaseProgress();
      state.phase = phase.phase;
      if (state.phase < 5) {
        state._spawnT = (state._spawnT || 0) + dt;
        const def = PHASE_DEFS[phase.phase - 1];
        if (state._spawnT >= def.spawnEvery) {
          state._spawnT = 0;
          spawnObstacle();
          maybeSpawnPickup();
        }
      } else {
        // Phase 5: arm the boss once
        if (!state.bossArmed) armBoss();
      }

      // Phase gates
      checkPhaseGates();

      // Phase transition banner
      const prevPhase = state._lastPhaseDrawn || 0;
      if (state.phase !== prevPhase) {
        const def = PHASE_DEFS[state.phase - 1];
        state.bannerText = `PHASE ${state.phase} · ${def.name}`;
        state.bannerUntil = performance.now() + 2000;
        state._lastPhaseDrawn = state.phase;
      }

      // Score
      state.score += Math.floor(20 * dt);

      // Frame buffer for share
      pushRingBuffer();
    }

    // Decay
    if (state.cam.shake > 0) state.cam.shake = Math.max(0, state.cam.shake - dt * 3);
    if (state.ship.flashing > 0) state.ship.flashing = Math.max(0, state.ship.flashing - dt * 4);

    draw();
    updateHUD();
    rafId = requestAnimationFrame(loop);
  }

  // =========================================================================
  // 19. HUD
  // =========================================================================

  function updateHUD() {
    const s = state.ship;
    const p = getPhaseProgress();
    document.getElementById("hud-score").textContent = state.score.toLocaleString();
    document.getElementById("hud-dist").textContent = Math.floor(p.progress * 100) + "%";
    document.getElementById("hud-phase").textContent = state.phase;
    document.getElementById("hud-high").textContent = RB.getHighScore("hormuz").toLocaleString();

    // Hull pips
    const hullEl = document.getElementById("hud-hull");
    if (hullEl) {
      let html = "";
      for (let i = 0; i < s.maxHull; i++) {
        let state_attr = "good";
        if (i >= s.hull) state_attr = "lost";
        else if (s.hull === 1) state_attr = "critical";
        else if (i === s.hull - 1) state_attr = "damaged";
        html += `<span class="hull-pip" data-state="${state_attr}"></span>`;
      }
      hullEl.innerHTML = html;
    }
  }

  // =========================================================================
  // 20. STATE MANAGEMENT
  // =========================================================================

  function startGame() {
    // Reset
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.started = true;
    state.score = 0;
    state.distance = 0;
    state.phase = 1;
    state.ship = {
      x: 0, y: 0, vx: 0, vy: 0,
      heading: 0, angVel: 0,
      hull: HULL_MAX, maxHull: HULL_MAX,
      iframe: 0, hornCooldown: 0, flashing: 0,
      shipScale: 1, turboMult: 1, plated: false
    };
    state.obstacles = [];
    state.pickups = [];
    state.particles = [];
    state.splashes = [];
    state.boss = null;
    state.bossActive = false;
    state.bossArmed = false;
    state.phaseGatesHit = new Set();
    state.inGate = false;
    state.activeUpgrades = {};
    state.cam.shake = 0; state.cam.flash = 0;
    state.ringBuffer = [];
    state._spawnT = 0;
    state._lastPhaseDrawn = 0;
    state._dethTime = 0;
    state.lastCauseOfDeath = "";

    // Clear wipeout card
    const mount = document.getElementById("wipeout-mount");
    if (mount) mount.innerHTML = "";
    const ghud = document.getElementById("boss-honkhud");
    if (ghud) ghud.style.display = "none";

    hideOverlay();
    updateHUD();
    canvas.focus();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function pauseGame() {
    if (!state.running || state.gameOver) return;
    state.paused = !state.paused;
    document.getElementById("btn-pause").textContent = state.paused ? "Resume" : "Pause";
  }

  function showOverlay(title, sub, btn, showScore) {
    const ov = document.getElementById("overlay");
    document.getElementById("overlay-title").textContent = title;
    document.getElementById("overlay-sub").innerHTML = sub;
    const scoreEl = document.getElementById("overlay-score");
    if (showScore) {
      scoreEl.style.display = "block";
      scoreEl.innerHTML = `Score: <strong style="color:var(--accent-3)">${state.score.toLocaleString()}</strong> · High: <strong>${RB.getHighScore("hormuz").toLocaleString()}</strong> · Distance: <strong>${Math.round((state.distance / STRAIT_LENGTH) * 100)}%</strong>`;
    } else {
      scoreEl.style.display = "none";
    }
    document.getElementById("btn-primary").textContent = btn;
    ov.classList.add("overlay--show");
  }
  function hideOverlay() { document.getElementById("overlay").classList.remove("overlay--show"); }

  // =========================================================================
  // 21. POWER-UP LEGACY (the old shield/boost/nuke lives in RB.state.powerups
  //     but we don't use them in v3 — the new ad-wall loop supersedes them.
  //     We render the old panel anyway so RB.subscribe(renderPowerups) in the
  //     parent site still works without errors.
  // =========================================================================
  function renderPowerups() {
    const slot = document.getElementById("powerups");
    if (!slot) return;
    const s = RB.state;
    const items = [
      { key: "turbo",     icon: "🌀", label: "Turbo" },
      { key: "shield",    icon: "🫧", label: "Shield" },
      { key: "radar",     icon: "🦆", label: "Radar" },
      { key: "plating",   icon: "🩹", label: "Plating" },
      { key: "fuzzyDice", icon: "🎲", label: "Dice" }
    ];
    slot.innerHTML = items.map((it) => `
      <div class="powerup powerup--locked" title="${UPGRADES[it.key].desc}">
        <span class="powerup__icon">${it.icon}</span>
        <span class="powerup__label">${it.label}</span>
        <span class="powerup__cost">AD WALL</span>
      </div>
    `).join("");
  }

  // =========================================================================
  // 22. WIRING
  // =========================================================================

  document.getElementById("btn-primary").addEventListener("click", startGame);
  document.getElementById("btn-pause").addEventListener("click", pauseGame);
  document.getElementById("btn-restart").addEventListener("click", () => {
    showOverlay(
      "⛴ RESTART?",
      "Restart the voyage? Your tanker can take it. (Probably.)",
      "Start voyage"
    );
  });

  RB.subscribe(renderPowerups);
  setupTouch();
  updateHUD();
  renderPowerups();

  // First paint of the world (so the canvas isn't blank behind the overlay)
  draw();
})();
