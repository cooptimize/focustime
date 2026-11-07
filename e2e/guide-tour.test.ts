// UI-5: Start here and the "Plan your week" tour on the real Week › Plan screen (a demo session), at 1920, 1366 and
// phone width, with the keyboard only. The tour only highlights and explains: while it runs the page under it can't be
// clicked, no action runs that the screen doesn't run on its own, and the plan store is the same before and after.
// Reduced motion: no animation runs and the tour still completes. FOCUSTIME_SHOTS: screenshots and a frame per step.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";
import { START, TOUR_UI } from "../ui/guide/content.ts";
import { tourById } from "../ui/guide/tours.ts";

let h: Harness;
const T = 180_000;
const THEMES = { dark: "cooptimize-dark", light: "cooptimize-light" } as const;
const TOUR = tourById("plan-week")!;

/** Every action the page calls from now on (names only). */
function recordActions(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "GET") return;
    const url = new URL(r.url());
    if (url.pathname !== "/api/action") return seen.push(`${r.method()} ${url.pathname}`);
    try {
      seen.push((JSON.parse(r.postData() ?? "{}") as { action: string }).action);
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

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => (document.documentElement.dataset.theme = t), THEMES[theme]);
}

async function openStartHere(page: Page) {
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press("?");
  await page.locator("main.guide [data-section='start']").waitFor({ timeout: 15_000 });
  expect(await page.evaluate(() => location.hash)).toBe("#/guide");
}

/** Walks the tour with → only, checking each card; returns the titles it showed. */
async function walk(page: Page, frames: string | null): Promise<string[]> {
  const card = page.locator(".tour-card");
  await card.locator(".tour-count").waitFor({ timeout: 20_000 });
  const titles: string[] = [];
  for (let n = 0; n < 20; n++) {
    if (await card.locator(".tour-count").count()) {
      const title = (await card.locator(".tour-title").textContent())!;
      titles.push(title);
      // Focus is in the card, on the step's title (screen readers read it), and the live line says the step.
      await expect.poll(() => page.evaluate(() => { const a = document.activeElement; return a?.classList.contains("tour-title") ? "title" : `${a?.tagName}.${a?.className}`; }), title).toBe("title");
      await expect.poll(() => page.locator(".tour-layer [aria-live]").textContent()).toContain(title);
      const ring = page.locator(".tour-ring");
      if (await ring.count()) {
        // The ring sits on the step's element.
        const step = TOUR.steps.find((s) => s.title === title)!;
        await page.waitForTimeout(400);
        const [r, t] = await Promise.all([ring.boundingBox(), page.locator(`[data-tour="${step.target}"]`).first().boundingBox()]);
        expect(r && t && Math.abs(r.x + 6 - t.x) < 4 && Math.abs(r.width - 12 - t.width) < 4, title).toBe(true);
      } else expect(await card.locator(".ti-figure").count(), `${title}: an example in place of an empty ring`).toBe(1);
      if (frames) await page.screenshot({ path: `${frames}-${String(titles.length).padStart(2, "0")}.png` });
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(80);
    } else break;
  }
  await expect.poll(() => card.locator(".tour-title").textContent()).toBe(TOUR_UI.endTitle);
  if (frames) await page.screenshot({ path: `${frames}-${String(titles.length + 1).padStart(2, "0")}.png` });
  return titles;
}

