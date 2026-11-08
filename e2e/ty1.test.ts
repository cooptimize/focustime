// TY-1: Today's timeline. The switch (shown, hidden, remembered; the list unchanged when off), Week's parts (overlapping
// meetings side by side, blocks, now line, Evening band, PTO), dragging (tray to timeline, move, resize, back to the
// tray, each with Undo), the keyboard, Timebox my day's placeholders on the timeline with no popup, nothing written
// outside FocusTime, and the phone by tap at 360. With FOCUSTIME_SHOTS: the screens for docs/ux/ty1.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const T = 240_000;
const MON = "2026-11-02";
const SHOTS = process.env.FOCUSTIME_SHOTS;
/** Both blocks on screen: a mouse can only drag to what is in the viewport. */
const TALL = { width: 1920, height: 1800 };
/** Only real writes count: `write.status` only reads whether writing is set up. */
const isWrite = (a: string) => a.startsWith("write.") && a !== "write.status";

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>;

const open = async (page: Page, hash = "#/today") => {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.reload();
};
const onTimeline = async (page: Page) => {
  await call(page, "ui.set_today_timeline", { show: true });
  await open(page);
  await page.locator(".today-tl .tt-block").first().waitFor();
};
/** Monday's timeboxes as "HH:MM-HH:MM" by to-do id. */
const boxes = async (page: Page, date = MON): Promise<Record<number, string>> => {
  const d = (await call(page, "week.load", {})).data;
  const out: Record<number, string> = {};
  for (const t of d.timeboxes) if (t.date === date && !t.removedAt) out[t.pickId] = `${t.start.slice(11, 16)}-${t.end.slice(11, 16)}`;
  return out;
};
const addPick = async (page: Page, title: string, size: string | null = "S", half = "PM", clientKey = "Northwind", date = MON) => (await call(page, "pick.add", { date, half, clientKey, intention: title, ...(size ? { size } : {}) })).data.pick.id as number;
const hoursBox = async (page: Page, n = 1) => (await page.locator(".today-tl .tt-hours").nth(n).boundingBox())!;
/** y on the hours of block n at minutes past its top (Northwind's block starts 12:30). */
const yAt = (b: { y: number; height: number }, minutes: number, span = 270) => b.y + (b.height * minutes) / span;
const drag = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 3, from.y + 8, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
};
const undo = (page: Page) => page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
const center = async (l: ReturnType<Page["locator"]>) => {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const trayRow = (page: Page, title: string) => page.locator(".tt-tray-row", { hasText: title });
const band = (page: Page, title: string) => page.locator(".today-tl .tbox:not(.tt-ph)", { hasText: title });
const placeholder = (page: Page, title: string) => page.locator(".today-tl .tt-ph", { hasText: title });

/** Records what leaves the browser and which actions run, to prove nothing goes outside FocusTime. */
function watch(page: Page) {
  const actions: string[] = [];
  const hosts = new Set<string>();
  page.on("request", (r) => {
    hosts.add(new URL(r.url()).hostname);
    if (r.url().includes("/api/action")) actions.push((JSON.parse(r.postData() ?? "{}") as { action?: string }).action ?? "");
  });
  return { actions, hosts };
}

/** A Monday like the brief's: two overlapping meetings in the afternoon and something in the evening (fictional, this page only). */
async function busyMonday(page: Page) {
  await page.route("**/api/action", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { action?: string };
    if (body.action !== "week.load") return route.continue();
    const res = await route.fetch();
    const j = (await res.json()) as any;
    const day = j?.data?.week?.days?.find((d: any) => d.date === MON);
    if (day) {
      const first = day.pm.events.find((p: any) => !p.event.isPersonal && !p.continuesBefore) ?? day.pm.events[0];
      const clone = structuredClone(first);
      clone.event.id = "ty1-overlap";
      clone.event.title = "Fabrikam design review";
      day.pm.events.push(clone);
      const eve = structuredClone(first);
      eve.event.id = "ty1-evening";
      eve.event.title = "Evening release window";
      eve.event.start = `${MON}T18:00:00-05:00`;
      eve.event.end = `${MON}T19:00:00-05:00`;
      day.evening = [...day.evening, eve];
    }
    return route.fulfill({ response: res, json: j });
  });
}

