#!/usr/bin/env node
/* ============================================================
   SAINTFALL - doctrine talent audit

   "Are the talents actually working?" cannot be answered by reading
   the code. Every cross-system call in progression.js goes through
   optional chaining (`ctx.weapons?.coolHeat?.()`), so a talent whose
   target is missing, whose trigger is never reached, or whose
   condition can never be true fails SILENTLY and reads exactly like
   one that works. The config even carries an `implemented: true`
   flag for all 25, which is an assertion, not evidence.

   So this drives the real game. Talents are bought through the
   production `spend()` path, one ORDER at a time (a respec between
   orders, because the point budget and the tier prerequisites both
   have to be satisfied for the buy to be legal), then each talent's
   own trigger is performed with the verb it actually keys on -
   precision hits aimed at the head sphere from `combat.hitbox`, a
   vent started inside the 85-99% heat band, a melee combo long
   enough to reach the third step, a block held until the dome forms.

   The verdict comes from `state().effects.feedback.counts`, which
   progression increments inside `cue()` on every authoritative proc.
   A talent absent from that map did not fire. Each scenario is
   named, so a zero is distinguishable from "never attempted".

   Usage:
     node scripts/saintfall-talent-audit.mjs
     node scripts/saintfall-talent-audit.mjs --order censer
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(root, "output/saintfall/talents");
const argv = process.argv.slice(2);
const ONLY = argv.includes("--order") ? argv[argv.indexOf("--order") + 1] : null;
const PORT = 50400 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) return; }
    catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

/* Runs inside the page. Kept as one function so it can be handed to
   evaluate() whole. */
