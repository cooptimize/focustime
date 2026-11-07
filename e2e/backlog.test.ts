// BH-1: Ahead › Backlog in demo mode: each client's backlog in its own order, side by side; the demo's stale stories
// with a count per client and the Stale filter; a bulk Set a target date staged through Ahead's change set (items I
// can't change skipped with the reason); Plan it on next week's Plan with Undo; the layout at 1920, 1366 and on a phone
// (read only there), light and dark.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, openSettings, startDemo, type Harness, settingsSection } from "./harness.ts";
import { shotBoth, SHOTS } from "./shots.ts";

let h: Harness;
const T = 120_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: unknown; error?: string }>;

describe.skipIf(!CHROMIUM)("Ahead › Backlog (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  const open = async (viewport?: { width: number; height: number }) => {
    const { page, errors } = await freshPage(h, viewport);
    await page.evaluate(() => (location.hash = "#/ahead/backlog"));
    await page.locator(".bl-client").first().waitFor({ timeout: 30_000 });
    return { page, errors };
  };
  const client = (page: Page, name: string) => page.locator(".bl-client", { has: page.getByRole("heading", { name, exact: true }) });
  const titles = (page: Page, name: string) => client(page, name).locator(".bl-title a").allTextContents();
  const everything = async (page: Page) => {
    await page.getByRole("group", { name: "Owner" }).getByRole("button", { name: "Everything in scope" }).click();
  };

  it("each client's stories in its backlog order, side by side; stale counted and filtered; a bulk date and Plan it", async () => {
    const { page, errors } = await open();
    await everything(page);
    // Northwind's open stories in the demo's backlog order (closed ones never show); Harbor ranks by target date.
    await expect(titles(page, "Northwind Foods")).resolves.toEqual(["Export orders to CSV", "Filter orders by date range", "Export button on the order page", "Fix login timeout on mobile", "Earn points on orders", "Points balance page", "Map of stores"]);
    await expect(client(page, "Harbor Health").locator(".bl-note").textContent()).resolves.toContain("by target date");
    // Clients side by side at 1920.
    const tops = await page.locator(".bl-client").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops.slice(0, 3)).size).toBe(1);
    // Stale: the demo's untouched stories, a count per client, then the filter.
    await expect(client(page, "Northwind Foods").locator(".bl-counts").textContent()).resolves.toContain("1 stale");
    await expect(client(page, "Northwind Foods").locator(".bl-row.stale .bl-stale").textContent()).resolves.toMatch(/^Stale · \d+ weeks ago$/);
    await shotBoth(page, "bh1-backlog-1920-dark");
    await page.getByRole("button", { name: "Stale", exact: true }).click();
    await expect(titles(page, "Northwind Foods")).resolves.toEqual(["Points balance page"]);
    await expect(page.locator(".bl-row:not(.stale)").count()).resolves.toBe(0);
    // A bulk Set a target date on every stale story: staged where I may change it, skipped with why where I can't.
    const before = await page.locator(".ah-pending strong").textContent().catch(() => "");
    for (const box of await page.locator(".bl-head input[type=checkbox]").all()) await box.check();
    await expect(page.locator(".bl-bulk strong").textContent()).resolves.toMatch(/selected$/);
    await page.getByRole("button", { name: "Set a target date…" }).click();
    await page.locator(".bl-bulk-date input[type=date]").fill("2026-12-18");
    await page.getByRole("button", { name: "Apply" }).click();
    await page.locator(".bl-result").waitFor();
    await expect(page.locator(".bl-result").textContent()).resolves.toMatch(/target dates? set to Dec 18, ready to save/);
    await expect.poll(() => page.locator(".ah-pending strong").textContent()).not.toBe(before);
    if (await page.locator(".bl-result details").count()) {
      await page.locator(".bl-result summary").click();
      await expect(page.locator(".bl-result li").first().textContent()).resolves.toMatch(/#\d+ .+: .+/);
    }
    await shotBoth(page, "bh1-backlog-bulk-1920-dark", page.locator(".bl-result"));
    // The review shows the staged dates like any change; nothing is written until Save to DevOps.
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.locator(".ah-review").textContent()).resolves.toContain("Points balance page");
    await page.keyboard.press("Escape");
    // Plan it: a stale story onto next week's Plan, then Undo.
    await page.getByRole("button", { name: "Dismiss", exact: true }).first().click();
    // HK-5: after a bulk action only the skipped items stay selected (set in the same render as the result above), and
    // the bulk bar with Clear shows only while something is. Its click used to wait 30 s for a bar that wasn't there.
    if (await page.locator(".bl-bulk").count()) await page.getByRole("button", { name: "Clear", exact: true }).click();
    await client(page, "Northwind Foods").getByRole("checkbox", { name: /Points balance page/ }).check();
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

  it("the client multi-select and the tiers; light, 1366 and the phone (read only, no sideways scroll)", async () => {
    const { page, errors } = await open();
    await everything(page);
    await page.getByRole("group", { name: "Clients" }).getByRole("button", { name: "Atlas Freight" }).click();
    await page.getByRole("group", { name: "Clients" }).getByRole("button", { name: "Northwind Foods" }).click();
    await expect(page.locator(".bl-head h3").allTextContents()).resolves.toEqual(["Northwind Foods", "Atlas Freight"]);
    await page.getByRole("group", { name: "Level" }).getByRole("button", { name: "Features" }).click();
    await expect(titles(page, "Northwind Foods")).resolves.toEqual(["Order history export", "Supplier onboarding", "Loyalty points", "Store locator"]);
    await page.getByRole("group", { name: "Level" }).getByRole("button", { name: "Stories" }).click();
    await page.getByRole("group", { name: "Clients" }).getByRole("button", { name: "Atlas Freight" }).click();
    await page.getByRole("group", { name: "Clients" }).getByRole("button", { name: "Northwind Foods" }).click();
    if (SHOTS) {
      expect((await call(page, "ui.set_theme", { theme: "cooptimize-light" })).ok).toBe(true);
      await page.reload();
      await page.locator(".bl-client").first().waitFor({ timeout: 30_000 });
      await shotBoth(page, "bh1-backlog-1920-light");
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${SHOTS}/bh1-backlog-1366-light.png` });
    }
    if (SHOTS) {
      // Settings › Ahead: the stale weeks beside the Roadmap thresholds.
      await page.setViewportSize({ width: 1920, height: 1080 });
      await openSettings(page);
      await settingsSection(page, "ahead");
      await page.getByLabel("Stale after (weeks)").waitFor();
      await shotBoth(page, "bh1-settings-ahead-light");
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.evaluate(() => (location.hash = "#/ahead/backlog"));
      await page.locator(".bl-client").first().waitFor({ timeout: 30_000 });
    }
    const two = await page.evaluate(() => getComputedStyle(document.querySelector(".bl-clients")!).gridTemplateColumns.split(" ").length);
    if (SHOTS) expect(two).toBe(2);
    await page.close();
    // The phone: one column, read only (no checkboxes, no bulk bar), nothing wider than the screen.
    for (const theme of ["cooptimize-dark", "cooptimize-light"]) {
      const p = await open({ width: 390, height: 844 });
      expect((await call(p.page, "ui.set_theme", { theme })).ok).toBe(true);
      await p.page.reload();
      await p.page.locator(".bl-client").first().waitFor({ timeout: 30_000 });
      await expect(p.page.locator(".bl-row input[type=checkbox]").count()).resolves.toBe(0);
      await expect(p.page.evaluate(() => getComputedStyle(document.querySelector(".bl-clients")!).gridTemplateColumns.split(" ").length)).resolves.toBe(1);
      await expect(p.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
      if (SHOTS) await p.page.screenshot({ path: `${SHOTS}/bh1-backlog-phone-${theme.endsWith("dark") ? "dark" : "light"}.png` });
      errors.push(...p.errors);
      await p.page.close();
    }
    expect(errors).toEqual([]);
  }, T);
});
