// =============================================================
// post.js — Phase 2 post-processing (no Three.js addons needed)
//
// Renders the astral scene to an offscreen target, then draws a full-
// screen quad that grades it: spectral monochrome palette, chromatic
// aberration, film grain, vignette, and horizontal "static" — the
// distortion rises with the entity's proximity and IS the threat meter.
// =============================================================

(function () {
window.TW = window.TW || {};
const THREE = window.THREE;

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uAberration;   // 0..1 proximity
uniform float uGrain;
uniform float uStatic;
uniform vec2  uResolution;
varying vec2 vUv;

float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 uv = vUv;
  vec2 dir = uv - 0.5;

  // horizontal static jitter when something is very close
  float jitter = uStatic * (rand(vec2(floor(uv.y * 90.0), floor(uTime * 16.0))) - 0.5) * 0.04;
  uv.x += jitter;

  // chromatic aberration — grows toward the edges and with proximity
  float amt = 0.0016 + uAberration * 0.014;
  float r = texture2D(tDiffuse, uv - dir * amt).r;
  float g = texture2D(tDiffuse, uv).g;
  float b = texture2D(tDiffuse, uv + dir * amt).b;
  vec3 col = vec3(r, g, b);

  // spectral palette: crush to near-grayscale, tint cold, lift contrast
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 spectral = mix(vec3(lum), col, 0.12);
  spectral = (spectral - 0.5) * 1.16 + 0.5;
  spectral *= vec3(0.80, 0.93, 1.10);

  // vignette (tightens as the entity nears)
  float vig = smoothstep(0.92, 0.28, length(dir));
  spectral *= mix(1.0, vig, 0.55 + uAberration * 0.35);

  // linear -> sRGB for display (scene was tone-mapped into a linear target)
  spectral = pow(max(spectral, 0.0), vec3(0.4545));

  // grain + static applied in DISPLAY space, so dark areas don't blow up
  // into harsh noise under the gamma curve
  float grain = (rand(uv * uResolution * 0.6 + uTime) - 0.5) * uGrain;
  spectral += grain;
  if (uStatic > 0.001) {
    float s = rand(vec2(floor(uv.y * 120.0) + uTime * 10.0, uTime * 2.0));
    spectral += (s - 0.5) * uStatic * 0.5;
  }
  gl_FragColor = vec4(spectral, 1.0);
}
`;

TW.Post = class Post {
  constructor(renderer) {
    this.renderer = renderer;
    const size = new THREE.Vector2();
    renderer.getSize(size);
    const dpr = renderer.getPixelRatio();
    const w = Math.max(2, Math.floor(size.x * dpr));
    const h = Math.max(2, Math.floor(size.y * dpr));

    this.rt = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, stencilBuffer: false,
    });

    this.uniforms = {
      tDiffuse:    { value: this.rt.texture },
      uTime:       { value: 0 },
      uAberration: { value: 0 },
      uGrain:      { value: 0.055 },
      uStatic:     { value: 0 },
      uResolution: { value: new THREE.Vector2(w, h) },
    };

    this.scene = new THREE.Scene();
    this.cam = new THREE.Camera();
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      depthTest: false, depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  }

  setSize(w, h) {
    const dpr = this.renderer.getPixelRatio();
    const pw = Math.max(2, Math.floor(w * dpr));
    const ph = Math.max(2, Math.floor(h * dpr));
    this.rt.setSize(pw, ph);
    this.uniforms.uResolution.value.set(pw, ph);
  }

  render(scene, camera, dt, prox) {
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uAberration.value = prox;
    u.uStatic.value = prox > 0.55 ? (prox - 0.55) * 0.9 : 0;

    this.renderer.setRenderTarget(this.rt);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.cam);
  }

  dispose() {
    this.rt.dispose();
  }
};
})();
