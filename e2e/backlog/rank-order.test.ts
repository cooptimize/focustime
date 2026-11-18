// Was e2e/bl2.test.ts (BL-2) until BT-1.
// BL-2 in demo mode: each level, in the Grid and the Gantt, reads in that level's own rank order (the Grid's rank
// numbers count up from 1, the Gantt lists the same rows in the same order); the level is saved and kept, and with none
// saved Backlog opens at Features; old links still open; an opened feature's story is edited, reviewed, saved and undone
// like any row.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, openSettings, settingsSection, startDemo, type Harness } from "../harness.ts";
import { levelPressed, pickLevel } from "../backlog-helpers.ts";

let h: Harness;
const T = 180_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: unknown }>;

describe.skipIf(!CHROMIUM)("BL-2: Backlog in rank order (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  const go = async (page: Page, hash: string, sel = ".ah-client") => {
    await page.evaluate((x) => (location.hash = x), hash);
    await page.locator(sel).first().waitFor({ timeout: 30_000 });
  };
  const client = (page: Page, name: string) => page.locator(".ah-client", { has: page.getByRole("heading", { name: new RegExp(`^${name}`) }) });
  const only = async (page: Page, name: string) => {
    const chips = page.locator(".ah-toolbar").getByRole("group", { name: "Clients" });
    for (const b of await chips.getByRole("button").all()) if ((await b.getAttribute("aria-pressed")) === "true") await b.click();
    await chips.getByRole("button", { name, exact: true }).click();
    await page.getByRole("group", { name: "People" }).getByRole("button", { name: "Everyone" }).click();
  };
  /** The Grid's ranked rows for a client: [rank, title], top to bottom. */
  const gridRanked = (page: Page, name: string) =>
    client(page, name)
      .locator(".ah-row.depth-0:not(.closed)")
      .evaluateAll((rows) => rows.map((r) => [r.querySelector(".bl-rank")?.textContent?.trim() ?? "", r.querySelector(".ah-title a")?.textContent?.trim() ?? ""] as const).filter(([n]) => n !== ""));

  it("each level reads in rank order in the Grid, and the Gantt lists the same rows in the same order", async () => {
    const { page, errors } = await freshPage(h);
    await go(page, "#/backlog");
    await only(page, "Atlas Freight");
    for (const level of ["Epics", "Features", "Stories"]) {
      await pickLevel(page, level);
      await expect.poll(async () => (await gridRanked(page, "Atlas Freight")).length).toBeGreaterThan(0);
      const grid = await gridRanked(page, "Atlas Freight");
      // 1, 2, 3, …: filters off, every open item at the level in scope is here in its rank.
      expect(grid.map(([n]) => n)).toEqual(grid.map((_, i) => String(i + 1)));
      await page.getByRole("button", { name: "Gantt", exact: true }).click();
      await page.locator(".pa-row").first().waitFor({ timeout: 30_000 });
      const gantt = await page.locator(".pa-label[aria-label^='Rank ']").evaluateAll((rows) => rows.map((r) => r.getAttribute("aria-label") ?? ""));
      const ganttRanks = gantt.map((l) => Number(/^Rank (\d+)\./.exec(l)?.[1]));
      expect(ganttRanks).toEqual(grid.map((_, i) => i + 1));
      for (const [i, [, title]] of grid.entries()) expect(gantt[i]).toContain(title);
      await page.getByRole("button", { name: "Grid", exact: true }).click();
      await page.locator(".ah-client").first().waitFor({ timeout: 30_000 });
    }
    // Review 1: Left on a story opened under its feature goes back to the feature; its name comes before its last change.
    await pickLevel(page, "Features");
    const feat = client(page, "Atlas Freight").locator(".ah-row.depth-0", { hasText: "Shipment tracking dashboard" });
    await feat.locator(".ah-chev").first().click();
    const kid = client(page, "Atlas Freight").locator(".ah-row.depth-1").first();
    const kidCell = kid.locator(".ah-col-item, [role=gridcell][tabindex]").first();
    await kidCell.focus();
    await expect(kidCell.getAttribute("aria-label")).resolves.toMatch(/^[^.]+ #\d+ /);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")).toMatch(/^Rank 1\. .*Shipment tracking dashboard/);
    // A story under no feature is listed after the ranked features and says why.
    await expect(client(page, "Atlas Freight").locator(".ah-row", { hasText: "Rate table import" }).locator(".ah-loose").textContent()).resolves.toBe("Not under any features");
    // A client with nothing at the level says so (Harbor Health has no epics).
    await only(page, "Harbor Health");
    await pickLevel(page, "Epics");
    await expect(client(page, "Harbor Health").locator(".ah-client-order").textContent()).resolves.toMatch(/No epics in .+: what's here is listed below/);
    await only(page, "Atlas Freight");
    // The demo's point: Atlas's epics rank one way and their features another.
    await pickLevel(page, "Features");
    await expect(gridRanked(page, "Atlas Freight").then((g) => g.map(([, t]) => t))).resolves.toEqual(["Shipment tracking dashboard", "Delivery time estimates", "Carrier rate alerts"]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("no saved level opens at Features; a level picked is kept; old links open their level", async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => localStorage.removeItem("focustime.ahead.view.fold"));
    await page.reload();
    await go(page, "#/backlog");
    await expect(levelPressed(page, "Features")).resolves.toBe("true");
    await pickLevel(page, "Stories");
    await page.reload();
    await page.locator(".ah-client").first().waitFor({ timeout: 30_000 });
    await expect(levelPressed(page, "Stories")).resolves.toBe("true");
    // A link is read as Backlog opens: BL-1's "one level as a list" link (fl=) opens that level, l= wins, and the
    // address drops fl=. The old Stories address still lists stories.
    const origin = new URL(page.url()).origin;
    // Opened fresh, as a bookmark or a pasted link is: a full load (a page query that changes each time makes it one;
    // a hash change in place would be read by the page already open).
    let n = 0;
    const opened = async (hash: string, level: string) => {
      await page.goto(`${origin}/?open=${++n}${hash}`);
      await page.locator(".ah-client").first().waitFor({ timeout: 30_000 });
      await expect.poll(() => levelPressed(page, level)).toBe("true");
      await expect.poll(() => page.evaluate(() => location.hash)).not.toContain("fl=");
    };
    // BL-1's "one level as a list" link (fl=) opens that level, l= wins, and the address drops fl=. The old Stories
    // address still lists stories, and a link's own level (l=) opens as sent.
    await opened("#/backlog?fl=epic", "Epics");
    await opened("#/backlog?fl=story&l=feature", "Features");
    await opened("#/backlog/stories", "Stories");
    await opened("#/backlog?l=epic", "Epics");
    // Review 2: an old saved "one level as a list" becomes the level once, but a link's own l= wins over it; either way
    // it is dropped from the saved filters.
    const saved = ((await call(page, "ahead.filters", {})).data as { filters: Record<string, unknown> }).filters;
    expect((await call(page, "ahead.set_filters", { filters: { ...saved, flat: "story" } })).ok).toBe(true);
    await opened("#/backlog?l=epic", "Epics");
    await expect.poll(async () => ((await call(page, "ahead.filters", {})).data as { filters: Record<string, unknown> }).filters.flat).toBeUndefined();
    expect((await call(page, "ahead.set_filters", { filters: { ...saved, flat: "story" } })).ok).toBe(true);
    await opened("#/backlog", "Stories");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("review 2: Needs attention shows a story's gap under its feature at the default level, and the level stays Features", async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (localStorage.removeItem("focustime.ahead.view.fold"), localStorage.removeItem("focustime.ahead.view.attention.fold")));
    await page.reload();
    await go(page, "#/backlog");
    await only(page, "Northwind Foods");
    await page.getByRole("button", { name: /^Needs attention/ }).click();
    await expect.poll(() => client(page, "Northwind Foods").locator(".ah-row", { hasText: "Points balance page" }).count()).toBe(1);
    await page.getByRole("button", { name: /^Needs attention/ }).click();
    await expect(levelPressed(page, "Features")).resolves.toBe("true");
    await expect(client(page, "Northwind Foods").locator(".ah-row", { hasText: "Points balance page" }).count()).resolves.toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a story opened under its feature edits, reviews, saves and undoes like any row", async () => {
    const { page, errors } = await freshPage(h);
    await go(page, "#/backlog");
    await only(page, "Northwind Foods");
    await pickLevel(page, "Features");
    // Leave the demo's own staged changes out of it.
    if (await page.locator(".ah-pending").count()) {
      await page.getByRole("button", { name: "Review" }).click();
      const p = page.getByRole("dialog", { name: "Review changes" });
      await p.getByRole("button", { name: "Discard all" }).click();
      await p.getByRole("button", { name: "Discard all" }).click();
      await expect.poll(() => page.locator(".ah-pending").count()).toBe(0);
      if (await p.count()) await p.getByRole("button", { name: "Close" }).click();
      await p.waitFor({ state: "detached" });
    }
    const feature = page.locator(".ah-row.depth-0", { has: page.getByRole("link", { name: "Order history export", exact: true }) });
    await feature.locator(".ah-chev").first().click();
    const story = page.locator(".ah-row.depth-1", { has: page.getByRole("link", { name: "Export button on the order page", exact: true }) });
    await story.waitFor();
    // An opened child has no rank number of its own.
    await expect(story.locator(".bl-rank").textContent()).resolves.toBe("");
    const size = story.locator(".ah-col-size");
    await size.click();
    await page.getByRole("textbox", { name: "Story Points" }).fill("8");
    await page.locator(".cell-pop").getByRole("button", { name: "Save" }).click();
    await expect.poll(() => size.getAttribute("class"), { timeout: 10_000 }).toContain("ah-pend");
    await expect.poll(() => page.locator(".ah-pending").textContent()).toContain("1 change to save");
    // Bulk sees it too: select the story, the bar counts it.
    await story.getByRole("checkbox").check({ force: true });
    await expect(page.locator(".bl-bulk strong").textContent()).resolves.toBe("1 selected");
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await page.getByRole("button", { name: "Review" }).click();
    const panel = page.getByRole("dialog", { name: "Review changes" });
    await expect(panel.locator(".ah-review-item").textContent()).resolves.toContain("Export button on the order page");
    await panel.getByRole("button", { name: /^Save (1 item )?to DevOps$/ }).click();
    // The write framework's preview: what changes, then its own confirm (a save says Save, never Undo).
    const write = page.locator(".write-dialog");
    await write.waitFor();
    await expect(write.textContent()).resolves.toMatch(/#1113 Export button on the order page.*Story Points.*8/);
    await write.getByRole("button", { name: "Save in DevOps" }).click();
    await write.waitFor({ state: "detached" });
    const fields = async () => ((await call(page, "devops.log", {})).data as { entries: { op: string; itemId: number; status: string; after: Record<string, unknown> }[] }).entries.filter((e) => e.itemId === 1113 && e.op.endsWith("fields"));
    await expect.poll(async () => (await fields()).map((e) => [e.op, e.status])).toEqual([["fields", "confirmed"]]);
    await expect.poll(() => page.locator(".ah-pending").count()).toBe(0);
    // Undo, from Settings › Activity's write log: one preview, then it reads back.
    await page.getByRole("dialog", { name: "Review changes" }).getByRole("button", { name: "Close" }).click();
    await openSettings(page);
    await page.evaluate((h) => (location.hash = h), "#/settings/data/devops-log");
    const wl = page.getByRole("region", { name: "DevOps write log" });
    await wl.locator("tr", { hasText: "#1113" }).getByRole("button", { name: "Undo" }).first().click();
    await write.getByRole("button", { name: "Undo in DevOps" }).click();
    await write.waitFor({ state: "detached" });
    await expect.poll(async () => (await fields()).map((e) => [e.op, e.status]).sort()).toEqual([["fields", "confirmed"], ["undo_fields", "confirmed"]]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
