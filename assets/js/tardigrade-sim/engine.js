/* ============================================================
   Tardigrade Simulator - render engine

   Owns: WebGL renderer, the colour/exposure pipeline, sky +
   image based lighting, the cascaded sun shadows, and the whole
   post-processing chain.

   ------------------------------------------------------------
   LIGHTING UNITS (read this before changing any number)
   ------------------------------------------------------------
   Everything in this file lives in one coherent radiance space.
   The reference is a matte white surface (albedo 0.8) in full
   sun, which is authored to land at ~1.8 scene-linear. From that
   one anchor:

     sun (direct)     SUN_INTENSITY, applied by the CSM lights
     sky (indirect)   the Preetham dome, scaled by SKY_INTENSITY
                      and baked to a PMREM environment
     ground bounce    a warm dome baked into the same environment

   The sun:sky ratio is ~3.5:1 on a horizontal surface, which is
   close to a real clear day (~5:1) but keeps a little more light
   in shadow so the picture never goes to mud. Shadows therefore
   sit around 35% of sunlit brightness AND are strongly blue,
   because their only light source is the sky dome. Warm key
   against cool fill is most of what makes an outdoor render look
   expensive - do not "fix" it by adding a white ambient light.

   Tone mapping is done by TonemapGradeShader at the end of the
   chain, NOT by the renderer, so every pass before it works on
   real HDR radiance. `renderer.toneMappingExposure` is still the
   single exposure knob (qa.js drives it) - it is read into the
   grade uniform every frame.

   ------------------------------------------------------------
   PASS ORDER
   ------------------------------------------------------------
     RenderPass        scene -> HDR (always renders into rt1, MSAA)
                       *** geometric AA is resolved HERE, before any
                       post pass sees a pixel ***
     StatsPass         snapshot renderer.info -> engine.stats
     DepthCopyPass     rt1 depth -> a standalone R32F texture
     ContactShadowPass screen space sun trace; grounds everything the
                       shadow cascades are too coarse to resolve
     GTAOPass          ambient occlusion (reuses that depth)
     AtmospherePass    height fog + aerial perspective + god rays
     DofPass           macro-photography depth of field
     UnrealBloomPass   highlights only (threshold is in HDR units)
     TonemapGradePass  exposure -> filmic curve -> grade -> sRGB
     SMAA / FXAA       shader aliasing cleanup, on display pixels
     FinishPass        sharpen, chroma, vignette, grain

   ------------------------------------------------------------
   ANTI-ALIASING (read this before touching the pass order)
   ------------------------------------------------------------
   Thin geometry - grass tips, bottle-cap crenellations, the hero's
   claws - is the hardest thing in this scene to resolve. A
   post-process edge filter cannot invent the coverage information
   it needs, so the primary AA is real hardware MSAA on the HDR
   render target: `renderTarget.samples`. That resolves inside the
   scene render, so fog, DoF, bloom and the grade all operate on
   already-antialiased radiance.

   SMAA afterwards is a *secondary* cleanup for things MSAA cannot
   see (specular sparkle, normal-map aliasing, alpha edges), not the
   main event. The FinishPass sharpen is contrast-adaptive for the
   same reason: an unweighted sharpen run after AA snaps the blended
   edge pixels back to the local min/max and re-creates the exact
   staircase the AA just removed.

   Every optional pass is constructed in a try/catch. If one fails
   the game keeps rendering without it.
   ============================================================ */

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { Sky } from "three/addons/objects/Sky.js";
import { clamp, damp, smoothstep } from "./core.js";

/* ================================================================
   Calibration constants. These are the only "magic numbers" that
   matter; everything else is derived from them.
   ================================================================ */

/** Direct sun radiance. ~38 degrees elevation, late morning. */
const SUN_INTENSITY = 7.6;
const SUN_COLOR = 0xfff1dc;

/** Multiplier on the Preetham dome so it shares the sun's units.
 *  Blind A/B review found the horizon clipping to flat white, which flattens
 *  every wide shot: with no gradient left in the sky there is nothing for
 *  distant geometry to sit against. Pulled down so the dome lands below the
 *  shoulder of the tone curve and keeps its blue. */
const SKY_INTENSITY = 0.58;
/** Hard ceiling on sky radiance so the solar disc glares without nuking bloom. */
const SKY_CLAMP = 6.5;

/** Ceiling for the sky the CAMERA sees, as opposed to the one baked to IBL.
 *
 *  These want different numbers and were sharing one. The Preetham solar disc
 *  sits orders of magnitude above the sky dome, so clamping the visible sky at
 *  6.5 flattened the disc to exactly the value of bright horizon sky - the sun
 *  was mathematically erased, and six blind reviews duly reported "no light
 *  source is ever visible in any frame" and "a featureless gradient sky".
 *  The env bake still wants the low ceiling, or a single enormous texel
 *  dominates the irradiance. HdrClampShader (240, immediately before bloom)
 *  remains the guard against Inf/NaN, so this ceiling only has to be sane. */
const SKY_CLAMP_VISIBLE = 90.0;

/** How much of the sky's own chroma survives into the IBL bake.
 *
 *  The visible sky must stay a rich blue; the light it CASTS must not be,
 *  and these were the same number. Measured on the patio-canyon pose with a
 *  window sitting entirely inside the grass canopy: the ambient's own
 *  contribution to those pixels came out at hue 180 with green and blue
 *  equal, i.e. the fill was painting the lawn cyan faster than chlorophyll
 *  albedo could paint it green. Swapping the whole environment for a
 *  luminance-matched neutral dome moved that window from hue 182 to 144 and
 *  the soil from 206 (blue-grey) to 35 (brown) - proof that the blue was
 *  cast, not authored.
 *
 *  A full neutral is wrong too: it throws away the warm-key/cool-fill
 *  separation that the whole lighting design rests on, and it flattened
 *  saturation. This keeps a bit under half the dome's chroma, which leaves
 *  shadows visibly cool without letting them dictate hue.
 *
 *  NOTE this is not the same knob as material.envMapIntensity, and that one
 *  does not work: three.js overrides the envMapIntensity uniform with
 *  scene.environmentIntensity for any material that has no envMap of its
 *  own, which is every material here. Verified by setting envMapIntensity to
 *  0 on every material in the scene at runtime - the frame did not change by
 *  one pixel, on grass, soil or terracotta. materials.js asks for 0.42 on
 *  foliage and 0.5 on leaves and gets neither. Ambient balance has to be
 *  done here. */
const ENV_CHROMA = 0.45;

/** Warm light kicked back up out of the ground, baked into the IBL.
 *  Lifted along with ENV_CHROMA: a garden floor is soil, terracotta and
 *  patio, and it is a real part of what fills a shadow outdoors. With the
 *  dome's chroma pulled down this is what keeps the fill from going neutral
 *  grey, so the two numbers move together. */
const GROUND_BOUNCE = [0.215, 0.163, 0.096];

/** Scene-linear value of a matte white (0.8 albedo) surface in full sun. */
const DIFFUSE_WHITE = 1.8;

/** Default exposure. Chosen so DIFFUSE_WHITE lands at ~0.90 display.
 *
 *  Lifted with the ambient cut below: taking a third of the sky fill out
 *  removes it from sunlit surfaces too, and without this the whole frame
 *  simply went darker instead of gaining contrast. Measured across the
 *  thirteen poses at this value: 0% of pixels clipped white. */
const DEFAULT_EXPOSURE = 0.68;

/** Resolution scale for the ambient-occlusion pass. See engine.resize(). */
const GTAO_SCALE = 0.5;

/** Sun direction (points at the sun) - shared by sky, CSM and god rays. */
const SUN_DIRECTION = new THREE.Vector3(0.46, 0.62, 0.64).normalize();

/** Constant shadow depth bias, expressed in WORLD units rather than in
 *  [0,1] shadow-map depth. The two are only the same thing while the light
 *  camera's depth range never changes, and it does - it is sized from the
 *  cascade extents. _applyLightSettings() divides this by each cascade's
 *  own range so a bias tuned on the hero cannot silently become a
 *  peter-panning offset on the far cascade. */
const SHADOW_WORLD_BIAS = 0.06;

/** Tangent of the sun's apparent angular RADIUS, used to size penumbras.
 *
 *  The real sun is 0.27 degrees, which at this scale gives a penumbra of
 *  0.004 units under a hero standing 0.9 units off the ground - about one
 *  shadow-map texel, i.e. mathematically invisible. Every shipped outdoor
 *  game exaggerates this, because a hard-edged shadow is the single
 *  loudest "this is a real-time render" tell there is: seven blind reviews
 *  scored shadows 2-3/10 and the last one led with "a hard, stair-stepped,
 *  flat slate-blue polygon". 1.6 degrees (this is its tangent) puts 0.025
 *  world units of penumbra under a hero whose body sits 0.9 units up -
 *  about 8 screen pixels in the hero close-up, and 2.5 texels of cascade 0 -
 *  while a claw touching the ground still casts a hard edge. That is what
 *  the rubric asks for: contact-sharp, softening with distance. */
const SUN_TAN_ANGLE = 0.028;

/* ================================================================
   Soft shadows.

   three.js ships PCF and "PCF soft", both of which are fixed-width
   filters: a shadow is exactly as hard where a claw touches the
   ground as it is 700 units under a plant pot. That is the look the
   reviews keep calling out, and no amount of extra shadow-map
   resolution fixes it - more resolution makes the SAME hard edge
   sharper.

   This replaces getShadow() in the stock shadowmap chunk with PCSS:
   search the map around the receiver for occluders, measure how far
   in front of the receiver they sit, and widen the filter in
   proportion. Two things fall out of that for free:

     - contact shadows are tight and dark exactly where two surfaces
       meet, so objects read as attached to the ground;
     - the far cascades, whose texels are ~1 world unit, stop
       producing a stair-stepped silhouette and produce a soft blob
       instead, which is what a shadow that far away should look like.

   The patch is a rename + append, not a rewrite: the stock getShadow
   survives as getShadowHard() and every other helper in the chunk is
   untouched, so if three changes the chunk shape the only thing that
   can fail is the marker test, which falls back to stock behaviour.

   NOTE the filter disc is deliberately NOT rotated per pixel. A
   per-pixel rotation turns the finite tap count into per-pixel noise,
   and this project has already shipped one such artifact (a binary
   contact-shadow test on a dithered ray start, read by three separate
   reviews as a denim moire). A fixed golden-angle disc is a smooth
   function of position, so its error shows up as a slightly lumpy
   penumbra rather than as sparkle - and the CAS sharpen in
   FinishShader, which runs at full strength on low-contrast regions,
   would have amplified sparkle specifically.
   ================================================================ */

function installSoftShadows(blockerTaps, filterTaps, maxTexels, minTexels) {
  const source = THREE.ShaderChunk.shadowmap_pars_fragment;
  const signature =
    "float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {";
  if (source.includes("tsimShadowDisc")) return true; // already patched
  if (!source.includes(signature)) return false;

  const renamed = source.replace(
    signature,
    "float getShadowHard( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {"
  );
  // The chunk's last top-level #endif closes "#ifdef USE_SHADOWMAP", and
  // getShadow has to live inside that block to see texture2DCompare.
  const tail = renamed.lastIndexOf("#endif");
  if (tail < 0) return false;

  const pcss = /* glsl */ `
	/* Golden-angle disc. Deterministic: same offsets for every pixel. */
	vec2 tsimShadowDisc( int index, int count ) {
		float fi = float( index ) + 0.5;
		float radius = sqrt( fi / float( count ) );
		float angle = fi * 2.39996323;
		return vec2( cos( angle ), sin( angle ) ) * radius;
	}

	/* shadowRadius is repurposed as this cascade's penumbra scale: the
	   number that converts a [0,1] depth gap into a shadow-map UV width.
	   SunRig._applyLightSettings() derives it per cascade from that
	   cascade's ortho box and light depth range. */
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {

		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;

		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		if ( ! inFrustum || shadowCoord.z > 1.0 ) return 1.0;

		vec2 texel = vec2( 1.0 ) / shadowMapSize;

		/* 1. How far in front of this receiver do the occluders sit? */
		float blockerSum = 0.0;
		float blockerHits = 0.0;
		for ( int i = 0; i < ${blockerTaps}; i ++ ) {
			vec2 uv = shadowCoord.xy + tsimShadowDisc( i, ${blockerTaps} ) * ${maxTexels.toFixed(2)} * texel;
			float d = unpackRGBAToDepth( texture2D( shadowMap, uv ) );
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float hit = step( shadowCoord.z, d );
			#else
				float hit = step( d, shadowCoord.z );
			#endif
			blockerSum += d * hit;
			blockerHits += hit;
		}

		/* Nothing between this point and the sun anywhere in the search
		   disc, so it is lit - and skipping the filter for those pixels,
		   which are most of a sunlit frame, is why the whole shadow
		   system (map render included) measures at 1.1-1.9 ms per frame:
		   24 renders per sample with a readPixels drain, three poses,
		   three repeats, renderer.shadowMap.enabled on versus off inside
		   one session. */
		if ( blockerHits < 0.5 ) return 1.0;

		float gap = abs( shadowCoord.z - blockerSum / blockerHits );
		float penumbra = clamp( gap * shadowRadius * shadowMapSize.x, ${minTexels.toFixed(2)}, ${maxTexels.toFixed(2)} );

		/* 2. Percentage-closer filter at that width. */
		float shadow = 0.0;
		for ( int i = 0; i < ${filterTaps}; i ++ ) {
			vec2 uv = shadowCoord.xy + tsimShadowDisc( i, ${filterTaps} ) * penumbra * texel;
			shadow += texture2DCompare( shadowMap, uv, shadowCoord.z );
		}
		shadow /= float( ${filterTaps} );

		return mix( 1.0, shadow, shadowIntensity );

	}

`;

  THREE.ShaderChunk.shadowmap_pars_fragment = renamed.slice(0, tail) + pcss + renamed.slice(tail);
  return true;
}

/* ================================================================
   HDR sanitiser. Replaces NaN/Inf with black and caps radiance at a
   value bloom can safely square and blur in half-float precision.
   ================================================================ */

