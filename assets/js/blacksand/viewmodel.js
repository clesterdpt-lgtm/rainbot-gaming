/* ============================================================
   BLACKSAND - first-person view model

   The weapon and hands, rendered in their own scene through their own
   camera (see render.js) so they can have an 8mm near plane without
   destroying depth precision for a 1km map.

   Two things decide whether a first-person weapon reads as a real
   object or as a pile of primitives, and neither is polygon count:

   1. CHAMFERS. Every hard edge on a real weapon is a 0.5-1mm machined
      face that catches a specular line. A BoxGeometry has none, so its
      silhouette is a black cut-out no matter how good the material is.
      Everything structural here is an extruded chamfered profile
      instead, which costs eight extra triangles per part and is most of
      the difference between "gun" and "box".

   2. MASS IN THE ANIMATION. A recoil curve that returns linearly reads
      as a UI tween. The spring below overshoots, settles and carries a
      rotational component, and the bolt/mag/charging-handle groups move
      independently of the body so a reload has readable stages rather
      than being one blended pose.

   Draw cost: parts are merged per material per animated group, so a
   sixty-piece rifle draws in about six calls.
   ============================================================ */

import { clamp, clamp01, lerp, damp, smoothstep, makeRng, DEG } from "./core.js";
import { LAYER } from "./physics.js";

/** Bore height above the gun's local origin. Every weapon uses the same
 *  value so the pose numbers below mean the same thing on all of them. */
const BORE_Y = 0.032;

