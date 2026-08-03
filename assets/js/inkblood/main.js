/* ============================================================
   INKBLOOD — main.js
   Entry point. Waits for the display fonts (the katakana impact
   lettering is baked into sprites and panels, so booting before
   the font resolves would ink the whole game in a fallback face),
   builds the game, and installs the debug hook.
   ============================================================ */

"use strict";

import { Game } from "./game.js";

const GAME_ID = "inkblood";

async function waitForFonts(boot) {
  if (!document.fonts) return;
  const wanted = [
    '900 64px "Noto Sans JP"',
    '64px "Anton"',
    '64px "Bebas Neue"',
  ];
  try {
    await Promise.race([
      Promise.all(wanted.map((f) => document.fonts.load(f, "血墨 INKBLOOD 0123"))),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  } catch (e) {
    if (boot) boot.progress(0.02, "Fonts unavailable — using fallbacks");
  }
}

function scoreApi() {
  const rb = window.RB;
  if (rb && typeof rb.recordScore === "function") return rb;
  // Standalone fallback so a local high score still survives a reload.
  return {
    recordScore(id, score) {
      try {
        const key = `rb_score_${id}`;
        const prev = Number(localStorage.getItem(key) || 0);
        if (score > prev) { localStorage.setItem(key, String(score)); return true; }
      } catch (e) { /* private mode */ }
      return false;
    },
    getHighScore(id) {
      try { return Number(localStorage.getItem(`rb_score_${id}`) || 0); } catch (e) { return 0; }
    },
  };
}

export async function start({ boot } = {}) {
  const progress = (p, label) => boot && boot.progress(p, label);

  progress(0.02, "Loading lettering");
  await waitForFonts(boot);

  const canvas = document.getElementById("ink-canvas");
  if (!canvas) throw new Error("canvas #ink-canvas is missing");

  const game = new Game(canvas);
  await game.load((p, label) => progress(0.05 + p * 0.93, label));

  const api = scoreApi();
  game.bestScore = api.getHighScore(GAME_ID);
  game.onScore = (score) => {
    const isBest = api.recordScore(GAME_ID, score);
    game.bestScore = Math.max(game.bestScore || 0, score);
    if (isBest && api.toast) api.toast(`New best: ${score.toLocaleString()}`, "good");
  };

  progress(1, "Ready");
  if (boot) boot.hide();
  game.start();

  installDebug(game);
  return game;
}

/* ---------------------------------------------------------- */
/* Debug hook                                                  */
/* ---------------------------------------------------------- */

function installDebug(game) {
  /**
   * `sim` is the important one. The screenshot harness runs in a
   * headless browser where requestAnimationFrame is throttled to
   * roughly 1fps, so waiting real seconds for the game to reach an
   * interesting state does not work. This advances the simulation
   * with a fixed step and no rendering, then the harness forces a
   * single real frame and captures it.
   */
  const hook = {
    ready: true,
    game,
    get phase() { return game.phase; },
    get stats() {
      return {
        fps: Math.round(game.fps),
        enemies: game.enemies.length,
        projectiles: game.projectiles.length,
        pickups: game.pickups.length,
        decals: game.fx.decals.length,
        time: game.time,
        level: game.player && game.player.level,
        hp: game.player && Math.round(game.player.hp),
        kills: game.kills,
      };
    },

    /**
     * Advance the simulation without rendering. `kite` drives the
     * input on a slow orbit so the player behaves roughly like
     * someone playing, instead of standing still and being eaten —
     * which is what every screenshot showed before.
     */
    sim(seconds, step = 1 / 60, kite = true) {
      const n = Math.ceil(seconds / step);
      for (let i = 0; i < n; i++) {
        if (kite && game.phase === "playing") {
          // Steer away from the nearest bodies and drift otherwise.
          // A fixed circular path walks straight back into the horde
          // every lap, which made every capture a death screen.
          const p2 = game.player;
          let ax = 0;
          let ay = 0;
          const near = game.nearestEnemies(p2.x, p2.y, 260, 6);
          for (const e of near) {
            const dx = p2.x - e.x;
            const dy = p2.y - e.y;
            const d = Math.hypot(dx, dy) || 1;
            ax += (dx / d) * (260 - d) / 260;
            ay += (dy / d) * (260 - d) / 260;
          }
          const t = game.time * 0.4;
          ax += Math.cos(t) * 0.55;
          ay += Math.sin(t * 0.9) * 0.4;
          const l = Math.hypot(ax, ay) || 1;
          game.input.x = ax / l;
          game.input.y = ay / l;
          game.input.update = () => {};
        }
        game.step(step);
        // A level-up freezes the clock. Take a choice and carry on,
        // otherwise sim(300) advances four seconds and then stalls.
        let guard = 0;
        while (game.phase === "levelup" && guard++ < 20) {
          game.selected = (Math.random() * game.choices.length) | 0;
          game.takeChoice();
        }
      }
      return hook.stats;
    },

    newRun() { game.audio.init(); game.newRun(); return hook.stats; },
    god(on = true) {
      // Has to go through baseStats: recomputeStats() rebuilds
      // `stats` from baseStats on every level-up, which silently
      // undid god mode a few seconds after it was switched on.
      game.baseStats.armor = on ? 99999 : 0;
      game.baseStats.maxHp = on ? 99999 : 120;
      game.recomputeStats();
      game.player.hp = game.player.maxHp;
    },
    give(id, level = 1) {
      const w = game.weapons.find((x) => x.id === id) || game.addWeapon(id);
      w.level = level;
      game.recomputeStats();
    },
    givePassive(id, level = 1) {
      const p = game.passives.find((x) => x.id === id) || game.addPassive(id);
      p.level = level;
      game.recomputeStats();
    },
    levelUp() { game.gainXp(game.player.xpNeed); },
    spawn(type, n = 20, radius = 420) {
      const curve = game.director.curve(game.time);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
        const r = radius * (0.5 + Math.random() * 0.6);
        game.spawnEnemy(type, game.player.x + Math.cos(a) * r, game.player.y + Math.sin(a) * r * 0.8, curve);
      }
      return game.enemies.length;
    },
    boss(type = "gashadokuro") { game.spawnBoss(type, game.director.bossCurve(game.time)); },
    skipTo(seconds) {
      game.time = seconds;
      for (let i = 0; i < game.director.firedEvents.size + 40; i++) { /* no-op guard */ }
    },
    kill() { game.player.hp = 1; game.hurtPlayer(9999, 0); },
    win() { game.win(); },
    setFocus(v) { game.fx.focusTarget = v; },
    toggleStats() { game.showStats = !game.showStats; },

    /** Named states for the screenshot harness. */
    async shotStep(name, arg) {
      switch (name) {
        case "title":
          game.phase = "title";
          game.posterMode = false;
          break;
        case "poster":
          game.phase = "title";
          game.posterMode = true;   // no control hints in cover art
          break;
        case "play":
          hook.newRun();
          hook.sim(Number(arg) || 26);
          break;
        case "swarm":
          hook.newRun();
          hook.god(true);
          hook.give("crimsonArc", 6);
          hook.give("kunai", 5);
          hook.give("crows", 5);
          hook.give("oniAura", 5);
          hook.givePassive("reach", 4);
          hook.sim(6);
          hook.spawn("gaki", 90, 520);
          hook.spawn("kamaitachi", 30, 640);
          hook.spawn("tsukumo", 40, 460);
          hook.sim(2.4);
          break;
        case "carnage":
          hook.newRun();
          hook.god(true);
          hook.give("requiem", 1);
          hook.give("nailStorm", 1);
          hook.give("murder", 1);
          hook.give("mandala", 1);
          hook.give("redBloom", 1);
          hook.givePassive("reach", 5);
          hook.givePassive("might", 5);
          hook.sim(4);
          hook.spawn("gaki", 120, 560);
          hook.spawn("mukade", 40, 600);
          hook.spawn("yurei", 30, 500);
          hook.sim(1.6);
          hook.sim(0.8);
          // Drain any level-ups so the capture shows the fight, not
          // the choice screen sitting on top of it.
          while (game.phase === "levelup") game.takeChoice();
          break;
        case "levelup":
          hook.newRun();
          hook.sim(4);
          hook.spawn("gaki", 40, 420);
          hook.sim(2);
          game.gainXp(9999);
          break;
        case "boss":
          hook.newRun();
          hook.god(true);
          hook.give("crimsonArc", 5);
          hook.sim(3);
          hook.spawn("gaki", 40, 520);
          hook.boss(arg || "gashadokuro");
          hook.sim(0.5);
          break;
        case "bossfight":
          hook.newRun();
          hook.god(true);
          hook.give("crimsonArc", 8);
          hook.give("raijin", 6);
          hook.sim(3);
          hook.boss(arg || "oni");
          // Bosses walk in from the spawn ring; four seconds is not
          // enough for one to reach the player and the shot comes
          // back empty.
          hook.sim(14);
          while (game.phase === "levelup") game.takeChoice();
          break;
        case "death":
          hook.newRun();
          hook.sim(4);
          hook.kill();
          hook.sim(2.2);
          break;
        case "win":
          hook.newRun();
          hook.sim(3);
          game.kills = 1842;
          game.coins = 640;
          game.time = 900;
          game.win();
          hook.sim(2.2);
          break;
        case "pause":
          hook.newRun();
          hook.sim(8);
          game.phase = "paused";
          break;
        default:
          break;
      }
      return hook.stats;
    },
  };
  window.__INK = hook;
}
