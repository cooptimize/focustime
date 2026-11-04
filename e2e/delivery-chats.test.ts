// T-2: Settings > Clients > Delivery chat (browser, demo mode). Keyboard only: open the picker, search, arrow, Enter
// saves the chat as the client's primary; its members show with external people flagged by tenant; a second chat is
// added and made primary; a chat taken by one client isn't offered to another; Clear removes it. Settings >
// Connections lists Chat.ReadBasic with its state. Screenshots at 1920 and Text size Larger when FOCUSTIME_SHOTS is set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, openSettings, startDemo, type Harness } from "./harness.ts";
import { shotBoth } from "./shots.ts";

let h: Harness;

describe.skipIf(!CHROMIUM)("Delivery chats", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("picks a chat by keyboard, flags external members, adds a second, makes it primary, clears it", async () => {
    const { page, errors } = await freshPage(h);
    await openSettings(page);
    await page.locator(".set-nav").getByRole("button", { name: "Clients" }).click();
    const northwind = page.getByRole("group", { name: /^Delivery chat for Northwind/ });
    await northwind.waitFor();
    await northwind.getByRole("button", { name: "Pick a chat" }).focus();
    await page.keyboard.press("Enter");
    const search = northwind.getByRole("combobox", { name: "Search your Teams group chats" });
    await expect(search.evaluate((e) => e === document.activeElement)).resolves.toBe(true);
    await northwind.getByRole("option").first().waitFor();
    await page.keyboard.type("northwind delivery");
    await expect(northwind.getByRole("option").count()).resolves.toBe(1);
    await shotBoth(page, "delivery-chat-picker", northwind);
    await page.keyboard.press("Enter");

    const card = northwind.locator(".dchat-card", { hasText: "Northwind Delivery Team (Cooptimize)" });
    await card.waitFor();
    await card.getByText("Primary").waitFor();
    await northwind.getByText("Saved as the primary chat").waitFor();
    const link = card.getByRole("link", { name: "Open in Teams" });
    expect(await link.getAttribute("href")).toMatch(/^https:\/\/teams\.microsoft\.com\//);
    expect(await link.getAttribute("rel")).toContain("noopener");
    const summary = card.locator(".dchat-members summary");
    await expect(summary.textContent()).resolves.toMatch(/\d+ members · \d+ external/);
    await summary.focus();
    await page.keyboard.press("Enter");
    const external = await card.locator(".dchat-members li", { has: page.locator(".dchat-ext") }).count();
    expect(external).toBeGreaterThan(0);
    expect(external).toBeLessThan(await card.locator(".dchat-members li").count());
    await shotBoth(page, "delivery-chat-members", northwind);

    // A second chat for Northwind, then make it primary.
    await northwind.getByRole("button", { name: "Add another chat" }).click();
    await northwind.getByRole("option").first().waitFor();
    await expect(northwind.getByRole("option", { name: /Northwind Delivery Team/ }).count()).resolves.toBe(0);
    await page.keyboard.type("lunch");
    await page.keyboard.press("Enter");
    const second = northwind.locator(".dchat-card", { hasText: "Friday lunch crew" });
    await second.waitFor();
    await second.getByRole("button", { name: "Make primary" }).click();
    await second.getByText("Primary").waitFor();
    await card.getByRole("button", { name: "Make primary" }).waitFor();

    // Harbor's picker doesn't offer either Northwind chat; Esc closes it.
    const harbor = page.getByRole("group", { name: /^Delivery chat for Harbor/ });
    await harbor.getByRole("button", { name: "Pick a chat" }).click();
    await harbor.getByRole("option").first().waitFor();
    const offered = await harbor.getByRole("option").allTextContents();
    expect(offered.some((t) => t.includes("Northwind Delivery Team") || t.includes("Friday lunch crew"))).toBe(false);
    await page.keyboard.press("Escape");
    await harbor.getByRole("button", { name: "Pick a chat" }).waitFor();

    // Clear the primary: the other one becomes primary.
    await second.getByRole("button", { name: /^Clear / }).click();
    await second.waitFor({ state: "detached" });
    await card.getByText("Primary").waitFor();
    expect(errors).toEqual([]);
  }, 90_000);

  it("Connections lists every Microsoft permission, Chat.ReadBasic among them", async () => {
    const { page, errors } = await freshPage(h);
    await openSettings(page);
    await page.locator(".set-nav").getByRole("button", { name: "Connections" }).click();
    const row = page.locator(".perms li", { hasText: "Chat.ReadBasic" });
    await row.waitFor();
    await expect(row.textContent()).resolves.toContain("never messages");
    await expect(page.locator(".perms li").count()).resolves.toBeGreaterThanOrEqual(8);
    await shotBoth(page, "connections-permissions", page.locator(".perms"));
    expect(errors).toEqual([]);
  }, 60_000);
});
