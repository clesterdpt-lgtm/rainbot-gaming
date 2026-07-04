/* ============================================================
   SCRAP CIRCUIT — texture manifest + material registry
   ------------------------------------------------------------
   Hard requirement: the game ships with flat/vertex-colored
   placeholder materials, but hand-picked AI textures must drop in
   later with ZERO code changes.

   How it works:
   - Every material is created via SCRAP.textures.mat(key, options)
     and registered under its logical key.
   - assets/textures/scrap-circuit/manifest.json maps logical keys to
     texture paths (relative to the manifest's folder). Promoting an
     entry from "planned" into "textures" + dropping the PNG is the
     whole retrofit step.
   - On boot, load() fetches the manifest and applies any texture that
     resolves (NearestFilter — mip blur would break the PS1 look).
     Anything missing keeps its flat placeholder, silently.
   ============================================================ */
(() => {
  "use strict";
  const SCRAP = (window.SCRAP = window.SCRAP || {});

  const TEXTURE_ASSET_VERSION = "20260704-ai-textures-2";
  const MANIFEST_URL = "../assets/textures/scrap-circuit/manifest.json";
  const TEXTURE_BASE_URL = "../assets/textures/scrap-circuit/";
  const registry = new Map(); // logical key -> [materials]
  const textureUrls = new Map(); // logical key -> versionless URL
  const textureCache = new Map(); // logical key -> loaded texture
  const pendingLoads = new Map(); // logical key -> true while TextureLoader is in flight
  const loader = new THREE.TextureLoader();

  function mat(key, options = {}) {
    const material = new THREE.MeshLambertMaterial({
      color: options.color == null ? 0xffffff : options.color,
      emissive: options.emissive == null ? 0x000000 : options.emissive,
      emissiveIntensity: options.emissiveIntensity == null ? 1 : options.emissiveIntensity,
      transparent: !!options.transparent,
      opacity: options.opacity == null ? 1 : options.opacity,
      side: options.side || THREE.FrontSide,
      vertexColors: !!options.vertexColors,
      // (r128 Lambert is Gouraud-lit — per-vertex, which is period-correct)
    });
    if (SCRAP.ps1ify) SCRAP.ps1ify(material);
    registerMaterial(key, material);
    return material;
  }

  /* Unlit variant for glowy bits (signs, beams, FX) — same registry. */
  function basicMat(key, options = {}) {
    const material = new THREE.MeshBasicMaterial({
      color: options.color == null ? 0xffffff : options.color,
      transparent: !!options.transparent,
      opacity: options.opacity == null ? 1 : options.opacity,
      side: options.side || THREE.FrontSide,
      vertexColors: !!options.vertexColors,
    });
    if (SCRAP.ps1ify) SCRAP.ps1ify(material);
    registerMaterial(key, material);
    return material;
  }

  function registerMaterial(key, material) {
    if (!key) return;
    if (!registry.has(key)) registry.set(key, []);
    registry.get(key).push(material);
    const texture = textureCache.get(key);
    if (texture) {
      applyLoadedTexture(material, texture);
    } else if (textureUrls.has(key)) {
      loadTexture(key);
    }
  }

  function loadTexture(key) {
    const url = textureUrls.get(key);
    if (!url || textureCache.has(key) || pendingLoads.has(key)) return;
    pendingLoads.set(key, true);
    loader.load(
      versioned(url),
      (texture) => {
        pendingLoads.delete(key);
        prepareTexture(texture);
        textureCache.set(key, texture);
        (registry.get(key) || []).forEach((material) => applyLoadedTexture(material, texture));
      },
      undefined,
      () => { pendingLoads.delete(key); } // missing file: keep the flat placeholder, no noise
    );
  }

  function load() {
    return fetch(versioned(MANIFEST_URL))
      .then((res) => (res.ok ? res.json() : null))
      .then((manifest) => {
        if (!manifest || !manifest.textures) return;
        Object.entries(manifest.textures).forEach(([key, path]) => {
          if (typeof path === "string" && path) {
            textureUrls.set(key, TEXTURE_BASE_URL + path);
            loadTexture(key);
          }
        });
      })
      .catch(() => {});
  }

  function prepareTexture(texture) {
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    if (THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
  }

  function applyLoadedTexture(material, texture) {
    material.map = texture;
    material.color.set(0xffffff); // let the texture own the color
    material.needsUpdate = true;
  }

  function versioned(url) {
    return `${url}${url.includes("?") ? "&" : "?"}v=${TEXTURE_ASSET_VERSION}`;
  }

  SCRAP.textures = { mat, basicMat, load, registry, textureCache };
})();
