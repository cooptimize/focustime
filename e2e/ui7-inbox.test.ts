// UI-7: the Inbox's mode switch, the shared segmented control where Week's and Ahead's sit: Conversations · Promises
// · Captures, counts as small badges, the last mode remembered in this browser (the bare Inbox opens it; Conversations
// the first time), P stepping through the modes, and deep links opening their mode (a conversation, a promise, a
// follow-up). Selecting a real conversation by its link is CV-2's live test; the rules are ui/nav.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, openApp, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";

const modes = (page: Page) => page.getByRole("navigation", { name: "Inbox modes" });
const current = (page: Page) => modes(page).locator(".ms-btn[aria-current='page']").evaluate((el) => el.firstChild?.textContent ?? "");
const hash = (page: Page) => page.evaluate(() => location.hash);
const go = (page: Page, h: string) => page.evaluate((x) => void (location.hash = x), h);

describe.skipIf(!CHROMIUM)("Inbox's mode switch (UI-7)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => {
    await h?.stop();
  });

  it("three segments with counts, the remembered mode, P, and deep links", async () => {
    const { page, errors } = await freshPage(h);
    await openApp(page, h);
    // First time: Conversations, the first segment; the old underlined tabs are gone.
    await page.keyboard.press("4");
    await modes(page).waitFor();
    expect(await modes(page).locator(".ms-btn").evaluateAll((bs) => bs.map((b) => b.firstChild?.textContent))).toEqual(["Conversations", "Promises", "Captures"]);
    await expect.poll(() => current(page)).toBe("Conversations");
    expect(await page.locator(".inbox-tabs, [role=tablist][aria-label=Inbox]").count()).toBe(0);
    // Captures counts its open follow-ups and captures, as a badge in its segment.
    const badge = modes(page).getByRole("button", { name: /^Captures/ }).locator(".count");
    await expect.poll(() => badge.textContent()).toMatch(/^[1-9]\d*$/);
    if (SHOTS) await page.locator(".inbox .follow-ups-head").screenshot({ path: `${SHOTS}/ui7-inbox-switch-1920.png` });

    // Promises, then away and back with 4: still Promises.
    await modes(page).getByRole("button", { name: /^Promises/ }).click();
    await expect.poll(() => hash(page)).toBe("#/inbox/my-promises");
    await page.getByRole("main", { name: "Promises" }).waitFor();
    await page.keyboard.press("1");
    await page.keyboard.press("4");
    await expect.poll(() => current(page)).toBe("Promises");
    // P steps to Captures, then round to Conversations.
    await page.keyboard.press("p");
    await expect.poll(() => current(page)).toBe("Captures");
    await page.getByRole("main", { name: "Captures" }).waitFor();
    // Remembered across a reload: the bare Inbox opens Captures.
    await go(page, "#/inbox");
    await page.reload();
    await modes(page).waitFor();
    await expect.poll(() => current(page)).toBe("Captures");
    await page.keyboard.press("p");
    await expect.poll(() => current(page)).toBe("Conversations");

    // Deep links open their mode: a conversation, a promise, a follow-up (Captures).
    await go(page, "#/inbox/promise/987654");
    await expect.poll(() => current(page)).toBe("Promises");
    await go(page, "#/inbox/conversation/987654");
    await expect.poll(() => current(page)).toBe("Conversations");
    await go(page, "#/inbox/1");
    await expect.poll(() => current(page)).toBe("Captures");
    // Old addresses still land.
    await go(page, "#/my-promises");
    await expect.poll(() => hash(page)).toBe("#/inbox/my-promises");
    await expect.poll(() => current(page)).toBe("Promises");

    if (SHOTS) {
      await page.evaluate(() => document.documentElement.setAttribute("data-text-size", "larger"));
      await page.waitForTimeout(150);
      await page.locator(".inbox .follow-ups-head").screenshot({ path: `${SHOTS}/ui7-inbox-switch-larger.png` });
    }
    expect(errors).toEqual([]);
  }, 120_000);

  it("the phone: the switch fits, nothing off the page", async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    await openApp(page, h);
    await page.evaluate(() => void (document.documentElement.style.fontSize = "17px"));
    await go(page, "#/inbox/captures");
    await modes(page).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const r = await modes(page).boundingBox();
    expect(r!.x + r!.width).toBeLessThanOrEqual(390);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ui7-inbox-switch-phone.png` });
    expect(errors).toEqual([]);
  }, 120_000);
});
