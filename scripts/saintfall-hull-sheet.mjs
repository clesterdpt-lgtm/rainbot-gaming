#!/usr/bin/env node
/* ============================================================
   SAINTFALL - THE GREEN ANTIPHON - hull sheet

   The five authored beauty poses all stand 100-900 m off the ship,
   which is the range the judges see it at and therefore the range
   it has to work at - but it is a terrible range to DIAGNOSE at.
   "The waterline is absent" and "the waterline is present and has
   no contrast" produce the same 150 m frame.

   So this harness stands at the ship. Every camera is derived from
   the live STATIONS rather than typed, so a camera cannot drift out
   of date when a piece is re-sited, and each one is aimed at one
   question:

     band     the tide bands on the Spine's flank, from 34 m at
              eye height - the range at which the crust, splash and
              boot-top bands are each over 40 px tall
     bandmid  the same flank at 150 m, the Hold camera's range,
              which is where the bands have to survive
     flank    three quarters along the Spine, sun on the far side -
              the shade-side value question, isolated
     lit      the same piece with the sun on THIS side
     deck     standing on the weather deck: facet response and
              plate seams at 12 m
     holdin   inside the Reliquary Hold, which is where the brass is
     prowclose the bow's cant and its scoured windward face

   Usage:
     node scripts/saintfall-hull-sheet.mjs --out output/saintfall/island/check-ship-x
     node scripts/saintfall-hull-sheet.mjs --out ... --cams band,deck
   ============================================================ */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const k = t.slice(2); const n = argv[i + 1];
      if (n === undefined || n.startsWith("--")) a[k] = true; else { a[k] = n; i += 1; }
    } else a._.push(t);
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
const OUT = path.resolve(root, String(args.out || "output/saintfall/island/check-hull-sheet"));
const TIME = String(args.time || "trade");
const QUALITY = String(args.quality || "ultra");
const WANT = args.cams ? String(args.cams).split(",").map((s) => s.trim()) : null;
const PORT = Number(args.port || 46200 + (process.pid % 5000));
const URL = `http://127.0.0.1:${PORT}/games/saintfall-green-antiphon.html`
  + `?qa=1&quality=${QUALITY}&time=${TIME}`;

fs.mkdirSync(OUT, { recursive: true });
const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});
async function up() {
  for (let i = 0; i < 200; i += 1) {
    try { const r = await fetch(URL, { cache: "no-store" }); if (r.ok) return; } catch (_) {}
    await delay(100);
  }
  throw new Error("server never came up");
}

let browser;
try {
  await up();
  browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--disable-gpu-vsync",
      "--force-device-scale-factor=1", "--hide-scrollbars", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 200)));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__SF, null, { timeout: 240000 });

  const cams = await page.evaluate(() => {
    const T = window.__SF;
    const st = T.atoll.stations();
    const by = {};
    for (const s of st) by[s.id] = s;
    const sea = T.atoll.datum ? (T.atoll.datum().seaY ?? 0) : 0;
    const sp = by.spine || by.hold;
    const hd = by.hold || sp;
    const pw = by.prow || sp;
    /* The sun's bearing, so "sun on the far side" is derived and
       not guessed - the trade sun sits at azimuth 297, and a camera
       typed against that number stops being right the moment the
       key angle is re-tuned, which it was twice this round. */
    const sd = T.atmos.sunDir;
    const sunB = Math.atan2(sd.x, sd.z);              // toward the sun
    const off = (o, d, up_) => [o.x + Math.sin(d) * 1, o.y, o.z + Math.cos(d) * 1];
    void off;
    const at = (cx, cz, cy, tx, ty, tz, fov) => ({ position: [cx, cy, cz], target: [tx, ty, tz], fov });
    const list = [];
    /* Straight out from the Spine on the shaded beam, then on the
       lit beam. sunB points AT the sun, so standing at -sunB puts
       the sun behind the ship. */
    /* THE RADIUS IS NOT A TASTE CHOICE. The Spine's beam is 72 m,
       so a camera 34 m off the station is INSIDE THE HULL - the
       first version of this sheet stood there and returned a black
       frame that looked exactly like the defect it was hunting.
       Everything here is outside the beam by at least a beam. */
    const R = (a, r) => [sp.x + Math.sin(a) * r, sp.z + Math.cos(a) * r];
    const shaded = sunB + Math.PI;
    /* Narrow lens on the waterline: the crust band is 1.23 m tall,
       and at 110 m through a 24-degree lens it is 46 px, which is
       the smallest it can be and still be judged. */
    let p = R(shaded, 110);
    list.push(["band", at(p[0], p[1], sea + 4.0, sp.x, sea + 2.0, sp.z, 24)]);
    p = R(sunB, 110);
    list.push(["bandlit", at(p[0], p[1], sea + 4.0, sp.x, sea + 2.0, sp.z, 24)]);
    p = R(shaded, 150);
    list.push(["bandmid", at(p[0], p[1], sea + 9, sp.x, sea + 16, sp.z, 50)]);
    p = R(shaded + 0.9, 120);
    list.push(["flank", at(p[0], p[1], sea + 26, sp.x, sea + 22, sp.z, 52)]);
    p = R(sunB + 0.9, 120);
    list.push(["lit", at(p[0], p[1], sea + 26, sp.x, sea + 22, sp.z, 52)]);
    p = R(shaded, 96);
    list.push(["deck", at(p[0], p[1], sea + 62, sp.x, sea + 34, sp.z, 62)]);
    list.push(["holdin", at(hd.x + 26, hd.z + 30, sea + 24, hd.x - 10, sea + 16, hd.z - 20, 66)]);
    p = [pw.x + Math.sin(shaded) * 90, pw.z + Math.cos(shaded) * 90];
    list.push(["prowclose", at(p[0], p[1], sea + 12, pw.x, sea + 18, pw.z, 54)]);
    return { list, seaY: sea, sunBearingDeg: +(sunB * 180 / Math.PI).toFixed(1) };
  });

  const wanted = cams.list.filter(([id]) => !WANT || WANT.includes(id));
  const report = { seaY: cams.seaY, sunBearingDeg: cams.sunBearingDeg, cams: {} };
  for (const [id, c] of wanted) {
    const info = await page.evaluate(async ({ c }) => {
      const T = window.__SF;
      T.maximize();
      T.lookAt(c.position, c.target, c.fov);
      for (let i = 0; i < 4; i += 1) T.renderStill();
      return { url: T.captureDataURL(), cam: c };
    }, { c });
    const b64 = info.url.split(",")[1];
    fs.writeFileSync(path.join(OUT, `${id}.png`), Buffer.from(b64, "base64"));
    report.cams[id] = c;
  }
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
  console.log("artifacts: " + path.relative(root, OUT));
  console.log(JSON.stringify(report, null, 1));
  if (errs.length) console.log("errors: " + errs.slice(0, 5).join(" | "));
} catch (e) {
  console.error(e && (e.stack || e.message));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill();
}
