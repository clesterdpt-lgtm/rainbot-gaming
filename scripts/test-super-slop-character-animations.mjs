import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const gamePath = path.join(root, "assets/js/super-slop-brothers.js");
const pagePath = path.join(root, "games/super-slop-brothers.html");
const manifestPath = path.join(root, "assets/models/super-slop-brothers/super-slop-character-manifest.json");
const artifactDir = path.join(root, "output/playwright/super-slop-character-animations");
const gameSource = fs.readFileSync(gamePath, "utf8");
const pageSource = fs.readFileSync(pagePath, "utf8");
const failures = [];

const FIGHTERS = ["rainbot", "gigachad", "mrfeast", "skibidi", "sigma", "slopbot"];
const SPECIALS = ["neutral", "side", "up", "down"];
const SPECIAL_TYPES = {
  rainbot: { neutral: "projectile", side: "melee", up: "recovery", down: "reflect" },
  gigachad: { neutral: "melee", side: "melee", up: "recovery", down: "counter" },
  mrfeast: { neutral: "projectile", side: "projectile-burst", up: "recovery", down: "fallobject" },
  skibidi: { neutral: "projectile-burst", side: "melee", up: "recovery", down: "trap" },
  sigma: { neutral: "projectile", side: "melee", up: "recovery", down: "counter" },
  slopbot: { neutral: "projectile-burst", side: "melee", up: "teleport", down: "summon" },
};
const REQUIRED_CLIPS = [
  "idle", "run", "jump", "fall", "hit", "shield", "dodge", "grab", "attack",
  "special-neutral", "special-side", "special-up", "special-down",
];

fs.mkdirSync(artifactDir, { recursive: true });

function check(requirement, condition, detail) {
  let passed = false;
  try {
    passed = typeof condition === "function" ? Boolean(condition()) : Boolean(condition);
  } catch (error) {
    detail = `${detail} (${error.message})`;
  }
  if (!passed) failures.push({ requirement, detail });
}

function abilityMechanicValid(ability, expectedType) {
  if (!ability?.performed || ability.type !== expectedType || !ability.evidence?.length) return false;
  const spawned = ability.spawnedEntities || [];
  switch (expectedType) {
    case "projectile": return spawned.some((entity) => entity.type === "projectile");
    case "projectile-burst": return spawned.filter((entity) => entity.type === "projectile").length >= 3;
    case "melee": return Boolean(ability.attack);
    case "recovery": return Boolean(ability.attack) && ability.velocityChanged;
    case "counter": return ability.counterTimer > 0;
    case "reflect": return ability.reflectTimer > 0;
    case "teleport": return ability.positionChanged && spawned.some((entity) => entity.type === "clone");
    case "fallobject": return spawned.some((entity) => entity.type === "fallobject");
    case "trap": return spawned.some((entity) => entity.type === "trap");
    case "summon": return spawned.some((entity) => entity.type === "dog");
    default: return false;
  }
}

let manifest = null;
if (fs.existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    failures.push({ requirement: "asset manifest", detail: `manifest is invalid JSON: ${error.message}` });
  }
} else {
  failures.push({ requirement: "asset manifest", detail: "assets/models/super-slop-brothers/super-slop-character-manifest.json is missing" });
}

