/* ============================================================
   SAINTFALL - Aegis energy shield

   A held, forward-facing defence powered by the reliquary pack.
   Combat still owns health; this module owns the shared-charge
   drain, frontal-cone decision, impact state and world visual.
   ============================================================ */

import { clamp01, damp } from "saintfall/core.js";
import { keybindDown } from "saintfall/keybinds.js";

export const SHIELD_CONFIG = Object.freeze({
  /* A full Reliquary now sustains an ordinary plate for 8.33 seconds.
     The former 5.56-second tank made guarding an approach consume nearly
     everything before a melee player could begin a combo. */
  drainRate: 12,
  moveSpeed: 3.0,
  frontDot: 0.42,
  distance: 0.94,
  centreY: 1.08,
  perfectWindow: 0.25,
  domeRadius: 2.62,
});

/* The plate's outline, in metres, in the plate's own XY. Shared by the
   geometry and by the fragment shader's edge distance, so the glow
   sits exactly on the silhouette. */
const PLATE_OUTLINE = [
  [0, 1.04], [0.48, 0.87], [0.76, 0.54], [0.88, 0.10], [0.72, -0.62],
  [0, -1.05], [-0.72, -0.62], [-0.88, 0.10], [-0.76, 0.54], [-0.48, 0.87],
];

function makeShieldShape(THREE) {
  const shape = new THREE.Shape();
  PLATE_OUTLINE.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  /* Subdivided so the impact ripple and the forming wipe, both of
     which are per-fragment, are not stretched across ten triangles of
     a fan - the mesh density does not change the shading, only the
     interpolation of the view vector, but that is enough to bend the
     rim glow on a coarse fan. */
  return new THREE.ShapeGeometry(shape, 6);
}

const PLATE_VERT = /* glsl */`
  varying vec2 vP;
  varying vec3 vNrm;
  varying vec3 vView;
  void main() {
    vP = position.xy;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    vNrm = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`;

/* A rose window that stops a blow. Everything on it is a line of light
   on dark glass: the silhouette glow, twelve spokes, three rings, a
   central sun, tick-marks that turn, and a band that sweeps up it - and
   under all of that a faint fill so the plate has a body against the
   sand. `uHit` is the impact point in plate space plus its age, and it
   throws a ring across the lattice from wherever the blow landed. */
const PLATE_FRAG = /* glsl */`
  uniform vec3 uColour;
  uniform vec3 uAccent;
  uniform float uTime;
  uniform float uForm;
  uniform float uPulse;
  uniform vec3 uHit;
  uniform float uPerfect;
  uniform vec2 uEdgeA[10];
  uniform vec2 uEdgeB[10];
  varying vec2 vP;
  varying vec3 vNrm;
  varying vec3 vView;
  float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  float band(float x, float at, float w) { return 1.0 - smoothstep(0.0, w, abs(x - at)); }
  void main() {
    // Distance to the silhouette, from the same outline the mesh uses.
    float edge = 1e9;
    for (int i = 0; i < 10; i++) {
      edge = min(edge, segDist(vP, uEdgeA[i], uEdgeB[i]));
    }
    float nv = abs(dot(normalize(vNrm), normalize(vView)));
    // Grazing angles brighten it - the plate is seen from behind the
    // shoulder, nearly edge on, most of the time.
    float fres = pow(1.0 - nv, 2.2) * 0.9 + 0.25;
    vec2 q = vP / vec2(0.88, 1.05);
    float r = length(q);
    float a = atan(q.y, q.x);
    // ---- the lattice ----
    float rim = exp(-edge * edge * 520.0) * 1.35 + exp(-edge * 14.0) * 0.32;
    float ring1 = band(r, 0.78, 0.014) * 0.9;
    float ring2 = band(r, 0.52, 0.012) * 0.75;
    float ring3 = band(r, 0.24, 0.016) * 0.9;
    float spokes = pow(abs(cos(a * 6.0)), 60.0) * step(0.24, r) * (1.0 - step(0.78, r)) * 0.55;
    // Ticks on the outer ring, turning slowly: the plate is alive.
    float ticks = pow(abs(cos(a * 12.0 + uTime * 0.6)), 40.0) * band(r, 0.66, 0.06) * 0.7;
    // A sun at the boss: hot core with an eight-point flare.
    float sun = exp(-r * r * 60.0) * 1.6 + pow(abs(cos(a * 4.0 + uTime * 0.25)), 24.0)
      * exp(-r * r * 14.0) * 0.6;
    // A band sweeping up the plate about once a second.
    float sweepY = fract(uTime * 0.55) * 2.6 - 1.3;
    float sweep = exp(-(vP.y - sweepY) * (vP.y - sweepY) * 60.0) * 0.28;
    // ---- the impact ----
    float hitAge = uHit.z;
    float hd = length(vP - uHit.xy);
    float wave = exp(-pow(hd - hitAge * 3.2, 2.0) * 34.0) * exp(-hitAge * 4.5) * 2.2;
    float hitGlow = exp(-hd * hd * 8.0) * exp(-hitAge * 7.0) * 1.6;
    float hit = (wave + hitGlow) * step(0.0, hitAge) * (1.0 - step(1.2, hitAge));
    // ---- forming wipe: rim first, then the lattice from the boss out ----
    float formed = smoothstep(r - 0.12, r + 0.12, uForm * 1.35);
    float rimOn = smoothstep(0.0, 0.25, uForm);
    float lines = (ring1 + ring2 + ring3 + spokes + ticks + sun) * formed;
    float fill = (0.06 + 0.05 * (1.0 - r)) * formed;
    float lum = (rim * rimOn + lines + sweep * formed + fill) * (0.7 + fres * 0.6)
      + hit * fres * 0.6 + hit * 0.7;
    lum *= 1.0 + uPulse * 0.55;
    vec3 c = mix(uColour, uAccent, clamp(rim * 0.35 + sun * 0.4 + hit * 0.5 + uPerfect, 0.0, 1.0));
    float peak = max(c.r, max(c.g, c.b));
    float gain = (0.9 + uPerfect * 1.4) / max(0.55, peak);
    gl_FragColor = vec4(c * lum * gain, 1.0);
  }
`;

