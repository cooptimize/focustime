// UI-10: text boxes that grow instead of scrolling. In the demo, on the computer and the phone (390 px, the iPhone's
// 17 px root font): Quick capture, the Assistant's input and Close the loop's message start at their minimum with no
// scrollbar, grow a line at a time to their maximum, then scroll with the thin styled bar (10 px, no arrows), never
// changing width; Enter and Shift+Enter keep each field's keys, nothing submits while an IME composes; no textarea
// shows a resize handle; at Normal and Large text, light and dark.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, NOW, startDemo, type Harness } from "./harness.ts";
import { phonePage } from "./mb1-helpers.ts";
import { FIELDS, lines, measure, openField, setTheme, type Field } from "./ui10-helpers.ts";

let h: Harness;
const T = 120_000;
/** Each field's lines: where it starts and where it stops growing (recorded in docs/decisions.md under UI-10). */
const RANGE: Record<Field, { min: number; max: number }> = { capture: { min: 1, max: 6 }, assistant: { min: 1, max: 6 }, message: { min: 5, max: 12 } };
/** The phone's sheet shows Close the loop compact: its message starts at 4 lines. */
const PHONE_RANGE: Record<Field, { min: number; max: number }> = { ...RANGE, message: { min: 4, max: 12 } };

/** Grows the box from empty to two lines past its maximum and checks each step. */
async function checkGrowth(box: Locator, min: number, max: number): Promise<void> {
  await box.fill("");
  const empty = await measure(box);
  expect(empty.rows).toBe(min);
  expect(empty.overflowY).toBe("hidden");
  expect(empty.scrollH).toBeLessThanOrEqual(empty.clientH);
  expect(empty.scrollbar).toBe(0);
  expect(empty.resize).toBe("none");
  let prev = empty;
  for (let n = 1; n <= max + 2; n++) {
    await box.fill(lines(n));
    const m = await measure(box);
    expect(Math.abs(m.width - empty.width)).toBeLessThan(0.5);
    if (n <= min) expect(Math.abs(m.height - empty.height)).toBeLessThanOrEqual(1);
    else if (n <= max) expect(Math.abs(m.height - prev.height - m.lineHeight)).toBeLessThanOrEqual(1.5);
    else expect(m.height).toBe(prev.height);
    if (n <= max) {
      expect(m.overflowY).toBe("hidden");
      expect(m.scrollbar).toBe(0);
    } else {
      expect(m.overflowY).toBe("auto");
      expect(m.scrollH).toBeGreaterThan(m.clientH);
      // The styled bar (10 px); the native one, with its arrows, is 15 px in Chromium.
      expect(m.scrollbar).toBe(10);
    }
    prev = m;
  }
  // Back to empty: one line again, no scrollbar.
  await box.fill("");
  const again = await measure(box);
  expect(again.height).toBe(empty.height);
  expect(again.overflowY).toBe("hidden");
}

const composingEnter = (box: Locator) =>
  box.evaluate((el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true, isComposing: true })));

async function allTextareasClean(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("textarea")].flatMap((el) => {
      const cs = getComputedStyle(el);
      const bad: string[] = [];
      const name = el.getAttribute("aria-label") ?? el.id ?? el.className;
      if (cs.resize !== "none") bad.push(`${name}: resize ${cs.resize}`);
      const borderX = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
      const bar = Math.round(el.offsetWidth - el.clientWidth - borderX);
      if (bar !== 0 && bar !== 10) bar > 0 && bad.push(`${name}: native scrollbar ${bar}px`);
      if (el.scrollHeight <= el.clientHeight && bar > 0 && el.classList.contains("text-box")) bad.push(`${name}: scrollbar with nothing to scroll`);
      return bad;
    }),
  );
}

