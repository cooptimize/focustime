// ST-1: Status shows what is on the report and what isn't, on the demo, Thursday Nov 5. Every line is On the report,
// Ready to push or Suggested, told apart by shape and words; Suggest a line (once Draft) arrives as Suggested and Push
// sends only what is Ready to push; Add, Edit, Dismiss and Add all; the foot bar counts by client and goes when nothing
// is ready; Preview shows only what is in DevOps, Show them draws the ready lines in their own look; every control on
// main is still reachable; at 1440, 1280 and 390, light and dark and the largest Text size, nothing is cut and the bar
// sits over no control.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { confirmPreviews } from "../one-preview.ts";
import { phonePage } from "../mb1-helpers.ts";

const T = 300_000;
const THURSDAY = "2026-11-05T10:00:00-05:00";
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Entry = { op: string; itemId: number; ops: { text?: string } | null };
const log = async (page: Page) => (await call(page, "devops.log", {})).data.entries as Entry[];
const art = (page: Page, name: string) => page.getByRole("article", { name });

async function openStatus(page: Page) {
  await page.evaluate(() => (location.hash = "#/week/status"));
  await page.getByRole("heading", { name: "Status report" }).waitFor({ timeout: 30_000 });
  await page.locator("[data-updated]").waitFor({ timeout: 30_000 });
}
/**
 * Every control in Status (buttons, links, summaries, boxes) the foot bar would keep covered: one that can't be scrolled
 * to sit above the bar (the page ends first). A sticky bar passes over rows while scrolling, as the app's other bars do.
 */
const coveredByBar = (page: Page) =>
  page.evaluate(() => {
    const v = document.querySelector<HTMLElement>(".status-view")!;
    const scroller = v.scrollHeight > v.clientHeight ? v : document.scrollingElement as HTMLElement;
    const hit: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(".status-view :is(button, a, summary, textarea)")) {
      if (el.closest("[data-foot-bar]") || !el.getClientRects().length) continue;
      // Inside a closed fold: not on screen until it opens.
      if (el.tagName !== "SUMMARY" && el.closest("details:not([open])")) continue;
      const max = scroller.scrollHeight - scroller.clientHeight;
      const r = el.getBoundingClientRect();
      const b = document.querySelector("[data-foot-bar]")!.getBoundingClientRect();
      // Where the scroll would have to be for the control to end 4px above the bar.
      const need = scroller.scrollTop + (r.bottom - (b.top - 4));
      if (need > max + 1) {
        scroller.scrollTop = max;
        const r2 = el.getBoundingClientRect();
        const b2 = document.querySelector("[data-foot-bar]")!.getBoundingClientRect();
        if (r2.bottom > b2.top + 1 && r2.top < b2.bottom - 1 && r2.right > b2.left && r2.left < b2.right) hit.push((el.textContent ?? el.tagName).trim().slice(0, 40));
      }
    }
    return hit;
  });
const overflow = (page: Page) =>
  page.evaluate(() => {
    const v = document.querySelector<HTMLElement>(".status-view")!;
    const right = Math.max(...[...v.querySelectorAll("*")].filter((e) => !e.closest("details:not([open]) > :not(summary)")).map((el) => el.getBoundingClientRect().right));
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, view: v.scrollWidth - v.clientWidth, right: Math.round(right - innerWidth) };
  });

