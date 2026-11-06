// UI-7: Capture's ↵ is its own button between the box and the client chip, never over the box or its scrollbar; the
// box grows to about four lines and then scrolls; Enter and ↵ both save; the chip stays a normal pill. At 1920, Text
// size Larger and the phone (390 wide, a 17px root font as on iPhone) with nothing running off the page.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, openApp, startDemo, type Harness, openCaptures } from "./harness.ts";
import { SHOTS } from "./shots.ts";

const LINES = "Follow up with the data team about the export\nCheck the mapping for the two date fields\nAsk whether the nightly run can move earlier\nThen update the story with what we agreed\nAnd one more line so it scrolls";

type Box = { x: number; y: number; width: number; height: number };
const rect = (l: Locator) => l.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) as Promise<Box>;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function checkLayout(page: Page, scope: string) {
  const box = page.locator(`${scope} .cap-box textarea[aria-label='Quick capture']`);
  const send = page.locator(`${scope} .cap-box .cap-send`);
  const chip = page.locator(`${scope} .cap-box .cap-client`);
  await box.fill(LINES);
  const [b, s, c] = [await rect(box), await rect(send), await rect(chip)];
  // ↵ is outside the box (and so clear of its scrollbar), and doesn't sit on the chip.
  expect(overlaps(b, s)).toBe(false);
  expect(overlaps(s, c)).toBe(false);
  // The box scrolls past about four lines.
  const m = await box.evaluate((el) => ({ h: el.clientHeight, sh: el.scrollHeight, lh: parseFloat(getComputedStyle(el).lineHeight) }));
  expect(m.sh).toBeGreaterThan(m.h);
  expect(m.h).toBeLessThan(m.lh * 5 + 30);
  // ↵ and the chip are one line tall (a pill, not stretched with the box).
  expect(Math.abs(s.height - c.height)).toBeLessThan(1.5);
  expect(c.height).toBeLessThan(b.height / 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

describe.skipIf(!CHROMIUM)("Capture's save button (UI-7)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => {
    await h?.stop();
  });

  it("↵ beside the box at 1920 and Larger; Enter and ↵ both save", async () => {
    const { page, errors } = await freshPage(h);
    await openApp(page, h);
    await openCaptures(page);
    await checkLayout(page, ".ib");
    if (SHOTS) await page.locator(".ib-capture .cap-box").screenshot({ path: `${SHOTS}/ui7-capture-1920.png` });
    await page.evaluate(() => document.documentElement.setAttribute("data-text-size", "larger"));
    await page.waitForTimeout(150);
    await checkLayout(page, ".ib");
    if (SHOTS) await page.locator(".ib-capture .cap-box").screenshot({ path: `${SHOTS}/ui7-capture-larger.png` });
    await page.evaluate(() => document.documentElement.removeAttribute("data-text-size"));

    const box = page.locator(".ib-capture .cap-box textarea[aria-label='Quick capture']");
    await box.fill("ui7 saved by the button");
    await page.locator(".ib-capture .cap-box .cap-send").click();
    await page.locator(".ib-capture .cap-toast").waitFor();
    await expect.poll(() => box.inputValue()).toBe("");
    await box.fill("ui7 saved by Enter");
    await box.press("Enter");
    await expect.poll(() => box.inputValue()).toBe("");
    await expect.poll(() => page.locator(".ib").getByText("ui7 saved by Enter").count()).toBeGreaterThan(0);
    await expect.poll(() => page.locator(".ib").getByText("ui7 saved by the button").count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  }, 120_000);

  it("the phone: no overlap and nothing off the page", async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    await openApp(page, h);
    await page.evaluate(() => void (document.documentElement.style.fontSize = "17px"));
    await page.locator(".phone-capture").click();
    await page.locator(".cap-dialog .cap-box").waitFor();
    await checkLayout(page, ".cap-dialog");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ui7-capture-phone.png` });
    expect(errors).toEqual([]);
  }, 120_000);
});
