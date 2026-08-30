#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const PORT = 49954;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

const findings = [];
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) findings.push(label);
};

try {
  for (let i = 0; i < 150; i += 1) {
    try { const r = await fetch(`${BASE}/games/saintfall.html`); if (r.ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 810 } })).newPage();

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });

  const results = await page.evaluate(async () => {
    const T = window.__SF;
    const ctx = T.ctx;
    const audio = ctx.audio;

    // Start music
    audio.startMusic?.();

    // 1. Initial exploration state (no boss active)
    for (let i = 0; i < 100; i += 1) {
      audio.update(0.016, ctx.player, ctx.camera);
    }
    const initialStats = audio.stats();

    // 2. Engage Winnower boss
    ctx.winnower?.ensureSpawned?.();
    ctx.winnower?.forcePhase?.("soar", 15);
    for (let i = 0; i < 100; i += 1) {
      audio.update(0.016, ctx.player, ctx.camera);
    }
    const bossStats = audio.stats();

    // 3. Disengage / Dormant boss
    ctx.winnower?.forcePhase?.("dormant", 0);
    for (let i = 0; i < 100; i += 1) {
      audio.update(0.016, ctx.player, ctx.camera);
    }
    const explorationStats = audio.stats();

    // 4. Test paused state
    await audio.setPaused?.(true);
    const pausedStats = audio.stats();

    await audio.setPaused?.(false);
    const resumedStats = audio.stats();

    // 5. Test setEnabled false
    audio.setEnabled?.(false);
    const disabledStats = audio.stats();

    audio.setEnabled?.(true);
    const reEnabledStats = audio.stats();

    // 6. Test Volume Settings & UI
    const defaultVolumes = audio.stats().volumes;

    // Test individual volume changes via gameUi
    const ui = window.__SF.ctx.gameUi;
    ui?.setSetting?.("musicVolume", 0.5);
    const musicChangedStats = audio.stats();

    ui?.setSetting?.("sfxVolume", 0.4);
    const sfxChangedStats = audio.stats();

    ui?.setSetting?.("masterVolume", 0.7);
    const masterChangedStats = audio.stats();

    const currentUiSettings = ui?.settingsState?.() || {};

    return {
      initialStats,
      bossStats,
      explorationStats,
      pausedStats,
      resumedStats,
      disabledStats,
      reEnabledStats,
      defaultVolumes,
      musicChangedStats,
      sfxChangedStats,
      masterChangedStats,
      currentUiSettings,
    };
  });

  console.log("\n=== SAINTFALL MUSIC CHECKS ===");
  check(results.initialStats.music.started === true, "Music system starts successfully", `started=${results.initialStats.music.started}`);
  check(results.initialStats.music.bossActive === false, "Exploration mode active when no boss engaged", `bossActive=${results.initialStats.music.bossActive}`);
  check(results.initialStats.music.bgVol > 0.8, "Exploration track (Ashes Over Arrakis) volume rises to full", `bgVol=${results.initialStats.music.bgVol}`);
  check(results.initialStats.music.bossVol < 0.05, "Boss track (Iron Chapel March) remains silent during exploration", `bossVol=${results.initialStats.music.bossVol}`);

  check(results.bossStats.music.bossActive === true, "Boss combat state detected upon boss encounter", `bossActive=${results.bossStats.music.bossActive}`);
  check(results.bossStats.music.bossVol > 0.8, "Boss track (Iron Chapel March) fades up during combat", `bossVol=${results.bossStats.music.bossVol}`);
  check(results.bossStats.music.bgVol < 0.05, "Exploration track (Ashes Over Arrakis) fades out during combat", `bgVol=${results.bossStats.music.bgVol}`);

  check(results.explorationStats.music.bossActive === false, "Exploration resumes when boss fight ends", `bossActive=${results.explorationStats.music.bossActive}`);
  check(results.explorationStats.music.bgVol > 0.8, "Exploration track cross-fades back up", `bgVol=${results.explorationStats.music.bgVol}`);

  check(results.pausedStats.paused === true, "Audio pause state tracks cleanly", `paused=${results.pausedStats.paused}`);
  check(results.disabledStats.music.bgVol === 0 || results.disabledStats.music.bgPlaying === false, "Audio disable pauses/mutes music", `bgPlaying=${results.disabledStats.music.bgPlaying}`);

  console.log("\n=== SAINTFALL VOLUME SETTINGS CHECKS ===");
  check(results.defaultVolumes.music === 0.8, "Music default volume is turned down by 20% (0.80)", `musicVol=${results.defaultVolumes.music}`);
  check(results.defaultVolumes.master === 1.0, "Master default volume is 1.0", `masterVol=${results.defaultVolumes.master}`);
  check(results.defaultVolumes.sfx === 1.0, "SFX default volume is 1.0", `sfxVol=${results.defaultVolumes.sfx}`);

  check(results.musicChangedStats.volumes.music === 0.5, "Music volume setting scales cleanly", `musicVol=${results.musicChangedStats.volumes.music}`);
  check(results.sfxChangedStats.volumes.sfx === 0.4, "SFX volume setting scales cleanly", `sfxVol=${results.sfxChangedStats.volumes.sfx}`);
  check(results.masterChangedStats.volumes.master === 0.7, "Master volume setting scales cleanly", `masterVol=${results.masterChangedStats.volumes.master}`);
  check(results.currentUiSettings.musicVolume === 0.5, "UI settings state tracks music volume", `musicVol=${results.currentUiSettings.musicVolume}`);

  check(pageErrors.length === 0, "Zero page errors during dynamic music transitions", pageErrors.join("; "));

  await browser.close();
} finally {
  server.kill("SIGTERM");
}

if (findings.length > 0) {
  console.error(`\nFAILED: ${findings.length} check(s)`);
  process.exit(1);
} else {
  console.log("\nALL MUSIC CHECKS PASSED!");
  process.exit(0);
}
