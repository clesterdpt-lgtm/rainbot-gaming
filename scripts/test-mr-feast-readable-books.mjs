import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_BOOK_TEST_PORT || (47000 + (process.pid % 14000)));
const baseUrl = `http://127.0.0.1:${port}`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-readable-books");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function serverResponds() {
  try {
    return (await fetch(`${baseUrl}/games/mr-feast-mansion.html`, { cache: "no-store" })).ok;
  } catch (_) {
    return false;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await serverResponds()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function diagnostics(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

function watchErrors(page, errors) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(message.text());
  });
}

async function run() {
  const runtimeSource = await readFile(path.join(root, "assets/js/mr-feast-mansion.js"), "utf8");
  const pageSource = await readFile(path.join(root, "games/mr-feast-mansion.html"), "utf8");
  assert(/const READABLE_BOOK_CATALOG\s*=\s*Object\.freeze/.test(runtimeSource), "runtime is missing the readable-book catalog");
  assert(/class ReadableBookSystem/.test(runtimeSource), "runtime is missing the readable-book system");
  assert(/id="mansion-book-reader"[^>]+role="dialog"[^>]+aria-modal="true"/.test(pageSource), "page is missing the accessible book reader");
  assert(/id="mansion-book-annotation"[^>]+aria-label="Handwritten note"/.test(pageSource), "the shared reader is missing a separate handwritten marginalia layer");
  assert(/spineTitleInk:\s*"#14110e"/.test(runtimeSource) && /ctx\.fillStyle\s*=\s*READABLE_BOOKS\.spineTitleInk/.test(runtimeSource), "physical spine titles should use the named matte-black ink treatment");
  assert(!/createSpineTitleTexture\(title\)[\s\S]*?ctx\.shadowColor[\s\S]*?return texture;/.test(runtimeSource), "physical spine titles should not retain a bright shadow that reads as a glow");
  assert(/#mansion-book-annotation\s*\{[\s\S]*?font-style:\s*italic;[\s\S]*?letter-spacing:\s*-0\.025em;/.test(pageSource), "the XIII annotation should use compressed, hurried handwriting styling");
  assert(/#mansion-book-reader\[data-annotation-slot="left-margin"\][\s\S]*?rotate\(-2\.4deg\)\s*skewX\(-1\.6deg\)/.test(pageSource), "the handwritten clue should sit at a visibly rushed angle");

  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });

    const desktop = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const desktopErrors = [];
    watchErrors(desktop, desktopErrors);
    const desktopUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1&bookSeed=13013&view=readableBookLibrary&frame=1`;
    await desktop.goto(desktopUrl, { waitUntil: "domcontentloaded" });
    await desktop.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await desktop.waitForTimeout(350);

    let state = await diagnostics(desktop);
    const books = state.books;
    assert(books?.catalogSize === 20 && books.uniqueTitlesAssigned === 20, `the mansion should expose exactly 20 distinct lore books; books=${JSON.stringify(books)}`);
    assert(books.physicalCopies === 384 && books.assignedCopies === books.physicalCopies, `every one of the 384 physical shelf books should receive a readable assignment; books=${JSON.stringify(books)}`);
    assert(books.collections.LIBRARY > 0 && books.collections["READING ROOM"] > 0 && books.collections.ARCHIVE > 0, `books should be distributed through every mansion collection; collections=${JSON.stringify(books.collections)}`);
    assert(books.interactionTargets > 0 && books.interactionTargets <= 40, `books should use shelf-row interaction batching instead of hundreds of draw/raycast targets; books=${JSON.stringify(books)}`);
    assert(books.seed === 13013 && new Set(books.assignmentSample.slice(0, 20).map((entry) => entry.bookId)).size === 20, `one shuffled cycle should contain all 20 titles exactly once; books=${JSON.stringify(books)}`);
    assert(books.clueBookReserved === true, "the Contestant 13 clue-book slot should remain reserved from ordinary lore assignments");
    assert(books.spineTitles?.instances === books.physicalCopies, `every ordinary physical volume should render its assigned title on the spine; books=${JSON.stringify(books)}`);
    assert(books.spineTitles?.batches === books.catalogSize && books.spineTitles?.textures === books.catalogSize, `spine titles should stay batched by the 20-title catalog instead of creating one draw call/material per copy; books=${JSON.stringify(books)}`);
    const firstCycleBookIds = new Set(books.assignmentSample.slice(0, 20).map((entry) => entry.bookId));
    assert(firstCycleBookIds.has(books.clueBook?.printBookId) && books.clueBook?.title && books.clueBook?.previewLength >= 120, `the clue volume should borrow a complete printed title, author, and excerpt from the ordinary catalog; books=${JSON.stringify(books)}`);
    assert(books.spineTitles?.clueTitle === books.clueBook.title && books.spineTitles?.clueInstances === 1, `the reserved clue volume should print its selected lore title on the physical spine; books=${JSON.stringify(books)}`);
    assert(["left-margin", "right-margin", "lower-page"].includes(books.clueBook.annotationSlot), `the handwritten clue should receive one stable seeded location on the printed page; books=${JSON.stringify(books)}`);

    const lightLayoutBefore = await desktop.evaluate(() => window.MrFeastFresh.lightLayout());
    await desktop.waitForFunction(() => /read/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 10000 });
    const physicalPrompt = (await diagnostics(desktop)).prompt;
    assert(/^Read “.+”$/.test(physicalPrompt), `aiming at a physical spine should show its title; prompt=${JSON.stringify(physicalPrompt)}`);
    await desktop.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "titled-book-spines-desktop.png") });
    await desktop.keyboard.press("KeyE");
    await desktop.waitForFunction(() => !document.getElementById("mansion-book-reader")?.hidden);

    const reader = await desktop.evaluate(() => ({
      title: document.getElementById("mansion-book-title")?.textContent,
      author: document.getElementById("mansion-book-author")?.textContent,
      preview: document.getElementById("mansion-book-preview")?.textContent,
      modal: document.getElementById("mansion-book-reader")?.getAttribute("aria-modal"),
      focused: document.activeElement?.id,
    }));
    assert(reader.title && physicalPrompt.includes(reader.title), `the opened title should match the aimed-at spine; reader=${JSON.stringify(reader)} prompt=${physicalPrompt}`);
    assert(reader.author?.length >= 4 && reader.preview?.length >= 120, `each book should have an author line and substantial short excerpt; reader=${JSON.stringify(reader)}`);
    assert(reader.modal === "true" && reader.focused === "mansion-canvas", `book reader should remain modal while keeping focus on the pointer-lock canvas; reader=${JSON.stringify(reader)}`);
    state = await diagnostics(desktop);
    assert(state.books.open && state.books.active?.title === reader.title, `diagnostics should expose the open volume; books=${JSON.stringify(state.books)}`);
    await desktop.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "readable-book-desktop.png") });
    await desktop.keyboard.press("Escape");
    await desktop.waitForFunction(() => document.getElementById("mansion-book-reader")?.hidden);

    await desktop.evaluate(() => window.MrFeastFresh.openReadableBookForQA(1));
    await desktop.waitForFunction(() => !document.getElementById("mansion-book-reader")?.hidden);
    const secondTitle = await desktop.locator("#mansion-book-title").textContent();
    assert(secondTitle && secondTitle !== reader.title, "different physical placements should resolve to different titles within the first shuffled cycle");
    await desktop.locator("#mansion-book-close").click();
    const lightLayoutAfter = await desktop.evaluate(() => window.MrFeastFresh.lightLayout());
    assert(JSON.stringify(lightLayoutAfter) === JSON.stringify(lightLayoutBefore), `reading books must not alter the shader-light layout; before=${JSON.stringify(lightLayoutBefore)} after=${JSON.stringify(lightLayoutAfter)}`);

    await desktop.evaluate(() => window.MrFeastFresh.teleport("contestant13LibraryBook"));
    await desktop.waitForFunction((title) => (JSON.parse(window.render_game_to_text()).prompt || "").includes(title), books.clueBook.title, { timeout: 10000 });
    await desktop.keyboard.press("KeyE");
    await desktop.waitForFunction(() => JSON.parse(window.render_game_to_text()).contestant13?.bookRead && !document.getElementById("mansion-book-reader")?.hidden);
    const clueReader = await desktop.evaluate(() => {
      const preview = document.getElementById("mansion-book-preview");
      return {
        title: document.getElementById("mansion-book-title")?.textContent,
        author: document.getElementById("mansion-book-author")?.textContent,
        collection: document.getElementById("mansion-book-collection")?.textContent,
        preview: preview?.textContent,
        annotation: document.getElementById("mansion-book-annotation")?.textContent,
        kind: document.getElementById("mansion-book-reader")?.dataset.bookKind,
        annotationSlot: document.getElementById("mansion-book-reader")?.dataset.annotationSlot,
        previewFont: preview ? getComputedStyle(preview).fontFamily : "",
        annotationFont: getComputedStyle(document.getElementById("mansion-book-annotation")).fontFamily,
        annotationStyle: (() => {
          const style = getComputedStyle(document.getElementById("mansion-book-annotation"));
          return { fontStyle: style.fontStyle, letterSpacing: style.letterSpacing, transform: style.transform };
        })(),
      };
    });
    state = await diagnostics(desktop);
    assert(clueReader.title === books.clueBook.title && clueReader.author === `by ${books.clueBook.author}`, `the disguised clue volume should retain the selected catalog book's printed title and author; clue=${JSON.stringify(clueReader)} books=${JSON.stringify(books.clueBook)}`);
    assert(clueReader.kind === "clue" && clueReader.preview.length >= 120 && !/basement key is buried/i.test(clueReader.preview), `the main page copy should remain an ordinary printed lore excerpt rather than becoming the clue; clue=${JSON.stringify(clueReader)}`);
    assert(/hedge maze/i.test(clueReader.annotation || "") && /formal garden/i.test(clueReader.annotation || "") && /XIII/i.test(clueReader.annotation || ""), `a separate handwritten annotation should preserve both trail directions and signature; clue=${JSON.stringify(clueReader)}`);
    assert(/Georgia|serif/i.test(clueReader.previewFont) && /Bradley Hand|Segoe Print|Comic Sans|cursive/i.test(clueReader.annotationFont), `printed prose and handwritten marginalia need visibly different typography; clue=${JSON.stringify(clueReader)}`);
    assert(clueReader.annotationStyle.fontStyle === "italic" && Number.parseFloat(clueReader.annotationStyle.letterSpacing) < 0 && clueReader.annotationStyle.transform !== "none", `the marginalia should look compressed and angled as if XIII wrote it in a rush; clue=${JSON.stringify(clueReader)}`);
    assert(clueReader.annotationSlot === books.clueBook.annotationSlot && state.contestant13.bookRead && state.books.open && state.books.active?.kind === "clue", `the clue volume should retain its seeded annotation location and advance through the shared reader; books=${JSON.stringify(state.books)}`);
    await desktop.waitForTimeout(200);
    await desktop.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "printed-book-with-handwritten-marginalia-desktop.png") });
    await desktop.keyboard.press("Escape");
    await desktop.waitForFunction(() => document.getElementById("mansion-book-reader")?.hidden);
    await desktop.evaluate(() => {
      window.MrFeastFresh.teleport("readingRoom");
      window.advanceTime(180);
    });
    await desktop.waitForTimeout(180);
    await desktop.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "titled-book-spines-reading-room-desktop.png") });
    await desktop.evaluate(() => {
      window.MrFeastFresh.teleport("archiveWestAisle");
      window.advanceTime(180);
    });
    await desktop.waitForTimeout(180);
    await desktop.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "titled-book-spines-archive-desktop.png") });

    const alternate = await browser.newPage({ viewport: { width: 900, height: 650 } });
    const alternateErrors = [];
    watchErrors(alternate, alternateErrors);
    await alternate.goto(`${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&bookSeed=90210`, { waitUntil: "domcontentloaded" });
    await alternate.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    const alternateBooks = (await diagnostics(alternate)).books;
    assert(alternateBooks.seed === 90210 && JSON.stringify(alternateBooks.assignmentSample) !== JSON.stringify(books.assignmentSample), "different fresh-run seeds should reshuffle titles across the physical shelves");
    assert(alternateBooks.clueBook.printBookId !== books.clueBook.printBookId || alternateBooks.clueBook.annotationSlot !== books.clueBook.annotationSlot, `different seeds should vary the disguised clue print or handwritten placement; first=${JSON.stringify(books.clueBook)} alternate=${JSON.stringify(alternateBooks.clueBook)}`);

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobileErrors = [];
    watchErrors(mobile, mobileErrors);
    await mobile.goto(`${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&bookSeed=13013&frame=1`, { waitUntil: "domcontentloaded" });
    await mobile.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    const mobileQaOpen = await mobile.evaluate(() => ({
      opened: window.MrFeastFresh.openReadableBookForQA(4),
      hidden: document.getElementById("mansion-book-reader")?.hidden,
    }));
    assert(mobileQaOpen.opened && mobileQaOpen.hidden === false, `direct mobile QA should synchronously open the selected lore volume; result=${JSON.stringify(mobileQaOpen)}`);
    const mobileLayout = await mobile.evaluate(() => {
      const panel = document.querySelector(".mansion-book__page").getBoundingClientRect();
      const close = document.getElementById("mansion-book-close").getBoundingClientRect();
      return {
        panel: { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom },
        close: { width: close.width, height: close.height },
        viewport: { width: innerWidth, height: innerHeight },
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert(mobileLayout.panel.left >= 0 && mobileLayout.panel.top >= 0 && mobileLayout.panel.right <= mobileLayout.viewport.width && mobileLayout.panel.bottom <= mobileLayout.viewport.height, `mobile reader should fit inside the viewport; layout=${JSON.stringify(mobileLayout)}`);
    assert(mobileLayout.close.width >= 44 && mobileLayout.close.height >= 44 && !mobileLayout.horizontalOverflow, `mobile reader needs a touch-safe close control and no horizontal overflow; layout=${JSON.stringify(mobileLayout)}`);
    await mobile.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "readable-book-mobile.png") });
    await mobile.locator("#mansion-book-close").click();

    assert([...desktopErrors, ...alternateErrors, ...mobileErrors].length === 0, `browser errors: ${[...desktopErrors, ...alternateErrors, ...mobileErrors].join(" | ")}`);
    console.log("Mr. Feast readable books browser test: 20 shuffled titles, 384 batched spine labels, random printed clue volume with separate marginalia, lighting stability, and mobile layout passed");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast readable books browser test failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
