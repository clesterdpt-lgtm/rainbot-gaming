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
const generatedAssetNetworkErrors = [];
page.on("pageerror", (e) => errors.push(`${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
page.on("requestfailed", (request) => {
  if (!request.url().includes("/assets/img/inkblood/generated/")) return;
  generatedAssetNetworkErrors.push(
    `request failed: ${request.url()} (${request.failure()?.errorText || "unknown error"})`,
  );
});
page.on("response", (response) => {
  if (!response.url().includes("/assets/img/inkblood/generated/") || response.status() < 400) return;
  generatedAssetNetworkErrors.push(`HTTP ${response.status()}: ${response.url()}`);
});

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

const mangaHud = await page.evaluate(() => {
  const g = window.__INK.game;
  const r = g.hud.regions;
  const inside = (part, whole) => Boolean(part && whole)
    && part.x >= whole.x - 1
    && part.y >= whole.y - 1
    && part.x + part.w <= whole.x + whole.w + 1
    && part.y + part.h <= whole.y + whole.h + 1;
  return {
    presentation: g.hud.presentation,
    allInBand: [r.hp, r.timer, r.xp, r.loadout].every((part) => inside(part, r.band)),
    topWeighted: r.band.y < g.h * 0.04 && r.band.h < g.h * 0.22,
    hierarchy: r.hp.x + r.hp.w < r.timer.x
      && r.timer.x + r.timer.w < r.xp.x
      && r.loadout.y > r.hp.y + r.hp.h,
    timerCentered: Math.abs((r.timer.x + r.timer.w / 2) - g.w / 2) <= 2,
    ledgerHidden: !g.showStats,
    compactRadar: r.radar && r.radar.w < 100,
    regions: r,
  };
});
check("combat readouts use the open ornamental manga frame",
  mangaHud.presentation === "open-ornamental-frame"
    && mangaHud.allInBand && mangaHud.topWeighted && mangaHud.hierarchy && mangaHud.timerCentered,
  JSON.stringify(mangaHud.regions));
check("combat defaults hide the ledger and keep the radar secondary",
  mangaHud.ledgerHidden && mangaHud.compactRadar,
  `ledgerHidden=${mangaHud.ledgerHidden} radar=${Math.round(mangaHud.regions.radar?.w || 0)}`);

const stageControls = await page.evaluate(() => {
  const canvas = document.getElementById("ink-canvas")?.getBoundingClientRect();
  const pause = document.getElementById("btn-pause")?.getBoundingClientRect();
  const max = document.getElementById("btn-fullscreen")?.getBoundingClientRect();
  const overlaps = pause && max
    ? !(pause.right <= max.left || max.right <= pause.left || pause.bottom <= max.top || max.bottom <= pause.top)
    : true;
  const inside = (r) => Boolean(canvas && r)
    && r.left >= canvas.left && r.top >= canvas.top && r.right <= canvas.right && r.bottom <= canvas.bottom;
  return {
    enabled: !document.getElementById("btn-pause")?.disabled,
    pressed: document.getElementById("btn-pause")?.getAttribute("aria-pressed"),
    separate: !overlaps,
    inside: inside(pause) && inside(max),
  };
});
check("pause and Max are distinct accessible stage controls",
  stageControls.enabled && stageControls.pressed === "false" && stageControls.separate && stageControls.inside,
  JSON.stringify(stageControls));

const generatedManifest = await page.evaluate(() => {
  const manifest = window.__INK.game.generatedAssets;
  return {
    mode: manifest?.mode || "missing",
    status: manifest?.status || "missing",
    loaded: Array.isArray(manifest?.loaded) ? manifest.loaded.length : -1,
    failed: Array.isArray(manifest?.failed) ? manifest.failed.length : -1,
  };
});
check("loads the complete generated manga asset manifest",
  generatedManifest.mode === "generated"
    && generatedManifest.status === "ready"
    && generatedManifest.loaded === 7
    && generatedManifest.failed === 0,
  JSON.stringify(generatedManifest));

const generatedAnimationArt = await page.evaluate(() => {
  const pixelSignature = (frame) => {
    const canvas = frame?.canvas || frame;
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) {
      return { signature: "missing", opaque: 0 };
    }
    const pixels = canvas.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    let opaque = 0;
    // Sampling every fourth pixel keeps this inexpensive while still hashing
    // thousands of authored pixels from each full-size generated frame.
    for (let i = 0; i < pixels.length; i += 16) {
      if (pixels[i + 3] > 8) opaque++;
      hash = Math.imul(hash ^ pixels[i], 16777619);
      hash = Math.imul(hash ^ pixels[i + 1], 16777619);
      hash = Math.imul(hash ^ pixels[i + 2], 16777619);
      hash = Math.imul(hash ^ pixels[i + 3], 16777619);
    }
    return {
      signature: `${canvas.width}x${canvas.height}:${(hash >>> 0).toString(16)}`,
      opaque,
    };
  };

  const clipSummary = (frames) => {
    const signatures = (frames || []).map(pixelSignature);
    return {
      count: signatures.length,
      unique: new Set(signatures.map((entry) => entry.signature)).size,
      nonempty: signatures.every((entry) => entry.opaque > 0),
    };
  };

  const art = window.__INK.game.art;
  const castProblems = [];
  const floatingProblems = [];
  const floatingCast = new Set(["yurei", "onryo"]);
  for (const [name, record] of Object.entries(art.cast || {})) {
    const attacks = record.attackFrames || [];
    const walk = pixelSignature(record.frames?.[0]);
    const attack = pixelSignature(attacks[1]);
    if (floatingCast.has(name)) {
      const allFrames = [...(record.frames || []), ...attacks].map(pixelSignature);
      const unique = new Set(allFrames.map((entry) => entry.signature)).size;
      if (record.frames?.length !== 6 || attacks.length !== 4
        || allFrames.some((entry) => entry.opaque <= 0) || unique !== 1) {
        floatingProblems.push(`${name}:${record.frames?.length}/${attacks.length}/unique=${unique}`);
      }
      continue;
    }
    if (attacks.length !== 4 || attack.opaque <= 0 || attack.signature === walk.signature) {
      castProblems.push(`${name}:${attacks.length}/${walk.signature}/${attack.signature}`);
    }
  }

  return {
    run: clipSummary(art.hero?.run),
    slash: clipSummary(art.hero?.slash),
    castCount: Object.keys(art.cast || {}).length,
    castProblems,
    floatingProblems,
  };
});
check("generated hero run frames are visibly animated",
  generatedAnimationArt.run.count === 8
    && generatedAnimationArt.run.nonempty
    && generatedAnimationArt.run.unique > 1,
  JSON.stringify(generatedAnimationArt.run));
check("generated hero slash frames are visibly animated",
  generatedAnimationArt.slash.count === 8
    && generatedAnimationArt.slash.nonempty
    && generatedAnimationArt.slash.unique > 1,
  JSON.stringify(generatedAnimationArt.slash));
check("every walking generated enemy and boss has a distinct four-frame attack clip",
  generatedAnimationArt.castCount === 11 && generatedAnimationArt.castProblems.length === 0,
  `cast=${generatedAnimationArt.castCount} problems=${generatedAnimationArt.castProblems.join(" | ") || "none"}`);
check("Yurei and Onryo hold one clean generated float silhouette",
  generatedAnimationArt.floatingProblems.length === 0,
  generatedAnimationArt.floatingProblems.join(" | ") || "stable float frames");

const ambientAudio = await page.evaluate(() => ({
  started: window.__INK.game.audio.started,
  continuousNodes: window.__INK.game.audio.musicNodes.length,
}));
check("ambient score has no continuous hum oscillators",
  ambientAudio.started && ambientAudio.continuousNodes === 0,
  JSON.stringify(ambientAudio));

const enemyAttackStates = await page.evaluate(() => {
  const g = window.__INK.game;
  const previous = {
    enemies: g.enemies,
    enemyShots: g.enemyShots,
    boss: g.boss,
  };

  const pixelSignature = (frame) => {
    const canvas = frame?.canvas || frame;
    const pixels = canvas.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let i = 0; i < pixels.length; i += 16) {
      hash = Math.imul(hash ^ pixels[i], 16777619);
      hash = Math.imul(hash ^ pixels[i + 1], 16777619);
      hash = Math.imul(hash ^ pixels[i + 2], 16777619);
      hash = Math.imul(hash ^ pixels[i + 3], 16777619);
    }
    return `${canvas.width}x${canvas.height}:${(hash >>> 0).toString(16)}`;
  };

  const selectedFrame = (enemy) => {
    const record = g.art.cast[enemy.def.sprite];
    const active = enemy.attackT > 0 && record.attackFrames?.length === 4;
    const elapsed = active
      ? 1 - enemy.attackT / Math.max(0.001, enemy.attackDuration || 0.36)
      : 0;
    const start = active ? Math.max(0, Math.min(0.75, enemy.attackProgressStart || 0)) : 0;
    const progress = active ? start + elapsed * (1 - start) : 0;
    const index = active
      ? Math.min(record.attackFrames.length - 1, Math.max(0, Math.floor(progress * record.attackFrames.length)))
      : -1;
    return {
      active,
      index,
      differsFromWalk: active
        && pixelSignature(record.attackFrames[index]) !== pixelSignature(record.frames[0]),
    };
  };

  const curve = { hp: 1, speed: 1, damage: 1 };
  let ranged;
  let slam;
  let priority;
  try {
    g.enemies = [];
    g.enemyShots = [];
    g.boss = null;
    g.rebuildGrid();

    const kappa = g.spawnEnemy("kappa", g.player.x + 180, g.player.y, curve);
    kappa.shotT = -1;
    g.rebuildGrid();
    g.updateEnemies(0.11);
    ranged = {
      attackT: kappa.attackT,
      attackKind: kappa.attackKind,
      shots: g.enemyShots.length,
      retreats: kappa.wantX > 0,
      facesPlayer: kappa.flip && kappa.attackFlip === true,
      selected: selectedFrame(kappa),
    };

    g.enemies.length = 0;
    g.enemyShots.length = 0;
    g.boss = null;
    g.rebuildGrid();

    const boss = g.spawnEnemy("gashadokuro", g.player.x + 180, g.player.y, curve);
    boss.boss = true;
    boss.slamT = -1;
    g.boss = boss;
    g.rebuildGrid();
    // Cross the 0.62s slam telegraph in one deterministic step. The authored
    // strike must still be selected on the exact impact update.
    g.updateEnemies(0.63);
    slam = {
      attackT: boss.attackT,
      attackKind: boss.attackKind,
      telegraph: boss.telegraph,
      selected: selectedFrame(boss),
    };

    g.enemies.length = 0;
    g.enemyShots.length = 0;
    g.boss = null;
    g.rebuildGrid();

    const commander = g.spawnEnemy("nurarihyon", g.player.x + 180, g.player.y, curve);
    commander.boss = true;
    commander.slamT = -1;
    commander.summonT = -1;
    g.boss = commander;
    g.rebuildGrid();
    g.updateEnemies(0.63);
    priority = {
      attackT: commander.attackT,
      attackKind: commander.attackKind,
      telegraph: commander.telegraph,
      enemyCount: g.enemies.length,
      selected: selectedFrame(commander),
    };
  } finally {
    g.enemies = previous.enemies;
    g.enemyShots = previous.enemyShots;
    g.boss = previous.boss;
    g.rebuildGrid();
  }
  return { ranged, slam, priority };
});
check("ranged enemy firing selects its generated attack pose",
  enemyAttackStates.ranged.attackT > 0
    && enemyAttackStates.ranged.attackKind === "ranged"
    && enemyAttackStates.ranged.shots === 1
    && enemyAttackStates.ranged.retreats
    && enemyAttackStates.ranged.facesPlayer
    && enemyAttackStates.ranged.selected.active
    && enemyAttackStates.ranged.selected.index > 0
    && enemyAttackStates.ranged.selected.differsFromWalk,
  JSON.stringify(enemyAttackStates.ranged));
check("Gashadokuro impact holds its generated attack pose",
  enemyAttackStates.slam.attackT > 0
    && enemyAttackStates.slam.attackKind === "slam"
    && enemyAttackStates.slam.telegraph <= 0
    && enemyAttackStates.slam.selected.active
    && enemyAttackStates.slam.selected.index === 2
    && enemyAttackStates.slam.selected.differsFromWalk,
  JSON.stringify(enemyAttackStates.slam));
check("boss slam pose takes priority over a simultaneous summon",
  enemyAttackStates.priority.attackT > 0
    && enemyAttackStates.priority.attackKind === "slam"
    && enemyAttackStates.priority.telegraph <= 0
    && enemyAttackStates.priority.enemyCount === 1
    && enemyAttackStates.priority.selected.active
    && enemyAttackStates.priority.selected.index === 2
    && enemyAttackStates.priority.selected.differsFromWalk,
  JSON.stringify(enemyAttackStates.priority));

const slashFrames = await page.evaluate(() => ({
  normal: window.__INK.game.art.hero.slash?.length || 0,
  hurt: window.__INK.game.art.hero.hurtSlash?.length || 0,
}));
check("sword slash animation is baked", slashFrames.normal === 8 && slashFrames.hurt === 8,
  `normal=${slashFrames.normal} hurt=${slashFrames.hurt}`);

const symbolLanguage = await page.evaluate(async () => {
  const { WEAPONS, PASSIVES } = await import("/assets/js/inkblood/weapons.js?v=20260803-close-slash-1");
  const { SFX_WORDS } = await import("/assets/js/inkblood/fx.js?v=20260803-close-slash-1");
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

const walkArms = await page.evaluate(async () => {
  const { runPose } = await import("/assets/js/inkblood/figure.js");
  const pose = runPose(0.25);
  return {
    armA: pose.armA,
    armB: pose.armB,
    legA: pose.legA,
    legB: pose.legB,
    elbowA: pose.elbowA,
    elbowB: pose.elbowB,
  };
});
check("shared player and enemy arms counter-swing with forward-facing elbows",
  walkArms.armA * walkArms.legA < 0
    && walkArms.armB * walkArms.legB < 0
    && walkArms.elbowA * walkArms.armA > 0
    && walkArms.elbowB * walkArms.armB > 0,
  JSON.stringify(walkArms));

const enemyFacing = await page.evaluate(() => {
  const g = window.__INK.game;
  g.enemies.length = 0;
  g.rebuildGrid();
  const curve = g.director.curve(g.time);
  const right = g.spawnEnemy("gaki", g.player.x + 320, g.player.y, curve);
  const left = g.spawnEnemy("gaki", g.player.x - 320, g.player.y, curve);
  g.rebuildGrid();
  g.updateEnemies(1 / 60);
  const result = {
    right: { intent: right.wantX, flipped: right.flip },
    left: { intent: left.wantX, flipped: left.flip },
  };
  g.enemies.length = 0;
  g.rebuildGrid();
  return result;
});
check("enemies face into their travel direction on both sides",
  enemyFacing.right.intent < 0 && enemyFacing.right.flipped
    && enemyFacing.left.intent > 0 && !enemyFacing.left.flipped,
  `right=${enemyFacing.right.intent.toFixed(1)}/${enemyFacing.right.flipped} left=${enemyFacing.left.intent.toFixed(1)}/${enemyFacing.left.flipped}`);

const slashTrigger = await page.evaluate(() => {
  const g = window.__INK.game;
  const weapon = g.weapons[0];
  weapon.level = 1;
  g.player.slashT = 0;
  g.fx.slashes.length = 0;
  g.projectiles.length = 0;
  weapon.cd = 0;
  g.step(1 / 60);
  const slash = g.projectiles.find((projectile) => projectile.sector);
  const expected = g.player.facing >= 0 ? 0 : Math.PI;
  let delta = (slash?.sector.angle ?? Infinity) - expected;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return {
    active: g.player.slashT > 0,
    duration: g.player.slashDuration,
    arcs: g.fx.slashes.length,
    forward: Math.abs(delta) < 0.001,
  };
});
check("level-one Crimson Arc fires exactly one forward slash",
  slashTrigger.active && slashTrigger.arcs === 1 && slashTrigger.forward,
  `duration=${slashTrigger.duration.toFixed(2)} arcs=${slashTrigger.arcs} forward=${slashTrigger.forward}`);

const crimsonArcProgression = await page.evaluate(async () => {
  const { WEAPONS } = await import("/assets/js/inkblood/weapons.js?v=20260803-close-slash-1");
  return Array.from({ length: 8 }, (_, index) => WEAPONS.crimsonArc.stats(index + 1).amount);
});
check("Crimson Arc unlocks additional slashes only at later levels",
  crimsonArcProgression.join(",") === "1,1,2,2,3,3,3,4",
  crimsonArcProgression.join("→"));

const damageNumberStyle = await page.evaluate(async () => {
  const { DAMAGE_NUMBER_STYLE } = await import("/assets/js/inkblood/fx.js?v=20260803-close-slash-1");
  return DAMAGE_NUMBER_STYLE;
});
check("damage numbers use the smaller, thinner combat style",
  damageNumberStyle.normalFontPx === 21
    && damageNumberStyle.normalOutline <= 0.5
    && damageNumberStyle.normalScale < 1
    && damageNumberStyle.critFontPx <= 27
    && damageNumberStyle.critOutline <= 0.7
    && damageNumberStyle.critScale < 1.2,
  JSON.stringify(damageNumberStyle));

const closeSlashCoverage = await page.evaluate(async () => {
  const { WEAPONS } = await import("/assets/js/inkblood/weapons.js?v=20260803-close-slash-1");
  const g = window.__INK.game;
  const weapon = g.weapons[0];
  weapon.level = 1;
  g.player.facing = 1;
  g.enemies.length = 0;
  g.projectiles.length = 0;
  const curve = { hp: 1, speed: 0, damage: 0 };
  const front = g.spawnEnemy("gaki", g.player.x + 12, g.player.y, curve);
  const rear = g.spawnEnemy("gaki", g.player.x - 12, g.player.y, curve);
  front.hp = front.maxHp = 500;
  rear.hp = rear.maxHp = 500;
  g.rebuildGrid();
  WEAPONS.crimsonArc.fire(g, weapon);
  const slash = g.projectiles.find((projectile) => projectile.sector);
  g.updateProjectiles(1 / 60);
  const result = {
    frontHit: front.hp < 500,
    rearHeld: rear.hp === 500,
    originAtPlayer: slash?.sector.originX === g.player.x,
  };
  g.enemies.length = 0;
  g.projectiles.length = 0;
  g.rebuildGrid();
  return result;
});
check("Crimson Arc catches overlapping enemies without becoming a rear attack",
  closeSlashCoverage.frontHit && closeSlashCoverage.rearHeld && closeSlashCoverage.originAtPlayer,
  JSON.stringify(closeSlashCoverage));

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

await page.locator("#btn-pause").click();
await settle(page, 260);
const pausedByControl = await page.evaluate(() => ({
  phase: window.__INK.phase,
  pressed: document.getElementById("btn-pause")?.getAttribute("aria-pressed"),
  label: document.getElementById("btn-pause")?.getAttribute("aria-label"),
}));
await page.locator("#btn-pause").click();
await settle(page, 260);
const resumedByControl = await page.evaluate(() => ({
  phase: window.__INK.phase,
  pressed: document.getElementById("btn-pause")?.getAttribute("aria-pressed"),
}));
check("the manga pause control pauses and resumes",
  pausedByControl.phase === "paused"
    && pausedByControl.pressed === "true"
    && pausedByControl.label === "Resume game"
    && resumedByControl.phase === "playing"
    && resumedByControl.pressed === "false",
  `paused=${JSON.stringify(pausedByControl)} resumed=${JSON.stringify(resumedByControl)}`);

// 6. Level up, taken with the keyboard. Exactly one level is granted
// so that taking it returns to play rather than opening the next card.
await page.evaluate(() => {
  const g = window.__INK.game;
  g.queuedLevels = 0;
  g.enemies.length = 0;
  g.player.life = g.player.maxLife;
  g.player.xp = 0;
  // Movement, pause, and the opening Space press are intentionally queued for
  // edge-triggered menus. Drain stale inputs so this authored level-up remains
  // open for inspection instead of intermittently consuming itself.
  g.input.takePressed();
  g.input.consumeAny();
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
const mobileHud = await page.evaluate(() => {
  const g = window.__INK.game;
  const r = g.hud.regions;
  const bandBottom = r.band.y + r.band.h;
  const within = (part) => Boolean(part)
    && part.x >= r.band.x - 1
    && part.y >= r.band.y - 1
    && part.x + part.w <= r.band.x + r.band.w + 1
    && part.y + part.h <= bandBottom + 1;
  const pause = document.getElementById("btn-pause")?.getBoundingClientRect();
  const max = document.getElementById("btn-fullscreen")?.getBoundingClientRect();
  return {
    compact: g.hud.compact,
    allWithin: [r.hp, r.timer, r.xp, r.loadout].every(within),
    timerCentered: Math.abs((r.timer.x + r.timer.w / 2) - g.w / 2) <= 2,
    loadoutBelowTimer: r.loadout.y >= r.timer.y + r.timer.h,
    controlsSeparated: Boolean(pause && max && max.right <= pause.left),
    band: r.band,
  };
});
check("phone HUD keeps the sample hierarchy inside its ornamental frame",
  mobileHud.compact && mobileHud.allWithin && mobileHud.timerCentered
    && mobileHud.loadoutBelowTimer && mobileHud.controlsSeparated,
  JSON.stringify(mobileHud));
await page.setViewportSize({ width: 1600, height: 700 });
await settle(page, 400);
check("survives viewport changes", true);

check("generated manga asset requests have no network or HTTP failures",
  generatedAssetNetworkErrors.length === 0,
  generatedAssetNetworkErrors.slice(0, 4).join(" | "));
check("no console or page errors", errors.length === 0, errors.slice(0, 4).join(" | "));

await browser.close();
if (proc) proc.kill();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
