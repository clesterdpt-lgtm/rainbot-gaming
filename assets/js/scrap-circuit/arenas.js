/* ============================================================
   SCRAP CIRCUIT — arena factories
   ------------------------------------------------------------
   Six original arenas. Each factory returns a self-contained
   arena object; adding a new arena later means adding a factory
   here and a roster entry at the bottom — vehicle/combat code
   never changes.

   Arena contract (consumed by main.js):
   - group           THREE.Group of all meshes
   - sky, fog        clear color + {color, near, far}
   - hemi, sun       light params
   - bounds          {hw, hd} half-extents (perimeter walls auto-added)
   - colliders       [{x,z,hw,hd,base,top}] static AABBs
   - heights         [{type:'rect',x,z,hw,hd,y} |
                      {type:'ramp',x,z,hw,hd,axis:'x'|'z',y0,y1}]
                     sampled for ground height (ramps lerp along axis)
   - slowZones       [{x,z,hw,hd,factor}] pools/sand
   - fallZones       [{x,z,hw,hd}] abyss: wreck damage + respawn
   - destructibles   [{mesh,x,z,hw,hd,hp,explosive,score}]
   - pickupSpots     [{x,z}] weapon pad locations
   - spawns          [{x,z,h}] 6+ start slots
   - minimap         [{x,z,hw,hd,color}] rough top-down blocks
   - update(dt,ctx)  scripted hazards; ctx = {time, cars, applyDamage,
                     impulse, boom, announce}
   ============================================================ */
