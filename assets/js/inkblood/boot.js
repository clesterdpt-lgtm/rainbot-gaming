/* ============================================================
   INKBLOOD — boot loader
   Classic script. Owns the loading screen, checks the handful of
   things that can make the game impossible to run, and then hands
   off to the ESM entry point.
   ============================================================ */
(() => {
  "use strict";

  const VERSION = "20260803-ui-minimal-1";

  const scriptUrl = document.currentScript
    ? document.currentScript.src
    : new URL("assets/js/inkblood/boot.js", document.baseURI).href;
  const MODULE_ROOT = new URL("./", scriptUrl).href;

  const bootEl = document.getElementById("ink-boot");
  const fillEl = document.getElementById("ink-boot-fill");
  const statusEl = document.getElementById("ink-boot-status");
  const errorEl = document.getElementById("ink-boot-error");

  const boot = {
    progress(value, message) {
      if (fillEl) fillEl.style.width = `${Math.max(2, Math.min(100, value * 100)).toFixed(1)}%`;
      if (message && statusEl) statusEl.textContent = message;
    },
    fail(message, detail) {
      if (bootEl) bootEl.classList.add("has-error");
      if (statusEl) statusEl.textContent = "Could not start";
      if (errorEl) errorEl.textContent = detail ? `${message}\n\n${detail}` : message;
      console.error("[inkblood] boot failure:", message, detail || "");
    },
    hide() {
      if (!bootEl) return;
      bootEl.classList.add("is-hidden");
      window.setTimeout(() => {
        if (bootEl && bootEl.parentNode) bootEl.parentNode.removeChild(bootEl);
      }, 700);
    },
  };
  window.__INK_BOOT = boot;

  async function start() {
    boot.progress(0.01, "Opening the book");

    // ES modules are blocked by CORS on file:// URLs, so nothing
    // below can work and the generic error would be useless.
    if (window.location.protocol === "file:") {
      boot.fail(
        "This game has to be served over http, not opened from a file.",
        "Browsers block ES modules on file:// URLs.\n\nRun a small web server from the "
        + "project folder:\n\n    python3 -m http.server 8741\n\nthen open\n\n    "
        + "http://localhost:8741/games/inkblood.html",
      );
      return;
    }

    try {
      const main = await import(`${MODULE_ROOT}main.js?v=${VERSION}`);
      await main.start({ boot });
    } catch (error) {
      const detail = (error && (error.stack || error.message)) || String(error);
      boot.fail("The game could not start.", detail);
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
