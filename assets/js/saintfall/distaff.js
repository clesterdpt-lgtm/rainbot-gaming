/* ============================================================
   SAINTFALL - the Distaff

   The Glass Scar's own guardian, and everything about it that is not
   geometry: when it wakes, how it fights while standing, what
   breaking a leg does to it, and what it does once enough of them
   are gone.

   WHY THIS IS ITS OWN MODULE

   Every other creature in the bestiary is a body `stepEnemy` can
   reason about with one set of rules: it stands on the ground, it is
   always hittable, and it is either closing or attacking. None of
   that is true here. This animal is driven entirely by proximity
   rather than sight/hearing/aggro, most of its body is not a valid
   target until eight legs have taken real damage, and "standing" and
   "collapsed" are different creatures as far as combat.js's hit
   tests are concerned. Bolting that onto stepEnemy would have put a
   `key === "distaff"` branch into the file every walker in the game
   depends on - see combat.js's own opt-out for the reasoning, which
   this module is the second user of.

   THE CYCLE

     DORMANT    Folded in its lair. Ignores the player completely
                until they cross AGGRO_RADIUS - this is a place you
                walk into, not a wave that finds you.
     ALERT      A short reveal beat: rears up, the camera cuts to it.
     STANDING   THE FIGHT'S FIRST HALF. Nine metres up, only the legs
                are in reach. It answers with a telegraphed leg slam,
                web bolts at range and web patches underfoot.
     COLLAPSED  Triggered once enough legs are broken (see combat.js's
                LEG_BREAK_BONUS_FRACTION and HITBOX.distaff for the
                mechanical half of this). The body comes down and is,
                for the first time, worth more to melee than to a
                rifle - it still bites back while it is there.
     RECOVERING Standing back up, if it survives the window. Every
                broken leg stays broken; breaking a NINTH... eighth
                one is not possible, and breaking the last of the
                eight leaves it down for good.

   A leg it has lost stays lost - this module reads `inst.legBroken`/
   `inst.legsBroken`, which combat.js owns, and never writes to them.
   ============================================================ */

import { TAU, clamp, clamp01, damp, dampAngle, makeBus } from "saintfall/core.js";
import { patchMaterial } from "saintfall/art.js";
import { DISTRICTS } from "saintfall/terrain.js";

export const DISTAFF_CONFIG = Object.freeze({
  // Off-centre in the Scar's flat floor, clear of the buried lance
  // and its light at the crater's middle - see world.js.
  lairX: DISTRICTS.scar.x - 14,
  lairZ: DISTRICTS.scar.z + 10,
  /* Inside the crater, not across it - the reveal is "you have
     walked into its territory", not "it noticed you from the rim". */
  aggroRadius: 52,
  /* Past this and unengaged long enough, it resets to full health and
     goes back to sleep - see `stepDormantCheck`. Without this a
     player who pulls it, dies elsewhere and respawns would come back
     to a boss frozen mid-fight with no way to reach it again. */
  disengageRadius: 240,
  disengageSeconds: 14,

  alertSeconds: 2.2,

  // Legs broken before it buckles - half of eight - and how long the
  // body stays a target once it has.
  collapseThreshold: 4,
  collapseSeconds: 11,
  collapseSlamContact: 0.90,      // seconds into `collapse`, matches the model's own timing
  recoverSeconds: 1.7,
  /* A fresh collapse cannot retrigger inside this window even if a
     new leg breaks the instant it stands - the vulnerable window has
     to actually end before the next one can begin. */
  recollapseGuard: 2.5,

  slamCadence: 4.4,
  slamContact: 0.90,
  slamRadius: 9.5,
  slamDamage: 46,

  webCadence: 5.6,
  webContact: 0.78,
  webSpeed: 25,
  webDamage: 10,
  webRootSeconds: 3.0,
  webSlowFactor: 0.34,

  patchCadence: 7.5,
  patchRadius: 5.2,
  patchSeconds: 11,
  patchSlowFactor: 0.55,

  biteCadence: 1.75,
  biteContact: 0.50,
  biteReach: 5.6,
  biteDamage: 58,

  // Simulated well past combat.js's own culling horizon: a landmark
  // this size has to keep fighting even if the player circles wide.
  simRange: 620,
});

