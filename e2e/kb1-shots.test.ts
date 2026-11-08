// KB-1: Cooptimize's standards in the demo (fictional articles, no network): Break down a data feature, Standards used and
// the linked acceptance criteria, Ask's standards answer and "Not in the standards", Admin › Standards with Sync now, and
// the client's Source systems. With FOCUSTIME_SHOTS naming a folder, the screenshots at 1920 and Text size Larger.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { shotBoth } from "./shots.ts";

const T = 240_000;

describe.skipIf(!CHROMIUM)("KB-1 standards", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("drafts with the standards, answers from them and shows them to admins", async () => {
    const { page, errors } = await freshPage(h, { width: 1920, height: 1080 });

    // Break down: split along the layers, Standards used, a citation with its link.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("focustime:breakdown", { detail: { clientKey: "Northwind", itemId: 1160 } })));
    const panel = page.getByRole("dialog", { name: /^Break down Feature: / });
    await panel.getByRole("button", { name: "Run" }).click();
    const note = panel.locator(".standards-used");
    await note.waitFor({ timeout: 30_000 });
    await expect(note.textContent()).resolves.toMatch(/Standards used: .*Gold Fact Tables.*commit a1b2c3d/);
    const body = (await panel.textContent()) ?? "";
    expect(body).toContain("Gold");
    expect(body).not.toMatch(/write silver sql/i);
    await shotBoth(page, "kb1-breakdown-standards-used", note);
    // Acceptance criteria are editable lines: the citation and its link at the synced commit.
    const lines = panel.getByRole("textbox", { name: /^Acceptance criterion/ });
    const values = await lines.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    const cited = values.findIndex((v) => v.startsWith("Follows Gold Fact Tables"));
    expect(cited).toBeGreaterThanOrEqual(0);
    expect(values[cited]).toContain("https://github.com/contoso/standards/blob/a1b2c3d4e5f60718293a4b5c6d7e8f9012345678/SQL/Gold/Fact%20Tables.md");
    await shotBoth(page, "kb1-acceptance-links", lines.nth(cited));
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached" });

    // Ask: the rule with its link, and "Not in the standards".
    await page.keyboard.press("Control+j");
    const ask = page.getByTestId("assistant-panel");
    const box = ask.getByRole("textbox", { name: "Ask the assistant" });
    await box.fill("What's our standard for fact table naming?");
    await box.press("Enter");
    await ask.getByText("From Gold Fact Tables (commit a1b2c3d)").waitFor({ timeout: 30_000 });
    await ask.getByRole("button", { name: /PascalCase table and column names/ }).waitFor();
    await shotBoth(page, "kb1-ask-standard");
    await box.fill("What's our standard for naming cats?");
    await box.press("Enter");
    await ask.getByText("Not in the standards").waitFor({ timeout: 30_000 });
    await page.keyboard.press("Escape");

    // Admin › Standards: the sync's status, a duplicate warning, the articles, Sync now.
    await page.getByRole("button", { name: /^More: the Guide/ }).click();
    await page.getByRole("menuitem", { name: "Admin" }).click();
    await page.locator('.ps-rail [data-settings-section="admin-standards"]').click();
    await page.locator(".ps-head h2", { hasText: "Admin › Standards" }).waitFor();
    await page.getByText("Gold Fact Tables").first().waitFor();
    await page.getByText("powerbi_semantic_model_fact_tables").first().waitFor();
    await page.getByRole("button", { name: "Sync now" }).click();
    await page.getByRole("status").filter({ hasText: "Checked: nothing new." }).waitFor({ timeout: 15_000 });
    await shotBoth(page, "kb1-admin-standards");

    // Admin › Clients: Source systems beside Data platform.
    await page.locator('.ps-rail [data-settings-section="admin-clients"]').click();
    await page.locator(".ps-head h2", { hasText: "Admin › Clients" }).waitFor();
    const field = page.getByLabel(/: source systems$/).first();
    await field.waitFor({ timeout: 15_000 });
    await expect(field.locator("option").allTextContents()).resolves.toEqual(expect.arrayContaining(["Both D365 systems (default)", "D365 Finance and Operations", "D365 Dataverse (CE / Project Operations)", "None"]));
    await shotBoth(page, "kb1-client-source-systems", field);

    expect(errors).toEqual([]);
  }, T);
});
