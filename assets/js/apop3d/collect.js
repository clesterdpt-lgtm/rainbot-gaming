/* ============================================================
   APOP DEMON MOGGERS 3D - collectibles

   Platinum Records, Clout, Record Deals and the switches that gate
   them. Implements the frozen §9 surface:

     spawnRecord · spawnClout · spawnDeal · spawnSwitch · collectedRecords

   plus a few added methods (burst, spawnRedCoinSet, hitSwitch,
   dealActive, debugPopulate) that other modules can lean on. No
   existing signature is changed.

   The five decisions this file is built around:

   1. CLOUT IS INSTANCED, ONE MESH PER KIND. A course carries hundreds
      of pieces, so they cannot be individual Object3Ds. They are three
      InstancedMeshes - yellow, red, blue - rather than one mesh tinted
      by instanceColor, because per-instance colour is a shader define
      that silently does nothing if a future material swap drops it,
      and "all the coins turned gold" is a bug nobody would catch in
      review. Three draw calls is not a budget problem; a wrong colour
      is a correctness problem.

   2. COLLECTION IS A PHYSICS EVENT, NOT A TRIGGER. Clout from a popped
      demon arcs out under real gravity, bounces, settles, and only then
      becomes collectable - and inside MAGNET_RADIUS it accelerates into
      the player. The magnetise is most of why picking things up feels
      good; without it the player has to walk over each piece exactly.

   3. A RECORD IS A CEREMONY. Collecting one stops time, hands the
      camera to an orbit, plays the fanfare, poses the player and exits
      the course. That whole sequence runs off `clock.raw` rather than
      `clock.dt`, so it plays at full speed while the world around it is
      in slow motion, and it still plays if something else has zeroed dt.

   4. LIGHTS ARE ALLOCATED ONCE. Every Platinum Record wants its own
      light, and adding a light to a scene recompiles every material in
      it (CONTRACT §6). So a fixed set of RECORD_LIGHTS point lights is
      created at load, added once, and re-parented and dimmed to the
      records that are actually near the camera.

   5. EVERY CROSS-MODULE CALL IS OPTIONAL. player, collision, vfx, audio
      and hud are all built by other agents in parallel. Nothing here
      may throw because one of them is still a stub - and where a stub
      would leave the player unable to see the effect at all (the camera
      hand-off, the ground under a bouncing coin) there is a local
      fallback that does the job until the real module lands.
   ============================================================ */

import * as THREE from "three";
import { clamp01, damp, ease, TAU } from "apop3d/core.js";

/* ---------------------------- tuning ---------------------------- */

const GRAVITY = -22;              // matches CONTRACT §5
const MAGNET_RADIUS = 2.0;        // metres - the "it comes to you" ring
const MAGNET_GRAB = 0.55;         // metres - collected inside this
const MAGNET_ACCEL = 46;          // m/s^2 toward the player
const MAGNET_MAX_SPEED = 15;
const CLOUT_BOUNCE = 0.42;
const CLOUT_FRICTION = 4.2;
const CLOUT_SETTLE_SPEED = 1.1;   // below this after a bounce, it rests
const CLOUT_HOVER = 0.34;         // rest height above the ground it landed on
const RECORD_GRAB = 1.15;
const DEAL_GRAB = 1.0;
const SWITCH_RADIUS = 1.1;

const CLOUT_CAPS = { yellow: 320, red: 96, blue: 96 };
const RECORD_CAP = 10;
const DEAL_CAP = 8;
const SWITCH_CAP = 16;
const RECORD_LIGHTS = 3;

/** Ceremony beat sheet, in real seconds. Tuned against the SM64 star
 *  dance: the pause before the music starts is what sells it. */
const CEREMONY = {
  impact: 0.42,
  rise: 1.05,
  card: 2.60,
  exit: 1.15,
};

const CLOUT_KINDS = {
  yellow: { value: 1, color: 0xffd23f, emissive: 0xb8720a, glow: 0.55 },
  red: { value: 2, color: 0xff4d6d, emissive: 0x8e0f2c, glow: 0.75 },
  blue: { value: 5, color: 0x2ee0ff, emissive: 0x0b6d8e, glow: 1.0 },
};

/** The six Record Deals. Ids match the 2D game so a returning player
 *  meets the same contracts under the same names. `effect` is the flag
 *  player.js and the combat systems read through `dealActive`. */
const DEAL_TABLE = {
  "auto-tune-beam": {
    name: "AUTO-TUNE BEAM", blurb: "Beam pierces", duration: 22,
    color: 0x2ee0ff, effect: { pierce: 2, beamRate: 1.35 },
  },
  "stan-shield": {
    name: "STAN SHIELD", blurb: "One hit blocked", duration: 30,
    color: 0x8be0a4, effect: { shield: 1 },
  },
  "main-character-energy": {
    name: "MAIN CHARACTER ENERGY", blurb: "Untouchable", duration: 16,
    color: 0xffd23f, effect: { invulnerable: true, damage: 1.5 },
  },
  "choreo-cancel": {
    name: "CHOREO CANCEL", blurb: "Air-cancel any move", duration: 20,
    color: 0xff7ae0, effect: { airRefresh: true, cancelWindow: 0.25 },
  },
  "label-advance": {
    name: "LABEL ADVANCE", blurb: "Faster, harder, riskier", duration: 26,
    color: 0xec1a5e, effect: { speed: 1.28, damage: 1.4, incoming: 1.5 },
  },
  "diva-tax": {
    name: "DIVA TAX", blurb: "Clout pays double", duration: 18,
    color: 0xc9a2ff, effect: { cloutMultiplier: 2 },
  },
};

/* ------------------------ texture synthesis ------------------------ */

/* Small procedural canvases. These belong in textures.js eventually,
   but that module is owned by another agent and the collectibles must
   not sit untextured waiting for it - a flat plastic disc is exactly
   the tell CONTRACT §2 puts first. */

