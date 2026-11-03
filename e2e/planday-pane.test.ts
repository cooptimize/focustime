// fix/planday-pane: Plan the day's right pane. "More from <client>'s DevOps · N" names the client and counts its rows;
// it is folded when musts or follow-ups are above it and open on its own when nothing is, with a line that links to
// Plan the week on that client; a fold by hand is kept per client for the session; and the one-time "+ time" hint is
// a popover that stays inside its card at 1920 and 1400 px.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, openPlanDay, selectBlock, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;

const more = (page: Page) => page.locator('.pd2-right section[aria-label^="More from "]');
const fold = (page: Page) => more(page).locator(".pd2-fold");

/** The demo always has follow-ups; here week.load answers without them, as for someone who owes nothing. */
async function noFollowUps(page: Page) {
  await page.route("**/api/action", async (route) => {
    const action = (() => {
      try {
        return (JSON.parse(route.request().postData() ?? "{}") as { action?: string }).action;
      } catch {
        return undefined;
      }
    })();
    if (action !== "week.load") return route.fallback();
    const res = await route.fetch();
    const body = (await res.json()) as { data?: { followUps?: unknown[] } };
    if (body.data) body.data.followUps = [];
    return route.fulfill({ response: res, body: JSON.stringify(body) });
  });
}

describe.skipIf(!CHROMIUM)("Plan the day's right pane (fix/planday-pane)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("labels the section with the client and its count, folded under musts and follow-ups", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h);
    await openPlanDay(page);
    for (const client of ["Cooptimize", "Northwind"]) {
      await selectBlock(page, client);
      const text = (await fold(page).textContent())!;
      expect(text).toMatch(new RegExp(`^▸ More from ${client}'s DevOps · \\d+$`));
      expect(await more(page).getAttribute("aria-label")).toBe(`More from ${client}'s DevOps`);
      expect(await fold(page).getAttribute("aria-expanded")).toBe("false");
      // The count is the rows it lists.
      await fold(page).click();
      expect(await more(page).locator(":scope > ul.pd2-list > li").count()).toBe(Number(text.split("· ")[1]));
      // Musts are listed, so no nothing-planned line.
      expect(await page.locator(".pd2-none").count()).toBe(0);
    }
    expect(await page.locator(".pd2-right").getByText("Everything else").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("opens on its own with nothing above it, says nothing is planned, and links to Plan the week on that client", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h);
    await noFollowUps(page);
    await page.reload();
    await page.waitForSelector(".topbar");
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    // Next Monday: nothing planned for that week yet, and (here) no follow-ups.
    await page.evaluate(() => (location.hash = "#/today/plan/2026-11-09"));
    await page.waitForSelector(".pd2-left");
    await selectBlock(page, "Northwind");
    expect(await page.locator('.pd2-right section[aria-label^="This week"], .pd2-right section[aria-label="Follow-ups"]').count()).toBe(0);
    expect(await fold(page).getAttribute("aria-expanded")).toBe("true");
    const line = page.locator(".pd2-right .pd2-none");
    expect(await line.textContent()).toBe("Nothing planned for Northwind this week. Pick from DevOps, or plan the week first.");
    expect(await more(page).locator(":scope > ul.pd2-list > li").count()).toBeGreaterThan(0);

    // A fold by hand is kept for that client: in its other blocks, and after a reload; another client is untouched.
    await fold(page).click();
    expect(await fold(page).getAttribute("aria-expanded")).toBe("false");
    await selectBlock(page, "Cooptimize");
    expect(await fold(page).getAttribute("aria-expanded")).toBe("true");
    await selectBlock(page, "Northwind");
    expect(await fold(page).getAttribute("aria-expanded")).toBe("false");
    await page.reload();
    await page.waitForSelector(".pd2-left", { timeout: 30_000 });
    await selectBlock(page, "Northwind");
    expect(await fold(page).getAttribute("aria-expanded")).toBe("false");
    await fold(page).click();

    // "plan the week": Plan the week of that week, on that client.
    await page.locator(".pd2-right .pd2-none").getByRole("button", { name: "plan the week" }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/week/plan/2026-11-09");
    await expect.poll(() => page.locator(".pw-open-card .pl-unit-name").first().textContent(), { timeout: 15_000 }).toContain("Northwind");
    expect(errors).toEqual([]);
    await page.close();
  });

  for (const width of [1920, 1400])
    it(`keeps the + time hint inside its card at ${width} px`, { timeout: T }, async () => {
      // freshPage marks the hint seen on every load; this page shows it, as a first visit does.
      const page = await h.browser.newPage({ viewport: { width, height: 1080 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
      await page.addInitScript(() => localStorage.setItem("focustime.hint.flow", "dismissed"));
      await page.goto(h.url);
      await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
      await page.waitForSelector(".demo-tag", { timeout: 30_000 });
      await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
      await openPlanDay(page);
      // An untimed pick to give a time to: the first one in the day gets the hint.
      if (!(await page.locator(".pd2-left .pt-add").count())) {
        await selectBlock(page, "Cooptimize");
        if ((await fold(page).getAttribute("aria-expanded")) !== "true") await fold(page).click();
        await more(page).locator("li.pd2-add:not(.planned) button.pd2-plus").first().click();
      }
      const hint = page.locator(".pd2-left .pt-hint");
      await hint.waitFor({ state: "attached", timeout: 15_000 });
      const box = await hint.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const card = el.closest(".pd2-block")!.getBoundingClientRect();
        const row = el.closest("li")!.getBoundingClientRect();
        const anchor = el.parentElement!.querySelector(".pt-add")!.getBoundingClientRect();
        return { inside: r.left >= card.left && r.right <= card.right && r.top >= card.top && r.bottom <= card.bottom, rowWidth: Math.round(row.width), cardWidth: Math.round(card.width), anchoredRight: Math.abs(r.right - anchor.right) < 2 || r.left > card.left, nearAnchor: Math.abs(r.top - anchor.bottom) < 12 || Math.abs(anchor.top - r.bottom) < 12, text: el.textContent };
      });
      if (process.env.FOCUSTIME_SHOTS) await page.locator(".pd2-block:has(.pt-hint)").screenshot({ path: `${process.env.FOCUSTIME_SHOTS}/hint-${width}.png` });
      expect(box.text).toMatch(/^Give it a time, optionally put it on Outlook\. Got it$/);
      expect(box).toMatchObject({ inside: true, nearAnchor: true });
      // It no longer widens or wraps its row.
      expect(box.rowWidth).toBeLessThanOrEqual(box.cardWidth);
      await hint.getByRole("button", { name: "Got it" }).click();
      expect(await page.locator(".pt-hint").count()).toBe(0);
      expect(errors).toEqual([]);
      await page.close();
    });
});
