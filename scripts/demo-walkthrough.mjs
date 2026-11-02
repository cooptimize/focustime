// The scripted demo (docs/demo.md), end to end in demo mode at 1920x1080: Week → Plan the week → Plan the day (select a
// block, add from the week's priorities, Done, Timebox my day) → Today → Start focus → Close out (close the loop on a
// follow-up). It turns demo mode on first and refuses to run if the top bar doesn't say "Demo data", so every change it
// makes lands in the in-memory demo store. The launch token is never printed.
// Usage: node scripts/demo-walkthrough.mjs <outDir> [light|dark] [--now <ISO>]
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const launchUrl = JSON.parse(readFileSync(join(process.env.XDG_RUNTIME_DIR || tmpdir(), "coopilot", "launch.json"), "utf8")).url;
const out = process.argv[2] ?? "docs/demo";
const scheme = process.argv[3] === "light" ? "light" : "dark";
const nowArg = process.argv.includes("--now") ? process.argv[process.argv.indexOf("--now") + 1] : "";
const url = nowArg ? `${launchUrl}${launchUrl.includes("?") ? "&" : "?"}now=${encodeURIComponent(nowArg)}` : launchUrl;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--disable-gpu"] });
/** @type {string[]} */
const errors = [];
/** @type {string[]} */
const steps = [];
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: scheme });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector(".topbar", { timeout: 15000 });
  await page.evaluate(() => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "demo.set", input: { on: true } }) }));
  await page.reload();
  await page.waitForSelector(".demo-tag", { timeout: 15000 });
  await page.evaluate(() => localStorage.setItem("coopilot.hint.flow", "dismissed"));
  await page.reload();
  await page.waitForSelector(".demo-tag", { timeout: 15000 });
  await page.waitForTimeout(1200);
  let n = 0;
  const shot = async (/** @type {string} */ name, /** @type {string} */ what) => {
    n += 1;
    const file = `${String(n).padStart(2, "0")}-${name}.png`;
    await page.screenshot({ path: `${out}/${file}` });
    steps.push(`${file}: ${what}`);
  };
  const ok = async (/** @type {string} */ what, /** @type {() => Promise<unknown>} */ f) => {
    try {
      await f();
    } catch (e) {
      throw new Error(`${what}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    }
  };

  await shot("today", "Today in demo mode: now, what's due, Plan today");
  await page.keyboard.press("2");
  await page.waitForTimeout(1200);
  await shot("week", "The week: focus blocks per client, meetings, follow-ups and this week's features on the cards");

  await page.keyboard.press("3");
  await page.waitForTimeout(800);
  await ok("open Plan the week", () => page.getByRole("button", { name: /^Plan the week/ }).first().click());
  await page.waitForTimeout(1200);
  await ok("go to this week", () => page.getByRole("button", { name: "Previous week" }).click());
  await page.waitForTimeout(1200);
  await shot("plan-week", "Plan the week: musts and nice to haves per client, fit in plain words");
  await ok("open a row menu", () => page.locator(".pw-row button.more").nth(1).click());
  await page.waitForTimeout(400);
  await shot("plan-week-menu", "Everything else about a week item lives in its ⋯ menu");
  await page.keyboard.press("Escape");

  await ok("open Plan the day", () => page.getByRole("button", { name: /^Plan the day/ }).first().click());
  await page.waitForTimeout(1200);
  await shot("plan-day", "Plan the day: your day on the left, what to add on the right");
  await ok("select the Northwind block", () => page.locator(".pd2-block").nth(1).locator(".pd2-block-name").click());
  await page.waitForTimeout(600);
  await shot("plan-day-northwind", "Select a block: the right pane follows it, the week's priorities first");
  for (let i = 0; i < 2; i += 1) {
    await ok(`add priority ${i + 1}`, () => page.locator(".pd2-right .pd2-sec").first().locator("button.pd2-plus").first().click());
    await page.waitForTimeout(700);
  }
  await shot("plan-day-added", "Two stories added with one click each; the block's fit line updates");
  await ok("Done", () => page.locator(".pd2-done").click());
  await page.waitForTimeout(1200);
  await shot("plan-day-done", "Done commits the day and offers Timebox my day");
  await ok("Timebox my day", () => page.locator(".pd2 .pd-committed button, .pd2 button").filter({ hasText: /^Timebox my day$/ }).first().click());
  await page.waitForTimeout(900);
  await shot("timebox-my-day", "Timebox my day: each pick placed into a free gap, shown first");
  await ok("apply timeboxes", () => page.locator(".timebox-myday button.commit, [aria-label='Timebox my day'] button.commit").first().click());
  await page.waitForTimeout(1200);
  await shot("plan-day-timed", "Picks now have times on their rows");

  await page.keyboard.press("1");
  await page.waitForTimeout(1000);
  await shot("today-planned", "Today: the planned picks, one large Start focus");
  await ok("Start focus", () => page.locator(".today-start").first().click());
  await page.waitForTimeout(1200);
  await shot("focus", "The focus screen: countdown, the one pick, next meeting");
  await ok("stop focus", () => page.getByRole("button", { name: /^Stop/ }).first().click());
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  await page.keyboard.press("e");
  await page.waitForTimeout(1200);
  await shot("close-out", "Close out: picks done or not, where you left off, open follow-ups");
  const row = page.locator(".follow-up-list li").first();
  await row.scrollIntoViewIfNeeded();
  await ok("Close the loop", () => row.getByRole("button", { name: "Close the loop" }).first().click());
  await page.waitForTimeout(400);
  await ok("choose how", () => row.getByRole("button", { name: "Teams" }).click());
  await shot("close-the-loop", "Close the loop: how, and an optional note");
  await ok("confirm close", () => row.locator("button[type=submit]").click());
  await page.waitForTimeout(1000);
  await shot("closed", "The follow-up is closed");
  const tag = await page.locator(".demo-tag").count();
  if (!tag) throw new Error("demo tag missing at the end");
} finally {
  await browser.close();
}
console.log(steps.join("\n"));
console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
