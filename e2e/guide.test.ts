// G1: the in-app Guide in a browser. It renders with no page errors at 1920 and 400 px wide, dark and light, with no
// sideways scroll; its shortcut cards are ui/keys.ts's and its sandbox says what plan/fit.ts says; it opens from ?,
// the ⋯ menu, the command menu and the sign-in page; and the tour link shows on a first Today once per person.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { CHAPTERS, SHORTCUTS, SIZING, TOUR } from "../ui/guide/content.ts";
import { sandbox } from "../ui/guide/sandbox.ts";
import { keysFor } from "../ui/guide/shortcuts.ts";

let h: Harness;
const T = 120_000;

const THEMES = { dark: "cooptimize-dark", light: "cooptimize-light" } as const;

/** No sideways scroll: not the page, not the Guide, and no chapter wider than the window. */
async function noSidewaysScroll(page: Page) {
  return page.evaluate(() => {
    const g = document.querySelector(".guide") as HTMLElement;
    const wide = [...document.querySelectorAll(".guide-ch, .guide-hero, .guide-top")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.className);
    return { page: document.documentElement.scrollWidth <= innerWidth, guide: g.scrollWidth <= g.clientWidth + 1, wide };
  });
}

/** The keys a shortcut card draws, as keys.ts spells them ("Ctrl K" from its two caps). */
const cardKeys = (page: Page, label: string) => page.locator(`.guide-key[data-shortcut="${label}"] .guide-keys kbd`).allTextContents();

