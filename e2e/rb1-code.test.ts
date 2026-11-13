// RB-1: Code in a browser, on the demo's invented repos. Opens from ⋯ and the command menu; pick a client and a repo,
// open folders, read SQL, TMDL and JSON colored with line numbers, Format a squashed report, the Copy buttons, Find a
// file by keyboard, reopen the address; a client set to its team only is greyed with no repos; a client whose token
// can't read code yet says so; binary and oversize files show no text; Esc and Back; the phone; an admin flips the Rule
// and sees Code views. With FOCUSTIME_SHOTS set, screenshots for docs/ux/rb1 (dark and light, 1440×900 and the phone).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, sameSession, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

let h: Harness;
const T = 180_000;
const panel = (page: Page) => page.locator("main.code-panel");
const tree = (page: Page) => panel(page).locator(".cv-tree");
const row = (page: Page, path: string) => tree(page).locator(`[data-path="${path}"]`);
const file = (page: Page) => panel(page).locator(".cv-file-view");
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
/** <name>-dark.png and <name>-light.png, then back to dark. */
const shotThemes = async (page: Page, name: string) => {
  if (!SHOTS) return;
  for (const t of ["dark", "light"] as const) {
    await theme(page, t);
    await shot(page, `${name}-${t}`);
  }
  await theme(page, "dark");
};
// The app sets its theme on load; the shots hold the chosen one (and the system's) for the rest of the page.
const theme = async (page: Page, t: "dark" | "light") => {
  await page.emulateMedia({ colorScheme: t });
  await page.evaluate((v) => {
    v = v === "light" ? "cooptimize-light" : "cooptimize-dark";
    const w = window as unknown as { __shotTheme?: MutationObserver };
    w.__shotTheme?.disconnect();
    const set = () => document.documentElement.dataset.theme !== v && (document.documentElement.dataset.theme = v);
    set();
    w.__shotTheme = new MutationObserver(set);
    w.__shotTheme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }, t as string);
};
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function pickClient(page: Page, name: string) {
  const btn = panel(page).locator(".cv-picker-btn");
  if (await btn.count()) {
    await btn.click();
    await panel(page).locator(".cv-picker-pop .cv-client-opt", { hasText: name }).click();
  } else await panel(page).locator(".cv-start .cv-client-opt", { hasText: name }).click();
}

