#!/usr/bin/env node
/* SAINTFALL - Antiphon water probe.
   Reads the sea AT A POINT rather than photographing it: the live
   water uniforms, the foam and break scalars along a radial
   transect through the reef crest, and the glitter geometry for
   the current hour and eye height. */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const t = process.argv[i];
  if (t.startsWith("--")) { const n = process.argv[i + 1];
    if (n === undefined || n.startsWith("--")) args[t.slice(2)] = true;
    else { args[t.slice(2)] = n; i += 1; } }
}
const POSE = String(args.pose || "crest");
const TIME = String(args.time || "trade");
const QUALITY = String(args.quality || "ultra");
const PORT = Number(args.port || 43900 + (process.pid % 6000));
const URL = `http://127.0.0.1:${PORT}/games/saintfall-green-antiphon.html`
  + `?qa=1&quality=${QUALITY}&time=${TIME}`;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});
let browser;
try {
  for (let i = 0; i < 150; i += 1) {
    try { const r = await fetch(URL, { cache: "no-store" }); if (r.ok) break; } catch (_) {}
    await delay(100);
  }
  browser = await chromium.launch({ channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
      "--disable-gpu-vsync", "--force-device-scale-factor=1", "--hide-scrollbars", "--mute-audio"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const logs = [];
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__SF, null, { timeout: 240000 });

  /* --shoot: a capture from an ARBITRARY camera, because the
     authored beauty shots at the trade hour all look away from
     the sun and a glitter path cannot be verified in a frame
     that does not contain the sun's azimuth. Takes an eye, a
     bearing and a pitch and writes a PNG. */
  if (args.shoot) {
    const shots = await page.evaluate(({ eye, bearings, pitch, fov }) => {
      const T = window.__SF;
      T.maximize();
      const sd = T.atmos.sunDir;
      const sunBear = Math.atan2(sd.x, -sd.z) * 180 / Math.PI;
      const outs = [];
      for (const rel of bearings) {
        const b = (sunBear + rel) * Math.PI / 180;
        const dir = [Math.sin(b), -Math.cos(b)];
        const tgt = [eye[0] + dir[0] * 400, eye[1] + pitch * 400, eye[2] + dir[1] * 400];
        T.lookAt(eye, tgt, fov);
        for (let i = 0; i < 3; i += 1) T.renderStill();
        outs.push({ rel, url: T.captureDataURL() });
      }
      return { sunBear: +sunBear.toFixed(2),
        sunElev: +(Math.asin(sd.y) * 180 / Math.PI).toFixed(2), outs };
    }, {
      eye: String(args.eye || "694,2.8,-694").split(",").map(Number),
      bearings: String(args.bearings || "0").split(",").map(Number),
      pitch: Number(args.pitch || 0.02),
      fov: Number(args.fov || 62),
    });
    const fs = await import("node:fs/promises");
    await fs.mkdir(String(args.shoot), { recursive: true });
    for (const o of shots.outs) {
      const buf = Buffer.from(o.url.split(",")[1], "base64");
      await fs.writeFile(path.join(String(args.shoot), `sun${o.rel}.png`), buf);
    }
    console.log(JSON.stringify({ sunBear: shots.sunBear, sunElev: shots.sunElev,
      wrote: shots.outs.map((o) => `sun${o.rel}.png`) }, null, 1));
  }

  /* --isolate: switch ONE term of the sea off at a time and
     capture, restoring after each. Reasoning about which term
     draws a ridge is how a day gets spent; four captures settle
     it. */
  if (args.isolate) {
    const shots = await page.evaluate(({ pose }) => {
      const T = window.__SF;
      T.maximize(); T.setPose(pose);
      const mesh = T.render.scene.getObjectByName("atoll-sea");
      const u = mesh.material.uniforms;
      const cases = [
        ["base", () => () => {}],
        ["nochop", () => { const v = u.uSea.value.z; u.uSea.value.z = 0; return () => { u.uSea.value.z = v; }; }],
        ["noswell", () => { const v = u.uSea.value.y; u.uSea.value.y = 0; return () => { u.uSea.value.y = v; }; }],
        ["nospec", () => { const v = u.uSpec.value.y; u.uSpec.value.y = 0; return () => { u.uSpec.value.y = v; }; }],
        ["norefl", () => { const v = u.uReflFlat.value; u.uReflFlat.value = 0; return () => { u.uReflFlat.value = v; }; }],
      ];
      const outs = [];
      for (const [name, apply] of cases) {
        const undo = apply();
        for (let i = 0; i < 3; i += 1) T.renderStill();
        outs.push({ name, url: T.captureDataURL() });
        undo();
      }
      return outs;
    }, { pose: POSE });
    const fs = await import("node:fs/promises");
    await fs.mkdir(String(args.isolate), { recursive: true });
    for (const o of shots) {
      await fs.writeFile(path.join(String(args.isolate), `${POSE}-${o.name}.png`),
        Buffer.from(o.url.split(",")[1], "base64"));
    }
    console.log("isolate wrote " + shots.map((o) => o.name).join(", "));
  }

  const out = await page.evaluate(({ pose }) => {
    const T = window.__SF;
    T.maximize(); T.setPose(pose);
    for (let i = 0; i < 3; i += 1) T.renderStill();
    const cam = T.render.camera;
    const w = T.water;
    const mesh = T.render.scene.getObjectByName("atoll-sea");
    const u = mesh && mesh.material && mesh.material.uniforms;
    const dump = {};
    if (u) for (const k of Object.keys(u)) {
      const v = u[k] && u[k].value;
      if (v === undefined || v === null) { dump[k] = null; continue; }
      if (typeof v === "number") dump[k] = +v.toFixed(5);
      else if (typeof v === "boolean") dump[k] = v;
      else if (v.isColor) dump[k] = [+v.r.toFixed(3), +v.g.toFixed(3), +v.b.toFixed(3)];
      else if (v.isVector4) dump[k] = [v.x, v.y, v.z, v.w].map((n) => +n.toFixed(4));
      else if (v.isVector3) dump[k] = [v.x, v.y, v.z].map((n) => +n.toFixed(4));
      else if (v.isVector2) dump[k] = [v.x, v.y].map((n) => +n.toFixed(4));
      else if (v.isTexture) dump[k] = "texture " + (v.image ? v.image.width + "x" + v.image.height : "?");
      else dump[k] = String(v.constructor && v.constructor.name);
    }
    /* Radial transect on the crest camera's own bearing (SE, 135). */
    const bear = Math.PI * 135 / 180;
    const ux = Math.sin(bear), uz = -Math.cos(bear);
    const t = T.atmos && T.atmos.uniforms && T.atmos.uniforms.uTimeSF
      ? T.atmos.uniforms.uTimeSF.value : 0;
    const line = [];
    if (w) for (let r = 900; r <= 1260; r += 10) {
      const x = ux * r, z = uz * r;
      line.push({
        r,
        bed: +(T.terrain.heightAt ? T.terrain.heightAt(x, z) : NaN).toFixed(2),
        depth: +w.depthAt(x, z).toFixed(2),
        eta: +(w.surfaceYAt(x, z, t)).toFixed(3),
        foam: +w.foamAt(x, z, t).toFixed(3),
        brk: +w.breakAt(x, z).toFixed(3),
      });
    }
    /* And a lagoon-shore transect through the Landing beach. */
    const shore = [];
    if (w) for (let z = 700; z <= 830; z += 5) {
      shore.push({ z, depth: +w.depthAt(0, z).toFixed(2),
        foam: +w.foamAt(0, z, t).toFixed(3), brk: +w.breakAt(0, z).toFixed(3) });
    }
    return {
      camera: { pos: [cam.position.x, cam.position.y, cam.position.z].map((n) => +n.toFixed(2)), fov: cam.fov },
      timeSF: +t.toFixed(2),
      sunDir: T.atmos ? [T.atmos.sunDir.x, T.atmos.sunDir.y, T.atmos.sunDir.z].map((n) => +n.toFixed(4)) : null,
      waterStats: w && w.stats ? w.stats() : "no water",
      uniforms: dump,
      transect: line,
      shore,
      defines: mesh && mesh.material ? Object.keys(mesh.material.defines || {}) : null,
    };
  }, { pose: POSE });

  console.log(JSON.stringify(out, null, 1));
  if (logs.length) { console.log("--- console ---"); for (const l of logs.slice(0, 30)) console.log(l); }
} finally {
  if (browser) await browser.close();
  server.kill();
}
