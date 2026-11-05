// AS-1: the assistant panel's main path in the demo (its scripted assistant, nothing leaves FocusTime): Ctrl+J opens
// it, a lookup answers with cards, a proposal shows its preview and runs only on Confirm, Esc closes it, / opens it
// again with the history, push-to-talk fills the box with an editable transcript (Chromium's fake microphone), × closes
// it, and Settings › Data clears the history.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, FAKE_MIC, freshPage, NOW, startDemo, type Harness } from "./harness.ts";

const T = 180_000;

describe.skipIf(!CHROMIUM)("AS-1 the assistant panel", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, NOW, FAKE_MIC);
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("asks, proposes, confirms, talks and clears", async () => {
    const { page, errors } = await freshPage(h);
    const panel = page.getByTestId("assistant-panel");
    const box = panel.getByRole("textbox", { name: "Ask the assistant" });

    await page.keyboard.press("Control+j");
    await expect(panel.isVisible()).resolves.toBe(true);
    await box.fill("What's #1110?");
    await box.press("Enter");
    await panel.locator(".as-card.item", { hasText: "Order history export" }).waitFor({ timeout: 30_000 });

    // A proposal: the preview, and nothing changes until Confirm.
    await box.fill("Confirm today");
    await box.press("Enter");
    const proposal = panel.getByTestId("assistant-proposal").last();
    await proposal.waitFor({ timeout: 30_000 });
    await expect(proposal.textContent()).resolves.toContain("Confirm a day's plan");
    await proposal.getByRole("button", { name: "Confirm" }).click();
    await proposal.locator(".as-outcome").waitFor({ timeout: 30_000 });
    await expect(proposal.getByRole("button", { name: "Confirm" }).count()).resolves.toBe(0);

    // Esc closes; / opens it again with what was said.
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached" });
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("/");
    await panel.locator(".as-turn.me", { hasText: "Confirm today" }).waitFor({ timeout: 30_000 });

    // Push-to-talk: hold, then release; the transcript lands in the box to edit, and isn't sent by itself.
    await box.fill("");
    const mic = panel.getByRole("button", { name: "Talk" });
    await mic.hover();
    await page.mouse.down();
    await panel.locator(".as-rec").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await expect.poll(() => box.inputValue(), { timeout: 30_000 }).toBe("What's next today?");
    await expect(panel.locator(".as-turn.me", { hasText: "What's next today?" }).count()).resolves.toBe(0);

    // × closes it; Settings › Data clears the history.
    await panel.getByRole("button", { name: "Close" }).click();
    await panel.waitFor({ state: "detached" });
    await page.evaluate(() => (location.hash = "#/settings/data"));
    const row = page.locator(".set-field", { hasText: "Assistant history" });
    await row.getByRole("button", { name: "Clear" }).click();
    await row.getByRole("button", { name: "Clear it" }).click();
    await row.getByText(/Cleared \d+ entries/).waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+j");
    await panel.locator(".as-empty").waitFor({ timeout: 30_000 });
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
