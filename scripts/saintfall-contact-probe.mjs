#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the contact probe

   The art review's number one finding was "no occlusion darkening at
   contact - at any scale", in three tiers: plate-on-plate OVERLAP,
   creature-on-GROUND, and EMISSIVE elements lighting nothing around
   them. The AO pass had just been widened and then banked, and the
   finding did not move. This measures which of the three tiers is
   actually reaching the frame, in CODE VALUES, so the next round
   argues about numbers instead of about intentions.

   Why a bespoke probe rather than reading the gallery: the gallery
   photographs one composited frame per framing and every term in the
   chain is already baked into it. A contact term that is present but
   worth half a code value and a contact term that is absent produce
   the same picture and the same statistics. The only way to tell them
   apart is a PAIR - the same frame with the term on and off, pixel
   registered - plus the intermediate buffer the term is computed in.

   What is deliberately fixed, and why:

   - ONE SESSION, ONE CAMERA, ONE POSE. Everything is toggled through
     `render.setAo` / `render.setBounce`, never through a git stash,
     so the two frames differ by the uniform and by nothing else. If
     the pair is identical the term is inert, and that is a result.

   - THE SUBJECT STANDS ON FLAT SAND. `findFlatSite` is the stage the
     rest of this project reviews creatures on. A boss photographed
     where it fights is photographed on whatever slope the fight left
     it on, and a ground-contact measurement on a 20-degree face is
     measuring the slope.

   - THE DRAW HAPPENS INSIDE A rAF. `page.screenshot` reads the
     COMPOSITED page; a canvas drawn from a bare evaluate is one
     composite behind, which is how a registered pair silently comes
     back off by one.

   - THREE DISTANCES. The AO disc is a WORLD radius projected into
     pixels, so its authority is a function of range and a term that
     is strong in a 6 m portrait can be entirely gone at the 20 m the
     fight is actually played at. Reporting one distance is how a
     pass gets signed off that nobody can see in play.

   Usage:
     node scripts/saintfall-contact-probe.mjs
     node scripts/saintfall-contact-probe.mjs --species distaff,cantor
     node scripts/saintfall-contact-probe.mjs --out output/saintfall/contact-probe
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith("--")) { out._.push(t); continue; }
    const k = t.slice(2);
    const n = argv[i + 1];
    if (n === undefined || n.startsWith("--")) out[k] = true;
    else { out[k] = n; i += 1; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const OUT = path.resolve(root, args.out || "output/saintfall/contact-probe");
const SPECIES = String(args.species || "distaff,cantor").split(",");
const WIDTH = Number(args.width || 1280);
const HEIGHT = Number(args.height || 720);
// Pid-derived, like every other harness here: several agents run this
// tree at once and a fixed port is a fight over a socket.
const PORT = Number(args.port || 47300 + (process.pid % 2000));
const BASE = `http://127.0.0.1:${PORT}`;
const QUERY = "qa=1&quality=high&time=goldenhour&cycle=0&intro=0";

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

/* --- image maths, on raw RGB the harness never re-encodes --- */

async function raw(buf) {
  const img = sharp(buf).removeAlpha().raw();
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

const lumaAt = (r, x, y) => {
  const i = (y * r.w + x) * 3;
  return 0.2126 * r.data[i] + 0.7152 * r.data[i + 1] + 0.0722 * r.data[i + 2];
};

/** Percentiles of one channel over a rectangle, in code values. */
function stats(r, box) {
  const v = [];
  const x0 = Math.max(0, box.x0 | 0);
  const x1 = Math.min(r.w - 1, box.x1 | 0);
  const y0 = Math.max(0, box.y0 | 0);
  const y1 = Math.min(r.h - 1, box.y1 | 0);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) v.push(lumaAt(r, x, y));
  }
  if (!v.length) return null;
  v.sort((a, b) => a - b);
  const p = (q) => v[Math.min(v.length - 1, Math.max(0, Math.round(q * (v.length - 1))))];
  return {
    n: v.length,
    min: Number(p(0).toFixed(2)),
    p01: Number(p(0.01).toFixed(2)),
    p05: Number(p(0.05).toFixed(2)),
    p50: Number(p(0.5).toFixed(2)),
    mean: Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)),
  };
}

/** Per-pixel luma difference between a pair, over the whole frame. */
function diff(a, b) {
  const n = Math.min(a.w * a.h, b.w * b.h);
  let maxd = 0;
  let sum = 0;
  let over1 = 0;
  let over4 = 0;
  const all = [];
  for (let i = 0; i < n; i += 1) {
    const x = i % a.w;
    const y = (i / a.w) | 0;
    const d = lumaAt(a, x, y) - lumaAt(b, x, y);
    const ad = Math.abs(d);
    if (ad > maxd) maxd = ad;
    sum += ad;
    if (ad >= 1) over1 += 1;
    if (ad >= 4) over4 += 1;
    all.push(ad);
  }
  all.sort((x, y) => x - y);
  return {
    maxDelta: Number(maxd.toFixed(2)),
    meanDelta: Number((sum / n).toFixed(3)),
    p99Delta: Number(all[Math.round(0.99 * (all.length - 1))].toFixed(2)),
    pctOver1: Number(((100 * over1) / n).toFixed(2)),
    pctOver4: Number(((100 * over4) / n).toFixed(2)),
  };
}

