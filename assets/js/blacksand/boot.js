/* ============================================================
   BLACKSAND - boot loader

   Classic script. Picks a working CDN for Three.js, installs the
   import map, then hands off to the ESM entry point.
   ============================================================ */
(() => {
  "use strict";

  const BUILD = "20260803-01";
  const THREE_VERSION = "0.180.0";
  const CDN_BASES = [
    `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/`,
    `https://unpkg.com/three@${THREE_VERSION}/`,
  ];

  const scriptUrl = document.currentScript
    ? document.currentScript.src
    : new URL("assets/js/blacksand/boot.js", document.baseURI).href;
  const MODULE_ROOT = new URL("./", scriptUrl).href;

  const bootEl = document.getElementById("bs-boot");
  const fillEl = document.getElementById("bs-boot-fill");
  const statusEl = document.getElementById("bs-boot-status");
  const errorEl = document.getElementById("bs-boot-error");
  const tipEl = document.getElementById("bs-boot-tip");

  const TIPS = [
    "Hold the objective. Tickets bleed for whoever holds fewer points.",
    "Crouching cuts your weapon's cone by nearly a third. Prone halves it.",
    "The first round from a stationary, aimed rifle goes exactly where you point it.",
    "Sprinting widens your spread and lowers the weapon. Stop before you shoot.",
    "Rounds cracking past you desaturate the edges of your vision. That is suppression, not a bug.",
    "Rooftops are reachable. Every building has a stair.",
    "Vehicles respawn at your base 25 seconds after they burn.",
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
      console.error("[blacksand] boot failure:", message, detail || "");
    },
    hide() {
      if (!bootEl) return;
      bootEl.classList.add("is-hidden");
      window.setTimeout(() => {
        if (bootEl && bootEl.parentNode) bootEl.parentNode.removeChild(bootEl);
      }, 900);
    },
  };
  window.__BS_BOOT = boot;

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
        console.warn(`[blacksand] CDN unavailable: ${CDN_BASES[i]}`, error && error.message);
      }
    }
    return CDN_BASES[0];
  }

  // Every module, so the import map can pin the build onto each one.
  // Without this only boot.js and main.js carry a ?v=, and a browser
  // keeps serving whatever terrain.js or render.js it already had -
  // which makes a shipped fix look like it did not work.
  const MODULES = [
    "core", "settings", "input", "render", "textures", "materials", "sky",
    "terrain", "physics", "structures", "foliage", "world", "vfx", "audio",
    "characters", "player", "weapons", "viewmodel", "vehicles", "bots",
    "net", "hud", "qa", "main",
  ];

  function installImportMap(base) {
    if (document.querySelector('script[type="importmap"][data-bs]')) return;
    const imports = {
      three: `${base}build/three.module.js`,
      "three/webgpu": `${base}build/three.webgpu.js`,
      "three/tsl": `${base}build/three.tsl.js`,
      "three/addons/": `${base}examples/jsm/`,
      "blacksand/": MODULE_ROOT,
    };
    for (const name of MODULES) {
      imports[`${MODULE_ROOT}${name}.js`] = `${MODULE_ROOT}${name}.js?v=${BUILD}`;
    }
    const el = document.createElement("script");
    el.type = "importmap";
    el.dataset.bs = "1";
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
        + "http://localhost:8741/games/blacksand.html"
      );
      return;
    }

    const mapsOk = typeof HTMLScriptElement !== "undefined"
      && typeof HTMLScriptElement.supports === "function"
      ? HTMLScriptElement.supports("importmap")
      : true;
    if (!mapsOk) {
      boot.fail(
        "This browser cannot load the engine.",
        "It does not support import maps, which the game uses to resolve Three.js. "
        + "Chrome 89+, Edge 89+, Firefox 108+ or Safari 16.4+ will work."
      );
      return;
    }

    if (!supportsWebGL2()) {
      boot.fail(
        "This game needs WebGL2.",
        "Your browser or GPU driver did not provide a WebGL2 context. Try updating your "
        + "browser, or enable hardware acceleration in its settings."
      );
      return;
    }

    boot.progress(0.09, "Locating renderer");
    const base = await pickCdn();
    installImportMap(base);

    boot.progress(0.14, "Loading engine");
    try {
      const main = await import(`${MODULE_ROOT}main.js?v=${BUILD}`);
      await main.start({ boot, moduleRoot: MODULE_ROOT, threeBase: base });
    } catch (error) {
      const detail = (error && (error.stack || error.message)) || String(error);
      const looksLikeCdn = /Failed to fetch|dynamically imported|Importing a module script failed|resolve module specifier|NetworkError/i.test(detail);
      boot.fail(
        looksLikeCdn ? "Could not download the 3D engine." : "The engine could not start.",
        looksLikeCdn
          ? `Three.js is loaded from a CDN (${base}). Check your connection, or whether an ad `
            + `blocker or offline mode is blocking cdn.jsdelivr.net and unpkg.com.\n\n${detail}`
          : detail
      );
    }
  }

  window.addEventListener("error", (event) => {
    if (bootEl && !bootEl.classList.contains("is-hidden") && event.error) {
      boot.fail("Unhandled error during startup.", event.error.stack || event.error.message);
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
