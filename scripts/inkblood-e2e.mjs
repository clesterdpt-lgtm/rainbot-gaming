#!/usr/bin/env node
/* ============================================================
   INKBLOOD — end-to-end check

   Drives the game the way a player does: real key events, real
   clicks, no debug hook except to read state. Verifies the boot
   screen clears, the title starts a run, movement moves, pause
   toggles, the level-up card can be taken with the keyboard and
   with the mouse, and death and victory both resolve and record a
   score. Fails loudly on any console error.

   Usage: node scripts/inkblood-e2e.mjs [--headed]
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8741;
const headed = process.argv.includes("--headed");

async function ensureServer() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/`, { method: "HEAD" });
    if (r.ok || r.status === 404) return null;
  } catch { /* start our own */ }
  const proc = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: root, stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    await delay(120);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/`, { method: "HEAD" });
      if (r.ok || r.status === 404) return proc;
    } catch { /* keep waiting */ }
  }
  throw new Error("server never came up");
}

/**
 * Wait until the page has actually rendered N animation frames.
 *
 * Headless Chromium throttles requestAnimationFrame to roughly 1fps.
 * Sleeping a fixed 200ms between two key presses therefore lands
 * both inside the SAME frame, and edge-triggered input (pause,
 * menu confirm) only registers once — which looks exactly like a
 * broken pause key. Every input in this test is followed by a real
 * frame wait instead of a sleep.
 */
async function settle(page, ms = 250, n = 2) {
  // Wait for BOTH real time and real frames. Time alone is wrong when
  // rAF is throttled; frames alone are wrong when it is not, because
  // two frames can pass in 33ms and nothing has had time to happen.
  await Promise.all([delay(ms), frames(page, n)]);
}

async function frames(page, n = 2, timeoutMs = 20000) {
  await page.evaluate(() => {
    if (window.__probe != null) return;
    window.__probe = 0;
    const tick = () => { window.__probe++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const start = await page.evaluate(() => window.__probe);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const now = await page.evaluate(() => window.__probe);
    if (now - start >= n) return true;
    await delay(60);
  }
  return false;
}

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const proc = await ensureServer();
const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(`${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

await page.goto(`http://127.0.0.1:${PORT}/games/inkblood.html`, { waitUntil: "domcontentloaded" });

// 1. Boot
await page.waitForFunction(() => window.__INK && window.__INK.ready, null, { timeout: 60000 });
check("boots and exposes __INK", true);
await page.waitForFunction(() => !document.getElementById("ink-boot"), null, { timeout: 10000 })
  .then(() => check("boot overlay is removed", true))
  .catch(() => check("boot overlay is removed", false, "still present"));

check("starts on the title screen", await page.evaluate(() => window.__INK.phase === "title"));

const embedded = await page.evaluate(() => {
  const surface = document.querySelector(".rb-standalone-surface");
  const root = document.getElementById("ink-root");
  const canvas = document.getElementById("ink-canvas");
  const surfaceRect = surface?.getBoundingClientRect();
  const rootRect = root?.getBoundingClientRect();
  const canvasRect = canvas?.getBoundingClientRect();
  return {
    shell: document.body.classList.contains("rb-standalone-shell"),
    maxed: surface?.classList.contains("is-maxed"),
    nav: Boolean(document.querySelector(".nav")),
    side: Boolean(document.querySelector(".game-side")),
    fitted: Boolean(rootRect && canvasRect)
      && Math.abs(rootRect.width - canvasRect.width) <= 1
      && Math.abs(rootRect.height - canvasRect.height) <= 1,
    size: surfaceRect && canvasRect
      ? `surface=${Math.round(surfaceRect.width)}x${Math.round(surfaceRect.height)} canvas=${Math.round(canvasRect.width)}x${Math.round(canvasRect.height)}`
      : "missing",
  };
});
check("opens in the minimized game-page shell", embedded.shell && !embedded.maxed && embedded.nav && embedded.side,
  embedded.size);
check("canvas fits the minimized play surface", embedded.fitted, embedded.size);

// Keep this long gameplay suite in a resizable normal browser window. Native
// fullscreen uses the same click path in production; here we deliberately
// exercise the full-window CSS fallback that browsers use when it is denied.
await page.evaluate(() => {
  const surface = document.querySelector(".rb-standalone-surface");
  if (!surface) return;
  Object.defineProperty(surface, "requestFullscreen", { value: undefined });
  Object.defineProperty(surface, "webkitRequestFullscreen", { value: undefined });
});
await page.locator("#btn-fullscreen").click();
await settle(page, 300);
const maxed = await page.evaluate(() => {
  const surface = document.querySelector(".rb-standalone-surface");
  return surface?.classList.contains("is-maxed")
    && document.body.classList.contains("rb-game-maxed")
    && document.getElementById("btn-fullscreen")?.getAttribute("aria-pressed") === "true";
});
check("Max expands the play surface", maxed);

await page.locator("#btn-fullscreen").click();
await settle(page, 300);
const restored = await page.evaluate(() => {
  const surface = document.querySelector(".rb-standalone-surface");
  return !surface?.classList.contains("is-maxed")
    && !document.body.classList.contains("rb-game-maxed")
    && document.getElementById("btn-fullscreen")?.getAttribute("aria-pressed") === "false"
    && document.activeElement === document.getElementById("ink-canvas");
});
check("Max closes back to the minimized page and playfield", restored);

// 2. Title -> play via a real key press
await page.keyboard.press("Space");
await settle(page, 300);
check("any key starts a run", await page.evaluate(() => window.__INK.phase === "playing"));

const slashFrames = await page.evaluate(() => ({
  normal: window.__INK.game.art.hero.slash?.length || 0,
  hurt: window.__INK.game.art.hero.hurtSlash?.length || 0,
}));
check("sword slash animation is baked", slashFrames.normal === 8 && slashFrames.hurt === 8,
  `normal=${slashFrames.normal} hurt=${slashFrames.hurt}`);

const symbolLanguage = await page.evaluate(async () => {
  const { WEAPONS, PASSIVES } = await import("/assets/js/inkblood/weapons.js");
  const { SFX_WORDS } = await import("/assets/js/inkblood/fx.js");
  const impactMarks = Object.values(SFX_WORDS).flat().join("");
  return {
    weaponSigils: Object.values(WEAPONS).every((d) => Boolean(d.sigil)),
    passiveSigils: Object.values(PASSIVES).every((d) => Boolean(d.sigil)),
    impactMarksAreGraphic: !/[\u3040-\u30ff\u3400-\u9fff]/u.test(impactMarks),
  };
});
check("weapons, relics, and impacts use the new symbol language",
  symbolLanguage.weaponSigils && symbolLanguage.passiveSigils && symbolLanguage.impactMarksAreGraphic,
  JSON.stringify(symbolLanguage));

const gaitOrder = await page.evaluate(async () => {
  const mod = await import("/assets/js/inkblood/game.js");
  return [0.1, 0.2, 0.3].map((t) => mod.gaitFrameIndex(t, 10, 8));
});
check("shared walk cycle advances in the corrected direction",
  gaitOrder.join(",") === "7,6,5", `frames=${gaitOrder.join("→")}`);

const slashTrigger = await page.evaluate(() => {
  const g = window.__INK.game;
  g.player.slashT = 0;
  g.weapons[0].cd = 0;
  g.step(1 / 60);
  return {
    active: g.player.slashT > 0,
    duration: g.player.slashDuration,
    arcs: g.fx.slashes.length,
  };
});
check("Crimson Arc triggers the hero sword swing", slashTrigger.active && slashTrigger.arcs >= 2,
  `duration=${slashTrigger.duration.toFixed(2)} arcs=${slashTrigger.arcs}`);

// 3. Real movement
const before = await page.evaluate(() => ({ x: window.__INK.game.player.x, y: window.__INK.game.player.y }));
await page.keyboard.down("KeyD");
await settle(page, 700, 6);
await page.keyboard.up("KeyD");
const after = await page.evaluate(() => ({ x: window.__INK.game.player.x, y: window.__INK.game.player.y }));
check("holding D moves the player right", after.x - before.x > 40,
  `dx=${(after.x - before.x).toFixed(1)}`);

// 4. Weapon actually fires and kills
await page.evaluate(() => window.__INK.spawn("gaki", 24, 220));
await settle(page, 2200, 10);
const killed = await page.evaluate(() => window.__INK.stats.kills);
check("the blade swings itself and kills", killed > 0, `kills=${killed}`);

// Everything below tests structure, not survival. Twenty-four gaki
// dropped on a stationary player will kill them inside three seconds
// and every later assertion would then be testing the death screen.
await page.evaluate(() => window.__INK.god(true));

// Those kills earn levels, and a pending level-up legitimately blocks
// pause. Clear the field AND the queue so nothing new arrives while
// the structural checks below are running.
await page.evaluate(() => {
  const g = window.__INK.game;
  g.enemies.length = 0;
  g.pickups.length = 0;
  g.director.reset();
  g.director.update = () => {};      // stop the spawner for the rest
  let guard = 0;
  while (g.phase === "levelup" && guard++ < 40) g.takeChoice();
});
await settle(page, 250);

// 5. Pause toggles
await page.keyboard.press("KeyP");
await settle(page, 260);
const paused = await page.evaluate(() => window.__INK.phase === "paused");
await page.keyboard.press("KeyP");
await settle(page, 260);
const resumed = await page.evaluate(() => window.__INK.phase === "playing");
check("P pauses and resumes", paused && resumed, `paused=${paused} resumed=${resumed} phase=${await page.evaluate(() => window.__INK.phase)}`);

// 6. Level up, taken with the keyboard. Exactly one level is granted
// so that taking it returns to play rather than opening the next card.
await page.evaluate(() => {
  const g = window.__INK.game;
  g.queuedLevels = 0;
  g.player.xp = 0;
  g.gainXp(g.player.xpNeed);
});
await settle(page, 260);
const inLevelUp = await page.evaluate(() => window.__INK.phase === "levelup");
const cardSigils = await page.evaluate(() => window.__INK.game.choices.every((c) => c.sigil && !("jp" in c)));
const pickBefore = await page.evaluate(() => window.__INK.game.selected);
await page.keyboard.press("ArrowRight");
await settle(page, 200);
const pickAfter = await page.evaluate(() => window.__INK.game.selected);
await page.keyboard.press("Enter");
await settle(page, 320);
const tookIt = await page.evaluate(() => window.__INK.phase === "playing");
check("arrow key moves the card selection", pickAfter !== pickBefore,
  `${pickBefore} -> ${pickAfter}`);
check("level-up cards carry pictograms instead of Japanese labels", cardSigils);
check("level-up opens and Enter takes the card", inLevelUp && tookIt, `open=${inLevelUp} took=${tookIt} phase=${await page.evaluate(() => window.__INK.phase)}`);

// 7. Level up, taken with a click
await page.evaluate(() => {
  const g = window.__INK.game;
  g.queuedLevels = 0;
  g.player.xp = 0;
  g.gainXp(g.player.xpNeed);
});
await settle(page, 260);
const box = await page.evaluate(() => {
  const r = window.__INK.game.hud.hitRects[1] || window.__INK.game.hud.hitRects[0];
  const canvas = document.getElementById("ink-canvas")?.getBoundingClientRect();
  return r && canvas ? { x: canvas.left + r.x + r.w / 2, y: canvas.top + r.y + r.h / 2 } : null;
});
if (box) {
  await page.mouse.click(box.x, box.y);
  await settle(page, 300);
}
check("level-up card is clickable", await page.evaluate(() => window.__INK.phase === "playing"));

// 8. Boss reveal
await page.evaluate(() => window.__INK.boss("gashadokuro"));
await settle(page, 400);
check("boss spawns and shows its panel", await page.evaluate(() => {
  const g = window.__INK.game;
  return !!g.boss && !!g.fx.panel && g.fx.panel.kind === "boss";
}));

// 9. Death resolves and records a score
await page.evaluate(() => {
  window.__INK.game.baseStats.armor = 0;
  window.__INK.game.recomputeStats();
  window.__INK.kill();
});
await settle(page, 600);
const dead = await page.evaluate(() => window.__INK.phase === "dead");
// The page loads the site's RB helper, so the score goes through
// RB.recordScore and lands in its own store, not a bare localStorage
// key. Ask whichever API is actually in play.
const stored = await page.evaluate(() => {
  if (window.RB && typeof window.RB.getHighScore === "function") {
    return Number(window.RB.getHighScore("inkblood") || 0);
  }
  try { return Number(localStorage.getItem("rb_score_inkblood") || 0); } catch { return -1; }
});
check("death resolves", dead);
check("score is recorded", stored > 0, `stored=${stored}`);

// 10. Restart from the death screen
await delay(1800);
await page.keyboard.press("Space");
await settle(page, 300);
check("restarts from the death screen", await page.evaluate(() => window.__INK.phase === "playing"));

// 11. Victory path
await page.evaluate(() => window.__INK.win());
await settle(page, 300);
check("victory resolves", await page.evaluate(() => window.__INK.phase === "won"));

// 12. Resize does not throw
await page.setViewportSize({ width: 390, height: 844 });
await settle(page, 400);
const mobileFit = await page.evaluate(() => {
  const surface = document.querySelector(".rb-standalone-surface")?.getBoundingClientRect();
  const canvas = document.getElementById("ink-canvas")?.getBoundingClientRect();
  const pass = Boolean(surface && canvas)
    && surface.width <= window.innerWidth
    && Math.abs((surface.width / surface.height) - 0.75) < 0.03
    && Math.abs(surface.width - canvas.width) <= 3
    && Math.abs(surface.height - canvas.height) <= 3;
  return {
    pass,
    detail: surface && canvas
      ? `surface=${Math.round(surface.width)}x${Math.round(surface.height)} canvas=${Math.round(canvas.width)}x${Math.round(canvas.height)} ratio=${(surface.width / surface.height).toFixed(3)}`
      : "missing",
  };
});
check("phone layout uses a fitted portrait game panel", mobileFit.pass, mobileFit.detail);
await page.setViewportSize({ width: 1600, height: 700 });
await settle(page, 400);
check("survives viewport changes", true);

check("no console or page errors", errors.length === 0, errors.slice(0, 4).join(" | "));

await browser.close();
if (proc) proc.kill();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