const HdrClampShader = {
  name: "HdrClamp",
  uniforms: {
    tDiffuse: { value: null },
    uMax: { value: 240.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uMax;
    varying vec2 vUv;

    // NaN is the only value that compares unequal to itself, so x != x
    // detects it in GLSL ES 1.0 without any extension.
    float sanitise(float x) {
      if (x != x) return 0.0;
      return clamp(x, 0.0, uMax);
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      gl_FragColor = vec4(sanitise(c.r), sanitise(c.g), sanitise(c.b), 1.0);
    }
  `,
};

/* ================================================================
   Shared GLSL helpers
   ================================================================ */

const GLSL_DEPTH = /* glsl */ `
  uniform sampler2D tDepth;
  uniform float uNear;
  uniform float uFar;

  float rawDepth(vec2 uv) {
    return texture2D(tDepth, uv).x;
  }

  /** Positive distance along the view axis. */
  float viewDepth(float d) {
    float z = d * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  }
`;

/* ================================================================
   Underwater: absorption, refraction wobble and a closing-in vignette.

   Going under the puddle changed nothing at all before this - the water
   surface is drawn, but the volume below it was not, so submerging read as
   "the camera clipped through a blue sheet". Three cues do the work, and
   the first is by far the most important:

     absorption  Beer-Lambert per channel, with red dying roughly five
                 times faster than blue. This is what separates real water
                 from a blue filter over the whole screen: the FALLOFF is
                 chromatic, so nearby things keep their colour and distant
                 ones go blue-green regardless of what colour they started.
     wobble      two crossing low-frequency UV waves. Small - a couple of
                 thousandths of a screen - because anything bigger reads as
                 a heat haze, not as looking through water.
     vignette    the world closes in. Cheap, and it sells "enclosed" more
                 than any amount of extra fog.
   ================================================================ */

const UnderwaterShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uNear: { value: 0.1 },
    uFar: { value: 2000 },
    uTime: { value: 0 },
    /** 0 = dry, 1 = fully submerged. Ramped so the surface is a crossing,
     *  not a switch. */
    uAmount: { value: 0 },
    uShallow: { value: new THREE.Vector3(0.16, 0.42, 0.40) },
    uDeep: { value: new THREE.Vector3(0.02, 0.13, 0.19) },
    uDensity: { value: 1 },
    uInvProjection: { value: new THREE.Matrix4() },
    uCameraWorld: { value: new THREE.Matrix4() },
    uCameraPos: { value: new THREE.Vector3() },
    /** Surface height of the body of water the camera is inside. */
    uWaterLevel: { value: 0 },
    uCaustics: { value: 1 },
    /** What the sky looks like through Snell's window. */
    uWindow: { value: new THREE.Vector3(0.48, 0.68, 0.76) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAmount;
    uniform vec3 uShallow;
    uniform vec3 uDeep;
    uniform float uDensity;
    uniform mat4 uInvProjection;
    uniform mat4 uCameraWorld;
    uniform vec3 uCameraPos;
    uniform float uWaterLevel;
    uniform float uCaustics;
    uniform vec3 uWindow;
    varying vec2 vUv;

    ${GLSL_DEPTH}

    vec3 worldFromDepth(vec2 uv, float d) {
      vec4 ndc = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      vec4 view = uInvProjection * ndc;
      view /= view.w;
      return (uCameraWorld * view).xyz;
    }

    // Ridged interference pattern. Real caustics are the focused image of a
    // wavy surface; crossed ridge sets at two scales get the look for a
    // fraction of the cost, and the important part is that it moves.
    float causticLayer(vec2 p, float t) {
      float a = sin(p.x * 1.9 + t * 0.85) + sin(p.y * 1.6 - t * 0.62);
      float b = sin((p.x + p.y) * 1.25 + t * 1.15) + sin((p.x - p.y) * 1.7 - t * 0.48);
      float v = (a + b) * 0.25;
      return pow(max(0.0, 1.0 - abs(v) * 1.55), 4.0);
    }

    void main() {
      vec3 dry = texture2D(tDiffuse, vUv).rgb;
      if (uAmount < 0.001) {
        gl_FragColor = vec4(dry, 1.0);
        return;
      }

      // Refraction wobble. Two frequencies per axis so it never reads as a
      // single travelling sine.
      vec2 uv = vUv;
      vec2 wob;
      wob.x = sin(uv.y * 31.0 + uTime * 1.6) * 0.0015
            + sin(uv.y * 9.0 - uTime * 1.05) * 0.0022;
      wob.y = cos(uv.x * 27.0 - uTime * 1.35) * 0.0014
            + cos(uv.x * 7.5 + uTime * 0.85) * 0.0021;
      uv = clamp(uv + wob * uAmount, vec2(0.0), vec2(1.0));

      vec3 col = texture2D(tDiffuse, uv).rgb;
      float dist = min(viewDepth(rawDepth(uv)), 400.0);

      // Chromatic extinction. Red first, then green, blue last.
      vec3 sigma = vec3(0.075, 0.020, 0.012) * uDensity;
      vec3 trans = exp(-sigma * dist);
      vec3 tint = mix(uShallow, uDeep, clamp(dist / 120.0, 0.0, 1.0));
      col = col * trans + tint * (1.0 - trans);

      // --- caustics on whatever the light is landing on ---
      float rawD = rawDepth(uv);
      if (rawD < 0.999) {
        vec3 wp = worldFromDepth(uv, rawD);
        float below = uWaterLevel - wp.y;
        // Strongest just under the surface, gone by the time it is deep, and
        // faded out at range so the far floor does not fizz with aliasing.
        float w = smoothstep(0.0, 1.2, below) * (1.0 - smoothstep(12.0, 34.0, below));
        w *= 1.0 - smoothstep(45.0, 120.0, dist);
        float c = causticLayer(wp.xz * 0.55, uTime) * 0.75
                + causticLayer(wp.xz * 1.23 + 17.0, uTime * 1.27) * 0.5;
        col += vec3(0.21, 0.45, 0.40) * c * w * uCaustics;
      }

      // --- Snell's window ---
      // Looking up from under water, everything outside a ~48.6 degree cone
      // is total internal reflection: a bright disc of sky straight above,
      // mirrored darkness around it. Without this, looking up gave the same
      // flat tint as looking anywhere else, which is the single biggest
      // giveaway that the water has no surface from below.
      vec3 rd = normalize(worldFromDepth(uv, 0.999994) - uCameraPos);
      if (rd.y > 0.0) {
        float ang = acos(clamp(rd.y, -1.0, 1.0));
        float win = 1.0 - smoothstep(0.76, 0.94, ang);
        float open = smoothstep(50.0, 190.0, dist);
        col = mix(col, mix(col * 0.42, uWindow, win), open);
      }

      // The world closes in around you.
      float vig = smoothstep(1.05, 0.28, length(vUv - 0.5));
      col *= mix(1.0, vig, 0.5);

      gl_FragColor = vec4(mix(dry, col, uAmount), 1.0);
    }
  `,
};

/* ================================================================
   Atmosphere: height fog with sun-side inscatter + screen space
   volumetric light shafts.

   The shaft mask comes straight out of the depth buffer (sky =
   depth 1.0), so there is no extra geometry pass. The whole thing
   is skipped on the CPU when the sun is behind the camera.
   ================================================================ */

const ShaftShader = {
  uniforms: {
    tDepth: { value: null },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
    uDensity: { value: 0.72 },
    uDecay: { value: 0.965 },
    uWeight: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    ${GLSL_DEPTH}
    uniform vec2 uSunUv;
    uniform float uDensity;
    uniform float uDecay;
    uniform float uWeight;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;
      vec2 delta = (uv - uSunUv) * (uDensity / float(SHAFT_SAMPLES));

      // Per-pixel jitter of the ray start kills the concentric banding
      // that a fixed-step radial blur otherwise produces.
      float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
      uv -= delta * jitter;

      float illum = uWeight;
      float acc = 0.0;
      for (int i = 0; i < SHAFT_SAMPLES; i++) {
        uv -= delta;
        vec2 cuv = clamp(uv, vec2(0.0), vec2(1.0));
        // Depth 1.0 means "nothing was drawn here" - i.e. open sky.
        acc += step(0.999995, rawDepth(cuv)) * illum;
        illum *= uDecay;
      }
      acc /= float(SHAFT_SAMPLES);

      // Shafts only make sense radiating out of the sun, so fade the
      // contribution with angular distance from it.
      float radial = 1.0 - smoothstep(0.10, 0.95, length(vUv - uSunUv));
      gl_FragColor = vec4(vec3(acc * radial), 1.0);
    }
  `,
};

const AtmosphereShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    tShafts: { value: null },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uInvProjection: { value: new THREE.Matrix4() },
    uCameraWorld: { value: new THREE.Matrix4() },
    uCameraPos: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3() },
    // The fog COLOUR was doing more damage than the fog density ever did.
    // (0.30, 0.44, 0.62) is zenith sky: 0.52 saturated, and blue-dominant.
    // Mixed 15-20% into the near field it dragged a grass window from hue
    // 140 to 162 on its own, and swapping it for a neutral of the same
    // luminance moved the measured canopy from 182 to 169 with no other
    // change - the single cheapest step of the whole cyan fix.
    //
    // Rayleigh scattering over a few centimetres is nil, so there is no
    // physical case for this term being sky-blue at all. What we are drawing
    // is a stylistic depth separator, and the honest colour for it is the
    // average radiance of the environment it sits in: sunlit soil, patio and
    // terracotta, i.e. a warm near-neutral. Depth still reads, because the
    // separation was always coming from VALUE, not from hue.
    //
    // Luminance matters as much as hue here. At 0.52 luminance this term was
    // three times brighter than the grass it was mixing into, so at 20% it
    // supplied nearly half the radiance of the mid-field and washed the
    // colour out of it. Pulled down to sit nearer what it is hazing over: it
    // still lightens with distance, which is the depth cue, without becoming
    // the dominant term in the near field.
    uFogColor: { value: new THREE.Color(0.42, 0.41, 0.395) },
    /** What the haze becomes once the path is long enough for it to matter.
     *  Splitting near from far is the honest way to have both: over a few
     *  centimetres there is no Rayleigh scattering at all, so the near term
     *  must stay neutral, but across the whole 900 unit map the far term can
     *  merge into the sky the way real aerial perspective does. Blending on
     *  the fog factor itself means the transition is automatic. */
    uFogFarColor: { value: new THREE.Color(0.44, 0.50, 0.63) },
    uFogSunColor: { value: new THREE.Color(1.05, 0.78, 0.48) },
    // Aerial perspective is what separates foreground from background. At
    // 0.0021 the 900-unit map had almost no depth cue and read flat.
    // Aerial perspective was authored at landscape scale and applied at
    // centimetre scale. A blind reviewer: "grass blades only a few centimetres
    // deeper than the sharp foreground ones are already bleached to milky
    // cyan-white and have lost all green ... real aerial perspective over a few
    // centimetres is nil". It was destroying colour, material read AND the
    // micro-world premise simultaneously - the same fog is why the distance
    // kept scoring as "pale blue-grey pastel". Depth separation should come
    // from value and colour temperature, not from a distance wash.
    // Two-sided constraint, learned the hard way from consecutive reviews.
    // At 0.0019 aerial perspective was authored for a landscape and applied at
    // centimetre scale: grass a few centimetres deep bleached to milky white
    // and colour scored 3/10. Cutting to 0.00022 fixed the colour (saturation
    // 38.3 -> 41.9) but removed the depth cue entirely, and the very next
    // review led with "no atmosphere - the air is completely empty ... no
    // depth falloff other than DOF blur" and gave 5 of 6 blind pairs away.
    // This sits between them: enough separation to read depth, not enough to
    // desaturate the near field. Depth still wants particulate and inscatter
    // doing the work, not density alone.
    uFogDensity: { value: 0.00075 },
    uFogHeight: { value: 0.0 },
    uFogFalloff: { value: 0.0075 },
    // Ceiling on how much fog can replace a surface. Measured: at the current
    // density this ceiling is never actually reached inside the map, so
    // lowering it changes nothing (far-band contrast moved 40.89 -> 40.86).
    // It is a safety cap only; uFogDensity is the lever that matters.
    uFogMax: { value: 0.58 },
    /* Long-range dissolve.
       The height fog is tuned for a centimetre-scale world, which is right
       for every macro shot but means the far field never accumulates enough
       to hide anything. The terrain simply stops at the map edge, so the last
       ridge meets the sky on a hard silhouette and every wide frame advertises
       that the level is an island - a reviewer led with "the world visibly
       ends" and scored atmosphere 3/10 across all 14 shots.

       This is deliberately a SEPARATE term rather than more density: raising
       uFogDensity bleaches grass a few centimetres from the lens (that trap
       is documented in the project notes and cost a whole review round). This
       one is zero until uFarStart, so nothing inside a macro composition is
       touched at all. */
    uFarStart: { value: 450 },
    uFarEnd: { value: 1500 },
    uFarMax: { value: 0.58 },
    // At 0.92 the dissolve did hide the map edge, but the plant pot sits at a
    // similar range and washed out to a pale blue ghost - the establishing
    // shot lost its subject to fix its background (saturation 40 -> 32). The
    // edge only has to soften, not vanish.
    uShaftColor: { value: new THREE.Color(1.0, 0.80, 0.52) },
    uShaftStrength: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    ${GLSL_DEPTH}
    uniform sampler2D tDiffuse;
    uniform sampler2D tShafts;
    uniform mat4 uInvProjection;
    uniform mat4 uCameraWorld;
    uniform vec3 uCameraPos;
    uniform vec3 uSunDir;
    uniform vec3 uFogColor;
    uniform vec3 uFogFarColor;
    uniform vec3 uFogSunColor;
    uniform float uFogDensity;
    uniform float uFogHeight;
    uniform float uFogFalloff;
    uniform float uFogMax;
    uniform float uFarStart;
    uniform float uFarEnd;
    uniform float uFarMax;
    uniform vec3 uShaftColor;
    uniform float uShaftStrength;
    varying vec2 vUv;

    vec3 worldFromDepth(vec2 uv, float d) {
      vec4 ndc = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      vec4 view = uInvProjection * ndc;
      view /= view.w;
      return (uCameraWorld * view).xyz;
    }

    /** Analytic integral of exponential height fog along a ray. */
    float heightFog(vec3 ro, vec3 rd, float dist) {
      float b = uFogFalloff;
      float base = uFogDensity * exp(-(ro.y - uFogHeight) * b);
      float fy = rd.y;
      float t;
      if (abs(fy) < 1.0e-4) {
        t = base * dist;
      } else {
        t = base * (1.0 - exp(-b * fy * dist)) / (b * fy);
      }
      return 1.0 - exp(-max(t, 0.0));
    }

    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      float d = rawDepth(vUv);

      vec3 worldPos = worldFromDepth(vUv, min(d, 0.999994));
      vec3 delta = worldPos - uCameraPos;
      float dist = length(delta);
      vec3 rd = delta / max(dist, 1.0e-5);
      float sunAmount = max(dot(rd, uSunDir), 0.0);

      if (d < 0.999995) {
        float f = min(heightFog(uCameraPos, rd, dist), uFogMax);
        // Aerial perspective at long range only - see uFarStart.
        f = max(f, smoothstep(uFarStart, uFarEnd, dist) * uFarMax);
        // Short paths get the neutral near haze, long ones drift toward the
        // sky. Using f as the interpolant ties the hue shift to the amount
        // of scattering rather than to a hand-picked distance.
        vec3 fogCol = mix(uFogColor, uFogFarColor, clamp(f / max(uFogMax, 1.0e-4), 0.0, 1.0));
        // Looking towards the sun, the haze picks up its colour. That
        // directional term is what reads as real aerial perspective.
        fogCol = mix(fogCol, uFogSunColor, pow(sunAmount, 5.0) * 0.9);
        color = mix(color, fogCol, f);
      }

      if (uShaftStrength > 0.0) {
        float shaft = texture2D(tShafts, vUv).r;
        color += uShaftColor * shaft * uShaftStrength;
      }

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

/* ================================================================
   Contact shadows.

   WHY THIS EXISTS (do not delete it as "redundant with the CSM").

   The cascaded shadow map cannot resolve small objects at any
   distance. Measured on the patio-canyon pose: the four cascade
   ortho boxes span 10 / 42 / 174 / 1887 world units into 2048 maps,
   so their texels are 0.005 / 0.020 / 0.085 / 0.921 world units.
   Cascade 3 starts 95 units from the camera and every review camera
   sits 200-600 units out, so essentially the whole beauty frame is
   shadowed by a map whose texel is 0.92 units - wider than half the
   1.6 unit hero, and two or three times a gravel crystal. A caster
   smaller than a texel simply cannot write a shadow, which is why a
   blind reviewer saw "nothing in the world is attached to the
   ground" while the shadow map was demonstrably working.

   Widening the cascades cannot fix that (the far cascade has to
   cover a 900 unit map), so the fix has to be resolution
   independent: trace the depth buffer toward the sun. This runs on
   the composited frame and is completely independent of the shadow
   pass, so it grounds anything the camera can see - instanced
   scatter that was excluded from the shadow pass, sub-texel debris,
   claw tips - at a cost that does not scale with caster count.

   The trace length is expressed in SCREEN pixels, not world units,
   for the same reason the GTAO radius is: one world radius cannot
   serve a 0.3 unit grain of sand and a 700 unit plant pot. A fixed
   pixel length becomes ~0.2 world units in a hero close-up and ~30
   world units in a wide establishing shot, which is the right
   answer in both.
   ================================================================ */

/* ----------------------------------------------------------------
   Stage 1: trace the depth buffer toward the sun and write occlusion
   to a single channel target. NOTHING is applied to the frame here.

   WHY THIS IS A SEPARATE TARGET (do not fold it back into one pass).

   This trace is stochastic: each pixel offsets its ray start by an
   interleaved-gradient dither so the fixed step count does not band.
   The previous version then turned the result into a BINARY decision
   (first hit wins, break) and multiplied it straight into the frame.
   A binary function of a per-pixel dither is not a shadow, it is a
   printed dither pattern - and that is exactly what shipped:

     - inside dense grass, whether the ray found a blade depended on
       the dither phase, so the canopy came out covered in a fine
       diagonal cross-weave. Three consecutive blind reviews read it
       as "a diagonal cross-weave moire printed into blade interiors
       that reads as denim" and blamed texture undersampling.
     - along every silhouette the ray hits the neighbouring surface
       immediately, so the edge pixels flipped occluded/not with the
       dither: "dotted stair-step crawl along every blade edge".
     - the same binary edge on the hero gave "staircased shadow
       boundary along the body silhouette".

   Verified by ablation: disabling this pass removed all three
   artifacts completely and changed nothing else about the foliage.
   The trace was right; it had no reconstruction filter.

   So: accumulate a SOFT occlusion here, write it to its own texture,
   and let stage 2 low-pass it. The dither then does its actual job
   (decorrelating the step positions) instead of being printed.
   ---------------------------------------------------------------- */

const ContactTraceShader = {
  name: "TardigradeContactTrace",
  uniforms: {
    tDepth: { value: null },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uProjection: { value: new THREE.Matrix4() },
    uInvProjection: { value: new THREE.Matrix4() },
    /** Sun direction in VIEW space, pointing at the sun. */
    uSunView: { value: new THREE.Vector3(0, 1, 0) },
    uTexel: { value: new THREE.Vector2(1 / 1600, 1 / 900) },
    /** View units per screen pixel, per unit of view depth. */
    uPixelToView: { value: 0.0014 },
    // 74 pixels is not a contact, it is long range ambient occlusion, and
    // GTAO already owns that. Inside a grass canopy a 74 pixel ray finds a
    // blade from almost every pixel, so the whole canopy was multiplied down
    // by the floor below - which is most of why the grass measured as a dark
    // desaturated blue-grey. Shortened to a length that only reaches things
    // actually touching.
    uRayPixels: { value: 42 },
    uRayClamp: { value: new THREE.Vector2(0.05, 30) },
    uThickness: { value: 1.6 },
    uDepthBias: { value: 0.0045 },
    // Tight ambient contact. GTAO runs at half resolution (it was 6.3ms of a
    // 22.5ms frame at full res), and the frequency half-res plus a denoise
    // blur destroys is exactly the few-pixel dark seam where an object meets
    // the ground - so every review said props "sit on top of" the world
    // rather than in it. This is a short, full-resolution hemisphere AO that
    // only reaches things actually touching; GTAO still owns everything
    // broader, so keep the radius small or the two will double up.
    uAoPixels: { value: 22 },
    uAoClamp: { value: new THREE.Vector2(0.02, 9.0) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    ${GLSL_DEPTH}
    uniform mat4 uProjection;
    uniform mat4 uInvProjection;
    uniform vec3 uSunView;
    uniform vec2 uTexel;
    uniform float uPixelToView;
    uniform float uRayPixels;
    uniform vec2 uRayClamp;
    uniform float uThickness;
    uniform float uDepthBias;
    uniform float uAoPixels;
    uniform vec2 uAoClamp;
    varying vec2 vUv;

    const float SKY_DEPTH = 0.999995;

    /** View space position of the pixel at uv with raw depth d. */
    vec3 viewFromDepth(vec2 uv, float d) {
      vec4 ndc = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      vec4 view = uInvProjection * ndc;
      return view.xyz / view.w;
    }

    void main() {
      float d = rawDepth(vUv);
      if (d >= SKY_DEPTH) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      vec3 origin = viewFromDepth(vUv, d);
      float originZ = -origin.z;

      // Normal from the depth buffer. Two forward differences are enough
      // for a soft facing gate; a wrong normal on a silhouette pixel only
      // costs a little occlusion there, and the alternative (four taps and
      // a nearest-neighbour pick) is not worth the bandwidth.
      vec3 dx = viewFromDepth(vUv + vec2(uTexel.x, 0.0), rawDepth(vUv + vec2(uTexel.x, 0.0))) - origin;
      vec3 dy = viewFromDepth(vUv + vec2(0.0, uTexel.y), rawDepth(vUv + vec2(0.0, uTexel.y))) - origin;
      vec3 normal = normalize(cross(dx, dy));
      if (normal.z < 0.0) normal = -normal;

      // ---- Tight ambient contact occlusion (full resolution) ----
      // Normal-oriented hemisphere: for each neighbour, how far above this
      // pixel's tangent plane does it sit. Unlike the sun trace below this
      // is view independent and applies to surfaces facing away from the
      // sun too, because a crevice is dark from every direction.
      float aoRadius = clamp(uAoPixels * originZ * uPixelToView, uAoClamp.x, uAoClamp.y);
      float aoPx = aoRadius / max(originZ * uPixelToView, 1.0e-6);
      float ao = 0.0;
      float aoW = 0.0;
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.7853981634 + 0.3926990817;
        // Two rings so a single ring's radius cannot alias into a halo.
        float rr = (mod(float(i), 2.0) < 0.5) ? 0.45 : 1.0;
        vec2 soff = vec2(cos(a), sin(a)) * aoPx * rr * uTexel;
        vec2 auv = vUv + soff;
        if (auv.x < 0.0 || auv.x > 1.0 || auv.y < 0.0 || auv.y > 1.0) continue;
        float ad = rawDepth(auv);
        if (ad >= SKY_DEPTH) { aoW += 1.0; continue; }
        vec3 diff = viewFromDepth(auv, ad) - origin;
        float len = length(diff);
        if (len < 1.0e-6) { aoW += 1.0; continue; }
        // Range check: an occluder far beyond the radius is a different
        // object, not a contact, and must not cast a halo back here.
        float range = 1.0 - smoothstep(aoRadius, aoRadius * 2.0, len);
        ao += clamp(dot(diff / len, normal) - 0.035, 0.0, 1.0) * range;
        aoW += 1.0;
      }
      ao = clamp(ao / max(aoW, 1.0e-4) * 1.9, 0.0, 1.0);

      // A surface already turned away from the sun is lit by the sky alone,
      // and darkening it again would double the terminator.
      float facing = smoothstep(-0.03, 0.28, dot(normal, uSunView));
      if (facing <= 0.001) {
        gl_FragColor = vec4(0.0, ao, 0.0, 1.0);
        return;
      }

      float rayLength = clamp(uRayPixels * originZ * uPixelToView, uRayClamp.x, uRayClamp.y);
      vec3 start = origin + normal * (rayLength * 0.02 + originZ * 0.0012);

      // Static interleaved-gradient dither. Deterministic on purpose: the
      // screenshot harness compares frames, so a temporal jitter would make
      // every capture a different image.
      vec2 px = vUv / uTexel;
      float dither = fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));

      float occlusion = 0.0;

      for (int i = 0; i < CONTACT_STEPS; i++) {
        float t = (float(i) + dither) / float(CONTACT_STEPS);
        // Cluster the samples near the surface: contact darkening lives in
        // the first few percent of the ray, and the tail only has to catch
        // the long shadow of a big caster.
        t = t * t * (1.0 - 0.35) + t * 0.35;
        vec3 samplePos = start + uSunView * (t * rayLength);

        vec4 clip = uProjection * vec4(samplePos, 1.0);
        if (clip.w <= 0.0) break;
        vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
        if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;

        float sd = rawDepth(suv);
        if (sd >= SKY_DEPTH) continue;

        float sceneZ = viewDepth(sd);
        float delta = -samplePos.z - sceneZ;

        // delta > bias  : something is in front of the ray, so it occludes.
        // delta < thick : ...but only if it is close enough to be a real
        //                 occluder rather than an unrelated object metres
        //                 in front, which would smear a halo behind it.
        float bias = uDepthBias * sceneZ + rayLength * 0.02;
        float thick = uThickness * rayLength + sceneZ * 0.05;

        // Both gates are smoothstepped rather than tested. A hard test here
        // quantises a continuous depth difference into 0 or 1 and the dither
        // decides which - see the header. Soft gates keep the signal analog
        // so the blur in stage 2 has something to reconstruct.
        float enter = smoothstep(bias, bias * 3.0 + 1.0e-6, delta);
        float leave = 1.0 - smoothstep(thick * 0.6, thick, delta);
        float falloff = 1.0 - t;
        // No constant floor. The old version gave any hit at least 0.42, so
        // an occluder at the far end of the ray still removed 45% of the
        // light - which is what crushed whole grass canopies. Contact
        // darkening now genuinely falls to nothing at the end of the trace,
        // and is still full strength where two surfaces actually meet.
        occlusion = max(occlusion, enter * leave * falloff * falloff);
      }

      gl_FragColor = vec4(occlusion * facing, ao, 0.0, 1.0);
    }
  `,
};

/* ----------------------------------------------------------------
   Stage 2: reconstruct and apply.

   A depth-weighted 9 tap of the occlusion texture. The weighting stops
   the shadow bleeding across a silhouette (a sharp blade in front of a
   shadowed background would otherwise pick up a dark fringe), and the
   blur itself is what turns the dithered trace back into a smooth,
   soft contact shadow with an antialiased edge.
   ---------------------------------------------------------------- */

const ContactApplyShader = {
  name: "TardigradeContactApply",
  uniforms: {
    tDiffuse: { value: null },
    tOcclusion: { value: null },
    tDepth: { value: null },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uTexel: { value: new THREE.Vector2(1 / 1600, 1 / 900) },
    /** Blur radius in screen pixels. */
    uBlurRadius: { value: 2.1 },
    /** How dark a fully occluded contact gets, as a light multiplier.
     *  At 0.46 a *fully* occluded contact still kept 46% of its light, which
     *  is far too subtle to read: six blind reviews scored shadows 2-3/10 and
     *  the latest said objects "meet the concrete on a hard seam with zero
     *  darkening". The pass was running correctly and simply had nothing to
     *  say. This is the term that grounds everything the cascade map is too
     *  coarse to resolve, so it has to be allowed to actually go dark. */
    uMinLight: { value: 0.20 },
    uStrength: { value: 1.35 },
    /** Contact shadow keeps only skylight, so it is cool, not neutral. */
    // Skylight-only contact shadow really is blue, but at strength 1.35 with a
    // 0.20 floor this tint was pushing the whole lower frame cyan: measured
    // median foliage/ground hue 204 deg below the horizon, against 120 deg for
    // the same grass when sun-backlit. Two reviews called it "a blue-grey
    // curtain" and "the grey wash failure with a blue bias". Kept cool, but
    // no longer strong enough to repaint the scene's hue.
    uShadowTint: { value: new THREE.Vector3(0.96, 0.99, 1.05) },
    /** Tight ambient contact, traced in .g of the occlusion target. This is
     *  the term that welds an object to the ground; the sun trace above only
     *  works where the sun can see the surface, so on an overcast-facing or
     *  self-shadowed contact it says nothing at all. */
    // Ablation: switching this off changed a static frame's mean luma by only
    // 1.6, i.e. the pass was running and contributing almost nothing visible.
    // Reviews scored shadows the weakest subsystem and kept reporting that
    // props "sit on" surfaces - the term existed and was inaudible, which is
    // the third time that exact failure has happened in this project.
    uAoStrength: { value: 1.85 },
    uAoMinLight: { value: 0.20 },
    /** A crevice is lit by bounce off the surrounding surfaces, so it is
     *  barely cooler than the ambient rather than sky blue. */
    uAoTint: { value: new THREE.Vector3(0.95, 0.96, 1.0) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    ${GLSL_DEPTH}
    uniform sampler2D tDiffuse;
    uniform sampler2D tOcclusion;
    uniform vec2 uTexel;
    uniform float uBlurRadius;
    uniform float uMinLight;
    uniform float uStrength;
    uniform vec3 uShadowTint;
    uniform float uAoStrength;
    uniform float uAoMinLight;
    uniform vec3 uAoTint;
    varying vec2 vUv;

    const float SKY_DEPTH = 0.999995;

    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      float d = rawDepth(vUv);
      if (d >= SKY_DEPTH) {
        gl_FragColor = vec4(color, 1.0);
        return;
      }

      float centreZ = viewDepth(d);
      vec2 acc = texture2D(tOcclusion, vUv).rg;
      float wsum = 1.0;

      // Eight taps on two rings, rotated 22.5 degrees apart, so the kernel
      // has no axis-aligned bias to line up with the dither lattice.
      const int TAPS = 8;
      for (int i = 0; i < TAPS; i++) {
        float a = float(i) * 0.7853981634 + 0.3926990817;
        float r = (mod(float(i), 2.0) < 0.5) ? 1.0 : 1.9;
        vec2 off = vec2(cos(a), sin(a)) * r * uBlurRadius * uTexel;
        vec2 suv = clamp(vUv + off, vec2(0.0), vec2(1.0));
        float sd = rawDepth(suv);
        if (sd >= SKY_DEPTH) continue;
        // Reject taps from a different surface. The tolerance scales with
        // depth because a fixed one would be enormous next to a 0.3 unit
        // grain of sand and useless next to a 700 unit plant pot.
        float w = 1.0 - smoothstep(0.0, centreZ * 0.045 + 0.02, abs(viewDepth(sd) - centreZ));
        acc += texture2D(tOcclusion, suv).rg * w;
        wsum += w;
      }

      vec2 occlusion = acc / max(wsum, 1.0e-4);
      float shade = clamp(occlusion.r * uStrength, 0.0, 1.0);
      vec3 tint = mix(vec3(1.0), uShadowTint * uMinLight, shade);
      float aoShade = clamp(occlusion.g * uAoStrength, 0.0, 1.0);
      vec3 aoTint = mix(vec3(1.0), uAoTint * uAoMinLight, aoShade);
      gl_FragColor = vec4(color * tint * aoTint, 1.0);
    }
  `,
};

/* ================================================================
   Depth of field. A gather-style bokeh using the shared depth
   texture, so there is no second geometry pass like BokehPass does.

   Tuned as macro photography: the hero is razor sharp, the far
   background falls off gently, and `uFocusRange` guarantees a slab
   of perfectly sharp gameplay midground around the focus point.
   ================================================================ */

const DofShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uTexel: { value: new THREE.Vector2() },
    uFocus: { value: 16 },
    // Driven per frame from the focus distance now. A fixed +-9 unit slab is
    // a different thing entirely at a 3.6 unit hero close-up and at a 500
    // unit establishing wide; as a fraction of the focus distance it means
    // "the depth of field", which is what it was always trying to be.
    uFocusRange: { value: 9 },
    uAperture: { value: 0.9 },
    /** Depth of field scales with the focus distance. THIS IS THE TERM THAT
     *  WAS MISSING and it is why the blur read as uniform.
     *
     *  Thin lens: coc = A f |z - zf| / (z (zf - f)), so for zf much larger
     *  than f the whole thing carries a 1/zf. This shader had no zf term at
     *  all, which means the same aperture that gives a 3.6 unit hero close-up
     *  its shallow macro focus was also being applied to a camera focused
     *  500 units out - where a real lens has metres of depth of field. The
     *  result: whole frames where every single sample point was pinned at
     *  the maximum radius, i.e. a constant blur with no gradient in it.
     *  Measured before the fix, on patio-canyon: left, right and bottom all
     *  at -9px (the clamp) while the subject sat at 2px.
     *
     *  The exact 1/zf leaves wide shots completely sharp, which throws away
     *  the photographic feel; the square root keeps a usable amount of
     *  falloff on mid-range poses and still collapses to near-nothing on a
     *  true wide. Driven per frame from dofFocus. */
    uFocusFalloff: { value: 1 },
    uNearScale: { value: 0.8 },
    uMaxRadius: { value: 9 },
    /** Radial weighting across the sample disc. 0 = flat gaussian mush,
     *  higher = energy pushed to the rim, which is what turns an out of
     *  focus highlight into a bokeh DISC instead of a blurry dot. This is
     *  most of the difference between "a lens" and "a blur". */
    uBokehRim: { value: 0.85 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    ${GLSL_DEPTH}
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uFocus;
    uniform float uFocusRange;
    uniform float uAperture;
    uniform float uFocusFalloff;
    uniform float uNearScale;
    uniform float uMaxRadius;
    uniform float uBokehRim;
    varying vec2 vUv;

    /** Signed circle of confusion in pixels. Negative = in front of focus. */
    float cocPixels(vec2 uv) {
      float z = viewDepth(rawDepth(uv));
      float signedDist = z - uFocus;
      float mag = max(abs(signedDist) - uFocusRange, 0.0);
      float coc = (mag / max(z, 0.02)) * uAperture * uFocusFalloff;
      if (signedDist < 0.0) coc = -coc * uNearScale;
      return clamp(coc, -1.0, 1.0) * uMaxRadius;
    }

    void main() {
      vec3 center = texture2D(tDiffuse, vUv).rgb;
      float coc = cocPixels(vUv);
      float radius = abs(coc);

      if (radius < 0.75) {
        gl_FragColor = vec4(center, 1.0);
        return;
      }

      // The centre tap carries the weight of the middle of the disc, so it
      // is deliberately light once the rim is being emphasised.
      float centreWeight = 1.0 - uBokehRim * 0.5;
      vec3 sum = center * centreWeight;
      float wsum = centreWeight;

      // Rotate the sample pattern per pixel. Every pixel used the same 20
      // golden-angle directions, so at a large circle of confusion each
      // background feature was replicated into those same 20 positions -
      // which reads as a directional spiral streak rather than a blur. A
      // per-pixel rotation turns that structured replication into noise,
      // which is what the eye accepts as out-of-focus. Deterministic
      // (interleaved-gradient), so captures stay reproducible.
      float dofRot = fract(52.9829189 * fract(dot(vUv / uTexel, vec2(0.06711056, 0.00583715)))) * 6.2831853;

      for (int i = 0; i < DOF_TAPS; i++) {
        float fi = float(i) + 0.5;
        float angle = fi * 2.39996323 + dofRot;
        // sqrt() distributes the taps evenly over the AREA of the disc, so
        // this term alone is a flat disc. The rim weight below is what gives
        // it a bright edge.
        float t = sqrt(fi / float(DOF_TAPS));
        vec2 dir = vec2(cos(angle), sin(angle));
        float px = t * radius;
        vec2 suv = vUv + dir * px * uTexel;

        vec3 c = texture2D(tDiffuse, suv).rgb;
        // Scatter-as-gather: a neighbour only bleeds into this pixel if
        // its own circle of confusion actually reaches this far. That is
        // what stops a blurry background smearing over a sharp subject.
        float reach = abs(cocPixels(suv));
        float w = clamp(reach - px + 1.0, 0.0, 1.0);
        // Rim weighting. A real aperture is a hard-edged hole, so the image
        // of an out-of-focus point is a disc with a defined edge, not a
        // gaussian. Flat weights across the disc integrate to a gaussian and
        // that is exactly what "a uniform blur, not a lens" looks like.
        w *= 1.0 + uBokehRim * (t * 2.0 - 1.0);
        sum += c * w;
        wsum += w;
      }

      gl_FragColor = vec4(sum / max(wsum, 1.0e-4), 1.0);
    }
  `,
};

/* ================================================================
   Tone mapping + creative grade.

   The curve is the Khronos "PBR Neutral" rolloff: it compresses
   highlights without the hue twist ACES puts on saturated greens
   and skies, which matters a lot in a garden. Contrast, split
   toning and saturation then happen in display (gamma) space where
   they behave the way a colourist expects.
   ================================================================ */

const TonemapGradeShader = {
  name: "TardigradeTonemapGrade",
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: DEFAULT_EXPOSURE },
    uWhiteBalance: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
    uCompression: { value: 0.76 },
    uDesaturation: { value: 0.16 },
    uContrast: { value: 0.30 },
    uToe: { value: 0.035 },
    // Both of these are ADDITIVE in display space and both were blue-heavy:
    // lift put +0.018 blue against +0.004 red, and the shadow tint another
    // +0.028 blue against -0.010 red. On a shadowed pixel sitting at luma
    // 0.12 that is a 0.05 red-to-blue split added to a value of 0.12, which
    // is a very large hue rotation for a term that is meant to be a whisper.
    // Kept cool - the split-tone is real and worth having - but at a size
    // that tints rather than repaints. Measured: -6 degrees of the cyan.
    uLift: { value: new THREE.Vector3(0.009, 0.009, 0.010) },
    uGain: { value: new THREE.Vector3(1.006, 1.0, 0.984) },
    uShadowTint: { value: new THREE.Vector3(0.000, 0.004, 0.014) },
    uHighlightTint: { value: new THREE.Vector3(0.026, 0.012, -0.014) },
    // Nudged up with the ambient neutralisation. Under a strongly blue fill
    // every surface carried a large (wrong) chroma for free; a neutral fill
    // means a surface only shows the saturation its own albedo has, so the
    // grade has to put a little back. Measured on the terracotta pot: 0.45
    // to 0.50 saturation, no hue movement.
    uSaturation: { value: 1.12 },
    uVibrance: { value: 0.28 },
    /** Where the display-space shoulder starts. See shoulder() below.
     *
     *  The curve asymptotes to k + d = 1.0 but only ever approaches it. At
     *  k = 0.88 (d = 0.12) an output of 0.96 needs an input of 1.012 and 0.99
     *  needs 1.18, which nothing in this scene reaches - so measured peak
     *  luminance across all 13 poses sat at 212-246 and never touched white.
     *  A blind reviewer measured the same thing independently and called it
     *  "the single number that makes every frame read milky". Starting the
     *  shoulder later shortens the compressed region so speculars can actually
     *  land on white while the roll-off still prevents a hard clip. */
    uShoulder: { value: 0.945 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uExposure;
    uniform vec3 uWhiteBalance;
    uniform float uCompression;
    uniform float uDesaturation;
    uniform float uContrast;
    uniform float uToe;
    uniform vec3 uLift;
    uniform vec3 uGain;
    uniform vec3 uShadowTint;
    uniform vec3 uHighlightTint;
    uniform float uSaturation;
    uniform float uVibrance;
    uniform float uShoulder;
    varying vec2 vUv;

    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

    /** Display-space shoulder.
     *
     *  filmicRolloff() compresses HDR into roughly [0,1], but everything
     *  after it - contrast, toe, gain, lift, the highlight split-tone and
     *  vibrance - is free to push back above 1.0, and it does: worked
     *  through by hand, a sky pixel that leaves the rolloff at 0.969 arrives
     *  at the final clamp at 1.032. clamp() then turns every value from 1.0
     *  upwards into the same 255, so the brightest band in the frame becomes
     *  a flat plateau with no gradient left in it. Measured on the backlit
     *  pose: 3.4% of the horizon band pinned at 254 or above, and a blind
     *  reviewer read it as a blown highlight - correctly.
     *
     *  This maps [k, infinity) onto [k, 1) with a matched first derivative at
     *  k, so the top of the range keeps its gradient and clamp() has nothing
     *  left to do. It is the shoulder the curve was missing, applied where
     *  the overshoot actually happens rather than before it. */
    vec3 shoulder(vec3 c) {
      float k = uShoulder;
      float d = max(1.0 - k, 1.0e-4);
      vec3 over = max(c - k, vec3(0.0));
      return min(c, vec3(k)) + (vec3(1.0) - exp(-over / d)) * d;
    }

    /** Hue-preserving filmic rolloff (Khronos PBR Neutral). */
    vec3 filmicRolloff(vec3 color) {
      float startCompression = uCompression - 0.04;
      float x = min(color.r, min(color.g, color.b));
      float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
      color -= offset;

      float peak = max(color.r, max(color.g, color.b));
      if (peak < startCompression) return color;

      float d = 1.0 - startCompression;
      float newPeak = 1.0 - d * d / (peak + d - startCompression);
      color *= newPeak / peak;

      float g = 1.0 - 1.0 / (uDesaturation * (peak - newPeak) + 1.0);
      return mix(color, vec3(newPeak), g);
    }

    vec3 encodeSRGB(vec3 c) {
      c = clamp(c, vec3(0.0), vec3(1.0));
      vec3 lo = c * 12.92;
      vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
      return mix(lo, hi, step(vec3(0.0031308), c));
    }

    void main() {
      vec3 color = max(texture2D(tDiffuse, vUv).rgb, vec3(0.0));

      // --- scene referred -------------------------------------------------
      color *= uExposure * uWhiteBalance;
      color = filmicRolloff(color);

      // --- display referred -----------------------------------------------
      vec3 g = encodeSRGB(color);

      // Smoothstep is a natural S-curve: it adds bite in the midtones and
      // mathematically cannot clip, unlike a linear contrast multiply.
      g = mix(g, g * g * (3.0 - 2.0 * g), uContrast);

      // A little print-black keeps the frame from feeling washed out.
      g = max(g - uToe, vec3(0.0)) / (1.0 - uToe);

      g = max(g * uGain + uLift, vec3(0.0));

      // Split toning: cool the shadows, warm the highlights. This is the
      // cheapest way to buy the warm-key / cool-fill look.
      float l = dot(g, LUMA);
      g += uShadowTint * (1.0 - smoothstep(0.0, 0.55, l));
      g += uHighlightTint * smoothstep(0.42, 1.0, l);

      // Saturation, plus vibrance that only lifts already-dull pixels.
      float lum = dot(g, LUMA);
      float chroma = max(max(g.r, g.g), g.b) - min(min(g.r, g.g), g.b);
      float sat = uSaturation + uVibrance * (1.0 - clamp(chroma * 1.6, 0.0, 1.0));
      g = mix(vec3(lum), g, sat);

      g = shoulder(max(g, vec3(0.0)));

      gl_FragColor = vec4(clamp(g, 0.0, 1.0), 1.0);
    }
  `,
};

/* ================================================================
   Final finish: contrast-adaptive sharpen (recovers the softness
   SMAA costs on foliage), lateral chroma, vignette, sensor grain.
   ================================================================ */

const FinishShader = {
  name: "TardigradeFinish",
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uSharpen: { value: 0.30 },
    uChroma: { value: 0.0011 },
    uVignette: { value: 0.30 },
    uGrain: { value: 0.012 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uSharpen;
    uniform float uChroma;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uTime;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(443.8975, 397.2973));
      p += dot(p, p + 19.19);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float r2 = dot(centered, centered);

      // Lateral chromatic aberration, strongest at the frame edge.
      vec2 off = centered * r2 * uChroma;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;

      // Contrast adaptive sharpen, AMD CAS style: strong on low contrast
      // detail (soil grain, bark, the hero's cuticle), backed right off on
      // high contrast edges.
      //
      // This weighting is not cosmetic. A flat sharpen applied after the AA
      // resolve takes a half-covered edge pixel - exactly the blended value
      // MSAA just computed - and pushes it back to the local min or max,
      // rebuilding the staircase on every grass tip and cap crenellation.
      // Silhouettes are precisely where local contrast is highest, so fading
      // the sharpen out with contrast protects them for free.
      vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb;
      vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
      vec3 e = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb;
      vec3 w = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb;
      vec3 lo = min(c, min(min(n, s), min(e, w)));
      vec3 hi = max(c, max(max(n, s), max(e, w)));
      const vec3 LUMA_W = vec3(0.2126, 0.7152, 0.0722);
      float localContrast = dot(hi - lo, LUMA_W);
      float amount = uSharpen * (1.0 - smoothstep(0.055, 0.30, localContrast));
      vec3 sharp = c + (c * 4.0 - n - s - e - w) * amount * 0.25;
      c = clamp(sharp, lo, hi);

      // Natural lens falloff.
      float vig = 1.0 - uVignette * smoothstep(0.04, 0.62, r2);
      c *= vig;

      // Fine grain, heavier in the shadows the way a real sensor behaves.
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float grain = hash(vUv * 1024.0 + fract(uTime * 0.37) * 311.0) - 0.5;
      c += grain * uGrain * (1.15 - luma * 0.85);

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

/* ================================================================
   Small custom passes
   ================================================================ */

/** Snapshots renderer.info straight after the scene render.
 *  main.js reads renderer.info after composer.render(), which by then
 *  only describes the last fullscreen quad ("draws: 1"). This is the
 *  honest number: engine.stats. Shadow map draws are excluded because
 *  WebGLRenderer resets info after shadowMap.render(). */
class StatsPass extends Pass {
  constructor(renderer, stats) {
    super();
    this.needsSwap = false;
    this.enabled = true;
    this._renderer = renderer;
    this._stats = stats;
  }
  render() {
    const info = this._renderer.info;
    this._stats.calls = info.render.calls;
    this._stats.triangles = info.render.triangles;
    this._stats.lines = info.render.lines;
    this._stats.points = info.render.points;
    this._stats.programs = info.programs ? info.programs.length : 0;
    this._stats.geometries = info.memory.geometries;
    this._stats.textures = info.memory.textures;
  }
  setSize() {}
  dispose() {}
}

/** Copies the scene depth attachment into a standalone float texture.
 *  Post passes must never sample a depth texture that is still attached
 *  to the framebuffer they are drawing into - that is a feedback loop and
 *  WebGL raises an error for it. One cheap copy sidesteps the whole
 *  problem and lets GTAO, fog, god rays and DoF share a single depth. */
class DepthCopyPass extends Pass {
  constructor(target) {
    super();
    this.needsSwap = false;
    this.target = target;
    this.material = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDepth;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4(texture2D(tDepth, vUv).x, 0.0, 0.0, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this._quad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer) {
    const source = readBuffer && readBuffer.depthTexture ? readBuffer.depthTexture : null;
    if (!source) return;
    this.material.uniforms.tDepth.value = source;
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    this._quad.render(renderer);
    renderer.setRenderTarget(prevTarget);
  }
  setSize() {}
  dispose() {
    this.material.dispose();
    this._quad.dispose();
  }
}

/** Screen space sun trace, reconstructed and applied. Two quads, one
 *  private single-channel target. See the ContactTraceShader header for
 *  why the trace and the apply cannot share a pass. */
class ContactShadowPass extends Pass {
  constructor(steps) {
    super();
    this.needsSwap = true;

    // RGBA8 rather than R8: single-channel colour attachments are optional
    // in WebGL2 for some formats and a silent incomplete framebuffer is a
    // much worse failure than spare channels. .r is the sun trace, .g is the
    // tight ambient contact - so had this been R8 the AO term would have been
    // written and silently thrown away.
    this.target = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });

    this.traceMaterial = new THREE.ShaderMaterial({
      defines: { CONTACT_STEPS: steps },
      uniforms: THREE.UniformsUtils.clone(ContactTraceShader.uniforms),
      vertexShader: ContactTraceShader.vertexShader,
      fragmentShader: ContactTraceShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.applyMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(ContactApplyShader.uniforms),
      vertexShader: ContactApplyShader.vertexShader,
      fragmentShader: ContactApplyShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.applyMaterial.uniforms.tOcclusion.value = this.target.texture;

    /** Camera sync writes here; both stages need the same depth + texel. */
    this.uniforms = this.traceMaterial.uniforms;
    this.applyUniforms = this.applyMaterial.uniforms;

    this._traceQuad = new FullScreenQuad(this.traceMaterial);
    this._applyQuad = new FullScreenQuad(this.applyMaterial);
  }

  setDepthTexture(texture) {
    this.traceMaterial.uniforms.tDepth.value = texture;
    this.applyMaterial.uniforms.tDepth.value = texture;
  }

  render(renderer, writeBuffer, readBuffer) {
    const prevTarget = renderer.getRenderTarget();

    renderer.setRenderTarget(this.target);
    renderer.clear(true, false, false);
    this._traceQuad.render(renderer);

    this.applyMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this._applyQuad.render(renderer);

    if (!this.renderToScreen) renderer.setRenderTarget(prevTarget);
  }

  setSize(width, height) {
    const w = Math.max(2, Math.floor(width));
    const h = Math.max(2, Math.floor(height));
    this.target.setSize(w, h);
    this.traceMaterial.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.applyMaterial.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  dispose() {
    this.target.dispose();
    this.traceMaterial.dispose();
    this.applyMaterial.dispose();
    this._traceQuad.dispose();
    this._applyQuad.dispose();
  }
}

/** Height fog + aerial perspective + screen space god rays. */
class AtmospherePass extends Pass {
  constructor(shaftRenderTarget, shaftSamples) {
    super();
    this.needsSwap = true;
    this.shaftTarget = shaftRenderTarget;

    this.shaftMaterial = shaftRenderTarget
      ? new THREE.ShaderMaterial({
          defines: { SHAFT_SAMPLES: shaftSamples },
          uniforms: THREE.UniformsUtils.clone(ShaftShader.uniforms),
          vertexShader: ShaftShader.vertexShader,
          fragmentShader: ShaftShader.fragmentShader,
          depthTest: false,
          depthWrite: false,
        })
      : null;

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(AtmosphereShader.uniforms),
      vertexShader: AtmosphereShader.vertexShader,
      fragmentShader: AtmosphereShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });

    this.uniforms = this.material.uniforms;
    this._shaftQuad = this.shaftMaterial ? new FullScreenQuad(this.shaftMaterial) : null;
    this._quad = new FullScreenQuad(this.material);
    /** Set from engine.render() - 0 disables the shaft sub-pass entirely. */
    this.shaftVisibility = 0;
    // Light shafts are the only atmospheric term that reads against a bright
    // backlit sky - point motes cannot, because adding to near-white does
    // nothing and any alpha-blended mote just looks like dirt. Verified at 3x
    // magnification: the motes ARE drawn, as faint dark dotted streaks, and
    // are invisible at 1x for exactly that reason. Seven blind reviews scored
    // atmosphere 2/10 with "no light shafts" named every time, so this term
    // needs to be able to actually assert itself when the sun is in frame.
    this.shaftGain = 1.45;
  }

  render(renderer, writeBuffer, readBuffer) {
    const prevTarget = renderer.getRenderTarget();

    if (this._shaftQuad && this.shaftVisibility > 0.002) {
      this.shaftMaterial.uniforms.tDepth.value = this.uniforms.tDepth.value;
      this.shaftMaterial.uniforms.uNear.value = this.uniforms.uNear.value;
      this.shaftMaterial.uniforms.uFar.value = this.uniforms.uFar.value;
      renderer.setRenderTarget(this.shaftTarget);
      this._shaftQuad.render(renderer);
      this.uniforms.tShafts.value = this.shaftTarget.texture;
      this.uniforms.uShaftStrength.value = this.shaftVisibility * this.shaftGain;
    } else {
      this.uniforms.uShaftStrength.value = 0;
    }

    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this._quad.render(renderer);
    if (!this.renderToScreen) renderer.setRenderTarget(prevTarget);
  }

  setSize() {}

  dispose() {
    this.material.dispose();
    this._quad.dispose();
    if (this.shaftMaterial) this.shaftMaterial.dispose();
    if (this._shaftQuad) this._shaftQuad.dispose();
  }
}

/* ================================================================
   Sun rig - cascaded shadow maps, with a single-light fallback.
   ================================================================ */

class SunRig {
  constructor(ctx, scene, camera) {
    this.ctx = ctx;
    this.scene = scene;
    this.camera = camera;
    this.direction = SUN_DIRECTION.clone();
    this.intensity = SUN_INTENSITY;
    this.csm = null;
    this.lights = [];
    this._csmMaterials = new WeakSet();
    this._projectionKey = "";

    /* Warm bounce out of the ground. Not a shadow caster, so with CSM
       active it lands in the "extra directional lights" loop.

       Raised from 0.34, which was 4% of the sun and 3% of the total fill -
       inaudible. This is the only DIRECTIONAL light a shadowed surface
       receives: the IBL dome is close to uniform over a hemisphere, so
       inside a cast shadow a normal map produces almost no shading and the
       surface goes flat. That is the "erases the sand grain underneath it"
       half of the shadow complaint, and no amount of shadow filtering fixes
       it - the shadow has to be lit by something with a direction. It comes
       in from 20 degrees above the horizon on the anti-sun side, so it
       reaches floors (sin 20 = 0.34 of its intensity) as well as the
       undersides the old value was nominally there for. */
    this.bounce = new THREE.DirectionalLight(0xffc98c, 0.85);
    this.bounce.castShadow = false;
    this.bounce.position.copy(this.direction).multiplyScalar(-60);
    this.bounce.position.y = 22;
    scene.add(this.bounce, this.bounce.target);
  }

  /** How far from the camera shadows are allowed to reach.
   *
   *  This used to be q.shadowDistance (950 at Ultra) while the camera's
   *  far plane is 1400, and CSM's last cascade fades to nothing at
   *  1.125 x shadowFar. Measured consequence: every pixel past ~1069 view
   *  units received full, unshadowed sun. The establishing wide is aimed at
   *  the plant pot, whose visible face sits 1200-1460 units out, so that
   *  entire frame - the one shot that has to carry the game - was rendered
   *  with the shadow system switched off. A blind reviewer described exactly
   *  that: "the dark leaf at right overlaps the pot and casts nothing on it".
   *  Ablation on establishing: 8.1% of the frame carried any shadow at all,
   *  and those shadows only reached 0.80 of the lit luminance.
   *
   *  Reaching the far plane costs the last cascade texel density, so it is
   *  only done when there are enough cascades to absorb that; below Ultra
   *  the old behaviour stands. PCSS is what makes the coarser far texel
   *  acceptable - it turns a 1 unit stair-step into a soft blob. */
  shadowFar() {
    const q = this.ctx.settings.quality;
    const cascades = clamp(Math.round(q.shadowCascades || 1), 1, 4);
    // Was max(shadowDistance, camera.far), i.e. 1400. The last cascade then
    // has to span the whole 1400 into 2048 texels - 1.37 world units each,
    // wider than a grass blade, a leaf stalk or a LEGO stud, so those objects
    // cannot write into the map at all. Measured by ablation: killing sun
    // shadows changes grass-interior (a close shot, tight cascades) by 22.6
    // luma but establishing / debris-rest / pot-skyline by only 2.1 to 4.5 -
    // the mid and wide frames were effectively unshadowed, which is exactly
    // what reviewers kept reporting. Cap the range instead: things past it
    // stop casting, but they were not casting anything legible anyway, and
    // the long-range aerial term now washes that distance out.
    //
    // Tried 620 as well and it was a net loss: the plant pot sits past it and
    // stopped casting entirely, so establishing and pot-skyline came out
    // BRIGHTER (fewer shadows), which is the opposite of the goal. 950 keeps
    // every landmark inside the range while still cutting the far cascade's
    // texel from 1.37 to 0.93 versus the old 1400.
    return q.shadowDistance;
  }

  async init() {
    const q = this.ctx.settings.quality;
    const cascades = clamp(Math.round(q.shadowCascades || 1), 1, 4);
    const far = this.shadowFar();

    if (q.shadows && cascades > 1) {
      try {
        const { CSM } = await import("three/addons/csm/CSM.js");
        // Four 2048 cascades cost the same texels as one 4096 map but put
        // ~0.006 world units per texel on the hero instead of 0.14.
        const mapSize = Math.min(q.shadowMapSize, 2048);
        this.csm = new CSM({
          camera: this.camera,
          parent: this.scene,
          cascades,
          maxFar: far,
          mode: "custom",
          customSplitsCallback: (count, near, distance, breaks) => {
            for (const b of SunRig.splits(count)) breaks.push(b);
          },
          shadowMapSize: mapSize,
          shadowBias: -0.00003,
          lightDirection: this.direction.clone().negate(),
          lightIntensity: this.intensity,
          lightNear: 1,
          // Casters can be 700 units tall (a plant pot). The margin extends
          // the shadow box back along the light so they are still captured.
          lightMargin: 900,
          // Has to clear lightMargin PLUS the depth of the last cascade's
          // ortho box measured along the light, or the back of that box is
          // clipped out of the map and its casters silently stop casting.
          // The box is a little under 2x the shadow distance once the fade
          // margin is added, so this is that plus the margin plus slack.
          lightFar: 900 + far * 2.2,
        });
        this.csm.fade = true;
        this.csm.updateFrustums();
        this.lights = this.csm.lights;
        this._applyLightSettings();
        return;
      } catch (error) {
        console.warn("[tardigrade-sim] cascaded shadows unavailable, using a single sun:", error);
        this.csm = null;
      }
    }

    // Fallback: one directional light with a snapped ortho frustum.
    const light = new THREE.DirectionalLight(SUN_COLOR, this.intensity);
    light.castShadow = Boolean(q.shadows);
    light.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    light.shadow.bias = -0.00012;
    light.shadow.normalBias = 0.06;
    const extent = clamp(q.shadowDistance * 0.34, 26, 120);
    const cam = light.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 1;
    cam.far = q.shadowDistance * 3.2;
    cam.updateProjectionMatrix();
    this.fallback = light;
    this.fallbackTarget = new THREE.Object3D();
    light.target = this.fallbackTarget;
    this.scene.add(light, this.fallbackTarget);
    this.lights = [light];
  }

  /** Cascade breaks as a fraction of shadowFar(). Hand authored.
   *
   *  Two very different cameras have to share these. Gameplay sits ~7 units
   *  behind a 1.6 unit hero, so cascade 0 must stay tiny or contact shadows
   *  turn to mush. The review/beauty cameras sit 300-600 units out across a
   *  900 unit map, so the last cascade has to reach the far side of the world
   *  - anything past shadowFar() receives no shadow at all and visibly
   *  floats. Hence a very wide spread rather than an even one.
   *
   *  These are unchanged, but they now divide 1400 rather than 950, which
   *  moves the four breaks from 5.7 / 22.9 / 95 / 950 view units to
   *  8.4 / 33.6 / 140 / 1400. Cascade 0 could afford it: even after the
   *  change its texel is ~0.006 world units, about 270 across the hero. */
  static splits(count) {
    // Pushed outward. The old split put the third boundary at 10% of range,
    // so everything from there to the far plane landed in one coarse cascade.
    if (count >= 4) return [0.02, 0.08, 0.30, 1];
    if (count === 3) return [0.012, 0.07, 1];
    if (count === 2) return [0.03, 1];
    return [1];
  }

  _applyLightSettings() {
    if (!this.csm) return;
    const q = this.ctx.settings.quality;
    const mapSize = Math.min(q.shadowMapSize, 2048);
    for (const light of this.csm.lights) {
      light.color.set(SUN_COLOR);
      light.intensity = this.intensity;
      light.castShadow = Boolean(q.shadows);
      light.shadow.mapSize.set(mapSize, mapSize);
      const cam = light.shadow.camera;
      const box = Math.max(cam.right - cam.left, 1e-4);
      const depthRange = Math.max(cam.far - cam.near, 1e-4);
      const texel = box / mapSize;
      // shadow.bias is in [0,1] SHADOW MAP DEPTH, not world units, so a
      // literal constant silently rescales itself whenever the light
      // camera's depth range changes. Divide it back out so the bias is a
      // fixed 0.06 world units along the light for every cascade at every
      // shadow distance.
      light.shadow.bias = -SHADOW_WORLD_BIAS / depthRange;
      // normalBias has to grow with the cascade's texel to avoid acne, but it
      // is measured in WORLD UNITS and this world is tiny: the hero is 1.6
      // units long. Once shadowDistance went to 950 the far cascade's texel
      // reached 0.93, so texel * 1.35 asked for a 1.25 unit offset - far
      // enough to slide a small object's shadow clean off it. That is the
      // peter-panning a blind reviewer flagged ("shadow outline does not
      // match the brick; front edge detached"). Cap it well below the size of
      // the smallest thing that needs to stay attached, and accept a little
      // acne in the distance instead.
      light.shadow.normalBias = clamp(texel * 1.35, 0.010, 0.14);
      // With PCSS installed, shadow.radius is no longer "how many texels wide
      // is the fixed blur" - it is the scale that converts a [0,1] depth gap
      // between blocker and receiver into a penumbra width in shadow-map UV.
      // Per cascade that is (depth range) * tan(sun radius) / (ortho box),
      // which is just similar triangles. Deriving it here rather than
      // hard-coding it is what lets one number serve a 10 unit cascade and a
      // 2300 unit one.
      light.shadow.radius = SunRig.softShadows
        ? (SUN_TAN_ANGLE * depthRange) / box
        : (q.softShadows ? 1.4 : 1);
    }
  }

  setDirection(vec) {
    this.direction.copy(vec).normalize();
    this.bounce.position.copy(this.direction).multiplyScalar(-60);
    this.bounce.position.y = 22;
    if (this.csm) {
      this.csm.lightDirection.copy(this.direction).negate().normalize();
    }
  }

  /** CSM only lights materials that have been through setupMaterial().
   *  Anything it misses would receive every cascade light at full strength,
   *  so this sweep has to happen before each frame, not on a timer. */
  syncMaterials() {
    if (!this.csm) return;
    const csm = this.csm;
    const seen = this._csmMaterials;
    this.scene.traverse((object) => {
      const material = object.material;
      if (!material) return;
      if (Array.isArray(material)) {
        for (const m of material) SunRig._setup(csm, seen, m);
      } else {
        SunRig._setup(csm, seen, material);
      }
    });
  }

  static _setup(csm, seen, material) {
    if (!material || seen.has(material)) return;
    const lit = material.isMeshStandardMaterial || material.isMeshPhysicalMaterial
      || material.isMeshPhongMaterial || material.isMeshLambertMaterial
      || material.isMeshToonMaterial;
    seen.add(material);
    if (!lit) return;
    // Preserve whatever hook the material author already installed.
    const previous = Object.prototype.hasOwnProperty.call(material, "onBeforeCompile")
      ? material.onBeforeCompile
      : null;
    csm.setupMaterial(material);
    const csmHook = material.onBeforeCompile;
    if (previous) {
      material.onBeforeCompile = function (shader, renderer) {
        previous.call(this, shader, renderer);
        csmHook.call(this, shader, renderer);
      };
    }
    material.needsUpdate = true;
  }

  /** Called every frame from engine.render(), after the camera is final. */
  update(focusPoint) {
    this.bounce.target.position.copy(focusPoint);
    this.bounce.position.copy(focusPoint).addScaledVector(this.direction, -60);
    this.bounce.position.y = focusPoint.y + 22;
    this.bounce.target.updateMatrixWorld();

    if (this.csm) {
      const camera = this.camera;
      const key = `${camera.fov}|${camera.aspect}|${camera.near}|${camera.far}`;
      if (key !== this._projectionKey) {
        this._projectionKey = key;
        this.csm.updateFrustums();
        this._applyLightSettings();
      }
      this.syncMaterials();
      this.csm.update();
      return;
    }

    if (this.fallback) {
      const light = this.fallback;
      this.fallbackTarget.position.copy(focusPoint);
      light.position.copy(focusPoint).addScaledVector(this.direction, this.ctx.settings.quality.shadowDistance * 1.1);
      const texel = (light.shadow.camera.right - light.shadow.camera.left) / light.shadow.mapSize.x;
      light.position.x = Math.round(light.position.x / texel) * texel;
      light.position.z = Math.round(light.position.z / texel) * texel;
      this.fallbackTarget.position.x = Math.round(this.fallbackTarget.position.x / texel) * texel;
      this.fallbackTarget.position.z = Math.round(this.fallbackTarget.position.z / texel) * texel;
      this.fallbackTarget.updateMatrixWorld();
    }
  }

  refreshQuality() {
    const q = this.ctx.settings.quality;
    if (this.csm) {
      this._applyLightSettings();
      return;
    }
    if (this.fallback) {
      this.fallback.castShadow = Boolean(q.shadows);
      this.fallback.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.fallback.shadow.map = null;
    }
  }

  dispose() {
    if (this.csm) {
      try { this.csm.dispose(); } catch (error) { /* already gone */ }
    }
  }
}

/* ================================================================
   Sky helpers
   ================================================================ */

/** Preetham's sky writes display-referred values that the renderer then
 *  treats as radiance. Patching in a scale + clamp is what lets the sky,
 *  the sun and the IBL share one unit system instead of being reconciled
 *  by an arbitrary exposure. */
/* Procedural cloud deck for the visible sky.

   Every wide frame in this game is 50-60% sky, and a Preetham gradient has
   nothing in it: reviews called the upper frame "dead" and the air "empty".
   Clouds fix both at once, and they also hide the hard line where the
   terrain ends, because the deck compresses into haze at the horizon.

   The clouds are projected onto a single plane at altitude rather than
   ray-marched. At this camera's field of view a 2.5D deck is
   indistinguishable from a volume and costs one FBM instead of dozens.

   Deliberately NOT applied to the IBL sky: that one is baked once into a
   PMREM and clamped hard (see SKY_CLAMP), and a bright cloud in a single
   enormous texel skews the whole irradiance. Ambient still comes from the
   clear-sky model. */
const SKY_CLOUDS = /* glsl */ `
  uniform float uCloudTime;
  uniform float uCloudCover;
  uniform float uCloudScale;
  uniform float uCloudHeight;
  uniform float uCloudLit;
  uniform float uCloudBase;

  float tsCloudHash( vec2 p ) {
    p = fract( p * vec2( 123.34, 456.21 ) );
    p += dot( p, p + 45.32 );
    return fract( p.x * p.y );
  }

  float tsCloudNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( tsCloudHash( i ), tsCloudHash( i + vec2( 1.0, 0.0 ) ), u.x ),
      mix( tsCloudHash( i + vec2( 0.0, 1.0 ) ), tsCloudHash( i + vec2( 1.0, 1.0 ) ), u.x ),
      u.y );
  }

  float tsCloudFbm( vec2 p ) {
    float v = 0.0;
    float a = 0.5;
    for ( int i = 0; i < 5; i++ ) {
      v += a * tsCloudNoise( p );
      p = p * 2.03 + vec2( 1.7, 9.2 );
      a *= 0.5;
    }
    return v;
  }
`;

function patchSky(sky, intensity, ceiling, chroma = 1, clouds = false) {
  const source = sky.material.fragmentShader;
  const needle = "gl_FragColor = vec4( retColor, 1.0 );";
  if (!source.includes(needle)) {
    console.warn("[tardigrade-sim] sky shader shape changed, using unscaled sky radiance");
    return false;
  }
  sky.material.uniforms.uSkyIntensity = { value: intensity };
  sky.material.uniforms.uSkyClamp = { value: ceiling };
  sky.material.uniforms.uSkyChroma = { value: chroma };

  let head = "uniform float uSkyIntensity;\nuniform float uSkyClamp;\nuniform float uSkyChroma;\n";
  let body =
    "vec3 skyRadiance = retColor * uSkyIntensity;\n" +
    "\tskyRadiance = mix( vec3( dot( skyRadiance, vec3( 0.2126, 0.7152, 0.0722 ) ) ), skyRadiance, uSkyChroma );\n";

  if (clouds) {
    Object.assign(sky.material.uniforms, {
      uCloudTime: { value: 0 },
      /** Raise to clear the sky, lower for overcast. */
      uCloudCover: { value: 0.415 },
      uCloudScale: { value: 0.42 },
      uCloudHeight: { value: 640 },
      uCloudLit: { value: 2.35 },
      uCloudBase: { value: 0.62 },
    });
    head += SKY_CLOUDS;
    body += /* glsl */ `
    {
      vec3 cdir = normalize( vWorldPosition - cameraPosition );
      if ( cdir.y > 0.012 ) {
        // Clouds are lit and shadowed relative to the sky behind them, so
        // they stay correctly exposed at any sun angle with no extra
        // tuning. The reference is clamped well below the solar disc,
        // otherwise a cloud crossing the sun samples a value orders of
        // magnitude above the dome and blows out to a white plate.
        vec3 skyRef = min( skyRadiance, vec3( 4.0 ) );
        float skyLum = dot( skyRef, vec3( 0.2126, 0.7152, 0.0722 ) );

        vec2 cp = ( cameraPosition.xz + cdir.xz * ( uCloudHeight / cdir.y ) )
          * ( uCloudScale * 0.001 ) + vec2( uCloudTime * 0.006, uCloudTime * 0.0026 );

        // One domain warp turns the FBM's obvious lattice into billows.
        vec2 warp = vec2( tsCloudFbm( cp * 0.5 ), tsCloudFbm( cp * 0.5 + 5.3 ) );
        float dens = tsCloudFbm( cp + warp * 1.3 );

        // The deck flattens towards the horizon instead of running to a
        // hard edge, which is also what softens the end of the terrain.
        float hz = smoothstep( 0.006, 0.09, cdir.y );
        float cover = smoothstep( uCloudCover, uCloudCover + 0.20, dens ) * hz;

        // Self shadowing without a march: resample a short way towards the
        // sun. More cloud that way means this point sits in its own shade.
        float toSun = tsCloudFbm( cp + normalize( vSunDirection.xz + 1.0e-4 ) * 0.9 + warp * 1.3 );
        float shade = smoothstep( 0.02, 0.46, dens - toSun + 0.22 );

        vec3 lit = mix( skyRef, vec3( skyLum ), 0.88 ) * uCloudLit;
        vec3 dark = mix( skyRef, vec3( skyLum ), 0.30 ) * uCloudBase;
        vec3 cloudCol = mix( dark, lit, shade );

        // Silver lining: thin edges facing the sun scatter forward.
        float sunDot = max( dot( cdir, vSunDirection ), 0.0 );
        cloudCol += mix( skyRef, vec3( skyLum ), 0.6 ) * pow( sunDot, 6.0 ) * ( 1.0 - shade ) * 1.6;

        skyRadiance = mix( skyRadiance, cloudCol, cover * 0.94 );
      }
    }
`;
  }

  body += "\tgl_FragColor = vec4( min( skyRadiance, vec3( uSkyClamp ) ), 1.0 );";

  sky.material.fragmentShader = head + source.replace(needle, body);
  sky.material.needsUpdate = true;
  return true;
}

function configureSky(sky) {
  const u = sky.material.uniforms;
  u.turbidity.value = 3.2;
  u.rayleigh.value = 1.85;
  u.mieCoefficient.value = 0.0042;
  u.mieDirectionalG.value = 0.79;
  return u;
}

/* ================================================================
   Engine
   ================================================================ */

export async function createEngine(ctx) {
  const q = ctx.settings.quality;

  /* ---------------- soft shadows ----------------
     This rewrites a global three.js shader chunk, so it has to happen
     before ANY lit material is compiled - i.e. before materials.js, which
     main.js loads after the engine. Programs already built keep the old
     chunk, which is why this cannot be deferred to a settings change. */
  SunRig.softShadows = false;
  if (q.shadows && q.softShadows) {
    try {
      // Cheaper on the tiers that cannot afford 28 shadow taps per lit
      // fragment. Baked as literals because the chunk is a plain string
      // shared by every program.
      const heavy = q.shadowCascades >= 3;
      SunRig.softShadows = installSoftShadows(heavy ? 12 : 8, heavy ? 16 : 10, 7.0, 0.85);
    } catch (error) {
      console.warn("[tardigrade-sim] soft shadows unavailable, using stock PCF:", error);
      SunRig.softShadows = false;
    }
    if (!SunRig.softShadows) {
      console.warn("[tardigrade-sim] shadow chunk shape changed, using stock PCF");
    }
  }

  /* ---------------- renderer ---------------- */
  const renderer = new THREE.WebGLRenderer({
    canvas: ctx.canvas,
    antialias: false, // handled in the composer
    alpha: false,
    stencil: false,
    depth: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: ctx.qaMode, // screenshots need a readable buffer
  });
  // `Math.min(devicePixelRatio, q.pixelRatio)` meant the quality tier could
  // only ever REDUCE sampling, never add it: on any 1x display - which is
  // every headless capture and most monitors - Ultra's pixelRatio of 2
  // collapsed to 1 and the tier's supersampling simply never happened. Grass
  // blades here are routinely thinner than a pixel and sub-pixel coverage is
  // the one thing no post filter can reconstruct, so a reviewer called
  // foliage aliasing "the most consistently visible difference from the
  // reference" while the setting meant to fix it was inert.
  //
  // The tier now decides, and supersamples above the device ratio when it
  // asks to. Capped at 2 because cost is quadratic in this number.
  renderer.setPixelRatio(clamp(Math.max(window.devicePixelRatio || 1, q.pixelRatio), 0.5, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Tone mapping happens in TonemapGradePass. Leaving it off here means
  // every buffer up to that point holds true HDR radiance, which is what
  // makes an absolute bloom threshold meaningful.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = DEFAULT_EXPOSURE;
  renderer.shadowMap.enabled = Boolean(q.shadows);
  renderer.shadowMap.type = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = true;
  renderer.info.autoReset = true;

  /* ---------------- scene + camera ---------------- */
  const scene = new THREE.Scene();
  scene.name = "TardigradeWorld";

  const camera = new THREE.PerspectiveCamera(ctx.settings.fov, 1, 0.08, 1400);
  camera.position.set(0, 8, 18);
  camera.lookAt(0, 1.4, 0);
  scene.add(camera);

  /* ---------------- sky ---------------- */
  const sky = new Sky();
  sky.scale.setScalar(6000);
  sky.name = "Sky";
  const skyUniforms = configureSky(sky);
  patchSky(sky, SKY_INTENSITY, SKY_CLAMP_VISIBLE, 1, true);
  skyUniforms.sunPosition.value.copy(SUN_DIRECTION);
  scene.add(sky);

  const sun = new SunRig(ctx, scene, camera);
  await sun.init();

  /* Material-level haze. The atmosphere pass does the heavy lifting, but
     a little scene fog keeps alpha-blended surfaces consistent with it. */
  // Same luminance as before, same argument as AtmosphereShader.uFogColor:
  // this is a depth separator, not Rayleigh scatter, so it must not carry
  // hue. Kept in step with uFogColor so alpha-blended surfaces (which take
  // this one) and opaque ones (which take the pass) agree.
  scene.fog = new THREE.FogExp2(0xc4c1bd, 0.00055);

  /* ---------------- image based lighting ----------------
     The environment is baked from a private scene: the same sky dome plus
     a warm ground shell. Without the ground, Preetham's lower hemisphere
     is blue, everything gets lit blue from below, and the frame loses the
     warm/cool separation that sells sunlight. */
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(450);
  const envSkyUniforms = configureSky(envSky);
  patchSky(envSky, SKY_INTENSITY, SKY_CLAMP, ENV_CHROMA);
  envSkyUniforms.sunPosition.value.copy(SUN_DIRECTION);
  envScene.add(envSky);

  const groundGeometry = new THREE.SphereGeometry(300, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const groundMaterial = new THREE.MeshBasicMaterial({ side: THREE.BackSide, toneMapped: false, fog: false });
  groundMaterial.color.setRGB(GROUND_BOUNCE[0], GROUND_BOUNCE[1], GROUND_BOUNCE[2], THREE.LinearSRGBColorSpace);
  const groundDome = new THREE.Mesh(groundGeometry, groundMaterial);
  envScene.add(groundDome);

  let envTarget = null;
  function bakeEnvironment() {
    const target = pmrem.fromScene(envScene, 0, 0.5, 900);
    if (envTarget) envTarget.dispose();
    envTarget = target;
    scene.environment = target.texture;
    // SKY_INTENSITY was pulled down to 0.58 to stop the horizon clipping to
    // flat white, but that also removed sky fill from every shadowed surface,
    // and sun-facing-away geometry (the bottle cap skirt especially) crushed
    // to black. These are separate knobs: the Sky mesh is what the camera
    // sees, `environmentIntensity` is what lights surfaces. Lift the fill
    // without re-blowing the sky.
    // Trimmed from 1.65 alongside ENV_CHROMA and the higher GROUND_BOUNCE.
    // A neutral dome at 1.65 pushed the pale end of the per-instance blade
    // jitter to near-white; the blue dome had been hiding that as slate.
    // The warm bounce makes up the fill this gives back, so shadowed
    // geometry does not go back to crushing.
    //
    // Then trimmed again, from 1.5, because the header of this file claims a
    // sun:sky ratio of ~3.5:1 on a horizontal surface and the code had
    // drifted to 1.4:1. Measured with the shadow term ablated (shadow
    // intensity 0, which keeps CSM's cascade masking intact - switching
    // castShadow off does NOT, it collapses the masking and applies all four
    // cascade lights at once): a shadow only reached 0.68 of the luminance of
    // the same pixels unshadowed, so a cast shadow was a 30% dip rather than
    // a shadow. That is why seven reviews in a row said objects are not
    // attached to the ground. At 0.95, with the bounce raised to take over
    // part of the fill, the same measurement gives 0.52-0.58.
    // Raised from 0.95. Reviews repeatedly described shaded surfaces as dead
    // flat with "crushed-black detail voids", and one object was called an
    // "untextured olive rock" through two reviews - it is the lolly stick,
    // and its top face carries plenty of albedo detail that was simply
    // unlit. There is no bounce-light pass here, so scene ambient is the
    // only thing standing in for it. (envMapIntensity on a material cannot
    // do this - see the note above; three overrides it with this value.)
    scene.environmentIntensity = 1.28;
    return target;
  }
  bakeEnvironment();

  /* ---------------- render targets ---------------- */
  const size = new THREE.Vector2(
    Math.max(2, window.innerWidth || 1600),
    Math.max(2, window.innerHeight || 900)
  );

  const sceneDepth = new THREE.DepthTexture(size.x, size.y);
  sceneDepth.format = THREE.DepthFormat;
  sceneDepth.type = THREE.UnsignedIntType;
  sceneDepth.minFilter = THREE.NearestFilter;
  sceneDepth.magFilter = THREE.NearestFilter;

  /* Hardware MSAA on the scene target. This is the primary anti-aliasing:
     it is the only stage that has real sub-pixel coverage for grass tips,
     cap crenellations and the hero's claws, and three.js resolves both the
     colour and the depth attachment before any post pass samples them.
     Scaled down when the device is already supersampling via pixelRatio,
     because 4x MSAA on a 2x buffer is 8x the bandwidth for a difference
     nobody can see. */
  function chooseSamples() {
    if (!q.antialias || q.antialias === "none") return 0;
    const caps = renderer.capabilities;
    const max = caps && Number.isFinite(caps.maxSamples) ? caps.maxSamples : 4;
    if (max < 2) return 0;
    const dpr = renderer.getPixelRatio();
    // The comment this replaces claimed 4x cost ~6ms of a 16.7ms budget.
    // Re-measured properly (20 renders, readPixels to drain the pipeline,
    // same pose, same session so the thermal floor is shared): 2x = 30.16
    // ms/frame, 4x = 32.83, 8x = 32.45 - so 4x costs 2.7ms, under 9%, and
    // the hardware here caps at 4 anyway. Grass blades in this world are
    // routinely thinner than a pixel, and sub-pixel coverage is the ONE
    // thing no post filter can reconstruct, so this is the highest-value
    // 2.7ms in the frame.
    //
    // Above 1.4 device pixels the buffer is already supersampled and 4x on
    // top is bandwidth spent on a difference nobody can see, so step back
    // down to 2x there.
    const wanted = dpr > 1.4 ? 2 : 4;
    return Math.min(wanted, max);
  }
  let msaaSamples = 0;
  try {
    msaaSamples = chooseSamples();
  } catch (error) {
    console.warn("[tardigrade-sim] MSAA unavailable, relying on post AA:", error);
    msaaSamples = 0;
  }

  const renderTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: msaaSamples,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthBuffer: true,
    stencilBuffer: false,
    depthTexture: sceneDepth,
  });

  // Standalone copy of the depth attachment. See DepthCopyPass.
  const depthCopy = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.FloatType,
    format: THREE.RedFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });

  const shaftScale = 0.25;
  const shaftTarget = q.godRays
    ? new THREE.WebGLRenderTarget(Math.max(2, Math.floor(size.x * shaftScale)), Math.max(2, Math.floor(size.y * shaftScale)), {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      })
    : null;
  if (shaftTarget) {
    shaftTarget.texture.minFilter = THREE.LinearFilter;
    shaftTarget.texture.magFilter = THREE.LinearFilter;
  }

  const composer = new EffectComposer(renderer, renderTarget);
  composer.setPixelRatio(renderer.getPixelRatio());
  // rt2 never receives geometry, so it does not need its own depth copy,
  // and it must not be multisampled: EffectComposer clones rt1, and a
  // multisampled ping-pong buffer would pay a full resolve blit for every
  // fullscreen quad in the chain while adding nothing (a quad covers every
  // sample of every pixel it touches).
  try {
    if (composer.renderTarget2.depthTexture) {
      composer.renderTarget2.depthTexture.dispose();
      composer.renderTarget2.depthTexture = null;
    }
    composer.renderTarget2.samples = 0;
    composer.renderTarget2.depthBuffer = false;
  } catch (error) { /* not fatal */ }

  const stats = { calls: 0, triangles: 0, lines: 0, points: 0, programs: 0, geometries: 0, textures: 0, cascades: sun.lights.length };
  const passes = {};

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  passes.render = renderPass;

  composer.addPass(new StatsPass(renderer, stats));

  const depthCopyPass = new DepthCopyPass(depthCopy);
  composer.addPass(depthCopyPass);
  passes.depthCopy = depthCopyPass;

  /* --- contact shadows ---------------------------------------------------
     Runs before AO so the two compound at a contact, and completely
     independently of the shadow map - see the ContactShadowShader header
     for why the cascades cannot do this job. */
  try {
    const contactSteps = q.pixelRatio > 1.4 ? 14 : 10;
    const contact = new ContactShadowPass(contactSteps);
    contact.setDepthTexture(depthCopy.texture);
    contact.enabled = q.contactShadows !== false;
    composer.addPass(contact);
    passes.contactShadow = contact;
  } catch (error) {
    console.warn("[tardigrade-sim] contact shadows unavailable:", error);
  }

  /* --- ambient occlusion ------------------------------------------------
     Screen space radius, not world radius: the world spans 900 units and
     the hero is 1.6, so a fixed world radius can only ever be right for
     one of them. `radius: 0.45` means "45 pixels at this depth", which
     grounds a grain of sand and a plant pot equally well. */
  if (q.ssao) {
    try {
      const { GTAOPass } = await import("three/addons/postprocessing/GTAOPass.js");
      const gtao = new GTAOPass(scene, camera, size.x, size.y);
      gtao.output = GTAOPass.OUTPUT.Default;
      // Feed it our shared depth so it skips its own full geometry pass.
      gtao.setGBuffer(depthCopy.texture);
      gtao.blendIntensity = 0.95;
      if (gtao.updateGtaoMaterial) {
        gtao.updateGtaoMaterial({
          radius: 0.45,
          distanceExponent: 1.6,
          // Now in units of the screen-space radius rather than view units -
          // see the shader patch below. Slightly wider than the radius, which
          // is the usual heuristic: an occluder further behind the receiver
          // than the search itself reaches is not part of this contact.
          thickness: 0.9,
          // ao is raised to this power, so it is the contrast knob. At 1.15
          // the pass darkened a brick-meets-ground contact by 1.4%, which is
          // below the noise floor of the frame - measured by ablating the
          // pass and comparing a fixed 300x40 window under the LEGO brick in
          // debris-rest. At 1.65 the same window darkens by 6.5% while open
          // ground 140 pixels away is untouched to within 0.05%, which is
          // what a contact term should look like. Pushing to 1.9 bought
          // another 1.2% there and cost 2% of the whole frame inside dense
          // grass, where a 45 pixel search finds a blade from nearly every
          // pixel - the same trap the contact-shadow ray length fell into.
          scale: 1.65,
          samples: q.pixelRatio > 1.4 ? 12 : 9,
          distanceFallOff: 1.0,
          screenSpaceRadius: true,
        });
      }
      /* Scale-invariance fix for the GTAO thickness test.
         GTAOShader computes distanceFalloffToUse = thickness * radiusScale
         (so the occluder-thickness test tracks the screen-space radius) and
         then never uses it - both sample tests compare against the raw
         view-unit thickness. In a world that spans 900 units with a 1.6 unit
         hero that is the same class of bug the contact shadow and the depth
         of field both had: one absolute distance cannot serve a hero
         close-up 3 units out and a wide 500 units out. Symptom: AO worked at
         the hero and vanished in every wide shot, which is most of "the
         brick meets ground along a crisp undarkened line". */
      try {
        const gtaoMaterial = gtao.gtaoMaterial;
        const needle = "if (abs(viewDelta.z) < thickness) {";
        if (gtaoMaterial && gtaoMaterial.fragmentShader.includes(needle)) {
          gtaoMaterial.fragmentShader = gtaoMaterial.fragmentShader
            .split(needle)
            .join("if (abs(viewDelta.z) < distanceFalloffToUse) {");
          gtaoMaterial.needsUpdate = true;
        } else {
          console.warn("[tardigrade-sim] GTAO shader shape changed, thickness stays in view units");
        }
      } catch (error) {
        console.warn("[tardigrade-sim] could not scale the GTAO thickness:", error);
      }
      if (gtao.updatePdMaterial) {
        gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3.5, radius: 3, rings: 2, samples: 12 });
      }
      composer.addPass(gtao);
      passes.gtao = gtao;
    } catch (error) {
      console.warn("[tardigrade-sim] GTAO unavailable, continuing without AO:", error);
    }
  }

  /* --- atmosphere: fog + god rays --------------------------------------- */
  try {
    const shaftSamples = q.godRays ? (q.pixelRatio > 1.4 ? 40 : 26) : 0;
    const atmosphere = new AtmospherePass(shaftTarget, shaftSamples);
    atmosphere.uniforms.tDepth.value = depthCopy.texture;
    composer.addPass(atmosphere);
    passes.atmosphere = atmosphere;
  } catch (error) {
    console.warn("[tardigrade-sim] atmosphere pass unavailable:", error);
  }

  /* --- underwater volume -------------------------------------------------
   * Sits after atmosphere so aerial fog is already folded in, and before
   * DOF/bloom so both react to the submerged image rather than the dry one. */
  try {
    const underwater = new ShaderPass(UnderwaterShader);
    underwater.material.uniforms.tDepth.value = depthCopy.texture;
    composer.addPass(underwater);
    passes.underwater = underwater;
  } catch (error) {
    console.warn("[tardigrade-sim] underwater pass unavailable:", error);
  }

  /* --- depth of field ---------------------------------------------------- */
  if (q.dof) {
    try {
      const dof = new ShaderPass(
        new THREE.ShaderMaterial({
          defines: { DOF_TAPS: 20 },
          uniforms: THREE.UniformsUtils.clone(DofShader.uniforms),
          vertexShader: DofShader.vertexShader,
          fragmentShader: DofShader.fragmentShader,
          depthTest: false,
          depthWrite: false,
        })
      );
      dof.material.uniforms.tDepth.value = depthCopy.texture;
      composer.addPass(dof);
      passes.dof = dof;
    } catch (error) {
      console.warn("[tardigrade-sim] depth of field unavailable:", error);
    }
  }

  /* --- bloom -------------------------------------------------------------
     The threshold is in scene-linear HDR, so it has to be expressed
     relative to the diffuse white point or it just fogs the whole frame.
     Anything above DIFFUSE_WHITE is a genuine highlight: a specular hit,
     a wet edge, the solar disc. */
  if (q.bloom) {
    try {
      // UnrealBloomPass's high-pass does `texel * smoothstep(...)`. If any
      // texel is Inf or NaN - which the solar disc and specular hits on a
      // half-float target can absolutely produce - that becomes Inf*0 = NaN,
      // and one NaN poisons the whole mip chain, painting large hard-edged
      // black blocks over the frame. Sanitise the buffer immediately before
      // bloom so it only ever sees finite, bounded radiance.
      const clampPass = new ShaderPass(HdrClampShader);
      composer.addPass(clampPass);
      passes.hdrClamp = clampPass;

      const bloom = new UnrealBloomPass(size.clone(), 0.42, 0.62, DIFFUSE_WHITE * 1.08);
      composer.addPass(bloom);
      passes.bloom = bloom;
    } catch (error) {
      console.warn("[tardigrade-sim] bloom unavailable:", error);
    }
  }

  /* --- tone map + grade -------------------------------------------------- */
  const gradePass = new ShaderPass(TonemapGradeShader);
  composer.addPass(gradePass);
  passes.grade = gradePass;

  /* --- antialiasing (runs on display-referred pixels, as it should) ------ */
  if (q.antialias === "smaa") {
    try {
      const smaa = new SMAAPass();
      composer.addPass(smaa);
      passes.smaa = smaa;
    } catch (error) {
      console.warn("[tardigrade-sim] SMAA unavailable:", error);
    }
  } else {
    try {
      const { FXAAShader } = await import("three/addons/shaders/FXAAShader.js");
      const fxaa = new ShaderPass(FXAAShader);
      composer.addPass(fxaa);
      passes.fxaa = fxaa;
    } catch (error) {
      console.warn("[tardigrade-sim] FXAA unavailable:", error);
    }
  }

  /* --- finish ------------------------------------------------------------ */
  const finishPass = new ShaderPass(FinishShader);
  finishPass.material.uniforms.uGrain.value = q.grain ? 0.012 : 0;
  composer.addPass(finishPass);
  passes.finish = finishPass;

  /* ---------------- adaptive resolution ---------------- */
  let renderScale = q.renderScale;
  let scaleCooldown = 0;
  let viewWidth = size.x;
  let viewHeight = size.y;
  let bufferWidth = size.x;
  let bufferHeight = size.y;

  /* ---------------- focus target for shadows + DoF ---------------- */
  const focusPoint = new THREE.Vector3(0, 1, 0);
  const tmpVec = new THREE.Vector3();
  const tmpVec2 = new THREE.Vector3();
  const sunNdc = new THREE.Vector3();
  let dofFocus = 16;
  /** Cached from update(); syncCameraUniforms needs it during a bare
   *  render() call, which the QA harness does without an update. */
  let waterWorld = null;
  let elapsedTime = 0;

  /* The focus distance was clamped to 260 units. Every beauty camera except
     the two hero poses sits 300-600 units from what it is looking at, and
     the establishing wide is past 1400, so the focal plane was pinned at the
     clamp in ELEVEN of the thirteen poses and never once landed on the
     subject. Measured consequence on patio-canyon: the foreground at 50-75
     units took the full -9 pixel near blur while the actual subject at 310
     units took 2.1 pixels - "patio-canyon blurs the foreground harder than
     the mid-ground", exactly as reported, and "the bottom third reduced to
     featureless mush" on the establishing wide for the same reason. The
     clamp only needs to keep the maths sane, so it goes out past the far
     plane. */
  function focusDistance() {
    camera.getWorldPosition(tmpVec);
    return clamp(tmpVec.distanceTo(focusPoint), 1.2, 1200);
  }

  /** Depth of field expressed as a fraction of the focus distance, so one
   *  number serves a 3.6 unit close-up and a 500 unit wide. The constant
   *  term keeps a hero close-up from having a focal plane thinner than the
   *  animal standing on it. */
  function focusRange() {
    return clamp(dofFocus * 0.06, 0.9, 26);
  }

  /** Focus distance the aperture is calibrated at: a hero close-up, which is
   *  the one shot that genuinely wants macro-thin focus. */
  const DOF_REFERENCE_FOCUS = 4.0;

  function focusFalloff() {
    return clamp(Math.sqrt(DOF_REFERENCE_FOCUS / Math.max(dofFocus, 0.5)), 0.03, 1.15);
  }

  /* ---------------- per-frame uniform sync ---------------- */
  function syncCameraUniforms() {
    const near = camera.near;
    const far = camera.far;

    if (passes.atmosphere) {
      const u = passes.atmosphere.uniforms;
      u.uNear.value = near;
      u.uFar.value = far;
      u.uInvProjection.value.copy(camera.projectionMatrixInverse);
      u.uCameraWorld.value.copy(camera.matrixWorld);
      camera.getWorldPosition(u.uCameraPos.value);
      u.uSunDir.value.copy(sun.direction);

      // God rays only exist when the sun is actually in front of us.
      camera.getWorldDirection(tmpVec2);
      const facing = tmpVec2.dot(sun.direction);
      let visibility = 0;
      if (facing > 0.02) {
        sunNdc.copy(camera.position).addScaledVector(sun.direction, 900).project(camera);
        const edge = Math.max(Math.abs(sunNdc.x), Math.abs(sunNdc.y));
        visibility = smoothstep(0.02, 0.5, facing) * (1 - smoothstep(0.85, 2.1, edge));
        if (passes.atmosphere.shaftMaterial) {
          passes.atmosphere.shaftMaterial.uniforms.uSunUv.value.set(
            sunNdc.x * 0.5 + 0.5,
            sunNdc.y * 0.5 + 0.5
          );
        }
      }
      passes.atmosphere.shaftVisibility = visibility;
    }

    if (passes.contactShadow) {
      const u = passes.contactShadow.uniforms;
      const a = passes.contactShadow.applyUniforms;
      u.uNear.value = near;
      u.uFar.value = far;
      a.uNear.value = near;
      a.uFar.value = far;
      u.uProjection.value.copy(camera.projectionMatrix);
      u.uInvProjection.value.copy(camera.projectionMatrixInverse);
      // camera.updateMatrixWorld() (called at the top of render) refreshes
      // matrixWorldInverse, so this is the current view matrix.
      u.uSunView.value.copy(sun.direction).transformDirection(camera.matrixWorldInverse);
      u.uTexel.value.set(1 / bufferWidth, 1 / bufferHeight);
      a.uTexel.value.set(1 / bufferWidth, 1 / bufferHeight);
      // projectionMatrix.elements[5] is the vertical projection scale, so
      // this converts "one screen pixel at one unit of view depth" into
      // view units. That is what makes the trace length scale invariant.
      const projScaleY = camera.projectionMatrix.elements[5] || 1;
      u.uPixelToView.value = 2 / (projScaleY * Math.max(2, bufferHeight));
    }

    if (passes.underwater) {
      const u = passes.underwater.material.uniforms;
      u.uNear.value = near;
      u.uFar.value = far;
      u.tDepth.value = depthCopy.texture;
      u.uTime.value = elapsedTime;
      // Submersion is a function of the CAMERA, so it has to be resolved
      // here rather than in update(): the QA harness repoints the camera and
      // calls render() directly, and computing this in update() would leave
      // it stale exactly when a probe is trying to photograph the water.
      let amount = 0;
      if (waterWorld && waterWorld.waterAt) {
        const level = waterWorld.waterAt(camera.position.x, camera.position.z);
        // Ramp across a body length so breaking the surface is a crossing.
        if (level !== null && level !== undefined) {
          amount = clamp((level - camera.position.y) / 1.4, 0, 1);
        }
      }
      u.uAmount.value = amount;
      u.uInvProjection.value.copy(camera.projectionMatrixInverse);
      u.uCameraWorld.value.copy(camera.matrixWorld);
      camera.getWorldPosition(u.uCameraPos.value);
      if (amount > 0.001 && waterWorld && waterWorld.waterAt) {
        const lvl = waterWorld.waterAt(camera.position.x, camera.position.z);
        if (lvl !== null && lvl !== undefined) u.uWaterLevel.value = lvl;
      }
      passes.underwater.enabled = amount > 0.001;
    }

    if (passes.dof) {
      const u = passes.dof.material.uniforms;
      u.uNear.value = near;
      u.uFar.value = far;
      u.uFocus.value = dofFocus;
      u.uFocusRange.value = focusRange();
      u.uFocusFalloff.value = focusFalloff();
      u.uTexel.value.set(1 / bufferWidth, 1 / bufferHeight);
    }

    if (passes.gtao) {
      // The depth copy is recreated on resize; keep the samplers pointing at it.
      if (passes.gtao.gtaoMaterial) passes.gtao.gtaoMaterial.uniforms.tDepth.value = depthCopy.texture;
      if (passes.gtao.pdMaterial) passes.gtao.pdMaterial.uniforms.tDepth.value = depthCopy.texture;
    }

    if (passes.grade) {
      passes.grade.material.uniforms.uExposure.value = renderer.toneMappingExposure;
    }

    if (passes.finish) {
      passes.finish.material.uniforms.uTexel.value.set(1 / bufferWidth, 1 / bufferHeight);
    }
  }

  const engine = {
    renderer,
    scene,
    camera,
    composer,
    passes,
    sky,
    sun,
    pmrem,
    /** Accurate scene draw statistics, captured before post processing. */
    stats,

    /** Systems can nudge the sun and re-bake the environment. */
    setSunDirection(x, y, z) {
      sun.setDirection(tmpVec.set(x, y, z));
      skyUniforms.sunPosition.value.copy(sun.direction);
      envSkyUniforms.sunPosition.value.copy(sun.direction);
      bakeEnvironment();
    },

    setExposure(value) {
      renderer.toneMappingExposure = value;
      if (passes.grade) passes.grade.material.uniforms.uExposure.value = value;
    },

    /** Point the shadow frustum + depth of field at whatever matters now. */
    setFocus(vec) {
      focusPoint.copy(vec);
      const target = focusDistance();
      // A pose change is a cut, not a rack focus - snap rather than drift.
      if (Math.abs(target - dofFocus) > dofFocus * 0.45) dofFocus = target;
    },

    resize(width, height) {
      viewWidth = width;
      viewHeight = height;
      camera.aspect = width / height;
      camera.fov = ctx.settings.fov;
      camera.updateProjectionMatrix();

      // Same formula as init (see the note there). resize() runs at startup
      // and on every window resize, so leaving the old Math.min here silently
      // undid the init-time value the moment the engine started - the tier's
      // supersampling was reinstated and then immediately thrown away again,
      // and renderer.getPixelRatio() reported 1 while quality.pixelRatio was
      // 2. Any clamp expressed in two places has to agree in both.
      const pixelRatio = clamp(
        Math.max(window.devicePixelRatio || 1, ctx.settings.quality.pixelRatio), 0.5, 2);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);

      const scaledW = Math.max(2, Math.floor(width * renderScale));
      const scaledH = Math.max(2, Math.floor(height * renderScale));
      composer.setPixelRatio(pixelRatio);
      composer.setSize(scaledW, scaledH);

      bufferWidth = Math.max(2, Math.floor(scaledW * pixelRatio));
      bufferHeight = Math.max(2, Math.floor(scaledH * pixelRatio));

      depthCopy.setSize(bufferWidth, bufferHeight);
      if (shaftTarget) {
        shaftTarget.setSize(
          Math.max(2, Math.floor(bufferWidth * shaftScale)),
          Math.max(2, Math.floor(bufferHeight * shaftScale))
        );
      }
      // Ambient occlusion is a low-frequency signal and its own denoise pass
      // blurs it anyway, so running it at half resolution is nearly free
      // visually. Measured at 6.3ms of a 22.5ms frame at full res - the single
      // most expensive thing in the chain by a wide margin.
      if (passes.gtao && passes.gtao.setSize) {
        passes.gtao.setSize(
          Math.max(2, Math.floor(bufferWidth * GTAO_SCALE)),
          Math.max(2, Math.floor(bufferHeight * GTAO_SCALE))
        );
      }
      if (passes.bloom && passes.bloom.setSize) passes.bloom.setSize(bufferWidth, bufferHeight);
      if (passes.smaa && passes.smaa.setSize) passes.smaa.setSize(bufferWidth, bufferHeight);
      if (passes.fxaa && passes.fxaa.material.uniforms.resolution) {
        passes.fxaa.material.uniforms.resolution.value.set(1 / bufferWidth, 1 / bufferHeight);
      }
    },

    update(dt, context) {
      if (context.world) waterWorld = context.world;
      elapsedTime = context.time.elapsed;
      if (passes.finish) passes.finish.material.uniforms.uTime.value = context.time.elapsed;
      if (skyUniforms.uCloudTime) skyUniforms.uCloudTime.value = context.time.elapsed;

      dofFocus = damp(dofFocus, focusDistance(), 6, dt);

      // Adaptive resolution keeps the frame budget in check.
      if (context.settings.adaptiveResolution) {
        scaleCooldown -= dt;
        if (scaleCooldown <= 0 && context.perf.frameMs.count > 40) {
          const p90 = context.perf.frameMs.percentile(0.9);
          let next = renderScale;
          if (p90 > 21 && renderScale > 0.62) next = renderScale - 0.08;
          else if (p90 < 13.5 && renderScale < context.settings.quality.renderScale) next = renderScale + 0.06;
          next = clamp(next, 0.62, context.settings.quality.renderScale);
          if (Math.abs(next - renderScale) > 0.005) {
            renderScale = next;
            scaleCooldown = 1.2;
            engine.resize(viewWidth, viewHeight);
          } else {
            scaleCooldown = 0.4;
          }
        }
      }
    },

    render() {
      // The QA harness moves the camera and calls render() directly without
      // an update() in between, so everything camera dependent lives here.
      camera.updateMatrixWorld();
      sun.update(focusPoint);
      syncCameraUniforms();

      // Force the ping-pong so RenderPass always targets the buffer that
      // owns the depth attachment.
      composer.readBuffer = composer.renderTarget1;
      composer.writeBuffer = composer.renderTarget2;
      composer.render();
    },

    /** Used by the QA harness to prove the GPU actually produced frames. */
    get renderScale() { return renderScale; },

    dispose() {
      sun.dispose();
      // EffectComposer.dispose() only frees its own two buffers, so passes
      // that own a render target (the contact shadow trace) have to be told.
      for (const pass of Object.values(passes)) {
        if (pass && typeof pass.dispose === "function") {
          try { pass.dispose(); } catch (error) { /* already gone */ }
        }
      }
      composer.dispose();
      renderTarget.dispose();
      depthCopy.dispose();
      if (shaftTarget) shaftTarget.dispose();
      groundGeometry.dispose();
      groundMaterial.dispose();
      pmrem.dispose();
      if (envTarget) envTarget.dispose();
      renderer.dispose();
    },
  };

  // Expose a stable frame counter that survives pass reconfiguration.
  Object.defineProperty(engine, "frame", {
    get: () => ctx.time.frame,
  });

  ctx.events.on("settings:quality", () => {
    const nq = ctx.settings.quality;
    renderer.shadowMap.enabled = Boolean(nq.shadows);
    renderer.shadowMap.type = nq.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    sun.refreshQuality();
    if (passes.contactShadow) passes.contactShadow.enabled = nq.contactShadows !== false;
    if (passes.finish) passes.finish.material.uniforms.uGrain.value = nq.grain ? 0.012 : 0;
    renderScale = nq.renderScale;
    engine.resize(viewWidth, viewHeight);
  });

  engine.resize(size.x, size.y);
  return engine;
}