describe.skipIf(!CHROMIUM)("Code (RB-1)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("opens from ⋯, reads a client's folders and files colored with line numbers, and Esc closes", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await theme(page, "dark");
    await page.locator(".top-more").click();
    await page.getByRole("menuitem", { name: /^Code$/ }).click();
    await panel(page).waitFor();
    expect(await page.evaluate(() => location.hash)).toBe("#/code");
    // Mine first, then the rest; Fabrikam is its team's only, greyed with the reason.
    const start = panel(page).locator(".cv-start");
    await start.waitFor();
    expect(await start.locator(".cv-group-head").allTextContents()).toEqual(["Your clients", "Other clients"]);
    const fab = start.locator(".cv-client-opt", { hasText: "Fabrikam" });
    expect(await fab.getAttribute("aria-disabled")).toBe("true");
    expect(await fab.textContent()).toContain("Only Fabrikam's team can open this");
    await shotThemes(page, "01-pick-client");

    await pickClient(page, "Northwind");
    // Three repos: pick one.
    const select = panel(page).getByLabel("Repo");
    await select.waitFor();
    expect(await select.locator("option").allTextContents()).toEqual(["Pick a repo", "archive (empty)", "sales-analytics", "store-portal"]);
    await select.selectOption({ label: "sales-analytics" });
    await row(page, "/sql").waitFor();
    expect(await tree(page).locator("[role=treeitem][aria-level='1'] .cv-folder").first().textContent()).toBe("data");
    expect(await panel(page).locator(".cv-log-line").textContent()).toBe("Opening a file is logged for FocusTime admins: who, which file and when.");
    expect(await panel(page).locator(".cv-title").textContent()).toContain("Northwind");
    expect(await panel(page).locator(".cv-title").textContent()).toContain("Read only");

    // Folders open in place; a SQL file shows colored with line numbers.
    await row(page, "/sql").click();
    await row(page, "/sql/dbo").click();
    await row(page, "/sql/dbo/Views").click();
    await row(page, "/sql/dbo/Views/vSales.sql").click();
    await file(page).waitFor();
    expect(await file(page).getAttribute("data-lang")).toBe("sql");
    // The client list open over a file: whose code is on screen stays in the header.
    await panel(page).locator(".cv-picker-btn").click();
    await shotThemes(page, "02-client-list-open");
    await page.keyboard.press("Escape");
    await panel(page).locator(".cv-picker-pop").waitFor({ state: "detached" });
    expect(await file(page).locator(".cv-ln").first().getAttribute("data-n")).toBe("1");
    expect(await file(page).locator(".tk-keyword").count()).toBeGreaterThan(2);
    expect(await page.evaluate(() => location.hash)).toMatch(/^#\/code\/Northwind\/a1b2c3d4-0001-4000-8000-00000000a001\/%2Fsql%2Fdbo%2FViews%2FvSales\.sql$/);
    await shotThemes(page, "03-sql");

    // TMDL with its DAX.
    await row(page, "/model").click();
    await row(page, "/model/Sales.SemanticModel").click();
    await row(page, "/model/Sales.SemanticModel/definition").click();
    await row(page, "/model/Sales.SemanticModel/definition/tables").click();
    await row(page, "/model/Sales.SemanticModel/definition/tables/Sales.tmdl").click();
    await expect.poll(() => file(page).getAttribute("data-lang")).toBe("tmdl");
    expect(await file(page).locator(".tk-keyword", { hasText: "measure" }).count()).toBeGreaterThan(0);
    expect(await file(page).locator(".tk-function").count()).toBeGreaterThan(0);
    await shotThemes(page, "04-tmdl");

    // A squashed report: Format, then Copy formatted.
    await row(page, "/report").click();
    await row(page, "/report/Sales.Report").click();
    await row(page, "/report/Sales.Report/report.json").click();
    await expect.poll(() => file(page).getAttribute("data-lang")).toBe("json");
    const before = await file(page).locator(".cv-line").count();
    await shotThemes(page, "06-json-squashed");
    await file(page).getByRole("switch", { name: "Format" }).check();
    await expect.poll(() => file(page).locator(".cv-line").count()).toBeGreaterThan(before + 10);
    expect(await file(page).locator("[data-code-copy=file]").textContent()).toBe("Copy formatted");
    await shotThemes(page, "07-json-formatted");

    // Esc closes and goes back to where it opened from.
    await page.keyboard.press("Escape");
    await panel(page).waitFor({ state: "detached" });
    expect(await page.evaluate(() => location.hash)).not.toMatch(/^#\/code/);
    // Nothing of the code in the browser's storage.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    for (const s of ["sales-analytics", "vSales", "report.json", "/code"]) expect(stored).not.toContain(s);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("the command menu opens a client; Find opens a file by keyboard; the address reopens it; the Copy buttons", { timeout: T }, async () => {
    const fresh = await freshPage(h, { width: 1440, height: 900 });
    let page = fresh.page;
    const errors = fresh.errors;
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await theme(page, "light");
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Code: Atlas");
    await page.getByRole("menuitem", { name: /Code: Atlas/ }).first().click();
    await panel(page).waitFor();
    // One repo opens on its own.
    await row(page, "/adf").waitFor();
    const find = panel(page).getByLabel("Find a file");
    await find.click();
    await find.fill("shipments json");
    await panel(page).locator(".cv-find-list li").first().waitFor();
    expect(await panel(page).locator(".cv-find-list li").count()).toBe(2);
    await page.keyboard.press("ArrowDown");
    await shotThemes(page, "08-find");
    await page.keyboard.press("Enter");
    await file(page).waitFor();
    expect(await file(page).getAttribute("data-code-file")).toBe("/adf/pipeline/pl_copy_shipments.json");
    // Breadcrumbs.
    expect(await file(page).locator(".cv-crumbs").textContent()).toBe("freight-ingest/adf/pipeline/pl_copy_shipments.json");
    await shotThemes(page, "09-json-pipeline");
    await theme(page, "light");
    await shotBoth(page, "09-json-pipeline-light");

    // Copy, Copy path, Copy DevOps link, Copy link.
    const clip = () => page.evaluate(() => navigator.clipboard.readText());
    await file(page).locator("[data-code-copy=path]").click();
    expect(await clip()).toBe("/adf/pipeline/pl_copy_shipments.json");
    await file(page).locator("[data-code-copy=devops]").click();
    expect(await clip()).toMatch(/^https:\/\/dev\.azure\.com\/[^/]+\/[^/]+\/_git\/freight-ingest\?path=%2Fadf%2Fpipeline%2Fpl_copy_shipments\.json&version=GBmain$/);
    await file(page).locator("[data-code-copy=link]").click();
    const link = await clip();
    expect(link).toMatch(/#\/code\/Atlas\/[0-9a-f-]{36}\/%2Fadf%2Fpipeline%2Fpl_copy_shipments\.json$/);
    await file(page).locator("[data-code-copy=file]").click();
    expect(await clip()).toContain('"name"');

    // The link reopens the same file (a new page on the same session).
    const again = await sameSession(h, page, { viewport: { width: 1440, height: 900 } });
    await page.close();
    page = await again.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(link);
    await file(page).waitFor({ timeout: 60_000 });
    expect(await file(page).getAttribute("data-code-file")).toBe("/adf/pipeline/pl_copy_shipments.json");
    // Its folders are open in the tree, with the file selected; arrows move, Left goes to the parent.
    const sel = tree(page).locator(".cv-tree-row.selected");
    expect(await sel.getAttribute("data-path")).toBe("/adf/pipeline/pl_copy_shipments.json");
    await sel.focus();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-path"))).toBe("/adf/pipeline");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => row(page, "/adf/pipeline").getAttribute("aria-expanded")).toBe("false");
    await page.keyboard.press("Home");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-path"))).toBe("/adf");
    expect(errors.join(" | ")).toBe("");
    await page.close();
  });

  it("a team-only client, a token without Code (read), an empty repo, binary, image and oversize files", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await theme(page, "dark");
    await page.evaluate(() => (location.hash = "#/code/Fabrikam"));
    await panel(page).locator("[data-code-state=team_only]").waitFor();
    expect(await panel(page).locator("[data-code-state=team_only]").textContent()).toBe("Only Fabrikam's team can open this.");
    expect(await panel(page).getByLabel("Repo").count()).toBe(0);
    await shotThemes(page, "10-team-only");

    await page.evaluate(() => (location.hash = "#/code/Harbor"));
    await panel(page).locator("[data-code-state=needs_code_read]").waitFor();
    expect(await panel(page).locator("[data-code-state=needs_code_read]").textContent()).toBe("FocusTime can't read Harbor's code yet. The company DevOps token for Harbor needs Code (read).");
    await shotThemes(page, "11-needs-code-read");

    await page.evaluate(() => (location.hash = "#/code/Northwind/a1b2c3d4-0006-4000-8000-00000000a006"));
    await panel(page).locator("[data-code-state=empty]").waitFor();

    const repo = "#/code/Northwind/a1b2c3d4-0001-4000-8000-00000000a001/";
    for (const [p, kind, words] of [
      ["/docs/Sales model.pbix", "binary", /binary file/],
      ["/docs/architecture.png", "image", /image/],
      ["/data/sample-orders.csv", "too_large", /Files over 1 MB aren't shown here/],
    ] as const) {
      await page.evaluate((h) => (location.hash = h), repo + encodeURIComponent(p));
      const st = file(page).locator(`[data-code-state=${kind}]`);
      await st.waitFor();
      expect(await st.textContent()).toMatch(words);
      expect(await file(page).locator(".cv-code").count()).toBe(0);
      expect(await file(page).locator("[data-code-copy=file]").count()).toBe(0);
      if (kind === "binary") await shotThemes(page, "12-binary");
      if (kind === "too_large") await shotThemes(page, "13-too-large");
    }
    // Every Code response is no-store.
    const cache = await page.evaluate(() =>
      fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: "code.file", input: { clientKey: "Northwind", repoId: "a1b2c3d4-0001-4000-8000-00000000a001", path: "/README.md" } }) }).then((r) => [r.status, r.headers.get("cache-control")]),
    );
    expect(cache).toEqual([200, "no-store"]);
    // An HTML file is shown as its source; nothing in it runs.
    await page.evaluate((h) => (location.hash = h), repo + encodeURIComponent("/docs/store-map.html"));
    await expect.poll(() => file(page).getAttribute("data-lang")).toBe("xml");
    expect(await file(page).locator("script, iframe, img, svg:not(.ah-chev-svg)").count()).toBe(0);
    expect(await file(page).textContent()).toContain("<script");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("the phone: client and tree first, the file as its own page with Back; no sideways scroll", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    await theme(page, "dark");
    await page.evaluate(() => (location.hash = "#/code"));
    await panel(page).locator(".cv-start").waitFor();
    await shot(page, "20-phone-clients-dark");
    await pickClient(page, "Cooptimize");
    await row(page, "/scripts").waitFor();
    await row(page, "/scripts").click();
    await shot(page, "21-phone-tree-dark");
    await row(page, "/scripts/New-Workspace.ps1").click();
    await file(page).waitFor();
    expect(await file(page).getAttribute("data-lang")).toBe("powershell");
    expect(await noSidewaysScroll(page)).toBe(true);
    await shotBoth(page, "22-phone-file-dark");
    await panel(page).locator(".ps-back").click();
    await row(page, "/scripts/New-Workspace.ps1").waitFor();
    expect(await file(page).count()).toBe(0);
    expect(await noSidewaysScroll(page)).toBe(true);
    await theme(page, "light");
    await row(page, "/scripts/New-Workspace.ps1").click();
    await file(page).waitFor();
    await shot(page, "23-phone-file-light");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("an admin sets a client to its team only and sees who opened what in Code views", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await theme(page, "dark");
    // Open a file so there is a view.
    await page.evaluate(() => (location.hash = `#/code/Northwind/a1b2c3d4-0001-4000-8000-00000000a001/${encodeURIComponent("/README.md")}`));
    await file(page).waitFor();
    await page.keyboard.press("Escape");
    await panel(page).waitFor({ state: "detached" });

    await page.evaluate(() => (location.hash = "#/settings/admin-clients"));
    const field = page.getByLabel("Northwind: who can read its code");
    await field.waitFor({ timeout: 60_000 });
    const card = page.locator(".adm-client", { has: field });
    await expect.poll(() => card.locator("[data-code-check]").getAttribute("data-code-check")).toBe("readable");
    expect(await card.locator("[data-code-check]").textContent()).toMatch(/^Code: readable · 3 repos/);
    await field.selectOption("team");
    await page.waitForTimeout(600);
    await card.locator(".adm-code").scrollIntoViewIfNeeded();
    await shotThemes(page, "14-admin-rule");
    // Harbor's token can't read code yet.
    const harbor = page.locator(".adm-client", { has: page.getByLabel("Harbor: who can read its code") });
    if (await harbor.count()) await expect.poll(() => harbor.locator("[data-code-check]").getAttribute("data-code-check")).toBe("needs_code_read");

    await page.evaluate(() => (location.hash = "#/settings/admin-audit/code-views"));
    const views = page.locator("[data-setting=code-views]");
    await views.locator("tbody tr").first().waitFor();
    const first = await views.locator("tbody tr").first().locator("td").allTextContents();
    expect(first.slice(2)).toEqual(["Northwind", "sales-analytics", "Opened a file", "/README.md"]);
    expect(await views.locator(".adm-code-counts").textContent()).toMatch(/Northwind \d+/);
    await shotThemes(page, "15-admin-code-views");

    // The person is on Northwind's team in the demo, so it still opens for them.
    await page.evaluate(() => (location.hash = "#/code/Northwind"));
    await panel(page).getByLabel("Repo").waitFor();
    // Back to the whole company.
    await page.evaluate(() => (location.hash = "#/settings/admin-clients"));
    await page.getByLabel("Northwind: who can read its code").selectOption("company");
    await page.waitForTimeout(600);
    expect(errors).toEqual([]);
    await page.close();
  });
});
