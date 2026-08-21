/* ============================================================
   APOP DEMON MOGGERS 3D - boot loader

   Classic (non-module) script. Picks a working CDN for Three.js,
   installs the import map, then hands off to the ESM entry point.

   Modelled on assets/js/blacksand/boot.js. The reason every module
   is listed in MODULES rather than just the entry point: without the
   per-module ?v= pin, only boot.js and main.js carry a cache-buster,
   and a browser happily keeps serving whatever player.js or world.js
   it already had - which makes a shipped fix look like it did nothing.
   ============================================================ */
(() => {
  "use strict";

  const BUILD = "20260821-spawn-1";
  const THREE_VERSION = "0.180.0";
  const CDN_BASES = [
    `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/`,
    `https://unpkg.com/three@${THREE_VERSION}/`,
  ];

  const scriptUrl = document.currentScript
    ? document.currentScript.src
    : new URL("assets/js/apop3d/boot.js", document.baseURI).href;
  const MODULE_ROOT = new URL("./", scriptUrl).href;

  const bootEl = document.getElementById("ap-boot");
  const fillEl = document.getElementById("ap-boot-fill");
  const statusEl = document.getElementById("ap-boot-status");
  const errorEl = document.getElementById("ap-boot-error");
  const tipEl = document.getElementById("ap-boot-tip");

  const TIPS = [
    "Three jumps in a row, each landing straight into the next, gets you the highest one.",
    "Running full tilt then crouch-jumping is the long jump. It clears gaps nothing else will.",
    "Falling? Ground pound. It kills your speed and cracks anything underneath.",
    "Jump at a wall and jump again the instant you touch it. That is a wall kick.",
    "Steep slopes cannot be climbed. Slide them on purpose and use the speed.",
    "The camera is on a stagehand. Nudge it with Q and E when a corner hides the floor.",
    "Every Platinum Record is placed where a specific move reaches it. Find the move.",
  ];

  const boot = {
    progress(value, message) {
      if (fillEl) fillEl.style.width = `${Math.max(2, Math.min(100, value * 100)).toFixed(1)}%`;
      if (message && statusEl) statusEl.textContent = message;
    },
    fail(message, detail) {
      if (bootEl) bootEl.classList.add("has-error");
      if (statusEl) statusEl.textContent = "Failed to start";
      if (errorEl) errorEl.textContent = detail ? `${message}\n\n${detail}` : message;
      console.error("[apop3d] boot failure:", message, detail || "");
    },
    hide() {
      if (!bootEl) return;
      bootEl.classList.add("is-hidden");
      window.setTimeout(() => {
        if (bootEl && bootEl.parentNode) bootEl.parentNode.removeChild(bootEl);
      }, 900);
    },
  };
  window.__APOP3D_BOOT = boot;

  if (tipEl) tipEl.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("timeout")), ms);
      promise.then(
        (value) => { window.clearTimeout(timer); resolve(value); },
        (error) => { window.clearTimeout(timer); reject(error); }
      );
    });
  }

  async function probe(base) {
    const url = `${base}build/three.module.js`;
    const response = await withTimeout(
      fetch(url, { method: "HEAD", mode: "cors", cache: "force-cache" }), 4500
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return base;
  }

  async function pickCdn() {
    for (let i = 0; i < CDN_BASES.length; i += 1) {
      try {
        return await probe(CDN_BASES[i]);
      } catch (error) {
        console.warn(`[apop3d] CDN unavailable: ${CDN_BASES[i]}`, error && error.message);
      }
    }
    return CDN_BASES[0];
  }

  const MODULES = [
    "core", "settings", "input", "textures", "materials", "render", "sky",
    "camera", "physics", "collision", "world", "character", "anim", "player",
    "moveset", "enemies", "bosses", "collect", "vfx", "audio", "hud", "save",
    "levels", "qa", "main",
  ];

  function installImportMap(base) {
    if (document.querySelector('script[type="importmap"][data-apop]')) return;
    const imports = {
      three: `${base}build/three.module.js`,
      "three/addons/": `${base}examples/jsm/`,
      "apop3d/": MODULE_ROOT,
    };
    for (const name of MODULES) {
      imports[`${MODULE_ROOT}${name}.js`] = `${MODULE_ROOT}${name}.js?v=${BUILD}`;
    }
    const el = document.createElement("script");
    el.type = "importmap";
    el.dataset.apop = "1";
    el.textContent = JSON.stringify({ imports });
    const first = document.head.querySelector("script, link");
    if (first) document.head.insertBefore(el, first);
    else document.head.appendChild(el);
  }

  function supportsWebGL2() {
    try {
      const probeCanvas = document.createElement("canvas");
      return Boolean(probeCanvas.getContext("webgl2"));
    } catch (error) {
      return false;
    }
  }

  async function start() {
    boot.progress(0.04, "Checking hardware");

    if (window.location.protocol === "file:") {
      boot.fail(
        "This game has to be served over http, not opened from a file.",
        "Browsers block ES modules and cross-origin requests on file:// URLs, so the engine "
        + "cannot load.\n\nRun a web server from the project folder and open it through that "
        + "instead, e.g.\n\n    python3 -m http.server 8741\n\nthen visit\n\n    "
        + "http://localhost:8741/games/apop-demon-hunters.html"
      );
      return;
    }

    if (!supportsWebGL2()) {
      boot.fail(
        "Your browser could not open a WebGL2 context.",
        "Apop Demon Moggers 3D needs WebGL2. Try a recent Chrome, Edge, Firefox or Safari, "
        + "and check that hardware acceleration is enabled."
      );
      return;
    }

    boot.progress(0.12, "Finding the stage");
    const base = await pickCdn();
    installImportMap(base);

    boot.progress(0.22, "Loading the engine");
    try {
      const mod = await import(`${MODULE_ROOT}main.js?v=${BUILD}`);
      if (mod && typeof mod.start === "function") await mod.start({ boot, build: BUILD });
    } catch (error) {
      boot.fail("The engine failed to load.", String((error && error.stack) || error));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
