#!/usr/bin/env node
/* Focused acceptance: every rendered boss surface resolves to its owner,
   peripheral surfaces deal reduced (never zero) damage, and ordinary boss
   melee routes survive the shared fallback. Module-owned melee windows for
   the Garner and Stylite remain covered by their dedicated fight probes. */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const onlyKey = process.argv[2] || "";
const port = 59600 + (process.pid % 300);
const base = `http://127.0.0.1:${port}`;
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root,
  stdio: "ignore",
});

let failed = 0;
const results = [];
function check(name, ok, detail = null) {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${JSON.stringify(detail)}` : ""}`);
}

let browser;
try {
  await delay(350);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(`${base}/games/saintfall.html?qa=1&quality=low&seed=boss-hitbox-v1`, {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 240000 });

  const audit = await page.evaluate(({ onlyKey }) => {
    const T = window.__SF;
    const THREE = T.THREE;
    T.maximize();
    T.invulnerable(true);
    T.releaseCamera();
    T.ctx.winnower?.resetToPerch?.();
    T.ctx.distaff?.resetToLair?.();
    T.ctx.garner?.resetToPit?.();
    T.ctx.stylite?.resetToPerch?.();
    T.ctx.abbess?.resetToSeat?.();
    T.ctx.apostate?.reset?.();
    T.ctx.districtBosses?.reset?.("reach");
    T.ctx.districtBosses?.reset?.("saint");
    for (let i = 0; i < 3; i += 1) T.renderOnce(1 / 60);

    const modules = [T.ctx.winnower, T.ctx.distaff, T.ctx.garner, T.ctx.stylite,
      T.ctx.abbess, T.ctx.apostate];
    const byKey = (key) => T.enemies.live.find((enemy) => enemy.key === key);
    const records = [
      { key: "matriarch", inst: byKey("matriarch") },
      { key: "winnower", inst: T.ctx.winnower?.instance?.() },
      { key: "distaff", inst: T.ctx.distaff?.instance?.() },
      { key: "garner", inst: T.ctx.garner?.instance?.() },
      { key: "stylite", inst: T.ctx.stylite?.instance?.() },
      { key: "abbess", inst: T.ctx.abbess?.instance?.() },
      { key: "coulter", inst: T.enemies.live.find((enemy) => enemy.body) },
      { key: "apostate", inst: T.ctx.apostate?.instance?.() },
    ].filter((record) => !onlyKey || record.key === onlyKey);

    const point = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const centre = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const edge = new THREE.Vector3();
    const edge2 = new THREE.Vector3();
    const box3 = new THREE.Box3();

    const totalPool = (inst) => Number(inst?.health || 0)
      + (Array.isArray(inst?.legHp) ? inst.legHp.reduce((sum, hp) => sum + Math.max(0, hp), 0) : 0);

    function rootsOf(inst) {
      const roots = Array.isArray(inst?.damageRoots) && inst.damageRoots.length
        ? inst.damageRoots : inst?.root ? [inst.root] : [];
      return roots.filter(Boolean);
    }

    function vertex(mesh, index, out) {
      if (mesh.isSkinnedMesh && typeof mesh.getVertexPosition === "function") {
        mesh.getVertexPosition(index, out);
      } else {
        out.fromBufferAttribute(mesh.geometry.attributes.position, index);
      }
      return out.applyMatrix4(mesh.matrixWorld);
    }

    function raysFor(inst) {
      const rays = [];
      const roots = rootsOf(inst);
      for (const root of roots) {
        root.updateWorldMatrix(true, true);
        box3.setFromObject(root, false).getCenter(centre);
        root.traverseVisible((mesh) => {
          if (rays.length >= 64) return;
          if ((!mesh.isMesh && !mesh.isSkinnedMesh) || mesh.material?.visible === false
            || mesh.userData?.sfDamageIgnore) return;
          const pos = mesh.geometry?.attributes?.position;
          if (!pos?.count) return;
          const index = mesh.geometry.index;
          const triangles = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
          const samples = Math.min(4, triangles, 64 - rays.length);
          for (let sample = 0; sample < samples; sample += 1) {
            const tri = Math.min(triangles - 1, Math.floor((sample + 0.5) * triangles / samples));
            const ia = index ? index.getX(tri * 3) : tri * 3;
            const ib = index ? index.getX(tri * 3 + 1) : tri * 3 + 1;
            const ic = index ? index.getX(tri * 3 + 2) : tri * 3 + 2;
            vertex(mesh, ia, a); vertex(mesh, ib, b); vertex(mesh, ic, c);
            point.copy(a).add(b).add(c).multiplyScalar(1 / 3);
            edge.subVectors(b, a); edge2.subVectors(c, a);
            normal.crossVectors(edge, edge2).normalize();
            if (!Number.isFinite(normal.x) || normal.lengthSq() < 0.5) continue;
            if (normal.dot(point.clone().sub(centre)) < 0) normal.multiplyScalar(-1);
            const origin = point.clone().addScaledVector(normal, 1.6);
            const direction = normal.clone().multiplyScalar(-1);
            let hit = T.combat.raycastEnemies(origin.x, origin.y, origin.z,
              direction.x, direction.y, direction.z, 3.4);
            if (hit?.inst !== inst) {
              origin.copy(point).addScaledVector(normal, -1.6);
              direction.copy(normal);
              hit = T.combat.raycastEnemies(origin.x, origin.y, origin.z,
                direction.x, direction.y, direction.z, 3.4);
            }
            rays.push({ origin, direction, point: point.clone(), hit });
          }
        });
      }
      return rays;
    }

    const reports = [];
    for (const record of records) {
      const inst = record.inst;
      if (!inst) {
        reports.push({ key: record.key, missing: true });
        continue;
      }
      /* Isolate this health pool so a sampled ray cannot legitimately
         stop on a different boss parked behind it. */
      for (const enemy of T.enemies.live) {
        const current = enemy === inst;
        enemy.encounterHidden = !current;
        enemy.encounterLocked = !current;
        if (enemy.root) enemy.root.visible = current;
      }
      for (const module of modules) if (module?.group) module.group.visible = false;
      if (record.key === "winnower") T.ctx.winnower.forcePhase("stoke", 8);
      if (record.key === "distaff") T.ctx.distaff.forcePhase("standing", 8);
      if (record.key === "garner") T.ctx.garner.forcePhase("gorge", 8);
      if (record.key === "stylite") {
        T.ctx.stylite.forcePhase("perched", 8);
        T.ctx.stylite.forceFall();
        for (let frame = 0; frame < 360; frame += 1) {
          T.renderOnce(1 / 60);
          if (T.ctx.stylite.status()?.phase === "stunned") break;
        }
      }
      if (record.key === "abbess") T.ctx.abbess.forcePhase("seated", 8);
      if (record.key === "coulter" && inst.body) {
        inst.body.hidden = false;
        inst.body.phase = "crest";
        inst.body.mawOpen = 0.9;
      }
      inst.encounterHidden = false;
      inst.encounterLocked = false;
      inst.grounded = record.key === "winnower" || record.key === "stylite"
        ? true : inst.grounded;
      if (inst.root) inst.root.visible = true;
      const owningModule = ({
        winnower: T.ctx.winnower, distaff: T.ctx.distaff, garner: T.ctx.garner,
        stylite: T.ctx.stylite, abbess: T.ctx.abbess, apostate: T.ctx.apostate,
      })[record.key];
      if (owningModule?.group) owningModule.group.visible = true;
      for (const root of rootsOf(inst)) root.visible = true;
      inst.root?.updateWorldMatrix(true, true);

      const rays = raysFor(inst);
      const accepted = rays.filter((ray) => ray.hit?.inst === inst);
      const fallback = accepted.filter((ray) => ray.hit.surface);

      let rangedDamage = 0;
      for (const rangedRay of [...fallback, ...accepted]) {
        const savedHealth = inst.health;
        const savedLegs = Array.isArray(inst.legHp) ? inst.legHp.slice() : null;
        const before = totalPool(inst);
        T.combat.fire(rangedRay.origin, rangedRay.direction, { damage: 100, range: 3.4 });
        rangedDamage = before - totalPool(inst);
        inst.health = savedHealth;
        if (savedLegs) inst.legHp.splice(0, inst.legHp.length, ...savedLegs);
        if (rangedDamage > 0) break;
      }

      /* Production melee path. Triangle sampling is intentionally sparse,
         so it is not a reliable way to discover the authored ground window
         on a 20m wing or a many-mesh appendage. Seed each unusual encounter
         with the same presented target its fight uses, then add sampled low
         surfaces as extra coverage. */
      let meleeDamage = 0;
      const low = accepted
        .filter((ray) => {
          const floor = T.ctx.collide.groundHeight(ray.point.x, ray.point.z);
          return ray.point.y >= floor - 0.5 && ray.point.y <= floor + 4.2;
        })
        .sort((left, right) => left.point.y - right.point.y);
      const presented = [];
      const addPresented = (x, y, z, radius) => {
        if (Number.isFinite(x) && Number.isFinite(z)) presented.push({
          point: new THREE.Vector3(x, Number.isFinite(y) ? y : inst.y, z), radius,
        });
      };
      if (record.key === "matriarch") addPresented(inst.x, inst.y + 1.5, inst.z, 0.5);
      if (record.key === "winnower") {
        const state = T.winnowerState();
        addPresented(state?.x, state?.y, state?.z, 3.0);
      }
      if (record.key === "garner") {
        T.ctx.garner.forcePhase("feeding", 8);
        if (inst.legHp) inst.legHp[0] = inst.spec.legHealth;
        T.forceGarnerArmDown(0);
        T.renderOnce(1 / 60);
        const node = T.garnerArmNodes(0)?.[2];
        addPresented(node?.x, node?.y, node?.z, 0.5);
      }
      if (record.key === "stylite") {
        const state = T.styliteState();
        addPresented(state?.x, state?.y, state?.z, 0.5);
      }
      if (record.key === "coulter") {
        const body = T.coulterBodies().find((item) => item.id === inst.id);
        const joint = body?.joints?.reduce((best, item) => {
          const clear = Math.abs(item[1] - T.groundHeightAt(item[0], item[2]) - 1.5);
          return !best || clear < best.clear ? { item, clear } : best;
        }, null)?.item;
        addPresented(joint?.[0], joint?.[1], joint?.[2], 0.5);
      }
      for (const ray of low) presented.push({ point: ray.point, radius: 1.35 });
      let meleeAttempts = 0;
      let meleeStrikeResult = 0;
      for (const candidate of presented.slice(0, 36)) {
        const savedHealth = inst.health;
        const savedLegs = Array.isArray(inst.legHp) ? inst.legHp.slice() : null;
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          T._teleportRaw(candidate.point.x + ox * candidate.radius,
            candidate.point.z + oz * candidate.radius, 0);
          T.ctx.player.setFree(false);
          T.player.state.grounded = true;
          /* Teleporting across districts legitimately re-arms encounter
             gates. This probe already staged the current boss, so clear
             that travel side effect after placement and before the swing. */
          inst.encounterHidden = false;
          inst.encounterLocked = false;
          if (inst.body) inst.body.hidden = false;
          if (record.key === "stylite" || record.key === "winnower") inst.grounded = true;
          if (record.key === "garner") {
            inst.legHp[0] = inst.spec.legHealth;
            inst.legBroken[0] = false;
          }
          T.setBodyHeading(Math.atan2(candidate.point.x - T.player.state.x,
            candidate.point.z - T.player.state.z));
          T.weapons.setMode("melee");
          const before = totalPool(inst);
          meleeStrikeResult = T.combat.meleeStrike(1, Math.PI * 2, false, 1.55, 0, 1);
          meleeDamage = before - totalPool(inst);
          meleeAttempts += 1;
          if (meleeDamage > 0) break;
          inst.health = savedHealth;
          if (savedLegs) inst.legHp.splice(0, inst.legHp.length, ...savedLegs);
        }
        if (meleeDamage > 0) break;
      }
      reports.push({
        key: record.key,
        roots: rootsOf(inst).length,
        sampled: rays.length,
        accepted: accepted.length,
        coverage: rays.length ? accepted.length / rays.length : 0,
        fallback: fallback.length,
        rangedDamage: Number(rangedDamage.toFixed(2)),
        meleeDamage: Number(meleeDamage.toFixed(2)),
        meleeCandidates: presented.length,
        meleeAttempts,
        meleeStrikeResult,
        surfaceMult: T.combat.hitbox[record.key]?.surface?.mult ?? null,
      });
    }
    return reports;
  }, { onlyKey });

  const keys = ["matriarch", "winnower", "distaff", "garner", "stylite", "abbess", "coulter", "apostate"]
    .filter((key) => !onlyKey || key === onlyKey);
  check("all eight bosses publish damage-bearing rendered roots",
    audit.length === keys.length && audit.every((report) => !report.missing && report.roots > 0), audit);
  for (const key of keys) {
    const report = audit.find((item) => item.key === key);
    check(`${key}: sampled rendered triangles resolve to the boss health contract`,
      report && report.sampled >= 4 && report.coverage >= 0.9, report);
    check(`${key}: real ranged fire changes a damage pool`, report?.rangedDamage > 0, report);
    if (key !== "garner" && key !== "stylite") {
      check(`${key}: a presented low surface takes melee damage`, report?.meleeDamage > 0, report);
    }
  }
  const peripheral = audit.filter((report) => report.fallback > 0);
  check("the audit exercises reduced-damage peripheral armor instead of only torso proxies",
    peripheral.length >= (onlyKey ? 1 : 4)
      && peripheral.every((report) => report.surfaceMult > 0 && report.surfaceMult < 1),
    peripheral);
  check("focused browser run has no page or console errors",
    pageErrors.length === 0 && consoleErrors.length === 0,
    { pageErrors, consoleErrors });
} catch (error) {
  failed += 1;
  console.error(error.stack || error.message || error);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

console.log(JSON.stringify({ passed: results.filter((result) => result.ok).length, failed, results }, null, 2));
process.exitCode = failed ? 1 : 0;
