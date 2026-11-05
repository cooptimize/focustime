// UI-3: one close control for dialogs and side panels. About, the Guide, Capture and a side panel (Commit's DevOps
// health) each close with × and with Esc, and focus goes back to the control that opened them. The × is a 44 px
// target named "Close" with the tooltip "Close (Esc)" and no key chip. Screenshots at 1920, at Text size Larger and on
// the phone, in dark and light, when FOCUSTIME_SHOTS names a folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

const T = 120_000;
const PHONE = { width: 393, height: 852 };
let h: Harness;

const isFocused = (l: Locator) => l.evaluate((e) => e === document.activeElement);

/** The × of an open dialog or panel: named Close, the tooltip, 44 px, no key chip beside it. */
async function checkX(x: Locator, head: Locator): Promise<void> {
  await expect(x.getAttribute("title")).resolves.toBe("Close (Esc)");
  const box = await x.boundingBox();
  expect(box && Math.round(box.width) >= 44 && Math.round(box.height) >= 44).toBe(true);
  expect(await head.locator("kbd").count()).toBe(0);
  expect(await x.textContent()).toBe("");
}

/** Opens with `open`, closes once with × and once with Esc, focus back on `opener` both times. */
async function closesBothWays(page: Page, open: () => Promise<Locator>, opener: Locator, head: (d: Locator) => Locator): Promise<void> {
  for (const how of ["x", "esc"] as const) {
    const d = await open();
    const x = d.getByRole("button", { name: "Close", exact: true });
    await checkX(x, head(d));
    if (how === "x") await x.click();
    else await page.keyboard.press("Escape");
    await d.waitFor({ state: "detached" });
    await expect.poll(() => isFocused(opener), { timeout: 5_000 }).toBe(true);
  }
}

describe.skipIf(!CHROMIUM)("UI-3: one close button", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("About, the Guide, Capture and a side panel close with × and Esc and give focus back", async () => {
    const { page, errors } = await freshPage(h);
    const more = page.locator(".topbar .top-more").first();

    // ⋯ › About: focus goes back to ⋯ (the menu item is gone with its menu).
    const openAbout = async () => {
      await more.click();
      await page.getByRole("menuitem", { name: "About" }).click();
      const d = page.getByRole("dialog", { name: "About FocusTime" });
      await d.waitFor();
      return d;
    };
    await closesBothWays(page, openAbout, more, (d) => d.locator(".command-head"));

    // ⋯ › Guide.
    const openGuide = async () => {
      await more.click();
      await page.getByRole("menuitem", { name: /^Guide/ }).click();
      const g = page.locator("main.guide");
      await g.waitFor();
      return g;
    };
    await closesBothWays(page, openGuide, more, (g) => g.locator(".guide-top"));

    // Capture from the top bar.
    const capture = page.locator(".topbar").getByRole("button", { name: /^Capture/ }).first();
    const openCapture = async () => {
      await capture.click();
      const d = page.getByRole("dialog", { name: /capture/i });
      await d.waitFor();
      return d;
    };
    await closesBothWays(page, openCapture, capture, (d) => d.locator(".cap-dialog-head"));

    // A side panel: Commit's DevOps health.
    await page.evaluate(() => (location.hash = "#/week/plan/2026-11-09"));
    const health = page.getByRole("button", { name: /^DevOps health/ });
    await health.waitFor({ timeout: 30_000 });
    const openHealth = async () => {
      await health.click();
      const p = page.locator('aside.detail-panel[aria-label="DevOps health"]');
      await p.waitFor();
      return p;
    };
    await closesBothWays(page, openHealth, health, (p) => p.locator(".dp-head"));

    if (SHOTS) {
      await openHealth();
      await shotBoth(page, "ui3-panel-dark");
      await page.keyboard.press("Escape");
      for (const theme of ["cooptimize-dark", "cooptimize-light"]) {
        await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
        await openAbout();
        await shotBoth(page, `ui3-about-${theme.replace("cooptimize-", "")}`);
        await page.keyboard.press("Escape");
      }
      await openHealth();
      await shotBoth(page, "ui3-panel-light");
      await page.keyboard.press("Escape");
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("on the phone the × fits in About's header and Capture's sheet, with no sideways scroll", async () => {
    const { page, errors } = await freshPage(h, PHONE);
    await page.evaluate(() => (location.hash = "#/today"));
    await page.locator(".topbar .top-more").first().click();
    await page.getByRole("menuitem", { name: "About" }).click();
    const about = page.getByRole("dialog", { name: "About FocusTime" });
    const x = about.getByRole("button", { name: "Close", exact: true });
    const inside = async (l: Locator) => {
      const b = (await l.boundingBox())!;
      return b.x >= 0 && b.x + b.width <= PHONE.width + 0.5 && Math.round(b.width) >= 44;
    };
    await expect(inside(x)).resolves.toBe(true);
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).resolves.toBe(true);
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/ui3-about-phone.png` });
      await page.evaluate(() => document.documentElement.setAttribute("data-text-size", "larger"));
      await page.screenshot({ path: `${SHOTS}/ui3-about-phone-larger.png` });
      await page.evaluate(() => document.documentElement.removeAttribute("data-text-size"));
    }
    await x.click();
    await about.waitFor({ state: "detached" });

    await page.locator(".topbar .phone-capture").click();
    const cap = page.getByRole("dialog", { name: /capture/i });
    const cx = cap.getByRole("button", { name: "Close", exact: true });
    await expect(inside(cx)).resolves.toBe(true);
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).resolves.toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ui3-capture-phone.png` });
    await cx.click();
    await cap.waitFor({ state: "detached" });
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
