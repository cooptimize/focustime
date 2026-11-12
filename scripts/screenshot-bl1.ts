// BL-1 screenshots of the Backlog tab (was Ahead) on a throwaway demo server (e2e/harness.ts: fictional data, its own
// temp folder and port), dark and light, at 1440x900 and 1280x720, with measurements: how far down the first row of
// data starts, how many controls sit above it, and how many buttons are on the screen.
// "before": Ahead's four modes with default filters, and Grid on one client with the tree open three levels.
// "after": Grid and Gantt with default filters, Grid on one client, stories only, Needs attention on, the Filter
// popover, the ⋯ menu, rows selected with the bulk bar, and a close crop of the chevrons.
// Usage: node scripts/screenshot-bl1.ts <outDir> before|after
import { mkdirSync, writeFileSync } from "node:fs";
import type { Page } from "playwright-core";
import { startDemo } from "../e2e/harness.ts";

const out = process.argv[2] ?? "docs/ux/bl1/before";
const phase = (process.argv[3] ?? "after") as "before" | "after";
mkdirSync(out, { recursive: true });
const h = await startDemo("chromium", {}, "2026-11-06T10:00:00-05:00");
const errors: string[] = [];

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

/** The first row of data's top, the controls above it, and the buttons in the window. */
const ROW = ".ah-grid tbody .ah-row, .pa-item, .ah-fx-row, .bl-row";
async function measure(page: Page): Promise<{ firstRow: number | null; above: number; buttons: number }> {
  return page.evaluate((sel) => {
    const seen = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    };
    const first = [...document.querySelectorAll(sel)].find(seen);
    const top = first ? Math.round(first.getBoundingClientRect().top) : null;
    const main = document.querySelector("main.ahead") ?? document.body;
    const controls = [...main.querySelectorAll("button, input, select, [role=button], a[href]")].filter(seen);
    const above = top === null ? 0 : controls.filter((c) => c.getBoundingClientRect().bottom <= top + 1).length;
    const buttons = [...document.querySelectorAll("button")].filter(seen).length;
    return { firstRow: top, above, buttons };
  }, ROW);
}

const report: string[] = [];
async function shot(page: Page, name: string, m = true) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
  if (m) {
    const x = await measure(page);
    report.push(`| ${name} | ${x.firstRow ?? "none"} | ${x.above} | ${x.buttons} |`);
  }
}

try {
  for (const scheme of ["dark", "light"] as const) {
    for (const [width, height] of [[1440, 900], [1280, 720]] as const) {
      const ctx = await h.browser.newContext({ viewport: { width, height }, colorScheme: scheme, reducedMotion: "reduce" });
      await ctx.addInitScript(() => (localStorage.setItem("focustime.hint.flow", "dismissed"), localStorage.setItem("focustime.hint.picktime", "1")));
      const page = await ctx.newPage();
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(`${width} ${scheme}: ${e.message}`));
      await page.goto(h.url);
      await page.getByText(/Try the demo/).click({ timeout: 60_000 });
      await page.waitForSelector(".demo-tag", { timeout: 60_000 });
      await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
      await act(page, "ui.set_theme", { theme: scheme === "dark" ? "cooptimize-dark" : "cooptimize-light" });
      const tag = `${width}-${scheme}`;
      const go = async (hash: string, wait: string) => {
        await page.goto(`${h.url.split("#")[0]}${hash}`);
        await page.reload();
        await page.locator(wait).first().waitFor({ timeout: 60_000 });
      };
      if (phase === "before") {
        await go("#/ahead", ".ah-grid tbody .ah-row");
        await shot(page, `grid-${tag}`);
        await go("#/ahead/gantt", ".pa-item");
        await shot(page, `gantt-${tag}`);
        await go("#/ahead/fix", ".ah-fx-row");
        await shot(page, `readiness-${tag}`);
        await go("#/ahead/backlog", ".bl-row");
        await shot(page, `backlog-${tag}`);
        await go("#/ahead", ".ah-grid tbody .ah-row");
        await page.locator(".ah-toolbar .rm-chip").first().click();
        await page.waitForTimeout(300);
        await shot(page, `grid-one-client-${tag}`);
        if (width === 1440 && scheme === "dark") {
          const caret = page.locator(".ah-grid .rm-expand").first();
          const box = await caret.boundingBox();
          if (box) await page.screenshot({ path: `${out}/chevrons-crop.png`, clip: { x: Math.max(0, box.x - 12), y: Math.max(0, box.y - 40), width: 520, height: 160 } });
        }
      } else {
        await go("#/backlog", ".ah-grid tbody .ah-row");
        await shot(page, `grid-${tag}`);
        await go("#/backlog/gantt", ".pa-item");
        await shot(page, `gantt-${tag}`);
        await go("#/ahead/fix", ".ah-grid tbody .ah-row");
        await shot(page, `attention-${tag}`);
        // Filters are remembered: start the stories list from the defaults.
        await page.getByRole("button", { name: "Clear filters" }).click();
        await page.waitForTimeout(300);
        await go("#/ahead/backlog", ".ah-grid tbody .ah-row");
        await shot(page, `stories-${tag}`);
        await go("#/backlog", ".ah-grid tbody .ah-row");
        await page.getByRole("button", { name: "Clear filters" }).click().catch(() => null);
        await page.locator(".ah-toolbar .rm-chip").first().click();
        await page.waitForTimeout(300);
        await shot(page, `grid-one-client-${tag}`);
        await page.getByRole("button", { name: "Clear filters" }).click().catch(() => null);
        if (width === 1440) {
          await page.getByRole("button", { name: /^Filter/ }).click();
          await page.locator(".cell-pop").waitFor();
          await shot(page, `filter-popover-${tag}`, false);
          await page.keyboard.press("Escape");
          await page.getByRole("button", { name: "More: rows and view" }).click();
          await page.locator("[role=menu]").waitFor();
          await shot(page, `more-menu-${tag}`, false);
          await page.keyboard.press("Escape");
          const rows = page.locator(".ah-grid tbody .ah-row");
          await rows.nth(1).hover();
          await rows.nth(1).locator(".ah-tick input").check();
          await rows.nth(3).locator(".ah-tick input").click({ modifiers: ["Shift"] });
          await page.locator(".bl-bulk").waitFor();
          await shot(page, `selected-bulk-${tag}`, false);
          await page.keyboard.press("Escape");
          if (scheme === "dark") {
            const caret = page.locator(".ah-grid .ah-chev").first();
            const box = await caret.boundingBox();
            if (box) await page.screenshot({ path: `${out}/chevrons-crop.png`, clip: { x: Math.max(0, box.x - 12), y: Math.max(0, box.y - 40), width: 520, height: 160 } });
          }
        }
      }
      await ctx.close();
    }
  }
} finally {
  await h.stop();
}
writeFileSync(`${out}/measurements.md`, ["| Screen | First data row (px from top) | Controls above it | Buttons on screen |", "|---|---|---|---|", ...report].join("\n") + "\n");
if (errors.length) console.log(errors.join("\n"));
console.log(report.join("\n"));
console.log(`screenshots in ${out}`);
