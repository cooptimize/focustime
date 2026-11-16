// NM-2 C1 (browser, demo mode): a to-do's title on a Week block card opens its story card, also for a to-do stored with
// its item's id and no URL (every to-do the demo seeds). Keyboard: the title is a link, Enter opens it; Esc closes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { PS_CLOCK } from "../ps1-states.ts";

let h: Harness;
const T = 120_000;

describe.skipIf(!CHROMIUM)("NM-2: a to-do's title on a card opens its story card", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, PS_CLOCK);
  }, 120_000);
  afterAll(async () => h?.stop());

  it("click and Enter open the card, and Esc closes it", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await page.evaluate(() => (location.hash = "#/week"));
    const title = page.locator("main li.pick-row .pr-title a[data-card]").first();
    await title.waitFor({ timeout: 15_000 });
    const target = (await title.getAttribute("data-card"))!;
    const [client, id] = target.split(":");
    await title.click();
    await page.getByRole("dialog", { name: new RegExp(`#${id}`) }).waitFor();
    expect(await page.evaluate(() => location.hash)).toBe(`#/item/${encodeURIComponent(client!)}/${id}`);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.getByRole("dialog").count()).toBe(0);
    // The keyboard path: the link takes focus and Enter opens the same card.
    await title.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: new RegExp(`#${id}`) }).waitFor();
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
