// Step 14.5 UI inspection: one pick row with three states (untimed "+ time", timed, timed on Outlook) on Today, the
// week card, Plan the day and the time editor, at 1920 and 3840. Run once per saved theme (light, dark) so the shots
// are true light and true dark. Read-only: it opens views and menus and never confirms anything. The launch token is
// never printed. Usage: node scripts/screenshot-step145.mjs <outDir> <light|dark>
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const launchUrl = JSON.parse(readFileSync(join(process.env.XDG_RUNTIME_DIR || tmpdir(), "focustime", "launch.json"), "utf8")).url;
const out = process.argv[2] ?? "screenshots";
const scheme = process.argv[3] === "light" ? "light" : "dark";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--disable-gpu"] });
/** @type {string[]} */
const errors = [];
try {
  for (const [w, h] of /** @type {const} */ ([[1920, 1080], [3840, 2160]])) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
    page.on("console", (m) => m.type() === "error" && errors.push(`${w} ${scheme}: ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`${w} ${scheme}: ${e.message}`));
    await page.goto(launchUrl);
    await page.waitForSelector(".topbar, header", { timeout: 15000 });
    await page.waitForTimeout(1500);
    const shot = (/** @type {string} */ n) => page.screenshot({ path: `${out}/s145-${n}-${w}-${scheme}.png` });
    await page.keyboard.press("1");
    await page.waitForTimeout(800);
    await shot("today");
    await page.locator(".pt-time.timed").first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    await shot("today-editor");
    await page.keyboard.press("Escape");
    await page.locator(".pt-add").first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    await shot("today-add");
    await page.keyboard.press("Escape");
    await page.keyboard.press("2");
    await page.waitForTimeout(1500);
    await shot("week");
    await page.keyboard.press("3");
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: /^Plan the day$/ }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    await shot("planday");
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(errors.length ? errors.join("\n") : "no console errors");
