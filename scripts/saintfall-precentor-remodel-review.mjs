#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Precentor remodel visual and asset review

   Reviews the durable Choir Spires encounter instance, not a generic
   bestiary spawn. The report is deliberately both visual and numeric:
   six bearings, every authored action, two lighting conditions, an
   in-arena scale lineup, the GLB/PBR/rig budget, and a posed hit-volume
   fit derived from the same vertices the player sees.

   Usage:
     node scripts/saintfall-precentor-remodel-review.mjs [--out output/path]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith("--")
    ? argv[at + 1] : fallback;
};
const outDir = path.resolve(root,
  option("out", "output/saintfall/precentor-remodel-review"));
const port = 53800 + (process.pid % 4200);
const base = `http://127.0.0.1:${port}`;

const expectedBones = [
  "root", "thorax", "pronotum", "head", "abdomen", "abdomen2",
  "mandible_L", "mandible_R", "antenna_L", "antenna_R",
  "scythe_L", "scythe_R", "claw_L", "claw_R",
  ...[0, 1].flatMap((pair) => ["L", "R"].flatMap((side) =>
    ["coxa", "femur", "tibia", "foot"].map((part) => `${part}${pair}_${side}`))),
].sort();
const expectedClips = ["alert", "death", "flinch", "idle", "strike"];

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

async function contactSheet(entries, columns, width, height, filename) {
  const rows = Math.ceil(entries.length / columns);
  const tiles = await Promise.all(entries.map(async ({ buffer, label }, index) => ({
    input: await sharp(buffer).resize(width, height, { fit: "cover" }).composite([{
      input: Buffer.from(`<svg width="${width}" height="32" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="32" fill="#09080e" fill-opacity="0.9"/>
        <text x="11" y="22" fill="#f3c15d" font-family="monospace" font-size="15">${label}</text>
      </svg>`), left: 0, top: 0,
    }]).png().toBuffer(),
    left: (index % columns) * width,
    top: Math.floor(index / columns) * height,
  })));
  await sharp({
    create: {
      width: columns * width,
      height: rows * height,
      channels: 3,
      background: "#09080e",
    },
  }).composite(tiles).png().toFile(path.join(outDir, filename));
}

const dataBuffer = (dataUrl) =>
  Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");

