// IB-4: the slim Inbox on the demo (clock pinned to Mon Nov 2, 9:30 AM). Three lists with counts; From chats offers
// the conversations from my last workday that need an item (never the one about which story is next), each opening in
// place with Create item, Already covered and Dismiss (Undo puts it back, and the tab's number follows); Promises shows
// what cleared on its own with Put back; the list I used last comes back; old links land on the nearest list; keys do
// what their buttons do and never fire while typing; Day's chip opens From chats; a phone never scrolls sideways.
// The rules are unit tests (plan/slim-inbox.test.ts, actions/slim-inbox.test.ts, ui/nav.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, openInboxItem, openInboxView, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 180_000;
const FEE = "Show the delivery fee as its own column in the order export";
const SPANISH = "Spanish version of the intake form";
const call = <D,>(page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: D; error?: string }>;
const num = async (page: Page, sel: string) => Number(((await page.locator(sel).first().textContent().catch(() => "")) ?? "").replace(/\D+/g, "") || "0");
const tab = (page: Page, name: RegExp) => page.getByRole("main", { name: "Inbox" }).getByRole("tab", { name });

describe.skipIf(!CHROMIUM)("the slim Inbox (IB-4)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("From chats: two suggestions grouped by client, open in place, Dismiss with Undo, and the tab's number follows", async () => {
    const { page, errors } = await freshPage(h);
    const main = await openInboxView(page, "chats");
    await main.locator("li.ib4-row").first().waitFor();
    expect(await main.locator(".ib4-row-title").allTextContents()).toEqual([SPANISH, FEE]);
    expect(await main.locator(".ib4-group-head").allTextContents()).toEqual([expect.stringMatching(/^Harbor/), expect.stringMatching(/^Northwind/)]);
    await expect(main.getByText("Which loyalty story is next").count()).resolves.toBe(0);
    await expect(tab(page, /^From chats/).locator(".ib4-count").textContent()).resolves.toBe("2");
    // Why it needs an item, on hover; the foot says when the chats were read.
    await expect(main.locator(".ib4-row-head").first().getAttribute("title")).resolves.toMatch(/^Why: /);
    await main.getByText(/Chats last checked/).waitFor();
    // The tab's number is suggestions plus late or due-today promises.
    const badge = () => num(page, ".topbar .count[aria-label$='need you']");
    await expect.poll(badge).toBeGreaterThanOrEqual(2);
    const before = await badge();
    // Open in place: why, the summary, the three actions and the messages with Open in Teams.
    const row = await openInboxItem(page, FEE);
    await row.getByText(/Why it needs an item/).waitFor();
    for (const a of ["Create item", "Already covered", "Dismiss"]) await row.getByRole("button", { name: new RegExp(`^${a}`) }).waitFor();
    await row.getByRole("region", { name: "Messages" }).getByText(/delivery fee as its own column/).first().waitFor();
    await row.getByRole("link", { name: "Open in Teams" }).first().waitFor();
    // Create item (C) opens the form drafted from the conversation; nothing is written until its preview.
    await page.keyboard.press("c");
    await row.getByRole("form", { name: "Create DevOps item" }).waitFor();
    await page.keyboard.press("Escape");
    // Already covered (L) searches the client's items.
    await row.getByRole("button", { name: /^Already covered/ }).click();
    await row.locator(".ib-form").waitFor();
    // Dismiss (X): gone for me, the numbers drop together, and Undo brings it back.
    await row.locator(".ib4-row-head").focus();
    await page.keyboard.press("x");
    await expect.poll(() => main.locator(".ib4-row-title").allTextContents()).toEqual([SPANISH]);
    await expect.poll(badge).toBe(before - 1);
    await expect(tab(page, /^From chats/).locator(".ib4-count").textContent()).resolves.toBe("1");
    await main.locator(".ib4-notice").getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => main.locator(".ib4-row-title").allTextContents()).toEqual([SPANISH, FEE]);
    await expect.poll(badge).toBe(before);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Promises: late first; Cleared on their own lists why, and Put back brings one back for good", async () => {
    const { page, errors } = await freshPage(h);
    const main = await openInboxView(page, "promises");
    await main.locator("li.ib4-row").first().waitFor();
    // Grouped by client, late first in each: Northwind's spec for Marcus is late.
    await expect(main.getByRole("region", { name: "Northwind" }).locator("li.ib4-row").first().locator(".ib-tag").textContent()).resolves.toMatch(/late$/);
    await expect(main.getByText("Share a sample pallet label with Priya").count()).resolves.toBe(0);
    const toggle = main.locator(".ib4-cleared-toggle");
    await expect(toggle.textContent()).resolves.toMatch(/^Cleared on their own · 2/);
    await toggle.click();
    const cleared = main.locator("ul.ib4-cleared");
    await cleared.getByText(/#2216 was finished/).waitFor();
    await cleared.getByText(/Not touched for 7 days/).waitFor();
    await cleared.locator("li", { hasText: "Share a sample pallet label with Priya" }).getByRole("button", { name: "Put back" }).click();
    await main.locator("li.ib4-row .ib4-row-title", { hasText: "Share a sample pallet label with Priya" }).waitFor();
    await expect(toggle.textContent()).resolves.toMatch(/^Cleared on their own · 1/);
    // Reading the list again doesn't clear it a second time.
    await page.reload();
    await page.getByRole("main", { name: "Inbox" }).locator("li.ib4-row .ib4-row-title", { hasText: "Share a sample pallet label with Priya" }).waitFor();
    // D marks the open promise done.
    const p = await openInboxItem(page, "Share a sample pallet label with Priya");
    await p.getByRole("button", { name: /^Done/ }).first().waitFor();
    await page.keyboard.press("d");
    await expect.poll(() => page.getByRole("main", { name: "Inbox" }).locator(".ib4-row-title", { hasText: "Share a sample pallet label with Priya" }).count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the list I used last comes back; old links land on the nearest list; a conversation that isn't waiting says so", async () => {
    const { page, errors } = await freshPage(h);
    const main = await openInboxView(page, "captures");
    await main.getByRole("region", { name: "Capture" }).waitFor();
    await page.keyboard.press("1");
    await page.locator("main.today-view").waitFor();
    await page.evaluate(() => (location.hash = "#/inbox"));
    await expect.poll(async () => tab(page, /^Captures/).getAttribute("aria-selected")).toBe("true");
    for (const [slug, list] of [["needs-you", /^From chats/], ["waiting", /^From chats/], ["chatter", /^From chats/], ["in-progress", /^Promises/], ["my-promises", /^Promises/]] as const) {
      await page.evaluate((s) => (location.hash = `#/inbox/${s}`), slug);
      await expect.poll(async () => tab(page, list).getAttribute("aria-selected"), slug).toBe("true");
    }
    // One conversation that isn't a suggestion (which story is next): it says so, with its chat in Teams.
    const convs = await call<{ needsYou: { id: number; title: string }[]; inProgress: { id: number; title: string }[]; teammates: { id: number; title: string }[] }>(page, "conversations.list", {});
    const next = [...convs.data.needsYou, ...convs.data.inProgress, ...convs.data.teammates].find((c) => c.title === "Which loyalty story is next")!;
    await page.evaluate((id) => (location.hash = `#/inbox/conversation/${id}`), next.id);
    await page.getByText("This conversation isn't waiting for anything.").waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("keys never fire while typing, and Day's From chats chip opens the list", async () => {
    const { page, errors } = await freshPage(h);
    const main = await openInboxView(page, "chats");
    await main.locator("li.ib4-row").first().waitFor();
    await openInboxItem(page, FEE);
    await main.getByRole("button", { name: /^Already covered/ }).click();
    await main.locator(".ib-form input").first().focus();
    await page.keyboard.type("x d j");
    await expect(main.locator(".ib4-row-title").allTextContents()).resolves.toEqual([SPANISH, FEE]);
    await page.keyboard.press("Escape");
    // Day: the chip beside the strip.
    await page.keyboard.press("1");
    const chip = page.locator("a.att-chip.from-chats");
    await expect(chip.textContent()).resolves.toMatch(/From chats · 2/);
    await chip.click();
    await expect.poll(async () => tab(page, /^From chats/).getAttribute("aria-selected")).toBe("true");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("phone (390 px, 17 px root font): no sideways scroll on any list or an open row", async () => {
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
    const wide = () => page.evaluate(() => {
      const d = document.scrollingElement!;
      const over = [...document.querySelectorAll<HTMLElement>("main.ib4, main.ib4 *")].filter((e) => getComputedStyle(e).overflowX !== "visible").map((e) => e.scrollWidth - e.clientWidth);
      return { page: d.scrollWidth - d.clientWidth, worst: Math.max(0, ...over) };
    });
    for (const slug of ["chats", "promises", "captures"]) {
      await page.evaluate((s) => (location.hash = `#/inbox/${s}`), slug);
      await page.locator("main.ib4").waitFor();
      await page.waitForTimeout(400);
      expect(await wide(), slug).toEqual({ page: 0, worst: 0 });
    }
    await page.evaluate(() => (location.hash = "#/inbox/chats"));
    await page.locator("li.ib4-row .ib4-row-head").first().click();
    await page.locator("li.ib4-row.open").waitFor();
    await page.waitForTimeout(400);
    expect(await wide(), "open row").toEqual({ page: 0, worst: 0 });
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
