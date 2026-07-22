// =============================================================
// bedroom.js — Phase 1 environment (the room you wake up in)
//
// A dark, quiet bedroom at 3:47 AM. Moonlight rakes in through a
// side window and casts real shadows; a digital clock bleeds red
// onto the nightstand; a door sits at the foot of the bed. Props
// are arranged so later phases can animate them (door creep, the
// chair that might not be a chair, the wardrobe that opens).
// =============================================================

(function () {
window.TW = window.TW || {};
const THREE = window.THREE;

// The shared entity model is defined by entity-shadow.js.

TW.BedroomScene = class BedroomScene {
  constructor(cfg) {
    this.cfg = cfg;
    this.room = cfg.room;
    this._t = 0;
    this._clockText = '3:47';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04050a);
    this.scene.fog = new THREE.FogExp2(0x05070c, 0.058);

    this.camera = new THREE.PerspectiveCamera(
      cfg.camera.fov, 1, cfg.camera.near, cfg.camera.far,
    );

    // hooks the controller / later phases reach for
    this.door = null;        // pivot group
    this.wardrobeDoor = null;
    this.blanket = null;
    this.moon = null;
    this.entity = null;
    this._moonLevel = 1;

    this._buildLighting();
    this._buildRoom();
    this._buildBed();
    this._buildNightstandAndClock();
    this._buildWindow();
    this._buildDoor();
    this._buildFurniture();
    this._buildEntity();
  }

  // ------------------------------------------------------------------
  _mat(color, rough = 0.95, metal = 0.0) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  }

  _box(w, h, d, mat, x, y, z, cast = true, receive = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = receive;
    this.scene.add(m);
    return m;
  }

  // ------------------------------------------------------------------
  _buildLighting() {
    // soft night fill so nothing is pure black, with a cool sky / dark floor
    const hemi = new THREE.HemisphereLight(0x28344e, 0x05060c, 0.62);
    this.scene.add(hemi);

    // cool fill washing the far wall, so the door / wardrobe / chair corners
    // (where the anomalies live) stay readable in the gloom
    const farFill = new THREE.PointLight(0x33405c, 0.55, 8, 2);
    farFill.position.set(0, 2.3, -2.2);
    this.scene.add(farFill);

    // moonlight shaft through the left window — the key light, casts shadows
    const moon = new THREE.SpotLight(0x8298dd, 4.3, 16, 0.6, 0.55, 1.05);
    moon.position.set(-5.0, 2.35, -0.5);
    moon.target.position.set(0.7, 0.25, 1.2);
    if (this.cfg.shadows) {
      moon.castShadow = true;
      moon.shadow.mapSize.set(2048, 2048);
      moon.shadow.camera.near = 0.5;
      moon.shadow.camera.far = 16;
      moon.shadow.bias = -0.0004;
      moon.shadow.radius = 3;
    }
    this.scene.add(moon);
    this.scene.add(moon.target);
    this.moon = moon;

    // faint red bleed from the clock
    const clockGlow = new THREE.PointLight(0xff2614, 1.0, 2.0, 2.1);
    clockGlow.position.set(this.room.w / 2 - 0.5, 0.7, 1.5);
    this.scene.add(clockGlow);
    this._clockGlow = clockGlow;

    // warm light leaking under the door from the hallway
    const hall = new THREE.PointLight(0x3a2c16, 0.5, 2.0, 2.0);
    hall.position.set(-0.7, 0.06, -this.room.d / 2 + 0.25);
    this.scene.add(hall);
    this._hallLight = hall;
  }

  _buildRoom() {
    const { w, h, d } = this.room;
    const wallMat = this._mat(0x232a36, 0.97);
    const floorMat = this._mat(0x241b12, 0.9);
    const ceilMat = this._mat(0x0a0c11, 1.0);

    // floor + ceiling
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = h;
    ceil.receiveShadow = true;
    this.scene.add(ceil);

    // four walls (inward facing planes)
    const mkWall = (pw, rotY, x, z) => {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(pw, h), wallMat);
      wall.rotation.y = rotY;
      wall.position.set(x, h / 2, z);
      wall.receiveShadow = true;
      this.scene.add(wall);
      return wall;
    };
    mkWall(w, 0, 0, -d / 2);            // far wall (foot of bed, holds the door)
    mkWall(w, Math.PI, 0, d / 2);       // near wall (behind the head)
    mkWall(d, Math.PI / 2, -w / 2, 0);  // left wall (holds the window)
    mkWall(d, -Math.PI / 2, w / 2, 0);  // right wall

    // skirting boards for a little real-room detail
    const skirt = this._mat(0x171b22, 0.9);
    this._box(w, 0.08, 0.02, skirt, 0, 0.04, -d / 2 + 0.011, false, true);
    this._box(0.02, 0.08, d, skirt, -w / 2 + 0.011, 0.04, 0, false, true);
    this._box(0.02, 0.08, d, skirt, w / 2 - 0.011, 0.04, 0, false, true);
  }

  _buildBed() {
    const frame = this._mat(0x140d08, 0.85);
    const sheet = this._mat(0x3a3d44, 0.95);
    const blanketMat = this._mat(0x2a2730, 0.98);
    blanketMat.side = THREE.DoubleSide;

    // bed sits centred-ish, head against the +z wall, foot toward the room
    const bedW = 1.5, bedL = 2.4, baseY = 0.30;
    const cz = 1.15; // bed centre z

    // base / divan
    this._box(bedW, 0.34, bedL, frame, 0, baseY / 2 + 0.04, cz);
    // mattress
    this._box(bedW - 0.08, 0.22, bedL - 0.06, sheet, 0, 0.5, cz);

    // headboard against the near wall
    this._box(bedW + 0.12, 0.7, 0.08, frame, 0, 0.62, cz + bedL / 2 - 0.02);

    // pillow under the player's head
    // Keep the pillow beneath/behind the viewpoint. Letting its pale front edge
    // sit ahead of the camera made the body appear abruptly sliced in half.
    const pillow = this._box(0.7, 0.13, 0.22, sheet, 0.02, 0.62, cz + bedL / 2 - 0.13);
    pillow.rotation.x = -0.06;

    // ---- the player's own body under the blanket (lower FOV immersion) ----
    const blanket = new THREE.Group();

    // One sculpted quilt surface replaces the old pile of intersecting body
    // primitives. Its chest, hip, knee and foot profiles blend continuously.
    // Continue the quilt beneath and slightly behind the camera so its head
    // edge can never enter the downward field of view. Anatomical profiles
    // still begin at the chest and retain their original proportions.
    const bodyHeadZ = cz + 0.28;
    const quiltHeadZ = Math.min(cz + bedL / 2 - 0.03, this.cfg.camera.pos.z + 0.22);
    const quiltFootZ = cz - 1.14;
    const quiltLength = quiltHeadZ - quiltFootZ;
    const nx = 24, nz = 48, verts = [], indices = [];
    for (let iz = 0; iz <= nz; iz++) {
      const v = iz / nz;
      const z = quiltHeadZ - v * quiltLength;
      const bodyV = Math.max(0, Math.min(1, (bodyHeadZ - z) / (bodyHeadZ - quiltFootZ)));
      const upperBlend = z > bodyHeadZ
        ? 0.45 + 0.55 * (quiltHeadZ - z) / (quiltHeadZ - bodyHeadZ)
        : 1;
      for (let ix = 0; ix <= nx; ix++) {
        const u = ix / nx;
        const x = -0.7 + u * 1.4;
        const across = (u - 0.5) * 2;
        const body = Math.exp(-Math.pow(across / 0.73, 4));
        const drape = Math.pow(Math.max(0, 1 - Math.abs(across)), 0.45);
        const chest = Math.exp(-Math.pow((bodyV - 0.08) / 0.22, 2)) * 0.14 * upperBlend;
        const hips = Math.exp(-Math.pow((bodyV - 0.42) / 0.27, 2)) * 0.095;
        const knees = Math.exp(-Math.pow((bodyV - 0.68) / 0.16, 2)) * 0.1;
        const feet = Math.exp(-Math.pow((bodyV - 0.94) / 0.1, 2)) * 0.065;
        const fold = Math.sin(u * Math.PI * 6 + bodyV * 2.5) * 0.006 * drape;
        verts.push(x, 0.55 + drape * 0.022 + body * (chest + hips + knees + feet) + fold, z);
      }
    }
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const a = iz * (nx + 1) + ix, b = a + 1, c = a + nx + 1, d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    const quiltGeo = new THREE.BufferGeometry();
    quiltGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    quiltGeo.setIndex(indices); quiltGeo.computeVertexNormals();
    const quilt = new THREE.Mesh(quiltGeo, blanketMat);
    quilt.castShadow = true; quilt.receiveShadow = true;
    blanket.add(quilt);
    this._quiltMesh = quilt;
    this._quiltBasePositions = new Float32Array(quiltGeo.attributes.position.array);
    this._bedDentVisible = false;

    // Close the sculpted top on every edge. Without this drape, looking down
    // from the pillow exposed the quilt's hollow, one-sided interior.
    const quiltCenterZ = (quiltHeadZ + quiltFootZ) * 0.5;
    const addQuiltDrape = (geometry, x, y, z) => {
      const drape = new THREE.Mesh(geometry, blanketMat);
      drape.position.set(x, y, z);
      drape.castShadow = true;
      drape.receiveShadow = true;
      blanket.add(drape);
    };
    const sideDrapeGeo = new THREE.BoxGeometry(0.035, 0.16, quiltLength);
    addQuiltDrape(sideDrapeGeo, -0.69, 0.48, quiltCenterZ);
    addQuiltDrape(sideDrapeGeo, 0.69, 0.48, quiltCenterZ);
    const endDrapeGeo = new THREE.BoxGeometry(1.4, 0.16, 0.035);
    addQuiltDrape(endDrapeGeo, 0, 0.48, quiltHeadZ - 0.01);
    addQuiltDrape(endDrapeGeo, 0, 0.48, quiltFootZ + 0.01);

    this.scene.add(blanket);
    this.blanket = blanket;
    this._blanketBaseY = blanket.position.y;
  }

  _buildNightstandAndClock() {
    const wood = this._mat(0x1a120b, 0.8);
    const x = this.room.w / 2 - 0.42;
    const z = 1.55;

    // nightstand body + top
    this._box(0.5, 0.5, 0.42, wood, x, 0.25, z);
    this._box(0.56, 0.04, 0.48, wood, x, 0.52, z);

    // ---- digital alarm clock (turned to face the sleeper) ----
    this._clock = makeClockTexture();
    const clock = new THREE.Group();
    clock.position.set(x - 0.05, 0.61, z - 0.02);
    const cbody = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.12), this._mat(0x0a0a0c, 0.6));
    cbody.castShadow = true;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.1),
      new THREE.MeshBasicMaterial({ map: this._clock.texture, transparent: true, fog: false }),
    );
    face.position.set(0, 0, 0.062);
    clock.add(cbody, face);
    const cp = this.cfg.camera.pos;
    clock.rotation.y = Math.atan2(cp.x - clock.position.x, cp.z - clock.position.z);
    this.scene.add(clock);
    this._clock.draw(true);
  }

  _buildWindow() {
    const { d, h } = this.room;
    const frameMat = this._mat(0x12161d, 0.8);
    const wx = -this.room.w / 2 + 0.015; // on the left wall
    const wz = -0.4, wW = 1.5, wH = 1.5, wy = 1.45;

    // moonlit glass pane (self-lit so it reads as a bright window)
    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(wW, wH),
      new THREE.MeshBasicMaterial({ color: 0x465d90, fog: false }),
    );
    pane.rotation.y = Math.PI / 2;
    pane.position.set(wx + 0.005, wy, wz);
    this.scene.add(pane);
    this._pane = pane;

    // frame + muntins — all lie flat in the wall's Y-Z plane (no rotation;
    // x is the shallow depth, y is height, z runs along the wall)
    const t = 0.05, fx = wx + 0.01;
    const addBar = (sy, sz, oy, oz) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, sy, sz), frameMat);
      bar.position.set(fx, wy + oy, wz + oz);
      bar.castShadow = true;
      this.scene.add(bar);
    };
    addBar(t, wW + 0.1, wH / 2, 0);     // top rail
    addBar(t, wW + 0.1, -wH / 2, 0);    // bottom rail
    addBar(wH + 0.1, t, 0, -wW / 2);    // left stile
    addBar(wH + 0.1, t, 0, wW / 2);     // right stile
    addBar(wH, t, 0, 0);                // central vertical muntin
    addBar(t, wW, 0, 0);                // central horizontal muntin

    // thin curtains framing the window
    const curtain = this._mat(0x14110f, 1.0);
    const curtainL = this._box(0.04, wH + 0.5, 0.18, curtain, wx + 0.06, wy + 0.1, wz - wW / 2 - 0.18);
    const curtainR = this._box(0.04, wH + 0.5, 0.18, curtain, wx + 0.06, wy + 0.1, wz + wW / 2 + 0.18);
    this._curtains = [curtainL, curtainR];
    this._curtainHome = this._curtains.map((c) => c.position.z);

    // A human-ish absence against the pane. It is deliberately featureless:
    // from the pillow the player sees a head and shoulders, never a model.
    const watcher = new THREE.Group();
    const watcherMat = this._mat(0x020306, 1.0);
    const watcherHead = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), watcherMat);
    watcherHead.scale.set(0.7, 1.16, 0.58);
    watcherHead.position.y = 0.31;
    const watcherNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.2, 7), watcherMat);
    watcherNeck.position.y = 0.08;
    const watcherBody = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.34, 0.72, 8), watcherMat);
    watcherBody.position.y = -0.31;
    watcher.add(watcherHead, watcherNeck, watcherBody);
    watcher.position.set(wx + 0.09, wy - 0.05, wz + 0.16);
    watcher.visible = false;
    this.scene.add(watcher);
    this._windowWatcher = watcher;
  }

  _buildDoor() {
    const { d } = this.room;
    const frameMat = this._mat(0x100b07, 0.8);
    const doorMat = this._mat(0x1c140d, 0.7);
    const dz = -d / 2 + 0.02;     // on the far wall
    const dx = -0.7;              // offset from centre
    const dW = 0.92, dH = 2.05;

    // door frame
    this._box(dW + 0.16, 0.08, 0.14, frameMat, dx, dH + 0.04, dz);   // lintel
    this._box(0.08, dH + 0.08, 0.14, frameMat, dx - dW / 2 - 0.04, dH / 2, dz);
    this._box(0.08, dH + 0.08, 0.14, frameMat, dx + dW / 2 + 0.04, dH / 2, dz);

    // hinged door: pivot at the left jamb so it can creep open later
    const pivot = new THREE.Group();
    pivot.position.set(dx - dW / 2, dH / 2, dz + 0.04);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(dW, dH, 0.05), doorMat);
    slab.position.set(dW / 2, 0, 0);
    slab.castShadow = true; slab.receiveShadow = true;
    pivot.add(slab);
    // small handle
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), this._mat(0x3a3127, 0.4, 0.6));
    handle.position.set(dW - 0.12, -0.02, 0.05);
    pivot.add(handle);
    this.scene.add(pivot);
    this.door = pivot;
    this.setDoor(0.06); // a sliver ajar to start

    // warm light bleeding under the door
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(dW, 0.04),
      new THREE.MeshBasicMaterial({ color: 0x5a4320, transparent: true, opacity: 0.5, fog: false }),
    );
    glow.position.set(dx, 0.02, dz + 0.05);
    glow.rotation.x = -Math.PI / 2.05;
    this.scene.add(glow);
    this._doorGlow = glow;

    // Four fingers can curl around the jamb before the entity itself is ever
    // revealed. They remain a flat, nearly black silhouette at bedroom range.
    const fingers = new THREE.Group();
    const fingerMat = this._mat(0x010203, 1.0);
    for (let i = 0; i < 4; i++) {
      const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.017, 0.3 - i * 0.025, 6), fingerMat);
      finger.rotation.z = Math.PI / 2;
      finger.position.set(-i * 0.018, i * 0.065, 0);
      fingers.add(finger);
    }
    fingers.position.set(dx + dW / 2 - 0.1, 1.17, dz + 0.09);
    fingers.visible = false;
    this.scene.add(fingers);
    this._doorFingers = fingers;
  }

  _buildFurniture() {
    const wood = this._mat(0x15100b, 0.85);
    const { w, d } = this.room;

    // wardrobe in the far-right corner (its door can open later)
    const wbX = w / 2 - 0.42, wbZ = -d / 2 + 0.5;
    this._box(0.9, 2.1, 0.6, wood, wbX, 1.05, wbZ);
    const wPivot = new THREE.Group();
    wPivot.position.set(wbX - 0.45, 1.05, wbZ + 0.31);
    const wDoor = new THREE.Mesh(new THREE.BoxGeometry(0.44, 2.0, 0.04), this._mat(0x1b140d, 0.7));
    wDoor.position.set(0.22, 0, 0);
    wDoor.castShadow = true;
    wPivot.add(wDoor);
    this.scene.add(wPivot);
    this.wardrobeDoor = wPivot;

    // dresser against the far wall
    this._box(1.1, 0.8, 0.45, wood, 0.75, 0.4, -d / 2 + 0.28);

    // the chair in the corner with clothes piled on it — is it a chair?
    const chair = new THREE.Group();
    const cm = this._mat(0x0e0b08, 0.95);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.42), cm);
    seat.position.y = 0.45; seat.castShadow = true;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.06), cm);
    back.position.set(0, 0.7, -0.18); back.castShadow = true;
    chair.add(seat, back);
    // Four grounded legs and low stretchers make the silhouette read as a
    // real wooden chair even when the clothes pile obscures the seat.
    const legGeo = new THREE.BoxGeometry(0.055, 0.42, 0.055);
    for (const x of [-0.16, 0.16]) {
      for (const z of [-0.16, 0.16]) {
        const leg = new THREE.Mesh(legGeo, cm);
        leg.position.set(x, 0.21, z);
        leg.castShadow = true;
        chair.add(leg);
      }
    }
    const sideStretcherGeo = new THREE.BoxGeometry(0.04, 0.04, 0.32);
    for (const x of [-0.16, 0.16]) {
      const rail = new THREE.Mesh(sideStretcherGeo, cm);
      rail.position.set(x, 0.22, 0);
      rail.castShadow = true;
      chair.add(rail);
    }
    const frontStretcher = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.04), cm);
    frontStretcher.position.set(0, 0.22, 0.16);
    frontStretcher.castShadow = true;
    chair.add(frontStretcher);
    // a slumped pile of clothes — vaguely person-shaped in the dark
    const pile = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), this._mat(0x0b0a0c, 1.0));
    pile.scale.set(0.8, 1.25, 0.7);
    pile.position.set(0, 0.78, -0.05); pile.castShadow = true;
    chair.add(pile);
    this._chairPile = pile;
    chair.position.set(-w / 2 + 0.5, 0, -d / 2 + 0.55);
    chair.rotation.y = 0.5;
    this.scene.add(chair);
    this._chair = chair;
    this._chairHomePos = chair.position.clone();
    this._chairHomeRot = chair.rotation.y;
    this._pileHomeScale = pile.scale.clone();
    this._pileHomePos = pile.position.clone();

    // a pair of pale eyes waiting inside the wardrobe (hidden until sprung)
    const wEyeMat = new THREE.MeshBasicMaterial({ color: 0xcfe8ff, fog: false });
    const wEyeGeo = new THREE.SphereGeometry(0.02, 8, 8);
    const wEyes = new THREE.Group();
    const weL = new THREE.Mesh(wEyeGeo, wEyeMat); weL.position.set(-0.05, 0, 0);
    const weR = new THREE.Mesh(wEyeGeo, wEyeMat); weR.position.set(0.05, 0, 0);
    wEyes.add(weL, weR);
    wEyes.position.set(wbX - 0.08, 1.52, wbZ + 0.36);
    wEyes.visible = false;
    this.scene.add(wEyes);
    this._wardrobeEyes = wEyes;

    // framed picture on the right wall
    this._picture = this._box(0.02, 0.5, 0.38, this._mat(0x080a0e, 0.5), w / 2 - 0.02, 1.6, 0.4);
  }

  // ------------------------------------------------------------------
  // The entity. Outer group carries world position + yaw (it always faces
  // the player); an inner group tilts forward when it leans over the bed.
  _buildEntity() {
    const outer = new THREE.Group();
    const built = TW.buildWraith();
    const inner = built.model;
    outer.add(inner);
    inner.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    built.eyeGlow.intensity = 0;   // fades in with setEntityProgress

    outer.visible = false;
    this.scene.add(outer);
    this.entity = outer;
    this._entityInner = inner;
    this._eyeGlow = built.eyeGlow;
    this._entityRig = built.rig;

    // Its first readable position mirrors the reference: centered beyond the
    // foot of the bed, so the silhouette is mistaken for part of the room.
    this._eStart = new THREE.Vector3(0.02, 0, -2.62);
    this._eSide = new THREE.Vector3(-1.42, 0, -1.18);
    // The final pose sinks into the floor and folds sharply at the hips. This
    // puts the face at pillow height without shoving the torso through the
    // near plane, and makes the approach feel like a predator bending over.
    this._eOver = new THREE.Vector3(0.18, -0.36, -1.05);
  }

  /** progress 0 (far, by the door) .. 1 (looming over the bed) */
  setEntityProgress(p) {
    this._entityP = p;
    const e = this.entity; if (!e) return;
    // Early progress is heard but not shown. When it finally resolves, it is
    // still against the darkest wall; the eyes remain dark until very late.
    e.visible = p > 0.16;
    if (!e.visible) return;

    let pos, lean = 0, scale = 1;
    if (p < 0.66) {
      pos = this._eStart.clone().lerp(this._eSide, p / 0.66);
    } else {
      const k = (p - 0.66) / 0.34;
      pos = this._eSide.clone().lerp(this._eOver, k);
      lean = k * 0.74;          // fold until the face reaches pillow height
      scale = 1 + k * 0.02;
    }
    e.position.copy(pos);
    e.scale.setScalar(scale);
    e.rotation.y = Math.atan2(this.camera.position.x - pos.x, this.camera.position.z - pos.z);
    this._entityInner.rotation.x = lean;
    if (this._eyeGlow) this._eyeGlow.intensity = p > 0.72 ? (p - 0.72) * 0.28 : 0;
  }

  /** the jumpscare rush into the camera, k 0..1 */
  lunge(k) {
    const e = this.entity; if (!e) return;
    e.visible = true;
    const to = this._lungeTo || (this._lungeTo = new THREE.Vector3());
    // Rotate the long upper body into the camera instead of translating its
    // feet into the camera. The face now drives the scare, not a clipped torso.
    to.set(this.camera.position.x, -0.46, this.camera.position.z - 2.77);
    e.position.copy(this._eOver).lerp(to, k);
    e.scale.setScalar(1.02 + k * 0.04);
    e.rotation.y = Math.atan2(this.camera.position.x - e.position.x, this.camera.position.z - e.position.z);
    this._entityInner.rotation.x = 0.74 + k * 0.08;
    if (this._eyeGlow) this._eyeGlow.intensity = 0.12 + k * 0.18;
  }

  getEntityPosition() { return this.entity ? this.entity.position.clone() : null; }

  /** Hold a wrong clock reading without flashing or rapidly changing it. */
  setClockTime(text = '3:47') {
    this._clockText = text;
    if (this._clock) this._clock.draw(true, text === '3:47' ? null : text);
    if (this._clockGlow) this._clockGlow.intensity = text.trim() ? 0.72 : 0.08;
  }

  tiltPicture(amount = 0.14) { if (this._picture) this._picture.rotation.x = amount; }

  drawCurtains(amount = 0.32) {
    if (!this._curtains) return;
    this._curtains[0].position.z = this._curtainHome[0] + amount;
    this._curtains[1].position.z = this._curtainHome[1] - amount;
  }

  slumpPile() {
    if (!this._chairPile) return;
    this._chairPile.scale.set(1.05, 0.5, 0.86);
    this._chairPile.position.y = 0.61;
  }

  showBedDent(on = true) {
    const quilt = this._quiltMesh;
    if (!quilt || !this._quiltBasePositions || this._bedDentVisible === on) return;
    this._bedDentVisible = on;
    const attr = quilt.geometry.attributes.position;
    const arr = attr.array, base = this._quiltBasePositions;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = base[i]; arr[i + 1] = base[i + 1]; arr[i + 2] = base[i + 2];
      if (!on) continue;
      const dx = (base[i] + 0.46) / 0.25;
      const dz = (base[i + 2] - 0.72) / 0.31;
      const r = Math.sqrt(dx * dx + dz * dz);
      const hollow = Math.exp(-r * r * 1.35) * -0.048;
      const gathered = Math.exp(-Math.pow(r - 1.05, 2) / 0.09) * 0.01;
      arr[i + 1] += hollow + gathered;
    }
    attr.needsUpdate = true;
    quilt.geometry.computeVertexNormals();
  }
  showWindowWatcher(on = true) { if (this._windowWatcher) this._windowWatcher.visible = on; }
  showDoorFingers(on = true) { if (this._doorFingers) this._doorFingers.visible = on; }

  /** a shadow crosses the hallway light under the door — someone walking past */
  shadowFeet(dur = 2.2) { this._feetDur = dur; this._feetUntil = this._t + dur; }

  /** the pile of clothes on the chair is no longer there */
  hidePile() { if (this._chairPile) this._chairPile.visible = false; }

  /** the chair has moved closer to the bed, and now faces it */
  moveChairCloser() {
    const c = this._chair; if (!c) return;
    c.position.x += 0.26;
    c.position.z += 0.52;
    const bed = new THREE.Vector3(0, 0, 1.15);
    c.rotation.y = Math.atan2(bed.x - c.position.x, bed.z - c.position.z);
  }

  /** the wardrobe hangs open and something inside is watching */
  showWardrobeEyes() {
    this.setWardrobe(0.85);
    if (this._wardrobeEyes) this._wardrobeEyes.visible = true;
  }

  /** the moonlight dies for `dur` seconds — near-total dark */
  moonOut(dur = 3.5) { this._moonOutUntil = this._t + dur; }

  /** Restore an almost-normal room between false awakenings. */
  resetForFalseWake(level = 1) {
    this.setEntityProgress(0);
    this.setDoor(0.06);
    this.setWardrobe(0);
    this.setClockTime('3:47');
    this.showBedDent(false);
    this.showWindowWatcher(false);
    this.showDoorFingers(false);
    if (this._wardrobeEyes) this._wardrobeEyes.visible = false;
    if (this._picture) this._picture.rotation.x = level === 1 ? 0.16 : 0;
    if (this._curtains) this._curtains.forEach((c, i) => { c.position.z = this._curtainHome[i]; });
    if (this._chair) {
      this._chair.position.copy(this._chairHomePos);
      this._chair.rotation.y = level === 2
        ? Math.atan2(-this._chair.position.x, 1.15 - this._chair.position.z)
        : this._chairHomeRot;
    }
    if (this._chairPile) {
      this._chairPile.visible = true;
      this._chairPile.scale.copy(this._pileHomeScale);
      this._chairPile.position.copy(this._pileHomePos);
      if (level === 2) {
        this._chairPile.scale.y *= 1.34;
        this._chairPile.position.y += 0.08;
      }
    }
  }

  // ------------------------------------------------------------------
  /** open amount 0 (shut) .. 1 (wide) for the bedroom door */
  setDoor(open) {
    if (this.door) this.door.rotation.y = -open * 1.4;
  }
  setWardrobe(open) {
    if (this.wardrobeDoor) this.wardrobeDoor.rotation.y = -open * 1.6;
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt, breathPhase = 0.5, entityMotion = false) {
    this._t += dt;

    // a shadow crossing the light that leaks under the door (two dips = feet)
    if (this._feetUntil && this._t < this._feetUntil) {
      const k = 1 - (this._feetUntil - this._t) / this._feetDur;
      const dip = (c) => Math.exp(-Math.pow((k - c) / 0.09, 2));
      const shade = 1 - 0.85 * Math.min(1, dip(0.32) + dip(0.62));
      if (this._doorGlow) this._doorGlow.material.opacity = 0.5 * shade;
      if (this._hallLight) this._hallLight.intensity = 0.5 * shade;
    } else if (this._feetUntil) {
      this._feetUntil = 0;
      if (this._doorGlow) this._doorGlow.material.opacity = 0.5;
      if (this._hallLight) this._hallLight.intensity = 0.5;
    }

    // blanket rises and falls with the breath
    if (this.blanket) {
      this.blanket.position.y = this._blanketBaseY + (breathPhase - 0.5) * 0.018;
    }

    // The paralysis entity is perfectly still whenever it can be seen. Its
    // pose changes only behind fully closed eyelids.
    if (entityMotion && this.entity && this.entity.visible) {
      TW.animateWraith(this._entityRig, this._t, this._entityP || 0);
    }

    // Moonlight changes slowly and continuously. No flicker or rapid brightness
    // modulation is used; darkness arrives like a cloud covering the window.
    if (this.moon) {
      const out = this._t < (this._moonOutUntil || 0);
      if (out !== this._moonWasOut) {
        this._moonWasOut = out;
        if (this._pane) this._pane.material.color.setHex(out ? 0x141c2c : 0x465d90);
      }
      const target = out ? 0.025 : 1;
      this._moonLevel += (target - this._moonLevel) * (1 - Math.exp(-dt * 1.15));
      this.moon.intensity = (4.3 + Math.sin(this._t * 0.35) * 0.12) * this._moonLevel;
    }
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
      }
    });
  }
};

// ----------------------------------------------------------------------
// Digital clock face rendered to a canvas → texture (red seven-seg "3:47")
// ----------------------------------------------------------------------
function makeClockTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;

  function draw(colonOn, glitch) {
    ctx.clearRect(0, 0, 256, 96);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 96);
    ctx.font = 'bold 72px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#ff2a14';
    ctx.shadowBlur = glitch ? 30 : 22;
    ctx.fillStyle = glitch ? '#ff4530' : '#ff3320';
    const time = glitch || (colonOn ? '3:47' : '3 47');
    const jx = glitch ? (Math.random() - 0.5) * 10 : 0;
    ctx.fillText(time, 128 + jx, 50);
    texture.needsUpdate = true;
  }

  return { canvas, ctx, texture, draw };
}
})();
