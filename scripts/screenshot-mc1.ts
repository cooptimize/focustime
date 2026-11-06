// MC-1 screenshots on a throwaway demo server (e2e/harness.ts: fictional data, its own temp folder and port, the clock
// pinned to Thursday Nov 5, 2026 10:00 AM ET so Wednesday's Northwind call is on this week's Week): Admin › Clients ›
// Meetings, the Week card's call marker, the review screen, its Confirm, and the list of client calls; at 1920 (Default
// and Larger text) and on a phone (Pixel 7), dark and light.
// Usage: node scripts/screenshot-mc1.ts <outDir>
import { mkdirSync } from "node:fs";
import { devices, type Page } from "playwright-core";
import { startDemo } from "../e2e/harness.ts";

const out = process.argv[2] ?? "screenshots/mc1";
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
const runs = [
  { tag: "1920", ctx: { viewport: { width: 1920, height: 1080 } }, size: "default" },
  { tag: "1920-larger", ctx: { viewport: { width: 1920, height: 1080 } }, size: "larger" },
  { tag: "phone", ctx: (({ defaultBrowserType: _, ...d }) => d)(devices["Pixel 7"]), size: "default" },
] as const;
try {
  for (const run of runs) {
    for (const scheme of ["dark", "light"] as const) {
      const ctx = await harness.browser.newContext({ ...run.ctx, colorScheme: scheme, reducedMotion: "reduce", ignoreHTTPSErrors: true });
      await ctx.addInitScript(() => localStorage.setItem("focustime.hint.flow", "dismissed"));
      const page = await ctx.newPage();
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(`${run.tag} ${scheme}: ${e.message}`));
      await page.goto(harness.url);
      await page.getByText(/Try the demo/).click({ timeout: 60_000 });
      await page.waitForSelector(".demo-tag", { timeout: 60_000 });
      await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
      await act(page, "ui.set_theme", { theme: scheme === "dark" ? "cooptimize-dark" : "cooptimize-light" });
      await act(page, "ui.set_text_size", { size: run.size });
      const base = harness.url.split("#")[0]!;
      const go = async (hash: string) => {
        await page.goto(`${base}${hash}`);
        await page.reload();
        await page.waitForSelector(".topbar", { timeout: 30_000 });
        await page.waitForTimeout(900);
      };
      const shot = (name: string) => page.screenshot({ path: `${out}/mc1-${name}-${run.tag}-${scheme}.png` });

      await go("#/week");
      if (run.tag === "phone") await page.getByRole("button", { name: /^Wed/ }).first().click();
      await page.locator(".call-mark").first().waitFor({ timeout: 30_000 }).catch(async (e: unknown) => {
        await page.screenshot({ path: `${out}/mc1-FAILED-${run.tag}-${scheme}.png` });
        throw e;
      });
      if (run.tag === "phone") await page.locator(".call-mark").first().scrollIntoViewIfNeeded();
      await shot("week-marker");
      await go("#/meetings");
      await page.locator(".mtg-series").first().waitFor();
      await shot("calls");
      await page.locator(".mtg-occs button").first().click();
      await page.locator(".mtg-prop").first().waitFor();
      await shot("review");
      await page.locator(".mtg-prop").last().locator("button", { hasText: "Skip" }).click();
      await page.locator(".mtg-bar button.primary").click();
      await page.locator(".mtg-confirm-box").waitFor();
      await page.waitForTimeout(400);
      await shot("confirm");
      await page.locator(".mtg-confirm-box button.primary").click();
      await page.locator(".mtg-done").waitFor();
      await page.evaluate(() => document.querySelector(".mtg-done")?.scrollIntoView({ block: "end" }));
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
      await shot("confirmed");
      await go("#/settings/admin-clients");
      const field = page.locator(".mtg-admin").filter({ hasText: "Northwind weekly status call" });
      await field.waitFor({ timeout: 30_000 });
      await field.scrollIntoViewIfNeeded();
      await shot("admin");
      await field.getByRole("button", { name: "Register a meeting" }).click();
      await field.getByRole("button", { name: "Paste a Teams link" }).click();
      await field.locator(".mtg-register").scrollIntoViewIfNeeded();
      await shot("admin-register");
      await ctx.close();
    }
  }
} finally {
  await harness.stop();
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}
console.log(`MC-1 screenshots in ${out}`);
