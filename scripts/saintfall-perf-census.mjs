#!/usr/bin/env node
/* ============================================================
   SAINTFALL - frame cost census

   Two questions the decompose script cannot answer any more:

   1. WHERE ARE THE TRIANGLES. renderer.info says ~1M tris per frame;
      this walks the visible graph, frustum-tests every mesh and
      charges its triangles to its name, so the load has an address.
      Same again for the sun's shadow frustum (what the shadow pass
      re-rasterises every update).

   2. WHAT DOES EACH STAGE REALLY COST. The old no-shadow-up toggle
      (shadowMap.autoUpdate=false) is a NO-OP now: render() raises
      shadowMap.needsUpdate itself every frame when shadowEvery <= 1,
      which is exactly what qa=1 pins. The real freeze is
      setShadowEvery(<huge>), measured here, plus AO / MSAA / render
      scale / sky dome, each restored before the next so the ladder
      is per-feature rather than cumulative.

   Usage: node scripts/saintfall-perf-census.mjs [--frames 60] [--dpr 2]
          [--scenario spawn|vista|combat]
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const num = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const str = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 ? String(args[i + 1]) : dflt;
};
const FRAMES = num("--frames", 60);
const DPR = num("--dpr", 2);
const SCENARIO = str("--scenario", "spawn");
const PORT = 47300 + (process.pid % 1000);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${BASE}/games/saintfall.html`, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

const SCENARIOS = {
  spawn: `T.teleport(-14, 830, Math.PI); T.advanceTime(1.5, 1/60);`,
  vista: `T.teleport(0, 700, 0); T.lookAt([0, 26, 700], [0, 60, -900], 60); T.advanceTime(1.0, 1/60);`,
  combat: `
    T.teleport(-14, 700, 0);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      T.spawnEnemy("thresher", -14 + Math.cos(a) * (14 + (i % 5) * 4), 700 + Math.sin(a) * (14 + (i % 5) * 4));
    }
    T.advanceTime(1.5, 1/60);
  `,
};

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--mute-audio"],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1600, height: 900 }, deviceScaleFactor: DPR,
    })).newPage();
    page.on("pageerror", (e) => console.error("pageerror:", String(e).slice(0, 300)));
    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high&time=goldenhour`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 180000 });
    await page.evaluate((setup) => {
      window.__SF.maximize();
      const el = document.getElementById("sf-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
      const T = window.__SF;
      // eslint-disable-next-line no-new-func
      new Function("T", setup)(T);
      for (let i = 0; i < 30; i += 1) T.renderOnce(1 / 60);
    }, SCENARIOS[SCENARIO] || SCENARIOS.spawn);

    /* ------------------------- census ------------------------- */
    const census = await page.evaluate(() => {
      const T = window.__SF;
      const THREE = T.THREE;
      const scene = T.render.scene;
      const cam = T.render.camera;
      cam.updateMatrixWorld(true);
      scene.updateMatrixWorld(true);
      const frustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));

      let sun = null;
      scene.traverse((o) => { if (o.isDirectionalLight && o.castShadow && !sun) sun = o; });
      let shadowFrustum = null;
      if (sun) {
        const sc = sun.shadow.camera;
        sc.updateMatrixWorld(true);
        sc.updateProjectionMatrix();
        shadowFrustum = new THREE.Frustum().setFromProjectionMatrix(
          new THREE.Matrix4().multiplyMatrices(sc.projectionMatrix, sc.matrixWorldInverse));
      }

      const sphere = new THREE.Sphere();
      const rows = new Map();
      let totalTris = 0, totalShadowTris = 0, meshCount = 0, objCount = 0;
      let unculledTris = 0;
      scene.traverseVisible((o) => {
        objCount += 1;
        if (!o.isMesh || !o.geometry) return;
        const geo = o.geometry;
        const idx = geo.index;
        const pos = geo.attributes && geo.attributes.position;
        if (!pos) return;
        let tris = (idx ? idx.count : pos.count) / 3;
        if (o.isInstancedMesh) tris *= o.count;
        meshCount += 1;
        let inView = true;
        if (o.frustumCulled !== false) {
          if (!geo.boundingSphere) geo.computeBoundingSphere();
          if (geo.boundingSphere && Number.isFinite(geo.boundingSphere.radius)) {
            sphere.copy(geo.boundingSphere).applyMatrix4(o.matrixWorld);
            inView = frustum.intersectsSphere(sphere);
          }
        } else {
          unculledTris += tris;
        }
        const name = o.name || (o.parent && o.parent.name ? `(in ${o.parent.name})` : "(anonymous)");
        // Collapse per-figure part names: charge to the nearest named ancestor group.
        let label = name;
        let p = o;
        while (p && (!p.name || /^(mesh|part|bone|seg)/i.test(p.name)) && p.parent) p = p.parent;
        if (p && p.name) label = p.name;
        const row = rows.get(label) || { tris: 0, shadowTris: 0, meshes: 0, inViewTris: 0 };
        row.meshes += 1;
        row.tris += tris;
        if (inView) { row.inViewTris += tris; totalTris += tris; }
        if (shadowFrustum && o.castShadow) {
          let inShadow = true;
          if (o.frustumCulled !== false && geo.boundingSphere) {
            sphere.copy(geo.boundingSphere).applyMatrix4(o.matrixWorld);
            inShadow = shadowFrustum.intersectsSphere(sphere);
          }
          if (inShadow) { row.shadowTris += tris; totalShadowTris += tris; }
        }
        rows.set(label, row);
      });
      const top = [...rows.entries()]
        .map(([name, r]) => ({ name, ...r }))
        .sort((a, b) => b.inViewTris - a.inViewTris)
        .slice(0, 32);
      const topShadow = [...rows.entries()]
        .map(([name, r]) => ({ name, ...r }))
        .sort((a, b) => b.shadowTris - a.shadowTris)
        .slice(0, 12);
      return {
        totalTris, totalShadowTris, meshCount, objCount, unculledTris,
        top, topShadow,
        info: T.render.info(),
      };
    });

    const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    console.log(`=== census (${SCENARIO}, DPR ${DPR}) ===`);
    console.log(`objects visible: ${fmt(census.objCount)}   meshes: ${fmt(census.meshCount)}`);
    console.log(`tris in camera frustum: ${fmt(census.totalTris)}   (frustumCulled=false extra: ${fmt(census.unculledTris)})`);
    console.log(`castShadow tris in sun frustum: ${fmt(census.totalShadowTris)}`);
    console.log(`renderer.info: calls ${census.info.calls} tris ${fmt(census.info.triangles)} sceneSize ${census.info.sceneSize} shadowMap ${census.info.shadowMap}`);
    console.log(`\ntop meshes by in-view triangles:`);
    for (const r of census.top) {
      console.log(`  ${r.name.padEnd(44).slice(0, 44)} view ${fmt(r.inViewTris).padStart(10)}  total ${fmt(r.tris).padStart(10)}  shadow ${fmt(r.shadowTris).padStart(10)}  meshes ${r.meshes}`);
    }
    console.log(`\ntop shadow casters in sun frustum:`);
    for (const r of census.topShadow) {
      console.log(`  ${r.name.padEnd(44).slice(0, 44)} shadow ${fmt(r.shadowTris).padStart(10)}`);
    }

    /* ------------------------- cost ladder ------------------------- */
    const MEASURE = `(frames) => {
      const T = window.__SF;
      const glCtx = document.getElementById("sf-canvas").getContext("webgl2");
      const px = new Uint8Array(4);
      const draw = [], sync = [];
      for (let i = 0; i < frames; i += 1) {
        const t0 = performance.now();
        T.renderStill();
        draw.push(performance.now() - t0);
        glCtx.readPixels(0, 0, 1, 1, glCtx.RGBA, glCtx.UNSIGNED_BYTE, px);
        sync.push(performance.now() - t0);
      }
      const stat = (arr) => {
        arr.sort((a, b) => a - b);
        const at = (p) => arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];
        return { p50: at(50), p90: at(90) };
      };
      return { draw: stat(draw), sync: stat(sync) };
    }`;

    const run = async (label, setup, teardown) => {
      const r = await page.evaluate(async ({ setupSrc, frames, measureSrc, teardownSrc }) => {
        const T = window.__SF;
        // eslint-disable-next-line no-new-func
        if (setupSrc) new Function("T", setupSrc)(T);
        for (let i = 0; i < 10; i += 1) T.renderStill();
        // eslint-disable-next-line no-eval
        const out = eval(measureSrc)(frames);
        // eslint-disable-next-line no-new-func
        if (teardownSrc) new Function("T", teardownSrc)(T);
        for (let i = 0; i < 4; i += 1) T.renderStill();
        return out;
      }, { setupSrc: setup, frames: FRAMES, measureSrc: MEASURE, teardownSrc: teardown });
      console.log(`${label.padEnd(24)} draw p50 ${r.draw.p50.toFixed(2).padStart(7)}  sync p50 ${r.sync.p50.toFixed(2).padStart(7)}  p90 ${r.sync.p90.toFixed(2).padStart(7)}`);
      return r;
    };

    console.log(`\n=== cost ladder (each toggle isolated, ${FRAMES} frames) ===`);
    await run("baseline", ``);
    await run("shadow frozen", `T.render.setShadowEvery(1e9);`, `T.render.setShadowEvery(1); T.render.requestShadowUpdate();`);
    await run("ao off", `T.render.setAo(0);`, `T.render.setAo(0.85);`);
    await run("msaa off", `const t=T.render.targets.sceneTarget; t.samples=0; t.dispose();`,
      `const t=T.render.targets.sceneTarget; t.samples=4; t.dispose();`);
    /* setAutoScale(false) FIRST: it resets the scale to 1 as it
       disarms, so the other order silently measures native. */
    await run("renderScale 0.62", `T.render.setAutoScale(false); T.render.setRenderScale(0.62);`,
      `T.render.setRenderScale(1);`);
    await run("sky dome hidden", `
      const d = T.sky && T.sky.dome;
      if (d) { d.userData.__was = d.visible; d.visible = false; }
    `, `
      const d = T.sky && T.sky.dome;
      if (d && d.userData.__was !== undefined) d.visible = d.userData.__was;
    `);
    await run("shadow+ao+msaa off", `
      T.render.setShadowEvery(1e9); T.render.setAo(0);
      const t=T.render.targets.sceneTarget; t.samples=0; t.dispose();
    `, `
      T.render.setShadowEvery(1); T.render.requestShadowUpdate(); T.render.setAo(0.85);
      const t=T.render.targets.sceneTarget; t.samples=4; t.dispose();
    `);
    await run("baseline again", ``);

    await page.close();
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
