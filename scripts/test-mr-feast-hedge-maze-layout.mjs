import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "assets", "js", "mr-feast-mansion.js"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sourceSection(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert(startIndex >= 0 && endIndex > startIndex, `missing source section ${start} → ${end}`);
  return source.slice(startIndex, endIndex);
}

function parseMazeRows() {
  const section = sourceSection("const HEDGE_MAZE_LAYOUT", "const HEDGE_MAZE_PORTALS");
  const rowsBlock = section.match(/rows:\s*Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1] || "";
  const rows = [...rowsBlock.matchAll(/"([#.SE]+)"/g)].map((match) => match[1]);
  assert(rows.length > 0, "hedge maze rows are missing");
  assert(rows.every((row) => row.length === rows[0].length), "hedge maze rows must have a uniform width");
  return rows;
}

function parsePortal(id) {
  const section = sourceSection("const HEDGE_MAZE_PORTALS", "const HEDGE_MAZE_REAR_PORTAL");
  const match = section.match(new RegExp(`id:\\s*"${id}",\\s*row:\\s*(\\d+),\\s*col:\\s*(\\d+)`));
  assert(match, `missing ${id} hedge-maze portal`);
  return { row: Number(match[1]), col: Number(match[2]) };
}

function parseDigSite() {
  const section = sourceSection("const CONTESTANT_13 =", "function itemIconSvg");
  const match = section.match(/digSite:\s*Object\.freeze\(\{\s*row:\s*(\d+),\s*col:\s*(\d+)/);
  assert(match, "missing Contestant 13 dig-site cell");
  return { row: Number(match[1]), col: Number(match[2]) };
}

function cellKey(cell) {
  return `${cell.row},${cell.col}`;
}

function walkable(rows, cell) {
  return cell.row >= 0
    && cell.row < rows.length
    && cell.col >= 0
    && cell.col < rows[0].length
    && rows[cell.row][cell.col] !== "#";
}

function neighbors(rows, cell) {
  return [
    { row: cell.row - 1, col: cell.col },
    { row: cell.row + 1, col: cell.col },
    { row: cell.row, col: cell.col - 1 },
    { row: cell.row, col: cell.col + 1 },
  ].filter((candidate) => walkable(rows, candidate));
}

function shortestPath(rows, start, goal) {
  const queue = [start];
  const previous = new Map([[cellKey(start), null]]);
  const cells = new Map([[cellKey(start), start]]);
  while (queue.length) {
    const current = queue.shift();
    if (cellKey(current) === cellKey(goal)) break;
    for (const next of neighbors(rows, current)) {
      const key = cellKey(next);
      if (previous.has(key)) continue;
      previous.set(key, cellKey(current));
      cells.set(key, next);
      queue.push(next);
    }
  }
  if (!previous.has(cellKey(goal))) return [];
  const pathCells = [];
  for (let cursor = cellKey(goal); cursor != null; cursor = previous.get(cursor)) {
    pathCells.push(cells.get(cursor));
  }
  return pathCells.reverse();
}

const rows = parseMazeRows();
const north = parsePortal("north");
const rear = parsePortal("rear");
const digSite = parseDigSite();
const walkableCells = rows.reduce(
  (total, row) => total + [...row].filter((cell) => cell !== "#").length,
  0,
);
const entranceToExit = shortestPath(rows, north, rear);
const traversalRatio = entranceToExit.length / walkableCells;

assert(
  traversalRatio >= 0.5,
  `entrance-to-exit traversal must cover at least 50% of the maze; got ${entranceToExit.length}/${walkableCells} (${(traversalRatio * 100).toFixed(1)}%)`,
);
assert(
  source.includes("entranceToExitCoverageRatio"),
  "deterministic yard diagnostics must expose the measured entrance-to-exit coverage ratio",
);

const digNeighbors = neighbors(rows, digSite);
const northToKey = shortestPath(rows, north, digSite);
const rearToKey = shortestPath(rows, rear, digSite);
assert(digNeighbors.length === 1, `the buried key must occupy a true dead end; got ${digNeighbors.length} exits`);
assert(
  northToKey.length > walkableCells * 0.5 && rearToKey.length > walkableCells * 0.5,
  `the buried key must require more than half the maze from either portal; north=${northToKey.length}/${walkableCells}, rear=${rearToKey.length}/${walkableCells}`,
);
assert(rows[digSite.row][digSite.col] === "E", "the maze traversal goal and buried-key chamber must share the authored deepest dead end");

const stormRunSection = sourceSection("const STORM_RUN =", "const FEAST_HUNT =");
assert(
  stormRunSection.includes("...HEDGE_MAZE_STORM_ROUTE"),
  "Storm Run contestants must derive their maze leg from the authoritative entrance-to-exit cell route",
);
assert(
  source.includes("const HEDGE_MAZE_STORM_ROUTE"),
  "the redesigned maze must expose one shared Storm Run cell route",
);

console.log(
  `Mr. Feast hedge maze layout test passed: ${(traversalRatio * 100).toFixed(1)}% portal traversal, `
  + `key depths north=${northToKey.length - 1} rear=${rearToKey.length - 1}`,
);
