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

  /* ============================================================
     TEXEL DENSITY
     ------------------------------------------------------------
     Materials are shared across dozens of meshes, so setting
     `texture.repeat` is useless — every mesh would fight over the
     same value. Tiling therefore lives in each geometry's UVs.

     Without this a 190 m ground plane shows exactly one 128 px
     texture, which is why the roads used to read as brown smears.
     Each material carries a `tile` hint in metres (how much world
     space one texture tile covers) and the kit rewrites UVs to match.
     ============================================================ */
  const DEFAULT_TILE = 6;

  function tileOf(material, override) {
    if (override) return override;
    return (material && material.userData && material.userData.tile) || DEFAULT_TILE;
  }

  /* Vertical tile size, when a surface needs a different density up the
     wall than across it — a facade tile is one storey tall but several
     window bays wide. */
  function tileVOf(material, override, fallback) {
    if (override) return override;
    const uv = material && material.userData;
    if (uv && uv.tileV) return uv.tileV;
    return fallback;
  }

  /* Material with a texel-density hint baked in. */
  function M(key, color, tile, opts) {
    const m = T().mat(key, Object.assign({ color }, opts || {}));
    m.userData.tile = tile || DEFAULT_TILE;
    return m;
  }
  function Mbasic(key, color, tile, opts) {
    const m = T().basicMat(key, Object.assign({ color }, opts || {}));
    m.userData.tile = tile || DEFAULT_TILE;
    return m;
  }

  function mulUV(geo, from, count, su, sv) {
    const uv = geo.attributes.uv;
    if (!uv) return;
    for (let i = from; i < from + count; i += 1) {
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
    uv.needsUpdate = true;
  }

  /* BoxGeometry lays out 24 verts as +x,-x,+y,-y,+z,-z (4 each), so
     each face can take the texel density of the two axes it spans.
     `tv` is the vertical density on the four upright faces. */
  function uvBox(geo, w, h, d, tile, tv) {
    const v = tv || tile;
    mulUV(geo, 0, 4, d / tile, h / v);
    mulUV(geo, 4, 4, d / tile, h / v);
    mulUV(geo, 8, 4, w / tile, d / tile);
    mulUV(geo, 12, 4, w / tile, d / tile);
    mulUV(geo, 16, 4, w / tile, h / v);
    mulUV(geo, 20, 4, w / tile, h / v);
    return geo;
  }

  function uvPlane(geo, w, d, tile, tileV) {
    mulUV(geo, 0, geo.attributes.uv.count, w / tile, d / (tileV || tile));
    return geo;
  }

  function uvRadial(geo, radius, h, tile) {
    mulUV(geo, 0, geo.attributes.uv.count, (Math.PI * 2 * radius) / tile, h / tile);
    return geo;
  }

  function uvDisk(geo, radius, tile) {
    mulUV(geo, 0, geo.attributes.uv.count, (radius * 2) / tile, (radius * 2) / tile);
    return geo;
  }

  function boxGeo(w, h, d, tile, tv) { return uvBox(new THREE.BoxGeometry(w, h, d), w, h, d, tile, tv); }
  function planeGeo(w, d, tile, tileV) { return uvPlane(new THREE.PlaneGeometry(w, d), w, d, tile, tileV); }

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

  function box(a, w, h, d, material, x, y, z, ry = 0, tile, tileV) {
    return mesh(a, boxGeo(w, h, d, tileOf(material, tile), tileVOf(material, tileV, tileOf(material, tile))), material, x, y, z, ry);
  }

  /* Solid block: mesh + collider (+ minimap chip).

     The collider is the rotated footprint's bounding box. Using w/2 and
     d/2 unrotated put a turned building's collision at ninety degrees to
     the wall you could see, which is how the cemetery ended up with
     spawn points inside a mausoleum. */
  function block(a, w, h, d, material, x, z, opts = {}) {
    const ry = opts.ry || 0;
    const m = box(a, w, h, d, material, x, (opts.base || 0) + h / 2, z, ry, opts.tile);
    const c = Math.abs(Math.cos(ry));
    const sn = Math.abs(Math.sin(ry));
    const hw = (c * w + sn * d) / 2;
    const hd = (sn * w + c * d) / 2;
    a.colliders.push({ x, z, hw, hd, base: opts.base || 0, top: (opts.base || 0) + h });
    if (opts.map) a.minimap.push({ x, z, hw, hd, color: opts.map });
    return m;
  }

  /* Drivable elevated slab (adds height rect, no side colliders). */
  function deck(a, w, d, y, material, x, z, thickness = 0.6, tile) {
    const m = box(a, w, thickness, d, material, x, y - thickness / 2, z, 0, tile);
    a.heights.push({ type: "rect", x, z, hw: w / 2, hd: d / 2, y });
    return m;
  }

  /* Drivable ramp: slanted slab + lerped height entry. axis 'z': y0 at
     -hd edge -> y1 at +hd edge. axis 'x': y0 at -hw -> y1 at +hw. */
  function ramp(a, w, len, y0, y1, axis, material, x, z, tile) {
    const rise = y1 - y0;
    const slope = Math.atan2(rise, len);
    const sw = axis === "z" ? w : len / Math.cos(slope);
    const sd = axis === "z" ? len / Math.cos(slope) : w;
    const slab = new THREE.Mesh(boxGeo(sw, 0.5, sd, tileOf(material, tile)), material);
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

  /* Arena boundary. `hidden` keeps the colliders but skips the mesh — for
     arenas whose edge is already walled by a ring of buildings, where an
     extra grey slab would just hide the skyline behind it. */
  function perimeter(a, material, h = 3, hidden = false) {
    const { hw, hd } = a.bounds;
    const t = 2;
    [[0, -hd - t / 2, hw + t, t / 2], [0, hd + t / 2, hw + t, t / 2],
     [-hw - t / 2, 0, t / 2, hd + t], [hw + t / 2, 0, t / 2, hd + t]].forEach(([x, z, whw, whd]) => {
      if (!hidden) box(a, whw * 2, h, whd * 2, material, x, h / 2, z);
      a.colliders.push({ x, z, hw: whw, hd: whd, base: 0, top: Math.max(h, 14) });
    });
  }

  /* `margin` extends the floor well past the play bounds. Without it the
     ground plane stops at the arena edge and any raised camera sees the
     world end on a hard line with sky underneath. */
  function ground(a, material, y = 0, tile, margin = 300) {
    const w = a.bounds.hw * 2 + margin;
    const d = a.bounds.hd * 2 + margin;
    const m = new THREE.Mesh(planeGeo(w, d, tileOf(material, tile)), material);
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

  /* Flat decal-ish surface (roads, water, painted markings). `tile` and
     `tileV` are metres per texture tile across/along; roads pass a width
     equal to the road so the painted centre line stays single. */
  function flatOverlay(a, w, d, material, x, y, z, renderOrder = 2, tile, tileV) {
    const t = tileOf(material, tile);
    const m = mesh(a, planeGeo(w, d, t, tileV || t), material, x, y, z);
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = renderOrder;
    return m;
  }

  function flatDisk(a, radius, material, x, y, z, renderOrder = 3, segments = 32, tile) {
    const geo = uvDisk(new THREE.CircleGeometry(radius, segments), radius, tileOf(material, tile));
    const m = mesh(a, geo, material, x, y, z);
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = renderOrder;
    return m;
  }

  /* Suburban shade tree: a real trunk with a two-tier canopy, sized so a
     car parked underneath is clearly the smaller object. */
  function tree(a, x, z, trunkMat, leafMat, s = 1) {
    const th = 3.4 * s;
    mesh(a, uvRadial(new THREE.CylinderGeometry(0.3 * s, 0.46 * s, th, 6), 0.4 * s, th, tileOf(trunkMat)), trunkMat, x, th / 2, z);
    mesh(a, new THREE.ConeGeometry(2.6 * s, 4.4 * s, 7), leafMat, x, th + 1.9 * s, z);
    mesh(a, new THREE.ConeGeometry(1.9 * s, 3.2 * s, 6), leafMat, x, th + 3.9 * s, z, 0.5);
    a.colliders.push({ x, z, hw: 0.5 * s, hd: 0.5 * s, base: 0, top: 2.4 * s });
  }

  function barrel(a, x, z, material) {
    const m = mesh(a, uvRadial(new THREE.CylinderGeometry(0.55, 0.55, 1.15, 8), 0.55, 1.15, tileOf(material, 1.6)), material, x, 0.58, z);
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

  /* ============================================================
     CITY KIT
     ------------------------------------------------------------
     The arenas used to be flat fields with 4 m sheds on them, which
     is why nothing read as a place and the cars looked enormous.
     Everything below is sized against a 4.5 m car: a storey is
     3.6 m, a streetlight is 8 m, a city block wall is 20 m+.
     ============================================================ */
  const STOREY = 3.6;

  const PROC = () => SCRAP.proc;

  /* Cached procedural materials, keyed so a tower asked for twice
     shares one material and one draw-call batch. */
  const procCache = new Map();
  function P(key, painter, opts = {}) {
    const id = `${key}|${JSON.stringify(opts)}`;
    if (!procCache.has(id)) {
      const m = PROC().mat(key, painter, opts);
      procCache.set(id, m);
    }
    return procCache.get(id);
  }
  function Pbasic(key, painter, opts = {}) {
    const id = `basic|${key}|${JSON.stringify(opts)}`;
    if (!procCache.has(id)) procCache.set(id, PROC().basicMat(key, painter, opts));
    return procCache.get(id);
  }

  /**
   * Multi-storey building. This is the workhorse that gives every
   * arena its walls and its sense of scale.
   *
   * opts: { storeys, storeyH, facade, roof, base (storefront material),
   *         solid (collider, default true), ry, ledge, ac, sign }
   */
  function building(a, x, z, w, d, opts = {}) {
    const storeys = opts.storeys || 3;
    const sh = opts.storeyH || STOREY;
    const baseH = opts.base ? sh * 1.3 : 0;
    const upperH = storeys * sh;
    const h = baseH + upperH;
    const ry = opts.ry || 0;

    if (opts.base) {
      // Ground floor gets its own storefront band.
      mesh(a, boxGeo(w, baseH, d, opts.baseTile || 7, baseH), opts.base, x, baseH / 2, z, ry);
    }
    const facade = opts.facade;
    mesh(a, boxGeo(w, upperH, d, opts.facadeTile || 7.2, sh), facade, x, baseH + upperH / 2, z, ry);

    // Parapet ledge: a thin overhang reads as a roofline instead of a
    // box that just stops. Cheap, and it catches the sun.
    if (opts.ledge !== false) {
      mesh(a, boxGeo(w + 1.1, 0.7, d + 1.1, 3), opts.roof || facade, x, h + 0.2, z, ry);
    }
    if (opts.roof) mesh(a, boxGeo(w, 0.4, d, 5), opts.roof, x, h + 0.75, z, ry);

    // Rooftop clutter — silhouette breakers on the skyline.
    if (opts.ac !== false && w > 8) {
      const n = 1 + Math.floor(((x * 31 + z * 17) % 3 + 3) % 3);
      for (let i = 0; i < n; i += 1) {
        const ox = ((i * 37 + x) % (w * 0.5)) - w * 0.25;
        const oz = ((i * 53 + z) % (d * 0.5)) - d * 0.25;
        mesh(a, boxGeo(2.6, 1.8, 2.2, 2), opts.roof || facade, x + ox, h + 1.4, z + oz, ry);
      }
      mesh(a, boxGeo(1.0, 3.2, 1.0, 2), opts.roof || facade, x + w * 0.3, h + 2.2, z - d * 0.3, ry);
    }

    if (opts.solid !== false) {
      const cw = Math.abs(Math.cos(ry)) * w / 2 + Math.abs(Math.sin(ry)) * d / 2;
      const cd = Math.abs(Math.sin(ry)) * w / 2 + Math.abs(Math.cos(ry)) * d / 2;
      a.colliders.push({ x, z, hw: cw, hd: cd, base: 0, top: h });
      a.minimap.push({ x, z, hw: cw, hd: cd, color: opts.map || "#3d414c" });
    }
    return h;
  }

  /**
   * Distant skyline: rings of silhouette towers outside the play bounds,
   * so the arena reads as part of a city rather than a slab in a void.
   *
   * Fog is off for these and the haze is baked into the tint instead.
   * Left to real fog they wash to exactly the fog colour and read as
   * bright cardboard cut-outs pasted over the sky; a pre-hazed tint that
   * sits a notch darker than the horizon reads as distance.
   *
   * Two rings at different tints give the parallax depth cue that a
   * single ring cannot.
   */
  function skyline(a, opts = {}) {
    const g = new THREE.Group();
    const rings = opts.rings || [
      { r: opts.radius || 210, count: opts.count || 26, minH: opts.minH || 30, varH: opts.varH || 55, tint: 0.72 },
      { r: (opts.radius || 210) * 1.5, count: Math.round((opts.count || 26) * 1.2), minH: (opts.minH || 30) * 1.4, varH: (opts.varH || 55) * 1.3, tint: 0.45 },
    ];
    const haze = new THREE.Color(opts.haze == null ? 0x6a5a78 : opts.haze);
    rings.forEach((band, ri) => {
      // Silhouettes darken toward the viewer, lighten toward the horizon.
      const col = new THREE.Color(opts.near == null ? 0x2e2a3c : opts.near).lerp(haze, 1 - band.tint);
      const mat = new THREE.MeshBasicMaterial({
        map: opts.textured === false ? null : PROC().tex("towerNight", {
          base: col.getHex(), lit: opts.lit == null ? 0.06 : opts.lit, cols: 5, rows: 8, seed: 91 + ri,
        }),
        color: 0xffffff,
        fog: false,
      });
      for (let i = 0; i < band.count; i += 1) {
        const ang = (i / band.count) * Math.PI * 2 + ri * 0.11 + (i % 3) * 0.05;
        const jitter = 1 + (((i * 7919 + ri * 131) % 100) / 100) * (opts.spread || 0.3);
        const r = band.r * jitter;
        const h = band.minH + (((i * 5779 + ri * 271) % 100) / 100) * band.varH;
        const w = 16 + (((i * 3313 + ri * 97) % 100) / 100) * 30;
        const x = Math.cos(ang) * r;
        const z = Math.sin(ang) * r;
        const m = new THREE.Mesh(boxGeo(w, h, w * 0.85, 16, 6), mat);
        m.position.set(x, h / 2 - (opts.sink || 10), z);
        m.rotation.y = -ang;
        m.renderOrder = -15 + ri;
        g.add(m);
        // Setback crown on the taller ones so the roofline isn't all flat tops.
        if (h > band.minH + band.varH * 0.55) {
          const c = new THREE.Mesh(boxGeo(w * 0.55, h * 0.22, w * 0.5, 16, 6), mat);
          c.position.set(x, h - (opts.sink || 10) + h * 0.11, z);
          c.rotation.y = -ang;
          c.renderOrder = -15 + ri;
          g.add(c);
        }
      }
    });
    a.group.add(g);
    return g;
  }

  /**
   * Sky dome. A big inverted cylinder with a painted gradient, fog
   * disabled so the horizon keeps its colour separation instead of
   * dissolving into one flat clear colour.
   *
   * It is parented to `a.sky` and re-centred on the camera every frame
   * (main.js does the follow). A world-fixed dome gets sliced by the far
   * plane once the camera drives away from the middle, and the flat
   * `scene.background` shows through the hole as a hard-edged block.
   */
  function skyDome(a, opts = {}) {
    /* One tile stretched around the whole dome is a 6:1 horizontal
       smear — clouds come out as thin dashes. Repeating it a few times
       around restores a roughly square texel and lets the cloud shapes
       read. The gradient is uniform horizontally, so the seams are only
       visible in the cloud layer, where they pass as more weather. */
    const tex = PROC().tex("sky", opts).clone();
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(opts.repeat || 4, 1);
    tex.needsUpdate = true;
    const m = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
    const r = opts.radius || 300;
    const height = opts.height || 300;
    const g = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(r, r, height, 28, 1, true), m);
    dome.renderOrder = -20;
    g.add(dome);
    // Cap so looking up doesn't punch through to the clear colour.
    const cap = new THREE.Mesh(
      new THREE.CircleGeometry(r, 28),
      new THREE.MeshBasicMaterial({ color: opts.capColor == null ? 0x1a2c50 : opts.capColor, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = height / 2;
    cap.renderOrder = -20;
    g.add(cap);
    // Floor cap in the same tone, for shots that look down past the world.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(r, 28),
      new THREE.MeshBasicMaterial({ color: opts.floorColor == null ? (a.fog && a.fog.color) || 0x202028 : opts.floorColor, side: THREE.FrontSide, fog: false, depthWrite: false })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -height / 2;
    floor.renderOrder = -20;
    g.add(floor);
    g.position.y = height * 0.18;
    a.group.add(g);
    a.skyDome = { group: g, baseY: height * 0.18 };
    return dome;
  }

  /* Kerbed sidewalk strip — raised, drivable, and the thing that makes
     a road read as a street instead of a painted rectangle. */
  function sidewalk(a, w, d, material, x, z, h = 0.35) {
    box(a, w, h, d, material, x, h / 2, z);
    a.heights.push({ type: "rect", x, z, hw: w / 2, hd: d / 2, y: h });
    return h;
  }

  /* ---- light pools ---------------------------------------------------
     A pool of light on the ground under every lamp and sign. This is the
     look of the era: bright puddles with near-dark between them, so a
     street reads as lit rather than evenly grey. Additive so it brightens
     whatever texture is underneath instead of pasting a grey disc on it. */
  const poolMats = new Map();
  function poolMaterial(tint, core) {
    const key = `${tint}|${core}`;
    if (!poolMats.has(key)) {
      const m = new THREE.MeshBasicMaterial({
        map: PROC().tex("glowDisc", { tint, core, size: 128 }),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: true,
      });
      poolMats.set(key, m);
    }
    return poolMats.get(key);
  }
  function lightPool(a, x, z, radius, opts = {}) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2, radius * 2),
      poolMaterial(opts.tint || "255,226,150", opts.core == null ? 0.7 : opts.core)
    );
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * Math.PI;
    m.position.set(x, (opts.y || 0) + 0.09, z);
    m.renderOrder = 4;
    a.group.add(m);
    return m;
  }
  /* Vertical glow panel — for neon and signage spilling onto a wall. */
  function lightPanel(a, x, y, z, w, h, ry, opts = {}) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      poolMaterial(opts.tint || "255,226,150", opts.core == null ? 0.55 : opts.core)
    );
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.renderOrder = 4;
    a.group.add(m);
    return m;
  }

  /* Painted sign / graffiti stuck flat on a wall. */
  function wallSign(a, x, y, z, w, h, ry, opts = {}) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      Pbasic(opts.key || "prop.wallsign", "wallSign", Object.assign({ transparent: true, tile: w }, opts))
    );
    m.material.transparent = true;
    m.material.depthWrite = false;
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.renderOrder = 3;
    a.group.add(m);
    return m;
  }

  /* Streetlight: mast, arm, lamp housing, and an unlit glow panel. */
  function streetlight(a, x, z, poleM, glowM, ry = 0, h = 8) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(uvRadial(new THREE.CylinderGeometry(0.16, 0.24, h, 6), 0.2, h, 2), poleM));
    g.children[0].position.y = h / 2;
    const arm = new THREE.Mesh(boxGeo(2.6, 0.18, 0.18, 2), poleM);
    arm.position.set(1.3, h - 0.3, 0);
    g.add(arm);
    const lamp = new THREE.Mesh(boxGeo(1.5, 0.32, 0.7, 2), poleM);
    lamp.position.set(2.3, h - 0.55, 0);
    g.add(lamp);
    const bulb = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.6), glowM);
    bulb.rotation.x = Math.PI / 2;
    bulb.position.set(2.3, h - 0.73, 0);
    g.add(bulb);
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    a.group.add(g);
    a.colliders.push({ x, z, hw: 0.3, hd: 0.3, base: 0, top: 3 });
    // The pool the lamp actually throws, offset under the mast arm.
    lightPool(a, x + Math.cos(ry) * 2.3, z - Math.sin(ry) * 2.3, h * 0.95, {
      tint: "255,226,150", core: 0.62,
    });
    return g;
  }

  /* Wrecked car — set dressing that also sells scale instantly, because
     the player knows exactly how big a car is. */
  function junkCar(a, x, z, bodyM, glassM, ry = 0, opts = {}) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(boxGeo(2.0, 0.95, 4.4, 2.4), bodyM);
    body.position.y = 0.75;
    const cabin = new THREE.Mesh(boxGeo(1.85, 0.8, 2.1, 2.2), glassM);
    cabin.position.set(0, 1.55, -0.25);
    g.add(body, cabin);
    if (opts.crushed) {
      body.scale.y = 0.55;
      cabin.scale.set(0.9, 0.35, 0.85);
      cabin.position.y = 1.0;
      g.rotation.z = 0.08;
    }
    if (opts.wheels !== false) {
      [[-0.95, 1.5], [0.95, 1.5], [-0.95, -1.5], [0.95, -1.5]].forEach(([wx, wz]) => {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.34, 8), bodyM);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, 0.42, wz);
        g.add(w);
      });
    }
    g.position.set(x, opts.y || 0, z);
    g.rotation.y = ry;
    a.group.add(g);
    a.colliders.push({ x, z, hw: 1.3, hd: 2.3, base: opts.y || 0, top: (opts.y || 0) + 1.6 });
    return g;
  }

  /* Dumpster — breakable, drops pickups, hides sightlines. */
  function dumpster(a, x, z, material, ry = 0) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(boxGeo(2.6, 1.5, 1.7, 2), material);
    body.position.y = 0.85;
    const lid = new THREE.Mesh(boxGeo(2.7, 0.16, 1.8, 2), material);
    lid.position.set(0, 1.66, -0.05);
    lid.rotation.x = -0.14;
    g.add(body, lid);
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    a.group.add(g);
    destructible(a, g, x, z, 1.5, 1.1, 22, { score: 25 });
    return g;
  }

  /* Chain-link run with posts. Double-sided and alpha-tested so you can
     see the fight through it, which is what makes a lot feel enclosed
     rather than boxed in. */
  function chainFence(a, x, z, len, axis, postM, h = 3.2) {
    const fenceM = P("prop.chainlink", "chainlink", { tile: 3.2, transparent: true, side: THREE.DoubleSide, cell: 14 });
    fenceM.alphaTest = 0.4;
    fenceM.depthWrite = false;
    const w = axis === "x" ? len : 0.1;
    const d = axis === "x" ? 0.1 : len;
    const panel = new THREE.Mesh(boxGeo(w, h, d, 3.2), fenceM);
    panel.position.set(x, h / 2, z);
    a.group.add(panel);
    // Top rail + posts.
    const rw = axis === "x" ? len : 0.14;
    const rd = axis === "x" ? 0.14 : len;
    mesh(a, boxGeo(rw, 0.14, rd, 2), postM, x, h, z);
    const n = Math.max(2, Math.round(len / 6));
    for (let i = 0; i <= n; i += 1) {
      const t = i / n - 0.5;
      const px = axis === "x" ? x + t * len : x;
      const pz = axis === "x" ? z : z + t * len;
      mesh(a, uvRadial(new THREE.CylinderGeometry(0.11, 0.13, h, 5), 0.12, h, 2), postM, px, h / 2, pz);
    }
    a.colliders.push({ x, z, hw: axis === "x" ? len / 2 : 0.25, hd: axis === "x" ? 0.25 : len / 2, base: 0, top: h });
    return panel;
  }

  /* Jersey barrier / concrete divider run. */
  function barrierRun(a, x, z, len, axis, material, h = 1.1) {
    const w = axis === "x" ? len : 0.85;
    const d = axis === "x" ? 0.85 : len;
    box(a, w, h, d, material, x, h / 2, z, 0, 2.2);
    // Sloped shoulder so it isn't a plain slab in silhouette.
    box(a, axis === "x" ? len : 0.45, 0.3, axis === "x" ? 0.45 : len, material, x, h + 0.12, z, 0, 2.2);
    a.colliders.push({ x, z, hw: axis === "x" ? len / 2 : 0.5, hd: axis === "x" ? 0.5 : len / 2, base: 0, top: h });
  }

  /* Roadside billboard on twin legs. */
  function billboardSign(a, x, z, ry, opts = {}) {
    const face = Pbasic(opts.key || "prop.billboard", "billboard", opts);
    const legM = opts.leg;
    const w = opts.w || 12;
    const h = opts.h || 6;
    const y = opts.y || 9;
    const panel = new THREE.Mesh(boxGeo(w, h, 0.5, w / 2, h), face);
    panel.position.set(x, y, z);
    panel.rotation.y = ry;
    a.group.add(panel);
    [-w * 0.3, w * 0.3].forEach((o) => {
      const lx = x + Math.cos(ry) * o;
      const lz = z - Math.sin(ry) * o;
      mesh(a, uvRadial(new THREE.CylinderGeometry(0.22, 0.28, y - h / 2, 6), 0.25, y, 2), legM, lx, (y - h / 2) / 2, lz);
    });
    a.colliders.push({ x, z, hw: 1.2, hd: 1.2, base: 0, top: 4 });
    return panel;
  }

  /* Utility pole with crossarm and slack lines — instant Americana, and
     it breaks up an empty sky better than anything else this cheap. */
  function powerPole(a, x, z, material, h = 11) {
    mesh(a, uvRadial(new THREE.CylinderGeometry(0.22, 0.32, h, 6), 0.28, h, 3), material, x, h / 2, z);
    mesh(a, boxGeo(4.4, 0.2, 0.2, 2), material, x, h - 1.0, z);
    mesh(a, boxGeo(3.2, 0.18, 0.18, 2), material, x, h - 2.1, z);
    a.colliders.push({ x, z, hw: 0.35, hd: 0.35, base: 0, top: 4 });
  }

  /* Traffic signal on a mast arm. */
  function trafficLight(a, x, z, poleM, ry = 0) {
    const g = new THREE.Group();
    const mast = new THREE.Mesh(uvRadial(new THREE.CylinderGeometry(0.16, 0.22, 7, 6), 0.2, 7, 2), poleM);
    mast.position.y = 3.5;
    const arm = new THREE.Mesh(boxGeo(4.4, 0.16, 0.16, 2), poleM);
    arm.position.set(2.2, 6.8, 0);
    g.add(mast, arm);
    [1.6, 3.4].forEach((o) => {
      const housing = new THREE.Mesh(boxGeo(0.5, 1.4, 0.42, 1), poleM);
      housing.position.set(o, 6.1, 0);
      g.add(housing);
      ["#d83a2a", "#e0b52a", "#3ad86a"].forEach((c, i) => {
        const lens = new THREE.Mesh(
          new THREE.PlaneGeometry(0.3, 0.3),
          new THREE.MeshBasicMaterial({ color: c, fog: true })
        );
        lens.position.set(o, 6.55 - i * 0.42, 0.23);
        g.add(lens);
      });
    });
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    a.group.add(g);
    a.colliders.push({ x, z, hw: 0.3, hd: 0.3, base: 0, top: 3 });
    return g;
  }

  /* Painted lane line laid over a road surface. */
  function laneLine(a, x, z, len, axis, opts = {}) {
    const m = Pbasic(opts.key || "prop.roadline", "roadLine", {
      transparent: true, color: opts.color, dash: opts.dash, width: opts.width, tile: opts.tile || 6,
    });
    m.alphaTest = 0.35;
    m.depthWrite = false;
    // Always built running along local +Y (one stripe across, repeating
    // down the length), then spun flat — and a further quarter turn for
    // an x-axis run. THREE applies Euler XYZ as RX·RY·RZ, so the Z spin
    // happens first, in the plane's own space.
    const wide = 0.7;
    const geo = uvPlane(new THREE.PlaneGeometry(wide, len), wide, len, wide, opts.tile || 6);
    const mm = new THREE.Mesh(geo, m);
    mm.rotation.set(-Math.PI / 2, 0, axis === "x" ? Math.PI / 2 : 0);
    mm.position.set(x, opts.y || 0.13, z);
    mm.renderOrder = opts.order || 5;
    a.group.add(mm);
    return mm;
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
      fog: { color: 0xc4794f, near: 90, far: 275 },
      hemi: { sky: 0xffc48a, ground: 0x54382e, intensity: 0.85 },
      sun: { color: 0xffb066, intensity: 0.95, x: -60, y: 70, z: 30 },
      bounds: { hw: 95, hd: 95 },
    });
    // Tile hints are metres of world per texture tile — the whole reason
    // the roads stopped reading as brown smears.
    const road = M("arena.suburb.road", 0x4a4a52, 8);
    const flatRoad = stableOverlay(M("arena.suburb.road", 0x4a4a52, 14));
    const grass = M("arena.suburb.grass", 0x6d8f3f, 7);
    const wallA = M("arena.suburb.house_wall_a", 0xd8c9a8, 4.2);
    const wallB = M("arena.suburb.house_wall_b", 0xb7cbd6, 4.2);
    const roof = M("arena.suburb.roof", 0x8a4632, 3.4);
    const fenceM = M("prop.fence", 0xe3ded1, 2.6);
    const water = stableOverlay(M("arena.suburb.pool", 0x3fa7c9, 6));
    const trunk = M("arena.shared.trunk", 0x6b4a2e, 2.4);
    const leaf = M("arena.shared.leaf", 0x4f7a33, 3);
    const drum = M("prop.barrel", 0xc9452e, 1.6);
    const walk = P("prop.sidewalk", "sidewalk", { tile: 4, base: 0x9c968a });
    const kerbAsphalt = P("prop.asphalt", "asphalt", { tile: 9, base: 0x3f4046 });
    const garageDoor = P("prop.garage", "garage", { tile: 3.4, base: 0xc8c2b2 });
    const brickM = P("prop.brick", "brick", { tile: 3.6, base: 0x8a4a36 });
    const shingleM = P("prop.shingle.suburb", "shingle", { tile: 3.2, base: 0x7a5442, rows: 9 });
    const poleM = P("prop.pole", "panel", { tile: 3, base: 0x4a4c52, seams: 2 });
    const lampGlow = Pbasic("prop.lampglow", "panel", { base: 0xffe6a8, seams: 1, tile: 2 });
    const shopFront = P("prop.storefront", "storefront", { tile: 7, base: 0x8c8478, awning: "#2f7a5e" });
    const blockFacade = P("prop.facade.tan", "facade", { tile: 7.2, tileV: STOREY, base: 0x9a8f7c, cols: 4, lit: 0.14 });
    const distantM = Pbasic("prop.skyline.dusk", "towerNight", { base: 0x6b4a3c, lit: 0.05, cols: 5, rows: 7 });

    skyDome(a, {
      top: [0x4a, 0x2e, 0x5c], bottom: [0xf0, 0xa0, 0x58],
      clouds: true, cloud: "#ffd9b0", curve: 2.1, capColor: 0x3a2450,
    });
    ground(a, grass);

    /* ---- street grid -------------------------------------------------
       Two crossing boulevards with kerbs, sidewalks, painted lines and a
       cul-de-sac circle at the middle. Sidewalks are drivable at 0.35 m
       so you can cut a corner across one. */
    const roadRadius = 27;
    const roadOuter = 92;
    const roadWidth = 15;
    const armLen = roadOuter - roadRadius;
    const armCentre = roadRadius + armLen / 2;
    [[0, -armCentre, "z"], [0, armCentre, "z"], [-armCentre, 0, "x"], [armCentre, 0, "x"]].forEach(([x, z, axis]) => {
      const w = axis === "z" ? roadWidth : armLen;
      const d = axis === "z" ? armLen : roadWidth;
      flatOverlay(a, w, d, flatRoad, x, 0.095, z, 2, axis === "z" ? roadWidth : 12, axis === "z" ? 12 : roadWidth);
      a.minimap.push({ x, z, hw: w / 2, hd: d / 2, color: "#4a4a52" });
      laneLine(a, x, z, armLen, axis, { dash: true, color: "#e8d76a", tile: 9 });
      // Kerb + sidewalk down both flanks.
      const off = roadWidth / 2 + 1.6;
      [-off, off].forEach((o) => {
        if (axis === "z") sidewalk(a, 3.2, armLen, walk, x + o, z);
        else sidewalk(a, armLen, 3.2, walk, x, z + o);
      });
    });
    flatDisk(a, roadRadius, flatRoad, 0, 0.115, 0, 3, 36, 11);
    a.minimap.push({ x: 0, z: 0, hw: roadRadius, hd: roadRadius, color: "#4a4a52" });
    // Planted island in the middle of the circle.
    flatDisk(a, 9, stableOverlay(M("arena.suburb.grass", 0x6d8f3f, 5)), 0, 0.14, 0, 4, 20);
    tree(a, 0, 0, trunk, leaf, 1.5);
    ring(4, 9.5, (x, z) => { streetlight(a, x, z, poleM, lampGlow, Math.atan2(-z, -x), 7); });

    /* ---- houses -------------------------------------------------------
       Two storeys, 8.5 m to the eaves, with a pitched roof on top: the
       car now looks like a car parked next to a house. */
    function house(x, z, wallM, ry, opts = {}) {
      const w = opts.w || 15;
      const d = opts.d || 12;
      const h = opts.h || 7.6;
      block(a, w, h, d, wallM, x, z, { ry, map: "#8a6f57", tile: 4.2 });
      // Pitched roof from two slabs plus a ridge, not a pyramid cone.
      const rl = Math.hypot(w / 2, 3.2);
      [-1, 1].forEach((s) => {
        const slab = mesh(a, boxGeo(rl, 0.5, d + 1.4, 3.2), shingleM, x + Math.cos(ry) * s * w * 0.25, h + 1.6, z - Math.sin(ry) * s * w * 0.25, ry);
        slab.rotation.z = -s * 0.55;
        slab.rotation.y = ry;
      });
      mesh(a, boxGeo(0.8, 0.6, d + 1.6, 3), shingleM, x, h + 3.35, z, ry);
      // Chimney, porch overhang, garage door face.
      mesh(a, boxGeo(1.5, 3.0, 1.5, 2), brickM, x + Math.cos(ry) * w * 0.3, h + 2.6, z - Math.sin(ry) * w * 0.3, ry);
      const fz = z + Math.cos(ry) * (d / 2 + 0.06);
      const fx = x + Math.sin(ry) * (d / 2 + 0.06);
      mesh(a, boxGeo(4.6, 3.4, 0.12, 3.4), garageDoor, fx, 1.75, fz, ry);
      // Porch lintel over the door face.
      mesh(a, boxGeo(w * 0.92, 0.45, 1.6, 3), roof, x + Math.sin(ry) * (d / 2 + 0.7), 3.9, z + Math.cos(ry) * (d / 2 + 0.7), ry);
      if (opts.drive !== false) {
        const dx = x + Math.sin(ry) * (d / 2 + 5);
        const dz = z + Math.cos(ry) * (d / 2 + 5);
        const dm = flatOverlay(a, 5.4, 10, stableOverlay(kerbAsphalt), dx, 0.1, dz, 3, 5.4, 6);
        dm.rotation.z = ry;
      }
    }
    const homes = [
      [-52, -54, wallA, 0], [-18, -62, wallB, 0], [58, -52, wallA, Math.PI],
      [64, -16, wallB, -Math.PI / 2], [54, 54, wallB, Math.PI], [16, 64, wallA, Math.PI],
      [-54, 50, wallB, Math.PI], [-66, 12, wallA, Math.PI / 2], [-66, -18, wallB, Math.PI / 2],
      [30, -66, wallB, 0], [-30, 66, wallA, Math.PI], [66, 30, wallA, -Math.PI / 2],
    ];
    homes.forEach(([x, z, m, ry]) => house(x, z, m, ry));

    // Drive-through garage house: two wings with a gap you can shoot.
    block(a, 6, 6.4, 15, wallA, 24, -30, { map: "#8a6f57", tile: 4.2 });
    block(a, 6, 6.4, 15, wallA, 36, -30, { map: "#8a6f57", tile: 4.2 });
    box(a, 19, 0.7, 16, roof, 30, 6.8, -30, 0, 3.4);
    mesh(a, boxGeo(19, 1.2, 1.0, 3), roof, 30, 7.6, -22, 0);

    // Roof-ramp house: drive up and over. Visual body only; the colliders
    // are the two side walls so the ±z ramps stay open.
    box(a, 15, 6.2, 13, wallA, 0, 3.1, -64, 0, 4.2);
    box(a, 15, 0.6, 13, roof, 0, 6.4, -64, 0, 3.4);
    a.minimap.push({ x: 0, z: -64, hw: 7.5, hd: 6.5, color: "#8a6f57" });
    a.heights.push({ type: "rect", x: 0, z: -64, hw: 7.5, hd: 6.5, y: 6.2 });
    a.colliders.push({ x: -7.2, z: -64, hw: 0.4, hd: 6.5, base: 0, top: 6.2 });
    a.colliders.push({ x: 7.2, z: -64, hw: 0.4, hd: 6.5, base: 0, top: 6.2 });
    ramp(a, 9, 16, 0, 6.2, "z", road, 0, -78.5);
    ramp(a, 9, 16, 6.2, 0, "z", road, 0, -49.5);

    /* ---- the block that closes the arena off ---------------------------
       A strip mall and mid-rise apartments along the outer edge. Without
       this the play space just stopped and you saw sky at ground level. */
    const edge = 94;
    [[-58, -edge, 34, 12, 0], [10, -edge, 30, 12, 0], [62, -edge, 26, 12, 0],
     [-58, edge, 30, 12, 0], [20, edge, 34, 12, 0], [66, edge, 24, 12, 0],
     [-edge, -40, 12, 30, 0], [-edge, 30, 12, 34, 0],
     [edge, -34, 12, 28, 0], [edge, 42, 12, 32, 0]].forEach(([x, z, w, d], i) => {
      building(a, x, z, w, d, {
        storeys: 2 + (i % 3),
        facade: blockFacade,
        base: shopFront,
        roof: M("arena.suburb.roof", 0x6a5348, 4),
        map: "#6b5a4a",
      });
    });
    // Corner towers so the diagonals are closed too.
    [[-edge, -edge], [edge, -edge], [-edge, edge], [edge, edge]].forEach(([x, z], i) => {
      building(a, x, z, 24, 24, { storeys: 5 + i, facade: blockFacade, roof: M("arena.suburb.roof", 0x6a5348, 4), map: "#5c4e42" });
    });
    skyline(a, { radius: 200, count: 26, minH: 26, varH: 54, sink: 10, haze: 0xa4708a, near: 0x4a3348, lit: 0.05 });

    /* ---- yards, pools, street furniture ---- */
    [[-36, 32, 9, 6], [40, -30, 8, 7]].forEach(([x, z, hw, hd]) => {
      flatOverlay(a, hw * 2, hd * 2, water, x, 0.12, z, 4, 5);
      // Pool coping so the water isn't a decal on grass.
      box(a, hw * 2 + 1.4, 0.4, hd * 2 + 1.4, walk, x, 0.2, z, 0, 3);
      a.slowZones.push({ x, z, hw, hd, factor: 0.55 });
      a.minimap.push({ x, z, hw, hd, color: "#3fa7c9" });
    });
    for (let i = 0; i < 16; i += 1) {
      const x = -74 + i * 10;
      const m = box(a, 4.2, 1.5, 0.3, fenceM, x, 0.75, 26 + ((i % 3) - 1) * 1.5, 0, 2.2);
      destructible(a, m, x, m.position.z, 2.2, 0.5, 6, { score: 10 });
    }
    [[-26, -14], [30, 18], [12, -30], [-40, -36], [48, 32], [-10, 44], [44, -8]].forEach(([x, z]) => barrel(a, x, z, drum));
    [[-74, -22], [-26, 74], [74, 42], [26, -76], [76, -70], [-76, 70], [-42, 8], [42, 40], [-12, -42], [22, 8]]
      .forEach(([x, z]) => tree(a, x, z, trunk, leaf, 1.15));
    // Street furniture along the boulevards.
    for (let i = -3; i <= 3; i += 1) {
      if (i === 0) continue;
      streetlight(a, roadWidth / 2 + 4.6, i * 22, poleM, lampGlow, Math.PI, 8);
      streetlight(a, -roadWidth / 2 - 4.6, i * 22 + 11, poleM, lampGlow, 0, 8);
      streetlight(a, i * 22, roadWidth / 2 + 4.6, poleM, lampGlow, -Math.PI / 2, 8);
    }
    [[-46, -12, 0.4], [50, 22, 3.1], [8, 52, 1.6], [-14, -48, 2.2]].forEach(([x, z, ry]) =>
      junkCar(a, x, z, M("arena.suburb.roof", 0x7a4636, 2.4), M("arena.suburb.house_wall_b", 0x6a7f8c, 2), ry, { crushed: (x + z) % 2 === 0 }));
    [[-20, 24], [34, -50], [-62, 34], [70, 62]].forEach(([x, z]) => dumpster(a, x, z, P("prop.dumpster", "panel", { tile: 2.2, base: 0x3f6a4a }), (x * z) % 2));
    [[-30, -78], [40, 78], [-78, 46], [78, -46]].forEach(([x, z]) => powerPole(a, x, z, poleM, 12));
    trafficLight(a, roadWidth / 2 + 3, roadRadius + 6, poleM, Math.PI);
    trafficLight(a, -roadWidth / 2 - 3, -roadRadius - 6, poleM, 0);
    // Shopfront spill and painted wall ads along the closing block.
    [[-58, -edge, 0], [10, -edge, 0], [62, -edge, 0],
     [-58, edge, Math.PI], [20, edge, Math.PI], [66, edge, Math.PI]].forEach(([x, z, ry], i) => {
      const dir = z < 0 ? 1 : -1;
      lightPool(a, x, z + dir * 9, 13, { tint: i % 2 ? "255,196,120" : "180,220,255", core: 0.5 });
      lightPanel(a, x, 2.6, z + dir * 6.3, 22, 5, ry, { tint: "255,206,140", core: 0.35 });
      wallSign(a, x + (i % 2 ? 8 : -8), 9.5, z + dir * 6.15, 12, 6, ry, {
        key: `prop.wallsign.sub${i}`, bg: i % 2 ? "#2f5f7a" : "#8a2f2a", tag: i % 3 === 0,
      });
    });
    billboardSign(a, -78, -78, Math.PI / 4, { leg: poleM, w: 16, h: 7, y: 12, bg: "#c8452e", key: "prop.billboard.a" });
    billboardSign(a, 80, 20, -Math.PI / 2, { leg: poleM, w: 14, h: 6.5, y: 11, bg: "#2f5f9a", key: "prop.billboard.b" });

    perimeter(a, fenceM, 4, true); // the building ring is the visible wall
    spawnCircle(a, 62);
    scatterPickups(a, [[0, 0], [-36, 32], [40, -30], [0, -64], [-52, 0], [52, 0], [0, 52], [-20, -40], [30, 44], [64, -40], [-64, -52], [20, 20], [30, -30]]);
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
      sky: 0x9aa0a6,
      fog: { color: 0x9a9e9c, near: 80, far: 250 },
      hemi: { sky: 0xd6dae0, ground: 0x5a4c3c, intensity: 1.0 },
      sun: { color: 0xfff0d8, intensity: 0.95, x: 40, y: 80, z: -20 },
      bounds: { hw: 100, hd: 90 },
    });
    const dirt = M("arena.junkyard.dirt", 0x6f6250, 7);
    const container = M("arena.junkyard.container", 0xa8452e, 5.6);
    const container2 = M("arena.junkyard.container_b", 0x3f6f8a, 5.6);
    const wh = M("arena.junkyard.warehouse", 0x7d7f83, 4.4);
    const scrap = M("arena.junkyard.scrap", 0x5c5147, 5);
    const crushM = M("arena.junkyard.crusher", 0xb08a20, 3.2);
    const drum = M("prop.barrel", 0xc9452e, 1.6);
    const poleM = P("prop.pole", "panel", { tile: 3, base: 0x4a4c52, seams: 2 });
    const hazardM = P("prop.hazard", "hazard", { tile: 2.6 });
    const concreteM = P("prop.concrete.yard", "sidewalk", { tile: 5, base: 0x8a877e, slabs: 2 });
    const officeFacade = P("prop.facade.industrial", "facade", { tile: 7.2, tileV: STOREY, base: 0x77716a, cols: 4, lit: 0.1 });
    const rustPanel = P("prop.panel.rust", "panel", { tile: 3.6, base: 0x7d6a56, seams: 5 });
    const lampGlow = Pbasic("prop.lampglow", "panel", { base: 0xffe6a8, seams: 1, tile: 2 });

    skyDome(a, { top: [0x64, 0x72, 0x84], bottom: [0xcc, 0xc6, 0xb4], clouds: 9, cloud: "#f0ece0", curve: 1.5, capColor: 0x5a6879 });
    // Low industrial horizon, not a downtown — silos and stacks, kept
    // short so the yard's own container walls stay the tallest thing.
    skyline(a, {
      radius: 190, count: 20, minH: 14, varH: 26, sink: 8,
      haze: 0x6e7076, near: 0x2c3038, lit: 0.02,
    });
    ground(a, dirt);
    // Ground detail overlay at a different tile size and 45°, so the dirt
    // stops showing an obvious repeating grid of the same oil stains.
    (() => {
      const overlay = stableOverlay(M("arena.junkyard.dirt", 0x6f6250, 17, { transparent: true, opacity: 0.45 }));
      const g = ground(a, overlay, 0.03, 17, 300);
      g.rotation.z = Math.PI / 4;
      g.renderOrder = 1;
    })();

    /* ---- the shed ------------------------------------------------------
       A proper 14 m industrial shed you drive through, not a 9 m box.
       Two open bays on the south face, a monitor roof, and roller doors
       on the ends so it reads as working plant. */
    const shedX = -50, shedZ = -62, shedW = 74, shedD = 36, shedH = 14;
    [[-30, 13], [0, 8], [30, 13]].forEach(([ox, w]) => {
      block(a, w, shedH, 3, wh, shedX + ox, shedZ + shedD / 2, { map: "#7d7f83", tile: 4.4 });
    });
    block(a, 3, shedH, shedD, wh, shedX - shedW / 2, shedZ, { tile: 4.4 });
    block(a, 3, shedH, shedD, wh, shedX + shedW / 2, shedZ, { tile: 4.4 });
    block(a, shedW, shedH, 3, wh, shedX, shedZ - shedD / 2, { map: "#7d7f83", tile: 4.4 });
    box(a, shedW + 3, 1.0, shedD + 3, rustPanel, shedX, shedH + 0.5, shedZ, 0, 4);
    box(a, shedW * 0.4, 2.4, shedD * 0.5, rustPanel, shedX, shedH + 2.0, shedZ, 0, 4); // clerestory monitor
    // Roller doors + hazard stripes on the bay jambs.
    [[-17.5], [17.5]].forEach(([ox]) => {
      mesh(a, boxGeo(1.2, shedH, 3.2, 2.6), hazardM, shedX + ox, shedH / 2, shedZ + shedD / 2);
    });
    mesh(a, boxGeo(shedW, 1.6, 0.4, 4), hazardM, shedX, shedH - 0.9, shedZ + shedD / 2 + 1.7);
    // Painted yard signage on the shed's long face.
    wallSign(a, shedX - 18, 8.5, shedZ + shedD / 2 + 1.6, 22, 9, 0, {
      key: "prop.wallsign.yard", bg: "#7a4a1e", ink: "#f0e4c8", tag: true,
    });
    wallSign(a, shedX + 22, 8.0, shedZ + shedD / 2 + 1.6, 14, 7, 0, {
      key: "prop.wallsign.yard2", bg: "#2f4f6a", tag: true,
    });
    // Site office bolted to the shed's west end.
    building(a, shedX - shedW / 2 - 12, shedZ + 6, 20, 16, {
      storeys: 2, facade: officeFacade, roof: rustPanel, map: "#5f6168", ac: false,
    });

    /* ---- container canyon ---------------------------------------------
       Stacked three high in places so the yard has corridors and blind
       corners instead of one open field of scattered crates. */
    function stack(x, z, ry, high) {
      for (let i = 0; i < high; i += 1) {
        const m = i % 2 ? container : container2;
        block(a, 13.5, 3.6, 5.2, m, x + (i % 2 ? 0.5 : -0.4), z + (i === 2 ? 0.6 : 0), {
          ry, base: i * 3.6, map: "#a8452e", tile: 5.6,
        });
      }
    }
    [[30, -50, 0, 3], [52, -50, 0, 2], [52, -28, Math.PI / 2, 3], [-40, 44, 0, 2],
     [-62, 44, 0, 3], [66, 54, Math.PI / 2, 2], [-8, 70, 0, 3], [24, 74, 0, 2],
     [78, -6, Math.PI / 2, 3], [-78, 6, Math.PI / 2, 2]].forEach(([x, z, ry, h]) => stack(x, z, ry, h));

    // Drivable container catwalk: two ramps up to a raised run.
    deck(a, 42, 6.4, 3.6, container, 20, 20, 0.6, 5.6);
    ramp(a, 6.4, 13, 0, 3.6, "x", scrap, -7.5, 20);
    ramp(a, 6.4, 13, 3.6, 0, "x", scrap, 47.5, 20);
    // Second tier over the first — a proper catwalk you can be shot off.
    deck(a, 22, 6.4, 7.2, container2, 20, 20, 0.6, 5.6);
    ramp(a, 6.4, 14, 3.6, 7.2, "x", scrap, 1, 20);
    a.minimap.push({ x: 20, z: 20, hw: 21, hd: 3.2, color: "#a8452e" });

    /* Scrap mountains. A smooth cone reads as a grey pyramid and nothing
       else; a heap of tumbled slabs and a couple of crushed shells reads
       as a scrapyard from any angle. */
    const sheetM = P("prop.sheet", "panel", { tile: 2.4, base: 0x6e6a62, seams: 3 });
    [[-22, -18, 9, 0.3], [72, -14, 7, 1.1], [-72, -22, 10, 2.0], [8, 60, 8, 0.7], [78, 30, 6, 2.6], [-34, 12, 7, 1.6]]
      .forEach(([x, z, r, seed]) => {
        const layers = 4;
        for (let i = 0; i < layers; i += 1) {
          const t = i / layers;
          const lr = r * (1 - t * 0.72);
          const ly = r * 0.22 * i;
          const n = 5 + ((i + seed * 3) | 0) % 3;
          for (let k = 0; k < n; k += 1) {
            const ang = (k / n) * Math.PI * 2 + seed + i * 0.7;
            const rad = lr * (0.35 + ((k * 37 + i * 13) % 60) / 100);
            const s = r * (0.28 + ((k * 53) % 40) / 160);
            mesh(a, boxGeo(s * 1.7, s * 0.7, s * 1.3, 2.4),
              (k + i) % 3 === 0 ? sheetM : scrap,
              x + Math.cos(ang) * rad, ly + s * 0.35, z + Math.sin(ang) * rad,
              ang + seed);
          }
        }
        mesh(a, boxGeo(r * 0.7, r * 0.5, r * 0.6, 2.4), scrap, x, r * 0.85, z, seed);
        a.colliders.push({ x, z, hw: r * 0.72, hd: r * 0.72, base: 0, top: r * 0.95 });
        a.minimap.push({ x, z, hw: r * 0.7, hd: r * 0.7, color: "#5c5147" });
      });
    // Concrete apron under the working plant — value contrast against mud.
    [[0, -20, 34, 22], [-50, -34, 60, 14], [20, 20, 48, 14]].forEach(([x, z, w, d]) => {
      flatOverlay(a, w, d, stableOverlay(P("prop.concrete.apron", "sidewalk", { tile: 6, base: 0x8e8a80, slabs: 2 })), x, 0.06, z, 2, 6);
    });
    // Standing water — dark, still, and the only specular-looking thing
    // in the yard, so the eye lands on it.
    [[-14, -52], [44, 44], [-62, 62], [64, -46]].forEach(([x, z], i) => {
      flatOverlay(a, 12 + i * 3, 8 + i * 2, stableOverlay(M("arena.junkyard.dirt", 0x2a2a2e, 9, { transparent: true, opacity: 0.85 })), x, 0.08, z, 4, 9);
    });
    // Tyre stacks — cheap, unmistakably a scrapyard.
    [[-14, 34], [46, -12], [-56, -14], [14, -66], [62, 22], [-30, -46]].forEach(([x, z]) => {
      for (let i = 0; i < 4; i += 1) {
        mesh(a, uvRadial(new THREE.CylinderGeometry(1.1, 1.1, 0.45, 10), 1.1, 0.45, 1.6), P("prop.tyre", "panel", { tile: 1.6, base: 0x24242a, seams: 8 }), x + (i % 2) * 0.2, 0.24 + i * 0.44, z);
      }
      a.colliders.push({ x, z, hw: 1.2, hd: 1.2, base: 0, top: 1.8 });
    });
    // Wrecked-car piles: the most legible scale reference in the game.
    [[-46, 6, 0.5], [-46, 6, 2.1], [40, 6, 1.2], [40, 6, 2.9], [-4, 42, 0.3], [-4, 42, 1.9], [58, -68, 0.8], [58, -68, 2.4]]
      .forEach(([x, z, ry], i) => junkCar(a, x + (i % 2 ? 1.2 : -1.2), z + (i % 2 ? 0.6 : -0.8), M("arena.junkyard.scrap", 0x6a5a4a, 2.4), M("arena.junkyard.container_b", 0x3f5a6a, 2), ry, { crushed: i % 3 === 0, y: i % 2 ? 1.1 : 0 }));
    [[-44, 8], [10, -38], [40, 8], [-8, 40], [58, 70], [-76, 64], [30, -70], [66, -34], [-20, 76]].forEach(([x, z]) => barrel(a, x, z, drum));
    // Mid-yard clutter: pallet stacks, pipe runs, a skip. The middle used
    // to be an empty parade ground you crossed without seeing anything.
    [[-16, 6, 0.3], [26, -4, 1.2], [4, 26, 2.4], [-34, -30, 0.8], [52, 34, 1.9]].forEach(([x, z, ry]) => {
      for (let i = 0; i < 3; i += 1) {
        mesh(a, boxGeo(2.6, 0.5, 2.0, 2.2), M("prop.crate", 0x9a7a4a, 2.2), x, 0.26 + i * 0.55, z + (i % 2) * 0.3, ry);
      }
      a.colliders.push({ x, z, hw: 1.4, hd: 1.2, base: 0, top: 1.7 });
    });
    [[12, 12, 0], [-28, 40, 1.4], [44, -40, 0.6]].forEach(([x, z, ry]) => {
      for (let i = 0; i < 4; i += 1) {
        const pipe = mesh(a, uvRadial(new THREE.CylinderGeometry(0.65, 0.65, 7, 9), 0.65, 7, 2.6), rustPanel,
          x + (i % 2) * 1.4, 0.66 + Math.floor(i / 2) * 1.2, z, ry);
        pipe.rotation.z = Math.PI / 2;
        pipe.rotation.y = ry;
      }
      a.colliders.push({ x, z, hw: 3.6, hd: 1.6, base: 0, top: 2.0 });
    });
    [[-6, -46], [58, 8], [-56, 24]].forEach(([x, z], i) => {
      block(a, 6.5, 2.4, 3.0, i % 2 ? container : container2, x, z, { tile: 5.6, map: "#7a4436" });
      mesh(a, boxGeo(6.8, 0.3, 3.2, 2.6), rustPanel, x, 2.55, z);
    });
    // Floodlight masts — the yard's vertical rhythm.
    [[-30, 30], [40, -34], [-66, 34], [70, 66], [4, -76]].forEach(([x, z]) => {
      mesh(a, uvRadial(new THREE.CylinderGeometry(0.28, 0.42, 18, 6), 0.35, 18, 3), poleM, x, 9, z);
      mesh(a, boxGeo(4.0, 1.0, 0.5, 2), poleM, x, 18.2, z);
      const lamp = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.8), lampGlow);
      lamp.position.set(x, 17.6, z + 0.3);
      lamp.rotation.x = 0.6;
      a.group.add(lamp);
      // Floodlights throw a wide, cold pool across the yard.
      lightPool(a, x, z + 5, 26, { tint: "222,232,246", core: 0.4 });
      a.colliders.push({ x, z, hw: 0.5, hd: 0.5, base: 0, top: 4 });
    });
    /* ---- the yard's big iron -------------------------------------------
       The middle of the yard was 100 m of open dirt you crossed without
       passing anything. A gantry crane, a sorting conveyor and a rail
       spur give it a spine, sightline breaks and things to fight around. */
    // Gantry crane: two leg towers on rails with a box girder across.
    (() => {
      const gz = 36, span = 62, gh = 20;
      [-span / 2, span / 2].forEach((ox) => {
        [-3.4, 3.4].forEach((oz) => {
          mesh(a, boxGeo(1.5, gh, 1.5, 3), crushM, ox, gh / 2, gz + oz);
        });
        for (let i = 0; i < 5; i += 1) {
          mesh(a, boxGeo(1.4, 0.35, 8.0, 3), crushM, ox, 2.4 + i * 4.0, gz);
        }
        mesh(a, boxGeo(3.2, 1.1, 9.5, 3), hazardM, ox, 0.55, gz);
        a.colliders.push({ x: ox, z: gz, hw: 2.0, hd: 5.0, base: 0, top: 3.0 });
      });
      mesh(a, boxGeo(span + 6, 2.6, 3.0, 4), crushM, 0, gh + 1.2, gz);
      mesh(a, boxGeo(span + 6, 0.5, 4.6, 4), hazardM, 0, gh - 0.3, gz);
      // Trolley and hanging magnet.
      mesh(a, boxGeo(5.0, 2.0, 4.4, 3), crushM, -14, gh - 1.2, gz);
      mesh(a, boxGeo(0.3, 7, 0.3, 2), poleM, -14, gh - 5.6, gz);
      mesh(a, uvRadial(new THREE.CylinderGeometry(2.8, 3.2, 1.6, 12), 3, 1.6, 2.6), hazardM, -14, gh - 9.6, gz);
      a.minimap.push({ x: 0, z: gz, hw: span / 2, hd: 2, color: "#b08a20" });
    })();
    // Sorting conveyor on legs, running out of the shed.
    (() => {
      const x0 = -16, z0 = -30, len = 44;
      for (let i = 0; i <= 6; i += 1) {
        const t = i / 6;
        mesh(a, boxGeo(0.5, 5.5 + t * 3.5, 0.5, 2.4), poleM, x0 + t * len, (5.5 + t * 3.5) / 2, z0);
        mesh(a, boxGeo(0.4, 0.4, 2.6, 2.4), poleM, x0 + t * len, 5.2 + t * 3.5, z0);
      }
      const belt = mesh(a, boxGeo(len, 0.6, 2.4, 4), rustPanel, x0 + len / 2, 7.4, z0);
      belt.rotation.z = -Math.atan2(3.5, len);
      mesh(a, boxGeo(len, 0.25, 3.0, 4), poleM, x0 + len / 2, 6.9, z0).rotation.z = -Math.atan2(3.5, len);
      a.colliders.push({ x: x0 + len / 2, z: z0, hw: len / 2, hd: 1.0, base: 0, top: 5.0 });
      a.minimap.push({ x: x0 + len / 2, z: z0, hw: len / 2, hd: 1.4, color: "#7d6a56" });
    })();
    // Rail spur with two freight wagons parked on it.
    (() => {
      const z = 68;
      for (let i = -11; i <= 11; i += 1) {
        mesh(a, boxGeo(1.0, 0.18, 3.2, 2), M("arena.cemetery.wood", 0x4e3a26, 2.2), i * 8, 0.12, z);
      }
      [-1.0, 1.0].forEach((o) => box(a, 186, 0.22, 0.2, poleM, 0, 0.28, z + o, 0, 3));
      [[-34, 0], [12, 0]].forEach(([wx]) => {
        block(a, 18, 4.4, 3.4, container2, wx, z, { tile: 5.6, map: "#3f6f8a" });
        mesh(a, boxGeo(19, 0.5, 4.0, 4), rustPanel, wx, 4.7, z);
        [-6, 6].forEach((o) => {
          [-1.3, 1.3].forEach((oz) => {
            const w = mesh(a, uvRadial(new THREE.CylinderGeometry(0.6, 0.6, 0.3, 10), 0.6, 0.3, 1.4), poleM, wx + o, 0.6, z + oz);
            w.rotation.z = Math.PI / 2;
          });
        });
      });
    })();
    // Chain-link boundary with the gates standing open.
    [[-46, -92, 60, "x"], [40, -92, 50, "x"], [-92, -20, 70, "z"], [92, 10, 80, "z"], [-30, 88, 70, "x"], [46, 88, 50, "x"]]
      .forEach(([x, z, len, axis]) => chainFence(a, x, z, len, axis, poleM, 4.2));

    // Refinery stacks and silos beyond the fence — the thing that says
    // "industrial edge of town" faster than any amount of ground clutter.
    const stackM = new THREE.MeshBasicMaterial({ map: PROC().tex("panel", { base: 0x4c4a48, seams: 3, seed: 31 }), fog: false });
    const bandM = new THREE.MeshBasicMaterial({ map: PROC().tex("hazard", { a: "#8a6a2a", b: "#33343a", seed: 12 }), fog: false });
    [[-150, -150, 46], [-120, 160, 38], [165, -120, 52], [140, 150, 34], [-185, 20, 42], [30, -190, 44]].forEach(([x, z, h], i) => {
      const s = new THREE.Mesh(uvRadial(new THREE.CylinderGeometry(3.4, 5.0, h, 10), 4.2, h, 14), stackM);
      s.position.set(x, h / 2 - 4, z);
      s.renderOrder = -14;
      a.group.add(s);
      const band = new THREE.Mesh(uvRadial(new THREE.CylinderGeometry(3.6, 3.6, 5, 10), 3.6, 5, 5), bandM);
      band.position.set(x, h - 10, z);
      band.renderOrder = -14;
      a.group.add(band);
      if (i % 2 === 0) {
        const silo = new THREE.Mesh(uvRadial(new THREE.CylinderGeometry(9, 9, 22, 12), 9, 22, 12), stackM);
        silo.position.set(x + 24, 7, z + 16);
        silo.renderOrder = -14;
        a.group.add(silo);
      }
    });

    /* ---- THE CRUSHER --------------------------------------------------- */
    const crusherX = 0, crusherZ = -20;
    block(a, 3.0, 13, 9, crushM, crusherX - 7.5, crusherZ, { tile: 3.2 });
    block(a, 3.0, 13, 9, crushM, crusherX + 7.5, crusherZ, { tile: 3.2 });
    box(a, 18, 1.8, 9, crushM, crusherX, 13, crusherZ, 0, 3.2);
    box(a, 18, 0.8, 1.2, hazardM, crusherX, 11.8, crusherZ + 4.8, 0, 2.6);
    mesh(a, boxGeo(16, 0.6, 8, 5), concreteM, crusherX, 0.16, crusherZ); // press bed
    const press = box(a, 12.5, 2.8, 7.4, hazardM, crusherX, 8, crusherZ, 0, 2.6);
    a.minimap.push({ x: crusherX, z: crusherZ, hw: 8, hd: 4, color: "#b08a20" });
    let crushT = 0;
    a.update = (dt, ctx) => {
      crushT += dt;
      const cycle = crushT % 4.2;
      // hold high 0..2.4, slam 2.4..2.7, hold low, rise
      let y;
      if (cycle < 2.4) y = 8;
      else if (cycle < 2.7) y = 8 - ((cycle - 2.4) / 0.3) * 6.2;
      else if (cycle < 3.4) y = 1.8;
      else y = 1.8 + ((cycle - 3.4) / 0.8) * 6.2;
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

    perimeter(a, wh, 4, true); // chain-link + container walls carry the edge
    spawnCircle(a, 62);
    scatterPickups(a, [[20, 20], [-51, -40], [30, -30], [-30, 60], [70, -40], [-80, 20], [0, 76], [80, 76], [-80, -40], [46, 44], [-50, -62]]);
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
    const asphalt = M("arena.highway.asphalt", 0x53535b, 7);
    const concrete = M("arena.highway.concrete", 0x9a948a, 6);
    const railM = M("arena.highway.rail", 0xb8b2a4, 3);
    const coneM = M("arena.highway.cone", 0xe8762e, 1.2);
    const truckM = M("arena.highway.truck", 0xd8d2c4, 3.4);
    const pierM = P("prop.pier", "sidewalk", { tile: 5.5, base: 0x8e8a80, slabs: 1 });
    const poleM = P("prop.pole", "panel", { tile: 3, base: 0x4a4c52, seams: 2 });
    const signM = Pbasic("prop.roadsign", "billboard", { bg: "#1f5c3a", ink: "#f0f0e6", band: "#14402a", tile: 6 });
    const soundwallM = P("prop.soundwall", "soundwall", { tile: 6.5, tileV: 9, base: 0x8a8378, panels: 3 });
    const cityFacade = P("prop.facade.city", "facade", { tile: 7.2, tileV: STOREY, base: 0x74757c, cols: 5, lit: 0.18 });
    const lampGlow = Pbasic("prop.lampglow", "panel", { base: 0xffe6a8, seams: 1, tile: 2 });

    skyDome(a, { top: [0x6a, 0x74, 0x8c], bottom: [0xd8, 0xc6, 0xa2], clouds: 8, cloud: "#f0e8d4", curve: 1.7, capColor: 0x5c6479 });
    skyline(a, { radius: 215, count: 28, minH: 34, varH: 70, sink: 10, haze: 0xb2a894, near: 0x424654, lit: 0.16 });
    ground(a, asphalt);
    a.minimap.push({ x: 0, z: 0, hw: 100, hd: 100, color: "#53535b" });
    // Ground-level street markings so the infield reads as road, not a mat.
    [-70, -35, 35, 70].forEach((o) => {
      laneLine(a, o, 0, 190, "z", { dash: true, color: "#e6e2d4", tile: 10 });
      laneLine(a, 0, o, 190, "x", { dash: true, color: "#e6e2d4", tile: 10 });
    });

    // DECK A: elevated ring (y=6) — four straights + corner pads.
    const R = 52, W = 14, y1 = 6;
    deck(a, R * 2 + W, W, y1, concrete, 0, -R, 1.4);
    deck(a, R * 2 + W, W, y1, concrete, 0, R, 1.4);
    deck(a, W, R * 2 - W, y1, concrete, -R, 0, 1.4);
    deck(a, W, R * 2 - W, y1, concrete, R, 0, 1.4);
    // Painted lanes on the ring so the decks aren't blank grey ribbons.
    laneLine(a, 0, -R, R * 2 + W, "x", { dash: true, color: "#f0ead8", tile: 9, y: y1 + 0.04 });
    laneLine(a, 0, R, R * 2 + W, "x", { dash: true, color: "#f0ead8", tile: 9, y: y1 + 0.04 });
    laneLine(a, -R, 0, R * 2 - W, "z", { dash: true, color: "#f0ead8", tile: 9, y: y1 + 0.04 });
    laneLine(a, R, 0, R * 2 - W, "z", { dash: true, color: "#f0ead8", tile: 9, y: y1 + 0.04 });
    a.minimap.push({ x: 0, z: -R, hw: R + W / 2, hd: W / 2, color: "#9a948a" });
    a.minimap.push({ x: 0, z: R, hw: R + W / 2, hd: W / 2, color: "#9a948a" });
    a.minimap.push({ x: -R, z: 0, hw: W / 2, hd: R - W / 2, color: "#9a948a" });
    a.minimap.push({ x: R, z: 0, hw: W / 2, hd: R - W / 2, color: "#9a948a" });
    /* Piers under the ring. A highway deck held up by 1.4 m sticks reads
       as a model kit; these are proper bent-and-cap piers with a pier cap
       spanning the deck, which is most of what sells the structure. */
    ring(14, R, (x, z, ang) => {
      mesh(a, uvRadial(new THREE.CylinderGeometry(1.9, 2.4, y1 - 0.9, 8), 2.1, y1, 5), pierM, x, (y1 - 0.9) / 2, z);
      const along = Math.abs(Math.cos(ang)) > Math.abs(Math.sin(ang));
      mesh(a, boxGeo(along ? 3.4 : W + 3, 1.1, along ? W + 3 : 3.4, 5), pierM, x, y1 - 1.4, z);
      a.colliders.push({ x, z, hw: 2.2, hd: 2.2, base: 0, top: y1 - 1.0 });
    });
    // Deck fascia beam so the underside isn't a floating slab edge.
    [[0, -R - W / 2], [0, R + W / 2]].forEach(([x, z]) => box(a, R * 2 + W, 1.3, 0.7, pierM, x, y1 - 1.4, z, 0, 5));
    [[-R - W / 2, 0], [R + W / 2, 0]].forEach(([x, z]) => box(a, 0.7, 1.3, R * 2 - W, pierM, x, y1 - 1.4, z, 0, 5));
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
    [[-20, -70], [26, 64], [-70, 30], [64, -18], [-58, -46]].forEach(([cx, cz]) => {
      for (let i = 0; i < 6; i += 1) {
        const m = mesh(a, new THREE.ConeGeometry(0.5, 1.2, 6), coneM, cx + i * 2.2, 0.6, cz + (i % 2) * 2);
        destructible(a, m, m.position.x, m.position.z, 0.5, 0.5, 3, { score: 5 });
      }
      barrierRun(a, cx + 6, cz - 4, 16, "x", pierM);
    });

    /* ---- the stuff that makes it a real interchange -------------------
       Overhead sign gantries, sound walls along the outside, streetlights
       marching down the decks, and a downtown block beyond the fence. */
    [[0, -R, 0], [0, R, 0], [-R, 0, Math.PI / 2], [R, 0, Math.PI / 2]].forEach(([x, z, ry]) => {
      const g = new THREE.Group();
      [-W / 2 - 1, W / 2 + 1].forEach((o) => {
        const leg = new THREE.Mesh(uvRadial(new THREE.CylinderGeometry(0.3, 0.38, 7, 6), 0.34, 7, 3), poleM);
        leg.position.set(o, y1 + 3.5, 0);
        g.add(leg);
      });
      const truss = new THREE.Mesh(boxGeo(W + 3, 0.45, 0.45, 3), poleM);
      truss.position.set(0, y1 + 7, 0);
      const panel = new THREE.Mesh(boxGeo(W * 0.62, 3.0, 0.3, W * 0.31, 3.0), signM);
      panel.position.set(0, y1 + 5.3, -0.3);
      g.add(truss, panel);
      g.position.set(x, 0, z);
      g.rotation.y = ry;
      a.group.add(g);
    });
    for (let i = -3; i <= 3; i += 1) {
      streetlight(a, i * 24, -R - W / 2 + 1.2, poleM, lampGlow, Math.PI / 2, 8);
      streetlight(a, i * 24, R + W / 2 - 1.2, poleM, lampGlow, -Math.PI / 2, 8);
    }
    // Sodium lamps under the deck — the only light down there, and the
    // reason the infield reads as a place rather than a grey floor.
    ring(10, R * 0.62, (x, z) => {
      lightPool(a, x, z, 15, { tint: "255,178,96", core: 0.5 });
    });
    lightPool(a, 0, 0, 26, { tint: "255,190,110", core: 0.42 });
    /* ---- the outer edge ------------------------------------------------
       This used to be one unbroken 190 m sound wall per side, and it kept
       losing comparisons for the obvious reason: a blank slab you can
       drive along for six seconds is not scenery. Each side is now five
       segments cycling through sound wall, chain-link with the city
       showing through, a planted embankment, and the back of a building.
       You always have something different within a car length. */
    [[0, -96, "x", 1], [0, 96, "x", -1], [-96, 0, "z", 1], [96, 0, "z", -1]]
      .forEach(([wx, wz, axis, face], wi) => {
        const SEG = 5;
        const segLen = 190 / SEG;
        for (let i = 0; i < SEG; i += 1) {
          const t = (i - (SEG - 1) / 2) * segLen;
          const cx = axis === "x" ? wx + t : wx;
          const cz = axis === "x" ? wz : wz + t;
          const w = axis === "x" ? segLen : 1.4;
          const d = axis === "x" ? 1.4 : segLen;
          const kind = (i + wi) % 4;

          if (kind === 0 || kind === 3) {
            // Precast sound wall with a coping cap and painted tags.
            box(a, w, 9, d, soundwallM, cx, 4.5, cz, 0, 6.5, 9);
            box(a, w + 0.9, 0.8, d + 0.9, pierM, cx, 9.4, cz, 0, 4);
            for (let k = 0; k <= 3; k += 1) {
              const kt = (k / 3 - 0.5) * segLen;
              box(a, axis === "x" ? 1.2 : 2.2, 9.6, axis === "x" ? 2.2 : 1.2, pierM,
                axis === "x" ? cx + kt : cx, 4.8, axis === "x" ? cz : cz + kt, 0, 4);
            }
            for (let k = 0; k < 2; k += 1) {
              const kt = (k - 0.5) * segLen * 0.5;
              wallSign(a,
                axis === "x" ? cx + kt : cx + face * 0.85,
                5.0,
                axis === "x" ? cz + face * 0.85 : cz + kt,
                15, 6.2,
                axis === "x" ? (face > 0 ? 0 : Math.PI) : (face > 0 ? Math.PI / 2 : -Math.PI / 2),
                {
                  key: `prop.wallsign.hwy${wi}${i}${k}`,
                  bg: (i + k) % 3 === 0 ? "#2f4f7a" : ((i + k) % 3 === 1 ? "#7a3320" : "#3f6a3a"),
                  tag: true, tagInk: (i + k) % 2 ? "#e8e05a" : "#5eeaff", panel: (i + k) % 3 !== 1,
                });
            }
          } else if (kind === 1) {
            // Chain-link on a low kerb: you can see the city through it.
            box(a, w, 1.1, d, pierM, cx, 0.55, cz, 0, 4);
            chainFence(a, cx, cz, segLen, axis === "x" ? "x" : "z", poleM, 6.0);
            for (let k = 0; k < 3; k += 1) {
              const kt = (k - 1) * segLen * 0.33;
              streetlight(a,
                axis === "x" ? cx + kt : cx - face * 3,
                axis === "x" ? cz - face * 3 : cz + kt,
                poleM, lampGlow,
                axis === "x" ? (face > 0 ? Math.PI / 2 : -Math.PI / 2) : (face > 0 ? Math.PI : 0), 9);
            }
          } else {
            // Planted embankment climbing to a retaining wall.
            box(a, w, 3.4, d, pierM, cx, 1.7, cz, 0, 4);
            const bank = axis === "x" ? boxGeo(w, 5.5, 9, 6) : boxGeo(9, 5.5, d, 6);
            const m = new THREE.Mesh(bank, M("arena.suburb.grass", 0x5e7a3a, 7));
            m.position.set(
              axis === "x" ? cx : cx + face * 5,
              2.0,
              axis === "x" ? cz + face * 5 : cz
            );
            m.rotation.x = axis === "x" ? face * 0.24 : 0;
            m.rotation.z = axis === "z" ? -face * 0.24 : 0;
            a.group.add(m);
            for (let k = 0; k < 4; k += 1) {
              const kt = (k / 3 - 0.5) * segLen * 0.8;
              tree(a,
                axis === "x" ? cx + kt : cx + face * 7,
                axis === "x" ? cz + face * 7 : cz + kt,
                M("arena.shared.trunk", 0x5a4230, 2.4),
                M("arena.shared.leaf", 0x40662c, 3), 1.15);
            }
          }
          a.colliders.push({ x: cx, z: cz, hw: w / 2, hd: d / 2, base: 0, top: 9 });
        }
      });

    // Downtown block outside the sound wall, so the horizon has depth
    // between the wall and the painted skyline.
    [[-70, -128, 30, 26], [10, -136, 34, 28], [78, -124, 26, 24],
     [-124, -30, 26, 32], [-134, 50, 28, 30], [128, -40, 26, 30], [136, 46, 30, 26],
     [-60, 132, 32, 26], [30, 140, 28, 30], [104, 126, 26, 26]].forEach(([x, z, w, d], i) => {
      building(a, x, z, w, d, {
        storeys: 5 + (i % 5), facade: cityFacade, roof: pierM, solid: false, ac: i % 2 === 0,
      });
    });
    billboardSign(a, -104, -70, Math.PI / 4, { leg: poleM, w: 20, h: 9, y: 17, bg: "#c8452e", key: "prop.billboard.hwy" });
    billboardSign(a, 108, 62, -Math.PI * 0.75, { leg: poleM, w: 18, h: 8, y: 16, bg: "#2f5f9a", key: "prop.billboard.hwy2" });

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

    perimeter(a, railM, 4, true); // sound walls are the visible boundary
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
      sky: 0x3a2a5c,
      fog: { color: 0x5a3f86, near: 78, far: 250 },
      hemi: { sky: 0xd6b0ff, ground: 0x3e2f52, intensity: 1.25 },
      sun: { color: 0xffc8e4, intensity: 1.0, x: -50, y: 60, z: -40 },
      bounds: { hw: 100, hd: 85 },
    });
    const planks = M("arena.boardwalk.planks", 0x9a6f42, 4.5);
    const tent = M("arena.boardwalk.tent", 0xd23f6e, 3.2);
    const tentB = M("arena.boardwalk.tent_b", 0xe8b52e, 3.2);
    const track = M("arena.boardwalk.track", 0xd8d2c8, 4);
    const sea = M("arena.boardwalk.sea", 0x264a6e, 12);
    const fun = M("arena.boardwalk.funhouse", 0x8a2ec9, 4.4);
    const neon = Mbasic("arena.boardwalk.neon", 0xff5ea8, 2);
    const poleM = P("prop.pole", "panel", { tile: 3, base: 0x4a4c52, seams: 2 });
    const pilingM = P("prop.piling", "panel", { tile: 2.6, base: 0x53422f, seams: 2 });
    const arcadeFacade = P("prop.facade.arcade", "facade", { tile: 7.2, tileV: STOREY, base: 0x4a3a6a, cols: 4, lit: 0.55, litColor: "#ff9ad2", glass: "#1a1030" });
    const arcadeFront = P("prop.storefront.arcade", "storefront", { tile: 7, base: 0x53406e, awning: "#e0357a", sign: "#120b22", signInk: "#5eeaff" });
    const neonBlue = Mbasic("prop.neon.blue", 0x5eeaff, 2);
    const neonGold = Mbasic("prop.neon.gold", 0xffd35e, 2);

    skyDome(a, {
      top: [0x12, 0x0c, 0x2c], bottom: [0xd8, 0x58, 0x8a], curve: 2.6,
      clouds: 6, cloud: "#ffb0d8", stars: true, capColor: 0x0e0a24,
    });
    ground(a, planks, 0, undefined, 30);
    // Deck plank direction change on the cross-promenade, so the boards
    // aren't one uninterrupted 200 m sheet.
    flatOverlay(a, 40, 190, stableOverlay(M("arena.boardwalk.planks", 0x8a6238, 4.5)), 0, 0.05, 0, 2, 4.5, 4.5);

    /* ---- the sea and the pier edge ------------------------------------ */
    const water = mesh(a, planeGeo(300, 120, 14), sea, 0, -1.6, 132);
    water.rotation.x = -Math.PI / 2;
    a.slowZones.push({ x: 0, z: 88, hw: 105, hd: 12, factor: 0.4 });
    a.minimap.push({ x: 0, z: 84, hw: 100, hd: 5, color: "#264a6e" });
    // Pier deck edge + pilings marching out over the water.
    box(a, 210, 1.6, 3, planks, 0, -0.3, 86, 0, 4.5);
    for (let i = -12; i <= 12; i += 1) {
      const px = i * 8.5;
      mesh(a, uvRadial(new THREE.CylinderGeometry(0.55, 0.7, 7, 6), 0.6, 7, 2.6), pilingM, px, -3.2, 86);
      if (i % 2 === 0) mesh(a, uvRadial(new THREE.CylinderGeometry(0.5, 0.6, 6, 6), 0.55, 6, 2.6), pilingM, px, -3.6, 96);
      mesh(a, boxGeo(1.1, 1.4, 1.1, 2), pilingM, px, 0.7, 86);
      mesh(a, boxGeo(0.7, 0.9, 3.2, 2), pilingM, px, 1.6, 86.5);
    }
    // Railing along the sea edge.
    for (let i = -13; i <= 13; i += 1) {
      mesh(a, boxGeo(0.2, 1.2, 0.2, 1.5), poleM, i * 8, 1.1, 84.4);
    }
    box(a, 210, 0.18, 0.18, poleM, 0, 1.7, 84.4, 0, 3);

    /* ---- FERRIS WHEEL -------------------------------------------------
       28 m tall with a real A-frame, spokes, and lit gondolas. It is the
       arena's landmark; you should be able to navigate by it. */
    const wheelR = 17;
    const wheelY = 22;
    const wheelG = new THREE.Group();
    const spokeM = track;
    ring(14, wheelR, (x, y, ang) => {
      const pod = new THREE.Mesh(boxGeo(2.6, 2.8, 2.4, 2.6), (Math.round(ang * 3) % 2) ? tentB : tent);
      pod.position.set(x, y, 0);
      wheelG.add(pod);
      const bar = new THREE.Mesh(boxGeo(0.24, wheelR, 0.24, 3), spokeM);
      bar.position.set(x / 2, y / 2, 0);
      bar.rotation.z = ang - Math.PI / 2;
      wheelG.add(bar);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.34, 5, 4), (Math.round(ang * 3) % 2) ? neonBlue : neonGold);
      bulb.position.set(x * 1.06, y * 1.06, 0.9);
      wheelG.add(bulb);
    });
    [wheelR, wheelR * 0.55].forEach((r, i) => {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.34, 5, 22), i ? spokeM : neonGold);
      wheelG.add(rim);
    });
    wheelG.position.set(-68, wheelY, -52);
    a.group.add(wheelG);
    // A-frame legs + hub.
    [[-6, 0], [6, 0]].forEach(([ox]) => {
      [-1, 1].forEach((s) => {
        const leg = new THREE.Mesh(boxGeo(0.9, wheelY + 2, 0.9, 3), spokeM);
        leg.position.set(-68 + ox * 0.35, (wheelY) / 2, -52 + s * 7);
        leg.rotation.x = -s * 0.28;
        leg.rotation.z = ox > 0 ? -0.1 : 0.1;
        a.group.add(leg);
      });
    });
    mesh(a, uvRadial(new THREE.CylinderGeometry(1.5, 1.5, 4, 8), 1.5, 4, 3), spokeM, -68, wheelY, -52, 0).rotation.x = Math.PI / 2;
    a.colliders.push({ x: -68, z: -45, hw: 2.2, hd: 1.6, base: 0, top: 5 });
    a.colliders.push({ x: -68, z: -59, hw: 2.2, hd: 1.6, base: 0, top: 5 });
    a.minimap.push({ x: -68, z: -52, hw: 8, hd: 8, color: "#e8b52e" });
    lightPool(a, -68, -52, 34, { tint: "255,196,120", core: 0.5 });

    /* ---- arcade block + funhouse -------------------------------------- */
    // A row of two-storey arcade fronts closing the north edge.
    [[-52, -88, 34, 16], [-8, -90, 30, 14], [30, -88, 26, 16], [74, -86, 24, 14]].forEach(([x, z, w, d], i) => {
      building(a, x, z, w, d, {
        storeys: 2, facade: arcadeFacade, base: arcadeFront, roof: fun, map: "#4a3a6a",
      });
      // Neon band over the shopfront, and the light it throws.
      mesh(a, boxGeo(w * 0.8, 0.6, 0.3, 3), i % 2 ? neonBlue : neonGold, x, 5.6, z + d / 2 + 0.3);
      const tint = i % 2 ? "110,220,255" : "255,206,110";
      lightPanel(a, x, 4.4, z + d / 2 + 0.5, w * 1.1, 8, 0, { tint, core: 0.5 });
      lightPool(a, x, z + d / 2 + 9, 16, { tint, core: 0.6 });
      wallSign(a, x + (i % 2 ? 6 : -6), 8.6, z + d / 2 + 0.42, 11, 5.5, 0, {
        key: `prop.wallsign.pier${i}`, bg: i % 2 ? "#5a1d6a" : "#8a2f5a",
        ink: "#ffe6ff", tag: i % 2 === 0, tagInk: "#5eeaff",
      });
    });
    // Funhouse: neon box with two mouth doors, mirror pillars inside.
    block(a, 3, 9, 18, fun, 40, -58, { map: "#8a2ec9", tile: 4.4 });
    block(a, 3, 9, 18, fun, 68, -58, { map: "#8a2ec9", tile: 4.4 });
    block(a, 31, 9, 3, fun, 54, -67.5, { tile: 4.4 });
    box(a, 32, 1.2, 23, fun, 54, 9.5, -57.5, 0, 4.4); // roof
    box(a, 12, 2.2, 0.5, neon, 54, 11.0, -49.0, 0, 3); // marquee
    lightPanel(a, 54, 8.0, -48.6, 26, 12, 0, { tint: "255,120,190", core: 0.55 });
    lightPool(a, 54, -42, 20, { tint: "255,120,190", core: 0.7 });
    mesh(a, new THREE.ConeGeometry(5.5, 5, 6), tent, 54, 12.6, -57.5);
    [[48, -58], [60, -54], [54, -62]].forEach(([x, z]) => {
      mesh(a, boxGeo(1.2, 6, 1.2, 2), neon, x, 3, z);
      a.colliders.push({ x, z, hw: 0.8, hd: 0.8, base: 0, top: 5 });
    });
    // Helter-skelter / drop tower on the east side, for a second landmark.
    mesh(a, uvRadial(new THREE.CylinderGeometry(1.6, 2.6, 30, 8), 2.2, 30, 4), track, 80, 15, 20);
    for (let i = 0; i < 6; i += 1) {
      mesh(a, uvRadial(new THREE.CylinderGeometry(3.4 - i * 0.4, 3.8 - i * 0.4, 0.5, 8), 3.6, 0.5, 2), i % 2 ? tent : tentB, 80, 4 + i * 4.6, 20);
    }
    mesh(a, new THREE.ConeGeometry(4.2, 6, 8), tent, 80, 32, 20);
    a.colliders.push({ x: 80, z: 20, hw: 2.8, hd: 2.8, base: 0, top: 6 });
    lightPool(a, 80, 20, 24, { tint: "255,150,190", core: 0.5 });
    // String lights across the promenade.
    for (let i = -4; i <= 4; i += 1) {
      mesh(a, uvRadial(new THREE.CylinderGeometry(0.14, 0.2, 7, 5), 0.18, 7, 2), poleM, -80, 3.5, i * 18);
      mesh(a, uvRadial(new THREE.CylinderGeometry(0.14, 0.2, 7, 5), 0.18, 7, 2), poleM, 88, 3.5, i * 18);
      for (let k = 0; k < 5; k += 1) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.26, 5, 4), k % 2 ? neonGold : neonBlue);
        b.position.set(-80 + 4 + k * 3, 6.6 - Math.sin((k / 4) * Math.PI) * 0.9, i * 18);
        a.group.add(b);
      }
      lightPool(a, -74, i * 18, 13, { tint: "255,214,140", core: 0.42 });
      lightPool(a, 82, i * 18, 13, { tint: "150,210,255", core: 0.42 });
    }

    // COASTER: elevated figure-loop shortcut with a live train hazard.
    const cy = 7;
    deck(a, 70, 9, cy, track, -10, -20, 0.8);
    deck(a, 9, 40, cy, track, -41, 0, 0.8);
    deck(a, 70, 9, cy, track, -10, 20, 0.8);
    ramp(a, 9, 24, cy, 0, "x", track, 32, -20); // deck (east end) down to boards
    ramp(a, 9, 24, cy, 0, "x", track, 32, 20);
    // Timber trestle under the coaster run — the structure is half the read.
    const trestleM = pilingM;
    for (let i = -4; i <= 4; i += 1) {
      [[-10 + i * 8, -20, "x"], [-10 + i * 8, 20, "x"]].forEach(([tx, tz]) => {
        [-4, 4].forEach((o) => mesh(a, boxGeo(0.45, cy, 0.45, 2.6), trestleM, tx, cy / 2, tz + o));
        mesh(a, boxGeo(0.4, 0.4, 9, 2.6), trestleM, tx, cy * 0.55, tz);
        mesh(a, boxGeo(0.35, 0.35, 10, 2.6), trestleM, tx, cy * 0.8, tz).rotation.x = 0.6;
      });
    }
    for (let i = -2; i <= 2; i += 1) {
      [-4, 4].forEach((o) => mesh(a, boxGeo(0.45, cy, 0.45, 2.6), trestleM, -41 + o, cy / 2, i * 9));
    }
    // Track rails on top of the deck.
    [[-10, -20, 70, "x"], [-10, 20, 70, "x"], [-41, 0, 40, "z"]].forEach(([tx, tz, len, axis]) => {
      [-1.7, 1.7].forEach((o) => {
        const w = axis === "x" ? len : 0.22;
        const d = axis === "x" ? 0.22 : len;
        mesh(a, boxGeo(w, 0.22, d, 3), poleM, axis === "x" ? tx : tx + o, cy + 0.2, axis === "x" ? tz + o : tz);
      });
    });
    a.minimap.push({ x: -10, z: -20, hw: 35, hd: 4, color: "#d8d2c8" });
    a.minimap.push({ x: -10, z: 20, hw: 35, hd: 4, color: "#d8d2c8" });
    const trainG = new THREE.Group();
    for (let i = 0; i < 4; i += 1) {
      const carMesh = new THREE.Mesh(boxGeo(2.4, 1.5, 3.4, 2.4), i % 2 ? tent : tentB);
      carMesh.position.set(0, 0, i * 3.8);
      const hood = new THREE.Mesh(boxGeo(2.0, 0.7, 1.2, 2), neonGold);
      hood.position.set(0, 0.9, i * 3.8 - 1.2);
      trainG.add(carMesh, hood);
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.4, 6), neon);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, 0, -2.4);
    trainG.add(nose);
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

    /* Snack stands + game tents (destructible) with striped canopies,
       counters and a lit sign — a 3 m box with a cone on top read as a
       traffic cone in a hat. */
    [[0, 48, tent], [-30, 54, tentB], [32, 54, tent], [-58, 30, tentB], [58, 22, tent],
     [82, -22, tentB], [-84, 8, tent], [14, 74, tentB], [-24, 24, tent], [46, -14, tentB]]
      .forEach(([x, z, m], i) => {
      const other = m === tent ? tentB : tent;
      const stand = box(a, 6.4, 3.6, 5.0, m, x, 1.8, z);
      box(a, 7.2, 0.5, 5.8, other, x, 3.85, z, 0, 3);           // fascia
      mesh(a, new THREE.ConeGeometry(5.2, 2.6, 6), other, x, 5.3, z, Math.PI / 6);
      box(a, 5.4, 0.24, 1.0, planks, x, 2.0, z + 3.0, 0, 2);    // serving counter
      mesh(a, boxGeo(3.4, 1.0, 0.24, 3), i % 2 ? neonGold : neonBlue, x, 4.4, z + 2.7);
      [-2.6, 2.6].forEach((o) => mesh(a, uvRadial(new THREE.CylinderGeometry(0.12, 0.14, 2.0, 5), 0.13, 2, 2), poleM, x + o, 1.0, z + 3.0));
      destructible(a, stand, x, z, 3.4, 2.8, 16, { score: 30 });
    });
    /* ---- promenade furniture ------------------------------------------
       The deck was 200 m of empty boards. Benches, planters, a carousel
       and a bumper-car pen give the middle of the arena something to
       fight around instead of an open parade ground. */
    // Carousel: canopy on a ring of poles, horses on the platform.
    (() => {
      const cx = -20, cz = 44;
      mesh(a, uvDisk(new THREE.CylinderGeometry(9, 9.4, 0.7, 14), 9, 5), planks, cx, 0.35, cz);
      ring(10, 7.4, (ox, oz) => {
        mesh(a, uvRadial(new THREE.CylinderGeometry(0.2, 0.2, 5.2, 6), 0.2, 5.2, 2), neonGold, cx + ox, 3.2, cz + oz);
        const horse = new THREE.Mesh(boxGeo(0.9, 1.5, 2.0, 2), (ox + oz) % 2 > 0 ? tent : tentB);
        horse.position.set(cx + ox * 0.92, 1.6, cz + oz * 0.92);
        horse.rotation.y = Math.atan2(oz, ox);
        a.group.add(horse);
      });
      mesh(a, new THREE.ConeGeometry(10.5, 4.2, 12), tent, cx, 7.8, cz);
      mesh(a, uvRadial(new THREE.CylinderGeometry(0.5, 0.5, 8, 8), 0.5, 8, 2), neonGold, cx, 4, cz);
      mesh(a, new THREE.SphereGeometry(0.9, 7, 6), neonBlue, cx, 10.4, cz);
      a.colliders.push({ x: cx, z: cz, hw: 8.2, hd: 8.2, base: 0, top: 4 });
      lightPool(a, cx, cz, 20, { tint: "255,214,150", core: 0.6 });
      a.minimap.push({ x: cx, z: cz, hw: 9, hd: 9, color: "#d23f6e" });
    })();
    // Bumper-car pen: low wall, painted floor, a few parked cars.
    (() => {
      const cx = 34, cz = -14, hw = 13, hd = 9;
      flatOverlay(a, hw * 2, hd * 2, stableOverlay(P("prop.bumperfloor", "hazard", { tile: 5, a: "#3a2a5c", b: "#7a4a9e" })), cx, 0.1, cz, 3, 5);
      [[0, -hd, hw * 2, 0.8], [0, hd, hw * 2, 0.8], [-hw, 0, 0.8, hd * 2], [hw, 0, 0.8, hd * 2]]
        .forEach(([ox, oz, w, d]) => {
          box(a, w, 1.1, d, fun, cx + ox, 0.55, cz + oz, 0, 3);
          a.colliders.push({ x: cx + ox, z: cz + oz, hw: w / 2, hd: d / 2, base: 0, top: 1.1 });
        });
      [[-6, -3, 0.4], [4, 2, 2.2], [8, -4, 1.1], [-4, 4, 3.0]].forEach(([ox, oz, ry], i) => {
        const c = new THREE.Mesh(uvRadial(new THREE.CylinderGeometry(1.5, 1.7, 0.9, 10), 1.6, 0.9, 2), i % 2 ? tent : tentB);
        c.position.set(cx + ox, 0.55, cz + oz);
        c.rotation.y = ry;
        const seat = new THREE.Mesh(boxGeo(1.0, 0.9, 0.5, 1.5), fun);
        seat.position.set(cx + ox, 1.4, cz + oz - 0.5);
        a.group.add(c, seat);
      });
      a.minimap.push({ x: cx, z: cz, hw, hd, color: "#7a4a9e" });
    })();
    // Benches, planters and bins down the promenade.
    for (let i = -4; i <= 4; i += 1) {
      const bz = i * 17;
      [-24, 24].forEach((bx) => {
        box(a, 0.6, 0.5, 3.4, planks, bx, 0.55, bz, 0, 2);
        box(a, 0.5, 1.0, 3.4, planks, bx - 0.35, 1.1, bz, 0, 2);
        [-1.4, 1.4].forEach((o) => mesh(a, boxGeo(0.7, 0.55, 0.2, 1.5), poleM, bx, 0.28, bz + o));
        a.colliders.push({ x: bx, z: bz, hw: 0.6, hd: 1.8, base: 0, top: 1.2 });
      });
      if (i % 2 === 0) {
        [-40, 44].forEach((bx) => {
          mesh(a, uvRadial(new THREE.CylinderGeometry(1.5, 1.3, 1.2, 8), 1.4, 1.2, 2), fun, bx, 0.6, bz + 6);
          mesh(a, new THREE.SphereGeometry(1.5, 7, 6), M("arena.shared.leaf", 0x4f7a33, 2.4), bx, 1.9, bz + 6);
          a.colliders.push({ x: bx, z: bz + 6, hw: 1.5, hd: 1.5, base: 0, top: 1.4 });
        });
      }
    }

    // Ticket kiosks and bin clutter along the promenade.
    [[-20, -6], [24, 8], [-46, 62], [62, 66]].forEach(([x, z]) => {
      box(a, 2.6, 3.0, 2.6, fun, x, 1.5, z, 0, 2.6);
      mesh(a, new THREE.ConeGeometry(2.4, 1.4, 6), tentB, x, 3.6, z);
      a.colliders.push({ x, z, hw: 1.4, hd: 1.4, base: 0, top: 3 });
    });
    [[-34, -6], [36, 34], [-12, 62], [70, -50]].forEach(([x, z]) => dumpster(a, x, z, P("prop.dumpster.pier", "panel", { tile: 2.2, base: 0x4a3a6a }), (x + z) % 2));

    perimeter(a, planks, 3, true);
    // West/east ends closed by the arcade row wrapping round the corner.
    [[-96, -30, 12, 40], [-96, 34, 12, 44], [96, -34, 12, 42], [96, 40, 12, 38]].forEach(([x, z, w, d], i) => {
      building(a, x, z, w, d, { storeys: 2, facade: arcadeFacade, base: arcadeFront, roof: fun, map: "#4a3a6a" });
    });
    spawnCircle(a, 58);
    scatterPickups(a, [[-10, -20], [-10, 20], [0, 0], [54, -58], [-70, -30], [70, 50], [-80, 60], [80, 60], [0, -70], [-40, -70], [80, 20]]);
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
      fog: { color: 0x53707a, near: 46, far: 190 },
      hemi: { sky: 0xa8c6cc, ground: 0x22303a, intensity: 0.85 },
      sun: { color: 0xcff2ea, intensity: 0.75, x: 20, y: 100, z: 20 },
      bounds: { hw: 102, hd: 102 },
    });
    const gravel = M("arena.rooftop.gravel", 0x5d6167, 5);
    const tower = M("arena.rooftop.tower", 0x39424e, 5);
    const heli = M("arena.rooftop.helipad", 0x2e6e4e, 6);
    const craneM = M("arena.rooftop.crane", 0xc98a2e, 3);
    const acM = M("arena.rooftop.ac", 0x8f979e, 2.4);
    const glow = Mbasic("arena.rooftop.glow", 0x63f2c8, 2);
    const shaftM = P("prop.facade.tower", "facade", { tile: 7.2, tileV: STOREY, base: 0x3e4855, cols: 5, lit: 0.34, litColor: "#ffd07a", glass: "#1b2430" });
    const parapetM = P("prop.parapet", "sidewalk", { tile: 4, base: 0x5e646c, slabs: 1 });
    const poleM = P("prop.pole", "panel", { tile: 3, base: 0x4a4c52, seams: 2 });
    const brickTower = P("prop.brick.tower", "brick", { tile: 3.6, base: 0x6a4436, rows: 12 });

    skyDome(a, { top: [0x18, 0x2c, 0x38], bottom: [0x86, 0xac, 0xb2], clouds: 6, cloud: "#c6dde0", curve: 1.8, capColor: 0x16262f });
    // The "ground" here is the abyss — a dark street plane far below.
    ground(a, tower, -40, 9);
    // Roof slabs (the playfield): a low tier (y=6) and a high tier (y=11).
    // Layout graph: center <-> west/east/N-high via bridges, west <-> SW,
    // center <-> E-high via freight elevator, E-high <-> SE via ramp.
    const roofs = [
      [0, 0, 43, 39, 6],       // center
      [-60, -20, 31, 43, 6],   // west
      [58, -34, 33, 31, 6],    // east
      [52, 40, 39, 33, 6],     // southeast
      [-48, 52, 35, 29, 6],    // southwest
      [-4, -60, 33, 27, 11],   // north high tier
      [44, 6, 23, 19, 11],     // east high tier
    ];
    roofs.forEach(([x, z, w, d, y], i) => {
      deck(a, w, d, y, gravel, x, z, 1.0, 5);
      /* The building the roof belongs to. Previously the "slab thickness"
         stood in for a tower, so the arena read as floating trays; now a
         real lit shaft drops away into the fog under every roof. */
      mesh(a, boxGeo(w - 1.6, 46, d - 1.6, 7.2, STOREY), i % 3 === 2 ? brickTower : shaftM, x, y - 1.0 - 23, z);
      // Parapet wall so you can see the roof edge before you go over it.
      [[0, -d / 2 + 0.4, w, 0.8], [0, d / 2 - 0.4, w, 0.8],
       [-w / 2 + 0.4, 0, 0.8, d], [w / 2 - 0.4, 0, 0.8, d]].forEach(([ox, oz, pw, pd]) => {
        box(a, pw, 1.0, pd, parapetM, x + ox, y + 0.5, z + oz, 0, 4);
      });
      a.minimap.push({ x, z, hw: w / 2, hd: d / 2, color: y > 6 ? "#6e7a86" : "#4e5866" });
    });
    // Everything that isn't a surface is the abyss.
    a.fallZones.push({ x: 0, z: 0, hw: 102, hd: 102 });

    /* Neighbouring towers rising past the playfield — the thing that
       makes 40 storeys up feel like 40 storeys up. */
    [[-96, -78, 30, 26, 78], [92, -84, 26, 28, 96], [-104, 24, 24, 34, 66],
     [104, 30, 28, 26, 86], [-30, -110, 34, 26, 72], [40, -114, 28, 24, 104],
     [-70, 104, 30, 28, 68], [66, 108, 26, 30, 92], [0, 118, 36, 26, 58],
     [-118, -20, 26, 30, 110]].forEach(([x, z, w, d, h], i) => {
      mesh(a, boxGeo(w, h, d, 7.2, STOREY), i % 3 === 1 ? brickTower : shaftM, x, h / 2 - 34, z);
      mesh(a, boxGeo(w + 1.4, 1.0, d + 1.4, 4), parapetM, x, h - 34 + 0.5, z);
      // Roof furniture so the tops aren't flat lids.
      mesh(a, boxGeo(w * 0.3, 4.5, d * 0.3, 3), parapetM, x + w * 0.2, h - 34 + 2.7, z - d * 0.2);
      mesh(a, uvRadial(new THREE.CylinderGeometry(0.16, 0.22, 12, 5), 0.2, 12, 3), poleM, x - w * 0.25, h - 34 + 6, z + d * 0.25);
      if (i % 2 === 0) {
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 6, 5), Mbasic("prop.beacon", 0xff4a3a, 2));
        beacon.position.set(x - w * 0.25, h - 34 + 12.2, z + d * 0.25);
        a.group.add(beacon);
      }
    });
    skyline(a, { radius: 250, count: 26, minH: 60, varH: 90, sink: 40, haze: 0x7ea0a8, near: 0x28323c, lit: 0.3 });

    // Helipads (visual targets on the roofs).
    [[0, 8, 6], [52, 44, 6], [-60, -30, 6], [-4, -60, 11], [44, 6, 11]].forEach(([x, z, y]) => {
      mesh(a, uvDisk(new THREE.CylinderGeometry(5.5, 5.5, 0.2, 14), 5.5, 6), heli, x, y + 0.14, z);
      mesh(a, boxGeo(4.4, 0.22, 0.9, 3), glow, x, y + 0.3, z);
      ring(8, 5.0, (ox, oz) => {
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 5, 4), glow);
        l.position.set(x + ox, y + 0.34, z + oz);
        a.group.add(l);
      });
      lightPool(a, x, z, 13, { tint: "120,255,220", core: 0.45, y });
    });

    // Fixed crane bridges (narrow drivable beams; ends overlap their roofs).
    const bridges = [
      [-32, -12, 38, 7],  // center <-> west
      [33, -16, 36, 7],   // center <-> east
      [-2, -33, 10, 40],  // center <-> north approach
      [-54, 19, 8, 54],   // west <-> southwest
    ];
    bridges.forEach(([x, z, w, d]) => {
      deck(a, w, d, 6, craneM, x, z, 1.2);
      a.minimap.push({ x, z, hw: w / 2, hd: d / 2, color: "#c98a2e" });
    });

    // Ramps to the high tier (overlap the low surface; height sampling
    // takes the tallest surface within step range, so the climb is smooth).
    ramp(a, 9, 17, 11, 6, "z", craneM, -4, -44); // N-high edge down to north bridge
    ramp(a, 9, 17, 11, 6, "z", craneM, 50, 23); // E-high edge down to SE roof

    /* Tower cranes rising out of the fog below — latticed masts, a real
       jib with a counterweight, and a hook on a slack line. */
    [[-30, -30, 0.4], [24, 24, 2.3], [78, -70, 1.1]].forEach(([x, z, ry]) => {
      const mastH = 62;
      mesh(a, boxGeo(2.6, mastH, 2.6, 3), craneM, x, mastH / 2 - 40, z);
      // Lattice rungs: cheap, but they stop it reading as a yellow stick.
      for (let i = 0; i < 14; i += 1) {
        mesh(a, boxGeo(3.0, 0.22, 0.22, 2), craneM, x, -38 + i * 4.4, z);
        mesh(a, boxGeo(0.22, 0.22, 3.0, 2), craneM, x, -38 + i * 4.4 + 2.2, z);
      }
      const jib = new THREE.Group();
      const arm = new THREE.Mesh(boxGeo(30, 1.5, 1.5, 3), craneM);
      arm.position.x = 11;
      const tail = new THREE.Mesh(boxGeo(11, 1.3, 1.3, 3), craneM);
      tail.position.x = -8.5;
      const cw = new THREE.Mesh(boxGeo(3.4, 2.6, 2.8, 2), parapetM);
      cw.position.x = -12;
      const cab = new THREE.Mesh(boxGeo(2.4, 2.2, 2.4, 2), parapetM);
      cab.position.set(2.5, -1.6, 0);
      const line = new THREE.Mesh(boxGeo(0.12, 12, 0.12, 2), poleM);
      line.position.set(20, -6.4, 0);
      const hook = new THREE.Mesh(boxGeo(1.0, 1.2, 1.0, 1), craneM);
      hook.position.set(20, -12.8, 0);
      jib.add(arm, tail, cw, cab, line, hook);
      jib.position.set(x, mastH - 40 + 1, z);
      jib.rotation.y = ry;
      a.group.add(jib);
      a.colliders.push({ x, z, hw: 1.6, hd: 1.6, base: 0, top: 12 });
    });
    // Water towers — the other unmistakable rooftop silhouette.
    [[-58, 44, 6], [56, -46, 6]].forEach(([x, z, y]) => {
      [[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]].forEach(([ox, oz]) => {
        mesh(a, boxGeo(0.35, 6, 0.35, 2), poleM, x + ox, y + 3, z + oz);
      });
      mesh(a, uvRadial(new THREE.CylinderGeometry(3.4, 3.8, 6, 10), 3.6, 6, 2.6), P("prop.watertank", "panel", { tile: 2.6, base: 0x6a5340, seams: 8 }), x, y + 9, z);
      mesh(a, new THREE.ConeGeometry(4.0, 2.4, 10), P("prop.watertank", "panel", { tile: 2.6, base: 0x6a5340, seams: 8 }), x, y + 13.2, z);
      a.colliders.push({ x, z, hw: 2.8, hd: 2.8, base: y, top: y + 6 });
    });

    // FREIGHT ELEVATOR: platform sliding between the center roof (y=6)
    // and the east high tier (y=11); its ends touch both roofs.
    const elevRect = { type: "rect", x: 26, z: 6, hw: 11, hd: 6, y: 6 };
    a.heights.push(elevRect);
    const elevMesh = box(a, 22, 1.0, 12, craneM, 26, 5.5, 6);
    mesh(a, new THREE.BoxGeometry(0.8, 14, 0.8), tower, 26, 4, 11.6);
    a.minimap.push({ x: 26, z: 6, hw: 11, hd: 6, color: "#c98a2e" });
    let elevT = 0;
    a.update = (dt) => {
      elevT += dt;
      const phase = (Math.sin(elevT * 0.55) + 1) / 2; // 0..1, slow cycle
      const y = 6 + phase * 5;
      elevRect.y = y;
      elevMesh.position.y = y - 0.5;
    };

    // AC plant, vents and stair bulkheads as roof clutter.
    [[-10, 10, 6], [12, -8, 6], [-66, -6, 6], [50, -40, 6], [44, 52, 6], [-54, 58, 6],
     [4, -64, 11], [38, 12, 11], [-40, 40, 6], [64, -22, 6], [-14, -50, 6]].forEach(([x, z, y], i) => {
      const m = box(a, 3.6, 2.4, 3.2, acM, x, y + 1.2, z, 0, 2.4);
      mesh(a, uvRadial(new THREE.CylinderGeometry(1.3, 1.3, 0.5, 10), 1.3, 0.5, 1.6), poleM, x, y + 2.65, z);
      if (i % 3 === 0) {
        // Stair bulkhead — a roof needs a way down.
        box(a, 4.2, 3.2, 3.4, parapetM, x + 5.5, y + 1.6, z - 3, 0, 3);
        box(a, 4.8, 0.4, 4.0, acM, x + 5.5, y + 3.4, z - 3, 0, 3);
      }
      destructible(a, m, x, z, 2.0, 1.8, 10, { score: 15 });
    });
    // Vent stacks and antenna masts.
    [[16, 12, 6], [-56, -34, 6], [30, 48, 6], [-2, -68, 11], [-62, 12, 6]].forEach(([x, z, y], i) => {
      mesh(a, uvRadial(new THREE.CylinderGeometry(0.18, 0.26, 10, 5), 0.22, 10, 3), poleM, x, y + 5, z);
      [3.2, 5.4, 7.2].forEach((h, k) => mesh(a, boxGeo(1.8 - k * 0.4, 0.14, 0.14, 2), poleM, x, y + h, z));
      mesh(a, new THREE.SphereGeometry(0.42, 6, 5), glow, x, y + 10.3, z);
      if (i % 2 === 0) {
        [-1.6, 1.6].forEach((o) => mesh(a, uvRadial(new THREE.CylinderGeometry(0.5, 0.6, 3.4, 7), 0.55, 3.4, 2), acM, x + o + 4, y + 1.7, z + 3));
      }
    });
    // Rooftop signage — a lit hoarding over the abyss.
    billboardSign(a, 0, 22, Math.PI, { leg: poleM, w: 22, h: 8, y: 14, bg: "#1d2f4a", ink: "#8ff0e0", key: "prop.billboard.roof" });
    billboardSign(a, -60, -2, Math.PI / 2, { leg: poleM, w: 16, h: 7, y: 13, bg: "#4a1d2f", ink: "#ffd07a", key: "prop.billboard.roof2" });

    // Spawns on the roofs (not a circle — roofs only).
    a.spawns = [
      { x: 0, z: 8, h: Math.PI }, { x: -60, z: -20, h: 1.2 }, { x: 58, z: -34, h: 2.4 },
      { x: 52, z: 40, h: -1.4 }, { x: -48, z: 52, h: -0.5 }, { x: -4, z: -60, h: 3.0 },
    ];
    scatterPickups(a, [[0, -8], [-60, -8], [58, -30], [52, 32], [-48, 46], [-4, -54], [44, 6], [-32, -12], [-54, 19], [26, 6]]);
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
      sky: 0x182a20,
      fog: { color: 0x1e3a2c, near: 46, far: 185 },
      hemi: { sky: 0x5c9a78, ground: 0x141e18, intensity: 0.82 },
      sun: { color: 0xa6e0c0, intensity: 0.62, x: -30, y: 70, z: -50 },
      bounds: { hw: 95, hd: 95 },
    });
    const dirt = M("arena.cemetery.ground", 0x2e3c2c, 7);
    const stone = M("arena.cemetery.stone", 0x76807a, 4);
    const stoneDark = M("arena.cemetery.stone_dark", 0x4a544e, 4);
    const wood = M("arena.cemetery.wood", 0x4e3a26, 2.6);
    const glow = Mbasic("arena.cemetery.glow", 0x5eff9e, 2);
    const trunk = M("arena.shared.trunk", 0x3a2c1e, 2.4);
    const poleM = P("prop.pole.iron", "panel", { tile: 2.4, base: 0x2a2c30, seams: 2 });
    const graniteM = P("prop.granite", "sidewalk", { tile: 3.4, base: 0x6e7670, slabs: 1 });
    const brickCrypt = P("prop.brick.crypt", "brick", { tile: 3.2, base: 0x4e5450, mortar: "#3a403c", rows: 11 });
    const lanternGlow = Mbasic("prop.lantern", 0xb8ff8a, 2);

    skyDome(a, {
      top: [0x06, 0x0c, 0x10], bottom: [0x36, 0x6e, 0x50], curve: 2.4,
      clouds: 5, cloud: "#8fd8a8", stars: true, capColor: 0x050a0e, repeat: 3,
    });
    // A low moon disc behind the treeline, so the sky has a light source.
    (() => {
      const moon = new THREE.Mesh(new THREE.CircleGeometry(16, 20),
        new THREE.MeshBasicMaterial({ color: 0xdcffe8, fog: false }));
      moon.position.set(-150, 66, -210);
      moon.lookAt(0, 20, 0);
      moon.renderOrder = -18;
      a.group.add(moon);
    })();
    skyline(a, { radius: 210, count: 18, minH: 16, varH: 24, sink: 6, haze: 0x2c5a44, near: 0x0e1a14, lit: 0.02 });
    ground(a, dirt);

    /* ---- paths and ground cover ----------------------------------------
       The yard was one unbroken sheet of dark earth, which reads as a flat
       shaded plane no matter how good the texture is. A gravel path network
       radiating from the chapel gives the ground value contrast, tells the
       player where the routes are, and is what an actual cemetery looks
       like from a car. */
    const gravelM = stableOverlay(P("prop.gravel.path", "sidewalk", {
      tile: 4.5, base: 0x4a4a42, slabs: 1, transparent: true, opacity: 0.9,
    }));
    const mossM = stableOverlay(M("arena.cemetery.ground", 0x3e5238, 8, { transparent: true, opacity: 0.5 }));
    [[0, -56, 9, 74, 0], [0, 56, 9, 74, 0], [-56, 0, 74, 9, 0], [56, 0, 74, 9, 0]]
      .forEach(([x, z, w, d]) => flatOverlay(a, w, d, gravelM, x, 0.07, z, 2, 4.5));
    // Diagonal cut-throughs between the mausoleums.
    [[-38, -38, 0.785], [38, -38, -0.785], [38, 38, 0.785], [-38, 38, -0.785]].forEach(([x, z, ry]) => {
      const m = flatOverlay(a, 8, 62, gravelM, x, 0.07, z, 2, 4.5);
      m.rotation.z = ry;
    });
    flatDisk(a, 26, gravelM, 0, 0.08, 0, 3, 28, 5);
    // Moss and long grass patches, so the earth is not one flat tone.
    [[-62, -30, 26, 20], [58, 34, 30, 22], [-24, 62, 26, 18], [30, -66, 24, 20],
     [-70, 40, 20, 26], [66, -22, 22, 24]].forEach(([x, z, w, d]) => {
      flatOverlay(a, w, d, mossM, x, 0.05, z, 1, 8);
    });

    /* Low ground mist. Two big, slow, near-transparent sheets just above
       the earth — the cheapest way to get the graveyard reading as damp
       rather than merely dark. */
    (() => {
      const mistTex = PROC().fxTex("smoke", { size: 128, tint: [120, 165, 135] });
      const mistM = new THREE.MeshBasicMaterial({
        map: mistTex, transparent: true, opacity: 0.16, depthWrite: false, fog: true,
      });
      const sheets = [];
      for (let i = 0; i < 7; i += 1) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(62, 62), mistM);
        m.rotation.x = -Math.PI / 2;
        m.position.set(-70 + (i % 4) * 46, 1.1 + (i % 3) * 0.5, -66 + Math.floor(i / 4) * 60);
        m.renderOrder = 5;
        a.group.add(m);
        sheets.push({ mesh: m, phase: i * 1.4 });
      }
      a.mist = sheets;
    })();

    /* ---- mausoleum ring ------------------------------------------------
       Proper crypts: stepped plinth, pilasters, a pedimented doorway and
       an urn on the roof. The old version was a box with a cone hat. */
    const mausoleums = [
      [-40, -40, 0], [0, -52, 0.3], [40, -42, -0.2], [56, 0, Math.PI / 2],
      [42, 42, 0.2], [0, 56, -0.3], [-44, 40, 0], [-58, 0, Math.PI / 2],
    ];
    mausoleums.forEach(([x, z, ry], i) => {
      const w = 13, d = 10, h = 8.5;
      box(a, w + 1.8, 0.9, d + 1.8, graniteM, x, 0.45, z, ry, 4);
      block(a, w, h, d, i % 2 ? stone : brickCrypt, x, z, { ry, base: 0.9, map: "#76807a", tile: 4 });
      // Pilasters on the front face.
      const fx = Math.sin(ry) * (d / 2 + 0.2), fz = Math.cos(ry) * (d / 2 + 0.2);
      [-w * 0.36, w * 0.36].forEach((o) => {
        mesh(a, boxGeo(1.1, h, 0.6, 2.6), graniteM, x + fx + Math.cos(ry) * o, 0.9 + h / 2, z + fz - Math.sin(ry) * o, ry);
      });
      // Pediment + cornice.
      mesh(a, boxGeo(w + 1.4, 0.8, d + 1.4, 3), graniteM, x, 0.9 + h + 0.4, z, ry);
      const ped = mesh(a, new THREE.ConeGeometry(w * 0.62, 3.2, 4), stoneDark, x, 0.9 + h + 2.4, z, ry + Math.PI / 4);
      ped.scale.z = 0.62;
      // Doorway with an iron grille.
      mesh(a, boxGeo(3.0, 4.6, 0.4, 3), stoneDark, x + fx, 3.2, z + fz, ry);
      mesh(a, boxGeo(2.2, 3.8, 0.2, 2), poleM, x + fx * 1.05, 2.9, z + fz * 1.05, ry);
      // Roof urn + a lit lantern by the door.
      mesh(a, uvRadial(new THREE.CylinderGeometry(0.7, 0.45, 1.6, 8), 0.6, 1.6, 2), graniteM, x, 0.9 + h + 4.5, z);
      mesh(a, new THREE.SphereGeometry(0.72, 7, 6), graniteM, x, 0.9 + h + 5.7, z);
      const lant = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 5), lanternGlow);
      lant.position.set(x + fx * 1.15 + Math.cos(ry) * 2.4, 3.4, z + fz * 1.15 - Math.sin(ry) * 2.4);
      a.group.add(lant);
      lightPool(a, x + fx * 1.6, z + fz * 1.6, 6, { tint: "160,255,180", core: 0.3 });
      a.minimap.push({ x, z, hw: w / 2, hd: d / 2, color: "#76807a" });
    });
    /* ---- the chapel at the centre --------------------------------------
       Drive-through arch under a roof you can also drive over. Given a
       bell tower so it reads as the arena's landmark from any corner. */
    block(a, 6, 9, 14, stone, -9, 0, { map: "#8a948e", tile: 4 });
    block(a, 6, 9, 14, stone, 9, 0, { map: "#8a948e", tile: 4 });
    deck(a, 24, 14, 9, graniteM, 0, 0, 1.0, 4);
    // Arch voussoirs across the opening.
    for (let i = -3; i <= 3; i += 1) {
      const ang = (i / 3) * 0.9;
      mesh(a, boxGeo(2.2, 1.4, 3.0, 2.6), graniteM, Math.sin(ang) * 5.4, 7.6 + Math.cos(ang) * 1.4, 0, 0).rotation.z = -ang;
    }
    box(a, 26, 0.9, 16, graniteM, 0, 9.6, 0, 0, 4);
    // Bell tower.
    block(a, 7, 17, 7, stone, 0, -11, { map: "#8a948e", tile: 4 });
    mesh(a, boxGeo(8.4, 0.8, 8.4, 3), graniteM, 0, 17.4, -11);
    mesh(a, new THREE.ConeGeometry(6.0, 8, 4), stoneDark, 0, 21.8, -11, Math.PI / 4);
    mesh(a, boxGeo(3.4, 3.4, 0.5, 3), poleM, 0, 15.0, -7.4);
    mesh(a, new THREE.SphereGeometry(1.0, 7, 6), glow, 0, 26.4, -11);
    ramp(a, 9, 20, 0, 9, "x", stoneDark, -21.5, 0);
    ramp(a, 9, 20, 9, 0, "x", stoneDark, 21.5, 0);
    mesh(a, new THREE.SphereGeometry(1.4, 7, 6), glow, 0, 11.6, 0); // will-o-wisp beacon
    lightPool(a, 0, 0, 15, { tint: "120,255,170", core: 0.36 });
    lightPool(a, 0, -11, 10, { tint: "120,255,170", core: 0.26 });
    a.minimap.push({ x: 0, z: -11, hw: 3.5, hd: 3.5, color: "#8a948e" });

    /* ---- graves ---------------------------------------------------------
       Six times as many headstones, in varied shapes, laid out as real
       plots with kerbed rows — the yard used to be four tidy lines of
       identical slabs in one corner. */
    const headForms = ["slab", "cross", "obelisk", "arch"];
    for (let row = 0; row < 9; row += 1) {
      for (let i = 0; i < 9; i += 1) {
        const x = -74 + i * 8.5 + (row % 2) * 4;
        const z = -80 + row * 6.5;
        if (Math.abs(x) < 30 && Math.abs(z) < 26) continue; // keep the chapel clear
        const form = headForms[(row * 7 + i * 3) % headForms.length];
        const mat = (row + i) % 2 ? stone : stoneDark;
        let m;
        if (form === "cross") {
          m = box(a, 0.5, 2.6, 0.4, mat, x, 1.3, z, 0, 2);
          mesh(a, boxGeo(1.7, 0.45, 0.4, 2), mat, x, 1.95, z);
        } else if (form === "obelisk") {
          m = box(a, 1.0, 3.4, 1.0, mat, x, 1.7, z, 0, 2);
          mesh(a, new THREE.ConeGeometry(0.72, 1.1, 4), mat, x, 3.9, z, Math.PI / 4);
        } else if (form === "arch") {
          m = box(a, 1.7, 2.0, 0.5, mat, x, 1.0, z, 0, 2);
          mesh(a, uvRadial(new THREE.CylinderGeometry(0.85, 0.85, 0.5, 8, 1, false, 0, Math.PI), 0.85, 0.5, 2), mat, x, 2.0, z).rotation.x = Math.PI / 2;
        } else {
          m = box(a, 1.8, 1.7, 0.5, mat, x, 0.85, z, 0, 2);
        }
        mesh(a, boxGeo(2.2, 0.24, 1.8, 2), graniteM, x, 0.12, z + 1.0); // plot kerb
        destructible(a, m, x, z, 1.0, 0.5, 5, { score: 10 });
      }
    }
    // Casket stacks by the gravedigger's shed.
    for (let i = 0; i < 6; i += 1) {
      const x = 44 + (i % 3) * 9, z = 62 + Math.floor(i / 3) * 9;
      const m = box(a, 2.6, 1.2, 6.5, wood, x, 0.6 + (i % 2) * 1.25, z, (i % 2) * 0.25, 2.6);
      destructible(a, m, x, z, 1.4, 3.4, 8, { score: 15 });
    }
    block(a, 12, 5.5, 9, wood, 66, 74, { map: "#4e3a26", tile: 2.6 });
    mesh(a, boxGeo(13.5, 0.5, 10.5, 3), stoneDark, 66, 5.8, 74);

    /* Dead trees: bare forked trunks, not sticks. */
    [[-76, -20], [-70, 56], [70, -60], [76, 30], [-30, 74], [24, -76], [-14, 34], [36, -8], [-52, -66], [80, 6]]
      .forEach(([x, z], i) => {
      const h = 9 + (i % 3) * 2;
      mesh(a, uvRadial(new THREE.CylinderGeometry(0.34, 0.7, h, 6), 0.5, h, 2.4), trunk, x, h / 2, z);
      for (let b = 0; b < 4; b += 1) {
        const ang = (b / 4) * Math.PI * 2 + i;
        const bl = 3.0 + (b % 2) * 1.6;
        const lb = mesh(a, uvRadial(new THREE.CylinderGeometry(0.09, 0.2, bl, 5), 0.15, bl, 2), trunk,
          x + Math.cos(ang) * bl * 0.4, h * 0.62 + b * 0.9, z + Math.sin(ang) * bl * 0.4);
        lb.rotation.z = Math.cos(ang) * 1.1;
        lb.rotation.x = Math.sin(ang) * 1.1;
        const tw = mesh(a, uvRadial(new THREE.CylinderGeometry(0.05, 0.11, bl * 0.6, 4), 0.08, bl * 0.6, 2), trunk,
          x + Math.cos(ang) * bl * 0.8, h * 0.62 + b * 0.9 + bl * 0.3, z + Math.sin(ang) * bl * 0.8);
        tw.rotation.z = Math.cos(ang) * 0.6;
      }
      a.colliders.push({ x, z, hw: 0.7, hd: 0.7, base: 0, top: 6 });
    });
    // Iron railing around the yard with the gates standing open.
    [[-48, -93, 70, "x"], [42, -93, 70, "x"], [-93, -46, 70, "z"], [-93, 46, 70, "z"],
     [93, -46, 70, "z"], [93, 46, 70, "z"], [-48, 93, 70, "x"], [42, 93, 70, "x"]]
      .forEach(([x, z, len, axis]) => {
        const w = axis === "x" ? len : 0.3;
        const d = axis === "x" ? 0.3 : len;
        box(a, w, 0.4, d, poleM, x, 2.6, z, 0, 3);
        box(a, w, 0.35, d, poleM, x, 0.6, z, 0, 3);
        const n = Math.round(len / 1.6);
        for (let i = 0; i <= n; i += 1) {
          const t = i / n - 0.5;
          const px = axis === "x" ? x + t * len : x;
          const pz = axis === "x" ? z : z + t * len;
          mesh(a, boxGeo(0.16, 3.2, 0.16, 2), poleM, px, 1.6, pz);
          if (i % 6 === 0) {
            mesh(a, boxGeo(0.4, 4.2, 0.4, 2), poleM, px, 2.1, pz);
            mesh(a, new THREE.ConeGeometry(0.3, 0.7, 4), poleM, px, 4.5, pz);
          }
        }
        a.colliders.push({ x, z, hw: axis === "x" ? len / 2 : 0.3, hd: axis === "x" ? 0.3 : len / 2, base: 0, top: 3.2 });
      });
    // Lantern posts marking the paths.
    [[-30, -30], [30, -30], [-30, 30], [30, 30], [-12, -70], [12, 70], [-70, 14], [70, -14]].forEach(([x, z]) => {
      mesh(a, uvRadial(new THREE.CylinderGeometry(0.16, 0.24, 5, 6), 0.2, 5, 2), poleM, x, 2.5, z);
      mesh(a, boxGeo(0.9, 1.1, 0.9, 1.5), poleM, x, 5.4, z);
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.38, 6, 5), lanternGlow);
      l.position.set(x, 5.4, z);
      a.group.add(l);
      lightPool(a, x, z, 7.5, { tint: "150,255,170", core: 0.34 });
      a.colliders.push({ x, z, hw: 0.3, hd: 0.3, base: 0, top: 2.5 });
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
      if (a.mist) {
        a.mist.forEach((s) => {
          s.mesh.position.x += Math.sin(t * 0.11 + s.phase) * dt * 1.4;
          s.mesh.position.z += Math.cos(t * 0.08 + s.phase) * dt * 1.1;
        });
      }
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

    perimeter(a, stoneDark, 3.4, true); // iron railing is the visible edge
    // The mausoleum ring reaches r=63; spawning at 62 put cars inside one.
    spawnCircle(a, 78);
    scatterPickups(a, [[0, 0], [0, -70], [0, 70], [-70, 0], [70, 0], [-40, -60], [56, 56], [-56, 60], [60, -50], [-30, 0], [30, 0]]);
    return a;
  }

  /**
   * Nudge every spawn point clear of the scenery, run once after an
   * arena finishes building.
   *
   * Spawn rings are hand-placed at a fixed radius, and any building that
   * later moves, grows or rotates can end up sitting on one. The symptom
   * is a car that starts the round wedged in a wall and cannot drive out
   * of it — which is invisible in a screenshot and obvious the moment
   * anyone plays. Rather than re-tune six radii by hand every time the
   * geometry changes, push each spawn radially outward until it is clear.
   */
  function clearSpawns(a) {
    // Not just car-sized: a spawn wants room to get moving in any
    // direction, so this clears roughly a car length in every heading.
    const CAR = 6.5;
    const STEP = 3.5;
    const MAX_TRIES = 26;
    const blocked = (x, z) => a.colliders.some((c) =>
      c.top > 0.6 &&
      Math.abs(x - c.x) < c.hw + CAR &&
      Math.abs(z - c.z) < c.hd + CAR);

    a.spawns.forEach((s) => {
      if (!blocked(s.x, s.z)) return;
      const len = Math.hypot(s.x, s.z) || 1;
      const ux = s.x / len;
      const uz = s.z / len;
      for (let i = 1; i <= MAX_TRIES; i += 1) {
        // Alternate outward and inward, widening each time, so a spawn
        // boxed in on the outside still finds room toward the middle.
        const dir = i % 2 ? 1 : -1;
        const d = Math.ceil(i / 2) * STEP * dir;
        const nx = s.x + ux * d;
        const nz = s.z + uz * d;
        if (Math.abs(nx) > a.bounds.hw - 4 || Math.abs(nz) > a.bounds.hd - 4) continue;
        if (!blocked(nx, nz)) { s.x = nx; s.z = nz; return; }
      }
      // Last resort: a lap around the ring at the same radius.
      for (let i = 1; i < 24; i += 1) {
        const ang = Math.atan2(s.z, s.x) + (i * Math.PI) / 12;
        const nx = Math.cos(ang) * len;
        const nz = Math.sin(ang) * len;
        if (!blocked(nx, nz)) { s.x = nx; s.z = nz; s.h = Math.atan2(-nx, -nz); return; }
      }
    });
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
      const arena = entry.build();
      clearSpawns(arena);
      return arena;
    },
  };
})();
