/* ============================================
   RAINBOT GAMING — site-wide JS
   - nav rendering
   - Pro badge
   - subscribe modal
   ============================================ */

// Detect whether we're at site root or in a subdir (games/, legal/)
// so generated nav links are correct whether the site is served
// from a server OR opened directly via file://
const RB_BASE = (() => {
  const p = location.pathname;
  if (p.includes("/games/") || p.includes("/legal/")) return "../";
  return "./";
})();

function renderNav() {
  const slot = document.getElementById("nav-slot");
  if (!slot) return;

  RB.subscribe((state) => {
    const proBadge = state.isPro
      ? `<span class="nav__pro-state">PRO ACTIVE</span>`
      : "";
    const path = location.pathname;
    const isHome = path.endsWith("/") || path.endsWith("/index.html") || path === "";
    const isAgentGames = path.endsWith("/agent-games.html") || path.includes("/recursive-reward-labyrinth");
    const isGames = !isAgentGames && (path.endsWith("/games.html") || path.includes("/games/"));

    slot.innerHTML = `
      <a href="${RB_BASE}" class="nav__brand" title="Rainbot Gaming — free browser arcade">
        <img src="${RB_BASE}assets/img/mockup/rainbot-logo.png?v=20260611-7" alt="Rainbot Gaming" />
      </a>
      <div class="nav__links">
        <a href="${RB_BASE}" class="${isHome ? "is-active" : ""}">Home</a>
        <a href="${RB_BASE}games.html" class="${isGames ? "is-active" : ""}">Games</a>
        <a href="${RB_BASE}agent-games.html" class="${isAgentGames ? "is-active" : ""}">Agent Games</a>
        <a href="${RB_BASE}#after-dark">After Dark</a>
        <a href="${RB_BASE}#coming-soon">Coming Soon</a>
        <a href="${RB_BASE}#after-dark">About</a>
        <a href="${RB_BASE}#pricing">Merch</a>
      </div>
      <form class="nav__search" role="search">
        <label class="sr-only" for="rb-search">Search games</label>
        <input id="rb-search" type="search" placeholder="Search games..." autocomplete="off" />
        <button type="submit" aria-label="Search">Search</button>
      </form>
      <div class="nav__actions">
        ${proBadge}
        ${
          state.isPro
            ? `<a href="#" id="rb-manage-pro" class="nav__cta nav__cta--pro">Manage</a>`
            : `<a href="#" id="rb-go-pro" class="nav__cta nav__cta--pro">Pro</a>`
        }
        <a href="#" id="rb-login" class="nav__cta nav__cta--login">Login</a>
      </div>
    `;

    bindSearch(slot);

    const goPro = document.getElementById("rb-go-pro");
    if (goPro) goPro.addEventListener("click", (e) => {
      e.preventDefault();
      openProModal();
    });
    const manage = document.getElementById("rb-manage-pro");
    if (manage) manage.addEventListener("click", (e) => {
      e.preventDefault();
      if (confirm("Cancel Pro subscription? (mock — wire to your backend)")) {
        RB.cancelPro();
        RB.toast("Pro cancelled", "bad");
      }
    });
    const login = document.getElementById("rb-login");
    if (login) login.addEventListener("click", (e) => {
      e.preventDefault();
      RB.toast("Login is coming soon", "good");
    });
  });
}

function bindSearch(root) {
  const form = root.querySelector(".nav__search");
  const input = root.querySelector("#rb-search");
  if (!form || !input) return;
  const searchable = Array.from(document.querySelectorAll("[data-title]"));

  const applySearch = () => {
    const query = input.value.trim().toLowerCase();
    if (!searchable.length) return;
    searchable.forEach((item) => {
      const text = item.dataset.title.toLowerCase();
      item.toggleAttribute("hidden", query !== "" && !text.includes(query));
    });
  };

  input.addEventListener("input", applySearch);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (searchable.length) {
      applySearch();
      const target = document.querySelector("[data-search-scope]");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const q = encodeURIComponent(input.value.trim());
    location.href = q ? `${RB_BASE}games.html?q=${q}` : `${RB_BASE}games.html`;
  });
}

