// TY-2: the checklist beside each block on Today's timeline: the list view's rows in order, ticking with PK-1's offer and
// Undo, hover and click linked to the hours, drag both ways, the tray gone, hour labels on the left with the first hour,
// solid bands and dashed suggestions, the overlap marker, and the layout under 1100 px. With FOCUSTIME_SHOTS: docs/ux/ty2.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const T = 240_000;
const MON = "2026-11-02";
const SHOTS = process.env.FOCUSTIME_SHOTS;
const TALL = { width: 1920, height: 1800 };

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const at = (hhmm: string) => `${MON}T${hhmm}:00-05:00`;
const center = async (l: Locator) => {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const drag = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 3, from.y + 8, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
};
const boxes = async (page: Page) => Object.fromEntries((await call(page, "week.load", {})).data.timeboxes.filter((t: any) => t.date === MON && !t.removedAt).map((t: any) => [t.pickId, `${t.start.slice(11, 16)}-${t.end.slice(11, 16)}`])) as Record<number, string>; // eslint-disable-line @typescript-eslint/no-explicit-any
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
const row = (page: Page, title: string) => page.locator(".tt-check-row", { hasText: title });
const band = (page: Page, title: string) => page.locator(".today-tl .tbox:not(.tt-ph)", { hasText: title });
const undoToast = (page: Page) => page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();

type Ids = { query: number; chart: number; notes: number; alerts: number };
/** Monday confirmed: two DevOps to-dos in the morning, one with a time, and two typed ones in the afternoon. */
async function monday(page: Page): Promise<Ids> {
  expect((await call(page, "planday.start", { date: MON })).ok).toBe(true);
  const add = async (input: object) => (await call(page, "pick.add", { date: MON, ...input })).data.pick.id as number;
  const chart = await add({ half: "AM", clientKey: "Cooptimize", itemId: 4412 });
  const query = await add({ half: "AM", clientKey: "Cooptimize", itemId: 4411 });
  const notes = await add({ half: "PM", clientKey: "Northwind", intention: "Write the export notes", size: "S" });
  const alerts = await add({ half: "PM", clientKey: "Northwind", intention: "Check the delay alerts" });
  expect((await call(page, "timebox.add", { pickId: chart, date: MON, start: at("11:00"), end: at("12:00") })).ok).toBe(true);
  expect((await call(page, "timebox.add", { pickId: query, date: MON, start: at("10:00"), end: at("11:00") })).ok).toBe(true);
  await call(page, "ui.set_today_timeline", { show: true });
  return { query, chart, notes, alerts };
}
const open = async (page: Page) => {
  await page.evaluate(() => (location.hash = "#/today"));
  await page.reload();
  await page.locator(".today-tl .tt-check").first().waitFor();
};
/** Two meetings at the same time in the afternoon (fictional, this page only). */
async function overlapping(page: Page) {
  await page.route("**/api/action", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { action?: string };
    if (body.action !== "week.load") return route.continue();
    const res = await route.fetch();
    const j = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const day = j?.data?.week?.days?.find((d: any) => d.date === MON); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (day) {
      const first = day.pm.events.find((p: any) => !p.event.isPersonal && !p.continuesBefore) ?? day.pm.events[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
      const clone = structuredClone(first);
      clone.event.id = "ty2-overlap";
      clone.event.title = "Fabrikam design review";
      day.pm.events.push(clone);
    }
    return route.fulfill({ response: res, json: j });
  });
}

