/* ============================================================
   APOP DEMON MOGGERS 3D - material library

   Two jobs. First, wrap the synthesised texture sets from
   textures.js into a small, shared set of surface materials that
   world.js can ask for by name. Second - and this is the part that
   decides whether a frame reads as Super Mario 64 or as a Three.js
   sample - own the shading model.

   ------------------------------------------------------------
   WHY A CEL/PBR HYBRID RATHER THAN TOON SHADING

   SM64 reads as bright, saturated, high contrast and above all
   READABLE. The instinct is to reach for flat toon shading, and it is
   the wrong instinct: flat toon throws away shadows, image-based
   lighting and every specular cue, and a 2026 frame without those
   loses the blind comparison for looking cheap rather than for looking
   stylised.

   So everything here is a real MeshStandardMaterial - real PBR
   response, real shadows, real env light - patched through
   onBeforeCompile with three additions:

   1. A BANDED DIFFUSE RAMP. The key light's diffuse contribution is
      re-ramped through a 3-4 step curve with soft transitions. Note
      "re-ramped", not "recomputed": reflectedLight.directDiffuse
      already carries the shadow term, so we scale it in place by the
      ratio between the banded and the linear response. Recomputing
      N dot L ourselves would look identical in the open and would
      silently discard every shadow in the game.

   2. A COLOURED BOUNCE TERM. Warm from the ground-facing hemisphere,
      cool-violet from the sky. CONTRACT §2 lists grey ambient as a
      known tell and it is the most expensive one to fix late, because
      it is not one object that looks wrong - it is that nothing in
      frame looks like it is standing in a place. SM64's shadows are
      blue-violet and its bounce is peach; that single relationship is
      most of its charm. Nothing here is ever lit with neutral grey.

   3. A RIM / FRESNEL TERM. A thin light along the silhouette edge.
      This is what separates Moggadonna from a busy background at
      distance, and it is why her outline still reads when she is a
      hundred pixels tall.

   ------------------------------------------------------------
   WHY LEVEL SURFACES PROJECT FROM WORLD SPACE

   world.js builds courses out of boxes, slopes and platforms on a 2 m
   grid. Default box UVs run 0..1 across a face whatever its size, so a
   20 m floor and a 2 m step would show the same texture at ten times
   the scale, and every author would have to hand-fix repeats forever.

   Instead the vertex shader overwrites the map UVs with a world-space
   planar projection, choosing the plane from the dominant axis of the
   world normal. On axis-aligned geometry - which is what this game is
   made of - that is exact, costs one texture sample, and makes texture
   scale a property of the material rather than of whoever built the
   mesh. It is approximate on anything steeper than 45 degrees or
   smoothly curved; those surfaces ask for project:"uv" and bring their
   own UVs. Because the projection carries the scale, textures keep
   repeat = 1 and can be shared between materials without cloning.
   ============================================================ */

import { clamp, clamp01, damp } from "apop3d/core.js";

/* Art-direction defaults.

   The bounce pair is the single most load-bearing constant in the
   file. Warm below (light coming back off a lit floor), cool violet
   above (sky). Read them as a RATIO rather than as absolute values -
   what matters is that the shadow side never goes grey. */
const BOUNCE_DOWN = 0x2a1a12;   // warm floor bounce, hits down-facing normals
const BOUNCE_UP = 0x161a30;     // cool-violet sky fill, hits up-facing normals
const RIM_COLOR = 0xbfd4ff;

const CEL_STEPS = 4;
const CEL_SOFT = 0.16;          // 0 = hard staircase, 0.5 = no banding at all
const CEL_BIAS = 0.85;          // <1 pushes the terminator toward the light

const MACRO_METRES = 41;        // world period of the breakup layer

/**
 * The named level surfaces world.js asks for.
 *
 * `metres` is how much world space one texture tile covers, which is
 * the only scale knob that exists for a projected surface. Deliberately
 * NOT a multiple of the 2 m level grid: a texture whose period divides
 * the grid resonates with it and produces exactly the corduroy the
 * projection was meant to avoid.
 */
const SURFACES = {
  /* NOTE: this table must not define a name that levels.js also paints.
     levels.js `makeSurfaces().get()` asks here FIRST and takes whatever
     comes back, so any overlap silently wins and the levels.js entry
     becomes dead code that still reads as authored intent. Six
     foodcourt/carpet names were removed for exactly that reason: the
     24m x 128m perimeter wall was rendering as pale cream (luma ~212)
     from this file while the level's own plan asked for a plum-indigo
     far wall at 30-45, and no amount of editing levels.js could move it.
     Same class as the `surface() returns null` handoff below, one layer
     deeper: materials.js owns the shading MODEL, levels.js owns the
     level surface VOCABULARY. */

  /* ---- Course 1: The Mall Food Court ---- */

  /* ---- Course 2: The Awards-Show Red Carpet ---- */

  /* ---- Course 3: The Streaming Farm Basement ---- */
  "basement.concrete": {
    texture: "concrete", opts: { base: 0x82808a, joints: 2 },
    metres: 3.3, roughness: 1, metalness: 1, normalScale: 1.0, ao: 1.0, macro: 0.70,
  },
  "basement.rack": {
    texture: "metalPanel", opts: { painted: true, paint: 0x22262e, panelsX: 1, panelsY: 5, rivets: 8 },
    metres: 1.7, roughness: 1, metalness: 1, normalScale: 1.1, ao: 1.0, macro: 0.25,
  },
  "basement.cable": {
    texture: "plastic", opts: { base: 0x1a1c22, gloss: 0.42, seam: 0.5 },
    project: "uv", repeat: [8, 1], roughness: 1, metalness: 1, normalScale: 0.9, ao: 0.8, macro: 0,
  },
  "parking.asphalt": {
    // The painted line is off by default: it lives in the texture, so
    // it repeats with it, and a bay line every 4.2 m across a whole car
    // park reads as wallpaper. world.js should paint bays as decals, or
    // opt in per mesh with surface("parking.asphalt", { opts: { line: 0.5 } }).
    texture: "asphalt", opts: { line: 0 },
    metres: 4.2, roughness: 1, metalness: 1, normalScale: 1.0, ao: 0.9, macro: 0.70,
  },

  /* ---- Course 4: Influencer Rooftop Afterparty ---- */
  "rooftop.deck": {
    texture: "woodStage", opts: { light: 0xa8845a, dark: 0x6a5236, rows: 7 },
    metres: 2.5, roughness: 1, metalness: 1, normalScale: 1.0, ao: 0.95, macro: 0.55,
  },
  "rooftop.hvac": {
    texture: "metalPanel", opts: { painted: true, paint: 0x8d9198, panelsX: 2, panelsY: 2, rivets: 5 },
    metres: 1.9, roughness: 1, metalness: 1, normalScale: 1.0, ao: 1.0, macro: 0.30,
  },
  "rooftop.glass": {
    texture: "glass", opts: { tint: 0xb7d2dd, opacity: 0.20 },
    metres: 3.1, roughness: 1, metalness: 1, normalScale: 0.8, ao: 0.4, macro: 0.15,
    transparent: true, depthWrite: false, side: "double", cel: 0.25, rim: 0.5,
  },

  /* ---- Course 5: Boyz II Hell - Final Livestream ---- */
  "stage.wood": {
    texture: "woodStage", opts: { painted: true, paint: 0x131318, rows: 6 },
    metres: 2.5, roughness: 1, metalness: 1, normalScale: 1.0, ao: 1.0, macro: 0.45,
  },
  "stage.truss": {
    texture: "metalPanel", opts: { metal: 0xb9bec6, panelsX: 1, panelsY: 4, rivets: 4 },
    metres: 1.2, roughness: 1, metalness: 1, normalScale: 1.1, ao: 1.0, macro: 0.20,
  },
  "stage.led": {
    texture: "screenPanel", opts: { pixels: 64, cabinets: 2, content: "bars" },
    metres: 3.2, roughness: 1, metalness: 1, normalScale: 0.6, ao: 0.5, macro: 0,
    emissive: 0xffffff, emissiveIntensity: 2.4, beatReact: 0.55, cel: 0.2, rim: 0.2,
  },

  /* ---- Neon. Signs are quads with their own UVs. ---- */
  "neon.pink": {
    texture: "neonSign", opts: { text: "MOG", color: 0xff3ea5 },
    project: "uv", repeat: [1, 1], roughness: 1, metalness: 1, normalScale: 1.0, ao: 0.6, macro: 0,
    emissive: 0xffffff, emissiveIntensity: 3.0, beatReact: 0.85,
    alphaTest: 0.32, cel: 0.15, rim: 0.35,
  },
  "neon.cyan": {
    texture: "neonSign", opts: { text: "LIVE", color: 0x2ce8ff },
    project: "uv", repeat: [1, 1], roughness: 1, metalness: 1, normalScale: 1.0, ao: 0.6, macro: 0,
    emissive: 0xffffff, emissiveIntensity: 3.0, beatReact: 0.85,
    alphaTest: 0.32, cel: 0.15, rim: 0.35,
  },
  "neon.gold": {
    texture: "neonSign", opts: { text: "PLATINUM", color: 0xffc85a },
    project: "uv", repeat: [1, 1], roughness: 1, metalness: 1, normalScale: 1.0, ao: 0.6, macro: 0,
    emissive: 0xffffff, emissiveIntensity: 2.8, beatReact: 0.7,
    alphaTest: 0.32, cel: 0.15, rim: 0.35,
  },

  /* ---- Shared props ---- */
  "metal.chrome": {
    texture: "metalPanel", opts: { seams: false, rivets: 0, metal: 0xe6eaef },
    metres: 1.6, roughness: 0.22, metalness: 1, normalScale: 0.5, ao: 0.6, macro: 0.15,
    envMapIntensity: 1.4, cel: 0.3,
  },
  "water.pool": {
    texture: "water", opts: { shallow: 0x3fb0ce, deep: 0x0f4467 },
    metres: 4.4, roughness: 1, metalness: 1, normalScale: 0.7, ao: 0.3, macro: 0.25,
    transparent: true, depthWrite: false, side: "double", cel: 0.2, rim: 0.7,
    envMapIntensity: 1.5,
  },
  "glass.window": {
    texture: "glass", opts: { tint: 0xc6dbe2, opacity: 0.18 },
    metres: 3.3, roughness: 1, metalness: 1, normalScale: 0.8, ao: 0.4, macro: 0.15,
    transparent: true, depthWrite: false, side: "double", cel: 0.25, rim: 0.6,
  },
  "crowd.board": {
    texture: "crowdBoard", opts: { cols: 4, rows: 4 },
    project: "uv", repeat: [1, 1], roughness: 1, metalness: 1, normalScale: 0.8, ao: 0.9, macro: 0,
    emissive: 0xffffff, emissiveIntensity: 1.6, beatReact: 0.5,
    alphaTest: 0.5, side: "double", cel: 0.7, rim: 0.55,
  },
  "record.platinum": {
    texture: "foil", opts: { mode: "platinum" },
    project: "uv", repeat: [1, 1], roughness: 1, metalness: 1, normalScale: 0.9, ao: 0.7, macro: 0,
    // The generator writes alpha 0 outside the disc so a plain quad can
    // carry it; without the alpha test that becomes an opaque square
    // with a record painted on it.
    side: "double", alphaTest: 0.5, envMapIntensity: 1.6, cel: 0.35, rim: 0.9,
  },
  "sleeve.foil": {
    texture: "foil", opts: { mode: "sleeve" },
    project: "uv", repeat: [1, 1], roughness: 1, metalness: 1, normalScale: 1.0, ao: 0.9, macro: 0,
    envMapIntensity: 1.3, cel: 0.5,
  },
  "hub.grass": {
    texture: "grass", opts: {},
    metres: 3.0, roughness: 1, metalness: 1, normalScale: 1.1, ao: 1.0, macro: 0.75,
  },
};

