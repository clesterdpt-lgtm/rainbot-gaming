#!/usr/bin/env node
/* Focused Censer Works perimeter proof.

   This is deliberately geometry-aware as well as visual.  A composed
   screenshot can hide a straight wall behind a tower, so the probe also
   measures the shipped wall/catwalk/pipe vertices and walks the four gates
   through the same collision grid the player uses. */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((value) => value.trim().split(/\s+/)).map(([key, value]) => [key, value ?? true])
);
const outDir = path.resolve(root, args.out || "output/saintfall/censer-perimeter");
const port = 57200 + (process.pid % 700);
const base = `http://127.0.0.1:${port}`;

const checks = [];
function check(name, pass, detail = null) {
  checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` · ${detail}` : ""}`);
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

let browser;
try {
  await mkdir(outDir, { recursive: true });
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });

  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high&intro=skip&seed=censer-perimeter`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    T.hideHud(true);
    T.hidePlayer(true);
    T.setStorm(0);
    T.setTime("goldenhour");
    document.getElementById("sf-boot")?.remove();
  });

  const result = await page.evaluate(() => {
    const T = window.__SF;
    const d = T.ctx.districts.censer;
    const layout = T.ctx.world.censerLayout;
    const centre = [d.x, d.z];
    const radialStats = (name) => {
      const mesh = T.ctx.world.group.getObjectByName(name);
      if (!mesh?.isMesh) return null;
      mesh.updateWorldMatrix(true, false);
      const p = mesh.geometry.attributes.position;
      const v = new T.ctx.THREE.Vector3();
      let radialMin = Infinity;
      let radialMax = -Infinity;
      let yMin = Infinity;
      let yMax = -Infinity;
      for (let i = 0; i < p.count; i += 1) {
        v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
        const radial = Math.hypot(v.x - d.x, v.z - d.z);
        radialMin = Math.min(radialMin, radial);
        radialMax = Math.max(radialMax, radial);
        yMin = Math.min(yMin, v.y);
        yMax = Math.max(yMax, v.y);
      }
      return {
        name,
        vertices: p.count,
        radialMin: Number(radialMin.toFixed(2)),
        radialMax: Number(radialMax.toFixed(2)),
        yMin: Number(yMin.toFixed(2)),
        yMax: Number(yMax.toFixed(2)),
      };
    };

    const wall = radialStats("censer-perimeter-wall-stone");
    const pipes = radialStats("censer-pipes-rust");
    const catwalk = radialStats("censer-perimeter-catwalk-rust");
    const gateRoutes = layout.gateBearings.map((bearing) => {
      const points = [];
      const blockedSamples = [];
      let steepest = 0;
      let previous = null;
      for (let i = 0; i <= 70; i += 1) {
        const radius = layout.wallRadius + 52 - (80 * i / 70);
        const x = d.x + Math.cos(bearing) * radius;
        const z = d.z + Math.sin(bearing) * radius;
        const y = T.ctx.terrain.heightAt(x, z);
        if (previous) steepest = Math.max(steepest,
          Math.abs(y - previous.y) / Math.hypot(x - previous.x, z - previous.z));
        previous = { x, y, z };
        points.push([x, z]);
        const ground = T.ctx.collide.groundHeight(x, z);
        if (T.ctx.collide.blocked(x, z, ground)) {
          blockedSamples.push({ radius: Number(radius.toFixed(2)),
            x: Number(x.toFixed(2)), z: Number(z.toFixed(2)),
            bottom: Number(T.ctx.collide.solidBottom(x, z).toFixed(2)),
            top: Number(T.ctx.collide.solidTop(x, z).toFixed(2)),
            ground: Number(ground.toFixed(2)) });
        }
      }
      const first = points[0];
      const last = points[points.length - 1];
      return {
        bearing,
        clear: T.ctx.collide.walkClear(first[0], first[1], last[0], last[1]),
        steepest: Number(steepest.toFixed(3)),
        blockedSamples,
      };
    });
    const wallCrossings = layout.gateBearings.map((bearing) => {
      const angle = bearing + Math.PI * 0.25;
      const outer = [d.x + Math.cos(angle) * (layout.wallRadius + 18),
        d.z + Math.sin(angle) * (layout.wallRadius + 18)];
      const inner = [d.x + Math.cos(angle) * (layout.wallRadius - 18),
        d.z + Math.sin(angle) * (layout.wallRadius - 18)];
      return {
        bearing: angle,
        blocked: !T.ctx.collide.walkClear(outer[0], outer[1], inner[0], inner[1]),
      };
    });
    const innerHeights = [];
    for (let i = 0; i < 24; i += 1) {
      const a = i / 24 * Math.PI * 2;
      innerHeights.push(T.ctx.terrain.heightAt(
        d.x + Math.cos(a) * 92,
        d.z + Math.sin(a) * 92
      ));
    }
    const geometry = T.auditMeshes().filter((row) => row.name.startsWith("censer-"));
    const report = T.report();
    return {
      centre,
      layout,
      wall,
      pipes,
      catwalk,
      gateRoutes,
      wallCrossings,
      innerHeightSpread: Number((Math.max(...innerHeights) - Math.min(...innerHeights)).toFixed(4)),
      geometry,
      renderer: report.render,
    };
  });

  check("named perimeter wall mesh exists", !!result.wall,
    result.wall ? `${result.wall.vertices} vertices` : null);
  check("wall occupies only the yard perimeter",
    result.wall?.radialMin >= result.layout.wallRadius - 6
      && result.wall?.radialMax <= result.layout.wallRadius + 8,
    result.wall ? `${result.wall.radialMin}-${result.wall.radialMax}m from centre` : null);
  check("old centre-cut wall is absent", result.wall?.radialMin > 165,
    result.wall ? `nearest wall vertex ${result.wall.radialMin}m` : null);
  check("all four gate routes are collision-clear",
    result.gateRoutes.length === 4 && result.gateRoutes.every((route) => route.clear),
    JSON.stringify(result.gateRoutes));
  check("all four gate aprons are walkable grades",
    result.gateRoutes.every((route) => route.steepest <= 0.30),
    `steepest ${Math.max(...result.gateRoutes.map((route) => route.steepest)).toFixed(3)}`);
  check("wall arcs block crossings between gates",
    result.wallCrossings.length === 4 && result.wallCrossings.every((route) => route.blocked),
    JSON.stringify(result.wallCrossings));
  check("interior yard is one level surface", result.innerHeightSpread <= 0.08,
    `92m ring spread ${result.innerHeightSpread}m`);
  check("pipe network remains inside the perimeter",
    !!result.pipes && result.pipes.radialMax < result.layout.wallRadius - 20,
    result.pipes ? `outer pipe vertex ${result.pipes.radialMax}m` : null);
  check("catwalks follow the inner wall face",
    !!result.catwalk
      && result.catwalk.radialMin >= result.layout.catwalkRadius - 3
      && result.catwalk.radialMax <= result.layout.catwalkRadius + 3,
    result.catwalk ? `${result.catwalk.radialMin}-${result.catwalk.radialMax}m` : null);
  check("Censer meshes have finite, non-degenerate geometry",
    result.geometry.length >= 6 && result.geometry.every((row) =>
      row.degenerate === 0 && row.nonFinite === 0 && row.badNormals === 0),
    `${result.geometry.length} meshes`);
  check("browser has no page or console errors", errors.length === 0,
    errors.length ? errors.join(" | ") : "0 errors");

  const shots = [
    {
      id: "elevated-west",
      position: [result.centre[0] - 238, result.layout.upperY + 48, result.centre[1] - 92],
      target: [result.centre[0], result.layout.upperY + 12, result.centre[1]],
      fov: 55,
    },
    {
      id: "west-gate",
      position: [result.centre[0] - result.layout.wallRadius - 48,
        result.layout.lowerY + 4.2, result.centre[1]],
      target: [result.centre[0] - result.layout.wallRadius + 34,
        result.layout.upperY + 3.2, result.centre[1]],
      fov: 64,
    },
    {
      id: "inside-to-northeast-wall",
      position: [result.centre[0] - 84, result.layout.upperY + 3.0, result.centre[1] - 76],
      target: [result.centre[0] + 128, result.layout.upperY + 5.0, result.centre[1] + 128],
      fov: 58,
    },
    {
      id: "plan",
      position: [result.centre[0], result.layout.upperY + 305, result.centre[1] + 0.1],
      target: [result.centre[0], result.layout.upperY, result.centre[1]],
      fov: 55,
    },
  ];
  for (const shot of shots) {
    const dataUrl = await page.evaluate(({ position, target, fov }) => {
      const T = window.__SF;
      T.lookAt(position, target, fov);
      for (let i = 0; i < 8; i += 1) T.renderOnce(1 / 60);
      return T.captureDataURL();
    }, shot);
    await writeFile(path.join(outDir, `${shot.id}.png`),
      Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(({ centre, layout }) => {
    const T = window.__SF;
    T.lookAt([centre[0] - 230, layout.upperY + 42, centre[1] - 74],
      [centre[0], layout.upperY + 10, centre[1]], 59);
    for (let i = 0; i < 8; i += 1) T.renderOnce(1 / 60);
    return T.captureDataURL();
  }, { centre: result.centre, layout: result.layout });
  await writeFile(path.join(outDir, "mobile-elevated.png"),
    Buffer.from(mobile.slice(mobile.indexOf(",") + 1), "base64"));

  const report = { checks, errors, result, shots: [...shots.map((shot) => `${shot.id}.png`),
    "mobile-elevated.png"] };
  await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`artifacts: ${path.relative(root, outDir)}`);
  if (checks.some((row) => !row.pass)) process.exitCode = 1;
} finally {
  await browser?.close?.();
  server.kill("SIGTERM");
}
