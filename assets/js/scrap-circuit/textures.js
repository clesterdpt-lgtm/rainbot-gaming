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

  const TEXTURE_ASSET_VERSION = "20260704-ai-textures-1";
  const MANIFEST_URL = "../assets/textures/scrap-circuit/manifest.json";
  const TEXTURE_BASE_URL = "../assets/textures/scrap-circuit/";
  const registry = new Map(); // logical key -> [materials]
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
    if (key) {
      if (!registry.has(key)) registry.set(key, []);
      registry.get(key).push(material);
    }
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
    if (key) {
      if (!registry.has(key)) registry.set(key, []);
      registry.get(key).push(material);
    }
    return material;
  }

  function applyTexture(key, url) {
    loader.load(
      versioned(url),
      (texture) => {
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        if (THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
        (registry.get(key) || []).forEach((material) => {
          material.map = texture;
          material.color.set(0xffffff); // let the texture own the color
          material.needsUpdate = true;
        });
      },
      undefined,
      () => {} // missing file: keep the flat placeholder, no noise
    );
  }

  function load() {
    return fetch(versioned(MANIFEST_URL))
      .then((res) => (res.ok ? res.json() : null))
      .then((manifest) => {
        if (!manifest || !manifest.textures) return;
        Object.entries(manifest.textures).forEach(([key, path]) => {
          if (typeof path === "string" && path && registry.has(key)) {
            applyTexture(key, TEXTURE_BASE_URL + path);
          }
        });
      })
      .catch(() => {});
  }

  function versioned(url) {
    return `${url}${url.includes("?") ? "&" : "?"}v=${TEXTURE_ASSET_VERSION}`;
  }

  SCRAP.textures = { mat, basicMat, load, registry };
})();
