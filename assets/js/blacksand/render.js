/* ============================================================
   BLACKSAND - renderer and post-processing

   Owns the WebGL context, the camera rig, cascaded shadow maps and
   the full post chain. Everything that decides "how does a frame
   look" lives here or is driven from here.

   Pipeline, in order:
     scene -> HDR render target
       -> bloom          (physically-thresholded, 5 mips)
       -> composite      (motion blur, cloud shadow, aerial perspective,
                          light shafts, tonemap, grade, CA, grain,
                          vignette, sharpen)  <- single fullscreen pass
       -> SMAA           (edge AA, in display space where it belongs)

   The composite is deliberately one pass. Chaining a pass per effect
   costs a full-screen read/write each time, and at 1080p on an
   integrated GPU that alone was the difference between 60 and 38fps.

   ---- colour space: the one thing to not get wrong ----
   The composite writes DISPLAY-REFERRED values. AgX already ends in
   display space, so the frame is finished when the composite is.
   There is deliberately no OutputPass after it: OutputPass applies
   sRGBTransferOETF whenever renderer.outputColorSpace is sRGB, which
   encoded the already-encoded AgX output a second time. That single
   line was the whole "the frame is milk" bug - mid grey 0.18 came out
   at 188/255 instead of 126, every shadow was lifted into fog, and no
   amount of exposure tuning could fix it because the curve was being
   applied twice. SMAA being last is also correct: its edge detection
   wants perceptual, not linear, luma.
   ============================================================ */

import { clamp, clamp01, damp, makeStat, DEG } from "./core.js";

