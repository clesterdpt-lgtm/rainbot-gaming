/* ============================================
   DON'T LOOK AT THE GYM GIRL — v3 (THE REMAKE)
   --------------------------------------------
   Premise: get from the FRONT DOOR (left) to the
   LOCKER ROOM (right) without getting accused of
   being a pervert.

   What's new in v3:
   - 8 hand-built LEVELS. Each level adds more
     equipment (real obstacles: they block movement
     AND line of sight) and more girls.
   - THE NECK™: your gaze is magnetically pulled
     toward the nearest girl. The pull gets stronger
     every level. Fight it with the mouse.
   - CAUGHT IN 4K: sus only builds while YOU look.
     If she's looking back at you while you look,
     her notice meter ("?" → "!") fills — hold the
     mutual stare too long and she accuses you on
     the spot.
   - EYES CLOSED (hold SPACE): zero sus, but the
     screen goes dark, you walk slower, and bumping
     into a girl blind is an instant bust.
   - FLOOR HAZARDS: loose water bottles trip you,
     stun you briefly, and slide you into bad lanes.
   - PEAK HOURS CROWD: extra gym girls plus regular
     people moving through lanes and crowding routes.

   Girl types:
   - lifter:     stationary, periodically turns
                 around to scan behind her
   - walker:     patrols waypoints
   - stepper:    stair-stepper at the wall, faces
                 away, HUGE gaze pull, quick
                 over-shoulder checks
   - scanner:    stationary, cone rotates 360°
   - influencer: ring light, very wide cone,
                 2× sus, periodically flips 180°

   Debug hook: window.__GYM
   ============================================ */

