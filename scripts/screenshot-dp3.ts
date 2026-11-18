// DP-3 screenshots on a throwaway demo server (e2e/harness.ts: fictional data, its own temp folder and port), the clock
// on Monday Nov 2 2026 9:30 AM ET. Two deployments, planned through deploy.add as the app plans them: Wednesday 19:00
// to 21:00 (Day's Evening) and Saturday 19:00 to 21:00 (Week's weekend column), with Jordan Lee on them where the
// build has people (before DP-3 it hasn't, and they're planned without). Each at 1440x900 and 390x844, dark, plus the
// Quick capture form in light: the form, Day's Evening, Week, and the deployment opened (its details on a computer, its
// sheet on the phone). Run in the branch for "after" and in a worktree of main for "before".
// Usage: node scripts/screenshot-dp3.ts <outDir> <before|after>
import { mkdirSync } from "node:fs";
import type { Page } from "playwright-core";
import { NOW, startDemo } from "../e2e/harness.ts";

const out = process.argv[2] ?? "screenshots/dp3";
const tag = process.argv[3] ?? "after";
mkdirSync(out, { recursive: true });
const JORDAN = "a4d00000-0000-4000-8000-000000000011";
const harness = await startDemo("chromium", {}, NOW);

const act = (page: Page, action: string, input: Record<string, unknown> = {}) =>
  page.evaluate(
    async ([action, input]) => {
      const csrf = document.cookie.split(";").map((p) => p.trim().split("=")).find(([k]) => k === "__Host-focustime-csrf")?.slice(1).join("=") ?? "";
      const r = await fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": csrf }, body: JSON.stringify({ action, input }) });
      return (await r.json()) as { ok: boolean; data?: unknown; error?: string };
    },
    [action, input] as const,
  );
const settle = (page: Page) => page.waitForTimeout(900);
const go = async (page: Page, hash: string) => {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.reload();
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await settle(page);
};

const errors: string[] = [];
try {
  for (const [w, h] of [[1440, 900], [390, 844]] as const) {
    const phone = w < 600;
    for (const scheme of ["dark", "light"] as const) {
      const ctx = await harness.browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, reducedMotion: "reduce", ignoreHTTPSErrors: true, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
      await ctx.addInitScript(() => (localStorage.setItem("focustime.hint.flow", "dismissed"), localStorage.setItem("focustime.hint.picktime", "1")));
      const page = await ctx.newPage();
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(`${w} ${scheme}: ${e.message}`));
      await page.goto(harness.url);
      await page.getByText(/Try the demo/).click({ timeout: 60_000 });
      await page.waitForSelector(".demo-tag", { timeout: 60_000 });
      await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
      await act(page, "ui.set_theme", { theme: scheme === "dark" ? "cooptimize-dark" : "cooptimize-light" });
      // Each context is its own demo session: plan them in each.
      {
        for (const [date, title] of [["2026-11-04", "Hotfix 4.1.2"], ["2026-11-07", "Release 4.2"]] as const) {
          const base = { clientKey: "Northwind", date, start: "19:00", end: "21:00", title };
          const r = await act(page, "deploy.add", { ...base, people: [JORDAN] });
          if (!r.ok) await act(page, "deploy.add", base);
        }
      }
      const name = (s: string) => `${out}/dp3-${tag}-${s}-${w}-${scheme}.png`;
      // Quick capture's Deployment form, with Jordan added where the build has People.
      await go(page, "#/day");
      await page.locator(phone ? ".pb-capture" : "button:has-text('Capture')").first().click();
      const box = page.locator(".cap-dialog .cap-box");
      await box.locator("textarea[aria-label='Quick capture']").fill("Release 4.3");
      await page.waitForTimeout(300);
      await box.locator(".cap-client").click();
      await box.locator(".cap-choose").getByRole("button", { name: "Northwind" }).click();
      const add = box.getByRole("combobox", { name: "Add someone" });
      if (await add.count()) {
        await add.fill("Jordan");
        await page.getByRole("option", { name: /Jordan Lee/ }).click().catch(() => {});
      }
      await settle(page);
      await page.screenshot({ path: name("capture") });
      if (scheme === "light") {
        await ctx.close();
        continue;
      }
      await page.keyboard.press("Escape");
      // Day's Evening, Wednesday.
      await go(page, "#/day/2026-11-04");
      await page.screenshot({ path: name("day-evening"), fullPage: false });
      // Week.
      await go(page, "#/week");
      if (phone) {
        // The phone's Week shows one day: Wednesday, with its evening deployment.
        await page.getByRole("button", { name: /^Wed\s*4/ }).first().tap().catch(() => {});
        await settle(page);
      }
      await page.screenshot({ path: name("week") });
      // The deployment opened: its details on a computer, its sheet on the phone.
      if (phone) {
        await go(page, "#/today/2026-11-07");
        await page.getByRole("button", { name: "More for Release 4.2" }).first().tap();
        await page.locator(".todo-sheet").waitFor();
      } else {
        await page.locator("main.grid .pick-row", { hasText: "Release 4.2" }).first().click({ button: "right" });
        await page.getByRole("menuitem", { name: /Deployment details/ }).click();
        await page.locator("form:has(input[name=start])").waitFor();
      }
      await settle(page);
      await page.screenshot({ path: name("open") });
      // After DP-3 only: the same as Jordan, who was added (the names, "Added by Alex", Jordan's own Outlook line).
      if (tag === "after" && (await act(page, "demo.be", { who: JORDAN })).ok) {
        await go(page, phone ? "#/today/2026-11-07" : "#/week");
        if (phone) {
          await page.getByRole("button", { name: "More for Release 4.2" }).first().tap();
          await page.locator(".todo-sheet").waitFor();
        } else {
          await page.locator("main.grid .pick-row", { hasText: "Release 4.2" }).first().click({ button: "right" });
          await settle(page);
        }
        await settle(page);
        await page.screenshot({ path: name("as-jordan") });
        await act(page, "demo.be", { who: "me" });
      }
      await ctx.close();
    }
  }
} finally {
  await harness.stop();
}
if (errors.length) console.log(errors.join("\n"));
console.log(`screenshots in ${out}`);
