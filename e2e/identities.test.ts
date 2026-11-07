// AH-3: client DevOps identities in demo mode. Harbor's demo project has two client logins: Priya's ("Ext-Priya Shah")
// comes from her Account Worker row in the demo Dataverse, so Ahead shows her FocusTime name; Sam's ("Ext-Sam Ortiz")
// is only a suggestion in Admin › People, shown as DevOps has it until an admin confirms it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 120_000;

async function openAdmin(page: Page, item: string) {
  await page.getByRole("button", { name: /^More: the Guide/ }).click();
  await page.getByRole("menuitem", { name: "Admin" }).click();
  await page.locator(`.ps-rail [data-settings-section="admin-${item.toLowerCase()}"]`).click();
  await page.locator(".ps-head h2", { hasText: `Admin › ${item}` }).waitFor();
}

describe.skipIf(!CHROMIUM)("client DevOps identities (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  const ahead = async (page: Page) => {
    await page.evaluate(() => (location.hash = "#/ahead"));
    await page.locator(".ah-pending").waitFor({ timeout: 30_000 });
    await page.getByRole("group", { name: "Owner" }).getByRole("button", { name: "All" }).click();
    return (title: string) => page.locator(".ah-row", { has: page.getByRole("link", { name: title, exact: true }) }).locator(".ah-col-assignee");
  };

  it("a linked login shows the FocusTime name; a suggestion changes nothing until Confirm; then it's Sam everywhere", async () => {
    const { page, errors } = await freshPage(h, { width: 1920, height: 1080 });
    // AH-5: the cell shows "First L."; the full name is its title.
    let who = await ahead(page);
    await expect(who("Referral tracking").locator(".ah-who").getAttribute("title")).resolves.toContain("Priya Shah");
    await expect(who("Referral tracking").locator(".ah-who").getAttribute("title")).resolves.not.toContain("Ext-");
    await expect(who("Referral source field").locator(".ah-who").getAttribute("title")).resolves.toContain("Ext-Sam Ortiz");

    await openAdmin(page, "People");
    const ids = page.getByRole("region", { name: "Client DevOps identities" });
    await expect(ids.locator(".adm-id-line").first().textContent()).resolves.toBe("2 identities on Harbor look like client logins, 1 linked");
    const harbor = ids.getByRole("list", { name: "Harbor identities" });
    await expect(harbor.locator(".adm-id-row.linked").textContent()).resolves.toContain("Priya Shah · from Dataverse");
    await expect(harbor.locator(".adm-id-row.suggested").textContent()).resolves.toContain("Looks like Sam Ortiz");
    // No emails on the page.
    await expect(ids.textContent()).resolves.not.toMatch(/@/);
    await harbor.getByRole("button", { name: "Confirm Ext-Sam Ortiz is Sam Ortiz" }).click();
    await expect.poll(() => ids.getByRole("status").textContent()).toBe("Ext-Sam Ortiz is Sam Ortiz on Harbor. Logged in Admin › Audit.");
    await expect(ids.locator(".adm-id-line").first().textContent()).resolves.toBe("2 identities on Harbor look like client logins, 2 linked");
    await expect(harbor.locator(".adm-id-row.suggested").count()).resolves.toBe(0);

    who = await ahead(page);
    await expect(who("Referral source field").locator(".ah-who").getAttribute("title")).resolves.toContain("Sam Ortiz");
    await expect(who("Referral source field").locator(".ah-who").getAttribute("title")).resolves.not.toContain("Ext-");

    // Remove puts it back to a suggestion-free unmatched login (an admin said it isn't him).
    await openAdmin(page, "People");
    await harbor.getByRole("button", { name: "Remove Ext-Sam Ortiz from Sam Ortiz" }).click();
    await expect.poll(() => ids.locator(".adm-id-line").first().textContent()).toBe("2 identities on Harbor look like client logins, 1 linked");
    await expect(harbor.locator(".adm-id-row.unmatched").textContent()).resolves.toContain("Ext-Sam Ortiz");
    await expect(harbor.getByRole("combobox", { name: "Link Ext-Sam Ortiz to a person" }).count()).resolves.toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
