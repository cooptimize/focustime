// UC-2 (browser, demo mode): today's words in Admin. Item 10: Admin says "Client chats", never "Delivery chats".
// Fictional data only.
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
});
