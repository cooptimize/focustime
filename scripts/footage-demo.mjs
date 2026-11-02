// @ts-nocheck -- a capture script driven by Playwright; checked by running it
// Explainer footage in demo mode (step 15): the footage 2 shot list and clips, re-captured with fictional data only.
// Demo mode is turned on first and every shot checks the "Demo data" tag. The same browser-side guard as footage 2
// refuses anything that could write outside Coopilot or change settings, timers or follow-ups; local plan changes go to
// the in-memory demo store, which is reset (demo off, then on) before each flow. The launch token is never printed.
// Usage: node scripts/footage-demo.mjs <outDir> [--now <ISO>] [--only shots|video]
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, renameSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const launchUrl = JSON.parse(readFileSync(join(process.env.XDG_RUNTIME_DIR || tmpdir(), "coopilot", "launch.json"), "utf8")).url;
const out = process.argv[2] ?? "footage";
const arg = (n, d = "") => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const NOW = arg("--now", "2026-11-02T11:05:00-05:00");
const SUNDAY = "2026-11-01T19:00:00-05:00";
const only = arg("--only");
const withNow = (now) => `${launchUrl}${launchUrl.includes("?") ? "&" : "?"}now=${encodeURIComponent(now)}`;
mkdirSync(`${out}/shots`, { recursive: true });
mkdirSync(`${out}/video`, { recursive: true });

// The footage 2 guard: refused before they reach the server.
const GUARDED = new Set([
  "write.confirm", "write.retry", "devops.confirm", "devops.retry", "devops.set_write_pat", "devops.clear_write_pat", "secret.set",
  "settings.save", "ui.set_theme", "ui.set_view_range", "hours.set_day", "hours.clear_day", "unavailable.add", "unavailable.remove", "flex.add", "flex.remove", "plan.reset",
  "timer.start", "timer.pause", "timer.resume", "timer.stop", "timer.extend", "timer.done", "timer.next",
  "link.open", "outlook.open", "playlist.open", "data.export", "auth.connect_microsoft", "auth.connect_google", "auth.connect_outlook_write", "auth.disconnect",
  "followup.close", "followup.not_needed", "followup.snooze", "followup.delete", "closeout.commit",
]);
/** @type {string[]} */ const blocked = [];
/** @type {string[]} */ const misses = [];
/** @type {string[]} */ const errors = [];
/** @type {string[]} */ const notDemo = [];

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--disable-gpu"] });

