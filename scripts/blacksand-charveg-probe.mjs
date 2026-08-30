#!/usr/bin/env node
/* ============================================================
   BLACKSAND - characters + vegetation probe

   The beauty harness frames landscape and the char probe frames a
   soldier on flat ground in flat light. Neither of those can answer
   the three questions this module is being judged on:

     1. does a soldier CAST a shadow, and does he RECEIVE one when he
        stands in a shadow band?
     2. do his boots touch the surface he is standing on - terrain AND
        a rooftop?
     3. does a backlit frond glow, and do palms actually vary?

   So this probe stages for those specifically: a raking low sun so a
   cast shadow is a third of the frame, a soldier straddling the edge
   of a building's shadow, a camera aimed through a palm crown at the
   sun, and a numeric dump of the scale/height spread of every species.

   Usage:
     node scripts/blacksand-charveg-probe.mjs --out output/blacksand-shots/char-1

   Same two traps as every other harness here: frames are forced with
   __BS.renderOnce() rather than waited for, and pixels come from
   __BS.captureDataURL() rather than page.screenshot().
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else { args[key] = next; i += 1; }
    } else args._.push(token);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const OUT_DIR = path.resolve(root, args.out || "output/blacksand-shots/charveg");
const WIDTH = Number(args.width || 1400);
const HEIGHT = Number(args.height || 850);
const QUALITY = String(args.quality || "ultra");
const BOTS = Number(args.bots || 24);
const PORT = Number(args.port || 45000 + (process.pid % 8000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const GAME_URL = `${BASE_URL}/games/blacksand.html?qa=1&quality=${QUALITY}&bots=${BOTS}`;
const ONLY = args.only ? String(args.only).split(",") : null;
/** Stage every frame with the key light put back where the sky's sun
 *  is. See __CV.correctSun - render.js currently loses it. */
const FIX_SUN = Boolean(args.fixsun);

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const res = await fetch(`${BASE_URL}/games/blacksand.html`, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error(`static server never came up on ${BASE_URL}`);
}

