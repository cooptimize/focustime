// DM-1: the demo script (docs/demo/script.md), step by step, on the demo (Monday Nov 2, 2026, 9:30 AM), with AI off
// (the scripted assistant and the stored samples). Each step checks what the script says the audience will see. With
// DEMO_SHOTS naming a folder, each step's screenshot at 1920 in dark (the default theme) and light.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { blockPicks, CHROMIUM, FAKE_MIC, freshPage, NOW, openInboxItem, openInboxView, selectBlock, startDemo, type Harness } from "./harness.ts";

const T = 600_000;
const SHOTS = process.env.DEMO_SHOTS ?? null;
const DEMO_TRANSCRIPT = "Comment on #1112 saying the date filter works for orders and the export screen is next";

let step = 0;
async function shot(page: Page, name: string, keep?: Locator) {
  step++;
  if (!SHOTS) return;
  const n = String(step).padStart(2, "0");
  await keep?.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${n}-${name}-dark.png` });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "cooptimize-light"));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/${n}-${name}-light.png` });
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  await page.waitForTimeout(100);
}
const go = async (page: Page, hash: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(700);
};

describe.skipIf(!CHROMIUM)("the demo script (DM-1)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, NOW, FAKE_MIC);
  }, T);
  afterAll(async () => h?.stop(), T);

  it("runs from Today to Close out", async () => {
    const { page, errors } = await freshPage(h);

    // 1. Day: the urgent strip (my late promise), the moment card (+ Add) and the day's blocks.
    await page.locator(".day-view .half.card").first().waitFor({ timeout: 30_000 });
    await page.getByText(/Promise · was due/).first().waitFor();
    await page.getByText("Send Marcus the updated export spec").first().waitFor();
    // IB-1 slice 4: the strip is the Inbox's own items, 3 at most, the most urgent first; the rest are "N more in Inbox".
    const strip = page.getByRole("region", { name: "Urgent" });
    await expect.poll(() => strip.locator(".us-item").count()).toBe(3);
    const badge = Number(await page.locator("nav.views .view-tab .count").first().textContent());
    await expect(strip.locator(".us-all").textContent()).resolves.toBe(`${badge - 3} more in Inbox`);
    await strip.locator(".us-all").click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/inbox/needs-you");
    await go(page, "#/today");
    await page.locator(".day-view .half.card").first().waitFor({ timeout: 30_000 });
    await shot(page, "today");

    // 2. Add work (WD-1): P opens Week with the panel; drag Filter orders by date range onto Northwind's Monday
    // afternoon (CF-1: nothing to confirm).
    await page.keyboard.press("p");
    await page.locator("aside.block-panel").waitFor({ timeout: 30_000 });
    await selectBlock(page, "Northwind");
    const row = page.locator("aside.block-panel .aw-row[draggable=true]", { hasText: "Filter orders by date range" }).first();
    await row.waitFor({ timeout: 15_000 });
    const nwMon = page.locator('[data-drop^="2026-11-02:"]', { has: page.locator(".card-client", { hasText: "Northwind" }) }).first();
    await row.dragTo(nwMon);
    await expect.poll(() => blockPicks(page, "Northwind")).toContain("Filter orders by date range");
    await shot(page, "plan-today");

    // 3. Week: From last week (Monday), the at-risk Wednesday afternoon (Out), Thursday's PTO, Friday's catch-up, the now line.
    await go(page, "#/week");
    await page.getByText(/\d+ to place · .*from last week/).first().waitFor({ timeout: 30_000 });
    await page.locator('.status-pill.at_risk[title^="At risk: Out: school event 1:30"]').first().waitFor();
    await page.locator(".day :is(.now-line, .now-mark)").first().waitFor();
    await shot(page, "week");

    // 4. Backlog: Grid, Gantt, Needs attention.
    await go(page, "#/backlog");
    await page.getByText("Order history export").first().waitFor({ timeout: 30_000 });
    await page.getByText(/changes? to save/).first().waitFor();
    await shot(page, "ahead-grid");
    await go(page, "#/backlog/gantt");
    await page.waitForTimeout(800);
    await shot(page, "ahead-gantt");
    await go(page, "#/backlog/attention");
    await page.locator(".ah-grid tbody .ah-row").first().waitFor({ timeout: 30_000 });
    await shot(page, "ahead-fix-next");

    // 5. Break down Supplier onboarding: five cards from the samples, Preview, Create all.
    const needs = page.locator(".ah-grid tbody .ah-row:not(.context)", { hasText: "Supplier onboarding" }).first();
    await needs.getByRole("button", { name: /Break down/ }).first().click();
    const panel = page.getByRole("dialog", { name: /^Break down Feature: / });
    await panel.waitFor({ timeout: 15_000 });
    await panel.getByRole("button", { name: "Run" }).click();
    await panel.getByRole("listitem", { name: "Card Supplier sign-up form" }).waitFor({ timeout: 30_000 });
    await shot(page, "break-down-review", panel);
    await panel.getByRole("button", { name: /^Preview 5 items/ }).click();
    await panel.getByRole("button", { name: "Create all" }).click();
    await panel.getByText(/Created 5|5 created|in DevOps/).first().waitFor({ timeout: 30_000 });
    await shot(page, "break-down-created", panel);
    await panel.getByRole("button", { name: "Done" }).click();

    // 6. Inbox › Needs you: the delivery fee question needs me; Create DevOps item from it.
    await go(page, "#/inbox/needs-you");
    const main = page.getByRole("main", { name: "Inbox" });
    const card = await openInboxItem(page, "Delivery fee missing from the order export");
    await shot(page, "inbox-needs-you", main);
    await card.getByRole("button", { name: /^Create DevOps item/ }).first().click();
    const draft = card.getByRole("form", { name: "Create DevOps item" });
    await expect.poll(() => draft.getByRole("textbox", { name: /^Title/ }).inputValue(), { timeout: 30_000 }).toContain("delivery fee");
    await shot(page, "inbox-create-form", draft);
    await draft.getByRole("button", { name: "Preview in DevOps" }).click();
    const preview = page.getByRole("dialog", { name: "Create a DevOps item" });
    await preview.getByRole("button", { name: "Create in DevOps" }).waitFor();
    // The whole preview fits on a 1080 screen: Create in DevOps is in reach without scrolling the page.
    expect(await preview.evaluate((d) => d.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    await shot(page, "inbox-create-preview", preview);
    await preview.getByRole("button", { name: "Create in DevOps" }).click();
    await preview.waitFor({ state: "detached" });
    await openInboxView(page, "in-progress");
    await main.locator(".ib-row", { hasText: "Delivery fee missing from the order export" }).waitFor({ timeout: 30_000 });
    await shot(page, "inbox-tracked");

    // 7. Inbox › Promises: the late one and the one due Friday.
    const myp = await openInboxView(page, "promises");
    await myp.locator(".ib-row", { hasText: "Send Marcus the updated export spec" }).waitFor({ timeout: 30_000 });
    await myp.locator(".ib-row", { hasText: "Confirm the intake form go-live date" }).first().waitFor();
    await shot(page, "inbox-promises");
    const waiting = await openInboxView(page, "waiting");
    await waiting.locator(".ib-row", { hasText: "Send Alex three test accounts with points balances" }).waitFor({ timeout: 30_000 });
    await shot(page, "inbox-waiting");
    const done = await openInboxView(page, "done");
    await done.locator(".ib-row", { hasText: "Reminder text wording" }).waitFor({ timeout: 30_000 });
    await done.locator(".ib-row", { hasText: "Send Lena the new reminder text" }).waitFor();
    await shot(page, "inbox-done");

    // 8. Capture: N on Today, a line for Northwind, Enter. Then Captures: the seeded draft story's AI-prepared version.
    await go(page, "#/today");
    await page.keyboard.press("n");
    const qc = page.getByRole("dialog", { name: /Quick capture/ });
    await qc.waitFor({ timeout: 10_000 });
    await qc.locator("textarea").first().fill("Ask Dana which columns the export needs @northwind");
    await shot(page, "capture", qc);
    await qc.locator("textarea").first().press("Enter"); // picks @Northwind from the list
    await qc.getByRole("button", { name: /Northwind/ }).first().waitFor();
    await qc.locator("textarea").first().press("Enter"); // saves
    await page.getByText(/Saved/).first().waitFor({ timeout: 10_000 });
    if (await qc.count()) await qc.getByRole("button", { name: "Close" }).click();
    await go(page, "#/inbox/captures");
    const draftPane = await openInboxItem(page, "Reorder from a past order");
    await draftPane.getByRole("button", { name: "Create in DevOps" }).click();
    await page.getByText(/AI|prepared/i).first().waitFor({ timeout: 15_000 });
    await shot(page, "capture-ai-version");
    await page.getByRole("button", { name: "Not now" }).click();
    await page.getByText("Ask Dana which columns the export needs").first().waitFor({ timeout: 10_000 });

    // 9. The assistant: a lookup, a move, a dictated comment.
    await go(page, "#/today");
    const as = page.getByTestId("assistant-panel");
    const ask = as.getByRole("textbox", { name: "Ask the assistant" });
    await page.locator(".topbar").getByRole("button", { name: "Ask", exact: true }).click();
    await ask.fill("What's #1110?");
    await ask.press("Enter");
    await as.locator(".as-card.item", { hasText: "Order history export" }).waitFor({ timeout: 30_000 });
    await ask.fill("Move Northwind's date filter to Wednesday afternoon");
    await ask.press("Enter");
    const move = as.getByTestId("assistant-proposal").last();
    await move.waitFor({ timeout: 30_000 });
    await expect(move.textContent()).resolves.toContain("Filter orders by date range");
    await shot(page, "assistant-move", as);
    await move.getByRole("button", { name: "Confirm" }).click();
    await move.locator(".as-outcome").waitFor({ timeout: 30_000 });
    // Push-to-talk: hold, release; the words land in the box; Send; Confirm the comment.
    await ask.fill("");
    const mic = as.getByRole("button", { name: "Talk" });
    await mic.hover();
    await page.mouse.down();
    await as.locator(".as-rec").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await expect.poll(() => ask.inputValue(), { timeout: 30_000 }).toBe(DEMO_TRANSCRIPT);
    await ask.press("Enter");
    const comment = as.getByTestId("assistant-proposal").last();
    await expect.poll(() => comment.textContent(), { timeout: 30_000 }).toContain("export screen is next");
    await shot(page, "assistant-comment", as);
    await comment.getByRole("button", { name: "Confirm" }).click();
    await comment.locator(".as-outcome").waitFor({ timeout: 30_000 });
    // AS-2: a move by feature (the server finds both to-dos under Order history export), one Confirm, one Undo.
    await ask.fill("Move the order history export stories to Friday");
    await ask.press("Enter");
    const byFeature = as.getByTestId("assistant-proposal").last();
    await expect.poll(() => byFeature.textContent(), { timeout: 30_000 }).toContain("Move 2 to-dos to Fri, Nov 6");
    await expect(byFeature.textContent()).resolves.toContain("Friday is your catch-up day");
    await expect(byFeature.textContent()).resolves.toContain("Export orders to CSV");
    await shot(page, "assistant-move-feature", as);
    await byFeature.getByRole("button", { name: "Confirm" }).click();
    await byFeature.locator(".as-outcome").waitFor({ timeout: 30_000 });
    await byFeature.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => byFeature.textContent(), { timeout: 30_000 }).toContain("Put 2 to-dos back");
    // AS-2: a compound update: the done state and a comment in one card, both written on one Confirm.
    await ask.fill("Mark #1112 done and comment that it's in review");
    await ask.press("Enter");
    const both = as.getByTestId("assistant-proposal").last();
    await expect.poll(() => both.textContent(), { timeout: 30_000 }).toContain("It's in review");
    await expect(both.textContent()).resolves.toMatch(/State/);
    await shot(page, "assistant-compound", as);
    await both.getByRole("button", { name: "Confirm" }).click();
    await both.locator(".as-parts").waitFor({ timeout: 30_000 });
    await page.keyboard.press("Escape");

    // 10. Send to someone's week: Supplier onboarding to Sam as a Must, from its ⋯ in Add work (WD-1).
    await go(page, "#/week/add");
    await page.locator("aside.block-panel").waitFor({ timeout: 30_000 });
    await selectBlock(page, "Northwind");
    const srow = page.locator("aside.block-panel .aw-feature", { has: page.locator(":scope > .aw-feat-head .aw-feat-name", { hasText: "Supplier onboarding" }) }).first();
    await srow.locator(":scope > .aw-feat-head").getByRole("button", { name: /^More for / }).click();
    await page.locator(".popup-menu .menu-item", { hasText: "Send to…" }).click();
    const dlg = page.getByRole("dialog", { name: "Send to… Supplier onboarding" });
    await dlg.getByRole("combobox", { name: "Send to" }).click();
    await page.getByRole("option", { name: /Sam Ortiz/ }).click();
    await dlg.getByRole("radio", { name: "Must" }).click();
    await shot(page, "send-to", dlg);
    await dlg.getByRole("button", { name: "Send", exact: true }).click();
    await dlg.getByRole("button", { name: "Done", exact: true }).click();

    // 11. Close out.
    await go(page, "#/today/closeout");
    const close = page.locator(".closeout-panel");
    await close.waitFor({ timeout: 30_000 });
    await shot(page, "close-out", close);

    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
