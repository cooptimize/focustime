// NM-2 D (browser, demo mode, the phone at 360 under iOS conditions: a larger root font, bypassCSP): Week's day bar
// steps are icon buttons named Previous day and Next day (no arrow characters), each a full tap target; Week's
// screen-reader name says Week; Next day moves the day.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 120_000;

describe.skipIf(!CHROMIUM)("NM-2: the phone's day bar", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("icon buttons with names, Week's name, and Next day works", async () => {
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
    // The bottom bar's Week (the phone opens on Day).
    await page.getByRole("button", { name: /^Week/ }).last().click();
    const bar = page.getByRole("navigation", { name: "Day" });
    await bar.waitFor({ timeout: 15_000 });
    expect(await page.getByRole("group", { name: /^Week\. / }).count()).toBe(1);
    for (const name of ["Previous day", "Next day"]) {
      const b = bar.getByRole("button", { name });
      expect(await b.locator("svg").count(), name).toBe(1);
      expect((await b.textContent())!.trim(), name).toBe("");
      const r = (await b.boundingBox())!;
      expect(Math.min(r.width, r.height), name).toBeGreaterThanOrEqual(43.5);
    }
    expect(await bar.locator("kbd").count()).toBe(0);
    const before = await bar.locator("[aria-current=date]").textContent();
    const next = bar.getByRole("button", { name: "Next day" });
    if (await next.isEnabled()) {
      await next.click();
      await expect.poll(() => bar.locator("[aria-current=date]").textContent()).not.toBe(before);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
