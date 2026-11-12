// BH-1, BL-1: one level as a list (was Ahead › Backlog) in demo mode: each client's backlog in its own order with the
// rank number; the demo's stale stories counted per client and narrowed with Needs attention's Stale; a bulk Set a
// target date staged through the change set (items I can't change skipped with the reason); Plan it on next week's
// Plan with Undo; select all per client; the levels; light, 1366 and the phone (read only there).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, openSettings, startDemo, type Harness, settingsSection } from "./harness.ts";
import { openFilter, pickLevel } from "./backlog-helpers.ts";
import { shotBoth, SHOTS } from "./shots.ts";

let h: Harness;
const T = 120_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: unknown; error?: string }>;

describe.skipIf(!CHROMIUM)("Backlog › one level as a list (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  const open = async (viewport?: { width: number; height: number }) => {
    const { page, errors } = await freshPage(h, viewport);
    await page.evaluate(() => (location.hash = "#/backlog/stories"));
    // MB-1: on the phone Backlog opens with its notice first; Open anyway shows it (for the session, reloads too).
    if (viewport && viewport.width < 600) await page.getByRole("button", { name: "Open anyway" }).click({ timeout: 30_000 });
    await page.locator(".shape-flat .ah-client").first().waitFor({ timeout: 30_000 });
    return { page, errors };
  };
  const client = (page: Page, name: string) => page.locator(".ah-client", { has: page.getByRole("heading", { name: new RegExp(`^${name}`) }) });
  const titles = (page: Page, name: string) => client(page, name).locator(".ah-row .ah-title a").allTextContents();
  const everything = async (page: Page) => {
    await page.getByRole("group", { name: "People" }).getByRole("button", { name: "Everyone" }).click();
  };

  it("each client's stories in its backlog order with the rank; stale counted and narrowed; a bulk date and Plan it", async () => {
    const { page, errors } = await open();
    await everything(page);
    // Filter says so: one level as a list, at Stories, counted on the button.
    const pop = await openFilter(page);
    await expect(pop.getByRole("checkbox", { name: /One level as a list/ }).isChecked()).resolves.toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator(".ah-toolbar .ah-filter-n").textContent()).resolves.toBe("1");
    await expect(page.locator(".ah-tb-summary").textContent()).resolves.toContain("Stories only, in rank order");
    // Northwind's open stories in the demo's backlog order (closed ones never show), each with its rank; Harbor ranks
    // by target date and says so.
    await expect(titles(page, "Northwind Foods")).resolves.toEqual(["Export orders to CSV", "Filter orders by date range", "Export button on the order page", "Fix login timeout on mobile", "Earn points on orders", "Points balance page", "Map of stores"]);
    await expect(client(page, "Northwind Foods").locator(".bl-rank").allTextContents()).resolves.toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    await expect(client(page, "Harbor Health").locator(".ah-client-order").textContent()).resolves.toContain("by target date");
    await expect(client(page, "Northwind Foods").locator("thead th").first().textContent()).resolves.toBe("Rank · Item");
    // Stale: a count per client, and the row says so.
    await expect(client(page, "Northwind Foods").locator(".ah-client-counts").textContent()).resolves.toContain("1 stale");
    await expect(client(page, "Northwind Foods").locator(".ah-row", { hasText: "Points balance page" }).locator(".ah-col-status").getAttribute("aria-label")).resolves.toMatch(/Stale: no change in DevOps for \d+ weeks/);
    await shotBoth(page, "bh1-backlog-1920-dark");
    // BL-1: Stale is one of Needs attention's reasons: on, with Stale, only the stale stories I may change.
    await page.getByRole("button", { name: /^Needs attention/ }).click();
    await page.getByRole("group", { name: "Needs attention, by kind" }).getByRole("button", { name: /^Stale/ }).click();
    await expect.poll(() => titles(page, "Northwind Foods")).toEqual(["Points balance page"]);
    // A bulk Set a target date on what's shown: Select all, staged where I may change it, skipped with why where I can't.
    const before = await page.locator(".ah-pending").textContent().catch(() => "");
    await page.getByRole("button", { name: /^Needs attention/ }).click();
    await expect.poll(() => titles(page, "Northwind Foods").then((t) => t.length)).toBe(7);
    await client(page, "Northwind Foods").getByRole("checkbox", { name: /^Select all 7 shown in Northwind Foods/ }).check();
    await expect(page.locator(".bl-bulk strong").textContent()).resolves.toBe("7 selected");
    await page.getByRole("button", { name: "Set a target date…" }).click();
    // AH-5: the app's own date picker: typed in its box, then Save.
    await page.locator(".bl-bulk-date .date-field").click();
    await page.locator(".cell-pop").getByRole("textbox").fill("2026-12-18");
    await page.locator(".cell-pop").getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: "Apply" }).click();
    await page.locator(".bl-result").waitFor();
    await expect(page.locator(".bl-result").textContent()).resolves.toMatch(/target dates? set to Dec 18, ready to save/);
    await expect.poll(() => page.locator(".ah-pending").textContent()).not.toBe(before);
    if (await page.locator(".bl-result details").count()) {
      await page.locator(".bl-result summary").click();
      await expect(page.locator(".bl-result li").first().textContent()).resolves.toMatch(/#\d+ .+: .+/);
    }
    await shotBoth(page, "bh1-backlog-bulk-1920-dark", page.locator(".bl-result"));
    // The review shows the staged dates like any change; nothing is written until Save to DevOps.
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.locator(".ah-review").textContent()).resolves.toContain("Map of stores");
    await page.keyboard.press("Escape");
    // Plan it: a story onto next week's Plan, then Undo.
    await page.getByRole("button", { name: "Dismiss", exact: true }).first().click();
    if (await page.locator(".bl-bulk").count()) await page.getByRole("button", { name: "Clear", exact: true }).click();
    await client(page, "Northwind Foods").getByRole("checkbox", { name: /Points balance page/ }).check({ force: true });
    await page.getByRole("button", { name: "Plan it" }).click();
    await page.locator(".undo-toast").waitFor();
    await expect(page.locator(".undo-toast").textContent()).resolves.toContain("1 story on next week's Plan");
    const plan = (await call(page, "weekplan.load", { weekStart: "2026-11-09" })).data as { plan: { features: { itemId: number }[] } };
    expect(plan.plan.features.map((f) => f.itemId)).toContain(1142);
    await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => page.locator(".undo-toast").textContent()).toContain("Undone");
    const after = (await call(page, "weekplan.load", { weekStart: "2026-11-09" })).data as { plan: { features: { itemId: number }[] } };
    expect(after.plan.features.map((f) => f.itemId)).not.toContain(1142);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the client multi-select and the levels; light, 1366 and the phone (read only, no sideways scroll)", async () => {
    const { page, errors } = await open();
    await everything(page);
    const chips = page.locator(".ah-toolbar").getByRole("group", { name: "Clients" });
    await chips.getByRole("button", { name: "Atlas Freight" }).click();
    await chips.getByRole("button", { name: "Northwind Foods" }).click();
    await expect(page.locator(".ah-client-head .ah-client-name").allTextContents()).resolves.toEqual(["Northwind Foods", "Atlas Freight"]);
    await pickLevel(page, "Features");
    await expect(titles(page, "Northwind Foods")).resolves.toEqual(["Order history export", "Supplier onboarding", "Sales reporting: Gold fact and dimensions, semantic model and report", "Loyalty points", "Store locator"]);
    await pickLevel(page, "Stories");
    await chips.getByRole("button", { name: "Atlas Freight" }).click();
    await chips.getByRole("button", { name: "Northwind Foods" }).click();
    if (SHOTS) {
      expect((await call(page, "ui.set_theme", { theme: "cooptimize-light" })).ok).toBe(true);
      await page.reload();
      await page.locator(".ah-client").first().waitFor({ timeout: 30_000 });
      await shotBoth(page, "bh1-backlog-1920-light");
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${SHOTS}/bh1-backlog-1366-light.png` });
      // Settings › Backlog: the stale weeks beside the Roadmap thresholds.
      await page.setViewportSize({ width: 1920, height: 1080 });
      await openSettings(page);
      await settingsSection(page, "ahead");
      await page.getByLabel("Stale after (weeks)").waitFor();
      await shotBoth(page, "bh1-settings-ahead-light");
      await page.keyboard.press("Escape");
    }
    await page.close();
    // The phone: read only (no ticks, no bulk bar), nothing wider than the screen.
    for (const theme of ["cooptimize-dark", "cooptimize-light"]) {
      const p = await open({ width: 390, height: 844 });
      expect((await call(p.page, "ui.set_theme", { theme })).ok).toBe(true);
      await p.page.reload();
      await p.page.locator(".ah-client").first().waitFor({ timeout: 30_000 });
      await expect(p.page.locator(".ah-row input[type=checkbox], .ah-client-all").count()).resolves.toBe(0);
      await expect(p.page.locator(".bl-bulk").count()).resolves.toBe(0);
      await expect(p.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
      if (SHOTS) await p.page.screenshot({ path: `${SHOTS}/bh1-backlog-phone-${theme.endsWith("dark") ? "dark" : "light"}.png` });
      errors.push(...p.errors);
      await p.page.close();
    }
    expect(errors).toEqual([]);
  }, T);
});
