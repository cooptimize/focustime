// DOC-1 screenshots on a throwaway demo server (e2e/harness.ts: fictional data, its own temp folder and port): the
// Technical docs' Overview, Security with its diagram, a heading deep link and the Guide's footer link, at 1920 (and
// the largest Text size with FOCUSTIME_SHOT_TEXT=larger) and on a phone (iPhone 15, root font 17px; and 360 wide).
// Run against a build so the real CSP applies: npm run build, then FOCUSTIME_E2E_DIST=dist node scripts/screenshot-doc1.ts <outDir>
import { mkdirSync } from "node:fs";
import { devices, type Page } from "playwright-core";
import { startDemo } from "../e2e/harness.ts";

const out = process.argv[2] ?? "screenshots/doc1";
mkdirSync(out, { recursive: true });
const harness = await startDemo("chromium", {}, "2026-11-06T10:00:00-05:00");
const larger = process.env.FOCUSTIME_SHOT_TEXT === "larger";

const act = (page: Page, action: string, input: Record<string, unknown> = {}) =>
  page.evaluate(
    async ([action, input]) => {
      const csrf = document.cookie.split(";").map((p) => p.trim().split("=")).find(([k]) => k === "__Host-focustime-csrf")?.slice(1).join("=") ?? "";
      const r = await fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": csrf }, body: JSON.stringify({ action, input }) });
      const body = (await r.json()) as { ok: boolean; error?: string };
      if (!body.ok) throw new Error(`${action}: ${body.error}`);
    },
    [action, input] as const,
  );

const errors: string[] = [];
const runs = [
  { tag: "1920", opts: { viewport: { width: 1920, height: 1080 } } },
  ...(larger ? [] : [{ tag: "phone", opts: { ...devices["iPhone 15"] }, font: "17px" }, { tag: "360", opts: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true }, font: "17px" }]),
] as { tag: string; opts: Record<string, unknown>; font?: string }[];
const suffix = larger ? "-larger" : "";

try {
  for (const scheme of ["dark", "light"] as const) {
    for (const r of runs) {
      const ctx = await harness.browser.newContext({ ...r.opts, colorScheme: scheme, reducedMotion: "reduce", ignoreHTTPSErrors: true, serviceWorkers: "block" });
      await ctx.addInitScript(() => (localStorage.setItem("focustime.hint.flow", "dismissed"), localStorage.setItem("focustime.hint.picktime", "1")));
      const page = await ctx.newPage();
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(`${r.tag} ${scheme}: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && /Content Security Policy|Refused to apply/.test(m.text()) && errors.push(`${r.tag} ${scheme} CSP: ${m.text().slice(0, 160)}`));
      await page.goto(harness.url);
      await page.getByText(/Try the demo/).click({ timeout: 60_000 });
      await page.waitForSelector(".demo-tag", { timeout: 60_000 });
      await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
      await act(page, "ui.set_theme", { theme: scheme === "dark" ? "cooptimize-dark" : "cooptimize-light" });
      await act(page, "ui.set_text_size", { size: larger ? "larger" : "default" });
      const base = harness.url.split("#")[0];
      const open = async (hash: string, ready: string) => {
        await page.goto(`${base}${hash}`);
        await page.reload();
        if (r.font) await page.evaluate((f) => (document.documentElement.style.fontSize = f), r.font);
        await page.locator(ready).first().waitFor({ timeout: 30_000 });
        await page.waitForTimeout(600);
        const [iw, sw] = await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
        if (sw > iw + 1) errors.push(`${r.tag} ${scheme} ${hash}: wider than the screen (${iw}/${sw})`);
      };
      const shot = (name: string) => page.screenshot({ path: `${out}/doc1-${name}-${r.tag}-${scheme}${suffix}.png` });

      await open("#/docs/overview", ".td-body[data-doc-page='overview']");
      await shot("overview");
      await open("#/docs/security", ".td-body[data-doc-page='security'] figure.td-diagram svg");
      await page.locator("figure.td-diagram").first().evaluate((f) => f.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(300);
      await shot("security-diagram");
      await open("#/docs/security/secrets", ".td-body[data-doc-page='security']");
      await page.waitForTimeout(300);
      await shot("deep-link-secrets");
      if (r.tag !== "360") {
        await open("#/guide/start", "main.guide");
        await page.locator(".guide-tech-link").evaluate((a) => a.scrollIntoView({ block: "center" }));
        await page.locator(".guide-tech-link").hover();
        await page.waitForTimeout(300);
        await shot("guide-link");
      }
      if (r.tag !== "1920") {
        await open("#/docs/contents", "main.tech-docs .ps-rail .ps-item");
        await shot("contents");
      }
      await ctx.close();
    }
  }
} finally {
  await harness.stop();
}
if (errors.length) console.log(errors.join("\n"));
console.log(`screenshots in ${out}`);
