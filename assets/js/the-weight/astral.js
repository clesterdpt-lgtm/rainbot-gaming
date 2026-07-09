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
      { x: 7,    z: 138 },    // the forest clearing
      { x: -8,   z: 108 },    // among the graves
      { x: 6,    z: 92 },     // the creek bank
      { x: 11.5, z: 40 },     // the playground
      { x: 3,    z: -7.5 },   // the middle room
    ];
    this.fragments = [];
    this.fragmentTotal = this._fragDefs.length;
    this.fragmentsCollected = 0;

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
    // interior fills so the rooms read (one per room + hall)
    const fills = [[0, 1], [3, -7], [-3, -14.5], [-5, -7]];
    fills.forEach(([x, z]) => {
      const pl = new THREE.PointLight(0x6b7fae, 0.6, 13, 2);
      pl.position.set(x, 2.4, z);
      this.scene.add(pl);
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
    mkSwing(0.8).rotation.x = 0.06;
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
        this._collide(gx - 0.3, gx + 0.3, gz - 0.22, gz + 0.22);
      }
    }
    graves.count = i;
    graves.instanceMatrix.needsUpdate = true;
    this.scene.add(graves);

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
  _buildBody() {
    const bx = this.bodyPosition.x, bz = this.bodyPosition.z;
    const frame = this._mat(0x12100c, 0.9);
    const sheet = this._mat(0x232a36, 0.9, 0x1a2436, 0.15);

    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 2.4), frame);
    base.position.set(bx, 0.27, bz);
    this.scene.add(base);
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.2, 2.3), sheet);
    mattress.position.set(bx, 0.6, bz);
    this.scene.add(mattress);

    // the sleeping figure (faintly lit — a beacon): pale hair spread on the
    // pillow, face up, shoulders in a white gown, one arm over the blanket,
    // the rest a single continuous shape under the covers
    const skin = this._mat(0x6f7788, 0.75, 0x222c44, 0.3);
    const gown = this._mat(0x7e8aa2, 0.8, 0x2c3852, 0.35);
    const hair = this._mat(0x8f96a8, 0.85, 0x303950, 0.25);

    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.09, 0.42), this._mat(0x2b3140, 0.9));
    pillow.position.set(bx, 0.74, bz + 0.92);
    this.scene.add(pillow);

    // hair spread in a soft disk on the pillow, two strands trailing down
    const hairFan = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.045, 14), hair);
    hairFan.position.set(bx, 0.8, bz + 0.94);
    this.scene.add(hairFan);
    [-0.13, 0.13].forEach((dx) => {
      const strand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.025, 0.34), hair);
      strand.rotation.y = dx > 0 ? -0.25 : 0.25;
      strand.position.set(bx + dx, 0.79, bz + 0.7);
      this.scene.add(strand);
    });

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 12), skin);
    head.scale.set(0.92, 0.78, 1.08);
    head.position.set(bx, 0.87, bz + 0.9);
    this.scene.add(head);

    // gowned shoulders — a smooth mound above the blanket's edge
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), gown);
    shoulders.scale.set(1.9, 0.5, 0.8);
    shoulders.position.set(bx, 0.73, bz + 0.6);
    this.scene.add(shoulders);

    // the body under the covers: one continuous smooth mound, chest to knees,
    // with a smaller mound for the feet — no hard edges anywhere
    const bodyMound = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), sheet);
    bodyMound.scale.set(1.05, 0.42, 2.3);
    bodyMound.position.set(bx, 0.7, bz - 0.05);
    this.scene.add(bodyMound);
    const feet = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), sheet);
    feet.scale.set(1.1, 0.55, 1.0);
    feet.position.set(bx, 0.69, bz - 0.88);
    this.scene.add(feet);

    // an arm in a white sleeve resting on top of the covers
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.46, 8), gown);
    arm.rotation.set(Math.PI / 2 - 0.04, 0, 0.09);
    arm.position.set(bx - 0.24, 0.78, bz + 0.3);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), skin);
    hand.scale.set(0.9, 0.55, 1.25);
    hand.position.set(bx - 0.27, 0.77, bz + 0.06);
    this.scene.add(arm, hand);

    // soft beacon glow above the body — flares once the soul is whole
    const beacon = new THREE.PointLight(0x7fbfff, 0.9, 7, 2);
    beacon.position.set(bx, 1.7, bz);
    this.scene.add(beacon);
    this._beacon = beacon;
  }

  _buildEntity() {
    const outer = new THREE.Group();
    const built = TW.buildWraith();
    outer.add(built.model);
    built.eyeGlow.intensity = 0.6;
    built.eyeGlow.distance = 3.5;
    outer.position.copy(this.entityStart);
    this.scene.add(outer);
    this.entity = outer;
    this._entityInner = built.model;
  }

  // the five shards of the shattered soul, each under a pillar of light
  _buildFragments() {
    // shared soft-glow sprite texture
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

    const coreGeo = new THREE.IcosahedronGeometry(0.16, 0);
    const pillarGeo = new THREE.CylinderGeometry(0.32, 0.42, 10, 10, 1, true);

    this._fragDefs.forEach((d) => {
      const group = new THREE.Group();
      group.position.set(d.x, 0, d.z);

      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xcfeaff, fog: false }));
      core.position.y = 1.1;
      group.add(core);

      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0x9fd4ff, transparent: true, opacity: 0.85,
        depthWrite: false, fog: false,
      }));
      halo.scale.set(1.7, 1.7, 1);
      halo.position.y = 1.1;
      group.add(halo);

      // the guiding pillar of light, readable from far across the fog
      const pillar = new THREE.Mesh(pillarGeo, new THREE.MeshBasicMaterial({
        color: 0x6fa8e8, transparent: true, opacity: 0.13, fog: false,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      pillar.position.y = 5;
      group.add(pillar);

      this.scene.add(group);
      this.fragments.push({ x: d.x, z: d.z, taken: false, group, core, halo });
    });
  }

  collectFragment(i) {
    const f = this.fragments[i];
    if (!f || f.taken) return false;
    f.taken = true;
    f.group.visible = false;
    this.fragmentsCollected++;
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

  update(dt) {
    this._t += dt;
    const whole = this.fragmentsCollected >= this.fragmentTotal;
    if (this._beacon) {
      this._beacon.intensity = whole
        ? 1.8 + Math.sin(this._t * 3.2) * 0.5
        : 0.5 + Math.sin(this._t * 1.6) * 0.15;
    }
    if (this._entityInner) this._entityInner.position.y = Math.sin(this._t * 2.2) * 0.04;

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

    // the empty swing rocks by itself
    if (this._swing) this._swing.rotation.x = Math.sin(this._t * 0.85) * 0.32;
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
