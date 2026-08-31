#!/usr/bin/env node
/* CAN VEYRA AND TORREN FIGHT THE STYLITE AT ALL?
 *
 * Reported: neither can reach it with their ranged attack. Measured,
 * the boss perches between 100 and 135 metres up while the player
 * stands at 26 - a 3D distance of about 110m at the nearest needle,
 * and every other perch is further. Veyra's crescents reached 42m and
 * Torren's cast 46m, so neither could put a single point of damage on
 * a perched Stylite.
 *
 * That is not a tuning problem, it is a lock-out: the boss's GRIP pool
 * only wears to damage taken WHILE PERCHED, and an empty grip is what
 * drops it into the melee window the whole fight is built around. The
 * loop was closed to both operatives. Vesper's lance reaches 360m and
 * never noticed.
 *
 * This asserts the loop is open again - that each operative can put
 * damage on a perched Stylite and move its grip - and that it stays
 * expensive: Veyra's damage at that range has to be a small fraction
 * of her muzzle damage, or the fix has made her a sniper. */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 47950 + (process.pid % 400);
const base = `http://127.0.0.1:${port}`;

function server() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}
async function waitServer() {
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: !!pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ""}`);
};

async function run(browser, character) {
  const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 140)));
  await page.goto(
    `${base}/games/saintfall.html?qa=1&intro=0&quality=low&character=${character}`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  const data = await page.evaluate(async () => {
    const T = window.__SF;
    T.invulnerable(true);
    if (!T.styliteState?.()) return { skipped: "no stylite" };
    T.teleportToStylite(28);
    T.advanceTime(2.5, 1 / 60);
    /* PERCHED is the only phase whose grip can be worn - `wearGrip`
       returns 0 in every other state, so a probe that fires during
       `rouse` measures nothing and looks like the lock-out it is
       trying to prove was fixed. Held there for the window. */
    T.forceStylitePhase("perched", 90);
    T.advanceTime(0.6, 1 / 60);

    const ps = T.player.state;
    const st = T.styliteState();
    const flat = Math.hypot(st.x - ps.x, st.z - ps.z);
    const dist = Math.hypot(st.x - ps.x, st.y - (ps.y + 1.4), st.z - ps.z);
    /* AIMED WITH THE REAL LOOK, not `setCam`. `setCam` detaches the
       camera, and a detached camera is `state.free` - which the cast
       refuses outright ("free-camera"), so a probe that aims that way
       measures its own camera hook rather than the weapon. */
    T.releaseCamera?.();
    T.setBodyHeading(Math.atan2(st.x - ps.x, st.z - ps.z));
    ps.camPitch = -Math.atan2(st.y - (ps.y + 1.4), flat);
    T.advanceTime(0.5, 1 / 60);

    const inst = T.enemies.live.find((e) => e.key === "stylite");
    const grip0 = T.styliteState().grip;
    const hp0 = inst ? inst.health : 0;

    let shots = 0;
    const refusals = new Set();
    for (let i = 0; i < 40; i += 1) {
      T.forceStylitePhase("perched", 90);
      /* The encounter's reveal camera takes the player's hands off the
         body and the cast refuses while detached - but releasing it
         every iteration also re-seats the chase camera and throws the
         aim off, so it is only released when it is actually held. */
      if (ps.free) T.releaseCamera?.();
      ps.camPitch = -Math.atan2(
        T.styliteState().y - (ps.y + 1.4),
        Math.hypot(T.styliteState().x - ps.x, T.styliteState().z - ps.z));
      if (T.discharge?.status?.()?.supported) {
        T.discharge.fireOnce(i % 2);
        shots += 1;
      }
      if (T.kenosis?.status?.()?.hammer) {
        if (T.kenosis.tryThrowHammer()) shots += 1;
        else refusals.add(T.kenosis.status().hammer.lastReason || "?");
      }
      T.advanceTime(0.25, 1 / 60);
    }
    T.advanceTime(2.0, 1 / 60);
    const live = T.enemies.live.find((e) => e.key === "stylite");
    return {
      flat: Number(flat.toFixed(1)),
      dist: Number(dist.toFixed(1)),
      shots,
      gripWorn: Number((grip0 - T.styliteState().grip).toFixed(1)),
      damage: Number((hp0 - (live ? live.health : hp0)).toFixed(1)),
      muzzleDamage: T.discharge?.status?.()?.damage ?? null,
      refusals: Array.from(refusals),
      hammer: T.kenosis?.status?.()?.hammer || null,
    };
  });

  await context.close();
  return { data, errors };
}

async function main() {
  const child = server();
  let browser;
  try {
    await waitServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    for (const character of ["white-vigil", "bastion-penitent"]) {
      const { data, errors } = await run(browser, character);
      console.log(`\n=== ${character} ===`);
      if (data.skipped) { check(`${character}: stylite present`, false, data); continue; }
      console.log(`  perched ${data.dist}m away (${data.flat}m out),`
        + ` ${data.shots} shots -> ${data.damage} damage, grip -${data.gripWorn}`);
      check(`${character}: can put damage on a perched Stylite`,
        data.damage > 0, data);
      check(`${character}: and can actually move its grip`,
        data.gripWorn > 0, { gripWorn: data.gripWorn });
      check(`${character}: zero page errors`, errors.length === 0, errors.slice(0, 2));
    }
  } finally {
    await browser?.close();
    child.kill();
  }
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
