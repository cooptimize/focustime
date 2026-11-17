// OP-1 STEP 0.5: what Mark done, Week › Status (two clients, then Undo), the timebox check-in and Break down send to
// DevOps is the same before and after they moved onto the one preview. Each flow runs on the demo and its write log
// rows (the patch sent, field by field, the values before and after, the item, the order, the to-do and follow-up they
// carry, what an undo undoes) are compared with the rows main wrote for the same input, kept in op1-same-writes.json.
// OP1_RECORD=1 writes that file instead (run once on main, before the move). The clicks tolerate both sets of screens:
// a screen's own preview (before) or the one preview (after).
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 300_000;
const MON = "2026-11-02";
const RECORD = process.env.OP1_RECORD === "1";
const FILE = new URL("./op1-same-writes.json", import.meta.url).pathname;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const go = async (page: Page, hash: string) => {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.reload();
};
type Row = Record<string, unknown>;
/** The log, oldest first, without what differs by run (row ids, times); an undo names its write by position. */
async function rows(page: Page, since: number): Promise<Row[]> {
  const all = ((await call(page, "devops.log", {})).data.entries as Row[]).slice().reverse();
  const ids = all.map((e) => e.id as number);
  return all.slice(since).map((e) => ({ op: e.op, clientKey: e.clientKey, org: e.org, project: e.project, itemId: e.itemId, parentId: e.parentId, title: e.title, identity: e.identity, before: e.before, after: e.after, ops: e.ops, revBefore: e.revBefore, revAfter: e.revAfter, draftId: e.draftId, pickIds: e.pickIds, followUpId: e.followUpId, status: e.status, undoOf: e.undoOf === null ? null : ids.indexOf(e.undoOf as number) - since }));
}
const logLength = async (page: Page) => ((await call(page, "devops.log", {})).data.entries as Row[]).length;
const modal = (page: Page) => page.locator('[role="dialog"][data-overlay="modal"]');
/** Confirm whatever DevOps preview is open, one after another (the one preview opens one per client), then close it. */
async function confirmAll(page: Page, max = 5) {
  for (let n = 0; n < max; n++) {
    const d = modal(page).last();
    if (!(await d.isVisible().catch(() => false))) {
      await page.waitForTimeout(800);
      if (!(await modal(page).last().isVisible().catch(() => false))) return;
      continue;
    }
    const go = d.locator("button.commit").first();
    await go.waitFor({ timeout: 20_000 });
    await go.click();
    const close = d.getByRole("button", { name: "Close", exact: true }).last();
    await close.or(d.locator(".dw-ok").first()).first().waitFor({ timeout: 30_000 }).catch(() => undefined);
    if (await close.isVisible().catch(() => false)) await close.click();
    await page.waitForTimeout(600);
  }
}

