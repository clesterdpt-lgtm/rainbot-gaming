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

const RB_PROFILE_AVATAR_ROOT = "assets/img/avatars/";
const RB_PROFILE_AVATARS = [
  { value: "bot", label: "Rainbot", file: "rainbot-avatar-01-rainbot.png" },
  { value: "glitch", label: "Glitch", file: "rainbot-avatar-02-glitch-helmet.png" },
  { value: "storm", label: "Storm", file: "rainbot-avatar-03-storm-mask.png" },
  { value: "slime", label: "Slime", file: "rainbot-avatar-04-slime.png" },
  { value: "crown", label: "Crown", file: "rainbot-avatar-05-neon-crown.png" },
  { value: "skull", label: "Skull", file: "rainbot-avatar-06-pixel-skull.png" },
  { value: "wizard", label: "Wizard", file: "rainbot-avatar-07-arcade-wizard.png" },
  { value: "ninja", label: "Ninja", file: "rainbot-avatar-08-synth-ninja.png" },
  { value: "pilot", label: "Pilot", file: "rainbot-avatar-09-star-pilot.png" },
  { value: "lava", label: "Lava", file: "rainbot-avatar-10-lava-core.png" },
  { value: "crystal", label: "Crystal", file: "rainbot-avatar-11-crystal-face.png" },
  { value: "joystick", label: "Joystick", file: "rainbot-avatar-12-joystick-hero.png" },
  { value: "cassette", label: "Cassette", file: "rainbot-avatar-13-cassette-dj.png" },
  { value: "racer", label: "Racer", file: "rainbot-avatar-14-speed-racer.png" },
  { value: "hacker", label: "Hacker", file: "rainbot-avatar-15-hacker-mask.png" },
  { value: "comet", label: "Comet", file: "rainbot-avatar-16-comet-face.png" },
  { value: "moon", label: "Moon", file: "rainbot-avatar-17-moon-bot.png" },
  { value: "cube", label: "Cube", file: "rainbot-avatar-18-thunder-cube.png" },
  { value: "flame", label: "Flame", file: "rainbot-avatar-19-flame-visor.png" },
  { value: "trophy", label: "Trophy", file: "rainbot-avatar-20-trophy-bot.png" },
  { value: "toaster", label: "Chaos Toaster", file: "rainbot-avatar-21-chaos-toaster.png" },
  { value: "brain", label: "Melty Brain", file: "rainbot-avatar-22-melty-brain.png" },
  { value: "cereal", label: "Cereal Boss", file: "rainbot-avatar-23-cereal-boss.png" },
  { value: "panic", label: "Panic Headset", file: "rainbot-avatar-24-panic-headset.png" },
  { value: "confused", label: "Confused Crown", file: "rainbot-avatar-25-confused-crown.png" },
  { value: "lag", label: "Lag Face", file: "rainbot-avatar-26-lag-face.png" },
  { value: "hotdog", label: "Hotdog Hero", file: "rainbot-avatar-27-hotdog-hero.png" },
  { value: "keycap", label: "Keycap Rage", file: "rainbot-avatar-28-keycap-rage.png" },
  { value: "dumpster", label: "Dumpster Fire", file: "rainbot-avatar-29-dumpster-fire.png" },
  { value: "npc", label: "NPC Smile", file: "rainbot-avatar-30-npc-smile.png" },
];
const RB_PROFILE_AVATAR_MAP = new Map(RB_PROFILE_AVATARS.map((avatar) => [avatar.value, avatar]));

const RB_PROFILE_ACCENTS = [
  { value: "cyan", label: "Cyan" },
  { value: "pink", label: "Pink" },
  { value: "yellow", label: "Yellow" },
  { value: "green", label: "Green" },
  { value: "red", label: "Red" },
  { value: "white", label: "White" },
];

function getLocalSaveCount() {
  if (!window.RBGameSaves || typeof window.RBGameSaves.listLocalSaves !== "function") return 0;
  return window.RBGameSaves.listLocalSaves().length;
}