(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const SCRIPT_URL = new URL(document.currentScript ? document.currentScript.src : window.location.href);
  const ART_ROOT = new URL("../img/gym-girl/", SCRIPT_URL);
  const ART_VERSION = "20260624-layout-1";
  const RASTER_ART = {
    backdrop: loadRasterArt("generated-gym-floor-backdrop.png"),
    sprites: loadRasterArt("generated-gym-sprite-sheet.png"),
  };
  const SPRITE_CELLS = {
    player: { sx: 91, sy: 31, sw: 187, sh: 285 },
    girlLifter: { sx: 374, sy: 29, sw: 315, sh: 298 },
    girlWalker: { sx: 820, sy: 35, sw: 162, sh: 310 },
    girlInfluencer: { sx: 1142, sy: 38, sw: 224, sh: 296 },
    bruiser: { sx: 87, sy: 371, sw: 196, sh: 353 },
    patron: { sx: 444, sy: 374, sw: 177, sh: 350 },
    bottle: { sx: 812, sy: 408, sw: 153, sh: 316 },
    bench: { sx: 1097, sy: 387, sw: 310, sh: 295 },
    treadmill: { sx: 83, sy: 724, sw: 203, sh: 305 },
    cable: { sx: 426, sy: 724, sw: 214, sh: 292 },
    plant: { sx: 768, sy: 724, sw: 219, sh: 275 },
    stairs: { sx: 1087, sy: 727, sw: 276, sh: 270 },
  };

  // =========================================================================
  // 1. TUNING
  // =========================================================================
  const PLAYER_SPEED       = 134;
  const PLAYER_SPEED_BLIND = 66;     // eyes closed
  const PLAYER_RADIUS      = 11;
  const GIRL_RADIUS        = 12;

  const GAZE_RANGE      = 252;
  const GAZE_HALF_ANGLE = 0.52;

  const SUS_MAX        = 100;
  const SUS_DECAY      = 7.1;    // %/sec when not looking
  const SUS_DECAY_SHUT = 9.0;    // %/sec eyes closed
  const SUS_GAIN_BASE  = 29;     // %/sec, one girl, point blank
  const SUS_MUTUAL_MULT = 2.75;  // she sees you seeing her
  const SUS_BUMP       = 18;     // walked into a girl (eyes open)
  const BRUISER_SMACK_SUS = 14;  // got loud near a territorial gym bro
  const BRUISER_RADIUS = 22;
  const BRUISER_AGGRO_SCALE = 0.86;
  const BRUISER_CHASE_MULT = 1.25;
  const WATER_BOTTLE_RADIUS = 9;
  const WATER_BOTTLE_TRIGGER = 22;
  const WATER_BOTTLE_TRIP_SUS = 11;
  const PATRON_RADIUS = 13;
  const PATRON_BUMP_SUS = 5;
  const STAIR_RADIUS = 26;
  const STAIR_TRIGGER_RADIUS = 48;
  const STAIR_LANDING_OFFSET = STAIR_TRIGGER_RADIUS + PLAYER_RADIUS + 10;
  const STAIR_COOLDOWN = 0.8;

  const NOTICE_TIME   = 0.94;    // sustained mutual stare → accused
  const NOTICE_DECAY  = 0.45;    // /sec when stare breaks

  const PULL_RANGE   = 354;      // the neck activates inside this radius
  const DRIFT_BASE   = 6.65;     // rad/s at point blank × level pull
  const ASSIST_RATE  = 1.82;     // rad/s, gaze eases back to mouse
  const SNAP_RATE    = 9.0;      // rad/s, when no girl in pull range

  const DOOR_Y0 = 250, DOOR_Y1 = 390;   // door bands on both walls

  const WORLD_SCALE_X = 2.0;
  const WORLD_SCALE_Y = 2.0;
  const WORLD_W = W * WORLD_SCALE_X; // 1280
  const WORLD_H = H * WORLD_SCALE_Y; // 1280
  const WORLD_DOOR_Y0 = DOOR_Y0 * WORLD_SCALE_Y; // 500
  const WORLD_DOOR_Y1 = DOOR_Y1 * WORLD_SCALE_Y; // 780
  const GYM_HEAT_LABELS = ["WARMUP", "ACTIVE", "BUSY", "PACKED", "PEAK"];
  const LEVEL_PRESSURE = [1.18, 1.32, 1.48, 1.64, 1.82, 2.0, 2.18, 2.36];
  const LEVEL_DECAY_SCALE = [0.82, 0.76, 0.70, 0.64, 0.58, 0.53, 0.49, 0.45];

  // =========================================================================
  // 2. GIRL ARCHETYPES
  // =========================================================================
  const TYPES = {
    lifter:     { coneW: 0.64, range: 220, susMult: 1.12, pullW: 1.12, checkEvery: [3.0, 5.1], checkDur: 1.45 },
    walker:     { coneW: 0.70, range: 225, susMult: 1.08, pullW: 1.12 },
    stepper:    { coneW: 0.62, range: 230, susMult: 1.15, pullW: 2.15, checkEvery: [2.4, 4.2], checkDur: 1.05 },
    scanner:    { coneW: 0.70, range: 240, susMult: 1.12, pullW: 1.12, rotate: 0.9 },
    influencer: { coneW: 1.08, range: 270, susMult: 2.25, pullW: 1.55, flipEvery: [2.8, 4.8], flipDur: 2.4 }
  };

  // =========================================================================
  // 3. LEVELS — more obstacles, more girls, stronger neck every level
  //    Obstacles block movement AND line of sight (both ways — use as cover).
  //    kinds: rack, bench, tread, plant, fountain, cable, desk, ring
  // =========================================================================
  const LEVELS = [
    {
      name: "6 AM. DEAD.", sub: "One girl at the rack. Equipment breaks the straight lane. Exit: Right wall.",
      pull: 0.34, girlSpeed: 28, phoneChance: 0.18,
      exit: { side: "right", x: 640, y: 320 },
      obstacles: [
        { x: 200, y: 120, w: 56, h: 72, kind: "rack" },
        { x: 110, y: 250, w: 38, h: 38, kind: "plant" },
        { x: 410, y: 318, w: 84, h: 44, kind: "cable" },
        { x: 310, y: 430, w: 70, h: 40, kind: "bench" },
        { x: 520, y: 110, w: 38, h: 38, kind: "plant" },
        { x: 500, y: 540, w: 66, h: 36, kind: "fountain" }
      ],
      decor: [
        { x: 260, y: 360, kind: "mat" },
        { x: 120, y: 440, kind: "dumbbells" },
        { x: 380, y: 150, kind: "towel" },
        { x: 420, y: 520, kind: "shaker" }
      ],
      girls: [
        { type: "lifter", x: 320, y: 160, facing: -Math.PI / 2 }
      ]
    },
    {
      name: "THE CORNER LANE", sub: "Top-right corner blocked. Cover pockets force an L-shaped route. Exit: Top wall.",
      pull: 0.46, girlSpeed: 44, phoneChance: 0.16,
      exit: { side: "top", x: 160, y: 0 },
      obstacles: [
        { x: 480, y: 160, w: 320, h: 320, kind: "wall" },
        { x: 150, y: 150, w: 56, h: 72, kind: "rack" },
        { x: 90, y: 360, w: 40, h: 120, kind: "wall" },
        { x: 200, y: 460, w: 70, h: 40, kind: "bench" },
        { x: 400, y: 560, w: 38, h: 38, kind: "plant" },
        { x: 340, y: 400, w: 66, h: 36, kind: "fountain" }
      ],
      decor: [
        { x: 80, y: 120, kind: "towel" },
        { x: 250, y: 350, kind: "mat" },
        { x: 300, y: 520, kind: "dumbbells" },
        { x: 280, y: 440, kind: "kettlebell" },
        { x: 180, y: 560, kind: "shaker" }
      ],
      girls: [
        { type: "lifter", x: 150, y: 200, facing: Math.PI },
        { type: "walker", path: [[80, 220], [240, 220], [240, 480], [80, 480]] }
      ]
    },
    {
      name: "THE STEPPER WING", sub: "Bottom corners blocked. The center aisle pinches before the locker door.",
      pull: 0.58, girlSpeed: 52, phoneChance: 0.14,
      exit: { side: "bottom", x: 320, y: 640 },
      obstacles: [
        { x: 120, y: 520, w: 240, h: 240, kind: "wall" },
        { x: 520, y: 520, w: 240, h: 240, kind: "wall" },
        { x: 450, y: 112, w: 44, h: 80, kind: "tread" },
        { x: 520, y: 112, w: 44, h: 80, kind: "tread" },
        { x: 320, y: 185, w: 34, h: 110, kind: "wall" },
        { x: 150, y: 140, w: 56, h: 72, kind: "rack" },
        { x: 290, y: 300, w: 70, h: 40, kind: "bench" },
        { x: 400, y: 300, w: 38, h: 38, kind: "plant" },
        { x: 320, y: 450, w: 66, h: 36, kind: "fountain" }
      ],
      decor: [
        { x: 200, y: 200, kind: "mat" },
        { x: 280, y: 180, kind: "mat" },
        { x: 360, y: 240, kind: "dumbbells" },
        { x: 320, y: 380, kind: "towel" },
        { x: 450, y: 300, kind: "shaker" }
      ],
      girls: [
        { type: "stepper", x: 450, y: 118, facing: -Math.PI / 2 },
        { type: "stepper", x: 520, y: 118, facing: -Math.PI / 2 },
        { type: "walker", path: [[280, 220], [360, 220], [360, 380], [280, 380]] }
      ]
    },
    {
      name: "THE TRI-CORRIDOR", sub: "Horizontal walls divide the floor into an S-route. Exit: Bottom wall.",
      pull: 0.70, girlSpeed: 60, phoneChance: 0.12,
      exit: { side: "bottom", x: 100, y: 640 },
      obstacles: [
        { x: 360, y: 210, w: 560, h: 30, kind: "wall" },
        { x: 280, y: 430, w: 560, h: 30, kind: "wall" },
        { x: 610, y: 332, w: 38, h: 150, kind: "wall" },
        { x: 500, y: 100, w: 56, h: 72, kind: "rack" },
        { x: 300, y: 320, w: 70, h: 40, kind: "bench" },
        { x: 150, y: 530, w: 70, h: 40, kind: "bench" },
        { x: 450, y: 530, w: 38, h: 38, kind: "plant" },
        { x: 600, y: 100, w: 44, h: 80, kind: "tread" },
        { x: 380, y: 320, w: 16, h: 16, kind: "ring" }
      ],
      decor: [
        { x: 200, y: 120, kind: "mat" },
        { x: 460, y: 310, kind: "kettlebell" },
        { x: 180, y: 340, kind: "towel" },
        { x: 520, y: 530, kind: "dumbbells" },
        { x: 250, y: 540, kind: "shaker" }
      ],
      girls: [
        { type: "influencer", x: 336, y: 320, facing: 0 },
        { type: "lifter", x: 500, y: 150, facing: Math.PI / 2 },
        { type: "stepper", x: 600, y: 106, facing: -Math.PI / 2 },
        { type: "walker", path: [[120, 530], [380, 530], [380, 590], [120, 590]] }
      ]
    },
    {
      name: "LOOP-BACK SPIRAL", sub: "No same-wall shortcut. Loop through the upper lane to the northeast locker.",
      pull: 0.83, girlSpeed: 68, phoneChance: 0.10,
      exit: { side: "right", x: 640, y: 120 },
      obstacles: [
        { x: 360, y: 320, w: 480, h: 40, kind: "wall" },
        { x: 320, y: 80, w: 400, h: 40, kind: "wall" },
        { x: 320, y: 560, w: 400, h: 40, kind: "wall" },
        { x: 72, y: 430, w: 34, h: 210, kind: "wall" },
        { x: 120, y: 180, w: 56, h: 72, kind: "rack" },
        { x: 520, y: 180, w: 56, h: 72, kind: "rack" },
        { x: 440, y: 510, w: 44, h: 70, kind: "tread" },
        { x: 230, y: 440, w: 70, h: 40, kind: "bench" },
        { x: 420, y: 440, w: 70, h: 40, kind: "bench" },
        { x: 580, y: 460, w: 38, h: 38, kind: "plant" },
        { x: 320, y: 460, w: 66, h: 36, kind: "fountain" }
      ],
      decor: [
        { x: 250, y: 140, kind: "dumbbells" },
        { x: 340, y: 150, kind: "mat" },
        { x: 460, y: 150, kind: "mat" },
        { x: 240, y: 460, kind: "towel" },
        { x: 360, y: 480, kind: "kettlebell" },
        { x: 150, y: 510, kind: "shaker" }
      ],
      girls: [
        { type: "scanner", x: 320, y: 200, facing: 0 },
        { type: "lifter", x: 120, y: 220, facing: 0 },
        { type: "lifter", x: 520, y: 220, facing: Math.PI },
        { type: "stepper", x: 440, y: 518, facing: Math.PI / 2 },
        { type: "walker", path: [[140, 480], [500, 480], [500, 520], [140, 520]] }
      ]
    },
    {
      name: "INFLUENCER RING", sub: "Central block plus stairs. Take 2F stairs to reach the locker balcony.",
      pull: 0.98, girlSpeed: 76, phoneChance: 0.09,
      exit: { side: "top", x: 560, y: 0 }, startFloor: "1F", exitFloor: "2F",
      stairs: [
        { x: 86, y: 548, toX: 560, toY: 118, floor: "1F", toFloor: "2F", label: "UP" },
        { x: 560, y: 118, toX: 86, toY: 548, floor: "2F", toFloor: "1F", label: "DOWN" }
      ],
      obstacles: [
        { x: 320, y: 320, w: 240, h: 240, kind: "wall" },
        { x: 120, y: 160, w: 40, h: 160, kind: "wall" },
        { x: 320, y: 180, w: 70, h: 40, kind: "bench" },
        { x: 120, y: 360, w: 40, h: 70, kind: "bench" },
        { x: 490, y: 320, w: 40, h: 70, kind: "bench" },
        { x: 250, y: 112, w: 44, h: 80, kind: "tread" },
        { x: 390, y: 112, w: 44, h: 80, kind: "tread" },
        { x: 64, y: 560, w: 38, h: 38, kind: "plant" },
        { x: 576, y: 560, w: 38, h: 38, kind: "plant" },
        { x: 320, y: 560, w: 16, h: 16, kind: "ring" }
      ],
      decor: [
        { x: 80, y: 240, kind: "mat" },
        { x: 460, y: 180, kind: "towel" },
        { x: 540, y: 440, kind: "dumbbells" },
        { x: 160, y: 500, kind: "kettlebell" },
        { x: 260, y: 520, kind: "shaker" }
      ],
      girls: [
        { type: "influencer", x: 320, y: 520, facing: -Math.PI / 2 },
        { type: "scanner", x: 480, y: 420, facing: 0 },
        { type: "stepper", x: 250, y: 118, facing: -Math.PI / 2 },
        { type: "stepper", x: 390, y: 118, facing: -Math.PI / 2 },
        { type: "walker", path: [[120, 460], [120, 540], [240, 540], [240, 460]] },
        { type: "walker", path: [[540, 240], [540, 540], [460, 540], [460, 240]] }
      ]
    },
    {
      name: "JUICE BAR ROOMS", sub: "Four rooms, door gaps, and a rear stairwell to the 2F locker hall.",
      pull: 1.12, girlSpeed: 84, phoneChance: 0.08,
      exit: { side: "bottom", x: 520, y: 640 }, startFloor: "1F", exitFloor: "2F",
      stairs: [
        { x: 104, y: 104, toX: 540, toY: 560, floor: "1F", toFloor: "2F", label: "UP" },
        { x: 540, y: 560, toX: 104, toY: 104, floor: "2F", toFloor: "1F", label: "DOWN" }
      ],
      obstacles: [
        { x: 320, y: 120, w: 30, h: 240, kind: "wall" },
        { x: 320, y: 520, w: 30, h: 240, kind: "wall" },
        { x: 200, y: 320, w: 240, h: 30, kind: "wall" },
        { x: 480, y: 320, w: 240, h: 30, kind: "wall" },
        { x: 120, y: 130, w: 56, h: 72, kind: "rack" },
        { x: 520, y: 130, w: 56, h: 72, kind: "rack" },
        { x: 210, y: 240, w: 70, h: 40, kind: "bench" },
        { x: 430, y: 240, w: 70, h: 40, kind: "bench" },
        { x: 210, y: 460, w: 70, h: 40, kind: "bench" },
        { x: 430, y: 460, w: 70, h: 40, kind: "bench" },
        { x: 150, y: 575, w: 44, h: 60, kind: "tread" },
        { x: 490, y: 575, w: 44, h: 60, kind: "tread" },
        { x: 580, y: 110, w: 38, h: 38, kind: "plant" }
      ],
      decor: [
        { x: 160, y: 220, kind: "mat" },
        { x: 480, y: 220, kind: "mat" },
        { x: 180, y: 250, kind: "shaker" },
        { x: 250, y: 500, kind: "dumbbells" },
        { x: 430, y: 520, kind: "towel" }
      ],
      girls: [
        { type: "scanner", x: 230, y: 260, facing: 0 },
        { type: "scanner", x: 410, y: 260, facing: Math.PI },
        { type: "influencer", x: 180, y: 180, facing: Math.PI / 2 },
        { type: "stepper", x: 150, y: 560, facing: Math.PI / 2 },
        { type: "stepper", x: 490, y: 560, facing: Math.PI / 2 },
        { type: "walker", path: [[110, 480], [110, 580], [260, 580], [260, 480]] },
        { type: "walker", path: [[370, 540], [550, 540], [550, 410], [370, 410]] }
      ]
    },
    {
      name: "PEAK HOURS. 6 PM.", sub: "Two-floor peak-hour cross. Survive the stairs before the final locker door.",
      pull: 1.30, girlSpeed: 94, phoneChance: 0.07,
      exit: { side: "top", x: 320, y: 0 }, startFloor: "1F", exitFloor: "2F",
      stairs: [
        { x: 250, y: 320, toX: 350, toY: 90, floor: "1F", toFloor: "2F", label: "UP" },
        { x: 350, y: 90, toX: 250, toY: 320, floor: "2F", toFloor: "1F", label: "DOWN" }
      ],
      obstacles: [
        { x: 130, y: 130, w: 260, h: 260, kind: "wall" },
        { x: 510, y: 130, w: 260, h: 260, kind: "wall" },
        { x: 130, y: 510, w: 260, h: 260, kind: "wall" },
        { x: 510, y: 510, w: 260, h: 260, kind: "wall" },
        { x: 320, y: 320, w: 84, h: 44, kind: "cable" },
        { x: 320, y: 100, w: 44, h: 80, kind: "tread" },
        { x: 320, y: 560, w: 44, h: 80, kind: "tread" },
        { x: 320, y: 220, w: 70, h: 40, kind: "bench" },
        { x: 320, y: 420, w: 70, h: 40, kind: "bench" },
        { x: 160, y: 320, w: 40, h: 70, kind: "bench" },
        { x: 480, y: 320, w: 40, h: 70, kind: "bench" },
        { x: 320, y: 480, w: 16, h: 16, kind: "ring" }
      ],
      decor: [
        { x: 320, y: 260, kind: "mat" },
        { x: 320, y: 380, kind: "mat" },
        { x: 280, y: 340, kind: "towel" },
        { x: 360, y: 340, kind: "shaker" },
        { x: 180, y: 350, kind: "dumbbells" },
        { x: 460, y: 350, kind: "kettlebell" }
      ],
      girls: [
        { type: "influencer", x: 320, y: 524, facing: -Math.PI / 2 },
        { type: "scanner", x: 320, y: 300, facing: 0 },
        { type: "scanner", x: 130, y: 320, facing: 0 },
        { type: "stepper", x: 320, y: 100, facing: Math.PI / 2 },
        { type: "stepper", x: 320, y: 560, facing: -Math.PI / 2 },
        { type: "walker", path: [[270, 320], [370, 320], [370, 380], [270, 380]] },
        { type: "walker", path: [[120, 320], [240, 320], [240, 360], [120, 360]] },
        { type: "walker", path: [[400, 320], [520, 320], [520, 360], [400, 360]] }
      ]
    }
  ];

  const LEVEL_TOASTS = [
    "👀 Level 1 · 6 AM. Equipment now breaks the straight shot.",
    "📐 Level 2 · L-shape layout. Cover pockets tighten the lane.",
    "🧱 Level 3 · T-wing pinch. Watch the center aisle.",
    "⚡ Level 4 · S-shaped tri-corridor. Right-side gap is tighter.",
    "🔄 Level 5 · Loop-back layout. Locker moved off the entrance wall.",
    "⭕ Level 6 · Influencer ring. Take stairs to the 2F locker balcony.",
    "🚪 Level 7 · Quadrant rooms. Rear stairs unlock the locker hall.",
    "💀 Level 8 · Peak hours. Final locker room is upstairs."
  ];

  const BRUISER_LAYOUTS = [
    [
      { label: "SPOTTER", x: 250, y: 468, speed: 34, aggro: 78, hit: 34, stun: 0.75, cooldown: 1.2, path: [[250, 468], [530, 468]] }
    ],
    [
      { label: "CURL KING", x: 290, y: 270, speed: 40, aggro: 86, hit: 36, stun: 0.85, cooldown: 1.15, path: [[290, 210], [290, 510]] },
      { label: "TRAP DAD", x: 118, y: 392, speed: 37, aggro: 80, hit: 34, stun: 0.8, cooldown: 1.25, path: [[118, 392], [408, 392]] }
    ],
    [
      { label: "LEG DAY", x: 330, y: 218, speed: 45, aggro: 90, hit: 36, stun: 0.95, cooldown: 1.1, path: [[330, 218], [330, 486]] },
      { label: "BULK MODE", x: 402, y: 486, speed: 45, aggro: 90, hit: 36, stun: 0.95, cooldown: 1.1, path: [[402, 486], [402, 218]] }
    ],
    [
      { label: "NO REPS", x: 182, y: 320, speed: 48, aggro: 92, hit: 37, stun: 1.0, cooldown: 1.05, path: [[110, 320], [320, 320]] },
      { label: "MEAT WALL", x: 520, y: 532, speed: 54, aggro: 94, hit: 38, stun: 1.05, cooldown: 1.05, path: [[520, 532], [250, 532]] },
      { label: "PREWORKOUT", x: 610, y: 150, speed: 34, aggro: 82, hit: 35, stun: 0.9, cooldown: 1.1, path: [[610, 150], [610, 370]] }
    ],
    [
      { label: "BARBELL BOB", x: 170, y: 354, speed: 58, aggro: 96, hit: 38, stun: 1.05, cooldown: 1.0, path: [[170, 354], [548, 354]] },
      { label: "WHEY LORD", x: 520, y: 124, speed: 44, aggro: 88, hit: 36, stun: 0.95, cooldown: 1.05, path: [[520, 124], [190, 124]] },
      { label: "PR POLICE", x: 505, y: 584, speed: 52, aggro: 92, hit: 37, stun: 1.0, cooldown: 1.05, path: [[505, 584], [128, 584]] }
    ],
    [
      { label: "TOP SET", x: 320, y: 116, speed: 52, aggro: 100, hit: 39, stun: 1.1, cooldown: 0.95, path: [[170, 116], [470, 116]] },
      { label: "BULK SECURITY", x: 320, y: 482, speed: 52, aggro: 100, hit: 39, stun: 1.1, cooldown: 0.95, path: [[470, 482], [170, 482]] },
      { label: "CUTTING", x: 72, y: 402, speed: 47, aggro: 92, hit: 37, stun: 1.0, cooldown: 1.0, path: [[72, 402], [276, 402], [276, 548], [72, 548]] }
    ],
    [
      { label: "BENCH LORD", x: 320, y: 258, speed: 44, aggro: 98, hit: 38, stun: 1.1, cooldown: 0.95, path: [[320, 258], [320, 382]] },
      { label: "SQUAT DAD", x: 320, y: 382, speed: 44, aggro: 98, hit: 38, stun: 1.1, cooldown: 0.95, path: [[320, 382], [320, 258]] },
      { label: "LAT SPREAD", x: 478, y: 330, speed: 56, aggro: 104, hit: 40, stun: 1.15, cooldown: 0.92, path: [[478, 330], [148, 330]] },
      { label: "BICEPS", x: 555, y: 560, speed: 50, aggro: 98, hit: 38, stun: 1.05, cooldown: 0.95, path: [[555, 560], [385, 560], [385, 430], [555, 430]] }
    ],
    [
      { label: "FINAL BOSS", x: 320, y: 260, speed: 66, aggro: 112, hit: 42, stun: 1.25, cooldown: 0.85, path: [[320, 190], [320, 455]] },
      { label: "PROTEIN", x: 210, y: 320, speed: 64, aggro: 108, hit: 41, stun: 1.18, cooldown: 0.88, path: [[210, 320], [430, 320]] },
      { label: "TANK TOP", x: 320, y: 392, speed: 56, aggro: 104, hit: 40, stun: 1.12, cooldown: 0.9, path: [[180, 392], [460, 392]] },
      { label: "PEAK BULK", x: 520, y: 320, speed: 58, aggro: 108, hit: 41, stun: 1.18, cooldown: 0.88, path: [[520, 320], [120, 320], [120, 390], [520, 390]] }
    ]
  ];

  const EXTRA_GIRLS = [
    [
      { type: "walker", path: [[420, 260], [540, 260], [540, 380], [420, 380]] }
    ],
    [
      { type: "scanner", x: 90, y: 500, facing: 0 },
      { type: "lifter", x: 300, y: 150, facing: Math.PI / 2 }
    ],
    [
      { type: "lifter", x: 210, y: 120, facing: 0 },
      { type: "walker", path: [[150, 250], [245, 250], [245, 380], [150, 380]] }
    ],
    [
      { type: "scanner", x: 530, y: 320, facing: Math.PI },
      { type: "walker", path: [[470, 80], [580, 80], [580, 170], [470, 170]] }
    ],
    [
      { type: "influencer", x: 585, y: 355, facing: Math.PI },
      { type: "walker", path: [[90, 120], [220, 120], [220, 260], [90, 260]] }
    ],
    [
      { type: "scanner", x: 80, y: 420, facing: 0 },
      { type: "lifter", x: 555, y: 170, facing: Math.PI }
    ],
    [
      { type: "influencer", x: 520, y: 190, facing: Math.PI },
      { type: "lifter", x: 560, y: 250, facing: Math.PI }
    ],
    [
      { type: "influencer", x: 320, y: 180, facing: Math.PI / 2 },
      { type: "scanner", x: 520, y: 320, facing: Math.PI }
    ]
  ];

  const PATRON_LAYOUTS = [
    [
      { role: "CARDIO", path: [[90, 250], [180, 250], [180, 390], [90, 390]], speed: 24 },
      { role: "WALK-IN", path: [[560, 170], [560, 470]], speed: 22 },
      { role: "REST", x: 245, y: 520 },
      { role: "STAFF", path: [[360, 560], [500, 560], [500, 440], [360, 440]], speed: 20 }
    ],
    [
      { role: "CHECK-IN", path: [[70, 110], [70, 520]], speed: 26 },
      { role: "CARDIO", path: [[120, 560], [420, 560]], speed: 24 },
      { role: "REST", path: [[120, 360], [300, 360]], speed: 18 },
      { role: "STAFF", x: 260, y: 500 },
      { role: "LIFT", x: 430, y: 430 }
    ],
    [
      { role: "WALK-IN", path: [[80, 210], [210, 210]], speed: 24 },
      { role: "CARDIO", path: [[430, 210], [560, 210]], speed: 24 },
      { role: "STAFF", path: [[320, 90], [320, 370]], speed: 26 },
      { role: "REST", path: [[250, 350], [390, 350]], speed: 20 },
      { role: "LIFT", x: 120, y: 300 },
      { role: "LIFT", x: 520, y: 300 }
    ],
    [
      { role: "CARDIO", path: [[80, 100], [450, 100]], speed: 28 },
      { role: "WALK-IN", path: [[90, 320], [270, 320]], speed: 26 },
      { role: "LIFT", path: [[470, 520], [600, 520]], speed: 22 },
      { role: "STAFF", path: [[60, 260], [60, 380]], speed: 22 },
      { role: "REST", x: 520, y: 300 },
      { role: "REST", x: 150, y: 540 },
      { role: "CARDIO", x: 575, y: 155 }
    ],
    [
      { role: "WALK-IN", path: [[80, 130], [80, 520]], speed: 27 },
      { role: "CARDIO", path: [[160, 140], [490, 140]], speed: 26 },
      { role: "STAFF", path: [[520, 260], [590, 260], [590, 480], [520, 480]], speed: 24 },
      { role: "REST", path: [[150, 500], [260, 500]], speed: 18 },
      { role: "LIFT", path: [[380, 500], [520, 500]], speed: 20 },
      { role: "WALK-IN", path: [[570, 130], [570, 290]], speed: 22 },
      { role: "REST", x: 70, y: 350 },
      { role: "CARDIO", x: 300, y: 380 }
    ],
    [
      { role: "CARDIO", path: [[180, 90], [520, 90]], speed: 28 },
      { role: "WALK-IN", path: [[80, 360], [80, 560]], speed: 25 },
      { role: "STAFF", path: [[520, 180], [560, 540]], speed: 25 },
      { role: "REST", path: [[190, 540], [450, 540]], speed: 20 },
      { role: "LIFT", path: [[160, 360], [160, 520]], speed: 20 },
      { role: "WALK-IN", x: 475, y: 125 },
      { role: "REST", x: 535, y: 455 },
      { role: "CARDIO", x: 70, y: 500 },
      { role: "STAFF", x: 310, y: 90 }
    ],
    [
      { role: "WALK-IN", path: [[90, 90], [240, 90]], speed: 26 },
      { role: "CARDIO", path: [[400, 90], [570, 90]], speed: 26 },
      { role: "STAFF", path: [[90, 250], [260, 250]], speed: 22 },
      { role: "REST", path: [[380, 250], [560, 250]], speed: 20 },
      { role: "LIFT", path: [[90, 430], [260, 430]], speed: 20 },
      { role: "WALK-IN", path: [[380, 430], [560, 430]], speed: 24 },
      { role: "REST", x: 150, y: 570 },
      { role: "CARDIO", x: 490, y: 575 },
      { role: "STAFF", x: 320, y: 300 },
      { role: "LIFT", x: 320, y: 365 }
    ],
    [
      { role: "WALK-IN", path: [[280, 90], [360, 90]], speed: 28 },
      { role: "CARDIO", path: [[280, 190], [360, 190]], speed: 26 },
      { role: "STAFF", path: [[90, 320], [250, 320]], speed: 25 },
      { role: "REST", path: [[390, 320], [550, 320]], speed: 25 },
      { role: "LIFT", path: [[280, 450], [360, 450]], speed: 22 },
      { role: "WALK-IN", path: [[320, 510], [320, 570]], speed: 24 },
      { role: "CARDIO", x: 320, y: 250 },
      { role: "REST", x: 320, y: 390 },
      { role: "STAFF", x: 250, y: 320 },
      { role: "LIFT", x: 390, y: 320 },
      { role: "WALK-IN", x: 320, y: 120 },
      { role: "REST", x: 320, y: 520 }
    ]
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
    "Insurance claim filed. Cause of loss: one (1) head turn.",
    "Group chat notification: 'is this him???' × 47",
    "Front desk just voided your membership. And your dignity.",
    "The ring light caught everything. In 4K. At 60fps.",
    "Your neck wrote a check your reputation couldn't cash."
  ];

  const BUMP_LINES = [
    "💢 You literally walked into her.",
    "💢 'Watch it, creep.'",
    "💢 Body check. Not the good kind.",
    "💢 She dropped her shaker bottle. Everyone heard it."
  ];

  // =========================================================================
  // 4. STATE
  // =========================================================================
  const state = {
    running: false,
    paused: false,
    gameOver: false,
    won: false,
    started: false,

    level: 1,
    levelT: 0,
    levelPeakSus: 0,
    score: 0,

    player: {
      x: 36, y: 320,
      facing: 0,        // actual gaze (after neck pull)
      desired: 0,       // where the mouse points
      dirX: 0, dirY: 0,
      moving: false,
      eyesClosed: false
    },

    touchJoystick: {
      active: false,
      dirX: 0,
      dirY: 0
    },
    touchEyesClosed: false,

    sus: 0,
    fighting: false,    // neck pull currently strong
    pullTarget: null,   // girl the neck wants

    girls: [],
    obstacles: [],
    bruisers: [],
    bottles: [],
    patrons: [],
    stairs: [],
    decor: [],
    exit: { x: 1280, y: 640, w: 32, h: 280, side: "right" },
    floor: "1F",
    exitFloor: null,
    levelStartDist: WORLD_W,
    exitHintT: 0,
    stairCooldown: 0,


    airpodT: 0,
    boyfriendT: 0,
    decoy: null,
    stunT: 0,
    tripT: 0,
    knockX: 0,
    knockY: 0,

    bustReason: null,   // "sus" | "caught" | "blindbump"

    cam: { x: 0, y: 0, shake: 0, flash: 0 },
    t: 0,
    lastTime: 0
  };
  const saveSlot = window.RBGameSaves && window.RBGameSaves.create("dont-look-gym-girl", { version: 1 });
  let saveMenu = null;

  // =========================================================================
  // 5. UTILITIES
  // =========================================================================
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const lerp = (a, b, t) => a + (b - a) * t;

  function loadRasterArt(fileName) {
    const image = new Image();
    image.decoding = "async";
    const src = new URL(fileName, ART_ROOT);
    src.searchParams.set("v", ART_VERSION);
    image.src = src.href;
    return image;
  }

  function imageReady(image) {
    return Boolean(image && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
  }

  function drawImageCover(image, x, y, w, h) {
    if (!imageReady(image)) return false;
    const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (image.naturalWidth - sw) / 2;
    const sy = (image.naturalHeight - sh) / 2;
    ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
    return true;
  }

  function drawRasterCell(name, x, y, w, h, options = {}) {
    const cell = SPRITE_CELLS[name];
    if (!cell || !imageReady(RASTER_ART.sprites)) return false;
    ctx.save();
    if (options.alpha !== undefined) ctx.globalAlpha *= options.alpha;
    if (options.shadowColor) {
      ctx.shadowColor = options.shadowColor;
      ctx.shadowBlur = options.shadowBlur || 0;
    }
    ctx.drawImage(RASTER_ART.sprites, cell.sx, cell.sy, cell.sw, cell.sh, x, y, w, h);
    ctx.restore();
    return true;
  }

  function drawActorSprite(name, x, y, w, h, angle, footY, options = {}) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const drawn = drawRasterCell(name, -w / 2, -h + footY, w, h, options);
    ctx.restore();
    return drawn;
  }

  function drawObstacleSprite(name, o, wScale, hScale, options = {}) {
    const w = o.w * wScale;
    const h = o.h * hScale;
    const drawn = drawRasterCell(name, o.x - w / 2, o.y - h / 2, w, h, options);
    if (!drawn) return false;
    ctx.strokeStyle = options.outline || "rgba(46,224,255,0.22)";
    ctx.lineWidth = options.lineWidth || 1.5;
    ctx.strokeRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
    return true;
  }

  function normalizeAngle(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }

  function pointInRect(x, y, r) {
    return x >= r.x - r.w / 2 && x <= r.x + r.w / 2 &&
           y >= r.y - r.h / 2 && y <= r.y + r.h / 2;
  }

  function blockerRects() {
    return state.obstacles;
  }

  function getLevelIndex() {
    return clamp((state.level || 1) - 1, 0, LEVEL_PRESSURE.length - 1);
  }

  function getLevelPressure() {
    return LEVEL_PRESSURE[getLevelIndex()] || LEVEL_PRESSURE[0];
  }

  function getLevelDecayScale() {
    return LEVEL_DECAY_SCALE[getLevelIndex()] || LEVEL_DECAY_SCALE[LEVEL_DECAY_SCALE.length - 1];
  }

  function getHeatLabel() {
    const idx = clamp(Math.floor((state.level - 1) / 2), 0, GYM_HEAT_LABELS.length - 1);
    return GYM_HEAT_LABELS[idx];
  }

  function exitDistanceFrom(x, y) {
    const ex = state.exit;
    const closestX = clamp(x, ex.x - ex.w / 2, ex.x + ex.w / 2);
    const closestY = clamp(y, ex.y - ex.h / 2, ex.y + ex.h / 2);
    return dist(x, y, closestX, closestY);
  }

  function nearestActiveStairDistanceFrom(x, y) {
    let best = Infinity;
    for (const stair of state.stairs) {
      if (stair.floor && stair.floor !== state.floor) continue;
      best = Math.min(best, dist(x, y, stair.x, stair.y));
    }
    return best;
  }

  function objectiveDistanceFrom(x, y) {
    if (state.exitFloor && state.floor !== state.exitFloor) {
      const stairD = nearestActiveStairDistanceFrom(x, y);
      if (Number.isFinite(stairD)) return stairD;
    }
    return exitDistanceFrom(x, y);
  }

  // Line of sight between two points — blocked by any obstacle
  function losBlocked(ax, ay, bx, by) {
    const steps = 14;
    for (let i = 1; i < steps; i++) {
      const px = lerp(ax, bx, i / steps);
      const py = lerp(ay, by, i / steps);
      for (const o of blockerRects()) {
        if (pointInRect(px, py, o)) return true;
      }
    }
    return false;
  }

  // Circle-vs-rect collision for player movement (axis-separated)
  function collidesCircleRect(cx, cy, cr, r) {
    const nx = clamp(cx, r.x - r.w / 2, r.x + r.w / 2);
    const ny = clamp(cy, r.y - r.h / 2, r.y + r.h / 2);
    return dist(cx, cy, nx, ny) < cr;
  }

  function collidesAny(cx, cy, cr) {
    for (const o of blockerRects()) {
      if (collidesCircleRect(cx, cy, cr, o)) return true;
    }
    return false;
  }

  function refreshSaveMenu() {
    if (saveMenu && typeof saveMenu.refresh === "function") saveMenu.refresh();
  }

  function clearSave() {
    if (!saveSlot) return;
    saveSlot.clear();
    refreshSaveMenu();
  }

  function saveProgress(meta = {}) {
    if (!saveSlot || !state.started || state.won) return false;
    const saved = saveSlot.save(snapshot(), meta);
    if (saved) refreshSaveMenu();
    return saved;
  }

  function findStairLanding(stair) {
    const baseAngle = Math.atan2(stair.toY - stair.y, stair.toX - stair.x);
    const angles = [
      baseAngle,
      baseAngle + Math.PI,
      baseAngle + Math.PI / 2,
      baseAngle - Math.PI / 2,
      0,
      Math.PI / 2,
      Math.PI,
      -Math.PI / 2,
    ];
    const radii = [
      STAIR_LANDING_OFFSET,
      STAIR_LANDING_OFFSET + 18,
      STAIR_LANDING_OFFSET + 36,
      PLAYER_RADIUS + 4,
    ];

    for (const radius of radii) {
      for (const angle of angles) {
        const x = clamp(stair.toX + Math.cos(angle) * radius, PLAYER_RADIUS, WORLD_W - PLAYER_RADIUS);
        const y = clamp(stair.toY + Math.sin(angle) * radius, PLAYER_RADIUS, WORLD_H - PLAYER_RADIUS);
        if (!collidesAny(x, y, PLAYER_RADIUS)) return { x, y };
      }
    }

    return {
      x: clamp(stair.toX, PLAYER_RADIUS, WORLD_W - PLAYER_RADIUS),
      y: clamp(stair.toY, PLAYER_RADIUS, WORLD_H - PLAYER_RADIUS),
    };
  }

  function bottlePlacementBlocked(x, y, placed) {
    if (collidesAny(x, y, WATER_BOTTLE_RADIUS + 14)) return true;
    if (exitDistanceFrom(x, y) < 105) return true;
    if (dist(x, y, state.player.x, state.player.y) < 155) return true;

    for (const g of state.girls) {
      if (dist(x, y, g.x, g.y) < 76) return true;
    }
    for (const b of state.bruisers) {
      if (dist(x, y, b.x, b.y) < 96) return true;
    }
    for (const stair of state.stairs) {
      if (dist(x, y, stair.x, stair.y) < 78) return true;
    }
    for (const b of placed) {
      if (dist(x, y, b.x, b.y) < 72) return true;
    }
    return false;
  }

  function spawnWaterBottles(levelNum) {
    const target = Math.floor(clamp(5 + levelNum * 1.5, 6, 18));
    const bottles = [];
    const margin = 62;
    const attempts = target * 90;

    for (let i = 0; i < attempts && bottles.length < target; i++) {
      const x = rand(margin, WORLD_W - margin);
      const y = rand(margin, WORLD_H - margin);
      if (bottlePlacementBlocked(x, y, bottles)) continue;

      bottles.push({
        x,
        y,
        active: true,
        hitT: 0,
        spin: rand(-Math.PI, Math.PI),
        seed: rand(0, 1000)
      });
    }

    return bottles;
  }

  // =========================================================================
  // 6. AUDIO — tiny synthesized blips, no files
  // =========================================================================
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
  }
  function beep(freq, dur, type, gain, when) {
    if (!audioCtx) return;
    try {
      const t0 = audioCtx.currentTime + (when || 0);
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type || "square";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(gain || 0.06, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + dur);
    } catch (e) {}
  }
  const sfx = {
    notice: () => beep(880, 0.09, "square", 0.05),
    alert:  () => { beep(660, 0.1, "square", 0.06); beep(990, 0.1, "square", 0.06, 0.1); },
    bust:   () => { beep(220, 0.3, "sawtooth", 0.08); beep(140, 0.45, "sawtooth", 0.08, 0.12); },
    level:  () => { beep(523, 0.1, "square", 0.05); beep(784, 0.14, "square", 0.05, 0.1); },
    win:    () => { [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.16, "square", 0.05, i * 0.11)); },
    bump:   () => beep(180, 0.12, "sawtooth", 0.07)
  };

  // =========================================================================
  // 7. GIRL FACTORY
  // =========================================================================
  function makeGirl(def, lv) {
    const t = TYPES[def.type];
    const g = {
      type: def.type,
      x: def.x !== undefined ? def.x : def.path[0][0],
      y: def.y !== undefined ? def.y : def.path[0][1],
      facing: def.facing !== undefined ? def.facing : 0,
      baseFacing: def.facing !== undefined ? def.facing : 0,
      coneW: t.coneW,
      range: t.range,
      susMult: t.susMult,
      pullW: t.pullW,
      notice: 0,            // 0..NOTICE_TIME — mutual stare meter
      bumpCooldown: 0,

      // phone
      phoneActive: false,
      phoneT: 0,
      phoneCycle: rand(8, 14),

      // lifter / stepper checks
      checkT: def.type === "lifter" || def.type === "stepper" ? rand(t.checkEvery[0], t.checkEvery[1]) : 0,
      checking: false,
      checkDur: t.checkDur || 0,

      // scanner
      rotate: t.rotate || 0,

      // influencer
      flipT: def.type === "influencer" ? rand(t.flipEvery[0], t.flipEvery[1]) : 0,
      flipping: 0,          // remaining flip time
      flipped: false,

      // walker
      path: def.path || null,
      pathIdx: 1,
      speed: lv.girlSpeed,

      leggings: choice(["#ff2e88", "#e91e63", "#ff4081", "#d81b60", "#c2185b"]),
      label: choice(["YOGA PANTS", "LULLEMON", "LIFTO", "GAINS", "FLEX", "CUT", "BOOTY", "PR QUEEN"])
    };
    if (g.type === "influencer") g.label = "RING LIGHT";
    if (g.type === "scanner") g.label = "THE WATCHER";
    if (g.type === "stepper") g.label = "STAIRMASTER";
    return g;
  }

  function makePatron(def, levelNum, idx) {
    const rawPath = def.path || [[def.x, def.y]];
    const path = rawPath.map(pt => [pt[0] * WORLD_SCALE_X, pt[1] * WORLD_SCALE_Y]);
    const palette = [
      ["#2ee0ff", "#171923"],
      ["#4dffc9", "#22212b"],
      ["#f7d716", "#2b2630"],
      ["#ff7ddf", "#202633"],
      ["#c7d2fe", "#1f2937"]
    ];
    const colors = palette[(idx + levelNum) % palette.length];

    return {
      x: path[0][0],
      y: path[0][1],
      path,
      pathIdx: path.length > 1 ? 1 : 0,
      speed: (def.speed || 22) * ((WORLD_SCALE_X + WORLD_SCALE_Y) / 2),
      facing: def.facing || 0,
      role: def.role || "GYM",
      bumpCooldown: 0,
      seed: levelNum * 13.11 + idx * 5.37,
      shirt: def.shirt || colors[0],
      pants: def.pants || colors[1],
      skin: def.skin || choice(["#f1c27d", "#d89b63", "#b8734c", "#8d5524"])
    };
  }

  // =========================================================================
  // 8. INPUT
  // =========================================================================
  const keys = {};
  let mouseCanvasX = W / 2;
  let mouseCanvasY = H / 2;

  function setLookTarget(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    mouseCanvasX = (clientX - rect.left) * (canvas.width / rect.width);
    mouseCanvasY = (clientY - rect.top) * (canvas.height / rect.height);
  }

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  let activeTouchLookId = null;

  canvas.addEventListener("pointerdown", (e) => {
    canvas.focus();
    ensureAudio();
    if (!state.running && !state.gameOver && !state.won) {
      startGame();
      return;
    }
    // Touch starts a drag/look interaction
    if (e.pointerType === "touch") {
      e.preventDefault();
      activeTouchLookId = e.pointerId;
      setLookTarget(e.clientX, e.clientY);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") {
      setLookTarget(e.clientX, e.clientY);
    } else if (e.pointerType === "touch" && e.pointerId === activeTouchLookId) {
      e.preventDefault();
      setLookTarget(e.clientX, e.clientY);
    }
  });

  window.addEventListener("pointerup", (e) => {
    if (e.pointerId === activeTouchLookId) activeTouchLookId = null;
  });
  window.addEventListener("pointercancel", (e) => {
    if (e.pointerId === activeTouchLookId) activeTouchLookId = null;
  });

  function bindTouchControls() {
    // 1. Static buttons fallback (remains unchanged)
    const dirMap = {
      up: "arrowup",
      down: "arrowdown",
      left: "arrowleft",
      right: "arrowright",
    };
    const setKey = (key, down) => {
      keys[key] = down;
      if (down) {
        canvas.focus();
        ensureAudio();
        if (!state.running && !state.gameOver && !state.won) startGame();
      }
    };

    document.querySelectorAll("[data-gym-dir]").forEach((button) => {
      const key = dirMap[button.dataset.gymDir];
      if (!key) return;
      const press = (event) => { event.preventDefault(); setKey(key, true); };
      const release = (event) => { event.preventDefault(); setKey(key, false); };
      button.addEventListener("pointerdown", press);
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("pointerleave", release);
    });

    document.querySelectorAll("[data-gym-hold=\"eyes\"]").forEach((button) => {
      const press = (event) => { event.preventDefault(); setKey(" ", true); };
      const release = (event) => { event.preventDefault(); setKey(" ", false); };
      button.addEventListener("pointerdown", press);
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("pointerleave", release);
    });

    // 2. Premium On-screen Joystick and EYES action button
    const joystickZone = document.getElementById("joystick-zone");
    const joystickBase = document.getElementById("joystick-base");
    const joystickHandle = document.getElementById("joystick-handle");
    const eyesBtn = document.getElementById("eyes-btn");

    if (!joystickZone || !joystickBase || !joystickHandle || !eyesBtn) return;

    let joystickPointerId = null;
    let baseRect = null;
    let centerX = 0;
    let centerY = 0;
    let maxRadius = 40;

    joystickZone.addEventListener("pointerdown", (e) => {
      if (joystickPointerId !== null) return;
      e.preventDefault();
      e.stopPropagation();

      canvas.focus();
      ensureAudio();
      if (!state.running && !state.gameOver && !state.won) {
        startGame();
        return;
      }

      joystickPointerId = e.pointerId;
      state.touchJoystick.active = true;
      joystickBase.classList.add("active");

      baseRect = joystickBase.getBoundingClientRect();
      centerX = baseRect.left + baseRect.width / 2;
      centerY = baseRect.top + baseRect.height / 2;
      maxRadius = baseRect.width / 2;

      handleJoystickMove(e);
    });

    function handleJoystickMove(e) {
      if (!state.touchJoystick.active || e.pointerId !== joystickPointerId) return;
      e.preventDefault();

      const diffX = e.clientX - centerX;
      const diffY = e.clientY - centerY;
      const d = Math.hypot(diffX, diffY);

      if (d === 0) {
        state.touchJoystick.dirX = 0;
        state.touchJoystick.dirY = 0;
        joystickHandle.style.transform = "translate(-50%, -50%)";
        return;
      }

      const clampedD = Math.min(maxRadius, d);
      const angle = Math.atan2(diffY, diffX);

      const handleX = Math.cos(angle) * clampedD;
      const handleY = Math.sin(angle) * clampedD;

      joystickHandle.style.transform = `translate(calc(-50% + ${handleX}px), calc(-50% + ${handleY}px))`;

      state.touchJoystick.dirX = Math.cos(angle) * (clampedD / maxRadius);
      state.touchJoystick.dirY = Math.sin(angle) * (clampedD / maxRadius);
    }

    window.addEventListener("pointermove", (e) => {
      if (state.touchJoystick.active && e.pointerId === joystickPointerId) {
        handleJoystickMove(e);
      }
    });

    function handleJoystickUp(e) {
      if (e.pointerId === joystickPointerId) {
        state.touchJoystick.active = false;
        state.touchJoystick.dirX = 0;
        state.touchJoystick.dirY = 0;
        joystickPointerId = null;
        joystickBase.classList.remove("active");
        joystickHandle.style.transform = "translate(-50%, -50%)";
      }
    }

    window.addEventListener("pointerup", handleJoystickUp);
    window.addEventListener("pointercancel", handleJoystickUp);

    // EYES button
    let eyesPointerId = null;
    eyesBtn.addEventListener("pointerdown", (e) => {
      if (eyesPointerId !== null) return;
      e.preventDefault();
      e.stopPropagation();

      canvas.focus();
      ensureAudio();
      if (!state.running && !state.gameOver && !state.won) {
        startGame();
        return;
      }

      eyesPointerId = e.pointerId;
      state.touchEyesClosed = true;
      eyesBtn.classList.add("active");
    });

    function handleEyesUp(e) {
      if (e.pointerId === eyesPointerId) {
        state.touchEyesClosed = false;
        eyesPointerId = null;
        eyesBtn.classList.remove("active");
      }
    }

    window.addEventListener("pointerup", handleEyesUp);
    window.addEventListener("pointercancel", handleEyesUp);
  }

  function readInput() {
    const p = state.player;
    let dx = 0, dy = 0;

    if (state.touchJoystick && state.touchJoystick.active) {
      dx = state.touchJoystick.dirX;
      dy = state.touchJoystick.dirY;
      p.moving = (dx !== 0 || dy !== 0);
    } else {
      if (keys["w"] || keys["arrowup"]) dy -= 1;
      if (keys["s"] || keys["arrowdown"]) dy += 1;
      if (keys["a"] || keys["arrowleft"]) dx -= 1;
      if (keys["d"] || keys["arrowright"]) dx += 1;
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy);
        dx /= len; dy /= len;
        p.moving = true;
      } else {
        p.moving = false;
      }
    }

    p.dirX = dx;
    p.dirY = dy;
    p.eyesClosed = !!keys[" "] || !!state.touchEyesClosed;
    if (state.stunT > 0) {
      p.dirX = 0;
      p.dirY = 0;
      p.moving = false;
    }

    const mdx = (mouseCanvasX + state.cam.x) - p.x;
    const mdy = (mouseCanvasY + state.cam.y) - p.y;
    if (mdx !== 0 || mdy !== 0) p.desired = Math.atan2(mdy, mdx);
  }

  // =========================================================================
  // 9. THE NECK™ — gaze drift toward the nearest girl
  // =========================================================================
  function updateGaze(dt) {
    const p = state.player;
    const lv = LEVELS[state.level - 1];

    // Find the strongest temptation in pull range
    let best = null, bestWeight = 0;
    for (const g of state.girls) {
      const d = dist(p.x, p.y, g.x, g.y);
      if (d > PULL_RANGE) continue;
      const w = (1 - d / PULL_RANGE) * g.pullW;
      if (w > bestWeight) { bestWeight = w; best = g; }
    }
    state.pullTarget = best;

    if (p.eyesClosed || state.airpodT > 0) {
      // Eyes shut or AirPods in: the neck loses. Gaze snaps to the mouse.
      p.facing += normalizeAngle(p.desired - p.facing) * Math.min(1, SNAP_RATE * dt);
      state.fighting = false;
      return;
    }

    if (!best) {
      // Nobody around — gaze follows the mouse snappily
      p.facing += normalizeAngle(p.desired - p.facing) * Math.min(1, SNAP_RATE * dt);
      state.fighting = false;
      return;
    }

    // 1) Willpower: ease toward the mouse
    const toDesired = normalizeAngle(p.desired - p.facing);
    p.facing += Math.sign(toDesired) * Math.min(Math.abs(toDesired), ASSIST_RATE * dt);

    // 2) The neck: drift toward her
    const girlAngle = Math.atan2(best.y - p.y, best.x - p.x);
    const toGirl = normalizeAngle(girlAngle - p.facing);
    const driftRate = bestWeight * (lv.pull + (state.level - 1) * 0.018) * DRIFT_BASE;
    p.facing += Math.sign(toGirl) * Math.min(Math.abs(toGirl), driftRate * dt);

    p.facing = normalizeAngle(p.facing);
    state.fighting = driftRate > ASSIST_RATE * 0.8;
  }

  // =========================================================================
  // 10. GIRL UPDATE
  // =========================================================================
  function updateGirl(g, lv, dt) {
    g.bumpCooldown = Math.max(0, g.bumpCooldown - dt);

    // Decoy overrides everything: all eyes on the dropped deadlift
    if (state.decoy) {
      const targetFacing = Math.atan2(state.decoy.y - g.y, state.decoy.x - g.x);
      const diff = normalizeAngle(targetFacing - g.facing);
      g.facing += Math.sign(diff) * Math.min(Math.abs(diff), 4.0 * dt);
      g.notice = Math.max(0, g.notice - NOTICE_DECAY * dt);
      return;
    }

    // Phone check (not influencers — they ARE the phone)
    if (g.type !== "influencer" && g.type !== "scanner") {
      if (!g.phoneActive) {
        g.phoneT += dt;
        if (g.phoneT > g.phoneCycle) {
          g.phoneT = 0;
          if (Math.random() < lv.phoneChance) {
            g.phoneActive = true;
          } else {
            g.phoneCycle = rand(5, 10);
          }
        }
      } else {
        g.phoneT += dt;
        if (g.phoneT > 2.0) {
          g.phoneActive = false;
          g.phoneT = 0;
          g.phoneCycle = rand(7, 13);
        }
      }
    }

    switch (g.type) {
      case "lifter":
      case "stepper": {
        // Periodic over-the-shoulder check: facing flips 180°
        g.checkT -= dt;
        if (g.checkT <= 0) {
          if (!g.checking) {
            g.checking = true;
            g.checkT = g.checkDur;
            g.facing = normalizeAngle(g.baseFacing + Math.PI);
          } else {
            g.checking = false;
            const t = TYPES[g.type];
            g.checkT = rand(t.checkEvery[0], t.checkEvery[1]);
            g.facing = g.baseFacing;
          }
        }
        break;
      }
      case "scanner": {
        g.facing = normalizeAngle(g.facing + g.rotate * dt);
        break;
      }
      case "influencer": {
        if (g.flipping > 0) {
          g.flipping -= dt;
          if (g.flipping <= 0) {
            g.flipped = !g.flipped;
            g.facing = normalizeAngle(g.baseFacing + (g.flipped ? Math.PI : 0));
            const t = TYPES.influencer;
            g.flipT = rand(t.flipEvery[0], t.flipEvery[1]);
          }
        } else {
          g.flipT -= dt;
          if (g.flipT <= 0) g.flipping = 0.45;  // brief wind-up, then flip
        }
        break;
      }
      case "walker": {
        const target = g.path[g.pathIdx];
        const dx = target[0] - g.x;
        const dy = target[1] - g.y;
        const d = Math.hypot(dx, dy);
        if (d < 5) {
          g.pathIdx = (g.pathIdx + 1) % g.path.length;
        } else if (!g.phoneActive) {
          g.x += (dx / d) * g.speed * dt;
          g.y += (dy / d) * g.speed * dt;
          const targetFacing = Math.atan2(dy, dx);
          const diff = normalizeAngle(targetFacing - g.facing);
          g.facing += Math.sign(diff) * Math.min(Math.abs(diff), 3.0 * dt);
        }
        break;
      }
    }
  }

  function updatePatrons(dt) {
    for (const patron of state.patrons) {
      patron.bumpCooldown = Math.max(0, patron.bumpCooldown - dt);
      if (!patron.path || patron.path.length < 2) continue;

      const target = patron.path[patron.pathIdx];
      const dx = target[0] - patron.x;
      const dy = target[1] - patron.y;
      const d = Math.hypot(dx, dy);
      if (d < 4) {
        patron.x = target[0];
        patron.y = target[1];
        patron.pathIdx = (patron.pathIdx + 1) % patron.path.length;
        continue;
      }

      const step = Math.min(d, patron.speed * dt);
      const vx = (dx / d) * step;
      const vy = (dy / d) * step;
      patron.facing = Math.atan2(dy, dx);

      const nx = patron.x + vx;
      if (!collidesAny(nx, patron.y, PATRON_RADIUS)) {
        patron.x = nx;
      } else {
        patron.pathIdx = (patron.pathIdx + 1) % patron.path.length;
      }

      const ny = patron.y + vy;
      if (!collidesAny(patron.x, ny, PATRON_RADIUS)) {
        patron.y = ny;
      } else {
        patron.pathIdx = (patron.pathIdx + 1) % patron.path.length;
      }

      patron.x = clamp(patron.x, PATRON_RADIUS, WORLD_W - PATRON_RADIUS);
      patron.y = clamp(patron.y, PATRON_RADIUS, WORLD_H - PATRON_RADIUS);
    }
  }

  function updatePatronBumps() {
    const player = state.player;

    for (const patron of state.patrons) {
      const dx = player.x - patron.x;
      const dy = player.y - patron.y;
      const d = Math.hypot(dx, dy);
      const minD = PLAYER_RADIUS + PATRON_RADIUS;
      if (d >= minD) continue;

      const ang = d > 0 ? Math.atan2(dy, dx) : rand(-Math.PI, Math.PI);
      const px = patron.x + Math.cos(ang) * minD;
      const py = patron.y + Math.sin(ang) * minD;
      if (!collidesAny(px, player.y, PLAYER_RADIUS)) player.x = px;
      if (!collidesAny(player.x, py, PLAYER_RADIUS)) player.y = py;
      player.x = clamp(player.x, PLAYER_RADIUS, WORLD_W - PLAYER_RADIUS);
      player.y = clamp(player.y, PLAYER_RADIUS, WORLD_H - PLAYER_RADIUS);

      if (patron.bumpCooldown > 0) continue;
      patron.bumpCooldown = 1.35;
      state.knockX += Math.cos(ang) * 58;
      state.knockY += Math.sin(ang) * 58;
      state.cam.shake = Math.max(state.cam.shake, 0.18);
      sfx.bump();

      if (state.boyfriendT <= 0) {
        state.sus = Math.min(SUS_MAX, state.sus + PATRON_BUMP_SUS * getLevelPressure());
        RB.toast("Crowded lane. Keep moving.", "bad");
        if (state.sus >= SUS_MAX) {
          bust("sus");
          return;
        }
      }
    }
  }

  function updateBruisers(dt) {
    const p = state.player;
    for (const b of state.bruisers) {
      b.attackCooldown = Math.max(0, b.attackCooldown - dt);
      b.swingT = Math.max(0, b.swingT - dt);
      b.warningT = Math.max(0, b.warningT - dt);

      const toPlayerX = p.x - b.x;
      const toPlayerY = p.y - b.y;
      const playerD = Math.hypot(toPlayerX, toPlayerY);
      const chasing = playerD < b.aggro && b.attackCooldown <= 0 && state.boyfriendT <= 0;

      let target = null;
      let speed = b.speed;
      if (chasing && playerD > 1) {
        target = [p.x, p.y];
        speed *= BRUISER_CHASE_MULT;
        b.warningT = 0.2;
      } else if (b.path && b.path.length > 1) {
        target = b.path[b.pathIdx];
      }

      if (!target) continue;

      const dx = target[0] - b.x;
      const dy = target[1] - b.y;
      const d = Math.hypot(dx, dy);
      if (d < 3 && !chasing) {
        b.x = target[0];
        b.y = target[1];
        b.pathIdx = (b.pathIdx + 1) % b.path.length;
      } else if (d > 1) {
        const step = Math.min(d, speed * dt);
        b.x += (dx / d) * step;
        b.y += (dy / d) * step;
        b.facing = Math.atan2(dy, dx);
      }
    }
  }

  function updateBruiserThreats() {
    const p = state.player;
    for (const b of state.bruisers) {
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      const d = Math.hypot(dx, dy);
      const minD = BRUISER_RADIUS + PLAYER_RADIUS;

      if (d > 0 && d < minD) {
        p.x = b.x + (dx / d) * minD;
        p.y = b.y + (dy / d) * minD;
        p.x = clamp(p.x, PLAYER_RADIUS, WORLD_W - PLAYER_RADIUS);
        p.y = clamp(p.y, PLAYER_RADIUS, WORLD_H - PLAYER_RADIUS);
      }

      if (d > b.hit || b.attackCooldown > 0 || state.boyfriendT > 0) continue;

      const ang = d > 0 ? Math.atan2(dy, dx) : rand(-Math.PI, Math.PI);
      b.attackCooldown = b.cooldown;
      b.swingT = 0.28;
      b.facing = ang;

      state.stunT = Math.max(state.stunT, b.stun);
      state.knockX += Math.cos(ang) * 310;
      state.knockY += Math.sin(ang) * 310;
      state.sus = Math.min(SUS_MAX, state.sus + BRUISER_SMACK_SUS * getLevelPressure());
      state.cam.shake = Math.max(state.cam.shake, 0.48);
      sfx.bump();
      RB.toast("💪 " + b.label + " checked your shoulder. Stunned.", "bad");
      if (state.sus >= SUS_MAX) {
        bust("sus");
        return;
      }
    }
  }

  function updateWaterBottles(dt) {
    const p = state.player;

    for (const bottle of state.bottles) {
      if (bottle.hitT > 0) bottle.hitT = Math.max(0, bottle.hitT - dt);
      if (!bottle.active) continue;

      const d = dist(p.x, p.y, bottle.x, bottle.y);
      if (d > WATER_BOTTLE_TRIGGER) continue;

      const ang = d > 0 ? Math.atan2(p.y - bottle.y, p.x - bottle.x) : rand(-Math.PI, Math.PI);
      bottle.active = false;
      bottle.hitT = 0.8;

      state.tripT = Math.max(state.tripT, 0.75);
      state.stunT = Math.max(state.stunT, 0.7);
      state.knockX += Math.cos(ang) * 230 + rand(-32, 32);
      state.knockY += Math.sin(ang) * 230 + rand(-32, 32);
      state.sus = Math.min(SUS_MAX, state.sus + WATER_BOTTLE_TRIP_SUS * getLevelPressure());
      state.cam.shake = Math.max(state.cam.shake, 0.4);
      sfx.bump();
      RB.toast("💧 Loose bottle. You slipped.", "bad");

      if (state.sus >= SUS_MAX) {
        bust("sus");
        return;
      }
    }
  }

  function updateStairs(dt) {
    if (state.stairCooldown > 0) {
      state.stairCooldown = Math.max(0, state.stairCooldown - dt);
      return;
    }

    const p = state.player;
    for (const stair of state.stairs) {
      if (stair.floor && stair.floor !== state.floor) continue;
      if (dist(p.x, p.y, stair.x, stair.y) > STAIR_TRIGGER_RADIUS) continue;

      const landing = findStairLanding(stair);
      p.x = landing.x;
      p.y = landing.y;
      state.floor = stair.toFloor || state.floor;
      state.stairCooldown = STAIR_COOLDOWN;
      state.knockX = 0;
      state.knockY = 0;
      state.cam.flash = Math.max(state.cam.flash, 0.22);
      state.cam.shake = Math.max(state.cam.shake, 0.2);
      sfx.level();
      showBanner((state.floor === "2F" ? "2F LOCKER ACCESS" : "1F GYM FLOOR"), 1.1);
      RB.toast("Stairs to " + state.floor + ".", "good");
      saveProgress({ checkpoint: "stairs", level: state.level, floor: state.floor });
      return;
    }
  }

  // Is the player inside this girl's vision cone (and she can actually see)?
  function girlSeesPlayer(g) {
    if (g.phoneActive || state.decoy) return false;
    const p = state.player;
    const d = dist(p.x, p.y, g.x, g.y);
    if (d > g.range) return false;
    const angle = Math.atan2(p.y - g.y, p.x - g.x);
    if (Math.abs(normalizeAngle(angle - g.facing)) > g.coneW) return false;
    return !losBlocked(g.x, g.y, p.x, p.y);
  }

  // Is this girl inside the player's gaze cone (and visible)?
  function playerSeesGirl(g) {
    const p = state.player;
    if (p.eyesClosed) return false;
    const d = dist(p.x, p.y, g.x, g.y);
    if (d > GAZE_RANGE) return false;
    const angle = Math.atan2(g.y - p.y, g.x - p.x);
    if (Math.abs(normalizeAngle(angle - p.facing)) > GAZE_HALF_ANGLE) return false;
    return !losBlocked(p.x, p.y, g.x, g.y);
  }

  // =========================================================================
  // 11. SUS / NOTICE / BUST
  // =========================================================================
  function updateSus(dt) {
    const p = state.player;
    const pressure = getLevelPressure();
    let gain = 0;
    let anyMutual = false;

    for (const g of state.girls) {
      const looking = playerSeesGirl(g);
      const seen = girlSeesPlayer(g);
      const mutual = looking && seen;

      if (looking) {
        const d = dist(p.x, p.y, g.x, g.y);
        const proximity = 0.35 + 0.65 * (1 - d / GAZE_RANGE);
        let mult = g.susMult * (g.phoneActive ? 0.5 : 1);
        if (mutual) mult *= SUS_MUTUAL_MULT;
        gain += SUS_GAIN_BASE * pressure * proximity * mult;
      }

      // Notice: she watches you watching her
      if (mutual && state.boyfriendT <= 0) {
        anyMutual = true;
        const before = g.notice;
        g.notice += dt * pressure;
        if (before < 0.15 && g.notice >= 0.15) sfx.notice();
        if (before < 0.65 && g.notice >= 0.65) { sfx.alert(); state.cam.shake = Math.max(state.cam.shake, 0.25); }
        if (g.notice >= NOTICE_TIME) {
          bust("caught");
          return;
        }
      } else {
        g.notice = Math.max(0, g.notice - NOTICE_DECAY * dt);
      }
    }

    if (state.boyfriendT > 0) {
      // Shield: sus frozen, slowly drains
      state.sus = Math.max(0, state.sus - SUS_DECAY * getLevelDecayScale() * dt);
    } else if (gain > 0) {
      state.sus = Math.min(SUS_MAX, state.sus + gain * dt);
    } else {
      const decay = (p.eyesClosed ? SUS_DECAY_SHUT : SUS_DECAY) * getLevelDecayScale();
      state.sus = Math.max(0, state.sus - decay * dt);
    }

    state.levelPeakSus = Math.max(state.levelPeakSus, state.sus);

    if (state.sus >= SUS_MAX && state.boyfriendT <= 0) {
      bust("sus");
    }
  }

  function updateBumps(dt) {
    const p = state.player;
    for (const g of state.girls) {
      const d = dist(p.x, p.y, g.x, g.y);
      const minD = PLAYER_RADIUS + GIRL_RADIUS;
      if (d < minD) {
        // Push the player out
        const ang = Math.atan2(p.y - g.y, p.x - g.x);
        p.x = g.x + Math.cos(ang) * minD;
        p.y = g.y + Math.sin(ang) * minD;

        if (g.bumpCooldown <= 0) {
          g.bumpCooldown = 1.2;
          if (p.eyesClosed) {
            bust("blindbump");
            return;
          }
          if (state.boyfriendT <= 0) {
            state.sus = Math.min(SUS_MAX, state.sus + SUS_BUMP);
            state.cam.shake = Math.max(state.cam.shake, 0.35);
            sfx.bump();
            RB.toast(choice(BUMP_LINES), "bad");
            if (state.sus >= SUS_MAX) { bust("sus"); return; }
          }
        }
      }
    }
  }

  // =========================================================================
  // 12. PLAYER MOVEMENT (real collision now)
  // =========================================================================
  function updatePlayer(dt) {
    const p = state.player;
    const speed = state.stunT > 0 ? 0 : (p.eyesClosed ? PLAYER_SPEED_BLIND : PLAYER_SPEED);

    // Axis-separated so you slide along equipment
    const nx = p.x + p.dirX * speed * dt;
    if (!collidesAny(nx, p.y, PLAYER_RADIUS)) p.x = nx;
    const ny = p.y + p.dirY * speed * dt;
    if (!collidesAny(p.x, ny, PLAYER_RADIUS)) p.y = ny;

    if (Math.abs(state.knockX) > 1 || Math.abs(state.knockY) > 1) {
      const kx = p.x + state.knockX * dt;
      if (!collidesAny(kx, p.y, PLAYER_RADIUS)) p.x = kx;
      const ky = p.y + state.knockY * dt;
      if (!collidesAny(p.x, ky, PLAYER_RADIUS)) p.y = ky;
      const damp = Math.min(1, dt * 7.5);
      state.knockX = lerp(state.knockX, 0, damp);
      state.knockY = lerp(state.knockY, 0, damp);
    }

    p.x = clamp(p.x, PLAYER_RADIUS, WORLD_W - PLAYER_RADIUS);
    p.y = clamp(p.y, PLAYER_RADIUS, WORLD_H - PLAYER_RADIUS);
  }

  function checkLevelProgress() {
    const p = state.player;
    const ex = state.exit;
    const closestX = clamp(p.x, ex.x - ex.w / 2, ex.x + ex.w / 2);
    const closestY = clamp(p.y, ex.y - ex.h / 2, ex.y + ex.h / 2);
    const distance = dist(p.x, p.y, closestX, closestY);
    if (distance < PLAYER_RADIUS) {
      if (state.exitFloor && state.floor !== state.exitFloor) {
        if (state.exitHintT <= 0) {
          state.exitHintT = 1.8;
          state.cam.shake = Math.max(state.cam.shake, 0.16);
          RB.toast("Locker room is upstairs. Find the stairs.", "bad");
          showBanner("LOCKER ROOM IS ON " + state.exitFloor, 1.2);
        }
        return;
      }

      // Level score: speed + clean eyes
      const timeBonus = Math.max(0, Math.round(500 - state.levelT * 22));
      const cleanBonus = state.levelPeakSus < 30 ? 250 : state.levelPeakSus < 60 ? 100 : 0;
      const levelScore = 500 + timeBonus + cleanBonus;
      state.score += levelScore;

      if (state.level < LEVELS.length) {
        state.level++;
        loadLevel(state.level);
        sfx.level();
        showBanner("LEVEL " + state.level + " · " + LEVELS[state.level - 1].name, 2.0);
        RB.toast(LEVEL_TOASTS[state.level - 1] + "  (+" + levelScore + ")", "good");
        state.cam.flash = 0.25;
      } else {
        triggerWin();
      }
    }
  }

  // =========================================================================
  // 13. POWER-UPS (rewarded-ad economy, shared RB store)
  // =========================================================================
  function updatePowerTimers(dt) {
    if (state.airpodT > 0) state.airpodT -= dt;
    if (state.boyfriendT > 0) state.boyfriendT -= dt;
    if (state.stunT > 0) state.stunT -= dt;
    if (state.tripT > 0) state.tripT -= dt;
    if (state.exitHintT > 0) state.exitHintT -= dt;
    if (state.decoy) {
      state.decoy.life -= dt;
      if (state.decoy.life <= 0) state.decoy = null;
    }
  }

  const DECOY_TARGETS = [
    { x: 320, y: 90 }, { x: 90, y: 320 }, { x: 550, y: 550 },
    { x: 90, y: 90 }, { x: 550, y: 90 }, { x: 320, y: 560 }
  ];

  let _rbPowerCache = { airpods: 0, boyfriend: 0, decoy: 0 };
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
      RB.toast("🎧 Noise cancelling ON. The neck is silent for 8s.", "good");
    } else if (key === "boyfriend") {
      state.boyfriendT = 5.0;
      RB.toast("👔 'I'm her boyfriend.' Untouchable for 5s.", "good");
    } else if (key === "decoy") {
      const target = choice(DECOY_TARGETS);
      state.decoy = { x: target.x * WORLD_SCALE_X, y: target.y * WORLD_SCALE_Y, life: 2.5, maxLife: 2.5 };
      RB.toast("🎭 Someone dropped a 405 deadlift. Everyone turns.", "good");
    }
    updatePowerButtons();
  }

  function renderPowerButtons() {
    const defs = [
      { key: "airpods",   icon: "🎧", label: "AirPods Max 2.0",   desc: "Neck disabled · 8s" },
      { key: "boyfriend", icon: "👔", label: "I'm Her Boyfriend", desc: "Sus frozen, can't get caught · 5s" },
      { key: "decoy",     icon: "🎭", label: "Dropped Deadlift",  desc: "Everyone turns · 2.5s" }
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
  // 14. GAME FLOW
  // =========================================================================
  function loadLevel(n) {
    const lv = LEVELS[n - 1];
    
    // Scale obstacles dynamically
    const scaleObstacle = (o) => {
      const isWall = o.kind === "wall";
      const scaleW = isWall ? WORLD_SCALE_X : 1.5;
      const scaleH = isWall ? WORLD_SCALE_Y : 1.5;
      return {
        x: o.x * WORLD_SCALE_X,
        y: o.y * WORLD_SCALE_Y,
        w: o.w * scaleW,
        h: o.h * scaleH,
        kind: o.kind
      };
    };

    state.obstacles = lv.obstacles.map(o => scaleObstacle(o));
    state.bruisers = (BRUISER_LAYOUTS[n - 1] || []).map((b, i) => {
      const path = (b.path || [[b.x, b.y]]).map(pt => [pt[0] * WORLD_SCALE_X, pt[1] * WORLD_SCALE_Y]);
      return {
        x: path[0][0],
        y: path[0][1],
        spawnX: path[0][0],
        spawnY: path[0][1],
        label: b.label || "BRO",
        path,
        pathIdx: path.length > 1 ? 1 : 0,
        speed: (b.speed || 42) * ((WORLD_SCALE_X + WORLD_SCALE_Y) / 2),
        aggro: (b.aggro || 86) * ((WORLD_SCALE_X + WORLD_SCALE_Y) / 2) * BRUISER_AGGRO_SCALE,
        hit: (b.hit || 36) * ((WORLD_SCALE_X + WORLD_SCALE_Y) / 2),
        stun: b.stun || 0.9,
        cooldown: b.cooldown || 1.1,
        attackCooldown: 0,
        swingT: 0,
        warningT: 0,
        facing: 0,
        seed: i * 17.23 + n * 3.7,
        shorts: choice(["#2ee0ff", "#4dffc9", "#f7d716", "#ff7ddf", "#7c5cff"]),
        tank: choice(["#111827", "#242132", "#1d2630", "#2b1f28"]),
        skin: choice(["#f1c27d", "#d89b63", "#b8734c", "#8d5524"])
      };
    });
    
    // Scale girls dynamically
    const girlDefs = lv.girls.concat(EXTRA_GIRLS[n - 1] || []);
    state.girls = girlDefs.map(def => {
      const scaledDef = { ...def };
      if (def.x !== undefined) scaledDef.x = def.x * WORLD_SCALE_X;
      if (def.y !== undefined) scaledDef.y = def.y * WORLD_SCALE_Y;
      if (def.path) {
        scaledDef.path = def.path.map(pt => [pt[0] * WORLD_SCALE_X, pt[1] * WORLD_SCALE_Y]);
      }
      return makeGirl(scaledDef, lv);
    });
    state.patrons = (PATRON_LAYOUTS[n - 1] || [])
      .map((def, i) => makePatron(def, n, i))
      .filter(p => !collidesAny(p.x, p.y, PATRON_RADIUS));

    // Scale exit door coordinates dynamically
    if (lv.exit) {
      const isVert = (lv.exit.side === "top" || lv.exit.side === "bottom");
      state.exit = {
        x: lv.exit.x * WORLD_SCALE_X,
        y: lv.exit.y * WORLD_SCALE_Y,
        w: isVert ? 140 * WORLD_SCALE_X : 16 * WORLD_SCALE_X,
        h: isVert ? 16 * WORLD_SCALE_Y : 140 * WORLD_SCALE_Y,
        side: lv.exit.side
      };
    } else {
      // Default to right wall centered
      state.exit = {
        x: WORLD_W,
        y: WORLD_H / 2,
        w: 16 * WORLD_SCALE_X,
        h: 140 * WORLD_SCALE_Y,
        side: "right"
      };
    }
    state.floor = lv.startFloor || "1F";
    state.exitFloor = lv.exitFloor || null;
    state.stairs = (lv.stairs || []).map(stair => ({
      x: stair.x * WORLD_SCALE_X,
      y: stair.y * WORLD_SCALE_Y,
      toX: stair.toX * WORLD_SCALE_X,
      toY: stair.toY * WORLD_SCALE_Y,
      floor: stair.floor || null,
      toFloor: stair.toFloor || null,
      label: stair.label || "STAIRS"
    }));

    // Scale and load decor dynamically
    state.decor = (lv.decor || []).map(d => {
      return {
        x: d.x * WORLD_SCALE_X,
        y: d.y * WORLD_SCALE_Y,
        kind: d.kind
      };
    });

    state.player.x = 36;
    state.player.y = 320 * WORLD_SCALE_Y;
    state.bottles = spawnWaterBottles(n);
    state.levelStartDist = Math.max(1, objectiveDistanceFrom(state.player.x, state.player.y));
    state.levelT = 0;
    state.levelPeakSus = 0;
    state.sus = Math.max(0, state.sus - 40);  // partial mercy between levels
    state.decoy = null;
    state.stunT = 0;
    state.tripT = 0;
    state.exitHintT = 0;
    state.stairCooldown = 0;
    state.knockX = 0;
    state.knockY = 0;

    // Reset camera position
    state.cam.x = clamp(state.player.x - W / 2, 0, WORLD_W - W);
    state.cam.y = clamp(state.player.y - H / 2, 0, WORLD_H - H);
    saveProgress({ checkpoint: "level", level: state.level, floor: state.floor });
  }

  function startGame() {
    if (state.started) return;
    clearSave();
    state.started = true;
    state.running = true;
    state.gameOver = false;
    state.won = false;
    state.level = 1;
    state.score = 0;
    state.sus = 0;
    state.airpodT = 0;
    state.boyfriendT = 0;
    state.bustReason = null;
    loadLevel(1);
    state.t = 0;
    document.getElementById("overlay").classList.remove("overlay--show");
    showBanner("LEVEL 1 · " + LEVELS[0].name, 2.0);
    RB.toast(LEVEL_TOASTS[0], "");
  }

  function bust(reason) {
    if (state.gameOver) return;
    state.gameOver = true;
    state.running = false;
    refreshSaveMenu();
    state.bustReason = reason;
    state.cam.shake = 0.8;
    state.cam.flash = 1.0;
    sfx.bust();
    showShameCard(reason);
  }

  function triggerWin() {
    state.won = true;
    state.running = false;
    clearSave();
    state.cam.flash = 0.6;
    sfx.win();
    RB.recordScore("dont-look-gym-girl", state.score);
    showWinCard(state.score);
  }

  function restart() {
    clearSave();
    document.getElementById("shame-mount").innerHTML = "";
    document.getElementById("gym-banner").style.display = "none";
    document.getElementById("overlay").classList.add("overlay--show");
    state.started = false;
    state.gameOver = false;
    state.won = false;
    state.running = false;
    state.level = 1;
    state.score = 0;
    state.sus = 0;
    state.airpodT = 0;
    state.boyfriendT = 0;
    state.decoy = null;
    state.girls = [];
    loadLevel(1);
    state.t = 0;
  }

  // =========================================================================
  // 15. UI CARDS / BANNER
  // =========================================================================
  function showBanner(text, duration) {
    const b = document.getElementById("gym-banner");
    b.textContent = text;
    b.style.display = "block";
    b.style.animation = "none";
    void b.offsetWidth;
    b.style.animation = "gymBannerFlash 0.5s steps(2) " + (duration || 1.2) + " forwards";
    setTimeout(() => { b.style.display = "none"; }, (duration || 1.2) * 1000);
  }

  const BUST_TITLES = {
    sus:       "📢 PUBLICLY SHAMED",
    caught:    "📸 CAUGHT IN 4K",
    blindbump: "💥 YOU WALKED INTO HER"
  };
  const BUST_SUBS = {
    sus:       "The vibes curdled. Security was called. There's a flyer with your face on it now.",
    caught:    "She watched you watch her. She narrated it to her phone. It's already posted.",
    blindbump: "You closed your eyes and walked directly into her. Incredible. Unprecedented."
  };

  function showShameCard(reason) {
    const high = RB.getHighScore("dont-look-gym-girl") || 0;
    const cap = choice(SHAME_CAPTIONS);
    const hasSave = !!(saveSlot && saveSlot.has());
    document.getElementById("shame-mount").innerHTML = `
      <div class="shame-card">
        <h3 class="shame-card__title">${BUST_TITLES[reason] || BUST_TITLES.sus}</h3>
        <p class="shame-card__sub">${BUST_SUBS[reason] || BUST_SUBS.sus}</p>
        <div class="shame-card__stats">
          Level reached: <strong>${state.level}</strong>/${LEVELS.length} ·
          Run score: <strong>${state.score}</strong><br>
          High score: <strong>${Math.max(state.score, high)}</strong>
        </div>
        <div class="shame-card__caption">"${cap}"</div>
        <div class="shame-card__actions">
          ${hasSave ? `<button class="btn btn--primary" id="shame-continue">Continue checkpoint</button>` : ""}
          <button class="btn ${hasSave ? "btn--secondary" : "btn--primary"}" id="shame-retry">New run</button>
          <a class="btn btn--ghost" href="../games.html">All games</a>
        </div>
      </div>
    `;
    const continueButton = document.getElementById("shame-continue");
    if (continueButton) {
      continueButton.addEventListener("click", () => {
        const saved = saveSlot && saveSlot.read();
        if (saved) restoreGame(saved);
      });
    }
    document.getElementById("shame-retry").addEventListener("click", restart);
  }

  function showWinCard(score) {
    const high = RB.getHighScore("dont-look-gym-girl") || 0;
    const isNewHigh = score >= high;
    document.getElementById("shame-mount").innerHTML = `
      <div class="win-card">
        <h3 class="win-card__title">🚪 LOCKER ROOM. SANCTUARY.</h3>
        <p class="shame-card__sub">Eight levels. Peak hours. Ring lights, scanners, the stairmaster section — and not one accusation. Your neck fought. You won.</p>
        <div class="shame-card__stats">
          Levels cleared: <strong>${LEVELS.length}</strong>/${LEVELS.length}<br>
          Final score: <strong>${score}</strong> ${isNewHigh ? "🆕 NEW HIGH" : ""}
        </div>
        <div class="win-card__caption">"I was just here for the leg press. I saw nothing. I am nothing."</div>
        <div class="shame-card__actions">
          <button class="btn btn--primary" id="win-again">Run it back</button>
          <a class="btn btn--ghost" href="../games.html">All games</a>
        </div>
      </div>
    `;
    document.getElementById("win-again").addEventListener("click", restart);
  }

  // =========================================================================
  // 16. RENDER
  // =========================================================================
  function drawGymLogo() {
    ctx.save();
    ctx.translate(WORLD_W / 2, WORLD_H / 2);
    // Outer dashed ring
    ctx.strokeStyle = "rgba(46, 224, 255, 0.08)";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 12]);
    ctx.beginPath();
    ctx.arc(0, 0, 95, 0, TAU);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(WORLD_W / 2, WORLD_H / 2);
    // Inner text and barbell silhouette
    ctx.fillStyle = "rgba(255, 46, 136, 0.07)";
    ctx.font = "bold 15px 'Press Start 2P', monospace";
    ctx.textAlign = "center";
    ctx.fillText("RAINBOT", 0, -22);
    ctx.fillText("GYM", 0, 32);

    // Barbell silhouette
    ctx.fillStyle = "rgba(46, 224, 255, 0.06)";
    ctx.fillRect(-60, -3, 120, 6); // bar
    ctx.fillRect(-65, -12, 10, 24); // inner plates
    ctx.fillRect(-76, -16, 8, 32);  // outer plates
    ctx.fillRect(55, -12, 10, 24);
    ctx.fillRect(68, -16, 8, 32);
    ctx.restore();
  }

  function drawTurfLane() {
    ctx.save();
    // Green turf area (draw on the left corridor side, but not blocking start zone)
    ctx.fillStyle = "rgba(46, 204, 113, 0.035)"; // translucent green
    ctx.fillRect(100, 0, 110, WORLD_H);
    // White line borders
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(100, 0); ctx.lineTo(100, WORLD_H);
    ctx.moveTo(210, 0); ctx.lineTo(210, WORLD_H);
    ctx.stroke();

    // Turf hashmarks and numbers
    ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
    ctx.font = "bold 12px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    for (let y = 100; y < WORLD_H; y += 200) {
      ctx.fillRect(100, y, 110, 2);
      ctx.fillText(Math.floor(y / 10) + "m", 155, y - 6);
    }
    ctx.restore();
  }

  function drawLiftingPlatform(x, y, w, h) {
    ctx.save();
    // Dark brown wood backing
    ctx.fillStyle = "#2c1f13";
    ctx.fillRect(x - w/2 - 10, y - h/2 - 6, w + 20, h + 12);
    // Light brown wood slats
    ctx.fillStyle = "#3e2723";
    for (let xx = x - w/2 - 6; xx < x + w/2 + 6; xx += 14) {
      ctx.fillRect(xx, y - h/2 - 4, 10, h + 8);
    }
    // Metal protective steel border
    ctx.strokeStyle = "#4e342e";
    ctx.lineWidth = 2;
    ctx.strokeRect(x - w/2 - 10, y - h/2 - 6, w + 20, h + 12);
    ctx.restore();
  }

  function drawAmbientTraffic() {
    const count = Math.min(11, 3 + state.level);
    ctx.save();
    for (let i = 0; i < count; i++) {
      const lane = i % 4;
      const travel = ((state.t * (0.025 + i * 0.002) + i * 0.17) % 1);
      const x =
        lane === 0 ? 80 + travel * (WORLD_W - 160) :
        lane === 1 ? WORLD_W - 110 - travel * (WORLD_W - 220) :
        lane === 2 ? 52 + Math.sin(state.t * 0.45 + i) * 18 :
        WORLD_W - 52 + Math.cos(state.t * 0.4 + i) * 18;
      const y =
        lane === 0 ? 72 + Math.sin(state.t * 0.9 + i) * 22 :
        lane === 1 ? WORLD_H - 74 + Math.cos(state.t * 0.8 + i) * 20 :
        120 + travel * (WORLD_H - 240);

      ctx.globalAlpha = 0.08 + state.level * 0.006;
      ctx.fillStyle = i % 2 ? "#2ee0ff" : "#ff2e88";
      ctx.beginPath();
      ctx.ellipse(x, y, 8, 13, Math.sin(state.t + i) * 0.4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.32)";
      ctx.beginPath();
      ctx.ellipse(x + 2, y + 11, 10, 3, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawExitHalo() {
    const ex = state.exit;
    ctx.save();
    const pulse = 0.55 + 0.45 * Math.sin(state.t * 4);
    const locked = state.exitFloor && state.floor !== state.exitFloor;
    const color = locked ? "247,215,22" : "255,125,223";
    const grad = ctx.createRadialGradient(ex.x, ex.y, 12, ex.x, ex.y, 170);
    grad.addColorStop(0, "rgba(" + color + "," + (locked ? 0.08 + pulse * 0.08 : 0.18 + pulse * 0.14) + ")");
    grad.addColorStop(1, "rgba(" + color + ",0)");
    ctx.fillStyle = grad;
    ctx.fillRect(ex.x - 180, ex.y - 180, 360, 360);
    ctx.restore();
  }

  function drawWallSign(o) {
    if (o.w >= 140 && o.h >= 60) {
      ctx.save();
      // Glowing backing
      ctx.fillStyle = "rgba(255, 46, 136, 0.08)";
      ctx.fillRect(o.x - o.w/2 + 10, o.y - 12, o.w - 20, 24);
      ctx.strokeStyle = "rgba(255, 46, 136, 0.25)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(o.x - o.w/2 + 10, o.y - 12, o.w - 20, 24);

      ctx.fillStyle = "#ff2e88";
      ctx.font = "bold 8px 'Press Start 2P', monospace";
      ctx.textAlign = "center";
      ctx.fillText("BLOCKED", o.x, o.y + 3);
      ctx.restore();
    }
  }

  function drawDecorations() {
    for (const d of state.decor) {
      ctx.save();
      ctx.translate(d.x, d.y);
      switch (d.kind) {
        case "mat": {
          // Rolled out yoga mat
          ctx.fillStyle = "#ff2e88"; // neon pink
          ctx.strokeStyle = "#ff85c0";
          ctx.lineWidth = 1;
          ctx.fillRect(-15, -28, 30, 56);
          ctx.strokeRect(-15, -28, 30, 56);
          // mat ribs
          ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
          for (let y = -22; y <= 22; y += 6) {
            ctx.beginPath();
            ctx.moveTo(-12, y); ctx.lineTo(12, y);
            ctx.stroke();
          }
          break;
        }
        case "dumbbells": {
          // Steel handles and plates lying on floor
          ctx.fillStyle = "#2c2c35";
          ctx.strokeStyle = "#7f8c8d";
          ctx.lineWidth = 1;
          // Dumbbell 1
          ctx.fillRect(-12, -2, 10, 4); // handle
          ctx.beginPath(); ctx.arc(-13, 0, 3, 0, TAU); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.arc(-6, 0, 3, 0, TAU); ctx.fill(); ctx.stroke();
          // Dumbbell 2
          ctx.fillRect(2, -2, 10, 4);
          ctx.beginPath(); ctx.arc(1, 0, 3, 0, TAU); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.arc(8, 0, 3, 0, TAU); ctx.fill(); ctx.stroke();
          break;
        }
        case "kettlebell": {
          // Kettlebell body & handle
          ctx.fillStyle = "#1e272c";
          ctx.beginPath();
          ctx.arc(0, 4, 6, 0, TAU);
          ctx.fill();
          // Handle
          ctx.strokeStyle = "#1e272c";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(0, -1, 4.5, Math.PI, 0);
          ctx.stroke();
          break;
        }
        case "towel": {
          // Folded white gym towel
          ctx.fillStyle = "#fbfbfb";
          ctx.fillRect(-10, -6, 20, 12);
          ctx.strokeStyle = "#e2e2e2";
          ctx.lineWidth = 1.2;
          ctx.strokeRect(-10, -6, 20, 12);
          // Fold crease lines
          ctx.strokeStyle = "rgba(0,0,0,0.08)";
          ctx.beginPath();
          ctx.moveTo(-10, 0); ctx.lineTo(10, 0);
          ctx.stroke();
          break;
        }
        case "shaker": {
          // shaker cup with a cap
          ctx.fillStyle = "rgba(46, 224, 255, 0.7)"; // translucent cyan
          ctx.fillRect(-4, -5, 8, 12);
          ctx.fillStyle = "#ff2e88"; // neon pink lid
          ctx.fillRect(-5, -8, 10, 3);
          ctx.fillRect(-2, -10, 4, 2); // cap loop
          break;
        }
      }
      ctx.restore();
    }
  }

  function drawWaterBottles() {
    for (const bottle of state.bottles) {
      ctx.save();
      ctx.translate(bottle.x, bottle.y);

      const splash = bottle.hitT > 0 ? bottle.hitT : 0;
      ctx.fillStyle = bottle.active ? "rgba(46,224,255,0.13)" : "rgba(46,224,255,0.2)";
      ctx.beginPath();
      ctx.ellipse(1, 7, bottle.active ? 12 : 18 + splash * 8, bottle.active ? 4 : 6 + splash * 4, 0, 0, TAU);
      ctx.fill();

      ctx.rotate(bottle.spin + (bottle.active ? Math.sin(state.t * 2.6 + bottle.seed) * 0.06 : 0.35));
      if (drawRasterCell("bottle", -16, -31, 32, 58, {
        alpha: bottle.active ? 0.96 : 0.45,
        shadowColor: bottle.active ? "rgba(46,224,255,0.55)" : "rgba(46,224,255,0.18)",
        shadowBlur: bottle.active ? 10 : 4,
      })) {
        ctx.restore();
        continue;
      }

      if (!bottle.active) {
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = "#79eaff";
        ctx.fillRect(-5, -4, 10, 8);
        ctx.fillStyle = "#f7d716";
        ctx.fillRect(5, -5, 4, 4);
        ctx.restore();
        continue;
      }

      const glow = 0.6 + 0.4 * Math.sin(state.t * 4.2 + bottle.seed);
      ctx.shadowColor = "rgba(46,224,255,0.6)";
      ctx.shadowBlur = 8 + glow * 5;

      ctx.fillStyle = "rgba(79,226,255,0.72)";
      ctx.fillRect(-5, -13, 10, 25);
      ctx.strokeStyle = "rgba(221,252,255,0.85)";
      ctx.lineWidth = 1.4;
      ctx.strokeRect(-5, -13, 10, 25);

      ctx.fillStyle = "rgba(255,255,255,0.32)";
      ctx.fillRect(-2, -10, 2, 18);
      ctx.fillStyle = "#f7d716";
      ctx.fillRect(-6, -17, 12, 5);
      ctx.fillRect(-3, -20, 6, 3);

      ctx.strokeStyle = "rgba(12,25,38,0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-4, 1);
      ctx.lineTo(4, -2);
      ctx.stroke();

      ctx.restore();
    }
  }

  function drawStairs() {
    for (const stair of state.stairs) {
      if (stair.floor && stair.floor !== state.floor) continue;

      ctx.save();
      ctx.translate(stair.x, stair.y);
      const pulse = 0.55 + 0.45 * Math.sin(state.t * 5);

      ctx.fillStyle = "rgba(247,215,22,0.12)";
      ctx.beginPath();
      ctx.arc(0, 0, STAIR_RADIUS + pulse * 5, 0, TAU);
      ctx.fill();

      if (!drawRasterCell("stairs", -44, -36, 88, 78, {
        shadowColor: "rgba(247,215,22,0.34)",
        shadowBlur: 10,
      })) {
        ctx.fillStyle = "rgba(10, 12, 18, 0.92)";
        ctx.strokeStyle = "rgba(247,215,22,0.9)";
        ctx.lineWidth = 2;
        ctx.fillRect(-28, -22, 56, 44);
        ctx.strokeRect(-28, -22, 56, 44);

        ctx.strokeStyle = "rgba(255,255,255,0.64)";
        ctx.lineWidth = 2;
        for (let y = -14; y <= 14; y += 7) {
          ctx.beginPath();
          ctx.moveTo(-20, y);
          ctx.lineTo(20, y);
          ctx.stroke();
        }
        ctx.strokeStyle = "rgba(46,224,255,0.75)";
        ctx.beginPath();
        ctx.moveTo(-18, 16);
        ctx.lineTo(18, -16);
        ctx.stroke();
      }

      ctx.fillStyle = "#f7d716";
      ctx.font = "bold 8px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText("STAIRS " + stair.label, 0, 35);
      ctx.fillStyle = "rgba(255,255,255,0.58)";
      ctx.fillText(state.floor + " -> " + (stair.toFloor || state.floor), 0, 47);
      ctx.restore();
    }
  }

  function traceRoundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
  }

  function drawFloorLabel(text, x, y, color, size = 8, align = "center") {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = "bold " + size + "px JetBrains Mono, monospace";
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function doorVisualBounds(ex) {
    const rx = ex.x - ex.w / 2;
    const ry = ex.y - ex.h / 2;
    if (ex.side === "right") return { x: WORLD_W - ex.w, y: clamp(ry, 0, WORLD_H - ex.h), w: ex.w, h: ex.h };
    if (ex.side === "left") return { x: 0, y: clamp(ry, 0, WORLD_H - ex.h), w: ex.w, h: ex.h };
    if (ex.side === "top") return { x: clamp(rx, 0, WORLD_W - ex.w), y: 0, w: ex.w, h: ex.h };
    if (ex.side === "bottom") return { x: clamp(rx, 0, WORLD_W - ex.w), y: WORLD_H - ex.h, w: ex.w, h: ex.h };
    return { x: clamp(rx, 0, WORLD_W - ex.w), y: clamp(ry, 0, WORLD_H - ex.h), w: ex.w, h: ex.h };
  }

  function drawHatch(x, y, w, h, color) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (let xx = x - h; xx < x + w + h; xx += 30) {
      ctx.beginPath();
      ctx.moveTo(xx, y + h);
      ctx.lineTo(xx + h, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDoorThreshold(label, bounds, color, locked = false) {
    ctx.save();
    ctx.fillStyle = locked ? "rgba(42,37,16,0.88)" : "rgba(18,18,28,0.92)";
    traceRoundRect(bounds.x, bounds.y, bounds.w, bounds.h, 6);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    traceRoundRect(bounds.x + 2, bounds.y + 2, bounds.w - 4, bounds.h - 4, 5);
    ctx.stroke();

    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    ctx.fillStyle = color;
    ctx.font = "bold 9px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (bounds.h > bounds.w) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(label, cx, cy);
    }
    ctx.restore();
  }

  function drawWallZone(o) {
    const x = o.x - o.w / 2;
    const y = o.y - o.h / 2;
    ctx.save();
    ctx.fillStyle = "rgba(2,5,10,0.92)";
    traceRoundRect(x, y, o.w, o.h, 8);
    ctx.fill();
    drawHatch(x + 4, y + 4, o.w - 8, o.h - 8, "rgba(46,224,255,0.10)");
    ctx.strokeStyle = "rgba(46,224,255,0.28)";
    ctx.lineWidth = 3;
    traceRoundRect(x, y, o.w, o.h, 8);
    ctx.stroke();
    if (o.w > 170 || o.h > 170) drawFloorLabel("WALL", o.x, o.y, "rgba(46,224,255,0.18)", 12);
    ctx.restore();
  }

  function drawTreadmillFloorPad(o, label = "TREADMILL") {
    const x = o.x - o.w / 2 - 12;
    const y = o.y - o.h / 2 - 12;
    const w = o.w + 24;
    const h = o.h + 24;
    ctx.save();
    ctx.fillStyle = "rgba(5,13,20,0.88)";
    traceRoundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(46,224,255,0.46)";
    ctx.lineWidth = 2.5;
    traceRoundRect(x, y, w, h, 12);
    ctx.stroke();

    ctx.fillStyle = "rgba(0,0,0,0.52)";
    traceRoundRect(o.x - o.w / 2 + 4, o.y - o.h / 2 + 8, o.w - 8, o.h - 12, 7);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    const off = (state.t * 42) % 18;
    for (let yy = o.y - o.h / 2 + 10 - off; yy < o.y + o.h / 2 - 6; yy += 18) {
      ctx.beginPath();
      ctx.moveTo(o.x - o.w / 2 + 9, yy);
      ctx.lineTo(o.x + o.w / 2 - 9, yy);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(46,224,255,0.34)";
    traceRoundRect(o.x - o.w / 2 + 5, o.y - o.h / 2 + 3, o.w - 10, 12, 4);
    ctx.fill();
    drawFloorLabel(label, o.x, o.y + o.h / 2 + 20, "rgba(46,224,255,0.62)", 7);
    ctx.restore();
  }

  function drawEquipmentFloorPad(o) {
    if (o.kind === "wall") {
      drawWallZone(o);
      return;
    }

    const x = o.x - o.w / 2;
    const y = o.y - o.h / 2;
    ctx.save();

    switch (o.kind) {
      case "tread":
        drawTreadmillFloorPad(o);
        break;

      case "rack":
        ctx.fillStyle = "rgba(44,31,19,0.88)";
        traceRoundRect(x - 14, y - 10, o.w + 28, o.h + 20, 8);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,125,223,0.36)";
        ctx.lineWidth = 2.5;
        traceRoundRect(x - 14, y - 10, o.w + 28, o.h + 20, 8);
        ctx.stroke();
        drawFloorLabel("RACK", o.x, y - 20, "rgba(255,125,223,0.58)", 7);
        break;

      case "bench":
        ctx.fillStyle = "rgba(9,16,24,0.82)";
        traceRoundRect(x - 12, y - 12, o.w + 24, o.h + 24, 9);
        ctx.fill();
        ctx.strokeStyle = "rgba(77,255,201,0.34)";
        ctx.lineWidth = 2;
        traceRoundRect(x - 12, y - 12, o.w + 24, o.h + 24, 9);
        ctx.stroke();
        drawFloorLabel("BENCH", o.x, o.y + o.h / 2 + 18, "rgba(77,255,201,0.50)", 7);
        break;

      case "cable":
        ctx.fillStyle = "rgba(8,18,16,0.84)";
        traceRoundRect(x - 12, y - 12, o.w + 24, o.h + 24, 10);
        ctx.fill();
        ctx.strokeStyle = "rgba(77,255,201,0.40)";
        ctx.lineWidth = 2.5;
        traceRoundRect(x - 12, y - 12, o.w + 24, o.h + 24, 10);
        ctx.stroke();
        drawFloorLabel("CABLE", o.x, y - 18, "rgba(77,255,201,0.56)", 7);
        break;

      case "plant":
        ctx.fillStyle = "rgba(40,70,45,0.34)";
        ctx.beginPath();
        ctx.arc(o.x, o.y, Math.max(o.w, o.h) / 2 + 16, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = "rgba(77,255,201,0.22)";
        ctx.lineWidth = 2;
        ctx.stroke();
        break;

      case "fountain":
        ctx.fillStyle = "rgba(26,70,95,0.72)";
        traceRoundRect(x - 10, y - 10, o.w + 20, o.h + 20, 8);
        ctx.fill();
        ctx.strokeStyle = "rgba(46,224,255,0.38)";
        ctx.lineWidth = 2;
        traceRoundRect(x - 10, y - 10, o.w + 20, o.h + 20, 8);
        ctx.stroke();
        drawFloorLabel("WATER", o.x, o.y, "rgba(210,250,255,0.45)", 7);
        break;

      case "ring":
        ctx.strokeStyle = "rgba(255,255,220,0.34)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(o.x, o.y, 30, 0, TAU);
        ctx.stroke();
        drawFloorLabel("FILM", o.x, o.y + 26, "rgba(255,255,220,0.45)", 7);
        break;
    }

    ctx.restore();
  }

  function drawFloorPolyline(path, color, width = 2, dash = [12, 12]) {
    if (!path || path.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.lineDashOffset = -state.t * 18;
    ctx.beginPath();
    ctx.moveTo(path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i][0], path[i][1]);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function drawPatrolFloorLanes() {
    for (const g of state.girls) {
      if (g.path && g.type === "walker") {
        drawFloorPolyline(g.path, "rgba(255,46,136,0.18)", 2, [18, 14]);
      }
    }
    for (const b of state.bruisers) {
      if (b.path && b.path.length > 1) {
        drawFloorPolyline(b.path, "rgba(247,215,22,0.12)", 1.5, [10, 13]);
      }
    }
  }

  function drawLevelFloorPlan(heat) {
    ctx.save();
    ctx.fillStyle = "rgba(5,8,13," + (0.68 + heat * 0.08) + ")";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    ctx.strokeStyle = "rgba(255,255,255,0.055)";
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 20, WORLD_W - 40, WORLD_H - 40);

    ctx.fillStyle = "rgba(7,12,18,0.62)";
    for (let y = 80; y < WORLD_H; y += 160) {
      ctx.fillRect(28, y, WORLD_W - 56, 2);
    }
    ctx.restore();

    const entryBounds = { x: 0, y: WORLD_DOOR_Y0, w: 30, h: WORLD_DOOR_Y1 - WORLD_DOOR_Y0 };
    drawDoorThreshold("ENTRY", entryBounds, "rgba(77,255,125,0.74)");

    for (const o of state.obstacles) drawEquipmentFloorPad(o);
    drawPatrolFloorLanes();

    for (const stair of state.stairs) {
      if (stair.floor && stair.floor !== state.floor) continue;
      ctx.save();
      ctx.fillStyle = "rgba(247,215,22,0.12)";
      traceRoundRect(stair.x - 58, stair.y - 48, 116, 96, 12);
      ctx.fill();
      ctx.strokeStyle = "rgba(247,215,22,0.42)";
      ctx.lineWidth = 2.5;
      traceRoundRect(stair.x - 58, stair.y - 48, 116, 96, 12);
      ctx.stroke();
      drawFloorLabel("STAIRS " + stair.label, stair.x, stair.y + 52, "rgba(247,215,22,0.66)", 8);
      ctx.restore();
    }

    const locked = state.exitFloor && state.floor !== state.exitFloor;
    drawDoorThreshold(locked ? state.exitFloor + " LOCKER" : "LOCKER", doorVisualBounds(state.exit), locked ? "rgba(247,215,22,0.76)" : "rgba(255,125,223,0.74)", locked);
  }

  function findNearestObstacle(kind, x, y, maxDistance) {
    let best = null;
    let bestD = maxDistance;
    for (const o of state.obstacles) {
      if (o.kind !== kind) continue;
      const d = dist(x, y, o.x, o.y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  function drawGirlEquipmentDock(g) {
    if (g.type === "stepper") {
      const tread = findNearestObstacle("tread", g.x, g.y, 145);
      const dock = tread || { x: g.x, y: g.y, w: 56, h: 88 };
      ctx.save();
      ctx.translate(dock.x - g.x, dock.y - g.y + 8);
      ctx.globalAlpha = tread ? 0.72 : 0.92;
      ctx.fillStyle = "rgba(4,9,14,0.92)";
      traceRoundRect(-dock.w / 2 + 4, -dock.h / 2, dock.w - 8, dock.h, 9);
      ctx.fill();
      ctx.strokeStyle = "rgba(46,224,255,0.55)";
      ctx.lineWidth = 2;
      traceRoundRect(-dock.w / 2 + 4, -dock.h / 2, dock.w - 8, dock.h, 9);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.11)";
      ctx.lineWidth = 1;
      const off = (state.t * 42) % 14;
      for (let y = -dock.h / 2 + 10 - off; y < dock.h / 2 - 8; y += 14) {
        ctx.beginPath();
        ctx.moveTo(-dock.w / 2 + 12, y);
        ctx.lineTo(dock.w / 2 - 12, y);
        ctx.stroke();
      }
      ctx.restore();
    } else if (g.type === "lifter") {
      ctx.save();
      ctx.fillStyle = "rgba(44,31,19,0.45)";
      traceRoundRect(-34, -14, 68, 40, 7);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,125,223,0.22)";
      ctx.lineWidth = 1.5;
      traceRoundRect(-34, -14, 68, 40, 7);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawGymFloor() {
    const heat = Math.min(1, (state.level - 1) / (LEVELS.length - 1));
    const baseGrad = ctx.createLinearGradient(0, 0, WORLD_W, WORLD_H);
    baseGrad.addColorStop(0, "#0d1018");
    baseGrad.addColorStop(0.48, heat > 0.55 ? "#15101b" : "#111522");
    baseGrad.addColorStop(1, heat > 0.4 ? "#1a1117" : "#10111c");
    if (drawImageCover(RASTER_ART.backdrop, 0, 0, WORLD_W, WORLD_H)) {
      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = baseGrad;
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      ctx.restore();
    } else {
      ctx.fillStyle = baseGrad;
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    }

    ctx.fillStyle = "rgba(255,255,255,0.018)";
    for (let y = 0; y < WORLD_H; y += 160) {
      ctx.fillRect(0, y + ((state.level * 23) % 80), WORLD_W, 2);
    }

    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 1;
    const tile = 40;
    for (let x = 0; x <= WORLD_W; x += tile) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke(); }
    for (let y = 0; y <= WORLD_H; y += tile) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke(); }

    ctx.strokeStyle = "rgba(77,255,201,0.035)";
    for (let x = -WORLD_H; x < WORLD_W; x += 140) {
      ctx.beginPath();
      ctx.moveTo(x, WORLD_H);
      ctx.lineTo(x + WORLD_H, 0);
      ctx.stroke();
    }

    // Center logo sits under the per-level floor plan so it never fights the map.
    drawGymLogo();
    drawLevelFloorPlan(heat);
    drawExitHalo();

    // Ambient spotlighting: soft circular glow tracking the player
    const p = state.player;
    ctx.save();
    const spotlight = ctx.createRadialGradient(p.x, p.y, 40, p.x, p.y, 340);
    spotlight.addColorStop(0, "rgba(46, 224, 255, 0.10)");
    spotlight.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = spotlight;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    const heatGlow = ctx.createRadialGradient(WORLD_W / 2, WORLD_H / 2, 180, WORLD_W / 2, WORLD_H / 2, WORLD_W * 0.7);
    heatGlow.addColorStop(0, "rgba(255,46,136," + (0.02 + heat * 0.035) + ")");
    heatGlow.addColorStop(1, "rgba(255,46,136,0)");
    ctx.fillStyle = heatGlow;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    // Soft vignette around the borders of the world
    const worldVignette = ctx.createRadialGradient(WORLD_W / 2, WORLD_H / 2, WORLD_W / 3, WORLD_W / 2, WORLD_H / 2, WORLD_W * 0.75);
    worldVignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    worldVignette.addColorStop(1, "rgba(4, 4, 8, 0.9)");
    ctx.fillStyle = worldVignette;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.restore();

    // Front door (left, center band)
    ctx.fillStyle = "#2a3a2a";
    ctx.fillRect(0, WORLD_DOOR_Y0, 30, WORLD_DOOR_Y1 - WORLD_DOOR_Y0);
    ctx.fillStyle = "#4dff7d";
    ctx.font = "11px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.fillText("FRONT", 4, WORLD_DOOR_Y0 - 8);
    ctx.fillText("DOOR", 4, WORLD_DOOR_Y1 + 16);

    // Dynamic Locker room exit door
    const ex = state.exit;
    const doorBounds = doorVisualBounds(ex);
    const rx = doorBounds.x;
    const ry = doorBounds.y;
    const exitLocked = state.exitFloor && state.floor !== state.exitFloor;
    ctx.fillStyle = exitLocked ? "#2e2a18" : "#3a2a3a";
    ctx.fillRect(rx, ry, doorBounds.w, doorBounds.h);
    ctx.strokeStyle = exitLocked ? "rgba(247,215,22,0.75)" : "rgba(255,125,223,0.48)";
    ctx.lineWidth = 2;
    ctx.strokeRect(rx, ry, doorBounds.w, doorBounds.h);

    const pulse = 0.5 + 0.5 * Math.sin(state.t * 4);
    const exitColor = exitLocked ? "#f7d716" : "#ff7ddf";
    const exitText = exitLocked ? state.exitFloor + " LOCKER" : "LOCKER ROOM";

    if (ex.side === "right") {
      ctx.fillStyle = exitColor;
      ctx.textAlign = "right";
      ctx.font = "11px JetBrains Mono, monospace";
      ctx.fillText(exitLocked ? state.exitFloor : "LOCKER", WORLD_W - 4, ry - 8);
      ctx.fillText(exitLocked ? "LOCKER" : "ROOM", WORLD_W - 4, ry + doorBounds.h + 16);
      ctx.fillStyle = "rgba(" + (exitLocked ? "247,215,22" : "255,125,223") + "," + (0.3 + 0.4 * pulse) + ")";
      ctx.font = "18px Arial";
      ctx.fillText("→", WORLD_W - 22, ex.y + 6);
    } else if (ex.side === "left") {
      ctx.fillStyle = exitColor;
      ctx.textAlign = "left";
      ctx.font = "11px JetBrains Mono, monospace";
      ctx.fillText(exitLocked ? state.exitFloor : "LOCKER", 4, ry - 8);
      ctx.fillText(exitLocked ? "LOCKER" : "ROOM", 4, ry + doorBounds.h + 16);
      ctx.fillStyle = "rgba(" + (exitLocked ? "247,215,22" : "255,125,223") + "," + (0.3 + 0.4 * pulse) + ")";
      ctx.font = "18px Arial";
      ctx.fillText("←", 22, ex.y + 6);
    } else if (ex.side === "top") {
      ctx.fillStyle = exitColor;
      ctx.textAlign = "center";
      ctx.font = "11px JetBrains Mono, monospace";
      ctx.fillText(exitText, ex.x, 24 + doorBounds.h);
      ctx.fillStyle = "rgba(" + (exitLocked ? "247,215,22" : "255,125,223") + "," + (0.3 + 0.4 * pulse) + ")";
      ctx.font = "18px Arial";
      ctx.fillText("↑", ex.x, 22);
    } else if (ex.side === "bottom") {
      ctx.fillStyle = exitColor;
      ctx.textAlign = "center";
      ctx.font = "11px JetBrains Mono, monospace";
      ctx.fillText(exitText, ex.x, ry - 12);
      ctx.fillStyle = "rgba(" + (exitLocked ? "247,215,22" : "255,125,223") + "," + (0.3 + 0.4 * pulse) + ")";
      ctx.font = "18px Arial";
      ctx.fillText("↓", ex.x, WORLD_H - 22);
    }
  }

  function drawObstacles() {
    for (const o of state.obstacles) {
      const x0 = o.x - o.w / 2, y0 = o.y - o.h / 2;
      ctx.save();
      switch (o.kind) {
        case "rack":
          if (drawObstacleSprite("bench", o, 1.36, 1.22, {
            outline: "rgba(255,46,136,0.22)",
            shadowColor: "rgba(255,46,136,0.3)",
            shadowBlur: 9,
          })) break;
          // Steel base rack
          ctx.fillStyle = "#22222a";
          ctx.fillRect(x0, y0, o.w, o.h);
          ctx.strokeStyle = "#444454";
          ctx.lineWidth = 2;
          ctx.strokeRect(x0, y0, o.w, o.h);
          
          // Red neon frame accents
          ctx.strokeStyle = "rgba(255, 46, 136, 0.65)";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x0 + 3, y0 + 3, o.w - 6, o.h - 6);

          // Steel pegs and weight plates stacked
          ctx.fillStyle = "#111116";
          ctx.strokeStyle = "#888899";
          ctx.lineWidth = 1;
          const plateRadiusY = Math.min(8, o.h / 6);
          const plateRadiusX = Math.min(14, o.w / 4);
          // Left weights
          ctx.beginPath();
          ctx.ellipse(x0 + plateRadiusX, y0 + o.h * 0.25, plateRadiusX, plateRadiusY, 0, 0, TAU);
          ctx.fill(); ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(x0 + plateRadiusX - 3, y0 + o.h * 0.75, plateRadiusX, plateRadiusY, 0, 0, TAU);
          ctx.fill(); ctx.stroke();
          // Right weights
          ctx.beginPath();
          ctx.ellipse(x0 + o.w - plateRadiusX, y0 + o.h * 0.25, plateRadiusX, plateRadiusY, 0, 0, TAU);
          ctx.fill(); ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(x0 + o.w - plateRadiusX + 3, y0 + o.h * 0.75, plateRadiusX, plateRadiusY, 0, 0, TAU);
          ctx.fill(); ctx.stroke();
          break;

        case "bench":
          if (drawObstacleSprite("bench", o, 1.42, 1.5, {
            outline: "rgba(77,255,201,0.24)",
            shadowColor: "rgba(46,224,255,0.24)",
            shadowBlur: 8,
          })) break;
          // Metal frame base
          ctx.fillStyle = "#1b1b24";
          ctx.fillRect(x0, y0, o.w, o.h);
          ctx.strokeStyle = "#3f3f4e";
          ctx.lineWidth = 2;
          ctx.strokeRect(x0, y0, o.w, o.h);

          // Leather cushion pad in center
          ctx.fillStyle = "#2a2a3a";
          ctx.fillRect(x0 + 4, y0 + 4, o.w - 8, o.h - 8);
          // Cushion seams
          ctx.strokeStyle = "#4dffc9"; // glowing stitching
          ctx.lineWidth = 1;
          ctx.strokeRect(x0 + 4, y0 + 4, o.w - 8, o.h - 8);
          // Highlight shine line
          ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
          ctx.fillRect(x0 + 4, y0 + 4, o.w - 8, (o.h - 8) / 2);
          break;

        case "tread": {
          if (drawObstacleSprite("treadmill", o, 1.34, 1.18, {
            outline: "rgba(46,224,255,0.26)",
            shadowColor: "rgba(46,224,255,0.28)",
            shadowBlur: 10,
          })) break;
          // Frame
          ctx.fillStyle = "#161622";
          ctx.fillRect(x0, y0, o.w, o.h);
          ctx.strokeStyle = "#5f5f7a";
          ctx.lineWidth = 2.5;
          ctx.strokeRect(x0, y0, o.w, o.h);

          // Running belt
          ctx.fillStyle = "#0d0d12";
          ctx.fillRect(x0 + 6, y0 + 10, o.w - 12, o.h - 14);

          // Animated belt stripes
          ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
          const off = (state.t * 30) % 16;
          for (let yy = y0 + 12 - off; yy < y0 + o.h - 8; yy += 16) {
            if (yy > y0 + 10) ctx.fillRect(x0 + 8, yy, o.w - 16, 2);
          }

          // Digital console at the top
          ctx.fillStyle = "#222230";
          ctx.fillRect(x0 + 2, y0 + 2, o.w - 4, 8);
          ctx.fillStyle = "#00e5ff"; // neon cyan stats screen
          ctx.fillRect(x0 + 8, y0 + 4, o.w - 16, 4);
          break;
        }

        case "plant":
          if (drawObstacleSprite("plant", o, 1.45, 1.45, {
            outline: "rgba(77,255,201,0.2)",
            shadowColor: "rgba(77,255,201,0.24)",
            shadowBlur: 8,
          })) break;
          // Ceramic pot shadow and base
          ctx.fillStyle = "rgba(0,0,0,0.2)";
          ctx.beginPath();
          ctx.arc(o.x + 2, o.y + 2, o.w / 2, 0, TAU);
          ctx.fill();

          ctx.fillStyle = "#f5f5f5"; // white ceramic pot
          ctx.beginPath();
          ctx.arc(o.x, o.y, o.w / 2.3, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = "#d7ccc8";
          ctx.lineWidth = 2;
          ctx.stroke();

          // Multi-tone leaves
          const leafColors = ["#1b5e20", "#2e7d32", "#388e3c", "#4caf50"];
          for (let i = 0; i < 7; i++) {
            const angle = (i / 7) * TAU + state.t * 0.15;
            const length = o.w / 2 + 2;
            const width = o.w / 5;
            ctx.fillStyle = leafColors[i % leafColors.length];
            ctx.beginPath();
            ctx.ellipse(
              o.x + Math.cos(angle) * 6,
              o.y + Math.sin(angle) * 6,
              length,
              width,
              angle,
              0,
              TAU
            );
            ctx.fill();
            // Leaf center vein line
            ctx.strokeStyle = "rgba(255,255,255,0.15)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(o.x, o.y);
            ctx.lineTo(o.x + Math.cos(angle) * length, o.y + Math.sin(angle) * length);
            ctx.stroke();
          }
          break;

        case "fountain":
          // Metallic basin
          ctx.fillStyle = "#2c3e50";
          ctx.fillRect(x0, y0, o.w, o.h);
          ctx.strokeStyle = "#7f8c8d";
          ctx.lineWidth = 2.5;
          ctx.strokeRect(x0, y0, o.w, o.h);

          // Water basin pool
          ctx.fillStyle = "#1e3c72";
          ctx.fillRect(x0 + 4, y0 + 4, o.w - 8, o.h - 8);

          // Animated water spray
          ctx.fillStyle = "rgba(100, 220, 255, 0.75)";
          const sprayCount = 4;
          for (let i = 0; i < sprayCount; i++) {
            const sprayT = (state.t * 2.5 + i / sprayCount) % 1.0;
            const sprayX = o.x + Math.sin(state.t * 5 + i) * 3;
            const sprayY = o.y - 10 * sprayT * (1 - sprayT);
            ctx.beginPath();
            ctx.arc(sprayX, sprayY, 1.5, 0, TAU);
            ctx.fill();
          }
          break;

        case "cable":
          if (drawObstacleSprite("cable", o, 1.18, 1.52, {
            outline: "rgba(77,255,201,0.28)",
            shadowColor: "rgba(77,255,201,0.28)",
            shadowBlur: 9,
          })) break;
          // Frame base
          ctx.fillStyle = "#1c1c24";
          ctx.fillRect(x0, y0, o.w, o.h);
          ctx.strokeStyle = "#4dffc9";
          ctx.lineWidth = 2;
          ctx.strokeRect(x0, y0, o.w, o.h);

          // Left weight stack
          ctx.fillStyle = "#2c2c35";
          ctx.fillRect(x0 + 4, y0 + 6, 10, o.h - 12);
          // Right weight stack
          ctx.fillRect(x0 + o.w - 14, y0 + 6, 10, o.h - 12);
          
          // Horizontal weight stack divider lines
          ctx.strokeStyle = "#111116";
          ctx.lineWidth = 1;
          for (let yy = y0 + 10; yy < y0 + o.h - 10; yy += 6) {
            ctx.beginPath();
            ctx.moveTo(x0 + 4, yy); ctx.lineTo(x0 + 14, yy);
            ctx.moveTo(x0 + o.w - 14, yy); ctx.lineTo(x0 + o.w - 4, yy);
            ctx.stroke();
          }

          // Cable wires linking left and right
          ctx.strokeStyle = "#7f8c8d";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(x0 + 9, o.y);
          ctx.bezierCurveTo(x0 + 20, o.y - 10, x0 + o.w - 20, o.y - 10, x0 + o.w - 9, o.y);
          ctx.stroke();
          break;

        case "ring":
          // Tripod stand
          ctx.strokeStyle = "#33333f";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(o.x, o.y); ctx.lineTo(o.x - 8, o.y + 16);
          ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + 8, o.y + 16);
          ctx.moveTo(o.x, o.y); ctx.lineTo(o.x, o.y + 12);
          ctx.stroke();

          // Ring light circle outer glow
          ctx.save();
          ctx.shadowBlur = 10;
          ctx.shadowColor = "rgba(255, 255, 220, 0.9)";
          ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(o.x, o.y, 8, 0, TAU);
          ctx.stroke();
          ctx.restore();

          // Innermost camera phone details
          ctx.fillStyle = "#111";
          ctx.fillRect(o.x - 2, o.y - 3, 4, 6);
          break;

        case "wall":
          // Dark metallic panel fill
          ctx.fillStyle = "#0c0c14";
          ctx.fillRect(x0, y0, o.w, o.h);

          // Pulsing cyan neon trim
          const wallPulse = 0.75 + 0.25 * Math.sin(state.t * 3);
          ctx.strokeStyle = "rgba(46, 224, 255, " + (0.35 * wallPulse) + ")";
          ctx.lineWidth = 3;
          ctx.strokeRect(x0, y0, o.w, o.h);

          // Inner panel bevel border
          ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x0 + 4, y0 + 4, o.w - 8, o.h - 8);

          // Rivets / corner dots
          ctx.fillStyle = "rgba(46, 224, 255, 0.25)";
          ctx.beginPath();
          ctx.arc(x0 + 8, y0 + 8, 2, 0, TAU);
          ctx.arc(x0 + o.w - 8, y0 + 8, 2, 0, TAU);
          ctx.arc(x0 + 8, y0 + o.h - 8, 2, 0, TAU);
          ctx.arc(x0 + o.w - 8, y0 + o.h - 8, 2, 0, TAU);
          ctx.fill();
          break;
      }
      ctx.restore();
    }
  }

  function drawPersonLabel(label, x, y, color, offsetY = 34) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = color || "#d8e6ef";
    ctx.font = "bold 7px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, x, y + offsetY);
    ctx.restore();
  }

  function girlSpriteSpec(g) {
    if (g.type === "influencer") return { name: "girlInfluencer", w: 58, h: 78, footY: 28 };
    if (g.type === "lifter") return { name: "girlLifter", w: 74, h: 72, footY: 26 };
    return { name: "girlWalker", w: 42, h: 82, footY: 28 };
  }

  function drawGeneratedGirl(g, bodyBobY) {
    const spec = girlSpriteSpec(g);
    const drawn = drawActorSprite(spec.name, 0, 0, spec.w, spec.h, g.facing - Math.PI / 2, spec.footY - bodyBobY, {
      shadowColor: g.notice > 0.15 ? "rgba(255,60,60,0.45)" : "rgba(255,46,136,0.22)",
      shadowBlur: g.notice > 0.15 ? 12 : 7,
    });
    if (!drawn) return false;

    if (g.phoneActive && g.type !== "influencer") {
      ctx.save();
      ctx.translate(14, -24 - bodyBobY);
      ctx.fillStyle = "#fff";
      ctx.fillRect(-3, -5, 6, 10);
      ctx.fillStyle = "#00e5ff";
      ctx.fillRect(-2, -3, 4, 6);
      ctx.restore();
    }

    if (g.notice > 0.15) {
      const crit = g.notice > 0.65;
      ctx.fillStyle = crit ? "#ff3c3c" : "#f7d716";
      ctx.font = "bold " + (crit ? 20 : 15) + "px Arial";
      ctx.textAlign = "center";
      ctx.fillText(crit ? "!" : "?", 0, -38 - bodyBobY);
    }

    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "8px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(g.label, 0, 34);
    return true;
  }

  function drawPatron(patron) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.ellipse(patron.x + 2, patron.y + 16, 14, 5, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (drawActorSprite("patron", patron.x, patron.y, 42, 78, patron.facing - Math.PI / 2, 31, {
      shadowColor: "rgba(46,224,255,0.18)",
      shadowBlur: 6,
    })) {
      drawPersonLabel(patron.role, patron.x, patron.y, "#d8e6ef", 36);
      return;
    }

    ctx.save();
    ctx.translate(patron.x, patron.y);
    ctx.rotate(patron.facing);

    const bob = Math.sin(state.t * 5 + patron.seed) * 1.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = patron.pants;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-4, 8 + bob);
    ctx.lineTo(-7, 20 + bob);
    ctx.moveTo(4, 8 + bob);
    ctx.lineTo(7, 20 + bob);
    ctx.stroke();

    ctx.fillStyle = "#f5f7fb";
    ctx.beginPath();
    ctx.ellipse(-8, 21 + bob, 5, 2, 0, 0, TAU);
    ctx.ellipse(8, 21 + bob, 5, 2, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = patron.shirt;
    ctx.beginPath();
    ctx.ellipse(0, -2 + bob, 11, 13, 0, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = patron.skin;
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(-8, -3 + bob);
    ctx.lineTo(-14, 7 + bob);
    ctx.moveTo(8, -3 + bob);
    ctx.lineTo(14, 7 + bob);
    ctx.stroke();

    ctx.fillStyle = patron.skin;
    ctx.fillRect(-3, -18 + bob, 6, 6);
    ctx.beginPath();
    ctx.arc(0, -23 + bob, 7.5, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "#22170f";
    ctx.beginPath();
    ctx.arc(0, -27 + bob, 7.5, Math.PI, 0);
    ctx.fill();

    if (patron.role === "STAFF" || patron.role === "WALK-IN") {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillRect(12, 3 + bob, 4, 6);
      ctx.strokeStyle = "rgba(46,224,255,0.8)";
      ctx.lineWidth = 1;
      ctx.strokeRect(12, 3 + bob, 4, 6);
    }

    ctx.restore();

    drawPersonLabel(patron.role, patron.x, patron.y, "#d8e6ef", 34);
  }

  function drawPatrons() {
    for (const patron of state.patrons) drawPatron(patron);
  }

  function drawBruiser(b) {
    const playerD = dist(state.player.x, state.player.y, b.x, b.y);
    const alert = playerD < b.aggro;
    const swing = b.swingT > 0 ? Math.sin((b.swingT / 0.28) * Math.PI) : 0;

    ctx.save();
    if (b.path && b.path.length > 1) {
      ctx.strokeStyle = "rgba(247,215,22,0.08)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 9]);
      ctx.beginPath();
      ctx.moveTo(b.path[0][0], b.path[0][1]);
      for (let i = 1; i < b.path.length; i++) ctx.lineTo(b.path[i][0], b.path[i][1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (alert || b.swingT > 0) {
      ctx.strokeStyle = b.swingT > 0 ? "rgba(255,60,60,0.75)" : "rgba(247,215,22,0.32)";
      ctx.lineWidth = b.swingT > 0 ? 4 : 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.hit + Math.sin(state.t * 10 + b.seed) * 2, 0, TAU);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath();
    ctx.ellipse(b.x + 3, b.y + 22, 26, 8, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (drawActorSprite("bruiser", b.x, b.y, 56, 96, b.facing - Math.PI / 2, 38, {
      shadowColor: alert ? "rgba(247,215,22,0.34)" : "rgba(255,46,136,0.2)",
      shadowBlur: alert ? 12 : 7,
    })) {
      ctx.save();
      ctx.fillStyle = alert ? "rgba(247,215,22,0.9)" : "rgba(255,255,255,0.48)";
      ctx.font = "bold 8px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText(b.label, b.x, b.y + 45);
      if (b.swingT > 0) {
        ctx.fillStyle = "#ff3c3c";
        ctx.font = "bold 13px JetBrains Mono, monospace";
        ctx.fillText("SMACK", b.x, b.y - 48);
      }
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.facing);

    const bob = Math.sin(state.t * 7 + b.seed) * 1.5;
    const flex = 1 + (alert ? 0.08 : 0) + swing * 0.08;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Legs and shoes
    ctx.strokeStyle = b.skin;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(-8, 12 + bob);
    ctx.lineTo(-12, 28 + bob);
    ctx.moveTo(8, 12 + bob);
    ctx.lineTo(12, 28 + bob);
    ctx.stroke();
    ctx.fillStyle = "#f5f7fb";
    ctx.beginPath();
    ctx.ellipse(-14, 30 + bob, 8, 3, 0, 0, TAU);
    ctx.ellipse(14, 30 + bob, 8, 3, 0, 0, TAU);
    ctx.fill();

    // Shorts and torso
    ctx.fillStyle = b.shorts;
    ctx.fillRect(-18, 6 + bob, 36, 17);
    ctx.fillStyle = b.tank;
    ctx.beginPath();
    ctx.ellipse(0, -6 + bob, 22 * flex, 20, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(77,255,201,0.75)";
    ctx.fillRect(-5, -16 + bob, 10, 4);

    // Arms
    ctx.strokeStyle = b.skin;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(-18, -9 + bob);
    ctx.lineTo(-31, 5 + bob);
    ctx.moveTo(18, -9 + bob);
    ctx.lineTo(33 + swing * 16, 2 - swing * 7 + bob);
    ctx.stroke();

    // Gloves/hands
    ctx.fillStyle = "#111116";
    ctx.beginPath();
    ctx.arc(-33, 6 + bob, 7, 0, TAU);
    ctx.arc(35 + swing * 16, 2 - swing * 7 + bob, 7, 0, TAU);
    ctx.fill();

    // Neck and head
    ctx.fillStyle = b.skin;
    ctx.fillRect(-5, -25 + bob, 10, 10);
    ctx.beginPath();
    ctx.arc(0, -32 + bob, 11, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#1b120c";
    ctx.beginPath();
    ctx.arc(0, -37 + bob, 11, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = "#ff2e88";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, -33 + bob);
    ctx.lineTo(8, -33 + bob);
    ctx.stroke();

    // Direction eyes
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(7, -34 + bob, 2.2, 0, TAU);
    ctx.arc(7, -29 + bob, 2.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(8, -34 + bob, 1, 0, TAU);
    ctx.arc(8, -29 + bob, 1, 0, TAU);
    ctx.fill();

    ctx.restore();

    ctx.save();
    ctx.fillStyle = alert ? "rgba(247,215,22,0.9)" : "rgba(255,255,255,0.48)";
    ctx.font = "bold 8px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(b.label, b.x, b.y + 45);
    if (b.swingT > 0) {
      ctx.fillStyle = "#ff3c3c";
      ctx.font = "bold 13px JetBrains Mono, monospace";
      ctx.fillText("SMACK", b.x, b.y - 48);
    }
    ctx.restore();
  }

  function drawBruisers() {
    for (const b of state.bruisers) drawBruiser(b);
  }

  function drawGirlCone(g) {
    if (g.phoneActive || state.decoy) return;
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.facing);
    const alarmed = g.notice > 0.15;
    const base = alarmed ? "255,60,60" : "255,46,136";
    const grad = ctx.createLinearGradient(0, 0, g.range, 0);
    grad.addColorStop(0, "rgba(" + base + ",0.30)");
    grad.addColorStop(1, "rgba(" + base + ",0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, g.range, -g.coneW, g.coneW);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawGirl(g) {
    ctx.save();
    ctx.translate(g.x, g.y);

    drawGirlEquipmentDock(g);

    // 1. Drop shadow
    ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
    ctx.beginPath();
    ctx.ellipse(0, 16, 11, 4, 0, 0, TAU);
    ctx.fill();

    // 2. Compute workout animations
    let squatY = 0;
    let leftLegOffset = 0;
    let rightLegOffset = 0;
    let bodyBobY = 0;
    let ponytailSwayX = 0;

    if (g.type === "lifter") {
      // Periodic squatting: squats down, holds, stands up
      const squatCycle = (state.t * 2) % (Math.PI * 2);
      squatY = Math.max(0, Math.sin(squatCycle) * 6);
      bodyBobY = squatY * 0.7;
    } else if (g.type === "walker") {
      // Walking leg swing and hair sway
      const cycle = state.t * 8;
      leftLegOffset = Math.sin(cycle) * 6;
      rightLegOffset = -Math.sin(cycle) * 6;
      bodyBobY = Math.abs(Math.sin(cycle)) * 2;
      ponytailSwayX = Math.cos(cycle) * 3;
    } else if (g.type === "stepper") {
      // Stepping rapid vertical leg movement and bobbing
      const cycle = state.t * 14;
      leftLegOffset = Math.sin(cycle) * 4;
      rightLegOffset = -Math.sin(cycle) * 4;
      bodyBobY = Math.abs(Math.sin(cycle)) * 1.5;
      ponytailSwayX = Math.cos(cycle) * 1.5;
    }

    if (drawGeneratedGirl(g, bodyBobY)) {
      ctx.restore();
      return;
    }

    // Facing direction rotation for upper body
    ctx.save();
    ctx.rotate(g.facing);

    // 3. Shoes (feet)
    ctx.fillStyle = "#ffffff"; // white athletic shoes
    // Left shoe
    ctx.beginPath();
    ctx.ellipse(-6, 18 + leftLegOffset - squatY * 0.2, 4, 2, 0, 0, TAU);
    ctx.fill();
    // Right shoe
    ctx.beginPath();
    ctx.ellipse(6, 18 + rightLegOffset - squatY * 0.2, 4, 2, 0, 0, TAU);
    ctx.fill();

    // 4. Leggings (legs)
    ctx.fillStyle = g.leggings;
    // Left leg
    ctx.beginPath();
    ctx.ellipse(-6, 10 + leftLegOffset / 2 - squatY * 0.4, 4, 8, 0, 0, TAU);
    ctx.fill();
    // Right leg
    ctx.beginPath();
    ctx.ellipse(6, 10 + rightLegOffset / 2 - squatY * 0.4, 4, 8, 0, 0, TAU);
    ctx.fill();

    // 5. Torso (Body)
    // Hips/Butt
    ctx.beginPath();
    ctx.ellipse(0, 1 - bodyBobY, 9, 6, 0, 0, TAU);
    ctx.fill();

    // Waist / Skin
    ctx.fillStyle = "#f1c27d"; // skin tone
    ctx.fillRect(-6, -8 - bodyBobY, 12, 8);

    // Sports Crop Top
    ctx.fillStyle = g.leggings; // matching outfit
    ctx.fillRect(-7, -8 - bodyBobY, 14, 5);

    // 6. Shoulders / Chest
    ctx.beginPath();
    ctx.ellipse(0, -8 - bodyBobY, 8.5, 4.5, 0, 0, TAU);
    ctx.fill();

    // 7. Head
    ctx.fillStyle = "#f1c27d";
    ctx.beginPath();
    ctx.arc(0, -18 - bodyBobY, 6.5, 0, TAU);
    ctx.fill();

    // 8. Hair & Workout Ponytail
    ctx.fillStyle = "#3a1a0a"; // brown hair
    // Main hair cap
    ctx.beginPath();
    ctx.arc(0, -20 - bodyBobY, 6, Math.PI, 0);
    ctx.fill();
    // Ponytail bun or sway ponytail
    ctx.beginPath();
    ctx.ellipse(ponytailSwayX, -23 - bodyBobY, 3.5, 5, ponytailSwayX * 0.1, 0, TAU);
    ctx.fill();

    // Phone drawing
    if (g.phoneActive) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(-3, -22 - bodyBobY, 6, 4);
      ctx.fillStyle = "#00e5ff"; // glowing screen
      ctx.fillRect(-2, -21 - bodyBobY, 4, 2);
    }
    if (g.type === "influencer") {
      // phone on a stick, always
      ctx.fillStyle = "#fff";
      ctx.fillRect(8, -24 - bodyBobY, 5, 8);
      ctx.fillStyle = "#000";
      ctx.fillRect(9, -23 - bodyBobY, 3, 6);
    }
    ctx.restore(); // end facing rotation

    // Notice indicator: "?" building, "!" about to accuse (stays billboarded to screen space)
    if (g.notice > 0.15) {
      const crit = g.notice > 0.65;
      ctx.fillStyle = crit ? "#ff3c3c" : "#f7d716";
      ctx.font = "bold " + (crit ? 20 : 15) + "px Arial";
      ctx.textAlign = "center";
      ctx.fillText(crit ? "!" : "?", 0, -32 - bodyBobY);
    }

    // Label
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "8px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(g.label, 0, 32);
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
    ctx.font = "15px Arial";
    ctx.textAlign = "center";
    ctx.fillText("🏋️", 0, 5);
    ctx.restore();
  }

  function drawGazeCone() {
    const p = state.player;
    if (p.eyesClosed) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.facing);
    // Cone goes pink when the neck is winning
    const col = state.fighting ? "255,46,136" : "247,215,22";
    const grad = ctx.createLinearGradient(0, 0, GAZE_RANGE, 0);
    grad.addColorStop(0, "rgba(" + col + ",0.28)");
    grad.addColorStop(1, "rgba(" + col + ",0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, GAZE_RANGE, -GAZE_HALF_ANGLE, GAZE_HALF_ANGLE);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(" + col + ",0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(GAZE_RANGE, 0);
    ctx.stroke();
    ctx.restore();

    // Temptation tether: wobbly line from eyes to the girl the neck wants
    if (state.fighting && state.pullTarget && state.airpodT <= 0) {
      const g = state.pullTarget;
      ctx.save();
      ctx.strokeStyle = "rgba(255,46,136,0.35)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 5]);
      ctx.lineDashOffset = -state.t * 30;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      const mx = (p.x + g.x) / 2 + Math.sin(state.t * 8) * 8;
      const my = (p.y + g.y) / 2 + Math.cos(state.t * 7) * 8;
      ctx.quadraticCurveTo(mx, my, g.x, g.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPlayer() {
    const p = state.player;
    ctx.save();
    ctx.translate(p.x, p.y);

    // 1. Drop shadow
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    ctx.beginPath();
    ctx.ellipse(0, PLAYER_RADIUS + 4, 11, 4, 0, 0, TAU);
    ctx.fill();

    // 2. Walking Bob
    const bobY = p.moving ? 1.5 * Math.sin(state.t * 12) : 0;

    const generatedBase = drawActorSprite("player", 0, 0, 48, 74, p.facing - Math.PI / 2, 29 + bobY, {
      shadowColor: state.fighting ? "rgba(255,46,136,0.34)" : "rgba(46,224,255,0.22)",
      shadowBlur: state.fighting ? 12 : 7,
    });

    if (!generatedBase) {
      // 3. Torso (Gym Tank Top)
      ctx.fillStyle = "#f1c27d"; // skin tone neck
      ctx.fillRect(-3, 0 + bobY, 6, 6);
      
      ctx.fillStyle = "#2c3e50"; // dark blue tank top
      ctx.beginPath();
      ctx.ellipse(0, 7 + bobY, 10, 5, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#16a085"; // tank top strap accents
      ctx.fillRect(-8, 3 + bobY, 3, 4);
      ctx.fillRect(5, 3 + bobY, 3, 4);

      // 4. Head
      ctx.fillStyle = "#f1c27d";
      ctx.beginPath();
      ctx.arc(0, -3 + bobY, PLAYER_RADIUS * 0.85, 0, TAU);
      ctx.fill();

      // 5. Hair and Sweatband
      ctx.fillStyle = "#2a1a0a"; // brown hair
      ctx.beginPath();
      ctx.arc(0, -6 + bobY, PLAYER_RADIUS * 0.7, Math.PI, 0);
      ctx.fill();

      // Glowing Neon Sweatband
      ctx.strokeStyle = "#ff2e88";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-7, -6 + bobY);
      ctx.lineTo(7, -6 + bobY);
      ctx.stroke();

      // 6. Eyes (Look Direction)
      ctx.save();
      ctx.rotate(p.facing);
      if (p.eyesClosed) {
        // closed eyes: little dashes
        ctx.strokeStyle = "#111";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(1, -2); ctx.lineTo(6, -2);
        ctx.moveTo(1, 2); ctx.lineTo(6, 2);
        ctx.stroke();
      } else {
        // open eyes
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(4, -2, 2, 0, TAU);
        ctx.arc(4, 2, 2, 0, TAU);
        ctx.fill();

        // Pupils looking alert
        ctx.fillStyle = "#000000";
        ctx.beginPath();
        ctx.arc(5, -2, 1, 0, TAU);
        ctx.arc(5, 2, 1, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    if (state.stunT > 0) {
      ctx.strokeStyle = "rgba(247,215,22,0.9)";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = state.t * 8 + i * (TAU / 3);
        const x = Math.cos(a) * 13;
        const y = -21 + Math.sin(a) * 4 + bobY;
        ctx.moveTo(x - 3, y);
        ctx.lineTo(x + 3, y);
        ctx.moveTo(x, y - 3);
        ctx.lineTo(x, y + 3);
      }
      ctx.stroke();
    }

    // 7. Sweat Droplets when SUS is high (>50)
    if (state.sus > 50) {
      ctx.fillStyle = "#2ee0ff";
      const dropletCount = Math.floor((state.sus - 50) / 10) + 1;
      for (let i = 0; i < dropletCount; i++) {
        const seedAngle = (i / dropletCount) * TAU + state.t * 3;
        const progress = ((state.t * 2.5 + i * 0.4) % 1);
        const dist = 11 + 9 * progress;
        const dropX = Math.cos(seedAngle) * dist;
        const dropY = Math.sin(seedAngle) * dist - 3 + bobY;
        ctx.beginPath();
        ctx.arc(dropX, dropY, 1.2 * (1 - progress), 0, TAU);
        ctx.fill();
      }
    }

    // 8. Power-up Overlays
    if (state.boyfriendT > 0) {
      ctx.strokeStyle = "rgba(46,224,255," + (0.5 + 0.5 * Math.sin(state.t * 10)) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER_RADIUS + 7 + Math.sin(state.t * 10) * 2, 0, TAU);
      ctx.stroke();
    }
    if (state.airpodT > 0) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(-PLAYER_RADIUS - 1, -6 + bobY, 2.5, 6);
      ctx.fillRect(PLAYER_RADIUS - 1, -6 + bobY, 2.5, 6);
    }
    ctx.restore();
  }

  function drawDarkness() {
    if (!state.player.eyesClosed) return;
    const p = state.player;
    ctx.save();
    const sx = p.x - state.cam.x;
    const sy = p.y - state.cam.y;
    const pulse = 1 + 0.1 * Math.sin(state.t * 4);
    const levelShrink = 1 - Math.min(0.34, (state.level - 1) * 0.045);
    const innerRadius = 28 * pulse * levelShrink;
    const outerRadius = 92 * pulse * levelShrink;
    const grad = ctx.createRadialGradient(sx, sy, innerRadius, sx, sy, outerRadius);
    grad.addColorStop(0, "rgba(0,0,0,0.58)");
    grad.addColorStop(1, "rgba(0,0,0,0.985)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.restore();
  }

  function drawHud() {
    const canvasWrap = canvas && canvas.parentElement;
    if (canvasWrap) canvasWrap.dataset.eyesClosed = state.player.eyesClosed ? "true" : "false";

    // SUS bar
    const fill = document.getElementById("hud-sus-fill");
    const pct = document.getElementById("hud-sus-pct");
    if (fill) {
      fill.style.width = state.sus + "%";
      fill.dataset.zone = state.sus < 35 ? "ok" : state.sus < 70 ? "warn" : "crit";
    }
    if (pct) pct.textContent = Math.round(state.sus) + "%";

    // EYES state chip
    const eyes = document.getElementById("hud-eyes");
    if (eyes) {
      let label, zone;
      if (state.tripT > 0)              { label = "TRIPPED";   zone = "crit"; }
      else if (state.stunT > 0)         { label = "STUNNED";   zone = "crit"; }
      else if (state.player.eyesClosed) { label = "CLOSED";    zone = "shut"; }
      else if (state.airpodT > 0)       { label = "LOCKED 🎧"; zone = "ok"; }
      else if (state.fighting)          { label = "FIGHTING";  zone = "crit"; }
      else                              { label = "OPEN";      zone = "ok"; }
      eyes.textContent = label;
      eyes.dataset.zone = zone;
    }

    const lvEl = document.getElementById("hud-level");
    if (lvEl) lvEl.textContent = state.level + "/" + LEVELS.length;
    const heatEl = document.getElementById("hud-heat");
    if (heatEl) heatEl.textContent = getHeatLabel() + (state.exitFloor ? " " + state.floor : "");
    const distEl = document.getElementById("hud-dist");
    if (distEl) {
      const remaining = objectiveDistanceFrom(state.player.x, state.player.y);
      const progress = clamp(1 - remaining / state.levelStartDist, 0, 1);
      distEl.textContent = Math.floor(progress * 100) + "%";
    }
    const scoreEl = document.getElementById("hud-score");
    if (scoreEl) scoreEl.textContent = state.score;
    const highEl = document.getElementById("hud-high");
    if (highEl) highEl.textContent = RB.getHighScore("dont-look-gym-girl") || 0;
  }

  function render() {
    let sx = 0, sy = 0;
    if (state.cam.shake > 0) {
      sx = (Math.random() - 0.5) * state.cam.shake * 14;
      sy = (Math.random() - 0.5) * state.cam.shake * 14;
    }
    ctx.save();
    ctx.translate(sx, sy);

    ctx.save();
    ctx.translate(-state.cam.x, -state.cam.y);
    drawGymFloor();
    
    // Draw non-colliding background decorations
    drawDecorations();
    drawWaterBottles();
    drawStairs();

    // Draw wood lifting platforms under racks
    for (const o of state.obstacles) {
      if (o.kind === "rack") drawLiftingPlatform(o.x, o.y, o.w, o.h);
    }

    drawObstacles();
    drawPatrons();
    drawBruisers();

    // Draw glowing neon signs on top of walls
    for (const o of state.obstacles) {
      if (o.kind === "wall") drawWallSign(o);
    }

    for (const g of state.girls) drawGirlCone(g);
    drawDecoy();
    for (const g of state.girls) drawGirl(g);
    drawGazeCone();
    drawPlayer();
    ctx.restore();

    drawDarkness();

    if (state.cam.flash > 0) {
      ctx.fillStyle = "rgba(255,46,136," + (state.cam.flash * 0.6) + ")";
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    ctx.restore();
    drawHud();
  }

  // =========================================================================
  // 17. MAIN LOOP
  // =========================================================================
  function loop(now) {
    if (!state.lastTime) state.lastTime = now;
    const dt = Math.min(0.05, (now - state.lastTime) / 1000);
    state.lastTime = now;
    state.t += dt;

    if (state.running && !state.paused) {
      state.levelT += dt;
      readInput();
      updateBruisers(dt);
      updatePatrons(dt);
      updatePlayer(dt);
      updateStairs(dt);
      state.cam.x = clamp(state.player.x - W / 2, 0, WORLD_W - W);
      state.cam.y = clamp(state.player.y - H / 2, 0, WORLD_H - H);
      updateGaze(dt);
      const lv = LEVELS[state.level - 1];
      for (const g of state.girls) updateGirl(g, lv, dt);
      updatePowerTimers(dt);
      if (!state.gameOver) updateSus(dt);
      if (!state.gameOver) updateBumps(dt);
      if (!state.gameOver) updatePatronBumps();
      if (!state.gameOver) updateWaterBottles(dt);
      if (!state.gameOver) updateBruiserThreats();
      state.cam.shake = Math.max(0, state.cam.shake - dt * 2);
      state.cam.flash = Math.max(0, state.cam.flash - dt * 3);
      if (!state.gameOver && !state.won) checkLevelProgress();
    }

    render();
    requestAnimationFrame(loop);
  }

  function initFullscreenControls() {
    const fullscreenBtn = document.getElementById("btn-fullscreen");
    if (!fullscreenBtn) return;

    function toggleFullscreen() {
      const stage = document.querySelector(".game-stage");
      if (!stage) return;
      const requestMethod = stage.requestFullscreen || 
                            stage.webkitRequestFullscreen || 
                            stage.msRequestFullscreen;
      if (requestMethod) {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
          requestMethod.call(stage).catch((err) => {
            console.error(`Error attempting to enable fullscreen: ${err.message}`);
          });
        } else {
          const exitMethod = document.exitFullscreen || document.webkitExitFullscreen;
          if (exitMethod) exitMethod.call(document);
        }
      }
    }

    fullscreenBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFullscreen();
    });

    const onFullscreenChange = () => {
      const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
      fullscreenBtn.innerHTML = isFullscreen ? "⛶ Minimize" : "⛶ Maximize";
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
  }

  // =========================================================================
  // 18. BOOT
  // =========================================================================
  function init() {
    loadLevel(1);
    requestAnimationFrame(loop);
    document.getElementById("btn-primary").addEventListener("click", () => { ensureAudio(); startGame(); });
    document.getElementById("btn-pause").addEventListener("click", () => {
      state.paused = !state.paused;
      document.getElementById("btn-pause").textContent = state.paused ? "Resume" : "Pause";
    });
    document.getElementById("btn-restart").addEventListener("click", restart);
    if (saveSlot) {
      saveMenu = saveSlot.attachButtons({
        primary: document.getElementById("btn-primary"),
        scoreEl: document.getElementById("overlay-score"),
        continueLabel: "Continue",
        newLabel: "New run",
        onContinue: restoreGame,
        summary: (saved) => {
          const data = saved.data || {};
          return `${window.RBGameSaves.formatSavedAt(saved.savedAt)} · Level <strong>${Number(data.level || 1)}/${LEVELS.length}</strong> · Score <strong>${Number(data.score || 0).toLocaleString()}</strong>`;
        },
      });
      saveSlot.startAutosave(snapshot, () => state.running && !state.gameOver && !state.won);
    }
    bindTouchControls();
    initFullscreenControls();
    renderPowerButtons();
  }

  function snapshot() {
    return JSON.parse(JSON.stringify({
      level: state.level,
      levelT: state.levelT,
      levelPeakSus: state.levelPeakSus,
      score: state.score,
      player: state.player,
      sus: state.sus,
      fighting: state.fighting,
      pullTarget: state.pullTarget,
      girls: state.girls,
      obstacles: state.obstacles,
      bruisers: state.bruisers,
      bottles: state.bottles,
      patrons: state.patrons,
      stairs: state.stairs,
      decor: state.decor,
      exit: state.exit,
      floor: state.floor,
      exitFloor: state.exitFloor,
      levelStartDist: state.levelStartDist,
      exitHintT: state.exitHintT,
      stairCooldown: state.stairCooldown,
      airpodT: state.airpodT,
      boyfriendT: state.boyfriendT,
      decoy: state.decoy,
      stunT: state.stunT,
      tripT: state.tripT,
      knockX: state.knockX,
      knockY: state.knockY,
      cam: state.cam,
      t: state.t,
    }));
  }

  function restoreGame(saved) {
    const data = saved && saved.data;
    if (!data) return;
    Object.assign(state, {
      ...state,
      ...data,
      player: { ...state.player, ...(data.player || {}) },
      touchJoystick: { active: false, dirX: 0, dirY: 0 },
      touchEyesClosed: false,
      girls: Array.isArray(data.girls) ? data.girls : [],
      obstacles: Array.isArray(data.obstacles) ? data.obstacles : [],
      bruisers: Array.isArray(data.bruisers) ? data.bruisers : [],
      bottles: Array.isArray(data.bottles) ? data.bottles : [],
      patrons: Array.isArray(data.patrons) ? data.patrons : [],
      stairs: Array.isArray(data.stairs) ? data.stairs : [],
      decor: Array.isArray(data.decor) ? data.decor : [],
      running: true,
      paused: false,
      gameOver: false,
      won: false,
      started: true,
      lastTime: 0,
    });
    document.getElementById("shame-mount").innerHTML = "";
    document.getElementById("overlay").classList.remove("overlay--show");
    showBanner("LEVEL " + state.level + " · CONTINUED", 1.4);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Debug hook (same convention as window.__AGAIN)
  window.__GYM = { state, LEVELS, startGame, restart, bust, loadLevel };
})();
