// Was e2e/nm2-phone-daybar.test.ts (NM-2) until BT-1.
// NM-2 D (browser, demo mode, the phone at 360 under iOS conditions: a larger root font, bypassCSP). Since PH-2: Week's
// steps are icon buttons named Previous week and Next week, another day's are Previous day and Next day (no arrow
// characters), each a full tap target; Week's screen-reader name says Week; Next day moves the day.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator } from "playwright-core";
import { CHROMIUM, startDemo, type Harness } from "../harness.ts";

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
    // The bottom bar's Week (the phone opens on Day). PH-2: Week's header has Previous week and Next week as named
    // icon buttons; a day opens with a small header whose Previous day and Next day are the same.
    await page.getByRole("button", { name: /^Week/ }).last().click();
    await page.locator(".pw-head").waitFor({ timeout: 15_000 });
    const icons = async (scope: Locator, names: string[]) => {
      for (const name of names) {
        const b = scope.getByRole("button", { name, exact: true });
        expect(await b.locator("svg").count(), name).toBe(1);
        expect((await b.textContent())!.trim(), name).toBe("");
        const r = (await b.boundingBox())!;
        expect(Math.min(r.width, r.height), name).toBeGreaterThanOrEqual(43.5);
      }
    };
    await icons(page.locator(".pw-head"), ["Previous week", "Next week"]);
    expect(await page.locator(".pw-title").getAttribute("aria-label")).toMatch(/^Week of /);
    // Wednesday, another day: its header, and Next day works.
    await page.locator(".pw-row").nth(2).locator(".pw-day").click();
    const bar = page.locator(".dg-headbar");
    await bar.waitFor({ timeout: 15_000 });
    await icons(bar, ["Previous day", "Next day"]);
    expect(await bar.locator("kbd").count()).toBe(0);
    const before = await bar.locator(".dg-date").textContent();
    await bar.getByRole("button", { name: "Next day" }).click();
    await expect.poll(() => page.locator(".dg-headbar .dg-date").textContent()).not.toBe(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