function cleanProfileUiChoice(value, options, fallback) {
  const allowed = new Set(options.map((option) => option.value));
  const normalized = String(value || fallback).trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function getProfileAvatar(value) {
  const normalized = cleanProfileUiChoice(value, RB_PROFILE_AVATARS, "bot");
  return RB_PROFILE_AVATAR_MAP.get(normalized) || RB_PROFILE_AVATARS[0];
}

function profileAvatarSrc(value) {
  const avatar = getProfileAvatar(value);
  return `${RB_BASE}${RB_PROFILE_AVATAR_ROOT}${avatar.file}`;
}

window.RBProfileAvatars = {
  list: RB_PROFILE_AVATARS.map((avatar) => ({ ...avatar, src: profileAvatarSrc(avatar.value) })),
  get(value) {
    const avatar = getProfileAvatar(value);
    return { ...avatar, src: profileAvatarSrc(avatar.value) };
  },
};

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
    <div class="rb-auth-tabs" role="tablist" aria-label="Login method">
      <button class="rb-auth-tab is-active" type="button" role="tab" aria-selected="true" data-auth-mode="password">Password</button>
      <button class="rb-auth-tab" type="button" role="tab" aria-selected="false" data-auth-mode="magic">Magic Link</button>
    </div>
    <form class="rb-auth-form rb-auth-panel" id="rb-password-auth-form" data-auth-panel="password">
      <label class="rb-form-field" for="rb-password-email">
        <span>Email</span>
        <input id="rb-password-email" type="email" autocomplete="email" placeholder="you@example.com" required />
      </label>
      <label class="rb-form-field" for="rb-auth-password">
        <span>Password</span>
        <input id="rb-auth-password" type="password" autocomplete="current-password" minlength="8" required />
      </label>
      <div class="rb-auth-actions">
        <button class="btn btn--primary" type="submit">Sign In</button>
        <button class="btn btn--secondary" id="rb-create-account" type="button">Create Account</button>
        <button class="btn btn--ghost" id="rb-reset-password" type="button">Reset Password</button>
      </div>
    </form>
    <form class="rb-auth-form rb-auth-panel" id="rb-magic-auth-form" data-auth-panel="magic" hidden>
      <label class="rb-form-field" for="rb-magic-email">
        <span>Email</span>
        <input id="rb-magic-email" type="email" autocomplete="email" placeholder="you@example.com" required />
      </label>
      <button class="btn btn--primary" type="submit">Send Magic Link</button>
    </form>
    <div class="rb-auth-divider"><span>or</span></div>
    <button class="btn btn--secondary rb-google-button" id="rb-google-auth" type="button">Continue with Google</button>
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

  const passwordForm = backdrop.querySelector("#rb-password-auth-form");
  const magicForm = backdrop.querySelector("#rb-magic-auth-form");
  const googleButton = backdrop.querySelector("#rb-google-auth");
  if (passwordForm && magicForm) {
    const passwordEmail = passwordForm.querySelector("#rb-password-email");
    const passwordInput = passwordForm.querySelector("#rb-auth-password");
    const magicEmail = magicForm.querySelector("#rb-magic-email");
    const setMode = (mode) => {
      const usePassword = mode === "password";
      passwordForm.hidden = !usePassword;
      magicForm.hidden = usePassword;
      backdrop.querySelectorAll("[data-auth-mode]").forEach((button) => {
        const isActive = button.dataset.authMode === mode;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", isActive ? "true" : "false");
      });
      setModalStatus(backdrop, "", "");
      (usePassword ? passwordEmail : magicEmail).focus();
    };
    backdrop.querySelectorAll("[data-auth-mode]").forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.authMode));
    });
    passwordEmail.focus();
    passwordForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = passwordForm.querySelector("button[type='submit']");
      button.disabled = true;
      setModalStatus(backdrop, "Signing in...", "");
      try {
        await window.RBBackend.signInWithPassword(passwordEmail.value, passwordInput.value);
        setModalStatus(backdrop, "Signed in.", "good");
        RB.toast("Signed in", "good");
        close();
      } catch (error) {
        setModalStatus(backdrop, error.message || "Sign-in failed.", "bad");
      } finally {
        button.disabled = false;
      }
    });
    backdrop.querySelector("#rb-create-account").addEventListener("click", async () => {
      const button = backdrop.querySelector("#rb-create-account");
      button.disabled = true;
      setModalStatus(backdrop, "Creating account...", "");
      try {
        await window.RBBackend.signUpWithPassword(passwordEmail.value, passwordInput.value);
        setModalStatus(backdrop, "Account created. Check your email if confirmation is required.", "good");
        RB.toast("Account created", "good");
      } catch (error) {
        setModalStatus(backdrop, error.message || "Account creation failed.", "bad");
      } finally {
        button.disabled = false;
      }
    });
    backdrop.querySelector("#rb-reset-password").addEventListener("click", async () => {
      const button = backdrop.querySelector("#rb-reset-password");
      button.disabled = true;
      setModalStatus(backdrop, "Sending reset email...", "");
      try {
        await window.RBBackend.requestPasswordReset(passwordEmail.value);
        setModalStatus(backdrop, "Check your email for the password reset link.", "good");
        RB.toast("Reset email sent", "good");
      } catch (error) {
        setModalStatus(backdrop, error.message || "Reset failed.", "bad");
      } finally {
        button.disabled = false;
      }
    });
    magicForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = magicForm.querySelector("button[type='submit']");
      button.disabled = true;
      setModalStatus(backdrop, "Sending sign-in link...", "");
      try {
        await window.RBBackend.signInWithMagicLink(magicEmail.value);
        setModalStatus(backdrop, "Check your email for the Rainbot sign-in link.", "good");
        RB.toast("Magic link sent", "good");
      } catch (error) {
        setModalStatus(backdrop, error.message || "Sign-in failed.", "bad");
      } finally {
        button.disabled = false;
      }
    });
  }
  if (googleButton) {
    googleButton.addEventListener("click", async () => {
      googleButton.disabled = true;
      setModalStatus(backdrop, "Opening Google sign-in...", "");
      try {
        await window.RBBackend.signInWithGoogle();
      } catch (error) {
        setModalStatus(backdrop, error.message || "Google sign-in failed.", "bad");
        googleButton.disabled = false;
      }
    });
  }
}

