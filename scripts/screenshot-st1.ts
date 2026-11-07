// ST-1 screenshots on a throwaway demo server (e2e/harness.ts: fictional data, its own temp folder and port): every
// Settings section at 1920x1080 and on a phone (iPhone 15 viewport in Chromium, root font 17px as iPhone Safari's
// Dynamic Type gives), dark and light. Sections come from the page's own rail, so the run follows the layout.
// Usage: node scripts/screenshot-st1.ts <outDir> [section,...] [desktop|phone]
import { mkdirSync } from "node:fs";
import { devices, type Page } from "playwright-core";
import { startDemo } from "../e2e/harness.ts";

const out = process.argv[2] ?? "screenshots/st1";
const only = process.argv[3] && process.argv[3] !== "all" ? process.argv[3].split(",") : null;
const which = process.argv[4] ?? "both";
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

/** Section ids from the page: the rail's links (new shell) or the old side menu's buttons and picker. */
async function sectionsOf(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>("[data-settings-section]")].map((a) => a.dataset.settingsSection!);
    if (links.length) return [...new Set(links)];
    const opts = [...document.querySelectorAll<HTMLOptionElement>(".set-picker option")].map((o) => o.value);
    return opts;
  });
}

const errors: string[] = [];
const runs = [
  ...(which !== "phone" ? [{ tag: "1920", opts: { viewport: { width: 1920, height: 1080 } } }] : []),
  ...(which !== "desktop" ? [{ tag: "phone", opts: { ...devices["iPhone 15"] }, font: "17px" }] : []),
] as { tag: string; opts: Record<string, unknown>; font?: string }[];
try {
  for (const scheme of ["dark", "light"] as const) {
    for (const r of runs) {
      const ctx = await harness.browser.newContext({ ...r.opts, colorScheme: scheme, reducedMotion: "reduce", ignoreHTTPSErrors: true, bypassCSP: true });
      await ctx.addInitScript(() => (localStorage.setItem("focustime.hint.flow", "dismissed"), localStorage.setItem("focustime.hint.picktime", "1")));
      const page = await ctx.newPage();
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(`${r.tag} ${scheme}: ${e.message}`));
      await page.goto(harness.url);
      await page.getByText(/Try the demo/).click({ timeout: 60_000 });
      await page.waitForSelector(".demo-tag", { timeout: 60_000 });
      await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
      await act(page, "ui.set_theme", { theme: scheme === "dark" ? "cooptimize-dark" : "cooptimize-light" });
      const base = harness.url.split("#")[0];
      await page.goto(`${base}#/settings`);
      await page.reload();
      if (r.font) await page.addStyleTag({ content: `html{font-size:${r.font}}` });
      await page.locator("main.settings").waitFor({ timeout: 30_000 });
      const ids = only ?? (await sectionsOf(page));
      if (r.tag === "phone" && !only) {
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${out}/st1-rail-${r.tag}-${scheme}.png`, fullPage: true });
      }
      for (const id of ids) {
        await page.goto(`${base}#/settings/${id}`);
        await page.locator("main.settings").waitFor({ timeout: 30_000 });
        await page.waitForTimeout(900);
        const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        if (wide) errors.push(`${r.tag} ${scheme} ${id}: horizontal scroll`);
        await page.screenshot({ path: `${out}/st1-${id.replace(/\//g, "-")}-${r.tag}-${scheme}.png`, fullPage: r.tag === "phone" });
      }
      await ctx.close();
    }
  }
} finally {
  await harness.stop();
}
if (errors.length) console.log(errors.join("\n"));
console.log(`screenshots in ${out}`);
