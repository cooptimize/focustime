// OP-1 A4: Break down's batch through the app's one preview. Not now writes nothing and leaves the draft on Review; a
// card naming another client is flagged in the preview and Replace writes "another client"; the items land under the
// same parent, in the batch's order; a create DevOps refuses leaves the draft as it was, with the reason, on Review.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { onePreview } from "../one-preview.ts";

const T = 240_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Entry = { op: string; parentId: number | null; title: string | null; status: string; after: Record<string, string | null> };
const log = async (page: Page) => (await call(page, "devops.log", {})).data.entries as Entry[];

async function openPanel(page: Page) {
  await page.evaluate(() => (location.hash = "#/backlog/attention"));
  await page.reload();
  const needs = page.locator(".ah-grid tbody .ah-row:not(.context)", { hasText: "Supplier onboarding" }).first();
  await needs.waitFor({ timeout: 30_000 });
  await needs.getByRole("button", { name: /Break down/ }).first().click();
  const panel = page.getByRole("dialog", { name: /^Break down Feature: / });
  await panel.waitFor({ timeout: 15_000 });
  await panel.getByRole("button", { name: "Run" }).click();
  await panel.getByRole("listitem", { name: /^Card / }).first().waitFor({ timeout: 30_000 });
  return panel;
}

describe.skipIf(!CHROMIUM)("OP-1: Break down through the one preview", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-02T10:00:00-05:00");
  }, T);
  afterAll(async () => h?.stop());

  it("Not now writes nothing; Replace writes another client; the items land under the same parent in order", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const panel = await openPanel(page);
    const before = (await log(page)).length;
    const first = panel.getByRole("listitem", { name: /^Card / }).first();
    const title = await first.locator(".bd-title").inputValue();
    await first.locator(".bd-title").fill(`${title} like Harbor Health's`);
    await panel.getByRole("button", { name: /^Preview \d+ items/ }).click();
    let d = onePreview(page);
    await d.waitFor({ timeout: 20_000 });
    const rows = await d.locator(".dw-row").count();
    await d.getByRole("button", { name: "Not now" }).click();
    await d.waitFor({ state: "detached" });
    expect((await log(page)).length).toBe(before);
    await panel.getByRole("button", { name: /^Preview \d+ items/ }).waitFor();
    await panel.getByRole("button", { name: /^Preview \d+ items/ }).click();
    d = onePreview(page);
    await d.locator(".mention-flag").first().waitFor({ timeout: 20_000 });
    await expect.poll(() => d.locator(".mention-flag").first().textContent()).toMatch(/Harbor.*Northwind's DevOps/);
    await d.getByRole("button", { name: /Replace with/ }).first().click();
    await expect.poll(() => onePreview(page).locator(".mention-flag").count()).toBe(0);
    await onePreview(page).locator("button.commit").click();
    await onePreview(page).waitFor({ state: "detached", timeout: 30_000 });
    await panel.getByText(/^Created \d+ items? under/).waitFor({ timeout: 30_000 });
    const made = (await log(page)).slice(0, rows).reverse();
    expect(made.map((e) => [e.op, e.parentId, e.status])).toEqual(Array.from({ length: rows }, () => ["create", 1120, "confirmed"]));
    expect(made[0]!.title).toContain("another client");
    expect(made[0]!.title).not.toContain("Harbor");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a refused create leaves the draft as it was, with the reason", async () => {
    // Its own demo: the first test's items took Supplier onboarding off Needs stories.
    const h2 = await startDemo("chromium", {}, "2026-11-02T10:00:00-05:00");
    const { page } = await freshPage(h2, { width: 1440, height: 900 });
    const panel = await openPanel(page);
    const before = (await log(page)).length;
    // A teammate closes the parent before the preview: every create is refused, so no preview opens (nothing to
    // confirm) and the panel says why on each, in the framework's words.
    await call(page, "demo.devops_change", { clientKey: "Northwind", change: { id: 1120, state: "Closed" } });
    await panel.getByRole("button", { name: /^Preview \d+ items/ }).click();
    await expect.poll(() => panel.textContent(), { timeout: 20_000 }).toMatch(/#1120 is Closed; FocusTime adds items only under open parents/);
    expect(await onePreview(page).count()).toBe(0);
    const all = await log(page);
    expect(all.slice(0, all.length - before).some((e) => e.status === "confirmed")).toBe(false);
    // The draft is as it was: still on Review, every card there, Preview offered again.
    await panel.getByRole("button", { name: /^Preview \d+ items/ }).waitFor();
    expect(await panel.getByRole("listitem", { name: /^Card / }).count()).toBeGreaterThan(0);
    await page.close();
    await h2.stop();
  }, T);
});
