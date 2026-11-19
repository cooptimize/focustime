// RB-3: "Where is it?" offers the client's real things as you type, on the New form and in the draft editor. Demo mode,
// the demo's invented repos (sources/demo/code.ts). The main path: nothing is read until the box is used with a client
// chosen, then one names read logged with where it was used; typing a word lists matches (best first), Down and Enter
// pick, a pick writes plain words at the cursor and replaces only the word typed, a second pick adds to the answer,
// Enter with no row chosen and Esc behave as before; the list by kind from the button, a database to a schema and a
// type, a report's pages and a table's measures (each listing logged once, RB-3b); the create writes exactly the box's text; a
// draft keeps only the text; nothing of the names in the browser's storage after; Code's rule (a team-only client and
// one FocusTime can't read) gives the plain box and one quiet line with no read. The phone: the list on screen, a tap
// picks. Edge cases are unit tests (plan/where-lookup.test.ts, actions/code-names.test.ts).
// FOCUSTIME_SHOTS: screenshots at 1440 × 900 and the phone, dark (and light for the list while typing).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { SHOTS } from "../shots.ts";
import { phonePage } from "../mb1-helpers.ts";

/** RQ-1: the three questions are a story's only, and from here the New form opens on another level: choose the story type. */
async function pickStory(f: Locator) {
  const r = f.getByRole("radio", { name: "User Story" });
  await r.waitFor({ timeout: 30_000 });
  if (!(await r.isChecked())) await r.click();
}


let h: Harness;
const T = 240_000;
const VIEW = { width: 1440, height: 900 };
const call = <R = unknown>(page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: R; error?: string }>;

async function shot(page: Page, name: string, themes: readonly ("dark" | "light")[] = ["dark"], large = false) {
  if (!SHOTS) return;
  for (const theme of themes) {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t === "light" ? "cooptimize-light" : "cooptimize-dark"), theme);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png` });
  }
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  if (large) {
    // CLAUDE.md: changed screens at 1920 and at the largest Text size too.
    const was = page.viewportSize()!;
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => document.documentElement.setAttribute("data-text-size", "larger"));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/${name}-1920-larger.png` });
    await page.evaluate(() => document.documentElement.removeAttribute("data-text-size"));
    await page.setViewportSize(was);
    await page.waitForTimeout(200);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** Every action the page asks the server for, with its input, in order. */
function actions(page: Page): { action: string; input: Record<string, unknown> }[] {
  const seen: { action: string; input: Record<string, unknown> }[] = [];
  page.on("request", (r) => {
    if (!r.url().endsWith("/api/action") || r.method() !== "POST") return;
    try {
      const b = JSON.parse(r.postData() ?? "{}") as { action: string; input: Record<string, unknown> };
      seen.push({ action: b.action, input: b.input ?? {} });
    } catch {
      /* not an action */
    }
  });
  return seen;
}
const form = (page: Page) => page.getByRole("dialog", { name: /^New (in .*DevOps|work item)$/ });
const preview = (page: Page) => page.getByRole("dialog", { name: "Create a DevOps item" });
const whereBox = (scope: Locator) => scope.locator('textarea[data-question="where"]');
const list = (page: Page) => page.getByRole("listbox");
const option = (page: Page, name: string | RegExp) => list(page).getByRole("option", { name });
async function choose(page: Page, scope: Locator, label: string, value: string) {
  await scope.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  const pop = page.locator(".cell-pop");
  const box = pop.getByRole("combobox");
  if (await box.count()) await box.fill(value);
  await pop.getByRole("option", { name: value }).first().click();
}
async function openNew(page: Page, client: string | null) {
  await page.evaluate(() => (location.hash = "#/ahead"));
  const newBtn = page.locator(".ah-new");
  await newBtn.waitFor({ timeout: 30_000 });
  await newBtn.click();
  const f = form(page);
  await f.waitFor();
  if (client) {
    await choose(page, f, "Client", client);
    await pickStory(f);
    await expect.poll(() => f.getByRole("radio", { checked: true }).count(), { timeout: 30_000 }).toBe(1);
  }
  return f;
}
/** Moves Down until the chosen row's name starts with `name`, then presses `key`. */
async function downTo(page: Page, name: string, key = "Enter") {
  for (let n = 0; n < 40; n++) {
    await page.keyboard.press("ArrowDown");
    const on = await list(page).locator('[role=option][aria-selected="true"]').getAttribute("aria-label");
    if (on?.startsWith(name)) return void (await page.keyboard.press(key));
  }
  throw new Error(`no row ${name}`);
}
const kindsReads = (seen: ReturnType<typeof actions>) => seen.filter((s) => s.action === "code.kinds");
// RB-3b: a report's pages and a table's measures are listed by code.inner (one Code log row per listing), not code.file.
const fileReads = (seen: ReturnType<typeof actions>) => seen.filter((s) => s.action === "code.inner");
type View = { event: string; clientKey: string; repoName: string; path: string };
const views = async (page: Page) => (await call<{ views: View[] }>(page, "admin.code_views", {})).data.views;

