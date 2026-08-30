#!/usr/bin/env node
/* ============================================================
   BLACKSAND - contact darkening profile, ours vs Battlefield 2

   Six rounds of blind art direction have led with one complaint:
   "nothing touches the ground". `blacksand-grounding-probe.mjs` already
   disproved the mechanism the reviewer named - the SSAO pass is live
   and moves 21.5% of the median frame - so the useful question is not
   "is there occlusion" but "WHERE does the occlusion land relative to
   the silhouette", and that has to be measured the way the reviewer
   sees it: in the image, in the last few centimetres before an object
   meets the sand.

   ---- the measurement ----

   Given a contact line (where an object's silhouette meets the ground)
   and the outward direction across the ground, sample luma at a ladder
   of offsets from that line and normalise by the open ground at the far
   end. A seated object shows a deep, SHORT ramp: dark at the seam,
   recovered within 20-30cm. A floating one shows a flat line.

   The identical routine runs on both sides:

     ours - the contact line comes from the prop's collider projected to
            screen, so it is exact, and centimetres come from the
            camera's own projection at the contact's depth.

     BF2  - the contact line is hand-picked off the screenshot (the
            coordinates and how each scale was derived are in REF
            below). Centimetres come from a known real dimension of the
            object in the frame, measured fronto-parallel.

   ---- the two distance axes are not identical, and it does not matter ----

   Ours is placed at a TRUE ground distance; the geometry is available,
   so there is no reason to approximate. The reference has no camera
   data, so its axis is the object's own fronto-parallel scale, which on
   a grazing view of a ground plane UNDERSTATES the true distance by
   roughly 1/sin(view elevation). The reference profile is therefore at
   least as wide as the table shows and possibly two or three times
   wider.

   That asymmetry flatters the reference on REACH and leaves the two
   headline numbers untouched, because both are ratios at the seam:
   how dark the ground goes where the object meets it, and whether the
   curve starts dark and recovers or is simply flat. Do not quote the
   reference's reach as an absolute distance.

   ---- READ THIS BEFORE QUOTING A NUMBER FROM THIS SCRIPT ----

   The first version of this probe reported that BF2 darkens a seam 20x
   harder than we do. That number was wrong, and it was wrong in the most
   embarrassing way available: the probe was measuring itself.

   Its target set was picked by collider size alone, so it filled up with
   signposts (collider a metre wide, mesh a 12cm pole - the seam ring lay
   on open sand), with barrels sunk to their waists in rippled dune sand
   (no visible silhouette meets the ground plane the rings are laid on),
   and it excluded every wall and plinth in the game by capping the half
   extent at 1.1m - two of the reference's own three seams are a wall base
   and a plinth base. A seam metric averaged over objects that have no
   seam is pinned near 1.0 and cannot move however good the renderer gets.

   With the target set repaired - footprint verified flat to 6cm, base
   verified seated to 8cm, walls included and framed at their base - the
   same measurement on the same build reads:

     BATTLEFIELD 2    seam 0.48   ~6cm 0.50   ~20cm 0.67
     OURS             seam 0.55   ~6cm 0.57   ~20cm 0.70

   1.1x at the seam and 1.1x at 20cm, not 20x. Our reach is shorter (back
   to open ground by 45cm against the reference's 80cm, and see the axis
   caveat above before making anything of that).

   ---- and the reference cannot be chased with SSAO anyway ----

   Battlefield 2 is a 2005 title. It has no SSAO and could not have had
   one. Every bit of the darkening in the reference column is baked into
   a diffuse texture or a lightmap, is a genuine cast shadow (the 0.13
   under the Bradley is its own hull shadowing its track), or is a
   contact decal under the object. So a screen-space ambient term is not
   the tool that produced those numbers and is not the tool that will
   close the remaining 1.1x. Baked vertex darkening on the bottom 30-60cm
   of static geometry, or a decal under seated props, is.

   Measured negative result, stated as one: the near-field AO channel and
   screen-space contact ray added in the same session move this metric by
   0-1% on both the broken and the repaired target set (--ab captures
   both states from one camera on one frame). They do real work at the
   frame level - on the checkpoint pose the near channel alone moves
   59.6% of pixels at mean 5.41/255, against the broad term's 44.6% at
   2.38 - but they do not move the seam. The reason is structural and is
   documented at the near gather in render.js: the only surface a depth
   buffer can see near a contact is the object's own silhouette, which
   sits at nearly the same height as the ground it meets, so tangent-plane
   elevation is smallest exactly where true occlusion is largest.

   Usage:
     node scripts/blacksand-contact-profile.mjs                # both
     node scripts/blacksand-contact-profile.mjs --ref          # BF2 only
     node scripts/blacksand-contact-profile.mjs --ours --out D
     node scripts/blacksand-contact-profile.mjs --ab           # paired A/B
   ============================================================ */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const k = t.slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith("--")) args[k] = true;
      else { args[k] = n; i += 1; }
    } else args._.push(t);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const DO_REF = Boolean(args.ref) || !args.ours;
