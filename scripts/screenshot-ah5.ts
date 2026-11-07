// AH-5 screenshots of Ahead › Grid on a throwaway demo server (e2e/harness.ts: fictional data, its own temp folder and
// port) at 1440x900 with the side panel closed, dark theme, Default and Larger text. "before": the grid and the old
// inline Start editor. "after": the grid, each popover editor open (dates with the calendar, state, assignee with a
// search, size), a row with pending changes, and the change set review.
// Usage: node scripts/screenshot-ah5.ts <outDir> before|after
import { mkdirSync } from "node:fs";
import type { Locator, Page } from "playwright-core";
import { freshPage, startDemo } from "../e2e/harness.ts";

const out = process.argv[2] ?? "docs/ux/ah5";
const phase = (process.argv[3] ?? "after") as "before" | "after";
mkdirSync(out, { recursive: true });
const h = await startDemo("chromium", {}, "2026-11-06T10:00:00-05:00");
const errors: string[] = [];
const row = (page: Page, title: string) => page.locator(".ah-row", { has: page.getByRole("link", { name: title, exact: true }) });

async function shot(page: Page, name: string, size: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${phase}-${name}${size === "default" ? "" : `-${size}`}.png` });
}
async function cell(page: Page, title: string, col: string): Promise<Locator> {
  // Under 1400 (Larger text at 1440 counts as narrower) Start and Target are one Dates column.
  const wanted = (col === "start" || col === "target") && !(await page.locator(".ah-col-start").count()) ? "dates" : col;
  const c = row(page, title).locator(`.ah-col-${wanted}`).first();
  await c.scrollIntoViewIfNeeded();
  return c;
}

try {
  for (const size of ["default", "larger"]) {
    const { page, errors: e } = await freshPage(h, { width: 1440, height: 900 });
    page.on("pageerror", (x) => errors.push(x.message));
    await page.evaluate((s) => document.documentElement.setAttribute("data-text-size", s), size);
    await page.evaluate(() => (location.hash = "#/ahead"));
    await page.locator(".ah-pending").waitFor({ timeout: 60_000 });
    await page.evaluate((s) => (s === "default" ? document.documentElement.removeAttribute("data-text-size") : document.documentElement.setAttribute("data-text-size", s)), size);
    await page.getByRole("group", { name: "Owner" }).getByRole("button", { name: "All" }).first().click().catch(() => {});
    await shot(page, "grid", size);
    if (phase === "before") {
      await (await cell(page, "Store locator", "start")).click();
      await shot(page, "start-editor", size);
    } else {
      await (await cell(page, "Store locator", "start")).click();
      await page.locator(".cell-pop").waitFor();
      await shot(page, "dates", size);
      await page.keyboard.press("Escape");
      await (await cell(page, "Store locator", "state")).click();
      await page.locator(".cell-pop").waitFor();
      await shot(page, "state", size);
      await page.keyboard.press("Escape");
      await (await cell(page, "Export orders to CSV", "assignee")).click();
      await page.locator(".cell-pop").waitFor();
      await page.keyboard.type("mo");
      await shot(page, "assignee", size);
      await page.keyboard.press("Escape");
      await (await cell(page, "Export orders to CSV", "size")).click();
      await page.locator(".cell-pop").waitFor();
      await shot(page, "size", size);
      await page.keyboard.press("Escape");
      await (await cell(page, "Store locator", "start")).scrollIntoViewIfNeeded();
      await shot(page, "pending", size);
      await page.getByRole("button", { name: /^Review/ }).first().click();
      await page.locator(".ah-review").waitFor();
      await shot(page, "review", size);
      await page.keyboard.press("Escape");
      // A shared component elsewhere: Backlog's bulk date uses the same date picker.
      await page.evaluate(() => (location.hash = "#/ahead/backlog"));
      await page.locator(".bl-head input[type=checkbox]").first().waitFor({ timeout: 30_000 });
      await page.locator(".bl-head input[type=checkbox]").first().check();
      await page.getByRole("button", { name: "Set a target date…" }).click();
      await page.locator(".bl-bulk-date .date-field").click();
      await page.locator(".cell-pop").waitFor();
      await shot(page, "backlog-date", size);
      await page.keyboard.press("Escape");
    }
    errors.push(...e);
    await page.close();
  }
  if (phase === "after") {
    // The grid at 1920 too (CLAUDE.md: changed screens at 1920 and at the largest Text size).
    const { page } = await freshPage(h, { width: 1920, height: 1080 });
    await page.evaluate(() => (location.hash = "#/ahead"));
    await page.locator(".ah-pending").waitFor({ timeout: 60_000 });
    await shot(page, "grid-1920", "default");
    await page.close();
  }
} finally {
  await h.stop();
}
if (errors.length) console.error(errors.join("\n"));
console.log(`wrote ${phase} screenshots to ${out}`);
