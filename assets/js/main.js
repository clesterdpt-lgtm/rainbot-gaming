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
  return profileName || "Profile";
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
  { value: "pizza", label: "Pizza Panic", file: "rainbot-avatar-31-pizza-panic.png" },
  { value: "fries", label: "Sad Fries", file: "rainbot-avatar-32-sad-fries.png" },
  { value: "pickle", label: "Pickle CEO", file: "rainbot-avatar-33-pickle-ceo.png" },
  { value: "violin", label: "Tiny Violin", file: "rainbot-avatar-34-tiny-violin.png" },
  { value: "coffee", label: "Cursed Coffee", file: "rainbot-avatar-35-cursed-coffee.png" },
  { value: "error404", label: "Error 404", file: "rainbot-avatar-36-error-404.png" },
  { value: "disco", label: "Disco Dump", file: "rainbot-avatar-37-disco-dump.png" },
  { value: "sock", label: "Gym Sock", file: "rainbot-avatar-38-gym-sock.png" },
  { value: "nosignal", label: "No Signal", file: "rainbot-avatar-39-no-signal.png" },
  { value: "spreadsheet", label: "Spreadsheet Soul", file: "rainbot-avatar-40-spreadsheet-soul.png" },
  { value: "microwave", label: "Microwave Meltdown", file: "rainbot-avatar-41-microwave-meltdown.png" },
  { value: "banana", label: "Chaos Banana", file: "rainbot-avatar-42-chaos-banana.png" },
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

const RB_GAME_META = {
  "again": { title: "AGAIN.", scoreIds: ["again"] },
  "ai-slop-factory": { title: "AI Slop Factory", scoreIds: ["ai-slop-factory"] },
  "apop-demon-hunters": { title: "Apop Demon Moggers", scoreIds: ["apop"] },
  "billionaire-space-race": { title: "Billionaire Space Race", scoreIds: ["bsr"] },
  "boomer-monopoly": { title: "Boomer Monopoly", scoreIds: ["boomer_monopoly"] },
  "brainrot-2048": { title: "Brainrot 2048", scoreIds: ["brainrot2048"] },
  "consensus-collapse": { title: "Consensus Collapse", scoreIds: ["consensus-collapse"] },
  "dont-become-pizza": { title: "Don't Become Pizza", scoreIds: ["dont-become-pizza"] },
  "dont-fck-with-cats": { title: "Don't F*ck with Cats", scoreIds: ["dont-fck-with-cats"] },
  "dont-look-gym-girl": { title: "Don't Look at the Gym Girl", scoreIds: ["dont-look-gym-girl"] },
  "doorcrash-no-tip-nitro": { title: "DoorCrash: No Tip Nitro", scoreIds: ["doorcrash"] },
  "drone-hunter": { title: "Drone Hunter", scoreIds: ["dronehunter"] },
  "escape-poop-cruise": { title: "Escape the Poop Cruise", scoreIds: ["escape-poop-cruise"] },
  "flappy-stonks": { title: "Flappy Stonks", scoreIds: ["flappy-stonks"] },
  "gen-z-driving-simulator": { title: "Gen Z Driving Simulator", scoreIds: ["gen-z-driving-simulator"] },
  "karen-merger": { title: "Complaint Chain", scoreIds: ["karen-merger"] },
  "looksmaxxing-grindset": { title: "Looksmaxxing Grindset", scoreIds: ["looksmax"] },
  "mr-feast-mansion": { title: "Mr. Feast: Deadline Mansion", scoreIds: ["mrfeast3d"] },
  "recursive-reward-labyrinth": { title: "Recursive Reward Labyrinth", scoreIds: ["recursive-reward-labyrinth"] },
  "rizz-craft": { title: "Rizz-Craft", scoreIds: ["rizz-craft"] },
  "skibidi-toilet-tower-defense": {
    title: "Skibidi Toilet Tower Defense",
    scoreIds: [
      "skibidi_toilet_tower_defense_bathroom",
      "skibidi_toilet_tower_defense_sewer",
      "skibidi_toilet_tower_defense_rooftop",
    ],
  },
  "smooth-brain-snacker": { title: "Smooth Brain Snacker", scoreIds: ["smoothbrain"] },
  "storm-area-51": { title: "Storm Area 51: Raid The Base", scoreIds: ["storm-area-51"] },
  "strait-of-hormuz": { title: "Escape the Straight", scoreIds: ["hormuz"] },
  "super-slop-brothers": { title: "Super Slop Brothers", scoreIds: ["super-slop-brothers"] },
  "tardigrade-micro-mayhem": { title: "Tardigrade: Micro Mayhem", scoreIds: ["tardigrade-micro-mayhem"] },
  "the-last-signal": { title: "The Last Signal", scoreIds: ["the-last-signal"] },
  "the-weight": { title: "The Weight", scoreIds: ["the-weight"] },
  "unhoused-and-unhinged": { title: "Unhoused and Unhinged", scoreIds: ["unhoused-and-unhinged"] },
};

const RB_SCORE_TITLE_OVERRIDES = {
  skibidi_toilet_tower_defense_bathroom: "Skibidi TD: Bathroom",
  skibidi_toilet_tower_defense_sewer: "Skibidi TD: Sewer",
  skibidi_toilet_tower_defense_rooftop: "Skibidi TD: Rooftop",
};

const RB_GAME_VISUALS = {
  "again": { image: "assets/img/mockup/card-again.png?v=20260614-1", kind: "Horror" },
  "ai-slop-factory": { image: "assets/img/mockup/card-ai-slop-factory.png?v=20260614-3", kind: "Arcade" },
  "apop-demon-hunters": { image: "assets/img/mockup/card-apop-moggers-v3.png?v=20260613-5", kind: "Side-scroller" },
  "billionaire-space-race": { image: "assets/img/mockup/card-billionaire-space-race.png?v=20260613-6", kind: "Lander" },
  "boomer-monopoly": { image: "assets/img/mockup/card-boomer-monopoly.png?v=20260611-7", kind: "Board" },
  "brainrot-2048": { image: "assets/img/mockup/card-brainrot-2048.png?v=20260614-3", kind: "Puzzle" },
  "consensus-collapse": { image: "assets/img/agent-games/consensus-collapse.png?v=20260615-1", kind: "Agent Treaty" },
  "dont-become-pizza": { image: "assets/img/mockup/card-dont-become-pizza.png?v=20260621-pizza-2", kind: "Horror" },
  "dont-fck-with-cats": { image: "assets/img/mockup/card-dont-fck-with-cats.png?v=20260623-cats-1", kind: "Runner" },
  "dont-look-gym-girl": { image: "assets/img/mockup/card-gym-girl.png?v=20260611-7", kind: "Stealth" },
  "doorcrash-no-tip-nitro": { image: "assets/img/mockup/card-doorcrash-no-tip-nitro.png?v=20260612-1", kind: "3D Runner" },
  "drone-hunter": { image: "assets/img/mockup/card-drone-hunter.png?v=20260623-drone-2", kind: "Shooter" },
  "escape-poop-cruise": { image: "assets/img/mockup/card-escape-poop-cruise-v2.png?v=20260628-2", kind: "Horror FPS" },
  "flappy-stonks": { image: "assets/img/mockup/card-flappy-stonks-funny.png?v=20260626-2", kind: "Arcade" },
  "gen-z-driving-simulator": { image: "assets/img/mockup/card-gen-z-driving-simulator.png?v=20260618-1", kind: "3D Driving" },
  "karen-merger": { image: "assets/img/mockup/card-karen-merger.png?v=20260621-cover-2", kind: "Bubble Merge" },
  "looksmaxxing-grindset": { image: "assets/img/mockup/card-looksmaxxing.png?v=20260611-7", kind: "Sim / Idle" },
  "mr-feast-mansion": { image: "assets/img/mockup/card-mr-feast.png?v=20260611-7", kind: "Horror" },
  "recursive-reward-labyrinth": { image: "assets/img/agent-games/recursive-reward-labyrinth.png?v=20260615-1", kind: "Agent Protocol" },
  "rizz-craft": { image: "assets/img/mockup/card-rizz-craft.png?v=20260613-2", kind: "Sandbox" },
  "skibidi-toilet-tower-defense": { image: "assets/img/mockup/card-skibidi-toilet-tower-defense.png?v=20260611-9", kind: "Defense" },
  "smooth-brain-snacker": { image: "assets/img/mockup/card-smooth-brain-snacker.png?v=20260614-1", kind: "Arcade" },
  "storm-area-51": { image: "assets/img/storm-area-51/card-storm-area-51.png?v=20260622-1", kind: "Crowd Heist" },
  "strait-of-hormuz": { image: "assets/img/mockup/card-escape-straight-wide.png?v=20260611-7", kind: "Action" },
  "super-slop-brothers": { image: "assets/img/mockup/card-super-slop-brothers.png?v=20260623-ssb-2", kind: "Fighter" },
  "tardigrade-micro-mayhem": { image: "assets/img/mockup/card-tardigrade-micro-mayhem.png?v=20260613-3", kind: "3D Sandbox" },
  "the-last-signal": { image: "assets/img/the-last-signal/poster-ai-v4-title.jpg?v=20260702-tls-title-4", kind: "RTS" },
  "the-weight": { image: "assets/img/mockup/card-the-weight-wide-v2.png?v=20260617-weight-wide-4", kind: "Horror" },
  "unhoused-and-unhinged": { image: "assets/img/mockup/card-unhoused-and-unhinged.png?v=20260614-cover-1", kind: "3D Sandbox" },
};

const RB_DAILY_CHALLENGES = [
  {
    slug: "brainrot-2048",
    metric: "score",
    target: 2048,
    title: "Merge To 2048",
    objective: "Post a 2,048+ local best in Brainrot 2048.",
  },
  {
    slug: "escape-poop-cruise",
    metric: "sessions",
    target: 1,
    title: "Board The Cruise",
    objective: "Open Escape the Poop Cruise and start one run.",
  },
  {
    slug: "rizz-craft",
    metric: "minutes",
    target: 10,
    title: "Ten-Minute Build",
    objective: "Spend 10 minutes in Rizz-Craft.",
  },
  {
    slug: "storm-area-51",
    metric: "sessions",
    target: 2,
    title: "Double Raid",
    objective: "Log two Storm Area 51 attempts.",
  },
  {
    slug: "drone-hunter",
    metric: "score",
    target: 1000,
    title: "Target Practice",
    objective: "Set a 1,000+ local best in Drone Hunter.",
  },
  {
    slug: "flappy-stonks",
    metric: "score",
    target: 50,
    title: "Market Lift",
    objective: "Post a 50+ local best in Flappy Stonks.",
  },
];

