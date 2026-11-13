// UI-5: Start here and every tour on the real screens (a demo session), at 1920, 1366 and phone width, with the keyboard
// only. A tour only highlights and explains: while it runs the page under it takes no click or key, it calls no action
// its screens don't call on their own (a baseline visits the same screens without a tour), and the plan store is the
// same before and after. Reduced motion: no animation runs and a tour still completes. FOCUSTIME_SHOTS: a frame a step.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";
import { START, TOUR_UI } from "../ui/guide/content.ts";
import { TOURS, tourById, type Tour } from "../ui/guide/tours.ts";
import { hashOf } from "../ui/nav.ts";

let h: Harness;
const T = 240_000;
const THEMES = { dark: "cooptimize-dark", light: "cooptimize-light" } as const;
const VIEWPORTS = [["1920", { width: 1920, height: 1080 }, false], ["1366", { width: 1366, height: 768 }, false], ["phone", { width: 390, height: 844 }, true]] as const;

/** Every action the page calls from now on (names only). */
function recordActions(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "GET") return;
    const url = new URL(r.url());
    // The app's own timer asking whether a notification opened a view (a read on any screen).
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

/** The person's whole plan store as Export my data gives it (minus when it was made), or null where it isn't available. */
const snapshot = (page: Page) =>
  page.evaluate(async () => {
    const csrf = document.cookie.split("; ").find((c) => c.startsWith("__Host-focustime-csrf="))?.split("=")[1] ?? "";
    const r = await fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": csrf }, body: JSON.stringify({ action: "data.export_mine", input: {} }) });
    const b = (await r.json()) as { ok: boolean; data?: { export: Record<string, unknown> } };
    if (!b.ok || !b.data) return null;
    const { exportedAt: _, ...rest } = b.data.export as Record<string, unknown>;
    return JSON.stringify(rest);
  });

/** The screens a tour shows, in order (its start, then each step's own). */
const screensOf = (t: Tour) => [...new Set([t.start, ...t.steps.flatMap((s) => (s.at ? [s.at] : []))].map((nav) => hashOf({ nav, overlay: null })))];

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => (document.documentElement.dataset.theme = t), THEMES[theme]);
}

async function openStartHere(page: Page) {
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press("?");
  await page.locator("main.guide [data-section='start']").waitFor({ timeout: 15_000 });
}