const shot = async (page: Page, name: string, fullPage = false) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
};
/** The phone: the timeline on screen; a full-page shot would strand the sticky bars mid-page. */
const phoneShot = async (page: Page, name: string, on = ".today-tl") => {
  if (!SHOTS) return;
  await page.locator(on).first().scrollIntoViewIfNeeded();
  await page.evaluate((sel) => window.scrollTo(0, (document.querySelector(sel)!.getBoundingClientRect().top + window.scrollY) - 70), on);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

describe.skipIf(!CHROMIUM)("TY-1: Today's timeline", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("the switch shows and hides the timeline, remembered; off is the list", async () => {
    const { page, errors } = await freshPage(h);
    await open(page);
    await page.locator(".today-blocks").waitFor();
    expect(await page.locator(".today-tl").count()).toBe(0);
    await shot(page, "01-today-list");
    await page.locator(".today-head .tl-toggle").click();
    await page.locator(".today-tl").waitFor();
    expect(await page.locator(".today-blocks").count()).toBe(0);
    await expect.poll(async () => (await call(page, "week.load", {})).data.ui.todayTimeline).toBe(true);
    await page.reload();
    await page.locator(".today-tl").waitFor();
    // B does the same, and the phone's own setting is left alone.
    await page.keyboard.press("b");
    await page.locator(".today-blocks").waitFor();
    await expect.poll(async () => (await call(page, "week.load", {})).data.ui.todayTimeline).toBe(false);
    expect((await call(page, "week.load", {})).data.ui.todayTimelinePhone).toBe(false);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("draws Week's parts: overlapping meetings side by side, blocks, now line, Evening band, PTO", async () => {
    const { page } = await freshPage(h);
    await busyMonday(page);
    await onTimeline(page);
    const cards = page.locator(".today-tl .tt-block");
    expect(await cards.count()).toBe(2);
    await expect.poll(() => cards.nth(0).locator(".card-client").textContent()).toBe("Cooptimize");
    expect(await cards.nth(0).locator(".status-pill").textContent()).toMatch(/At risk/);
    // Side by side, not stacked: the same top, different lefts.
    const pair = cards.nth(1).locator(".event", { hasText: /Fabrikam design review|Northwind/ });
    const twins = await pair.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.left, y: r.top })));
    expect(twins.length).toBeGreaterThanOrEqual(2);
    const overlap = twins.filter((a) => twins.some((b) => a !== b && Math.abs(a.y - b.y) < 1 && Math.abs(a.x - b.x) > 20));
    expect(overlap.length).toBeGreaterThanOrEqual(2);
    expect(await page.locator(".today-tl .timeline > .now-line").count()).toBeGreaterThan(0);
    await page.locator(".today-tl .evening-band", { hasText: "Evening release window" }).waitFor();
    await shot(page, "02-today-timeline", true);
    // PTO: a day off as on Week.
    await page.evaluate(() => (location.hash = "#/today/2026-11-05"));
    await page.locator(".today-tl .half.whole.pto").waitFor();
    expect(await page.locator(".today-tl .tt-block").count()).toBe(0);
    await page.close();
  }, T);

  it("drag: tray to timeline, move, resize, back to the tray, each with Undo; nothing leaves FocusTime", async () => {
    const { page, errors } = await freshPage(h, TALL);
    const net = watch(page);
    const id = await addPick(page, "Write the export notes", "S");
    await onTimeline(page);
    const row = trayRow(page, "Write the export notes");
    await row.waitFor();
    // S is an hour; dropped at about 2:00 (90 minutes down Northwind's block).
    let hb = await hoursBox(page);
    const from = await center(row);
    const target = { x: hb.x + 200, y: yAt(hb, 92) };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y - 40, { steps: 4 });
    await page.mouse.move(target.x, target.y, { steps: 2 });
    await page.locator(".today-tl .tt-ghost").waitFor();
    await shot(page, "04-drag-in-progress");
    await page.mouse.up();
    await expect.poll(() => boxes(page)).toEqual({ [id]: "14:00-15:00" });
    await expect.poll(() => row.count()).toBe(0);
    await undo(page);
    await expect.poll(() => boxes(page)).toEqual({});
    await expect.poll(() => row.count()).toBe(1);
    // In again, then move it down an hour.
    hb = await hoursBox(page);
    await drag(page, await center(row), { x: hb.x + 200, y: yAt(hb, 92) });
    await expect.poll(() => boxes(page)).toEqual({ [id]: "14:00-15:00" });
    const b = band(page, "Write the export notes");
    await b.waitFor();
    await page.waitForTimeout(200);
    let c = await center(b);
    await drag(page, c, { x: c.x, y: c.y + (hb.height * 60) / 270 });
    await expect.poll(() => boxes(page)).toEqual({ [id]: "15:00-16:00" });
    await undo(page);
    await expect.poll(() => boxes(page)).toEqual({ [id]: "14:00-15:00" });
    // Resize by its bottom edge: 30 minutes longer.
    await page.waitForTimeout(200);
    const edge = (await b.boundingBox())!;
    const ey = edge.y + edge.height - 2;
    await drag(page, { x: edge.x + edge.width / 2, y: ey }, { x: edge.x + edge.width / 2, y: ey + (hb.height * 30) / 270 });
    await expect.poll(() => boxes(page)).toEqual({ [id]: "14:00-15:30" });
    await undo(page);
    await expect.poll(() => boxes(page)).toEqual({ [id]: "14:00-15:00" });
    // Back to the tray takes the time away.
    await page.waitForTimeout(200);
    c = await center(b);
    await drag(page, c, await center(page.locator(".tt-tray").nth(1)));
    await expect.poll(() => boxes(page)).toEqual({});
    await trayRow(page, "Write the export notes").waitFor();
    await undo(page);
    await expect.poll(() => boxes(page)).toEqual({ [id]: "14:00-15:00" });
    expect(net.actions.some(isWrite)).toBe(false);
    expect([...net.hosts].every((x) => x === "localhost" || x === "127.0.0.1")).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("keyboard: T at the next free slot, Up and Down move, Shift resizes, Backspace un-timeboxes", async () => {
    const { page } = await freshPage(h);
    const id = await addPick(page, "Tidy the mapping sheet", "S");
    await onTimeline(page);
    const row = trayRow(page, "Tidy the mapping sheet");
    await row.waitFor();
    await row.focus();
    await page.keyboard.press("t");
    // The demo's first free stretch after Northwind's weekly status: 1:30 for an hour.
    await expect.poll(() => boxes(page).then((b) => b[id])).toBeDefined();
    const start = (await boxes(page))[id]!;
    expect(start).toMatch(/^13:30-14:30$/);
    const b = band(page, "Tidy the mapping sheet");
    await expect.poll(() => b.evaluate((el) => el === document.activeElement)).toBe(true);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => boxes(page).then((x) => x[id])).toBe("13:45-14:45");
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => boxes(page).then((x) => x[id])).toBe("13:30-14:30");
    await page.keyboard.press("Shift+ArrowDown");
    await expect.poll(() => boxes(page).then((x) => x[id])).toBe("13:30-14:45");
    await page.keyboard.press("Shift+ArrowUp");
    await expect.poll(() => boxes(page).then((x) => x[id])).toBe("13:30-14:30");
    await page.keyboard.press("Backspace");
    await expect.poll(() => boxes(page)).toEqual({});
    await expect.poll(() => row.evaluate((el) => el === document.activeElement).catch(() => false)).toBe(true);
    await page.close();
  }, T);

  it("Timebox my day: placeholders on the timeline, ✓, ✕, drag first, Accept all, Discard, no popup, nothing outside", async () => {
    const { page } = await freshPage(h, TALL);
    const net = watch(page);
    const a = await addPick(page, "Draft the rollout note", "S");
    const b = await addPick(page, "Check the delay alerts", "S");
    const c = await addPick(page, "Review the mapping", "S");
    await busyMonday(page);
    await open(page);
    await page.locator(".today-blocks").waitFor();
    await page.locator(".today-timebox").click();
    const bar = page.getByRole("group", { name: "Timebox my day" });
    await bar.waitFor();
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(await bar.textContent()).toMatch(/3 suggestions/);
    expect(await page.locator(".today-tl .tt-ph").count()).toBe(3);
    expect(await trayRow(page, "Draft the rollout note").count()).toBe(0);
    await shot(page, "05-timebox-placeholders", true);
    // ✕ drops one, which goes back to its tray (and frees the half hour after the next one).
    await page.getByRole("button", { name: "Drop Review the mapping" }).click();
    expect(await page.locator(".today-tl .tt-ph").count()).toBe(2);
    await trayRow(page, "Review the mapping").waitFor();
    // Drag a placeholder before accepting: the new time is kept when accepted.
    const ph = placeholder(page, "Draft the rollout note");
    const before = await ph.getAttribute("aria-label");
    const startBox = (await ph.boundingBox())!;
    const hb = await hoursBox(page);
    const grabY = startBox.y + startBox.height / 2;
    await drag(page, { x: startBox.x + 40, y: grabY }, { x: startBox.x + 40, y: grabY + (hb.height * 15) / 270 });
    await expect.poll(() => ph.getAttribute("aria-label")).not.toBe(before);
    // A meeting isn't a place to put it: dragged onto one, it bounces back.
    const moved = await ph.getAttribute("aria-label");
    const meeting = (await page.locator(".tt-block").nth(1).locator(".event", { hasText: "Northwind data model review" }).boundingBox())!;
    const grab2 = (await ph.boundingBox())!;
    await drag(page, { x: grab2.x + 40, y: grab2.y + 10 }, { x: grab2.x + 40, y: meeting.y + 10 });
    await page.waitForTimeout(100);
    expect(await ph.getAttribute("aria-label")).toBe(moved);
    expect(await boxes(page)).toEqual({});
    // ✓ accepts one, at its new time.
    const wanted = /(\d+:\d+)–(\d+:\d+)/.exec(moved!)!;
    await page.getByRole("button", { name: "Accept Draft the rollout note" }).click();
    await expect.poll(() => boxes(page).then((x) => x[a])).toBeDefined();
    const got = (await boxes(page))[a]!;
    const h12 = (s: string) => { const [hh, mm] = s.split(":"); return `${Number(hh) % 12 || 12}:${mm}`; };
    expect(got.split("-").map(h12)).toEqual([wanted[1], wanted[2]]);
    // Accept all: the rest.
    await bar.getByRole("button", { name: "Accept all" }).click();
    await expect.poll(() => boxes(page).then((x) => Object.keys(x).length)).toBe(2);
    await expect.poll(() => page.getByRole("group", { name: "Timebox my day" }).count()).toBe(0);
    await page.waitForTimeout(200);
    await shot(page, "06-after-accept-all", true);
    await undo(page);
    await expect.poll(() => boxes(page).then((x) => x[b])).toBeUndefined();
    // Discard writes nothing.
    await page.locator(".today-timebox").click();
    await bar.waitFor();
    await bar.getByRole("button", { name: "Discard" }).click();
    expect(await page.locator(".today-tl .tt-ph").count()).toBe(0);
    expect((await boxes(page))[c]).toBeUndefined();
    expect(net.actions.filter(isWrite)).toEqual([]);
    expect([...net.hosts].every((x) => x === "localhost" || x === "127.0.0.1")).toBe(true);
    await page.close();
  }, T);

  it("Today and Week's same day side by side look like one system (screenshots only)", async () => {
    if (!SHOTS) return;
    // Today tall enough to show whole; Week at 1080, where an hour is the same height on both (its hours fill the window).
    const { page } = await freshPage(h, TALL);
    await addPick(page, "Align the release notes", "S");
    await busyMonday(page);
    await onTimeline(page);
    await page.waitForTimeout(300);
    const left = await page.locator(".today-tl").screenshot();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await open(page, "#/week");
    await page.locator("main.grid").waitFor();
    await page.waitForTimeout(500);
    const right = await page.locator(".day").first().screenshot();
    await page.close();
    const sheet = await h.browser.newPage({ viewport: { width: 1900, height: 1160 } });
    const img = (b: Buffer) => `<img src="data:image/png;base64,${b.toString("base64")}" style="display:block">`;
    await sheet.setContent(`<body style="margin:0;background:#0b1118;display:flex;gap:24px;padding:20px;align-items:flex-start">${img(left)}${img(right)}</body>`);
    await sheet.screenshot({ path: `${SHOTS}/03-today-beside-week.png` });
    await sheet.close();
  }, T);

  it("at the largest Text size (screenshots only)", async () => {
    if (!SHOTS) return;
    const { page } = await freshPage(h, TALL);
    await addPick(page, "Write the export notes", "S");
    await addPick(page, "Check the delay alerts", null);
    await call(page, "ui.set_text_size", { size: "larger" });
    await onTimeline(page);
    await page.waitForTimeout(300);
    await shot(page, "10-larger-text-timeline");
    await page.locator(".today-timebox").click();
    await page.getByRole("group", { name: "Timebox my day" }).waitFor();
    await page.waitForTimeout(200);
    await shot(page, "11-larger-text-placeholders");
    await call(page, "ui.set_text_size", { size: "default" });
    await page.close();
  }, T);

  // What iPhones do that Chromium's defaults don't: a larger root font, the document itself scrolling.
  for (const root of [17, 21]) {
    it(`phone at 360 with a ${root} px root font: nothing past the edge, the page scrolls`, async () => {
      const page = await h.browser.newPage({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, bypassCSP: true });
      await page.addInitScript((px) => {
        localStorage.setItem("focustime.hint.flow", "dismissed");
        document.addEventListener("DOMContentLoaded", () => {
          const st = document.createElement("style");
          st.textContent = `html{font-size:${px}px}`;
          document.head.append(st);
        });
      }, root);
      await page.goto(h.url);
      await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
      await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
      await page.locator("main.today-view").waitFor();
      await addPick(page, "Send the export note to the warehouse team before the cutover", "S");
      await call(page, "ui.set_today_timeline", { show: true, phone: true });
      await open(page);
      await page.locator(".today-tl .tt-block").first().waitFor();
      await page.locator(".today-timebox").click();
      await page.getByRole("group", { name: "Timebox my day" }).waitFor();
      const m = await page.evaluate(() => {
        const vw = window.innerWidth;
        const past = [...document.querySelectorAll(".today-tl *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 0.5; }).map((e) => e.className);
        const clipped = [...document.querySelectorAll<HTMLElement>(".tt-head .card-client, .tt-bar strong, .tt-ph .tbox-label")].filter((e) => e.scrollWidth > e.clientWidth + 1 && e.classList.contains("card-client")).map((e) => e.textContent);
        window.scrollTo(0, 400);
        return { sideways: document.documentElement.scrollWidth - vw, past, clipped, scrolled: window.scrollY, tall: document.documentElement.scrollHeight > window.innerHeight };
      });
      expect(m).toEqual({ sideways: 0, past: [], clipped: [], scrolled: 400, tall: true });
      await page.close();
    }, T);
  }

  it("phone at 360: tap for a time, placeholders with Accept all, 44px, no sideways scroll", async () => {
    const { page, errors } = await freshPage(h, { width: 360, height: 740 });
    const net = watch(page);
    const id = await addPick(page, "Send the export note", "S");
    await addPick(page, "Close out the mapping", "M");
    await open(page);
    await page.locator(".ph-todos").waitFor();
    // MB-1's layout by default; the switch is in ⋯.
    expect(await page.locator(".today-tl").count()).toBe(0);
    await page.getByRole("button", { name: "View options for Today" }).click();
    await page.getByRole("menuitem", { name: /Timeline/ }).click();
    await page.locator(".today-tl").waitFor();
    await expect.poll(async () => (await call(page, "week.load", {})).data.ui.todayTimelinePhone).toBe(true);
    expect((await call(page, "week.load", {})).data.ui.todayTimeline).toBe(false);
    const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await noSideways()).toBe(true);
    await phoneShot(page, "07-phone-timeline");
    // Tap a to-do, Pick a time, a quarter hour from the list.
    const row = trayRow(page, "Send the export note");
    await row.locator(".pr-title").click();
    await page.getByRole("button", { name: "Pick a time" }).click();
    const times = page.locator(".tt-times button");
    await times.first().waitFor();
    expect((await times.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await shot(page, "08-phone-pick-a-time");
    await times.nth(1).click();
    await expect.poll(() => boxes(page).then((x) => x[id])).toBeDefined();
    const first = (await boxes(page))[id];
    // Tap the band: Move and Un-timebox.
    const b = band(page, "Send the export note");
    await b.waitFor();
    await b.click();
    await page.getByRole("button", { name: "Move" }).click();
    await times.first().click();
    await expect.poll(() => boxes(page).then((x) => x[id])).not.toBe(first);
    await b.click();
    await page.getByRole("button", { name: "Un-timebox" }).click();
    await expect.poll(() => boxes(page).then((x) => x[id])).toBeUndefined();
    // Timebox my day: placeholders with ✓ and ✕, and an Accept all bar.
    await page.locator(".today-timebox").click();
    const bar = page.getByRole("group", { name: "Timebox my day" });
    await bar.waitFor();
    expect(await page.locator(".today-tl .tt-ph").count()).toBe(2);
    expect((await page.getByRole("button", { name: "Accept Send the export note" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await bar.getByRole("button", { name: "Accept all" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await noSideways()).toBe(true);
    await phoneShot(page, "09-phone-placeholders", ".tt-bar");
    await bar.getByRole("button", { name: "Accept all" }).click();
    await expect.poll(() => boxes(page).then((x) => Object.keys(x).length)).toBe(2);
    expect(net.actions.filter(isWrite)).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
