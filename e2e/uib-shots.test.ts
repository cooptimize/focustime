// UI-B: the screenshots for the report (demo data only), when FOCUSTIME_SHOTS names a folder: the Board with the
// suggested cards and the summary line, the fallback list open, the now line mid-block (Wed 1:30 PM) and in the gap
// before the day (Wed 7:30 AM), Today's agenda and Plan today with the line; at 1920×1080 (and Text size Larger),
// 1366×768 and a phone (390×844, a 17px root font as on iPhone; the page must not be wider than the screen).
import { afterAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

const T = 300_000;
const MID = "2026-11-04T13:30:00-05:00";
const EARLY = "2026-11-04T07:30:00-05:00";

async function week(page: Page) {
  await page.getByRole("button", { name: "Week", exact: true }).first().click();
  await page.locator(".grid .day").first().waitFor();
  await page.waitForTimeout(500);
}

describe.skipIf(!CHROMIUM || !SHOTS)("UI-B screenshots", () => {
  const hs: Harness[] = [];
  afterAll(async () => {
    for (const h of hs) await h.stop();
  }, T);

  it("mid-block: the Board, the list, Today and Plan today at 1920, 1366 and Larger", async () => {
    const h = await startDemo("chromium", {}, MID);
    hs.push(h);
    for (const [w, ht] of [[1920, 1080], [1366, 768]] as const) {
      const { page } = await freshPage(h, { width: w, height: ht });
      await week(page);
      const snap = (name: string) => (w === 1920 ? shotBoth(page, `uib-${name}-${w}`) : page.screenshot({ path: `${SHOTS}/uib-${name}-${w}.png` }));
      await snap("board");
      await page.getByText(/Unfinished from earlier days \(\d\)/).click();
      await snap("board-list");
      await page.locator(".carry-summary").getByRole("button", { name: "Review" }).click();
      await snap("board-review");
      await page.getByRole("button", { name: "Today", exact: true }).first().click();
      await page.locator(".today-rows .now-row").first().waitFor();
      await snap("today");
      await week(page);
      await page.getByRole("button", { name: "Add work" }).click();
      await page.locator(".pd-agenda .now-row").first().waitFor({ timeout: 15_000 }).catch(() => {});
      await snap("plan-today");
      await page.close();
    }
  }, T);

  it("in the gap before the day, at 1920", async () => {
    const h = await startDemo("chromium", {}, EARLY);
    hs.push(h);
    const { page } = await freshPage(h);
    await week(page);
    await expect(page.locator(".day.today .now-line").first().textContent()).resolves.toContain("7:30");
    await shotBoth(page, "uib-board-early-1920");
    await page.close();
  }, T);

  it("phone", async () => {
    const h = hs[0]!;
    const page = await h.browser.newPage({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    await page.addInitScript(() => {
      localStorage.setItem("focustime.hint.flow", "dismissed");
      localStorage.setItem("focustime.hint.picktime", "1");
    });
    await page.goto(h.url);
    await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
    await page.waitForSelector(".demo-tag", { timeout: 30_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await page.addStyleTag({ content: "html { font-size: 17px; }" });
    const wide = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: `${SHOTS}/uib-phone-today.png` });
    expect(await wide(), "Today is wider than the phone").toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Week", exact: true }).first().click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/uib-phone-week.png` });
    expect(await wide(), "Week is wider than the phone").toBeLessThanOrEqual(0);
    await page.locator(".suggested-card").first().scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: `${SHOTS}/uib-phone-week-card.png` });
    await page.close();
  }, T);
});
