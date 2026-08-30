#!/usr/bin/env node
/* ============================================================
   SAINTFALL - The Green Antiphon acceptance gates

   Meridian-IV is a level about WATER, and every way it can fail
   is a number rather than a picture:

     - a pad that is not flat is a fight arena on a hillside;
     - a circuit over grade is a beach you cannot walk along;
     - a station the walk solver cannot reach is content that
       does not exist;
     - a reef crest that is not proud of the flat is a lagoon
       with no lip, so the surf breaks nowhere;
     - and the one neither predecessor could fail: THE BAKED
       SEABED AND THE REAL GROUND CAN DISAGREE. The water shader
       cannot call `heightAt` - it reads a texture - so where the
       bake is wrong the foam line is drawn in the wrong place,
       and a misplaced foam line looks like art rather than like
       a bug.

   Screenshots cannot see any of those. This measures them,
   prints a pass/fail table, and exits non-zero on a failure so
   it can gate.

   Everything here is read through `window.__SF.atoll`, which is
   atoll-qa.js. NOTHING IS RECOMPUTED IN THIS FILE - a harness
   that reimplements the rule it is testing tests itself. Where a
   number comes from the engine, the engine is asked.

   ------------------------------------------------------------
   THE ONE THING THIS AUDIT DOES THAT THE SUMMIT'S DOES NOT:

   IT CAN BE RUN ON AN UNFINISHED LEVEL. Seven modules are being
   built in parallel, and a gate whose subject does not exist yet
   reports SKIP, not FAIL and not - much worse - a silent pass.
   `gate()` returns `{ skip: true, detail }` for that, skips are
   counted separately, and a run with skips prints them in the
   summary so "all gates passed" can never mean "there was
   nothing to measure".

   Two design notes on what is deliberately NOT gated:

     - THERE IS NO FREEBOARD GATE. Four of the nine arenas are
       authored BELOW sea level (the Prow at -0.20, the Nave at
       -0.44, the Bone Reef at -0.24, the Drive Cathedral at
       -0.60) because they are reef flat and mangrove. A gate
       asserting every pad clears the water would fail this level
       by design.
     - THERE IS NO rimProbe. Kenosis needed a rounded-square rim
       because a circular range inside a square map throws away
       the corners; here the corners are open ocean at -40 m and
       throwing them away is the intent. The level is sealed by
       WATER, which `wadeProfile` measures instead.

   Usage:
     node scripts/saintfall-atoll-audit.mjs
     node scripts/saintfall-atoll-audit.mjs --json out.json
     node scripts/saintfall-atoll-audit.mjs --quality ultra --time vespers
   ============================================================ */

import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

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
const PORT = Number(args.port || 46000 + (process.pid % 4000));
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `${BASE}/games/saintfall-green-antiphon.html`;
const URL = `${PAGE}?qa=1&quality=${args.quality || "high"}&time=${args.time || "goldenhour"}`;

/* ------------------------------------------------------------
   THE GATES

   Each threshold is a design decision with a reason, not a
   number picked to make the current build pass. They are listed
   here, once, so raising one is a visible edit rather than a
   quiet drift. Declared ABOVE main() - the summit's file put two
   of its thresholds below the function that reads them and got
   away with it only because the call site is lower still.
   ------------------------------------------------------------ */
