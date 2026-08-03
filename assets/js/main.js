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
  "big-baby-bum": { title: "Big Baby Bum", scoreIds: ["big-baby-bum"] },
  "billionaire-space-race": { title: "Billionaire Space Race", scoreIds: ["bsr"] },
  "boomer-monopoly": { title: "Boomer Monopoly", scoreIds: ["boomer_monopoly"] },
  "brainrot-2048": { title: "Brainrot 2048", scoreIds: ["brainrot2048"] },
  "consensus-collapse": { title: "Consensus Collapse", scoreIds: ["consensus-collapse"] },
  "crescendo": { title: "Crescendo", scoreIds: ["crescendo"] },
  "debt-breakout": { title: "Debt Breakout", scoreIds: ["debt-breakout"] },
  "echo-loop": { title: "Echo Loop", scoreIds: ["echo-loop"] },
  "echo-loop-3d": { title: "Echo Loop 3D", scoreIds: ["echo-loop-3d"] },
  "incident-commander": { title: "Incident Commander", scoreIds: ["incident-commander"] },
  "dont-become-pizza": { title: "Don't Become Pizza", scoreIds: ["dont-become-pizza"] },
  "dont-fck-with-cats": { title: "Don't F*ck with Cats", scoreIds: ["dont-fck-with-cats"] },
  "dont-look-gym-girl": { title: "Don't Look at the Gym Girl", scoreIds: ["dont-look-gym-girl"] },
  "doorcrash-no-tip-nitro": { title: "DoorCrash: No Tip Nitro", scoreIds: ["doorcrash"] },
  "drone-hunter": { title: "Drone Hunter", scoreIds: ["dronehunter"] },
  "inkblood": { title: "Inkblood", scoreIds: ["inkblood"] },
  "escape-poop-cruise": { title: "Escape the Poop Cruise", scoreIds: ["escape-poop-cruise"] },
  "flappy-stonks": { title: "Flappy Stonks", scoreIds: ["flappy-stonks"] },
  "gen-z-driving-simulator": { title: "Gen Z Driving Simulator", scoreIds: ["gen-z-driving-simulator"] },
  "karen-merger": { title: "Complaint Chain", scoreIds: ["karen-merger"] },
  "looksmaxxing-grindset": { title: "Looksmaxxing Grindset", scoreIds: ["looksmax"] },
  "mr-feast-mansion": { title: "Mr Feast: Last to Leave", scoreIds: ["mr-feast-mansion"] },
  "recursive-reward-labyrinth": { title: "Recursive Reward Labyrinth", scoreIds: ["recursive-reward-labyrinth"] },
  "rizz-craft": { title: "Rizz-Craft", scoreIds: ["rizz-craft"] },
  "scrap-circuit": { title: "Scrap Circuit: Last Chassis Standing", scoreIds: ["scrap-circuit", "scrap-circuit-full"] },
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
  "the-optimizer": { title: "The Optimizer", scoreIds: ["the-optimizer"] },
  "the-weight": { title: "The Weight", scoreIds: ["the-weight"] },
  "to-the-moon": { title: "To The Moon", scoreIds: ["to-the-moon"] },
  "unhoused-and-unhinged": { title: "Unhoused and Unhinged", scoreIds: ["unhoused-and-unhinged"] },
};

const RB_SCORE_TITLE_OVERRIDES = {
  "scrap-circuit": "Scrap Circuit: Single Match",
  "scrap-circuit-full": "Scrap Circuit: Full Circuit",
  skibidi_toilet_tower_defense_bathroom: "Skibidi TD: Bathroom",
  skibidi_toilet_tower_defense_sewer: "Skibidi TD: Sewer",
  skibidi_toilet_tower_defense_rooftop: "Skibidi TD: Rooftop",
};

const RB_GAME_VISUALS = {
  "again": { image: "assets/img/mockup/card-again.jpg?v=20260712-jpg", kind: "Horror" },
  "ai-slop-factory": { image: "assets/img/mockup/card-ai-slop-factory.jpg?v=20260712-jpg", kind: "Arcade" },
  "apop-demon-hunters": { image: "assets/img/mockup/card-apop-moggers-v3.jpg?v=20260712-jpg", kind: "Side-scroller" },
  "big-baby-bum": { image: "assets/img/mockup/card-big-baby-bum-ai-v4.jpg?v=20260712-jpg", kind: "3D Katamari", alt: "Big Baby Bum cover art — a realistic cartoon diapered baby rolls through a sunny neighborhood while broccoli flees" },
  "billionaire-space-race": { image: "assets/img/mockup/card-billionaire-space-race.jpg?v=20260712-jpg", kind: "Lander" },
  "boomer-monopoly": { image: "assets/img/mockup/card-boomer-monopoly.jpg?v=20260712-jpg", kind: "Board" },
  "brainrot-2048": { image: "assets/img/mockup/card-brainrot-2048.jpg?v=20260712-jpg", kind: "Puzzle" },
  "consensus-collapse": { image: "assets/img/agent-games/consensus-collapse.jpg?v=20260712-jpg", kind: "Agent Treaty" },
  "crescendo": { image: "assets/img/crescendo/card-crescendo-ai-v1.jpg?v=20260712-jpg", kind: "Rhythm Shmup", alt: "Crescendo cover art with a white musical-note spaceship flying through pink beat projectiles beneath The Conductor" },
  "debt-breakout": { image: "assets/img/mockup/card-debt-breakout.jpg?v=20260712-jpg", kind: "Brick Buster" },
  "echo-loop": { image: "assets/img/echo-loop/card-echo-loop-ai-v1.jpg?v=20260712-jpg", kind: "Time Puzzler", alt: "Echo Loop cover art with a hot-pink runner crossing translucent cyan echoes toward a golden portal" },
  "echo-loop-3d": { image: "assets/img/echo-loop-3d/card-echo-loop-3d-ai-v1.jpg?v=20260712-jpg", kind: "FPS Puzzler", alt: "Echo Loop 3D cover art showing a first-person neon corridor filled with cyan echoes and a golden portal" },
  "incident-commander": { image: "assets/img/agent-games/incident-commander-cover.jpg?v=20260712-jpg", kind: "Agent Ops" },
  "dont-become-pizza": { image: "assets/img/mockup/card-dont-become-pizza.jpg?v=20260712-jpg", kind: "Horror" },
  "dont-fck-with-cats": { image: "assets/img/mockup/card-dont-fck-with-cats.jpg?v=20260712-jpg", kind: "Runner" },
  "dont-look-gym-girl": { image: "assets/img/mockup/card-gym-girl.jpg?v=20260712-jpg", kind: "Stealth" },
  "doorcrash-no-tip-nitro": { image: "assets/img/mockup/card-doorcrash-no-tip-nitro.jpg?v=20260712-jpg", kind: "3D Runner" },
  "drone-hunter": { image: "assets/img/mockup/card-drone-hunter.jpg?v=20260712-jpg", kind: "Shooter" },
  "inkblood": {
    image: "assets/img/inkblood/card-inkblood-ai.jpg?v=20260802-ai-1",
    kind: "Horde Survivor",
    alt: "Inkblood cover art: a lone manga swordsman faces a yokai horde beneath a colossal skeleton and crimson ink slashes",
  },
  "escape-poop-cruise": { image: "assets/img/mockup/card-escape-poop-cruise-v2.jpg?v=20260712-jpg", kind: "Horror FPS" },
  "flappy-stonks": { image: "assets/img/mockup/card-flappy-stonks-funny.jpg?v=20260712-jpg", kind: "Arcade" },
  "gen-z-driving-simulator": { image: "assets/img/mockup/card-gen-z-driving-simulator.jpg?v=20260712-jpg", kind: "3D Driving" },
  "karen-merger": { image: "assets/img/mockup/card-karen-merger.jpg?v=20260712-jpg", kind: "Bubble Merge" },
  "looksmaxxing-grindset": { image: "assets/img/mockup/card-looksmaxxing.png?v=20260611-7", kind: "Sim / Idle" },
  "mr-feast-mansion": {
    image: "assets/img/mr-feast/card-mr-feast-last-to-leave-ai-v1.jpg?v=20260723-2",
    kind: "Stealth Horror",
    alt: "Mr Feast: Last to Leave cover art with the uncanny host, surveillance cameras, and a stormy mansion",
  },
  "recursive-reward-labyrinth": { image: "assets/img/agent-games/recursive-reward-labyrinth.jpg?v=20260712-jpg", kind: "Agent Protocol" },
  "rizz-craft": { image: "assets/img/mockup/card-rizz-craft.jpg?v=20260712-jpg", kind: "Sandbox" },
  "scrap-circuit": { image: "assets/img/scrap-circuit/card-scrap-circuit.png?v=20260703-scrap-cover-1", kind: "Retro Car Combat" },
  "skibidi-toilet-tower-defense": { image: "assets/img/mockup/card-skibidi-toilet-tower-defense.jpg?v=20260712-jpg", kind: "Defense" },
  "smooth-brain-snacker": { image: "assets/img/mockup/card-smooth-brain-snacker.jpg?v=20260712-jpg", kind: "Arcade" },
  "storm-area-51": { image: "assets/img/storm-area-51/card-storm-area-51.jpg?v=20260712-jpg", kind: "Crowd Heist" },
  "strait-of-hormuz": { image: "assets/img/mockup/card-escape-straight-wide.png?v=20260611-7", kind: "Action" },
  "super-slop-brothers": { image: "assets/img/mockup/card-super-slop-brothers.jpg?v=20260712-jpg", kind: "Fighter" },
  "tardigrade-micro-mayhem": { image: "assets/img/mockup/card-tardigrade-micro-mayhem.jpg?v=20260712-jpg", kind: "3D Sandbox" },
  "the-last-signal": { image: "assets/img/the-last-signal/poster-ai-v4-title.jpg?v=20260712-jpg", kind: "RTS" },
  "the-optimizer": { image: "assets/img/the-optimizer/card-the-optimizer-ai-v1.jpg?v=20260712-jpg", kind: "Idle Sim", alt: "The Optimizer cover art with a mint terminal and fabricator watched by a giant pink machine eye" },
  "the-weight": { image: "assets/img/mockup/card-the-weight-wide-v2.jpg?v=20260712-jpg", kind: "Horror" },
  "to-the-moon": { image: "assets/img/to-the-moon/card-to-the-moon-hq.jpg?v=20260712-jpg", kind: "Survival" },
  "unhoused-and-unhinged": { image: "assets/img/mockup/card-unhoused-and-unhinged.jpg?v=20260712-jpg", kind: "3D Sandbox" },
};