let totalSheetBytes = 0;
for (const fighterId of FIGHTERS) {
  const entry = manifest?.fighters?.find((fighter) => fighter.id === fighterId);
  check("six-fighter provenance", entry, `manifest is missing ${fighterId}`);
  if (!entry) continue;
  check("Meshy generation provenance", /^[0-9a-f-]{20,}$/i.test(entry.meshy?.imageTaskId || ""), `${fighterId} is missing a Meshy image task ID`);
  check("Meshy rig provenance", /^[0-9a-f-]{20,}$/i.test(entry.meshy?.rigTaskId || ""), `${fighterId} is missing a Meshy rig task ID`);
  check("source reference", typeof entry.reference === "string" && fs.existsSync(path.join(root, entry.reference)), `${fighterId} reference image is missing`);

  const rigPath = typeof entry.riggedModel === "string" ? path.join(root, entry.riggedModel) : "";
  const rigBytes = rigPath && fs.existsSync(rigPath) ? fs.statSync(rigPath).size : 0;
  check("processed rig exists", rigBytes > 100_000, `${fighterId} processed rig is missing or empty`);
  check("processed rig budget", rigBytes <= 15 * 1024 * 1024, `${fighterId} processed rig is ${(rigBytes / 1024 / 1024).toFixed(2)} MiB`);

  const sheetPath = typeof entry.spriteSheet === "string" ? path.join(root, entry.spriteSheet) : "";
  const sheetBytes = sheetPath && fs.existsSync(sheetPath) ? fs.statSync(sheetPath).size : 0;
  totalSheetBytes += sheetBytes;
  check("animated sheet exists", sheetBytes > 100_000, `${fighterId} sprite sheet is missing or empty`);
  check("per-sheet budget", sheetBytes <= 3 * 1024 * 1024, `${fighterId} sprite sheet is ${(sheetBytes / 1024 / 1024).toFixed(2)} MiB`);
  check(
    "exact sheet dimensions",
    entry.sheet?.cellSize === 192
      && entry.sheet?.columns === 8
      && entry.sheet?.rows === REQUIRED_CLIPS.length
      && entry.sheet?.framesPerClip === 8
      && entry.sheet?.width === 1536
      && entry.sheet?.height === 2496
      && entry.sheet?.alpha === true,
    `${fighterId} sheet layout is ${JSON.stringify(entry.sheet)}`,
  );
  check("alpha safety margin", entry.sheet?.minimumAlphaMargin >= 6, `${fighterId} minimum alpha margin is ${entry.sheet?.minimumAlphaMargin}`);
  check("zero clipped poses", entry.blender?.atlas?.clippedFrames === 0, `${fighterId} reports ${entry.blender?.atlas?.clippedFrames} clipped frames`);

  for (const [row, clipName] of REQUIRED_CLIPS.entries()) {
    const clip = entry.clips?.[clipName];
    check("complete clip roster", clip && clip.frames === 8 && clip.row === row, `${fighterId} ${clipName} is ${JSON.stringify(clip)}`);
  }
  for (const direction of SPECIALS) {
    const task = entry.meshy?.animationTasks?.[`special-${direction}`];
    check("special motion provenance", task && Number.isInteger(task.actionId) && /^[0-9a-f-]{20,}$/i.test(task.taskId || ""), `${fighterId} special-${direction} lacks Meshy animation provenance`);
  }
}
check("animated roster budget", totalSheetBytes > 0 && totalSheetBytes <= 14 * 1024 * 1024, `animated sheets total ${(totalSheetBytes / 1024 / 1024).toFixed(2)} MiB`);

for (const marker of [
  "FIGHTER_ANIMATIONS",
  "resolveFighterAnimation",
  "startVisualAction",
  "getCharacterAnimationDiagnostics",
  "special-neutral",
  "special-side",
  "special-up",
  "special-down",
]) {
  check("runtime animation contract", gameSource.includes(marker), `runtime is missing ${marker}`);
}
check("cache-busted animation release", /super-slop-brothers\.js\?v=20260716-mobile-max-1/.test(pageSource), "page is not pinned to the current Super Slop release token");

const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const decodedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const absolutePath = path.resolve(root, `.${decodedPath}`);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(absolutePath, (error, body) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": mime[path.extname(absolutePath).toLowerCase()] || "application/octet-stream" });
    response.end(body);
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
let browser;

function watchPage(page, label, issues) {
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) issues.push(`${label} console ${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => issues.push(`${label} page error: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (request.url().startsWith(origin)) issues.push(`${label} request failed: ${request.url()} (${request.failure()?.errorText || "unknown"})`);
  });
  page.on("response", (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) issues.push(`${label} HTTP ${response.status()}: ${response.url()}`);
  });
}

