// IB-1: Close the loop is one component wherever a promise shows, and it never makes its container scroll sideways.
// Before, the Week block panel put Teams · Email · DevOps · Call and the note on one row wider than the panel. Demo
// mode, clock pinned to Mon Nov 2, 9:30 AM: in each place (Inbox › Captures, Week's block panel, Close out, Today on the
// phone) open it, and the container's scrollWidth equals its clientWidth (and so does the page's) at 1920, 1366, Text
// size Larger and phone width (390 px, with an iPhone-like 17 px root font). Then close one loop for real.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

let h: Harness;
const T = 180_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: unknown; error?: string }>;
const go = async (page: Page, hash: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(800);
};

/** How far the container and the page are wider than they show (0 when nothing scrolls sideways). */
const overflow = (page: Page, container: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    const doc = document.scrollingElement!;
    return { found: !!el, container: el ? el.scrollWidth - el.clientWidth : -1, page: doc.scrollWidth - doc.clientWidth };
  }, container);

/** Opens Close the loop on the row that says `text` inside `scope`, and checks it shows and nothing overflows. */
async function openAndCheck(page: Page, scope: string, text: string, container: string) {
  const row = page.locator(`${scope} .follow-up`, { hasText: text }).first();
  await row.waitFor({ timeout: 20_000 });
  await row.getByRole("button", { name: "Close the loop", exact: true }).click();
  const form = row.locator("form.close-loop");
  await form.waitFor();
  // Every channel and the note are visible inside the container.
  for (const name of ["Teams", "Email", "DevOps", "Call"]) expect(await form.getByRole("button", { name, exact: true }).isVisible()).toBe(true);
  expect(await form.locator("textarea").isVisible()).toBe(true);
  expect(await overflow(page, container)).toEqual({ found: true, container: 0, page: 0 });
  await form.getByRole("button", { name: "Cancel" }).click();
}

const SIZES = [
  { name: "1920", viewport: { width: 1920, height: 1080 }, larger: false },
  { name: "1366", viewport: { width: 1366, height: 768 }, larger: false },
  { name: "1920 Larger", viewport: { width: 1920, height: 1080 }, larger: true },
  { name: "1366 Larger", viewport: { width: 1366, height: 768 }, larger: true },
];

describe.skipIf(!CHROMIUM)("IB-1: Close the loop never overflows", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  for (const s of SIZES) {
    it(`Captures, Week's block panel and Close out at ${s.name}`, async () => {
      const { page, errors } = await freshPage(h, s.viewport);
      if (s.larger) expect((await call(page, "ui.set_text_size", { size: "larger" })).ok).toBe(true);
      if (s.larger) await page.reload(), await page.waitForSelector(".topbar");
      await go(page, "#/inbox/captures");
      await openAndCheck(page, ".inbox-list", "Send the export spec", "main.inbox");
      await go(page, "#/week");
      await page.locator(".half.card", { hasText: "Northwind" }).first().locator(".card-when").click();
      await openAndCheck(page, ".detail-panel", "Send the export spec", ".detail-panel");
      await page.keyboard.press("Escape");
      await go(page, "#/today/closeout");
      await openAndCheck(page, ".closeout-panel", "Reply about the proposal timeline", ".closeout-panel");
      expect(errors).toEqual([]);
      await page.close();
    }, T);
  }

  it("Today on the phone (390 px, 17 px root font)", async () => {
    const page = await h.browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, bypassCSP: true });
    await page.addInitScript(() => {
      localStorage.setItem("focustime.hint.flow", "dismissed");
      document.addEventListener("DOMContentLoaded", () => {
        const st = document.createElement("style");
        st.textContent = "html{font-size:17px}";
        document.head.append(st);
      });
    });
    await page.goto(h.url);
    await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await openAndCheck(page, ".phone-due", "Send the export spec", ".phone-due");
    if (SHOTS) {
      await page.locator(".phone-due .follow-up", { hasText: "Send the export spec" }).first().getByRole("button", { name: "Close the loop", exact: true }).click();
      await page.screenshot({ path: `${SHOTS}/ib1-close-loop-phone.png`, fullPage: true });
    }
    await page.close();
  }, T);

  it.skipIf(!SHOTS)("screenshots: Close the loop open in the block panel, Captures and Close out, dark and light", async () => {
    const { page } = await freshPage(h);
    for (const theme of ["cooptimize-dark", "cooptimize-light"]) {
      expect((await call(page, "ui.set_theme", { theme })).ok).toBe(true);
      await page.reload();
      await page.waitForSelector(".topbar");
      const tag = theme.endsWith("dark") ? "dark" : "light";
      await go(page, "#/week");
      await page.locator(".half.card", { hasText: "Northwind" }).first().locator(".card-when").click();
      const panelRow = page.locator(".detail-panel .follow-up", { hasText: "Send the export spec" }).first();
      await panelRow.getByRole("button", { name: "Close the loop", exact: true }).click();
      await shotBoth(page, `ib1-close-loop-panel-${tag}`, panelRow);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await go(page, "#/inbox/captures");
      const row = page.locator(".inbox-list .follow-up", { hasText: "Send the export spec" }).first();
      await row.getByRole("button", { name: "Close the loop", exact: true }).click();
      await shotBoth(page, `ib1-close-loop-captures-${tag}`, row);
      await go(page, "#/today/closeout");
      const co = page.locator(".closeout-panel .follow-up", { hasText: "Reply about the proposal timeline" }).first();
      await co.getByRole("button", { name: "Close the loop", exact: true }).click();
      await shotBoth(page, `ib1-close-loop-closeout-${tag}`, co);
    }
    await page.close();
  }, T);

  it("closes one loop for real, with how and a note", async () => {
    const { page, errors } = await freshPage(h);
    await go(page, "#/inbox/captures");
    const row = page.locator(".inbox-list .follow-up", { hasText: "Confirm the intake form" }).first();
    await row.getByRole("button", { name: "Close the loop", exact: true }).click();
    // Its channel (Teams) is chosen already; choosing it again would clear it.
    expect(await row.getByRole("button", { name: "Teams", exact: true }).getAttribute("aria-pressed")).toBe("true");
    await row.locator("textarea").fill("Told them in the project chat");
    await row.locator("textarea").press("Enter");
    await expect.poll(() => page.locator(".inbox-list .follow-up", { hasText: "Confirm the intake form" }).count(), { timeout: 10_000 }).toBe(0);
    const list = (await call(page, "followups.list", { includeClosed: true })).data as { followUps: { what: string; closeHow: string | null; closeNote: string | null }[] };
    expect(list.followUps.find((f) => f.what.startsWith("Confirm the intake form"))).toMatchObject({ closeHow: "teams", closeNote: "Told them in the project chat" });
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
