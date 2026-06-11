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
      ? `<span style="background:var(--accent-3);color:#000;padding:3px 8px;border-radius:4px;font-family:var(--font-mono);font-size:11px;letter-spacing:1px;">PRO</span>`
      : "";

    slot.innerHTML = `
      <a href="${RB_BASE}" class="nav__brand" title="Rainbot Gaming — free browser arcade">
        <span class="nav__brand-mark">
          <span class="nav__brand-mark__face">
            <span class="nav__brand-mark__eye"></span>
            <span class="nav__brand-mark__eye"></span>
          </span>
          <span class="nav__brand-mark__scan"></span>
          <span class="nav__brand-mark__glitch"></span>
        </span>
        <span class="nav__brand-text">
          RAIN<span class="nav__brand-accent">BOT</span>
          <span class="nav__brand-sub">AI · brainrot</span>
        </span>
      </a>
      <div class="nav__links">
        <a href="${RB_BASE}games.html">Games</a>
        <a href="${RB_BASE}#pricing">Pricing</a>
        ${proBadge}
        ${
          state.isPro
            ? `<a href="#" id="rb-manage-pro" class="nav__cta nav__cta--ghost">Manage</a>`
            : `<a href="#" id="rb-go-pro" class="nav__cta">Go Pro · $3.99/mo</a>`
        }
      </div>
    `;

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
  });
}

function openProModal() {
  if (document.getElementById("rb-pro-modal")) return;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop modal-backdrop--open";
  backdrop.id = "rb-pro-modal";
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal__title">⚡ Go Ad-Free</div>
      <div class="modal__body">
        Skip every ad. Unlock bonus skins. Support indie silliness.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0;">
        <button class="btn btn--primary" data-plan="monthly">Monthly · $3.99</button>
        <button class="btn btn--secondary" data-plan="yearly">Yearly · $29.99</button>
      </div>
      <button class="btn btn--ghost" id="rb-close-pro" style="font-size:14px;padding:8px 14px;">Maybe later</button>
    </div>
  `;
  document.body.appendChild(backdrop);
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
        b.textContent = b.dataset.plan === "yearly" ? "Yearly · $29.99" : "Monthly · $3.99";
      }
    });
  });
  backdrop.querySelector("#rb-close-pro").addEventListener("click", () => backdrop.remove());
}

document.addEventListener("DOMContentLoaded", () => {
  renderNav();
});
