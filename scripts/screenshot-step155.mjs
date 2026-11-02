// @ts-nocheck
// Step 15.5 UI inspection in demo mode (--demo turns it on first, so no real data shows): Settings > Notifications,
// Settings > You with "Start my VM without asking", and the sign-in screen's other ways in are not shown (signed in).
// Only demo actions; the launch token is never printed.
// Usage: node scripts/screenshot-step155.mjs <outDir> <light|dark> [--demo] [--runtime <dir>] [--sizes 1920x1080,3840x2160]
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : "");
const runtime = arg("--runtime") || process.env.XDG_RUNTIME_DIR || tmpdir();
const url = JSON.parse(readFileSync(join(runtime, "coopilot", "launch.json"), "utf8")).url;
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
    await page.locator(".person-chip").click();
    await page.locator(".set-nav").getByRole("button", { name: "Notifications" }).click();
    await page.waitForSelector(".set-notify");
    await shot("settings-notifications");
    await page.locator(".set-nav").getByRole("button", { name: "You" }).click();
    await page.waitForSelector(".set-account");
    await shot("settings-you");
    await page.close();
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("ok");
