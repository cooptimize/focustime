// QF-1 (browser, demo mode, Monday Nov 2, 9:30 AM): Today on any day (‹ ›, [ ], Back to today, the date in the address,
// past days read only), the demo's PTO day shown with "You're off", Timebox my day from Today and the Board's day menu
// (CF-1: on a day never confirmed, with no confirm), and Not work-related on a conversation with Undo.
// Screenshots at 1920 and the phone, light and dark, when FOCUSTIME_SHOTS names a folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, openInboxView, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";

let h: Harness;
const T = 90_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const hash = (page: Page) => page.evaluate(() => location.hash);
const title = (page: Page) => page.locator(".today-head h1").textContent();

async function shots(page: Page, name: string) {
  if (!SHOTS) return;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [w, hh] of [[1920, 1080], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: hh });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/qf1-${name}-${w === 1920 ? "1920" : "phone"}-${scheme}.png`, fullPage: false });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1920, height: 1080 });
}

describe.skipIf(!CHROMIUM)("QF-1 (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Today steps to any day: ‹ › and [ ], the date in the address, Back to today; other days read only; [ never fires while typing", async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/today"));
    await page.locator(".today-head h1").waitFor();
    await expect(title(page)).resolves.toMatch(/^Today/);
    await shots(page, "today");
    await page.keyboard.press("]");
    await expect.poll(() => hash(page)).toBe("#/day/2026-11-03");
    await expect.poll(() => title(page)).toMatch(/^Tuesday.*ahead/);
    await expect.poll(() => page.locator(".today-other").textContent(), { timeout: 10_000 }).toContain("A day ahead");
    // Nothing nags on another day, and nothing starts there.
    await expect(page.locator(".urgent-strip, .attention, .moment-card, .start-focus").count()).resolves.toBe(0);
    // Back past the weekend with ‹ (the button) and [ (the key): Friday, Oct 30, a past day with Close out.
    await page.getByRole("button", { name: "Previous day" }).click();
    await page.keyboard.press("[");
    await expect.poll(() => hash(page)).toBe("#/day/2026-10-30");
    await expect.poll(() => title(page)).toMatch(/^Friday.*past/);
    await expect.poll(() => page.getByRole("button", { name: "Close out Friday" }).count(), { timeout: 10_000 }).toBe(1);
    await expect(page.locator(".today-block input[type=checkbox]:not(:disabled)").count()).resolves.toBe(0);
    await shots(page, "past-day");
    // A link opens that day again.
    await page.reload();
    await expect.poll(() => title(page)).toMatch(/^Friday/);
    await page.getByRole("button", { name: "Back to today" }).click();
    await expect.poll(() => hash(page)).toBe("#/day");
    await expect.poll(() => title(page)).toMatch(/^Today/);
    // Typing [ in the capture box changes nothing.
    await page.keyboard.press("n");
    const box = page.getByRole("textbox").first();
    await box.waitFor();
    await box.pressSequentially("check [ and ]");
    await expect(hash(page)).resolves.toBe("#/day");
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the demo's PTO day: You're off, read only, no nudges, a link to the next working day", async () => {
    const { page } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/today/2026-11-05"));
    const pto = page.locator(".today-pto");
    await pto.waitFor();
    await expect.poll(() => pto.textContent(), { timeout: 10_000 }).toContain("You're off Thursday.");
    await expect(page.locator(".urgent-strip, .attention, .moment-card, .start-focus, .today-off").count()).resolves.toBe(0);
    await shots(page, "pto-day");
    await pto.getByRole("button", { name: /next working day/ }).click();
    await expect.poll(() => hash(page)).toBe("#/day/2026-11-09");
    await page.close();
  }, T);

  it("Timebox my day from Today on a never-confirmed day (CF-1) and from the Board's day menu; the same proposals on the timeline", async () => {
    const { page } = await freshPage(h);
    // Today with a plan never confirmed and a story without a time.
    await call(page, "pick.add", { date: "2026-11-02", half: "PM", clientKey: "Northwind", intention: "Write the export notes", size: "S" });
    await page.evaluate(() => (location.hash = "#/today"));
    await page.reload();
    const offer = page.locator(".today-timebox");
    await offer.waitFor();
    await expect.poll(() => offer.textContent(), { timeout: 10_000 }).toBe("Timebox my day");
    await shots(page, "today-timebox");
    await offer.click();
    // TY-1: no popup: the same proposals, as placeholders on the day's timeline (CF-1: nothing confirmed first).
    await page.getByRole("group", { name: "Timebox my day" }).waitFor();
    expect(await page.getByRole("dialog", { name: "Timebox my day" }).count()).toBe(0);
    await expect.poll(() => hash(page)).toMatch(/^#\/day/);
    expect((await call(page, "planday.start", { date: "2026-11-02" })).data.plan).not.toHaveProperty("committedAt");
    await page.getByRole("button", { name: "Discard" }).click();
    // The Board's day header menu, on Tuesday: Timebox my day, never Confirm.
    await call(page, "pick.add", { date: "2026-11-03", half: "AM", clientKey: "Cooptimize", intention: "Draft the onboarding checklist", size: "S" });
    await page.evaluate(() => (location.hash = "#/week"));
    await page.reload();
    await page.locator(".day-head").nth(1).click({ button: "right" });
    expect(await page.getByRole("menuitem", { name: /Confirm/ }).count()).toBe(0);
    const item = page.getByRole("menuitem", { name: "Timebox my day" });
    await item.click();
    await page.getByRole("group", { name: "Timebox my day" }).waitFor();
    await expect.poll(() => hash(page)).toMatch(/^#\/day\/2026-11-03/);
    await page.close();
  }, T);

  it("Not work-related: one click on a conversation moves it to Chatter; Undo brings it back", async () => {
    const { page } = await freshPage(h);
    const list = await openInboxView(page, "needs-you");
    const first = list.locator(".ib-row", { has: page.locator(".kind-conversation") }).first();
    const name = (await first.locator(".ib-row-title").textContent())!;
    await first.click();
    await shots(page, "conversation");
    await page.locator(".ib-acts").first().getByRole("button", { name: "Not work-related" }).click();
    await expect.poll(() => page.locator(".ib-row-title").allTextContents()).not.toContain(name);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => page.locator(".ib-row-title").allTextContents()).toContain(name);
    // The row's ⋯ has it too.
    const row = page.locator(".ib-rows > li", { has: page.locator(".ib-row-title", { hasText: name }) }).first();
    await row.hover();
    await row.getByRole("button", { name: `More for ${name}` }).click();
    await row.getByRole("menuitem", { name: "Not work-related" }).click();
    await expect.poll(() => page.locator(".ib-row-title").allTextContents()).not.toContain(name);
    await page.close();
  }, T);
});