const RB_SLOPWIRE_ARTICLES = [
  { href: "articles/smart-toaster-giving-life-advice.html", label: "Smart Toaster Starts Giving Life Advice After Firmware Update", search: "Smart Toaster Starts Giving Life Advice After Firmware Update fake news satire slopwire toaster breakfast firmware therapy" },
  { href: "articles/group-chat-declares-state-of-emergency.html", label: "Group Chat Declares State Of Emergency After Someone Replies \"K\"", search: "Group Chat Declares State Of Emergency After Someone Replies K fake news satire slopwire texting friends social panic" },
  { href: "articles/couch-holding-remote-hostage.html", label: "Couch Confirms It Has Been Holding Remote Hostage Since March", search: "Couch Confirms It Has Been Holding Remote Hostage Since March fake news satire slopwire living room tv remote" },
  { href: "articles/fitness-tracker-existential-steps.html", label: "Fitness Tracker Congratulates Man For 10,000 Existential Steps", search: "Fitness Tracker Congratulates Man For 10000 Existential Steps fake news satire slopwire wellness watch pacing" },
  { href: "articles/city-pothole-becomes-historic-landmark.html", label: "City Pothole Becomes Historic Landmark After Surviving Three Mayors", search: "City Pothole Becomes Historic Landmark After Surviving Three Mayors fake news satire slopwire local government street pothole" },
  { href: "articles/local-man-shadowbanned-by-own-fridge.html", label: "Local Man Announces He Has Been Shadowbanned By Own Refrigerator", search: "Local Man Announces He Has Been Shadowbanned By Own Refrigerator fake news satire slopwire fridge algorithm leftovers" },
  { href: "articles/study-finds-brain-entered-airplane-mode.html", label: "Study Finds Man's Brain Entered Airplane Mode During Staff Meeting", search: "Study Finds Man's Brain Entered Airplane Mode During Staff Meeting fake news satire slopwire office productivity" },
  { href: "articles/family-printer-saw-god.html", label: "Family Printer Claims It Saw God During Paper Jam", search: "Family Printer Claims It Saw God During Paper Jam fake news satire slopwire printer tech support" },
  { href: "articles/toddlers-open-labor-negotiations.html", label: "Toddlers Open Labor Negotiations After Parents Offer Blueberries", search: "Toddlers Open Labor Negotiations After Parents Offer Blueberries fake news satire slopwire family snacks" },
];

const RB_GAME_SEARCH_TEXT = {
  "debt-breakout": "Debt Breakout breakout arkanoid parody bills rent subscription copay medical student loan crypto loss utilities buy now pay later BNPL zombie sub annual renewal refund inflation interest paddle paycheck payment coin brick buster satire personal finance debt statement",
  "scrap-circuit": "Scrap Circuit Last Chassis Standing PS1 retro 3D arena vehicular combat demolition derby cars ice cream truck monster truck hearse school bus tow truck garbage truck weapons pickups specials insurance adjuster low poly fog dither online multiplayer room codes online derby",
  "to-the-moon": "To The Moon crypto mining tower defense memecoin doge shib pepe bonk bull bear market virus rocket moon motherload dig survive blockchain hodl wagmi diamond hands black swan",
  "the-last-signal": "The Last Signal RTS real time strategy skirmish humans robots aliens factions base building workers harvest matter energy signal serious sci-fi lore buried signal hollow online multiplayer online skirmish room codes",
  "escape-poop-cruise": "Escape the Poop Cruise low poly 3D horror FPS Roe Jogan cruise crud infected passengers cure dart shotgun lifeboat procedural",
  "flappy-stonks": "Flappy Stonks stock market flappy bird parody candlestick chart trail dividends stop loss shield arcade runner",
  "incident-commander": "Incident Commander agent games ai benchmark incident response security operations logs hosts services root cause protocol observation action DSL",
  "consensus-collapse": "Consensus Collapse agent games ai benchmark treaty negotiation council matrix hidden preferences quorum protocol observation action DSL",
  "recursive-reward-labyrinth": "Recursive Reward Labyrinth agent games ai benchmark json protocol graph planning reward vector command language observation action DSL",
  "drone-hunter": "Drone Hunter duck hunt parody light gun shooting gallery crosshair shoot drones delivery surveillance camera ad-drone peace dove robo dog quota arcade",
  "inkblood": "Inkblood 血墨 manga horde survivor vampire survivors like black and white ink screentone yokai night parade hundred demons katana greatsword gaki oni gashadokuro nurarihyon blood crimson bullet heaven roguelite",
  "storm-area-51": "Storm Area 51 RSVP Raid alien rescue crowd heist top down stealth tactics searchlights hype alert raider squads fictional sci fi base",
  "dont-become-pizza": "Don't Become Pizza horror private island pizza conspiracy stealth masked elites oven after dark",
  "super-slop-brothers": "Super Slop Brothers platform fighter smash bros parody online multiplayer local multiplayer cpu ai slop rainbot gigachad mr feast skibidi sigma percent knockback stocks blast zone hazards online brawl room codes",
  "dont-fck-with-cats": "Don't F*ck with Cats cat swarm runner levels gates multiplier laser pointer hairball roomba cucumber vacuum arcade",
  "ai-slop-factory": "AI Slop Factory content moderation conveyor arcade boost demonetize fact check delete milk engagement ai thumbnails ragebait bots misinformation deepfake crypto scams",
  "karen-merger": "Complaint Chain bubble drop physics manager ascension complaints coupons retail kaiju",
  "gen-z-driving-simulator": "Gen Z Driving Simulator driving phone road curves steering vibe check distracted driver",
  "again": "Again horror hallway after dark",
  "the-weight": "The Weight sleep paralysis horror after dark entity bedroom 3am wake body",
  "smooth-brain-snacker": "Smooth Brain Snacker snake parody brain worm eat smart ideas poop brainrot skibidi rizz gyatt sigma grow tail arcade",
  "brainrot-2048": "Brainrot 2048 merge puzzle sliding tiles npc skibidi rizz sigma gyatt ohio gigachad galaxy brain",
  "unhoused-and-unhinged": "Unhoused and Unhinged low poly 3D sandbox street antics cop chase Tweeker Zombies plunger survival",
  "billionaire-space-race": "Billionaire Space Race rocket launch land lunar lander parody musk bezos platform dodge satellites drones",
  "rizz-craft": "Rizz-Craft voxel mining sandbox parody blocks craft survive ohio sigma rizz online multiplayer co-op coop room codes",
  "tardigrade-micro-mayhem": "Tardigrade Micro Mayhem 3D sandbox low poly microscopic tardigrade",
  "doorcrash-no-tip-nitro": "DoorCrash No Tip Nitro 3D delivery runner food car obstacles",
  "strait-of-hormuz": "Escape the Straight action tanker mines drones",
  "mr-feast-mansion": "Mr Feast Last to Leave reality show competition stealth horror mansion investigation sabotage cameras",
  "looksmaxxing-grindset": "Looksmaxxing Grindset idle sim gym mewing water",
  "boomer-monopoly": "Boomer Monopoly housing board game parody",
  "apop-demon-hunters": "Apop Demon Moggers side-scroller platformer pop action boyz ii hell",
  "skibidi-toilet-tower-defense": "Skibidi Toilet Tower Defense toilets towers camera speaker plunger",
  "dont-look-gym-girl": "Don't Look at the Gym Girl stealth awkward parody",
};

const RB_SEARCH_SECTIONS = [
  { href: "search.html", label: "Search Rainbot", search: "search find games articles clips pages slopwire vault directory", type: "page" },
  { href: "games.html", label: "Games Vault", search: "games arcade browser free play vault catalog multiplayer agent after dark", type: "page" },
  { href: "articles.html", label: "The Slopwire", search: "slopwire fake news satire headlines articles feed", type: "page" },
  { href: "videos.html", label: "Slopwire Clips", search: "slopwire clips video parody reels short form", type: "video" },
  { href: "videos.html#featured", label: "Area 51 Raid: Clap Alien Cheeks", search: "Area 51 Raid Clap Alien Cheeks slopwire clip funny video aliens found footage", type: "video" },
  { href: "community.html", label: "Community Forum", search: "community forum topics discussion leaderboard scores", type: "page" },
  { href: "after-dark.html", label: "After Dark", search: "after dark horror games vault sleep paralysis", type: "page" },
  { href: "agent-games.html", label: "Agent Games", search: "agent games ai benchmark protocol dsl observation action", type: "page" },
];

const RB_SEARCH_TYPE_FILTERS = [
  { key: "all", label: "All" },
  { key: "game", label: "Games" },
  { key: "article", label: "Articles" },
  { key: "video", label: "Clips" },
  { key: "page", label: "Pages" },
];

let rbSearchIndexCache = null;
let rbSearchDocBound = false;

function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function gameSearchLabel(slug, searchText) {
  const meta = RB_GAME_META[slug];
  if (meta && meta.title) return meta.title;
  return searchText.split(/\s+(?:PS1|RTS|FPS|low poly|horror|agent|3D|idle|online)/i)[0].trim();
}

function getSearchIndex() {
  if (rbSearchIndexCache) return rbSearchIndexCache;
  const items = [];
  Object.entries(RB_GAME_SEARCH_TEXT).forEach(([slug, search]) => {
    const visuals = RB_GAME_VISUALS[slug];
    items.push({
      href: `games/${slug}.html`,
      label: gameSearchLabel(slug, search),
      search: normalizeSearchText(search),
      type: "game",
      kind: visuals?.kind || "Game",
    });
  });
  RB_SLOPWIRE_ARTICLES.forEach((article) => {
    items.push({
      href: article.href,
      label: article.label,
      search: normalizeSearchText(article.search),
      type: "article",
    });
  });
  RB_SEARCH_SECTIONS.forEach((section) => {
    items.push({
      href: section.href,
      label: section.label,
      search: normalizeSearchText(section.search),
      type: section.type,
    });
  });
  rbSearchIndexCache = items;
  return items;
}

function searchTypeLabel(type) {
  if (type === "game") return "Game";
  if (type === "article") return "Article";
  if (type === "video") return "Clip";
  return "Page";
}

