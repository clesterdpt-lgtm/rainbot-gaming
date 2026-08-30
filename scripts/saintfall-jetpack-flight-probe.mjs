#!/usr/bin/env node
/* ============================================================
   SAINTFALL - jetpack flight probe

   Two reported faults that a gallery plate cannot show, because one
   is a thing sticking out of a still frame that nobody looks at the
   edges of and the other only exists in motion:

     1. a translucent sheet projecting past the wing tips - orange on
        the Censer, green on the Augur;
     2. the Augur stuttering about once a second in flight.

   So this flies the pack for real and samples EVERY frame.

   OVERHANG is measured as a radius: the furthest any additive sheet
   (veil, plume, flare) reaches from the pack's mount, against the
   furthest any SOLID part reaches. A glow that ends inside its own
   hardware is a glow; one that ends outside it is a polygon.

   The STUTTER hunt records the channels that can move a wing - the
   spread, each side's wall tuck, the flame gate, and the pack's own
   articulated angles - flags every frame whose change is far out of
   line with its neighbours, and prints the GAPS between those
   frames, because a fault that repeats on a clock is identified by
   its period and nothing else.

   Usage:
     node scripts/saintfall-jetpack-flight-probe.mjs
     node scripts/saintfall-jetpack-flight-probe.mjs --character white-vigil
     node scripts/saintfall-jetpack-flight-probe.mjs --seconds 10
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const only = arg("--character", null);
const seconds = Number(arg("--seconds", 8));
const outFile = path.resolve(root, arg("--out", "output/saintfall/jetpack-flight.json"));
const PORT = 45600 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;

const FIGURES = ["white-vigil", "bastion-penitent"];

/* A glow may reach a little past its own hardware - a plume is
   supposed to - but a WING veil that does is the artefact reported.
   Measured separately, so the plume's honest overhang does not hide
   the veil's dishonest one. */
