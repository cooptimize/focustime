// D459: a row's ⋯ menu names the row it was opened from, in every place with row menus (browser, demo mode, clock
// pinned to Mon Nov 2, 9:30 AM). Open on row A, close, open on row B: the header is B's. The header is a label: not
// focusable, never the active item, arrow keys skip it. A nested story's hover shows its own ⋯, not its feature's.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, openPlanDay, startDemo, weekClient, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Two picks in today's (Monday's) Northwind PM block, committed; each test file has its own demo server. */
async function seed(page: Page) {
  const picks = await call(page, "planday.load", { date: "2026-11-02" }).catch(() => null);
  if (!JSON.stringify(picks?.data ?? "").includes("Review the export spec")) {
    await call(page, "pick.add", { date: "2026-11-02", half: "PM", clientKey: "Northwind", itemId: 1111, size: "M" });
    await call(page, "pick.add", { date: "2026-11-02", half: "PM", clientKey: "Northwind", intention: "Review the export spec", size: "S" });
    await call(page, "planday.commit", { date: "2026-11-02" });
  }
  await page.reload();
  await page.waitForSelector(".today-block");
}
const head = (page: Page) => page.locator(".popup-menu .menu-head");

/** Opens the row's own ⋯ (hovered first, as a person would), returns the header's full title, then closes it. */
async function headerOf(page: Page, row: Locator, more: string, title: string): Promise<{ want: string; got: string }> {
  await row.scrollIntoViewIfNeeded();
  await row.locator(title).first().hover();
  await row.locator(more).first().click();
  await head(page).waitFor({ timeout: 5_000 });
  const got = (await head(page).getAttribute("title")) ?? "";
  const want = ((await row.locator(title).first().textContent()) ?? "").replace(/^#\d+\s*/, "").replace(/#\d+.*$/, "").trim();
  await page.keyboard.press("Escape");
  await expect.poll(() => page.locator(".popup-menu").count()).toBe(0);
  return { want, got };
}

/** Row A then row B: each header names its own row. */
async function aThenB(page: Page, rows: Locator, more: string, title: string) {
  await expect.poll(() => rows.count(), { timeout: 20_000 }).toBeGreaterThan(1);
  const a = await headerOf(page, rows.nth(0), more, title);
  const b = await headerOf(page, rows.nth(1), more, title);
  expect(a.want).not.toBe(b.want);
  expect(a.got).toContain(a.want.slice(0, 24));
  expect(b.got).toContain(b.want.slice(0, 24));
}

describe.skipIf(!CHROMIUM)("row menu headers (D459)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  const planWeek = async (page: Page) => {
    await page.keyboard.press("2");
    await page.keyboard.press("p");
    await page.locator(".planweek .co-step button[aria-label='Previous week']").click();
    await page.locator(".pw-client").first().waitFor();
  };

  it("Plan the week: A then B; the header is a label the keys skip; a nested story shows its own ⋯", async () => {
    const { page, errors } = await freshPage(h);
    await planWeek(page);
    const nw = await weekClient(page, "Northwind");
    await aThenB(page, nw.locator(".pw-row:not(.nested)"), ":scope > .pl-hover button.more", ":scope > .pl-title");

    // The header: not focusable, not a menu item, never active; arrow keys go round the items only.
    const row = nw.locator(".pw-row").first();
    await row.locator(":scope > .pl-title").hover();
    await row.locator(":scope > .pl-hover button.more").click();
    await expect(head(page).getAttribute("tabindex")).resolves.toBeNull();
    await expect(head(page).getAttribute("role")).resolves.toBeNull();
    await expect(head(page).evaluate((e) => [getComputedStyle(e).fontWeight, getComputedStyle(e).textOverflow, getComputedStyle(e).whiteSpace, getComputedStyle(e).borderBottomStyle])).resolves.toEqual(["500", "ellipsis", "nowrap", "solid"]);
    const n = await page.locator(".popup-menu [role=menuitem]:not([aria-disabled=true])").count();
    for (let i = 0; i < n + 1; i++) {
      await page.keyboard.press(i % 2 ? "ArrowUp" : "ArrowDown");
      await expect(page.locator(".popup-menu .menu-item.active").count()).resolves.toBe(1);
      await expect(head(page).evaluate((e) => e.contains(document.activeElement) || e.matches(".active"))).resolves.toBe(false);
    }
    // The hint on Ask to collaborate stays short and inside its row.
    const help = page.locator(".popup-menu .menu-item", { hasText: "Ask to collaborate" });
    await expect(help.locator(".menu-hint").textContent()).resolves.toBe("who is free");
    await expect(help.evaluate((b) => { const r = b.getBoundingClientRect(); return [...b.children].every((c) => c.getBoundingClientRect().right <= r.right + 1); })).resolves.toBe(true);
    await page.keyboard.press("Escape");

    // A nested story: hovering it shows its own ⋯ and not its feature's; its menu names the story.
    const harbor = await weekClient(page, "Harbor");
    const feature = harbor.locator(".pw-row").first();
    const story = feature.locator(".pw-nested > li").first();
    await story.locator(":scope > .pl-title").hover();
    await expect(feature.locator(":scope > .pl-hover").evaluate((e) => getComputedStyle(e).opacity)).resolves.toBe("0");
    await expect.poll(() => story.locator(":scope > .pl-hover").evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
    const s = await headerOf(page, story, ":scope > .pl-hover button.more", ":scope > .pl-title");
    expect(s.got).toContain(s.want.slice(0, 24));
    const f = await headerOf(page, feature, ":scope > .pl-hover button.more", ":scope > .pl-title");
    expect(f.got).toContain(f.want.slice(0, 24));
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Plan the day: picks and the offered DevOps items, A then B", async () => {
    const { page, errors } = await freshPage(h);
    await seed(page);
    await openPlanDay(page);
    await aThenB(page, page.locator(".pd2-picks > li.pick-row"), ".more-btn", ".pr-title");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Today: picks, A then B", async () => {
    const { page, errors } = await freshPage(h);
    await seed(page);
    await page.locator(".pick-row").first().waitFor({ timeout: 30_000 });
    await aThenB(page, page.locator(".pick-row"), ".more-btn", ".pr-title");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Week's detail panel: my stories, A then B", async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("2");
    const card = page.locator(".half.card", { hasText: "Northwind" }).first();
    await card.locator(".card-when").click();
    const panel = page.locator(".detail-panel");
    await panel.waitFor();
    await aThenB(page, panel.locator(".ps-row"), ".ps-more", ".ps-title");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Roadmap: rows, A then B", async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/roadmap"));
    await page.locator(".rm-row").first().waitFor({ timeout: 30_000 });
    await aThenB(page, page.locator(".rm-row"), "button.more", "a");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
