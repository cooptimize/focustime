// TX-1: the progress check-in at Midday check-in and Close out, the chip "1h of 2h left", the end of day DevOps offer with
// its preview, and the phone (390 wide, a 17px root font as on iPhone, 44px targets, the page itself scrolling).
// With FOCUSTIME_SHOTS: docs/ux/tx1 (demo data only).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

const T = 240_000;
const MON = "2026-11-02";
const CLOCK = `${MON}T16:40:00-05:00`;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const at = (t: string) => `${MON}T${t}:00-05:00`;
const go = async (page: Page, hash: string) => {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.reload();
};
type Ids = { query: number; chart: number; notes: number };
/** Monday confirmed, with three timeboxes that have ended by the afternoon. */
async function monday(page: Page): Promise<Ids> {
  // FN-1: this test checks the plan's own tick; Wrap it up has its own (e2e/fn1.test.ts), so the sheet stays off here.
  expect((await call(page, "settings.save", { section: "planning", values: { devopsOnDone: "never" } })).ok).toBe(true);
  await page.reload();
  expect((await call(page, "planday.start", { date: MON })).ok).toBe(true);
  const add = async (input: object) => (await call(page, "pick.add", { date: MON, ...input })).data.pick.id as number;
  const query = await add({ half: "AM", clientKey: "Cooptimize", itemId: 4411 });
  const chart = await add({ half: "AM", clientKey: "Cooptimize", itemId: 4412 });
  const notes = await add({ half: "PM", clientKey: "Northwind", intention: "Write the export notes", size: "S" });
  for (const id of [query, chart]) expect((await call(page, "pick.set_size", { id, size: "M" })).ok).toBe(true);
  expect((await call(page, "planday.commit", { date: MON })).ok).toBe(true);
  for (const [pickId, a, b] of [[query, "09:00", "10:00"], [chart, "10:00", "11:00"], [notes, "13:00", "14:00"]] as const) expect((await call(page, "timebox.add", { pickId, date: MON, start: at(a), end: at(b) })).ok).toBe(true);
  return { query, chart, notes };
}
const row = (page: Page, title: string) => page.locator(".tc-row", { hasText: title });
const log = async (page: Page) => (await call(page, "devops.log", {})).data.entries as { op: string; kind?: string; itemId: number; status: string }[];