const HOME_COMMUNITY_COMMENT_TARGETS = [
  { contentType: "game", contentId: "escape-poop-cruise", title: "Escape the Poop Cruise", href: "games/escape-poop-cruise.html", kicker: "Game thread" },
  { contentType: "game", contentId: "rizz-craft", title: "Rizz-Craft", href: "games/rizz-craft.html", kicker: "Game thread" },
  { contentType: "game", contentId: "brainrot-2048", title: "Brainrot 2048", href: "games/brainrot-2048.html", kicker: "Game thread" },
  { contentType: "article", contentId: "local-man-shadowbanned-by-own-fridge", title: "Shadowbanned By Own Refrigerator", href: "articles/local-man-shadowbanned-by-own-fridge.html", kicker: "Slopwire" },
  { contentType: "video", contentId: "area-51-raid-clap-alien-cheeks", title: "Area 51 Raid", href: "videos.html#featured", kicker: "Rainbot TV" },
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

function currentGameSlug() {
  const file = location.pathname.split("/").pop() || "";
  return file.replace(/\.html$/i, "");
}

function cleanVisibleGameTitle(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[^\w#]+/, "")
    .replace(/\s+[-\u2014]\s+Rainbot.*$/i, "")
    .trim();
}

function fallbackGameTitle() {
  return cleanVisibleGameTitle(
    document.querySelector(".game-page__title")?.textContent ||
    document.querySelector(".scr__title")?.textContent ||
    document.title ||
    "This Game"
  ) || "This Game";
}

function getGameMeta(slug = currentGameSlug()) {
  const normalized = String(slug || "").replace(/\.html$/i, "");
  const known = RB_GAME_META[normalized];
  if (known) return { slug: normalized, ...known };
  return { slug: normalized, title: fallbackGameTitle(), scoreIds: [normalized || "game"] };
}

function scoreIdsForMeta(meta) {
  const ids = Array.isArray(meta && meta.scoreIds) ? meta.scoreIds : [meta && meta.scoreId];
  return ids.map((id) => String(id || "").trim()).filter(Boolean);
}

function titleForScoreId(scoreId) {
  const id = String(scoreId || "").trim();
  if (RB_SCORE_TITLE_OVERRIDES[id]) return RB_SCORE_TITLE_OVERRIDES[id];
  const found = Object.values(RB_GAME_META).find((meta) => scoreIdsForMeta(meta).includes(id));
  return found ? found.title : cleanVisibleGameTitle(id.replace(/[_-]+/g, " ")) || "Rainbot Game";
}

function formatStatNumber(value) {
  return Math.max(0, Math.floor(Number(value) || 0)).toLocaleString();
}

window.RBGameInfo = {
  all: Object.entries(RB_GAME_META).map(([slug, meta]) => ({ slug, ...meta })),
  current: () => getGameMeta(),
  get: getGameMeta,
  scoreIdsForMeta,
  titleForScoreId,
};

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
  const path = location.pathname;
  const isHome = path.endsWith("/") || path.endsWith("/index.html") || path === "";
  const isSlopwire = path.endsWith("/articles.html") || path.includes("/articles/");
  const isRainbotTv = path.endsWith("/videos.html") || path.includes("/videos/");
  const isAgentGamesRoute = path.endsWith("/agent-games.html") || path.includes("/recursive-reward-labyrinth") || path.includes("/consensus-collapse");
  const isAfterDarkRoute = path.endsWith("/after-dark.html") || path.includes("/again.html") || path.includes("/mr-feast-mansion");
  const isForum = path.endsWith("/community.html");
  const isGames = !isSlopwire && !isRainbotTv && !isForum && (
    path.endsWith("/games.html") ||
    path.includes("/games/") ||
    isAgentGamesRoute ||
    isAfterDarkRoute
  );
  const localProfile = RB && typeof RB.getLocalProfile === "function" ? RB.getLocalProfile() : {};
  const localName = cleanVisibleGameTitle(localProfile.displayName || "");
  const localProfileLabel = localName && localName !== "Rainbot Player" ? localName : "Profile";
  const authLabel = backendState.user ? escapeHtml(getBackendDisplayName(backendState)) : escapeHtml(localProfileLabel);

  slot.innerHTML = `
    <a href="${RB_BASE}" class="nav__brand" title="Rainbot Network - free browser arcade">
      <img src="${RB_BASE}assets/img/mockup/rainbot-network-logo.png?v=20260622-network-font-1" alt="Rainbot Network" />
    </a>
    <div class="nav__links">
      <a href="${RB_BASE}" class="${isHome ? "is-active" : ""}">Home</a>
      <a href="${RB_BASE}games.html" class="${isGames ? "is-active" : ""}">Games</a>
      <a href="${RB_BASE}articles.html" class="${isSlopwire ? "is-active" : ""}">The Slopwire</a>
      <a href="${RB_BASE}videos.html" class="${isRainbotTv ? "is-active" : ""}">Rainbot TV</a>
      <a href="${RB_BASE}community.html" class="${isForum ? "is-active" : ""}">Community</a>
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
    openProfileModal();
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
  const gamesSections = [
    {
      key: "human",
      id: "human-games",
      eyebrow: "Human",
      title: "Human Games",
      deck: "Finger-operated arcade chaos, meme sims, runners, fighters, puzzles, and browser weirdness.",
    },
    {
      key: "agent",
      id: "agent-games",
      eyebrow: "Agent",
      title: "Agent Games",
      deck: "Protocol-first challenges built for AI agents, strict command grammars, and machine-readable state.",
    },
    {
      key: "after-dark",
      id: "after-dark-games",
      eyebrow: "After Dark",
      title: "After Dark",
      deck: "The cursed horror line: headphones, bad rooms, late-night decisions, and exits that feel optional.",
    },
  ];
  const afterDarkGameHrefs = new Set([
    "games/escape-poop-cruise.html",
    "games/dont-become-pizza.html",
    "games/again.html",
    "games/the-weight.html",
    "games/mr-feast-mansion.html",
  ]);
  const sectionForCard = (card) => {
    const href = (card.getAttribute("href") || "").replace(/^\.\//, "");
    const text = normalize(`${card.dataset.title || ""} ${card.textContent || ""}`);
    if (card.classList.contains("directory-card--agent") || href.includes("recursive-reward-labyrinth") || href.includes("consensus-collapse")) {
      return "agent";
    }
    if (afterDarkGameHrefs.has(href) || text.includes("rainbot after dark") || text.includes(" after dark")) {
      return "after-dark";
    }
    return "human";
  };
  const organizeCatalogSections = () => {
    const existingSections = Array.from(grid.children)
      .filter((child) => child.matches && child.matches("[data-games-section]"))
      .map((section) => ({
      key: section.dataset.gamesSection,
      section,
      grid: section.querySelector("[data-games-section-grid]") || grid,
      count: section.querySelector("[data-games-section-count]"),
    }));
    if (existingSections.length) return existingSections;

    const directCards = Array.from(grid.children).filter((child) => child.classList && child.classList.contains("directory-card"));
    if (!directCards.length) return [];

    grid.classList.add("games-section-stack");
    const fragment = document.createDocumentFragment();
    const sections = gamesSections.map((config) => {
      const section = document.createElement("section");
      section.className = `games-section games-section--${config.key}`;
      section.id = config.id;
      section.dataset.gamesSection = config.key;
      section.innerHTML = `
        <div class="games-section__header">
          <div>
            <span class="games-section__eyebrow">${config.eyebrow}</span>
            <h3>${config.title}</h3>
            <p>${config.deck}</p>
          </div>
          <span class="games-section__count" data-games-section-count>0 games</span>
        </div>
        <div class="directory-grid games-section__grid" data-games-section-grid></div>
      `;
      fragment.append(section);
      return {
        key: config.key,
        section,
        grid: section.querySelector("[data-games-section-grid]"),
        count: section.querySelector("[data-games-section-count]"),
      };
    });
    const sectionLookup = new Map(sections.map((section) => [section.key, section]));
    directCards.forEach((card) => {
      const sectionKey = sectionForCard(card);
      card.dataset.gameSection = sectionKey;
      (sectionLookup.get(sectionKey)?.grid || grid).append(card);
    });
    grid.append(fragment);
    return sections;
  };
  const sectionEls = organizeCatalogSections();
  const sectionGrids = new Map(sectionEls.map((section) => [section.key, section.grid]));
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
      sectionKey: card.dataset.gameSection || card.closest("[data-games-section]")?.dataset.gamesSection || sectionForCard(card),
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

    sorted.forEach((item) => {
      const sectionGrid = sectionGrids.get(item.sectionKey) || grid;
      sectionGrid.append(item.card);
    });
  };

  const applyFilters = () => {
    state.category = categorySelect.value;
    state.sort = sortSelect.value;
    sortCards();

    let visible = 0;
    const sectionVisible = new Map(sectionEls.map((section) => [section.key, 0]));
    cards.forEach((item) => {
      const categoryMatch = state.category === "all" || item.categoryKey === state.category;
      const searchMatch = !state.search || item.searchText.includes(state.search);
      const show = categoryMatch && searchMatch;
      item.card.toggleAttribute("hidden", !show);
      if (show) {
        visible += 1;
        sectionVisible.set(item.sectionKey, (sectionVisible.get(item.sectionKey) || 0) + 1);
      }
    });

    sectionEls.forEach((item) => {
      const sectionCount = sectionVisible.get(item.key) || 0;
      item.section.hidden = sectionCount === 0;
      if (item.count) item.count.textContent = `${sectionCount} ${sectionCount === 1 ? "game" : "games"}`;
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
  const localProfile = getLocalProfileSnapshot();
  const localProfileName = cleanVisibleGameTitle(localProfile.displayName || "");
  const signupNameValue = localProfileName && localProfileName !== "Rainbot Player" ? localProfileName : "";
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
      <label class="rb-form-field" for="rb-signup-display-name">
        <span>Player Name</span>
        <input id="rb-signup-display-name" type="text" autocomplete="nickname" maxlength="32" placeholder="Rainbot Player" value="${escapeHtml(signupNameValue)}" />
      </label>
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
    <p class="modal__body rb-modal-note">Use the same login later for cloud saves, high scores, profile, forum posts, and comments.</p>
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
    const signupDisplayName = passwordForm.querySelector("#rb-signup-display-name");
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
      const displayName = signupDisplayName.value.trim();
      if (displayName.length < 2) {
        setModalStatus(backdrop, "Enter a player name before creating an account.", "bad");
        signupDisplayName.focus();
        return;
      }
      button.disabled = true;
      setModalStatus(backdrop, "Creating account...", "");
      try {
        await window.RBBackend.signUpWithPassword(passwordEmail.value, passwordInput.value, { display_name: displayName });
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

function localScoreEntries() {
  const scores = (RB && RB.state && RB.state.scores) || {};
  return Object.entries(scores)
    .map(([gameId, score]) => ({ gameId, score: Math.max(0, Math.floor(Number(score) || 0)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || titleForScoreId(a.gameId).localeCompare(titleForScoreId(b.gameId)));
}

function getLocalProfileSnapshot() {
  if (RB && typeof RB.getLocalProfile === "function") return RB.getLocalProfile();
  return {
    displayName: "Rainbot Player",
    profileTitle: "Arcade Regular",
    bio: "",
    favoriteGame: "",
    avatarStyle: "bot",
    accentColor: "cyan",
  };
}

function profileField(profile, snakeKey, camelKey, fallback = "") {
  return profile && (profile[snakeKey] || profile[camelKey]) || fallback;
}

function gameplayStatsSnapshot() {
  if (RB && typeof RB.getGameplayStats === "function") return RB.getGameplayStats();
  return { totalPlayMs: 0, sessions: 0, playDays: {}, games: {} };
}

function formatPlayDuration(ms) {
  const minutes = Math.floor(Math.max(0, Number(ms) || 0) / 60000);
  if (minutes < 1) return "0m";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 1) return `${minutes}m`;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const dayHours = hours % 24;
  return dayHours ? `${days}d ${dayHours}h` : `${days}d`;
}

function formatShortDate(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return "Not yet";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentPlayStreak(playDays = {}) {
  let streak = 0;
  const date = new Date();
  for (let i = 0; i < 366; i += 1) {
    if (!playDays[localDateKey(date)]) break;
    streak += 1;
    date.setDate(date.getDate() - 1);
  }
  return streak;
}

function titleForProfileGame(gameId) {
  const id = String(gameId || "");
  if (RB_GAME_META[id]) return RB_GAME_META[id].title;
  return titleForScoreId(id);
}

function gameplayEntries(stats) {
  const games = stats && stats.games && typeof stats.games === "object" ? stats.games : {};
  return Object.entries(games).map(([gameId, gameStats]) => ({
    gameId,
    title: titleForProfileGame(gameId),
    playMs: Math.max(0, Number(gameStats.playMs) || 0),
    sessions: Math.max(0, Math.floor(Number(gameStats.sessions) || 0)),
    lastPlayedAt: Math.max(0, Number(gameStats.lastPlayedAt) || 0),
    lastSavedAt: Math.max(0, Number(gameStats.lastSavedAt) || 0),
    bestScore: Math.max(0, Math.floor(Number(gameStats.bestScore) || 0)),
  }));
}

function localSaveEntries() {
  if (!window.RBGameSaves || typeof window.RBGameSaves.listLocalSaves !== "function") return [];
  return window.RBGameSaves.listLocalSaves();
}

function profileRecentGamesMarkup(entries) {
  const recent = entries
    .filter((entry) => entry.lastPlayedAt)
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, 3);
  if (!recent.length) return "<small>No games opened yet</small>";
  return `
    <div class="rb-profile-recent-list">
      ${recent.map((entry) => `
        <span>
          <b>${escapeHtml(entry.title)}</b>
          <em>${escapeHtml(formatPlayDuration(entry.playMs))} - ${escapeHtml(formatShortDate(entry.lastPlayedAt))}</em>
        </span>
      `).join("")}
    </div>
  `;
}

function bestScoreForSlug(slug) {
  const meta = RB_GAME_META[slug] || { scoreIds: [slug] };
  const allowed = new Set([slug, ...scoreIdsForMeta(meta)]);
  return localScoreEntries()
    .filter((entry) => allowed.has(entry.gameId) || canonicalGameSlug(entry.gameId) === slug)
    .reduce((best, entry) => Math.max(best, entry.score), 0);
}

function gameplayTotalsForSlug(stats, slug) {
  return gameplayEntries(stats).reduce((totals, entry) => {
    if (canonicalGameSlug(entry.gameId) !== slug) return totals;
    totals.playMs += Math.max(0, Number(entry.playMs) || 0);
    totals.sessions += Math.max(0, Math.floor(Number(entry.sessions) || 0));
    totals.lastPlayedAt = Math.max(totals.lastPlayedAt, Number(entry.lastPlayedAt) || 0);
    totals.lastSavedAt = Math.max(totals.lastSavedAt, Number(entry.lastSavedAt) || 0);
    totals.bestScore = Math.max(totals.bestScore, Number(entry.bestScore) || 0);
    return totals;
  }, { playMs: 0, sessions: 0, lastPlayedAt: 0, lastSavedAt: 0, bestScore: 0 });
}

function achievementEntries() {
  const stats = gameplayStatsSnapshot();
  const entries = gameplayEntries(stats);
  const playedEntries = entries.filter((entry) => entry.sessions > 0 || entry.playMs > 0);
  const scoreEntries = localScoreEntries();
  const totalScore = scoreEntries.reduce((sum, entry) => sum + entry.score, 0);
  const bestScore = scoreEntries[0] ? scoreEntries[0].score : 0;
  const saveCount = localSaveEntries().length || getLocalSaveCount();
  const streak = currentPlayStreak(stats.playDays || {});
  const cruiseStats = gameplayTotalsForSlug(stats, "escape-poop-cruise");
  const achievements = [
    {
      id: "first-run",
      title: "First Run",
      detail: "Open any Rainbot game.",
      unlocked: (Number(stats.sessions) || 0) > 0 || playedEntries.length > 0,
      progress: `${formatStatNumber(stats.sessions)} sessions`,
    },
    {
      id: "scoreboard-rookie",
      title: "Scoreboard Rookie",
      detail: "Log one local high score.",
      unlocked: scoreEntries.length > 0,
      progress: `${formatStatNumber(scoreEntries.length)} scores`,
    },
    {
      id: "five-game-sampler",
      title: "Five-Game Sampler",
      detail: "Play five different games.",
      unlocked: playedEntries.length >= 5,
      progress: `${formatStatNumber(playedEntries.length)}/5 games`,
    },
    {
      id: "return-trip",
      title: "Return Trip",
      detail: "Build a two-day play streak.",
      unlocked: streak >= 2,
      progress: `${formatStatNumber(streak)}/2 days`,
    },
    {
      id: "save-slot",
      title: "Save Slot",
      detail: "Keep one active save.",
      unlocked: saveCount > 0,
      progress: `${formatStatNumber(saveCount)} saves`,
    },
    {
      id: "one-hour-chaos",
      title: "One-Hour Chaos",
      detail: "Play for one total hour.",
      unlocked: (Number(stats.totalPlayMs) || 0) >= 3600000,
      progress: `${formatPlayDuration(stats.totalPlayMs)}/1h`,
    },
    {
      id: "ten-k-club",
      title: "10K Club",
      detail: "Bank 10,000 total local points.",
      unlocked: totalScore >= 10000,
      progress: `${formatStatNumber(totalScore)}/10,000`,
    },
    {
      id: "cruise-survivor",
      title: "Cruise Survivor",
      detail: "Start a cruise run.",
      unlocked: cruiseStats.sessions > 0 || bestScoreForSlug("escape-poop-cruise") > 0,
      progress: cruiseStats.sessions > 0 ? `${formatStatNumber(cruiseStats.sessions)} runs` : "0 runs",
    },
    {
      id: "best-run",
      title: "Best Run",
      detail: "Post a 5,000+ local best.",
      unlocked: bestScore >= 5000,
      progress: `${formatStatNumber(bestScore)}/5,000`,
    },
  ];
  return achievements.sort((a, b) => Number(b.unlocked) - Number(a.unlocked));
}

function achievementBadgeImageSrc(id) {
  return `${RB_BASE}assets/img/badges/achievement-${id}.png?v=20260701-badge-art-1`;
}

function achievementBadgeMarkup(entry) {
  return `
    <span class="rb-achievement-badge ${entry.unlocked ? "is-unlocked" : "is-locked"}">
      <span class="rb-achievement-badge__art" aria-hidden="true">
        <img src="${escapeHtml(achievementBadgeImageSrc(entry.id))}" alt="" loading="lazy" decoding="async" />
      </span>
      <span class="rb-achievement-badge__copy">
        <b>${escapeHtml(entry.title)}</b>
        <small>${escapeHtml(entry.unlocked ? "Unlocked" : entry.progress)}</small>
        <em>${escapeHtml(entry.detail)}</em>
      </span>
    </span>
  `;
}

function profileAchievementsMarkup(limit = 6) {
  const entries = achievementEntries();
  const unlocked = entries.filter((entry) => entry.unlocked).length;
  return `
    <div class="rb-achievement-summary">
      <strong>${formatStatNumber(unlocked)}/${formatStatNumber(entries.length)}</strong>
      <small>Unlocked</small>
    </div>
    <div class="rb-achievement-list">
      ${entries.slice(0, limit).map(achievementBadgeMarkup).join("")}
    </div>
  `;
}

function levelTitleFor(level) {
  if (level >= 15) return "Arcade Legend";
  if (level >= 10) return "Challenge Grinder";
  if (level >= 6) return "Neon Regular";
  if (level >= 3) return "Slop Cadet";
  return "Arcade Rookie";
}

function xpNeededForLevel(level) {
  return 420 + Math.max(1, Number(level) || 1) * 180;
}

function playerLevelInfo() {
  const stats = gameplayStatsSnapshot();
  const entries = gameplayEntries(stats);
  const playedEntries = entries.filter((entry) => entry.sessions > 0 || entry.playMs > 0);
  const scoreEntries = localScoreEntries();
  const totalScore = scoreEntries.reduce((sum, entry) => sum + entry.score, 0);
  const saveCount = localSaveEntries().length || getLocalSaveCount();
  const achievements = achievementEntries();
  const unlockedAchievements = achievements.filter((entry) => entry.unlocked).length;
  const playMinutes = Math.floor((Number(stats.totalPlayMs) || 0) / 60000);
  const streak = currentPlayStreak(stats.playDays || {});
  const xp = Math.max(0, Math.floor(
    (Number(stats.sessions) || 0) * 25 +
    playedEntries.length * 120 +
    playMinutes * 5 +
    scoreEntries.length * 85 +
    Math.floor(totalScore / 100) +
    saveCount * 70 +
    unlockedAchievements * 260 +
    streak * 110
  ));
  let level = 1;
  let progressXp = xp;
  while (progressXp >= xpNeededForLevel(level) && level < 99) {
    progressXp -= xpNeededForLevel(level);
    level += 1;
  }
  const nextLevelXp = xpNeededForLevel(level);
  const percent = Math.max(0, Math.min(100, Math.round((progressXp / nextLevelXp) * 100)));
  return {
    level,
    title: levelTitleFor(level),
    xp,
    progressXp,
    nextLevelXp,
    percent,
    remainingXp: Math.max(0, nextLevelXp - progressXp),
    unlockedAchievements,
    totalAchievements: achievements.length,
  };
}

function profileGamerStatsMarkup(backendState = getBackendState()) {
  const profile = backendState.profile || {};
  const role = backendState.user
    ? profile.role === "admin" ? "Admin" : profile.role === "moderator" ? "Moderator" : "Player"
    : "Local Player";
  const scoreEntries = localScoreEntries();
  const best = scoreEntries[0] || null;
  const totalScore = scoreEntries.reduce((sum, entry) => sum + entry.score, 0);
  const stats = gameplayStatsSnapshot();
  const entries = gameplayEntries(stats);
  const playedEntries = entries.filter((entry) => entry.sessions > 0 || entry.playMs > 0);
  const mostPlayed = playedEntries.slice().sort((a, b) => b.playMs - a.playMs || b.sessions - a.sessions)[0] || null;
  const saveEntries = localSaveEntries();
  const lastSaveAt = Math.max(
    Number(stats.lastSavedAt) || 0,
    ...saveEntries.map((entry) => Number(entry.saved && entry.saved.savedAt) || 0)
  );
  const playDays = stats.playDays && typeof stats.playDays === "object" ? Object.keys(stats.playDays).length : 0;
  const streak = currentPlayStreak(stats.playDays || {});
  const cloudState = backendState.ready && backendState.user
    ? "Sync on"
    : backendState.configured
      ? "Cloud ready"
      : "Local only";
  const levelInfo = playerLevelInfo();
  return `
    <div class="rb-profile-stat rb-profile-stat--hero rb-profile-stat--wide rb-profile-stat--level">
      <span>Player Level</span>
      <strong>Level ${formatStatNumber(levelInfo.level)}</strong>
      <small>${escapeHtml(levelInfo.title)} - ${formatStatNumber(levelInfo.xp)} XP</small>
      <span class="rb-xp-bar" style="--progress: ${levelInfo.percent}%"><i></i></span>
      <small>${formatStatNumber(levelInfo.remainingXp)} XP to Level ${formatStatNumber(levelInfo.level + 1)}</small>
    </div>
    <div class="rb-profile-stat rb-profile-stat--hero rb-profile-stat--wide">
      <span>Gameplay Time</span>
      <strong>${escapeHtml(formatPlayDuration(stats.totalPlayMs))}</strong>
      <small>${formatStatNumber(stats.sessions)} sessions - ${formatStatNumber(playedEntries.length)} games played</small>
    </div>
    <div class="rb-profile-stat">
      <span>Rank</span>
      <strong>${escapeHtml(role)}</strong>
    </div>
    <div class="rb-profile-stat">
      <span>High Scores</span>
      <strong>${formatStatNumber(scoreEntries.length)}</strong>
      <small>${best ? `${escapeHtml(titleForScoreId(best.gameId))}` : "No scores yet"}</small>
    </div>
    <div class="rb-profile-stat">
      <span>Total Points</span>
      <strong>${formatStatNumber(totalScore)}</strong>
    </div>
    <div class="rb-profile-stat">
      <span>Play Days</span>
      <strong>${formatStatNumber(playDays)}</strong>
      <small>${streak ? `${formatStatNumber(streak)} day streak` : "Start a streak"}</small>
    </div>
    <div class="rb-profile-stat rb-profile-stat--wide">
      <span>Best Run</span>
      <strong>${best ? formatStatNumber(best.score) : "0"}</strong>
      <small>${escapeHtml(best ? titleForScoreId(best.gameId) : "No run logged yet")}</small>
    </div>
    <div class="rb-profile-stat rb-profile-stat--wide">
      <span>Most Played</span>
      <strong>${escapeHtml(mostPlayed ? mostPlayed.title : "No favorite yet")}</strong>
      <small>${mostPlayed ? `${escapeHtml(formatPlayDuration(mostPlayed.playMs))} - ${formatStatNumber(mostPlayed.sessions)} sessions` : "Play any game to start tracking"}</small>
    </div>
    <div class="rb-profile-stat">
      <span>Active Saves</span>
      <strong>${formatStatNumber(saveEntries.length || getLocalSaveCount())}</strong>
      <small>${escapeHtml(formatShortDate(lastSaveAt))}</small>
    </div>
    <div class="rb-profile-stat rb-profile-stat--wide">
      <span>Cloud</span>
      <strong>${escapeHtml(cloudState)}</strong>
      <small>${backendState.user ? "Saves and highs sync after login" : "Sign in to sync highs and saves"}</small>
    </div>
    <div class="rb-profile-stat rb-profile-stat--wide">
      <span>Recent Games</span>
      ${profileRecentGamesMarkup(entries)}
    </div>
    <div class="rb-profile-stat rb-profile-stat--wide rb-profile-stat--achievements">
      <span>Achievements</span>
      ${profileAchievementsMarkup(6)}
    </div>
  `;
}

function refreshProfileGamerStats(root) {
  const summary = root && root.querySelector("[data-profile-gamer-stats]");
  if (summary) summary.innerHTML = profileGamerStatsMarkup(getBackendState());
}

function canonicalGameSlug(gameId) {
  const id = String(gameId || "").replace(/\.html$/i, "");
  if (RB_GAME_META[id]) return id;
  const found = Object.entries(RB_GAME_META).find(([, meta]) => scoreIdsForMeta(meta).includes(id));
  return found ? found[0] : id;
}

function gameVisualForHome(gameId) {
  const slug = canonicalGameSlug(gameId);
  const meta = RB_GAME_META[slug] || {};
  const visual = RB_GAME_VISUALS[slug] || {};
  return {
    slug,
    title: meta.title || titleForProfileGame(gameId),
    href: `${RB_BASE}games/${slug}.html`,
    image: `${RB_BASE}${visual.image || "assets/img/mockup/rainbot-logo.png?v=20260622-network-font-1"}`,
    alt: visual.alt || "",
    kind: visual.kind || "Game",
  };
}

function formatRelativeActivity(value) {
  const time = Number(value) || 0;
  if (!time) return "Not played yet";
  const diffMs = Date.now() - time;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatShortDate(time);
}

function recentHomeGameEntries(limit = 3) {
  const stats = gameplayStatsSnapshot();
  const bySlug = new Map();
  gameplayEntries(stats).forEach((entry) => {
    const slug = canonicalGameSlug(entry.gameId);
    if (!slug) return;
    const existing = bySlug.get(slug) || {
      gameId: slug,
      title: titleForProfileGame(slug),
      playMs: 0,
      sessions: 0,
      lastPlayedAt: 0,
      lastSavedAt: 0,
      bestScore: 0,
      activityAt: 0,
    };
    existing.playMs += Math.max(0, Number(entry.playMs) || 0);
    existing.sessions += Math.max(0, Math.floor(Number(entry.sessions) || 0));
    existing.lastPlayedAt = Math.max(existing.lastPlayedAt, Number(entry.lastPlayedAt) || 0);
    existing.lastSavedAt = Math.max(existing.lastSavedAt, Number(entry.lastSavedAt) || 0);
    existing.bestScore = Math.max(existing.bestScore, Number(entry.bestScore) || 0);
    existing.activityAt = Math.max(existing.activityAt, existing.lastPlayedAt, existing.lastSavedAt);
    bySlug.set(slug, existing);
  });
  return Array.from(bySlug.values())
    .filter((entry) => entry.activityAt > 0)
    .sort((a, b) => b.activityAt - a.activityAt || b.sessions - a.sessions)
    .slice(0, limit);
}

function homeRecentCardMarkup(entry, index) {
  const visual = gameVisualForHome(entry.gameId);
  const sessionText = `${formatStatNumber(entry.sessions)} ${entry.sessions === 1 ? "session" : "sessions"}`;
  const timeText = formatPlayDuration(entry.playMs);
  const detailText = entry.sessions || entry.playMs
    ? `${timeText} played - ${sessionText}`
    : entry.bestScore
      ? `Best ${formatStatNumber(entry.bestScore)} - local run`
      : "Open your last run";
  return `
    <a class="home-recent-card ${index === 0 ? "home-recent-card--primary" : ""}" href="${escapeHtml(visual.href)}" data-title="${escapeHtml(`${visual.title} recently played ${visual.kind}`)}">
      <span class="home-recent-card__poster">
        <img src="${escapeHtml(visual.image)}" alt="${escapeHtml(visual.alt)}" loading="lazy" decoding="async" />
        <em>${escapeHtml(visual.kind)}</em>
      </span>
      <span class="home-recent-card__body">
        <small>${escapeHtml(formatRelativeActivity(entry.activityAt))}</small>
        <strong>${escapeHtml(visual.title)}</strong>
        <span>${escapeHtml(detailText)}</span>
      </span>
      <span class="home-recent-card__play" aria-hidden="true">Resume</span>
    </a>
  `;
}

function currentDailyChallenge() {
  const today = localDateKey(new Date());
  const hash = Array.from(today).reduce((sum, char, index) => sum + (char.charCodeAt(0) * (index + 3)), 0);
  return { ...RB_DAILY_CHALLENGES[hash % RB_DAILY_CHALLENGES.length], dateKey: today };
}

function dailyChallengeProgress(challenge) {
  const stats = gameplayStatsSnapshot();
  const totals = gameplayTotalsForSlug(stats, challenge.slug);
  let current = 0;
  let label = "";
  if (challenge.metric === "score") {
    current = Math.max(bestScoreForSlug(challenge.slug), totals.bestScore);
    label = `Best ${formatStatNumber(current)} / ${formatStatNumber(challenge.target)}`;
  } else if (challenge.metric === "minutes") {
    current = Math.floor(totals.playMs / 60000);
    label = `${formatStatNumber(current)} / ${formatStatNumber(challenge.target)} min`;
  } else {
    current = totals.sessions;
    label = `${formatStatNumber(current)} / ${formatStatNumber(challenge.target)} runs`;
  }
  const percent = Math.max(0, Math.min(100, Math.round((current / Math.max(1, challenge.target)) * 100)));
  return {
    current,
    label,
    percent,
    complete: current >= challenge.target,
  };
}

function homeDailyChallengeMarkup() {
  const challenge = currentDailyChallenge();
  const progress = dailyChallengeProgress(challenge);
  const visual = gameVisualForHome(challenge.slug);
  const status = progress.complete ? "Complete" : "In progress";
  return `
    <a class="home-daily-card ${progress.complete ? "is-complete" : ""}" href="${escapeHtml(visual.href)}" data-title="${escapeHtml(`${challenge.title} daily challenge ${visual.title}`)}">
      <span class="home-daily-card__poster">
        <img src="${escapeHtml(visual.image)}" alt="${escapeHtml(visual.alt)}" loading="lazy" decoding="async" />
        <em>${escapeHtml(status)}</em>
      </span>
      <span class="home-daily-card__body">
        <small>Today - ${escapeHtml(visual.kind)}</small>
        <strong>${escapeHtml(challenge.title)}</strong>
        <span>${escapeHtml(challenge.objective)}</span>
        <span class="home-progress-bar" style="--progress: ${progress.percent}%"><i></i></span>
        <b>${escapeHtml(progress.label)}</b>
      </span>
      <span class="home-daily-card__play" aria-hidden="true">${progress.complete ? "Play again" : "Start challenge"}</span>
    </a>
  `;
}

function homeAchievementsMarkup() {
  const entries = achievementEntries();
  const unlocked = entries.filter((entry) => entry.unlocked).length;
  const levelInfo = playerLevelInfo();
  return `
    <div class="home-achievements-card">
      <div class="home-level-card">
        <span class="home-level-card__badge" aria-hidden="true">
          <b>${formatStatNumber(levelInfo.level)}</b>
          <em>LVL</em>
        </span>
        <span class="home-level-card__body">
          <small>Player Level</small>
          <strong>${escapeHtml(levelInfo.title)}</strong>
          <span class="home-progress-bar" style="--progress: ${levelInfo.percent}%"><i></i></span>
          <em>${formatStatNumber(levelInfo.progressXp)} / ${formatStatNumber(levelInfo.nextLevelXp)} XP - ${formatStatNumber(levelInfo.remainingXp)} to next</em>
        </span>
      </div>
      <div class="home-achievements-card__header">
        <span>
          <small>Profile Progress</small>
          <strong>${formatStatNumber(unlocked)}/${formatStatNumber(entries.length)} unlocked</strong>
        </span>
        <button type="button" data-home-profile>Profile</button>
      </div>
      <div class="home-achievement-grid">
        ${entries.slice(0, 6).map((entry) => `
          <span class="home-achievement-badge ${entry.unlocked ? "is-unlocked" : "is-locked"}">
            <span class="home-achievement-badge__art" aria-hidden="true">
              <img src="${escapeHtml(achievementBadgeImageSrc(entry.id))}" alt="" loading="lazy" decoding="async" />
            </span>
            <span class="home-achievement-badge__copy">
              <b>${escapeHtml(entry.title)}</b>
              <em>${escapeHtml(entry.unlocked ? "Unlocked" : entry.progress)}</em>
            </span>
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function homeCommunityAuthorName(profile = {}) {
  return profile.display_name || profile.name || "Rainbot Player";
}

function homeCommunityAvatarMarkup(profile = {}) {
  const style = cleanProfileUiChoice(profile.avatar_style, RB_PROFILE_AVATARS, "bot");
  const accent = cleanProfileUiChoice(profile.accent_color, RB_PROFILE_ACCENTS, "cyan");
  return `
    <span class="home-community-avatar rb-profile-avatar--${style} rb-profile-avatar--${accent} rb-profile-avatar--image" aria-hidden="true">
      <img src="${escapeHtml(profileAvatarSrc(style))}" alt="" loading="lazy" decoding="async" />
    </span>
  `;
}

function formatCommunityTime(value) {
  const time = typeof value === "number" ? value : Date.parse(value || "");
  if (!Number.isFinite(time) || time <= 0) return "recently";
  return formatRelativeActivity(time);
}

function homeCommunityLocalScoreRows(limit = 3) {
  const localProfile = getLocalProfileSnapshot();
  const backendState = getBackendState();
  const author = {
    display_name: backendState.user ? getBackendDisplayName(backendState) : (localProfile.displayName || "You"),
    avatar_style: profileField(backendState.profile || localProfile, "avatar_style", "avatarStyle", "bot"),
    accent_color: profileField(backendState.profile || localProfile, "accent_color", "accentColor", "cyan"),
  };
  return localScoreEntries().slice(0, limit).map((entry, index) => ({
    name: author.display_name,
    score: entry.score,
    detail: titleForScoreId(entry.gameId),
    href: "community.html#leaderboard",
    author,
    rank: index + 1,
    local: true,
  }));
}

function homeCommunityFallbackTopics() {
  return [
    {
      title: "Daily Slop Challenge is live",
      meta: "Homepage loop",
      href: "#daily-challenge",
    },
    {
      title: "Show off your best local run",
      meta: "Community board",
      href: "community.html",
    },
    {
      title: "New achievements are tracking",
      meta: "Profile progress",
      href: "#community-pulse",
    },
  ];
}

function homeCommunityFallbackActivity() {
  const recent = recentHomeGameEntries(3);
  if (recent.length) {
    return recent.map((entry) => {
      const visual = gameVisualForHome(entry.gameId);
      return {
        title: visual.title,
        body: `${formatPlayDuration(entry.playMs)} played - ${formatRelativeActivity(entry.activityAt)}`,
        meta: visual.kind,
        href: visual.href,
      };
    });
  }
  return [
    {
      title: "Escape the Poop Cruise",
      body: "Players are boarding the latest release.",
      meta: "Now playing",
      href: "games/escape-poop-cruise.html",
    },
    {
      title: "Rainbot TV",
      body: "Area 51 footage is sitting in the featured slot.",
      meta: "Watch",
      href: "videos.html#featured",
    },
    {
      title: "The Slopwire",
      body: "Fresh fake-news dispatches are open for comments.",
      meta: "Read",
      href: "articles.html",
    },
  ];
}

function homeCommunityScoreRowsMarkup(rows) {
  if (!rows.length) {
    return `<div class="home-community-empty">No scores yet. A single run puts you on the board.</div>`;
  }
  return rows.map((row, index) => `
    <a class="home-community-row home-community-row--score" href="${escapeHtml(row.href || "community.html#leaderboard")}">
      ${homeCommunityAvatarMarkup(row.author || {})}
      <span>
        <strong>#${formatStatNumber(row.rank || index + 1)} ${escapeHtml(row.name || homeCommunityAuthorName(row.author))}</strong>
        <em>${escapeHtml(row.detail || titleForScoreId(row.game_id))}</em>
      </span>
      <b>${formatStatNumber(row.score)}</b>
    </a>
  `).join("");
}

function homeCommunityTextRowsMarkup(rows, emptyText) {
  if (!rows.length) return `<div class="home-community-empty">${escapeHtml(emptyText)}</div>`;
  return rows.map((row) => `
    <a class="home-community-row" href="${escapeHtml(row.href || "community.html")}">
      <span>
        <strong>${escapeHtml(row.title)}</strong>
        <em>${escapeHtml(row.meta || "")}</em>
      </span>
      ${row.body ? `<p>${escapeHtml(row.body)}</p>` : ""}
    </a>
  `).join("");
}

function homeCommunityPanelMarkup(data = {}) {
  const scoreRows = data.scoreRows || homeCommunityLocalScoreRows(3);
  const topicRows = data.topicRows || homeCommunityFallbackTopics();
  const activityRows = data.activityRows || homeCommunityFallbackActivity();
  const stateText = data.stateText || "Local pulse";
  return `
    <article class="home-community-card home-community-card--leaderboard">
      <div class="home-community-card__header">
        <span>
          <small>${escapeHtml(stateText)}</small>
          <strong>Top Players</strong>
        </span>
        <a href="community.html#leaderboard">Board</a>
      </div>
      <div class="home-community-list">${homeCommunityScoreRowsMarkup(scoreRows)}</div>
    </article>
    <article class="home-community-card">
      <div class="home-community-card__header">
        <span>
          <small>Latest Posts</small>
          <strong>Community Board</strong>
        </span>
        <a href="community.html">Post</a>
      </div>
      <div class="home-community-list">${homeCommunityTextRowsMarkup(topicRows, "No community posts yet.")}</div>
    </article>
    <article class="home-community-card">
      <div class="home-community-card__header">
        <span>
          <small>${data.hotLabel || "Hot Now"}</small>
          <strong>${data.hotTitle || "Activity Feed"}</strong>
        </span>
        <a href="articles.html">Feed</a>
      </div>
      <div class="home-community-list">${homeCommunityTextRowsMarkup(activityRows, "No activity yet.")}</div>
    </article>
  `;
}

function normalizeHomeCommunityScoreRows(rows = []) {
  return rows.slice(0, 3).map((row, index) => ({
    name: homeCommunityAuthorName(row.author || {}),
    score: Math.max(0, Math.floor(Number(row.score) || 0)),
    detail: titleForScoreId(row.game_id),
    href: "community.html#leaderboard",
    author: row.author || {},
    rank: index + 1,
  }));
}

function normalizeHomeCommunityTopics(rows = []) {
  return rows.slice(0, 3).map((topic) => ({
    title: topic.title || "Community topic",
    meta: `${topic.category || "General"} - ${formatCommunityTime(topic.last_activity_at || topic.created_at)}`,
    href: `community.html?topic=${Number(topic.id) || ""}`,
  }));
}

async function fetchHomeCommunityComments(limit = 3) {
  if (!window.RBBackend || typeof window.RBBackend.listContentComments !== "function") return [];
  const results = await Promise.allSettled(HOME_COMMUNITY_COMMENT_TARGETS.map(async (target) => {
    const rows = await window.RBBackend.listContentComments({
      contentType: target.contentType,
      contentId: target.contentId,
      sort: "best",
      limit: 4,
    });
    return rows.map((row) => ({ ...row, target }));
  }));
  return results
    .flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .sort((a, b) => (Number(b.vote_score) || 0) - (Number(a.vote_score) || 0) || Date.parse(b.created_at || "") - Date.parse(a.created_at || ""))
    .slice(0, limit)
    .map((comment) => ({
      title: comment.target.title,
      body: comment.body || "Community comment",
      meta: `${comment.target.kicker} - ${formatCommunityTime(comment.created_at)}`,
      href: `${comment.target.href}#comment-${Number(comment.id) || ""}`,
    }));
}

