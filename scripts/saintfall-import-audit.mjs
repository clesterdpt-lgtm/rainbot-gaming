#!/usr/bin/env node
/* ============================================================
   SAINTFALL - import/export audit

   Every module in this game is loaded through an import map, in a
   browser, at the end of a two-minute build. A named import that
   does not exist on the other side therefore fails LATE, once, with
   a message that names the importer rather than the missing symbol -
   and boot.js's own comment block records a whole debugging detour
   caused by exactly that shape of failure (a fresh mission.js
   against a stale terrain.js, reported as a missing export).

   This is the static version of that check, and it runs in a
   second. It parses every `import { a, b } from "saintfall/x.js"`
   and every `export` in the target, and reports any name that is
   asked for and not provided.

   Deliberately simple: regex over the source rather than a real
   parser, because this codebase writes its imports and exports in
   one house style and a parser would be a dependency for no gain.
   It errs toward FALSE ALARMS (an export form it does not know is
   reported as missing), never toward silence.

   Usage: node scripts/saintfall-import-audit.mjs
   ============================================================ */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "assets/js/saintfall");

/** Every name a module makes available to a named import. */
function exportsOf(src) {
  const names = new Set();
  // export function f / export async function f / export class C
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s+class\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  // export const/let/var a = ... , and the multi-declarator form
  for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+([^=;\n]+)/gm)) {
    for (const part of m[1].split(",")) {
      const n = part.trim().split(/\s|=/)[0];
      if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n);
    }
  }
  // export { a, b as c }  /  export { a } from "..."
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const seg = part.trim();
      if (!seg) continue;
      const as = seg.split(/\s+as\s+/);
      const n = (as[1] || as[0]).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n);
    }
  }
  return names;
}

/** Every `saintfall/*.js` named import a module makes. */
function importsOf(src) {
  const out = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']saintfall\/([\w.-]+)\.js["']/g)) {
    const names = m[1].split(",").map((s) => {
      const seg = s.trim();
      if (!seg) return null;
      return seg.split(/\s+as\s+/)[0].trim();
    }).filter(Boolean);
    out.push({ from: m[2], names });
  }
  return out;
}

const files = (await readdir(dir)).filter((f) => f.endsWith(".js"));
const src = new Map();
for (const f of files) src.set(f.replace(/\.js$/, ""), await readFile(path.join(dir, f), "utf8"));

const exp = new Map();
for (const [name, code] of src) exp.set(name, exportsOf(code));

let problems = 0;
for (const [name, code] of src) {
  for (const spec of importsOf(code)) {
    if (!src.has(spec.from)) {
      console.log(`${name}.js  imports from  ${spec.from}.js  -- NO SUCH MODULE`);
      problems += 1;
      continue;
    }
    const have = exp.get(spec.from);
    for (const want of spec.names) {
      if (!have.has(want)) {
        console.log(`${name}.js  wants  { ${want} }  from  ${spec.from}.js  -- NOT EXPORTED`);
        problems += 1;
      }
    }
  }
}

/* boot.js pins a cache key per module by name. A module that exists
   on disk and is missing from that array is served with no cache key
   at all, which is the failure boot.js's own comment describes. */
const boot = await readFile(path.join(dir, "boot.js"), "utf8");
const listed = new Set(
  [...boot.matchAll(/"([\w-]+)"/g)].map((m) => m[1])
);
for (const name of src.keys()) {
  if (name === "boot") continue;
  if (!listed.has(name)) {
    console.log(`${name}.js  exists on disk but is NOT in boot.js's MODULES array -- it will be served with no cache key`);
    problems += 1;
  }
}

console.log(problems ? `\n${problems} import/export problem(s)` : "imports and exports agree");
process.exitCode = problems ? 1 : 0;
