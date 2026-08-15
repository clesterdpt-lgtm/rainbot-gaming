#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Precentor encounter/remodel regression

   Proves the real `district-boss:choir` instance from dormant reveal
   through death. This is intentionally surface-led: shots originate a
   few centimetres outside posed triangles on every named anatomical
   region, so a generous centre capsule cannot sign off detached claws,
   legs, or armour that the player can see but cannot hit.

   Usage:
     node scripts/saintfall-precentor-fight.mjs [--out output/path]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith("--")
    ? argv[at + 1] : fallback;
};
const outDir = path.resolve(root, option("out", "output/saintfall/precentor-fight"));
const port = 53100 + (process.pid % 4500);
const base = `http://127.0.0.1:${port}`;
const results = [];
let failed = 0;

const requiredBones = [
  "root", "thorax", "pronotum", "head", "abdomen", "abdomen2",
  "mandible_L", "mandible_R", "antenna_L", "antenna_R",
  "scythe_L", "scythe_R", "claw_L", "claw_R",
  ...[0, 1].flatMap((pair) => ["L", "R"].flatMap((side) =>
    ["coxa", "femur", "tibia", "foot"].map((part) => `${part}${pair}_${side}`))),
].sort();
const requiredClips = ["alert", "death", "flinch", "idle", "strike"];
const regions = ["head", "thorax", "abdomen", "leg0_L", "leg0_R",
  "leg1_L", "leg1_R", "scythe_L", "scythe_R"];
const meleeRegions = ["leg0_L", "leg0_R", "leg1_L", "leg1_R", "scythe_L", "scythe_R"];
const bodyMeleeRegions = ["thorax", "abdomen"];

