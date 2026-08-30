#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the Distaff grounding probe

   A blind critic said the worst thing about this boss is that it
   never touches the ground: "not one of the eight feet casts a
   contact shadow or darkens the surface it lands on ... several leg
   tips visibly terminate in mid-air above the mound".

   A symptom is evidence; the mechanism is a hypothesis, and this
   project's own isolate probe exists because those hypotheses are
   wrong as often as they are right. So before anything is changed:
   measure. For every leg this reports where the IK put the foot BONE,
   where the lowest painted VERTEX of that leg actually ended up, and
   what the height field says the ground is under both. It also
   reports what the sun is doing, because a shadow nobody can see may
   be a shadow that is being cast into the next district.

   Usage:
     node scripts/saintfall-distaff-probe.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 45000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 150; i += 1) {
    try {
      const r = await fetch(`${BASE}/games/saintfall.html`, { cache: "no-store" });
      if (r.ok) return;
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
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--hide-scrollbars", "--mute-audio"],
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    /* The gallery's own query string, verbatim. Without `intro=0` the
       drop cinematic owns the first minute and `isReady` never fires;
       without `cycle=0&time=goldenhour` the probe measures a different
       sun from the one the photographs are taken under, which is the
       whole question here. */
    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`
      + "&time=goldenhour&cycle=0&intro=0",
    { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null,
      { timeout: 300000 });
    await page.evaluate(() => {
      window.__SF.maximize();
      window.__SF.hideHud(true);
    });

    const out = await page.evaluate(() => {
      const T = window.__SF;
      const THREE = T.THREE;
      T.teleportToDistaff(46);
      if (T.advanceToDistaffPhase("standing", 40) < 0) T.forceDistaffPhase("standing", 20);
      T.advanceTime(1.2, 1 / 60);

      const inst = T.ctx.enemies.live.find((e) => e.key === "distaff");
      if (!inst) return { error: "no distaff" };
      const ground = (x, z) => (T.ctx.collide
        ? T.ctx.collide.groundHeight(x, z) : T.ctx.terrain.heightAt(x, z));

      /* The LOWEST SKINNED VERTEX of each leg, which is the number
         the photograph is actually of - the foot bone is an IK target
         and the tarsus and its three claws hang off it. */
      const skin = inst.skin;
      const geo = skin.geometry;
      const pos = geo.attributes.position;
      const si = geo.attributes.skinIndex;
      const sw = geo.attributes.skinWeight;
      const bones = skin.skeleton.bones;
      skin.updateMatrixWorld(true);
      const legLow = new Map();
      const v = new THREE.Vector3();
      const tmp = new THREE.Vector3();
      const acc = new THREE.Vector3();
      const m = new THREE.Matrix4();
      for (let i = 0; i < pos.count; i += 7) {
        let best = 0;
        let bestW = -1;
        for (let k = 0; k < 4; k += 1) {
          const w = sw.getComponent(i, k);
          if (w > bestW) { bestW = w; best = si.getComponent(i, k); }
        }
        const name = bones[best] ? bones[best].name : "";
        const mm = /^(foot|tibia)(\d)_(L|R)$/.exec(name);
        if (!mm) continue;
        v.fromBufferAttribute(pos, i);
        acc.set(0, 0, 0);
        for (let k = 0; k < 4; k += 1) {
          const w = sw.getComponent(i, k);
          if (w <= 0) continue;
          const b = si.getComponent(i, k);
          m.multiplyMatrices(bones[b].matrixWorld, skin.skeleton.boneInverses[b]);
          tmp.copy(v).applyMatrix4(skin.bindMatrix).applyMatrix4(m);
          acc.addScaledVector(tmp, w);
        }
        acc.applyMatrix4(skin.bindMatrixInverse);
        acc.applyMatrix4(skin.matrixWorld);
        const key = `${mm[2]}${mm[3]}`;
        const cur = legLow.get(key);
        if (!cur || acc.y < cur.y) legLow.set(key, { x: acc.x, y: acc.y, z: acc.z });
      }

      const legs = inst.legs.map((leg, i) => {
        leg.toe.updateWorldMatrix(true, false);
        const p = new THREE.Vector3();
        leg.toe.getWorldPosition(p);
        const g = ground(p.x, p.z);
        const key = `${leg.i}${leg.side}`;
        const low = legLow.get(key) || null;
        return {
          i, key,
          stepping: Number((leg.stepping || 0).toFixed(2)),
          toeY: Number(p.y.toFixed(2)),
          groundAtToe: Number(g.toFixed(2)),
          toeGap: Number((p.y - g).toFixed(2)),
          lowVertY: low ? Number(low.y.toFixed(2)) : null,
          lowVertGap: low ? Number((low.y - ground(low.x, low.z)).toFixed(2)) : null,
          plantY: Number(leg.plant.y.toFixed(2)),
          footY: Number(leg.foot.y.toFixed(2)),
        };
      });

      const sun = T.ctx.sky?.sun || null;
      const sd = T.atmos.sunDir;
      return {
        legs,
        castShadow: !!skin.castShadow,
        bodyY: Number(inst.y.toFixed(2)),
        groundUnderBody: Number(ground(inst.x, inst.z).toFixed(2)),
        sunDir: [Number(sd.x.toFixed(3)), Number(sd.y.toFixed(3)), Number(sd.z.toFixed(3))],
        sunElevationDeg: Number((Math.asin(sd.y) * 180 / Math.PI).toFixed(1)),
        sunIntensity: Number(T.atmos.sunIntensity.toFixed(3)),
        shadowSpan: T.ctx.sky?.shadowSpan ?? null,
        shadowMap: sun ? sun.shadow.mapSize.x : null,
        shadowTexelM: sun && T.ctx.sky
          ? Number(((T.ctx.sky.shadowSpan * 2) / sun.shadow.mapSize.x).toFixed(3)) : null,
        shadowsEnabled: !!T.render.renderer.shadowMap.enabled,
        materials: skin.material.length ? skin.material.map((mm) => mm.name) : [skin.material.name],
        tris: geo.index ? geo.index.count / 3 : pos.count / 3,
      };
    });
    console.log(JSON.stringify({ ...out, errors }, null, 2));
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
