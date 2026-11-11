// IB-2: the Everything timeline. Demo mode, clock pinned to Mon Nov 2, 9:30 AM. The rules are unit tests
// (ui/inbox/timeline.test.ts, ui/stamp.test.ts, actions/inbox-actions.test.ts); this is the main path in a real browser:
// the default view, sort, chips, the divider, deep links, the phone at 360 and scrolling 3,000 rows.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, openInboxView, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";

let h: Harness;
const T = 180_000;
const call = <D,>(page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: D; error?: string }>;
type Row = { key: string; at: string; views: string[]; title: string; personView?: string };
type List = { items: Row[]; now: string; lastLooked: string | null };
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
const titles = (page: Page) => page.locator(".ib-list-body .ib-row-title").allTextContents();
const main = (page: Page) => page.getByRole("main", { name: "Inbox" });
const chip = (page: Page, label: string | RegExp) => page.getByRole("group", { name: "Status" }).getByRole("button", { name: label });

/** Sets the marker before the Inbox is opened, between the demo's items, so some are new. */
async function markHalfway(page: Page): Promise<{ since: string; list: List }> {
  const list = (await call<List>(page, "inbox.list", {})).data;
  const ats = list.items.map((i) => Date.parse(i.at.replace(/\[.*\]$/, ""))).sort((a, b) => a - b);
  const since = new Date(ats[Math.floor(ats.length / 2)]!).toISOString();
  expect((await call(page, "inbox.looked", { at: since })).ok).toBe(true);
  return { since, list };
}

