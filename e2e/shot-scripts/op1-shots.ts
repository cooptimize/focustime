// OP-1: the before and after screenshots, one script for both so the pairs match. Only when OP1_SHOTS names a folder
// (screenshots/op1/before or screenshots/op1/after); nothing runs otherwise. Dark at 1440x900 and 390x844, plus one
// light, demo data only. Each place is the preview a person sees for: Mark done in DevOps, Week › Status's Push all (two
// clients) and its Undo, the timebox check-in's time to DevOps, Break down's batch, and Send feedback. A shot that can't
// be reached is named in the log and skipped.
import { afterAll, describe, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const DIR = process.env.OP1_SHOTS ?? null;
const BEFORE = !!DIR && /before\/?$/.test(DIR);
const T = 900_000;
const missed: string[] = [];
const MON = "2026-11-02";
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const go = async (page: Page, hash: string) => {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.reload();
};
const SIZES = [
  ["1440", { width: 1440, height: 900 }],
  ["390", { width: 390, height: 844 }],
] as const;

async function themed(page: Page, theme: "dark" | "light") {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme === "dark" ? "cooptimize-dark" : "cooptimize-light");
}
async function shot(page: Page, name: string, run: () => Promise<Locator | void>) {
  try {
    const keep = await run();
    await page.waitForTimeout(400);
    if (keep) await keep.scrollIntoViewIfNeeded().catch(() => undefined);
    await page.screenshot({ path: `${DIR}/${name}.png` });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
    await page.screenshot({ path: `${DIR}/missed-${name}.png` }).catch(() => undefined);
    console.error(`missed ${name}: ${String((e as Error).message).split("\n").slice(0, 3).join(" / ")}`);
  }
}
/** The one preview's dialog (after) or a screen's own (before), whichever opens. */
const anyDialog = (page: Page) => page.locator('[role="dialog"][data-overlay="modal"]').last();

