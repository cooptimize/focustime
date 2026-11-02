// @ts-nocheck
// Step 16 UI inspection: the Delivery view and its row menu. Meant for demo mode (--demo turns it on first), so no real
// data shows. Read-only: it opens Delivery and a ⋯ menu, and never clicks an item that writes. The launch token is never printed.
// Usage: node scripts/screenshot-step16.mjs <outDir> <light|dark> [--demo] [--now <ISO>] [--runtime <dir>]
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : "");
const runtime = arg("--runtime") || process.env.XDG_RUNTIME_DIR || tmpdir();
const launchUrl = JSON.parse(readFileSync(join(runtime, "coopilot", "launch.json"), "utf8")).url;
const out = process.argv[2] ?? "screenshots";
const scheme = process.argv[3] === "light" ? "light" : "dark";
const demo = process.argv.includes("--demo");
const nowArg = arg("--now");
const url = nowArg ? `${launchUrl}${launchUrl.includes("?") ? "&" : "?"}now=${encodeURIComponent(nowArg)}` : launchUrl;
const sizes = arg("--sizes") ? arg("--sizes").split(",").map((s) => s.split("x").map(Number)) : [[1920, 1080], [3840, 2160]];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--disable-gpu"] });
const errors = [];
const report = {};
const post = (page, action, input) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input]);
try {
  for (const [w, h] of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
    page.on("console", (m) => m.type() === "error" && errors.push(`${w} ${scheme}: ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`${w} ${scheme}: ${e.message}`));
    await page.goto(url);
    await page.waitForSelector(".topbar", { timeout: 15000 });
    if (demo) {
      await post(page, "demo.set", { on: false });
      await post(page, "demo.set", { on: true });
      await post(page, "ui.set_theme", { theme: scheme === "light" ? "cooptimize-light" : "cooptimize-dark" });
      await page.reload();
      await page.waitForSelector(".topbar", { timeout: 15000 });
      if (!(await page.getByText("Demo data").first().isVisible().catch(() => false))) throw new Error("Demo data tag missing: stopping");
    } else {
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), scheme === "light" ? "cooptimize-light" : "cooptimize-dark");
    }
    await page.waitForTimeout(1000);
    const shot = (n) => page.screenshot({ path: `${out}/s16-${n}-${w}-${scheme}.png` });
    await page.keyboard.press("5");
    await page.waitForSelector(".delivery .dl-client", { timeout: 60000 });
    await page.waitForTimeout(1500);
    report[`${w}`] = await page.evaluate(() => ({
      rows: document.querySelectorAll(".dl-row").length,
      signals: [...document.querySelectorAll(".dl-row .status-pill")].map((e) => e.textContent),
      reasons: [...document.querySelectorAll(".dl-reason")].map((e) => e.textContent),
      overflowX: document.querySelector(".delivery").scrollWidth > document.querySelector(".delivery").clientWidth,
    }));
    await shot("delivery");
    const more = page.locator(".dl-row .more").first();
    if (await more.count()) {
      await more.click();
      await page.waitForTimeout(400);
      report[`${w} menu`] = await page.evaluate(() => [...document.querySelectorAll("[role=menu] [role=menuitem], .menu li")].map((e) => e.textContent?.trim()).slice(0, 8));
      await shot("delivery-menu");
      await page.keyboard.press("Escape");
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(report, null, 1));
if (errors.length) console.log("Console errors:\n" + errors.join("\n"));
