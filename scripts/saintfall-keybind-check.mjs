#!/usr/bin/env node
/* ============================================================
   SAINTFALL - rebindable controls

   Drives the REAL Controls page - click a key slot, press a key -
   and then proves the game obeys the new scheme rather than the one
   it shipped with. The three things that can each independently be
   wrong:

     1. the editor writes the table (face, status line, storage),
     2. a key that was TAKEN from another action stops driving it,
     3. the simulation reads the table, not a literal.

   (3) is the one that silently regresses: a module that kept its own
   `e.code === "KeyF"` passes every UI assertion in this file and
   still ignores the rebind, so movement, melee, block and the menu
   keys are each exercised through a moved key.

   Usage: node scripts/saintfall-keybind-check.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 49400 + (process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = "saintfall:keybinds:v1";

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

async function bootPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&tutorial=1&intro=0&time=goldenhour`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 240000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
  });
  return { page, context, errors };
}

/** Click the slot for an action and press a key into it. */
async function rebind(page, action, slot, key) {
  await page.locator(`[data-bind-action="${action}"][data-bind-slot="${slot}"]`).click();
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.dataset.bindListening === "true",
    `[data-bind-action="${action}"][data-bind-slot="${slot}"]`, { timeout: 5000 });
  await page.keyboard.press(key);
  await delay(80);
}

const faceOf = (page, action, slot) => page
  .locator(`[data-bind-action="${action}"][data-bind-slot="${slot}"] kbd`).innerText();
