#!/usr/bin/env node
/* ============================================================
   SAINTFALL - graphics quality tier switch + entry options panel

   1. Boots the PRODUCTION path (no ?qa) at DPR 2 and asserts the
      default tier is high at device ratio 2, then drives the REAL
      settings control (field menu -> settings -> GRAPHICS QUALITY)
      through every tier and asserts the renderer followed each one:
      pixel ratio (device cap x tier ratio), MSAA samples, AO
      strength, shadow map size, shadow cadence - and that the
      preference was stored.

   2. Reloads and asserts the stored tier is applied at boot and
      highlighted in the in-game menu; then boots with `?quality=`
      and asserts the URL wins for the session WITHOUT touching the
      stored preference.

   3. Boots WITH the intro (the start screen), opens OPTIONS, asserts
      every control has a light foreground (the panel shipped with
      user-agent black labels once) and that the quality picker there
      switches the live renderer too. Screenshots for the eye.

   4. Writes a LOW-vs-HIGH crop of the same still so the trade can
      be judged, not asserted.

   Usage: node scripts/saintfall-quality-tier-check.mjs
   Artifacts: output/saintfall/quality/
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(root, "output/saintfall/quality");
const PORT = 48900 + (process.pid % 500);
const BASE = `http://127.0.0.1:${PORT}`;

/* Mirrors render.js QUALITY. Kept literal here on purpose: the point of
   the check is that the table the game ships matches what the switch
   does to the frame, so a silent edit to either side fails loudly. */
const EXPECT = {
  low: { ratio: 0.75, msaa: 0, ao: 0, shadow: 1024, shadowEvery: 3 },
  medium: { ratio: 1.5, msaa: 2, ao: 0.72, shadow: 2048, shadowEvery: 2 },
  high: { ratio: 2, msaa: 4, ao: 0.85, shadow: 4096, shadowEvery: 2 },
  ultra: { ratio: 2, msaa: 4, ao: 0.95, shadow: 4096, shadowEvery: 2 },
};

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

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "  ok " : "FAIL "} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

const readState = () => {
  const T = window.__SF;
  const info = T.render.info();
  return {
    quality: info.quality,
    pixelRatio: info.pixelRatio,
    msaa: info.msaa,
    ao: info.aoStrength,
    shadowEvery: info.shadowEvery,
    shadow: T.sky.sun.shadow.mapSize.x,
    sceneSize: info.sceneSize,
    stored: JSON.parse(localStorage.getItem("saintfall:field-ui:v1") || "{}").quality,
    settingsQuality: T.settingsState().quality,
    activeMenu: [...document.querySelectorAll("[data-quality]")]
      .filter((b) => b.classList.contains("is-active")).map((b) => b.dataset.quality),
    activeEntry: [...document.querySelectorAll("[data-intro-quality]")]
      .filter((b) => b.classList.contains("is-active")).map((b) => b.dataset.introQuality),
  };
};

/* Mean luma of the drawing buffer, read straight from GL. A frame that
   went black after a target reallocation would pass every state
   assertion above and still be a broken switch. */
const bufferLuma = () => {
  const r = window.__SF.render;
  const gl = r.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let sum = 0, lit = 0;
  const n = w * h;
  for (let i = 0; i < n; i += 1) {
    const l = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;
    sum += l;
    if (l > 8) lit += 1;
  }
  return { w, h, mean: sum / n, litFrac: lit / n };
};

async function bootPage(browser, url, { dpr = 2 } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }, deviceScaleFactor: dpr,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 240000 });
  return { page, context, errors };
}

