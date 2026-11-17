// Was e2e/mb1.test.ts (MB-1) until BT-1.
// MB-1: the phone overhaul in the browser, demo mode (Mon Nov 2, 9:30 AM), at 360 and 390 px with the iPhone's 17 px
// root font. PH-1 replaced the bar (Day, Week, Capture, Inbox, More; Ask in the top bar), the Now card and the
// status dot (More › Everything else › Sources); e2e/phone/now-and-more.test.ts tests those. Here: the computer's tabs
// unchanged; Ahead's notice and Open anyway; today's to-dos by block; the to-do sheet (Done,
// Move to tomorrow, Snooze, Add time, each with Undo where it changes my plan; focus kept inside, Esc, focus back);
// Week rows at 360 with the title on its own line; the status sheet and no source footer on the phone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { call, phonePage, planMonday } from "../mb1-helpers.ts";

const T = 180_000;
const MON = "2026-11-02";
let h: Harness;

async function at(page: Page, hash: string): Promise<void> {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.reload();
  await page.waitForSelector(".topbar");
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
}
type PickRow = { id: number; title: string; status: string; date: string; half: string };
async function picks(page: Page, date: string): Promise<PickRow[]> {
  const r = (await call(page, "week.load", {})) as unknown as { data: { plan: Record<string, { picks: PickRow[] } | undefined> } };
  return r.data.plan[date]?.picks ?? [];
}
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

