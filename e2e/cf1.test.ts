// CF-1 (browser, demo mode, Monday Nov 2, 9:30 AM): no confirm, no musts. Ticking a story on a day nobody confirmed
// opens Wrap it up; an empty Day says "Nothing on today yet" with Add work, and the card goes once a to-do is on today;
// and none of the old words show anywhere a person reads: Day, Week, Ahead, Status, Inbox, Add work, a client chip's
// popover, the command menu and the keys list. Placing a feature reaches my own Status report at once (published on
// change). Week's add, take off, add again is in wd1; Timebox my day on a never-confirmed day is in qf1.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 180_000;
const TODAY = "2026-11-02";
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The words CF-1 took away. A send's own Must (G5) is the one exception, checked by the caller. */
const OLD = [/Confirm week/, /Confirm today/, /Confirm again/, /Confirm and timebox/, /\bconfirmed\b/i, /\bMust\b/, /Nice to have/i, /\bmusts\b/i, /isn't planned yet/];
const SEND_MUST = /(Withdraw a Must|· Must\b|\bMust ·|Must from )/g;
function oldWords(text: string): string[] {
  const t = text.replace(SEND_MUST, "");
  return OLD.filter((re) => re.test(t)).map((re) => `${re} in …${t.slice(Math.max(0, t.search(re) - 40), t.search(re) + 40)}…`);
}
const bodyText = (page: Page) => page.locator("body").innerText();

async function clearToday(page: Page) {
  const st = await call(page, "planday.start", { date: TODAY });
  for (const p of st.data.picks as { id: number; status: string }[]) if (p.status === "planned" || p.status === "done") await call(page, "pick.remove", { id: p.id });
}

describe.skipIf(!CHROMIUM)("CF-1: no confirm, no musts (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("a story ticked on a day nobody confirmed opens Wrap it up", async () => {
    const { page, errors } = await freshPage(h);
    await call(page, "planday.start", { date: TODAY });
    expect((await call(page, "pick.add", { date: TODAY, half: "AM", clientKey: "Cooptimize", itemId: 4411 })).ok).toBe(true);
    await page.reload();
    const box = page.getByRole("checkbox", { name: "Done: Timesheet summary query" });
    await box.waitFor({ timeout: 30_000 });
    await box.check();
    await page.getByRole("dialog", { name: "Wrap it up" }).waitFor({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect.poll(() => page.getByRole("dialog", { name: "Wrap it up" }).count()).toBe(0);
    // The tick stands with no confirm.
    const st = await call(page, "planday.start", { date: TODAY });
    expect((st.data.picks as { itemId: number | null; status: string }[]).find((p) => p.itemId === 4411)?.status).toBe("done");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("an empty Day: Nothing on today yet, + Add (the block panel, on Day); once a to-do is on today the card goes", async () => {
    const { page, errors } = await freshPage(h);
    await clearToday(page);
    await page.evaluate(() => (location.hash = "#/day"));
    await page.reload();
    const card = page.locator(".today-view").getByText("Nothing on today yet").first();
    await card.waitFor({ timeout: 30_000 });
    expect(oldWords(await page.locator(".today-view").innerText())).toEqual([]);
    await page.locator(".today-view .moment-card").getByRole("button", { name: "Add", exact: true }).click();
    const panel = page.locator("aside.block-panel");
    await panel.waitFor({ timeout: 30_000 });
    // WD-2: it opens on Day, on one of today's blocks.
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/day\/2026-11-02\/(AM|PM)$/);
    await panel.locator(".aw-features .aw-row:not(.placed):not(:has(.aw-where)) button.aw-plus").first().click();
    await panel.locator(".aw-row.placed").first().waitFor();
    await panel.getByRole("button", { name: /Close/ }).first().click();
    await panel.waitFor({ state: "detached" });
    await page.locator(".today-view").waitFor();
    await expect.poll(() => page.locator(".today-view").getByText("Nothing on today yet").count(), { timeout: 15_000 }).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("none of the old words on Day, Week, Ahead, Status, Inbox, Add work, a chip's popover, the command menu or the keys", async () => {
    const { page, errors } = await freshPage(h);
    const seen: Record<string, string[]> = {};
    const look = async (where: string) => void (seen[where] = oldWords(await bodyText(page)));
    // Tabs in RF-1's order: 1 Day, 2 Week, 3 Ahead, 4 Status, 5 Inbox.
    await page.keyboard.press("1");
    await page.locator(".today-view").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await look("Day");
    await page.keyboard.press("2");
    await page.locator(".week-head").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await look("Week");
    await page.locator('[data-drop="2026-11-02:PM"] .add-work.add-row').first().click();
    await page.locator("aside.block-panel").waitFor();
    await page.waitForTimeout(500);
    await look("Add work");
    await page.keyboard.press("Escape");
    await page.keyboard.press("3");
    await page.waitForTimeout(1500);
    await look("Ahead");
    await page.keyboard.press("4");
    await page.waitForTimeout(1500);
    await look("Status");
    await page.keyboard.press("5");
    await page.waitForTimeout(1500);
    await look("Inbox");
    // The command menu: every command's label, by searching for the old words.
    const menu = page.getByRole("dialog", { name: "Command menu" });
    for (const q of ["", "confirm", "commit", "must", "nice"]) {
      await page.keyboard.press("Control+k");
      await menu.waitFor();
      if (q) await page.keyboard.type(q);
      await page.waitForTimeout(250);
      seen[`command menu: ${q || "all"}`] = oldWords(await menu.innerText());
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
    }
    // The keys list.
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("?");
    await page.waitForTimeout(500);
    await look("keys");
    for (const [where, hits] of Object.entries(seen)) expect(hits, where).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a feature placed on my week shows at once in the status report as planned (published on change)", async () => {
    const { page } = await freshPage(h);
    const st = await call(page, "status.report", {});
    const clients = (st.data?.clients ?? []) as { clientKey: string }[];
    expect(clients.length).toBeGreaterThan(0);
    // A feature with no update yet on a client that has a report: put it on this week, then read the report.
    let found: { clientKey: string; id: number } | null = null;
    for (const c of clients) {
      const r = await call(page, "status.report", { clientKey: c.clientKey });
      const f = ((r.data?.report?.noUpdate ?? []) as { id: number; active: string | null }[]).find((x) => x.active !== "planned");
      if (f && (await call(page, "weekplan.add", { weekStart: TODAY, clientKey: c.clientKey, itemId: f.id })).ok) {
        found = { clientKey: c.clientKey, id: f.id };
        break;
      }
    }
    expect(found).not.toBeNull();
    const after = await call(page, "status.report", { clientKey: found!.clientKey });
    expect(((after.data.report.noUpdate ?? []) as { id: number; active: string | null }[]).find((x) => x.id === found!.id)?.active).toBe("planned");
    await page.close();
  }, T);
});
