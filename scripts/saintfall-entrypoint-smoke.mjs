#!/usr/bin/env node
/* EVERY SAINTFALL ENTRY POINT, BOOTED.

   The three Saintfall pages now share one module pack between them,
   and the campaign carries the Kenosis operatives' kits while the two
   newer levels carry their own doctrines and command wheels. That
   makes a whole class of mistake possible that no single-page harness
   sees: a module renamed for one level 404s on another, a `?v=` pin
   drifting out of lockstep with `boot.js`'s own BUILD, or an
   operative selectable on a page that cannot build their kit.

   So this boots all six combinations, fails on ANY page error, any
   console error or any same-origin 4xx, and prints what each one
   actually ended up with - which doctrine tree, and which three
   commands are on the wheel. The print is the point as much as the
   pass: it is the one place that says, in one screen, what is live
   where. */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

/* `new URL("..").pathname` is URL-ENCODED - this repo lives under a
   directory with a space in it, so that spelling hands `spawn` a cwd
   containing "%20" and the server never starts. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 47600 + (process.pid % 800);
const base = `http://127.0.0.1:${port}`;

const ENTRIES = [
  ["campaign  vesper ", `games/saintfall.html?qa=1&quality=low`],
  ["campaign  vigil  ", `games/saintfall.html?qa=1&quality=low&character=white-vigil`],
  ["campaign  bastion", `games/saintfall.html?qa=1&quality=low&character=bastion-penitent`],
  ["summit    vigil  ", `games/saintfall-white-vigil.html?qa=1&quality=low&character=white-vigil&time=noon`],
  ["summit    bastion", `games/saintfall-white-vigil.html?qa=1&quality=low&character=bastion-penitent&time=noon`],
  ["antiphon         ", `games/saintfall-green-antiphon.html?qa=1&quality=low`],
];

function server() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}
async function waitServer() {
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

async function main() {
  const child = server();
  let browser;
  let bad = 0;
  try {
    await waitServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    for (const [label, rel] of ENTRIES) {
      const page = await (await browser.newContext({ viewport: { width: 800, height: 520 } })).newPage();
      const errs = [];
      const http = [];
      page.on("pageerror", (e) => errs.push(e.message.slice(0, 140)));
      page.on("console", (m) => { if (m.type() === "error") errs.push(`console: ${m.text().slice(0, 140)}`); });
      page.on("response", (r) => {
        try {
          const u = new URL(r.url());
          if (r.status() >= 400 && u.port === String(port)) http.push(`${r.status()} ${u.pathname}`);
        } catch (_) { /* opaque */ }
      });
      try {
        await page.goto(`${base}/${rel}`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 240000 });
        const info = await page.evaluate(() => {
          const T = window.__SF;
          const d = T.progression?.definitions?.() || null;
          /* The two runtimes report their tree differently: the
             campaign's config nests it under `.doctrine`, the Kenosis
             pack returns it flat. Read both rather than one. */
          const orders = d?.orders || d?.doctrine?.orders || [];
          return {
            wheel: Array.from(T.ctx?.mission?.wheelOrder || []),
            tree: d?.id || d?.doctrine?.id || (orders.length ? "campaign" : null),
            orders: orders.length,
          };
        });
        const ok = errs.length === 0 && http.length === 0;
        if (!ok) bad += 1;
        console.log(`${ok ? "OK  " : "FAIL"} ${label}  wheel=[${info.wheel.join(",")}]`
          + `  doctrine=${info.tree} (${info.orders} orders)`
          + (errs.length ? `  ERR ${errs[0]}` : "")
          + (http.length ? `  HTTP ${http[0]}` : ""));
      } catch (e) {
        bad += 1;
        console.log(`FAIL ${label}  ${String(e.message).slice(0, 110)}`);
      }
      await page.context().close();
    }
  } finally {
    await browser?.close();
    child.kill();
  }
  console.log(bad ? `\n${bad} entry point(s) failed` : "\nevery entry point boots clean");
  if (bad) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
