// @ts-nocheck
// Step 16.2 UI inspection in demo mode (--demo turns it on first, so no real data shows): every tab and mode by its
// address (Today: Now, Plan, Check-in, Close out; Week: Week, Plan the week; Roadmap: Roadmap, Plan ahead; Inbox), plus
// the top bar's ⋯ menu and the initials menu. Only demo actions; the launch token is never printed.
// Usage: node scripts/screenshot-step162.mjs <outDir> <light|dark> [--demo] [--runtime <dir>] [--sizes 1920x1080,3840x2160] [--now ISO]
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : "");
const runtime = arg("--runtime") || process.env.XDG_RUNTIME_DIR || tmpdir();
const launch = JSON.parse(readFileSync(join(runtime, "focustime", "launch.json"), "utf8")).url;
const url = arg("--now") ? `${launch}${launch.includes("?") ? "&" : "?"}now=${encodeURIComponent(arg("--now"))}` : launch;
const out = process.argv[2] ?? "screenshots";
const scheme = process.argv[3] === "light" ? "light" : "dark";
const demo = process.argv.includes("--demo");
const sizes = arg("--sizes") ? arg("--sizes").split(",").map((s) => s.split("x").map(Number)) : [[1920, 1080], [3840, 2160]];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--disable-gpu"] });
const errors = [];
const post = (page, action, input) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input]);
const PLACES = [
  ["today-now", "#/today", ".today-view .mode-switch"],
  ["today-plan", "#/today/plan", ".pd2-left"],
  ["today-checkin", "#/today/checkin", ".checkin .mode-switch"],
  ["today-closeout", "#/today/closeout", ".closeout .done-btn"],
  ["week", "#/week", ".week-head .mode-switch"],
  ["week-plan", "#/week/plan", ".planweek .done-btn"],
  ["roadmap", "#/roadmap", ".roadmap .mode-switch"],
  ["roadmap-ahead", "#/roadmap/ahead", ".plan-ahead-soon"],
  ["inbox", "#/inbox", ".inbox"],
];
try {
  for (const [w, h] of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(`${w} ${scheme}: ${e.message}`));
    await page.goto(url);
    await page.waitForSelector(".topbar", { timeout: 60000 });
    if (demo) {
      await post(page, "demo.set", { on: false });
      await post(page, "demo.set", { on: true });
      await post(page, "ui.set_theme", { theme: scheme === "light" ? "cooptimize-light" : "cooptimize-dark" });
    }
    await page.evaluate(() => {
      localStorage.setItem("focustime.hint.flow", "dismissed");
      localStorage.setItem("focustime.hint.picktime", "1");
    });
    await page.reload();
    await page.waitForSelector(demo ? ".demo-tag" : ".topbar", { timeout: 30000 });
    const shot = (name) => page.screenshot({ path: `${out}/${w}-${scheme}-${name}.png` });
    for (const [name, hash, ready] of PLACES) {
      await page.evaluate((h) => (location.hash = h), hash);
      await page.waitForSelector(ready, { timeout: 30000 });
      await page.waitForTimeout(900);
      await shot(name);
    }
    await page.evaluate(() => (location.hash = "#/today"));
    await page.waitForSelector(".today-view .mode-switch");
    await page.locator(".top-more").click();
    await page.waitForTimeout(300);
    await shot("menu-more");
    await page.keyboard.press("Escape");
    await page.locator(".person-chip").click();
    await page.waitForTimeout(300);
    await shot("menu-person");
    await page.keyboard.press("Escape");
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