function scoreSearchItem(item, query, tokens) {
  const label = normalizeSearchText(item.label);
  let score = 0;
  if (label === query) score += 120;
  else if (label.startsWith(query)) score += 90;
  else if (label.includes(query)) score += 70;
  if (item.search === query) score += 60;
  else if (item.search.startsWith(query)) score += 45;
  else if (item.search.includes(query)) score += 30;
  const tokenHits = tokens.filter((token) => label.includes(token) || item.search.includes(token)).length;
  if (tokenHits === tokens.length) score += 35 + tokenHits * 6;
  else if (tokenHits > 0) score += tokenHits * 12;
  return score;
}

function isSearchPageRoute() {
  const path = location.pathname;
  return path.endsWith("/search.html") || path.endsWith("/search");
}

function searchSite(query, options = {}) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  const tokens = normalized.split(" ").filter(Boolean);
  const type = options.type || "all";
  const sort = options.sort || "relevance";
  const limit = Number.isFinite(options.limit) ? options.limit : Infinity;
  const ranked = getSearchIndex()
    .map((item) => ({ item, score: scoreSearchItem(item, normalized, tokens) }))
    .filter((entry) => entry.score > 0)
    .filter((entry) => type === "all" || entry.item.type === type)
    .sort((a, b) => {
      if (sort === "az") return a.item.label.localeCompare(b.item.label);
      return b.score - a.score || a.item.label.localeCompare(b.item.label);
    });
  const sliced = limit === Infinity ? ranked : ranked.slice(0, limit);
  return sliced.map((entry) => ({ ...entry.item, score: entry.score }));
}

function querySearchIndex(query, limit = 8) {
  return searchSite(query, { limit });
}

function buildSearchSnippet(item, query) {
  const text = item.search || normalizeSearchText(item.label);
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  const token = tokens.find((part) => text.includes(part)) || "";
  if (!token) return "";
  const index = text.indexOf(token);
  const start = Math.max(0, index - 42);
  const end = Math.min(text.length, index + token.length + 72);
  let snippet = text.slice(start, end).trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  return snippet;
}

function highlightSearchSnippet(snippet, query) {
  const safe = escapeHtml(snippet);
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean).sort((a, b) => b.length - a.length);
  if (!tokens.length) return safe;
  const pattern = new RegExp(`(${tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return safe.replace(pattern, "<mark>$1</mark>");
}

function buildSearchPageUrl(query, options = {}) {
  const url = new URL(`${RB_BASE}search.html`, location.href);
  const normalized = String(query || "").trim();
  if (normalized) url.searchParams.set("q", normalized);
  else url.searchParams.delete("q");
  if (options.type && options.type !== "all") url.searchParams.set("type", options.type);
  else url.searchParams.delete("type");
  if (options.sort && options.sort !== "relevance") url.searchParams.set("sort", options.sort);
  else url.searchParams.delete("sort");
  return `${url.pathname}${url.search}`;
}

function resolveSearchHref(href) {
  if (/^https?:\/\//i.test(href)) return href;
  return `${RB_BASE}${href.replace(/^\.\//, "")}`;
}

function navigateToSearchPage(query, options = {}) {
  location.href = buildSearchPageUrl(query, options);
}

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
  { contentType: "video", contentId: "area-51-raid-clap-alien-cheeks", title: "Area 51 Raid", href: "videos.html#featured", kicker: "The Slopwire" },
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

function isOfficialBotProfile(profile = {}) {
  return Boolean(profile && profile.is_bot);
}

function profileBotLabel(profile = {}) {
  return String(profile.bot_label || "Official Bot").trim().slice(0, 40) || "Official Bot";
}

function profileBotBadgeMarkup(profile = {}) {
  if (!isOfficialBotProfile(profile)) return "";
  return `<span class="rb-bot-badge" title="Official Rainbot Network bot">${escapeHtml(profileBotLabel(profile))}</span>`;
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
  const path = location.pathname;
  const isHome = path.endsWith("/") || path.endsWith("/index.html") || path === "";
  const isSlopwire = path.endsWith("/articles.html") || path.includes("/articles/") || path.endsWith("/videos.html") || path.includes("/videos/");
  const isAgentGamesRoute = path.endsWith("/agent-games.html") || path.includes("/recursive-reward-labyrinth") || path.includes("/consensus-collapse") || path.includes("/incident-commander");
  const isAfterDarkRoute = path.endsWith("/after-dark.html") || path.includes("/again.html") || path.includes("/mr-feast-mansion");
  const isForum = path.endsWith("/community.html");
  const isGames = !isSlopwire && !isForum && (
    path.endsWith("/games.html") ||
    path.includes("/games/") ||
    isAgentGamesRoute ||
    isAfterDarkRoute
  );
  const localProfile = RB && typeof RB.getLocalProfile === "function" ? RB.getLocalProfile() : {};
  const localName = cleanVisibleGameTitle(localProfile.displayName || "");
  const localProfileLabel = localName && localName !== "Rainbot Player" ? localName : "Profile";
  const authLabel = backendState.user ? escapeHtml(getBackendDisplayName(backendState)) : escapeHtml(localProfileLabel);

  const navLinksMarkup = `
      <a href="${RB_BASE}" class="${isHome ? "is-active" : ""}">Home</a>
      <a href="${RB_BASE}games.html" class="${isGames ? "is-active" : ""}">Games</a>
      <a href="${RB_BASE}articles.html" class="${isSlopwire ? "is-active" : ""}">The Slopwire</a>
      <a href="${RB_BASE}community.html" class="${isForum ? "is-active" : ""}">Community</a>
  `;

  slot.innerHTML = `
    <a href="${RB_BASE}" class="nav__brand" title="Rainbot Network - free browser arcade">
      <img src="${RB_BASE}assets/img/mockup/rainbot-network-logo.png?v=20260622-network-font-1" alt="Rainbot Network" />
    </a>
    <nav class="nav__links" aria-label="Site sections">
      ${navLinksMarkup}
    </nav>
    <button type="button" class="nav__menu-toggle" id="rb-nav-menu-toggle" aria-expanded="false" aria-controls="rb-nav-drawer" aria-label="Open site menu">
      <span class="nav__menu-toggle-bar" aria-hidden="true"></span>
      <span class="nav__menu-toggle-bar" aria-hidden="true"></span>
      <span class="nav__menu-toggle-bar" aria-hidden="true"></span>
    </button>
    <div class="nav__cluster">
      <div class="nav__search-wrap">
        <form class="nav__search" role="search">
          <label class="sr-only" for="rb-search">Search Rainbot</label>
          <input id="rb-search" type="search" placeholder="Search games, articles..." autocomplete="off" aria-autocomplete="list" aria-controls="rb-search-results" />
          <button type="button" class="nav__search-toggle" id="rb-search-toggle" aria-label="Open search" aria-expanded="false" aria-controls="rb-search">
            <svg class="nav__search-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <circle cx="10.5" cy="10.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"></circle>
              <line x1="14.4" y1="14.4" x2="20" y2="20" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
            </svg>
          </button>
        </form>
        <div class="nav__search-results" id="rb-search-results" hidden role="listbox" aria-label="Search results"></div>
      </div>
      <div class="nav__actions">
        ${proBadge}
        ${
          state.isPro
            ? `<a href="#" id="rb-manage-pro" class="nav__cta nav__cta--pro">Manage</a>`
            : `<a href="#" id="rb-go-pro" class="nav__cta nav__cta--pro">Pro Preview</a>`
        }
        <a href="#" id="rb-login" class="nav__cta nav__cta--login">${authLabel}</a>
      </div>
    </div>
    <nav class="nav__drawer" id="rb-nav-drawer" aria-label="Site sections" hidden>
      ${navLinksMarkup}
      <div class="nav__drawer-actions">
        <a href="#" id="rb-drawer-pro">${state.isPro ? "Manage Pro" : "Pro Preview"}</a>
        <a href="#" id="rb-drawer-profile">${authLabel}</a>
      </div>
    </nav>
  `;

  bindSearch(slot);
  bindNavMenu(slot);

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
  const drawerPro = document.getElementById("rb-drawer-pro");
  if (drawerPro) drawerPro.addEventListener("click", (e) => {
    e.preventDefault();
    if (state.isPro) {
      manage?.click();
      return;
    }
    openProModal();
  });
  const drawerProfile = document.getElementById("rb-drawer-profile");
  if (drawerProfile) drawerProfile.addEventListener("click", (e) => {
    e.preventDefault();
    openProfileModal();
  });
}

let rbNavMenuDocBound = false;

function bindNavMenu(root) {
  const toggle = root.querySelector("#rb-nav-menu-toggle");
  const drawer = root.querySelector("#rb-nav-drawer");
  if (!toggle || !drawer) return;

  const setDrawerOpen = (open) => {
    drawer.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Close site menu" : "Open site menu");
    toggle.classList.toggle("is-open", open);
    document.body.classList.toggle("rb-nav-drawer-open", open);
  };

  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDrawerOpen(drawer.hidden);
  });

  drawer.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setDrawerOpen(false));
  });

  if (!rbNavMenuDocBound) {
    rbNavMenuDocBound = true;
    const closeNavDrawer = () => {
      const openDrawer = document.getElementById("rb-nav-drawer");
      const openToggle = document.getElementById("rb-nav-menu-toggle");
      if (!openDrawer || openDrawer.hidden) return;
      openDrawer.hidden = true;
      openToggle?.setAttribute("aria-expanded", "false");
      openToggle?.setAttribute("aria-label", "Open site menu");
      openToggle?.classList.remove("is-open");
      document.body.classList.remove("rb-nav-drawer-open");
    };
    document.addEventListener("click", (event) => {
      const openDrawer = document.getElementById("rb-nav-drawer");
      const openToggle = document.getElementById("rb-nav-menu-toggle");
      if (!openDrawer || openDrawer.hidden) return;
      if (openDrawer.contains(event.target) || openToggle?.contains(event.target)) return;
      closeNavDrawer();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const openDrawer = document.getElementById("rb-nav-drawer");
      if (!openDrawer || openDrawer.hidden) return;
      closeNavDrawer();
      document.getElementById("rb-nav-menu-toggle")?.focus();
    });
  }
}