describe.skipIf(!CHROMIUM)("MB-1: the phone overhaul", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(() => h?.stop());

  it("the bar is Day, Week, Capture, Inbox, More (PH-1); Capture and Ask open; the computer keeps its tabs", async () => {
    const page = await phonePage(h, 390);
    await at(page, "#/today");
    const bar = page.locator(".bottom-bar");
    expect(await bar.locator(".pb-tab .pb-label").allTextContents()).toEqual(["Day", "Week", "Inbox", "More"]);
    expect(await bar.getByText("Backlog").count()).toBe(0);
    expect(await bar.locator(".pb-count").count()).toBe(1);
    // The raised Capture: at least 56 px, labelled, opens the capture sheet.
    const cap = bar.getByRole("button", { name: "Capture" });
    const box = (await cap.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(56);
    await cap.click();
    await page.locator(".cap-dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".cap-dialog").waitFor({ state: "detached" });
    // Ask (PH-1: in the top bar): the assistant over the whole screen, down to the bar.
    await page.locator(".topbar").getByRole("button", { name: "Ask the assistant" }).click();
    const panel = page.getByTestId("assistant-panel");
    await panel.waitFor();
    const pb = (await panel.boundingBox())!;
    expect(pb.y).toBeLessThanOrEqual(1);
    expect(Math.round(pb.width)).toBe(390);
    // The header (PH-1): the date, the VM and Ask; no +, no status dot, no ⋯.
    expect(await page.locator(".topbar .phone-capture, .topbar .assistant-btn, .topbar .status-dot-btn, .topbar .top-more").count()).toBe(0);
    await page.close();

    const { page: desk } = await freshPage(h);
    await at(desk, "#/today");
    expect((await desk.locator(".topbar nav.views").textContent())!.replace(/\d+/g, "")).toMatch(/Day.*Week.*Backlog.*Status.*Inbox/);
    expect(await desk.locator(".bottom-bar, .status-dot-btn").count()).toBe(0);
    expect(await desk.locator("footer.statusbar").count()).toBe(1);
    await desk.close();
  }, T);

  it("Backlog on the phone: the notice, then Open anyway shows it", async () => {
    const page = await phonePage(h, 360);
    await at(page, "#/ahead");
    await page.getByRole("heading", { name: "Backlog is made for a bigger screen" }).waitFor();
    await page.getByRole("button", { name: "Open anyway" }).click();
    await page.waitForSelector(".phone-ro");
    expect(await page.getByRole("heading", { name: "Backlog is made for a bigger screen" }).count()).toBe(0);
    await page.close();
  }, T);

  it("Day (PH-1): to-dos by block under Today; no urgent strip or Promises due list (the Inbox has them)", async () => {
    const page = await phonePage(h, 390);
    await planMonday(page);
    await at(page, "#/today");
    await page.locator(".pn-card").waitFor();
    expect(await page.locator(".urgent-strip, .ph-urgent-head").count()).toBe(0);
    expect(await page.getByRole("heading", { name: /Promises due/i }).count()).toBe(0);
    // To-dos by block: the long title keeps two lines, the second line says time, size and client.
    expect(await page.locator(".ph-block-head").allTextContents()).toEqual([expect.stringMatching(/^Cooptimize/), expect.stringMatching(/^Northwind/)]);
    const line = page.locator(".ph-todo-line").first();
    expect(await line.textContent()).toMatch(/M 2h · Cooptimize/);
    expect(await page.locator(".pn-next-row").count()).toBeGreaterThan(0);
    expect(await noSideways(page)).toBe(0);
    await page.close();
  }, T);

  it("the to-do sheet: focus kept inside, Esc and focus back; Done, Move to tomorrow and Snooze run at once with Undo; Add time opens the time menu", async () => {
    const page = await phonePage(h, 360);
    await planMonday(page);
    await at(page, "#/today");
    const title = "Review open pull requests";
    const row = page.locator(".ph-todo-main", { hasText: title });
    await row.click();
    const sheet = page.getByRole("dialog", { name: `To-do: ${title}` });
    await sheet.waitFor();
    // Focus starts inside and Tab stays inside.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await sheet.evaluate((s) => s.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached" });
    // Focus goes back on the next frame (useReturnFocus); a busy page's frame can come after this line.
    await expect.poll(() => row.evaluate((b) => b === document.activeElement)).toBe(true);

    // Done, then Undo.
    await row.click();
    await sheet.getByRole("button", { name: "Done", exact: true }).click();
    await expect.poll(async () => (await picks(page, MON)).find((p) => p.title === title)?.status).toBe("done");
    await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await picks(page, MON)).find((p) => p.title === title)?.status).toBe("planned");

    // Move to tomorrow, then Undo.
    await row.click();
    await sheet.getByRole("button", { name: "Move to tomorrow" }).click();
    await expect.poll(async () => (await picks(page, "2026-11-03")).some((p) => p.title === title && p.status === "planned")).toBe(true);
    await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await picks(page, "2026-11-03")).some((p) => p.title === title && p.status === "planned")).toBe(false);
    await expect.poll(async () => (await picks(page, MON)).find((p) => p.title === title && p.half === "AM")?.status).toBe("planned");

    // Snooze to this afternoon, then Undo.
    await at(page, "#/today");
    await row.click();
    await sheet.getByRole("button", { name: "Snooze to this afternoon" }).click();
    await expect.poll(async () => (await picks(page, MON)).some((p) => p.title === title && p.half === "PM" && p.status === "planned")).toBe(true);
    await page.locator(".undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await picks(page, MON)).some((p) => p.title === title && p.half === "PM" && p.status === "planned")).toBe(false);

    // Add time: the same time menu as the ⋯ menu.
    await at(page, "#/today");
    await row.click();
    await sheet.getByRole("button", { name: "Add time" }).click();
    await page.getByRole("menu").waitFor();
    await page.keyboard.press("Escape");
    await page.close();
  }, T);

  it("Week at 360: each row's title on its own line, never squeezed; the agenda folded; ⋯ opens the same sheet", async () => {
    const page = await phonePage(h, 360);
    await planMonday(page);
    await at(page, "#/week");
    const rows = page.locator(".grid.narrow .ph-row");
    await rows.first().waitFor();
    const widths = await rows.evaluateAll((els) => els.map((r) => ({ row: r.getBoundingClientRect().width, title: r.querySelector(".pr-title")!.getBoundingClientRect().width })));
    for (const w of widths) expect(w.title / w.row).toBeGreaterThan(0.6);
    const fold = page.locator(".card-agenda-fold").first();
    // WD-1: meetings are one summary line ("3 meetings · 1h 30m · 2h free") that expands to the list.
    expect(await fold.textContent()).toMatch(/\d+ meetings? · .* free$/);
    expect(await page.locator(".grid.narrow .card-events").count()).toBe(0);
    await fold.click();
    expect(await page.locator(".grid.narrow .card-events").count()).toBe(1);
    await rows.first().locator(".ph-more").click();
    await page.getByRole("dialog", { name: /^To-do: / }).waitFor();
    await page.keyboard.press("Escape");
    expect(await noSideways(page)).toBe(0);
    // Add work on the phone: a bottom sheet, nothing sideways.
    await at(page, `#/week/day/${MON}`);
    await page.locator("aside.block-panel.sheet").waitFor();
    expect(await noSideways(page)).toBe(0);
    await page.close();
  }, T);

  it("More › Everything else › Sources opens the sources sheet (PH-1: was the status dot); no source footer on the phone", async () => {
    const page = await phonePage(h, 390);
    await at(page, "#/today");
    expect(await page.locator("footer.statusbar").count()).toBe(0);
    await page.locator(".bottom-bar").getByRole("button", { name: /^More/ }).click();
    await page.getByRole("button", { name: /Everything else/ }).click();
    const dot = page.locator('.mr-row[data-row="sources"]');
    expect(await dot.locator(".mr-line").textContent()).toBe("All sources live");
    await dot.click();
    const sheet = page.getByRole("dialog", { name: "Sources" });
    await sheet.waitFor();
    expect(await sheet.locator(".ph-status-list li").count()).toBeGreaterThan(1);
    expect(await sheet.getByRole("button", { name: "Refresh all sources" }).count()).toBe(1);
    await sheet.getByRole("button", { name: "Connect or disconnect in Settings" }).waitFor();
    await sheet.getByRole("button", { name: "Close" }).click();
    await sheet.waitFor({ state: "detached" });
    await page.close();
  }, T);

  it("at 360 and the largest Text size (and a 21 px root font): no sideways scroll on the phone's screens; the bar's and the sheet's targets at least 44 px", async () => {
    const page = await phonePage(h, 360);
    await planMonday(page);
    await page.addStyleTag({ content: "html{font-size:21px}" });
    const big = async () => {
      await page.evaluate(() => {
        document.documentElement.setAttribute("data-text-size", "larger");
        const st = document.createElement("style");
        st.textContent = "html{font-size:21px}";
        document.head.append(st);
      });
      await page.waitForTimeout(200);
    };
    for (const hash of ["#/day", "#/week", `#/week/day/${MON}`, "#/week/2026-11-09/add", "#/status", "#/inbox/needs-you", "#/ahead"]) {
      await at(page, hash);
      await big();
      expect(await noSideways(page), hash).toBe(0);
    }
    await at(page, "#/today");
    await big();
    const small = await page.locator(".bottom-bar button, .bottom-bar a").evaluateAll((els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).length);
    expect(small).toBe(0);
    await page.locator(".ph-todo-main").first().click();
    const sheet = page.getByRole("dialog", { name: /^To-do: / });
    await sheet.waitFor();
    const tiny = await sheet.locator("button").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44).length);
    expect(tiny).toBe(0);
    expect(await noSideways(page)).toBe(0);
    await page.close();
  }, T);
});
