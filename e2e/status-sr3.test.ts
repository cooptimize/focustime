// SR-3: a report you can finish, on the demo, Thursday Nov 5: Needs your update at the top of each client with the
// "AI suggests" line (Use, Edit, Dismiss), inline lines (Enter opens the next, Shift+Enter a new line in the same
// comment, Esc closes, Tab to the next feature's + Add a line), click-to-edit my own comment, the header's pending count,
// Push all grouped by client and feature; the client report's Add a feature and its holidays; the phone at 390 writing
// with 44px targets and no horizontal scroll. With FOCUSTIME_SHOTS: the screens for docs/ux/sr3.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

const T = 300_000;
const THURSDAY = "2026-11-05T10:00:00-05:00";

async function openStatus(page: Page, hash = "#/week/status") {
  await page.goto(`${new URL(page.url()).origin}/${hash}`);
  await page.getByRole("heading", { name: /Status report · for Monday, Nov 9/ }).waitFor({ timeout: 30_000 });
  await page.locator(".st-needs").first().waitFor({ timeout: 30_000 });
}
const activeFeature = (page: Page) => page.evaluate(() => document.activeElement?.closest("[data-feature]")?.getAttribute("data-feature") ?? null);

describe.skipIf(!CHROMIUM)("Status you can finish (SR-3)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, THURSDAY);
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("Needs your update with suggestions, inline lines with their keys, and Push all grouped by feature", async () => {
    const { page, errors } = await freshPage(h);
    await openStatus(page);
    await expect.poll(() => page.locator(".st-needs-count").textContent()).toBe(" · 3 features need your update");
    const harbor = page.getByRole("article", { name: "Patient intake form" });
    const atlas = page.getByRole("article", { name: "Shipment tracking dashboard" });
    const internal = page.getByRole("article", { name: "Internal reporting refresh" });
    await expect.poll(() => harbor.locator(".st-worked").textContent()).toBe("You worked on this");
    await expect.poll(() => harbor.locator(".st-sugg-label").textContent()).toBe("AI suggests");
    // GD-2: the demo's suggestion for Harbor named another client; it reads "another client" and says so.
    await expect.poll(() => harbor.locator(".st-sugg-text").textContent()).toContain("another client");
    await expect.poll(() => harbor.locator("xpath=ancestor::section[contains(@class,'st-needs')]").locator(".st-note").textContent()).toContain("Another client's name was removed");
    if (SHOTS) await shotBoth(page, "sr3-ai-suggests-1920", harbor);
    // Use: the suggestion becomes a pending line, nothing sent.
    await harbor.getByRole("button", { name: "Use", exact: true }).click();
    await expect.poll(() => harbor.locator(".st-pending-line .st-pending-tag").textContent()).toBe("Suggested, not pushed yet");
    await expect.poll(() => page.locator(".st-pending-count").textContent()).toBe("1 line to push");
    // Edit: the suggestion opens in a box; Enter adds it and opens the next; Shift+Enter is a new line in the same one; Esc closes.
    await atlas.getByRole("button", { name: "Edit", exact: true }).click();
    const box = atlas.getByRole("textbox", { name: "New line for Shipment tracking dashboard" });
    await box.press("End");
    await box.pressSequentially(" Demo on Monday.");
    await box.press("Enter");
    await expect.poll(() => atlas.getByRole("textbox").count()).toBe(1);
    const next = atlas.getByRole("textbox", { name: "New line for Shipment tracking dashboard" });
    await expect.poll(() => next.inputValue()).toBe("");
    await next.pressSequentially("Carrier feed is next.");
    await next.press("Shift+Enter");
    await next.pressSequentially("Needs the carrier's test key.");
    await expect.poll(() => next.inputValue()).toBe("Carrier feed is next.\nNeeds the carrier's test key.");
    await next.press("Escape");
    await expect.poll(() => atlas.getByRole("textbox").count()).toBe(0);
    await expect.poll(() => atlas.locator(".st-pending-line").count()).toBe(2);
    await expect.poll(() => page.locator(".st-pending-count").textContent()).toBe("3 lines to push");
    // Esc on an empty line drops it.
    await atlas.getByRole("button", { name: "Add a line" }).click();
    await atlas.getByRole("textbox").press("Escape");
    await expect.poll(() => atlas.locator(".st-pending-line").count()).toBe(2);
    // Dismiss hides the suggestion.
    await internal.getByRole("button", { name: "Dismiss" }).click();
    await expect.poll(() => internal.locator(".st-sugg").count()).toBe(0);
    // Tab from a + Add a line goes to the next feature's.
    await internal.getByRole("button", { name: "Add a line" }).focus();
    const from = await activeFeature(page);
    await page.keyboard.press("Tab");
    await expect.poll(() => page.evaluate(() => document.activeElement?.hasAttribute("data-add-line"))).toBe(true);
    expect(await activeFeature(page)).not.toBe(from);
    // My own comment edits in place by clicking it; others' stay read only.
    const oh = page.getByRole("article", { name: "Order history export" });
    expect(await oh.locator(".who-teammate .st-text-edit").count()).toBe(0);
    await oh.locator(".who-mine .st-text-edit").first().click();
    const edit = oh.getByRole("textbox", { name: "Edit your comment on Order history export" });
    await edit.press("End");
    await edit.pressSequentially(" Filter is in review today.");
    await edit.press("Escape");
    await expect.poll(() => oh.locator(".st-pending-tag").first().textContent()).toBe("Edited, not pushed yet");
    await expect.poll(() => page.locator(".st-pending-count").textContent()).toBe("4 lines to push");
    if (SHOTS) {
      await page.locator(".st-needs").first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/sr3-needs-1920.png` });
      await shotBoth(page, "sr3-needs-suggest-1920", harbor);
    }
    // Push all: one preview, by client and then feature.
    await page.getByRole("button", { name: "Push all" }).click();
    const dialog = page.getByRole("dialog", { name: "Push 4 lines to DevOps" });
    await dialog.waitFor();
    await expect.poll(() => dialog.locator(".st-push-client > h3").allTextContents()).toEqual(expect.arrayContaining(["Harbor", "Atlas", "Northwind"]));
    await expect.poll(() => dialog.getByRole("group", { name: "Shipment tracking dashboard" }).locator(".dw-row").count()).toBe(2);
    if (SHOTS) await shotBoth(page, "sr3-push-preview-1920");
    await dialog.getByRole("button", { name: /Push 4 lines to DevOps/ }).click();
    await expect.poll(() => dialog.locator(".dw-ok").count(), { timeout: 30_000 }).toBe(4);
    await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
    // Read back: Harbor and Atlas left Needs your update; the Internal one I dismissed is still there.
    await expect.poll(() => page.locator(".st-needs-count").textContent()).toBe(" · 1 feature needs your update");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the client report: Add a feature in stack rank with its line open, and holidays among the PTO", async () => {
    const { page, errors } = await freshPage(h);
    await page.goto(`${new URL(page.url()).origin}/#/week/status`);
    await page.locator(".st-count").waitFor({ timeout: 30_000 });
    await page.getByRole("combobox", { name: "Client report" }).selectOption({ label: "Northwind report" });
    await page.getByRole("heading", { name: "Northwind report" }).waitFor({ timeout: 30_000 });
    await expect.poll(() => page.locator(".st-pto li.st-holiday").allTextContents()).toEqual(["Founders Day (observed) · Thu, Nov 12", "Holiday · Mon, Nov 16"]);
    await page.getByRole("button", { name: "Add a feature" }).click();
    const pop = page.getByRole("dialog", { name: /^Add a feature/ });
    await pop.waitFor();
    const before = await page.locator(".st-report .st-features > .st-feature").count();
    if (SHOTS) await shotBoth(page, "sr3-add-feature-1920");
    const first = pop.getByRole("option").first();
    const title = (await first.locator(".fl-label").textContent())?.trim() ?? "";
    await first.click();
    await expect.poll(() => page.locator(".st-report .st-features > .st-feature").count()).toBe(before + 1);
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("TEXTAREA");
    expect(title.length).toBeGreaterThan(0);
    await page.keyboard.type("Kicked off with the store team.");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sr3-report-added-1920.png`, fullPage: true });
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator(".st-pending-count").textContent()).toBe("1 line to push");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("on the phone at 390: reads with no horizontal scroll, and Use, Add a line and Push all work with 44px targets", async () => {
    // bypassCSP so the iPhone root font sizes can be set (as SR-2's phone check does).
    const page = await h.browser.newPage({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem("focustime.hint.flow", "dismissed");
      localStorage.setItem("focustime.hint.picktime", "1");
    });
    await page.goto(h.url);
    await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
    await page.waitForSelector(".demo-tag", { timeout: 30_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await openStatus(page);
    for (const px of [17, 21]) {
      await page.addStyleTag({ content: `html { font-size: ${px}px; }` });
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => {
        const v = document.querySelector(".status-view")!;
        const right = Math.max(...[...v.querySelectorAll("*")].map((el) => el.getBoundingClientRect().right));
        return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, view: v.scrollWidth - v.clientWidth, right: right - innerWidth };
      });
      expect([m.page, m.view], `${px}px root font`).toEqual([0, 0]);
      expect(m.right, `${px}px root font: something reaches past the screen`).toBeLessThanOrEqual(0);
    }
    const harbor = page.getByRole("article", { name: "Patient intake form" });
    await harbor.locator(".st-sugg-text").waitFor({ timeout: 30_000 });
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".status-view .st-add, .status-view .st-sugg-actions button, .status-view .st-push .commit")]
        .filter((b) => b.offsetParent)
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.height < 44 || r.width < 44).length,
    );
    expect(small).toBe(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sr3-phone-390.png`, fullPage: true });
    await harbor.getByRole("button", { name: "Use", exact: true }).click();
    await harbor.getByRole("button", { name: "Add a line" }).click();
    await harbor.getByRole("textbox").fill("Card scan works on the tablet too.");
    await harbor.getByRole("textbox").press("Escape");
    await expect.poll(() => page.locator(".st-pending-count").textContent()).toBe("2 lines to push");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sr3-phone-390-pending.png` });
    await page.getByRole("button", { name: "Push all" }).click();
    const dialog = page.getByRole("dialog", { name: "Push 2 lines to DevOps" });
    await dialog.getByRole("button", { name: /Push 2 lines to DevOps/ }).click();
    await expect.poll(() => dialog.locator(".dw-ok").count(), { timeout: 30_000 }).toBe(2);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
