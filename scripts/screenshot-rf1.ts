// RF-1 screenshots on a throwaway demo server (e2e/harness.ts: fictional data, its own temp folder and port).
// The demo's Thursday is a day off, so for its Monday to Thursday week Wednesday is the last scheduled workday before
// Monday's report: Tuesday is the amber day, Wednesday the red one, Monday has no dot.
// Usage: node scripts/screenshot-rf1.ts <outDir> before|after
import { mkdirSync } from "node:fs";
import type { Page } from "playwright-core";
import { startDemo } from "../e2e/harness.ts";

const out = process.argv[2] ?? "docs/ux/rf1";
const phase = (process.argv[3] ?? "after") as "before" | "after";
mkdirSync(out, { recursive: true });

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

/** Google as needing sign-in again, in week.load's answer (the demo's sources are always live). */
async function googleNeedsReconnect(page: Page) {
  await page.route("**/api/action", async (route) => {
    const req = route.request();
    const body = req.postDataJSON() as { action?: string } | null;
    if (body?.action !== "week.load") return route.continue();
    const res = await route.fetch();
    const json = (await res.json()) as { ok: boolean; data?: { sources: Record<string, unknown>[] } };
    if (json.ok && json.data) json.data.sources = json.data.sources.map((s) => (s.source === "google" ? { ...s, status: "auth_required", fixAction: "connect_google", fetchedAt: null, fromCache: false, itemCount: 0, message: "Google needs you to sign in again" } : s));
    await route.fulfill({ response: res, json });
  });
}

const errors: string[] = [];
const CLOCKS = { none: "2026-11-09T10:00:00-05:00", amber: "2026-11-10T10:00:00-05:00", red: "2026-11-11T10:00:00-05:00" } as const;
const clocks = phase === "before" ? (["amber"] as const) : (["none", "amber", "red"] as const);
for (const when of clocks) {
  const harness = await startDemo("chromium", {}, CLOCKS[when]);
  try {
    for (const scheme of ["light", "dark"] as const) {
      for (const device of ["desktop", "phone"] as const) {
        const phone = device === "phone";
        const ctx = await harness.browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}), colorScheme: scheme, reducedMotion: "reduce", ignoreHTTPSErrors: true });
        await ctx.addInitScript(() => (localStorage.setItem("focustime.hint.flow", "dismissed"), localStorage.setItem("focustime.hint.picktime", "1")));
        const page = await ctx.newPage();
        page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(`${when} ${device} ${scheme}: ${e.message}`));
        await page.goto(harness.url);
        await page.getByText(/Try the demo/).click({ timeout: 60_000 });
        await page.waitForSelector(".demo-tag", { timeout: 60_000 });
        await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
        await act(page, "ui.set_theme", { theme: scheme === "dark" ? "cooptimize-dark" : "cooptimize-light" });
        const tag = `${when}-${device}-${scheme}`;
        const base = harness.url.split("#")[0];
        if (!phone) {
          // The tabs, with the Status mark (none, amber or red) and, after, its hover text.
          await page.goto(`${base}#/day`);
          await page.reload();
          await page.locator("nav.views").waitFor();
          await page.waitForTimeout(1500);
          await page.screenshot({ path: `${out}/tabs-${tag}.png`, clip: { x: 0, y: 0, width: 1440, height: 64 } });
          if (phase === "after" && when !== "none") {
            await page.getByRole("button", { name: /^Status/ }).hover();
            // Headless Chromium draws no native tooltip: draw the mark's own title text under it, as the browser would.
            await page.evaluate(() => {
              const m = document.querySelector(".view-tab .status-mark") as HTMLElement | null;
              if (!m) return;
              const r = m.getBoundingClientRect();
              const tip = document.createElement("div");
              tip.textContent = m.title;
              Object.assign(tip.style, { position: "fixed", left: `${r.left}px`, top: `${r.bottom + 14}px`, padding: "3px 7px", font: "12px system-ui, sans-serif", background: "#fffffe", color: "#111", border: "1px solid #888", boxShadow: "0 2px 4px #0003", zIndex: "9999", whiteSpace: "nowrap" });
              document.body.appendChild(tip);
            });
            await page.waitForTimeout(900);
            await page.screenshot({ path: `${out}/tab-hover-${tag}.png`, clip: { x: 0, y: 0, width: 1440, height: 140 } });
          }
        }
        if (when === "amber" || phase === "before") {
          // The top of Day, a day ahead, and the bottom bar with Google needing sign-in.
          await googleNeedsReconnect(page);
          await page.goto(`${base}#/day`);
          await page.reload();
          await page.locator("main").first().waitFor();
          await page.waitForTimeout(1500);
          await page.screenshot({ path: `${out}/day-top-${tag}.png` });
          await page.goto(`${base}#/day/2026-11-11`);
          await page.waitForTimeout(1200);
          await page.screenshot({ path: `${out}/day-ahead-${tag}.png` });
          if (!phone) {
            await page.goto(`${base}#/day`);
            await page.waitForTimeout(1200);
            const bar = page.locator("footer.statusbar");
            await bar.waitFor();
            const box = (await bar.boundingBox())!;
            await page.screenshot({ path: `${out}/statusbar-${tag}.png`, clip: { x: 0, y: Math.max(0, box.y - 20), width: 1440, height: Math.min(900 - Math.max(0, box.y - 20), box.height + 20) } });
          } else {
            // The phone's ⋯ menu with Status in it.
            await page.locator("button.top-more").click();
            await page.waitForTimeout(600);
            await page.screenshot({ path: `${out}/phone-menu-${tag}.png` });
          }
          await page.unroute("**/api/action");
        } else if (phone) {
          await page.goto(`${base}#/day`);
          await page.reload();
          await page.waitForTimeout(1500);
          await page.locator("button.top-more").click();
          await page.waitForTimeout(600);
          await page.screenshot({ path: `${out}/phone-menu-${tag}.png` });
        }
        await ctx.close();
      }
    }
  } finally {
    await harness.stop();
  }
}
if (errors.length) console.log(errors.join("\n"));
console.log(`screenshots in ${out}`);
