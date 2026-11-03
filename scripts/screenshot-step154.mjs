// @ts-nocheck
// Step 15.4 UI inspection in demo mode (--demo turns it on first, so no real data shows): Today with the VM chip and
// the morning prompt, the VM menu, the Delay shutdown preview, Starting…, the "still changed" warning, Settings > You
// with Find my VM, the Azure write log, and the Inbox's kind chips. Only demo actions; the launch token is never printed.
// Usage: node scripts/screenshot-step154.mjs <outDir> <light|dark> [--demo] [--runtime <dir>] [--sizes 1920x1080,3840x2160]
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : "");
const runtime = arg("--runtime") || process.env.XDG_RUNTIME_DIR || tmpdir();
const url = JSON.parse(readFileSync(join(runtime, "focustime", "launch.json"), "utf8")).url;
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
    page.on("pageerror", (e) => errors.push(`${w} ${scheme}: ${e.message}`));
    await page.goto(url);
    await page.waitForSelector(".topbar", { timeout: 20000 });
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
    await page.waitForSelector(demo ? ".demo-tag" : ".topbar", { timeout: 20000 });
    await page.keyboard.press("Escape");
    await page.keyboard.press("1");
    await page.waitForSelector(".vm-banner", { timeout: 15000 });
    const shot = (name) => page.screenshot({ path: `${out}/${w}-${scheme}-${name}.png` });
    await shot("today-vm-prompt");
    await page.locator(".topbar .vm-chip").click();
    await page.waitForTimeout(300);
    await shot("vm-menu");
    await page.getByRole("menuitem", { name: /Delay shutdown 1h/ }).click();
    await page.waitForSelector(".vm-preview");
    await shot("vm-delay-preview");
    await page.locator(".vm-preview button.commit").click();
    await page.waitForTimeout(1200);
    await page.locator(".vm-banner button", { hasText: "Start" }).click();
    await page.waitForTimeout(1500);
    await shot("vm-starting");
    // A stop preview while focus runs shows the warning.
    await post(page, "timer.start", { minutes: 25 });
    await page.waitForTimeout(23000);
    await page.locator(".topbar .vm-chip").click();
    await page.getByRole("menuitem", { name: /Stop/ }).click();
    await page.waitForSelector(".vm-preview");
    await shot("vm-stop-preview");
    await page.keyboard.press("Escape");
    await post(page, "timer.stop", {});
    await page.locator(".person-chip").click();
    await page.getByRole("button", { name: "Find my VM" }).click();
    await page.waitForSelector(".vm-found");
    await shot("settings-you");
    await page.getByRole("button", { name: "Data", exact: true }).click();
    await page.waitForSelector('[aria-label="Azure write log"] table');
    await shot("azure-log");
    await page.keyboard.press("Escape");
    await page.keyboard.press("4");
    await page.waitForSelector(".cap-sort");
    await shot("inbox-sort-chips");
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(errors.length ? errors.join("\n") : "no page errors");
