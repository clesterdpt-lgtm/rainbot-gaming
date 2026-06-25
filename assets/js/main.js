/* ============================================
   RAINBOT GAMING — site-wide JS
   - nav rendering
   - Pro badge
   - subscribe modal
   ============================================ */

// Detect whether we're at site root or in a subdir (games/, articles/, legal/)
// so generated nav links are correct whether the site is served
// from a server OR opened directly via file://
const RB_BASE = (() => {
  const p = location.pathname;
  if (p.includes("/games/") || p.includes("/articles/") || p.includes("/videos/") || p.includes("/legal/")) return "../";
  return "./";
})();

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

function getBackendState() {
  if (!window.RBBackend || typeof window.RBBackend.getState !== "function") {
    return { configured: false, ready: false, status: "disabled", user: null, profile: null, error: "" };
  }
  return window.RBBackend.getState();
}

function getBackendDisplayName(backendState) {
  const profileName = backendState && backendState.profile && backendState.profile.display_name;
  const userEmail = backendState && backendState.user && backendState.user.email;
  return profileName || (userEmail ? userEmail.split("@")[0] : "Profile");
}

function renderNav(state = RB.state) {
  const slot = document.getElementById("nav-slot");
  if (!slot) return;

  const backendState = getBackendState();
  const proBadge = state.isPro
    ? `<span class="nav__pro-state">PRO ACTIVE</span>`
    : "";
  const syncBadge = backendState.user
    ? `<span class="nav__pro-state nav__pro-state--sync">SYNC ON</span>`
    : "";
  const authLabel = backendState.user ? escapeHtml(getBackendDisplayName(backendState)) : "Login";
  const path = location.pathname;
  const isHome = path.endsWith("/") || path.endsWith("/index.html") || path === "";
  const isSlopwire = path.endsWith("/articles.html") || path.includes("/articles/");
  const isRainbotTv = path.endsWith("/videos.html") || path.includes("/videos/");
  const isAgentGames = path.endsWith("/agent-games.html") || path.includes("/recursive-reward-labyrinth") || path.includes("/consensus-collapse");
  const isAfterDark = path.endsWith("/after-dark.html") || path.includes("/again.html") || path.includes("/mr-feast-mansion");
  const isForum = path.endsWith("/community.html");
  const isGames = !isAgentGames && !isAfterDark && !isSlopwire && !isRainbotTv && !isForum && (path.endsWith("/games.html") || path.includes("/games/"));

  slot.innerHTML = `
    <a href="${RB_BASE}" class="nav__brand" title="Rainbot Network - free browser arcade">
      <img src="${RB_BASE}assets/img/mockup/rainbot-network-logo.png?v=20260622-network-font-1" alt="Rainbot Network" />
    </a>
    <div class="nav__links">
      <a href="${RB_BASE}" class="${isHome ? "is-active" : ""}">Home</a>
      <a href="${RB_BASE}games.html" class="${isGames ? "is-active" : ""}">Games</a>
      <a href="${RB_BASE}articles.html" class="${isSlopwire ? "is-active" : ""}">The Slopwire</a>
      <a href="${RB_BASE}videos.html" class="${isRainbotTv ? "is-active" : ""}">Rainbot TV</a>
      <a href="${RB_BASE}agent-games.html" class="${isAgentGames ? "is-active" : ""}">Agent Games</a>
      <a href="${RB_BASE}after-dark.html" class="${isAfterDark ? "is-active" : ""}">After Dark</a>
      <a href="${RB_BASE}community.html" class="${isForum ? "is-active" : ""}">Forum</a>
    </div>
    <form class="nav__search" role="search">
      <label class="sr-only" for="rb-search">Search Rainbot</label>
      <input id="rb-search" type="search" placeholder="Search..." autocomplete="off" />
      <button type="submit" aria-label="Search">Search</button>
    </form>
    <div class="nav__actions">
      ${proBadge}
      ${syncBadge}
      ${
        state.isPro
          ? `<a href="#" id="rb-manage-pro" class="nav__cta nav__cta--pro">Manage</a>`
          : `<a href="#" id="rb-go-pro" class="nav__cta nav__cta--pro">Pro</a>`
      }
      <a href="#" id="rb-login" class="nav__cta nav__cta--login">${authLabel}</a>
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
    if (confirm("Cancel Pro subscription? (mock - wire to your backend)")) {
      RB.cancelPro();
      RB.toast("Pro cancelled", "bad");
    }
  });
  const login = document.getElementById("rb-login");
  if (login) login.addEventListener("click", (e) => {
    e.preventDefault();
    if (getBackendState().user) openProfileModal();
    else openAuthModal();
  });
}

function bindSearch(root) {
  const form = root.querySelector(".nav__search");
  const input = root.querySelector("#rb-search");
  if (!form || !input) return;
  const searchable = Array.from(document.querySelectorAll("[data-title]"));

  const fallbackSearchPage = () => {
    const path = location.pathname;
    if (path.endsWith("/articles.html") || path.includes("/articles/")) return "articles.html";
    if (path.endsWith("/videos.html") || path.includes("/videos/")) return "videos.html";
    return "games.html";
  };

  const syncGamesQueryUrl = (query) => {
    if (!window.RBGamesCatalog || !history.replaceState) return;
    const url = new URL(location.href);
    if (query) {
      url.searchParams.set("q", query);
    } else {
      url.searchParams.delete("q");
    }
    history.replaceState(null, "", url);
  };

  const applySearch = () => {
    const query = input.value.trim().toLowerCase();
    if (window.RBGamesCatalog) {
      window.RBGamesCatalog.setSearch(query);
      return;
    }
    if (!searchable.length) return;
    searchable.forEach((item) => {
      const text = item.dataset.title.toLowerCase();
      item.toggleAttribute("hidden", query !== "" && !text.includes(query));
    });
  };

  if (window.RBGamesCatalog) {
    const initialQuery = window.RBGamesCatalog.getSearch();
    if (initialQuery) input.value = initialQuery;
  } else {
    const initialQuery = new URLSearchParams(location.search).get("q") || "";
    if (initialQuery) {
      input.value = initialQuery;
      requestAnimationFrame(applySearch);
    }
  }

  input.addEventListener("input", applySearch);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (window.RBGamesCatalog) {
      applySearch();
      syncGamesQueryUrl(input.value.trim());
      const target = document.querySelector("[data-search-scope]");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (searchable.length) {
      applySearch();
      const target = document.querySelector("[data-search-scope]");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const q = encodeURIComponent(input.value.trim());
    const fallbackPage = fallbackSearchPage();
    location.href = q ? `${RB_BASE}${fallbackPage}?q=${q}` : `${RB_BASE}${fallbackPage}`;
  });
}

function initGamesCatalog() {
  const catalog = document.querySelector("[data-games-catalog]");
  if (!catalog) return;

  const grid = catalog.querySelector("[data-games-grid]");
  const categorySelect = catalog.querySelector("[data-games-category]");
  const sortSelect = catalog.querySelector("[data-games-sort]");
  const resetButton = catalog.querySelector("[data-games-reset]");
  const countEl = catalog.querySelector("[data-games-count]");
  const emptyEl = catalog.querySelector("[data-games-empty]");
  if (!grid || !categorySelect || !sortSelect) return;

  const normalize = (value) => (value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const categoryKey = (value) => normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const parsePopularity = (value) => {
    const match = normalize(value).match(/([\d.]+)\s*k\s+playing/);
    return match ? Number(match[1]) * 1000 : 0;
  };

  const cards = Array.from(grid.querySelectorAll(".directory-card")).map((card, order) => {
    const category = card.querySelector(".directory-card__meta b")?.textContent.trim() || "Other";
    const detail = card.querySelector(".directory-card__meta em")?.textContent.trim() || "";
    const status = card.querySelector(".directory-card__status")?.textContent.trim() || "";
    const title = (
      card.querySelector(".directory-card__poster-title")?.textContent ||
      card.dataset.title ||
      card.getAttribute("href") ||
      ""
    ).replace(/\s+/g, " ").trim();
    const searchText = normalize([
      card.dataset.title,
      card.textContent,
      category,
      detail,
      status,
    ].join(" "));
    const newRank = (() => {
      const compactStatus = normalize(status);
      const compactDetail = normalize(detail);
      if (compactStatus === "new" || compactDetail.includes("fresh drop") || compactDetail.includes("new protocol")) return 4;
      if (compactStatus === "agent") return 3;
      if (compactStatus === "prototype" || compactDetail.includes("first playable")) return 2;
      if (compactStatus === "playable") return 1;
      return 0;
    })();

    return {
      card,
      order,
      title: title || `Game ${order + 1}`,
      category,
      categoryKey: categoryKey(category),
      detail,
      popularity: parsePopularity(detail),
      searchText,
      newRank,
    };
  });
  if (!cards.length) return;

  const categoryLabels = new Map();
  cards.forEach((item) => {
    if (!categoryLabels.has(item.categoryKey)) categoryLabels.set(item.categoryKey, item.category);
  });
  Array.from(categoryLabels.entries())
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      categorySelect.append(option);
    });

  const state = {
    category: "all",
    sort: "featured",
    search: normalize(new URLSearchParams(location.search).get("q") || ""),
  };

  const sortCards = () => {
    const sorted = cards.slice().sort((a, b) => {
      if (state.sort === "new") {
        return (b.newRank - a.newRank) || (a.order - b.order);
      }
      if (state.sort === "popular") {
        return (b.popularity - a.popularity) || (a.order - b.order);
      }
      if (state.sort === "category") {
        return a.category.localeCompare(b.category) || a.title.localeCompare(b.title);
      }
      if (state.sort === "az") {
        return a.title.localeCompare(b.title);
      }
      return a.order - b.order;
    });

    sorted.forEach((item) => grid.append(item.card));
  };

  const applyFilters = () => {
    state.category = categorySelect.value;
    state.sort = sortSelect.value;
    sortCards();

    let visible = 0;
    cards.forEach((item) => {
      const categoryMatch = state.category === "all" || item.categoryKey === state.category;
      const searchMatch = !state.search || item.searchText.includes(state.search);
      const show = categoryMatch && searchMatch;
      item.card.toggleAttribute("hidden", !show);
      if (show) visible += 1;
    });

    if (countEl) {
      countEl.textContent = visible === cards.length
        ? `${cards.length} games online`
        : `${visible} of ${cards.length} games`;
    }
    if (emptyEl) emptyEl.hidden = visible !== 0;
  };

  window.RBGamesCatalog = {
    getSearch() {
      return state.search;
    },
    setSearch(query) {
      state.search = normalize(query);
      applyFilters();
    },
    reset() {
      categorySelect.value = "all";
      sortSelect.value = "featured";
      state.search = "";
      const navSearch = document.getElementById("rb-search");
      if (navSearch) navSearch.value = "";
      if (history.replaceState) {
        const url = new URL(location.href);
        url.searchParams.delete("q");
        history.replaceState(null, "", url);
      }
      applyFilters();
    },
  };

  categorySelect.addEventListener("change", applyFilters);
  sortSelect.addEventListener("change", applyFilters);
  if (resetButton) resetButton.addEventListener("click", () => window.RBGamesCatalog.reset());

  applyFilters();
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

function setModalStatus(root, message, kind = "") {
  const status = root.querySelector("[data-modal-status]");
  if (!status) return;
  status.textContent = message || "";
  status.dataset.kind = kind;
}

function openAuthModal() {
  if (document.getElementById("rb-auth-modal")) return;
  const backendState = getBackendState();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop modal-backdrop--open";
  backdrop.id = "rb-auth-modal";
  const setupBody = `
    <div class="modal__body">
      Rainbot accounts are staged, but Supabase is not connected yet. Add your project URL and anon key in <code>assets/js/supabase-config.js</code>, then run the SQL in <code>supabase/migrations</code>.
    </div>
    <div class="modal__actions">
      <button class="btn btn--secondary" id="rb-close-auth">Got it</button>
    </div>
  `;
  const loginBody = `
    <form class="rb-auth-form" id="rb-auth-form">
      <label class="rb-form-field" for="rb-auth-email">
        <span>Email</span>
        <input id="rb-auth-email" type="email" autocomplete="email" placeholder="you@example.com" required />
      </label>
      <button class="btn btn--primary" type="submit">Send Magic Link</button>
    </form>
    <p class="modal__body rb-modal-note">Use the same login later for cloud saves, high scores, profile, and forum posts.</p>
    <div class="modal__actions">
      <button class="btn btn--ghost" id="rb-close-auth" type="button">Close</button>
    </div>
  `;
  backdrop.innerHTML = `
    <div class="modal rb-account-modal" role="dialog" aria-modal="true" aria-labelledby="rb-auth-title">
      <div class="modal__title" id="rb-auth-title">Rainbot Account</div>
      ${backendState.configured ? loginBody : setupBody}
      <p class="rb-modal-status" data-modal-status></p>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#rb-close-auth").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  const form = backdrop.querySelector("#rb-auth-form");
  if (form) {
    const email = form.querySelector("#rb-auth-email");
    email.focus();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button[type='submit']");
      button.disabled = true;
      setModalStatus(backdrop, "Sending sign-in link...", "");
      try {
        await window.RBBackend.signInWithEmail(email.value);
        setModalStatus(backdrop, "Check your email for the Rainbot sign-in link.", "good");
        RB.toast("Magic link sent", "good");
      } catch (error) {
        setModalStatus(backdrop, error.message || "Sign-in failed.", "bad");
      } finally {
        button.disabled = false;
      }
    });
  }
}

