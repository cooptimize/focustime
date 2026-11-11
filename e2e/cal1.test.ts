// CAL-1: Add a calendar by link, in demo mode (Monday Nov 2 2026 9:30 AM ET). The demo answers three fictional links
// on calendar.example.com in memory (sources/demo/links.ts); nothing is fetched. The main path: the help, Check link
// ("Found N upcoming events"), Save, Busy events on Week, the source status, and a link that stops working with
// Replace link. The link itself never reaches the page or an API response. With FOCUSTIME_SHOTS the screenshots go there.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, timelineOn, NOW, openSettings, settingsSection, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

const T = 240_000;
const FAMILY = "webcal://calendar.example.com/u/demo-family/basic.ics";
const STOPS = "https://calendar.example.com/u/demo-stops/basic.ics";
/** What must never come back: the links' paths (where a real link's secret is). */
const PATHS = /\/u\/demo-(family|stops|school)/;

const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: unknown; error?: string }>;

const board = async (page: Page) => {
  await page.evaluate(() => (location.hash = "#/week"));
  await page.reload();
  await page.locator("main.grid").waitFor();
  await page.waitForTimeout(300);
};

describe.skipIf(!CHROMIUM)("CAL-1: Add a calendar by link", () => {
  let h: Harness;
  let page: Page;
  const bodies: string[] = [];
  beforeAll(async () => {
    h = await startDemo("chromium", {}, NOW);
    ({ page } = await freshPage(h));
    // The page's clock 6 minutes after the demo's, so "updated 6 min ago" reads as it will live.
    await page.clock.install({ time: Temporal.Instant.from(NOW).add({ minutes: 6 }).epochMilliseconds });
    page.on("response", async (r) => {
      if (!r.url().includes("/api/")) return;
      bodies.push(await r.text().catch(() => ""));
    });
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("adds a calendar by link: help, Check link, Found N, Save, Busy events on Week, the source line", async () => {
    await board(page);
    await openSettings(page);
    await settingsSection(page, "connections");
    const group = page.locator('[data-setting="calendar-links"]');
    await group.scrollIntoViewIfNeeded();
    await group.getByRole("button", { name: "Add a calendar by link" }).click();
    await group.locator(".cal-link-help summary").click();
    await shotBoth(page, "cal1-add-with-help", group);

    // Save waits for a link that checked out.
    const save = group.getByRole("button", { name: "Save calendar" });
    expect(await save.isDisabled()).toBe(true);
    await group.getByLabel(/^Calendar link/).fill(FAMILY);
    await group.getByRole("button", { name: "Check link" }).click();
    const found = group.locator(".cal-link-found");
    await found.waitFor();
    expect(await found.textContent()).toMatch(/^Found \d+ upcoming events on calendar\.example\.com\/…$/);
    await group.getByLabel("Name").fill("Family");
    await shotBoth(page, "cal1-found", group);
    await save.click();
    const row = group.locator(".cal-link", { hasText: "Family" });
    await row.waitFor();
    expect(await row.textContent()).toMatch(/calendar\.example\.com\/….*Busy only.*Personal/);
    // The link is gone from the page once saved (only its host shows).
    expect(await page.content()).not.toMatch(PATHS);

    // Week: the family calendar's events as Busy, with its color, read only (on the timeline, off by default).
    await timelineOn(page);
    await board(page);
    const busy = page.locator(".r-ev.linked");
    await expect.poll(() => busy.count()).toBeGreaterThan(0);
    expect(new Set(await busy.allTextContents())).toEqual(new Set(["Busy"]));
    expect(await busy.first().getAttribute("title")).toContain("Family (calendar link)");
    await shotBoth(page, "cal1-week-busy", page.locator("main.grid"));

    // The source status: the link by its name, live, its events and when it was read.
    const quiet = page.locator(".status-quiet");
    if (await quiet.count()) await quiet.click();
    const line = page.locator(".statusbar .source", { hasText: "Family" });
    await line.waitFor();
    expect(await line.textContent()).toMatch(/Family\s*live\s*\d+ events?\s*updated \d+ min ago/);
    await shotBoth(page, "cal1-source-status", page.locator(".statusbar"));
  }, T);

  it("a link that stops working: the error line and Replace link, and the link never in a response or the page", async () => {
    // As the dialog does: Check link, then Save (the demo's third read of this link is a 404).
    expect((await call(page, "calendar_link.preview", { url: STOPS })).ok).toBe(true);
    expect((await call(page, "calendar_link.add", { url: STOPS, name: "Club", color: "#d97706", mode: "busy", kind: "personal" })).ok).toBe(true);
    await board(page);
    // Refresh asks the link now: it answers 404 this time.
    await page.locator(".statusbar").getByRole("button", { name: /Refresh/ }).first().click();
    const problem = page.locator(".statusbar .status-line", { hasText: "Club" });
    await problem.waitFor();
    expect(await problem.textContent()).toContain("Club: The link stopped working.");
    await problem.getByRole("button", { name: "Replace link" }).waitFor();
    await shotBoth(page, "cal1-error-status", page.locator(".statusbar"));

    // Replace link opens the calendar's row in Settings, with the problem.
    await problem.getByRole("button", { name: "Replace link" }).click();
    const row = page.locator('[data-setting="calendar-links"] .cal-link', { hasText: "Club" });
    await row.waitFor();
    expect(await row.locator(".cal-link-problem").textContent()).toBe("The link stopped working. Replace it?");
    await row.getByRole("button", { name: "Replace link" }).click();
    await row.scrollIntoViewIfNeeded();
    await shotBoth(page, "cal1-error-settings", row);
    await row.getByLabel(/^New link/).fill(FAMILY);
    await row.getByRole("button", { name: "Check link" }).click();
    await row.locator(".cal-link-found").waitFor();
    await row.getByRole("button", { name: "Save new link" }).click();
    await expect.poll(() => row.locator(".cal-link-problem").count()).toBe(0);

    // Remove deletes it.
    await row.getByRole("button", { name: "Remove" }).click();
    await row.locator(".cal-link-confirm").getByRole("button", { name: "Remove" }).click();
    await expect.poll(() => page.locator('[data-setting="calendar-links"] .cal-link', { hasText: "Club" }).count()).toBe(0);

    expect(bodies.length).toBeGreaterThan(5);
    for (const b of bodies) expect(b).not.toMatch(PATHS);
    expect(await page.content()).not.toMatch(PATHS);
    if (SHOTS) expect(SHOTS).toBeTruthy();
  }, T);
});
