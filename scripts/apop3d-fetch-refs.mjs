#!/usr/bin/env node
/* ============================================================
   APOP DEMON MOGGERS 3D - reference pool fetcher

   Pulls real Super Mario 64 screenshots into output/reference/sm64/
   so the blind-comparison critic has something to score us against.
   output/ is gitignored: this pool is local review input only and is
   never committed, published or shipped.

   Source is the Super Mario Wiki's MediaWiki API, which exposes a
   clean file listing. MobyGames returns 403 to scripted clients.

   Usage:
     node scripts/apop3d-fetch-refs.mjs
     node scripts/apop3d-fetch-refs.mjs --count 24 --out output/reference/sm64

   ------------------------------------------------------------
   WHAT MAKES A USABLE REFERENCE

   The pool has to be comparable to what our harness captures, or the
   blind test measures framing rather than render quality. So we keep
   only:

   - Landscape images. Portrait crops and sprite rips are not frames.
   - At least 280px wide. The N64 rendered at 320x240; anything much
     below that is a thumbnail of a screenshot, not a screenshot.
   - Aspect between 1.15 and 1.55, which is 4:3 give or take the
     letterboxing different captures apply.
   - Not obviously an asset rip: files whose names say "artwork",
     "sprite", "model", "icon", "logo", "map" or "render" are dropped.

   Everything that survives is normalised to a common size and format
   later, by apop3d-blind-compare.mjs, so that resolution and
   compression cannot identify which side is which.
   ============================================================ */

import { mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else { args[key] = next; i += 1; }
    } else args._.push(token);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const OUT_DIR = path.resolve(root, args.out || "output/reference/sm64");
const WANT = Number(args.count || 24);
const API = "https://www.mariowiki.com/api.php";
const UA = "RainbotGaming-reference-fetch/1.0 (local art review; contact clesterdpt@gmail.com)";

const REJECT_NAME = /(artwork|sprite|model|icon|logo|box|cover|map|render|concept|beta|texture|title|font|chart|comparison|ds[ _])/i;

async function api(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ format: "json", ...params })) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/** Walk the screenshot category and return candidate file titles. */
async function listCandidates(limit = 400) {
  const titles = [];
  let cont;
  while (titles.length < limit) {
    const params = {
      action: "query",
      list: "categorymembers",
      cmtitle: "Category:Super Mario 64 screenshots",
      cmtype: "file",
      cmlimit: "200",
    };
    if (cont) params.cmcontinue = cont;
    const data = await api(params);
    const members = data?.query?.categorymembers || [];
    for (const m of members) if (!REJECT_NAME.test(m.title)) titles.push(m.title);
    cont = data?.continue?.cmcontinue;
    if (!cont) break;
    await delay(250);
  }
  return titles;
}

/** Resolve titles to real image URLs with dimensions, in batches of 40. */
async function resolveImages(titles) {
  const out = [];
  for (let i = 0; i < titles.length; i += 40) {
    const batch = titles.slice(i, i + 40);
    const data = await api({
      action: "query",
      prop: "imageinfo",
      iiprop: "url|size|mime",
      titles: batch.join("|"),
    });
    const pages = data?.query?.pages || {};
    for (const key of Object.keys(pages)) {
      const info = pages[key]?.imageinfo?.[0];
      if (!info) continue;
      const { url, width, height, mime } = info;
      if (!/image\/(png|jpeg)/.test(mime || "")) continue;
      if (!width || !height) continue;
      const aspect = width / height;
      if (width < 280) continue;
      if (aspect < 1.15 || aspect > 1.55) continue;
      out.push({ title: pages[key].title, url, width, height, aspect });
    }
    await delay(250);
  }
  return out;
}

async function download(item, file) {
  const res = await fetch(item.url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} for ${item.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  return buf.length;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  process.stdout.write("Listing Super Mario 64 screenshot category...\n");
  const titles = await listCandidates();
  process.stdout.write(`  ${titles.length} candidate file(s) after name filtering\n`);

  process.stdout.write("Resolving image metadata...\n");
  const images = await resolveImages(titles);
  process.stdout.write(`  ${images.length} usable landscape frame(s)\n`);

  // Prefer the largest frames: they survive the normalising resample
  // with the least added softness, which would otherwise be a tell.
  images.sort((a, b) => b.width * b.height - a.width * a.height);

  const manifest = [];
  let n = 0;
  for (const item of images) {
    if (n >= WANT) break;
    const ext = item.url.toLowerCase().endsWith(".jpg") || item.url.toLowerCase().endsWith(".jpeg") ? "jpg" : "png";
    const name = `sm64-${String(n + 1).padStart(2, "0")}.${ext}`;
    const file = path.join(OUT_DIR, name);
    try {
      const bytes = await download(item, file);
      manifest.push({ file: name, title: item.title, source: item.url, width: item.width, height: item.height, bytes });
      process.stdout.write(`  ${name}  ${item.width}x${item.height}  ${item.title}\n`);
      n += 1;
      await delay(200);
    } catch (err) {
      process.stdout.write(`  skipped ${item.title}: ${err.message}\n`);
    }
  }

  await writeFile(path.join(OUT_DIR, "_manifest.json"), JSON.stringify({
    fetched: new Date().toISOString(),
    note: "Local art-review reference only. Not committed (output/ is gitignored), not published, not shipped.",
    source: "https://www.mariowiki.com/",
    items: manifest,
  }, null, 2));

  const files = (await readdir(OUT_DIR)).filter((f) => /\.(png|jpg)$/i.test(f));
  process.stdout.write(`\nPool now holds ${files.length} reference frame(s) in ${path.relative(root, OUT_DIR)}\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
