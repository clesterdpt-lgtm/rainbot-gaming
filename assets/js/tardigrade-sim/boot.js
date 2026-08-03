/* ============================================================
   Tardigrade Simulator - boot loader
   Classic script. Picks a working CDN for Three.js, installs the
   import map, then hands off to the ESM entry point.
   ============================================================ */
(() => {
  "use strict";

  const BUILD = "20260803-37";
  const THREE_VERSION = "0.180.0";
  const CDN_BASES = [
    `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/`,
    `https://unpkg.com/three@${THREE_VERSION}/`,
  ];

  const scriptUrl = document.currentScript
    ? document.currentScript.src
    : new URL("assets/js/tardigrade-sim/boot.js", document.baseURI).href;
  const MODULE_ROOT = new URL("./", scriptUrl).href;

  const bootEl = document.getElementById("ts-boot");
  const fillEl = document.getElementById("ts-boot-fill");
  const statusEl = document.getElementById("ts-boot-status");
  const errorEl = document.getElementById("ts-boot-error");

  const boot = {
    progress(value, message) {
      if (fillEl) fillEl.style.width = `${Math.max(2, Math.min(100, value * 100)).toFixed(1)}%`;
      if (message && statusEl) statusEl.textContent = message;
    },
    fail(message, detail) {
      if (bootEl) bootEl.classList.add("has-error");
      if (statusEl) statusEl.textContent = "Failed to start";
      if (errorEl) {
        errorEl.textContent = detail ? `${message}\n\n${detail}` : message;
      }
      console.error("[tardigrade-sim] boot failure:", message, detail || "");
    },
    hide() {
      if (!bootEl) return;
      bootEl.classList.add("is-hidden");
      window.setTimeout(() => {
        if (bootEl && bootEl.parentNode) bootEl.parentNode.removeChild(bootEl);
      }, 800);
    },
  };
  window.__TS_BOOT = boot;

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
    const response = await withTimeout(fetch(url, { method: "HEAD", mode: "cors", cache: "force-cache" }), 4500);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return base;
  }

  async function pickCdn() {
    for (let i = 0; i < CDN_BASES.length; i += 1) {
      try {
        return await probe(CDN_BASES[i]);
      } catch (error) {
        console.warn(`[tardigrade-sim] CDN unavailable: ${CDN_BASES[i]}`, error && error.message);
      }
    }
    // Last resort: install the primary map anyway so a slow HEAD does not block play.
    return CDN_BASES[0];
  }

  // Every module of the game, so the import map can pin a version onto each
  // one. Without this only boot.js and main.js carry a ?v= - main.js imports
  // its siblings as plain relative paths, so a browser keeps serving whatever
  // world.js / physics.js / input.js it already had. That makes a shipped fix
  // look like it did not work, which is exactly what happened here.
  const MODULES = [
    "core", "settings", "input", "engine", "qa", "materials", "physics",
    "world", "props", "tardigrade", "player", "vfx", "audio", "ui", "main",
  ];

  function installImportMap(base) {
    if (document.querySelector('script[type="importmap"][data-ts]')) return;
    const imports = {
      three: `${base}build/three.module.js`,
      "three/webgpu": `${base}build/three.webgpu.js`,
      "three/tsl": `${base}build/three.tsl.js`,
      "three/addons/": `${base}examples/jsm/`,
      "tsim/": MODULE_ROOT,
    };
    // Import maps match the RESOLVED url of a specifier, so mapping the bare
    // module url onto its versioned twin catches the relative imports inside
    // main.js as well as any absolute ones.
    for (const name of MODULES) {
      imports[`${MODULE_ROOT}${name}.js`] = `${MODULE_ROOT}${name}.js?v=${BUILD}`;
    }
    const map = { imports };
    const el = document.createElement("script");
    el.type = "importmap";
    el.dataset.ts = "1";
    el.textContent = JSON.stringify(map);
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

    // Opened straight off disk. ES modules, import maps and the CDN fetch are
    // all blocked by CORS on file://, so nothing below can possibly work and
    // the generic "engine could not start" tells the player nothing useful.
    if (window.location.protocol === "file:") {
      boot.fail(
        "This game has to be served over http, not opened from a file.",
        "Browsers block ES modules and cross-origin requests on file:// URLs, so the engine "
        + "cannot load.\n\nRun a tiny web server from the project folder and open it through "
        + "that instead, e.g.\n\n    python3 -m http.server 8741\n\nthen visit\n\n    "
        + "http://localhost:8741/games/tardigrade-simulator.html"
      );
      return;
    }

    // Import maps are how `import \"three\"` resolves. Safari below 16.4 and
    // Firefox below 108 do not support them; without this check the failure
    // surfaces much later as an unresolved bare specifier.
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
        "Your browser or GPU driver did not provide a WebGL2 context. Try updating your browser, or enable hardware acceleration in its settings."
      );
      return;
    }

    boot.progress(0.1, "Locating renderer");
    const base = await pickCdn();
    installImportMap(base);

    boot.progress(0.18, "Loading engine");
    try {
      const main = await import(`${MODULE_ROOT}main.js?v=${BUILD}`);
      await main.start({ boot, moduleRoot: MODULE_ROOT, threeBase: base });
    } catch (error) {
      const detail = (error && (error.stack || error.message)) || String(error);
      // A bare-specifier or network failure here almost always means the CDN
      // could not be reached, so say so rather than showing only a stack.
      const looksLikeCdn = /Failed to fetch|dynamically imported|Importing a module script failed|resolve module specifier|NetworkError/i.test(detail);
      boot.fail(
        looksLikeCdn ? "Could not download the 3D engine." : "The engine could not start.",
        looksLikeCdn
          ? `Three.js is loaded from a CDN (${base}). Check your connection, or whether an ad blocker or offline mode is blocking cdn.jsdelivr.net and unpkg.com.\n\n${detail}`
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