export async function createViewmodel(ctx) {
  // No `materials` here on purpose: the view model owns every material
  // it uses. The library caches by colour, so a shader patch applied to
  // a shared entry leaks into whatever else asks for that colour, and
  // the last thing that came from there - an additive red dot - was
  // invisible against sand. See the note on the reticle.
  const { THREE, render, weapons, player, settings, physics } = ctx;
  const q = settings.q;
  const rng = makeRng((ctx.seed ^ 0x77e4b1) >>> 0);

  const root = new THREE.Group();
  root.name = "viewmodel";
  render.viewScene.add(root);

  /* ---------------------------- lighting ---------------------------- */

  // The view scene has no lights of its own. Copy the world's key and
  // fill EVERY FRAME, in camera space, so the weapon is lit by the same
  // sun as everything else - a view model with its own fixed lighting is
  // instantly obvious because it does not change when the player turns
  // around or walks into shadow.
  const vmKey = new THREE.DirectionalLight(0xffffff, 2.4);
  vmKey.position.set(0.6, 1.0, 0.8);
  render.viewScene.add(vmKey);
  render.viewScene.add(vmKey.target);

  const vmFill = new THREE.HemisphereLight(0xb9d6ff, 0x50463a, 0.9);
  render.viewScene.add(vmFill);

  // A dim kicker from below-front. Without it the underside of the
  // receiver and the magazine go to pure black and the weapon loses its
  // bottom edge against a dark floor.
  const vmBounce = new THREE.DirectionalLight(0xffd9b0, 0.35);
  vmBounce.position.set(-0.4, -0.9, -0.6);
  render.viewScene.add(vmBounce);
  render.viewScene.add(vmBounce.target);

  // Self-shadowing on the weapon: the handguard's shadow across the
  // magazine and the support hand's across the receiver are a large part
  // of why a first-person weapon looks solid. Tight ortho box, small
  // map - it is eight meshes at 30cm, not a scene.
  const castShadows = Boolean(q.shadows) && q.shadowCascades >= 3;
  if (castShadows) {
    vmKey.castShadow = true;
    vmKey.shadow.mapSize.set(1024, 1024);
    vmKey.shadow.camera.near = 0.02;
    vmKey.shadow.camera.far = 3.2;
    vmKey.shadow.camera.left = -0.45;
    vmKey.shadow.camera.right = 0.45;
    vmKey.shadow.camera.top = 0.45;
    vmKey.shadow.camera.bottom = -0.45;
    // Parts are millimetres thick; the world's bias values shadow-acne
    // the whole weapon at this scale.
    vmKey.shadow.bias = -0.0004;
    vmKey.shadow.normalBias = 0.004;
    vmKey.shadow.camera.updateProjectionMatrix();
  }

  /* ---------------------------- materials ---------------------------- */

  /**
   * The weapon owns its materials outright rather than pulling them
   * from `materials.flat`.
   *
   * Two reasons. The library caches by colour, so a shader patch
   * applied to "flat 0x33342f" would leak into whatever else asks for
   * that colour. And the view model needs its own envMapIntensity: the
   * world's sky IBL is scaled to a sun:sky ratio near 7:1, which for a
   * 30cm metal object 40cm from the eye leaves every metal surface
   * black except for one specular band off the key light. That band on
   * flat grey was, verbatim, the fault the art director named.
   */

  /**
   * A shared micro-surface texture, sampled triplanar in OBJECT space.
   *
   * The weapon geometry is merged from sixty primitives with whatever
   * UVs each one happened to carry - cylinder caps are a single point,
   * extruded end caps are all (0,0). There is no usable UV set to hang
   * a texture on, and unwrapping sixty procedurally generated parts is
   * not a thing this file can do. Object-space triplanar needs no UVs
   * at all, and because it is OBJECT space rather than world space the
   * grain stays welded to the weapon as it sways.
   *
   * ---- what each channel is, and why it is not a normal map ----
   *
   * The first version of this stored a tangent-space normal in RGB and
   * a height in A. The shader never read RGB - it does a derivative
   * bump off the height instead, because there is no tangent frame -
   * so three quarters of the texture were dead, and the one live
   * channel was a single 0.25mm octave. At the distance a view model
   * is actually seen from, 0.25mm lands at two screen pixels: the
   * mip chain averages it to flat grey and the surface reads as
   * unfired clay no matter how large the amplitude is.
   *
   * A micro-surface has to be MULTI-SCALE to survive that. The four
   * channels are now four separate fields at three different sizes:
   *
   *   R  machining lay - high frequency across, near-constant along,
   *      so the specular smears in one direction. This is the
   *      anisotropic highlight; real anisotropy needs a tangent frame
   *      and MeshPhysicalMaterial, and a streaked height field
   *      produces the same read for nothing.
   *   G  macro mottle, ~15 cells a tile. Sampled at a SIXTH of the
   *      fine rate it lands near 5mm, which is the coarsest thing on
   *      a real receiver that is still surface rather than shape,
   *      and it is the octave that actually survives to the screen.
   *   B  pitting and dirt - sparse dark specks, biased to the low
   *      ground of the mottle so grime collects where grime collects.
   *   A  the fine height the derivative bump differentiates.
   */
  function buildSurfaceTexture(size = 256) {
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const g = canvas.getContext("2d");

    const lattice = (n, seed) => {
      const grid = new Float32Array(n * n);
      const r = makeRng(seed);
      for (let i = 0; i < grid.length; i += 1) grid[i] = r();
      return (u, v) => {
        const x = u * n; const y = v * n;
        const x0 = Math.floor(x); const y0 = Math.floor(y);
        const fx = x - x0; const fy = y - y0;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const i = (px, py) => grid[(((py % n) + n) % n) * n + (((px % n) + n) % n)];
        const a = i(x0, y0) + (i(x0 + 1, y0) - i(x0, y0)) * sx;
        const b = i(x0, y0 + 1) + (i(x0 + 1, y0 + 1) - i(x0, y0 + 1)) * sx;
        return a + (b - a) * sy;
      };
    };
    // Anisotropic lattices: 4 cells along u, many across v. Value noise
    // stretched 20:1 IS a machining lay - there is no need for a
    // separate streak function on top of it.
    const layFine = lattice(96, 0x91d1);
    const layCoarse = lattice(24, 0x5c02);
    const grain = lattice(64, 0x2f77);
    const macro = lattice(15, 0x7a31);
    const spot = lattice(48, 0xb18e);

    const image = g.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const u = x / size; const v = y / size;

        // The lay runs along U. Sampling the lattice with a compressed
        // u and a full-rate v gives cells 24x longer than they are
        // wide; two octaves keep it from looking like a comb.
        const lay = layFine(u * 0.05, v) * 0.62 + layCoarse(u * 0.17, v) * 0.38;
        // Mottle: the octave that has to survive mipping.
        const mot = clamp01(macro(u, v) * 1.20 - 0.10);
        // Pits. A power curve on independent noise leaves isolated
        // specks rather than a grey wash, and biasing by the mottle
        // low ground puts them where dirt would settle.
        const sp = spot(u, v);
        const pit = clamp01(Math.pow(clamp01(sp * 1.15 - 0.42) * 1.72, 2.2)
          * (1.35 - mot * 0.7));
        // Fine height. Mostly lay, because a receiver is broached and
        // a barrel is turned; the isotropic grain is the casting
        // texture underneath it.
        const h = clamp01(lay * 0.62 + grain(u, v) * 0.38);

        const i = (y * size + x) * 4;
        image.data[i] = clamp01(lay) * 255;
        image.data[i + 1] = mot * 255;
        image.data[i + 2] = pit * 255;
        image.data[i + 3] = h * 255;
      }
    }
    g.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = render.anisotropy;
    // The channels are masks, not colour. Decoding them through sRGB
    // would gamma-warp every threshold in the shader.
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
  }

  const surfaceTexture = buildSurfaceTexture();
  const ownedMaterials = [];

  /** The two rates the detail texture is sampled at, as multiples of a
   *  material's `scale`. At the default scale of 62 the tile is 16mm, so
   *  macro puts the mottle's 15 cells at ~8mm and meso puts the lay's 96
   *  cross-cells at ~0.3mm - roughly 2 screen pixels at ADS, which is
   *  where a streak breaks a specular band without becoming gravel. */
  const MACRO_RATE = 0.22;
  const MESO_RATE = 0.5;

  /**
   * The world's tone curve, applied to the view scene.
   *
   * render.js renders the view model LAST, straight to the canvas,
   * outside the post chain - motion blur and AO on first-person hands
   * look wrong. The cost of that is `renderer.toneMapping` is
   * NoToneMapping (the composite owns the mapping), so the weapon was
   * the only thing on screen going to the display through a bare sRGB
   * transfer while everything behind it went through AgX.
   *
   * Measured on the isolated meshes: 1.5% of the aluminium's pixels and
   * 0.6% of the receiver's were pinned at 255,255,255. Every specular
   * highlight on the weapon hit a hard ceiling and became a flat white
   * plateau - which is precisely "one hard specular band" and
   * "aluminium reads as unfired clay", because a clipped highlight
   * carries no shape and no colour.
   *
   * So the gun materials run AgX themselves, in place of the sRGB
   * encode, with the parameters READ FROM render's composite uniforms
   * every frame rather than copied. Copying the constants would work
   * today and silently drift the moment anyone retunes the grade.
   *
   * The uniform OBJECTS below are shared by reference across every gun
   * material, so `syncTone()` writes each value once and all of them
   * see it. onBeforeCompile gets a fresh uniform clone per material,
   * but the objects we put INTO it are ours and stay aliased.
   */
  const tone = {
    uEv: { value: 1.0 },
    uLogSlope: { value: 1.45 },
    uLookSlope: { value: 1.0 },
    uLookOffset: { value: 0.0 },
    uLookPower: { value: 0.93 },
    uLookSat: { value: 1.45 },
    // The auto-exposure meter, sampled rather than read back. render.js
    // reduces the frame to one texel on the GPU precisely so nothing
    // stalls the pipeline reading it; doing the same multiply here keeps
    // the weapon on the same exposure ramp as the world for the cost of
    // one texture fetch. uMeterRange collapsed to (1,1) is the "no meter
    // yet" path, which is how render.js spells it too.
    uMeterTex: { value: null },
    uMeterKey: { value: 0.162 },
    uMeterRange: { value: new THREE.Vector2(1, 1) },
    uShadowLift: { value: 0.0 },
  };
  /** Scene EV, scaled for the view scene.
   *
   *  The view lights were tuned by eye against a bare sRGB encode, so
   *  handing them the world's EV unchanged moves the weapon's midtone a
   *  long way. Measured on the isolated-mesh readback, 0.78 put the
   *  parkerised receiver at luma 88 against the 49.5 it had before the
   *  curve, and the ADS lower third at 136 against a whole-frame 142 -
   *  a weapon brighter than the desert it is pointed at, which is the
   *  same fault as the clipping, in the other direction.
   *
   *  Solved by sweeping `toneScale()` and reading the ADS frame back.
   *  The absolute numbers below are from the sweep taken before the
   *  occlusion bake and the key-direction fix landed, so they no longer
   *  bracket the value in use - what survives is the SHAPE of the
   *  trade, which is the reason to keep the table:
   *
   *      scale   frame   lower third   sd    lower/frame
   *      1.0     118.7      85.3       45.0     0.719
   *      1.4     126.4      97.3       37.3     0.770
   *      1.8     129.3     110.4       32.4     0.854
   *      2.8     134.9     123.4       25.2     0.915
   *
   *  Two things fall out of it. The ratio is the composition knob - a
   *  first-person weapon is a dark object held in the shooter's own
   *  shade and it belongs under the sunlit ground, not at the 0.92
   *  that reads as a decal pasted on the frame. And the weapon's
   *  INTERNAL contrast falls as the ratio rises: every step up costs
   *  sd, because more of the material lands on the shoulder of the
   *  curve where the slope is flat. Internal contrast is precisely
   *  what "a flat grey receiver" is a complaint about, so the correct
   *  side to err on is the low one, and the only thing stopping it
   *  going lower is `action-ads` falling out of the bottom of the
   *  Battlefield 2 luma distribution. Re-solve with `toneScale()`
   *  whenever the world's lighting is retuned. */
  const TONE_EV_SCALE = 1.98;
  let toneScale = TONE_EV_SCALE;
  const TONE_GLSL = /* glsl */`
    const mat3 BS_AGX_IN = mat3(
      0.8425, 0.0784, 0.0792,
      0.0423, 0.8785, 0.0792,
      0.0424, 0.0784, 0.8791
    );
    const mat3 BS_AGX_OUT = mat3(
       1.1968, -0.0980, -0.0990,
      -0.0528,  1.1519, -0.0991,
      -0.0529, -0.0980,  1.1509
    );
    vec3 bsAgxContrast(vec3 x) {
      vec3 x2 = x * x;
      vec3 x4 = x2 * x2;
      return + 15.5   * x4 * x2 - 40.14  * x4 * x + 31.96 * x4
             - 6.868  * x2 * x  + 0.4298 * x2     + 0.1191 * x - 0.00232;
    }
    vec3 bsTone(vec3 col) {
      float ev = uEv;
      if (uMeterRange.y > uMeterRange.x) {
        float adapted = exp2(texture2D(uMeterTex, vec2(0.5)).r);
        ev *= clamp(uMeterKey / max(adapted, 1e-5), uMeterRange.x, uMeterRange.y);
      }
      col = BS_AGX_IN * max(col * ev, 0.0);
      col = clamp((log2(col + 1e-10) + 12.47393) / 16.499999, 0.0, 1.0);
      col = clamp((col - 0.5) * uLogSlope + 0.5, 0.0, 1.0);
      col = bsAgxContrast(col);
      col = pow(max(col * uLookSlope + uLookOffset, 0.0), vec3(uLookPower));
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = l + uLookSat * (col - l);
      col = clamp(BS_AGX_OUT * col, 0.0, 1.0);
      // The composite's toe floor, applied here for the same reason it
      // exists there: the shaded side of a 30cm object 40cm from the
      // eye lands at the very bottom of the curve, and without a floor
      // it clips to literal zero. Measured before this went in: 19% of
      // the polymer's pixels and 12% of the rubber's were at luma <= 6,
      // which is no shape, no material and no silhouette on exactly the
      // parts a first-person weapon shows most of. Display-referred,
      // like the composite's, so the same constant means the same
      // thing in both places.
      float toe = 1.0 - smoothstep(0.0, 0.34, dot(col, vec3(0.2126, 0.7152, 0.0722)));
      col = clamp(col + uShadowLift * toe * toe * vec3(0.96, 0.96, 1.0), 0.0, 1.0);
      /* Back to linear before returning.
       *
       * This is the one line that separates a tonemap living in a
       * material from the same tonemap living in a post pass, and
       * leaving it out cost a full round. render.js's composite writes
       * its result straight to the canvas, so its AgX is
       * display-referred and correct as it stands. A MeshStandardMaterial
       * is followed by <colorspace_fragment>, which applies the sRGB
       * OETF to whatever this returns - so returning display-referred
       * values encodes them a SECOND time.
       *
       * Measured: the weapon came out a pale ghost, the ADS lower third
       * landed at 136 against a 142 frame, and render.js's 0.038 shadow
       * floor - 10/255 where it lives - arrived on the weapon as 55/255,
       * because sRGB OETF of 0.038 is 0.215. Three's own AgXToneMapping
       * ends with exactly this pow for exactly this reason. */
      return pow(col, vec3(2.2));
    }
  `;

  /** Pull the live grade off render's composite pass. Reading the
   *  uniforms rather than render.readGrade() because the exposure that
   *  matters is `uExposure`, the DAMPED current value, not the target
   *  readGrade reports. */
  function syncTone() {
    const u = render.composite && render.composite.uniforms;
    if (!u) return;
    tone.uEv.value = (u.uExposure ? u.uExposure.value : 1) * toneScale;
    tone.uLogSlope.value = u.uLogSlope.value;
    tone.uLookSlope.value = u.uLookSlope.value;
    tone.uLookOffset.value = u.uLookOffset.value;
    tone.uLookPower.value = u.uLookPower.value;
    tone.uLookSat.value = u.uLookSat.value;
    tone.uShadowLift.value = u.uShadowLift ? u.uShadowLift.value : 0;
    const meterTexture = u.tMeter ? u.tMeter.value : null;
    tone.uMeterTex.value = meterTexture;
    if (meterTexture && u.uMeterRange) {
      tone.uMeterKey.value = u.uMeterKey.value;
      tone.uMeterRange.value.copy(u.uMeterRange.value);
    } else {
      tone.uMeterRange.value.set(1, 1);
    }
  }

  /**
   * Object-space triplanar detail, plus edge wear.
   *
   * `aEdge` is written by `extrude()` for the chamfer facets only - the
   * 0.5mm cut faces that a real weapon rubs bare first. Multiplying it
   * by the noise gives wear that follows the geometry instead of a
   * uniform dirt pass, which is the difference between "worn" and
   * "someone applied a grunge layer".
   */
  function gunMaterial(colour, options = {}) {
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colour),
      roughness: options.roughness ?? 0.7,
      metalness: options.metalness ?? 0.0,
      // Live only because update() assigns render.scene.environment onto
      // every material in `ownedMaterials`. Without that assignment this
      // is inert on Three r180 - measured, a 12x sweep moves frame luma
      // by 0.14 - and the whole palette below would be tuning a dead
      // knob. The defaults are deliberately near 1: a value that has to
      // be set per material is a value someone chose.
      envMapIntensity: options.envMapIntensity ?? (options.metalness > 0.5 ? 1.0 : 0.7),
      transparent: Boolean(options.transparent),
      opacity: options.opacity ?? 1,
      // Glass that writes depth occludes whatever is inside the tube,
      // reticle included.
      depthWrite: options.depthWrite ?? !options.transparent,
      emissive: options.emissive !== undefined ? new THREE.Color(options.emissive) : 0x000000,
      emissiveIntensity: options.emissiveIntensity ?? 1,
      side: options.side ?? THREE.FrontSide,
      flatShading: options.flatShading ?? false,
      dithering: true,
    });
    material.name = options.name || "vm";

    const detail = options.detail ?? 1;
    const wearAmount = options.wear ?? 0;
    const wearColour = new THREE.Color(options.wearColour ?? 0xa9a49a);
    const scale = options.scale ?? 62;
    // Deliberately small. At full ADS the receiver is 400px wide for
    // 50mm of object, so the grain lands at two or three pixels a cell
    // - the exact frequency where a strong perturbation reads as
    // gravel rather than as machined steel. The job of these numbers is
    // to break the specular band, not to be seen.
    const roughVary = options.roughVary ?? 0.30;
    const normalStrength = options.normalStrength ?? 1.0;
    /** Streak depth of the machining lay in the roughness channel. This
     *  is the anisotropic highlight: real anisotropy wants a tangent
     *  frame and MeshPhysicalMaterial, and a roughness field that is
     *  high-frequency across the lay and near-constant along it smears
     *  the specular in one direction for the cost of a lookup. */
    const layAmount = options.lay ?? 0.22;
    /** Grime in the low ground of the macro mottle. Dielectric, matte,
     *  and it is what puts dirt in the crevices rather than an even
     *  wash over the part. */
    const grime = options.grime ?? 0.30;
    const grimeColour = new THREE.Color(options.grimeColour ?? 0x2a251c);
    const aoAmount = options.ao ?? 1.0;
    /* Bump amplitude, in METRES, derived from the target slope.
     *
     * The perturbation below differentiates the height against
     * view-space position, so the height has to be a real depth. The
     * catch is that the SLOPE it produces is amplitude x spatial
     * frequency, and the frequency here is the noise lattice (64 cells
     * a tile) times the tiling rate - about 220 x scale cycles per
     * metre. Writing a depth by hand therefore means guessing across
     * four orders of magnitude, and guessing high turns the shading
     * normal into noise: the weapon comes out looking like wet gravel,
     * which is exactly what the first attempt at this did. Solving for
     * the slope instead makes the knob mean something. 0.2 is a
     * machined finish; 0.5 is fabric.
     *
     * Divided by MESO because the height is now read from the meso tap,
     * not the fine one - half the spatial frequency needs twice the
     * amplitude for the same slope, and the point of solving rather
     * than authoring is that the knob survives exactly this kind of
     * change. */
    const bumpAmp = (options.slope ?? 0.28) / (221 * scale * MESO_RATE);

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uDetail = { value: surfaceTexture };
      shader.uniforms.uDetailAmount = { value: detail };
      shader.uniforms.uDetailScale = { value: scale };
      shader.uniforms.uRoughVary = { value: roughVary };
      shader.uniforms.uLay = { value: layAmount };
      shader.uniforms.uGrime = { value: grime };
      shader.uniforms.uGrimeColour = { value: grimeColour };
      shader.uniforms.uNormalStrength = { value: normalStrength };
      shader.uniforms.uBumpAmp = { value: bumpAmp };
      shader.uniforms.uWear = { value: wearAmount };
      shader.uniforms.uWearColour = { value: wearColour };
      shader.uniforms.uAO = { value: aoAmount };
      // Shared by reference - see the note on `tone`.
      shader.uniforms.uEv = tone.uEv;
      shader.uniforms.uLogSlope = tone.uLogSlope;
      shader.uniforms.uLookSlope = tone.uLookSlope;
      shader.uniforms.uLookOffset = tone.uLookOffset;
      shader.uniforms.uLookPower = tone.uLookPower;
      shader.uniforms.uLookSat = tone.uLookSat;
      shader.uniforms.uShadowLift = tone.uShadowLift;
      shader.uniforms.uMeterTex = tone.uMeterTex;
      shader.uniforms.uMeterKey = tone.uMeterKey;
      shader.uniforms.uMeterRange = tone.uMeterRange;

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `
          #include <common>
          attribute float aEdge;
          attribute float aWear;
          attribute float aOcc;
          varying vec3 vObjPos;
          varying vec3 vObjNormal;
          varying float vEdge;
          varying float vWear;
          varying float vOcc;
        `)
        .replace("#include <beginnormal_vertex>", `
          #include <beginnormal_vertex>
          vObjNormal = objectNormal;
        `)
        .replace("#include <begin_vertex>", `
          #include <begin_vertex>
          vObjPos = transformed;
          vEdge = aEdge;
          vWear = aWear;
          vOcc = aOcc;
        `);

      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `
          #include <common>
          uniform sampler2D uDetail;
          uniform float uDetailAmount;
          uniform float uDetailScale;
          uniform float uRoughVary;
          uniform float uLay;
          uniform float uGrime;
          uniform vec3 uGrimeColour;
          uniform float uNormalStrength;
          uniform float uBumpAmp;
          uniform float uWear;
          uniform vec3 uWearColour;
          uniform float uAO;
          uniform float uEv;
          uniform float uLogSlope;
          uniform float uLookSlope;
          uniform float uLookOffset;
          uniform float uLookPower;
          uniform float uLookSat;
          uniform float uShadowLift;
          uniform sampler2D uMeterTex;
          uniform float uMeterKey;
          uniform vec2 uMeterRange;
          varying vec3 vObjPos;
          varying vec3 vObjNormal;
          varying float vEdge;
          varying float vWear;
          varying float vOcc;
${TONE_GLSL}
          vec3 bsTriW() {
            vec3 w = pow(abs(normalize(vObjNormal)), vec3(4.0));
            return w / max(w.x + w.y + w.z, 1e-4);
          }
          /**
           * Triplanar tap at an arbitrary rate.
           *
           * The projections are NOT the textbook zy/xz/xy. The texture's
           * R channel is a 24:1 anisotropic lattice whose long axis is
           * U, and on a rifle the machining lay runs along the bore -
           * which is object Z. Feeding the top face p.xz would run its
           * lay across the receiver instead of along it, so the y-plane
           * takes p.zx. End caps get p.xy and a radial-ish lay, which is
           * right anyway: those faces are turned or faced, not broached.
           */
          vec4 bsTri(vec3 w, float rate) {
            vec3 p = vObjPos * (uDetailScale * rate);
            return texture2D(uDetail, p.zy) * w.x
                 + texture2D(uDetail, p.zx) * w.y
                 + texture2D(uDetail, p.xy) * w.z;
          }
        `)
        .replace("#include <map_fragment>", `
          #include <map_fragment>
          /* Two rates, because a micro-surface that lives at one
           * frequency cannot survive being seen from 25cm AND being
           * mipped. The fine tap alone was the whole surface before
           * this, at 0.17mm a cell - two screen pixels at ADS, which
           * the mip chain averages to flat grey. That is the literal
           * mechanism behind "aluminium reads as unfired clay": the
           * detail was there in the texture and gone by the time it
           * reached the screen.
           *
           *   macro  ~8mm  mottle and grime - the octave that survives
           *   meso   ~0.3mm across the lay - the streak that breaks the
           *          specular band, plus the bump height           */
          vec3 bsW = bsTriW();
          vec4 bsMacro = bsTri(bsW, ${MACRO_RATE.toFixed(3)});
          vec4 bsMeso = bsTri(bsW, ${MESO_RATE.toFixed(3)});
          float bsMot = bsMacro.g;
          float bsLayN = bsMeso.r;
          float bsBreak = bsMeso.a;
          /* The middle octave, and it costs nothing because the tap it
           * comes from already happened.
           *
           * Both existing taps were being read for one channel each,
           * and the two channels they were read for sit at OPPOSITE
           * ends of the frequency range: the mottle lands near 5mm and
           * the lay near 0.3mm. At the distance a view model is
           * actually seen from - a 1142px frame at ~70 degrees puts a
           * pixel at roughly 0.5mm on a part 40cm away - 5mm is ten
           * pixels and 0.3mm is under Nyquist and mips to flat. So the
           * surface had a slow blotch, a grain that had already been
           * averaged away, and NOTHING in the 1-3mm band that a pixel
           * lands on. That is the whole of "flat pale tan with no
           * surface texture": the detail existed, at two frequencies
           * neither of which survives to the screen.
           *
           * bsMeso.g is the same 15-cell mottle lattice sampled at the
           * meso rate, which puts it at ~2mm. One swizzle, no extra
           * fetch, and it is the octave that reads. */
          float bsMid = bsMeso.g;
          // Grime is the macro pit field gated by the meso one, so it
          // lands as discrete deposits rather than an even veil, and
          // it is pushed into the low ground of the mottle and into
          // whatever the AO bake says is a crevice.
          float bsDirt = clamp(bsMacro.b * (0.35 + bsMeso.b * 1.5)
            * (0.55 + vOcc * 1.30) * uGrime, 0.0, 1.0);

          /* Wear mask, from two very different sources.
           *
           * vEdge is a chamfer facet - a 0.5mm cut face that is a
           * sliver of the part's area, so it can take the full term.
           * vWear covers a WHOLE part, and running it at the same
           * strength turned the rail and the receiver into snow on the
           * first attempt. What makes a rubbed part read as rubbed is
           * that the finish survives in the low ground: the threshold
           * on the mottle is the whole effect, not the amplitude. */
          float bsEdgeW = vEdge * vEdge;
          float bsFaceW = vWear * smoothstep(0.63, 0.97, bsMot);
          float bsWear = clamp(uWear * max(bsEdgeW, bsFaceW * 0.6)
            * (0.22 + bsMot * 0.85), 0.0, 1.0);

          // Albedo: macro mottle first (this is the one that reads),
          // a touch of lay on top, then grime, then bare metal.
          // Mean of the three noise terms is 0.5 each, so the constant
          // is chosen to keep the multiplier's mean at ~1.03 - the same
          // as before. This redistributes contrast across octaves; it
          // does not brighten the material.
          diffuseColor.rgb *= mix(1.0,
            0.80 + bsMot * 0.24 + bsMid * 0.16 + bsLayN * 0.06, uDetailAmount);
          diffuseColor.rgb = mix(diffuseColor.rgb, uGrimeColour, bsDirt * 0.75);
          diffuseColor.rgb = mix(diffuseColor.rgb, uWearColour, bsWear);
        `)
        .replace("#include <roughnessmap_fragment>", `
          float roughnessFactor = roughness;
          #ifdef USE_ROUGHNESSMAP
            roughnessFactor *= texture2D( roughnessMap, vRoughnessMapUv ).g;
          #endif
          // One roughness value across a whole receiver is what produces
          // a single hard specular band. Breaking it up is most of what
          // makes the metal read as metal.
          // Split between the two mottle octaves rather than all on the
          // coarse one. The weights sum to uRoughVary so the mean is
          // unchanged - this only puts some of the specular breakup at
          // a frequency that survives to the screen.
          roughnessFactor = clamp(
            roughnessFactor * (1.0 - uRoughVary * 0.5
              + bsMot * uRoughVary * 0.6 + bsMid * uRoughVary * 0.4), 0.03, 1.0);
          // The lay: signed, so it cuts as well as adds, and applied to
          // roughness rather than to the normal. A field that is high
          // frequency ACROSS the grooves and near-constant along them
          // stretches the highlight along the lay, which is what an
          // anisotropic surface does and what the flat grey receiver
          // was missing.
          roughnessFactor = clamp(roughnessFactor + (bsLayN - 0.5) * uLay, 0.03, 1.0);
          /* Chamfers are rougher than the faces they cut.
           *
           * A chamfer is a fast secondary machining pass and it is
           * measurably rougher than the broached or anodised face
           * beside it - but the reason this line is here is what it
           * fixes. Every 1mm chamfer facet on the weapon points up and
           * out, so all of them caught the same tight reflection of the
           * same blue sky probe at the same value, and the rifle came
           * back edged in flat saturated cyan bands that read as paint
           * rather than as light. Spreading that reflection over a
           * wider lobe is the physical fix and it costs one clamp. */
          roughnessFactor = clamp(roughnessFactor + vEdge * 0.16, 0.03, 1.0);
          // Dirt is matte and it is never a mirror; polished wear is.
          roughnessFactor = mix(roughnessFactor, 0.92, bsDirt * 0.65);
          roughnessFactor = mix(roughnessFactor, 0.27, bsWear);
        `)
        .replace("#include <metalnessmap_fragment>", `
          #include <metalnessmap_fragment>
          // Grime is a dielectric sitting ON the finish, so it hides
          // whatever the part underneath is; polished wear is bare metal.
          metalnessFactor = mix(metalnessFactor, 0.0, bsDirt * 0.8);
          metalnessFactor = mix(metalnessFactor, 1.0, bsWear);
        `)
        .replace("#include <aomap_fragment>", `
          #include <aomap_fragment>
          /* Baked contact occlusion.
           *
           * "The optic body meets the mount block with no crease
           * darkening, so it floats off the rail" is not a lighting
           * fault - it is that nothing in this scene is small enough to
           * shadow a 1mm junction. vOcc is baked at load from the
           * neighbouring parts' own boxes (see bakeOcclusion), so every
           * seam on the weapon gets the dark line it should have.
           *
           * Indirect takes the full term because that is what occlusion
           * physically is. Direct takes a fraction of it anyway: the
           * view-scene shadow map is 1024 texels over a 90cm box, so
           * ~1mm features are below its resolution and it cannot draw
           * these creases however correct it is. */
          float bsAO = mix(1.0, 1.0 - vOcc, uAO);
          reflectedLight.indirectDiffuse *= bsAO;
          reflectedLight.indirectSpecular *= mix(1.0, bsAO, 0.95);
          reflectedLight.directDiffuse *= mix(1.0, bsAO, 0.48);
          /* Specular takes nearly as much as diffuse, which is not the
           * textbook weighting and is the right one here.
           *
           * The textbook version - occlude indirect, leave direct to
           * the shadow map - was the first attempt, and it left the
           * optic's ocular bezel pale white while sitting fully inside
           * a rubber eyecup that the bake had correctly marked at 0.92
           * occluded. On a metalness-0.78 surface essentially all of
           * the reflected light IS specular, so preserving 70% of it
           * preserves 70% of the material and the occlusion does
           * nothing on exactly the parts the art director complained
           * about. There is no shadow map that could pick this up: the
           * view scene's is 1024 texels over 90cm. */
          reflectedLight.directSpecular *= mix(1.0, bsAO, 0.52);
        `)
        .replace("#include <tonemapping_fragment>", `
          // The view scene is drawn straight to the canvas, outside the
          // post chain, so renderer.toneMapping is NoToneMapping and
          // nothing else would map this. Without it every specular
          // highlight on the weapon clips flat at 255 - measured 1.6%
          // of the aluminium's pixels - and a clipped highlight carries
          // neither shape nor colour, which is what "one hard specular
          // band" and "unfired clay" actually describe.
          gl_FragColor.rgb = bsTone(gl_FragColor.rgb);
        `)
        .replace("#include <normal_fragment_maps>", `
          #include <normal_fragment_maps>
          if (uDetailAmount > 0.001) {
            // Derivative bump, not a tangent-space normal map.
            //
            // A normal map needs a tangent frame, and a tangent frame
            // needs UVs. This geometry has none worth the name (see the
            // note on the detail texture). Perturbing the view-space
            // normal by the screen-space gradient of a height field
            // needs neither: vViewPosition and the already-shaded
            // normal are enough, and it stays correct through every
            // rotation the weapon animation applies.
            // The height has to be in METRES, the same units as the
            // view positions it is differentiated against. Feeding a
            // 0..1 texture value in directly makes the gradient term
            // some six orders of magnitude larger than abs(det)*normal,
            // which replaces the shading normal with noise - the whole
            // weapon comes out looking like wet gravel. uBumpAmp is the
            // physical depth of the grain, and because the ratio of the
            // two terms works out to amplitude x spatial frequency it
            // is independent of screen size and viewing distance.
            /* Two height octaves, not one.
             *
             * uBumpAmp solves amplitude from a target SLOPE, and slope
             * is amplitude x spatial frequency - so a second octave at
             * 2.3x lower frequency (the macro rate, ~1.1mm on the grain
             * lattice) needs 2.3x the amplitude to carry the same
             * gradient. Taken at half strength, hence 1.15, so the fine
             * grain still dominates and this only fills the band that
             * mipping was eating. Centred on 0.5 so it adds relief
             * without shifting the surface off the geometry. */
            float bsH = (bsBreak + (bsMacro.a - 0.5) * 1.15) * uBumpAmp;
            vec3 bsPx = dFdx(-vViewPosition);
            vec3 bsPy = dFdy(-vViewPosition);
            vec3 bsR1 = cross(bsPy, normal);
            vec3 bsR2 = cross(normal, bsPx);
            float bsDet = dot(bsPx, bsR1);
            vec3 bsGrad = sign(bsDet) * (dFdx(bsH) * bsR1 + dFdy(bsH) * bsR2);
            normal = normalize(abs(bsDet) * normal
              - uNormalStrength * uDetailAmount * bsGrad);
          }
        `);
    };
    // One key for every gun material: the injected SOURCE is identical
    // and everything that varies between them is a uniform. Keying on
    // the values instead compiled a dozen byte-identical programs.
    material.customProgramCacheKey = () => "bs-vm-detail";
    ownedMaterials.push(material);
    return material;
  }

  /* ---------------------------- the palette ----------------------------
   *
   * The art director's charge was that every surface on this weapon is
   * the same flat mid-grey. The isolated-mesh readback agreed: parker
   * came back RGB(50,50,44), aluminium (56,58,52), polymer (43,42,39).
   * Three different manufacturing processes, one colour, and the only
   * thing separating them was two points of luma.
   *
   * So each finish here is separated on THREE axes at once, because any
   * one of them alone survives neither a still nor a change of light:
   *
   *   ALBEDO HUE. Parkerising is a manganese phosphate crystal - cool,
   *     faintly olive. Type III anodise on 7075 is visibly WARM and a
   *     shade lighter. Glass-filled nylon is a warm near-black. Nitride
   *     is blue-black. Those are the real colours and they are further
   *     apart than a neutral-grey reading of "gunmetal" admits.
   *   ROUGHNESS. 0.72 on the receiver against 0.38 on the optic housing
   *     is the difference between a broad dull sheen and a tight moving
   *     one, and it survives when the sun moves.
   *   METALNESS, which sets the shape of the specular lobe and whether
   *     the highlight is tinted by the surface or white.
   *
   * envMapIntensity is INERT on a material with no envMap of its own -
   * measured, a 12x sweep moves frame luma 0.14 - so these values do
   * nothing until update() assigns render.scene.environment onto each
   * material, which it does every time sky.js hands over a new probe.
   * That assignment is what makes the number below a real knob and it
   * is the only reason there is one.
   */

  // Parkerised (phosphate) steel: receiver, sights, small parts.
  //
  // metalness 0.22, not 0.85. Parkerising is a phosphate CONVERSION
  // COATING - a porous, oil-impregnated dielectric crystal layer over
  // the steel, not bare steel. Shading it as a metal is why the top of
  // the upper receiver came out as a bright plate: at the grazing angle
  // an ADS view sees it from, a metal that rough still throws a broad
  // sky reflection, and that plate is the largest flat area in the
  // aiming frame. It is not zero either - the layer is thin and the
  // steel under it still contributes.
  //
  // The albedo ladder across the four finishes is deliberate and it is
  // ordered by real diffuse reflectance, because the one thing a blind
  // reviewer has praised on any of our weapons is "wood/steel
  // separation". Linear albedo: anodise 0.045, phosphate 0.033,
  // polymer 0.026, black oxide 0.019, rubber 0.017 - a 2.6x spread with
  // a different hue on each rung, where before them all four sat within
  // 0.01 of each other at the same warm hue and separated only by two
  // points of luma.
  const parker = gunMaterial(0x30322b, {
    roughness: 0.72, metalness: 0.22, envMapIntensity: 0.42,
    wear: 0.70, wearColour: 0x8f8b80, lay: 0.26, grime: 0.42,
    roughVary: 0.34, name: "parker",
  });
  /* Blued/nitrided barrel steel - smoother than the receiver, so it
   * holds a highlight. Almost no grime: a barrel runs hot enough to
   * bake it off.
   *
   * metalness 0.25, not 1.0, and the argument is the one the parker
   * comment above already makes - this file made it for phosphate and
   * then did not carry it four lines down. Bluing is black oxide
   * (Fe3O4) and nitriding leaves a compound layer; both are CONVERSION
   * COATINGS, a ceramic skin grown out of the steel rather than the
   * steel itself. Shaded as bare metal the barrel has no diffuse at
   * all, its albedo becomes its specular F0, and the muzzle end of the
   * weapon renders as a picture of the sky.
   *
   * Measured on the action-firefight frame over the pixels that
   * actually read as blue - 2.7% of the weapon, 75% of them on this
   * material, 28% of this material's own pixels - with the pose and the
   * exposure meter frozen so only the material moves:
   *
   *     baseline                       luma 48.8  hue 211  sat 0.463
   *     envMapIntensity 0              luma 26.5  hue 219  sat 0.278
   *     albedo -> neutral grey         luma 49.3  hue 204  sat 0.360
   *     metalness 0.25 + dark albedo   luma 54.8  hue 205  sat 0.275
   *
   * Both halves of that are real, which is why neither "the tint
   * drifted" nor "it is all sky reflection" is the whole answer. The
   * probe supplies 46% of the value; kill it and the rest still arrives
   * blue, because a metal tints its own specular and the F0 here WAS
   * blue. The surface was simply the wrong class of material, and
   * fixing the class fixes both terms at once.
   *
   * The albedo keeps about five counts of blue in it. Black oxide is
   * genuinely faintly cool - that is where the name comes from - but it
   * is nowhere near the hue 220 / saturation 0.225 that was here, and
   * at 3% linear reflectance it is a near-black rather than a slate. */
  //
  // roughness 0.46, not 0.34. It stays the glossiest coating on the
  // weapon - that is the point of it, against the 0.72 receiver it
  // bolts into - but a barrel is a cylinder, so at any viewing angle
  // SOME band of it is at grazing incidence where Fresnel goes to one.
  // At 0.34 that band was a sharp mirror of the sky running the whole
  // length of the barrel, and with the rest of the weapon corrected
  // down it became the only saturated thing left in an entirely warm
  // frame. Real blued steel does show a sky band; it shows a soft one.
  const blued = gunMaterial(0x282a2d, {
    roughness: 0.46, metalness: 0.25, envMapIntensity: 0.38,
    wear: 0.55, wearColour: 0x9d9a94, roughVary: 0.20, lay: 0.30,
    grime: 0.12, name: "blued",
  });
  // Reinforced polymer: receiver furniture, grips, magazines. Fibre-
  // filled nylon is faintly speckled, never a uniform slab, and its
  // highlight is a small white dielectric sheen rather than a tinted
  // metal one - which is the cue that separates it from the aluminium
  // beside it far more reliably than its value does.
  const polymer = gunMaterial(0x2b2823, {
    roughness: 0.86, metalness: 0.0, envMapIntensity: 0.42,
    wear: 0.28, wearColour: 0x5c5d5e, detail: 1.25, scale: 78, slope: 0.34,
    lay: 0.06, grime: 0.34, roughVary: 0.22, name: "polymer",
  });
  // Rubber overmould: eyecup, butt pad, grip panels. Nothing else on
  // the weapon is this matte, and having one genuinely matte material
  // is what gives the eye a floor to judge the others against.
  // DoubleSide, because the eyecup is the one part here that is a
  // genuinely thin shell. tubeOpen() + FrontSide draws only the far
  // wall of a cylinder, so the eyecup rendered as a black crescent -
  // half a ring - and the ADS frame showed the aluminium ocular
  // through the missing half. Everything else on this material is a
  // closed solid, where the back faces are depth-tested away and cost
  // nothing.
  const rubber = gunMaterial(0x242524, {
    side: THREE.DoubleSide,
    roughness: 0.97, metalness: 0.0, envMapIntensity: 0.26,
    wear: 0.10, wearColour: 0x3a3a38, detail: 1.5, scale: 150, slope: 0.55,
    // Moulded rubber has no machining lay and no polish - a streak in
    // the roughness here would read as a smear.
    lay: 0.0, roughVary: 0.12, grime: 0.30, name: "rubber",
  });
  /* Hard-anodised aluminium: rails, handguards, optic bodies, mounts.
   * This is the material with the most screen area on the weapon, so
   * whatever is wrong with it is most of what the weapon looks like.
   *
   * Two things were, and they compounded.
   *
   * metalness 0.20, not 0.78. Type III anodise is 25-50um of aluminium
   * OXIDE - a dyed ceramic, grown by converting the metal, exactly like
   * the phosphate above and the black oxide below. Only bare rubbed
   * metal on this weapon is a metal, and that material already exists
   * (`wear`). At 0.78 the largest flat areas on the gun were mirrors
   * with a dark tinted F0, which is the recipe for a pale slab that
   * changes value when the player turns and never looks like a part.
   *
   * And the albedo was hue 34 at saturation 0.28 - which is the hue and
   * very nearly the saturation of the desert behind it. A rifle
   * finished in the same colour as the ground it is carried over cannot
   * separate from it at any exposure, and no grade change will make it.
   * Anodise in this colour family is a dark warm grey, not sand.
   *
   * Measured over the weapon's own pixels in action-firefight (masked
   * by rendering the view scene alone over a key colour, so no ground
   * is included), pose and meter frozen:
   *
   *     baseline                     luma 71.8  sat 0.389  dark% 0.98
   *     metalness 0.20 + dark albedo luma 64.9  sat 0.317  dark% 1.72
   *
   * envMapIntensity comes down with it. That knob is live here only
   * because update() assigns render.scene.environment onto each of
   * these materials - see the note above - and on this one the probe
   * was worth 14% of the whole weapon's value. */
  const alum = gunMaterial(0x3c3830, {
    roughness: 0.47, metalness: 0.20, envMapIntensity: 0.28,
    wear: 0.82, wearColour: 0x9c988c, lay: 0.30, grime: 0.36,
    roughVary: 0.40, name: "alum",
  });
  // Wear on edges - bare metal showing through the finish.
  const wear = gunMaterial(0x8d8a83, {
    roughness: 0.26, metalness: 1.0, envMapIntensity: 0.55,
    lay: 0.24, grime: 0.15, name: "wear",
  });
  // Laminated birch for the AK, walnut for the M24.
  const woodRed = gunMaterial(0x64401f, {
    roughness: 0.52, metalness: 0.0, envMapIntensity: 0.48,
    detail: 1.3, scale: 40, slope: 0.3, wear: 0.5, wearColour: 0x8a6234,
    // Wood grain IS a lay, and a strong one - it is the same
    // anisotropic field, just at a much coarser rate.
    lay: 0.34, grime: 0.30, name: "woodRed",
  });
  const woodDark = gunMaterial(0x3d281b, {
    roughness: 0.58, metalness: 0.0, envMapIntensity: 0.48,
    detail: 1.3, scale: 40, slope: 0.3, lay: 0.34, grime: 0.30, name: "woodDark",
  });
  const brass = gunMaterial(0xb5893c, {
    roughness: 0.24, metalness: 1.0, envMapIntensity: 1.15,
    lay: 0.18, grime: 0.10, name: "brass",
  });
  // Lens glass has to be TRANSPARENT, and the tube it sits in has to be
  // open-ended. Modelled as solid discs in capped tubes, an optic is an
  // opaque plug: the player aims down a sight and sees a dark disc, and
  // the bug is invisible in any screenshot that is not taken at full ADS.
  //
  // The tint is the giveaway on a real optic: multi-coated glass is a
  // dark blue-green in reflection and passes warm. Detail is off - a
  // lens with machining grain on it is not a lens.
  // Opacity 0.62, not 0.46. A real optic loses light and a shooter
  // sees it: the sight picture is a visibly DARKER, cooler rectangle
  // than the world around the tube. At 0.46 the glass was a faint wash
  // and the tube read as an open hole with a smear over it, which is
  // also why the reticle had nothing to sit against. The emissive term
  // that used to be here is gone - it made the glass self-luminous from
  // every angle, which is the one thing glass never does.
  // metalness 0.05, not 0.30. Glass is a dielectric, and a dielectric
  // at roughness 0.02 gives exactly the response an optic has: nearly
  // clear looking straight down the tube, a hard sky reflection as soon
  // as the objective is off-axis. At 0.30 the whole front element was a
  // mirror at every angle and the sight picture came out brighter than
  // the desert around the tube.
  const lens = gunMaterial(0x0b1f28, {
    roughness: 0.02, metalness: 0.05,
    transparent: true, opacity: 0.62,
    envMapIntensity: 1.0, detail: 0, roughVary: 0, wear: 0,
    lay: 0, grime: 0, ao: 0, name: "lens",
  });
  /**
   * The coating flare.
   *
   * A flat additive disc - which is what this was - adds the same
   * amount everywhere and reads as fog inside the tube. A real coated
   * objective is nearly clear through the middle and throws its sheen
   * at the rim, where the ray angle through the coating stack is
   * steepest. The gradient below is that: transparent at the centre,
   * a bright violet-cyan annulus at ~80% radius, gone by the edge.
   */
  function buildCoatTexture(size = 128) {
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const g = canvas.getContext("2d");
    const gradient = g.createRadialGradient(
      size / 2, size / 2, 0, size / 2, size / 2, size / 2
    );
    gradient.addColorStop(0.00, "rgba(90,150,205,0.10)");
    gradient.addColorStop(0.45, "rgba(70,120,180,0.14)");
    gradient.addColorStop(0.78, "rgba(150,160,235,0.62)");
    gradient.addColorStop(0.93, "rgba(96,190,205,0.34)");
    gradient.addColorStop(1.00, "rgba(0,0,0,0)");
    g.fillStyle = gradient;
    g.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
  const coatTexture = buildCoatTexture();
  const lensCoat = new THREE.MeshBasicMaterial({
    map: coatTexture, color: 0xffffff,
    transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
    toneMapped: false, side: THREE.FrontSide,
  });

  /**
   * The reticle, and why it is not additive.
   *
   * It was `materials.additive(0xff4422)`, and additive over a sunlit
   * desert is the one background where that fails completely: sand
   * arrives near RGB(200,180,150), so adding a red dot to it lands at
   * (255,222,168) - a slightly warm white, clipped, indistinguishable
   * from the sand behind it. Measured through the probe, the reticle
   * rect read RGB(73,76,70) against a tube of (63.8) - a difference of
   * eleven counts, on a part whose entire job is to be unmissable.
   *
   * A real red dot is a collimated source seen against the target, and
   * it OCCLUDES. So the core is opaque and saturated, which reads on
   * sand, on sky and on shadow alike, and the bloom around it is the
   * additive part - which is what additive is actually good at.
   *
   * depthTest stays ON. Turning it off does make the dot always
   * visible - including straight through the aluminium housing from
   * outside the tube, which is what the first attempt did. The dot has
   * to be occluded by the optic body; it must not be occluded by the
   * glass, and it is not, because the glass writes no depth.
   */
  const reticleMat = new THREE.MeshBasicMaterial({
    color: 0xff1c0a, transparent: true, opacity: 0.96,
    depthWrite: false,
    toneMapped: false, side: THREE.DoubleSide,
  });
  /** The bloom around the dot. A flat additive disc reads as a pink
   *  coin with a hard rim, which is what the first pass produced; a
   *  radial falloff is what an out-of-focus point source actually looks
   *  like, and it is one small canvas. */
  function buildGlowTexture(size = 64) {
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const g = canvas.getContext("2d");
    const gradient = g.createRadialGradient(
      size / 2, size / 2, 0, size / 2, size / 2, size / 2
    );
    gradient.addColorStop(0.00, "rgba(255,255,255,1)");
    gradient.addColorStop(0.16, "rgba(255,200,180,0.72)");
    gradient.addColorStop(0.42, "rgba(255,90,50,0.26)");
    gradient.addColorStop(0.72, "rgba(255,40,20,0.07)");
    gradient.addColorStop(1.00, "rgba(255,0,0,0)");
    g.fillStyle = gradient;
    g.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
  const glowTexture = buildGlowTexture();
  const reticleGlow = new THREE.MeshBasicMaterial({
    map: glowTexture, color: 0xff5030,
    transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
    toneMapped: false, side: THREE.DoubleSide,
  });
  // Desert gloves. Skin tones on blocky hands read as raw meat; gloves
  // are both more plausible for the setting and much more forgiving.
  const glove = gunMaterial(0x605645, {
    roughness: 0.94, metalness: 0.0, envMapIntensity: 0.36,
    detail: 1.5, scale: 120, slope: 0.55, lay: 0.10, grime: 0.40,
    wear: 0.22, wearColour: 0x7a6f5b, name: "glove",
  });
  const gloveDark = gunMaterial(0x37342d, {
    roughness: 0.88, metalness: 0.02, envMapIntensity: 0.36,
    detail: 1.4, scale: 120, slope: 0.5, lay: 0.10, grime: 0.36, name: "gloveDark",
  });
  const sleeve = gunMaterial(0x736a4d, {
    roughness: 0.97, metalness: 0.0, envMapIntensity: 0.30,
    detail: 1.6, scale: 150, slope: 0.62, lay: 0.06, grime: 0.45, name: "sleeve",
  });

  /* ------------------------- geometry helpers ------------------------- */

  const _m4 = new THREE.Matrix4();
  const _quat = new THREE.Quaternion();
  const _euler = new THREE.Euler();
  const _v3 = new THREE.Vector3();
  const _v3b = new THREE.Vector3();
  const _one = new THREE.Vector3(1, 1, 1);

  /**
   * Concatenate transformed geometries into one buffer.
   *
   * Three ships BufferGeometryUtils.mergeGeometries in the addons
   * bundle, but pulling that in costs another CDN request on the
   * critical path for what is, here, three typed-array copies. Merging
   * per material is the whole reason the weapon can afford this much
   * detail: sixty parts, six draw calls.
   */
  function mergeInto(parts) {
    const flat = [];
    let total = 0;
    for (const part of parts) {
      const source = part.geometry;
      const geometry = source.index ? source.toNonIndexed() : source;
      if (geometry !== source) source.dispose();
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      flat.push({ geometry, part });
      total += geometry.attributes.position.count;
    }
    const position = new Float32Array(total * 3);
    const normal = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    // Chamfer flag. Zero for anything that did not come out of
    // extrude() - a cylinder has no machined cut face to wear through.
    const edge = new Float32Array(total);
    // Hand-placed wear, per part. The chamfer flag alone dusts every
    // cut face on the weapon equally, which is "someone applied a
    // grunge layer"; a rifle wears at the places a hand and a sling
    // touch it, and those are named at the call sites.
    const wearAttr = new Float32Array(total);
    // Contact occlusion, filled in below by bakeOcclusion.
    const occ = new Float32Array(total);
    let offset = 0;
    for (const { geometry, part } of flat) {
      const count = geometry.attributes.position.count;
      position.set(geometry.attributes.position.array, offset * 3);
      normal.set(geometry.attributes.normal.array, offset * 3);
      if (geometry.attributes.uv) uv.set(geometry.attributes.uv.array, offset * 2);
      if (geometry.attributes.aEdge) edge.set(geometry.attributes.aEdge.array, offset);
      if (part.wear) wearAttr.fill(part.wear, offset, offset + count);
      part.range = [offset, count];
      offset += count;
      geometry.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(position, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    out.setAttribute("aEdge", new THREE.BufferAttribute(edge, 1));
    out.setAttribute("aWear", new THREE.BufferAttribute(wearAttr, 1));
    out.setAttribute("aOcc", new THREE.BufferAttribute(occ, 1));
    out.computeBoundingSphere();
    // The occlusion bake needs the vertices AFTER the merge - the
    // per-part geometries are disposed above - and it has to see every
    // material at once, because the seam that matters most is aluminium
    // against steel.
    for (const { part } of flat) part.merged = out;
    return out;
  }

  /* ------------------------ contact occlusion ------------------------
   *
   * "The optic body meets the mount block with no crease darkening, so
   * it floats off the rail." That is not fixable with light. The view
   * scene's shadow map is 1024 texels over a 90cm box - roughly 1mm a
   * texel - so a shadow map physically cannot draw the line where two
   * parts touch, and screen-space AO does not run on the view model at
   * all because it is composited outside the post chain.
   *
   * So it is baked, once, at load. Each part remembers the box it was
   * placed as; every vertex fires three short rays along its own normal
   * and asks how many of them end up inside a NEIGHBOURING part's box.
   * That is a crude AO integrator with three samples and no cosine
   * weighting, and for the thing it has to draw - a 2-4mm dark line in
   * every seam - it is indistinguishable from a good one.
   *
   * The neighbour list is what makes it affordable. Testing every
   * vertex against every part is 60-odd boxes and runs into hundreds of
   * milliseconds on the load path; parts whose expanded boxes do not
   * even overlap cannot occlude each other, so each part carries a list
   * of the handful that can and the inner loop stays at ~8.
   */

  /** How far out the rays reach, and what each contributes.
   *
   *  These were an order of magnitude too long on the first pass -
   *  2.2/5.5/13mm - and the measurement said so before the picture did:
   *  mean occlusion 0.341 over 47.5% of the weapon's vertices. On a
   *  rifle whose individual parts are 5-15mm across, a 13mm probe from
   *  almost any vertex lands inside SOMETHING, so the term stopped
   *  being a joint line and became a uniform 20% dimming - which is the
   *  one shape of error that is invisible in a screenshot and obvious
   *  in a mean.
   *
   *  A weapon has no cavities at this scale. It has joints, and a joint
   *  is 1-3mm wide. The power curve below then keeps the partial hits
   *  low so a single ray landing at 7mm barely registers. */
  const OCC_RADII = [0.0011, 0.0028, 0.0064];
  const OCC_WEIGHTS = [0.52, 0.31, 0.17];
  const OCC_CURVE = 1.45;
  /** Peak darkening.
   *
   *  0.92 was measured as too much, and the useful signal was that the
   *  mean stayed at 0.386 over 47.6% of vertices however short the rays
   *  got. That is not a tuning failure, it is what this model IS: sixty
   *  overlapping primitives, so half the vertices genuinely are inside
   *  a neighbour. Most of those are interior and invisible; the ones
   *  that are not want a seam line, not a shroud. Capping the term is
   *  the right lever - it leaves the joints dark and stops the bake
   *  from behaving like a second, worse ambient occlusion pass over
   *  the whole weapon. */
  const OCC_MAX = 0.66;
  /** Reported, because a load-path cost that nobody measures is how a
   *  loading screen gets a second longer one commit at a time. */
  const occStat = { parts: 0, vertices: 0, ms: 0, sum: 0, max: 0, shaded: 0 };

  function bakeOcclusion(parts) {
    const t0 = performance.now();
    const live = parts.filter((p) => p.merged);
    // Expanded world AABBs, for neighbour selection and a cheap reject.
    const reach = OCC_RADII[OCC_RADII.length - 1];
    for (const part of live) {
      const b = part.bounds;
      part.lo = [b.min.x - reach, b.min.y - reach, b.min.z - reach];
      part.hi = [b.max.x + reach, b.max.y + reach, b.max.z + reach];
    }
    for (const part of live) {
      part.neighbours = [];
      for (const other of live) {
        if (other === part || !other.occludes) continue;
        if (part.lo[0] > other.hi[0] || part.hi[0] < other.lo[0]) continue;
        if (part.lo[1] > other.hi[1] || part.hi[1] < other.lo[1]) continue;
        if (part.lo[2] > other.hi[2] || part.hi[2] < other.lo[2]) continue;
        part.neighbours.push(other);
      }
    }
    for (const part of live) {
      const { merged, range, neighbours } = part;
      if (!neighbours.length) continue;
      const [start, count] = range;
      const pos = merged.attributes.position.array;
      const nrm = merged.attributes.normal.array;
      const occ = merged.attributes.aOcc.array;
      for (let v = 0; v < count; v += 1) {
        const i = (start + v) * 3;
        const px = pos[i]; const py = pos[i + 1]; const pz = pos[i + 2];
        const nx = nrm[i]; const ny = nrm[i + 1]; const nz = nrm[i + 2];
        let sum = 0;
        for (let s = 0; s < OCC_RADII.length; s += 1) {
          const r = OCC_RADII[s];
          const qx = px + nx * r; const qy = py + ny * r; const qz = pz + nz * r;
          for (let k = 0; k < neighbours.length; k += 1) {
            const other = neighbours[k];
            if (qx < other.lo[0] || qx > other.hi[0]) continue;
            if (qy < other.lo[1] || qy > other.hi[1]) continue;
            if (qz < other.lo[2] || qz > other.hi[2]) continue;
            // Exact against the part's own oriented box: the world AABB
            // of a part rotated 30 degrees is half again too big, and
            // using it here smears the seam across the whole face.
            const m = other.inv;
            const lx = m[0] * qx + m[4] * qy + m[8] * qz + m[12];
            if (lx < other.half[0] && lx > -other.half[0]) {
              const ly = m[1] * qx + m[5] * qy + m[9] * qz + m[13];
              if (ly < other.half[1] && ly > -other.half[1]) {
                const lz = m[2] * qx + m[6] * qy + m[10] * qz + m[14];
                if (lz < other.half[2] && lz > -other.half[2]) {
                  sum += OCC_WEIGHTS[s];
                  break;
                }
              }
            }
          }
        }
        const value = Math.pow(Math.min(1, sum), OCC_CURVE) * OCC_MAX;
        occ[start + v] = value;
        occStat.sum += value;
        if (value > occStat.max) occStat.max = value;
        if (value > 0.05) occStat.shaded += 1;
      }
      occStat.vertices += count;
    }
    occStat.ms += performance.now() - t0;
  }

  /**
   * Extrude a convex 2D profile along Z, flat-shaded.
   *
   * Flat normals are deliberate: a chamfer only does its job if it is a
   * distinct facet with its own specular response. Smoothing the profile
   * turns the chamfer into a soft gradient and the part looks inflated.
   */
  function extrude(points, depth) {
    const n = points.length;
    const half = depth * 0.5;
    const tris = n * 2 + (n - 2) * 2;
    const position = new Float32Array(tris * 9);
    const normal = new Float32Array(tris * 9);
    const uv = new Float32Array(tris * 6);
    // 1 on the chamfer cut faces, 0 on the main faces and the caps.
    // These are the sub-millimetre facets that a carried weapon rubs
    // bare first, and marking them here is what lets the shader put the
    // wear exactly where a real one has it instead of dusting the whole
    // part with grunge.
    const edge = new Float32Array(tris * 3);
    let p = 0;
    let u = 0;
    let e = 0;

    const push = (x, y, z, nx, ny, nz, tu, tv, ed) => {
      position[p] = x; position[p + 1] = y; position[p + 2] = z;
      normal[p] = nx; normal[p + 1] = ny; normal[p + 2] = nz;
      p += 3;
      uv[u] = tu; uv[u + 1] = tv;
      u += 2;
      edge[e] = ed;
      e += 1;
    };

    // The longest side is the reference: anything under 45% of it is a
    // chamfer rather than a face. That ratio holds for every profile in
    // this file because chamfers are specified as a small absolute cut.
    let longest = 0;
    for (let i = 0; i < n; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % n];
      longest = Math.max(longest, Math.hypot(b[0] - a[0], b[1] - a[1]));
    }

    // Sides. Outward normal of a CCW edge (p0 -> p1) is (dy, -dx).
    for (let i = 0; i < n; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % n];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = dy / len;
      const ny = -dx / len;
      const ed = len < longest * 0.45 ? 1 : 0;
      push(a[0], a[1], half, nx, ny, 0, 0, 0, ed);
      push(a[0], a[1], -half, nx, ny, 0, 0, 1, ed);
      push(b[0], b[1], -half, nx, ny, 0, 1, 1, ed);
      push(a[0], a[1], half, nx, ny, 0, 0, 0, ed);
      push(b[0], b[1], -half, nx, ny, 0, 1, 1, ed);
      push(b[0], b[1], half, nx, ny, 0, 1, 0, ed);
    }
    // Caps, fanned from the first vertex (profiles here are convex).
    for (let i = 1; i < n - 1; i += 1) {
      push(points[0][0], points[0][1], half, 0, 0, 1, 0, 0, 0);
      push(points[i][0], points[i][1], half, 0, 0, 1, 0, 0, 0);
      push(points[i + 1][0], points[i + 1][1], half, 0, 0, 1, 0, 0, 0);
      push(points[0][0], points[0][1], -half, 0, 0, -1, 0, 0, 0);
      push(points[i + 1][0], points[i + 1][1], -half, 0, 0, -1, 0, 0, 0);
      push(points[i][0], points[i][1], -half, 0, 0, -1, 0, 0, 0);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geometry.setAttribute("aEdge", new THREE.BufferAttribute(edge, 1));
    return geometry;
  }

  /** Rectangle with its four corners cut - the cross-section of nearly
   *  every structural part of a firearm. */
  function chamferRect(w, h, c) {
    const x = w * 0.5;
    const y = h * 0.5;
    const cut = Math.min(c, Math.min(x, y) * 0.8);
    return [
      [-x + cut, -y], [x - cut, -y], [x, -y + cut], [x, y - cut],
      [x - cut, y], [-x + cut, y], [-x, y - cut], [-x, -y + cut],
    ];
  }

  /** Trapezoidal cross-section, for stocks and grips that taper. */
  function taperRect(wTop, wBottom, h, c) {
    const y = h * 0.5;
    const xt = wTop * 0.5;
    const xb = wBottom * 0.5;
    const cut = Math.min(c, y * 0.6);
    return [
      [-xb + cut, -y], [xb - cut, -y], [xb, -y + cut], [xt, y - cut],
      [xt - cut, y], [-xt + cut, y], [-xt, y - cut], [-xb, -y + cut],
    ];
  }

  /* ------------------------------ builder ------------------------------ */

  /**
   * Accumulates primitives into named animated groups, merging by
   * material at the end. `group()` switches which sub-assembly
   * subsequent parts land in.
   */
  function makeBuilder() {
    const groups = new Map();
    const allParts = [];
    let current = "body";
    let currentWear = 0;
    let currentOccludes = true;

    function bucket(material) {
      if (!groups.has(current)) groups.set(current, new Map());
      const byMaterial = groups.get(current);
      if (!byMaterial.has(material)) byMaterial.set(material, []);
      return byMaterial.get(material);
    }

    const _box3 = new THREE.Box3();

    const api = {
      group(name) { current = name; return api; },

      /**
       * Wear multiplier for everything placed after this call.
       *
       * The chamfer flag `extrude()` writes covers "every machined edge
       * on the weapon", which is the right base layer and the wrong
       * whole story: a rifle is bright on the charging handle, the mag
       * release, the selector, the rail tops and the two places it
       * rests against a plate carrier, and untouched everywhere a hand
       * never goes. 0 is the default and means "chamfers only".
       */
      wearMark(amount) { currentWear = amount; return api; },

      /** Place a raw geometry. Rotation is XYZ order, in radians. */
      put(geometry, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
        // The occlusion bake tests points against each part's ORIENTED
        // box, so the half-extents have to be measured before the
        // placement matrix goes on and the matrix kept to undo it.
        geometry.computeBoundingBox();
        _box3.copy(geometry.boundingBox);
        const half = [
          Math.max(1e-5, (_box3.max.x - _box3.min.x) * 0.5),
          Math.max(1e-5, (_box3.max.y - _box3.min.y) * 0.5),
          Math.max(1e-5, (_box3.max.z - _box3.min.z) * 0.5),
        ];
        _euler.set(rx, ry, rz, "XYZ");
        _quat.setFromEuler(_euler);
        _m4.compose(_v3.set(x, y, z), _quat, _one);
        // Local boxes are only centred when the source primitive is,
        // which extrude() and every three primitive here are. Folding
        // the centre in keeps a stray off-centre geometry honest.
        _v3b.set(
          (_box3.max.x + _box3.min.x) * 0.5,
          (_box3.max.y + _box3.min.y) * 0.5,
          (_box3.max.z + _box3.min.z) * 0.5
        );
        const centred = new THREE.Matrix4().makeTranslation(_v3b.x, _v3b.y, _v3b.z);
        const inv = new THREE.Matrix4().multiplyMatrices(_m4, centred).invert();
        geometry.applyMatrix4(_m4);
        geometry.computeBoundingBox();
        const part = {
          geometry,
          bounds: geometry.boundingBox.clone(),
          inv: inv.elements,
          half,
          wear: currentWear,
          occludes: currentOccludes,
        };
        allParts.push(part);
        bucket(material).push(part);
        return api;
      },

      /** Chamfered box, long axis along Z. */
      box(material, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, chamfer = 0.004) {
        return api.put(extrude(chamferRect(w, h, chamfer), d), material, x, y, z, rx, ry, rz);
      },

      /** Chamfered box that tapers in width from top to bottom. */
      taper(material, wTop, wBottom, h, d, x, y, z, rx = 0, ry = 0, rz = 0, chamfer = 0.004) {
        return api.put(extrude(taperRect(wTop, wBottom, h, chamfer), d), material, x, y, z, rx, ry, rz);
      },

      /**
       * Radial segment count from the part's own radius.
       *
       * Every call site used the old flat default of 12 (rings 10), and
       * a blind art director measured the result: "the optic's outer
       * ring shows roughly 12-16 straight chords across ~200 screen
       * pixels". That is the correct count for a prop 30 metres away
       * and badly wrong for the one object that is permanently in the
       * lower third of frame at 25cm.
       *
       * Scaling with radius rather than picking one bigger number keeps
       * the cost where it is visible: a 3mm screw stays at 20 sides, a
       * 30mm optic bell goes to 42. The whole view model is a handful
       * of meshes drawn once into a separate scene, so even the top of
       * this range is free - the earlier value was not a performance
       * decision, it was a default nobody revisited.
       *
       * AND THIS WAS DEAD FOR A ROUND. Adding the helper changed the
       * DEFAULT, and all 65 tube/tubeOpen call sites in this file
       * passed an explicit count - 58 of them below what arc() returns,
       * most at the old flat 12. So the fix shipped, was written up as
       * "now derived from the part's radius", and every barrel, muzzle,
       * turret, pin and sling loop on all six weapons kept its
       * twelve-sided silhouette. The call sites now pass null.
       *
       * The general lesson is the same one this project keeps
       * relearning: a change to a default is not a change to anything
       * until you check what actually overrides it. An A/B on the
       * rendered image would have caught it in a minute; reading the
       * diff would not, and did not.
       */
      arc(radius) {
        return Math.max(20, Math.min(64, Math.round(radius * 1400)));
      },

      /** Cylinder along Z. */
      tube(material, rTop, rBottom, len, x, y, z, segments = null, rx = 0, ry = 0, rz = 0) {
        segments = segments ?? api.arc(Math.max(rTop, rBottom));
        const geometry = new THREE.CylinderGeometry(rTop, rBottom, len, segments, 1, false);
        geometry.rotateX(Math.PI / 2);
        return api.put(geometry, material, x, y, z, rx, ry, rz);
      },

      /** Open-ended cylinder - anything the player has to see through. */
      tubeOpen(material, rTop, rBottom, len, x, y, z, segments = null, rx = 0, ry = 0, rz = 0) {
        segments = segments ?? api.arc(Math.max(rTop, rBottom));
        const geometry = new THREE.CylinderGeometry(rTop, rBottom, len, segments, 1, true);
        geometry.rotateX(Math.PI / 2);
        return api.put(geometry, material, x, y, z, rx, ry, rz);
      },

      /** Torus in the XY plane - sling loops, sight apertures. */
      ring(material, radius, thickness, x, y, z, rx = 0, ry = 0, rz = 0, segments = null) {
        // A torus needs more radial sides than a cylinder of the same
        // radius: its silhouette is the OUTER edge, so faceting shows at
        // radius + thickness, and both edges are visible at once.
        segments = segments ?? Math.round(api.arc(radius + thickness) * 1.25);
        const geometry = new THREE.TorusGeometry(radius, thickness, 8, segments);
        // A torus's box is mostly hole. Letting it occlude fills a sling
        // loop and a rear aperture with darkness, which is the one place
        // on the weapon the player has to see THROUGH.
        currentOccludes = false;
        api.put(geometry, material, x, y, z, rx, ry, rz);
        currentOccludes = true;
        return api;
      },

      /**
       * Flat annulus facing +Z - the rim of an open tube.
       *
       * An open cylinder seen end-on has no wall thickness, so the eye
       * looks straight past the near wall into the inside of the far
       * one and the part reads as a soft donut rather than as a tube
       * with a bore. A 1-2mm rim is what an ocular housing or an
       * objective bell actually presents to the shooter and it is the
       * cheapest possible way to give the optic a hard silhouette.
       */
      annulus(material, rInner, rOuter, x, y, z, rx = 0, ry = 0, rz = 0, segments = null) {
        segments = segments ?? api.arc(rOuter);
        const geometry = new THREE.RingGeometry(rInner, rOuter, segments, 1);
        currentOccludes = false;
        api.put(geometry, material, x, y, z, rx, ry, rz);
        currentOccludes = true;
        return api;
      },

      /** Flat disc facing +Z. */
      disc(material, radius, x, y, z, segments = null) {
        segments = segments ?? api.arc(radius);
        const geometry = new THREE.CircleGeometry(radius, segments);
        // Zero thickness: it cannot contain anything, and the discs here
        // are lens elements and reticles that must not darken the tube.
        currentOccludes = false;
        api.put(geometry, material, x, y, z);
        currentOccludes = true;
        return api;
      },

      /** A run of evenly spaced ribs - rail slots, grip serrations,
       *  handguard vents. Cheap, and the thing that stops a long part
       *  reading as an untextured slab. */
      ribs(material, count, spacing, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
        for (let i = 0; i < count; i += 1) {
          api.box(material, w, h, d, x, y, z + (i - (count - 1) * 0.5) * spacing, rx, ry, rz, 0.0012);
        }
        return api;
      },

      finish(name) {
        const rootGroup = new THREE.Group();
        rootGroup.name = name;
        const named = {};
        const meshes = [];
        for (const [groupName, byMaterial] of groups) {
          const holder = new THREE.Group();
          holder.name = `${name}:${groupName}`;
          for (const [material, list] of byMaterial) {
            const mesh = new THREE.Mesh(mergeInto(list), material);
            mesh.castShadow = castShadows;
            mesh.receiveShadow = castShadows;
            mesh.frustumCulled = false;
            holder.add(mesh);
            meshes.push(mesh);
          }
          named[groupName] = holder;
          rootGroup.add(holder);
        }
        // After every merge, so it can see across materials and groups.
        bakeOcclusion(allParts);
        occStat.parts += allParts.length;
        groups.clear();
        allParts.length = 0;
        return { root: rootGroup, groups: named, meshes };
      },
    };
    return api;
  }

  /* ------------------------------ hands ------------------------------ */

  /**
   * A gloved hand closed around a bar through the origin.
   *
   * `wrap` is the axis of the thing being held: "vertical" for a pistol
   * grip, "horizontal" for a handguard. The orientation is baked into
   * the geometry rather than applied as a parent rotation, because a
   * hand that is one quaternion away from correct is a bug that is very
   * hard to see and very obvious once shipped.
   */
  function buildHand(side, wrap) {
    const b = makeBuilder();
    const s = side; // +1 right, -1 left

    // Back of the hand and palm block.
    b.taper(glove, 0.082, 0.074, 0.034, 0.072, 0, 0.028, 0.030, 0, 0, 0, 0.008);
    // Knuckle ridge.
    b.box(glove, 0.084, 0.020, 0.024, 0, 0.036, -0.006, 0, 0, 0, 0.007);
    // Heel of the hand.
    b.taper(glove, 0.070, 0.060, 0.040, 0.030, 0, 0.020, 0.072, 0, 0, 0, 0.008);

    // Four fingers, curling around a ~30mm bar. Three phalanges each,
    // rotated progressively about X so the fingertips end up under the
    // bar rather than pointing at it.
    const fingerW = 0.019;
    for (let f = 0; f < 4; f += 1) {
      const x = (f - 1.5) * 0.0205 * -s;
      const shrink = 1 - Math.abs(f - 1.2) * 0.055;
      let angle = -0.30;
      let py = 0.030;
      let pz = -0.012;
      const lengths = [0.030, 0.024, 0.019];
      for (let seg = 0; seg < 3; seg += 1) {
        const len = lengths[seg] * shrink;
        angle += seg === 0 ? 0.62 : 0.72;
        // March along the finger: the joint position is the previous
        // segment's end.
        const dy = -Math.cos(angle) * len * 0.5;
        const dz = -Math.sin(angle) * len * 0.5;
        py += dy;
        pz += dz;
        b.box(seg === 2 ? gloveDark : glove,
          fingerW * shrink, 0.019 * shrink, len,
          x, py, pz, angle + Math.PI / 2, 0, 0, 0.005);
        py += dy;
        pz += dz;
      }
    }

    // Thumb: two segments, laid across the front of the bar.
    const tx = 0.040 * s;
    b.box(glove, 0.022, 0.021, 0.036, tx, 0.020, -0.014, 0.5, 0, -0.5 * s, 0.006);
    b.box(gloveDark, 0.020, 0.019, 0.030, tx * 0.72, -0.004, -0.032, 1.05, 0, -0.4 * s, 0.006);

    // Wrist and forearm, tapering out to the sleeve.
    b.taper(glove, 0.058, 0.054, 0.050, 0.030, 0, 0.020, 0.100, 0, 0, 0, 0.008);
    b.box(gloveDark, 0.066, 0.058, 0.016, 0, 0.020, 0.120, 0, 0, 0, 0.005);
    b.taper(sleeve, 0.064, 0.060, 0.058, 0.075, 0, 0.020, 0.165, 0, 0, 0, 0.010);
    b.taper(sleeve, 0.076, 0.072, 0.070, 0.090, 0, 0.020, 0.250, 0, 0, 0, 0.012);

    const built = b.finish(`hand-${side > 0 ? "r" : "l"}`);
    const hand = built.root;

    // Bake the orientation. Built form grips a bar along X with the
    // forearm running back along +Z.
    if (wrap === "vertical") {
      // Pistol grip: the bar is vertical, the forearm comes back and
      // down from the shoulder.
      hand.rotation.set(0, 0, Math.PI / 2 * -s);
    } else {
      // Handguard: the bar runs along the barrel.
      hand.rotation.set(0, Math.PI / 2 * -s, 0);
    }
    hand.updateMatrix();

    const holder = new THREE.Group();
    holder.add(hand);
    return holder;
  }

  /* --------------------------- weapon models --------------------------- */

  /** Common back end: buffer tube, stock, grip, trigger group. Shared by
   *  the two ARs because they really do share it. */
  function arBackEnd(b, opts) {
    const stockZ = opts.stockZ ?? 0.205;
    // Buffer tube.
    b.tube(alum, 0.0175, 0.0175, 0.20, 0, BORE_Y, stockZ - 0.01, null);
    // Castle nut and endplate.
    b.tube(parker, 0.0215, 0.0215, 0.014, 0, BORE_Y, stockZ - 0.108, null);
    // Collapsible stock body.
    b.taper(polymer, 0.044, 0.052, 0.074, 0.150, 0, BORE_Y - 0.016, stockZ + 0.012, 0, 0, 0, 0.008);
    // Cheek weld ridge.
    b.box(polymer, 0.030, 0.016, 0.130, 0, BORE_Y + 0.030, stockZ + 0.004, 0, 0, 0, 0.005);
    // Butt pad: rubber, not glove cloth. It is the one part of the
    // weapon that touches a shoulder plate all day, so it is also the
    // one part whose finish is genuinely dead matte.
    b.box(rubber, 0.050, 0.098, 0.020, 0, BORE_Y - 0.020, stockZ + 0.094, -0.14, 0, 0, 0.006);
    // Sling loop on the endplate. A sling swivel is steel rubbing steel
    // and it is bright long before anything else on the stock is.
    b.wearMark(0.85);
    b.ring(parker, 0.010, 0.0028, -0.024, BORE_Y, stockZ - 0.112, 0, Math.PI / 2, 0);
    b.wearMark(0);
    // Adjustment latch under the stock.
    b.box(polymer, 0.024, 0.018, 0.040, 0, BORE_Y - 0.052, stockZ + 0.020, 0, 0, 0, 0.004);

    // Pistol grip: tilted, with a palm swell and finger grooves. The
    // grip is polished by a hand rather than abraded by kit, so it gets
    // a moderate mark - on polymer that reads as a sheen, because the
    // polymer's wear colour is a lighter grey, not bare metal.
    b.wearMark(0.55);
    b.taper(polymer, 0.038, 0.034, 0.112, 0.046, 0, -0.036, 0.082, 0.30, 0, 0, 0.008);
    b.ribs(polymer, 3, 0.013, 0.040, 0.016, 0.008, -0.001, -0.040, 0.062, 0.30, 0, 0);
    b.wearMark(0);
    b.box(polymer, 0.040, 0.020, 0.036, 0, -0.088, 0.108, 0.30, 0, 0, 0.008);

    // Trigger guard: three thin bars rather than a torus, which is what
    // a real one is.
    b.box(parker, 0.030, 0.008, 0.052, 0, -0.038, 0.045, 0, 0, 0, 0.002);
    b.box(parker, 0.030, 0.030, 0.008, 0, -0.024, 0.070, 0, 0, 0, 0.002);
    b.box(parker, 0.030, 0.026, 0.008, 0, -0.022, 0.020, 0, 0, 0, 0.002);
    // Trigger, magazine release and selector: the three controls a
    // finger works every single time the weapon is used, and the three
    // places a real rifle is brightest. This is the whole point of a
    // hand-placed wear mark - a chamfer flag cannot know that the
    // selector wears and the trigger guard beside it does not.
    b.wearMark(1.0);
    b.box(wear, 0.010, 0.026, 0.008, 0, -0.020, 0.048, 0.18, 0, 0, 0.002);
    b.box(parker, 0.014, 0.014, 0.010, 0.026, 0.000, 0.010, 0, 0, 0, 0.003);
    b.tube(parker, 0.008, 0.008, 0.044, 0.000, 0.006, 0.070, null, 0, Math.PI / 2, 0);
    b.box(parker, 0.006, 0.020, 0.010, -0.026, 0.000, 0.070, 0, 0, -0.5, 0.002);
    b.wearMark(0);
  }

  /** M4A1 - the reference weapon. Everything else is measured against
   *  how this one reads. */
  function buildM4() {
    const b = makeBuilder();

    // ---- lower receiver + magwell ----
    b.box(parker, 0.044, 0.058, 0.150, 0, 0.004, 0.020, 0, 0, 0, 0.005);
    b.box(parker, 0.040, 0.076, 0.058, 0, -0.014, -0.052, 0.06, 0, 0, 0.005);
    // Magwell flare, so the mouth is not a plain rectangle.
    b.box(parker, 0.046, 0.012, 0.064, 0, -0.052, -0.052, 0.06, 0, 0, 0.004);

    // ---- upper receiver ----
    b.box(parker, 0.042, 0.048, 0.182, 0, 0.044, -0.030, 0, 0, 0, 0.006);
    // Charging-handle shroud at the rear.
    b.taper(parker, 0.038, 0.042, 0.040, 0.040, 0, 0.046, 0.078, 0, 0, 0, 0.006);
    // Picatinny rail, slotted. Rail tops are the highest-wear surface on
    // an AR that is not a control: everything that clamps to them is
    // steel, everything that brushes past them is kit, and the anodise
    // is off the crests within a few hundred rounds.
    b.wearMark(0.9);
    b.box(alum, 0.0225, 0.008, 0.196, 0, 0.072, -0.034, 0, 0, 0, 0.002);
    // 7mm slots, not 5: seen end-on down the sight line the rail is
    // almost edge-on, and a 5mm relief foreshortens to nothing.
    b.ribs(alum, 14, 0.0125, 0.0245, 0.007, 0.008, 0, 0.0755, -0.034);
    b.wearMark(0);
    // Brass deflector and forward assist on the right.
    b.box(parker, 0.012, 0.024, 0.030, 0.024, 0.050, 0.024, 0, 0, -0.4, 0.005);
    b.tube(parker, 0.009, 0.010, 0.016, 0.028, 0.046, 0.046, null, 0, Math.PI / 2, 0);
    b.tube(parker, 0.006, 0.006, 0.008, 0.036, 0.046, 0.046, null, 0, Math.PI / 2, 0);
    // Ejection port lip.
    b.box(parker, 0.005, 0.030, 0.056, 0.0215, 0.044, -0.006, 0, 0, 0, 0.002);
    // Takedown pins.
    b.tube(wear, 0.005, 0.005, 0.046, 0, 0.014, -0.048, null, 0, Math.PI / 2, 0);
    b.tube(wear, 0.005, 0.005, 0.046, 0, 0.014, 0.078, null, 0, Math.PI / 2, 0);

    // ---- handguard ----
    // Octagonal quad-rail: a plain box here is the single most
    // "primitive" looking part of a rifle from the first person.
    b.put(extrude(chamferRect(0.050, 0.052, 0.013), 0.212), alum, 0, BORE_Y + 0.002, -0.232);
    b.wearMark(0.8);
    b.ribs(alum, 12, 0.0155, 0.0235, 0.005, 0.008, 0, BORE_Y + 0.030, -0.232);
    b.wearMark(0);
    // Vent slots down the sides.
    b.ribs(polymer, 5, 0.030, 0.054, 0.014, 0.016, 0, BORE_Y - 0.004, -0.232);
    // Barrel nut behind the handguard.
    b.tube(parker, 0.0235, 0.0235, 0.026, 0, BORE_Y, -0.126, null);
    // Front rail cap.
    b.box(alum, 0.048, 0.050, 0.010, 0, BORE_Y + 0.002, -0.336, 0, 0, 0, 0.006);

    // ---- barrel, gas block, muzzle device ----
    b.tube(blued, 0.0092, 0.0092, 0.170, 0, BORE_Y, -0.424, null);
    b.box(parker, 0.028, 0.046, 0.038, 0, BORE_Y + 0.010, -0.358, 0, 0, 0, 0.005);
    b.tube(parker, 0.0055, 0.0055, 0.230, 0, BORE_Y + 0.028, -0.240, null);
    /* Flash hider: a birdcage whose slots are in the SURFACE, not in
     * the silhouette.
     *
     * This was four free-standing 28mm square vanes strung along a
     * 26mm-diameter tube. A 28mm square around a 26mm circle puts its
     * corners at 19.8mm radius, so each vane threw four spurs 6.8mm
     * clear of the barrel - sixteen extra silhouette edges on the
     * smallest feature of the weapon, at the far end of it, where each
     * spur is one or two pixels wide.
     *
     * That is where the black-and-white checker at the muzzle came
     * from, and it cannot be filtered away downstream: render.js builds
     * the renderer with `antialias: false` and draws the view scene
     * straight to the default framebuffer AFTER the composer, so SMAA
     * runs on the world and never touches the weapon. The view model
     * has no antialiasing of any kind. Anything I put here at
     * pixel scale stipples, full stop, so the fix has to be to stop
     * generating pixel-scale silhouette.
     *
     * Raised collars instead. An A2 reads as bands of light and shade
     * around a continuous barrel anyway - the slots are milled in, they
     * are not gaps between fins - so a 0.8mm proud ring at each slot
     * boundary gives the same read with a silhouette that is one smooth
     * circle at whatever segment count arc() picks for the radius. */
    b.tube(blued, 0.0130, 0.0112, 0.056, 0, BORE_Y, -0.528);
    for (let i = 0; i < 4; i += 1) {
      b.tube(blued, 0.0138, 0.0136, 0.0032, 0, BORE_Y, -0.546 + i * 0.0105);
    }
    b.tube(polymer, 0.0072, 0.0072, 0.020, 0, BORE_Y, -0.548, null);
    // Front sling mount.
    b.ring(parker, 0.011, 0.0030, 0, BORE_Y - 0.030, -0.322, 0, Math.PI / 2, 0);

    // ---- sights ----
    // Sight line 66mm over bore, which is what puts an AR's rear
    // aperture at the shooter's eye with a normal cheek weld.
    const sightY = BORE_Y + 0.066;
    // Front post in its ears.
    b.box(parker, 0.005, 0.030, 0.006, 0, sightY - 0.015, -0.358, 0, 0, 0, 0.001);
    b.box(parker, 0.005, 0.026, 0.006, -0.011, sightY - 0.016, -0.358, 0, 0, 0, 0.001);
    b.box(parker, 0.005, 0.026, 0.006, 0.011, sightY - 0.016, -0.358, 0, 0, 0, 0.001);
    /* Rear back-up iron sight, FOLDED FLAT.
     *
     * It used to stand up at sightY, 52mm behind the optic and dead on
     * the optical axis - so at 68mm from the eye its 10mm aperture ring
     * subtended 17 degrees and sat as a big soft grey donut in the
     * middle of every ADS frame, in front of the sight picture. It has
     * been in every ADS capture this weapon has ever produced, and it
     * is almost certainly part of what a blind reviewer was describing
     * when it called the optic housing shapeless.
     *
     * A real BUIS folds, and with an optic mounted it lives folded.
     * Flat it is a 10mm block on the rail, which is what it should have
     * been reading as all along. */
    b.box(parker, 0.026, 0.009, 0.032, 0, sightY - 0.018, 0.050, 0, 0, 0, 0.002);
    b.box(parker, 0.019, 0.007, 0.024, 0, sightY - 0.012, 0.044, -0.16, 0, 0, 0.002);
    b.wearMark(0.8);
    b.box(wear, 0.006, 0.005, 0.008, 0.011, sightY - 0.013, 0.060, 0, 0, 0, 0.001);
    b.wearMark(0);

    // ---- optic: red dot on a cantilever mount ----
    //
    // Segment counts here are not arbitrary. At full ADS the objective
    // ring fills roughly a fifth of frame width, and 14 segments across
    // that is a countable polygon - it was the first thing the art
    // director named. 32 is the point where the silhouette stops
    // reading as faceted at the distance this part is actually seen
    // from; the whole optic is merged into the body draw call, so the
    // extra triangles cost nothing measurable.
    const OPTIC_SEG = 32;
    // The cantilever mount is the largest single flat area in the ADS
    // frame - at an 8mm near plane a 30mm block fills a third of frame
    // width - so it gets the most breakup per triangle of anything on
    // the weapon: a webbed side pocket, two cross-bolts and a throw
    // lever. Left as one chamfered box it is the "flat grey slab with
    // one specular band" the art director called out.
    b.box(alum, 0.030, 0.028, 0.062, 0, BORE_Y + 0.046, -0.024, 0, 0, 0, 0.005);
    b.box(alum, 0.038, 0.010, 0.024, 0, BORE_Y + 0.034, -0.010, 0, 0, 0, 0.003);
    for (const s of [-1, 1]) {
      // Lightening pocket: a shallow recess with a rib across it.
      b.box(polymer, 0.003, 0.016, 0.034, s * 0.0148, BORE_Y + 0.048, -0.022, 0, 0, 0, 0.002);
      b.box(alum, 0.004, 0.017, 0.005, s * 0.0152, BORE_Y + 0.048, -0.022, 0, 0, 0, 0.001);
    }
    // Recoil lug and cross-bolt on the mount, so it is not a bare block.
    b.box(alum, 0.034, 0.014, 0.008, 0, BORE_Y + 0.038, -0.050, 0, 0, 0, 0.002);
    b.tube(parker, 0.0045, 0.0045, 0.042, 0, BORE_Y + 0.038, -0.050, null, 0, Math.PI / 2, 0);
    b.tube(parker, 0.0045, 0.0045, 0.042, 0, BORE_Y + 0.038, 0.000, null, 0, Math.PI / 2, 0);
    b.box(wear, 0.010, 0.012, 0.010, 0.020, BORE_Y + 0.038, -0.050, 0, 0, 0, 0.002);
    b.box(wear, 0.010, 0.012, 0.010, 0.020, BORE_Y + 0.038, 0.000, 0, 0, 0, 0.002);
    // Throw lever, folded back against the left face.
    b.box(parker, 0.006, 0.010, 0.030, -0.020, BORE_Y + 0.038, -0.038, 0, 0, 0.16, 0.002);
    b.box(parker, 0.005, 0.014, 0.008, -0.021, BORE_Y + 0.038, -0.052, 0, 0, 0.16, 0.001);

    b.tubeOpen(alum, 0.0195, 0.0195, 0.086, 0, sightY, -0.030, OPTIC_SEG);
    b.tubeOpen(alum, 0.0225, 0.0225, 0.012, 0, sightY, -0.070, OPTIC_SEG);
    b.tubeOpen(alum, 0.0225, 0.0225, 0.012, 0, sightY, 0.010, OPTIC_SEG);
    // Rims on both bells, so the tube has a wall instead of a hole.
    // ry = PI on the objective: a RingGeometry faces +Z, and the front
    // bell is looked at from -Z.
    b.annulus(alum, 0.0185, 0.0225, 0, sightY, -0.0761, 0, Math.PI, 0, OPTIC_SEG);
    b.annulus(polymer, 0.0170, 0.0225, 0, sightY, 0.0161, 0, 0, 0, OPTIC_SEG);
    // Inner shade tube: matte black, a shade darker than the body, so
    // the inside of the optic is not lit like the outside of it.
    b.tubeOpen(polymer, 0.0178, 0.0178, 0.080, 0, sightY, -0.030, OPTIC_SEG);
    // Rubber eyecup, flared, at the ocular end. Genuinely rubber now:
    // it sits directly against the anodised housing, and a dead-matte
    // ring against a semi-gloss one is the clearest material boundary
    // anywhere on the weapon.
    // Flared TOWARDS the eye: tube() maps rTop onto +Z, so the wide end
    // has to be the first argument or the cup tapers the wrong way. The
    // rim annulus closes it: a double-sided zero-thickness cone shows
    // its own far wall through its near wall at grazing incidence, and
    // the two surfaces land within a depth quantum of each other, which
    // stippled a band of z-fighting right across the ADS sight picture.
    b.tubeOpen(rubber, 0.0248, 0.0230, 0.014, 0, sightY, 0.019, OPTIC_SEG);
    b.annulus(rubber, 0.0228, 0.0250, 0, sightY, 0.0261, 0, 0, 0, OPTIC_SEG);

    // Windage/elevation turrets, knurled. A smooth cylinder catches one
    // unbroken specular band and reads as plastic; the knurl is eight
    // tiny boxes and it fixes that on its own.
    for (const [tx, ty, rot] of [[0.020, 0, "y"], [0, 0.020, "x"]]) {
      const cx = tx;
      const cy = sightY + ty;
      if (rot === "y") {
        b.tube(alum, 0.0085, 0.0085, 0.014, cx, cy, -0.006, null, 0, Math.PI / 2, 0);
        b.tube(alum, 0.0062, 0.0062, 0.006, cx + 0.009, cy, -0.006, null, 0, Math.PI / 2, 0);
      } else {
        b.tube(alum, 0.0085, 0.0085, 0.014, cx, cy, -0.006, null, Math.PI / 2, 0, 0);
        b.tube(alum, 0.0062, 0.0062, 0.006, cx, cy + 0.009, -0.006, null, Math.PI / 2, 0, 0);
      }
      // 0.0090, not 0.0085: a knurl sitting exactly on the turret's
      // own radius is coplanar with it and z-fights into white stripes.
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        const ox = Math.cos(a) * 0.0090;
        const oy = Math.sin(a) * 0.0090;
        if (rot === "y") {
          b.box(alum, 0.012, 0.0016, 0.0016, cx, cy + oy, -0.006 + ox, a, 0, 0, 0.0004);
        } else {
          b.box(alum, 0.0016, 0.012, 0.0016, cx + ox, cy, -0.006 + oy, 0, 0, 0, 0.0004);
        }
      }
    }
    // Battery cap on the left of the housing. Screwed off and on with a
    // rim cartridge every few weeks, so its slot is bright.
    b.wearMark(0.7);
    b.tube(alum, 0.0072, 0.0072, 0.010, -0.020, sightY, 0.002, null, 0, Math.PI / 2, 0);
    b.box(wear, 0.004, 0.0016, 0.010, -0.025, sightY, 0.002, 0, 0, 0, 0.0004);
    b.wearMark(0);

    // ---- animated groups ----
    b.group("mag");
    // STANAG 30-round: three stacked sections with increasing rake, so
    // the curve is real rather than a straight box tilted over.
    b.box(polymer, 0.036, 0.062, 0.026, 0, -0.058, -0.048, Math.PI / 2, 0, 0, 0.005);
    b.box(polymer, 0.036, 0.062, 0.026, 0.000, -0.118, -0.041, Math.PI / 2, 0.0, 0.0, 0.005);
    b.box(polymer, 0.036, 0.058, 0.026, 0.000, -0.174, -0.027, Math.PI / 2, 0.0, 0.0, 0.005);
    b.box(polymer, 0.040, 0.010, 0.030, 0, -0.200, -0.021, Math.PI / 2, 0, 0, 0.004);
    // Witness holes and follower spine.
    b.ribs(gloveDark, 4, 0.030, 0.006, 0.006, 0.020, 0.018, -0.118, -0.041, Math.PI / 2, 0, 0);
    // Top round showing at the mouth.
    b.tube(brass, 0.0045, 0.0045, 0.030, 0, -0.026, -0.052, null, 0, Math.PI / 2, 0);

    b.group("bolt");
    // Bolt carrier face, seen through the port when it cycles.
    b.box(alum, 0.014, 0.026, 0.048, 0.016, 0.044, -0.004, 0, 0, 0, 0.003);
    b.tube(wear, 0.0075, 0.0075, 0.020, 0.016, 0.044, -0.030, null);

    b.group("dust");
    // Ejection port cover, hinged along its bottom edge.
    b.box(parker, 0.004, 0.028, 0.054, 0.024, 0.044, -0.006, 0, 0, 0, 0.001);

    b.group("charge");
    // The charging handle latch is the single brightest thing on a
    // carried AR: two fingers pull it, hard, every time the weapon is
    // loaded or cleared, and the finish is gone from the wings first.
    b.wearMark(1.0);
    b.box(parker, 0.036, 0.010, 0.026, 0, 0.066, 0.090, 0, 0, 0, 0.003);
    b.box(parker, 0.052, 0.008, 0.014, 0, 0.066, 0.100, 0, 0, 0, 0.003);
    b.wearMark(0);

    b.group("glass");
    // Three elements, because one flat disc is why the optic read as an
    // untinted hole: the tinted glass itself, a coating flare in front
    // of it, and a rear element set back 40mm. The rear element is what
    // gives the sight PARALLAX - it slides across the front one as the
    // head moves, which is the cue that says "this is a tube with depth"
    // rather than "this is a decal on a ring".
    b.disc(lens, 0.0185, 0, sightY, -0.0705, 40);
    b.disc(lensCoat, 0.0182, 0, sightY, -0.0698, 40);
    b.disc(lens, 0.0170, 0, sightY, 0.0060, 40);

    b.group("reticle");
    // Halo, then core. 2.4mm of core rather than 1.6: at the 150mm eye
    // relief this optic is drawn with, 1.6mm subtends 0.6 degrees, which
    // is about ten screen pixels at 1600 wide - correct for a real 2MOA
    // dot and far too small to survive being the ONLY thing telling the
    // player where the weapon points. Real games oversize the dot for
    // exactly this reason.
    b.disc(reticleGlow, 0.0062, 0, sightY, -0.0664, 24);
    b.disc(reticleMat, 0.0024, 0, sightY, -0.066);

    return finishWeapon(b, {
      name: "m4",
      sight: [0, sightY, -0.030],
      muzzle: [0, BORE_Y, -0.560],
      eject: [0.030, 0.048, -0.004],
      gripHand: [0.004, -0.062, 0.086, 0.30, 0, 0],
      supportHand: [-0.004, BORE_Y - 0.028, -0.236, -0.10, 0, 0],
      chargeHand: [0.0, 0.086, 0.098, 0, 0, 0],
      adsRelief: 0.150,
      boltTravel: 0.024,
      dustOpen: -1.15,
      magDrop: [0.01, -0.34, 0.02],
      ejectVelocity: [2.6, 1.9, 0.4],
    });
  }

  /** AKM - shorter sight radius, wood furniture, and a bolt carrier that
   *  reciprocates in full view, which is the whole point of the gun
   *  visually. */
  function buildAK() {
    const b = makeBuilder();

    // Receiver: stamped, so a shallower and boxier section than the AR.
    b.box(parker, 0.038, 0.062, 0.196, 0, 0.022, -0.010, 0, 0, 0, 0.004);
    // Dust cover with its ribs.
    b.box(parker, 0.040, 0.020, 0.150, 0, 0.056, -0.006, 0, 0, 0, 0.006);
    b.ribs(parker, 2, 0.048, 0.042, 0.014, 0.012, 0, 0.056, -0.006);
    // Rear sight block and trunnion.
    b.box(parker, 0.036, 0.020, 0.036, 0, 0.056, -0.108, 0, 0, 0, 0.004);
    b.box(parker, 0.040, 0.030, 0.030, 0, 0.030, -0.120, 0, 0, 0, 0.004);

    // Wood furniture.
    b.taper(woodRed, 0.046, 0.040, 0.048, 0.150, 0, BORE_Y - 0.014, -0.212, 0, 0, 0, 0.008);
    b.box(woodRed, 0.042, 0.026, 0.130, 0, BORE_Y + 0.030, -0.216, 0, 0, 0, 0.008);
    b.box(parker, 0.046, 0.030, 0.026, 0, BORE_Y + 0.006, -0.140, 0, 0, 0, 0.004);
    // Gas tube above the barrel.
    b.tube(parker, 0.0115, 0.0115, 0.150, 0, BORE_Y + 0.030, -0.216, null);

    // Barrel and gas block.
    b.tube(blued, 0.0105, 0.0105, 0.150, 0, BORE_Y, -0.360, null);
    b.box(parker, 0.028, 0.044, 0.032, 0, BORE_Y + 0.012, -0.300, 0, -0.0, 0.0, 0.004);
    // Front sight tower, hooded.
    b.box(parker, 0.026, 0.042, 0.030, 0, BORE_Y + 0.020, -0.416, 0, 0, 0, 0.004);
    b.tubeOpen(parker, 0.0135, 0.0135, 0.026, 0, BORE_Y + 0.048, -0.416, null);
    b.box(parker, 0.005, 0.024, 0.005, 0, BORE_Y + 0.046, -0.416, 0, 0, 0, 0.001);
    // Slant muzzle brake.
    b.tube(blued, 0.0145, 0.0135, 0.058, 0, BORE_Y, -0.470, null, 0.0, 0.22, 0);
    b.box(parker, 0.020, 0.010, 0.030, 0.008, BORE_Y + 0.008, -0.482, 0, 0.22, 0, 0.002);

    // Fixed stock.
    b.taper(woodRed, 0.046, 0.052, 0.078, 0.185, 0, BORE_Y - 0.020, 0.190, 0, 0, 0.0, 0.010);
    b.box(gloveDark, 0.048, 0.100, 0.018, 0, BORE_Y - 0.028, 0.286, -0.10, 0, 0, 0.006);
    b.box(woodRed, 0.030, 0.020, 0.110, 0, BORE_Y + 0.022, 0.180, -0.03, 0, 0, 0.006);

    // Grip, trigger group, safety lever.
    b.taper(polymer, 0.036, 0.032, 0.108, 0.044, 0, -0.040, 0.076, 0.34, 0, 0, 0.008);
    b.box(polymer, 0.038, 0.018, 0.034, 0, -0.090, 0.102, 0.34, 0, 0, 0.008);
    b.box(parker, 0.028, 0.008, 0.050, 0, -0.036, 0.038, 0, 0, 0, 0.002);
    b.box(parker, 0.028, 0.026, 0.008, 0, -0.024, 0.062, 0, 0, 0, 0.002);
    b.box(wear, 0.010, 0.024, 0.008, 0, -0.020, 0.040, 0.18, 0, 0, 0.002);
    b.box(parker, 0.005, 0.086, 0.020, 0.021, 0.030, -0.030, 0, 0, 0.16, 0.003);

    // Sight line: an AK's is 15mm lower over the bore than an AR's.
    const sightY = BORE_Y + 0.048;
    b.box(parker, 0.024, 0.014, 0.040, 0, sightY - 0.008, -0.108, 0, 0, 0, 0.002);
    b.box(parker, 0.004, 0.014, 0.004, 0, sightY, -0.092, 0, 0, 0, 0.001);

    b.group("mag");
    // Deeply curved 7.62 magazine - three sections with real rake.
    b.box(polymer, 0.032, 0.058, 0.030, 0, -0.048, -0.062, Math.PI / 2, 0, 0, 0.005);
    b.box(polymer, 0.032, 0.058, 0.030, 0.000, -0.100, -0.044, Math.PI / 2 - 0.30, 0, 0, 0.005);
    b.box(polymer, 0.032, 0.054, 0.030, 0.000, -0.144, -0.010, Math.PI / 2 - 0.62, 0, 0, 0.005);
    b.ribs(gloveDark, 5, 0.010, 0.034, 0.004, 0.004, 0, -0.100, -0.044, Math.PI / 2 - 0.30, 0, 0);
    b.tube(brass, 0.0055, 0.0055, 0.034, 0, -0.018, -0.070, null, 0, Math.PI / 2, 0);

    b.group("bolt");
    // Charging handle is part of the carrier and runs in the right-hand
    // slot: the most legible cycling animation of any of these weapons.
    b.box(alum, 0.016, 0.018, 0.060, 0.020, 0.048, -0.030, 0, 0, 0, 0.004);
    b.tube(alum, 0.0085, 0.0085, 0.036, 0.032, 0.048, -0.052, null, 0, Math.PI / 2, 0);
    b.box(alum, 0.012, 0.026, 0.020, 0.030, 0.050, -0.010, 0, 0, 0, 0.004);

    b.group("dust");
    b.box(parker, 0.004, 0.020, 0.040, 0.020, 0.048, 0.010, 0, 0, 0, 0.001);

    return finishWeapon(b, {
      name: "akm",
      sight: [0, sightY, -0.060],
      muzzle: [0, BORE_Y, -0.498],
      eject: [0.034, 0.052, -0.020],
      gripHand: [0.004, -0.066, 0.080, 0.34, 0, 0],
      supportHand: [-0.004, BORE_Y - 0.030, -0.214, -0.10, 0, 0],
      chargeHand: [0.052, 0.056, -0.052, 0, 0, 0],
      adsRelief: 0.135,
      boltTravel: 0.052,
      dustOpen: -1.0,
      magDrop: [0.01, -0.34, 0.03],
      ejectVelocity: [3.1, 2.2, 0.3],
    });
  }

  /** M24 - long, heavy, and manually operated. The bolt cycle between
   *  shots is the animation that defines it. */
  function buildM24() {
    const b = makeBuilder();

    // Stock: one continuous piece with a thumbhole and a raised comb.
    b.taper(woodDark, 0.052, 0.046, 0.070, 0.230, 0, BORE_Y - 0.036, 0.150, 0, 0, 0, 0.010);
    b.taper(woodDark, 0.048, 0.044, 0.052, 0.180, 0, BORE_Y - 0.020, -0.090, 0, 0, 0, 0.010);
    b.box(woodDark, 0.046, 0.030, 0.140, 0, BORE_Y + 0.024, 0.160, -0.04, 0, 0, 0.010);
    b.box(gloveDark, 0.050, 0.110, 0.020, 0, BORE_Y - 0.036, 0.272, -0.09, 0, 0, 0.008);
    // Forend, wide and flat-bottomed for a bag or bipod.
    b.taper(woodDark, 0.050, 0.056, 0.056, 0.190, 0, BORE_Y - 0.026, -0.210, 0, 0, 0, 0.010);
    b.box(woodDark, 0.058, 0.014, 0.150, 0, BORE_Y - 0.050, -0.200, 0, 0, 0, 0.006);
    // Sling studs.
    b.ring(parker, 0.008, 0.0026, 0, BORE_Y - 0.058, -0.280, 0, Math.PI / 2, 0);
    b.ring(parker, 0.008, 0.0026, 0, BORE_Y - 0.060, 0.240, 0, Math.PI / 2, 0);

    // Receiver and floorplate.
    b.tube(parker, 0.0195, 0.0195, 0.180, 0, BORE_Y, -0.010, null);
    b.box(parker, 0.040, 0.036, 0.176, 0, BORE_Y - 0.006, -0.010, 0, 0, 0, 0.005);
    b.box(parker, 0.036, 0.014, 0.090, 0, BORE_Y - 0.048, -0.030, 0, 0, 0, 0.004);
    // Heavy fluted barrel.
    b.tube(blued, 0.0155, 0.0125, 0.400, 0, BORE_Y, -0.300, null);
    b.ribs(blued, 3, 0.011, 0.006, 0.030, 0.300, 0, BORE_Y, -0.300);
    b.tube(blued, 0.0125, 0.0125, 0.020, 0, BORE_Y, -0.502, null);
    b.tube(polymer, 0.0058, 0.0058, 0.014, 0, BORE_Y, -0.506, null);

    // Grip and trigger.
    b.taper(woodDark, 0.038, 0.036, 0.100, 0.048, 0, -0.030, 0.078, 0.24, 0, 0, 0.008);
    b.box(parker, 0.028, 0.008, 0.048, 0, -0.030, 0.038, 0, 0, 0, 0.002);
    b.box(parker, 0.028, 0.024, 0.008, 0, -0.020, 0.060, 0, 0, 0, 0.002);
    b.box(wear, 0.008, 0.026, 0.008, 0, -0.014, 0.036, 0.14, 0, 0, 0.002);

    // Scope: 40mm objective, turrets, sunshade, mounted high on rings.
    const sightY = BORE_Y + 0.062;
    b.box(alum, 0.036, 0.026, 0.030, 0, BORE_Y + 0.030, 0.048, 0, 0, 0, 0.004);
    b.box(alum, 0.036, 0.026, 0.030, 0, BORE_Y + 0.030, -0.086, 0, 0, 0, 0.004);
    b.tubeOpen(alum, 0.0225, 0.0225, 0.026, 0, sightY, 0.048, null);
    b.tubeOpen(alum, 0.0225, 0.0225, 0.026, 0, sightY, -0.086, null);
    b.tubeOpen(parker, 0.0165, 0.0165, 0.230, 0, sightY, -0.020, null);
    b.tubeOpen(parker, 0.0230, 0.0230, 0.080, 0, sightY, -0.170, null);
    b.tubeOpen(parker, 0.0245, 0.0245, 0.014, 0, sightY, -0.208, null);
    b.tubeOpen(parker, 0.0195, 0.0195, 0.056, 0, sightY, 0.086, null);
    b.tubeOpen(parker, 0.0215, 0.0215, 0.012, 0, sightY, 0.116, null);
    // Turrets and a parallax knob.
    b.tube(parker, 0.0125, 0.0125, 0.020, 0, sightY + 0.026, -0.062, null, Math.PI / 2, 0, 0);
    b.tube(parker, 0.0125, 0.0125, 0.020, 0.026, sightY, -0.062, null, 0, Math.PI / 2, 0);
    b.tube(parker, 0.0115, 0.0115, 0.016, -0.024, sightY, -0.062, null, 0, Math.PI / 2, 0);

    b.group("mag");
    b.box(parker, 0.034, 0.020, 0.070, 0, BORE_Y - 0.062, -0.030, 0, 0, 0, 0.004);
    b.box(wear, 0.014, 0.010, 0.020, 0, BORE_Y - 0.072, -0.058, 0, 0, 0, 0.003);

    b.group("bolt");
    // Bolt body and the handle that gets worked between shots.
    b.tube(wear, 0.0105, 0.0105, 0.050, 0, BORE_Y, 0.062, null);
    b.tube(wear, 0.0075, 0.0075, 0.052, 0.026, BORE_Y - 0.008, 0.060, null, 0, 0.0, -1.15);
    b.tube(wear, 0.0125, 0.0125, 0.016, 0.048, BORE_Y - 0.026, 0.060, null, 0, Math.PI / 2, 0);

    b.group("glass");
    b.disc(lens, 0.0225, 0, sightY, -0.2135);

    b.group("reticle");
    // Duplex crosshair plus a couple of mil marks, built from thin
    // additive bars rather than a texture so it stays sharp at any
    // resolution.
    b.box(reticleMat, 0.0170, 0.0006, 0.0004, 0, sightY, -0.211);
    b.box(reticleMat, 0.0006, 0.0170, 0.0004, 0, sightY, -0.211);
    b.box(reticleMat, 0.0030, 0.0005, 0.0004, 0, sightY - 0.005, -0.211);
    b.box(reticleMat, 0.0022, 0.0005, 0.0004, 0, sightY - 0.009, -0.211);

    return finishWeapon(b, {
      name: "m24",
      sight: [0, sightY, -0.020],
      muzzle: [0, BORE_Y, -0.512],
      eject: [0.026, BORE_Y + 0.016, 0.040],
      gripHand: [0.004, -0.056, 0.082, 0.24, 0, 0],
      supportHand: [-0.004, BORE_Y - 0.062, -0.220, -0.08, 0, 0],
      chargeHand: [0.062, BORE_Y - 0.022, 0.060, 0, 0, 0],
      adsRelief: 0.235,
      boltTravel: 0.0,
      dustOpen: 0,
      magDrop: [0.01, -0.30, 0.0],
      ejectVelocity: [2.0, 1.6, 0.6],
      manualBolt: true,
      scope: true,
    });
  }

  /** MP5 - compact, all-metal, with the fat ribbed handguard and the
   *  drum rear sight that make it instantly recognisable. */
  function buildMP5() {
    const b = makeBuilder();

    b.box(parker, 0.040, 0.056, 0.180, 0, 0.020, -0.020, 0, 0, 0, 0.006);
    b.box(parker, 0.036, 0.020, 0.150, 0, 0.052, -0.026, 0, 0, 0, 0.005);
    // Cocking tube above the barrel, and the receiver's end cap.
    b.tube(parker, 0.0135, 0.0135, 0.220, 0, BORE_Y + 0.034, -0.180, null);
    b.box(parker, 0.042, 0.052, 0.014, 0, 0.020, 0.074, 0, 0, 0, 0.005);

    // Handguard: wide, ribbed, tapering to the front.
    b.taper(polymer, 0.056, 0.050, 0.056, 0.180, 0, BORE_Y - 0.008, -0.190, 0, 0, 0, 0.012);
    b.ribs(polymer, 7, 0.023, 0.062, 0.010, 0.011, 0, BORE_Y - 0.030, -0.190);
    b.tube(blued, 0.0110, 0.0110, 0.090, 0, BORE_Y, -0.310, null);
    b.tube(parker, 0.0165, 0.0165, 0.024, 0, BORE_Y, -0.346, null);
    b.ribs(parker, 3, 0.010, 0.036, 0.008, 0.006, 0, BORE_Y, -0.346);

    // Retractable stock: two rails and a shoulder piece.
    b.tube(parker, 0.0075, 0.0075, 0.180, 0.021, BORE_Y - 0.004, 0.166, null);
    b.tube(parker, 0.0075, 0.0075, 0.180, -0.021, BORE_Y - 0.004, 0.166, null);
    b.box(parker, 0.052, 0.078, 0.016, 0, BORE_Y - 0.012, 0.252, -0.10, 0, 0, 0.006);
    b.box(parker, 0.048, 0.020, 0.040, 0, BORE_Y - 0.028, 0.230, 0, 0, 0, 0.005);

    b.taper(polymer, 0.036, 0.032, 0.104, 0.046, 0, -0.034, 0.056, 0.30, 0, 0, 0.008);
    b.box(polymer, 0.040, 0.052, 0.076, 0, -0.006, 0.048, 0, 0, 0, 0.008);
    b.box(parker, 0.028, 0.008, 0.048, 0, -0.032, 0.020, 0, 0, 0, 0.002);
    b.box(wear, 0.009, 0.024, 0.008, 0, -0.018, 0.020, 0.18, 0, 0, 0.002);

    // Sight line, with the HK drum at the back and a hooded post front.
    const sightY = BORE_Y + 0.052;
    b.tubeOpen(parker, 0.0165, 0.0165, 0.022, 0, sightY - 0.004, 0.036, null);
    b.box(parker, 0.020, 0.024, 0.020, 0, sightY - 0.016, 0.036, 0, 0, 0, 0.003);
    b.tubeOpen(parker, 0.0140, 0.0125, 0.032, 0, sightY - 0.006, -0.344, null);
    b.box(parker, 0.004, 0.020, 0.004, 0, sightY - 0.008, -0.344, 0, 0, 0, 0.001);

    b.group("mag");
    b.box(polymer, 0.030, 0.070, 0.028, 0, -0.062, -0.030, Math.PI / 2, 0, 0, 0.005);
    b.box(polymer, 0.030, 0.070, 0.028, 0.000, -0.130, -0.020, Math.PI / 2 - 0.14, 0, 0, 0.005);
    b.box(polymer, 0.034, 0.010, 0.032, 0, -0.170, -0.014, Math.PI / 2 - 0.14, 0, 0, 0.004);
    b.tube(brass, 0.0046, 0.0046, 0.026, 0, -0.028, -0.034, null, 0, Math.PI / 2, 0);

    b.group("bolt");
    b.box(alum, 0.026, 0.016, 0.030, -0.020, BORE_Y + 0.038, -0.244, 0, 0, 0, 0.004);
    b.box(alum, 0.014, 0.024, 0.024, -0.030, BORE_Y + 0.038, -0.244, 0, 0, 0, 0.004);

    b.group("dust");
    b.box(parker, 0.004, 0.018, 0.034, 0.021, 0.038, -0.014, 0, 0, 0, 0.001);

    return finishWeapon(b, {
      name: "mp5",
      sight: [0, sightY, -0.020],
      muzzle: [0, BORE_Y, -0.362],
      eject: [0.030, 0.042, -0.014],
      gripHand: [0.004, -0.058, 0.062, 0.30, 0, 0],
      supportHand: [-0.004, BORE_Y - 0.036, -0.196, -0.10, 0, 0],
      chargeHand: [-0.048, BORE_Y + 0.040, -0.244, 0, 0, 0],
      adsRelief: 0.130,
      boltTravel: 0.0,
      dustOpen: -1.0,
      magDrop: [0.01, -0.32, 0.02],
      ejectVelocity: [2.4, 2.0, 0.5],
    });
  }

  /** M249 - the heaviest silhouette in the set. Long barrel with a heat
   *  shield, carry handle, bipod and a box of belt under the receiver. */
  function buildM249() {
    const b = makeBuilder();

    b.box(parker, 0.052, 0.078, 0.230, 0, 0.014, 0.010, 0, 0, 0, 0.007);
    b.box(parker, 0.048, 0.024, 0.190, 0, 0.062, -0.010, 0, 0, 0, 0.005);
    b.box(alum, 0.024, 0.008, 0.150, 0, 0.078, -0.020, 0, 0, 0, 0.002);
    b.ribs(alum, 10, 0.0145, 0.026, 0.005, 0.007, 0, 0.0805, -0.020);
    // Feed tray cover latch and the belt lug.
    b.box(parker, 0.020, 0.014, 0.024, 0, 0.070, 0.096, 0, 0, 0, 0.004);

    // Barrel with a slotted heat shield and a bipod.
    b.tube(blued, 0.0125, 0.0125, 0.330, 0, BORE_Y, -0.330, null);
    b.taper(parker, 0.044, 0.048, 0.048, 0.190, 0, BORE_Y - 0.002, -0.230, 0, 0, 0, 0.010);
    b.ribs(polymer, 6, 0.026, 0.050, 0.014, 0.014, 0, BORE_Y - 0.002, -0.230);
    b.tube(parker, 0.0195, 0.0195, 0.030, 0, BORE_Y, -0.470, null);
    // Same slot-as-collar treatment as the carbine's birdcage - see the
    // note there. Square vanes on a round barrel are the one shape that
    // guarantees pixel-scale silhouette spurs, and nothing downstream
    // of the view scene antialiases them.
    b.tube(blued, 0.0155, 0.0135, 0.058, 0, BORE_Y, -0.512);
    for (let i = 0; i < 3; i += 1) {
      b.tube(blued, 0.0164, 0.0162, 0.0038, 0, BORE_Y, -0.528 + i * 0.0125);
    }
    // Carry handle, folded to the side.
    b.box(polymer, 0.014, 0.030, 0.090, -0.030, BORE_Y + 0.036, -0.220, 0, 0, 0.4, 0.006);
    // Bipod legs, folded back under the barrel.
    b.tube(parker, 0.0055, 0.0055, 0.190, 0.026, BORE_Y - 0.046, -0.240, null, 0.26, 0.10, 0);
    b.tube(parker, 0.0055, 0.0055, 0.190, -0.026, BORE_Y - 0.046, -0.240, null, 0.26, -0.10, 0);
    b.box(parker, 0.040, 0.024, 0.036, 0, BORE_Y - 0.034, -0.330, 0, 0, 0, 0.005);

    // Stock and grip.
    b.taper(polymer, 0.050, 0.058, 0.096, 0.200, 0, BORE_Y - 0.026, 0.222, 0, 0, 0, 0.012);
    b.box(gloveDark, 0.052, 0.116, 0.020, 0, BORE_Y - 0.032, 0.320, -0.10, 0, 0, 0.008);
    b.box(polymer, 0.034, 0.026, 0.120, 0, BORE_Y + 0.030, 0.210, -0.03, 0, 0, 0.008);
    b.taper(polymer, 0.040, 0.036, 0.112, 0.050, 0, -0.044, 0.096, 0.30, 0, 0, 0.008);
    b.box(parker, 0.032, 0.008, 0.054, 0, -0.044, 0.056, 0, 0, 0, 0.002);
    b.box(wear, 0.010, 0.026, 0.008, 0, -0.028, 0.058, 0.18, 0, 0, 0.002);

    const sightY = BORE_Y + 0.062;
    b.box(parker, 0.028, 0.026, 0.014, 0, sightY - 0.006, 0.070, 0, 0, 0, 0.003);
    b.ring(parker, 0.0075, 0.0026, 0, sightY, 0.070, 0, 0, 0, 12);
    b.box(parker, 0.006, 0.028, 0.006, 0, sightY - 0.014, -0.400, 0, 0, 0, 0.001);
    b.box(parker, 0.024, 0.026, 0.006, 0, sightY - 0.016, -0.400, 0, 0, 0, 0.002);

    b.group("mag");
    // 200-round box, slung under the receiver.
    b.box(polymer, 0.072, 0.100, 0.130, 0, -0.078, -0.010, 0, 0, 0, 0.010);
    b.ribs(gloveDark, 3, 0.036, 0.076, 0.008, 0.010, 0, -0.078, -0.010);
    b.box(polymer, 0.056, 0.020, 0.040, 0, -0.020, -0.052, 0, 0, 0, 0.006);
    // The belt feeding up into the tray.
    for (let i = 0; i < 5; i += 1) {
      b.tube(brass, 0.0048, 0.0048, 0.032, -0.010 + i * 0.005, -0.014 + i * 0.006, -0.062 + i * 0.002,
        6, 0, Math.PI / 2, 0);
    }

    b.group("bolt");
    b.box(alum, 0.014, 0.020, 0.056, 0.030, 0.040, -0.010, 0, 0, 0, 0.004);
    b.tube(wear, 0.0085, 0.0085, 0.026, 0.038, 0.040, 0.018, null, 0, Math.PI / 2, 0);

    b.group("dust");
    b.box(parker, 0.004, 0.024, 0.062, 0.027, 0.036, -0.020, 0, 0, 0, 0.001);

    return finishWeapon(b, {
      name: "m249",
      sight: [0, sightY, -0.020],
      muzzle: [0, BORE_Y, -0.544],
      eject: [0.038, 0.040, -0.020],
      gripHand: [0.004, -0.070, 0.100, 0.30, 0, 0],
      supportHand: [-0.004, BORE_Y - 0.038, -0.232, -0.10, 0, 0],
      chargeHand: [0.060, 0.044, 0.018, 0, 0, 0],
      adsRelief: 0.145,
      boltTravel: 0.030,
      dustOpen: -1.1,
      magDrop: [0.02, -0.34, 0.0],
      ejectVelocity: [3.4, 2.0, 0.2],
      heavy: true,
    });
  }

  /** M9 - the slide is the whole animation budget here, and it is worth
   *  it: a pistol whose slide cycles reads correct instantly. */
  function buildM9() {
    const b = makeBuilder();

    // Frame, grip and trigger guard.
    b.box(alum, 0.030, 0.032, 0.130, 0, BORE_Y - 0.028, -0.036, 0, 0, 0, 0.005);
    b.taper(polymer, 0.032, 0.030, 0.106, 0.040, 0, -0.062, 0.036, 0.26, 0, 0, 0.007);
    b.ribs(polymer, 4, 0.011, 0.034, 0.014, 0.006, 0, -0.062, 0.036, 0.26, 0, 0);
    b.box(alum, 0.026, 0.008, 0.046, 0, -0.030, -0.014, 0, 0, 0, 0.002);
    b.box(alum, 0.026, 0.024, 0.008, 0, -0.018, 0.008, 0, 0, 0, 0.002);
    b.box(wear, 0.008, 0.022, 0.007, 0, -0.012, -0.016, 0.16, 0, 0, 0.002);
    // Hammer and the beavertail.
    b.box(alum, 0.010, 0.022, 0.012, 0, BORE_Y - 0.006, 0.066, -0.4, 0, 0, 0.003);
    b.box(alum, 0.028, 0.014, 0.024, 0, BORE_Y - 0.028, 0.060, -0.2, 0, 0, 0.004);
    // Magazine base showing under the grip.
    b.box(alum, 0.030, 0.010, 0.036, 0, -0.116, 0.048, 0.26, 0, 0, 0.003);

    const sightY = BORE_Y + 0.026;

    b.group("bolt");
    // Slide: the whole top half moves.
    b.box(blued, 0.032, 0.038, 0.180, 0, BORE_Y, -0.040, 0, 0, 0, 0.005);
    b.ribs(blued, 8, 0.0075, 0.034, 0.026, 0.0035, 0, BORE_Y - 0.002, 0.030);
    // Open-top barrel cut, exposing the barrel.
    b.tube(wear, 0.0090, 0.0090, 0.058, 0, BORE_Y + 0.004, -0.116, null);
    b.tube(blued, 0.0075, 0.0075, 0.020, 0, BORE_Y + 0.004, -0.128, null);
    // Safety/decocker lever.
    b.box(blued, 0.010, 0.014, 0.028, 0.018, BORE_Y + 0.006, 0.030, 0, 0, 0, 0.003);
    // Sights.
    b.box(blued, 0.018, 0.010, 0.008, 0, sightY, 0.040, 0, 0, 0, 0.002);
    b.box(blued, 0.005, 0.010, 0.006, 0, sightY, -0.122, 0, 0, 0, 0.001);
    b.disc(reticleMat, 0.0012, 0, sightY + 0.001, -0.1252);
    b.disc(reticleMat, 0.0010, -0.006, sightY + 0.001, 0.0442);
    b.disc(reticleMat, 0.0010, 0.006, sightY + 0.001, 0.0442);

    b.group("mag");
    b.box(alum, 0.026, 0.098, 0.030, 0, -0.062, 0.036, 0.26, 0, 0, 0.004);

    return finishWeapon(b, {
      name: "m9",
      sight: [0, sightY, -0.040],
      muzzle: [0, BORE_Y + 0.004, -0.142],
      eject: [0.020, BORE_Y + 0.014, -0.010],
      gripHand: [0.004, -0.052, 0.038, 0.26, 0, 0],
      supportHand: [-0.038, -0.054, 0.024, 0.26, 0, 0.5],
      chargeHand: [0.030, BORE_Y + 0.020, 0.020, 0, 0, 0],
      adsRelief: 0.245,
      boltTravel: 0.030,
      dustOpen: 0,
      magDrop: [0.005, -0.30, 0.02],
      ejectVelocity: [2.2, 2.4, 0.3],
      pistol: true,
      slideLock: true,
    });
  }

  /** Attach nodes and metadata to a finished build. */
  function finishWeapon(builder, spec) {
    const built = builder.finish(spec.name);
    const gun = built.root;
    gun.userData.parts = built.groups;
    gun.userData.spec = spec;

    const node = (arr) => new THREE.Vector3(arr[0], arr[1], arr[2]);
    gun.userData.sightLocal = node(spec.sight);
    gun.userData.muzzleLocal = node(spec.muzzle);
    gun.userData.ejectLocal = node(spec.eject);

    // Empty objects for anything that must be resolved to world space.
    const muzzle = new THREE.Object3D();
    muzzle.position.copy(gun.userData.muzzleLocal);
    gun.add(muzzle);
    gun.userData.muzzle = muzzle;

    const eject = new THREE.Object3D();
    eject.position.copy(gun.userData.ejectLocal);
    gun.add(eject);
    gun.userData.eject = eject;

    // Rest transforms of the animated groups, so animation can be
    // expressed as an offset from the modelled position.
    for (const group of Object.values(built.groups)) {
      group.userData.restPosition = group.position.clone();
      group.userData.restRotation = group.rotation.clone();
    }
    // The reticle draws after the glass.
    //
    // Depth sorting alone gets this wrong: the sight has a rear element
    // 66mm nearer the eye than the dot, so three quite correctly draws
    // the dark tinted glass OVER the dot and takes 62% of it away. A
    // real red dot is collimated at the front element and the shooter
    // sees it at full brightness; the tint belongs on the target behind
    // it, not on the dot. renderOrder rather than depthTest, so the
    // aluminium housing still occludes it from outside the tube.
    if (built.groups.reticle) {
      built.groups.reticle.traverse((o) => { if (o.isMesh) o.renderOrder = 5; });
    }
    return gun;
  }

  /* ------------------------------- rig ------------------------------- */

  const holder = new THREE.Group();
  root.add(holder);

  const guns = {
    rifle: buildM4(),
    carbine: buildAK(),
    marksman: buildM24(),
    smg: buildMP5(),
    lmg: buildM249(),
    pistol: buildM9(),
  };
  for (const gun of Object.values(guns)) {
    gun.visible = false;
    holder.add(gun);
  }

  const handR = buildHand(1, "vertical");
  const handL = buildHand(-1, "horizontal");
  holder.add(handR);
  holder.add(handL);

  /** A magazine that has been dropped. Lives on `root` rather than
   *  `holder` so it does not inherit the weapon's sway once it is out of
   *  the shooter's hand. */
  const droppedMag = new THREE.Group();
  root.add(droppedMag);
  const droppedMagBody = new THREE.Mesh(
    extrude(chamferRect(0.036, 0.026, 0.005), 0.170), polymer
  );
  droppedMagBody.rotation.x = Math.PI / 2;
  droppedMagBody.frustumCulled = false;
  droppedMag.add(droppedMagBody);
  droppedMag.visible = false;
  const dropState = { life: 0, velocity: new THREE.Vector3(), spin: new THREE.Vector3() };

  /* ------------------------------ poses ------------------------------ */

  /** Rest pose: weapon low and to the right, the way a rifle sits when
   *  it is not shouldered. */
  const HIP = {
    position: new THREE.Vector3(0.118, -0.128, -0.245),
    rotation: new THREE.Euler(0.055, -0.115, 0.028, "YXZ"),
  };

  const sway = { yaw: 0, pitch: 0, lastYaw: 0, lastPitch: 0, slowYaw: 0, slowPitch: 0 };
  const spring = {
    z: 0, zVel: 0,
    pitch: 0, pitchVel: 0,
    roll: 0, rollVel: 0,
    yaw: 0, yawVel: 0,
  };
  const anim = {
    bobPhase: 0,
    breathe: 0,
    sprint: 0,
    lower: 0,
    switching: 0,
    bolt: 0,          // 0..1 automatic bolt cycle
    boltHold: 0,
    manual: 0,        // 0..1 manual bolt cycle (marksman)
    dust: 0,
    charge: 0,
    reloadPhase: 0,
    reloadActive: 0,
    magVisible: 1,
    droppedThisReload: false,
    slideLocked: 0,
  };

  let current = guns.rifle;
  current.visible = true;
  let visible = true;
  let lastReloadRemaining = 0;

  /* ---------------------------- animation ---------------------------- */

  /**
   * Sample a keyframe track. Keys are `{ t, p:[x,y,z], r:[x,y,z] }` and
   * are smoothstep-interpolated, which is what makes a hand move like a
   * hand instead of sliding between waypoints at constant speed.
   */
  const _trackPos = new THREE.Vector3();
  const _trackRot = new THREE.Vector3();
  function sampleTrack(keys, t) {
    let a = keys[0];
    let b = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i += 1) {
      if (t >= keys[i].t && t <= keys[i + 1].t) { a = keys[i]; b = keys[i + 1]; break; }
      if (t < keys[0].t) { a = keys[0]; b = keys[0]; break; }
      if (t > keys[keys.length - 1].t) { a = b = keys[keys.length - 1]; break; }
    }
    const span = b.t - a.t;
    const k = span > 1e-5 ? smoothstep((t - a.t) / span) : 0;
    _trackPos.set(
      lerp(a.p[0], b.p[0], k), lerp(a.p[1], b.p[1], k), lerp(a.p[2], b.p[2], k)
    );
    const ar = a.r || [0, 0, 0];
    const br = b.r || [0, 0, 0];
    _trackRot.set(
      lerp(ar[0], br[0], k), lerp(ar[1], br[1], k), lerp(ar[2], br[2], k)
    );
    return k;
  }

  /** Magazine track, in gun space, as an offset from the seated
   *  position. Out at 0.20, back in by 0.62. */
  const MAG_TRACK = [
    { t: 0.00, p: [0, 0, 0] },
    { t: 0.13, p: [0, -0.006, 0] },
    { t: 0.22, p: [0.010, -0.150, 0.010] },
    { t: 0.40, p: [0.030, -0.420, 0.020] },
    { t: 0.46, p: [-0.020, -0.400, -0.030] },
    { t: 0.60, p: [0.002, -0.028, 0.004] },
    { t: 0.66, p: [0, 0, 0] },
    { t: 1.00, p: [0, 0, 0] },
  ];

  /** Support hand track during a reload, as an offset from its grip on
   *  the handguard. */
  const HAND_TRACK = [
    { t: 0.00, p: [0, 0, 0], r: [0, 0, 0] },
    { t: 0.12, p: [0.010, -0.050, 0.170], r: [0.2, 0.1, 0] },
    { t: 0.22, p: [0.022, -0.150, 0.185], r: [0.3, 0.1, 0] },
    { t: 0.40, p: [0.040, -0.400, 0.200], r: [0.5, 0.1, 0] },
    { t: 0.47, p: [-0.010, -0.380, 0.150], r: [0.4, 0.1, 0] },
    { t: 0.60, p: [0.004, -0.120, 0.180], r: [0.3, 0.1, 0] },
    { t: 0.68, p: [0.006, -0.060, 0.180], r: [0.2, 0.1, 0] },
    { t: 0.86, p: [0.004, -0.010, 0.030], r: [0.05, 0, 0] },
    { t: 1.00, p: [0, 0, 0], r: [0, 0, 0] },
  ];

  /** Same hand, but routed via the charging handle - the extra beat that
   *  distinguishes an empty reload from a tactical one. */
  const HAND_TRACK_EMPTY = [
    { t: 0.00, p: [0, 0, 0], r: [0, 0, 0] },
    { t: 0.10, p: [0.010, -0.050, 0.170], r: [0.2, 0.1, 0] },
    { t: 0.19, p: [0.022, -0.150, 0.185], r: [0.3, 0.1, 0] },
    { t: 0.34, p: [0.040, -0.400, 0.200], r: [0.5, 0.1, 0] },
    { t: 0.40, p: [-0.010, -0.380, 0.150], r: [0.4, 0.1, 0] },
    { t: 0.52, p: [0.004, -0.120, 0.180], r: [0.3, 0.1, 0] },
    { t: 0.58, p: [0.006, -0.060, 0.180], r: [0.2, 0.1, 0] },
    { t: 0.70, p: [0.030, 0.120, 0.330], r: [0.1, -0.3, 0] },
    { t: 0.80, p: [0.030, 0.120, 0.395], r: [0.1, -0.3, 0] },
    { t: 0.88, p: [0.020, 0.060, 0.270], r: [0.1, -0.2, 0] },
    { t: 1.00, p: [0, 0, 0], r: [0, 0, 0] },
  ];

  /* ---------------------------- shot events ---------------------------- */

  const _worldPos = new THREE.Vector3();
  const _worldVel = new THREE.Vector3();
  const _camQuat = new THREE.Quaternion();

  ctx.bus.on("weapon:fire", (payload) => {
    const spec = current.userData.spec;

    // Recoil impulse. Scaled by the weapon's own recoil numbers so the
    // view model and the camera agree about how hard the thing kicks.
    const def = payload && payload.def ? payload.def : weapons.state.def;
    const ads = player.state.adsAmount;
    const power = clamp(def.recoilPitch * 1.5 + def.damage / 90, 0.35, 2.6)
      * lerp(1, 0.66, ads);
    spring.zVel += 3.1 * power;
    spring.pitchVel += 7.4 * power;
    spring.rollVel += (rng() - 0.5) * 5.2 * power;
    spring.yawVel += (rng() - 0.5) * 4.4 * power;

    if (spec.manualBolt) {
      anim.manual = 1e-4;   // starts the manual cycle in update()
    } else {
      anim.bolt = 1;
      anim.boltHold = 0;
    }
    anim.dust = 1;

    // Eject the case. The port's world position has to be resolved
    // through the camera because the view scene is camera-relative.
    ejectCasing(def);
  });

  ctx.bus.on("weapon:reloadstart", () => {
    anim.droppedThisReload = false;
    anim.slideLocked = 0;
  });

  function ejectCasing(def) {
    if (!ctx.vfx || !ctx.vfx.ejectShell) return;
    const spec = current.userData.spec;
    current.updateMatrixWorld(true);
    current.userData.eject.getWorldPosition(_worldPos);

    // View space -> world space.
    render.camera.updateMatrixWorld();
    _worldPos.applyMatrix4(render.camera.matrixWorld);

    render.camera.getWorldQuaternion(_camQuat);
    const v = spec.ejectVelocity;
    _worldVel.set(
      v[0] * rng.range(0.8, 1.25),
      v[1] * rng.range(0.8, 1.3),
      v[2] * rng.range(0.4, 1.6)
    ).applyQuaternion(_camQuat);
    // Inherit the shooter's motion, or casings hang in the air when
    // firing on the move.
    _worldVel.add(player.velocity);

    ctx.vfx.ejectShell(_worldPos, _worldVel, {
      calibre: def.id === "marksman" || def.id === "lmg" ? 1.25 : def.id === "pistol" ? 0.85 : 1,
    });
  }

  /* ----------------------------- update ----------------------------- */

  const _fill = new THREE.Color();
  /** Floors on the view key's camera-space direction. See update(). */
  const KEY_MIN_FRONT = 0.18;
  const KEY_MIN_ABOVE = 0.40;
  /** How much of the sky's chroma the view fill keeps. */
  const VIEW_SKY_SAT = 0.36;
  const _sunDir = new THREE.Vector3();
  const _invCam = new THREE.Quaternion();
  const _adsPos = new THREE.Vector3();
  const _hipPos = new THREE.Vector3();
  const _sightWorld = new THREE.Vector3();
  const _rayDir = new THREE.Vector3();
  let wallProbeClock = 0;
  let wallDistance = 99;

  function update(dt) {
    const p = player.state;
    const def = weapons.state.def;
    const slot = weapons.state.slot;

    /* ---- keep the view scene lit by the world's sun ---- */
    // Mirroring the environment map matters more than it looks: without
    // it every metalness>0.8 material in the view scene renders black,
    // which is exactly how the first pass ended up with a rifle that was
    // a silhouette rather than an object.
    if (render.viewScene.environment !== render.scene.environment) {
      render.viewScene.environment = render.scene.environment;
      render.viewScene.environmentIntensity = render.scene.environmentIntensity ?? 1;
      /* And assign the probe onto each material, which is what makes
       * their envMapIntensity mean anything.
       *
       * Measured on this build: with no envMap of its own, a material
       * that inherits scene.environment ignores envMapIntensity
       * completely - a 12x sweep moves frame luma by 0.14. Only
       * scene.environmentIntensity scales the IBL, and that is one knob
       * for the whole world. Assigning the reference here costs a
       * shader recompile the first time and buys the one thing a weapon
       * needs that a scene-wide knob cannot give it: a polished optic
       * housing that takes more sky than the matte receiver bolted
       * under it. sky.js hands over a new probe on every weather and
       * time change, and this branch re-runs each time it does. */
      for (const material of ownedMaterials) {
        // needsUpdate only on null -> texture: that transition flips
        // USE_ENVMAP and needs a recompile, a later swap of one probe
        // for another does not, and recompiling fourteen materials
        // every time the weather eases is a visible hitch.
        const first = material.envMap === null;
        material.envMap = render.scene.environment;
        if (first) material.needsUpdate = true;
      }
    }
    syncTone();
    render.camera.getWorldQuaternion(_camQuat);
    _invCam.copy(_camQuat).invert();
    /* The key direction comes from sky.js, NOT from render.sun.position.
     *
     * This line read `render.sun.position.normalize()`, which is the
     * exact bug the round-2 post-mortem traced through three subsystems
     * (docs/blacksand-critic-round-2.md). render.js moves the sun to
     * `shadowFocus + direction * shadowDistance * 1.1` every frame,
     * where shadowFocus follows the camera - so normalising that point
     * returns a direction dominated by the player's world coordinates
     * rather than by the sun. On a 1024m map with a 200m shadow
     * distance, a player standing 500m from the origin gets a key light
     * pointing at the origin.
     *
     * render.js fixed its own copy of this and left a long comment
     * saying why. The view model kept the old one, which is why the
     * weapon could come back lit from the front in a backlit frame -
     * "props are shaded by a different light than the world", from the
     * critic's own list, and here it was literally true.
     *
     * A light's position is a shadow-rig detail. Its direction is scene
     * state, and scene state is read from the module that owns it. */
    const skyDir = ctx.sky && ctx.sky.sunDirection;
    if (skyDir) _sunDir.copy(skyDir);
    else _sunDir.copy(render.sun.position).sub(render.sun.target.position);
    _sunDir.normalize().applyQuaternion(_invCam);
    /* Clamped, not replaced.
     *
     * With the true direction restored the weapon is correctly backlit
     * whenever the player faces the sun - and a backlit view model has
     * no shading gradient at all, because there is no second light to
     * carry the form. Measured on the action-ads beauty shot: mean luma
     * 69 -> 53 and sd 33 -> 25, an evenly-lit olive slab, which is
     * worse than the bug it fixed.
     *
     * In camera space +Z is toward the viewer, so this puts a floor
     * under how far behind the weapon the key is allowed to get, and a
     * floor under its elevation, then renormalises. The x:y ratio
     * survives, so the highlight still travels across the receiver as
     * the player turns and still changes side at dawn and dusk - it
     * just never goes fully behind. Every first-person shooter cheats
     * this; the point of doing it as a clamp is that it costs nothing
     * for the 70% of headings where the sun is already usable. */
    if (_sunDir.z < KEY_MIN_FRONT) _sunDir.z = KEY_MIN_FRONT;
    if (_sunDir.y < KEY_MIN_ABOVE) _sunDir.y = KEY_MIN_ABOVE;
    _sunDir.normalize();
    vmKey.position.copy(_sunDir).multiplyScalar(1.4);
    vmKey.color.copy(render.sun.color);
    // The weapon is a hand's length from the lens and the world sun is
    // tuned for 400m of terrain; at full strength it blows out.
    vmKey.intensity = render.sun.intensity * 0.52 + 0.22;
    /* Fill, desaturated towards the world's own sky colour.
     *
     * The world's hemisphere is a clear desert sky and it is strongly
     * blue, which is correct for a wall forty metres away with nothing
     * between it and the dome. It is NOT correct for a weapon forty
     * CENTIMETRES from the eye: the top of that receiver mostly sees
     * the shooter, his plate carrier, his forearms and the ground he is
     * standing on, and only a slice of open sky. Taken at full
     * saturation, every up-facing surface on the weapon - rail crests,
     * receiver flats, optic housing - came back a hard cyan, and cyan
     * highlights on warm anodised aluminium are exactly what "reads as
     * unfired clay" looks like once you push it towards a colour.
     *
     * Mixing towards the sky's own luminance keeps the fill's LEVEL
     * exactly where the lighting agent puts it and moves only its
     * chroma, which is the same distinction the ground-shade fix in
     * docs/blacksand-critic-round-2.md turned out to hinge on. */
    _fill.copy(render.hemi.color);
    const skyLuma = _fill.r * 0.2126 + _fill.g * 0.7152 + _fill.b * 0.0722;
    vmFill.color.setRGB(
      lerp(skyLuma, _fill.r, VIEW_SKY_SAT),
      lerp(skyLuma, _fill.g, VIEW_SKY_SAT),
      lerp(skyLuma, _fill.b, VIEW_SKY_SAT)
    );
    vmFill.groundColor.copy(render.hemi.groundColor);
    /* 0.75x the world's hemisphere, not 1.35x.
     *
     * This is the reason the weapon had no shaded side. The view scene
     * receives THREE ambient terms, and two of them are the same sky:
     * this hemisphere light, and render.scene.environment, which
     * update() above inherits onto the view scene AND assigns onto
     * every gun material so their envMapIntensity means something. A
     * 1.35x multiplier on top of a full-strength probe is double
     * counting, and it lands as a floor under every surface normal the
     * key does not reach.
     *
     * Measured over the weapon's own pixels in action-firefight - not
     * the "weapon region", which is mostly sand: mean luma 72.6 with
     * 0.94% of the weapon's pixels below luma 20. A first-person weapon
     * is a dark object held in the shooter's own shade; the reference
     * puts 19-41% of the same near-field region under that line. The
     * weapon was not merely light, it had no blacks at all, and a
     * near-field object with no blacks is what makes a frame read flat.
     *
     * Cut here rather than in the grade, because the grade belongs to
     * render.js and because the defect is a ratio: the key is fine, the
     * fill was competing with it. */
    vmFill.intensity = render.hemi.intensity * 0.75 + 0.06;
    // Warm bounce from the shooter's own kit and the ground under him.
    // Real, and the reason the underside of the receiver is not a
    // silhouette - but it is the third ambient term, so it comes down
    // with the second rather than being left to backfill it.
    vmBounce.intensity = 0.17 + render.sun.intensity * 0.06;

    /* ---- weapon swap ---- */
    const wanted = guns[def.id] || guns.rifle;
    if (wanted !== current) {
      current.visible = false;
      current = wanted;
      current.visible = visible;
      anim.bolt = 0;
      anim.manual = 0;
      anim.dust = 0;
    }
    const spec = current.userData.spec;
    const parts = current.userData.parts;

    /* ---- aim sway: the weapon lags the camera ---- */
    // Measured against the camera's actual rotation rather than raw
    // mouse delta, so gamepad, touch and mouse all produce the same
    // sway. Two poles - a fast follow and a slow one - which is what
    // gives the settle its overshoot.
    const yawDelta = -(p.yaw - sway.lastYaw);
    const pitchDelta = -(p.pitch - sway.lastPitch);
    sway.lastYaw = p.yaw;
    sway.lastPitch = p.pitch;

    const swayScale = lerp(1, 0.24, p.adsAmount);
    sway.yaw = damp(sway.yaw, clamp(yawDelta * 9, -0.16, 0.16) * swayScale, 11, dt);
    sway.pitch = damp(sway.pitch, clamp(pitchDelta * 9, -0.14, 0.14) * swayScale, 11, dt);
    sway.slowYaw = damp(sway.slowYaw, sway.yaw, 4.5, dt);
    sway.slowPitch = damp(sway.slowPitch, sway.pitch, 4.5, dt);

    /* ---- recoil spring ---- */
    // Second order, under-damped on purpose. Stiffness and damping are
    // chosen so the overshoot is about 18% of the peak and the whole
    // thing settles in a bit over a fifth of a second - long enough to
    // read as mass, short enough not to fight a 780rpm trigger.
    const stiff = 168;
    const damping = 15.5;
    const integrate = (value, vel, k, c) => {
      const a = -value * k - vel * c;
      const nextVel = vel + a * dt;
      return [value + nextVel * dt, nextVel];
    };
    [spring.z, spring.zVel] = integrate(spring.z, spring.zVel, stiff, damping);
    [spring.pitch, spring.pitchVel] = integrate(spring.pitch, spring.pitchVel, stiff * 0.86, damping * 0.92);
    [spring.roll, spring.rollVel] = integrate(spring.roll, spring.rollVel, stiff * 0.7, damping * 1.05);
    [spring.yaw, spring.yawVel] = integrate(spring.yaw, spring.yawVel, stiff * 0.72, damping * 1.1);
    spring.z = clamp(spring.z, -0.012, 0.09);
    spring.pitch = clamp(spring.pitch, -0.05, 0.30);

    /* ---- movement bob ---- */
    const moving = p.grounded ? clamp01(p.speed / 5.2) : 0;
    anim.bobPhase += p.speed * dt * 2.1;
    const bobScale = moving * settings.prefs.headBob * lerp(1, 0.16, p.adsAmount);
    const bobX = Math.sin(anim.bobPhase * Math.PI) * 0.026 * bobScale;
    const bobY = Math.abs(Math.cos(anim.bobPhase * Math.PI)) * 0.020 * bobScale;
    const bobRoll = Math.sin(anim.bobPhase * Math.PI) * 0.038 * bobScale;

    /* ---- breathing ---- */
    // Amplitude tracks stamina debt, so a player who has just sprinted
    // to an angle cannot immediately hold it. This is the whole reason
    // stamina exists for a marksman.
    anim.breathe += dt * lerp(0.85, 2.3, 1 - p.stamina);
    const winded = clamp01((1 - p.stamina) * 1.25);
    const breathAmp = lerp(0.0026, 0.012, winded) * lerp(1, 1.7, p.adsAmount)
      * (spec.scope ? 1.6 : 1);
    const breathX = Math.sin(anim.breathe * 1.7) * breathAmp * 0.6;
    const breathY = Math.sin(anim.breathe) * breathAmp;

    /* ---- sprint pose ---- */
    // Weapon canted across the body while sprinting. This is what makes
    // sprinting read as "not ready to fire" without a UI element saying
    // so.
    anim.sprint = damp(anim.sprint, p.sprinting ? 1 : 0, 9, dt);

    /* ---- wall proximity ---- */
    // Muzzle-in-the-wall is the classic first-person tell. Probing at
    // 20Hz rather than every frame: the pose is damped anyway, and this
    // is a full physics raycast.
    wallProbeClock -= dt;
    if (wallProbeClock <= 0) {
      wallProbeClock = 0.05;
      _rayDir.copy(player.aimDirection);
      const probe = physics.raycast(player.eyePosition, _rayDir, 1.35, {
        layer: LAYER.STATIC | LAYER.DYNAMIC | LAYER.VEHICLE,
      });
      wallDistance = probe.hit ? probe.distance : 99;
    }
    const wallLength = spec.pistol ? 0.45 : 1.05;
    const wantLower = clamp01(1 - wallDistance / wallLength);
    anim.lower = damp(anim.lower, wantLower, 12, dt);

    /* ---- switch ---- */
    anim.switching = clamp01(weapons.switching / 0.42);

    /* ---- reload ---- */
    const reloadDuration = slot.reloadDuration || def.reloadTime;
    const reloading = slot.reloading > 0;
    const phase = reloading ? clamp01(1 - slot.reloading / Math.max(reloadDuration, 0.01)) : 0;
    anim.reloadPhase = phase;
    anim.reloadActive = damp(anim.reloadActive, reloading ? 1 : 0, 14, dt);
    const emptyReload = Boolean(slot.reloadEmpty);
    lastReloadRemaining = slot.reloading;

    /* ---- animated sub-assemblies ---- */
    // Magazine.
    if (parts.mag) {
      const rest = parts.mag.userData.restPosition;
      if (reloading) {
        sampleTrack(MAG_TRACK, phase);
        parts.mag.position.copy(rest).add(_trackPos);
        parts.mag.rotation.set(
          _trackPos.y * -1.4, _trackPos.x * 3.0, _trackPos.x * 2.0
        );
        // Hide the old magazine once it is clear of the well, and hand
        // it off to the dropped prop so it keeps falling.
        const gone = phase > 0.24 && phase < 0.44;
        parts.mag.visible = !gone;
        if (gone && !anim.droppedThisReload) {
          anim.droppedThisReload = true;
          startMagDrop(spec);
        }
      } else {
        parts.mag.position.copy(rest);
        parts.mag.rotation.copy(parts.mag.userData.restRotation);
        parts.mag.visible = true;
      }
    }

    // Automatic bolt / slide cycle.
    if (anim.bolt > 0) {
      anim.bolt = Math.max(0, anim.bolt - dt * (spec.pistol ? 22 : 26));
    }
    if (parts.bolt) {
      const rest = parts.bolt.userData.restPosition;
      let travel = 0;
      if (spec.manualBolt) {
        travel = 0;
      } else {
        // Sawtooth: fast back, slower return. A symmetric curve reads as
        // a wobble rather than as an action cycling.
        const c = 1 - anim.bolt;
        travel = c < 0.28 ? (c / 0.28) : (1 - (c - 0.28) / 0.72);
        travel = clamp01(travel) * spec.boltTravel;
      }
      if (anim.slideLocked > 0.5) travel = spec.boltTravel;
      parts.bolt.position.set(rest.x, rest.y, rest.z + travel);
    }

    // Manual bolt cycle - lift, pull, push, turn down.
    if (spec.manualBolt && parts.bolt) {
      if (anim.manual > 0) {
        anim.manual = Math.min(1, anim.manual + dt / Math.max(def.boltTime || 1.0, 0.2));
        if (anim.manual >= 1) anim.manual = 0;
      }
      const m = anim.manual;
      const rest = parts.bolt.userData.restPosition;
      const lift = smoothstep(clamp01(m / 0.18)) - smoothstep(clamp01((m - 0.72) / 0.20));
      const pull = smoothstep(clamp01((m - 0.16) / 0.24)) - smoothstep(clamp01((m - 0.52) / 0.22));
      parts.bolt.rotation.z = -lift * 1.25;
      parts.bolt.position.set(rest.x, rest.y, rest.z + pull * 0.088);
    }

    // Ejection port cover: snaps open on the first shot and stays open,
    // which is what a real one does.
    if (parts.dust && spec.dustOpen) {
      anim.dust = Math.max(anim.dust, weapons.state.shotsFired > 0 ? 0.6 : 0);
      const openAmount = damp(parts.dust.rotation.z / spec.dustOpen || 0, anim.dust > 0 ? 1 : 0, 16, dt);
      parts.dust.rotation.z = spec.dustOpen * clamp01(openAmount);
    }

    // Charging handle, pulled during an empty reload.
    if (parts.charge) {
      const rest = parts.charge.userData.restPosition;
      const pull = emptyReload && reloading
        ? smoothstep(clamp01((phase - 0.70) / 0.10)) - smoothstep(clamp01((phase - 0.80) / 0.06))
        : 0;
      anim.charge = pull;
      parts.charge.position.set(rest.x, rest.y, rest.z + pull * 0.085);
    }

    // Reticle brightness: a red dot washes out in daylight and glows at
    // dusk, and it should not be visible at all from off-axis.
    if (parts.reticle) {
      const onAxis = clamp01((p.adsAmount - 0.55) / 0.45);
      parts.reticle.visible = onAxis > 0.02;
      parts.reticle.scale.setScalar(lerp(0.7, 1, onAxis));
    }

    /* ---- compose the pose ---- */
    const ads = p.adsAmount;
    const lowerAmount = anim.lower * (1 - ads * 0.55);

    // Rotation first: the ADS position is solved against it.
    const rx = lerp(HIP.rotation.x, 0, ads)
      - sway.pitch * 1.45 - sway.slowPitch * 0.5
      + spring.pitch
      - anim.sprint * 0.20
      - anim.switching * 0.75
      + anim.reloadActive * 0.30
      + breathY * 1.4
      + lowerAmount * 0.62;
    const ry = lerp(HIP.rotation.y, 0, ads)
      - sway.yaw * 1.7 - sway.slowYaw * 0.6
      + spring.yaw
      - anim.sprint * 0.66
      - anim.reloadActive * 0.42
      + breathX * 1.1
      - lowerAmount * 0.30;
    const rz = lerp(HIP.rotation.z, 0, ads)
      + bobRoll
      + spring.roll
      + anim.sprint * 0.46
      + anim.reloadActive * 0.30
      + p.lean * -0.12
      + lowerAmount * 0.22;

    _euler.set(rx, ry, rz, "YXZ");
    holder.quaternion.setFromEuler(_euler);

    // Hip: authored offset plus the dynamics.
    _hipPos.set(
      HIP.position.x + sway.yaw * 0.40 + bobX + breathX,
      HIP.position.y + sway.pitch * 0.36 - bobY + breathY
        - anim.sprint * 0.055 - anim.switching * 0.34 - anim.reloadActive * 0.10
        - lowerAmount * 0.075,
      HIP.position.z + spring.z + anim.sprint * 0.03 + lowerAmount * 0.10
    );

    // ADS: solved, not authored. Whatever puts the sight node on the
    // optical axis is the aim pose - authoring it by hand is exactly how
    // weapons end up aiming slightly off centre, and the fault is
    // invisible until someone misses a shot they should have made.
    _v3b.copy(current.userData.sightLocal).applyQuaternion(holder.quaternion);
    _adsPos.set(
      -_v3b.x + sway.yaw * 0.10 + breathX * 0.5,
      -_v3b.y + sway.pitch * 0.10 + breathY * 0.8 - bobY * 0.25,
      -_v3b.z - spec.adsRelief + spring.z * 0.55
    );

    holder.position.lerpVectors(_hipPos, _adsPos, smoothstep(ads));

    /* ---- hands ---- */
    const grip = spec.gripHand;
    handR.position.set(grip[0], grip[1], grip[2]);
    handR.rotation.set(grip[3], grip[4], grip[5]);

    const support = spec.supportHand;
    handL.position.set(support[0], support[1], support[2]);
    handL.rotation.set(support[3], support[4], support[5]);

    if (reloading) {
      const track = emptyReload ? HAND_TRACK_EMPTY : HAND_TRACK;
      sampleTrack(track, phase);
      handL.position.add(_trackPos);
      handL.rotation.set(
        support[3] + _trackRot.x, support[4] + _trackRot.y, support[5] + _trackRot.z
      );
    }

    // A bolt-action's firing hand leaves the grip to work the bolt.
    if (spec.manualBolt && anim.manual > 0) {
      const m = anim.manual;
      const reach = smoothstep(clamp01(m / 0.16)) - smoothstep(clamp01((m - 0.78) / 0.20));
      const pull = smoothstep(clamp01((m - 0.16) / 0.24)) - smoothstep(clamp01((m - 0.52) / 0.22));
      const target = spec.chargeHand;
      handR.position.set(
        lerp(grip[0], target[0], reach),
        lerp(grip[1], target[1], reach),
        lerp(grip[2], target[2] + pull * 0.09, reach)
      );
      handR.rotation.set(lerp(grip[3], -0.2, reach), grip[4], lerp(grip[5], -1.1, reach));
    }

    // The support hand is only drawn on a pistol during a reload, when
    // it actually has something to do.
    handL.visible = !spec.pistol || reloading || ads < 0.5;
    if (spec.pistol && !reloading) {
      // Two-handed grip: the support hand wraps the firing hand.
      handL.position.set(support[0], support[1], support[2]);
      handL.rotation.set(support[3], support[4], support[5]);
    }

    /* ---- dropped magazine ---- */
    if (dropState.life > 0) {
      dropState.life -= dt;
      dropState.velocity.y -= 4.2 * dt;
      droppedMag.position.addScaledVector(dropState.velocity, dt);
      droppedMag.rotation.x += dropState.spin.x * dt;
      droppedMag.rotation.z += dropState.spin.z * dt;
      if (dropState.life <= 0) droppedMag.visible = false;
    }

    root.visible = visible && !p.inVehicle;
  }

  function startMagDrop(spec) {
    const magPart = current.userData.parts.mag;
    if (!magPart) return;
    droppedMag.visible = true;
    droppedMag.position.copy(holder.position)
      .add(_v3.copy(magPart.userData.restPosition).applyQuaternion(holder.quaternion))
      .add(_v3b.set(0, -0.05, 0));
    droppedMag.rotation.set(rng.range(-0.3, 0.3), rng.range(-0.4, 0.4), rng.range(-0.4, 0.4));
    dropState.velocity.set(spec.magDrop[0], spec.magDrop[1] * 0.35, spec.magDrop[2]);
    dropState.spin.set(rng.range(-3, 3), 0, rng.range(-4, 4));
    dropState.life = 1.1;
  }

  /* ---------------------------- late update ---------------------------- */

  /**
   * Per-weapon ADS field of view.
   *
   * player.js sets one generic ADS FOV for every weapon from
   * `prefs.adsFovScale`, which makes a 5.5x scope look through the same
   * hole as an iron-sighted carbine. The magnification a sight provides
   * is a property of the weapon, so it is applied here, after the player
   * module has run. `render.setFov` clamps to 40 degrees for sane player
   * FOV preferences, so a true scope has to be written onto the camera.
   */
  function lateUpdate() {
    if (ctx.qa && ctx.qa.cameraIsFree) return;
    if (!player.state.alive || player.state.inVehicle) return;

    const def = weapons.state.def;
    const ads = player.state.adsAmount;
    if (ads < 0.001 || !def.zoom) return;

    const base = settings.prefs.fov;
    const zoomed = clamp(base / def.zoom, 11, base);
    const fov = lerp(render.camera.fov, zoomed, smoothstep(ads));
    render.camera.fov = clamp(lerp(base, zoomed, smoothstep(ads)), 11, 120);
    render.camera.updateProjectionMatrix();
    // The view camera narrows with it so the scope body frames the view
    // instead of shrinking away from it.
    render.viewCamera.fov = lerp(58, def.zoom > 2 ? 30 : 42, smoothstep(ads));
    render.viewCamera.updateProjectionMatrix();
    void fov;
  }

  /* ------------------------------- api ------------------------------- */

  const _out = new THREE.Vector3();

  return {
    root,
    holder,
    guns,
    get current() { return current; },

    update,
    lateUpdate,

    setVisible(value) {
      visible = value;
      root.visible = value;
    },

    /** World-space muzzle position, so effects originate at the weapon
     *  rather than at the camera. */
    muzzleWorld(out = new THREE.Vector3()) {
      current.updateMatrixWorld(true);
      current.userData.muzzle.getWorldPosition(out);
      // The view scene is expressed in camera space; convert to world.
      render.camera.updateMatrixWorld();
      out.applyMatrix4(render.camera.matrixWorld);
      return out;
    },

    /** World-space ejection port. */
    ejectWorld(out = new THREE.Vector3()) {
      current.updateMatrixWorld(true);
      current.userData.eject.getWorldPosition(out);
      render.camera.updateMatrixWorld();
      out.applyMatrix4(render.camera.matrixWorld);
      return out;
    },

    /** True while the weapon is pressed against something and cannot be
     *  fired straight. Weapons reads this to block the shot. */
    get blocked() { return anim.lower > 0.62; },

    /**
     * QA: sweep the view scene's exposure offset without a code edit.
     *
     * The view model tone-maps itself, so where it sits relative to the
     * world is one constant - and the world's lighting is retuned by
     * another agent on its own schedule, which means that constant has
     * to be re-solved rather than remembered. Returning the value lets a
     * probe sweep it and read the answer back off the framebuffer.
     */
    toneScale(value) {
      if (value !== undefined) {
        toneScale = value;
        syncTone();
      }
      return toneScale;
    },

    /** QA: force an animation state so a capture can be posed. */
    debugPose(options = {}) {
      if (options.reloadPhase !== undefined) anim.reloadPhase = options.reloadPhase;
      if (options.bolt !== undefined) anim.bolt = options.bolt;
      if (options.manual !== undefined) anim.manual = options.manual;
      if (options.recoil !== undefined) {
        spring.zVel += options.recoil * 3.1;
        spring.pitchVel += options.recoil * 7.4;
      }
      return true;
    },

    report() {
      return {
        weapon: current.userData.spec.name,
        visible,
        recoilZ: Number(spring.z.toFixed(4)),
        recoilPitchDeg: Number((spring.pitch / DEG).toFixed(2)),
        ads: Number(player.state.adsAmount.toFixed(2)),
        reload: Number(anim.reloadPhase.toFixed(2)),
        lower: Number(anim.lower.toFixed(2)),
        wall: Number(Math.min(wallDistance, 99).toFixed(2)),
        drawCalls: Object.keys(current.userData.parts).length,
        pendingReload: Number(lastReloadRemaining.toFixed(2)),
        // The view scene is tone-mapped by the gun materials themselves,
        // so these are the numbers that decide whether the weapon is
        // exposed like the world it is standing in. Reported because a
        // weapon that is a stop bright is invisible in a whole-frame
        // mean and obvious in a still.
        tone: {
          ev: Number(tone.uEv.value.toFixed(3)),
          evScale: toneScale,
          metered: tone.uMeterRange.value.y > tone.uMeterRange.value.x,
          shadowLift: Number(tone.uShadowLift.value.toFixed(4)),
          lookSat: Number(tone.uLookSat.value.toFixed(3)),
        },
        // Load-path cost of the contact-occlusion bake.
        occlusion: {
          parts: occStat.parts,
          vertices: occStat.vertices,
          ms: Number(occStat.ms.toFixed(1)),
          // Mean and peak of the baked term, and what share of vertices
          // it actually touches. A bake that silently produces zeros
          // looks exactly like a bake that works, right up until an art
          // director says the optic floats off the rail.
          mean: Number((occStat.sum / Math.max(1, occStat.vertices)).toFixed(3)),
          max: Number(occStat.max.toFixed(3)),
          shadedPct: Number((occStat.shaded / Math.max(1, occStat.vertices) * 100).toFixed(1)),
        },
        envMapBound: ownedMaterials[0] ? Boolean(ownedMaterials[0].envMap) : false,
      };
    },

    dispose() {
      render.viewScene.remove(root);
      render.viewScene.remove(vmKey);
      render.viewScene.remove(vmFill);
      render.viewScene.remove(vmBounce);
      root.traverse((object) => {
        if (object.isMesh) object.geometry.dispose();
      });
      for (const material of ownedMaterials) material.dispose();
      ownedMaterials.length = 0;
      lensCoat.dispose();
      reticleGlow.dispose();
      reticleMat.dispose();
      surfaceTexture.dispose();
      coatTexture.dispose();
      glowTexture.dispose();
      void _out;
    },
  };
}
