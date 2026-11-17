// UC-2 (browser, demo mode): Rename is no longer a button on a Backlog row; it stays in the row's menu and on F2, and
// New under and the menu stay. Pointed at, at 1280, a long title gets the button's room. Fictional data only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { pickLevel } from "../backlog-helpers.ts";

const T = 300_000;
let h: Harness;
const LONG = "Delivery time estimates for every carrier, lane and customer region, shown to dispatchers";
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe.skipIf(!CHROMIUM)("UC-2: Backlog's rows have no Rename button (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("pointed at: New under and the menu, no Rename; the menu and F2 rename; a long title is wider than before (154 px)", async () => {
    const { page, errors } = await freshPage(h, { width: 1280, height: 900 });
    expect((await call(page, "ahead.stage", { clientKey: "Atlas", itemId: 3340, field: "title", value: LONG })).ok).toBe(true);
    await page.reload();
    await page.evaluate(() => (location.hash = "#/backlog"));
    await page.locator(".ah-client").first().waitFor({ timeout: 30_000 });
    const chips = page.locator(".ah-toolbar").getByRole("group", { name: "Clients" });
    for (const b of await chips.getByRole("button").all()) if ((await b.getAttribute("aria-pressed")) === "true") await b.click();
    await chips.getByRole("button", { name: "Atlas Freight", exact: true }).click();
    await page.getByRole("group", { name: "People" }).getByRole("button", { name: "Everyone" }).click();
    await pickLevel(page, "Features");
    const row = page.locator(".ah-row", { has: page.locator(".ah-title", { hasText: LONG }) });
    await row.hover();
    expect(await row.locator(".ah-rename-btn").count()).toBe(0);
    expect(await row.getByRole("button", { name: /^Rename/ }).count()).toBe(0);
    expect(await row.locator(".ah-row-more").isVisible()).toBe(true);
    expect(await row.locator(".ah-new-under").count()).toBeGreaterThan(0);
    // Before UC-2 this title was 154 px wide here, with a 28 px Rename button beside it.
    const width = await row.locator(".ah-title").evaluate((el) => Math.round(el.getBoundingClientRect().width));
    expect(width).toBeGreaterThanOrEqual(154 + 28);
    // The menu's Rename.
    await row.locator(".ah-row-more").click();
    await page.getByRole("menuitem", { name: /^Rename/ }).click();
    const box = page.getByRole("textbox", { name: "Title of #3340" });
    await box.waitFor();
    await page.keyboard.press("Escape");
    await box.waitFor({ state: "detached" });
    // F2 on the Item cell.
    await row.locator("td.ah-col-item").click({ position: { x: 4, y: 4 } });
    await page.keyboard.press("F2");
    await box.waitFor();
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
