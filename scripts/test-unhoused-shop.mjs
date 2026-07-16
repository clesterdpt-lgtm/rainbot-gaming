// Unhoused and Unhinged — Pawn Cart shop regression test.
// Covers the browsable catalog (weapons / run upgrades / supplies), Dawn Deal
// pricing, measurable upgrade effects, broke/owned rejection, the real ACT
// open-and-close path at the kiosk, night closure, and save/restore of
// upgrades + maxHealth (which previously did not survive saves).
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.UNHOUSED_SHOP_TEST_PORT || (47000 + (process.pid % 16000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/unhoused-and-unhinged.html`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function serverResponds() {
  try {
    return (await fetch(`${baseUrl}/games/unhoused-and-unhinged.html`, { cache: "no-store" })).ok;
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

const hook = (page, expression) => page.evaluate(`(() => { const H = window.__UNHINGED; return ${expression}; })()`);

async function run() {
  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  try {
    await waitForServer();
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !/favicon\.ico|ERR_BLOCKED_BY_ORB|net::/i.test(message.text())) {
        errors.push(`console: ${message.text()}`);
      }
    });

    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__UNHINGED, null, { timeout: 60000 });
    await hook(page, "H.start()");
    await page.waitForFunction(() => window.__UNHINGED.state.running, null, { timeout: 10000 });

    // --- 1. Catalog shape and a rolled Dawn Deal ---------------------------
    let shop = await hook(page, "H.shop()");
    assert(shop.catalog.length === 12, `catalog should list 12 entries, got ${shop.catalog.length}`);
    ["weapon", "upgrade", "restock", "heal", "bundle"].forEach((kind) => {
      assert(shop.catalog.some((entry) => entry.kind === kind), `catalog should include a ${kind} entry`);
    });
    assert(shop.deal && shop.catalog.some((entry) => entry.id === shop.deal.id), "a Dawn Deal should be rolled at run start");

    // --- 2. Real ACT path opens and closes the shop at the kiosk -----------
    shop = await hook(page, "H.openShop(true)");
    assert(shop.opened && shop.open, "ACT at the kiosk should open the shop overlay");
    const overlayShown = await page.evaluate(() => !document.getElementById("shop-overlay").hidden);
    assert(overlayShown, "shop overlay element should be visible when open");
    await delay(600); // let the open cooldown lapse so ACT registers again
    await hook(page, "H.act()");
    const closedAfterAct = await hook(page, "H.shop()");
    assert(!closedAfterAct.open, "pressing ACT with the shop open should close it");

    // --- 3. Broke path rejects without charging ----------------------------
    await hook(page, "H.openShop(true)");
    await hook(page, "H.setCash(1)");
    let result = await hook(page, "H.buy('mop')");
    assert(!result.bought && result.cash === 1, "buying broke should not charge or grant");
    assert(!(await hook(page, "!!H.state.bag.mop")), "mop must not be granted when broke");

    // --- 4. Deal pricing math on a forced deal ------------------------------
    await hook(page, "H.setCash(200)");
    await hook(page, "H.setDeal('chicken')");
    result = await hook(page, "H.buy('chicken')");
    const chickenDealPrice = Math.max(1, Math.round(9 * 0.7));
    assert(result.bought, "chicken should purchase with funds");
    assert(Math.abs(200 - result.cash - chickenDealPrice) < 0.001, `deal should charge $${chickenDealPrice}, cash left ${result.cash}`);
    result = await hook(page, "H.buy('chicken')");
    assert(!result.bought, "owned weapons cannot be re-bought");

    // --- 5. Upgrades apply measurable effects -------------------------------
    const baseSpeed = await hook(page, "H.player.speed");
    result = await hook(page, "H.buy('sneakers')");
    const fastSpeed = await hook(page, "H.player.speed");
    assert(result.bought && Math.abs(fastSpeed - baseSpeed * 1.15) < 0.001, `sneakers should raise speed 15% (${baseSpeed} -> ${fastSpeed})`);

    const maxBefore = await hook(page, "H.state.maxHealth");
    result = await hook(page, "H.buy('jacket')");
    const maxAfter = await hook(page, "H.state.maxHealth");
    assert(result.bought && maxAfter === maxBefore + 25, `jacket should add 25 max health (${maxBefore} -> ${maxAfter})`);

    result = await hook(page, "H.buy('caddy')");
    assert(result.bought, "caddy should purchase");
    await hook(page, "H.giveItem('cone', 30)");
    const coneCount = await hook(page, "H.state.inventory.cone");
    assert(coneCount === 13, `caddy should raise cone cap to 13, got ${coneCount}`);

    result = await hook(page, "H.buy('hype')");
    assert(result.bought, "hype should purchase");
    // Perform away from the kiosk — ACT within SHOP_RADIUS browses the cart
    // instead of busking (same convention as NPC talk radii).
    await hook(page, "H.closeShop()");
    await hook(page, "H.setPlayer(9, 30)");
    await hook(page, "H.placeAudience(4, 5)");
    await delay(600);
    await hook(page, "H.act()");
    const streakWindow = await hook(page, "H.state.actStreakTime");
    assert(Math.abs(streakWindow - 3.6) < 0.2, `hype contract should stretch the streak window to 3.6s, got ${streakWindow}`);

    result = await hook(page, "H.buy('showhat')");
    assert(result.bought && (await hook(page, "H.shop()")).upgrades.showhat, "top hat should be owned after purchase");

    // --- 6. Supplies: heal and bundle actually deliver ----------------------
    await page.evaluate(() => { window.__UNHINGED.state.health = 40; });
    const healthBefore = await hook(page, "H.state.health");
    result = await hook(page, "H.buy('snackpack')");
    const healthAfter = await hook(page, "H.state.health");
    assert(result.bought && healthAfter === healthBefore + 30, `snack should heal 30 (${healthBefore} -> ${healthAfter})`);
    result = await hook(page, "H.buy('nightkit')");
    assert(result.bought, "night kit should purchase");

    // --- 7. Save/restore keeps upgrades, maxHealth, and reapplies speed -----
    const snap = await hook(page, "H.snapshotData()");
    await page.evaluate((data) => window.__UNHINGED.restoreData(data), snap);
    const restored = await hook(page, "H.shop()");
    assert(restored.upgrades.sneakers && restored.upgrades.jacket && restored.upgrades.caddy && restored.upgrades.hype && restored.upgrades.showhat,
      "restore should keep all owned upgrades");
    assert(restored.maxHealth === maxAfter, `restore should keep max health ${maxAfter}, got ${restored.maxHealth}`);
    assert(Math.abs(restored.playerSpeed - baseSpeed * 1.15) < 0.001, "restore should reapply the sneakers speed bonus");

    // --- 8. Night closes the shop; dawn rerolls the deal --------------------
    await hook(page, "H.openShop(true)");
    await hook(page, "H.god(true)");
    await hook(page, "H.skipToNight()");
    shop = await hook(page, "H.shop()");
    assert(!shop.open, "nightfall should close the shop");
    const openAtNight = await hook(page, "H.openShop(true)");
    assert(!openAtNight.opened, "the cart should not open at night");
    await hook(page, "H.skipToDay()");
    shop = await hook(page, "H.shop()");
    assert(shop.deal && !shop.catalog.find((entry) => entry.id === shop.deal.id).owned,
      "dawn should roll a deal on something still buyable");

    // --- 9. New run resets upgrades and base stats --------------------------
    await page.evaluate(() => {
      const H = window.__UNHINGED;
      H.restoreData({ ...H.snapshotData(), upgrades: {}, maxHealth: 100, cash: 7.25 });
    });
    const fresh = await hook(page, "H.shop()");
    assert(Object.keys(fresh.upgrades).length === 0 && fresh.maxHealth === 100 && Math.abs(fresh.playerSpeed - baseSpeed) < 0.001,
      "a reset run should return to base speed and 100 max health");

    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log("Unhoused shop test: catalog browsing, Dawn Deal pricing, all upgrade effects, supplies, save round-trip, and night closure passed");
    await context.close();
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Unhoused shop test failed: ${error.message}`);
  process.exitCode = 1;
});
