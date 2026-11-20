// UC-3 item 7 (browser, demo mode): every tab's tooltip ends with how to reach it by key, "Press 6", the same way on
// every tab; never a number in brackets, which beside a tab's count read as a second count. Status's reason, when it
// has one, comes before the key. Fictional data only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 120_000;

describe.skipIf(!CHROMIUM)("UC-3: a tab's tooltip says Press and its key (browser, demo mode)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("each tab, in order, ends with Press 1 to Press 7 and has no number in brackets", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await page.locator(".topbar .view-tab").first().waitFor({ timeout: 30_000 });
    // Status's reason is read after the first paint; wait for its mark so its tooltip is the full one.
    await page.locator(".topbar .view-tab .status-mark").first().waitFor({ timeout: 8_000 }).catch(() => undefined);
    const tips = await page.locator(".topbar .view-tab").evaluateAll((els) => els.map((e) => e.getAttribute("title") ?? ""));
    expect(tips.length).toBe(7);
    tips.forEach((t, i) => {
      expect(t, t).toMatch(new RegExp(`^[^()]+\\. Press ${i + 1}$`));
      expect(t).not.toMatch(/\.\./);
    });
    expect(tips[4]).toBe("Calls: review the calls you were on. Press 5"); // TB-1: Calls is fifth
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
