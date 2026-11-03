// Step 15 UI inspection: Today with the context line, the week, Plan the day in two panes (a block selected, the
// right pane's three sections), Plan the week rows and a row menu, at 1920 and 3840. Meant for demo mode (it turns demo
// mode on first when --demo is passed), so no real data shows. Read-only: it opens views and menus and never confirms
// anything. The launch token is never printed.
// Usage: node scripts/screenshot-step15.mjs <outDir> <light|dark> [--demo] [--only 1920] [--now <ISO>]
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const launchUrl = JSON.parse(readFileSync(join(process.env.XDG_RUNTIME_DIR || tmpdir(), "focustime", "launch.json"), "utf8")).url;
const out = process.argv[2] ?? "screenshots";
const scheme = process.argv[3] === "light" ? "light" : "dark";
const demo = process.argv.includes("--demo");
const nowArg = process.argv.includes("--now") ? process.argv[process.argv.indexOf("--now") + 1] : "";
const url = nowArg ? `${launchUrl}${launchUrl.includes("?") ? "&" : "?"}now=${encodeURIComponent(nowArg)}` : launchUrl;
const only = process.argv.includes("--only") ? Number(process.argv[process.argv.indexOf("--only") + 1]) : 0;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--disable-gpu"] });
/** @type {string[]} */
const errors = [];
try {
  const sizes = /** @type {const} */ ([[1920, 1080], [3840, 2160]]).filter(([w]) => !only || w === only);
  for (const [w, h] of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
    page.on("console", (m) => m.type() === "error" && errors.push(`${w} ${scheme}: ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`${w} ${scheme}: ${e.message}`));
    await page.goto(url);
    await page.waitForSelector(".topbar", { timeout: 15000 });
    if (demo) {
      await page.evaluate(() => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "demo.set", input: { on: true } }) }));
      // Demo config lives in memory, so the theme can follow the shot without touching the real config.
      const theme = scheme === "light" ? "cooptimize-light" : "cooptimize-dark";
      await page.evaluate((t) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ui.set_theme", input: { theme: t } }) }), theme);
      await page.reload();
      await page.waitForSelector(".topbar", { timeout: 15000 });
    }
    // Live data: light and dark set only in the page, so the saved theme in the config is never written.
    if (!demo) await page.evaluate((t) => (document.documentElement.dataset.theme = t), scheme === "light" ? "cooptimize-light" : "cooptimize-dark");
    await page.waitForTimeout(1500);
    const shot = (/** @type {string} */ n) => page.screenshot({ path: `${out}/s15-${n}-${w}-${scheme}.png` });
    await page.keyboard.press("1");
    await page.waitForTimeout(800);
    await shot("today");
    await page.locator(".cl-musts-btn").first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
    await shot("musts-pop");
    await page.keyboard.press("Escape");
    await page.mouse.click(5, h - 5);
    await page.keyboard.press("2");
    await page.waitForTimeout(1500);
    await shot("week");
    await page.keyboard.press("3");
    await page.waitForTimeout(1000);
    await shot("plan");
    await page.getByRole("button", { name: /^Plan the day$/ }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    await shot("planday");
    await page.locator(".pd2-block").nth(1).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(600);
    await shot("planday-block2");
    await page.locator(".pd2-sec h4 .pd2-toggle").last().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(600);
    await shot("planday-rest");
    await page.keyboard.press("Escape");
    await page.keyboard.press("w");
    await page.waitForTimeout(1500);
    await shot("planweek-next");
    await page.getByRole("button", { name: "Previous week" }).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shot("planweek");
    await page.locator(".pw-row button.more").first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    await shot("planweek-menu");
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(errors.length ? errors.join("\n") : "no console errors");
