// T-2 and AP-1: Admin › Clients › Delivery chats (ADM-1; was Settings › Clients) (browser, demo mode). Keyboard only: Add a chat opens the picker,
// search, Enter adds it, labelled with the kind its members suggest; members show with external people flagged by
// tenant; a client takes a second chat; the label can change, and an outsider in a chat marked Delivery team is warned
// about; a chat added for one client isn't offered to another; Remove forgets one and leaves the rest; Add a chat works
// while the saved chats still load. Settings > Connections lists Chat.ReadBasic with its state. Screenshots at 1920 and
// Text size Larger when FOCUSTIME_SHOTS is set.
import type { Locator } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, openSettings, startDemo, type Harness } from "./harness.ts";
import { shotBoth } from "./shots.ts";

let h: Harness;
/** The picker's chat list (the kind dropdowns have options too). */
const picks = (g: Locator) => g.getByRole("listbox", { name: "Your Teams group chats" });

describe.skipIf(!CHROMIUM)("Delivery chats", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("adds two chats by keyboard, flags external members, relabels one with a warning, removes one", async () => {
    const { page, errors } = await freshPage(h);
    await openSettings(page);
    // ADM-1: registering chats is in Admin › Clients (the demo's person is the demo's admin).
    await page.locator(".set-admin-nav").getByRole("button", { name: "Clients" }).click();
    const northwind = page.getByRole("group", { name: /^Delivery chats for Northwind/ });
    await northwind.waitFor();

    // Add the internal team chat: search, Enter.
    await northwind.getByRole("button", { name: "Add a chat" }).focus();
    await page.keyboard.press("Enter");
    const search = northwind.getByRole("combobox", { name: "Search your Teams group chats" });
    await expect(search.evaluate((e) => e === document.activeElement)).resolves.toBe(true);
    await picks(northwind).getByRole("option").first().waitFor();
    await page.keyboard.type("northwind delivery");
    await expect(picks(northwind).getByRole("option").count()).resolves.toBe(1);
    await expect(picks(northwind).getByRole("option").first().textContent()).resolves.toContain("Internal");
    await shotBoth(page, "client-chats-picker", northwind);
    await page.keyboard.press("Enter");
    const teamCard = northwind.getByRole("region", { name: "Northwind Delivery Team (Cooptimize)" });
    await teamCard.waitFor();
    await northwind.getByText("Added Northwind Delivery Team (Cooptimize)").waitFor();
    await expect(teamCard.getByRole("combobox", { name: /^Kind of chat/ }).inputValue()).resolves.toBe("delivery");
    await expect(teamCard.locator(".dchat-members summary").textContent()).resolves.toMatch(/3 members · no external people/);

    // A second chat for the same client, the one with the client: labelled Customer collaboration; the first isn't offered.
    await northwind.getByRole("button", { name: "Add a chat" }).click();
    await picks(northwind).getByRole("option").first().waitFor();
    await expect(picks(northwind).getByRole("option", { name: /Northwind Delivery Team/ }).count()).resolves.toBe(0);
    await page.keyboard.type("northwind collab");
    await page.keyboard.press("Enter");
    const custCard = northwind.getByRole("region", { name: "Northwind Customer Collaboration (Cooptimize)" });
    await custCard.waitFor();
    await expect(custCard.getByRole("combobox", { name: /^Kind of chat/ }).inputValue()).resolves.toBe("customer");
    const link = custCard.getByRole("link", { name: "Open in Teams" });
    expect(await link.getAttribute("href")).toMatch(/^https:\/\/teams\.microsoft\.com\//);
    expect(await link.getAttribute("rel")).toContain("noopener");
    const summary = custCard.locator(".dchat-members summary");
    await expect(summary.textContent()).resolves.toMatch(/4 members · 2 external/);
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(custCard.locator(".dchat-members li", { has: page.locator(".dchat-ext") }).count()).resolves.toBe(2);
    await shotBoth(page, "client-chats-both", northwind);

    // Marking the chat with the client as Delivery team: the warning shows; back again, it goes.
    await custCard.getByRole("combobox", { name: /^Kind of chat/ }).selectOption("delivery");
    await custCard.getByText("2 people from outside Cooptimize are in this internal chat").waitFor();
    await shotBoth(page, "client-chats-warning", northwind);
    await custCard.getByRole("combobox", { name: /^Kind of chat/ }).selectOption("customer");
    await custCard.getByText("2 people from outside Cooptimize are in this internal chat").waitFor({ state: "detached" });

    // Harbor's picker doesn't offer Northwind's chats; Esc closes it.
    const harbor = page.getByRole("group", { name: /^Delivery chats for Harbor/ });
    await harbor.getByRole("button", { name: "Add a chat" }).click();
    await picks(harbor).getByRole("option").first().waitFor();
    expect((await picks(harbor).getByRole("option").allTextContents()).some((t) => t.includes("Northwind"))).toBe(false);
    await page.keyboard.press("Escape");
    await harbor.getByRole("button", { name: "Add a chat" }).waitFor();

    // Remove forgets one and leaves the other.
    await custCard.getByRole("button", { name: /^Remove / }).click();
    await custCard.waitFor({ state: "detached" });
    await teamCard.waitFor();
    expect(errors).toEqual([]);
  }, 90_000);

  it("Add a chat opens the picker while the saved chats are still loading", async () => {
    const { page, errors } = await freshPage(h);
    // Hold chats.registered (a real sign-in reads Teams for it, which can take seconds); the picker doesn't need it.
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/api/action", async (route) => {
      if (/"chats\.registered"/.test(route.request().postData() ?? "")) await held;
      await route.continue();
    });
    await openSettings(page);
    await page.locator(".set-admin-nav").getByRole("button", { name: "Clients" }).click();
    const northwind = page.getByRole("group", { name: /^Delivery chats for Northwind/ });
    await northwind.getByRole("button", { name: "Add a chat" }).click({ timeout: 5_000 });
    await picks(northwind).getByRole("option").first().waitFor();
    release();
    expect(errors).toEqual([]);
  }, 60_000);

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
