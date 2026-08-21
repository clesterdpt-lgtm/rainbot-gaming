#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Kenosis acceptance gates

   The White Vigil is a level about VERTICALITY, and every way it
   can fail is a number rather than a picture:

     - a pad that is not flat is a fight arena on a hillside;
     - a road over grade is a road you cannot walk up;
     - a station the walk solver cannot reach is content that does
       not exist;
     - a crevasse you can stroll across is a decal;
     - a silhouette that does not match the authored profile is a
       different mountain from the one the level was designed for.

   Screenshots cannot see any of those. This measures them, prints a
   pass/fail table, and exits non-zero on a failure so it can gate.

   Everything here is read through `window.__SF.summit`, which is
   summit-qa.js. Nothing is recomputed in this file - a harness that
   reimplements the rule it is testing tests itself. Where a number
   comes from the engine, the engine is asked.

   Usage:
     node scripts/saintfall-summit-audit.mjs
     node scripts/saintfall-summit-audit.mjs --json out.json
     node scripts/saintfall-summit-audit.mjs --quality ultra --time alpenglow
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
const PORT = Number(args.port || 45000 + (process.pid % 4000));
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `${BASE}/games/saintfall-white-vigil.html`;
const URL = `${PAGE}?qa=1&quality=${args.quality || "high"}&time=${args.time || "alpenglow"}`;

/* ------------------------------------------------------------
   THE GATES

   Each threshold is a design decision with a reason, not a number
   picked to make the current build pass. They are listed here, once,
   so raising one is a visible edit rather than a quiet drift.
   ------------------------------------------------------------ */
