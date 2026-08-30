#!/usr/bin/env node
/* ============================================================
   SAINTFALL - hybrid polearm + locomotion visual proof

   Captures the actual skinned player in the browser from front,
   profile, rear and three-quarter views, then samples complete
   normal-run and sprint gait cycles at deterministic phase targets.
   The report pairs screenshots with toe, reach and fore/aft metrics
   so a flattering single frame cannot pass a broken gait.
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

// Furthest the posed gauntlet centroid may sit from the grip it is
// holding. See the gate below for why it is not zero.
const PALM_CONTACT_MAX = 0.075;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(root, process.argv[2] || "output/saintfall/weapon-gait-proof");
const port = 50500 + (process.pid % 3000);
const base = `http://127.0.0.1:${port}`;

function serverStart() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try {
      const response = await fetch(`${base}/games/saintfall.html`);
      if (response.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("Saintfall proof server did not start");
}

async function grab(page, file) {
  const url = await page.evaluate(() => window.__SF.captureDataURL());
  const buffer = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  if (file) await writeFile(file, buffer);
  return buffer;
}

function labelSvg(width, label) {
  const safe = String(label).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  return Buffer.from(`<svg width="${width}" height="34" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="34" fill="#100d12" fill-opacity="0.84"/>
    <text x="12" y="23" fill="#f4d487" font-family="monospace" font-size="15">${safe}</text>
  </svg>`);
}

async function panel(buffer, label, width = 300, height = 390) {
  return sharp(buffer)
    .resize(width, height, { fit: "cover", position: "center" })
    .composite([{ input: labelSvg(width, label), left: 0, top: 0 }])
    .png().toBuffer();
}

async function markReticle(buffer) {
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 1440;
  const height = meta.height || 900;
  const cx = width / 2;
  const cy = height / 2;
  const svg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <g fill="none" stroke="#fff3c4" stroke-width="2" opacity="0.95">
      <circle cx="${cx}" cy="${cy}" r="10"/>
      <path d="M ${cx - 24} ${cy} H ${cx - 10} M ${cx + 10} ${cy} H ${cx + 24}
               M ${cx} ${cy - 24} V ${cy - 10} M ${cx} ${cy + 10} V ${cy + 24}"/>
    </g>
    <circle cx="${cx}" cy="${cy}" r="2" fill="#ffb33d"/>
  </svg>`);
  return sharp(buffer).composite([{ input: svg, left: 0, top: 0 }]).png().toBuffer();
}

async function cropReticleProof(buffer) {
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 1440;
  const height = meta.height || 900;
  const size = Math.min(width, height, 760);
  return sharp(buffer).extract({
    left: Math.round((width - size) / 2),
    top: Math.round((height - size) / 2),
    width: size,
    height: size,
  }).png().toBuffer();
}

async function sheet(items, file, columns = items.length, panelW = 300, panelH = 390) {
  const rows = Math.ceil(items.length / columns);
  const prepared = await Promise.all(items.map((item) => panel(item.buffer, item.label, panelW, panelH)));
  await sharp({
    create: {
      width: columns * panelW,
      height: rows * panelH,
      channels: 3,
      background: { r: 12, g: 10, b: 15 },
    },
  }).composite(prepared.map((input, index) => ({
    input,
    left: (index % columns) * panelW,
    top: Math.floor(index / columns) * panelH,
  }))).png().toFile(file);
}

async function main() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const server = serverStart();
  const errors = [];
  let browser;

  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium",
      headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--hide-scrollbars", "--mute-audio"],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    })).newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });

    await page.goto(`${base}/games/saintfall.html?qa=1&quality=high&proof=weapon-gait`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction(() => window.__SF?.isReady(), null, { timeout: 300000 });
    const site = await page.evaluate(() => {
      const T = window.__SF;
      T.maximize();
      T.hideHud(true);
      T.studio(true);
      /* This whole harness grades the CARRY pose, and it stands the
         trooper still for minutes doing it - which is the exact
         condition that sheathes the lance. Left on, every
         hand-on-grip metric measured the distance to a weapon slung
         on the back: 0.862m where the gate is 0.075m. */
      T.autoStow(false);
      T.setTime("golden");
      T.equipWeapon("autogun");
      return T.findFlatSite(9);
    });

    /* ---------------- one weapon, four proof angles ---------------- */
    const angles = [
      { id: "front", bearing: Math.PI / 2 },
      { id: "right-profile", bearing: 0 },
      { id: "rear", bearing: -Math.PI / 2 },
      { id: "left-profile", bearing: Math.PI },
      { id: "three-quarter", bearing: Math.PI / 4 },
    ];
    const carryPanels = [];
    for (const view of angles) {
      await page.evaluate(({ bearing, x, z }) => {
        const T = window.__SF;
        T.weapons.setMode("ranged");
        T.setAds(0);
        T.poseFigure(bearing, {
          x, z, yaw: 0, radius: 4.55, fov: 32, aim: 0.50, eye: 0.61,
        });
        T.player.state.figureOverride = true;
        for (let i = 0; i < 5; i += 1) T.renderStill();
      }, { ...view, x: site[0], z: site[1] });
      const file = path.join(out, `ranged-carry-${view.id}.png`);
      const buffer = await grab(page, file);
      carryPanels.push({ buffer, label: view.id.toUpperCase() });
    }
    await sheet(carryPanels, path.join(out, "ranged-carry-angles.png"), angles.length, 280, 390);

    /* Upper-body proof at a tighter radius. Full-body turntables can
       make a folded elbow look acceptable simply because it occupies
       thirty pixels; this sheet keeps the shoulder-elbow-wrist chain
       readable from both profiles as well as front and rear. */
    const armPanels = [];
    for (const view of angles) {
      await page.evaluate(({ bearing, x, z }) => {
        const T = window.__SF;
        T.weapons.setMode("ranged");
        T.setAds(0);
        T.poseFigure(bearing, {
          x, z, yaw: 0, radius: 3.35, fov: 27, aim: 0.68, eye: 0.68,
        });
        T.player.state.figureOverride = true;
        for (let i = 0; i < 5; i += 1) T.renderStill();
      }, { ...view, x: site[0], z: site[1] });
      const file = path.join(out, `arm-pose-${view.id}.png`);
      const buffer = await grab(page, file);
      armPanels.push({ buffer, label: view.id.toUpperCase() });
    }
    await sheet(armPanels, path.join(out, "arm-pose-angles.png"), angles.length, 280, 390);
    const armPose = await page.evaluate(() => window.__SF.armPoseCheck());

    /* Same object through ranged aim and recoil. */
    const rootIdentity = await page.evaluate(() => ({
      uuid: window.__SF.weapons.current.root.uuid,
      parent: window.__SF.weapons.current.root.parent?.uuid || null,
      meshes: (() => {
        let count = 0;
        window.__SF.weapons.current.root.traverse((node) => { if (node.isMesh) count += 1; });
        return count;
      })(),
    }));
    const rangedPanels = [];
    for (let index = 0; index < 6; index += 1) {
      const aim = Math.min(1, index / 4);
      await page.evaluate(({ aim, fire, x, z }) => {
        const T = window.__SF;
        T.weapons.setMode("ranged");
        T.poseFigure(Math.PI / 4, {
          x, z, yaw: 0, radius: 4.55, fov: 32, aim: 0.50, eye: 0.61,
        });
        T.player.state.figureOverride = true;
        T.setAds(aim);
        for (let i = 0; i < 4; i += 1) T.renderOnce(1 / 120);
        if (fire) T.fireWeapon(1);
        T.renderStill();
      }, { aim, fire: index === 5, x: site[0], z: site[1] });
      const buffer = await grab(page, path.join(out, `ranged-transition-${index}.png`));
      rangedPanels.push({ buffer, label: index === 5 ? "RECOIL" : `AIM ${Math.round(aim * 100)}%` });
    }
    await sheet(rangedPanels, path.join(out, "ranged-transition-strip.png"), 6, 260, 338);

    /* Camera-relative proof, not a studio turntable.  The five marked
       frames show the actual chase-camera reticle while the numeric
       sweep below covers hip/ADS at yaw and pitch extremes. */
    const aimViews = [
      { label: "AIM LEFT 30", yaw: -30, pitch: 0 },
      { label: "AIM CENTRE", yaw: 0, pitch: 0 },
      { label: "AIM RIGHT 30", yaw: 30, pitch: 0 },
      { label: "AIM UP 15", yaw: 0, pitch: -15 },
      { label: "AIM DOWN 15", yaw: 0, pitch: 15 },
    ];
    const aimPanels = [];
    for (const view of aimViews) {
      await page.evaluate(({ view, x, z }) => {
        const T = window.__SF;
        T.releaseCamera();
        T.teleport(x, z, 0);
        Object.assign(T.player.state, {
          yaw: 0,
          camYaw: view.yaw * Math.PI / 180,
          camPitch: view.pitch * Math.PI / 180,
          speed: 0,
          figureOverride: true,
        });
        T.player.input.inject(0, 0);
        T.weapons.setMode("ranged");
        T.setAds(0);
        for (let i = 0; i < 100; i += 1) T.renderOnce(1 / 60);
      }, { view, x: site[0], z: site[1] });
      const raw = await grab(page, path.join(out,
        `reticle-${view.label.toLowerCase().replaceAll(" ", "-")}.png`));
      const marked = await markReticle(raw);
      aimPanels.push({ buffer: await cropReticleProof(marked), label: view.label });
    }
    await sheet(aimPanels, path.join(out, "reticle-aim-multi-angle.png"), 5, 280, 390);

    const aimSweep = await page.evaluate(({ x, z }) => {
      const T = window.__SF;
      const rows = [];
      for (const ads of [0, 1]) {
        for (const yawDeg of [-30, 0, 30]) {
          for (const pitchDeg of [-15, 0, 15]) {
            T.releaseCamera();
            T.teleport(x, z, 0);
            Object.assign(T.player.state, {
              yaw: 0,
              camYaw: yawDeg * Math.PI / 180,
              camPitch: pitchDeg * Math.PI / 180,
              speed: 0,
              figureOverride: true,
            });
            T.player.input.inject(0, 0);
            T.weapons.setMode("ranged");
            T.setAds(ads);
            /* Commit, because the shaft only chases the reticle when
               the player means it. Free look now leaves the lance at
               a low-ready carry down the body's facing, so measuring
               shaft-to-reticle without committing would grade the
               resting pose against a gate about where shots go. */
            T.setFiring(true);
            for (let i = 0; i < 100; i += 1) T.renderOnce(1 / 60);
            rows.push({
              ads,
              yawDeg,
              pitchDeg,
              aim: T.weaponAimCheck(),
              arms: T.armPoseCheck(),
              reach: T.armReachCheck(),
            });
          }
        }
      }
      // Release, or every panel captured after this one photographs a
      // committed trooper and the resting carry is never reviewed.
      T.setFiring(false);
      T.setAds(0);
      for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);
      return rows;
    }, { x: site[0], z: site[1] });

    const modeIdentity = await page.evaluate(() => {
      const T = window.__SF;
      T.weapons.setMode("melee");
      const melee = {
        uuid: T.weapons.current.root.uuid,
        parent: T.weapons.current.root.parent?.uuid || null,
        mode: T.weapons.current.mode,
      };
      T.weapons.setMode("ranged");
      return { melee, rangedAgain: T.weapons.current.root.uuid };
    });

    /* The same physical polearm through wind-up, contact and recovery.
       Each frame records the posed SKIN surface-to-grip distance, not
       merely a bone target, so an open/floating gauntlet cannot pass. */
    const meleePanels = [];
    const melee = [];
    for (const actionName of ["melee1", "melee2", "melee3"]) {
      for (const [phaseName, fraction] of [["WIND-UP", 0.24], ["CONTACT", 0.50], ["RECOVER", 0.76]]) {
        const metric = await page.evaluate(({ actionName, fraction, x, z }) => {
          const T = window.__SF;
          T.weapons.setMode("melee");
          T.poseFigure(Math.PI / 4, {
            x, z, yaw: 0, radius: 4.55, fov: 32, aim: 0.50, eye: 0.61,
          });
          T.player.state.figureOverride = true;
          const spec = T.player.actionSpec(actionName);
          T.player.beginAction(actionName);
          T.player.sampleActionAt(spec.dur * fraction);
          T.renderOnce(1 / 240);
          return {
            actionName,
            fraction,
            reach: T.armReachCheck(),
          };
        }, { actionName, fraction, x: site[0], z: site[1] });
        const buffer = await grab(page, path.join(out,
          `${actionName}-${phaseName.toLowerCase()}.png`));
        melee.push(metric);
        meleePanels.push({ buffer, label: `${actionName.toUpperCase()} ${phaseName}` });
      }
    }
    await sheet(meleePanels, path.join(out, "melee-contact-strip.png"), 3, 300, 390);
    await page.evaluate(() => {
      const T = window.__SF;
      const spec = T.player.actionSpec("melee3");
      T.player.sampleActionAt(spec.dur);
      T.renderOnce(0.1);
      T.weapons.setMode("ranged");
    });

    /* ---------------- deterministic real locomotion ---------------- */
    const phaseTargets = [0.00, 0.125, 0.25, 0.375, 0.50, 0.625, 0.75, 0.875];

    async function motionFrame(kind, targetPhase, bearing, suffix) {
      const metric = await page.evaluate(({ kind, targetPhase, bearing, x, z }) => {
        const T = window.__SF;
        const sprint = kind === "sprint";
        T.weapons.setMode("ranged");
        T.setAds(0);
        T.releaseCamera();
        T.teleport(x, z, 0);
        T.player.state.figureOverride = true;
        T.player.input.inject(0, -1);
        if (sprint) T.player.input.keys.add("ShiftLeft");
        else T.player.input.keys.delete("ShiftLeft");

        const wantedSpeed = sprint ? 8.15 : 4.15;
        let stable = false;
        let best = 1;
        for (let frame = 0; frame < 900; frame += 1) {
          T.renderOnce(1 / 60);
          if (T.player.state.speed >= wantedSpeed && T.player.state.gait >= 2) stable = true;
          if (!stable) continue;
          const phase = ((T.player.state.gait % 1) + 1) % 1;
          const delta = Math.abs(phase - targetPhase);
          const wrapped = Math.min(delta, 1 - delta);
          if (wrapped < best) best = wrapped;
          if (wrapped <= 0.017) break;
        }

        T.player.input.inject(null, null);
        T.player.input.keys.delete("ShiftLeft");
        T.heroCamera({
          bearing, radius: 5.2, height: 1.00, aim: 0.91, fov: 31, pitch: 0.03,
        });
        T.player.state.figureOverride = true;
        T.renderStill();

        const f = T.player.figure;
        f.root.updateMatrixWorld(true);
        const inverse = f.root.matrixWorld.clone().invert();
        const forward = f.root.position.clone().set(0, 0, 1)
          .transformDirection(f.root.matrixWorld);
        const right = f.root.position.clone().set(1, 0, 0)
          .transformDirection(f.root.matrixWorld);
        /* FLATTENED. The lean is an angle from VERTICAL, so the axis
           it is measured along has to be horizontal - and the root's
           own +Z stopped being horizontal the moment the body lean
           went in, so measuring against it cancelled part of the very
           thing it was reporting. It read 3.5 degrees at a sprint on
           a figure leaning 16. */
        const flatForward = forward.clone();
        flatForward.y = 0;
        flatForward.normalize();
        const chestUp = f.torsoUpLocal.clone()
          .transformDirection(f.chest.matrixWorld).normalize();
        const torsoLeanDeg = Math.abs(Math.atan2(
          chestUp.dot(flatForward), chestUp.y
        )) * 180 / Math.PI;
        const feet = [0, 1].map((index) => {
          const foot = f.footPivots[index];
          const toe = f.toePivots[index];
          const ankleWorld = f.root.position.clone();
          const toeWorld = f.root.position.clone();
          foot.getWorldPosition(ankleWorld);
          toe.getWorldPosition(toeWorld);
          const toeDirection = toeWorld.clone().sub(ankleWorld);
          /* Judge the direction the sabaton points across the ground,
             not its authored heel/toe pitch. A correctly aligned foot
             tilted 0.55rad into contact has a 3D forward dot of only
             cos(0.55)=0.853, so the old metric rejected natural toe-off
             as if it were an inward twist. */
          toeDirection.y = 0;
          if (toeDirection.lengthSq() > 1e-8) toeDirection.normalize();
          const flatForward = forward.clone().setY(0).normalize();
          const flatRight = right.clone().setY(0).normalize();
          const footAcross = ankleWorld.clone().set(1, 0, 0)
            .transformDirection(foot.matrixWorld).normalize();
          const local = ankleWorld.clone().applyMatrix4(inverse);
          return {
            side: index === 0 ? "right" : "left",
            local: local.toArray().map((value) => Number(value.toFixed(4))),
            toeForward: Number(toeDirection.dot(flatForward).toFixed(4)),
            toeLateral: Number(toeDirection.dot(flatRight).toFixed(4)),
            footAcrossRight: Number(footAcross.dot(flatRight).toFixed(4)),
            footAcrossVertical: Number(footAcross.y.toFixed(4)),
            ankleMissM: Number(ankleWorld.distanceTo(T.player.legs[index].foot).toFixed(4)),
            swinging: T.player.legs[index].swinging,
          };
        });
        return {
          kind,
          targetPhase,
          actualPhase: Number((((T.player.state.gait % 1) + 1) % 1).toFixed(4)),
          phaseError: Number(best.toFixed(4)),
          speed: Number(T.player.state.speed.toFixed(3)),
          torsoLeanDeg: Number(torsoLeanDeg.toFixed(2)),
          feet,
          leadFore: Number(Math.max(...feet.map((foot) => foot.local[2])).toFixed(4)),
          trailFore: Number(Math.min(...feet.map((foot) => foot.local[2])).toFixed(4)),
          pelvisBetweenAnkles: Math.min(...feet.map((foot) => foot.local[2])) < 0
            && Math.max(...feet.map((foot) => foot.local[2])) > 0,
        };
      }, { kind, targetPhase, bearing, x: site[0], z: site[1] });
      const file = path.join(out, `${kind}-${suffix}.png`);
      const buffer = await grab(page, file);
      return { metric, buffer };
    }

    const gait = { run: [], sprint: [] };
    const leanPanels = [];
    for (const kind of ["run", "sprint"]) {
      const panels = [];
      for (let index = 0; index < phaseTargets.length; index += 1) {
        const target = phaseTargets[index];
        const result = await motionFrame(kind, target, 0, `profile-${index}`);
        gait[kind].push(result.metric);
        if (target === 0.375) {
          leanPanels.push({
            buffer: result.buffer,
            label: `${kind.toUpperCase()} LEAN ${result.metric.torsoLeanDeg.toFixed(1)} DEG`,
          });
        }
        panels.push({
          buffer: result.buffer,
          label: `${kind.toUpperCase()}  PHASE ${target.toFixed(3)}`,
        });
      }
      await sheet(panels, path.join(out, `${kind}-profile-strip.png`), 8, 250, 325);
    }
    await sheet(leanPanels, path.join(out, "run-sprint-lean-comparison.png"), 2, 360, 468);

    /* Decisive sprint phase from all requested angles.  Choose the
       measured phase with the widest fore/aft ankle separation. */
    const decisive = gait.sprint.reduce((best, row) => {
      const span = row.leadFore - row.trailFore;
      return !best || span > best.span ? { phase: row.targetPhase, span } : best;
    }, null);
    const sprintAngles = [];
    for (const view of angles) {
      const result = await motionFrame("sprint", decisive.phase, view.bearing, view.id);
      sprintAngles.push({ buffer: result.buffer, label: `SPRINT ${view.id.toUpperCase()}` });
    }
    await sheet(sprintAngles, path.join(out, "sprint-multi-angle.png"), angles.length, 280, 390);

    const reach = await page.evaluate(() => window.__SF.armReachCheck());
    const report = await page.evaluate(() => window.__SF.report());
    const summary = {
      capturedAt: new Date().toISOString(),
      site,
      errors,
      weapon: {
        rangedIdentity: rootIdentity,
        modeIdentity,
        sameRootAcrossModes: rootIdentity.uuid === modeIdentity.melee.uuid
          && rootIdentity.uuid === modeIdentity.rangedAgain,
        sameParentAcrossModes: rootIdentity.parent === modeIdentity.melee.parent,
        reach,
        armPose,
        aimSweep,
      },
      melee,
      gait,
      decisiveSprintPhase: decisive,
      engine: report,
    };
    await writeFile(path.join(out, "report.json"), JSON.stringify(summary, null, 2));

    const allGait = [...gait.run, ...gait.sprint];
    const allReach = [reach, ...melee.map((row) => row.reach)].flat();
    const palmSurfaceMaximum = Math.max(...allReach
      .map((row) => row.surfaceToGrip)
      .filter((value) => Number.isFinite(value)));
    const toeMinimum = Math.min(...allGait.flatMap((row) => row.feet.map((foot) => foot.toeForward)));
    const toeLateralMaximum = Math.max(...allGait.flatMap((row) => row.feet.map((foot) => Math.abs(foot.toeLateral))));
    const acrossMinimum = Math.min(...allGait.flatMap((row) => row.feet.map((foot) => foot.footAcrossRight)));
    const acrossVerticalMaximum = Math.max(...allGait.flatMap((row) => row.feet.map((foot) => Math.abs(foot.footAcrossVertical))));
    const ankleMissMaximum = Math.max(...allGait.flatMap((row) => row.feet.map((foot) => foot.ankleMissM)));
    const widest = Math.max(...allGait.map((row) => row.leadFore - row.trailFore));
    const runLean = gait.run.find((row) => row.targetPhase === 0.375)?.torsoLeanDeg || 0;
    const sprintLean = gait.sprint.find((row) => row.targetPhase === 0.375)?.torsoLeanDeg || 0;
    const aimAngleMaximum = Math.max(...aimSweep.map((row) => row.aim.shaftToReticleDeg));
    const aimMissMaximum = Math.max(...aimSweep.map((row) => row.aim.reticleMissPx1080));
    const aimReachMinimum = Math.min(...aimSweep.flatMap((row) => [
      row.arms.supportReachUsedPct, row.arms.triggerReachUsedPct,
    ]));
    const aimReachMaximum = Math.max(...aimSweep.flatMap((row) => [
      row.arms.supportReachUsedPct, row.arms.triggerReachUsedPct,
    ]));
    const aimSurfaceMaximum = Math.max(...aimSweep.flatMap((row) => row.reach
      .map((arm) => arm.surfaceToGrip).filter((value) => Number.isFinite(value))));
    console.log(`same polearm root across modes: ${summary.weapon.sameRootAcrossModes}`);
    console.log(`posed gauntlet surface-to-grip maximum: ${palmSurfaceMaximum.toFixed(4)}m`);
    console.log(`carry torso turn toward weapon: ${armPose.torsoTowardWeaponDeg.toFixed(1)}deg`);
    console.log(`support/trigger elbow angles: ${armPose.support.elbowAngleDeg.toFixed(1)}deg / ${armPose.trigger.elbowAngleDeg.toFixed(1)}deg`);
    console.log(`trigger hand below support: ${armPose.triggerBelowSupportM.toFixed(3)}m`);
    console.log(`trigger elbow drop/outboard: ${armPose.triggerElbowDropM.toFixed(3)}m / ${armPose.triggerElbowOutboardM.toFixed(3)}m`);
    console.log(`support/trigger reach used: ${armPose.supportReachUsedPct.toFixed(1)}% / ${armPose.triggerReachUsedPct.toFixed(1)}%`);
    /* NAME the failures. "FAIL" alone sends the next person hunting
       through qa.js to find out which of fifteen windows moved. */
    const armFails = Object.entries(armPose.checks || {})
      .filter(([, ok]) => !ok).map(([k]) => k);
    console.log(`arm-pose checks: ${armPose.verdict ? "pass" : `FAIL - ${armFails.join(", ")}`}`);
    console.log(`reticle sweep shaft error / miss: ${aimAngleMaximum.toFixed(3)}deg / ${aimMissMaximum.toFixed(2)}px@1080`);
    console.log(`reticle sweep reach range: ${aimReachMinimum.toFixed(1)}-${aimReachMaximum.toFixed(1)}%`);
    console.log(`toe forward minimum: ${toeMinimum.toFixed(3)}`);
    console.log(`toe lateral maximum: ${toeLateralMaximum.toFixed(3)}`);
    console.log(`foot across/right minimum: ${acrossMinimum.toFixed(3)}`);
    console.log(`foot across vertical maximum: ${acrossVerticalMaximum.toFixed(3)}`);
    console.log(`ankle target miss maximum: ${ankleMissMaximum.toFixed(4)}m`);
    console.log(`widest fore/aft ankle span: ${widest.toFixed(3)}m`);
    console.log(`torso lean walk/sprint: ${runLean.toFixed(1)}deg / ${sprintLean.toFixed(1)}deg`);
    console.log(`page/console errors: ${errors.length}`);
    console.log(`artifacts: ${path.relative(root, out)}`);

    if (!summary.weapon.sameRootAcrossModes || errors.length
      || !armPose?.verdict
      || aimSweep.some((row) => !row.aim?.verdict)
      || aimAngleMaximum > 0.25 || aimMissMaximum > 8
      /* Floor lowered from 80 with the over/under hold, then again
         with the hip-height carry: the rear grip moved forward along
         the haft (weapons.js gripRear), so the trigger hand sits
         closer to its shoulder across the whole aim sweep. A
         well-bent elbow, not a collapsed one - the ceiling is the
         half of this gate that catches a locked arm, unchanged. */
      || aimReachMinimum < 42 || aimReachMaximum > 95
      /* PALM_CONTACT_MAX, applied to both the aim sweep and the carry
         and melee poses. They were separate literals, both 0.025, and
         only one of them was found the first time this moved - which
         is the argument for the constant.

         A hand HOLDING a pole has its centroid about half a gauntlet
         off the pole's axis. A 0.025m ceiling asks for the centroid
         to sit on the grip point itself, achievable only with the
         haft passing through the middle of the hand - and that is
         exactly the pose it was passing: an open palm skewered on the
         shaft with the fingers out the far side. 0.075m is contact;
         more than that is daylight. */
      || aimSurfaceMaximum > PALM_CONTACT_MAX
      || palmSurfaceMaximum > PALM_CONTACT_MAX
      || toeMinimum < 0.94 || toeLateralMaximum > 0.08
      || acrossMinimum < 0.94 || acrossVerticalMaximum > 0.08
      || ankleMissMaximum > 0.02 || widest < 0.55
      || runLean < 4.5 || runLean > 8.5
      || sprintLean < 11 || sprintLean > 18
      || sprintLean - runLean < 5) {
      process.exitCode = 1;
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
