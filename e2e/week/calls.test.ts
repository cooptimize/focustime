// MC-2: Calls, review any call you were on, in demo mode. Calls has both lists; a call on my calendar that isn't
// registered opens its setup with the client suggested; Get it from Teams reads it on the press and the same page
// follows, with its summary above the proposals; a call whose organizer turned transcripts off says so and points to
// the upload; Add a call keeps one for me and opens on its upload. Clock: Thursday Nov 5, 2026 10:00 AM ET.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

let h: Harness;
const T = 180_000;

describe.skipIf(!CHROMIUM)("Calls (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
  }, 120_000);
  afterAll(async () => h?.stop());

  it("both lists; Review with a suggested client and Get it from Teams; a refusal in plain words; Add a call", async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/meetings"));
    await page.getByRole("heading", { name: "Calls", exact: true }).waitFor({ timeout: 30_000 });
    await page.getByRole("heading", { name: "Client calls" }).waitFor();
    await page.getByRole("heading", { name: "Your other calls" }).waitFor();
    const others = page.locator(".mtg-other");
    await others.first().waitFor({ timeout: 30_000 });
    // The registered call isn't listed twice.
    await expect(others.filter({ hasText: "Northwind weekly status" }).count()).resolves.toBe(0);

    // Review a call on my calendar: the setup suggests Northwind from its title; Teams is the source.
    // The newest first: this Monday's (last Monday's is further down).
    const model = others.filter({ hasText: "Northwind data model review" }).first();
    await expect(model.locator(".mtg-state").textContent()).resolves.toBe("Not reviewed");
    await model.getByRole("button", { name: /^Review/ }).click();
    const setup = page.getByRole("dialog", { name: /^Review Northwind data model review/ });
    await setup.waitFor();
    const client = setup.getByLabel("Which client is this call about?");
    await expect(client.locator("option:checked").textContent()).resolves.toMatch(/Northwind.*\(suggested\)/);
    await expect(setup.getByRole("radio", { name: /Get it from Teams/ }).isChecked()).resolves.toBe(true);
    await setup.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
    await expect.poll(() => page.getByText(/^Got the transcript from Teams/).count(), { timeout: 30_000 }).toBe(1);
    const summary = page.getByRole("region", { name: "What was said" });
    await summary.waitFor({ timeout: 30_000 });
    expect(await summary.locator("li").count()).toBeLessThanOrEqual(5);
    await page.locator(".mtg-view").getByRole("button", { name: "Back to Calls" }).click();
    await expect.poll(() => page.locator(".mtg-other").filter({ hasText: "Northwind data model review" }).getByRole("button", { name: /^Open/ }).count(), { timeout: 30_000 }).toBe(1);

    // A call whose organizer turned transcripts off: plain words, pointing to the upload.
    const prop = page.locator(".mtg-other").filter({ hasText: "Proposal review with Jordan" }).first();
    await prop.getByRole("button", { name: /^Review/ }).click();
    const s2 = page.getByRole("dialog", { name: /^Review Proposal review with Jordan/ });
    await s2.getByLabel("Which client is this call about?").selectOption({ index: 1 });
    await s2.getByRole("button", { name: "Continue" }).click();
    await expect.poll(() => page.getByText(/didn't let your sign-in read this call's transcript/).count(), { timeout: 30_000 }).toBe(1);
    await page.getByText(/Upload|Choose a file/).first().waitFor();
    await page.locator(".mtg-view").getByRole("button", { name: "Back to Calls" }).click();

    // Add a call: only I see it; it opens on its upload.
    await page.getByRole("button", { name: "Add a call" }).click();
    const add = page.getByRole("form", { name: "Add a call" });
    await add.getByLabel("Name", { exact: true }).fill("Teammates' huddle on the export");
    await add.getByLabel("About", { exact: true }).selectOption({ index: 1 });
    await add.getByRole("button", { name: /^Add/ }).click();
    await expect.poll(() => page.evaluate(() => location.hash), { timeout: 30_000 }).toMatch(/^#\/meetings\/\d+\/upload$/);
    await page.getByText("It's kept 30 days, for you only.", { exact: false }).waitFor({ timeout: 30_000 });
    expect(errors).toEqual([]);
  }, T);
});