async function loadHomeCommunityLive(root, key) {
  const content = root && root.querySelector("[data-home-community-content]");
  if (!content || !window.RBBackend) return;
  try {
    const [scoreResult, topicResult, commentResult] = await Promise.allSettled([
      typeof window.RBBackend.listGlobalLeaderboard === "function" ? window.RBBackend.listGlobalLeaderboard(3) : Promise.resolve([]),
      typeof window.RBBackend.listTopics === "function" ? window.RBBackend.listTopics({ limit: 3 }) : Promise.resolve([]),
      fetchHomeCommunityComments(3),
    ]);
    if (root.dataset.homeCommunityFetchKey !== key) return;
    const scoreRows = scoreResult.status === "fulfilled" && scoreResult.value.length
      ? normalizeHomeCommunityScoreRows(scoreResult.value)
      : homeCommunityLocalScoreRows(3);
    const topicRows = topicResult.status === "fulfilled" && topicResult.value.length
      ? normalizeHomeCommunityTopics(topicResult.value)
      : homeCommunityFallbackTopics();
    const commentRows = commentResult.status === "fulfilled" && commentResult.value.length
      ? commentResult.value
      : homeCommunityFallbackActivity();
    content.innerHTML = homeCommunityPanelMarkup({
      scoreRows,
      topicRows,
      activityRows: commentRows,
      stateText: scoreResult.status === "fulfilled" && scoreResult.value.length ? "Live leaderboard" : "Local pulse",
      hotLabel: commentResult.status === "fulfilled" && commentResult.value.length ? "Hot Comment" : "Hot Now",
      hotTitle: commentResult.status === "fulfilled" && commentResult.value.length ? "Community Chatter" : "Activity Feed",
    });
    root.dataset.homeCommunityLive = "true";
  } catch (error) {
    console.warn("[Rainbot] Community pulse failed", error);
  }
}

