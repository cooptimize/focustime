// WK-2 screenshots on a throwaway demo server (e2e/harness.ts: fictional data, its own temp folder and port), the clock
// pinned to Friday Nov 6, 2026 10:00 AM ET (Friday is today and the catch-up day; Thursday is PTO). Friday gets working
// hours for the day (9:00 to 1:00), as on dev, so its column draws cards. Week's Board at 1896x1000, 1920x1080 and
// 1366x768, panel closed and open, timeline shown and hidden (where the build has the toggle), dark and light.
// Usage: node scripts/screenshot-wk2.ts <outDir> [WIDTHxHEIGHT,...]
import { mkdirSync } from "node:fs";
import type { Page } from "playwright-core";
import { startDemo } from "../e2e/harness.ts";

const out = process.argv[2] ?? "screenshots/wk2";
mkdirSync(out, { recursive: true });
const harness = await startDemo("chromium", {}, "2026-11-06T10:00:00-05:00");

const act = (page: Page, action: string, input: Record<string, unknown> = {}) =>
  page.evaluate(
    async ([action, input]) => {
      const csrf = document.cookie.split(";").map((p) => p.trim().split("=")).find(([k]) => k === "__Host-focustime-csrf")?.slice(1).join("=") ?? "";
      const r = await fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": csrf }, body: JSON.stringify({ action, input }) });
      const body = (await r.json()) as { ok: boolean; data?: unknown; error?: string };
      if (!body.ok) throw new Error(`${action}: ${body.error}`);
      return body.data;
    },
    [action, input] as const,
  );

const errors: string[] = [];
const sizes = process.argv[3] ? process.argv[3].split(",").map((x) => x.split("x").map(Number) as [number, number]) : ([[1896, 1000], [1920, 1080], [1366, 768]] as const);
try {
  for (const scheme of ["dark", "light"] as const) {
    for (const [width, height] of sizes) {
      const ctx = await harness.browser.newContext({ viewport: { width, height }, colorScheme: scheme, reducedMotion: "reduce", ignoreHTTPSErrors: true });
      await ctx.addInitScript(() => (localStorage.setItem("focustime.hint.flow", "dismissed"), localStorage.setItem("focustime.hint.picktime", "1")));
      const page = await ctx.newPage();
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(`${width} ${scheme}: ${e.message}`));
      await page.goto(harness.url);
      await page.getByText(/Try the demo/).click({ timeout: 60_000 });
      await page.waitForSelector(".demo-tag", { timeout: 60_000 });
      await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
      await act(page, "ui.set_theme", { theme: scheme === "dark" ? "cooptimize-dark" : "cooptimize-light" });
      // Friday with working hours, as on dev (idempotent: setting the same hours again is fine).
      await act(page, "hours.set_day", { date: "2026-11-06", segments: ["09:00-13:00"] }).catch((e: unknown) => errors.push(`hours: ${String(e)}`));
      for (const shown of [true, false]) {
        const toggled = await act(page, "ui.set_show_timelines", { show: shown }).then(() => true, () => false);
        if (!shown && !toggled) continue;
        await page.goto(`${harness.url.split("#")[0]}#/week`);
        await page.reload();
        await page.locator("main.grid").waitFor({ timeout: 30_000 });
        await page.waitForTimeout(900);
        const tag = `${width}-${shown ? "timeline" : "notimeline"}`;
        await page.screenshot({ path: `${out}/wk2-${tag}-${scheme}.png` });
        // The one-day view (under 1024) shows only Friday: no panel shot there.
        if (!(await page.locator('main.grid [data-drop="2026-11-02:AM"]').isVisible())) continue;
        await page.locator('main.grid [data-drop="2026-11-02:AM"]').click({ position: { x: 14, y: 12 } });
        await page.locator("aside.detail-panel").waitFor();
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${out}/wk2-${tag}-panel-${scheme}.png` });
      }
      await ctx.close();
    }
  }
} finally {
  await harness.stop();
}
if (errors.length) console.log(errors.join("\n"));
console.log(`screenshots in ${out}`);