const DOME_VERT = /* glsl */`
  varying vec3 vNrm;
  varying vec3 vView;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    vNrm = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`;

/* A cathedral dome, not a wireframe globe: a fresnel rim, twelve ribs
   meeting at the crown, three courses, a band that climbs it as it
   forms, a bright foot on the sand, and a ripple that runs over the
   surface from wherever it was struck. */
const DOME_FRAG = /* glsl */`
  uniform vec3 uColour;
  uniform vec3 uAccent;
  uniform vec3 uFoot;
  uniform float uTime;
  uniform float uForm;
  uniform float uPulse;
  uniform vec4 uHit;
  varying vec3 vNrm;
  varying vec3 vView;
  varying vec3 vLocal;
  float band(float x, float at, float w) { return 1.0 - smoothstep(0.0, w, abs(x - at)); }
  void main() {
    float nv = abs(dot(normalize(vNrm), normalize(vView)));
    float fres = pow(1.0 - nv, 2.6);
    vec3 p = normalize(vLocal + vec3(0.0, 1e-5, 0.0));
    float lat = asin(clamp(p.y, -1.0, 1.0));
    float lon = atan(p.z, p.x);
    // Ribs and courses. The ribs fade before the crown, where longitude
    // is undefined and every line would otherwise converge to a burst.
    float ribs = pow(abs(cos(lon * 6.0)), 70.0) * (1.0 - smoothstep(0.70, 0.96, p.y)) * 0.75;
    float courses = (band(p.y, 0.30, 0.012) + band(p.y, 0.58, 0.010) + band(p.y, 0.82, 0.010)) * 0.6;
    // Small ticks turning around the lowest course.
    float ticks = pow(abs(cos(lon * 18.0 - uTime * 0.5)), 30.0) * band(p.y, 0.30, 0.05) * 0.5;
    // Crown: a small sun.
    float crown = exp(-(1.0 - p.y) * 40.0) * 1.2;
    // The forming band climbs once, in the first third of the pose.
    float wave = 1.0 - smoothstep(0.0, 0.14, abs(p.y - uForm * 1.15));
    float formed = step(p.y, uForm * 1.15 + 0.02);
    // The foot on the sand: brightest, and gold.
    float foot = pow(1.0 - clamp(p.y, 0.0, 1.0), 9.0);
    // Impact ripple, as an angle over the sphere from the hit direction.
    vec3 hd = normalize(uHit.xyz + vec3(1e-5));
    float ang = acos(clamp(dot(p, hd), -1.0, 1.0));
    float age = uHit.w;
    float ripple = exp(-pow(ang - age * 3.0, 2.0) * 60.0) * exp(-age * 3.8) * 1.6
      + exp(-ang * ang * 30.0) * exp(-age * 6.0) * 1.2;
    ripple *= step(0.0, age) * (1.0 - step(1.4, age));
    float lum = (fres * 0.85 + (ribs + courses + ticks) * (0.35 + fres * 0.9) + crown * 0.5) * formed
      + wave * 0.9 + foot * 0.9 + ripple * (0.5 + fres * 0.5) + 0.03 * formed;
    lum *= 1.0 + uPulse * 0.5;
    vec3 c = mix(uColour, uAccent, clamp(fres * 0.4 + wave * 0.6 + ripple * 0.5 + crown * 0.4, 0.0, 1.0));
    c = mix(c, uFoot, clamp(foot * 1.4, 0.0, 1.0));
    float peak = max(c.r, max(c.g, c.b));
    gl_FragColor = vec4(c * lum * 0.85 / max(0.55, peak), 1.0);
  }
`;

