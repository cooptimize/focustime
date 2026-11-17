// PK-2: the before and after screenshots of Settings › Accounts and calendars › Pocket recorder, one script for both so
// the pairs match. Only when PK2_SHOTS names a folder (screenshots/pk2/before or screenshots/pk2/after); nothing runs
// otherwise. Demo data only (the pretend Pocket). Dark at 1440 by 900 and 390 by 844, plus one in light. On main the
// section doesn't exist: those shots are named in the notes and skipped, and 1 and 2 show the whole section instead.
//   PK2_SHOTS=screenshots/pk2/after npm run shots -- e2e/shot-scripts/pk2-shots.ts
import { afterAll, describe, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, NOW, startDemo, type Harness } from "../harness.ts";

const DIR = process.env.PK2_SHOTS ?? null;
const T = 900_000;
const missed: string[] = [];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: unknown; error?: string }>;

async function shot(page: Page, name: string, run: () => Promise<Locator | null>) {
  try {
    const target = await run();
    await page.waitForTimeout(400);
    if (target) {
      await target.scrollIntoViewIfNeeded();
      const b = await target.boundingBox();
      const vp = page.viewportSize()!;
      // The section with a margin, inside the window: what a person sees there.
      const clip = b ? { x: 0, y: Math.max(0, b.y - 60), width: vp.width, height: Math.min(vp.height, b.height + 120) } : undefined;
      await page.screenshot({ path: `${DIR}/${name}.png`, ...(clip ? { clip } : {}) });
    } else await page.screenshot({ path: `${DIR}/${name}.png` });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
}

describe.skipIf(!CHROMIUM || !DIR)("PK-2 screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    (await import("node:fs")).writeFileSync(`${DIR!.replace(/\/+$/, "")}.notes.txt`, missed.map((m) => `missed: ${m}`).join("\n"));
    for (const h of started) await h.stop();
  });

  it("the section: guide, connected, each failure, Disconnect's question", async () => {
    const h = await startDemo();
    started.push(h);
    const open = async (width: number, height: number, theme = "cooptimize-dark") => {
      const { page } = await freshPage(h, { width, height });
      await page.clock.install({ time: Temporal.Instant.from(NOW).add({ minutes: 4 }).epochMilliseconds });
      await page.goto(`${h.url}/`);
      await page.locator(".demo-tag").waitFor({ timeout: 30_000 });
      await call(page, "ui.set_theme", { theme });
      await call(page, "pocket.disconnect", {});
      await page.reload();
      await page.locator(".demo-tag").waitFor({ timeout: 30_000 });
      await page.evaluate(() => (location.hash = "#/settings/connections"));
      await page.locator('[data-setting="sources"], .set-section').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(800);
      return page;
    };
    const section = (page: Page) => page.locator('[data-setting="pocket"]');
    const tryKey = async (page: Page, key: string) => {
      const s = section(page);
      await s.getByLabel("Your Pocket key").fill(key);
      await s.getByRole("button", { name: "Check and save" }).click();
      await s.locator('[role="alert"], .pocket-state').first().waitFor({ timeout: 15_000 });
      return s;
    };

    for (const [w, hgt, tag] of [[1440, 900, "1440"], [390, 844, "390"]] as const) {
      const page = await open(w, hgt);
      // 1: the page as it opens (main: the section as it is today).
      await shot(page, `1-${tag}-accounts-and-calendars`, async () => null);
      // 2: the guide.
      await shot(page, `2-${tag}-guide`, async () => section(page).waitFor({ timeout: 5000 }).then(() => section(page)));
      // 3 to 6: each failure.
      for (const [n, key, name] of [[3, "pk_demo_wrong", "not-accepted"], [4, "pk_demo_slow", "no-answer"], [5, "pk_demo_busy", "busy"], [6, "pk_demo_odd", "unexpected"]] as const)
        await shot(page, `${n}-${tag}-failed-${name}`, () => tryKey(page, key));
      // 7: connected.
      await shot(page, `7-${tag}-connected`, () => tryKey(page, "pk_demo_teammate_key_0001"));
      // 8: Use a new key.
      await shot(page, `8-${tag}-use-a-new-key`, async () => {
        await section(page).getByRole("button", { name: "Use a new key" }).click();
        return section(page);
      });
      // 9: Disconnect's question.
      await shot(page, `9-${tag}-disconnect-question`, async () => {
        await section(page).getByRole("button", { name: "Cancel" }).click();
        await section(page).getByRole("button", { name: "Disconnect" }).click();
        await section(page).getByRole("group", { name: "Disconnect" }).waitFor({ timeout: 5000 });
        return section(page);
      });
      // 10: disconnected, back to the guide.
      await shot(page, `10-${tag}-disconnected`, async () => {
        await section(page).getByRole("group", { name: "Disconnect" }).getByRole("button", { name: "Disconnect" }).click();
        await section(page).locator(".pocket-steps").waitFor({ timeout: 5000 });
        return section(page);
      });
      await page.close();
    }
    // 11: light, connected, at 1440.
    {
      const page = await open(1440, 900, "cooptimize-light");
      await shot(page, "11-1440-light-guide", async () => section(page).waitFor({ timeout: 5000 }).then(() => section(page)));
      await shot(page, "12-1440-light-connected", () => tryKey(page, "pk_demo_teammate_key_0001"));
      await call(page, "pocket.disconnect", {});
    }
  }, T);
});