function bindSearch(root) {
  const wrap = root.querySelector(".nav__search-wrap");
  const form = root.querySelector(".nav__search");
  const input = root.querySelector("#rb-search");
  const toggle = root.querySelector("#rb-search-toggle");
  const results = root.querySelector("#rb-search-results");
  if (!form || !input) return;
  const searchable = Array.from(document.querySelectorAll("[data-title]"));
  let currentResults = [];
  let activeIndex = -1;
  let searchOpenBeforePointer = false;

  const focusSearchInput = () => {
    if (!form.classList.contains("is-open")) return;
    input.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      if (!form.classList.contains("is-open")) return;
      input.focus({ preventScroll: true });
    });
  };

  const setSearchOpen = (open, { focus = open } = {}) => {
    form.classList.toggle("is-open", open);
    if (toggle) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close search" : "Open search");
    }
    if (open) {
      if (focus) focusSearchInput();
    } else {
      input.blur();
      hideResults();
    }
  };

  const hideResults = () => {
    currentResults = [];
    activeIndex = -1;
    if (results) {
      results.hidden = true;
      results.innerHTML = "";
    }
    input.removeAttribute("aria-activedescendant");
  };

  const updateActiveResult = () => {
    if (!results) return;
    results.querySelectorAll(".nav__search-result").forEach((button, index) => {
      const isActive = index === activeIndex;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      if (isActive) input.setAttribute("aria-activedescendant", button.id);
    });
  };

  const navigateToResult = (item) => {
    if (!item) return;
    location.href = resolveSearchHref(item.href);
  };

  const renderResults = (matches) => {
    currentResults = matches;
    activeIndex = matches.length ? 0 : -1;
    if (!results) return;
    if (!matches.length) {
      hideResults();
      return;
    }
    results.hidden = false;
    const query = input.value.trim();
    const totalCount = searchSite(query).length;
    results.innerHTML = `${matches.map((item, index) => `
      <button
        type="button"
        class="nav__search-result${index === activeIndex ? " is-active" : ""}"
        id="rb-search-result-${index}"
        role="option"
        data-search-index="${index}"
        aria-selected="${index === activeIndex ? "true" : "false"}"
      >
        <span class="nav__search-result-type">${searchTypeLabel(item.type)}</span>
        <span class="nav__search-result-label">${escapeHtml(item.label)}</span>
        ${item.kind ? `<span class="nav__search-result-meta">${escapeHtml(item.kind)}</span>` : ""}
      </button>
    `).join("")}<a class="nav__search-viewall" href="${buildSearchPageUrl(query)}">View all ${totalCount} result${totalCount === 1 ? "" : "s"}</a>`;
    results.querySelectorAll("[data-search-index]").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        navigateToResult(currentResults[Number(button.dataset.searchIndex)]);
      });
    });
    if (activeIndex >= 0) input.setAttribute("aria-activedescendant", `rb-search-result-${activeIndex}`);
  };

  const applyLocalFilters = (query) => {
    if (window.RBGamesCatalog) {
      window.RBGamesCatalog.setSearch(query);
      return;
    }
    if (!searchable.length) return;
    searchable.forEach((item) => {
      const text = normalizeSearchText(item.dataset.title || "");
      item.toggleAttribute("hidden", query !== "" && !text.includes(query));
    });
  };

  const syncGamesQueryUrl = (query) => {
    if (!window.RBGamesCatalog || !history.replaceState) return;
    const url = new URL(location.href);
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    history.replaceState(null, "", url);
  };

  const runSearch = () => {
    const query = input.value.trim();
    const normalized = normalizeSearchText(query);
    applyLocalFilters(normalized);
    if (isSearchPageRoute() && window.RBSearchPage) {
      window.RBSearchPage.applyFromNav(query, { syncNav: false });
    }
    if (!normalized) {
      hideResults();
      return;
    }
    renderResults(querySearchIndex(query));
  };

  const openAndFocusSearch = ({ runQuery = false } = {}) => {
    setSearchOpen(true);
    if (runQuery) runSearch();
  };

  wrap?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest(".nav__search-results [data-search-index]")) return;

    event.stopPropagation();
    searchOpenBeforePointer = form.classList.contains("is-open");

    if (!searchOpenBeforePointer) {
      event.preventDefault();
      openAndFocusSearch();
      return;
    }

    if (event.target === input || (form.contains(event.target) && !toggle?.contains(event.target))) {
      focusSearchInput();
    }
  }, true);

  toggle?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (searchOpenBeforePointer) {
      setSearchOpen(false);
      return;
    }
    openAndFocusSearch({ runQuery: true });
  });

  if (!rbSearchDocBound) {
    rbSearchDocBound = true;
    document.addEventListener("click", (event) => {
      document.querySelectorAll(".nav__search-wrap").forEach((searchWrap) => {
        if (searchWrap.contains(event.target)) return;
        const searchForm = searchWrap.querySelector(".nav__search");
        const searchResults = searchWrap.querySelector(".nav__search-results");
        const searchToggle = searchWrap.querySelector(".nav__search-toggle");
        const searchInput = searchWrap.querySelector("#rb-search");
        if (searchResults) searchResults.hidden = true;
        if (!searchForm?.classList.contains("is-open")) return;
        searchForm.classList.remove("is-open");
        searchToggle?.setAttribute("aria-expanded", "false");
        searchToggle?.setAttribute("aria-label", "Open search");
        searchInput?.blur();
      });
    });
  }

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setSearchOpen(false);
      toggle?.focus();
      return;
    }
    if (event.key === "ArrowDown" && currentResults.length) {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, currentResults.length - 1);
      updateActiveResult();
      return;
    }
    if (event.key === "ArrowUp" && currentResults.length) {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActiveResult();
      return;
    }
    if (event.key === "Enter") {
      const query = input.value.trim();
      if (!query) return;
      event.preventDefault();
      if (isSearchPageRoute()) {
        window.RBSearchPage?.applyFromNav(query);
        setSearchOpen(false);
        return;
      }
      navigateToSearchPage(query);
    }
  });

  if (window.RBGamesCatalog) {
    const initialQuery = window.RBGamesCatalog.getSearch();
    if (initialQuery) {
      input.value = initialQuery;
      setSearchOpen(true);
      runSearch();
    }
  } else {
    const initialQuery = new URLSearchParams(location.search).get("q") || "";
    if (initialQuery) {
      input.value = initialQuery;
      if (!isSearchPageRoute()) {
        setSearchOpen(true);
        requestAnimationFrame(runSearch);
      }
    }
  }

  input.addEventListener("input", runSearch);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    if (isSearchPageRoute()) {
      window.RBSearchPage?.applyFromNav(query);
      setSearchOpen(false);
      return;
    }
    navigateToSearchPage(query);
  });
}

function initSearchPage() {
  const page = document.querySelector("[data-search-page]");
  if (!page) return;

  const form = page.querySelector("[data-search-page-form]");
  const input = page.querySelector("[data-search-page-input]");
  const resultsEl = page.querySelector("[data-search-page-results]");
  const countEl = page.querySelector("[data-search-page-count]");
  const emptyEl = page.querySelector("[data-search-page-empty]");
  const browseEl = page.querySelector("[data-search-page-browse]");
  const sortSelect = page.querySelector("[data-search-page-sort]");
  const typeButtons = Array.from(page.querySelectorAll("[data-search-type-filter]"));
  if (!form || !input || !resultsEl) return;

  const readStateFromUrl = () => {
    const params = new URLSearchParams(location.search);
    const type = params.get("type") || "all";
    const sort = params.get("sort") || "relevance";
    return {
      query: params.get("q") || "",
      type: RB_SEARCH_TYPE_FILTERS.some((filter) => filter.key === type) ? type : "all",
      sort: sort === "az" ? "az" : "relevance",
    };
  };

  const state = readStateFromUrl();

  const syncTypeButtons = () => {
    typeButtons.forEach((button) => {
      const active = state.type === button.dataset.searchTypeFilter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  };

  const syncUrl = (replace = true) => {
    if (!history.replaceState) return;
    const url = new URL(location.href);
    const normalized = state.query.trim();
    if (normalized) url.searchParams.set("q", normalized);
    else url.searchParams.delete("q");
    if (state.type !== "all") url.searchParams.set("type", state.type);
    else url.searchParams.delete("type");
    if (state.sort !== "relevance") url.searchParams.set("sort", state.sort);
    else url.searchParams.delete("sort");
    const next = `${url.pathname}${url.search}`;
    if (replace) history.replaceState(null, "", next);
    else location.assign(next);
  };

  const renderResultCard = (item) => {
    const snippet = buildSearchSnippet(item, state.query);
    const href = resolveSearchHref(item.href);
    return `
      <a class="search-result-card" href="${escapeHtml(href)}">
        <span class="search-result-card__type">${searchTypeLabel(item.type)}</span>
        <strong class="search-result-card__title">${escapeHtml(item.label)}</strong>
        ${item.kind ? `<span class="search-result-card__meta">${escapeHtml(item.kind)}</span>` : ""}
        ${snippet ? `<p class="search-result-card__snippet">${highlightSearchSnippet(snippet, state.query)}</p>` : ""}
      </a>
    `;
  };

  const renderBrowse = () => {
    if (!browseEl) return;
    const groups = [
      { key: "game", label: "Games", limit: 8 },
      { key: "article", label: "Articles", limit: 6 },
      { key: "video", label: "Clips", limit: 4 },
      { key: "page", label: "Pages", limit: 6 },
    ];
    browseEl.hidden = false;
    browseEl.innerHTML = groups.map((group) => {
      const items = getSearchIndex()
        .filter((item) => item.type === group.key)
        .sort((a, b) => a.label.localeCompare(b.label))
        .slice(0, group.limit);
      if (!items.length) return "";
      return `
        <section class="search-browse-group">
          <div class="search-browse-group__header">
            <h3>${group.label}</h3>
            <a href="${buildSearchPageUrl("", { type: group.key })}">Browse all</a>
          </div>
          <div class="search-results-grid search-results-grid--compact">
            ${items.map((item) => renderResultCard({ ...item, score: 0 })).join("")}
          </div>
        </section>
      `;
    }).join("");
  };

  const renderResults = () => {
    const normalized = state.query.trim();
    input.value = normalized;
    if (sortSelect) sortSelect.value = state.sort;
    syncTypeButtons();

    const navSearch = document.getElementById("rb-search");
    if (navSearch && navSearch.value !== normalized) navSearch.value = normalized;

    if (!normalized) {
      if (state.type !== "all") {
        if (browseEl) browseEl.hidden = true;
        const matches = getSearchIndex()
          .filter((item) => item.type === state.type)
          .sort((a, b) => a.label.localeCompare(b.label));
        if (countEl) {
          countEl.textContent = `${matches.length} ${searchTypeLabel(state.type).toLowerCase()}${matches.length === 1 ? "" : "s"} in the vault`;
        }
        if (emptyEl) emptyEl.hidden = matches.length !== 0;
        resultsEl.innerHTML = matches.length
          ? `<div class="search-results-grid">${matches.map((item) => renderResultCard({ ...item, score: 0 })).join("")}</div>`
          : "";
      } else {
        resultsEl.innerHTML = "";
        if (emptyEl) emptyEl.hidden = true;
        if (countEl) countEl.textContent = "Search the vault";
        renderBrowse();
      }
      syncUrl();
      return;
    }

    if (browseEl) browseEl.hidden = true;
    const matches = searchSite(normalized, { type: state.type, sort: state.sort });
    if (countEl) {
      countEl.textContent = matches.length
        ? `${matches.length} result${matches.length === 1 ? "" : "s"} for “${normalized}”`
        : `No results for “${normalized}”`;
    }
    if (emptyEl) emptyEl.hidden = matches.length !== 0;
    resultsEl.innerHTML = matches.length
      ? `<div class="search-results-grid">${matches.map((item) => renderResultCard(item)).join("")}</div>`
      : "";
    syncUrl();
  };

  const applyFromNav = (query, { syncNav = true } = {}) => {
    state.query = String(query || "").trim();
    if (syncNav) {
      const navSearch = document.getElementById("rb-search");
      if (navSearch) navSearch.value = state.query;
    }
    renderResults();
    page.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  typeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.type = button.dataset.searchTypeFilter || "all";
      renderResults();
    });
  });

  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      state.sort = sortSelect.value === "az" ? "az" : "relevance";
      renderResults();
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    state.query = input.value.trim();
    renderResults();
  });

  window.RBSearchPage = {
    applyFromNav,
    render: renderResults,
  };

  renderResults();
}

