// Step 17: Roadmap (the status board) and Plan ahead, in demo mode (fictional features covering every state).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 90_000;
/** Decimals and fractions (as in e2e/estimating.test.ts): none may show. Times (9:30) and dates are fine. */
const FRACTION = /(?<![\d:])\d+[.,]\d+(?![\d:])|half a block|½|¼|¾/i;

describe.skipIf(!CHROMIUM)("Roadmap and Plan ahead (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  const roadmap = async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/roadmap"));
    await page.locator(".rm-row").first().waitFor({ timeout: 30_000 });
    return { page, errors };
  };
  const rowOf = (page: Awaited<ReturnType<typeof roadmap>>["page"], title: string) => page.locator(".rm-row", { has: page.getByRole("link", { name: title, exact: true }) });

  it("every state shows as a word with its plain reason; the summary counts them", async () => {
    const { page, errors } = await roadmap();
    const badge = async (title: string) => (await rowOf(page, title).locator(".rm-top .rm-badge").textContent())?.trim();
    expect(await badge("Patient intake form")).toBe("Blocked");
    expect(await badge("Order history export")).toBe("At risk");
    expect(await badge("Supplier onboarding")).toBe("Not scoped");
    expect(await badge("Shipment tracking dashboard")).toBe("Stalled");
    expect(await badge("Internal reporting refresh")).toBe("Watch");
    expect(await badge("Customer portal redesign")).toBe("Needs a date");
    expect(await badge("Knowledge base search")).toBe("On track");
    expect(await badge("Patient portal login")).toBe("Done");
    await expect(rowOf(page, "Order history export").locator(".rm-reason").textContent()).resolves.toBe("3 stories open, about 1 closes every 3 weeks, 11 days left, needs about 9 weeks");
    const sums = await page.locator(".rm-sum").allTextContents();
    expect(sums.length).toBe(8);
    expect(sums.every((t) => /^\d+/.test(t))).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("filters combine (state, whose, client, search) and last for the session; Clear filters resets them", async () => {
    const { page } = await roadmap();
    await page.locator(".rm-sum.st-watch").click();
    await expect.poll(() => page.locator(".rm-row").count()).toBe(3);
    await page.locator(".rm-sum.st-at_risk").click();
    await expect.poll(() => page.locator(".rm-row").count()).toBe(4);
    await page.getByRole("button", { name: "Northwind Foods" }).click();
    await expect.poll(() => page.locator(".rm-row").count()).toBe(3);
    await page.getByRole("searchbox", { name: "Search the Roadmap" }).fill("loyalty");
    await expect.poll(() => page.locator(".rm-row").count()).toBe(1);
    // Back to Today and here again: the filters are still on.
    await page.evaluate(() => (location.hash = "#/today"));
    await page.locator(".today-view").waitFor();
    await page.evaluate(() => (location.hash = "#/roadmap"));
    await page.locator(".rm-row").first().waitFor();
    await expect(page.locator(".rm-row").count()).resolves.toBe(1);
    await expect(page.locator(".rm-sum.st-watch").getAttribute("aria-pressed")).resolves.toBe("true");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect.poll(() => page.locator(".rm-row").count()).toBeGreaterThan(10);
    // Contributing: only the parents of my stories.
    await page.getByRole("button", { name: "Contributing", exact: true }).click();
    await expect.poll(async () => (await page.locator(".rm-row .rm-rel").count()) === (await page.locator(".rm-row").count())).toBe(true);
    await page.getByRole("button", { name: "Both", exact: true }).click();
    await page.close();
  }, T);

  it("sorts by risk by default (state order), by target date on request", async () => {
    const { page } = await roadmap();
    const states = async () => (await page.locator(".dl-client").first().locator(".rm-top .rm-badge").allTextContents()).map((t) => t.trim());
    expect(await states()).toEqual(["Watch", "On track"]);
    await page.getByRole("combobox").selectOption("target");
    await expect.poll(async () => (await page.locator('.dl-client[aria-label="Northwind Foods"] .dl-title a').allTextContents())[0]).toBe("Order history export");
    await page.getByRole("combobox").selectOption("risk");
    await page.close();
  }, T);

  it("a row expands to its stories grouped by state with assignees; the legend explains the states", async () => {
    const { page } = await roadmap();
    const row = rowOf(page, "Patient intake form");
    await row.getByRole("button", { name: /Show stories of Patient intake form/ }).click();
    await expect.poll(() => row.locator(".rm-group h4").allTextContents()).toEqual(["Blocked 1", "In progress 1", "Not started 1", "Done 3"]);
    await expect(row.locator(".rm-group.g-blocked li").textContent()).resolves.toContain("Validate date of birth");
    await page.getByRole("button", { name: "What do these mean?" }).click();
    await expect(page.locator(".rm-legend dt").count()).resolves.toBe(9);
    await page.close();
  }, T);

  it("no fractional amounts in either Roadmap mode", async () => {
    const { page } = await freshPage(h);
    for (const [hash, ready] of [["#/roadmap", ".rm-row"], ["#/roadmap/ahead", ".roadmap"]] as const) {
      await page.evaluate((x) => (location.hash = x), hash);
      await page.locator(ready).first().waitFor({ timeout: 20_000 });
      await page.waitForTimeout(800);
      for (const b of await page.locator(".rm-expand:not([disabled])").all()) await b.click();
      const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
      const titles = await page.locator("[title], [aria-label]").evaluateAll((els) => els.map((e) => `${e.getAttribute("title") ?? ""} ${e.getAttribute("aria-label") ?? ""}`));
      for (const t of [text, ...titles]) expect(t.match(FRACTION)?.[0] ?? null, `${hash}: ${t.slice(Math.max(0, t.search(FRACTION) - 40), t.search(FRACTION) + 40)}`).toBeNull();
    }
    await page.close();
  }, T);
});
