// RB-7: Code on a branch you choose, in a browser on the demo's invented repos (Northwind's sales-analytics has main,
// dev and three more). Pick dev beside the repo's name and see the open file change, the header's line, Copy DevOps
// link on dev and Copy link carrying it; open the copied link in a fresh browser and land on dev; go back with one
// press; a file only dev has, then main chosen, goes to the nearest folder with one line; an address naming a branch
// that is gone opens on the usual one and says so; nothing of the choice is in the browser's storage. Then the phone:
// the picker's controls are at least 44 px and nothing scrolls sideways. Edge cases are unit tests
// (plan/code-branch.test.ts, actions/code-branch.test.ts, ui/code/address.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

let h: Harness;
const T = 180_000;
const REPO = "a1b2c3d4-0001-4000-8000-00000000a001";
const PIPE = "/pipelines/Load sales.DataPipeline/pipeline-content.json";
const ONLY_DEV = "/lake/Gold.Warehouse/rpt/Views/vReturnsByStore.sql";
const panel = (page: Page) => page.locator("[data-code-page]");
const file = (page: Page) => panel(page).locator(".cv-file-view");
const addr = (path: string, branch?: string) => `#/code/Northwind/${REPO}${branch ? `@${encodeURIComponent(branch)}` : ""}/${encodeURIComponent(path)}`;
const go = (page: Page, hash: string) => page.evaluate((x) => (location.hash = x), hash);
const text = (page: Page) => file(page).locator(".cv-code").innerText();
const choose = async (page: Page, name: string) => {
  await panel(page).locator("[data-code-branch-btn]").first().click();
  await panel(page).locator(`[data-code-branch-opt="${name}"]`).click();
};
const stored = (page: Page) =>
  page.evaluate(() => {
    const all: string[] = [];
    for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) all.push(`${s.key(i)}=${s.getItem(s.key(i)!)}`);
    return all.join("\n");
  });

describe.skipIf(!CHROMIUM)("Code on a branch you choose (RB-7)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("pick a branch, see the file change, copy the link, open it elsewhere, go back", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await go(page, addr(PIPE));
    await file(page).waitFor();
    const onMain = await text(page);
    expect(onMain).toContain('"timeout": "0.12:00:00"');
    // The picker beside the repo's name says the branch on screen; no line while it's the usual one.
    expect(await panel(page).locator("[data-code-branch-btn]").getAttribute("data-code-branch-btn")).toBe("main");
    expect(await panel(page).locator("[data-code-off-usual]").count()).toBe(0);
    // The list: the usual branch first and marked, then the rest by name; a long name cut in the middle, whole on hover.
    await panel(page).locator("[data-code-branch-btn]").click();
    const opts = panel(page).locator("[data-code-branch-opt]");
    await opts.first().waitFor();
    expect(await opts.evaluateAll((els) => els.map((e) => e.getAttribute("data-code-branch-opt")))).toEqual(["main", "dev", "feature/returns-model", "feature/store-region-dimension-cleanup-before-the-quarterly-refresh", "release/2026-11"]);
    expect(await opts.first().innerText()).toContain("opens here");
    const long = panel(page).locator('[data-code-branch-opt^="feature/store-region"]');
    expect(await long.getAttribute("title")).toBe("feature/store-region-dimension-cleanup-before-the-quarterly-refresh");
    expect(await long.innerText()).toContain("…");
    await page.keyboard.press("Escape");

    // dev: the same file, as dev has it, and the header's line with one press back.
    await choose(page, "dev");
    await panel(page).locator('[data-code-off-usual="dev"]').waitFor();
    await page.waitForFunction(() => document.querySelector(".cv-code")?.textContent?.includes("0.02:00:00"));
    expect(await panel(page).locator("[data-code-off-usual]").innerText()).toContain("On dev, not the usual main");
    expect(await page.evaluate(() => location.hash)).toBe(addr(PIPE, "dev"));
    await panel(page).locator('[data-code-copy="devops"]').click();
    const devops = new URL(await page.evaluate(() => navigator.clipboard.readText()));
    expect(devops.searchParams.get("version")).toBe("GBdev");
    expect(devops.searchParams.get("path")).toBe(PIPE);
    await panel(page).locator('[data-code-copy="link"]').click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link.endsWith(addr(PIPE, "dev"))).toBe(true);

    // The copied link, in another browser: the same branch and file.
    const other = await freshPage(h, { width: 1440, height: 900 });
    await other.page.goto(link);
    await other.page.locator("[data-code-page] .cv-file-view").waitFor();
    await other.page.waitForFunction(() => document.querySelector(".cv-code")?.textContent?.includes("0.02:00:00"));
    expect(await other.page.locator('[data-code-branch-btn="dev"]').count()).toBe(1);
    await other.page.close();

    // Back to the usual branch with one press: the address drops the branch.
    await panel(page).locator("[data-code-back-usual]").click();
    await page.waitForFunction(() => document.querySelector(".cv-code")?.textContent?.includes("0.12:00:00"));
    expect(await page.evaluate(() => location.hash)).toBe(addr(PIPE));
    expect(await panel(page).locator("[data-code-off-usual]").count()).toBe(0);

    // A file only dev has, then main chosen: the nearest folder main has, with one line.
    await go(page, addr(ONLY_DEV, "dev"));
    await page.waitForFunction(() => document.querySelector(".cv-code")?.textContent?.includes("vReturnsByStore"));
    await choose(page, "main");
    await panel(page).locator("[data-code-moved]").waitFor();
    expect(await panel(page).locator("[data-code-moved]").innerText()).toBe(`${ONLY_DEV} isn't on main, so this is /lake/Gold.Warehouse/rpt/Views.`);
    expect(await page.evaluate(() => location.hash)).toBe(`#/code/Northwind/${REPO}`);
    expect(await panel(page).locator('.cv-tree [data-path="/lake/Gold.Warehouse/rpt/Views"]').getAttribute("aria-expanded")).toBe("true");

    // An address naming a branch that is gone: the usual branch, saying which was asked for.
    await go(page, addr("/README.md", "feature/gone-away"));
    await panel(page).locator('[data-code-gone="feature/gone-away"]').waitFor();
    expect(await panel(page).locator("[data-code-gone]").innerText()).toBe("feature/gone-away isn't there any more, so this is main.");
    await page.waitForFunction(() => !location.hash.includes("@"));

    // Nothing of a choice is in the browser's storage.
    const kept = await stored(page);
    for (const bit of ["dev", "feature", "returns", REPO]) expect(kept).not.toContain(bit);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("the phone: the picker's controls are 44 px, and nothing scrolls sideways", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    await go(page, `#/code/Northwind/${REPO}`);
    const btn = panel(page).locator("[data-code-branch-btn]");
    await btn.waitFor();
    await page.waitForFunction(() => document.querySelector("[data-code-branch-btn]")?.getAttribute("data-code-branch-btn") === "main");
    expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await btn.click();
    const opts = panel(page).locator("[data-code-branch-opt]");
    await opts.first().waitFor();
    for (const b of await opts.all()) {
      const box = (await b.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    await panel(page).locator('[data-code-branch-opt="dev"]').click();
    await panel(page).locator('[data-code-off-usual="dev"]').waitFor();
    const back = panel(page).locator("[data-code-back-usual]");
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  });
});
