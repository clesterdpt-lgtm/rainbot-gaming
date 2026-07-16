// Unhoused and Unhinged — objectives regression test.
// Covers the crowd-gathering fix (act favors are actually completable), the
// rotating district-favor deck, the new favor kinds, and the NPC street-gig
// system (accept → progress → hand-in for all three quest-givers, plus
// day/night visibility and save/restore round-trip).
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.UNHOUSED_TEST_PORT || (46000 + (process.pid % 16000)));
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

    // --- 1. Rotating deck exists and dealt a valid day-1 favor -------------
    const pool = await hook(page, "H.favorPool()");
    assert(pool.length >= 10, `favor pool should have 10+ entries, got ${pool.length}`);
    const day1Favor = await hook(page, "H.favor()");
    assert(day1Favor.active && pool.includes(day1Favor.active.id), "day 1 should deal a favor from the pool");
    const deckAfterDay1 = await hook(page, "H.favorDeck()");
    assert(deckAfterDay1.length === pool.length - 1, `deck should hold ${pool.length - 1} after day 1 draw, got ${deckAfterDay1.length}`);

    // --- 2. Crowd fix: the old first favor is now actually completable -----
    // Reproduce the reported failure: stand in Busk Park needing a 4-person
    // crowd, with civilians only loitering *outside* the paying radius. The
    // attract ring + watcher approach should pull them in within a few acts.
    await hook(page, "H.setFavor('busk-park-crowd', true)");
    await hook(page, "H.scatterAudience(60)");
    await hook(page, "H.placeAudience(6, 16)");
    let crowdOk = null;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const snap = await hook(page, "H.act()");
      const favor = await hook(page, "H.favor()");
      if (favor.active.progress >= 1 && snap.lastAudience.watching >= 4) {
        crowdOk = { attempt, watching: snap.lastAudience.watching, progress: favor.active.progress };
        break;
      }
      await delay(700);
    }
    assert(crowdOk, "civilians never gathered into a 4-person crowd in Busk Park (favor stuck at 0)");

    // --- 3. New favor kinds complete through progressFavor -----------------
    for (const id of ["slip-patrol", "streak-hot-hand", "tip-rush-circus", "fountain-splash-show"]) {
      await hook(page, `H.setFavor('${id}', true)`);
      const ticked = await hook(page, "H.tickFavor()");
      assert(ticked.active && ticked.active.completed, `favor ${id} did not complete via its progress path`);
    }

    // --- 4. NPC quest-givers exist, visible by day, offering gigs ----------
    const npcList = await hook(page, "H.npcs()");
    assert(npcList.length === 3, `expected 3 quest-givers, got ${npcList.length}`);
    npcList.forEach((npc) => {
      assert(npc.visible, `${npc.id} should be visible by day`);
      assert(npc.marker === "GIG!", `${npc.id} should advertise a gig, marker=${npc.marker}`);
    });

    // --- 5. Granny delivery gig end-to-end (accept → fetch → hand in) ------
    await hook(page, "H.setStars(0)"); // leftover heat from the crowd section draws cops
    let gig = await hook(page, "H.talkTo('granny-boombox')");
    assert(gig.active && gig.active.questId === "granny-snack-run", `day 1 Granny gig should be the snack run, got ${gig.active && gig.active.questId}`);
    for (let i = 0; i < 3; i += 1) {
      const before = await hook(page, "H.npcQuest().active");
      if (before.stage === "return") break; // stray day-spawned snacks can finish early
      const spot = await hook(page, "H.spawnPickupNear('snack', 3)");
      // Re-center on the spot while polling — passing cars can shove the
      // player off the pickup before its 1.5u collect radius triggers.
      let counted = false;
      for (let poll = 0; poll < 16 && !counted; poll += 1) {
        await hook(page, `H.setPlayer(${spot.x}, ${spot.z})`);
        await delay(250);
        const active = await hook(page, "H.npcQuest().active");
        counted = !!active && (active.progress >= before.progress + 1 || active.stage === "return");
      }
      if (!counted) {
        const debug = await page.evaluate(() => ({
          quest: window.__UNHINGED.npcQuest(),
          player: { x: window.__UNHINGED.player.x, z: window.__UNHINGED.player.z },
          pickups: window.__UNHINGED.pickups(),
        }));
        throw new Error(`snack ${i + 1} never counted; spot=${JSON.stringify(spot)} debug=${JSON.stringify(debug)}`);
      }
    }
    gig = await hook(page, "H.npcQuest()");
    assert(gig.active.stage === "return", "snack run should flip to hand-in stage at 3/3");
    const cashBeforeGranny = await hook(page, "H.state.cash");
    gig = await hook(page, "H.talkTo('granny-boombox')");
    assert(gig.active === null, "hand-in should clear the active gig");
    assert(gig.done["granny-boombox"] === 1, "Granny should be marked done for cycle 1");
    const ownsBoombox = await hook(page, "!!H.state.bag.boombox");
    assert(ownsBoombox, "Granny's first hand-in should gift the boombox");
    void cashBeforeGranny;

    // --- 6. Exclusivity + Dave's sermon tour ------------------------------
    gig = await hook(page, "H.talkTo('prophet-dave')");
    assert(gig.active && gig.active.questId === "dave-sermon-tour", "Dave should offer the sermon tour on day 1");
    gig = await hook(page, "H.talkTo('granny-boombox')");
    assert(gig.active && gig.active.npcId === "prophet-dave", "talking to Granny mid-gig must not replace Dave's gig");
    const maxHealthBefore = await hook(page, "H.state.maxHealth");
    // One paid act per district; spots are walkable plazas, not raw district
    // centers (Pawn Alley's center sits inside a building footprint).
    for (const [index, district] of [{ x: -84, z: -60 }, { x: -118, z: 68 }, { x: 80, z: -8 }].entries()) {
      await hook(page, `H.setPlayer(${district.x}, ${district.z})`);
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await hook(page, "H.placeAudience(4, 5)");
        await delay(650);
        await hook(page, "H.act()");
        const progressNow = await hook(page, "H.npcQuest().active.progress");
        if (progressNow >= index + 1) break;
      }
    }
    gig = await hook(page, "H.npcQuest()");
    assert(gig.active && gig.active.stage === "return", `sermon tour should be ready to hand in, got ${JSON.stringify(gig.active)}`);
    gig = await hook(page, "H.talkTo('prophet-dave')");
    const maxHealthAfter = await hook(page, "H.state.maxHealth");
    assert(gig.active === null && maxHealthAfter === maxHealthBefore + 10, `Dave's blessing should add 10 max health (${maxHealthBefore} -> ${maxHealthAfter})`);

    // --- 7. Marv's crowd gig, then night hides the regulars ----------------
    gig = await hook(page, "H.talkTo('mascot-marv')");
    assert(gig.active && gig.active.questId === "marv-encore", "Marv should offer the encore gig on day 1");
    await hook(page, "H.setPlayer(9, 30)");
    await hook(page, "H.placeAudience(6, 4)");
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await delay(650);
      await hook(page, "H.act()");
      gig = await hook(page, "H.npcQuest()");
      if (gig.active && gig.active.stage === "return") break;
      if (attempt % 3 === 2) await hook(page, "H.placeAudience(6, 4)");
    }
    assert(gig.active && gig.active.stage === "return", "Marv's encore should complete with a packed Circus crowd");
    gig = await hook(page, "H.talkTo('mascot-marv')");
    assert(gig.active === null && gig.done["mascot-marv"] === 1, "Marv hand-in should complete and mark him done for the day");

    await hook(page, "H.skipToNight()");
    const npcsAtNight = await hook(page, "H.npcs()");
    npcsAtNight.forEach((npc) => assert(!npc.visible, `${npc.id} should be hidden at night`));
    const nightObjective = await hook(page, "H.objectiveText()");
    assert(/Survive/i.test(nightObjective), `night objective should be the survival line, got "${nightObjective}"`);

    // --- 8. Day 2: favor rotates, per-NPC gigs rotate ----------------------
    await hook(page, "H.god(true)");
    await hook(page, "H.skipToDay()");
    const day2Favor = await hook(page, "H.favor()");
    assert(day2Favor.active && day2Favor.active.id !== "busk-park-crowd", "day 2 favor should be a fresh draw (setFavor overrides aside)");
    const npcsDay2 = await hook(page, "H.npcs()");
    npcsDay2.forEach((npc) => assert(npc.visible, `${npc.id} should be back out at dawn`));
    gig = await hook(page, "H.talkTo('mascot-marv')");
    assert(gig.active && gig.active.questId === "marv-hot-streak", `day 2 Marv gig should rotate to the streak, got ${gig.active && gig.active.questId}`);
    // Step out of Marv's talk radius — ACT next to a quest-giver talks
    // instead of performing (same convention as the Pawn Cart).
    await hook(page, "H.setPlayer(9, 30)");
    for (let attempt = 0; attempt < 14; attempt += 1) {
      await hook(page, "H.setStars(0)");
      await hook(page, "H.placeAudience(6, 4)");
      await delay(600);
      await hook(page, "H.act()");
      gig = await hook(page, "H.npcQuest()");
      if (gig.active && gig.active.stage === "return") break;
    }
    assert(gig.active && gig.active.stage === "return", "x5 streak gig should complete with rapid acts");
    gig = await hook(page, "H.talkTo('mascot-marv')");
    assert(gig.active === null, "streak gig hand-in should clear");

    // --- 9. Save snapshot round-trips gigs, favor, and deck ----------------
    gig = await hook(page, "H.talkTo('prophet-dave')");
    assert(gig.active && gig.active.questId === "dave-donation-drive", "day 2 Dave gig should rotate to the donation drive");
    const beforeSnap = await page.evaluate(() => {
      const H = window.__UNHINGED;
      return { snap: H.snapshotData(), favor: H.favor(), deck: H.favorDeck(), gig: H.npcQuest() };
    });
    const restored = await page.evaluate((snap) => {
      const H = window.__UNHINGED;
      H.restoreData(snap);
      return { favor: H.favor(), deck: H.favorDeck(), gig: H.npcQuest(), npcs: H.npcs() };
    }, beforeSnap.snap);
    assert(restored.gig.active && restored.gig.active.questId === beforeSnap.gig.active.questId, "restore should keep the active gig");
    assert(restored.favor.active && restored.favor.active.id === beforeSnap.favor.active.id, "restore should keep the active favor");
    assert(restored.deck.join(",") === beforeSnap.deck.join(","), "restore should keep the favor deck order");
    assert(restored.npcs.every((npc) => npc.visible), "restore into daytime should show the quest-givers");

    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log("Unhoused objectives test: crowd gathering, rotating favor deck, new favor kinds, and all three NPC gig flows passed");
    await context.close();
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Unhoused objectives test failed: ${error.message}`);
  process.exitCode = 1;
});
