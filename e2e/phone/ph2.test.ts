// PH-2: the phone's Week as day rows, a day at a glance, and the Inbox one at a time, in the browser (demo mode, a phone
// at 390 and 360 with the iPhone's 17 px root font). Clock: Tue Nov 3, 2026 10:30 AM ET: Monday past, the morning block
// under way, Thursday the demo's holiday (a day off), Friday the catch-up day. The line's rules have unit tests
// (plan/phone-week.test.ts); here, the main path of each part and what only a browser shows.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { call, phonePage } from "../mb1-helpers.ts";

const T = 240_000;
const MON = "2026-11-02";
const TUE = "2026-11-03";
const WED = "2026-11-04";

async function go(page: Page, hash: string) {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.reload();
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
}
const hash = (page: Page) => page.evaluate(() => location.hash);
type Loaded = { data: { plan: Record<string, { picks: { title: string; status: string }[] }> } };
const status = async (page: Page, date: string, title: string) => ((await call(page, "week.load", {})) as unknown as Loaded).data.plan[date]?.picks.find((p) => p.title === title)?.status;
/** Waits on a server round trip: as long as a busy CI runner needs, not the one second expect.poll gives by default. */
const poll: typeof expect.poll = (fn, o) => expect.poll(fn, { timeout: 15_000, ...(typeof o === "number" ? { timeout: o } : o) });
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function plan(page: Page) {
  const add = async (p: Record<string, unknown>, done = false) => {
    const r = (await call(page, "pick.add", p)) as unknown as { data?: { pick?: { id: number } } };
    if (done && r.data?.pick) await call(page, "pick.mark_done", { id: r.data.pick.id, done: true });
  };
  // Monday is past: its to-dos are the demo's own (one done, one not).
  await add({ date: TUE, half: "AM", clientKey: "Cooptimize", intention: "Tidy the export notes", size: "M" });
  await add({ date: WED, half: "AM", clientKey: "Northwind", intention: "Check the overnight load" });
}

