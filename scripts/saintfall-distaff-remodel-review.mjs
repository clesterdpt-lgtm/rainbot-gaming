#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Distaff remodel visual review

   Uses the durable, domain-owned boss instance rather than the generic
   bestiary slot. Captures a six-bearing in-world turnaround plus the authored
   combat poses that matter to the remodel.

   Usage:
     node scripts/saintfall-distaff-remodel-review.mjs [--out output/path]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--")
  .filter(Boolean).map((part) => part.trim().split(/\s+/))
  .map(([key, value]) => [key, value ?? true]));
const out = path.resolve(root, args.out || "output/saintfall/distaff-remodel-review");
const port = 52600 + (process.pid % 5000);
const base = `http://127.0.0.1:${port}`;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

async function contactSheet(entries, columns, width, height, filename) {
  const rows = Math.ceil(entries.length / columns);
  const tiles = await Promise.all(entries.map(async ({ buffer, label }, index) => ({
    input: await sharp(buffer).resize(width, height, { fit: "cover" }).composite([{
      input: Buffer.from(`<svg width="${width}" height="30" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="30" fill="#080d12" fill-opacity="0.88"/>
        <text x="10" y="20" fill="#78f1ef" font-family="monospace" font-size="14">${label}</text>
      </svg>`), left: 0, top: 0,
    }]).png().toBuffer(),
    left: (index % columns) * width,
    top: Math.floor(index / columns) * height,
  })));
  await sharp({
    create: { width: columns * width, height: rows * height,
      channels: 3, background: "#080d12" },
  }).composite(tiles).png().toFile(path.join(out, filename));
}