describe.skipIf(!CHROMIUM)("TY-2: the checklist beside Today's timeline", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("lists all of a block's to-dos: timed first in time order with their times, then Not timeboxed yet with sizes; the tray is gone", async () => {
    const { page, errors } = await freshPage(h, TALL);
    await monday(page);
    await open(page);
    const am = page.locator(".tt-check").nth(0);
    const timed = am.locator(".tt-check-timed .tt-check-row");
    await expect.poll(() => timed.count()).toBe(2);
    await expect.poll(() => timed.locator(".pt-when").allTextContents()).toEqual(["10:00–11:00", "11:00–12:00"]);
    // Time order, not plan order: the query (added second) is at 10.
    expect(await timed.nth(0).textContent()).toContain("#4411");
    expect(await timed.nth(0).getByRole("link").getAttribute("href")).toBeTruthy();
    expect(await timed.nth(0).getByRole("checkbox").count()).toBe(1);
    const pm = page.locator(".tt-check").nth(1);
    expect(await pm.locator(".tt-tray-label").textContent()).toBe("Not timeboxed yet");
    const rest = pm.locator(".tt-check-rest .tt-check-row");
    await expect.poll(() => rest.locator(".size-chip").allTextContents()).toEqual(["S · 1h", expect.stringMatching(/^Size\? · \dh$/)]);
    expect(await pm.locator(".tt-check-rest .tt-check-row").first().getByRole("checkbox").count()).toBe(1);
    // The column is beside the hours, level with their top, and about 40% of the block.
    const hours = (await page.locator(".tt-hours").nth(1).boundingBox())!;
    const col = (await pm.boundingBox())!;
    expect(col.x).toBeGreaterThanOrEqual(hours.x + hours.width - 1);
    expect(Math.abs(col.y - hours.y)).toBeLessThan(2);
    expect(col.width / (col.width + hours.width)).toBeCloseTo(0.4, 1);
    expect(await page.locator(".tt-tray").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("ticking is the list view's: Wrap it up (FN-1) with Undo, and done on both sides", async () => {
    const { page, errors } = await freshPage(h, TALL);
    await monday(page);
    await open(page);
    const box = page.getByRole("checkbox", { name: "Done: Timesheet summary query" });
    await box.check();
    const sheet = page.getByRole("dialog", { name: "Wrap it up" });
    await sheet.waitFor();
    await sheet.getByRole("button", { name: "Preview" }).click();
    await expect.poll(() => sheet.locator(".wrap-summary").textContent()).toContain("#4411: state Active → Closed");
    await sheet.getByRole("button", { name: "Confirm" }).click();
    await expect.poll(() => sheet.getByRole("status").textContent()).toMatch(/saved to DevOps/);
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect.poll(() => band(page, "Timesheet summary query").getAttribute("class")).toMatch(/\bdone\b/);
    expect(await row(page, "Timesheet summary query").getAttribute("class")).toMatch(/\bdone\b/);
    await box.uncheck();
    // Unticked: the newest write Wrap it up made is offered back first (the undo stack's order).
    const card = page.getByRole("region", { name: "DevOps update" });
    await expect.poll(() => card.locator(".do-title").textContent()).toMatch(/^You set #4411('s Remaining Work to \S+| to Closed) in DevOps\. Undo that too\?$/);
    await expect.poll(() => band(page, "Timesheet summary query").getAttribute("class")).not.toMatch(/\bdone\b/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("hover links the row and its band both ways; a click on a row brings its band into view", async () => {
    // RS-1: 560 high (620 before): Day's promise lines above the timeline are rows now, 2 apart with no boxes, so the
    // page above the timeline is about 30 px shorter and the band below the fold needs a shorter window.
    const { page } = await freshPage(h, { width: 1920, height: 560 });
    await monday(page);
    await open(page);
    const r = row(page, "Utilization chart");
    await r.hover();
    await expect.poll(() => band(page, "Utilization chart").getAttribute("class")).toMatch(/\blinked\b/);
    await page.mouse.move(5, 5);
    await expect.poll(() => band(page, "Utilization chart").getAttribute("class")).not.toMatch(/\blinked\b/);
    await band(page, "Timesheet summary query").hover();
    await expect.poll(() => row(page, "Timesheet summary query").getAttribute("class")).toMatch(/\blinked\b/);
    await page.mouse.move(5, 5);
    // The band is below the fold at 560; a click on the row's empty space scrolls to it. Sticky keeps the column in view.
    const inView = () => band(page, "Utilization chart").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
    await page.locator(".today-view").evaluate((el) => (el.scrollTop = 0));
    await expect.poll(inView).toBe(false);
    const rb = (await r.boundingBox())!;
    await page.mouse.click(rb.x + rb.width * 0.62, rb.y + rb.height / 2);
    await expect.poll(inView).toBe(true);
    const col = (await page.locator(".tt-check").nth(0).boundingBox())!;
    expect(col.y).toBeGreaterThanOrEqual(0);
    await page.close();
  }, T);

  it("drag from Not timeboxed yet to the hours timeboxes it; a band dragged to the checklist loses its time; both Undo", async () => {
    const { page, errors } = await freshPage(h, TALL);
    const ids = await monday(page);
    await open(page);
    const rest = () => page.locator(".tt-check").nth(1).locator(".tt-check-rest .tt-check-row", { hasText: "Write the export notes" });
    const hb = (await page.locator(".tt-hours").nth(1).boundingBox())!;
    await drag(page, await center(rest()), { x: hb.x + 260, y: hb.y + (hb.height * 92) / 270 });
    await expect.poll(() => boxes(page).then((b) => b[ids.notes])).toBe("14:00-15:00");
    await expect.poll(() => rest().count()).toBe(0);
    await expect.poll(() => row(page, "Write the export notes").locator(".pt-when").textContent()).toBe("2:00–3:00");
    await undoToast(page);
    await expect.poll(() => boxes(page).then((b) => b[ids.notes])).toBeUndefined();
    await drag(page, await center(rest()), { x: hb.x + 260, y: hb.y + (hb.height * 92) / 270 });
    await expect.poll(() => boxes(page).then((b) => b[ids.notes])).toBe("14:00-15:00");
    const b = band(page, "Write the export notes");
    await b.waitFor();
    await page.waitForTimeout(200);
    await drag(page, await center(b), await center(page.locator(".tt-check").nth(1)));
    await expect.poll(() => boxes(page).then((x) => x[ids.notes])).toBeUndefined();
    await rest().waitFor();
    await undoToast(page);
    await expect.poll(() => boxes(page).then((x) => x[ids.notes])).toBe("14:00-15:00");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the keyboard works from checklist rows: T, Up, Down, Shift, Backspace", async () => {
    const { page } = await freshPage(h, TALL);
    const ids = await monday(page);
    await open(page);
    const timed = row(page, "Timesheet summary query");
    await timed.focus();
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => boxes(page).then((b) => b[ids.query])).toBe("10:15-11:15");
    await page.keyboard.press("Shift+ArrowUp");
    await expect.poll(() => boxes(page).then((b) => b[ids.query])).toBe("10:15-11:00");
    await page.keyboard.press("Backspace");
    await expect.poll(() => boxes(page).then((b) => b[ids.query])).toBeUndefined();
    await expect.poll(() => timed.evaluate((el) => el === document.activeElement)).toBe(true);
    await page.keyboard.press("t");
    await expect.poll(() => boxes(page).then((b) => b[ids.query])).toBeDefined();
    await page.close();
  }, T);

  it("hour labels on the left in Week's type, the first hour too", async () => {
    const { page } = await freshPage(h, TALL);
    await monday(page);
    await open(page);
    const hours = page.locator(".tt-hours").nth(0);
    const labels = hours.locator(".hour span");
    await expect.poll(() => labels.first().textContent()).toBe("9 AM");
    const hb = (await hours.boundingBox())!;
    const lb = (await labels.first().boundingBox())!;
    expect(lb.x - hb.x).toBeLessThan(40);
    expect(lb.y).toBeGreaterThanOrEqual(hb.y);
    // Nothing sits on the labels' gutter.
    const ev = (await hours.locator(".event").first().boundingBox())!;
    expect(ev.x).toBeGreaterThan(lb.x + lb.width);
    await page.close();
  }, T);

  it("placed to-dos are solid; only Timebox my day's suggestions are dashed; a suggested to-do stays on the checklist", async () => {
    const { page } = await freshPage(h, TALL);
    await monday(page);
    await open(page);
    const style = (l: Locator) => l.evaluate((el) => getComputedStyle(el).borderTopStyle);
    await band(page, "Utilization chart").waitFor();
    expect(await style(band(page, "Utilization chart"))).toBe("solid");
    await page.locator(".today-timebox").click();
    await page.getByRole("group", { name: "Timebox my day" }).waitFor();
    const ph = page.locator(".today-tl .tt-ph", { hasText: "Write the export notes" });
    await ph.waitFor();
    expect(await style(ph)).toBe("dashed");
    const suggested = row(page, "Write the export notes");
    await suggested.locator(".tt-suggested").waitFor();
    await suggested.hover();
    await expect.poll(() => ph.getAttribute("class")).toMatch(/\blinked\b/);
    await shot(page, "04-suggestions-dashed-1920");
    await page.close();
  }, T);

  it("two overlapping meetings both get the marker, nothing else does", async () => {
    const { page } = await freshPage(h, TALL);
    await monday(page);
    await overlapping(page);
    await open(page);
    const tagged = page.locator(".tt-hours .event:has(.ev-overlap)");
    await expect.poll(() => tagged.count()).toBeGreaterThanOrEqual(2);
    const twins = await tagged.evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    expect(twins.some((t) => t.includes("Fabrikam design review"))).toBe(true);
    expect(await page.locator(".tt-hours .event").count()).toBeGreaterThan(await tagged.count());
    await page.close();
  }, T);

  it("under 1100 px the checklist is above the block's hours and folds; at 1100 it is beside them; sticky at 1920", async () => {
    const { page } = await freshPage(h, { width: 1099, height: 900 });
    await monday(page);
    await open(page);
    const col = page.locator(".tt-check").nth(0);
    const hours = page.locator(".tt-hours").nth(0);
    expect((await col.boundingBox())!.y + (await col.boundingBox())!.height).toBeLessThanOrEqual((await hours.boundingBox())!.y + 1);
    const toggle = col.locator(".tt-check-toggle");
    expect(await toggle.textContent()).toContain("To-dos · 2");
    await shot(page, "03-under-1100");
    await toggle.click();
    expect(await col.locator(".tt-check-body").isVisible()).toBe(false);
    await toggle.click();
    expect(await col.locator(".tt-check-body").isVisible()).toBe(true);
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect.poll(async () => (await col.boundingBox())!.x).toBeGreaterThan((await hours.boundingBox())!.x + 300);
    expect(await toggle.isVisible()).toBe(false);
    // Sticky: partway down a block, the column is still at the top of the view.
    await page.setViewportSize({ width: 1920, height: 560 });
    await page.locator(".today-view").evaluate((el) => (el.scrollTop = 0));
    const top0 = (await col.boundingBox())!.y;
    const hb = (await hours.boundingBox())!;
    await page.locator(".today-view").evaluate((el, by) => (el.scrollTop = by), top0 + 120);
    await expect.poll(async () => (await hours.boundingBox())!.y).toBeLessThan(hb.y - 100);
    const stuck = (await col.boundingBox())!.y;
    expect(stuck).toBeGreaterThan((await hours.boundingBox())!.y + 40);
    await page.close();
  }, T);

  it("the phone keeps TY-1's tray and no column, with solid bands", async () => {
    const { page } = await freshPage(h, { width: 360, height: 740 });
    const ids = await monday(page);
    await call(page, "ui.set_today_timeline", { show: true, phone: true });
    await page.reload();
    await page.locator(".today-tl.phone .tt-tray-row").first().waitFor();
    expect(await page.locator(".tt-check").count()).toBe(0);
    expect(ids.query).toBeGreaterThan(0);
    const b = page.locator(".today-tl .tbox:not(.tt-ph)").first();
    expect(await b.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("solid");
    if (SHOTS) {
      await b.scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      await shot(page, "06-phone-solid");
    }
    await page.close();
  }, T);

  for (const [name, viewport, text] of [["01-today-1920", TALL, "default"], ["02-today-1280", { width: 1280, height: 1800 }, "default"], ["05-larger-text-1920", TALL, "larger"]] as const) {
    it(`screenshot ${name} (screenshots only)`, async () => {
      if (!SHOTS) return;
      const { page } = await freshPage(h, viewport);
      await monday(page);
      await overlapping(page);
      await call(page, "ui.set_text_size", { size: text });
      await open(page);
      // A ticked item, Wrap it up closed (the tick stays), and a hover highlight.
      await page.getByRole("checkbox", { name: "Done: Timesheet summary query" }).check();
      await page.getByRole("dialog", { name: "Wrap it up" }).waitFor();
      await page.keyboard.press("Escape");
      await row(page, "Utilization chart").hover();
      await page.waitForTimeout(400);
      await shot(page, name);
      await call(page, "ui.set_text_size", { size: "default" });
      await page.close();
    }, T);
  }
});
