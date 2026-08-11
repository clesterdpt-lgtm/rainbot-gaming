#!/usr/bin/env node
/* ============================================================
   BLACKSAND - VFX/vehicle scene-graph diagnostic

   Dumps the flags an image cannot show: which vehicle meshes are in
   the shadow map, what the view scene's environment is, and what the
   decal materials actually are. Text only, no captures.
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 46000 + (process.pid % 6000);
const BASE_URL = `http://127.0.0.1:${PORT}`;

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
      const res = await fetch(`${BASE_URL}/games/blacksand.html`, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium",
      headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
    await page.goto(`${BASE_URL}/games/blacksand.html?qa=1&quality=ultra`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__BS && window.__BS.isReady(), null, { timeout: 180000 });
    await page.evaluate(() => window.__BS.advanceTime(2, 1 / 60));

    const out = await page.evaluate(() => {
      const T = window.__BS;
      const ctx = T.ctx;
      const render = ctx.render;

      const vehicleMeshes = [];
      ctx.vehicles.group.traverse((o) => {
        if (!o.isMesh) return;
        vehicleMeshes.push({
          name: o.name || o.parent?.name || o.type,
          castShadow: o.castShadow,
          receiveShadow: o.receiveShadow,
          visible: o.visible,
          layers: o.layers.mask,
          mat: o.material?.type,
          metalness: o.material?.metalness,
          roughness: o.material?.roughness,
          envInt: o.material?.envMapIntensity,
          hasEnvMap: Boolean(o.material?.envMap),
          vertexColors: o.material?.vertexColors,
          colour: o.material?.color?.getHexString?.(),
        });
      });

      const byShadow = { cast: 0, noCast: 0 };
      for (const m of vehicleMeshes) (m.castShadow ? byShadow.cast++ : byShadow.noCast++);

      const sun = render.sun;
      const vmMats = [];
      render.viewScene.traverse((o) => {
        if (!o.isMesh) return;
        vmMats.push({
          name: o.parent?.name || o.name,
          mat: o.material?.type,
          metal: o.material?.metalness,
          rough: o.material?.roughness,
          envInt: o.material?.envMapIntensity,
          hasEnvMap: Boolean(o.material?.envMap),
          hasMap: Boolean(o.material?.map),
          hasNormal: Boolean(o.material?.normalMap),
          colour: o.material?.color?.getHexString?.(),
        });
      });

      const decal = ctx.vfx.group.children
        .filter((c) => c.isInstancedMesh)
        .map((c) => ({
          type: c.material.type,
          blending: c.material.blending,
          transparent: c.material.transparent,
          depthWrite: c.material.depthWrite,
          polygonOffset: c.material.polygonOffset,
          offsetFactor: c.material.polygonOffsetFactor,
          toneMapped: c.material.toneMapped,
          count: c.count,
          capacity: c.instanceMatrix.count,
        }));

      return {
        quality: ctx.settings.tier,
        qShadows: ctx.settings.q.shadows,
        sceneEnvironment: Boolean(render.scene.environment),
        sceneEnvIntensity: render.scene.environmentIntensity,
        viewSceneEnvironment: Boolean(render.viewScene.environment),
        viewSceneEnvIntensity: render.viewScene.environmentIntensity,
        viewSceneBackground: String(render.viewScene.background),
        sun: sun ? {
          castShadow: sun.castShadow,
          intensity: sun.intensity,
          mapSize: [sun.shadow.mapSize.x, sun.shadow.mapSize.y],
          cam: {
            left: sun.shadow.camera.left, right: sun.shadow.camera.right,
            top: sun.shadow.camera.top, bottom: sun.shadow.camera.bottom,
            near: sun.shadow.camera.near, far: sun.shadow.camera.far,
          },
          pos: sun.position.toArray().map((n) => Number(n.toFixed(1))),
          targetPos: sun.target.position.toArray().map((n) => Number(n.toFixed(1))),
        } : null,
        shadowMapEnabled: render.renderer.shadowMap.enabled,
        vehicleMeshCount: vehicleMeshes.length,
        byShadow,
        vehicleMeshes: vehicleMeshes.slice(0, 24),
        viewmodelMaterials: vmMats,
        vfxMeshes: decal,
      };
    });

    console.log(JSON.stringify(out, null, 2));

    /* ---- is the vehicle actually in the shadow caster pass? ----
       No image statistic answers this. Render the same frame twice,
       once with the vehicle's castShadow flags on and once off, and
       diff the pixels: if the frames are identical the meshes are not
       reaching the shadow map, whatever their flags say. */
    const ab = await page.evaluate(() => {
      const T = window.__BS;
      const V = T.ctx.vehicles;
      const P = T.ctx.player;
      const v = V.vehicles.find((k) => k.type === "jeep" && k.alive);
      if (!v) return null;
      for (const o of v.occupants.slice()) V.exit(v, o);
      const x = P.position.x + 8;
      const z = P.position.z + 8;
      v.position.set(x, T.heightAt(x, z) + 1.1, z);
      v.velocity.set(0, 0, 0);
      v.asleep = false;
      T.setTimeOfDay(16.6);
      T.advanceTime(2.0, 1 / 60);
      // Look down at the ground beside it from above, wide enough that
      // a 12m shadow cannot fall outside frame.
      T.lookAt([x - 10, v.position.y + 11, z + 10], [x + 3, v.position.y - 1, z - 3], 60);
      for (let i = 0; i < 8; i += 1) T.renderOnce(1 / 60);
      const withShadow = T.captureDataURL();

      const flags = [];
      V.group.traverse((o) => { if (o.isMesh) { flags.push([o, o.castShadow]); o.castShadow = false; } });
      for (let i = 0; i < 8; i += 1) T.renderOnce(1 / 60);
      const without = T.captureDataURL();
      for (const [o, f] of flags) o.castShadow = f;
      for (let i = 0; i < 4; i += 1) T.renderOnce(1 / 60);

      // Also ask three's own frustum whether the shadow camera sees it.
      const THREE = T.THREE;
      const sun = T.ctx.render.sun;
      sun.shadow.updateMatrices(sun);
      const frustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(
          sun.shadow.camera.projectionMatrix, sun.shadow.camera.matrixWorldInverse)
      );
      let inFrustum = 0;
      let meshes = 0;
      V.group.traverse((o) => {
        if (!o.isMesh) return;
        meshes += 1;
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        if (frustum.intersectsObject(o)) inFrustum += 1;
      });
      return {
        withShadow, without, meshes, inFrustum,
        jeep: v.position.toArray().map((n) => Number(n.toFixed(1))),
        sunPos: sun.position.toArray().map((n) => Number(n.toFixed(1))),
      };
    });

    if (ab) {
      const toBuf = (u) => Buffer.from(u.slice(u.indexOf(",") + 1), "base64");
      const [a, b] = await Promise.all([
        sharp(toBuf(ab.withShadow)).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
        sharp(toBuf(ab.without)).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
      ]);
      let diff = 0;
      let changed = 0;
      for (let i = 0; i < a.data.length; i += 1) {
        const d = Math.abs(a.data[i] - b.data[i]);
        diff += d;
        if (d > 4) changed += 1;
      }
      await writeFile("output/blacksand-shots/shadow-ab-on.png", toBuf(ab.withShadow));
      await writeFile("output/blacksand-shots/shadow-ab-off.png", toBuf(ab.without));
      console.log(JSON.stringify({
        shadowAB: {
          meanAbsDiff: Number((diff / a.data.length).toFixed(3)),
          changedPixelsPct: Number(((changed / a.data.length) * 100).toFixed(3)),
          meshes: ab.meshes,
          inShadowFrustum: ab.inFrustum,
          jeep: ab.jeep,
          sunPos: ab.sunPos,
          verdict: changed / a.data.length > 0.001
            ? "vehicles DO cast shadows"
            : "vehicles do NOT reach the shadow map",
        },
      }, null, 2));
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
