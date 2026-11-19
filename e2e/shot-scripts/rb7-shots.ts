// RB-7: the pictures for the pull request, only when FOCUSTIME_SHOTS names a folder; nothing runs otherwise. Demo data
// only (the demo's invented repos), dark, one in light. FOCUSTIME_RB7_SET=before takes the "before" set on the layout
// as it was on main (a repo's tree, a file, search results and Admin's Code tab, at 1440 by 900 and 390 by 844);
// otherwise the "after" set: the picker closed and open, a file on another branch with the header's line, the
// fall-back line, search inside files with its line, Admin's Code tab with an opening branch set, the phone's picker.
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { SHOTS } from "../shots.ts";

let h: Harness;
const T = 300_000;
const BEFORE = process.env.FOCUSTIME_RB7_SET === "before";
const REPO = "a1b2c3d4-0001-4000-8000-00000000a001";
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
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
const go = async (page: Page, to: string) => {
  await page.evaluate((x) => (location.hash = x), to);
  await page.waitForTimeout(900);
};
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const);
const insideSearch = async (page: Page, words: string) => {
  const box = page.locator("[data-code-search]").first();
  await box.click();
  await page.locator('[data-code-mode="inside"]').first().click();
  await box.fill(words);
  await box.press("Enter");
  await page.locator("[data-code-hit]").first().waitFor({ timeout: 30_000 });
};
const file = (path: string, branch?: string) => `#/code/Northwind/${REPO}${branch ? `@${encodeURIComponent(branch)}` : ""}/${encodeURIComponent(path)}`;

describe.skipIf(!CHROMIUM || !SHOTS)("RB-7 screenshots", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it(BEFORE ? "before" : "after", { timeout: T }, async () => {
    for (const [w, hgt, tag] of [[1440, 900, "desktop"], [390, 844, "phone"]] as const) {
      const { page } = await freshPage(h, { width: w, height: hgt });
      await theme(page, "dark");
      if (BEFORE) {
        await go(page, `#/code/Northwind/${REPO}`);
        await page.locator('[role="tree"] [data-path="/lake"]').first().click().catch(() => undefined);
        await shot(page, `before-01-tree-${tag}`);
        await go(page, file("/pipelines/Load sales.DataPipeline/pipeline-content.json"));
        await page.locator(".cv-file-view").waitFor();
        await shot(page, `before-02-file-${tag}`);
        await go(page, "#/code/Northwind");
        await insideSearch(page, "Returns");
        await shot(page, `before-03-search-inside-${tag}`);
        await go(page, "#/admin/clients/Northwind/code");
        await page.getByLabel("Northwind: who can read its code").waitFor({ timeout: 60_000 });
        await page.waitForTimeout(800);
        await shot(page, `before-04-admin-code-${tag}`);
        await page.close();
        continue;
      }
      if (tag === "desktop") {
        // The picker closed and open, on the repo's own default.
        await go(page, file("/pipelines/Load sales.DataPipeline/pipeline-content.json"));
        await page.locator(".cv-file-view").waitFor();
        await shot(page, "01-picker-closed");
        await page.locator("[data-code-branch-btn]").click();
        await page.locator("[data-code-branch-pop]").waitFor();
        await shot(page, "02-picker-open");
        // A file on another branch, with the header's line.
        await page.locator('[data-code-branch-opt="feature/returns-model"]').click();
        await page.locator("[data-code-off-usual]").waitFor();
        await page.locator(".cv-file-view").waitFor();
        await shot(page, "03-file-on-another-branch");
        // The fall-back line: a file only dev has, then main chosen.
        await go(page, file("/lake/Gold.Warehouse/rpt/Views/vReturnsByStore.sql", "dev"));
        await page.locator(".cv-file-view").waitFor();
        await page.locator("[data-code-branch-btn]").click();
        await page.locator('[data-code-branch-opt="main"]').click();
        await page.locator("[data-code-moved]").waitFor();
        await shot(page, "04-fall-back-line");
        // Search inside files from a branch DevOps doesn't search.
        await go(page, file("/README.md", "feature/returns-model"));
        await page.locator(".cv-file-view").waitFor();
        await insideSearch(page, "Returns");
        await page.locator("[data-code-not-searched]").first().waitFor();
        await shot(page, "05-search-inside-line");
        // Admin's Code tab with an opening branch set.
        await call(page, "admin.set", { scope: "client:Northwind", key: "code_branch", value: "dev" });
        await go(page, "#/admin/clients/Northwind/code");
        await page.locator("[data-code-branch-repos]").waitFor({ timeout: 60_000 });
        await page.locator("[data-code-branch-repos]").scrollIntoViewIfNeeded();
        await shot(page, "06-admin-opening-branch");
        // The same screen in light.
        await theme(page, "light");
        await shot(page, "07-admin-opening-branch-light");
        await theme(page, "dark");
        await call(page, "admin.set", { scope: "client:Northwind", key: "code_branch", value: null });
      } else {
        await go(page, `#/code/Northwind/${REPO}`);
        await page.locator("[data-code-branch-btn]").click();
        await page.locator("[data-code-branch-pop]").waitFor();
        await shot(page, "08-picker-phone");
      }
      await page.close();
    }
  });
});
