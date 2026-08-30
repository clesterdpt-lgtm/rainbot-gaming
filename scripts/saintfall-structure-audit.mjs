#!/usr/bin/env node
/* ============================================================
   SAINTFALL - structure audit

   Walks every point of interest, photographs it from eight bearings,
   and looks for the defects a beauty shot is worst at finding.

   The premise is that the review poses are COMPOSED - they were
   chosen because they look good, which means they were chosen to
   avoid the angles where something is wrong. An audit has to do the
   opposite and go everywhere on purpose.

   Four checks, each aimed at a defect class that is invisible from
   at least one direction:

   1. INVERTED FACES. Every mesh is re-rendered with a shader that
      paints back faces red. From outside a closed solid you can
      never see a back face, so red means a triangle wound inside
      out, a hole in a shell, or a solid that was never closed.
      Negative scale flips winding, and this project has shipped
      that bug before.

   2. Z-FIGHTING. The camera is moved by one millimetre and the
      frame re-rendered. A well-formed surface barely changes; two
      coplanar surfaces competing for the depth buffer swap over
      completely. Sub-millimetre camera motion is exactly the case a
      static screenshot cannot show.

   3. FLOATING AND BURIED GEOMETRY. The lowest vertex near each POI
      against the terrain height under it.

   4. DEGENERATE GEOMETRY. Zero-area triangles and non-finite
      vertices, counted straight off the buffers.

   Usage:
     node scripts/saintfall-structure-audit.mjs
     node scripts/saintfall-structure-audit.mjs --only cathedral
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true])
);
const OUT = path.resolve(root, args.out || "output/saintfall/audit");
const ONLY = args.only ? String(args.only) : null;
const BEARINGS = Number(args.bearings || 8);
const PORT = 49000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;

/* Framing is MEASURED, never tabulated. An earlier version carried a
   hand-written radius per POI; the ones it was not tuned against put
   the camera inside the structure, which fills the frame with that
   structure's own interior and scores 100% back faces - a reading
   that looks exactly like catastrophic inversion and means nothing. */

const findings = [];
function note(severity, poi, bearing, message, detail) {
  findings.push({ severity, poi, bearing, message, detail });
}

async function redFraction(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  let red = 0;
  for (let i = 0; i < data.length; i += 3) {
    // The debug shader writes pure red and nothing else does.
    if (data[i] > 180 && data[i + 1] < 70 && data[i + 2] < 70) red += 1;
  }
  return (red / (info.width * info.height)) * 100;
}

