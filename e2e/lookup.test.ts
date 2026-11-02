// Step 15.2: the shared work item lookup, clicked in a real browser on demo data.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 60_000;

describe.skipIf(!CHROMIUM)("Work item lookup (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  const lookup = (page: Page) => page.locator(".item-lookup").first();

  it("follow-up form: disabled without a client, searches the client's items, links one, a new client clears it", async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("4");
    await page.getByRole("button", { name: "Add a follow-up" }).first().click();
    const form = page.locator("form.follow-up-add");
    await form.getByLabel("Client").selectOption({ label: "No client" });
    await expect(lookup(page).locator("input").isDisabled()).resolves.toBe(true);
    await form.getByLabel("Client").selectOption({ label: "Northwind" });
    const box = lookup(page).locator("input");
    await box.fill("export");
    const results = page.locator(".item-lookup-list [role=option]");
    await expect.poll(() => results.count()).toBeGreaterThan(0);
    const first = (await results.first().textContent())!;
    await box.press("ArrowDown");
    await box.press("Enter");
    await expect(page.locator(".item-lookup.linked").textContent()).resolves.toContain(first.split("#")[0]!.replace(/^\S+\s/, "").trim());
    await form.getByLabel("Client").selectOption({ label: "Harbor" });
    await expect(page.locator(".item-lookup.linked").count()).resolves.toBe(0);
    await form.getByLabel("Client").selectOption({ label: "Northwind" });
    await box.fill("export");
    await box.press("ArrowDown");
    await box.press("Enter");
    await form.locator("input[required]").fill("Send the export spec");
    await form.getByRole("button", { name: "Add" }).click();
    await expect.poll(() => page.locator(".follow-up", { hasText: "Send the export spec" }).locator(".follow-up-item a").count()).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Enter on text that matches nothing keeps the plain text", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("4");
    await page.getByRole("button", { name: "Add a follow-up" }).first().click();
    const form = page.locator("form.follow-up-add");
    await form.getByLabel("Client").selectOption({ label: "Northwind" });
    const box = lookup(page).locator("input");
    await box.fill("the pallet labels");
    await box.press("Enter");
    await expect(box.inputValue()).resolves.toBe("the pallet labels");
    expect(await page.locator(".item-lookup.linked").count()).toBe(0);
    await page.close();
  }, T);

  it("flex session form uses the same lookup", async () => {
    const { page } = await freshPage(h);
    await page.keyboard.press("Control+k");
    await page.keyboard.type("flex session");
    await page.getByRole("menuitem", { name: /Add a flex session|flex session/i }).first().click();
    await page.getByRole("menuitem").first().click();
    await expect.poll(() => page.locator(".menu-form .item-lookup").count()).toBe(1);
    await page.keyboard.press("Escape");
    await page.close();
  }, T);
});