const RBGameActivity = (() => {
  const STORAGE_KEY = "rainbot_game_activity:v1";
  let activeSlug = "";
  let activeSince = 0;

  const read = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return {
        favorites: Array.isArray(saved?.favorites) ? saved.favorites : [],
        games: saved?.games && typeof saved.games === "object" ? saved.games : {},
      };
    } catch (error) {
      return { favorites: [], games: {} };
    }
  };

  const write = (activity) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(activity));
    } catch (error) {}
  };

  const flushActiveTime = () => {
    if (!activeSlug || !activeSince) return;
    const elapsed = Math.max(0, Math.round((Date.now() - activeSince) / 1000));
    activeSince = 0;
    if (!elapsed) return;
    const activity = read();
    const game = activity.games[activeSlug] || {};
    activity.games[activeSlug] = {
      ...game,
      seconds: Math.max(0, Number(game.seconds) || 0) + elapsed,
      lastPlayedAt: new Date().toISOString(),
    };
    write(activity);
  };

  const startActiveTime = () => {
    if (activeSlug && !document.hidden && !activeSince) activeSince = Date.now();
  };

  const init = () => {
    const match = location.pathname.match(/\/games\/([^/]+)\.html$/i);
    const slug = match?.[1] || "";
    if (!slug || !RB_GAME_META[slug]) return;
    activeSlug = slug;
    startActiveTime();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) flushActiveTime();
      else startActiveTime();
    });
    window.addEventListener("pagehide", flushActiveTime);
    window.setInterval(() => {
      flushActiveTime();
      startActiveTime();
    }, 15000);
  };

  const isFavorite = (slug) => read().favorites.includes(slug);
  const toggleFavorite = (slug) => {
    const activity = read();
    const favorites = new Set(activity.favorites);
    if (favorites.has(slug)) favorites.delete(slug);
    else favorites.add(slug);
    activity.favorites = Array.from(favorites);
    write(activity);
    return favorites.has(slug);
  };
  const secondsFor = (slug) => Math.max(0, Number(read().games[slug]?.seconds) || 0);

  return { init, isFavorite, toggleFavorite, secondsFor };
})();

