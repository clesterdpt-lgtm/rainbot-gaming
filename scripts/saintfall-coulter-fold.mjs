#!/usr/bin/env node
/* ============================================================
   SAINTFALL - does the Coulter's neck fold back through its head?

   The body is laid along the path the head took: every vertebra is
   sampled at a fixed ARC DISTANCE behind the head, and that arc is
   advanced each frame by how far the head moved. `strikeSurge` drives
   the coil of a bite and of a spew at a NEGATIVE speed - the animal
   rears back before it lunges - so on those frames the head travels
   BACKWARDS along the path it just laid.

   This measures two things through a real strike:

     - `ahead`: how far the first vertebra sits IN FRONT of the head,
       measured along the heading. Any positive number here is the neck
       poking out through the face.
     - `turn`: the sharpest direction change between two consecutive
       body segments. A worm bends; near 180 degrees it has doubled
       back on itself.

   Usage:  node scripts/saintfall-coulter-fold.mjs
   ============================================================ */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const PORT = 49947;
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
  const page = await (await browser.newContext({ viewport: { width: 900, height: 520 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });

  const out = await page.evaluate(async () => {
    const T = window.__SF;
    T.maximize();
    T.invulnerable(true);
    T.advanceTime(0.1, 1 / 60);
    const M = T.ctx.mission;
    for (const boss of M.bosses.filter((e) => e.stage !== "penultimate")) {
      if (!boss.done) M.completeDistrictBoss(boss.key);
    }
    const inst = T.ctx.enemies.live.find((e) => e.eventId === "district-boss:saint");
    if (!inst) return { missing: true };
    inst.health = 1e9;
    const st = T.ctx.districtBosses.status("saint");
    T.player.spawn(st.x, st.z + 70, Math.PI);
    T.advanceTime(5.2, 1 / 60);

    const b = inst.body;
    const worst = { err: -1e9, turn: -1, squash: 1e9, phase: "", kind: "", t: 0 };
    const samples = [];
    let bites = 0;
    let spews = 0;
    let clamped = 0;
    let jointsSeen = 0;
    let jointsClamped = 0;
    const perJoint = [];

    /* THE MEASUREMENT, and it took two goes.

       The obvious one - "is a vertebra in FRONT of the head" - is a
       probe that measures itself: after a hard turn the body genuinely
       does lie ahead of the new heading, and a legitimate U-turn
       scored worse than the bug. What is actually broken is the ARC
       BOOKKEEPING, so measure that directly and nothing else.

       `trail[0]` is the newest laid sample and it is never more than
       0.9m of travel behind the head, so the path between them is
       near enough a straight line: its recorded arc `d` must match the
       straight-line distance to the head. Turning cannot break that -
       0.9m of arc has no room to curve - but a head that travels
       BACKWARDS along its own path does, because `layTrail` adds the
       unsigned distance moved to every sample's arc while the head is
       closing on them. */
    const measure = (t) => {
      const head = b.head;
      const s0 = b.trail[0];
      const real = s0 ? Math.hypot(head.x - s0.x, head.y - s0.y, head.z - s0.z) : 0;
      const err = s0 ? s0.d - real : 0;
      const j = b.joints;
      const pts = [head, ...j];
      let turn = 0;
      for (let i = 1; i < pts.length - 1; i += 1) {
        if (!perJoint[i]) perJoint[i] = { n: 0, hot: 0 };
        const ax = pts[i].x - pts[i - 1].x, ay = pts[i].y - pts[i - 1].y,
          az = pts[i].z - pts[i - 1].z;
        const bx = pts[i + 1].x - pts[i].x, by = pts[i + 1].y - pts[i].y,
          bz = pts[i + 1].z - pts[i].z;
        const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
        if (la < 1e-4 || lb < 1e-4) continue;
        const c = (ax * bx + ay * by + az * bz) / (la * lb);
        const deg = Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
        if (deg > turn) turn = deg;
        /* Counted PER JOINT, not per frame. "Some joint is on the
           limit" is true almost always and says nothing: the neck
           absorbs the head's whole lunge and is expected to ride it.
           What would mean a stiff animal is most of the THIRTEEN being
           held there at once. */
        jointsSeen += 1;
        perJoint[i].n += 1;
        if (deg > 47.5) { jointsClamped += 1; perJoint[i].hot += 1; }
      }
      /* And the visible consequence: the first bone is `arc[0]` long
         and is aimed at a target `chord` away. When the arc says eight
         metres and the target is three, the bone overshoots its own
         target and the neck concertinas. */
      const chord = Math.hypot(j[0].x - head.x, j[0].y - head.y, j[0].z - head.z);
      const squash = inst.spineArc[0] > 0 ? chord / inst.spineArc[0] : 1;
      const kind = b.action > 0 ? (b.actionKind || "") : "";
      samples.push({ t: +t.toFixed(2), phase: b.phase, kind,
        err: +err.toFixed(2), turn: +turn.toFixed(1), squash: +squash.toFixed(2) });
      if (err > worst.err) {
        worst.err = err; worst.phase = b.phase; worst.kind = kind; worst.t = t;
      }
      if (turn > worst.turn) worst.turn = turn;
      if (squash < worst.squash) worst.squash = squash;
      // A body held at the clamp on most joints would be a STIFF body,
      // which is its own bug; count how often the limit is reached.
      if (turn > 47.5) clamped += 1;
    };

    /* Ridden at TWO ranges. The bite's coil is more than twice the
       spew's - sixteen metres a second of reverse against seven - and a
       probe parked at spew range never fires the harder of the two: the
       first version of this run recorded four spews and no bites at
       all. Sixty seconds close in, sixty seconds back out. */
    let t = 0;
    let lastKind = "";
    for (const stand of [18, 70]) {
      T.player.spawn(st.x, st.z + stand, Math.PI);
      for (let k = 0; k < 60 * 60; k += 1) {
        T.advanceTime(1 / 60, 1 / 60);
        t += 1 / 60;
        const kind = b.action > 0 ? (b.actionKind || "") : "";
        if (kind && kind !== lastKind) { if (kind === "bite") bites += 1; else spews += 1; }
        lastKind = kind;
        measure(t);
      }
    }
    // The worst frames, for the log.
    const bad = samples.slice().sort((p, q) => q.err - p.err).slice(0, 6);
    return { worst, bad, bites, spews, clamped, jointsSeen, jointsClamped,
      perJoint: perJoint.map((v, i) => v ? { joint: i, pct: +(100 * v.hot / v.n).toFixed(1) } : null).filter(Boolean),
      frames: samples.length,
      span: +inst.spineLength.toFixed(1) };
  });

  if (out.missing) throw new Error("the Coulter was not alive");
  console.log(`\n=== ${out.frames} frames · ${out.bites} bites · ${out.spews} spews `
    + `· ${out.span}m body ===`);
  console.log("  worst frames (arc the trail claims, minus the arc that is there):");
  for (const s of out.bad) {
    console.log(`    t=${s.t}s ${s.phase}${s.kind ? "/" + s.kind : ""}  `
      + `err=${s.err}m  turn=${s.turn} deg  neck=${(s.squash * 100).toFixed(0)}%`);
  }
  check(out.worst.err < 0.25, "the trail's arc bookkeeping matches the path",
    `worst overcount ${out.worst.err.toFixed(2)}m, during `
    + `${out.worst.phase}${out.worst.kind ? "/" + out.worst.kind : ""}`);
  check(out.worst.squash > 0.55, "the first bone is not aimed inside itself",
    `neck chord fell to ${(out.worst.squash * 100).toFixed(0)}% of the bone's length`);
  check(out.worst.turn < 110, "no joint doubles back on itself",
    `sharpest turn ${out.worst.turn.toFixed(1)} deg`);
  check(out.bites > 0 && out.spews > 0, "both coils were actually fired",
    `${out.bites} bites · ${out.spews} spews`);
  console.log("  how often each joint rides the bend limit:");
  console.log("    " + out.perJoint.map((v) => `j${v.joint}:${v.pct}%`).join("  "));
  check(out.jointsClamped / out.jointsSeen < 0.34, "the bend limit is a backstop, not the pose",
    `${(100 * out.jointsClamped / out.jointsSeen).toFixed(1)}% of all joint-frames sit on the limit`);
  check(errors.length === 0, "no page errors", errors.slice(0, 2).join(" | "));

  await browser.close();
  console.log(findings.length ? `\n${findings.length} FINDING(S)` : "\nclean");
  process.exitCode = findings.length ? 1 : 0;
} finally {
  server.kill();
}
