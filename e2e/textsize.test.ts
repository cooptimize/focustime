// U5: the type scale app-wide, the text size setting and the Inbox prune (browser, demo mode, clock pinned to Mon Nov 2,
// 9:30 AM). Behavior only: every visible text on Roadmap, Plan ahead, Inbox, each Settings section, the sign-in
// screen, the focus screen and each dialog sits on one of the four steps of the active base at 400, 500 or 600, with
// uppercase only for section labels; Settings > Display and Ctrl+plus / Ctrl+minus / Ctrl+0 change every screen and
// survive a restart, not while typing; an Inbox row has one primary action and no "New today" or "Added by me".
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, sameSession, startDemo, type Harness } from "./harness.ts";
import { SECTIONS as SETTINGS_SECTIONS } from "../ui/settings/registry.ts";
const SECTION_IDS = SETTINGS_SECTIONS.map((s) => s.id);

let h: Harness;
const T = 120_000;
const MON = "2026-11-02";
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const go = async (page: Page, hash: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(1000);
};
// ST-1: every section in the registry, besides Clients' sub-page (its own address per client).
const SECTIONS = SECTION_IDS.filter((s) => s !== "client");

/** Every visible text off the scale of the active base (base − 2, − 1, base, + 2 px; 400, 500, 600), and uppercase text
 *  that isn't a section label (the smallest step at 600). The focus countdown is the one display size; the brand
 *  module, avatars' initials, icons and key caps are not text styles. */
const offScale = (page: Page) =>
  page.evaluate(() => {
    const base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--text-base"));
    const sizes = new Set([base - 2, base - 1, base, base + 2].map((n) => `${n}px`));
    const weights = new Set(["400", "500", "600"]);
    const out: string[] = [];
    for (const e of document.querySelectorAll("body *")) {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0) || !e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      if (e.closest(".brand-stage, svg, kbd, .focus-count, .avatar-initials, [class^='brand-'], [class*=' brand-'], .lumen")) continue;
      if (![...e.childNodes].some((x) => x.nodeType === 3 && (x.textContent ?? "").trim())) continue;
      const cs = getComputedStyle(e);
      const what = `${cs.fontSize}/${cs.fontWeight} ${e.tagName.toLowerCase()}.${e.className} "${(e.textContent ?? "").trim().slice(0, 24)}"`;
      if (!sizes.has(cs.fontSize) || !weights.has(cs.fontWeight)) out.push(what);
      else if (cs.textTransform === "uppercase" && !(cs.fontSize === `${base - 2}px` && cs.fontWeight === "600")) out.push(`uppercase ${what}`);
    }
    return { base, out };
  });

const fontOf = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));

async function seed(page: Page): Promise<void> {
  for (const x of [{ itemId: 4411, size: "M" }, { itemId: 4412, size: "S" }]) await call(page, "pick.add", { date: MON, half: "AM", clientKey: "Cooptimize", ...x });
  await call(page, "draft.add_story", { clientKey: "Cooptimize", parentItemId: null, title: "Filter presets for the export", size: "M" });
  await call(page, "planday.commit", { date: MON });
  await page.reload();
  await page.waitForSelector(".topbar");
}

