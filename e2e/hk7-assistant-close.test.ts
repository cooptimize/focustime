// HK-7 (Q-UI10-2): on the phone, the Assistant sheet's × sits inside the sheet (it was 2 px past its right edge), at
// 390 and 360 px with the iPhone's 17 px root font. Demo mode.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, startDemo, type Harness } from "./harness.ts";
import { phonePage } from "./mb1-helpers.ts";

const T = 180_000;
let h: Harness;

describe.skipIf(!CHROMIUM)("HK-7: the Assistant sheet's close button on the phone", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(() => h?.stop());

  for (const width of [390, 360]) {
    it(`at ${width} px the × is inside the sheet`, async () => {
      const page = await phonePage(h, width);
      await page.locator(".bottom-bar").getByRole("button", { name: "Ask the assistant" }).click();
      const panel = page.getByTestId("assistant-panel");
      await panel.waitFor();
      await page.waitForTimeout(400);
      const close = panel.getByRole("button", { name: /^Close/ }).first();
      const [pb, cb] = [(await panel.boundingBox())!, (await close.boundingBox())!];
      expect(cb.x + cb.width).toBeLessThanOrEqual(pb.x + pb.width);
      expect(cb.x + cb.width).toBeLessThanOrEqual(width);
      await page.close();
    }, T);
  }
});