try {
  browser = await chromium.launch({ headless: true });
  const issues = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
  });
  const page = await context.newPage();
  watchPage(page, "desktop", issues);
  await page.goto(`${origin}/games/super-slop-brothers.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SLOP?.getCharacterAnimationDiagnostics, null, { timeout: 15_000 });
  const initial = await page.evaluate(() => window.__SLOP.getCharacterAnimationDiagnostics());
  check("lazy production loading", initial.requested.length === 0 && initial.decodedBytes === 0, `initial assets: ${JSON.stringify(initial)}`);
  await page.evaluate(() => {
    window.__SLOP.setManualClock(true);
    return window.__SLOP.preloadAllCharacterAnimations().then(() => true);
  });
  await page.waitForFunction(() => window.__SLOP.getCharacterAnimationDiagnostics().allReady, null, { timeout: 30_000 });

  const loaded = await page.evaluate(() => window.__SLOP.getCharacterAnimationDiagnostics());
  check("browser sheet loading", loaded.allReady && loaded.missing.length === 0 && loaded.assets.every((asset) => asset.width === 1536 && asset.height === 2496), `browser asset diagnostics: ${JSON.stringify(loaded)}`);

  const visualAudit = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 192;
    const context2d = canvas.getContext("2d", { willReadFrequently: true });
    const result = {};
    for (const [fighterId, asset] of Object.entries(window.__SLOP.FIGHTER_ANIMATIONS)) {
      const cellWidth = asset.image.naturalWidth / asset.columns;
      const cellHeight = asset.image.naturalHeight / asset.rows;
      result[fighterId] = {};
      for (const [clipName, clip] of Object.entries(asset.clips)) {
        let minOpaquePixels = Infinity;
        let minimumMargin = Infinity;
        const signatures = new Set();
        for (let frame = 0; frame < clip.frames; frame++) {
          context2d.clearRect(0, 0, 192, 192);
          context2d.drawImage(asset.image, frame * cellWidth, clip.row * cellHeight, cellWidth, cellHeight, 0, 0, 192, 192);
          const pixels = context2d.getImageData(0, 0, 192, 192).data;
          let minX = 192, minY = 192, maxX = -1, maxY = -1, opaquePixels = 0;
          let signature = 2166136261;
          for (let pixel = 0; pixel < 192 * 192; pixel++) {
            const offset = pixel * 4;
            const alpha = pixels[offset + 3];
            if (alpha > 0) {
              const x = pixel % 192;
              const y = Math.floor(pixel / 192);
              minX = Math.min(minX, x); minY = Math.min(minY, y);
              maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
              opaquePixels++;
            }
            if (pixel % 17 === 0) {
              signature ^= pixels[offset] | (pixels[offset + 1] << 8) | (pixels[offset + 2] << 16) | (alpha << 24);
              signature = Math.imul(signature, 16777619) >>> 0;
            }
          }
          minOpaquePixels = Math.min(minOpaquePixels, opaquePixels);
          minimumMargin = Math.min(minimumMargin, minX, minY, 191 - maxX, 191 - maxY);
          signatures.add(signature);
        }
        result[fighterId][clipName] = {
          minOpaquePixels,
          minimumMargin,
          distinctFrames: signatures.size,
        };
      }
    }
    return result;
  });
  for (const fighterId of FIGHTERS) {
    for (const clipName of REQUIRED_CLIPS) {
      const clip = visualAudit[fighterId]?.[clipName];
      check("decoded pose occupancy", clip?.minOpaquePixels > 250, `${fighterId} ${clipName}: ${JSON.stringify(clip)}`);
      check("decoded pose margin", clip?.minimumMargin >= 6, `${fighterId} ${clipName}: ${JSON.stringify(clip)}`);
      check("decoded frame variation", clip?.distinctFrames >= 2, `${fighterId} ${clipName}: ${JSON.stringify(clip)}`);
    }
  }

  const stateClipMapping = await page.evaluate(() => {
    window.__SLOP.start({ ids: ["rainbot", "gigachad"], stage: "rooftop" });
    const fighter = window.__SLOP.state.fighters[0];
    const reset = () => {
      fighter.onGround = true; fighter.vx = 0; fighter.vy = 0; fighter.state = "idle";
      fighter.hitstun = 0; fighter.dodgeTimer = 0; fighter.shielding = false;
      fighter.attack = null; fighter.attackKind = null; fighter.grabbing = null;
      fighter.grabbedBy = null; fighter.visualAction = null;
    };
    const sample = (name, configure) => {
      reset(); configure();
      return [name, window.__SLOP.getCharacterAnimationDiagnostics().fighters[0].clip];
    };
    return Object.fromEntries([
      sample("idle", () => {}),
      sample("run", () => { fighter.state = "run"; fighter.vx = 180; }),
      sample("jump", () => { fighter.onGround = false; fighter.state = "jump"; fighter.vy = -200; }),
      sample("fall", () => { fighter.onGround = false; fighter.state = "fall"; fighter.vy = 200; }),
      sample("hit", () => { fighter.hitstun = 0.4; fighter.state = "hit"; }),
      sample("shield", () => { fighter.shielding = true; fighter.state = "shield"; }),
      sample("dodge", () => { fighter.dodgeTimer = 0.4; fighter.state = "dodge"; }),
      sample("grab", () => { fighter.grabbing = { target: 1 }; }),
      sample("attack", () => { fighter.attack = { name: "jab", t: 0.1, dur: 0.4 }; fighter.attackKind = "jab"; }),
    ]);
  });
  for (const clipName of REQUIRED_CLIPS.slice(0, 9)) {
    check("authoritative state clip mapping", stateClipMapping[clipName] === clipName, `${clipName} resolved to ${stateClipMapping[clipName]}`);
  }

  for (const fighterId of FIGHTERS) {
    for (const direction of SPECIALS) {
      await page.evaluate((id) => window.__SLOP.start({ ids: [id, id === "rainbot" ? "gigachad" : "rainbot"], stage: "rooftop" }), fighterId);
      const before = await page.evaluate(({ id, direction }) => window.__SLOP.showcaseAbility(id, direction, 0.18), { id: fighterId, direction });
      check("real ability dispatch", abilityMechanicValid(before?.ability, SPECIAL_TYPES[fighterId][direction]), `${fighterId} ${direction}: ${JSON.stringify(before?.ability)}`);
      check("ability clip selection", before?.clip === `special-${direction}` && before?.specialDirection === direction, `${fighterId} ${direction} selected ${before?.clip || "nothing"}`);
      const after = await page.evaluate(() => {
        window.__SLOP.step(4, 1 / 60);
        return window.__SLOP.getCharacterAnimationDiagnostics().fighters.find((fighter) => fighter.slot === 0);
      });
      check("ability frame progression", after?.clip === `special-${direction}` && after.frame !== before.frame, `${fighterId} ${direction} did not advance (${before?.frame} -> ${after?.frame})`);
      await page.locator("#gameCanvas").screenshot({ path: path.join(artifactDir, `${fighterId}-${direction}.png`) });
    }
  }

  const releaseSync = await page.evaluate(() => {
    window.__SLOP.start({ ids: ["rainbot", "gigachad"], stage: "rooftop" });
    return window.__SLOP.showcaseAbility("rainbot", "neutral");
  });
  check(
    "instant-effect release pose",
    releaseSync?.clip === "special-neutral" && releaseSync?.frame >= 1 && releaseSync?.progress >= 0.19,
    JSON.stringify(releaseSync),
  );

  const fourFighterRenderMs = await page.evaluate(() => {
    window.__SLOP.start({ ids: ["rainbot", "gigachad", "mrfeast", "skibidi"], stage: "rooftop" });
    for (const [id, direction] of [["rainbot", "side"], ["gigachad", "neutral"], ["mrfeast", "neutral"], ["skibidi", "side"]]) {
      window.__SLOP.showcaseAbility(id, direction, 0.35);
    }
    const started = performance.now();
    for (let frame = 0; frame < 90; frame++) window.__SLOP.step(1, 1 / 60);
    return (performance.now() - started) / 90;
  });
  check("four-fighter render budget", fourFighterRenderMs < 40, `four-fighter update/draw averaged ${fourFighterRenderMs.toFixed(2)} ms`);

  const freeze = await page.evaluate(() => {
    window.__SLOP.start({ ids: ["rainbot", "gigachad"], stage: "rooftop" });
    window.__SLOP.showcaseAbility("rainbot", "neutral", 0.35);
    const fighter = window.__SLOP.state.fighters[0];
    fighter.hitlag = 0.2;
    const before = window.__SLOP.getCharacterAnimationDiagnostics().fighters[0];
    const clipStartedAt = fighter.visualClipStartedAt;
    const repeated = window.__SLOP.getCharacterAnimationDiagnostics().fighters[0];
    window.__SLOP.step(4, 1 / 60);
    const after = window.__SLOP.getCharacterAnimationDiagnostics().fighters[0];
    return { before, repeated, after, clipStartedAt, clipStartedAfterRead: fighter.visualClipStartedAt };
  });
  check("hitlag animation freeze", freeze.before.frame === freeze.after.frame && freeze.before.progress === freeze.after.progress, JSON.stringify(freeze));
  check("diagnostics are read only", freeze.before.frame === freeze.repeated.frame && freeze.clipStartedAt === freeze.clipStartedAfterRead, JSON.stringify(freeze));

  const desktopLayout = await page.evaluate(() => {
    const rect = document.getElementById("gameCanvas")?.getBoundingClientRect();
    return rect ? { width: rect.width, height: rect.height } : null;
  });
  check("desktop canvas", desktopLayout?.width >= 900 && desktopLayout?.height >= 500, `desktop canvas is ${JSON.stringify(desktopLayout)}`);
  await context.close();

  const lazyContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const lazyPage = await lazyContext.newPage();
  watchPage(lazyPage, "lazy-loader", issues);
  await lazyPage.goto(`${origin}/games/super-slop-brothers.html`, { waitUntil: "domcontentloaded" });
  await lazyPage.waitForFunction(() => window.__SLOP?.getCharacterAnimationDiagnostics, null, { timeout: 15_000 });
  await lazyPage.evaluate(() => window.__SLOP.start({ ids: ["rainbot", "gigachad"], stage: "rooftop" }));
  await lazyPage.waitForFunction(() => window.__SLOP.getCharacterAnimationDiagnostics().ready, null, { timeout: 30_000 });
  await lazyPage.evaluate(() => window.__SLOP.start({ ids: ["mrfeast", "skibidi"], stage: "rooftop" }));
  await lazyPage.waitForFunction(() => window.__SLOP.getCharacterAnimationDiagnostics().ready, null, { timeout: 30_000 });
  const lazySwap = await lazyPage.evaluate(() => window.__SLOP.getCharacterAnimationDiagnostics());
  check(
    "match-scoped decode release",
    JSON.stringify([...lazySwap.requested].sort()) === JSON.stringify(["mrfeast", "skibidi"])
      && lazySwap.decodedBytes <= 32 * 1024 * 1024
      && lazySwap.assets.filter((asset) => ["rainbot", "gigachad"].includes(asset.id)).every((asset) => asset.status === "idle"),
    JSON.stringify(lazySwap),
  );
  await lazyContext.close();

  const fallbackIssues = [];
  const fallback = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await fallback.route("**/animated/rainbot.webp*", (route) => route.abort());
  const fallbackPage = await fallback.newPage();
  fallbackPage.on("console", (message) => {
    const expectedAbort = message.type() === "error" && message.text().includes("Failed to load resource: net::ERR_FAILED");
    if (["error", "warning"].includes(message.type()) && !expectedAbort) fallbackIssues.push(`fallback console ${message.type()}: ${message.text()}`);
  });
  fallbackPage.on("pageerror", (error) => fallbackIssues.push(`fallback page error: ${error.message}`));
  await fallbackPage.goto(`${origin}/games/super-slop-brothers.html`, { waitUntil: "domcontentloaded" });
  await fallbackPage.waitForFunction(() => window.__SLOP?.getCharacterAnimationDiagnostics, null, { timeout: 15_000 });
  await fallbackPage.evaluate(() => {
    window.__SLOP.setManualClock(true);
    window.__SLOP.start({ ids: ["rainbot", "gigachad"], stage: "rooftop" });
  });
  await fallbackPage.waitForFunction(() => {
    const diagnostics = window.__SLOP.getCharacterAnimationDiagnostics();
    return diagnostics.assets.find((asset) => asset.id === "rainbot")?.failed
      && diagnostics.assets.find((asset) => asset.id === "gigachad")?.ready;
  }, null, { timeout: 30_000 });
  const fallbackState = await fallbackPage.evaluate(() => {
    window.__SLOP.step(4, 1 / 60);
    return {
      diagnostics: window.__SLOP.getCharacterAnimationDiagnostics(),
      game: JSON.parse(window.render_game_to_text()),
    };
  });
  check("legacy art fallback", fallbackState.diagnostics.missing.includes("rainbot") && fallbackState.diagnostics.fighters[0]?.fallbackActive && fallbackState.game.screen === "fight", JSON.stringify(fallbackState));
  await fallbackPage.locator("#gameCanvas").screenshot({ path: path.join(artifactDir, "fallback-rainbot.png") });
  check("fallback browser errors", fallbackIssues.length === 0, fallbackIssues.join("\n"));
  await fallback.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const mobilePage = await mobile.newPage();
  watchPage(mobilePage, "mobile", issues);
  await mobilePage.goto(`${origin}/games/super-slop-brothers.html`, { waitUntil: "domcontentloaded" });
  await mobilePage.waitForFunction(() => window.__SLOP?.getCharacterAnimationDiagnostics, null, { timeout: 15_000 });
  await mobilePage.evaluate(() => {
    window.__SLOP.setManualClock(true);
    window.__SLOP.start({ ids: ["rainbot", "gigachad"], stage: "rooftop" });
  });
  await mobilePage.waitForFunction(() => window.__SLOP.getCharacterAnimationDiagnostics().ready, null, { timeout: 30_000 });
  await mobilePage.evaluate(() => window.__SLOP.showcaseAbility("rainbot", "side", 0.5));
  await mobilePage.locator("#gameCanvas").screenshot({ path: path.join(artifactDir, "mobile-rainbot-side.png") });
  const mobileLayout = await mobilePage.evaluate(() => {
    const rect = document.getElementById("gameCanvas")?.getBoundingClientRect();
    const diagnostics = window.__SLOP.getCharacterAnimationDiagnostics();
    const controls = ["ssb-touch-jump", "ssb-touch-special", "ssb-touch-shield"].map((id) => {
      const element = document.getElementById(id);
      const bounds = element?.getBoundingClientRect();
      const style = element ? getComputedStyle(element) : null;
      return { id, visible: !!bounds && bounds.width > 0 && bounds.height > 0 && style?.display !== "none" && style?.visibility !== "hidden" };
    });
    return rect ? {
      width: rect.width,
      height: rect.height,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth,
      controls,
      requested: diagnostics.requested,
      decodedBytes: diagnostics.decodedBytes,
    } : null;
  });
  check("mobile canvas", mobileLayout?.width >= 350 && mobileLayout?.width <= 390 && Math.abs(mobileLayout.width / mobileLayout.height - 16 / 9) < 0.04, `mobile canvas is ${JSON.stringify(mobileLayout)}`);
  check("mobile lazy memory", mobileLayout?.requested.length === 2 && mobileLayout.decodedBytes <= 32 * 1024 * 1024, `mobile assets: ${JSON.stringify(mobileLayout)}`);
  check("mobile controls and overflow", mobileLayout?.scrollWidth <= mobileLayout?.innerWidth + 1 && mobileLayout?.controls.every((control) => control.visible), JSON.stringify(mobileLayout));
  await mobile.close();
  check("browser errors", issues.length === 0, issues.join("\n"));
} catch (error) {
  failures.push({ requirement: "browser regression", detail: error.stack || error.message });
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (failures.length) {
  console.error(`Super Slop character animation regression failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure.requirement}: ${failure.detail}`);
  process.exitCode = 1;
} else {
  console.log("Super Slop character animation regression passed: six Meshy/Blender fighters, 624 decoded poses, 24 real specials, scoped loading/fallback, budgets, desktop/mobile layout, and zero browser errors.");
}