const VEIL_OVERHANG_LIMIT = 0.0;

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try {
      if ((await fetch(`${BASE}/games/saintfall-white-vigil.html`)).ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

function inPage(job) {
  const T = window.__SF;
  const p = T.player;
  const THREE = T.THREE;
  const pack = T.jetpack.visual;

  /* ---- open sky to fly in ---- */
  const ground = (x, z) => T.ctx.collide.groundHeight(x, z);
  let site = { x: 0, z: 0, w: 9 };
  for (let ring = 16; ring <= 200; ring += 14) {
    for (let k = 0; k < 12; k += 1) {
      const a = (k / 12) * Math.PI * 2 + ring * 0.31;
      const x = Math.cos(a) * ring;
      const z = Math.sin(a) * ring;
      const h = ground(x, z);
      if (!Number.isFinite(h)) continue;
      let worst = 0;
      let clear = true;
      for (let b = 0; b < 8 && clear; b += 1) {
        const bb = (b / 8) * Math.PI * 2;
        for (let d = 2; d <= 10; d += 2) {
          const qx = x + Math.cos(bb) * d;
          const qz = z + Math.sin(bb) * d;
          const qh = ground(qx, qz);
          if (!Number.isFinite(qh)) { clear = false; break; }
          worst = Math.max(worst, Math.abs(qh - h));
          if (T.ctx.collide.blocked(qx, qz, qh)) { clear = false; break; }
        }
      }
      if (clear && worst < site.w) site = { x, z, w: worst };
    }
    if (site.w < 0.06) break;
  }

  /* ---- classify the pack's meshes ----
     BY MATERIAL, NOT BY NAME. Sorting on the mesh name put the three
     throat-flare cards in with the hardware, because they are built
     as bare `new Mesh(...)` children of a named rig and carry no name
     of their own - so the Censer's "solid" reach was 0.65m of
     additive flare and its veil looked comfortably contained when it
     was not. A glow is a thing that blends; that is the test. */
  const solids = [];
  const veils = [];
  const plumes = [];
  const isGlow = (m) => !!m && (m.transparent === true
    || m.blending === THREE.AdditiveBlending);
  pack.root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const glow = mats.some(isGlow);
    const named = o.name || (o.parent?.name || "");
    if (!glow) solids.push(o);
    else if (/veil/i.test(named)) veils.push(o);
    else plumes.push(o);
  });

  /* Radius from the pack's own mount, in the pack's frame, so a
     figure that walks or banks does not move the number. */
  const local = new THREE.Vector3();
  const toPack = new THREE.Matrix4();
  const reach = (list) => {
    let far = 0;
    let at = null;
    toPack.copy(pack.root.matrixWorld).invert();
    for (const o of list) {
      if (!o.visible) continue;
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 48));
      for (let i = 0; i < pos.count; i += step) {
        local.fromBufferAttribute(pos, i)
          .applyMatrix4(o.matrixWorld).applyMatrix4(toPack);
        const r = Math.hypot(local.x, local.y, local.z);
        if (r > far) { far = r; at = o.name || o.parent?.name || "(unnamed)"; }
      }
    }
    return { r: far, at };
  };

  /* ---- fly ---- */
  T.teleport(site.x, site.z, 0);
  T.advanceTime(1.0, 1 / 60);
  T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
  T.setJetInput(true);
  /* Up to cruise first: the climb-out is a genuine transient and
     grading it would report every pack as stuttering. */
  for (let i = 0; i < 150; i += 1) {
    T.advanceTime(1 / 60, 1 / 60);
    if (p.state.jetFuel === 0) break;
    T.setJetpackState({ fuel: 100 });
  }

  const series = [];
  const frames = Math.round(job.seconds * 60);
  let peak = { veil: 0, solid: 0, plume: 0, veilAt: null, solidAt: null };
  for (let i = 0; i < frames; i += 1) {
    T.setJetpackState({ fuel: 100 });
    T.advanceTime(1 / 60, 1 / 60);
    const st = T.jetpackState();
    const row = {
      t: +(i / 60).toFixed(3),
      spread: st.wingSpread,
      tuckL: st.wallTuckL,
      tuckR: st.wallTuckR,
      throttle: st.throttle,
      pose: st.pose,
      y: st.y,
      flame: pack.flames[0]?.outer?.visible ? 1 : 0,
      /* Every angle the pack articulates, so a jump can be traced to
         the joint that made it rather than to the pack in general. */
      angles: [],
    };
    for (const wing of pack.wings) {
      row.angles.push(+wing.root.rotation.y.toFixed(5));
      row.angles.push(+wing.root.rotation.x.toFixed(5));
      for (const f of wing.feathers) row.angles.push(+f.rotation.z.toFixed(5));
      const boom = wing.root.children.find((c) => /boom/.test(c.name || ""));
      if (boom) row.angles.push(+boom.rotation.z.toFixed(5));
    }
    series.push(row);

    if (i % 6 === 0) {
      const v = reach(veils);
      const s = reach(solids);
      const q = reach(plumes);
      if (v.r > peak.veil) { peak.veil = v.r; peak.veilAt = v.at; }
      if (s.r > peak.solid) { peak.solid = s.r; peak.solidAt = s.at; }
      if (q.r > peak.plume) peak.plume = q.r;
    }
  }
  T.setJetInput(false);

  /* ---- find the jumps ----
     An isolated step, not a big one: real motion has neighbours its
     own size, a stutter does not. Same rule the leg rig probe uses
     for a teleporting ankle, for the same reason. */
  const jumps = [];
  for (let n = 1; n < series.length - 1; n += 1) {
    const cur = series[n];
    const prev = series[n - 1];
    const next = series[n + 1];
    let worst = 0;
    let which = null;
    for (let a = 0; a < cur.angles.length; a += 1) {
      const d = Math.abs(cur.angles[a] - prev.angles[a]);
      const d0 = Math.abs(prev.angles[a] - series[Math.max(0, n - 2)].angles[a]);
      const d1 = Math.abs(next.angles[a] - cur.angles[a]);
      const excess = d - 2 * Math.max(d0, d1);
      if (excess > worst) { worst = excess; which = a; }
    }
    const flameFlip = cur.flame !== prev.flame;
    const tuck = Math.max(cur.tuckL, cur.tuckR);
    const tuckJump = Math.max(
      cur.tuckL - prev.tuckL, cur.tuckR - prev.tuckR
    );
    if (worst > 0.004 || flameFlip || tuckJump > 0.05) {
      jumps.push({
        t: cur.t, angle: which, excess: +worst.toFixed(5),
        flameFlip, tuck: +tuck.toFixed(3), tuckJump: +tuckJump.toFixed(3),
        spread: +cur.spread.toFixed(3), throttle: +cur.throttle.toFixed(3),
      });
    }
  }
  const gaps = [];
  for (let n = 1; n < jumps.length; n += 1) {
    gaps.push(+(jumps[n].t - jumps[n - 1].t).toFixed(3));
  }

  const stat = (list) => {
    if (!list.length) return null;
    const s = [...list].sort((a, b) => a - b);
    return { n: s.length, min: s[0], med: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
  };

  return {
    pack: pack.id,
    site: { x: +site.x.toFixed(1), z: +site.z.toFixed(1) },
    reach: {
      solid: +peak.solid.toFixed(4), solidAt: peak.solidAt,
      veil: +peak.veil.toFixed(4), veilAt: peak.veilAt,
      plume: +peak.plume.toFixed(4),
      veilOverhang: +(peak.veil - peak.solid).toFixed(4),
    },
    jumps: jumps.slice(0, 40),
    jumpCount: jumps.length,
    gapStat: stat(gaps),
    flameFlips: series.reduce(
      (a, r, i) => a + (i && r.flame !== series[i - 1].flame ? 1 : 0), 0
    ),
    tuckMax: Math.max(...series.map((r) => Math.max(r.tuckL, r.tuckR))),
    spreadMin: Math.min(...series.map((r) => r.spread)),
    series: job.dump ? series : undefined,
  };
}

