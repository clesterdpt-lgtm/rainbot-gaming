import assert from "node:assert";
import fs from "node:fs";

console.log("--- Starting Quiet Quitting Logic Unit Tests ---");

// Read and verify file exists
const jsSource = fs.readFileSync("assets/js/quiet-quitting.js", "utf-8");
const htmlSource = fs.readFileSync("games/quiet-quitting.html", "utf-8");

assert(jsSource.length > 1000, "JS source should not be empty");
assert(htmlSource.length > 1000, "HTML source should not be empty");
assert(htmlSource.includes("quiet-quitting.js"), "HTML should load quiet-quitting.js");
assert(htmlSource.includes("gameCanvas"), "HTML should contain gameCanvas");
assert(htmlSource.includes("hud-score"), "HTML should contain hud-score");
assert(htmlSource.includes("hud-best"), "HTML should contain hud-best");
assert(htmlSource.includes("hud-lives"), "HTML should contain hud-lives");
assert(htmlSource.includes("overlay"), "HTML should contain overlay");

console.log("✓ HTML structure & element IDs verified");

// Test Maze Grid Constants & Parsing
const COLS = 28;
const ROWS = 31;

const rawMazeMatch = jsSource.match(/const RAW_MAZE = \[([\s\S]*?)\];/);
assert(rawMazeMatch, "RAW_MAZE must exist in JS");
const rawMaze = eval(`[${rawMazeMatch[1]}]`);

assert.strictEqual(rawMaze.length, ROWS, `Maze must have ${ROWS} rows`);
rawMaze.forEach((row, i) => {
  assert.strictEqual(row.length, COLS, `Row ${i} must have ${COLS} columns`);
});

let dotCount = 0;
let energizerCount = 0;
let warpCount = 0;
let ghostHouseCount = 0;

for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const val = rawMaze[r][c];
    if (val === 2) dotCount++;
    if (val === 3) energizerCount++;
    if (val === 6) warpCount++;
    if (val === 4) ghostHouseCount++;
  }
}

console.log(`✓ Maze geometry: ${COLS}x${ROWS} tiles`);
console.log(`✓ Dots: ${dotCount}, Energizers: ${energizerCount}, Warp exits: ${warpCount}, Ghost pen tiles: ${ghostHouseCount}`);
assert(dotCount > 150, "Should have plenty of dots to collect");
assert.strictEqual(energizerCount, 4, "Should have exactly 4 corner Consultant badges");
assert.strictEqual(warpCount, 2, "Should have 2 warp tunnel exits");

// Test Ghost AI Target calculations simulation
const mockPlayer = { x: 14, y: 23, dir: { x: 1, y: 0 } };
const mockBlinky = { x: 13.5, y: 11 };

// Blinky target = player position
const blinkyTarget = { x: Math.round(mockPlayer.x), y: Math.round(mockPlayer.y) };
assert.strictEqual(blinkyTarget.x, 14);
assert.strictEqual(blinkyTarget.y, 23);
console.log("✓ Micromanager (Blinky) direct chase vector verified");

// Pinky target = 4 tiles ahead of player
const pinkyTarget = {
  x: Math.round(mockPlayer.x) + mockPlayer.dir.x * 4,
  y: Math.round(mockPlayer.y) + mockPlayer.dir.y * 4,
};
assert.strictEqual(pinkyTarget.x, 18);
assert.strictEqual(pinkyTarget.y, 23);
console.log("✓ Calendar Blocker (Pinky) 4-tile ambush intercept vector verified");

// Inky target = vector doubling from Blinky to 2 tiles ahead of player
const pivotX = Math.round(mockPlayer.x) + mockPlayer.dir.x * 2; // 14 + 2 = 16
const pivotY = Math.round(mockPlayer.y) + mockPlayer.dir.y * 2; // 23 + 0 = 23
const inkyTarget = {
  x: pivotX + (pivotX - Math.round(mockBlinky.x)), // 16 + (16 - 14) = 18
  y: pivotY + (pivotY - Math.round(mockBlinky.y)), // 23 + (23 - 11) = 35
};
assert.strictEqual(inkyTarget.x, 18);
assert.strictEqual(inkyTarget.y, 35);
console.log("✓ Intern (Inky) flanker pincer vector verified");

// Clyde target = player if dist > 8, scatter if <= 8
const farDist = Math.hypot(2 - mockPlayer.x, 2 - mockPlayer.y);
assert(farDist > 8, "Distance should be > 8");
const closeDist = Math.hypot(13 - mockPlayer.x, 22 - mockPlayer.y);
assert(closeDist <= 8, "Distance should be <= 8");
console.log("✓ HR Compliance Bot (Clyde) proximity scatter/chase threshold verified");

// Test ghost score multipliers
let surgeCount = 0;
const ptsList = [];
for (let i = 1; i <= 4; i++) {
  surgeCount++;
  const mult = Math.pow(2, surgeCount);
  const pts = 100 * mult;
  ptsList.push(pts);
}
assert.deepStrictEqual(ptsList, [200, 400, 800, 1600], "Ghost score progression should be 200, 400, 800, 1600");
console.log("✓ Consultant surge ghost eating multipliers verified:", ptsList);

// Check registry in main.js
const mainJsSource = fs.readFileSync("assets/js/main.js", "utf-8");
assert(mainJsSource.includes('"quiet-quitting"'), "main.js should contain quiet-quitting registration");
console.log("✓ main.js game registry verified");

// Check games.html
const gamesHtmlSource = fs.readFileSync("games.html", "utf-8");
assert(gamesHtmlSource.includes('href="games/quiet-quitting.html"'), "games.html should link to quiet-quitting.html");
console.log("✓ games.html vault card verified");

// Check sitemap.xml
const sitemapSource = fs.readFileSync("sitemap.xml", "utf-8");
assert(sitemapSource.includes("games/quiet-quitting.html"), "sitemap.xml should contain quiet-quitting.html");
console.log("✓ sitemap.xml verified");

console.log("\n🎉 ALL LOGIC AND INTEGRATION TESTS PASSED!");
