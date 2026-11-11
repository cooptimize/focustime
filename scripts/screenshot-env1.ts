// ENV-1 screenshots on a throwaway demo server (e2e/harness.ts: fictional data, its own temp folder and port). The demo
// server isn't production, so Settings › Notifications shows "This test site" with its switch, and Admin › Clients ›
// Meetings shows Check now on an Automatic call (the demo's call is switched to Automatic first). At 1920, Default and Larger text, dark and light.
// Usage: node scripts/screenshot-env1.ts <outDir>
import { mkdirSync } from "node:fs";
import type { Page } from "playwright-core";
import { startDemo } from "../e2e/harness.ts";

const out = process.argv[2] ?? "screenshots/env1";
mkdirSync(out, { recursive: true });
const harness = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");

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
try {
  for (const size of ["default", "larger"] as const) {
    for (const scheme of ["dark", "light"] as const) {
      const ctx = await harness.browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: scheme, reducedMotion: "reduce", ignoreHTTPSErrors: true });
      await ctx.addInitScript(() => localStorage.setItem("focustime.hint.flow", "dismissed"));
      const page = await ctx.newPage();
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(`${size} ${scheme}: ${e.message}`));
      await page.goto(harness.url);
      await page.getByText(/Try the demo/).click({ timeout: 60_000 });
      await page.waitForSelector(".demo-tag", { timeout: 60_000 });
      await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
      await act(page, "ui.set_theme", { theme: scheme === "dark" ? "cooptimize-dark" : "cooptimize-light" });
      await act(page, "ui.set_text_size", { size });
      const base = harness.url.split("#")[0]!;
      const go = async (hash: string) => {
        await page.goto(`${base}${hash}`);
        await page.reload();
        await page.waitForSelector(".topbar", { timeout: 30_000 });
        await page.waitForTimeout(900);
      };
      const tag = `1920${size === "larger" ? "-larger" : ""}-${scheme}`;
      await go("#/settings/notifications");
      await page.getByText("Send me reminders and Teams messages from this test site").waitFor({ timeout: 30_000 });
      await page.screenshot({ path: `${out}/env1-settings-${tag}.png` });
      // The demo's call is an Upload call; made Automatic here (the app's own action) so Check now shows. Not pressed:
      // the demo has no Microsoft sign-in to look with.
      const list = (await act(page, "meeting.list", { clientKey: "Northwind" })) as { meetings: { id: number; source: string }[] };
      for (const m of list.meetings) if (m.source !== "automatic") await act(page, "meeting.update", { seriesId: m.id, source: "automatic" });
      await go("#/settings/admin-clients");
      const check = page.getByRole("button", { name: "Check now" }).first();
      await check.waitFor({ timeout: 30_000 });
      await check.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/env1-check-now-${tag}.png` });
      await ctx.close();
    }
  }
} finally {
  await harness.stop();
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`ENV-1 screenshots in ${out}`);