const GATES = {
  /* A pad is a fight floor. The layout says +/-0.35 m of
     deviation from the authored `padY`, and p95 rather than max
     so a single sample on the pad's feathered edge does not
     decide it. */
  padP95DevM: 0.35,
  /* An arena may undulate; it may not be steep. 8 % is a
     twentieth of the walk limit and half the circuit's ceiling. */
  padGradePct: 8.0,
  /* The ring circuit is a walking route over beach and reef
     flat. 18 % is the terrain document's ceiling; a beach that
     needs a jetpack is not a beach. Measured on the GROUND. */
  circuitMaxGrade: 0.18,
  /* The Cauldron's helical shelf is the level's signature climb
     and it must be walkable end to end. 0.16 is under the
     circuit's because it is 1130 m of sustained ascent rather
     than a rolling shore. */
  cauldronRoadMaxGrade: 0.16,
  /* The reef crest is what makes the lagoon a lagoon: the ring
     of ground the surf breaks on. Below +0.45 it stops breaking;
     above +0.85 it is a wall you cannot see over from the flat. */
  reefCrestM: [0.45, 0.85],
  /* The reef flat is ankle-to-shin water at mean tide. Shallower
     and it is a beach; deeper and the crust band has nothing to
     sit in. */
  reefFlatM: [-0.70, -0.25],
  /* The lagoon has to be deep enough to be blue and shallow
     enough that the Spine reads as a bridge over it. */
  lagoonDepthM: [7.5, 9.0],
  /* A feature at profile radius rp appears at world radius
     rp + dR. At sum 58 the reef crest surfaced outside the chunk
     grid; 34 is the cap that keeps it on the mesh. */
  ringWarpMaxM: 34,
  /* THE BAKE. 2 m per texel over a 1-in-40 reef flat is 5 cm of
     height error, and what the eye sees is the HORIZONTAL
     position of the foam line, not the height. 1.2 m is under
     the width of the foam band itself, so an error inside it is
     invisible and an error outside it is a foam line drawn on
     dry sand. */
  foamLineErrorM: 1.2,
  /* A floating crate sits in the air at 10 cm. 5 cm is half of
     the smallest gap anyone has ever noticed. */
  waterSurfaceAgreeM: 0.05,
  /* The same clearance saintfall-shots.mjs warns at: the camera
     must not be inside geometry at any authored pose. */
  minCameraClearanceM: 1.2,
  /* A beauty station is a LANDSCAPE shot, and 2 m of clearance
     means the lens is against a wall. saintfall-shots.mjs
     rejects a raking-light swing on the same number. */
  landscapeClearanceM: 18.0,
  /* Every prop is bedded. A 12 cm gap under a crate is
     invisible from the air and obvious at eye level. */
  floatingGapM: 0.12,
};

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(PAGE, { cache: "no-store" })).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error(`static server never came up on ${BASE}`);
}

/* ------------------------------------------------------------
   Result table. `record(name, pass, detail, skip)` is the only
   way a line is printed, so a check that throws cannot be
   mistaken for a check that passed - the runner records the
   throw as a failure with the message attached.

   A SKIP is its own state and it is loud. It means the subject
   does not exist yet, which on a level being built by seven
   modules at once is the normal case for the first fortnight -
   and it must never be able to look like a pass.
   ------------------------------------------------------------ */
const results = [];
function record(name, pass, detail, skip = false) {
  results.push({ name, pass: !!pass, skip: !!skip, detail: String(detail) });
  const tag = skip ? "SKIP" : (pass ? "ok  " : "FAIL");
  console.log(`  ${tag}  ${name}  (${detail})`);
}
async function gate(name, fn) {
  try {
    const r = await fn();
    if (r && r.skip) record(name, true, r.detail, true);
    else record(name, r.pass, r.detail);
  } catch (error) {
    record(name, false, `threw: ${(error && error.message) || error}`);
  }
}

/** Every gate that reads a method which may not exist yet goes
 *  through this: `null` back from atoll-qa means the subsystem
 *  has not been built, and that is a SKIP. */
