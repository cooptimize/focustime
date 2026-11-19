// Was e2e/status-sr3.test.ts until BT-1.
// SR-3: a report you can finish, on the demo, Thursday Nov 5: the features that need an update at the top of each
// client with a Suggested line (ST-1: Add, Edit, Dismiss), inline lines (Enter opens the next, Shift+Enter a new line in
// the same comment, Esc closes, Tab to the next feature's Write a line), Edit on my own comment, the foot bar's count,
// Push to DevOps grouped by client and feature; the client report's Add a feature and its holidays; the phone at 390 writing
// with 44px targets and no horizontal scroll. With FOCUSTIME_SHOTS: the screens for screenshots/sr3.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { SHOTS, shotBoth } from "../shots.ts";
import { confirmPreviews, onePreview } from "../one-preview.ts";

const T = 300_000;
const THURSDAY = "2026-11-05T10:00:00-05:00";

async function openStatus(page: Page, hash = "#/week/status") {
  await page.goto(`${new URL(page.url()).origin}/${hash}`);
  await page.getByRole("heading", { name: "Status report" }).waitFor({ timeout: 30_000 });
  await page.locator(".st-feature.st-mine").first().waitFor({ timeout: 30_000 });
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

  it("Needs an update with suggestions, inline lines with their keys, and Push to DevOps grouped by feature", async () => {
    const { page, errors } = await freshPage(h);
    await openStatus(page);
    await expect.poll(() => page.locator("[data-show=needs] .seg-count").textContent()).toBe("3");
    await expect.poll(() => page.locator("[data-show=needs]").getAttribute("aria-pressed")).toBe("true");
    const harbor = page.getByRole("article", { name: "Patient intake form" });
    const atlas = page.getByRole("article", { name: "Shipment tracking dashboard" });
    const internal = page.getByRole("article", { name: "Internal reporting refresh" });
    await expect.poll(() => harbor.locator(".st-badge").textContent()).toBe("Needs an update");
    await expect.poll(() => harbor.locator(".st-sugg-label").textContent()).toBe("Suggested");
    // GD-2: the demo's suggestion for Harbor named another client; it reads "another client" and says so.
    await expect.poll(() => harbor.locator(".st-sugg-text").textContent()).toContain("another client");
    await expect.poll(() => harbor.locator(".st-sugg-note").textContent()).toContain("Another client's name was removed");
    if (SHOTS) await shotBoth(page, "sr3-ai-suggests-1920", harbor);
    // ST-1: no foot bar while nothing is Ready to push. Add: the suggestion becomes Ready to push, nothing sent.
    expect(await page.locator("[data-foot-bar]").count()).toBe(0);
    await harbor.getByRole("button", { name: "Add", exact: true }).click();
    await expect.poll(() => harbor.locator(".st-pending-line .st-pending-tag").textContent()).toBe("Ready to push");
    await expect.poll(() => page.locator(".st-pending-count").textContent()).toBe("1 line ready to push");
    await expect.poll(() => page.locator(".st-foot-clients").textContent()).toBe("Harbor 1");
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
    await expect.poll(() => page.locator(".st-pending-count").textContent()).toBe("3 lines ready to push");
    // Esc on an empty line drops it.
    await atlas.getByRole("button", { name: "Write a line" }).click();
    await atlas.getByRole("textbox").press("Escape");
    await expect.poll(() => atlas.locator(".st-pending-line").count()).toBe(2);
    // Dismiss hides the suggestion.
    await internal.getByRole("button", { name: "Dismiss" }).click();
    await expect.poll(() => internal.locator(".st-sugg").count()).toBe(0);
    // Tab from a Write a line goes to the next feature's.
    await internal.getByRole("button", { name: "Write a line" }).focus();
    const from = await activeFeature(page);
    await page.keyboard.press("Tab");
    await expect.poll(() => page.evaluate(() => document.activeElement?.hasAttribute("data-add-line"))).toBe(true);
    expect(await activeFeature(page)).not.toBe(from);
    // My own comment has Edit (it opens under Not on it yet); others' stay read only.
    await page.locator("[data-show=all]").click();
    const oh = page.getByRole("article", { name: "Order history export" });
    expect(await oh.locator(".who-teammate .link-btn").count()).toBe(0);
    await oh.locator(".who-mine").getByRole("button", { name: "Edit", exact: true }).click();
    const edit = oh.getByRole("textbox", { name: "Edit your comment on Order history export" });
    await edit.press("End");
    await edit.pressSequentially(" Filter is in review today.");
    await edit.press("Escape");
    await expect.poll(() => oh.locator(".st-pending-tag").first().textContent()).toBe("Ready to push · Edit of your line");
    await expect.poll(() => page.locator(".st-pending-count").textContent()).toBe("4 lines ready to push");
    if (SHOTS) {
      await page.locator(".st-feature.st-mine").first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/sr3-needs-1920.png` });
      await shotBoth(page, "sr3-needs-suggest-1920", harbor);
    }
    // OP-1: Push to DevOps is the app's one preview, one client at a time (the screen says so first), never two clients in one.
    await expect.poll(() => page.locator(".st-parts").textContent()).toBe("4 lines go in 3 previews, one client at a time.");
    await page.getByRole("button", { name: "Push to DevOps" }).click();
    if (SHOTS) {
      await onePreview(page).waitFor();
      await shotBoth(page, "sr3-push-preview-1920");
    }
    const seen = await confirmPreviews(page, 3);
    expect(seen.map((x) => x.where.split(" · ")[1])).toEqual(expect.arrayContaining(["Harbor", "Atlas", "Northwind"]));
    expect(new Set(seen.map((x) => x.where)).size).toBe(3);
    expect(seen.map((x) => x.rows).sort()).toEqual([1, 1, 2]);
    await expect.poll(() => page.locator(".st-pushed li.ok").count(), { timeout: 30_000 }).toBe(4);
    // Read back: Harbor and Atlas no longer need an update; the Internal one I dismissed still does. The bar is gone.
    await expect.poll(() => page.locator("[data-show=needs] .seg-count").textContent()).toBe("1");
    expect(await page.locator("[data-foot-bar]").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the client report: Add a feature in stack rank with its line open, and holidays among the PTO", async () => {
    const { page, errors } = await freshPage(h);
    await page.goto(`${new URL(page.url()).origin}/#/week/status`);
    await page.locator("[data-updated]").waitFor({ timeout: 30_000 });
    await page.getByRole("combobox", { name: "Client report" }).selectOption({ label: "Northwind report" });
    await page.getByRole("heading", { name: "Northwind report" }).waitFor({ timeout: 30_000 });
    await page.locator("[data-show=all]").click();
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
    await expect.poll(() => page.locator(".st-pending-count").textContent()).toBe("1 line ready to push");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("on the phone at 390: reads with no horizontal scroll, and Add, Write a line and Push to DevOps work with 44px targets", async () => {
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
      [...document.querySelectorAll<HTMLElement>(".status-view .st-add, .status-view .st-sugg-actions button, .status-view .st-show .ib4-chip, .status-view .st-adds .mini")]
        .filter((b) => b.offsetParent)
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.height < 44 || r.width < 44).length,
    );
    expect(small).toBe(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sr3-phone-390.png`, fullPage: true });
    await harbor.getByRole("button", { name: "Add", exact: true }).click();
    await harbor.getByRole("button", { name: "Write a line" }).click();
    await harbor.getByRole("textbox").fill("Card scan works on the tablet too.");
    await harbor.getByRole("textbox").press("Escape");
    await expect.poll(() => page.locator(".st-pending-count").textContent()).toBe("2 lines ready to push");
    // ST-1: the foot bar's Push is 44px and sits above the bottom bar, on screen.
    const bar = await page.locator("[data-foot-bar] .st-push-btn").boundingBox();
    expect(bar && bar.height >= 44 && bar.y + bar.height <= 844).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sr3-phone-390-pending.png` });
    await page.getByRole("button", { name: "Push to DevOps" }).click();
    await confirmPreviews(page, (await page.locator(".st-parts").count()) ? 2 : 1);
    await expect.poll(() => page.locator(".st-pushed li.ok").count(), { timeout: 30_000 }).toBe(2);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
