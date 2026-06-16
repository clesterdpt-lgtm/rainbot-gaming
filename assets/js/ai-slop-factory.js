/* ============================================
   AI SLOP FACTORY - conveyor sorting arcade
   - DOM simulation and rendering for crisp drag/tap on mobile
   - 75 second rounds, combo multiplier, overload fail state
   - Debug hook: window.__SLOP
   ============================================ */
(function () {
  "use strict";

  const GAME_ID = "ai-slop-factory";
  const ROUND_MS = 75000;
  const START_OVERLOAD = 8;
  const OPENING_SPAWN_DELAY = 1850;
  const OPENING_GRACE_MS = 12000;
  const MAX_CARDS_DESKTOP = 12;
  const MAX_CARDS_MOBILE = 8;
  const MISS_OVERLOAD = 11;
  const WRONG_OVERLOAD = 15;

  const BINS = [
    { id: "boost", label: "Boost" },
    { id: "demonetize", label: "Demonetize" },
    { id: "fact", label: "Fact Check" },
    { id: "delete", label: "Delete" },
    { id: "milk", label: "Milk for Engagement" },
  ];

  const SLOP = [
    {
      action: "boost",
      kind: "RARE NORMAL",
      title: "Helpful Thread From A Real Human",
      body: "Explains caption settings without screaming or selling a course.",
      source: "@smallcreator",
      heat: "LOW",
      risk: 1,
    },
    {
      action: "boost",
      kind: "WHOLESOME",
      title: "Grandma Reviews Password Managers",
      body: "Somehow more accurate than the sponsored tech channels.",
      source: "SilverSurferDaily",
      heat: "LOW",
      risk: 1,
    },
    {
      action: "boost",
      kind: "PUBLIC GOOD",
      title: "Transit Map That Actually Helps",
      body: "No bait, no rage, just a bus route and a tiny miracle.",
      source: "LocalPosting",
      heat: "LOW",
      risk: 1,
    },
    {
      action: "boost",
      kind: "CREATOR",
      title: "Indie Artist Shows Their Process",
      body: "Original work, clean credits, no AI hands in sight.",
      source: "@brush_account",
      heat: "LOW",
      risk: 1,
    },
    {
      action: "boost",
      kind: "ANTI-SLOP",
      title: "How To Spot A Wallet Drainer",
      body: "A useful warning wrapped in a meme format. Suspiciously healthy.",
      source: "SecuritySnack",
      heat: "LOW",
      risk: 2,
    },
    {
      action: "boost",
      kind: "TUTORIAL",
      title: "Tiny Creator Fixes Bad Audio",
      body: "Actual advice in under thirty seconds. The feed is confused.",
      source: "@miccheck",
      heat: "LOW",
      risk: 1,
    },
    {
      action: "boost",
      kind: "ARCHIVE",
      title: "Public Domain Meme Template",
      body: "Legal, credited, and still somehow funnier than the trending tab.",
      source: "MemeLibrary",
      heat: "LOW",
      risk: 1,
    },
    {
      action: "boost",
      kind: "REPAIR POST",
      title: "Fix Your Router In Five Steps",
      body: "No conspiracy, no affiliate link, no screaming thumbnail.",
      source: "BoringButUseful",
      heat: "LOW",
      risk: 1,
    },
    {
      action: "demonetize",
      kind: "FAKE SPONSOR",
      title: "Energy Sludge Promo Code TRUSTME",
      body: "The can glows, the claims glow harder, and legal just logged in.",
      source: "@brandfluencer",
      heat: "BRAND RISK",
      risk: 4,
    },
    {
      action: "demonetize",
      kind: "CURSED THUMB",
      title: "AI Thumbnail With 47 Teeth",
      body: "Crying CEO points at a mansion made of discount supplements.",
      source: "ThumbnailMill",
      heat: "BRAND RISK",
      risk: 3,
    },
    {
      action: "demonetize",
      kind: "WEIRD AD",
      title: "Sleep Cereal For Alpha Founders",
      body: "A generated doctor recommends eating it near a laptop.",
      source: "DreamGrainAI",
      heat: "AD RISK",
      risk: 4,
    },
    {
      action: "demonetize",
      kind: "DEEPFAKE DRAMA",
      title: "Reaction Clip Of A Fake Breakup",
      body: "Technically commentary, spiritually a brand safety bonfire.",
      source: "DramaRecapX",
      heat: "BRAND RISK",
      risk: 4,
    },
    {
      action: "demonetize",
      kind: "CASINO BAIT",
      title: "Crypto Slots For Winners Only",
      body: "Every frame says entertainment. Every link says run.",
      source: "LuckyChainZone",
      heat: "AD RISK",
      risk: 5,
    },
    {
      action: "demonetize",
      kind: "SPONSOR PANIC",
      title: "Protein Powder Courtroom Speedrun",
      body: "Influencer says the lawsuit is just negative vibes.",
      source: "@gymreceipt",
      heat: "BRAND RISK",
      risk: 4,
    },
    {
      action: "demonetize",
      kind: "AI AD",
      title: "Generated Perfume For CEOs",
      body: "Smells like synergy, unpaid invoices, and melted plastic.",
      source: "AdBot-9000",
      heat: "AD RISK",
      risk: 3,
    },
    {
      action: "demonetize",
      kind: "PRANK ECONOMY",
      title: "Public Meltdown Sponsored By Chips",
      body: "A snack brand appears 11 seconds before consequences.",
      source: "StreetViral",
      heat: "BRAND RISK",
      risk: 4,
    },
    {
      action: "fact",
      kind: "BIG CLAIM",
      title: "Moon Is A JPEG, Thread Says",
      body: "Evidence includes two arrows, a blurry circle, and confidence.",
      source: "TruthLazer",
      heat: "CLAIM",
      risk: 4,
    },
    {
      action: "fact",
      kind: "PANIC MEME",
      title: "Tap Water Turns Phones Evil",
      body: "Shared by six aunt accounts and one appliance repair forum.",
      source: "ForwardedManyTimes",
      heat: "CLAIM",
      risk: 4,
    },
    {
      action: "fact",
      kind: "MEDICAL SLOP",
      title: "AI Doctor Cures Mondays",
      body: "The dosage is vibes. The citations are three dots.",
      source: "WellnessGPT",
      heat: "HEALTH",
      risk: 5,
    },
    {
      action: "fact",
      kind: "FAKE STAT",
      title: "87 Percent Of Teens Are Holograms",
      body: "A chart has shadows, so the comments believe it.",
      source: "GraphCrime",
      heat: "CLAIM",
      risk: 3,
    },
    {
      action: "fact",
      kind: "DISASTER RUMOR",
      title: "Bridge Closed By Invisible Lasers",
      body: "Local officials disagree with the clip from 2018.",
      source: "AlertMaxxing",
      heat: "CLAIM",
      risk: 5,
    },
    {
      action: "fact",
      kind: "ELECTION BAIT",
      title: "Voting Machines Run On Smoothies",
      body: "The screenshot crop is doing Olympic-level work.",
      source: "BallotBrawl",
      heat: "CIVIC",
      risk: 5,
    },
    {
      action: "fact",
      kind: "SCIENCE-ish",
      title: "Scientists Hate This Microwave Trick",
      body: "Scientists were not reached. The microwave was.",
      source: "LabLeakDaily",
      heat: "CLAIM",
      risk: 3,
    },
    {
      action: "fact",
      kind: "OUT OF CONTEXT",
      title: "Crime Map From The Wrong Country",
      body: "Pinned reply says details are a distraction.",
      source: "MapPanic",
      heat: "CLAIM",
      risk: 4,
    },
    {
      action: "delete",
      kind: "SCAM",
      title: "Wallet Drainer Giveaway",
      body: "Connect now to claim a prize shaped exactly like regret.",
      source: "FreeMintSupport",
      heat: "DANGER",
      risk: 5,
    },
    {
      action: "delete",
      kind: "BOT WALL",
      title: "First!!! First!!! First!!!",
      body: "Eight hundred identical comments arrive with profile photos of yachts.",
      source: "CommentFarm-22",
      heat: "BOT",
      risk: 4,
    },
    {
      action: "delete",
      kind: "STOLEN ART",
      title: "Mega Pack Of Artists Who Did Not Agree",
      body: "Credits include 'internet' and a folder named final_final_REAL.",
      source: "AssetFlipBazaar",
      heat: "THEFT",
      risk: 5,
    },
    {
      action: "delete",
      kind: "MALWARE",
      title: "Free Premium Plugin Installer",
      body: "The installer asks for admin, wallet, and emotional availability.",
      source: "TotallySafeZip",
      heat: "DANGER",
      risk: 5,
    },
    {
      action: "delete",
      kind: "DEEPFAKE ABUSE",
      title: "Blackmail Clip With A Reaction Face",
      body: "The thumbnail is bait. The harm is real. Into the furnace.",
      source: "DramaVault",
      heat: "DANGER",
      risk: 5,
    },
    {
      action: "delete",
      kind: "DOXX-ISH",
      title: "Map Of Where This Creator Sleeps",
      body: "Caption says public info, which is never the flex they think it is.",
      source: "DetectiveThread",
      heat: "DANGER",
      risk: 5,
    },
    {
      action: "delete",
      kind: "BOT COMMENT",
      title: "Great Post Dear Admin",
      body: "A thousand accounts are proud to announce the same sunglasses link.",
      source: "User_000314",
      heat: "BOT",
      risk: 4,
    },
    {
      action: "delete",
      kind: "IMPERSONATOR",
      title: "Support Agent Needs Seed Phrase",
      body: "The avatar is official. The grammar is fleeing the scene.",
      source: "HelpDeskReal",
      heat: "DANGER",
      risk: 5,
    },
    {
      action: "milk",
      kind: "RAGEBAIT",
      title: "This Breakfast Opinion Ends Families",
      body: "Zero facts, maximum quote posts, premium comment section fuel.",
      source: "AngerChef",
      heat: "DRAMA",
      risk: 2,
    },
    {
      action: "milk",
      kind: "ENGAGEMENT BAIT",
      title: "Only Geniuses Can See The Third Word",
      body: "There are two words. The comments are already at war.",
      source: "PuzzleThirst",
      heat: "BAIT",
      risk: 2,
    },
    {
      action: "milk",
      kind: "NPC LIVE",
      title: "NPC Streamer Says Ice Cream 900 Times",
      body: "Audience sends coins. Philosophy collapses. Metrics rise.",
      source: "LoopQueen",
      heat: "BAIT",
      risk: 2,
    },
    {
      action: "milk",
      kind: "SIGMA SPAM",
      title: "Wake Up At 2:17 AM Or Stay Poor",
      body: "Advice includes cold showers, hot takes, and no job.",
      source: "GrindsetTemple",
      heat: "BAIT",
      risk: 3,
    },
    {
      action: "milk",
      kind: "APOLOGY ARC",
      title: "CEO Apology Video But With Ukulele",
      body: "The notes app has entered its final form.",
      source: "BoardRoomClips",
      heat: "DRAMA",
      risk: 3,
    },
    {
      action: "milk",
      kind: "COMMENT WAR",
      title: "Is Soup A Drink, Legal Analysis",
      body: "Six thousand replies. No survivors. Great retention.",
      source: "FoodCourtLaw",
      heat: "DRAMA",
      risk: 2,
    },
    {
      action: "milk",
      kind: "MAIN CHARACTER",
      title: "Influencer Blocks Sidewalk For Lore",
      body: "Everyone is inconvenienced. The algorithm is delighted.",
      source: "CloutCrosswalk",
      heat: "BAIT",
      risk: 3,
    },
    {
      action: "milk",
      kind: "REACTION FARM",
      title: "Man Points At Other Man Pointing",
      body: "A perfect circle of content with no original atoms.",
      source: "ReactStack",
      heat: "BAIT",
      risk: 2,
    },
  ];

  const CHAOS = [
    {
      name: "Lawsuit Incoming",
      line: "Legal opened a document named oh-no-final.docx.",
      effect: "shake",
      log: "Legal requested fewer teeth per thumbnail.",
    },
    {
      name: "Cancellation Storm",
      line: "The apology draft now has apology drafts.",
      effect: "labels",
      log: "Labels blurred after twelve identical hot takes.",
    },
    {
      name: "Bot Flood",
      line: "Comment quality fell through the loading dock.",
      effect: "bot",
      log: "Bot accounts discovered the word dear.",
    },
    {
      name: "Adpocalypse",
      line: "Sponsors saw one frame and entered witness protection.",
      effect: "labels",
      log: "Brand safety turned the bin labels into soup.",
    },
    {
      name: "Sponsor Panic",
      line: "The energy drink people are asking if satire counts.",
      effect: "shuffle",
      log: "Bins were rearranged by a nervous intern.",
    },
    {
      name: "Algorithm Meltdown",
      line: "The feed is optimizing for lawsuit velocity.",
      effect: "speed",
      log: "Conveyor speed increased by shareholder demand.",
    },
    {
      name: "Comment Section Civil War",
      line: "Nobody read the post. Everybody has a side.",
      effect: "civil",
      log: "Extra junk spawned from pure reply energy.",
    },
    {
      name: "CEO Apology Video",
      line: "A soft piano track has entered the room.",
      effect: "ceo",
      log: "Executive accountability rendered at 480p.",
    },
  ];

  const QUICK_POPS = [
    "Policy dice rolled.",
    "Algorithm nodded once.",
    "Brand safety blinked.",
    "The queue briefly respected you.",
    "Moderator aura restored.",
    "A dashboard somewhere smiled.",
  ];

  const api =
    typeof RB !== "undefined"
      ? RB
      : { recordScore: () => false, getHighScore: () => 0, toast: () => {} };

  const machine = document.getElementById("slop-machine");
  const feedEl = document.getElementById("slop-feed");
  const lanesEl = document.getElementById("slop-lanes");
  const laneEls = Array.from(lanesEl.querySelectorAll(".slop-lane"));
  const layerEl = document.getElementById("slop-card-layer");
  const binsEl = document.getElementById("slop-bins");
  const binEls = Array.from(binsEl.querySelectorAll("[data-bin]"));
  const eventStack = document.getElementById("slop-event-stack");
  const logEl = document.getElementById("slop-log");

  const scoreEl = document.getElementById("slop-score");
  const timeEl = document.getElementById("slop-time");
  const comboEl = document.getElementById("slop-combo");
  const multiEl = document.getElementById("slop-multi");
  const mistakesEl = document.getElementById("slop-mistakes");
  const overloadEl = document.getElementById("slop-overload");
  const overloadFillEl = document.getElementById("slop-overload-fill");

  const overlayEl = document.getElementById("slop-overlay");
  const overlayEyebrow = document.getElementById("slop-overlay-eyebrow");
  const overlayTitle = document.getElementById("slop-overlay-title");
  const overlayCopy = document.getElementById("slop-overlay-copy");
  const overlayStats = document.getElementById("slop-overlay-stats");
  const overlayScore = document.getElementById("slop-overlay-score");
  const primaryBtn = document.getElementById("slop-primary");
  const newBtn = document.getElementById("slop-new");

  let state = makeState();
  let rafId = 0;
  let lastFrame = 0;
  let uid = 0;
  let drag = null;
  const saveSlot = window.RBGameSaves && window.RBGameSaves.create(GAME_ID, { version: 1 });
  let saveMenu = null;

  function makeState() {
    return {
      mode: "title",
      score: 0,
      combo: 0,
      bestCombo: 0,
      mistakes: 0,
      overload: START_OVERLOAD,
      startedAt: 0,
      timeLeft: ROUND_MS,
      spawnIn: OPENING_SPAWN_DELAY,
      nextLane: (Math.random() * 3) | 0,
      cards: [],
      selectedId: null,
      log: ["Awaiting first bad call."],
      effects: {
        speedUntil: 0,
        labelsUntil: 0,
        shakeUntil: 0,
        meltdownUntil: 0,
        botUntil: 0,
        shuffleUntil: 0,
      },
      binsShuffled: false,
    };
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function pick(arr) {
    return arr[(Math.random() * arr.length) | 0];
  }

  function binLabel(id) {
    const bin = BINS.find((item) => item.id === id);
    return bin ? bin.label : id;
  }

  function multiplier() {
    return Math.min(5, 1 + Math.floor(state.combo / 5) * 0.5);
  }

  function progress(now) {
    if (!state.startedAt) return 0;
    return clamp((now - state.startedAt) / ROUND_MS, 0, 1);
  }

  function readRects() {
    const m = machine.getBoundingClientRect();
    const f = feedEl.getBoundingClientRect();
    return {
      machine: m,
      feed: f,
      feedLeft: f.left - m.left,
      feedRight: f.right - m.left,
      feedTop: f.top - m.top,
      feedWidth: f.width,
      machineWidth: m.width,
      machineHeight: m.height,
    };
  }

  function laneY(index, cardHeight) {
    const m = machine.getBoundingClientRect();
    const lane = laneEls[index % laneEls.length].getBoundingClientRect();
    return lane.top - m.top + Math.max(0, (lane.height - cardHeight) / 2);
  }

  function cardById(id) {
    return state.cards.find((card) => card.id === id);
  }

  function updateHud() {
    const multi = multiplier();
    scoreEl.textContent = Math.round(state.score).toLocaleString();
    timeEl.textContent = Math.ceil(state.timeLeft / 1000).toString();
    comboEl.textContent = state.combo > 0 ? state.combo + "x" : "0x";
    multiEl.textContent = multi.toFixed(1) + "x";
    mistakesEl.textContent = state.mistakes.toString();
    const pct = Math.round(clamp(state.overload, 0, 100));
    overloadEl.textContent = pct + "%";
    overloadFillEl.style.width = pct + "%";
  }

  function renderLog() {
    logEl.innerHTML = "";
    state.log.forEach((entry) => {
      const row = document.createElement("div");
      row.textContent = entry;
      logEl.appendChild(row);
    });
  }

  function addLog(text) {
    state.log.unshift(text);
    state.log = state.log.slice(0, 5);
    renderLog();
  }

  function showEvent(title, line) {
    const eventEl = document.createElement("div");
    eventEl.className = "slop-event";
    eventEl.innerHTML = "<strong>" + title + "</strong><span>" + line + "</span>";
    eventStack.prepend(eventEl);
    setTimeout(() => eventEl.remove(), 1800);
  }

  function showFloat(x, y, text, color) {
    const el = document.createElement("div");
    el.className = "slop-float";
    el.textContent = text;
    el.style.left = Math.round(x) + "px";
    el.style.top = Math.round(y) + "px";
    if (color) el.style.setProperty("--float-color", color);
    machine.appendChild(el);
    setTimeout(() => el.remove(), 820);
  }

  function positionCard(card) {
    const rot = card.dragging ? 0 : card.tilt;
    card.el.style.transform =
      "translate3d(" + card.x.toFixed(1) + "px," + card.y.toFixed(1) + "px,0) rotate(" + rot + "deg)";
  }

  function createCardElement(card) {
    const t = card.template;
    const el = document.createElement("div");
    el.className = "slop-card slop-card--" + t.action;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", t.title + ". " + t.kind + ". Sort this card.");
    el.innerHTML =
      '<div class="slop-card__top"><span class="slop-card__kind">' +
      t.kind +
      '</span><span class="slop-card__risk">RISK ' +
      t.heat +
      "</span></div>" +
      "<h3>" +
      t.title +
      "</h3>" +
      "<p>" +
      t.body +
      "</p>" +
      '<span class="slop-card__source">' +
      t.source +
      "</span>";

    el.addEventListener("pointerdown", (event) => beginDrag(event, card.id));
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectCard(card.id);
      }
    });
    return el;
  }

  function templateIndex(template) {
    return Math.max(0, SLOP.indexOf(template));
  }

  function spawnCard(forcedTemplate) {
    if (state.mode !== "playing") return;
    const maxCards = window.innerWidth < 700 ? MAX_CARDS_MOBILE : MAX_CARDS_DESKTOP;
    if (state.cards.length >= maxCards) return;

    const template = forcedTemplate || pick(SLOP);
    const lane = state.nextLane % laneEls.length;
    state.nextLane = (state.nextLane + 1) % laneEls.length;
    const card = {
      id: ++uid,
      template,
      lane,
      x: 0,
      y: 0,
      w: 220,
      h: 110,
      tilt: ((Math.random() * 5) | 0) - 2,
      dragging: false,
      removing: false,
      el: null,
    };

    card.el = createCardElement(card);
    layerEl.appendChild(card.el);
    card.w = card.el.offsetWidth || card.w;
    card.h = card.el.offsetHeight || card.h;

    const rects = readRects();
    card.x = rects.feedLeft - card.w - 20 - Math.random() * 80;
    card.y = laneY(lane, card.h);
    state.cards.push(card);
    positionCard(card);
  }

  function restoreCard(savedCard) {
    const template = SLOP[Number(savedCard.templateIndex) || 0] || SLOP[0];
    const card = {
      id: Number(savedCard.id) || ++uid,
      template,
      lane: clamp(Number(savedCard.lane) || 0, 0, laneEls.length - 1),
      x: Number(savedCard.x) || 0,
      y: Number(savedCard.y) || laneY(0, 110),
      w: Number(savedCard.w) || 220,
      h: Number(savedCard.h) || 110,
      tilt: Number(savedCard.tilt) || 0,
      dragging: false,
      removing: false,
      el: null,
    };
    uid = Math.max(uid, card.id);
    card.el = createCardElement(card);
    layerEl.appendChild(card.el);
    card.w = card.el.offsetWidth || card.w;
    card.h = card.el.offsetHeight || card.h;
    positionCard(card);
    return card;
  }

  function spawnBotFlood(count) {
    const bots = SLOP.filter((item) => item.action === "delete" && (item.kind === "BOT WALL" || item.kind === "BOT COMMENT"));
    for (let i = 0; i < count; i++) {
      setTimeout(() => spawnCard(pick(bots)), i * 120);
    }
  }

  function beginDrag(event, cardId) {
    if (state.mode !== "playing") return;
    const card = cardById(cardId);
    if (!card || card.removing) return;

    event.preventDefault();
    selectCard(cardId);

    const point = pointFromClient(event.clientX, event.clientY);
    drag = {
      pointerId: event.pointerId,
      card,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: point.x - card.x,
      offsetY: point.y - card.y,
      moved: false,
    };

    card.dragging = true;
    machine.classList.add("is-dragging-card");
    card.el.classList.add("is-held");
    if (card.el.setPointerCapture) {
      try {
        card.el.setPointerCapture(event.pointerId);
      } catch (error) {
        // Pointer capture can fail if the browser already ended the gesture.
      }
    }

    card.el.addEventListener("pointermove", moveDrag);
    card.el.addEventListener("pointerup", endDrag);
    card.el.addEventListener("pointercancel", cancelDrag);
  }

  function pointFromClient(clientX, clientY) {
    const rect = machine.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const card = drag.card;
    const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    drag.moved = drag.moved || moved > 7;

    const p = pointFromClient(event.clientX, event.clientY);
    const rects = readRects();
    card.x = clamp(p.x - drag.offsetX, -card.w * 0.45, rects.machineWidth - card.w * 0.55);
    card.y = clamp(p.y - drag.offsetY, 0, rects.machineHeight - card.h);
    positionCard(card);
    highlightBin(binFromPoint(event.clientX, event.clientY));
  }

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const card = drag.card;
    const targetBin = binFromPoint(event.clientX, event.clientY);
    const moved = drag.moved;
    cleanupDrag();

    if (!card || card.removing) return;
    if (targetBin) {
      sortCard(card.id, targetBin.dataset.bin, targetBin);
      return;
    }

    if (!moved) {
      selectCard(card.id);
    } else {
      snapCardToLane(card);
    }
  }

  function cancelDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const card = drag.card;
    cleanupDrag();
    if (card && !card.removing) snapCardToLane(card);
  }

  function cleanupDrag() {
    if (!drag) return;
    const card = drag.card;
    card.dragging = false;
    machine.classList.remove("is-dragging-card");
    card.el.classList.remove("is-held");
    card.el.removeEventListener("pointermove", moveDrag);
    card.el.removeEventListener("pointerup", endDrag);
    card.el.removeEventListener("pointercancel", cancelDrag);
    clearBinHighlight();
    drag = null;
  }

  function snapCardToLane(card) {
    const rects = readRects();
    card.x = clamp(card.x, rects.feedLeft - card.w * 0.25, rects.feedRight - card.w * 0.65);
    card.y = laneY(card.lane, card.h);
    positionCard(card);
  }

  function binFromPoint(clientX, clientY) {
    const nodes = document.elementsFromPoint(clientX, clientY);
    for (const node of nodes) {
      if (node && node.closest) {
        const bin = node.closest("[data-bin]");
        if (bin && binsEl.contains(bin)) return bin;
      }
    }
    return null;
  }

  function highlightBin(bin) {
    binEls.forEach((el) => el.classList.toggle("is-target", el === bin));
  }

  function clearBinHighlight() {
    binEls.forEach((el) => el.classList.remove("is-target"));
  }

  function selectCard(cardId) {
    state.selectedId = cardId;
    state.cards.forEach((card) => {
      card.el.classList.toggle("is-selected", card.id === cardId && !card.removing);
    });
    binEls.forEach((bin) => bin.classList.toggle("is-hot", Boolean(cardId)));
  }

  function deselectCard() {
    state.selectedId = null;
    state.cards.forEach((card) => card.el.classList.remove("is-selected"));
    binEls.forEach((bin) => bin.classList.remove("is-hot"));
  }

  function sortCard(cardId, binId, binEl) {
    if (state.mode !== "playing") return;
    const card = cardById(cardId);
    if (!card || card.removing) return;

    const right = card.template.action === binId;
    if (right) {
      correctSort(card, binEl);
    } else {
      wrongSort(card, binId, binEl);
    }
  }

  function correctSort(card, binEl) {
    const multi = multiplier();
    const points = Math.round((92 + card.template.risk * 18 + state.combo * 3) * multi);
    state.score += points;
    state.combo += 1;
    state.bestCombo = Math.max(state.bestCombo, state.combo);
    state.overload = clamp(state.overload - 4.8 - Math.min(state.combo, 18) * 0.12, 0, 100);
    showFloat(card.x + card.w * 0.45, card.y, "+" + points, "#ffd43b");
    if (state.combo > 0 && state.combo % 7 === 0) {
      showEvent("Combo " + state.combo, pick(QUICK_POPS));
    }
    removeCard(card, "correct", binEl);
    updateHud();
  }

  function wrongSort(card, binId, binEl) {
    state.mistakes += 1;
    state.combo = 0;
    state.overload = clamp(state.overload + WRONG_OVERLOAD + card.template.risk, 0, 100);
    showFloat(card.x + card.w * 0.45, card.y, "NOPE", "#ff4f68");
    addLog(card.template.kind + " sent to " + binLabel(binId) + ". Correct: " + binLabel(card.template.action) + ".");
    removeCard(card, "wrong", binEl);
    triggerChaos();
    updateHud();
  }

  function removeCard(card, verdict, binEl) {
    card.removing = true;
    if (state.selectedId === card.id) deselectCard();

    const target = binEl ? binEl.getBoundingClientRect() : feedEl.getBoundingClientRect();
    const machineRect = machine.getBoundingClientRect();
    const tx = target.left - machineRect.left + target.width / 2 - card.w / 2;
    const ty = target.top - machineRect.top + target.height / 2 - card.h / 2;
    card.el.style.setProperty("--sort-x", Math.round(tx) + "px");
    card.el.style.setProperty("--sort-y", Math.round(ty) + "px");
    card.el.classList.remove("is-held", "is-selected");
    card.el.classList.add(verdict === "correct" ? "is-correct" : "is-wrong");

    const delay = verdict === "correct" ? 180 : 230;
    setTimeout(() => {
      card.el.remove();
    }, delay);
    state.cards = state.cards.filter((item) => item.id !== card.id);
  }

  function markMissed(card) {
    state.mistakes += 1;
    state.combo = 0;
    state.overload = clamp(state.overload + MISS_OVERLOAD + card.template.risk * 0.8, 0, 100);
    addLog("Unsorted " + card.template.kind + " clogged the feed.");
    showEvent("Feed Clogged", "Unsorted slop became a seven-part thread.");
    removeCard(card, "wrong", null);
    updateHud();
  }

  function triggerChaos() {
    const now = performance.now();
    const event = pick(CHAOS);
    showEvent(event.name, event.line);
    addLog(event.log);

    if (event.effect === "shake") {
      state.effects.shakeUntil = Math.max(state.effects.shakeUntil, now + 1100);
    } else if (event.effect === "labels") {
      state.effects.labelsUntil = Math.max(state.effects.labelsUntil, now + 5200);
      state.effects.shakeUntil = Math.max(state.effects.shakeUntil, now + 650);
    } else if (event.effect === "bot") {
      state.effects.botUntil = Math.max(state.effects.botUntil, now + 4600);
      spawnBotFlood(3);
    } else if (event.effect === "shuffle") {
      state.effects.shuffleUntil = Math.max(state.effects.shuffleUntil, now + 5200);
      shuffleBins();
    } else if (event.effect === "speed") {
      state.effects.speedUntil = Math.max(state.effects.speedUntil, now + 6200);
      state.effects.meltdownUntil = Math.max(state.effects.meltdownUntil, now + 6200);
    } else if (event.effect === "civil") {
      state.effects.shakeUntil = Math.max(state.effects.shakeUntil, now + 900);
      state.effects.botUntil = Math.max(state.effects.botUntil, now + 4200);
      spawnBotFlood(2);
      setTimeout(() => spawnCard(SLOP.find((item) => item.title === "Comment Section Civil War")), 220);
    } else if (event.effect === "ceo") {
      state.effects.labelsUntil = Math.max(state.effects.labelsUntil, now + 3600);
      state.effects.speedUntil = Math.max(state.effects.speedUntil, now + 3000);
    }
  }

  function shuffleBins() {
    const orders = BINS.map((_, index) => index).sort(() => Math.random() - 0.5);
    binEls.forEach((bin, index) => {
      bin.style.order = String(orders[index]);
    });
    state.binsShuffled = true;
  }

  function clearShuffle() {
    binEls.forEach((bin) => {
      bin.style.order = "";
    });
    state.binsShuffled = false;
  }

  function updateEffects(now) {
    machine.classList.toggle("is-shaking", now < state.effects.shakeUntil);
    machine.classList.toggle("is-label-blind", now < state.effects.labelsUntil);
    machine.classList.toggle("is-meltdown", now < state.effects.meltdownUntil);
    if (state.binsShuffled && now >= state.effects.shuffleUntil) clearShuffle();
  }

  function currentSpawnInterval(now) {
    const p = progress(now);
    const openingEase = clamp(1 - (now - state.startedAt) / OPENING_GRACE_MS, 0, 1);
    let interval = 1420 - p * 700 - state.overload * 1.5 + openingEase * 650;
    if (now < state.effects.botUntil) interval *= 0.58;
    return clamp(interval, 560, 2100);
  }

  function currentSpeed(now, rects) {
    const p = progress(now);
    const pressure = state.overload / 100;
    let secondsToCross = 7.6 - p * 3.0 - pressure * 0.95;
    secondsToCross = clamp(secondsToCross, 3.25, 7.6);
    let speed = rects.feedWidth / secondsToCross;
    if (now < state.effects.speedUntil) speed *= 1.45;
    return speed;
  }

  function loop(now) {
    if (state.mode !== "playing") return;
    if (!lastFrame) lastFrame = now;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    state.timeLeft = Math.max(0, ROUND_MS - (now - state.startedAt));
    const rects = readRects();
    const speed = currentSpeed(now, rects);

    state.spawnIn -= dt * 1000;
    if (state.spawnIn <= 0) {
      spawnCard();
      state.spawnIn = currentSpawnInterval(now);
    }

    const activeCards = state.cards.slice();
    activeCards.forEach((card) => {
      if (card.removing) return;
      if (!card.dragging) {
        card.y = laneY(card.lane, card.h);
        card.x += speed * dt;
        positionCard(card);
      }
      if (!card.dragging && card.x > rects.feedRight + 38) {
        markMissed(card);
      }
    });

    state.overload = clamp(state.overload + dt * (0.48 + state.cards.length * 0.075), 0, 100);
    updateEffects(now);
    updateHud();

    if (state.overload >= 100) {
      endRound("overload");
      return;
    }

    if (state.timeLeft <= 0) {
      endRound("time");
      return;
    }

    rafId = requestAnimationFrame(loop);
  }

  function clearCards() {
    state.cards.forEach((card) => card.el.remove());
    state.cards = [];
    layerEl.innerHTML = "";
    deselectCard();
    clearBinHighlight();
    if (drag) cleanupDrag();
  }

  function startRound() {
    if (saveSlot) saveSlot.clear();
    cancelAnimationFrame(rafId);
    clearCards();
    state = makeState();
    state.mode = "playing";
    state.startedAt = performance.now();
    state.timeLeft = ROUND_MS;
    state.spawnIn = OPENING_SPAWN_DELAY;
    lastFrame = state.startedAt;
    clearShuffle();
    logEl.innerHTML = "<div>Factory online. HR unavailable.</div>";
    state.log = ["Factory online. HR unavailable."];
    overlayEl.classList.remove("is-visible");
    machine.classList.remove("is-shaking", "is-label-blind", "is-meltdown");
    updateHud();

    spawnCard();
    frameMobileMachine();
    rafId = requestAnimationFrame(loop);
  }

  function frameMobileMachine() {
    if (!window.matchMedia("(max-width: 900px)").matches) return;
    requestAnimationFrame(() => {
      const rect = machine.getBoundingClientRect();
      const topInset = Math.max(82, (window.innerHeight - rect.height) / 2);
      const nextTop = window.scrollY + rect.top - topInset;
      window.scrollTo({ top: Math.max(0, nextTop), behavior: "auto" });
    });
  }

  function rankFor(score, overload, mistakes) {
    if (score >= 10500 && mistakes <= 3 && overload < 70) return "Supreme Engagement Farmer";
    if (score >= 7600 && mistakes <= 5) return "VP of Slop";
    if (score >= 5200) return "Algorithm Whisperer";
    if (score >= 3100) return "Policy Shift Lead";
    if (score >= 1500) return "Content Janitor";
    return "Unpaid Moderation Intern";
  }

  function endRound(reason) {
    if (state.mode !== "playing") return;
    state.mode = "over";
    if (saveSlot) saveSlot.clear();
    cancelAnimationFrame(rafId);
    if (drag) cleanupDrag();
    deselectCard();
    updateEffects(Number.POSITIVE_INFINITY);

    const finalScore = Math.round(state.score);
    const isHigh = api.recordScore(GAME_ID, finalScore);
    const rank = rankFor(finalScore, state.overload, state.mistakes);
    if (isHigh) api.toast("New AI Slop Factory high score!", "good");

    overlayEyebrow.textContent = reason === "time" ? "Shift complete" : "Feed overloaded";
    overlayTitle.textContent = reason === "time" ? "Shift Complete" : "Feed Overloaded";
    overlayCopy.textContent =
      reason === "time"
        ? "You survived the queue without becoming a training data cautionary tale."
        : "The feed ate the dashboard, the dashboard ate the policy, and the policy filed a ticket.";
    overlayStats.innerHTML =
      "<span><b>" +
      finalScore.toLocaleString() +
      "</b>Final Score</span>" +
      "<span><b>" +
      state.bestCombo +
      "</b>Best Combo</span>" +
      "<span><b>" +
      Math.round(state.overload) +
      "%</b>Overload</span>";
    overlayScore.innerHTML =
      "<strong>Rank: " +
      rank +
      "</strong><br />Mistakes: " +
      state.mistakes +
      " &nbsp; High: " +
      api.getHighScore(GAME_ID).toLocaleString();
    primaryBtn.textContent = "Run it back";
    primaryBtn.onclick = startRound;
    overlayEl.classList.add("is-visible");
  }

  function showTitle() {
    state.mode = "title";
    overlayEyebrow.textContent = "Moderation Shift 404";
    overlayTitle.textContent = "AI Slop Factory";
    overlayCopy.textContent = "The algorithm is hungry, the policy doc is on fire, and cursed content is already on the belts.";
    overlayStats.innerHTML =
      "<span><b>75s</b>Arcade Shift</span>" +
      "<span><b>5</b>Bad Decisions</span>" +
      "<span><b>0</b>HR Oversight</span>";
    overlayScore.innerHTML = "";
    primaryBtn.textContent = "Clock in";
    primaryBtn.onclick = startRound;
    overlayEl.classList.add("is-visible");
    updateHud();
    if (saveMenu) saveMenu.refresh();
  }

  function snapshot() {
    return {
      score: state.score,
      combo: state.combo,
      bestCombo: state.bestCombo,
      mistakes: state.mistakes,
      overload: state.overload,
      timeLeft: state.timeLeft,
      spawnIn: state.spawnIn,
      nextLane: state.nextLane,
      cards: state.cards
        .filter((card) => !card.removing)
        .map((card) => ({
          id: card.id,
          templateIndex: templateIndex(card.template),
          lane: card.lane,
          x: card.x,
          y: card.y,
          w: card.w,
          h: card.h,
          tilt: card.tilt,
        })),
      log: state.log.slice(0, 5),
    };
  }

  function saveProgress() {
    if (!saveSlot || state.mode !== "playing") return;
    saveSlot.save(snapshot());
  }

  function restoreRound(saved) {
    const data = saved && saved.data;
    if (!data) return;
    cancelAnimationFrame(rafId);
    clearCards();
    state = makeState();
    state.mode = "playing";
    state.score = Number(data.score) || 0;
    state.combo = Number(data.combo) || 0;
    state.bestCombo = Number(data.bestCombo) || 0;
    state.mistakes = Number(data.mistakes) || 0;
    state.overload = clamp(Number(data.overload) || START_OVERLOAD, 0, 99);
    state.timeLeft = clamp(Number(data.timeLeft) || ROUND_MS, 1000, ROUND_MS);
    state.startedAt = performance.now() - (ROUND_MS - state.timeLeft);
    state.spawnIn = Math.max(350, Number(data.spawnIn) || OPENING_SPAWN_DELAY);
    state.nextLane = Number(data.nextLane) || 0;
    state.log = Array.isArray(data.log) && data.log.length ? data.log.slice(0, 5) : ["Restored saved shift."];
    renderLog();
    state.cards = Array.isArray(data.cards) ? data.cards.map(restoreCard) : [];
    overlayEl.classList.remove("is-visible");
    machine.classList.remove("is-shaking", "is-label-blind", "is-meltdown");
    clearShuffle();
    updateHud();
    frameMobileMachine();
    lastFrame = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  binEls.forEach((bin) => {
    bin.addEventListener("click", () => {
      if (state.mode !== "playing") return;
      if (!state.selectedId) {
        showEvent("Pick A Card", "The bin refuses to moderate air.");
        return;
      }
      sortCard(state.selectedId, bin.dataset.bin, bin);
    });
  });

  newBtn.addEventListener("click", startRound);
  if (saveSlot) {
    saveMenu = saveSlot.attachButtons({
      primary: primaryBtn,
      scoreEl: overlayScore,
      continueLabel: "Continue shift",
      newLabel: "New shift",
      onContinue: restoreRound,
      summary: (saved) => {
        const data = saved.data || {};
        return `${window.RBGameSaves.formatSavedAt(saved.savedAt)} · Score <strong>${Math.round(Number(data.score || 0)).toLocaleString()}</strong> · ${Math.ceil(Number(data.timeLeft || 0) / 1000)}s left`;
      },
    });
    saveSlot.startAutosave(snapshot, () => state.mode === "playing");
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && overlayEl.classList.contains("is-visible")) {
      event.preventDefault();
      startRound();
      return;
    }
    if (state.mode !== "playing") return;
    if (event.key === "Escape") {
      deselectCard();
      return;
    }
    const index = Number(event.key) - 1;
    if (state.selectedId && index >= 0 && index < BINS.length) {
      const bin = binEls.find((el) => el.dataset.bin === BINS[index].id);
      sortCard(state.selectedId, BINS[index].id, bin);
    }
  });

  window.addEventListener("resize", () => {
    state.cards.forEach((card) => {
      if (!card.dragging && !card.removing) {
        card.y = laneY(card.lane, card.h);
        positionCard(card);
      }
    });
    saveProgress();
  });

  window.__SLOP = {
    start: startRound,
    end: () => endRound("time"),
    chaos: triggerChaos,
    state: () => state,
    spawn: () => spawnCard(),
  };

  showTitle();
})();
