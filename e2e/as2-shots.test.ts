// AS-2: the screenshots for the report (demo data only), when FOCUSTIME_SHOTS names a folder: the panel asking with
// choices, a move of several to-dos across clients, the compound update (done state and a comment in one card) and
// its result, light and dark, at 1920 and Larger text; and the Board after a move to Saturday (the weekend day shows
// once it has a to-do). The question and the cross-client move are the service's own shapes for demo data, handed to
// the page for that one request (the demo's scripted assistant doesn't ask, and the demo starts with nothing planned
// today); the compound card and the Saturday move are the real demo service.
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import type { HandleResult } from "../assistant/types.ts";
import { CHROMIUM, freshPage, NOW, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

const T = 300_000;
const QUESTION: HandleResult = {
  turnId: 901, status: "ok", reply: "", proposals: [], links: [],
  cards: [{ kind: "question", text: "Which to-dos on Mon, Nov 2?", choices: [{ label: "Mon, Nov 2 AM · Northwind Foods · 2 to-dos", value: "b1" }, { label: "Mon, Nov 2 PM · Harbor Health · 1 to-do", value: "b2" }, { label: "All 3", value: "all" }], expiresAt: "2026-11-02T14:40:00Z" }],
};
const MOVE: HandleResult = {
  turnId: 902, status: "ok", reply: "Here's the move. Confirm to move them; Undo puts them back.", cards: [], links: [],
  proposals: [{
    id: 902, action: "pick.move", clientKey: null, clientName: null, title: "Move 3 to-dos to Tue, Nov 3",
    preview: { summary: "Move 3 to-dos", system: "FocusTime", target: "3 to-dos across 2 clients", identity: null, rows: [
      { label: "Harbor Health · Validate date of birth", before: "Mon, Nov 2 afternoon", after: "Tue, Nov 3 afternoon" },
      { label: "Northwind Foods · Filter orders by date range", before: "Mon, Nov 2 morning", after: "Tue, Nov 3 morning" },
      { label: "Northwind Foods · Fix login timeout on mobile", before: "Mon, Nov 2 morning", after: "Tue, Nov 3 morning" },
    ], notes: ["Over your Tuesday AM hours by 1h", "\"Order export API endpoint\" stays: it's already planned there"] },
    whoSees: "Only you", before: {}, after: {}, expiresAt: "2026-11-02T14:45:00Z", editable: [], state: "open",
  }],
};

async function ask(page: Page, text: string, wait: string) {
  const box = page.getByTestId("assistant-panel").getByRole("textbox", { name: "Ask the assistant" });
  await box.fill(text);
  await box.press("Enter");
  await page.getByTestId("assistant-panel").locator(wait).last().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(300);
}

describe.skipIf(!CHROMIUM || !SHOTS)("AS-2 screenshots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, NOW);
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  for (const scheme of ["light", "dark"] as const) {
    it(`the panel, ${scheme}`, async () => {
      const { page } = await freshPage(h, { width: 1920, height: 1080 });
      await page.route("**/api/action", async (r) => {
        const b = r.request().postDataJSON() as { action?: string; input?: { text?: string } } | null;
        if (b?.action === "assistant.ask" && b.input?.text === "Move some of today's to-dos to tomorrow") return r.fulfill({ json: { ok: true, data: QUESTION } });
        if (b?.action === "assistant.ask" && b.input?.text === "All 3") return r.fulfill({ json: { ok: true, data: MOVE } });
        return r.continue();
      });
      await page.keyboard.press("Control+j");
      await page.getByTestId("assistant-panel").waitFor();
      // The default theme is dark; light is Cooptimize light (Settings › Display), set after the page applied its own.
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), scheme === "light" ? "cooptimize-light" : "cooptimize-dark");
      await ask(page, "Move some of today's to-dos to tomorrow", ".as-chips");
      await shotBoth(page, `as2-question-${scheme}`);
      await page.getByTestId("assistant-panel").locator(".as-chip", { hasText: "All 3" }).click();
      await page.getByTestId("assistant-panel").locator(".as-card.proposal").last().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(300);
      await shotBoth(page, `as2-move-${scheme}`);
      await ask(page, "Mark #1112 done and comment that it's in review", ".as-card.proposal");
      await shotBoth(page, `as2-compound-${scheme}`);
      await page.getByTestId("assistant-panel").getByTestId("assistant-proposal").last().getByRole("button", { name: "Confirm" }).click();
      await page.getByTestId("assistant-panel").locator(".as-parts").last().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(300);
      await shotBoth(page, `as2-compound-done-${scheme}`);
      await page.close();
    }, T);
  }

  it("a move to Saturday: the note, then the Board shows Saturday with the to-do", async () => {
    const { page } = await freshPage(h, { width: 1920, height: 1080 });
    await page.keyboard.press("Control+j");
    await page.getByTestId("assistant-panel").waitFor();
    await ask(page, "Move the order history export stories to Saturday", ".as-card.proposal");
    await shotBoth(page, "as2-saturday-proposal");
    await page.getByTestId("assistant-panel").getByTestId("assistant-proposal").last().getByRole("button", { name: "Confirm" }).click();
    await page.getByTestId("assistant-panel").locator(".as-outcome").last().waitFor({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await page.evaluate(() => (location.hash = "#/week"));
    await page.getByText("Export orders to CSV").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await shotBoth(page, "as2-saturday-board");
    await page.close();
  }, T);
});
