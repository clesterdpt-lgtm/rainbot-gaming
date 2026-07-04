/* ============================================================
   SCRAP CIRCUIT — vehicle roster
   ------------------------------------------------------------
   10 original parody vehicles, all Three.js primitives, ~150-500
   tris each. Silhouette is identity: every one must read from a
   rooftop with zero textures. Meshes face +Z; wheels registered in
   group.userData.wheels for spin; special FX anchors in userData.
   All materials go through SCRAP.textures.mat so AI textures can
   retrofit later via the manifest with zero code changes.
   ============================================================ */
(() => {
  "use strict";
  const SCRAP = (window.SCRAP = window.SCRAP || {});
  const T = () => SCRAP.textures;

  // ---------- tiny mesh kit ----------
  const geoCache = new Map();
  function boxGeo(w, h, d) {
    const key = `b${w},${h},${d}`;
    if (!geoCache.has(key)) geoCache.set(key, new THREE.BoxGeometry(w, h, d));
    return geoCache.get(key);
  }
  function cylGeo(rt, rb, h, seg = 8) {
    const key = `c${rt},${rb},${h},${seg}`;
    if (!geoCache.has(key)) geoCache.set(key, new THREE.CylinderGeometry(rt, rb, h, seg));
    return geoCache.get(key);
  }
  function coneGeo(r, h, seg = 8) {
    const key = `k${r},${h},${seg}`;
    if (!geoCache.has(key)) geoCache.set(key, new THREE.ConeGeometry(r, h, seg));
    return geoCache.get(key);
  }
  function sphGeo(r, seg = 6) {
    const key = `s${r},${seg}`;
    if (!geoCache.has(key)) geoCache.set(key, new THREE.SphereGeometry(r, seg, Math.max(4, seg - 1)));
    return geoCache.get(key);
  }
  function add(group, geo, material, x, y, z, rx = 0, ry = 0, rz = 0) {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    group.add(mesh);
    return mesh;
  }

  let sharedMats = null;
  function shared() {
    if (!sharedMats) {
      sharedMats = {
        tire: T().mat("vehicle.shared.tire", { color: 0x1c1c22 }),
        hub: T().mat("vehicle.shared.hub", { color: 0x8f8f96 }),
        glass: T().mat("vehicle.shared.glass", { color: 0x9fd4e8 }),
        glassDark: T().mat("vehicle.shared.glass_dark", { color: 0x2c3d52 }),
        chrome: T().mat("vehicle.shared.chrome", { color: 0xc9cdd4 }),
        dark: T().mat("vehicle.shared.dark", { color: 0x23232b }),
        rust: T().mat("vehicle.shared.rust", { color: 0x8a4b2d }),
      };
    }
    return sharedMats;
  }

  function wheel(group, radius, width, x, y, z) {
    const s = shared();
    const w = add(group, cylGeo(radius, radius, width, 10), s.tire, x, y, z, 0, 0, Math.PI / 2);
    add(w, cylGeo(radius * 0.45, radius * 0.45, width + 0.06, 8), s.hub, 0, 0, 0);
    group.userData.wheels.push(w);
    return w;
  }

  function beginBody() {
    const group = new THREE.Group();
    group.userData.wheels = [];
    return group;
  }

  // ---------- the roster ----------
  const ROSTER = [
    {
      id: "icecream",
      name: "Mr. Drippy's Meltdown",
      archetype: "Soft-serve horror-show ice cream truck",
      flavor: "The jingle is a warning.",
      special: { id: "freeze_nova", name: "Brain Freeze", desc: "Frost nova freezes nearby rivals solid." },
      stats: { hp: 110, accel: 16, top: 30, turn: 2.0, mass: 1.5, radius: 2.2 },
      build() {
        const g = beginBody();
        const s = shared();
        const body = T().mat("vehicle.icecream.body", { color: 0xf6f0e6 });
        const trim = T().mat("vehicle.icecream.decal", { color: 0xff7eb6 });
        const cone = T().mat("vehicle.icecream.cone", { color: 0xd9a066 });
        const scoop = T().mat("vehicle.icecream.scoop", { color: 0xfff4fa });
        const drip = T().mat("vehicle.icecream.drip", { color: 0xff9ecb });
        add(g, boxGeo(2.4, 2.0, 4.6), body, 0, 1.55, -0.1);           // tall van box
        add(g, boxGeo(2.4, 0.9, 1.2), body, 0, 1.0, 2.15);            // cab nose
        add(g, boxGeo(2.3, 0.6, 1.1), s.glass, 0, 1.75, 1.9);         // windshield band
        add(g, boxGeo(2.46, 0.34, 4.66), trim, 0, 2.1, -0.1);         // pink stripe
        add(g, boxGeo(0.1, 0.9, 2.2), s.glassDark, -1.22, 1.7, -0.4); // serving window
        // Giant tilted soft-serve cone — THE silhouette.
        const swirl = new THREE.Group();
        add(swirl, coneGeo(0.85, 1.7, 9), cone, 0, -0.9, 0);
        swirl.children[0].rotation.x = Math.PI; // point down into roof
        add(swirl, sphGeo(0.72, 8), scoop, 0, 0.25, 0);
        add(swirl, sphGeo(0.55, 8), scoop, 0, 0.85, 0);
        add(swirl, sphGeo(0.36, 7), scoop, 0, 1.32, 0);
        add(swirl, sphGeo(0.16, 6), drip, 0.45, 0.1, 0.3);            // sad drips
        add(swirl, sphGeo(0.13, 6), drip, -0.4, 0.6, -0.2);
        swirl.position.set(0, 3.4, -0.4);
        swirl.rotation.z = 0.28;                                       // unsettling lean
        g.add(swirl);
        wheel(g, 0.52, 0.4, -1.1, 0.52, 1.6); wheel(g, 0.52, 0.4, 1.1, 0.52, 1.6);
        wheel(g, 0.52, 0.4, -1.1, 0.52, -1.5); wheel(g, 0.52, 0.4, 1.1, 0.52, -1.5);
        return g;
      },
    },
    {
      id: "reaper",
      name: "Late Fees",
      archetype: "Reaper-chic chopper, scythe sidecar",
      flavor: "Death waives nothing.",
      special: { id: "drain_beam", name: "Soul Garnishment", desc: "Life-drain beam steals HP from the nearest rival." },
      stats: { hp: 80, accel: 24, top: 40, turn: 2.7, mass: 0.8, radius: 1.5 },
      build() {
        const g = beginBody();
        const s = shared();
        const body = T().mat("vehicle.reaper.body", { color: 0x2b2135 });
        const bone = T().mat("vehicle.reaper.bone", { color: 0xe8e2d0 });
        const blade = T().mat("vehicle.reaper.blade", { color: 0xb8c4cc });
        const flame = T().basicMat("vehicle.reaper.flame", { color: 0x7d3bff });
        add(g, boxGeo(0.7, 0.55, 2.6), body, 0, 0.85, 0);              // spine
        add(g, boxGeo(0.5, 0.5, 0.9), body, 0, 1.1, -1.2);             // seat hump
        add(g, cylGeo(0.12, 0.12, 2.2, 6), s.chrome, 0, 1.15, 1.4, Math.PI / 2.6, 0, 0); // long fork
        add(g, boxGeo(0.9, 0.18, 0.5), s.chrome, 0, 1.65, 0.9, 0, 0, 0);  // ape bars
        // Skeleton rider
        add(g, boxGeo(0.5, 0.7, 0.4), body, 0, 1.7, -0.9);             // robe torso
        add(g, sphGeo(0.26, 7), bone, 0, 2.2, -0.8);                   // skull
        add(g, boxGeo(0.34, 0.1, 0.12), s.dark, 0, 2.22, -0.62);       // eye slit
        // Scythe strapped across the back
        add(g, cylGeo(0.05, 0.05, 2.4, 5), s.dark, -0.1, 1.9, -1.1, 0, 0, 1.05);
        add(g, boxGeo(1.1, 0.06, 0.34), blade, -1.05, 2.35, -1.1, 0, 0, 0.5);
        // Sidecar coffin
        add(g, boxGeo(0.8, 0.5, 1.7), body, 1.15, 0.7, -0.3);
        add(g, boxGeo(0.66, 0.1, 1.5), bone, 1.15, 0.99, -0.3);
        add(g, sphGeo(0.18, 6), flame, 0, 0.9, -2.05);                 // ghost exhaust
        wheel(g, 0.65, 0.34, 0, 0.65, -1.7);
        wheel(g, 0.5, 0.24, 0, 0.5, 2.0);
        wheel(g, 0.42, 0.3, 1.15, 0.42, -1.1);
        return g;
      },
    },
    {
      id: "mallcop",
      name: "Mall Law",
      archetype: "Off-duty mall-cop cruiser gone rogue",
      flavor: "The food court closes when HE says it closes.",
      special: { id: "spike_burst", name: "Clearance Spikes", desc: "Fires a spike-strip barrage behind you." },
      stats: { hp: 105, accel: 19, top: 34, turn: 2.3, mass: 1.2, radius: 1.9 },
      build() {
        const g = beginBody();
        const s = shared();
        const body = T().mat("vehicle.mallcop.body", { color: 0xf2f2f0 });
        const stripe = T().mat("vehicle.mallcop.stripe", { color: 0x2255cc });
        const lightR = T().basicMat("vehicle.mallcop.light_r", { color: 0xff3b30 });
        const lightB = T().basicMat("vehicle.mallcop.light_b", { color: 0x37b6ff });
        add(g, boxGeo(2.0, 0.62, 4.4), body, 0, 0.72, 0);              // sedan slab
        add(g, boxGeo(1.8, 0.55, 2.0), s.glass, 0, 1.28, -0.2);        // cabin
        add(g, boxGeo(2.04, 0.2, 4.44), stripe, 0, 0.9, 0);            // blue belt stripe
        add(g, boxGeo(2.3, 0.35, 0.5), s.dark, 0, 0.55, 2.35);         // push bumper
        add(g, boxGeo(0.3, 0.35, 0.14), s.dark, -0.8, 0.62, 2.42);
        add(g, boxGeo(0.3, 0.35, 0.14), s.dark, 0.8, 0.62, 2.42);
        const bar = new THREE.Group();                                  // spinning light bar
        add(bar, boxGeo(1.5, 0.18, 0.4), s.dark, 0, 0, 0);
        add(bar, boxGeo(0.55, 0.26, 0.34), lightR, -0.42, 0.1, 0);
        add(bar, boxGeo(0.55, 0.26, 0.34), lightB, 0.42, 0.1, 0);
        bar.position.set(0, 1.68, -0.2);
        g.add(bar);
        g.userData.spinner = bar;
        add(g, boxGeo(0.8, 0.5, 0.06), stripe, 0, 1.05, -2.2);         // "MALL LAW" tail plate
        wheel(g, 0.44, 0.34, -1.02, 0.44, 1.45); wheel(g, 0.44, 0.34, 1.02, 0.44, 1.45);
        wheel(g, 0.44, 0.34, -1.02, 0.44, -1.45); wheel(g, 0.44, 0.34, 1.02, 0.44, -1.45);
        return g;
      },
    },
    {
      id: "monster",
      name: "Lawnzilla",
      archetype: "Oversized backyard monster truck",
      flavor: "HOA-certified natural disaster.",
      special: { id: "ground_slam", name: "Property Value Slam", desc: "Ground-pound that knocks back everything nearby." },
      stats: { hp: 135, accel: 15, top: 28, turn: 1.9, mass: 2.2, radius: 2.4 },
      build() {
        const g = beginBody();
        const s = shared();
        const body = T().mat("vehicle.monster.body", { color: 0x59a83b });
        const flame = T().mat("vehicle.monster.decal", { color: 0xffd23b });
        add(g, boxGeo(2.0, 0.8, 3.2), body, 0, 2.15, 0);               // tiny body way up high
        add(g, boxGeo(1.7, 0.7, 1.2), s.glass, 0, 2.8, 0.4);           // cab
        add(g, boxGeo(2.06, 0.3, 3.26), flame, 0, 1.85, 0);            // yellow rocker stripe
        add(g, cylGeo(0.08, 0.08, 1.6, 5), s.dark, -0.7, 1.4, 1.2, 0, 0, 0.5);  // comic suspension struts
        add(g, cylGeo(0.08, 0.08, 1.6, 5), s.dark, 0.7, 1.4, 1.2, 0, 0, -0.5);
        add(g, cylGeo(0.08, 0.08, 1.6, 5), s.dark, -0.7, 1.4, -1.2, 0, 0, 0.5);
        add(g, cylGeo(0.08, 0.08, 1.6, 5), s.dark, 0.7, 1.4, -1.2, 0, 0, -0.5);
        add(g, cylGeo(0.1, 0.1, 0.9, 6), s.chrome, -0.55, 2.9, -1.4);  // twin stacks
        add(g, cylGeo(0.1, 0.1, 0.9, 6), s.chrome, 0.55, 2.9, -1.4);
        add(g, boxGeo(0.5, 0.3, 0.3), flame, 0, 2.62, 1.75);           // rubber duck hood mascot
        add(g, sphGeo(0.2, 6), flame, 0, 2.85, 1.8);
        wheel(g, 1.15, 0.85, -1.45, 1.15, 1.35); wheel(g, 1.15, 0.85, 1.45, 1.15, 1.35);
        wheel(g, 1.15, 0.85, -1.45, 1.15, -1.35); wheel(g, 1.15, 0.85, 1.45, 1.15, -1.35);
        return g;
      },
    },
    {
      id: "hearse",
      name: "Casket Case",
      archetype: "Funeral hearse, heavy-metal livery",
      flavor: "Ask about the family discount.",
      special: { id: "casket_bombs", name: "Pre-Paid Plots", desc: "Drops a trail of casket proximity bombs." },
      stats: { hp: 115, accel: 17, top: 33, turn: 2.0, mass: 1.5, radius: 2.3 },
      build() {
        const g = beginBody();
        const s = shared();
        const body = T().mat("vehicle.hearse.body", { color: 0x191921 });
        const purple = T().mat("vehicle.hearse.trim", { color: 0x6a2c9e });
        const wood = T().mat("vehicle.hearse.casket", { color: 0x7a4a2b });
        add(g, boxGeo(2.0, 0.7, 5.4), body, 0, 0.78, 0);               // looong slab
        add(g, boxGeo(1.9, 0.72, 3.4), body, 0, 1.45, -0.8);           // tall rear box
        add(g, boxGeo(1.7, 0.5, 0.9), s.glassDark, 0, 1.35, 1.7);      // low cab glass
        add(g, boxGeo(2.06, 0.16, 5.46), purple, 0, 1.02, 0);          // purple pinstripe
        add(g, boxGeo(0.14, 0.14, 3.3), s.chrome, -0.85, 1.86, -0.8);  // roof rails
        add(g, boxGeo(0.14, 0.14, 3.3), s.chrome, 0.85, 1.86, -0.8);
        add(g, boxGeo(0.72, 0.34, 1.9), wood, 0, 1.1, -1.1);           // visible casket
        add(g, cylGeo(0.09, 0.09, 1.2, 6), s.chrome, -0.75, 1.6, 1.1, 0.4, 0, 0); // stack pipes
        add(g, cylGeo(0.09, 0.09, 1.2, 6), s.chrome, 0.75, 1.6, 1.1, 0.4, 0, 0);
        wheel(g, 0.46, 0.36, -1.02, 0.46, 1.9); wheel(g, 0.46, 0.36, 1.02, 0.46, 1.9);
        wheel(g, 0.46, 0.36, -1.02, 0.46, -1.9); wheel(g, 0.46, 0.36, 1.02, 0.46, -1.9);
        return g;
      },
    },
    {
      id: "bus",
      name: "Detention Express",
      archetype: "Substitute-driver-from-hell school bus",
      flavor: "You WILL be marked present.",
      special: { id: "tractor_shock", name: "Mandatory Attendance", desc: "Tractor beam yanks a rival close, then a shock burst." },
      stats: { hp: 150, accel: 13, top: 27, turn: 1.6, mass: 2.6, radius: 3.0 },
      build() {
        const g = beginBody();
        const s = shared();
        const body = T().mat("vehicle.bus.body", { color: 0xf2b21c });
        const stripe = T().mat("vehicle.bus.stripe", { color: 0x1a1a1a });
        const sign = T().basicMat("vehicle.bus.sign", { color: 0xd21f1f });
        add(g, boxGeo(2.4, 2.1, 6.6), body, 0, 1.6, -0.3);             // the long yellow law
        add(g, boxGeo(2.2, 1.0, 1.1), body, 0, 1.0, 3.35);             // hood snout
        add(g, boxGeo(2.46, 0.3, 6.66), stripe, 0, 1.35, -0.3);        // black belt stripe
        for (let i = 0; i < 5; i += 1) {                                // window row
          add(g, boxGeo(2.44, 0.55, 0.8), s.glassDark, 0, 2.2, 1.9 - i * 1.15);
        }
        add(g, boxGeo(0.7, 0.7, 0.1), sign, -1.3, 1.7, 0.6);           // STOP arm out
        add(g, cylGeo(0.05, 0.05, 0.7, 5), s.dark, -1.25, 1.3, 0.6);
        add(g, boxGeo(0.9, 0.4, 0.12), sign, 0, 2.85, 3.0);            // roof marquee
        wheel(g, 0.58, 0.44, -1.15, 0.58, 2.3); wheel(g, 0.58, 0.44, 1.15, 0.58, 2.3);
        wheel(g, 0.58, 0.44, -1.15, 0.58, -1.9); wheel(g, 0.58, 0.44, 1.15, 0.58, -1.9);
        return g;
      },
    },
    {
      id: "rideshare",
      name: "Five Star Frenzy",
      archetype: "Rating-obsessed rideshare sedan",
      flavor: "He tips himself.",
      special: { id: "surge_volley", name: "Surge Volley", desc: "Missile volley that costs a sliver of your own HP per shot." },
      stats: { hp: 90, accel: 22, top: 38, turn: 2.5, mass: 1.0, radius: 1.8 },
      build() {
        const g = beginBody();
        const s = shared();
        const body = T().mat("vehicle.rideshare.body", { color: 0x30b2c9 });
        const star = T().basicMat("vehicle.rideshare.star", { color: 0xffd23b });
        add(g, boxGeo(1.9, 0.55, 4.2), body, 0, 0.66, 0);              // eager little sedan
        add(g, boxGeo(1.7, 0.5, 2.2), s.glass, 0, 1.18, -0.1);
        add(g, boxGeo(1.94, 0.12, 4.24), star, 0, 0.86, 0);            // gold coach stripe
        // Roof rating sign: ★★★★★
        const signBar = add(g, boxGeo(1.7, 0.4, 0.12), s.dark, 0, 1.75, -0.1);
        for (let i = 0; i < 5; i += 1) {
          add(g, coneGeo(0.11, 0.24, 5), star, -0.62 + i * 0.31, 1.78, -0.02);
        }
        g.userData.spinner = signBar;
        add(g, coneGeo(0.16, 0.5, 6), star, 0, 1.2, 2.05);             // hood trophy
        add(g, sphGeo(0.12, 6), star, 0, 1.5, 2.05);
        add(g, boxGeo(0.5, 0.3, 0.05), star, 0.6, 1.0, 2.12);          // dash phone glow
        wheel(g, 0.42, 0.32, -0.98, 0.42, 1.4); wheel(g, 0.42, 0.32, 0.98, 0.42, 1.4);
        wheel(g, 0.42, 0.32, -0.98, 0.42, -1.4); wheel(g, 0.42, 0.32, 0.98, 0.42, -1.4);
        return g;
      },
    },
    {
      id: "rv",
      name: "The Equity",
      archetype: "Boomer road-trip RV, full amenities",
      flavor: "Bought in '78 for a handshake.",
      special: { id: "mower_smoke", name: "Reverse Mortgage", desc: "Mower-blade sweep plus a smoke screen." },
      stats: { hp: 140, accel: 13, top: 26, turn: 1.7, mass: 2.4, radius: 3.0 },
      build() {
        const g = beginBody();
        const s = shared();
        const body = T().mat("vehicle.rv.body", { color: 0xe8e0cc });
        const band = T().mat("vehicle.rv.stripe", { color: 0xb0622e });
        const chair = T().mat("vehicle.rv.chair", { color: 0x3f7fbf });
        add(g, boxGeo(2.5, 2.2, 6.2), body, 0, 1.65, 0);               // land yacht
        add(g, boxGeo(2.54, 0.5, 6.24), band, 0, 1.4, 0);              // 70s brown swoosh
        add(g, boxGeo(2.54, 0.22, 6.24), band, 0, 2.15, 0);
        add(g, boxGeo(2.3, 0.7, 0.2), s.glass, 0, 2.2, 3.05);          // big windshield
        // Roof: satellite dish, lawn chairs, cooler, ladder
        add(g, cylGeo(0.5, 0.14, 0.3, 9), s.chrome, -0.7, 3.0, -1.6, 0.9, 0, 0.3);
        add(g, boxGeo(0.5, 0.1, 0.5), chair, 0.6, 2.9, 0.4);
        add(g, boxGeo(0.5, 0.5, 0.1), chair, 0.6, 3.15, 0.15);
        add(g, boxGeo(0.5, 0.1, 0.5), chair, 0.6, 2.9, 1.2);
        add(g, boxGeo(0.5, 0.5, 0.1), chair, 0.6, 3.15, 0.95);
        add(g, boxGeo(0.6, 0.4, 0.4), body, -0.7, 3.0, 0.9);           // cooler
        add(g, boxGeo(0.12, 2.0, 0.3), s.chrome, 1.2, 1.8, -2.9);      // rear ladder
        add(g, boxGeo(0.4, 0.3, 1.4), s.rust, 0, 0.5, -3.4);           // towed mower rack
        wheel(g, 0.52, 0.4, -1.18, 0.52, 2.1); wheel(g, 0.52, 0.4, 1.18, 0.52, 2.1);
        wheel(g, 0.52, 0.4, -1.18, 0.52, -2.0); wheel(g, 0.52, 0.4, 1.18, 0.52, -2.0);
        return g;
      },
    },
    {
      id: "towtruck",
      name: "Repo Rocket",
      archetype: "Repo-man tow truck",
      flavor: "Your car called. It's his now.",
      special: { id: "chain_hook", name: "Asset Seizure", desc: "Chain hook yanks a target toward the nearest hazard." },
      stats: { hp: 120, accel: 18, top: 31, turn: 2.1, mass: 1.8, radius: 2.3 },
      build() {
        const g = beginBody();
        const s = shared();
        const body = T().mat("vehicle.towtruck.body", { color: 0xc9452e });
        const boomM = T().mat("vehicle.towtruck.boom", { color: 0xe8a020 });
        add(g, boxGeo(2.1, 0.8, 2.0), body, 0, 0.95, 1.5);             // beefy cab
        add(g, boxGeo(1.9, 0.6, 0.9), s.glass, 0, 1.6, 1.4);
        add(g, boxGeo(2.1, 0.5, 3.0), body, 0, 0.75, -1.1);            // flat bed
        add(g, boxGeo(2.2, 0.5, 0.4), s.dark, 0, 0.7, 2.6);            // ram bar
        // Boom crane with hook
        const boom = new THREE.Group();
        add(boom, boxGeo(0.4, 0.4, 2.6), boomM, 0, 0, -1.0);
        add(boom, cylGeo(0.04, 0.04, 1.0, 5), s.dark, 0, -0.5, -2.2);
        add(boom, coneGeo(0.18, 0.42, 6), s.chrome, 0, -1.05, -2.2, Math.PI, 0, 0); // hook
        boom.position.set(0, 1.55, -0.9);
        boom.rotation.x = 0.35;
        g.add(boom);
        g.userData.boom = boom;
        add(g, cylGeo(0.1, 0.1, 0.8, 6), s.chrome, -0.8, 1.7, 0.6);    // exhaust stack
        add(g, boxGeo(0.5, 0.3, 0.12), boomM, 0, 1.45, -2.55);         // REPO tail sign
        wheel(g, 0.5, 0.4, -1.08, 0.5, 1.5); wheel(g, 0.5, 0.4, 1.08, 0.5, 1.5);
        wheel(g, 0.5, 0.4, -1.08, 0.5, -1.5); wheel(g, 0.5, 0.4, 1.08, 0.5, -1.5);
        return g;
      },
    },
    {
      id: "garbage",
      name: "Trash Talker",
      archetype: "Overflowing garbage truck",
      flavor: "Certified curbside menace.",
      special: { id: "junk_barrage", name: "Hot Takes", desc: "Compactor crush plus a barrage of thrown junk." },
      stats: { hp: 160, accel: 12, top: 25, turn: 1.6, mass: 2.6, radius: 3.0 },
      build() {
        const g = beginBody();
        const s = shared();
        const body = T().mat("vehicle.garbage.body", { color: 0x4f7d4a });
        const hopper = T().mat("vehicle.garbage.hopper", { color: 0x39593a });
        const junk = T().mat("vehicle.garbage.junk", { color: 0x9a8a5a });
        add(g, boxGeo(2.3, 1.3, 1.6), body, 0, 1.25, 2.3);             // cab
        add(g, boxGeo(2.1, 0.6, 0.2), s.glass, 0, 1.7, 3.05);
        add(g, boxGeo(2.5, 2.0, 4.2), hopper, 0, 1.55, -0.6);          // hopper hull
        add(g, boxGeo(2.2, 0.5, 3.8), hopper, 0, 2.7, -0.6, 0, 0, 0.06); // crooked lid
        // Overflowing junk mound
        add(g, sphGeo(0.5, 6), junk, -0.5, 2.9, -1.2);
        add(g, boxGeo(0.6, 0.5, 0.7), junk, 0.5, 2.95, -0.2, 0.4, 0.5, 0);
        add(g, boxGeo(0.4, 0.7, 0.4), junk, 0.1, 3.0, -1.8, 0, 0.3, 0.4);
        add(g, cylGeo(0.16, 0.16, 0.8, 6), s.rust, 0.7, 2.95, -1.5, 0.7, 0, 0.4);
        add(g, boxGeo(0.9, 0.6, 0.2), body, -1.3, 1.0, 0.4);           // side-load arm
        add(g, boxGeo(2.4, 0.4, 0.6), s.dark, 0, 0.6, 3.1);            // front plow lip
        wheel(g, 0.56, 0.44, -1.15, 0.56, 2.2); wheel(g, 0.56, 0.44, 1.15, 0.56, 2.2);
        wheel(g, 0.56, 0.44, -1.15, 0.56, -1.6); wheel(g, 0.56, 0.44, 1.15, 0.56, -1.6);
        return g;
      },
    },
  ];

  const byId = {};
  ROSTER.forEach((v) => { byId[v.id] = v; });

  SCRAP.vehicles = {
    list: ROSTER,
    get: (id) => byId[id],
    build: (id) => byId[id].build(),
  };
})();
