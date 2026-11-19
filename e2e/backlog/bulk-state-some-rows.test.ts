// UC-3 item 6 (browser, demo mode): Backlog's bulk State… with a state only some ticked rows take. UC-2 made it
// pickable; this follows it to the save. On a feature and a story, On hold (only Logistics's features have it): the
// line says how many rows it leaves and why, Review lists only the feature, Save writes only that one item's State
// through the usual preview and Confirm, never an order field, and every row keeps its place. Fictional data only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { pickLevel } from "../backlog-helpers.ts";

let h: Harness;
const T = 240_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Entry = { op: string; itemId: number; status: string; ops: { op: string; path: string }[]; after: Record<string, string | null> };
const log = async (page: Page) => (await call(page, "devops.log", {})).data.entries as Entry[];
const row = (page: Page, title: string): Locator => page.locator(".ah-row", { has: page.getByRole("link", { name: title, exact: true }) });
const order = (page: Page) => page.locator(".ah-row").evaluateAll((rows) => rows.map((r) => `${(r as HTMLElement).dataset.key}@${r.getAttribute("aria-level")}`));

describe.skipIf(!CHROMIUM)("UC-3: bulk State… on rows only some of which take the state (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("stages the rows that take it, says how many it leaves and why, and Save changes only those; the order is untouched", async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    await call(page, "ahead.discard", { confirm: true });
    await page.evaluate(() => (location.hash = "#/backlog"));
    await page.locator(".ah-client").first().waitFor({ timeout: 30_000 });
    const chips = page.locator(".ah-toolbar").getByRole("group", { name: "Clients" });
    for (const b of await chips.getByRole("button").all()) if ((await b.getAttribute("aria-pressed")) === "true") await b.click();
    await chips.getByRole("button", { name: "Atlas Freight", exact: true }).click();
    await page.getByRole("group", { name: "People" }).getByRole("button", { name: "Everyone" }).click();
    await pickLevel(page, "Features");
    const feature = row(page, "Carrier rate alerts");
    if ((await feature.getAttribute("aria-expanded")) !== "true") await feature.locator(".ah-chev").first().click();
    await row(page, "Alert settings page").waitFor();
    const before = await order(page);
    const written = (await log(page)).length;

    await feature.getByRole("checkbox").check({ force: true });
    await row(page, "Alert settings page").getByRole("checkbox").check({ force: true });
    await page.getByRole("toolbar", { name: "Selected items" }).getByRole("button", { name: "State…" }).click();
    const sp = page.locator(".ah-pop-bulk-state");
    await sp.waitFor();
    const onHold = sp.getByRole("option", { name: /On hold/ });
    await expect(onHold.getAttribute("aria-disabled")).resolves.not.toBe("true");
    await onHold.click();
    // How many it leaves, and why.
    await expect.poll(() => page.locator(".bl-result").first().textContent()).toContain("State On hold: staged 1, skipped 1.");
    await page.locator(".bl-result summary").click();
    await expect(page.locator(".bl-result li").allTextContents()).resolves.toEqual([expect.stringMatching(/#3352 Alert settings page.*On hold isn't a state of User Story in Logistics's process/)]);

    // Review lists only the row that takes it; Save goes through the usual preview and Confirm.
    await page.getByRole("button", { name: "Review" }).click();
    const rv = page.getByRole("dialog", { name: "Review changes" });
    await rv.getByRole("listitem", { name: "#3350 Carrier rate alerts" }).waitFor();
    await expect(rv.getByRole("listitem").filter({ hasText: "#3352" }).count()).resolves.toBe(0);
    await rv.getByRole("button", { name: "Save 1 item to DevOps" }).click();
    const go = page.locator(".write-dialog").getByRole("button", { name: /in DevOps$/ }).first();
    await go.waitFor({ timeout: 10_000 });
    await go.click();
    await expect.poll(async () => (await log(page)).filter((e) => e.op === "fields" && e.status === "confirmed").length, { timeout: 30_000 }).toBe(1);

    const entries = (await log(page)).slice(0, (await log(page)).length - written);
    const saved = entries.filter((e) => e.op === "fields" && e.status === "confirmed");
    expect(saved.map((e) => e.itemId)).toEqual([3350]);
    expect(saved[0]!.after).toEqual({ State: "On hold" });
    expect(saved[0]!.ops.map((o) => o.path).some((p) => /StackRank|BacklogPriority/.test(p))).toBe(false);
    expect(entries.some((e) => e.itemId === 3352)).toBe(false);
    await rv.getByRole("button", { name: "Close" }).click();
    await expect.poll(() => row(page, "Carrier rate alerts").locator("td.ah-col-state").textContent()).toContain("On hold");
    expect(await row(page, "Alert settings page").locator("td.ah-col-state").textContent()).not.toContain("On hold");
    expect(await order(page), "every row keeps its place").toEqual(before);
    await page.close();
  }, T);
});
