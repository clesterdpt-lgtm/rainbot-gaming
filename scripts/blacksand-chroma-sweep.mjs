#!/usr/bin/env node
/* ============================================================
   BLACKSAND - colour-balance sweep

   blacksand-chroma-compare.mjs says WHERE our colour sits against
   Battlefield 2's. This says what moves it, by A/B-ing candidate
   values of the constants that own it - including the ones baked into
   the shader as string literals, which no runtime uniform can reach.

   How a variant is applied: Playwright intercepts the module request
   and string-replaces the constant in the response. Nothing is written
   to the repo, so a sweep cannot leave a half-applied edit behind, and
   a failed candidate costs one page load rather than one commit.

   Two things the sweep does that a per-variant screenshot run cannot:

   * The camera framings are solved ONCE, on the first variant, and
     then reused verbatim. blacksand-shots.mjs re-solves them per run
     by measured frame contrast, so a colour change can move the camera
     and the comparison stops being like-for-like.

   * Every variant is measured through the same crop and the same
     two-means split as blacksand-chroma-compare.mjs, so the numbers
     printed here are the numbers that tool will print afterwards.

   Usage:
     node scripts/blacksand-chroma-sweep.mjs                 # the shipped set
     node scripts/blacksand-chroma-sweep.mjs --albedo        # texture hue census only
     node scripts/blacksand-chroma-sweep.mjs --plan plan.json
   ============================================================ */

import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
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
const PORT = Number(args.port || 46500 + (process.pid % 3000));
const BASE = `http://127.0.0.1:${PORT}`;
const GAME_URL = `${BASE}/games/blacksand.html?qa=1&quality=${args.quality || "ultra"}`;
const WIDTH = Number(args.width || 1280);
const HEIGHT = Number(args.height || 720);

/* --------------- measurement (chroma-compare's maths) --------------- */