function renderHomeCommunityPanel() {
  const root = document.querySelector("[data-home-community]");
  if (!root) return;
  const content = root.querySelector("[data-home-community-content]");
  if (!content) return;
  const backendState = getBackendState();
  const key = backendState.ready && backendState.user ? `user:${backendState.user.id}` : "anon";
  if (backendState.ready && root.dataset.homeCommunityFetchKey === key && root.dataset.homeCommunityLive === "true") return;
  content.innerHTML = homeCommunityPanelMarkup();
  root.dataset.homeCommunityLive = "false";
  if (!window.RBBackend || !backendState.ready) return;
  if (root.dataset.homeCommunityFetchKey === key) return;
  root.dataset.homeCommunityFetchKey = key;
  loadHomeCommunityLive(root, key);
}

function initHomeCommunityPanel() {
  const root = document.querySelector("[data-home-community]");
  if (!root) return;
  renderHomeCommunityPanel();
}

function renderHomeProgressPanel() {
  const root = document.querySelector("[data-home-progression]");
  if (!root) return;
  const challengeRoot = root.querySelector("[data-daily-challenge-content]");
  const achievementRoot = root.querySelector("[data-home-achievements-content]");
  const profileButton = root.querySelector(".arcade-panel__header [data-home-profile]");
  const signedIn = Boolean(getBackendState().user);
  if (profileButton) profileButton.textContent = signedIn ? "Achievements" : "Sign in";
  if (challengeRoot) challengeRoot.innerHTML = homeDailyChallengeMarkup();
  if (achievementRoot) achievementRoot.innerHTML = homeAchievementsMarkup();
}