describe.skipIf(!CHROMIUM)("RB-3: Where is it?, picked from the client's code (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("the New form: matches as you type, picks as plain words, the list by kind, pages and measures, and the create writes the box's text", async () => {
    const { page, errors } = await freshPage(h, VIEW);
    const seen = actions(page);
    const logBefore = (await views(page)).length;

    // No client yet: the plain box, and the button says to choose one first. Nothing is read.
    let f = await openNew(page, null);
    const btn = f.getByRole("button", { name: "Choose a client first" });
    await btn.click();
    await expect(f.getByText("Choose a client first, then you can choose from its code.").count()).resolves.toBe(1);
    await whereBox(f).click();
    await page.keyboard.type("sales report");
    await expect(list(page).count()).resolves.toBe(0);
    expect(kindsReads(seen)).toEqual([]);
    await f.getByRole("button", { name: "Cancel" }).click();

    // Never focused: nothing is read and nothing is logged.
    f = await openNew(page, "Northwind");
    await f.getByRole("radio", { name: "User Story" }).click();
    await f.locator("#nf-title").fill("Margin on the store sales line");
    await page.waitForTimeout(300);
    expect(kindsReads(seen)).toEqual([]);

    // First focus: one read, in the background, saying where it is used.
    const box = whereBox(f);
    await box.focus();
    await expect.poll(() => kindsReads(seen).length).toBe(1);
    expect(kindsReads(seen)[0]!.input).toEqual({ clientKey: "Northwind", from: "new_form" });
    // The box is a text box with suggestions.
    await expect(box.getAttribute("aria-autocomplete")).resolves.toBe("list");

    // A word: matches, best first, the typed letters marked; nothing chosen until Down.
    await page.keyboard.type("On fact.sal");
    await list(page).waitFor();
    await expect(box.getAttribute("aria-controls")).resolves.toBe(await list(page).getAttribute("id"));
    const first = await list(page).getByRole("option").first().getAttribute("aria-label");
    expect(first).toBe("fact.SalesLine, Table · Gold warehouse · sales-analytics");
    await expect(list(page).locator("mark").first().textContent()).resolves.toBe("fact.Sal");
    await expect(box.getAttribute("aria-activedescendant")).resolves.toBeNull();
    await expect(page.getByRole("status").filter({ hasText: /names? match/ }).count()).resolves.toBeGreaterThan(0);
    await shot(page, "rb3-typing", ["dark", "light"], true);
    await page.keyboard.press("ArrowDown");
    const active = await box.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    await expect(page.locator(`[id="${active}"]`).getAttribute("aria-label")).resolves.toBe(first);
    await page.keyboard.press("Enter");
    await expect(box.inputValue()).resolves.toBe("On fact.SalesLine (table, Gold warehouse)");
    await expect(list(page).count()).resolves.toBe(0);
    await expect(page.getByRole("status").filter({ hasText: "Added fact.SalesLine." }).count()).resolves.toBe(1);

    // A second pick adds to the answer; a report's pages are read from its file when asked for.
    await page.keyboard.type(", the sale");
    await list(page).waitFor();
    await downTo(page, "Sales, Report", "ArrowRight");
    await option(page, /^Stores, Page of Sales/).waitFor({ timeout: 30_000 });
    await shot(page, "rb3-pages");
    await downTo(page, "Stores, Page of Sales");
    await expect(box.inputValue()).resolves.toBe("On fact.SalesLine (table, Gold warehouse), the Stores (page, Sales report)");
    expect(fileReads(seen).map((s) => s.input.path)).toEqual(["/report/Sales.Report/report.json"]);
    await shot(page, "rb3-two-picks");

    // The text can be edited like any text; Enter with no row chosen and Esc with the list open do what they always did.
    await page.keyboard.type(" st");
    await list(page).waitFor();
    await page.keyboard.press("Escape");
    await expect(list(page).count()).resolves.toBe(0);
    await expect(f.count()).resolves.toBe(1);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("sa");
    await list(page).waitFor();
    await page.keyboard.press("Enter");
    await expect(box.inputValue()).resolves.toBe("On fact.SalesLine (table, Gold warehouse), the Stores (page, Sales report) sa\n");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");

    // The list by kind from the button: a database opens to its schemas, then a type, then its objects.
    await f.getByRole("button", { name: "Browse Northwind's code" }).click();
    await option(page, /^Gold, Warehouse/).waitFor();
    const heads = await list(page).getByRole("group").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(heads.slice(0, 3)).toEqual(["Reports", "Semantic models", "Pipelines"]);
    expect(heads).toContain("Databases");
    await shot(page, "rb3-by-kind", ["dark"], true);
    await downTo(page, "Gold, Warehouse", "ArrowRight");
    await downTo(page, "dim,", "ArrowRight");
    await shot(page, "rb3-schema");
    await downTo(page, "Tables,", "Enter");
    await downTo(page, "dim.Date, Table");
    await expect(box.inputValue()).resolves.toBe("On fact.SalesLine (table, Gold warehouse), the Stores (page, Sales report) dim.Date (table, Gold warehouse)");

    // A table's measures and columns, read from the table's one file.
    await f.getByRole("button", { name: "Browse Northwind's code" }).click();
    await downTo(page, "Sales, Semantic model", "ArrowRight");
    await downTo(page, "Sales, Table", "ArrowRight");
    await option(page, /^Total Sales, Measure/).waitFor({ timeout: 30_000 });
    await downTo(page, "Total Sales, Measure");
    const text = "On fact.SalesLine (table, Gold warehouse), the Stores (page, Sales report) dim.Date (table, Gold warehouse) Total Sales (measure, Sales table, Sales semantic model)";
    await expect(box.inputValue()).resolves.toBe(text);
    expect(fileReads(seen).map((s) => s.input.path)).toEqual(["/report/Sales.Report/report.json", "/model/Sales.SemanticModel/definition/tables/Sales.tmdl"]);
    // Still one names read for the whole time the form was open.
    expect(kindsReads(seen)).toHaveLength(1);

    // The log: one names row naming the New form, never the words; a file row per file read.
    const log = (await views(page)).slice(0, (await views(page)).length - logBefore);
    expect(log.filter((v) => v.event === "where_new_form")).toEqual([expect.objectContaining({ clientKey: "Northwind", repoName: "All its repos on main", path: "" })]);
    expect(log.filter((v) => v.event === "pages_listed" || v.event === "fields_listed").map((v) => `${v.event} ${v.path}`).sort()).toEqual(["fields_listed /model/Sales.SemanticModel/definition/tables/Sales.tmdl", "pages_listed /report/Sales.Report/report.json"]);
    expect(log.filter((v) => v.event === "file_opened")).toEqual([]);
    expect(JSON.stringify(log)).not.toMatch(/fact\.sal|the sale|On fact/i);

    // The create writes exactly the box's text under "Where:"; nothing else of a pick goes with it.
    await box.press("Control+Enter");
    const p = preview(page);
    await p.waitFor({ timeout: 30_000 });
    await expect(p.textContent()).resolves.toContain(`Where: ${text}`);
    const begin = seen.filter((s) => s.action === "devops.preview").at(-1)!;
    const change = (begin.input.changes as { answers?: Record<string, string> }[])[0]!;
    expect(change.answers).toEqual({ where: text, change: "", check: "" });
    await p.getByRole("button", { name: "Create in DevOps" }).click();
    await expect.poll(() => form(page).count(), { timeout: 30_000 }).toBe(0);
    const made = (await call<{ entries: { op: string; status: string; title: string }[] }>(page, "devops.log", {})).data.entries.filter((e) => e.op === "create" && e.status === "confirmed");
    expect(made.map((e) => e.title)).toContain("Margin on the store sales line");

    // Nothing of the names is left in the browser.
    const kept = await page.evaluate(async () => {
      const all: string[] = [];
      for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) all.push(`${s.key(i)}=${s.getItem(s.key(i)!)}`);
      const caches_ = "caches" in window ? await caches.keys() : [];
      for (const k of caches_) for (const r of await (await caches.open(k)).keys()) all.push(r.url);
      const dbs = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name ?? "") : [];
      return [...all, ...dbs].join("\n");
    });
    expect(kept).not.toMatch(/SalesLine|Gold|Total Sales|sales-analytics|report\.json/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("when the code can't be read: the plain box and one quiet line by reason, Try again only for a failed read, and the text stays across a client change", async () => {
    const { page, errors } = await freshPage(h, VIEW);
    const seen = actions(page);
    // The server's refusals by Code's own rule are unit tests (actions/code-names.test.ts); here, what the box does with
    // each. The demo person's New form lists only clients whose code they can read, so the answers are staged.
    const answers: { status: number; code: string; error: string }[] = [
      { status: 403, code: "team_only", error: "Only Northwind's team can open this." },
      { status: 503, code: "busy", error: "DevOps is busy. Try again in a moment." },
    ];
    await page.route("**/api/action", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as { action?: string };
      const next = body.action === "code.kinds" ? answers.shift() : undefined;
      if (!next) return route.continue();
      await route.fulfill({ status: next.status, contentType: "application/json", body: JSON.stringify({ ok: false, status: next.status, error: next.error, code: next.code }) });
    });
    const f = await openNew(page, "Northwind");
    const box = whereBox(f);
    await box.focus();
    await f.getByText("Only Northwind's team can read its code, so no names are offered. Type the name.").waitFor({ timeout: 30_000 });
    await expect(box.getAttribute("aria-describedby")).resolves.toBe(`${await box.getAttribute("id")}-line`);
    await page.keyboard.type("Sales report, the margin page");
    await expect(list(page).count()).resolves.toBe(0);
    await expect(box.inputValue()).resolves.toBe("Sales report, the margin page");
    await expect(f.getByRole("button", { name: "Try again" }).count()).resolves.toBe(0);
    await page.keyboard.press("Enter");
    await expect(box.inputValue()).resolves.toBe("Sales report, the margin page\n");
    await shot(page, "rb3-cant-read");
    // Another client: the text stays as typed, and its names are read when the box is next used.
    await choose(page, f, "Client", "Atlas");
    await pickStory(f);
    await expect(box.inputValue()).resolves.toBe("Sales report, the margin page\n");
    await box.focus();
    await f.getByText("Atlas's code couldn't be read just now. Type the name, or try again.").waitFor({ timeout: 30_000 });
    // Tab goes on to the next question as before (Try again is out of the Tab order); Alt+Down or a click tries again.
    await box.press("Tab");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-question"))).toBe("change");
    await box.focus();
    await box.press("Alt+ArrowDown");
    await expect.poll(() => kindsReads(seen).map((s) => s.input.clientKey)).toEqual(["Northwind", "Atlas", "Atlas"]);
    await expect.poll(() => f.locator(".wl-line").count(), { timeout: 30_000 }).toBe(0);
    await box.press("End");
    await page.keyboard.type(" pl_lo");
    await list(page).waitFor({ timeout: 30_000 });
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the draft editor: the same lookup, logged as the draft editor, and the draft keeps only the text", async () => {
    const { page, errors } = await freshPage(h, VIEW);
    const seen = actions(page);
    const f = await openNew(page, "Northwind");
    await f.getByRole("radio", { name: "User Story" }).click();
    await f.locator("#nf-title").fill("Store region view");
    await whereBox(f).focus();
    await page.keyboard.type("dim.vst");
    await list(page).waitFor({ timeout: 30_000 });
    await downTo(page, "dim.vStoreRegion");
    await f.getByRole("button", { name: "Save as draft" }).click();
    await expect.poll(() => f.count(), { timeout: 30_000 }).toBe(0);
    const drafts = (await call<{ drafts: { id: number; title: string; answers?: Record<string, string> }[] }>(page, "capture.load", {})).data.drafts;
    const d = drafts.find((x) => x.title === "Store region view")!;
    expect(d.answers).toEqual({ where: "dim.vStoreRegion (view, Gold warehouse)", change: "", check: "" });
    expect(JSON.stringify(d)).not.toMatch(/sales-analytics|\.sql|a1b2c3d4/);

    await page.evaluate((i) => (location.hash = `#/inbox/item/d${i}`), d.id);
    await page.locator("li.ib4-row.open").getByRole("button", { name: "Edit draft" }).click({ timeout: 30_000 });
    const ed = page.locator(".draft-editor");
    await ed.waitFor();
    const box = whereBox(ed);
    await box.focus();
    await expect.poll(() => kindsReads(seen).map((s) => s.input.from)).toEqual(["new_form", "draft_editor"]);
    await box.press("End");
    await page.keyboard.type(" and rpt.vto");
    await list(page).waitFor({ timeout: 30_000 });
    await shot(page, "rb3-draft-editor");
    await downTo(page, "rpt.vTopStores");
    await expect(box.inputValue()).resolves.toBe("dim.vStoreRegion (view, Gold warehouse) and rpt.vTopStores (view, Gold warehouse)");
    // A letter typed right after a pick doesn't run into it.
    await page.keyboard.type("is");
    await expect(box.inputValue()).resolves.toBe("dim.vStoreRegion (view, Gold warehouse) and rpt.vTopStores (view, Gold warehouse) is");
    for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
    // Two words as one name: "load sa" is the Load sales pipeline, replaced whole.
    await page.keyboard.type(" then load sa");
    await list(page).waitFor();
    await expect(list(page).getByRole("option").first().getAttribute("aria-label")).resolves.toMatch(/^Load sales, Pipeline/);
    await downTo(page, "Load sales, Pipeline");
    await expect(box.inputValue()).resolves.toBe("dim.vStoreRegion (view, Gold warehouse) and rpt.vTopStores (view, Gold warehouse) then Load sales (pipeline)");
    for (let i = 0; i < " then Load sales (pipeline)".length; i++) await page.keyboard.press("Backspace");
    // Esc with the list open closes the list only; the editor stays.
    await page.keyboard.type(" st");
    await list(page).waitFor();
    await page.keyboard.press("Escape");
    await expect(ed.count()).resolves.toBe(1);
    // With the list closed: Alt+Down opens it by kind; Tab goes on to the next question, as before (the button is out of the Tab order).
    await page.keyboard.press("Alt+ArrowDown");
    await list(page).getByRole("group", { name: "Reports" }).waitFor();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-question"))).toBe("change");
    expect((await views(page)).filter((v) => v.event === "where_draft_editor").length).toBeGreaterThanOrEqual(1);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the phone: the list sits on screen, a tap picks, and the box works as plain text", async () => {
    const page = await phonePage(h, 390);
    await page.locator(".topbar, .bottombar").first().waitFor({ timeout: 60_000 });
    await page.evaluate(() => (location.hash = "#/ahead"));
    await page.keyboard.press("Shift+N");
    const f = form(page);
    await f.waitFor({ timeout: 30_000 });
    await choose(page, f, "Client", "Northwind");
    await pickStory(f);
    await f.getByRole("button", { name: /More: details, description and size/ }).click();
    const box = whereBox(f);
    await box.tap();
    await page.keyboard.type("stg.s");
    await list(page).waitFor({ timeout: 30_000 });
    const r = await page.locator(".wl-pop").evaluate((e) => {
      const b = e.getBoundingClientRect();
      const vv = window.visualViewport!;
      return { top: b.top, bottom: b.bottom, h: vv.height + vv.offsetTop, w: document.documentElement.scrollWidth <= window.innerWidth };
    });
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.bottom).toBeLessThanOrEqual(r.h);
    expect(r.w).toBe(true);
    await shot(page, "rb3-phone");
    await option(page, /^stg\.Store, Table/).tap();
    await expect(box.inputValue()).resolves.toBe("stg.Store (table, Gold warehouse)");
    await page.keyboard.type(" and the old export");
    await expect(box.inputValue()).resolves.toBe("stg.Store (table, Gold warehouse) and the old export");
    await page.close();
  }, T);
});
