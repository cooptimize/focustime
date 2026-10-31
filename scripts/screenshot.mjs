// UI inspection: drives the system Chromium (no browser download) against the local dev server.
// Usage: node scripts/screenshot.mjs [baseUrl] [outDir]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:5317/";
const out = process.argv[3] ?? "screenshots";
mkdirSync(out, { recursive: true });

// A fixed clock inside the sample week (Tue Nov 3, 2026, 10:15 New York) so "today" is visible.
const now = "2026-11-03T10:15:00-05:00";

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--disable-gpu"] });
/** @type {string[]} */
const errors = [];
try {
  for (const scheme of /** @type {const} */ (["light", "dark"])) {
    const page = await browser.newPage({ viewport: { width: 3840, height: 1080 }, colorScheme: scheme });
    page.on("console", (m) => m.type() === "error" && errors.push(`${scheme}: ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`${scheme}: ${e.message}`));
    await page.goto(`${base}?now=${encodeURIComponent(now)}`);
    await page.waitForSelector(".half");
    await page.screenshot({ path: `${out}/week-${scheme}.png` });

    if (scheme === "light") {
      // Keyboard: today is Tue AM; go up/left to Mon AM (double-booked) and open details.
      await page.keyboard.press("ArrowLeft");
      await page.screenshot({ path: `${out}/mon-am-selected.png`, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
      await page.keyboard.press("Enter");
      await page.waitForSelector("dialog[open]");
      await page.screenshot({ path: `${out}/details-mon-am.png` });
      await page.keyboard.press("Escape");
      // Tue PM: the at-risk block
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await page.waitForSelector("dialog[open]");
      await page.screenshot({ path: `${out}/details-tue-pm.png` });
      await page.keyboard.press("Escape");
      // Next week has patterns only
      await page.keyboard.press("]");
      await page.screenshot({ path: `${out}/next-week.png` });
      await page.keyboard.press("t");
      const label = await page.textContent(".weeknav h1");
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
      console.log(`after t: ${label} | focused: ${focused}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error("Console errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log(`Screenshots in ${out}/`);
