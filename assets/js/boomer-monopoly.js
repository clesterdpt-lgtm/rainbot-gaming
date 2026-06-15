/* ============================================
   BOOMER MONOPOLY
   --------------------------------------------
   Satirical turn-based housing board game.
   Roll, buy, renovate, collect rent, and try
   to end 16 rounds with the highest net worth.
   ============================================ */

(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const GAME_ID = "boomer_monopoly";
  const MAX_ROUNDS = 16;

  const api = window.RB || {
    showRewarded: () => Promise.resolve(true),
    isAdFree: () => false,
    recordScore: () => false,
    getHighScore: () => 0,
    toast: (message) => console.log(message),
  };

  const el = {
    cash: document.getElementById("hud-cash"),
    worth: document.getElementById("hud-worth"),
    round: document.getElementById("hud-round"),
    high: document.getElementById("hud-high"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlaySub: document.getElementById("overlay-sub"),
    overlayScore: document.getElementById("overlay-score"),
    primary: document.getElementById("btn-primary"),
    roll: document.getElementById("btn-roll"),
    buy: document.getElementById("btn-buy"),
    pass: document.getElementById("btn-pass"),
    pause: document.getElementById("btn-pause"),
    restart: document.getElementById("btn-restart"),
    decisionKicker: document.getElementById("decision-kicker"),
    decisionText: document.getElementById("decision-text"),
    decisionMeta: document.getElementById("decision-meta"),
    playerList: document.getElementById("player-list"),
    eventLog: document.getElementById("event-log"),
    powerups: document.getElementById("powerups"),
  };

  const COLORS = {
    bg: "#06110d",
    panel: "#111827",
    inner: "#17251c",
    ink: "#fbfaf4",
    muted: "#aab6c9",
    cream: "#fff2c2",
    navy: "#07111f",
    brown: "#5a331b",
    lawn: "#57d163",
    pink: "#ff2e88",
    cyan: "#2ee0ff",
    yellow: "#ffd43b",
    green: "#6bff7d",
    red: "#ff5c5c",
    orange: "#ff9f43",
    purple: "#b16cff",
  };

  const SPACE_TEMPLATES = [
    { type: "start", name: "Paid-Off Start", label: ["PAID-OFF", "START"], note: "Collect $200 when you pass." },
    { type: "property", name: "Split-Level Starter", label: ["SPLIT", "LEVEL"], group: COLORS.pink, cost: 120, rent: 18, upgrade: 60 },
    { type: "property", name: "Carpeted Den Duplex", label: ["CARPET", "DEN"], group: COLORS.pink, cost: 140, rent: 22, upgrade: 65 },
    { type: "card", name: "HOA Notice", label: ["HOA", "NOTICE"] },
    { type: "property", name: "Lake House Tax Shelter", label: ["LAKE", "HOUSE"], group: COLORS.cyan, cost: 180, rent: 28, upgrade: 75 },
    { type: "tax", name: "Property Tax Surprise", label: ["PROPERTY", "TAX"], amount: 95 },
    { type: "property", name: "Duplex Empire", label: ["DUPLEX", "EMPIRE"], group: COLORS.cyan, cost: 210, rent: 34, upgrade: 90 },
    { type: "bonus", name: "Early Bird Dinner", label: ["EARLY", "BIRD"], amount: 75 },
    { type: "property", name: "Boat Garage Ranch", label: ["BOAT", "GARAGE"], group: COLORS.yellow, cost: 230, rent: 38, upgrade: 105 },
    { type: "card", name: "Neighborhood App", label: ["NEIGHBOR", "APP"] },
    { type: "property", name: "Golf Cart Villas", label: ["GOLF", "VILLAS"], group: COLORS.yellow, cost: 260, rent: 44, upgrade: 115 },
    { type: "property", name: "Basement Rental Suite", label: ["BASEMENT", "SUITE"], group: COLORS.yellow, cost: 280, rent: 48, upgrade: 125 },
    { type: "tax", name: "Student Loan Lecture", label: ["LOAN", "LECTURE"], amount: 110 },
    { type: "property", name: "Cul-de-sac Castle", label: ["CUL-DE", "SAC"], group: COLORS.green, cost: 310, rent: 55, upgrade: 145 },
    { type: "bonus", name: "Garage Sale Flip", label: ["GARAGE", "SALE"], amount: 90 },
    { type: "property", name: "Timeshare Mirage", label: ["TIME", "SHARE"], group: COLORS.green, cost: 340, rent: 62, upgrade: 160 },
    { type: "card", name: "Cable News Card", label: ["CABLE", "NEWS"] },
    { type: "property", name: "Reverse Mortgage Row", label: ["REVERSE", "ROW"], group: COLORS.green, cost: 380, rent: 70, upgrade: 175 },
    { type: "skip", name: "Zoning Board", label: ["ZONING", "BOARD"] },
    { type: "property", name: "Airbnb Adjacent ADU", label: ["AIRBNB", "ADU"], group: COLORS.orange, cost: 420, rent: 82, upgrade: 190 },
    { type: "property", name: "Pickleball Preserve", label: ["PICKLE", "BALL"], group: COLORS.orange, cost: 455, rent: 90, upgrade: 210 },
    { type: "bonus", name: "Inheritance Rumor", label: ["INHERIT", "RUMOR"], amount: 130 },
    { type: "property", name: "Gated Community Gate", label: ["GATED", "GATE"], group: COLORS.purple, cost: 500, rent: 105, upgrade: 240 },
    { type: "card", name: "Market Mood", label: ["MARKET", "MOOD"] },
    { type: "property", name: "Pension Pointe", label: ["PENSION", "POINTE"], group: COLORS.purple, cost: 540, rent: 118, upgrade: 260 },
    { type: "market", name: "Rate Hike", label: ["RATE", "HIKE"], amount: -0.08 },
    { type: "property", name: "Legacy Lane", label: ["LEGACY", "LANE"], group: COLORS.purple, cost: 600, rent: 135, upgrade: 290 },
    { type: "market", name: "Market Rally", label: ["MARKET", "RALLY"], amount: 0.1 },
  ];

  const CARD_DECK = [
    { title: "Refinance Window", text: "A banker remembers your name.", cash: 140 },
    { title: "Avocado Toast Lecture", text: "You monologue so long you miss a payment.", cash: -65 },
    { title: "Inherited China Cabinet", text: "It appraises for more than expected.", cash: 85 },
    { title: "Property Tax Reassessment", text: "The county found your second bathroom.", cash: -125 },
    { title: "Zoning Variance", text: "One owned deed gets a free renovation.", upgrade: true },
    { title: "Hot Market", text: "Everyone agrees prices are normal and healthy.", heat: 0.08 },
    { title: "Rate Hike", text: "Buyers remember math exists.", heat: -0.07 },
    { title: "Basement Tenant", text: "A nephew needs a place. He pays in cash.", cash: 110 },
    { title: "Kids Move Back In", text: "The grocery bill becomes a boss fight.", cash: -105 },
    { title: "Yard Sign Fever", text: "Each rival pays you $35 for unsolicited advice.", collectFromAll: 35 },
  ];

  const TYPE_ICONS = {
    start: "🏡",
    property: "🏘",
    card: "📬",
    tax: "🧾",
    bonus: "🛒",
    skip: "⚖",
    market: "📈",
  };

  const PROPERTY_STAMPS = [
    "NO LOWBALLS",
    "CASH",
    "AS-IS",
    "BONES",
    "OPEN",
    "COSTCO",
    "HOA",
    "EQUITY",
  ];

  const HEADLINES = [
    "Local duplex described as 'starter home' at $780k.",
    "HOA bans clouds for lowering curb appeal.",
    "Gary says rates were 18% once, refuses all context.",
    "Neighborhood app reports suspicious teenager using sidewalk.",
    "Open house snacks downgraded to one warm grape.",
    "Barb calls every renovation 'a little facelift'.",
  ];

  const CASH_BITS = {
    buy: ["Deed folder thickens", "Another lawn joins the empire", "Escrow machine hums"],
    upgrade: ["Rent has entered its villain era", "Granite countertops deployed", "The garage became a studio"],
    rent: ["Rent extracted", "Mailbox money acquired", "Passive income noises"],
    bad: ["Wallet took structural damage", "Budget spreadsheet caught fire", "Liquidity left the chat"],
    good: ["Cash drawer did a cartwheel", "Coupon energy restored", "Found money in a windbreaker"],
  };

  const state = {
    board: [],
    players: [],
    current: 0,
    round: 1,
    dice: [1, 1],
    phase: "intro",
    pendingDecision: null,
    selectedSpace: 0,
    marketHeat: 0.05,
    paused: false,
    gameOver: false,
    busy: false,
    log: [],
    particles: [],
    callouts: [],
    headline: HEADLINES[0],
    shake: 0,
    actionPulse: 0,
    lastTime: 0,
    boardRects: [],
  };

  const CENTER_PANEL = { x: 120, y: 120, w: 480, h: 480 };

  const money = (amount) => {
    const sign = amount < 0 ? "-" : "";
    return `${sign}$${Math.abs(Math.round(amount)).toLocaleString()}`;
  };

  const choice = (items) => items[Math.floor(Math.random() * items.length)];

  function randomHeadline() {
    return choice(HEADLINES);
  }

  function spaceCenter(index) {
    const rect = state.boardRects[index];
    if (!rect) return { x: W / 2, y: H / 2 };
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  }

  function addImpact(spaceIndex, text, color, intensity = 1) {
    const pos = typeof spaceIndex === "number" ? spaceCenter(spaceIndex) : { x: W / 2, y: H / 2 };
    spawnParticles(pos.x, pos.y, color, 18 + Math.round(intensity * 8));
    spawnCallout(pos.x, pos.y - 18, text, color);
    state.shake = Math.max(state.shake, 0.18 * intensity);
    state.actionPulse = Math.max(state.actionPulse, 0.8);
  }

  function cloneBoard() {
    return SPACE_TEMPLATES.map((space, index) => ({
      ...space,
      index,
      owner: null,
      level: 0,
    }));
  }

  function makePlayers() {
    return [
      { id: "you", name: "You", color: COLORS.yellow, cash: 1500, pos: 0, skip: 0, bankrupt: false, rentShield: 0, isHuman: true },
      { id: "gary", name: "Gary", color: COLORS.cyan, cash: 1500, pos: 0, skip: 0, bankrupt: false, rentShield: 0, buyBias: 0.68 },
      { id: "linda", name: "Linda", color: COLORS.pink, cash: 1500, pos: 0, skip: 0, bankrupt: false, rentShield: 0, buyBias: 0.56 },
      { id: "barb", name: "Barb", color: COLORS.green, cash: 1500, pos: 0, skip: 0, bankrupt: false, rentShield: 0, buyBias: 0.74 },
    ];
  }

  function resetGame() {
    state.board = cloneBoard();
    state.players = makePlayers();
    state.current = 0;
    state.round = 1;
    state.dice = [1, 1];
    state.phase = "await_roll";
    state.pendingDecision = null;
    state.selectedSpace = 0;
    state.marketHeat = 0.05;
    state.paused = false;
    state.gameOver = false;
    state.busy = false;
    state.log = [];
    state.particles = [];
    state.callouts = [];
    state.headline = randomHeadline();
    state.shake = 0;
    state.actionPulse = 0;
    hideOverlay();
    log("You enter the market with $1,500 and unreasonable confidence.");
    beginTurn();
    renderPowerups();
    updateUI();
  }

  function activePlayer() {
    return state.players[state.current];
  }

  function humanPlayer() {
    return state.players[0];
  }

  function netWorth(player) {
    const deedValue = state.board.reduce((sum, space) => {
      if (space.owner !== player.id || space.type !== "property") return sum;
      const market = 1 + state.marketHeat;
      return sum + space.cost * market + space.level * space.upgrade * 0.75;
    }, 0);
    return Math.round(player.cash + deedValue);
  }

  function ownedSpaces(player) {
    return state.board.filter((space) => space.owner === player.id && space.type === "property");
  }

  function rentFor(space) {
    const heat = 1 + Math.max(-0.15, Math.min(0.35, state.marketHeat));
    return Math.max(8, Math.round(space.rent * (1 + space.level * 0.7) * heat));
  }

  function log(message) {
    state.log.unshift(message);
    state.log = state.log.slice(0, 8);
    if (Math.random() < 0.42) state.headline = randomHeadline();
  }

  function beginTurn() {
    if (state.gameOver) return;

    const player = activePlayer();
    state.pendingDecision = null;

    if (player.bankrupt) {
      nextTurn(350);
      return;
    }

    if (state.current === 0 && state.round > MAX_ROUNDS) {
      finishByWorth();
      return;
    }

    if (player.skip > 0) {
      player.skip -= 1;
      log(`${player.name} spends the turn arguing at the zoning board.`);
      nextTurn(player.isHuman ? 800 : 500);
      updateUI();
      return;
    }

    state.phase = player.isHuman ? "await_roll" : "ai_thinking";
    setDecision(
      player.isHuman ? "Your turn" : `${player.name}'s turn`,
      player.isHuman ? "Roll the dice and hope the market has not learned empathy." : `${player.name} is checking comps and pretending it is research.`,
      `Market heat: ${Math.round(state.marketHeat * 100)}%`
    );
    updateUI();

    if (!player.isHuman) {
      setTimeout(() => {
        if (!state.paused && !state.gameOver) rollForActive();
      }, 650);
    }
  }

  function nextTurn(delay = 650) {
    if (state.gameOver) return;
    state.pendingDecision = null;
    state.phase = "between_turns";
    updateUI();

    setTimeout(() => {
      if (state.gameOver) return;
      state.current = (state.current + 1) % state.players.length;
      if (state.current === 0) state.round += 1;
      beginTurn();
    }, delay);
  }

  function rollForActive() {
    const player = activePlayer();
    if (state.paused || state.gameOver || state.busy || player.bankrupt) return;
    if (player.isHuman && state.phase !== "await_roll") return;
    if (!player.isHuman && state.phase !== "ai_thinking") return;

    state.dice = [rollDie(), rollDie()];
    const steps = state.dice[0] + state.dice[1];
    state.busy = true;
    state.phase = "moving";
    setDecision("Rolling", `${player.name} rolled ${state.dice[0]} + ${state.dice[1]}.`, "Moving around the housing ladder.");
    updateUI();
    animateMove(player, steps, () => {
      state.busy = false;
      resolveSpace(player);
    });
  }

  function rollDie() {
    return 1 + Math.floor(Math.random() * 6);
  }

  function animateMove(player, steps, done) {
    let remaining = steps;
    const tick = () => {
      if (state.paused) {
        setTimeout(tick, 120);
        return;
      }

      player.pos = (player.pos + 1) % state.board.length;
      state.selectedSpace = player.pos;
      if (player.pos === 0) {
        player.cash += 200;
        spawnParticles(360, 360, COLORS.yellow, 16);
        log(`${player.name} passed Start and collected $200.`);
      }

      remaining -= 1;
      updateUI();

      if (remaining > 0) {
        setTimeout(tick, 150);
      } else {
        done();
      }
    };
    tick();
  }

  function resolveSpace(player) {
    const space = state.board[player.pos];
    state.selectedSpace = space.index;

    if (space.type === "property") {
      resolveProperty(player, space);
    } else if (space.type === "tax") {
      changeCash(player, -space.amount, `${player.name} paid ${money(space.amount)} for ${space.name}.`);
      afterResolved(player);
    } else if (space.type === "bonus") {
      changeCash(player, space.amount, `${player.name} gained ${money(space.amount)} from ${space.name}.`);
      afterResolved(player);
    } else if (space.type === "card") {
      drawCard(player);
      afterResolved(player);
    } else if (space.type === "skip") {
      player.skip += 1;
      log(`${player.name} got trapped at the zoning board and will miss the next turn.`);
      afterResolved(player);
    } else if (space.type === "market") {
      adjustMarket(space.amount);
      log(`${space.name}: market heat is now ${Math.round(state.marketHeat * 100)}%.`);
      afterResolved(player);
    } else {
      log(`${player.name} landed on ${space.name}. Nothing happens, which is suspicious.`);
      afterResolved(player);
    }

    updateUI();
  }

  function resolveProperty(player, space) {
    if (!space.owner) {
      const canAfford = player.cash >= space.cost;
      if (player.isHuman && canAfford) {
        state.pendingDecision = { type: "buy", playerId: player.id, spaceIndex: space.index };
        state.phase = "decision";
        setDecision(
          "Buy property?",
          `${space.name} costs ${money(space.cost)} and rents for ${money(rentFor(space))}.`,
          "Buy it now or pass and let another retiree haunt it later."
        );
        return;
      }

      if (!player.isHuman && canAfford && shouldAiBuy(player, space)) {
        buyProperty(player, space);
      } else {
        log(`${player.name} passed on ${space.name}. Bold. Possibly broke.`);
      }
      afterResolved(player);
      return;
    }

    if (space.owner === player.id) {
      const canUpgrade = space.level < 3 && player.cash >= space.upgrade;
      if (player.isHuman && canUpgrade) {
        state.pendingDecision = { type: "upgrade", playerId: player.id, spaceIndex: space.index };
        state.phase = "decision";
        setDecision(
          "Renovate?",
          `${space.name} is yours. Spend ${money(space.upgrade)} to raise rent to ${money(rentFor({ ...space, level: space.level + 1 }))}.`,
          `Current level: ${space.level}/3`
        );
        return;
      }

      if (!player.isHuman && canUpgrade && player.cash > 420 && Math.random() < 0.55) {
        upgradeProperty(player, space);
      } else {
        log(`${player.name} admires ${space.name} and calls it passive income.`);
      }
      afterResolved(player);
      return;
    }

    const owner = state.players.find((p) => p.id === space.owner);
    const rent = rentFor(space);

    if (player.rentShield > 0) {
      player.rentShield -= 1;
      log(`${player.name}'s Rent Shield blocked ${money(rent)} at ${space.name}.`);
      addImpact(space.index, "RENT BLOCKED", COLORS.cyan, 0.8);
    } else {
      player.cash -= rent;
      owner.cash += rent;
      log(`${player.name} paid ${owner.name} ${money(rent)} rent for ${space.name}.`);
      addImpact(space.index, choice(CASH_BITS.rent), owner.color, 1);
    }

    afterResolved(player);
  }

  function shouldAiBuy(player, space) {
    const reserve = 180 + state.round * 8;
    const appetite = player.buyBias + (space.rent / 220) - (space.cost / 2200);
    return player.cash - space.cost > reserve && Math.random() < appetite;
  }

  function buyProperty(player, space) {
    player.cash -= space.cost;
    space.owner = player.id;
    space.level = 0;
    log(`${player.name} bought ${space.name} for ${money(space.cost)}.`);
    addImpact(space.index, choice(CASH_BITS.buy), player.color, 1.1);
  }

  function upgradeProperty(player, space) {
    player.cash -= space.upgrade;
    space.level = Math.min(3, space.level + 1);
    log(`${player.name} renovated ${space.name} to level ${space.level}.`);
    addImpact(space.index, choice(CASH_BITS.upgrade), space.group, 1.1);
  }

  function acceptDecision() {
    const decision = state.pendingDecision;
    if (!decision || state.phase !== "decision") return;
    const player = state.players.find((p) => p.id === decision.playerId);
    const space = state.board[decision.spaceIndex];

    if (decision.type === "buy") {
      buyProperty(player, space);
    } else if (decision.type === "upgrade") {
      upgradeProperty(player, space);
    }

    state.pendingDecision = null;
    afterResolved(player);
  }

  function declineDecision() {
    const decision = state.pendingDecision;
    if (!decision || state.phase !== "decision") return;
    const player = state.players.find((p) => p.id === decision.playerId);
    const space = state.board[decision.spaceIndex];
    log(`${player.name} passed on ${decision.type === "buy" ? "buying" : "renovating"} ${space.name}.`);
    state.pendingDecision = null;
    afterResolved(player);
  }

  function changeCash(player, amount, message) {
    player.cash += amount;
    log(message);
    addImpact(player.pos, amount >= 0 ? choice(CASH_BITS.good) : choice(CASH_BITS.bad), amount >= 0 ? COLORS.green : COLORS.red, 0.85);
  }

  function drawCard(player) {
    const card = CARD_DECK[Math.floor(Math.random() * CARD_DECK.length)];
    let detail = "";

    if (card.cash) {
      player.cash += card.cash;
      detail = `${card.cash > 0 ? "+" : ""}${money(card.cash)}`;
    }

    if (card.heat) {
      adjustMarket(card.heat);
      detail = `market ${card.heat > 0 ? "+" : ""}${Math.round(card.heat * 100)}%`;
    }

    if (card.upgrade) {
      const target = ownedSpaces(player).filter((space) => space.level < 3).sort((a, b) => b.cost - a.cost)[0];
      if (target) {
        target.level += 1;
        detail = `${target.name} +1 level`;
      } else {
        player.cash += 75;
        detail = "+$75 consolation coupon";
      }
    }

    if (card.collectFromAll) {
      let collected = 0;
      for (const rival of state.players) {
        if (rival.id === player.id || rival.bankrupt) continue;
        rival.cash -= card.collectFromAll;
        player.cash += card.collectFromAll;
        collected += card.collectFromAll;
      }
      detail = `collected ${money(collected)}`;
    }

    log(`${card.title}: ${card.text} (${detail})`);
    addImpact(player.pos, card.title.toUpperCase(), COLORS.purple, 1);
  }

  function adjustMarket(delta) {
    state.marketHeat = Math.max(-0.15, Math.min(0.35, state.marketHeat + delta));
  }

  function afterResolved(player) {
    bankruptIfNeeded(player);
    updateUI();

    if (checkImmediateEnd()) return;

    if (player.isHuman) {
      setDecision(
        "Turn complete",
        `${player.name} ends the turn with ${money(player.cash)} cash and ${money(netWorth(player))} net worth.`,
        "AI players will move next."
      );
    }

    nextTurn(player.isHuman ? 900 : 550);
  }

  function bankruptIfNeeded(player) {
    if (player.cash >= 0 || player.bankrupt) return;
    player.bankrupt = true;
    log(`${player.name} went bankrupt. Their deeds return to the market.`);
    for (const space of state.board) {
      if (space.owner === player.id) {
        space.owner = null;
        space.level = 0;
      }
    }
  }

  function checkImmediateEnd() {
    const human = humanPlayer();
    if (human.bankrupt) {
      endGame(false, "BANKRUPT", "The housing ladder folded you into a tiny spreadsheet.");
      return true;
    }

    const activeAi = state.players.slice(1).filter((p) => !p.bankrupt);
    if (!activeAi.length) {
      endGame(true, "NEIGHBORHOOD OWNED", "Every rival has been financially converted into a cautionary tale.");
      return true;
    }

    return false;
  }

  function finishByWorth() {
    const ranked = [...state.players]
      .filter((player) => !player.bankrupt)
      .sort((a, b) => netWorth(b) - netWorth(a));
    const winner = ranked[0];
    const won = winner && winner.id === "you";
    endGame(
      won,
      won ? "GENERATIONAL WEALTH" : `${winner.name.toUpperCase()} WON`,
      won
        ? "You ended 16 rounds with the fattest deed folder."
        : `${winner.name} finished with ${money(netWorth(winner))}. The market has chosen chaos.`
    );
  }

  function endGame(won, title, subtitle) {
    state.gameOver = true;
    state.phase = "game_over";
    state.pendingDecision = null;
    const score = Math.max(0, netWorth(humanPlayer()) + ownedSpaces(humanPlayer()).length * 75 + (won ? 1000 : 0));
    api.recordScore(GAME_ID, score);
    const high = api.getHighScore(GAME_ID);
    showOverlay(
      won ? `🏆 ${title}` : `💸 ${title}`,
      subtitle,
      "Play again",
      `Score: <strong>${money(score)}</strong> · High: <strong>${money(high)}</strong> · Final worth: <strong>${money(netWorth(humanPlayer()))}</strong>`
    );
    updateUI();
  }

  function showOverlay(title, sub, button, score = "") {
    el.overlayTitle.textContent = title;
    el.overlaySub.innerHTML = sub;
    el.overlayScore.innerHTML = score;
    el.primary.textContent = button;
    el.overlay.classList.add("overlay--show");
  }

  function hideOverlay() {
    el.overlay.classList.remove("overlay--show");
  }

  function setDecision(kicker, text, meta) {
    el.decisionKicker.textContent = kicker;
    el.decisionText.textContent = text;
    el.decisionMeta.textContent = meta;
  }

  async function usePowerup(kind) {
    const player = humanPlayer();
    if (state.gameOver || state.phase === "intro" || state.busy) return;

    const ok = api.isAdFree() ? true : await api.showRewarded();
    if (!ok) return;

    if (kind === "heloc") {
      player.cash += 220;
      log("HELOC Cash: you borrowed against tomorrow and got $220 today.");
      api.toast("HELOC cash added", "good");
    } else if (kind === "zoning") {
      const target = ownedSpaces(player).filter((space) => space.level < 3).sort((a, b) => b.cost - a.cost)[0];
      if (target) {
        target.level += 1;
        log(`Zoning Variance: ${target.name} gained a free renovation.`);
        api.toast("Free renovation approved", "good");
      } else {
        player.cash += 90;
        log("Zoning Variance failed gracefully. You got a $90 filing refund.");
        api.toast("No deed yet, refund issued", "good");
      }
    } else if (kind === "shield") {
      player.rentShield += 1;
      log("Rent Shield armed: the next rent payment is blocked.");
      api.toast("Rent Shield armed", "good");
    }

    spawnParticles(360, 360, COLORS.cyan, 22);
    updateUI();
  }

  function renderPowerups() {
    el.powerups.innerHTML = `
      <button class="powerup" type="button" data-powerup="heloc">
        <span class="powerup__icon">💳</span><span class="powerup__label">HELOC Cash</span><span class="powerup__cost">AD</span>
      </button>
      <button class="powerup" type="button" data-powerup="zoning">
        <span class="powerup__icon">📋</span><span class="powerup__label">Zoning Variance</span><span class="powerup__cost">AD</span>
      </button>
      <button class="powerup" type="button" data-powerup="shield">
        <span class="powerup__icon">🛡</span><span class="powerup__label">Rent Shield</span><span class="powerup__cost">AD</span>
      </button>
    `;

    el.powerups.querySelectorAll("[data-powerup]").forEach((button) => {
      button.addEventListener("click", () => usePowerup(button.dataset.powerup));
    });
  }

  function updateUI() {
    const human = humanPlayer();
    el.cash.textContent = money(human.cash);
    el.worth.textContent = money(netWorth(human));
    el.round.textContent = `${Math.min(state.round, MAX_ROUNDS)}/${MAX_ROUNDS}`;
    el.high.textContent = money(api.getHighScore(GAME_ID));

    const decision = state.pendingDecision;
    const canRoll = !state.paused && !state.busy && !state.gameOver && state.phase === "await_roll" && activePlayer().isHuman;
    const canDecide = !state.paused && !state.busy && !state.gameOver && state.phase === "decision" && decision && decision.playerId === "you";

    el.roll.disabled = !canRoll;
    el.buy.disabled = !canDecide;
    el.pass.disabled = !canDecide;
    el.buy.textContent = decision?.type === "upgrade" ? "Renovate" : "Buy";
    el.pass.textContent = decision?.type === "upgrade" ? "Skip" : "Pass";
    el.pause.textContent = state.paused ? "Resume" : "Pause";

    renderPlayerList();
    renderLog();
  }

  function renderPlayerList() {
    el.playerList.innerHTML = state.players.map((player, index) => {
      const deeds = ownedSpaces(player).length;
      const status = player.bankrupt ? "Bankrupt" : `${money(player.cash)} cash`;
      const active = index === state.current && !state.gameOver ? " is-active" : "";
      return `
        <li class="boomer-player${active}">
          <span class="boomer-player__chip" style="background:${player.color}"></span>
          <span><strong>${player.name}</strong><span>${status}</span></span>
          <em>${money(netWorth(player))}<br>${deeds} deed${deeds === 1 ? "" : "s"}</em>
        </li>
      `;
    }).join("");
  }

  function renderLog() {
    el.eventLog.innerHTML = state.log.map((item) => `<li>${item}</li>`).join("");
  }

  function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 150;
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        age: 0,
        life: 0.45 + Math.random() * 0.5,
        size: 2 + Math.random() * 4,
        spin: Math.random() * Math.PI,
        shape: Math.random() < 0.28 ? "cash" : Math.random() < 0.58 ? "rect" : "dot",
      });
    }
  }

  function spawnCallout(x, y, text, color) {
    const pos = safeCalloutAnchor(x, y, text);
    state.callouts.push({
      x: pos.x,
      y: pos.y,
      text,
      color,
      age: 0,
      life: 0.82,
      vy: -24,
    });
  }

  function safeCalloutAnchor(x, y, text) {
    const width = calloutWidth(text);
    const edgePad = 34;
    const half = width / 2;
    const panelPad = 22;
    let nextX = Math.max(edgePad + half, Math.min(W - edgePad - half, x));
    let nextY = Math.max(edgePad + 20, Math.min(H - edgePad, y));
    const crossesPanelX = nextX + half > CENTER_PANEL.x + panelPad && nextX - half < CENTER_PANEL.x + CENTER_PANEL.w - panelPad;
    const crossesPanelY = nextY > CENTER_PANEL.y + 44 && nextY < CENTER_PANEL.y + CENTER_PANEL.h - 28;

    if (crossesPanelX && crossesPanelY) {
      nextY = y < H / 2 ? CENTER_PANEL.y - 24 : CENTER_PANEL.y + CENTER_PANEL.h + 28;
    }

    return {
      x: Math.max(edgePad + half, Math.min(W - edgePad - half, nextX)),
      y: Math.max(edgePad + 20, Math.min(H - edgePad, nextY)),
    };
  }

  function calloutWidth(text) {
    return Math.min(190, Math.max(72, text.length * 7.2));
  }

  function buildBoardRects() {
    const margin = 24;
    const cells = 8;
    const cell = (W - margin * 2) / cells;
    const rects = [];

    for (let col = 7; col >= 0; col -= 1) rects.push({ x: margin + col * cell, y: margin + 7 * cell, w: cell, h: cell });
    for (let row = 6; row >= 0; row -= 1) rects.push({ x: margin, y: margin + row * cell, w: cell, h: cell });
    for (let col = 1; col <= 7; col += 1) rects.push({ x: margin + col * cell, y: margin, w: cell, h: cell });
    for (let row = 1; row <= 6; row += 1) rects.push({ x: margin + 7 * cell, y: margin + row * cell, w: cell, h: cell });

    state.boardRects = rects;
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - state.lastTime) / 1000 || 0);
    state.lastTime = now;
    updateParticles(dt);
    draw(now);
    requestAnimationFrame(loop);
  }

  function updateParticles(dt) {
    state.shake = Math.max(0, state.shake - dt * 1.4);
    state.actionPulse = Math.max(0, state.actionPulse - dt * 2.2);

    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const p = state.particles[i];
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 80 * dt;
      if (p.age >= p.life) state.particles.splice(i, 1);
    }

    for (let i = state.callouts.length - 1; i >= 0; i -= 1) {
      const c = state.callouts[i];
      c.age += dt;
      c.y += c.vy * dt;
      if (c.age >= c.life) state.callouts.splice(i, 1);
    }
  }

  function draw(now) {
    ctx.clearRect(0, 0, W, H);
    drawBackground(now);

    ctx.save();
    if (state.shake > 0) {
      ctx.translate((Math.random() - 0.5) * state.shake * 12, (Math.random() - 0.5) * state.shake * 12);
    }

    drawGrid();
    drawParticles();
    drawCallouts();
    drawBoard(now);
    drawCenter(now);
    drawTokens(now);
    ctx.restore();

    if (state.paused && !state.gameOver) {
      ctx.fillStyle = "rgba(0,0,0,0.68)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = COLORS.ink;
      ctx.font = "bold 40px Bungee, Impact, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("PAUSED", W / 2, H / 2);
    }
  }

  function drawBackground(now) {
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#06111f");
    bg.addColorStop(0.4, "#12261b");
    bg.addColorStop(0.72, "#2a1a0d");
    bg.addColorStop(1, "#070812");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const t = now / 1000;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    for (let i = 0; i < 32; i += 1) {
      ctx.rotate((Math.PI * 2) / 32);
      ctx.fillStyle = i % 2 === 0 ? "rgba(255, 212, 59, 0.055)" : "rgba(46, 224, 255, 0.035)";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(520 + Math.sin(t + i) * 18, -12);
      ctx.lineTo(520 + Math.sin(t + i) * 18, 12);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    drawNeighborhood(now);
    drawMoneyRain(now);

    const vignette = ctx.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, 520);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.46)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  function drawNeighborhood(now) {
    ctx.save();
    ctx.globalAlpha = 0.42;
    for (let i = 0; i < 12; i += 1) {
      const x = 22 + i * 62 + Math.sin(now / 900 + i) * 4;
      const y = 80 + ((i * 37) % 120);
      drawTinyHouse(x, y, i % 3 === 0 ? COLORS.pink : i % 3 === 1 ? COLORS.cyan : COLORS.yellow, 0.72);
      drawTinyHouse(W - x - 40, H - y - 40, i % 2 === 0 ? COLORS.green : COLORS.orange, 0.62);
    }
    ctx.restore();
  }

  function drawMoneyRain(now) {
    ctx.save();
    ctx.font = "900 18px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < 18; i += 1) {
      const x = (i * 91 + (now / 36)) % (W + 80) - 40;
      const y = (i * 53 + (now / 24)) % (H + 80) - 40;
      ctx.globalAlpha = 0.14 + (i % 4) * 0.025;
      ctx.fillStyle = i % 2 === 0 ? COLORS.yellow : COLORS.green;
      ctx.fillText(i % 3 === 0 ? "$" : "¢", x, y);
    }
    ctx.restore();
  }

  function drawTinyHouse(x, y, color, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(22, 37, 30, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.cream;
    roundRect(4, 17, 36, 24, 5, true, false);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 20);
    ctx.lineTo(22, 3);
    ctx.lineTo(44, 20);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COLORS.navy;
    ctx.fillRect(18, 27, 8, 14);
    ctx.fillStyle = "rgba(46,224,255,0.7)";
    ctx.fillRect(8, 24, 7, 7);
    ctx.fillRect(30, 24, 7, 7);
    ctx.restore();
  }

  function drawCallouts() {
    for (const c of state.callouts) {
      const alpha = 1 - c.age / c.life;
      ctx.save();
      ctx.globalAlpha = alpha * 0.72;
      ctx.translate(c.x, c.y);
      ctx.fillStyle = "rgba(6, 8, 18, 0.62)";
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 1.5;
      const width = calloutWidth(c.text);
      roundRect(-width / 2, -16, width, 26, 8, true, true);
      ctx.fillStyle = c.color;
      ctx.font = "900 10px Bungee, Impact, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(c.text, 0, -2, width - 12);
      ctx.restore();
    }
  }

  function drawGrid() {
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = "rgba(46, 224, 255, 0.52)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 36) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += 36) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBoard(now) {
    for (const space of state.board) {
      const rect = state.boardRects[space.index];
      if (!rect) continue;
      drawSpace(space, rect, now);
    }
  }

  function drawSpace(space, rect, now) {
    const active = state.selectedSpace === space.index;
    const owner = state.players.find((player) => player.id === space.owner);
    const pad = 3;
    const x = rect.x + pad;
    const y = rect.y + pad;
    const w = rect.w - pad * 2;
    const h = rect.h - pad * 2;

    ctx.save();
    if (active) {
      ctx.shadowColor = COLORS.yellow;
      ctx.shadowBlur = 18 + Math.sin(now / 110) * 6;
    }

    const tileGrad = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
    if (space.type === "property") {
      tileGrad.addColorStop(0, "#fff9de");
      tileGrad.addColorStop(0.64, "#f6e7b6");
      tileGrad.addColorStop(1, "#dac58d");
    } else {
      tileGrad.addColorStop(0, specialColor(space.type));
      tileGrad.addColorStop(1, "#080b14");
    }

    ctx.fillStyle = tileGrad;
    ctx.strokeStyle = active ? COLORS.yellow : "rgba(5,7,13,0.88)";
    ctx.lineWidth = active ? 4 : 2;
    roundRect(x, y, w, h, 8, true, true);
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(255,255,255,0.13)";
    ctx.fillRect(x + 5, y + 5, w - 10, 2);

    if (space.type === "property") {
      ctx.fillStyle = space.group;
      roundRect(x + 5, y + 5, w - 10, 15, 5, true, false);
      if (owner) {
        ctx.fillStyle = owner.color;
        roundRect(x + 7, y + h - 17, w - 14, 12, 5, true, false);
      }
    }

    if (active) {
      ctx.strokeStyle = `rgba(255, 212, 59, ${0.45 + Math.sin(now / 120) * 0.18})`;
      ctx.lineWidth = 7;
      roundRect(x + 5, y + 5, w - 10, h - 10, 9, false, true);
    }

    ctx.fillStyle = space.type === "property" ? "#111827" : "#fbfaf4";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 13px JetBrains Mono, monospace";
    const lines = space.label || [space.name];
    lines.slice(0, 2).forEach((line, i) => {
      ctx.fillText(line, rect.x + rect.w / 2, rect.y + 31 + i * 16, rect.w - 12);
    });

    ctx.font = "900 11px JetBrains Mono, monospace";
    if (space.type === "property") {
      ctx.fillStyle = "#17251c";
      ctx.fillText(money(space.cost), rect.x + rect.w / 2, rect.y + rect.h - 27, rect.w - 10);
      if (space.level > 0) {
        drawLevelHomes(rect.x + rect.w / 2, rect.y + rect.h - 9, space.level, space.group);
      } else {
        ctx.fillStyle = "rgba(17,24,39,0.5)";
        ctx.font = "900 8px JetBrains Mono, monospace";
        ctx.fillText(shortStamp(space.index), rect.x + rect.w / 2, rect.y + rect.h - 9, rect.w - 18);
      }
    } else {
      ctx.font = "900 16px Inter, sans-serif";
      ctx.fillText(TYPE_ICONS[space.type] || "•", rect.x + rect.w / 2, rect.y + rect.h - 29, rect.w - 10);
      ctx.font = "900 10px JetBrains Mono, monospace";
      ctx.fillText(spaceIcon(space), rect.x + rect.w / 2, rect.y + rect.h - 11, rect.w - 10);
    }

    ctx.restore();
  }

  function drawLevelHomes(cx, y, level, color) {
    const total = level;
    const startX = cx - (total - 1) * 8;
    for (let i = 0; i < total; i += 1) {
      const x = startX + i * 16;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - 6, y - 2);
      ctx.lineTo(x, y - 9);
      ctx.lineTo(x + 6, y - 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(x - 5, y - 2, 10, 7);
    }
  }

  function specialColor(type) {
    if (type === "start") return "#214d33";
    if (type === "card") return "#30204a";
    if (type === "tax") return "#4a2020";
    if (type === "bonus") return "#4a3b16";
    if (type === "skip") return "#1d3557";
    if (type === "market") return "#203b42";
    return "#17251c";
  }

  function spaceIcon(space) {
    if (space.type === "start") return "+$200";
    if (space.type === "card") return "CARD";
    if (space.type === "tax") return `-${money(space.amount)}`;
    if (space.type === "bonus") return `+${money(space.amount)}`;
    if (space.type === "skip") return "SKIP";
    if (space.type === "market") return `${space.amount > 0 ? "+" : ""}${Math.round(space.amount * 100)}%`;
    return "";
  }

  function shortStamp(index) {
    return PROPERTY_STAMPS[index % PROPERTY_STAMPS.length];
  }

  function drawCenter(now) {
    const x = 120;
    const y = 120;
    const w = 480;
    const h = 480;
    const human = humanPlayer();
    const heatPercent = Math.round(state.marketHeat * 100);
    const currentSpace = state.board[human.pos] || state.board[0];
    const pulse = state.actionPulse;

    ctx.save();
    ctx.shadowColor = state.marketHeat >= 0.2 ? COLORS.pink : COLORS.cyan;
    ctx.shadowBlur = 20 + pulse * 18;
    const centerGrad = ctx.createLinearGradient(x, y, x + w, y + h);
    centerGrad.addColorStop(0, "rgba(10, 18, 28, 0.96)");
    centerGrad.addColorStop(0.48, "rgba(22, 37, 28, 0.97)");
    centerGrad.addColorStop(1, "rgba(44, 24, 10, 0.96)");
    ctx.fillStyle = centerGrad;
    ctx.strokeStyle = state.marketHeat >= 0 ? COLORS.yellow : COLORS.cyan;
    ctx.lineWidth = 4;
    roundRect(x, y, w, h, 16, true, true);
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(255, 212, 59, 0.08)";
    ctx.fillRect(x + 18, y + 18, w - 36, 3);

    ctx.fillStyle = COLORS.yellow;
    ctx.shadowColor = "rgba(255, 212, 59, 0.45)";
    ctx.shadowBlur = 12;
    ctx.font = "bold 38px Bungee, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("BOOMER", x + w / 2, y + 34);
    ctx.fillStyle = COLORS.cyan;
    ctx.fillText("MONOPOLY", x + w / 2, y + 74);
    ctx.shadowBlur = 0;

    ctx.fillStyle = COLORS.cream;
    ctx.font = "900 12px JetBrains Mono, monospace";
    ctx.fillText("BUY LOW · RENT FOREVER · EXPLAIN 1983", x + w / 2, y + 125);

    ctx.fillStyle = "rgba(255, 46, 136, 0.16)";
    roundRect(x + 62, y + 146, w - 124, 28, 8, true, false);
    ctx.fillStyle = COLORS.pink;
    ctx.font = "900 11px JetBrains Mono, monospace";
    ctx.fillText(`NEWS: ${state.headline}`, x + w / 2, y + 160, w - 146);

    drawDice(x + w / 2 - 68, y + 194, state.dice[0]);
    drawDice(x + w / 2 + 16, y + 194, state.dice[1]);

    ctx.fillStyle = "rgba(7, 17, 31, 0.86)";
    ctx.strokeStyle = "rgba(46, 224, 255, 0.34)";
    roundRect(x + 44, y + 278, w - 88, 90, 12, true, true);
    ctx.fillStyle = COLORS.ink;
    ctx.font = "900 15px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`Net worth: ${money(netWorth(human))}`, x + 62, y + 303);
    ctx.fillStyle = COLORS.muted;
    ctx.font = "700 12px JetBrains Mono, monospace";
    ctx.fillText(`Deeds: ${ownedSpaces(human).length}   Shield: ${human.rentShield}`, x + 62, y + 329);
    ctx.fillStyle = COLORS.yellow;
    ctx.fillText(`Current tile: ${currentSpace.name}`, x + 62, y + 351, w - 124);

    ctx.fillStyle = COLORS.muted;
    ctx.fillText(`Market heat ${heatPercent > 0 ? "+" : ""}${heatPercent}%`, x + 62, y + 400);
    ctx.fillStyle = "#08100c";
    roundRect(x + 62, y + 414, w - 124, 16, 8, true, false);
    ctx.fillStyle = state.marketHeat >= 0 ? COLORS.green : COLORS.red;
    const marker = ((state.marketHeat + 0.15) / 0.5) * (w - 124);
    roundRect(x + 62, y + 414, Math.max(8, marker), 16, 8, true, false);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    roundRect(x + 62, y + 414, w - 124, 16, 8, false, true);

    ctx.fillStyle = COLORS.muted;
    ctx.font = "700 11px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    const active = activePlayer();
    const action = state.gameOver ? "Game over" : state.paused ? "Paused" : `${active.name}'s turn`;
    ctx.fillText(`${action} · Round ${Math.min(state.round, MAX_ROUNDS)}/${MAX_ROUNDS}`, x + w / 2, y + 452);

    if (state.phase === "await_roll") {
      ctx.globalAlpha = 0.8 + Math.sin(now / 180) * 0.18;
      ctx.fillStyle = COLORS.yellow;
      ctx.font = "bold 17px Bungee, Impact, sans-serif";
      ctx.fillText("ROLL FOR EQUITY", x + w / 2, y + 254);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function drawDice(x, y, value) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    const grad = ctx.createLinearGradient(x, y, x + 52, y + 52);
    grad.addColorStop(0, "#fff7d6");
    grad.addColorStop(1, "#ffd43b");
    ctx.fillStyle = grad;
    ctx.strokeStyle = "#05070d";
    ctx.lineWidth = 4;
    roundRect(x, y, 52, 52, 10, true, true);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = COLORS.bg;
    const dots = diceDots(value);
    for (const dot of dots) {
      ctx.beginPath();
      ctx.arc(x + dot[0], y + dot[1], 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function diceDots(value) {
    const a = 14;
    const b = 26;
    const c = 38;
    const dots = {
      1: [[b, b]],
      2: [[a, a], [c, c]],
      3: [[a, a], [b, b], [c, c]],
      4: [[a, a], [c, a], [a, c], [c, c]],
      5: [[a, a], [c, a], [b, b], [a, c], [c, c]],
      6: [[a, a], [c, a], [a, b], [c, b], [a, c], [c, c]],
    };
    return dots[value] || dots[1];
  }

  function drawTokens(now) {
    const grouped = new Map();
    for (const player of state.players) {
      if (player.bankrupt) continue;
      if (!grouped.has(player.pos)) grouped.set(player.pos, []);
      grouped.get(player.pos).push(player);
    }

    for (const [spaceIndex, players] of grouped.entries()) {
      const rect = state.boardRects[spaceIndex];
      if (!rect) continue;
      players.forEach((player, i) => {
        const pos = tokenPosition(rect, i, players.length, now);
        const cx = pos.x;
        const cy = pos.y;
        const size = players.length > 2 ? 7.5 : 8.5;
        ctx.save();
        ctx.shadowColor = player.color;
        ctx.shadowBlur = player.isHuman ? 12 : 7;
        ctx.fillStyle = player.color;
        ctx.strokeStyle = "#05070d";
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(cx, cy, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = COLORS.bg;
        ctx.font = "900 8px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(player.name[0].toUpperCase(), cx, cy + 0.5);
        ctx.restore();
      });
    }
  }

  function tokenPosition(rect, index, total, now) {
    const chip = total > 2 ? 7.5 : 8.5;
    const spacing = total > 2 ? 13 : 15;
    const visible = Math.min(total, 4);
    const rowIndex = index % visible;
    const totalWidth = (visible - 1) * spacing;
    const baseX = rect.x + rect.w - chip - 7 - totalWidth + rowIndex * spacing;
    const baseY = rect.y + 16 + Math.sin(now / 220 + index) * 0.8;

    return {
      x: Math.max(rect.x + chip + 6, Math.min(rect.x + rect.w - chip - 6, baseX)),
      y: Math.max(rect.y + chip + 4, Math.min(rect.y + 24, baseY)),
    };
  }

  function drawParticles() {
    for (const p of state.particles) {
      const alpha = 1 - p.age / p.life;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin + p.age * 8);
      if (p.shape === "cash") {
        ctx.font = "900 13px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("$", 0, 0);
      } else if (p.shape === "rect") {
        ctx.fillRect(-p.size, -p.size * 0.65, p.size * 2.2, p.size * 1.3);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function roundRect(x, y, w, h, r, fill, stroke) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  function togglePause() {
    if (state.gameOver || state.phase === "intro") return;
    state.paused = !state.paused;
    if (!state.paused && state.phase === "ai_thinking" && !activePlayer().isHuman) {
      setTimeout(() => {
        if (!state.paused && !state.gameOver && state.phase === "ai_thinking") rollForActive();
      }, 350);
    }
    updateUI();
  }

  function handlePrimary() {
    resetGame();
  }

  function bindEvents() {
    el.primary.addEventListener("click", handlePrimary);
    el.roll.addEventListener("click", rollForActive);
    el.buy.addEventListener("click", acceptDecision);
    el.pass.addEventListener("click", declineDecision);
    el.pause.addEventListener("click", togglePause);
    el.restart.addEventListener("click", resetGame);
    canvas.addEventListener("click", () => {
      if (state.phase === "await_roll") rollForActive();
    });

    document.addEventListener("keydown", (event) => {
      if (event.target && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
      if (event.code === "Space" || event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (el.overlay.classList.contains("overlay--show")) resetGame();
        else rollForActive();
      } else if (event.key.toLowerCase() === "b") {
        acceptDecision();
      } else if (event.key.toLowerCase() === "p") {
        declineDecision();
      }
    });
  }

  state.board = cloneBoard();
  state.players = makePlayers();
  buildBoardRects();
  renderPowerups();
  bindEvents();
  updateUI();
  requestAnimationFrame(loop);

  window.__BOOMER = {
    state,
    reset: resetGame,
    roll: rollForActive,
    buy: acceptDecision,
    pass: declineDecision,
    human: humanPlayer,
    active: activePlayer,
  };
})();
