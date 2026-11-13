// UI-5: the rebuilt Guide in a browser, on ST-1's panel shell. Every section opens at 1920 and phone width, dark and
// light, with no page errors and no sideways scroll; old addresses land on their new section; search finds and opens;
// the try-its work, start over when you leave and call nothing on the server; Your first day shows states only (never
// a value) and says so in the demo; ? and the menus open it, and the sign-in page opens it signed out.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { FIRST_DAY, SEARCH, SECTIONS, SHORTCUTS, SIZING, TOUR, TRY } from "../ui/guide/content.ts";
import { sandbox } from "../ui/guide/sandbox.ts";
import { keysFor } from "../ui/guide/shortcuts.ts";

let h: Harness;
const T = 150_000;
const THEMES = { dark: "cooptimize-dark", light: "cooptimize-light" } as const;

/** No sideways scroll: not the page, not the Guide's body, and nothing in it wider than the window. */
const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => {
    const b = document.querySelector(".guide .ps-body") as HTMLElement | null;
    const wide = [...document.querySelectorAll(".guide .ps-body *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest(".sr-only")).map((e) => e.className).slice(0, 5);
    return { page: document.documentElement.scrollWidth <= innerWidth, body: !b || b.scrollWidth <= b.clientWidth + 1, wide };
  });

/** Every action the page calls from now on (names only). */
function recordActions(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "GET") return;
    const url = new URL(r.url());
    // The app's own timer asking whether a notification opened a view (a read, not the Guide's).
    if (url.pathname === "/api/open-request") return;
    if (url.pathname !== "/api/action") return void seen.push(`${r.method()} ${url.pathname}`);
    try {
      const action = (JSON.parse(r.postData() ?? "{}") as { action: string }).action;
      // RB-1: the app's own one read of Code's client names, a few seconds after start (a read on any screen).
      if (action !== "code.clients") seen.push(action);
    } catch {
      seen.push("unreadable");
    }
  });
  return seen;
}

async function openGuide(page: Page) {
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press("?");
  await page.locator("main.guide").waitFor({ timeout: 15_000 });
}

const go = async (page: Page, id: string) => {
  await page.evaluate((x) => (location.hash = `#/guide/${x}`), id);
  await page.locator(`main.guide .guide-body[data-section='${id}']`).waitFor({ timeout: 10_000 });
};

const cardKeys = (page: Page, label: string) => page.locator(`.guide-key[data-shortcut="${label}"] .guide-keys kbd`).allTextContents();

