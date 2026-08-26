#!/usr/bin/env node
/* ============================================================
   SAINTFALL - weapon model inspector

   WHY THIS EXISTS. Three attempts at seating the White Vigil pistol
   in the hand were made by INFERRING which model axis was the grip -
   from the centroid, from the bounding box, from the direction of the
   authored grip point. All three produced a number that measured well
   and looked wrong, because the inference was wrong and the metric
   only ever confirmed it.

   A model's geometry is not a thing to deduce. This renders the raw
   GLB in ORTHOGRAPHIC projection down each of its own axes, over a
   labelled grid in model units, with the authored grip and emitter
   marked - the three views a modelling package would give you. The
   grip's coordinates and its axis can then be READ rather than
   guessed.

   Usage:
     node scripts/saintfall-weapon-inspect.mjs --file white-vigil-crescent-emitter.glb
     node scripts/saintfall-weapon-inspect.mjs --file bastion-hammer.glb --grid 0.25
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const file = arg("--file", "white-vigil-crescent-emitter.glb");
const gridStep = Number(arg("--grid", 0.2));
const marks = arg("--mark", "");
const outDir = path.resolve(root, arg("--out", "output/saintfall/weapon-inspect"));
const PORT = 46100 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall-white-vigil.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

const PAGE = (job) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#12151b;overflow:hidden}
  canvas{display:block}
  #tag{position:fixed;left:8px;top:6px;font:13px/1.4 monospace;color:#cfe;z-index:9}
</style>
<script type="importmap">{"imports":{
  "three":"https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js",
  "three/addons/":"https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/"
}}</script></head>
<body><div id="tag"></div>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const JOB = ${JSON.stringify(job)};
const W = 1200, H = 1200;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x12151b);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2a35, 2.1));
const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(0.6, 1.0, 0.8);
scene.add(key);
const fill = new THREE.DirectionalLight(0x9fd0ff, 0.9);
fill.position.set(-0.7, 0.2, -0.6);
scene.add(fill);

const gltf = await new GLTFLoader().loadAsync(JOB.url);
const model = gltf.scene;
model.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(model);
const size = box.getSize(new THREE.Vector3());
const centre = box.getCenter(new THREE.Vector3());
const span = Math.max(size.x, size.y, size.z);

/* ---- grid + axes, in MODEL units ---- */
const helpers = new THREE.Group();
scene.add(helpers);
const extent = Math.ceil(span * 0.62 / JOB.grid) * JOB.grid;
const line = (a, b, colour, width = 1) => {
  const g = new THREE.BufferGeometry().setFromPoints([a, b]);
  helpers.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: colour, linewidth: width })));
};
for (let t = -extent; t <= extent + 1e-6; t += JOB.grid) {
  const faint = Math.abs(t) < 1e-6 ? null : 0x2f3a47;
  if (faint) {
    line(new THREE.Vector3(-extent, t, 0), new THREE.Vector3(extent, t, 0), faint);
    line(new THREE.Vector3(t, -extent, 0), new THREE.Vector3(t, extent, 0), faint);
  }
}
/* Axis lines: X red, Y green, Z blue - and a TICK BALL every grid
   step so a coordinate can be counted off the picture. */
const axisMat = { x: 0xff5566, y: 0x66dd77, z: 0x5599ff };
for (const [axis, colour] of Object.entries(axisMat)) {
  const dir = new THREE.Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
  line(dir.clone().multiplyScalar(-extent), dir.clone().multiplyScalar(extent), colour, 2);
  for (let t = JOB.grid; t <= extent + 1e-6; t += JOB.grid) {
    for (const s of [1, -1]) {
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(span * 0.006, 8, 6),
        new THREE.MeshBasicMaterial({ color: s > 0 ? colour : 0x99a4b0 })
      );
      ball.position.copy(dir).multiplyScalar(t * s);
      helpers.add(ball);
    }
  }
}
/* Authored points, as labelled balls. */
for (const mark of JOB.marks) {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(span * 0.018, 12, 10),
    new THREE.MeshBasicMaterial({ color: mark.colour })
  );
  ball.position.fromArray(mark.at);
  helpers.add(ball);
}
scene.add(model);