function buildVisual(ctx) {
  const { THREE, scene } = ctx;
  const root = new THREE.Group();
  root.name = "aegis-shield-root";
  root.userData.equipment = "aegis-shield";
  root.visible = false;

  const geometry = makeShieldShape(THREE);
  const surfaceMaterial = new THREE.ShaderMaterial({
    name: "aegis-energy-surface",
    uniforms: {
      uColour: { value: new THREE.Color(0xffb52f) },
      uAccent: { value: new THREE.Color(0xfff2cf) },
      uTime: { value: 0 },
      uForm: { value: 0 },
      uPulse: { value: 0 },
      uHit: { value: new THREE.Vector3(0, 0, -9) },
      uPerfect: { value: 0 },
      uEdgeA: { value: PLATE_OUTLINE.map(([x, y]) => new THREE.Vector2(x, y)) },
      uEdgeB: { value: PLATE_OUTLINE.map((_, i) => {
        const [x, y] = PLATE_OUTLINE[(i + 1) % PLATE_OUTLINE.length];
        return new THREE.Vector2(x, y);
      }) },
    },
    vertexShader: PLATE_VERT,
    fragmentShader: PLATE_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    blending: THREE.AdditiveBlending,
    toneMapped: true,
  });
  surfaceMaterial.customProgramCacheKey = () => "sf-aegis-plate";
  const surface = new THREE.Mesh(geometry, surfaceMaterial);
  surface.name = "aegis-energy-plane";
  surface.renderOrder = 8;
  surface.frustumCulled = false;
  root.add(surface);

  /* THE LIGHT HANGS OFF THE SCENE, NOT OFF THE PLATE.
     three keys every material's compiled program on the NUMBER of
     lights it can see, so a point light that appears when the plate
     is revealed takes the visible count from 15 to 16 and invalidates
     the program of every material in the level at once. Measured:
     30 shaders recompiling inside the single frame the player raised
     the Aegis - a 198ms freeze on the exact input pressed to survive
     something.

     Parented to the scene it is always counted, so the count never
     changes and nothing ever recompiles. It contributes nothing while
     idle because `updateVisual` holds its intensity at zero, and it
     is driven to the plate's world position when the plate is up. */
  const light = new THREE.PointLight(0xffb43d, 0, 3.8, 2);
  light.name = "aegis-gold-light";
  scene.add(light);

  scene.add(root);

  /* Seraph Aegis is not a larger flat plate. Its silhouette has to
     communicate the mechanical change from a forward guard to true
     all-round cover, even when the camera is behind the player. Keep
     it as a separate world-space visual so the ordinary plate can
     crossfade without inheriting the dome's scale or orientation. */
  const domeRoot = new THREE.Group();
  domeRoot.name = "seraph-aegis-dome-root";
  domeRoot.userData.equipment = "seraph-aegis";
  domeRoot.visible = false;

  const domeGeometry = new THREE.SphereGeometry(
    SHIELD_CONFIG.domeRadius, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.52
  );
  const domeMaterial = new THREE.ShaderMaterial({
    name: "seraph-aegis-surface",
    uniforms: {
      uColour: { value: new THREE.Color(0x9fc9ff) },
      uAccent: { value: new THREE.Color(0xf4f8ff) },
      uFoot: { value: new THREE.Color(0xffd978) },
      uTime: { value: 0 },
      uForm: { value: 0 },
      uPulse: { value: 0 },
      uHit: { value: new THREE.Vector4(0, 1, 0, -9) },
    },
    vertexShader: DOME_VERT,
    fragmentShader: DOME_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    blending: THREE.AdditiveBlending,
    toneMapped: true,
  });
  domeMaterial.customProgramCacheKey = () => "sf-aegis-dome";
  const domeSurface = new THREE.Mesh(domeGeometry, domeMaterial);
  domeSurface.name = "seraph-aegis-surface";
  domeSurface.renderOrder = 7;
  domeSurface.frustumCulled = false;
  domeRoot.add(domeSurface);

  // Scene-parented for the same reason as the gold light above: a
  // stable light count is what keeps the dome from costing a second
  // full shader recompile the first time it forms.
  const domeLight = new THREE.PointLight(0x83d8ff, 0, 7.5, 2);
  domeLight.name = "seraph-aegis-light";
  scene.add(domeLight);
  scene.add(domeRoot);

  return {
    root,
    surface,
    light,
    domeRoot,
    domeSurface,
    domeLight,
    materials: { surface: surfaceMaterial, dome: domeMaterial },
  };
}

