// @ts-nocheck
// Step 15.3 UI inspection in demo mode (--demo turns it on first, so no real data shows): the Inbox capture box with
// its kind chips and each kind's inline fields, the draft editor and Plan it, the week drop strip while dragging a
// right-pane row, the intention box's lookup, and Close out's capture box. Only local demo actions; the launch token
// is never printed.
// Usage: node scripts/screenshot-step153.mjs <outDir> <light|dark> [--demo] [--now <ISO>] [--runtime <dir>] [--sizes 1920x1080,3840x2160]
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
    const box = page.locator(".cap-box input[aria-label='Quick capture']").first();
    const client = async (n) => {
      await page.locator(".cap-box .cap-client").first().click();
      await page.locator(".cap-choose .chip-btn", { hasText: n }).click();
    };

    await page.keyboard.press("4");
    await page.waitForSelector(".inbox-capture");
    await client("Northwind");
    await box.fill("told Dana I'd send the export by Friday");
    await page.waitForTimeout(300);
    await shot("capture-follow-up");
    await box.fill("story: retry failed syncs");
    await page.locator(".cap-box-fields .item-lookup input").click();
    await page.waitForTimeout(500);
    await shot("capture-draft-story");
    await box.fill("feature: carrier rate cards");
    await page.waitForTimeout(400);
    await shot("capture-draft-feature");
    await box.fill("");

    await post(page, "draft.add_story", { clientKey: "Northwind", parentItemId: null, title: "Retry failed order syncs", size: "M" });
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("1");
    await page.keyboard.press("4");
    await page.locator(".dw-drafts-section .draft-title", { hasText: "Retry failed order syncs" }).click();
    const ed = page.locator(".draft-editor");
    await ed.getByLabel("Description").fill("Orders that fail to sync are retried three times, then flagged.");
    await ed.getByLabel(/Acceptance criteria/).fill("Given a failed sync, it retries up to three times.\nThen it shows on the failed list.");
    const look = ed.locator(".item-lookup input");
    await look.press("ArrowDown");
    await look.press("Enter");
    await page.waitForTimeout(400);
    await shot("draft-editor");
    await ed.getByRole("button", { name: "Plan it" }).click();
    await page.waitForTimeout(400);
    await shot("draft-plan-it");
    await page.keyboard.press("Escape");

    await page.keyboard.press("3");
    await page.waitForSelector(".pd2-left");
    await page.locator(".pd2-block .pd2-block-name", { hasText: "Northwind" }).click();
    const look2 = page.locator(".pd2-right .intention .item-lookup input");
    await look2.fill("export");
    await page.waitForTimeout(300);
    await shot("intention-lookup");
    await look2.fill("");
    await page.evaluate(() => document.activeElement?.blur());
    const row = page.locator(".pd2-right li.pd2-add[draggable=true]").first();
    const b = await row.boundingBox();
    await page.mouse.move(b.x + 40, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 60, b.y + b.height / 2 + 10, { steps: 4 });
    await page.waitForSelector(".pd2-weekstrip");
    const t = page.locator(".pd2-weekcard:not(.disabled)").nth(1);
    const tb = await t.boundingBox();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 6 });
    await page.waitForTimeout(200);
    await shot("drag-week-strip");
    await page.mouse.move(5, 5);
    await page.mouse.up();
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+k");
    await page.keyboard.type("Close out");
    await page.getByRole("menuitem", { name: /Close out/ }).first().click();
    await page.waitForSelector(".closeout .cap-box");
    await page.locator(".closeout .cap-box").scrollIntoViewIfNeeded();
    await shot("closeout-capture");
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