const VIEWS = [
  { id: "A-front-negZ", eye: [0, 0, 1], up: [0, 1, 0], note: "camera on +Z looking -Z   right=+X  up=+Y" },
  { id: "B-back-posZ", eye: [0, 0, -1], up: [0, 1, 0], note: "camera on -Z looking +Z   right=-X  up=+Y" },
  { id: "C-side-negX", eye: [1, 0, 0], up: [0, 1, 0], note: "camera on +X looking -X   right=-Z  up=+Y" },
  { id: "D-side-posX", eye: [-1, 0, 0], up: [0, 1, 0], note: "camera on -X looking +X   right=+Z  up=+Y" },
  { id: "E-top-negY", eye: [0, 1, 0], up: [0, 0, -1], note: "camera on +Y looking -Y   right=+X  up=-Z" },
  { id: "F-bottom-posY", eye: [0, -1, 0], up: [0, 0, 1], note: "camera on -Y looking +Y   right=+X  up=+Z" },
  { id: "G-iso", eye: [0.8, 0.6, 0.9], up: [0, 1, 0], note: "iso from +X +Y +Z" },
  { id: "H-iso2", eye: [-0.8, -0.5, 0.9], up: [0, 1, 0], note: "iso from -X -Y +Z" },
];
const half = span * 0.72;
const cam = new THREE.OrthographicCamera(-half, half, half, -half, -span * 8, span * 8);
const shots = [];
for (const v of VIEWS) {
  cam.position.set(v.eye[0], v.eye[1], v.eye[2]).multiplyScalar(span * 3).add(centre.clone().multiplyScalar(0));
  cam.up.set(v.up[0], v.up[1], v.up[2]);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  document.getElementById("tag").textContent = \`\${JOB.name}   \${v.id}   \${v.note}   grid \${JOB.grid}\`;
  renderer.render(scene, cam);
  shots.push({ id: v.id, note: v.note, url: renderer.domElement.toDataURL("image/png") });
}
window.__INSPECT = {
  name: JOB.name,
  box: { min: box.min.toArray(), max: box.max.toArray(), size: size.toArray() },
  centre: centre.toArray(),
  grid: JOB.grid,
  extent,
  shots,
};
</script></body></html>`;

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({ viewport: { width: 1240, height: 1260 } })).newPage();
    page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
    page.on("console", (m) => { if (m.type() === "error") console.error("CONSOLE", m.text()); });

    const markList = marks
      ? marks.split(";").filter(Boolean).map((entry, i) => {
        const [at, colour] = entry.split("@");
        return {
          at: at.split(",").map(Number),
          colour: colour ? parseInt(colour, 16) : [0xffcc33, 0xff44aa, 0x44ffdd][i % 3],
        };
      })
      : [];

    const job = {
      name: file,
      url: `${BASE}/assets/models/saintfall/player-weapons/${file}`,
      grid: gridStep,
      marks: markList,
    };
    /* SERVED, NOT setContent. A page injected with `setContent` has a
       null origin, so its fetch for the GLB is a cross-origin request
       the plain http.server answers without an allow header - the
       loader fails and the harness times out looking at a blank page.
       Written into the repo and navigated to, it is same-origin. */
    const tmpName = `.weapon-inspect-${process.pid}.html`;
    await writeFile(path.join(root, tmpName), PAGE(job));
    try {
      await page.goto(`${BASE}/${tmpName}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => window.__INSPECT, null, { timeout: 120000 });
    } finally {
      await rm(path.join(root, tmpName), { force: true });
    }
    const res = await page.evaluate(() => window.__INSPECT);

    await mkdir(outDir, { recursive: true });
    const base = file.replace(/\.glb$/, "");
    for (const shot of res.shots) {
      await writeFile(
        path.join(outDir, `${base}-${shot.id}.png`),
        Buffer.from(shot.url.slice(shot.url.indexOf(",") + 1), "base64")
      );
    }
    const f = (a) => `[${a.map((n) => n.toFixed(3)).join(", ")}]`;
    console.log(`\n${res.name}`);
    console.log(`  bounds  min ${f(res.box.min)}  max ${f(res.box.max)}`);
    console.log(`  size    ${f(res.box.size)}   centre ${f(res.centre)}`);
    console.log(`  grid    ${res.grid} model units, ticks to +/-${res.extent}`);
    console.log(`  views   ${res.shots.map((s) => s.id).join(", ")}`);
    console.log(`  wrote   ${path.relative(root, outDir)}/${base}-*.png`);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