describe.skipIf(!CHROMIUM)("Everything (IB-2)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("is the default: every status in one list, by day, newest first; the sort is remembered", async () => {
    const { page, errors } = await freshPage(h);
    const { since } = await markHalfway(page);
    await page.keyboard.press("5");
    await main(page).locator(".ib-row").first().waitFor();
    expect(await main(page).locator(".ib-list-head h2").textContent()).toMatch(/^Everything \d+/);
    await expect.poll(async () => main(page).getByRole("button", { name: /^Everything/ }).getAttribute("aria-current")).toBe("page");
    expect(await page.locator(".ib-group-head.ib-day-head").first().textContent()).toMatch(/^Today|Yesterday|, /);
    const list = (await call<List>(page, "inbox.list", {})).data;
    // Part 0: Teammate has it stays folded out of Everything's active part.
    const awake = list.items.filter((i) => i.views.length && i.personView !== "teammate");
    const shownRows = await main(page).locator(".ib-row").count();
    expect(shownRows).toBe(awake.length);
    const tags = await main(page).locator(".ib-row-sub .ib-tag").allTextContents();
    for (const word of ["Needs you", "Done"]) expect(tags).toContain(word);
    const stamps = await main(page).locator(".ib-row-when").allTextContents();
    expect(stamps.some((s) => /^Today \d+:\d\d [AP]M$/.test(s))).toBe(true);
    expect(await main(page).locator(".ib-row-when").first().getAttribute("title")).toMatch(/\d+:\d\d:\d\d [AP]M [A-Z]{2,5}/);
    const newest = await titles(page);
    expect(since).toBeTruthy();
    // The divider is drawn at the boundary, and the rows above it carry the dot.
    const divider = main(page).locator(".ib-new-divider");
    await expect.poll(() => divider.count()).toBe(1);
    expect(await main(page).locator(".ib-row.new .ib-new-dot").count()).toBeGreaterThan(0);

    await main(page).getByRole("button", { name: /^Sort: newest/ }).click();
    await expect.poll(async () => (await titles(page))[0]).toBe(newest.at(-1));
    await page.reload();
    await main(page).locator(".ib-row").first().waitFor();
    await expect.poll(async () => (await titles(page))[0]).toBe(newest.at(-1));
    await main(page).getByRole("button", { name: /^Sort: oldest/ }).click();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the divider moves after I've been: the next visit has nothing new, and the server has the marker", async () => {
    const { page, errors } = await freshPage(h);
    const { since } = await markHalfway(page);
    await page.keyboard.press("5");
    await main(page).locator(".ib-new-divider").waitFor();
    // Seeing the divider moves the marker on the server (any device reads it from there).
    await expect.poll(async () => Date.parse((await call<List>(page, "inbox.list", {})).data.lastLooked ?? "0")).toBeGreaterThan(Date.parse(since));
    // Still there for this visit, so it doesn't vanish under me.
    expect(await main(page).locator(".ib-new-divider").count()).toBe(1);
    // Something arrives after this visit's read: on the next visit it alone is new, and the divider sits under it.
    await page.waitForTimeout(1100); // the store stamps to the second
    expect((await call(page, "capture.add", { text: "Arrived after I looked" })).ok).toBe(true);
    await page.keyboard.press("1");
    await page.locator("main.today-view").waitFor();
    await page.keyboard.press("5");
    await main(page).locator(".ib-row").first().waitFor();
    await expect.poll(() => main(page).locator(".ib-row.new").count()).toBe(1);
    expect(await main(page).locator(".ib-row.new .ib-row-title").textContent()).toBe("Arrived after I looked");
    expect(await main(page).locator(".ib-new-divider").count()).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("status chips filter with counts, Chatter is off until asked, the choice is remembered; a view on the left lights its chip", async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("5");
    await main(page).locator(".ib-row").first().waitFor();
    await expect.poll(() => chip(page, /^Chatter/).getAttribute("aria-pressed")).toBe("false");
    expect(await chip(page, /^Needs you/).getAttribute("aria-pressed")).toBe("true");
    const off = await main(page).locator(".ib-row").count();
    const chatterN = Number(await chip(page, /^Chatter/).locator(".count").textContent());
    await chip(page, /^Chatter/).click();
    await expect.poll(() => main(page).locator(".ib-row").count()).toBe(off + chatterN);
    await page.reload();
    await main(page).locator(".ib-row").first().waitFor();
    await expect.poll(() => chip(page, /^Chatter/).getAttribute("aria-pressed")).toBe("true");

    // A view on the left is Everything with only that status: one chip lit, the same rows as its count.
    await main(page).getByRole("button", { name: /^Promises/ }).first().click();
    await expect.poll(() => chip(page, /^Promises/).getAttribute("aria-pressed")).toBe("true");
    expect(await chip(page, /^Needs you/).getAttribute("aria-pressed")).toBe("false");
    expect(await main(page).locator(".ib-row").count()).toBe(Number(await chip(page, /^Promises/).locator(".count").textContent()));

    // A second chip goes back to Everything with both.
    await chip(page, /^Done/).click();
    await expect.poll(() => main(page).getByRole("button", { name: /^Everything/ }).getAttribute("aria-current")).toBe("page");
    expect(await chip(page, /^Promises/).getAttribute("aria-pressed")).toBe("true");
    expect(await chip(page, /^Done/).getAttribute("aria-pressed")).toBe("true");
    expect(await chip(page, /^Needs you/).getAttribute("aria-pressed")).toBe("false");

    // Text and clients combine with status.
    const before = await main(page).locator(".ib-row").count();
    const word = ((await titles(page))[0] ?? "").split(/\s+/)[0]!;
    await main(page).getByRole("searchbox", { name: "Filter the list" }).fill(word);
    await expect.poll(() => main(page).locator(".ib-row").count()).toBeLessThanOrEqual(before);
    await main(page).getByRole("searchbox", { name: "Filter the list" }).fill("");
    const firstClient = main(page).locator(".ib-clients input[type=checkbox]").nth(1);
    await firstClient.check();
    await expect.poll(async () => main(page).locator(".ib-row").count()).toBeLessThanOrEqual(before);
    await firstClient.uncheck();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("old deep links open their view, and an item's address keeps the place it was opened from", async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("5");
    for (const [slug, label] of [["needs-you", "Needs you"], ["promises", "Promises"], ["waiting", "Waiting on"], ["in-progress", "In progress"], ["captures", "Captures and drafts"], ["teammates", "Teammate has it"], ["done", "Done"], ["chatter", "Chatter"]] as const) {
      const m = await openInboxView(page, slug);
      await expect.poll(async () => (await m.locator(".ib-list-head h2").textContent())?.replace(/\s*\d+$/, "")).toBe(label);
      await expect.poll(() => m.getByRole("group", { name: "Status" }).locator('[aria-pressed="true"]').count()).toBe(1);
    }
    const m = await openInboxView(page, "promises");
    await m.locator(".ib-row").first().click();
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/inbox\/item\//);
    expect(await m.locator(".ib-list-head h2").textContent()).toMatch(/^Promises/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("timestamps in the detail pane are the shared words, with the full time on hover; J and K walk the timeline", async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("5");
    await main(page).locator(".ib-row").first().waitFor();
    await main(page).locator(".ib-row").first().click();
    const t = page.locator(".ib-pane .ib-detail-meta time");
    await t.waitFor();
    expect(await t.textContent()).toMatch(/^(Today|Yesterday) \d+:\d\d [AP]M$|^\w{3}, \w{3} \d+, \d+:\d\d [AP]M$/);
    expect(await t.getAttribute("title")).toMatch(/:\d\d [AP]M [A-Z]{2,5}/);
    const a = await page.evaluate(() => location.hash);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("j");
    await expect.poll(() => page.evaluate(() => location.hash)).not.toBe(a);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("day headings stick while their day scrolls", async () => {
    const { page } = await freshPage(h);
    await seedLong(page, 400);
    await page.keyboard.press("5");
    const head = main(page).locator(".ib-day-head").first();
    await head.waitFor();
    await page.evaluate(() => (document.querySelector(".ib-list-body")!.scrollTop = 600));
    await page.waitForTimeout(100);
    const [h1, top] = await page.evaluate(() => [[...document.querySelectorAll<HTMLElement>(".ib-day-head")].find((e) => { const b = document.querySelector(".ib-list-body")!.getBoundingClientRect().top; const t = e.getBoundingClientRect().top; return t >= b - 10 && t <= b + 10; })?.getBoundingClientRect().top ?? -1, document.querySelector(".ib-list-body")!.getBoundingClientRect().top]);
    expect(Math.abs(h1! - top!)).toBeLessThan(12);
    await page.close();
  }, T);

  it.skipIf(!SHOTS)("screenshots: spread over days, so the headings and stamps show (demo data, fictional names)", async () => {
    const { page, errors } = await freshPage(h);
    await spreadDates(page);
    await page.keyboard.press("5");
    await main(page).locator(".ib-new-divider").waitFor();
    await shot(page, "everything-newest");
    await main(page).locator(".ib-new-divider").scrollIntoViewIfNeeded();
    await shot(page, "everything-divider");
    await chip(page, /^Chatter/).click();
    await page.waitForTimeout(150);
    await shot(page, "chips-chatter-on");
    await chip(page, /^Chatter/).click();
    await page.waitForTimeout(150);
    await shot(page, "chips-chatter-off");
    await main(page).getByRole("button", { name: /^Sort: newest/ }).click();
    await page.waitForTimeout(150);
    await shot(page, "everything-oldest");
    await main(page).getByRole("button", { name: /^Sort: oldest/ }).click();
    await main(page).locator(".ib-row").nth(2).click();
    await page.locator(".ib-pane .ib-detail-meta time").waitFor();
    await page.locator(".ib-pane .ib-detail-meta time").hover();
    await page.waitForTimeout(150);
    await shot(page, "detail-timestamps");
    expect(errors).toEqual([]);
    await page.close();

    const phone = await h.browser.newPage({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, bypassCSP: true });
    await phone.addInitScript(() => localStorage.setItem("focustime.hint.flow", "dismissed"));
    await phone.goto(h.url);
    await phone.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
    await phone.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await phone.locator("main.today-view").waitFor();
    await spreadDates(phone);
    await phone.evaluate(() => (location.hash = "#/inbox"));
    await phone.locator(".ib-row").first().waitFor();
    await phone.locator(".ib-new-divider").first().waitFor({ state: "attached" });
    await shot(phone, "phone-everything");
    await phone.locator(".ib-pick-btn").first().click();
    const sheet = phone.getByRole("dialog", { name: "View and clients" });
    await sheet.waitFor();
    await shot(phone, "phone-sheet");
    await phone.close();
  }, T);

  it("3,000 items: few rows at first, more as it scrolls, and the scroll stays smooth", async () => {
    const { page, errors } = await freshPage(h);
    await seedLong(page, 3000);
    await page.keyboard.press("5");
    await main(page).locator(".ib-row").first().waitFor();
    expect(await main(page).locator(".ib-row").count()).toBeLessThanOrEqual(240);
    expect(await main(page).locator(".ib-list-head h2").textContent()).toMatch(/2250/); // Part 0: the quarter a teammate has are folded out of the count.
    const r = await page.evaluate(async () => {
      const el = document.querySelector<HTMLElement>(".ib-list-body")!;
      const times: number[] = [];
      let last = performance.now();
      let done = false;
      const tick = () => {
        const n = performance.now();
        times.push(n - last);
        last = n;
        if (!done) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      for (let i = 0; i < 240; i++) {
        el.scrollTop += 160;
        await new Promise((ok) => requestAnimationFrame(ok));
      }
      done = true;
      times.sort((a, b) => a - b);
      return { p95: times[Math.floor(times.length * 0.95)]!, frames: times.length, rows: document.querySelectorAll(".ib-row").length };
    });
    expect(r.rows).toBeGreaterThan(240);
    // A generous bound for a loaded CI machine; the number itself is logged and in the report.
    expect(r.p95).toBeLessThan(250);
    console.log(`IB-2 3,000 rows: p95 frame ${Math.round(r.p95)} ms over ${r.frames} frames, ${r.rows} rows drawn after the scroll`);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("phone at 360 with a 17 px root font: default Everything, sort and chips in the sheet, headings and the divider, no sideways scroll", async () => {
    const page = await h.browser.newPage({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, bypassCSP: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem("focustime.hint.flow", "dismissed");
      document.addEventListener("DOMContentLoaded", () => {
        const st = document.createElement("style");
        st.textContent = "html{font-size:17px}";
        document.head.append(st);
      });
    });
    await page.goto(h.url);
    await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await page.locator("main.today-view").waitFor();
    await markHalfway(page);
    await page.evaluate(() => (location.hash = "#/inbox"));
    await page.locator("main.ib-phone").waitFor();
    await page.locator(".ib-row").first().waitFor();
    const wide = () => page.evaluate(() => {
      const d = document.scrollingElement!;
      const over = [...document.querySelectorAll<HTMLElement>(".ib, .ib-sheet, .ib-row")].map((e) => e.scrollWidth - e.clientWidth);
      return { page: d.scrollWidth - d.clientWidth, worst: Math.max(0, ...over) };
    });
    expect(await page.locator(".ib-pick-btn").first().textContent()).toMatch(/Everything/);
    expect(await page.locator(".ib-day-head").count()).toBeGreaterThan(0);
    await page.locator(".ib-new-divider").waitFor();
    expect(await wide()).toEqual({ page: 0, worst: 0 });
    // The day heading sticks on the phone too, whichever element scrolls there.
    const stuck = await page.evaluate(async () => {
      const list = document.querySelector<HTMLElement>("main.ib-phone")!;
      const doc = document.scrollingElement!;
      const scroller = list.scrollHeight > list.clientHeight + 4 ? list : doc;
      scroller.scrollTop = 500;
      await new Promise((ok) => setTimeout(ok, 120));
      const heads = [...document.querySelectorAll<HTMLElement>(".ib-day-head")].map((e) => e.getBoundingClientRect().top);
      return { scroller: scroller === list ? "list" : "page", tops: heads, barBottom: document.querySelector(".topbar")!.getBoundingClientRect().bottom, scrolled: scroller.scrollTop };
    });
    console.log("IB-2 phone sticky:", JSON.stringify(stuck));
    expect(stuck.scrolled).toBeGreaterThan(100);
    expect(stuck.tops.some((t) => Math.abs(t - stuck.barBottom) < 3)).toBe(true);
    await page.evaluate(() => { document.querySelector("main.ib-phone")!.scrollTop = 0; document.scrollingElement!.scrollTop = 0; });
    await page.locator(".ib-pick-btn").first().click();
    const sheet = page.getByRole("dialog", { name: "View and clients" });
    await sheet.waitFor();
    await sheet.getByRole("radio", { name: "Oldest first" }).click();
    await sheet.getByRole("group", { name: "Status" }).getByRole("button", { name: /^Chatter/ }).click();
    expect(await wide()).toEqual({ page: 0, worst: 0 });
    await sheet.getByRole("button", { name: /^Show \d+/ }).click();
    await sheet.waitFor({ state: "detached" });
    expect(await wide()).toEqual({ page: 0, worst: 0 });
    await page.locator(".ib-row").first().click();
    await page.getByRole("dialog").locator("time").first().waitFor();
    expect(await wide()).toEqual({ page: 0, worst: 0 });
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});

/** The Inbox with `n` rows across many days; other calls go to the demo as usual. */
async function seedLong(page: Page, n: number): Promise<void> {
  const base = Date.parse("2026-11-02T14:00:00Z");
  const items = Array.from({ length: n }, (_, i) => ({ key: `v${i + 1}`, kind: "conversation", clientKey: i % 2 ? "northwind" : null, at: new Date(base - i * 47 * 60_000).toISOString(), views: [["needs_you", "teammates", "done", "in_progress"][i % 4]], title: `Thread number ${i + 1}`, who: "Alex Doe", where: "Delivery chat", due: null, dueAt: null, itemId: null, late: false, done: i % 4 === 2, snoozedUntil: null }));
  await page.route("**/api/action", async (route) => {
    const body = route.request().postDataJSON() as { action?: string };
    if (body.action !== "inbox.list") return route.continue();
    await route.fulfill({ json: { ok: true, data: { today: "2026-11-02", items, counts: {}, needsYou: 0, now: "2026-11-02T14:30:00Z", lastLooked: null, snoozeChoices: [] } } });
  });
}

/** For the screenshots only: the demo's rows spread over the last days (the demo stamps them all at its pinned clock). */
async function spreadDates(page: Page): Promise<void> {
  const HOUR = 3_600_000;
  const base = Date.parse("2026-11-02T14:25:00Z");
  const steps = [0.4, 0.9, 1.7, 3, 4.5, 20, 22, 26, 30, 44, 50, 70, 74, 96, 120, 150, 180, 8000];
  await page.route("**/api/action", async (route) => {
    const body = route.request().postDataJSON() as { action?: string };
    if (body.action !== "inbox.list") return route.continue();
    const res = await route.fetch();
    const j = (await res.json()) as { ok: boolean; data: List };
    j.data.items.forEach((it, i) => (it.at = new Date(base - steps[i % steps.length]! * HOUR - i * 60_000).toISOString()));
    j.data.lastLooked = new Date(base - 2 * HOUR).toISOString();
    await route.fulfill({ json: j });
  });
}
