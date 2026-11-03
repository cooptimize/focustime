// @ts-nocheck
// Step 15.2 UI inspection in demo mode (--demo turns it on first, so no real data shows): Plan the day after adding
// (rows say "Already planned here"), ⋯ → Add to the plan (ordered targets, Different client), the top bar Focus button
// idle and running, Quick capture's client chip and tip, and the follow-up form's work item lookup. Only local demo
// actions; the launch token is never printed.
// Usage: node scripts/screenshot-step152.mjs <outDir> <light|dark> [--demo] [--now <ISO>] [--runtime <dir>] [--sizes 1920x1080,3840x2160]
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : "");
const runtime = arg("--runtime") || process.env.XDG_RUNTIME_DIR || tmpdir();
const launchUrl = JSON.parse(readFileSync(join(runtime, "focustime", "launch.json"), "utf8")).url;
const out = process.argv[2] ?? "screenshots";
const scheme = process.argv[3] === "light" ? "light" : "dark";
const demo = process.argv.includes("--demo");
const nowArg = arg("--now");
const url = nowArg ? `${launchUrl}${launchUrl.includes("?") ? "&" : "?"}now=${encodeURIComponent(nowArg)}` : launchUrl;
const sizes = arg("--sizes") ? arg("--sizes").split(",").map((s) => s.split("x").map(Number)) : [[1920, 1080], [3840, 2160]];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--disable-gpu"] });
const errors = [];
const post = (page, action, input) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input]);
try {
  for (const [w, h] of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
    page.on("pageerror", (e) => errors.push(`${w} ${scheme}: ${e.message}`));
    await page.goto(url);
    await page.waitForSelector(".topbar", { timeout: 15000 });
    if (demo) {
      // Off and on again: a fresh demo store for each size.
      await post(page, "demo.set", { on: false });
      await post(page, "demo.set", { on: true });
      // The demo config is in memory: the theme changes there only.
      await post(page, "ui.set_theme", { theme: scheme === "light" ? "cooptimize-light" : "cooptimize-dark" });
    }
    await page.evaluate(() => {
      localStorage.setItem("focustime.hint.flow", "dismissed");
      localStorage.setItem("focustime.hint.picktime", "1");
      localStorage.removeItem("focustime.hint.capturetag");
    });
    await page.reload();
    await page.waitForSelector(demo ? ".demo-tag" : ".topbar", { timeout: 15000 });
    await page.waitForTimeout(800);
    const shot = (name) => page.screenshot({ path: `${out}/${w}-${scheme}-${name}.png` });

    await page.keyboard.press("3");
    await page.waitForSelector(".pd2-left");
    await page.locator(".pd2-block .pd2-block-name", { hasText: "Northwind" }).click();
    for (let i = 0; i < 2; i++) {
      await page.locator(".pd2-right li.pd2-add:not(.planned) button.pd2-plus").first().click();
      await page.waitForTimeout(400);
    }
    await shot("plan-day-added");
    await page.locator(".pd2-right section[aria-label='Everything else'] .pd2-toggle").click();
    await page.locator(".pd2-right section[aria-label='Everything else'] button.more-btn").first().click();
    await page.getByRole("menuitem", { name: /^Add to the plan/ }).click();
    await page.waitForTimeout(300);
    await shot("add-to-the-plan");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    await page.keyboard.press("1");
    await page.waitForTimeout(500);
    await page.locator(".top-btn.timer-btn").click();
    await page.waitForTimeout(300);
    await shot("focus-menu");
    await page.getByRole("menuitem").first().click();
    await page.waitForTimeout(800);
    await page.keyboard.press("2");
    await page.waitForTimeout(800);
    await shot("focus-running");
    await post(page, "timer.stop", {});

    await page.keyboard.press("n");
    await page.locator(".cap-box input").pressSequentially("ask @harb");
    await page.waitForTimeout(300);
    await shot("capture-tag");
    await page.locator(".cap-box input").press("Tab");
    await page.locator(".cap-box input").pressSequentially("about the intake form");
    await shot("capture-chip");
    await page.keyboard.press("Escape");

    // Step 15.3: new follow-ups come from the capture box (Follow-up kind); the separate button is gone.
    await page.keyboard.press("4");
    await page.locator(".cap-box .cap-client").first().click();
    await page.locator(".cap-choose .chip-btn", { hasText: "Northwind" }).click();
    await page.locator(".cap-box input[aria-label='Quick capture']").fill("I'll send the export spec");
    await page.locator(".cap-box-kinds [role=radio]", { hasText: "Follow-up" }).click();
    await page.locator(".cap-box-fields .item-lookup input").fill("export");
    await page.waitForTimeout(300);
    await shot("follow-up-lookup");
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
