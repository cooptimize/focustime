// SW-1: sending work to someone's week, the main path on the demo (Monday Nov 2): Today's lines for what was sent (IB-1 slice 4: each opens in the Inbox),
// Accept in Commit's From your team (it joins the week as a must), Send to… from a Commit row (a Must, as a Northwind
// lead), the Sent list, and Week › Team (committed features only, Not committed yet, Not on FocusTime yet). With
// FOCUSTIME_SHOTS, the screenshots for the report at 1920, 1366×768, Text size Larger and a phone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, weekRow, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";

const T = 240_000;
const THIS_WEEK = "2026-11-02";

async function larger(page: Page, on: boolean) {
  await page.evaluate((v) => (v ? document.documentElement.setAttribute("data-text-size", "larger") : document.documentElement.removeAttribute("data-text-size")), on);
  await page.waitForTimeout(200);
}
const commit = async (page: Page) => {
  await page.evaluate((w) => (location.hash = `#/week/commit/${w}`), THIS_WEEK);
  await page.locator("section.team-group").waitFor({ timeout: 30_000 });
};
const team = async (page: Page) => {
  await page.evaluate(() => (location.hash = "#/week/team"));
  await page.locator(".team-view .team-client").first().waitFor({ timeout: 30_000 });
};
async function openSendFor(page: Page, title: string) {
  const row = await weekRow(page, title);
  await row.locator(":scope > .pl-title").hover();
  await row.locator(":scope > .pl-hover button.more").click();
  await page.locator(".popup-menu .menu-item", { hasText: "Send to…" }).click();
  const dlg = page.getByRole("dialog", { name: `Send to… ${title}` });
  await dlg.waitFor();
  return dlg;
}