function check(name, ok, detail = "") {
  const entry = { name, ok: !!ok, detail };
  results.push(entry);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const dataBuffer = (dataUrl) =>
  Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await mkdir(outDir, { recursive: true });
  let serverReady = false;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      if ((await fetch(`${base}/games/saintfall.html`)).ok) {
        serverReady = true;
        break;
      }
    } catch (_) { /* retry */ }
    await delay(100);
  }
  if (!serverReady) throw new Error("local Saintfall server did not become ready");

  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const pageErrors = [];
  const consoleErrors = [];
  const consoleWarnings = [];
  const assetFailures = [];
  const assetRequests = [];
  const sameOrigin = (url) => url.startsWith(base);
  const monitor = (page) => {
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
      if (message.type() === "warning"
        && /saintfall|precentor|gltf|propertybinding|skinnedmesh/i.test(message.text())) {
        consoleWarnings.push(message.text());
      }
    });
    page.on("response", (response) => {
      if (!sameOrigin(response.url())) return;
      if (/\/assets\//.test(response.url())) {
        assetRequests.push({ status: response.status(), url: response.url() });
      }
      if (response.status() >= 400) assetFailures.push(`${response.status()} ${response.url()}`);
    });
    page.on("requestfailed", (request) => {
      if (sameOrigin(request.url())) assetFailures.push(`failed ${request.url()}`);
    });
  };

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  monitor(page);
  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high&seed=precentor-fight`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
    window.__SF.invulnerable(true);
  });

  /* ---- DEDICATED ASSET / RIG / LIVE HITBOX FIT -------------------- */
  const contract = await page.evaluate(() => {
    const T = window.__SF;
    const owned = T.enemies.live.filter((enemy) =>
      enemy.eventId === "district-boss:choir");
    const inst = owned[0];
    if (!inst) return { error: "district-boss:choir did not spawn" };
    inst.root.updateMatrixWorld(true);
    const skin = inst.skin;
    const geometry = skin?.geometry;
    const classify = (name = "") => {
      if (/^(?:head|mandible_[LR])$/.test(name)) return "head";
      if (/^(?:thorax|pronotum)$/.test(name)) return "thorax";
      if (/^(?:abdomen|abdomen2)$/.test(name)) return "abdomen";
      const leg = /^(?:coxa|femur|tibia|foot)([01])_([LR])$/.exec(name);
      if (leg) return `leg${leg[1]}_${leg[2]}`;
      const scythe = /^(?:scythe|claw)_([LR])$/.exec(name);
      return scythe ? `scythe_${scythe[1]}` : null;
    };
    const weighted = Object.fromEntries(["head", "thorax", "abdomen",
      "leg0_L", "leg0_R", "leg1_L", "leg1_R", "scythe_L", "scythe_R"]
      .map((name) => [name, []]));
    if (skin && geometry) {
      const skinIndex = geometry.getAttribute("skinIndex");
      const skinWeight = geometry.getAttribute("skinWeight");
      const reads = ["getX", "getY", "getZ", "getW"];
      const point = new T.ctx.THREE.Vector3();
      for (let vertex = 0; vertex < geometry.attributes.position.count; vertex += 1) {
        let best = -1;
        let boneIndex = -1;
        for (let lane = 0; lane < 4; lane += 1) {
          const weight = skinWeight?.[reads[lane]]?.(vertex) || 0;
          if (weight > best) {
            best = weight;
            boneIndex = Math.round(skinIndex?.[reads[lane]]?.(vertex) || 0);
          }
        }
        const region = classify(skin.skeleton.bones[boneIndex]?.name);
        if (!region) continue;
        skin.getVertexPosition(vertex, point);
        point.applyMatrix4(skin.matrixWorld);
        weighted[region].push({ x: point.x, y: point.y, z: point.z, weight: best });
      }
    }
    const percentile = (values, q) => {
      if (!values.length) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1,
        Math.max(0, Math.floor(q * (sorted.length - 1))))];
    };
    const forward = { x: Math.sin(inst.yaw), z: Math.cos(inst.yaw) };
    const lateral = { x: Math.cos(inst.yaw), z: -Math.sin(inst.yaw) };
    const local = (point) => {
      const dx = point.x - inst.x;
      const dz = point.z - inst.z;
      return { side: dx * lateral.x + dz * lateral.z,
        up: point.y - inst.y, forward: dx * forward.x + dz * forward.z };
    };
    const body = [...weighted.thorax, ...weighted.abdomen].map(local);
    const headBone = inst.bones.get("head");
    const headWorld = new T.ctx.THREE.Vector3();
    headBone?.getWorldPosition(headWorld);
    const liveHead = local(headWorld);
    const headRadius = percentile(weighted.head.map((point) =>
      Math.hypot(point.x - headWorld.x, point.y - headWorld.y, point.z - headWorld.z)), 0.92);
    const suggested = {
      r: Number(percentile(body.map((point) => Math.hypot(point.side, point.forward)), 0.96).toFixed(2)),
      y0: Number(percentile(body.map((point) => point.up), 0.02).toFixed(2)),
      y1: Number(percentile(body.map((point) => point.up), 0.98).toFixed(2)),
      head: Number(liveHead.up.toFixed(2)),
      headR: Number(Math.max(0.2, headRadius).toFixed(2)),
      headZ: Number(liveHead.forward.toFixed(2)),
    };
    const current = { ...(T.combat.hitbox.precentor || {}) };
    const currentHeadOffset = Math.hypot(liveHead.side,
      liveHead.up - (current.head || 0), liveHead.forward - (current.headZ || 0));
    let meshes = 0;
    let material = null;
    inst.root.traverse((child) => {
      if (!child.isMesh) return;
      meshes += 1;
      if (!material) material = Array.isArray(child.material)
        ? child.material[0] : child.material;
    });
    const source = T.enemies.species.get("precentor");
    const clipAudit = Object.fromEntries([...source.clips].map(([name, clip]) => [name, {
      tracks: clip.tracks.length,
      walkingTracks: clip.tracks.filter((track) =>
        /(?:coxa|femur|tibia|foot)[01]_[LR]/.test(track.name)).length,
    }]));
    return {
      instances: owned.length,
      eventId: inst.eventId,
      enemyKey: inst.key,
      url: inst.spec.url,
      meshes,
      skinned: !!inst.skin,
      legs: inst.legs.map((leg) => `${leg.i}_${leg.side}`).sort(),
      specPairs: inst.spec.legs,
      bones: inst.skin?.skeleton?.bones?.map((bone) => bone.name).sort() || [],
      clips: [...inst.actions.keys()].sort(),
      clipAudit,
      pbr: !!(material?.map && material?.normalMap && material?.roughnessMap
        && material?.metalnessMap && material?.emissiveMap),
      meshHitbox: T.combat.meshHitboxStatus?.(inst) || null,
      weighted: Object.fromEntries(Object.entries(weighted)
        .map(([name, points]) => [name, points.length])),
      hitboxFit: {
        current,
        suggested,
        liveHead: { side: Number(liveHead.side.toFixed(3)),
          up: Number(liveHead.up.toFixed(3)), forward: Number(liveHead.forward.toFixed(3)) },
        currentHeadOffset: Number(currentHeadOffset.toFixed(3)),
      },
    };
  });
  if (contract.error) throw new Error(contract.error);
  const exactLegs = ["0_L", "0_R", "1_L", "1_R"];
  const bodyCovered = contract.hitboxFit.current.r + 0.2 >= contract.hitboxFit.suggested.r
    && contract.hitboxFit.current.y0 <= contract.hitboxFit.suggested.y0 + 0.2
    && contract.hitboxFit.current.y1 + 0.2 >= contract.hitboxFit.suggested.y1;
  const headCovered = contract.hitboxFit.currentHeadOffset
    <= Math.max(0.2, contract.hitboxFit.current.headR || 0) * 0.75;
  check("the Choir owns exactly one dedicated Precentor instance",
    contract.instances === 1 && contract.eventId === "district-boss:choir"
      && contract.enemyKey === "precentor", JSON.stringify({ instances: contract.instances,
      eventId: contract.eventId, key: contract.enemyKey }));
  check("the boss loads its dedicated authored-PBR GLB",
    contract.url === "assets/models/saintfall/precentor.glb" && contract.meshes === 1
      && contract.skinned && contract.pbr, `${contract.url} · ${contract.meshes} mesh`);
  check("the remodel has exactly two walking pairs",
    contract.specPairs === 2 && JSON.stringify(contract.legs) === JSON.stringify(exactLegs),
    contract.legs.join(", "));
  check("all thirty required bones resolve on the live skeleton",
    JSON.stringify(contract.bones) === JSON.stringify(requiredBones),
    `${contract.bones.length} bones`);
  check("all five required authored clips load and leave walking legs to IK",
    JSON.stringify(contract.clips) === JSON.stringify(requiredClips)
      && Object.values(contract.clipAudit).every((clip) => clip.tracks > 0)
      && Object.entries(contract.clipAudit).filter(([name]) => name !== "death")
        .every(([, clip]) => clip.walkingTracks === 0), JSON.stringify(contract.clipAudit));
  check("every named anatomy region owns visible weighted geometry",
    regions.every((name) => contract.weighted[name] > 0), JSON.stringify(contract.weighted));
  check("the fitted hit-volume template and dormant instance cache are prebuilt",
    contract.meshHitbox?.enabled && contract.meshHitbox.templateReady
      && contract.meshHitbox.templatePrewarmed && contract.meshHitbox.instanceReady
      && contract.meshHitbox.proxyCount > 0 && contract.meshHitbox.headProxyCount > 0
      && contract.meshHitbox.antennaProxyCount >= 2,
    JSON.stringify(contract.meshHitbox));
  check("the live head bone remains inside the authored head hit sphere",
    headCovered, JSON.stringify(contract.hitboxFit));
  check("the body capsule covers the posed thorax/abdomen core",
    bodyCovered, JSON.stringify(contract.hitboxFit));

  /* ---- DORMANT / REVEAL / TARGETABILITY ---------------------------- */
  const dormant = await page.evaluate(() => {
    const T = window.__SF;
    const H = T.ctx.districtBosses;
    const inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const status = H.status("choir");
    const ps = T.ctx.player.state;
    ps.x = status.x + 76;
    ps.z = status.z;
    ps.y = T.ctx.collide.groundHeight(ps.x, ps.z);
    H.update(0.05);
    T.renderOnce(0);
    const healthBefore = inst.health;
    const dealt = T.combat.damageEnemy(inst, 80, { source: "qa-dormant" });
    const head = new T.ctx.THREE.Vector3();
    inst.bones.get("head")?.getWorldPosition(head);
    const origin = new T.ctx.THREE.Vector3(head.x + 8, head.y, head.z);
    const direction = head.clone().sub(origin).normalize();
    const ray = T.combat.raycastEnemies(origin.x, origin.y, origin.z,
      direction.x, direction.y, direction.z, 16);
    const shot = T.combat.fire(origin, direction, { damage: 10, range: 16 });
    const contacts = T.minimapState()?.contacts || [];
    return {
      status: H.status("choir"),
      visible: inst.root.visible,
      targetable: T.combat.targetable(inst),
      dealt,
      healthBefore,
      healthAfter: inst.health,
      ray: ray?.inst?.id || null,
      shot: shot?.inst?.id || null,
      liveContacts: contacts.filter((contact) =>
        contact.species === "precentor" || contact.key === "precentor").length,
    };
  });
  check("outside the Choir gate the boss stays dormant, hidden, and locked",
    dormant.status.phase === "dormant" && dormant.status.hidden && dormant.status.locked
      && !dormant.visible && !dormant.targetable, JSON.stringify(dormant.status));
  check("every authoritative dormant damage route refuses the boss",
    dormant.dealt === 0 && dormant.healthAfter === dormant.healthBefore
      && dormant.ray === null && dormant.shot === null, JSON.stringify(dormant));
  check("the dormant Precentor does not leak a live minimap contact",
    dormant.liveContacts === 0, `${dormant.liveContacts} live contacts`);

  const reveal = await page.evaluate(() => {
    const T = window.__SF;
    const H = T.ctx.districtBosses;
    const inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const status = H.status("choir");
    /* Use the player-owned teleport path here, not only x/z state writes.
       Visibility tiers are camera-relative and the minimap semantic is
       refreshed by rendered HUD frames; a state-only teleport leaves both
       looking at the previous district and creates a harness false negative. */
    T._teleportRaw(status.x + 18, status.z, 0);
    H.update(0.05);
    for (let frame = 0; frame < 3; frame += 1) T.renderOnce(1 / 60);
    const healthBefore = inst.health;
    const dealt = T.combat.damageEnemy(inst, 80, { source: "qa-reveal" });
    const contacts = T.minimapState()?.contacts || [];
    return {
      status: H.status("choir"),
      visible: inst.root.visible,
      targetable: T.combat.targetable(inst),
      dealt,
      healthBefore,
      healthAfter: inst.health,
      liveContacts: contacts.filter((contact) =>
        contact.species === "precentor" || contact.key === "precentor").length,
      hudNamesBoss: document.body.innerText.toUpperCase().includes("PRECENTOR"),
    };
  });

  /* A reveal title is not visual proof by itself: the native player camera can
     be buried behind a Choir spire even while the encounter state is correct.
     Find a collision-cleared native-arena bearing, then gate the capture on
     posed surface coverage and unobstructed head/thorax/abdomen sightlines. */
  const revealFrame = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const THREE = T.ctx.THREE;
    const skin = inst.skin;
    const geometry = skin.geometry;
    const point = new THREE.Vector3();
    const bounds = new THREE.Box3();
    inst.root.updateMatrixWorld(true);
    for (let vertex = 0; vertex < geometry.attributes.position.count; vertex += 1) {
      skin.getVertexPosition(vertex, point);
      point.applyMatrix4(skin.matrixWorld);
      bounds.expandByPoint(point);
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const framingRadius = Math.max(6.4, Math.max(size.x, size.y, size.z) * 2.15);
    const bearings = [0.20, 0.53, 0.86, 1.19, 1.52, 1.85]
      .map((turn) => turn * Math.PI);
    const important = ["head", "thorax", "abdomen"];
    const ray = new THREE.Raycaster();
    const camera = T.ctx.render.camera;
    const occluders = [T.ctx.world.group, T.ctx.terrain.group].filter(Boolean);

    const inspect = (orbit, bearing) => {
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      inst.root.updateMatrixWorld(true);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let sampled = 0;
      let inFrame = 0;
      const stride = Math.max(1,
        Math.floor(geometry.attributes.position.count / 12000));
      for (let vertex = 0; vertex < geometry.attributes.position.count; vertex += stride) {
        skin.getVertexPosition(vertex, point);
        point.applyMatrix4(skin.matrixWorld).project(camera);
        sampled += 1;
        if (point.z < -1 || point.z > 1) continue;
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
        if (Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1) inFrame += 1;
      }
      const clippedMinX = Math.max(-1, minX);
      const clippedMaxX = Math.min(1, maxX);
      const clippedMinY = Math.max(-1, minY);
      const clippedMaxY = Math.min(1, maxY);
      const screen = {
        width: Number((Math.max(0, clippedMaxX - clippedMinX) / 2).toFixed(4)),
        height: Number((Math.max(0, clippedMaxY - clippedMinY) / 2).toFixed(4)),
        centerX: Number(((clippedMinX + clippedMaxX) / 2).toFixed(4)),
        centerY: Number(((clippedMinY + clippedMaxY) / 2).toFixed(4)),
        inFrameFraction: Number((inFrame / Math.max(1, sampled)).toFixed(4)),
      };
      const regions = important.map((name) => {
        const bone = inst.bones.get(name);
        const world = bone?.getWorldPosition(new THREE.Vector3()) || center.clone();
        const projected = world.clone().project(camera);
        const delta = world.clone().sub(camera.position);
        const distance = delta.length();
        ray.set(camera.position, delta.normalize());
        ray.far = Math.max(0, distance - 0.12);
        const blocked = ray.intersectObjects(occluders, true).length > 0;
        return {
          name,
          inFrame: projected.z >= -1 && projected.z <= 1
            && Math.abs(projected.x) <= 0.82 && Math.abs(projected.y) <= 0.82,
          clear: !blocked,
          ndc: [Number(projected.x.toFixed(4)), Number(projected.y.toFixed(4)),
            Number(projected.z.toFixed(4))],
        };
      });
      return {
        orbit,
        bearing: Number((bearing * 180 / Math.PI).toFixed(1)),
        screen,
        regions,
        score: (orbit.ok ? 10 : 0)
          + regions.filter((region) => region.clear && region.inFrame).length * 2
          + screen.width + screen.height + screen.inFrameFraction,
      };
    };

    const attempts = [];
    for (const bearing of bearings) {
      const orbit = T.safeOrbit(center.x, center.z, center.y, bearing,
        framingRadius, 0.20, 43);
      T.renderStill();
      attempts.push(inspect(orbit, bearing));
    }
    attempts.sort((a, b) => b.score - a.score);
    const selected = attempts[0];
    const finalOrbit = T.safeOrbit(center.x, center.z, center.y,
      selected.bearing * Math.PI / 180, framingRadius, 0.20, 43);
    T.renderStill();
    const final = inspect(finalOrbit, selected.bearing * Math.PI / 180);
    return {
      ...final,
      rootVisible: inst.root.visible,
      phase: T.ctx.districtBosses.status("choir").phase,
      bounds: {
        center: center.toArray().map((value) => Number(value.toFixed(3))),
        size: size.toArray().map((value) => Number(value.toFixed(3))),
      },
      attempts: attempts.map(({ bearing, orbit, screen, regions: anatomy }) => ({
        bearing, orbitOk: orbit.ok, radius: orbit.radius, screen, anatomy,
      })),
    };
  });
  await page.screenshot({ path: path.join(outDir, "precentor-reveal.png") });
  check("crossing the gate reveals the boss but keeps it protected",
    reveal.status.phase === "alert" && reveal.visible && reveal.status.locked
      && !reveal.targetable && reveal.dealt === 0
      && reveal.healthAfter === reveal.healthBefore, JSON.stringify(reveal.status));
  check("the reveal publishes the Precentor to combat HUD and minimap",
    reveal.liveContacts === 1 && reveal.hudNamesBoss,
    `${reveal.liveContacts} contact · HUD=${reveal.hudNamesBoss}`);
  check("the reveal capture keeps the boss readable",
    revealFrame.phase === "alert" && revealFrame.rootVisible && revealFrame.orbit.ok
      && revealFrame.screen.width >= 0.20 && revealFrame.screen.height >= 0.28
      && revealFrame.screen.width <= 0.92 && revealFrame.screen.height <= 0.92
      && Math.abs(revealFrame.screen.centerX) <= 0.38
      && Math.abs(revealFrame.screen.centerY) <= 0.38
      && revealFrame.screen.inFrameFraction >= 0.88
      && revealFrame.regions.every((region) => region.inFrame && region.clear),
    JSON.stringify(revealFrame));

  const active = await page.evaluate(() => {
    const T = window.__SF;
    const H = T.ctx.districtBosses;
    for (let i = 0; i < 30; i += 1) H.update(0.1);
    const inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    T.ctx.enemies.play(inst, "idle", 0);
    inst.root.updateMatrixWorld(true);
    return { status: H.status("choir"), visible: inst.root.visible,
      targetable: T.combat.targetable(inst) };
  });
  check("the reveal resolves into a visible, targetable active fight",
    active.status.phase === "active" && !active.status.locked
      && active.visible && active.targetable, JSON.stringify(active));

  const firstActiveShot = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const statusBefore = T.combat.meshHitboxStatus(inst);
    const cache = inst.skinnedMeshHitCache;
    if (!cache?.proxies?.length) return { statusBefore, error: "missing instance proxy cache" };
    const skin = cache.skin;
    skin.updateWorldMatrix(true, false);
    skin.skeleton.update();
    const proxy = cache.proxies.find((entry) => !entry.head) || cache.proxies[0];
    const a = proxy.a.clone();
    const b = proxy.b.clone();
    skin.applyBoneTransform(proxy.representative, a);
    skin.applyBoneTransform(proxy.representative, b);
    skin.localToWorld(a);
    skin.localToWorld(b);
    const midpoint = a.clone().add(b).multiplyScalar(0.5);
    const outward = midpoint.clone().sub(inst.root.position);
    if (outward.lengthSq() < 1e-6) outward.set(1, 0, 0);
    outward.normalize();
    const scaleVector = skin.getWorldScale(new T.ctx.THREE.Vector3());
    const scale = Math.max(Math.abs(scaleVector.x), Math.abs(scaleVector.y),
      Math.abs(scaleVector.z));
    const radius = proxy.radius * scale
      + Math.max(0, Number(cache.config?.padding) || 0);
    const origin = midpoint.clone().addScaledVector(outward, radius + 0.24);
    const direction = outward.clone().multiplyScalar(-1);
    const range = radius * 2 + 0.72;
    const savedHealth = inst.health;
    const otherLocks = T.enemies.live.filter((enemy) => enemy !== inst).map((enemy) => ({
      enemy, hidden: enemy.encounterHidden, locked: enemy.encounterLocked,
    }));
    for (const entry of otherLocks) {
      entry.enemy.encounterHidden = true;
      entry.enemy.encounterLocked = true;
    }
    const beforeCache = inst.skinnedMeshHitCache;
    const start = performance.now();
    const firstHit = T.combat.fire(origin, direction, { damage: 1, range });
    const firstMs = performance.now() - start;
    const firstDamage = savedHealth - inst.health;
    inst.health = savedHealth;
    const warmTimes = [];
    let warmHits = 0;
    for (let sample = 0; sample < 15; sample += 1) {
      const at = performance.now();
      const hit = T.combat.fire(origin, direction, { damage: 1, range });
      warmTimes.push(performance.now() - at);
      if (hit?.inst === inst) warmHits += 1;
      inst.health = savedHealth;
    }
    warmTimes.sort((left, right) => left - right);
    const warmMedianMs = warmTimes[Math.floor(warmTimes.length / 2)] || 0;
    for (const entry of otherLocks) {
      entry.enemy.encounterHidden = entry.hidden;
      entry.enemy.encounterLocked = entry.locked;
    }
    return {
      statusBefore,
      statusAfter: T.combat.meshHitboxStatus(inst),
      cacheStable: beforeCache === inst.skinnedMeshHitCache,
      firstHit: firstHit?.inst === inst,
      firstHead: !!firstHit?.head,
      firstDamage: Number(firstDamage.toFixed(3)),
      firstMs: Number(firstMs.toFixed(3)),
      warmMedianMs: Number(warmMedianMs.toFixed(3)),
      warmHits,
      proxyRadius: Number(radius.toFixed(3)),
    };
  });
  check("the first active shot reuses the prebuilt proxy cache without a hitch",
    firstActiveShot.statusBefore?.instanceReady && firstActiveShot.cacheStable
      && firstActiveShot.firstHit && firstActiveShot.firstDamage > 0
      && firstActiveShot.warmHits === 15 && firstActiveShot.firstMs < 9
      && firstActiveShot.firstMs <= Math.max(4,
        firstActiveShot.warmMedianMs * 6 + 0.5),
    JSON.stringify(firstActiveShot));

  const proxyBroadReject = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const before = T.combat.meshHitboxStatus(inst);
    const hit = T.combat.raycastEnemies(inst.x + 1000, inst.y + 1000, inst.z + 1000,
      1, 0, 0, 12);
    const after = T.combat.meshHitboxStatus(inst);
    return { before, after, hit: hit?.inst?.eventId || null };
  });
  check("off-boss rays use the cheap broad reject before proxy iteration",
    proxyBroadReject.after.rayTests === proxyBroadReject.before.rayTests + 1
      && proxyBroadReject.after.broadRejects === proxyBroadReject.before.broadRejects + 1
      && proxyBroadReject.after.proxyTests === proxyBroadReject.before.proxyTests,
    JSON.stringify(proxyBroadReject));

  /* ---- SHOTS AGAINST THE ACTUAL POSED SURFACE ---------------------- */
  const shotCoverage = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const skin = inst.skin;
    const geometry = skin.geometry;
    const index = geometry.index;
    const skinIndex = geometry.getAttribute("skinIndex");
    const skinWeight = geometry.getAttribute("skinWeight");
    const reads = ["getX", "getY", "getZ", "getW"];
    const V3 = () => new T.ctx.THREE.Vector3();
    const classify = (name = "") => {
      if (/^(?:head|mandible_[LR])$/.test(name)) return "head";
      if (/^(?:thorax|pronotum)$/.test(name)) return "thorax";
      if (/^(?:abdomen|abdomen2)$/.test(name)) return "abdomen";
      const leg = /^(?:coxa|femur|tibia|foot)([01])_([LR])$/.exec(name);
      if (leg) return `leg${leg[1]}_${leg[2]}`;
      const scythe = /^(?:scythe|claw)_([LR])$/.exec(name);
      return scythe ? `scythe_${scythe[1]}` : null;
    };
    const vertexRegion = new Array(geometry.attributes.position.count).fill(null);
    const confidence = new Float32Array(vertexRegion.length);
    for (let vertex = 0; vertex < vertexRegion.length; vertex += 1) {
      let best = -1;
      let boneIndex = -1;
      for (let lane = 0; lane < 4; lane += 1) {
        const weight = skinWeight?.[reads[lane]]?.(vertex) || 0;
        if (weight > best) {
          best = weight;
          boneIndex = Math.round(skinIndex?.[reads[lane]]?.(vertex) || 0);
        }
      }
      vertexRegion[vertex] = classify(skin.skeleton.bones[boneIndex]?.name);
      confidence[vertex] = best;
    }
    const faces = Object.fromEntries(["head", "thorax", "abdomen", "leg0_L", "leg0_R",
      "leg1_L", "leg1_R", "scythe_L", "scythe_R"].map((name) => [name, []]));
    const triCount = index ? index.count / 3 : geometry.attributes.position.count / 3;
    for (let tri = 0; tri < triCount; tri += 1) {
      const a = index ? index.getX(tri * 3) : tri * 3;
      const b = index ? index.getX(tri * 3 + 1) : tri * 3 + 1;
      const c = index ? index.getX(tri * 3 + 2) : tri * 3 + 2;
      const region = vertexRegion[a];
      if (region && vertexRegion[b] === region && vertexRegion[c] === region
        && Math.min(confidence[a], confidence[b], confidence[c]) >= 0.52) {
        faces[region].push([a, b, c]);
      }
    }
    const world = (vertex, out) => {
      skin.getVertexPosition(vertex, out);
      return out.applyMatrix4(skin.matrixWorld);
    };
    const original = inst.health;
    const coverage = {};
    inst.encounterHidden = false;
    inst.encounterLocked = false;
    inst.root.visible = true;
    for (const [region, candidates] of Object.entries(faces)) {
      let hits = 0;
      let attempts = 0;
      const examples = [];
      const limit = Math.min(48, candidates.length);
      for (let sample = 0; sample < limit && hits < 3; sample += 1) {
        const at = Math.min(candidates.length - 1,
          Math.floor((sample + 0.5) * candidates.length / Math.max(1, limit)));
        const tri = candidates[at];
        if (!tri) break;
        const a = world(tri[0], V3());
        const b = world(tri[1], V3());
        const c = world(tri[2], V3());
        const target = a.clone().add(b).add(c).multiplyScalar(1 / 3);
        const normal = b.clone().sub(a).cross(c.clone().sub(a));
        if (normal.lengthSq() < 1e-9) continue;
        normal.normalize();
        attempts += 1;
        let landed = false;
        let hit = null;
        for (const sign of [1, -1]) {
          const origin = target.clone().addScaledVector(normal, 0.20 * sign);
          const direction = normal.clone().multiplyScalar(-sign);
          const before = inst.health;
          hit = T.combat.fire(origin, direction, { damage: 1, range: 0.46 });
          landed = hit?.inst === inst && inst.health < before;
          inst.health = original;
          if (landed) break;
        }
        if (landed) {
          hits += 1;
          examples.push({ x: Number(target.x.toFixed(2)), y: Number(target.y.toFixed(2)),
            z: Number(target.z.toFixed(2)), t: Number(hit.t.toFixed(3)) });
        }
      }
      coverage[region] = { faces: candidates.length, attempts, hits, examples };
    }
    inst.health = original;
    T.ctx.enemies.play(inst, "idle", 0);
    return coverage;
  });
  const missingShotRegions = regions.filter((name) => shotCoverage[name]?.faces < 3
    || shotCoverage[name]?.hits < 3);
  check("posed geometry resolves all nine named shot regions",
    regions.every((name) => shotCoverage[name]?.faces >= 3),
    missingShotRegions.length ? missingShotRegions.join(", ") : "9/9 weighted regions");
  check("three visible-surface shots land on every body, leg, and scythe region",
    missingShotRegions.length === 0,
    missingShotRegions.length ? JSON.stringify(Object.fromEntries(missingShotRegions
      .map((name) => [name, shotCoverage[name]]))) : "27/27 region samples hit");

  const facialClassification = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const skin = inst.skin;
    const geometry = skin.geometry;
    const position = geometry.getAttribute("position");
    const index = geometry.index;
    const skinIndex = geometry.getAttribute("skinIndex");
    const skinWeight = geometry.getAttribute("skinWeight");
    const reads = ["getX", "getY", "getZ", "getW"];
    const facialBones = new Set(["head", "mandible_L", "mandible_R",
      "antenna_L", "antenna_R"]);
    const namedOwnerFaces = Object.fromEntries([...facialBones].map((name) => [name, 0]));
    const owner = new Int16Array(position.count);
    owner.fill(-1);
    const parent = new Int32Array(position.count);
    parent.fill(-1);
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      let best = -1;
      let boneIndex = -1;
      for (let lane = 0; lane < 4; lane += 1) {
        const weight = skinWeight?.[reads[lane]]?.(vertex) || 0;
        if (weight > best) {
          best = weight;
          boneIndex = Math.round(skinIndex?.[reads[lane]]?.(vertex) || 0);
        }
      }
      const boneName = skin.skeleton.bones[boneIndex]?.name || "";
      if (!facialBones.has(boneName)) continue;
      owner[vertex] = boneIndex;
      parent[vertex] = vertex;
    }
    const find = (value) => {
      let root = value;
      while (parent[root] !== root) root = parent[root];
      while (parent[value] !== value) {
        const next = parent[value];
        parent[value] = root;
        value = next;
      }
      return root;
    };
    const unite = (left, right) => {
      if (left < 0 || right < 0 || parent[left] < 0 || parent[right] < 0
        || owner[left] !== owner[right]) return;
      const a = find(left);
      const b = find(right);
      if (a !== b) parent[b] = a;
    };
    const triangleCount = index ? index.count / 3 : position.count / 3;
    const triangles = [];
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const a = index ? index.getX(triangle * 3) : triangle * 3;
      const b = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
      const c = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
      triangles.push([a, b, c]);
      unite(a, b); unite(b, c); unite(c, a);
      if (owner[a] >= 0 && owner[a] === owner[b] && owner[a] === owner[c]) {
        const boneName = skin.skeleton.bones[owner[a]]?.name || "";
        if (boneName in namedOwnerFaces) namedOwnerFaces[boneName] += 1;
      }
    }
    const components = new Map();
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      if (parent[vertex] < 0) continue;
      const root = find(vertex);
      if (!components.has(root)) components.set(root, {
        id: root,
        boneName: skin.skeleton.bones[owner[vertex]]?.name || "",
        vertices: [],
        triangles: [],
      });
      components.get(root).vertices.push(vertex);
    }
    for (const triangle of triangles) {
      if (parent[triangle[0]] < 0 || owner[triangle[0]] !== owner[triangle[1]]
        || owner[triangle[0]] !== owner[triangle[2]]) continue;
      const root = find(triangle[0]);
      if (components.has(root)) components.get(root).triangles.push(triangle);
    }
    const headCore = new T.ctx.THREE.Vector3(0, 1.40, 0.98);
    const classified = [...components.values()].map((component) => {
      const low = [Infinity, Infinity, Infinity];
      const high = [-Infinity, -Infinity, -Infinity];
      for (const vertex of component.vertices) {
        const values = [position.getX(vertex), position.getY(vertex), position.getZ(vertex)];
        for (let axis = 0; axis < 3; axis += 1) {
          low[axis] = Math.min(low[axis], values[axis]);
          high[axis] = Math.max(high[axis], values[axis]);
        }
      }
      const center = new T.ctx.THREE.Vector3(
        (low[0] + high[0]) * 0.5,
        (low[1] + high[1]) * 0.5,
        (low[2] + high[2]) * 0.5);
      const spans = high.map((value, axis) => value - low[axis])
        .sort((left, right) => left - right);
      const middle = Math.max(0.01, spans[1]);
      const feeler = spans[2] >= 0.28 && middle <= 0.16 && spans[2] / middle >= 3.2;
      const inHeadCore = center.distanceTo(headCore) <= 0.74;
      const mandible = component.boneName.startsWith("mandible_");
      const namedAntenna = component.boneName.startsWith("antenna_");
      const visualMandible = component.boneName === "head"
        && Math.abs(center.x) <= 0.44
        && center.y >= 1.16 && center.y <= 1.52
        && center.z >= 0.98 && center.z <= 1.54;
      const isMandible = mandible || visualMandible;
      const head = isMandible || (component.boneName === "head"
        && inHeadCore && !feeler && !namedAntenna);
      return {
        ...component,
        center,
        spans,
        feeler,
        inHeadCore,
        namedAntenna,
        visualMandible,
        mandible: isMandible,
        head,
      };
    }).filter((component) => component.triangles.length > 0);
    const V3 = () => new T.ctx.THREE.Vector3();
    const world = (vertex, out) => {
      skin.getVertexPosition(vertex, out);
      return out.applyMatrix4(skin.matrixWorld);
    };
    const savedHealth = inst.health;
    const shootCategory = (candidates, expectsHead, targetSamples) => {
      const accepted = [];
      const mismatches = [];
      const audited = [];
      for (const component of candidates) {
        if (accepted.length >= targetSamples) break;
        const limit = Math.min(72, component.triangles.length);
        let componentHits = 0;
        for (let sample = 0; sample < limit && accepted.length < targetSamples; sample += 1) {
          const triangle = component.triangles[Math.min(component.triangles.length - 1,
            Math.floor((sample + 0.5) * component.triangles.length / Math.max(1, limit)))];
          const a = world(triangle[0], V3());
          const b = world(triangle[1], V3());
          const c = world(triangle[2], V3());
          const target = a.clone().add(b).add(c).multiplyScalar(1 / 3);
          const normal = b.clone().sub(a).cross(c.clone().sub(a));
          if (normal.lengthSq() < 1e-9) continue;
          normal.normalize();
          for (const sign of [1, -1]) {
            const origin = target.clone().addScaledVector(normal, 0.20 * sign);
            const direction = normal.clone().multiplyScalar(-sign);
            inst.health = savedHealth;
            const hit = T.combat.fire(origin, direction, { damage: 10, range: 0.48 });
            const damage = Number((savedHealth - inst.health).toFixed(3));
            if (hit?.inst !== inst || damage <= 0) continue;
            const observation = {
              component: component.id,
              boneName: component.boneName,
              head: !!hit.head,
              damage,
              at: target.toArray().map((value) => Number(value.toFixed(3))),
            };
            if (observation.head === expectsHead
              && Math.abs(observation.damage - (expectsHead ? 26 : 10)) <= 0.05) {
              accepted.push(observation);
              componentHits += 1;
            } else if (mismatches.length < 12) mismatches.push(observation);
            break;
          }
        }
        audited.push({
          id: component.id,
          boneName: component.boneName,
          faces: component.triangles.length,
          spans: component.spans.map((value) => Number(value.toFixed(3))),
          center: component.center.toArray().map((value) => Number(value.toFixed(3))),
          feeler: component.feeler,
          inHeadCore: component.inHeadCore,
          visualMandible: component.visualMandible,
          mandible: component.mandible,
          accepted: componentHits,
        });
      }
      return { accepted, mismatches, audited };
    };
    const broadHead = classified.filter((component) => component.head
      && !component.mandible)
      .sort((left, right) => right.triangles.length - left.triangles.length);
    const mandibleLeft = classified.filter((component) => component.mandible
      && component.center.x < 0)
      .sort((left, right) => right.triangles.length - left.triangles.length);
    const mandibleRight = classified.filter((component) => component.mandible
      && component.center.x >= 0)
      .sort((left, right) => right.triangles.length - left.triangles.length);
    const feelers = classified.filter((component) => !component.head
      && (component.feeler || !component.inHeadCore || component.namedAntenna))
      .sort((left, right) => right.spans[2] - left.spans[2]);
    const head = shootCategory(broadHead, true, 2);
    const mandibles = {
      left: shootCategory(mandibleLeft, true, 1),
      right: shootCategory(mandibleRight, true, 1),
    };
    const feeler = shootCategory(feelers, false, 2);
    /* Independent reviewed fixtures. Selection knows only authored local
       centre/span measurements; it deliberately does not consult `head`,
       `feeler`, the runtime region, or the mandible-zone classifier. */
    const fixedFixture = (id, centerValues, spanValues, expectsHead) => {
      const fixtureCenter = new T.ctx.THREE.Vector3(...centerValues);
      const ranked = classified.map((component) => {
        const centerDistance = component.center.distanceTo(fixtureCenter);
        const spanDistance = Math.hypot(...component.spans.map((value, axis) =>
          value - spanValues[axis]));
        return { component, centerDistance, spanDistance,
          score: centerDistance + spanDistance * 0.6 };
      }).sort((left, right) => left.score - right.score);
      const match = ranked[0];
      const available = !!match && match.centerDistance <= 0.16
        && match.spanDistance <= 0.20;
      return {
        id,
        requestedCenter: centerValues,
        requestedSpans: spanValues,
        available,
        matchedCenter: match?.component.center.toArray()
          .map((value) => Number(value.toFixed(3))) || null,
        matchedSpans: match?.component.spans
          .map((value) => Number(value.toFixed(3))) || null,
        centerDistance: Number((match?.centerDistance ?? Infinity).toFixed(4)),
        spanDistance: Number((match?.spanDistance ?? Infinity).toFixed(4)),
        shot: available ? shootCategory([match.component], expectsHead, 1) : null,
      };
    };
    const fixtures = {
      centralLowerFace: fixedFixture("central-lower-face",
        [0.001, 1.281, 0.933], [0.067, 0.104, 0.336], true),
      highLateralFeeler: fixedFixture("high-lateral-feeler",
        [0.265, 1.636, 0.893], [0.104, 0.126, 0.183], false),
      mirroredHighLateralFeeler: fixedFixture("mirrored-high-lateral-feeler",
        [-0.265, 1.636, 0.893], [0.104, 0.126, 0.183], false),
    };
    inst.health = savedHealth;
    T.ctx.enemies.play(inst, "idle", 0);
    return {
      namedOwnerFaces,
      components: {
        total: classified.length,
        broadHead: broadHead.length,
        mandibleLeft: mandibleLeft.length,
        mandibleRight: mandibleRight.length,
        feelerOrOutOfCore: feelers.length,
      },
      head,
      mandibles,
      feeler,
      fixtures,
    };
  });
  check("facial shell topology is classified instead of trusting empty bone labels",
    facialClassification.namedOwnerFaces.head > 0
      && facialClassification.components.broadHead > 0
      && facialClassification.components.feelerOrOutOfCore > 0,
    JSON.stringify({ namedOwnerFaces: facialClassification.namedOwnerFaces,
      components: facialClassification.components }));
  check("two broad in-core skull surface shots retain 2.6x headshots",
    facialClassification.head.accepted.length >= 2
      && facialClassification.head.accepted.every((entry) =>
        entry.head && Math.abs(entry.damage - 26) <= 0.05),
    JSON.stringify(facialClassification.head));
  check("left and right visual mandible-zone surfaces retain 2.6x headshots",
    [facialClassification.mandibles.left, facialClassification.mandibles.right]
      .every((side) => side.accepted.length >= 1
        && side.accepted[0].head && Math.abs(side.accepted[0].damage - 26) <= 0.05),
    JSON.stringify(facialClassification.mandibles));
  check("two visible slender or out-of-core feeler shots deal body damage",
    facialClassification.feeler.accepted.length >= 2
      && facialClassification.feeler.accepted.every((entry) =>
        !entry.head && Math.abs(entry.damage - 10) <= 0.05),
    JSON.stringify(facialClassification.feeler));
  check("the fixed central lower-face surface is independently a headshot",
    facialClassification.fixtures.centralLowerFace.available
      && facialClassification.fixtures.centralLowerFace.shot.accepted.length >= 1
      && facialClassification.fixtures.centralLowerFace.shot.accepted[0].head
      && Math.abs(facialClassification.fixtures.centralLowerFace
        .shot.accepted[0].damage - 26) <= 0.05,
    JSON.stringify(facialClassification.fixtures.centralLowerFace));
  check("the fixed high-lateral feeler-base surface independently deals body damage",
    facialClassification.fixtures.highLateralFeeler.available
      && facialClassification.fixtures.highLateralFeeler.shot.accepted.length >= 1
      && !facialClassification.fixtures.highLateralFeeler.shot.accepted[0].head
      && Math.abs(facialClassification.fixtures.highLateralFeeler
        .shot.accepted[0].damage - 10) <= 0.05
      && (!facialClassification.fixtures.mirroredHighLateralFeeler.available
        || (facialClassification.fixtures.mirroredHighLateralFeeler
          .shot.accepted.length >= 1
          && !facialClassification.fixtures.mirroredHighLateralFeeler
            .shot.accepted[0].head
          && Math.abs(facialClassification.fixtures.mirroredHighLateralFeeler
            .shot.accepted[0].damage - 10) <= 0.05)),
    JSON.stringify({ high: facialClassification.fixtures.highLateralFeeler,
      mirrored: facialClassification.fixtures.mirroredHighLateralFeeler }));

  /* ---- MELEE FROM REACHABLE VISIBLE ANATOMY ------------------------ */
  const meleeCoverage = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const skin = inst.skin;
    const geometry = skin.geometry;
    const skinIndex = geometry.getAttribute("skinIndex");
    const skinWeight = geometry.getAttribute("skinWeight");
    const reads = ["getX", "getY", "getZ", "getW"];
    const targets = Object.fromEntries(["leg0_L", "leg0_R", "leg1_L", "leg1_R",
      "scythe_L", "scythe_R", "thorax", "abdomen"].map((name) => [name, []]));
    const classify = (name = "") => {
      if (/^(?:thorax|pronotum)$/.test(name)) return "thorax";
      if (/^(?:abdomen|abdomen2)$/.test(name)) return "abdomen";
      const leg = /^(?:coxa|femur|tibia|foot)([01])_([LR])$/.exec(name);
      if (leg) return `leg${leg[1]}_${leg[2]}`;
      const scythe = /^(?:scythe|claw)_([LR])$/.exec(name);
      return scythe ? `scythe_${scythe[1]}` : null;
    };
    const point = new T.ctx.THREE.Vector3();
    skin.updateWorldMatrix(true, false);
    for (let vertex = 0; vertex < geometry.attributes.position.count; vertex += 1) {
      let best = -1;
      let boneIndex = -1;
      for (let lane = 0; lane < 4; lane += 1) {
        const weight = skinWeight?.[reads[lane]]?.(vertex) || 0;
        if (weight > best) {
          best = weight;
          boneIndex = Math.round(skinIndex?.[reads[lane]]?.(vertex) || 0);
        }
      }
      const region = classify(skin.skeleton.bones[boneIndex]?.name);
      if (!region || best < 0.52) continue;
      skin.getVertexPosition(vertex, point);
      point.applyMatrix4(skin.matrixWorld);
      targets[region].push({ x: point.x, y: point.y, z: point.z });
    }
    T.equipWeapon("glaive");
    const ps = T.ctx.player.state;
    const original = inst.health;
    const originalSpeeds = { ...inst.spec.speed };
    inst.spec.speed.walk = 0;
    inst.spec.speed.charge = 0;
    const report = {};
    for (const [region, points] of Object.entries(targets)) {
      points.sort((a, b) => a.y - b.y);
      const target = points[Math.min(points.length - 1,
        Math.floor(points.length * 0.03))];
      if (!target) {
        report[region] = { vertices: 0, reachable: false, hits: 0, damage: 0 };
        continue;
      }
      ps.x = target.x;
      ps.z = target.z;
      ps.y = T.ctx.collide.groundHeight(ps.x, ps.z);
      ps.grounded = true;
      const before = inst.health = original;
      const hits = T.combat.meleeStrike(1, Math.PI * 2, false, 1, 0);
      const damage = before - inst.health;
      const vertical = target.y - ps.y;
      report[region] = {
        vertices: points.length,
        reachable: vertical <= 3.6,
        vertical: Number(vertical.toFixed(3)),
        centerDistance: Number(Math.hypot(target.x - inst.x, target.z - inst.z).toFixed(3)),
        hits,
        damage: Number(damage.toFixed(3)),
      };
      inst.health = original;
    }
    Object.assign(inst.spec.speed, originalSpeeds);
    inst.health = original;
    return report;
  });
  const meleeMisses = meleeRegions.filter((name) => !meleeCoverage[name]?.reachable
    || meleeCoverage[name]?.hits < 1 || meleeCoverage[name]?.damage <= 0);
  check("all four walking legs expose anatomy below melee height",
    meleeRegions.slice(0, 4).every((name) => meleeCoverage[name]?.reachable),
    JSON.stringify(meleeCoverage));
  check("melee connects from every lower leg and raptorial scythe",
    meleeMisses.length === 0,
    meleeMisses.length ? meleeMisses.join(", ") : "6/6 visible anatomy approaches damaged the boss");
  check("melee also connects with both reachable body sections",
    bodyMeleeRegions.every((name) => meleeCoverage[name]?.reachable
      && meleeCoverage[name]?.hits >= 1 && meleeCoverage[name]?.damage > 0),
    JSON.stringify(Object.fromEntries(bodyMeleeRegions
      .map((name) => [name, meleeCoverage[name]]))));

  const emptyGapMelee = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const box = T.combat.hitbox.precentor;
    const ps = T.ctx.player.state;
    const savedPlayer = { x: ps.x, y: ps.y, z: ps.z, yaw: ps.yaw, grounded: ps.grounded };
    const savedHealth = inst.health;
    const savedSpeeds = { ...inst.spec.speed };
    const otherLocks = T.enemies.live.filter((enemy) => enemy !== inst).map((enemy) => ({
      enemy, hidden: enemy.encounterHidden, locked: enemy.encounterLocked,
    }));
    for (const entry of otherLocks) {
      entry.enemy.encounterHidden = true;
      entry.enemy.encounterLocked = true;
    }
    inst.spec.speed.walk = 0;
    inst.spec.speed.charge = 0;
    inst.encounterHidden = false;
    inst.encounterLocked = false;
    T.equipWeapon("glaive");
    const attempts = [];
    let selected = null;
    for (let bearing = 0; bearing < 48 && !selected; bearing += 1) {
      const angle = bearing / 48 * Math.PI * 2;
      const outwardX = Math.sin(angle);
      const outwardZ = Math.cos(angle);
      const lateralX = Math.cos(angle);
      const lateralZ = -Math.sin(angle);
      const originX = inst.x + outwardX * 4.85;
      const originZ = inst.z + outwardZ * 4.85;
      const originY = T.ctx.collide.groundHeight(originX, originZ) + 1.4;
      if (!Number.isFinite(originY)) continue;
      for (const offset of [-1.45, -1.05, -0.65, -0.25, 0.25, 0.65, 1.05, 1.45]) {
        const targetX = inst.x + lateralX * offset;
        const targetZ = inst.z + lateralZ * offset;
        const dx = targetX - originX;
        const dz = targetZ - originZ;
        const distance = Math.hypot(dx, dz);
        const ux = dx / distance;
        const uz = dz / distance;
        const rayLength = distance + box.r * 2.25;
        const wall = T.ctx.collide.rayBlock(originX, originY, originZ,
          ux, 0, uz, rayLength);
        if (wall < rayLength) continue;
        const visualHit = T.combat.raycastEnemies(originX, originY, originZ,
          ux, 0, uz, rayLength);
        if (visualHit?.inst === inst) continue;
        ps.x = originX;
        ps.z = originZ;
        ps.y = originY - 1.4;
        ps.yaw = Math.atan2(ux, uz);
        ps.grounded = true;
        inst.health = savedHealth;
        const hits = T.combat.meleeStrike(1, 0.035, false, 1, 0);
        const damage = savedHealth - inst.health;
        const sample = {
          bearing: Number((angle * 180 / Math.PI).toFixed(1)),
          offset: Number(offset.toFixed(2)),
          insideOldRadius: Math.abs(offset) < box.r,
          oldEnvelopeReach: Number((distance - box.r).toFixed(3)),
          visibleRayMiss: true,
          hits,
          damage: Number(damage.toFixed(3)),
          origin: [originX, originY, originZ].map((value) => Number(value.toFixed(3))),
          target: [targetX, originY, targetZ].map((value) => Number(value.toFixed(3))),
        };
        attempts.push(sample);
        if (hits === 0 && damage === 0) { selected = sample; break; }
      }
    }
    inst.health = savedHealth;
    Object.assign(inst.spec.speed, savedSpeeds);
    Object.assign(ps, savedPlayer);
    for (const entry of otherLocks) {
      entry.enemy.encounterHidden = entry.hidden;
      entry.enemy.encounterLocked = entry.locked;
    }
    return {
      selected,
      gapRaysTested: attempts.length,
      rejectedGapRays: attempts.filter((sample) => sample.hits > 0).slice(0, 12),
    };
  });
  check("a narrow melee aim through empty space inside the old capsule misses",
    !!emptyGapMelee.selected?.insideOldRadius
      && emptyGapMelee.selected.oldEnvelopeReach < 3.38
      && emptyGapMelee.selected.visibleRayMiss
      && emptyGapMelee.selected.hits === 0 && emptyGapMelee.selected.damage === 0,
    JSON.stringify(emptyGapMelee));

  const asymmetricMelee = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const ps = T.ctx.player.state;
    const cache = inst.skinnedMeshHitCache;
    const box = T.combat.hitbox.precentor;
    const savedPlayer = { x: ps.x, y: ps.y, z: ps.z, yaw: ps.yaw, grounded: ps.grounded };
    const savedHealth = inst.health;
    const savedSpeeds = { ...inst.spec.speed };
    const otherLocks = T.enemies.live.filter((enemy) => enemy !== inst).map((enemy) => ({
      enemy, hidden: enemy.encounterHidden, locked: enemy.encounterLocked,
    }));
    for (const entry of otherLocks) {
      entry.enemy.encounterHidden = true;
      entry.enemy.encounterLocked = true;
    }
    inst.spec.speed.walk = 0;
    inst.spec.speed.charge = 0;
    inst.root.updateWorldMatrix(true, true);
    cache.skin.skeleton.update();
    const scaleVector = cache.skin.getWorldScale(new T.ctx.THREE.Vector3());
    const scale = Math.max(Math.abs(scaleVector.x), Math.abs(scaleVector.y),
      Math.abs(scaleVector.z));
    const padding = Math.max(0, Number(box.meshVolumes.meleePadding) || 0.24);
    const proxies = cache.proxies.map((proxy, index) => {
      const a = proxy.a.clone();
      const b = proxy.b.clone();
      cache.skin.applyBoneTransform(proxy.representative, a);
      cache.skin.applyBoneTransform(proxy.representative, b);
      cache.skin.localToWorld(a);
      cache.skin.localToWorld(b);
      return { index, a, b, radius: proxy.radius * scale + padding,
        region: proxy.region, boneName: proxy.boneName };
    });
    const wrap = (angle) => {
      while (angle > Math.PI) angle -= Math.PI * 2;
      while (angle < -Math.PI) angle += Math.PI * 2;
      return angle;
    };
    const nearest = (proxy, x, z, maxY) => {
      const a = proxy.a.clone();
      const b = proxy.b.clone();
      if (a.y > maxY + proxy.radius && b.y > maxY + proxy.radius) return null;
      if (a.y > maxY + proxy.radius) {
        const t = (maxY + proxy.radius - a.y) / (b.y - a.y);
        a.lerpVectors(proxy.a, proxy.b, Math.max(0, Math.min(1, t)));
      } else if (b.y > maxY + proxy.radius) {
        const t = (maxY + proxy.radius - a.y) / (b.y - a.y);
        b.lerpVectors(proxy.a, proxy.b, Math.max(0, Math.min(1, t)));
      }
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const lengthSq = ex * ex + ez * ez;
      const t = lengthSq < 1e-8 ? 0
        : Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / lengthSq));
      const point = new T.ctx.THREE.Vector3(
        a.x + ex * t, a.y + (b.y - a.y) * t, a.z + ez * t);
      const distance = Math.hypot(point.x - x, point.z - z);
      return { ...proxy, point, distance, surface: distance - proxy.radius };
    };
    const reach = (T.ctx.weapons.current?.spec?.reach || 2.72) * 1.24;
    const arc = 0.18;
    let arrangement = null;
    for (const playerRadius of [3.4, 3.8, 4.2, 4.6, 5.0]) {
      for (let bearing = 0; bearing < 72 && !arrangement; bearing += 1) {
        const angle = bearing / 72 * Math.PI * 2;
        const x = inst.x + Math.sin(angle) * playerRadius;
        const z = inst.z + Math.cos(angle) * playerRadius;
        const y = T.ctx.collide.groundHeight(x, z);
        const baseYaw = Math.atan2(inst.x - x, inst.z - z);
        for (const yawOffset of [-0.34, -0.22, -0.12, 0, 0.12, 0.22, 0.34]) {
          const yaw = baseYaw + yawOffset;
          const samples = [];
          for (const proxy of proxies) {
            const sample = nearest(proxy, x, z,
              y + (Number(box.meshVolumes.meleeReachY) || 3.2));
            if (!sample || sample.surface > reach || sample.distance <= 1.2) continue;
            sample.rel = wrap(Math.atan2(sample.point.x - x, sample.point.z - z) - yaw);
            const dx = sample.point.x - x;
            const dz = sample.point.z - z;
            const inv = 1 / Math.max(1e-4, sample.distance);
            sample.clear = T.ctx.collide.rayBlock(x, y + 1.4, z,
              dx * inv, 0, dz * inv, sample.distance) >= sample.distance;
            samples.push(sample);
          }
          if (!samples.length) continue;
          samples.sort((left, right) => left.surface - right.surface);
          const rear = samples[0];
          const front = samples.find((sample) => Math.abs(sample.rel) <= arc * 0.5
            && sample.clear);
          if (!front || Math.abs(rear.rel) <= arc * 0.5
            || rear.surface + 0.03 >= front.surface) continue;
          arrangement = { x, y, z, yaw, playerRadius, bearing, yawOffset, rear, front };
          break;
        }
      }
    }
    let hits = 0;
    let damage = 0;
    if (arrangement) {
      ps.x = arrangement.x;
      ps.y = arrangement.y;
      ps.z = arrangement.z;
      ps.yaw = arrangement.yaw;
      ps.grounded = true;
      inst.health = savedHealth;
      hits = T.combat.meleeStrike(1, arc, false, 1, 0);
      damage = savedHealth - inst.health;
    }
    const compact = (sample) => sample ? {
      index: sample.index,
      region: sample.region,
      boneName: sample.boneName,
      distance: Number(sample.distance.toFixed(4)),
      surface: Number(sample.surface.toFixed(4)),
      rel: Number(sample.rel.toFixed(4)),
      clear: sample.clear,
      point: sample.point.toArray().map((value) => Number(value.toFixed(3))),
    } : null;
    const report = arrangement ? {
      playerRadius: arrangement.playerRadius,
      bearing: arrangement.bearing,
      yawOffset: arrangement.yawOffset,
      arc,
      rear: compact(arrangement.rear),
      front: compact(arrangement.front),
      hits,
      damage: Number(damage.toFixed(3)),
    } : { arrangement: null, hits, damage };
    inst.health = savedHealth;
    Object.assign(inst.spec.speed, savedSpeeds);
    Object.assign(ps, savedPlayer);
    for (const entry of otherLocks) {
      entry.enemy.encounterHidden = entry.hidden;
      entry.enemy.encounterLocked = entry.locked;
    }
    return report;
  });
  check("a closer rear proxy cannot mask a valid front narrow-arc melee target",
    asymmetricMelee.rear && asymmetricMelee.front
      && Math.abs(asymmetricMelee.rear.rel) > asymmetricMelee.arc * 0.5
      && Math.abs(asymmetricMelee.front.rel) <= asymmetricMelee.arc * 0.5
      && asymmetricMelee.rear.surface < asymmetricMelee.front.surface
      && asymmetricMelee.front.clear
      && asymmetricMelee.hits >= 1 && asymmetricMelee.damage > 0,
    JSON.stringify(asymmetricMelee));

  /* ---- AUTHORED STRIKE / DAMAGE / RANGE ---------------------------- */
  const strikeRange = await page.evaluate(() => {
    const T = window.__SF;
    const H = T.ctx.districtBosses;
    const inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const ps = T.ctx.player.state;
    const reach = 6.2;
    const originalSpeeds = { ...inst.spec.speed };
    inst.spec.speed.walk = 0;
    inst.spec.speed.charge = 0;
    const otherLocks = T.enemies.live.filter((enemy) => enemy !== inst).map((enemy) => ({
      enemy,
      hidden: enemy.encounterHidden,
      locked: enemy.encounterLocked,
    }));
    for (const entry of otherLocks) entry.enemy.encounterLocked = true;
    T.invulnerable(false);
    T.ctx.shield.state.active = false;
    T.combat.player.dead = false;
    T.combat.player.hp = T.combat.player.maxHp;
    const clearBearing = (() => {
      const box = T.combat.hitbox.precentor;
      for (let i = 0; i < 32; i += 1) {
        const angle = i / 32 * Math.PI * 2;
        const x = inst.x + Math.sin(angle) * (reach - 0.45);
        const z = inst.z + Math.cos(angle) * (reach - 0.45);
        const y = T.ctx.collide.groundHeight(x, z) + 1.62;
        const ox = inst.x + Math.sin(inst.yaw) * (box.headZ || 0);
        const oy = inst.y + (box.head || 1.7);
        const oz = inst.z + Math.cos(inst.yaw) * (box.headZ || 0);
        const dx = x - ox; const dy = y - oy; const dz = z - oz;
        const distance = Math.hypot(dx, dy, dz);
        if (T.ctx.collide.rayBlock(ox, oy, oz, dx / distance, dy / distance,
          dz / distance, distance, true) >= distance - 0.01) return angle;
      }
      return 0;
    })();
    let nearFires = 0;
    let farFires = 0;
    let phase = "near";
    const off = T.combat.bus.on("enemyFire", (event) => {
      if (event.key !== "precentor") return;
      if (phase === "near") nearFires += 1;
      else farFires += 1;
    });
    const place = (distance) => {
      ps.x = inst.x + Math.sin(clearBearing) * distance;
      ps.z = inst.z + Math.cos(clearBearing) * distance;
      ps.y = T.ctx.collide.groundHeight(ps.x, ps.z);
      ps.grounded = true;
    };
    place(reach - 0.45);
    inst.encounterHidden = false;
    inst.encounterLocked = false;
    inst.suspicion = 1;
    inst.alerted = true;
    inst.stunTime = 0;
    inst.fireTimer = 0;
    const hp0 = T.combat.player.hp;
    T.combat.update(0.05);
    const hp1 = T.combat.player.hp;
    const nearState = inst.state;

    phase = "far";
    T.combat.player.hp = T.combat.player.maxHp;
    T.ctx.enemies.play(inst, "idle", 0);
    inst.fireTimer = 0;
    place(reach + 1.25);
    const hp2 = T.combat.player.hp;
    T.combat.update(0.05);
    const hp3 = T.combat.player.hp;
    const farState = inst.state;
    off?.();
    T.invulnerable(true);
    Object.assign(inst.spec.speed, originalSpeeds);
    for (const entry of otherLocks) {
      entry.enemy.encounterHidden = entry.hidden;
      entry.enemy.encounterLocked = entry.locked;
    }
    return {
      reach,
      nearDistance: reach - 0.45,
      farDistance: reach + 1.25,
      nearFires,
      farFires,
      nearDamage: Number((hp0 - hp1).toFixed(3)),
      farDamage: Number((hp2 - hp3).toFixed(3)),
      expectedDamage: Number((54 * 0.82).toFixed(3)),
      nearState,
      farState,
      clearBearing: Number(clearBearing.toFixed(3)),
      status: H.status("choir"),
    };
  });
  check("inside 6.2m the Precentor plays strike and deals its tuned damage once",
    strikeRange.nearFires === 1 && strikeRange.nearState === "strike"
      && Math.abs(strikeRange.nearDamage - strikeRange.expectedDamage) < 0.05,
    JSON.stringify(strikeRange));
  check("outside 6.2m the same ready strike cannot hit",
    strikeRange.farFires === 0 && strikeRange.farDamage === 0,
    JSON.stringify(strikeRange));

  /* ---- IK GROUNDING / PIVOT / DEFORMATION -------------------------- */
  const pivot = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const skin = inst.skin;
    const geometry = skin.geometry;
    const index = geometry.index;
    const skinIndex = geometry.getAttribute("skinIndex");
    const skinWeight = geometry.getAttribute("skinWeight");
    const reads = ["getX", "getY", "getZ", "getW"];
    const V3 = () => new T.ctx.THREE.Vector3();
    const classify = (name = "") => {
      if (/^(?:head|mandible_[LR])$/.test(name)) return "head";
      if (/^(?:thorax|pronotum)$/.test(name)) return "thorax";
      if (/^(?:abdomen|abdomen2)$/.test(name)) return "abdomen";
      const leg = /^(?:coxa|femur|tibia|foot)([01])_([LR])$/.exec(name);
      if (leg) return `leg${leg[1]}_${leg[2]}`;
      const scythe = /^(?:scythe|claw)_([LR])$/.exec(name);
      return scythe ? `scythe_${scythe[1]}` : null;
    };
    const owner = new Array(geometry.attributes.position.count).fill(null);
    const dominantBone = new Array(owner.length).fill("");
    const confidence = new Float32Array(owner.length);
    const footVertices = Object.fromEntries(["0_L", "0_R", "1_L", "1_R"]
      .map((name) => [name, []]));
    for (let vertex = 0; vertex < owner.length; vertex += 1) {
      let best = -1;
      let boneIndex = -1;
      for (let lane = 0; lane < 4; lane += 1) {
        const weight = skinWeight?.[reads[lane]]?.(vertex) || 0;
        if (weight > best) {
          best = weight;
          boneIndex = Math.round(skinIndex?.[reads[lane]]?.(vertex) || 0);
        }
      }
      const boneName = skin.skeleton.bones[boneIndex]?.name || "";
      dominantBone[vertex] = boneName;
      owner[vertex] = classify(boneName);
      confidence[vertex] = best;
      const footOwner = /^foot([01]_[LR])$/.exec(boneName);
      if (footOwner && best >= 0.52) footVertices[footOwner[1]].push(vertex);
    }
    /* Meshy can assign the visible sole connector to the adjacent tibia even
       when its geometry physically overlaps the foot. Measure the complete
       contact assembly: every exact foot-owned vertex plus same-leg tibia
       vertices within 0.36 GLB-local metres of that authored foot shell. */
    const contactNearLocal = 0.36;
    const position = geometry.attributes.position;
    const contactVertices = {};
    const adjacentTibiaContactVertices = {};
    for (const [key, exactFoot] of Object.entries(footVertices)) {
      const tibiaName = `tibia${key}`;
      const nearby = [];
      for (let vertex = 0; vertex < owner.length; vertex += 1) {
        if (dominantBone[vertex] !== tibiaName || confidence[vertex] < 0.52) continue;
        const cx = position.getX(vertex);
        const cy = position.getY(vertex);
        const cz = position.getZ(vertex);
        let near = false;
        for (const footVertex of exactFoot) {
          const dx = cx - position.getX(footVertex);
          const dy = cy - position.getY(footVertex);
          const dz = cz - position.getZ(footVertex);
          if (dx * dx + dy * dy + dz * dz <= contactNearLocal * contactNearLocal) {
            near = true;
            break;
          }
        }
        if (near) nearby.push(vertex);
      }
      adjacentTibiaContactVertices[key] = nearby;
      contactVertices[key] = [...new Set([...exactFoot, ...nearby])];
    }
    const candidates = [];
    const triCount = index ? index.count / 3 : geometry.attributes.position.count / 3;
    for (let tri = 0; tri < triCount; tri += 1) {
      const a = index ? index.getX(tri * 3) : tri * 3;
      const b = index ? index.getX(tri * 3 + 1) : tri * 3 + 1;
      const c = index ? index.getX(tri * 3 + 2) : tri * 3 + 2;
      if (owner[a] && owner[a] === owner[b] && owner[a] === owner[c]
        && Math.min(confidence[a], confidence[b], confidence[c]) >= 0.90) {
        candidates.push([a, b, c]);
      }
    }
    const chosen = [];
    const sampleCount = Math.min(240, candidates.length);
    for (let i = 0; i < sampleCount; i += 1) {
      chosen.push(candidates[Math.floor((i + 0.5) * candidates.length / sampleCount)]);
    }
    const world = (vertex, out) => {
      skin.getVertexPosition(vertex, out);
      return out.applyMatrix4(skin.matrixWorld);
    };
    const edges = (tri) => {
      const a = world(tri[0], V3());
      const b = world(tri[1], V3());
      const c = world(tri[2], V3());
      return [a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)];
    };
    const baseline = chosen.map(edges);
    const ps = T.ctx.player.state;
    const originalSpeeds = { ...inst.spec.speed };
    inst.spec.speed.walk = 0;
    inst.spec.speed.charge = 0;
    inst.encounterHidden = false;
    inst.encounterLocked = false;
    inst.suspicion = 1;
    inst.alerted = true;
    T.invulnerable(true);
    let finite = true;
    let maxStretch = 1;
    let maxReachExcess = -Infinity;
    let maxRequestedReachExcess = -Infinity;
    let maxPlantedBoneGroundError = 0;
    let maxPlantTargetGroundError = 0;
    let maxVisualFootClearance = 0;
    let maxVisualFootPenetration = 0;
    let plantedSamples = 0;
    let totalTurn = 0;
    let previousYaw = inst.yaw;
    const legsSeen = new Set();
    let worstVisibleContact = { magnitude: 0 };
    let worstContactPose = null;
    const snapshotPose = () => ({
      actor: { x: inst.x, y: inst.y, z: inst.z, yaw: inst.yaw },
      root: {
        position: inst.root.position.toArray(),
        quaternion: inst.root.quaternion.toArray(),
        scale: inst.root.scale.toArray(),
      },
      bones: skin.skeleton.bones.map((bone) => ({
        position: bone.position.toArray(),
        quaternion: bone.quaternion.toArray(),
        scale: bone.scale.toArray(),
      })),
    });
    const makeFootExtrema = () => ({
      samples: 0,
      maxVisualClearance: { value: 0 },
      maxVisualPenetration: { value: 0 },
      maxBoneClearance: { value: 0 },
      maxBonePenetration: { value: 0 },
      maxPlantTargetClearance: { value: 0 },
      maxPlantTargetPenetration: { value: 0 },
      maxRequestedReachExcess: { value: 0 },
    });
    const perFoot = Object.fromEntries(Object.keys(footVertices)
      .map((key) => [key, { ...makeFootExtrema(), byBearing: {} }]));
    const recordMax = (entry, field, value, meta) => {
      if (value < entry[field].value) return;
      entry[field] = { value: Number(value.toFixed(4)), ...meta };
    };
    const recordFootSample = (leg, bearing, frame) => {
      const key = `${leg.i}_${leg.side}`;
      legsSeen.add(key);
      leg.femur.updateWorldMatrix(true, false);
      leg.toe.updateWorldMatrix(true, false);
      const hip = leg.femur.getWorldPosition(V3());
      const toe = leg.toe.getWorldPosition(V3());
      maxReachExcess = Math.max(maxReachExcess,
        hip.distanceTo(toe) - (leg.femurLen + leg.tibiaLen));
      if (leg.stepping > 0) return;
      const requestedReachExcess = hip.distanceTo(leg.foot)
        - (leg.femurLen + leg.tibiaLen);
      maxRequestedReachExcess = Math.max(maxRequestedReachExcess, requestedReachExcess);
      plantedSamples += 1;
      const toeOffset = toe.y - T.ctx.collide.groundHeight(toe.x, toe.z);
      const targetOffset = leg.foot.y
        - T.ctx.collide.groundHeight(leg.foot.x, leg.foot.z);
      maxPlantedBoneGroundError = Math.max(maxPlantedBoneGroundError,
        Math.abs(toeOffset));
      maxPlantTargetGroundError = Math.max(maxPlantTargetGroundError,
        Math.abs(targetOffset));
      let visualClearance = Infinity;
      let sourceVertex = -1;
      let sourceSurface = null;
      for (const vertex of contactVertices[key]) {
        const surface = world(vertex, V3());
        const clearance = surface.y - T.ctx.collide.groundHeight(surface.x, surface.z);
        if (clearance < visualClearance) {
          visualClearance = clearance;
          sourceVertex = vertex;
          sourceSurface = surface.clone();
        }
      }
      if (!Number.isFinite(visualClearance)) return;
      maxVisualFootClearance = Math.max(maxVisualFootClearance, visualClearance);
      maxVisualFootPenetration = Math.max(maxVisualFootPenetration, -visualClearance);
      const meta = {
        bearing,
        bearingDegrees: Number((bearing / 24 * 360).toFixed(1)),
        frame,
        stepping: Number(leg.stepping.toFixed(4)),
        requestedReachExcess: Number(requestedReachExcess.toFixed(4)),
        toe: toe.toArray().map((value) => Number(value.toFixed(3))),
        plantTarget: [leg.foot.x, leg.foot.y, leg.foot.z]
          .map((value) => Number(value.toFixed(3))),
        sourceVertex,
        dominantBone: dominantBone[sourceVertex] || "",
        localBind: sourceVertex >= 0
          ? [position.getX(sourceVertex), position.getY(sourceVertex), position.getZ(sourceVertex)]
            .map((value) => Number(value.toFixed(4))) : null,
        contactWorld: sourceSurface?.toArray()
          .map((value) => Number(value.toFixed(3))) || null,
      };
      if (Math.abs(visualClearance) > worstVisibleContact.magnitude) {
        worstVisibleContact = {
          ...meta,
          leg: key,
          kind: visualClearance >= 0 ? "clearance" : "penetration",
          signedOffset: Number(visualClearance.toFixed(4)),
          magnitude: Number(Math.abs(visualClearance).toFixed(4)),
        };
        worstContactPose = snapshotPose();
      }
      const entries = [perFoot[key],
        perFoot[key].byBearing[bearing]
          || (perFoot[key].byBearing[bearing] = makeFootExtrema())];
      for (const entry of entries) {
        entry.samples += 1;
        recordMax(entry, "maxVisualClearance", Math.max(0, visualClearance), meta);
        recordMax(entry, "maxVisualPenetration", Math.max(0, -visualClearance), meta);
        recordMax(entry, "maxBoneClearance", Math.max(0, toeOffset), meta);
        recordMax(entry, "maxBonePenetration", Math.max(0, -toeOffset), meta);
        recordMax(entry, "maxPlantTargetClearance", Math.max(0, targetOffset), meta);
        recordMax(entry, "maxPlantTargetPenetration", Math.max(0, -targetOffset), meta);
        recordMax(entry, "maxRequestedReachExcess", Math.max(0, requestedReachExcess), meta);
      }
    };
    for (let bearing = 0; bearing < 24; bearing += 1) {
      const angle = bearing / 24 * Math.PI * 2;
      ps.x = inst.x + Math.sin(angle) * 16;
      ps.z = inst.z + Math.cos(angle) * 16;
      ps.y = T.ctx.collide.groundHeight(ps.x, ps.z);
      for (let frame = 0; frame < 20; frame += 1) {
        T.renderOnce(1 / 60);
        for (const leg of inst.legs) recordFootSample(leg, bearing, frame);
      }
      let yawDelta = inst.yaw - previousYaw;
      while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
      while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
      totalTurn += Math.abs(yawDelta);
      previousYaw = inst.yaw;
      inst.root.traverse((node) => {
        if (node.matrixWorld?.elements?.some((value) => !Number.isFinite(value))) finite = false;
        if (node.quaternion && [node.quaternion.x, node.quaternion.y,
          node.quaternion.z, node.quaternion.w].some((value) => !Number.isFinite(value))) finite = false;
      });
      for (let face = 0; face < chosen.length; face += 1) {
        const now = edges(chosen[face]);
        for (let edge = 0; edge < 3; edge += 1) {
          const baseEdge = baseline[face][edge];
          if (baseEdge <= 1e-5) continue;
          maxStretch = Math.max(maxStretch, now[edge] / baseEdge,
            baseEdge / Math.max(1e-5, now[edge]));
        }
      }
    }
    window.__SF_PRECENTOR_WORST_CONTACT_POSE = worstContactPose
      ? { ...worstContactPose, meta: worstVisibleContact } : null;
    Object.assign(inst.spec.speed, originalSpeeds);
    return {
      sampledFaces: chosen.length,
      finite,
      legs: [...legsSeen].sort(),
      contactSurfaceDefinition: "exact foot-owned vertices plus same-leg tibia vertices within 0.36 GLB-local metres of the foot shell; >=0.52 dominant weight",
      contactNearLocal,
      weightedFootVertices: Object.fromEntries(Object.entries(footVertices)
        .map(([name, vertices]) => [name, vertices.length])),
      adjacentTibiaContactVertices: Object.fromEntries(
        Object.entries(adjacentTibiaContactVertices)
          .map(([name, vertices]) => [name, vertices.length])),
      contactVertices: Object.fromEntries(Object.entries(contactVertices)
        .map(([name, vertices]) => [name, vertices.length])),
      worstVisibleContact,
      perFoot: Object.fromEntries(Object.entries(perFoot).map(([key, entry]) => [key, {
        ...entry,
        byBearing: Object.values(entry.byBearing),
      }])),
      plantedSamples,
      maxStretch: Number(maxStretch.toFixed(4)),
      maxReachExcess: Number(maxReachExcess.toFixed(4)),
      maxRequestedReachExcess: Number(maxRequestedReachExcess.toFixed(4)),
      maxPlantedBoneGroundError: Number(maxPlantedBoneGroundError.toFixed(4)),
      maxPlantTargetGroundError: Number(maxPlantTargetGroundError.toFixed(4)),
      maxVisualFootClearance: Number(maxVisualFootClearance.toFixed(4)),
      maxVisualFootPenetration: Number(maxVisualFootPenetration.toFixed(4)),
      totalTurn: Number(totalTurn.toFixed(3)),
    };
  });
  check("a full player orbit drives a finite four-leg pivot",
    pivot.finite && JSON.stringify(pivot.legs) === JSON.stringify(exactLegs)
      && pivot.totalTurn > 4.5, JSON.stringify(pivot));
  const footGroundSummary = Object.fromEntries(Object.entries(pivot.perFoot)
    .map(([name, foot]) => [name, {
      visualClearance: foot.maxVisualClearance,
      visualPenetration: foot.maxVisualPenetration,
      boneClearance: foot.maxBoneClearance,
      bonePenetration: foot.maxBonePenetration,
      requestedReachExcess: foot.maxRequestedReachExcess,
    }]));
  check("all four planted feet remain grounded during the pivot",
    pivot.plantedSamples >= 24
      && Object.values(pivot.weightedFootVertices).every((count) => count >= 20)
      && Object.values(pivot.adjacentTibiaContactVertices).every((count) => count > 0)
      && Object.entries(pivot.contactVertices).every(([name, count]) =>
        count > pivot.weightedFootVertices[name])
      && pivot.maxPlantTargetGroundError <= 0.02
      && pivot.maxVisualFootClearance <= 0.18 && pivot.maxVisualFootPenetration <= 0.18,
    `${pivot.plantedSamples} plants · target ${pivot.maxPlantTargetGroundError}m · `
      + `visible +${pivot.maxVisualFootClearance}/-${pivot.maxVisualFootPenetration}m · `
      + `foot-bone offset ${pivot.maxPlantedBoneGroundError}m · `
      + JSON.stringify(footGroundSummary));
  check("IK never requests a planted target beyond measured walking-chain reach",
    pivot.maxRequestedReachExcess <= 0,
    `solved ${pivot.maxReachExcess}m · requested target ${pivot.maxRequestedReachExcess}m`);
  check("rigid weighted armour does not stretch through the full pivot",
    pivot.sampledFaces >= 120 && pivot.maxStretch < 1.08,
    `${pivot.sampledFaces} faces · ${pivot.maxStretch}x`);

  const worstContactCapture = await page.evaluate(() => {
    const T = window.__SF;
    const pose = window.__SF_PRECENTOR_WORST_CONTACT_POSE;
    const inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    if (!pose || !inst) return null;
    inst.x = pose.actor.x;
    inst.y = pose.actor.y;
    inst.z = pose.actor.z;
    inst.yaw = pose.actor.yaw;
    inst.root.position.fromArray(pose.root.position);
    inst.root.quaternion.fromArray(pose.root.quaternion);
    inst.root.scale.fromArray(pose.root.scale);
    inst.skin.skeleton.bones.forEach((bone, index) => {
      const saved = pose.bones[index];
      if (!saved) return;
      bone.position.fromArray(saved.position);
      bone.quaternion.fromArray(saved.quaternion);
      bone.scale.fromArray(saved.scale);
    });
    inst.root.updateWorldMatrix(true, true);
    inst.skin.skeleton.update();
    const contact = new T.ctx.THREE.Vector3().fromArray(pose.meta.contactWorld);
    const outward = contact.clone().sub(new T.ctx.THREE.Vector3(inst.x, contact.y, inst.z));
    if (outward.lengthSq() < 1e-6) outward.set(1, 0, 0);
    outward.normalize();
    const camera = contact.clone().addScaledVector(outward, 6.2);
    camera.y += 2.4;
    const target = contact.clone();
    target.y += 0.45;
    T.lookAt(camera.toArray(), target.toArray(), 46);
    T.renderStill();
    return { meta: pose.meta, image: T.captureDataURL() };
  });
  if (worstContactCapture?.image) {
    const filename = "precentor-worst-visible-contact.png";
    await writeFile(path.join(outDir, filename), dataBuffer(worstContactCapture.image));
    pivot.worstVisiblePoseCapture = filename;
  }

  const footProxySync = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const skin = inst.skin;
    const geometry = skin.geometry;
    const index = geometry.index;
    const skinIndex = geometry.getAttribute("skinIndex");
    const skinWeight = geometry.getAttribute("skinWeight");
    const reads = ["getX", "getY", "getZ", "getW"];
    const footNames = ["foot0_L", "foot0_R", "foot1_L", "foot1_R"];
    const faces = Object.fromEntries(footNames.map((name) => [name, []]));
    const owner = new Array(geometry.attributes.position.count).fill("");
    const confidence = new Float32Array(owner.length);
    for (let vertex = 0; vertex < owner.length; vertex += 1) {
      let best = -1;
      let boneIndex = -1;
      for (let lane = 0; lane < 4; lane += 1) {
        const weight = skinWeight?.[reads[lane]]?.(vertex) || 0;
        if (weight > best) {
          best = weight;
          boneIndex = Math.round(skinIndex?.[reads[lane]]?.(vertex) || 0);
        }
      }
      owner[vertex] = skin.skeleton.bones[boneIndex]?.name || "";
      confidence[vertex] = best;
    }
    const triangleCount = index ? index.count / 3 : geometry.attributes.position.count / 3;
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const a = index ? index.getX(triangle * 3) : triangle * 3;
      const b = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
      const c = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
      const name = owner[a];
      if (faces[name] && owner[b] === name && owner[c] === name
        && Math.min(confidence[a], confidence[b], confidence[c]) >= 0.52) {
        faces[name].push([a, b, c]);
      }
    }
    const V3 = () => new T.ctx.THREE.Vector3();
    const bonePositions = () => Object.fromEntries(footNames.map((name) => {
      const bone = inst.bones.get(name);
      bone.updateWorldMatrix(true, false);
      return [name, bone.getWorldPosition(V3())];
    }));
    const ps = T.ctx.player.state;
    const savedPlayer = { x: ps.x, y: ps.y, z: ps.z, yaw: ps.yaw, grounded: ps.grounded };
    const savedSpeeds = { ...inst.spec.speed };
    const savedHealth = inst.health;
    const otherLocks = T.enemies.live.filter((enemy) => enemy !== inst).map((enemy) => ({
      enemy, hidden: enemy.encounterHidden, locked: enemy.encounterLocked,
    }));
    for (const entry of otherLocks) {
      entry.enemy.encounterHidden = true;
      entry.enemy.encounterLocked = true;
    }
    inst.spec.speed.walk = 0;
    inst.spec.speed.charge = 0;
    const before = bonePositions();
    ps.x = inst.x - Math.sin(inst.yaw) * 14;
    ps.z = inst.z - Math.cos(inst.yaw) * 14;
    ps.y = T.ctx.collide.groundHeight(ps.x, ps.z);
    ps.grounded = true;
    for (let frame = 0; frame < 18; frame += 1) T.renderOnce(1 / 60);
    /* This is the one authoritative pose update under test. No render/step
       occurs between it, the visible-vertex read, and any proxy shot. */
    T.renderOnce(1 / 60);
    skin.updateWorldMatrix(true, false);
    const after = bonePositions();
    const poseDelta = Math.max(...footNames.map((name) => before[name].distanceTo(after[name])));
    const world = (vertex, out) => {
      skin.getVertexPosition(vertex, out);
      return out.applyMatrix4(skin.matrixWorld);
    };
    const statusBefore = T.combat.meshHitboxStatus(inst);
    const report = {};
    for (const name of footNames) {
      const candidates = faces[name];
      let accepted = null;
      let attempts = 0;
      const limit = Math.min(72, candidates.length);
      for (let sample = 0; sample < limit && !accepted; sample += 1) {
        const triangle = candidates[Math.min(candidates.length - 1,
          Math.floor((sample + 0.5) * candidates.length / Math.max(1, limit)))];
        if (!triangle) continue;
        const a = world(triangle[0], V3());
        const b = world(triangle[1], V3());
        const c = world(triangle[2], V3());
        const target = a.clone().add(b).add(c).multiplyScalar(1 / 3);
        const normal = b.clone().sub(a).cross(c.clone().sub(a));
        if (normal.lengthSq() < 1e-9) continue;
        normal.normalize();
        attempts += 1;
        for (const sign of [1, -1]) {
          const origin = target.clone().addScaledVector(normal, 0.20 * sign);
          const direction = normal.clone().multiplyScalar(-sign);
          inst.health = savedHealth;
          const hit = T.combat.fire(origin, direction, { damage: 1, range: 0.48 });
          const damage = savedHealth - inst.health;
          if (hit?.inst === inst && damage > 0) {
            accepted = {
              t: Number(hit.t.toFixed(4)),
              damage: Number(damage.toFixed(3)),
              at: target.toArray().map((value) => Number(value.toFixed(3))),
            };
            break;
          }
        }
      }
      report[name] = { faces: candidates.length, attempts, accepted };
    }
    const statusAfter = T.combat.meshHitboxStatus(inst);
    inst.health = savedHealth;
    Object.assign(inst.spec.speed, savedSpeeds);
    Object.assign(ps, savedPlayer);
    for (const entry of otherLocks) {
      entry.enemy.encounterHidden = entry.hidden;
      entry.enemy.encounterLocked = entry.locked;
    }
    T.ctx.enemies.play(inst, "idle", 0);
    return {
      poseDelta: Number(poseDelta.toFixed(4)),
      sameFrame: true,
      statusBefore,
      statusAfter,
      feet: report,
    };
  });
  check("same-frame proxy shots follow all four visibly re-posed feet",
    footProxySync.sameFrame && footProxySync.poseDelta > 0.01
      && ["foot0_L", "foot0_R", "foot1_L", "foot1_R"]
        .every((name) => footProxySync.feet[name]?.faces > 0
        && footProxySync.feet[name]?.accepted?.damage > 0)
      && footProxySync.statusAfter.proxyTests > footProxySync.statusBefore.proxyTests,
    JSON.stringify(footProxySync));

  /* ---- ACTIVE-FIGHT SAVE / RESTORE --------------------------------- */
  const persistence = await page.evaluate(() => {
    const T = window.__SF;
    const H = T.ctx.districtBosses;
    let inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const ps = T.ctx.player.state;
    ps.x = inst.x + 18;
    ps.z = inst.z;
    ps.y = T.ctx.collide.groundHeight(ps.x, ps.z);
    ps.grounded = true;
    ps.free = false;
    T.ctx.player.action = null;
    T.ctx.jetpack.state.inFlight = false;
    T.ctx.boost.state.active = false;
    T.ctx.slam.state.active = false;
    T.ctx.shield.state.active = false;
    inst.encounterHidden = false;
    inst.encounterLocked = false;
    inst.health = inst.maxHealth - 437;
    const expected = { id: inst.id, health: inst.health, phase: H.status("choir").phase };
    const reason = T.saves.saveReason();
    const snapshot = T.saves.capture();
    if (!snapshot) return { captured: false, reason, expected };
    H.reset("choir");
    inst.health = 11;
    const accepted = T.saves.apply(snapshot);
    inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const owned = T.enemies.live.filter((enemy) => enemy.eventId === "district-boss:choir");
    return {
      captured: true,
      accepted,
      reason,
      expected,
      owned: owned.length,
      id: inst?.id,
      health: inst?.health,
      status: H.status("choir"),
      targetable: T.combat.targetable(inst),
    };
  });
  check("an active Precentor fight produces an accepted field snapshot",
    persistence.captured && persistence.accepted,
    persistence.reason || JSON.stringify(persistence));
  check("reload restores one identical active boss with exact partial health",
    persistence.owned === 1 && persistence.id === persistence.expected.id
      && persistence.health === persistence.expected.health
      && persistence.status.phase === "active" && persistence.targetable,
    JSON.stringify(persistence));

  /* ---- ARENA RESET / FRESH RE-ENTRY -------------------------------- */
  const arena = await page.evaluate(() => {
    const T = window.__SF;
    const H = T.ctx.districtBosses;
    let inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const site = T.ctx.mission.bosses.find((boss) => boss.key === "choir");
    const ps = T.ctx.player.state;
    const events = [];
    const offs = [
      H.bus.on("exitWarning", (event) => { if (event.key === "choir") events.push("exitWarning"); }),
      H.bus.on("arenaReset", (event) => { if (event.key === "choir") events.push("arenaReset"); }),
      H.bus.on("aggro", (event) => { if (event.key === "choir") events.push("aggro"); }),
      H.bus.on("engaged", (event) => { if (event.key === "choir") events.push("engaged"); }),
    ];
    T.combat.damageEnemy(inst, 500, { source: "qa-arena" });
    const damaged = H.status("choir");
    ps.x = site.x + site.arenaRadius - 10;
    ps.z = site.z;
    ps.y = T.ctx.collide.groundHeight(ps.x, ps.z);
    H.update(0.05);
    ps.x = site.x + site.arenaRadius + 2;
    ps.y = T.ctx.collide.groundHeight(ps.x, ps.z);
    H.update(0.05);
    const reset = H.status("choir");
    inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const resetTargetable = T.combat.targetable(inst);
    ps.x = reset.x + 18;
    ps.z = reset.z;
    ps.y = T.ctx.collide.groundHeight(ps.x, ps.z);
    H.update(0.05);
    const alert = H.status("choir");
    for (let i = 0; i < 30; i += 1) H.update(0.1);
    const reentered = H.status("choir");
    const reentryTargetable = T.combat.targetable(inst);
    for (const off of offs) off?.();
    return { damaged, reset, alert, reentered, resetTargetable,
      reentryTargetable, events, owned: T.enemies.live.filter((enemy) =>
        enemy.eventId === "district-boss:choir").length };
  });
  check("the inner boundary warns and leaving fully resets the fight",
    arena.damaged.health < arena.damaged.maxHealth
      && arena.events.includes("exitWarning") && arena.events.includes("arenaReset")
      && arena.reset.phase === "dormant" && arena.reset.hidden && arena.reset.locked
      && arena.reset.health === arena.reset.maxHealth && !arena.resetTargetable,
    JSON.stringify(arena));
  check("re-entry reuses the one boss and completes a fresh reveal",
    arena.owned === 1 && arena.alert.phase === "alert"
      && arena.reentered.phase === "active" && arena.reentryTargetable
      && arena.events.includes("aggro") && arena.events.includes("engaged"),
    JSON.stringify(arena));

  /* ---- DEATH / MISSION / PROGRESSION ------------------------------- */
  const death = await page.evaluate(() => {
    const T = window.__SF;
    const H = T.ctx.districtBosses;
    const M = T.ctx.mission;
    const inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const before = {
      xp: T.progression.state().xp,
      bossesDone: M.state.bossesDone,
      kills: T.combat.player.kills,
    };
    let kills = 0;
    let defeats = 0;
    const offs = [
      T.combat.bus.on("kill", (event) => {
        if (event.enemyId === inst.id && event.enemyKey === "precentor") kills += 1;
      }),
      H.bus.on("defeated", (event) => { if (event.key === "choir") defeats += 1; }),
    ];
    const dealt = T.combat.damageEnemy(inst, inst.health + 1, { source: "qa-precentor-death" });
    H.update(0.05);
    M.update(0.05);
    const duplicate = T.combat.damageEnemy(inst, 9999, { source: "qa-precentor-duplicate" });
    H.update(0.05);
    const after = {
      xp: T.progression.state().xp,
      bossesDone: M.state.bossesDone,
      kills: T.combat.player.kills,
    };
    for (const off of offs) off?.();
    return {
      dealt,
      duplicate,
      kills,
      defeats,
      state: inst.state,
      currentClip: [...inst.actions].find(([, action]) => action === inst.current)?.[0] || null,
      status: H.status("choir"),
      missionDone: M.bosses.find((boss) => boss.key === "choir")?.done,
      objectiveBoss: M.objective()?.bossKey || null,
      before,
      after,
      xpDelta: after.xp - before.xp,
    };
  });
  check("lethal damage plays death and reports exactly one district victory",
    death.dealt > 0 && death.duplicate === 0 && death.kills === 1 && death.defeats === 1
      && death.state === "death" && death.currentClip === "death"
      && death.status.phase === "dead" && death.missionDone,
    JSON.stringify(death));
  check("the victory advances the operation once and removes the Choir objective",
    death.after.bossesDone === death.before.bossesDone + 1
      && death.objectiveBoss !== "choir", JSON.stringify(death));
  check("the authoritative Precentor kill awards exactly 300 career XP once",
    death.xpDelta === 300 && death.after.kills === death.before.kills + 1,
    `${death.xpDelta} XP · ${death.after.kills - death.before.kills} kill`);

  /* ---- ISOLATED HIGH-QUALITY COST ---------------------------------- */
  await page.close();
  const costPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  monitor(costPage);
  await costPage.goto(`${base}/games/saintfall.html?qa=1&quality=high&cost=1&seed=precentor-cost`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await costPage.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  const cost = await costPage.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    document.getElementById("sf-boot")?.remove();
    T.invulnerable(true);
    T.hideHud(true);
    T.hidePlayer(true);
    T.hideVfx(true);
    const H = T.ctx.districtBosses;
    const status = H.status("choir");
    const ps = T.ctx.player.state;
    ps.x = status.x + 18;
    ps.z = status.z;
    ps.y = T.ctx.collide.groundHeight(ps.x, ps.z);
    H.update(0.05);
    for (let i = 0; i < 30; i += 1) H.update(0.1);
    const inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    for (const enemy of T.enemies.live) {
      if (enemy === inst) continue;
      enemy.encounterHidden = true;
      enemy.encounterLocked = true;
      enemy.root.visible = false;
    }
    inst.encounterHidden = false;
    inst.encounterLocked = false;
    inst.root.visible = true;
    inst.spec.speed.walk = 0;
    inst.spec.speed.charge = 0;
    T.ctx.enemies.play(inst, "alert", 0);
    T.lookAt([inst.x + 18, inst.y + 5, inst.z + 20],
      [inst.x, inst.y + 3, inst.z], 52);
    for (let i = 0; i < 36; i += 1) T.renderStill();
    const passes = [];
    const frames = 180;
    for (let pass = 0; pass < 3; pass += 1) {
      const start = performance.now();
      for (let frame = 0; frame < frames; frame += 1) T.renderStill();
      passes.push((performance.now() - start) / frames);
    }
    const sorted = [...passes].sort((a, b) => a - b);
    const report = T.report();
    return {
      passes: passes.map((value) => Number(value.toFixed(3))),
      medianMs: Number(sorted[1].toFixed(3)),
      framesPerPass: frames,
      render: report.render,
      visibleEnemies: T.enemies.live.filter((enemy) => enemy.root.visible).map((enemy) => ({
        id: enemy.id, key: enemy.key, eventId: enemy.eventId,
      })),
    };
  });
  check("the isolated high-quality encounter stays below 9ms per frame",
    cost.medianMs < 9 && cost.visibleEnemies.length === 1
      && cost.visibleEnemies[0].eventId === "district-boss:choir",
    `${cost.medianMs}ms median · ${cost.render.calls} calls · ${cost.render.triangles} rendered tris`);

  const realConsoleErrors = consoleErrors.filter((message) =>
    !/jsdelivr|unpkg|favicon|Failed to load resource/i.test(message));
  check("the focused browser run has no page errors",
    pageErrors.length === 0, pageErrors.join(" | "));
  check("every same-origin game asset loads successfully",
    assetFailures.length === 0 && assetRequests.some((entry) => entry.status === 200
      && /\/assets\/models\/saintfall\/precentor\.glb(?:\?|$)/.test(entry.url)),
    assetFailures.slice(0, 8).join(" | "));
  check("the remodel emits no relevant console warnings or errors",
    consoleWarnings.length === 0 && realConsoleErrors.length === 0,
    [...consoleWarnings, ...realConsoleErrors].slice(0, 8).join(" | "));

  const report = {
    checks: results.length,
    passed: results.filter((result) => result.ok).length,
    failed,
    results,
    contract,
    reveal,
    revealFrame,
    firstActiveShot,
    proxyBroadReject,
    shotCoverage,
    facialClassification,
    meleeCoverage,
    emptyGapMelee,
    asymmetricMelee,
    strikeRange,
    pivot,
    footProxySync,
    persistence,
    arena,
    death,
    cost,
    diagnostics: { pageErrors, consoleErrors, consoleWarnings, assetFailures, assetRequests },
  };
  await writeFile(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${report.passed}/${report.checks} checks passed`);
  console.log(`Hitbox suggestion: ${JSON.stringify(contract.hitboxFit.suggested)}`);
  console.log(`Report: ${path.join(outDir, "report.json")}`);
  await browser.close();
} finally {
  server.kill("SIGTERM");
}

process.exitCode = failed ? 1 : 0;
