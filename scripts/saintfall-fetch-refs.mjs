#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Xbox-era reference pool fetcher

   Pulls real ORIGINAL-XBOX Halo screenshots into
   output/reference/halo/ so the blind-comparison critic has
   something to score our bosses against. output/ is gitignored:
   this pool is local review input only and is never committed,
   published or shipped.

   Source is Halopedia's MediaWiki API.

   Usage:
     node scripts/saintfall-fetch-refs.mjs
     node scripts/saintfall-fetch-refs.mjs --count 28 --out output/reference/halo

   ------------------------------------------------------------
   WHAT MAKES A USABLE REFERENCE

   The pool is judged against boss beauty shots: one large hostile
   creature, mid-distance, in a lit environment. So the filter is
   tighter than "any Halo picture".

   1. THE RIGHT GAME. Halo: Combat Evolved (2001) and Halo 2 (2004)
      on the original Xbox. Anniversary, MCC, Infinite, Reach, ODST
      and the 2003 PC port are all REJECTED by name - a 2011
      remaster is not the bar the brief asked for, and scoring
      against one would quietly move the target by a console
      generation.

   2. A FRAME, NOT AN ASSET. Concept art, renders, box art, menu
      captures, medal icons, maps, textures and cutscene title
      cards are rejected by name. A render has no environment
      lighting in it and would score our in-game frame against a
      turntable.

   3. A CREATURE IN IT. Names are ranked, not just filtered:
      anything naming a Covenant or Flood form sorts to the front,
      because the comparison we actually care about is
      creature-against-creature. Environment-only plates stay in
      the pool as filler but sort last.

   4. BIG ENOUGH TO SURVIVE NORMALISATION. Both sides get resampled
      and JPEG round-tripped by saintfall-blind-compare.mjs so that
      resolution and compression cannot identify a side. A 200px
      thumbnail cannot survive that; 480px+ can.

   5. NOT CHOSEN FOR A BUG. A wiki hosts frames captured to document
      a glitch - a Jackal rendered in the wrong shader, geometry
      inside a wall. Real frames, but nobody lit or framed them, and
      beating one flatters us.

   ------------------------------------------------------------
   WHAT NAME FILTERING CANNOT DO

   None of the above can see what is on screen. Filenames do not say
   "this is the Anniversary renderer at 4K" or "this is a photo of a
   television", and both got through into the first pool. So the
   pool is vetted by eye afterwards, and the verdict is written to
   output/reference/halo-rejected/_rejected.json. This script reads
   that file back and skips those titles - otherwise every re-run
   silently re-downloads the frames a human already threw out.
   ============================================================ */

import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
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
const OUT_DIR = path.resolve(root, args.out || "output/reference/halo");
const WANT = Number(args.count || 28);
const API = "https://www.halopedia.org/api.php";
const UA = "RainbotGaming-reference-fetch/1.0 (local art review; contact clesterdpt@gmail.com)";

/* The two original-Xbox titles, and nothing else. */
const CATEGORIES = [
  "Category:Halo: Combat Evolved screenshots",
  "Category:Halo: Combat Evolved campaign screenshots",
  "Category:Halo 2 screenshots",
  "Category:Halo 2 campaign screenshots",
];

/* A later game's name inside the filename is disqualifying however
   Xbox-era the rest of it looks. "Anniversary" is the big one: it
   shares every level name with the 2001 game. */
const REJECT_GAME = /(anniversary|\bmcc\b|master chief collection|reach|\bodst\b|halo ?3|halo ?4|halo ?5|infinite|\bwars\b|spartan assault|spartan strike|h3\b|h4\b|h5\b|hr\b|hi\b|hw\b)/i;

const REJECT_KIND = /(concept|artwork|\brender\b|box ?art|cover|logo|icon|medal|emblem|menu|map\b|texture|font|title|credit|storyboard|sketch|cinematic ?still|poster|patch|avatar|achievement|banner|wallpaper|scan|magazine|manual|disc|case)/i;

/* Frames captured to document something broken, or to document an
   asset that never shipped. The first pool held two "BlueJackal
   Glitch" frames: genuine Xbox output, but chosen for a bug, and a
   critic scoring us against a mis-shaded Jackal tells us nothing. */
const REJECT_GLITCH = /(glitch|\bbug\b|\bbeta\b|\bcut\b|unused|unreleased|debug|out ?of ?bounds|clipping|error)/i;

/* Sorted to the front: the comparison that matters is a creature
   against a creature, not a corridor against a corridor. */
const CREATURE = /(hunter|elite|brute|jackal|grunt|flood|sentinel|drone|prophet|gravemind|scarab|juggernaut|infection|carrier|combat ?form|lekgolo|unggoy|sangheili|kig-yar|enforcer|guilty ?spark|monitor|arbiter|tartarus|regret|boss)/i;

/* The by-eye verdicts, keyed on the wiki title because the local
   filenames are just a counter and carry no identity - halo-05 is a
   different picture after every fetch. Missing file is not an error:
   a pool that has never been vetted simply rejects nothing. */