/** Starts a tour with the keyboard: Start here's Show me for Plan your week, the command menu for the rest. */
async function startTour(page: Page, t: Tour) {
  if (t.id === "plan-week") {
    await openStartHere(page);
    await page.getByRole("button", { name: `${START.showMe}: ${t.title}` }).focus();
    await page.keyboard.press("Enter");
  } else {
    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.locator(".topbar").waitFor({ timeout: 30_000 });
    await page.keyboard.press("Control+k");
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest(".command-menu"))).toBe(true);
    await page.keyboard.type(`Show me: ${t.title}`);
    // The tour is the first row, so Enter runs it.
    await expect.poll(() => page.locator(".command-menu [role='menuitem']").first().textContent()).toContain(`Show me: ${t.title}`);
    await page.keyboard.press("Enter");
  }
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/guide/tour/${t.id}`);
  await page.locator(".tour-card .tour-count").waitFor({ timeout: 30_000 });
}

/** Walks the tour with → only, checking each card; returns the titles it showed. */
async function walk(page: Page, t: Tour, frames: string | null): Promise<string[]> {
  const card = page.locator(".tour-card");
  const titles: string[] = [];
  for (let n = 0; n < 20; n++) {
    await expect.poll(async () => (await card.locator(".tour-count").count()) + (await card.locator(".tour-title", { hasText: TOUR_UI.endTitle }).count()), { timeout: 20_000 }).toBeGreaterThan(0);
    if (!(await card.locator(".tour-count").count())) break;
    const title = (await card.locator(".tour-title").textContent())!;
    titles.push(title);
    // Focus is in the card, on the step's title, and the live line says the step.
    await expect.poll(() => page.evaluate(() => { const a = document.activeElement; return a?.classList.contains("tour-title") ? "title" : `${a?.tagName}.${a?.className}`; }), { message: title }).toBe("title");
    await expect.poll(() => page.locator(".tour-layer [aria-live]").textContent()).toContain(title);
    const step = t.steps.find((s) => s.title === title)!;
    expect(step, title).toBeDefined();
    const ring = page.locator(".tour-ring");
    if (await ring.count()) {
      // The ring sits on the step's element.
      await page.waitForTimeout(400);
      const [r, el] = await Promise.all([ring.boundingBox(), page.locator(`[data-tour="${step.target}"]`).first().boundingBox()]);
      expect(r && el && Math.abs(r.x + 6 - el.x) < 4 && Math.abs(r.width - 12 - el.width) < 4, `${t.id}: ${title}`).toBe(true);
    } else expect(await card.locator(".ti-figure").count(), `${t.id}: ${title}: an example in place of an empty ring`).toBe(1);
    if (frames) await page.screenshot({ path: `${frames}-${String(titles.length).padStart(2, "0")}.png` });
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(80);
  }
  await expect.poll(() => card.locator(".tour-title").textContent()).toBe(TOUR_UI.endTitle);
  if (frames) await page.screenshot({ path: `${frames}-${String(titles.length + 1).padStart(2, "0")}.png` });
  return titles;
}

describe.skipIf(!CHROMIUM)("UI-5: Start here and the tours", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  for (const t of TOURS)
    for (const [name, viewport, phone] of VIEWPORTS)
      it(`${t.title}: end to end with the keyboard at ${name}, writes nothing and leaves the plan as it was`, { timeout: T }, async () => {
        // What the tour's screens call on their own, without a tour (another demo session, same seed).
        const base = await freshPage(h, viewport);
        const baseline = recordActions(base.page);
        for (const hash of screensOf(t)) {
          await base.page.evaluate((x) => (location.hash = x), hash);
          // MB-1: on the phone Ahead asks first; a tour shows it read only, as Open anyway does.
          const anyway = base.page.getByRole("button", { name: "Open anyway" });
          if (phone && (await anyway.waitFor({ state: "visible", timeout: 1500 }).then(() => true, () => false))) await anyway.click();
          await base.page.waitForTimeout(2500);
        }
        await base.page.close();

        const { page, errors } = await freshPage(h, viewport);
        const before = await snapshot(page);
        const calls = recordActions(page);
        await startTour(page, t);

        // The page under the tour takes no click and no key of its own.
        const hashBefore = await page.evaluate(() => location.hash);
        const cb = await page.locator(".tour-card").boundingBox();
        const x = cb && cb.x > viewport.width / 2 ? 40 : viewport.width - 40;
        await page.mouse.click(x, Math.min(200, viewport.height / 3));
        await page.keyboard.press("j");
        await page.keyboard.press("2");
        expect(await page.evaluate(() => location.hash)).toBe(hashBefore);
        await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest(".tour-card"))).toBe(true);

        const titles = await walk(page, t, SHOTS && name !== "1366" ? `${SHOTS}/ui5-tour-${t.id}-${name}` : null);
        const expected = t.steps.filter((s) => !(phone && s.phone === "skip")).map((s) => s.title);
        // Every step shown is one of the tour's, in order; a step whose hook isn't on this screen is skipped.
        expect(titles).toEqual(expected.filter((x) => titles.includes(x)));
        expect(titles.length, t.id).toBeGreaterThanOrEqual(Math.min(4, expected.length) - (phone ? 1 : 0));
        // ← goes back from the end, Esc ends it on the screen.
        await page.keyboard.press("ArrowLeft");
        await expect.poll(() => page.locator(".tour-card .tour-title").textContent()).toBe(titles.at(-1));
        await page.keyboard.press("Escape");
        await page.locator(".tour-layer").waitFor({ state: "detached" });
        expect(await page.evaluate(() => location.hash)).not.toMatch(/^#\/guide\/tour/);

        // Nothing the screens don't call on their own, and the plan store is unchanged.
        const extra = [...new Set(calls)].filter((a) => !baseline.includes(a) && a !== "data.export_mine");
        expect(extra, "actions the tour added").toEqual([]);
        const after = await snapshot(page);
        if (before !== null) expect(after).toBe(before);
        expect(errors).toEqual([]);
        await page.close();
      });

  it("reduced motion: no animation runs on Start here or in a tour, and the tour still completes", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openStartHere(page);
    const running = () => page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").map((a) => (a as CSSAnimation).animationName ?? "transition"));
    await page.waitForTimeout(300);
    expect(await running()).toEqual([]);
    expect(await page.locator(".gs-proposal.done").count()).toBe(1);
    // Today's urgent strip shows its end state, still.
    await page.evaluate(() => (location.hash = "#/guide/today"));
    await page.locator(".guide-body[data-section='today']").waitFor();
    await page.waitForTimeout(300);
    expect(await running()).toEqual([]);
    const tour = tourById("board")!;
    await startTour(page, tour);
    expect(await page.locator(".tour-layer.still").count()).toBe(1);
    await page.keyboard.press("ArrowRight");
    expect(await running()).toEqual([]);
    await walk(page, tour, null);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("#/guide/tour/<id> opens each tour directly; an unknown tour opens nothing", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h);
    for (const t of TOURS) {
      await page.evaluate((x) => (location.hash = `#/guide/tour/${x}`), t.id);
      await page.locator(".tour-card .tour-count").waitFor({ timeout: 30_000 });
      await page.keyboard.press("Escape");
      await page.locator(".tour-layer").waitFor({ state: "detached" });
    }
    await page.evaluate(() => (location.hash = "#/guide/tour/nope"));
    await page.waitForTimeout(500);
    expect(await page.locator(".tour-layer").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });

  it.skipIf(!SHOTS)("screenshots: Start here and the Guide's sections at 1920, Larger text and phone, light and dark", { timeout: T * 2 }, async () => {
    for (const [w, hgt] of [[1920, 1080], [390, 844]] as const)
      for (const theme of ["light", "dark"] as const) {
        const { page } = await freshPage(h, { width: w, height: hgt });
        await setTheme(page, theme);
        await openStartHere(page);
        await page.waitForTimeout(1800);
        await page.screenshot({ path: `${SHOTS}/ui5-start-${w}-${theme}.png` });
        for (const s of ["first-day", "today", "week", "inbox", "assistant", "renamed"]) {
          await page.evaluate((x) => (location.hash = `#/guide/${x}`), s);
          await page.locator(`.guide-body[data-section='${s}']`).waitFor();
          await page.waitForTimeout(900);
          await page.screenshot({ path: `${SHOTS}/ui5-${s}-${w}-${theme}.png` });
        }
        await page.close();
      }
    // The largest Text size at 1920.
    const { page } = await freshPage(h, { width: 1920, height: 1080 });
    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press("Control+Equal");
    await page.keyboard.press("Control+Equal");
    await openStartHere(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/ui5-start-1920-larger.png` });
    for (const s of ["first-day", "week", "inbox"]) {
      await page.evaluate((x) => (location.hash = `#/guide/${x}`), s);
      await page.locator(`.guide-body[data-section='${s}']`).waitFor();
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${SHOTS}/ui5-${s}-1920-larger.png` });
    }
    await page.close();
  });
});
