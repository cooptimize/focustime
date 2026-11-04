// T-2 and T-2.1: Settings > Clients > Teams chats (browser, demo mode). Each client has a Delivery team slot and a
// Customer collaboration slot. Keyboard only: open a slot's picker, which puts the chats that suggest its kind first,
// search, Enter saves it; members show with external people flagged by tenant; an outsider in the internal chat is
// warned about; Change replaces a slot's chat; a chat set for one client isn't offered again; Clear empties one slot
// and leaves the other. Settings > Connections lists Chat.ReadBasic with its state. Screenshots at 1920 and Text size Larger when FOCUSTIME_SHOTS is set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, openSettings, startDemo, type Harness } from "./harness.ts";
import { shotBoth } from "./shots.ts";

let h: Harness;

describe.skipIf(!CHROMIUM)("Delivery chats", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("fills both slots by keyboard, flags external members, warns about an outsider, changes and clears one", async () => {
    const { page, errors } = await freshPage(h);
    await openSettings(page);
    await page.locator(".set-nav").getByRole("button", { name: "Clients" }).click();
    const northwind = page.getByRole("group", { name: /^Teams chats for Northwind/ });
    const team = northwind.getByRole("region", { name: /^Delivery team chat/ });
    const customer = northwind.getByRole("region", { name: /^Customer collaboration chat/ });
    await team.waitFor();

    // Delivery team: the internal chats come first.
    await team.getByRole("button", { name: "Pick a chat" }).focus();
    await page.keyboard.press("Enter");
    const search = team.getByRole("combobox");
    await expect(search.evaluate((e) => e === document.activeElement)).resolves.toBe(true);
    await team.getByRole("option").first().waitFor();
    await expect(team.getByRole("option").first().textContent()).resolves.toContain("Internal");
    await page.keyboard.type("northwind delivery");
    await expect(team.getByRole("option").count()).resolves.toBe(1);
    await shotBoth(page, "client-chats-picker", northwind);
    await page.keyboard.press("Enter");
    const teamCard = team.locator(".dchat-card", { hasText: "Northwind Delivery Team (Cooptimize)" });
    await teamCard.waitFor();
    await northwind.getByText("Saved as the Delivery team chat").waitFor();
    await expect(teamCard.locator(".dchat-members summary").textContent()).resolves.toMatch(/3 members · no external people/);

    // Customer collaboration: the chats with the client come first; the one already set isn't offered.
    await customer.getByRole("button", { name: "Pick a chat" }).click();
    await customer.getByRole("option").first().waitFor();
    await expect(customer.getByRole("option").first().textContent()).resolves.toContain("With the client");
    await expect(customer.getByRole("option", { name: /Northwind Delivery Team/ }).count()).resolves.toBe(0);
    await page.keyboard.type("northwind collab");
    await page.keyboard.press("Enter");
    const custCard = customer.locator(".dchat-card", { hasText: "Northwind Customer Collaboration" });
    await custCard.waitFor();
    const link = custCard.getByRole("link", { name: "Open in Teams" });
    expect(await link.getAttribute("href")).toMatch(/^https:\/\/teams\.microsoft\.com\//);
    expect(await link.getAttribute("rel")).toContain("noopener");
    const summary = custCard.locator(".dchat-members summary");
    await expect(summary.textContent()).resolves.toMatch(/4 members · 2 external/);
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(custCard.locator(".dchat-members li", { has: page.locator(".dchat-ext") }).count()).resolves.toBe(2);
    await shotBoth(page, "client-chats-both", northwind);

    // Harbor's Delivery Team chat has someone from Harbor in it: the slot says so.
    const harbor = page.getByRole("group", { name: /^Teams chats for Harbor/ });
    const harborTeam = harbor.getByRole("region", { name: /^Delivery team chat/ });
    await harborTeam.getByRole("button", { name: "Pick a chat" }).click();
    await harborTeam.getByRole("option").first().waitFor();
    const offered = await harborTeam.getByRole("option").allTextContents();
    expect(offered.some((t) => t.includes("Northwind"))).toBe(false);
    await page.keyboard.type("harbor health delivery");
    await page.keyboard.press("Enter");
    await harborTeam.getByText("1 person from outside Cooptimize is in this internal chat").waitFor();
    await shotBoth(page, "client-chats-warning", harbor);

    // Change replaces Northwind's team chat; Clear empties the customer slot and leaves the team one.
    await team.getByRole("button", { name: "Change" }).click();
    await team.getByRole("option").first().waitFor();
    await page.keyboard.type("lunch");
    await page.keyboard.press("Enter");
    await team.locator(".dchat-card", { hasText: "Friday lunch crew" }).waitFor();
    await teamCard.waitFor({ state: "detached" });
    await custCard.getByRole("button", { name: /^Clear / }).click();
    await custCard.waitFor({ state: "detached" });
    await customer.getByText("No Customer collaboration chat yet.").waitFor();
    await team.locator(".dchat-card", { hasText: "Friday lunch crew" }).waitFor();
    await page.keyboard.press("Escape");
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
