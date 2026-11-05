// AS-1: the screenshots for the report (demo data only), when FOCUSTIME_SHOTS names a folder: the assistant panel with
// a lookup, a proposal with Confirm, a DevOps comment preview, push-to-talk recording and the transcript to edit, at
// 1920 (and Larger text) and on the phone. The demo can't preview DevOps writes (it has no writer), so the comment's
// answer is the service's preview for demo item #1110 with the write framework's own words (plan/devopswrite.ts),
// handed to the page in place of that one request. Nothing otherwise.
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import type { HandleResult } from "../assistant/types.ts";
import { VISIBILITY } from "../plan/devopswrite.ts";
import { CHROMIUM, FAKE_MIC, freshPage, NOW, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

const T = 300_000;
const COMMENT: HandleResult = {
  turnId: 900,
  status: "ok",
  reply: "Here's the comment. Check it, then Confirm to add it in DevOps.",
  cards: [],
  proposals: [{
    id: 900,
    action: "devops.confirm",
    clientKey: "Northwind",
    clientName: "Northwind Foods",
    title: "Comment on #1110",
    preview: { summary: "Add a comment to a DevOps item", system: "DevOps", target: "#1110 Order history export", identity: "Alex Rivera <you@example.com>", rows: [{ label: "Comment", before: null, after: "The CSV export is ready for review. Dana can try it on the March orders." }], notes: [] },
    whoSees: VISIBILITY("Portal"),
    before: { Comment: null },
    after: { Comment: "The CSV export is ready for review. Dana can try it on the March orders." },
    expiresAt: "2026-11-02T14:45:00Z",
    editable: ["text"],
    state: "open",
  }],
  links: [],
};

async function ask(page: Page, text: string, wait: string) {
  const box = page.getByTestId("assistant-panel").getByRole("textbox", { name: "Ask the assistant" });
  await box.fill(text);
  await box.press("Enter");
  await page.getByTestId("assistant-panel").locator(wait).last().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(300);
}

describe.skipIf(!CHROMIUM || !SHOTS)("AS-1 screenshots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, NOW, FAKE_MIC);
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  for (const [w, ht] of [[1920, 1080], [390, 844]] as const) {
    it(`the panel at ${w}`, async () => {
      const { page } = await freshPage(h, { width: w, height: ht });
      await page.route("**/api/action", async (r) => {
        const b = r.request().postDataJSON() as { action?: string; input?: { text?: string } } | null;
        if (b?.action === "assistant.ask" && /^Comment on #1110/.test(b.input?.text ?? "")) return r.fulfill({ json: { ok: true, data: COMMENT } });
        return r.continue();
      });
      const phone = w < 600;
      const shot = (name: string) => (phone ? page.screenshot({ path: `${SHOTS}/as1-${name}-phone.png` }) : shotBoth(page, `as1-${name}-${w}`));
      if (phone) await page.locator(".phone-assistant").click();
      else await page.keyboard.press("Control+j");
      await page.getByTestId("assistant-panel").waitFor();
      await ask(page, "What's #1110?", ".as-card.item");
      await shot("lookup");
      await ask(page, "Confirm today", ".as-card.proposal");
      await shot("proposal");
      await ask(page, "Comment on #1110 that the CSV export is ready for review", ".as-card.proposal");
      await shot("comment");
      // Push-to-talk: held, then the transcript in the box.
      const mic = page.getByTestId("assistant-panel").locator(".as-mic");
      await mic.hover();
      await page.mouse.down();
      await page.getByTestId("assistant-panel").locator(".as-rec").waitFor({ timeout: 10_000 });
      await page.waitForTimeout(2300);
      await shot("recording");
      await page.mouse.up();
      await page.waitForFunction(() => (document.querySelector<HTMLTextAreaElement>('[aria-label="Ask the assistant"]')?.value ?? "") !== "", undefined, { timeout: 30_000 });
      await page.waitForTimeout(300);
      await shot("transcript");
      await page.close();
    }, T);
  }
});