const skipIfNull = (value, what) => (value === null || value === undefined
  ? { skip: true, detail: `${what} - not published yet` } : null);

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium",
      headless: !args.headed,
      args: [
        "--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio",
      ],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
    page.on("console", (m) => {
      if (m.type() === "error") pageErrors.push(`console: ${m.text()}`);
    });

    const t0 = Date.now();
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
    console.log(`boot ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

    /* THE ATOLL HOOK MUST EXIST BEFORE ANYTHING ELSE IS ASKED.
       Every gate below reads through it, and a missing hook would
       otherwise report as sixteen separate mysterious failures. */
    const hasHook = await page.evaluate(() => !!(window.__SF && window.__SF.atoll));
    if (!hasHook) {
      record("window.__SF.atoll exists", false, "atoll-qa.js did not install");
      throw new Error("no atoll QA hook - nothing else can be measured");
    }
    record("window.__SF.atoll exists", true, "installed");

    // Settle: LOD selection, the water's first swell, weather and the first shadow pass.
    await page.evaluate(() => window.__SF.maximize());
    await page.evaluate(() => window.__SF.advanceTime(2.5, 1 / 60));

    console.log("\n--- the island ---");

    await gate("every station pad is flat", async () => {
      const rows = await page.evaluate(() => {
        const a = window.__SF.atoll;
        return a.stations().map((st) => ({ id: st.id, f: a.padFlatness(st.id) }));
      });
      const live = rows.filter((r) => r.f && !r.f.degenerate);
      if (!live.length) return { skip: true, detail: "no levelled pads published" };
      /* BOTH numbers, because the two documents ask for different
         ones: p95 deviation catches a pad that is flat at the
         wrong height, grade catches a pad that is at the right
         height and tilted. */
      const badDev = live.filter((r) => r.f.p95DevM > GATES.padP95DevM);
      const badGrade = live.filter((r) => r.f.maxGradePct > GATES.padGradePct);
      const worstDev = live.reduce((a, b) => (b.f.p95DevM > a.f.p95DevM ? b : a));
      const worstGrade = live.reduce((a, b) => (b.f.maxGradePct > a.f.maxGradePct ? b : a));
      const bad = [...new Set([...badDev, ...badGrade].map((b) => b.id))];
      return {
        pass: bad.length === 0,
        detail: `worst p95 ${worstDev.id} ${worstDev.f.p95DevM.toFixed(2)}m`
          + ` (<= ${GATES.padP95DevM}), worst grade ${worstGrade.id}`
          + ` ${worstGrade.f.maxGradePct.toFixed(1)}% (<= ${GATES.padGradePct})`
          + (bad.length ? ` - over on ${bad.join(", ")}` : ""),
      };
    });

    await gate("the reef crest stands proud of the flat", async () => {
      const r = await page.evaluate(() => window.__SF.atoll.reefProfile(24));
      const s = skipIfNull(r, "reefProfile");
      if (s) return s;
      const [cLo, cHi] = GATES.reefCrestM;
      const [fLo, fHi] = GATES.reefFlatM;
      const crestOk = r.crestMin >= cLo && r.crestMax <= cHi;
      const flatOk = r.flatMin >= fLo && r.flatMax <= fHi;
      return {
        pass: crestOk && flatOk,
        detail: `crest ${r.crestMin.toFixed(2)}..${r.crestMax.toFixed(2)}`
          + ` (want ${cLo}..${cHi}), flat ${r.flatMin.toFixed(2)}..${r.flatMax.toFixed(2)}`
          + ` (want ${fLo}..${fHi}) over ${r.bearings} bearings`,
      };
    });

    await gate("the lagoon floor is at its authored depth", async () => {
      const d = await page.evaluate(() => window.__SF.atoll.lagoonDepth(430, 1600));
      const s = skipIfNull(d, "lagoonDepth");
      if (s) return s;
      const [lo, hi] = GATES.lagoonDepthM;
      /* The MAXIMUM is what the gate is about - the deep middle -
         because the lagoon shallows to nothing at its rim by
         construction and a mean would be a different number for
         every change to the beach. */
      return {
        pass: d.maxM >= lo && d.maxM <= hi,
        detail: `deepest ${d.maxM.toFixed(2)}m, mean ${d.meanM.toFixed(2)}m,`
          + ` want ${lo}-${hi}`,
      };
    });

    await gate("the ring-radius warp stays on the mesh", async () => {
      const w = await page.evaluate(() => window.__SF.atoll.ringWarp());
      const s = skipIfNull(w, "ringWarp");
      if (s) return s;
      return {
        pass: w.maxAbsM <= GATES.ringWarpMaxM,
        detail: `max |dR| ${w.maxAbsM.toFixed(1)}m at compass`
          + ` ${w.atCompassDeg.toFixed(0)} (<= ${GATES.ringWarpMaxM})`,
      };
    });

    await gate("heightAt is total and finite", async () => {
      const rows = await page.evaluate(() => window.__SF.atoll.finiteProbe());
      const bad = rows.filter((r) => !r.finite);
      return {
        pass: bad.length === 0,
        detail: bad.length
          ? `not finite at ${bad.map((b) => `(${b.x},${b.z})`).join(" ")}`
          : `${rows.length} points finite, incl. (4000,4000) = ${rows[0].y.toFixed(1)}m`,
      };
    });

    console.log("\n--- traversal ---");

    await gate("the ring circuit stays under grade", async () => {
      const g = await page.evaluate(() => window.__SF.atoll.circuitGrade(900));
      const s = skipIfNull(g, "circuitGrade");
      if (s) return s;
      return {
        pass: g.max <= GATES.circuitMaxGrade,
        detail: `max ${g.max.toFixed(3)} (<= ${GATES.circuitMaxGrade})`
          + ` mean ${g.mean.toFixed(3)}, ${g.source}`
          + (g.worstAt ? `, worst at ${g.worstAt.x.toFixed(0)},${g.worstAt.z.toFixed(0)}` : ""),
      };
    });

    await gate("the Cauldron road is climbable", async () => {
      const g = await page.evaluate(() => window.__SF.atoll.cauldronRoadGrade(600));
      const s = skipIfNull(g, "field.cauldronRoad");
      if (s) return s;
      return {
        pass: g.max <= GATES.cauldronRoadMaxGrade,
        detail: `max ${g.max.toFixed(3)} (<= ${GATES.cauldronRoadMaxGrade})`
          + ` mean ${g.mean.toFixed(3)} over ${g.length.toFixed(0)}m`,
      };
    });

    await gate("every station is reachable on foot from the Landing", async () => {
      const rows = await page.evaluate(() => {
        const a = window.__SF.atoll;
        return a.stations().map((st) => ({ id: st.id, r: a.reachable(st.id) }));
      });
      const live = rows.filter((r) => r.r);
      if (!live.length) return { skip: true, detail: "no routes published" };
      const bad = live.filter((r) => !r.r.reachable);
      return {
        pass: bad.length === 0,
        detail: bad.length
          ? bad.map((b) => `${b.id} via ${b.r.via} blocked at `
            + `${b.r.blockedAt ? `${b.r.blockedAt.x.toFixed(0)},${b.r.blockedAt.z.toFixed(0)}` : "?"}`
            + ` (${b.r.reason})`).join(" | ")
          : `${live.length}/${live.length} reachable`,
      };
    });

    await gate("deep water is a boundary, not a space", async () => {
      const w = await page.evaluate(() => window.__SF.atoll.wadeProfile(36));
      const s = skipIfNull(w, "wadeProfile");
      if (s) return s;
      return {
        pass: w.deepestWalkableM <= w.capM && w.violationCount === 0,
        detail: `deepest walkable ${w.deepestWalkableM.toFixed(2)}m (cap ${w.capM}),`
          + ` ${w.violationCount} gentle shelves past the cap`,
      };
    });

    console.log("\n--- the sea ---");

    await gate("the baked seabed puts the foam line where the ground is", async () => {
      const f = await page.evaluate(() => window.__SF.atoll.foamLineError(72, 0));
      const s = skipIfNull(f, "terrain.seabedTexture");
      if (s) return s;
      if (!f.measured) {
        return {
          skip: true,
          detail: `all ${f.bearings} bearings ill-conditioned (the flat is within`
            + ` ${f.minGrade * 100}cm/m of the datum) - worst bake height error`
            + ` ${(f.worstHeightErrorM * 100).toFixed(1)}cm`,
        };
      }
      /* The ill-conditioned count is reported on the same line
         rather than hidden: a level that measures 0.4 m of foam
         error on twelve bearings and cannot measure it at all on
         the other sixty has a terrain problem, not a bake one. */
      /* Three bearings in 72 is 4 %: a 2 m texel is allowed to
         lose the odd sliver of ground that grazes the datum, and
         is not allowed to lose the shoreline. */
      return {
        pass: f.worstM <= GATES.foamLineErrorM && f.topologyMismatch <= 3,
        detail: `worst ${f.worstM.toFixed(2)}m at compass ${f.worstAt.toFixed(0)},`
          + ` mean ${f.meanM.toFixed(2)}m over ${f.measured} bearings`
          + ` (<= ${GATES.foamLineErrorM}); bake height error`
          + ` ${(f.worstHeightErrorM * 100).toFixed(1)}cm`
          + (f.illConditioned
            ? `; ${f.illConditioned} bearings unstable at ${f.unstableAt.join(",")}` : "")
          /* A bearing where the two readers see a different NUMBER
             of datum crossings is a different finding from a bake
             that is a few centimetres out, and it is not folded
             into the metres. See foamLineError's crossings note:
             compass 190 read 21.79 m for two rounds because a
             sliver of ground at r 1009.5 exists in the field and
             not in a 2 m-texel bake, and the old march measured
             the gap to the NEXT feature. */
          + (f.topologyMismatch
            ? `; ${f.topologyMismatch} bearings differ in crossing count at ${f.topologyAt.join(",")}` : ""),
      };
    });

    await gate("the bake's 16-bit pair survives the linear filter", async () => {
      /* The low byte of the R+G pair wraps 255 -> 0 inside a
         texel, and LinearFilter interpolates each channel
         independently before the shader decodes - so the decoded
         height can spike by up to scale/255 = 0.376 m at a wrap.
         Sampled where it matters: along the reef flat, which is
         the one place the eye is. */
      const rows = await page.evaluate(() => {
        const a = window.__SF.atoll;
        const out = [];
        for (let i = 0; i < 180; i += 1) {
          const c = (i / 180) * Math.PI * 2;
          for (const r of [930, 950, 970, 990]) {
            const p = a.seabedProbe(Math.sin(c) * r, -Math.cos(c) * r);
            if (p) out.push(p.wrapRiskM);
          }
        }
        return out;
      });
      if (!rows.length) return { skip: true, detail: "terrain.seabedTexture - not published yet" };
      const worst = Math.max(...rows);
      /* Half a texel's worth of legitimate filtering difference
         is expected; a whole low-byte range is a wrap. */
      return {
        pass: worst < 0.30,
        detail: `worst filtered-vs-nearest ${worst.toFixed(3)}m over ${rows.length} samples`
          + " (a wrap shows as ~0.376m)",
      };
    });

    await gate("surfaceYAt agrees with the drawn surface", async () => {
      const w = await page.evaluate(() => window.__SF.atoll.waterSurfaceAgreement(240));
      const s = skipIfNull(w, "waterSurfaceAgreement");
      if (s) return s;
      if (!w.supported) return { skip: true, detail: w.reason };
      return {
        pass: w.worstM <= GATES.waterSurfaceAgreeM,
        detail: `${w.mode}: worst ${(w.worstM * 100).toFixed(1)}cm,`
          + ` mean ${(w.meanM * 100).toFixed(1)}cm over ${w.samples}`
          + ` (<= ${GATES.waterSurfaceAgreeM * 100}cm)`,
      };
    });

    console.log("\n--- framing ---");

    /* WORLD-AGNOSTIC AND KEPT UNCHANGED. This gate reads only the
       engine hook, so it is the same on all three worlds. */
    await gate("no beauty shot has the camera in geometry", async () => {
      const shots = await page.evaluate(() => window.__SF.listPoses().map((p) => p.id));
      if (!shots.length) return { skip: true, detail: "world.beautyShots is empty" };
      const tight = [];
      for (const id of shots) {
        await page.evaluate((s) => window.__SF.setPose(s), id);
        await page.evaluate(() => window.__SF.renderOnce(1 / 60));
        const c = await page.evaluate(() => window.__SF.cameraClearance());
        if (c.nearest !== null && c.nearest < GATES.minCameraClearanceM) {
          tight.push(`${id}:${c.nearest}m`);
        }
      }
      await page.evaluate(() => window.__SF.releaseCamera?.());
      return {
        pass: tight.length === 0,
        detail: tight.length ? tight.join(" ") : `${shots.length} stations clear`,
      };
    });

    await gate("every beauty shot has landscape clearance", async () => {
      const shots = await page.evaluate(() => window.__SF.listPoses().map((p) => p.id));
      if (!shots.length) return { skip: true, detail: "world.beautyShots is empty" };
      const tight = [];
      let worst = Infinity;
      for (const id of shots) {
        await page.evaluate((s) => window.__SF.setPose(s), id);
        await page.evaluate(() => window.__SF.renderOnce(1 / 60));
        const c = await page.evaluate(() => window.__SF.cameraClearance(5, 3));
        if (c.nearest !== null) {
          worst = Math.min(worst, c.nearest);
          if (c.nearest < GATES.landscapeClearanceM) tight.push(`${id}:${c.nearest}m`);
        }
      }
      await page.evaluate(() => window.__SF.releaseCamera?.());
      return {
        pass: tight.length === 0,
        detail: `nearest ${Number.isFinite(worst) ? worst.toFixed(1) : "-"}m`
          + ` (>= ${GATES.landscapeClearanceM})`
          + (tight.length ? ` - tight: ${tight.slice(0, 5).join(" ")}` : ""),
      };
    });

    await gate("no beauty shot is above the camera cap", async () => {
      const rows = await page.evaluate(() => window.__SF.atoll.poseAltitudes());
      if (!rows.length) return { skip: true, detail: "world.beautyShots is empty" };
      const cap = await page.evaluate(() => window.__SF.atoll.cameraCap());
      const over = rows.filter((r) => r.overCap);
      return {
        pass: over.length === 0,
        detail: over.length
          ? `${over.map((o) => `${o.id}@${o.y.toFixed(0)}m`).join(" ")} over ${cap.maxEyeM}m`
          : `highest ${Math.max(...rows.map((r) => r.y)).toFixed(0)}m of ${cap.maxEyeM}m`,
      };
    });

    await gate("every prop is bedded", async () => {
      const f = await page.evaluate((g) => window.__SF.atoll.floatingProps(g, 7),
        GATES.floatingGapM);
      const s = skipIfNull(f, "world.meshes");
      if (s) return s;
      /* THE COUNTS ARE ALL PRINTED, and that is the point of them.
         The version of this gate that read no instanceMatrix
         reported "0 floating of 0 meshes" and passed while the
         defect was on screen. A bedding gate that cannot say how
         many COPIES it looked at has not told you anything, so
         the copy count, the sea exemption and both structural
         exclusions come out on the line. */
      return {
        pass: f.floating === 0,
        detail: `${f.floating} floating of ${f.copies} copies in ${f.meshes} meshes`
          + ` (${f.afloat} afloat over water, ${f.supported ?? 0} standing on other geometry`
          + (f.supportedWorst ? ` (worst ${f.supportedWorst.name} +${f.supportedWorst.gap.toFixed(2)}m on ${f.supportedWorst.by})` : "")
          + `, ${f.notLandform} not bedded on the landform,`
          + ` ${f.paired} canopies judged by their trunk)`
          + (f.rows.length
            ? ` - worst ${f.rows[0].name}`
              + (f.rows[0].instance === undefined ? "" : `#${f.rows[0].instance}`)
              + ` +${f.rows[0].gap.toFixed(2)}m at ${f.rows[0].x.toFixed(0)},${f.rows[0].z.toFixed(0)}`
            : ""),
      };
    });

    console.log("\n--- health ---");

    await gate("no page errors", async () => ({
      pass: pageErrors.length === 0,
      detail: pageErrors.length ? pageErrors.slice(0, 3).join(" | ") : "clean",
    }));

    await gate("no NaN reached a composite uniform", async () => {
      const bad = await page.evaluate(() => {
        const u = window.__SF.ctx?.render?.uniforms || null;
        if (!u) return ["no render.uniforms exposed"];
        const out = [];
        for (const k of Object.keys(u)) {
          const v = u[k] && u[k].value;
          if (typeof v === "number" && !Number.isFinite(v)) out.push(k);
          else if (v && typeof v === "object") {
            for (const c of ["x", "y", "z", "w", "r", "g", "b"]) {
              if (typeof v[c] === "number" && !Number.isFinite(v[c])) out.push(`${k}.${c}`);
            }
          }
        }
        return out;
      });
      return { pass: bad.length === 0, detail: bad.length ? bad.join(", ") : "all finite" };
    });

    await gate("no NaN in the atmosphere or the water's uniforms", async () => {
      /* One NaN kills the whole post chain, and the two most
         likely producers on this level are a swell term with a
         zero-length normalise in it and a sun direction at
         exactly the horizon. Walked separately from the
         composite because they are different materials. */
      const bad = await page.evaluate(() => {
        const out = [];
        const walk = (label, u) => {
          if (!u) return;
          for (const k of Object.keys(u)) {
            const v = u[k] && u[k].value;
            if (typeof v === "number" && !Number.isFinite(v)) out.push(`${label}.${k}`);
            else if (v && typeof v === "object") {
              for (const c of ["x", "y", "z", "w"]) {
                if (typeof v[c] === "number" && !Number.isFinite(v[c])) out.push(`${label}.${k}.${c}`);
              }
            }
          }
        };
        walk("atmos", window.__SF.ctx?.atmos?.uniforms);
        walk("water", window.__SF.ctx?.water?.material?.uniforms);
        return out;
      });
      return { pass: bad.length === 0, detail: bad.length ? bad.join(", ") : "all finite" };
    });

    const failed = results.filter((r) => !r.skip && !r.pass);
    const skipped = results.filter((r) => r.skip);
    console.log(`\n${failed.length ? `${failed.length} GATE(S) FAILED` : "all measurable gates passed"}`
      + (skipped.length ? `, ${skipped.length} SKIPPED (${skipped.map((s) => s.name).join("; ")})` : ""));
    if (args.json) {
      const out = path.resolve(root, String(args.json));
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, JSON.stringify({ url: URL, gates: GATES, results }, null, 2));
      console.log(`wrote ${path.relative(root, out)}`);
    }
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
