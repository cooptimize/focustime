// MB-1: the phone overhaul in the browser, demo mode (Mon Nov 2, 9:30 AM), at 360 and 390 px with the iPhone's 17 px
// root font: the bottom bar (Today, Week, Capture, Inbox, Ask; no Ahead) and the computer's tabs unchanged; Ahead's
// notice and Open anyway; the Now card; the urgent strip capped at 3 with "N more in Inbox"; the to-do sheet (Done,
// Move to tomorrow, Snooze, Add time, each with Undo where it changes my plan; focus kept inside, Esc, focus back);
// Week rows at 360 with the title on its own line; the status sheet and no source footer on the phone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { call, phonePage, planMonday } from "./mb1-helpers.ts";

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

  it("the bar is Today, Week, Capture, Inbox, Ask; Capture and Ask open; the computer keeps its four tabs", async () => {
    const page = await phonePage(h, 390);
    await at(page, "#/today");
    const bar = page.locator(".bottom-bar");
    expect(await bar.locator(".bb-tab").allTextContents()).toEqual(["Today", "Week", expect.stringMatching(/^Inbox/), "Ask"]);
    expect(await bar.getByText("Ahead").count()).toBe(0);
    expect(await bar.locator(".bb-count").count()).toBe(1);
    // The raised Capture: at least 56 px, labelled, opens the capture sheet.
    const cap = bar.getByRole("button", { name: "Capture" });
    const box = (await cap.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(56);
    await cap.click();
    await page.locator(".cap-dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".cap-dialog").waitFor({ state: "detached" });
    // Ask: the assistant over the whole screen, down to the bar.
    await bar.getByRole("button", { name: "Ask the assistant" }).click();
    const panel = page.getByTestId("assistant-panel");
    await panel.waitFor();
    const pb = (await panel.boundingBox())!;
    expect(pb.y).toBeLessThanOrEqual(1);
    expect(Math.round(pb.width)).toBe(390);
    // The header: the logo, the status dot and ⋯ (no + or Ask there now).
    expect(await page.locator(".topbar .phone-capture, .topbar .assistant-btn").count()).toBe(0);
    await page.close();

    const { page: desk } = await freshPage(h);
    await at(desk, "#/today");
    expect((await desk.locator(".topbar nav.views").textContent())!.replace(/\d+/g, "")).toMatch(/Today.*Week.*Ahead.*Inbox/);
    expect(await desk.locator(".bottom-bar, .status-dot-btn").count()).toBe(0);
    expect(await desk.locator("footer.statusbar").count()).toBe(1);
    await desk.close();
  }, T);

  it("Ahead on the phone: the notice, then Open anyway shows it", async () => {
    const page = await phonePage(h, 360);
    await at(page, "#/ahead");
    await page.getByRole("heading", { name: "Ahead is made for a bigger screen" }).waitFor();
    await page.getByRole("button", { name: "Open anyway" }).click();
    await page.waitForSelector(".phone-ro");
    expect(await page.getByRole("heading", { name: "Ahead is made for a bigger screen" }).count()).toBe(0);
    await page.close();
  }, T);

  it("Today: the Now card, one heading over the urgent strip (3 lines at most, then N more in Inbox), to-dos by block, Next up", async () => {
    const page = await phonePage(h, 390);
    await planMonday(page);
    await at(page, "#/today");
    const now = page.locator(".ph-now.ph-now-block");
    await now.waitFor();
    expect(await now.locator(".ph-now-title").textContent()).toBe("Cooptimize");
    expect(await now.locator(".ph-now-line").textContent()).toMatch(/^until 12:30 · 3h left$/);
    expect(await now.locator(".ph-now-meet").textContent()).toMatch(/Next meeting.*11:00 · in 1h 30m/);
    expect(await now.getByRole("button", { name: "Start", exact: true }).count()).toBe(1);
    // The urgent strip: one heading, at most 3 lines, then the rest in the Inbox; no second "Promises due" list.
    expect(await page.locator(".ph-urgent-head").textContent()).toBe("Needs you");
    expect(await page.locator(".urgent-strip .us-item").count()).toBeLessThanOrEqual(3);
    expect(await page.locator(".urgent-strip .us-all").textContent()).toMatch(/^\d+ more in Inbox$/);
    expect(await page.getByRole("heading", { name: /Promises due/i }).count()).toBe(0);
    // To-dos by block: the long title keeps two lines, the second line says time, size and client.
    expect(await page.locator(".ph-block-head").allTextContents()).toEqual([expect.stringMatching(/^Cooptimize/), expect.stringMatching(/^Northwind/)]);
    const line = page.locator(".ph-todo-line").first();
    expect(await line.textContent()).toMatch(/M 2h · Cooptimize/);
    expect(await page.locator(".ph-next-row").count()).toBeGreaterThan(0);
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
    expect(await row.evaluate((b) => b === document.activeElement)).toBe(true);

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
    expect(await fold.textContent()).toMatch(/Agenda.*meeting.*free/);
    expect(await page.locator(".grid.narrow .card-events").count()).toBe(0);
    await fold.click();
    expect(await page.locator(".grid.narrow .card-events").count()).toBe(1);
    await rows.first().locator(".ph-more").click();
    await page.getByRole("dialog", { name: /^To-do: / }).waitFor();
    await page.keyboard.press("Escape");
    expect(await noSideways(page)).toBe(0);
    // Plan today: the agenda folded, Back to the week a small link.
    await at(page, `#/week/day/${MON}`);
    await page.locator(".pd2-fold").first().waitFor();
    expect(await page.locator(".pd-agenda").count()).toBe(0);
    expect(await page.locator(".done-link").textContent()).toMatch(/Back to the week/);
    expect(await noSideways(page)).toBe(0);
    await page.close();
  }, T);

  it("the status dot opens the sources sheet; no source footer on the phone", async () => {
    const page = await phonePage(h, 390);
    await at(page, "#/today");
    expect(await page.locator("footer.statusbar").count()).toBe(0);
    const dot = page.locator(".topbar .status-dot-btn");
    expect(await dot.getAttribute("aria-label")).toMatch(/Show sources$/);
    await dot.click();
    const sheet = page.getByRole("dialog", { name: "Sources" });
    await sheet.waitFor();
    expect(await sheet.locator(".ph-status-list li").count()).toBeGreaterThan(1);
    expect(await sheet.getByRole("button", { name: "Refresh all sources" }).count()).toBe(1);
    await sheet.getByRole("button", { name: "Connect or disconnect in Settings" }).waitFor();
    await sheet.getByRole("button", { name: "Close" }).click();
    await sheet.waitFor({ state: "detached" });
    expect(await dot.evaluate((b) => b === document.activeElement)).toBe(true);
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
    for (const hash of ["#/today", "#/week", `#/week/day/${MON}`, "#/week/commit", "#/week/team", "#/inbox/needs-you", "#/ahead"]) {
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