async function main() {
  const server = startServer();
  let browser = null;
  const report = {};
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    for (const id of FIGURES) {
      if (only && only !== id) continue;
      const page = await (await browser.newContext({
        viewport: { width: 900, height: 620 },
      })).newPage();
      page.on("pageerror", (e) => console.error(`PAGE ERROR [${id}]`, e.message));
      const url = new URL(`${BASE}/games/saintfall-white-vigil.html`);
      url.searchParams.set("qa", "1");
      url.searchParams.set("quality", "low");
      url.searchParams.set("character", id);
      await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
      report[id] = await page.evaluate(inPage, {
        seconds, dump: process.env.SF_DUMP === "1",
      });
      await page.close();
    }
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, JSON.stringify(report, null, 2));

    let fails = 0;
    for (const [id, r] of Object.entries(report)) {
      console.log(`\n${"=".repeat(84)}\n${id}  (${r.pack})`);
      console.log(`  reach from mount: solid ${r.reach.solid}m (${r.reach.solidAt})`);
      console.log(`                    veil  ${r.reach.veil}m (${r.reach.veilAt})`);
      console.log(`                    plume ${r.reach.plume}m`);
      const bad = r.reach.veilOverhang > VEIL_OVERHANG_LIMIT;
      if (bad) fails += 1;
      console.log(`  veil overhang     ${r.reach.veilOverhang >= 0 ? "+" : ""}${r.reach.veilOverhang}m`
        + `   ${bad ? "FAIL - a translucent sheet is outside the hardware" : "ok"}`);
      console.log(`  jumps ${r.jumpCount}   flame flips ${r.flameFlips}`
        + `   tuck max ${r.tuckMax.toFixed(3)}   spread min ${r.spreadMin.toFixed(3)}`);
      if (r.gapStat) {
        console.log(`  gap between jumps: n=${r.gapStat.n} min ${r.gapStat.min}s`
          + ` med ${r.gapStat.med}s max ${r.gapStat.max}s`);
      }
      if (r.jumpCount) {
        if (r.jumpCount > 4) fails += 1;
        for (const j of r.jumps.slice(0, 10)) {
          console.log(`    t=${j.t}s  angle#${j.angle} excess ${j.excess}`
            + `  flameFlip=${j.flameFlip}  tuck ${j.tuck} (+${j.tuckJump})`
            + `  spread ${j.spread}  throttle ${j.throttle}`);
        }
      }
    }
    console.log(`\nwrote ${path.relative(root, outFile)}`);
    process.exitCode = fails ? 1 : 0;
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
