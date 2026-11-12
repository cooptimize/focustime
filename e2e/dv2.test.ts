// DV-2: DevOps changes show up on their own (demo mode, Monday Nov 2 2026 9:30 AM ET). A fictional teammate changes or
// adds items in the session's own demo DevOps (demo.devops_change, only in the demo); the page's one versions poll (every
// 30 s, the page clock run forward here) sees the client's version move and each open screen rereads quietly. Then
// Refresh's answer on Ahead and Status, the status bar's freshness, and Settings › DevOps › Find an item. WD-2: Week's
// check reads the block panel's Add list (was the Details panel's Your stories).
// With FOCUSTIME_SHOTS the screenshots go there.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, NOW, openSettings, settingsSection, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";

const T = 240_000;

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: unknown; error?: string }>;

const teammate = async (page: Page, clientKey: string, change: unknown) => {
  const r = await call(page, "demo.devops_change", { clientKey, change });
  expect(r.ok, r.error).toBe(true);
  return (r.data as { id: number }).id;
};
/** The page's versions poll: run the page clock past it, then let the quiet reread land. */
const poll = async (page: Page) => {
  await page.clock.runFor(31_000);
  await page.waitForTimeout(800);
};
/** <name>-light.png and <name>-dark.png at 1440×900 when FOCUSTIME_SHOTS names a folder; back to light after. */
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme === "dark" ? "cooptimize-dark" : "cooptimize-light");
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png` });
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => (document.documentElement.dataset.theme = "cooptimize-light"));
};
const row = (page: Page, title: string) => page.locator(".ah-row", { has: page.getByRole("link", { name: title, exact: true }) });

describe.skipIf(!CHROMIUM)("DV-2: DevOps changes show up on their own", () => {
  let h: Harness;
  let page: Page;
  let errors: string[];
  beforeAll(async () => {
    h = await startDemo("chromium", {}, NOW);
    ({ page, errors } = await freshPage(h, { width: 1440, height: 900 }));
    await page.clock.install({ time: Temporal.Instant.from(NOW).epochMilliseconds });
    await page.reload();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("Ahead: a teammate's change shows in place within a poll, the scroll and the selection held; a new feature under an epic appears", async () => {
    await page.evaluate(() => (location.hash = "#/backlog"));
    await page.locator(".ah-pending").waitFor({ timeout: 30_000 });
    await row(page, "Map of stores").scrollIntoViewIfNeeded();
    await row(page, "Map of stores").locator(".ah-col-dates").click();
    await page.keyboard.press("Escape");
    const scrollBefore = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);

    await teammate(page, "Northwind", { id: 1151, title: "Map of stores near me", state: "Active" });
    const id = await teammate(page, "Northwind", { create: { type: "Feature", title: "Gift cards", parent: 1100, assignee: null } });
    await poll(page);

    await row(page, "Map of stores near me").waitFor({ timeout: 10_000 });
    await expect(row(page, "Map of stores").count()).resolves.toBe(0);
    await expect(row(page, "Map of stores near me").textContent()).resolves.toContain("Active");
    await expect(page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).resolves.toBe(scrollBefore);
    // The staged changes are still staged.
    await expect(page.locator(".ah-pending").textContent()).resolves.toContain("3 changes to save");
    // A new feature nobody owns yet, under the epic: in Ahead with the owner filter on All.
    expect(id).toBeGreaterThan(0);
    await page.locator(".ah-toolbar").getByRole("button", { name: "Northwind Foods", exact: true }).click();
    await page.getByRole("group", { name: "People" }).getByRole("button", { name: "Everyone" }).click();
    await row(page, "Gift cards").waitFor({ timeout: 10_000 });
    expect(errors).toEqual([]);
  }, T);

  it("Ahead: an item with my staged change that changes in DevOps says so, and shows DevOps's values beside mine", async () => {
    await teammate(page, "Northwind", { id: 1150, target: "2027-01-08" });
    await poll(page);
    const changed = row(page, "Store locator").locator(".ah-changed");
    await changed.waitFor({ timeout: 10_000 });
    await expect(changed.textContent()).resolves.toContain("Changed in DevOps just now");
    await changed.getByRole("button", { name: "Show the new values" }).click();
    await expect(changed.locator(".ah-changed-vals").textContent()).resolves.toMatch(/Start: DevOps has no value, yours .*Nov 16/);
    // Mine stays staged.
    await expect(row(page, "Store locator").locator(".ah-col-dates").getAttribute("class")).resolves.toContain("ah-pend");
    await shot(page, "dv2-ahead-changed");
  }, T);

  it("Week: a story's new title shows in the block panel's Add list after a poll, with the panel left open (WD-2)", async () => {
    await page.evaluate(() => (location.hash = "#/week"));
    await page.locator("main.grid").waitFor({ timeout: 30_000 });
    await page.locator(".half.card", { hasText: "Northwind" }).first().locator(".card-when").click();
    const stories = page.locator("aside.block-panel .aw-features");
    await stories.waitFor();
    await stories.getByText("Filter orders by date range").waitFor();
    await teammate(page, "Northwind", { id: 1112, title: "Filter orders by a date range", state: "Active" });
    await poll(page);
    await stories.getByText("Filter orders by a date range").waitFor({ timeout: 10_000 });
    await expect(page.locator(".block-panel").count()).resolves.toBe(1);
    await page.keyboard.press("Escape");
    await page.evaluate(() => (location.hash = "#/backlog"));
    await page.locator(".ah-pending").waitFor({ timeout: 30_000 });
  }, T);

  it("Refresh on Ahead says what it found; the status bar says when DevOps was checked", async () => {
    await teammate(page, "Northwind", { id: 1141, title: "Earn points on every order" });
    await page.locator(".ahead .follow-ups-head").getByRole("button", { name: "Refresh" }).click();
    const said = page.locator(".ah-refreshed");
    await said.waitFor({ timeout: 15_000 });
    await expect(said.textContent()).resolves.toMatch(/DevOps checked just now · (\d+ changes|1 change)/);
    await row(page, "Earn points on every order").waitFor({ timeout: 10_000 });
    const fresh = page.locator(".devops-fresh").first();
    await expect(fresh.textContent()).resolves.toMatch(/^DevOps checked /);
    await expect(fresh.getAttribute("title")).resolves.toMatch(/Northwind: checked/);
    await shot(page, "dv2-refresh-ahead");
    // R does the same from any tab, its answer in the status bar.
    await teammate(page, "Harbor", { id: 2212, title: "Validate the date of birth" });
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("r");
    await expect.poll(() => page.locator(".status-chip.notice").textContent(), { timeout: 15_000 }).toMatch(/DevOps checked just now · 1 change/);
  }, T);

  it("Refresh on Status says what it found", async () => {
    await page.evaluate(() => (location.hash = "#/week/status"));
    await page.locator(".st-count").waitFor({ timeout: 30_000 });
    await page.getByRole("combobox", { name: "Client report" }).selectOption({ label: "Northwind report" });
    const btn = page.locator(".st-push").getByRole("button", { name: "Refresh" });
    await btn.waitFor({ timeout: 30_000 });
    await btn.click();
    const said = page.locator(".st-refreshed");
    await said.waitFor({ timeout: 15_000 });
    await expect(said.textContent()).resolves.toMatch(/DevOps checked just now/);
  }, T);

  it("Find an item: out of the area, a fine one, and one DevOps doesn't have", async () => {
    await openSettings(page);
    await settingsSection(page, "devops");
    const group = page.locator('[data-setting="find-item"]');
    await group.scrollIntoViewIfNeeded();
    await group.getByRole("combobox").selectOption({ label: "Northwind" });
    const find = async (n: string) => {
      await group.getByLabel("Item number").fill(n);
      await group.getByRole("button", { name: "Find" }).click();
      await group.locator(".find-item-answer").waitFor();
      await group.locator(".find-item-answer").scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      return (await group.locator(".find-item-answer li").allTextContents()).join("\n");
    };
    const out = await find("1710");
    expect(out).toMatch(/DevOps has #1710/);
    expect(out).toMatch(/outside what FocusTime shows for Northwind/);
    await shot(page, "dv2-find-out-of-area");
    const fine = await find("1111");
    expect(fine).toMatch(/DevOps has #1111/);
    expect(fine).toMatch(/FocusTime has it/);
    expect(fine).toMatch(/Backlog shows it/);
    await shot(page, "dv2-find-fine");
    const none = await find("999999");
    expect(none).toMatch(/found no #999999\. If you just made it, Refresh checks now/);
    await shot(page, "dv2-find-missing");
    expect(errors).toEqual([]);
  }, T);
});