function initHomeProgressPanel() {
  const root = document.querySelector("[data-home-progression]");
  if (!root || root.dataset.homeProgressBound === "true") return;
  root.dataset.homeProgressBound = "true";
  root.addEventListener("click", (event) => {
    const profileButton = event.target.closest("[data-home-profile]");
    if (!profileButton || !root.contains(profileButton)) return;
    event.preventDefault();
    openProfileModal();
  });
  renderHomeProgressPanel();
}

function renderHomeRecentPanel() {
  const root = document.querySelector("[data-home-recent]");
  if (!root) return;
  const content = root.querySelector("[data-home-recent-content]");
  const profileButton = root.querySelector(".arcade-panel__header [data-home-profile]");
  if (!content) return;

  const backendState = getBackendState();
  const signedIn = Boolean(backendState.user);
  const entries = recentHomeGameEntries(3);
  if (profileButton) profileButton.textContent = signedIn ? "Profile" : "Sign in";

  if (entries.length) {
    content.innerHTML = `<div class="home-recent-grid">${entries.map(homeRecentCardMarkup).join("")}</div>`;
    return;
  }

  const emptyKicker = signedIn
    ? `Welcome back, ${getBackendDisplayName(backendState)}`
    : "Sign in to sync";
  content.innerHTML = `
    <div class="home-recent-empty">
      <span>
        <small>${escapeHtml(emptyKicker)}</small>
        <strong>No recent games yet</strong>
        <em>Start a run and it will land here.</em>
      </span>
      <a href="${RB_BASE}games.html">Browse games</a>
      <button type="button" data-home-profile>${signedIn ? "Profile" : "Sign in"}</button>
    </div>
  `;
}

function initHomeRecentPanel() {
  const root = document.querySelector("[data-home-recent]");
  if (!root || root.dataset.homeRecentBound === "true") return;
  root.dataset.homeRecentBound = "true";
  root.addEventListener("click", (event) => {
    const profileButton = event.target.closest("[data-home-profile]");
    if (!profileButton || !root.contains(profileButton)) return;
    event.preventDefault();
    openProfileModal();
  });
  renderHomeRecentPanel();
}

