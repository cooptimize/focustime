// IB-1 slice 2: the Inbox is one list with views. Demo mode, clock pinned to Mon Nov 2, 9:30 AM. The counts agree (the
// tab's badge, the rail's Needs you and the list header are one number), old deep links open their item in the detail
// pane, the keys do what their buttons do and never fire while typing, and on a phone nothing scrolls sideways on any
// Inbox screen (every view, the picker sheet, an item sheet, Close the loop in it). The rules are unit tests
// (ui/inbox/model.test.ts, ui/nav.test.ts, actions/inbox-actions.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, openInboxItem, openInboxView, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

let h: Harness;
const T = 180_000;
const SLUGS = ["needs-you", "promises", "waiting", "in-progress", "captures", "teammates", "done", "chatter"] as const;
const call = <D,>(page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: D; error?: string }>;
const hash = (page: Page) => page.evaluate(() => location.hash);
const num = async (page: Page, sel: string) => Number(((await page.locator(sel).first().textContent()) ?? "").replace(/\D+/g, "") || "0");
type Row = { key: string; kind: string; title: string; views: string[] };

describe.skipIf(!CHROMIUM)("the Inbox (IB-1)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("one count: the tab's badge, the rail's Needs you and the header agree, also after an action", async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("4");
    const main = await openInboxView(page, "needs-you");
    await main.locator(".ib-row").first().waitFor();
    const rail = main.getByRole("navigation", { name: "Inbox views and clients" });
    const read = async () => ({
      badge: await num(page, ".topbar .count[aria-label$='need you']"),
      rail: Number((await rail.getByRole("button", { name: /^Needs you/ }).locator(".count").textContent()) ?? "-1"),
      header: Number((await main.locator(".ib-list-head h2 .muted").textContent()) ?? "-1"),
      rows: await main.locator(".ib-row").count(),
    });
    const first = await read();
    expect(first.badge).toBeGreaterThan(0);
    expect(first).toEqual({ badge: first.badge, rail: first.badge, header: first.badge, rows: first.badge });
    // Hide one for me (H): every count drops by one, together.
    await main.locator(".ib-row").first().click();
    await page.locator(".ib-pane .ib-detail-title").waitFor();
    await page.keyboard.press("h");
    await expect.poll(async () => (await read()).rail).toBe(first.badge - 1);
    const after = await read();
    expect([after.badge, after.header]).toEqual([first.badge - 1, first.badge - 1]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("slice 3: each Needs you row says why; Snooze takes it out of the counts until then, and it can be woken", async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("4");
    const main = await openInboxView(page, "needs-you");
    await main.locator(".ib-row").first().waitFor();
    const rail = main.getByRole("navigation", { name: "Inbox views and clients" });
    const needs = async () => Number((await rail.getByRole("button", { name: /^Needs you/ }).locator(".count").textContent()) ?? "-1");
    const rows = (await call<{ items: (Row & { reason: string | null })[] }>(page, "inbox.list", {})).data.items.filter((r) => r.views.includes("needs_you"));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.reason, r.key).toBeTruthy();
    const pick = rows.find((r) => r.kind === "promise")!;
    const row = main.locator(`.ib-row[data-key="${pick.key}"]`);
    await expect.poll(() => row.locator(".ib-row-sub").textContent()).toContain(pick.reason!);
    await row.click();
    const pane = page.locator(".ib-pane");
    await expect.poll(() => pane.locator(".ib-reason").textContent()).toBe(pick.reason);
    const before = await needs();
    await pane.getByRole("button", { name: /^More for / }).click();
    await pane.getByRole("menuitem", { name: "Snooze…" }).click();
    const form = pane.getByRole("form", { name: "Snooze" });
    expect(await form.getByRole("button").allTextContents()).toEqual(expect.arrayContaining(["Later today", "Tomorrow", "Next week"]));
    await form.getByRole("button", { name: "Tomorrow" }).click();
    await expect.poll(needs).toBe(before - 1);
    // The due day is unchanged; the folded group brings it back to look at, and Wake it now returns it.
    const listed = (await call<{ items: (Row & { due: string | null; snoozedUntil: string | null })[] }>(page, "inbox.list", {})).data.items.find((r) => r.key === pick.key)!;
    expect(listed.views).toEqual([]);
    expect(listed.snoozedUntil).toBeTruthy();
    await main.getByRole("button", { name: /^\d+ snoozed$/ }).click();
    await main.getByRole("region", { name: "Snoozed" }).locator(`.ib-row[data-key="${pick.key}"]`).click();
    await expect.poll(() => pane.locator(".ib-snoozed").textContent()).toMatch(/^Snoozed until tomorrow /);
    await pane.getByRole("button", { name: /^More for / }).click();
    await pane.getByRole("menuitem", { name: "Wake it now" }).click();
    // Back in its views (opened, so seen: a promise due later stays in Promises only), and the counts agree again.
    await expect.poll(async () => (await call<{ items: Row[] }>(page, "inbox.list", {})).data.items.find((r) => r.key === pick.key)?.views.length).toBeGreaterThan(0);
    const server = (await call<{ needsYou: number }>(page, "inbox.count", {})).data.needsYou;
    await expect.poll(needs).toBe(server);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("old deep links open their item in the detail pane", async () => {
    const { page, errors } = await freshPage(h);
    const rows = (await call<{ items: Row[] }>(page, "inbox.list", {})).data.items;
    const conv = rows.find((r) => r.kind === "conversation")!;
    const chat = rows.find((r) => r.key.startsWith("c"))!;
    const mine = rows.find((r) => r.key.startsWith("f"))!;
    for (const [old, key, title] of [
      [`#/inbox/conversation/${conv.key.slice(1)}`, conv.key, conv.title],
      [`#/inbox/promise/${chat.key.slice(1)}`, chat.key, chat.title],
      [`#/inbox/${mine.key.slice(1)}`, mine.key, mine.title],
    ] as const) {
      await page.evaluate((x) => (location.hash = x), old);
      await expect.poll(() => hash(page), { message: old }).toBe(`#/inbox/item/${key}`);
      await page.locator(".ib-pane .ib-detail-title", { hasText: title }).waitFor();
      await expect(page.locator(`.ib-row[data-key="${key}"]`).getAttribute("aria-current")).resolves.toBe("true");
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("keys do what their buttons do, and never while typing", async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("4");
    const main = await openInboxView(page, "promises");
    await main.locator(".ib-row").first().waitFor();
    const keys = await main.locator(".ib-row").evaluateAll((rs) => rs.map((r) => r.getAttribute("data-key")));
    // J and K move the open item; Enter puts the focus on it.
    await page.keyboard.press("j");
    await expect.poll(() => hash(page)).toBe(`#/inbox/item/${keys[1]}`);
    await page.keyboard.press("k");
    await expect.poll(() => hash(page)).toBe(`#/inbox/item/${keys[0]}`);
    // F opens the same form as the Due button; L the same as Close the loop.
    const pane = page.locator(".ib-pane");
    await page.keyboard.press("f");
    await pane.getByRole("button", { name: "Next Monday" }).waitFor();
    await page.keyboard.press("Escape");
    await pane.getByRole("button", { name: "Due" }).click();
    await pane.getByRole("button", { name: "Next Monday" }).waitFor();
    await page.keyboard.press("Escape");
    await page.keyboard.press("l");
    const form = pane.locator("form.close-loop");
    await form.waitFor();
    // While typing in the note, the letters are text, not actions.
    await form.locator("textarea").fill("");
    await form.locator("textarea").type("hjkl fewn");
    await expect(form.locator("textarea").inputValue()).resolves.toBe("hjkl fewn");
    await expect.poll(() => hash(page)).toBe(`#/inbox/item/${keys[0]}`);
    await form.getByRole("button", { name: "Cancel" }).click();
    // The filter box is a text field too.
    await main.getByRole("searchbox", { name: "Filter the list" }).fill("j");
    await expect.poll(() => hash(page)).toBe(`#/inbox/item/${keys[0]}`);
    await main.getByRole("searchbox", { name: "Filter the list" }).fill("");
    // ? lists them.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("?");
    await page.getByRole("dialog", { name: "Inbox keys" }).waitFor();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("phone (390 px, 17 px root font): no sideways scroll on any view, the picker, an item sheet or Close the loop", async () => {
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
      const over = [...document.querySelectorAll<HTMLElement>(".ib, .ib-sheet")].map((e) => e.scrollWidth - e.clientWidth);
      return { page: d.scrollWidth - d.clientWidth, worst: Math.max(0, ...over) };
    });
    for (const slug of SLUGS) {
      await page.evaluate((s) => (location.hash = `#/inbox/${s}`), slug);
      await page.locator("main.ib-phone").waitFor();
      await page.waitForTimeout(400);
      expect(await wide(), slug).toEqual({ page: 0, worst: 0 });
    }
    // The picker sheet.
    await page.evaluate(() => (location.hash = "#/inbox/needs-you"));
    await page.locator(".ib-pick-btn").first().click();
    await page.getByRole("dialog", { name: "View and clients" }).waitFor();
    expect(await wide(), "picker").toEqual({ page: 0, worst: 0 });
    await shotBoth(page, "ib1-phone-picker");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "View and clients" }).waitFor({ state: "detached" });
    // An item sheet, then Close the loop in it.
    await page.evaluate(() => (location.hash = "#/inbox/promises"));
    await page.locator(".ib-row").first().click();
    await page.locator(".ib-sheet").last().waitFor();
    expect(await wide(), "item sheet").toEqual({ page: 0, worst: 0 });
    await shotBoth(page, "ib1-phone-item");
    await page.locator(".ib-sheet").last().getByRole("button", { name: /^Close the loop/ }).first().click();
    await page.locator(".ib-sheet form.close-loop").waitFor();
    expect(await wide(), "close the loop").toEqual({ page: 0, worst: 0 });
    await shotBoth(page, "ib1-phone-close-loop");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it.skipIf(!SHOTS)("screenshots: every view at 1920, 1366, Larger and phone, light and dark", async () => {
    for (const theme of ["cooptimize-light", "cooptimize-dark"]) {
      const tag = theme.endsWith("dark") ? "dark" : "light";
      for (const [size, vp] of [["1920", { width: 1920, height: 1080 }], ["1366", { width: 1366, height: 768 }]] as const) {
        const { page } = await freshPage(h, vp);
        expect((await call(page, "ui.set_theme", { theme })).ok).toBe(true);
        await page.reload();
        await page.waitForSelector(".topbar");
        for (const slug of SLUGS) {
          await page.evaluate((x) => (location.hash = `#/inbox/${x}`), slug);
          await page.locator("main.ib").waitFor();
          await page.waitForTimeout(600);
          // At 1920 both text sizes (shotBoth); at 1366 the default only.
          if (size === "1920") await shotBoth(page, `ib1-${slug}-${size}-${tag}`);
          else await page.screenshot({ path: `${SHOTS}/ib1-${slug}-${size}-${tag}.png` });
        }
        await page.close();
      }
      const page = await h.browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, bypassCSP: true });
      await page.addInitScript(() => localStorage.setItem("focustime.hint.flow", "dismissed"));
      await page.goto(h.url);
      await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
      await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
      await page.locator("main.today-view").waitFor();
      expect((await call(page, "ui.set_theme", { theme })).ok).toBe(true);
      await page.reload();
      await page.locator("main.today-view").waitFor();
      for (const slug of SLUGS) {
        await page.evaluate((x) => (location.hash = `#/inbox/${x}`), slug);
        await page.locator("main.ib-phone").waitFor();
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${SHOTS}/ib1-${slug}-phone-${tag}.png`, fullPage: true });
      }
      await page.close();
    }
  }, 600_000);

  it.skipIf(!SHOTS)("screenshots, slice 3: a reason and the Snooze form, the snoozed group, the Chatter pane", async () => {
    for (const theme of ["cooptimize-light", "cooptimize-dark"]) {
      const tag = theme.endsWith("dark") ? "dark" : "light";
      const { page } = await freshPage(h, { width: 1920, height: 1080 });
      expect((await call(page, "ui.set_theme", { theme })).ok).toBe(true);
      await page.reload();
      await page.waitForSelector(".topbar");
      const main = await openInboxView(page, "needs-you");
      await main.locator(".ib-row").first().waitFor();
      const promise = main.locator('.ib-row[data-key^="f"], .ib-row[data-key^="c"]').first();
      await promise.click();
      const pane = page.locator(".ib-pane");
      await pane.getByRole("button", { name: /^More for / }).click();
      await pane.getByRole("menuitem", { name: "Snooze…" }).click();
      await page.waitForTimeout(300);
      await shotBoth(page, `ib1-s3-snooze-1920-${tag}`);
      await pane.getByRole("form", { name: "Snooze" }).getByRole("button", { name: "Tomorrow" }).click();
      await main.getByRole("button", { name: /^\d+ snoozed$/ }).click();
      await page.waitForTimeout(300);
      await shotBoth(page, `ib1-s3-snoozed-1920-${tag}`);
      const key = await promise.getAttribute("data-key");
      expect((await call(page, "inbox.snooze", { key, until: null })).ok).toBe(true);
      await openInboxView(page, "chatter");
      await page.waitForTimeout(600);
      await shotBoth(page, `ib1-s3-chatter-1920-${tag}`);
      await page.close();
    }
  }, 300_000);

  it("a promise I added and a linked chat promise both offer every action", async () => {
    const { page, errors } = await freshPage(h);
    await openInboxView(page, "promises");
    const rows = (await call<{ items: Row[] }>(page, "inbox.list", {})).data.items.filter((r) => r.views.includes("promises"));
    for (const r of [rows.find((x) => x.key.startsWith("f"))!, rows.find((x) => x.key.startsWith("c"))!]) {
      const pane = await openInboxItem(page, r.title);
      const acts = await pane.locator(".ib-acts [data-act]").evaluateAll((bs) => bs.map((b) => b.getAttribute("data-act")));
      await pane.getByRole("button", { name: /^More for/ }).click();
      const more = await pane.locator(".fu-menu [data-act]").evaluateAll((bs) => bs.map((b) => b.getAttribute("data-act")));
      await page.keyboard.press("Escape");
      for (const id of ["close", "due", "who", "week", "done", "not_needed", "hide"]) expect([...acts, ...more], `${r.key} ${id}`).toContain(id);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