try {
  await mkdir(outDir, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      if ((await fetch(`${base}/games/saintfall.html`)).ok) { ready = true; break; }
    } catch (_) { /* retry */ }
    await delay(100);
  }
  if (!ready) throw new Error("local Saintfall server did not become ready");

  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  const consoleErrors = [];
  const consoleWarnings = [];
  const assetFailures = [];
  const assetRequests = [];
  const sameOrigin = (url) => url.startsWith(base);
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

  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high&time=goldenhour&seed=precentor-review`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  const model = await page.evaluate(() => {
    const T = window.__SF;
    const H = T.ctx.districtBosses;
    T.maximize();
    document.getElementById("sf-boot")?.remove();
    T.invulnerable(true);
    const initial = H.status("choir");
    T._teleportRaw(initial.x + 18, initial.z, 0);
    H.update(0.05);
    for (let i = 0; i < 30; i += 1) H.update(0.1);
    const instances = T.enemies.live.filter((enemy) =>
      enemy.eventId === "district-boss:choir");
    const inst = instances[0];
    if (!inst) return { error: "district-boss:choir did not spawn" };

    /* Preserve the domain boss but make every unrelated garrison/boss truly
       absent from review frames. enemies.update() recomputes root.visible,
       so setting only the root would be overwritten on the next still. */
    for (const enemy of T.enemies.live) {
      if (enemy === inst) continue;
      enemy.encounterHidden = true;
      if (enemy.root) enemy.root.visible = false;
    }
    inst.encounterHidden = false;
    inst.encounterLocked = false;
    inst.root.visible = true;
    inst.spec.speed.walk = 0;
    inst.spec.speed.charge = 0;
    T.ctx.enemies.play(inst, "idle", 0);
    const idle = inst.actions.get("idle");
    if (idle) idle.time = idle.getClip().duration * 0.34;
    inst.mixer.update(0);
    inst.root.updateMatrixWorld(true);

    const skin = inst.skin;
    const geometry = skin?.geometry;
    const materials = [];
    const textures = [];
    let meshes = 0;
    let skinnedMeshes = 0;
    let primitives = 0;
    let triangles = 0;
    inst.root.traverse((child) => {
      if (!child.isMesh) return;
      meshes += 1;
      if (child.isSkinnedMesh) skinnedMeshes += 1;
      primitives += Math.max(1, child.geometry?.groups?.length || 0);
      triangles += (child.geometry?.index?.count
        || child.geometry?.attributes?.position?.count || 0) / 3;
      for (const material of (Array.isArray(child.material)
        ? child.material : [child.material])) {
        if (material && !materials.includes(material)) materials.push(material);
      }
    });
    for (const material of materials) {
      for (const [role, texture] of [["base", material.map], ["normal", material.normalMap],
        ["roughness", material.roughnessMap], ["metalness", material.metalnessMap],
        ["emissive", material.emissiveMap]]) {
        if (!texture || textures.some((entry) => entry.uuid === texture.uuid)) continue;
        const source = texture.source?.data || texture.image || {};
        textures.push({
          uuid: texture.uuid,
          roles: [role],
          width: source.width || source.videoWidth || 0,
          height: source.height || source.videoHeight || 0,
          anisotropy: texture.anisotropy || 1,
        });
      }
    }
    for (const material of materials) {
      for (const [role, texture] of [["base", material.map], ["normal", material.normalMap],
        ["roughness", material.roughnessMap], ["metalness", material.metalnessMap],
        ["emissive", material.emissiveMap]]) {
        const entry = textures.find((candidate) => candidate.uuid === texture?.uuid);
        if (entry && !entry.roles.includes(role)) entry.roles.push(role);
      }
    }

    const classify = (name = "") => {
      if (/^(?:head|mandible_[LR])$/.test(name)) return "head";
      if (/^(?:thorax|pronotum)$/.test(name)) return "thorax";
      if (/^(?:abdomen|abdomen2)$/.test(name)) return "abdomen";
      const leg = /^(?:coxa|femur|tibia|foot)([01])_([LR])$/.exec(name);
      if (leg) return `leg${leg[1]}_${leg[2]}`;
      const scythe = /^(?:scythe|claw)_([LR])$/.exec(name);
      if (scythe) return `scythe_${scythe[1]}`;
      return null;
    };
    const regions = Object.fromEntries(["head", "thorax", "abdomen",
      "leg0_L", "leg0_R", "leg1_L", "leg1_R", "scythe_L", "scythe_R"]
      .map((name) => [name, []]));
    const all = [];
    if (skin && geometry) {
      const skinIndex = geometry.getAttribute("skinIndex");
      const skinWeight = geometry.getAttribute("skinWeight");
      const reads = ["getX", "getY", "getZ", "getW"];
      const point = new T.ctx.THREE.Vector3();
      for (let vertex = 0; vertex < geometry.getAttribute("position").count; vertex += 1) {
        let bestWeight = -1;
        let boneIndex = -1;
        for (let lane = 0; lane < 4; lane += 1) {
          const weight = skinWeight?.[reads[lane]]?.(vertex) || 0;
          if (weight > bestWeight) {
            bestWeight = weight;
            boneIndex = Math.round(skinIndex?.[reads[lane]]?.(vertex) || 0);
          }
        }
        skin.getVertexPosition(vertex, point);
        point.applyMatrix4(skin.matrixWorld);
        const record = { x: point.x, y: point.y, z: point.z, weight: bestWeight };
        all.push(record);
        const region = classify(skin.skeleton.bones[boneIndex]?.name);
        if (region) regions[region].push(record);
      }
    }
    const bounds = (points) => {
      if (!points.length) return null;
      const lo = { x: Infinity, y: Infinity, z: Infinity };
      const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (const point of points) {
        lo.x = Math.min(lo.x, point.x); lo.y = Math.min(lo.y, point.y);
        lo.z = Math.min(lo.z, point.z); hi.x = Math.max(hi.x, point.x);
        hi.y = Math.max(hi.y, point.y); hi.z = Math.max(hi.z, point.z);
      }
      return { min: lo, max: hi,
        size: { x: hi.x - lo.x, y: hi.y - lo.y, z: hi.z - lo.z },
        center: { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: (lo.z + hi.z) / 2 } };
    };
    const percentile = (values, q) => {
      if (!values.length) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
    };
    const wholeBounds = bounds(all);
    const bodyPoints = [...regions.thorax, ...regions.abdomen];
    const headPoints = regions.head;
    const forward = { x: Math.sin(inst.yaw), z: Math.cos(inst.yaw) };
    const lateral = { x: Math.cos(inst.yaw), z: -Math.sin(inst.yaw) };
    const localRecord = (point) => {
      const dx = point.x - inst.x;
      const dz = point.z - inst.z;
      return { side: dx * lateral.x + dz * lateral.z,
        up: point.y - inst.y, forward: dx * forward.x + dz * forward.z };
    };
    const bodyLocal = bodyPoints.map(localRecord);
    const headBone = inst.bones.get("head");
    const headWorld = new T.ctx.THREE.Vector3();
    headBone?.getWorldPosition(headWorld);
    const liveHead = localRecord(headWorld);
    const headRadius = percentile(headPoints.map((point) => point.distance
      || Math.hypot(point.x - headWorld.x, point.y - headWorld.y, point.z - headWorld.z)), 0.92);
    const currentHitbox = { ...(T.combat.hitbox.precentor || {}) };
    const suggestedHitbox = {
      r: Number(percentile(bodyLocal.map((point) => Math.hypot(point.side, point.forward)), 0.96).toFixed(2)),
      y0: Number(percentile(bodyLocal.map((point) => point.up), 0.02).toFixed(2)),
      y1: Number(percentile(bodyLocal.map((point) => point.up), 0.98).toFixed(2)),
      head: Number(liveHead.up.toFixed(2)),
      headR: Number(Math.max(0.2, headRadius).toFixed(2)),
      headZ: Number(liveHead.forward.toFixed(2)),
    };
    const headFitOffset = Math.hypot(
      liveHead.side,
      liveHead.up - (currentHitbox.head || 0),
      liveHead.forward - (currentHitbox.headZ || 0)
    );

    const source = T.enemies.species.get("precentor");
    const clips = [...inst.actions.keys()].sort();
    const clipAudit = Object.fromEntries([...source.clips].map(([name, clip]) => [name, {
      duration: Number(clip.duration.toFixed(3)),
      tracks: clip.tracks.length,
      walkingLegTracks: clip.tracks.filter((track) =>
        /(?:coxa|femur|tibia|foot)[01]_[LR]/.test(track.name)).length,
    }]));
    T.hideHud(true);
    T.hidePlayer(true);
    T.hideVfx(true);
    /* A review turntable must review the model, not whichever dune or Choir
       needle happens to sit between a fixed orbit and the arena centre. The
       studio exists only in this QA page; the separate context capture below
       restores the authored world and terrain. */
    const studio = new T.ctx.THREE.Group();
    studio.name = "qa-precentor-review-studio";
    const floor = new T.ctx.THREE.Mesh(
      new T.ctx.THREE.CircleGeometry(14, 72),
      new T.ctx.THREE.MeshStandardMaterial({
        color: 0x24181c, roughness: 0.92, metalness: 0.04,
      })
    );
    floor.rotation.x = -Math.PI * 0.5;
    floor.position.set(inst.x, inst.y - 0.04, inst.z);
    floor.receiveShadow = true;
    studio.add(floor);
    const hemi = new T.ctx.THREE.HemisphereLight(0xffd9a8, 0x17111e, 1.45);
    const key = new T.ctx.THREE.DirectionalLight(0xffc27b, 2.25);
    key.position.set(inst.x + 7, inst.y + 11, inst.z + 8);
    const rim = new T.ctx.THREE.DirectionalLight(0x80b9ff, 1.35);
    rim.position.set(inst.x - 8, inst.y + 6, inst.z - 7);
    studio.add(hemi, key, rim);
    studio.visible = false;
    T.ctx.scene.add(studio);
    window.__SF_PRECENTOR_REVIEW_STUDIO = studio;
    T.renderStill();
    return {
      anchor: { x: inst.x, y: inst.y, z: inst.z },
      eventId: inst.eventId,
      instances: instances.length,
      status: H.status("choir"),
      url: inst.spec.url,
      specPairs: inst.spec.legs,
      legs: inst.legs.map((leg) => ({ pair: leg.i, side: leg.side })),
      rootScale: inst.root.scale.x,
      meshes,
      skinnedMeshes,
      primitives,
      triangles: Math.round(triangles),
      bones: inst.skin?.skeleton?.bones?.map((bone) => bone.name).sort() || [],
      clips,
      clipAudit,
      materials: materials.map((material) => ({
        name: material.name,
        type: material.type,
        map: !!material.map,
        normalMap: !!material.normalMap,
        roughnessMap: !!material.roughnessMap,
        metalnessMap: !!material.metalnessMap,
        sharedMetallicRoughness: !!material.roughnessMap
          && material.roughnessMap === material.metalnessMap,
        emissiveMap: !!material.emissiveMap,
        emissiveIntensity: material.emissiveIntensity || 0,
      })),
      textures,
      bounds: wholeBounds,
      regionVertices: Object.fromEntries(Object.entries(regions)
        .map(([name, points]) => [name, points.length])),
      hitboxFit: {
        current: currentHitbox,
        suggested: suggestedHitbox,
        liveHead: { side: Number(liveHead.side.toFixed(3)),
          up: Number(liveHead.up.toFixed(3)), forward: Number(liveHead.forward.toFixed(3)) },
        currentHeadOffset: Number(headFitOffset.toFixed(3)),
      },
    };
  });

  if (model.error) throw new Error(model.error);

  async function capture(spec) {
    const dataUrl = await page.evaluate((shot) => {
      const T = window.__SF;
      const inst = T.enemies.live.find((enemy) =>
        enemy.eventId === "district-boss:choir");
      inst.encounterHidden = false;
      inst.encounterLocked = false;
      inst.root.visible = true;
      const studio = window.__SF_PRECENTOR_REVIEW_STUDIO;
      const isolated = !!shot.studio;
      T.ctx.world.group.visible = !isolated;
      T.ctx.terrain.group.visible = !isolated;
      if (studio) studio.visible = isolated;
      if (isolated) {
        /* The hidden production terrain remains the IK authority. Flatten the
           already-planted contacts onto the temporary review floor so a
           sloped Choir height field does not masquerade as detached feet in
           an otherwise flat studio frame. */
        for (const leg of inst.legs) {
          leg.plant.y = inst.y;
          leg.target.y = inst.y;
          leg.foot.y = inst.y;
          leg.stepping = 0;
        }
      }
      T.ctx.enemies.play(inst, shot.clip, 0);
      const action = inst.actions.get(shot.clip);
      if (action) {
        action.time = action.getClip().duration * shot.fraction;
        action.paused = true;
        inst.mixer.update(0);
      }
      T.ctx.player.setFree(true, shot.position, shot.target, shot.fov);
      T.renderStill();
      return T.captureDataURL();
    }, spec);
    return dataBuffer(dataUrl);
  }

  const size = model.bounds.size;
  const center = model.bounds.center;
  const horizontal = Math.max(size.x, size.z);
  const radius = Math.max(9.5, horizontal * 1.55, size.y * 2.20);
  const aim = [center.x, center.y, center.z];
  const bearings = [];
  for (let degrees = 0; degrees < 360; degrees += 60) {
    const angle = degrees * Math.PI / 180;
    const buffer = await capture({
      clip: "idle",
      fraction: 0.34,
      studio: true,
      position: [center.x + Math.sin(angle) * radius,
        center.y + radius * 0.20, center.z + Math.cos(angle) * radius],
      target: aim,
      fov: 43,
    });
    const filename = `precentor-angle-${String(degrees).padStart(3, "0")}.png`;
    await writeFile(path.join(outDir, filename), buffer);
    bearings.push({ buffer, label: `${degrees} degrees` });
  }
  await contactSheet(bearings, 3, 480, 300, "precentor-turntable.png");

  /* Native Choir context: HUD and trooper restore the gameplay read that a
     clean turntable intentionally removes. */
  const contextBuffer = await page.evaluate(({ center: target, radius: framing }) => {
    const T = window.__SF;
    const inst = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    T.hideHud(false);
    T.hidePlayer(false);
    T.hideVfx(false);
    T.ctx.world.group.visible = true;
    T.ctx.terrain.group.visible = true;
    if (window.__SF_PRECENTOR_REVIEW_STUDIO) {
      window.__SF_PRECENTOR_REVIEW_STUDIO.visible = false;
    }
    T.ctx.enemies.play(inst, "alert", 0);
    const action = inst.actions.get("alert");
    if (action) { action.time = action.getClip().duration * 0.28; inst.mixer.update(0); }
    T.safeOrbit(target.x, target.z, target.y, Math.PI * 0.20,
      framing * 1.05, 0.28, 48);
    T.renderStill();
    return T.captureDataURL();
  }, { center, radius });
  await writeFile(path.join(outDir, "precentor-choir-context.png"), dataBuffer(contextBuffer));

  /* Scale lineup: the actual boss, a real ordinary Thresher, and the 1.85m
     player in one frame. Root scale is audited separately from visible
     geometry so an incorrectly normalised GLB cannot pass on 1.55/0.62. */
  const scale = await page.evaluate(({ center: target, spread, framing }) => {
    const T = window.__SF;
    const boss = T.enemies.live.find((enemy) => enemy.eventId === "district-boss:choir");
    const thresher = T.ctx.enemies.spawn("thresher", boss.x + spread, boss.z, {
      yaw: boss.yaw,
      eventId: "qa-precentor-scale-thresher",
    });
    thresher.encounterHidden = false;
    thresher.encounterLocked = true;
    thresher.root.visible = true;
    thresher.y = boss.y;
    thresher.root.position.y = boss.y;
    for (const subject of [boss, thresher]) {
      for (const leg of subject.legs) {
        leg.plant.y = boss.y;
        leg.target.y = boss.y;
        leg.foot.y = boss.y;
        leg.stepping = 0;
      }
    }
    T.ctx.enemies.play(thresher, "idle", 0);
    const ta = thresher.actions.get("idle");
    if (ta) { ta.time = ta.getClip().duration * 0.34; thresher.mixer.update(0); }
    T.ctx.player.spawn(boss.x - spread, boss.z, boss.yaw);
    T.ctx.player.state.y = boss.y;
    T.ctx.player.state.grounded = true;
    T.hidePlayer(false);
    T.hideHud(true);
    T.hideVfx(true);
    T.ctx.world.group.visible = false;
    T.ctx.terrain.group.visible = false;
    if (window.__SF_PRECENTOR_REVIEW_STUDIO) {
      window.__SF_PRECENTOR_REVIEW_STUDIO.visible = true;
    }
    const posedHeight = (inst) => {
      const mesh = inst.skin;
      if (!mesh) return 0;
      inst.root.updateMatrixWorld(true);
      let lo = Infinity;
      let hi = -Infinity;
      const point = new T.ctx.THREE.Vector3();
      for (let i = 0; i < mesh.geometry.attributes.position.count; i += 1) {
        mesh.getVertexPosition(i, point);
        point.applyMatrix4(mesh.matrixWorld);
        lo = Math.min(lo, point.y); hi = Math.max(hi, point.y);
      }
      return hi - lo;
    };
    const measured = {
      bossHeight: posedHeight(boss),
      thresherHeight: posedHeight(thresher),
      playerHeight: 1.85,
      rootScaleRatio: boss.root.scale.x / thresher.root.scale.x,
    };
    measured.heightRatio = measured.bossHeight / Math.max(0.001, measured.thresherHeight);
    T.ctx.player.setFree(true,
      [target.x + framing * 0.62, target.y + framing * 0.20,
        target.z + framing * 0.78],
      [target.x, target.y, target.z], 46);
    T.renderStill();
    return { measured, image: T.captureDataURL(), thresherId: thresher.id };
  }, { center, spread: Math.max(4.2, size.x * 0.68), radius, framing: radius });
  await writeFile(path.join(outDir, "precentor-scale-family.png"), dataBuffer(scale.image));
  await page.evaluate((thresherId) => {
    const T = window.__SF;
    const thresher = T.enemies.live.find((enemy) => enemy.id === thresherId);
    if (thresher) T.ctx.enemies.remove(thresher);
    T.hidePlayer(true);
    T.hideHud(true);
    T.hideVfx(true);
  }, scale.thresherId);

  await page.evaluate(() => window.__SF.setTime("night"));
  const nightBuffer = await capture({
    clip: "alert",
    fraction: 0.28,
    studio: true,
    position: [center.x + radius * 0.28, center.y + radius * 0.18,
      center.z + radius],
    target: aim,
    fov: 46,
  });
  await writeFile(path.join(outDir, "precentor-night-choir.png"), nightBuffer);
  await page.evaluate(() => window.__SF.setTime("goldenhour"));

  const actionSpecs = [
    ["idle", 0.34], ["alert", 0.30], ["strike", 0.56],
    ["flinch", 0.46], ["death", 0.78],
  ];
  const actions = [];
  for (const [clip, fraction] of actionSpecs) {
    const buffer = await capture({
      clip,
      fraction,
      studio: true,
      position: [center.x + radius * 0.70, center.y + radius * 0.18,
        center.z + radius * 0.78],
      target: aim,
      fov: 46,
    });
    await writeFile(path.join(outDir, `precentor-${clip}.png`), buffer);
    actions.push({ buffer, label: clip });
  }
  await contactSheet(actions, 3, 480, 300, "precentor-actions.png");

  const material = model.materials[0] || {};
  const textureDimensions = model.textures.every((texture) =>
    texture.width > 0 && texture.height > 0
      && texture.width <= 1024 && texture.height <= 1024);
  const nonDeathLegTracks = Object.entries(model.clipAudit)
    .filter(([name]) => name !== "death")
    .reduce((sum, [, clip]) => sum + clip.walkingLegTracks, 0);
  const allRegions = Object.values(model.regionVertices).every((count) => count > 0);
  const checks = {
    actualChoirDomainBoss: model.instances === 1 && model.eventId === "district-boss:choir"
      && model.status?.phase === "active",
    dedicatedPrecentorAsset: model.url === "assets/models/saintfall/precentor.glb"
      && assetRequests.some((entry) => entry.status === 200
        && /\/assets\/models\/saintfall\/precentor\.glb(?:\?|$)/.test(entry.url)),
    oneSkinnedMeshPrimitive: model.meshes === 1 && model.skinnedMeshes === 1
      && model.primitives === 1,
    triangleBudget: model.triangles >= 38000 && model.triangles <= 50000,
    exactThirtyBoneRig: JSON.stringify(model.bones) === JSON.stringify(expectedBones),
    twoWalkingPairs: model.specPairs === 2 && model.legs.length === 4
      && new Set(model.legs.map((leg) => leg.pair)).size === 2,
    exactAuthoredClips: JSON.stringify(model.clips) === JSON.stringify(expectedClips)
      && Object.values(model.clipAudit).every((clip) => clip.duration > 0 && clip.tracks > 0),
    proceduralLegOwnership: nonDeathLegTracks === 0,
    oneAuthoredPbrMaterial: model.materials.length === 1 && material.map
      && material.normalMap && material.roughnessMap && material.metalnessMap
      && material.sharedMetallicRoughness && material.emissiveMap,
    fourTextureAtlas: model.textures.length <= 4 && model.textures.length >= 4
      && textureDimensions && model.textures.every((texture) => texture.anisotropy >= 2),
    completeWeightedAnatomy: allRegions,
    finiteGeometry: Object.values(model.bounds.size).every((value) =>
      Number.isFinite(value) && value > 0),
    bossScaleRead: scale.measured.rootScaleRatio >= 2.45
      && scale.measured.bossHeight > scale.measured.playerHeight
      && scale.measured.bossHeight > scale.measured.thresherHeight * 1.6,
    headBoneFitReported: Number.isFinite(model.hitboxFit.liveHead.up)
      && Number.isFinite(model.hitboxFit.suggested.headR)
      && model.hitboxFit.suggested.headR > 0,
    completeVisualReview: bearings.length === 6 && actions.length === expectedClips.length,
    cleanRuntime: pageErrors.length === 0 && assetFailures.length === 0
      && consoleWarnings.length === 0
      && consoleErrors.filter((message) =>
        !/jsdelivr|unpkg|favicon|Failed to load resource/i.test(message)).length === 0,
  };

  const report = {
    model,
    scale: scale.measured,
    checks,
    diagnostics: { pageErrors, consoleErrors, consoleWarnings, assetFailures, assetRequests },
    captures: {
      bearings: bearings.length,
      actions: actionSpecs.map(([clip]) => clip),
      goldenHour: true,
      night: true,
      choirContext: true,
      scaleFamily: true,
    },
  };
  await writeFile(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const [name, passed] of Object.entries(checks)) {
    console.log(`${passed ? "PASS" : "FAIL"}  ${name}`);
  }
  console.log(`Hitbox suggestion: ${JSON.stringify(model.hitboxFit.suggested)}`);
  console.log(`Report: ${path.join(outDir, "report.json")}`);
  await browser.close();
  if (Object.values(checks).some((passed) => !passed)) process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
}
