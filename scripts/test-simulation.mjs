import fs from "node:fs";

class MockCanvasContext {
  constructor() {
    this.fillStyle = "";
    this.strokeStyle = "";
    this.lineWidth = 1;
    this.shadowColor = "";
    this.shadowBlur = 0;
    this.font = "";
    this.textAlign = "";
    this.textBaseline = "";
    this.globalAlpha = 1.0;
  }
  clearRect() {}
  fillRect() {}
  strokeRect() {}
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  arc() {}
  quadraticCurveTo() {}
  fill() {}
  stroke() {}
  save() {}
  restore() {}
  translate() {}
  rotate() {}
  fillText() {}
}

const mockDoc = {
  readyState: "complete",
  getElementById: (id) => {
    return {
      getContext: () => new MockCanvasContext(),
      classList: { add: () => {}, remove: () => {}, contains: () => false },
      addEventListener: () => {},
      prepend: () => {},
      removeChild: () => {},
      children: [],
      setAttribute: () => {},
      width: 672,
      height: 744
    };
  },
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: () => ({ className: "", innerHTML: "", setAttribute: () => {} })
};

global.document = mockDoc;
global.window = {
  addEventListener: () => {},
  AudioContext: null,
  webkitAudioContext: null,
  localStorage: { getItem: () => null, setItem: () => {} },
  requestAnimationFrame: () => {}
};
global.localStorage = global.window.localStorage;
global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
global.performance = { now: () => Date.now() };

const code = fs.readFileSync("assets/js/quiet-quitting.js", "utf8");

try {
  eval(code);
  console.log("✓ Evaluated quiet-quitting.js without syntax or evaluation errors.");

  // Test game instantiation
  const game = window.quietQuittingGame;
  console.log("Game state initially:", game.state);

  // Click start game
  game.startNewGame();
  console.log("Game state after startNewGame:", game.state);
  console.log("Player position:", game.player.x, game.player.y);
  console.log("Ghosts count:", game.ghosts.length);

  // Simulate 300 game ticks
  for (let frame = 0; frame < 300; frame++) {
    game.update(0.016);
    game.render();

    // Turn player
    if (frame === 10) game.player.setNextDir({ x: -1, y: 0, name: "LEFT" });
    if (frame === 50) game.player.setNextDir({ x: 0, y: -1, name: "UP" });
    if (frame === 100) game.triggerConsultantMode();
  }

  console.log("✓ Successfully simulated 300 frames of gameplay, AI targeting, consultant mode, and rendering without any errors!");
  console.log("Final score:", game.score, "Dots left:", game.dotsLeft, "Mode:", game.state);
} catch (e) {
  console.error("Simulation error:", e);
  process.exit(1);
}
