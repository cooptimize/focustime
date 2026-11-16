// RB-6: Code is a tab, with one search box, and By kind lists each thing once; in a browser, on the demo's invented
// repos. Six tabs with Code last and 6 opening it; Code is a page (no Close, Esc stays, the other tabs' keys work from
// it) and not in the desktop More menu; every old address still opens. The search: its choices open on focus, This
// client is the start inside a client, nothing is asked before Enter, a names search sends no words, results take the
// whole area, Esc goes back to exactly where browsing was, a result has Back to results. By kind: the groups in order,
// the warehouse's objects only under Databases, no file listed twice. The last place kept is #/code alone. The top bar
// is one row at 1280, 1366 and 1920 at every text size. The phone opens Code from More with the same search row.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

let h: Harness;
const T = 180_000;
const page$ = (page: Page) => page.locator("[data-code-page]");
const hash = (page: Page) => page.evaluate(() => location.hash);
const go = async (page: Page, to: string) => {
  await page.evaluate((x) => (location.hash = x), to);
  await page$(page).waitFor();
};
const SALES = "a1b2c3d4-0001-4000-8000-00000000a001";
function watchActions(page: Page) {
  const sent: { action: string; body: string }[] = [];
  page.on("request", (r) => {
    if (!r.url().endsWith("/api/action")) return;
    const body = r.postData() ?? "";
    sent.push({ action: (JSON.parse(body) as { action: string }).action, body });
  });
  return sent;
}
const tabs = (page: Page) => page.locator(".topbar .view-tab").evaluateAll((els) => els.map((e) => e.textContent!.replace(/\d/g, "").trim()));

