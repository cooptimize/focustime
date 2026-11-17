// OP-1 A3: the timebox check-in's time to DevOps (Close out's "Update Remaining Work on 2 stories?") through the app's
// one preview. Each row then says what happened to it: one a teammate changed since the preview is refused and the
// other is still saved; a write whose answer was lost offers Retry on its row; a saved one offers Undo through the
// same preview. Not now writes nothing and the offer stays. Reload previews again only the rows that didn't land.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { onePreview } from "../one-preview.ts";

const T = 240_000;
const MON = "2026-11-02";
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const at = (t: string) => `${MON}T${t}:00-05:00`;
const log = async (page: Page) => (await call(page, "devops.log", {})).data.entries as { op: string; itemId: number; status: string }[];
const row = (page: Page, title: string) => page.locator(".tc-preview li", { hasText: title });

/** Two stories with ended timeboxes, both answered Partly with 1h left, so Close out offers their Remaining Work. */
async function offer(page: Page) {
  await call(page, "settings.save", { section: "planning", values: { devopsOnDone: "never" } });
  await page.reload();
  await call(page, "planday.start", { date: MON });
  const add = async (input: object) => (await call(page, "pick.add", { date: MON, ...input })).data.pick.id as number;
  const query = await add({ half: "AM", clientKey: "Cooptimize", itemId: 4411 });
  const chart = await add({ half: "AM", clientKey: "Cooptimize", itemId: 4412 });
  for (const id of [query, chart]) await call(page, "pick.set_size", { id, size: "M" });
  for (const [pickId, a, b] of [[query, "09:00", "10:00"], [chart, "10:00", "11:00"]] as const) await call(page, "timebox.add", { pickId, date: MON, start: at(a), end: at(b) });
  await page.evaluate(() => (location.hash = "#/today/closeout"));
  await page.reload();
  await page.locator(".closeout-panel .tc-box").waitFor({ timeout: 30_000 });
  for (const t of ["Timesheet summary query", "Utilization chart"]) {
    const r = page.locator(".tc-row", { hasText: t });
    await r.getByRole("button", { name: "Partly" }).click();
    await r.getByRole("button", { name: "1h", exact: true }).click();
    await r.locator(".tc-said").waitFor();
  }
  await page.locator(".tc-offer").waitFor();
}

describe.skipIf(!CHROMIUM)("OP-1: the check-in's time to DevOps through the one preview", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, `${MON}T16:40:00-05:00`);
  }, T);
  afterAll(async () => h?.stop());

  it("Not now writes nothing and keeps the offer", async () => {
    const { page } = await freshPage(h);
    await offer(page);
    const before = (await log(page)).length;
    await page.locator(".tc-offer").getByRole("button", { name: "Review" }).click();
    const d = onePreview(page);
    await d.waitFor();
    expect(await d.locator(".dw-row").count()).toBe(2);
    await d.getByRole("button", { name: "Not now" }).click();
    await d.waitFor({ state: "detached" });
    expect((await log(page)).length).toBe(before);
    await page.locator(".tc-offer").getByRole("button", { name: "Review" }).waitFor();
    await page.close();
  }, T);

  it("a refused row doesn't stop the other; a lost answer offers Retry on its row; Undo goes through the preview", async () => {
    const { page, errors } = await freshPage(h);
    await offer(page);
    await page.locator(".tc-offer").getByRole("button", { name: "Review" }).click();
    const d = onePreview(page);
    await d.waitFor();
    // Between the preview and Confirm: a teammate changes one story; the other's write gets no answer.
    await call(page, "demo.devops_change", { clientKey: "Cooptimize", change: { id: 4411, title: "Timesheet summary query (renamed)" } });
    await call(page, "demo.devops_change", { clientKey: "Cooptimize", change: { id: 4412, loseNextWrite: true } });
    await d.locator("button.commit").click();
    await d.locator(".set-problem").first().waitFor({ timeout: 30_000 });
    await d.getByRole("button", { name: "Close", exact: true }).last().click();
    await d.waitFor({ state: "detached" });
    // Each row says what happened to it.
    await expect.poll(() => row(page, "Timesheet summary query").locator(".db-fail").textContent()).toMatch(/changed/i);
    const chart = row(page, "Utilization chart");
    await chart.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => chart.locator(".db-ok").textContent(), { timeout: 30_000 }).toContain("Saved");
    await chart.getByRole("button", { name: "Undo" }).click();
    const u = onePreview(page);
    await u.waitFor();
    await u.locator("button.commit").click();
    await u.waitFor({ state: "detached", timeout: 30_000 });
    expect((await log(page))[0]!.op).toBe("undo_remaining_work");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
  it("Reload previews again only what didn't land: a written row is never sent twice", async () => {
    const { page } = await freshPage(h);
    await offer(page);
    const before = (await log(page)).length;
    await page.locator(".tc-offer").getByRole("button", { name: "Review" }).click();
    const d = onePreview(page);
    await d.waitFor();
    await call(page, "demo.devops_change", { clientKey: "Cooptimize", change: { id: 4411, title: "Timesheet summary query (renamed)" } });
    await d.locator("button.commit").click();
    await d.getByRole("button", { name: "Reload and review again" }).click({ timeout: 30_000 });
    const again = onePreview(page);
    await expect.poll(() => again.locator(".dw-row").count(), { timeout: 20_000 }).toBe(1);
    await expect.poll(() => again.locator(".dw-row h3").textContent()).toContain("#4411");
    await again.locator("button.commit").click();
    await again.waitFor({ state: "detached", timeout: 30_000 });
    const written = (await log(page)).slice(0, (await log(page)).length - before).filter((e) => e.status === "confirmed");
    expect(written.map((e) => e.itemId).sort()).toEqual([4411, 4412]);
    // Both rows say Saved: the one that landed first kept its result.
    await expect.poll(() => page.locator(".tc-preview .db-ok").count()).toBe(2);
    await page.close();
  }, T);
});