/** An amplified visualisation of a pair's difference, so a delta the
 *  statistics call small can still be LOOKED at. */
async function diffPng(a, b, file, gain = 12) {
  const n = a.w * a.h;
  const out = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i += 1) {
    const x = i % a.w;
    const y = (i / a.w) | 0;
    const d = (lumaAt(a, x, y) - lumaAt(b, x, y)) * gain;
    // Red = the pair got darker with the term on, cyan = brighter.
    const dark = Math.max(0, Math.min(255, -d));
    const light = Math.max(0, Math.min(255, d));
    out[i * 3] = dark;
    out[i * 3 + 1] = light;
    out[i * 3 + 2] = light;
  }
  await sharp(out, { raw: { width: a.w, height: a.h, channels: 3 } })
    .png().toFile(file);
}

try {
  await mkdir(OUT, { recursive: true });
  for (let i = 0; i < 300; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${BASE}/games/saintfall.html?${QUERY}`,
    { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    document.getElementById("sf-boot")?.remove();
    T.hideHud(true);
    T.setTime("goldenhour");
    T.hidePlayer(true);
    window.__cp = {
      /* WORLD bounds walked off the skinned vertices, not
         Box3.setFromObject. qa.js's `_scaleRaw` learned that the hard
         way: three computes the box from already-skinned vertices and
         then applies the world matrix on top of them again, so the
         numbers come back 40-180% high and every statistic measured
         inside that box is a statistic about sand. */
      bounds(idx) {
        const T2 = window.__SF;
        const THREE = T2.ctx.THREE;
        const inst = T2.enemies.live[idx];
        let mesh = null;
        inst.root.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
        if (!mesh) return null;
        inst.root.updateMatrixWorld(true);
        const v = new THREE.Vector3();
        const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
        const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
        const n = mesh.geometry.attributes.position.count;
        for (let i = 0; i < n; i += 1) {
          mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
          lo.min(v); hi.max(v);
        }
        return { lo: lo.toArray(), hi: hi.toArray() };
      },
      /* The subject's screen-space box, projected from those bounds. */
      box(idx) {
        const T2 = window.__SF;
        const THREE = T2.ctx.THREE;
        const cam = T2.render.camera;
        const b = window.__cp.bounds(idx);
        const pts = [];
        for (let i = 0; i < 8; i += 1) {
          const v = new THREE.Vector3(
            i & 1 ? b.hi[0] : b.lo[0],
            i & 2 ? b.hi[1] : b.lo[1],
            i & 4 ? b.hi[2] : b.lo[2]
          );
          v.project(cam);
          pts.push(v);
        }
        const cv = T2.canvasSize();
        const xs = pts.map((p) => (p.x * 0.5 + 0.5) * cv.width);
        const ys = pts.map((p) => (0.5 - p.y * 0.5) * cv.height);
        return {
          x0: Math.min(...xs), x1: Math.max(...xs),
          y0: Math.min(...ys), y1: Math.max(...ys),
          footY: Math.max(...ys), cw: cv.width, ch: cv.height,
        };
      },
      /* The camera is placed from the subject's MEASURED height, at a
         bearing that keeps the low sun raking across it rather than
         behind it - a contact shadow shot into the sun is a
         silhouette, which is a different picture. */
      aim(idx, dist, fov) {
        const T2 = window.__SF;
        const b = window.__cp.bounds(idx);
        const cx = (b.lo[0] + b.hi[0]) * 0.5;
        const cz = (b.lo[2] + b.hi[2]) * 0.5;
        const h = b.hi[1] - b.lo[1];
        const a = 2.2;
        T2.lookAt(
          [cx + Math.cos(a) * dist, b.lo[1] + h * 0.55, cz + Math.sin(a) * dist],
          [cx, b.lo[1] + h * 0.35, cz], fov || 42
        );
        for (let i = 0; i < 4; i += 1) T2.renderOnce(0);
        return { h: Number(h.toFixed(2)), dist };
      },
    };
  });

  const drawAndShot = async (file) => {
    await page.evaluate(() => new Promise((res) => {
      requestAnimationFrame(() => {
        window.__SF.renderOnce(0);
        requestAnimationFrame(() => res(true));
      });
    }));
    const buf = await page.screenshot();
    await writeFile(file, buf);
    return raw(buf);
  };

  const blitAndShot = async (which, file) => {
    await page.evaluate((w) => new Promise((res) => {
      requestAnimationFrame(() => {
        window.__SF.renderOnce(0);
        window.__SF.render.debugBlit(w);
        requestAnimationFrame(() => res(true));
      });
    }), which);
    const buf = await page.screenshot();
    await writeFile(file, buf);
    return raw(buf);
  };

  const report = { species: {}, errors: [] };

  for (const key of SPECIES) {
    const spawned = await page.evaluate((k) => {
      const T = window.__SF;
      T.clearEnemies();
      const site = T.findFlatSite(9);
      const inst = T.spawnEnemy(k, site[0], site[1], {});
      if (!inst) return null;
      T.freezeEnemyClip("idle", 0.4, 0);
      for (let i = 0; i < 8; i += 1) T.renderOnce(1 / 60);
      return { key: inst.key, site: [site[0], site[1], site[2]] };
    }, key);
    if (!spawned) { report.errors.push(`spawn failed: ${key}`); continue; }

    const perDist = {};
    for (const dist of [6, 18, 45]) {
      const view = await page.evaluate((d) => window.__cp.aim(0, d, 42), dist);
      const box = await page.evaluate(() => window.__cp.box(0));

      // AO on, bounce on: the shipped frame.
      await page.evaluate(() => { window.__SF.render.setAo(0.85); });
      const on = await drawAndShot(path.join(OUT, `${key}-${dist}m-on.png`));
      // AO off. Same frame, one uniform apart.
      await page.evaluate(() => { window.__SF.render.setAo(0); });
      const off = await drawAndShot(path.join(OUT, `${key}-${dist}m-off.png`));
      await page.evaluate(() => { window.__SF.render.setAo(0.85); });

      const ao = await blitAndShot("ao", path.join(OUT, `${key}-${dist}m-aobuf.png`));
      await diffPng(on, off, path.join(OUT, `${key}-${dist}m-aodiff.png`));

      /* The three regions the finding names, each measured where it
         lives rather than over the whole frame:
         - BODY: the subject's own box, which is where overlap cavity
           has to appear.
         - CONTACT: a shallow band of GROUND under the subject, one
           tenth of the subject's screen height deep. This is the
           band a cast shadow and a contact darkening both land in.
         - OPEN: the same band of ground, displaced sideways by a full
            subject width, which nothing is standing on. It is the
            control: the contact band has to be DARKER than this or
            there is no contact. */
      const bw = box.x1 - box.x0;
      const bh = box.y1 - box.y0;
      const band = Math.max(3, bh * 0.10);
      /* The control band goes to whichever side of the subject the
         frame actually has room on. Fixed to the right, it walked off
         the edge at the close framing and the whole comparison came
         back null - a probe that silently measures nothing is the
         failure mode this file exists to catch. */
      const room = on.w - box.x1;
      const shift = room > box.x0 ? Math.min(bw * 1.25, room - bw - 4)
        : -Math.min(bw * 1.25, box.x0 - 4);
      const regions = {
        body: { x0: box.x0, x1: box.x1, y0: box.y0, y1: box.y0 + bh * 0.75 },
        contact: { x0: box.x0, x1: box.x1, y0: box.footY - band * 0.2, y1: box.footY + band },
        open: {
          x0: box.x0 + shift, x1: box.x1 + shift,
          y0: box.footY - band * 0.2, y1: box.footY + band,
        },
      };

      const out = { view, box, imgW: on.w, imgH: on.h, regions, aoBuffer: {}, sceneOn: {}, sceneOff: {}, delta: {} };
      for (const [name, rect] of Object.entries(regions)) {
        out.aoBuffer[name] = stats(ao, rect);
        out.sceneOn[name] = stats(on, rect);
        out.sceneOff[name] = stats(off, rect);
      }
      if (!out.sceneOn.open || !out.sceneOn.contact) {
        report.errors.push(`${key} ${dist}m: a region fell outside the frame`);
        perDist[`${dist}m`] = out;
        continue;
      }
      out.delta.frame = diff(on, off);
      /* The headline number: how many CODE VALUES darker the ground
         directly under the animal is than open ground at the same
         range and the same grade. If this is under about two, no
         viewer will see a contact however the buffer looks. */
      out.delta.contactVsOpenOn =
        Number((out.sceneOn.open.mean - out.sceneOn.contact.mean).toFixed(2));
      out.delta.contactVsOpenOff =
        Number((out.sceneOff.open.mean - out.sceneOff.contact.mean).toFixed(2));
      out.delta.aoAttributableContact =
        Number((out.delta.contactVsOpenOn - out.delta.contactVsOpenOff).toFixed(2));
      perDist[`${dist}m`] = out;
    }
    report.species[key] = { spawned, dists: perDist };
  }

  report.errors.push(...errors.slice(0, 20));
  await writeFile(path.join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
} finally {
  server.kill();
}