async function changedFraction(a, b) {
  const ra = await sharp(a).removeAlpha().raw().toBuffer();
  const rb = await sharp(b).removeAlpha().raw().toBuffer();
  let changed = 0;
  for (let i = 0; i < ra.length; i += 3) {
    const d = Math.abs(ra[i] - rb[i]) + Math.abs(ra[i + 1] - rb[i + 1])
      + Math.abs(ra[i + 2] - rb[i + 2]);
    if (d > 40) changed += 1;
  }
  return (changed / (ra.length / 3)) * 100;
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  /* Wiped, not merged. A previous run's images survive under the
     same names whenever the worst bearing moves, and reading a stale
     frame as evidence of the current build is a way to "confirm" a
     defect that was fixed twenty minutes ago - which is exactly what
     happened while auditing the Cathedral roof. */
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    window.__SF.hideHud(true);
    window.__SF.hidePlayer(true);
    const el = document.getElementById("sf-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });

  /* ---------------- buffer-level audit ---------------- */
  console.log("=== GEOMETRY ===");
  const meshes = await page.evaluate(() => window.__SF.auditMeshes());
  let totalTris = 0;
  let totalDegenerate = 0;
  let totalNonFinite = 0;
  for (const m of meshes) {
    totalTris += m.triangles;
    totalDegenerate += m.degenerate;
    totalNonFinite += m.nonFinite;
    if (m.nonFinite > 0) {
      note("ERROR", m.name, null, `${m.nonFinite} non-finite triangles`);
    }
    if (m.badNormals > 0) {
      note("ERROR", m.name, null,
        `${m.badNormals} vertices with a zero-length or NaN normal`);
    }
    if (m.degenerate > m.triangles * 0.02) {
      note("WARN", m.name, null,
        `${m.degenerate} zero-area triangles (${(m.degenerate / m.triangles * 100).toFixed(1)}%)`);
    }
    /* No winding verdict is drawn from signed volume here, and that
       is deliberate. The divergence theorem assumes a single closed
       shell that does not intersect itself; SAINTFALL's whole
       vocabulary is INTERPENETRATING primitives merged per district,
       so the interior faces of every overlap contribute negatively
       and a correctly wound district scores near zero. An earlier
       version of this check flagged twenty-six of thirty-six meshes,
       which is the same as flagging none. The back-face render below
       is the sound test: it asks what the player can actually see. */
  }
  console.log(`  ${meshes.length} meshes · ${totalTris} triangles`);
  const totalBadNormals = meshes.reduce((a, m) => a + (m.badNormals || 0), 0);
  console.log(`  degenerate ${totalDegenerate} · non-finite ${totalNonFinite} `
    + `· bad normals ${totalBadNormals}`);
  const worstDegenerate = meshes.slice()
    .filter((m) => m.triangles > 200)
    .sort((a, b) => (b.degenerate / b.triangles) - (a.degenerate / a.triangles)).slice(0, 5);
  console.log("  highest zero-area triangle share:");
  for (const m of worstDegenerate) {
    console.log(`    ${((m.degenerate / m.triangles) * 100).toFixed(1).padStart(6)}%  `
      + `${m.name} (${m.degenerate}/${m.triangles})`);
  }

  /* ---------------- per-POI multi-angle ---------------- */
  const pois = await page.evaluate(() => window.__SF.world.pois.map(
    (p) => ({ id: p.id, name: p.name, x: p.x, z: p.z })
  ));
  const targets = ONLY ? pois.filter((p) => p.id === ONLY) : pois;
  console.log(`\n=== ${targets.length} STRUCTURES x ${BEARINGS} BEARINGS ===`);

  for (const poi of targets) {
    const ext = await page.evaluate(({ x, z }) => window.__SF.localExtent(x, z, 160),
      { x: poi.x, z: poi.z });
    // Outside the structure's own spread, with headroom, and never
    // closer than something that would clip the near plane.
    const radius = Math.max(28, ext.spreadM * 1.55, ext.heightAboveGround * 1.5);
    const eyeY = ext.groundY + Math.max(6, ext.heightAboveGround * 0.55);
    const frame = { r: radius, pitch: 0.20 };
    const ground = { groundY: eyeY - radius * Math.sin(0.20) };

    let occluded = 0;
    let usedRadius = 0;
    let worstRed = 0;
    let worstRedBearing = 0;
    let worstFlicker = 0;
    let worstFlickerBearing = 0;

    for (let i = 0; i < BEARINGS; i += 1) {
      const bearing = (i / BEARINGS) * Math.PI * 2;
      const placed = await page.evaluate(({ x, z, y, b, r, p }) =>
        window.__SF.safeOrbit(x, z, y, b, r, p),
      { x: poi.x, z: poi.z, y: eyeY, b: bearing, r: frame.r, p: frame.pitch });
      /* No vantage point on this bearing is both outside masonry and
         has line of sight - the Saint's 108m head stands between the
         Pilgrim's Road and the south, for instance. Photographing
         from inside it and calling the result "32% back faces" is the
         audit reporting where it parked, not what it was aimed at. */
      if (!placed.ok) { occluded += 1; continue; }
      usedRadius = placed.radius || frame.r;

      // Normal frame.
      const shot = await page.evaluate(() => {
        for (let k = 0; k < 3; k += 1) window.__SF.renderOnce(1 / 60);
        return window.__SF.captureDataURL();
      });
      const buf = Buffer.from(shot.slice(shot.indexOf(",") + 1), "base64");

      // Nudged a millimetre, to shake out coplanar surfaces.
      const shot2 = await page.evaluate(({ x, z, y, b, r, p }) => {
        window.__SF.safeOrbit(x + 0.001, z + 0.001, y, b, r, p);
        for (let k = 0; k < 3; k += 1) window.__SF.renderOnce(1 / 60);
        return window.__SF.captureDataURL();
      }, { x: poi.x, z: poi.z, y: eyeY, b: bearing, r: frame.r, p: frame.pitch });
      const buf2 = Buffer.from(shot2.slice(shot2.indexOf(",") + 1), "base64");
      const flicker = await changedFraction(buf, buf2);
      if (flicker > worstFlicker) { worstFlicker = flicker; worstFlickerBearing = i; }

      // Back-face pass.
      const facing = await page.evaluate(({ x, z, y, b, r, p }) => {
        window.__SF.setFacingDebug(true);
        window.__SF.safeOrbit(x, z, y, b, r, p);
        for (let k = 0; k < 3; k += 1) window.__SF.renderOnce(1 / 60);
        const url = window.__SF.captureDataURL();
        window.__SF.setFacingDebug(false);
        return url;
      }, { x: poi.x, z: poi.z, y: eyeY, b: bearing, r: frame.r, p: frame.pitch });
      const fbuf = Buffer.from(facing.slice(facing.indexOf(",") + 1), "base64");
      const red = await redFraction(fbuf);
      if (red > worstRed) { worstRed = red; worstRedBearing = i; }

      if (i === 0 || red === worstRed || flicker === worstFlicker) {
        await writeFile(path.join(OUT, `${poi.id}-b${i}.png`), buf);
        if (red > 0.05) await writeFile(path.join(OUT, `${poi.id}-b${i}-facing.png`), fbuf);
      }
    }

    const gap = ext.lowestY === null ? null
      : Number((ext.lowestY - ext.groundY).toFixed(2));
    const flags = [];
    if (worstRed > 0.6) {
      flags.push(`backfaces ${worstRed.toFixed(2)}% @b${worstRedBearing}`);
      note("WARN", poi.id, worstRedBearing,
        `back faces visible from outside (${worstRed.toFixed(2)}% of frame)`);
    }
    if (worstFlicker > 1.5) {
      flags.push(`flicker ${worstFlicker.toFixed(2)}% @b${worstFlickerBearing}`);
      note("WARN", poi.id, worstFlickerBearing,
        `${worstFlicker.toFixed(2)}% of pixels swap on a 1mm camera move (z-fighting)`);
    }
    if (gap !== null && gap > 1.2) {
      flags.push(`floating ${gap}m`);
      note("WARN", poi.id, null, `lowest geometry floats ${gap}m above the ground`);
    }
    console.log(`  ${poi.id.padEnd(18)} h${String(Math.round(ext.heightAboveGround)).padStart(4)}m `
      + `r${String(Math.round(usedRadius || radius)).padStart(4)}m · red ${worstRed.toFixed(2)}% · `
      + `flicker ${worstFlicker.toFixed(2)}%`
      + (occluded ? ` · ${occluded}/${BEARINGS} bearings occluded` : "")
      + (flags.length ? `   <- ${flags.join(", ")}` : ""));
  }

  /* ---------------- report ---------------- */
  console.log("\n=== FINDINGS ===");
  if (!findings.length) console.log("  none");
  for (const f of findings) {
    console.log(`  ${f.severity}  ${f.poi}${f.bearing !== null && f.bearing !== undefined
      ? ` b${f.bearing}` : ""}: ${f.message}`);
  }
  if (pageErrors.length) console.error("\npage errors:", pageErrors.slice(0, 3));

  await writeFile(path.join(OUT, "report.json"),
    JSON.stringify({ meshes, findings, pageErrors }, null, 2));
  console.log(`\nartifacts: ${path.relative(root, OUT)}`);
  if (findings.some((f) => f.severity === "ERROR")) process.exitCode = 1;
  await browser.close();
} finally {
  server.kill("SIGTERM");
}
