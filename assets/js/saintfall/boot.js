/* ============================================================
   SAINTFALL - boot loader

   Classic script. Picks a working CDN for Three.js, installs the
   import map, then hands off to the ESM entry point.
   ============================================================ */
(() => {
  "use strict";

  const BUILD = "20260811-20";
  const THREE_VERSION = "0.180.0";
  const CDN_BASES = [
    `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/`,
    `https://unpkg.com/three@${THREE_VERSION}/`,
  ];

  const scriptUrl = document.currentScript
    ? document.currentScript.src
    : new URL("assets/js/saintfall/boot.js", document.baseURI).href;
  const MODULE_ROOT = new URL("./", scriptUrl).href;

  const bootEl = document.getElementById("sf-boot");
  const fillEl = document.getElementById("sf-boot-fill");
  const statusEl = document.getElementById("sf-boot-status");
  const errorEl = document.getElementById("sf-boot-error");
  const tipEl = document.getElementById("sf-boot-tip");
  let hidePromise = null;

  const TIPS = [
    "The Saint fell here in 811.M2. Nobody has ever found the rest of it.",
    "Vesper-IX turns once every ninety hours. The sun barely moves.",
    "The halo still holds orbit. Its shadow crosses the basin twice a day.",
    "Sand carries sound further than you expect. So does the Choir.",
    "The Ossuary is not a graveyard. It is one animal.",
    "Do not drink from the Glass Scar. It is not water.",
    "The Concord marks its dead with a pole and a ribbon. Count the ribbons.",
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
      console.error("[saintfall] boot failure:", message, detail || "");
    },
    hide() {
      if (!bootEl) return Promise.resolve();
      if (hidePromise) return hidePromise;
      bootEl.classList.add("is-hidden");
      hidePromise = new Promise((resolve) => {
        window.setTimeout(() => {
          if (bootEl && bootEl.parentNode) bootEl.parentNode.removeChild(bootEl);
          resolve();
        }, 950);
      });
      return hidePromise;
    },
  };
  window.__SF_BOOT = boot;

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
        console.warn(`[saintfall] CDN unavailable: ${CDN_BASES[i]}`, error && error.message);
      }
    }
    return CDN_BASES[0];
  }

  // Every module, so the import map can pin the build onto each one.
  // Without this only boot.js and main.js carry a ?v=, and a browser
  // keeps serving whatever terrain.js it already had - which makes a
  // shipped fix look like it did not work.
  const MODULES = [
    "core", "art", "sky", "terrain", "structures", "world", "collide",
    "vfx", "render", "player", "jetpack", "boost", "shield", "enemies", "weapons", "ik", "combat",
    "mission", "breaches", "audio", "hud", "touch", "intro", "pod", "save", "ui", "qa", "main",
  ];

  function installImportMap(base) {
    if (document.querySelector('script[type="importmap"][data-sf]')) return;
    const imports = {
      three: `${base}build/three.module.js`,
      "three/addons/": `${base}examples/jsm/`,
      // Fallback for anything not in MODULES. Unversioned, so keep
      // the list below complete.
      "saintfall/": MODULE_ROOT,
    };
    /* KEYED ON THE SPECIFIER THE MODULES ACTUALLY WRITE.
       These were keyed on the resolved URL, which never matched
       anything: import map resolution is a SINGLE pass, so
       `import ... from "saintfall/terrain.js"` matched the
       `"saintfall/"` prefix rule, resolved to an unversioned URL, and
       stopped. Only main.js carried a version, because boot imports it
       by explicit URL.
       Every other module was therefore served with no cache key at
       all, and python's http.server sends Last-Modified with no
       Cache-Control - so Chrome cached each one for a heuristic
       lifetime based on how long it had been sitting unchanged. A file
       untouched for weeks got a long one. That is how a browser ended
       up running a fresh mission.js against a terrain.js from before
       `roadPointAtZ` existed, and reporting it as a missing export.
       An exact specifier key beats a prefix key, so these now win. */
    for (const name of MODULES) {
      imports[`saintfall/${name}.js`] = `${MODULE_ROOT}${name}.js?v=${BUILD}`;
    }
    const el = document.createElement("script");
    el.type = "importmap";
    el.dataset.sf = "1";
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
        + "http://localhost:8741/games/saintfall.html"
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
      await main.start({ boot, moduleRoot: MODULE_ROOT, threeBase: base, build: BUILD });
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