async function guard(page, label) {
  await page.route("**/api/action", async (route) => {
    let name = "";
    try {
      name = JSON.parse(route.request().postData() ?? "{}").action ?? "";
    } catch {}
    if (GUARDED.has(name)) {
      blocked.push(`${label}: ${name}`);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, status: 403, error: "Blocked during capture" }) });
    }
    return route.continue();
  });
  page.on("console", (m) => m.type() === "error" && !m.text().includes("403") && errors.push(`${label}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
}
const call = (page, action, input) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input]);
/** Fresh demo data: demo off, then on (a new in-memory store), then reload. */
async function freshDemo(page, now = NOW) {
  await page.goto(withNow(now));
  await page.waitForSelector(".topbar", { timeout: 15000 });
  await call(page, "demo.set", { on: false });
  await call(page, "demo.set", { on: true });
  await page.evaluate(() => {
    try {
      localStorage.setItem("coopilot.hint.flow", "dismissed");
      localStorage.setItem("coopilot.hint.picktime", "1");
    } catch {}
  });
  await page.reload();
  await page.waitForSelector(".demo-tag", { timeout: 15000 });
  await page.waitForTimeout(900);
}
const wait = (page, ms) => page.waitForTimeout(ms);
async function step(label, f) {
  try {
    await f();
  } catch (e) {
    misses.push(`${label}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  }
}
async function glide(page, loc, click = true) {
  const box = await loc.boundingBox({ timeout: 3000 });
  if (!box) throw new Error("not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await wait(page, 350);
  if (click) await loc.click({ timeout: 3000 });
}
const T = { add: (page) => page.locator(".pd2-right .pd2-sec").first().locator("button.pd2-plus") };

/** Plan the week on this week (the Plan tab, its chip, then back one week from next week). */
async function openPlanWeek(page) {
  await page.keyboard.press("Escape");
  await page.locator(".topbar").getByRole("button", { name: /^Plan/ }).first().click();
  await wait(page, 900);
  await page.locator(".ritual-bar").getByRole("button", { name: /^Plan the week/ }).first().click();
  await wait(page, 1500);
  await page.locator(".planweek").getByRole("button", { name: "Previous week" }).click();
  await wait(page, 1500);
}
async function openPlanDay(page) {
  await page.keyboard.press("p");
  await wait(page, 1200);
  await page.waitForSelector(".pd2", { timeout: 5000 });
}
/** Plan Monday: one pick in the morning, two in the afternoon, Done, Timebox my day. */
async function planMonday(page, slow = 0) {
  await openPlanDay(page);
  await step("add morning pick", async () => { await glide(page, T.add(page).first()); await wait(page, 600 + slow); });
  await step("select afternoon", async () => { await glide(page, page.locator(".pd2-block").nth(1).locator(".pd2-block-name")); await wait(page, 700 + slow); });
  for (let i = 0; i < 2; i += 1) await step(`add afternoon pick ${i}`, async () => { await glide(page, T.add(page).first()); await wait(page, 700 + slow); });
  await step("Done", async () => { await glide(page, page.locator(".pd2-done")); await wait(page, 1200 + slow); });
  await step("Timebox my day", async () => { await glide(page, page.locator(".pd2 button").filter({ hasText: /^Timebox my day$/ }).first()); await wait(page, 1200 + slow); });
  await step("apply timeboxes", async () => { await glide(page, page.locator("[aria-label='Timebox my day'] button.commit").first()); await wait(page, 1200 + slow); });
}

async function shots() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark" });
  await guard(page, "shots");
  const shot = async (name) => {
    if (!(await page.locator(".demo-tag").count())) notDemo.push(name);
    await page.screenshot({ path: `${out}/shots/${name}.png` });
  };
  await freshDemo(page);
  await planMonday(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("1");
  await wait(page, 1000);
  await shot("01-today-monday");

  await page.goto(withNow(SUNDAY));
  await page.waitForSelector(".demo-tag");
  await wait(page, 1200);
  await shot("02-today-sunday");
  await page.goto(withNow(NOW));
  await page.waitForSelector(".demo-tag");
  await wait(page, 1000);

  await page.keyboard.press("2");
  await wait(page, 1200);
  await shot("03-week");
  await step("hover Tue AM", async () => { await page.locator(".grid .half").nth(2).hover(); await wait(page, 500); });
  await shot("04-week-add-work-and-plan-buttons");
  await step("Tue AM details", async () => { await page.locator(".grid .half").nth(2).click(); await page.keyboard.press("Enter"); await wait(page, 900); });
  await shot("05-block-details-at-risk-tue-am");
  await page.keyboard.press("Escape");
  await step("Mon PM details", async () => { await page.locator(".grid .half").nth(1).click(); await page.keyboard.press("Enter"); await wait(page, 900); });
  await shot("06-block-details-at-risk-mon-pm");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await step("plan the week", () => openPlanWeek(page));
  await shot("07-plan-the-week");
  await step("health", async () => { await page.getByText("DevOps health").first().click(); await wait(page, 700); });
  await shot("08-plan-the-week-devops-health");
  await step("Northwind list", async () => { await page.locator(".pw-client").nth(1).scrollIntoViewIfNeeded(); await wait(page, 500); });
  await shot("09-plan-the-week-musts-fit-and-feature-without-stories");
  await step("row menu", async () => { await page.locator(".pw-row button.more").first().click(); await wait(page, 500); });
  await shot("09b-plan-the-week-row-menu");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await openPlanDay(page);
  await step("agendas", async () => { for (const b of await page.locator(".pd2-cal button, .pd2-cal summary").all()) await b.click(); await wait(page, 600); });
  await shot("10-planday-monday-committed-agenda");
  await step("everything else", async () => { await page.locator(".pd2-sec h4 .pd2-toggle").last().click(); await page.locator(".pd2-right").evaluate((e) => e.scrollTo(0, e.scrollHeight)); await wait(page, 600); });
  await shot("10b-planday-panes-scroll-on-their-own");
  await step("to Tuesday", async () => { await page.locator(".pd2-actions button").filter({ hasText: "›" }).first().click(); await wait(page, 1200); });
  await shot("11-planday-tuesday-empty");
  await shot("12-planday-add-pane");
  await step("select Atlas", async () => { await page.locator(".pd2-block").nth(1).locator(".pd2-block-name").click(); await wait(page, 600); });
  for (let i = 0; i < 3; i += 1) await step(`add Atlas ${i}`, async () => { await page.locator(".pd2-right button.pd2-plus").first().click(); await wait(page, 600); });
  await shot("13-planday-about-over");
  await step("trim", async () => { await page.locator(".pd2-fit .link-btn").first().click(); await wait(page, 500); });
  await shot("13b-planday-trim-highlight");
  await step("smaller", async () => { for (const c of (await page.locator(".pick-row.trim .size-chip").all()).slice(0, 2)) { await c.click(); await wait(page, 400); await c.click(); await wait(page, 500); } });
  await shot("14-planday-fits");
  await step("Done Tue", async () => { await page.locator(".pd2-done").click(); await wait(page, 1200); });
  await shot("15-planday-done-timebox-my-day-offer");
  await step("Timebox my day", async () => { await page.locator(".pd2 button").filter({ hasText: /^Timebox my day$/ }).first().click(); await wait(page, 1000); });
  await shot("16-timebox-my-day-proposal");
  await step("apply", async () => { await page.locator("[aria-label='Timebox my day'] button.commit").first().click(); await wait(page, 1200); });
  await shot("17-planday-picks-with-times");
  await step("time editor", async () => { await page.locator(".pt-time.timed").first().click(); await wait(page, 600); });
  await shot("18-time-editor");
  await page.keyboard.press("Escape");
  await step("untimed pick", async () => { await page.locator(".pd2-right button.pd2-plus").first().click(); await wait(page, 700); await page.locator(".pd2-left .pt-add").first().click(); await wait(page, 600); });
  await shot("19-plus-time-free-gaps");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await page.keyboard.press("2");
  await wait(page, 1200);
  await shot("20-week-after-done-with-times");
  await page.keyboard.press("m");
  await wait(page, 1200);
  await shot("21-checkin-monday");
  await page.keyboard.press("e");
  await wait(page, 1200);
  await shot("22-closeout-monday");
  await page.keyboard.press("4");
  await wait(page, 1200);
  await shot("23-inbox-follow-ups-and-drafts");
  await page.keyboard.press("Control+k");
  await wait(page, 700);
  await shot("24-command-menu");
  await page.keyboard.type("time", { delay: 60 });
  await wait(page, 500);
  await shot("25-command-menu-search");
  await page.keyboard.press("Escape");
  await page.keyboard.press("1");
  await wait(page, 500);
  await page.keyboard.press("?");
  await wait(page, 700);
  await shot("26-key-legend");
  await page.keyboard.press("Escape");

  await page.keyboard.press(",");
  await wait(page, 1200);
  const section = async (name, file, after) => {
    await step(`settings ${name}`, async () => { await page.locator(".set-nav button, .set-nav a").filter({ hasText: name }).first().click(); await wait(page, 900); if (after) await after(); });
    await shot(file);
  };
  await section("Planning", "27-settings-planning-use-timeboxing");
  await section("Clients", "28-settings-clients-devops-write-access");
  await section("Data", "29-settings-data-write-log");
  await step("devops log", async () => { await page.getByText("DevOps write log").first().scrollIntoViewIfNeeded(); await wait(page, 500); });
  await shot("29b-settings-data-devops-write-log");
  await section("Display", "30-settings-display-themes-and-demo-mode");
  await page.keyboard.press("Escape");

  await page.evaluate(() => (document.documentElement.dataset.theme = "cooptimize-light"));
  await page.keyboard.press("2");
  await wait(page, 1000);
  await shot("31-week-light-theme");
  await openPlanDay(page);
  await shot("32-planday-light-theme");
  await page.keyboard.press("Escape");
  await page.keyboard.press("1");
  await wait(page, 900);
  await shot("33-today-light-theme");
  await page.evaluate(() => (document.documentElement.dataset.theme = "cooptimize-dark"));

  await step("plan the week", () => openPlanWeek(page));
  await step("health open", async () => { await page.getByText("DevOps health").first().click(); await wait(page, 600); await page.getByRole("button", { name: /Draft (a )?feature/ }).first().click(); await wait(page, 600); });
  await shot("34-plan-the-week-epic-needs-features-draft-feature");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await page.keyboard.press("n");
  await wait(page, 600);
  await step("capture", async () => { await page.keyboard.type("@Harbor Add a print button to the intake summary", { delay: 25 }); await page.keyboard.press("Enter"); await wait(page, 800); });
  await shot("38-capture-sort-choices");
  await step("draft story", async () => { await page.getByRole("button", { name: /draft story/i }).first().click(); await wait(page, 800); });
  await shot("38a-capture-sorted-as-draft-story");
  await page.keyboard.press("Escape");
  await page.close();

  const wide = await browser.newPage({ viewport: { width: 3008, height: 1692 }, colorScheme: "dark" });
  await guard(wide, "wide");
  await wide.goto(withNow(NOW));
  await wide.waitForSelector(".demo-tag", { timeout: 15000 });
  await wide.keyboard.press("2");
  await wide.waitForTimeout(1500);
  await wide.screenshot({ path: `${out}/shots/40b-wide-timeline-full-3008.png` });
  await wide.screenshot({ path: `${out}/shots/40-wide-timeline-timed-picks.png`, clip: { x: 0, y: 0, width: 1504, height: 846 } });
  await wide.screenshot({ path: `${out}/shots/40c-wide-noon-event-drawn-once.png`, clip: { x: 0, y: 200, width: 1100, height: 1200 } });
  await wide.close();
}

async function clip(name, size, flow) {
  const ctx = await browser.newContext({ viewport: size, colorScheme: "dark", recordVideo: { dir: `${out}/video/tmp`, size: size.width > 1920 ? { width: 1920, height: 1080 } : size } });
  const page = await ctx.newPage();
  await guard(page, name);
  await freshDemo(page);
  await flow(page);
  if (!(await page.locator(".demo-tag").count())) notDemo.push(name);
  await wait(page, 1200);
  await ctx.close();
  const f = readdirSync(`${out}/video/tmp`).find((x) => x.endsWith(".webm"));
  if (f) renameSync(`${out}/video/tmp/${f}`, `${out}/video/${name}.webm`);
  rmSync(`${out}/video/tmp`, { recursive: true, force: true });
}

async function videos() {
  const HD = { width: 1920, height: 1080 };
  await clip("01-week", HD, async (p) => {
    await p.keyboard.press("2");
    await wait(p, 2500);
    for (const i of [0, 1, 2, 3, 4, 5]) await step("tour", async () => { await glide(p, p.locator(".grid .half").nth(i).locator(".half-label").first(), false); await wait(p, 1800); });
    await step("details", async () => { await glide(p, p.locator(".grid .half").nth(2).locator(".half-label").first()); await p.keyboard.press("Enter"); await wait(p, 4500); });
    await p.keyboard.press("Escape");
    await step("details 2", async () => { await glide(p, p.locator(".grid .half").nth(1).locator(".half-label").first()); await p.keyboard.press("Enter"); await wait(p, 4500); });
    await p.keyboard.press("Escape");
    await step("musts", async () => { await glide(p, p.locator(".cl-musts-btn")); await wait(p, 3500); });
    await p.keyboard.press("Escape");
    await wait(p, 2000);
  });
  await clip("02-plan-week", HD, async (p) => {
    await step("plan the week", () => openPlanWeek(p));
    await wait(p, 2500);
    await step("health", async () => { await glide(p, p.getByText("DevOps health").first()); await wait(p, 4000); });
    await step("scroll", async () => { await p.mouse.wheel(0, 500); await wait(p, 3000); await p.mouse.wheel(0, 500); await wait(p, 3000); });
    await step("blocks chip", async () => { await glide(p, p.locator(".pw-chip-btn").filter({ hasText: /block/ }).first()); await wait(p, 2500); await p.keyboard.press("Escape"); });
    await step("menu", async () => { await glide(p, p.locator(".pw-row button.more").first()); await wait(p, 4000); await p.keyboard.press("Escape"); });
    await step("stories", async () => { await glide(p, p.locator(".pw-chip-btn").filter({ hasText: /stor/ }).first()); await wait(p, 3500); });
    await p.mouse.wheel(0, -2000);
    await wait(p, 2000);
  });
  await clip("03-plan-day", HD, async (p) => {
    await openPlanDay(p);
    await wait(p, 2500);
    await step("add morning", async () => { await glide(p, T.add(p).first()); await wait(p, 2000); });
    await step("select pm", async () => { await glide(p, p.locator(".pd2-block").nth(1).locator(".pd2-block-name")); await wait(p, 2500); });
    for (let i = 0; i < 2; i += 1) await step("add pm", async () => { await glide(p, T.add(p).first()); await wait(p, 2000); });
    await step("trim", async () => { await glide(p, p.locator(".pd2-fit .link-btn").first()); await wait(p, 3000); });
    await step("smaller", async () => { const c = p.locator(".pick-row.trim .size-chip").first(); await glide(p, c); await wait(p, 800); await c.click(); await wait(p, 2500); });
    await step("follow-up", async () => { await glide(p, p.locator(".pd2-right .pd2-sec").nth(1).locator("button.pd2-plus").first()); await wait(p, 2500); });
    await step("Done", async () => { await glide(p, p.locator(".pd2-done")); await wait(p, 3500); });
  });
  await clip("04-checkin-closeout", HD, async (p) => {
    await planMonday(p);
    await p.keyboard.press("Escape");
    await p.keyboard.press("m");
    await wait(p, 4000);
    await p.mouse.wheel(0, 400);
    await wait(p, 3500);
    await step("close out chip", async () => { await glide(p, p.locator(".ritual-bar").getByRole("button", { name: /^Close out/ }).first()); });
    await wait(p, 4000);
    await p.mouse.wheel(0, 500);
    await wait(p, 3500);
    await step("close loop form", async () => { await p.locator(".follow-up-list li").first().scrollIntoViewIfNeeded(); await wait(p, 800); await glide(p, p.locator(".follow-up-list li").first().getByRole("button", { name: "Close the loop" }).first()); await wait(p, 3000); });
    await p.mouse.wheel(0, -900);
    await wait(p, 2500);
  });
  await clip("05a-plan-buttons-add-work", HD, async (p) => {
    await p.keyboard.press("2");
    await wait(p, 2500);
    await step("hover", async () => { await glide(p, p.locator(".grid .half").nth(2), false); await wait(p, 2000); });
    await step("add work", async () => { await glide(p, p.locator(".grid .half").nth(2).locator(".add-work")); await wait(p, 4000); });
    await p.keyboard.press("Escape");
    await wait(p, 1500);
    await step("feature link", async () => { await glide(p, p.locator(".feat-link, .grid .half .link-btn").first()); await wait(p, 4500); });
    await p.keyboard.press("Escape");
    await step("plan button", async () => { await glide(p, p.locator(".day-plan").nth(1)); await wait(p, 4000); });
  });
  await clip("05b-agenda-and-pick-time", HD, async (p) => {
    await planMonday(p);
    await step("agenda", async () => { await glide(p, p.locator(".pd2-cal button, .pd2-cal summary").nth(1)); await wait(p, 3500); });
    await step("editor", async () => { await glide(p, p.locator(".pt-time.timed").first()); await wait(p, 4000); await p.keyboard.press("Escape"); });
    await step("add untimed", async () => { await glide(p, p.locator(".pd2-right .pd2-sec").nth(1).locator("button.pd2-plus").first()); await wait(p, 2000); });
    await step("+ time", async () => { await glide(p, p.locator(".pd2-left .pt-add").first()); await wait(p, 3500); });
    await step("pick gap", async () => { await glide(p, p.locator(".popup-menu [role=menuitem]:not([disabled]):not([aria-disabled=true])").first()); await wait(p, 3500); });
  });
  await clip("05c-timebox-my-day", HD, async (p) => {
    await planMonday(p, 1500);
    await wait(p, 2500);
  });
  await clip("05d-draft-feature", HD, async (p) => {
    await step("plan the week", () => openPlanWeek(p));
    await wait(p, 2000);
    await step("health", async () => { await glide(p, p.getByText("DevOps health").first()); await wait(p, 3000); });
    await step("draft feature", async () => { await glide(p, p.getByRole("button", { name: /Draft (a )?feature/ }).first()); await wait(p, 1500); await p.keyboard.type("Route exceptions dashboard", { delay: 70 }); await wait(p, 1000); await p.keyboard.press("Enter"); await wait(p, 4000); });
  });
  await clip("05e-devops-write-access-and-logs", HD, async (p) => {
    await step("settings", async () => { await glide(p, p.locator(".topbar").getByRole("button", { name: "Settings" })); });
    await wait(p, 2000);
    for (const s of ["Clients", "Data", "Display"]) await step(s, async () => { await glide(p, p.locator(".set-nav button, .set-nav a").filter({ hasText: s }).first()); await wait(p, 4000); await p.mouse.wheel(0, 400); await wait(p, 3000); });
  });
  await clip("05f-capture-to-draft-story", HD, async (p) => {
    await p.keyboard.press("n");
    await wait(p, 1500);
    await p.keyboard.type("@Harbor Add a print button to the intake summary", { delay: 70 });
    await wait(p, 1000);
    await p.keyboard.press("Enter");
    await wait(p, 3000);
    await step("draft story", async () => { await glide(p, p.getByRole("button", { name: /draft story/i }).first()); await wait(p, 3500); });
    await p.keyboard.press("Escape");
    await p.keyboard.press("4");
    await wait(p, 4000);
  });
  await clip("05g-wide-timeline-bands", { width: 3008, height: 1692 }, async (p) => {
    await planMonday(p);
    await p.keyboard.press("Escape");
    await p.keyboard.press("2");
    await wait(p, 3000);
    await step("band", async () => { const b = p.locator(".tbox").first(); await glide(p, b, false); await b.click({ force: true }); await wait(p, 4000); });
    await p.keyboard.press("Escape");
    await wait(p, 2000);
  });
}

try {
  if (only !== "video") await shots();
  if (only !== "shots") await videos();
} finally {
  await browser.close();
}
console.log(`blocked by the guard: ${blocked.length ? blocked.join(", ") : "nothing"}`);
console.log(`shots without the Demo data tag: ${notDemo.length ? notDemo.join(", ") : "none"}`);
console.log(misses.length ? `steps that didn't run:\n${misses.join("\n")}` : "every step ran");
console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