describe.skipIf(!CHROMIUM)("Send to someone's week (SW-1)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("Today's line, Accept, Send to… a Must, the Sent list and Team", async () => {
    const { page, errors } = await freshPage(h);
    // IB-1 slice 4: a send waiting for me is its own line (the Inbox's rows), the Must first, after the late promises; the
    // strip shows 3 lines, so the other send is in "N more in Inbox". The line opens that send in the detail pane.
    const lines = page.locator(".sent-line");
    await lines.first().waitFor({ timeout: 30_000 });
    await expect(lines.first().locator(".us-tag").textContent()).resolves.toBe("Sent to you · Must");
    await expect(page.locator(".urgent-strip .us-all").textContent()).resolves.toMatch(/^\d+ more in Inbox$/);
    await lines.filter({ hasText: "Loyalty points" }).locator(".us-line").click();
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/inbox\/item\/s\d+$/);
    await page.locator(".ib-pane .ib-detail-title", { hasText: "Loyalty points" }).waitFor();
    await commit(page);
    const group = page.locator("section.team-group");
    await group.waitFor({ timeout: 30_000 });

    // Accept: it leaves From your team and joins Northwind's list as a must (the demo has no DevOps writes, so untick).
    const loyalty = group.locator(".send-row", { hasText: "Loyalty points" });
    await expect(loyalty.textContent()).resolves.toContain("from Priya");
    await expect(loyalty.getByRole("checkbox", { name: /Also assign to me in DevOps/ }).isChecked()).resolves.toBe(true);
    await loyalty.getByRole("checkbox", { name: /Also assign to me in DevOps/ }).uncheck();
    await loyalty.getByRole("button", { name: "Accept", exact: true }).click();
    await expect.poll(() => group.locator(".send-row", { hasText: "Loyalty points" }).count()).toBe(0);
    await expect(weekRow(page, "Loyalty points")).resolves.toBeTruthy();

    // The client priority shows for everyone on Northwind; it's already on my week.
    await expect(group.locator(".priority-row", { hasText: "Order history export" }).textContent()).resolves.toContain("On your week");

    // Send to… a Must from a Commit row (I lead Northwind), to Sam; it shows in You sent as Waiting.
    const dlg = await openSendFor(page, "Supplier onboarding");
    await dlg.getByRole("combobox", { name: "Send to" }).click();
    await page.getByRole("option", { name: /Sam Ortiz/ }).click();
    await dlg.getByRole("radio", { name: "Must" }).click();
    await dlg.getByRole("button", { name: "Send", exact: true }).click();
    await expect(dlg.locator(".send-done").textContent()).resolves.toContain("Sent to Sam Ortiz for this week");
    // HK-3: the footer says Done after sending (the header × stays "Close").
    await expect(dlg.getByRole("button", { name: "Close" }).count()).resolves.toBe(1);
    await dlg.getByRole("button", { name: "Done", exact: true }).click();
    const mine = group.locator(".sent-row", { hasText: "Supplier onboarding" }).filter({ hasText: "Sam" });
    await expect.poll(() => mine.count()).toBe(1);
    await expect(mine.textContent()).resolves.toContain("Waiting");
    await expect(group.locator(".sent-row", { hasText: "Invoice PDF totals" }).textContent()).resolves.toContain("Can't: Out Thursday and Friday");

    // Team: committed features only; Sam hasn't committed; Taylor Kim isn't on FocusTime yet.
    await team(page);
    const nw = page.locator(".team-client", { hasText: "Northwind" }).first();
    await expect(nw.locator(".team-person", { hasText: "Priya Shah" }).textContent()).resolves.toContain("Order history export");
    await expect(nw.locator(".team-person", { hasText: "Sam Ortiz" }).textContent()).resolves.toContain("Not confirmed yet");
    await expect(page.locator(".team-client", { hasText: "Harbor" }).locator(".team-person", { hasText: "Taylor Kim" }).textContent()).resolves.toContain("Not on FocusTime yet");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  for (const [w, ht] of [[1920, 1080], [1366, 768]] as const) {
    it.skipIf(!SHOTS)(`screenshots ${w}`, async () => {
      const { page } = await freshPage(h, { width: w, height: ht });
      const snap = async (name: string) => {
        await page.screenshot({ path: `${SHOTS}/sw1-${name}-${w}.png` });
        if (w === 1920) {
          await larger(page, true);
          await page.screenshot({ path: `${SHOTS}/sw1-${name}-${w}-larger.png` });
          await larger(page, false);
        }
      };
      await page.locator(".sent-line").first().waitFor({ timeout: 30_000 });
      await page.locator(".sent-line").first().scrollIntoViewIfNeeded();
      await snap("today-line");
      await commit(page);
      await page.locator("section.team-group").scrollIntoViewIfNeeded();
      await snap("commit-from-your-team");
      await page.locator(".sent-row").first().scrollIntoViewIfNeeded();
      await snap("sent-list");
      await page.locator(".look").first().scrollIntoViewIfNeeded();
      await snap("ask-to-look");
      const dlg = await openSendFor(page, "Order history export");
      await dlg.getByRole("combobox", { name: "Send to" }).click();
      await page.waitForTimeout(300);
      await snap("send-dialog");
      await page.keyboard.press("Escape");
      await dlg.getByRole("button", { name: /priority instead/ }).click();
      await snap("send-dialog-priority");
      await dlg.getByRole("button", { name: "Cancel", exact: true }).first().click();
      await team(page);
      await snap("team");
      await page.locator(".team-priorities").first().scrollIntoViewIfNeeded();
      await snap("team-priority");
      await page.close();
    }, T);
  }

  it.skipIf(!SHOTS)("screenshots phone", async () => {
    const page = await h.browser.newPage({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    await page.addInitScript(() => {
      localStorage.setItem("focustime.hint.flow", "dismissed");
      localStorage.setItem("focustime.hint.picktime", "1");
    });
    await page.goto(h.url);
    await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
    await page.waitForSelector(".demo-tag", { timeout: 30_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await page.addStyleTag({ content: "html { font-size: 17px; }" });
    const fits = async (name: string) => {
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${name} is wider than the phone`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOTS}/sw1-phone-${name}.png` });
    };
    await page.locator(".sent-line").first().waitFor({ timeout: 30_000 });
    await fits("today-line");
    await team(page);
    await fits("team");
    await page.locator(".team-client", { hasText: "Harbor" }).scrollIntoViewIfNeeded();
    await fits("team-harbor");
    await page.close();
  }, T);
});