describe.skipIf(!CHROMIUM)("ST-1: three states", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, THURSDAY);
  }, T);
  afterAll(async () => h?.stop(), T);

  it("each state by shape and words; Suggest a line arrives as Suggested; Push sends only what is Ready to push", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await openStatus(page);
    // The key, once, with the three names.
    await expect.poll(() => page.locator(".st-key li strong").allTextContents()).toEqual(["On the report", "Ready to push", "Suggested"]);
    // No Push anywhere while nothing is ready.
    expect(await page.getByRole("button", { name: "Push to DevOps" }).count()).toBe(0);
    await page.locator("[data-show=all]").click();
    const oh = art(page, "Order history export");
    const harbor = art(page, "Patient intake form");
    // On the report: a bullet (list-style disc), no edge, no dashed box.
    const onReport = harbor.locator('.st-on li[data-state="on_report"]').first();
    expect(await onReport.evaluate((e) => getComputedStyle(e).listStyleType)).toBe("disc");
    expect(await onReport.evaluate((e) => getComputedStyle(e).borderLeftStyle)).toBe("none");
    // Suggested: a dashed box, its name in words for a screen reader.
    const sugg = harbor.locator('[data-state="suggested"]');
    await sugg.waitFor({ timeout: 30_000 });
    expect(await sugg.evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe("dashed");
    expect(await sugg.getAttribute("aria-label")).toMatch(/^Suggested: /);
    // Suggest a line on a feature with no suggestion: its text arrives Suggested, and is not among what Push sends.
    expect(await oh.locator('[data-state="suggested"]').count()).toBe(0);
    await oh.getByRole("button", { name: "Suggest a line" }).click();
    await oh.locator('[data-state="suggested"] .st-sugg-text').waitFor({ timeout: 30_000 });
    const drafted = (await oh.locator(".st-sugg-text").textContent())!.trim();
    expect(await page.locator("[data-foot-bar]").count()).toBe(0);
    // A line I write is Ready to push: a solid edge, its name.
    await harbor.getByRole("button", { name: "Write a line" }).click();
    await harbor.getByRole("textbox").fill("Date of birth check is in review.");
    await harbor.getByRole("textbox").press("Escape");
    const ready = harbor.locator('.st-pending-line[data-state="ready"]');
    expect(await ready.evaluate((e) => getComputedStyle(e).borderLeftStyle)).toBe("solid");
    expect(await ready.locator(".st-pending-tag").textContent()).toBe("Ready to push");
    expect(await ready.locator("button").first().getAttribute("aria-label")).toMatch(/Ready to push/);
    // Under one feature, all three: On the report, Ready to push, Suggested.
    expect(await harbor.locator('[data-state="on_report"]').count()).toBeGreaterThan(0);
    expect(await harbor.locator('[data-state="ready"]').count()).toBe(1);
    expect(await harbor.locator('[data-state="suggested"]').count()).toBe(1);
    // The bar: one line, by client. Push with the suggestions showing sends only the Ready to push line.
    await expect.poll(() => page.locator("[data-foot-bar] .st-pending-count").textContent()).toBe("1 line ready to push");
    await expect.poll(() => page.locator(".st-foot-clients").textContent()).toBe("Harbor 1");
    const before = (await log(page)).length;
    await page.locator("[data-foot-bar]").getByRole("button", { name: "Push to DevOps" }).click();
    const seen = await confirmPreviews(page, 1);
    expect(seen.map((x) => x.rows)).toEqual([1]);
    await expect.poll(async () => (await log(page)).length - before, { timeout: 30_000 }).toBe(1);
    const sent = (await log(page)).slice(0, 1);
    expect(sent.map((e) => [e.op, e.ops?.text])).toEqual([["comment", "Date of birth check is in review."]]);
    expect(sent.some((e) => e.ops?.text === drafted)).toBe(false);
    // Pushed: On the report now, with Undo; the bar is gone; the suggestion is still only a suggestion.
    await page.locator(".st-pushed").getByRole("button", { name: "Undo" }).waitFor();
    await expect.poll(() => page.locator('.st-pushed li[data-state="on_report"]').count()).toBe(1);
    expect(await page.locator("[data-foot-bar]").count()).toBe(0);
    expect(await oh.locator('[data-state="suggested"]').count()).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Add, Edit and Dismiss on an AI suggestion and one made without AI; Add all; the bar counts and goes", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    // Atlas without AI: its suggestion is the plain one, made from what I worked on.
    expect((await call(page, "admin.set", { scope: "client:Atlas", key: "allow_ai", value: false })).ok).toBe(true);
    await openStatus(page);
    const atlas = art(page, "Shipment tracking dashboard");
    const harbor = art(page, "Patient intake form");
    const internal = art(page, "Internal reporting refresh");
    await atlas.locator('[data-state="suggested"] .st-sugg-text').waitFor({ timeout: 30_000 });
    expect(await atlas.locator(".st-sugg-template").count()).toBe(1);
    expect(await atlas.getByRole("button", { name: "Suggest a line" }).count()).toBe(0);
    // What it was based on: one quiet link that opens the list.
    await atlas.getByRole("button", { name: /^Based on 1 thing you worked on$/ }).click();
    await expect.poll(() => atlas.locator(".st-basis-list li").count()).toBe(1);
    // Edit (without AI): opens as my line with its text; Esc keeps it Ready to push.
    const atlasText = (await atlas.locator(".st-sugg-text").textContent())!.trim();
    await atlas.getByRole("button", { name: "Edit", exact: true }).click();
    const box = atlas.getByRole("textbox");
    await expect.poll(() => box.inputValue()).toBe(atlasText);
    await box.press("Escape");
    await expect.poll(() => atlas.locator('.st-pending-line[data-state="ready"]').count()).toBe(1);
    expect(await atlas.locator('[data-state="suggested"]').count()).toBe(0);
    // Remove brings the suggestion back (as Use's Remove did); Edit again keeps the test's line.
    await atlas.locator(".st-pending-line").getByRole("button", { name: "Remove" }).click();
    await expect.poll(() => atlas.locator('[data-state="suggested"]').count()).toBe(1);
    await atlas.getByRole("button", { name: "Edit", exact: true }).click();
    await atlas.getByRole("textbox").press("Escape");
    await expect.poll(() => atlas.locator('.st-pending-line[data-state="ready"]').count()).toBe(1);
    // Dismiss (AI): gone, nothing ready.
    await internal.getByRole("button", { name: "Dismiss" }).click();
    expect(await internal.locator('[data-state="suggested"]').count()).toBe(0);
    expect(await internal.locator('[data-state="ready"]').count()).toBe(0);
    // Add (AI): Ready to push.
    await harbor.getByRole("button", { name: "Add", exact: true }).click();
    await expect.poll(() => harbor.locator('.st-pending-line[data-state="ready"]').count()).toBe(1);
    await expect.poll(() => page.locator("[data-foot-bar] .st-pending-count").textContent()).toBe("2 lines ready to push");
    await expect.poll(() => page.locator(".st-foot-clients").textContent()).toBe("Atlas 1, Harbor 1");
    // Add all: Suggest for all on Northwind gives two suggestions (the demo's AI writes one, so its answer is given a
    // second here), Add all makes both Ready to push.
    await page.route("**/api/action", async (route) => {
      const body = route.request().postDataJSON() as { action?: string; input?: { clientKey?: string } };
      if (body.action !== "status.draft" || body.input?.clientKey !== "Northwind") return route.fallback();
      await route.fulfill({ json: { ok: true, data: { clientKey: "Northwind", ai: "ok", message: null, drafts: [{ itemId: 1110, text: "Date filter in review." }, { itemId: 1120, text: "Sign-up form designed." }] } } });
    });
    await page.locator("[data-show=all]").click();
    const nw = page.getByRole("region", { name: "Northwind" });
    await nw.getByRole("button", { name: "Suggest for all" }).click();
    await expect.poll(() => nw.locator('[data-state="suggested"]').count(), { timeout: 30_000 }).toBe(2);
    await nw.getByRole("button", { name: "Add all" }).click();
    await expect.poll(() => nw.locator('.st-pending-line[data-state="ready"]').count()).toBe(2);
    expect(await nw.locator('[data-state="suggested"]').count()).toBe(0);
    expect(await nw.getByRole("button", { name: "Add all" }).count()).toBe(0);
    await expect.poll(() => page.locator(".st-foot-clients").textContent()).toBe("Atlas 1, Harbor 1, Northwind 2");
    // Removing every ready line takes the bar away.
    for (let i = 0; i < 6; i++) {
      const rm = page.locator(".st-pending-line").getByRole("button", { name: "Remove" });
      if (!(await rm.count())) break;
      await rm.first().click();
    }
    await expect.poll(() => page.locator("[data-foot-bar]").count()).toBe(0);
    expect(await page.getByRole("button", { name: "Push to DevOps" }).count()).toBe(0);
    expect((await call(page, "admin.set", { scope: "client:Atlas", key: "allow_ai", value: true })).ok).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Preview shows only what is in DevOps; Show them draws the ready lines in their own look; no suggestion", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await openStatus(page);
    const harbor = art(page, "Patient intake form");
    await harbor.locator('[data-state="suggested"]').waitFor({ timeout: 30_000 });
    const suggestion = (await harbor.locator(".st-sugg-text").textContent())!.trim();
    await page.locator("[data-show=all]").click();
    const sup = art(page, "Supplier onboarding");
    await sup.getByRole("button", { name: "Write a line" }).click();
    await sup.getByRole("textbox").fill("Sign-up form designed.");
    await sup.getByRole("textbox").press("Escape");
    await art(page, "Order history export").locator(".who-mine").getByRole("button", { name: "Delete" }).click();
    const reportLines = await page.locator('.st-on li[data-state="on_report"] .st-text:visible').allTextContents();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect.poll(() => page.locator("[data-preview-top] span").first().textContent()).toBe("2 lines aren't on the report yet");
    // Only DevOps lines are bullets (a delete that isn't pushed is still on the report); no suggestion; no ready look.
    await expect.poll(() => page.locator(".st-email .st-bullets li").count()).toBe(reportLines.length);
    expect((await page.locator(".status-view").textContent())!).not.toContain(suggestion);
    expect(await page.locator('.st-email [data-state="ready"], .st-email [data-state="suggested"]').count()).toBe(0);
    await expect.poll(() => art(page, "Supplier onboarding").locator(".st-none").textContent()).toBe("No update yet");
    await page.getByRole("button", { name: "Show them" }).click();
    await expect.poll(() => page.locator('.st-email [data-state="ready"]').count()).toBe(2);
    expect(await page.locator(".st-email .st-bullets li").count()).toBe(reportLines.length);
    expect(await page.locator('.st-email [data-state="ready"]').first().evaluate((e) => getComputedStyle(e).borderLeftStyle)).toBe("solid");
    expect((await page.locator(".status-view").textContent())!).not.toContain(suggestion);
    await expect.poll(() => page.locator('.st-email [data-state="ready"] .st-pending-tag').allTextContents()).toEqual(expect.arrayContaining(["Ready to push", "Ready to push · Deletes your line"]));
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("every control and state on main is still reachable (STEP 0.4)", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await openStatus(page);
    const btn = (name: string | RegExp, exact = true) => page.getByRole("button", typeof name === "string" ? { name, exact } : { name });
    for (const name of ["Write", "Preview", "My features"]) expect(await btn(name).count(), name).toBeGreaterThan(0);
    expect(await page.getByRole("combobox", { name: "Client report" }).count()).toBe(1);
    expect(await page.locator("[data-show=needs]").count()).toBe(1);
    await page.locator("[data-show=all]").click();
    for (const name of ["Write a line", "Suggest a line", "Suggest for all", "Add", "Dismiss", "See last week's lines"]) expect(await btn(name).count(), name).toBeGreaterThan(0);
    expect(await btn(/^Based on/).count()).toBeGreaterThan(0);
    expect(await page.locator("details.st-hints summary").count()).toBeGreaterThan(0);
    expect(await page.locator("details.st-also summary", { hasText: "Also assigned to you" }).count()).toBeGreaterThan(0);
    const oh = art(page, "Order history export");
    await oh.getByRole("button", { name: "See last week's lines" }).click();
    await expect.poll(() => oh.locator(".st-last li").count()).toBeGreaterThan(0);
    // Edit of my comment, Cancel edit; Delete, Keep it.
    await oh.locator(".who-mine").getByRole("button", { name: "Edit", exact: true }).click();
    await oh.getByRole("button", { name: "Cancel edit" }).click();
    await oh.locator(".who-mine").getByRole("button", { name: "Delete" }).click();
    await oh.getByRole("button", { name: "Keep it" }).click();
    // The client report: Refresh, Add a feature, No update yet, PTO.
    await page.getByRole("combobox", { name: "Client report" }).selectOption({ label: "Northwind report" });
    await page.locator(".st-report").waitFor({ timeout: 30_000 });
    for (const name of ["Refresh"]) expect(await btn(name).count(), name).toBe(1);
    expect(await btn(/Add a feature/).count()).toBe(1);
    expect(await page.locator(".st-noupdate summary").count()).toBe(1);
    expect(await page.locator(".st-pto").count()).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  for (const [w, ht, scheme, text] of [[1440, 900, "dark", "default"], [1280, 720, "light", "default"], [1440, 900, "dark", "larger"], [1280, 720, "dark", "larger"]] as const) {
    it(`at ${w}×${ht}, ${scheme}, ${text} text: nothing cut, the bar over no control`, async () => {
      const { page } = await freshPage(h, { width: w, height: ht });
      await call(page, "ui.set_theme", { theme: `cooptimize-${scheme}` });
      await call(page, "ui.set_text_size", { size: text });
      await page.reload();
      await openStatus(page);
      await page.locator("[data-show=all]").click();
      const harbor = art(page, "Patient intake form");
      await harbor.getByRole("button", { name: "Add", exact: true }).click();
      await page.locator("[data-foot-bar]").waitFor();
      const m = await overflow(page);
      expect([m.page, m.view]).toEqual([0, 0]);
      expect(m.right).toBeLessThanOrEqual(0);
      expect(await coveredByBar(page)).toEqual([]);
      await call(page, "ui.set_text_size", { size: "default" });
      await page.close();
    }, T);
  }

  it("on the phone at 390: the three states, 44px controls, the bar above the bottom bar, nothing cut", async () => {
    const page = await phonePage(h, 390);
    await openStatus(page);
    const harbor = art(page, "Patient intake form");
    await harbor.locator('[data-state="suggested"]').waitFor({ timeout: 30_000 });
    await harbor.getByRole("button", { name: "Add", exact: true }).click();
    await page.locator("[data-foot-bar]").waitFor();
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".status-view :is(.st-show .ib4-chip, .st-adds .mini, .st-sugg .mini, .st-sugg .link-btn, .st-pending-line .link-btn, [data-foot-bar] .mini, .st-last-link)")]
        .filter((b) => b.getClientRects().length)
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.height < 44 || r.width < 44).length,
    );
    expect(small).toBe(0);
    const bar = (await page.locator("[data-foot-bar]").boundingBox())!;
    const bottomBar = await page.evaluate(() => document.querySelector(".bottom-bar, .phone-bar, nav.bb")?.getBoundingClientRect().top ?? innerHeight);
    expect(bar.y + bar.height).toBeLessThanOrEqual(bottomBar + 1);
    expect(bar.y).toBeGreaterThan(0);
    const m = await overflow(page);
    expect([m.page, m.view]).toEqual([0, 0]);
    expect(m.right).toBeLessThanOrEqual(0);
    expect(await harbor.locator('[data-state="ready"]').count()).toBe(1);
    await page.close();
  }, T);
});
