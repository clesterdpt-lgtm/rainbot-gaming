/* =============================================================================
   SHIFT'S END — Rainbot After Dark · No. 003
   ----------------------------------------------------------------------------
   Fixed-camera retail horror. MVP scaffold: one zone (Vestibule + first aisle),
   WASD tank-style movement, Price Scanner mechanic, Planogram puzzle (full).
   Built against Three.js r128 (vendored).
   =========================================================================== */
(function () {
  "use strict";

  if (typeof THREE === "undefined") {
    document.getElementById("err-msg").textContent =
      "Three.js failed to load. Check that ../assets/vendor/three/three-r128.min.js is reachable.";
    document.getElementById("scr-error").classList.remove("scr--hide");
    return;
  }

  // ----- DOM refs -----
  const stage = document.getElementById("stage");
  const hudCam = document.getElementById("hud-cam");
  const hudZone = document.getElementById("hud-zone");
  const hudScanner = document.getElementById("hud-scanner");
  const hudPuzzle = document.getElementById("hud-puzzle");
  const bannerTime = document.getElementById("banner-time");
  const scanOverlay = document.getElementById("scan-overlay");
  const scanCursor = document.getElementById("scan-cursor");
  const promptEl = document.getElementById("prompt");
  const toastEl = document.getElementById("toast");
  const scrTitle = document.getElementById("scr-title");
  const scrPause = document.getElementById("scr-pause");
  const scrEnd = document.getElementById("scr-end");
  const errMsg = document.getElementById("err-msg");

  // ----- Constants -----
  const COLORS = {
    tile:        0xb8a07a,
    tileDark:    0x6b5f4a,
    shelf:       0x8a7e6a,
    shelfMetal:  0x4a4538,
    wall:        0xd8c9a8,
    ceiling:     0xe8d8b8,
    vest:        0xf7d716,
    vestTrim:    0xff2e88,
    skin:        0xc8a888,
    hair:        0x2a1f15,
    bottle:      [0xff2e88, 0x2ee0ff, 0xf7d716, 0x6bff7d, 0xff6b35, 0x9b59b6],
    scanner:     0x2ee0ff,
    camera:      0xff2e88,
    shadow:      0x0a0a08,
    fog:         0x0a0a08,
  };
  const TILE = 1.2;             // world unit per tile
  const MOVE_SPEED = 2.2;       // units/sec, tank-style (camera-relative)
  const ROOM_HALF = 8;          // vestibule ~16x16 units
  const AISLE_LENGTH = 14;
  const AISLE_WIDTH = 1.8;
  const SHELF_HEIGHT = 2.2;
  const SHELF_LEN = AISLE_LENGTH * 0.85;
  const PUZZLE_TARGET = {
    planogram: [0, 2, 1],     // planogram: bottle color indices for slot 0/1/2
    barcode:   [4, 2, 7],     // barcode: digit values on hidden prices (code "427")
  };
  const SHELF_SLOTS_Y = 1.4;    // shelf bottle y position
  const SHELF_SLOTS_X = [-0.6, 0, 0.6]; // local x positions of the 3 slots

  // ----- State -----
  const state = {
    mode: "title",          // "title" | "playing" | "paused" | "end"
    scannerArmed: false,    // mouse held
    scanMode: false,        // true while right-mouse held (or alt)
    pickup: null,           // currently held bottle { mesh, colorIdx }
    puzzleCorrect: 0,       // count of correctly-placed bottles
    puzzle2Done: false,
    currentZone: 1,         // 1 = vestibule/aisle, 2 = home goods
    cameraCutT: 0,          // for smooth camera cut animation
    cameraCutFrom: { pos: null, look: null },
    cameraCutTo:   { pos: new THREE.Vector3(7, 7.2, 9), look: new THREE.Vector3(0, 1, 0) },
    keypad: { buffer: "", state: "idle" },
    hiddenPriceObjects: [], // populated after world build
    gate2OpenT: 0,
    shiftStart: 0,          // performance.now()
    bannerSec: 0,
  };
  const keys = { w: false, a: false, s: false, d: false };

  // ----- Three.js setup -----
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x0a0a08, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a08);
  scene.fog = new THREE.Fog(COLORS.fog, 9, 24);

  // Fixed camera — high-angle CCTV look (slight dutch for unease)
  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    80
  );
  camera.position.set(7, 7.2, 9);
  camera.lookAt(0, 1, 0);
  camera.rotation.z = THREE.MathUtils.degToRad(-1.5); // mild dutch

  // Lighting — fluorescent overhead, single warm key, dim ambient
  const ambient = new THREE.AmbientLight(0xe8d8b8, 0.18);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0xfff4d8, 0x1a1814, 0.22);
  scene.add(hemi);

  const fluorA = new THREE.PointLight(0xfff4d8, 0.8, 14, 2);
  fluorA.position.set(0, 4.5, 0);
  fluorA.castShadow = true;
  fluorA.shadow.mapSize.set(512, 512);
  fluorA.shadow.camera.near = 0.5;
  fluorA.shadow.camera.far = 18;
  fluorA.shadow.bias = -0.0008;
  scene.add(fluorA);

  const fluorB = new THREE.PointLight(0xfff4d8, 0.6, 12, 2);
  fluorB.position.set(0, 4.5, -6);
  scene.add(fluorB);

  // Flicker state for the fluorescent
  const flicker = { baseA: 0.8, baseB: 0.6, tA: 0, tB: 0 };

  // ----- Geometry helpers -----
  function box(w, h, d, color, opts = {}) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({
        color,
        roughness: opts.roughness != null ? opts.roughness : 0.85,
        metalness: opts.metalness != null ? opts.metalness : 0.05,
        emissive: opts.emissive || 0x000000,
        emissiveIntensity: opts.emissiveIntensity || 0,
      })
    );
    m.castShadow = opts.castShadow !== false;
    m.receiveShadow = opts.receiveShadow !== false;
    return m;
  }

  function plane(w, d, color, rot = 0) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.0 })
    );
    m.rotation.x = -Math.PI / 2 + rot;
    m.receiveShadow = true;
    return m;
  }

  // Procedural checker tile texture for the floor
  function makeTileTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#b8a07a";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#a08860";
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if ((x + y) % 2 === 0) ctx.fillRect(x * 64, y * 64, 64, 64);
      }
    }
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        ctx.fillRect(x * 64 + 62, y * 64, 2, 64);
        ctx.fillRect(x * 64, y * 64 + 62, 64, 2);
      }
    }
    // Scuff marks
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = "rgba(80,60,40," + (0.05 + Math.random() * 0.1) + ")";
      ctx.beginPath();
      ctx.ellipse(Math.random() * 256, Math.random() * 256, 20 + Math.random() * 30, 3 + Math.random() * 4, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(8, 8);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  // ----- Build the world -----
  const world = new THREE.Group();
  scene.add(world);

  // Floor — vestible area
  const tileTex = makeTileTexture();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HALF * 2 + AISLE_LENGTH),
    new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.95, metalness: 0.0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -AISLE_LENGTH / 2);
  floor.receiveShadow = true;
  world.add(floor);

  // Ceiling (simple)
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HALF * 2 + AISLE_LENGTH),
    new THREE.MeshStandardMaterial({ color: 0xe8d8b8, roughness: 1.0, side: THREE.DoubleSide })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, 5.5, -AISLE_LENGTH / 2);
  world.add(ceiling);

  // Walls (vestibule only for MVP)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.95 });
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(ROOM_HALF * 2, 5.5, 0.2), wallMat);
  backWall.position.set(0, 2.75, -ROOM_HALF - AISLE_LENGTH);
  backWall.receiveShadow = true;
  world.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5.5, ROOM_HALF * 2 + AISLE_LENGTH), wallMat);
  leftWall.position.set(-ROOM_HALF, 2.75, -AISLE_LENGTH / 2);
  world.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5.5, ROOM_HALF * 2 + AISLE_LENGTH), wallMat);
  rightWall.position.set(ROOM_HALF, 2.75, -AISLE_LENGTH / 2);
  world.add(rightWall);

  // Front wall (behind player camera direction) — mostly glass doors implied
  const frontWall = new THREE.Mesh(
    new THREE.BoxGeometry(ROOM_HALF * 2, 5.5, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x6b5f4a, roughness: 0.6, metalness: 0.4 })
  );
  frontWall.position.set(0, 2.75, ROOM_HALF);
  world.add(frontWall);

  // "EXIT" sign on front wall (red glow)
  const exitSign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.4),
    new THREE.MeshStandardMaterial({
      color: 0xff3333,
      emissive: 0xff2222,
      emissiveIntensity: 0.9,
      side: THREE.DoubleSide,
    })
  );
  exitSign.position.set(0, 4.6, ROOM_HALF + 0.12);
  world.add(exitSign);

  // Shelving rows — two rows forming the first aisle
  function makeShelfRow(z) {
    const row = new THREE.Group();
    // Shelf frame
    const frame = box(SHELF_LEN, SHELF_HEIGHT, AISLE_WIDTH, COLORS.shelf, { metalness: 0.3, roughness: 0.7 });
    frame.position.set(0, SHELF_HEIGHT / 2, 0);
    row.add(frame);
    // 3 horizontal planks
    for (let i = 0; i < 3; i++) {
      const y = 0.4 + i * 0.7;
      const plank = box(SHELF_LEN, 0.05, AISLE_WIDTH * 0.95, COLORS.shelfMetal, { metalness: 0.4, roughness: 0.6 });
      plank.position.set(0, y, 0);
      row.add(plank);
    }
    // End caps (yellow)
    for (const dx of [-SHELF_LEN / 2 - 0.05, SHELF_LEN / 2 + 0.05]) {
      const cap = box(0.1, SHELF_HEIGHT, AISLE_WIDTH, 0xc4a000, { metalness: 0.2 });
      cap.position.set(dx, SHELF_HEIGHT / 2, 0);
      row.add(cap);
    }
    row.position.set(0, 0, z);
    return row;
  }
  const shelfBack = makeShelfRow(-AISLE_LENGTH / 2);
  const shelfFront = makeShelfRow(-AISLE_LENGTH / 2 + AISLE_WIDTH);
  world.add(shelfBack);
  world.add(shelfFront);

  // Hydrualic gate at end of aisle (the puzzle's reward)
  const gate = new THREE.Group();
  const gateFrame = box(0.1, 3, AISLE_WIDTH, COLORS.shelfMetal, { metalness: 0.5 });
  gateFrame.position.set(0, 1.5, 0);
  gate.add(gateFrame);
  const gateSlats = [];
  for (let i = 0; i < 8; i++) {
    const slat = box(AISLE_WIDTH, 0.18, 0.06, 0x2a2520, { metalness: 0.6 });
    slat.position.set(0, 0.4 + i * 0.32, 0);
    gate.add(slat);
    gateSlats.push(slat);
  }
  gate.position.set(0, 0, -AISLE_LENGTH);
  world.add(gate);
  let gateOpen = false, gateOpenT = 0;

  // Planogram diagram on the back shelf (the "Aisle Reset Map")
  const planogramBoard = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x1a1814, side: THREE.DoubleSide, roughness: 0.7 })
  );
  planogramBoard.position.set(-4, 1.8, -AISLE_LENGTH / 2 - AISLE_WIDTH / 2 - 0.12);
  planogramBoard.rotation.y = Math.PI;
  world.add(planogramBoard);

  // Add the 3 planogram target squares to the board
  const planogramTargets = [];
  for (let i = 0; i < 3; i++) {
    const sq = new THREE.Mesh(
      new THREE.PlaneGeometry(0.18, 0.18),
      new THREE.MeshBasicMaterial({ color: COLORS.bottle[PUZZLE_TARGET.planogram[i]] })
    );
    sq.position.set(-0.3 + i * 0.3, 0, 0.01);
    sq.rotation.y = Math.PI;
    planogramBoard.add(sq);
    planogramTargets.push(sq);
  }

  // Bottles: 3 on the shelf (slots), 6 on the floor
  const bottles = []; // each: { mesh, colorIdx, slot: -1|0|1|2, kind: 'shelf'|'floor' }
  function makeBottle(colorIdx, x, y, z, kind) {
    const bodyColor = COLORS.bottle[colorIdx];
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.55, 12),
      new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.4, metalness: 0.1, emissive: bodyColor, emissiveIntensity: 0.08 })
    );
    body.position.y = 0.27;
    body.castShadow = true;
    group.add(body);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10),
      new THREE.MeshStandardMaterial({ color: 0x1a1814, roughness: 0.6 })
    );
    cap.position.y = 0.58;
    group.add(cap);
    // White label band
    const label = new THREE.Mesh(
      new THREE.CylinderGeometry(0.181, 0.181, 0.18, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xe8d8b8, roughness: 0.6, side: THREE.DoubleSide })
    );
    label.position.y = 0.22;
    group.add(label);
    group.position.set(x, y, z);
    group.userData = { isBottle: true, colorIdx, kind };
    bottles.push(group);
    world.add(group);
    return group;
  }

  // 3 slot bottles (initially wrong, will be moved).
  // The planogram target is PUZZLE_TARGET = [0,2,1]. We seed with
  // colors that are guaranteed to NOT match any of those slots:
  // slot 0 starts with color 3 (not 0)
  // slot 1 starts with color 4 (not 2)
  // slot 2 starts with color 5 (not 1)
  const SHELF_INITIAL = [3, 4, 5];
  for (let i = 0; i < 3; i++) {
    const bottle = makeBottle(SHELF_INITIAL[i], SHELF_SLOTS_X[i], SHELF_SLOTS_Y, -AISLE_LENGTH / 2, "shelf");
    bottle.userData.slot = i;
  }
  // 6 floor bottles (3 colors × 2 each, scrambled).
  // We need bottles of colors 0, 1, 2 (the planogram colors) on the floor
  // so the player can solve the puzzle. Plus the 3 colors we put on the shelf
  // (3, 4, 5) need a matching bottle on the floor to allow swapping back.
  const FLOOR_BOTTLES = [0, 2, 1, 0, 1, 2]; // 2 of each planogram color
  const floorXSpread = [-3, -1.8, -0.6, 0.6, 1.8, 3];
  const floorZ = -AISLE_LENGTH / 2 + 2.2; // between vestibule and shelves
  for (let i = 0; i < 6; i++) {
    const bottle = makeBottle(FLOOR_BOTTLES[i], floorXSpread[i], 0.28, floorZ, "floor");
    bottle.userData.slot = -1;
    bottle.userData.origX = floorXSpread[i];
    bottle.userData.origZ = floorZ;
  }

  // Player — TRAINEE with hi-vis vest
  const player = new THREE.Group();
  const torso = box(0.5, 0.7, 0.3, COLORS.vest, { emissive: COLORS.vest, emissiveIntensity: 0.15 });
  torso.position.y = 0.95;
  player.add(torso);
  const vestStrip = box(0.52, 0.08, 0.32, COLORS.vestTrim);
  vestStrip.position.set(0, 0.85, 0);
  player.add(vestStrip);
  // Robot Head (matching the Rainbot logo: dark navy box, cyan center eye, pink spokes)
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.55, 0);

  // Head base - dark navy box/screen (matching logo fill)
  const headBase = box(0.44, 0.44, 0.35, 0x02050a, { metalness: 0.5, roughness: 0.3 });
  headBase.castShadow = true;
  headGroup.add(headBase);

  // Cyan Eye Lens in the center of the face plate facing +z (matching logo circle)
  const eye = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.04, 16),
    new THREE.MeshStandardMaterial({
      color: 0x23dff2,
      emissive: 0x23dff2,
      emissiveIntensity: 1.5,
      roughness: 0.1,
    })
  );
  eye.rotation.x = Math.PI / 2;
  eye.position.set(0, 0, 0.18);
  headGroup.add(eye);

  // Pink Spokes (radiating from the center, matching the logo paths)
  const angles = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, (5 * Math.PI) / 4, (3 * Math.PI) / 2, (7 * Math.PI) / 4];
  angles.forEach((angle) => {
    const spoke = box(0.02, 0.15, 0.02, 0xff1490, {
      emissive: 0xff1490,
      emissiveIntensity: 0.6,
    });
    const radius = 0.14;
    spoke.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0.178);
    spoke.rotation.z = angle + Math.PI / 2;
    headGroup.add(spoke);
  });

  // Trainee Cap on top of the robot head
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.08, 14),
    new THREE.MeshStandardMaterial({ color: 0x1a1814, roughness: 0.7 })
  );
  cap.position.y = 0.26;
  headGroup.add(cap);

  const brim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.02, 14),
    new THREE.MeshStandardMaterial({ color: 0x1a1814, roughness: 0.7 })
  );
  brim.position.set(0, 0.27, 0.06);
  brim.scale.set(1, 1, 1.4);
  headGroup.add(brim);

  player.add(headGroup);
  // Legs
  for (const dx of [-0.12, 0.12]) {
    const leg = box(0.18, 0.55, 0.2, 0x2a2820);
    leg.position.set(dx, 0.4, 0);
    player.add(leg);
  }
  player.position.set(0, 0, 4.5);
  world.add(player);

  // The Price Scanner pickup (visible on a small table near the start)
  const scanner = new THREE.Group();
  const scannerBody = box(0.08, 0.18, 0.04, 0x1a1814, { metalness: 0.5, roughness: 0.4 });
  scannerBody.position.y = 0.1;
  scanner.add(scannerBody);
  const scannerScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.06, 0.04),
    new THREE.MeshBasicMaterial({ color: COLORS.scanner, side: THREE.DoubleSide })
  );
  scannerScreen.position.set(0, 0.13, 0.025);
  scanner.add(scannerScreen);
  scanner.position.set(2.5, 0.0, 4.2);
  world.add(scanner);
  let scannerPickedUp = false;
  scanner.userData.isScanner = true;

  // Small table the scanner sits on
  const scannerTable = box(0.6, 0.05, 0.4, 0x6b5f4a, { metalness: 0.1 });
  scannerTable.position.set(2.5, 0.025, 4.2);
  world.add(scannerTable);
  for (const [dx, dz] of [[-0.25, -0.15], [0.25, -0.15], [-0.25, 0.15], [0.25, 0.15]]) {
    const leg = box(0.05, 0.05, 0.05, 0x3a3528);
    leg.position.set(2.5 + dx, 0.025, 4.2 + dz);
    world.add(leg);
  }

  // PA speaker on ceiling (visual)
  const paCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 0.4, 12, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x4a4538, roughness: 0.7, side: THREE.DoubleSide })
  );
  paCone.position.set(-3, 5.3, 0);
  paCone.rotation.x = Math.PI;
  world.add(paCone);

  // Some cardboard boxes for set dressing
  for (let i = 0; i < 5; i++) {
    const bx = box(0.7 + Math.random() * 0.3, 0.6 + Math.random() * 0.3, 0.6 + Math.random() * 0.3, 0xa08060, { roughness: 0.95 });
    bx.position.set(-5 + Math.random() * 10, 0.3, 4 + Math.random() * 2);
    bx.rotation.y = Math.random() * Math.PI;
    world.add(bx);
  }

  // Welcome mat at front
  const mat = box(2, 0.02, 1, 0x6b3a2a, { roughness: 0.95 });
  mat.position.set(0, 0.01, 5.5);
  world.add(mat);

  // Price tags floating above bottles (only visible in scan mode)
  const priceTagGroup = new THREE.Group();
  priceTagGroup.visible = false;
  world.add(priceTagGroup);
  function makePriceTag(colorIdx) {
    const cv = document.createElement("canvas");
    cv.width = 96; cv.height = 48;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#1a1814";
    ctx.fillRect(0, 0, 96, 48);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 20px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const codes = ["BR-01", "BR-02", "BR-03", "BR-04", "BR-05", "BR-06"];
    ctx.fillText(codes[colorIdx] || ("BR-" + colorIdx), 48, 24);
    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), mat);
    return m;
  }
  for (const b of bottles) {
    const tag = makePriceTag(b.userData.colorIdx);
    tag.position.y = 0.85;
    b.add(tag);
    b.userData.priceTag = tag;
  }

  // =====================================================================
  // ZONE 2 — HOME GOODS (added by Puzzle 2 council synthesis)
  // =====================================================================

  // Floor extends from z = -14 to z = -28
  const zone2Floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_HALF * 2, 14),
    new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.95, metalness: 0.0 })
  );
  zone2Floor.rotation.x = -Math.PI / 2;
  zone2Floor.position.set(0, 0, -21);
  zone2Floor.receiveShadow = true;
  world.add(zone2Floor);

  // Back wall (where the keypad sits)
  const zone2BackWall = new THREE.Mesh(
    new THREE.BoxGeometry(ROOM_HALF * 2, 5.5, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.95 })
  );
  zone2BackWall.position.set(0, 2.75, -28);
  zone2BackWall.receiveShadow = true;
  world.add(zone2BackWall);

  // Divider wall between Zone 1 aisle and Zone 2 (with a gap for passage)
  const zone1EndWall = new THREE.Mesh(
    new THREE.BoxGeometry(ROOM_HALF * 2 - 2, 5.5, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x6b5f4a, roughness: 0.85 })
  );
  zone1EndWall.position.set(1, 2.75, -14);
  zone1EndWall.receiveShadow = true;
  world.add(zone1EndWall);

  // Product display shelves (low platforms, like Home Goods endcaps)
  function makeProductShelf(x, y, z, w, d) {
    const shelf = box(w, y, d, 0xc8a880, { roughness: 0.8 });
    shelf.position.set(x, y / 2, z);
    return shelf;
  }
  const shelfA = makeProductShelf(-3.5, 0.9, -17, 1.6, 1.2);
  const shelfB = makeProductShelf(0, 0.45, -19, 1.8, 1.2);
  const shelfC = makeProductShelf(4.0, 0.65, -20, 1.4, 1.2);
  world.add(shelfA); world.add(shelfB); world.add(shelfC);

  // The 3 hidden-price objects: Sigma Scented Candle, Rizz Rug Roll, NPC Throw Pillow
  function makeProduct(type, x, y, z, digit) {
    const g = new THREE.Group();
    if (type === "candle") {
      // tall cylindrical jar with a label
      const jar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.28, 0.7, 16),
        new THREE.MeshStandardMaterial({ color: 0xe8d8b8, roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.6 })
      );
      jar.position.y = 0.35;
      g.add(jar);
      const wax = new THREE.Mesh(
        new THREE.CylinderGeometry(0.23, 0.23, 0.55, 14),
        new THREE.MeshStandardMaterial({ color: 0xff66cc, roughness: 0.5, emissive: 0xff66cc, emissiveIntensity: 0.1 })
      );
      wax.position.y = 0.32;
      g.add(wax);
      const wick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.01, 0.01, 0.06, 6),
        new THREE.MeshStandardMaterial({ color: 0x2a1f15 })
      );
      wick.position.y = 0.66;
      g.add(wick);
    } else if (type === "rug") {
      // rolled rug, cylinder on its side
      const roll = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 1.2, 14),
        new THREE.MeshStandardMaterial({ color: 0x9b3a2a, roughness: 0.9 })
      );
      roll.rotation.z = Math.PI / 2;
      roll.position.y = 0.22;
      g.add(roll);
      const stripes = new THREE.Mesh(
        new THREE.CylinderGeometry(0.225, 0.225, 1.18, 14, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xf7d716, roughness: 0.9, side: THREE.DoubleSide })
      );
      stripes.rotation.z = Math.PI / 2;
      stripes.position.y = 0.22;
      g.add(stripes);
    } else if (type === "pillow") {
      // stack of 2 squishy pillows
      for (let i = 0; i < 2; i++) {
        const pillow = box(0.5, 0.18, 0.4, 0x6bff7d, { roughness: 0.95 });
        pillow.position.y = 0.1 + i * 0.2;
        g.add(pillow);
      }
    }
    g.position.set(x, y, z);
    g.userData = {
      isHiddenPrice: true,
      digit: digit,
      revealed: false,
      product: type,
      priceTag: null,
    };
    return g;
  }
  const hiddenPriceSigma   = makeProduct("candle", -3.5, 0.9,  -17, 4);
  const hiddenPriceRizzRug = makeProduct("rug",     0,   0.45, -19, 2);
  const hiddenPricePillow  = makeProduct("pillow",  4.0, 0.65, -20, 7);
  world.add(hiddenPriceSigma);
  world.add(hiddenPriceRizzRug);
  world.add(hiddenPricePillow);
  state.hiddenPriceObjects = [hiddenPriceSigma, hiddenPriceRizzRug, hiddenPricePillow];

  // Hidden price tags (only visible in scan mode AND after player has been close)
  function makeBigPriceTag(digit) {
    const cv = document.createElement("canvas");
    cv.width = 128; cv.height = 64;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#1a1814";
    ctx.fillRect(0, 0, 128, 64);
    ctx.strokeStyle = "#f7d716";
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, 124, 60);
    ctx.fillStyle = "#f7d716";
    ctx.font = "bold 36px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("$" + digit + ".99", 64, 32);
    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), mat);
    return m;
  }
  for (const obj of state.hiddenPriceObjects) {
    const tag = makeBigPriceTag(obj.userData.digit);
    tag.position.y = 1.1;
    tag.visible = false;
    obj.add(tag);
    obj.userData.priceTag = tag;
  }

  // Security keypad on the back wall
  const keypadGroup = new THREE.Group();
  // Backplate
  const keypadPlate = box(0.8, 1.0, 0.1, 0x2a2520, { metalness: 0.5, roughness: 0.4 });
  keypadPlate.position.y = 0.5;
  keypadGroup.add(keypadPlate);
  // Display screen
  const keypadScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.18),
    new THREE.MeshBasicMaterial({ color: 0x0a0a08 })
  );
  keypadScreen.position.set(0, 0.85, 0.06);
  keypadGroup.add(keypadScreen);
  // Numeric display (changes with state)
  const keypadDisplay = new THREE.Mesh(
    new THREE.PlaneGeometry(0.46, 0.14),
    new THREE.MeshBasicMaterial({ color: 0x2ee0ff, transparent: true, opacity: 0.9 })
  );
  keypadDisplay.position.set(0, 0.85, 0.07);
  keypadGroup.add(keypadDisplay);
  // Digit buttons 0-9 + Enter
  const keypadButtons = [];
  const buttonLayout = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
    [-1, 0, -2], // -1 = clear, -2 = enter
  ];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      const digit = buttonLayout[row][col];
      const btn = box(0.16, 0.13, 0.04, 0x4a4538, { metalness: 0.6, roughness: 0.4 });
      btn.position.set(-0.22 + col * 0.22, 0.55 - row * 0.15, 0.06);
      // label
      const cv = document.createElement("canvas");
      cv.width = 64; cv.height = 48;
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#e8d8b8";
      ctx.font = "bold 28px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (digit === -1) ctx.fillText("C", 32, 24);
      else if (digit === -2) ctx.fillText("OK", 32, 24);
      else ctx.fillText("" + digit, 32, 24);
      const tex = new THREE.CanvasTexture(cv);
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(0.12, 0.09),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true })
      );
      label.position.set(0, 0, 0.022);
      btn.add(label);
      btn.userData = { isKeypadButton: true, digit: digit };
      keypadGroup.add(btn);
      keypadButtons.push(btn);
    }
  }
  // Mount on back wall, facing toward player (z = -28)
  keypadGroup.position.set(0, 1.4, -27.85);
  world.add(keypadGroup);

  // Gate 2 (back-wall shutter at the keypad wall, opens when puzzle 2 solved)
  const gate2 = new THREE.Group();
  const gate2Frame = box(0.1, 3, AISLE_WIDTH, COLORS.shelfMetal, { metalness: 0.5 });
  gate2Frame.position.set(-ROOM_HALF + 0.3, 1.5, -27.9);
  gate2.add(gate2Frame);
  const gate2Slats = [];
  for (let i = 0; i < 8; i++) {
    const slat = box(AISLE_WIDTH, 0.18, 0.06, 0x2a2520, { metalness: 0.6 });
    slat.position.set(-ROOM_HALF + 0.3, 0.4 + i * 0.32, -27.9);
    gate2.add(slat);
    gate2Slats.push(slat);
  }
  world.add(gate2);

  // Lighting for Zone 2
  const fluorC = new THREE.PointLight(0xfff4d8, 0.6, 14, 2);
  fluorC.position.set(0, 4.5, -21);
  fluorC.castShadow = true;
  fluorC.shadow.mapSize.set(512, 512);
  fluorC.shadow.camera.near = 0.5;
  fluorC.shadow.camera.far = 16;
  world.add(fluorC);

  // Update display text on keypad
  function updateKeypadDisplay() {
    // Use texture regeneration
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 64;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#0a0a08";
    ctx.fillRect(0, 0, 256, 64);
    let text = "---";
    let color = "#2ee0ff";
    if (state.keypad.state === "wrong") {
      text = "ERR";
      color = "#ff2e88";
    } else if (state.keypad.state === "correct") {
      text = "OK!";
      color = "#6bff7d";
    } else if (state.keypad.state === "digit-entry" || state.keypad.state === "idle") {
      const padded = (state.keypad.buffer + "---").slice(0, 3);
      text = padded;
    }
    ctx.fillStyle = color;
    ctx.font = "bold 48px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(cv);
    keypadDisplay.material.map = tex;
    keypadDisplay.material.color.setHex(0xffffff);
    keypadDisplay.material.needsUpdate = true;
  }
  // expose for the click handler below
  window.__updateKeypadDisplay = updateKeypadDisplay;

  // Camera positions for the two fixed angles
  // Zone 1: (7, 7.2, 9) -> (0, 1, 0) [current]
  // Zone 2: (8, 7.0, -10) -> (0, 1, -22)
  state.zone1Camera = { pos: new THREE.Vector3(7, 7.2, 9),  look: new THREE.Vector3(0, 1, 0) };
  state.zone2Camera = { pos: new THREE.Vector3(8, 7.0, -10), look: new THREE.Vector3(0, 1, -22) };

  // ----- WebAudio: procedural sound layer -----
  const audio = (() => {
    let ctx = null;
    let masterGain, bedGain, muzakGain;
    let bedOsc1, bedOsc2, bedLfo, muzakOsc, muzakLfo;
    let started = false;

    function init() {
      if (started) return;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = ctx.createGain();
        masterGain.gain.value = 0.45;
        masterGain.connect(ctx.destination);
        bedGain = ctx.createGain();
        bedGain.gain.value = 0.18;
        bedGain.connect(masterGain);
        muzakGain = ctx.createGain();
        muzakGain.gain.value = 0.05;
        muzakGain.connect(masterGain);
        // fluorescent hum: two detuned 60Hz saws + slight LFO
        bedOsc1 = ctx.createOscillator();
        bedOsc1.type = "sawtooth";
        bedOsc1.frequency.value = 60;
        bedOsc2 = ctx.createOscillator();
        bedOsc2.type = "sawtooth";
        bedOsc2.frequency.value = 60.6;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 220;
        bedOsc1.connect(lp); bedOsc2.connect(lp);
        lp.connect(bedGain);
        bedOsc1.start(); bedOsc2.start();
        bedLfo = ctx.createOscillator();
        bedLfo.frequency.value = 0.13;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.05;
        bedLfo.connect(lfoGain);
        lfoGain.connect(bedGain.gain);
        bedLfo.start();
        // distant muzak: a soft 220Hz sine + 330Hz fifth, slow LFO for that "wrong key" feel
        muzakOsc = ctx.createOscillator();
        muzakOsc.type = "sine";
        muzakOsc.frequency.value = 220;
        const muzakOsc2 = ctx.createOscillator();
        muzakOsc2.type = "sine";
        muzakOsc2.frequency.value = 329.6; // E4
        const muzakFilter = ctx.createBiquadFilter();
        muzakFilter.type = "lowpass";
        muzakFilter.frequency.value = 800;
        muzakOsc.connect(muzakFilter);
        muzakOsc2.connect(muzakFilter);
        muzakFilter.connect(muzakGain);
        muzakOsc.start();
        muzakOsc2.start();
        muzakLfo = ctx.createOscillator();
        muzakLfo.frequency.value = 0.04;
        const muzakLfoGain = ctx.createGain();
        muzakLfoGain.gain.value = 30;
        muzakLfo.connect(muzakLfoGain);
        muzakLfoGain.connect(muzakOsc.frequency);
        muzakLfo.start();
        started = true;
      } catch (e) {
        console.warn("Audio init failed", e);
      }
    }

    function blip(freq, dur, type, vol) {
      if (!ctx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type || "square";
      o.frequency.value = freq;
      g.gain.value = 0;
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(vol || 0.15, ctx.currentTime + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (dur || 0.15));
      o.connect(g);
      g.connect(masterGain);
      o.start();
      o.stop(ctx.currentTime + (dur || 0.15) + 0.02);
    }

    return {
      init,
      resume() { if (ctx && ctx.state === "suspended") ctx.resume(); },
      setFlicker(intensity) {
        if (!bedGain) return;
        bedGain.gain.setTargetAtTime(0.18 + (intensity - 0.5) * 0.2, ctx.currentTime, 0.05);
      },
      scannerPing() { blip(1800, 0.08, "square", 0.12); setTimeout(() => blip(2200, 0.06, "sine", 0.06), 60); },
      pickup() { blip(420, 0.05, "triangle", 0.1); },
      placeCorrect() { blip(880, 0.06, "sine", 0.1); setTimeout(() => blip(1320, 0.08, "sine", 0.08), 70); },
      placeWrong() { blip(180, 0.18, "sawtooth", 0.12); },
      complete() {
        blip(660, 0.1, "sine", 0.14);
        setTimeout(() => blip(880, 0.1, "sine", 0.14), 90);
        setTimeout(() => blip(1320, 0.18, "sine", 0.14), 180);
        setTimeout(() => blip(1760, 0.25, "sine", 0.14), 360);
      },
      gateHydraulic() {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(120, ctx.currentTime);
        o.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 1.2);
        g.gain.setValueAtTime(0, ctx.currentTime);
        g.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.4);
        o.connect(g);
        g.connect(masterGain);
        o.start();
        o.stop(ctx.currentTime + 1.5);
      },
      paChime() { blip(523, 0.18, "sine", 0.1); },
    };
  })();

  // ----- Input -----
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "w" || k === "arrowup") keys.w = true;
    if (k === "a" || k === "arrowleft") keys.a = true;
    if (k === "s" || k === "arrowdown") keys.s = true;
    if (k === "d" || k === "arrowright") keys.d = true;
    if (k === "escape") {
      if (state.mode === "playing") pauseGame();
      else if (state.mode === "paused") resumeGame();
    }
    if (k === "r" && state.mode !== "title") restart();
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (k === "w" || k === "arrowup") keys.w = false;
    if (k === "a" || k === "arrowleft") keys.a = false;
    if (k === "s" || k === "arrowdown") keys.s = false;
    if (k === "d" || k === "arrowright") keys.d = false;
  });
  // Mouse / touch input
  function getStagePos(e) {
    const r = renderer.domElement.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    return { x: cx, y: cy };
  }
  function raycastFromScreen(cx, cy) {
    const ndc = new THREE.Vector2(
      (cx / window.innerWidth) * 2 - 1,
      -(cy / window.innerHeight) * 2 + 1
    );
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, camera);
    return rc;
  }
  renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
  renderer.domElement.addEventListener("mousedown", (e) => {
    if (state.mode !== "playing") return;
    if (e.button === 2) {
      state.scannerArmed = true;
      state.scanMode = true;
      enterScanMode();
      // Right-click on a hidden price object reveals its price
      if (state.currentZone === 2) {
        const p = getStagePos(e);
        const rc = raycastFromScreen(p.x, p.y);
        for (const obj of state.hiddenPriceObjects) {
          const hits = rc.intersectObject(obj, true);
          if (hits.length > 0 && !obj.userData.revealed) {
            obj.userData.revealed = true;
            if (obj.userData.priceTag) obj.userData.priceTag.visible = true;
            audio.scannerPing();
            toast("MANAGER SPECIAL: $" + obj.userData.digit + ".99", false);
            checkPuzzleProgress();
            break;
          }
        }
      }
    }
    if (e.button === 0) handleLeftClick(getStagePos(e));
  });
  renderer.domElement.addEventListener("mouseup", (e) => {
    if (e.button === 2) { state.scannerArmed = false; state.scanMode = false; exitScanMode(); }
  });
  renderer.domElement.addEventListener("mousemove", (e) => {
    if (!state.scanMode) return;
    const p = getStagePos(e);
    scanCursor.style.left = p.x + "px";
    scanCursor.style.top = p.y + "px";
  });

  // touch: single-tap = left click, two-finger hold = scan
  let touchScanTimer = null;
  renderer.domElement.addEventListener("touchstart", (e) => {
    if (state.mode !== "playing") return;
    if (e.touches.length === 2) {
      state.scanMode = true;
      enterScanMode();
      scanCursor.style.left = e.touches[0].clientX + "px";
      scanCursor.style.top = e.touches[0].clientY + "px";
    } else if (e.touches.length === 1 && !state.scanMode) {
      handleLeftClick(getStagePos(e));
    }
  });
  renderer.domElement.addEventListener("touchend", (e) => {
    if (e.touches.length < 2) {
      state.scanMode = false;
      exitScanMode();
    }
  });

  function handleLeftClick(p) {
    if (state.mode !== "playing") return;
    if (!scannerPickedUp) {
      // check if clicking the scanner
      const rc = raycastFromScreen(p.x, p.y);
      const hits = rc.intersectObject(scanner, true);
      if (hits.length > 0) {
        pickUpScanner();
        return;
      }
      // else check if clicking "exit" front wall (no-op for MVP)
      return;
    }
    // Zone 2: keypad interaction takes priority
    if (state.currentZone === 2 && state.keypad.state !== "correct") {
      const rc = raycastFromScreen(p.x, p.y);
      for (const btn of keypadButtons) {
        if (btn.userData.digit === undefined) continue;
        const hits = rc.intersectObject(btn, true);
        if (hits.length > 0) {
          handleKeypadPress(btn.userData.digit);
          return;
        }
      }
    }
    if (state.pickup) {
      // try to place into a slot
      const rc = raycastFromScreen(p.x, p.y);
      // collect all shelf-bottle meshes (just check intersections with our bottle groups)
      const targets = bottles.filter(b => b.userData.kind === "shelf");
      for (const target of targets) {
        const hits = rc.intersectObject(target, true);
        if (hits.length > 0) {
          placeIntoSlot(target.userData.slot);
          return;
        }
      }
      // also check empty slot positions: raycast against an invisible plane
      // For MVP, you can also click an empty space to drop on the floor
      tryDropOnFloor(p);
    } else {
      // try to pick up a floor bottle
      const rc = raycastFromScreen(p.x, p.y);
      const floorBottles = bottles.filter(b => b.userData.kind === "floor");
      for (const b of floorBottles) {
        const hits = rc.intersectObject(b, true);
        if (hits.length > 0) {
          pickUpBottle(b);
          return;
        }
      }
    }
  }

  function handleKeypadPress(digit) {
    if (state.keypad.state === "wrong" || state.keypad.state === "correct") return;
    if (digit === -1) { // clear
      state.keypad.buffer = "";
      state.keypad.state = "idle";
      audio.pickup();
    } else if (digit === -2) { // enter
      if (state.keypad.buffer.length === 3) checkPuzzleProgress();
      return;
    } else { // digit
      if (state.keypad.buffer.length >= 3) return;
      state.keypad.buffer += "" + digit;
      state.keypad.state = "digit-entry";
      audio.placeCorrect();
    }
    updateKeypadDisplay();
    checkPuzzleProgress();
  }

  function enterScanMode() {
    scanOverlay.classList.add("on");
    scanCursor.classList.add("on");
    priceTagGroup.visible = true;
    for (const b of bottles) if (b.userData.priceTag) b.userData.priceTag.visible = true;
    // In zone 2, also show hidden price tags (in scan mode)
    if (state.currentZone === 2) {
      for (const obj of state.hiddenPriceObjects) {
        if (obj.userData.priceTag) obj.userData.priceTag.visible = true;
      }
    }
    if (scannerPickedUp) audio.scannerPing();
  }
  function exitScanMode() {
    scanOverlay.classList.remove("on");
    scanCursor.classList.remove("on");
    priceTagGroup.visible = false;
    for (const b of bottles) if (b.userData.priceTag) b.userData.priceTag.visible = false;
    for (const obj of state.hiddenPriceObjects) {
      if (obj.userData.priceTag) obj.userData.priceTag.visible = false;
    }
  }

  function pickUpScanner() {
    scannerPickedUp = true;
    scanner.visible = false;
    hudScanner.textContent = "EQUIPPED";
    toast("SCANNER EQUIPPED — right-click to ping", false);
    audio.pickup();
    audio.paChime();
  }

  function pickUpBottle(b) {
    if (state.pickup) return;
    state.pickup = b;
    // visually raise it
    b.userData.origY = b.position.y;
    b.position.y = 1.0;
    b.userData.kind = "picked";
    audio.pickup();
  }

  function placeIntoSlot(slotIdx) {
    if (!state.pickup) return;
    const held = state.pickup;
    const target = bottles.find(b => b.userData.kind === "shelf" && b.userData.slot === slotIdx);
    if (!target) return;
    // if the target slot already has a bottle, kick that one to the floor
    const occupied = target.userData.colorIdx;
    // swap held into target slot
    const heldColor = held.userData.colorIdx;
    const targetColor = target.userData.colorIdx;
    target.userData.colorIdx = heldColor;
    updateBottleVisual(target, heldColor);
    // if occupied, move the previous bottle to floor at the held's old position
    if (held.userData.kind === "floor") {
      // came from floor, just despawn it from floor list (we'll move to held's old spot)
      held.userData.colorIdx = targetColor;
      held.position.x = held.userData.origX;
      held.position.z = held.userData.origZ;
      held.position.y = 0.28;
      held.userData.kind = "floor";
      held.userData.slot = -1;
    } else if (held.userData.kind === "shelf") {
      // swap visuals, mark as still on shelf but at new slot
      held.userData.slot = target.userData.slot;
      // also need to mark target as having the new color (already done above)
    }
    state.pickup = null;
    // check if this slot now matches the planogram
    checkPuzzleProgress();
    audio.placeCorrect();
  }

  function tryDropOnFloor(p) {
    if (!state.pickup) return;
    const held = state.pickup;
    // find a vacant floor slot nearby
    const vacant = bottles.find(b => b.userData.kind === "floor" && b !== held);
    if (vacant) {
      // swap: move held into vacant's spot, move vacant to held's old spot
      const hx = held.position.x, hz = held.position.z;
      const vx = vacant.position.x, vz = vacant.position.z;
      vacant.position.x = hx; vacant.position.z = hz;
      held.position.x = vx; held.position.z = vz;
      held.position.y = 0.28;
      held.userData.kind = "floor";
      held.userData.slot = -1;
      held.userData.origX = vx; held.userData.origZ = vz;
      state.pickup = null;
      audio.placeWrong();
      toast("BOTTLE RETURNED", true);
    } else {
      // just drop in place
      held.position.y = 0.28;
      held.userData.kind = "floor";
      held.userData.slot = -1;
      state.pickup = null;
      audio.placeWrong();
    }
  }

  function updateBottleVisual(b, colorIdx) {
    b.userData.colorIdx = colorIdx;
    // update child body color
    const body = b.children[0]; // body
    if (body && body.material) body.material.color.setHex(COLORS.bottle[colorIdx]);
    // update price tag
    if (b.userData.priceTag && b.userData.priceTag.material && b.userData.priceTag.material.map) {
      // regenerate tag
      const tag = makePriceTag(colorIdx);
      tag.position.copy(b.userData.priceTag.position);
      b.remove(b.userData.priceTag);
      b.add(tag);
      b.userData.priceTag = tag;
    }
  }

  function checkPuzzleProgress() {
    // Planogram puzzle (Puzzle 1)
    let correct = 0;
    for (const b of bottles) {
      if (b.userData.kind === "shelf" && b.userData.colorIdx === PUZZLE_TARGET.planogram[b.userData.slot]) {
        correct++;
      }
    }
    state.puzzleCorrect = correct;
    if (state.currentZone === 1) {
      hudPuzzle.textContent = correct + " / 3";
      if (correct === 3) completePuzzle1();
    } else if (state.currentZone === 2) {
      // Barcode puzzle: count revealed prices + keypad progress
      const revealed = state.hiddenPriceObjects.filter(o => o.userData.revealed).length;
      hudPuzzle.textContent = state.keypad.buffer.length + " / 3";
      if (state.keypad.buffer.length === 3) {
        if (state.keypad.buffer === PUZZLE_TARGET.barcode.join("")) {
          completePuzzle2();
        } else if (state.keypad.state === "digit-entry") {
          // wrong attempt
          state.keypad.state = "wrong";
          state.keypad.lastWrongAt = performance.now();
          audio.placeWrong();
          updateKeypadDisplay();
          // clear buffer after 1.2s
          setTimeout(() => {
            if (state.keypad.state === "wrong") {
              state.keypad.buffer = "";
              state.keypad.state = "digit-entry";
              updateKeypadDisplay();
            }
          }, 1200);
        }
      }
    }
  }

  function completePuzzle1() {
    if (gateOpen) return;
    gateOpen = true;
    gateOpenT = 0;
    audio.complete();
    toast("PLANOGRAM COMPLETE — GATE OPENING", false);
  }

  function completePuzzle2() {
    if (state.puzzle2Done) return;
    state.puzzle2Done = true;
    state.keypad.state = "correct";
    updateKeypadDisplay();
    audio.complete();
    audio.gateHydraulic();
    toast("CODE ACCEPTED — GATE 2 OPENING", false);
    // animate gate 2
    state.gate2OpenT = 0;
  }

  // ----- Game loop -----
  let lastT = performance.now();
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    if (state.mode === "playing") {
      update(dt, now);
    }
    render(now);
  }

  function update(dt, now) {
    // movement (camera-relative, tank-style)
    const camForward = new THREE.Vector3();
    camera.getWorldDirection(camForward);
    camForward.y = 0; camForward.normalize();
    const camRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3();
    if (keys.w) move.add(camForward);
    if (keys.s) move.sub(camForward);
    if (keys.d) move.add(camRight);
    if (keys.a) move.sub(camRight);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(MOVE_SPEED * dt);
      player.position.add(move);
      // clamp to room
      player.position.x = Math.max(-ROOM_HALF + 0.3, Math.min(ROOM_HALF - 0.3, player.position.x));
      player.position.z = Math.max(-ROOM_HALF - AISLE_LENGTH + 0.3, Math.min(ROOM_HALF - 0.3, player.position.z));
      // turn player to face movement direction
      if (move.lengthSq() > 0.0001) {
        const targetAngle = Math.atan2(move.x, move.z);
        player.rotation.y = targetAngle;
      }
    }

    // flicker the lights
    flicker.tA += dt;
    flicker.tB += dt;
    const flickerA = flicker.baseA + Math.sin(flicker.tA * 7.3) * 0.04 + (Math.random() < 0.005 ? -0.4 : 0);
    const flickerB = flicker.baseB + Math.sin(flicker.tB * 5.1 + 1.3) * 0.05;
    fluorA.intensity = Math.max(0.2, flickerA);
    fluorB.intensity = Math.max(0.15, flickerB);
    audio.setFlicker(fluorA.intensity / 0.8);

    // gate opening
    if (gateOpen) {
      gateOpenT = Math.min(1, gateOpenT + dt / 1.5);
      for (let i = 0; i < gateSlats.length; i++) {
        gateSlats[i].position.y = 0.4 + i * 0.32 + gateOpenT * 3.2;
        if (gateOpenT >= 1 && i === 0) audio.gateHydraulic();
      }
    }

    // banner time
    state.bannerSec += dt;
    if (state.bannerSec >= 1) {
      state.bannerSec = 0;
      const elapsed = Math.floor((now - state.shiftStart) / 1000);
      // We start at 22:47 and tick forward; mod 24h
      const totalMinutes = 22 * 60 + 47 + Math.floor(elapsed / 60);
      const h = Math.floor(totalMinutes / 60) % 24;
      const m = totalMinutes % 60;
      const mDisp = m < 10 ? "0" + m : m;
      bannerTime.textContent = h + ":" + mDisp;
    }

    // Zone 1 -> Zone 2 transition: walk through open gate into Home Goods
    if (state.currentZone === 1 && gateOpen && gateOpenT >= 1 && player.position.z < -AISLE_LENGTH + 0.3) {
      state.currentZone = 2;
      hudZone.textContent = "HOME GOODS";
      hudCam.textContent = "B1";
      // Camera cut (snap, then animate)
      state.cameraCutFrom.pos = camera.position.clone();
      state.cameraCutFrom.look = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      state.cameraCutTo.pos = state.zone2Camera.pos.clone();
      state.cameraCutTo.look = state.zone2Camera.look.clone();
      state.cameraCutT = 0;
      // Init keypad display
      updateKeypadDisplay();
      audio.paChime();
      showPrompt("Scan Manager Specials. Enter the security code.", 4500);
    }

    // Smooth camera cut animation
    if (state.cameraCutT < 1) {
      state.cameraCutT = Math.min(1, state.cameraCutT + dt / 0.6);
      const t = state.cameraCutT;
      // ease-in-out
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      if (state.cameraCutFrom.pos) {
        const np = state.cameraCutFrom.pos.clone().lerp(state.cameraCutTo.pos, eased);
        camera.position.copy(np);
        camera.lookAt(state.cameraCutTo.look);
        // preserve the dutch tilt
        camera.rotation.z = THREE.MathUtils.degToRad(-1.5);
      }
    }

    // Zone 2 -> end: walk through gate 2
    if (state.currentZone === 2 && state.puzzle2Done && player.position.z < -27) {
      endShift();
    }
  }

  function render(now) {
    renderer.render(scene, camera);
  }

  // ----- Game lifecycle -----
  function startShift() {
    audio.init();
    audio.resume();
    state.mode = "playing";
    state.shiftStart = performance.now();
    state.bannerSec = 0;
    scrTitle.classList.add("scr--hide");
    scrPause.classList.add("scr--hide");
    scrEnd.classList.add("scr--hide");
    document.body.classList.add("playing");
    showPrompt("Find the Price Scanner. Right-click to scan bottles.", 4500);
  }
  function pauseGame() {
    state.mode = "paused";
    scrPause.classList.remove("scr--hide");
    document.body.classList.remove("playing");
  }
  function resumeGame() {
    state.mode = "playing";
    scrPause.classList.add("scr--hide");
    document.body.classList.add("playing");
  }
  function endShift() {
    state.mode = "end";
    document.body.classList.remove("playing");
    document.getElementById("end-line").textContent = "SHIFT LOGGED.";
    document.getElementById("end-sub").textContent = "See you tomorrow. (Your name tag is already filled in.)";
    scrEnd.classList.remove("scr--hide");
  }
  function restart() {
    location.reload();
  }
  function showPrompt(text, ms) {
    promptEl.innerHTML = text;
    promptEl.classList.add("on");
    clearTimeout(showPrompt._t);
    showPrompt._t = setTimeout(() => promptEl.classList.remove("on"), ms || 3000);
  }
  function toast(text, bad) {
    toastEl.textContent = text;
    toastEl.classList.toggle("bad", !!bad);
    toastEl.classList.add("on");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove("on"), 2200);
  }

  // ----- Wire buttons -----
  document.getElementById("btn-start").addEventListener("click", startShift);
  document.getElementById("btn-resume").addEventListener("click", resumeGame);
  document.getElementById("btn-restart").addEventListener("click", restart);
  document.getElementById("btn-again").addEventListener("click", restart);
  document.getElementById("btn-retry").addEventListener("click", restart);

  // ----- Resize -----
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ----- Initialize banner + first render -----
  bannerTime.textContent = "22:47";
  hudPuzzle.textContent = "0 / 3";
  state.puzzleCorrect = 0;
  // initial puzzle check (in case anything is pre-correct, which it isn't in MVP)
  checkPuzzleProgress();
  // seed an initial PA chime
  setTimeout(() => audio.paChime(), 800);
  // start the loop
  requestAnimationFrame(tick);
})();
