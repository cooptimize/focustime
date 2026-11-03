// F1: ⋯ › Send feedback in the browser, against the demo's pretend DevOps (nothing leaves FocusTime): open, type,
// Enter for the preview, Ctrl+Enter to send, "Sent. Thanks." with the new item's number. Then the not-set-up state (the
// pretend feature missing). Screenshots of the dialog, the preview, Sent and not set up at 1920 and at Text size Larger
// when FOCUSTIME_SHOTS names a folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { shotBoth } from "./shots.ts";

const T = 90_000;

describe.skipIf(!CHROMIUM)("Send feedback (F1)", () => {
  let h: Harness;
  let missing: Harness;
  beforeAll(async () => {
    [h, missing] = await Promise.all([startDemo(), startDemo("chromium", { FOCUSTIME_DEMO_FEEDBACK_PARENT: "missing" })]);
  }, 120_000);
  afterAll(async () => Promise.all([h?.stop(), missing?.stop()]));

  it("opens from ⋯, previews the exact story, and sends it", async () => {
    const { page, errors } = await freshPage(h);
    await page.getByRole("button", { name: /^More: the Guide/ }).click();
    await page.getByRole("menuitem", { name: "Send feedback" }).click();
    const dialog = page.getByRole("dialog", { name: "Send feedback" });
    await expect(dialog.getByRole("radio", { name: "Idea" }).isChecked()).resolves.toBe(true);
    await expect(dialog.getByRole("checkbox", { name: /Include where I am/ }).isChecked()).resolves.toBe(true);
    const box = dialog.getByRole("textbox", { name: "Your feedback" });
    await box.fill("Show the free hours on Week\nIt would help me plan.");
    await shotBoth(page, "feedback-dialog");

    await box.press("Enter");
    const title = dialog.locator(".feedback-title");
    await title.waitFor();
    await expect(title.textContent()).resolves.toBe("Idea: Show the free hours on Week");
    const desc = (await dialog.locator(".feedback-desc").textContent()) ?? "";
    expect(desc).toContain("It would help me plan.");
    expect(desc).toContain("From Alex Rivera (you@example.com)");
    expect(desc).toMatch(/View: Today › Now/);
    expect(desc).toMatch(/Version: FocusTime · (demo|local) · /);
    expect(desc).toMatch(/Browser: Chrome \d+ on Linux/);
    expect(desc).toMatch(/Screen: \d+×\d+, window 1920×1080/);
    expect(desc).toContain("Environment: demo");
    // Nothing from the plan: the demo's clients aren't in it.
    expect(desc).not.toMatch(/Northwind|Harbor|Atlas/);
    await expect(dialog.locator(".feedback-dest").textContent()).resolves.toBe("Goes to the FocusTime backlog in Cooptimize's DevOps.");
    await shotBoth(page, "feedback-preview");

    await page.keyboard.press("Control+Enter");
    const done = dialog.locator(".feedback-done");
    await done.waitFor();
    await expect(done.textContent()).resolves.toBe("Sent. Thanks. #9001");
    await shotBoth(page, "feedback-sent");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog.count()).resolves.toBe(0);

    // The command menu has it too; without "where I am" the description stops at the environment.
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Send feedback");
    await page.keyboard.press("Enter");
    await dialog.getByRole("radio", { name: "Question" }).check();
    await dialog.getByRole("checkbox", { name: /Include where I am/ }).uncheck();
    await box.fill("Where is Close out?");
    await box.press("Enter");
    await title.waitFor();
    await expect(title.textContent()).resolves.toBe("Question: Where is Close out?");
    await expect(dialog.locator(".feedback-desc").textContent()).resolves.toBe("Where is Close out?\n\nFrom Alex Rivera (you@example.com)\nEnvironment: demo");
    await dialog.getByRole("button", { name: "Back" }).click();
    await expect(box.inputValue()).resolves.toBe("Where is Close out?");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("says it isn't set up, with Copy text, and shows it in Settings > Connections", async () => {
    const { page, errors } = await freshPage(missing);
    await page.getByRole("button", { name: /^More: the Guide/ }).click();
    await page.getByRole("menuitem", { name: "Send feedback" }).click();
    const dialog = page.getByRole("dialog", { name: "Send feedback" });
    await expect(dialog.locator(".feedback-note").textContent()).resolves.toBe("Feedback isn't set up yet. Message the FocusTime team in Teams.");
    await dialog.getByRole("textbox", { name: "Your feedback" }).fill("The plan didn't save");
    await expect(dialog.getByRole("button", { name: "Copy text" }).isEnabled()).resolves.toBe(true);
    await expect(dialog.getByRole("button", { name: /^Preview/ }).count()).resolves.toBe(0);
    await shotBoth(page, "feedback-not-set-up");
    await page.keyboard.press("Escape");

    await page.evaluate(() => (location.hash = "#/settings/connections"));
    const row = page.locator(".feedback-setup");
    await row.waitFor({ timeout: 30_000 });
    await row.getByText(/^Not set up: Feature #496 isn't there/).waitFor();
    await shotBoth(page, "feedback-connections-not-set-up", row);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
