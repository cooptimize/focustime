// NM-2 C2 (browser, demo mode): Close and Esc on Settings go back to where it was opened from: a tab, a Guide section,
// a story card, Code. Opened by its own address with nothing behind it, it closes to Day.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 180_000;
const hash = (page: Page) => page.evaluate(() => location.hash);
const to = (page: Page, x: string) => page.evaluate((v) => (location.hash = v), x);
const settings = (page: Page) => page.locator(".settings").first();

async function openAndClose(page: Page, from: string, how: "close" | "esc") {
  await to(page, from);
  await expect.poll(() => hash(page)).toBe(from);
  await page.waitForTimeout(400);
  await to(page, "#/settings/display");
  await settings(page).waitFor();
  if (how === "close") await settings(page).getByRole("button", { name: "Close" }).first().click();
  else await page.keyboard.press("Escape");
  await expect.poll(() => settings(page).count()).toBe(0);
  await expect.poll(() => hash(page)).toBe(from);
}

describe.skipIf(!CHROMIUM)("NM-2: Settings closes back to where you were", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("a tab, a Guide section, a story card and Code; its own address closes to Day", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await openAndClose(page, "#/backlog", "close");
    await openAndClose(page, "#/guide/week", "esc");
    await openAndClose(page, "#/item/Cooptimize/4411", "close");
    await openAndClose(page, "#/code/Northwind", "esc");
    // Nothing behind it: the page loaded straight at Settings' address.
    await to(page, "#/settings/display");
    await page.reload();
    await settings(page).waitFor({ timeout: 30_000 });
    await settings(page).getByRole("button", { name: "Close" }).first().click();
    await expect.poll(() => hash(page)).toBe("#/day");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
