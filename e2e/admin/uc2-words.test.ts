// UC-2 (browser, demo mode): today's words in Admin. Item 10: Admin says "Client chats", never "Delivery chats".
// Item 11: Admin › Conversations doesn't show "Closed conversations stay shown (days)"; the value stays stored and is
// still read and returned. Fictional data only.
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, openSettings, startDemo, type Harness } from "../harness.ts";

const T = 300_000;
let h: Harness;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** What a person reads on an Admin page: its text and its labels. */
const readable = (page: Page) => page.evaluate(() => [document.querySelector(".ps-body, main")?.textContent ?? "", ...[...document.querySelectorAll("[aria-label], [title]")].map((e) => `${e.getAttribute("aria-label") ?? ""} ${e.getAttribute("title") ?? ""}`), document.querySelector(".ps-rail")?.textContent ?? ""].join("\n"));
const admin = async (page: Page, section: string) => {
  await page.locator(`.ps-rail [data-settings-section="${section}"]`).click();
  await page.waitForTimeout(800);
};

describe.skipIf(!CHROMIUM)("UC-2: today's words in Admin (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("10: Admin says Client chats, never Delivery chats", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 1000 });
    await openSettings(page);
    for (const section of ["admin-clients", "admin-conversations"]) {
      await admin(page, section);
      const text = await readable(page);
      expect(text, section).not.toMatch(/Delivery chats?/i);
    }
    await admin(page, "admin-clients");
    await page.getByRole("group", { name: /^Client chats for / }).first().waitFor();
    expect(await page.locator(".ps-rail").textContent()).toContain("Client chats");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("11: Admin › Conversations doesn't show the closed rule; its value is kept and still returned", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 1000 });
    expect((await call(page, "admin.set", { scope: "org", key: "conv.closed_shown_days", value: 21 })).ok).toBe(true);
    await page.reload();
    await openSettings(page);
    await admin(page, "admin-conversations");
    await page.getByText("Reading client chats").first().waitFor({ timeout: 15_000 });
    expect(await readable(page)).not.toMatch(/Closed conversations stay shown/);
    // Kept: the stored value comes back from the server as it was set.
    const loaded = JSON.stringify((await call(page, "admin.load", { section: "conversations" })).data);
    expect(loaded).toContain('"closedShownDays":21');
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