export function create(ctx) {
  const THREE = ctx.THREE;
  const cache = new Map();
  const registry = [];          // every material, for dispose and global tweaks
  const custom = new Map();     // register(name, factory)
  const beatList = [];
  const waterList = [];         // liquids whose ripple clock we drive
  const warned = new Set();
  let disposed = false;
  /* Kept apart from the live uniform so setSheenEnabled(false) can be
     undone without the caller having to remember the course's number. */
  let sheenAuthoredGain = 0;

  /* Shared uniforms. Every cel material references THESE OBJECTS, not
     copies, so sky.js changing the bounce for a course is one write
     rather than a walk of the scene graph. */
  const shared = {
    uKeyLum: { value: 2.6 },
    uBounceDown: { value: new THREE.Color(BOUNCE_DOWN) },
    uBounceUp: { value: new THREE.Color(BOUNCE_UP) },
    uRimColor: { value: new THREE.Color(RIM_COLOR) },
    uEnvFake: { value: 3.0 },
    uCelSteps: { value: CEL_STEPS },
    uCelSoft: { value: CEL_SOFT },
    uCelBias: { value: CEL_BIAS },
    uMacroMap: { value: null },
    uMacroScale: { value: 1 / MACRO_METRES },
  };

  function macroTexture() {
    if (shared.uMacroMap.value) return shared.uMacroMap.value;
    const set = ctx.textures && typeof ctx.textures.macro === "function" ? ctx.textures.macro() : null;
    if (set && set.map) shared.uMacroMap.value = set.map;
    return shared.uMacroMap.value;
  }

  /* ------------------------------------------------------------
     The shader patch
     ------------------------------------------------------------ */

  /** World-space planar projection, chosen per-vertex from the
   *  dominant axis of the world normal. Exact on axis-aligned faces;
   *  see the header for where it is not. */
  function projectionBody(mode) {
    if (mode === "xz") {
      return "  return wp.xz * uProjScale;";
    }
    return [
      "  vec3 a = abs( wn );",
      "  if ( a.y >= a.x && a.y >= a.z ) return wp.xz * uProjScale;",
      "  if ( a.x >= a.z ) return vec2( wp.z, -wp.y ) * uProjScale;",
      "  return vec2( wp.x, -wp.y ) * uProjScale;",
    ].join("\n");
  }

  const UV_TARGETS = [
    ["USE_MAP", "vMapUv", "mapTransform"],
    ["USE_NORMALMAP", "vNormalMapUv", "normalMapTransform"],
    ["USE_ROUGHNESSMAP", "vRoughnessMapUv", "roughnessMapTransform"],
    ["USE_METALNESSMAP", "vMetalnessMapUv", "metalnessMapTransform"],
    ["USE_AOMAP", "vAoMapUv", "aoMapTransform"],
    ["USE_EMISSIVEMAP", "vEmissiveMapUv", "emissiveMapTransform"],
    ["USE_ALPHAMAP", "vAlphaMapUv", "alphaMapTransform"],
  ];

  /**
   * Patch a standard material into the cel/PBR hybrid.
   *
   * cfg: { project, macro, cel, rim, rimPower, metres }
   *
   * customProgramCacheKey has to encode every flag that changes the
   * generated source. Without it three hands back the first program it
   * compiled for MeshStandardMaterial and half the scene silently gets
   * somebody else's shader - which presents as "the floor is unlit",
   * hours from its cause.
   */
  function patchCel(material, cfg) {
    const projected = cfg.project !== "uv";
    const wantsMacro = cfg.macro > 0;
    const needsWorld = projected || wantsMacro;

    const uniforms = {
      uProjScale: { value: 1 / Math.max(0.01, cfg.metres || 1) },
      uCelAmount: { value: clamp01(cfg.cel ?? 0.55) },
      uRimStrength: { value: Math.max(0, cfg.rim ?? 0.18) },
      uRimPower: { value: Math.max(0.5, cfg.rimPower ?? 3.2) },
      uMacroAmount: { value: clamp01(cfg.macro ?? 0) },
    };
    material.userData.apopUniforms = uniforms;
    material.userData.apopConfig = cfg;

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared, uniforms);
      // If the breakup layer could not be synthesised, the sampler
      // reads black and the multiply would darken every surface in the
      // game by up to 38% - a subtle, global, extremely hard to trace
      // regression. Stand the term down instead.
      if (wantsMacro && !macroTexture()) uniforms.uMacroAmount.value = 0;

      /* ---- vertex ---- */
      let vs = shader.vertexShader;
      const vHead = [
        "#include <common>",
        needsWorld ? "varying vec3 vApopWorld;" : "",
        projected ? "uniform float uProjScale;" : "",
        projected ? "vec2 apopProject( vec3 wp, vec3 wn ) {" : "",
        projected ? projectionBody(cfg.project) : "",
        projected ? "}" : "",
      ].filter(Boolean).join("\n");
      vs = vs.replace("#include <common>", vHead);

      const vBody = ["#include <project_vertex>"];
      if (needsWorld) {
        vBody.push(
          "vec4 apopWP = vec4( transformed, 1.0 );",
          "#ifdef USE_BATCHING",
          "  apopWP = batchingMatrix * apopWP;",
          "#endif",
          "#ifdef USE_INSTANCING",
          "  apopWP = instanceMatrix * apopWP;",
          "#endif",
          "apopWP = modelMatrix * apopWP;",
          "vApopWorld = apopWP.xyz;"
        );
      }
      if (projected) {
        vBody.push(
          "vec3 apopON = objectNormal;",
          "#ifdef USE_INSTANCING",
          "  apopON = mat3( instanceMatrix ) * apopON;",
          "#endif",
          "vec3 apopWN = normalize( mat3( modelMatrix ) * apopON );",
          "vec2 apopUv = apopProject( apopWP.xyz, apopWN );"
        );
        for (const [guard, varying, transform] of UV_TARGETS) {
          vBody.push(
            `#ifdef ${guard}`,
            `  ${varying} = ( ${transform} * vec3( apopUv, 1 ) ).xy;`,
            "#endif"
          );
        }
      }
      vs = vs.replace("#include <project_vertex>", vBody.join("\n"));
      shader.vertexShader = vs;

      /* ---- fragment ---- */
      let fs = shader.fragmentShader;
      const fHead = [
        "#include <common>",
        needsWorld ? "varying vec3 vApopWorld;" : "",
        "uniform float uCelAmount;",
        "uniform float uCelSteps;",
        "uniform float uCelSoft;",
        "uniform float uCelBias;",
        "uniform float uKeyLum;",
        "uniform vec3 uBounceDown;",
        "uniform vec3 uBounceUp;",
        "uniform vec3 uRimColor;",
        "uniform float uRimStrength;",
        "uniform float uRimPower;",
        "uniform float uEnvFake;",
        wantsMacro ? "uniform sampler2D uMacroMap;" : "",
        wantsMacro ? "uniform float uMacroScale;" : "",
        wantsMacro ? "uniform float uMacroAmount;" : "",
        // The ramp. Soft-stepping the fractional part inside each band
        // rather than hard-quantising is what keeps the terminator from
        // crawling with pixel noise as the camera moves.
        "float apopBands( float t ) {",
        "  float s = pow( clamp( t, 0.0, 1.0 ), uCelBias ) * uCelSteps;",
        "  float i = floor( s );",
        "  float f = s - i;",
        "  float e = smoothstep( 0.5 - uCelSoft, 0.5 + uCelSoft, f );",
        "  return ( i + e ) / uCelSteps;",
        "}",
      ].filter(Boolean).join("\n");
      fs = fs.replace("#include <common>", fHead);

      if (wantsMacro) {
        // Multiplied over the albedo AFTER the map sample, in world
        // space, at a period unrelated to the texture's own. This is
        // what stops a 20 m floor showing its 2.4 m repeat; the texture
        // still repeats, its appearance does not.
        fs = fs.replace("#include <map_fragment>", [
          "#include <map_fragment>",
          "float apopMacro = texture2D( uMacroMap, vApopWorld.xz * uMacroScale ).r;",
          "diffuseColor.rgb *= mix( 1.0, 0.62 + apopMacro * 0.76, uMacroAmount );",
        ].join("\n"));
      }

      fs = fs.replace("#include <lights_fragment_end>", [
        "#include <lights_fragment_end>",
        "{",
        // Re-ramp the key light in place. directDiffuse is
        // dotNL * shadow * lightColor * albedo / PI, so dividing by the
        // albedo and the light intensity recovers roughly dotNL*shadow,
        // and we scale by the ratio of banded to linear response. The
        // guard and the clamp keep the ratio finite where the surface
        // is fully shadowed and the numerator is zero.
        "  vec3 apopDD = reflectedLight.directDiffuse;",
        "  float apopM = max( max( apopDD.r, apopDD.g ), apopDD.b );",
        "  if ( apopM > 1e-5 && uCelAmount > 0.0 ) {",
        "    float apopDMax = max( max( material.diffuseColor.r, material.diffuseColor.g ), material.diffuseColor.b );",
        "    float apopNorm = max( uKeyLum * apopDMax * RECIPROCAL_PI, 1e-4 );",
        "    float apopT = clamp( apopM / apopNorm, 0.0, 1.0 );",
        "    float apopB = apopBands( apopT );",
        "    float apopRatio = clamp( apopB / max( apopT, 0.02 ), 0.0, 3.0 );",
        "    reflectedLight.directDiffuse *= mix( 1.0, apopRatio, uCelAmount );",
        "  }",
        // Coloured hemisphere bounce. Added to indirectDiffuse so the
        // AO map still occludes it - bounce light that ignores occlusion
        // is what makes a stylised scene look flat and papery.
        "  vec3 apopWN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );",
        "  float apopUp = apopWN.y * 0.5 + 0.5;",
        "  vec3 apopHemi = mix( uBounceDown, uBounceUp, apopUp );",
        "  reflectedLight.indirectDiffuse += apopHemi * material.diffuseColor;",
        // A metal has no diffuse response at all, so with no env map
        // bound it renders BLACK - chrome, truss, HVAC and the Platinum
        // Record all read as holes cut in the frame. This gives them the
        // same hemisphere to reflect, weighted by the specular colour
        // (which is the albedo for a metal and about 0.04 for everything
        // else, so dielectrics barely notice). setEnvMap turns it down
        // once there is a real environment to reflect instead.
        "  reflectedLight.indirectSpecular += apopHemi * material.specularColor * uEnvFake;",
        // Rim. Added to indirectSpecular so it is NOT multiplied by the
        // albedo: a dark costume needs the edge light most.
        "  if ( uRimStrength > 0.0 ) {",
        "    float apopRim = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), uRimPower );",
        "    reflectedLight.indirectSpecular += apopRim * uRimColor * uRimStrength;",
        "  }",
        "}",
      ].join("\n"));

      shader.fragmentShader = fs;
      material.userData.apopShader = shader;
    };

    material.customProgramCacheKey = () =>
      `apop-cel|${cfg.project}|${wantsMacro ? 1 : 0}`;

    return material;
  }

  /* ------------------------------------------------------------
     Texture binding
     ------------------------------------------------------------ */

  const cloneCache = new Map();

  /** UV-mapped surfaces at a repeat other than 1 need their own clone.
   *  Everything else shares the cached texture object outright -
   *  projected surfaces carry their scale in uProjScale, and a repeat
   *  of 1 needs no transform at all. Sharing matters beyond memory:
   *  cloning would also lose the source's wrap mode, and the sign and
   *  crowd sheets are deliberately clamped rather than repeating.
   *  Clones share the GPU upload with their source. */
  function bind(texture, repeat) {
    if (!texture) return null;
    if (!repeat || (repeat[0] === 1 && repeat[1] === 1)) return texture;
    const key = `${texture.uuid}|${repeat[0]}|${repeat[1]}`;
    const hit = cloneCache.get(key);
    if (hit) return hit;
    const copy = texture.clone();
    copy.wrapS = THREE.RepeatWrapping;
    copy.wrapT = THREE.RepeatWrapping;
    copy.repeat.set(repeat[0], repeat[1]);
    copy.channel = 0;
    copy.needsUpdate = true;
    cloneCache.set(key, copy);
    return copy;
  }

  function textureSet(spec) {
    const t = ctx.textures;
    if (!t || typeof t.get !== "function") return null;
    try {
      return t.get(spec.texture, spec.opts || {});
    } catch (error) {
      console.error(`[apop3d] texture "${spec.texture}" failed to synthesise`, error);
      return null;
    }
  }

  function sideOf(name) {
    if (name === "back") return THREE.BackSide;
    if (name === "double") return THREE.DoubleSide;
    return THREE.FrontSide;
  }

  /* ------------------------------------------------------------
     Builders
     ------------------------------------------------------------ */

  function buildSurface(name, spec) {
    const set = textureSet(spec);
    const repeat = spec.project === "uv" ? (spec.repeat || [1, 1]) : null;

    const material = new THREE.MeshStandardMaterial({
      map: set ? bind(set.map, repeat) : null,
      normalMap: set ? bind(set.normalMap, repeat) : null,
      roughnessMap: set ? bind(set.roughnessMap, repeat) : null,
      metalnessMap: set ? bind(set.metalnessMap, repeat) : null,
      aoMap: set ? bind(set.aoMap, repeat) : null,
      emissiveMap: set && set.emissiveMap ? bind(set.emissiveMap, repeat) : null,
      color: spec.color !== undefined ? new THREE.Color(spec.color) : 0xffffff,
      // roughness/metalness sit at 1 for mapped surfaces: the generators
      // author the real spread and the base value multiplies the map, so
      // anything below 1 quietly compresses every surface into the same
      // narrow bracket.
      roughness: spec.roughness ?? 1,
      metalness: spec.metalness ?? 1,
      emissive: new THREE.Color(spec.emissive ?? 0x000000),
      emissiveIntensity: spec.emissiveIntensity ?? 1,
      envMapIntensity: spec.envMapIntensity ?? 1,
      transparent: !!spec.transparent,
      opacity: spec.opacity ?? 1,
      alphaTest: spec.alphaTest ?? 0,
      depthWrite: spec.depthWrite !== undefined ? spec.depthWrite : true,
      side: sideOf(spec.side),
      dithering: true,
    });
    material.name = `apop-${name}`;
    if (material.normalMap) material.normalScale.setScalar(spec.normalScale ?? 1);
    material.aoMapIntensity = spec.ao ?? 1;

    patchCel(material, {
      project: spec.project || "axis",
      metres: spec.metres || 2,
      macro: spec.macro ?? 0.5,
      cel: spec.cel ?? 0.55,
      rim: spec.rim ?? 0.18,
      rimPower: spec.rimPower ?? 3.2,
    });

    if (spec.beatReact) {
      material.userData.apopBeat = spec.beatReact;
      material.userData.apopEmissiveBase = material.emissiveIntensity;
      beatList.push(material);
    }

    registry.push(material);
    return material;
  }

  /**
   * The shared character shading model.
   *
   * Characters band harder and rim brighter than the level does: they
   * have to read as a distinct thing standing in front of the world,
   * and CONTRACT §2 puts silhouette mush third on the list of tells.
   * A flat base colour is the point - the bands and the rim carry the
   * form, exactly as they do on SM64's own cast, which had barely any
   * texture on its faces either.
   */
  function toon(baseHex, opts = {}) {
    /* Key textures by uuid, never by value.
       JSON.stringify on a THREE.Texture calls its toJSON, which
       serialises a CanvasTexture's source to a base64 data URL - so
       once toon() started honouring opts.map/normalMap/roughnessMap,
       every character material baked three 512px PNGs into a Map key
       that then lived for the session. Works, costs megabytes. */
    const key = `toon|${baseHex}|${JSON.stringify(opts, (k, v) => (
      v && v.isTexture ? `tex:${v.uuid}` : v
    ))}`;
    const hit = cache.get(key);
    if (hit) return hit;

    let set = null;
    if (opts.detail && ctx.textures && typeof ctx.textures.get === "function") {
      try { set = ctx.textures.get(opts.detail, opts.detailOpts || {}); } catch (_) { set = null; }
    }
    const repeat = opts.repeat || [1, 1];

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(baseHex),
      /* Honour vertexColors AT CONSTRUCTION.
         three decides whether to compile USE_COLOR into the program
         from this flag, and a caller setting `material.vertexColors`
         afterwards gets a material that reports true while running a
         shader that never reads the attribute. character.js builds
         every figure's palette as vertex colour over a white base, so
         missing this renders each character as a featureless white
         silhouette - which is exactly what it did. */
      vertexColors: !!opts.vertexColors,
      /* An explicitly supplied texture wins over one this module would
         have fetched for itself.
         These three used to consider ONLY `set`, the texture set built
         from `opts.detail`. Anything passed in as `opts.map` was
         accepted by the signature and then silently dropped, so
         character.js - which synthesises a 512px atlas for every
         figure and hands it over here - had none of it reach the GPU.
         Every character in the game rendered untextured, which is the
         first tell listed in CONTRACT section 2. */
      map: opts.map || (set ? bind(set.map, repeat) : null),
      normalMap: opts.normalMap || (set ? bind(set.normalMap, repeat) : null),
      roughnessMap: opts.roughnessMap || (set ? bind(set.roughnessMap, repeat) : null),
      roughness: opts.roughness ?? (set ? 1 : 0.62),
      metalness: opts.metalness ?? (set ? 1 : 0.02),
      emissive: new THREE.Color(opts.emissive ?? 0x000000),
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      envMapIntensity: opts.envMapIntensity ?? 0.9,
      transparent: !!opts.transparent,
      opacity: opts.opacity ?? 1,
      alphaTest: opts.alphaTest ?? 0,
      side: sideOf(opts.side),
      flatShading: !!opts.flatShading,
      dithering: true,
    });
    material.name = `apop-toon-${typeof baseHex === "number" ? baseHex.toString(16) : baseHex}`;
    if (material.normalMap) material.normalScale.setScalar(opts.normalScale ?? 0.6);

    patchCel(material, {
      project: "uv",
      metres: 1,
      macro: 0,
      cel: opts.cel ?? 0.92,
      rim: opts.rim ?? 0.85,
      rimPower: opts.rimPower ?? 2.6,
    });

    if (opts.beatReact) {
      material.userData.apopBeat = opts.beatReact;
      material.userData.apopEmissiveBase = material.emissiveIntensity;
      beatList.push(material);
    }

    cache.set(key, material);
    registry.push(material);
    return material;
  }

  /** Unlit additive, for beams, sparkles and the Mog Aura. Deliberately
   *  outside the cel patch: an emitter has no diffuse response to band. */
  function additive(hex, opts = {}) {
    const key = `add|${hex}|${JSON.stringify(opts)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex),
      map: opts.map || null,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: opts.opacity ?? 1,
      toneMapped: opts.toneMapped ?? false,
      side: sideOf(opts.side ?? "double"),
    });
    cache.set(key, material);
    registry.push(material);
    return material;
  }

  /* ------------------------------------------------------------
     Liquid
     ------------------------------------------------------------ */

  /**
   * Defaults for `water()`. Read the header note there first.
   *
   *  metres      world period of one ripple tile. Long on purpose:
   *              a short period is a shimmer generator at distance
   *  speed       tile-widths per second the slow layer scrolls
   *  strength    how far the surface normal is bent by the ripple
   *  sky         what the surface reflects at a grazing angle. This
   *              is the single biggest reason a pool stops reading as
   *              painted concrete, so it is never neutral
   *  glint       a Blinn lobe on the rippled normal, deliberately not
   *              shadowed - see the note in the header
   *  foam        the shore line. Only reaches the surface when the
   *              mesh carries an `aShore` attribute (vfx.js bakes it)
   */
  const WATER_DEFAULTS = {
    metres: 3.6,
    speed: 0.055,
    strength: 0.62,
    detail: 2.17,
    sky: 0xbcdcf2,
    fresnel: 0.85,
    breakup: 0.26,
    glint: 0.55,
    glintColor: 0xfff2d8,
    glintPower: 90,
    glintDir: [-0.28, 0.90, 0.34],
    foam: 0.9,
    foamColor: 0xeaf6ff,
    foamWidth: 0.5,
    depth: 0.22,
  };

  /**
   * Make an already-built material behave like liquid.
   *
   * WHY THIS IS A PATCH AND NOT A SURFACE ENTRY. Every pool in this
   * game wears a surface levels.js authored and owns - `foodcourt.soda`,
   * `roof.pool`, `basement.coolant`. Those materials carry vertex
   * colours (the tints on the jets and the ripple rings), a painter's
   * albedo, an authored opacity and geometry whose UVs were already
   * baked by world.js. Claiming the name here would take all of that
   * over and silently throw it away - the exact failure the SURFACES
   * comment at the top of this file describes. So this ADDS a shading
   * model to whatever was built and changes nothing else.
   *
   * WHAT IT ADDS, in the order they matter to the picture:
   *
   * 1. AN ANIMATED RIPPLE NORMAL. Two scrolling samples of the
   *    synthesised `water` normal map, at different scales, moving in
   *    different directions. One layer scrolling on its own reads as a
   *    sliding texture; two crossing layers read as a surface. The
   *    sample is a WORLD-SPACE planar projection, for the same reason
   *    the rest of this file projects - the pools are different sizes
   *    and share one material.
   *
   * 2. A SKY FRESNEL. Water has almost no diffuse colour; nearly all
   *    of what you see is reflection, and its strength runs from about
   *    2% face-on to 100% at a grazing angle. That ramp is what gives a
   *    flat sheet its near-to-far value gradient, and a pool without it
   *    is a coloured floor whichever way you light it.
   *
   * 3. A GLINT THAT IGNORES THE SHADOW MAP. Course 1's fountain sits
   *    in a roofed interior, so the directional key is shadowed off it
   *    entirely (the same structural fact the grounding bake in vfx.js
   *    exists for). Waiting for the key to produce a specular would
   *    mean waiting forever. This is the SKY the water reflects, not
   *    the sun, so it is added to indirect and is not shadowed.
   *
   * 4. A SHORE FOAM LINE, from a per-vertex distance-to-the-water's-
   *    edge attribute that vfx.js bakes at course load. No attribute,
   *    no foam - `uFoam` stands the whole term down rather than
   *    guessing, because a missing attribute reads as zero, which is
   *    "every fragment is at the shore".
   *
   * THE ANTI-SHIMMER TERM IS NOT OPTIONAL. A bent normal feeding a
   * tight specular lobe is a textbook aliasing generator, and
   * high-frequency energy is the metric row this project has least
   * headroom on. So the ripple and the glint both fade out on
   * `fwidth` of the world position: once one ripple tile covers fewer
   * than about a dozen pixels the surface returns to smooth, which is
   * what it should look like at that distance anyway.
   */
  function water(material, opts = {}) {
    if (!material || !material.isMaterial) return material;
    if (material.userData.apopWater) {
      /* Idempotent, but still re-enrolled: the "shared" namespace
         survives a course unload, so a shared pool is patched once and
         re-found by every later scan - and if the list has been reset
         in between, dropping it here would freeze that pool's ripple. */
      if (!waterList.includes(material)) waterList.push(material);
      return material;
    }
    const cfg = { ...WATER_DEFAULTS, ...opts };

    let ripple = null;
    if (ctx.textures && typeof ctx.textures.get === "function") {
      try {
        const set = ctx.textures.get("water", { shallow: 0x3ba6c4, deep: 0x114a6b });
        ripple = set && set.normalMap ? set.normalMap : null;
      } catch (error) {
        console.error("[apop3d] water ripple normal failed to synthesise", error);
      }
    }
    // No ripple map is not a reason to lose the fresnel and the glint,
    // which are the two terms carrying most of the read.
    const hasRipple = !!ripple;

    const gd = cfg.glintDir;
    const gl = Math.hypot(gd[0], gd[1], gd[2]) || 1;
    const uniforms = {
      uRipple: { value: ripple },
      uWaterScale: { value: 1 / Math.max(0.2, cfg.metres) },
      uWaterTime: { value: 0 },
      uWaterSpeed: { value: cfg.speed },
      uWaterDetail: { value: cfg.detail },
      uWaterStrength: { value: hasRipple ? cfg.strength : 0 },
      uWaterSky: { value: new THREE.Color(cfg.sky) },
      uWaterFresnel: { value: cfg.fresnel },
      uWaterBreak: { value: cfg.breakup },
      uWaterGlint: { value: cfg.glint },
      uWaterGlintColor: { value: new THREE.Color(cfg.glintColor) },
      uWaterGlintPower: { value: cfg.glintPower },
      uWaterGlintDir: { value: new THREE.Vector3(gd[0] / gl, gd[1] / gl, gd[2] / gl) },
      uFoam: { value: opts.shore ? cfg.foam : 0 },
      uFoamColor: { value: new THREE.Color(cfg.foamColor) },
      uFoamWidth: { value: Math.max(0.05, cfg.foamWidth) },
      uWaterDepth: { value: cfg.depth },
      /* Metres-per-pixel window over which the ripple hands back to a
         smooth surface. Derived from the tile size so a coarse ripple
         survives further out than a fine one. */
      uWaterFade: { value: new THREE.Vector2(cfg.metres / 22, cfg.metres / 6) },
    };
    material.userData.apopWater = uniforms;

    const prior = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      if (typeof prior === "function") prior(shader, renderer);
      Object.assign(shader.uniforms, uniforms);

      /* ---- vertex: world position, and nothing else ---- */
      let vs = shader.vertexShader;
      vs = vs.replace("#include <common>", [
        "#include <common>",
        "varying vec3 vApopWater;",
        /* The shore distance rides its own attribute. A geometry
           without it reads 0, which is "every fragment is at the
           shore" - so `uFoam`, not the attribute, is what decides
           whether the foam term is switched on at all. */
        "attribute float aShore;",
        "varying float vApopShore;",
      ].join("\n"));
      vs = vs.replace("#include <project_vertex>", [
        "#include <project_vertex>",
        "vApopShore = aShore;",
        "vec4 apopWWP = vec4( transformed, 1.0 );",
        "#ifdef USE_BATCHING",
        "  apopWWP = batchingMatrix * apopWWP;",
        "#endif",
        "#ifdef USE_INSTANCING",
        "  apopWWP = instanceMatrix * apopWWP;",
        "#endif",
        "apopWWP = modelMatrix * apopWWP;",
        "vApopWater = apopWWP.xyz;",
      ].join("\n"));
      shader.vertexShader = vs;

      /* ---- fragment ---- */
      let fs = shader.fragmentShader;
      fs = fs.replace("#include <common>", [
        "#include <common>",
        "varying vec3 vApopWater;",
        "varying float vApopShore;",
        "uniform sampler2D uRipple;",
        "uniform float uWaterScale;",
        "uniform float uWaterTime;",
        "uniform float uWaterSpeed;",
        "uniform float uWaterDetail;",
        "uniform float uWaterStrength;",
        "uniform vec3 uWaterSky;",
        "uniform float uWaterFresnel;",
        "uniform float uWaterBreak;",
        "uniform float uWaterGlint;",
        "uniform vec3 uWaterGlintColor;",
        "uniform float uWaterGlintPower;",
        "uniform vec3 uWaterGlintDir;",
        "uniform float uFoam;",
        "uniform vec3 uFoamColor;",
        "uniform float uFoamWidth;",
        "uniform float uWaterDepth;",
        "uniform vec2 uWaterFade;",
        // Carried between the two injection points below.
        "vec3 apopWaterN = vec3( 0.0, 1.0, 0.0 );",
        "float apopWaterCrest = 0.0;",
        "float apopWaterFlat = 0.0;",
        "float apopWaterDetail = 0.0;",
      ].join("\n"));

      /* The ripple has to land AFTER three has built its own normal and
         BEFORE any light reads it, which is exactly this seam. */
      fs = fs.replace("#include <normal_fragment_maps>", [
        "#include <normal_fragment_maps>",
        "{",
        "  vec3 apopWN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );",
        /* Only a horizontal surface ripples. The jets and the falling
           sheets in the fountain wear the same material, and a planar
           XZ projection on a vertical face is a smear. */
        "  apopWaterFlat = smoothstep( 0.45, 0.85, abs( apopWN.y ) );",
        "  float apopPx = max( fwidth( vApopWater.x ), fwidth( vApopWater.z ) );",
        "  apopWaterDetail = 1.0 - smoothstep( uWaterFade.x, uWaterFade.y, apopPx );",
        "  float apopAmp = uWaterStrength * apopWaterFlat * apopWaterDetail;",
        "  if ( apopAmp > 0.002 ) {",
        "    vec2 apopUv = vApopWater.xz * uWaterScale;",
        "    float apopT = uWaterTime * uWaterSpeed;",
        "    vec3 apopA = texture2D( uRipple, apopUv + vec2( 0.62, 0.38 ) * apopT ).xyz * 2.0 - 1.0;",
        "    vec3 apopB = texture2D( uRipple, apopUv * uWaterDetail",
        "      + vec2( -0.83, 0.51 ) * apopT * 1.35 ).xyz * 2.0 - 1.0;",
        "    vec2 apopD = ( apopA.xy + apopB.xy * 0.62 ) * apopAmp;",
        "    apopWaterCrest = clamp( length( apopD ) * 1.6, 0.0, 1.0 );",
        "    apopWN = normalize( vec3( apopWN.x + apopD.x, apopWN.y, apopWN.z + apopD.y ) );",
        "    normal = normalize( ( viewMatrix * vec4( apopWN, 0.0 ) ).xyz );",
        "  }",
        "  apopWaterN = apopWN;",
        "}",
      ].join("\n"));

      fs = fs.replace("#include <lights_fragment_end>", [
        "#include <lights_fragment_end>",
        "{",
        /* Schlick against the RIPPLED normal, so the reflection ramp
           moves with the surface instead of being a static gradient
           painted across the pool. */
        "  vec3 apopV = normalize( cameraPosition - vApopWater );",
        "  float apopF = pow( 1.0 - saturate( dot( apopWaterN, apopV ) ), 5.0 );",
        "  float apopFres = ( 0.02 + 0.98 * apopF ) * uWaterFresnel;",
        /* BROKEN BY THE RIPPLE, and this is the difference between a
           reflection and a veil. A pool this wide is seen at a grazing
           angle over nearly all of its area, so an unmodulated Schlick
           term saturates everywhere at once and lays one flat pale
           sheet over the whole surface - which swaps a flat cyan plane
           for a flat grey one and loses the pool's colour into the
           bargain. What reads as reflected sky is that the ripple
           FACES catch it and the troughs do not.
           Measured over the water pixels of the `water` framing, with
           the term toggled inside one process: unmodulated took the
           pool's mean saturation from 0.83 to 0.36 and its Laplacian
           energy from 7.0 to 17.3. Broken by the ripple it lands at
           0.61 and 12.8 - most of the value structure, half the noise,
           and the pool is still teal. */
        "  apopFres *= mix( uWaterBreak, 1.0, apopWaterCrest );",
        "  reflectedLight.indirectSpecular += uWaterSky * apopFres;",
        /* The glint. Blinn half-vector so it tracks the ripple faces
           rather than sitting still, faded with the same detail term
           as the ripple - a tight lobe on a mipped normal is the
           classic way to put pixel crawl into a frame. */
        "  vec3 apopH = normalize( apopV + uWaterGlintDir );",
        "  float apopG = pow( saturate( dot( apopWaterN, apopH ) ), uWaterGlintPower );",
        "  reflectedLight.indirectSpecular += uWaterGlintColor * apopG",
        "    * ( uWaterGlint * apopWaterDetail );",
        /* Depth: the far side of a pool is seen through more liquid
           than the near side, and the fresnel above only lightens. */
        "  reflectedLight.indirectDiffuse *= 1.0 - uWaterDepth * ( 1.0 - apopF );",
        "  if ( uFoam > 0.0 ) {",
        "    float apopShore = 1.0 - smoothstep( 0.0, uFoamWidth, vApopShore );",
        /* Broken by the ripple, or it is a clean stencilled outline of
           the basin rather than aerated water. */
        "    float apopFoam = apopShore * ( 0.42 + 0.58 * apopWaterCrest ) * uFoam * apopWaterFlat;",
        "    reflectedLight.indirectSpecular += uFoamColor * apopFoam;",
        "    diffuseColor.a = clamp( diffuseColor.a + apopFoam * 0.55, 0.0, 1.0 );",
        "  }",
        "}",
      ].join("\n"));

      shader.fragmentShader = fs;
      material.userData.apopWaterShader = shader;
    };

    /* Without this three hands back whichever MeshStandardMaterial
       program it compiled first and the pool renders with somebody
       else's shader. The cel patch has the same note and the same
       reason. */
    const priorKey = material.customProgramCacheKey;
    material.customProgramCacheKey = () =>
      `apop-water|${typeof priorKey === "function" ? priorKey.call(material) : ""}`;
    material.needsUpdate = true;
    waterList.push(material);
    return material;
  }

  /* ------------------------------------------------------------
     The key sheen
     ------------------------------------------------------------ */

  /**
   * THE SPECULAR A LAMBERT LEVEL CANNOT HAVE.
   *
   * A blind art director scored nine framings and found the one lens
   * where the Super Mario 64 references measurably beat us: "no value
   * structure - the whole set is lit by flat overcast. There are no
   * whites and no blacks anywhere." No frame put more than 2.9% of its
   * pixels above luminance 200; two references reach 10.5% and 4.9%.
   * The two of our own frames that scored at all - `boss` at 5.3 and
   * `collect` at 12.8 - were named as "the only two frames with real
   * speculars", which turned out to be the whole diagnosis.
   *
   * It is not a lighting balance. levels.js paints its own surface
   * vocabulary (materials.surface() deliberately returns null for those
   * names) and builds `kind: "lit"` as a **MeshLambertMaterial**. Every
   * large mass in course 1 - terrazzo, checker, tile, column, wall,
   * brick, counter, ceiling - is Lambert, and Lambert's outgoing light
   * is `directDiffuse + indirectDiffuse + emissive`: there is no
   * specular term in the shader at all. Those surfaces are physically
   * incapable of producing a highlight at any exposure, from any light,
   * which is exactly why the whole set reads as tinted flats. The
   * handful of `kind: "shiny"` surfaces are MeshStandardMaterial and do
   * have a GGX lobe - and they are precisely the two frames that
   * scored.
   *
   * WHY A PATCH AND NOT A SURFACE ENTRY - the same argument as water()
   * above, one layer along: those materials carry levels.js's albedo,
   * its vertex colours and its authored opacity. Claiming the names
   * here would take all of that over and throw it away. This ADDS a
   * term to whatever was built and changes nothing else.
   *
   * WHY IT IS ADDED TO `outgoingLight` AND NOT TO reflectedLight.
   * `reflectedLight.indirectSpecular` is where the rim and the fake env
   * live in patchCel, and it is the right home on a MeshStandardMaterial
   * - but Lambert never reads that field. `#include <opaque_fragment>`
   * is the one seam every lit material in three shares, it sits after
   * the whole accumulation and before tone mapping and the output
   * encode, so the term is graded and encoded exactly once like
   * everything else in the frame.
   *
   * WHY IT IS NOT SHADOWED, and this is load-bearing rather than lazy.
   * Course 1 is a roofed interior: the directional key is occluded by
   * the ceiling before it reaches most of the floor, which is the fact
   * the whole grounding bake in vfx.js exists because of. A specular
   * that waited for the key would wait forever in exactly the course
   * that needs it most. water() already made this call for the same
   * reason and says so: this is the light the room reflects, not the
   * disc in the skylight, so it is an indirect term and the shadow map
   * has no claim on it.
   *
   * WHY IT IS CHEAP ON THE NOISE METRIC, which is the row this project
   * has least headroom on. These surfaces carry no normal map, so N is
   * constant across a face and the lobe varies only with the VIEW
   * vector - a smooth, low-frequency pool that slides across a floor
   * rather than a field of glittering texels. The `fwidth` window is
   * kept anyway (see uSheenFade) for the same reason water() has one:
   * once a surface is far enough away that its faces are pixel-sized,
   * a tight lobe is an aliasing generator whatever its normals do.
   *
   *   amount    per-surface gloss. 0 stands the term down entirely
   *   power     Blinn exponent. Low is a broad sheen across a whole
   *             floor, high is a small hot spot on a rail
   *   fresnel   0 = the lobe alone, 1 = the lobe fully weighted by
   *             grazing angle. A floor is nearly always seen at a
   *             grazing angle and a wall is not, which is what makes
   *             this the knob that decides WHERE the highlight lands
   *   rough     metres per pixel at which the term hands back to a
   *             smooth surface
   */
  const SHEEN_DEFAULTS = {
    amount: 1.0,
    power: 26,
    fresnel: 0.55,
    fade: [0.05, 0.34],
  };

  /* Written per course by sky.js, shared BY REFERENCE with every
     patched material - the same arrangement as `shared` above, and for
     the same reason: a course change is one write, not a walk of the
     scene graph. uSheenGain at 0 is the pass switched off, which is
     what setSheenEnabled toggles for the A/B. */
  const sheenShared = {
    uSheenDir: { value: new THREE.Vector3(0.42, 0.72, 0.55).normalize() },
    uSheenColor: { value: new THREE.Color(0xffffff) },
    uSheenGain: { value: 0 },
  };
  const sheenList = [];

  function sheen(material, opts = {}) {
    if (!material || !material.isMaterial) return material;
    if (material.userData.apopSheen) {
      /* Idempotent and re-enrolled, exactly like water(): the "shared"
         namespace survives a course unload, so a shared surface is
         patched once and re-found by every later scan. */
      if (!sheenList.includes(material)) sheenList.push(material);
      return material;
    }
    const cfg = { ...SHEEN_DEFAULTS, ...opts };
    const uniforms = {
      uSheenAmount: { value: Math.max(0, cfg.amount) },
      uSheenPower: { value: Math.max(1, cfg.power) },
      uSheenFresnel: { value: clamp01(cfg.fresnel) },
      uSheenFade: { value: new THREE.Vector2(cfg.fade[0], cfg.fade[1]) },
    };
    material.userData.apopSheen = uniforms;

    const prior = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      if (typeof prior === "function") prior(shader, renderer);
      Object.assign(shader.uniforms, sheenShared, uniforms);

      /* World position, for the anti-shimmer window only. Named apart
         from the water patch's varying so a surface that is somehow
         both does not redeclare it. */
      let vs = shader.vertexShader;
      vs = vs.replace("#include <common>", [
        "#include <common>",
        "varying vec3 vApopSheenW;",
      ].join("\n"));
      vs = vs.replace("#include <project_vertex>", [
        "#include <project_vertex>",
        "vec4 apopSWP = vec4( transformed, 1.0 );",
        "#ifdef USE_BATCHING",
        "  apopSWP = batchingMatrix * apopSWP;",
        "#endif",
        "#ifdef USE_INSTANCING",
        "  apopSWP = instanceMatrix * apopSWP;",
        "#endif",
        "vApopSheenW = ( modelMatrix * apopSWP ).xyz;",
      ].join("\n"));
      shader.vertexShader = vs;

      let fs = shader.fragmentShader;
      fs = fs.replace("#include <common>", [
        "#include <common>",
        "varying vec3 vApopSheenW;",
        "uniform vec3 uSheenDir;",
        "uniform vec3 uSheenColor;",
        "uniform float uSheenGain;",
        "uniform float uSheenAmount;",
        "uniform float uSheenPower;",
        "uniform float uSheenFresnel;",
        "uniform vec2 uSheenFade;",
      ].join("\n"));

      /* `geometryNormal` and `geometryViewDir` are declared by
         <lights_fragment_begin>, which every lit material in three
         includes - Lambert, Phong and Standard alike - and they are
         plain locals in main(), so they are still in scope here. Using
         them rather than re-deriving from `normal` and vViewPosition
         keeps this agreeing with patchCel's rim, which reads the same
         two. */
      fs = fs.replace("#include <opaque_fragment>", [
        "{",
        "  float apopSA = uSheenAmount * uSheenGain;",
        "  if ( apopSA > 0.0005 ) {",
        "    float apopSPx = max( fwidth( vApopSheenW.x ), fwidth( vApopSheenW.z ) );",
        "    float apopSD = 1.0 - smoothstep( uSheenFade.x, uSheenFade.y, apopSPx );",
        "    vec3 apopSL = normalize( ( viewMatrix * vec4( uSheenDir, 0.0 ) ).xyz );",
        "    vec3 apopSH = normalize( apopSL + geometryViewDir );",
        "    float apopSS = pow( saturate( dot( geometryNormal, apopSH ) ), uSheenPower );",
        /* Grazing weight. Without it the pool sits wherever the mirror
           angle happens to fall and a wall catches as much as a floor;
           with it the term is strongest exactly where a polished floor
           is seen from, which is nearly all of the lower half of every
           one of these framings. */
        "    float apopSF = mix( 1.0, pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 4.0 ), uSheenFresnel );",
        /* Only an actually-lit fragment may glint. A specular on a
           surface the light cannot see is the "sourceless streak"
           failure this repo has already diagnosed once, and on an
           interior it would put a highlight inside every cast shadow.
           directDiffuse carries the shadow term, so its own magnitude
           is the cheapest available answer to "is this lit"; the floor
           keeps a little of the term everywhere so a shaded floor is
           still polished, just not sunlit. */
        "    vec3 apopSDD = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;",
        "    float apopSLit = 0.35 + 0.65 * saturate( ( apopSDD.r + apopSDD.g + apopSDD.b ) * 1.6 );",
        "    outgoingLight += uSheenColor * ( apopSS * apopSF * apopSD * apopSLit * apopSA );",
        "  }",
        "}",
        "#include <opaque_fragment>",
      ].join("\n"));
      shader.fragmentShader = fs;
      material.userData.apopSheenShader = shader;
    };

    /* Without this three hands back whichever program it already
       compiled for this material class and the term silently does
       nothing - the same trap water() and patchCel() both carry a note
       about. */
    const priorKey = material.customProgramCacheKey;
    material.customProgramCacheKey = () =>
      `apop-sheen|${typeof priorKey === "function" ? priorKey.call(material) : ""}`;
    material.needsUpdate = true;
    sheenList.push(material);
    return material;
  }

  /**
   * The grounded contact shadow.
   *
   * CONTRACT §2 calls a floating character the loudest AAA failure, and
   * one directional shadow map cannot reach every enemy in a course
   * inside the budget. A multiplied blob under everything that touches
   * the floor is what actually plants them, and it costs one quad.
   */
  function blobShadow(opts = {}) {
    const key = `blob|${JSON.stringify(opts)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(opts.color ?? 0x1a1030),
      transparent: true,
      opacity: opts.opacity ?? 0.42,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.FrontSide,
      toneMapped: false,
    });
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    cache.set(key, material);
    registry.push(material);
    return material;
  }

  /* ------------------------------------------------------------
     Public API (CONTRACT §9)
     ------------------------------------------------------------ */

  /**
   * A named surface, or null if this module does not define it.
   *
   * Returning null rather than a grey fallback is deliberate and it is
   * load-bearing. levels.js authors its own, much larger set of level
   * surface names and carries a full procedural painter for each one;
   * it asks here first and builds the surface itself when the answer
   * is no. Handing back an untextured toon material instead would
   * "succeed" and silently replace every painted floor in the game
   * with flat grey - which is exactly what it did before this changed.
   *
   * So: materials.js owns the shading model, levels.js owns the level
   * surface vocabulary, and an unknown name here is a handoff, not an
   * error.
   */
  function surface(name, overrides) {
    const spec = SURFACES[name];
    if (!spec) return null;
    const key = overrides ? `surf|${name}|${JSON.stringify(overrides)}` : `surf|${name}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const merged = overrides
      ? { ...spec, ...overrides, opts: { ...(spec.opts || {}), ...(overrides.opts || {}) } }
      : spec;
    const material = buildSurface(name, merged);
    cache.set(key, material);
    return material;
  }

  function register(name, factory) {
    custom.set(name, factory);
    // A late registration has to invalidate anything already handed out
    // under that name, or the first caller keeps the built-in forever.
    cache.delete(`get|${name}`);
    return factory;
  }

  /**
   * Generic getter. Resolves, in order: a registered factory, a named
   * level surface, then a plain toon of the requested colour if the
   * name happens to be a hex. Anything else warns once and returns a
   * neutral material rather than throwing - a missing material must not
   * take a course down while another agent is still building it.
   */
  function get(name, overrides) {
    if (custom.has(name)) {
      const key = `get|${name}${overrides ? `|${JSON.stringify(overrides)}` : ""}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const made = custom.get(name)(ctx, overrides || {}, api);
      if (made) { cache.set(key, made); registry.push(made); }
      return made;
    }
    if (SURFACES[name]) return surface(name, overrides);
    if (typeof name === "number") return toon(name, overrides || {});
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`[apop3d] materials.get("${name}") is not registered; using a neutral toon`);
    }
    return toon(0x9b93a8, overrides || {});
  }

  /* ---- beat reaction -------------------------------------------
     materials is not in main.js's UPDATE_ORDER (CONTRACT §4) and
     main.js is not ours to edit, so the pulse decays on a
     self-scheduled frame callback. It reads ctx.clock.t rather than
     wall time so a QA advance() still lands the same value, and it
     stands down the moment anything calls update() - if the spine ever
     wires this module in, the external tick wins. */
  let pulse = 0;
  let lastT = 0;
  let externallyDriven = false;
  let rafHandle = 0;

  function applyPulse() {
    for (let i = 0; i < beatList.length; i += 1) {
      const m = beatList[i];
      const base = m.userData.apopEmissiveBase ?? 1;
      m.emissiveIntensity = base * (1 + pulse * (m.userData.apopBeat || 0));
    }
  }

  function stepPulse() {
    const t = (ctx.clock && ctx.clock.t) || 0;
    const dt = clamp(t - lastT, 0, 0.25);
    lastT = t;
    if (pulse > 0.0005) {
      // Fast attack, ~180 ms release. Any slower and the pulse smears
      // across two beats at 124 BPM and stops reading as rhythm.
      pulse = damp(pulse, 0, 9.5, dt);
      applyPulse();
    } else if (pulse !== 0) {
      pulse = 0;
      applyPulse();
    }
  }

  function tick() {
    rafHandle = 0;
    if (disposed || externallyDriven) return;
    stepPulse();
    schedule();
  }

  function schedule() {
    if (disposed || externallyDriven || rafHandle) return;
    if (typeof requestAnimationFrame !== "function") return;
    rafHandle = requestAnimationFrame(tick);
  }

  function onBeat(strength) {
    pulse = clamp01(Math.max(pulse, strength ?? 1));
    applyPulse();
    schedule();
  }

  // audio.js may not exist yet; if it does, it emits on the bus and we
  // pick the beat up without either module importing the other.
  if (ctx.bus && typeof ctx.bus.on === "function") {
    ctx.bus.on("audio:beat", (payload) => onBeat((payload && payload.strength) ?? 1));
  }

  const api = {
    SURFACES,

    get,
    register,
    toon,
    surface,
    onBeat,

    additive,
    blobShadow,
    water,
    sheen,

    /**
     * Aim the key sheen. sky.js owns this the way it owns every other
     * direction in a course, and it is deliberately NOT the sun: on a
     * roofed course the sun is behind a ceiling, and what a polished
     * floor reflects there is the room. See the block comment on
     * sheen().
     *
     *   dir    array or Vector3, world space, TOWARD the light
     *   color  sRGB hex
     *   gain   global multiplier; 0 stands the whole pass down
     */
    setSheen({ dir, color, gain } = {}) {
      if (dir) {
        const x = dir.isVector3 ? dir.x : dir[0];
        const y = dir.isVector3 ? dir.y : dir[1];
        const z = dir.isVector3 ? dir.z : dir[2];
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
          && (x || y || z)) sheenShared.uSheenDir.value.set(x, y, z).normalize();
      }
      if (color !== undefined) sheenShared.uSheenColor.value.setHex(color);
      if (gain !== undefined) {
        sheenShared.uSheenGain.value = Math.max(0, gain);
        sheenAuthoredGain = sheenShared.uSheenGain.value;
      }
      /* THE POOLS GLINT THE SAME WAY THE FLOOR DOES.
         water() has carried its own `glintDir` since it was written, as
         an authored constant, and it was authored before there was any
         other specular in the course to disagree with. Two highlights
         in one frame off two different lights is the tell that says
         neither is a light - and the fountain sits in the middle of the
         plaza whose sheen this is aiming. So the pool's Blinn lobe
         takes the same direction; everything else about it - the
         ripple, the fresnel, the anti-shimmer window - is its own. */
      if (dir) {
        for (let i = 0; i < waterList.length; i += 1) {
          const u = waterList[i].userData.apopWater;
          if (u && u.uWaterGlintDir) u.uWaterGlintDir.value.copy(sheenShared.uSheenDir.value);
        }
      }
      return sheenShared.uSheenGain.value;
    },

    /** How many surfaces carry the sheen, for the QA stats block. */
    sheenCount() { return sheenList.length; },

    /** The course's authored gain, so the scan that enrols surfaces can
     *  skip a course that never asked for the term. */
    sheenGain() { return sheenAuthoredGain; },

    /** Same contract as resetWater(): levels.js disposes its own
     *  surfaces on unload, so holding them past that is a leak. */
    resetSheen() { sheenList.length = 0; },

    /**
     * The sheen on or off, without losing the course's authored gain.
     *
     * A MEASUREMENT hook, for the reason setWaterEnabled carries: while
     * several agents edit this course at once, a shot from before an
     * edit and one from after are not a controlled pair. One process,
     * one build, one camera pose, one toggle.
     */
    setSheenEnabled(on) {
      sheenShared.uSheenGain.value = on !== false ? sheenAuthoredGain : 0;
      return sheenList.length;
    },

    /**
     * Advance every liquid's ripple clock.
     *
     * Driven from OUTSIDE rather than from this module's own rAF
     * fallback, and that is the point: the fallback only runs while a
     * beat pulse is decaying, and the screenshot harness drives the
     * whole game through `advance(seconds)` with no real frames at
     * all. A caller inside UPDATE_ORDER passing ctx.clock.t is the
     * only way the ripple is both animated in the game and identical
     * between two runs of the same build.
     */
    setWaterTime(t) {
      const v = Number.isFinite(t) ? t : 0;
      for (let i = 0; i < waterList.length; i += 1) {
        const u = waterList[i].userData.apopWater;
        if (u) u.uWaterTime.value = v;
      }
    },

    /** How many liquids are patched, for the QA stats block. */
    waterCount() { return waterList.length; },

    /** Drop the liquid roster. levels.js disposes its own surfaces on
     *  unload, so holding them past that is a leak; whoever scans the
     *  next course re-enrols what is still there. */
    resetWater() { waterList.length = 0; },

    /**
     * Stand every liquid term down, or bring it back.
     *
     * This is a MEASUREMENT hook, not a quality tier. Several agents
     * are editing this course at once, so a shot captured before an
     * edit and one captured after are not a controlled pair - the
     * level itself moved in between. Toggling inside one process,
     * against one build, on one camera pose is the only honest A/B
     * available, and the harness drives it from qa.js.
     */
    setWaterEnabled(on) {
      const wet = on !== false;
      for (let i = 0; i < waterList.length; i += 1) {
        const u = waterList[i].userData.apopWater;
        if (!u) continue;
        if (u.uWaterAuthored === undefined) {
          u.uWaterAuthored = {
            strength: u.uWaterStrength.value,
            fresnel: u.uWaterFresnel.value,
            glint: u.uWaterGlint.value,
            foam: u.uFoam.value,
            depth: u.uWaterDepth.value,
          };
        }
        const a = u.uWaterAuthored;
        u.uWaterStrength.value = wet ? a.strength : 0;
        u.uWaterFresnel.value = wet ? a.fresnel : 0;
        u.uWaterGlint.value = wet ? a.glint : 0;
        u.uFoam.value = wet ? a.foam : 0;
        u.uWaterDepth.value = wet ? a.depth : 0;
      }
      return waterList.length;
    },

    /** Every material, so a per-course grade can be applied without
     *  walking the scene graph. */
    all() { return registry.slice(); },

    /** sky.js owns the key light; this is how it tells the cel ramp how
     *  bright that light is. Get it wrong and the bands land in the
     *  wrong place - too low and everything clips to the top band, too
     *  high and the surface never leaves the bottom one. */
    setKeyIntensity(value) { shared.uKeyLum.value = Math.max(0.05, value); },

    /** Per-course bounce. Both arguments are sRGB hex. Never pass the
     *  same value twice: equal warm and cool bounce is grey ambient
     *  wearing a hat. */
    setBounce(groundHex, skyHex) {
      shared.uBounceDown.value.set(groundHex);
      shared.uBounceUp.value.set(skyHex);
    },

    setRim(hex, { power } = {}) {
      shared.uRimColor.value.set(hex);
      if (power !== undefined) {
        for (const m of registry) {
          const u = m.userData.apopUniforms;
          if (u && u.uRimPower) u.uRimPower.value = power;
        }
      }
    },

    /** Global banding shape. steps 3-4 reads as SM64; above 6 it just
     *  reads as a slightly cheap gradient. */
    setCel({ steps, soft, bias } = {}) {
      if (steps !== undefined) shared.uCelSteps.value = clamp(steps, 2, 8);
      if (soft !== undefined) shared.uCelSoft.value = clamp(soft, 0.01, 0.5);
      if (bias !== undefined) shared.uCelBias.value = clamp(bias, 0.4, 2.0);
    },

    /** Bind a real environment. This also stands the fake hemisphere
     *  reflection down to a trim, because with a genuine env map the
     *  two terms are the same light counted twice and metals blow out. */
    setEnvMap(envMap, intensity) {
      for (const m of registry) {
        if ("envMap" in m) {
          m.envMap = envMap;
          if (intensity !== undefined && "envMapIntensity" in m) m.envMapIntensity = intensity;
          m.needsUpdate = true;
        }
      }
      shared.uEnvFake.value = envMap ? 0.35 : 3.0;
    },

    /** Manual override for the stand-in reflection, if a course wants
     *  flatter or shinier metal than the automatic value. */
    setEnvFake(value) { shared.uEnvFake.value = Math.max(0, value); },

    /**
     * Build and bind a small environment cube from the course's own
     * bounce colours, and bind it to every registered material.
     *
     * WHY THIS EXISTS. setEnvMap has been here since this module was
     * written and nothing ever called it, so every metal in the game
     * was relying on the uEnvFake stand-in alone. That stand-in is
     *
     *   apopHemi = mix( uBounceDown, uBounceUp, worldNormal.y*0.5+0.5 )
     *
     * which is a hemisphere sampled by the surface normal. It works on
     * a floor and fails completely on a VERTICAL face, which samples
     * the midpoint - and the midpoint of a hemisphere whose lower half
     * is near-black is near-black. A metal has no diffuse response at
     * all, so `shared.chrome` (metalness 0.95, roughness 0.18) came out
     * as a hole cut in the frame: a blind reviewer called out "a giant
     * featureless black cylinder dead centre" as the largest object in
     * one of our shots.
     *
     * A real cube map fixes it because a mirror finally has something
     * to mirror, from every direction rather than only from above. It
     * is generated rather than loaded: six 32px faces of a vertical
     * gradient is far below the point of diminishing returns for a
     * roughness-0.18 surface, and it costs no download.
     *
     * Called after sky.js has set the course, so it picks up that
     * course's palette automatically.
     */
    refreshEnv(intensity = 1) {
      const SIZE = 32;
      const up = shared.uBounceUp.value;
      const down = shared.uBounceDown.value;
      const faces = [];
      // +X -X +Y -Y +Z -Z, in three's cube face order.
      for (let f = 0; f < 6; f += 1) {
        const cv = document.createElement("canvas");
        cv.width = cv.height = SIZE;
        const g = cv.getContext("2d");
        if (f === 2) {           // +Y, the sky cap
          g.fillStyle = `rgb(${up.r * 255 | 0},${up.g * 255 | 0},${up.b * 255 | 0})`;
          g.fillRect(0, 0, SIZE, SIZE);
        } else if (f === 3) {    // -Y, the ground cap
          g.fillStyle = `rgb(${down.r * 255 | 0},${down.g * 255 | 0},${down.b * 255 | 0})`;
          g.fillRect(0, 0, SIZE, SIZE);
        } else {                 // the four sides get the gradient
          const grad = g.createLinearGradient(0, 0, 0, SIZE);
          grad.addColorStop(0, `rgb(${up.r * 255 | 0},${up.g * 255 | 0},${up.b * 255 | 0})`);
          grad.addColorStop(1, `rgb(${down.r * 255 | 0},${down.g * 255 | 0},${down.b * 255 | 0})`);
          g.fillStyle = grad;
          g.fillRect(0, 0, SIZE, SIZE);
        }
        faces.push(cv);
      }
      const cube = new THREE.CubeTexture(faces);
      cube.colorSpace = THREE.SRGBColorSpace;
      cube.mapping = THREE.CubeReflectionMapping;
      cube.needsUpdate = true;
      if (shared.envTexture) shared.envTexture.dispose();
      shared.envTexture = cube;
      this.setEnvMap(cube, intensity);
      return cube;
    },

    stats() {
      return {
        materials: registry.length, cached: cache.size, beatReactive: beatList.length,
        water: waterList.length,
        sheen: sheenList.length,
        sheenGain: Number(sheenShared.uSheenGain.value.toFixed(3)),
      };
    },

    /** Present so the spine can drive the beat decay if it is ever
     *  added to UPDATE_ORDER; calling it stands the rAF fallback down. */
    update() {
      externallyDriven = true;
      stepPulse();
    },
    lateUpdate() {},

    dispose() {
      disposed = true;
      if (rafHandle && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafHandle);
      rafHandle = 0;
      for (const m of registry) m.dispose();
      registry.length = 0;
      beatList.length = 0;
      // NOT disposed: every entry is a material levels.js built and
      // owns. These lists only ever held references.
      waterList.length = 0;
      sheenList.length = 0;
      cache.clear();
      // Clones are NOT disposed: they share their source with the
      // cached original, and freeing one would pull the upload out from
      // under the other. textures.dispose() owns that lifetime.
      cloneCache.clear();
      shared.uMacroMap.value = null;
    },
  };

  return api;
}

/** Bind the macro breakup layer once every module exists. It cannot be
 *  fetched at create() time because textures.js synthesises lazily and
 *  render.js - which owns the renderer the upload needs - is wired
 *  after both of us. */
export function ready(ctx) {
  const m = ctx.materials;
  if (!m) return;
  if (ctx.textures && typeof ctx.textures.macro === "function") {
    try { ctx.textures.macro(); } catch (error) {
      console.error("[apop3d] macro breakup layer failed to synthesise", error);
    }
  }
}
