// CW-1: co-working calls in demo mode. The seed has a call live in Northwind's delivery chat, started 40 minutes before
// the pinned clock (Wednesday Nov 4, 2026 10:00 AM ET, a Northwind day) by Jordan Lee, and an ended one in Atlas's.
// Week's Wednesday AM card and Today's Now card show "Call live in … · started 9:20 · Join"; the card's ⋯ offers Join and
// Start a call for each Northwind chat; on the phone at 360 the line and Join fit (44 px, no sideways scroll). With
// FOCUSTIME_SHOTS set it also saves the screenshots for docs/ux/cw1/.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { phonePage } from "./mb1-helpers.ts";
import { SHOTS, shotBoth } from "./shots.ts";

let h: Harness;
const T = 180_000;
const DELIVERY = "Northwind Delivery Team (Cooptimize)";
const LINK = "https://teams.microsoft.com/l/chat/19%3Ademo-northwind-delivery%40thread.v2/conversations";

async function at(page: Page, hash: string): Promise<void> {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForSelector(".topbar");
}

describe.skipIf(!CHROMIUM)("co-working calls (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-04T10:00:00-05:00");
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Week's card and Today's Now card show the live call with Join; the ⋯ offers Join and Start a call", async () => {
    const { page, errors } = await freshPage(h);
    await at(page, "#/week");
    const live = page.locator(".card-live .live-call");
    await live.first().waitFor({ timeout: 30_000 });
    // Only on Northwind's card under way (Wednesday AM), not its afternoon, and not Atlas's ended call.
    await expect(live.count()).resolves.toBe(1);
    const card = page.locator('main.grid .half[aria-label^="Wed Nov 4 AM,"]');
    await expect(card.locator(".live-call").count()).resolves.toBe(1);
    await expect(live.locator(".lc-line").textContent()).resolves.toBe(`Call live in ${DELIVERY} · started 9:20`);
    await expect(live.locator(".lc-by").textContent()).resolves.toBe("Started by Jordan Lee");
    await expect(live.getByRole("link", { name: `Join the call in ${DELIVERY}` }).getAttribute("href")).resolves.toBe(LINK);
    await shotBoth(page, "cw1-week-live", card);

    // The block's ⋯: Join for the live chat, Start a call for the other.
    await card.hover();
    await card.getByRole("button", { name: /^Actions for Wed/ }).click();
    const menu = page.locator(".popup-menu, [role=menu]").last();
    await menu.getByText(`Join the call in ${DELIVERY}`).waitFor();
    await menu.getByText("Start a call in Northwind Customer Collaboration (Cooptimize)").waitFor();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/cw1-week-menu.png` });
    await page.keyboard.press("Escape");

    // The block's detail panel: Join, and Start a call for the other chat.
    await card.locator(".card-head").click();
    const panel = page.locator(".block-panel .dp-calls");
    await panel.waitFor();
    await expect(panel.locator(".lc-start").textContent()).resolves.toBe("Start a call in Northwind Customer Collaboration (Cooptimize)");
    await page.keyboard.press("Escape");

    await at(page, "#/today");
    const now = page.locator(".phone-now .live-call");
    await now.waitFor({ timeout: 30_000 });
    await expect(now.locator(".lc-line").textContent()).resolves.toBe(`Call live in ${DELIVERY} · started 9:20`);
    await shotBoth(page, "cw1-today-live", page.locator(".phone-now"));

    // The command menu: Start a call lists every chat I can see.
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Start a call");
    await page.keyboard.press("Enter");
    await page.getByText("Start a call in Atlas Freight Delivery Team (Cooptimize)").waitFor();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/cw1-command-menu.png` });
    expect(errors).toEqual([]);
  }, T);

  for (const width of [360, 390])
    it(`the phone at ${width}: the line and Join fit on the Now card and the Week card, 44 px, no sideways scroll`, async () => {
      const page = await phonePage(h, width);
      await at(page, "#/today");
      const now = page.locator(".ph-now .live-call");
      await now.waitFor({ timeout: 30_000 });
      const join = now.locator(".lc-join");
      const box = (await join.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      const wide = () => page.evaluate(() => document.documentElement.scrollWidth);
      expect(await wide()).toBeLessThanOrEqual(width);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/cw1-phone${width}-today.png`, fullPage: true });

      await at(page, "#/week");
      const card = page.locator(".card-live .live-call").first();
      await card.waitFor({ timeout: 30_000 });
      const j = (await card.locator(".lc-join").boundingBox())!;
      expect(j.height).toBeGreaterThanOrEqual(44);
      expect(j.x + j.width).toBeLessThanOrEqual(width);
      expect(await wide()).toBeLessThanOrEqual(width);
      // The line wraps inside the card rather than running past it.
      const line = (await card.locator(".lc-line").boundingBox())!;
      expect(line.x + line.width).toBeLessThanOrEqual(j.x);
      if (SHOTS) {
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS}/cw1-phone${width}-week.png` });
      }
      await page.close();
    }, T);
});