const CROP = { x0: 0.06, x1: 0.94, y0: 0.46, y1: 0.94 };
const toLinear = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
function satOf(r, g, b) {
  const mx = Math.max(r, g, b);
  return mx > 1e-6 ? (mx - Math.min(r, g, b)) / mx : 0;
}
function hueOf(r, g, b) {
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const d = mx - mn;
  if (d < 1e-6) return 0;
  let h;
  if (mx === r) h = 60 * (((g - b) / d) % 6);
  else if (mx === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return h < 0 ? h + 360 : h;
}

async function measureBuffer(buf) {
  const meta = await sharp(buf).metadata();
  const { data } = await sharp(buf)
    .extract({
      left: Math.round(meta.width * CROP.x0),
      top: Math.round(meta.height * CROP.y0),
      width: Math.round(meta.width * (CROP.x1 - CROP.x0)),
      height: Math.round(meta.height * (CROP.y1 - CROP.y0)),
    })
    .resize(360, 140, { fit: "cover" })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });

  const px = [];
  let sum = 0; let sumSq = 0; let colourful = 0; let dark = 0; let bright = 0;
  for (let i = 0; i < data.length; i += 3) {
    const R = data[i]; const G = data[i + 1]; const B = data[i + 2];
    const l8 = R * 0.2126 + G * 0.7152 + B * 0.0722;
    sum += l8; sumSq += l8 * l8;
    colourful += Math.max(R, G, B) - Math.min(R, G, B);
    if (l8 < 26) dark += 1;
    if (l8 > 229) bright += 1;
    const r = toLinear(R); const g = toLinear(G); const b = toLinear(B);
    px.push([r, g, b, 0.2126 * r + 0.7152 * g + 0.0722 * b]);
  }
  const n = px.length;
  const lum = px.map((p) => p[3]).sort((a, b) => a - b);
  let lo = lum[Math.floor(0.2 * n)];
  let hi = lum[Math.floor(0.8 * n)];
  const L = (v) => Math.log(v + 1e-5);
  for (let it = 0; it < 30; it += 1) {
    let sl = 0; let nl = 0; let sh = 0; let nh = 0;
    for (const p of px) {
      if (Math.abs(L(p[3]) - L(lo)) < Math.abs(L(p[3]) - L(hi))) { sl += p[3]; nl += 1; }
      else { sh += p[3]; nh += 1; }
    }
    if (nl) lo = sl / nl;
    if (nh) hi = sh / nh;
  }
  const side = (wantShade) => {
    let s = 0; let hx = 0; let hy = 0; let k = 0;
    for (const p of px) {
      const isShade = Math.abs(L(p[3]) - L(lo)) < Math.abs(L(p[3]) - L(hi));
      if (isShade !== wantShade) continue;
      const st = satOf(p[0], p[1], p[2]);
      const h = (hueOf(p[0], p[1], p[2]) * Math.PI) / 180;
      s += st; hx += Math.cos(h) * st; hy += Math.sin(h) * st; k += 1;
    }
    if (!k) return { s: 0, h: 0 };
    let h = (Math.atan2(hy, hx) * 180) / Math.PI;
    if (h < 0) h += 360;
    return { s: s / k, h };
  };
  const lit = side(false); const shade = side(true);
  const mean = sum / n;

  /* Detail lives on the same split - see blacksand-detail-split.mjs.
     Measured here too because the transfer curve moves colour and
     texture together: whatever compresses chroma at the top of the
     range compresses the ripple with it, and a change that fixes one
     while breaking the other is not a fix. */
  const det = await detailSplit(buf);

  /* Tonal spread INSIDE the lit population - see
     blacksand-clip-probe.mjs. Measured on the same two-means split and
     the same resampled crop as the chroma numbers above, which narrows
     an IQR relative to that probe's larger raster - so compare
     movement between rows here, and read absolute IQR off the probe. */
  const g8 = [];
  let topCount2 = 0;
  for (let i = 0; i < data.length; i += 3) {
    const R = data[i]; const G = data[i + 1]; const B = data[i + 2];
    const p = px[i / 3];
    const isShade = Math.abs(L(p[3]) - L(lo)) < Math.abs(L(p[3]) - L(hi));
    if (isShade) continue;
    if (Math.max(R, G, B) >= 253) topCount2 += 1;
    g8.push(R * 0.2126 + G * 0.7152 + B * 0.0722);
  }
  g8.sort((a, b) => a - b);
  const q = (t) => (g8.length ? g8[Math.min(g8.length - 1, Math.floor(t * g8.length))] : 0);
  const litIqr = q(0.75) - q(0.25);
  const litRatio = q(0.99) / Math.max(q(0.5), 1e-3);
  const top2 = g8.length ? (100 * topCount2) / g8.length : 0;

  return {
    litS: lit.s, litH: lit.h, shadeS: shade.s, shadeH: shade.h,
    satRatio: lit.s / Math.max(shade.s, 1e-4),
    litD: det.litD, shadeD: det.shadeD, detRatio: det.ratio,
    litIqr, litRatio, top2,
    meanLuma: mean,
    sd: Math.sqrt(Math.max(0, sumSq / n - mean * mean)),
    saturation: colourful / n,
    darkPct: (dark / n) * 100,
    brightPct: (bright / n) * 100,
  };
}

const DW = 520; const DH = 240;

/** High-pass energy inside each population, normalised by that
 *  population's own mean. Same maths as blacksand-detail-split.mjs. */