async function loadVetoes() {
  const file = path.join(path.dirname(OUT_DIR), "halo-rejected", "_rejected.json");
  try {
    const data = JSON.parse(await readFile(file, "utf8"));
    return new Set((data.items || []).map((i) => i.title).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function api(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ format: "json", ...params })) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function listCategory(cmtitle, limit = 600) {
  const titles = [];
  let cont;
  while (titles.length < limit) {
    const params = {
      action: "query", list: "categorymembers",
      cmtitle, cmtype: "file", cmlimit: "200",
    };
    if (cont) params.cmcontinue = cont;
    let data;
    try { data = await api(params); } catch (err) {
      process.stdout.write(`  ${cmtitle}: ${err.message}\n`);
      break;
    }
    for (const m of data?.query?.categorymembers || []) titles.push(m.title);
    cont = data?.continue?.cmcontinue;
    if (!cont) break;
    await delay(220);
  }
  return titles;
}

async function resolveImages(titles) {
  const out = [];
  for (let i = 0; i < titles.length; i += 40) {
    const batch = titles.slice(i, i + 40);
    let data;
    try {
      data = await api({
        action: "query", prop: "imageinfo",
        iiprop: "url|size|mime", titles: batch.join("|"),
      });
    } catch (err) {
      process.stdout.write(`  metadata batch failed: ${err.message}\n`);
      continue;
    }
    const pages = data?.query?.pages || {};
    for (const key of Object.keys(pages)) {
      const page = pages[key];
      const info = page?.imageinfo?.[0];
      if (!info) continue;
      const { url, width, height, mime } = info;
      if (!/image\/(png|jpeg)/.test(mime || "")) continue;
      if (!width || !height) continue;
      const aspect = width / height;
      /* Xbox output was 4:3, with widescreen captures at 16:9. Both
         are frames; a 3:1 banner or a 1:1 icon is not. */
      if (width < 480) continue;
      if (aspect < 1.2 || aspect > 1.85) continue;
      out.push({ title: page.title, url, width, height, aspect });
    }
    await delay(220);
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

  const vetoed = await loadVetoes();
  if (vetoed.size) process.stdout.write(`Honouring ${vetoed.size} by-eye rejection(s) from the last vetting pass.\n`);

  process.stdout.write("Listing original-Xbox Halo screenshot categories...\n");
  const seen = new Set();
  const titles = [];
  for (const cat of CATEGORIES) {
    const found = await listCategory(cat);
    process.stdout.write(`  ${cat}: ${found.length}\n`);
    for (const t of found) {
      if (seen.has(t)) continue;
      seen.add(t);
      if (REJECT_GAME.test(t) || REJECT_KIND.test(t) || REJECT_GLITCH.test(t)) continue;
      if (vetoed.has(t)) continue;
      titles.push(t);
    }
  }
  process.stdout.write(`  ${titles.length} candidate file(s) after name filtering\n`);

  process.stdout.write("Resolving image metadata...\n");
  const images = await resolveImages(titles);
  process.stdout.write(`  ${images.length} usable landscape frame(s)\n`);

  /* Creature frames first, then by pixel count. Largest survives the
     normalising resample with the least added softness. */
  images.sort((a, b) => {
    const ca = CREATURE.test(a.title) ? 1 : 0;
    const cb = CREATURE.test(b.title) ? 1 : 0;
    if (ca !== cb) return cb - ca;
    return b.width * b.height - a.width * a.height;
  });

  const manifest = [];
  let n = 0;
  for (const item of images) {
    if (n >= WANT) break;
    const ext = /\.(jpe?g)$/i.test(item.url) ? "jpg" : "png";
    const name = `halo-${String(n + 1).padStart(2, "0")}.${ext}`;
    try {
      const bytes = await download(item, path.join(OUT_DIR, name));
      manifest.push({
        file: name, title: item.title, source: item.url,
        width: item.width, height: item.height, bytes,
        creature: CREATURE.test(item.title),
      });
      process.stdout.write(`  ${name}  ${item.width}x${item.height}  ${CREATURE.test(item.title) ? "[creature] " : ""}${item.title}\n`);
      n += 1;
      await delay(180);
    } catch (err) {
      process.stdout.write(`  skipped ${item.title}: ${err.message}\n`);
    }
  }

  await writeFile(path.join(OUT_DIR, "_manifest.json"), JSON.stringify({
    fetched: new Date().toISOString(),
    note: "Local art-review reference only. Not committed (output/ is gitignored), not published, not shipped.",
    source: "https://www.halopedia.org/",
    games: ["Halo: Combat Evolved (Xbox, 2001)", "Halo 2 (Xbox, 2004)"],
    items: manifest,
  }, null, 2));

  const files = (await readdir(OUT_DIR)).filter((f) => /\.(png|jpg)$/i.test(f));
  process.stdout.write(`\nPool now holds ${files.length} reference frame(s) in ${path.relative(root, OUT_DIR)}\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