describe.skipIf(!CHROMIUM)("UI-5: Start here and the Plan your week tour", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  for (const [name, viewport, phone] of [["1920", { width: 1920, height: 1080 }, false], ["1366", { width: 1366, height: 768 }, false], ["phone", { width: 390, height: 844 }, true]] as const)
    it(`runs end to end with the keyboard at ${name}, writes nothing and leaves the plan as it was`, { timeout: T }, async () => {
      // What Week › Plan calls on its own, without a tour (another demo session, same seed).
      const base = await freshPage(h, viewport);
      const baseline = recordActions(base.page);
      await base.page.evaluate(() => (location.hash = "#/week/commit"));
      await base.page.locator('[data-tour="pw-grid"], .planweek').first().waitFor({ timeout: 20_000 });
      await base.page.waitForTimeout(2500);
      await base.page.close();

      const { page, errors } = await freshPage(h, viewport);
      await openStartHere(page);
      const before = await snapshot(page);
      const calls = recordActions(page);
      // Keyboard only: focus Show me and press Enter.
      await page.getByRole("button", { name: `${START.showMe}: ${TOUR.title}` }).focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/guide/tour/plan-week");
      await page.locator(".planweek").waitFor({ timeout: 20_000 });

      // The page under the tour takes no click: Next client stays where it was.
      await page.locator(".tour-card .tour-count").waitFor({ timeout: 20_000 });
      const nextBtn = page.locator('[data-tour="pw-next"]').first();
      const nb = (await nextBtn.count()) ? await nextBtn.boundingBox() : null;
      const openBefore = await page.locator(".pw-open-card .pw-name").first().textContent().catch(() => null);
      // (Only where the tour's card isn't: a click on the card is the card's own.)
      const cb = await page.locator(".tour-card").boundingBox();
      const under = (b: NonNullable<typeof nb>) => !!cb && b.x + b.width / 2 >= cb.x && b.x + b.width / 2 <= cb.x + cb.width && b.y + b.height / 2 >= cb.y && b.y + b.height / 2 <= cb.y + cb.height;
      if (nb && !under(nb)) await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2);
      // A click anywhere on the dimmed page changes nothing and keeps focus in the card.
      await page.mouse.click(viewport.width / 2, 120);
      expect(await page.locator(".pw-open-card .pw-name").first().textContent().catch(() => null)).toBe(openBefore);
      // The screen's own keys don't fire under it either (J would open the next client).
      await page.keyboard.press("j");
      expect(await page.locator(".pw-open-card .pw-name").first().textContent().catch(() => null)).toBe(openBefore);

      const titles = await walk(page, SHOTS && name !== "1366" ? `${SHOTS}/ui5-tour-${name}` : null);
      const expected = TOUR.steps.filter((s) => !(phone && s.phone === "skip")).map((s) => s.title);
      expect(titles).toEqual(expected.filter((t) => titles.includes(t)));
      expect(titles.length).toBeGreaterThanOrEqual(phone ? 4 : 5);
      // ← goes back from the end, Esc ends it on the screen.
      await page.keyboard.press("ArrowLeft");
      await expect.poll(() => page.locator(".tour-card .tour-title").textContent()).toBe(titles.at(-1));
      await page.keyboard.press("Escape");
      await page.locator(".tour-layer").waitFor({ state: "detached" });
      expect(await page.evaluate(() => location.hash)).toMatch(/^#\/week\/commit/);

      // Nothing the screen doesn't call on its own, and the plan store is unchanged.
      const extra = [...new Set(calls)].filter((a) => !baseline.includes(a) && a !== "data.export_mine");
      expect(extra, "actions the tour added").toEqual([]);
      const after = await snapshot(page);
      if (before !== null) expect(after).toBe(before);
      expect(errors).toEqual([]);
    });

  it("reduced motion: no animation runs on Start here or in the tour, and the tour still completes", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openStartHere(page);
    const running = () => page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").map((a) => (a as CSSAnimation).animationName ?? "transition"));
    await page.waitForTimeout(300);
    expect(await running()).toEqual([]);
    // The proposal card shows its end state, still.
    expect(await page.locator(".gs-proposal.done").count()).toBe(1);
    await page.getByRole("button", { name: `${START.showMe}: ${TOUR.title}` }).focus();
    await page.keyboard.press("Enter");
    await page.locator(".tour-card .tour-count").waitFor({ timeout: 20_000 });
    expect(await page.locator(".tour-layer.still").count()).toBe(1);
    await page.keyboard.press("ArrowRight");
    expect(await running()).toEqual([]);
    await walk(page, null);
    expect(errors).toEqual([]);
  });

  it("#/guide/tour/<id> opens the tour directly; an unknown tour opens nothing", { timeout: T }, async () => {
    const { page } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/guide/tour/plan-week"));
    await page.locator(".tour-card .tour-count").waitFor({ timeout: 20_000 });
    expect(await page.locator(".planweek").count()).toBe(1);
    await page.keyboard.press("Escape");
    await page.evaluate(() => (location.hash = "#/guide/tour/nope"));
    await page.waitForTimeout(500);
    expect(await page.locator(".tour-layer").count()).toBe(0);
  });

  it.skipIf(!SHOTS)("screenshots: Start here at 1920 and phone, light and dark", { timeout: T }, async () => {
    for (const [w, hgt] of [[1920, 1080], [390, 844]] as const)
      for (const theme of ["light", "dark"] as const) {
        const { page } = await freshPage(h, { width: w, height: hgt });
        await setTheme(page, theme);
        await openStartHere(page);
        await page.waitForTimeout(1800);
        await page.screenshot({ path: `${SHOTS}/ui5-start-${w}-${theme}.png`, fullPage: false });
        await page.locator(".gs-promises").scrollIntoViewIfNeeded();
        await page.waitForTimeout(1400);
        await page.screenshot({ path: `${SHOTS}/ui5-start-${w}-${theme}-2.png` });
        // One tour step in this theme.
        await page.getByRole("button", { name: `${START.showMe}: ${TOUR.title}` }).click();
        await page.locator(".tour-card .tour-count").waitFor({ timeout: 20_000 });
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${SHOTS}/ui5-tour-step-${w}-${theme}.png` });
        await page.close();
      }
  });
});
