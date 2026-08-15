/* ============================================================
   APOP DEMON MOGGERS 3D - render

   Owns the WebGLRenderer, the resolution controller, the shadow
   cadence and the post chain. Nothing else calls renderer.render().

   Three hard-won rules live in here and must not be undone:

   1. Resizing a canvas CLEARS it. Any resize therefore has to be
      followed by a draw in the same frame or the user sees a black
      flash. The dynamic-resolution controller below only ever
      changes the drawing-buffer size immediately before a draw.

   2. Adding a light to a scene recompiles every material in it.
      The full light set is allocated once at course load and
      dimmed to zero rather than added and removed.

   3. sRGB gets applied exactly once. outputColorSpace does it at
      the end of the chain; colour textures are tagged SRGBColorSpace
      on load. Anything that renders to an intermediate target
      renders in linear and only the final pass encodes.

   ------------------------------------------------------------
   THE TONE MAPPER IS ACES, AND IT WAS TESTED RATHER THAN INHERITED.

   A blind review found that nothing in this game changes value with
   its orientation, and one plausible culprit was this line: the food
   court's lit deck was rendering at 238 of 255, which is deep in the
   ACES shoulder, where the curve's slope is roughly a fifth of what it
   is at 190. A shadow removing sixty per cent of the light was
   arriving on screen as a 28-point step. That is real, and it is a
   symptom rather than the cause.

   Both mappers were run through the Lambert response analytically at a
   MATCHED lit-floor value of 190 - which is the only fair comparison,
   since an unmatched one just measures exposure - and the orientation
   span of a vertical surface came out:

     ACES     77 open / 12 inside a shadow
     Neutral  70 open / 11 inside a shadow

   The Khronos neutral mapper is very nearly linear below 0.76 and so
   looks like it should preserve mid-tone contrast better; at a matched
   exposure it does not, because the light being spread over that
   linear segment is the same light either way. The scene was simply
   over-lit, which is a sky.js problem and is fixed there (see THE
   KEY/FILL RATIO in that file). Do not swap this line to chase a
   value-range finding without re-running that comparison - it costs
   every course its authored exposure and buys nothing.
   ============================================================ */

import * as THREE from "three";
import { clamp, Rolling } from "apop3d/core.js";

const MIN_SCALE = 0.62;
const MAX_SCALE = 1.0;
const TARGET_MS = 15.0;   // leave headroom under the 16.7ms frame
const RELAX_MS = 11.5;

export function create(ctx) {
  const canvas = ctx.canvas;

  // The screenshot harness reads the drawing buffer directly with
  // canvas.toDataURL rather than going through the browser compositor,
  // because headless Chromium only composites on a real animation frame
  // and hands back a stale surface otherwise. That read is only valid
  // if the buffer survives the swap, hence preserveDrawingBuffer under
  // qa=1. It costs real performance, so it is never on for players.
  const qaMode = /(?:\?|&)qa=1(?:&|$)/.test(window.location.search);
  ctx.qaMode = qaMode;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
    stencil: false,
    preserveDrawingBuffer: qaMode,
  });
  renderer.setClearColor(0x0b0714, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;   // we drive it on a cadence
  renderer.info.autoReset = false;

  ctx.renderer = renderer;

  const state = {
    scale: 1,
    pinned: false,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    cssW: 0,
    cssH: 0,
    frameMs: new Rolling(45),
    lastFrameStart: performance.now(),
    shadowPhase: 0,
    shadowEvery: 2,
  };

  function cssSize() {
    const rect = canvas.getBoundingClientRect();
    // The preview pane reports innerWidth 0; fall back to the attribute
    // size rather than collapsing the buffer to nothing.
    const w = Math.max(1, Math.round(rect.width || canvas.width || 1280));
    const h = Math.max(1, Math.round(rect.height || canvas.height || 720));
    return { w, h };
  }

  function applySize() {
    const { w, h } = cssSize();
    const scale = state.pinned ? 1 : state.scale;
    const bw = Math.max(2, Math.round(w * state.dpr * scale));
    const bh = Math.max(2, Math.round(h * state.dpr * scale));
    const cur = renderer.getSize(new THREE.Vector2());
    if (Math.abs(cur.x - bw) > 1 || Math.abs(cur.y - bh) > 1 || state.cssW !== w || state.cssH !== h) {
      state.cssW = w; state.cssH = h;
      renderer.setPixelRatio(1);
      renderer.setSize(bw, bh, false);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (ctx.camera) {
        ctx.camera.aspect = w / h;
        ctx.camera.updateProjectionMatrix();
      }
      ctx.bus.emit("render:resize", { w, h, bw, bh });
    }
  }

  /** Nudge the internal resolution toward the frame budget. Runs once
   *  per frame, immediately before the draw, so the clear that a
   *  resize triggers is repainted in the same frame. */
  function tuneResolution() {
    if (state.pinned) { state.scale = 1; return; }
    const p95 = state.frameMs.percentile(0.95);
    if (p95 > TARGET_MS && state.scale > MIN_SCALE) {
      state.scale = clamp(state.scale - 0.04, MIN_SCALE, MAX_SCALE);
    } else if (p95 < RELAX_MS && state.scale < MAX_SCALE) {
      state.scale = clamp(state.scale + 0.02, MIN_SCALE, MAX_SCALE);
    }
  }

  function draw(ctx) {
    const now = performance.now();
    state.frameMs.push(now - state.lastFrameStart);
    state.lastFrameStart = now;

    tuneResolution();
    applySize();

    // Shadow cadence. A 2048 map redrawn every second frame is
    // indistinguishable in motion and buys back several milliseconds.
    state.shadowPhase = (state.shadowPhase + 1) % state.shadowEvery;
    renderer.shadowMap.needsUpdate = state.pinned || state.shadowPhase === 0;

    renderer.info.reset();
    renderer.render(ctx.scene, ctx.camera);
  }

  const onResize = () => applySize();
  window.addEventListener("resize", onResize);
  applySize();

  return {
    renderer,
    get scale() { return state.scale; },

    /** Freeze resolution and shadow cadence so screenshot goldens are
     *  byte-comparable between runs. The harness sets this via qa.js. */
    pin(on) {
      state.pinned = !!on;
      state.shadowEvery = on ? 1 : 2;
      if (on) { state.scale = 1; applySize(); }
    },

    setExposure(v) { renderer.toneMappingExposure = v; },

    stats() {
      const i = renderer.info;
      return {
        ms: state.frameMs.mean,
        fps: state.frameMs.mean > 0 ? 1000 / state.frameMs.mean : 0,
        draws: i.render.calls,
        tris: i.render.triangles,
        programs: i.programs ? i.programs.length : 0,
        scale: state.scale,
      };
    },

    lateUpdate(ctx) { draw(ctx); },
    draw,

    /** Force a synchronous draw outside the loop. The harness calls this
     *  after it has posed the camera, so the buffer it reads is exactly
     *  the frame it asked for and not whatever rAF last produced. */
    renderOnce() {
      applySize();
      renderer.shadowMap.needsUpdate = true;
      renderer.info.reset();
      renderer.render(ctx.scene, ctx.camera);
    },

    dispose() {
      window.removeEventListener("resize", onResize);
      renderer.dispose();
    },
  };
}
