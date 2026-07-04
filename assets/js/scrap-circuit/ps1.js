/* ============================================================
   SCRAP CIRCUIT — Ps1Renderer
   ------------------------------------------------------------
   Reusable PS1-era rendering pipeline for Rainbot 3D games:
   1. Low internal render resolution (default 480x270) drawn to an
      offscreen render target with NearestFilter, blitted to the
      visible canvas as hard pixels (pair with CSS
      `image-rendering: pixelated` on the canvas).
   2. Clip-space vertex snap (`SCRAP.ps1ify(material)`) so geometry
      wobbles like a console with no sub-pixel vertex precision.
   3. Ordered 4x4 Bayer dither + 15-bit color quantize in the blit
      shader to fake period color depth.
   Fog/lighting stay the caller's job (per-arena palettes).
   ============================================================ */
(() => {
  "use strict";
  const SCRAP = (window.SCRAP = window.SCRAP || {});

  /* Vertex-snap strength: clip-space positions quantize onto a grid
     of GRID x GRID steps across the internal target. Slightly finer
     than the pixel grid reads as charm instead of soup. Texture-mapped
     materials can opt out because the snap turns busy asphalt/water maps
     into visible shimmer while the camera follows the car. */
  const SNAP_UNIFORM = { value: new THREE.Vector2(160, 90) };

  function ps1ify(material) {
    if (material.userData.ps1ified) return material;
    material.userData.ps1ified = true;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uPs1SnapEnabled = { value: material.userData.ps1SnapEnabled === false ? 0 : 1 };
      shader.uniforms.uPs1Snap = SNAP_UNIFORM;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform vec2 uPs1Snap;\nuniform float uPs1SnapEnabled;"
        )
        .replace(
          "#include <project_vertex>",
          [
            "#include <project_vertex>",
            "// PS1 wobble: snap clip-space xy to a coarse grid.",
            "if (uPs1SnapEnabled > 0.5) {",
            "  vec2 psGrid = uPs1Snap;",
            "  gl_Position.xy = floor(gl_Position.xy / gl_Position.w * psGrid + 0.5) / psGrid * gl_Position.w;",
            "}",
          ].join("\n")
        );
    };
    material.needsUpdate = true;
    return material;
  }

  const BLIT_VERT = [
    "varying vec2 vUv;",
    "void main() {",
    "  vUv = uv;",
    "  gl_Position = vec4(position.xy, 0.0, 1.0);",
    "}",
  ].join("\n");

  const BLIT_FRAG = [
    "uniform sampler2D tScene;",
    "uniform vec2 uSize;",
    "uniform float uDither;",
    "varying vec2 vUv;",
    "float bayer(vec2 p) {",
    "  // 4x4 Bayer matrix, values 0..15 mapped to -0.5..0.5",
    "  int x = int(mod(p.x, 4.0));",
    "  int y = int(mod(p.y, 4.0));",
    "  int i = y * 4 + x;",
    "  float m = 0.0;",
    "  if (i == 0) m = 0.0;  else if (i == 1) m = 8.0;  else if (i == 2) m = 2.0;  else if (i == 3) m = 10.0;",
    "  else if (i == 4) m = 12.0; else if (i == 5) m = 4.0;  else if (i == 6) m = 14.0; else if (i == 7) m = 6.0;",
    "  else if (i == 8) m = 3.0;  else if (i == 9) m = 11.0; else if (i == 10) m = 1.0; else if (i == 11) m = 9.0;",
    "  else if (i == 12) m = 15.0; else if (i == 13) m = 7.0; else if (i == 14) m = 13.0; else m = 5.0;",
    "  return m / 16.0 - 0.5;",
    "}",
    "void main() {",
    "  vec3 c = texture2D(tScene, vUv).rgb;",
    "  // 15-bit color: 32 levels per channel, ordered dither hides banding.",
    "  float d = bayer(floor(vUv * uSize)) * uDither;",
    "  c = floor((c + d / 32.0) * 31.0 + 0.5) / 31.0;",
    "  gl_FragColor = vec4(c, 1.0);",
    "}",
  ].join("\n");

  class Ps1Renderer {
    constructor(canvas, opts = {}) {
      this.width = opts.width || 480;
      this.height = opts.height || 270;
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
      });
      // Hard pixels: the internal target does the work, never the DPR.
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
      if (THREE.sRGBEncoding) this.renderer.outputEncoding = THREE.sRGBEncoding;

      this.target = new THREE.WebGLRenderTarget(this.width, this.height, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: true,
        stencilBuffer: false,
      });
      if (THREE.sRGBEncoding) this.target.texture.encoding = THREE.sRGBEncoding;

      this.blitScene = new THREE.Scene();
      this.blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.blitMaterial = new THREE.ShaderMaterial({
        uniforms: {
          tScene: { value: this.target.texture },
          uSize: { value: new THREE.Vector2(this.width, this.height) },
          uDither: { value: opts.dither == null ? 1 : opts.dither },
        },
        vertexShader: BLIT_VERT,
        fragmentShader: BLIT_FRAG,
        depthTest: false,
        depthWrite: false,
      });
      this.blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMaterial));
    }

    /* Fit the visible canvas to its wrap; internal resolution stays fixed
       but the aspect follows the canvas so max-screen works at any shape. */
    resize(displayWidth, displayHeight) {
      const aspect = displayWidth / Math.max(1, displayHeight);
      const innerH = this.height;
      const innerW = Math.round(innerH * aspect);
      if (innerW !== this.width) {
        this.width = innerW;
        this.target.setSize(this.width, this.height);
        this.blitMaterial.uniforms.uSize.value.set(this.width, this.height);
        SNAP_UNIFORM.value.set(this.width / 3, this.height / 3);
      }
      this.renderer.setSize(displayWidth, displayHeight, false);
      return aspect;
    }

    render(scene, camera) {
      this.renderer.setRenderTarget(this.target);
      this.renderer.render(scene, camera);
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.blitScene, this.blitCamera);
    }

    setDither(amount) {
      this.blitMaterial.uniforms.uDither.value = amount;
    }
  }

  SCRAP.Ps1Renderer = Ps1Renderer;
  SCRAP.ps1ify = ps1ify;
})();