describe.skipIf(!CHROMIUM)("OP-1: the same writes reach DevOps (STEP 0.5)", () => {
  const got: Record<string, Row[]> = {};
  const hs: Harness[] = [];
  beforeAll(() => undefined);
  afterAll(async () => {
    for (const h of hs) await h.stop();
    if (RECORD) writeFileSync(FILE, `${JSON.stringify(got, null, 1)}\n`);
  }, T);
  const expected = (k: string): Row[] => (JSON.parse(readFileSync(FILE, "utf8")) as Record<string, Row[]>)[k] ?? [];
  const check = (k: string, r: Row[]) => {
    got[k] = r;
    expect(r.length, k).toBeGreaterThan(0);
    if (!RECORD) expect(r, k).toEqual(expected(k));
  };

  it("Mark done in DevOps: the state picked, the follow-up it carries", async () => {
    const h = await startDemo("chromium", {}, `${MON}T16:40:00-05:00`);
    hs.push(h);
    const { page } = await freshPage(h);
    await call(page, "settings.save", { section: "planning", values: { devopsOnDone: "never" } });
    await call(page, "planday.start", { date: MON });
    const id = (await call(page, "pick.add", { date: MON, half: "AM", clientKey: "Cooptimize", itemId: 4411 })).data.pick.id as number;
    await call(page, "pick.mark_done", { id, done: true });
    const since = await logLength(page);
    await go(page, "#/today/closeout");
    await page.getByRole("button", { name: "Mark done in DevOps" }).first().click();
    const ask = page.getByRole("dialog", { name: /^Mark done in DevOps/ });
    await ask.locator("select").waitFor({ timeout: 20_000 });
    await ask.getByRole("textbox").fill("Done and checked with the team.");
    await ask.getByRole("button", { name: "Preview" }).click();
    await confirmAll(page);
    await expect.poll(() => logLength(page), { timeout: 20_000 }).toBeGreaterThan(since);
    check("markdone", await rows(page, since));
    await page.close();
  }, T);

  it("Status: lines on two clients' features pushed, then the first one undone", async () => {
    const h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
    hs.push(h);
    const { page } = await freshPage(h);
    const since = await logLength(page);
    await go(page, "#/status");
    await page.locator(".st-count").waitFor({ timeout: 30_000 });
    const clients = page.locator(".st-client");
    for (let i = 0; i < 2; i++) {
      const art = clients.nth(i).getByRole("article").first();
      await art.getByRole("button", { name: "Add a line" }).click();
      await art.getByRole("textbox").last().fill(i === 0 ? "Sign-up form designed; review with purchasing on Friday." : "Export filter in test; finance checks it Monday.");
    }
    await page.getByRole("button", { name: "Push all" }).click();
    await modal(page).first().waitFor({ timeout: 20_000 });
    await confirmAll(page);
    await expect.poll(() => logLength(page), { timeout: 20_000 }).toBe(since + 2);
    await page.locator(".st-pushed").getByRole("button", { name: "Undo" }).first().click();
    await modal(page).first().waitFor({ timeout: 20_000 });
    await confirmAll(page);
    await expect.poll(() => logLength(page), { timeout: 20_000 }).toBe(since + 3);
    check("status", await rows(page, since));
    await page.close();
  }, T);

  it("The timebox check-in: Remaining Work for two stories", async () => {
    const h = await startDemo("chromium", {}, `${MON}T16:40:00-05:00`);
    hs.push(h);
    const { page } = await freshPage(h);
    const at = (t: string) => `${MON}T${t}:00-05:00`;
    await call(page, "settings.save", { section: "planning", values: { devopsOnDone: "never" } });
    await page.reload();
    await call(page, "planday.start", { date: MON });
    const add = async (input: object) => (await call(page, "pick.add", { date: MON, ...input })).data.pick.id as number;
    const query = await add({ half: "AM", clientKey: "Cooptimize", itemId: 4411 });
    const chart = await add({ half: "AM", clientKey: "Cooptimize", itemId: 4412 });
    for (const id of [query, chart]) await call(page, "pick.set_size", { id, size: "M" });
    for (const [pickId, a, b] of [[query, "09:00", "10:00"], [chart, "10:00", "11:00"]] as const) await call(page, "timebox.add", { pickId, date: MON, start: at(a), end: at(b) });
    const since = await logLength(page);
    await go(page, "#/today/closeout");
    await page.locator(".closeout-panel .tc-box").waitFor({ timeout: 30_000 });
    for (const t of ["Timesheet summary query", "Utilization chart"]) {
      const r = page.locator(".tc-row", { hasText: t });
      await r.getByRole("button", { name: "Partly" }).click();
      await r.getByRole("button", { name: "1h", exact: true }).click();
      await r.locator(".tc-said").waitFor();
    }
    await page.locator(".tc-offer").getByRole("button", { name: "Review" }).click();
    const own = page.locator(".tc-preview");
    await own.or(modal(page)).first().waitFor({ timeout: 20_000 });
    if (await own.isVisible().catch(() => false)) await own.getByRole("button", { name: /^Confirm/ }).click();
    else await confirmAll(page);
    await expect.poll(() => logLength(page), { timeout: 20_000 }).toBe(since + 2);
    check("checkin", await rows(page, since));
    await page.close();
  }, T);

  it("Break down: the samples' cards created under the feature", async () => {
    const h = await startDemo("chromium", {}, `${MON}T10:00:00-05:00`);
    hs.push(h);
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    const since = await logLength(page);
    await go(page, "#/backlog/attention");
    const needs = page.locator(".ah-grid tbody .ah-row:not(.context)", { hasText: "Supplier onboarding" }).first();
    await needs.waitFor({ timeout: 30_000 });
    await needs.getByRole("button", { name: /Break down/ }).first().click();
    const panel = page.getByRole("dialog", { name: /^Break down Feature: / });
    await panel.waitFor({ timeout: 15_000 });
    await panel.getByRole("button", { name: "Run" }).click();
    await panel.getByRole("listitem", { name: /^Card / }).first().waitFor({ timeout: 30_000 });
    await panel.getByRole("button", { name: /^Preview \d+ items?/ }).click();
    const createAll = panel.getByRole("button", { name: /^Create all/ });
    await createAll.or(modal(page)).first().waitFor({ timeout: 20_000 });
    if (await createAll.isVisible().catch(() => false)) await createAll.click();
    else await confirmAll(page);
    await expect.poll(() => logLength(page), { timeout: 30_000 }).toBe(since + 5);
    check("breakdown", await rows(page, since));
    await page.close();
  }, T);
});
