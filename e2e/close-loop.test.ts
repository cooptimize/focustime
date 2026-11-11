// IB-1: Close the loop is one component wherever a promise shows, and it never makes its container scroll sideways.
// Before, the Week block panel put Teams · Email · DevOps · Call and the note on one row wider than the panel. Demo
// mode, clock pinned to Mon Nov 2, 9:30 AM: in each place (the Inbox's detail pane, Week's block panel, Close out, Today on the
// phone) open it, and the container's scrollWidth equals its clientWidth (and so does the page's) at 1920, 1366, Text
// size Larger and phone width (390 px, with an iPhone-like 17 px root font). Then close one loop for real.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
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

/**
 * LP-1: Close the loop opens the draft (Send by Teams, Email, Comment or Call, each saying where it goes); IB-1's form
 * is "Close without sending" from there, unchanged. Checks both show their parts, then returns the old form.
 */
async function withoutSending(scope: Locator) {
  const draft = scope.locator("form.send-loop");
  await draft.getByRole("radio", { name: /^Teams/ }).waitFor({ timeout: 20_000 });
  for (const name of ["Teams", "Email", "Comment", "Call"]) expect(await draft.getByRole("radio", { name: new RegExp(`^${name}`) }).isVisible()).toBe(true);
  await draft.getByRole("button", { name: "Close without sending" }).click();
  const form = scope.locator("form.close-loop:not(.send-loop)");
  await form.waitFor();
  for (const name of ["Teams", "Email", "DevOps", "Call"]) expect(await form.getByRole("button", { name, exact: true }).isVisible()).toBe(true);
  expect(await form.locator("textarea").isVisible()).toBe(true);
  return form;
}

/** Opens Close the loop on the row that says `text` inside `scope`, and checks it shows and nothing overflows. */
async function openAndCheck(page: Page, scope: string, text: string, container: string) {
  const row = page.locator(`${scope} .follow-up`, { hasText: text }).first();
  await row.waitFor({ timeout: 20_000 });
  await row.getByRole("button", { name: "Close the loop", exact: true }).click();
  // LP-1's draft first, then IB-1's form under Close without sending: neither scrolls sideways.
  await row.locator("form.send-loop").getByRole("radio", { name: /^Teams/ }).waitFor({ timeout: 20_000 });
  expect(await overflow(page, container)).toEqual({ found: true, container: 0, page: 0 });
  const form = await withoutSending(row);
  expect(await overflow(page, container)).toEqual({ found: true, container: 0, page: 0 });
  await form.getByRole("button", { name: "Cancel" }).click();
}

/** IB-1: the same check in the Inbox: the row opens the item, Close the loop is its pane's main button. */
async function inboxCheck(page: Page, text: string) {
  await go(page, "#/inbox/promises");
  const row = page.locator(".ib-row", { hasText: text }).first();
  await row.waitFor({ timeout: 20_000 });
  await row.click();
  const pane = page.locator(".ib-pane");
  await pane.getByRole("button", { name: /^Close the loop/ }).first().click();
  await pane.locator("form.send-loop").getByRole("radio", { name: /^Teams/ }).waitFor({ timeout: 20_000 });
  expect(await overflow(page, ".ib-pane")).toEqual({ found: true, container: 0, page: 0 });
  const form = await withoutSending(pane);
  expect(await overflow(page, ".ib-pane")).toEqual({ found: true, container: 0, page: 0 });
  expect(await overflow(page, "main.ib")).toEqual({ found: true, container: 0, page: 0 });
  return { pane, form };
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
    it(`the Inbox, Week's block panel and Close out at ${s.name}`, async () => {
      const { page, errors } = await freshPage(h, s.viewport);
      if (s.larger) expect((await call(page, "ui.set_text_size", { size: "larger" })).ok).toBe(true);
      if (s.larger) await page.reload(), await page.waitForSelector(".topbar");
      const { form } = await inboxCheck(page, "Send the export spec");
      await form.getByRole("button", { name: "Cancel" }).click();
      await go(page, "#/week");
      await page.locator(".half.card", { hasText: "Northwind" }).first().locator(".card-when").click();
      await openAndCheck(page, ".block-panel", "Send the export spec", ".block-panel");
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
    // MB-1: Today on the phone shows promises only in its urgent strip (which opens them in the Inbox); Close the loop
    // is the Inbox item's main button there.
    await page.locator(".urgent-strip").waitFor({ timeout: 20_000 });
    await go(page, "#/inbox/promises");
    await page.locator(".ib-row", { hasText: "Send the export spec" }).first().click();
    const sheet = page.locator(".ib-sheet.tall");
    await sheet.getByRole("button", { name: /^Close the loop/ }).first().click();
    await withoutSending(sheet);
    expect(await overflow(page, ".ib-sheet.tall")).toEqual({ found: true, container: 0, page: 0 });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ib1-close-loop-phone.png`, fullPage: true });
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
      const panelRow = page.locator(".block-panel .follow-up", { hasText: "Send the export spec" }).first();
      await panelRow.getByRole("button", { name: "Close the loop", exact: true }).click();
      await shotBoth(page, `ib1-close-loop-panel-${tag}`, panelRow);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      const { pane } = await inboxCheck(page, "Send the export spec");
      await shotBoth(page, `ib1-close-loop-inbox-${tag}`, pane);
      await go(page, "#/today/closeout");
      const co = page.locator(".closeout-panel .follow-up", { hasText: "Reply about the proposal timeline" }).first();
      await co.getByRole("button", { name: "Close the loop", exact: true }).click();
      await shotBoth(page, `ib1-close-loop-closeout-${tag}`, co);
    }
    await page.close();
  }, T);

  it("closes one loop for real, with how and a note", async () => {
    const { page, errors } = await freshPage(h);
    // The promise I added (a follow-up before IB-1); demo has a chat promise with the same words, so by its Who.
    const { form } = await inboxCheck(page, "For Chris Park");
    // Its channel (Teams) is chosen already; choosing it again would clear it.
    expect(await form.getByRole("button", { name: "Teams", exact: true }).getAttribute("aria-pressed")).toBe("true");
    await form.locator("textarea").fill("Told them in the project chat");
    await form.locator("textarea").press("Enter");
    // The open item stays in view (it says Loop closed) until I move on; it's in Done, not Promises, after that.
    await expect.poll(() => page.locator(".ib-pane").textContent(), { timeout: 10_000 }).toContain("Loop closed");
    const list = (await call(page, "followups.list", { includeClosed: true })).data as { followUps: { what: string; closeHow: string | null; closeNote: string | null }[] };
    expect(list.followUps.find((f) => f.what.startsWith("Confirm the intake form"))).toMatchObject({ closeHow: "teams", closeNote: "Told them in the project chat" });
    await go(page, "#/inbox/promises");
    await expect.poll(() => page.locator(".ib-row", { hasText: "For Chris Park" }).count(), { timeout: 10_000 }).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
