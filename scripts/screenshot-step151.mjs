// @ts-nocheck
// Step 15.1 UI inspection: compact timelines on medium cards (on and off), the wide layout unchanged, the time editor
// from a ruler band, Timebox my day and what didn't fit. Meant for demo mode (--demo turns it on first), so no real data
// shows. Read-only except in demo mode, where it adds picks and timeboxes to the in-memory demo store only. Without
// --demo it never clicks anything that writes. The launch token is never printed.
// Usage: node scripts/screenshot-step151.mjs <outDir> <light|dark> [--demo] [--now <ISO>] [--runtime <dir>]
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
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--disable-gpu"] });
/** @type {string[]} */
const errors = [];
const report = {};
const post = (page, action, input) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input]);
try {
  for (const [w, h] of [[1920, 1080], [1366, 768], [3840, 2160]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
    page.on("console", (m) => m.type() === "error" && errors.push(`${w} ${scheme}: ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`${w} ${scheme}: ${e.message}`));
    await page.goto(url);
    await page.waitForSelector(".topbar", { timeout: 15000 });
    if (demo) {
      // Off and on again: a fresh in-memory demo store for each size.
      await post(page, "demo.set", { on: false });
      await post(page, "demo.set", { on: true });
      await post(page, "ui.set_theme", { theme: scheme === "light" ? "cooptimize-light" : "cooptimize-dark" });
      // Two timed picks on Monday (demo store only), so the rulers show pick bands.
      await post(page, "week.load", { weekStart: "2026-11-02" });
      const a = await post(page, "pick.add", { date: "2026-11-02", half: "AM", clientKey: "Cooptimize", intention: "Reporting refresh notes", size: "S" });
      const b = await post(page, "pick.add", { date: "2026-11-02", half: "PM", clientKey: "Northwind", intention: "Draft the export spec", size: "M" });
      const tb = await post(page, "timebox.add_many", { date: "2026-11-02", items: [
        { pickId: a.data.pick.id, start: "2026-11-02T09:30:00-05:00", end: "2026-11-02T10:15:00-05:00", outlook: false },
        { pickId: b.data.pick.id, start: "2026-11-02T13:30:00-05:00", end: "2026-11-02T14:45:00-05:00", outlook: false },
      ] });
      if (!tb.ok) throw new Error(`Seeding timeboxes failed: ${tb.error}`);
      await page.reload();
      await page.waitForSelector(".topbar", { timeout: 15000 });
      if (!(await page.getByText("Demo data").first().isVisible().catch(() => false))) throw new Error("Demo data tag missing: stopping");
    } else {
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), scheme === "light" ? "cooptimize-light" : "cooptimize-dark");
    }
    await page.waitForTimeout(1200);
    const shot = (n) => page.screenshot({ path: `${out}/s151-${n}-${w}-${scheme}.png` });
    await page.keyboard.press("2");
    await page.waitForTimeout(1500);
    const layout = await page.evaluate(() => (document.querySelector(".app")?.className.match(/\b(wide|medium|narrow)\b/) ?? [""])[0]);
    const count = () => page.evaluate(() => ({ rulers: document.querySelectorAll(".ruler").length, visible: [...document.querySelectorAll(".ruler")].filter((r) => getComputedStyle(r).display !== "none").length, bands: document.querySelectorAll(".ruler .tbox").length, events: document.querySelectorAll(".ruler .r-ev").length, toggle: document.querySelector(".timelines-toggle")?.textContent ?? null }));
    report[`${w} on`] = { layout, ...(await count()) };
    await shot("week-timelines-on");
    if (layout === "medium") {
      await page.keyboard.press("v");
      await page.waitForTimeout(500);
      report[`${w} off (V)`] = await count();
      await shot("week-timelines-off");
      await page.locator(".timelines-toggle").click();
      await page.waitForTimeout(500);
      report[`${w} on (switch)`] = await count();
      // A pick band on the ruler opens the time editor.
      const band = page.locator(".ruler .tbox").first();
      if (await band.count()) {
        await band.click();
        await page.waitForTimeout(500);
        report[`${w} band click`] = await page.evaluate(() => document.querySelector(".menu, [role=menu]")?.textContent?.slice(0, 120) ?? null);
        await shot("ruler-band-time-editor");
        await page.keyboard.press("Escape");
      }
      // Typing never toggles: V inside the capture box (demo only: nothing is saved without Enter, but stay safe).
      if (demo) {
      await page.keyboard.press("n");
      await page.waitForTimeout(400);
      await page.keyboard.type("v");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      report[`${w} after typing v`] = (await count()).toggle;
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(report, null, 1));
if (errors.length) console.log("Console errors:\n" + errors.join("\n"));
