// @ts-nocheck
// Step 16.3 UI inspection in demo mode (--demo turns it on first, so no real data shows): the header VM chip on Today
// (no Today chip), its menu, Needs help from… with presence, Roadmap people with presence, deep focus on the focus
// screen with its Teams line, Settings > Focus (Teams status) and Settings > Data (Teams status log), and Today after a
// started VM ("Running · off at 7:00 PM"). Only demo actions; the launch token is never printed.
// Usage: node scripts/screenshot-step163.mjs <outDir> <light|dark> [--demo] [--runtime <dir>] [--sizes 1920x1080,3840x2160] [--now ISO]
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : "");
const runtime = arg("--runtime") || process.env.XDG_RUNTIME_DIR || tmpdir();
const launch = JSON.parse(readFileSync(join(runtime, "coopilot", "launch.json"), "utf8")).url;
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
      localStorage.setItem("coopilot.hint.flow", "dismissed");
      localStorage.setItem("coopilot.hint.picktime", "1");
    });
    await page.reload();
    await page.waitForSelector(demo ? ".demo-tag" : ".topbar", { timeout: 30000 });
    const shot = (name) => page.screenshot({ path: `${out}/${w}-${scheme}-${name}.png` });
    const go = async (hash, ready) => {
      await page.evaluate((x) => (location.hash = x), hash);
      await page.waitForSelector(ready, { timeout: 30000 });
      await page.waitForTimeout(900);
    };

    // Today: the VM prompt only; the chip is in the header.
    await go("#/today", ".today-view .mode-switch");
    await page.locator(".topbar .vm-chip").waitFor();
    await page.waitForTimeout(800);
    await shot("today-vm-prompt");
    await page.locator(".topbar .vm-chip").click();
    await page.waitForTimeout(300);
    await shot("vm-menu");
    await page.keyboard.press("Escape");

    // Needs help from… with presence.
    await go("#/week/plan/2026-11-02", ".planweek .done-btn");
    await page.locator(".pw-row button.more").first().click();
    await page.getByRole("menuitem", { name: /Needs help from/ }).click();
    await page.locator(".help-people .pres").first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    await shot("help-presence");
    await page.locator(".help-people .pres").first().focus();
    await page.waitForTimeout(200);
    await shot("help-presence-word");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // Roadmap people with presence.
    await go("#/roadmap", ".roadmap .mode-switch");
    await page.locator(".dl-row").first().waitFor({ timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shot("roadmap-presence");

    // Deep focus: the focus screen with its Teams line.
    await go("#/today", ".today-view .mode-switch");
    await post(page, "timer.start", { minutes: 50, deep: true });
    await page.evaluate(() => (location.hash = "#/focus"));
    await page.reload();
    await page.waitForSelector(".focus-screen .focus-deep", { timeout: 30000 });
    await page.locator(".teams-line").waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    await shot("focus-deep");
    await post(page, "timer.stop", {});
    await page.waitForTimeout(6000); // the server's tick clears the status (logged)
    await page.reload();
    await page.waitForSelector(".topbar .timer-btn", { timeout: 30000 });

    // Settings > Focus and > Data.
    await go("#/settings/focus", ".set-teams-access");
    await page.waitForTimeout(800);
    await shot("settings-focus");
    await go("#/settings/data", '[aria-label="Teams status log"]');
    await page.locator('[aria-label="Teams status log"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await shot("settings-teams-log");

    // Start the demo VM: the header chip says Running · off at 7:00 PM.
    await go("#/week", ".week-head .mode-switch");
    const st = await post(page, "vm.status", {});
    if (st.data?.vm && st.data.canStart) {
      await post(page, "vm.start_now", { vmId: st.data.vm.id });
      await page.waitForFunction(() => /Running/.test(document.querySelector(".topbar .vm-chip")?.textContent ?? ""), null, { timeout: 60000 }).catch(() => {});
    }
    await page.waitForTimeout(800);
    await shot("week-vm-running");
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