function openProfileModal() {
  const backendState = getBackendState();
  if (document.getElementById("rb-profile-modal")) return;
  const signedIn = Boolean(backendState.user);
  const localProfile = getLocalProfileSnapshot();
  const profile = signedIn ? (backendState.profile || {}) : localProfile;
  const displayName = signedIn ? getBackendDisplayName(backendState) : (localProfile.displayName || "Rainbot Player");
  const email = signedIn ? (backendState.user.email || "") : "Saved on this device";
  const role = signedIn
    ? profile.role === "admin" ? "Admin" : profile.role === "moderator" ? "Moderator" : "Player"
    : "Local Player";
  const profileTitle = profileField(profile, "profile_title", "profileTitle", "Arcade Regular");
  const bio = profile.bio || "";
  const favoriteGame = profileField(profile, "favorite_game", "favoriteGame", "");
  const avatarStyle = cleanProfileUiChoice(profileField(profile, "avatar_style", "avatarStyle", "bot"), RB_PROFILE_AVATARS, "bot");
  const accentColor = cleanProfileUiChoice(profileField(profile, "accent_color", "accentColor", "cyan"), RB_PROFILE_ACCENTS, "cyan");
  const accountState = signedIn ? "Cloud Sync" : "Local Profile";
  const accountDetail = signedIn ? (email || "Connected") : "Saved on this device";
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
      <div class="modal__title rb-profile-titlebar">
        <span id="rb-profile-title">Player Profile</span>
        <small>${escapeHtml(accountState)}</small>
      </div>
      <section class="rb-profile-card rb-profile-hero rb-profile-card--${accentColor}" data-profile-card aria-label="Profile preview">
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
        <div class="rb-profile-account-line">
          <span>${escapeHtml(accountState)}</span>
          <strong>${escapeHtml(accountDetail)}</strong>
        </div>
      </section>
      <div class="rb-profile-shell">
        <section class="rb-profile-preview" aria-label="Gameplay stats">
          <div class="rb-profile-section-label">Player Stats</div>
          <div class="rb-profile-summary" data-profile-gamer-stats>
            ${profileGamerStatsMarkup(backendState)}
          </div>
        </section>
        <form class="rb-auth-form rb-profile-form" id="rb-profile-form">
          <div class="rb-profile-form-section">
            <div class="rb-profile-section-label">Identity</div>
            <div class="rb-profile-form-grid">
              <label class="rb-form-field" for="rb-display-name">
                <span>Display Name</span>
                <input id="rb-display-name" type="text" maxlength="32" value="${escapeHtml(displayName)}" required />
              </label>
              <label class="rb-form-field" for="rb-profile-title-input">
                <span>Title</span>
                <input id="rb-profile-title-input" type="text" maxlength="40" value="${escapeHtml(profileTitle)}" required />
              </label>
              <label class="rb-form-field rb-form-field--wide" for="rb-favorite-game">
                <span>Favorite Game</span>
                <input id="rb-favorite-game" type="text" maxlength="80" value="${escapeHtml(favoriteGame)}" />
              </label>
              <label class="rb-form-field rb-form-field--wide" for="rb-profile-bio">
                <span>Bio</span>
                <textarea id="rb-profile-bio" maxlength="180" rows="4">${escapeHtml(bio)}</textarea>
              </label>
            </div>
          </div>
          <div class="rb-profile-form-section">
            <div class="rb-profile-section-label">Style</div>
            <fieldset class="rb-profile-avatar-field">
              <legend>Avatar</legend>
              <div class="rb-avatar-choice-grid">${avatarOptions}</div>
            </fieldset>
            <fieldset class="rb-profile-accent-field">
              <legend>Accent</legend>
              <div class="rb-profile-swatches">${accentOptions}</div>
            </fieldset>
          </div>
          <button class="btn btn--primary" type="submit">Save Profile</button>
        </form>
      </div>
      <div class="modal__actions rb-profile-actions">
        ${
          signedIn
            ? `<button class="btn btn--secondary" id="rb-sync-now" type="button">Sync Now</button>
               <button class="btn btn--ghost" id="rb-change-password" type="button">Change Password</button>
               <button class="btn btn--ghost" id="rb-sign-out" type="button">Sign Out</button>`
            : `<button class="btn btn--secondary" id="rb-sign-in-profile" type="button">Sign In to Sync</button>`
        }
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
    profileCard.className = `rb-profile-card rb-profile-hero rb-profile-card--${nextAccent}`;
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
    setModalStatus(backdrop, signedIn ? "Saving profile..." : "Saving local profile...", "");
    try {
      if (signedIn) {
        await window.RBBackend.updateProfile({
          display_name: displayInput.value,
          profile_title: titleInput.value,
          favorite_game: favoriteInput.value,
          bio: bioInput.value,
          avatar_style: selectedAvatar(),
          accent_color: selectedAccent(),
        });
      } else if (RB && typeof RB.updateLocalProfile === "function") {
        RB.updateLocalProfile({
          displayName: displayInput.value,
          profileTitle: titleInput.value,
          favoriteGame: favoriteInput.value,
          bio: bioInput.value,
          avatarStyle: selectedAvatar(),
          accentColor: selectedAccent(),
        });
      }
      setModalStatus(backdrop, signedIn ? "Profile saved." : "Local profile saved.", "good");
      RB.toast(signedIn ? "Profile saved" : "Local profile saved", "good");
      renderNav(RB.state);
      updatePreview();
    } catch (error) {
      setModalStatus(backdrop, error.message || "Profile save failed.", "bad");
    } finally {
      button.disabled = false;
    }
  });
  const changePasswordButton = backdrop.querySelector("#rb-change-password");
  if (changePasswordButton) {
    changePasswordButton.addEventListener("click", () => {
      openPasswordRecoveryModal();
    });
  }
  const syncButton = backdrop.querySelector("#rb-sync-now");
  if (syncButton) {
    syncButton.addEventListener("click", async () => {
      setModalStatus(backdrop, "Syncing local saves and high scores...", "");
      try {
        await syncRainbotCloudState();
        refreshProfileGamerStats(backdrop);
        setModalStatus(backdrop, "Sync complete.", "good");
        RB.toast("Cloud sync complete", "good");
      } catch (error) {
        setModalStatus(backdrop, error.message || "Sync failed.", "bad");
      }
    });
  }
  const signInButton = backdrop.querySelector("#rb-sign-in-profile");
  if (signInButton) {
    signInButton.addEventListener("click", () => {
      close();
      openAuthModal();
    });
  }
  const signOutButton = backdrop.querySelector("#rb-sign-out");
  if (signOutButton) {
    signOutButton.addEventListener("click", async () => {
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
    await loadScriptOnce(`${RB_BASE}assets/js/supabase-config.js?v=20260628-comments-reddit-1`, "rb-supabase-config");
    await loadScriptOnce(`${RB_BASE}assets/js/rainbot-backend.js?v=20260629-avatar-icons-1`, "rb-backend-runtime");
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

const RBLeaderboards = (() => {
  const DEFAULT_GAME_LIMIT = 8;
  const DEFAULT_GLOBAL_LIMIT = 12;

  function currentAuthorProfile() {
    const backendState = getBackendState();
    const profile = backendState.profile || {};
    return {
      display_name: backendState.user ? getBackendDisplayName(backendState) : "You",
      avatar_style: profile.avatar_style || "bot",
      accent_color: profile.accent_color || "cyan",
      profile_title: profile.profile_title || "Local Player",
    };
  }

  function leaderboardAvatarMarkup(profile = {}) {
    const style = cleanProfileUiChoice(profile.avatar_style, RB_PROFILE_AVATARS, "bot");
    const accent = cleanProfileUiChoice(profile.accent_color, RB_PROFILE_ACCENTS, "cyan");
    return `
      <span class="rb-leaderboard-avatar rb-profile-avatar--${style} rb-profile-avatar--${accent} rb-profile-avatar--image" aria-hidden="true">
        <img src="${escapeHtml(profileAvatarSrc(style))}" alt="" loading="lazy" decoding="async" />
      </span>
    `;
  }

  function rootMode(root) {
    return root.dataset.rbLeaderboardMode || root.dataset.rbLeaderboard || "game";
  }

  function rootLimit(root) {
    const fallback = rootMode(root) === "global" ? DEFAULT_GLOBAL_LIMIT : DEFAULT_GAME_LIMIT;
    return Math.max(1, Math.min(30, Number(root.dataset.rbLeaderboardLimit) || fallback));
  }

  function rootScoreIds(root) {
    if (root.dataset.rbScoreIds) {
      return root.dataset.rbScoreIds.split(",").map((id) => id.trim()).filter(Boolean);
    }
    return scoreIdsForMeta(getGameMeta(root.dataset.rbGameSlug || currentGameSlug()));
  }

  function localRowsForScoreIds(scoreIds, limit) {
    const allowed = new Set(scoreIds);
    const author = currentAuthorProfile();
    return localScoreEntries()
      .filter((entry) => allowed.has(entry.gameId))
      .slice(0, limit)
      .map((entry) => ({
        game_id: entry.gameId,
        score: entry.score,
        updated_at: "",
        author,
        local: true,
      }));
  }

  function localGlobalRows(limit) {
    const author = currentAuthorProfile();
    return localScoreEntries().slice(0, limit).map((entry) => ({
      game_id: entry.gameId,
      score: entry.score,
      updated_at: "",
      author,
      local: true,
    }));
  }

  function leaderboardRowMarkup(row, index, mode) {
    const profile = row.author || {};
    const name = profile.display_name || (row.local ? "You" : "Rainbot Player");
    const gameTitle = titleForScoreId(row.game_id);
    const metaText = mode === "global" ? gameTitle : (row.local ? "Local best" : gameTitle);
    return `
      <article class="rb-leaderboard-row${row.local ? " rb-leaderboard-row--local" : ""}">
        <span class="rb-leaderboard-row__rank">#${index + 1}</span>
        ${leaderboardAvatarMarkup(profile)}
        <span class="rb-leaderboard-row__who">
          <strong>${escapeHtml(name)}</strong>
          <em>${escapeHtml(metaText)}</em>
        </span>
        <span class="rb-leaderboard-row__score">${formatStatNumber(row.score)}</span>
      </article>
    `;
  }

  function renderRows(root, rows, note, emptyText) {
    const rowsRoot = root.querySelector("[data-rb-leaderboard-rows]");
    const noteRoot = root.querySelector("[data-rb-leaderboard-note]");
    const mode = rootMode(root);
    if (!rowsRoot || !noteRoot) return;
    rowsRoot.innerHTML = rows.length
      ? rows.map((row, index) => leaderboardRowMarkup(row, index, mode)).join("")
      : `<div class="rb-leaderboard-empty">${escapeHtml(emptyText || "No scores posted yet.")}</div>`;
    noteRoot.textContent = note || "";
  }

  async function fetchGameRows(scoreIds, limit) {
    if (!window.RBBackend || typeof window.RBBackend.listLeaderboard !== "function") return [];
    const results = await Promise.allSettled(scoreIds.map((scoreId) => window.RBBackend.listLeaderboard(scoreId, limit)));
    return results
      .flatMap((result) => result.status === "fulfilled" ? result.value : [])
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
      .slice(0, limit);
  }

  async function fetchGlobalRows(limit) {
    if (!window.RBBackend) return [];
    if (typeof window.RBBackend.listGlobalLeaderboard === "function") {
      return window.RBBackend.listGlobalLeaderboard(limit);
    }
    const allIds = Object.values(RB_GAME_META).flatMap((meta) => scoreIdsForMeta(meta));
    return fetchGameRows(allIds, limit);
  }

  function renderShell(root) {
    const mode = rootMode(root);
    const meta = getGameMeta(root.dataset.rbGameSlug || currentGameSlug());
    const title = root.dataset.rbGameTitle || meta.title;
    const heading = mode === "global" ? "General Leaderboard" : "Leaderboard";
    const kicker = mode === "global" ? "All games" : title;
    const headingTag = mode === "global" ? "h2" : "h3";
    const scoreIds = rootScoreIds(root);
    const localBest = localRowsForScoreIds(scoreIds, 1)[0];
    root.classList.add("rb-leaderboard");
    if (mode === "global") root.classList.add("rb-leaderboard--global");
    root.innerHTML = `
      <div class="rb-leaderboard__header">
        <div>
          <span class="rb-leaderboard__kicker">${escapeHtml(kicker)}</span>
          <${headingTag} class="rb-leaderboard__title">${escapeHtml(heading)}</${headingTag}>
        </div>
        ${mode === "game" ? `<a class="rb-leaderboard__link" href="${RB_BASE}community.html#leaderboard">Community</a>` : ""}
      </div>
      ${mode === "game" ? `
        <div class="rb-leaderboard__self">
          <span>Your best</span>
          <strong>${localBest ? formatStatNumber(localBest.score) : "0"}</strong>
        </div>
      ` : ""}
      <div class="rb-leaderboard__rows" data-rb-leaderboard-rows>
        <div class="rb-leaderboard-empty">Loading scores...</div>
      </div>
      <div class="rb-leaderboard__note" data-rb-leaderboard-note></div>
    `;
  }

  async function render(root) {
    if (!root) return;
    const token = String(Date.now()) + Math.random().toString(36).slice(2);
    root.dataset.rbLeaderboardToken = token;
    renderShell(root);

    const mode = rootMode(root);
    const limit = rootLimit(root);
    const scoreIds = rootScoreIds(root);
    const localRows = mode === "global" ? localGlobalRows(limit) : localRowsForScoreIds(scoreIds, limit);
    const backendState = getBackendState();

    if (!window.RBBackend || !backendState.configured) {
      renderRows(
        root,
        localRows,
        backendState.configured ? "Cloud leaderboard is loading." : "Cloud leaderboard turns on when Supabase is connected.",
        mode === "global" ? "No local high scores yet." : "No local high score yet."
      );
      return;
    }

    if (!backendState.ready) {
      renderRows(root, localRows, "Connecting to the cloud leaderboard.", localRows.length ? "" : "Cloud scores are loading.");
      return;
    }

    try {
      const cloudRows = mode === "global" ? await fetchGlobalRows(limit) : await fetchGameRows(scoreIds, limit);
      if (root.dataset.rbLeaderboardToken !== token) return;
      renderRows(
        root,
        cloudRows.length ? cloudRows : localRows,
        cloudRows.length ? "Live cloud scores." : "No cloud scores yet. Showing local highs when available.",
        mode === "global" ? "No community scores posted yet." : "No cloud scores posted for this game yet."
      );
    } catch (error) {
      if (root.dataset.rbLeaderboardToken !== token) return;
      console.warn("[Rainbot] Leaderboard load failed", error);
      renderRows(root, localRows, "Leaderboard could not load. Showing local highs.", "No local high score yet.");
    }
  }

  function createStandardGamePanel(meta) {
    const side = document.querySelector(".game-side");
    if (!side || side.querySelector("[data-rb-leaderboard]")) return null;
    const panel = document.createElement("section");
    panel.className = "game-side__panel";
    panel.dataset.rbLeaderboard = "game";
    panel.dataset.rbLeaderboardMode = "game";
    panel.dataset.rbGameSlug = meta.slug;
    panel.dataset.rbGameTitle = meta.title;
    panel.dataset.rbScoreIds = scoreIdsForMeta(meta).join(",");
    const before = side.querySelector("#ad-leaderboard") || side.querySelector(".game-side__howto");
    if (before) side.insertBefore(panel, before);
    else side.append(panel);
    return panel;
  }

  function createStandaloneGamePanel(meta) {
    if (document.querySelector("[data-rb-leaderboard]")) return null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rb-standalone-leaderboard-btn";
    button.textContent = "Scores";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "rb-standalone-leaderboard");

    const panel = document.createElement("section");
    panel.id = "rb-standalone-leaderboard";
    panel.className = "rb-standalone-leaderboard";
    panel.dataset.rbLeaderboard = "game";
    panel.dataset.rbLeaderboardMode = "game";
    panel.dataset.rbGameSlug = meta.slug;
    panel.dataset.rbGameTitle = meta.title;
    panel.dataset.rbScoreIds = scoreIdsForMeta(meta).join(",");
    panel.hidden = true;

    button.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
      if (!panel.hidden) render(panel);
    });

    document.body.append(button, panel);
    return panel;
  }

  function ensureGameLeaderboard() {
    if (!location.pathname.includes("/games/")) return;
    const meta = getGameMeta();
    if (document.querySelector("[data-rb-leaderboard]")) return;
    const panel = createStandardGamePanel(meta);
    if (!panel) createStandaloneGamePanel(meta);
  }

  function roots() {
    return Array.from(document.querySelectorAll("[data-rb-leaderboard]"));
  }

  function renderAll() {
    ensureGameLeaderboard();
    roots().forEach((root) => {
      if (root.hidden) return;
      render(root);
    });
  }

  function init() {
    renderAll();
  }

  return { init, renderAll, render };
})();

