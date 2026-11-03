// D460 to D462 in the browser (demo mode, clock pinned to Mon Nov 2, 9:30 AM; the week of Nov 2): the detail panel
// takes the right pane's place and covers nothing (the header and all five days stay usable at 1920), Esc returns
// focus to the row; owners in the panel ("you" with no photo, a Cooptimizer's photo, initials for someone outside the
// team) with story dates; the "assigned to others" avatar stack and a row's "due Thu".
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, weekClient, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;

/** The element is on screen and on top at its center (nothing covers it). */
const onTop = (page: Page, sel: string) =>
  page.locator(sel).first().evaluate((e) => {
    const r = e.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return r.width > 0 && x < innerWidth && !!top && (e === top || e.contains(top));
  });

describe.skipIf(!CHROMIUM)("Plan the week: panel, owners and dates (D460 to D462)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  const harbor = async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("2");
    await page.keyboard.press("p");
    await page.locator(".planweek .co-step button[aria-label='Previous week']").click();
    await page.locator(".pw-client").first().waitFor();
    const card = await weekClient(page, "Harbor");
    return { page, errors, card, feature: card.locator(".pw-row").first() };
  };

  it("the panel takes the right pane's place: the header and all five days stay usable; Esc closes it and focus goes back to the row", async () => {
    const { page, errors, feature } = await harbor();
    const opener = feature.locator(":scope > .pl-title .pw-open");
    await opener.focus();
    await page.keyboard.press("Enter");
    const panel = page.locator(".pl-panel > .detail-panel");
    await panel.waitFor();
    await expect(page.locator(".pw-addpane").isVisible()).resolves.toBe(false);
    for (const sel of [".pl-head .pl-heading", ".pl-head .pl-secondary > *", ".pl-head .mode-done, .pl-head button:has-text('Done')", ".pl-head .mode-switch, .pl-head [role=tablist]"]) expect(await onTop(page, sel), sel).toBe(true);
    await expect(page.locator(".pw-grid-day").allTextContents()).resolves.toEqual(["Mon 2", "Tue 3", "Wed 4", "Thu 5", "Fri 6"]);
    for (let n = 1; n <= 5; n++) expect(await onTop(page, `.pw-grid-day:nth-of-type(${n + 1})`), `day ${n}`).toBe(true);
    // Thursday's and Friday's cells too (they were under the panel).
    expect(await onTop(page, ".pw-cell.pto")).toBe(true);
    // Nothing of the plan sits under the panel.
    const overlap = await page.evaluate(() => {
      const p = document.querySelector(".pl-panel")!.getBoundingClientRect();
      const l = document.querySelector(".pl-left")!.getBoundingClientRect();
      const g = document.querySelector(".pw-grid-wrap")!.getBoundingClientRect();
      return l.right > p.left + 1 || (g.bottom > p.top + 1 && g.right > p.left + 1);
    });
    expect(overlap).toBe(false);
    await page.keyboard.press("Escape");
    await expect.poll(() => panel.count()).toBe(0);
    await expect.poll(() => opener.evaluate((e) => e === document.activeElement)).toBe(true);
    await expect(page.locator(".pw-addpane").isVisible()).resolves.toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("owners in the panel: you with no photo, a Cooptimizer's photo, initials for someone outside; dates after the state", async () => {
    const { page, errors, feature } = await harbor();
    await feature.locator(":scope > .pl-title .pw-open").click();
    const stories = page.locator(".detail-panel .dp-section[aria-label='Stories'] .pw-pstories").first().locator("> li");
    const meta = (title: string) => stories.filter({ hasText: title }).locator(".pw-story-meta");
    await expect.poll(() => meta("Insurance card upload").textContent()).toBe("Active · you · Thu · on the list");
    await expect(meta("Insurance card upload").locator(".avatar").count()).resolves.toBe(0);
    await expect(meta("Intake data export").textContent()).resolves.toMatch(/^New · .*Priya Shah · Nov 12$/);
    await expect.poll(() => meta("Intake data export").locator(".avatar img").count(), { timeout: 10_000 }).toBe(1);
    const ext = meta("Front desk review");
    await expect(ext.locator(".avatar img").count()).resolves.toBe(0);
    await expect(ext.locator(".avatar-initials").textContent()).resolves.toBe("MR");
    // A photo and initials take the same 16 px circle.
    const sizes = await page.locator(".detail-panel .pw-story-meta .avatar").evaluateAll((els) => [...new Set(els.map((e) => `${e.getBoundingClientRect().width}x${e.getBoundingClientRect().height}`))]);
    expect(sizes).toEqual(["16x16"]);
    // The feature's dates in one line, Set or Change inline (here Enable DevOps writes: demo has no write PAT).
    await expect(page.locator(".detail-panel .pw-dates").textContent()).resolves.toMatch(/^Starts Oct 12 · target Nov 27 · /);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("rows: others' avatars (three, then +1, names on hover) and due Thu; nothing on rows that are only mine", async () => {
    const { page, errors, card, feature } = await harbor();
    const stack = feature.locator(":scope > .pw-kids .owner-stack");
    await expect(stack.locator(".avatar").count()).resolves.toBe(3);
    await expect(stack.locator(".owner-more").textContent()).resolves.toBe("+1");
    await expect(stack.getAttribute("title")).resolves.toBe("Sam Ortiz, Jordan Lee, Priya Shah, Morgan Reyes");
    await expect(feature.locator(".pw-nested > li").first().locator(".pw-due").textContent()).resolves.toBe("due Thu");
    await expect(feature.locator(".pw-nested > li").first().locator(".pw-due").getAttribute("class")).resolves.not.toContain("late");
    await expect(card.locator(".pw-row:not(:has(.pw-kids)) .owner-stack").count()).resolves.toBe(0);
    // Northwind's CSV export was due Oct 30: amber, never red.
    const nw = await weekClient(page, "Northwind");
    const was = nw.locator(".pw-due", { hasText: "was due Oct 30" });
    await expect(was.getAttribute("class")).resolves.toContain("late");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