async function detailSplit(buf) {
  const meta = await sharp(buf).metadata();
  const { data } = await sharp(buf)
    .extract({
      left: Math.round(meta.width * CROP.x0),
      top: Math.round(meta.height * CROP.y0),
      width: Math.round(meta.width * (CROP.x1 - CROP.x0)),
      height: Math.round(meta.height * (CROP.y1 - CROP.y0)),
    })
    .resize(DW, DH, { fit: "fill" })
    .greyscale().raw().toBuffer({ resolveWithObject: true });

  const lin = new Float64Array(DW * DH);
  for (let i = 0; i < lin.length; i += 1) lin[i] = toLinear(data[i]);
  const sorted = Array.from(lin).sort((a, b) => a - b);
  let lo = sorted[Math.floor(0.2 * sorted.length)];
  let hi = sorted[Math.floor(0.8 * sorted.length)];
  const L = (v) => Math.log(v + 1e-5);
  for (let it = 0; it < 30; it += 1) {
    let sl = 0; let nl = 0; let sh = 0; let nh = 0;
    for (let i = 0; i < lin.length; i += 1) {
      if (Math.abs(L(lin[i]) - L(lo)) < Math.abs(L(lin[i]) - L(hi))) { sl += lin[i]; nl += 1; }
      else { sh += lin[i]; nh += 1; }
    }
    if (nl) lo = sl / nl;
    if (nh) hi = sh / nh;
  }
  const isShade = new Uint8Array(DW * DH);
  for (let i = 0; i < lin.length; i += 1) {
    isShade[i] = Math.abs(L(lin[i]) - L(lo)) < Math.abs(L(lin[i]) - L(hi)) ? 1 : 0;
  }
  const acc = { lit: { e: 0, n: 0, m: 0 }, shade: { e: 0, n: 0, m: 0 } };
  for (let y = 1; y < DH - 1; y += 1) {
    for (let x = 1; x < DW - 1; x += 1) {
      const i = y * DW + x;
      const s = isShade[i];
      if (isShade[i - 1] !== s || isShade[i + 1] !== s
        || isShade[i - DW] !== s || isShade[i + DW] !== s) continue;
      const lap = 4 * lin[i] - lin[i - 1] - lin[i + 1] - lin[i - DW] - lin[i + DW];
      const t = s ? acc.shade : acc.lit;
      t.e += Math.abs(lap); t.m += lin[i]; t.n += 1;
    }
  }
  if (acc.lit.n < 500 || acc.shade.n < 500) return { litD: 0, shadeD: 0, ratio: 0 };
  const litD = (acc.lit.e / acc.lit.n) / Math.max(acc.lit.m / acc.lit.n, 1e-5);
  const shadeD = (acc.shade.e / acc.shade.n) / Math.max(acc.shade.m / acc.shade.n, 1e-5);
  return { litD, shadeD, ratio: litD / Math.max(shadeD, 1e-6) };
}

const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
function summarise(rows) {
  const keys = ["litS", "litH", "shadeS", "shadeH", "satRatio",
    "litD", "shadeD", "detRatio", "litIqr", "litRatio", "top2",
    "meanLuma", "sd", "saturation", "darkPct", "brightPct"];
  const out = {};
  for (const k of keys) out[k] = med(rows.map((r) => r[k]));
  const dhs = rows.map((r) => {
    let d = r.shadeH - r.litH;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  });
  out.dHue = med(dhs);
  return out;
}

/* -------------------------- the reference -------------------------- */

async function reference() {
  const dir = path.resolve(root, "output/reference/bf2");
  const files = (await readdir(dir))
    .filter((f) => /\.(png|jpe?g)$/i.test(f) && !f.startsWith("_")).sort();
  const rows = [];
  for (const f of files) rows.push(await measureBuffer(await readFile(path.join(dir, f))));
  return summarise(rows);
}

