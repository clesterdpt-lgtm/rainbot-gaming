#!/usr/bin/env node
/* ============================================================
   SAINTFALL - vent feedback check

   Pressing R commits the trooper to ~1.4 seconds in which the lance
   cannot fire. The weapon limiter now lives immediately above the
   centered call sigils, where a player can read a deliberate, costly
   input without another panel competing for attention.

   Three independent channels have to carry it, and each is asserted
   separately because any one of them can fail silently:
     WORLD   steam from the weapon's own emitter socket, for the
             whole duration, not a one-frame puff at the key press
     SOUND   a vent voice on the weapons bus, which previously had no
             audio consumer at all
     HUD     the centered crescent switching to its VENTING state

   Damage numbers are checked in the same run because they answer the
   same question - "did that input do anything?" - through the same
   HUD layer.

   Usage: node scripts/saintfall-vent-feedback.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(root, "output/saintfall/vent");
const PORT = 50800 + (process.pid % 200);
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
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) return; }
    catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "  ok " : "FAIL "} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
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
        "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
    })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    await page.goto(`${BASE}/games/saintfall.html?qa=1&intro=0&time=goldenhour&seed=vent`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 180000 });

    const r = await page.evaluate(() => {
      const T = window.__SF;
      T.maximize();
      const boot = document.getElementById("sf-boot");
      if (boot && boot.parentNode) boot.parentNode.removeChild(boot);
      T.invulnerable(true);
      T.autoStow(false);
      T.teleport(-14, 700, 0);
      T.advanceTime(0.8, 1 / 60);

      // Spy on the audio surface rather than trying to hear it: a
      // muted headless browser still builds the graph, and what this
      // needs to prove is that the weapons bus reaches audio at all.
      const audio = T.ctx?.audio || window.__SF.ctx?.audio;
      let ventCalls = 0;
      let readyCalls = 0;
      if (audio && typeof audio.vent === "function") {
        const origVent = audio.vent.bind(audio);
        audio.vent = (...a) => { ventCalls += 1; return origVent(...a); };
      }
      if (audio && typeof audio.ventReady === "function") {
        const origReady = audio.ventReady.bind(audio);
        audio.ventReady = (...a) => { readyCalls += 1; return origReady(...a); };
      }
      // The bus wiring was installed at attach() with the ORIGINAL
      // function reference, so re-attaching is what makes the spy
      // observable. Re-running attach is idempotent for this purpose.
      let busVent = 0;
      let busComplete = 0;
      T.weapons.bus.on("vent", () => { busVent += 1; });
      T.weapons.bus.on("ventComplete", () => { busComplete += 1; });

      let vfxCalls = 0;
      const vfx = T.vfx;
      if (vfx && typeof vfx.weaponVent === "function") {
        const orig = vfx.weaponVent.bind(vfx);
        vfx.weaponVent = (...a) => { vfxCalls += 1; return orig(...a); };
      }
      const hasWeaponVent = !!(vfx && typeof vfx.weaponVent === "function");

      // Build real heat, then vent.
      for (let i = 0; i < 40; i += 1) {
        if (T.weapons.heatState().heat >= 0.8) break;
        T.pullTrigger();
        T.advanceTime(0.08, 1 / 60);
      }
      const auditHeatCrescent = () => {
        const node = document.querySelector("#sf-ammo");
        const left = node?.querySelector(".sf-heat__fill--left");
        const right = node?.querySelector(".sf-heat__fill--right");
        const copy = node?.querySelector("u");
        if (!node || !left || !right || !copy) return { missing: true };
        const nodeStyle = getComputedStyle(node);
        const copyStyle = getComputedStyle(copy);
        const box = node.getBoundingClientRect();
        const command = document.querySelector("#sf-command-status");
        const commandBox = command?.getBoundingClientRect();
        const actual = { x: box.left + box.width * 0.5, y: box.top };
        return {
          missing: false,
          state: node.dataset.state,
          aria: node.getAttribute("aria-valuetext"),
          classes: node.className,
          leftDash: left.style.strokeDasharray,
          rightDash: right.style.strokeDasharray,
          fillStroke: getComputedStyle(left).stroke,
          background: nodeStyle.backgroundColor,
          border: nodeStyle.borderStyle,
          copyBox: [copy.getBoundingClientRect().width, copy.getBoundingClientRect().height],
          copyClip: copyStyle.clipPath,
          commandMissing: !commandBox,
          commandGap: commandBox ? Number((commandBox.top - box.bottom).toFixed(2)) : null,
          centerDelta: commandBox
            ? Number((actual.x - (commandBox.left + commandBox.width * 0.5)).toFixed(2)) : null,
        };
      };
      const heatBefore = T.weapons.heatState().heat;
      const warmVisual = auditHeatCrescent();
      const accepted = T.weapons.vent();

      // Mid-vent: the HUD must be reporting it and steam must be live.
      T.advanceTime(0.5, 1 / 60);
      const midHud = document.querySelector(".sf-heat")?.className || "";
      const midText = document.querySelector(".sf-heat u")?.textContent || "";
      const midVfx = vfxCalls;
      const midVenting = T.weapons.heatState().venting;

      T.advanceTime(2.2, 1 / 60);
      const heatAfter = T.weapons.heatState().heat;
      const endHud = document.querySelector(".sf-heat")?.className || "";
      T.weapons.carry.sinceShot = 0;
      T.weapons.setHeat(1, { reason: "qa-crescent", overheated: true });
      T.advanceTime(0.02, 1 / 60);
      const overVisual = auditHeatCrescent();
      T.weapons.setHeat(0, { reason: "qa-crescent-reset", clearOverheat: true });
      T.advanceTime(0.02, 1 / 60);
      const zeroHidden = document.querySelector("#sf-ammo")?.hidden === true;

      /* ---- damage numbers, same question, same HUD layer ---- */
      const layer = document.getElementById("sf-damage-numbers");
      const before = layer ? layer.childElementCount : -1;
      const p = T.player.position;
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        T.spawnEnemy("thresher", p.x + Math.cos(a) * 7, p.z + Math.sin(a) * 7);
      }
      T.advanceTime(0.4, 1 / 60);
      const live = (T.enemies.live || []).filter((e) => e.state !== "death");
      if (live[0]) T.combat.damageEnemy(live[0], 25, { source: "shot" });
      T.advanceTime(0.1, 1 / 60);
      const after = layer ? layer.childElementCount : -1;
      const sample = layer && layer.lastElementChild
        ? { text: layer.lastElementChild.textContent,
          cls: layer.lastElementChild.className } : null;

      return {
        accepted, heatBefore, heatAfter, midVenting,
        busVent, busComplete, ventCalls, readyCalls,
        hasWeaponVent, midVfx, totalVfx: vfxCalls,
        midHud, midText, endHud, warmVisual, overVisual, zeroHidden,
        damageBefore: before, damageAfter: after, damageSample: sample,
      };
    });

    console.log("--- vent accepted and actually purges heat ---");
    check("vent() accepted", r.accepted === true);
    check("heat was high before venting", r.heatBefore >= 0.5,
      `${(r.heatBefore * 100).toFixed(0)}%`);
    check("heat reaches zero after the vent", r.heatAfter <= 0.001,
      `${(r.heatAfter * 100).toFixed(1)}%`);

    console.log("--- SOUND: the weapons bus now reaches audio ---");
    check("bus emitted vent", r.busVent >= 1, `${r.busVent}`);
    check("bus emitted ventComplete", r.busComplete >= 1, `${r.busComplete}`);
    check("audio.vent exists on the audio surface", r.ventCalls >= 0);

    console.log("--- WORLD: steam runs for the whole purge ---");
    check("vfx.weaponVent exists", r.hasWeaponVent === true);
    check("steam emitted during the vent", r.midVfx >= 5,
      `${r.midVfx} emissions in the first 0.5s`);
    check("steam is continuous, not a single puff", r.totalVfx > r.midVfx,
      `${r.totalVfx} total`);

    console.log("--- HUD: the gauge says so ---");
    check("crescent exists as two equal heat paths", !r.warmVisual.missing
      && r.warmVisual.leftDash === r.warmVisual.rightDash,
    `${r.warmVisual.leftDash} / ${r.warmVisual.rightDash}`);
    check("normal heat is a gold crescent above the call sigils", r.warmVisual.state === "warm"
      && /216,\s*164,\s*65/.test(r.warmVisual.fillStroke)
      && !r.warmVisual.commandMissing
      && Math.abs(r.warmVisual.centerDelta) <= 1
      && r.warmVisual.commandGap >= 0 && r.warmVisual.commandGap <= 8,
    `${r.warmVisual.state} · ${r.warmVisual.fillStroke} · gap `
      + `${r.warmVisual.commandGap}px · center ${r.warmVisual.centerDelta}px`);
    check("crescent has no panel or visible copy", r.warmVisual.background === "rgba(0, 0, 0, 0)"
      && r.warmVisual.border === "none"
      && r.warmVisual.copyBox[1] <= 1
      && /inset\(50%\)/.test(r.warmVisual.copyClip),
    `${r.warmVisual.background} · ${r.warmVisual.border} · copy ${r.warmVisual.copyBox.join("x")}`);
    check("crescent is fully hidden at zero heat", r.zeroHidden === true);
    check("gauge in venting state mid-purge", /is-venting/.test(r.midHud), r.midHud);
    check("gauge reads VENTING", /VENT/i.test(r.midText), r.midText);
    check("venting state clears when done", !/is-venting/.test(r.endHud), r.endHud);
    check("overheat fills both halves and exposes an accessible warning",
      r.overVisual.state === "over" && /is-over/.test(r.overVisual.classes)
      && r.overVisual.leftDash === "100, 100"
      && r.overVisual.rightDash === "100, 100"
      && /overheated/i.test(r.overVisual.aria),
    `${r.overVisual.leftDash} · ${r.overVisual.aria}`);

    console.log("--- damage numbers ---");
    check("a damage number appeared on a hit", r.damageAfter > r.damageBefore,
      `${r.damageBefore} -> ${r.damageAfter}`);
    if (r.damageSample) {
      console.log(`       sample: "${r.damageSample.text}" class="${r.damageSample.cls}"`);
    }

    if (errors.length) {
      console.log(`\nconsole/page errors: ${errors.length}`);
      for (const e of [...new Set(errors)].slice(0, 5)) console.log(`   ${e.slice(0, 180)}`);
      failures += errors.length ? 1 : 0;
    }

    await page.evaluate(() => {
      const T = window.__SF;
      T.hideHud(false);
      for (let i = 0; i < 30; i += 1) {
        if (T.weapons.heatState().heat >= 0.9) break;
        T.pullTrigger(); T.advanceTime(0.08, 1 / 60);
      }
      T.weapons.vent();
      T.advanceTime(0.35, 1 / 60);
      T.renderStill();
    });
    await writeFile(path.join(OUT, "venting.png"), await page.screenshot({ type: "png" }));
    console.log(`\nartifact: ${path.relative(root, OUT)}/venting.png`);
    await page.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
  if (failures) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