async function grab(page, file) {
  const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
  await writeFile(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
}

/* ---------------------------------------------------------------- *
 * Page-side staging helpers.
 * ---------------------------------------------------------------- */
const STAGE_FN = `
window.__CV = (function () {
  const T = window.__BS;
  const ctx = T.ctx;
  const THREE = T.THREE;

  function flatSpot(cx, cz, span) {
    let best = null;
    for (let i = 0; i < 1200; i += 1) {
      const x = cx + (-span + (i % 35) * (span * 2 / 34));
      const z = cz + (-span + Math.floor(i / 35) * (span * 2 / 34));
      if (!ctx.terrain.inBounds(x, z)) continue;
      const h = ctx.terrain.heightAt(x, z);
      let rough = 0;
      for (const d of [[6,0],[-6,0],[0,6],[0,-6]]) {
        rough += Math.abs(ctx.terrain.heightAt(x + d[0], z + d[1]) - h);
      }
      const clear = ctx.physics.overlapSphere
        ? ctx.physics.overlapSphere(new THREE.Vector3(x, h + 1, z), 12).length : 0;
      const score = -rough - clear * 5;
      if (!best || score > best.score) best = { x: x, z: z, h: h, score: score };
    }
    return best;
  }

  const flat = flatSpot(0, 0, 380);

  let held = [];

  /** Park every bot far away, then place the ones the scene wants. */
  function pin(spec) {
    held = spec;
    const bots = ctx.bots.bots;
    for (let i = 0; i < bots.length; i += 1) {
      const s = spec[i];
      const bot = bots[i];
      if (!s) {
        bot.root.visible = false;
        bot.position.set(9000, 0, 9000);
        continue;
      }
      bot.alive = true;
      bot.health = 100;
      bot.root.visible = true;
    }
  }

  /** Extra frames with the staging re-applied. The bots' own AI would
   *  otherwise walk them out of shot between the settle and the grab. */
  function hold(frames) { settle(held, frames); }

  function settle(spec, frames) {
    const bots = ctx.bots.bots;
    const dt = 1 / 60;
    for (let f = 0; f < frames; f += 1) {
      for (let i = 0; i < spec.length && i < bots.length; i += 1) {
        const bot = bots[i];
        const s = spec[i];
        bot.position.set(s.x, s.y === undefined ? ctx.terrain.heightAt(s.x, s.z) : s.y, s.z);
        bot.velocity.set(0, 0, 0);
        bot.yaw = s.yaw || 0;
        bot.aimYaw = s.aimYaw === undefined ? (s.yaw || 0) : s.aimYaw;
        bot.aimPitch = s.aimPitch || 0;
        bot.stance = s.stance || "stand";
        bot.speed = s.speed === undefined ? 0 : s.speed;
        bot.firing = s.firing || 0;
        if (s.phase !== undefined) bot.animPhase = s.phase;
      }
      T.renderOnce(dt);
    }
  }

  /** Where is the sun, in world direction? sky.js owns it; read it off
   *  the actual directional light so this cannot drift. */
  function sunDir() {
    let dir = null;
    ctx.render.scene.traverse(function (o) {
      if (o.isDirectionalLight && !dir) {
        dir = new THREE.Vector3().copy(o.position).sub(o.target.position).normalize();
      }
    });
    return dir || new THREE.Vector3(0, 1, 0);
  }

  /** The densest palm stand that is not inside a compound. A single
   *  palm proves nothing about spacing or height variety. */
  function palmSpot(index) {
    const list = ctx.foliage.samplePositions("palm", 120)
      .concat(ctx.foliage.samplePositions("palmYoung", 60));
    if (!list.length) return null;
    const scored = list.map(function (p) {
      let near = 0;
      for (const q of list) {
        if (Math.hypot(q[0] - p[0], q[2] - p[2]) < 22) near += 1;
      }
      const clear = ctx.physics.overlapSphere
        ? ctx.physics.overlapSphere(new THREE.Vector3(p[0], p[1] + 2, p[2]), 26).length : 0;
      return { p: p, score: near - clear * 3 };
    }).sort(function (a, b) { return b.score - a.score; });
    return scored[Math.min(index || 0, scored.length - 1)].p;
  }

  function diagnostics() {
    const out = { soldiers: [], foliage: {}, shadow: {} };
    const r = ctx.render.renderer;
    out.shadow.enabled = r.shadowMap.enabled;
    out.shadow.type = r.shadowMap.type;
    ctx.render.scene.traverse(function (o) {
      if (o.isDirectionalLight) {
        out.shadow.light = {
          castShadow: o.castShadow,
          intensity: o.intensity,
          mapSize: o.shadow ? [o.shadow.mapSize.x, o.shadow.mapSize.y] : null,
          cam: o.shadow ? {
            left: o.shadow.camera.left, right: o.shadow.camera.right,
            top: o.shadow.camera.top, bottom: o.shadow.camera.bottom,
            near: o.shadow.camera.near, far: o.shadow.camera.far,
          } : null,
          pos: [o.position.x.toFixed(1), o.position.y.toFixed(1), o.position.z.toFixed(1)],
          target: [o.target.position.x.toFixed(1), o.target.position.y.toFixed(1), o.target.position.z.toFixed(1)],
        };
      }
    });

    const g = ctx.characters.group;
    for (let i = 0; i < Math.min(2, g.children.length); i += 1) {
      const rootObj = g.children[i];
      const mesh = rootObj.children.filter(function (c) { return c.isSkinnedMesh; })[0];
      if (!mesh) continue;
      out.soldiers.push({
        castShadow: mesh.castShadow,
        receiveShadow: mesh.receiveShadow,
        frustumCulled: mesh.frustumCulled,
        visible: mesh.visible && rootObj.visible,
        material: mesh.material.type,
        matName: mesh.material.name,
        roughness: mesh.material.roughness,
        metalness: mesh.material.metalness,
        vertexColors: mesh.material.vertexColors,
        envMapIntensity: mesh.material.envMapIntensity,
        hasCustomDepth: Boolean(mesh.customDepthMaterial),
        boundingSphere: mesh.geometry.boundingSphere
          ? mesh.geometry.boundingSphere.radius : null,
        rootY: Number(rootObj.position.y.toFixed(3)),
        rootScale: Number(rootObj.scale.y.toFixed(3)),
      });
    }
    out.charReport = ctx.characters.report ? ctx.characters.report() : null;
    out.foliage = ctx.foliage.report();

    // Scale spread per species: the "one scale" complaint is testable.
    out.foliage.scaleSpread = {};
    ctx.foliage.group.traverse(function (o) {
      if (!o.isInstancedMesh || o.count === 0) return;
      const m = new THREE.Matrix4();
      const v = new THREE.Vector3();
      let min = 1e9; let max = -1e9; let sum = 0; let n = 0;
      for (let i = 0; i < o.count; i += 1) {
        o.getMatrixAt(i, m);
        v.set(m.elements[4], m.elements[5], m.elements[6]);
        const s = v.length();
        min = Math.min(min, s); max = Math.max(max, s); sum += s; n += 1;
      }
      out.foliage.scaleSpread[o.name] = {
        count: n,
        min: Number(min.toFixed(3)),
        max: Number(max.toFixed(3)),
        mean: Number((sum / n).toFixed(3)),
        ratio: Number((max / Math.max(min, 1e-6)).toFixed(2)),
        castShadow: o.castShadow,
      };
    });

    out.drawCalls = ctx.render.renderer.info.render.calls;
    out.triangles = ctx.render.renderer.info.render.triangles;
    return out;
  }

  /** Exact world-space height of the lowest soldier vertex vs the
   *  ground beneath him. The "floating boot" complaint, measured. */
  function footGap(botIndex) {
    const bot = ctx.bots.bots[botIndex];
    if (!bot || !bot.character) return null;
    const mesh = bot.character.mesh;
    mesh.updateMatrixWorld(true);
    if (!mesh.skeleton) return null;
    // Skin the position buffer on the CPU for the handful of vertices
    // near the bottom of the mesh. three has no API for this and the
    // GPU result is not readable, so it is done by hand.
    const pos = mesh.geometry.attributes.position;
    const si = mesh.geometry.attributes.skinIndex;
    const sw = mesh.geometry.attributes.skinWeight;
    const bones = mesh.skeleton.bones;
    const bindInv = mesh.skeleton.boneInverses;
    const v = new THREE.Vector3();
    const t = new THREE.Vector3();
    const m = new THREE.Matrix4();
    let lowest = 1e9;
    let lowX = 0; let lowZ = 0;
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i);
      const bi = si.getX(i);
      const bw = sw.getX(i);
      if (bw <= 0) continue;
      // bindMode is Attached, so bindMatrixInverse is inverse(matrixWorld)
      // and cancels the modelMatrix the shader applies afterwards. The
      // world position is therefore just boneMatrix * bindMatrix * v.
      m.multiplyMatrices(bones[bi].matrixWorld, bindInv[bi]);
      m.multiply(mesh.bindMatrix);
      t.copy(v).applyMatrix4(m);
      if (t.y < lowest) { lowest = t.y; lowX = t.x; lowZ = t.z; }
    }
    const ground = ctx.terrain.heightAt(lowX, lowZ);
    return {
      lowestVertexY: Number(lowest.toFixed(4)),
      groundY: Number(ground.toFixed(4)),
      gap: Number((lowest - ground).toFixed(4)),
      rootY: Number(bot.root.position.y.toFixed(4)),
    };
  }

  /** A/B control: a plain lambert-ish box that is known to cast. If the
   *  box casts and the soldier does not, the fault is in characters.js;
   *  if neither casts, it is the shadow rig. */
  let probeBox = null;
  function control(x, y, z) {
    if (!probeBox) {
      probeBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 1.8, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x9a8a68, roughness: 0.9 })
      );
      probeBox.castShadow = true;
      probeBox.receiveShadow = true;
      probeBox.name = "qa-control-box";
      ctx.render.scene.add(probeBox);
    }
    probeBox.visible = true;
    probeBox.position.set(x, y + 0.9, z);
    probeBox.updateMatrixWorld(true);
  }
  function controlOff() { if (probeBox) probeBox.visible = false; }

  /**
   * Put the key light back where the sky says the sun is.
   *
   * render.js's updateShadowCamera derives the light direction from
   * sun.position - which it has itself already moved to
   * (shadowFocus + dir * distance). sky.js only repairs it while the
   * weather is still easing, so within a second of load the shading sun
   * has converged on normalize(cameraPosition), tens of degrees away
   * from the sun in the sky and grazing the ground at about 10
   * degrees. That single fault is most of "characters are unlit
   * cut-outs": the key is nearly edge-on to every vertical surface, so
   * ambient does all the work and nothing has a shadow side.
   *
   * This does not fix render.js - it stages a corrected frame so the
   * fault can be shown side by side, and so this module's own work can
   * be judged under the light it is supposed to have.
   */
  function correctSun() {
    let sun = null;
    ctx.render.scene.traverse(function (o) { if (o.isDirectionalLight && !sun) sun = o; });
    if (!sun || !ctx.sky) return null;
    const d = ctx.sky.sunDirection;
    const before = sun.position.clone().sub(sun.target.position).normalize();
    // Set the position the way sky.js does - a pure multiple of the sun
    // direction with the target still at the origin - because
    // updateShadowCamera re-derives the direction from
    // normalize(sun.position) at the top of the very next render. Put
    // the light at focus + dir and that normalize returns garbage
    // again.
    sun.target.position.set(0, 0, 0);
    sun.position.copy(d).multiplyScalar(400);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    sun.shadow.needsUpdate = true;
    return {
      skyDir: [d.x.toFixed(3), d.y.toFixed(3), d.z.toFixed(3)],
      lightDirWas: [before.x.toFixed(3), before.y.toFixed(3), before.z.toFixed(3)],
      elevationSkyDeg: Number((Math.asin(d.y) * 180 / Math.PI).toFixed(2)),
      elevationLightWasDeg: Number((Math.asin(before.y) * 180 / Math.PI).toFixed(2)),
    };
  }

  /** Is the soldier inside the sun's shadow frustum at all? */
  function shadowCheck(botIndex) {
    const bot = ctx.bots.bots[botIndex || 0];
    if (!bot || !bot.character) return null;
    const mesh = bot.character.mesh;
    mesh.updateMatrixWorld(true);
    let sun = null;
    ctx.render.scene.traverse(function (o) { if (o.isDirectionalLight && !sun) sun = o; });
    if (!sun) return null;
    sun.shadow.updateMatrices(sun);
    const m = new THREE.Matrix4().multiplyMatrices(
      sun.shadow.camera.projectionMatrix, sun.shadow.camera.matrixWorldInverse);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(m);
    const sphere = mesh.geometry.boundingSphere.clone().applyMatrix4(mesh.matrixWorld);
    return {
      inShadowFrustum: frustum.intersectsSphere(sphere),
      sphere: [sphere.center.x.toFixed(1), sphere.center.y.toFixed(1),
        sphere.center.z.toFixed(1), sphere.radius.toFixed(2)],
      castShadow: mesh.castShadow,
      receiveShadow: mesh.receiveShadow,
      matShadowSide: mesh.material.shadowSide,
      matSide: mesh.material.side,
      boxInFrustum: probeBox ? frustum.intersectsObject(probeBox) : null,
    };
  }

  return {
    flat: flat, pin: pin, settle: settle, hold: hold, sunDir: sunDir,
    palmSpot: palmSpot, diagnostics: diagnostics, footGap: footGap,
    control: control, controlOff: controlOff, shadowCheck: shadowCheck,
    correctSun: correctSun,
    look: function (p, t, fov) { T.lookAt(p, t, fov); },
  };
})();
`;

/* Scenes. Each returns nothing; it stages and points the camera. */
const SCENES = [
  {
    id: "ab-control",
    note: "Soldier beside a plain box that is known to cast. If only the box has a shadow, the fault is here.",
    build: `
      T.setTimeOfDay(15.0);
      const o = S.flat;
      const spec = [{ x: o.x, z: o.z, yaw: Math.PI, stance: "stand", speed: 0 }];
      S.pin(spec); S.settle(spec, 40);
      const h = ctx.terrain.heightAt(o.x, o.z);
      S.control(o.x + 1.6, ctx.terrain.heightAt(o.x + 1.6, o.z), o.z);
      const sd = S.sunDir();
      const side = new THREE.Vector3(-sd.z, 0, sd.x).normalize();
      S.look([o.x + side.x * 6 - sd.x * 4.5 + 0.8, h + 2.4, o.z + side.z * 6 - sd.z * 4.5],
             [o.x + 0.8, h + 0.6, o.z], 50);
    `,
  },
  {
    id: "cast-shadow",
    note: "Raking 16:40 sun, soldier side-on at 5m. A cast shadow should run a third of the frame.",
    build: `
      T.setTimeOfDay(16.6);
      const o = S.flat;
      const spec = [{ x: o.x, z: o.z, yaw: Math.PI * 0.5, stance: "stand", speed: 0 }];
      S.pin(spec); S.settle(spec, 40);
      const h = ctx.terrain.heightAt(o.x, o.z);
      const sd = S.sunDir();
      // Stand square to the sun so the shadow lies across the frame.
      const side = new THREE.Vector3(-sd.z, 0, sd.x).normalize();
      S.look([o.x + side.x * 5.5 + sd.x * 1.5, h + 1.7, o.z + side.z * 5.5 + sd.z * 1.5],
             [o.x - sd.x * 2.0, h + 0.5, o.z - sd.z * 2.0], 46);
    `,
  },
  {
    id: "shadow-band",
    note: "Four soldiers walking out of a wall's shadow into the light. Values must differ.",
    build: `
      T.setTimeOfDay(16.6);
      const o = S.flat;
      const sd = S.sunDir();
      const spec = [];
      for (let i = 0; i < 4; i += 1) {
        spec.push({ x: o.x + sd.x * (i * 2.6 - 3.9) , z: o.z + sd.z * (i * 2.6 - 3.9),
                    yaw: Math.atan2(-sd.x, -sd.z) + Math.PI * 0.5, stance: "stand", speed: 0 });
      }
      S.pin(spec); S.settle(spec, 40);
      const h = ctx.terrain.heightAt(o.x, o.z);
      const side = new THREE.Vector3(-sd.z, 0, sd.x).normalize();
      S.look([o.x + side.x * 13, h + 2.2, o.z + side.z * 13], [o.x, h + 1.0, o.z], 44);
    `,
  },
  {
    id: "boots",
    note: "Boots at 1.4m. Sole-to-sand contact, or a gap.",
    build: `
      T.setTimeOfDay(15.6);
      const o = S.flat;
      const spec = [{ x: o.x, z: o.z, yaw: Math.PI * 0.5, stance: "stand", speed: 0 }];
      S.pin(spec); S.settle(spec, 40);
      const h = ctx.terrain.heightAt(o.x, o.z);
      S.look([o.x + 0.5, h + 0.62, o.z + 1.5], [o.x, h + 0.12, o.z], 40);
    `,
  },
  {
    id: "torso-gradient",
    note: "Chest-up at 2.2m. A value gradient across the torso, or a flat fill.",
    build: `
      T.setTimeOfDay(15.6);
      const o = S.flat;
      const spec = [{ x: o.x, z: o.z, yaw: Math.PI * 0.78, stance: "stand", speed: 0 }];
      S.pin(spec); S.settle(spec, 40);
      const h = ctx.terrain.heightAt(o.x, o.z);
      S.look([o.x + 1.5, h + 1.5, o.z + 1.5], [o.x, h + 1.32, o.z], 38);
    `,
  },
  {
    id: "palm-backlit",
    note: "Sun behind a palm crown. Fronds must glow, canopy interior must go dark.",
    build: `
      T.setTimeOfDay(17.1);
      S.pin([]);
      const p = S.palmSpot(3);
      const sd = S.sunDir();
      // Camera on the far side of the tree from the sun, eye level with
      // the crown, so the fronds are between the lens and the light.
      S.look([p[0] - sd.x * 11, p[1] + 6.0, p[2] - sd.z * 11], [p[0], p[1] + 6.5, p[2]], 45);
    `,
  },
  {
    id: "palm-grove",
    note: "A stand of palms at 40m. Height, lean and spacing variety.",
    build: `
      T.setTimeOfDay(16.2);
      S.pin([]);
      const p = S.palmSpot(0);
      const sd = S.sunDir();
      const side = new THREE.Vector3(-sd.z, 0, sd.x).normalize();
      // Slightly above the crowns and 40m out, so the whole stand is in
      // frame and the shadows it throws are on the near side.
      const cx = p[0] + side.x * 30 - sd.x * 24;
      const cz = p[2] + side.z * 30 - sd.z * 24;
      S.look([cx, ctx.terrain.heightAt(cx, cz) + 9.5, cz], [p[0], p[1] + 4.0, p[2]], 52);
    `,
  },
  {
    id: "veg-shadow",
    note: "Sun over the camera's shoulder onto a palm stand. The shadows must be there and must have the plant's shape.",
    build: `
      T.setTimeOfDay(9.4);
      S.pin([]);
      const p = S.palmSpot(0);
      const sd = S.sunDir();
      // Cross-light: the camera is 90 degrees off the sun, so every
      // shadow lies ACROSS the frame instead of hiding behind the plant
      // that cast it. A shot down the sun vector proves nothing.
      const side = new THREE.Vector3(-sd.z, 0, sd.x).normalize();
      const cx = p[0] + side.x * 30;
      const cz = p[2] + side.z * 30;
      S.look([cx, ctx.terrain.heightAt(cx, cz) + 7.5, cz], [p[0], p[1] + 2.5, p[2]], 55);
    `,
  },
  {
    id: "bush-backlit",
    note: "Low sun raking through scrub at 6m. Canopy translucency and contact.",
    build: `
      T.setTimeOfDay(17.3);
      S.pin([]);
      const o = S.flat;
      const sd = S.sunDir();
      const h = ctx.terrain.heightAt(o.x, o.z);
      S.look([o.x - sd.x * 9, h + 1.15, o.z - sd.z * 9], [o.x + sd.x * 4, h + 0.6, o.z + sd.z * 4], 48);
    `,
  },
  {
    id: "squad-mid",
    note: "Six soldiers at 22m in raking light. The real gameplay read.",
    build: `
      T.setTimeOfDay(16.8);
      const o = S.flat;
      const sd = S.sunDir();
      const side = new THREE.Vector3(-sd.z, 0, sd.x).normalize();
      const spec = [];
      for (let i = 0; i < 6; i += 1) {
        spec.push({
          x: o.x + side.x * (i - 2.5) * 2.4 + (i % 2) * 1.2,
          z: o.z + side.z * (i - 2.5) * 2.4 + (i % 2) * 1.2,
          yaw: Math.atan2(-side.x, -side.z), stance: i === 2 ? "crouch" : "stand",
          speed: i === 4 ? 4.2 : 0, phase: i * 1.1,
        });
      }
      S.pin(spec); S.settle(spec, 40);
      const h = ctx.terrain.heightAt(o.x, o.z);
      S.look([o.x + side.x * 3 - sd.x * 20, h + 1.75, o.z + side.z * 3 - sd.z * 20],
             [o.x, h + 1.1, o.z], 48);
    `,
  },
];

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const server = startServer();
  let browser = null;
  const consoleErrors = [];
  const pageErrors = [];

  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium",
      headless: !args.headed,
      args: [
        "--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--force-device-scale-factor=1",
        "--hide-scrollbars", "--mute-audio",
      ],
    });
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__BS && window.__BS.isReady(), null, { timeout: 240000 });

    await page.evaluate(() => window.__BS.maximize());
    await page.evaluate(() => { for (let i = 0; i < 20; i += 1) window.__BS.renderOnce(1 / 60); });
    await page.evaluate(() => window.__BS.hideHud(true));
    await page.evaluate(() => window.__BS.hideViewmodel(true));
    await page.evaluate(() => {
      const el = document.getElementById("bs-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    await page.evaluate(() => window.__BS.advanceTime(2, 1 / 60));
    await page.evaluate(STAGE_FN);

    const diag = await page.evaluate(() => window.__CV.diagnostics());
    console.log("--- diagnostics ---");
    console.log(JSON.stringify(diag, null, 2));

    const sunDrift = await page.evaluate(() => window.__CV.correctSun());
    console.log("--- key light vs sky sun ---");
    console.log(JSON.stringify(sunDrift));
    diag.sunDrift = sunDrift;

    const results = [];
    for (const scene of SCENES) {
      if (ONLY && !ONLY.includes(scene.id)) continue;
      await page.evaluate(new Function("body", `
        const T = window.__BS; const ctx = T.ctx; const THREE = T.THREE;
        const S = window.__CV;
        ${scene.build}
      `), null);
      await page.evaluate(() => window.__CV.hold(12));
      if (FIX_SUN) {
        // The correction has to be the LAST thing before the grab: any
        // module update re-runs render.js's shadow-camera step, which
        // is what breaks the direction in the first place.
        await page.evaluate(() => {
          window.__CV.correctSun();
          window.__BS.ctx.render.render(1 / 60);
        });
      }
      await grab(page, path.join(OUT_DIR, `${scene.id}.png`));
      const clearance = await page.evaluate(() => window.__BS.cameraClearance(80));
      const shadow = await page.evaluate(() => window.__CV.shadowCheck(0));
      if (scene.id === "ab-control") await page.evaluate(() => window.__CV.controlOff());
      results.push({ id: scene.id, note: scene.note, clearance, shadow });
      console.log(`  ${scene.id}  clearance=${JSON.stringify(clearance)} shadow=${JSON.stringify(shadow)}`);
    }

    /* ---------------------------------------------------------------- *
     * Shadow bisection.
     *
     * The A/B control showed a plain box casting nothing either, which
     * rules out characters.js as the cause and makes this a question
     * about the shadow rig - owned by another agent. This sweep names
     * the exact knob so the report can be specific rather than a guess.
     * ---------------------------------------------------------------- */
    if (args.shadowsweep) {
      const variants = [
        { id: "s0-asis", apply: "" },
        { id: "s1-sunfixed", apply: "S.correctSun();" },
        { id: "s2-sunfixed-tight40", apply: "S.correctSun(); sun.shadow.camera.left=-40;sun.shadow.camera.right=40;sun.shadow.camera.top=40;sun.shadow.camera.bottom=-40;sun.shadow.camera.updateProjectionMatrix();" },
        { id: "s3-sunfixed-radius0", apply: "S.correctSun(); sun.shadow.radius = 0.6;" },
        { id: "s4-sunfixed-tight40-radius0", apply: "S.correctSun(); sun.shadow.radius = 0.6; sun.shadow.camera.left=-40;sun.shadow.camera.right=40;sun.shadow.camera.top=40;sun.shadow.camera.bottom=-40;sun.shadow.camera.updateProjectionMatrix();" },
        { id: "s5-sunfixed-bias0", apply: "S.correctSun(); sun.shadow.bias = 0; sun.shadow.normalBias = 0.02;" },
        { id: "s6-no-ambient", apply: "S.correctSun(); ctx.render.scene.environmentIntensity = 0; ctx.render.hemi.intensity = 0;" },
      ];
      await mkdir(path.join(OUT_DIR, "sweep"), { recursive: true });
      for (const v of variants) {
        await page.evaluate(new Function(`
          const T = window.__BS; const ctx = T.ctx; const THREE = T.THREE; const S = window.__CV;
          let sun = null;
          ctx.render.scene.traverse(function (o) { if (o.isDirectionalLight && !sun) sun = o; });
          window.__SUNBAK = window.__SUNBAK || {
            bias: sun.shadow.bias, normalBias: sun.shadow.normalBias,
            l: sun.shadow.camera.left, r: sun.shadow.camera.right,
            t: sun.shadow.camera.top, b: sun.shadow.camera.bottom,
            type: ctx.render.renderer.shadowMap.type,
            radius: sun.shadow.radius,
            intensity: sun.intensity, hemi: ctx.render.hemi.intensity,
            env: ctx.render.scene.environmentIntensity,
          };
          const bak = window.__SUNBAK;
          sun.shadow.bias = bak.bias; sun.shadow.normalBias = bak.normalBias;
          sun.shadow.camera.left = bak.l; sun.shadow.camera.right = bak.r;
          sun.shadow.camera.top = bak.t; sun.shadow.camera.bottom = bak.b;
          sun.shadow.camera.updateProjectionMatrix();
          sun.shadow.radius = bak.radius;
          ctx.render.renderer.shadowMap.type = bak.type;
          ctx.render.renderer.shadowMap.enabled = true;
          sun.intensity = bak.intensity;
          ctx.render.hemi.intensity = bak.hemi;
          ctx.render.scene.environmentIntensity = bak.env;
          T.setTimeOfDay(15.0);
          const o = S.flat;
          const spec = [{ x: o.x, z: o.z, yaw: Math.PI, stance: "stand", speed: 0 }];
          S.pin(spec); S.settle(spec, 20);
          const h = ctx.terrain.heightAt(o.x, o.z);
          S.control(o.x + 1.6, ctx.terrain.heightAt(o.x + 1.6, o.z), o.z);
          const sd = S.sunDir();
          const side = new THREE.Vector3(-sd.z, 0, sd.x).normalize();
          S.look([o.x + side.x * 6 - sd.x * 4.5 + 0.8, h + 2.4, o.z + side.z * 6 - sd.z * 4.5],
                 [o.x + 0.8, h + 0.6, o.z], 50);
          S.hold(6);
          // The override goes on AFTER the last module update: sky.js
          // rewrites sun intensity and environmentIntensity every frame,
          // so anything set before a renderOnce is simply overwritten.
          ${v.apply}
          ctx.render.render(1 / 60);
        `));
        await grab(page, path.join(OUT_DIR, "sweep", `${v.id}.png`));
        console.log(`  sweep ${v.id}`);
      }
      await page.evaluate(() => window.__CV.controlOff());
    }

    /* Foot gap on a staged soldier: numeric, not visual. */
    const feet = await page.evaluate(() => {
      const S = window.__CV;
      const ctx = window.__BS.ctx;
      const o = S.flat;
      const spec = [
        { x: o.x, z: o.z, yaw: 0, stance: "stand", speed: 0 },
        { x: o.x + 2, z: o.z, yaw: 0, stance: "crouch", speed: 0 },
        { x: o.x + 4, z: o.z, yaw: 0, stance: "stand", speed: 5.0, phase: 0.5 },
      ];
      S.pin(spec); S.settle(spec, 50);
      return [S.footGap(0), S.footGap(1), S.footGap(2)];
    });
    console.log("--- foot gap (m; 0 = sole on the sand) ---");
    console.log(JSON.stringify(feet, null, 2));

    /* Same measurement on a rooftop. The foot IK samples the TERRAIN,
     * which on a roof is metres below - so a soldier up there stretched
     * his legs down through the floor and dropped his pelvis by the
     * full IK clamp. */
    const roof = await page.evaluate(() => {
      const S = window.__CV;
      const ctx = window.__BS.ctx;
      const THREE = window.__BS.THREE;
      // Find a flat static surface at least 2.5m above the terrain.
      let spot = null;
      for (let i = 0; i < 4000 && !spot; i += 1) {
        const x = -450 + (i % 63) * 14.5;
        const z = -450 + Math.floor(i / 63) * 14.5;
        if (!ctx.terrain.inBounds(x, z)) continue;
        const t = ctx.terrain.heightAt(x, z);
        const g = ctx.physics.groundHeightAt(x, z);
        if (g - t > 2.5 && g - t < 14) {
          // Needs room to stand and a neighbourhood at the same height.
          const ok = [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]].every(
            (d) => Math.abs(ctx.physics.groundHeightAt(x + d[0], z + d[1]) - g) < 0.12
          );
          if (ok && ctx.physics.capsuleFree(new THREE.Vector3(x, g + 0.95, z), 0.34, 1.8)) {
            spot = { x, z, ground: g, terrain: t };
          }
        }
      }
      if (!spot) return { found: false };
      const spec = [{ x: spot.x, z: spot.z, y: spot.ground, yaw: 0, stance: "stand", speed: 0 }];
      S.pin(spec); S.settle(spec, 45);
      const gap = S.footGap(0);
      return {
        found: true,
        surfaceY: Number(spot.ground.toFixed(3)),
        terrainY: Number(spot.terrain.toFixed(3)),
        aboveTerrain: Number((spot.ground - spot.terrain).toFixed(2)),
        ...gap,
      };
    });
    console.log("--- foot gap on a structure ---");
    console.log(JSON.stringify(roof, null, 2));

    /* What the extra shadow casters actually cost. renderer.info counts
     * the shadow pass as well as the main one, so the two frames differ
     * by exactly the geometry submitted to the shadow map. */
    const shadowCost = await page.evaluate(() => {
      const ctx = window.__BS.ctx;
      const info = ctx.render.renderer.info;
      const measure = () => {
        ctx.render.render(1 / 60);
        return { calls: info.render.calls, triangles: info.render.triangles };
      };
      const on = measure();
      const wasCasting = [];
      ctx.foliage.group.traverse((o) => {
        if (o.isInstancedMesh && o.castShadow) { wasCasting.push(o); o.castShadow = false; }
      });
      const off = measure();
      for (const o of wasCasting) o.castShadow = true;
      const chars = [];
      ctx.characters.group.traverse((o) => {
        if (o.isSkinnedMesh && o.castShadow) { chars.push(o); o.castShadow = false; }
      });
      const noChars = measure();
      for (const o of chars) o.castShadow = true;
      return {
        withEverything: on,
        foliageShadowOff: off,
        foliageShadowCost: { calls: on.calls - off.calls, triangles: on.triangles - off.triangles },
        soldierShadowCost: { calls: off.calls - noChars.calls, triangles: off.triangles - noChars.triangles },
        foliageCastingMeshes: wasCasting.length,
      };
    });
    console.log("--- shadow-pass cost ---");
    console.log(JSON.stringify(shadowCost, null, 2));

    const report = await page.evaluate(() => window.__BS.report());
    await writeFile(path.join(OUT_DIR, "report.json"), JSON.stringify({
      diagnostics: diag, scenes: results, feet, roof, report, consoleErrors, pageErrors,
    }, null, 2));
    if (consoleErrors.length) console.log("console errors:", consoleErrors.slice(0, 8));
    if (pageErrors.length) console.log("page errors:", pageErrors.slice(0, 8));
    console.log(`\nartifacts: ${path.relative(root, OUT_DIR)}`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