const BOLT_MAX = 6;
const PATCH_MAX = 5;
const WEB_COLOUR = "#bff5ec";
const WEB_EDGE = "#3f8f92";
const WEB_BED = "#0c2624";

export function buildDistaff(ctx) {
  const { THREE, scene, atmos, enemies } = ctx;
  const bus = makeBus();
  const C = DISTAFF_CONFIG;
  const groundAt = (x, z) => (ctx.collide
    ? ctx.collide.groundHeight(x, z)
    : ctx.terrain.heightAt(x, z));

  const group = new THREE.Group();
  group.name = "distaff-web";
  scene.add(group);

  const state = {
    phase: "dormant",       // dormant, alert, standing, collapsed, recovering, dead
    timer: 0,
    legsAtLastCollapse: 0,
    slamTimer: C.slamCadence * 0.55,
    webTimer: C.webCadence * 0.7,
    patchTimer: C.patchCadence * 0.5,
    action: 0,
    actionKind: null,
    pending: 0,
    recollapseFor: 0,
    disengageFor: 0,
    defeated: false,
    biteTimer: 0,
    releaseCameraAt: undefined,
    // Read off the instance's own leg pool at spawn, since
    // DISTAFF_CONFIG is frozen and cannot carry it - see resetToLair.
    legHealthRef: 340,
  };
  let inst = null;

  /* ============================================================
     WEB BOLTS - a fast, near-straight shot rather than a lobbed
     arc, because silk is thrown to PIN something, not to land on it
     a second later. Pooled and updated exactly like the Coulter's
     venom globules, which this is a straight-line simplification of.
     ============================================================ */
  const boltGeo = new THREE.IcosahedronGeometry(0.30, 0);
  const boltMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(WEB_EDGE),
    emissive: new THREE.Color(WEB_COLOUR),
    emissiveIntensity: 1.4,
    roughness: 0.30,
    metalness: 0,
    flatShading: true,
  });
  boltMat.name = "sf-distaff-bolt";
  patchMaterial(boltMat, atmos, { rim: 0.6, glitter: 0 });
  const bolts = [];
  for (let i = 0; i < BOLT_MAX; i += 1) {
    const mesh = new THREE.Mesh(boltGeo, boltMat);
    mesh.visible = false;
    mesh.castShadow = false;
    group.add(mesh);
    bolts.push({ mesh, live: false, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
  }
  let boltCursor = 0;

  function launchBolt(x, y, z, vx, vy, vz) {
    const b = bolts[boltCursor];
    boltCursor = (boltCursor + 1) % BOLT_MAX;
    b.live = true;
    b.life = 3.2;
    b.x = x; b.y = y; b.z = z;
    b.vx = vx; b.vy = vy; b.vz = vz;
    b.mesh.position.set(x, y, z);
    b.mesh.visible = true;
    return b;
  }

  /* ============================================================
     WEB PATCHES - the venom pool's own construction, rewritten as a
     woven strand pattern instead of a liquid stain, and a movement
     slow instead of a damage tick. `aRadial`/`aAngle` per vertex let
     the shader draw both the concentric rings and the radial spokes
     of an actual web rather than a plain disc.
     ============================================================ */
  const PATCH_RINGS = 3;
  const PATCH_SIDES = 24;
  const PATCH_VERTS = 1 + PATCH_RINGS * PATCH_SIDES;

  const patchVertex = /* glsl */`
    attribute float aRadial;
    attribute float aAngle;
    varying float vRadial;
    varying float vAngle;
    void main() {
      vRadial = aRadial;
      vAngle = aAngle;
      gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    }
  `;
  const patchFragment = /* glsl */`
    precision highp float;
    uniform vec3 uCore;
    uniform vec3 uEdge;
    uniform vec3 uBed;
    uniform float uFade;
    uniform float uTime;
    varying float vRadial;
    varying float vAngle;
    void main() {
      float r = clamp(vRadial, 0.0, 1.0);
      // Concentric rings and radial spokes, the two things that read
      // as "spun" rather than "spilled" at any distance.
      float rings = pow(0.5 + 0.5 * sin(r * 22.0 - uTime * 0.6), 10.0);
      float spokes = pow(abs(cos(vAngle * 9.0)), 14.0);
      float web = clamp(rings * 0.7 + spokes * (1.0 - r) * 0.8, 0.0, 1.0);
      float bed = (1.0 - smoothstep(0.55, 1.0, r)) * 0.20;
      vec3 c = mix(uBed, uEdge, bed * 3.0 + web * 0.4);
      c = mix(c, uCore, web * 0.7);
      float far = 1.0 - smoothstep(180.0, 300.0, length(cameraPosition));
      float a = (bed + web * 0.62) * uFade * (0.4 + 0.6 * far);
      if (a < 0.006) discard;
      gl_FragColor = vec4(c, clamp(a, 0.0, 0.88));
    }
  `;

  const patches = [];
  for (let i = 0; i < PATCH_MAX; i += 1) {
    const geo = new THREE.BufferGeometry();
    const position = new Float32Array(PATCH_VERTS * 3);
    const radial = new Float32Array(PATCH_VERTS);
    const angle = new Float32Array(PATCH_VERTS);
    const index = [];
    for (let s = 0; s < PATCH_SIDES; s += 1) {
      const n = (s + 1) % PATCH_SIDES;
      index.push(0, 1 + s, 1 + n);
      for (let r = 0; r < PATCH_RINGS - 1; r += 1) {
        const a0 = 1 + r * PATCH_SIDES + s;
        const a1 = 1 + r * PATCH_SIDES + n;
        const b0 = 1 + (r + 1) * PATCH_SIDES + s;
        const b1 = 1 + (r + 1) * PATCH_SIDES + n;
        index.push(a0, b0, b1, a0, b1, a1);
      }
    }
    for (let r = 0; r < PATCH_RINGS; r += 1) {
      const t = (r + 1) / PATCH_RINGS;
      for (let s = 0; s < PATCH_SIDES; s += 1) {
        radial[1 + r * PATCH_SIDES + s] = t;
        angle[1 + r * PATCH_SIDES + s] = (s / PATCH_SIDES) * TAU;
      }
    }
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("aRadial", new THREE.BufferAttribute(radial, 1));
    geo.setAttribute("aAngle", new THREE.BufferAttribute(angle, 1));
    geo.setIndex(index);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uCore: { value: new THREE.Color(WEB_COLOUR) },
        uEdge: { value: new THREE.Color(WEB_EDGE) },
        uBed: { value: new THREE.Color(WEB_BED) },
        uFade: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: patchVertex,
      fragmentShader: patchFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `sf-web-patch-${i}`;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 5;
    group.add(mesh);
    patches.push({
      mesh, mat, position, life: 0, span: 1, x: 0, y: 0, z: 0, radius: C.patchRadius,
    });
  }
  let patchCursor = 0;

  function spillPatch(x, z, radius = C.patchRadius, seconds = C.patchSeconds) {
    const patch = patches[patchCursor];
    patchCursor = (patchCursor + 1) % patches.length;
    const y = groundAt(x, z);
    patch.x = x; patch.y = y; patch.z = z;
    patch.radius = radius;
    patch.span = seconds;
    patch.life = seconds;
    const p = patch.position;
    p[0] = 0; p[1] = 0.07; p[2] = 0;
    for (let r = 0; r < PATCH_RINGS; r += 1) {
      const rr = radius * ((r + 1) / PATCH_RINGS);
      for (let s = 0; s < PATCH_SIDES; s += 1) {
        const a = (s / PATCH_SIDES) * TAU + r * 0.1;
        const wob = 1 - 0.10 * Math.sin(a * 4 + r * 1.3);
        const px = Math.cos(a) * rr * wob;
        const pz = Math.sin(a) * rr * wob;
        const i = (1 + r * PATCH_SIDES + s) * 3;
        p[i] = px;
        p[i + 1] = groundAt(x + px, z + pz) - y + 0.075;
        p[i + 2] = pz;
      }
    }
    patch.mesh.position.set(x, y, z);
    patch.mesh.geometry.attributes.position.needsUpdate = true;
    patch.mesh.geometry.computeBoundingSphere();
    patch.mesh.visible = true;
    bus.emit("patch", { x, y, z, radius });
    return patch;
  }

  function patchAt(x, y, z) {
    for (const patch of patches) {
      if (patch.life <= 0) continue;
      const dx = x - patch.x;
      const dz = z - patch.z;
      if (dx * dx + dz * dz > patch.radius * patch.radius) continue;
      if (Math.abs(y - patch.y) > 3) continue;
      return patch;
    }
    return null;
  }

  function updatePatches(dt) {
    const ps = ctx.player?.state;
    let standing = false;
    for (const patch of patches) {
      if (patch.life <= 0) {
        if (patch.mesh.visible) patch.mesh.visible = false;
        continue;
      }
      patch.life -= dt;
      if (patch.life <= 0) {
        patch.mesh.visible = false;
        patch.mat.uniforms.uFade.value = 0;
        continue;
      }
      const t = patch.life / patch.span;
      const fade = t > 0.85 ? clamp01((1 - t) / 0.15) : clamp01(t / 0.85) ** 0.6;
      patch.mat.uniforms.uFade.value = fade;
      patch.mat.uniforms.uTime.value = atmos.elapsed;
    }
    if (ps && !ctx.combat?.player?.dead && patchAt(ps.x, ps.y, ps.z)) standing = true;
    if (standing) ctx.player?.applySlow?.(C.patchSlowFactor, 0.3);
  }

  function updateBolts(dt) {
    const ps = ctx.player?.state;
    for (const b of bolts) {
      if (!b.live) continue;
      b.life -= dt;
      const px = b.x, py = b.y, pz = b.z;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      b.mesh.position.set(b.x, b.y, b.z);
      b.mesh.rotation.x += dt * 6;
      b.mesh.rotation.y += dt * 4.4;

      let hit = null;
      const step = Math.hypot(b.x - px, b.y - py, b.z - pz);
      if (step > 1e-4 && ctx.collide?.rayBlock) {
        const blocked = ctx.collide.rayBlock(px, py, pz,
          (b.x - px) / step, (b.y - py) / step, (b.z - pz) / step, step);
        if (blocked < step) {
          hit = {
            x: px + ((b.x - px) / step) * blocked,
            y: py + ((b.y - py) / step) * blocked,
            z: pz + ((b.z - pz) / step) * blocked,
            direct: false,
          };
        }
      }
      if (!hit && ps && !ctx.combat?.player?.dead) {
        const dx = b.x - ps.x;
        const dz = b.z - ps.z;
        const dy = b.y - (ps.y + 1.0);
        if (dx * dx + dz * dz < 1.7 * 1.7 && Math.abs(dy) < 1.6) {
          hit = { x: b.x, y: b.y, z: b.z, direct: true };
        }
      }
      if (hit) {
        b.live = false;
        b.mesh.visible = false;
        if (hit.direct) {
          ctx.combat?.hurtPlayer?.(C.webDamage, {
            source: "distaff-web", x: hit.x, y: hit.y, z: hit.z,
          });
          ctx.player?.applySlow?.(C.webSlowFactor, C.webRootSeconds);
          ctx.player?.doctrineKick?.(0.5, 0.2);
          bus.emit("webHit", hit);
        } else {
          bus.emit("webSplash", hit);
        }
        ctx.vfx?.spark?.(hit.x, hit.y, hit.z, hit.direct ? 1.6 : 0.9, !hit.direct, false);
        continue;
      }
      if (b.life <= 0) { b.live = false; b.mesh.visible = false; }
    }
  }

  /* ============================================================
     BEHAVIOUR
     ============================================================ */

  function faceTowards(x, z, rate, dt) {
    const dx = x - inst.x;
    const dz = z - inst.z;
    if (Math.hypot(dx, dz) < 1e-3) return;
    inst.yaw = dampAngle(inst.yaw, Math.atan2(dx, dz), rate, dt);
    inst.root.rotation.y = inst.yaw;
  }

  function beginAlert() {
    state.phase = "alert";
    state.timer = C.alertSeconds;
    enemies.play(inst, "alert", 0.25);
    bus.emit("aggro", { x: inst.x, z: inst.z });
    /* The reveal camera is a review tool's own trick, not a new
       system - see player.setFree, already used for the free-cam key
       and every scripted QA shot. Handed back the instant the beat
       ends; combat and mission time never stop for it. */
    if (ctx.player?.setFree && !ctx.player.state.free) {
      const px = ctx.player.state.x;
      const pz = ctx.player.state.z;
      const dx = inst.x - px;
      const dz = inst.z - pz;
      const d = Math.hypot(dx, dz) || 1;
      const side = { x: -dz / d, z: dx / d };
      const camX = px + (dx / d) * Math.min(d * 0.35, 14) + side.x * 6;
      const camZ = pz + (dz / d) * Math.min(d * 0.35, 14) + side.z * 6;
      const camY = groundAt(camX, camZ) + 5.5;
      ctx.player.setFree(true, [camX, camY, camZ],
        [inst.x, inst.y + 9, inst.z], 46);
      state.releaseCameraAt = state.timer - 0.35;
    }
  }

  function beginCollapse() {
    state.phase = "collapsed";
    state.timer = C.collapseSeconds;
    state.legsAtLastCollapse = inst.legsBroken;
    state.action = 0;
    state.pending = 0;
    inst.collapsed = true;
    enemies.play(inst, "collapse", 0.06);
    ctx.player?.doctrineKick?.(1.1, 1);
    bus.emit("collapse", { x: inst.x, z: inst.z, legsBroken: inst.legsBroken });
  }

  function beginRecover() {
    state.phase = "recovering";
    state.timer = C.recoverSeconds;
    inst.collapsed = false;
    enemies.play(inst, "recover", 0.08);
    bus.emit("recover", { x: inst.x, z: inst.z });
  }

  function beginSlam() {
    enemies.play(inst, "slam", 0.1);
    state.action = 2.0;
    state.actionKind = "slam";
    state.pending = C.slamContact;
    state.slamTimer = C.slamCadence;
    bus.emit("slamTelegraph", { x: inst.x, z: inst.z });
  }

  function beginWebCast() {
    enemies.play(inst, "webCast", 0.1);
    state.action = 1.92;
    state.actionKind = "webCast";
    state.pending = C.webContact;
    state.webTimer = C.webCadence;
    bus.emit("webCastTelegraph", { x: inst.x, z: inst.z });
  }

  function beginBite() {
    enemies.play(inst, "bite", 0.05);
    state.action = 1.33;
    state.actionKind = "bite";
    state.pending = C.biteContact;
    bus.emit("biteTelegraph", { x: inst.x, z: inst.z });
  }

  function landSlam() {
    const ps = ctx.player.state;
    const dist = Math.hypot(ps.x - inst.x, ps.z - inst.z);
    const y = groundAt(inst.x, inst.z);
    ctx.vfx?.blast?.(inst.x, y + 0.3, inst.z, C.slamRadius * 0.55);
    if (dist > C.slamRadius || ctx.combat?.player?.dead) {
      bus.emit("slamMiss", { x: inst.x, z: inst.z });
      return;
    }
    const falloff = 1 - 0.6 * (dist / C.slamRadius);
    ctx.combat.hurtPlayer(C.slamDamage * falloff, {
      source: "distaff-slam", x: ps.x, y: ps.y + 1.0, z: ps.z,
    });
    ctx.player.punch?.(1.5);
    ctx.player.doctrineKick?.(0.9, 0.85);
    bus.emit("slam", { x: inst.x, z: inst.z });
  }

  function launchWebBolt() {
    const bone = inst.bones.get("spinneret");
    if (!bone) return;
    bone.updateWorldMatrix(true, false);
    const origin = bone.getWorldPosition(_vec);
    const ps = ctx.player.state;
    const dx = ps.x - origin.x;
    const dy = (ps.y + 0.9) - origin.y;
    const dz = ps.z - origin.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    launchBolt(origin.x, origin.y, origin.z,
      (dx / d) * C.webSpeed, (dy / d) * C.webSpeed, (dz / d) * C.webSpeed);
    ctx.vfx?.spark?.(origin.x, origin.y, origin.z, 1.1, false, true);
    bus.emit("webCast", { x: origin.x, y: origin.y, z: origin.z });
  }

  function landBite() {
    const ps = ctx.player.state;
    const dist = Math.hypot(ps.x - inst.x, ps.z - inst.z);
    if (dist > C.biteReach + 1.2 || ctx.combat?.player?.dead) {
      bus.emit("biteMiss", { x: inst.x, z: inst.z });
      return;
    }
    ctx.combat.hurtPlayer(C.biteDamage, {
      source: "distaff-bite", x: ps.x, y: ps.y + 1.0, z: ps.z,
    });
    ctx.player.punch?.(1.4);
    bus.emit("bite", { x: inst.x, z: inst.z });
  }

  function resolveAction(dt) {
    if (!(state.pending > 0)) return;
    state.pending -= dt;
    if (state.pending > 0) return;
    state.pending = 0;
    if (state.actionKind === "slam") landSlam();
    else if (state.actionKind === "webCast") launchWebBolt();
    else if (state.actionKind === "bite") landBite();
  }

  function stepStanding(dt, dist) {
    /* THE TRIGGER. Standing only - a leg broken mid-collapse (the
       body is already the target) or mid-recovery does not restart
       the clock; it just counts toward the next one. */
    if (state.recollapseFor > 0) state.recollapseFor -= dt;
    if (inst.legsBroken >= C.collapseThreshold
      && inst.legsBroken > state.legsAtLastCollapse
      && state.recollapseFor <= 0) {
      beginCollapse();
      return;
    }
    state.slamTimer -= dt;
    state.webTimer -= dt;
    state.patchTimer -= dt;
    state.action = Math.max(0, state.action - dt);
    if (state.action > 0) { resolveAction(dt); return; }

    if (state.slamTimer <= 0 && dist < C.slamRadius * 1.3) { beginSlam(); return; }
    if (state.webTimer <= 0) { beginWebCast(); return; }
    if (state.patchTimer <= 0) {
      state.patchTimer = C.patchCadence;
      const ps = ctx.player.state;
      const ang = Math.random() * TAU;
      const r = 3 + Math.random() * 6;
      spillPatch(ps.x + Math.cos(ang) * r, ps.z + Math.sin(ang) * r);
      return;
    }
    if (inst.state !== "alert") enemies.play(inst, "alert", 0.3);
  }

  function stepCollapsed(dt) {
    state.timer -= dt;
    state.action = Math.max(0, state.action - dt);
    if (state.action > 0) resolveAction(dt);
    else if (state.biteTimer === undefined || state.biteTimer <= 0) {
      const ps = ctx.player.state;
      if (Math.hypot(ps.x - inst.x, ps.z - inst.z) < C.biteReach) {
        beginBite();
        state.biteTimer = C.biteCadence;
      }
    } else {
      state.biteTimer -= dt;
    }
    if (state.timer <= 0) {
      if (inst.legsBroken >= 8) {
        // No legs left to stand on. Down for good.
        state.timer = 4;
        return;
      }
      beginRecover();
    }
  }

  function stepRecovering(dt) {
    state.timer -= dt;
    if (state.timer <= 0) {
      state.phase = "standing";
      state.recollapseFor = C.recollapseGuard;
      enemies.play(inst, "alert", 0.3);
    }
  }

  const _vec = new THREE.Vector3();

  function stepDormantCheck(dist) {
    if (dist <= C.aggroRadius) { beginAlert(); return; }
  }

  function stepInstance(dt) {
    if (!inst) return;
    if (inst.state === "death") {
      if (!state.defeated) {
        state.defeated = true;
        state.phase = "dead";
        bus.emit("defeated", { x: inst.x, z: inst.z });
      }
      return;
    }
    const ps = ctx.player.state;
    const dist = Math.hypot(ps.x - inst.x, ps.z - inst.z);

    if (state.phase === "dormant") { stepDormantCheck(dist); return; }

    /* A boss that can be permanently ground out of reach by a
       player who simply leaves is a boss that can be soft-locked -
       full health, no way back to it, in whatever run this is. */
    if (dist > C.disengageRadius && state.phase !== "collapsed") {
      state.disengageFor += dt;
      if (state.disengageFor > C.disengageSeconds) { resetToLair(); return; }
    } else {
      state.disengageFor = 0;
    }

    if (state.phase === "alert") {
      faceTowards(ps.x, ps.z, 1.1, dt);
      state.timer -= dt;
      if (state.releaseCameraAt !== undefined && state.timer <= state.releaseCameraAt) {
        ctx.player?.setFree?.(false);
        state.releaseCameraAt = undefined;
      }
      if (state.timer <= 0) {
        state.phase = "standing";
        enemies.play(inst, "alert", 0.3);
      }
      return;
    }

    faceTowards(ps.x, ps.z, state.phase === "collapsed" ? 0.5 : 1.5, dt);

    if (state.phase === "standing") stepStanding(dt, dist);
    else if (state.phase === "collapsed") stepCollapsed(dt);
    else if (state.phase === "recovering") stepRecovering(dt);
  }

  /** Put it back to sleep at full strength - broken legs regrow with
   *  it, because there is no honest way to leave the fight half-won
   *  and still call the encounter repeatable. */
  function resetToLair() {
    if (!inst) return;
    inst.health = inst.maxHealth;
    if (inst.legHp) {
      for (let i = 0; i < inst.legHp.length; i += 1) inst.legHp[i] = state.legHealthRef;
    }
    if (inst.legBroken) inst.legBroken.fill(false);
    inst.legsBroken = 0;
    inst.collapsed = false;
    state.phase = "dormant";
    state.legsAtLastCollapse = 0;
    state.disengageFor = 0;
    enemies.play(inst, "idle", 0.4);
    bus.emit("reset", { x: inst.x, z: inst.z });
  }

  function ensureSpawned() {
    if (inst) return inst;
    const x = C.lairX;
    const z = C.lairZ;
    inst = enemies.spawn("distaff", x, z, { yaw: Math.PI * 0.15 });
    if (inst) state.legHealthRef = inst.legHp?.[0] || 340;
    return inst;
  }

  function update(dt) {
    const d = Math.min(0.1, Math.max(0, dt));
    if (!inst) { ensureSpawned(); return; }
    stepInstance(d);
    updateBolts(d);
    updatePatches(d);
  }

  function status() {
    if (!inst) return null;
    return {
      phase: state.phase,
      health: Math.max(0, Math.round(inst.health)),
      maxHealth: Math.round(inst.maxHealth),
      legsBroken: inst.legsBroken || 0,
      legCount: inst.legHp ? inst.legHp.length : 8,
      legBroken: inst.legBroken ? [...inst.legBroken] : [],
      collapsed: !!inst.collapsed,
      dead: inst.state === "death",
      x: Number(inst.x.toFixed(2)),
      z: Number(inst.z.toFixed(2)),
    };
  }

  function snapshot() {
    if (!inst) return null;
    return {
      phase: state.phase,
      timer: Number(state.timer.toFixed(2)),
      legsAtLastCollapse: state.legsAtLastCollapse,
      health: Math.round(inst.health),
      maxHealth: Math.round(inst.maxHealth),
      legHp: inst.legHp ? [...inst.legHp] : null,
      legBroken: inst.legBroken ? [...inst.legBroken] : null,
      legsBroken: inst.legsBroken || 0,
      x: inst.x, z: inst.z, yaw: inst.yaw,
      defeated: state.defeated,
    };
  }

  function restore(saved) {
    if (!saved || typeof saved !== "object") return false;
    ensureSpawned();
    if (!inst) return false;
    const phase = ["dormant", "alert", "standing", "collapsed", "recovering", "dead"]
      .includes(saved.phase) ? saved.phase : "dormant";
    state.phase = phase;
    state.timer = Math.max(0, Number(saved.timer) || 0);
    state.legsAtLastCollapse = Math.max(0, Math.round(Number(saved.legsAtLastCollapse) || 0));
    state.defeated = !!saved.defeated;
    state.disengageFor = 0;
    state.recollapseFor = 0;
    inst.x = Number.isFinite(saved.x) ? saved.x : inst.x;
    inst.z = Number.isFinite(saved.z) ? saved.z : inst.z;
    inst.yaw = Number.isFinite(saved.yaw) ? saved.yaw : inst.yaw;
    inst.root.position.set(inst.x, inst.y, inst.z);
    inst.root.rotation.y = inst.yaw;
    if (Number.isFinite(saved.health)) inst.health = clamp(saved.health, 0, inst.maxHealth);
    if (Array.isArray(saved.legHp) && inst.legHp) {
      for (let i = 0; i < inst.legHp.length; i += 1) {
        inst.legHp[i] = Number.isFinite(saved.legHp[i]) ? saved.legHp[i] : inst.legHp[i];
      }
    }
    if (Array.isArray(saved.legBroken) && inst.legBroken) {
      for (let i = 0; i < inst.legBroken.length; i += 1) inst.legBroken[i] = !!saved.legBroken[i];
    }
    inst.legsBroken = Math.max(0, Math.round(Number(saved.legsBroken) || 0));
    inst.collapsed = phase === "collapsed";
    if (state.defeated || phase === "dead") {
      enemies.play(inst, "death", 0);
      inst.health = 0;
    } else {
      enemies.play(inst, phase === "dormant" ? "idle" : "alert", 0);
    }
    return true;
  }

  function clearHazards() {
    for (const b of bolts) { b.live = false; b.mesh.visible = false; }
    for (const p of patches) {
      p.life = 0; p.mesh.visible = false; p.mat.uniforms.uFade.value = 0;
    }
  }

  return {
    bus,
    config: C,
    group,
    update,
    status,
    snapshot,
    restore,
    clearHazards,
    spillPatch,
    ensureSpawned,
    /** Force a phase transition, for checks about a phase rather than
     *  about how the animal gets into it - the same reasoning as the
     *  Coulter's `setCoulterPhase`. Only meaningful once spawned. */
    forcePhase(phase, timer) {
      if (!inst) return null;
      state.phase = String(phase);
      if (Number.isFinite(timer)) state.timer = timer;
      inst.collapsed = state.phase === "collapsed";
      return { phase: state.phase, timer: state.timer };
    },
    /** Instance accessor. QA-facing rather than gameplay-facing - the
     *  encounter itself only ever needs `status()`. */
    instance() { return inst; },
    dispose() { scene.remove(group); },
  };
}
