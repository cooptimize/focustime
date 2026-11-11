// CF-1: screenshots of the screens that lost Confirm and musts, on the demo (Monday Nov 2, 9:30 AM). Only when
// CF1_SHOTS names a folder (docs/ux/cf1 or docs/ux/cf1/before); nothing runs otherwise. 1440x900 light and dark, and
// the phone at 390x844.
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const DIR = process.env.CF1_SHOTS ?? null;
const T = 180_000;
const THEMES = ["light", "dark"] as const;

async function themed(page: Page, theme: (typeof THEMES)[number]) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t === "light" ? "cooptimize-light" : "cooptimize-dark"), theme);
  await page.waitForTimeout(200);
}
async function clearToday(page: Page) {
  await page.evaluate(async () => {
    const csrf = document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "";
    const post = (action: string, input: unknown) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": csrf }, body: JSON.stringify({ action, input }) }).then((r) => r.json());
    const st = await post("planday.start", { date: "2026-11-02" });
    for (const p of st.data.picks as { id: number; status: string }[]) if (p.status === "planned" || p.status === "done") await post("pick.remove", { id: p.id });
  });
  await page.reload();
}
const shot = (page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) => page.screenshot({ path: `${DIR}/${name}.png`, ...(clip ? { clip } : {}) });
async function boxOf(page: Page, sel: string, pad = 8) {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) return undefined;
  const v = page.viewportSize()!;
  const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
  return { x, y, width: Math.min(v.width - x, b.width + pad * 2), height: Math.min(v.height - y, b.height + pad * 2) };
}

describe.skipIf(!CHROMIUM || !DIR)("CF-1 screenshots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  for (const theme of THEMES) {
    it(`computer, ${theme}`, async () => {
      const { page } = await freshPage(h, { width: 1440, height: 900 });
      await themed(page, theme);
      // Week and its header.
      await page.keyboard.press("2");
      await page.locator(".week-head").first().waitFor();
      await page.waitForTimeout(400);
      await shot(page, `week-1440x900-${theme}`);
      await shot(page, `week-header-1440x900-${theme}`, await boxOf(page, ".week-head"));
      await shot(page, `statusbar-1440x900-${theme}`, await boxOf(page, "footer.statusbar", 0));
      // A client chip's popover.
      const chip = page.locator(".client-chips button.cc-chip:not(.cc-more)").first();
      if (await chip.count()) {
        await chip.click();
        await page.locator(".cc-pop").first().waitFor({ timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(200);
        await shot(page, `client-chip-popover-1440x900-${theme}`);
        await page.keyboard.press("Escape");
      }
      // The Add work panel on Monday afternoon.
      await page.locator('[data-drop="2026-11-02:PM"] .add-work.add-row').first().click();
      await page.locator("aside.add-work-panel").waitFor();
      await page.waitForTimeout(400);
      await shot(page, `add-work-1440x900-${theme}`);
      await page.keyboard.press("Escape");
      // Day in the morning (the demo has work on today).
      await page.keyboard.press("1");
      await page.waitForTimeout(600);
      await shot(page, `day-1440x900-${theme}`);
      // Day with nothing on today (after only: before CF-1 the card read "Today isn't planned yet").
      if (!DIR!.endsWith("before")) {
        await clearToday(page);
        await themed(page, theme);
        await page.locator(".today-view").waitFor();
        await page.waitForTimeout(600);
        await shot(page, `day-empty-1440x900-${theme}`);
      }
      await page.close();
    }, T);
  }

  for (const theme of THEMES) {
    it(`phone, ${theme}`, async () => {
      const { page } = await freshPage(h, { width: 390, height: 844 });
      await themed(page, theme);
      await page.waitForTimeout(600);
      await shot(page, `phone-day-${theme}`);
      await page.keyboard.press("2");
      await page.waitForTimeout(600);
      await shot(page, `phone-week-${theme}`);
      if (!DIR!.endsWith("before")) {
        await clearToday(page);
        await themed(page, theme);
        await page.keyboard.press("1");
        await page.waitForTimeout(800);
        await shot(page, `phone-day-empty-${theme}`);
      }
      await page.close();
    }, T);
  }
});