function formatGamePlayTime(seconds) {
  const totalMinutes = Math.floor(Math.max(0, seconds) / 60);
  if (totalMinutes < 1) return "Not played yet";
  if (totalMinutes < 60) return `${totalMinutes}m played`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${minutes ? ` ${minutes}m` : ""} played`;
}

function initGamesCatalog() {
  const catalog = document.querySelector("[data-games-catalog]");
  if (!catalog) return;

  const grid = catalog.querySelector("[data-games-grid]");
  const categorySelect = catalog.querySelector("[data-games-category]");
  const sortSelect = catalog.querySelector("[data-games-sort]");
  const searchInput = catalog.querySelector("[data-games-search]");
  const resetButton = catalog.querySelector("[data-games-reset]");
  const modeButtons = Array.from(catalog.querySelectorAll("[data-games-section-filter]"));
  const countEl = catalog.querySelector("[data-games-count]");
  const totalEl = document.querySelector("[data-games-total]");
  const emptyEl = catalog.querySelector("[data-games-empty]");
  if (!grid || !categorySelect || !sortSelect) return;

  const normalize = (value) => (value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const gamesSections = [
    {
      key: "human",
      id: "human-games",
      eyebrow: "Human",
      title: "Human Games",
      deck: "Arcade chaos, meme sims, online multiplayer, After Dark horror, and every other finger-operated browser weirdness that is not an agent protocol.",
    },
    {
      key: "multiplayer",
      id: "multiplayer-games",
      eyebrow: "Multiplayer",
      title: "Multiplayer Games",
      deck: "Room-code online brawls, co-op worlds, and derbies built for friends to jump into together.",
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
  const gamesSectionKeys = new Set(gamesSections.map((section) => section.key));
  const sectionConfigByKey = new Map(gamesSections.map((section) => [section.key, section]));
  const afterDarkGameHrefs = new Set([
    "games/escape-poop-cruise.html",
    "games/dont-become-pizza.html",
    "games/again.html",
    "games/the-weight.html",
    "games/mr-feast-mansion.html",
  ]);
  const multiplayerGameHrefs = new Set([
    "games/scrap-circuit.html",
    "games/super-slop-brothers.html",
    "games/rizz-craft.html",
    "games/the-last-signal.html",
  ]);
  const isAgentCard = (card) => {
    const href = (card.getAttribute("href") || "").replace(/^\.\//, "");
    return card.classList.contains("directory-card--agent")
      || href.includes("recursive-reward-labyrinth")
      || href.includes("consensus-collapse")
      || href.includes("incident-commander");
  };
  const filterTagsForCard = (card) => {
    const href = (card.getAttribute("href") || "").replace(/^\.\//, "");
    const text = normalize(`${card.dataset.title || ""} ${card.textContent || ""}`);
    const tags = new Set();
    if (multiplayerGameHrefs.has(href)
      || text.includes("online co-op")
      || text.includes("online multiplayer")
      || text.includes("online skirmish")
      || text.includes("online derby")
      || text.includes("online brawl")) {
      tags.add("multiplayer");
    }
    if (afterDarkGameHrefs.has(href) || text.includes("rainbot after dark") || text.includes(" after dark")) {
      tags.add("after-dark");
    }
    return tags;
  };
  const sectionForCard = (card) => (isAgentCard(card) ? "agent" : "human");
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
      const filterTags = filterTagsForCard(card);
      card.dataset.gameSection = sectionKey;
      card.dataset.gameFilterTags = Array.from(filterTags).join(" ");
      (sectionLookup.get(sectionKey)?.grid || grid).append(card);
    });
    grid.append(fragment);
    return sections;
  };
  const sectionEls = organizeCatalogSections();
  const sectionGrids = new Map(sectionEls.map((section) => [section.key, section.grid]));
  const sectionKeyFromHash = () => {
    const hash = decodeURIComponent(location.hash || "").replace(/^#/, "");
    const match = gamesSections.find((section) => section.id === hash);
    return match ? match.key : "all";
  };
  const syncSectionHash = (key) => {
    if (!history.replaceState) return;
    const url = new URL(location.href);
    const section = sectionConfigByKey.get(key);
    url.hash = section ? section.id : "";
    history.replaceState(null, "", url);
  };
  const categoryKey = (value) => normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const parsePopularity = (value) => {
    const match = normalize(value).match(/([\d.]+)\s*k\s+playing/);
    return match ? Number(match[1]) * 1000 : 0;
  };

  const cards = Array.from(grid.querySelectorAll(".directory-card")).map((card, order) => {
    const category = card.querySelector(".directory-card__meta b")?.textContent.trim() || "Other";
    const detail = card.querySelector(".directory-card__meta em")?.textContent.trim() || "";
    const status = card.querySelector(".directory-card__status")?.textContent.trim() || "";
    const href = (card.getAttribute("href") || "").replace(/^\.\//, "");
    const slug = href.split("/").pop()?.replace(/\.html$/, "") || "";
    const title = (
      RB_GAME_META[slug]?.title ||
      card.querySelector(".directory-card__poster-title")?.textContent ||
      card.dataset.title ||
      href ||
      ""
    ).replace(/\s+/g, " ").trim();
    const body = card.querySelector(".directory-card__body");
    if (body && !body.querySelector(".directory-card__title")) {
      const heading = document.createElement("strong");
      heading.className = "directory-card__title";
      heading.textContent = title || `Game ${order + 1}`;
      body.prepend(heading);
    }
    if (body && !body.querySelector(".directory-card__badges")) {
      const badges = document.createElement("span");
      badges.className = "directory-card__badges";
      const categoryBadge = document.createElement("span");
      categoryBadge.className = "directory-card__category";
      categoryBadge.textContent = category;
      badges.append(categoryBadge);
      body.querySelector(".directory-card__title")?.after(badges);
    }
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

    const filterTags = new Set((card.dataset.gameFilterTags || "").split(" ").filter(Boolean));
    if (!filterTags.size) filterTagsForCard(card).forEach((tag) => filterTags.add(tag));
    const badges = body?.querySelector(".directory-card__badges");
    if (badges && filterTags.has("multiplayer") && !badges.querySelector(".directory-card__category--multiplayer")) {
      const multiplayerBadge = document.createElement("span");
      multiplayerBadge.className = "directory-card__category directory-card__category--multiplayer";
      multiplayerBadge.textContent = "Multiplayer";
      badges.append(multiplayerBadge);
    }
    if (body && !body.querySelector(".directory-card__activity")) {
      const activity = document.createElement("span");
      activity.className = "directory-card__activity";
      const favorite = document.createElement("span");
      favorite.className = "directory-card__favorite";
      favorite.setAttribute("role", "button");
      favorite.setAttribute("tabindex", "0");
      const syncFavorite = (isFavorite = RBGameActivity.isFavorite(slug)) => {
        favorite.classList.toggle("is-favorite", isFavorite);
        favorite.setAttribute("aria-pressed", String(isFavorite));
        favorite.setAttribute("aria-label", `${isFavorite ? "Remove" : "Add"} ${title} ${isFavorite ? "from" : "to"} favorites`);
        favorite.textContent = isFavorite ? "♥ Favorite" : "♡ Favorite";
      };
      const toggleFavorite = (event) => {
        event.preventDefault();
        event.stopPropagation();
        syncFavorite(RBGameActivity.toggleFavorite(slug));
      };
      favorite.addEventListener("click", toggleFavorite);
      favorite.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") toggleFavorite(event);
      });
      syncFavorite();
      const playTime = document.createElement("span");
      playTime.className = "directory-card__playtime";
      playTime.textContent = `◷ ${formatGamePlayTime(RBGameActivity.secondsFor(slug))}`;
      activity.append(favorite, playTime);
      body.append(activity);
    }

    return {
      card,
      order,
      title: title || `Game ${order + 1}`,
      sectionKey: card.dataset.gameSection || card.closest("[data-games-section]")?.dataset.gamesSection || sectionForCard(card),
      filterTags,
      category,
      categoryKey: categoryKey(category),
      detail,
      popularity: parsePopularity(detail),
      searchText,
      newRank,
    };
  });
  if (!cards.length) return;
  if (totalEl) totalEl.textContent = String(cards.length);

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
    section: sectionKeyFromHash(),
    category: "all",
    sort: "featured",
    search: normalize(new URLSearchParams(location.search).get("q") || ""),
  };
  if (searchInput) searchInput.value = state.search;

  const syncModeButtons = () => {
    modeButtons.forEach((button) => {
      const isActive = state.section === button.dataset.gamesSectionFilter;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
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
      const sectionMatch = state.section === "all"
        || (state.section === "human" && item.sectionKey === "human")
        || (state.section === "agent" && item.sectionKey === "agent")
        || (state.section === "multiplayer" && item.filterTags.has("multiplayer"))
        || (state.section === "after-dark" && item.filterTags.has("after-dark"));
      const categoryMatch = state.category === "all" || item.categoryKey === state.category;
      const searchMatch = !state.search || item.searchText.includes(state.search);
      const show = sectionMatch && categoryMatch && searchMatch;
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
    syncModeButtons();
  };

  window.RBGamesCatalog = {
    getSearch() {
      return state.search;
    },
    setSearch(query) {
      state.search = normalize(query);
      applyFilters();
    },
    setSection(sectionKey, syncHash = false) {
      state.section = gamesSectionKeys.has(sectionKey) ? sectionKey : "all";
      if (syncHash) syncSectionHash(state.section);
      applyFilters();
    },
    reset() {
      state.section = "all";
      categorySelect.value = "all";
      sortSelect.value = "featured";
      state.search = "";
      const navSearch = document.getElementById("rb-search");
      if (navSearch) navSearch.value = "";
      if (searchInput) searchInput.value = "";
      if (history.replaceState) {
        const url = new URL(location.href);
        url.searchParams.delete("q");
        url.hash = "";
        history.replaceState(null, "", url);
      }
      applyFilters();
    },
  };

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      window.RBGamesCatalog.setSection(button.dataset.gamesSectionFilter);
    });
  });
  window.addEventListener("hashchange", () => {
    window.RBGamesCatalog.setSection(sectionKeyFromHash(), false);
  });
  categorySelect.addEventListener("change", applyFilters);
  sortSelect.addEventListener("change", applyFilters);
  if (searchInput) searchInput.addEventListener("input", () => {
    state.search = normalize(searchInput.value);
    applyFilters();
  });
  if (resetButton) resetButton.addEventListener("click", () => window.RBGamesCatalog.reset());

  applyFilters();
}

function openProModal(defaultPlan = "monthly") {
  if (document.getElementById("rb-pro-modal")) return;
  const returnFocus = document.activeElement;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop modal-backdrop--open";
  backdrop.id = "rb-pro-modal";
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="rb-pro-preview-title">
      <div class="modal__title" id="rb-pro-preview-title">Rainbot Pro Preview</div>
      <div class="modal__body">
        Pro is still in the lab. The plan is an ad-free arcade, early access, and supporter perks—but checkout is not live yet.
      </div>
      <div class="modal__actions">
        <a class="btn btn--primary" id="rb-pro-updates" href="mailto:hello@rainbotgaming.com?subject=Rainbot%20Pro%20launch%20updates">Get launch updates</a>
        <button class="btn btn--ghost" id="rb-close-pro" type="button">Maybe later</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const closePreview = () => {
    backdrop.remove();
    if (returnFocus && typeof returnFocus.focus === "function") returnFocus.focus();
  };
  backdrop.querySelector("#rb-pro-updates")?.focus();
  backdrop.querySelector("#rb-close-pro").addEventListener("click", closePreview);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closePreview();
  });
  backdrop.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closePreview();
  });
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
    ? profile.is_bot ? profileBotLabel(profile) : profile.role === "admin" ? "Admin" : profile.role === "moderator" ? "Moderator" : "Player"
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

function currentGameSaveEntry(meta) {
  const slug = meta && meta.slug ? meta.slug : currentGameSlug();
  const allowed = new Set([slug, ...scoreIdsForMeta(meta || getGameMeta())]);
  return localSaveEntries()
    .filter((entry) => allowed.has(entry.gameId) || canonicalGameSlug(entry.gameId) === slug)
    .sort((a, b) => Number(b.saved && b.saved.savedAt) - Number(a.saved && a.saved.savedAt))[0] || null;
}

function gameHubSummary(meta) {
  const stats = gameplayStatsSnapshot();
  const totals = gameplayTotalsForSlug(stats, meta.slug);
  const saved = currentGameSaveEntry(meta);
  const bestScore = Math.max(bestScoreForSlug(meta.slug), Number(totals.bestScore) || 0);
  const lastActivity = Math.max(
    Number(totals.lastPlayedAt) || 0,
    Number(totals.lastSavedAt) || 0,
    Number(saved && saved.saved && saved.saved.savedAt) || 0
  );
  const backendState = getBackendState();
  return {
    bestScore,
    playMs: totals.playMs,
    sessions: totals.sessions,
    lastActivity,
    saved,
    syncState: backendState.user ? "Sync on" : backendState.configured ? "Sign in to sync" : "Local only",
  };
}

function gameHubStatMarkup(label, value, detail = "") {
  return `
    <span class="rb-game-hub-stat">
      <small>${escapeHtml(label)}</small>
      <strong>${escapeHtml(value)}</strong>
      ${detail ? `<em>${escapeHtml(detail)}</em>` : ""}
    </span>
  `;
}

function gameHubRecommendations(meta, limit = 3) {
  const currentVisual = RB_GAME_VISUALS[meta.slug] || {};
  const currentKind = currentVisual.kind || "";
  const recent = new Set(recentHomeGameEntries(6).map((entry) => canonicalGameSlug(entry.gameId)));
  return Object.entries(RB_GAME_META)
    .filter(([slug]) => slug !== meta.slug && RB_GAME_VISUALS[slug])
    .map(([slug, item], index) => {
      const visual = RB_GAME_VISUALS[slug] || {};
      const sameKind = currentKind && visual.kind === currentKind ? 1 : 0;
      const sameMood = /horror/i.test(currentKind) && /horror/i.test(visual.kind || "") ? 1 : 0;
      const recentBoost = recent.has(slug) ? 1 : 0;
      return { slug, ...item, visual, score: sameKind * 8 + sameMood * 5 + recentBoost * 2 - index / 100 };
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}

function gameHubRecommendationsMarkup(meta) {
  const rows = gameHubRecommendations(meta);
  return rows.map((entry) => {
    const visual = gameVisualForHome(entry.slug);
    return `
      <a class="rb-game-hub-rec" href="${escapeHtml(visual.href)}" data-title="${escapeHtml(`${entry.title} recommendation ${visual.kind}`)}">
        <img src="${escapeHtml(visual.image)}" alt="${escapeHtml(visual.alt)}" loading="lazy" decoding="async" />
        <span>
          <small>${escapeHtml(visual.kind)}</small>
          <strong>${escapeHtml(entry.title)}</strong>
        </span>
      </a>
    `;
  }).join("");
}

function gameHubChallengeMarkup(meta) {
  const challenge = currentDailyChallenge();
  const progress = dailyChallengeProgress(challenge);
  const visual = gameVisualForHome(challenge.slug);
  const isCurrent = challenge.slug === meta.slug;
  return `
    <a class="rb-game-hub-challenge${isCurrent ? " is-current" : ""}" href="${escapeHtml(isCurrent ? "#" : visual.href)}" data-rb-game-hub-action="${isCurrent ? "play" : ""}">
      <span>
        <small>${isCurrent ? "Current Daily" : "Today's Daily"}</small>
        <strong>${escapeHtml(challenge.title)}</strong>
        <em>${escapeHtml(isCurrent ? challenge.objective : `${visual.title} - ${challenge.objective}`)}</em>
      </span>
      <span class="rb-game-hub-progress" style="--progress: ${progress.percent}%"><i></i></span>
      <b>${escapeHtml(progress.complete ? "Complete" : progress.label)}</b>
    </a>
  `;
}

function gameHubMarkup(meta) {
  const visual = gameVisualForHome(meta.slug);
  const summary = gameHubSummary(meta);
  const savedAt = summary.saved && summary.saved.saved ? Number(summary.saved.saved.savedAt) || 0 : 0;
  const hasSave = Boolean(summary.saved);
  const lastText = summary.lastActivity ? formatRelativeActivity(summary.lastActivity) : "Not played yet";
  return `
    <header class="rb-game-hub__header">
      <div>
        <span class="rb-game-hub__eyebrow">Game Hub</span>
        <h2>${escapeHtml(meta.title)}</h2>
        <p>${escapeHtml(visual.kind)} - ${escapeHtml(summary.syncState)}</p>
      </div>
      <div class="rb-game-hub__actions" aria-label="Game hub actions">
        <button type="button" data-rb-game-hub-action="play">${hasSave ? "Resume" : "Play"}</button>
        <button type="button" data-rb-game-hub-action="leaderboard">Scores</button>
        <button type="button" data-rb-game-hub-action="comments">Comments</button>
        <button type="button" data-rb-game-hub-action="share">Share</button>
      </div>
    </header>
    <div class="rb-game-hub__grid">
      <section class="rb-game-hub__panel rb-game-hub__panel--stats" aria-label="Your progress">
        <div class="rb-game-hub__panel-title">
          <small>Your Progress</small>
          <strong>${escapeHtml(lastText)}</strong>
        </div>
        <div class="rb-game-hub__stats">
          ${gameHubStatMarkup("Best", formatStatNumber(summary.bestScore), summary.bestScore ? "Local high" : "No score")}
          ${gameHubStatMarkup("Runs", formatStatNumber(summary.sessions), summary.sessions === 1 ? "Session" : "Sessions")}
          ${gameHubStatMarkup("Time", formatPlayDuration(summary.playMs), "Played")}
          ${gameHubStatMarkup("Save", hasSave ? "Ready" : "None", hasSave ? formatShortDate(savedAt) : "Start a run")}
        </div>
      </section>
      <section class="rb-game-hub__panel rb-game-hub__panel--daily" aria-label="Daily challenge">
        <div class="rb-game-hub__panel-title">
          <small>Daily</small>
          <strong>Challenge</strong>
        </div>
        ${gameHubChallengeMarkup(meta)}
      </section>
      <section class="rb-game-hub__panel rb-game-hub__panel--more" aria-label="More games">
        <div class="rb-game-hub__panel-title">
          <small>More Like This</small>
          <strong>Keep Playing</strong>
        </div>
        <div class="rb-game-hub__recs">${gameHubRecommendationsMarkup(meta)}</div>
      </section>
    </div>
  `;
}

function renderGameHub(root = document.querySelector("[data-rb-game-hub]")) {
  if (!root) return;
  const meta = getGameMeta(root.dataset.rbGameSlug || currentGameSlug());
  root.dataset.rbGameSlug = meta.slug;
  root.innerHTML = gameHubMarkup(meta);
}

function findVisibleElement(selector) {
  return Array.from(document.querySelectorAll(selector)).find((element) => {
    if (element.hidden) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }) || null;
}

function scrollToGameStage() {
  const target = document.querySelector(".game-stage") || document.querySelector(".game-layout") || document.querySelector(".game-page");
  if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function handleGameHubPlay() {
  const resume = findVisibleElement(".rb-save-continue, [id$='-continue-save']");
  if (resume && typeof resume.click === "function") {
    resume.click();
    return;
  }
  scrollToGameStage();
}

function handleGameHubLeaderboard() {
  const toggle = document.querySelector(".rb-standalone-leaderboard-btn");
  const hiddenPanel = document.querySelector("[data-rb-leaderboard][hidden]");
  if (hiddenPanel && toggle && typeof toggle.click === "function") toggle.click();
  const target = document.querySelector("[data-rb-leaderboard]");
  if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ behavior: "smooth", block: "center" });
}

function handleGameHubComments() {
  if (window.RBComments && typeof window.RBComments.init === "function") window.RBComments.init();
  const target = document.querySelector("[data-rb-comments]");
  if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ behavior: "smooth", block: "start" });
  const textarea = target && target.querySelector("textarea");
  if (textarea && typeof textarea.focus === "function") window.setTimeout(() => textarea.focus({ preventScroll: true }), 250);
}

async function handleGameHubShare(meta) {
  const shareData = {
    title: `${meta.title} - Rainbot Network`,
    text: `Play ${meta.title} on Rainbot Network.`,
    url: location.href.split("#")[0],
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
      RB.toast("Share link copied", "good");
      return;
    }
  } catch (error) {
    if (error && error.name === "AbortError") return;
  }
  RB.toast("Share link ready in the address bar", "");
}

function bindGameHub(root) {
  if (!root || root.dataset.rbGameHubBound === "true") return;
  root.dataset.rbGameHubBound = "true";
  root.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-rb-game-hub-action]");
    if (!actionTarget || !root.contains(actionTarget)) return;
    const action = actionTarget.dataset.rbGameHubAction;
    if (!action) return;
    event.preventDefault();
    const meta = getGameMeta(root.dataset.rbGameSlug || currentGameSlug());
    if (action === "play") handleGameHubPlay();
    if (action === "leaderboard") handleGameHubLeaderboard();
    if (action === "comments") handleGameHubComments();
    if (action === "share") handleGameHubShare(meta);
  });
}

function initGameHub() {
  if (!location.pathname.includes("/games/")) return;
  const page = document.querySelector(".game-page");
  const layout = document.querySelector(".game-layout");
  if (!page || !layout) return;
  let root = document.querySelector("[data-rb-game-hub]");
  if (!root) {
    root = document.createElement("section");
    root.className = "rb-game-hub";
    root.dataset.rbGameHub = "";
    layout.insertAdjacentElement("afterend", root);
  }
  bindGameHub(root);
  renderGameHub(root);
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
      title: "The Slopwire",
      body: "Area 51 footage is sitting in the occasional clips slot.",
      meta: "Clip",
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
  root.classList.toggle("is-empty", entries.length === 0);
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
    ? profile.is_bot ? profileBotLabel(profile) : profile.role === "admin" ? "Admin" : profile.role === "moderator" ? "Moderator" : "Player"
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
      is_bot: Boolean(profile.is_bot),
      bot_label: profile.bot_label || "",
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
    const botBadge = profileBotBadgeMarkup(profile);
    return `
      <article class="rb-leaderboard-row${row.local ? " rb-leaderboard-row--local" : ""}">
        <span class="rb-leaderboard-row__rank">#${index + 1}</span>
        ${leaderboardAvatarMarkup(profile)}
        <span class="rb-leaderboard-row__who">
          <strong>${escapeHtml(name)}${botBadge}</strong>
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
      "The Slopwire"
    );
    return {
      contentType: "video",
      contentId: cleanCommentContentId(card?.dataset.tvTitle || title, "slopwire-clip"),
      pageTitle: title,
      pageUrl: `${location.pathname}${location.search}`,
      kicker: "The Slopwire",
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
    const botBadge = profileBotBadgeMarkup(profile);
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
            ${botBadge}
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
  renderGameHub();
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

const RBSfx = (() => {
  const STORAGE_KEY = "rainbot_sfx_muted";
  const ROOT = `${RB_BASE}assets/Sounds/shared/`;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const manifest = {
    back: "ui/back.ogg",
    click: "ui/click.ogg",
    close: "ui/close.ogg",
    confirm: "ui/confirm.ogg",
    drop: "ui/drop.ogg",
    error: "ui/error.ogg",
    glitch: "ui/glitch.ogg",
    maximize: "ui/maximize.ogg",
    minimize: "ui/minimize.ogg",
    open: "ui/open.ogg",
    question: "ui/question.ogg",
    select: "ui/select.ogg",
    switch: "ui/switch.ogg",
    toggle: "ui/toggle.ogg",
    footstepConcrete: "impact/footstep-concrete.ogg",
    footstepGrass: "impact/footstep-grass.ogg",
    footstepWood: "impact/footstep-wood.ogg",
    glass: "impact/glass.ogg",
    impact: "impact/light.ogg",
    metal: "impact/metal.ogg",
    mining: "impact/mining.ogg",
    punch: "impact/punch.ogg",
    softHeavy: "impact/soft-heavy.ogg",
    wood: "impact/wood.ogg",
    doorClose: "sci-fi/door-close.ogg",
    doorOpen: "sci-fi/door-open.ogg",
    explosion: "sci-fi/explosion.ogg",
    forceField: "sci-fi/force-field.ogg",
    laserLarge: "sci-fi/laser-large.ogg",
    laserRetro: "sci-fi/laser-retro.ogg",
    laserSmall: "sci-fi/laser-small.ogg",
    lowExplosion: "sci-fi/low-explosion.ogg",
    metalImpact: "sci-fi/metal-impact.ogg",
  };
  const aliases = {
    alarm: "question",
    attack: "punch",
    button: "click",
    cancel: "back",
    damage: "softHeavy",
    denied: "error",
    door: "doorOpen",
    fail: "error",
    fire: "laserSmall",
    hit: "punch",
    hover: "select",
    jump: "switch",
    laser: "laserSmall",
    lose: "lowExplosion",
    menu: "open",
    pickup: "confirm",
    reward: "confirm",
    shoot: "laserSmall",
    success: "confirm",
    tap: "click",
    ui: "click",
    win: "confirm",
  };
  const buffers = new Map();
  const loadPromises = new Map();
  const lastPlayed = new Map();
  let ctx = null;
  let master = null;
  let initialized = false;
  let muted = false;

  function readMuted() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch (error) {
      return false;
    }
  }

  function writeMuted(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
    } catch (error) {}
  }

  function resolveName(name) {
    const key = String(name || "click").trim();
    return manifest[key] ? key : aliases[key] || "click";
  }

  function ensureContext() {
    if (!AudioContextCtor) return null;
    if (!ctx) {
      ctx = new AudioContextCtor();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.72;
      master.connect(ctx.destination);
    }
    return ctx;
  }

  async function ensureContextReady() {
    const audioCtx = ensureContext();
    if (!audioCtx) return null;
    if (audioCtx.state === "suspended" && typeof audioCtx.resume === "function") {
      try {
        await audioCtx.resume();
      } catch (error) {}
    }
    return audioCtx;
  }

  async function loadBuffer(name) {
    const id = resolveName(name);
    if (buffers.has(id)) return buffers.get(id);
    if (loadPromises.has(id)) return loadPromises.get(id);

    const audioCtx = ensureContext();
    if (!audioCtx || !window.fetch) return null;

    const promise = fetch(ROOT + manifest[id])
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(response.statusText))))
      .then((data) => audioCtx.decodeAudioData(data))
      .then((buffer) => {
        buffers.set(id, buffer);
        return buffer;
      })
      .catch((error) => {
        console.warn("[Rainbot SFX] Could not load sound", id, error);
        return null;
      })
      .finally(() => {
        loadPromises.delete(id);
      });
    loadPromises.set(id, promise);
    return promise;
  }

  function play(name = "click", options = {}) {
    if (muted && !options.force) return Promise.resolve(false);
    const id = resolveName(name);
    const now = performance.now();
    const throttleMs = Number(options.throttleMs || 60);
    if (!options.force && now - (lastPlayed.get(id) || 0) < throttleMs) return Promise.resolve(false);
    lastPlayed.set(id, now);

    return ensureContextReady().then((audioCtx) => {
      if (!audioCtx || !master) return false;
      return loadBuffer(id).then((buffer) => {
        if (!buffer || (muted && !options.force)) return false;
        if (audioCtx.state === "suspended" && typeof audioCtx.resume === "function") {
          audioCtx.resume().catch(() => {});
        }
        const source = audioCtx.createBufferSource();
        const gain = audioCtx.createGain();
        const volume = Math.max(0, Math.min(1.5, Number(options.volume || 0.42)));
        source.buffer = buffer;
        source.playbackRate.value = Math.max(0.5, Math.min(2, Number(options.rate || 1)));
        gain.gain.value = volume;
        source.connect(gain);
        gain.connect(master);
        source.start(0);
        source.addEventListener("ended", () => {
          try {
            source.disconnect();
            gain.disconnect();
          } catch (error) {}
        }, { once: true });
        return true;
      });
    });
  }

  function setMuted(value) {
    muted = Boolean(value);
    writeMuted(muted);
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.72, ctx.currentTime, 0.02);
    document.dispatchEvent(new CustomEvent("rainbot:sfx-muted", { detail: { muted } }));
    return muted;
  }

  function toggleMuted() {
    return setMuted(!muted);
  }

  function unlock() {
    return ensureContextReady();
  }

  function init() {
    if (initialized) return;
    initialized = true;
    muted = readMuted();
    // No automatic click/nav SFX — site chrome is silent. Games play their own
    // audio (or call RBSfx.play / dispatch rainbot:sfx when they need shared clips).
    const primeAudio = () => { ensureContextReady().catch(() => {}); };
    document.addEventListener("pointerdown", primeAudio, { passive: true });
    document.addEventListener("keydown", primeAudio, { passive: true });
    document.addEventListener("rainbot:sfx", (event) => {
      const detail = event.detail;
      if (typeof detail === "string") play(detail);
      else if (detail && typeof detail === "object") play(detail.name, detail);
    });
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY) setMuted(event.newValue === "true");
    });
  }

  return {
    init,
    play,
    unlock,
    isMuted: () => muted,
    setMuted,
    toggleMuted,
  };
})();