const statusOf = (page) => page.locator("[data-bind-status]").innerText();
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), KEY);

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--mute-audio"],
    });

    const A = await bootPage(browser);
    const { page } = A;

    /* ------------------- 1. the editor writes the table ------------------- */
    console.log("--- controls page ---");
    await page.evaluate(() => window.__SF.gameUi.openMenu("controls"));
    await page.locator('[data-bind-action="melee"][data-bind-slot="0"]').waitFor({ timeout: 10000 });
    check("ships with W on move forward", await faceOf(page, "moveForward", 0) === "W");
    check("ships with F on melee", await faceOf(page, "melee", 0) === "F");
    check("an empty alternate invites a key rather than crying UNBOUND",
      await faceOf(page, "melee", 1) === "+", await faceOf(page, "melee", 1));
    check("nothing stored before the first rebind", await stored(page) === null);

    await rebind(page, "moveForward", 0, "KeyT");
    check("forward now reads T", await faceOf(page, "moveForward", 0) === "T",
      await faceOf(page, "moveForward", 0));
    check("the write reached storage",
      (await stored(page))?.moveForward?.[0] === "KeyT",
      JSON.stringify((await stored(page))?.moveForward));

    /* ------- 2. a key taken from another action stops driving it -------- */
    await rebind(page, "vent", 0, "KeyE");        // E was the Aegis block
    check("vent took E", await faceOf(page, "vent", 0) === "E");
    check("block was emptied", await faceOf(page, "block", 0) === "UNBOUND",
      await faceOf(page, "block", 0));
    const takenNote = await statusOf(page);
    check("the theft is announced", /taken from/i.test(takenNote), takenNote);

    await rebind(page, "block", 0, "KeyC");
    await rebind(page, "melee", 0, "KeyG");
    await rebind(page, "map", 0, "KeyN");

    // ESC must cancel a capture, not assign Escape and not close the menu.
    await page.locator('[data-bind-action="melee"][data-bind-slot="1"]').click();
    await page.keyboard.press("Escape");
    await delay(80);
    check("escape cancels the capture", await faceOf(page, "melee", 1) === "+");
    check("escape did not close the menu behind it",
      await page.locator("[data-menu-page='controls']").isVisible());

    // Backspace clears a slot outright.
    await rebind(page, "melee", 1, "KeyB");
    check("alternate took B", await faceOf(page, "melee", 1) === "B");
    await page.locator('[data-bind-action="melee"][data-bind-slot="1"]').click();
    await page.keyboard.press("Backspace");
    await delay(80);
    check("backspace clears the slot", await faceOf(page, "melee", 1) === "+");

    /* --------------- 3. the simulation reads the table ---------------- */
    console.log("--- the game obeys the new scheme ---");
    await page.evaluate(() => window.__SF.gameUi.closeMenu());
    await delay(120);
    check("the menu closed on the old menu key still bound to Tab",
      !(await page.locator("[data-menu-page='controls']").isVisible()));

    // Movement: the old W must be inert, the new T must walk.
    await page.evaluate(() => window.__SF.teleport(-14, 830, Math.PI));
    await page.keyboard.down("KeyW");
    await delay(250);
    const onW = await page.evaluate(() => window.__SF.player.input.state.move.y);
    await page.keyboard.up("KeyW");
    check("the old forward key is inert", onW === 0, `move.y=${onW}`);

    await page.keyboard.down("KeyT");
    await delay(250);
    const onT = await page.evaluate(() => window.__SF.player.input.state.move.y);
    const moved = await page.evaluate(() => {
      const before = window.__SF.player.state.z;
      return new Promise((res) => setTimeout(() => res(
        Math.abs(window.__SF.player.state.z - before)), 400));
    });
    await page.keyboard.up("KeyT");
    check("the rebound forward key drives movement", onT === -1, `move.y=${onT}`);
    check("and the body actually travels", moved > 0.5, `${moved.toFixed(2)}m`);

    // Melee: the queued event is read synchronously, before a frame drains it.
    const meleeEvents = await page.evaluate(() => {
      const fire = (code) => window.dispatchEvent(
        new KeyboardEvent("keydown", { code, bubbles: true }));
      window.__SF.player.input.state.events.length = 0;
      fire("KeyF");
      const onOld = window.__SF.player.input.state.events.filter((e) => e.type === "melee").length;
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyF", bubbles: true }));
      window.__SF.player.input.state.events.length = 0;
      fire("KeyG");
      const onNew = window.__SF.player.input.state.events.filter((e) => e.type === "melee").length;
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyG", bubbles: true }));
      return { onOld, onNew };
    });
    check("the old melee key no longer swings", meleeEvents.onOld === 0);
    check("the rebound melee key swings", meleeEvents.onNew === 1);

    // Block reads through the table (shield.js used to test KeyE directly).
    await page.keyboard.down("KeyC");
    await delay(220);
    const blocking = await page.evaluate(() => window.__SF.player.input.state.block);
    await page.keyboard.up("KeyC");
    check("the rebound block key raises the Aegis", blocking === true, `block=${blocking}`);

    // The map key is owned by ui.js, a different listener entirely.
    await page.keyboard.press("KeyM");
    await delay(200);
    const oldMap = await page.locator("[data-menu-page='map']").isVisible();
    check("the old map key is inert", oldMap === false, `open=${oldMap}`);
    await page.keyboard.press("KeyN");
    await delay(300);
    const newMap = await page.locator("[data-menu-page='map']").isVisible();
    check("the rebound map key opens the tactical map", newMap === true);
    await page.keyboard.press("Escape");
    await delay(150);

    /* ------------------ 4. it survives a reload ------------------ */
    console.log("--- persistence + restore defaults ---");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 240000 });
    await page.evaluate(() => {
      window.__SF.maximize();
      document.getElementById("sf-boot")?.remove();
    });
    const hudFace = await page.evaluate(() =>
      document.querySelector('#sf-shield b[data-bind-face="block"]')?.textContent);
    check("the HUD legend follows the rebind", hudFace === "C", `hud=${hudFace}`);
    await page.evaluate(() => window.__SF.gameUi.openMenu("controls"));
    await page.locator('[data-bind-action="melee"][data-bind-slot="0"]').waitFor({ timeout: 10000 });
    check("melee still on G after reload", await faceOf(page, "melee", 0) === "G");
    check("forward still on T after reload", await faceOf(page, "moveForward", 0) === "T");

    await page.locator("[data-bind-reset]").click();
    await delay(120);
    check("restore defaults returns W", await faceOf(page, "moveForward", 0) === "W");
    check("restore defaults returns F", await faceOf(page, "melee", 0) === "F");
    check("restore defaults returns E to the block", await faceOf(page, "block", 0) === "E");
    check("restore defaults returns R to the vent", await faceOf(page, "vent", 0) === "R");
    await page.evaluate(() => window.__SF.gameUi.closeMenu());
    await delay(120);
    await page.keyboard.down("KeyW");
    await delay(250);
    const backOnW = await page.evaluate(() => window.__SF.player.input.state.move.y);
    await page.keyboard.up("KeyW");
    check("and W walks again", backOnW === -1, `move.y=${backOnW}`);

    /* ------------- 5. the tutorial teaches the LIVE scheme ------------- */
    console.log("--- tutorial legends ---");
    await page.evaluate(() => window.__SF.gameUi.openMenu("controls"));
    await page.locator('[data-bind-action="moveForward"][data-bind-slot="0"]').waitFor({ timeout: 10000 });
    await rebind(page, "moveForward", 0, "KeyT");
    await page.evaluate(() => window.__SF.gameUi.closeMenu());
    await delay(150);
    const teaching = await page.evaluate(() => {
      window.__SF.startTutorialForQA();
      const host = document.getElementById("sf-tutorial");
      return { found: !!host, step: host?.dataset.step || null, text: host?.innerText || "" };
    });
    /* Guard the instrument before the assertion: a tutorial that never
       opened reads as a tutorial with nothing wrong in it. */
    check("the tutorial panel opened", teaching.found && teaching.step === "orientation",
      `found=${teaching.found} step=${teaching.step}`);
    check("no unresolved binding tokens survive to the panel",
      teaching.text.length > 0 && !teaching.text.includes("{{"),
      teaching.text.slice(0, 80).replace(/\n/g, " / "));
    check("the tutorial teaches the rebound movement key",
      /\bT A S D\b/.test(teaching.text),
      teaching.text.replace(/\n/g, " / ").slice(0, 160));
    await page.evaluate(() => window.__SF.skipTutorialForQA());

    check("no page errors", A.errors.length === 0, A.errors.slice(0, 3).join(" | "));
    await A.context.close();
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
