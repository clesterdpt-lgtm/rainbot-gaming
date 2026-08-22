#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Doctrine board interaction regression

   Drives the production listeners on the rebuilt Doctrine board: rite
   selection, inscribing from the inspector, and the capstone Vow, which is
   now a node in the same tree as the rites and is acted on through the same
   inspector rather than a full-width band of its own.

   The layout half of this board is covered by saintfall-ui-regression.mjs
   (node-overlap, containment and scroll-owner audits at four viewports).

   Usage:
     node scripts/saintfall-doctrine-board.mjs
     node scripts/saintfall-doctrine-board.mjs --out output/saintfall/doctrine
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const PORT = 43000 + (process.pid % 8000);
const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((part) => part.trim().split(/\s+/)).map(([key, value]) => [key, value ?? true])
);
const OUT = path.resolve(args.out || "output/saintfall/doctrine-board");
const server = spawn("/opt/homebrew/bin/python3", ["-m", "http.server", String(PORT)],
  { cwd: process.cwd(), stdio: "ignore" });
await delay(900);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
async function snap(name) {
  try {
    await page.screenshot({
      path: path.join(OUT, name),
      fullPage: false,
      animations: "disabled",
      timeout: 8000,
    });
  } catch (error) {
    console.log(`  skip screenshot ${name}: ${String(error.message || error).split("\n")[0]}`);
  }
}
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
await page.goto(`http://127.0.0.1:${PORT}/games/saintfall.html?qa=1`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__SF?.menuState, null, { timeout: 60000 });
await delay(1200);
for (let i = 0; i < 3; i += 1) {
  await page.keyboard.press("Escape");
  try { await page.waitForFunction(() => window.__SF?.menuState?.()?.open, null, { timeout: 2000 }); break; } catch (_) { /* retry */ }
}
await page.locator('[data-menu-panel="doctrine"]').click({ force: true });
await page.waitForFunction(() => window.__SF.menuState()?.panel === "doctrine");
await delay(500);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
};

// Grant enough XP/points to fully invest the Censer order and earn a seal.
await page.evaluate(() => {
  const T = window.__SF;
  T.resetProgressionForQA();
  T.grantProgressionXpForQA(500000, "qa:doctrine-flow");
});
await delay(300);
await page.locator('[data-doctrine-order="censer"]').click({ force: true });
await delay(300);

const ladder = await page.evaluate(() => {
  const cards = [...document.querySelectorAll("[data-doctrine-talent]")];
  const rect = (node) => node.getBoundingClientRect();
  const t1 = cards.filter((card) => card.dataset.tier === "1").map(rect);
  const t2 = cards.find((card) => card.dataset.tier === "2");
  const t3 = cards.find((card) => card.dataset.tier === "3");
  const preview = document.querySelector("[data-doctrine-preview]");
  const tree = document.querySelector(".sf-doctrine__tree");
  const pageNode = document.querySelector('[data-menu-page="doctrine"]');
  const t2r = t2 ? rect(t2) : null;
  const t3r = t3 ? rect(t3) : null;
  const previewR = preview ? rect(preview) : null;
  const treeR = tree ? rect(tree) : null;
  const pageR = pageNode ? rect(pageNode) : null;
  return {
    t1Count: t1.length,
    t1SameRow: t1.length === 2 && Math.abs(t1[0].top - t1[1].top) < 10,
    t1SideBySide: t1.length === 2 && Math.abs(t1[0].left - t1[1].left) > t1[0].width * 0.4,
    t2BelowT1: !!t2r && t1.length === 2
      && t2r.top >= Math.max(t1[0].bottom, t1[1].bottom) - 6,
    t3BelowT2: !!t2r && !!t3r && t3r.top >= t2r.bottom - 6,
    t2SpansT1: !!t2r && t1.length === 2 && t2r.width > Math.max(t1[0].width, t1[1].width) * 1.35,
    previewGteTree: !!previewR && !!treeR && previewR.width + 8 >= treeR.width,
    pageScrollY: pageNode ? Math.max(0, pageNode.scrollHeight - pageNode.clientHeight) : -1,
    previewVisible: !!previewR && previewR.width > 80 && previewR.height > 80,
    pageHeight: pageR ? pageR.height : 0,
  };
});
check("T1 rites sit side by side, T2 then T3 stack below, preview owns the width",
  ladder.t1Count === 2 && ladder.t1SameRow && ladder.t1SideBySide
    && ladder.t2BelowT1 && ladder.t3BelowT2 && ladder.t2SpansT1
    && ladder.previewGteTree && ladder.previewVisible && ladder.pageScrollY <= 2,
  JSON.stringify(ladder));
