/* ============================================================
   BLACKSAND - material library

   Wraps the synthesised texture sets into MeshStandardMaterials with
   sensible physical parameters, and owns the shared shader chunks
   every surface needs (triplanar mapping, distance-based detail
   fading, wind).

   Materials are cached by name+options. Two meshes asking for "sand"
   at the same tiling share one material and therefore one shader
   program - which is the difference between 40 and 400 draw calls
   once the map is populated.
   ============================================================ */

import { clamp } from "./core.js";

export async function createMaterials(ctx) {
  const { THREE, textures, settings, render } = ctx;
  const cache = new Map();
  const registry = [];

  /**
   * Physical parameters per surface.
   *
   * `roughness` here is a *trim* on the ORM's green channel, not the
   * surface's roughness. The generators now author the real spread -
   * a formed concrete skin at 0.55 against its own exposed aggregate
   * at 0.89, sound paint at 0.26 against its own rust at 0.95 - so the
   * base sits at 1.0 for everything that is not a metal and the map is
   * taken at face value. It used to sit at 0.86-0.98 for every
   * non-metal, which multiplied every surface into the same narrow
   * bracket near the top of the range and is precisely why concrete,
   * brick, sand and painted steel all shaded identically.
   *
   * `normalScale` is likewise a trim; the generators calibrate their
   * own relief against the tile's metric size.
   */
  const SURFACES = {
    sand: { texture: "sand", repeat: 22, roughness: 1.0, metalness: 0, normalScale: 1.0, aoIntensity: 0.7 },
    dirt: { texture: "dirt", repeat: 18, roughness: 1.0, metalness: 0, normalScale: 1.0, aoIntensity: 0.9 },
    gravel: { texture: "gravel", repeat: 14, roughness: 1.0, metalness: 0, normalScale: 1.15, aoIntensity: 1.0 },
    rock: { texture: "rock", repeat: 6, roughness: 1.0, metalness: 0, normalScale: 1.25, aoIntensity: 1.0 },
    /* Normal amplitude is a material cue in its own right, and these
     * three sat inside 0.9-1.5 of each other while all three were also
     * inside 0.03 of one roughness. Two surfaces with the same relief
     * and the same sheen read as ONE surface whatever colour they are,
     * which is most of the standing "several panels are one swatch"
     * complaint. Pushed apart to what the materials physically are: a
     * sawn block face with recessed mortar has real depth, a formed
     * concrete skin has board steps and blowholes, and a trowelled lime
     * render is a SMOOTH skin whose whole character is where it has
     * cracked and fallen off - giving it as much relief as blockwork is
     * what stopped it reading as render. */
    concrete: { texture: "concrete", repeat: 4, roughness: 1.0, metalness: 0, normalScale: 1.15, aoIntensity: 1.0 },
    plaster: { texture: "plaster", repeat: 3, roughness: 1.0, metalness: 0, normalScale: 0.62, aoIntensity: 0.8 },
    blockwall: { texture: "blockwall", repeat: 3, roughness: 1.0, metalness: 0, normalScale: 1.62, aoIntensity: 1.2 },
    rubble: { texture: "rubble", repeat: 6, roughness: 1.0, metalness: 0, normalScale: 1.3, aoIntensity: 1.0 },
    drymud: { texture: "drymud", repeat: 8, roughness: 1.0, metalness: 0, normalScale: 1.2, aoIntensity: 1.0 },
    asphalt: { texture: "asphalt", repeat: 10, roughness: 0.94, metalness: 0, normalScale: 0.85, aoIntensity: 0.8 },
    // Rolled and brushed sheet steel really is anisotropic along the
    // roll direction; an isotropic lobe is what makes painted metal
    // read as painted plastic under a low sun.
    metal: {
      texture: "metal", repeat: 3, roughness: 0.92, metalness: 0.85,
      normalScale: 0.85, aoIntensity: 0.6, anisotropy: 0.45, anisotropyRotation: 0,
    },
    corrugated: {
      texture: "corrugated", repeat: 2, roughness: 0.95, metalness: 0.7,
      normalScale: 1.0, aoIntensity: 0.7, anisotropy: 0.55, anisotropyRotation: Math.PI * 0.5,
    },
    wood: { texture: "wood", repeat: 4, roughness: 0.97, metalness: 0, normalScale: 1.0, aoIntensity: 0.8 },
    sandbag: { texture: "sandbag", repeat: 2, roughness: 1.0, metalness: 0, normalScale: 1.1, aoIntensity: 0.9 },
    scrub: { texture: "scrub", repeat: 24, roughness: 1.0, metalness: 0, normalScale: 0.7, aoIntensity: 0.6 },
  };

  /**
   * Cache key.
   *
   * Every option that changes the built material has to be in here.
   * It used to be name + repeat + triplanar + transparent, so a caller
   * asking for concrete at roughness 0.4 was handed back whatever
   * concrete had been built with the first time anyone asked for it -
   * silently, with the requested parameters discarded and no way to
   * detect it short of reading the returned object. Callers who
   * noticed worked around it by cloning, which costs a draw call and a
   * shader program each time; callers who did not notice simply got
   * the wrong surface. Listed explicitly rather than JSON.stringified
   * because object key order is not guaranteed and two equivalent
   * option objects must produce the same string.
   */
  function key(name, options) {
    return [
      name,
      options.repeat ?? "",
      options.triplanar ? `tp${options.triplanarScale ?? ""}` : "",
      options.transparent ? "t" : "",
      options.roughness ?? "",
      options.metalness ?? "",
      options.normalScale ?? "",
      options.aoIntensity ?? "",
      options.envMapIntensity ?? "",
      options.alphaTest ?? "",
      options.side ?? "",
      options.color ?? "",
      options.anisotropy ?? "",
      options.anisotropyRotation ?? "",
    ].join("|");
  }

  /**
   * Triplanar projection, injected into a standard material.
   *
   * UV-mapped terrain stretches horribly on anything steeper than
   * about 40 degrees - the cliff faces on a desert map are exactly
   * where the stretch is most visible. Triplanar blends three
   * world-space projections by the surface normal, so a vertical face
   * is textured as correctly as a flat one and no UVs are needed.
   */
  function injectTriplanar(material, scale) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTriScale = { value: scale };
      shader.uniforms.uTriBlend = { value: 6.0 };

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `
          #include <common>
          varying vec3 vTriPos;
          varying vec3 vTriNormal;
        `)
        .replace("#include <worldpos_vertex>", `
          #include <worldpos_vertex>
          vTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vTriNormal = normalize(mat3(modelMatrix) * objectNormal);
        `);

      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `
          #include <common>
          varying vec3 vTriPos;
          varying vec3 vTriNormal;
          uniform float uTriScale;
          uniform float uTriBlend;

          vec3 triWeights() {
            vec3 w = pow(abs(vTriNormal), vec3(uTriBlend));
            return w / max(w.x + w.y + w.z, 1e-4);
          }

          vec4 triSample(sampler2D tex, vec3 w) {
            vec3 p = vTriPos * uTriScale;
            return texture2D(tex, p.zy) * w.x
                 + texture2D(tex, p.xz) * w.y
                 + texture2D(tex, p.xy) * w.z;
          }
        `)
        .replace("#include <map_fragment>", `
          #ifdef USE_MAP
            vec3 triW = triWeights();
            vec4 sampledDiffuseColor = triSample(map, triW);
            #ifdef DECODE_VIDEO_TEXTURE
              sampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);
            #endif
            diffuseColor *= sampledDiffuseColor;
          #endif
        `)
        .replace("#include <roughnessmap_fragment>", `
          float roughnessFactor = roughness;
          #ifdef USE_ROUGHNESSMAP
            roughnessFactor *= triSample(roughnessMap, triWeights()).g;
          #endif
        `)
        .replace("#include <normal_fragment_maps>", `
          #ifdef USE_NORMALMAP
            vec3 triW2 = triWeights();
            vec3 mapN = triSample(normalMap, triW2).xyz * 2.0 - 1.0;
            mapN.xy *= normalScale;
            // Whiteout blend: reconstruct each plane's normal in world
            // space and sum. Cheaper alternatives (swizzling one sample)
            // produce normals that point the wrong way on two of the
            // three axes, which reads as backwards lighting on cliffs.
            vec3 nx = vec3(0.0, mapN.yx);
            vec3 ny = vec3(mapN.x, 0.0, mapN.y);
            vec3 nz = vec3(mapN.xy, 0.0);
            vec3 blended = normalize(
                (vTriNormal + nx) * triW2.x
              + (vTriNormal + ny) * triW2.y
              + (vTriNormal + nz) * triW2.z
            );
            normal = normalize(blended);
          #endif
        `);

      material.userData.shader = shader;
    };
    // Any change to onBeforeCompile needs a new program key, or three
    // hands back the cached non-triplanar program.
    material.customProgramCacheKey = () => `triplanar-${scale.toFixed(4)}`;
  }

  function build(name, options = {}) {
    const surface = SURFACES[name];
    if (!surface) throw new Error(`[blacksand] no surface "${name}"`);

    const cacheKey = key(name, options);
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const set = textures.get(surface.texture);
    const repeat = options.repeat ?? surface.repeat;

    // Clone the textures so two materials can tile the same source at
    // different rates. Cloning shares the GPU upload; only the repeat
    // matrix differs. Memoised per source, because roughness and AO
    // now come from one packed ORM texture - cloning it twice would
    // hand three two objects backing the same image and defeat the
    // point of packing them.
    const clones = new Map();
    const clone = (texture) => {
      if (!texture) return null;
      if (clones.has(texture)) return clones.get(texture);
      const copy = texture.clone();
      copy.needsUpdate = true;
      copy.wrapS = THREE.RepeatWrapping;
      copy.wrapT = THREE.RepeatWrapping;
      copy.repeat.set(repeat, repeat);
      // Pin the AO/ORM read to uv0. Historically aoMap was hardwired
      // to the second UV set, and half the meshes in the game never
      // build one - the road, the vehicles, anything merged from
      // primitives - so their occlusion silently did nothing and every
      // recess on them lit as if it were flat. uv0 is the set every
      // mesh has, and it is the set the albedo already uses.
      copy.channel = 0;
      /* Anisotropic filtering, restated on the clone.
       *
       * Three allocates one GPU texture per *source*, and a clone
       * shares its source - so whichever clone happens to trigger the
       * upload is the one whose sampler state the driver keeps. Leaving
       * it to inherit means the value depends on upload order, and a
       * clone that lands on 1 puts a moire across every surface seen at
       * a grazing angle: canopy fabric from underneath and timber
       * viewed along its length are the two that show it first, because
       * both carry a fine periodic pattern with a very elongated screen
       * footprint. Setting it here makes the value deterministic.
       */
      copy.anisotropy = render.anisotropy;
      clones.set(texture, copy);
      return copy;
    };

    const anisotropic = surface.anisotropy > 0 && !options.triplanar;
    const Ctor = anisotropic ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;

    const material = new Ctor({
      map: options.triplanar ? set.map : clone(set.map),
      normalMap: options.triplanar ? set.normalMap : clone(set.normalMap),
      roughnessMap: options.triplanar ? set.roughnessMap : clone(set.roughnessMap),
      aoMap: options.triplanar ? null : clone(set.aoMap),
      roughness: options.roughness ?? surface.roughness,
      metalness: options.metalness ?? surface.metalness,
      envMapIntensity: options.envMapIntensity ?? 1.0,
      side: options.side ?? THREE.FrontSide,
      transparent: Boolean(options.transparent),
      alphaTest: options.alphaTest ?? 0,
      color: options.color !== undefined ? new THREE.Color(options.color) : 0xffffff,
      dithering: true,
    });

    material.name = `bs-${name}`;
    material.normalScale.setScalar(options.normalScale ?? surface.normalScale);
    material.aoMapIntensity = options.aoIntensity ?? surface.aoIntensity;
    if (anisotropic) {
      material.anisotropy = options.anisotropy ?? surface.anisotropy;
      material.anisotropyRotation = options.anisotropyRotation ?? surface.anisotropyRotation ?? 0;
    }

    if (options.triplanar) injectTriplanar(material, options.triplanarScale ?? (repeat / 100));

    cache.set(cacheKey, material);
    registry.push(material);
    return material;
  }

  /* ------------------------ flat / utility ------------------------ */

  function flat(colour, options = {}) {
    const cacheKey = `flat|${colour}|${JSON.stringify(options)}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colour),
      roughness: options.roughness ?? 0.85,
      metalness: options.metalness ?? 0.0,
      envMapIntensity: options.envMapIntensity ?? 1.0,
      transparent: Boolean(options.transparent),
      opacity: options.opacity ?? 1,
      side: options.side ?? THREE.FrontSide,
      emissive: options.emissive !== undefined ? new THREE.Color(options.emissive) : 0x000000,
      emissiveIntensity: options.emissiveIntensity ?? 1,
      dithering: true,
      flatShading: Boolean(options.flatShading),
    });
    cache.set(cacheKey, material);
    registry.push(material);
    return material;
  }

  /** Unlit additive, for tracers, flashes and glass glints. */
  function additive(colour, options = {}) {
    const cacheKey = `add|${colour}|${JSON.stringify(options)}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colour),
      map: options.map || null,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: options.opacity ?? 1,
      toneMapped: false,
      side: options.side ?? THREE.DoubleSide,
    });
    cache.set(cacheKey, material);
    registry.push(material);
    return material;
  }

  /* ------------------------------ api ------------------------------ */

  const api = {
    SURFACES,
    build,
    flat,
    additive,
    get: build,

    /** Every material, so a global tweak (env intensity after a
     *  weather change) can be applied without hunting the scene graph. */
    all() { return registry.slice(); },

    setEnvIntensity(value) {
      for (const material of registry) {
        if ("envMapIntensity" in material) material.envMapIntensity = value;
      }
    },

    dispose() {
      for (const material of registry) material.dispose();
      registry.length = 0;
      cache.clear();
    },
  };

  return api;
}
