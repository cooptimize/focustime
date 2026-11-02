// @ts-nocheck
// Step 17 UI inspection in demo mode (turned on first, so no real data shows): screenshots of the given addresses.
// Usage: node scripts/screenshot-step17.mjs <runtime dir> <out dir> <dark|light> <W>x<H> <name>=<#hash>[@ready selector][!expand|!legend]...
import { chromium } from "playwright-core";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const [runtime, out, scheme, size, ...shots] = process.argv.slice(2);
const [w, h] = size.split("x").map(Number);
mkdirSync(out, { recursive: true });
const launch = JSON.parse(readFileSync(join(runtime, "coopilot", "launch.json"), "utf8")).url;
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
const post = (a, i) => page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [a, i]);
await page.goto(launch);
await page.waitForSelector(".topbar", { timeout: 60000 });
await post("demo.set", { on: false });
await post("demo.set", { on: true });
await post("ui.set_theme", { theme: scheme === "light" ? "cooptimize-light" : "cooptimize-dark" });
await page.evaluate(() => { localStorage.setItem("coopilot.hint.flow", "dismissed"); localStorage.setItem("coopilot.hint.picktime", "1"); });
await page.reload();
await page.waitForSelector(".demo-tag", { timeout: 30000 });
for (const s of shots) {
  const [name, rest] = s.split("=");
  const [hashSel, action] = rest.split("!");
  const [hash, sel] = hashSel.split("@");
  await page.evaluate((x) => (location.hash = x), hash);
  if (sel) await page.waitForSelector(sel, { timeout: 30000 });
  await page.waitForTimeout(1500);
  if (action === "expand") { const b = page.locator(".rm-expand:not([disabled])"); for (let i = 0; i < Math.min(3, await b.count()); i++) await b.nth(i).click(); await page.waitForTimeout(300); }
  if (action === "legend") { await page.getByRole("button", { name: "What do these mean?" }).click(); await page.waitForTimeout(300); }
  await page.screenshot({ path: `${out}/${w}-${scheme}-${name}.png`, fullPage: false });
}
console.log(errors.length ? errors.join("\n") : "no page errors");
await browser.close();