/* ---------------------------- harness ---------------------------- */

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
      const res = await fetch(`${BASE}/games/blacksand.html`, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

/**
 * Serve `assets/js/blacksand/*.js` with per-variant substitutions.
 *
 * A missing `from` is a hard failure rather than a silent no-op: a
 * sweep whose edit did not apply prints "no change" and looks like a
 * disproved hypothesis, which is the most expensive way this can go
 * wrong.
 */
/* The route pattern is a REGEX, not a glob. boot.js pins every module
   through the import map as `sky.js?v=<BUILD>`, and a Playwright glob
   of `*.js` stops matching the moment a query string is appended - so
   a glob route silently never fires and every variant renders the
   shipped source. That failure mode prints a clean table of identical
   numbers, which reads exactly like "the hypothesis is disproved". */
const MODULE_RE = /\/assets\/js\/blacksand\/[a-z0-9_-]+\.js(\?|$)/i;

async function installRewrite(page, edits) {
  await page.unroute(MODULE_RE).catch(() => {});
  if (!edits || !edits.length) return;
  let applied = 0;
  await page.route(MODULE_RE, async (route) => {
    const url = new URL(route.request().url());
    const file = path.basename(url.pathname);
    const mine = edits.filter((e) => e.file === file);
    if (!mine.length) return route.fallback();
    applied += 1;
    let body = await readFile(path.join(root, "assets/js/blacksand", file), "utf8");
    for (const e of mine) {
      if (body.indexOf(e.from) < 0) {
        throw new Error(`rewrite anchor not found in ${file}: ${JSON.stringify(e.from)}`);
      }
      body = body.split(e.from).join(e.to);
    }
    return route.fulfill({ status: 200, contentType: "text/javascript", body });
  });
  return () => applied;
}

async function bootPage(context, edits) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const appliedCount = await installRewrite(page, edits);
  await page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__BS && window.__BS.isReady(), null, { timeout: 180000 });
  await page.evaluate(() => {
    window.__BS.maximize();
    window.__BS.hideHud(true);
    window.__BS.hideViewmodel(true);
    const el = document.getElementById("bs-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
  await page.evaluate(() => { for (let i = 0; i < 20; i += 1) window.__BS.renderOnce(1 / 60); });
  await page.evaluate(() => window.__BS.advanceTime(3, 1 / 60));
  page.__bsErrors = errors;
  const files = new Set((edits || []).map((e) => e.file)).size;
  if (files && appliedCount() < files) {
    throw new Error(`variant edits never reached the browser `
      + `(${appliedCount()} of ${files} module(s) intercepted) - the route did not match`);
  }
  return page;
}

const grab = async (page) => {
  const url = await page.evaluate(() => window.__BS.captureDataURL());
  return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
};

/**
 * Solve each pose's camera the way blacksand-shots.mjs does, once, and
 * return fixed eye/target/fov triples. Every variant then renders the
 * identical framing - otherwise a colour change nudges the contrast
 * search onto a different candidate and the A/B compares two pictures.
 */
async function solveFramings(page) {
  const ids = await page.evaluate(() => window.__BS.listPoses().map((p) => p.id));
  const out = [];
  for (const id of ids) {
    await page.evaluate((i) => window.__BS.setPose(i), id);
    await page.evaluate(() => window.__BS.advanceTime(3.0, 1 / 60));
    const plan = await page.evaluate((i) => {
      const T = window.__BS; const THREE = T.THREE;
      const pose = T.ctx.world.getBeautyShots().find((p) => p.id === i);
      if (!pose || !pose.position || !pose.target) return null;
      const eye = new THREE.Vector3().fromArray(pose.position);
      const at = new THREE.Vector3().fromArray(pose.target);
      const fwd = at.clone().sub(eye).normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
      const terrain = T.ctx.terrain;
      const aboveGround = (v) => v.y > terrain.heightAt(v.x, v.z) + 1.4;
      const cands = [{ p: eye.toArray(), base: true }];
      for (const d of [1.5, 3.5, 7]) {
        for (const [rx, uy, fz] of [
          [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0.6, -1], [0.7, 0.5, 0], [-0.7, 0.5, 0],
        ]) {
          const c = eye.clone().addScaledVector(right, rx * d)
            .addScaledVector(up, uy * d).addScaledVector(fwd, fz * d);
          if (aboveGround(c)) cands.push({ p: c.toArray(), base: false });
        }
      }
      return { cands, target: pose.target, fov: pose.fov, timeOfDay: pose.timeOfDay };
    }, id);
    if (!plan) continue;
    let base = null; let best = null;
    for (const c of plan.cands) {
      const clear = await page.evaluate((a) => {
        window.__BS.lookAt(a.p, a.t, a.fov);
        for (let i = 0; i < 2; i += 1) window.__BS.renderOnce(1 / 60);
        return window.__BS.cameraClearance().nearest;
      }, { p: c.p, t: plan.target, fov: plan.fov });
      const { data } = await sharp(await grab(page)).greyscale().resize(160, 90).raw()
        .toBuffer({ resolveWithObject: true });
      let s = 0;
      for (let i = 0; i < data.length; i += 1) s += data[i];
      const mean = s / data.length;
      let v = 0;
      for (let i = 0; i < data.length; i += 1) v += (data[i] - mean) ** 2;
      const contrast = Math.sqrt(v / data.length);
      const rec = { ...c, clear: clear === null ? 999 : clear, contrast };
      if (c.base) { base = rec; if (rec.clear >= 2.5) break; }
      else if (base && rec.clear > base.clear * 1.2 && contrast >= base.contrast * 0.95) {
        if (!best || contrast > best.contrast) best = rec;
      }
    }
    const pick = best || base;
    out.push({ id, p: pick.p, t: plan.target, fov: plan.fov });
  }
  return out;
}

/* Gameplay framing, identical to blacksand-gameplay-shots.mjs: stand
   the player on the ground 14m back along each beauty pose's view ray,
   weapon in hand. The free-camera beauty poses are dominated by
   DISTANT terrain, which is smooth because of mip filtering and haze
   rather than because of anything the grade did - measuring a palette
   through them confounds the two. */
async function runGameplay(page, poses, gradePatch) {
  const rows = [];
  const STANCES = ["hip", "ads", "hip", "sprint", "ads", "hip", "crouch",
    "ads", "hip", "hip", "ads", "crouch", "hip"];
  for (let i = 0; i < poses.length; i += 1) {
    const pose = poses[i];
    await page.evaluate(({ p, st }) => {
      const T = window.__BS;
      const c = T.ctx;
      T.releaseCamera();
      T.hideHud(true);
      if (c.viewmodel && c.viewmodel.setVisible) c.viewmodel.setVisible(true);
      const dx = p.target[0] - p.position[0];
      const dz = p.target[2] - p.position[2];
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len; const uz = dz / len;
      const sx = p.target[0] - ux * 14;
      const sz = p.target[2] - uz * 14;
      T.teleport(sx, T.heightAt(sx, sz) + 1.2, sz);
      c.player.state.yaw = Math.atan2(-ux, -uz);
      c.player.state.pitch = -0.06;
      const input = T.input;
      input.injectMove(0, st === "sprint" ? -1 : 0);
      if (st === "sprint") input.press("sprint"); else input.release("sprint");
      input.state.ads = st === "ads";
      if (st === "crouch") input.press("crouch"); else input.release("crouch");
    }, { p: pose, st: STANCES[i % STANCES.length] });
    if (pose.timeOfDay !== undefined) {
      await page.evaluate((h) => window.__BS.setTimeOfDay(h), pose.timeOfDay);
    }
    if (gradePatch) await page.evaluate((g) => window.__BS.grade(g), gradePatch);
    await page.evaluate(() => window.__BS.advanceTime(3.0, 1 / 60));
    await page.evaluate(() => { for (let i = 0; i < 6; i += 1) window.__BS.renderOnce(1 / 60); });
    rows.push({ id: pose.id, ...(await measureBuffer(await grab(page))) });
  }
  return rows;
}

async function gameplayPoses(page) {
  return page.evaluate(() => {
    const c = window.__BS.ctx;
    if (!c.world || !c.world.getBeautyShots) return [];
    return c.world.getBeautyShots().filter((p) => p.position && p.target)
      .map((p) => ({ id: p.id, position: p.position, target: p.target, timeOfDay: p.timeOfDay }));
  });
}

async function runFramings(page, framings, gradePatch) {
  const rows = [];
  for (const f of framings) {
    // setPose returns false for an id it does not know and changes
    // nothing, so an unasserted call silently measures the PREVIOUS
    // pose twice. The action-* ids are the ones that bite: they belong
    // to the shots harness, not to listPoses().
    const ok = await page.evaluate((id) => window.__BS.setPose(id), f.id);
    if (!ok) throw new Error(`setPose("${f.id}") returned false - unknown pose`);
    if (gradePatch) await page.evaluate((g) => window.__BS.grade(g), gradePatch);
    await page.evaluate((a) => window.__BS.lookAt(a.p, a.t, a.fov), f);
    await page.evaluate(() => window.__BS.advanceTime(3.0, 1 / 60));
    await page.evaluate(() => { for (let i = 0; i < 8; i += 1) window.__BS.renderOnce(1 / 60); });
    rows.push({ id: f.id, ...(await measureBuffer(await grab(page))) });
  }
  return rows;
}

/* --------------------- the albedo hue census --------------------- */

/**
 * Median linear hue and saturation of every generated albedo.
 *
 * The frame's hue is albedo x illuminant, and the illuminant is one
 * number we can read straight out of sky.report(). Without this half
 * there is no way to tell a palette that is too red from a key light
 * that is too orange, and those need opposite fixes.
 */
async function albedoCensus(page) {
  return page.evaluate(() => {
    const T = window.__BS;
    const names = T.ctx.textures.list();
    const toLin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const out = [];
    for (const name of names) {
      let set = null;
      try { set = T.ctx.textures.get(name); } catch (e) { continue; }
      const img = set && set.map && set.map.image;
      if (!img || !img.data) continue;
      const d = img.data;
      const step = Math.max(4, (Math.floor(d.length / 4 / 20000) * 4) || 4);
      const hs = []; const ss = []; const ls = [];
      for (let i = 0; i < d.length; i += step) {
        const r = toLin(d[i]); const g = toLin(d[i + 1]); const b = toLin(d[i + 2]);
        const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const dd = mx - mn;
        let h = 0;
        if (dd > 1e-6) {
          if (mx === r) h = 60 * (((g - b) / dd) % 6);
          else if (mx === g) h = 60 * ((b - r) / dd + 2);
          else h = 60 * ((r - g) / dd + 4);
          if (h < 0) h += 360;
        }
        hs.push(h); ss.push(mx > 1e-6 ? dd / mx : 0);
        ls.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      }
      const m = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      out.push({ name, hue: m(hs), sat: m(ss), luma: m(ls), n: hs.length });
    }
    return { rows: out, sky: T.ctx.sky.report() };
  });
}

/* ------------------------------ main ------------------------------ */

/* Candidate sets. Each entry rewrites source literals before the
   module is parsed, so constants baked into the shader as strings are
   reachable - which the runtime grade() is not. */
const VARIANTS = [
  { name: "baseline", edits: [] },
];

async function main() {
  const plan = args.plan
    ? JSON.parse(await readFile(path.resolve(root, args.plan), "utf8"))
    : VARIANTS;

  const ref = await reference();
  console.log("BATTLEFIELD 2      "
    + `lit ${ref.litS.toFixed(3)} h${ref.litH.toFixed(0)}   `
    + `shade ${ref.shadeS.toFixed(3)} h${ref.shadeH.toFixed(0)}   `
    + `satRatio ${ref.satRatio.toFixed(2)}  dHue ${ref.dHue.toFixed(0)}   `
    + `detail ${ref.detRatio.toFixed(2)}   `
    + `IQR ${ref.litIqr.toFixed(1)} p99/p50 ${ref.litRatio.toFixed(2)} top2 ${ref.top2.toFixed(2)}%   `
    + `luma ${ref.meanLuma.toFixed(0)} sd ${ref.sd.toFixed(0)} dark ${ref.darkPct.toFixed(1)}\n`);

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
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, colorScheme: "light",
    });

    /* Framings are solved on a page of their own and that page is then
       thrown away. Solving them inside the first VARIANT leaves that
       variant with several hundred extra simulated seconds of cloud
       shadow, wind and weather easing on the clock, and it measured
       6 luma away from the identical build run second. */
    const GAMEPLAY = Boolean(args.gameplay);
    const solver = await bootPage(context, []);
    const framings = GAMEPLAY ? await gameplayPoses(solver) : await solveFramings(solver);
    console.log(`${GAMEPLAY ? "gameplay" : "free-camera"} framing, ${framings.length} poses`);
    if (args.albedo || args.census) {
      const c = await albedoCensus(solver);
      console.log("\n--- albedo census (median LINEAR hue/sat of each generated map) ---");
      for (const r of c.rows.sort((a, b) => a.hue - b.hue)) {
        console.log(`  ${r.name.padEnd(14)} hue ${r.hue.toFixed(1).padStart(6)}  `
          + `sat ${r.sat.toFixed(3)}  luma ${r.luma.toFixed(3)}`);
      }
      console.log(`  sun ${c.sky.sunColour}  tod ${c.sky.timeOfDay}  elev ${c.sky.sunElevationDeg}`);
      console.log("");
    }
    await solver.close();

    const header = "variant                        IQR p99/50 top2% | litSat litHue shSat"
      + "  satR  detR |  luma    sd  dark%";
    let printedHeader = false;

    for (const variant of plan) {
      const page = await bootPage(context, variant.edits);
      if (!printedHeader) { console.log(header); printedHeader = true; }

      const grades = variant.grades || [variant.grade || null];
      for (const g of grades) {
        const rows = GAMEPLAY
          ? await runGameplay(page, framings, g)
          : await runFramings(page, framings, g);
        const m = summarise(rows);
        /* Label by what DIFFERS from the first patch. grade() only
           writes the keys it is given, so a sweep whose rows are
           partial patches silently accumulates - row 5 still carries
           rows 2-4. Every row here is a full reset; this prints the
           delta so the table stays readable. */
        const tag = g
          ? `${variant.name} ${JSON.stringify(Object.fromEntries(
            Object.entries(g).filter(([k, val]) => !grades[0] || grades[0][k] !== val)))}`
          : variant.name;
        console.log(`${tag.slice(0, 29).padEnd(29)} `
          + `${m.litIqr.toFixed(1).padStart(4)} ${m.litRatio.toFixed(2).padStart(5)} `
          + `${m.top2.toFixed(2).padStart(5)} | `
          + `${m.litS.toFixed(3)} ${m.litH.toFixed(0).padStart(5)} ${m.shadeS.toFixed(3)} `
          + `${m.satRatio.toFixed(2).padStart(5)} ${m.detRatio.toFixed(2).padStart(5)} | `
          + `${m.meanLuma.toFixed(1).padStart(5)} ${m.sd.toFixed(1).padStart(5)} `
          + `${m.darkPct.toFixed(1).padStart(5)}`);
        if (args.verbose) {
          for (const r of rows) {
            console.log(`      ${r.id.padEnd(16)} lit ${r.litS.toFixed(3)} h${r.litH.toFixed(0).padStart(3)}`
              + `  shade ${r.shadeS.toFixed(3)} h${r.shadeH.toFixed(0).padStart(3)}`
              + `  ratio ${r.satRatio.toFixed(2)}`);
          }
        }
      }
      if (page.__bsErrors.length) {
        console.log(`   !! ${page.__bsErrors.length} page error(s): ${page.__bsErrors[0]}`);
      }
      await page.close();
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