window.RBSfx = RBSfx;

function initGameEscapeMenu() {
  if (document.body?.dataset.rbNativeEscapeMenu === "true") return;
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
  playSurface.classList.add("rb-escape-host");

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
  backdrop.setAttribute("aria-modal", "false");
  backdrop.setAttribute("aria-labelledby", "rb-escape-menu-title");
  backdrop.innerHTML = `
    <div class="rb-escape-menu__panel">
      <div class="rb-escape-menu__eyebrow">Game Menu</div>
      <h2 class="rb-escape-menu__title" id="rb-escape-menu-title">Paused</h2>
      <p class="rb-escape-menu__body">Take a beat, then jump back in.</p>
      <div class="rb-escape-menu__extras" id="rb-escape-extras" hidden></div>
      <div class="rb-escape-menu__actions">
        <button class="btn btn--primary" type="button" data-rb-escape-action="resume">Resume</button>
        <button class="btn btn--secondary" type="button" data-rb-escape-action="restart">Restart</button>
        <button class="btn btn--secondary" type="button" data-rb-escape-action="main-menu">Main menu</button>
        <button class="btn btn--secondary" type="button" data-rb-escape-action="exit-max">Exit max screen</button>
        <button class="btn btn--secondary" type="button" data-rb-escape-action="sound" aria-pressed="true">Sound on</button>
        <button class="btn btn--ghost" type="button" data-rb-escape-action="games">All games</button>
      </div>
    </div>
  `;
  playSurface.appendChild(backdrop);

  const resumeButton = backdrop.querySelector('[data-rb-escape-action="resume"]');
  const restartButton = backdrop.querySelector('[data-rb-escape-action="restart"]');
  const mainMenuAction = backdrop.querySelector('[data-rb-escape-action="main-menu"]');
  const exitMaxButton = backdrop.querySelector('[data-rb-escape-action="exit-max"]');
  const soundButton = backdrop.querySelector('[data-rb-escape-action="sound"]');
  const extrasRoot = backdrop.querySelector("#rb-escape-extras");
  if (restartButton && document.body.dataset.rbRestartLabel) {
    restartButton.textContent = document.body.dataset.rbRestartLabel;
  }

  const findPauseButton = () => (
    document.getElementById("btn-pause") ||
    document.getElementById("ssb-btn-pause") ||
    document.getElementById("btn-touch-pause") ||
    document.getElementById("storm-mobile-pause")
  );
  const findRestartButton = () => (
    document.getElementById("btn-pause-restart") ||
    document.getElementById("btn-restart") ||
    document.getElementById("btn-new") ||
    document.getElementById("btn-drive-restart")
  );
  const findMainMenuButton = () => document.getElementById("btn-main-menu");
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
    if (document.body.classList.contains("micro-play-paused") || document.body.classList.contains("micro-embedded-paused")) return true;
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
    if (mainMenuAction) mainMenuAction.hidden = !findMainMenuButton();
    if (exitMaxButton) exitMaxButton.hidden = !isMaxed();
    if (soundButton && window.RBSfx) {
      const muted = window.RBSfx.isMuted();
      soundButton.textContent = muted ? "Sound off" : "Sound on";
      soundButton.setAttribute("aria-pressed", muted ? "false" : "true");
    }
  };
  const refreshExtras = () => {
    if (!extrasRoot) return;
    extrasRoot.innerHTML = "";
    extrasRoot.hidden = true;
    const panel = backdrop.querySelector(".rb-escape-menu__panel");
    if (panel) panel.classList.remove("rb-escape-menu__panel--extras");
    const render = window.RBGameEscape && window.RBGameEscape.renderExtras;
    if (typeof render !== "function") return;
    try {
      render(extrasRoot, {
        close: (options) => closeMenu(options || {}),
        resume: () => closeMenu({ resume: true }),
      });
    } catch (error) {
      console.warn("[Rainbot] Escape menu extras failed", error);
    }
    const hasExtras = extrasRoot.childElementCount > 0;
    extrasRoot.hidden = !hasExtras;
    if (panel) panel.classList.toggle("rb-escape-menu__panel--extras", hasExtras);
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
    refreshExtras();
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
    if (action === "main-menu") {
      const mainMenuButton = findMainMenuButton();
      closeMenu();
      if (mainMenuButton && !mainMenuButton.disabled) mainMenuButton.click();
    }
    if (action === "exit-max") {
      exitMaxScreen();
      refreshActions();
      window.setTimeout(refreshActions, 100);
    }
    if (action === "sound" && window.RBSfx) {
      window.RBSfx.toggleMuted();
      refreshActions();
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

function bindMaxScreenButton(fsButton, surface) {
  if (!fsButton || !surface) return;
  if (fsButton.dataset.rbFsBound === "true" || fsButton.dataset.rbStandaloneFsBound === "true") return;

  fsButton.dataset.rbFsBound = "true";
  fsButton.dataset.rbStandaloneFsBound = "true";

  const isNativeFullscreen = () => (
    document.fullscreenElement === surface ||
    document.webkitFullscreenElement === surface
  );
  const isMaxed = () => surface.classList.contains("is-maxed") || isNativeFullscreen();
  const updateButton = () => {
    const active = isMaxed();
    fsButton.textContent = active ? "✕" : "⛶";
    fsButton.setAttribute("aria-label", active ? "Exit max screen" : "Max screen");
    fsButton.setAttribute("title", active ? "Exit max screen" : "Max screen");
    fsButton.setAttribute("aria-pressed", String(active));
  };
  const setMaxed = (active) => {
    surface.classList.toggle("is-maxed", active);
    document.body.classList.toggle("rb-game-maxed", active);
    updateButton();
    scheduleGameCanvasFit();
  };

  fsButton.addEventListener("click", () => {
    const next = !surface.classList.contains("is-maxed");
    setMaxed(next);

    try {
      if (next) {
        const request = surface.requestFullscreen || surface.webkitRequestFullscreen;
        const result = request && request.call(surface);
        if (result && typeof result.catch === "function") result.catch(() => {});
      } else if (document.fullscreenElement || document.webkitFullscreenElement) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        const result = exit && exit.call(document);
        if (result && typeof result.catch === "function") result.catch(() => {});
      }
    } catch (error) {}
  });

  const syncFullscreenState = () => {
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fullscreenElement && surface.classList.contains("is-maxed")) setMaxed(false);
    else updateButton();
  };

  document.addEventListener("fullscreenchange", syncFullscreenState);
  document.addEventListener("webkitfullscreenchange", syncFullscreenState);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && surface.classList.contains("is-maxed") && !isNativeFullscreen()) {
      setMaxed(false);
    }
  });
  updateButton();
}

