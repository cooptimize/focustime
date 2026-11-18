// CO-1: Ask to collaborate with a time I set. On the demo (Mon Nov 2, 9:30 AM Eastern; fictional teammates and free/busy:
// Priya busy 10:00 to 11:00, Sam working 8:00 to 4:00 Pacific, Taylor's calendar not shared): set 10:30, check, preview,
// confirm; a picked suggestion fills When and its answer; changes clear the answer; at 390 by 844 every control is at
// least 44 px and the main button stays on screen.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

let h: Harness;
const T = 120_000;

async function openFinder(page: Page) {
  await page.keyboard.press("2");
  await page.keyboard.press("p");
  await page.locator(".aw-feat-head").first().getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitem", { name: /Ask to collaborate/ }).click();
  const dlg = page.getByRole("dialog", { name: /Ask to collaborate/ });
  await dlg.waitFor();
  await dlg.locator(".help-tier li").first().waitFor({ timeout: 15_000 });
  return dlg;
}
async function setTime(page: Page, label: "Start" | "End", hm: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}: `) }).click();
  const box = page.locator(".tp-pop input");
  await box.fill(hm);
  await box.press("Enter");
  await page.locator(".tp-pop").waitFor({ state: "detached" });
}
const person = (dlg: Locator, name: string) => dlg.locator(".help-tier li", { hasText: name }).getByRole("checkbox");

describe.skipIf(!CHROMIUM)("Ask to collaborate: a time I set (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("set 10:30, check who is free, preview names who isn't free, confirm sends the invite", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const dlg = await openFinder(page);
    // Defaults: today, the next half hour, my usual length (30 minutes), in my zone, named.
    await expect(dlg.locator(".help-when legend").innerText()).resolves.toBe("When times in Eastern Time");
    await expect(dlg.getByRole("button", { name: /^Start: / }).innerText()).resolves.toMatch(/10:00/);
    await expect(dlg.getByRole("button", { name: /^End: / }).innerText()).resolves.toMatch(/10:30/);
    await expect(dlg.getByRole("button", { name: "Preview invite" }).isDisabled()).resolves.toBe(true);
    await person(dlg, "Jordan Lee").check();
    await person(dlg, "Priya Shah").check();
    await setTime(page, "Start", "10:30");
    await expect(dlg.getByRole("button", { name: /^End: / }).innerText()).resolves.toMatch(/11:00/);
    await dlg.getByRole("button", { name: "Check who is free" }).click();
    const answer = dlg.locator(".help-answer");
    await expect.poll(() => answer.innerText(), { timeout: 15_000 }).toBe("2 of 3 are free\nYou: Free\nJordan Lee: Free\nPriya Shah: Busy 10:00–11:00 AM");
    // A busy person doesn't block: the preview opens and says who isn't free, in the same words.
    await dlg.getByRole("button", { name: "Preview invite" }).click();
    const wd = page.getByRole("dialog", { name: "Send a help invite" });
    await wd.waitFor();
    await expect(wd.getByRole("note", { name: "Who isn't free then" }).innerText()).resolves.toBe("Not everyone is free then. You can still send it.\nPriya Shah: Busy 10:00–11:00 AM");
    await expect(wd.innerText()).resolves.toMatch(/10:30/);
    await wd.getByRole("button", { name: "Send invite" }).click();
    await expect.poll(() => page.locator("body").innerText(), { timeout: 15_000 }).toMatch(/Invite sent to Jordan Lee, Priya Shah/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("outside their hours, a calendar that can't be read, and changing the time or the people clears the answer", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const dlg = await openFinder(page);
    await person(dlg, "Sam Ortiz").check();
    await person(dlg, "Taylor Kim").check();
    await dlg.getByRole("button", { name: "Check who is free" }).click();
    const answer = dlg.locator(".help-answer");
    await expect.poll(() => answer.innerText(), { timeout: 15_000 }).toBe("1 of 3 are free\nYou: Free\nSam Ortiz: Outside their working hours (8:00 AM–4:00 PM Pacific Time, 11:00 AM–7:00 PM your time)\nTaylor Kim: Couldn't read their calendar");
    await dlg.getByRole("radio", { name: "1h", exact: true }).click();
    await expect(answer.count()).resolves.toBe(0);
    await expect(dlg.getByRole("button", { name: "Preview invite" }).isDisabled()).resolves.toBe(true);
    await dlg.getByRole("button", { name: "Check who is free" }).click();
    await answer.waitFor();
    await person(dlg, "Taylor Kim").uncheck();
    await expect(answer.count()).resolves.toBe(0);
    // A past start is refused before anything is asked, saying what to change.
    await setTime(page, "Start", "9:00");
    await expect(dlg.locator(".help-when").innerText()).resolves.toMatch(/That start has passed. Pick a later start/);
    await expect(dlg.getByRole("button", { name: "Check who is free" }).isDisabled()).resolves.toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Find times: suggestions on the hour or half hour; picking one fills When and shows its answer; a 15 minute nudge checks again", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const dlg = await openFinder(page);
    await person(dlg, "Jordan Lee").check();
    await dlg.locator(".help-find > summary").click();
    await dlg.getByRole("button", { name: "Find times" }).click();
    const slots = dlg.locator(".help-slots li");
    await slots.first().waitFor({ timeout: 15_000 });
    const starts = await slots.locator("strong").allInnerTexts();
    expect(starts.length).toBeGreaterThan(0);
    for (const s of starts) expect(s).toMatch(/, \d{1,2}:(00|30)( [AP]M)?–/);
    // Jordan is busy 1:00 to 2:00: 2:00 is offered, nothing that overlaps his busy time.
    expect(starts.some((s) => /Nov 2, 1:\d\d( PM)?–/.test(s))).toBe(false);
    await slots.filter({ hasText: "Mon, Nov 2, 2:00–2:30 PM" }).getByRole("radio").check();
    const answer = dlg.locator(".help-answer");
    await expect.poll(() => answer.innerText(), { timeout: 15_000 }).toBe("Everyone is free\nYou: Free\nJordan Lee: Free");
    await expect(dlg.getByRole("button", { name: /^Start: / }).innerText()).resolves.toMatch(/14:00/);
    await expect(dlg.getByRole("button", { name: /^End: / }).innerText()).resolves.toMatch(/14:30/);
    // Nudged 15 minutes earlier: the answer clears, and checking again gives the new one.
    await setTime(page, "Start", "13:45");
    await expect(answer.count()).resolves.toBe(0);
    await dlg.getByRole("button", { name: "Check who is free" }).click();
    await expect.poll(() => answer.innerText(), { timeout: 15_000 }).toMatch(/\nJordan Lee: Busy 1:00–2:00 PM$/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("390 by 844: every control at least 44 px, the main button on screen; set 10:30, check, preview, confirm", async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    const dlg = await openFinder(page);
    await person(dlg, "Jordan Lee").check();
    await setTime(page, "Start", "10:30");
    await dlg.getByRole("button", { name: "Check who is free" }).click();
    await dlg.locator(".help-answer").waitFor({ timeout: 15_000 });
    await dlg.locator(".help-find > summary").click();
    const small = await dlg.evaluate((d: Element) =>
      [...d.querySelectorAll<HTMLElement>("button, summary, .help-tier label, .help-slots label, .help-invite > label")]
        .filter((e) => e.offsetParent !== null && !e.closest(".help-answer"))
        .map((e) => ({ t: (e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 30), h: e.getBoundingClientRect().height }))
        .filter((x) => x.h < 44),
    );
    expect(small).toEqual([]);
    const btn = dlg.getByRole("button", { name: "Preview invite" });
    const box = (await btn.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    expect(box.y).toBeGreaterThanOrEqual(0);
    await btn.click();
    const wd = page.getByRole("dialog", { name: "Send a help invite" });
    await wd.getByRole("button", { name: "Send invite" }).click();
    await expect.poll(() => page.locator("body").innerText(), { timeout: 15_000 }).toMatch(/Invite sent to Jordan Lee/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
