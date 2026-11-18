// OP-1 A1: Mark done in DevOps (Close out's "done here, still open in DevOps") goes through the app's one preview: the
// state picker, then the one preview (where, as whom, the state before and after, who can see it); Not now sends
// nothing; Confirm sets the state picked and closes the follow-up it carries; a write whose answer was lost offers
// Retry in the same preview; an item a teammate changed since offers Reload; Undo from Settings › Activity.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 240_000;
const MON = "2026-11-02";
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const go = async (page: Page, hash: string) => {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.reload();
};
type Entry = { id: number; op: string; itemId: number; status: string; after: Record<string, string | null>; followUpId: number | null; undoOf: number | null };
const log = async (page: Page) => (await call(page, "devops.log", {})).data.entries as Entry[];
const preview = (page: Page) => page.locator('[role="dialog"][data-overlay="modal"]').filter({ has: page.locator(".wd-where") });

/** A to-do on #4411 ticked done in FocusTime, so Close out lists it as owed in DevOps. */
async function owed(page: Page) {
  await call(page, "settings.save", { section: "planning", values: { devopsOnDone: "never" } });
  await call(page, "planday.start", { date: MON });
  const id = (await call(page, "pick.add", { date: MON, half: "AM", clientKey: "Cooptimize", itemId: 4411 })).data.pick.id as number;
  await call(page, "pick.mark_done", { id, done: true });
  await go(page, "#/today/closeout");
}
async function ask(page: Page, state?: string) {
  await page.getByRole("button", { name: "Mark done in DevOps" }).first().click();
  const d = page.getByRole("dialog", { name: /^Mark done in DevOps/ });
  await d.locator("select").waitFor({ timeout: 20_000 });
  if (state) {
    await d.locator("select").selectOption(state);
    await expect.poll(() => d.locator("select").inputValue()).toBe(state);
  }
  await d.getByRole("button", { name: "Preview" }).click();
  const p = preview(page);
  await p.waitFor({ timeout: 20_000 });
  return p;
}

describe.skipIf(!CHROMIUM)("OP-1: Mark done in DevOps through the one preview", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, `${MON}T16:40:00-05:00`);
  }, T);
  afterAll(async () => h?.stop());

  it("Not now sends nothing; the completed state is set and the follow-up closes", async () => {
    const { page, errors } = await freshPage(h);
    await owed(page);
    const before = (await log(page)).length;
    let p = await ask(page);
    // The one preview's parts: where, as whom, the field before and after, who can see it.
    await expect.poll(() => p.locator(".wd-where").textContent()).toMatch(/DevOps · Cooptimize/);
    await expect.poll(() => p.locator(".wd-fields").textContent()).toContain("State");
    await p.locator(".wd-visibility").waitFor();
    await p.getByRole("button", { name: "Not now" }).click();
    await p.waitFor({ state: "detached" });
    expect((await log(page)).length).toBe(before);
    // The client's completed state, picked for me; Confirm sets it and closes the follow-up it carries.
    p = await ask(page);
    await expect.poll(() => p.locator(".wd-fields").textContent()).toContain("Closed");
    await p.getByRole("button", { name: "Change state in DevOps" }).click();
    await p.waitFor({ state: "detached", timeout: 30_000 });
    const e = (await log(page))[0]!;
    expect([e.op, e.itemId, e.status, e.after.State]).toEqual(["state", 4411, "confirmed", "Closed"]);
    expect(e.followUpId).not.toBeNull();
    // Closed in DevOps: Close out no longer lists the item as owed.
    // DevOps is read again in the background; under load that can take a moment, so look again until it has.
    await expect
      .poll(async () => {
        await go(page, "#/today/closeout");
        await page.locator(".closeout-panel").waitFor();
        await page.waitForTimeout(500);
        return page.locator(".cp-owed").filter({ hasText: "#4411" }).count();
      }, { timeout: 60_000, interval: 2_000 })
      .toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a write whose answer was lost offers Retry in the preview; a change since offers Reload", async () => {
    const { page } = await freshPage(h);
    await owed(page);
    await call(page, "demo.devops_change", { clientKey: "Cooptimize", change: { id: 4411, loseNextWrite: true } });
    let p = await ask(page);
    await p.getByRole("button", { name: "Change state in DevOps" }).click();
    await p.getByRole("button", { name: "Retry" }).click({ timeout: 30_000 });
    await p.waitFor({ state: "detached", timeout: 30_000 });
    expect((await log(page))[0]!.status).toBe("confirmed");
    // Put it back (a fresh item state), then a teammate changes it between the preview and Confirm.
    await call(page, "pick.add", { date: MON, half: "AM", clientKey: "Cooptimize", itemId: 4412 }).then((r) => call(page, "pick.mark_done", { id: r.data.pick.id, done: true }));
    await go(page, "#/today/closeout");
    await page.getByRole("button", { name: "Mark done in DevOps" }).first().click();
    const d = page.getByRole("dialog", { name: /^Mark done in DevOps/ });
    await d.locator("select").waitFor({ timeout: 20_000 });
    await d.getByRole("button", { name: "Preview" }).click();
    p = preview(page);
    await p.waitFor({ timeout: 20_000 });
    const item = Number((await p.locator("h3").first().textContent())?.match(/#(\d+)/)?.[1]);
    await call(page, "demo.devops_change", { clientKey: "Cooptimize", change: { id: item, title: "Renamed by a teammate" } });
    await p.locator("button.commit").click();
    await p.getByRole("button", { name: "Reload and review again" }).waitFor({ timeout: 30_000 });
    await page.close();
  }, T);

  it("the state I pick is the state set; Undo from Settings › Activity goes through the same preview", async () => {
    const { page } = await freshPage(h);
    await owed(page);
    const p = await ask(page, "Resolved");
    await expect.poll(() => p.locator(".wd-fields").textContent()).toContain("Resolved");
    await p.getByRole("button", { name: "Change state in DevOps" }).click();
    await p.waitFor({ state: "detached", timeout: 30_000 });
    expect((await log(page))[0]!.after.State).toBe("Resolved");
    await go(page, "#/settings/activity");
    await page.locator(".dw-log").getByRole("button", { name: "Undo" }).first().click();
    const u = preview(page);
    await u.waitFor({ timeout: 20_000 });
    await u.locator("button.commit").click();
    await u.waitFor({ state: "detached", timeout: 30_000 });
    expect((await log(page))[0]!.op).toBe("undo_state");
    await page.close();
  }, T);
});