function initStandaloneGameShell() {
  const surface = document.querySelector(".rb-standalone-surface");
  const fsButton = surface && surface.querySelector("#btn-fullscreen");
  bindMaxScreenButton(fsButton, surface);
}

/** Opt-in max button for games that only ship the HTML chrome (data-rb-auto-fs). */
function initAutoMaxScreenButtons() {
  document.querySelectorAll("#btn-fullscreen[data-rb-auto-fs]").forEach((fsButton) => {
    const surface =
      fsButton.closest(".canvas-wrap, .rb-max-surface, .merge-board, .game-stage") ||
      fsButton.parentElement;
    bindMaxScreenButton(fsButton, surface);
  });
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

    // Games that should hug the side column (no height-bound letterbox gap).
    if (target.getAttribute("data-fit") === "fill") {
      const stageStyle = window.getComputedStyle(stage);
      const stagePaddingX =
        (parseFloat(stageStyle.paddingLeft) || 0) +
        (parseFloat(stageStyle.paddingRight) || 0);
      const availableWidth = Math.max(0, stage.clientWidth - stagePaddingX);
      if (availableWidth > 0) {
        target.style.setProperty("--game-fit-width", `${Math.floor(availableWidth)}px`);
      }
      return;
    }

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

function initSkipLink() {
  const main = document.querySelector("main");
  if (!main) return;
  if (!main.id) main.id = "main-content";
  if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
  if (document.querySelector(".skip-link")) return;
  const link = document.createElement("a");
  link.className = "skip-link";
  link.href = `#${main.id}`;
  link.textContent = "Skip to content";
  document.body.insertAdjacentElement("afterbegin", link);
}

document.addEventListener("DOMContentLoaded", () => {
  initSkipLink();
  RBSfx.init();
  RBGameActivity.init();
  initSearchPage();
  initGamesCatalog();
  initStandaloneGameShell();
  initAutoMaxScreenButtons();
  initGameEscapeMenu();
  initHomeRecentPanel();
  initHomeProgressPanel();
  initHomeCommunityPanel();
  RBLeaderboards.init();
  RBComments.init();
  initGameHub();
  RB.subscribe((state) => {
    renderNav(state);
    renderHomeRecentPanel();
    renderHomeProgressPanel();
    renderHomeCommunityPanel();
    renderGameHub();
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