function openProModal(defaultPlan = "monthly") {
  if (document.getElementById("rb-pro-modal")) return;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop modal-backdrop--open";
  backdrop.id = "rb-pro-modal";
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal__title">Go Ad-Free</div>
      <div class="modal__body">
        Skip every ad, unlock Pro-only drops, and keep Rainbot building weirder browser games.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0;">
        <button class="btn btn--primary" data-plan="monthly">Monthly / $4.99</button>
        <button class="btn btn--secondary" data-plan="yearly">Yearly / $49.99</button>
      </div>
      <button class="btn btn--ghost" id="rb-close-pro" style="font-size:14px;padding:8px 14px;">Maybe later</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  const preferred = backdrop.querySelector(`[data-plan="${defaultPlan}"]`);
  if (preferred) preferred.focus();
  backdrop.querySelectorAll("[data-plan]").forEach((b) => {
    b.addEventListener("click", async () => {
      b.disabled = true;
      b.innerHTML = '<span class="spinner"></span>';
      const ok = await RB.startCheckout(b.dataset.plan);
      if (ok) {
        RB.toast("🎉 Welcome to Pro!", "good");
        backdrop.remove();
      } else {
        b.disabled = false;
        b.textContent = b.dataset.plan === "yearly" ? "Yearly / $49.99" : "Monthly / $4.99";
      }
    });
  });
  backdrop.querySelector("#rb-close-pro").addEventListener("click", () => backdrop.remove());
}

let gameCanvasFitFrame = 0;

function scheduleGameCanvasFit() {
  if (gameCanvasFitFrame) cancelAnimationFrame(gameCanvasFitFrame);
  gameCanvasFitFrame = requestAnimationFrame(() => {
    gameCanvasFitFrame = 0;
    fitGameCanvases();
  });
}

function fitGameCanvases() {
  const wraps = Array.from(document.querySelectorAll(".canvas-wrap"));
  if (!wraps.length) return;

  const isCompact = window.matchMedia("(max-width: 900px)").matches;

  wraps.forEach((wrap) => {
    const canvas = wrap.querySelector("canvas");
    const stage = wrap.closest(".game-stage");
    if (!canvas || !stage) return;

    const naturalWidth = Number(canvas.getAttribute("width")) || canvas.width || wrap.clientWidth;
    const naturalHeight = Number(canvas.getAttribute("height")) || canvas.height || wrap.clientHeight;
    const aspect = naturalWidth / Math.max(1, naturalHeight);
    const stageStyle = window.getComputedStyle(stage);
    const stagePaddingX =
      (parseFloat(stageStyle.paddingLeft) || 0) +
      (parseFloat(stageStyle.paddingRight) || 0);
    const availableWidth = Math.max(0, stage.clientWidth - stagePaddingX);
    let fitWidth = availableWidth;

    if (!isCompact) {
      const wrapRect = wrap.getBoundingClientRect();
      const visibleChildren = Array.from(stage.children).filter((child) => {
        const style = window.getComputedStyle(child);
        const rect = child.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width >= 0;
      });
      const wrapIndex = visibleChildren.indexOf(wrap);
      const belowChildren = wrapIndex >= 0 ? visibleChildren.slice(wrapIndex + 1) : [];
      const belowHeight = belowChildren.reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
      const gap = parseFloat(stageStyle.rowGap || stageStyle.gap) || 0;
      const gapsBelow = Math.max(0, belowChildren.length) * gap;
      const bottomPadding = parseFloat(stageStyle.paddingBottom) || 0;
      const availableHeight = window.innerHeight - wrapRect.top - belowHeight - gapsBelow - bottomPadding - 20;
      const heightBoundWidth = availableHeight > 0 ? availableHeight * aspect : availableWidth;
      const maxWidth = parseFloat(window.getComputedStyle(wrap).getPropertyValue("--game-max-width"));

      fitWidth = Math.min(availableWidth, heightBoundWidth);
      if (Number.isFinite(maxWidth) && maxWidth > 0) {
        fitWidth = Math.min(fitWidth, maxWidth);
      }
    }

    if (Number.isFinite(fitWidth) && fitWidth > 0) {
      wrap.style.setProperty("--game-fit-width", `${Math.floor(fitWidth)}px`);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  scheduleGameCanvasFit();
});

window.addEventListener("load", scheduleGameCanvasFit);
window.addEventListener("resize", scheduleGameCanvasFit);
