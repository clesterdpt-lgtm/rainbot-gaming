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
  const GAMEPLAY_FLUSH_MS = 15000;
  const MAX_SESSION_DELTA_MS = 5 * 60 * 1000;
  const SAVE_TOUCH_FLUSH_MS = 60000;

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
    localProfile: {
      displayName: "Rainbot Player",
      profileTitle: "Arcade Regular",
      bio: "",
      favoriteGame: "",
      avatarStyle: "bot",
      accentColor: "cyan",
    },
    stats: {
      schemaVersion: 1,
      totalPlayMs: 0,
      sessions: 0,
      firstPlayedAt: 0,
      lastPlayedAt: 0,
      lastPlayedGame: "",
      lastSavedAt: 0,
      playDays: {},
      games: {},
    },
  };

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function cleanText(value, maxLength) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  function cleanGameId(gameId) {
    return String(gameId == null ? "" : gameId)
      .trim()
      .toLowerCase()
      .replace(/\.html$/i, "")
      .replace(/[^a-z0-9:_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96);
  }

  function normalizeLocalProfile(raw = {}) {
    const base = clone(defaultState.localProfile);
    const merged = { ...base, ...raw };
    return {
      displayName: cleanText(merged.displayName || merged.display_name || base.displayName, 32) || base.displayName,
      profileTitle: cleanText(merged.profileTitle || merged.profile_title || base.profileTitle, 40) || base.profileTitle,
      bio: cleanText(merged.bio, 180),
      favoriteGame: cleanText(merged.favoriteGame || merged.favorite_game, 80),
      avatarStyle: cleanText(merged.avatarStyle || merged.avatar_style || base.avatarStyle, 32).toLowerCase() || base.avatarStyle,
      accentColor: cleanText(merged.accentColor || merged.accent_color || base.accentColor, 32).toLowerCase() || base.accentColor,
    };
  }

  function normalizeGameStats(raw = {}) {
    return {
      playMs: Math.max(0, Number(raw.playMs) || 0),
      sessions: Math.max(0, Math.floor(Number(raw.sessions) || 0)),
      firstPlayedAt: Math.max(0, Number(raw.firstPlayedAt) || 0),
      lastPlayedAt: Math.max(0, Number(raw.lastPlayedAt) || 0),
      lastSavedAt: Math.max(0, Number(raw.lastSavedAt) || 0),
      bestScore: Math.max(0, Math.floor(Number(raw.bestScore) || 0)),
      bestScoreAt: Math.max(0, Number(raw.bestScoreAt) || 0),
      lastScore: Math.max(0, Math.floor(Number(raw.lastScore) || 0)),
      lastScoreAt: Math.max(0, Number(raw.lastScoreAt) || 0),
    };
  }

  function normalizeStats(raw = {}) {
    const stats = {
      ...clone(defaultState.stats),
      ...raw,
      totalPlayMs: Math.max(0, Number(raw.totalPlayMs) || 0),
      sessions: Math.max(0, Math.floor(Number(raw.sessions) || 0)),
      firstPlayedAt: Math.max(0, Number(raw.firstPlayedAt) || 0),
      lastPlayedAt: Math.max(0, Number(raw.lastPlayedAt) || 0),
      lastPlayedGame: cleanGameId(raw.lastPlayedGame),
      lastSavedAt: Math.max(0, Number(raw.lastSavedAt) || 0),
      playDays: raw.playDays && typeof raw.playDays === "object" ? { ...raw.playDays } : {},
      games: {},
    };
    const rawGames = raw.games && typeof raw.games === "object" ? raw.games : {};
    Object.entries(rawGames).forEach(([gameId, gameStats]) => {
      const id = cleanGameId(gameId);
      if (id) stats.games[id] = normalizeGameStats(gameStats);
    });
    return stats;
  }

  function normalizeState(raw = {}) {
    const base = clone(defaultState);
    const next = { ...base, ...raw };
    next.powerups = { ...base.powerups, ...(raw.powerups || {}) };
    next.scores = raw.scores && typeof raw.scores === "object" ? { ...raw.scores } : {};
    next.notify = Array.isArray(raw.notify) ? raw.notify.slice() : [];
    next.localProfile = normalizeLocalProfile(raw.localProfile || raw.profile || {});
    next.stats = normalizeStats(raw.stats || {});
    return next;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return normalizeState();
      return normalizeState(JSON.parse(raw));
    } catch (e) {
      return normalizeState();
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

  // ---------- Profile stats ----------

  function currentGameIdFromPath() {
    if (!location.pathname.includes("/games/")) return "";
    const file = location.pathname.split("/").pop() || "";
    return cleanGameId(file);
  }

  function dayKey(time = Date.now()) {
    const date = new Date(time);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function ensureStats() {
    if (
      !state.stats ||
      typeof state.stats !== "object" ||
      !state.stats.games ||
      typeof state.stats.games !== "object" ||
      !state.stats.playDays ||
      typeof state.stats.playDays !== "object"
    ) {
      state.stats = normalizeStats(state.stats || {});
    }
    return state.stats;
  }

  function ensureGameStats(gameId) {
    const id = cleanGameId(gameId);
    if (!id) return null;
    const stats = ensureStats();
    if (!stats.games[id]) stats.games[id] = normalizeGameStats();
    return stats.games[id];
  }

  function touchGameStats(gameId, time = Date.now()) {
    const id = cleanGameId(gameId);
    const gameStats = ensureGameStats(id);
    if (!gameStats) return null;
    const stats = ensureStats();
    if (!stats.firstPlayedAt) stats.firstPlayedAt = time;
    if (!gameStats.firstPlayedAt) gameStats.firstPlayedAt = time;
    stats.lastPlayedAt = time;
    stats.lastPlayedGame = id;
    stats.playDays[dayKey(time)] = true;
    gameStats.lastPlayedAt = time;
    return gameStats;
  }

  function addPlayTime(gameId, elapsedMs) {
    const id = cleanGameId(gameId);
    const delta = Math.max(0, Math.min(Number(elapsedMs) || 0, MAX_SESSION_DELTA_MS));
    if (!id || delta < 1000) return false;
    const stats = ensureStats();
    const gameStats = touchGameStats(id);
    if (!gameStats) return false;
    stats.totalPlayMs += delta;
    gameStats.playMs += delta;
    return true;
  }

  function rememberHighScore(gameId, score, time = Date.now()) {
    const numericScore = Math.max(0, Math.floor(Number(score) || 0));
    const gameStats = touchGameStats(gameId, time);
    if (!gameStats) return;
    gameStats.lastScore = numericScore;
    gameStats.lastScoreAt = time;
    if (numericScore >= gameStats.bestScore) {
      gameStats.bestScore = numericScore;
      gameStats.bestScoreAt = time;
    }
  }

  function recordGameSave(gameId) {
    const time = Date.now();
    const gameStats = ensureGameStats(gameId);
    if (!gameStats) return false;
    if (time - Number(gameStats.lastSavedAt || 0) < SAVE_TOUCH_FLUSH_MS) return false;
    const stats = ensureStats();
    touchGameStats(gameId, time);
    gameStats.lastSavedAt = time;
    stats.lastSavedAt = time;
    emit();
    return true;
  }

  let activeGameSession = null;

  function flushGameSession(persist = false) {
    if (!activeGameSession) return false;
    const now = Date.now();
    if (!activeGameSession.lastTick) {
      activeGameSession.lastTick = document.visibilityState === "visible" ? now : 0;
      return false;
    }
    const changed = addPlayTime(activeGameSession.gameId, now - activeGameSession.lastTick);
    activeGameSession.lastTick = document.visibilityState === "visible" ? now : 0;
    if (changed && persist) emit();
    return changed;
  }

  function startGameSession(gameId = currentGameIdFromPath()) {
    const id = cleanGameId(gameId);
    if (!id || activeGameSession) return false;
    const stats = ensureStats();
    const gameStats = touchGameStats(id);
    if (!gameStats) return false;
    stats.sessions += 1;
    gameStats.sessions += 1;
    activeGameSession = {
      gameId: id,
      lastTick: document.visibilityState === "visible" ? Date.now() : 0,
      timer: window.setInterval(() => flushGameSession(true), GAMEPLAY_FLUSH_MS),
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flushGameSession(true);
        if (activeGameSession) activeGameSession.lastTick = 0;
      } else if (activeGameSession) {
        activeGameSession.lastTick = Date.now();
        touchGameStats(activeGameSession.gameId);
        emit();
      }
    });
    window.addEventListener("beforeunload", () => {
      flushGameSession(true);
    });
    emit();
    return true;
  }

  function getGameplayStats() {
    flushGameSession(false);
    return clone(ensureStats());
  }

  function getLocalProfile() {
    state.localProfile = normalizeLocalProfile(state.localProfile || {});
    return { ...state.localProfile };
  }

  function updateLocalProfile(patch = {}) {
    state.localProfile = normalizeLocalProfile({ ...getLocalProfile(), ...patch });
    emit();
    return getLocalProfile();
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
    const id = cleanGameId(gameId);
    const numericScore = Math.max(0, Math.floor(Number(score) || 0));
    const prev = state.scores[id] || 0;
    if (id) rememberHighScore(id, numericScore);
    if (id && numericScore > prev) {
      state.scores[id] = numericScore;
      emit();
      const backendState = window.RBBackend && typeof window.RBBackend.getState === "function"
        ? window.RBBackend.getState()
        : null;
      if (backendState && backendState.ready && backendState.user && typeof window.RBBackend.recordScore === "function") {
        window.RBBackend.recordScore(id, numericScore).catch((error) => {
          console.warn("[Rainbot] Cloud score sync failed", error);
        });
      }
      return true; // new high score
    }
    return false;
  }

  function getHighScore(gameId) {
    return state.scores[cleanGameId(gameId)] || 0;
  }

  function mergeHighScores(scores) {
    if (!scores || typeof scores !== "object") return false;
    let changed = false;
    Object.entries(scores).forEach(([gameId, score]) => {
      const id = cleanGameId(gameId);
      const numericScore = Number(score) || 0;
      if (id && numericScore > (state.scores[id] || 0)) {
        state.scores[id] = numericScore;
        rememberHighScore(id, numericScore);
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => startGameSession(), { once: true });
  } else {
    startGameSession();
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
    recordGameSave,
    startGameSession,
    getGameplayStats,
    getLocalProfile,
    updateLocalProfile,
    toast,
    addNotify,
  };
})();

window.RB = RB;

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