describe.skipIf(!CHROMIUM)("Code is a tab with one search box; each thing is listed once (RB-6)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("six tabs, Code last; 6 opens it; it is a page with no Close; Esc stays; the other keys work; not in More", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await page.locator(".topbar .view-tab").first().waitFor();
    expect(await tabs(page)).toEqual(["Day", "Week", "Backlog", "Status", "Inbox", "Code"]);
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("6");
    await page$(page).waitFor();
    expect(await hash(page)).toBe("#/code");
    expect(await page.locator('.topbar .view-tab[aria-current="page"]').textContent()).toContain("Code");
    // A page: no Close, and Esc leaves it where it is.
    expect(await page$(page).locator(".x-close, [aria-label='Close']").count()).toBe(0);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    expect(await hash(page)).toBe("#/code");
    // The other tabs' keys work from it (not while typing in the box).
    await page.keyboard.press("2");
    await page.waitForFunction(() => location.hash.startsWith("#/week"));
    await page.keyboard.press("6");
    await page$(page).waitFor();
    // The desktop More menu has no Code any more.
    await page.locator('.topbar button[aria-label^="More"]').first().click();
    const menu = page.locator('[role="menu"]').first();
    await menu.waitFor();
    expect(await menu.getByRole("menuitem", { name: /^Code$/ }).count()).toBe(0);
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("no Code tab, and 6 does nothing, for someone who may not read code (the same test More used)", { timeout: T }, async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    // As for an automation account: the list of clients Code can open comes back empty.
    await page.route("**/api/action", async (route) => {
      const body = route.request().postData() ?? "";
      if ((JSON.parse(body) as { action: string }).action !== "code.clients") return route.continue();
      const res = await route.fetch();
      const empty = (v: unknown): unknown => (Array.isArray(v) ? v.map(empty) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "clients" && Array.isArray(x) ? [] : empty(x)])) : v);
      await route.fulfill({ response: res, json: empty(await res.json()) });
    });
    await page.evaluate(() => (location.hash = "#/week"));
    await page.locator(".topbar .view-tab").first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll(".topbar .view-tab").length === 5, null, { timeout: 15_000 });
    expect(await tabs(page)).toEqual(["Day", "Week", "Backlog", "Status", "Inbox"]);
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("6");
    await page.waitForTimeout(300);
    expect(await hash(page)).not.toMatch(/^#\/code/);
    await page.close();
  });

  it("the line about the log is on screen wherever a file can be opened or a search run", { timeout: T }, async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    const seen = async (where: string) => {
      const line = page.locator("[data-code-log-line]");
      await line.first().waitFor();
      expect(await line.count(), where).toBe(1);
      expect(await line.first().isVisible(), where).toBe(true);
      const box = await line.first().boundingBox();
      expect(box && box.y + box.height <= 900, where).toBe(true);
      expect(await line.first().textContent(), where).toMatch(/admins/i);
    };
    await go(page, "#/code");
    await seen("front page");
    // Review 2: a client only its team may open still has the search box, so the line is there too.
    await go(page, "#/code/Fabrikam");
    await page.locator("[data-code-state=team_only]").waitFor();
    await seen("team only");
    await go(page, `#/code/Northwind/${SALES}`);
    await page.locator('[role="tree"] [role="treeitem"]').first().waitFor();
    await seen("Files");
    await go(page, "#/code/Northwind/kinds");
    await page.locator("[data-code-kinds]").waitFor();
    await seen("By kind");
    await page.locator("[data-code-kinds] [data-code-thing]").first().click();
    await page.locator(".cv-file-view").waitFor();
    await seen("a file from By kind");
    const box = page.locator("[data-code-search]");
    await box.click();
    await box.fill("store");
    await box.press("Enter");
    await page.locator("[data-code-results]").waitFor();
    await seen("names results");
    await page.locator('[data-code-mode="inside"]').click();
    await box.press("Enter");
    await page.locator("[data-code-inside-results]").waitFor();
    await seen("inside results");
    await page.close();
    const phone = await freshPage(h, { width: 390, height: 844 });
    await phone.page.evaluate(() => (location.hash = "#/code/Northwind/kinds"));
    await phone.page.locator("[data-code-kinds]").waitFor();
    expect(await phone.page.locator("[data-code-log-line]").count()).toBe(1);
    await phone.page.locator("[data-code-kinds] [data-code-thing]").first().click();
    await phone.page.locator(".cv-file-view").waitFor();
    expect(await phone.page.locator("[data-code-log-line]").count()).toBe(1);
    await phone.page.close();
  });

  it("every old address still opens Code where it said", { timeout: T }, async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    for (const [to, check] of [
      ["#/code", "[data-code-page] .cv-clients"],
      ["#/code/Northwind", "[data-code-page] [data-code-view='files']"],
      [`#/code/Northwind/${SALES}/${encodeURIComponent("/sql/orders.sql")}`, ".cv-file-view, [data-code-state]"],
      ["#/code/Northwind/kinds", "[data-code-kinds]"],
      ["#/code/~search", "[data-code-search]"],
      ["#/code/Northwind/inside", "[data-code-search]"],
    ] as const) {
      await go(page, to);
      await page.locator(check).first().waitFor();
      expect(await hash(page), to).toBe(to);
      expect(await page.locator('.topbar .view-tab[aria-current="page"]').textContent(), to).toContain("Code");
    }
    await page.close();
  });

  it("the search: choices on focus, This client first, nothing asked before Enter, no words sent for names, Esc goes back", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const sent = watchActions(page);
    await go(page, `#/code/Northwind/${SALES}`);
    await page.locator('[role="tree"] [data-path="/lake"]').first().click();
    await page.waitForTimeout(300);
    const browsing = await hash(page);
    const choices = page.locator("[data-code-choices]");
    expect(await choices.isVisible()).toBe(false);
    const box = page.locator("[data-code-search]");
    await box.click();
    await choices.waitFor();
    // Inside a client the search starts on This client; Names is the start.
    expect(await page.locator('[data-code-scope="client"]').getAttribute("aria-pressed")).toBe("true");
    expect(await page.locator('[data-code-mode="names"]').getAttribute("aria-pressed")).toBe("true");
    expect(await page.locator("[data-code-search-note]").textContent()).toMatch(/names only/);
    // Typing asks nothing.
    const before = sent.length;
    await box.pressSequentially("store", { delay: 30 });
    await page.waitForTimeout(400);
    // (Not the app's own read of which clients Code can open, made three seconds after it opens: it carries no words.)
    expect(sent.slice(before).filter((s) => s.action.startsWith("code.") && s.action !== "code.clients")).toEqual([]);
    await page.locator('[data-code-scope="all"]').click();
    // The click kept the caret in the box and the choices open.
    expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-code-search"))).toBe(true);
    await box.press("Enter");
    await page.locator("[data-code-results]").waitFor();
    expect(await hash(page)).toBe("#/code/~search");
    // The names search's words never leave the browser.
    const searched = sent.slice(before).filter((s) => s.action === "code.search");
    expect(searched.length).toBeGreaterThan(0);
    for (const s of searched) expect(s.body).not.toContain("store");
    // Results take the whole area: no tree beside them.
    expect(await page.locator("[data-code-side]").count()).toBe(0);
    // A result, then Back to results.
    await page.locator("[data-code-hit]").first().click();
    await page.locator(".cv-file-view").waitFor();
    await page.locator("[data-code-back-to-results]").click();
    await page.locator("[data-code-results]").waitFor();
    // Esc in the box goes back to exactly where browsing was.
    await box.click();
    await box.press("Escape");
    await page.waitForFunction((h0) => location.hash === h0, browsing);
    expect(await box.inputValue()).toBe("");
    expect(await page.locator('[role="tree"] [data-path="/lake"]').getAttribute("aria-expanded")).toBe("true");
    // Inside files: the choice and its note.
    await box.click();
    await page.locator('[data-code-mode="inside"]').click();
    expect(await page.locator("[data-code-search-note]").textContent()).toMatch(/is asked which files hold the words/);
    // Clearing the box closes the search too.
    await box.fill("StoreKey");
    await box.press("Enter");
    await page.locator("[data-code-inside-results]").waitFor();
    await box.fill("");
    await page.waitForFunction((h0) => location.hash === h0, browsing);
    // Nothing of the code, the client or the search is in the browser's storage.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(stored).not.toMatch(/Northwind|store|StoreKey|a1b2c3d4|\/lake/i);
    expect(await page.evaluate(() => localStorage.getItem("focustime.loc"))).toBe("#/code");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("By kind: the groups in order, the warehouse's objects only under Databases, no file listed twice", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await go(page, "#/code/Northwind/kinds");
    await page.locator("[data-code-kinds]").waitFor();
    const order = ["report", "model", "pipeline", "notebook", "dataflow", "lake", "database", "script", "fabric", "other"];
    const shown = await page.locator("[data-code-kind]").evaluateAll((els) => els.map((e) => e.getAttribute("data-code-kind")!));
    expect(shown.length).toBeGreaterThan(2);
    expect(shown).toEqual(order.filter((k) => shown.includes(k)));
    expect(shown).toContain("database");
    // Group by appears once, at the top of Databases.
    expect(await page.locator("[data-code-kinds] .cv-sql-bar").count()).toBe(1);
    expect(await page.locator('[data-code-kind="database"] .cv-sql-bar').count()).toBe(1);
    // Open everything, then every file is on one row only.
    await page.locator('[data-code-kind="database"]').getByRole("button", { name: "Expand all" }).click();
    for (const b of await page.locator("[data-code-kinds] .cv-thing-caret[aria-expanded='false']").all()) await b.click().catch(() => {});
    await page.waitForTimeout(300);
    const files = await page.locator("[data-code-kinds] [data-code-listed]").evaluateAll((els) => els.map((e) => e.getAttribute("data-code-listed")!));
    expect(files.length).toBeGreaterThan(5);
    expect(files.filter((f, i) => files.indexOf(f) !== i)).toEqual([]);
    // The warehouse's objects show only inside Databases.
    const objects = await page.locator('[data-code-kind="database"] .cv-sql-row.object').count();
    expect(objects).toBeGreaterThan(0);
    for (const k of shown.filter((x) => x !== "database")) expect(await page.locator(`[data-code-kind="${k}"] .cv-sql-row.object`).count(), k).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("the top bar is one row at 1280, 1366 and 1920, at every text size", { timeout: T }, async () => {
    for (const width of [1280, 1366, 1920]) {
      const { page } = await freshPage(h, { width, height: 900 });
      for (const [where, size] of ["#/code", "#/week", "#/day"].flatMap((w) => [null, "large", "larger"].map((z) => [w, z] as const))) {
        await page.evaluate((x) => (location.hash = x), where);
        await page.locator(".topbar .view-tab[aria-current='page']").waitFor();
        await page.evaluate((s) => (s ? document.documentElement.setAttribute("data-text-size", s) : document.documentElement.removeAttribute("data-text-size")), size);
        await page.waitForTimeout(150);
        const m = await page.evaluate(() => {
          const bar = document.querySelector<HTMLElement>(".app > .topbar")!;
          const kids = [...bar.children].filter((e) => (e as HTMLElement).offsetParent !== null && e.getBoundingClientRect().width > 0);
          const mids = kids.map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2));
          const tabsEl = [...bar.querySelectorAll<HTMLElement>(".view-tab")];
          return { height: bar.getBoundingClientRect().height, spread: Math.max(...mids) - Math.min(...mids), sideways: bar.scrollWidth - bar.clientWidth, tabs: tabsEl.length, hiddenTabs: tabsEl.filter((t) => t.getBoundingClientRect().width === 0).length, page: document.documentElement.scrollWidth - innerWidth };
        });
        const at = `${where} ${width} ${size ?? "default"}`;
        expect(m.tabs, at).toBe(6);
        expect(m.hiddenTabs, at).toBe(0);
        expect(m.spread, at).toBeLessThanOrEqual(4);
        expect(m.height, at).toBeLessThan(80);
        expect(m.sideways, at).toBeLessThanOrEqual(0);
        expect(m.page, at).toBeLessThanOrEqual(0);
      }
      await page.close();
    }
  });

  it("the phone: Code from More, the same search row and groups", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h, { width: 390, height: 844 });
    await page.locator(".bottom-bar, nav[aria-label]").first().waitFor();
    await page.locator('button[aria-label^="More"]').first().click();
    await page.getByRole("menuitem", { name: /^Code$/ }).click();
    await page$(page).waitFor();
    expect(await hash(page)).toBe("#/code");
    await page.locator(".cv-client-opt", { hasText: "Northwind" }).first().click();
    await page.locator("[data-code-search]").waitFor();
    await page.locator("[data-code-view='kinds']").click();
    await page.locator("[data-code-kinds]").waitFor();
    expect(await page.locator('[data-code-kind="database"]').count()).toBe(1);
    await page.locator("[data-code-search]").click();
    await page.locator("[data-code-choices]").waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  });
});