describe.skipIf(!CHROMIUM)("the Guide (G1)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  for (const width of [1920, 400])
    for (const theme of ["dark", "light"] as const)
      it(`renders at ${width} px, ${theme}, with no page errors and no sideways scroll`, { timeout: T }, async () => {
        const { page, errors } = await freshPage(h, { width, height: width > 1000 ? 1080 : 860 });
        await page.emulateMedia({ colorScheme: theme });
        await page.evaluate((t) => (document.documentElement.dataset.theme = t), THEMES[theme]);
        await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
        await page.keyboard.press("?");
        const guide = page.locator("main.guide");
        await guide.waitFor({ timeout: 10_000 });
        expect(await page.evaluate(() => location.hash)).toBe("#/guide");
        await expect.poll(() => guide.locator(".guide-hero h1").textContent()).toContain("half-days");
        expect(await guide.locator("[data-chapter]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.chapter))).toEqual(CHAPTERS.map((c) => c.id));
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(THEMES[theme]);

        // Chapter 1: a card opens its detail.
        await guide.locator(".guide-concept").first().click();
        await expect.poll(() => guide.locator(".guide-concept").first().getAttribute("aria-expanded")).toBe("true");
        // Chapter 2: the stepper moves, by click and by arrow key.
        await guide.locator(".guide-panel .primary").click();
        await expect.poll(() => guide.locator(".guide-panel h3").textContent()).toBe("Plan the day");
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => guide.locator(".guide-panel h3").textContent()).toBe("Now");
        // Chapter 3: the sandbox's words are plan/fit.ts's.
        const fit = guide.getByTestId("guide-fit");
        expect(await fit.textContent()).toBe(sandbox(SIZING.start, SIZING.block).fit.text);
        await guide.locator('[data-add="L"]').click();
        expect(await fit.textContent()).toBe(sandbox([...SIZING.start, "L"], SIZING.block).fit.text);
        expect(await guide.getByTestId("guide-load").textContent()).toBe(SIZING.load(sandbox([...SIZING.start, "L"], SIZING.block).blocks));
        await guide.locator("[data-clear]").click();
        expect(await fit.textContent()).toBe(SIZING.empty);
        // Chapter 5: the cards draw keys.ts's keys.
        for (const c of SHORTCUTS.cards) expect(await cardKeys(page, c.label), c.label).toEqual(keysFor(c.keys, c.all).flatMap((k) => k.split(" ")));
        await guide.locator(".guide-every summary").click();
        expect(await guide.locator(".guide-every .key-list dt").count()).toBeGreaterThan(20);
        // Chapter 6 and the footer.
        await guide.locator(".guide-q summary").last().click();
        await guide.locator(".guide-footer .lumen, .guide-footer svg").first().waitFor();

        expect(await noSidewaysScroll(page)).toEqual({ page: true, guide: true, wide: [] });
        if (width === 400) await page.screenshot({ path: `${process.env.FOCUSTIME_SHOTS ?? "/tmp"}/guide-400-${theme}.png`, fullPage: false }).catch(() => {});

        // Esc goes back to where you were; ? again opens and closes it.
        await page.keyboard.press("Escape");
        await guide.waitFor({ state: "detached" });
        await page.keyboard.press("?");
        await guide.waitFor();
        await page.keyboard.press("?");
        await guide.waitFor({ state: "detached" });
        expect(errors).toEqual([]);
        await page.close();
      });

  it("? does nothing while typing; the ⋯ menu and the command menu open the Guide", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("n");
    const box = page.locator("[data-overlay='modal'] input, [data-overlay='modal'] textarea").first();
    await box.waitFor();
    await box.fill("");
    await box.press("?");
    expect(await box.inputValue()).toBe("?");
    expect(await page.locator("main.guide").count()).toBe(0);
    await page.keyboard.press("Escape");

    await page.locator(".top-more").click();
    await page.getByRole("menuitem", { name: /^Guide/ }).click();
    await page.locator("main.guide").waitFor();
    await page.locator(".guide-close").click();
    await page.locator("main.guide").waitFor({ state: "detached" });

    await page.keyboard.press("Control+k");
    await page.keyboard.type("guide");
    await page.keyboard.press("Enter");
    await page.locator("main.guide").waitFor();
    expect(errors).toEqual([]);
    await page.close();
  });

  it("opens from the sign-in page, signed out, at phone width, and goes back to sign in", { timeout: T }, async () => {
    const page = await h.browser.newPage({ viewport: { width: 400, height: 860 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
    await page.goto(h.url);
    await page.getByRole("button", { name: TOUR.link }).click({ timeout: 60_000 });
    await page.locator("main.guide.standalone").waitFor();
    expect(await page.evaluate(() => location.hash)).toBe("#/guide");
    expect(await noSidewaysScroll(page)).toEqual({ page: true, guide: true, wide: [] });
    await page.getByRole("button", { name: new RegExp(TOUR.signIn) }).click();
    await page.getByRole("button", { name: /Sign in with Microsoft/ }).waitFor();
    // An address to the Guide opens it signed out too.
    await page.goto(`${h.url}#/guide/keys`);
    await page.locator("main.guide.standalone").waitFor();
    expect(errors).toEqual([]);
    await page.close();
  });

  it("the tour link shows on a person's first Today once: not again after a reload, and again for someone else", { timeout: T }, async () => {
    // Demo sessions never offer the tour (their store is in memory). Here ui.tour_offer answers as a person's plan store
    // does (actions/ui-actions.test.ts checks the server side): one marker per person, so one per browser context.
    const asPerson = async (page: Page) => {
      let marked = false;
      const asks: string[] = [];
      await page.route("**/api/action", async (route) => {
        const body = JSON.parse(route.request().postData() ?? "{}") as { action?: string; input?: { done?: boolean } };
        if (body.action !== "ui.tour_offer") return route.fallback();
        asks.push(body.input?.done ? "done" : "ask");
        if (body.input?.done) marked = true;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { show: !marked } }) });
      });
      return asks;
    };
    const link = (page: Page) => page.locator(".today-tour").getByRole("button", { name: TOUR.link });

    const { page, errors } = await freshPage(h);
    const asks = await asPerson(page);
    await page.reload();
    await page.waitForSelector(".topbar");
    await link(page).waitFor({ timeout: 30_000 });
    await expect.poll(() => asks).toContain("done");
    // It stays for this visit (Week and back), and Not now hides it.
    await page.keyboard.press("2");
    await page.keyboard.press("1");
    await link(page).waitFor();
    await page.locator(".today-tour").getByRole("button", { name: TOUR.dismiss }).click();
    expect(await link(page).count()).toBe(0);
    // Never again for this person.
    await page.reload();
    await page.waitForSelector(".topbar");
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await page.waitForTimeout(1500);
    expect(await link(page).count()).toBe(0);
    expect(asks.filter((a) => a === "ask").length).toBeGreaterThanOrEqual(2);

    // Someone else: their first Today offers it, and the link opens the Guide.
    const other = await freshPage(h);
    await asPerson(other.page);
    await other.page.reload();
    await other.page.waitForSelector(".topbar");
    await link(other.page).click({ timeout: 30_000 });
    await other.page.locator("main.guide").waitFor();
    await other.page.keyboard.press("Escape");
    expect(await link(other.page).count()).toBe(0);
    expect([...errors, ...other.errors]).toEqual([]);
    await page.close();
    await other.page.close();
  });
});