describe.skipIf(!CHROMIUM)("app-wide type scale and text size (U5)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Roadmap, Plan ahead, Inbox, every Settings section, the focus screen and each dialog are on the scale, at Default and Larger", async () => {
    for (const size of ["default", "larger"] as const) {
      const { page, errors } = await freshPage(h);
      await seed(page);
      if (size !== "default") {
        expect((await call(page, "ui.set_text_size", { size })).ok).toBe(true);
        await page.reload();
        await page.waitForSelector(".topbar");
      }
      const check = async (where: string) => {
        const r = await offScale(page);
        expect(r.base, where).toBe(size === "default" ? 13 : 17);
        expect(r.out, where).toEqual([]);
      };
      await go(page, "#/ahead");
      await page.locator(".ah-row").first().waitFor({ timeout: 30_000 });
      await check("Ahead › Grid");
      await go(page, "#/ahead/gantt");
      await page.locator(".pa-item").first().waitFor({ timeout: 30_000 });
      await check("Ahead › Gantt");
      await go(page, "#/ahead/fix");
      await page.locator(".ah-fx-row").first().waitFor({ timeout: 30_000 });
      await check("Ahead › Readiness");
      await go(page, "#/inbox/promises");
      await page.locator(".ib-row").first().waitFor();
      await check("Inbox");
      for (const s of SECTIONS) {
        await go(page, `#/settings/${s}`);
        await page.locator(".settings").waitFor();
        await check(`Settings ${s}`);
      }
      await go(page, "#/focus");
      await page.locator(".focus-screen").waitFor();
      await check("focus screen");
      await go(page, "#/today");
      // Dialogs: Capture, the VM's write preview, the Timebox… dialog and the draft editor.
      await page.keyboard.press("n");
      await page.locator(".cap-dialog").waitFor();
      await check("Capture");
      await page.keyboard.press("Escape");
      await page.locator(".vm-chip").click();
      await page.getByRole("menuitem", { name: /^Start/ }).click();
      await page.locator(".vm-preview").waitFor();
      await check("VM preview");
      await page.locator(".vm-preview").getByRole("button", { name: "Cancel" }).click();
      await go(page, `#/today/plan/${MON}/AM`);
      await page.locator(".pd2-left .pick-row").nth(1).hover();
      await page.locator(".pd2-left .pick-row").nth(1).getByRole("button", { name: /\+ time/ }).click();
      await page.getByRole("menuitem", { name: /Custom/ }).click();
      await page.locator("[role=dialog]").waitFor();
      await check("Timebox…");
      await page.locator("[role=dialog]").getByRole("button", { name: "Cancel" }).click();
      await go(page, "#/inbox/captures");
      await page.locator(".ib-row", { hasText: "Filter presets" }).first().click();
      await page.locator(".ib-pane").getByRole("button", { name: "Edit draft" }).click();
      await page.locator(".draft-editor").waitFor();
      await check("draft editor");
      expect(errors).toEqual([]);
      if (size !== "default") await call(page, "ui.set_text_size", { size: "default" });
      await page.close();
    }
  }, 3 * T);

  it("the sign-in screen is on the scale", async () => {
    const ctx = await h.browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.goto(h.url);
    await page.locator(".signin-page").waitFor({ timeout: 60_000 });
    expect((await offScale(page)).out).toEqual([]);
    await ctx.close();
  }, T);

  it("Settings > Display Text size changes every screen at once and survives a restart; Default puts it back", async () => {
    const { page, errors } = await freshPage(h);
    await go(page, "#/settings/display");
    const before = await fontOf(page, ".settings .set-hint");
    await page.getByRole("radio", { name: "Larger" }).check();
    await expect.poll(() => fontOf(page, ".settings .set-hint")).toBe(before + 4);
    for (const [hash, sel] of [["#/today", ".today-block"], ["#/week/2026-11-02", ".half.card .card-client"], ["#/week/plan/2026-11-09", ".pw-card-head"], ["#/ahead", ".ah-col-item"], ["#/inbox/promises", ".ib-row-title"]] as const) {
      await go(page, hash);
      await page.locator(sel).first().waitFor({ timeout: 30_000 });
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--text-base").trim()), hash).toBe("17px");
    }
    // A new window with nothing stored locally: the size comes from config.
    const ctx = await sameSession(h, page);
    const fresh = await ctx.newPage();
    await fresh.goto(h.url);
    await fresh.waitForSelector(".topbar", { timeout: 60_000 });
    await expect.poll(() => fresh.evaluate(() => document.documentElement.getAttribute("data-text-size"))).toBe("larger");
    await ctx.close();
    await go(page, "#/settings/display");
    await page.getByRole("radio", { name: "Default" }).check();
    await expect.poll(() => fontOf(page, ".settings .set-hint")).toBe(before);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Ctrl+plus steps up and stops at Larger, Ctrl+minus steps down, Ctrl+0 goes back to Default; nothing while typing", async () => {
    const { page, errors } = await freshPage(h);
    const attr = () => page.evaluate(() => document.documentElement.getAttribute("data-text-size"));
    await page.locator("body").click({ position: { x: 5, y: 600 } });
    await page.keyboard.press("Control+=");
    await expect.poll(attr).toBe("large");
    await page.keyboard.press("Control+=");
    await expect.poll(attr).toBe("larger");
    await page.keyboard.press("Control+=");
    await page.waitForTimeout(300);
    expect(await attr()).toBe("larger");
    await page.keyboard.press("Control+-");
    await expect.poll(attr).toBe("large");
    await page.keyboard.press("Control+0");
    await expect.poll(attr).toBe(null);
    // In a text field the keys are left alone.
    await go(page, "#/inbox/captures");
    await page.locator(".ib-capture textarea").first().focus();
    await page.keyboard.press("Control+=");
    await page.waitForTimeout(400);
    expect(await attr()).toBe(null);
    expect((await call(page, "week.load", { weekStart: MON })).data?.ui?.textSize ?? "default").toBe("default");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Inbox (IB-1): one primary action for the open item; rows carry one tag; a capture's Sort shows the kind chips", async () => {
    const { page, errors } = await freshPage(h);
    await go(page, "#/inbox/promises");
    await page.locator(".ib-row").first().waitFor();
    const rows = await page.locator(".ib-row").evaluateAll((rs) => rs.map((r) => r.querySelectorAll(".ib-tag").length));
    expect(rows.length).toBeGreaterThan(1);
    for (const n of rows) expect(n).toBeLessThanOrEqual(1);
    await page.locator(".ib-row").first().click();
    await expect(page.locator(".ib-pane .ib-acts .ib-act.primary").count()).resolves.toBe(1);
    const text = (await page.locator("main.ib").textContent()) ?? "";
    expect(text).not.toMatch(/new today|added by me/i);
    // A capture: Sort opens the kind chips.
    await go(page, "#/inbox/captures");
    await page.locator(".ib-row", { has: page.locator(".ib-tag", { hasText: "To sort" }) }).first().click();
    await page.locator(".ib-pane").getByRole("button", { name: "Sort" }).click();
    await expect(page.locator(".ib-pane .cap-sort [role=radio]").count()).resolves.toBe(4);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