try {
  await mkdir(out, { recursive: true });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const assetFailures = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/jsdelivr|unpkg|favicon/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.url().startsWith(base) && response.status() >= 400) {
      assetFailures.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high&time=goldenhour`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  const model = await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    document.getElementById("sf-boot")?.remove();
    T.invulnerable(true);
    T.hideHud(true);
    T.hidePlayer(true);
    T.hideVfx(true);
    const inst = T.ctx.distaff.instance();
    /* Free-camera position is not player position. Keep the authoritative
       player body inside the Scar arena or the shared boundary controller
       correctly resets and re-hides the boss between review frames. */
    T._teleportRaw(inst.x - 20, inst.z, 0);
    T.forceDistaffPhase("alert", 999);
    for (const enemy of T.enemies.live) {
      if (enemy !== inst && enemy.root) enemy.root.visible = false;
    }
    inst.root.visible = true;
    T.ctx.enemies.play(inst, "idle", 0);
    inst.current.time = 1.1;
    inst.mixer.update(0);
    T.renderStill();

    let meshes = 0;
    let triangles = 0;
    const materials = [];
    inst.root.traverse((child) => {
      if (!child.isMesh) return;
      meshes += 1;
      const geometry = child.geometry;
      triangles += (geometry.index?.count || geometry.attributes.position.count) / 3;
      for (const material of (Array.isArray(child.material) ? child.material : [child.material])) {
        if (!material || materials.includes(material)) continue;
        materials.push(material);
      }
    });
    return {
      anchor: { x: inst.x, y: inst.y, z: inst.z },
      meshes,
      triangles,
      legs: inst.legs.length,
      bones: inst.bones.size,
      clips: [...inst.actions.keys()].sort(),
      material: {
        count: materials.length,
        authoredPbr: materials.some((m) => m.map && m.normalMap
          && m.roughnessMap && m.emissiveMap),
        clearcoat: Math.max(...materials.map((m) => Number(m.clearcoat) || 0)),
        emissiveIntensity: Math.max(...materials.map((m) => Number(m.emissiveIntensity) || 0)),
        anisotropy: Math.max(...materials.flatMap((m) => [m.map, m.normalMap,
          m.roughnessMap, m.emissiveMap].filter(Boolean).map((t) => t.anisotropy || 1))),
      },
    };
  });

  async function capture(setup) {
    const dataUrl = await page.evaluate((spec) => {
      const T = window.__SF;
      const inst = T.ctx.distaff.instance();
      const ground = T.ctx.collide.groundHeight(inst.x, inst.z);
      inst.bodyDrop = spec.drop || 0;
      inst.y = ground - inst.bodyDrop;
      inst.root.position.set(inst.x, inst.y, inst.z);
      T.ctx.enemies.play(inst, spec.clip, 0);
      const action = inst.actions.get(spec.clip);
      if (action) {
        action.time = action.getClip().duration * spec.fraction;
        inst.mixer.update(0);
      }
      T.ctx.player.setFree(true, spec.position, spec.target, spec.fov);
      T.renderStill();
      return T.captureDataURL();
    }, setup);
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  }

  const bearings = [];
  for (let degrees = 0; degrees < 360; degrees += 60) {
    const angle = degrees * Math.PI / 180;
    const radius = 38;
    const buffer = await capture({
      clip: "idle", fraction: 0.34, drop: 0,
      position: [model.anchor.x + Math.sin(angle) * radius,
        model.anchor.y + 8.8, model.anchor.z + Math.cos(angle) * radius],
      target: [model.anchor.x, model.anchor.y + 7.1, model.anchor.z], fov: 50,
    });
    await writeFile(path.join(out, `distaff-angle-${String(degrees).padStart(3, "0")}.png`), buffer);
    bearings.push({ buffer, label: `${degrees} degrees` });
  }
  await contactSheet(bearings, 3, 480, 300, "distaff-turntable.png");

  const night = await page.evaluate(() => { window.__SF.setTime("night"); return true; });
  const nightBuffer = await capture({
    clip: "alert", fraction: 0.28, drop: 0,
    position: [model.anchor.x + 8, model.anchor.y + 8.5, model.anchor.z + 37],
    target: [model.anchor.x, model.anchor.y + 7, model.anchor.z], fov: 50,
  });
  await writeFile(path.join(out, "distaff-night-glass.png"), nightBuffer);
  await page.evaluate(() => { window.__SF.setTime("goldenhour"); });

  const actionSpecs = [
    ["alert", 0.28, 0], ["walk", 0.24, 0], ["lunge", 0.64, 0],
    ["slam", 0.46, 0], ["webCast", 0.42, 0], ["collapse", 0.82, 6.1],
    ["recover", 0.56, 3.2], ["death", 0.76, 4.2],
  ];
  const actions = [];
  for (const [clip, fraction, drop] of actionSpecs) {
    const buffer = await capture({
      clip, fraction, drop,
      position: [model.anchor.x + 25, model.anchor.y + 10.5, model.anchor.z + 29],
      target: [model.anchor.x, model.anchor.y + 6.7 - drop * 0.35, model.anchor.z], fov: 48,
    });
    await writeFile(path.join(out, `distaff-${clip}.png`), buffer);
    actions.push({ buffer, label: clip });
  }
  await contactSheet(actions, 4, 400, 250, "distaff-actions.png");

  const expectedClips = ["alert", "bite", "collapse", "death", "flinch", "idle",
    "lunge", "recover", "slam", "walk", "webCast"];
  const checks = {
    actualDomainBoss: model.legs === 8 && model.bones === 42,
    singleMesh: model.meshes === 1,
    triangleBudget: model.triangles >= 35000 && model.triangles <= 50000,
    allClips: JSON.stringify(model.clips) === JSON.stringify(expectedClips),
    authoredPbr: model.material.authoredPbr,
    clearcoat: model.material.clearcoat > 0,
    emissive: model.material.emissiveIntensity >= 1,
    anisotropy: model.material.anisotropy >= 2,
    captures: bearings.length === 6 && actions.length === 8 && night,
    noErrors: errors.length === 0 && assetFailures.length === 0,
  };
  const report = { model, checks, errors, assetFailures,
    captures: { bearings: 6, actions: actionSpecs.map(([clip]) => clip), night: true } };
  await writeFile(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const [name, passed] of Object.entries(checks)) {
    console.log(`${passed ? "PASS" : "FAIL"}  ${name}`);
  }
  console.log(`Report: ${path.join(out, "report.json")}`);
  await browser.close();
  if (Object.values(checks).some((passed) => !passed)) process.exitCode = 1;
} finally {
  server.kill();
}
