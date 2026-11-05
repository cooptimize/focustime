// TB-1: the app's side of the Teams bot, on a throwaway demo server: Settings › Notifications › In Teams, "Let
// FocusTime message me in Teams", is off by default, turns on, and is still on after a reload. Screenshots at 1920 and
// Text size Larger when FOCUSTIME_SHOTS names a folder (demo data only). The bot itself is tested with fake Teams
// activities (server/teams/*.test.ts); its cards are previewed by scripts/teams-card-previews.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, openSettings, startDemo, type Harness } from "./harness.ts";
import { shotBoth } from "./shots.ts";

const T = 300_000;

describe.skipIf(!CHROMIUM)("TB-1: Let FocusTime message me in Teams", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("is off by default, turns on, and stays on", async () => {
    const { page, errors } = await freshPage(h);
    await openSettings(page);
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Notifications", exact: true }).click();
    const box = page.getByRole("checkbox", { name: "Let FocusTime message me in Teams" });
    await box.scrollIntoViewIfNeeded();
    await expect(box.isChecked()).resolves.toBe(false);
    await shotBoth(page, "tb1-settings-teams-off", box);
    await box.check();
    await page.waitForTimeout(1200);
    // The address keeps Settings › Notifications open across the reload (#/settings/notifications).
    await page.reload();
    const again = page.getByRole("checkbox", { name: "Let FocusTime message me in Teams" });
    await again.scrollIntoViewIfNeeded();
    await expect(again.isChecked()).resolves.toBe(true);
    await shotBoth(page, "tb1-settings-teams-on", again);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
