// UC-2 (browser, demo mode): the Inbox's chips add up to the tab's number in every case. Something the tab counts with
// no client (a promise I added with none) gets a "No client" chip after the clients, with its number, that filters to
// those rows; with nothing of that kind there is no such chip. UC-3: the phone has it too, without a number.
// Fictional data only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 300_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const chips = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".ib4-chips .ib4-chip")].map((c) => ({ text: c.textContent ?? "", name: c.getAttribute("aria-label") ?? "", n: Number(c.querySelector(".ib4-count")?.textContent ?? 0), on: c.getAttribute("aria-pressed") === "true", none: c.dataset.chip === "no-client" })));
const tabNumber = async (page: Page) => Number(await page.locator("[aria-label$='need you'], [aria-label$='needs you']").first().textContent());

describe.skipIf(!CHROMIUM)("UC-2: the Inbox's chips add up to the tab's number (browser, demo mode)", () => {
  let h: Harness;
  let page: Page;
  beforeAll(async () => {
    h = await startDemo();
    ({ page } = await freshPage(h, { width: 1440, height: 900 }));
    await call(page, "ui.set_inbox", { clients: [] });
  }, T);
  afterAll(async () => h?.stop());

  const open = async () => {
    await page.reload();
    await page.evaluate(() => (location.hash = "#/inbox/promises"));
    await page.locator(".ib4-chips .ib4-chip").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(300);
  };

  it("with no row lacking a client: no No client chip, and the client chips add up to the tab", async () => {
    await open();
    const got = await chips(page);
    const tab = await tabNumber(page);
    expect(got.some((c) => c.none || /No client/.test(c.text))).toBe(false);
    expect(got[0]!.n).toBe(tab);
    expect(got.slice(1).reduce((a, c) => a + c.n, 0)).toBe(tab);
  }, T);

  it("with one: a No client chip after the clients, with its number; the chips add up; it filters to those rows", async () => {
    const added = await call(page, "followup.add", { what: "Send the cutover checklist", due: "2026-11-01" });
    expect(added.ok).toBe(true);
    await open();
    const got = await chips(page);
    const tab = await tabNumber(page);
    expect(got.at(-1)).toMatchObject({ none: true, n: 1, name: "No client, 1 needs you", on: false });
    expect(got.at(-1)!.text).toMatch(/^No client/);
    expect(got[0]!.n).toBe(tab);
    expect(got.slice(1).reduce((a, c) => a + c.n, 0), "the chips add up to the tab's number").toBe(tab);
    expect(await page.locator('[data-chip="no-client"]').getAttribute("title")).toMatch(/^1 needs you with no client: /);
    // Chosen, the list shows only the rows with no client.
    await page.locator('[data-chip="no-client"]').click();
    await expect.poll(() => page.locator("li.ib4-row .ib4-row-title").allTextContents()).toEqual(["Send the cutover checklist"]);
    expect((await chips(page))[0]!.on).toBe(false);
    // By keyboard too: it is a button in the chips' group.
    await page.locator('[data-chip="no-client"]').focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.locator('[data-chip="no-client"]').getAttribute("aria-pressed")).toBe("false");
    expect(await page.locator("li.ib4-row .ib4-row-title").count()).toBeGreaterThan(1);
    // All clients puts everything back.
    await page.locator('[data-chip="no-client"]').click();
    await page.locator(".ib4-chips .ib4-chip").first().click();
    expect((await chips(page))[0]!.on).toBe(true);
    // Once nothing has no client, the chip goes.
    expect((await call(page, "followup.delete", { id: added.data.followUp.id })).ok).toBe(true);
    await open();
    expect(await page.locator('[data-chip="no-client"]').count()).toBe(0);
  }, T);

  // UC-3 item 5: the phone has the No client chip too, without a number like its other chips, only while something
  // has no client; it filters to those rows.
  it("the phone: a No client chip, without a number, only while something has no client", async () => {
    const phone = await freshPage(h, { width: 390, height: 844 });
    const go = async () => {
      await phone.page.reload();
      await phone.page.evaluate(() => (location.hash = "#/inbox/promises"));
      await phone.page.locator(".ib4-chips .ib4-chip").first().waitFor({ timeout: 30_000 });
      await phone.page.waitForTimeout(300);
    };
    await go();
    expect(await phone.page.locator('[data-chip="no-client"]').count(), "nothing without a client: no chip").toBe(0);
    // Each page is its own demo session: the promise is added in the phone's.
    const added = await call(phone.page, "followup.add", { what: "Send the cutover checklist", due: "2026-11-01" });
    await go();
    const none = phone.page.locator('[data-chip="no-client"]');
    await expect(none.textContent()).resolves.toBe("No client");
    expect(await phone.page.locator(".ib4-chips .ib4-count").count(), "the phone's chips have no numbers").toBe(0);
    await none.click();
    await expect.poll(() => phone.page.locator("li.ib4-row .ib4-row-title").allTextContents()).toEqual(["Send the cutover checklist"]);
    expect((await call(phone.page, "followup.delete", { id: added.data.followUp.id })).ok).toBe(true);
    await go();
    expect(await phone.page.locator('[data-chip="no-client"]').count(), "once nothing lacks a client, the chip goes").toBe(0);
    await phone.page.close();
  }, T);
});
