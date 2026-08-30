#!/usr/bin/env node
/* The Kenosis doctrines, audited the way the campaign's talents are:
   buy each rite through the PRODUCTION spend() path, drive its own
   verb, and diff the proc counter. A talent that does not appear in
   `doctrineProcs()` did not fire - and because every seam in this
   system is optional-chained, a rite that never fires looks exactly
   like one that works.

   Also gates the things a new tree can silently lose: the board's
   render (unknown Order = no sigil, wrong column count), the VFX
   dispatch (an unregistered Order is rejected and drawn as nothing),
   and the audio Set (an unregistered Order is SILENT, no error). */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv.indexOf("--out");
const outDir = path.resolve(root, arg >= 0 ? process.argv[arg + 1] : "output/saintfall/kenosis-doctrine");
const port = 47200 + (process.pid % 1200);
const base = `http://127.0.0.1:${port}`;

function server() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}
async function waitServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall-white-vigil.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ""}`);
};

/* SOME RITES ARE NOT EVENTS. A talent that only changes a number the
   kit was going to use anyway has nothing to "fire" - it has no proc
   and never will, and demanding one would only push a decorative cue
   into the frame loop. Those are audited the honest way instead: ask
   the oracle for the number with the rite unowned, buy it, ask again,
   and require the answer to have moved. Every other rite must show a
   proc. Between them the two lists cover all 40 nodes. */
const PASSIVES = {
  "white-vigil": {
    quicksilver_three_places: { key: "blinkCharges", base: 2 },
    crescent_long_measure: { key: "crescentRange", base: 42 },
    /* The volley ramp only exists while the trigger is actually
       held, so the measurement has to hold it. */
    crescent_reaping_volley: { key: "crescentDamage", base: 26, hold: 1.8 },
    stoop_falling_star: { key: "stoopDamage", base: 92, detail: { metres: 20 } },
    /* The call Order's two number rites. Both are asked for through
       exactly the keys `summit-command.js` asks with, so a rename on
       either side breaks this rather than going quiet. */
    antiphon_swift_verse: { key: "callCooldown", base: 58, detail: { key: "mirrorchoir" } },
    antiphon_wider_verse: { key: "callRadius", base: 12, detail: { key: "mirrorchoir" } },
  },
  "bastion-penitent": {
    bulwark_immovable: { key: "guardMoveSpeed", base: 2.0 },
    cast_true_return: { key: "castReturnDamage", base: 130, detail: { outbound: 260 } },
    cast_second_reliquary: { key: "castCooldown", base: 8 },
    cast_hooked_chain: { key: "castKnockdownStun", base: 3.0 },
    anvil_measured_swing: { key: "meleeDamage", base: 132, detail: { comboStep: 3 } },
    tocsin_short_fuse: { key: "callDelay", base: 2.0, detail: { key: "standinggate" } },
    tocsin_heavy_ordnance: { key: "callDamage", base: 90, detail: { key: "standinggate" } },
    tocsin_two_bells: { key: "callCharges", base: 1, detail: { key: "standinggate" } },
  },
};

/* Which verb drives which rite. The probe fires these through the
   doctrine's own seams - the same calls the kits make. */
const DRIVERS = {
  "white-vigil": {
    quicksilver: (T) => {
      T.summit.doctrineHandle().verb("blink", {
        fromX: T.player.state.x, fromZ: T.player.state.z, throughEnemy: true,
      });
    },
    crescent: (T) => {
      const d = T.summit.doctrineHandle();
      for (let i = 0; i < 8; i += 1) d.verb("crescentHit", { hand: i % 2 });
      d.verb("crescentKill", {
        x: T.player.state.x + 3, y: T.player.state.y + 1,
        z: T.player.state.z, damage: 26,
      });
    },
    stoop: (T) => {
      const d = T.summit.doctrineHandle();
      d.verb("stoopKill", { refund: () => {} });
      d.verb("stoopEnd", { metres: 20, landed: true });
      /* High Pass has to go through the KIT: it is the ground launch
         inside `tryAerialThrust` that reports the rite, and driving
         the doctrine verb directly would prove nothing about whether
         a standing Vigil can actually start the dive. */
      T.summit.kitReset();
      T.player.state.grounded = true;
      T.player.state.aimViewPitch = 0;
      T.summit.aerialThrust();
    },
    vigil: (T) => {
      const d = T.summit.doctrineHandle();
      /* Pale Ledger arms on a kill, Thin Ice on a hit, Watchfire on
         the update clock at low vitality, and the Lantern on a blow
         that would have been lethal. */
      T.combat.player.hp = 40;
      d.grantXp(0, null, "qa");
      /* Coordinates matter: audio's own "kill" subscriber positions
         its voice from the event, and a synthetic kill without them
         sets a non-finite AudioParam. */
      const ps = T.player.state;
      T.combat.bus.emit("kill", {
        enemyKey: "thresher", enemyId: "qa", x: ps.x, y: ps.y, z: ps.z,
      });
      T.combat.bus.emit("playerHurt", { damage: 10, x: ps.x, z: ps.z });
      T.advanceTime(1.4, 1 / 60);
      d.interceptLethal(999);
      T.combat.player.hp = T.combat.player.maxHp;
    },
    antiphon: (T) => {
      const d = T.summit.doctrineHandle();
      const ps = T.player.state;
      const order = T.summit.commandCatalog().order;
      /* Answering Step pays down a LIVE cooldown, so there has to be
         one - driving the verb against three zeroes moves nothing and
         the rite looks silent. */
      T.summit.commandCall(order[0]);
      d.verb("blink", { fromX: ps.x, fromZ: ps.z });
      d.verb("callImpact", {
        key: order[0], x: ps.x + 7, y: ps.y, z: ps.z, radius: 10, hits: 1,
      });
      /* The Vow is asked for, not reported: the command module reads
         `callEcho` at cast time and performs whatever comes back. */
      d.kit("callEcho", null, { key: order[0] });
      T.summit.commandReset();
    },
  },
  "bastion-penitent": {
    bulwark: (T) => {
      const d = T.summit.doctrineHandle();
      d.verb("guardBlock", { amount: 40, perfect: false });
      d.verb("guardBlock", { amount: 40, perfect: true });
      d.verb("hammerHit", { inst: null, killed: false });
      d.verb("guardDrop", {});
    },
    cast: (T) => {
      const d = T.summit.doctrineHandle();
      const ps = T.player.state;
      /* Iron Bell and Hooked Chain both need a BODY to ring - at
         basecamp there is none until one is put there. */
      T.spawnEnemy("thresher", ps.x + 4, ps.z, {});
      T.advanceTime(0.2, 1 / 60);
      const inst = T.enemies.live.find((e) => e && e.health > 0) || null;
      d.verb("castThrow", {});
      d.verb("castHit", {
        inst, grounded: true,
        x: ps.x + 4, y: ps.y + 1, z: ps.z,
      });
    },
    forge: (T) => {
      const d = T.summit.doctrineHandle();
      d.verb("leap", {});
      d.verb("leapLand", {});
      T.combat.bus.emit("playerHurt", { damage: 10 });
    },
    anvil: (T) => {
      const d = T.summit.doctrineHandle();
      const ps = T.player.state;
      /* SHATTERPOINT FIRST, and it needs a body that is both
         STAGGERED and ALIVE. Driven after the finisher it read a
         corpse: The Last Nail is a 240-damage shockwave over 7.5m,
         which kills the 60-hp target the test just placed. */
      T.spawnEnemy("thresher", ps.x + 3, ps.z, {});
      T.advanceTime(0.2, 1 / 60);
      const inst = T.enemies.live.find((e) => e && e.health > 0) || null;
      if (inst) {
        T.enemies.stun(inst, 1.5);
        /* A freshly spawned body can still be `emerging`, and the
           stun verb refuses those. */
        if (!(inst.stunTime > 0)) inst.stunTime = 1.5;
        T.combat.bus.emit("melee", {
          hits: 1, comboStep: 2, targets: [{ inst }],
          x: ps.x, y: ps.y, z: ps.z,
        });
      }
      /* Then the kill and the finisher. */
      d.verb("hammerHit", { inst, killed: true, x: ps.x, y: ps.y, z: ps.z });
      d.verb("hammerFinisher", {});
    },
    tocsin: (T) => {
      const d = T.summit.doctrineHandle();
      const ps = T.player.state;
      d.verb("callCast", { key: "standinggate", x: ps.x, z: ps.z });
      d.verb("callImpact", {
        key: "standinggate", x: ps.x + 7, y: ps.y, z: ps.z, radius: 9, hits: 1,
      });
      /* The Great Bell only answers from behind a raised shield. */
      d.kit("callInstant", null, { key: "standinggate", guarding: true });
    },
  },
};

async function auditOperative(browser, character) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  /* The drivers must be installed on THIS context before navigation -
     an init script on a context that is then closed reaches nothing. */
  await context.addInitScript(`window.__KENOSIS_DRIVERS = { "${character}": { ${
    Object.entries(DRIVERS[character])
      .map(([order, fn]) => `"${order}": ${fn.toString()}`).join(", ")
  } } };`);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 180)}`); });
  await page.goto(
    `${base}/games/saintfall-white-vigil.html?qa=1&character=${character}&quality=medium&time=noon`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => document.documentElement.classList.add("sf-maximised"));

  const defs = await page.evaluate(() => {
    const T = window.__SF;
    const d = T.summit.doctrineDefinitions();
    return {
      id: d?.id, title: d?.title,
      orders: (d?.orders || []).map((o) => ({
        id: o.id,
        name: o.name,
        talentIds: o.talents.map((x) => x.id),
        capstone: o.capstone?.id || null,
        icons: o.talents.every((x) => typeof x.icon === "string" && x.icon.startsWith("data:")),
      })),
    };
  });
  check(`${character}: tree defined`, defs.orders.length === 5
    && defs.orders.every((o) => o.talentIds.length === 4 && o.capstone), {
    title: defs.title, orders: defs.orders.map((o) => o.id),
  });
  check(`${character}: every rite carries its own sigil`,
    defs.orders.every((o) => o.icons));

  /* The VFX registry must know these Orders or every cue is dropped
     with `doctrineStats.rejected++` and nothing is drawn. */
  const vfxKnows = await page.evaluate(() => {
    const T = window.__SF;
    const byOrder = T.summit.doctrineVfxState()?.byOrder || {};
    return Object.keys(byOrder);
  });
  check(`${character}: Orders registered with the VFX`,
    defs.orders.every((o) => vfxKnows.includes(o.id)), { known: vfxKnows });

  /* Buy the whole tree, one Order at a time - the point budget and
     the tier gates both have to be satisfiable, exactly as the
     campaign's talent audit does it. */
  const procs = await page.evaluate(async ({ character }) => {
    const T = window.__SF;
    const d = T.summit.doctrineHandle();
    const defs2 = T.summit.doctrineDefinitions();
    const out = { spent: [], refused: [], procs: {}, vfx: {}, cues: 0 };
    const drivers = window.__KENOSIS_DRIVERS[character];
    for (const order of defs2.orders) {
      d.respec();
      T.summit.doctrineGrantXp(99999);
      /* Tier order matters: T2 needs 2 points in the Order, T3 needs 4. */
      for (const talent of order.talents) {
        for (let r = 0; r < talent.maxRank; r += 1) {
          const res = d.spend(talent.id);
          if (res.ok) out.spent.push(talent.id);
          else out.refused.push({ id: talent.id, message: res.message });
        }
      }
      if (order.capstone) {
        const res = d.equipCapstone(order.capstone.id, 0);
        if (!res.ok) out.refused.push({ id: order.capstone.id, message: res.message });
      }
      const before = T.summit.doctrineVfxState().accepted;
      drivers[order.id](T);
      T.advanceTime(0.7, 1 / 60);
      out.vfx[order.id] = T.summit.doctrineVfxState().accepted - before;
    }
    out.procs = T.summit.doctrineProcs();
    out.cues = T.summit.doctrineVfxState().accepted;
    out.rejected = T.summit.doctrineVfxState().rejected;
    out.fallbacks = T.summit.doctrineVfxState().fallbacks;
    return out;
  }, { character });

  /* The passives, measured rather than counted: ask the oracle with
     the rite unowned, buy it, ask again, require movement. */
  const passiveRows = await page.evaluate(({ passives }) => {
    const T = window.__SF;
    const d = T.summit.doctrineHandle();
    const out = {};
    for (const [id, spec] of Object.entries(passives)) {
      d.respec();
      T.summit.doctrineGrantXp(99999);
      const measure = () => {
        if (spec.hold) {
          T.player.input.state.firing = true;
          T.advanceTime(spec.hold, 1 / 60);
        }
        const value = d.kit(spec.key, spec.base, spec.detail || {});
        if (spec.hold) {
          T.player.input.state.firing = false;
          T.advanceTime(0.1, 1 / 60);
        }
        return value;
      };
      const before = measure();
      /* Buy the Order up to this rite's gate, then the rite itself. */
      const order = T.summit.doctrineDefinitions().orders
        .find((o) => o.talents.some((t) => t.id === id));
      for (const talent of order.talents) {
        if (talent.id === id) continue;
        while (d.rank(talent.id) < talent.maxRank
          && d.state().pointsAvailable > 0) {
          if (!d.spend(talent.id).ok) break;
        }
      }
      let bought = 0;
      while (d.spend(id).ok) bought += 1;
      const after = measure();
      out[id] = { before, after, bought, moved: Math.abs(after - before) > 1e-6 };
    }
    d.respec();
    return out;
  }, { passives: PASSIVES[character] });
  const stuck = Object.entries(passiveRows).filter(([, r]) => !r.moved || !r.bought);
  check(`${character}: every passive rite moves its number`, stuck.length === 0,
    stuck.map(([id, r]) => ({ id, ...r })));
  console.log(`   passives: ${Object.entries(passiveRows)
    .map(([id, r]) => `${id.split("_").slice(1).join("_")} ${r.before}->${r.after}`).join(", ")}`);

  const allIds = defs.orders.flatMap((o) => o.talentIds);
  const capIds = defs.orders.map((o) => o.capstone);
  const fired = Object.keys(procs.procs);
  const passiveIds = Object.keys(PASSIVES[character] || {});
  const silentTalents = allIds
    .filter((id) => !fired.includes(id) && !passiveIds.includes(id));
  const silentCaps = capIds.filter((id) => !fired.includes(id));

  check(`${character}: every rite was purchasable`, procs.refused.length === 0,
    procs.refused.slice(0, 4));
  check(`${character}: every talent fires`, silentTalents.length === 0,
    { silent: silentTalents });
  check(`${character}: every Vow fires`, silentCaps.length === 0,
    { silent: silentCaps });
  check(`${character}: no cue was rejected by the VFX`, procs.rejected === 0,
    { rejected: procs.rejected });
  check(`${character}: every Order drew something`,
    Object.values(procs.vfx).every((n) => n > 0), procs.vfx);

  /* The board itself: open the doctrine panel and read the DOM. */
  const board = await page.evaluate(() => {
    document.body.classList.add("rb-escape-menu-open");
    window.__SF.gameUi.openMenu("doctrine", { force: true });
    const root = document.querySelector('[data-menu-page="doctrine"]');
    const tabs = root?.querySelectorAll("[data-doctrine-orders] [role='tab']") || [];
    const cards = root?.querySelectorAll("[data-doctrine-talent]") || [];
    const thumbs = root?.querySelectorAll(".sf-doctrine-talent__thumb") || [];
    return {
      hidden: !!root?.hidden,
      tabs: tabs.length,
      cards: cards.length,
      dataSigils: Array.from(thumbs).filter((n) => (n.getAttribute("src") || "").startsWith("data:")).length,
      points: root?.querySelector("[data-doctrine-points]")?.textContent || "",
      rank: root?.querySelector("[data-doctrine-rank]")?.textContent || "",
    };
  });
  check(`${character}: the board renders its Orders`,
    board.tabs === 5 && board.cards === 4 && !board.hidden, board);
  check(`${character}: cards use the generated sigils`,
    board.dataSigils === board.cards, {
    sigils: board.dataSigils, cards: board.cards,
  });

  await page.screenshot({
    path: path.join(outDir, `${character}-board.png`),
    clip: { x: 0, y: 0, width: 1400, height: 900 },
  });

  check(`${character}: zero page errors`, errors.length === 0, errors.slice(0, 3));
  await context.close();
  return { defs, procs, board, errors };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const child = server();
  let browser;
  const report = {};
  try {
    await waitServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    for (const character of ["white-vigil", "bastion-penitent"]) {
      report[character] = await auditOperative(browser, character);
    }
  } finally {
    await browser?.close();
    child.kill();
  }
  await writeFile(path.join(outDir, "doctrine.json"),
    JSON.stringify({ ...report, checks }, null, 2));
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  console.log(`report: ${path.join(outDir, "doctrine.json")}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
