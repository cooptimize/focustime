// RF-1: the tabs in their new order (Day · Week · Ahead · Status · Inbox, 4 and 5), Status's dot instead of a count
// (the demo's Thursday is a day off, so Tuesday is amber and Wednesday red; none when nothing is owed), the top of Day
// with no source strip while the status bar still reconnects, and a day ahead with Add work instead of Plan.
// Demo mode (fictional data); each clock is its own throwaway server.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const T = 120_000;
const AMBER = "2026-11-10T10:00:00-05:00"; // Tuesday
const RED = "2026-11-11T10:00:00-05:00"; // Wednesday
const hash = (page: Page) => page.evaluate(() => location.hash);
const statusTab = (page: Page) => page.locator("nav.views .view-tab", { hasText: "Status" });
const mark = (page: Page) => statusTab(page).locator(".status-mark");

/** Nothing owed: every feature without Needs your update, in status.load's answer. */
async function nothingOwed(page: Page) {
  await page.route("**/api/action", async (route) => {
    if (!(route.request().postData() ?? "").includes('"status.load"')) return route.continue();
    const res = await route.fetch();
    const j = await res.json();
    if (j?.data) {
      j.data.needsYou = 0;
      for (const c of j.data.clients) for (const f of [...c.features, ...c.also]) f.needsYou = false;
    }
    return route.fulfill({ response: res, json: j });
  });
}

/** Google needing sign-in again, in week.load's answer (the demo's sources are always live). */
async function googleNeedsSignIn(page: Page) {
  await page.route("**/api/action", async (route) => {
    if (!(route.request().postData() ?? "").includes('"week.load"')) return route.continue();
    const res = await route.fetch();
    const j = await res.json();
    if (j?.data) j.data.sources = j.data.sources.map((s: { source: string }) => (s.source === "google" ? { ...s, status: "auth_required", fixAction: "connect_google", fetchedAt: null, fromCache: false, itemCount: 0, message: "Google needs you to sign in again" } : s));
    return route.fulfill({ response: res, json: j });
  });
}

describe.skipIf(!CHROMIUM)("RF-1: tab order, Status's dot, the top of Day", () => {
  describe("Tuesday: the amber day", () => {
    let h: Harness;
    beforeAll(async () => {
      h = await startDemo("chromium", {}, AMBER);
    }, T);
    afterAll(async () => h?.stop());

    it("the tabs read Day · Week · Ahead · Status · Inbox; 4 opens Status and 5 the Inbox", async () => {
      const { page, errors } = await freshPage(h);
      const tabs = (await page.locator("nav.views .view-tab").allInnerTexts()).map((t) => t.replace(/\d+/g, "").trim());
      expect(tabs).toEqual(["Day", "Week", "Ahead", "Status", "Inbox"]);
      await page.keyboard.press("4");
      await expect.poll(() => hash(page)).toBe("#/status");
      await page.keyboard.press("5");
      await expect.poll(() => hash(page)).toBe("#/inbox");
      await page.keyboard.press("t");
      await expect.poll(() => hash(page)).toBe("#/day");
      expect(errors).toEqual([]);
      await page.close();
    }, T);

    it("Status has an amber ring and no number, and says why; the phone's ⋯ shows the same", async () => {
      const { page, errors } = await freshPage(h);
      await mark(page).waitFor({ timeout: 60_000 });
      expect(await mark(page).getAttribute("class")).toBe("status-mark amber");
      expect(await statusTab(page).locator(".count").count()).toBe(0);
      expect((await statusTab(page).innerText()).trim()).toBe("Status");
      const why = await mark(page).getAttribute("aria-label");
      expect(why).toMatch(/^\d+ features? you worked on ha(s|ve) no update\. The report goes out Monday 7:00 AM\.$/);
      expect(await mark(page).getAttribute("title")).toBe(why);
      // The tab's name for a screen reader carries the reason.
      expect(await page.getByRole("button", { name: /^Status .*no update/ }).count()).toBe(1);
      // The command menu keeps 4 as Status's hint.
      await page.keyboard.press("Control+k");
      await page.keyboard.type("Status: this week");
      await expect.poll(() => page.getByRole("menuitem", { name: /^Status: this week/ }).first().innerText()).toMatch(/4\s*$/);
      await page.keyboard.press("Escape");
      expect(errors).toEqual([]);
      await page.close();
      // The phone: ⋯ › Status with its dot and "N to update".
      const phone = await freshPage(h, { width: 390, height: 844 });
      await phone.page.locator("button.top-more").click();
      const item = phone.page.getByRole("menuitem", { name: /^Status/ });
      await item.waitFor();
      await item.locator(".status-mark.amber").waitFor({ timeout: 30_000 });
      await expect(item.innerText()).resolves.toMatch(/\d+ to update/);
      await phone.page.close();
    }, T);

    it("no dot when nothing is owed", async () => {
      const { page } = await freshPage(h);
      await nothingOwed(page);
      await page.reload();
      await statusTab(page).waitFor();
      await page.waitForTimeout(2500);
      expect(await mark(page).count()).toBe(0);
      expect(await statusTab(page).locator(".count").count()).toBe(0);
      await page.close();
    }, T);

    it("the top of Day has no source strip, and the status bar still offers Reconnect", async () => {
      const { page, errors } = await freshPage(h);
      await googleNeedsSignIn(page);
      await page.reload();
      await page.locator(".today-view").waitFor();
      const bar = page.locator("footer.statusbar");
      await bar.getByRole("button", { name: "Reconnect Google" }).waitFor({ timeout: 30_000 });
      expect(await page.locator(".today-view .att-chip.source").count()).toBe(0);
      expect(await page.locator(".today-view").getByText(/no data yet/).count()).toBe(0);
      expect(await page.locator(".today-view").getByRole("button", { name: "Reconnect" }).count()).toBe(0);
      expect(errors).toEqual([]);
      await page.close();
    }, T);

    it("a day ahead reads Add work, never Plan, and opens Week's Add work on that day", async () => {
      const { page, errors } = await freshPage(h);
      await page.evaluate(() => (location.hash = "#/day/2026-11-11"));
      await page.locator(".today-other").waitFor();
      expect(await page.locator(".today-view").getByRole("button", { name: /^Plan\b/ }).count()).toBe(0);
      expect(await page.locator(".today-view").getByRole("link", { name: /^Plan\b/ }).count()).toBe(0);
      await page.locator(".today-other").getByRole("button", { name: "Add work", exact: true }).click();
      await page.locator("aside.add-work-panel").waitFor();
      await expect.poll(() => hash(page)).toMatch(/^#\/week\/day\/2026-11-11/);
      expect(errors).toEqual([]);
      await page.close();
    }, T);
  });

  describe("Wednesday: the red day", () => {
    let h: Harness;
    beforeAll(async () => {
      h = await startDemo("chromium", {}, RED);
    }, T);
    afterAll(async () => h?.stop());

    it("Status has a filled red dot and no number", async () => {
      const { page, errors } = await freshPage(h);
      await mark(page).waitFor({ timeout: 60_000 });
      expect(await mark(page).getAttribute("class")).toBe("status-mark red");
      expect(await statusTab(page).locator(".count").count()).toBe(0);
      // Shape as well as hue: red is filled, amber a ring.
      const fill = await mark(page).evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(fill).not.toBe("rgba(0, 0, 0, 0)");
      expect(errors).toEqual([]);
      await page.close();
    }, T);
  });
});
