/* ============================================
   DON'T LOOK AT THE GYM GIRL — v2
   --------------------------------------------
   v2: 8 phases, escalating roster.
   - Phase 1: 1 girl (tutorial)
   - Phase 2: 2 girls
   - Phase 3: 3 girls + mirror selfie
   - Phase 4: 4 girls
   - Phase 5: 5 girls + filmer NPC
   - Phase 6: 5 girls, faster
   - Phase 7: 5 girls + trainer NPC
   - Phase 8: 5 girls + filmer + trainer

   Each girl:
   - Has a patrol path (3-4 waypoints)
   - Walks between waypoints, head turns to face velocity
   - Pauses 2-4s at a waypoint, does her exercise (facing the rack/mirror/door)
   - Randomly checks her phone for 2s every 6-10s

   Filmer NPC (Phase 5+):
   - Guy with phone, panning left-right slowly
   - 2× shame gain (being filmed is worse than being seen)
   - Wider cone

   Trainer NPC (Phase 7+):
   - Aggressive, walks around, big cone, panics the player

   Shame formula:
   - 0.22/sec per girl in your gaze cone
   - 0.44/sec per filmer in cone
   - 0.32/sec per trainer in cone
   - Per-girl penalty so the full roster is hard but not instant-kill
   ============================================ */

