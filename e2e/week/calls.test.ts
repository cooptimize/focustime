// MC-2: Calls, review any call you were on, in demo mode. MC-3: one list by day, the call or its setup beside it; a call on my calendar that isn't
// registered opens its setup with the client suggested; Get it from Teams reads it on the press and the same page
// follows, with its summary above the proposals; a call whose organizer turned transcripts off says so and points to
// the upload; Add a call keeps one for me and opens on its transcript choices (MC-5). Clock: Thursday Nov 5, 2026 10:00 AM ET.
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
    // MC-4: this week's registered call needs me (Needs you, what is left); last week's ended with no transcript, so it is Closed.
    await expect(rows.filter({ hasText: "Northwind weekly status" }).count()).resolves.toBe(1);
    await expect(page.locator("[data-section='needs']").textContent()).resolves.toMatch(/Northwind weekly status[\s\S]*\d+ left/);

    // MC-5: a calendar call Teams has a transcript for, with a client on its row (FocusTime's suggestion from its title,
    // in its small picker), opens straight into its review on a click: no setup. The newest first: this Monday's.
    const model = rows.filter({ hasText: "Northwind data model review" }).first();
    const listedOnce = await rows.filter({ hasText: "Northwind data model review" }).count();
    const modelRow = page.locator("[data-calls-list] li").filter({ has: page.locator(".calls-name", { hasText: "Northwind data model review" }) }).first();
    await expect.poll(() => modelRow.locator("[data-call-mark]").textContent(), { timeout: 30_000 }).toBe("Teams");
    await expect(modelRow.locator("[data-call-mark]").getAttribute("title")).resolves.toBe("Transcript in Teams");
    await expect(modelRow.locator("[data-call-about] option:checked").textContent()).resolves.toBe("Northwind");
    await model.click();
    await page.getByRole("heading", { level: 2, name: "Northwind data model review" }).waitFor({ timeout: 30_000 });
    const summary = page.getByRole("region", { name: "What was said" });
    await summary.waitFor({ timeout: 30_000 });
    expect(await summary.locator("li").count()).toBeLessThanOrEqual(5);
    // Its row is now the call FocusTime keeps, marked open, listed once.
    await expect.poll(() => rows.filter({ hasText: "Northwind data model review" }).first().getAttribute("aria-current"), { timeout: 30_000 }).toBe("true");
    await expect(rows.filter({ hasText: "Northwind data model review" }).count()).resolves.toBe(listedOnce);

    // A call with no client on its row ("Which client?") asks first: its setup. Keyboard: Esc closes the setup and puts
    // focus back on the row; nothing about the call is in the address. MC-4: Teams said it has no transcript, so it is
    // in the fold, and everyone on it is at Cooptimize: nothing is suggested.
    await page.locator("[data-calls-fold='no-transcript'] > .link-btn").click();
    const jordan = rows.filter({ hasText: "Proposal review with Jordan" }).first();
    await expect(page.locator("[data-calls-list] li[data-row]").filter({ has: page.locator(".calls-name", { hasText: "Proposal review with Jordan" }) }).first().locator("[data-call-about] option:checked").textContent()).resolves.toBe("Which client?");
    await jordan.click();
    const s2 = page.getByRole("region", { name: /^Review Proposal review with Jordan/ });
    await s2.waitFor();
    await expect(jordan.getAttribute("aria-current")).resolves.toBe("true");
    await s2.getByLabel("Which client is this call about?").focus();
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-call-row"))).toBe(await jordan.getAttribute("data-call-row"));
    await expect(page.evaluate(() => location.hash)).resolves.not.toContain("Jordan");
    await page.keyboard.press("Enter");
    await s2.waitFor();
    // A call whose organizer turned transcripts off: plain words, and the transcript choices to go on with.
    await s2.getByLabel("Which client is this call about?").selectOption({ index: 1 });
    await s2.getByRole("button", { name: "Continue" }).click();
    await expect.poll(() => page.getByText(/didn't let your sign-in read this call's transcript/).count(), { timeout: 30_000 }).toBe(1);
    await page.locator("[data-no-transcript] [data-choice='file']").waitFor();

    // MC-5: Add a call, one panel: only I see it; Later adds it with no transcript, and it opens beside the list with the choices.
    await page.getByRole("button", { name: "Add a call" }).click();
    const add = page.getByRole("form", { name: "Add a call" });
    await expect(add.getByText("Only you see it", { exact: true }).count()).resolves.toBe(1);
    await add.getByRole("button", { name: "Later", exact: true }).click();
    await add.getByLabel("Name", { exact: true }).fill("Teammates' huddle on the export");
    await add.locator("#mtg-add-client").selectOption({ index: 1 });
    await add.getByRole("button", { name: "Add", exact: true }).click();
    await expect.poll(() => page.evaluate(() => location.hash), { timeout: 30_000 }).toMatch(/^#\/calls\/\d+$/);
    await page.getByRole("heading", { level: 2, name: "Teammates' huddle on the export" }).waitFor({ timeout: 30_000 });
    await expect(page.locator("[data-call-meta]").textContent()).resolves.toMatch(/Added by you[\s\S]*Only you see it/);
    await page.locator("[data-no-transcript]").waitFor();
    await expect.poll(() => rows.filter({ hasText: "Teammates' huddle on the export" }).count(), { timeout: 30_000 }).toBe(1);
    // It waits in Needs you with Add transcript.
    await expect(page.locator("[data-section='needs'] li").filter({ hasText: "Teammates' huddle on the export" }).locator("[data-call-act='upload']").textContent()).resolves.toBe("Add transcript");

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