const DO_OURS = Boolean(args.ours) || !args.ref;
const QUALITY = String(args.quality || "ultra");
const OUT = path.resolve(root, String(args.out || "output/blacksand-contact/profile"));
const PORT = Number(args.port || 48500 + (process.pid % 900));
const AB = Boolean(args.ab);
const BASE = `http://127.0.0.1:${PORT}`;

/* Centimetres out from the seam. Dense where the eye reads contact and
   sparse past it: everything that distinguishes a seated object from a
   decal happens inside 30cm, and 120cm is the "unoccluded surface" the
   whole curve is normalised against.

   The ladder starts at 3cm, not 0. On the reference side 3cm is only
   1-2 pixels, so a bin any tighter than that would be reading the
   object's own silhouette through the bilinear filter and reporting it
   as ground. Treat the 3cm column as "at the seam". */
const OFFSETS_CM = [3, 5, 8, 12, 17, 24, 33, 45, 60, 80];

/* Where "unoccluded surface" is read, on BOTH sides. 80cm rather than a
   metre because that is as much clean ground as the tightest reference
   seam has below it before the viewmodel starts, and normalising the two
   sides at different distances would compare two different questions. */
const REF_CM = 80;

const toLinear = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function median(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Bilinear luma in LINEAR light. Linear, because the whole question is
 *  a ratio of radiances and sRGB would compress the dark end of exactly
 *  the range under test. */
function makeSampler(data, width, height) {
  return (x, y) => {
    if (x < 0 || y < 0 || x > width - 2 || y > height - 2) return null;
    const x0 = Math.floor(x); const y0 = Math.floor(y);
    const fx = x - x0; const fy = y - y0;
    let acc = 0;
    for (let j = 0; j < 2; j += 1) {
      for (let i = 0; i < 2; i += 1) {
        const w = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
        const k = ((y0 + j) * width + (x0 + i)) * 3;
        acc += w * (0.2126 * toLinear(data[k]) + 0.7152 * toLinear(data[k + 1])
          + 0.0722 * toLinear(data[k + 2]));
      }
    }
    return acc;
  };
}

/**
 * The one routine both sides go through.
 *
 * `rings` is one entry per rung of the ladder: a distance in
 * centimetres and the image points on the ground at that distance from
 * the seam. Whoever built the rings decides what counts as ground - the
 * reference side walks a hand-picked seam outward, our side projects the
 * prop's collider and throws away anything hidden or in cast shadow -
 * but from here on both are treated identically.
 *
 * The median across ring members, not the mean: a seam thirty samples
 * long will cross a texture blotch or a tuft of grass somewhere, and one
 * outlier moves a mean by more than the whole effect being measured.
 */
function profileFromRings(sample, rings) {
  const curve = rings.map((r) => {
    const values = [];
    for (const [x, y] of r.pts) {
      const v = sample(x, y);
      if (v !== null && v > 1e-5) values.push(v);
    }
    return { cm: r.cm, luma: median(values), n: values.length };
  });
  const far = curve[curve.length - 1].luma;
  if (!far || curve[curve.length - 1].n < 4) return null;
  for (const p of curve) p.ratio = p.luma === null ? null : p.luma / far;

  const at = (cm) => {
    const p = curve.find((q) => q.cm === cm);
    return p && p.ratio !== null ? p.ratio : null;
  };
  // Where the curve has climbed back to within a tenth of open ground.
  let reach = null;
  for (const p of curve) {
    if (p.ratio !== null && p.ratio >= 0.9) { reach = p.cm; break; }
  }
  return {
    curve,
    contact: at(3),
    at8: median([at(5), at(8)].filter((v) => v !== null)),
    at20: median([at(17), at(24)].filter((v) => v !== null)),
    reachCm: reach,
  };
}

/** Rings from a straight seam and one outward image direction - the
 *  only thing a screenshot with no camera data supports. */
function ringsFromSeam(seam, out, cmPerPx, offsetsCm) {
  return offsetsCm.map((cm) => ({
    cm,
    pts: seam.map(([sx, sy]) => [sx + out[0] * (cm / cmPerPx), sy + out[1] * (cm / cmPerPx)]),
  }));
}

function printProfile(label, p) {
  if (!p) { console.log(`  ${label.padEnd(22)} n/a`); return; }
  const byCm = new Map(p.curve.map((q) => [q.cm, q.ratio]));
  const cells = OFFSETS_CM.map((cm) => {
    const r = byCm.get(cm);
    return r === undefined || r === null ? "     ." : r.toFixed(2).padStart(6);
  });
  console.log(`  ${label.padEnd(22)} ${cells.join("")}`);
}

function printHeader() {
  console.log(`  ${"".padEnd(22)} ${OFFSETS_CM.map((c) => `${c}cm`.padStart(6)).join("")}`);
}

/* ================= the Battlefield 2 side ================= */

/* Hand-picked seams. Each was read off the screenshot at 3-5x zoom; the
   scale is derived from one real dimension of the object measured in a
   fronto-parallel direction, which is the least foreshortened quantity
   available in a screenshot with no camera data.
   Scales are good to maybe +-20%; every conclusion below survives that. */
const REF = [
  {
    img: "bf2-14.jpg",
    name: "bradley-track",
    // The IFV's track/road seam, straight down into clean tarmac. The
    // vehicle's own cast shadow runs off to the RIGHT, so a downward
    // ladder from this span stays on lit road.
    a: [368, 459], b: [520, 466], out: [0, 1],
    // Six road wheels, first to last centre, span 178px. A Bradley's
    // road-wheel base is about 3.1m.
    cmPerPx: 310 / 178, refCm: REF_CM,
  },
  {
    img: "bf2-03.jpg",
    name: "plinth-base",
    // The far building's concrete plinth meeting the courtyard, in the
    // ambient half of the frame. Only 80cm of clean ground below it
    // before the viewmodel, hence refCm.
    a: [800, 487], b: [1018, 474], out: [0.062, 0.998],
    // Plinth course 42px for roughly 0.75m.
    cmPerPx: 75 / 42, refCm: REF_CM,
  },
  {
    img: "bf2-03.jpg",
    name: "alley-wall",
    // Compound wall meeting dirt in full shade - no sun anywhere in
    // this seam, so whatever darkens it is ambient occlusion alone.
    a: [30, 556], b: [370, 518], out: [0.112, 0.9937],
    // Wall height 323px for about 2.9m.
    cmPerPx: 290 / 323, refCm: REF_CM,
  },
];

async function runRef() {
  console.log("=== BATTLEFIELD 2 reference ===");
  printHeader();
  const out = [];
  for (const seg of REF) {
    const file = path.join(root, "output/reference/bf2", seg.img);
    let raw;
    try {
      raw = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    } catch (_) { console.log(`  ${seg.name}: ${seg.img} missing`); continue; }
    const sample = makeSampler(raw.data, raw.info.width, raw.info.height);
    const seam = [];
    const STEPS = 33;
    for (let i = 0; i < STEPS; i += 1) {
      const t = (i + 0.5) / STEPS;
      seam.push([seg.a[0] + (seg.b[0] - seg.a[0]) * t, seg.a[1] + (seg.b[1] - seg.a[1]) * t]);
    }
    const p = profileFromRings(sample,
      ringsFromSeam(seam, seg.out, seg.cmPerPx, OFFSETS_CM));
    printProfile(`${seg.name}`, p);
    if (p) out.push({ ...seg, profile: p });
  }
  return out;
}

/* ===================== our side ===================== */

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const r = await fetch(`${BASE}/games/blacksand.html`, { cache: "no-store" });
      if (r.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

/** Small static props standing on open, near-flat sand - the barrel and
 *  crate class the reviewer keeps pointing at. Runs in the page. */
function pickPropsLow(limit) {
  const T = window.__BS;
  const THREE = T.THREE;
  const physics = T.ctx.physics;
  const terrain = T.ctx.terrain;
  const found = [];
  const reject = { size: 0, seat: 0, slope: 0, crowd: 0 };
  for (const c of physics.colliders) {
    if (!c.active) continue;
    if (!(c.layer & physics.LAYER.STATIC)) continue;
    const h = c.halfExtents;
    /* ---- two target classes, and why the first version had neither ----

       PROP is the barrel and crate class. The lower bound on the SHORT
       axis is what keeps signposts, pipes and fence posts out: their
       collider is a box a metre across and their visible mesh is a 12cm
       pole, so the seam ring lands on open sand and the probe faithfully
       reports "no contact darkening" for an object that has no contact.

       WALL is the reference's own case - two of BF2's three hand-picked
       seams are a wall base and a plinth base, and the first version of
       this picker excluded every one of ours by capping the half extent
       at 1.1m. A metric that cannot see the geometry the reference was
       measured on is not comparable to it. */
    const isProp = h.y >= 0.22 && h.y <= 1.3
      && Math.min(h.x, h.z) >= 0.22 && Math.max(h.x, h.z) <= 1.1;
    const isWall = h.y >= 0.9
      && Math.max(h.x, h.z) >= 1.6 && Math.min(h.x, h.z) <= 1.2;
    if (!isProp && !isWall) continue;
    const kind = isWall ? "wall" : "prop";
    reject.size += 1;

    /* ---- the seam has to EXIST before its darkness means anything ----

       This is the fix for the probe measuring itself. Sampling terrain
       height only at the centre let through props sunk to their waists
       in rippled dune sand, where the visible silhouette never meets the
       ground plane the rings are laid on. Those targets cannot respond
       to any renderer change, and averaging them in produced a headline
       that was structurally pinned near 1.0 - the same disease as a
       beauty-shot set with no near-field geometry in it.

       So walk the actual footprint. Every corner and edge midpoint has
       to sit within 6cm of the same height, and the collider's base has
       to sit within 8cm of it. That is the definition of "this object
       has a visible, clean contact line". */
    const base = c.center.y - h.y;
    const ring = [];
    for (let a = 0; a < 8; a += 1) {
      const th = (a / 8) * Math.PI * 2;
      const local = new THREE.Vector3(Math.cos(th) * (h.x + 0.06), 0,
        Math.sin(th) * (h.z + 0.06)).applyQuaternion(c.quaternion);
      ring.push(terrain.heightAt(c.center.x + local.x, c.center.z + local.z));
    }
    const lo = Math.min(...ring); const hi = Math.max(...ring);
    if (hi - lo > 0.06) continue;
    const mean = ring.reduce((s, v) => s + v, 0) / ring.length;
    if (Math.abs(base - mean) > 0.08) continue;
    reject.seat += 1;
    if (terrain.slopeAt(c.center.x, c.center.z) > 0.18) continue;
    reject.slope += 1;

    /* Walls are exempt from the crowding test - they ARE the big
       neighbour, and a wall base with a building behind it is exactly
       the reference's alley-wall case. */
    if (kind === "prop") {
      const near = physics.queryBox(
        new THREE.Vector3(c.center.x - 5, c.center.y - 3, c.center.z - 5),
        new THREE.Vector3(c.center.x + 5, c.center.y + 3, c.center.z + 5),
        physics.LAYER.STATIC
      ) || [];
      if (near.some((n) => n.id !== c.id && (n.halfExtents.x > 1.5
        || n.halfExtents.z > 1.5 || n.halfExtents.y > 2.0))) continue;
    }
    reject.crowd += 1;
    found.push({
      id: c.id, kind, x: c.center.x, y: base, z: c.center.z,
      hx: h.x, hy: h.y, hz: h.z, quat: c.quaternion.toArray(),
    });
  }
  found.sort((a, b) => (a.x * 31 + a.z * 17) - (b.x * 31 + b.z * 17));
  /* Balanced across the two classes rather than strided over the whole
     list. Props outnumber walls heavily, so a plain stride would hand
     back an all-barrel set again and the wall base - the reference's own
     case - would never be measured. */
  const picks = [];
  const byKind = { wall: found.filter((f) => f.kind === "wall"),
    prop: found.filter((f) => f.kind === "prop") };
  const want = { wall: Math.ceil(limit / 2), prop: Math.floor(limit / 2) };
  for (const k of ["wall", "prop"]) {
    const list = byKind[k];
    const n = Math.min(want[k], list.length);
    const step = Math.max(1, Math.floor(list.length / Math.max(n, 1)));
    for (let i = 0; i < list.length && picks.filter((q) => q.kind === k).length < n; i += step) {
      picks.push(list[i]);
    }
  }
  // Backfill from whichever class has spares if one came up short.
  for (const f of found) {
    if (picks.length >= limit) break;
    if (!picks.includes(f)) picks.push(f);
  }
  return { picks: picks.slice(0, limit), total: found.length,
    counts: { wall: byKind.wall.length, prop: byKind.prop.length }, reject };
}

/**
 * Frame one prop from a LOW camera and hand back the ladder of ground
 * rings around its base, already filtered to points the camera can see
 * and the sun can reach.
 *
 * Low on purpose. Every beauty shot in the suite is at eye height
 * looking out, so the 0-2m band this entire complaint lives in had never
 * been rendered once.
 *
 * Camera on the SUN side, so the prop's cast shadow falls away from the
 * lens and every surviving sample is lit. What darkens a lit sample at
 * the seam is ambient occlusion and nothing else, which is the term
 * under test. `side: "anti"` frames the same prop from the other side
 * for the eye; its profile is dominated by the cast shadow and is not
 * reported.
 *
 * Unlike the reference side, these rings are placed at a TRUE ground
 * distance - the geometry is right here, so there is no reason to use
 * the screenshot proxy. See the header note on what that means for
 * comparing the two distance axes.
 */
function framePropLow(prop, side, offsetsCm, width, height) {
  const T = window.__BS;
  const THREE = T.THREE;
  const terrain = T.ctx.terrain;
  const physics = T.ctx.physics;
  const camera = T.ctx.render.camera;
  const sun = T.ctx.sky.sunDirection.clone().normalize();
  const flat = new THREE.Vector3(sun.x, 0, sun.z).normalize();
  if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1);
  if (side === "anti") flat.negate();

  /* A wall is framed off its SHORT axis - stand in front of the long
     face, close, the way a player walking a street sees it. Using the
     long axis would push the camera 20m back for a 9m wall and the seam
     would be four pixels tall. */
  const radius = prop.kind === "wall"
    ? Math.min(prop.hx, prop.hz) : Math.max(prop.hx, prop.hz);
  const dist = radius * 2.2 + 2.6;
  const eye = new THREE.Vector3(prop.x + flat.x * dist, 0, prop.z + flat.z * dist);
  // 0.75m: a crouched soldier's eye. High enough to see the ground in
  // front of the prop, low enough that the seam is not being looked down
  // on, which is the angle that hides a missing contact term.
  /* Height above the PROP's ground, not above the camera's own. On any
     slope the latter walks the eye uphill with the terrain and ends up
     looking DOWN at the seam from three metres up, which is the one
     angle that hides a missing contact term - four of eight picks were
     framed that way and all four measured flat. */
  eye.y = Math.max(prop.y + 0.75, terrain.heightAt(eye.x, eye.z) + 0.35);
  /* Aim just above the SEAM, not at the object's mid-height. On a 2m
     wall the latter pitches the camera up and the ground in front falls
     out of frame entirely - all four wall targets returned n/a that way,
     which is the reference's own case going unmeasured. The seam is the
     subject; point at it. */
  const aimY = prop.y + Math.min(prop.hy, 0.45);
  T.lookAt([eye.x, eye.y, eye.z], [prop.x, aimY, prop.z], 50);
  camera.updateMatrixWorld(true);

  const project = (v) => {
    const s = v.clone().project(camera);
    return [(s.x * 0.5 + 0.5) * width, (1 - (s.y * 0.5 + 0.5)) * height];
  };

  /* Offsets walk outward along the box's own face normal, not along a
     circle from its centre. The circular version reports "no contact
     term" for every elongated prop in the set: a jersey barrier is 2.4m
     by 0.66m, so a ring at centre+1.2m is on the sand at the ends and a
     metre clear of the sides. */
  const quat = new THREE.Quaternion().fromArray(prop.quat);
  const toward = new THREE.Vector3(flat.x, 0, flat.z);
  const faces = [];
  const SEG = 13;
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const face = new THREE.Vector3(nx, 0, nz).applyQuaternion(quat);
    if (face.dot(toward) < 0.3) continue;
    for (let s = 0; s < SEG; s += 1) {
      const t = ((s + 0.5) / SEG) * 2 - 1;
      const local = new THREE.Vector3(
        nx !== 0 ? nx * prop.hx : t * prop.hx, 0,
        nx !== 0 ? t * prop.hz : nz * prop.hz
      ).applyQuaternion(quat);
      faces.push({ x: prop.x + local.x, z: prop.z + local.z, fx: face.x, fz: face.z });
    }
  }
  if (!faces.length) return null;

  const up = new THREE.Vector3(0, 1, 0);
  const rings = offsetsCm.map((cm) => {
    const pts = [];
    for (const f of faces) {
      const d = cm / 100;
      const px = f.x + f.fx * d; const pz = f.z + f.fz * d;
      const point = new THREE.Vector3(px, terrain.heightAt(px, pz), pz);
      const uv = project(point);
      if (uv[0] < 6 || uv[0] > width - 6 || uv[1] < 6 || uv[1] > height - 6) continue;
      // Visible from the eye? A sample hidden behind the prop would
      // contribute the PROP's dark pixels and be read as ground.
      const toPoint = point.clone().sub(camera.position);
      const len = toPoint.length();
      toPoint.divideScalar(len);
      if (physics.raycast(camera.position, toPoint, len - 0.12,
        { layer: physics.LAYER.STATIC }).hit) continue;
      // In the sun's own shadow? Discarding these is what leaves pure
      // ambient occlusion behind.
      const above = point.clone().addScaledVector(up, 0.04);
      if (physics.raycast(above, sun, 120,
        { layer: physics.LAYER.TERRAIN | physics.LAYER.STATIC }).hit) continue;
      pts.push(uv);
    }
    return { cm, pts };
  });

  const mid = new THREE.Vector3(prop.x, prop.y, prop.z);
  const depth = camera.position.distanceTo(mid);
  const fovY = (camera.fov * Math.PI) / 180;
  const cmPerPx = (100 * 2 * depth * Math.tan(fovY / 2)) / height;
  return { rings, cmPerPx, depth, eye: [eye.x, eye.y, eye.z] };
}

