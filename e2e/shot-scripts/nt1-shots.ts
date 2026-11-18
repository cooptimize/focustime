// NT-1: the before and after screenshots of Settings › Notifications › Quiet hours, with the Days off field. One script
// for both so the pairs match. Only when NT1_SHOTS names a folder (screenshots/nt1/before or screenshots/nt1/after);
// nothing runs otherwise. Demo data only. Dark at 1920 by 1080 at Default and Larger text, 390 by 844, and one in light.
//   NT1_SHOTS=screenshots/nt1/after npm run shots -- e2e/shot-scripts/nt1-shots.ts
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, NOW, startDemo, type Harness } from "../harness.ts";

const DIR = process.env.NT1_SHOTS ?? null;
const T = 900_000;
const missed: string[] = [];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: unknown; error?: string }>;

describe.skipIf(!CHROMIUM || !DIR)("NT-1 screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    (await import("node:fs")).writeFileSync(`${DIR!.replace(/\/+$/, "")}.notes.txt`, missed.map((m) => `missed: ${m}`).join("\n"));
    for (const h of started) await h.stop();
  });

  it("Settings › Notifications › Quiet hours", async () => {
    const h = await startDemo();
    started.push(h);
    const shoot = async (name: string, width: number, height: number, o: { theme?: string; size?: string } = {}) => {
      try {
        const { page } = await freshPage(h, { width, height });
        await page.clock.install({ time: Temporal.Instant.from(NOW).add({ minutes: 4 }).epochMilliseconds });
        await page.goto(`${h.url}/`);
        await page.locator(".demo-tag").waitFor({ timeout: 30_000 });
        await call(page, "ui.set_theme", { theme: o.theme ?? "cooptimize-dark" });
        await call(page, "ui.set_text_size", { size: o.size ?? "default" });
        await page.reload();
        await page.locator(".demo-tag").waitFor({ timeout: 30_000 });
        await page.evaluate(() => (location.hash = "#/settings/notifications"));
        const field = page.locator('[data-setting="quiet-pto"]');
        await field.waitFor({ timeout: 30_000 });
        await page.waitForTimeout(600);
        // The Quiet hours group, its top under the header: what a person sees there.
        const group = field.locator("xpath=ancestor::*[contains(@class,'set-group') or self::section][1]");
        const target = (await group.count()) ? group : field;
        await target.evaluate((el) => el.scrollIntoView({ block: "start" }));
        await page.waitForTimeout(200);
        const b = await target.boundingBox();
        const vp = page.viewportSize()!;
        const clip = b ? { x: 0, y: Math.max(0, b.y - 60), width: vp.width, height: Math.min(vp.height - Math.max(0, b.y - 60), b.height + 120) } : undefined;
        await page.screenshot({ path: `${DIR}/${name}.png`, ...(clip ? { clip } : {}) });
      } catch (e) {
        missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
      }
    };
    await shoot("1-quiet-hours-1920", 1920, 1080);
    await shoot("2-quiet-hours-1920-larger", 1920, 1080, { size: "larger" });
    await shoot("3-quiet-hours-phone", 390, 844);
    await shoot("4-quiet-hours-light", 1920, 1080, { theme: "cooptimize-light" });
  }, T);
});
