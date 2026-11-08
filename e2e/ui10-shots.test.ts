// UI-10: screenshots of Quick capture, the Assistant's input and Close the loop's message: empty, 3 lines and
// overflowing, on the computer (1920) and the phone (390), into FOCUSTIME_SHOTS as <UI10_WHEN>-<field>-<device>-<state>.png
// (UI10_WHEN is "before" or "after"), plus the overflowing box at Large text in dark and light. Nothing without FOCUSTIME_SHOTS.
// Only steps that also work before UI-10, so the same file takes the before shots on main.
import { afterAll, beforeAll, describe, it } from "vitest";
import { CHROMIUM, freshPage, NOW, startDemo, type Harness } from "./harness.ts";
import { phonePage } from "./mb1-helpers.ts";
import { SHOTS } from "./shots.ts";
import { FIELDS, lines, openField, setTheme } from "./ui10-helpers.ts";

let h: Harness;
const T = 180_000;
const WHEN = process.env.UI10_WHEN ?? "after";
const STATES = [["empty", 0], ["3-lines", 3], ["overflow", 16]] as const;

describe.skipIf(!CHROMIUM || !SHOTS)("UI-10 screenshots", () => {
  beforeAll(async () => {
    // Scrollbars drawn (headless hides them), so the before shots show the native arrows.
    h = await startDemo("chromium", {}, NOW, [], { showScrollbars: true });
  }, T);
  afterAll(async () => h?.stop(), T);

  for (const field of FIELDS) {
    it(`${field}, computer and phone`, async () => {
      const { page } = await freshPage(h);
      const { box, surface } = await openField(page, field, false);
      for (const [state, n] of STATES) {
        await box.fill(n ? lines(n) : "");
        await box.evaluate((el) => (el.scrollTop = 0));
        await page.waitForTimeout(150);
        await surface.screenshot({ path: `${SHOTS}/${WHEN}-${field}-desktop-${state}.png` });
      }
      await setTheme(page, "dark", "large");
      await page.waitForTimeout(200);
      await surface.screenshot({ path: `${SHOTS}/${WHEN}-${field}-desktop-overflow-dark-large.png` });
      await setTheme(page, "light", "large");
      await page.waitForTimeout(200);
      await surface.screenshot({ path: `${SHOTS}/${WHEN}-${field}-desktop-overflow-light-large.png` });
      await page.close();

      const phone = await phonePage(h, 390);
      const p = await openField(phone, field, true);
      for (const [state, n] of STATES) {
        await p.box.fill(n ? lines(n) : "");
        await p.box.scrollIntoViewIfNeeded();
        await phone.waitForTimeout(150);
        await phone.screenshot({ path: `${SHOTS}/${WHEN}-${field}-phone-${state}.png` });
      }
      await phone.close();
    }, T);
  }
});
