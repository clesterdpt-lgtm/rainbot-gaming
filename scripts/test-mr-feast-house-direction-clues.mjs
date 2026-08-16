#!/usr/bin/env node
/* ============================================================
   MR. FEAST — house direction clues

   Soft pointers only: contestants mention the dark house and a
   flashlight, a closet door is carved toward the library stacks,
   and a bedside slip points at the atelier frames. Neither clue
   names Contestant 13, the Workroom, or the assembled keypad code.
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets/js/mr-feast-mansion.js");
const pagePath = path.join(root, "games/mr-feast-mansion.html");
const manifestPath = path.join(root, "assets/models/mr-feast/contestants/manifest.json");
const port = Number(process.env.MR_FEAST_DIRECTION_TEST_PORT || (45100 + (process.pid % 16000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output/playwright/mr-feast-house-direction-clues");
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failed += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function serverResponds() {
  try {
    return (await fetch(`${baseUrl}/games/mr-feast-mansion.html`, { cache: "no-store" })).ok;
  } catch (_) {
    return false;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await serverResponds()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

const runtime = await readFile(runtimePath, "utf8");
const pageSource = await readFile(pagePath, "utf8");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

console.log("\n=== SOURCE ===");
check("runtime versions the house-direction cache identity",
  /20260815-house-direction-clues-1/.test(runtime)
    && /20260815-house-direction-clues-1/.test(pageSource));
check("HOUSE_DIRECTION_CLUES is an authored table",
  /const HOUSE_DIRECTION_CLUES\s*=\s*Object\.freeze/.test(runtime)
    && /class HouseDirectionClueSystem/.test(runtime));
check("the carving lives on the west-front closet inner door",
  /closetName:\s*"west front walk-in closet"/.test(runtime)
    && /QUIET STACKS/.test(runtime)
    && /Examine closet carving/.test(runtime));
check("the bedside slip is in the primary suite",
  /nightstand-atelier-note/.test(runtime)
    && /atelier/.test(runtime)
    && /behind the/.test(runtime)
    && /Read bedside note/.test(runtime));
check("clue copy never names the Workroom, PIN, or assembled code",
  !/0513/.test(runtime.match(/HOUSE_DIRECTION_CLUES[\s\S]+?flashlightLinePattern/)?.[0] || "0513")
    && !/Workroom|keypad|PIN|Contestant 13/i.test(runtime.match(/closetCarving: Object\.freeze\(\{[\s\S]+?nightstandNote: Object\.freeze\(\{[\s\S]+?\}\),/)?.[0] || "Workroom"));
check("quest snapshots keep both direction flags and journal ids",
  /closetCarvingRead/.test(runtime)
    && /nightstandNoteRead/.test(runtime)
    && /id: "closet-carving-stacks"/.test(runtime)
    && /id: "nightstand-atelier-note"/.test(runtime));

const allLines = [];
const kitchenHint = [];
const bedroomHint = [];
const darknessHint = [];
for (const character of manifest.characters) {
  allLines.push(...character.dialogue);
  for (const line of character.dialogue) {
    if (/flashlight|torch/i.test(line) && /kitchen|sink/i.test(line)) kitchenHint.push(`${character.id}: ${line}`);
    if (/flashlight|torch/i.test(line) && /bedroom|wardrobe|closet/i.test(line)) bedroomHint.push(`${character.id}: ${line}`);
    if (/dark|night|light/i.test(line) && /house|room|upstairs|lamp|furniture/i.test(line)) {
      darknessHint.push(`${character.id}: ${line}`);
    }
  }
}
check("contestants keep unique dialogue pools",
  new Set(allLines).size === allLines.length,
  `${allLines.length} lines`);
check("someone mentions a kitchen flashlight", kitchenHint.length > 0, kitchenHint[0] || "none");
check("someone mentions a bedroom flashlight", bedroomHint.length > 0, bedroomHint[0] || "none");
check("someone talks about how dark the house is", darknessHint.length >= 2, `${darknessHint.length} lines`);

let server = null;
let browser = null;
if (!(await serverResponds())) {
  server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
}

try {
  await waitForServer();
  await mkdir(artifactDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(gameUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.render_game_to_text && JSON.parse(window.render_game_to_text()).ready, null, { timeout: 240000 });

  console.log("\n=== WORLD ===");
  const installed = await page.evaluate(() => window.MrFeastFresh.getHouseDirectionClueState());
  check("both physical clues are installed",
    installed?.closetCarving?.installed && installed?.nightstandNote?.installed,
    JSON.stringify(installed));

  const carving = await page.evaluate(() => {
    window.MrFeastFresh.stageHouseDirectionClueForQA("closet-carving");
    const inspected = window.MrFeastFresh.inspectHouseDirectionClueForQA("closet-carving");
    const state = JSON.parse(window.render_game_to_text());
    return {
      inspected,
      read: state.houseDirectionClues?.closetCarving?.read,
      journal: state.journal.entries,
      prompt: state.prompt,
    };
  });
  await page.screenshot({ path: path.join(artifactDir, "closet-carving-desktop.png") });
  check("examining the closet carving records a stacks/margin note",
    carving.inspected && carving.read && carving.journal.includes("closet-carving-stacks"),
    JSON.stringify(carving));

  const note = await page.evaluate(() => {
    window.MrFeastFresh.stageHouseDirectionClueForQA("nightstand-note");
    const inspected = window.MrFeastFresh.inspectHouseDirectionClueForQA("nightstand-note");
    const state = JSON.parse(window.render_game_to_text());
    const body = state.journal.details.find((entry) => entry.id === "nightstand-atelier-note")?.body || "";
    return {
      inspected,
      read: state.houseDirectionClues?.nightstandNote?.read,
      journal: state.journal.entries,
      body,
    };
  });
  await page.screenshot({ path: path.join(artifactDir, "nightstand-note-desktop.png") });
  check("reading the bedside slip records an atelier/frames note",
    note.inspected && note.read && note.journal.includes("nightstand-atelier-note")
      && /atelier|picture/i.test(note.body)
      && !/0513|workroom|keypad/i.test(note.body),
    JSON.stringify(note));

  check("no page errors", pageErrors.length === 0, pageErrors[0] || "");
  await browser.close();
} catch (error) {
  check("browser path completed", false, error.message);
  await browser?.close();
} finally {
  server?.kill("SIGTERM");
}

console.log(`\n${failed === 0 ? "OK" : "FAILED"}  ${results.length - failed}/${results.length} checks`);
if (failed) process.exit(1);