window.RBLeaderboards = RBLeaderboards;

const RBComments = (() => {
  const DEFAULT_SORT = "best";
  const SORTS = [
    { value: "best", label: "Best" },
    { value: "new", label: "New" },
    { value: "top", label: "Top" },
  ];

  function cleanCommentContentId(value, fallback = "page") {
    const normalized = String(value || fallback)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9:_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);
    return normalized || fallback;
  }

  function cleanCommentTitle(value, fallback = "Rainbot Thread") {
    return cleanVisibleGameTitle(value || fallback).slice(0, 140) || fallback;
  }

  function formatCommentTime(value) {
    const date = new Date(value || 0);
    if (Number.isNaN(date.getTime())) return "recently";
    const delta = Date.now() - date.getTime();
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (delta < minute) return "just now";
    if (delta < hour) return `${Math.floor(delta / minute)}m ago`;
    if (delta < day) return `${Math.floor(delta / hour)}h ago`;
    if (delta < 7 * day) return `${Math.floor(delta / day)}d ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function profileName(profile = {}) {
    return profile.display_name || "Rainbot Player";
  }

  function commentAvatarMarkup(profile = {}) {
    const style = cleanProfileUiChoice(profile.avatar_style, RB_PROFILE_AVATARS, "bot");
    const accent = cleanProfileUiChoice(profile.accent_color, RB_PROFILE_ACCENTS, "cyan");
    const asset = profileAvatarSrc(style);
    return `
      <span class="rb-comment-avatar rb-profile-avatar--${style} rb-profile-avatar--${accent}" aria-hidden="true">
        <img src="${escapeHtml(asset)}" alt="" loading="lazy" decoding="async" />
      </span>
    `;
  }

  function currentPathSlug() {
    return cleanCommentContentId((location.pathname.split("/").pop() || "page").replace(/\.html$/i, ""));
  }

  function activeVideoContext() {
    const card = document.querySelector(".tv-card[aria-pressed='true']") || document.querySelector(".tv-card");
    const title = cleanCommentTitle(
      card?.dataset.tvTitle ||
      document.querySelector("[data-tv-active-title]")?.textContent ||
      "Rainbot TV"
    );
    return {
      contentType: "video",
      contentId: cleanCommentContentId(card?.dataset.tvTitle || title, "rainbot-tv"),
      pageTitle: title,
      pageUrl: `${location.pathname}${location.search}`,
      kicker: "Rainbot TV",
      mountAfter: document.querySelector(".tv-stage"),
      mountParent: document.querySelector(".content-directory") || document.querySelector("main"),
    };
  }

  function detectContext() {
    const path = location.pathname;
    if (path.includes("/games/") && path.endsWith(".html")) {
      const meta = getGameMeta();
      return {
        contentType: "game",
        contentId: cleanCommentContentId(meta.slug || currentGameSlug(), "game"),
        pageTitle: cleanCommentTitle(meta.title || fallbackGameTitle(), "This Game"),
        pageUrl: `${location.pathname}${location.search}`,
        kicker: "Game thread",
        mountAfter: document.querySelector(".game-layout"),
        mountParent: document.querySelector(".game-page") || document.querySelector("main"),
      };
    }
    if (path.includes("/articles/") && path.endsWith(".html")) {
      const title = cleanCommentTitle(document.querySelector(".slopwire-article h1")?.textContent || document.title, "Slopwire Article");
      return {
        contentType: "article",
        contentId: currentPathSlug(),
        pageTitle: title,
        pageUrl: `${location.pathname}${location.search}`,
        kicker: "Article thread",
        mountAfter: document.querySelector(".related-slat") || document.querySelector(".slopwire-article"),
        mountParent: document.querySelector(".article-shell") || document.querySelector("main"),
      };
    }
    if (path.endsWith("/videos.html") || path.endsWith("/videos/")) return activeVideoContext();
    return null;
  }

  function contextFromRoot(root) {
    return {
      contentType: root.dataset.rbCommentsType,
      contentId: root.dataset.rbCommentsId,
      pageTitle: root.dataset.rbCommentsTitle,
      pageUrl: root.dataset.rbCommentsUrl || `${location.pathname}${location.search}`,
      kicker: root.dataset.rbCommentsKicker || "Thread",
    };
  }

  function updateRootContext(root, context) {
    root.dataset.rbCommentsType = context.contentType;
    root.dataset.rbCommentsId = context.contentId;
    root.dataset.rbCommentsTitle = context.pageTitle;
    root.dataset.rbCommentsUrl = context.pageUrl;
    root.dataset.rbCommentsKicker = context.kicker;
  }

  function ensureRoot(context) {
    if (!context || !context.mountParent) return null;
    let root = document.querySelector("[data-rb-comments]");
    if (!root) {
      root = document.createElement("section");
      root.className = "rb-comments arcade-panel";
      root.dataset.rbComments = "";
      root.dataset.rbCommentsSort = DEFAULT_SORT;
      if (context.mountAfter && context.mountAfter.parentElement === context.mountParent) {
        context.mountAfter.insertAdjacentElement("afterend", root);
      } else {
        context.mountParent.append(root);
      }
      bindRoot(root);
    }
    updateRootContext(root, context);
    return root;
  }

  function sortLabel(sort) {
    return (SORTS.find((item) => item.value === sort) || SORTS[0]).label;
  }

  function renderFrame(root, status = "Loading comments...") {
    const context = contextFromRoot(root);
    const sort = root.dataset.rbCommentsSort || DEFAULT_SORT;
    root.innerHTML = `
      <header class="rb-comments__header">
        <div>
          <span class="rb-comments__kicker">${escapeHtml(context.kicker)}</span>
          <h2>Comments</h2>
          <p>${escapeHtml(context.pageTitle)}</p>
        </div>
        <div class="rb-comments__sort" role="tablist" aria-label="Comment sort">
          ${SORTS.map((item) => `
            <button type="button" class="${item.value === sort ? "is-active" : ""}" data-rb-comment-sort="${item.value}" aria-selected="${item.value === sort ? "true" : "false"}">
              ${escapeHtml(item.label)}
            </button>
          `).join("")}
        </div>
      </header>
      <div class="rb-comments__status" data-rb-comments-status>${escapeHtml(status)}</div>
      <div class="rb-comments__composer" data-rb-comments-composer></div>
      <div class="rb-comments__list" data-rb-comments-list></div>
    `;
  }

  function renderPrompt(root, message, actionLabel = "") {
    const composer = root.querySelector("[data-rb-comments-composer]");
    if (!composer) return;
    composer.innerHTML = `
      <div class="rb-comments__prompt">
        <span>${escapeHtml(message)}</span>
        ${actionLabel ? `<button class="btn btn--secondary" type="button" data-rb-comment-login>${escapeHtml(actionLabel)}</button>` : ""}
      </div>
    `;
  }

  function renderComposer(root) {
    const composer = root.querySelector("[data-rb-comments-composer]");
    if (!composer) return;
    composer.innerHTML = `
      <form class="rb-comment-form" data-rb-comment-form>
        <label class="sr-only" for="rb-comment-body">Add a comment</label>
        <textarea id="rb-comment-body" name="body" rows="3" maxlength="6000" placeholder="Add a public comment"></textarea>
        <div class="rb-comment-form__actions">
          <span data-rb-comment-form-status></span>
          <button class="btn btn--primary" type="submit">Comment</button>
        </div>
      </form>
    `;
  }

  function sortedRows(rows, sort, child = false) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    if (child) {
      return list.sort((a, b) => Date.parse(a.created_at || "") - Date.parse(b.created_at || ""));
    }
    if (sort === "new") {
      return list.sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || "") || Number(b.id) - Number(a.id));
    }
    if (sort === "top") {
      return list.sort((a, b) => (Number(b.vote_score) || 0) - (Number(a.vote_score) || 0) || Date.parse(b.created_at || "") - Date.parse(a.created_at || ""));
    }
    return list.sort((a, b) => (Number(b.vote_score) || 0) - (Number(a.vote_score) || 0) || (Number(b.reply_count) || 0) - (Number(a.reply_count) || 0) || Date.parse(b.created_at || "") - Date.parse(a.created_at || ""));
  }

  function buildTree(rows, sort) {
    const byId = new Map();
    const roots = [];
    rows.forEach((row) => byId.set(Number(row.id), { ...row, children: [] }));
    byId.forEach((row) => {
      const parentId = Number(row.parent_id) || 0;
      if (parentId && byId.has(parentId)) byId.get(parentId).children.push(row);
      else roots.push(row);
    });
    byId.forEach((row) => {
      row.children = sortedRows(row.children, sort, true);
    });
    return sortedRows(roots, sort, false);
  }

  function commentMarkup(comment, depth = 0) {
    const profile = comment.author || {};
    const score = Number(comment.vote_score) || 0;
    const userVote = Number(comment.user_vote) || 0;
    const title = profile.profile_title ? `<span>${escapeHtml(profile.profile_title)}</span>` : "";
    const children = comment.children && comment.children.length
      ? `<div class="rb-comment__children">${comment.children.map((child) => commentMarkup(child, depth + 1)).join("")}</div>`
      : "";
    return `
      <article class="rb-comment" id="comment-${Number(comment.id)}" data-rb-comment-id="${Number(comment.id)}" data-rb-comment-user-vote="${userVote}" style="--comment-depth:${Math.min(depth, 4)}">
        <div class="rb-comment__vote" aria-label="Comment voting">
          <button type="button" class="${userVote === 1 ? "is-active" : ""}" data-rb-comment-vote="1" aria-label="Upvote">▲</button>
          <strong>${formatStatNumber(score)}</strong>
          <button type="button" class="${userVote === -1 ? "is-active" : ""}" data-rb-comment-vote="-1" aria-label="Downvote">▼</button>
        </div>
        <div class="rb-comment__main">
          <div class="rb-comment__meta">
            ${commentAvatarMarkup(profile)}
            <strong>${escapeHtml(profileName(profile))}</strong>
            ${title}
            <span>${escapeHtml(formatCommentTime(comment.created_at))}</span>
          </div>
          <div class="rb-comment__body">${escapeHtml(comment.body)}</div>
          <div class="rb-comment__actions">
            <button type="button" data-rb-comment-reply>Reply</button>
            <a href="${escapeHtml(location.pathname + location.search)}#comment-${Number(comment.id)}">Share</a>
          </div>
          <form class="rb-comment-form rb-comment-form--reply" data-rb-comment-form data-rb-comment-parent-id="${Number(comment.id)}" hidden>
            <label class="sr-only">Reply</label>
            <textarea name="body" rows="3" maxlength="6000" placeholder="Write a reply"></textarea>
            <div class="rb-comment-form__actions">
              <span data-rb-comment-form-status></span>
              <button class="btn btn--secondary" type="button" data-rb-comment-cancel>Cancel</button>
              <button class="btn btn--primary" type="submit">Reply</button>
            </div>
          </form>
          ${children}
        </div>
      </article>
    `;
  }

  function renderList(root, rows) {
    const list = root.querySelector("[data-rb-comments-list]");
    if (!list) return;
    if (!rows.length) {
      list.innerHTML = `<div class="rb-comments__empty">No comments yet. Start the thread.</div>`;
      return;
    }
    const tree = buildTree(rows, root.dataset.rbCommentsSort || DEFAULT_SORT);
    list.innerHTML = tree.map((comment) => commentMarkup(comment)).join("");
  }

  function friendlyCommentError(error) {
    const message = String(error && error.message ? error.message : error || "");
    if (/content_comments|content_comment_votes|schema cache|relation .* does not exist/i.test(message)) {
      return "Comments need the latest Supabase migration before posting goes live.";
    }
    return message || "Comments could not load.";
  }

  async function render(root) {
    if (!root) return;
    const context = contextFromRoot(root);
    const backendState = getBackendState();
    renderFrame(root);
    const status = root.querySelector("[data-rb-comments-status]");
    if (!window.RBBackend || !backendState.configured) {
      if (status) status.textContent = "Comments are ready once Supabase is connected.";
      renderPrompt(root, "Connect Supabase and run the content comments migration to enable posting.");
      renderList(root, []);
      return;
    }
    if (!backendState.ready) {
      if (status) status.textContent = "Connecting to comments...";
      renderPrompt(root, "Loading account state.");
      renderList(root, []);
      return;
    }
    if (!backendState.user) renderPrompt(root, "Sign in to comment or vote. Reading stays public.", "Sign In");
    else renderComposer(root);

    try {
      const rows = await window.RBBackend.listContentComments({
        contentType: context.contentType,
        contentId: context.contentId,
        sort: root.dataset.rbCommentsSort || DEFAULT_SORT,
      });
      if (status) status.textContent = rows.length ? `${formatStatNumber(rows.length)} comments · sorted by ${sortLabel(root.dataset.rbCommentsSort || DEFAULT_SORT)}` : "No comments yet.";
      renderList(root, rows);
    } catch (error) {
      if (status) {
        status.textContent = friendlyCommentError(error);
        status.dataset.kind = "bad";
      }
      renderList(root, []);
    }
  }

  async function submitComment(root, form) {
    const context = contextFromRoot(root);
    const textarea = form.querySelector("textarea[name='body']");
    const status = form.querySelector("[data-rb-comment-form-status]");
    const button = form.querySelector("button[type='submit']");
    const body = textarea ? textarea.value : "";
    if (button) button.disabled = true;
    if (status) status.textContent = "Posting...";
    try {
      await window.RBBackend.createContentComment({
        ...context,
        body,
        parentId: form.dataset.rbCommentParentId || "",
      });
      if (textarea) textarea.value = "";
      if (form.dataset.rbCommentParentId) form.hidden = true;
      await render(root);
    } catch (error) {
      if (status) status.textContent = error.message || "Comment failed.";
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function vote(root, comment, requestedVote) {
    const backendState = getBackendState();
    if (!backendState.user) {
      openAuthModal();
      return;
    }
    const currentVote = Number(comment.dataset.rbCommentUserVote) || 0;
    const nextVote = currentVote === requestedVote ? 0 : requestedVote;
    try {
      await window.RBBackend.voteContentComment(Number(comment.dataset.rbCommentId), nextVote);
      await render(root);
    } catch (error) {
      RB.toast(error.message || "Vote failed", "bad");
    }
  }

  function bindRoot(root) {
    if (!root || root.dataset.rbCommentsBound === "true") return;
    root.dataset.rbCommentsBound = "true";
    root.addEventListener("click", (event) => {
      const sortButton = event.target.closest("[data-rb-comment-sort]");
      if (sortButton && root.contains(sortButton)) {
        root.dataset.rbCommentsSort = sortButton.dataset.rbCommentSort || DEFAULT_SORT;
        render(root);
        return;
      }
      const loginButton = event.target.closest("[data-rb-comment-login]");
      if (loginButton && root.contains(loginButton)) {
        openAuthModal();
        return;
      }
      const replyButton = event.target.closest("[data-rb-comment-reply]");
      if (replyButton && root.contains(replyButton)) {
        const card = replyButton.closest(".rb-comment");
        const form = card && card.querySelector(":scope > .rb-comment__main > .rb-comment-form--reply");
        if (form) {
          form.hidden = !form.hidden;
          if (!form.hidden) form.querySelector("textarea")?.focus();
        }
        return;
      }
      const cancelButton = event.target.closest("[data-rb-comment-cancel]");
      if (cancelButton && root.contains(cancelButton)) {
        const form = cancelButton.closest("[data-rb-comment-form]");
        if (form) form.hidden = true;
        return;
      }
      const voteButton = event.target.closest("[data-rb-comment-vote]");
      if (voteButton && root.contains(voteButton)) {
        const comment = voteButton.closest(".rb-comment");
        if (comment) vote(root, comment, Number(voteButton.dataset.rbCommentVote));
      }
    });
    root.addEventListener("submit", (event) => {
      const form = event.target.closest("[data-rb-comment-form]");
      if (!form || !root.contains(form)) return;
      event.preventDefault();
      submitComment(root, form);
    });
  }

  function refreshVideoContext(root) {
    const context = activeVideoContext();
    if (!context || !root) return;
    updateRootContext(root, context);
    render(root);
  }

  function initVideoBindings(root) {
    if (!root || root.dataset.rbVideoCommentsBound === "true") return;
    root.dataset.rbVideoCommentsBound = "true";
    document.querySelectorAll(".tv-card").forEach((card) => {
      card.addEventListener("click", () => {
        window.setTimeout(() => refreshVideoContext(root), 0);
      });
    });
  }

  function init() {
    const context = detectContext();
    if (!context) return;
    const root = ensureRoot(context);
    if (!root) return;
    if (context.contentType === "video") initVideoBindings(root);
    render(root);
  }

  function renderAll() {
    document.querySelectorAll("[data-rb-comments]").forEach((root) => render(root));
  }

  return { init, renderAll, render };
})();

window.RBComments = RBComments;

let lastCloudSyncUserId = "";

function handleBackendAuthChange(event) {
  const backendState = event.detail || getBackendState();
  renderNav(RB.state);
  renderHomeRecentPanel();
  renderHomeProgressPanel();
  renderHomeCommunityPanel();
  RBLeaderboards.renderAll();
  RBComments.renderAll();
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
        if (ok && typeof RB !== "undefined" && typeof RB.recordGameSave === "function") RB.recordGameSave(gameId);
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
  initHomeRecentPanel();
  initHomeProgressPanel();
  initHomeCommunityPanel();
  RBLeaderboards.init();
  RBComments.init();
  RB.subscribe((state) => {
    renderNav(state);
    renderHomeRecentPanel();
    renderHomeProgressPanel();
    renderHomeCommunityPanel();
    RBLeaderboards.renderAll();
    RBComments.renderAll();
    const profileModal = document.getElementById("rb-profile-modal");
    if (profileModal) refreshProfileGamerStats(profileModal);
  });
  window.addEventListener("rainbot:authchange", handleBackendAuthChange);
  initRainbotBackend();
  scheduleGameCanvasFit();
});

window.addEventListener("load", scheduleGameCanvasFit);
window.addEventListener("resize", scheduleGameCanvasFit);
