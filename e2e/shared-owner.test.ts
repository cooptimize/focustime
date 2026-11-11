// Part 0's main path, in demo mode: nobody has a conversation; I take it (and see who has it, the history and Undo), then
// close it out and it leaves my active views for Done. The rules (races, reopen, backfill, visibility) are unit tests
// (actions/conversation-ownership.test.ts). A phone (390 px, 17 px root font) doesn't scroll sideways with the section open.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, openInboxItem, openInboxView, startDemo, type Harness } from "./harness.ts";
import { shotBoth } from "./shots.ts";

let h: Harness;
const T = 180_000;
type Row = { key: string; kind: string; title: string; views: string[]; personView?: string };
const rows = (page: Page) =>
  page.evaluate(async () => {
    const r = await fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: "inbox.list", input: {} }) });
    return ((await r.json()) as { data: { items: Row[] } }).data.items;
  });

describe.skipIf(!CHROMIUM)("a shared owner per conversation (Part 0)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("take it, Undo, take it again, close it out", async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("5");
    const main = await openInboxView(page, "needs-you");
    await main.locator(".ib-row").first().waitFor();
    const open = (await rows(page)).find((r) => r.kind === "conversation" && r.views.includes("needs_you") && (r.personView === "up_for_grabs" || r.personView === "asked_you"))!;
    expect(open).toBeTruthy();
    const pane = await openInboxItem(page, open.title);
    const who = pane.getByRole("region", { name: "Who has it" });
    await who.getByText("Nobody yet").waitFor();
    await shotBoth(page, "shared-owner-open", who);

    await pane.getByRole("button", { name: "I'll take it" }).first().click();
    await who.getByText("You took it", { exact: false }).waitFor();
    await who.getByRole("button", { name: "Undo my last change" }).click();
    await who.getByText("Nobody yet").waitFor();

    await pane.getByRole("button", { name: "I'll take it" }).first().click();
    await who.getByText("You took it", { exact: false }).waitFor();
    await shotBoth(page, "shared-owner-mine", who);

    await pane.getByRole("button", { name: "Close out" }).first().click();
    await expect.poll(async () => (await rows(page)).find((r) => r.key === open.key)?.personView).toBe("done");
    expect((await rows(page)).find((r) => r.key === open.key)?.views).toEqual(["done"]);
    expect(errors).toEqual([]);
  }, T);

  it("phone: the section doesn't scroll sideways", async () => {
    const page = await h.browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, bypassCSP: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
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
    await page.locator("main.today-view").waitFor();
    await page.evaluate(() => (location.hash = "#/inbox/teammates"));
    await page.locator("main.ib-phone").waitFor();
    await page.locator(".ib-row").first().click();
    await page.getByRole("region", { name: "Who has it" }).waitFor();
    const over = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".ib-sheet")].map((e) => e.scrollWidth - e.clientWidth).concat(document.documentElement.scrollWidth - document.documentElement.clientWidth));
    expect(Math.max(...over)).toBeLessThanOrEqual(0);
    await shotBoth(page, "shared-owner-phone");
    expect(errors).toEqual([]);
  }, T);
});
