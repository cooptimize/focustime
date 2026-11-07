// F1, FB-1: ⋯ › Send feedback in the browser, against the demo's pretend DevOps (nothing leaves FocusTime): open,
// type, Enter for the preview (who it's created as, who can see it), Ctrl+Enter to send, "Sent. Thanks." with the new
// item's number. Then without a write PAT (Turn on DevOps writes, Copy text only, the same in Settings > Connections)
// and a refused create ("Not sent", Copy text). Screenshots of set up, not set up, sent and failed, light and dark, at
// 1920 and at Text size Larger when FOCUSTIME_SHOTS names a folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { shotBoth } from "./shots.ts";

const T = 90_000;
const THEMES = { dark: "cooptimize-dark", light: "cooptimize-light" } as const;
type Theme = keyof typeof THEMES;

async function themed(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => (document.documentElement.dataset.theme = t), THEMES[theme]);
}
async function open(page: Page) {
  await page.getByRole("button", { name: /^More: the Guide/ }).click();
  await page.getByRole("menuitem", { name: "Send feedback" }).click();
  return page.getByRole("dialog", { name: "Send feedback" });
}

describe.skipIf(!CHROMIUM)("Send feedback (F1, FB-1)", () => {
  let h: Harness;
  let noPat: Harness;
  let failing: Harness;
  beforeAll(async () => {
    [h, noPat, failing] = await Promise.all([startDemo(), startDemo("chromium", { FOCUSTIME_DEMO_FEEDBACK_PARENT: "no_pat" }), startDemo("chromium", { FOCUSTIME_DEMO_FEEDBACK_PARENT: "fail" })]);
  }, 120_000);
  afterAll(async () => Promise.all([h?.stop(), noPat?.stop(), failing?.stop()]));

  it("opens from ⋯, previews the exact story as me, and sends it", async () => {
    const { page, errors } = await freshPage(h);
    const dialog = await open(page);
    await expect(dialog.getByRole("radio", { name: "Idea" }).isChecked()).resolves.toBe(true);
    await expect(dialog.getByRole("checkbox", { name: /Include where I am/ }).isChecked()).resolves.toBe(true);
    const box = dialog.getByRole("textbox", { name: "Your feedback" });
    await box.fill("Show the free hours on Week\nIt would help me plan.");

    await box.press("Enter");
    const title = dialog.locator(".feedback-title");
    await title.waitFor();
    await expect(title.textContent()).resolves.toBe("Idea: Show the free hours on Week");
    const desc = (await dialog.locator(".feedback-desc").textContent()) ?? "";
    expect(desc).toContain("It would help me plan.");
    expect(desc).toContain("From Alex Rivera (you@example.com)");
    expect(desc).toMatch(/View: Today$/m);
    expect(desc).toMatch(/Version: FocusTime · (demo|local) · /);
    expect(desc).toMatch(/Browser: Chrome \d+ on Linux/);
    expect(desc).toMatch(/Screen: \d+×\d+, window 1920×1080/);
    expect(desc).toContain("Environment: demo");
    expect(desc).not.toMatch(/Northwind|Harbor|Atlas/);
    await expect(dialog.locator(".feedback-dest").textContent()).resolves.toBe("Goes to the FocusTime backlog in Cooptimize's DevOps.");
    // FB-1: who it is created as and who can see it.
    await expect(dialog.locator(".feedback-write").textContent()).resolves.toContain("Created as You (the demo person) in demo › Demo Internal.");
    for (const theme of ["light", "dark"] as const) {
      await themed(page, theme);
      await shotBoth(page, `feedback-set-up-${theme}`);
    }

    await page.keyboard.press("Control+Enter");
    const done = dialog.locator(".feedback-done");
    await done.waitFor();
    await expect(done.textContent()).resolves.toBe("Sent. Thanks. #9001");
    for (const theme of ["light", "dark"] as const) {
      await themed(page, theme);
      await shotBoth(page, `feedback-sent-${theme}`);
    }
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
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

  it("without a write PAT says Turn on DevOps writes, offers Copy text, and shows the same in Settings > Connections", async () => {
    const { page, errors } = await freshPage(noPat);
    const dialog = await open(page);
    const note = dialog.locator(".feedback-note");
    await expect(note.textContent()).resolves.toContain("Turn on DevOps writes for Internal");
    await expect(note.getByRole("link", { name: "Open Settings › DevOps" }).getAttribute("href")).resolves.toBe("#/settings/devops/devops-write");
    await dialog.getByRole("textbox", { name: "Your feedback" }).fill("The plan didn't save");
    await expect(dialog.getByRole("button", { name: "Copy text" }).isEnabled()).resolves.toBe(true);
    await expect(dialog.getByRole("button", { name: /^Preview/ }).count()).resolves.toBe(0);
    for (const theme of ["light", "dark"] as const) {
      await themed(page, theme);
      await shotBoth(page, `feedback-not-set-up-${theme}`);
    }
    await page.keyboard.press("Escape");

    await page.evaluate(() => (location.hash = "#/settings/connections"));
    const row = page.locator(".feedback-setup");
    await row.waitFor({ timeout: 30_000 });
    await row.getByText(/^Turn on DevOps writes for Internal: feedback is sent with your own DevOps write PAT\.$/).waitFor();
    await expect(row.getByRole("link", { name: "Turn on DevOps writes" }).count()).resolves.toBe(1);
    for (const theme of ["light", "dark"] as const) {
      await themed(page, theme);
      await shotBoth(page, `feedback-connections-not-set-up-${theme}`, row);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("says Not sent when DevOps refuses, and keeps the text with Copy text", async () => {
    const { page, errors } = await freshPage(failing);
    const dialog = await open(page);
    const box = dialog.getByRole("textbox", { name: "Your feedback" });
    await box.fill("The plan didn't save");
    await box.press("Enter");
    await dialog.locator(".feedback-title").waitFor();
    await page.keyboard.press("Control+Enter");
    const problem = dialog.getByRole("alert");
    await problem.waitFor();
    await expect(problem.textContent()).resolves.toMatch(/^Not sent: DevOps refused it \(HTTP 500\)\. Your text is still here; Copy text keeps it\.$/);
    await expect(dialog.getByRole("button", { name: "Copy text" }).count()).resolves.toBe(1);
    await expect(dialog.locator(".feedback-done").count()).resolves.toBe(0);
    for (const theme of ["light", "dark"] as const) {
      await themed(page, theme);
      await shotBoth(page, `feedback-failed-${theme}`);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
