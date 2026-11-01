// Step 14 UI inspection: DevOps write access in Settings > Clients, the DevOps write log in Settings > Data, drafts to
// add in DevOps in the Inbox, Plan the week and Plan the day, at 1920 and 3840, light and dark. Read-only: it opens
// views and never confirms anything. The launch token is never printed.
// Usage: node scripts/screenshot-step14.mjs [outDir]
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const launchUrl = JSON.parse(readFileSync(join(process.env.XDG_RUNTIME_DIR || tmpdir(), "coopilot", "launch.json"), "utf8")).url;
const out = process.argv[2] ?? "screenshots";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--disable-gpu"] });
/** @type {string[]} */
const errors = [];
try {
  for (const [w, h] of /** @type {const} */ ([[1920, 1080], [3840, 2160]])) {
    for (const scheme of /** @type {const} */ (["light", "dark"])) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
      page.on("console", (m) => m.type() === "error" && errors.push(`${w} ${scheme}: ${m.text()}`));
      page.on("pageerror", (e) => errors.push(`${w} ${scheme}: ${e.message}`));
      await page.goto(launchUrl);
      await page.waitForSelector(".topbar, header", { timeout: 15000 });
      await page.waitForTimeout(1500);
      const shot = (/** @type {string} */ n) => page.screenshot({ path: `${out}/s14-${n}-${w}-${scheme}.png` });
      await page.keyboard.press(",");
      await page.waitForSelector(".settings");
      await page.getByRole("button", { name: /^Clients/ }).first().click().catch(() => {});
      await page.waitForTimeout(500);
      await shot("settings-clients");
      await page.getByRole("button", { name: /^Data/ }).first().click().catch(() => {});
      await page.waitForTimeout(800);
      await shot("settings-data");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await page.keyboard.press("4");
      await page.waitForTimeout(800);
      await shot("inbox");
      await page.keyboard.press("w");
      await page.waitForTimeout(2500);
      await shot("planweek");
      await page.close();
    }
  }
} finally {
  await browser.close();
}
console.log(errors.length ? errors.join("\n") : "no console errors");
