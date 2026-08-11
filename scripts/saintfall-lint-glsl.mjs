#!/usr/bin/env node
/* ============================================================
   SAINTFALL - GLSL template-literal guard

   Every shader in this project lives inside a JS template literal,
   so a single backtick anywhere in a GLSL comment terminates the
   string early and the module dies with a syntax error pointing at
   whatever word happened to follow it.

   This has now cost two separate debugging detours - once in
   art.js, once in render.js - because the failure names the wrong
   thing: you get "Unexpected identifier 'radius'" and go looking at
   a variable that is fine.

   Run in CI or before a commit; it is a one-line check that a
   whole class of confusing failure cannot happen.
   ============================================================ */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "assets/js/saintfall");
let bad = 0;

/* Scanned rather than regexed, and the difference is not academic -
   the regex version MISSED the third occurrence of this bug.

   It looked at lines containing `//` and at continuation lines
   starting with `*`, which covers a block comment's middle but not
   its FIRST line: a backtick on the same line as the opening slash-
   star was invisible to it. It also could not see past the damage,
   because its own pattern needed the literal to be terminated by a
   backtick-semicolon, and a literal broken early is not.

   So: find where each GLSL literal starts, then walk it character by
   character tracking comment state. The first unescaped backtick
   outside a comment is the real end of the literal; one inside a
   comment is the bug. */
function scanLiteral(src, start) {
  const hits = [];
  let i = start;
  let line = 0;
  let inLine = false;
  let inBlock = false;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "\n") { line += 1; inLine = false; i += 1; continue; }
    if (!inLine && !inBlock && c === "/" && n === "/") { inLine = true; i += 2; continue; }
    if (!inLine && !inBlock && c === "/" && n === "*") { inBlock = true; i += 2; continue; }
    if (inBlock && c === "*" && n === "/") { inBlock = false; i += 2; continue; }
    if (c === "\\") { i += 2; continue; }
    if (c === "`") {
      if (inLine || inBlock) hits.push({ line, i });
      else return { hits, end: i };
    }
    i += 1;
  }
  return { hits, end: src.length };
}

for (const name of (await readdir(dir)).filter((n) => n.endsWith(".js"))) {
  const src = await readFile(path.join(dir, name), "utf8");
  const re = /\/\* glsl \*\/`/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const start = m.index + m[0].length;
    const { hits, end } = scanLiteral(src, start);
    for (const h of hits) {
      const lineNo = src.slice(0, start).split("\n").length + h.line;
      const text = src.slice(src.lastIndexOf("\n", h.i) + 1, src.indexOf("\n", h.i));
      console.error(`${name}:${lineNo}  backtick inside a GLSL comment: ${text.trim()}`);
      bad += 1;
    }
    re.lastIndex = end;
  }
}
console.log(bad ? `\n${bad} backtick(s) inside GLSL comments` : "GLSL literals clean");
if (bad) process.exitCode = 1;
