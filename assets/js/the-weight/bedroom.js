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

TW.BedroomScene = class BedroomScene {
  constructor(cfg) {
    this.cfg = cfg;
    this.room = cfg.room;
    this._t = 0;
    this._colonOn = true;
    this._colonTimer = 0;

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
    this._moonFlicker = 1;
    this._flickerUntil = 0;

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
    const hemi = new THREE.HemisphereLight(0x222d44, 0x04050a, 0.42);
    this.scene.add(hemi);

    // moonlight shaft through the left window — the key light, casts shadows
    const moon = new THREE.SpotLight(0x8298dd, 3.9, 16, 0.54, 0.6, 1.05);
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
    const pillow = this._box(0.7, 0.13, 0.42, sheet, 0.02, 0.62, cz + bedL / 2 - 0.36);
    pillow.rotation.x = -0.06;

    // ---- the player's own body under the blanket (lower FOV immersion) ----
    const blanket = new THREE.Group();

    // torso ridge running from chest toward the feet (kept off the lens
    // and low-profile so it reads as a body, not a wall)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.20, 1.05), blanketMat);
    torso.position.set(0.02, 0.585, cz - 0.12);
    torso.castShadow = true; torso.receiveShadow = true;
    blanket.add(torso);

    // feet bump near the foot of the bed
    const feet = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), blanketMat);
    feet.scale.set(1.2, 0.58, 0.85);
    feet.position.set(0.02, 0.55, cz - 0.9);
    feet.castShadow = true; feet.receiveShadow = true;
    blanket.add(feet);

    // blanket draped flat over the rest of the mattress
    const drape = new THREE.Mesh(new THREE.BoxGeometry(bedW - 0.06, 0.05, 1.4), blanketMat);
    drape.position.set(0, 0.55, cz - 0.5);
    drape.receiveShadow = true;
    blanket.add(drape);

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
    this._box(0.04, wH + 0.5, 0.18, curtain, wx + 0.06, wy + 0.1, wz - wW / 2 - 0.18);
    this._box(0.04, wH + 0.5, 0.18, curtain, wx + 0.06, wy + 0.1, wz + wW / 2 + 0.18);
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
    // a slumped pile of clothes — vaguely person-shaped in the dark
    const pile = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), this._mat(0x0b0a0c, 1.0));
    pile.scale.set(0.8, 1.25, 0.7);
    pile.position.set(0, 0.78, -0.05); pile.castShadow = true;
    chair.add(pile);
    chair.position.set(-w / 2 + 0.5, 0, -d / 2 + 0.55);
    chair.rotation.y = 0.5;
    this.scene.add(chair);

    // framed picture on the right wall
    this._box(0.02, 0.5, 0.38, this._mat(0x080a0e, 0.5), w / 2 - 0.02, 1.6, 0.4);
  }

  // ------------------------------------------------------------------
  // The entity. Outer group carries world position + yaw (it always faces
  // the player); an inner group tilts forward when it leans over the bed.
  _buildEntity() {
    const outer = new THREE.Group();
    const inner = new THREE.Group();
    outer.add(inner);

    const skin = new THREE.MeshStandardMaterial({ color: 0x050609, roughness: 1, metalness: 0 });

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.12, 0.98, 10), skin);
    torso.position.y = 1.16;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 8), skin);
    neck.position.y = 1.62;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 14), skin);
    head.position.y = 1.74; head.scale.set(0.9, 1.12, 0.92);

    const armGeo = new THREE.CylinderGeometry(0.045, 0.03, 1.0, 8);
    const armL = new THREE.Mesh(armGeo, skin); armL.position.set(-0.22, 1.16, 0.02); armL.rotation.z = 0.13;
    const armR = new THREE.Mesh(armGeo, skin); armR.position.set(0.22, 1.16, 0.02); armR.rotation.z = -0.13;
    const legGeo = new THREE.CylinderGeometry(0.06, 0.045, 0.9, 8);
    const legL = new THREE.Mesh(legGeo, skin); legL.position.set(-0.09, 0.45, 0);
    const legR = new THREE.Mesh(legGeo, skin); legR.position.set(0.09, 0.45, 0);

    // glowing eyes — always readable, even in the dark
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2418, fog: false });
    const eyeGeo = new THREE.SphereGeometry(0.024, 8, 8);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.052, 1.76, 0.12);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.052, 1.76, 0.12);
    const eyeGlow = new THREE.PointLight(0xff1810, 0, 1.5, 2);
    eyeGlow.position.set(0, 1.74, 0.2);

    inner.add(torso, neck, head, armL, armR, legL, legR, eyeL, eyeR, eyeGlow);
    inner.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    outer.visible = false;
    this.scene.add(outer);
    this.entity = outer;
    this._entityInner = inner;
    this._eyeGlow = eyeGlow;

    this._eStart = new THREE.Vector3(-0.55, 0, -1.75);
    this._eSide = new THREE.Vector3(0.86, 0, 0.72);
    this._eOver = new THREE.Vector3(0.42, 0.18, 1.62);
  }

  /** progress 0 (far, by the door) .. 1 (looming over the bed) */
  setEntityProgress(p) {
    const e = this.entity; if (!e) return;
    e.visible = p > 0.001;
    if (!e.visible) return;

    let pos, lean = 0, scale = 1;
    if (p < 0.66) {
      pos = this._eStart.clone().lerp(this._eSide, p / 0.66);
    } else {
      const k = (p - 0.66) / 0.34;
      pos = this._eSide.clone().lerp(this._eOver, k);
      lean = k * 0.45;          // tilt forward over the player
      scale = 1 + k * 0.12;
    }
    e.position.copy(pos);
    e.scale.setScalar(scale);
    e.rotation.y = Math.atan2(this.camera.position.x - pos.x, this.camera.position.z - pos.z);
    this._entityInner.rotation.x = lean;
    if (this._eyeGlow) this._eyeGlow.intensity = 0.15 + p * 0.55;
  }

  /** the jumpscare rush into the camera, k 0..1 */
  lunge(k) {
    const e = this.entity; if (!e) return;
    e.visible = true;
    const to = this._lungeTo || (this._lungeTo = new THREE.Vector3());
    to.set(this.camera.position.x, this.camera.position.y - 0.04, this.camera.position.z - 0.34);
    e.position.copy(this._eOver).lerp(to, k);
    e.scale.setScalar(1.12 + k * 0.7);
    e.rotation.y = Math.atan2(this.camera.position.x - e.position.x, this.camera.position.z - e.position.z);
    this._entityInner.rotation.x = 0.45 + k * 0.2;
    if (this._eyeGlow) this._eyeGlow.intensity = 0.7 + k * 1.6;
  }

  getEntityPosition() { return this.entity ? this.entity.position.clone() : null; }

  /** flicker the moonlight for `dur` seconds */
  flicker(dur = 0.5) { this._flickerUntil = this._t + dur; }

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

  update(dt, breathPhase = 0.5) {
    this._t += dt;

    // blinking colon on the clock (once per second)
    this._colonTimer += dt;
    if (this._colonTimer >= 0.5) {
      this._colonTimer = 0;
      this._colonOn = !this._colonOn;
      this._clock.draw(this._colonOn);
    }

    // blanket rises and falls with the breath
    if (this.blanket) {
      this.blanket.position.y = this._blanketBaseY + (breathPhase - 0.5) * 0.018;
    }

    // moonlight breathes very faintly (passing clouds), or stutters mid-anomaly
    if (this.moon) {
      this._moonFlicker = this._t < this._flickerUntil
        ? 0.12 + Math.random() * 0.95
        : 1;
      this.moon.intensity = (3.9 + Math.sin(this._t * 0.7) * 0.2) * this._moonFlicker;
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

  function draw(colonOn) {
    ctx.clearRect(0, 0, 256, 96);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 96);
    ctx.font = 'bold 72px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#ff2a14';
    ctx.shadowBlur = 22;
    ctx.fillStyle = '#ff3320';
    const time = colonOn ? '3:47' : '3 47';
    ctx.fillText(time, 128, 50);
    texture.needsUpdate = true;
  }

  return { canvas, ctx, texture, draw };
}
})();
