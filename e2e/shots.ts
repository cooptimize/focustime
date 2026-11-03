// S1: screenshots at 1920 and at the largest Text size (Larger), when FOCUSTIME_SHOTS names a folder. Nothing otherwise.
import type { Page } from "playwright-core";

export const SHOTS = process.env.FOCUSTIME_SHOTS ?? null;

/** <name>.png at the page's size, then <name>-larger.png with Text size Larger (set the way the app sets it). */
export async function shotBoth(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  const was = await page.evaluate(() => document.documentElement.getAttribute("data-text-size"));
  await page.evaluate(() => document.documentElement.setAttribute("data-text-size", "larger"));
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}/${name}-larger.png` });
  await page.evaluate((w) => (w ? document.documentElement.setAttribute("data-text-size", w) : document.documentElement.removeAttribute("data-text-size")), was);
  await page.waitForTimeout(100);
}