await mkdir(OUT, { recursive: true });
await snap("doctrine-ladder.png");

const previewWidths = [];
const talentCount = await page.locator("[data-doctrine-talent]").count();
for (let i = 0; i < talentCount; i += 1) {
  await page.locator("[data-doctrine-talent]").nth(i).click({ force: true });
  await delay(80);
  previewWidths.push(await page.evaluate(() =>
    Number(document.querySelector("[data-doctrine-preview]")?.getBoundingClientRect().width.toFixed(1))));
}
await page.locator("[data-doctrine-vow]").click({ force: true });
await delay(80);
previewWidths.push(await page.evaluate(() =>
  Number(document.querySelector("[data-doctrine-preview]")?.getBoundingClientRect().width.toFixed(1))));
const previewSpread = Math.max(...previewWidths) - Math.min(...previewWidths);
check("inspector width does not change across rites and the Vow",
  previewWidths.length >= 5 && previewSpread <= 1,
  JSON.stringify({ previewWidths, previewSpread }));

const chrome = await page.evaluate(() => {
  const pageNode = document.querySelector('[data-menu-page="doctrine"]');
  const reset = document.querySelector("[data-talent-respec]");
  const reason = document.querySelector("[data-doctrine-edit-reason]");
  const warn = document.querySelector("[data-doctrine-respec-warn]");
  const seals = document.querySelector(".sf-doctrine__seals, [data-doctrine-vow-count]");
  const preview = document.querySelector("[data-doctrine-preview]");
  const tree = document.querySelector(".sf-doctrine__tree");
  const summary = document.querySelector(".sf-doctrine__summary");
  const footer = document.querySelector(".sf-doctrine__footer");
  const pr = pageNode.getBoundingClientRect();
  const rr = reset.getBoundingClientRect();
  const sr = summary.getBoundingClientRect();
  const tr = tree.getBoundingClientRect();
  const prev = preview.getBoundingClientRect();
  const warnStyle = warn ? getComputedStyle(warn) : null;
  return {
    sealsMissing: !seals,
    reasonMissing: !reason,
    footerInSummary: !!summary?.contains(footer),
    resetTopBand: rr.top < pr.top + pr.height * 0.28,
    resetRight: pr.right - rr.right < 48,
    warnPresent: !!warn && !!footer?.contains(warn),
    warnHidden: !!warn?.hidden && warnStyle?.display === "none",
    previewTallerThanTree: prev.height + 8 >= tr.height,
    summaryTop: sr.top - pr.top,
  };
});
check("reset sits in the top-right without a dedicated field-pressure line",
  chrome.sealsMissing && chrome.reasonMissing && chrome.footerInSummary
    && chrome.resetTopBand && chrome.resetRight && chrome.warnPresent && chrome.warnHidden,
  JSON.stringify(chrome));

// 1. Clicking a rite card drives the inspector.
const second = page.locator("[data-doctrine-talent]").nth(1);
await second.click({ force: true });
await delay(150);
const afterCardClick = await page.evaluate(() => ({
  previewId: document.querySelector("[data-doctrine-preview]")?.dataset.talentId,
  cardId: document.querySelectorAll("[data-doctrine-talent]")[1]?.dataset.talentId,
  vowPreviewed: document.querySelector("[data-doctrine-vow]")?.dataset.previewed,
}));
check("clicking a rite card selects it in the inspector and clears the crown",
  afterCardClick.previewId === afterCardClick.cardId && afterCardClick.vowPreviewed === "false",
  JSON.stringify(afterCardClick));

// 2. Inscribe every rite to full rank from the inspector.
for (let pass = 0; pass < 12; pass += 1) {
  const spend = page.locator('[data-doctrine-preview] [data-talent-action="spend"]:not(:disabled)');
  if (await spend.count() === 0) {
    const cards = await page.locator("[data-doctrine-talent]").count();
    let advanced = false;
    for (let i = 0; i < cards; i += 1) {
      await page.locator("[data-doctrine-talent]").nth(i).click({ force: true });
      await delay(120);
      if (await page.locator('[data-doctrine-preview] [data-talent-action="spend"]:not(:disabled)').count()) {
        advanced = true; break;
      }
    }
    if (!advanced) break;
  }
  await page.locator('[data-doctrine-preview] [data-talent-action="spend"]').first().click({ force: true });
  await delay(180);
}
const invested = await page.evaluate(() => document.querySelector("[data-doctrine-invested]")?.textContent);
check("rites inscribe from the inspector up to the order cap", invested === "8 / 8", `invested=${invested}`);