describe.skipIf(!CHROMIUM)("PH-2: the phone's Week, a day at a glance, the Inbox one at a time", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-03T10:30:00-05:00");
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Week: a row per day with tiles and their lines, the special days, the evening and a weekend day; a tile opens its day; a swipe changes the week", async () => {
    const page = await phonePage(h, 390);
    await plan(page);
    await call(page, "deploy.add", { clientKey: "Northwind", date: WED, start: "19:00", end: "21:00", title: "Deployment - Northwind - Wed, Nov 4" });
    await call(page, "pick.add", { date: "2026-11-07", half: "AM", clientKey: "Cooptimize", intention: "Check the weekend backup" });
    await go(page, "#/week");
    const rows = page.locator(".pw-row");
    await rows.first().waitFor();
    // Mon to Fri, and Saturday for its to-do.
    expect(await rows.locator(".pw-wd").allTextContents()).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    const row = (wd: string) => rows.filter({ has: page.locator(".pw-wd", { hasText: wd }) });
    // Today marked, the day before quieter.
    expect(await row("Tue").getAttribute("class")).toContain("today");
    expect(await row("Tue").locator(".pw-day").getAttribute("aria-current")).toBe("date");
    expect(await row("Mon").getAttribute("class")).toContain("past");
    // Monday's morning ended with one of its two to-dos done; Tuesday's morning is under way.
    expect(await row("Mon").locator(".pw-tile").first().locator(".pw-line").textContent()).toBe("1 done · 1 not done");
    expect(await row("Tue").locator(".pw-tile.now .pw-line").textContent()).toMatch(/^Now · /);
    // Thursday: one tile, the holiday's name and that I'm off; Friday the catch-up day, as one tile.
    expect(await row("Thu").locator(".pw-tile").count()).toBe(1);
    expect(await row("Thu").locator(".pw-tile.pto .pw-line").textContent()).toBe("You're off");
    expect(await row("Fri").locator(".pw-tile.catchup .pw-name").textContent()).toBe("Catch-up");
    // Wednesday's evening: the first thing with its time (the demo's run club), then how many more (the deployment).
    expect(await row("Wed").locator(".pw-tile.eve .pw-line").textContent()).toBe("5:30 Run club · 1 more");
    // Saturday: the weekend tile with its to-do.
    expect(await row("Sat").locator(".pw-tile.weekend .pw-line").textContent()).toBe("Check the weekend backup");
    // A promise due tomorrow shows on Wednesday's row in the due badge's words.
    expect(await row("Wed").locator(".pw-due").textContent()).toMatch(/^Due tomorrow/);
    // The header stays in view; nothing sideways; every tile a full tap.
    expect(await page.locator(".pw-head").evaluate((e) => getComputedStyle(e).position)).toBe("sticky");
    expect(await noSideways(page)).toBe(0);
    expect(await page.locator(".pw-tile").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44).length)).toBe(0);
    // A tile opens its day; nothing on Week edits.
    expect(await page.locator(".pw input, .pw [contenteditable]").count()).toBe(0);
    await row("Wed").locator(".pw-tile").first().click();
    await poll(() => hash(page)).toBe(`#/day/${WED}`);
    await page.locator(".dg-headbar").waitFor();
    // Week from the day's header, then a swipe to next week and This week back.
    await page.locator(".dg-headbar").getByRole("button", { name: "Back to Week" }).click();
    await page.locator(".pw-row").first().waitFor();
    const before = await page.locator(".pw-title").textContent();
    const pw = page.locator(".pw");
    await pw.dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: 300, clientY: 400 }] });
    await pw.dispatchEvent("touchend", { changedTouches: [{ identifier: 1, clientX: 100, clientY: 410 }] });
    await poll(() => page.locator(".pw-title").textContent()).not.toBe(before);
    await page.getByRole("button", { name: "This week", exact: true }).click();
    await poll(() => page.locator(".pw-title").textContent()).toBe(before);
    await page.close();
  }, T);

  it("a day at a glance: another day's header, sections with status, to-dos, meetings and Add; a tick with Undo; the to-do's sheet; a day off; nothing planned", async () => {
    const page = await phonePage(h, 360);
    await plan(page);
    await go(page, `#/day/${WED}`);
    const head = page.locator(".dg-headbar");
    await head.waitFor();
    expect(await head.locator(".dg-date").textContent()).toBe("Wed, Nov 4");
    expect(await head.evaluate((e) => getComputedStyle(e).position)).toBe("sticky");
    // A section per block in time order, then Evening (the demo's run club).
    expect(await page.locator(".dg-block .dg-name").allTextContents()).toEqual(["Northwind", "Northwind", "Evening"]);
    const sections = page.locator(".dg-block[data-half]");
    // The morning: at risk with its reason, its to-do, its meetings in time order and the card's line.
    const am = sections.first();
    expect(await am.locator(".dg-risk").textContent()).toMatch(/^At risk · /);
    expect(await am.locator(".dg-meeting").count()).toBeGreaterThan(0);
    expect(await am.locator(".dg-line").textContent()).toMatch(/meetings? · .* free$/);
    // A day still to come doesn't tick, as on the computer (the past day below does, with Undo).
    const title = "Check the overnight load";
    expect(await am.getByRole("checkbox", { name: `Done: ${title}` }).isDisabled()).toBe(true);
    // The title opens the to-do's sheet.
    await page.locator(".dg-title", { hasText: title }).click();
    await page.getByRole("dialog", { name: `To-do: ${title}` }).waitFor();
    await page.keyboard.press("Escape");
    // Add opens the block's sheet.
    await am.getByRole("button", { name: "Add to Northwind" }).click();
    await page.locator("aside.block-panel").waitFor();
    await page.keyboard.press("Escape");
    expect(await noSideways(page)).toBe(0);
    // Previous day, then Today.
    await go(page, `#/day/${WED}`);
    await head.getByRole("button", { name: "Next day" }).click();
    await poll(() => page.locator(".dg-headbar .dg-date").textContent().catch(() => null)).not.toBe("Wed, Nov 4");
    // Thursday is the demo's holiday: the day says I'm off.
    expect(await page.locator(".day-view").textContent()).toMatch(/off/i);
    // A past day still ticks.
    await go(page, `#/day/${MON}`);
    await page.getByRole("checkbox", { name: "Done: Timesheet summary query" }).click();
    await poll(() => status(page, MON, "Timesheet summary query")).toBe("done");
    await page.locator(".undo-toast").getByRole("button", { name: /Undo/ }).click();
    await poll(() => status(page, MON, "Timesheet summary query")).toBe("planned");
    // Nothing planned: one line, and Add still there.
    await go(page, "#/day/2026-11-10");
    await page.locator(".dg-empty-day").waitFor();
    expect(await page.locator(".dg-empty-day").textContent()).toBe("Nothing planned Tuesday.");
    expect(await page.locator(".dg-add").count()).toBeGreaterThan(0);
    // Today: the Now card, then the sections, and the one thing headed Inbox.
    await go(page, "#/day");
    await page.locator(".pn-card").waitFor();
    await page.locator(".dg-block").first().waitFor();
    expect(await page.locator(".dg-headbar").count()).toBe(0);
    await page.close();
  }, T);

  it("the Inbox one at a time: what the bar counts, in order; Next, Previous and Up next move without acting; an action with Undo comes back; a form opens; the lists and back; the end", async () => {
    const page = await phonePage(h, 390);
    await go(page, "#/inbox");
    await page.locator(".io-card").waitFor();
    const count = Number(await page.locator(".bottom-bar .pb-count").textContent());
    expect(await page.locator(".io-of").textContent()).toBe(`1 of ${count}`);
    expect(await page.locator(".io-nextrow").count()).toBe(count - 1);
    // The first is the late promise (the one thing's order), as Day's one thing.
    expect(await page.locator(".io-card .ib-tag").first().textContent()).toMatch(/late/);
    const first = await page.locator(".io-card").getAttribute("data-key");
    // Next and Previous move without acting.
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await poll(() => page.locator(".io-card").getAttribute("data-key")).not.toBe(first);
    expect(await page.locator(".io-of").textContent()).toBe(`2 of ${count}`);
    // The address follows the item shown (a reload lands on it).
    const second = await page.locator(".io-card").getAttribute("data-key");
    await poll(() => hash(page)).toBe(`#/inbox/one/${second}`);
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await poll(() => page.locator(".io-card").getAttribute("data-key")).toBe(first);
    // Up next: a tap goes straight to it.
    const lastTitle = (await page.locator(".io-nexttitle").last().textContent())!;
    await page.locator(".io-nextrow").last().click();
    await poll(() => page.locator(".io-title").textContent()).toBe(lastTitle);
    expect(await page.locator(".io-of").textContent()).toBe(`${count} of ${count}`);
    // A suggestion's Create item opens its form (then the same preview as the lists).
    await go(page, "#/inbox");
    for (let i = 0; i < count && !(await page.locator(".io-card.suggestion").count()); i++) await page.getByRole("button", { name: "Next", exact: true }).click();
    const sug = (await page.locator(".io-card.suggestion").getAttribute("data-key"))!;
    await page.locator(".io-acts").getByRole("button", { name: /^Create item/ }).click();
    await page.locator(".ib-form").waitFor();
    // More holds the rest; Dismiss runs at once, the next item takes its place, and Undo brings it back.
    await page.locator(".io-acts").getByRole("button", { name: /^More actions/ }).click().catch(() => undefined);
    await page.locator(".io-acts").getByRole("button", { name: "Dismiss", exact: true }).click();
    await poll(() => page.locator(".io-card").getAttribute("data-key")).not.toBe(sug);
    await poll(() => page.locator(".bottom-bar .pb-count").textContent()).toBe(String(count - 1));
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await poll(() => page.locator(".io-card").getAttribute("data-key")).toBe(sug);
    // The lists, one tap from the top, and the way back.
    await page.locator(".io-lists").getByRole("button", { name: /^Promises/ }).click();
    await poll(() => hash(page)).toBe("#/inbox/promises");
    await page.getByRole("button", { name: "Back to what needs you, one at a time" }).click();
    await page.locator(".io-card").waitFor();
    // The end: each dealt with, then one line and the lists.
    for (let i = 0; i < 12 && (await page.locator(".io-card").count()); i++) {
      const key = await page.locator(".io-card").getAttribute("data-key");
      const pick = page.locator(".io-acts").getByRole("button", { name: /^(Dismiss|Not needed)$/ });
      if (!(await pick.count())) await page.locator(".io-acts .io-more").click();
      await pick.first().click();
      // In one read: asking a card for its key after counting it would wait on the last card once it has gone.
      await poll(() => page.evaluate(() => document.querySelector(".io-card")?.getAttribute("data-key") ?? "gone")).not.toBe(key);
    }
    await page.locator(".io-end").waitFor();
    expect(await page.locator(".io-end").textContent()).toBe("Nothing needs you now.");
    expect(await page.locator(".ib4-title").count()).toBe(1);
    expect(await noSideways(page)).toBe(0);
    await page.close();
  }, T);

  it("at 360 and the largest Text size: nothing sideways, every control of the three screens at least 44 px", async () => {
    const page = await phonePage(h, 360);
    await call(page, "ui.set_text_size", { size: "larger" });
    for (const [where, sel] of [["#/week", ".pw button"], [`#/day/${WED}`, ".dg-headbar button, .dg button:not(.mini)"], ["#/inbox", ".io button, .io a"]] as const) {
      await go(page, where);
      await page.locator(sel).first().waitFor();
      expect(await noSideways(page), where).toBe(0);
      const small = await page.locator(sel).evaluateAll((els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && Math.min(r.width, r.height) < 43.5; }).map((e) => e.className || e.textContent));
      expect(small, where).toEqual([]);
    }
    await call(page, "ui.set_text_size", { size: "default" });
    await page.close();
  }, T);

  it("at 1280: Week, Day and the Inbox as before; #/inbox/one/<key> opens that item in its list", async () => {
    const { page } = await freshPage(h, { width: 1280, height: 900 });
    await go(page, "#/week");
    await page.locator("main.grid").waitFor();
    expect(await page.locator(".pw, .dg, .io").count()).toBe(0);
    await go(page, "#/inbox/one/c1");
    await page.locator(".ib4").waitFor();
    expect(await page.locator(".io").count()).toBe(0);
    await page.close();
  }, T);
});