async function runOurs() {
  const { chromium } = await import("playwright");
  const server = startServer();
  let browser = null;
  const W = 1600; const H = 900;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({
      viewport: { width: W, height: H }, deviceScaleFactor: 1,
    })).newPage();
    page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));

    await page.goto(`${BASE}/games/blacksand.html?qa=1&quality=${QUALITY}`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__BS && window.__BS.isReady(), null, { timeout: 180000 });
    await page.evaluate(() => {
      window.__BS.maximize();
      window.__BS.hideHud(true);
      window.__BS.hideViewmodel(true);
      const el = document.getElementById("bs-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    // One locked stop for every capture. Auto exposure renormalises the
    // frame and would eat the ratio being measured.
    await page.evaluate(() => {
      const e = window.__BS.grade({}).exposure;
      window.__BS.grade({ autoExposure: false, exposure: e, exposureBias: 1, grain: 0 });
      for (let i = 0; i < 4; i += 1) window.__BS.renderOnce(1 / 60);
    });
    await fs.mkdir(OUT, { recursive: true });

    await page.evaluate(`window.__pickPropsLow = ${pickPropsLow.toString()}`);
    await page.evaluate(`window.__framePropLow = ${framePropLow.toString()}`);
    // The DRAWING BUFFER, not the viewport. captureDataURL reads the
    // WebGL buffer directly, and maximize() plus the tier's render scale
    // mean it is routinely not the CSS size - projecting the seam into
    // the wrong one puts every sample out of bounds and the whole probe
    // silently reports n/a.
    const [CW, CH] = await page.evaluate(() => {
      const c = window.__BS.ctx.render.renderer.domElement;
      return [c.width, c.height];
    });
    console.log(`  drawing buffer ${CW}x${CH}`);
    const { picks, total, reject, counts } = await page.evaluate((n) => window.__pickPropsLow(n),
      Number(args.props || 5));
    console.log(`  filter funnel ${JSON.stringify(reject)}  classes ${JSON.stringify(counts)}`);
    console.log(`\n=== OURS (${QUALITY}) - ${total} props on open sand, sampling ${picks.length} ===`);
    printHeader();

    /* The A/B that matters is a PAIRED one. Re-running the probe before
       and after an edit re-picks props, re-frames them and re-rolls the
       terrain under them, and the spread between props is far larger
       than the effect - the first attempt at this compared two different
       prop sets and read as "no change". uContactFloor 1.0 makes the
       composite's min() a no-op, which is exactly the shipped behaviour
       before the near channel existed, so both states can be captured
       from the same camera on the same frame. */
    const rows = [];
    const states = AB
      ? [["off", { aoContactFloor: 1.0 }], ["on", { aoContactFloor: 0.10 }]]
      : [["on", null]];
    for (const side of ["sun", "anti"]) {
      for (let i = 0; i < picks.length; i += 1) {
        const framed = await page.evaluate(([p, s, o, w, h]) => {
          const r = window.__framePropLow(p, s, o, w, h);
          for (let k = 0; k < 4; k += 1) window.__BS.renderOnce(1 / 60);
          return r;
        }, [picks[i], side, OFFSETS_CM, CW, CH]);
        if (!framed) continue;
        for (const [state, patch] of states) {
          if (patch) {
            await page.evaluate((g) => {
              window.__BS.grade(g);
              for (let k = 0; k < 3; k += 1) window.__BS.renderOnce(1 / 60);
            }, patch);
          }
          const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
          const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
          const name = `${side}-${String(i + 1).padStart(2, "0")}`
            + (AB ? `-${state}` : "");
          await fs.writeFile(path.join(OUT, `${name}.png`), png);
          // The anti-sun frames exist to be looked at. Their profile is
          // the cast shadow, not the term under test.
          if (side !== "sun") continue;
          const raw = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
          const sample = makeSampler(raw.data, raw.info.width, raw.info.height);
          const p = profileFromRings(sample, framed.rings);
          printProfile(`${name} ${picks[i].kind} (${framed.depth.toFixed(1)}m)`, p);
          if (p) rows.push({ name, side, state, kind: picks[i].kind,
            cmPerPx: framed.cmPerPx, profile: p });
        }
      }
    }
    const report = await page.evaluate(() => {
      const r = window.__BS.report();
      return { calls: r.render.calls, triangles: r.render.triangles, grade: r.grade };
    });
    console.log(`\n  draw calls ${report.calls}  triangles ${report.triangles}`);
    console.log(`  ao config ${JSON.stringify(report.grade.ao)}`);
    return { rows, report };
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill();
  }
}

function summarise(label, profiles) {
  const pick = (k) => median(profiles.map((p) => p[k]).filter((v) => v !== null && Number.isFinite(v)));
  const reach = median(profiles.map((p) => p.reachCm).filter((v) => v !== null));
  console.log(`  ${label.padEnd(16)} seam ${(pick("contact") ?? NaN).toFixed(2)}`
    + `   ~6cm ${(pick("at8") ?? NaN).toFixed(2)}`
    + `   ~20cm ${(pick("at20") ?? NaN).toFixed(2)}`
    + `   back to 0.9 at ${reach === null ? "never" : `${reach}cm`}`);
  return { contact: pick("contact"), at8: pick("at8"), at20: pick("at20"), reachCm: reach };
}

async function main() {
  const result = {};
  let refRows = [];
  if (DO_REF) refRows = await runRef();
  let ourRows = [];
  if (DO_OURS) {
    const o = await runOurs();
    ourRows = o.rows;
    result.report = o.report;
  }

  console.log(`\n--- summary (luma as a fraction of open ground ${REF_CM}cm out) ---`);
  if (refRows.length) result.ref = summarise("BATTLEFIELD 2", refRows.map((r) => r.profile));
  if (ourRows.length) {
    if (AB) {
      const off = ourRows.filter((r) => r.state === "off");
      const on = ourRows.filter((r) => r.state === "on");
      result.oursOff = summarise("OURS near OFF", off.map((r) => r.profile));
      result.ours = summarise("OURS near ON", on.map((r) => r.profile));
    } else {
      result.ours = summarise("OURS", ourRows.map((r) => r.profile));
    }
  }
  if (result.ref && result.ours) {
    const gap = (a, b) => ((1 - a) / Math.max(1 - b, 1e-4));
    console.log(`\n  BF2 darkens the seam ${gap(result.ref.contact, result.ours.contact).toFixed(1)}x`
      + ` as much as we do, and ${gap(result.ref.at20, result.ours.at20).toFixed(1)}x at 20cm.`);
  }
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, "profile.json"),
    JSON.stringify({ ref: refRows, ours: ourRows, summary: result }, null, 2));
  console.log(`\n  wrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