async function main() {
  await mkdir(OUT, { recursive: true });
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

    /* ---------------- 1. the real in-game switch, DPR 2 ---------------- */
    console.log("--- in-game settings switch, production path, DPR 2 ---");
    const A = await bootPage(browser, `${BASE}/games/saintfall.html?intro=0&time=goldenhour`);
    await A.page.evaluate(() => {
      window.__SF.maximize();
      const el = document.getElementById("sf-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
      window.__SF.teleport(-14, 830, Math.PI);
      window.__SF.advanceTime(1, 1 / 60);
    });
    const boot = await A.page.evaluate(readState);
    check("default tier is high", boot.quality === "high", `quality=${boot.quality}`);
    check("high at DPR 2 draws at ratio 2", near(boot.pixelRatio, 2), `pixelRatio=${boot.pixelRatio}`);
    check("high keeps 4x MSAA", boot.msaa === 4, `msaa=${boot.msaa}`);
    check("nothing stored yet", boot.stored === undefined, `stored=${boot.stored}`);

    // The buffer-luma helper has to live in the page; install it once.
    await A.page.evaluate(`window.bufferLumaFn = ${bufferLuma.toString()};`);
    await A.page.evaluate(() => window.__SF.gameUi.openMenu("settings"));
    await A.page.locator('[data-quality="low"]').waitFor({ state: "visible", timeout: 10000 });
    await A.page.screenshot({ path: path.join(OUT, "ingame-settings-page.png") });
    const stills = {};
    for (const tier of ["low", "medium", "ultra", "high", "low", "high"]) {
      await A.page.locator(`[data-quality="${tier}"]`).click();
      const s = await A.page.evaluate(readState);
      const e = EXPECT[tier];
      check(`${tier}: renderer tier`, s.quality === tier, `quality=${s.quality}`);
      check(`${tier}: pixel ratio ${e.ratio}`, near(s.pixelRatio, e.ratio), `pixelRatio=${s.pixelRatio}`);
      check(`${tier}: msaa ${e.msaa}`, s.msaa === e.msaa, `msaa=${s.msaa}`);
      check(`${tier}: ao ${e.ao}`, near(s.ao, e.ao), `ao=${s.ao}`);
      check(`${tier}: shadow map ${e.shadow}`, s.shadow === e.shadow, `shadow=${s.shadow}`);
      check(`${tier}: shadow cadence ${e.shadowEvery}`, s.shadowEvery === e.shadowEvery, `every=${s.shadowEvery}`);
      check(`${tier}: preference stored`, s.stored === tier, `stored=${s.stored}`);
      check(`${tier}: menu highlights it`, s.activeMenu.length === 1 && s.activeMenu[0] === tier,
        `active=${s.activeMenu.join(",")}`);
      /* Draw a frame at this tier and prove it is a picture: a target
         chain that came back black after the reallocation would pass
         every state assertion above and still be a broken switch. */
      await A.page.evaluate(() => window.__SF.gameUi.closeMenu());
      const l = await A.page.evaluate(() => {
        window.__SF.renderOnce(0); window.__SF.renderOnce(0);
        return window.bufferLumaFn();
      });
      check(`${tier}: frame is a picture after the switch`, l.mean > 20 && l.litFrac > 0.9,
        `${l.w}x${l.h} mean=${l.mean.toFixed(1)} lit=${l.litFrac.toFixed(3)}`);
      if (!stills[tier]) {
        stills[tier] = await A.page.screenshot({ type: "png" });
        await writeFile(path.join(OUT, `still-${tier}.png`), stills[tier]);
      }
      await A.page.evaluate(() => window.__SF.gameUi.openMenu("settings"));
    }
    check("no page errors (in-game switch)", A.errors.length === 0, A.errors[0] || "");
    await A.context.close();

    /* --------------- 2. persistence and the URL override --------------- */
    console.log("--- stored tier at boot; ?quality= override ---");
    // A fresh context has fresh storage, so seed the preference the way
    // the menu writes it and boot on top of it.
    const contextB = await browser.newContext({
      viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2,
    });
    await contextB.addInitScript(() => {
      localStorage.setItem("saintfall:field-ui:v1", JSON.stringify({ quality: "low" }));
    });
    const pageB = await contextB.newPage();
    const errorsB = [];
    pageB.on("pageerror", (e) => errorsB.push(String(e)));
    await pageB.goto(`${BASE}/games/saintfall.html?intro=0&time=goldenhour`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await pageB.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 240000 });
    const b = await pageB.evaluate(readState);
    check("stored low is applied at boot", b.quality === "low" && near(b.pixelRatio, 0.75) && b.msaa === 0,
      `quality=${b.quality} pixelRatio=${b.pixelRatio} msaa=${b.msaa}`);
    check("boot leaves the store alone", b.stored === "low", `stored=${b.stored}`);
    check("menu highlights the stored tier", b.activeMenu.length === 1 && b.activeMenu[0] === "low",
      `active=${b.activeMenu.join(",")}`);
    await pageB.goto(`${BASE}/games/saintfall.html?intro=0&time=goldenhour&quality=ultra`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await pageB.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 240000 });
    const u = await pageB.evaluate(readState);
    check("?quality=ultra wins for the session", u.quality === "ultra" && near(u.ao, 0.95),
      `quality=${u.quality} ao=${u.ao}`);
    check("URL override does not touch the store", u.stored === "low", `stored=${u.stored}`);
    check("menu highlights the LIVE tier", u.activeMenu.length === 1 && u.activeMenu[0] === "ultra",
      `active=${u.activeMenu.join(",")}`);
    check("no page errors (persistence)", errorsB.length === 0, errorsB[0] || "");
    await contextB.close();

    /* --------------- 3. the start screen's OPTIONS panel --------------- */
    console.log("--- start screen options panel ---");
    const C = await bootPage(browser, `${BASE}/games/saintfall.html?time=goldenhour`);
    await C.page.evaluate(() => {
      window.__SF.maximize();
      const el = document.getElementById("sf-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    await C.page.waitForFunction(() => document.getElementById("sf-intro")?.classList.contains("is-ready"),
      null, { timeout: 30000 });
    await C.page.screenshot({ path: path.join(OUT, "entry-menu.png") });
    await C.page.locator("[data-intro-options-toggle]").click();
    await C.page.locator('[data-intro-panel="options"]').waitFor({ state: "visible", timeout: 10000 });
    await C.page.screenshot({ path: path.join(OUT, "entry-options-panel.png") });
    const panel = await C.page.evaluate(() => {
      const luma = (c) => {
        const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
        if (!m) return null;
        const a = m[4] === undefined ? 1 : Number(m[4]);
        return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) * a;
      };
      const items = [];
      document.querySelectorAll('[data-intro-panel="options"] button, [data-intro-panel="options"] b, [data-intro-panel="options"] small, [data-intro-panel="options"] > div > div > span')
        .forEach((el) => {
          const cs = getComputedStyle(el);
          items.push({
            what: `${el.tagName.toLowerCase()}${el.dataset.introSetting ? `[${el.dataset.introSetting}]` : ""}${el.dataset.introQuality ? `[q:${el.dataset.introQuality}]` : ""}${el.dataset.introHudScale ? `[hud:${el.dataset.introHudScale}]` : ""}`,
            text: el.textContent.trim().slice(0, 24),
            color: cs.color, luma: luma(cs.color), font: cs.fontFamily.split(",")[0],
          });
        });
      const list = document.querySelector('[data-intro-panel="options"] .sf-entry__options');
      return { items, listHeight: list.getBoundingClientRect().height, scrollHeight: list.scrollHeight,
        overflow: list.scrollHeight - list.clientHeight };
    });
    const dark = panel.items.filter((it) => it.luma !== null && it.luma < 90);
    check("every options control is light on dark", dark.length === 0,
      dark.length ? dark.map((d) => `${d.what} "${d.text}" ${d.color}`).join("; ") : `${panel.items.length} texts checked`);
    const uaFont = panel.items.filter((it) => /^(-apple-system|system-ui|Arial|Helvetica|Times|serif)$/i.test(it.font.replace(/"/g, "")));
    check("no control fell back to the user-agent font", uaFont.length === 0,
      uaFont.length ? uaFont.map((d) => `${d.what}:${d.font}`).join("; ") : "");
    console.log(`  options list ${panel.listHeight.toFixed(0)}px tall, overflow ${panel.overflow.toFixed(0)}px`);
    /* Rows must never paint over each other. When the panel is shrunk
       to a short stage the list is a definite-height flex item, and
       grid `auto` rows then collapse to their 3rem minimums - the
       quality row's segments landed on top of DYNAMIC RESOLUTION.
       Exercised at a stage the panel does NOT fit: un-maximise, which
       leaves ~500px of stage under the site chrome. */
    await C.page.evaluate(() => {
      // Inverse of __SF.maximize(): embedded view under the site chrome.
      document.documentElement.classList.remove("sf-maximised");
      document.querySelector(".sf-stage")?.classList.remove("is-maxed");
      window.dispatchEvent(new Event("resize"));
    });
    await delay(300);
    const rowsShort = await C.page.evaluate(() => {
      const list = document.querySelector('[data-intro-panel="options"] .sf-entry__options');
      const rows = [...list.children].map((el) => {
        const b = el.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, height: b.height, content: el.scrollHeight };
      });
      const stage = document.querySelector(".sf-stage").getBoundingClientRect();
      const gate = document.querySelector(".sf-intro__gate").getBoundingClientRect();
      const panel = document.querySelector('[data-intro-panel="options"]');
      return { rows, stage: [stage.top, stage.bottom], gate: [gate.top, gate.bottom],
        listScroll: list.scrollHeight - list.clientHeight, hint: panel.dataset.scrollMore };
    });
    const overlaps = rowsShort.rows.slice(1).filter((r, i) => r.top < rowsShort.rows[i].bottom - 1);
    const collapsed = rowsShort.rows.filter((r) => r.height < r.content - 1);
    check("short stage: no option row collapses onto the next", overlaps.length === 0 && collapsed.length === 0,
      `rows=${rowsShort.rows.map((r) => Math.round(r.height)).join("/")} overlaps=${overlaps.length} collapsed=${collapsed.length}`);
    check("short stage: panel stays inside the stage",
      rowsShort.gate[0] >= rowsShort.stage[0] - 1 && rowsShort.gate[1] <= rowsShort.stage[1] + 1,
      `gate ${rowsShort.gate.map(Math.round).join("-")} in stage ${rowsShort.stage.map(Math.round).join("-")}`);
    check("short stage: list scrolls and says so", rowsShort.listScroll > 0 && rowsShort.hint === "true",
      `overflow=${Math.round(rowsShort.listScroll)}px hint=${rowsShort.hint}`);
    await C.page.evaluate(() => window.__SF.maximize());
    await delay(300);
    for (const el of ["[data-intro-setting='reducedMotion'] b", "[data-intro-hud-scale='large']", "[data-intro-quality='low']"]) {
      const c = await C.page.locator(el).evaluate((n) => getComputedStyle(n).color);
      console.log(`  ${el.padEnd(42)} ${c}`);
    }
    // The entry picker drives the same renderer.
    await C.page.locator('[data-intro-quality="low"]').click();
    const e1 = await C.page.evaluate(readState);
    check("entry picker switches the renderer", e1.quality === "low" && near(e1.pixelRatio, 0.75), `quality=${e1.quality} pr=${e1.pixelRatio}`);
    check("entry picker stores the preference", e1.stored === "low", `stored=${e1.stored}`);
    check("entry picker highlights it", e1.activeEntry.length === 1 && e1.activeEntry[0] === "low", `active=${e1.activeEntry.join(",")}`);
    await C.page.screenshot({ path: path.join(OUT, "entry-options-panel-low.png") });
    await C.page.locator('[data-intro-quality="high"]').click();
    const e2 = await C.page.evaluate(readState);
    check("entry picker switches back", e2.quality === "high" && near(e2.pixelRatio, 2), `quality=${e2.quality} pr=${e2.pixelRatio}`);
    // High-contrast keeps the panel legible too.
    await C.page.locator('[data-intro-setting="highContrast"]').click();
    await C.page.screenshot({ path: path.join(OUT, "entry-options-panel-high-contrast.png") });
    await C.page.locator('[data-intro-setting="highContrast"]').click();
    check("no page errors (entry panel)", C.errors.length === 0, C.errors[0] || "");
    await C.context.close();

    /* --------------- 4. the visual trade, by eye --------------- */
    if (stills.low && stills.high) {
      const region = { left: 900, top: 500, width: 640, height: 480 };
      const a = await sharp(stills.high).extract(region).toBuffer();
      const b2 = await sharp(stills.low).extract(region).toBuffer();
      await sharp({
        create: {
          width: region.width * 2 + 8, height: region.height, channels: 3,
          background: { r: 12, g: 10, b: 12 },
        },
      }).composite([
        { input: a, left: 0, top: 0 },
        { input: b2, left: region.width + 8, top: 0 },
      ]).png().toFile(path.join(OUT, "compare-high-left-low-right.png"));
      console.log(`  wrote ${path.relative(root, OUT)}/compare-high-left-low-right.png`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
  if (failures) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
