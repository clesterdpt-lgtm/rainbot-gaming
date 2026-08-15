import { chromium } from "playwright";
import path from "path";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  const filePath = "file://" + path.resolve("games/quiet-quitting.html");
  console.log("Navigating to:", filePath);
  await page.goto(filePath);
  await page.waitForTimeout(600);

  const title = await page.title();
  console.log("Page Title:", title);

  const canvas = await page.$("#gameCanvas");
  console.log("Canvas element exists:", !!canvas);

  const hasOverlay = await page.$eval("#overlay", (el) => el.classList.contains("overlay--show"));
  console.log("Start overlay visible:", hasOverlay);

  // Click start / clock in
  await page.click("#btn-primary");
  await page.waitForTimeout(300);

  // Move player
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(1000);

  const scoreText = await page.$eval("#hud-score", (el) => el.textContent);
  console.log("Score after moving left:", scoreText);

  // Test sound toggle
  await page.click("#btn-sound");
  const soundText = await page.$eval("#btn-sound", (el) => el.textContent);
  console.log("Sound button text:", soundText);

  // Test pause toggle
  await page.click("#btn-pause");
  const isPaused = await page.$eval("#overlay-title", (el) => el.textContent);
  console.log("Overlay title on pause:", isPaused);

  // Resume
  await page.click("#btn-primary");
  await page.waitForTimeout(300);

  console.log("Errors encountered:", errors);
  await browser.close();

  if (errors.length > 0) {
    console.error("Test failed due to page errors!");
    process.exit(1);
  }
  console.log("All automated tests for Quiet Quitting passed successfully!");
}

run().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