(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  // =========================================================================
  // 1. TUNING
  // =========================================================================
  const PLAYER_SPEED      = 130;
  const PLAYER_RADIUS     = 11;
  const GAZE_RANGE        = 220;
  const GAZE_HALF_ANGLE   = 0.55;
  const SHAME_MAX         = 5;
  const HEART_MAX         = 3;
  const SHAME_GAIN_GIRL   = 0.22;   // per girl, per sec
  const SHAME_GAIN_FILMER = 0.44;   // 2x: being filmed is worse
  const SHAME_GAIN_TRAINER= 0.32;
  const SHAME_DECAY       = 0.5;
  const HEART_GAIN        = 0.55;
  const HEART_DECAY       = 0.4;
  const PANIC_DURATION    = 2.0;
  const PANIC_SPEED_MULT  = 1.55;

  // =========================================================================
  // 2. PHASES (escalating roster)
  // =========================================================================
  const PHASES = [
    { id: 1, name: "BICEP CURLS",      numGirls: 1, girlSpeed: 0,    stayMin: 99, stayMax: 99, phoneChance: 0.0, coneWidth: 0.55, description: "She's doing bicep curls. Easy. Eyes down. Just walk past." },
    { id: 2, name: "ROMANIAN DEADLIFTS", numGirls: 2, girlSpeed: 30,  stayMin: 2.5, stayMax: 4.0, phoneChance: 0.4, coneWidth: 0.6, description: "Two of them now. One checks her phone." },
    { id: 3, name: "MIRROR SELFIES",   numGirls: 3, girlSpeed: 38,  stayMin: 2.0, stayMax: 3.5, phoneChance: 0.6, coneWidth: 0.6, description: "Three girls. One is taking mirror selfies. The reflection counts." },
    { id: 4, name: "GROUP CLASS",      numGirls: 4, girlSpeed: 42,  stayMin: 1.5, stayMax: 3.0, phoneChance: 0.7, coneWidth: 0.65, description: "Four girls. They're synchronized. Eyes down the whole time." },
    { id: 5, name: "PAPARAZZI HOUR",   numGirls: 5, girlSpeed: 45,  stayMin: 1.5, stayMax: 2.8, phoneChance: 0.8, coneWidth: 0.65, hasFilmer: true, description: "Five girls. Plus a guy with a phone. He's filming." },
    { id: 6, name: "SPEED ROUND",      numGirls: 5, girlSpeed: 60,  stayMin: 1.2, stayMax: 2.2, phoneChance: 0.85, coneWidth: 0.7, hasFilmer: true, description: "Same five. They walk faster. They look around more." },
    { id: 7, name: "PERSONAL TRAINER", numGirls: 5, girlSpeed: 55,  stayMin: 1.2, stayMax: 2.2, phoneChance: 0.85, coneWidth: 0.7, hasFilmer: true, hasTrainer: true, description: "Five girls. Filmer. Plus a trainer correcting form." },
    { id: 8, name: "PEAK HOURS",       numGirls: 5, girlSpeed: 70,  stayMin: 0.8, stayMax: 1.6, phoneChance: 0.95, coneWidth: 0.75, hasFilmer: true, hasTrainer: true, description: "Peak hours. Everyone is moving. Everyone is looking. Don't look up." }
  ];

  // =========================================================================
  // 3. WAYPOINTS — shared across girls, sampled per girl so they don't overlap
  // =========================================================================
  // 8 waypoints around the periphery + a few mid-floor nodes + the center
  const WAYPOINTS = [
    { x: 320, y: 320 }, // CENTER (used for phase 1 tutorial spawn)
    { x: 110, y: 110 }, // top-left rack
    { x: 320, y:  90 }, // top center (mirror wall)
    { x: 530, y: 110 }, // top-right rack
    { x: 110, y: 320 }, // left mid
    { x: 320, y: 540 }, // bottom center (water fountain)
    { x: 530, y: 320 }, // right mid (lockers)
    { x: 110, y: 530 }, // bottom-left
    { x: 530, y: 530 }, // bottom-right
    { x: 220, y: 220 }, // mid upper-left
    { x: 420, y: 220 }, // mid upper-right
    { x: 220, y: 420 }, // mid lower-left
    { x: 420, y: 420 }, // mid lower-right
  ];

  // =========================================================================
  // 4. COVERS (more, smaller, scattered)
  // =========================================================================
  const COVERS = [
    { x:  90, y: 110, w: 50, h: 70, kind: "rack",   label: "RACK" },
    { x: 530, y: 110, w: 50, h: 70, kind: "rack",   label: "RACK" },
    { x: 290, y: 200, w: 60, h: 40, kind: "bench",  label: "BENCH" },
    { x: 110, y: 320, w: 40, h: 60, kind: "locker", label: "LOCKER" },
    { x: 320, y: 540, w: 70, h: 40, kind: "rack",   label: "FOUNTAIN" },
    { x: 530, y: 320, w: 40, h: 60, kind: "locker", label: "LOCKER" },
    { x: 220, y: 420, w: 50, h: 40, kind: "bench",  label: "BENCH" },
    { x: 420, y: 420, w: 50, h: 40, kind: "rack",   label: "RACK" },
  ];

  // Decoy positions
  const DECOY_TARGETS = [
    { x: 320, y: 100 },
    { x: 100, y: 320 },
    { x: 540, y: 540 },
    { x: 100, y: 100 },
    { x: 540, y: 100 }
  ];

  const SHAME_CAPTIONS = [
    "POV: the whole gym saw that.",
    "You're trending #3 in your local gym's group chat.",
    "Her boyfriend has 47k followers. You're his next post.",
    "She posted the clip. Your mom commented 'omg is that you??'",
    "The squat rack will be remembered. You will be remembered.",
    "The leggings won. The leggings always win.",
    "Job interview next week is gonna be a vibe.",
    "Your Hinge matches just got pruned.",
    "She tagged the gym. The gym tagged you back.",
    "The duck radar couldn't have predicted this. (It did.)",
    "Insurance claim filed. Cause of loss: one (1) head turn.",
    "The IOC sends their regards.",
    "Five girls. Five phones. You didn't stand a chance.",
    "The filmer got the angle. The trainer got the quote. The leggings got the rest.",
    "Group chat notification: 'is this him???' x 47"
  ];

  const PHASE_INTROS = [
    "👀 Phase 1 · 1 girl. Tutorial. You got this.",
    "💪 Phase 2 · 2 girls. One of them is on her phone.",
    "📸 Phase 3 · 3 girls. Mirror selfies. The reflection counts.",
    "🔥 Phase 4 · 4 girls. Group class. Synchronized.",
    "📱 Phase 5 · 5 girls + filmer. He's walking the perimeter.",
    "⚡ Phase 6 · Speed round. They move faster.",
    "🏋️ Phase 7 · + Trainer. He's correcting form aggressively.",
    "💀 Phase 8 · Peak hours. Five girls. Filmer. Trainer. Don't look up."
  ];

  // =========================================================================
  // 5. STATE
  // =========================================================================

  const state = {
    running: false,
    paused: false,
    gameOver: false,
    won: false,
    started: false,
    phase: 1,

    player: {
      x: 40, y: 320,
      vx: 0, vy: 0,
      facing: 0,
      moving: false,
      dirX: 0, dirY: 0
    },

    gaze: { active: true, range: GAZE_RANGE, halfAngle: GAZE_HALF_ANGLE },

    shame: 0,
    heart: 0,
    shameTotal: 0,
    shameHits: 0,

    panic: 0,
    airpodT: 0,
    boyfriendT: 0,
    decoy: null,

    inCover: false,

    // Girls (array of NPC states)
    girls: [],
    // Special NPCs
    filmer: null,
    trainer: null,

    mouseX: 0,
    mouseY: 0,

    cam: { shake: 0, flash: 0 },

    t: 0,
    lastTime: 0
  };

  // =========================================================================
  // 6. UTILITIES
  // =========================================================================
  const rand   = (a, b) => a + Math.random() * (b - a);
  const randi  = (a, b) => Math.floor(rand(a, b));
  const choice = (arr)  => arr[Math.floor(Math.random() * arr.length)];
  const clamp  = (v, a, b) => Math.max(a, Math.min(b, v));
  const TAU    = Math.PI * 2;
  const dist   = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  function lerp(a, b, t) { return a + (b - a) * t; }
  function normalizeAngle(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }

  function pointInCover(x, y) {
    for (const c of COVERS) {
      if (x >= c.x - c.w/2 && x <= c.x + c.w/2 &&
          y >= c.y - c.h/2 && y <= c.y + c.h/2) {
        return c;
      }
    }
    return null;
  }

  function gazeBlocked(x, y, facing) {
    const steps = 10;
    const dx = Math.cos(facing);
    const dy = Math.sin(facing);
    for (let i = 1; i <= steps; i++) {
      const px = x + dx * (i / steps) * state.gaze.range;
      const py = y + dy * (i / steps) * state.gaze.range;
      if (pointInCover(px, py)) return true;
    }
    return false;
  }

  // =========================================================================
  // 7. NPC FACTORY — make a girl with a patrol path
  // =========================================================================

  function makeGirl(index) {
    // Pick a starting waypoint that's not already occupied
    // Phase 1 always spawns the first girl at canvas center for tutorial visibility.
    // Other girls (and later phases) get a random starting waypoint.
    const waypoints = [];
    let startX, startY;
    if (index === 0 && state.phase === 1) {
      startX = 320; startY = 320;
    } else {
      const startWP = choice(WAYPOINTS);
      startX = startWP.x; startY = startWP.y;
    }
    // Always include the starting position in the waypoint list
    const startObj = { x: startX, y: startY };
    waypoints.push(startObj);
    while (waypoints.length < 4) {
      const wp = choice(WAYPOINTS);
      // Make sure we don't add a duplicate of the start
      if (!waypoints.some(w => w.x === wp.x && w.y === wp.y)) waypoints.push(wp);
    }
    return makeGirlFromWaypoints(index, waypoints);
  }

  function makeGirlFromWaypoints(index, waypoints) {
    return {
      index,
      x: waypoints[0].x,
      y: waypoints[0].y,
      waypoints,
      targetIdx: 1,
      mode: "exercising",
      modeT: 0,
      stayDuration: 2.5,
      facing: 0,
      speed: 0,
      phoneT: 0,
      phoneActive: false,
      phoneCycle: rand(6, 10),
      leggings: choice(["#ff2e88", "#e91e63", "#ff4081", "#d81b60", "#c2185b"]),
      label: choice(["YOGA PANTS", "LULLEMON", "LIFTO", "GAINS", "FLEX", "CUT", "BOOTY", "DEADLIFT"])
    };
  }

  function makeFilmer() {
    return {
      x: 60, y: 320,
      // Walks along the perimeter (top, right, bottom, left)
      perimeterT: 0,             // 0..4 — 4 sides
      speed: 25,                 // slower than girls
      facing: 0,
      panT: 0,
      panTarget: 0,
      // Panning — slowly rotates cone
      panSpeed: 0.6
    };
  }

  function makeTrainer() {
    return {
      x: 320, y: 320,
      target: choice(WAYPOINTS),
      speed: 40,
      facing: 0,
      whistleT: 0,
      whistleActive: false
    };
  }

  // =========================================================================
  // 8. INPUT
  // =========================================================================
  const keys = {};
  let mouseCanvasX = W / 2;
  let mouseCanvasY = H / 2;

  window.addEventListener("keydown", (e) => {
    keys[e.key.toLowerCase()] = true;
    if (["arrowup","arrowdown","arrowleft","arrowright"," "].includes(e.key.toLowerCase())) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
  }
  canvas.addEventListener("mousemove", (e) => {
    const m = getMousePos(e);
    mouseCanvasX = m.x;
    mouseCanvasY = m.y;
  });
  canvas.addEventListener("mousedown", () => {
    canvas.focus();
    if (!state.running && !state.gameOver && !state.won) startGame();
  });

  function readInput(dt) {
    let dx = 0, dy = 0;
    if (keys["w"] || keys["arrowup"])    dy -= 1;
    if (keys["s"] || keys["arrowdown"])  dy += 1;
    if (keys["a"] || keys["arrowleft"])  dx -= 1;
    if (keys["d"] || keys["arrowright"]) dx += 1;
    if (dx !== 0 || dy !== 0) {
      const len = Math.sqrt(dx*dx + dy*dy);
      dx /= len; dy /= len;
      state.player.moving = true;
    } else {
      state.player.moving = false;
    }
    state.player.dirX = dx;
    state.player.dirY = dy;

    const mdx = mouseCanvasX - state.player.x;
    const mdy = mouseCanvasY - state.player.y;
    if (mdx !== 0 || mdy !== 0) {
      state.player.facing = Math.atan2(mdy, mdx);
    }
  }

  // =========================================================================
  // 9. NPC UPDATE
  // =========================================================================

  function updateGirl(g, ph, dt) {
    if (state.airpodT > 0) {
      // AirPods → all girls look at phone (facing up)
      g.facing = -Math.PI / 2;
      return;
    }

    if (state.decoy) {
      // Decoy → girl is glued to it
      const dx = state.decoy.x - g.x;
      const dy = state.decoy.y - g.y;
      const targetFacing = Math.atan2(dy, dx);
      const diff = normalizeAngle(targetFacing - g.facing);
      const turnRate = 3.5 * dt;
      if (Math.abs(diff) < turnRate) g.facing = targetFacing;
      else g.facing += Math.sign(diff) * turnRate;
      return;
    }

    g.modeT += dt;

    // Phone check (every phoneCycle seconds, for 2s)
    if (!g.phoneActive) {
      g.phoneT += dt;
      if (g.phoneT > g.phoneCycle && Math.random() < ph.phoneChance) {
        g.phoneActive = true;
        g.phoneT = 0;
      }
    }
    if (g.phoneActive) {
      g.facing = -Math.PI / 2;  // look at phone (up)
      if (g.phoneT > 2.0) {
        g.phoneActive = false;
        g.phoneT = 0;
        g.phoneCycle = rand(5, 10);
      }
      return;
    }

    if (g.mode === "exercising") {
      // At a waypoint, facing the rack/mirror/etc.
      // Pick a facing based on which waypoint we're at
      const wp = g.waypoints[0];
      // For the starting waypoint, face right (mirror wall).
      // For other waypoints, face toward the center of the gym.
      const wpX = g.waypoints.find(w => w.x === g.x && w.y === g.y);
      if (wpX) {
        if (wpX.x < 200) g.facing = 0;        // facing right (mirror)
        else if (wpX.x > 440) g.facing = Math.PI; // facing left
        else if (wpX.y < 200) g.facing = Math.PI / 2; // facing down
        else if (wpX.y > 440) g.facing = -Math.PI / 2; // facing up
        else g.facing = 0;
      } else {
        // We just arrived — pick a sensible facing
        g.facing = 0;
      }
      if (g.modeT > g.stayDuration) {
        g.mode = "walking";
        g.modeT = 0;
        // Pick a new target waypoint (not the current one)
        const others = g.waypoints.filter((_, i) => i !== 0);
        const newTarget = choice(others);
        g.targetX = newTarget.x;
        g.targetY = newTarget.y;
      }
    } else {
      // Walking
      const dx = g.targetX - g.x;
      const dy = g.targetY - g.y;
      const d = Math.hypot(dx, dy);
      if (d < 4) {
        // Arrived — snap to waypoint, start exercising
        g.x = g.targetX;
        g.y = g.targetY;
        // Set the "current waypoint" to this one for facing logic
        g.waypoints = [g.waypoints.find(w => w.x === g.targetX && w.y === g.targetY), ...g.waypoints.filter(w => !(w.x === g.targetX && w.y === g.targetY))];
        g.mode = "exercising";
        g.modeT = 0;
        g.stayDuration = rand(ph.stayMin, ph.stayMax);
      } else {
        const vx = (dx / d) * g.speed;
        const vy = (dy / d) * g.speed;
        g.x += vx * dt;
        g.y += vy * dt;
        // Head turn follows velocity
        const targetFacing = Math.atan2(vy, vx);
        const diff = normalizeAngle(targetFacing - g.facing);
        const turnRate = 2.5 * dt;
        if (Math.abs(diff) < turnRate) g.facing = targetFacing;
        else g.facing += Math.sign(diff) * turnRate;
      }
    }
  }

  function updateFilmer(f, dt) {
    if (state.airpodT > 0) { f.facing = -Math.PI / 2; return; }
    if (state.decoy) {
      const dx = state.decoy.x - f.x;
      const dy = state.decoy.y - f.y;
      const targetFacing = Math.atan2(dy, dx);
      const diff = normalizeAngle(targetFacing - f.facing);
      f.facing += Math.sign(diff) * Math.min(Math.abs(diff), 3.0 * dt);
      return;
    }
    // Walk the perimeter
    f.perimeterT += dt;
    // 4 sides, each takes 6 seconds at speed 25 (perimeter ~600u)
    const side = Math.floor(f.perimeterT / 6) % 4;
    const sideT = (f.perimeterT / 6) % 1;
    const P_TOP = { from: {x: 60, y: 60}, to: {x: 580, y: 60} };
    const P_RIGHT = { from: {x: 580, y: 60}, to: {x: 580, y: 580} };
    const P_BOTTOM = { from: {x: 580, y: 580}, to: {x: 60, y: 580} };
    const P_LEFT = { from: {x: 60, y: 580}, to: {x: 60, y: 60} };
    const sides = [P_TOP, P_RIGHT, P_BOTTOM, P_LEFT];
    const seg = sides[side];
    f.x = lerp(seg.from.x, seg.to.x, sideT);
    f.y = lerp(seg.from.y, seg.to.y, sideT);
    // Facing: inward + pan
    f.panT += dt;
    // Pan left-right
    f.facing = (side === 0 ? Math.PI/2 : side === 1 ? Math.PI : side === 2 ? -Math.PI/2 : 0) + Math.sin(f.panT * 0.6) * 0.7;
  }

  function updateTrainer(t, dt) {
    if (state.airpodT > 0) { t.facing = -Math.PI / 2; return; }
    if (state.decoy) {
      const dx = state.decoy.x - t.x;
      const dy = state.decoy.y - t.y;
      const targetFacing = Math.atan2(dy, dx);
      const diff = normalizeAngle(targetFacing - t.facing);
      t.facing += Math.sign(diff) * Math.min(Math.abs(diff), 4.0 * dt);
      return;
    }
    const dx = t.target.x - t.x;
    const dy = t.target.y - t.y;
    const d = Math.hypot(dx, dy);
    if (d < 8) {
      t.target = choice(WAYPOINTS);
    } else {
      t.x += (dx / d) * t.speed * dt;
      t.y += (dy / d) * t.speed * dt;
      const targetFacing = Math.atan2(dy, dx);
      const diff = normalizeAngle(targetFacing - t.facing);
      const turnRate = 3.0 * dt;
      if (Math.abs(diff) < turnRate) t.facing = targetFacing;
      else t.facing += Math.sign(diff) * turnRate;
    }
  }

  // =========================================================================
  // 10. PLAYER UPDATE
  // =========================================================================

  function updatePlayer(dt) {
    const p = state.player;
    let speed = PLAYER_SPEED;
    if (state.panic > 0) {
      speed *= PANIC_SPEED_MULT;
      state.panic -= dt;
    }
    if (state.boyfriendT > 0) {
      state.boyfriendT -= dt;
      state.boyfriendFlash = 0.5 + 0.5 * Math.sin(state.t * 14);
    }
    const cover = pointInCover(p.x, p.y);
    state.inCover = !!cover;
    if (cover) speed *= 1.3;

    p.x += p.dirX * speed * dt;
    p.y += p.dirY * speed * dt;
    p.x = clamp(p.x, PLAYER_RADIUS, W - PLAYER_RADIUS);
    p.y = clamp(p.y, PLAYER_RADIUS, H - PLAYER_RADIUS);
  }

  // =========================================================================
  // 11. GAZE / SHAME UPDATE (multi-NPC)
  // =========================================================================

  function isInPlayerGaze(targetX, targetY, halfAngle) {
    if (!state.gaze.active) return false;
    const dx = targetX - state.player.x;
    const dy = targetY - state.player.y;
    if (Math.hypot(dx, dy) > state.gaze.range) return false;
    const angle = Math.atan2(dy, dx);
    return Math.abs(normalizeAngle(angle - state.player.facing)) <= (halfAngle || state.gaze.halfAngle);
  }

  function isInNpcCone(npcX, npcY, npcFacing, range, halfAngle) {
    const dx = state.player.x - npcX;
    const dy = state.player.y - npcY;
    if (Math.hypot(dx, dy) > range) return false;
    const angle = Math.atan2(dy, dx);
    return Math.abs(normalizeAngle(angle - npcFacing)) <= halfAngle;
  }

  function updateGauges(dt) {
    if (state.airpodT > 0) state.gaze.active = false;
    else state.gaze.active = true;

    const ph = PHASES[state.phase - 1];
    const covered = state.gaze.active ? gazeBlocked(state.player.x, state.player.y, state.player.facing) : false;

    // Count how many girls are in player's gaze (contributes to shame)
    let girlsInGaze = 0;
    if (state.gaze.active && !covered) {
      for (const g of state.girls) {
        if (isInPlayerGaze(g.x, g.y, ph.coneWidth)) girlsInGaze++;
      }
    }

    // Count filmers and trainers in player's gaze
    let filmerInGaze = 0;
    if (state.gaze.active && !covered && state.filmer) {
      if (isInPlayerGaze(state.filmer.x, state.filmer.y, 0.85)) filmerInGaze++;
    }
    let trainerInGaze = 0;
    if (state.gaze.active && !covered && state.trainer) {
      if (isInPlayerGaze(state.trainer.x, state.trainer.y, 0.95)) trainerInGaze++;
    }

    const totalShameGain = girlsInGaze * SHAME_GAIN_GIRL +
                           filmerInGaze * SHAME_GAIN_FILMER +
                           trainerInGaze * SHAME_GAIN_TRAINER;

    if (state.boyfriendT > 0) {
      // Boyfriend shield: shame does not accumulate
      state.shame = Math.max(0, state.shame - SHAME_DECAY * 2 * dt);
    } else if (totalShameGain > 0) {
      state.shame = Math.min(SHAME_MAX, state.shame + totalShameGain * dt);
      state.heart = Math.min(HEART_MAX, state.heart + HEART_GAIN * dt);
    } else {
      state.shame = Math.max(0, state.shame - SHAME_DECAY * dt);
      state.heart = Math.max(0, state.heart - HEART_DECAY * dt);
    }

    // Track shame total
    state.shameTotal += state.shame * dt * 4;
    state.shameTotal = Math.floor(state.shameTotal);

    // Heart full → panic
    if (state.heart >= HEART_MAX && state.panic <= 0) {
      state.panic = PANIC_DURATION;
      state.shame = Math.max(0, state.shame - 1.0);
      state.heart = 0;
      state.cam.shake = Math.max(state.cam.shake, 0.4);
      showBanner("⚠ PANIC — HEART RATE SPIKE", 1.2);
    }

    // Shame at max → game over (unless Boyfriend active)
    if (state.shame >= SHAME_MAX) {
      state.shame = SHAME_MAX;
      if (!state.gameOver && state.boyfriendT <= 0) {
        triggerShame();
      }
    }
  }

  function checkPhaseProgress() {
    if (state.player.x >= W - 24) {
      if (state.phase < PHASES.length) {
        state.phase++;
        state.player.x = 40;
        state.player.y = 320;
        spawnPhase(state.phase);
        showBanner("PHASE " + state.phase + " · " + PHASES[state.phase - 1].name, 2.0);
        RB.toast(PHASE_INTROS[state.phase - 1] || "Next phase", "");
        state.cam.shake = 0.2;
      } else {
        triggerWin();
      }
    }
  }

  function updateCam(dt) {
    state.cam.shake = Math.max(0, state.cam.shake - dt * 2);
    state.cam.flash = Math.max(0, state.cam.flash - dt * 3);
  }

  // =========================================================================
  // 12. PHASE SPAWN
  // =========================================================================

  function spawnPhase(phaseNum) {
    const ph = PHASES[phaseNum - 1];
    // Spawn girls
    state.girls = [];
    for (let i = 0; i < ph.numGirls; i++) {
      const g = makeGirl(i);
      g.speed = ph.girlSpeed;
      // Phase 1: stay still (tutorial). Others: stay between stayMin and stayMax.
      if (phaseNum === 1) {
        g.stayDuration = 9999;
      } else {
        g.stayDuration = rand(ph.stayMin, ph.stayMax);
      }
      state.girls.push(g);
    }
    // Filmer
    state.filmer = ph.hasFilmer ? makeFilmer() : null;
    // Trainer
    state.trainer = ph.hasTrainer ? makeTrainer() : null;
  }

  // =========================================================================
  // 13. GAME FLOW
  // =========================================================================

  function startGame() {
    if (state.started) return;
    state.started = true;
    state.running = true;
    state.gameOver = false;
    state.won = false;
    state.phase = 1;
    state.shame = 0;
    state.heart = 0;
    state.shameTotal = 0;
    state.shameHits = 0;
    state.panic = 0;
    state.airpodT = 0;
    state.boyfriendT = 0;
    state.decoy = null;
    state.player.x = 40;
    state.player.y = 320;
    spawnPhase(1);
    state.t = 0;
    document.getElementById("overlay").classList.remove("overlay--show");
    showBanner("PHASE 1 · " + PHASES[0].name, 2.0);
    requestAnimationFrame(loop);
  }

  function triggerShame() {
    state.gameOver = true;
    state.running = false;
    state.shameHits++;
    state.cam.shake = 0.8;
    state.cam.flash = 1.0;
    showShameCard();
  }

  function triggerWin() {
    state.won = true;
    state.running = false;
    state.cam.flash = 0.6;
    const distScore = 100;
    const shameBonus = Math.max(0, 8000 - state.shameTotal);
    const finalScore = distScore + shameBonus;
    RB.recordScore("dont-look-gym-girl", finalScore);
    showWinCard(finalScore);
  }

  function restart() {
    document.getElementById("shame-mount").innerHTML = "";
    document.getElementById("panic-banner").style.display = "none";
    document.getElementById("overlay").classList.add("overlay--show");
    document.getElementById("overlay-title").innerHTML = "👀 READY?";
    document.getElementById("overlay-sub").innerHTML = `
      You're at the <strong style="color:var(--accent-3)">front door</strong>. The gym is full of women in skanky leggings.
      You need to get to the <strong style="color:var(--accent-2)">locker room</strong>.
      <br><br>
      <strong style="color:var(--accent)">Don't. Look. At. Any. Of. Them.</strong>
      <br>
      <em style="color:var(--ink-dim);font-size:13px;">
        WASD/arrows to move · mouse to look · click to start
      </em>
    `;
    state.started = false;
    state.gameOver = false;
    state.won = false;
    state.running = false;
    state.phase = 1;
    state.shame = 0;
    state.heart = 0;
    state.shameTotal = 0;
    state.shameHits = 0;
    state.panic = 0;
    state.airpodT = 0;
    state.boyfriendT = 0;
    state.decoy = null;
    state.player.x = 40;
    state.player.y = 320;
    state.girls = [];
    state.filmer = null;
    state.trainer = null;
    state.t = 0;
  }

  // =========================================================================
  // 14. UI: cards, banner, power buttons
  // =========================================================================

  function showBanner(text, duration) {
    const b = document.getElementById("panic-banner");
    b.textContent = text;
    b.style.display = "block";
    b.style.animation = "none";
    void b.offsetWidth;
    b.style.animation = "panicFlash 0.5s steps(2) " + (duration || 1.2) + " forwards";
    setTimeout(() => { b.style.display = "none"; }, (duration || 1.2) * 1000);
  }

  function showShameCard() {
    const high = RB.getHighScore("dont-look-gym-girl") || 0;
    const score = Math.max(0, 8000 - state.shameTotal);
    const cap = choice(SHAME_CAPTIONS);

    document.getElementById("shame-mount").innerHTML = `
      <div class="shame-card">
        <h3 class="shame-card__title">📢 PUBLICLY SHAMED</h3>
        <p class="shame-card__sub">They filmed you. The video is up. ${state.shameHits} shame ${state.shameHits === 1 ? "event" : "events"} this run.</p>
        <div class="shame-card__stats">
          Phase reached: <strong>${state.phase}</strong>/${PHASES.length} · Shame total: <strong>${state.shameTotal}</strong><br>
          High score: <strong>${Math.max(score, high)}</strong>
        </div>
        <div class="shame-card__caption">"${cap}"</div>
        <div class="shame-card__actions">
          <button class="btn btn--primary" id="shame-retry">Try again</button>
          <a class="btn btn--ghost" href="../games.html">All games</a>
        </div>
      </div>
    `;
    document.getElementById("shame-retry").addEventListener("click", restart);
  }

  function showWinCard(score) {
    const high = RB.getHighScore("dont-look-gym-girl") || 0;
    const isNewHigh = score > high;
    if (isNewHigh) RB.recordScore("dont-look-gym-girl", score);

    document.getElementById("shame-mount").innerHTML = `
      <div class="win-card">
        <h3 class="win-card__title">🚪 YOU MADE IT</h3>
        <p class="shame-card__sub">You crossed the gym floor past every single one of them. Your mom didn't see anything. Your boss didn't see anything. You can go back next week. Maybe.</p>
        <div class="shame-card__stats">
          Phases cleared: <strong>${PHASES.length}</strong>/${PHASES.length}<br>
          Shame total: <strong>${state.shameTotal}</strong><br>
          Final score: <strong>${score}</strong> ${isNewHigh ? "🆕 NEW HIGH" : ""}
        </div>
        <div class="win-card__caption">"I was just here for the leg press. I didn't even see them."</div>
        <div class="shame-card__actions">
          <button class="btn btn--primary" id="win-again">Run it back</button>
          <a class="btn btn--ghost" href="../games.html">All games</a>
        </div>
      </div>
    `;
    document.getElementById("win-again").addEventListener("click", restart);
  }

  // ---- Power-up buttons ----
  let _rbPowerCache = { shield: 0, boost: 0, nuke: 0, airpods: 0, boyfriend: 0, decoy: 0 };
  if (typeof RB !== "undefined" && RB.subscribe) {
    RB.subscribe((s) => { _rbPowerCache = s.powerups || _rbPowerCache; });
  }
  function readPowerCount(key) {
    if (_rbPowerCache[key] !== undefined) return _rbPowerCache[key];
    try {
      const raw = localStorage.getItem("ets_state_v1");
      if (raw) {
        const obj = JSON.parse(raw);
        return (obj.powerups && obj.powerups[key]) || 0;
      }
    } catch (e) {}
    return 0;
  }
  function updatePowerButtons() {
    document.querySelectorAll(".gym-power").forEach(btn => {
      const key = btn.dataset.power;
      const count = readPowerCount(key);
      const countEl = btn.querySelector(".gym-power__count");
      if (count > 0) {
        btn.dataset.empty = "false";
        countEl.textContent = "×" + count;
      } else {
        btn.dataset.empty = "true";
        countEl.textContent = "+AD";
      }
    });
  }
  function usePowerup(key) {
    const count = readPowerCount(key);
    if (count <= 0) { RB.toast("You don't have any of those. Watch an ad first.", "bad"); return; }
    if (!RB.consumePowerup(key)) { RB.toast("Couldn't use that. Try again.", "bad"); return; }
    if (key === "airpods") {
      state.airpodT = 8.0;
      RB.toast("🎧 Cone vanished for 8s. Walk.", "good");
    } else if (key === "boyfriend") {
      state.boyfriendT = 5.0;
      RB.toast("👔 'I'm her boyfriend.' They didn't even look.", "good");
    } else if (key === "decoy") {
      const target = choice(DECOY_TARGETS);
      state.decoy = { x: target.x, y: target.y, life: 2.5, maxLife: 2.5 };
      RB.toast("🎭 Decoy deployed. Everyone turns.", "good");
    }
    updatePowerButtons();
  }

  function renderPowerButtons() {
    const defs = [
      { key: "airpods",   icon: "🎧", label: "AirPods Max 2.0",   desc: "Cone vanishes · 8s" },
      { key: "boyfriend", icon: "👔", label: "I'm Her Boyfriend", desc: "Walk through their line · 5s" },
      { key: "decoy",     icon: "🎭", label: "Decoy Drop",        desc: "Everyone turns · 2.5s" }
    ];
    document.getElementById("gym-powers").innerHTML = defs.map(d => `
      <button class="gym-power" data-power="${d.key}" data-empty="true" title="${d.desc} — watch a rewarded ad to earn one">
        <span>${d.icon}</span>
        <span>${d.label}</span>
        <span class="gym-power__count" data-count="${d.key}">+AD</span>
      </button>
    `).join("");
    document.querySelectorAll(".gym-power").forEach(btn => {
      btn.addEventListener("click", async () => {
        const key = btn.dataset.power;
        if (btn.dataset.empty !== "true") { usePowerup(key); return; }
        const ok = await RB.showRewarded();
        if (ok) {
          RB.grantPowerup(key);
          RB.toast("Earned " + key + "!", "good");
          updatePowerButtons();
        } else {
          RB.toast("Watch the full ad to earn it", "bad");
        }
      });
    });
    updatePowerButtons();
    RB.subscribe(updatePowerButtons);
  }

  // =========================================================================
  // 15. RENDER
  // =========================================================================

  function drawGymFloor() {
    ctx.fillStyle = "#1a1a24";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    const tile = 40;
    for (let x = 0; x <= W; x += tile) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += tile) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    // Door
    ctx.fillStyle = "#2a3a2a";
    ctx.fillRect(8, 240, 14, 160);
    ctx.fillStyle = "#4dff7d";
    ctx.font = "11px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.fillText("FRONT", 4, 232);
    ctx.fillText("DOOR", 4, 412);
    // Locker room
    ctx.fillStyle = "#3a2a3a";
    ctx.fillRect(W - 22, 240, 14, 160);
    ctx.fillStyle = "#ff7ddf";
    ctx.textAlign = "right";
    ctx.fillText("LOCKER", W - 4, 232);
    ctx.fillText("ROOM", W - 4, 412);
  }

  function drawCovers() {
    for (const c of COVERS) {
      ctx.save();
      if (c.kind === "rack") {
        ctx.fillStyle = "#3a2a3a";
        ctx.fillRect(c.x - c.w/2, c.y - c.h/2, c.w, c.h);
        ctx.strokeStyle = "#ff2e88";
        ctx.lineWidth = 2;
        ctx.strokeRect(c.x - c.w/2, c.y - c.h/2, c.w, c.h);
        ctx.fillStyle = "#888";
        for (let i = 0; i < 3; i++) {
          const yy = c.y - c.h/2 + 12 + i * 14;
          ctx.fillRect(c.x - c.w/2 + 4, yy, c.w - 8, 3);
        }
      } else if (c.kind === "bench") {
        ctx.fillStyle = "#2a3a4a";
        ctx.fillRect(c.x - c.w/2, c.y - c.h/2, c.w, c.h);
        ctx.strokeStyle = "#2ee0ff";
        ctx.lineWidth = 2;
        ctx.strokeRect(c.x - c.w/2, c.y - c.h/2, c.w, c.h);
      } else if (c.kind === "locker") {
        ctx.fillStyle = "#3a3a4a";
        ctx.fillRect(c.x - c.w/2, c.y - c.h/2, c.w, c.h);
        ctx.strokeStyle = "#f7d716";
        ctx.lineWidth = 2;
        ctx.strokeRect(c.x - c.w/2, c.y - c.h/2, c.w, c.h);
        ctx.fillStyle = "#f7d716";
        ctx.beginPath();
        ctx.arc(c.x - c.w/4, c.y, 2, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "9px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText(c.label, c.x, c.y + c.h/2 + 12);
      ctx.restore();
    }
  }

  function drawNpcCone(x, y, facing, range, halfAngle, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(facing);
    const grad = ctx.createLinearGradient(0, 0, range, 0);
    grad.addColorStop(0, color.replace("ALPHA", "0.35"));
    grad.addColorStop(1, color.replace("ALPHA", "0.0"));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, range, -halfAngle, halfAngle);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = color.replace("ALPHA", "0.4");
    ctx.beginPath();
    ctx.arc(0, 0, range, -halfAngle, halfAngle);
    ctx.stroke();
    ctx.restore();
  }

  function drawGirl(g) {
    ctx.save();
    ctx.translate(g.x, g.y);
    const legPulse = 1 + 0.08 * Math.sin(state.t * 3.2 + g.index);
    ctx.fillStyle = g.leggings;
    ctx.beginPath();
    ctx.ellipse(-6, 10 * legPulse, 5, 12 * legPulse, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(6, 10 * legPulse, 5, 12 * legPulse, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = g.leggings;
    ctx.beginPath();
    ctx.arc(0, -3, 10, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#f1c27d";
    ctx.beginPath();
    ctx.arc(0, -14, 7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#3a1a0a";
    ctx.beginPath();
    ctx.arc(0, -17, 6, Math.PI, 0);
    ctx.fill();
    if (g.phoneActive) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(-5, -18, 10, 7);
      ctx.fillStyle = "#000";
      ctx.fillRect(-4, -17, 8, 5);
    }
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "8px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(g.label, 0, 28);
    ctx.restore();
  }

  function drawFilmer(f) {
    ctx.save();
    ctx.translate(f.x, f.y);
    // Guy with phone
    ctx.fillStyle = "#5a3a2a";
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#f1c27d";
    ctx.beginPath();
    ctx.arc(0, -8, 6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#1a0a0a";
    ctx.beginPath();
    ctx.arc(0, -10, 5, Math.PI, 0);
    ctx.fill();
    // Phone in front of face
    ctx.fillStyle = "#fff";
    ctx.fillRect(-5, -7, 10, 8);
    ctx.fillStyle = "#000";
    ctx.fillRect(-4, -6, 8, 6);
    ctx.fillStyle = "rgba(255,46,136,0.7)";
    ctx.font = "8px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText("📹 FILMER", 0, 22);
    ctx.restore();
  }

  function drawTrainer(t) {
    ctx.save();
    ctx.translate(t.x, t.y);
    // Big guy
    ctx.fillStyle = "#2a4a2a";
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#f1c27d";
    ctx.beginPath();
    ctx.arc(0, -10, 7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#0a0a0a";
    ctx.beginPath();
    ctx.arc(0, -12, 6, Math.PI, 0);
    ctx.fill();
    // Whistle
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(0, -4, 2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(46,224,255,0.8)";
    ctx.font = "8px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText("🏋️ TRAINER", 0, 26);
    ctx.restore();
  }

  function drawGazeCone() {
    const p = state.player;
    if (!state.gaze.active) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.translate(p.x, p.y);
      ctx.fillStyle = "#2ee0ff";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 18, p.facing - 0.3, p.facing + 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }
    const covered = gazeBlocked(p.x, p.y, p.facing);
    const blockedRange = covered ? 30 : state.gaze.range;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.facing);
    const grad = ctx.createLinearGradient(0, 0, blockedRange, 0);
    grad.addColorStop(0, "rgba(247,215,22,0.30)");
    grad.addColorStop(1, "rgba(247,215,22,0.0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, blockedRange, -state.gaze.halfAngle, state.gaze.halfAngle);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(247,215,22,0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(blockedRange, 0);
    ctx.stroke();
    ctx.strokeStyle = "rgba(247,215,22,0.4)";
    ctx.beginPath();
    ctx.arc(0, 0, blockedRange, -state.gaze.halfAngle, state.gaze.halfAngle);
    ctx.stroke();
    ctx.restore();
  }

  function drawDecoy() {
    if (!state.decoy) return;
    const d = state.decoy;
    ctx.save();
    ctx.globalAlpha = 0.4 + 0.6 * (d.life / d.maxLife);
    ctx.translate(d.x, d.y);
    ctx.fillStyle = "#2ee0ff";
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#0a0a14";
    ctx.font = "16px Arial";
    ctx.textAlign = "center";
    ctx.fillText("🚪", 0, 5);
    ctx.restore();
  }

  function drawPlayer() {
    const p = state.player;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (state.panic > 0) {
      ctx.fillStyle = "rgba(255,46,136,0.3)";
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER_RADIUS + 8, 0, TAU);
      ctx.fill();
    }
    const bodyColor = state.boyfriendT > 0 ? "#2ee0ff" : "#f1c27d";
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_RADIUS, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#f1c27d";
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_RADIUS, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#2a1a0a";
    ctx.beginPath();
    ctx.arc(0, -3, PLAYER_RADIUS * 0.7, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "#000";
    const ex = Math.cos(p.facing) * 4;
    const ey = Math.sin(p.facing) * 4;
    ctx.beginPath();
    ctx.arc(ex, ey, 1.5, 0, TAU);
    ctx.fill();
    if (state.boyfriendT > 0) {
      ctx.strokeStyle = "rgba(46,224,255," + state.boyfriendFlash + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER_RADIUS + 4 + Math.sin(state.t * 10) * 2, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawHud() {
    const shameEl = document.getElementById("hud-shame");
    if (shameEl && shameEl.childElementCount !== SHAME_MAX) {
      shameEl.innerHTML = "";
      for (let i = 0; i < SHAME_MAX; i++) {
        const p = document.createElement("span");
        p.className = "shame-pip";
        shameEl.appendChild(p);
      }
    }
    if (shameEl) {
      const pips = shameEl.querySelectorAll(".shame-pip");
      const s = state.shame;
      pips.forEach((pip, i) => {
        if (i < Math.floor(s)) pip.dataset.state = "crit";
        else if (i < s) pip.dataset.state = "med";
        else if (s === 0) pip.dataset.state = "";
        else pip.dataset.state = "low";
      });
    }
    const heartEl = document.getElementById("hud-heart");
    if (heartEl && heartEl.childElementCount !== HEART_MAX) {
      heartEl.innerHTML = "";
      for (let i = 0; i < HEART_MAX; i++) {
        const p = document.createElement("span");
        p.className = "heart-pip";
        heartEl.appendChild(p);
      }
    }
    if (heartEl) {
      const pips = heartEl.querySelectorAll(".heart-pip");
      pips.forEach((pip, i) => {
        pip.dataset.state = i < state.heart ? (state.panic > 0 ? "panic" : "on") : "";
      });
    }
    const distPct = Math.floor((state.player.x / W) * 100);
    document.getElementById("hud-dist").textContent = distPct + "%";
    document.getElementById("hud-phase").textContent = state.phase + "/" + PHASES.length;
    document.getElementById("hud-shametotal").textContent = state.shameTotal;
    const high = RB.getHighScore("dont-look-gym-girl") || 0;
    document.getElementById("hud-high").textContent = high;
  }

  function render() {
    let sx = 0, sy = 0;
    if (state.cam.shake > 0) {
      sx = (Math.random() - 0.5) * state.cam.shake * 14;
      sy = (Math.random() - 0.5) * state.cam.shake * 14;
    }
    ctx.save();
    ctx.translate(sx, sy);
    if (state.cam.flash > 0) {
      ctx.fillStyle = "rgba(255,46,136," + (state.cam.flash * 0.6) + ")";
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    drawGymFloor();
    drawCovers();

    // NPC gaze cones (rendered behind the NPCs)
    const ph = PHASES[state.phase - 1];
    if (state.boyfriendT <= 0 && !state.decoy) {
      for (const g of state.girls) {
        if (g.phoneActive) continue;
        drawNpcCone(g.x, g.y, g.facing, state.gaze.range * 0.9, ph.coneWidth, "rgba(255,46,136,ALPHA)");
      }
      if (state.filmer) drawNpcCone(state.filmer.x, state.filmer.y, state.filmer.facing, state.gaze.range * 1.1, 0.85, "rgba(255,46,136,ALPHA)");
      if (state.trainer) drawNpcCone(state.trainer.x, state.trainer.y, state.trainer.facing, state.gaze.range, 0.95, "rgba(255,46,136,ALPHA)");
    }

    drawDecoy();

    // NPCs
    for (const g of state.girls) drawGirl(g);
    if (state.filmer) drawFilmer(state.filmer);
    if (state.trainer) drawTrainer(state.trainer);

    drawGazeCone();
    drawPlayer();
    ctx.restore();
    drawHud();
  }

  // =========================================================================
  // 16. MAIN LOOP
  // =========================================================================

  function loop(now) {
    if (!state.lastTime) state.lastTime = now;
    const dt = Math.min(0.05, (now - state.lastTime) / 1000);
    state.lastTime = now;
    state.t += dt;

    if (state.running && !state.paused) {
      readInput(dt);
      updatePlayer(dt);
      const ph = PHASES[state.phase - 1];
      for (const g of state.girls) updateGirl(g, ph, dt);
      if (state.filmer) updateFilmer(state.filmer, dt);
      if (state.trainer) updateTrainer(state.trainer, dt);
      // Decoy lifetime
      if (state.decoy) {
        state.decoy.life -= dt;
        if (state.decoy.life <= 0) state.decoy = null;
      }
      updateGauges(dt);
      updateCam(dt);
      checkPhaseProgress();
    } else if (!state.running && !state.gameOver && !state.won) {
      render();
    }
    if (state.started) render();
    requestAnimationFrame(loop);
  }

  // =========================================================================
  // 17. BOOT
  // =========================================================================

  function init() {
    requestAnimationFrame(loop);
    document.getElementById("btn-primary").addEventListener("click", startGame);
    document.getElementById("btn-pause").addEventListener("click", () => {
      state.paused = !state.paused;
      document.getElementById("btn-pause").textContent = state.paused ? "Resume" : "Pause";
    });
    document.getElementById("btn-restart").addEventListener("click", restart);
    renderPowerButtons();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