describe.skipIf(!CHROMIUM)("TX-1 timeboxes and check-ins (browser, demo mode)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, CLOCK);
  }, T);
  afterAll(async () => h?.stop());

  it("asks only at the two moments; Partly, Didn't get to it and Done work, with Undo; the chip shows what's left", async () => {
    const { page, errors } = await freshPage(h);
    const ids = await monday(page);
    await go(page, "#/today");
    await page.locator(".today-block, .tt-check, .pick-row").first().waitFor();
    expect(await page.locator(".tc-box").count()).toBe(0);
    await go(page, "#/week");
    await page.locator(".week-card, .wk-card, .card").first().waitFor();
    expect(await page.locator(".tc-box").count()).toBe(0);

    await go(page, "#/today/checkin");
    await page.locator(".tc-box").waitFor();
    await expect.poll(() => page.locator(".tc-row").count()).toBe(3);
    await shotBoth(page, "tx1-midday-checkin", page.locator(".tc-box"));

    const query = row(page, "Timesheet summary query");
    await query.getByRole("button", { name: "Partly" }).click();
    await query.getByRole("button", { name: "1h", exact: true }).waitFor();
    if (SHOTS) await shotBoth(page, "tx1-partly", page.locator(".tc-box"));
    await query.getByRole("button", { name: "1h", exact: true }).click();
    await query.locator(".tc-said", { hasText: "1h left" }).waitFor();
    const p = (await call(page, "week.load", {})).data.plan[MON].picks.find((x: { id: number }) => x.id === ids.query);
    expect(p).toMatchObject({ remainingMinutes: 60, spentMinutes: 60, size: "M" });

    // Undo gives the row its three answers back.
    await query.getByRole("button", { name: "Undo" }).click();
    await query.getByRole("button", { name: "Partly" }).waitFor();
    await query.getByRole("button", { name: "Partly" }).click();
    await query.getByRole("button", { name: "1h", exact: true }).click();
    await query.locator(".tc-said", { hasText: "1h left" }).waitFor();

    await row(page, "Write the export notes").getByRole("button", { name: "Didn't get to it" }).click();
    await row(page, "Write the export notes").locator(".tc-said").waitFor();

    await go(page, "#/today");
    await page.locator(".size-chip", { hasText: "1h of 2h left" }).first().waitFor();
    await shotBoth(page, "tx1-chip", page.locator(".size-chip", { hasText: "1h of 2h left" }).first());
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Close out rolls up what's unanswered and offers one batched DevOps update, previewed and confirmed", async () => {
    const { page, errors } = await freshPage(h);
    await monday(page);
    // The earlier test's answers belong to its own demo session, so this one starts clean.
    await go(page, "#/today/closeout");
    await page.locator(".closeout-panel .tc-box").waitFor();
    await expect.poll(() => page.locator(".tc-row").count()).toBe(3);
    expect(await page.locator(".tc-offer").count()).toBe(0);
    for (const t of ["Timesheet summary query"]) {
      await row(page, t).getByRole("button", { name: "Partly" }).click();
      await row(page, t).getByRole("button", { name: "1h", exact: true }).click();
      await row(page, t).locator(".tc-said").waitFor();
    }
    const chart = page.locator(".tc-row").filter({ hasNot: page.locator(".tc-said") }).first();
    await chart.getByRole("button", { name: "Partly" }).click();
    await chart.getByRole("button", { name: "1.5h", exact: true }).click();
    await page.locator(".tc-offer").waitFor();
    await expect.poll(() => page.locator(".tc-offer").textContent()).toContain("Update Remaining Work on 2 stories?");
    await shotBoth(page, "tx1-end-of-day-offer", page.locator(".tc-offer"));
    const before = (await log(page)).length;
    await page.locator(".tc-offer").getByRole("button", { name: "Review" }).click();
    await page.locator(".tc-preview").waitFor();
    await expect.poll(() => page.locator(".tc-preview").textContent()).toContain("Remaining Work");
    await shotBoth(page, "tx1-end-of-day-preview", page.locator(".tc-preview"));
    // Previewing wrote nothing.
    expect((await log(page)).length).toBe(before);
    await page.locator(".tc-preview").getByRole("button", { name: "Confirm 2" }).click();
    await page.locator(".tc-preview .db-ok").first().waitFor();
    await expect.poll(async () => (await log(page)).length).toBe(before + 2);
    // Offered once: gone after a reload.
    await go(page, "#/today/closeout");
    await page.locator(".closeout-panel").waitFor();
    await page.waitForTimeout(800);
    expect(await page.locator(".tc-offer").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("TX-1b: All went to plan on a page left open: an error offers Retry, a row answered elsewhere goes, every applied row has Undo, a Done gets PK-1's offer", async () => {
    const { page, errors } = await freshPage(h);
    const ids = await monday(page);
    await go(page, "#/today/checkin");
    await page.locator(".tc-box").waitFor();
    await expect.poll(() => page.locator(".tc-row").count()).toBe(3);
    // Answered in Teams while this page sat open.
    expect((await call(page, "checkin.answer", { date: MON, moment: "midday", pickId: ids.chart, answer: "partly", left: 60 })).ok).toBe(true);
    let failOnce = true;
    const asked: number[][] = [];
    await page.route("**/api/action", async (r) => {
      const body = JSON.parse(r.request().postData() ?? "{}") as { action?: string; input?: { pickIds?: number[] } };
      if (body.action === "checkin.all_to_plan" && failOnce) {
        failOnce = false;
        return r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ ok: false, error: "That timebox was already answered" }) });
      }
      if (body.action === "devops.done_offer") {
        asked.push(body.input?.pickIds ?? []);
        return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { off: false, offers: [{ pickId: ids.notes, clientKey: "Northwind", clientName: "Northwind", itemId: 900, title: "Write the export notes", type: "User Story", state: "Active", choices: ["Closed"], followUpId: null }] } }) });
      }
      return r.continue();
    });
    await page.getByRole("button", { name: "All went to plan" }).click();
    await page.locator(".tc-error", { hasText: "That timebox was already answered" }).waitFor();
    expect(await page.locator(".tc-said").count()).toBe(0);
    await shotBoth(page, "tx1b-retry", page.locator(".tc-box"));
    await page.getByRole("button", { name: "Retry" }).click();
    await page.locator(".tc-said").first().waitFor();
    await expect.poll(() => page.locator(".tc-row").count()).toBe(2);
    expect(await row(page, "Timesheet summary query").getByRole("button", { name: "Undo" }).count()).toBe(1);
    expect(await row(page, "Write the export notes").getByRole("button", { name: "Undo" }).count()).toBe(1);
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toEqual([ids.notes]);
    await page.locator(".tc-box ~ .done-batch, .done-batch").first().waitFor();
    await shotBoth(page, "tx1b-applied-with-offer", page.locator(".tc-box"));
    // An Undo after a stale list works and takes its offer away.
    await row(page, "Write the export notes").getByRole("button", { name: "Undo" }).click();
    await row(page, "Write the export notes").getByRole("button", { name: "Partly" }).waitFor();
    await expect.poll(() => page.locator(".done-batch").count()).toBe(0);
    expect(errors.filter((e) => !e.includes("409"))).toEqual([]);
    await page.close();
  }, T);

  it("TX-1c: a plain tick takes the story's later to-do off with one notice, and Undo puts it back", async () => {
    const { page, errors } = await freshPage(h);
    const ids = await monday(page);
    const TUE = "2026-11-03";
    expect((await call(page, "planday.start", { date: TUE })).ok).toBe(true);
    const tue = (await call(page, "pick.add", { date: TUE, half: "AM", clientKey: "Cooptimize", itemId: 4411 })).data.pick.id as number;
    await go(page, "#/today");
    const status = async () => (await call(page, "week.load", {})).data.plan[TUE].picks.find((x: { id: number }) => x.id === tue)?.status as string;
    await page.locator(".tt-check, .pick-row input[type=checkbox], .pick-check").first().waitFor();
    await page.getByRole("checkbox", { name: /Timesheet summary query/ }).first().click();
    const notice = page.locator(".undo-toast, .deploy-undo, [role=status]", { hasText: "Removed from Tue, story is done" });
    await notice.first().waitFor();
    await expect.poll(() => page.getByText("Removed from Tue, story is done").count()).toBe(1);
    await expect.poll(status).toBe("dropped");
    await shotBoth(page, "tx1c-tick-removed", notice.first());
    await notice.first().getByRole("button", { name: "Undo" }).click();
    await expect.poll(status).toBe("planned");
    expect((await call(page, "week.load", {})).data.plan[MON].picks.find((x: { id: number }) => x.id === ids.query).status).toBe("planned");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("phone: one screen, 44px targets, nothing wider than the phone, the page scrolls", async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    await monday(page);
    await go(page, "#/today/checkin");
    await page.locator(".tc-box").waitFor();
    await page.evaluate(() => void (document.documentElement.style.fontSize = "17px"));
    await page.waitForTimeout(250);
    const buttons = page.locator(".tc-box .tc-btn");
    await expect.poll(() => buttons.count()).toBeGreaterThan(3);
    for (const b of await buttons.all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const wide = await page.evaluate(() => {
      const box = document.querySelector(".tc-box")!;
      const over = [...box.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5).length;
      return { over, page: document.documentElement.scrollWidth - innerWidth };
    });
    expect(wide).toEqual({ over: 0, page: 0 });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/tx1-phone.png` });
    const q = row(page, "Timesheet summary query");
    await q.getByRole("button", { name: "Partly" }).click();
    await q.getByRole("button", { name: "1h", exact: true }).waitFor();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/tx1-phone-partly.png` });
    const after = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(after).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
