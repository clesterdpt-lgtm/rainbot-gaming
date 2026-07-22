// =============================================================
// astral.js — Phase 2 world (the out-of-body return)
//
// A spectral, drained version of the world between you and home.
// You wake on the far side of the forest with your soul shattered
// into shards; the way back runs forest → graveyard → creek bridge
// → the street → your house → the body asleep in the bed. Walls,
// fences, trees and gravestones are real (AABB collision); the
// entity hunts you the whole way; the shards must all be gathered
// before the body will take you back.
//
//   route (top-down, decreasing z = toward home)
//     spawn 170 .. forest .. clearing .. graveyard .. gate 100 ..
//     meadow .. bridge 86 .. street .. yard .. front door 4 ..
//     foyer .. door A .. middle .. door B .. bedroom (body -14.5)
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
    this.scene.fog = new THREE.FogExp2(0x0c1424, 0.028);

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 500);

    this.colliders = [];
    this._t = 0;

    // the long way home
    this.playerStart = new THREE.Vector3(0, 1.62, 170);
    this.entityStart = new THREE.Vector3(2, 0, 196);   // well back, deeper in the trees
    this.bodyPosition = new THREE.Vector3(-3, 1.0, -14.5);
    this.entityPos = this.entityStart.clone();

    // slam-able chokepoints (cemetery gate, front door, door A, door B):
    // sealDoor() fills the gap behind the player; breakDoor() lets the
    // hunter smash through
    this._doorways = [
      { x0: -1.5, x1: 1.5,  z0: 99.85,  z1: 100.15, cx: 0,  cz: 100 },
      { x0: -1.2, x1: 1.2,  z0: 3.85,   z1: 4.15,   cx: 0,  cz: 4 },
      { x0: 4.0,  x1: 6.0,  z0: -4.15,  z1: -3.85,  cx: 5,  cz: -4 },
      { x0: -6.0, x1: -4.0, z0: -11.15, z1: -10.85, cx: -5, cz: -11 },
    ];

    // the shattered soul — every shard must be gathered before the body
    // accepts you. Each sits a little off the main route (risk vs. time).
    this._fragDefs = [
      { x: 7,    z: 138, kind: 'forest', line: 'you remember being carried through these trees' },
      { x: -8,   z: 108, kind: 'grave', line: 'one of the stones already knows your name' },
      { x: 6,    z: 92,  kind: 'water', line: 'the water is breathing with you' },
      { x: 11.5, z: 40,  kind: 'playground', line: 'the empty swing is still warm' },
      { x: 3,    z: -7.5, kind: 'body', line: 'your body inhales without you' },
    ];
    this.fragments = [];
    this.falseFragments = [];
    this.fragmentTotal = this._fragDefs.length;
    this.fragmentsCollected = 0;
    this.corruption = 0;
    this._corruptionTarget = 0;

    this._buildLighting();
    this._buildSky();
    this._buildGround();
    this._buildShell();
    this._buildInteriorWalls();
    this._buildExterior();
    this._buildNeighborhood();
    this._buildPlayground();
    this._buildCemetery();
    this._buildBridge();
    this._buildForest();
    this._buildWisps();
    this._buildBody();
    this._buildEntity();
    this._buildFragments();
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

  _collide(x0, x1, z0, z1) {
    this.colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
  }

  _buildLighting() {
    this.scene.add(new THREE.HemisphereLight(0x3a496b, 0x0b1019, 1.05));
    // cold moonlight over the whole journey (directional → lights everything)
    const moon = new THREE.DirectionalLight(0xaabde6, 1.2);
    moon.position.set(-8, 16, 34);
    this.scene.add(moon);
    this._moonLight = moon;
    // interior fills so the rooms read (one per room + hall)
    const fills = [[0, 1, 0.42], [3, -7, 0.34], [-3, -14.5, 0.18], [-5, -7, 0.3]];
    this._interiorFills = [];
    fills.forEach(([x, z, intensity]) => {
      const pl = new THREE.PointLight(0x6b7fae, intensity, 13, 2);
      pl.position.set(x, 2.4, z);
      pl.userData.baseIntensity = intensity;
      this.scene.add(pl);
      this._interiorFills.push(pl);
    });
    // a soft glow the player's own soul casts on the ground nearby
    this.soulLight = new THREE.PointLight(0x8fb6e8, 0.45, 7, 2);
    this.soulLight.position.set(0, 2.1, 170);
    this.scene.add(this.soulLight);
    // one shared light that sits on the nearest uncollected shard
    this.fragLight = new THREE.PointLight(0x9fd8ff, 1.1, 10, 2);
    this.scene.add(this.fragLight);
  }

  // stars, the moon and its halo, distant mountain silhouettes
  _buildSky() {
    const starGeo = new THREE.BufferGeometry();
    const n = 700, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * 1.35;
      const r = 240;
      pos[i * 3]     = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = 18 + Math.abs(r * Math.cos(ph)) * 0.9;
      pos[i * 3 + 2] = 80 + r * Math.sin(ph) * Math.sin(th);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xbfcfe8, size: 1.7, sizeAttenuation: false,
      fog: false, transparent: true, opacity: 0.8, depthWrite: false,
    }));
    this.scene.add(stars);

    // the moon — high and far, a cold eye over the whole journey
    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(6, 40),
      new THREE.MeshBasicMaterial({ color: 0xaebfe0, fog: false }),
    );
    moon.position.set(-30, 52, -40);
    this.scene.add(moon);
    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(11, 40),
      new THREE.MeshBasicMaterial({
        color: 0x5d709e, fog: false, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    halo.position.set(-30, 52, -40.5);
    this.scene.add(halo);
    const moonFill = new THREE.PointLight(0x6577a0, 0.7, 0, 1);  // infinite soft fill
    moonFill.position.set(-30, 52, 60);
    this.scene.add(moonFill);

    // far mountain / treeline silhouettes so the horizon isn't empty
    const mtn = this._mat(0x05070c, 1.0);
    [[-95, 80, 55, 30], [95, 90, 62, 34], [-75, 155, 45, 24], [80, 160, 50, 27], [-60, 20, 40, 20]]
      .forEach(([x, z, r, h]) => {
        const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), mtn);
        m.position.set(x, h / 2 - 1, z);
        this.scene.add(m);
      });
  }

  _buildGround() {
    const lawn = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 460),
      this._mat(0x131b14, 1.0),
    );
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.set(0, 0, 80);
    this.scene.add(lawn);

    // darker forest floor for the deep woods
    const duff = new THREE.Mesh(new THREE.PlaneGeometry(120, 80), this._mat(0x0e130e, 1.0));
    duff.rotation.x = -Math.PI / 2;
    duff.position.set(0, 0.005, 152);
    this.scene.add(duff);

    // cemetery earth
    const plot = new THREE.Mesh(new THREE.PlaneGeometry(46, 22), this._mat(0x11150f, 1.0));
    plot.rotation.x = -Math.PI / 2;
    plot.position.set(0, 0.008, 111);
    this.scene.add(plot);

    // house floor + ceiling
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 22), this._mat(0x14110c, 0.95));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.02, -7);
    this.scene.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(14, 22), this._mat(0x080a0e, 1.0));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, H, -7);
    this.scene.add(ceil);
  }

  // outer shell + roof + the front facade with its door gap
  _buildShell() {
    const wall = this._mat(0x111722, 0.97);
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

    // a dead tree silhouette to the side of the yard
    this._deadTree(-9, 8, 1.0);
  }

  _deadTree(x, z, sc = 1) {
    const bark = this._mat(0x0a0c10, 1.0);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * sc, 0.26 * sc, 4 * sc, 7), bark);
    trunk.position.set(x, 2 * sc, z);
    this.scene.add(trunk);
    [[0.5, 2.8, 0.6], [-0.5, 3.1, -0.4], [0.2, 3.5, 0.3]].forEach(([dx, y, dz]) => {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * sc, 0.12 * sc, 1.6 * sc, 6), bark);
      b.position.set(x + dx * sc, y * sc, z + dz * sc);
      b.rotation.set(dz, 0, dx);
      this.scene.add(b);
    });
    this._collide(x - 0.35, x + 0.35, z - 0.35, z + 0.35);
  }

  // a long street of dark neighbour houses between the bridge and home
  _buildNeighborhood() {
    this._windowWatchers = [];
    const road = new THREE.Mesh(new THREE.PlaneGeometry(7, 64), this._mat(0x141619, 1.0));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.03, 42);
    this.scene.add(road);

    // faded centre-line dashes
    const dashMat = new THREE.MeshBasicMaterial({ color: 0x2a3140 });
    for (let z = 16; z <= 70; z += 8) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 2.4), dashMat);
      d.rotation.x = -Math.PI / 2;
      d.position.set(0, 0.04, z);
      this.scene.add(d);
    }

    const bodyMat = this._mat(0x161a21, 0.97);
    const roofMat = this._mat(0x0a0d14, 1.0);
    const winMat = new THREE.MeshBasicMaterial({ color: 0x222b3e, fog: true });
    [18, 30, 42, 54, 66].forEach((z) => this._neighborHouse(-12, z, bodyMat, roofMat, winMat));
    [18, 30, 54, 66].forEach((z) => this._neighborHouse(12, z, bodyMat, roofMat, winMat));

    // streetlights with cold bulbs to mark the road
    [[-4, 18], [4, 31], [-4, 44], [4, 57], [-4, 70]].forEach(([x, z]) => {
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

    // an abandoned car at the kerb
    const car = new THREE.Group();
    const paint = this._mat(0x11151c, 0.6);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 4.2), paint);
    shell.position.y = 0.62;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.1), this._mat(0x0c1018, 0.4));
    cabin.position.set(0, 1.12, -0.2);
    car.add(shell, cabin);
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10);
    const wheelMat = this._mat(0x05060a, 1.0);
    [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.3], [0.85, -1.3]].forEach(([wx, wz]) => {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.34, wz);
      car.add(w);
    });
    car.position.set(5.6, 0, 48);
    car.rotation.y = 0.06;
    this.scene.add(car);
    this._collide(4.6, 6.6, 45.8, 50.2);
  }

  _neighborHouse(x, z, bodyMat, roofMat, winMat) {
    const w = 6, d = 6, h = 3.3;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
    body.position.set(x, h / 2, z);
    this.scene.add(body);
    this._collide(x - w / 2, x + w / 2, z - d / 2, z + d / 2);

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

    const watcher = new THREE.Group();
    const watcherMat = this._mat(0x020306, 1.0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), watcherMat);
    head.scale.set(0.7, 1.15, 0.58);
    head.position.y = 0.2;
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), watcherMat);
    shoulders.scale.set(0.55, 0.6, 0.42);
    shoulders.position.y = -0.12;
    watcher.add(head, shoulders);
    watcher.position.set(x + faceSign * (w / 2 + 0.055), 1.48, z);
    watcher.visible = false;
    this.scene.add(watcher);
    this._windowWatchers.push(watcher);
  }

  // a small playground off the street — one swing rocks on its own
  _buildPlayground() {
    const metal = this._mat(0x141a22, 0.7);

    // swing set: two A-frames + top bar
    const barY = 2.15, cx = 11.5, cz = 40;
    [-1.5, 1.5].forEach((dz) => {
      [-0.5, 0.5].forEach((lean) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.5, 6), metal);
        leg.position.set(cx + lean * 0.9, barY / 2, cz + dz);
        leg.rotation.z = lean * 0.75;
        this.scene.add(leg);
      });
    });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 6), metal);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(cx, barY, cz);
    this.scene.add(bar);

    // two swings; the first one moves by itself
    const mkSwing = (dz) => {
      const pivot = new THREE.Group();
      pivot.position.set(cx, barY, cz + dz);
      [-0.28, 0.28].forEach((dx) => {
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.6, 4), metal);
        rope.position.set(dx, -0.8, 0);
        pivot.add(rope);
      });
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.05, 0.24), this._mat(0x0d1016, 0.8));
      seat.position.set(0, -1.62, 0);
      pivot.add(seat);
      this.scene.add(pivot);
      return pivot;
    };
    this._swing = mkSwing(-0.8);
    this._swingOther = mkSwing(0.8);
    this._swingOther.rotation.x = 0.06;
    this._collide(cx - 1.1, cx + 1.1, cz - 1.9, cz + 1.9);

    // a seesaw beside it
    const pivotBlock = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.3), metal);
    pivotBlock.position.set(14.2, 0.2, 43.5);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 3.2), this._mat(0x121620, 0.8));
    plank.position.set(14.2, 0.44, 43.5);
    plank.rotation.x = 0.16;
    this.scene.add(pivotBlock, plank);
    this._collide(13.7, 14.7, 42.0, 45.0);
  }

  // the graveyard: iron fence across the route with one gate, rows of stones
  _buildCemetery() {
    const iron = this._mat(0x10141b, 0.75);
    const stone = this._mat(0x1a2027, 0.95);

    // fence rails either side of the gate (blocks the whole route width)
    [[-30, -1.8], [1.8, 30]].forEach(([x0, x1]) => {
      [0.55, 1.25].forEach((y) => {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.07, 0.07), iron);
        rail.position.set((x0 + x1) / 2, y, 100);
        this.scene.add(rail);
      });
      for (let x = x0; x <= x1; x += 2.35) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.55, 0.09), iron);
        p.position.set(x, 0.78, 100);
        this.scene.add(p);
      }
      this._collide(x0, x1, 99.85, 100.15);
    });
    // stone pillars flanking the gate
    [-1.8, 1.8].forEach((x) => {
      const pl = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.9, 0.55), stone);
      pl.position.set(x, 0.95, 100);
      this.scene.add(pl);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.7), stone);
      cap.position.set(x, 1.95, 100);
      this.scene.add(cap);
    });

    // gravestones — instanced, tilted, keeping the centre lane clear
    const slabGeo = new THREE.BoxGeometry(0.52, 0.78, 0.13);
    const count = 44;
    const graves = new THREE.InstancedMesh(slabGeo, stone, count);
    this._graveData = [];
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    let i = 0;
    for (let row = 0; row < 6 && i < count; row++) {
      for (let col = 0; col < 9 && i < count; col++) {
        const gx = -18 + col * 4.3 + (Math.random() - 0.5) * 1.6;
        const gz = 102.5 + row * 2.9 + (Math.random() - 0.5) * 1.1;
        if (Math.abs(gx) < 2.4) continue;                 // keep the path walkable
        const sc = 0.8 + Math.random() * 0.5;
        e.set((Math.random() - 0.5) * 0.16, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.2);
        q.setFromEuler(e);
        p.set(gx, 0.36 * sc, gz);
        s.set(sc, sc, sc);
        m.compose(p, q, s);
        graves.setMatrixAt(i++, m);
        this._graveData.push({ x: gx, z: gz, sc });
        this._collide(gx - 0.3, gx + 0.3, gz - 0.22, gz + 0.22);
      }
    }
    graves.count = i;
    graves.instanceMatrix.needsUpdate = true;
    this.scene.add(graves);
    this._graves = graves;

    // a few taller monuments + dead trees around the plot
    [[-14, 116], [10, 104], [16, 114]].forEach(([x, z]) => {
      const ob = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 0.5), stone);
      ob.position.set(x, 1.1, z);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.5, 4), stone);
      tip.position.set(x, 2.45, z);
      this.scene.add(ob, tip);
      this._collide(x - 0.35, x + 0.35, z - 0.35, z + 0.35);
    });
    [[-19, 108], [19, 119], [-6, 121], [13, 122]].forEach(([x, z]) => this._deadTree(x, z, 0.85 + Math.random() * 0.3));
  }

  // the creek + the plank bridge — the only way across
  _buildBridge() {
    // dark water strip clear across the world
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 6),
      new THREE.MeshBasicMaterial({ color: 0x0e1a2a }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.012, 86);
    this.scene.add(water);
    this._water = water;
    // a faint moonlit sheen down its length
    const sheen = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 1.1),
      new THREE.MeshBasicMaterial({
        color: 0x2c3f5e, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    sheen.rotation.x = -Math.PI / 2;
    sheen.position.set(0, 0.02, 86.2);
    this.scene.add(sheen);
    this._waterSheen = sheen;

    const hands = new THREE.Group();
    const handMat = this._mat(0x101823, 0.9, 0x07101a, 0.08);
    [-4.2, -2.6, 2.6, 4.2].forEach((x, hi) => {
      const hand = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), handMat);
      palm.scale.set(0.7, 1.25, 0.38);
      const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.145, 0.72, 7), handMat);
      forearm.position.y = -0.46;
      forearm.rotation.z = (hi % 2 ? -1 : 1) * 0.08;
      hand.add(forearm, palm);
      for (let i = 0; i < 4; i++) {
        const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.027, 0.38 + i * 0.032, 6), handMat);
        finger.position.set(-0.075 + i * 0.05, 0.28 + i * 0.015, 0);
        finger.rotation.z = (i - 1.5) * 0.08;
        hand.add(finger);
      }
      hand.position.set(x, -0.18 - hi * 0.03, 85.25 + (hi % 2) * 1.5);
      hand.rotation.y = hi * 0.8;
      hands.add(hand);
    });
    hands.visible = false;
    this.scene.add(hands);
    this._waterHands = hands;

    // banks are impassable except at the bridge gap x[-1.75, 1.75]
    this._collide(-130, -1.75, 85.8, 86.2);
    this._collide(1.75, 130, 85.8, 86.2);

    // planks
    const wood = this._mat(0x161209, 0.9);
    for (let z = 83.2; z <= 88.8; z += 0.62) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.09, 0.5), wood);
      plank.position.set(0, 0.1, z);
      plank.rotation.y = (Math.random() - 0.5) * 0.05;
      this.scene.add(plank);
    }
    // rails
    [-1.95, 1.95].forEach((x) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 6.4), wood);
      rail.position.set(x, 0.95, 86);
      this.scene.add(rail);
      [83.2, 86, 88.8].forEach((z) => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.1), wood);
        post.position.set(x, 0.5, z);
        this.scene.add(post);
      });
      this._collide(x - 0.1, x + 0.1, 82.9, 89.1);
    });
  }

  // deep forest between the spawn and the graveyard; one clear lane, one clearing
  _buildForest() {
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 5, 6);
    const trunkMat = this._mat(0x0a0d0a, 1.0);
    const canopyGeo = new THREE.ConeGeometry(1.9, 4.6, 7);
    const canopyMat = this._mat(0x0c1410, 1.0);

    const pts = [];
    // scattered trees, kept clear of the running lane and the shard clearing
    for (let i = 0; i < 210; i++) {
      const z = 118 + Math.random() * 72;          // 118 .. 190
      let x = (Math.random() * 2 - 1) * 34;
      if (Math.abs(x) < 3.6) x += x < 0 ? -3.6 : 3.6;
      if (Math.hypot(x - 7, z - 138) < 6) continue;   // the clearing
      pts.push([x, z, 0.8 + Math.random() * 0.55]);
    }
    // sparse trees flanking the meadow + street so the edges never feel bare
    for (let i = 0; i < 46; i++) {
      const z = 8 + Math.random() * 108;           // 8 .. 116
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = side * (17 + Math.random() * 18);
      if (Math.abs(z - 86) < 3) continue;          // not in the creek
      if (z > 99 && z < 122 && Math.abs(x) < 21) continue;   // not in the graveyard
      pts.push([x, z, 0.75 + Math.random() * 0.6]);
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
      this._collide(x - r, x + r, z - r, z + r);
    });
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    this.scene.add(trunks, canopies);
    this._forestTrunks = trunks;
    this._forestCanopies = canopies;

    // Static human proportions among the trunks become readable only after
    // the first fragment. None moves while it is on screen.
    this._forestWatchers = [];
    const watcherMat = this._mat(0x020405, 1.0);
    [[-6, 150], [8, 158], [-11, 132], [13, 124], [-7, 174], [10, 181]].forEach(([x, z], i) => {
      const watcher = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 1.75, 6), watcherMat);
      body.position.y = 0.9;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 7), watcherMat);
      head.scale.y = 1.2;
      head.position.y = 1.88;
      watcher.add(body, head);
      watcher.position.set(x, 0, z);
      watcher.rotation.y = i * 0.9;
      watcher.visible = false;
      this.scene.add(watcher);
      this._forestWatchers.push(watcher);
    });
  }

  // slow drifting spirit-wisps over the whole route
  _buildWisps() {
    const n = 90;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    this._wispBase = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3]     = (Math.random() * 2 - 1) * 42;
      pos[i * 3 + 1] = 0.4 + Math.random() * 2.0;
      pos[i * 3 + 2] = -12 + Math.random() * 195;
      this._wispBase[i * 3] = pos[i * 3];
      this._wispBase[i * 3 + 1] = pos[i * 3 + 1];
      this._wispBase[i * 3 + 2] = pos[i * 3 + 2];
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this._wisps = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x9fd0ff, size: 0.07, sizeAttenuation: true,
      transparent: true, opacity: 0.55, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.scene.add(this._wisps);
  }

  // your physical body, asleep in the bed — the way out
  _buildBodyLegacy() {
    const bx = this.bodyPosition.x, bz = this.bodyPosition.z;
    const frame = this._mat(0x12100c, 0.9);
    const sheet = this._mat(0x30394a, 0.9, 0x1a2436, 0.12);
    const sheetEdge = this._mat(0x46546b, 0.86, 0x202c43, 0.18);

    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 2.4), frame);
    base.position.set(bx, 0.27, bz);
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.2, 2.3), sheet);
    mattress.position.set(bx, 0.6, bz);
    this.scene.add(base, mattress);

    const sleeper = new THREE.Group();
    this.scene.add(sleeper);
    this._sleeper = sleeper;
    const skin = this._mat(0x7f8ba0, 0.76, 0x263249, 0.18);
    const skinShadow = this._mat(0x596477, 0.84, 0x182135, 0.1);
    const gown = this._mat(0x77869d, 0.9, 0x293750, 0.18);
    const hair = this._mat(0x1a202c, 0.92, 0x101725, 0.12);
    const feature = new THREE.MeshBasicMaterial({ color: 0x303747, fog: false });
    const tube = (points, radius, material, radial = 7) => new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 10, radius, radial, false), material,
    );

    // A soft pillow with a central depression instead of a rigid block.
    const pillow = new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 12), this._mat(0x3c4659, 0.92));
    pillow.scale.set(1.25, 0.24, 0.82);
    pillow.position.set(bx, 0.735, bz + 0.92);
    sleeper.add(pillow);
    const pillowSeam = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.008, 5, 24), sheetEdge);
    pillowSeam.scale.set(1.3, 1, 0.82);
    pillowSeam.rotation.x = Math.PI / 2;
    pillowSeam.position.set(bx, 0.79, bz + 0.92);
    pillowSeam.visible = false;
    sleeper.add(pillowSeam);

    // A hair cap and nine curved locks spread over the pillow.
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.145, 18, 12), hair);
    hairCap.scale.set(1.18, 0.64, 1.28);
    hairCap.position.set(bx, 0.842, bz + 0.94);
    sleeper.add(hairCap);
    for (let i = -2; i <= 2; i++) {
      const s = i / 2;
      sleeper.add(tube([
        new THREE.Vector3(bx + s * 0.1, 0.84, bz + 0.93),
        new THREE.Vector3(bx + s * 0.16 + Math.sin(i * 2.1) * 0.018, 0.805, bz + 0.8),
        new THREE.Vector3(bx + s * 0.2, 0.79, bz + 0.67 - Math.abs(s) * 0.035),
      ], 0.017 + (2 - Math.abs(i)) * 0.003, hair, 5));
    }

    // Connected neck, face and ears. Closed eyelids and parted lips make the
    // pose read as a sleeping person even from the bedroom doorway.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.082, 0.17, 10), skinShadow);
    neck.rotation.x = Math.PI / 2;
    neck.position.set(bx, 0.845, bz + 0.7);
    sleeper.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 16), skin);
    head.scale.set(0.88, 0.72, 1.1);
    head.position.set(bx, 0.91, bz + 0.91);
    sleeper.add(head);
    [-1, 1].forEach((s) => {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), skinShadow);
      ear.scale.set(0.45, 0.75, 1);
      ear.position.set(bx + s * 0.112, 0.91, bz + 0.91);
      sleeper.add(ear);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.006, 0.009), feature);
      lid.rotation.y = s * 0.08;
      lid.position.set(bx + s * 0.043, 0.999, bz + 0.93);
      sleeper.add(lid);
    });
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), skinShadow);
    nose.scale.set(0.65, 0.55, 1.05);
    nose.position.set(bx, 0.998, bz + 0.89);
    sleeper.add(nose);
    const lips = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.006, 0.009), feature);
    lips.position.set(bx, 0.993, bz + 0.84);
    sleeper.add(lips);

    // Gowned shoulders and collar stay above the blanket line.
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 12), gown);
    torso.scale.set(1.5, 0.44, 1.22);
    torso.position.set(bx, 0.785, bz + 0.49);
    sleeper.add(torso);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 20), sheetEdge);
    collar.rotation.x = Math.PI / 2;
    collar.scale.y = 0.65;
    collar.position.set(bx, 0.88, bz + 0.63);
    sleeper.add(collar);

    const addHand = (x, y, z, angle = 0) => {
      const handGroup = new THREE.Group();
      handGroup.position.set(x, y, z); handGroup.rotation.y = angle;
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), skin);
      palm.scale.set(0.8, 0.36, 1.15); handGroup.add(palm);
      for (let i = 0; i < 4; i++) {
        handGroup.add(tube([
          new THREE.Vector3(-0.035 + i * 0.023, 0, -0.025),
          new THREE.Vector3(-0.038 + i * 0.024, -0.002, -0.085 - Math.abs(i - 1.5) * 0.006),
        ], 0.0065, skinShadow, 5));
      }
      sleeper.add(handGroup);
    };

    // One relaxed arm crosses the chest; the other rests beside the body.
    sleeper.add(tube([
      new THREE.Vector3(bx - 0.26, 0.83, bz + 0.48),
      new THREE.Vector3(bx - 0.34, 0.84, bz + 0.3),
      new THREE.Vector3(bx + 0.05, 0.87, bz + 0.28),
    ], 0.045, gown, 8));
    sleeper.add(tube([
      new THREE.Vector3(bx + 0.27, 0.82, bz + 0.47),
      new THREE.Vector3(bx + 0.37, 0.775, bz + 0.26),
      new THREE.Vector3(bx + 0.34, 0.75, bz + 0.02),
    ], 0.043, gown, 8));
    addHand(bx + 0.1, 0.875, bz + 0.26, Math.PI / 2);
    addHand(bx + 0.34, 0.755, bz - 0.04, 0.08);

    // A sculpted blanket grid blends shoulder, torso, knee and foot heights
    // into one draped surface—no intersecting spheres or hard seams.
    const nx = 12, nz = 22, blanketVerts = [], blanketIdx = [];
    for (let iz = 0; iz <= nz; iz++) {
      const v = iz / nz;
      const z = bz + 0.48 - v * 1.65;
      for (let ix = 0; ix <= nx; ix++) {
        const u = ix / nx;
        const x = bx - 0.66 + u * 1.32;
        const side = Math.pow(Math.max(0, 1 - Math.abs((u - 0.5) * 2)), 0.55);
        const chest = Math.exp(-Math.pow((v - 0.12) / 0.24, 2)) * 0.16;
        const hips = Math.exp(-Math.pow((v - 0.48) / 0.3, 2)) * 0.105;
        const knees = Math.exp(-Math.pow((v - 0.68) / 0.17, 2)) * 0.11;
        const feet = Math.exp(-Math.pow((v - 0.93) / 0.12, 2)) * 0.07;
        const crease = Math.sin(u * Math.PI * 5 + v * 3) * 0.008 * side;
        blanketVerts.push(x, 0.74 + side * (chest + hips + knees + feet) + crease, z);
      }
    }
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const a = iz * (nx + 1) + ix, b = a + 1, c = a + nx + 1, d = c + 1;
        blanketIdx.push(a, c, b, b, c, d);
      }
    }
    const blanketGeo = new THREE.BufferGeometry();
    blanketGeo.setAttribute('position', new THREE.Float32BufferAttribute(blanketVerts, 3));
    blanketGeo.setIndex(blanketIdx); blanketGeo.computeVertexNormals();
    const blanket = new THREE.Mesh(blanketGeo, sheet);
    blanket.castShadow = true; blanket.receiveShadow = true;
    sleeper.add(blanket); this._bodyBlanket = blanket;

    // Raised seams describe the sheet in the cold beacon light.
    [-0.38, 0.38].forEach((offset, i) => {
      sleeper.add(tube([
        new THREE.Vector3(bx + offset, 0.78, bz + 0.38),
        new THREE.Vector3(bx + offset * 0.8, 0.79, bz - 0.28),
        new THREE.Vector3(bx + offset * 0.9, 0.755, bz - 1.12),
      ], 0.0045, sheetEdge, 5));
    });

    sleeper.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    const beacon = new THREE.PointLight(0x7fbfff, 0.9, 7, 2);
    beacon.position.set(bx, 1.7, bz);
    this.scene.add(beacon);
    this._beacon = beacon;
  }

  _buildBody() {
    const bx = this.bodyPosition.x, bz = this.bodyPosition.z;
    const frameMat = this._mat(0x100d0b, 0.92);
    const mattressMat = this._mat(0x242b3a, 0.96, 0x0b101c, 0.05);
    const pillowMat = this._mat(0x30394a, 0.94, 0x11192a, 0.06);
    const quiltMat = this._mat(0x182135, 0.97, 0x09101e, 0.07);
    const quiltEdgeMat = this._mat(0x34445e, 0.88, 0x121d31, 0.08);
    const skinMat = this._mat(0x4b505b, 0.82, 0x171c27, 0.06);
    const skinShadeMat = this._mat(0x313743, 0.88, 0x0e131e, 0.04);
    const gownMat = this._mat(0x465064, 0.94, 0x182238, 0.09);
    const gownEdgeMat = this._mat(0x30394b, 0.92, 0x10192a, 0.06);
    const hairMat = this._mat(0x151923, 0.96, 0x090d17, 0.08);
    const featureMat = new THREE.MeshBasicMaterial({ color: 0x242834, fog: false });

    const tube = (points, radius, material, radial = 7, segments = 12) => new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, radius, radial, false),
      material,
    );
    const sphere = (radius, scale, pos, material, seg = 16) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, seg, Math.max(8, seg - 4)), material);
      mesh.scale.set(scale[0], scale[1], scale[2]);
      mesh.position.set(pos[0], pos[1], pos[2]);
      return mesh;
    };

    // Bed and pillow are separate from the sleeper rig so breathing never
    // makes the furniture float. Layered rails help the bed read at a glance.
    const bed = new THREE.Group();
    bed.position.set(bx, 0, bz);
    bed.rotation.y = Math.PI;
    this.scene.add(bed);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.44, 2.42), frameMat);
    base.position.y = 0.28;
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.2, 2.3), mattressMat);
    mattress.position.y = 0.6;
    const headRail = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.64, 0.08), frameMat);
    headRail.position.set(0, 0.58, 1.18);
    headRail.visible = false;
    bed.add(base, mattress, headRail);
    [-0.69, 0.69].forEach((x) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.85, 10), frameMat);
      post.position.set(x, 0.5, 1.18);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), frameMat);
      cap.position.set(x, 0.94, 1.18);
      post.visible = false; cap.visible = false;
      bed.add(post, cap);
    });
    const pillow = sphere(0.28, [1.3, 0.25, 0.84], [0, 0.735, 0.91], pillowMat, 20);
    bed.add(pillow);

    // Everything human lives in one local rig centered on the bed. This keeps
    // limbs connected and makes the subtle breathing animation coherent.
    const sleeper = new THREE.Group();
    sleeper.position.set(bx, 0, bz);
    sleeper.rotation.y = Math.PI;
    this.scene.add(sleeper);
    this._sleeper = sleeper;

    // Head turned slightly toward the approaching soul. A dark cranium sits
    // behind a smaller face volume so the hair reads as a cap, not a halo.
    const headRig = new THREE.Group();
    headRig.position.set(-0.025, 0.88, 0.88);
    headRig.rotation.y = -0.1;
    sleeper.add(headRig);
    this._sleeperHead = headRig;
    this._sleeperHeadBasePos = headRig.position.clone();
    this._sleeperHeadBaseRot = headRig.rotation.clone();
    const hairBack = sphere(0.145, [1.16, 0.74, 1.18], [0, -0.012, 0.015], hairMat, 20);
    const face = sphere(0.125, [0.88, 0.72, 1.04], [0, 0.045, -0.008], skinMat, 20);
    headRig.add(hairBack, face);
    [-1, 1].forEach((s) => {
      const ear = sphere(0.024, [0.48, 0.75, 1], [s * 0.112, 0.04, -0.002], skinShadeMat, 10);
      headRig.add(ear);
      const lid = tube([
        new THREE.Vector3(s * 0.073, 0.132, 0.026),
        new THREE.Vector3(s * 0.045, 0.136, 0.034),
        new THREE.Vector3(s * 0.02, 0.132, 0.025),
      ], 0.0042, featureMat, 5, 7);
      headRig.add(lid);
    });
    this._sleeperEyes = [];
    [-1, 1].forEach((s) => {
      const eye = sphere(0.018, [1.45, 0.28, 0.8], [s * 0.045, 0.142, 0.025], featureMat, 10);
      eye.visible = false;
      headRig.add(eye);
      this._sleeperEyes.push(eye);
    });
    const nose = sphere(0.016, [0.64, 0.6, 1.05], [0, 0.139, -0.004], skinShadeMat, 10);
    const mouth = tube([
      new THREE.Vector3(-0.024, 0.128, -0.055),
      new THREE.Vector3(0, 0.126, -0.06),
      new THREE.Vector3(0.024, 0.128, -0.055),
    ], 0.0032, featureMat, 5, 7);
    headRig.add(nose, mouth);

    // Hair spreads in separate tapered-looking locks. Each is short and points
    // away from the skull, avoiding the cable loops of the previous model.
    const locks = [
      [-0.1, 0.0, 0.05, -0.27, -0.035, -0.02],
      [-0.12, -0.01, 0.0, -0.31, -0.055, -0.17],
      [-0.08, -0.02, -0.08, -0.24, -0.06, -0.28],
      [0.1, 0.0, 0.05, 0.25, -0.035, 0.0],
      [0.12, -0.01, 0.0, 0.3, -0.055, -0.15],
      [0.08, -0.02, -0.08, 0.22, -0.06, -0.27],
    ];
    locks.forEach((d, i) => {
      const lock = sphere(
        0.11,
        [1.25 + (i % 2) * 0.18, 0.16, 0.72 + (i % 3) * 0.08],
        [d[3] * 0.68, -0.055, d[5] * 0.52],
        hairMat,
        12,
      );
      lock.rotation.y = (d[3] < 0 ? -1 : 1) * (0.25 + (i % 3) * 0.12);
      headRig.add(lock);
    });

    const neck = tube([
      new THREE.Vector3(-0.015, 0.82, 0.78),
      new THREE.Vector3(-0.008, 0.805, 0.7),
      new THREE.Vector3(0, 0.79, 0.64),
    ], 0.065, skinShadeMat, 9, 10);
    sleeper.add(neck);

    // A single gown torso joins neck, shoulders and waist. A shallow neckline
    // and center fold give it clothing structure without bright wire outlines.
    const chestRig = new THREE.Group();
    chestRig.position.set(0, 0, 0);
    sleeper.add(chestRig);
    this._sleeperChest = chestRig;
    this._sleeperChestBasePos = chestRig.position.clone();
    const torso = sphere(0.27, [1.38, 0.42, 1.24], [0, 0.77, 0.49], gownMat, 20);
    const leftShoulder = sphere(0.13, [1.05, 0.72, 1], [-0.27, 0.78, 0.51], gownMat, 16);
    const rightShoulder = sphere(0.13, [1.05, 0.72, 1], [0.27, 0.78, 0.51], gownMat, 16);
    chestRig.add(torso, leftShoulder, rightShoulder);
    const neckline = tube([
      new THREE.Vector3(-0.105, 0.865, 0.65),
      new THREE.Vector3(0, 0.845, 0.625),
      new THREE.Vector3(0.105, 0.865, 0.65),
    ], 0.009, gownEdgeMat, 6, 10);
    chestRig.add(neckline);

    const addJoint = (x, y, z, radius, material) => {
      const joint = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 9), material);
      joint.position.set(x, y, z); sleeper.add(joint); return joint;
    };
    const addHand = (x, y, z, rotation, mirrored = false) => {
      const hand = new THREE.Group();
      hand.position.set(x, y, z);
      hand.rotation.y = rotation;
      const palm = sphere(0.052, [0.82, 0.38, 1.18], [0, 0, 0], skinMat, 12);
      hand.add(palm);
      for (let i = 0; i < 5; i++) {
        const px = -0.038 + i * 0.019;
        const len = 0.068 + (2 - Math.abs(i - 2)) * 0.007;
        hand.add(tube([
          new THREE.Vector3(px, 0, -0.025),
          new THREE.Vector3(px + (mirrored ? -1 : 1) * 0.004, -0.002, -len),
        ], 0.0052, skinShadeMat, 5, 5));
      }
      sleeper.add(hand);
      return hand;
    };

    // Left arm bends across the chest; right arm lies loose beside the body.
    // Separate gown sleeves and bare forearms clarify joints and proportions.
    sleeper.add(tube([
      new THREE.Vector3(-0.27, 0.79, 0.51),
      new THREE.Vector3(-0.36, 0.8, 0.34),
      new THREE.Vector3(-0.34, 0.815, 0.23),
    ], 0.052, gownMat, 9, 11));
    addJoint(-0.34, 0.815, 0.23, 0.047, skinShadeMat);
    sleeper.add(tube([
      new THREE.Vector3(-0.34, 0.815, 0.23),
      new THREE.Vector3(-0.2, 0.845, 0.18),
      new THREE.Vector3(0.005, 0.86, 0.27),
    ], 0.038, skinMat, 8, 11));
    addHand(0.055, 0.865, 0.29, Math.PI * 0.45, false);

    sleeper.add(tube([
      new THREE.Vector3(0.27, 0.79, 0.51),
      new THREE.Vector3(0.37, 0.765, 0.34),
      new THREE.Vector3(0.39, 0.75, 0.18),
    ], 0.05, gownMat, 9, 11));
    addJoint(0.39, 0.75, 0.18, 0.045, skinShadeMat);
    sleeper.add(tube([
      new THREE.Vector3(0.39, 0.75, 0.18),
      new THREE.Vector3(0.38, 0.735, 0.03),
      new THREE.Vector3(0.34, 0.735, -0.12),
    ], 0.036, skinMat, 8, 11));
    addHand(0.33, 0.74, -0.17, 0.05, true);

    // Sculpted quilt surface: a continuous body-shaped profile with raised
    // chest, hips, knees and feet, softly dropping to the mattress at the sides.
    const nx = 16, nz = 28, verts = [], indices = [];
    for (let iz = 0; iz <= nz; iz++) {
      const v = iz / nz;
      const z = 0.6 - v * 1.79;
      for (let ix = 0; ix <= nx; ix++) {
        const u = ix / nx;
        const x = -0.67 + u * 1.34;
        const across = (u - 0.5) * 2;
        const bodyWidth = Math.exp(-Math.pow(across / 0.72, 4));
        const edgeDrop = Math.pow(Math.max(0, 1 - Math.abs(across)), 0.42);
        const chest = Math.exp(-Math.pow((v - 0.06) / 0.19, 2)) * 0.14;
        const hips = Math.exp(-Math.pow((v - 0.38) / 0.25, 2)) * 0.105;
        const knees = Math.exp(-Math.pow((v - 0.66) / 0.15, 2)) * 0.13;
        const feet = Math.exp(-Math.pow((v - 0.93) / 0.1, 2)) * 0.085;
        const folds = Math.sin(u * Math.PI * 6 + v * 2.4) * 0.007 * edgeDrop;
        const y = 0.72 + edgeDrop * 0.025 + bodyWidth * (chest + hips + knees + feet) + folds;
        verts.push(x, y, z);
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
    const quilt = new THREE.Mesh(quiltGeo, quiltMat);
    quilt.castShadow = true; quilt.receiveShadow = true;
    sleeper.add(quilt); this._bodyBlanket = quilt;

    // A rolled top hem and two restrained stitched channels make the quilt
    // legible under spectral grading without outlining every contour.
    const topHem = tube([
      new THREE.Vector3(-0.62, 0.75, 0.6),
      new THREE.Vector3(0, 0.875, 0.59),
      new THREE.Vector3(0.62, 0.75, 0.6),
    ], 0.012, quiltEdgeMat, 7, 14);
    sleeper.add(topHem);
    [-0.28, 0.28].forEach((x) => {
      sleeper.add(tube([
        new THREE.Vector3(x, 0.79, 0.5),
        new THREE.Vector3(x * 0.82, 0.765, -0.35),
        new THREE.Vector3(x * 0.9, 0.735, -1.12),
      ], 0.004, quiltEdgeMat, 5, 12));
    });

    sleeper.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    bed.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });

    // The last room echoes the real bedroom instead of ending in an empty
    // box. Familiar silhouettes make the return feel wrong before the body
    // itself moves: window, chair, wardrobe, rug and a tiny steady lamp.
    const roomDark = this._mat(0x0b0e15, 0.98);
    const roomWood = this._mat(0x15131a, 0.94);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 4.4), this._mat(0x111827, 1));
    rug.rotation.x = -Math.PI / 2; rug.position.set(-2.2, 0.035, -14.5);
    this.scene.add(rug);

    const stand = new THREE.Group();
    const standTop = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.12, 0.7), roomWood);
    standTop.position.y = 0.62;
    const standBody = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.58, 0.62), roomWood);
    standBody.position.y = 0.29;
    stand.add(standTop, standBody); stand.position.set(-5.2, 0, -15.0); this.scene.add(stand);
    this._collide(-5.65, -4.75, -15.4, -14.6);
    const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.42, 7), roomDark);
    lampStem.position.set(-5.2, 0.87, -15.0);
    const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.23, 0.34, 10, 1, true), this._mat(0x2d2830, 0.94));
    lampShade.position.set(-5.2, 1.12, -15.0);
    this.scene.add(lampStem, lampShade);
    const lampGlow = new THREE.PointLight(0x73566f, 0.2, 3.8, 2);
    lampGlow.position.set(-5.2, 1.05, -15.0); this.scene.add(lampGlow);

    const wardrobe = new THREE.Group();
    const wardBody = new THREE.Mesh(new THREE.BoxGeometry(1.55, 2.45, 0.72), roomWood);
    wardBody.position.y = 1.23;
    const wardDoor = new THREE.Mesh(new THREE.BoxGeometry(0.72, 2.22, 0.08), roomDark);
    wardDoor.position.set(-0.34, 1.2, 0.4); wardDoor.rotation.y = -0.24;
    wardrobe.add(wardBody, wardDoor); wardrobe.position.set(4.85, 0, -15.8); this.scene.add(wardrobe);
    this._collide(4.0, 5.7, -16.25, -15.3);

    const chair = new THREE.Group();
    const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.1, 0.72), roomWood);
    chairSeat.position.y = 0.58;
    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.0, 0.1), roomDark);
    chairBack.position.set(0, 1.03, 0.31);
    chair.add(chairSeat, chairBack);
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.58, 0.08), roomWood);
      leg.position.set(sx * 0.27, 0.29, sz * 0.27); chair.add(leg);
    }));
    chair.position.set(2.4, 0, -13.1); chair.rotation.y = -0.7; this.scene.add(chair);
    this._collide(1.95, 2.85, -13.55, -12.65);

    const windowPane = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 1.35),
      new THREE.MeshBasicMaterial({ color: 0x1d2a43, fog: false }),
    );
    windowPane.position.set(0.8, 1.7, -17.82); this.scene.add(windowPane);
    const windowBarV = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.48, 0.06), roomDark);
    windowBarV.position.set(0.8, 1.7, -17.75);
    const windowBarH = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.08, 0.06), roomDark);
    windowBarH.position.set(0.8, 1.7, -17.75);
    this.scene.add(windowBarV, windowBarH);

    const beacon = new THREE.PointLight(0x7fb4ff, 0.32, 5.5, 2);
    beacon.position.set(bx - 0.1, 1.55, bz + 0.25);
    this.scene.add(beacon);
    this._beacon = beacon;
  }

  _buildEntity() {
    const outer = new THREE.Group();
    const built = TW.buildWraith({ pose: 'hunt' });
    outer.add(built.model);
    outer.scale.setScalar(1.1);
    built.eyeGlow.intensity = 0.12;
    built.eyeGlow.distance = 1.8;
    outer.position.copy(this.entityStart);
    this.scene.add(outer);
    this.entity = outer;
    this._entityInner = built.model;
    this._entityRig = built.rig;
  }

  // Five distinct fragments. Their silhouettes and surrounding props identify
  // the encounter; there are no identical quest beacons or sky-high pillars.
  _buildFragments() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(210,235,255,0.9)');
    grad.addColorStop(0.4, 'rgba(140,190,255,0.35)');
    grad.addColorStop(1, 'rgba(120,170,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const glowTex = new THREE.CanvasTexture(cv);

    const geometries = {
      forest: new THREE.IcosahedronGeometry(0.17, 0),
      grave: new THREE.TetrahedronGeometry(0.2, 0),
      water: new THREE.OctahedronGeometry(0.18, 0),
      playground: new THREE.DodecahedronGeometry(0.16, 0),
      body: new THREE.IcosahedronGeometry(0.19, 1),
    };
    const colors = { forest: 0xbcd9d0, grave: 0xc8c2d7, water: 0x93c8e5, playground: 0xc6b5d9, body: 0xd8eaff };

    this._fragDefs.forEach((d, index) => {
      const group = new THREE.Group();
      group.position.set(d.x, 0, d.z);

      const core = new THREE.Mesh(geometries[d.kind], new THREE.MeshBasicMaterial({ color: colors[d.kind], fog: false }));
      core.position.y = d.kind === 'water' ? 0.72 : 1.02;
      group.add(core);

      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: colors[d.kind], transparent: true, opacity: 0.68,
        depthWrite: false, fog: false,
      }));
      halo.scale.set(1.25, 1.25, 1);
      halo.position.y = core.position.y;
      group.add(halo);

      if (d.kind === 'forest') {
        const cage = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.018, 5, 10), this._mat(0x172019, 1));
        cage.position.y = 1.02; cage.rotation.x = Math.PI / 2; group.add(cage);
      } else if (d.kind === 'grave') {
        const marker = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.72, 0.12), this._mat(0x20232a, 1));
        marker.position.set(0, 0.36, 0.24); marker.rotation.z = -0.08; group.add(marker);
      } else if (d.kind === 'water') {
        const reflection = core.clone();
        reflection.position.y = 0.12; reflection.scale.y = -1;
        reflection.material = core.material.clone(); reflection.material.opacity = 0.24; reflection.material.transparent = true;
        group.add(reflection);
      } else if (d.kind === 'playground') {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.012, 5, 16), this._mat(0x26202f, 0.9));
        ring.position.y = 1.02; ring.rotation.y = Math.PI / 2; group.add(ring);
      } else if (d.kind === 'body') {
        const pulse = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.015, 6, 20), new THREE.MeshBasicMaterial({ color: 0x667d9f }));
        pulse.position.y = 1.02; group.add(pulse);
      }

      this.scene.add(group);
      this.fragments.push({ ...d, index, taken: false, group, core, halo });
    });

    // One convincing imitation on the street. Approaching it extinguishes the
    // glow and gives the stalker a chance to take a new flank.
    const falseGroup = new THREE.Group();
    falseGroup.position.set(-7, 0, 62);
    const falseCore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), new THREE.MeshBasicMaterial({ color: 0xbfdfff }));
    falseCore.position.y = 1;
    const falseHalo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0x9fcfff, transparent: true, opacity: 0.62, depthWrite: false,
    }));
    falseHalo.position.y = 1; falseHalo.scale.set(1.2, 1.2, 1);
    falseGroup.add(falseCore, falseHalo);
    this.scene.add(falseGroup);
    this.falseFragments.push({ x: -7, z: 62, sprung: false, group: falseGroup, core: falseCore, halo: falseHalo });
  }

  collectFragment(i) {
    const f = this.fragments[i];
    if (!f || f.taken) return false;
    f.taken = true;
    f.group.visible = false;
    this.fragmentsCollected++;
    return true;
  }

  triggerFragmentEncounter(i, playerPos) {
    const f = this.fragments[i];
    if (!f || f.encountered) return;
    f.encountered = true;
    this._corruptionTarget = this.fragmentsCollected / this.fragmentTotal;
    if (f.kind === 'forest' && this._forestWatchers) {
      this._forestWatchers.forEach((w, n) => { if (n % 2 === 0) w.visible = true; });
    } else if (f.kind === 'grave') {
      this.faceGravesAt(playerPos.x, playerPos.z);
    } else if (f.kind === 'water') {
      if (this._waterHands) this._waterHands.visible = true;
      this._waterWake = 1;
    } else if (f.kind === 'playground') {
      this._swingPossessed = true;
    } else if (f.kind === 'body') {
      this._bodyWakeTarget = 1;
    }
  }

  faceGravesAt(x, z) {
    if (!this._graves || !this._graveData) return;
    const m = new THREE.Matrix4(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    this._graveData.forEach((g, i) => {
      pos.set(g.x, 0.36 * g.sc, g.z);
      scl.set(g.sc, g.sc, g.sc);
      e.set(0, Math.atan2(x - g.x, z - g.z), 0);
      q.setFromEuler(e);
      m.compose(pos, q, scl);
      this._graves.setMatrixAt(i, m);
    });
    this._graves.instanceMatrix.needsUpdate = true;
  }

  springFalseFragment(i) {
    const f = this.falseFragments[i];
    if (!f || f.sprung) return false;
    f.sprung = true;
    f.core.material.color.setHex(0x010204);
    f.halo.material.opacity = 0;
    setTimeout(() => { f.group.visible = false; }, 450);
    return true;
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

  // Route the hunter toward the player through the actual chokepoints
  // (gate → bridge → front door → door A → door B). If it isn't in the
  // player's zone yet it heads for the next choke on the path rather
  // than walking straight into a fence or wall.
  entityTarget(ex, ez, px, pz) {
    const zone = (z) => (z > 100 ? 0 : z > 86 ? 1 : z > 4 ? 2 : z > -4 ? 3 : z > -11 ? 4 : 5);
    // each waypoint sits just PAST its threshold so that reaching it flips
    // the entity into the next zone (otherwise it stalls at the choke)
    const doors = [
      { x: 0,  z: 99.6 },
      { x: 0,  z: 85.6 },
      { x: 0,  z: 3.7 },
      { x: 5,  z: -4.3 },
      { x: -5, z: -11.3 },
    ];
    const e = zone(ez), p = zone(pz);
    if (e === p) return { x: px, z: pz };
    return doors[e < p ? e : e - 1];
  }

  /** slam a chokepoint shut behind the player; returns true if newly sealed */
  sealDoor(i) {
    const d = this._doorways[i];
    if (!d || d.sealed) return false;
    d.sealed = true;
    d.mesh = this._wall(d.x0, d.x1, d.z0, d.z1, this._mat(0x11161f, 0.97));
    d.collider = this.colliders[this.colliders.length - 1];
    return true;
  }

  /** the hunter smashes a sealed chokepoint open again */
  breakDoor(i) {
    const d = this._doorways[i];
    if (!d || !d.sealed || d.broken) return false;
    d.broken = true;
    const idx = this.colliders.indexOf(d.collider);
    if (idx >= 0) this.colliders.splice(idx, 1);
    if (d.mesh) {
      this.scene.remove(d.mesh);
      d.mesh.geometry.dispose();
      d.mesh.material.dispose();
    }
    return true;
  }

  doorCenter(i) { const d = this._doorways[i]; return { x: d.cx, z: d.cz }; }

  setAspect(a) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  update(dt, entityMotion = true) {
    this._t += dt;
    this.corruption += (this._corruptionTarget - this.corruption) * (1 - Math.exp(-dt * 0.45));
    const c = this.corruption;
    this.scene.fog.density = 0.028 + c * 0.012;
    this.scene.background.setRGB(0.047 - c * 0.025, 0.078 - c * 0.038, 0.14 - c * 0.055);
    if (this._moonLight) this._moonLight.intensity = 1.2 - c * 0.52;
    if (this._interiorFills) this._interiorFills.forEach((l) => {
      l.intensity = (l.userData.baseIntensity || 0.3) * (1 - c * 0.38);
    });
    if (this._windowWatchers) {
      this._windowWatchers.forEach((w, i) => { w.visible = c > 0.34 + (i % 3) * 0.14; });
    }
    const whole = this.fragmentsCollected >= this.fragmentTotal;
    if (this._beacon) {
      this._beacon.intensity = whole
        ? 0.45 + Math.sin(this._t * 1.1) * 0.03
        : 0.3 + Math.sin(this._t * 0.8) * 0.03;
    }
    if (entityMotion && this._entityInner) {
      this._entityInner.position.y = Math.sin(this._t * 0.42) * 0.012;
      TW.animateWraith(this._entityRig, this._t, 0.8);
    }
    if (this._sleeper) {
      const breath = Math.sin(this._t * 1.15);
      this._bodyWake = (this._bodyWake || 0) + ((this._bodyWakeTarget || c * 0.38) - (this._bodyWake || 0)) * (1 - Math.exp(-dt * 0.7));
      const wake = this._bodyWake || 0;
      this._sleeper.position.y = breath * 0.002;
      if (this._sleeperChest) this._sleeperChest.scale.y = 1 + breath * 0.018;
      if (this._bodyBlanket) this._bodyBlanket.position.y = breath * 0.006;
      if (this._sleeperHead) {
        this._sleeperHead.position.copy(this._sleeperHeadBasePos);
        this._sleeperHead.position.y += wake * 0.16;
        this._sleeperHead.position.z -= wake * 0.12;
        this._sleeperHead.rotation.x = this._sleeperHeadBaseRot.x - wake * 0.34;
        this._sleeperHead.rotation.y = this._sleeperHeadBaseRot.y + wake * 0.46;
        this._sleeperHead.rotation.z = breath * 0.004 + wake * 0.06;
      }
      if (this._sleeperEyes) this._sleeperEyes.forEach((eye) => { eye.visible = wake > 0.72; });
      if (this._sleeperChest) this._sleeperChest.rotation.x = -wake * 0.11;
    }

    // uncollected shards bob, spin and breathe
    for (let i = 0; i < this.fragments.length; i++) {
      const f = this.fragments[i];
      if (f.taken) continue;
      const y = 1.1 + Math.sin(this._t * 1.4 + i * 2.1) * 0.14;
      f.core.position.y = y;
      f.halo.position.y = y;
      f.core.rotation.y += dt * 1.1;
      f.core.rotation.x += dt * 0.6;
      f.halo.material.opacity = 0.65 + Math.sin(this._t * 2.3 + i) * 0.2;
    }
    for (let i = 0; i < this.falseFragments.length; i++) {
      const f = this.falseFragments[i];
      if (f.sprung) continue;
      const y = 1 + Math.sin(this._t * 1.35 + 0.7) * 0.12;
      f.core.position.y = y; f.halo.position.y = y;
      f.core.rotation.y += dt * 0.9;
    }

    // spirit-wisps drift
    if (this._wisps) {
      const pos = this._wisps.geometry.attributes.position;
      const arr = pos.array, base = this._wispBase;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i]     = base[i] + Math.sin(this._t * 0.23 + i) * 1.1;
        arr[i + 1] = base[i + 1] + Math.sin(this._t * 0.6 + i * 1.7) * 0.32;
      }
      pos.needsUpdate = true;
    }

    // After its fragment is taken, the first swing stops and the untouched
    // second swing begins moving much harder.
    if (this._swing) {
      this._swing.rotation.x = this._swingPossessed
        ? Math.sin(this._t * 0.45) * 0.045
        : Math.sin(this._t * 0.85) * 0.32;
    }
    if (this._swingOther && this._swingPossessed) {
      this._swingOther.rotation.x = Math.sin(this._t * 1.42 + 1.1) * 0.62;
    }
    if (this._waterHands && this._waterHands.visible) {
      this._waterHands.position.y += (0.48 - this._waterHands.position.y) * (1 - Math.exp(-dt * 0.7));
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
})();