describe.skipIf(!CHROMIUM)("the Guide (UI-5)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  for (const [width, height] of [[1920, 1080], [390, 844]] as const)
    for (const theme of ["dark", "light"] as const)
      it(`every section at ${width} px, ${theme}: no page errors, no sideways scroll`, { timeout: T }, async () => {
        const { page, errors } = await freshPage(h, { width, height });
        await page.emulateMedia({ colorScheme: theme });
        await page.evaluate((t) => (document.documentElement.dataset.theme = t), THEMES[theme]);
        await openGuide(page);
        const guide = page.locator("main.guide");
        expect(await page.evaluate(() => location.hash)).toBe("#/guide");
        await guide.locator(".guide-body[data-section='start']").waitFor();
        if (width > 1000) {
          // The rail lists every section in order.
          expect(await guide.locator(".ps-rail .ps-item").allTextContents()).toEqual(SECTIONS.map((s) => s.name));
        } else {
          // Phone: the contents are their own page, and a section has Back to it.
          await page.evaluate(() => (location.hash = "#/guide/contents"));
          await expect.poll(() => guide.locator(".ps-rail .ps-item").count()).toBe(SECTIONS.length);
          await guide.locator(".ps-rail .ps-item").nth(2).click();
          await guide.locator(".guide-body[data-section='today']").waitFor();
          await guide.locator(".ps-back").click();
          await guide.locator(".ps-rail").waitFor();
        }
        for (const s of SECTIONS) {
          await go(page, s.id);
          expect(await guide.locator(".ps-head h2").textContent(), s.id).toBe(s.name);
          expect(await noSidewaysScroll(page), s.id).toEqual({ page: true, body: true, wide: [] });
        }
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(THEMES[theme]);
        expect(await guide.locator(".guide-footer").textContent()).toContain("⋯ › Send feedback");
        // Esc goes back to where you were; ? opens and closes it.
        await page.keyboard.press("Escape");
        await guide.waitFor({ state: "detached" });
        await page.keyboard.press("?");
        await guide.waitFor();
        await page.keyboard.press("?");
        await guide.waitFor({ state: "detached" });
        expect(errors).toEqual([]);
        await page.close();
      });

  it("old addresses land on their new section; an unknown one on Start here", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h);
    await openGuide(page);
    for (const [old, now] of [["basics", "start"], ["sizing", "week"], ["keys", "settings"], ["asks", "inbox"], ["questions", "first-day"], ["nope", "start"]] as const) {
      await page.evaluate((x) => (location.hash = `#/guide/${x}`), old);
      await page.locator(`main.guide .guide-body[data-section='${now}']`).waitFor({ timeout: 10_000 });
    }
    expect(errors).toEqual([]);
    await page.close();
  });

  it("search: finds as you type, Enter opens the first hit, a question opens unfolded; Esc clears", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h);
    await openGuide(page);
    const box = page.getByRole("searchbox", { name: SEARCH.label });
    await box.fill("stale");
    await page.locator(".gsr-hit").first().waitFor();
    expect(await page.locator(".gsr-hit .gsr-in").first().textContent()).toContain("Backlog");
    await box.press("Enter");
    await page.locator("main.guide .guide-body[data-section='ahead']").waitFor();
    await box.fill("chat images");
    await page.locator(".gsr-hit").first().waitFor();
    await box.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.locator(".guide-body details.guide-q[open]").count()).toBeGreaterThan(0);
    await box.fill("zzzz qqqq");
    await expect.poll(() => page.locator(".gsr-count").textContent()).toBe(SEARCH.none("zzzz qqqq"));
    await box.press("Escape");
    expect(await box.inputValue()).toBe("");
    expect(await page.locator("main.guide").count()).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("the try-its work, start over when you leave, and call nothing on the server", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h);
    await openGuide(page);
    await go(page, "week");
    await page.waitForTimeout(1500);
    const calls = recordActions(page);
    const drag = page.locator("[data-try='drag']");
    // Move to, by keyboard.
    await drag.getByRole("button", { name: TRY.drag.moveTo("Mon PM") }).first().focus();
    await page.keyboard.press("Enter");
    const mon = drag.locator(".try-block").first();
    await expect.poll(() => mon.locator(".try-todo").count()).toBe(1);
    expect(await mon.locator(".try-fit").textContent()).toBe(TRY.drag.fit(TRY.drag.todos[0]!.minutes, 180));
    // And by dragging: the L story onto Mon PM fills it (QT-1: no free time left, never amber).
    await drag.locator(".try-pool .try-todo", { hasText: "CSV column order" }).dragTo(mon);
    await expect.poll(() => mon.locator(".try-todo").count()).toBe(2);
    expect(await mon.locator(".try-fit").textContent()).toBe(TRY.drag.fit(360, 180));
    expect(await mon.locator(".try-fit.amber").count()).toBe(0);
    // Timeline: the toggle says its state.
    const tl = page.locator("[data-try='timeline'] [aria-pressed]");
    expect(await tl.getAttribute("aria-pressed")).toBe("true");
    await tl.click();
    expect(await tl.getAttribute("aria-pressed")).toBe("false");
    // Sizing: the words are the block panel's free time (QT-1).
    const fit = page.getByTestId("guide-fit");
    expect(await fit.textContent()).toBe(sandbox(SIZING.start, SIZING.block).fit.text);
    await page.locator('[data-add="L"]').click();
    expect(await fit.textContent()).toBe(sandbox([...SIZING.start, "L"], SIZING.block).fit.text);
    await page.locator('[data-add="unsized"]').click();
    expect(await page.locator(".stack button").last().textContent().then((t) => t?.trim())).toBe("Size? · 1h");
    // Leave and come back: everything starts over.
    await go(page, "today");
    await go(page, "week");
    expect(await page.locator("[data-try='drag'] .try-block .try-todo").count()).toBe(0);
    expect(await page.locator("[data-try='timeline'] [aria-pressed]").getAttribute("aria-pressed")).toBe("true");
    expect(await page.getByTestId("guide-fit").textContent()).toBe(sandbox(SIZING.start, SIZING.block).fit.text);

    // Inbox: a row opens the pane; its main button only says what would happen.
    await go(page, "inbox");
    const ib = page.locator("[data-try='inbox']");
    await ib.getByRole("option").nth(1).click();
    expect(await ib.getByRole("option").nth(1).getAttribute("aria-selected")).toBe("true");
    expect(await ib.locator(".try-pane-title").textContent()).toBe(TRY.inbox.items[1]!.title);
    await ib.locator(".try-pane .primary").click();
    await ib.locator(".try-pane .try-note").waitFor();

    // The assistant, scripted: a move proposal, Confirm, Done ✓ and Undo; Cancel changes nothing.
    await go(page, "assistant");
    const as = page.locator("[data-try='assistant']");
    await as.getByRole("textbox", { name: TRY.assistant.box }).fill("move the export stories to friday");
    await page.keyboard.press("Enter");
    await as.locator(".try-proposal").first().waitFor();
    expect(await as.locator(".try-proposal b").first().textContent()).toBe(TRY.assistant.answers.move.title);
    await as.getByRole("button", { name: TRY.assistant.confirm }).click();
    await as.locator(".try-done").waitFor();
    expect(await as.locator(".try-done .gs-tick").textContent()).toBe(TRY.assistant.done);
    await as.getByRole("button", { name: TRY.assistant.undo }).click();
    await as.getByRole("button", { name: TRY.assistant.confirm }).waitFor();
    await as.getByRole("button", { name: TRY.assistant.suggestions[2]! }).click();
    await expect.poll(() => as.locator(".try-proposal").count()).toBe(2);
    await as.getByRole("button", { name: TRY.assistant.cancel }).last().click();
    await as.getByText(TRY.assistant.cancelled).waitFor();
    await as.getByRole("button", { name: TRY.assistant.suggestions[0]! }).click();
    await as.getByText(TRY.assistant.answers.next.text).waitFor();

    expect(calls, "the try-its call the server").toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("Your first day: the demo says it isn't checked; a person's states show without a single value", { timeout: T }, async () => {
    const n = Object.keys(FIRST_DAY.checks).length;
    const { page, errors } = await freshPage(h);
    await openGuide(page);
    await go(page, "first-day");
    await expect.poll(() => page.locator(".gd-note").textContent()).toBe(FIRST_DAY.demo);
    expect(await page.locator(".gd-check[data-state='unknown']").count()).toBe(n);
    expect(await page.locator(".gd-check .ga-go").count()).toBe(n);

    // As a person: the endpoint answers ids and states only, and that's all the page shows.
    const other = await freshPage(h);
    const states = { hours: "done", clients: "skipped", calendars: "todo", devops: "done", notify: "todo", week: "todo", today: "done" } as const;
    await other.page.route("**/api/action", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as { action?: string };
      if (body.action !== "guide.checklist") return route.fallback();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { demo: false, checks: Object.entries(states).map(([id, state]) => ({ id, state })) } }) });
    });
    await openGuide(other.page);
    await go(other.page, "first-day");
    await expect.poll(() => other.page.locator(".gd-note").textContent()).toBe(FIRST_DAY.progress(3, n));
    for (const [id, st] of Object.entries(states)) expect(await other.page.locator(`.gd-check[data-check='${id}']`).getAttribute("data-state"), id).toBe(st);
    expect((await other.page.locator(".guide-body").textContent())!).not.toMatch(/PAT [A-Za-z0-9]{8,}|@example|Bearer/);
    expect([...errors, ...other.errors]).toEqual([]);
    await page.close();
    await other.page.close();
  });

  it("Settings, phone and keys: the shortcut cards draw keys.ts's keys", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h);
    await openGuide(page);
    await go(page, "settings");
    for (const c of SHORTCUTS.cards) expect(await cardKeys(page, c.label), c.label).toEqual(keysFor(c.keys, c.all).flatMap((k) => k.split(" ")));
    await page.locator(".guide-every summary").click();
    expect(await page.locator(".guide-every .key-list dt").count()).toBeGreaterThan(20);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("? does nothing while typing; the ⋯ menu and the command menu open the Guide, and a section by name", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("n");
    const box = page.locator("[data-overlay='modal'] input, [data-overlay='modal'] textarea").first();
    await box.waitFor();
    await box.press("?");
    expect(await box.inputValue()).toBe("?");
    expect(await page.locator("main.guide").count()).toBe(0);
    await page.keyboard.press("Escape");

    await page.locator(".top-more").click();
    await page.getByRole("menuitem", { name: /^Guide/ }).first().click();
    await page.locator("main.guide").waitFor();
    await page.keyboard.press("Escape");
    await page.locator("main.guide").waitFor({ state: "detached" });

    await page.keyboard.press("Control+k");
    await page.keyboard.type("your first day");
    await page.keyboard.press("Enter");
    await page.locator("main.guide .guide-body[data-section='first-day']").waitFor();
    expect(errors).toEqual([]);
    await page.close();
  });

  it("opens from the sign-in page, signed out, at phone width, with no Do it now links, and goes back to sign in", { timeout: T }, async () => {
    const page = await h.browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
    await page.goto(h.url);
    await page.getByRole("button", { name: TOUR.link }).click({ timeout: 60_000 });
    await page.locator("main.guide.standalone").waitFor();
    expect(await noSidewaysScroll(page)).toEqual({ page: true, body: true, wide: [] });
    await page.goto(`${h.url}#/guide/first-day`);
    await page.locator("main.guide.standalone .guide-body[data-section='first-day']").waitFor();
    expect(await page.locator(".gd-note").textContent()).toBe(FIRST_DAY.signedOut);
    expect(await page.locator(".ga-go").count()).toBe(0);
    await page.locator("main.guide .x-close").click();
    await page.getByRole("button", { name: /Sign in with Microsoft/ }).waitFor();
    expect(errors).toEqual([]);
    await page.close();
  });

  it("the tour link shows on a person's first Today once: not again after a reload", { timeout: T }, async () => {
    // Demo sessions never offer it. Here ui.tour_offer answers as a person's plan store does (one marker per person).
    const { page, errors } = await freshPage(h);
    let marked = false;
    await page.route("**/api/action", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as { action?: string; input?: { done?: boolean } };
      if (body.action !== "ui.tour_offer") return route.fallback();
      if (body.input?.done) marked = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { show: !marked } }) });
    });
    const link = page.locator(".today-tour").getByRole("button", { name: TOUR.link });
    await page.reload();
    await page.waitForSelector(".topbar");
    await link.click({ timeout: 30_000 });
    await page.locator("main.guide .guide-body[data-section='start']").waitFor();
    await page.keyboard.press("Escape");
    await page.reload();
    await page.waitForSelector(".topbar");
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await page.waitForTimeout(1500);
    expect(await link.count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });
});