function openPasswordRecoveryModal() {
  if (document.getElementById("rb-password-recovery-modal")) return;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop modal-backdrop--open";
  backdrop.id = "rb-password-recovery-modal";
  backdrop.innerHTML = `
    <div class="modal rb-account-modal" role="dialog" aria-modal="true" aria-labelledby="rb-password-recovery-title">
      <div class="modal__title" id="rb-password-recovery-title">Reset Password</div>
      <form class="rb-auth-form" id="rb-password-recovery-form">
        <label class="rb-form-field" for="rb-new-password">
          <span>New Password</span>
          <input id="rb-new-password" type="password" autocomplete="new-password" minlength="8" required />
        </label>
        <label class="rb-form-field" for="rb-confirm-password">
          <span>Confirm Password</span>
          <input id="rb-confirm-password" type="password" autocomplete="new-password" minlength="8" required />
        </label>
        <button class="btn btn--primary" type="submit">Save Password</button>
      </form>
      <div class="modal__actions">
        <button class="btn btn--ghost" id="rb-close-recovery" type="button">Close</button>
      </div>
      <p class="rb-modal-status" data-modal-status></p>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  const form = backdrop.querySelector("#rb-password-recovery-form");
  const passwordInput = backdrop.querySelector("#rb-new-password");
  const confirmInput = backdrop.querySelector("#rb-confirm-password");
  backdrop.querySelector("#rb-close-recovery").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  passwordInput.focus();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type='submit']");
    if (passwordInput.value !== confirmInput.value) {
      setModalStatus(backdrop, "Passwords do not match.", "bad");
      return;
    }
    button.disabled = true;
    setModalStatus(backdrop, "Saving password...", "");
    try {
      await window.RBBackend.updatePassword(passwordInput.value);
      setModalStatus(backdrop, "Password saved.", "good");
      RB.toast("Password updated", "good");
      close();
    } catch (error) {
      setModalStatus(backdrop, error.message || "Password update failed.", "bad");
    } finally {
      button.disabled = false;
    }
  });
}

function openProfileModal() {
  const backendState = getBackendState();
  if (!backendState.user) {
    openAuthModal();
    return;
  }
  if (document.getElementById("rb-profile-modal")) return;
  const profile = backendState.profile || {};
  const displayName = getBackendDisplayName(backendState);
  const email = backendState.user.email || "";
  const role = profile.role === "admin" ? "Admin" : profile.role === "moderator" ? "Moderator" : "Player";
  const profileTitle = profile.profile_title || "Arcade Regular";
  const bio = profile.bio || "";
  const favoriteGame = profile.favorite_game || "";
  const avatarStyle = cleanProfileUiChoice(profile.avatar_style, RB_PROFILE_AVATARS, "bot");
  const accentColor = cleanProfileUiChoice(profile.accent_color, RB_PROFILE_ACCENTS, "cyan");
  const avatarOptions = RB_PROFILE_AVATARS.map((option) => `
    <label class="rb-avatar-choice">
      <input type="radio" name="avatar_style" value="${option.value}"${option.value === avatarStyle ? " checked" : ""} />
      <span class="rb-avatar-choice__card">
        <img src="${escapeHtml(profileAvatarSrc(option.value))}" alt="" loading="lazy" decoding="async" />
        <span>${escapeHtml(option.label)}</span>
      </span>
    </label>
  `).join("");
  const accentOptions = RB_PROFILE_ACCENTS.map((option) => `
    <label class="rb-profile-swatch rb-profile-swatch--${option.value}">
      <input type="radio" name="accent_color" value="${option.value}"${option.value === accentColor ? " checked" : ""} />
      <span>${escapeHtml(option.label)}</span>
    </label>
  `).join("");
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop modal-backdrop--open";
  backdrop.id = "rb-profile-modal";
  backdrop.innerHTML = `
    <div class="modal rb-account-modal rb-profile-modal" role="dialog" aria-modal="true" aria-labelledby="rb-profile-title">
      <div class="modal__title" id="rb-profile-title">Profile</div>
      <div class="rb-profile-shell">
        <section class="rb-profile-preview" aria-label="Profile preview">
          <div class="rb-profile-card rb-profile-card--${accentColor}" data-profile-card>
            <span class="rb-profile-avatar rb-profile-avatar--image rb-profile-avatar--${avatarStyle} rb-profile-avatar--${accentColor}" data-profile-avatar aria-hidden="true">
              <img data-profile-avatar-img src="${escapeHtml(profileAvatarSrc(avatarStyle))}" alt="" />
            </span>
            <div class="rb-profile-card__copy">
              <span class="rb-profile-kicker">${escapeHtml(role)}</span>
              <strong data-profile-preview-name>${escapeHtml(displayName)}</strong>
              <span data-profile-preview-title>${escapeHtml(profileTitle)}</span>
              <p data-profile-preview-bio>${escapeHtml(bio || "No bio yet.")}</p>
              <em data-profile-preview-favorite>${escapeHtml(favoriteGame ? `Favorite: ${favoriteGame}` : "Favorite game not set")}</em>
            </div>
          </div>
          <div class="rb-profile-summary">
            <div class="rb-profile-stat">
              <span>Account</span>
              <strong>${escapeHtml(role)}</strong>
            </div>
            <div class="rb-profile-stat">
              <span>Saves</span>
              <strong>${String(getLocalSaveCount())}</strong>
            </div>
            <div class="rb-profile-stat rb-profile-stat--email">
              <span>Email</span>
              <strong>${escapeHtml(email || "Connected")}</strong>
            </div>
          </div>
        </section>
        <form class="rb-auth-form rb-profile-form" id="rb-profile-form">
          <div class="rb-profile-form-grid">
            <label class="rb-form-field" for="rb-display-name">
              <span>Display Name</span>
              <input id="rb-display-name" type="text" maxlength="32" value="${escapeHtml(displayName)}" required />
            </label>
            <label class="rb-form-field" for="rb-profile-title-input">
              <span>Title</span>
              <input id="rb-profile-title-input" type="text" maxlength="40" value="${escapeHtml(profileTitle)}" required />
            </label>
            <label class="rb-form-field" for="rb-favorite-game">
              <span>Favorite Game</span>
              <input id="rb-favorite-game" type="text" maxlength="80" value="${escapeHtml(favoriteGame)}" />
            </label>
          </div>
          <fieldset class="rb-profile-avatar-field">
            <legend>Avatar</legend>
            <div class="rb-avatar-choice-grid">${avatarOptions}</div>
          </fieldset>
          <label class="rb-form-field" for="rb-profile-bio">
            <span>Bio</span>
            <textarea id="rb-profile-bio" maxlength="180" rows="4">${escapeHtml(bio)}</textarea>
          </label>
          <fieldset class="rb-profile-accent-field">
            <legend>Accent</legend>
            <div class="rb-profile-swatches">${accentOptions}</div>
          </fieldset>
          <button class="btn btn--primary" type="submit">Save Profile</button>
        </form>
      </div>
      <div class="modal__actions rb-profile-actions">
        <button class="btn btn--secondary" id="rb-sync-now" type="button">Sync Now</button>
        <button class="btn btn--ghost" id="rb-change-password" type="button">Change Password</button>
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
  const form = backdrop.querySelector("#rb-profile-form");
  const displayInput = backdrop.querySelector("#rb-display-name");
  const titleInput = backdrop.querySelector("#rb-profile-title-input");
  const favoriteInput = backdrop.querySelector("#rb-favorite-game");
  const bioInput = backdrop.querySelector("#rb-profile-bio");
  const avatarInputs = Array.from(backdrop.querySelectorAll("input[name='avatar_style']"));
  const accentInputs = Array.from(backdrop.querySelectorAll("input[name='accent_color']"));
  const profileCard = backdrop.querySelector("[data-profile-card]");
  const profileAvatar = backdrop.querySelector("[data-profile-avatar]");
  const profileAvatarImg = backdrop.querySelector("[data-profile-avatar-img]");
  const previewName = backdrop.querySelector("[data-profile-preview-name]");
  const previewTitle = backdrop.querySelector("[data-profile-preview-title]");
  const previewBio = backdrop.querySelector("[data-profile-preview-bio]");
  const previewFavorite = backdrop.querySelector("[data-profile-preview-favorite]");
  const selectedAvatar = () => (avatarInputs.find((input) => input.checked) || avatarInputs[0] || {}).value || "bot";
  const selectedAccent = () => (accentInputs.find((input) => input.checked) || accentInputs[0] || {}).value || "cyan";
  const updatePreview = () => {
    const nextName = displayInput.value.trim() || "Rainbot Player";
    const nextTitle = titleInput.value.trim() || "Arcade Regular";
    const nextBio = bioInput.value.trim() || "No bio yet.";
    const nextFavorite = favoriteInput.value.trim();
    const nextAvatar = cleanProfileUiChoice(selectedAvatar(), RB_PROFILE_AVATARS, "bot");
    const nextAccent = cleanProfileUiChoice(selectedAccent(), RB_PROFILE_ACCENTS, "cyan");
    profileCard.className = `rb-profile-card rb-profile-card--${nextAccent}`;
    profileAvatar.className = `rb-profile-avatar rb-profile-avatar--image rb-profile-avatar--${nextAvatar} rb-profile-avatar--${nextAccent}`;
    profileAvatarImg.src = profileAvatarSrc(nextAvatar);
    previewName.textContent = nextName;
    previewTitle.textContent = nextTitle;
    previewBio.textContent = nextBio;
    previewFavorite.textContent = nextFavorite ? `Favorite: ${nextFavorite}` : "Favorite game not set";
  };
  [displayInput, titleInput, favoriteInput, bioInput].forEach((input) => input.addEventListener("input", updatePreview));
  avatarInputs.forEach((input) => input.addEventListener("change", updatePreview));
  accentInputs.forEach((input) => input.addEventListener("change", updatePreview));
  displayInput.focus();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    setModalStatus(backdrop, "Saving profile...", "");
    try {
      await window.RBBackend.updateProfile({
        display_name: displayInput.value,
        profile_title: titleInput.value,
        favorite_game: favoriteInput.value,
        bio: bioInput.value,
        avatar_style: selectedAvatar(),
        accent_color: selectedAccent(),
      });
      setModalStatus(backdrop, "Profile saved.", "good");
      RB.toast("Profile saved", "good");
      renderNav(RB.state);
      updatePreview();
    } catch (error) {
      setModalStatus(backdrop, error.message || "Profile save failed.", "bad");
    } finally {
      button.disabled = false;
    }
  });
  backdrop.querySelector("#rb-change-password").addEventListener("click", () => {
    openPasswordRecoveryModal();
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
    await loadScriptOnce(`${RB_BASE}assets/js/supabase-config.js?v=20260625-avatar-art-2`, "rb-supabase-config");
    await loadScriptOnce(`${RB_BASE}assets/js/rainbot-backend.js?v=20260625-avatar-art-2`, "rb-backend-runtime");
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
  if (backendState.passwordRecovery && backendState.user) {
    openPasswordRecoveryModal();
  }
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

  return { create, formatSavedAt, listLocalSaves, syncWithCloud };
})();

