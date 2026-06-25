/* ============================================
   RAINBOT GAMING — ad & subscription system
   --------------------------------------------
   - AdMob / AdSense / Adsterra are all pluggable
   - For local dev we use a mock that simulates a 5s rewarded ad
   - Subscription state is in localStorage (replace with your auth/paywall later)
   ============================================ */

const RB = (() => {
  const STORAGE_KEY = "ets_state_v1";
  const AD_DURATION_MS = 5000; // mock ad length

  const defaultState = {
    isPro: false,
    adFreeUntil: 0,         // timestamp; pro or purchased pass extends
    powerups: {
      shield: 0,
      boost: 0,
      nuke: 0,
      airpods: 0,
      boyfriend: 0,
      decoy: 0,
    },
    scores: {},             // per-game high score
    notify: [],             // email captures (for now, local only)
  };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(defaultState);
      return { ...structuredClone(defaultState), ...JSON.parse(raw) };
    } catch (e) {
      return structuredClone(defaultState);
    }
  }

  function save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { console.warn("[ETS] localStorage save failed", e); }
  }

  let state = load();
  const listeners = new Set();

  function emit() {
    save(state);
    listeners.forEach((fn) => fn(state));
  }

  function subscribe(fn) {
    listeners.add(fn);
    fn(state);
    return () => listeners.delete(fn);
  }

  // ---------- Ads ----------

  /**
   * Show a rewarded ad. In production, swap the mock body for the real SDK call.
   *
   * AdSense / Ad Manager: not currently supported as rewarded, use AdMob/Unity/Adsterra
   * Adsterra (Social Bar push not ideal for rewarded; use their Popunder or Direct Link):
   *   https://www.profitabledisplaynetwork.com (example) — wire onclick handlers to RB.showRewarded
   *
   * Adsterra Smart Direct Link (push-style — wrap in your own modal):
   *   const link = "https://www.profitabledisplaynetwork.com/xyz?key=YOUR_KEY";
   *   window.open(link, "_blank");
   *
   * Unity Ads / AdMob Web (Beta) / ironSource Web: each has its own JS bridge; all
   * reduce to: show ad → user finishes → resolve(true) → grant reward, or resolve(false) on skip.
   */
  function showRewarded() {
    return new Promise((resolve) => {
      // Prevent the same ad being shown back-to-back
      if (document.getElementById("rb-ad-modal")) {
        resolve(false);
        return;
      }

      const backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop modal-backdrop--open";
      backdrop.id = "rb-ad-modal";
      backdrop.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="rb-ad-title">
          <div class="modal__title" id="rb-ad-title">📺 Watch a quick ad</div>
          <div class="modal__body">
            Thanks for keeping Rainbot Network free. Watch the full ad to claim your power-up.
          </div>
          <div class="modal__countdown" id="rb-ad-count">5</div>
          <div class="modal__body" style="font-size:12px;opacity:0.6;">
            (Mock ad — wire your SDK in <code>RB.showRewarded</code> in <code>assets/js/ads.js</code>)
          </div>
        </div>
      `;
      document.body.appendChild(backdrop);

      let remaining = AD_DURATION_MS / 1000;
      const countEl = backdrop.querySelector("#rb-ad-count");
      const interval = setInterval(() => {
        remaining -= 1;
        if (remaining > 0) {
          countEl.textContent = remaining;
        } else {
          clearInterval(interval);
        }
      }, 1000);

      // Close after duration (simulating user finishing the ad)
      setTimeout(() => {
        clearInterval(interval);
        backdrop.remove();
        resolve(true);
      }, AD_DURATION_MS);
    });
  }

  // ---------- Pro / Subscription ----------

  /**
   * In production: integrate Stripe Checkout, Paddle, Lemon Squeezy, or RevenueCat Web.
   * On successful webhook → set isPro = true on this device (or use a signed token from
   * your backend). For now we toggle local-only.
   */
  function startCheckout(plan /* "monthly" | "yearly" */) {
    // TODO: replace with real checkout session
    // window.location.href = `https://buy.stripe.com/xxx?plan=${plan}`;
    return new Promise((resolve) => {
      const ok = confirm(
        plan === "yearly"
          ? "Subscribe to Rainbot Pro (yearly) for $49.99? (Mock - wire Stripe in ads.js)"
          : "Subscribe to Rainbot Pro (monthly) for $4.99? (Mock - wire Stripe in ads.js)"
      );
      if (ok) {
        state.isPro = true;
        emit();
        resolve(true);
      } else {
        resolve(false);
      }
    });
  }

  function cancelPro() {
    state.isPro = false;
    emit();
  }

  function isAdFree() {
    if (state.isPro) return true;
    if (Date.now() < state.adFreeUntil) return true;
    return false;
  }

  // ---------- Powerups ----------

  function grantPowerup(kind) {
    state.powerups[kind] = (state.powerups[kind] || 0) + 1;
    emit();
  }

  function consumePowerup(kind) {
    if (state.powerups[kind] > 0) {
      state.powerups[kind] -= 1;
      emit();
      return true;
    }
    return false;
  }

  // ---------- Scores ----------

  function recordScore(gameId, score) {
    const prev = state.scores[gameId] || 0;
    if (score > prev) {
      state.scores[gameId] = score;
      emit();
      if (window.RBBackend && typeof window.RBBackend.recordScore === "function") {
        window.RBBackend.recordScore(gameId, score).catch((error) => {
          console.warn("[Rainbot] Cloud score sync failed", error);
        });
      }
      return true; // new high score
    }
    return false;
  }

  function getHighScore(gameId) {
    return state.scores[gameId] || 0;
  }

  function mergeHighScores(scores) {
    if (!scores || typeof scores !== "object") return false;
    let changed = false;
    Object.entries(scores).forEach(([gameId, score]) => {
      const numericScore = Number(score) || 0;
      if (numericScore > (state.scores[gameId] || 0)) {
        state.scores[gameId] = numericScore;
        changed = true;
      }
    });
    if (changed) emit();
    return changed;
  }

  // ---------- Toasts ----------

  function toast(message, kind = "") {
    const el = document.createElement("div");
    el.className = "toast" + (kind ? " toast--" + kind : "");
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("toast--show"));
    setTimeout(() => {
      el.classList.remove("toast--show");
      setTimeout(() => el.remove(), 300);
    }, 2200);
  }

  // ---------- Notify (email capture — local only until backend) ----------

  function addNotify(email) {
    if (!email || !email.includes("@")) return false;
    if (state.notify.includes(email)) return false;
    state.notify.push(email);
    emit();
    return true;
  }

  // ---------- Public API ----------

  return {
    state,
    subscribe,
    showRewarded,
    isAdFree,
    startCheckout,
    cancelPro,
    grantPowerup,
    consumePowerup,
    recordScore,
    getHighScore,
    mergeHighScores,
    toast,
    addNotify,
  };
})();

// Tiny helper: render a "powered by ad" placeholder
function renderAdSlot(element, size = "leaderboard") {
  if (!element) return;
  if (RB.isAdFree()) {
    element.style.display = "none";
    return;
  }
  element.classList.add("ad-slot", "ad-slot--" + size);
  element.innerHTML = `
    <div>
      <div>📢 AD SLOT — ${size.toUpperCase()}</div>
      <div style="font-size:10px;margin-top:6px;opacity:0.6;">
        Replace with your network tag in <code>renderAdSlot()</code>
      </div>
    </div>
  `;
}