describe.skipIf(!CHROMIUM)("UI-10: text boxes that grow instead of scrolling", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, NOW, [], { showScrollbars: true });
  }, T);
  afterAll(async () => h?.stop(), T);

  for (const field of FIELDS) {
    it(`${field}: grows from its minimum to its maximum, then scrolls, at Normal and Large, light and dark`, async () => {
      const { page, errors } = await freshPage(h);
      const { box } = await openField(page, field, false);
      for (const [theme, size] of [["light", "normal"], ["dark", "large"], ["dark", "normal"], ["light", "large"]] as const) {
        await setTheme(page, theme, size);
        await checkGrowth(box, RANGE[field].min, RANGE[field].max);
      }
      expect(await allTextareasClean(page)).toEqual([]);
      expect(errors).toEqual([]);
      await page.close();
    }, T);
  }

  it("Quick capture: Enter saves, Shift+Enter adds a line, nothing saves while composing", async () => {
    const { page } = await freshPage(h);
    const { box, surface } = await openField(page, "capture", false);
    await box.fill("");
    await box.pressSequentially("first");
    await box.press("Shift+Enter");
    await box.pressSequentially("second");
    expect(await box.inputValue()).toBe("first\nsecond");
    await composingEnter(box);
    await page.waitForTimeout(400);
    expect(await box.inputValue()).toBe("first\nsecond");
    expect(await surface.locator(".cap-toast").count()).toBe(0);
    await box.press("Enter");
    await surface.locator(".cap-toast").waitFor();
    expect(await box.inputValue()).toBe("");
    // The ↵ button and the chip keep their size beside a box that has grown.
    const send = surface.locator(".cap-send");
    const before = (await send.boundingBox())!;
    await box.fill(lines(8));
    const after = (await send.boundingBox())!;
    expect([after.width, after.height]).toEqual([before.width, before.height]);
    const b = (await box.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(after.x);
    await page.close();
  }, T);

  it("the Assistant: Enter sends, Shift+Enter adds a line, nothing sends while composing", async () => {
    const { page } = await freshPage(h);
    const { box, surface } = await openField(page, "assistant", false);
    await box.fill("What's");
    await box.press("Shift+Enter");
    await box.pressSequentially("#1110?");
    expect(await box.inputValue()).toBe("What's\n#1110?");
    await composingEnter(box);
    await page.waitForTimeout(400);
    expect(await box.inputValue()).toBe("What's\n#1110?");
    await box.fill("What's #1110?");
    await box.press("Enter");
    await surface.locator(".as-card.item", { hasText: "Order history export" }).waitFor({ timeout: 30_000 });
    expect(await box.inputValue()).toBe("");
    await page.close();
  }, T);

  it("Close the loop's message: Enter is a new line there, as before", async () => {
    const { page } = await freshPage(h);
    const { box, surface } = await openField(page, "message", false);
    await box.fill("Hi");
    await box.press("End");
    await box.press("Enter");
    await box.pressSequentially("there");
    expect(await box.inputValue()).toBe("Hi\nthere");
    expect(await surface.isVisible()).toBe(true);
    await page.close();
  }, T);

  it("a textarea added anywhere gets no resize handle and the styled scrollbar", async () => {
    const { page } = await freshPage(h);
    const r = await page.evaluate(() => {
      const t = document.createElement("textarea");
      t.style.cssText = "height:40px;width:200px;overflow-y:auto";
      t.value = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
      document.body.append(t);
      const cs = getComputedStyle(t);
      const out = { resize: cs.resize, bar: t.offsetWidth - t.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth) };
      t.remove();
      return out;
    });
    expect(r).toEqual({ resize: "none", bar: 10 });
    await page.close();
  }, T);

  for (const field of FIELDS) {
    it(`${field} on the phone at 390 px: grows, scrolls, no sideways scroll, and stays above the bottom bar`, async () => {
      const page = await phonePage(h, 390);
      const { box, surface } = await openField(page, field, true);
      await checkGrowth(box, PHONE_RANGE[field].min, PHONE_RANGE[field].max);
      await box.fill(lines(PHONE_RANGE[field].max + 3));
      await box.scrollIntoViewIfNeeded();
      const doc = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
      expect(doc).toBe(0);
      // The box's own surround (the Assistant's compose area; the sheet's × overhang is older than UI-10).
      const around = field === "assistant" ? surface.locator(".as-compose") : surface;
      const sideways = await around.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(sideways).toBeLessThanOrEqual(0);
      const b = (await box.boundingBox())!;
      const bar = (await page.locator(".bottom-bar").boundingBox())!;
      expect(b.y + b.height).toBeLessThanOrEqual(bar.y + 0.5);
      // A keyboard covering 300 px: the sheet rests on it, not under it.
      await page.evaluate(() => document.documentElement.style.setProperty("--kb-inset", "300px"));
      await page.waitForTimeout(100);
      if (field !== "message") {
        const sheet = field === "capture" ? page.locator(".cap-backdrop") : surface;
        const s = (await sheet.boundingBox())!;
        expect(Math.round(s.y + s.height)).toBeLessThanOrEqual(800 - 300);
      }
      await page.close();
    }, T);
  }
});