describe.skipIf(!CHROMIUM || !DIR)(`OP-1 screenshots (${BEFORE ? "before" : "after"})`, () => {
  const started: Harness[] = [];
  afterAll(async () => {
    if (missed.length) console.log(`OP-1 shots not taken:\n${missed.join("\n")}`);
    for (const h of started) await h.stop();
  }, T);

  it("Mark done in DevOps (Close out's owed list, the state picker, then its preview)", async () => {
    const h = await startDemo("chromium", {}, `${MON}T16:40:00-05:00`);
    started.push(h);
    for (const [w, size] of SIZES) {
      const { page } = await freshPage(h, size);
      await themed(page, "dark");
      await call(page, "settings.save", { section: "planning", values: { devopsOnDone: "never" } });
      await call(page, "planday.start", { date: MON });
      const id = (await call(page, "pick.add", { date: MON, half: "AM", clientKey: "Cooptimize", itemId: 4411 })).data.pick.id as number;
      await call(page, "pick.mark_done", { id, done: true });
      await go(page, "#/today/closeout");
      await shot(page, `markdone-ask-${w}`, async () => {
        await page.getByRole("button", { name: "Mark done in DevOps" }).first().click();
        await page.getByRole("dialog", { name: /^Mark done in DevOps/ }).locator("select").waitFor({ timeout: 20_000 });
      });
      await shot(page, `markdone-preview-${w}`, async () => {
        await page.getByRole("dialog", { name: /^Mark done in DevOps/ }).getByRole("button", { name: "Preview" }).click();
        await anyDialog(page).getByRole("button", { name: /DevOps|Confirm/ }).first().waitFor({ timeout: 20_000 });
      });
      await page.close();
    }
  }, T);

  it("Status: Push all for two clients, then Undo", async () => {
    const h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
    started.push(h);
    for (const [w, size] of SIZES) {
      for (const theme of w === "1440" ? (["dark", "light"] as const) : (["dark"] as const)) {
        const { page } = await freshPage(h, size);
        await themed(page, theme);
        await go(page, "#/status");
        await page.locator(".st-count").waitFor({ timeout: 30_000 });
        const sfx = theme === "light" ? `-${w}-light` : `-${w}`;
        await shot(page, `status-push${sfx}`, async () => {
          const clients = page.locator(".st-client");
          await clients.first().waitFor();
          const n = Math.min(2, await clients.count());
          for (let i = 0; i < n; i++) {
            const art = clients.nth(i).getByRole("article").first();
            await art.getByRole("button", { name: "Add a line" }).click();
            await art.getByRole("textbox").last().fill(i === 0 ? "Sign-up form designed; review with purchasing on Friday." : "Export filter in test; finance checks it Monday.");
          }
          await page.getByRole("button", { name: "Push all" }).click();
          await anyDialog(page).waitFor({ timeout: 20_000 });
          await page.waitForTimeout(600);
        });
        if (theme === "dark") {
          await shot(page, `status-undo-${w}`, async () => {
            const d = anyDialog(page);
            await d.getByRole("button", { name: /^(Push|Make|Add|Save)/ }).first().click();
            await d.getByRole("button", { name: "Close", exact: true }).last().click({ timeout: 30_000 });
            // After: one preview per client, so a second may open.
            if (!BEFORE) {
              const second = anyDialog(page);
              if (await second.count()) {
                await second.getByRole("button", { name: /^(Push|Make|Add|Save)/ }).first().click();
                await second.getByRole("button", { name: "Close", exact: true }).last().click({ timeout: 30_000 });
              }
            }
            await page.locator(".st-pushed").getByRole("button", { name: "Undo" }).first().click();
            await anyDialog(page).waitFor({ timeout: 20_000 });
          });
        }
        await page.close();
      }
    }
  }, T);

  it("The timebox check-in's time to DevOps", async () => {
    const h = await startDemo("chromium", {}, `${MON}T16:40:00-05:00`);
    started.push(h);
    const at = (t: string) => `${MON}T${t}:00-05:00`;
    for (const [w, size] of SIZES) {
      const { page } = await freshPage(h, size);
      await themed(page, "dark");
      await call(page, "settings.save", { section: "planning", values: { devopsOnDone: "never" } });
      await page.reload();
      await call(page, "planday.start", { date: MON });
      const add = async (input: object) => (await call(page, "pick.add", { date: MON, ...input })).data.pick.id as number;
      const query = await add({ half: "AM", clientKey: "Cooptimize", itemId: 4411 });
      const chart = await add({ half: "AM", clientKey: "Cooptimize", itemId: 4412 });
      for (const id of [query, chart]) await call(page, "pick.set_size", { id, size: "M" });
      for (const [pickId, a, b] of [[query, "09:00", "10:00"], [chart, "10:00", "11:00"]] as const) await call(page, "timebox.add", { pickId, date: MON, start: at(a), end: at(b) });
      await go(page, "#/today/closeout");
      await shot(page, `checkin-preview-${w}`, async () => {
        await page.locator(".closeout-panel .tc-box").waitFor({ timeout: 30_000 });
        for (const t of ["Timesheet summary query", "Utilization chart"]) {
          const r = page.locator(".tc-row", { hasText: t });
          await r.getByRole("button", { name: "Partly" }).click();
          await r.getByRole("button", { name: "1h", exact: true }).click();
          await r.locator(".tc-said").waitFor();
        }
        await page.locator(".tc-offer").getByRole("button", { name: "Review" }).click();
        if (BEFORE) {
          await page.locator(".tc-preview").waitFor({ timeout: 20_000 });
          return page.locator(".tc-preview");
        }
        await anyDialog(page).waitFor({ timeout: 20_000 });
        return undefined;
      });
      await page.close();
    }
  }, T);

  it("Break down's batch", async () => {
    const h = await startDemo("chromium", {}, `${MON}T10:00:00-05:00`);
    started.push(h);
    for (const [w, size] of SIZES) {
      const { page } = await freshPage(h, size);
      await themed(page, "dark");
      await go(page, "#/backlog/attention");
      await shot(page, `breakdown-preview-${w}`, async () => {
        // The phone's Backlog starts with a notice (PH-1 keeps it): Open anyway.
        if (w === "390") {
          // The phone's Backlog is read only: Break down from the feature's own card.
          await go(page, "#/item/Northwind/1120");
          await page.getByRole("dialog", { name: /#1120/ }).getByRole("button", { name: "Break down" }).click();
        } else {
        const needs = page.locator(".ah-grid tbody .ah-row:not(.context), .bl-row, li", { hasText: "Supplier onboarding" }).first();
        await needs.waitFor({ timeout: 30_000 });
        await needs.getByRole("button", { name: /Break down/ }).first().click();
        }
        const panel = page.getByRole("dialog", { name: /^Break down Feature: / });
        await panel.waitFor({ timeout: 15_000 });
        await panel.getByRole("button", { name: "Run" }).click();
        await panel.getByRole("listitem", { name: /^Card / }).first().waitFor({ timeout: 30_000 });
        await panel.getByRole("button", { name: /^Preview \d+ items?/ }).click();
        if (BEFORE) {
          await panel.getByRole("button", { name: /^Create all/ }).waitFor({ timeout: 20_000 });
          return;
        }
        // The one preview opens over the panel (the panel is a modal dialog too, so not anyDialog's last).
        await page.locator('[role="dialog"][data-overlay="modal"]').filter({ has: page.locator(".wd-where") }).locator("button.commit").waitFor({ timeout: 20_000 });
      });
      await page.close();
    }
  }, T);

  it("Send feedback's preview", async () => {
    const h = await startDemo("chromium");
    started.push(h);
    for (const [w, size] of SIZES) {
      const { page } = await freshPage(h, size);
      await themed(page, "dark");
      await shot(page, `feedback-preview-${w}`, async () => {
        await page.locator("main").first().waitFor({ timeout: 30_000 });
        await page.keyboard.press("Control+k");
        await page.keyboard.type("Send feedback");
        await page.keyboard.press("Enter");
        const d = page.getByRole("dialog", { name: "Send feedback" });
        await d.getByRole("textbox", { name: "Your feedback" }).fill("The week grid could show who else is on a client that day.");
        await page.keyboard.press("Enter");
        await page.getByRole("button", { name: /^Send/ }).first().waitFor({ timeout: 20_000 });
      });
      await page.close();
    }
  }, T);
});
