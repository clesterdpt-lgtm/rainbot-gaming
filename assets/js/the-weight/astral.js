// =============================================================
// astral.js — Phase 2 world (the out-of-body return)
//
// A spectral, drained version of the house. You start on the lawn
// looking at the dark silhouette of home, slip in through the front
// door, and pick your way back — foyer → middle room → bedroom — to
// the body asleep in the bed. Walls are real (AABB collision); the
// entity hunts you the whole way.
//
//   layout (top-down, +z = toward the player's spawn / lawn)
//     front door gap .. foyer .. door A (right) .. middle .. door B (left) .. bedroom(body)
// =============================================================

(function () {
window.TW = window.TW || {};
const THREE = window.THREE;

const H = 3.0;          // wall height
const TH = 0.3;         // wall thickness

TW.AstralScene = class AstralScene {
  constructor(cfg) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c1424);
    this.scene.fog = new THREE.FogExp2(0x0c1424, 0.04);

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 320);

    this.colliders = [];
    this._t = 0;

    // the long way home: forest (far) → neighbourhood → yard → house → body
    this.playerStart = new THREE.Vector3(0, 1.62, 100);
    this.entityStart = new THREE.Vector3(2, 0, 128);   // well back, behind the treeline
    this.bodyPosition = new THREE.Vector3(-3, 1.0, -14.5);
    this.entityPos = this.entityStart.clone();

    this._buildLighting();
    this._buildGround();
    this._buildShell();
    this._buildInteriorWalls();
    this._buildExterior();
    this._buildNeighborhood();
    this._buildForest();
    this._buildBody();
    this._buildEntity();
  }

  _mat(color, rough = 0.95, emissive = 0x000000, emInt = 0) {
    return new THREE.MeshStandardMaterial({
      color, roughness: rough, metalness: 0.0,
      emissive, emissiveIntensity: emInt,
    });
  }

  // box helper that also registers an XZ collider
  _wall(x0, x1, z0, z1, mat, collide = true) {
    const sx = x1 - x0, sz = z1 - z0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, H, sz), mat);
    m.position.set((x0 + x1) / 2, H / 2, (z0 + z1) / 2);
    this.scene.add(m);
    if (collide) this.colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
    return m;
  }

  _buildLighting() {
    this.scene.add(new THREE.HemisphereLight(0x3a496b, 0x0b1019, 1.05));
    // cold moonlight over the whole journey (directional → lights everything)
    const moon = new THREE.DirectionalLight(0xaabde6, 1.2);
    moon.position.set(-8, 16, 34);
    this.scene.add(moon);
    // interior fills so the rooms read (one per room + hall)
    const fills = [[0, 1], [3, -7], [-3, -14.5], [-5, -7]];
    fills.forEach(([x, z]) => {
      const pl = new THREE.PointLight(0x6b7fae, 0.85, 15, 2);
      pl.position.set(x, 2.4, z);
      this.scene.add(pl);
    });
  }

  _buildGround() {
    const lawn = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 320),
      this._mat(0x131b14, 1.0),
    );
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.set(0, 0, 40);
    this.scene.add(lawn);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 22),
      this._mat(0x14110c, 0.95),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.02, -7);
    this.scene.add(floor);

    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 22),
      this._mat(0x080a0e, 1.0),
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, H, -7);
    this.scene.add(ceil);
  }

  // outer shell + roof + the front facade with its door gap
  _buildShell() {
    const wall = this._mat(0x1b2230, 0.97);
    this._wall(-7.15, 7.15, -18.15, -17.85, wall);      // north (behind bedroom)
    this._wall(-7.15, -6.85, -18.15, 4.15, wall);       // west
    this._wall(6.85, 7.15, -18.15, 4.15, wall);         // east
    this._wall(-7.15, -1.2, 3.85, 4.15, wall);          // front, left of door
    this._wall(1.2, 7.15, 3.85, 4.15, wall);            // front, right of door

    // gabled roof (no collider — you never touch it)
    const roofMat = this._mat(0x0b0e16, 1.0);
    const rise = 1.7, halfW = 7.9, slope = Math.hypot(halfW, rise);
    const tilt = Math.atan2(rise, halfW);
    const mkSlope = (sign) => {
      const s = new THREE.Mesh(new THREE.BoxGeometry(slope, 0.16, 23.6), roofMat);
      s.position.set(sign * halfW / 2, H + rise / 2, -7);
      s.rotation.z = -sign * tilt;
      this.scene.add(s);
    };
    mkSlope(-1); mkSlope(1);
    // gable triangles close the peaks front and back
    const gable = new THREE.Shape();
    gable.moveTo(-halfW, 0); gable.lineTo(halfW, 0); gable.lineTo(0, rise); gable.closePath();
    const gGeo = new THREE.ShapeGeometry(gable);
    const front = new THREE.Mesh(gGeo, roofMat);
    front.position.set(0, H, 4.55);
    this.scene.add(front);
    const back = new THREE.Mesh(gGeo, roofMat);
    back.position.set(0, H, -18.55); back.rotation.y = Math.PI;
    this.scene.add(back);

    // cool wash across the facade so the house reads from the lawn
    const facade = new THREE.PointLight(0x4f6594, 0.8, 22, 2);
    facade.position.set(0, 5.5, 9);
    this.scene.add(facade);

    // faint glow in the doorway, to read as "the way in"
    const doorGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.6),
      new THREE.MeshBasicMaterial({ color: 0x223049, fog: false }),
    );
    doorGlow.position.set(0, 1.3, 4.02);
    this.scene.add(doorGlow);
    const doorLight = new THREE.PointLight(0x4a5f8c, 0.7, 6, 2);
    doorLight.position.set(0, 1.6, 3.4);
    this.scene.add(doorLight);

    // two dark windows flanking the door
    const winMat = new THREE.MeshBasicMaterial({ color: 0x161f30, fog: false });
    [-4, 4].forEach((x) => {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), winMat);
      win.position.set(x, 1.7, 4.16);
      this.scene.add(win);
    });
  }

  _buildInteriorWalls() {
    const wall = this._mat(0x171d29, 0.97);
    // cross wall A at z = -4, doorway gap x[4,6] (forces a turn to the right)
    this._wall(-7.15, 4.0, -4.15, -3.85, wall);
    this._wall(6.0, 7.15, -4.15, -3.85, wall);
    // cross wall B at z = -11, doorway gap x[-6,-4] (turn to the left)
    this._wall(-7.15, -6.0, -11.15, -10.85, wall);
    this._wall(-4.0, 7.15, -11.15, -10.85, wall);
  }

  _buildExterior() {
    // a path leading to the door
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 9),
      this._mat(0x1a1d22, 1.0),
    );
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0.015, 8.5);
    this.scene.add(path);

    // low fence posts framing the yard (with a gate gap for the path)
    const post = this._mat(0x12161d, 0.9);
    for (let x = -8; x <= 8; x += 2) {
      if (Math.abs(x) <= 2) continue;
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.0, 0.14), post);
      p.position.set(x, 0.5, 13.5);
      this.scene.add(p);
    }

    // a dead tree silhouette to the side
    const bark = this._mat(0x0a0c10, 1.0);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 4, 7), bark);
    trunk.position.set(-9, 2, 8);
    this.scene.add(trunk);
    [[0.5, 2.8, 0.6], [-0.5, 3.1, -0.4], [0.2, 3.5, 0.3]].forEach(([dx, y, dz]) => {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 1.6, 6), bark);
      b.position.set(-9 + dx, y, 8 + dz);
      b.rotation.set(dz, 0, dx);
      this.scene.add(b);
    });

    // the moon — high and far, a cold eye over the whole journey (the dark
    // background colour is the sky, so silhouettes read against it)
    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(5, 40),
      new THREE.MeshBasicMaterial({ color: 0xaebfe0, fog: false }),
    );
    moon.position.set(-24, 42, -30);
    this.scene.add(moon);
    const moonFill = new THREE.PointLight(0x6577a0, 0.7, 0, 1);  // infinite range soft fill
    moonFill.position.set(-24, 42, 40);
    this.scene.add(moonFill);
  }

  // a street of dark neighbour houses between the woods and home
  _buildNeighborhood() {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(7, 42), this._mat(0x141619, 1.0));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.03, 35);
    this.scene.add(road);

    const bodyMat = this._mat(0x161a21, 0.97);
    const roofMat = this._mat(0x0a0d14, 1.0);
    const winMat = new THREE.MeshBasicMaterial({ color: 0x222b3e, fog: true });
    [-12, 12].forEach((sx) => {
      [21, 33, 45].forEach((z) => this._neighborHouse(sx, z, bodyMat, roofMat, winMat));
    });

    // streetlights with cold bulbs to mark the road
    [[-4, 49], [4, 37], [-4, 25], [4, 17]].forEach(([x, z]) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.6, 5), this._mat(0x0a0c10, 1));
      pole.position.set(x, 1.8, z);
      this.scene.add(pole);
      const lamp = new THREE.PointLight(0x6f80a6, 0.7, 15, 2);
      lamp.position.set(x, 3.5, z);
      this.scene.add(lamp);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), new THREE.MeshBasicMaterial({ color: 0xaebcd8, fog: false }));
      bulb.position.set(x, 3.5, z);
      this.scene.add(bulb);
    });
  }

  _neighborHouse(x, z, bodyMat, roofMat, winMat) {
    const w = 6, d = 6, h = 3.3;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
    body.position.set(x, h / 2, z);
    this.scene.add(body);
    this.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });

    // gabled roof
    const rise = 1.5, halfW = w / 2 + 0.3, slope = Math.hypot(halfW, rise), tilt = Math.atan2(rise, halfW);
    [-1, 1].forEach((sign) => {
      const s = new THREE.Mesh(new THREE.BoxGeometry(slope, 0.14, d + 0.6), roofMat);
      s.position.set(x + sign * halfW / 2, h + rise / 2, z);
      s.rotation.z = -sign * tilt;
      this.scene.add(s);
    });

    // a dim window on the street-facing wall
    const faceSign = x < 0 ? 1 : -1;
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), winMat);
    win.position.set(x + faceSign * (w / 2 + 0.02), 1.6, z);
    win.rotation.y = faceSign * Math.PI / 2;
    this.scene.add(win);
  }

  // a dense forest you flee through; one clear lane down the middle
  _buildForest() {
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 5, 6);
    const trunkMat = this._mat(0x0a0d0a, 1.0);
    const canopyGeo = new THREE.ConeGeometry(1.9, 4.6, 7);
    const canopyMat = this._mat(0x0c1410, 1.0);

    const pts = [];
    // scattered trees, kept clear of the central running lane so neither you
    // nor the hunter snags on a trunk mid-sprint
    for (let i = 0; i < 120; i++) {
      const z = 56 + Math.random() * 50;          // 56 .. 106
      let x = (Math.random() * 2 - 1) * 30;
      if (Math.abs(x) < 3.6) x += x < 0 ? -3.6 : 3.6;
      pts.push([x, z, 0.8 + Math.random() * 0.55]);
    }

    const count = pts.length;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, count);
    const m = new THREE.Matrix4(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const q = new THREE.Quaternion();
    pts.forEach(([x, z, sc], i) => {
      pos.set(x, 2.5 * sc, z); scl.set(1, sc, 1); m.compose(pos, q, scl); trunks.setMatrixAt(i, m);
      pos.set(x, 5 * sc + 1.4, z); scl.set(sc, sc, sc); m.compose(pos, q, scl); canopies.setMatrixAt(i, m);
      const r = 0.5;
      this.colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r });
    });
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    this.scene.add(trunks, canopies);
  }

  // your physical body, asleep in the bed — the way out
  _buildBody() {
    const bx = this.bodyPosition.x, bz = this.bodyPosition.z;
    const frame = this._mat(0x12100c, 0.9);
    const sheet = this._mat(0x2c3340, 0.9, 0x223046, 0.25);

    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 2.4), frame);
    base.position.set(bx, 0.27, bz);
    this.scene.add(base);
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.2, 2.3), sheet);
    mattress.position.set(bx, 0.6, bz);
    this.scene.add(mattress);

    // the sleeping figure (faintly lit — a beacon)
    const skin = this._mat(0x3a4254, 0.8, 0x2a3550, 0.4);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.26, 1.1), skin);
    torso.position.set(bx, 0.78, bz + 0.1);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), skin);
    head.position.set(bx, 0.8, bz + 0.92);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.95), skin);
    legs.position.set(bx, 0.74, bz - 0.75);
    this.scene.add(torso, head, legs);

    // soft beacon glow above the body
    const beacon = new THREE.PointLight(0x7fbfff, 0.9, 7, 2);
    beacon.position.set(bx, 1.7, bz);
    this.scene.add(beacon);
    this._beacon = beacon;
  }

  _buildEntity() {
    const outer = new THREE.Group();
    const inner = new THREE.Group();
    outer.add(inner);

    const skin = new THREE.MeshStandardMaterial({ color: 0x080a10, roughness: 1 });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.12, 1.15, 10), skin);
    torso.position.y = 1.28;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 14), skin);
    head.position.y = 1.96; head.scale.set(0.9, 1.15, 0.92);
    const armGeo = new THREE.CylinderGeometry(0.045, 0.03, 1.15, 8);
    const armL = new THREE.Mesh(armGeo, skin); armL.position.set(-0.24, 1.28, 0); armL.rotation.z = 0.1;
    const armR = new THREE.Mesh(armGeo, skin); armR.position.set(0.24, 1.28, 0); armR.rotation.z = -0.1;
    const legGeo = new THREE.CylinderGeometry(0.06, 0.045, 1.05, 8);
    const legL = new THREE.Mesh(legGeo, skin); legL.position.set(-0.1, 0.52, 0);
    const legR = new THREE.Mesh(legGeo, skin); legR.position.set(0.1, 0.52, 0);

    // bright cold eyes — stay visible through the monochrome grade
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xdff0ff, fog: false });
    const eyeGeo = new THREE.SphereGeometry(0.028, 8, 8);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.052, 1.98, 0.12);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.052, 1.98, 0.12);
    const glow = new THREE.PointLight(0x9fd0ff, 0.6, 3.5, 2);
    glow.position.set(0, 1.96, 0.2);

    inner.add(torso, head, armL, armR, legL, legR, eyeL, eyeR, glow);
    outer.position.copy(this.entityStart);
    this.scene.add(outer);
    this.entity = outer;
    this._entityInner = inner;
  }

  // ---- collision: push a point out of every wall AABB ----------------
  resolve(vec, r) {
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      const minX = c.minX - r, maxX = c.maxX + r, minZ = c.minZ - r, maxZ = c.maxZ + r;
      if (vec.x > minX && vec.x < maxX && vec.z > minZ && vec.z < maxZ) {
        const pxL = vec.x - minX, pxR = maxX - vec.x;
        const pzL = vec.z - minZ, pzR = maxZ - vec.z;
        const m = Math.min(pxL, pxR, pzL, pzR);
        if (m === pxL) vec.x = minX;
        else if (m === pxR) vec.x = maxX;
        else if (m === pzL) vec.z = minZ;
        else vec.z = maxZ;
      }
    }
  }

  setEntity(x, z, yaw) {
    this.entityPos.set(x, 0, z);
    if (this.entity) {
      this.entity.position.set(x, 0, z);
      this.entity.rotation.y = yaw;
    }
  }

  // Route the hunter toward the player through the actual doorways. Rooms are
  // split by z; if it isn't in the player's room yet it heads for the next
  // door on the path rather than walking straight into a wall.
  entityTarget(ex, ez, px, pz) {
    const zone = (z) => (z > 4 ? 0 : z > -4 ? 1 : z > -11 ? 2 : 3);
    // each doorway waypoint sits just PAST its threshold so that reaching it
    // flips the entity into the next zone (otherwise it stalls at the door)
    const doors = [ { x: 0, z: 3.7 }, { x: 5, z: -4.3 }, { x: -5, z: -11.3 } ];
    const e = zone(ez), p = zone(pz);
    if (e === p) return { x: px, z: pz };
    return doors[e < p ? e : e - 1];
  }

  setAspect(a) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  update(dt) {
    this._t += dt;
    if (this._beacon) this._beacon.intensity = 0.8 + Math.sin(this._t * 1.6) * 0.25;
    if (this._entityInner) this._entityInner.position.y = Math.sin(this._t * 2.2) * 0.04;
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
})();