const GATES = {
  /* A pad is a fight floor. Half a metre of slope across it is the
     difference between a boss arena and a hillside; the layout says
     +/-0.35 m and this allows the terrain's own sample noise on top. */
  padSpreadM: 0.45,
  /* The Via Sacra is a walking road. 13% is the layout's ceiling and
     is about as steep as a real mountain road gets before it needs
     switchbacks - which this one has six of. */
  viaSacraMaxPct: 13.0,
  viaSacraMeanPct: 9.0,
  /* Every station must be reachable on foot from the basecamp. This
     is the gate that catches "it looks fine from the air". */
  reachableStations: 9,
  /* A crevasse the player can walk over is a painted line. Anything
     called a crevasse has to be a hole the solver agrees is a hole. */
  crevasseMinWidthM: 8.0,
  /* The camera must not be inside geometry at any authored station.
     1.2 m is the same clearance saintfall-shots.mjs warns at. */
  minCameraClearanceM: 1.2,
  /* The summit is the whole level. If the profile does not reach it,
     the layout and the terrain have diverged. */
  summitAltitudeM: [446, 458],
  /* The inversion deck has to be somewhere a player can climb
     through, and it has to actually occlude. */
  inversionDeckM: [100, 145],
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
   Result table. `ok(name, pass, detail)` is the only way a line is
   printed, so a check that throws cannot be mistaken for a check
   that passed - the runner records the throw as a failure with the
   message attached.
   ------------------------------------------------------------ */
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: String(detail) });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}  (${detail})`);
}
async function gate(name, fn) {
  try {
    const r = await fn();
    record(name, r.pass, r.detail);
  } catch (error) {
    record(name, false, `threw: ${(error && error.message) || error}`);
  }
}

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

    /* THE SUMMIT HOOK MUST EXIST BEFORE ANYTHING ELSE IS ASKED.
       Every gate below reads through it, and a missing hook would
       otherwise report as nine separate mysterious failures. */
    const hasHook = await page.evaluate(() => !!(window.__SF && window.__SF.summit));
    if (!hasHook) {
      record("window.__SF.summit exists", false, "summit-qa.js did not install");
      throw new Error("no summit QA hook - nothing else can be measured");
    }
    record("window.__SF.summit exists", true, "installed");

    // Settle: LOD selection, weather fields and the first shadow pass.
    await page.evaluate(() => window.__SF.maximize());
    await page.evaluate(() => window.__SF.advanceTime(2.5, 1 / 60));

    console.log("\n--- terrain ---");

    await gate("every station pad is flat", async () => {
      const rows = await page.evaluate(() => {
        const s = window.__SF.summit;
        return s.stations().map((st) => ({ id: st.id, f: s.padFlatness(st.id) }));
      });
      const worst = rows.reduce((a, b) => (b.f.spread > a.f.spread ? b : a));
      const bad = rows.filter((r) => r.f.spread > 0.45);
      return {
        pass: bad.length === 0,
        detail: `worst ${worst.id} spread ${worst.f.spread.toFixed(3)}m`
          + (bad.length ? ` - over on ${bad.map((b) => b.id).join(", ")}` : ""),
      };
    });

    await gate("the summit reaches its authored altitude", async () => {
      const y = await page.evaluate(() => window.__SF.summit.altitudeAt(0, 0));
      const [lo, hi] = GATES.summitAltitudeM;
      return { pass: y >= lo && y <= hi, detail: `${y.toFixed(1)}m, want ${lo}-${hi}` };
    });

    await gate("the radial profile matches the layout", async () => {
      const scans = await page.evaluate(() => [0, 90, 180, 270].map(
        (b) => ({ b, p: window.__SF.summit.profileScan(b, 64) })
      ));
      /* The mountain must fall monotonically-ish from the summit on
         every bearing. A profile that rises again out at 700m is a
         second peak, and a second peak is a different level. */
      const faults = scans.filter((s) => {
        const ys = s.p.map((q) => q.y);
        const outer = ys.slice(Math.floor(ys.length * 0.55));
        return Math.max(...outer) > ys[0] * 0.62;
      });
      return {
        pass: faults.length === 0,
        detail: faults.length
          ? `secondary high ground on bearing ${faults.map((f) => f.b).join(", ")}`
          : "single peak on all four bearings",
      };
    });

    console.log("\n--- traversal ---");

    await gate("the Via Sacra stays under grade", async () => {
      const g = await page.evaluate(() => window.__SF.summit.viaSacraGrade(600));
      const pass = g.maxPct <= GATES_MAX && g.meanPct <= GATES_MEAN;
      return {
        pass,
        detail: `max ${g.maxPct.toFixed(1)}% (<= ${GATES_MAX}) mean ${g.meanPct.toFixed(1)}%`
          + (g.worstAt ? ` worst at ${g.worstAt.x.toFixed(0)},${g.worstAt.z.toFixed(0)}` : ""),
      };
    });

    await gate("every station is reachable on foot", async () => {
      const rows = await page.evaluate(() => {
        const s = window.__SF.summit;
        return s.stations().map((st) => ({ id: st.id, r: s.reachability(st.id) }));
      });
      const bad = rows.filter((r) => !r.r.reachable);
      return {
        pass: bad.length === 0,
        detail: bad.length
          ? `blocked: ${bad.map((b) => `${b.id}@${b.r.blockedAt ? `${b.r.blockedAt.x.toFixed(0)},${b.r.blockedAt.z.toFixed(0)}` : "?"}`).join(" ")}`
          : `${rows.length}/${rows.length} reachable`,
      };
    });

    await gate("crevasses are real holes", async () => {
      const probes = await page.evaluate(() => window.__SF.summit.crevasseProbe
        ? window.__SF.summit.crevasseSamples
          ? window.__SF.summit.crevasseSamples()
          : null
        : null);
      if (!probes || !probes.length) {
        return { pass: false, detail: "no crevasse samples published by summit-qa" };
      }
      const open = probes.filter((p) => p.open);
      const narrow = open.filter((p) => p.width < GATES.crevasseMinWidthM);
      return {
        pass: open.length > 0 && narrow.length === 0,
        detail: `${open.length} open of ${probes.length}, narrowest ${
          open.length ? Math.min(...open.map((p) => p.width)).toFixed(1) : "-"}m`,
      };
    });

    console.log("\n--- atmosphere ---");

    await gate("the inversion deck sits in the valley", async () => {
      const inv = await page.evaluate(() => window.__SF.summit.inversionProbe());
      const [lo, hi] = GATES.inversionDeckM;
      return {
        pass: inv.deckY >= lo && inv.deckY <= hi,
        detail: `deck at ${inv.deckY.toFixed(0)}m, want ${lo}-${hi}`,
      };
    });

    console.log("\n--- framing ---");

    await gate("no beauty shot has the camera in geometry", async () => {
      const shots = await page.evaluate(() => window.__SF.listPoses().map((p) => p.id));
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

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${failed.length ? `${failed.length} GATE(S) FAILED` : "all gates passed"}`);
    if (args.json) {
      const out = path.resolve(root, String(args.json));
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, JSON.stringify({ url: URL, results }, null, 2));
      console.log(`wrote ${path.relative(root, out)}`);
    }
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

const GATES_MAX = GATES.viaSacraMaxPct;
const GATES_MEAN = GATES.viaSacraMeanPct;

main().catch((error) => { console.error(error); process.exitCode = 1; });
