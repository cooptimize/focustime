// RQ-1: the before and after screenshots, one script for both so the pairs match. Only when RQ1_SHOTS names a folder
// (screenshots/rq1/before or screenshots/rq1/after); nothing runs otherwise. Demo data only, with Northwind's process
// requiring a Target Date on new features and stories (FOCUSTIME_DEMO_DEVOPS_RULES=target; before RQ-1 the demo
// ignores it, which is what a person saw: "Optional", then DevOps's refusal at Confirm). Dark at 1440x900, a call's
// page and its Break down also at 390x844 (the only way to them on a phone), plus the New form in light. Each: a call's feature row with Needed target date, the story row with the three
// questions, the New form at feature and at story level, Break down's Review with the needed field and Use for all, a
// published break down, and Create and break down on a row. A shot that can't be reached is named in the log and skipped.
import { afterAll, describe, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const DIR = process.env.RQ1_SHOTS ?? null;
const T = 900_000;
const missed: string[] = [];
const RULES = { FOCUSTIME_DEMO_DEVOPS_RULES: "target" };
const SIZES = [
  ["1440", { width: 1440, height: 900 }],
  ["390", { width: 390, height: 844 }],
] as const;

async function themed(page: Page, theme: "dark" | "light") {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme === "dark" ? "cooptimize-dark" : "cooptimize-light");
}
/** The phone as an iPhone draws it: a 17px root font. */
async function phoneFont(page: Page, w: string) {
  // Through the element's style: the app's CSP refuses an inline style sheet.
  if (w === "390") await page.evaluate(() => (document.documentElement.style.fontSize = "17px"));
}
async function shot(page: Page, name: string, run: () => Promise<Locator | void>) {
  try {
    const keep = await run();
    await page.waitForTimeout(500);
    if (keep) await keep.scrollIntoViewIfNeeded().catch(() => undefined);
    await page.screenshot({ path: `${DIR}/${name}.png` });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
    console.error(`missed ${name}: ${String((e as Error).message).split("\n").slice(0, 3).join(" / ")}`);
  }
}
async function pickDate(page: Page, scope: Locator, label: RegExp, day: string) {
  await scope.getByRole("button", { name: label }).first().click();
  await page.locator(".dp-pop input.dp-box").fill(day);
  await page.locator(".dp-pop input.dp-box").press("Enter");
  await page.locator(".dp-pop").waitFor({ state: "detached" });
}
/** The call's page: from Week's call mark at desk width, then by its address (a phone's Week has no mark to click). */
let callHash: string | null = null;
async function openCall(page: Page) {
  if (callHash) await page.evaluate((x) => (location.hash = x), callHash);
  else {
    await page.evaluate(() => (location.hash = "#/week"));
    const mark = page.locator(".call-mark").first();
    await mark.waitFor({ timeout: 30_000 });
    await mark.click();
  }
  await page.getByRole("heading", { name: "Update Northwind's plan" }).waitFor({ timeout: 30_000 });
  callHash ??= (await page.evaluate(() => location.hash)).replace(/^(#\/meetings\/\d+).*$/, "$1");
}
const rowOf = (page: Page, title: string) => page.locator(".mtg-prop").filter({ has: page.locator(`input[value='${title}']`) });
async function openNew(page: Page, type: string) {
  await page.evaluate(() => (location.hash = "#/ahead"));
  await page.locator(".ah-new").first().waitFor({ timeout: 30_000 });
  await page.locator(".ah-new").first().click();
  const f = page.getByRole("dialog", { name: /^New (in .*DevOps|work item)$/ });
  await f.waitFor();
  await f.getByRole("button", { name: /^Client:/ }).click();
  const pop = page.locator(".cell-pop");
  if (await pop.getByRole("combobox").count()) await pop.getByRole("combobox").fill("Northwind");
  await pop.getByRole("option", { name: "Northwind" }).first().click();
  await f.getByRole("radio", { name: type }).click();
  await f.locator("#nf-title").fill(type === "Feature" ? "Supplier self-service portal" : "Save a supplier draft");
  await page.waitForTimeout(1200);
  return f;
}
async function openBreakDown(page: Page) {
  await page.evaluate(() => (location.hash = "#/backlog/attention"));
  await page.reload();
  const row = page.locator(".ah-grid tbody .ah-row:not(.context), .bl-row", { hasText: "Supplier onboarding" }).first();
  await row.waitFor({ timeout: 30_000 });
  await row.getByRole("button", { name: /Break down/ }).first().click();
  const panel = page.getByRole("dialog", { name: /^Break down / });
  await panel.waitFor({ timeout: 15_000 });
  await panel.getByRole("button", { name: "Run" }).click();
  await panel.getByRole("listitem", { name: /^Card / }).first().waitFor({ timeout: 30_000 });
  return panel;
}

describe.skipIf(!CHROMIUM || !DIR)("RQ-1 screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    if (missed.length) console.log(`RQ-1 shots not taken:\n${missed.join("\n")}`);
    for (const h of started) await h.stop();
  }, T);

  it("a call's rows: the feature row's Needed date, the story row's three questions, Create and break down", async () => {
    const h = await startDemo("chromium", RULES, "2026-11-05T10:00:00-05:00");
    started.push(h);
    for (const [w, size] of SIZES) {
      const { page } = await freshPage(h, size);
      await phoneFont(page, w);
      await themed(page, "dark");
      await openCall(page);
      await shot(page, `${w}-call-feature-row`, async () => {
        const row = rowOf(page, "Accountant reporting area");
        await row.getByRole("radio", { name: "Feature" }).click();
        await page.waitForTimeout(1500);
        return row;
      });
      await shot(page, `${w}-call-story-row`, async () => {
        const row = rowOf(page, "Monthly statement as a PDF");
        await row.getByRole("button", { name: /^More: / }).click();
        await page.waitForTimeout(800);
        return row.locator("textarea").first();
      });
      await shot(page, `${w}-call-create-and-break-down`, async () => {
        const row = rowOf(page, "Accountant reporting area");
        await pickDate(page, row, /^Target date for Accountant reporting area/, "2026-12-18");
        await page.waitForTimeout(1200);
        const both = row.getByRole("button", { name: "Create and break down" });
        await both.waitFor({ timeout: 10_000 });
        await both.hover();
        return row;
      });
      // On a phone Break down opens only this way (Backlog is for a bigger screen): Create and break down, confirmed.
      if (w === "390")
        await shot(page, `${w}-breakdown-from-call`, async () => {
          await rowOf(page, "Accountant reporting area").getByRole("button", { name: "Create and break down" }).click();
          const d = page.locator('[role="dialog"][data-overlay="modal"]').filter({ has: page.locator(".wd-where") });
          await d.waitFor({ timeout: 20_000 });
          await d.locator("button.commit").click();
          const panel = page.getByRole("dialog", { name: /^Break down / });
          await panel.getByRole("listitem", { name: /^Card / }).first().waitFor({ timeout: 30_000 });
          await page.waitForTimeout(2500);
          return panel.locator(".bd-needs").first();
        });
      await page.close();
    }
  }, T);

  it("the New form at feature and at story level", async () => {
    const h = await startDemo("chromium", RULES);
    started.push(h);
    // Desk only: a phone has no New button (Backlog is for a bigger screen).
    for (const [w, size] of SIZES.slice(0, 1)) {
      const { page } = await freshPage(h, size);
      await phoneFont(page, w);
      await themed(page, "dark");
      await shot(page, `${w}-new-feature`, async () => void (await openNew(page, "Feature")));
      if (w === "1440") {
        await themed(page, "light");
        await shot(page, `${w}-new-feature-light`, async () => undefined);
        await themed(page, "dark");
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      if ((await page.getByRole("dialog", { name: /^New / }).count()) && (await page.getByRole("button", { name: /Discard|Close without/ }).count())) await page.getByRole("button", { name: /Discard|Close without/ }).first().click();
      await shot(page, `${w}-new-story`, async () => void (await openNew(page, "User Story")));
      await page.close();
    }
  }, T);

  it("Break down's Review with the needed field, and a published break down", async () => {
    // Desk only here; the phone's Break down is the call's (above).
    for (const [w, size] of SIZES.slice(0, 1)) {
      const h = await startDemo("chromium", RULES, "2026-11-02T10:00:00-05:00");
      started.push(h);
      const { page } = await freshPage(h, size);
      await phoneFont(page, w);
      await themed(page, "dark");
      let panel: Locator | null = null;
      await shot(page, `${w}-breakdown-review`, async () => {
        panel = await openBreakDown(page);
        return panel.locator(".bd-needs, .bd-total").first();
      });
      await shot(page, `${w}-breakdown-published`, async () => {
        if (!panel) throw new Error("no panel");
        const needs = panel.locator(".bd-needs");
        if (await needs.count()) {
          await pickDate(page, needs, /^Target Date for every story/, "2026-12-11");
          await needs.getByRole("button", { name: "Use for all" }).click();
          await page.waitForTimeout(800);
        }
        await panel.getByRole("button", { name: /^Preview \d+ items/ }).click();
        const d = page.locator('[role="dialog"][data-overlay="modal"]').filter({ has: page.locator(".wd-where") });
        await d.waitFor({ timeout: 20_000 });
        await d.locator("button.commit").click();
        // Before RQ-1 DevOps refuses each story at Confirm: that dialog is the picture.
        await page.waitForTimeout(3000);
        if (await panel.getByText(/^Created \d+ items? under/).count()) return panel.getByText(/^Created \d+ items? under/);
        return undefined;
      });
      await page.close();
    }
  }, T);
});