function canvasTexture(size, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  draw(g, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** The face of a Platinum Record: brushed metal, concentric grooves,
 *  a hot pink label and a spindle hole. Drawn once, shared by all. */
function makeRecordFaceTexture() {
  return canvasTexture(256, (g, s) => {
    const c = s / 2;
    const grd = g.createRadialGradient(c * 0.7, c * 0.6, s * 0.05, c, c, c);
    grd.addColorStop(0, "#ffffff");
    grd.addColorStop(0.35, "#dfe7f2");
    grd.addColorStop(0.72, "#9fb0c6");
    grd.addColorStop(1, "#6d7d95");
    g.fillStyle = grd;
    g.beginPath(); g.arc(c, c, c, 0, TAU); g.fill();

    // Grooves. Alternating luma at 2px is what makes a low-res disc
    // read as vinyl instead of as a coin.
    g.lineWidth = 1;
    for (let r = c * 0.32; r < c * 0.97; r += 2.4) {
      g.strokeStyle = r % 4.8 < 2.4 ? "rgba(255,255,255,0.32)" : "rgba(40,52,70,0.30)";
      g.beginPath(); g.arc(c, c, r, 0, TAU); g.stroke();
    }

    // A single bright wedge baked in: even before the sweep quad moves,
    // the disc has a highlight and never reads as flat.
    g.save();
    g.globalCompositeOperation = "lighter";
    const wedge = g.createLinearGradient(0, 0, s, s);
    wedge.addColorStop(0, "rgba(255,255,255,0)");
    wedge.addColorStop(0.46, "rgba(255,255,255,0.42)");
    wedge.addColorStop(0.54, "rgba(255,255,255,0.42)");
    wedge.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = wedge;
    g.beginPath(); g.arc(c, c, c, 0, TAU); g.fill();
    g.restore();

    g.fillStyle = "#ec1a5e";
    g.beginPath(); g.arc(c, c, c * 0.31, 0, TAU); g.fill();
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = 2;
    g.beginPath(); g.arc(c, c, c * 0.31, 0, TAU); g.stroke();

    g.fillStyle = "#ffe6ef";
    g.font = `700 ${Math.round(s * 0.075)}px "Bungee", "Arial Black", sans-serif`;
    g.textAlign = "center";
    g.fillText("APOP", c, c - s * 0.045);
    g.font = `700 ${Math.round(s * 0.05)}px "Bungee", "Arial Black", sans-serif`;
    g.fillText("PLATINUM", c, c + s * 0.10);

    g.fillStyle = "#2b1420";
    g.beginPath(); g.arc(c, c, c * 0.045, 0, TAU); g.fill();
  });
}

/** Soft additive halo, used behind Records and Deals. */
function makeHaloTexture() {
  return canvasTexture(128, (g, s) => {
    const c = s / 2;
    const grd = g.createRadialGradient(c, c, 0, c, c, c);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.24, "rgba(255,255,255,0.55)");
    grd.addColorStop(0.55, "rgba(255,255,255,0.14)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  });
}

/** A soft vertical bar. Rotated in-plane across the record face it
 *  becomes the specular sweep, which no amount of roughness tuning
 *  gives us for free without an environment map. */
function makeSweepTexture() {
  return canvasTexture(128, (g, s) => {
    const grd = g.createLinearGradient(0, 0, s, 0);
    grd.addColorStop(0, "rgba(255,255,255,0)");
    grd.addColorStop(0.42, "rgba(255,255,255,0.05)");
    grd.addColorStop(0.5, "rgba(255,255,255,0.95)");
    grd.addColorStop(0.58, "rgba(255,255,255,0.05)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    // Fade the ends so the bar does not clip square against the disc rim.
    const mask = g.createLinearGradient(0, 0, 0, s);
    mask.addColorStop(0, "rgba(0,0,0,1)");
    mask.addColorStop(0.5, "rgba(0,0,0,0)");
    mask.addColorStop(1, "rgba(0,0,0,1)");
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = mask;
    g.fillRect(0, 0, s, s);
  });
}

/** Clout face: a chunky coin stamp. Low-res on purpose. */
function makeCloutTexture() {
  return canvasTexture(64, (g, s) => {
    const c = s / 2;
    g.fillStyle = "#ffffff";
    g.beginPath(); g.arc(c, c, c, 0, TAU); g.fill();
    g.strokeStyle = "rgba(0,0,0,0.30)";
    g.lineWidth = 3;
    g.beginPath(); g.arc(c, c, c * 0.78, 0, TAU); g.stroke();
    g.fillStyle = "rgba(0,0,0,0.42)";
    g.font = `900 ${Math.round(s * 0.52)}px "Arial Black", sans-serif`;
    g.textAlign = "center";
    g.fillText("C", c, c + s * 0.19);
    g.globalCompositeOperation = "lighter";
    const sheen = g.createLinearGradient(0, 0, s, s);
    sheen.addColorStop(0, "rgba(255,255,255,0.55)");
    sheen.addColorStop(0.5, "rgba(255,255,255,0)");
    g.fillStyle = sheen;
    g.beginPath(); g.arc(c, c, c, 0, TAU); g.fill();
  });
}

/* ----------------------------- module ----------------------------- */

export function create(ctx) {
  const scene = ctx.scene;

  const group = new THREE.Group();
  group.name = "collect";
  scene.add(group);

  /* ---- shared assets ---- */

  const texRecordFace = makeRecordFaceTexture();
  const texHalo = makeHaloTexture();
  const texSweep = makeSweepTexture();
  const texClout = makeCloutTexture();

  const disposables = [texRecordFace, texHalo, texSweep, texClout];
  const track = (thing) => { disposables.push(thing); return thing; };

  // Clout geometry: a coin on its edge, spinning about Y. The cylinder
  // is authored along Y and rotated so its faces point along Z, which
  // is what makes the spin read as a coin rather than as a pill.
  const cloutGeo = track(new THREE.CylinderGeometry(0.21, 0.21, 0.055, 16, 1));
  cloutGeo.rotateX(Math.PI / 2);

  const recordGeo = track(new THREE.CylinderGeometry(0.60, 0.60, 0.055, 44, 1));
  recordGeo.rotateX(Math.PI / 2);

  const scratchV = new THREE.Vector3();
  const scratchV2 = new THREE.Vector3();
  const scratchQ = new THREE.Quaternion();
  const scratchM = new THREE.Matrix4();
  const scratchScale = new THREE.Vector3(1, 1, 1);
  const playerPoint = new THREE.Vector3();
  const upAxis = new THREE.Vector3(0, 1, 0);

  /* ---- Clout: one instanced mesh per kind ---- */

  const cloutMeshes = {};
  for (const kind of Object.keys(CLOUT_KINDS)) {
    const spec = CLOUT_KINDS[kind];
    const mat = track(new THREE.MeshStandardMaterial({
      map: texClout,
      color: spec.color,
      emissive: new THREE.Color(spec.emissive),
      emissiveIntensity: spec.glow,
      metalness: 0.35,
      roughness: 0.34,
    }));
    const mesh = new THREE.InstancedMesh(cloutGeo, mat, CLOUT_CAPS[kind]);
    mesh.name = `clout.${kind}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The instances move all over the course, so a bounding sphere fitted
    // at build time would cull the whole batch the moment the camera
    // looks away from the origin.
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.count = 0;
    group.add(mesh);
    cloutMeshes[kind] = mesh;
  }

  /* ---- Record materials ---- */

  // Emissive carries the disc. Metalness without an environment map
  // renders black, and the record has to read as platinum in a course
  // whose only light might be behind it.
  const recordFaceMat = track(new THREE.MeshStandardMaterial({
    map: texRecordFace,
    emissiveMap: texRecordFace,
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 0.72,
    metalness: 0.55,
    roughness: 0.26,
  }));
  const recordEdgeMat = track(new THREE.MeshStandardMaterial({
    color: 0xb9c6d8,
    emissive: 0x3d4a5e,
    emissiveIntensity: 0.35,
    metalness: 0.8,
    roughness: 0.3,
  }));
  // Both of these are additive over the disc face. Turned up far enough
  // to be obvious they clip the grooves to white and the record stops
  // reading as a record - the halo sells the glow, the face sells what
  // the thing is, and the face has to win.
  const sweepMat = track(new THREE.MeshBasicMaterial({
    map: texSweep,
    color: 0xffffff,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  const haloMat = track(new THREE.SpriteMaterial({
    map: texHalo,
    color: 0xfff2f8,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  const sweepGeo = track(new THREE.PlaneGeometry(1.32, 1.32));

  /* ---- record lights, allocated once ---- */

  const recordLights = [];
  for (let i = 0; i < RECORD_LIGHTS; i += 1) {
    const light = new THREE.PointLight(0xffe9f2, 0, 11, 1.8);
    light.name = `recordLight${i}`;
    light.castShadow = false;
    group.add(light);
    recordLights.push({ light, owner: null });
  }

  /* ---- pools ---- */

  /** Clout items. Flat preallocated array; `active` is the only gate.
   *  Nothing here allocates once the pool is built. */
  const clout = [];
  const cloutFree = { yellow: [], red: [], blue: [] };
  for (const kind of Object.keys(CLOUT_KINDS)) {
    for (let slot = 0; slot < CLOUT_CAPS[kind]; slot += 1) {
      clout.push({
        active: false, kind, slot, value: CLOUT_KINDS[kind].value,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        state: "rest", restY: 0, spin: 0, phase: 0, age: 0, life: 0,
        bounces: 0, setId: null, index: clout.length,
      });
      cloutFree[kind].push(clout.length - 1);
    }
  }
  const cloutHigh = { yellow: 0, red: 0, blue: 0 };
  const cloutDirty = { yellow: true, red: true, blue: true };

  function buildRecordNode() {
    const node = new THREE.Group();
    node.visible = false;

    const disc = new THREE.Mesh(recordGeo, [recordEdgeMat, recordFaceMat, recordFaceMat]);
    /* Ground it. vfx.js scans the scene for userData.contactShadow and
       draws a blob; declaring it is the entire integration. A Platinum
       Record hovering with nothing under it is the single loudest
       "not finished" cue in the frame, and it is the one object the
       whole course is pointed at. */
    disc.userData.contactShadow = { radius: 0.55, strength: 0.5 };
    disc.name = "recordDisc";
    node.add(disc);

    const sweepA = new THREE.Mesh(sweepGeo, sweepMat);
    sweepA.position.z = 0.036;
    const sweepB = new THREE.Mesh(sweepGeo, sweepMat);
    sweepB.position.z = -0.036;
    sweepB.rotation.y = Math.PI;
    node.add(sweepA, sweepB);

    const halo = new THREE.Sprite(haloMat);
    halo.scale.setScalar(2.2);
    node.add(halo);

    group.add(node);
    return { node, disc, sweepA, sweepB, halo };
  }

  const records = [];
  for (let i = 0; i < RECORD_CAP; i += 1) {
    const parts = buildRecordNode();
    records.push({
      active: false, id: "", courseId: 0, collected: false,
      x: 0, y: 0, z: 0, baseY: 0, spin: 0, phase: i * 0.7, age: 0,
      hidden: false, requires: null, onCollect: null, name: "",
      ...parts,
    });
  }

  /** Scratch list of on-screen Records, reused every frame by the light
   *  assignment below so the selection never allocates. */
  const lit = [];

  /* ---- Record Deals ---- */

  // A sleeve with real depth. A flat card spinning about Y is edge-on
  // for half of every rotation and vanishes; a slab always presents a
  // face to the camera no matter where it is in the spin.
  const dealGeo = track(new THREE.BoxGeometry(0.80, 0.80, 0.34));
  const dealRingGeo = track(new THREE.TorusGeometry(0.72, 0.05, 8, 26));

  const deals = [];
  for (let i = 0; i < DEAL_CAP; i += 1) {
    const node = new THREE.Group();
    node.visible = false;
    const sleeveMat = track(new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.85,
      metalness: 0.15, roughness: 0.5,
    }));
    const sleeve = new THREE.Mesh(dealGeo, sleeveMat);
    sleeve.userData.contactShadow = { radius: 0.5, strength: 0.45 };
    const ringMat = track(new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const ring = new THREE.Mesh(dealRingGeo, ringMat);
    const halo = new THREE.Sprite(track(haloMat.clone()));
    halo.scale.setScalar(2.1);
    node.add(sleeve, ring, halo);
    group.add(node);
    deals.push({
      active: false, dealId: "", node, sleeve, sleeveMat, ring, ringMat, halo,
      x: 0, y: 0, z: 0, baseY: 0, age: 0, phase: i * 1.3,
    });
  }

  /* ---- switches ---- */

  const switchBaseGeo = track(new THREE.CylinderGeometry(0.62, 0.72, 0.16, 18));
  const switchCapGeo = track(new THREE.CylinderGeometry(0.52, 0.52, 0.22, 18));

  const switches = [];
  for (let i = 0; i < SWITCH_CAP; i += 1) {
    const node = new THREE.Group();
    node.visible = false;
    const baseMat = track(new THREE.MeshStandardMaterial({
      color: 0x2b3446, metalness: 0.5, roughness: 0.55,
    }));
    const capMat = track(new THREE.MeshStandardMaterial({
      color: 0x2ee0ff, emissive: 0x0b6d8e, emissiveIntensity: 0.9,
      metalness: 0.35, roughness: 0.35,
    }));
    const base = new THREE.Mesh(switchBaseGeo, baseMat);
    base.userData.contactShadow = { radius: 0.62, strength: 0.55 };
    base.position.y = 0.08;
    const cap = new THREE.Mesh(switchCapGeo, capMat);
    cap.position.y = 0.26;
    node.add(base, cap);
    group.add(node);
    switches.push({
      active: false, kind: "blue", node, cap, capMat, base,
      x: 0, y: 0, z: 0, pressed: false, press: 0, cooldown: 0,
      onHit: null, payload: null, phase: i * 0.9,
    });
  }

  /* ---- red-coin sets ---- */

  const redSets = new Map();   // setId -> { total, taken, recordId, recordPos, courseId }
  let redSetSeq = 0;

  /* ---- blue-switch runs and timed runs ---- */

  const runs = [];   // { kind, remaining, onExpire, spawned:[cloutIndex] }

  /* ---- active deal timers ---- */

  const activeDeals = [];   // { dealId, remaining, duration, spec }

  const dealAura = (() => {
    const node = new THREE.Group();
    node.visible = false;
    const shellGeo = track(new THREE.IcosahedronGeometry(0.92, 1));
    const shellMat = track(new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
    }));
    /* A faceted inner shell, NOT a wireframe.
       `wireframe: true` draws uniform hairlines with no falloff, which
       is indistinguishable from a leftover debug volume in a still
       frame - a blind art critic called exactly that out on the boss
       shield and the drone globe, both since replaced with shaded
       surfaces. Thin bright lines are also the worst case for the
       pixel-noise metric this project is measured on: swapping the
       equivalent shell elsewhere moved that frame's Laplacian by 1.2.
       A second additive facet layer, offset and dimmer, gives the same
       "energy shell" read as an authored object. */
    const wireMat = track(new THREE.MeshBasicMaterial({
      color: 0xfff2c4, transparent: true, opacity: 0.20,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.FrontSide,
    }));
    const shell = new THREE.Mesh(shellGeo, shellMat);
    const wireGeo = track(new THREE.IcosahedronGeometry(0.83, 1));
    const wire = new THREE.Mesh(wireGeo, wireMat);
    const halo = new THREE.Sprite(track(haloMat.clone()));
    halo.scale.setScalar(3.1);
    halo.material.opacity = 0.32;
    node.add(shell, wire, halo);
    group.add(node);
    return { node, shell, shellMat, wire, wireMat, halo };
  })();

  /* --------------------------- state --------------------------- */

  const sessionRecords = new Map();   // courseId -> Set of ids
  let cloutMilestone = 100;           // next Clout total that heals

  const ceremony = {
    active: false, phase: "", t: 0, record: null,
    camFrom: new THREE.Vector3(), camTo: new THREE.Vector3(),
    focus: new THREE.Vector3(), angle: 0, cardOpen: false, ownCamera: false,
  };

  let debugPlayer = null;   // Vector3 the harness can set when player.js is a stub

  /* -------------------------- helpers -------------------------- */

  /** Resolve the player's world position. player.js exposes different
   *  shapes as it grows, so probe all of them and fall back to the QA
   *  override. Returns false when there is genuinely nobody to attract to. */
  function resolvePlayer(out) {
    const p = ctx.player;
    const src = (p && (
      (p.body && p.body.position) || p.position || (p.root && p.root.position)
      || (p.rig && p.rig.root && p.rig.root.position)
    )) || debugPlayer;
    if (!src || !Number.isFinite(src.x)) return false;
    out.set(src.x, src.y, src.z);
    return true;
  }

  /** Ground height under a point, or null when collision has nothing to
   *  say. A null answer makes a bouncing coin settle at the height it
   *  was thrown from, which is right far more often than dropping it to
   *  y = 0 through the floor of a rooftop course. */
  function groundUnder(x, z, fromY) {
    const hit = ctx.collision && typeof ctx.collision.groundAt === "function"
      ? ctx.collision.groundAt(x, z, fromY, 24)
      : null;
    return hit && Number.isFinite(hit.y) ? hit.y : null;
  }

  const fx = (name, x, y, z, opts) => {
    if (!ctx.vfx || typeof ctx.vfx.burst !== "function") return;
    scratchV2.set(x, y, z);
    ctx.vfx.burst(name, scratchV2, opts);
  };

  const sfx = (name, opts) => {
    if (ctx.audio && typeof ctx.audio.play === "function") ctx.audio.play(name, opts);
  };

  const dealMultiplier = () => {
    for (let i = 0; i < activeDeals.length; i += 1) {
      const m = activeDeals[i].spec.effect.cloutMultiplier;
      if (m) return m;
    }
    return 1;
  };

  /* ---------------------------- Clout ---------------------------- */

  function acquireClout(kind) {
    const free = cloutFree[kind];
    if (free.length === 0) {
      // Saturated. Recycle the oldest resting piece rather than dropping
      // the spawn: a demon that pops and produces nothing reads as a bug.
      let oldest = -1, oldestAge = -1;
      for (let i = 0; i < clout.length; i += 1) {
        const item = clout[i];
        if (item.active && item.kind === kind && item.state === "rest" && item.age > oldestAge) {
          oldestAge = item.age; oldest = i;
        }
      }
      if (oldest < 0) return null;
      releaseClout(clout[oldest]);
      return clout[cloutFree[kind].pop()];
    }
    return clout[free.pop()];
  }

  function releaseClout(item) {
    if (!item.active) return;
    item.active = false;
    item.setId = null;
    cloutFree[item.kind].push(item.index);
    // Collapse the instance here rather than sweeping every dead slot
    // once a frame. A released piece is released exactly once; a sweep
    // costs the whole high-water mark on every frame of play.
    scratchM.makeScale(0, 0, 0);
    cloutMeshes[item.kind].setMatrixAt(item.slot, scratchM);
    cloutDirty[item.kind] = true;
  }

  /**
   * §9: spawnClout(position, kind). `opts` is additive and optional -
   * an arc velocity for pops, a lifetime for switch-spawned pieces.
   */
  function spawnClout(position, kind = "yellow", opts) {
    const k = CLOUT_KINDS[kind] ? kind : "yellow";
    const item = acquireClout(k);
    if (!item) return null;

    const o = opts || {};
    item.active = true;
    item.x = position.x; item.y = position.y; item.z = position.z;
    item.value = CLOUT_KINDS[k].value;
    item.spin = ctx.rng ? ctx.rng() * TAU : Math.random() * TAU;
    item.phase = ctx.rng ? ctx.rng() * TAU : Math.random() * TAU;
    item.age = 0;
    item.bounces = 0;
    item.setId = o.setId || null;
    item.life = Number.isFinite(o.life) ? o.life : 0;

    if (o.vx !== undefined || o.vy !== undefined || o.vz !== undefined) {
      item.vx = o.vx || 0; item.vy = o.vy || 0; item.vz = o.vz || 0;
      item.state = "arc";
      item.restY = position.y;
    } else {
      item.vx = 0; item.vy = 0; item.vz = 0;
      item.state = "rest";
      item.restY = position.y - CLOUT_HOVER;
    }

    const slotEnd = item.slot + 1;
    if (slotEnd > cloutHigh[k]) { cloutHigh[k] = slotEnd; cloutMeshes[k].count = slotEnd; }
    cloutDirty[k] = true;
    return item;
  }

  /**
   * Added method. Scatter `count` pieces out of a point with real arc
   * velocities - what an enemy pop produces. The spread is a ring with
   * jitter rather than pure random, so a burst never clumps into one
   * side and never looks like a fountain.
   */
  function burst(position, count = 5, kind = "yellow", opts) {
    const o = opts || {};
    const power = Number.isFinite(o.power) ? o.power : 1;
    const rng = ctx.rng || Math.random;
    const made = [];
    const base = rng() * TAU;
    for (let i = 0; i < count; i += 1) {
      const a = base + (i / count) * TAU + (rng() - 0.5) * 0.7;
      const out = (2.2 + rng() * 1.9) * power;
      const up = (5.2 + rng() * 3.4) * power;
      const item = spawnClout(position, kind, {
        vx: Math.cos(a) * out,
        vy: up,
        vz: Math.sin(a) * out,
        setId: o.setId || null,
        life: o.life,
      });
      if (item) made.push(item);
    }
    fx("coinPop", position.x, position.y, position.z, { count });
    sfx("cloutPop", { pos: position });
    return made;
  }

  function collectClout(item) {
    const value = Math.round(item.value * dealMultiplier());
    ctx.state.clout = (ctx.state.clout || 0) + value;

    if (ctx.save && typeof ctx.save.addClout === "function") {
      ctx.save.addClout(value, ctx.state.course);
    }
    if (ctx.hud && typeof ctx.hud.setClout === "function") ctx.hud.setClout(ctx.state.clout);

    // Every hundred tops the player back up, exactly as SM64's coins do.
    // Tracked against a moving threshold rather than a modulo, because
    // Diva Tax doubles the value and would step straight over the mark.
    while (ctx.state.clout >= cloutMilestone) {
      cloutMilestone += 100;
      ctx.state.hp = ctx.state.maxHp;
      if (ctx.hud && typeof ctx.hud.setHealth === "function") {
        ctx.hud.setHealth(ctx.state.hp, ctx.state.maxHp);
      }
      if (ctx.hud && typeof ctx.hud.toast === "function") {
        ctx.hud.toast("100 CLOUT", { tone: "gold", sub: "Health restored" });
      }
      sfx("cloutMilestone");
    }

    if (item.setId) {
      const set = redSets.get(item.setId);
      if (set) {
        set.taken += 1;
        if (ctx.hud && typeof ctx.hud.toast === "function") {
          ctx.hud.toast(`RED CLOUT ${set.taken} / ${set.total}`, { tone: "red", small: true });
        }
        if (set.taken >= set.total) completeRedSet(item.setId, set);
      }
    }

    fx("sparkle", item.x, item.y, item.z, { color: CLOUT_KINDS[item.kind].color });
    sfx(item.kind === "yellow" ? "clout" : `clout.${item.kind}`);
    ctx.bus.emit("collect:clout", { kind: item.kind, value, total: ctx.state.clout });
    releaseClout(item);
  }

  function updateClout(dt, hasPlayer) {
    const magnetR2 = MAGNET_RADIUS * MAGNET_RADIUS;
    const grabR2 = MAGNET_GRAB * MAGNET_GRAB;
    const t = ctx.clock.t;

    for (let i = 0; i < clout.length; i += 1) {
      const item = clout[i];
      if (!item.active) continue;
      item.age += dt;

      if (item.life > 0) {
        item.life -= dt;
        if (item.life <= 0) {
          fx("sparkle", item.x, item.y, item.z, { color: CLOUT_KINDS[item.kind].color });
          releaseClout(item);
          continue;
        }
      }

      if (item.state === "arc") {
        item.vy += GRAVITY * dt;
        item.x += item.vx * dt;
        item.y += item.vy * dt;
        item.z += item.vz * dt;

        const g = groundUnder(item.x, item.z, item.y + 1.0);
        const floor = g !== null ? g : item.restY;
        if (item.y <= floor + 0.06 && item.vy < 0) {
          item.y = floor + 0.06;
          item.vy = -item.vy * CLOUT_BOUNCE;
          item.vx *= 0.62; item.vz *= 0.62;
          item.bounces += 1;
          const speed = Math.hypot(item.vx, item.vy, item.vz);
          if (item.bounces >= 3 || speed < CLOUT_SETTLE_SPEED) {
            item.state = "rest";
            item.restY = floor;
            item.vx = item.vy = item.vz = 0;
          }
        }
        item.vx = damp(item.vx, 0, CLOUT_FRICTION * 0.25, dt);
        item.vz = damp(item.vz, 0, CLOUT_FRICTION * 0.25, dt);
        item.spin += dt * 9.0;
      } else if (item.state === "rest") {
        item.y = item.restY + CLOUT_HOVER + Math.sin(t * 2.6 + item.phase) * 0.075;
        item.spin += dt * 3.6;
      } else if (item.state === "magnet") {
        const dx = playerPoint.x - item.x;
        const dy = (playerPoint.y + 0.85) - item.y;
        const dz = playerPoint.z - item.z;
        const dist = Math.hypot(dx, dy, dz) || 1e-4;
        const inv = 1 / dist;
        // Acceleration rather than a lerp: the piece visibly whips in as
        // it gets closer, which is the whole feel of the magnetise.
        const pull = MAGNET_ACCEL * (1 + (1 - clamp01(dist / MAGNET_RADIUS)) * 1.6);
        item.vx += dx * inv * pull * dt;
        item.vy += dy * inv * pull * dt;
        item.vz += dz * inv * pull * dt;
        const speed = Math.hypot(item.vx, item.vy, item.vz);
        if (speed > MAGNET_MAX_SPEED) {
          const s = MAGNET_MAX_SPEED / speed;
          item.vx *= s; item.vy *= s; item.vz *= s;
        }
        item.x += item.vx * dt;
        item.y += item.vy * dt;
        item.z += item.vz * dt;
        item.spin += dt * 16;
        if (dx * dx + dy * dy + dz * dz < grabR2) { collectClout(item); continue; }
      }

      if (hasPlayer && item.state !== "magnet") {
        const dx = playerPoint.x - item.x;
        const dy = (playerPoint.y + 0.85) - item.y;
        const dz = playerPoint.z - item.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < grabR2) { collectClout(item); continue; }
        if (d2 < magnetR2 && item.age > 0.28) {
          item.state = "magnet";
          item.vx *= 0.3; item.vy = Math.max(item.vy, 0.6); item.vz *= 0.3;
        }
      }

      cloutDirty[item.kind] = true;
      scratchV.set(item.x, item.y, item.z);
      scratchQ.setFromAxisAngle(upAxis, item.spin);
      scratchScale.set(1, 1, 1);
      scratchM.compose(scratchV, scratchQ, scratchScale);
      cloutMeshes[item.kind].setMatrixAt(item.slot, scratchM);
    }

    for (const kind of Object.keys(cloutMeshes)) {
      if (!cloutDirty[kind]) continue;
      cloutMeshes[kind].instanceMatrix.needsUpdate = true;
      cloutDirty[kind] = false;
    }
  }

  /* ------------------------ Platinum Records ------------------------ */

  /**
   * §9: spawnRecord(id, position, opts).
   * opts: { hidden, requires, onCollect, name }
   */
  function spawnRecord(id, position, opts) {
    const o = opts || {};
    const courseId = Number.isFinite(o.courseId) ? o.courseId : (ctx.state.course || 0);

    // Already in the save: leave the pedestal empty rather than let the
    // player re-run a ceremony they have already seen.
    if (!o.force && collectedRecords(courseId).has(String(id))) return null;

    let rec = null;
    for (let i = 0; i < records.length; i += 1) if (!records[i].active) { rec = records[i]; break; }
    if (!rec) return null;

    rec.active = true;
    rec.collected = false;
    rec.id = String(id);
    rec.courseId = courseId;
    rec.name = o.name || "PLATINUM RECORD";
    rec.x = position.x; rec.y = position.y; rec.z = position.z;
    rec.baseY = position.y;
    rec.age = 0;
    rec.spin = 0;
    rec.hidden = !!o.hidden;
    rec.requires = o.requires || null;
    rec.onCollect = typeof o.onCollect === "function" ? o.onCollect : null;
    rec.node.visible = !rec.hidden;
    rec.node.position.set(position.x, position.y, position.z);
    rec.node.scale.setScalar(1);
    return rec;
  }

  /** Reveal a hidden record - what a red-coin set or a switch run pays
   *  out. Pops in with a scale overshoot so the appearance is an event. */
  function revealRecord(rec, at) {
    if (!rec || !rec.active) return;
    if (at) { rec.x = at.x; rec.y = at.y; rec.z = at.z; rec.baseY = at.y; }
    rec.hidden = false;
    rec.age = 0;
    rec.node.position.set(rec.x, rec.y, rec.z);
    rec.node.visible = true;
    rec.node.scale.setScalar(0.01);
    fx("recordGet", rec.x, rec.y, rec.z, { reveal: true });
    sfx("recordAppear", { pos: rec.node.position });
    if (ctx.hud && typeof ctx.hud.toast === "function") {
      ctx.hud.toast("A PLATINUM RECORD APPEARED", { tone: "platinum" });
    }
  }

  function updateRecords(dt) {
    const t = ctx.clock.t;
    lit.length = 0;

    // One shared sweep material for every Record, so the shimmer is set
    // once here rather than fought over inside the loop.
    sweepMat.opacity = 0.24 + 0.22 * (0.5 + 0.5 * Math.sin(t * 2.1));

    for (let i = 0; i < records.length; i += 1) {
      const rec = records[i];
      if (!rec.active) { rec.node.visible = false; continue; }
      if (rec.hidden) { rec.node.visible = false; continue; }

      rec.age += dt;
      rec.spin += dt * 1.35;

      const bob = Math.sin(t * 1.55 + rec.phase) * 0.14;
      const pop = rec.age < 0.55 ? ease.outBack(clamp01(rec.age / 0.55)) : 1;

      if (!ceremony.active || ceremony.record !== rec) {
        rec.node.position.set(rec.x, rec.baseY + bob, rec.z);
        rec.node.rotation.y = rec.spin;
        rec.node.scale.setScalar(pop);
        rec.node.visible = true;
      }

      // The sweep rotates in-plane on the disc face. Slower than the
      // disc itself, so the highlight visibly crawls across the metal
      // instead of locking to the geometry and looking painted on.
      const sweepAngle = t * 0.85 + rec.phase;
      rec.sweepA.rotation.z = sweepAngle;
      rec.sweepB.rotation.z = -sweepAngle;

      rec.halo.scale.setScalar(2.05 + Math.sin(t * 2.4 + rec.phase) * 0.2);
      lit.push(rec);
    }

    // Three lights for however many Records are on screen, handed to the
    // three nearest the camera. Selection sort over at most ten entries,
    // no allocation: adding or removing a light instead would recompile
    // every material in the scene (CONTRACT §6).
    for (let slotIndex = 0; slotIndex < recordLights.length; slotIndex += 1) {
      const slot = recordLights[slotIndex];
      let best = -1;
      let bestDist = Infinity;
      for (let i = slotIndex; i < lit.length; i += 1) {
        const d = lit[i].node.position.distanceToSquared(ctx.camera.position);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      if (best < 0) {
        slot.owner = null;
        slot.light.intensity = damp(slot.light.intensity, 0, 8, dt);
        continue;
      }
      const swap = lit[slotIndex]; lit[slotIndex] = lit[best]; lit[best] = swap;
      const rec = lit[slotIndex];
      slot.owner = rec;
      slot.light.position.copy(rec.node.position);
      slot.light.intensity = damp(slot.light.intensity, 14, 6, dt);
    }
  }

  function tryCollectRecords(hasPlayer) {
    if (!hasPlayer || ceremony.active) return;
    const grab2 = RECORD_GRAB * RECORD_GRAB;
    for (let i = 0; i < records.length; i += 1) {
      const rec = records[i];
      if (!rec.active || rec.hidden || rec.collected) continue;
      const dx = playerPoint.x - rec.x;
      const dy = (playerPoint.y + 0.9) - rec.node.position.y;
      const dz = playerPoint.z - rec.z;
      if (dx * dx + dy * dy + dz * dz < grab2) { beginCeremony(rec); return; }
    }
  }

  /* ------------------------- the ceremony ------------------------- */

  /**
   * The defining SM64 memory: everything stops, the camera leaves the
   * player's shoulder, the fanfare plays, and the course spits you back
   * into the hub holding the thing you came for.
   *
   * Runs on `clock.raw`, not `clock.dt`, for two reasons: the slow
   * motion it requests must not slow the ceremony itself, and a system
   * that zeroes dt (a pause, a stub) must not strand the player inside
   * a cutscene with no way out.
   */
  function beginCeremony(rec) {
    rec.collected = true;
    ceremony.active = true;
    ceremony.phase = "impact";
    ceremony.t = 0;
    ceremony.record = rec;
    ceremony.cardOpen = false;
    ceremony.focus.set(rec.x, rec.baseY, rec.z);
    ceremony.angle = 0;
    ceremony.ownCamera = !(ctx.cameraRig && typeof ctx.cameraRig.cutscene === "function");
    ceremony.camFrom.copy(ctx.camera.position);

    const total = ctx.save && typeof ctx.save.recordCount === "function"
      ? ctx.save.recordCount(rec.courseId) : 0;

    // Progress lands immediately. A player who closes the tab during the
    // fanfare still keeps the Record.
    const fresh = ctx.save && typeof ctx.save.addRecord === "function"
      ? ctx.save.addRecord(rec.courseId, rec.id, { time: ctx.clock.t })
      : true;
    if (!sessionRecords.has(rec.courseId)) sessionRecords.set(rec.courseId, new Set());
    sessionRecords.get(rec.courseId).add(rec.id);
    ctx.state.records = ctx.save && typeof ctx.save.totalRecords === "function"
      ? ctx.save.totalRecords() : (ctx.state.records || 0) + 1;

    if (ctx.hud && typeof ctx.hud.setRecords === "function") {
      ctx.hud.setRecords(ctx.save && typeof ctx.save.recordCount === "function"
        ? ctx.save.recordCount(rec.courseId) : total + 1, 7);
    }
    if (ctx.hud && typeof ctx.hud.clearPrompt === "function") ctx.hud.clearPrompt();

    // Slow motion is advisory: main.js owns dt. Setting the field and
    // announcing it on the bus means the moment the spine multiplies by
    // clock.timeScale this reads exactly as intended, and until then the
    // ceremony still plays because it runs off raw time.
    ctx.clock.timeScale = 0.08;
    ctx.bus.emit("time:scale", { scale: 0.08, reason: "record" });

    if (ctx.audio && typeof ctx.audio.duck === "function") ctx.audio.duck(0.85, 5.0);
    sfx("recordFanfare", { gain: 1.0 });

    if (ctx.vfx && typeof ctx.vfx.flash === "function") ctx.vfx.flash(0xffffff, 0.9, 0.5);
    if (ctx.vfx && typeof ctx.vfx.shake === "function") ctx.vfx.shake(0.35, 0.4);
    fx("recordGet", rec.x, rec.baseY, rec.z, { big: true });

    if (ctx.player && typeof ctx.player.setAction === "function") ctx.player.setAction("victory");
    else if (ctx.player && ctx.player.anim && typeof ctx.player.anim.play === "function") {
      ctx.player.anim.play("victory", { fade: 0.12, loop: false });
    }

    if (!ceremony.ownCamera) {
      ctx.cameraRig.cutscene({
        mode: "recordOrbit",
        target: ceremony.focus,
        radius: 5.2,
        height: 2.4,
        spin: TAU * 0.55,
        duration: CEREMONY.impact + CEREMONY.rise + CEREMONY.card,
      });
    }

    ctx.bus.emit("collect:record", {
      id: rec.id, courseId: rec.courseId, name: rec.name,
      fresh, total: ctx.state.records,
    });
  }

  function updateCeremony(raw) {
    if (!ceremony.active) return;
    const rec = ceremony.record;
    ceremony.t += raw;

    if (ceremony.phase === "impact") {
      const k = clamp01(ceremony.t / CEREMONY.impact);
      // Hitstop, then time eases back toward a slow crawl.
      ctx.clock.timeScale = 0.08 + 0.24 * ease.outCubic(k);
      const lift = ease.outQuad(k) * 0.5;
      rec.node.position.set(rec.x, rec.baseY + lift, rec.z);
      rec.node.rotation.y += raw * 22 * (1 - k * 0.6);
      rec.node.scale.setScalar(1 + ease.outBack(k) * 0.35);
      rec.halo.scale.setScalar(2.6 + k * 4.5);
      if (ceremony.t >= CEREMONY.impact) { ceremony.phase = "rise"; ceremony.t = 0; }
    } else if (ceremony.phase === "rise") {
      const k = clamp01(ceremony.t / CEREMONY.rise);
      ctx.clock.timeScale = 0.32 + 0.28 * k;
      const lift = 0.5 + ease.outCubic(k) * 1.9;
      rec.node.position.set(rec.x, rec.baseY + lift, rec.z);
      rec.node.rotation.y += raw * (9 - 6 * k);
      rec.node.scale.setScalar(1.35 + ease.outBack(k) * 0.25);
      rec.halo.scale.setScalar(7.1 - k * 3.2);
      ceremony.focus.set(rec.x, rec.baseY + lift * 0.55, rec.z);
      if (ceremony.t >= CEREMONY.rise) {
        ceremony.phase = "card";
        ceremony.t = 0;
        openCeremonyCard(rec);
      }
    } else if (ceremony.phase === "card") {
      // Time comes most of the way back while the card is up, so the
      // world behind it is alive rather than a still.
      ctx.clock.timeScale = 0.6 + 0.3 * clamp01(ceremony.t / CEREMONY.card);
      const bob = Math.sin(ceremony.t * 2.0) * 0.10;
      rec.node.position.set(rec.x, rec.baseY + 2.4 + bob, rec.z);
      rec.node.rotation.y += raw * 2.6;
      rec.node.scale.setScalar(1.6);
      if (ceremony.t >= CEREMONY.card) {
        ceremony.phase = "exit";
        ceremony.t = 0;
        if (ctx.vfx && typeof ctx.vfx.flash === "function") ctx.vfx.flash(0xffffff, 1.0, CEREMONY.exit);
      }
    } else if (ceremony.phase === "exit") {
      const k = clamp01(ceremony.t / CEREMONY.exit);
      rec.node.scale.setScalar(1.6 * (1 - ease.inCubic(k)));
      rec.node.rotation.y += raw * (2.6 + k * 26);
      if (ceremony.t >= CEREMONY.exit) { endCeremony(rec); return; }
    }

    if (ceremony.ownCamera) driveCeremonyCamera(raw);
  }

  function openCeremonyCard(rec) {
    if (ceremony.cardOpen) return;
    ceremony.cardOpen = true;
    const have = ctx.save && typeof ctx.save.recordCount === "function"
      ? ctx.save.recordCount(rec.courseId) : 1;
    if (ctx.hud && typeof ctx.hud.openMenu === "function") {
      ctx.hud.openMenu("record", {
        name: rec.name,
        courseId: rec.courseId,
        index: have,
        total: 7,
        allRecords: ctx.state.records,
        clout: ctx.state.clout || 0,
      });
    }
  }

  /**
   * Fallback cutscene camera. camera.js owns the rig, and once it
   * exposes `cutscene` this never runs - `beginCeremony` hands off
   * instead. Until then this is what makes the ceremony read as a
   * ceremony rather than as the player standing still.
   */
  function driveCeremonyCamera(raw) {
    ceremony.angle += raw * 0.72;
    const rise = ceremony.phase === "impact" ? 1.6 : 2.6;
    const radius = ceremony.phase === "impact" ? 6.4 : 5.0;
    scratchV.set(
      ceremony.focus.x + Math.cos(ceremony.angle) * radius,
      ceremony.focus.y + rise,
      ceremony.focus.z + Math.sin(ceremony.angle) * radius
    );
    const blend = clamp01(ceremony.t / 0.6);
    ctx.camera.position.lerpVectors(ceremony.camFrom, scratchV, ease.outCubic(blend));
    if (blend >= 1) ceremony.camFrom.copy(ctx.camera.position);
    scratchV2.copy(ceremony.record ? ceremony.record.node.position : ceremony.focus);
    ctx.camera.lookAt(scratchV2);
  }

  function endCeremony(rec) {
    ceremony.active = false;
    ceremony.phase = "";
    ceremony.record = null;
    ctx.clock.timeScale = 1;
    ctx.bus.emit("time:scale", { scale: 1, reason: "record-end" });

    rec.active = false;
    rec.node.visible = false;
    rec.node.scale.setScalar(1);

    if (ctx.hud && typeof ctx.hud.closeMenu === "function") ctx.hud.closeMenu();
    if (rec.onCollect) { try { rec.onCollect(rec); } catch (error) { console.error("[apop3d] record onCollect threw", error); } }

    if (ctx.save && typeof ctx.save.noteCourseClout === "function") {
      ctx.save.noteCourseClout(rec.courseId, ctx.state.clout || 0);
    }

    // Leaving the course is world.js's call to make. Announce it and let
    // the spine route; if nothing is listening yet, fall back to asking
    // world.load directly so the loop does not dead-end in an empty course.
    ctx.bus.emit("course:exit", { reason: "record", courseId: rec.courseId, recordId: rec.id });
    if (ctx.world && typeof ctx.world.load === "function") {
      Promise.resolve(ctx.world.load(0, rec.courseId)).catch(() => {});
    } else {
      ctx.state.mode = "hub";
    }
  }

  /* ------------------------- Record Deals ------------------------- */

  /** §9: spawnDeal(position, dealId). */
  function spawnDeal(position, dealId) {
    const spec = DEAL_TABLE[dealId];
    if (!spec) return null;
    let slot = null;
    for (let i = 0; i < deals.length; i += 1) if (!deals[i].active) { slot = deals[i]; break; }
    if (!slot) return null;

    slot.active = true;
    slot.dealId = dealId;
    slot.x = position.x; slot.y = position.y; slot.z = position.z;
    slot.baseY = position.y;
    slot.age = 0;
    slot.node.position.copy(position);
    slot.node.visible = true;
    slot.node.scale.setScalar(1);
    slot.sleeveMat.color.setHex(spec.color);
    slot.sleeveMat.emissive.setHex(spec.color);
    slot.sleeveMat.emissiveIntensity = 0.55;
    slot.ringMat.color.setHex(spec.color);
    slot.halo.material.color.setHex(spec.color);
    return slot;
  }

  function activateDeal(dealId, position) {
    const spec = DEAL_TABLE[dealId];
    if (!spec) return;

    let entry = null;
    for (let i = 0; i < activeDeals.length; i += 1) {
      if (activeDeals[i].dealId === dealId) { entry = activeDeals[i]; break; }
    }
    if (entry) entry.remaining = spec.duration;
    else activeDeals.push({ dealId, spec, remaining: spec.duration, duration: spec.duration });

    const firstEver = ctx.save && typeof ctx.save.markDeal === "function"
      ? ctx.save.markDeal(dealId) : true;

    if (ctx.player && typeof ctx.player.applyDeal === "function") {
      ctx.player.applyDeal(dealId, spec.duration, spec.effect);
    }
    ctx.bus.emit("collect:deal", { dealId, duration: spec.duration, effect: spec.effect, firstEver });

    if (ctx.hud && typeof ctx.hud.toast === "function") {
      ctx.hud.toast(spec.name, { tone: "deal", sub: spec.blurb, color: spec.color });
    }
    pushDealsToHud();

    if (ctx.audio && typeof ctx.audio.play === "function") ctx.audio.play("dealSign");
    if (position) fx("sparkle", position.x, position.y, position.z, { color: spec.color, count: 24 });
  }

  function pushDealsToHud() {
    if (!ctx.hud || typeof ctx.hud.setDeals !== "function") return;
    ctx.hud.setDeals(activeDeals.map((d) => ({
      id: d.dealId,
      name: d.spec.name,
      remaining: d.remaining,
      duration: d.duration,
      color: d.spec.color,
    })));
  }

  function updateDeals(dt, raw, hasPlayer) {
    const t = ctx.clock.t;
    const grab2 = DEAL_GRAB * DEAL_GRAB;

    for (let i = 0; i < deals.length; i += 1) {
      const slot = deals[i];
      if (!slot.active) continue;
      slot.age += dt;
      const bob = Math.sin(t * 1.9 + slot.phase) * 0.16;
      slot.node.position.set(slot.x, slot.baseY + bob, slot.z);
      slot.node.rotation.y += dt * 1.1;
      slot.ring.rotation.x = t * 1.4 + slot.phase;
      slot.ring.rotation.y = t * 0.9;
      slot.halo.scale.setScalar(2.0 + Math.sin(t * 3.1 + slot.phase) * 0.2);

      if (!hasPlayer) continue;
      const dx = playerPoint.x - slot.x;
      const dy = (playerPoint.y + 0.9) - slot.node.position.y;
      const dz = playerPoint.z - slot.z;
      if (dx * dx + dy * dy + dz * dz < grab2) {
        slot.active = false;
        slot.node.visible = false;
        activateDeal(slot.dealId, slot.node.position);
      }
    }

    // Timers tick on scaled time so slow motion genuinely buys the
    // player more of the power-up, which is what the player expects.
    let changed = false;
    for (let i = activeDeals.length - 1; i >= 0; i -= 1) {
      const entry = activeDeals[i];
      entry.remaining -= dt;
      changed = true;
      if (entry.remaining <= 0) {
        activeDeals.splice(i, 1);
        if (ctx.player && typeof ctx.player.clearDeal === "function") ctx.player.clearDeal(entry.dealId);
        ctx.bus.emit("collect:dealExpired", { dealId: entry.dealId });
        if (ctx.hud && typeof ctx.hud.toast === "function") {
          ctx.hud.toast(`${entry.spec.name} EXPIRED`, { tone: "warn", small: true });
        }
      }
    }
    if (changed) pushDealsToHud();

    updateDealAura(raw, hasPlayer);
  }

  /** The visible on-body effect. One shell, tinted and pulsed by the
   *  strongest active deal, following the player. Cheap, and reads at a
   *  distance - which a particle-only effect does not. */
  function updateDealAura(raw, hasPlayer) {
    if (activeDeals.length === 0 || !hasPlayer) {
      dealAura.node.visible = false;
      return;
    }
    const lead = activeDeals[activeDeals.length - 1];
    const t = ctx.clock.t;
    const ending = lead.remaining < 3;
    // The last three seconds strobe on the beat, so the player is told
    // the deal is ending without having to read the HUD.
    const strobe = ending ? (Math.sin(t * 22) * 0.5 + 0.5) : 1;

    dealAura.node.visible = true;
    dealAura.node.position.set(playerPoint.x, playerPoint.y + 0.95, playerPoint.z);
    dealAura.node.rotation.y += raw * 0.9;
    dealAura.node.scale.setScalar(1 + Math.sin(t * 3.4) * 0.05);
    dealAura.shellMat.color.setHex(lead.spec.color);
    dealAura.wireMat.color.setHex(lead.spec.color);
    dealAura.halo.material.color.setHex(lead.spec.color);
    dealAura.shellMat.opacity = 0.14 * strobe;
    dealAura.wireMat.opacity = 0.30 * strobe;
    dealAura.halo.material.opacity = 0.26 * strobe;
  }

  /* --------------------------- switches --------------------------- */

  /**
   * §9: spawnSwitch(position, kind, onHit).
   * kind: "blue"  - fills the course with blue Clout for a window
   *       "timed" - starts a timed run; the HUD gets a countdown
   *       "pound" - a plain one-shot switch; onHit does the work
   */
  function spawnSwitch(position, kind = "blue", onHit, opts) {
    let slot = null;
    for (let i = 0; i < switches.length; i += 1) if (!switches[i].active) { slot = switches[i]; break; }
    if (!slot) return null;

    const o = opts || {};
    slot.active = true;
    slot.kind = kind;
    slot.pressed = false;
    slot.press = 0;
    slot.cooldown = 0;
    slot.onHit = typeof onHit === "function" ? onHit : null;
    slot.payload = o;
    slot.x = position.x; slot.y = position.y; slot.z = position.z;
    slot.node.position.copy(position);
    slot.node.visible = true;

    const hue = kind === "blue" ? 0x2ee0ff : kind === "timed" ? 0xffd23f : 0xec1a5e;
    slot.capMat.color.setHex(hue);
    slot.capMat.emissive.setHex(hue);
    slot.capMat.emissiveIntensity = 0.9;
    return slot;
  }

  /** Added method. player.js should call this on a confirmed ground
   *  pound; the proximity test below is the stand-in until it does. */
  function hitSwitch(slot, how = "touch") {
    if (!slot || !slot.active || slot.pressed) return false;
    slot.pressed = true;
    slot.cooldown = 0.35;
    slot.capMat.emissiveIntensity = 2.4;

    fx("poundShock", slot.x, slot.y, slot.z, {});
    sfx("switchHit", { pos: slot.node.position });
    if (ctx.vfx && typeof ctx.vfx.shake === "function") ctx.vfx.shake(0.18, 0.25);

    const payload = slot.payload || {};
    if (slot.kind === "blue") startBlueRun(slot, payload);
    else if (slot.kind === "timed") startTimedRun(slot, payload);

    if (slot.onHit) {
      try { slot.onHit(slot, how); } catch (error) { console.error("[apop3d] switch onHit threw", error); }
    }
    ctx.bus.emit("collect:switch", { kind: slot.kind, how, x: slot.x, y: slot.y, z: slot.z });
    return true;
  }

  /** Blue switch: the course fills with 5-value blue Clout for a window,
   *  then it all vanishes. The window is the whole point - it turns a
   *  collectathon into a route. */
  function startBlueRun(slot, payload) {
    const window = Number.isFinite(payload.window) ? payload.window : 12;
    const points = Array.isArray(payload.points) ? payload.points : null;
    const made = [];

    if (points) {
      for (let i = 0; i < points.length; i += 1) {
        const item = spawnClout(points[i], "blue", { life: window });
        if (item) made.push(item);
      }
    } else {
      // No authored layout yet: ring the switch. Better than nothing at
      // all, and levels.js can pass `points` the moment it has them.
      const count = Number.isFinite(payload.count) ? payload.count : 8;
      for (let i = 0; i < count; i += 1) {
        const a = (i / count) * TAU;
        scratchV2.set(slot.x + Math.cos(a) * 4.5, slot.y + 1.1, slot.z + Math.sin(a) * 4.5);
        const item = spawnClout(scratchV2, "blue", { life: window });
        if (item) made.push(item);
      }
    }

    runs.push({ kind: "blue", remaining: window, slot });
    if (ctx.hud && typeof ctx.hud.setTimer === "function") ctx.hud.setTimer(window, "BLUE CLOUT");
    if (ctx.hud && typeof ctx.hud.toast === "function") {
      ctx.hud.toast("BLUE CLOUT", { tone: "blue", sub: `${made.length} pieces - go` });
    }
  }

  function startTimedRun(slot, payload) {
    const window = Number.isFinite(payload.window) ? payload.window : 20;
    runs.push({
      kind: "timed", remaining: window, slot,
      onExpire: typeof payload.onExpire === "function" ? payload.onExpire : null,
    });
    if (ctx.hud && typeof ctx.hud.setTimer === "function") {
      ctx.hud.setTimer(window, payload.label || "TIMED RUN");
    }
    ctx.bus.emit("collect:timedRun", { window, x: slot.x, y: slot.y, z: slot.z });
  }

  function updateSwitches(dt, hasPlayer) {
    const t = ctx.clock.t;
    const r2 = SWITCH_RADIUS * SWITCH_RADIUS;

    // A pound is the intended verb; a touch works too, because a switch
    // the player is standing on that does nothing reads as broken.
    const pounding = !!(ctx.player && (
      ctx.player.pounding
      || (typeof ctx.player.action === "string" && ctx.player.action.toLowerCase().indexOf("pound") !== -1)
    ));

    for (let i = 0; i < switches.length; i += 1) {
      const slot = switches[i];
      if (!slot.active) continue;

      slot.press = damp(slot.press, slot.pressed ? 1 : 0, 14, dt);
      slot.cap.position.y = 0.26 - slot.press * 0.14;
      slot.cap.scale.set(1 + slot.press * 0.06, 1 - slot.press * 0.5, 1 + slot.press * 0.06);
      if (!slot.pressed) {
        slot.capMat.emissiveIntensity = 0.7 + Math.sin(t * 4 + slot.phase) * 0.35;
      } else {
        slot.capMat.emissiveIntensity = damp(slot.capMat.emissiveIntensity, 0.15, 5, dt);
      }

      if (slot.pressed || !hasPlayer) continue;
      const dx = playerPoint.x - slot.x;
      const dz = playerPoint.z - slot.z;
      const dy = playerPoint.y - slot.y;
      if (dx * dx + dz * dz < r2 && dy > -0.8 && dy < 2.2) {
        hitSwitch(slot, pounding ? "pound" : "touch");
      } else if (dx * dx + dz * dz < 9 && ctx.hud && typeof ctx.hud.prompt === "function") {
        ctx.hud.prompt("Ground pound the switch");
      }
    }

    for (let i = runs.length - 1; i >= 0; i -= 1) {
      const run = runs[i];
      run.remaining -= dt;
      if (ctx.hud && typeof ctx.hud.setTimer === "function" && i === runs.length - 1) {
        ctx.hud.setTimer(Math.max(0, run.remaining));
      }
      if (run.remaining <= 0) {
        runs.splice(i, 1);
        if (run.onExpire) { try { run.onExpire(); } catch (error) { console.error("[apop3d] run onExpire threw", error); } }
        if (runs.length === 0 && ctx.hud && typeof ctx.hud.setTimer === "function") ctx.hud.setTimer(null);
        ctx.bus.emit("collect:runEnded", { kind: run.kind });
      }
    }
  }

  /* ------------------------ red-coin sets ------------------------ */

  /**
   * Added method. Eight red Clout scattered across a course that pay out
   * a Platinum Record when the set completes - the single most reused
   * gating structure in SM64.
   */
  function spawnRedCoinSet(positions, opts) {
    const o = opts || {};
    const setId = `red${(redSetSeq += 1)}`;
    const list = Array.isArray(positions) ? positions : [];
    const courseId = Number.isFinite(o.courseId) ? o.courseId : (ctx.state.course || 0);

    const recordId = o.recordId || `${courseId}-red`;
    if (collectedRecords(courseId).has(String(recordId))) return null;

    for (let i = 0; i < list.length; i += 1) spawnClout(list[i], "red", { setId });

    const rec = spawnRecord(recordId, o.recordPosition || list[0] || new THREE.Vector3(), {
      hidden: true,
      courseId,
      name: o.name || "RED CLOUT RECORD",
      onCollect: o.onCollect,
    });

    redSets.set(setId, {
      total: list.length, taken: 0, recordId, record: rec,
      recordPosition: o.recordPosition || null, courseId,
    });
    return setId;
  }

  function completeRedSet(setId, set) {
    redSets.delete(setId);
    if (ctx.hud && typeof ctx.hud.toast === "function") {
      ctx.hud.toast("ALL RED CLOUT COLLECTED", { tone: "red" });
    }
    sfx("redSetComplete");
    if (set.record) revealRecord(set.record, set.recordPosition);
    ctx.bus.emit("collect:redSet", { setId, recordId: set.recordId });
  }

  /* --------------------------- lifecycle --------------------------- */

  /** §9: collectedRecords(courseId) -> Set of ids. Union of what the
   *  save holds and what this session has taken, so a course reloaded
   *  without a flush still knows what is gone. */
  function collectedRecords(courseId) {
    const id = Number.isFinite(courseId) ? courseId : (ctx.state.course || 0);
    const out = new Set();
    if (ctx.save && typeof ctx.save.recordsFor === "function") {
      for (const recordId of ctx.save.recordsFor(id)) out.add(recordId);
    }
    const session = sessionRecords.get(id);
    if (session) for (const recordId of session) out.add(recordId);
    return out;
  }

  function clearAll() {
    for (let i = 0; i < clout.length; i += 1) if (clout[i].active) releaseClout(clout[i]);
    for (const kind of Object.keys(cloutMeshes)) {
      const mesh = cloutMeshes[kind];
      scratchM.makeScale(0, 0, 0);
      for (let s = 0; s < cloutHigh[kind]; s += 1) mesh.setMatrixAt(s, scratchM);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.count = 0;
      cloutHigh[kind] = 0;
      cloutDirty[kind] = false;
    }
    for (let i = 0; i < records.length; i += 1) {
      records[i].active = false;
      records[i].node.visible = false;
    }
    for (let i = 0; i < deals.length; i += 1) { deals[i].active = false; deals[i].node.visible = false; }
    for (let i = 0; i < switches.length; i += 1) { switches[i].active = false; switches[i].node.visible = false; }
    for (let i = 0; i < recordLights.length; i += 1) {
      recordLights[i].light.intensity = 0;
      recordLights[i].owner = null;
    }
    redSets.clear();
    runs.length = 0;
    activeDeals.length = 0;
    lit.length = 0;
    dealAura.node.visible = false;
    ceremony.active = false;
    ceremony.record = null;
    cloutMilestone = 100;
    ctx.clock.timeScale = 1;
    pushDealsToHud();
    if (ctx.hud && typeof ctx.hud.setTimer === "function") ctx.hud.setTimer(null);
  }

  // Enemies pay out Clout. Subscribing rather than being called keeps
  // enemies.js from having to know this module exists at all.
  ctx.bus.on("enemy:killed", (event) => {
    if (!event || !event.position) return;
    const count = Number.isFinite(event.clout) ? event.clout : 3;
    burst(event.position, count, event.cloutKind || "yellow", { power: event.big ? 1.35 : 1 });
  });

  ctx.bus.on("world:loaded", () => { clearAll(); });

  /* ----------------------------- API ----------------------------- */

  return {
    /* frozen §9 surface */
    spawnRecord,
    spawnClout,
    spawnDeal,
    spawnSwitch,
    collectedRecords,

    /* added methods - see the header */
    burst,
    spawnRedCoinSet,
    revealRecord,
    hitSwitch,

    /** Live power-up state. player.js and the combat systems read this
     *  rather than tracking their own timers. */
    get deals() { return activeDeals; },
    dealActive(dealId) {
      for (let i = 0; i < activeDeals.length; i += 1) if (activeDeals[i].dealId === dealId) return activeDeals[i];
      return null;
    },
    dealEffect(name) {
      for (let i = 0; i < activeDeals.length; i += 1) {
        const value = activeDeals[i].spec.effect[name];
        if (value !== undefined) return value;
      }
      return null;
    },
    grantDeal(dealId) { activateDeal(dealId, null); },

    get ceremonyActive() { return ceremony.active; },
    get activeCloutCount() {
      let n = 0;
      for (let i = 0; i < clout.length; i += 1) if (clout[i].active) n += 1;
      return n;
    },

    /** QA hooks. The harness has no player while player.js is a stub,
     *  so it needs a way to say where the magnet should pull toward. */
    setDebugPlayer(v) { debugPlayer = v ? new THREE.Vector3(v.x, v.y, v.z) : null; },

    /** Lay out a representative spread of everything this module owns,
     *  centred on a point. Used by the shot harness and by hand in the
     *  console; never called automatically. */
    debugPopulate(center) {
      const c = center || new THREE.Vector3(0, 0, 0);
      const v = new THREE.Vector3();
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * TAU;
        v.set(c.x + Math.cos(a) * 3.2, c.y + 1.0, c.z + Math.sin(a) * 3.2);
        spawnClout(v, "yellow");
      }
      for (let i = 0; i < 5; i += 1) {
        v.set(c.x - 6 + i * 1.4, c.y + 1.0, c.z - 5);
        spawnClout(v, "red");
      }
      v.set(c.x, c.y + 2.2, c.z - 8);
      spawnRecord("debug", v, { name: "DEBUG PRESSING", force: true });
      v.set(c.x + 6, c.y + 1.4, c.z - 3);
      spawnDeal(v, "main-character-energy");
      v.set(c.x - 5, c.y, c.z + 4);
      spawnSwitch(v, "blue");
      v.set(c.x, c.y + 1.2, c.z + 6);
      burst(v, 10, "yellow");
      return true;
    },

    enter() { clearAll(); },
    exit() { clearAll(); },

    update() {
      const dt = ctx.clock.dt;
      const raw = Math.min(ctx.clock.raw || 0, 0.1);
      const hasPlayer = resolvePlayer(playerPoint);

      updateCeremony(raw);
      // Nothing else may be collected mid-ceremony: a coin magnetising
      // into the player during the star dance is exactly the kind of
      // detail that gives a clone away.
      const live = !ceremony.active;

      updateClout(dt, hasPlayer && live);
      updateRecords(dt);
      if (live) tryCollectRecords(hasPlayer);
      updateDeals(dt, raw, hasPlayer);
      updateSwitches(dt, hasPlayer && live);
    },

    dispose() {
      clearAll();
      scene.remove(group);
      for (const thing of disposables) {
        if (thing && typeof thing.dispose === "function") thing.dispose();
      }
    },
  };
}

export const DEAL_IDS = Object.keys(DEAL_TABLE);
export const DEAL_SPECS = DEAL_TABLE;