(() => {
  "use strict";
  const SCRAP = (window.SCRAP = window.SCRAP || {});
  const T = () => SCRAP.textures;

  // ---------- shared kit ----------
  function baseArena(opts) {
    return {
      id: opts.id,
      name: opts.name,
      tagline: opts.tagline,
      sky: opts.sky,
      fog: opts.fog,
      hemi: opts.hemi,
      sun: opts.sun,
      bounds: opts.bounds,
      group: new THREE.Group(),
      colliders: [],
      heights: [],
      slowZones: [],
      fallZones: [],
      destructibles: [],
      pickupSpots: [],
      spawns: [],
      minimap: [],
      update() {},
    };
  }

  function mesh(a, geo, material, x, y, z, ry = 0) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    a.group.add(m);
    return m;
  }

  function box(a, w, h, d, material, x, y, z, ry = 0) {
    return mesh(a, new THREE.BoxGeometry(w, h, d), material, x, y, z, ry);
  }

  /* Solid block: mesh + collider (+ minimap chip). */
  function block(a, w, h, d, material, x, z, opts = {}) {
    const m = box(a, w, h, d, material, x, (opts.base || 0) + h / 2, z, opts.ry || 0);
    a.colliders.push({ x, z, hw: w / 2, hd: d / 2, base: opts.base || 0, top: (opts.base || 0) + h });
    if (opts.map) a.minimap.push({ x, z, hw: w / 2, hd: d / 2, color: opts.map });
    return m;
  }

  /* Drivable elevated slab (adds height rect, no side colliders). */
  function deck(a, w, d, y, material, x, z, thickness = 0.6) {
    const m = box(a, w, thickness, d, material, x, y - thickness / 2, z);
    a.heights.push({ type: "rect", x, z, hw: w / 2, hd: d / 2, y });
    return m;
  }

  /* Drivable ramp: slanted slab + lerped height entry. axis 'z': y0 at
     -hd edge -> y1 at +hd edge. axis 'x': y0 at -hw -> y1 at +hw. */
  function ramp(a, w, len, y0, y1, axis, material, x, z) {
    const rise = y1 - y0;
    const slope = Math.atan2(rise, len);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(axis === "z" ? w : len / Math.cos(slope), 0.5, axis === "z" ? len / Math.cos(slope) : w), material);
    slab.position.set(x, (y0 + y1) / 2 - 0.25, z);
    if (axis === "z") slab.rotation.x = -slope;
    else slab.rotation.z = slope;
    a.group.add(slab);
    a.heights.push({
      type: "ramp",
      x, z,
      hw: axis === "z" ? w / 2 : len / 2,
      hd: axis === "z" ? len / 2 : w / 2,
      axis, y0, y1,
    });
    return slab;
  }

  function rail(a, w, d, material, x, z, base, h = 1.0) {
    box(a, w, h, d, material, x, base + h / 2, z);
    a.colliders.push({ x, z, hw: w / 2, hd: d / 2, base, top: base + h });
  }

  function destructible(a, m, x, z, hw, hd, hp, opts = {}) {
    a.destructibles.push({
      mesh: m, x, z, hw, hd, hp,
      explosive: !!opts.explosive,
      score: opts.score || 25,
      alive: true,
    });
  }

  function perimeter(a, material, h = 3) {
    const { hw, hd } = a.bounds;
    const t = 2;
    [[0, -hd - t / 2, hw + t, t / 2], [0, hd + t / 2, hw + t, t / 2],
     [-hw - t / 2, 0, t / 2, hd + t], [hw + t / 2, 0, t / 2, hd + t]].forEach(([x, z, whw, whd]) => {
      box(a, whw * 2, h, whd * 2, material, x, h / 2, z);
      a.colliders.push({ x, z, hw: whw, hd: whd, base: 0, top: h });
    });
  }

  function ground(a, material, y = 0) {
    const g = new THREE.PlaneGeometry(a.bounds.hw * 2 + 8, a.bounds.hd * 2 + 8);
    const m = new THREE.Mesh(g, material);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    a.group.add(m);
    return m;
  }

  function stableOverlay(material) {
    material.depthWrite = false;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -4;
    material.polygonOffsetUnits = -4;
    return material;
  }

  function flatOverlay(a, w, d, material, x, y, z, renderOrder = 2) {
    const m = mesh(a, new THREE.PlaneGeometry(w, d), material, x, y, z);
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = renderOrder;
    return m;
  }

  function flatDisk(a, radius, material, x, y, z, renderOrder = 3, segments = 32) {
    const m = mesh(a, new THREE.CircleGeometry(radius, segments), material, x, y, z);
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = renderOrder;
    return m;
  }

  function tree(a, x, z, trunkMat, leafMat, s = 1) {
    mesh(a, new THREE.CylinderGeometry(0.22 * s, 0.3 * s, 1.6 * s, 5), trunkMat, x, 0.8 * s, z);
    mesh(a, new THREE.ConeGeometry(1.3 * s, 2.6 * s, 6), leafMat, x, 2.8 * s, z);
    a.colliders.push({ x, z, hw: 0.4 * s, hd: 0.4 * s, base: 0, top: 2 * s });
  }

  function barrel(a, x, z, material) {
    const m = mesh(a, new THREE.CylinderGeometry(0.55, 0.55, 1.15, 8), material, x, 0.58, z);
    destructible(a, m, x, z, 0.6, 0.6, 12, { explosive: true, score: 40 });
  }

  function ring(count, radius, fn) {
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      fn(Math.cos(angle) * radius, Math.sin(angle) * radius, angle, i);
    }
  }

  function spawnCircle(a, radius, count = 6) {
    ring(count, radius, (x, z) => {
      a.spawns.push({ x, z, h: Math.atan2(-x, -z) });
    });
  }

  function scatterPickups(a, spots) {
    spots.forEach(([x, z]) => a.pickupSpots.push({ x, z }));
  }

  // ============================================================
  // 1. CUL-DE-SAC FLATS — suburbia at dusk
  // ============================================================
  function buildSuburb() {
    const a = baseArena({
      id: "suburb",
      name: "Cul-de-Sac Flats",
      tagline: "Every lawn is a liability.",
      sky: 0xc97747,
      fog: { color: 0xc97747, near: 55, far: 185 },
      hemi: { sky: 0xffc48a, ground: 0x54382e, intensity: 0.85 },
      sun: { color: 0xffb066, intensity: 0.9, x: -60, y: 70, z: 30 },
      bounds: { hw: 95, hd: 95 },
    });
    const road = T().mat("arena.suburb.road", { color: 0x4a4a52 });
    const flatRoad = stableOverlay(T().mat("arena.suburb.road", { color: 0x4a4a52 }));
    const grass = T().mat("arena.suburb.grass", { color: 0x6d8f3f });
    const wallA = T().mat("arena.suburb.house_wall_a", { color: 0xd8c9a8 });
    const wallB = T().mat("arena.suburb.house_wall_b", { color: 0xb7cbd6 });
    const roof = T().mat("arena.suburb.roof", { color: 0x8a4632 });
    const fenceM = T().mat("prop.fence", { color: 0xe3ded1 });
    const water = stableOverlay(T().mat("arena.suburb.pool", { color: 0x3fa7c9 }));
    const trunk = T().mat("arena.shared.trunk", { color: 0x6b4a2e });
    const leaf = T().mat("arena.shared.leaf", { color: 0x4f7a33 });
    const drum = T().mat("prop.barrel", { color: 0xc9452e });

    ground(a, grass);
    // Cross streets + central circle. The arms stop at the circle edge so no
    // road meshes fight each other or the grass plane while the camera moves.
    const roadRadius = 26;
    const roadOuter = 78;
    const roadWidth = 14;
    const roadArmLen = roadOuter - roadRadius;
    const roadArmCenter = roadRadius + roadArmLen / 2;
    [
      [0, -roadArmCenter, roadWidth, roadArmLen, roadWidth / 2, roadArmLen / 2],
      [0, roadArmCenter, roadWidth, roadArmLen, roadWidth / 2, roadArmLen / 2],
      [-roadArmCenter, 0, roadArmLen, roadWidth, roadArmLen / 2, roadWidth / 2],
      [roadArmCenter, 0, roadArmLen, roadWidth, roadArmLen / 2, roadWidth / 2],
    ].forEach(([x, z, w, d, hw, hd]) => {
      flatOverlay(a, w, d, flatRoad, x, 0.095, z, 2);
      a.minimap.push({ x, z, hw, hd, color: "#4a4a52" });
    });
    flatDisk(a, roadRadius, flatRoad, 0, 0.115, 0, 3, 36); // cul-de-sac circle
    a.minimap.push({ x: 0, z: 0, hw: roadRadius, hd: roadRadius, color: "#4a4a52" });

    // Houses in the four quads; one has a drive-through garage shortcut,
    // one carries the roof ramp jump.
    const houseSpots = [
      [-52, -52, wallA], [-18, -60, wallB], [52, -48, wallA], [60, -14, wallB],
      [52, 52, wallB], [16, 60, wallA], [-52, 48, wallB], [-62, 12, wallA],
    ];
    houseSpots.forEach(([x, z, m], i) => {
      if (i === 2) {
        // Garage shortcut house: two wings with a drivable gap.
        block(a, 6, 5, 14, m, x - 6, z, { map: "#8a6f57" });
        block(a, 6, 5, 14, m, x + 6, z, { map: "#8a6f57" });
        box(a, 18, 0.6, 14, roof, x, 5.4, z); // roof spans the gap
        return;
      }
      block(a, 13, 4.6, 11, m, x, z, { map: "#8a6f57" });
      mesh(a, new THREE.ConeGeometry(9.4, 3.4, 4), roof, x, 6.3, z, Math.PI / 4);
    });
    // Roof-ramp house: drive up and over. Visual body only — colliders are
    // just the two long side walls so the ramps on the ±z ends stay open
    // (a full block collider would wall the car off from its own roof).
    box(a, 14, 5.2, 12, wallA, 0, 2.6, -62);
    a.minimap.push({ x: 0, z: -62, hw: 7, hd: 6, color: "#8a6f57" });
    a.heights.push({ type: "rect", x: 0, z: -62, hw: 7, hd: 6, y: 5.2 });
    a.colliders.push({ x: -6.7, z: -62, hw: 0.4, hd: 6, base: 0, top: 5.2 });
    a.colliders.push({ x: 6.7, z: -62, hw: 0.4, hd: 6, base: 0, top: 5.2 });
    ramp(a, 8, 14, 0, 5.2, "z", road, 0, -75);
    ramp(a, 8, 14, 5.2, 0, "z", road, 0, -49);

    // Backyard pools (slow + splash), picket fences, grills, trees.
    [[-34, 30, 9, 6], [38, -28, 8, 7]].forEach(([x, z, hw, hd]) => {
      flatOverlay(a, hw * 2, hd * 2, water, x, 0.12, z, 4);
      a.slowZones.push({ x, z, hw, hd, factor: 0.55 });
      a.minimap.push({ x, z, hw, hd, color: "#3fa7c9" });
    });
    for (let i = 0; i < 14; i += 1) {
      const x = -70 + i * 10.5;
      const m = box(a, 3.6, 1.1, 0.3, fenceM, x, 0.56, 24 + ((i % 3) - 1) * 1.5);
      destructible(a, m, x, m.position.z, 1.9, 0.5, 6, { score: 10 });
    }
    [[-26, -14], [30, 18], [12, -30], [-40, -34], [48, 30]].forEach(([x, z]) => barrel(a, x, z, drum));
    [[-70, -20], [-24, 68], [70, 40], [24, -70], [70, -66], [-70, 66]].forEach(([x, z]) => tree(a, x, z, trunk, leaf, 1.3));

    perimeter(a, fenceM);
    spawnCircle(a, 60);
    scatterPickups(a, [[0, 0], [-34, 30], [38, -28], [0, -62], [-52, 0], [52, 0], [0, 52], [-20, -40], [30, 44], [64, -40], [-64, -52], [20, 20]]);
    return a;
  }

  // ============================================================
  // 2. CRUSH DEPOT — junkyard / warehouse sprawl
  // ============================================================
  function buildJunkyard() {
    const a = baseArena({
      id: "junkyard",
      name: "Crush Depot",
      tagline: "Everything must go. Violently.",
      sky: 0x8a8d92,
      fog: { color: 0x8a8d92, near: 45, far: 165 },
      hemi: { sky: 0xb9bec4, ground: 0x3c3a36, intensity: 0.8 },
      sun: { color: 0xd9dde2, intensity: 0.75, x: 40, y: 80, z: -20 },
      bounds: { hw: 100, hd: 90 },
    });
    const dirt = T().mat("arena.junkyard.dirt", { color: 0x6f6250 });
    const container = T().mat("arena.junkyard.container", { color: 0xa8452e });
    const container2 = T().mat("arena.junkyard.container_b", { color: 0x3f6f8a });
    const wh = T().mat("arena.junkyard.warehouse", { color: 0x7d7f83 });
    const scrap = T().mat("arena.junkyard.scrap", { color: 0x5c5147 });
    const crushM = T().mat("arena.junkyard.crusher", { color: 0xb08a20 });
    const drum = T().mat("prop.barrel", { color: 0xc9452e });

    ground(a, dirt);
    // Warehouse with two open drive-through doors (three wall segments).
    block(a, 12, 9, 3, wh, -54, -60, { map: "#7d7f83" });
    block(a, 12, 9, 3, wh, -22, -60, { map: "#7d7f83" });
    block(a, 8, 9, 3, wh, -84, -60, { map: "#7d7f83" });
    box(a, 74, 0.8, 34, wh, -51, 9.2, -74); // warehouse roof slab (visual)
    block(a, 3, 9, 30, wh, -87, -76);
    block(a, 3, 9, 30, wh, -15, -76);

    // Container stacks + catwalk ring (drivable containers).
    const stacks = [[30, -50, 0], [52, -50, 0], [52, -28, Math.PI / 2], [-40, 40, 0], [-62, 40, 0], [64, 52, Math.PI / 2]];
    stacks.forEach(([x, z, ry], i) => {
      block(a, 14, 3.4, 5.4, i % 2 ? container : container2, x, z, { ry, map: "#a8452e" });
    });
    // Drivable container catwalk: two ramps up to a raised run.
    deck(a, 40, 6, 3.4, container, 20, 20);
    ramp(a, 6, 12, 0, 3.4, "x", scrap, -6, 20);
    ramp(a, 6, 12, 3.4, 0, "x", scrap, 46, 20);
    a.minimap.push({ x: 20, z: 20, hw: 20, hd: 3, color: "#a8452e" });

    // Scrap mounds (colliders), tire piles, barrels everywhere.
    [[-20, -20, 7], [70, -8, 6], [-70, -20, 8], [8, 62, 7], [76, 24, 5]].forEach(([x, z, r]) => {
      mesh(a, new THREE.ConeGeometry(r, r * 0.9, 7), scrap, x, r * 0.4, z);
      a.colliders.push({ x, z, hw: r * 0.6, hd: r * 0.6, base: 0, top: r * 0.8 });
      a.minimap.push({ x, z, hw: r * 0.6, hd: r * 0.6, color: "#5c5147" });
    });
    [[-44, 8], [10, -38], [40, 8], [-8, 40], [58, 70], [-76, 64], [30, -70]].forEach(([x, z]) => barrel(a, x, z, drum));

    // THE CRUSHER — hydraulic press over a bait pit lined with pickups.
    const crusherX = 0, crusherZ = -20;
    block(a, 2.5, 10, 8, crushM, crusherX - 7, crusherZ);
    block(a, 2.5, 10, 8, crushM, crusherX + 7, crusherZ);
    box(a, 16.5, 1.4, 8, crushM, crusherX, 10, crusherZ);
    const press = box(a, 11.5, 2.4, 7, scrap, crusherX, 7, crusherZ);
    a.minimap.push({ x: crusherX, z: crusherZ, hw: 8, hd: 4, color: "#b08a20" });
    let crushT = 0;
    a.update = (dt, ctx) => {
      crushT += dt;
      const cycle = crushT % 4.2;
      // hold high 0..2.4, slam 2.4..2.7, hold low, rise
      let y;
      if (cycle < 2.4) y = 7;
      else if (cycle < 2.7) y = 7 - ((cycle - 2.4) / 0.3) * 5.4;
      else if (cycle < 3.4) y = 1.6;
      else y = 1.6 + ((cycle - 3.4) / 0.8) * 5.4;
      press.position.y = y;
      if (cycle >= 2.4 && cycle < 2.75) {
        ctx.cars.forEach((car) => {
          if (car.wrecked || car.y > 3) return;
          if (Math.abs(car.x - crusherX) < 5.7 && Math.abs(car.z - crusherZ) < 3.5) {
            ctx.applyDamage(car, 55, { type: "crusher" });
            ctx.impulse(car, (car.x - crusherX) * 2, (car.z - crusherZ) * 4, 0.5);
            if (car.isPlayer) ctx.announce("crusher");
          }
        });
      }
    };
    a.pickupSpots.push({ x: crusherX, z: crusherZ }); // bait

    perimeter(a, wh, 4);
    spawnCircle(a, 62);
    scatterPickups(a, [[20, 20], [-51, -40], [30, -30], [-30, 60], [70, -40], [-80, 20], [0, 76], [80, 76], [-80, -40], [46, 44]]);
    return a;
  }

  // ============================================================
  // 3. THE MIXING BOWL — stacked highway interchange
  // ============================================================
  function buildInterchange() {
    const a = baseArena({
      id: "interchange",
      name: "The Mixing Bowl",
      tagline: "Merge or be merged.",
      sky: 0xb3a284,
      fog: { color: 0xb3a284, near: 50, far: 180 },
      hemi: { sky: 0xd8cbae, ground: 0x4a443a, intensity: 0.8 },
      sun: { color: 0xffe2b0, intensity: 0.8, x: 30, y: 90, z: 40 },
      bounds: { hw: 105, hd: 105 },
    });
    const asphalt = T().mat("arena.highway.asphalt", { color: 0x53535b });
    const concrete = T().mat("arena.highway.concrete", { color: 0x9a948a });
    const railM = T().mat("arena.highway.rail", { color: 0xb8b2a4 });
    const coneM = T().mat("arena.highway.cone", { color: 0xe8762e });
    const truckM = T().mat("arena.highway.truck", { color: 0xd8d2c4 });

    ground(a, asphalt);
    a.minimap.push({ x: 0, z: 0, hw: 100, hd: 100, color: "#53535b" });

    // DECK A: elevated ring (y=6) — four straights + corner pads.
    const R = 52, W = 14, y1 = 6;
    deck(a, R * 2 + W, W, y1, concrete, 0, -R);
    deck(a, R * 2 + W, W, y1, concrete, 0, R);
    deck(a, W, R * 2 - W, y1, concrete, -R, 0);
    deck(a, W, R * 2 - W, y1, concrete, R, 0);
    a.minimap.push({ x: 0, z: -R, hw: R + W / 2, hd: W / 2, color: "#9a948a" });
    a.minimap.push({ x: 0, z: R, hw: R + W / 2, hd: W / 2, color: "#9a948a" });
    a.minimap.push({ x: -R, z: 0, hw: W / 2, hd: R - W / 2, color: "#9a948a" });
    a.minimap.push({ x: R, z: 0, hw: W / 2, hd: R - W / 2, color: "#9a948a" });
    // Pillars under the ring.
    ring(12, R, (x, z) => {
      mesh(a, new THREE.CylinderGeometry(1.4, 1.6, y1, 7), concrete, x, y1 / 2, z);
      a.colliders.push({ x, z, hw: 1.6, hd: 1.6, base: 0, top: y1 - 0.7 });
    });
    // On/off ramps: four straight approaches from the infield up to deck A.
    // (high end touches the straight's inner edge, low end faces the infield)
    ramp(a, 10, 24, y1, 0, "z", asphalt, 26, -R + W / 2 + 12);  // north straight <-> infield
    ramp(a, 10, 24, 0, y1, "z", asphalt, -26, R - W / 2 - 12);  // infield <-> south straight
    ramp(a, 10, 24, y1, 0, "x", asphalt, -R + W / 2 + 12, 26);  // west straight <-> infield
    ramp(a, 10, 24, 0, y1, "x", asphalt, R - W / 2 - 12, -26);  // infield <-> east straight

    // DECK B: overpass (y=12) crossing the middle, ramps meeting deck A
    // where it crosses the north/south straights.
    deck(a, 12, R * 2 - W - 40, 12, concrete, 0, 0, 0.8);
    a.minimap.push({ x: 0, z: 0, hw: 6, hd: R - W / 2 - 20, color: "#b8b2a4" });
    ramp(a, 10, 20, y1, 12, "z", concrete, 0, -(R - W / 2 - 20) - 10); // from north straight up
    ramp(a, 10, 20, 12, y1, "z", concrete, 0, (R - W / 2 - 20) + 10);  // down to south straight

    // Guardrails with deliberate gaps (fall off the edge!).
    // Guardrails ONLY on the outer (fall-off) edges of the ring straights —
    // the inner edges are where the infield ramps connect, so railing them
    // would wall the ramps off from the deck.
    [-R - W / 2, R + W / 2].forEach((zEdge) => {
      [-30, 30].forEach((x) => rail(a, 34, 0.6, railM, x, zEdge, y1, 1));
    });
    [-R - W / 2, R + W / 2].forEach((xEdge) => {
      [-26, 26].forEach((z) => rail(a, 0.6, 30, railM, xEdge, z, y1, 1));
    });
    // Overpass side rails (flank the y=6->12 ramps at x=0, don't block them).
    [-6.3, 6.3].forEach((x) => { rail(a, 0.6, 46, railM, x, -29, 12, 1); rail(a, 0.6, 46, railM, x, 29, 12, 1); });

    // Cone work zones + barrels at ground level.
    [[-20, -70], [26, 64], [-70, 30]].forEach(([cx, cz]) => {
      for (let i = 0; i < 4; i += 1) {
        const m = mesh(a, new THREE.ConeGeometry(0.5, 1.2, 6), coneM, cx + i * 2.2, 0.6, cz + (i % 2) * 2);
        destructible(a, m, m.position.x, m.position.z, 0.5, 0.5, 3, { score: 5 });
      }
    });

    // HAZARD TRAFFIC: two phantom freight trucks loop deck A forever.
    const trucks = [];
    for (let i = 0; i < 2; i += 1) {
      const t = new THREE.Group();
      const bodyBox = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.4, 8.5), truckM);
      bodyBox.position.y = 2.4;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.0, 2.0), coneM);
      cab.position.set(0, 1.6, 5.0);
      t.add(bodyBox, cab);
      a.group.add(t);
      trucks.push({ mesh: t, angle: i * Math.PI });
    }
    a.update = (dt, ctx) => {
      trucks.forEach((truck) => {
        truck.angle += dt * 0.16;
        // Square-ish path along the ring centerline.
        const ang = truck.angle % (Math.PI * 2);
        const px = Math.cos(ang), pz = Math.sin(ang);
        const mx = Math.max(Math.abs(px), Math.abs(pz));
        const x = (px / mx) * R, z = (pz / mx) * R;
        const prev = truck.mesh.position.clone();
        truck.mesh.position.set(x, y1, z);
        truck.mesh.lookAt(x + (x - prev.x), y1, z + (z - prev.z));
        ctx.cars.forEach((car) => {
          if (car.wrecked || Math.abs(car.y - y1) > 2.5) return;
          if (Math.abs(car.x - x) < 3.4 && Math.abs(car.z - z) < 5.4) {
            ctx.applyDamage(car, 30, { type: "traffic" });
            ctx.impulse(car, car.x - x, car.z - z, 6);
            if (car.isPlayer) ctx.announce("traffic");
          }
        });
      });
    };

    perimeter(a, railM, 4);
    spawnCircle(a, 78);
    scatterPickups(a, [[0, -R], [0, R], [-R, 0], [R, 0], [0, 0], [-70, -70], [70, 70], [70, -70], [-70, 70], [0, -70], [0, 70], [-40, 40]]);
    return a;
  }

  // ============================================================
  // 4. PIER PRESSURE — seaside boardwalk carnival
  // ============================================================
  function buildBoardwalk() {
    const a = baseArena({
      id: "boardwalk",
      name: "Pier Pressure",
      tagline: "Fun is mandatory. Survival is extra.",
      sky: 0x5e3f8f,
      fog: { color: 0x6a4a9e, near: 45, far: 170 },
      hemi: { sky: 0xb08ae0, ground: 0x2e2440, intensity: 0.9 },
      sun: { color: 0xffa8d0, intensity: 0.7, x: -50, y: 60, z: -40 },
      bounds: { hw: 100, hd: 85 },
    });
    const planks = T().mat("arena.boardwalk.planks", { color: 0x9a6f42 });
    const tent = T().mat("arena.boardwalk.tent", { color: 0xd23f6e });
    const tentB = T().mat("arena.boardwalk.tent_b", { color: 0xe8b52e });
    const track = T().mat("arena.boardwalk.track", { color: 0xd8d2c8 });
    const sea = T().mat("arena.boardwalk.sea", { color: 0x264a6e });
    const fun = T().mat("arena.boardwalk.funhouse", { color: 0x8a2ec9 });
    const neon = T().basicMat("arena.boardwalk.neon", { color: 0xff5ea8 });

    ground(a, planks);
    // "Sea" strip along south edge — slow sludge if you drive in.
    mesh(a, new THREE.PlaneGeometry(210, 26), sea, 0, 0.04, 84);
    a.slowZones.push({ x: 0, z: 84, hw: 105, hd: 13, factor: 0.4 });
    a.minimap.push({ x: 0, z: 80, hw: 100, hd: 6, color: "#264a6e" });

    // Ferris wheel landmark (spins, pure landmark + collider hub).
    const wheelG = new THREE.Group();
    ring(8, 9, (x, y) => {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), tentB);
      pod.position.set(x, y, 0);
      wheelG.add(pod);
    });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(9, 0.4, 5, 18), track);
    wheelG.add(rim);
    wheelG.position.set(-70, 12, -55);
    a.group.add(wheelG);
    mesh(a, new THREE.CylinderGeometry(0.9, 1.4, 12, 6), track, -70, 6, -55);
    a.colliders.push({ x: -70, z: -55, hw: 2, hd: 2, base: 0, top: 6 });
    a.minimap.push({ x: -70, z: -55, hw: 6, hd: 6, color: "#e8b52e" });

    // Funhouse mini-zone: neon box with two mouth doors, mirror pillars inside.
    block(a, 3, 7, 16, fun, 40, -58, { map: "#8a2ec9" });
    block(a, 3, 7, 16, fun, 68, -58, { map: "#8a2ec9" });
    block(a, 31, 7, 3, fun, 54, -67.5);
    box(a, 31, 1, 22, fun, 54, 7.4, -57.5); // roof
    box(a, 10, 1.4, 0.4, neon, 54, 8.4, -49.6); // marquee
    [[48, -58], [60, -54], [54, -62]].forEach(([x, z]) => {
      mesh(a, new THREE.BoxGeometry(1.2, 5, 1.2), neon, x, 2.5, z);
      a.colliders.push({ x, z, hw: 0.8, hd: 0.8, base: 0, top: 5 });
    });

    // COASTER: elevated figure-loop shortcut with a live train hazard.
    const cy = 5;
    deck(a, 70, 9, cy, track, -10, -20);
    deck(a, 9, 40, cy, track, -41, 0);
    deck(a, 70, 9, cy, track, -10, 20);
    ramp(a, 9, 20, cy, 0, "x", track, 30, -20); // deck (west end) down to boards
    ramp(a, 9, 20, cy, 0, "x", track, 30, 20);
    a.minimap.push({ x: -10, z: -20, hw: 35, hd: 4, color: "#d8d2c8" });
    a.minimap.push({ x: -10, z: 20, hw: 35, hd: 4, color: "#d8d2c8" });
    const trainG = new THREE.Group();
    for (let i = 0; i < 3; i += 1) {
      const carMesh = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 3.4), neon);
      carMesh.position.z = i * 3.8;
      trainG.add(carMesh);
    }
    a.group.add(trainG);
    // Train path: rectangle loop over the deck strips.
    const path = [[25, -20], [-41, -20], [-41, 20], [25, 20]];
    let seg = 0, segT = 0;
    a.update = (dt, ctx) => {
      wheelG.rotation.z += dt * 0.4;
      const speed = 26;
      const [ax, az] = path[seg], [bx, bz] = path[(seg + 1) % path.length];
      const len = Math.hypot(bx - ax, bz - az);
      segT += (dt * speed) / len;
      if (segT >= 1) { segT = 0; seg = (seg + 1) % path.length; return; }
      const x = ax + (bx - ax) * segT, z = az + (bz - az) * segT;
      trainG.position.set(x, cy + 0.9, z);
      trainG.lookAt(bx, cy + 0.9, bz);
      ctx.cars.forEach((car) => {
        if (car.wrecked || Math.abs(car.y - cy) > 2.4) return;
        if (Math.abs(car.x - x) < 3 && Math.abs(car.z - z) < 5) {
          ctx.applyDamage(car, 34, { type: "coaster" });
          ctx.impulse(car, car.x - x, car.z - z, 7);
          if (car.isPlayer) ctx.announce("coaster");
        }
      });
    };

    // Snack stands + game tents (destructible), ticket booths.
    [[0, 48, tent], [-30, 52, tentB], [30, 52, tent], [-60, 30, tentB], [60, 20, tent], [80, -20, tentB]].forEach(([x, z, m]) => {
      const stand = box(a, 5, 3, 4, m, x, 1.5, z);
      mesh(a, new THREE.ConeGeometry(4, 2, 4), m === tent ? tentB : tent, x, 4, z, Math.PI / 4);
      destructible(a, stand, x, z, 2.8, 2.3, 16, { score: 30 });
    });

    perimeter(a, planks, 3);
    spawnCircle(a, 58);
    scatterPickups(a, [[-10, -20], [-10, 20], [0, 0], [54, -58], [-70, -30], [70, 50], [-80, 60], [80, 60], [0, -70], [-40, -70]]);
    return a;
  }

  // ============================================================
  // 5. FOG EXCHANGE — downtown rooftop district
  // ============================================================
  function buildRooftops() {
    const a = baseArena({
      id: "rooftop",
      name: "Fog Exchange",
      tagline: "The market is up. You are 40 stories up.",
      sky: 0x4e6a70,
      fog: { color: 0x4e6a70, near: 26, far: 115 },
      hemi: { sky: 0x9ab8bc, ground: 0x22303a, intensity: 0.75 },
      sun: { color: 0xbfe8e0, intensity: 0.6, x: 20, y: 100, z: 20 },
      bounds: { hw: 92, hd: 92 },
    });
    const gravel = T().mat("arena.rooftop.gravel", { color: 0x5d6167 });
    const tower = T().mat("arena.rooftop.tower", { color: 0x39424e });
    const heli = T().mat("arena.rooftop.helipad", { color: 0x2e6e4e });
    const craneM = T().mat("arena.rooftop.crane", { color: 0xc98a2e });
    const acM = T().mat("arena.rooftop.ac", { color: 0x8f979e });
    const glow = T().basicMat("arena.rooftop.glow", { color: 0x63f2c8 });

    // The "ground" here is the abyss — a dark street plane far below.
    ground(a, tower, -18);
    // Roof slabs (the playfield): a low tier (y=6) and a high tier (y=11).
    // Layout graph: center <-> west/east/N-high via bridges, west <-> SW,
    // center <-> E-high via the freight elevator, E-high <-> SE via ramp.
    const roofs = [
      [0, 0, 34, 30, 6],      // center
      [-60, -20, 24, 34, 6],  // west
      [58, -34, 26, 24, 6],   // east
      [52, 40, 30, 26, 6],    // southeast
      [-48, 52, 28, 22, 6],   // southwest
      [-4, -58, 26, 20, 11],  // north high tier
      [44, 6, 18, 14, 11],    // east high tier
    ];
    roofs.forEach(([x, z, w, d, y]) => {
      deck(a, w, d, y, gravel, x, z, y); // thick slab reads as a building
      a.minimap.push({ x, z, hw: w / 2, hd: d / 2, color: y > 6 ? "#6e7a86" : "#4e5866" });
    });
    // Everything that isn't a surface is the abyss.
    a.fallZones.push({ x: 0, z: 0, hw: 92, hd: 92 });

    // Helipads (visual targets on the roofs).
    [[0, 8, 6], [52, 44, 6], [-60, -30, 6], [-4, -58, 11], [44, 6, 11]].forEach(([x, z, y]) => {
      mesh(a, new THREE.CylinderGeometry(5.5, 5.5, 0.2, 12), heli, x, y + 0.12, z);
      mesh(a, new THREE.BoxGeometry(4.4, 0.22, 0.9), glow, x, y + 0.28, z);
    });

    // Crane bridges connecting roofs (narrow drivable beams, ends overlap
    // their roofs so there are no seam gaps).
    const bridges = [
      [-32, -12, 32, 6],  // center <-> west
      [31, -16, 30, 6],   // center <-> east
      [-2, -31, 8, 34],   // center <-> north approach
      [-54, 19, 6, 46],   // west <-> southwest
    ];
    bridges.forEach(([x, z, w, d]) => {
      deck(a, w, d, 6, craneM, x, z, 1.2);
      a.minimap.push({ x, z, hw: w / 2, hd: d / 2, color: "#c98a2e" });
    });
    // Ramps to the high tier (overlap the low surface; height sampling
    // takes the tallest surface within step range, so the climb is smooth).
    ramp(a, 7, 14, 11, 6, "z", craneM, -4, -41); // N-high edge (z=-48) down to north bridge
    ramp(a, 7, 14, 11, 6, "z", craneM, 48, 20);  // E-high edge (z=13) down to SE roof (z=27)
    // Crane towers as landmarks rising from the street far below.
    [[-30, -30], [24, 24]].forEach(([x, z]) => {
      mesh(a, new THREE.BoxGeometry(2.4, 30, 2.4), craneM, x, -3, z);
      mesh(a, new THREE.BoxGeometry(18, 1.6, 1.6), craneM, x + 6, 11.5, z);
      a.colliders.push({ x, z, hw: 1.4, hd: 1.4, base: 0, top: 12 });
    });

    // FREIGHT ELEVATOR: platform sliding between the center roof (y=6)
    // and the east high tier (y=11); its ends touch both roofs.
    const elevRect = { type: "rect", x: 26, z: 6, hw: 9, hd: 5, y: 6 };
    a.heights.push(elevRect);
    const elevMesh = box(a, 18, 1.0, 10, craneM, 26, 5.5, 6);
    mesh(a, new THREE.BoxGeometry(0.8, 14, 0.8), tower, 26, 4, 11.6);
    a.minimap.push({ x: 26, z: 6, hw: 9, hd: 5, color: "#c98a2e" });
    let elevT = 0;
    a.update = (dt) => {
      elevT += dt;
      const phase = (Math.sin(elevT * 0.55) + 1) / 2; // 0..1, slow cycle
      const y = 6 + phase * 5;
      elevRect.y = y;
      elevMesh.position.y = y - 0.5;
    };

    // AC units and antennas as roof clutter.
    [[-10, 10, 6], [12, -8, 6], [-66, -6, 6], [50, -40, 6], [44, 52, 6], [-54, 58, 6], [4, -62, 11]].forEach(([x, z, y]) => {
      const m = box(a, 3, 2, 3, acM, x, y + 1, z);
      destructible(a, m, x, z, 1.7, 1.7, 10, { score: 15 });
    });
    [[16, 12, 6], [-56, -34, 6]].forEach(([x, z, y]) => {
      mesh(a, new THREE.CylinderGeometry(0.14, 0.2, 8, 5), acM, x, y + 4, z);
      mesh(a, new THREE.SphereGeometry(0.5, 6, 5), glow, x, y + 8.2, z);
    });

    // Spawns on the roofs (not a circle — roofs only).
    a.spawns = [
      { x: 0, z: 8, h: Math.PI }, { x: -60, z: -20, h: 1.2 }, { x: 58, z: -34, h: 2.4 },
      { x: 52, z: 40, h: -1.4 }, { x: -48, z: 52, h: -0.5 }, { x: -4, z: -58, h: 3.0 },
    ];
    scatterPickups(a, [[0, -8], [-60, -8], [58, -30], [52, 32], [-48, 46], [-4, -52], [44, 6], [-32, -12], [-54, 19], [26, 6]]);
    return a;
  }

  // ============================================================
  // 6. PLOT TWIST ACRES — midnight cemetery / haunted junkyard
  // ============================================================
  function buildCemetery() {
    const a = baseArena({
      id: "cemetery",
      name: "Plot Twist Acres",
      tagline: "Pre-need pricing. Immediate occupancy.",
      sky: 0x101c14,
      fog: { color: 0x16281e, near: 30, far: 130 },
      hemi: { sky: 0x3f7a56, ground: 0x0c1410, intensity: 0.7 },
      sun: { color: 0x9fe8b8, intensity: 0.5, x: -30, y: 70, z: -50 },
      bounds: { hw: 95, hd: 95 },
    });
    const dirt = T().mat("arena.cemetery.ground", { color: 0x2e3c2c });
    const stone = T().mat("arena.cemetery.stone", { color: 0x76807a });
    const stoneDark = T().mat("arena.cemetery.stone_dark", { color: 0x4a544e });
    const wood = T().mat("arena.cemetery.wood", { color: 0x4e3a26 });
    const glow = T().basicMat("arena.cemetery.glow", { color: 0x5eff9e });
    const trunk = T().mat("arena.shared.trunk", { color: 0x3a2c1e });

    ground(a, dirt);
    // Mausoleum maze ring around an open crypt yard.
    const mausoleums = [
      [-40, -40, 0], [0, -52, 0.3], [40, -42, -0.2], [56, 0, Math.PI / 2],
      [42, 42, 0.2], [0, 56, -0.3], [-44, 40, 0], [-58, 0, Math.PI / 2],
    ];
    mausoleums.forEach(([x, z, ry]) => {
      block(a, 12, 6, 9, stone, x, z, { ry, map: "#76807a" });
      mesh(a, new THREE.ConeGeometry(8, 3, 4), stoneDark, x, 7.4, z, ry + Math.PI / 4);
      mesh(a, new THREE.BoxGeometry(2.4, 3.4, 0.5), stoneDark, x, 1.7, z + (Math.abs(ry) > 1 ? 0 : 4.8), ry);
    });
    // Central crypt with a drive-through arch + roof ramp over it.
    block(a, 5, 7, 12, stone, -8, 0, { map: "#8a948e" });
    block(a, 5, 7, 12, stone, 8, 0, { map: "#8a948e" });
    deck(a, 21, 12, 7, stoneDark, 0, 0);
    ramp(a, 9, 18, 0, 7, "x", stoneDark, -19.5, 0);
    ramp(a, 9, 18, 7, 0, "x", stoneDark, 19.5, 0);
    mesh(a, new THREE.SphereGeometry(1.4, 7, 6), glow, 0, 9.4, 0); // will-o-wisp beacon

    // Tombstone rows (destructible), dead trees, casket piles.
    for (let row = 0; row < 4; row += 1) {
      for (let i = 0; i < 6; i += 1) {
        const x = -66 + i * 8 + (row % 2) * 4;
        const z = -76 + row * 7;
        const m = box(a, 1.6, 1.8, 0.5, row % 2 ? stone : stoneDark, x, 0.9, z);
        destructible(a, m, x, z, 0.9, 0.4, 5, { score: 10 });
      }
    }
    for (let i = 0; i < 5; i += 1) {
      const x = 40 + (i % 3) * 9, z = 60 + Math.floor(i / 3) * 9;
      const m = box(a, 2.6, 1.2, 6.5, wood, x, 0.6, z);
      destructible(a, m, x, z, 1.4, 3.4, 8, { score: 15 });
    }
    [[-76, -20], [-70, 56], [70, -60], [76, 30], [-30, 74], [24, -76]].forEach(([x, z]) => {
      mesh(a, new THREE.CylinderGeometry(0.3, 0.5, 7, 5), trunk, x, 3.5, z);
      mesh(a, new THREE.CylinderGeometry(0.06, 0.16, 3.4, 4), trunk, x + 1.2, 6.4, z, 0);
      a.group.children[a.group.children.length - 1].rotation.z = 1.1;
      a.colliders.push({ x, z, hw: 0.6, hd: 0.6, base: 0, top: 6 });
    });

    // POPPING GRAVES: mounds that erupt on a timer, launching cars.
    const graves = [];
    [[-30, -20], [30, -24], [-26, 30], [34, 26], [0, -34], [0, 36]].forEach(([x, z], i) => {
      const mound = mesh(a, new THREE.SphereGeometry(1.6, 7, 5), dirt, x, -0.9, z);
      const lamp = mesh(a, new THREE.SphereGeometry(0.3, 6, 5), glow, x, 0.6, z);
      lamp.visible = false;
      graves.push({ x, z, mound, lamp, phase: i * 1.7 });
      a.minimap.push({ x, z, hw: 1.6, hd: 1.6, color: "#5eff9e" });
    });
    a.update = (dt, ctx) => {
      const t = ctx.time;
      graves.forEach((grave) => {
        const cycle = (t + grave.phase) % 9;
        // 0..7 dormant, 7..7.8 telegraph (mound rises + lamp), 7.8..8.2 POP
        if (cycle < 7) {
          grave.mound.position.y = -0.9;
          grave.lamp.visible = false;
        } else if (cycle < 7.8) {
          grave.mound.position.y = -0.9 + ((cycle - 7) / 0.8) * 1.1;
          grave.lamp.visible = Math.floor(cycle * 10) % 2 === 0;
        } else if (cycle < 8.2) {
          grave.mound.position.y = 0.4;
          grave.lamp.visible = true;
          ctx.cars.forEach((car) => {
            if (car.wrecked || car.y > 2) return;
            const dx = car.x - grave.x, dz = car.z - grave.z;
            if (dx * dx + dz * dz < 22) {
              ctx.applyDamage(car, 22, { type: "grave" });
              ctx.impulse(car, dx, dz, 11);
              if (car.isPlayer) ctx.announce("grave");
            }
          });
        } else {
          grave.mound.position.y = -0.9;
          grave.lamp.visible = false;
        }
      });
    };

    perimeter(a, stoneDark, 3.4);
    spawnCircle(a, 62);
    scatterPickups(a, [[0, 0], [0, -70], [0, 70], [-70, 0], [70, 0], [-40, -60], [56, 56], [-56, 60], [60, -50], [-30, 0], [30, 0]]);
    return a;
  }

  SCRAP.arenas = {
    list: [
      { id: "suburb", name: "Cul-de-Sac Flats", tagline: "Every lawn is a liability.", build: buildSuburb },
      { id: "junkyard", name: "Crush Depot", tagline: "Everything must go. Violently.", build: buildJunkyard },
      { id: "interchange", name: "The Mixing Bowl", tagline: "Merge or be merged.", build: buildInterchange },
      { id: "boardwalk", name: "Pier Pressure", tagline: "Fun is mandatory. Survival is extra.", build: buildBoardwalk },
      { id: "rooftop", name: "Fog Exchange", tagline: "The market is up. You are 40 stories up.", build: buildRooftops },
      { id: "cemetery", name: "Plot Twist Acres", tagline: "Pre-need pricing. Immediate occupancy.", build: buildCemetery },
    ],
    build(id) {
      const entry = this.list.find((e) => e.id === id) || this.list[0];
      return entry.build();
    },
  };
})();