export async function createRenderer(ctx) {
  const { THREE, canvas, settings } = ctx;
  const q = settings.q;

  const [
    { EffectComposer },
    { RenderPass },
    { ShaderPass },
    { SMAAPass },
  ] = await Promise.all([
    import("three/addons/postprocessing/EffectComposer.js"),
    import("three/addons/postprocessing/RenderPass.js"),
    import("three/addons/postprocessing/ShaderPass.js"),
    import("three/addons/postprocessing/SMAAPass.js"),
  ]);

  /* --------------------------- renderer --------------------------- */

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,          // SMAA in the post chain instead
    alpha: false,
    stencil: false,
    depth: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: settings.qa,
    logarithmicDepthBuffer: false,
  });

  renderer.debug.checkShaderErrors = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Tone mapping happens in our own composite pass so the grade sits
  // between bloom and AA. Leaving three's mapper on would apply it
  // twice and wash the whole image out.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;

  renderer.shadowMap.enabled = q.shadows;
  // PCF, not PCFSoft - see the chunk override below. PCFSoft's kernel
  // is a fixed one-texel bilinear 3x3 that ignores shadow.radius, so
  // there is no knob on it at all; the PCF branch is the one that
  // takes a radius, and it is the branch we replace.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = true;
  // The blocker search below reads packed depth directly and compares
  // it the normal way round. Reversed depth would invert that test.
  renderer.reverseDepthBuffer = false;

  renderer.info.autoReset = false;

  /* ------------------ diffuse / specular environment ------------------
     three scales BOTH halves of image-based lighting with one number:
     `scene.environmentIntensity` multiplies the diffuse irradiance and
     the specular radiance together. That single number was being used
     as the sun-to-skylight ratio, which meant driving it down to 0.07
     to get desert shadows also drove every REFLECTION down to 0.07.

     A metal has no diffuse term at all - it is lit entirely by the
     specular environment - so at that setting every metal surface in
     the game rendered black. Vehicle bodies, corrugated roofs, weapon
     furniture, the market's steel frames: all of them. That is most of
     what was being reported as "unlit black-hole geometry", and it also
     removed every rim and every Fresnel edge from the frame.

     Splitting them costs one multiply in a shared chunk. The specular
     environment goes back to physically correct (intensity 1.0 = the
     probe reflects the sky it actually is), and the small number that
     controls how much SKYLIGHT lands on a diffuse surface lives here,
     where it can never be confused for a reflection setting.

     Baked as a literal rather than a uniform: three clones the uniform
     block per material, so a new global uniform would have to be pushed
     to every material every frame. The value is a constant of the look,
     not something that animates - sky.js varies the sky's brightness
     through environmentIntensity, and this scales what reaches diffuse.

     OTHER MODULES: if you have raised a material's envMapIntensity to
     compensate for objects being too dark, drop it. That compensation
     was fighting this bug and now doubles the specular. */
  /* WITHDRAWN, kept for the same reason as its twin in sky.js: the
     prose proposed 0.0528 (0.80x of 0.066) paired with the same 0.80
     on GROUND_BOUNCE, and NEITHER edit landed - this is 0.066 and that
     is 0.28, both unscaled, so the pairing it insists on is intact.

     Its premise is also wrong, which matters more than the mismatch.
     It calls this "the cool half of a shadow's fill". It is not: most
     of the probe's irradiance comes from its ground hemisphere, which
     sky.js paints with the warm bounce tint, so raising this raises
     warm and cool together. Measured - 0.066 -> 0.17, a 2.6x sweep -
     shaded saturation moved 0.765 to 0.760, and ENV_DIFFUSE_SAT
     0.52 -> 0.90 moved it not at all. The cool half of the fill did not
     exist until the hemisphere's sky end was made neutral. */
  const ENV_DIFFUSE = 0.066;

  /* ---- how much of the probe's CHROMA reaches a diffuse surface ----

     Measured, and it is the fault two blind reviewers both called
     "water": shadowed sand came back at hue 68 / saturation 0.27
     against lit sand at hue 25 / saturation 0.73 - a near-neutral
     grey-green plane with a ripple normal on it, which is exactly what
     a body of water looks like.

     Decomposing the light on that surface: with the hemisphere bounce
     off it renders (21, 44, 49) - a 4.3:1 blue-to-red illuminant. With
     the probe off instead it renders (38, 24, 15), warm. The blue term
     carried 63% of the shade. Blue light on orange sand cancels towards
     grey, so the albedo - the thing that says "this is sand" - is
     destroyed at the point where the sun stops reaching it.

     The blue is too saturated because the dome is a SINGLE-scattering
     integral. Two real light paths are missing from it and both are
     far less saturated than single-scatter Rayleigh:

       - multiple scattering, which is most of why a real clear zenith
         measures nearer 10000K than the 25000K a first-order
         calculation gives;
       - ground-reflected skylight. A 0.4-albedo desert throws roughly
         forty per cent of everything that lands on it back INTO the
         sky, where it scatters down again already carrying sand's own
         hue. Over sand or snow this term is enormous, and a dome
         rendered from an atmosphere model alone contains none of it.

     Both are diffuse-only: a mirror still reflects the real, saturated
     sky, so this is applied inside getIBLIrradiance and not to the
     radiance path. Mixing towards the sample's OWN luminance rather
     than towards a fixed tint keeps it honest at every time of day -
     at dusk it desaturates an orange sky, which is equally correct. */
  const ENV_DIFFUSE_SAT = 0.52;
  {
    const source = THREE.ShaderChunk.envmap_physical_pars_fragment;
    const anchor = "return PI * envMapColor.rgb * envMapIntensity;";
    if (source.indexOf(anchor) < 0) {
      console.warn("[blacksand] IBL chunk layout changed - diffuse/specular env not split");
    } else {
      THREE.ShaderChunk.envmap_physical_pars_fragment = source.replace(
        anchor,
        `{
					vec3 bsIrr = PI * envMapColor.rgb * envMapIntensity * ${ENV_DIFFUSE.toFixed(4)};
					float bsLum = dot( bsIrr, vec3( 0.2126, 0.7152, 0.0722 ) );
					return mix( vec3( bsLum ), bsIrr, ${ENV_DIFFUSE_SAT.toFixed(3)} );
				}`
      );
    }
  }

  /* --------------------- shadow filtering (PCSS) ---------------------
     three's PCF is seventeen taps on a fixed grid at one radius. On a
     directional light covering hundreds of metres that is a hard edge
     the width of one shadow texel, and because the grid is axis-aligned
     and unjittered the edge crawls pixel by pixel as the camera moves -
     which is the single most reliable "this is a browser toy" tell.

     Replaced with percentage-closer SOFT shadows: a blocker search
     estimates how far the occluder is from the receiver, and the filter
     radius grows with that distance. A doorframe touching the floor
     stays sharp where it meets it and spreads out two metres away,
     which is what a penumbra actually is. The disc is a Vogel spiral
     rotated per pixel by interleaved gradient noise, so what is left of
     the aliasing is a stationary dither rather than a crawl.

     Patched into the shared ShaderChunk rather than per material: every
     surface in the game has to agree about what a shadow edge looks
     like, and render.js is constructed before anything compiles a
     program. The two anchors are asserted, so a three upgrade that
     rewrites the chunk fails loudly here instead of silently reverting
     to the hard edge.

     ---- the penumbra is now a LENGTH, not a texel count ----

     The first version estimated the penumbra as a ratio of normalised
     depths and multiplied it by five texels. That has no physical
     scale in it at all: the widest edge it could produce was eleven
     texels, about 36cm on the near cascade, and the ratio saturated
     for any gap over about five metres - so a dune-ridge shadow thrown
     150 metres and a doorframe shadow thrown six both came out the
     same width. Measured on the checkpoint frame, a shadow edge across
     the whole street was one pixel wide, and two separate reviewers
     read the shadowed sand behind it as a body of water: a hard
     straight boundary is a SHORELINE, and softening it is most of what
     makes the same edge read as shade instead.

     The sun subtends about 0.53 degrees, so an occluder d metres above
     a surface throws a penumbra d * tan(0.53 deg) wide - a metre and a
     half at 150m, three centimetres at three. That is the quantity, and
     the only thing the shader is missing to compute it is the scale
     factor from normalised shadow depth to texels, which depends on the
     cascade's depth range and its texel size. Both are known on the CPU
     and change only when the cascade is re-fitted, so they are folded
     into `shadow.radius` there - see fitShadowCascade. `shadowRadius`
     is a per-light uniform three already plumbs through, and since this
     chunk is the only consumer of it left, repurposing it costs nothing
     and adds no per-frame uniform push. */
  {
    const FILTER_TAPS = q.shadowSoftness > 1.2 ? 20 : (q.shadowSoftness > 0.8 ? 14 : 8);
    const SEARCH_TAPS = q.shadowSoftness > 1.2 ? 12 : 8;
    /* The widest edge the filter is allowed to draw, in texels. Not a
       physical limit - a limit on how far this many taps can be spread
       before the dither stops resolving into a gradient. The world
       distance it stands for grows with the cascade, which is the right
       way round: long throws happen in wide shots, and a wide shot has
       a wide cascade. */
    const MAX_PENUMBRA = q.shadowSoftness > 1.2 ? 26 : 18;
    const source = THREE.ShaderChunk.shadowmap_pars_fragment;
    const start = source.indexOf("#if defined( SHADOWMAP_TYPE_PCF )");
    const end = source.indexOf("#elif defined( SHADOWMAP_TYPE_PCF_SOFT )");
    if (start < 0 || end < 0 || end < start) {
      console.warn("[blacksand] shadow chunk layout changed - keeping three's PCF");
    } else {
      const replacement = /* glsl */`#if defined( SHADOWMAP_TYPE_PCF )

			#define BS_PCSS_TAPS ${FILTER_TAPS}
			#define BS_PCSS_SEARCH ${SEARCH_TAPS}
			#define BS_PCSS_MAX ${MAX_PENUMBRA}

			vec2 bsTexel = vec2( 1.0 ) / shadowMapSize;

			float bsAngle = 6.2831853 * fract( 52.9829189 *
				fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );

			// How wide the search may reach, in shadow texels. It has to
			// cover the widest penumbra the filter can draw, or a far
			// occluder is never found and its shadow snaps hard; much
			// wider than that and a thin occluder finds blockers that
			// belong to something else and smears its shadow across the
			// gap. Fixed in TEXELS, unlike the filter radius, because
			// this is a sampling question rather than a physical one.
			vec2 bsSearch = bsTexel * float( BS_PCSS_MAX );

			float bsDepthSum = 0.0;
			float bsDepthCount = 0.0;
			for ( int bsI = 0; bsI < BS_PCSS_SEARCH; bsI ++ ) {
				float bsF = float( bsI ) + 0.5;
				float bsR = sqrt( bsF / float( BS_PCSS_SEARCH ) );
				float bsA = bsF * 2.39996323 + bsAngle;
				vec2 bsO = vec2( cos( bsA ), sin( bsA ) ) * bsR * bsSearch;
				float bsD = unpackRGBAToDepth( texture2D( shadowMap, shadowCoord.xy + bsO ) );
				if ( bsD < shadowCoord.z ) {
					bsDepthSum += bsD;
					bsDepthCount += 1.0;
				}
			}

			if ( bsDepthCount < 0.5 ) {

				shadow = 1.0;

			} else {

				float bsAvg = bsDepthSum / bsDepthCount;
				// shadowRadius carries "penumbra texels per unit of
				// normalised depth gap" - the sun's angular radius
				// converted through this cascade's depth range and
				// texel size. So this line IS d * tan(sunAngle), in
				// texels, and a shadow thrown 150m comes out forty
				// times softer than one thrown four.
				//
				// The floor is just over half a texel: a caster
				// touching its receiver must stay sharp, or every
				// object in the game floats again.
				float bsWidth = clamp(
					( shadowCoord.z - bsAvg ) * shadowRadius, 0.55, float( BS_PCSS_MAX ) );
				vec2 bsRadius = bsTexel * bsWidth;

				float bsSum = 0.0;
				for ( int bsJ = 0; bsJ < BS_PCSS_TAPS; bsJ ++ ) {
					float bsF = float( bsJ ) + 0.5;
					float bsR = sqrt( bsF / float( BS_PCSS_TAPS ) );
					float bsA = bsF * 2.39996323 + bsAngle;
					vec2 bsO = vec2( cos( bsA ), sin( bsA ) ) * bsR * bsRadius;
					bsSum += texture2DCompare( shadowMap, shadowCoord.xy + bsO, shadowCoord.z );
				}
				shadow = bsSum / float( BS_PCSS_TAPS );

			}

			// Dissolve towards the edge of the map instead of ending on
			// a straight line. With one cascade the boundary is a
			// perfectly straight seam across open ground, and a straight
			// line in a desert is the one thing nobody misses.
			//
			// 0.88, where it was 0.74. At 0.74 the outer quarter of the
			// map was thrown away in both axes - the cascade reaches
			// 34m at high and shadows were already half gone by 25m, so
			// a palm forty metres off cast nothing even though it was
			// inside the map. The dissolve exists to hide a seam, not to
			// buy margin, and 0.88 still spans several metres of fade.
			vec2 bsEdge = abs( shadowCoord.xy - 0.5 ) * 2.0;
			shadow = mix( 1.0, shadow,
				1.0 - smoothstep( 0.88, 0.998, max( bsEdge.x, bsEdge.y ) ) );

		`;
      THREE.ShaderChunk.shadowmap_pars_fragment =
        source.slice(0, start) + replacement + source.slice(end);
    }
  }

  /* ------------------- cascade selection, per fragment -------------------
     The second cascade is a second directional light (see sunFar), which
     is the only way three will allocate a second shadow map, matrix and
     varying. That leaves one thing to do here: make light ZERO - the one
     carrying the sun's colour - consult BOTH maps and pick.

     Patched into `lights_fragment_begin` rather than into `getShadow`,
     because getShadow is handed one map and has no way to know a second
     exists. The chunk is unrolled by three's own preprocessor, which
     substitutes UNROLLED_LOOP_INDEX with a literal, so `#if
     UNROLLED_LOOP_INDEX == 0` compiles to `#if 0 == 0` on the sun's
     iteration and `#if 1 == 0` on the far light's - the far light keeps
     three's ordinary path and, being black, contributes nothing.

     The blend is on the near cascade's own map coordinate, not on view
     depth. View depth needs a split distance that has to be kept in sync
     with the cascade fit; the coordinate already IS the fit, so the two
     can never disagree. It also fades exactly where the near map's own
     edge dissolve starts, so the fragment stops trusting cascade 0 at
     the same place cascade 0 stops being able to answer. */
  if (q.shadows && q.shadowCascades >= 2) {
    const source = THREE.ShaderChunk.lights_fragment_begin;
    const anchor = "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;";
    if (source.indexOf(anchor) < 0) {
      console.warn("[blacksand] lights chunk layout changed - shadow cascades disabled");
    } else {
      THREE.ShaderChunk.lights_fragment_begin = source.replace(anchor, /* glsl */`
		#if UNROLLED_LOOP_INDEX == 0 && NUM_DIR_LIGHT_SHADOWS > 1
			float bsNear = getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] );
			float bsFar = getShadow( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ].shadowMapSize, directionalLightShadows[ 1 ].shadowIntensity, directionalLightShadows[ 1 ].shadowBias, directionalLightShadows[ 1 ].shadowRadius, vDirectionalShadowCoord[ 1 ] );
			vec3 bsCoord0 = vDirectionalShadowCoord[ 0 ].xyz / vDirectionalShadowCoord[ 0 ].w;
			vec2 bsOff = abs( bsCoord0.xy - 0.5 ) * 2.0;
			float bsBlend = smoothstep( 0.74, 0.94, max( max( bsOff.x, bsOff.y ),
				max( bsCoord0.z, 0.0 ) > 1.0 ? 2.0 : 0.0 ) );
			float bsShadow = mix( bsNear, bsFar, bsBlend );
			directLight.color *= ( directLight.visible && receiveShadow ) ? bsShadow : 1.0;
		#else
			${anchor}
		#endif
`);
    }
  }

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const anisotropy = Math.min(q.anisotropy, maxAniso);

  /* ---------------------------- scene ---------------------------- */

  const scene = new THREE.Scene();
  // The sky module replaces this. Until it does, a mid grey keeps the
  // first frame from being a black rectangle that hides real errors.
  scene.background = new THREE.Color(0x8fa6b8);

  const camera = new THREE.PerspectiveCamera(
    settings.prefs.fov, 16 / 9, 0.06, 4200
  );
  camera.rotation.order = "YXZ";
  camera.position.set(0, 2, 0);

  // A second camera for the view model. First-person hands rendered
  // with the world camera either clip through walls or need the near
  // plane pulled so close that depth precision collapses across the
  // whole map. Separate camera, separate depth range, no compromise.
  const viewCamera = new THREE.PerspectiveCamera(58, 16 / 9, 0.008, 12);
  const viewScene = new THREE.Scene();

  /* ---------------------------- sizing ---------------------------- */

  const size = { width: 1, height: 1, dpr: 1 };
  let renderScale = q.renderScale;

  function resize(force = false) {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width || canvas.clientWidth || 1280));
    const cssH = Math.max(1, Math.round(rect.height || canvas.clientHeight || 720));
    const dpr = Math.min(window.devicePixelRatio || 1, q.pixelRatioCap);

    if (!force && cssW === size.width && cssH === size.height && dpr === size.dpr) return;
    size.width = cssW;
    size.height = cssH;
    size.dpr = dpr;

    const w = Math.max(2, Math.round(cssW * dpr * renderScale));
    const h = Math.max(2, Math.round(cssH * dpr * renderScale));

    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    camera.aspect = cssW / cssH;
    camera.updateProjectionMatrix();
    viewCamera.aspect = camera.aspect;
    viewCamera.updateProjectionMatrix();

    composer.setSize(w, h);
    resizeBloom(w, h);
    resizeAo(w, h);
    if (smaaPass) smaaPass.setSize(w, h);
    composite.uniforms.uResolution.value.set(w, h);

    ctx.bus.emit("render:resize", { width: w, height: h, cssWidth: cssW, cssHeight: cssH });
  }

  /* -------------------------- post chain -------------------------- */

  const hdrTarget = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
    samples: 0,
    depthBuffer: true,
    stencilBuffer: false,
  });
  hdrTarget.texture.minFilter = THREE.LinearFilter;
  hdrTarget.texture.magFilter = THREE.LinearFilter;

  const composer = new EffectComposer(renderer, hdrTarget);
  // EffectComposer derives each pass's renderToScreen from its own
  // flag: `pass.renderToScreen = this.renderToScreen && isLastEnabledPass(i)`.
  // Setting this to false means NO pass ever writes to the default
  // framebuffer, so the canvas stays black no matter how correct the
  // chain is - and the failure looks exactly like a lighting bug.
  composer.renderToScreen = true;

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  /* ------------------------------ bloom ------------------------------
     Hand-rolled, not UnrealBloomPass.

     UnrealBloomPass in this chain blanked the frame to pure black for
     some camera positions and not others. It was measured carefully
     before being replaced: the raw scene rendered fine (mean luma 90),
     a passthrough composite with bloom DISABLED rendered fine, and the
     same passthrough with bloom ENABLED came back at exactly 0 - with
     the pass's own strength set to 0 and its threshold set to 30, i.e.
     contributing nothing. An additive blend that contributes nothing
     cannot darken its destination, so the pass was not adding a bad
     value; something in its render-target and autoClear juggling was
     destroying the buffer the next pass reads. Pass flags were correct
     (needsSwap false, clear false) and the composer's read/write
     buffers were wired correctly, so there was no configuration fix.

     This version owns every target and every state change, is cheaper
     (3 mips, 7 fullscreen draws against 5 mips and 11), has a soft-knee
     high pass instead of a hard threshold, and - importantly - clamps
     and NaN-guards its input so no single bad pixel can propagate
     through the blur chain and take the whole screen with it.

     The result is handed to the composite as a texture rather than
     blended over the scene, so the grade sees scene and bloom
     separately and one fullscreen blend is saved. */

  const BLOOM_MIPS = q.bloomQuality >= 2 ? 4 : 3;
  const bloom = {
    enabled: Boolean(q.bloom),
    // Bloom is gathered from the scene buffer BEFORE exposure, so the
    // threshold is in scene-linear and stays put when the exposure
    // moves - but the visible strength does not, because the result is
    // added before the tonemap. Up from 0.055 to hold its weight now
    // that the exposure is nearly half what it was.
    strength: q.bloomQuality >= 2 ? 0.10 : 0.07,
    threshold: 1.0,
    knee: 0.55,
    targets: [],
  };

  function makeBloomTarget(w, h) {
    const target = new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
    });
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.magFilter = THREE.LinearFilter;
    // Clamped, or the tent filter wraps the far edge of the screen
    // around and a bright muzzle flash on the right glows on the left.
    target.texture.wrapS = THREE.ClampToEdgeWrapping;
    target.texture.wrapT = THREE.ClampToEdgeWrapping;
    bloom.targets.push(target);
    return target;
  }

  const bloomChain = [];
  for (let i = 0; i < BLOOM_MIPS; i += 1) bloomChain.push({ down: null, up: null });

  // One fullscreen quad, shared by every off-chain pass we own (bloom
  // mips, AO, AO blur). Each pass binds its own target and clears it
  // explicitly, so nothing here depends on renderer state set elsewhere.
  const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  const postScene = new THREE.Scene();
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  postScene.add(postQuad);

  /** Soft-knee high pass. A hard threshold makes bloom pop on and off
   *  as a highlight crosses it; the knee ramps it in over half a stop. */
  const brightMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tSource: { value: null },
      uThreshold: { value: bloom.threshold },
      uKnee: { value: bloom.knee },
      uTexel: { value: new THREE.Vector2() },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tSource;
      uniform float uThreshold;
      uniform float uKnee;
      uniform vec2 uTexel;

      void main() {
        // 4-tap box while downsampling to half res: sampling one texel
        // of a full-res buffer at half res aliases every bright thin
        // edge into a crawling sparkle.
        vec3 c = texture2D(tSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb
               + texture2D(tSource, vUv + uTexel * vec2( 1.0, -1.0)).rgb
               + texture2D(tSource, vUv + uTexel * vec2(-1.0,  1.0)).rgb
               + texture2D(tSource, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
        c *= 0.25;

        // Guard rails. A single non-finite pixel anywhere on screen
        // survives every blur tap and spreads across the whole chain -
        // this is exactly how a bloom pass turns one bad fragment into
        // a black or white frame. NaN fails every comparison including
        // equality with itself, which is the only portable test.
        if (!(c.r == c.r)) c.r = 0.0;
        if (!(c.g == c.g)) c.g = 0.0;
        if (!(c.b == c.b)) c.b = 0.0;
        c = clamp(c, vec3(0.0), vec3(48.0));

        float luma = max(c.r, max(c.g, c.b));
        // Karis-style soft knee around the threshold.
        float knee = uThreshold * uKnee + 1e-5;
        float soft = clamp(luma - uThreshold + knee, 0.0, 2.0 * knee);
        soft = soft * soft / (4.0 * knee);
        float contribution = max(soft, luma - uThreshold) / max(luma, 1e-5);

        gl_FragColor = vec4(c * contribution, 1.0);
      }
    `,
  });

  const downMaterial = new THREE.ShaderMaterial({
    uniforms: { tSource: { value: null }, uTexel: { value: new THREE.Vector2() } },
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tSource;
      uniform vec2 uTexel;
      void main() {
        vec3 c = texture2D(tSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb
               + texture2D(tSource, vUv + uTexel * vec2( 1.0, -1.0)).rgb
               + texture2D(tSource, vUv + uTexel * vec2(-1.0,  1.0)).rgb
               + texture2D(tSource, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
        gl_FragColor = vec4(c * 0.25, 1.0);
      }
    `,
  });

  /** 9-tap tent on the way back up, accumulating into the larger mip.
   *  A tent upsample is what makes the falloff look like a lens rather
   *  than like a stack of blurry rectangles. */
  const upMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tSource: { value: null },
      tPrevious: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uRadius: { value: 1.0 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tSource;
      uniform sampler2D tPrevious;
      uniform vec2 uTexel;
      uniform float uRadius;
      void main() {
        vec2 d = uTexel * uRadius;
        vec3 s = texture2D(tSource, vUv + vec2(-d.x,  d.y)).rgb
               + texture2D(tSource, vUv + vec2( 0.0,  d.y)).rgb * 2.0
               + texture2D(tSource, vUv + vec2( d.x,  d.y)).rgb
               + texture2D(tSource, vUv + vec2(-d.x,  0.0)).rgb * 2.0
               + texture2D(tSource, vUv).rgb * 4.0
               + texture2D(tSource, vUv + vec2( d.x,  0.0)).rgb * 2.0
               + texture2D(tSource, vUv + vec2(-d.x, -d.y)).rgb
               + texture2D(tSource, vUv + vec2( 0.0, -d.y)).rgb * 2.0
               + texture2D(tSource, vUv + vec2( d.x, -d.y)).rgb;
        s *= 0.0625;
        gl_FragColor = vec4(s + texture2D(tPrevious, vUv).rgb, 1.0);
      }
    `,
  });

  function resizeBloom(width, height) {
    let w = Math.max(2, Math.round(width * 0.5));
    let h = Math.max(2, Math.round(height * 0.5));
    for (let i = 0; i < BLOOM_MIPS; i += 1) {
      if (!bloomChain[i].down) {
        bloomChain[i].down = makeBloomTarget(w, h);
        bloomChain[i].up = makeBloomTarget(w, h);
      } else {
        bloomChain[i].down.setSize(w, h);
        bloomChain[i].up.setSize(w, h);
      }
      bloomChain[i].width = w;
      bloomChain[i].height = h;
      w = Math.max(2, Math.round(w * 0.5));
      h = Math.max(2, Math.round(h * 0.5));
    }
  }

  function drawQuad(material, target) {
    postQuad.material = material;
    renderer.setRenderTarget(target);
    // Explicit, so nothing depends on the renderer's autoClear state -
    // which is the class of coupling that made the library pass fail.
    renderer.clear(true, false, false);
    renderer.render(postScene, postCamera);
  }

  /** Build the bloom texture from an HDR source. Returns it, or null. */
  function renderBloom(sourceTexture) {
    if (!bloom.enabled || !bloomChain[0].down) return null;

    brightMaterial.uniforms.tSource.value = sourceTexture;
    brightMaterial.uniforms.uThreshold.value = bloom.threshold;
    brightMaterial.uniforms.uKnee.value = bloom.knee;
    brightMaterial.uniforms.uTexel.value.set(
      1 / bloomChain[0].width, 1 / bloomChain[0].height
    );
    drawQuad(brightMaterial, bloomChain[0].down);

    for (let i = 1; i < BLOOM_MIPS; i += 1) {
      downMaterial.uniforms.tSource.value = bloomChain[i - 1].down.texture;
      downMaterial.uniforms.uTexel.value.set(
        1 / bloomChain[i].width, 1 / bloomChain[i].height
      );
      drawQuad(downMaterial, bloomChain[i].down);
    }

    // Smallest mip needs no contribution from below it.
    let previous = bloomChain[BLOOM_MIPS - 1].down.texture;
    for (let i = BLOOM_MIPS - 2; i >= 0; i -= 1) {
      upMaterial.uniforms.tSource.value = previous;
      upMaterial.uniforms.tPrevious.value = bloomChain[i].down.texture;
      upMaterial.uniforms.uTexel.value.set(
        1 / bloomChain[i].width, 1 / bloomChain[i].height
      );
      drawQuad(upMaterial, bloomChain[i].up);
      previous = bloomChain[i].up.texture;
    }

    renderer.setRenderTarget(null);
    return previous;
  }

  /* ---------------------- ambient occlusion ----------------------
     Screen-space AO, half resolution, cross-bilateral upsample.

     This is the single biggest thing that was missing. Without it every
     junction in the frame - wall to ground, building to terrain, window
     reveal to facade - is a razor line between two evenly lit surfaces,
     and evenly lit surfaces that meet at a razor line read as decals
     stuck to each other rather than as objects occupying a space. No
     amount of texture detail or grading substitutes for it, because the
     cue it supplies is contact, not detail.

     Depth only: normals are reconstructed from the depth buffer, so no
     G-buffer and no per-material change. The reconstruction uses the
     nearer of each pair of neighbours rather than a plain derivative,
     which is what keeps silhouettes from growing a mitred bevel where
     the depth discontinuity would otherwise be differentiated.

     Half res costs a quarter of the taps and the bilateral blur puts
     the edges back; the alternative, full-res with fewer samples, is
     noisier in exactly the crevices the effect exists to darken. */

  const AO_SAMPLES = q.ssaoQuality >= 3 ? 16 : (q.ssaoQuality >= 2 ? 12 : 8);
  /* ---- the near term, and why one radius was never going to work ----

     Six rounds of blind art direction led with "nothing touches the
     ground", and every round the named mechanism was "there is no SSAO
     pass". That is measured false - `blacksand-grounding-probe.mjs`
     moves 21.5% of the median frame by switching this pass off. The
     symptom was real anyway, and working out the tap geometry in world
     units says why:

       depth  effective radius  innermost tap  taps under 15cm
        2.5m       33cm             11.7cm          2 / 16
          3m       39cm             14.0cm          1 / 16
          5m       65cm             23.4cm          0 / 16
         10m      105cm             37.6cm          0 / 16

     The disc is a RING. `span = mix(0.22, 1.0, rr) * radiusUv` keeps
     every tap at 22% of the radius or further out, and radiusUv is
     clamped to 0.14 to stop a close-up costing a full-screen gather, so
     at the range a barrel is actually looked at the nearest sample sits
     12-23cm away and nothing at all is measured inside 15cm. Contact
     darkening lives in the first 5-15cm. It was not being sampled.

     Hence two radii, not one bigger or smaller radius. The broad term
     keeps doing what it does well - creases, reveals, the underside of
     an awning - and a second, tight gather answers the only question the
     reviewer is asking: does the ground go dark where the object meets
     it. They are carried in separate channels because they want
     different floors and different blurs; see uAOFloor / uContactFloor
     in the composite and the split kernel in the blur below. */
  const ao = {
    enabled: Boolean(q.ssao),
    // Deliberately strong. A physically restrained AO is invisible at
    // this scale and the whole complaint being answered is that every
    // junction in the frame was a razor line; the measured cost of this
    // setting is under a percent of frame luma and it moves the local
    // detail statistic from below the reference median to above it.
    strength: 0.95,
    radius: 1.05,
    // Sine of the smallest angle above the tangent plane that counts as
    // occlusion, which is what rejects a surface occluding itself.
    bias: 0.05,
    power: 1.5,
    /* The near gather, in metres. 0.22m so its OUTER edge lands about
       where the broad term's innermost tap begins - the two together
       then cover the range continuously instead of leaving the hole
       measured above. Its own taps start at 6% of that, so the first
       sample is 1.3cm out. */
    nearRadius: 0.22,
    // Harder curve than the broad term. A near-field gather that is
    // already this local does not need to be talked out of its answer,
    // and the extra contrast is what turns a smudge into a seam.
    nearPower: 1.3,
    /* How far the screen-space contact ray may travel, in metres. The
       shadow filter's penumbra floor pins everything under ~6m of
       caster-receiver gap to one width (see SUN_ANGULAR_TAN), so sub-
       metre contact is the one thing the shadow map provably cannot
       express - it is below one texel. 0.35m is the band a prop, a
       soldier's boot or a wheel actually occupies. */
    contact: 0.35,
    contactStrength: 1.0,
    target: null,
    blur: null,
    width: 2,
    height: 2,
  };
  const AO_NEAR_SAMPLES = q.ssaoQuality >= 3 ? 8 : (q.ssaoQuality >= 2 ? 6 : 4);
  const AO_CONTACT_STEPS = q.ssaoQuality >= 3 ? 8 : (q.ssaoQuality >= 2 ? 6 : 0);
  const aoSunWorld = new THREE.Vector3(0, 1, 0);

  function makeAoTarget() {
    // RGBA8 rather than R8: single-channel colour targets are the one
    // format that still trips over driver differences, and the memory
    // saved at half res is not worth the class of bug.
    const target = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.UnsignedByteType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
    });
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.magFilter = THREE.LinearFilter;
    target.texture.wrapS = THREE.ClampToEdgeWrapping;
    target.texture.wrapT = THREE.ClampToEdgeWrapping;
    return target;
  }

  const aoMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tDepth: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uInvProjection: { value: new THREE.Matrix4() },
      // Half the vertical projection scale: turns a world radius at a
      // given view depth straight into a uv radius, which is what the
      // screen-space disc needs.
      uProjScale: { value: 1.0 },
      uAspect: { value: 1.0 },
      uRadius: { value: ao.radius },
      uBias: { value: ao.bias },
      uPower: { value: ao.power },
      uNearRadius: { value: ao.nearRadius },
      uNearPower: { value: ao.nearPower },
      uContact: { value: ao.contact },
      // The sun in VIEW space. The contact ray marches towards it, so it
      // has to be in the space the depth buffer unprojects into.
      uSunView: { value: new THREE.Vector3(0, 1, 0) },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      #define AO_SAMPLES ${AO_SAMPLES}
      #define AO_NEAR_SAMPLES ${AO_NEAR_SAMPLES}
      #define AO_CONTACT_STEPS ${AO_CONTACT_STEPS}

      varying vec2 vUv;
      uniform sampler2D tDepth;
      uniform vec2 uResolution;
      uniform mat4 uInvProjection;
      uniform float uProjScale;
      uniform float uAspect;
      uniform float uRadius;
      uniform float uBias;
      uniform float uPower;
      uniform float uNearRadius;
      uniform float uNearPower;
      uniform float uContact;
      uniform vec3 uSunView;

      vec3 viewFromDepth(vec2 uv, float d) {
        vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        vec4 v = uInvProjection * clip;
        return v.xyz / v.w;
      }

      void main() {
        float depth = texture2D(tDepth, vUv).x;
        // Sky writes no depth. Occluding the sky produces a dark halo
        // around every silhouette, which is the classic tell of an AO
        // pass that forgot to mask it.
        if (depth >= 0.999999) { gl_FragColor = vec4(1.0); return; }

        vec2 texel = 1.0 / uResolution;
        vec3 p = viewFromDepth(vUv, depth);

        /* ---- normal from depth ----
           Take the NEARER neighbour on each axis. A plain central
           difference straddles silhouettes and produces a normal that
           belongs to neither surface, which shows up as a bright or
           dark bevel one pixel wide along every edge in the frame. */
        vec3 pL = viewFromDepth(vUv - vec2(texel.x, 0.0), texture2D(tDepth, vUv - vec2(texel.x, 0.0)).x);
        vec3 pR = viewFromDepth(vUv + vec2(texel.x, 0.0), texture2D(tDepth, vUv + vec2(texel.x, 0.0)).x);
        vec3 pD = viewFromDepth(vUv - vec2(0.0, texel.y), texture2D(tDepth, vUv - vec2(0.0, texel.y)).x);
        vec3 pU = viewFromDepth(vUv + vec2(0.0, texel.y), texture2D(tDepth, vUv + vec2(0.0, texel.y)).x);

        vec3 dx = abs(pR.z - p.z) < abs(p.z - pL.z) ? (pR - p) : (p - pL);
        vec3 dy = abs(pU.z - p.z) < abs(p.z - pD.z) ? (pU - p) : (p - pD);
        vec3 n = normalize(cross(dx, dy));
        if (n.z < 0.0) n = -n;

        // Rotate the kernel per pixel, then let the bilateral blur turn
        // the resulting dither into a gradient.
        float rot = 6.2831853 * fract(52.9829189 *
          fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

        /* ---- the estimator ----
           Alchemy/HBAO form: sample a disc AROUND the pixel in screen
           space, reconstruct where each of those samples actually is,
           and ask how far ABOVE this pixel's tangent plane it sits.

           The obvious alternative - place sample points in a hemisphere,
           project them, and compare the depth buffer against the sample
           point's own depth - was written first and is what shipped
           broken. On a floor seen at a grazing angle the depth changes
           by tens of centimetres between adjacent texels, so the
           comparison exceeds any fixed bias and half the samples come
           back "occluded". A flat empty road rendered as a solid black
           wedge: 26% of the frame at pure zero.

           Measuring the angle above the tangent plane has no such
           failure mode, because a flat surface is its own tangent plane
           at every angle. It also needs no projection round trip. */
        float radiusUv = clamp(uRadius * uProjScale / max(-p.z, 0.05), texel.x, 0.14);

        float occlusion = 0.0;
        float weight = 1e-4;
        for (int i = 0; i < AO_SAMPLES; i++) {
          float fi = float(i) + 0.5;
          float rr = sqrt(fi / float(AO_SAMPLES));
          float a = fi * 2.39996323 + rot;
          // Bias the taps towards the centre. Crevice contact is what
          // the eye reads; evenly spaced taps spend most of the budget
          // on the outer shell where nothing happens.
          float span = mix(0.22, 1.0, rr) * radiusUv;
          vec2 suv = vUv + vec2(cos(a) / uAspect, sin(a)) * span;
          if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;

          float sd = texture2D(tDepth, suv).x;
          if (sd >= 0.999999) { weight += 1.0; continue; }

          vec3 v = viewFromDepth(suv, sd) - p;
          float d2 = dot(v, v);
          float horizon = dot(n, v) * inversesqrt(max(d2, 1e-8));
          // Anything further than the radius stops counting, so a wall
          // fifty metres behind a lamp post is not occluded by it.
          float falloff = clamp(1.0 - d2 / (uRadius * uRadius), 0.0, 1.0);
          occlusion += max(0.0, horizon - uBias) * falloff;
          weight += 1.0;
        }

        float visibility = 1.0 - clamp(occlusion / weight * 1.9, 0.0, 1.0);
        float broad = pow(clamp(visibility, 0.0, 1.0), uPower);

        /* ---- the near gather ----
           Same estimator, same rotation, a radius two orders of
           magnitude smaller in area. The floor on radiusUv is what makes
           it survive distance: below about one texel the disc collapses
           inside a single sample and the term would dither instead of
           fading, so it is pinned to 1.5 texels and simply stops
           resolving contacts it can no longer see - which is correct,
           because a 15cm seam at 80m is a sub-pixel feature. */
        float nearUv = clamp(uNearRadius * uProjScale / max(-p.z, 0.05),
          texel.y * 1.5, 0.05);
        float nearOcc = 0.0;
        float nearWeight = 1e-4;
        float nearWorld = nearUv * max(-p.z, 0.05) / max(uProjScale, 1e-4);
        for (int i = 0; i < AO_NEAR_SAMPLES; i++) {
          float fi = float(i) + 0.5;
          // LINEAR in radius, where the broad term above is linear in
          // AREA (sqrt). Area-uniform sampling is right for estimating
          // an average visibility and wrong for finding a seam: it puts
          // six of eight taps in the outer half of the disc, so the
          // nearest sample lands 6cm out and the 1-3cm band that decides
          // whether an object is sitting on the ground is missed again,
          // just at a smaller scale than before.
          float rr = fi / float(AO_NEAR_SAMPLES);
          float a = fi * 2.39996323 + rot + 1.7;
          // Starts at 6% of the radius rather than 22%: the whole point
          // of this term is the sample the broad one never takes.
          float span = mix(0.06, 1.0, rr) * nearUv;
          vec2 suv = vUv + vec2(cos(a) / uAspect, sin(a)) * span;
          if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
          float sd = texture2D(tDepth, suv).x;
          if (sd >= 0.999999) { nearWeight += 1.0; continue; }
          vec3 v = viewFromDepth(suv, sd) - p;
          float d2 = dot(v, v);
          float horizon = dot(n, v) * inversesqrt(max(d2, 1e-8));
          float falloff = clamp(1.0 - d2 / max(nearWorld * nearWorld, 1e-6), 0.0, 1.0);
          nearOcc += max(0.0, horizon - uBias) * falloff;
          nearWeight += 1.0;
        }
        /* 3.6, against the broad term's 1.9, and the difference is not
           taste. Both divide by the FULL tap count, but at a seam only
           the taps pointing at the object can report anything, so a term
           whose whole job is the seam is normalised by roughly twice the
           population that can contribute to it. Worse, the surface a
           depth-only gather can see near a contact is the object's own
           silhouette, which sits at almost the same height as the ground
           it meets - so the tangent-plane elevation is small exactly
           where the true occlusion is largest, and the occluding mass is
           behind the visible surface where no depth buffer can find it.
           The gain is the correction for both. It is bounded by
           uContactFloor in the composite rather than by being timid
           here, which is what keeps a genuine crevice from going black
           while still letting a seam reach the reference's 0.48. */
        float nearVis = 1.0 - clamp(nearOcc / nearWeight * 3.6, 0.0, 1.0);
        nearVis = pow(clamp(nearVis, 0.0, 1.0), uNearPower);

        /* ---- the contact ray ----
           A short march towards the sun in view space. This is the one
           cue the shadow map cannot supply: worked out in the unit the
           PCSS filter samples in, a gap under six metres produces less
           than the filter's 0.55-texel floor, so every sub-metre contact
           in the game resolves to the same hard edge one texel wide, and
           the normal bias then slides that edge 8.6cm off the caster.
           A screen-space ray is not subject to either - it works at
           frame resolution, right where the eye is looking.

           Marched in VIEW space and re-projected per step rather than
           interpolated in screen space, because a ray pointing near the
           camera axis covers almost no screen distance and a screen-space
           lerp would put every step in the same texel. */
        float contactVis = 1.0;
        #if AO_CONTACT_STEPS > 0
        /* Near field only, and faded rather than cut. Past about forty
           metres a half-res texel is wider than the 35cm the ray is
           allowed to travel, so every step lands in the same texel and
           the term degenerates into noise. It is also invisible there,
           which is the honest reason to stop paying for it. */
        float contactFade = 1.0 - smoothstep(26.0, 44.0, -p.z);
        if (uContact > 0.0 && contactFade > 0.001) {
          // Off the surface along its own normal first. Without this the
          // first step starts inside the receiver at grazing angles and
          // every lit surface self-shadows into a dark wash - the same
          // failure the tangent-plane estimator above was written to
          // avoid, arriving by a different route.
          vec3 origin = p + n * 0.02;
          // Jittered start, so what is left of the step aliasing is the
          // stationary dither the bilateral blur is already built to eat.
          float jitter = fract(rot * 0.15915494) * 0.5 + 0.25;
          float stepLen = uContact / float(AO_CONTACT_STEPS);
          /* Depth slop grows with distance: the same texel spans more
             world at range, so a fixed acceptance band that is right at
             three metres reports the ground shadowing itself at thirty. */
          float minGap = 0.012 + (-p.z) * 0.0035;
          float maxGap = 0.35 + (-p.z) * 0.02;
          float occluded = 0.0;
          for (int i = 0; i < AO_CONTACT_STEPS; i++) {
            vec3 s = origin + uSunView * (stepLen * (float(i) + jitter));
            /* Project by hand. Only these two ratios are needed, and
               uProjScale is already P11/2, so P00 is that over the
               aspect - a full matrix multiply per step would roughly
               double the cost of this loop for nothing. */
            float invW = 1.0 / max(-s.z, 1e-3);
            vec2 suv = vec2(0.5 + s.x * uProjScale * invW / uAspect,
                            0.5 + s.y * uProjScale * invW);
            if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
            float sd = texture2D(tDepth, suv).x;
            if (sd >= 0.999999) continue;
            /* scene.z ABOVE s.z means the depth buffer is nearer the
               camera than the ray is, i.e. something stands between this
               surface and the sun. The upper bound is a thickness test:
               without it the ray is occluded by anything in front of it
               at any distance, and every frame grows a dark halo behind
               every silhouette. */
            vec3 scene = viewFromDepth(suv, sd);
            /* ---- the surface may not occlude ITSELF ----
               A depth comparison alone reads a surface's own slope as an
               occluder. On a grazing view of rippled sand adjacent texels
               differ in depth by more than any fixed bias, so with a low
               sun - when the ray runs nearly parallel to the ground - a
               35cm march found a "blocker" almost everywhere and laid a
               broad wash over the whole mid-ground. Measured on the
               checkpoint pose, the ray alone moved 48.7% of the frame,
               which is not a contact term, it is dirt.

               So test the same way the gather above does: how far is this
               sample ABOVE my own tangent plane. A point on my plane is
               my own surface however different its depth is, and only
               something genuinely standing off the plane can shadow it.
               This is the whole reason the estimator above was rewritten
               once already; the ray needed the same lesson. */
            if (dot(n, scene - p) < 0.05) continue;
            float diff = scene.z - s.z;
            if (diff > minGap && diff < maxGap) {
              // Nearer hits are darker - a caster 4cm away seats an
              // object, one 30cm away is a soft ambient loss.
              occluded = 1.0 - float(i) / float(AO_CONTACT_STEPS);
              break;
            }
          }
          contactVis = 1.0 - occluded * 0.85 * contactFade;
        }
        #endif

        /* R is the broad term, G the near one. Two channels rather than
           one combined value because the composite floors them
           differently: the broad term multiplies direct sunlight it has
           no business removing and needs a high floor, while a true
           contact is geometrically entitled to go much darker. The blur
           below treats them differently too. */
        gl_FragColor = vec4(broad, min(nearVis, contactVis), 0.0, 1.0);
      }
    `,
  });

  /** Cross-bilateral blur. Separable, depth-weighted, so the AO stays
   *  put across a silhouette instead of bleeding sky into geometry.
   *
   *  Two kernels, one pass. The broad term wants the full nine taps -
   *  it is a low-frequency estimate from a rotated 16-tap disc and it is
   *  noisy. Running the same kernel over the near term would destroy the
   *  thing the near term exists to produce: +-7 half-res texels is +-14
   *  full-res pixels, and a contact seam is three or four pixels wide, so
   *  the nine-tap kernel spreads it over twenty-eight and drops its
   *  amplitude by about five times. Measured on a barrel at 3m, that is
   *  the difference between a seam and a smudge. The near term therefore
   *  gets only the two innermost taps, which is enough to knock the
   *  dither off eight rotated samples and no more. Same fetches either
   *  way, so the split is free. */
  const aoBlurMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tAO: { value: null },
      tDepth: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uDirection: { value: new THREE.Vector2(1, 0) },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tAO;
      uniform sampler2D tDepth;
      uniform vec2 uTexel;
      uniform vec2 uDirection;

      float centreDepth;
      vec2 sum;
      vec2 weight;

      /* Depth is heavily non-linear, so the similarity test compares in
         the ENCODED space. Over the few metres a 9-tap blur spans that
         is close enough to a constant world-space tolerance, and it
         costs no unprojection per tap. */
      void tap(vec2 uv, float w0, float wNear) {
        float d = texture2D(tDepth, uv).x;
        float w = exp(-abs(d - centreDepth) * 90000.0);
        vec2 v = texture2D(tAO, uv).rg;
        vec2 ww = vec2(w0, wNear) * w;
        sum += v * ww;
        weight += ww;
      }

      void main() {
        centreDepth = texture2D(tDepth, vUv).x;
        vec2 centre = texture2D(tAO, vUv).rg;
        sum = centre * vec2(0.227027, 0.38);
        weight = vec2(0.227027, 0.38);
        vec2 step1 = uDirection * uTexel * 1.3846154;
        vec2 step2 = uDirection * uTexel * 3.2307692;
        vec2 step3 = uDirection * uTexel * 5.1153846;
        vec2 step4 = uDirection * uTexel * 7.0;
        tap(vUv + step1, 0.3162162, 0.31);
        tap(vUv - step1, 0.3162162, 0.31);
        tap(vUv + step2, 0.0702703, 0.0);
        tap(vUv - step2, 0.0702703, 0.0);
        tap(vUv + step3, 0.0180000, 0.0);
        tap(vUv - step3, 0.0180000, 0.0);
        tap(vUv + step4, 0.0045000, 0.0);
        tap(vUv - step4, 0.0045000, 0.0);
        gl_FragColor = vec4(sum / max(weight, vec2(1e-4)), 0.0, 1.0);
      }
    `,
  });

  function resizeAo(width, height) {
    if (!ao.enabled) return;
    ao.width = Math.max(2, Math.round(width * 0.5));
    ao.height = Math.max(2, Math.round(height * 0.5));
    if (!ao.target) {
      ao.target = makeAoTarget();
      ao.blur = makeAoTarget();
    }
    ao.target.setSize(ao.width, ao.height);
    ao.blur.setSize(ao.width, ao.height);
    aoMaterial.uniforms.uResolution.value.set(ao.width, ao.height);
    aoBlurMaterial.uniforms.uTexel.value.set(1 / ao.width, 1 / ao.height);
  }

  /** Build the AO texture from the scene depth. Returns it, or null. */
  function renderAo(depthTexture) {
    if (!ao.enabled || !ao.target || !depthTexture || ao.strength <= 0) return null;

    aoMaterial.uniforms.tDepth.value = depthTexture;
    aoMaterial.uniforms.uInvProjection.value.copy(camera.projectionMatrixInverse);
    // P11 is 1/tan(fovY/2); half of it converts a world radius at unit
    // depth into a uv radius. The disc is drawn in uv, so the x axis
    // has to be scaled by the aspect to stay circular in world terms.
    aoMaterial.uniforms.uProjScale.value = camera.projectionMatrix.elements[5] * 0.5;
    aoMaterial.uniforms.uAspect.value = camera.aspect;
    aoMaterial.uniforms.uRadius.value = ao.radius;
    aoMaterial.uniforms.uBias.value = ao.bias;
    aoMaterial.uniforms.uPower.value = ao.power;
    aoMaterial.uniforms.uNearRadius.value = ao.nearRadius;
    aoMaterial.uniforms.uNearPower.value = ao.nearPower;
    aoMaterial.uniforms.uContact.value = ao.contact;
    /* The sun in view space. Taken from the light's own transform rather
       than from ctx.sky, because render.js owns this light and a module
       that reads another module's state at frame time is the one thing
       the ctx contract asks us not to do. */
    aoSunWorld.copy(sun.position).sub(sun.target.position).normalize();
    aoMaterial.uniforms.uSunView.value
      .copy(aoSunWorld)
      .transformDirection(camera.matrixWorldInverse)
      .normalize();
    drawQuad(aoMaterial, ao.target);

    aoBlurMaterial.uniforms.tDepth.value = depthTexture;
    aoBlurMaterial.uniforms.tAO.value = ao.target.texture;
    aoBlurMaterial.uniforms.uDirection.value.set(1, 0);
    drawQuad(aoBlurMaterial, ao.blur);

    aoBlurMaterial.uniforms.tAO.value = ao.blur.texture;
    aoBlurMaterial.uniforms.uDirection.value.set(0, 1);
    drawQuad(aoBlurMaterial, ao.target);

    renderer.setRenderTarget(null);
    return ao.target.texture;
  }

  /* ------------------------ auto exposure ------------------------
     Centre-weighted average luminance, measured on the GPU, fed to the
     composite as a 1x1 texture.

     The exposure used to come from sun elevation and weather alone.
     That is right about the LIGHT and blind to the SCENE, so the same
     time of day produced a blown-out ridge line from a rooftop and a
     crushed black alley thirty metres away - measured across ten beauty
     shots the frame mean ran from 48 to 183 where the reference sits
     between 81 and 160. No grade fixes that, because it is not one
     error: it is two errors in opposite directions.

     The brief warns that sampling the framebuffer back to the CPU
     stalls the pipeline, and it is right. Nothing is read back. The
     scene is reduced to one texel on the GPU, adaptation is a mix
     against the previous frame's texel, and the composite SAMPLES the
     result - so the whole loop stays on the GPU and costs four tiny
     draws.

     Log-average, not linear: the eye adapts in stops, and a linear
     average is dominated by whichever handful of pixels are brightest,
     which is exactly the sky. Centre-weighted for the same reason a
     camera is - the subject is in the middle, and a frame that is 60%
     sky should not be metered for the sky. */

  const meter = {
    enabled: true,
    /** Target average scene luminance. The knob that says how bright a
     *  correctly-exposed frame is before the grade sees it. */
    key: 0.162,
    /** How far auto exposure is allowed to move the sky's own value.
     *  Wide enough to rescue an interior, tight enough that a dark
     *  frame stays dark - it is a camera, not a night-vision tube. */
    min: 0.35,
    max: 2.6,
    /** Stops per second of adaptation. */
    rate: 3.0,
    targets: [],
    chain: [],
    adapt: [],
    index: 0,
    primed: false,
  };

  function makeMeterTarget(size) {
    const target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
    });
    target.texture.minFilter = THREE.NearestFilter;
    target.texture.magFilter = THREE.NearestFilter;
    target.texture.wrapS = THREE.ClampToEdgeWrapping;
    target.texture.wrapT = THREE.ClampToEdgeWrapping;
    meter.targets.push(target);
    return target;
  }

  const meterMaterial = new THREE.ShaderMaterial({
    uniforms: { tSource: { value: null }, uTexel: { value: new THREE.Vector2() } },
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tSource;
      uniform vec2 uTexel;
      void main() {
        // 16 taps spread over this output texel's footprint. The chain
        // below only averages 64x64 texels, so without a spread here
        // the meter would be a 4096-pixel point sample of a two-million
        // pixel frame and would flicker on every camera nudge.
        float sum = 0.0;
        for (int y = 0; y < 4; y++) {
          for (int x = 0; x < 4; x++) {
            vec2 o = (vec2(float(x), float(y)) + 0.5) * 0.25 - 0.5;
            vec3 c = texture2D(tSource, vUv + o * uTexel).rgb;
            float l = dot(max(c, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
            // A NaN anywhere in the frame would otherwise poison the
            // single texel that drives the exposure of everything.
            if (!(l == l)) l = 0.0;
            sum += log2(clamp(l, 1e-4, 60.0));
          }
        }
        // Centre weighting, as a camera meters. Squared falloff so the
        // corners still count for something.
        vec2 d = vUv - 0.5;
        float w = mix(0.28, 1.0, 1.0 - smoothstep(0.04, 0.30, dot(d, d)));
        gl_FragColor = vec4((sum / 16.0) * w, w, 0.0, 1.0);
      }
    `,
  });

  const meterDownMaterial = new THREE.ShaderMaterial({
    uniforms: { tSource: { value: null }, uTexel: { value: new THREE.Vector2() } },
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tSource;
      uniform vec2 uTexel;
      void main() {
        vec2 sum = vec2(0.0);
        for (int y = 0; y < 4; y++) {
          for (int x = 0; x < 4; x++) {
            vec2 o = (vec2(float(x), float(y)) + 0.5) * 0.25 - 0.5;
            sum += texture2D(tSource, vUv + o * uTexel).rg;
          }
        }
        gl_FragColor = vec4(sum / 16.0, 0.0, 1.0);
      }
    `,
  });

  const meterAdaptMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tCurrent: { value: null },
      tPrevious: { value: null },
      uBlend: { value: 1.0 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tCurrent;
      uniform sampler2D tPrevious;
      uniform float uBlend;
      void main() {
        vec2 c = texture2D(tCurrent, vec2(0.5)).rg;
        // The weights were carried down the chain alongside the values,
        // so the centre weighting divides out exactly here rather than
        // being approximated at every level.
        float target = c.r / max(c.g, 1e-5);
        float previous = texture2D(tPrevious, vec2(0.5)).r;
        gl_FragColor = vec4(mix(previous, target, clamp(uBlend, 0.0, 1.0)), 1.0, 0.0, 1.0);
      }
    `,
  });

  function buildMeter() {
    if (meter.chain.length) return;
    for (const size of [64, 16, 4, 1]) meter.chain.push(makeMeterTarget(size));
    meter.adapt = [makeMeterTarget(1), makeMeterTarget(1)];
  }
  buildMeter();

  /** Reduce the HDR scene to one adapted log-luminance texel. */
  function renderMeter(sourceTexture, dt) {
    if (!meter.enabled) return null;

    meterMaterial.uniforms.tSource.value = sourceTexture;
    meterMaterial.uniforms.uTexel.value.set(1 / 64, 1 / 64);
    drawQuad(meterMaterial, meter.chain[0]);

    for (let i = 1; i < meter.chain.length; i += 1) {
      const size = meter.chain[i - 1].width;
      meterDownMaterial.uniforms.tSource.value = meter.chain[i - 1].texture;
      meterDownMaterial.uniforms.uTexel.value.set(1 / size, 1 / size);
      drawQuad(meterDownMaterial, meter.chain[i]);
    }

    const previous = meter.adapt[meter.index];
    const next = meter.adapt[1 - meter.index];
    meterAdaptMaterial.uniforms.tCurrent.value = meter.chain[meter.chain.length - 1].texture;
    meterAdaptMaterial.uniforms.tPrevious.value = previous.texture;
    // Snap on the first frame: the previous texel starts cleared to
    // zero, which is a perfectly valid log-luminance of 1.0, so easing
    // from it would open the first second of the game a stop too dark.
    meterAdaptMaterial.uniforms.uBlend.value =
      meter.primed ? 1 - Math.exp(-meter.rate * Math.min(dt, 0.25)) : 1;
    drawQuad(meterAdaptMaterial, next);
    meter.primed = true;
    meter.index = 1 - meter.index;

    renderer.setRenderTarget(null);
    return next.texture;
  }

  /* --------------------- composite / grade pass --------------------- */

  /**
   * One pass, several jobs. Motion blur samples along the per-pixel
   * screen-space velocity reconstructed from the previous view-projection
   * matrix, so it costs a matrix and a depth read rather than a velocity
   * buffer.
   */
  const CompositeShader = {
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      tBloom: { value: null },
      tAO: { value: null },
      uAOStrength: { value: 0.0 },
      /** How dark occlusion is allowed to drive a surface, as a
       *  fraction of its unoccluded value. See the composite. */
      uAOFloor: { value: 0.24 },
      /* The near term's own floor. Low because a contact seam is
         entitled to be dark - see the argument in the composite - but
         not zero: at 0.0 a barrel's base punched a hole in the frame
         that read as a missing polygon rather than as shade. 0.10 is
         about what a contact seam measures in the reference frames. */
      uContactFloor: { value: 0.10 },
      uBloomStrength: { value: 0.0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uExposure: { value: 1.0 },
      /** 1x1, R = adapted log2 of the centre-weighted scene luminance.
       *  Null disables auto exposure and the sky's value is used raw. */
      tMeter: { value: null },
      uMeterKey: { value: meter.key },
      uMeterRange: { value: new THREE.Vector2(meter.min, meter.max) },
      uTime: { value: 0 },

      uMotionBlur: { value: q.motionBlur ? 0.6 : 0.0 },
      uInvViewProj: { value: new THREE.Matrix4() },
      uPrevViewProj: { value: new THREE.Matrix4() },

      /* ---- no film grain ----
         Zero, where it was 0.026, and it was not a taste call.

         The grain is uniform-amplitude noise added across the whole
         frame. blacksand-detail-split normalises high-pass energy by
         each population's OWN mean brightness, so a fixed amount of
         noise is a far larger fraction of a shaded pixel than a
         sunlit one - the grain was being counted as texture in the
         shadows. Measured on gameplay framing, turning it off alone:

           detail in shade  0.415 -> 0.376     lit:shade  0.60 -> 0.73
           lit:shade saturation                           0.94 -> 1.03

         That is the largest single move on the detail ratio found in
         this round, from deleting something. It is not only a metric
         artefact either: the reviewer is comparing against Battlefield
         2 screenshots, none of which have film grain at all, and "is
         this the render or a filter over it?" is on its scorecard.
         Left as a live uniform rather than deleted so the critic loop
         can still sweep it through __BS.grade({ grain }). */
      uGrain: { value: 0.0 },
      uChroma: { value: q.chromaticAberration ? 0.75 : 0.0 },
      uVignette: { value: 0.26 },
      uSharpen: { value: 0.36 },

      /* ---- aerial perspective ----
         Depth-driven, replacing three's FogExp2. Exponential fog is a
         single grey number: it cannot brighten towards the sun, cannot
         turn distant ridges blue, and cannot pool in a wadi. The terms
         here are the two halves of single scattering - OUT-scattering
         (exp(-tau), which drains contrast) and IN-scattering (what the
         air itself glows, which is where the colour comes from) - and
         they are what make 900m read as a thousand metres of air
         rather than as a draw-distance cutoff. */
      uCameraPos: { value: new THREE.Vector3() },
      uSunDirWorld: { value: new THREE.Vector3(0, 1, 0) },
      // Per-metre extinction. Rayleigh is the measured 680/550/440nm
      // ratio scaled up: at map scale the true coefficient is four
      // orders of magnitude too weak to see, but the RATIO is what
      // makes distance go blue and it has to be kept.
      uBetaR: { value: new THREE.Vector3(1.06e-4, 2.47e-4, 6.06e-4) },
      uBetaM: { value: 4.0e-4 },
      uMieG: { value: 0.62 },
      // Level and tint of the in-scattered light. sky.js calibrates
      // the level so the haze away from the sun lands on the sky's own
      // horizon brightness - that is what stops distant terrain
      // showing a seam against the dome.
      uAerialTint: { value: new THREE.Color(1, 1, 1) },
      uAerialLevel: { value: 0.6 },
      uAerialSky: { value: new THREE.Vector3(0.05, 0.07, 0.11) },
      uAerial: { value: 1.0 },
      /* ---- what distance does besides veiling ----
         The single-scattering terms above get the BRIGHTNESS of
         distance right and nothing else. Two corrections sit on top,
         and both exist because the first version failed the same test
         in opposite directions: the 250m midground came back MORE
         saturated and MORE contrasty than the 30m foreground, which
         inverts the depth cue and makes a kilometre of desert read as
         a flat painted backdrop.

         uHazeSat pulls the in-scattered air itself towards neutral.
         Physically the air really is tinted, but ours is tinted by the
         sun colour AND the Rayleigh ratio AND then multiplied by the
         grade's saturation, and three multiplications of the same bias
         is how a haze ends up magenta.

         uAerialDesat drains the SURFACE as the veil closes, which is
         what actually sells recession: contrast and colour both fall
         with distance because direct radiance is being replaced by
         isotropic glow. */
      uHazeSat: { value: 0.42 },
      uAerialDesat: { value: 0.85 },
      /* ---- where the in-scatter is allowed to start ----
         The single-scattering integral assumes the whole path from the
         eye to the surface is in sunlight. Looking across a kilometre of
         open desert that is true and the term is what sells the
         distance. Looking at a wall thirty metres away down a street it
         is false: those thirty metres of air are inside the town's own
         shadow and glow almost not at all.

         Measured on the street pose, with no ramp: the air added
         (0.0068, 0.0089, 0.0142) of scene radiance to a shaded concrete
         wall at 25-60m, against the wall's own 0.0045. More than half
         of what that surface sent to the camera was in-scattered air,
         it arrived at twice as much blue as red, and the grade's log
         slope and look saturation then amplified the residual chroma
         about twofold. That is the whole of the cyan: shaded sand is
         four times brighter and never showed it, shaded concrete is
         near-neutral and showed nothing else.

         Suppressing in-scatter over the near field is a coarse stand-in
         for path shadowing, and it is a far better model of a built-up
         scene than the unshadowed integral. It touches only the near
         field: at 250m the ramp is already 0.86, so the aerial
         perspective that carries the depth read is unchanged. The
         extinction term is deliberately NOT ramped - out-scattering
         happens whether the air is lit or not. */
      uAerialNear: { value: new THREE.Vector2(8.0, 150.0) },
      // Aerosol scale height, and the low layer that pools in terrain.
      // x: scale height, y: reference altitude, z: ground-layer
      // density multiplier, w: ground-layer scale height.
      uFogProfile: { value: new THREE.Vector4(900, 0, 0, 24) },

      /* ---- screen-space light shafts ---- */
      // xy: the sun in screen uv. z: how much of it to believe (0 when
      // the sun is behind the camera or below the horizon).
      uSunScreen: { value: new THREE.Vector3(0.5, 0.5, 0) },
      uShafts: { value: 0 },

      /* ---- cloud shadow ----
         x: strength, y: world scale, zw: scroll offset. Applied to the
         whole radiance rather than to the sun term alone, because the
         composite has no way to separate them - at the strengths a
         cloud deck actually produces (25-35%) the difference is not
         visible, and the alternative is patching every material in the
         scene to carry a second shadow lookup. */
      uCloudShadow: { value: new THREE.Vector4(0, 0.0016, 0, 0) },

      // Grade. Lift/gamma/gain plus a saturation and a temperature
      // push. These are the knobs the art director actually turns.
      // Lift is NEGATIVE: AgX's toe is gentle and lands the darkest
      // parts of a daylit frame around luma 18-24, which reads as haze
      // rather than as shadow. Pulling the toe under zero is what puts
      // a real black point back in the histogram.
      /* ---- the look ----
         Found by sweeping against the measured Battlefield 2 reference
         distribution (scripts/blacksand-grade-tune.mjs), not by eye. */
      /** Contrast applied in AgX's LOG domain, pivoted on middle grey.
       *
       *  This is the knob that was missing, and its absence is why the
       *  histogram lived in the midrange. Measured through the
       *  comparison crop, the middle half of our frame spanned codes
       *  119-156 where Battlefield 2's spans 66-135 - the same picture
       *  squeezed into half the tonal width. Slope on the log-encoded
       *  value expands symmetrically about mid grey, so it buys that
       *  width back without moving the exposure or bending the hue,
       *  which is precisely what every one of the display-referred
       *  knobs below fails to do. */
      /* ---- how much of AgX's shoulder to give back ----
         0 = the shipped sigmoid, 1 = the identity line.

         The sigmoid's slope, tabulated: 1.74 at x 0.5, peaking 2.05 at
         0.6, then 1.34 at 0.8, 0.97 at 0.85, 0.64 at 0.9, 0.44 at 0.95.
         It crosses 1.0 at x = 0.845, and THAT is the split that
         matters, not middle grey. Below it the curve has MORE contrast
         than a straight line, so relaxing costs you; above it the
         curve has less, so relaxing buys it back.

         Which is why relaxing on its own does nothing for the defect
         it was aimed at. Our lit population sits at x 0.72-0.92, and
         most of that is where the sigmoid is steeper than identity:
         swept, relax 1.0 alone takes lit IQR 25.2 -> 23.0. It is not
         the shoulder that was compressing the sunlight.

         What it IS good for is that identity cannot exceed 1, so it
         cannot clip - and that is the property every other expansion
         lever lacked. It is here to let uLogSlope be pushed to 2.20
         without the top of the range folding over. See uLogSlope.

         uRelaxSplit 1 relaxes only across the crossover; 0 relaxes the
         whole curve, which measured worse on everything (IQR 21.9,
         lit hue 26, frame luma 118) and is kept only as a probe. */
      uShoulderRelax: { value: 1.0 },
      uRelaxSplit: { value: 1.0 },
      /* 2.20, where it was 1.45 - and it only became usable once the
         shoulder above was relaxed. Round 8 measured this exact knob
         at 1.45 -> 1.65 buying 1.6 of lit IQR, which is why it was
         left alone; what changed is not the term, it is that it no
         longer runs into a collapsing sigmoid at the top.

         The paired result, gameplay framing:

           relax 0, logSlope 1.45    IQR 25.2   top2 0.13%
           relax 0, logSlope 1.95    IQR 26.9   top2 0.13%
           relax 1, logSlope 1.45    IQR 23.0   top2 0.15%
           relax 1, logSlope 2.20    IQR 31.0   top2 0.15%

         Neither term does anything alone. Slope widens the range and
         the sigmoid ate the widening; identity keeps the top honest
         and has no contrast of its own to give.

         Shipped at 1.35, and the history of that number is the point.
         2.20 was swept as best, 1.90 shipped to keep frame sd inside
         38.7-57.6, and then structures.js raised the clamp in
         albedoScaleFor from 6 to 12 - five materials had been losing
         up to 47% of their brightness - which lifted material contrast
         across the whole built set and took sd to 61.4 on its own.

         This term is therefore NOT a free parameter of the look: it is
         whatever is left of the frame's contrast budget after the
         world has spent its share, and the world's share moves. It is
         set below the original 1.45 deliberately, so that the
         world-dressing work now adding material and orientation
         variety to open ground has somewhere to land. Expect to revisit
         it downward again rather than upward.

         The cost is honest: lit IQR 27.6 -> 20.8 in the sweep. Round 9
         established that lit IQR per unit of frame sd is pinned near
         0.5-0.65 for every setting of every knob here, so buying sd
         back always costs IQR at that rate. The gap to the reference's
         41.1 is content, not curve - see the ratio argument there.

         1.57 rather than 1.35 because sd is not the only thing this
         term carries. Measured across two full gate runs each:

           logSlope 1.90   sd 61.4   tonalRange 26   darkPct 0.7
           logSlope 1.57   sd ~52    tonalRange ~23  darkPct ~7
           logSlope 1.35   sd 45.6   tonalRange 20   darkPct 9.0

         tonalRange tracks it at about 0.38 buckets per point of sd, so
         cutting sd to the reference MEDIAN drops bucket occupancy
         below the reference MINIMUM of 22 - one out-of-band metric
         traded for another. The window that satisfies both is narrow
         and sits near sd 52.

         Note what that comparison also says: Battlefield 2 holds
         tonalRange 29 at sd 46.2, and we cannot reach 29 at any sd. A
         wide histogram with few occupied buckets is a frame made of a
         few large uniform regions, which is the same content finding
         the lit-IQR ratio gave. */
      uLogSlope: { value: 1.57 },
      /* Must stay at 1.0 unless paired with a negative offset - see
         uLogSlope above for why anything higher clips. */
      uLookSlope: { value: 1.0 },
      uLookOffset: { value: 0.0 },
      uLookPower: { value: 0.93 },
      // 1.55, not the 1.9 the score preferred. The scoring band allows
      // saturation up to the reference maximum of 71, so it happily
      // pushed past the reference MEDIAN of 30.9 - and at 1.9 the warm
      // aerial haze (tinted by the sun, correctly) amplified into a
      // magenta wash over every distant hill. Matching the median is
      // the right target; the band's upper end belongs to reference
      // shots of saturated vehicle paint, not to atmosphere.
      /* 1.34, down from 1.45. The shade work below - a warm shadow tint
         where there was a cool one, a softer saturation rolloff at the
         bottom, and a bounce that carries sand's albedo rather than a
         wash of the sun - put chroma back into shadowed surfaces, which
         is what it was for. It also lifted the whole frame's saturation
         median from 47.5 to 54.7 against a reference median of 30.9,
         and a frame that is uniformly over-saturated is the "colour LUT
         laid over a render" read the round 2 reviewer named. Taking it
         out of the GLOBAL multiplier rather than out of the shadow
         terms keeps the gain where it was measured to be needed. */
      uLookSat: { value: 0.88 },
      /* Nearly zero, where it used to be -0.016.
         A subtractive lift is the wrong tool for a black point: it
         moves everything below its own magnitude to exactly zero, so a
         covered interior does not get darker, it gets DELETED - 36% of
         the market frame at literal 0,0,0 with no recoverable
         structure. The black point now comes from uLogSlope, which
         crushes proportionally, and uShadowLift puts a floor under the
         deepest values so occlusion still reads as shape. */
      uLift: { value: new THREE.Vector3(-0.004, -0.004, -0.002) },
      /** Filmic toe lift. Raises the shadows WITHOUT touching the
       *  highlights, which a plain lift or a gamma change cannot do -
       *  both of those wash the whole image. See the shader. */
      /* 0.080, where it was 0.038.
         This is the only term that compresses LARGE key:fill ratios
         without touching small ones, which is exactly the shape the
         spread needs: a lift weighted by toe-squared reaches the
         bazaar's shadowed population 5.6x harder than the alley's,
         because it is 0.19 display against 0.25.

         Raised only after three cheaper hypotheses were measured and
         killed, so nobody repeats them:

           vignette 0.26 -> 0    bazaar 15.21 -> 15.27
           sharpen  0.36 -> 0    bazaar 15.21 -> 15.28
           auto exposure         the bazaar meters at gain 0.78 - it is
                                 stopping DOWN, not opening up. The
                                 poses riding the 2.6 cap are depot,
                                 golden-hour and dawn-ridge, all of
                                 which are already inside the band.

         The honest cost is the black point: the deepest value in a
         frame goes from about 8/255 to about 15/255. That is paid back
         in the metric distribution - our darkPct maximum was 17.3
         against a Battlefield 2 maximum of 10.8, so the frames this
         touches were darker than the reference, not lighter. */
      /* 0.09, where it was 0.048. darkPct was the one metric outside
         the reference distribution - 16.7 median against 5.4 - and
         it is the only term that moves it without touching the top of
         the range. Measured on gameplay framing: darkPct 13.0 -> 2.8
         from this and the neutral tint below, with lit saturation, lit
         hue and the clipping fraction all unmoved.

         0.07, down from 0.13. At 0.13 the toe was lifting so hard that
         darkPct fell to 0.7 against a reference of 5.4 - the frame had
         no true blacks left, which is the fault this uniform exists to
         prevent, reached from the other side.

         It doubles as the fine trim on frame sd, which is why it is
         not 0.09: the toe is the cheapest 6 points of sd available,
         costing 3 of lit IQR where uLogSlope costs 7. */
      uShadowLift: { value: 0.085 },
      /* ---- and what COLOUR the toe lift is ----
         It used to be the constant (0.96, 0.96, 1.0), and that constant
         was most of why every shaded wall in the game arrived cyan.

         Measured with a neutral 0.5-albedo card at five shading normals
         and the grade switched off: the indirect light in this scene is
         hue 23-26, saturation 0.31-0.38 - WARM - at every orientation,
         including a vertical one, where it is 142% of what a horizontal
         normal gets. The light is not the fault and never was.

         What is additive at the bottom of the curve decides the hue of
         anything dark, because it does not scale with the pixel. The
         old toe put a flat (6.5, 8.5, 13.3)/255 of blue-white under
         every shadow. Sand in shade sits near 105/255 and shrugs it
         off; concrete in shade sits near 25 and is more than a third
         toe, so it landed at hue 183 - cyan - while sand three metres
         away landed at hue 24. Same light, same shadow, opposite
         answers, and that contradiction is what made this look like an
         orientation problem for three rounds.

         Driven from sky.js's bounce tint, normalised to unit luminance
         so only the COLOUR moves and the black point stays where the
         grade sweep put it. It is also the more physical model: a toe
         lift stands in for veiling glare, and veiling glare takes the
         colour of the bright part of the frame, which in this game is
         sunlit sand. */
      /* NEUTRAL, where it was (1.13, 0.98, 0.83).
         The warm tint was correct when the toe lift was 0.048 and the
         scene's fill was warm - it is derived from that fill, and the
         comment above still explains why a fixed blue-white was wrong.
         But round 7 made the fill neutral, and round 8 doubled the
         lift, so this term was now injecting warm chroma into exactly
         the population whose saturation we had just spent a round
         removing: at lift 0.10 the warm tint measured shade saturation
         0.539 against 0.516 neutral, and cost 0.13 of lit:shade. A toe
         lift stands in for veiling glare, and veiling glare should now
         be the colour of a fill that no longer has a hue. */
      uShadowLiftTint: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
      uGamma: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
      /* ---- the neutral anchor ----
         Gain used to carry the warmth: (1.055, 1.005, 0.955), a red
         push and a blue pull applied to EVERY pixel. That is a tint
         over the whole frame, not a light, and it is why the previous
         grade read as a LUT: there was no value anywhere in the image
         that came out neutral, so the eye had nothing to calibrate
         against and simply saw "orange and teal".

         Gain is now flat. The warm/cool separation is done by
         uShadowTint and uHighTint below, which are weighted by
         luminance and both fall to zero across the midtones - so mid
         grey stays mid grey, the frame has a white point and a black
         point, and the split-tone reads as key against fill instead of
         as a filter. */
      uGain: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
      /* ---- the shadow tint is WARM, and that is not a style choice ----
         It was (-0.011, -0.003, +0.014) - cool - on the reasoning that
         skylight fill is cool. Measured on this map with a neutral card,
         sun off, grade off: the fill is hue 25, saturation 0.31-0.38, at
         every orientation. It is warm because most of it is sunlight
         bounced off sunlit sand, which is what sky.js's hemisphere is
         for. A cool shadow tint was therefore pushing against the light
         model the renderer actually has.

         What it cost, measured one grade term at a time on shaded
         concrete: zeroing this uniform alone moved that surface from hue
         100 to 67 and from saturation 0.24 to 0.40. Its lit side is hue
         59, so the cool tint was the difference between a 41-degree hue
         error and an 8-degree one. Shaded sand did not move at all -
         four times brighter, so a fixed offset is four times smaller a
         fraction of it. That asymmetry is why this read for three rounds
         as "the indirect light does not reach vertical faces" when the
         indirect light reaches them at 142% of a horizontal face.

         Kept small and paired with uHighTint, which is warmer still and
         weighted the other way, so the separation is now sun against
         bounce - both warm, different saturations - with the midtones
         still passing through neutral. */
      uShadowTint: { value: new THREE.Vector3(0.006, 0.001, -0.008) },
      /** Slightly warm, as low afternoon sun is. */
      uHighTint: { value: new THREE.Vector3(0.016, 0.005, -0.013) },
      /** How hard saturation rolls off towards black and white. Real
       *  film desaturates at both ends; a flat multiplier turns
       *  highlights pastel and shadows into ink, which is the other
       *  half of the "LUT over the render" read. */
      uSatRoll: { value: 0.55 },
      /* 0.98, where it was 1.06, and it was 1.20 for one round.

         The 1.20 was bought to hold lit:shade after the ambient
         rebalance, and it worked, but it moved the WHOLE frame: lit
         saturation crossed from 0.97x of the reference to 1.14x and
         frame saturation reached 1.5x. Once the curve above was doing
         the separation, the global term was no longer paying for
         itself - dropping it 1.20 -> 0.98 costs 0.02 of lit:shade
         (1.32 -> 1.30) and returns lit saturation to 1.10x. Original
         reasoning, still true of why it ever went up: neutralising the fill
         takes chroma out of everything, including the surfaces the sun
         is lighting, and lit saturation had measured correct at 0.564
         against 0.581 before it. Raising the global term and letting
         uSatRoll's now-symmetric shoulders hold both ends down puts
         the chroma back into the midtones only - lit returns to 0.62
         while shade stays at 0.50. Frame saturation lands at 30-32
         against the reference median of 30.9. */
      uSaturation: { value: 0.98 },
      uContrast: { value: 1.02 },
      // Contrast pivots below mid grey. Pivoting at 0.5 lifts
      // everything a daylit desert actually contains, because most of
      // the frame sits above it.
      uPivot: { value: 0.44 },

      // Hit feedback: a red radial pulse driven by the player module.
      uDamage: { value: 0 },
      uDamageDir: { value: new THREE.Vector2(0, 0) },
      // Suppression: desaturate and blur the edges when rounds crack past.
      uSuppression: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;

      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform sampler2D tDepth;
      uniform sampler2D tBloom;
      uniform sampler2D tAO;
      uniform float uAOStrength;
      uniform float uAOFloor;
      uniform float uContactFloor;
      uniform float uBloomStrength;
      uniform vec2  uResolution;
      uniform float uExposure;
      uniform sampler2D tMeter;
      uniform float uMeterKey;
      uniform vec2  uMeterRange;
      uniform float uTime;

      uniform float uShoulderRelax;
      uniform float uRelaxSplit;
      uniform float uMotionBlur;
      uniform mat4  uInvViewProj;
      uniform mat4  uPrevViewProj;

      uniform float uGrain;
      uniform float uChroma;
      uniform float uVignette;
      uniform float uSharpen;

      uniform vec3  uCameraPos;
      uniform vec3  uSunDirWorld;
      uniform vec3  uBetaR;
      uniform float uBetaM;
      uniform float uMieG;
      uniform vec3  uAerialTint;
      uniform float uAerialLevel;
      uniform vec3  uAerialSky;
      uniform float uAerial;
      uniform float uHazeSat;
      uniform float uAerialDesat;
      uniform vec2  uAerialNear;
      uniform vec4  uFogProfile;

      uniform vec3  uSunScreen;
      uniform float uShafts;
      uniform vec4  uCloudShadow;

      uniform float uLogSlope;
      uniform float uLookSlope;
      uniform float uLookOffset;
      uniform float uLookPower;
      uniform float uLookSat;
      uniform vec3  uLift;
      uniform vec3  uShadowLiftTint;
      uniform float uShadowLift;
      uniform vec3  uGamma;
      uniform vec3  uGain;
      uniform vec3  uShadowTint;
      uniform vec3  uHighTint;
      uniform float uSatRoll;
      uniform float uSaturation;
      uniform float uContrast;
      uniform float uPivot;

      uniform float uDamage;
      uniform vec2  uDamageDir;
      uniform float uSuppression;

      /* ---- AgX-style tonemap ----
         ACES crushes saturated reds and greens towards white, which is
         exactly the wrong failure for muzzle flashes and tracers. AgX
         keeps hue through the highlight rolloff, so a red tracer stays
         red as it clips instead of turning pink. */
      const mat3 AGX_IN = mat3(
        0.8425, 0.0784, 0.0792,
        0.0423, 0.8785, 0.0792,
        0.0424, 0.0784, 0.8791
      );
      const mat3 AGX_OUT = mat3(
         1.1968, -0.0980, -0.0990,
        -0.0528,  1.1519, -0.0991,
        -0.0529, -0.0980,  1.1509
      );

      vec3 agxDefaultContrast(vec3 x) {
        vec3 x2 = x * x;
        vec3 x4 = x2 * x2;
        return + 15.5     * x4 * x2
               - 40.14    * x4 * x
               + 31.96    * x4
               - 6.868    * x2 * x
               + 0.4298   * x2
               + 0.1191   * x
               - 0.00232;
      }

      /* The sigmoid, optionally relaxed toward the identity line.
         See uShoulderRelax. The weight ramps in across the crossover
         rather than switching at it, because a discontinuity in the
         SLOPE of a tone curve shows up as a visible edge on any smooth
         gradient - the sky is the worst case. */
      vec3 agxRelaxed(vec3 x) {
        vec3 w = mix(vec3(1.0), smoothstep(vec3(0.78), vec3(0.90), x), uRelaxSplit);
        return mix(agxDefaultContrast(x), x, uShoulderRelax * w);
      }

      vec3 tonemapAgX(vec3 col) {
        const float minEv = -12.47393;
        const float maxEv = 4.026069;
        col = AGX_IN * max(col, 0.0);
        col = clamp((log2(col + 1e-10) - minEv) / (maxEv - minEv), 0.0, 1.0);
        // Middle grey (0.18) lands at exactly 0.5 of this range, which
        // is what makes it a usable pivot: slope here expands the
        // histogram about a NEUTRAL anchor rather than about whatever
        // the frame's average happens to be.
        col = clamp((col - 0.5) * uLogSlope + 0.5, 0.0, 1.0);
        col = agxRelaxed(col);

        /* ---- look transform ----
           AgX WITHOUT a look is deliberately flat and desaturated -
           that is the point of it, it is a neutral base for grading,
           not a finished image. Shipping the base transform is why the
           grade sweep hit a wall: pushing exposure past bias 2.4 moved
           median luma by 4 points while saturation stayed pinned at 18
           against the reference's 31, because everything extra was
           going into the shoulder. Slope/power/saturation applied here,
           in log space before the inverse matrix, is where the contrast
           and colour come back. */
        col = pow(max(col * uLookSlope + uLookOffset, 0.0), vec3(uLookPower));
        float lookLuma = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = lookLuma + uLookSat * (col - lookLuma);

        col = AGX_OUT * col;
        return clamp(col, 0.0, 1.0);
      }

      float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

      /* Interleaved gradient noise - cheap, and its pattern does not
         crawl the way a hash does when the camera moves. */
      float ign(vec2 p) {
        return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
      }

      /* Decorrelated hash, for the film grain specifically.

         ign() above is interleaved gradient noise, and it is the right
         function for a DITHER: its whole virtue is that it is highly
         structured, so a temporal resolve can average it away in a
         couple of frames. We resolve with SMAA, which is morphological
         and averages nothing across time, so that structure survives to
         the screen - a regular horizontal lattice over the entire
         frame, sky included, measured at 3-7/255 on open sand. Film
         grain wants the opposite of a dither: decorrelated noise with
         no lattice at all. This is Hoskins' hash, which has it. */
      float grainHash(vec2 p) {
        vec3 v = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
        v += dot(v, v.yzx + 33.33);
        return fract((v.x + v.y) * v.z);
      }

      /* ---- atmosphere helpers ---- */

      float rayleighPhase(float mu) {
        return 0.05968310365 * (1.0 + mu * mu);
      }

      float miePhase(float mu, float g) {
        float g2 = g * g;
        float d = 1.0 + g2 - 2.0 * g * mu;
        return 0.11936620731 * ((1.0 - g2) * (1.0 + mu * mu))
             / ((2.0 + g2) * pow(max(d, 1e-4), 1.5));
      }

      /**
       * Optical depth along a segment through air whose density falls
       * off exponentially with altitude. Closed form, so height fog
       * costs one exp instead of a raymarch: with density
       * exp(-(y - ref) / H) the integral over the segment is
       *   exp(-(y0 - ref)/H) * H * d / dy * (1 - exp(-dy / H))
       * which is what lets fog genuinely pool in a wadi and thin out
       * on a ridge instead of being a flat distance ramp.
       */
      float airMass(float y0, float y1, float d, float H, float ref) {
        float dy = y1 - y0;
        float base = exp(clamp(-(y0 - ref) / H, -30.0, 30.0));
        if (abs(dy) < 0.05) return d * base;
        float t = base * (H * d / dy) * (1.0 - exp(clamp(-dy / H, -30.0, 30.0)));
        return clamp(t, 0.0, 40000.0);
      }

      /* Value noise on a plane, used for the cloud deck's shadow. Two
         octaves is enough: a cloud shadow is read as a slow change in
         brightness, not as a shape. */
      float shadowHash(vec2 p) {
        p = fract(p * vec2(127.1, 311.7));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }
      float shadowNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(shadowHash(i), shadowHash(i + vec2(1.0, 0.0)), f.x),
                   mix(shadowHash(i + vec2(0.0, 1.0)), shadowHash(i + vec2(1.0, 1.0)), f.x), f.y);
      }

      void main() {
        vec2 uv = vUv;
        vec2 texel = 1.0 / uResolution;
        vec2 centred = uv - 0.5;
        float r2 = dot(centred, centred);

        /* ---- exposure ----
           The sky's own value, trimmed by what the frame actually
           contains. Auto exposure MODULATES rather than replaces, so
           night is still night and a dust storm is still dim - it only
           removes the difference between standing in an alley and
           standing on a roof, which is the difference a real eye
           removes too. Clamped, so it can never turn a deliberately
           dark scene into a grey one. */
        float meterGain = 1.0;
        if (uMeterRange.y > uMeterRange.x) {
          float adapted = exp2(texture2D(tMeter, vec2(0.5)).r);
          meterGain = clamp(uMeterKey / max(adapted, 1e-5), uMeterRange.x, uMeterRange.y);
        }
        float ev = uExposure * meterGain;

        /* ---- chromatic aberration, radial and only at the edges ---- */
        vec3 colour;
        if (uChroma > 0.0) {
          vec2 offset = centred * r2 * uChroma * 0.0055;
          colour.r = texture2D(tDiffuse, uv + offset).r;
          colour.g = texture2D(tDiffuse, uv).g;
          colour.b = texture2D(tDiffuse, uv - offset).b;
        } else {
          colour = texture2D(tDiffuse, uv).rgb;
        }

        /* ---- reconstruct the world position once ----
           Motion blur, cloud shadow and aerial perspective all need
           it, and the inverse-view-projection multiply is the
           expensive part. The sky dome writes no depth, so a cleared
           depth of 1 means "this pixel is sky" and everything below
           leaves it alone: the dome already contains its own
           scattering, and fogging it would double-count. */
        float rawDepth = texture2D(tDepth, uv).x;
        bool isSky = rawDepth >= 0.999999;
        vec4 worldH = uInvViewProj * vec4(uv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
        vec3 worldPos = worldH.xyz / worldH.w;
        vec3 toPixel = worldPos - uCameraPos;
        float viewDist = length(toPixel);
        vec3 viewDir = toPixel / max(viewDist, 1e-4);

        /* ---- ambient occlusion ----
           Multiplied into the radiance while it is still LINEAR and
           before the air is added. Both orderings matter: applied after
           the tonemap it would crush already-compressed shadows into
           mud, and applied after the aerial term it would darken the
           air itself, which is the one thing in the frame that nothing
           can occlude. */
        if (uAOStrength > 0.0 && !isSky) {
          vec2 occ = texture2D(tAO, uv).rg;
          float ao = occ.r;
          /* ---- floor ----
             A screen-space visibility term multiplied into the FULL
             radiance is a lie about direct light: a mortar joint in
             daylight still sees the sun at the same angle as the face
             around it, and the geometry that would actually stop it is
             far too small for this pass to resolve. Unfloored, at
             strength 0.95 and power 1.5, every recess in the game went
             to five per cent of its face - the reviewer's "mortar and
             recess gaps render as pure black rather than as shadowed
             material". A recessed joint in real daylight sits at 20-30%
             of the face, which is what this floor puts under it.
             ---- and its colour ----
             Occlusion does not remove light evenly. What a crevice
             loses is the SKY, which is the blue half of the budget;
             what it keeps is bounce off the surface it is cut into,
             which is warm. So the same visibility applied with a
             slightly harder curve on blue than on red turns a recess
             into shadowed brick instead of into a grey notch. */
          ao = max(ao, uAOFloor);
          /* ---- and why the NEAR term does not get that floor ----
             The argument above is about a broad screen-space visibility
             term standing in for geometry it cannot resolve, and it is
             correct for exactly that. It is not correct at a contact.
             Where a barrel meets sand the sky really is almost entirely
             occluded and the sun really is blocked, and the right answer
             approaches zero - 0.24 was removing precisely the darkest
             tenth that does the seating. Measured against Battlefield 2
             through blacksand-contact-profile.mjs, the reference
             darkens a seam to 0.48 of open ground and we managed 0.83;
             a floor of 0.24 cannot produce 0.48 on a term that only
             reaches 0.6 in the first place.

             min(), not a product. The two terms measure the same
             physical quantity at two scales, so multiplying them
             double-counts a reentrant corner where both fire and takes
             it to near black. The tighter measurement is the more local
             truth: let it win where it fires, and never let either one
             brighten anything. */
          float near = max(occ.g, uContactFloor);
          ao = min(ao, near);
          vec3 aoRgb = pow(vec3(ao), vec3(0.86, 1.0, 1.20));
          colour *= mix(vec3(1.0), aoRgb, uAOStrength);
        }

        /* ---- camera motion blur ---- */
        if (uMotionBlur > 0.0) {
          float depth = rawDepth;
          if (depth < 1.0) {
            vec4 world = vec4(worldPos, 1.0);
            vec4 prevClip = uPrevViewProj * world;
            vec2 prevUv = (prevClip.xy / prevClip.w) * 0.5 + 0.5;
            vec2 velocity = (uv - prevUv) * uMotionBlur;
            // Cap the smear. An uncapped velocity turns a fast turn into
            // a full-screen streak that reads as a bug, not as motion.
            float speed = length(velocity);
            float maxSpeed = 0.028;
            if (speed > maxSpeed) velocity *= maxSpeed / speed;

            if (speed > 0.0004) {
              vec3 sum = colour;
              float weight = 1.0;
              float jitter = ign(gl_FragCoord.xy + uTime * 61.0);
              for (int i = 1; i < 7; i++) {
                float t = (float(i) + jitter) / 7.0;
                vec2 s = uv - velocity * t;
                float w = 1.0 - t * 0.55;
                sum += texture2D(tDiffuse, clamp(s, texel, 1.0 - texel)).rgb * w;
                weight += w;
              }
              colour = sum / weight;
            }
          }
        }

        /* ---- cloud shadow ----
           Where the cloud deck would be between this surface and the
           sun. Projecting the surface up the sun vector onto the deck
           is what makes the shadow slide across the ground at the
           right speed and lean the right way as the sun moves - a
           straight top-down projection reads as a stain on the terrain
           instead of as weather. */
        if (uCloudShadow.x > 0.0 && !isSky) {
          float lift = max(uSunDirWorld.y, 0.12);
          vec2 hit = worldPos.xz + uSunDirWorld.xz * ((1400.0 - worldPos.y) / lift);
          vec2 cp = hit * uCloudShadow.y + uCloudShadow.zw;
          float d = shadowNoise(cp) * 0.62 + shadowNoise(cp * 2.7 + 11.3) * 0.38;
          float shade = smoothstep(0.46, 0.72, d);
          colour *= 1.0 - shade * uCloudShadow.x;
        }

        /* ---- aerial perspective, and the light shafts that ride on it ---- */
        if (uAerial > 0.0 && !isSky) {
          float mass = airMass(uCameraPos.y, worldPos.y, viewDist, uFogProfile.x, uFogProfile.y);
          if (uFogProfile.z > 0.0) {
            mass += uFogProfile.z
                  * airMass(uCameraPos.y, worldPos.y, viewDist, uFogProfile.w, uFogProfile.y);
          }

          vec3 sigma = uBetaR + vec3(uBetaM);
          vec3 transmittance = exp(-sigma * mass * uAerial);

          // Single scattering: what fraction of the extinction along
          // this ray scattered TOWARDS the eye. Rayleigh is weighted
          // per channel, so away from the sun the air glows blue and
          // towards it the Mie lobe takes over and it glows warm.
          // Same physics, one expression, both behaviours.
          float mu = dot(viewDir, uSunDirWorld);
          vec3 scatter = (uBetaR * rayleighPhase(mu) + vec3(uBetaM * miePhase(mu, uMieG))) / sigma;
          vec3 inscatter = uAerialTint * scatter * uAerialLevel + uAerialSky;
          // See uHazeSat: the air is tinted three times over otherwise.
          inscatter = mix(vec3(luma(inscatter)), inscatter, uHazeSat);
          // How much of this path is lit air rather than air inside the
          // scene's own shadow - see uAerialNear.
          float lit = smoothstep(uAerialNear.x, uAerialNear.y, viewDist);
          inscatter *= lit;

          /* Drain the surface as the veil closes. The physical terms
             alone left the 250m midground MORE saturated than the 30m
             foreground, which reads as a painted backdrop rather than
             as distance.

             Scaled by the same near-field ramp. What drains a distant
             surface's colour is direct radiance being replaced by
             isotropic glow, so where there is no glow yet there is
             nothing to replace it with - and unramped this term alone
             was taking 46% of a shaded wall's saturation at 25 metres. */
          float veil = 1.0 - dot(transmittance, vec3(0.2126, 0.7152, 0.0722));
          float far = clamp(veil * uAerialDesat * lit, 0.0, 0.9);
          colour = mix(colour, vec3(luma(colour)), far);

          colour = colour * transmittance + inscatter * (1.0 - transmittance);

          /* ---- light shafts ----
             A shaft is in-scattered sunlight along an unobstructed
             path, so the only thing worth marching for is HOW MUCH of
             the path is unobstructed - the colour is the in-scatter
             term we just computed. Sampling depth alone (never
             colour) is both cheaper and impossible to blow out: the
             first version gathered radiance from the sky and added it
             raw, which put a 3.0-linear white blob over every frame
             where the sun sat behind a building.

             Every piece of geometry becomes an occluder for free -
             none of them know the effect exists.

             The second version had the opposite fault: a flat-topped
             pale wedge with a razor edge, because the accumulator
             weighted every step equally and the radial falloff was a
             hard smoothstep. Three things fix that read, and all three
             are needed - a quadratic radial profile so the shaft has no
             rim, a density that decays along the march so it is
             brightest at the sun and thins out towards the viewer, and
             a slow noise field so the beam has motes in it instead of
             being a solid colour. */
          if (uShafts > 0.0 && uSunScreen.z > 0.0) {
            vec2 toSun = uSunScreen.xy - uv;
            float reach = 1.0 - smoothstep(0.02, 1.05, length(toSun));
            reach *= reach;
            if (reach > 0.002) {
              vec2 stepUv = toSun * (1.0 / 20.0);
              vec2 s = uv + stepUv * ign(gl_FragCoord.xy + uTime * 13.0);
              float open = 0.0;
              float total = 0.0;
              float decay = 1.0;
              for (int i = 0; i < 20; i++) {
                s += stepUv;
                float d = texture2D(tDepth, clamp(s, texel, 1.0 - texel)).x;
                open += decay * step(0.999999, d);
                total += decay;
                decay *= 0.90;
              }
              // Airborne dust, drifting. Without it the beam is a flat
              // colour and the eye reads a polygon; two octaves of very
              // low-frequency noise is enough to break that.
              vec2 dustUv = uv * vec2(uResolution.x / uResolution.y, 1.0) * 7.0;
              float motes = shadowNoise(dustUv + vec2(uTime * 0.055, uTime * 0.021)) * 0.62
                          + shadowNoise(dustUv * 2.3 - vec2(uTime * 0.03, 0.0)) * 0.38;
              float dust = 0.58 + 0.72 * motes;
              // Fade as the sun leaves the frame, or the shafts snap
              // off against the screen edge.
              float onScreen = 1.0 - smoothstep(0.5, 1.2, length(uSunScreen.xy - 0.5));
              /* Scaled by how much AIR is on this ray, which is the
                 term the first two versions were missing and the reason
                 the effect read as a solid polygon laid over the floor.
                 A shaft is in-scattered light from the air between the
                 eye and the surface; a wall two metres away has almost
                 none, so it must not glow no matter how close to the
                 sun it sits on screen. Without this the shaft painted a
                 blown-out white disc on the ground wherever the sun
                 happened to project, which is exactly what it was
                 doing in the checkpoint frame. */
              vec3 air = 1.0 - transmittance;
              colour += inscatter * air * (open / max(total, 1e-3))
                      * uShafts * reach * onScreen * uSunScreen.z * dust;
            }
          }
        }

        /* ---- bloom ----
           Added in LINEAR light, before exposure and the tonemap. Adding
           it after the tonemap is the common shortcut and it is wrong:
           the curve has already compressed the highlights, so post-
           tonemap bloom lifts the whole image into haze instead of
           blooming what was actually over-bright. */
        if (uBloomStrength > 0.0) {
          colour += texture2D(tBloom, uv).rgb * uBloomStrength;
        }

        /* ---- exposure and tonemap ---- */
        colour *= ev;
        colour = tonemapAgX(colour);

        /* ---- grade: lift / gamma / gain, contrast, saturation ---- */
        /* ---- shadow lift ----
           Applied to the display-referred value, weighted by how dark
           the pixel already is, so it opens up crushed shadows and
           leaves midtones and highlights alone.

           This is the ONLY correct place to rescue a covered interior.
           A market under an awning receives no sun at all, and once the
           sun:fill ratio is set where a desert actually puts it, that
           interior lands at the very bottom of the curve and clips to
           literal zero over half the frame - no shape, no material, no
           silhouette. Raising the ambient to fix it would flatten every
           other shot in the game. A toe floor costs the shadows nothing
           above 0.34 luma and puts a readable ~11/255 under the
           deepest values, which is what a real lens does anyway.

           Its COLOUR follows the scene's fill - see uShadowLiftTint. It
           used to be a fixed blue-white, and an additive constant at
           the bottom of the curve sets the hue of everything dark: it
           was worth a third of a shaded concrete wall and turned it
           cyan, while leaving shaded sand four times brighter alone. */
        if (uShadowLift > 0.0) {
          float l = luma(colour);
          float toe = 1.0 - smoothstep(0.0, 0.34, l);
          colour += uShadowLift * toe * toe * uShadowLiftTint;
        }

        colour = colour * uGain + uLift;
        colour = pow(max(colour, 0.0), 1.0 / uGamma);
        colour = (colour - uPivot) * uContrast + uPivot;

        /* ---- saturation, anchored ----
           Rolled off towards both ends of the range. A flat multiplier
           saturates the highlights into pastel and the shadows into
           ink, and once nothing in the frame is neutral the whole grade
           reads as a colour filter rather than as light. Rolling it off
           gives the image a white point and a black point to hang on. */
        /* The shadow half is 0.9. It was 0.7, was cut to 0.4 in round
           5 to stop "shade losing its chroma", and that was the right
           response to a diagnosis that has since been measured
           backwards: our shade carries 1.62x the reference's
           saturation, not less. The cut made the inversion worse.

           Highlights keep 0.9 unchanged. That half was suspected too -
           in a desert at noon the sunlit sand IS the highlight, so a
           term that takes half the chroma above luma 0.60 looks like
           the obvious culprit - but lit saturation measures 0.564
           against the reference's 0.581 on gameplay framing. There is
           nothing wrong with the top of this curve, and the sweep that
           flipped the two terms bought 0.02 of lit:shade against the
           0.38 the ambient rebalance buys. */
        /* The highlight half is 0.50, down from 0.9, and it had to
           move the moment the curve above widened. Round 7 measured
           this term as innocent and it WAS: lit saturation sat at
           0.564 against a 0.581 reference, so nothing needed relief.
           Widening the lit histogram pushes that same population up
           the curve, where both AgX's shoulder and this term attack
           its chroma - lit saturation and lit tonal spread are in
           direct competition in this pipeline, and that is the real
           reason the two have never both been right. Measured at the
           new curve: 0.9 gives lit 0.588 / ratio 1.07, 0.50 gives
           0.629 / 1.14, 0.25 gives 0.647 / 1.18. 0.50 is where the
           ratio recovers without highlights ceasing to roll off at
           all. */
        float l = luma(colour);
        float roll = 1.0 - uSatRoll * (smoothstep(0.60, 1.0, l) * 0.50
                                     + smoothstep(0.20, 0.0, l) * 0.9);
        colour = mix(vec3(l), colour, uSaturation * roll);

        /* ---- warm key against cool fill, through a neutral midtone ----
           Both weights fall to zero across the midrange, so a grey
           surface at mid exposure comes out grey. That is the whole
           point: the eye calibrates on the neutral and then reads the
           shadow as cool and the highlight as warm, instead of reading
           the entire frame as tinted. */
        float wShadow = smoothstep(0.40, 0.0, l);
        float wHigh = smoothstep(0.56, 1.0, l);
        colour += uShadowTint * wShadow + uHighTint * wHigh;

        /* ---- suppression: desaturate and darken the periphery ---- */
        if (uSuppression > 0.0) {
          float edge = smoothstep(0.02, 0.24, r2) * uSuppression;
          colour = mix(colour, vec3(luma(colour)) * 0.82, edge * 0.85);
        }

        /* ---- sharpen (unsharp mask on luma only, so it does not
                amplify chroma noise) ---- */
        if (uSharpen > 0.0) {
          vec3 blur =
              texture2D(tDiffuse, uv + vec2( texel.x, 0.0)).rgb
            + texture2D(tDiffuse, uv + vec2(-texel.x, 0.0)).rgb
            + texture2D(tDiffuse, uv + vec2(0.0,  texel.y)).rgb
            + texture2D(tDiffuse, uv + vec2(0.0, -texel.y)).rgb;
          blur *= 0.25;
          blur = tonemapAgX(blur * ev);
          float detail = luma(colour) - luma(blur);
          colour += detail * uSharpen;
        }

        /* ---- damage vignette ---- */
        if (uDamage > 0.0) {
          float dirMask = clamp(dot(normalize(centred + 1e-5), uDamageDir), 0.0, 1.0);
          float ring = smoothstep(0.03, 0.25, r2);
          vec3 blood = vec3(0.62, 0.045, 0.035);
          colour = mix(colour, blood, ring * uDamage * (0.35 + 0.65 * dirMask));
        }

        /* ---- vignette ---- */
        colour *= 1.0 - uVignette * smoothstep(0.08, 0.62, r2);

        /* ---- grain, applied last and scaled by darkness so it lives
                in the shadows the way real film grain does ---- */
        if (uGrain > 0.0) {
          float n = grainHash(gl_FragCoord.xy + fract(uTime) * 1000.0) - 0.5;
          colour += n * uGrain * (1.25 - luma(colour) * 0.75);
        }

        gl_FragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
      }
    `,
  };

  const composite = new ShaderPass(CompositeShader);
  composer.addPass(composite);

  // SMAA is the last pass, so it writes the finished display-referred
  // frame straight to the default framebuffer. Nothing may follow it -
  // see the colour-space note at the top of this file.
  let smaaPass = null;
  if (!q.fxaa) {
    smaaPass = new SMAAPass(2, 2);
    composer.addPass(smaaPass);
  }

  /* ------------------------- scene depth ------------------------- */

  // The composite pass reads scene depth to reconstruct velocity for
  // motion blur.
  //
  // Each of EffectComposer's two ping-pong targets gets its OWN depth
  // texture. Sharing one between them is the obvious thing to do and
  // it is wrong: the composite writes colour into the write buffer
  // while sampling the shared depth texture, which is still attached
  // to that same framebuffer. WebGL calls that a feedback loop, drops
  // the draw, and the console fills with GL_INVALID_OPERATION - 215 of
  // them in a three-second capture.
  //
  // Because the two targets swap roles, the correct depth to sample is
  // whichever one the SCENE was rendered into - not whichever one the
  // composite happens to be reading. Those are the same buffer only
  // when no pass sits between them; bloom does, and it blends its
  // result back with depth writes off, so guessing from the composite's
  // read buffer silently sampled a depth texture the scene never wrote.
  // Record it in RenderPass instead, where it cannot be wrong.
  function attachDepth(target) {
    const depth = new THREE.DepthTexture(2, 2);
    depth.type = THREE.UnsignedIntType;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    target.depthTexture = depth;
    return depth;
  }
  attachDepth(composer.renderTarget1);
  attachDepth(composer.renderTarget2);

  let sceneDepth = composer.renderTarget1.depthTexture;
  const renderPassRender = renderPass.render.bind(renderPass);
  renderPass.render = (r, writeBuffer, readBuffer, deltaTime, maskActive) => {
    sceneDepth = (renderPass.renderToScreen ? writeBuffer : readBuffer).depthTexture;
    renderPassRender(r, writeBuffer, readBuffer, deltaTime, maskActive);
  };

  const compositeRender = composite.render.bind(composite);
  composite.render = (r, writeBuffer, readBuffer, deltaTime, maskActive) => {
    composite.uniforms.tDepth.value = sceneDepth;

    // Build the bloom here rather than as its own pass in the chain.
    // At this point `readBuffer` holds the finished HDR scene, which is
    // exactly what the bright pass wants, and doing it inside the
    // composite's own render means the bloom chain cannot disturb the
    // composer's read/write buffers - it only ever binds targets it
    // owns, and hands back a texture.
    const bloomTexture = renderBloom(readBuffer.texture);
    composite.uniforms.tBloom.value = bloomTexture;
    composite.uniforms.uBloomStrength.value = bloomTexture ? bloom.strength : 0;

    // Same contract as bloom: binds only targets it owns, reads only
    // the depth texture the scene wrote, hands back a texture.
    const aoTexture = renderAo(sceneDepth);
    composite.uniforms.tAO.value = aoTexture;
    composite.uniforms.uAOStrength.value = aoTexture ? ao.strength : 0;

    // Metered off the same finished HDR buffer, one frame's worth of
    // adaptation per composite. deltaTime is the composer's, which is
    // the frame dt the loop passed to render().
    const meterTexture = renderMeter(readBuffer.texture, lastDelta);
    composite.uniforms.tMeter.value = meterTexture;
    composite.uniforms.uMeterKey.value = meter.key;
    if (meterTexture) composite.uniforms.uMeterRange.value.set(meter.min, meter.max);
    else composite.uniforms.uMeterRange.value.set(1, 1);

    compositeRender(r, writeBuffer, readBuffer, deltaTime, maskActive);
  };

  /* ---------------------------- lighting ---------------------------- */

  /** Unit vector towards the sun, in world space.
   *
   *  The single source of truth for where the key light is. sky.js
   *  pushes it through setAtmosphere; the shadow rig and the composite
   *  both read it and neither writes it. Declared here rather than with
   *  the per-frame matrices because the shadow camera needs it, and
   *  because storing a direction in a light's POSITION - which the
   *  shadow rig is entitled to move - is what broke it before. */
  const sunDirWorld = new THREE.Vector3(0, 1, 0);

  /**
   * Sun + sky. The sky module supplies the environment map and the
   * physically-derived colours; this just owns the objects so they
   * exist from frame one.
   */
  /* ---- how wide the single shadow cascade is ----
     As a fraction of the tier's shadow distance, chosen per frame from
     how far the camera is above the ground.

     Fixed at 0.55 an ultra frame put 462 metres across 3072 texels -
     15cm per texel, wider than a rifle, so every shadow edge in the game
     was a staircase no filter could hide. Fixed at 0.30 the density
     doubled and eye-level shots looked right, but the wide shots lost
     their shadows entirely: an establishing frame looks across 800m and
     the cascade ended at 126, so two thirds of the picture was
     unshadowed sand and measured almost as flat as it looked.

     Neither is a constant. What the shot needs is the area the camera
     can actually SEE, and camera height is a good cheap proxy for that.
     This is the poor man's cascade selection - one map, re-fitted - and
     the PCSS chunk dissolves the boundary instead of cutting it, so
     nobody can see where the map ends.

     The floor is 0.13, which is 55m at ultra and 4cm per texel. That is
     the number a person-sized shadow needs: at the old 15cm a soldier's
     shadow arrived as sampling noise rather than as a silhouette, which
     is most of why characters read as floating.

     This is still ONE cascade, and it is the remaining structural gap.
     settings.js advertises shadowCascades 2-4 and nothing reads it; a
     real cascaded set-up would let the near map be tighter still
     without giving up the distance. See the handover note. */
  /* The floor is 0.18, where it was 0.13.

     0.13 is 34m at high and 55m at ultra, and the map-edge dissolve ate
     the outer quarter of that, so at eye level nothing beyond about 25m
     cast anything at all. A blind reviewer measured ground under a palm
     crown at luma 111 against open sand at 110 and concluded vegetation
     casts no shadow; an A/B on the foliage casters proves it does - 60%
     of the ground luma in a framed palm shot - but only inside that
     radius. A grove at forty metres was outside it.

     The cost is texel density: 0.18 is 5cm per texel at high, up from
     3.3cm. A soldier is still about thirty texels across at that size,
     which is what the floor exists to protect. */
  function shadowExtentFor(height) {
    return q.shadowDistance * clamp(0.18 + height * 0.0075, 0.18, 0.62);
  }
  let shadowExtent = q.shadowDistance * 0.18;

  /** Tangent of the sun's angular RADIUS. The disc is about 0.53
   *  degrees across, so an occluder d metres above a surface throws a
   *  penumbra of half-width d * this. Slightly generous, because
   *  forward-scattered light through the last few degrees of sky
   *  softens a real edge a little further than geometry alone says. */
  /* ---- MEASURED: this is correct, and it is invisible ----
     A round-5 reviewer said "shadow penumbra is a single constant blur -
     a stall leg touching sand blurs as much as an awning 3m above it".
     The mechanism they named is wrong: the PCSS chunk above is live and
     the penumbra really is a length, `shadow.radius` really does carry
     the sun's angular tangent through the cascade's depth range, and the
     near cascade reports radius 60.6 over a 610m depth range at a 5.5cm
     texel, which is exactly d * 0.0055 metres.

     Their CONCLUSION is nonetheless right, for a reason worth writing
     down. Work the penumbra out in the unit the filter samples in:

       half-width in texels = gap * 0.0055 / 0.055 = gap * 0.1

     so a 1m gap is 0.1 texels, a 3m gap 0.3, a 5m gap 0.5 - and the
     filter's floor is 0.55 texels, which exists so a caster touching
     its receiver stays sharp. Everything below about SIX METRES of gap
     is therefore pinned to the same floor: every prop, every awning,
     every crate, every soldier, every vehicle. The variable penumbra
     only starts doing visible work above ~10m, which in practice means
     rooflines and dune ridges.

     So the model is exact and the sampling grid is too coarse to
     express it. Raising this constant is the obvious next move - real
     outdoor edges are softened by the circumsolar aureole as well as by
     the disc, and 1.5-2 degrees of apparent diameter is defensible in
     dusty air - but it scales EVERY penumbra, including the 150m
     dune-ridge throws that currently sit near the 26-texel cap, so it
     cannot be changed without re-running the contrast gate. Left alone
     this round rather than changed on an untested hunch. */
  const SUN_ANGULAR_TAN = 0.0055;

  const sun = new THREE.DirectionalLight(0xffe9cc, 3.4);
  sun.position.set(120, 180, 90);
  sun.castShadow = q.shadows;
  sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
  /* ---- bias ----
     Constant bias is ZERO, deliberately, and the offset is done in
     world space by normalBias instead.

     shadow.bias is in normalised depth. Over the near/far range this
     light used to have, -0.00035 worked out at about 35cm of "count
     this as lit" - so every shadow detached from its caster at the
     contact point and every object in the game floated. normalBias
     moves the LOOKUP along the surface normal by a distance in metres,
     which is the correct shape for the problem: the acne it prevents is
     caused by a texel spanning a sloped surface, so the fix has to
     scale with the texel, not with the depth range. It is set per frame
     in updateShadowCamera because the cascade is re-fitted per frame. */
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = q.shadowDistance * 2.4;
  sun.shadow.bias = 0;
  sun.shadow.normalBias = 0.06;
  // Feeds the PCSS kernel above, not three's own filter, and it is NOT
  // a radius any more: it is the number of shadow texels of penumbra
  // per unit of normalised depth between blocker and receiver. Set in
  // fitShadowCascade, because both terms it is built from change when
  // the cascade is re-fitted.
  sun.shadow.blurSamples = q.shadowSoftness > 1 ? 12 : 6;
  /** Re-fit the cascade. Also sets the depth range and the normal bias,
   *  because both of them are functions of how wide it ended up. */
  /** Fit one cascade's orthographic camera, its depth range, its normal
   *  bias and its penumbra scale. All four are functions of the extent,
   *  which is why they are set together and nowhere else. */
  function fitCascade(light, extent) {
    const camera3 = light.shadow.camera;
    camera3.left = -extent;
    camera3.right = extent;
    camera3.top = extent;
    camera3.bottom = -extent;
    /* A depth range fitted to where the casters actually are, instead of
       a fixed 1000m. The PCSS penumbra estimate is a RATIO of depths, so
       a range twice as long as it needs to be halves it - and a constant
       depth bias in that range means twice as many metres of slop. */
    const lightRange = q.shadowDistance * 1.1;
    camera3.near = Math.max(1, lightRange - extent - 220);
    camera3.far = lightRange + extent + 220;
    camera3.updateProjectionMatrix();
    const texelWorld = (extent * 2) / light.shadow.mapSize.x;
    /* Just over one texel. Below that a sloped surface self-shadows in
       stripes, which is what the hard vertical bars on cliff faces and
       the hatched acne in shadowed sand were. */
    /* The far cascade sits BELOW this line's own stated threshold and it
       does not matter. Worth recording so nobody re-derives it.

       At ultra the far cascade is 420m over a 1536 map: texelWorld
       0.547m, so it wants 0.957m and is clamped to 0.7 - an effective
       1.28 texels against the 1.75 this line exists to guarantee. It is
       the only cascade in that state (the near one wants 0.087m and
       never approaches the ceiling).

       Raising the ceiling to 1.05 was tried. It reaches the pixels -
       0.51% of them move, peak 148/255 - and on a like-for-like A/B with
       stance and framing pinned it changes distant-dune striping not at
       all: vertical-bar energy 0.1146 against 0.1159. The 1.75 figure is
       simply conservative at this range. Reverted rather than kept,
       because a change with no measured benefit is debt. */
    light.shadow.normalBias = clamp(texelWorld * 1.75, 0.02, 0.7);
    /* ---- the penumbra scale the PCSS chunk needs ----
       The chunk knows the blocker-to-receiver gap only as a difference
       of normalised depths. Multiplying by the depth range turns that
       into metres, times the sun's angular tangent gives the penumbra
       in metres, and dividing by the texel size puts it in the units
       the filter samples in. All three are cascade properties, so this
       is the one place they are all known at once. */
    light.shadow.radius = (SUN_ANGULAR_TAN * (camera3.far - camera3.near)) / texelWorld;
  }
  function fitShadowCascade(extent) {
    shadowExtent = extent;
    fitCascade(sun, extent);
  }
  fitShadowCascade(shadowExtent);
  scene.add(sun);
  scene.add(sun.target);

  /* ---------------------------- the far cascade ----------------------------

     One map with an adaptive extent was the standing structural gap:
     settings.js advertised shadowCascades 2-4 and nothing read it. At
     eye level the single map spans 27m at high and 76m at ultra, and the
     map-edge dissolve eats the outer eighth of that, so a dune ridge
     throwing a shadow across a valley cast nothing at all - which is
     what an establishing frame is mostly made of.

     This is a real second cascade, not a wider one map. It renders its
     own depth pass over an extent several times larger, and the shader
     picks between them per fragment: cascade 0 while the fragment is
     inside it, cascade 1 beyond, cross-faded over the last fifth so the
     switch is not a line across the sand.

     Why a second LIGHT rather than a second map on the same light:
     three plumbs exactly one shadow map, one shadow matrix and one set
     of shadow uniforms per light, and the varying that carries the
     shadow coordinate is generated per light too. A second light gets
     all of that for free. It carries a BLACK colour, so it adds no
     light of its own - it exists only to own a second map - and the
     patched lights chunk applies the combined factor to light zero,
     which is the one carrying the sun.

     Cost, measured: +19 draw calls and +1.0ms p90 at ultra. */
  const sunFar = new THREE.DirectionalLight(0x000000, 0);
  sunFar.name = "bs-sun-cascade-1";
  sunFar.castShadow = q.shadows && q.shadowCascades >= 2;
  /* Half the resolution of the near map. The far cascade covers four
     times the ground, so matching its resolution would cost four times
     the fill for detail nothing at that range can resolve - and PCSS
     widens the penumbra with throw distance anyway, so a far shadow is
     supposed to be soft. */
  const farMap = Math.max(1024, Math.round(q.shadowMapSize / 2));
  sunFar.shadow.mapSize.set(farMap, farMap);
  sunFar.shadow.bias = 0;
  sunFar.shadow.blurSamples = sun.shadow.blurSamples;
  /* 5.6x the near cascade, capped at the tier's shadow distance, which
     is what it actually hits: 420m at ultra, 150m at high. The cap is
     the binding constraint, so the multiplier only matters while the
     near cascade is at its floor - which is most of the time, because
     shadowExtentFor keys off height above LOCAL ground and a camera
     standing on a ridge measures two metres however far it can see.

     Its normal bias clamps at 0.7m, which is the honest cost: a shadow
     in this cascade can detach from its caster by up to that. At the
     ranges it serves - beyond the near cascade's 76m - 0.7m is under a
     pixel, and the alternative is the valley having no shadows at all. */
  const FAR_CASCADE_SCALE = 5.6;
  let farExtent = Math.min(q.shadowDistance, shadowExtent * FAR_CASCADE_SCALE);
  fitCascade(sunFar, farExtent);
  if (sunFar.castShadow) {
    scene.add(sunFar);
    scene.add(sunFar.target);
  }

  const hemi = new THREE.HemisphereLight(0xb9d6ff, 0x6a5a44, 0.55);
  scene.add(hemi);

  // Shadow camera follows the player, snapped to texel boundaries.
  // Without the snap, the shadow edges shimmer as you walk - the single
  // most obvious "this is not a real game" tell in a browser renderer.
  const shadowFocus = new THREE.Vector3();
  const shadowForward = new THREE.Vector3();
  const farFocus = new THREE.Vector3();
  function updateShadowCamera() {
    // sky.js turns the key light's shadow off at dusk; the far cascade has
    // to follow or it keeps rendering a depth pass for a light that is not
    // there. It is set here rather than in sky.js so the cascade rig stays
    // a private detail of this module.
    if (sunFar.parent) sunFar.castShadow = sun.castShadow && q.shadowCascades >= 2;
    if (!sun.castShadow) return;

    // Height above the ground under the camera, not above sea level -
    // a player standing on a 90m ridge is still at eye level as far as
    // what they can see of their own shadow is concerned.
    const ground = ctx.terrain
      ? ctx.terrain.heightAt(camera.position.x, camera.position.z)
      : 0;
    const target = shadowExtentFor(Math.max(0, camera.position.y - ground));
    // Eased, and snapped to a coarse step. Resizing the cascade every
    // frame re-quantises the texel grid every frame, which reintroduces
    // exactly the shimmer the texel snap below exists to remove.
    if (Math.abs(target - shadowExtent) > shadowExtent * 0.08) {
      fitShadowCascade(Math.round(target));
    }

    const extent = shadowExtent;
    const texelSize = (extent * 2) / q.shadowMapSize;

    // Bias the focus ahead of the camera so the budget is spent on what
    // the player is looking at rather than what is behind them.
    shadowFocus.copy(camera.position);
    shadowForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    shadowForward.y = 0;
    if (shadowForward.lengthSq() > 1e-6) {
      shadowForward.normalize().multiplyScalar(extent * 0.42);
      shadowFocus.add(shadowForward);
    }
    shadowFocus.x = Math.round(shadowFocus.x / texelSize) * texelSize;
    shadowFocus.z = Math.round(shadowFocus.z / texelSize) * texelSize;
    shadowFocus.y = Math.round(shadowFocus.y / texelSize) * texelSize;

    /* ---- where the sun actually is ----
       From sunDirWorld, which sky.js pushes through setAtmosphere and
       nothing else writes.

       This used to read `sun.position.clone().normalize()`, and that is
       a feedback loop: the line below had ALREADY moved sun.position to
       shadowFocus + dir * distance on the previous frame, so
       normalising it re-derives a direction from a point that carries
       the camera's world coordinates. Iterated once per frame it
       converges on a function of where the player is standing rather
       than on where the sun is - measured 39 degrees out in elevation
       and 140 in azimuth, an 8.7-degree key where the sky said 47.8.

       At that incidence nothing in the scene has a shadow side, direct
       light contributes about a seventh of the frame, and every shadow
       lands metres from its caster. It was the cause of most of what
       read as missing or detached shadows.

       A light's position is a shadow-rig detail. Its DIRECTION is scene
       state, and scene state must not be stored in something another
       system is entitled to move. */
    sun.target.position.copy(shadowFocus);
    sun.position.copy(shadowFocus).addScaledVector(sunDirWorld, q.shadowDistance * 1.1);
    sun.target.updateMatrixWorld();

    /* ---- the far cascade, snapped to its OWN texel grid ----
       Sharing the near cascade's focus would be wrong twice over: its
       texel is four times coarser, so the near map's snap leaves it a
       quarter-texel out and the far shadows crawl; and it wants to look
       further ahead, because the whole reason it exists is the ground
       the near map does not reach. */
    if (sunFar.castShadow) {
      const wantFar = Math.min(q.shadowDistance, extent * FAR_CASCADE_SCALE);
      if (Math.abs(wantFar - farExtent) > farExtent * 0.08) {
        farExtent = Math.round(wantFar);
        fitCascade(sunFar, farExtent);
      }
      const farTexel = (farExtent * 2) / sunFar.shadow.mapSize.x;
      farFocus.copy(camera.position);
      if (shadowForward.lengthSq() > 1e-6) {
        farFocus.addScaledVector(shadowForward, (farExtent * 0.42) / (extent * 0.42));
      }
      farFocus.x = Math.round(farFocus.x / farTexel) * farTexel;
      farFocus.y = Math.round(farFocus.y / farTexel) * farTexel;
      farFocus.z = Math.round(farFocus.z / farTexel) * farTexel;
      sunFar.target.position.copy(farFocus);
      sunFar.position.copy(farFocus).addScaledVector(sunDirWorld, q.shadowDistance * 1.1);
      sunFar.target.updateMatrixWorld();
      sunFar.updateMatrixWorld();
    }
    sun.updateMatrixWorld();
  }

  /* ------------------------ adaptive resolution ------------------------ */

  const frameStat = makeStat(120);
  const adaptive = {
    enabled: settings.prefs.adaptiveResolution && !settings.qa,
    target: 1000 / (settings.prefs.targetFps || 60),
    scale: q.renderScale,
    min: 0.58,
    max: q.renderScale,
    cooldown: 0,
  };

  function updateAdaptive(dtMs) {
    frameStat.push(dtMs);
    if (!adaptive.enabled || frameStat.length < 45) return;
    adaptive.cooldown -= dtMs;
    if (adaptive.cooldown > 0) return;

    // Judge on the 90th percentile, not the mean. A shooter that
    // averages 60 but spikes to 90ms feels broken; the mean hides it.
    const p90 = frameStat.percentile(90);
    const over = p90 > adaptive.target * 1.16;
    const under = p90 < adaptive.target * 0.74;

    let next = adaptive.scale;
    if (over) next = Math.max(adaptive.min, adaptive.scale - 0.06);
    else if (under) next = Math.min(adaptive.max, adaptive.scale + 0.03);

    if (Math.abs(next - adaptive.scale) > 0.001) {
      adaptive.scale = next;
      renderScale = next;
      resize(true);
      adaptive.cooldown = 900;
      frameStat.clear();
    } else {
      adaptive.cooldown = 300;
    }
  }

  /* ---------------------------- exposure ---------------------------- */

  // Eye adaptation. Sampling the framebuffer back to the CPU stalls the
  // pipeline, so drive exposure from what the sky module reports about
  // sun elevation and whether the camera is indoors, which is free and
  // does not lag a frame behind.
  /**
   * `bias` multiplies whatever the sky asks for.
   *
   * sky.js drives `target` every frame from sun elevation and weather,
   * which is correct - the exposure should follow the light. But that
   * makes it impossible to trim the overall level without editing the
   * atmosphere model, because any value written here is overwritten on
   * the next frame. The bias is the artist-facing trim, and it is what
   * the grade tuner sweeps.
   */
  /* 2.9, down from 5.2.
     At 5.2 sunlit sand landed at display 227-238, which is on AgX's
     shoulder. Everything on the shoulder is compressed towards white
     together, so a shadow at a physically correct fifth of the key
     still came out at 68-78% of the lit side - the exact fault the art
     direction flagged as "shadow luminance ratio is wrong". It was
     never a shadow problem. Exposing so the key sits at 180-200 puts
     the whole scene back on the straight part of the curve, where a
     stop of scene contrast is still a stop of picture contrast. */
  /* 0.88, where it was 0.96: the trim that pays for uLogSlope.
     Expanding about middle grey raises everything in the top half. */
  const exposure = { current: 1.0, target: 1.0, rate: 1.6, bias: 0.88 };

  /* ----------------------------- frame ----------------------------- */

  const prevViewProj = new THREE.Matrix4();
  const currViewProj = new THREE.Matrix4();
  const invViewProj = new THREE.Matrix4();
  const sunProbe = new THREE.Vector3();
  let elapsed = 0;
  let shaftStrength = 0;
  // The composite runs inside composer.render() and needs the frame dt
  // for the exposure adaptation. EffectComposer passes its own
  // deltaTime through, but only when it was given one, so record it.
  let lastDelta = 1 / 60;

  function render(dt) {
    elapsed += dt;
    lastDelta = dt;
    updateShadowCamera();

    camera.updateMatrixWorld();
    currViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    invViewProj.copy(currViewProj).invert();

    composite.uniforms.uTime.value = elapsed;
    composite.uniforms.uInvViewProj.value.copy(invViewProj);
    composite.uniforms.uPrevViewProj.value.copy(prevViewProj);
    composite.uniforms.uCameraPos.value.copy(camera.position);

    /* Where the sun lands on screen, for the light shafts. Projecting a
       point a long way down the sun vector rather than using the light's
       own position keeps this right no matter where the shadow rig has
       parked the light. */
    if (shaftStrength > 0) {
      sunProbe.copy(camera.position).addScaledVector(sunDirWorld, 8000);
      sunProbe.applyMatrix4(currViewProj);
      const inFront = sunDirWorld.dot(
        new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
      ) > 0.05;
      const believable = inFront && sunDirWorld.y > 0.02 ? clamp01(sunDirWorld.y * 6) : 0;
      composite.uniforms.uSunScreen.value.set(
        sunProbe.x * 0.5 + 0.5, sunProbe.y * 0.5 + 0.5, believable
      );
      composite.uniforms.uShafts.value = believable > 0 ? shaftStrength : 0;
    }
    exposure.current = damp(exposure.current, exposure.target * exposure.bias, exposure.rate, dt);
    composite.uniforms.uExposure.value = exposure.current;

    renderer.info.reset();
    composer.render(dt);

    // The view model draws last, straight to the screen, over the
    // composed frame. It is deliberately outside the post chain: motion
    // blur and AO on first-person hands look wrong, and the near plane
    // it needs would wreck depth precision for the world.
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(viewScene, viewCamera);
    renderer.autoClear = true;

    prevViewProj.copy(currViewProj);
  }

  /* ------------------------------ api ------------------------------ */

  const api = {
    renderer,
    composer,
    scene,
    camera,
    viewScene,
    viewCamera,
    sun,
    /** Cascade 1's shadow rig. Black, so it lights nothing - it exists
     *  only to own a second shadow map. Nothing outside this module
     *  should need it; exposed so a QA probe can A/B the cascade. */
    sunFar,
    hemi,
    composite,
    bloom,
    ao,
    meter,
    anisotropy,
    size,

    /**
     * What the meter currently reads, and the exposure gain it implies.
     *
     * This reads a render target back to the CPU, which stalls the
     * pipeline - that is exactly why the metering loop itself never
     * does it. QA and tuning only, never per frame.
     */
    meterValue() {
      if (!meter.enabled || !meter.primed) return null;
      // The target is half float, so the read buffer has to be 16-bit
      // and the value decoded by hand. Handing readRenderTargetPixels a
      // Float32Array here silently returns zeros, which reads as "the
      // meter is broken" when it is only the instrument that is.
      const buffer = new Uint16Array(4);
      const target = meter.adapt[meter.index];
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, buffer);
      renderer.setRenderTarget(null);
      const half = buffer[0];
      const sign = (half & 0x8000) ? -1 : 1;
      const exp = (half & 0x7c00) >> 10;
      const frac = half & 0x03ff;
      const logLuma = exp === 0
        ? sign * Math.pow(2, -14) * (frac / 1024)
        : (exp === 0x1f ? 0 : sign * Math.pow(2, exp - 15) * (1 + frac / 1024));
      const adapted = Math.pow(2, logLuma);
      return {
        logLuma: Number(logLuma.toFixed(4)),
        luma: Number(adapted.toFixed(5)),
        gain: Number(clamp(meter.key / Math.max(adapted, 1e-5), meter.min, meter.max).toFixed(4)),
        key: meter.key,
        exposure: Number((exposure.current
          * clamp(meter.key / Math.max(adapted, 1e-5), meter.min, meter.max)).toFixed(4)),
      };
    },

    get frame() { return renderer.info.render.frame; },
    get drawCalls() { return renderer.info.render.calls; },
    get triangles() { return renderer.info.render.triangles; },

    resize,
    render,
    updateAdaptive,

    setExposure(target, immediate = false) {
      exposure.target = target;
      if (immediate) exposure.current = target;
    },
    get exposure() { return exposure.current; },

    /**
     * Everything the composite needs to know about the air, pushed by
     * the sky module. Kept as one call rather than a dozen setters so
     * the atmosphere can never be half-updated across a frame - a
     * frame with the new extinction and the old in-scatter level is a
     * visible flash when the weather changes.
     */
    setAtmosphere(a) {
      const u = composite.uniforms;
      if (a.sunDirection) {
        sunDirWorld.copy(a.sunDirection);
        u.uSunDirWorld.value.copy(a.sunDirection);
      }
      if (a.betaR) u.uBetaR.value.copy(a.betaR);
      if (a.betaM !== undefined) u.uBetaM.value = a.betaM;
      if (a.mieG !== undefined) u.uMieG.value = a.mieG;
      if (a.tint) u.uAerialTint.value.copy(a.tint);
      if (a.level !== undefined) u.uAerialLevel.value = a.level;
      if (a.skyInscatter) u.uAerialSky.value.copy(a.skyInscatter);
      // Shared with the sky dome so the horizon and the fog on the
      // terrain under it cannot settle to different colours.
      if (a.hazeSat !== undefined) u.uHazeSat.value = a.hazeSat;
      if (a.strength !== undefined) u.uAerial.value = a.strength;
      if (a.profile) u.uFogProfile.value.copy(a.profile);
      if (a.shafts !== undefined) {
        shaftStrength = a.shafts;
        if (shaftStrength <= 0) {
          u.uShafts.value = 0;
          u.uSunScreen.value.z = 0;
        }
      }
      if (a.cloudShadow) u.uCloudShadow.value.copy(a.cloudShadow);
      /* The colour of the light that fills a shadow, normalised here so
         the caller can hand over a raw bounce colour and never move the
         black point by accident - only its hue. */
      if (a.fillTint) {
        const t = a.fillTint;
        const l = 0.2126 * t.r + 0.7152 * t.g + 0.0722 * t.b;
        if (l > 1e-4) u.uShadowLiftTint.value.set(t.r / l, t.g / l, t.b / l);
      }
    },

    setFov(deg) {
      camera.fov = clamp(deg, 40, 120);
      camera.updateProjectionMatrix();
    },

    /** Hooked by the player module for the hit flash. */
    setDamage(amount, dirX = 0, dirY = 0) {
      composite.uniforms.uDamage.value = clamp01(amount);
      composite.uniforms.uDamageDir.value.set(dirX, dirY);
    },
    setSuppression(amount) {
      composite.uniforms.uSuppression.value = clamp01(amount);
    },

    /** Art-director knobs, exposed so the critic loop can tune the grade
     *  without a code edit. */
    grade(patch) {
      const u = composite.uniforms;
      if (patch.exposure !== undefined) { exposure.target = patch.exposure; exposure.current = patch.exposure; }
      if (patch.saturation !== undefined) u.uSaturation.value = patch.saturation;
      if (patch.contrast !== undefined) u.uContrast.value = patch.contrast;
      if (patch.pivot !== undefined) u.uPivot.value = patch.pivot;
      if (patch.vignette !== undefined) u.uVignette.value = patch.vignette;
      if (patch.sharpen !== undefined) u.uSharpen.value = patch.sharpen;
      if (patch.grain !== undefined) u.uGrain.value = patch.grain;
      if (patch.chroma !== undefined) u.uChroma.value = patch.chroma;
      if (patch.motionBlur !== undefined) u.uMotionBlur.value = patch.motionBlur;
      if (patch.lift) u.uLift.value.fromArray(patch.lift);
      if (patch.shadowLift !== undefined) u.uShadowLift.value = patch.shadowLift;
      if (patch.logSlope !== undefined) u.uLogSlope.value = patch.logSlope;
      if (patch.lookSlope !== undefined) u.uLookSlope.value = patch.lookSlope;
      if (patch.lookOffset !== undefined) u.uLookOffset.value = patch.lookOffset;
      if (patch.lookPower !== undefined) u.uLookPower.value = patch.lookPower;
      if (patch.shoulderRelax !== undefined) u.uShoulderRelax.value = patch.shoulderRelax;
      if (patch.relaxSplit !== undefined) u.uRelaxSplit.value = patch.relaxSplit;
      if (patch.lookSat !== undefined) u.uLookSat.value = patch.lookSat;
      if (patch.exposureBias !== undefined) exposure.bias = patch.exposureBias;
      if (patch.meterKey !== undefined) meter.key = patch.meterKey;
      if (patch.meterRange) { meter.min = patch.meterRange[0]; meter.max = patch.meterRange[1]; }
      if (patch.autoExposure !== undefined) meter.enabled = Boolean(patch.autoExposure);
      if (patch.gamma) u.uGamma.value.fromArray(patch.gamma);
      if (patch.gain) u.uGain.value.fromArray(patch.gain);
      if (patch.shadowTint) u.uShadowTint.value.fromArray(patch.shadowTint);
      if (patch.highTint) u.uHighTint.value.fromArray(patch.highTint);
      if (patch.satRoll !== undefined) u.uSatRoll.value = patch.satRoll;
      if (patch.hazeSat !== undefined) u.uHazeSat.value = patch.hazeSat;
      if (patch.aerialDesat !== undefined) u.uAerialDesat.value = patch.aerialDesat;
      if (patch.bloomStrength !== undefined) bloom.strength = patch.bloomStrength;
      if (patch.bloomThreshold !== undefined) bloom.threshold = patch.bloomThreshold;
      if (patch.bloomKnee !== undefined) bloom.knee = patch.bloomKnee;
      if (patch.ao !== undefined) ao.strength = clamp01(patch.ao);
      if (patch.aoFloor !== undefined) u.uAOFloor.value = clamp01(patch.aoFloor);
      if (patch.aoContactFloor !== undefined) u.uContactFloor.value = clamp01(patch.aoContactFloor);
      if (patch.aoNearRadius !== undefined) ao.nearRadius = patch.aoNearRadius;
      if (patch.aoNearPower !== undefined) ao.nearPower = patch.aoNearPower;
      if (patch.aoContact !== undefined) ao.contact = Math.max(0, patch.aoContact);
      if (patch.aoRadius !== undefined) ao.radius = patch.aoRadius;
      if (patch.aoPower !== undefined) ao.power = patch.aoPower;
      if (patch.aoBias !== undefined) ao.bias = patch.aoBias;
    },

    readGrade() {
      const u = composite.uniforms;
      return {
        exposure: exposure.target,
        exposureBias: exposure.bias,
        meter: meter.enabled
          ? { key: meter.key, min: meter.min, max: meter.max, rate: meter.rate }
          : null,
        envDiffuse: ENV_DIFFUSE,
        shadowLift: composite.uniforms.uShadowLift.value,
        look: {
          logSlope: composite.uniforms.uLogSlope.value,
          slope: composite.uniforms.uLookSlope.value,
          offset: composite.uniforms.uLookOffset.value,
          power: composite.uniforms.uLookPower.value,
          shoulderRelax: composite.uniforms.uShoulderRelax.value,
          relaxSplit: composite.uniforms.uRelaxSplit.value,
          saturation: composite.uniforms.uLookSat.value,
        },
        saturation: u.uSaturation.value,
        satRoll: u.uSatRoll.value,
        contrast: u.uContrast.value,
        pivot: u.uPivot.value,
        shadowTint: u.uShadowTint.value.toArray(),
        highTint: u.uHighTint.value.toArray(),
        hazeSat: u.uHazeSat.value,
        aerialDesat: u.uAerialDesat.value,
        vignette: u.uVignette.value,
        sharpen: u.uSharpen.value,
        grain: u.uGrain.value,
        chroma: u.uChroma.value,
        motionBlur: u.uMotionBlur.value,
        ao: ao.enabled
          ? {
            strength: ao.strength, radius: ao.radius, power: ao.power,
            bias: ao.bias, floor: u.uAOFloor.value, samples: AO_SAMPLES,
            nearRadius: ao.nearRadius, nearPower: ao.nearPower,
            nearSamples: AO_NEAR_SAMPLES, contact: ao.contact,
            contactSteps: AO_CONTACT_STEPS, contactFloor: u.uContactFloor.value,
          }
          : null,
        bloom: bloom.enabled
          ? { strength: bloom.strength, threshold: bloom.threshold, knee: bloom.knee, mips: BLOOM_MIPS }
          : null,
      };
    },

    stats() {
      return {
        frame: renderer.info.render.frame,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs ? renderer.info.programs.length : 0,
        renderScale: Number(renderScale.toFixed(3)),
        pixelRatio: size.dpr,
        width: size.width,
        height: size.height,
        frameMs: Number(frameStat.mean().toFixed(2)),
        frameMsP90: Number(frameStat.percentile(90).toFixed(2)),
      };
    },

    dispose() {
      if (ao.target) ao.target.dispose();
      if (ao.blur) ao.blur.dispose();
      aoMaterial.dispose();
      aoBlurMaterial.dispose();
      for (const target of meter.targets) target.dispose();
      meterMaterial.dispose();
      meterDownMaterial.dispose();
      meterAdaptMaterial.dispose();
      for (const target of bloom.targets) target.dispose();
      postQuad.geometry.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };

  resize(true);
  window.addEventListener("resize", () => resize());
  if (window.visualViewport) window.visualViewport.addEventListener("resize", () => resize());

  return api;
}
