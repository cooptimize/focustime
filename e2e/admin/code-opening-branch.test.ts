// RB-7: Admin › Clients › Northwind › Code, on the demo's invented repos: "Code opens on" beside who can read its code,
// offered from the branch names its repos really have; each repo's branch shown (store-portal has no dev, so it opens
// on its own default); Code then opens sales-analytics on dev with no line, and main is a choice with the line; cleared
// back to each repo's default. Edge cases are unit tests (actions/code-branch.test.ts, actions/admin-actions.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

let h: Harness;
const T = 180_000;
const SALES = "a1b2c3d4-0001-4000-8000-00000000a001";

describe.skipIf(!CHROMIUM)("Admin: a client's opening branch for Code (RB-7)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("set from real names, shown per repo, followed by Code, then cleared", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await page.evaluate(() => (location.hash = "#/admin/clients/Northwind/code"));
    const field = page.getByLabel("Northwind: Code opens on");
    await field.waitFor({ timeout: 60_000 });
    const repos = page.locator("ul[data-code-branch-repos]");
    await repos.waitFor();
    const opens = () => repos.locator("[data-code-branch-repo]").evaluateAll((els) => els.map((e) => e.textContent));
    expect(await opens()).toEqual(["archive: empty", "sales-analytics: main", "store-portal: main"]);
    // Offered from the names its repos have, never typed.
    const offered = await field.locator("option").evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    expect(offered).toEqual(["", "dev", "feature/returns-model", "feature/store-region-dimension-cleanup-before-the-quarterly-refresh", "main", "release/2026-11"]);
    expect(await field.evaluate((e) => e.tagName)).toBe("SELECT");

    await field.selectOption("dev");
    await expect.poll(opens, { timeout: 15_000 }).toEqual(["archive: empty", "sales-analytics: dev", "store-portal: main (it has no dev)"]);

    // Code opens sales-analytics on dev, as usual: no line; main is now the choice, with the line.
    await page.evaluate((r) => (location.hash = `#/code/Northwind/${r}/${encodeURIComponent("/README.md")}`), SALES);
    await page.locator('[data-code-branch-btn="dev"]').waitFor({ timeout: 30_000 });
    expect(await page.locator("[data-code-off-usual]").count()).toBe(0);
    await page.waitForFunction(() => document.querySelector(".cv-code")?.textContent?.includes("On dev"));
    await page.locator("[data-code-branch-btn]").click();
    expect(await page.locator("[data-code-branch-opt]").first().getAttribute("data-code-branch-opt")).toBe("dev");
    await page.locator('[data-code-branch-opt="main"]').click();
    await page.locator('[data-code-off-usual="main"]').waitFor();
    expect(await page.locator("[data-code-off-usual]").innerText()).toContain("On main, not the usual dev");

    // Cleared back to each repo's default.
    await page.evaluate(() => (location.hash = "#/admin/clients/Northwind/code"));
    await page.getByLabel("Northwind: Code opens on").selectOption("");
    await expect.poll(opens, { timeout: 15_000 }).toEqual(["archive: empty", "sales-analytics: main", "store-portal: main"]);
    expect(errors).toEqual([]);
    await page.close();
  });
});