window.RBGameSaves = RBGameSaves;

function initGameEscapeMenu() {
  const isGamePage = location.pathname.includes("/games/") && document.querySelector(".game-stage");
  if (!isGamePage || document.getElementById("rb-escape-menu")) return;

  let pausedByMenu = false;
  let lastFocus = null;

  const playSurface =
    document.querySelector(".canvas-wrap") ||
    document.querySelector(".merge-board") ||
    document.querySelector(".game-stage") ||
    document.querySelector("main");
  if (!playSurface) return;

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "rb-escape-btn";
  menuButton.setAttribute("aria-label", "Open game menu");
  menuButton.setAttribute("title", "Menu (Esc)");
  menuButton.textContent = "\u2630";
  playSurface.appendChild(menuButton);

  const backdrop = document.createElement("div");
  backdrop.className = "rb-escape-menu";
  backdrop.id = "rb-escape-menu";
  backdrop.hidden = true;
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-labelledby", "rb-escape-menu-title");
  backdrop.innerHTML = `
    <div class="rb-escape-menu__panel">
      <div class="rb-escape-menu__eyebrow">Game Menu</div>
      <h2 class="rb-escape-menu__title" id="rb-escape-menu-title">Paused</h2>
      <p class="rb-escape-menu__body">Take a beat, then jump back in.</p>
      <div class="rb-escape-menu__actions">
        <button class="btn btn--primary" type="button" data-rb-escape-action="resume">Resume</button>
        <button class="btn btn--secondary" type="button" data-rb-escape-action="restart">Restart</button>
        <button class="btn btn--secondary" type="button" data-rb-escape-action="exit-max">Exit max screen</button>
        <button class="btn btn--ghost" type="button" data-rb-escape-action="games">All games</button>
      </div>
    </div>
  `;
  playSurface.appendChild(backdrop);

  const resumeButton = backdrop.querySelector('[data-rb-escape-action="resume"]');
  const restartButton = backdrop.querySelector('[data-rb-escape-action="restart"]');
  const exitMaxButton = backdrop.querySelector('[data-rb-escape-action="exit-max"]');

  const findPauseButton = () => (
    document.getElementById("btn-pause") ||
    document.getElementById("ssb-btn-pause") ||
    document.getElementById("btn-touch-pause") ||
    document.getElementById("storm-mobile-pause")
  );
  const findRestartButton = () => (
    document.getElementById("btn-restart") ||
    document.getElementById("btn-new") ||
    document.getElementById("btn-drive-restart")
  );
  const findMaxButton = () => document.getElementById("btn-fullscreen") || document.querySelector(".fullscreen-btn");
  const textIncludes = (element, needle) => element && element.textContent.toLowerCase().includes(needle);
  const isMaxed = () => Boolean(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.body.classList.contains("rb-game-maxed") ||
    document.querySelector(".is-maxed")
  );
  const pageLooksPaused = () => {
    const pauseButton = findPauseButton();
    if (textIncludes(pauseButton, "resume")) return true;
    if (document.body.classList.contains("micro-play-paused")) return true;
    return Array.from(document.querySelectorAll(".overlay--show, .scr--show"))
      .some((overlay) => overlay.textContent.toLowerCase().includes("paused"));
  };
  const shouldIgnoreEscape = (event) => {
    const target = event.target;
    if (target && target.closest && target.closest("input, textarea, select, [contenteditable='true']")) return true;
    return Boolean(document.querySelector(".modal-backdrop--open:not(#rb-escape-menu)"));
  };
  const refreshActions = () => {
    if (restartButton) restartButton.hidden = !findRestartButton();
    if (exitMaxButton) exitMaxButton.hidden = !isMaxed();
  };
  const pauseGameIfPossible = () => {
    if (pageLooksPaused()) return false;
    const pauseButton = findPauseButton();
    if (!pauseButton || pauseButton.disabled) return false;
    pauseButton.click();
    return true;
  };
  const resumeGameIfPossible = () => {
    const pauseButton = findPauseButton();
    if (!pauseButton || pauseButton.disabled) return;
    if (pausedByMenu || pageLooksPaused()) pauseButton.click();
  };
  const exitMaxScreen = () => {
    const exitNative = document.exitFullscreen || document.webkitExitFullscreen;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      try {
        const result = exitNative && exitNative.call(document);
        if (result && result.catch) result.catch(() => {});
      } catch (error) {}
    }

    const maxButton = findMaxButton();
    if (isMaxed() && maxButton && !maxButton.disabled) maxButton.click();
    document.querySelectorAll(".is-maxed").forEach((element) => element.classList.remove("is-maxed"));
    document.body.classList.remove("rb-game-maxed");
  };
  const closeMenu = ({ resume = false } = {}) => {
    if (resume) resumeGameIfPossible();
    backdrop.hidden = true;
    document.body.classList.remove("rb-escape-menu-open");
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus({ preventScroll: true });
    lastFocus = null;
    pausedByMenu = false;
  };
  const openMenu = () => {
    lastFocus = document.activeElement;
    pausedByMenu = pauseGameIfPossible();
    refreshActions();
    backdrop.hidden = false;
    document.body.classList.add("rb-escape-menu-open");
    if (resumeButton) resumeButton.focus({ preventScroll: true });
  };

  menuButton.addEventListener("click", openMenu);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeMenu();
  });
  backdrop.addEventListener("click", (event) => {
    const action = event.target.closest("[data-rb-escape-action]")?.dataset.rbEscapeAction;
    if (!action) return;
    if (action === "resume") closeMenu({ resume: true });
    if (action === "restart") {
      const restartButton = findRestartButton();
      closeMenu();
      if (restartButton && !restartButton.disabled) restartButton.click();
    }
    if (action === "exit-max") {
      exitMaxScreen();
      refreshActions();
      window.setTimeout(refreshActions, 100);
    }
    if (action === "games") {
      window.location.href = `${RB_BASE}games.html`;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (shouldIgnoreEscape(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (backdrop.hidden) openMenu();
    else closeMenu({ resume: true });
  }, true);
  document.addEventListener("fullscreenchange", refreshActions);
  document.addEventListener("webkitfullscreenchange", refreshActions);
}

let gameCanvasFitFrame = 0;

function scheduleGameCanvasFit() {
  if (gameCanvasFitFrame) cancelAnimationFrame(gameCanvasFitFrame);
  gameCanvasFitFrame = requestAnimationFrame(() => {
    gameCanvasFitFrame = 0;
    fitGameCanvases();
  });
}

function parseGameAspect(value) {
  const text = String(value || "").trim();
  if (!text || text === "auto") return NaN;
  if (text.includes("/")) {
    const parts = text.split("/").map((part) => Number.parseFloat(part));
    if (parts.length >= 2 && parts[0] > 0 && parts[1] > 0) return parts[0] / parts[1];
  }
  const numeric = Number.parseFloat(text);
  return numeric > 0 ? numeric : NaN;
}

function fitGameCanvases() {
  const targets = Array.from(document.querySelectorAll(".canvas-wrap, .merge-board"));
  if (!targets.length) return;

  const isNarrow = window.matchMedia("(max-width: 900px)").matches;
  const isShortLandscape = window.matchMedia("(max-height: 560px) and (orientation: landscape)").matches;

  targets.forEach((target) => {
    const canvas = target.querySelector("canvas");
    const stage = target.closest(".game-stage");
    if (!stage) return;

    const targetStyle = window.getComputedStyle(target);
    const naturalWidth = canvas
      ? Number(canvas.getAttribute("width")) || canvas.width || target.clientWidth
      : target.clientWidth;
    const naturalHeight = canvas
      ? Number(canvas.getAttribute("height")) || canvas.height || target.clientHeight
      : target.clientHeight;
    const aspect =
      parseGameAspect(targetStyle.getPropertyValue("--game-aspect")) ||
      parseGameAspect(targetStyle.aspectRatio) ||
      naturalWidth / Math.max(1, naturalHeight);
    const stageStyle = window.getComputedStyle(stage);
    const stagePaddingX =
      (parseFloat(stageStyle.paddingLeft) || 0) +
      (parseFloat(stageStyle.paddingRight) || 0);
    const availableWidth = Math.max(0, stage.clientWidth - stagePaddingX);
    let fitWidth = availableWidth;

    if (!isNarrow || isShortLandscape) {
      const targetRect = target.getBoundingClientRect();
      const visibleChildren = Array.from(stage.children).filter((child) => {
        const style = window.getComputedStyle(child);
        const rect = child.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width >= 0;
      });
      const targetIndex = visibleChildren.indexOf(target);
      const belowChildren = targetIndex >= 0 ? visibleChildren.slice(targetIndex + 1) : [];
      const belowHeight = belowChildren.reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
      const gap = parseFloat(stageStyle.rowGap || stageStyle.gap) || 0;
      const gapsBelow = Math.max(0, belowChildren.length) * gap;
      const bottomPadding = parseFloat(stageStyle.paddingBottom) || 0;
      const targetMarginBottom = parseFloat(targetStyle.marginBottom) || 0;
      const availableHeight = window.innerHeight - targetRect.top - belowHeight - gapsBelow - bottomPadding - targetMarginBottom - 18;
      const heightBoundWidth = availableHeight > 0 ? availableHeight * aspect : availableWidth;
      const maxWidth = parseFloat(targetStyle.getPropertyValue("--game-max-width"));

      fitWidth = Math.min(availableWidth, heightBoundWidth);
      if (Number.isFinite(maxWidth) && maxWidth > 0) {
        fitWidth = Math.min(fitWidth, maxWidth);
      }
    }

    if (Number.isFinite(fitWidth) && fitWidth > 0) {
      target.style.setProperty("--game-fit-width", `${Math.floor(fitWidth)}px`);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initGamesCatalog();
  initGameEscapeMenu();
  RB.subscribe((state) => renderNav(state));
  window.addEventListener("rainbot:authchange", handleBackendAuthChange);
  initRainbotBackend();
  scheduleGameCanvasFit();
});

window.addEventListener("load", scheduleGameCanvasFit);
window.addEventListener("resize", scheduleGameCanvasFit);