await page.evaluate(() => {
  const progression = window.__SF?.ctx?.progression;
  if (!progression) return;
  window.__SF.__restoreCanEdit = progression.canEdit.bind(progression);
  progression.canEdit = () => {
    const reason = "Available when Bloom pressure subsides.";
    return { ok: false, canEdit: false, reason, message: reason };
  };
});
await page.locator("[data-talent-respec]").click({ force: true });
await delay(180);
const combatWarn = await page.evaluate(() => {
  const warn = document.querySelector("[data-doctrine-respec-warn]");
  const style = warn ? getComputedStyle(warn) : null;
  const button = document.querySelector("[data-talent-respec]");
  return {
    text: warn?.textContent?.trim() || "",
    hidden: !!warn?.hidden,
    display: style?.display || "",
    width: warn ? Number(warn.getBoundingClientRect().width.toFixed(1)) : 0,
    height: warn ? Number(warn.getBoundingClientRect().height.toFixed(1)) : 0,
    button: button?.textContent?.trim() || "",
    disabled: !!button?.disabled,
    spent: Number(window.__SF?.progressionState?.()?.pointsSpent || 0),
  };
});
await snap("respec-combat-warn.png");
await page.evaluate(() => {
  const progression = window.__SF?.ctx?.progression;
  if (progression && window.__SF.__restoreCanEdit) {
    progression.canEdit = window.__SF.__restoreCanEdit;
    delete window.__SF.__restoreCanEdit;
  }
});
check("reset in combat pops the field-pressure warning instead of confirming",
  /Bloom pressure/.test(combatWarn.text) && combatWarn.hidden === false
    && combatWarn.display !== "none" && combatWarn.width > 40 && combatWarn.height > 16
    && combatWarn.button === "RESET DOCTRINE" && combatWarn.disabled === false
    && combatWarn.spent === 8,
  JSON.stringify(combatWarn));

// 3. Clicking the crown card routes the Vow into the same inspector.
await page.locator("[data-doctrine-vow]").click({ force: true });
await delay(200);
const afterVowClick = await page.evaluate(() => {
  const preview = document.querySelector("[data-doctrine-preview]");
  return {
    previewId: preview?.dataset.talentId,
    vowId: document.querySelector("[data-doctrine-vow]")?.dataset.capstoneId,
    vowPreviewed: document.querySelector("[data-doctrine-vow]")?.dataset.previewed,
    kicker: preview?.querySelector(".sf-doctrine__preview-titles small")?.textContent,
    action: preview?.querySelector('[data-doctrine-action="vow"]')?.textContent?.trim(),
    actionDisabled: preview?.querySelector('[data-doctrine-action="vow"]')?.disabled,
    talentsPreviewed: [...document.querySelectorAll("[data-doctrine-talent]")]
      .map((n) => n.dataset.previewed),
    visibleCards: [...document.querySelectorAll("[data-doctrine-talent]")]
      .filter((n) => getComputedStyle(n).display !== "none").length,
    view: document.querySelector("[data-doctrine-order-panel]")?.dataset.view,
  };
});
check("clicking the crown routes the Vow into the same inspector without hiding the rites",
  afterVowClick.previewId === afterVowClick.vowId && afterVowClick.vowPreviewed === "true"
    && /·\s*VOW$/.test(afterVowClick.kicker || "")
    && afterVowClick.talentsPreviewed.every((v) => v === "false")
    && afterVowClick.visibleCards === 4 && afterVowClick.view === "overview",
  JSON.stringify(afterVowClick));
await snap("vow-inspector-1440x900.png");

// 4. Binding the Vow from the inspector works and flips the crown state.
check("the Vow bind control is enabled once the order gate and a seal are met",
  afterVowClick.actionDisabled === false && /BIND VOW/.test(afterVowClick.action || ""),
  JSON.stringify({ action: afterVowClick.action, disabled: afterVowClick.actionDisabled }));