function openProfileModal() {
  const backendState = getBackendState();
  if (!backendState.user) {
    openAuthModal();
    return;
  }
  if (document.getElementById("rb-profile-modal")) return;
  const displayName = getBackendDisplayName(backendState);
  const email = backendState.user.email || "";
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop modal-backdrop--open";
  backdrop.id = "rb-profile-modal";
  backdrop.innerHTML = `
    <div class="modal rb-account-modal" role="dialog" aria-modal="true" aria-labelledby="rb-profile-title">
      <div class="modal__title" id="rb-profile-title">Profile</div>
      <p class="modal__body rb-modal-note">Signed in as ${escapeHtml(email)}. Cloud saves and high scores sync when the backend is connected.</p>
      <form class="rb-auth-form" id="rb-profile-form">
        <label class="rb-form-field" for="rb-display-name">
          <span>Display Name</span>
          <input id="rb-display-name" type="text" maxlength="32" value="${escapeHtml(displayName)}" required />
        </label>
        <button class="btn btn--primary" type="submit">Save Profile</button>
      </form>
      <div class="modal__actions rb-profile-actions">
        <button class="btn btn--secondary" id="rb-sync-now" type="button">Sync Now</button>
        <button class="btn btn--ghost" id="rb-sign-out" type="button">Sign Out</button>
        <button class="btn btn--ghost" id="rb-close-profile" type="button">Close</button>
      </div>
      <p class="rb-modal-status" data-modal-status></p>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#rb-close-profile").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelector("#rb-profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type='submit']");
    const displayInput = backdrop.querySelector("#rb-display-name");
    button.disabled = true;
    setModalStatus(backdrop, "Saving profile...", "");
    try {
      await window.RBBackend.updateProfile({ display_name: displayInput.value });
      setModalStatus(backdrop, "Profile saved.", "good");
      RB.toast("Profile saved", "good");
      renderNav(RB.state);
    } catch (error) {
      setModalStatus(backdrop, error.message || "Profile save failed.", "bad");
    } finally {
      button.disabled = false;
    }
  });
  backdrop.querySelector("#rb-sync-now").addEventListener("click", async () => {
    setModalStatus(backdrop, "Syncing local saves and high scores...", "");
    try {
      await syncRainbotCloudState();
      setModalStatus(backdrop, "Sync complete.", "good");
      RB.toast("Cloud sync complete", "good");
    } catch (error) {
      setModalStatus(backdrop, error.message || "Sync failed.", "bad");
    }
  });
  backdrop.querySelector("#rb-sign-out").addEventListener("click", async () => {
    setModalStatus(backdrop, "Signing out...", "");
    try {
      await window.RBBackend.signOut();
      RB.toast("Signed out", "good");
      close();
    } catch (error) {
      setModalStatus(backdrop, error.message || "Sign out failed.", "bad");
    }
  });
}

function loadScriptOnce(src, id) {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id);
    if (existing) {
      if (existing.dataset.loaded === "true") resolve();
      else existing.addEventListener("load", () => resolve(), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.id = id;
    script.async = false;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

async function initRainbotBackend() {
  try {
    await loadScriptOnce(`${RB_BASE}assets/js/supabase-config.js?v=20260624-backend-1`, "rb-supabase-config");
    await loadScriptOnce(`${RB_BASE}assets/js/rainbot-backend.js?v=20260624-backend-1`, "rb-backend-runtime");
    if (window.RBBackend && typeof window.RBBackend.init === "function") {
      await window.RBBackend.init();
    }
  } catch (error) {
    console.warn("[Rainbot] Backend scripts failed to load", error);
  } finally {
    renderNav(RB.state);
  }
}

async function syncRainbotCloudState() {
  const backend = window.RBBackend;
  if (!backend || !backend.getState().user || !backend.getState().ready) return;
  if (window.RBGameSaves && typeof window.RBGameSaves.syncWithCloud === "function") {
    await window.RBGameSaves.syncWithCloud();
  }
  const localScores = RB.state.scores || {};
  const scoreEntries = Object.entries(localScores).filter((entry) => Number(entry[1]) > 0);
  await Promise.allSettled(scoreEntries.map(([gameId, score]) => backend.recordScore(gameId, score)));
  const cloudScores = await backend.loadMyScores();
  RB.mergeHighScores(cloudScores);
}

let lastCloudSyncUserId = "";

function handleBackendAuthChange(event) {
  const backendState = event.detail || getBackendState();
  renderNav(RB.state);
  if (!backendState.ready || !backendState.user) {
    lastCloudSyncUserId = "";
    return;
  }
  if (lastCloudSyncUserId === backendState.user.id) return;
  lastCloudSyncUserId = backendState.user.id;
  syncRainbotCloudState().catch((error) => {
    console.warn("[Rainbot] Initial cloud sync failed", error);
  });
}

const RBGameSaves = (() => {
  const PREFIX = "rainbot_game_save:";
  const slots = new Map();

  function storageKey(gameId) {
    return PREFIX + gameId;
  }

  function readRaw(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (error) {
      return null;
    }
  }

  function writeRaw(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function clearRaw(key) {
    try {
      localStorage.removeItem(key);
    } catch (error) {}
  }

  function canUseCloud() {
    const backend = window.RBBackend;
    if (!backend || typeof backend.getState !== "function") return false;
    const backendState = backend.getState();
    return Boolean(backendState.ready && backendState.user);
  }

  function saveCloud(gameId, saved) {
    if (!canUseCloud() || !saved) return;
    window.RBBackend.saveGame(gameId, saved).catch((error) => {
      console.warn("[Rainbot] Cloud save failed", error);
    });
  }

  function clearCloud(gameId) {
    if (!canUseCloud()) return;
    window.RBBackend.deleteGame(gameId).catch((error) => {
      console.warn("[Rainbot] Cloud save delete failed", error);
    });
  }

  function listLocalSaves() {
    const saves = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(PREFIX)) continue;
        const gameId = key.slice(PREFIX.length);
        const saved = readRaw(key);
        if (gameId && saved && saved.data) saves.push({ gameId, key, saved });
      }
    } catch (error) {}
    return saves;
  }

  function formatSavedAt(value) {
    const date = new Date(value || 0);
    if (Number.isNaN(date.getTime())) return "Saved progress";
    return "Saved " + date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function create(gameId, options = {}) {
    const key = storageKey(gameId);
    const version = options.version || 1;
    let timer = 0;
    const refreshers = new Set();

    const slot = {
      key,
      gameId,
      version,
      read() {
        const saved = readRaw(key);
        if (!saved || saved.version !== version || !saved.data) return null;
        return saved;
      },
      has() {
        return !!this.read();
      },
      save(data, meta = {}) {
        if (!data || typeof data !== "object") return false;
        const saved = {
          version,
          savedAt: Date.now(),
          meta,
          data,
        };
        const ok = writeRaw(key, saved);
        if (ok) saveCloud(gameId, saved);
        return ok;
      },
      clear() {
        clearRaw(key);
        clearCloud(gameId);
      },
      startAutosave(getData, shouldSave = () => true, intervalMs = 2500) {
        const tick = () => {
          if (shouldSave()) this.save(getData());
        };
        if (timer) clearInterval(timer);
        timer = setInterval(tick, intervalMs);
        window.addEventListener("beforeunload", tick);
        return tick;
      },
      attachButtons(config) {
        const primary = config.primary;
        if (!primary) return null;
        let continueButton = config.continueButton || document.getElementById(config.continueId || `${gameId}-continue-save`);
        if (!continueButton) {
          continueButton = document.createElement("button");
          continueButton.type = "button";
          continueButton.id = config.continueId || `${gameId}-continue-save`;
          continueButton.className = config.continueClass || "btn btn--secondary rb-save-continue";
          primary.insertAdjacentElement("beforebegin", continueButton);
        }

        const refresh = () => {
          const saved = this.read();
          continueButton.hidden = !saved;
          if (saved) {
            continueButton.textContent = config.continueLabel || "Continue";
            if (config.newLabel) primary.textContent = config.newLabel;
            if (config.scoreEl && config.summary) {
              config.scoreEl.style.display = "block";
              config.scoreEl.innerHTML = config.summary(saved) || formatSavedAt(saved.savedAt);
            }
          }
        };
        refreshers.add(refresh);

        continueButton.addEventListener("click", () => {
          const saved = this.read();
          if (!saved) {
            refresh();
            return;
          }
          config.onContinue(saved);
        });

        refresh();
        return { button: continueButton, refresh };
      },
      refresh() {
        refreshers.forEach((refresh) => refresh());
      },
    };

    slots.set(gameId, slot);
    return slot;
  }

  async function syncActiveCloudSaves() {
    if (!canUseCloud()) return;
    const tasks = Array.from(slots.values()).map(async (slot) => {
      const cloud = await window.RBBackend.loadGame(slot.gameId);
      if (!cloud || cloud.version !== slot.version || !cloud.data) return;
      const local = slot.read();
      if (!local || Number(cloud.savedAt) > Number(local.savedAt || 0)) {
        writeRaw(slot.key, cloud);
        slot.refresh();
      }
    });
    await Promise.allSettled(tasks);
  }

  async function syncLocalSavesToCloud() {
    if (!canUseCloud()) return;
    const saves = listLocalSaves();
    await Promise.allSettled(saves.map(({ gameId, saved }) => window.RBBackend.saveGame(gameId, saved)));
  }

  async function syncWithCloud() {
    if (!canUseCloud()) return;
    await syncActiveCloudSaves();
    await syncLocalSavesToCloud();
  }

  return { create, formatSavedAt, syncWithCloud };
})();

window.RBGameSaves = RBGameSaves;

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
  initGamesCatalog();
  RB.subscribe((state) => renderNav(state));
  window.addEventListener("rainbot:authchange", handleBackendAuthChange);
  initRainbotBackend();
  scheduleGameCanvasFit();
});

window.addEventListener("load", scheduleGameCanvasFit);
window.addEventListener("resize", scheduleGameCanvasFit);
