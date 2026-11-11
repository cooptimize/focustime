// HK-3: on a compact card's rail, the now line's time never covers an hour mark's label: on the demo on Wednesday
// Nov 4 at 2:01 PM (just past the 2 o'clock mark on Northwind's afternoon rail), at 1920 and at Text size Larger. The
// line itself stays at its time.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, timelineOn, startDemo, type Harness } from "./harness.ts";

const T = 180_000;
const AT = "2026-11-04T14:01:00-05:00";
const SHOTS = process.env.HK3_SHOTS ?? null;

/** The now pill's box and every hour label's box on today's rail, and where the line is. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const line = document.querySelector(".day.today .ruler > .now-line") as HTMLElement | null;
    if (!line) return null;
    const rail = line.parentElement!;
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    return { spot: line.dataset.pill ?? null, top: line.style.top, lineY: line.getBoundingClientRect().top, pill: box(line.querySelector(".nl-pill")!), labels: [...rail.querySelectorAll(".r-hour span")].map(box) };
  });
const overlaps = (a: { top: number; bottom: number; left: number; right: number }, b: typeof a) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe.skipIf(!CHROMIUM)("The now line's time on a compact rail (HK-3)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, AT);
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("moves off the hour mark it would cover, at Default and Larger, and the line stays put", async () => {
    const { page, errors } = await freshPage(h);
    await timelineOn(page);
    await page.getByRole("button", { name: "Week", exact: true }).first().click();
    await page.locator(".day.today .ruler > .now-line").waitFor({ timeout: 30_000 });
    for (const size of ["default", "larger"] as const) {
      if (size === "larger") {
        await page.locator("body").click({ position: { x: 5, y: 1070 } });
        await page.keyboard.press("Control+Equal");
        await page.keyboard.press("Control+Equal");
        await expect.poll(() => page.evaluate(() => document.documentElement.dataset.textSize ?? "")).toBe("larger");
      }
      await expect.poll(async () => (await measure(page))?.spot ?? "none", { timeout: 10_000 }).not.toBe("center");
      const m = (await measure(page))!;
      expect(m.labels.length).toBeGreaterThan(0);
      for (const l of m.labels) expect(overlaps(m.pill, l)).toBe(false);
      // The line is where 2:01 is: only the time moved.
      expect(m.top).toMatch(/%$/);
      if (SHOTS) await page.locator(".day.today").screenshot({ path: `${SHOTS}/hk3-nowline-${size}-1920.png` });
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