await page.locator('[data-doctrine-preview] [data-doctrine-action="vow"]').click({ force: true });
await page.waitForFunction(() => document.querySelector("[data-doctrine-vow]")?.dataset.equipped === "true",
  null, { timeout: 5000 });
await page.waitForFunction(() => !!document.querySelector("[data-doctrine-preview]")
  ?.contains(document.activeElement), null, { timeout: 5000 }).catch(() => {});
const afterBind = await page.evaluate(() => ({
  vowState: document.querySelector("[data-doctrine-vow]")?.dataset.state,
  equipped: document.querySelector("[data-doctrine-vow]")?.dataset.equipped,
  slotText: document.querySelector("[data-doctrine-vows] span[data-state='bound'] strong")?.textContent,
  action: document.querySelector('[data-doctrine-preview] [data-doctrine-action="vow"]')?.textContent?.trim(),
  focusInPreview: !!document.querySelector("[data-doctrine-preview]")?.contains(document.activeElement),
  previewStillVow: document.querySelector("[data-doctrine-preview]")?.dataset.talentId,
}));
check("binding from the inspector equips the Vow, fills a seal slot, and keeps focus",
  afterBind.equipped === "true" && afterBind.vowState === "equipped"
    && /UNBIND VOW/.test(afterBind.action || "") && afterBind.focusInPreview,
  JSON.stringify(afterBind));
await snap("vow-bound-1440x900.png");

// 5. Keyboard: the crown is reachable and Enter moves focus to its action.
await page.locator("[data-doctrine-talent]").first().click({ force: true });
await delay(150);
await page.locator("[data-doctrine-vow]").focus();
await delay(120);
const vowFocus = await page.evaluate(() => ({
  previewId: document.querySelector("[data-doctrine-preview]")?.dataset.talentId,
  vowId: document.querySelector("[data-doctrine-vow]")?.dataset.capstoneId,
  controls: document.activeElement?.getAttribute("aria-controls"),
}));
await page.keyboard.press("Enter");
await page.waitForFunction(() => !!document.querySelector("[data-doctrine-preview]")
  ?.contains(document.activeElement), null, { timeout: 5000 }).catch(() => {});
const vowEnter = await page.evaluate(() => ({
  focusInPreview: !!document.querySelector("[data-doctrine-preview]")?.contains(document.activeElement),
  activeAction: document.activeElement?.dataset?.doctrineAction || null,
}));
check("keyboard focus on the crown previews it and Enter reaches its inspector control",
  vowFocus.previewId === vowFocus.vowId && vowFocus.controls === "sf-doctrine-preview"
    && vowEnter.focusInPreview && vowEnter.activeAction === "vow",
  JSON.stringify({ vowFocus, vowEnter }));

// 6. Unbinding returns the crown to eligible.
await page.locator('[data-doctrine-preview] [data-doctrine-action="vow"]').click({ force: true });
await delay(300);
const afterUnbind = await page.evaluate(() => ({
  equipped: document.querySelector("[data-doctrine-vow]")?.dataset.equipped,
  state: document.querySelector("[data-doctrine-vow]")?.dataset.state,
  action: document.querySelector('[data-doctrine-preview] [data-doctrine-action="vow"]')?.textContent?.trim(),
}));
check("unbinding from the inspector releases the seal",
  afterUnbind.equipped === "false" && afterUnbind.state === "eligible"
    && /BIND VOW/.test(afterUnbind.action || ""),
  JSON.stringify(afterUnbind));

// 7. Switching orders keeps the inspector on a rite of the new order.
await page.locator('[data-doctrine-order="wing"]').click({ force: true });
await delay(250);
const afterSwitch = await page.evaluate(() => ({
  previewId: document.querySelector("[data-doctrine-preview]")?.dataset.talentId,
  firstCard: document.querySelector("[data-doctrine-talent]")?.dataset.talentId,
  vowId: document.querySelector("[data-doctrine-vow]")?.dataset.capstoneId,
}));
check("switching Orders resets the inspector to the new Order's first rite",
  afterSwitch.previewId === afterSwitch.firstCard && /^wing_/.test(afterSwitch.vowId || ""),
  JSON.stringify(afterSwitch));

check("no page or console errors", errors.length === 0, errors.join(" | "));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
await browser.close();
server.kill();
process.exit(results.every((r) => r.ok) ? 0 : 1);
