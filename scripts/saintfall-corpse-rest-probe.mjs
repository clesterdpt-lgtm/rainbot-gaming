#!/usr/bin/env node
/* ============================================================
   SAINTFALL - where a death clip leaves the body, per species

   The fast twin of the corpse check inside
   `scripts/saintfall-death-shots.mjs`. That harness boots the whole
   game to find out whether a corpse rests on the sand, which is two
   minutes a try and far too slow to author a death pose against. This
   loads nothing but three and the .glb, poses the death clip at its
   final frame, and reports the same profile the runtime will measure.

   WHY IT MEASURES THE .glb AND NOT THE BLENDER SCENE. The exporter
   splits a vertex per face corner wherever normals or colours differ,
   and on a faceted low-poly body that is most of them - the matriarch
   ships 19877 vertices from a mesh Blender holds as 5962. Every number
   here is a PERCENTILE over that vertex set, so measuring Blender's
   shared vertices answers a different question: it reported a 0.134m
   rest gap for a body the runtime measured at 0.233m.

   WHAT THE NUMBERS MEAN. The runtime seats a corpse by moving its root
   until the mesh's 4th percentile sits DEATH_BED_IN below the sand -
   see `measureDeathRest` in enemies.js. That shift is rigid, so it
   cannot change the profile's shape, only where it sits:

     restGap   p05 - p04. The death-shots check seats p04 at -0.09m
               and then demands p05 <= 0.12m, so this has to come in
               at or under 0.21m. A wide gap means the lowest geometry
               is a spike - seating it levers the rest of the animal
               up off the sand.
     lowMass   p25 - p04. A corpse can pass the gap while standing on
               eight buried legs; this is the number that says the
               body came down with them.

   Usage:  node scripts/saintfall-corpse-rest-probe.mjs [species...]
   ============================================================ */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const SPECIES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["thresher", "gleaner", "harrow", "matriarch"];

/* The runtime's own constants, from assets/js/saintfall/enemies.js.
   Duplicated rather than imported because that module only loads
   inside a booted game, which is the cost this probe exists to
   avoid - so they are asserted against the shipped harness instead:
   REST_PERCENTILE is DEATH_REST_PERCENTILE, BED_IN is DEATH_BED_IN,
   and GAP_LIMIT is the death-shots threshold plus BED_IN. */
const REST_PERCENTILE = 0.04;
const BED_IN = 0.09;
const GAP_LIMIT = 0.12 + BED_IN;

/* The same three the game runs - see THREE_VERSION in boot.js. A probe
   posing the clip on a different version is measuring a different
   skinning implementation than the one that will ship. */
const CDN = "https://cdn.jsdelivr.net/npm/three@0.180.0/";

const PORT = 49871;
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

let failed = 0;
try {
  for (let i = 0; i < 150; i += 1) {
    try { const r = await fetch(`${BASE}/`); if (r.ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({ channel: "chromium", headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (e) => { console.log("  page error:", e.message.slice(0, 200)); });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  /* GLTFLoader imports the bare specifier "three", so the page needs
     the same import map boot.js installs. It has to be in the document
     before the first module import - map resolution is a single pass
     and a map added afterwards is ignored. */
  await page.evaluate((cdn) => {
    const el = document.createElement("script");
    el.type = "importmap";
    el.textContent = JSON.stringify({
      imports: { three: `${cdn}build/three.module.js`, "three/addons/": `${cdn}examples/jsm/` },
    });
    document.head.appendChild(el);
  }, CDN);

  const results = await page.evaluate(async ({ species, restPercentile }) => {
    const THREE = await import("three");
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    /* Species ship at different scales and the runtime multiplies the
       settle by `inst.root.scale.x` while DEATH_BED_IN stays in world
       metres - so a probe that assumed 1 mispredicted the Thresher
       (0.62) by 29mm while matching every species that ships at 1:1.
       Read out of the bestiary rather than copied, so a rescale cannot
       leave this probe quietly wrong. */
    const source = await (await fetch("/assets/js/saintfall/enemies.js")).text();
    const scaleOf = (key) => {
      const block = source.slice(source.indexOf(`\n  ${key}: {`));
      const found = block.slice(0, block.indexOf("\n  },")).match(/\n\s*scale:\s*([\d.]+)/);
      if (!found) throw new Error(`no scale for "${key}" in enemies.js`);
      return parseFloat(found[1]);
    };
    const out = {};
    for (const key of species) {
      let gltf;
      try {
        gltf = await loader.loadAsync(`/assets/models/saintfall/${key}.glb`);
      } catch (error) { out[key] = { error: String(error) }; continue; }
      const clip = gltf.animations.find((a) => a.name === "death");
      if (!clip) { out[key] = { error: "no death clip" }; continue; }

      const scale = scaleOf(key);
      const root = gltf.scene;
      root.position.set(0, 0, 0);
      root.rotation.set(0, 0, 0);
      root.scale.setScalar(scale);
      let mesh = null;
      root.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
      if (!mesh) { out[key] = { error: "no skinned mesh" }; continue; }

      const mixer = new THREE.AnimationMixer(root);
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      // The last frame the player will ever see, minus an epsilon -
      // exactly `duration` can wrap on a looping binding. Same
      // sampling point `measureDeathRest` uses.
      mixer.setTime(Math.max(0, clip.duration - 1e-3));
      root.updateMatrixWorld(true);

      const v = new THREE.Vector3();
      const n = mesh.geometry.attributes.position.count;
      const ys = new Float64Array(n);
      for (let i = 0; i < n; i += 1) {
        mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
        ys[i] = v.y;
      }
      ys.sort();
      const at = (p) => ys[Math.min(n - 1, Math.max(0, Math.floor(n * p)))];
      const seat = at(restPercentile);
      out[key] = {
        vertices: n,
        scale,
        seconds: +clip.duration.toFixed(2),
        settle: +(-seat).toFixed(3),
        restGap: +(at(0.05) - seat).toFixed(3),
        lowMass: +(at(0.25) - seat).toFixed(3),
        medianAbove: +(at(0.5) - seat).toFixed(3),
      };
    }
    return out;
  }, { species: SPECIES, restPercentile: REST_PERCENTILE });

  console.log("\n=== WHERE THE DEATH CLIP LEAVES THE BODY ===");
  console.log(`  (restGap must be <= ${GAP_LIMIT.toFixed(2)}m; `
    + "lowMass is how much of the animal came down with it)\n");
  for (const [key, r] of Object.entries(results)) {
    if (r.error) { console.log(`  ${key.padEnd(10)} ERROR ${r.error}`); failed += 1; continue; }
    const ok = r.restGap <= GAP_LIMIT;
    if (!ok) failed += 1;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${key.padEnd(10)}`
      + ` restGap ${String(r.restGap).padStart(6)}m`
      + `  lowMass ${String(r.lowMass).padStart(6)}m`
      + `  median ${String(r.medianAbove).padStart(6)}m`
      + `  settle ${String(r.settle).padStart(7)}m`
      + `  over ${r.seconds}s`);
    console.log(`        the runtime will seat p05 at `
      + `${(r.restGap - BED_IN).toFixed(3)}m above the sand`);
  }
  console.log(failed ? `\n${failed} FAILED` : "\ncorpses come to rest");
  await browser.close();
  process.exitCode = failed ? 1 : 0;
} finally {
  server.kill("SIGTERM");
}
