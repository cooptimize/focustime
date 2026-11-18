// MC-2: Calls, review any call you were on, in demo mode. MC-3: one list by day, the call or its setup beside it; a call on my calendar that isn't
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

  it("one list (MC-3); Review with a suggested client and Get it from Teams; a refusal in plain words; Add a call; Review this call from Day", async () => {
    const { page, errors } = await freshPage(h);
    // MC-3: the address before Calls was a tab lands on it.
    await page.evaluate(() => (location.hash = "#/meetings"));
    await page.getByRole("heading", { name: "Calls", exact: true }).waitFor({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/calls(\/|$)/);
    const rows = page.locator("[data-calls-list] [data-call-row]");
    await rows.first().waitFor({ timeout: 30_000 });
    // The registered call is listed once, with its weekly mark.
    await expect(rows.filter({ hasText: "Northwind weekly status" }).count()).resolves.toBe(1);
    await expect(rows.filter({ hasText: "Northwind weekly status" }).textContent()).resolves.toContain("Weekly");

    // Review a call on my calendar: the setup opens beside the list, suggests Northwind from its title; Teams is the
    // source. The newest first: this Monday's (last Monday's is further down).
    const model = rows.filter({ hasText: "Northwind data model review" }).first();
    const listedOnce = await rows.filter({ hasText: "Northwind data model review" }).count();
    await expect(model.textContent()).resolves.toContain("Not reviewed");
    // Keyboard: Esc closes the setup and puts focus back on the row; nothing about the call is in the address.
    await model.click();
    await page.getByRole("region", { name: /^Review Northwind data model review/ }).waitFor();
    await expect(model.getAttribute("aria-current")).resolves.toBe("true");
    await page.getByRole("region", { name: /^Review Northwind data model review/ }).getByLabel("Which client is this call about?").focus();
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-call-row"))).toBe(await model.getAttribute("data-call-row"));
    await expect(page.evaluate(() => location.hash)).resolves.not.toContain("Northwind");
    await page.keyboard.press("Enter");
    const setup = page.getByRole("region", { name: /^Review Northwind data model review/ });
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
    // Its row is now the call FocusTime keeps, marked open, listed once.
    await expect.poll(() => rows.filter({ hasText: "Northwind data model review" }).first().getAttribute("aria-current"), { timeout: 30_000 }).toBe("true");
    await expect(rows.filter({ hasText: "Northwind data model review" }).count()).resolves.toBe(listedOnce);

    // A call whose organizer turned transcripts off: plain words, pointing to the upload.
    await rows.filter({ hasText: "Proposal review with Jordan" }).first().click();
    const s2 = page.getByRole("region", { name: /^Review Proposal review with Jordan/ });
    await s2.getByLabel("Which client is this call about?").selectOption({ index: 1 });
    await s2.getByRole("button", { name: "Continue" }).click();
    await expect.poll(() => page.getByText(/didn't let your sign-in read this call's transcript/).count(), { timeout: 30_000 }).toBe(1);
    await page.getByText(/Upload|Choose a file/).first().waitFor();

    // Add a call: only I see it; it opens on its upload, beside the list.
    await page.getByRole("button", { name: "Add a call" }).click();
    const add = page.getByRole("form", { name: "Add a call" });
    await add.getByLabel("Name", { exact: true }).fill("Teammates' huddle on the export");
    await add.getByLabel("About", { exact: true }).selectOption({ index: 1 });
    await add.getByRole("button", { name: /^Add/ }).click();
    await expect.poll(() => page.evaluate(() => location.hash), { timeout: 30_000 }).toMatch(/^#\/calls\/\d+\/upload$/);
    await page.getByText("It's kept 30 days, for you only.", { exact: false }).waitFor({ timeout: 30_000 });
    await expect.poll(() => rows.filter({ hasText: "Teammates' huddle on the export" }).count(), { timeout: 30_000 }).toBe(1);

    // A meeting's menu on Day leads with Review this call (the 14 days count from the app's day, not the browser's
    // clock), and it opens that call's setup on Calls.
    await page.evaluate(() => (location.hash = "#/today/2026-11-03"));
    await page.getByRole("button", { name: "Timeline" }).click().catch(() => undefined);
    await page.locator(".today-tl .event", { hasText: "Harbor sprint planning" }).first().locator(".ev-time").click({ timeout: 30_000 });
    await page.getByRole("menuitem", { name: /^Review this call/ }).click();
    await page.getByRole("region", { name: /^Review Harbor sprint planning/ }).waitFor({ timeout: 30_000 });
    expect(errors).toEqual([]);
  }, T);
});