export function buildShield(ctx, player) {
  const config = SHIELD_CONFIG;
  const visual = buildVisual(ctx);
  const state = {
    requested: false,
    active: false,
    needsRelease: false,
    pose: 0,
    impact: 0,
    activeFor: 0,
    lastDrain: 0,
    drainMultiplier: 1,
    moveSpeed: config.moveSpeed,
    movementLocked: false,
    omniDirectional: false,
    mode: "plate",
    dome: false,
    domePose: 0,
    modifierSource: "",
    blocks: 0,
    absorbed: 0,
    sessionBlocks: 0,
    sessionAbsorbed: 0,
    lastAmount: 0,
    lastBlock: null,
    lastRelease: null,
    lastReason: "ready",
    // Where the last blow landed, in plate space, and how long ago;
    // drives the ripple across the surface.
    hitX: 0, hitY: 0, hitAge: -9, hitDirX: 0, hitDirY: 1, hitDirZ: 0,
    perfectGlow: 0,
  };

  function reset(full = true) {
    /* Both keyboard and touch share the same software-gated state. A touch
       guard held through respawn/load must be released before it can raise
       Aegis again, exactly like a physically held block key. */
    const keys = player.input?.keys;
    const held = !!player.input?.state?.block || (!!keys && keybindDown(keys, "block"));
    state.requested = false;
    state.active = false;
    state.needsRelease = held;
    state.pose = 0;
    state.impact = 0;
    state.activeFor = 0;
    state.lastDrain = 0;
    state.drainMultiplier = 1;
    state.moveSpeed = config.moveSpeed;
    state.movementLocked = false;
    state.omniDirectional = false;
    state.mode = "plate";
    state.dome = false;
    state.domePose = 0;
    state.modifierSource = "";
    state.sessionBlocks = 0;
    state.sessionAbsorbed = 0;
    state.lastAmount = 0;
    state.lastBlock = null;
    state.lastRelease = null;
    state.lastReason = "ready";
    if (full) {
      state.blocks = 0;
      state.absorbed = 0;
    }
    state.hitAge = -9;
    state.perfectGlow = 0;
    visual.root.visible = false;
    visual.domeRoot.visible = false;
    // Scene-parented lights are not carried down by those flags.
    visual.light.intensity = 0;
    visual.domeLight.intensity = 0;
  }

  function blockedReason(playerState) {
    if (ctx.combat?.player?.dead) return "dead";
    if (state.needsRelease) return "release";
    if (playerState.free) return "free-camera";
    if (!playerState.grounded || ctx.jetpack?.state?.inFlight) return "airborne";
    if (ctx.boost?.state?.active) return "boosting";
    if (player.action || ctx.mission?.entry?.active || (ctx.weapons?.carry?.venting || 0) > 0) {
      return "busy";
    }
    if ((ctx.jetpack?.state?.fuel || 0) <= 1e-6) return "low-charge";
    if ((ctx.jetpack?.state?.cooldownRemaining || 0) > 0) return "cooldown";
    return "";
  }

  /** Called before jet ignition so a held shield owns the shared pack this frame. */
  function beginFrame(dt, playerState, inputState) {
    const wasActive = state.active;
    const previousActiveFor = state.activeFor;
    const previousMode = state.mode;
    const previousDome = state.dome;
    state.requested = !!inputState.block;
    if (!state.requested) state.needsRelease = false;
    state.impact = damp(state.impact, 0, 9, dt);
    const reason = state.requested ? blockedReason(playerState) : "released";
    state.active = false;
    state.lastDrain = 0;
    state.drainMultiplier = 1;
    state.moveSpeed = config.moveSpeed;
    state.movementLocked = false;
    state.omniDirectional = false;
    state.mode = "plate";
    state.dome = false;
    state.modifierSource = "";

    if (state.requested && !reason) {
      const movementInput = Math.hypot(
        Number(inputState?.move?.x) || 0,
        Number(inputState?.move?.y) || 0
      );
      const request = {
        dt,
        requested: true,
        wasActive,
        activeFor: previousActiveFor,
        playerX: playerState.x,
        playerY: playerState.y,
        playerZ: playerState.z,
        yaw: playerState.yaw,
        speed: Math.max(0, Number(playerState.speed) || 0),
        stationary: movementInput < 0.08 && Math.abs(Number(playerState.speed) || 0) < 0.2,
        movementInput,
        baseDrainRate: config.drainRate,
        baseMoveSpeed: config.moveSpeed,
        missionChanneling: !!ctx.mission?.state?.channelling,
      };
      const changed = ctx.progression?.modifyShieldFrame?.(request);
      if (changed && typeof changed === "object") {
        const drainMultiplier = Number(changed.drainMultiplier);
        if (Number.isFinite(drainMultiplier)) {
          state.drainMultiplier = Math.max(0.1, Math.min(4, drainMultiplier));
        }
        const moveSpeed = Number(changed.moveSpeed);
        if (Number.isFinite(moveSpeed)) {
          state.moveSpeed = Math.max(0, Math.min(config.moveSpeed, moveSpeed));
        }
        state.movementLocked = changed.movementLocked === true;
        state.omniDirectional = changed.omniDirectional === true;
        state.dome = changed.dome === true;
        state.mode = state.dome ? "dome" : "plate";
        state.modifierSource = typeof changed.source === "string"
          ? changed.source.slice(0, 48) : "";
      }
      if (state.movementLocked) state.moveSpeed = 0;
      if (state.dome) state.omniDirectional = true;

      const wanted = config.drainRate * state.drainMultiplier * dt;
      const used = ctx.jetpack?.drain?.(wanted) || 0;
      state.lastDrain = used;
      state.active = used > 1e-6;
      if (used + 1e-6 < wanted || (ctx.jetpack?.state?.fuel || 0) <= 1e-6) {
        state.needsRelease = true;
      }
      state.lastReason = state.active ? "blocking" : "low-charge";
    } else {
      state.lastReason = reason || "ready";
    }

    if (state.active) {
      if (!wasActive) {
        state.sessionBlocks = 0;
        state.sessionAbsorbed = 0;
      }
      state.activeFor = wasActive ? previousActiveFor + dt : dt;
    } else {
      state.activeFor = 0;
      if (wasActive) {
        const ps = player.state;
        const payload = {
          reason: state.lastReason,
          releasedByInput: !state.requested,
          activeFor: previousActiveFor,
          mode: previousMode,
          dome: previousDome,
          blocks: state.sessionBlocks,
          absorbed: state.sessionAbsorbed,
          lastBlock: state.lastBlock,
          x: ps.x,
          y: ps.y,
          z: ps.z,
          yaw: ps.yaw,
        };
        state.lastRelease = payload;
        ctx.progression?.onShieldRelease?.(payload);
      }
    }

    state.pose = damp(state.pose, state.active ? 1 : 0, state.active ? 22 : 15, dt);
    state.domePose = damp(state.domePose, state.active && state.dome ? 1 : 0,
      state.active && state.dome ? 10 : 13, dt);
    return state;
  }

  /**
   * Defend only the arc covered by the visible plate. The source must
   * be explicit: falls, scripted hazards and other source-less damage
   * do not become accidentally blockable just because X is held.
   */
  function blocksFrom(sourceX, sourceZ) {
    if (!state.active || !Number.isFinite(sourceX) || !Number.isFinite(sourceZ)) return false;
    const ps = player.state;
    const dx = sourceX - ps.x;
    const dz = sourceZ - ps.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-5) return false;
    if (state.omniDirectional) return true;
    const dot = (dx * Math.sin(ps.yaw) + dz * Math.cos(ps.yaw)) / distance;
    return dot >= config.frontDot;
  }

  function tryBlock(amount, detail = {}) {
    if (!(amount > 0) || !blocksFrom(detail.x, detail.z)) return false;
    const elapsedSeconds = Math.max(0, state.activeFor);
    const perfect = elapsedSeconds <= config.perfectWindow;
    const timing = {
      elapsedSeconds,
      elapsedMs: elapsedSeconds * 1000,
      windowSeconds: config.perfectWindow,
      windowMs: config.perfectWindow * 1000,
    };
    state.blocks += 1;
    state.absorbed += amount;
    state.sessionBlocks += 1;
    state.sessionAbsorbed += amount;
    state.lastAmount = amount;
    state.lastReason = "absorbed";
    state.impact = 1;
    const ps = player.state;
    const fx = ps.x + Math.sin(ps.yaw) * config.distance;
    const fz = ps.z + Math.cos(ps.yaw) * config.distance;
    /* Where on the plate. The blow's bearing relative to the facing
       gives a plate-space X; its height gives Y. The ripple starts
       there rather than at the boss, so a blow from the left is seen
       to land on the left. */
    {
      const dx = detail.x - ps.x;
      const dz = detail.z - ps.z;
      const L = Math.hypot(dx, dz) || 1;
      const lx = (dx / L) * Math.cos(ps.yaw) - (dz / L) * Math.sin(ps.yaw);
      const sy = Number.isFinite(detail.y) ? detail.y : ps.y + config.centreY;
      state.hitX = Math.max(-0.75, Math.min(0.75, lx * 0.9));
      state.hitY = Math.max(-0.85, Math.min(0.85, sy - (ps.y + config.centreY)));
      state.hitDirX = dx / L;
      state.hitDirY = Math.max(0.05, Math.min(0.9, (sy - ps.y) / Math.max(1, L)));
      state.hitDirZ = dz / L;
      state.hitAge = 0;
      if (perfect) state.perfectGlow = 1;
    }
    const nx = Math.sin(ps.yaw);
    const nz = Math.cos(ps.yaw);
    if (ctx.vfx?.shieldBlock) {
      ctx.vfx.shieldBlock(fx + nx * 0.05, ps.y + config.centreY + state.hitY * 0.6,
        fz + nz * 0.05, nx, nz, perfect, amount, state.dome);
    } else {
      ctx.vfx?.spark?.(fx, ps.y + config.centreY, fz, 1.18 + clamp01(amount / 70) * 0.54);
    }
    const payload = {
      source: detail.source || "attack",
      enemyId: typeof detail.enemyId === "string" ? detail.enemyId : "",
      enemyKey: detail.enemyKey || detail.enemy || "",
      amount,
      absorbed: amount,
      perfect,
      timing,
      chargeSpent: state.lastDrain,
      blockIndex: state.blocks,
      x: detail.x,
      y: detail.y,
      z: detail.z,
      playerX: ps.x,
      playerY: ps.y,
      playerZ: ps.z,
      yaw: ps.yaw,
      mode: state.mode,
      dome: state.dome,
      sessionBlocks: state.sessionBlocks,
      sessionAbsorbed: state.sessionAbsorbed,
    };
    state.lastBlock = payload;
    ctx.progression?.onShieldBlock?.(payload);
    if (perfect) ctx.progression?.noteVerb?.("perfectGuard", payload);
    return true;
  }

  function updateVisual(dt) {
    /* On entry the plate folds into the dome. On release, suppress it
       until the dome has faded: independently damping both poses can
       otherwise reveal the ordinary front plate for two or three frames
       after an all-round guard is dropped. */
    const p = (!state.active && state.domePose > 0.01)
      ? 0 : state.pose * (1 - state.domePose);
    const root = visual.root;
    root.visible = p > 0.008;
    const ps = player.state;
    const pulse = state.impact;
    const clock = ps.clock || 0;
    const shimmer = 0.5 + 0.5 * Math.sin(clock * 15.5);
    if (state.hitAge >= 0) state.hitAge += dt;
    state.perfectGlow = damp(state.perfectGlow, 0, 5, dt);
    if (root.visible) {
      root.position.set(
        ps.x + Math.sin(ps.yaw) * config.distance,
        ps.y + config.centreY,
        ps.z + Math.cos(ps.yaw) * config.distance
      );
      root.rotation.y = ps.yaw;
      root.scale.set(
        p * (0.94 + shimmer * 0.02 + pulse * 0.06),
        p * (0.90 + (1 - p) * 0.12 + pulse * 0.04),
        1
      );
      const u = visual.materials.surface.uniforms;
      u.uTime.value = clock;
      u.uForm.value = p;
      u.uPulse.value = pulse;
      u.uHit.value.set(state.hitX, state.hitY, state.hitAge);
      u.uPerfect.value = state.perfectGlow;
      /* The light is a sibling of the plate now, so it carries its own
         world placement - the 0.22m stand-off that used to be a local
         offset inside `root` has to be applied here. */
      visual.light.position.set(
        root.position.x - Math.sin(ps.yaw) * 0.22,
        root.position.y,
        root.position.z - Math.cos(ps.yaw) * 0.22
      );
      visual.light.intensity = p * (0.42 + shimmer * 0.18 + pulse * 1.15 + state.perfectGlow * 1.2);
      root.userData.active = state.active;
      root.userData.pose = Number(p.toFixed(3));
      root.userData.impact = Number(pulse.toFixed(3));
    } else {
      /* The light no longer hides with the plate, so lowering it is
         now this function's job - a scene-parented light left at its
         last intensity is a gold glow following the player around
         with no shield under it. */
      visual.light.intensity = 0;
    }

    const domeP = state.domePose;
    const domeRoot = visual.domeRoot;
    domeRoot.visible = domeP > 0.008;
    if (domeRoot.visible) {
      domeRoot.position.set(ps.x, ps.y + 0.035, ps.z);
      const breathing = 0.992 + shimmer * 0.008 + pulse * 0.018;
      // The dome forms at full size and is drawn on by the band; it
      // does not inflate like a balloon.
      domeRoot.scale.setScalar(Math.max(0.05, 0.85 + domeP * 0.15) * breathing);
      const u = visual.materials.dome.uniforms;
      u.uTime.value = clock;
      u.uForm.value = domeP;
      u.uPulse.value = pulse;
      u.uHit.value.set(state.hitDirX, state.hitDirY, state.hitDirZ, state.hitAge);
      visual.domeLight.position.set(ps.x, ps.y + 0.035 + 1.15, ps.z);
      visual.domeLight.intensity = domeP * (0.70 + shimmer * 0.28 + pulse * 1.35);
      domeRoot.userData.active = state.active && state.dome;
      domeRoot.userData.pose = Number(domeP.toFixed(3));
      domeRoot.userData.impact = Number(pulse.toFixed(3));
    } else {
      visual.domeLight.intensity = 0;
    }
  }

  function status() {
    return {
      requested: state.requested,
      active: state.active,
      needsRelease: state.needsRelease,
      pose: Number(state.pose.toFixed(3)),
      impact: Number(state.impact.toFixed(3)),
      activeFor: Number(state.activeFor.toFixed(3)),
      mode: state.mode,
      dome: state.dome,
      domePose: Number(state.domePose.toFixed(3)),
      movementLocked: state.movementLocked,
      omniDirectional: state.omniDirectional,
      moveSpeed: Number(state.moveSpeed.toFixed(3)),
      drainMultiplier: Number(state.drainMultiplier.toFixed(3)),
      modifierSource: state.modifierSource,
      blocks: state.blocks,
      absorbed: Number(state.absorbed.toFixed(2)),
      sessionBlocks: state.sessionBlocks,
      sessionAbsorbed: Number(state.sessionAbsorbed.toFixed(2)),
      lastAmount: Number(state.lastAmount.toFixed(2)),
      lastPerfect: !!state.lastBlock?.perfect,
      lastTimingMs: Number((state.lastBlock?.timing?.elapsedMs || 0).toFixed(2)),
      lastReason: state.lastReason,
      drainRate: config.drainRate,
      baseMoveSpeed: config.moveSpeed,
      frontDot: config.frontDot,
      perfectWindow: config.perfectWindow,
      domeRadius: config.domeRadius,
    };
  }

  return {
    config,
    state,
    visual,
    beginFrame,
    blocksFrom,
    tryBlock,
    lastBlock: () => state.lastBlock,
    lastRelease: () => state.lastRelease,
    updateVisual,
    reset,
    status,
  };
}