function auditInPage(only) {
  const T = window.__SF;
  const notes = [];
  T.maximize();
  const boot = document.getElementById("sf-boot");
  if (boot && boot.parentNode) boot.parentNode.removeChild(boot);
  /* NOT invulnerable. `hurtPlayer` returns on the invulnerable flag
     BEFORE it reaches the Aegis path, so a harness that switches it on
     can never register a shield block - and every halo talent keys on
     exactly that. The trooper is instead topped back up between steps,
     which keeps them alive without disabling the code under test. */
  T.invulnerable(false);
  T.autoStow(false);

  const keepAlive = () => {
    const p = T.combat.player;
    p.dead = false;
    p.hp = p.maxHp;
  };
  const adv = (s) => { T.advanceTime(s, 1 / 60); keepAlive(); };
  const HOME = { x: -14, z: 700 };

  function reset() {
    for (const e of [...(T.enemies.live || [])]) {
      try { T.combat.damageEnemy(e, 99999, { source: "qa-clear" }); } catch (_) {}
    }
    adv(0.5);
    T._teleportRaw(HOME.x, HOME.z, 0);
    T.setShieldInput(false);
    T.setJetInput(false);
    try { T.weapons.resupply?.(); } catch (_) { /* optional */ }
    adv(0.6);
  }

  function ring(key, n, r) {
    const p = T.player.position;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      T.spawnEnemy(key, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
    }
    adv(0.35);
  }

  /** Aim at a live enemy's HEAD sphere and fire: several talents key
   *  on `event.head`, and a body shot simply is not a precision hit. */
  function precisionShot(key = "gleaner") {
    let live = (T.enemies.live || []).filter((e) => e.state !== "death");
    let target = live.find((e) => e.key === key) || live[0];
    if (!target) {
      ring(key, 1, 10);
      live = (T.enemies.live || []).filter((e) => e.state !== "death");
      target = live.find((e) => e.key === key) || live[0];
    }
    if (!target) return false;
    const box = T.combat.hitbox[target.key] || T.combat.hitbox.thresher;
    const yaw = target.yaw || 0;
    const fz = box.headZ || 0;
    T.aimAt(target.x + Math.sin(yaw) * fz, target.y + box.head,
      target.z + Math.cos(yaw) * fz, 14);
    T.pullTrigger();
    adv(0.18);
    return true;
  }

  function heatTo(pct) {
    for (let i = 0; i < 80; i += 1) {
      if (T.weapons.heatState().heat >= pct) break;
      T.pullTrigger();
      adv(0.08);
    }
    return T.weapons.heatState().heat;
  }

  /* main.js borrows the melee rite before swinging; calling
     player.meleeSwing() alone leaves the lance in its ranged mode and
     the strike never resolves as melee - which is why an earlier run
     showed every Procession talent dead. Replicate the real path. */
  function meleeAt(times, key = "thresher") {
    ring(key, 4, 1.8);
    for (let i = 0; i < times; i += 1) {
      try { T.weapons.setMode("melee"); } catch (_) { /* already melee */ }
      T.meleeSwing();
      adv(0.42);
    }
    try { T.weapons.setMode("ranged"); } catch (_) { /* fine */ }
  }

  function blockHits(seconds, n = 9) {
    ring("thresher", n, 1.9);
    T.setShieldInput(true);
    adv(seconds);
    T.setShieldInput(false);
    adv(0.8);
  }

  const S = {
    censer_rite_of_censure() {
      ring("gleaner", 1, 9);
      precisionShot("gleaner");
      const live = (T.enemies.live || []).filter((e) => e.state !== "death");
      const t = live[0];
      if (t) { T._teleportRaw(t.x, t.z - 1.5, 0); adv(0.25); T.meleeSwing(); adv(0.6); }
    },
    censer_ashen_rebuke() {
      ring("thresher", 6, 3.6);
      notes.push(`ashen_rebuke vented at heat ${(heatTo(0.9) * 100).toFixed(0)}%`);
      T.weapons.vent();
      adv(1.9);
    },
    censer_gold_nail() {
      ring("gleaner", 1, 9);
      precisionShot("gleaner");
      T.pullTrigger();
      adv(0.5);
    },
    censer_furnace_reprieve() {
      ring("thresher", 3, 6);
      notes.push(`furnace_reprieve killed at heat ${(heatTo(0.8) * 100).toFixed(0)}%`);
      const live = (T.enemies.live || []).filter((e) => e.state !== "death");
      if (live[0]) T.combat.damageEnemy(live[0], 99999, { source: "shot" });
      adv(0.7);
    },
    censer_martyrs_furnace() {
      ring("thresher", 4, 5);
      notes.push(`martyrs_furnace redline heat ${(heatTo(1.0) * 100).toFixed(0)}%`);
      adv(0.5);
      T.weapons.vent();
      adv(2.2);
    },

    procession_hooking_step() { meleeAt(3); },
    procession_third_toll() { meleeAt(7); },
    procession_executioners_measure() {
      meleeAt(4);
      T.pullTrigger();
      adv(0.5);
    },
    procession_processional_mercy() { meleeAt(7); },
    procession_endless_litany() { meleeAt(9); },

    wing_wingbeat_conversion() {
      T.triggerBoost(0, -1);
      adv(0.9);
      T.pullTrigger();
      adv(0.6);
    },
    wing_falling_gospel() {
      ring("thresher", 3, 7);
      T.setJetInput(true);
      adv(1.5);
      const live = (T.enemies.live || []).filter((e) => e.state !== "death");
      if (live[0]) T.combat.damageEnemy(live[0], 99999, { source: "shot" });
      adv(0.7);
      T.setJetInput(false);
      adv(1.3);
    },
    wing_gravitic_wake() {
      T.setJetInput(true);
      adv(1.4);
      ring("thresher", 5, 3.4);
      T.slam.trigger();
      adv(2.2);
      T.setJetInput(false);
      adv(1.0);
    },
    wing_rams_halo() {
      ring("thresher", 6, 3.8);
      T.triggerBoost(0, -1);
      adv(1.7);
    },
    wing_unbroken_circuit() {
      T.triggerBoost(0, -1); adv(1.0);
      T.setJetInput(true); adv(1.3);
      ring("thresher", 5, 3.4);
      T.slam.trigger(); adv(1.5);
      T.setJetInput(false); adv(0.9);
      T.setShieldInput(true); adv(1.3); T.setShieldInput(false); adv(0.7);
    },

    /* A PERFECT guard, not a held one: shield.js marks a block perfect
       only when it lands within `perfectWindow` (0.25s) of the guard
       going up. Holding X - which is what an earlier version of this
       harness did - can never produce one, and made a working talent
       look dead across 43 registered blocks. Tap the guard repeatedly
       so some incoming hit lands inside a fresh window. */
    halo_votive_parry() {
      ring("thresher", 10, 1.7);
      for (let i = 0; i < 14; i += 1) {
        T.setShieldInput(true);
        adv(0.20);
        T.setShieldInput(false);
        adv(0.14);
      }
      adv(0.6);
    },
    halo_stored_wrath() { blockHits(4.0); },
    halo_pilgrims_reversal() {
      ring("thresher", 9, 1.9);
      T.setShieldInput(true);
      adv(2.6);
      T.setShieldInput(false);
      adv(0.2);
      T.triggerBoost(0, -1);
      adv(1.6);
    },
    halo_mercy_circuit() { blockHits(2.0, 6); },
    halo_seraph_aegis() { blockHits(5.5, 11); },

    edict_siren_beacon() { T.stratagem("orbital"); adv(3.4); },
    edict_live_fuse() { T.stratagem("cluster"); adv(4.2); },
    edict_recall_rite() { T.stratagem("resupply"); adv(3.4); },
    edict_field_chapel() { T.stratagem("boon"); adv(3.4); },
    edict_combined_liturgy() {
      T.stratagem("orbital"); adv(1.2);
      T.stratagem("cluster"); adv(4.5);
    },
  };

  const defs = T.progressionDefinitions();
  const orders = (defs?.doctrine?.orders || defs?.orders || [])
    .filter((o) => !only || o.id === only);

  const rows = [];
  const spendIssues = [];
  for (const order of orders) {
    T.resetProgressionForQA();
    T.grantProgressionXpForQA(500000, "qa:talent-audit");
    // Tier order matters: a tier-3 talent needs orderPoints already spent.
    const talents = [...(order.talents || [])].sort((a, b) => (a.tier || 1) - (b.tier || 1));
    for (const t of talents) {
      for (let r = 0; r < (t.maxRank || 1); r += 1) {
        const res = T.spendTalentForQA(t.id);
        if (!res || res.ok === false) {
          spendIssues.push({ id: t.id, rank: r + 1, reason: res?.reason || "unknown" });
          break;
        }
      }
    }
    let capstoneOk = null;
    if (order.capstone) {
      const res = T.equipCapstoneForQA(order.capstone.id, 0);
      capstoneOk = res?.ok === false ? (res.reason || "refused") : "equipped";
    }

    const st0 = T.progressionState();
    const ranks = st0?.career?.allocations || st0?.doctrine?.allocations
      || st0?.allocations || st0?.career?.doctrine?.allocations || {};

    const subjects = [...talents.map((t) => ({ ...t, kind: "talent" }))];
    if (order.capstone) {
      subjects.push({ ...order.capstone, kind: "capstone", maxRank: 1 });
    }
    for (const t of subjects) {
      const scenario = S[t.id];
      const before = T.progressionState()?.effects?.feedback?.counts || {};
      const beforeTotal = Object.values(before).reduce((a, b) => a + b, 0);
      reset();
      let threw = "";
      if (scenario) {
        try { scenario(); } catch (e) { threw = (e && e.message) || String(e); }
      }
      adv(0.8);
      const after = T.progressionState()?.effects?.feedback?.counts || {};
      const own = (after[t.id] || 0) - (before[t.id] || 0);
      const anyDelta = Object.values(after).reduce((a, b) => a + b, 0) - beforeTotal;
      rows.push({
        order: order.id,
        id: t.id,
        name: t.name,
        kind: t.kind,
        rank: t.kind === "capstone" ? capstoneOk : (ranks[t.id] || 0),
        scenario: scenario ? "yes" : "MISSING",
        procs: own,
        otherProcs: anyDelta - own,
        threw,
      });
    }
  }
  return { rows, spendIssues, notes };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
    })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    await page.goto(`${BASE}/games/saintfall.html?qa=1&intro=0&time=goldenhour&seed=talents`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 180000 });

    const result = await page.evaluate(auditInPage, ONLY);
    await page.close();

    console.log("=== per-talent proc audit ===");
    console.log(`${"order".padEnd(11)}${"talent".padEnd(34)}${"rank".padEnd(10)}`
      + `${"scenario".padEnd(10)}${"procs".padStart(6)}${"  other"}`);
    for (const r of result.rows) {
      const flag = r.procs > 0 ? "" : "   <-- NEVER FIRED";
      console.log(`${r.order.padEnd(11)}${r.id.padEnd(34)}${String(r.rank).padEnd(10)}`
        + `${r.scenario.padEnd(10)}${String(r.procs).padStart(6)}${String(r.otherProcs).padStart(7)}`
        + `${flag}${r.threw ? `  THREW ${r.threw}` : ""}`);
    }

    const dead = result.rows.filter((r) => r.procs === 0);
    console.log(`\n${result.rows.length - dead.length}/${result.rows.length} talents fired `
      + `under their own trigger`);
    if (result.spendIssues.length) {
      console.log(`\nspend refusals (${result.spendIssues.length}):`);
      for (const s of result.spendIssues) {
        console.log(`   ${s.id} rank ${s.rank}: ${s.reason}`);
      }
    }
    if (result.notes.length) {
      console.log("\nscenario notes:");
      for (const n of result.notes) console.log(`   ${n}`);
    }
    if (errors.length) {
      console.log(`\nconsole/page errors: ${errors.length}`);
      for (const e of [...new Set(errors)].slice(0, 8)) console.log(`   ${e.slice(0, 180)}`);
    }
    await writeFile(path.join(OUT, "audit.json"), JSON.stringify(result, null, 2));
    console.log(`\nartifacts: ${path.relative(root, OUT)}/audit.json`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
