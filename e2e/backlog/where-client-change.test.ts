// RB-3b: names picked from one client's code never travel into another client's item. Demo mode, the demo's invented
// repos (sources/demo/code.ts). Pick names for Northwind in "Where is it?", change the form's client, and create: the
// create carries only the words the person typed. UC-3: Undo puts the client back with the names, and the fields the
// change reset. The pick edge cases are unit tests (plan/where-picks.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { SHOTS } from "../shots.ts";

/** RQ-1: the three questions are a story's only, and from here the New form opens on another level: choose the story type. */
async function pickStory(f: Locator) {
  const r = f.getByRole("radio", { name: "User Story" });
  await r.waitFor({ timeout: 30_000 });
  if (!(await r.isChecked())) await r.click();
}


let h: Harness;
const T = 240_000;
const VIEW = { width: 1440, height: 900 };

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
const call = <R = unknown>(page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: R; error?: string }>;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "cooptimize-dark"));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/${name}-dark.png` });
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  await page.emulateMedia({ colorScheme: "light" });
}
const form = (page: Page) => page.getByRole("dialog", { name: /^New (in .*DevOps|work item)$/ });
const whereBox = (scope: Locator) => scope.locator('textarea[data-question="where"]');
const list = (page: Page) => page.getByRole("listbox");
async function choose(page: Page, scope: Locator, label: string, value: string) {
  await scope.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  const pop = page.locator(".cell-pop");
  const box = pop.getByRole("combobox");
  if (await box.count()) await box.fill(value);
  await pop.getByRole("option", { name: value }).first().click();
}
async function openNew(page: Page, client: string) {
  await page.evaluate(() => (location.hash = "#/ahead"));
  const newBtn = page.locator(".ah-new");
  await newBtn.waitFor({ timeout: 30_000 });
  await newBtn.click();
  const f = form(page);
  await f.waitFor();
  await choose(page, f, "Client", client);
  await pickStory(f);
  await expect.poll(() => f.getByRole("radio", { checked: true }).count(), { timeout: 30_000 }).toBe(1);
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
/** What the create (or, without a write PAT, the draft) would write for "Where is it?". */
const sentWhere = (seen: ReturnType<typeof actions>): { action: string; client: unknown; where: unknown } | null => {
  for (const s of [...seen].reverse()) {
    if (s.action === "devops.preview") {
      const c = (s.input.changes as { clientKey?: string; answers?: { where?: string } }[] | undefined)?.[0];
      return { action: s.action, client: s.input.clientKey ?? c?.clientKey, where: c?.answers?.where };
    }
    if (s.action === "draft.add") return { action: s.action, client: s.input.clientKey, where: (s.input.answers as { where?: string } | undefined)?.where };
  }
  return null;
};

describe.skipIf(!CHROMIUM)("RB-3b: a client change takes out names picked from the other client's code (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("the fault: names picked for Northwind don't reach Atlas's create", async () => {
    const { page } = await freshPage(h, VIEW);
    const seen = actions(page);
    const f = await openNew(page, "Northwind");
    await f.getByRole("radio", { name: "User Story" }).click();
    await f.locator("#nf-title").fill("Totals are wrong");
    const box = whereBox(f);
    await box.focus();
    await page.keyboard.type("The fact.sal");
    await list(page).waitFor({ timeout: 30_000 });
    await downTo(page, "fact.SalesLine");
    await page.keyboard.type(" totals and dim.sto");
    await list(page).waitFor();
    await downTo(page, "dim.Store");
    await expect(box.inputValue()).resolves.toBe("The fact.SalesLine (table, Gold warehouse) totals and dim.Store (table, Gold warehouse)");
    await choose(page, f, "Client", "Atlas");
    await pickStory(f);
    await expect.poll(() => f.getByRole("radio", { checked: true }).count(), { timeout: 30_000 }).toBe(1);
    await f.locator("#nf-title").press("Control+Enter");
    await expect.poll(() => sentWhere(seen), { timeout: 30_000 }).not.toBeNull();
    const sent = sentWhere(seen)!;
    expect(sent.client).toBe("Atlas");
    expect(String(sent.where)).not.toMatch(/SalesLine|dim\.Store|Gold/);
    expect(sent.where).toBe("The totals and");
    await page.close();
  }, T);

  it("the New form: the line and Undo, an edited pick stays as typed, a second change the same, and nothing of the picks is kept", async () => {
    const { page, errors } = await freshPage(h, VIEW);
    const seen = actions(page);
    const f = await openNew(page, "Northwind");
    await f.getByRole("radio", { name: "User Story" }).click();
    await f.locator("#nf-title").fill("Store totals");
    const box = whereBox(f);
    await box.focus();
    await page.keyboard.type("The fact.sal");
    await list(page).waitFor({ timeout: 30_000 });
    await downTo(page, "fact.SalesLine");
    await page.keyboard.type(" totals and dim.sto");
    await list(page).waitFor();
    await downTo(page, "dim.Store");
    const both = "The fact.SalesLine (table, Gold warehouse) totals and dim.Store (table, Gold warehouse)";
    await expect(box.inputValue()).resolves.toBe(both);
    // UC-3: a parent chosen before the change, to see it come back with the client.
    const parentButton = f.getByRole("button", { name: /^Parent:/ });
    await parentButton.click();
    const firstParent = page.locator(".cell-pop").getByRole("option").nth(1);
    await firstParent.click();
    const parentBefore = await parentButton.getAttribute("aria-label").then((x) => x ?? parentButton.textContent());
    expect(parentBefore).not.toMatch(/None$/);
    const clientBefore = await f.getByRole("button", { name: /^Client:/ }).textContent();
    const levelBefore = await f.getByRole("radio", { checked: true }).getAttribute("aria-label").then(async (x) => x ?? (await f.getByRole("radio", { checked: true }).textContent()));

    // A client change: the picks go, the typed words stay, one line with Undo, heard by a screen reader.
    await choose(page, f, "Client", "Atlas");
    await pickStory(f);
    await expect(box.inputValue()).resolves.toBe("The totals and");
    const line = f.locator("[data-where-picks]");
    await expect(line.getByRole("status").textContent()).resolves.toBe("Took out 2 names picked from Northwind's code.");
    await expect(line.getByRole("button", { name: "Undo: put back the 2 names and the client" }).count()).resolves.toBe(1);
    await shot(page, "rb3b-taken-out");
    // UC-3 item 8: Undo puts the names back and the client with them, and the level and parent it had, so the names
    // never sit under another client.
    await line.getByRole("button", { name: /^Undo/ }).click();
    await expect(box.inputValue()).resolves.toBe(both);
    await expect.poll(() => f.getByRole("button", { name: /^Client:/ }).textContent()).toBe(clientBefore);
    await expect.poll(() => f.getByRole("heading", { level: 2 }).textContent()).toBe("New in Northwind's DevOps");
    await expect.poll(async () => (await f.getByRole("radio", { checked: true }).getAttribute("aria-label")) ?? (await f.getByRole("radio", { checked: true }).textContent()), { timeout: 30_000 }).toBe(levelBefore);
    await expect.poll(async () => (await parentButton.getAttribute("aria-label")) ?? (await parentButton.textContent()), { timeout: 30_000 }).toBe(parentBefore);
    // Focus goes back to the box the names went into (review 3).
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-question"))).toBe("where");
    await expect(line.getByRole("status").textContent()).resolves.toBe("Put back 2 names and the client, Northwind.");
    await expect(line.getByRole("button").count()).resolves.toBe(0);
    await shot(page, "rb3b-put-back");

    // An edited pick is typed text: edit the first, change client again, and only the second goes.
    await box.focus();
    await box.evaluate((t: HTMLTextAreaElement, n) => t.setSelectionRange(n, n), "The fact.SalesLine (table, Gold".length);
    await page.keyboard.type("en");
    const edited = "The fact.SalesLine (table, Golden warehouse) totals and dim.Store (table, Gold warehouse)";
    await expect(box.inputValue()).resolves.toBe(edited);
    await choose(page, f, "Client", "Harbor");
    await pickStory(f);
    await expect(box.inputValue()).resolves.toBe("The fact.SalesLine (table, Golden warehouse) totals and");
    await expect(line.getByRole("status").textContent()).resolves.toBe("Took out 1 name picked from Northwind's code.");
    // Back to Northwind: nothing comes back by itself, and the old Undo is gone.
    await choose(page, f, "Client", "Northwind");
    await pickStory(f);
    await expect(box.inputValue()).resolves.toBe("The fact.SalesLine (table, Golden warehouse) totals and");
    await expect(line.getByRole("button").count()).resolves.toBe(0);

    // The create is never held up, and carries only the box's text: no pick, client or path goes with it.
    await expect.poll(() => f.getByRole("radio", { checked: true }).count(), { timeout: 30_000 }).toBe(1);
    await f.locator("#nf-title").press("Control+Enter");
    await expect.poll(() => sentWhere(seen), { timeout: 30_000 }).not.toBeNull();
    const last = [...seen].reverse().find((s) => s.action === "devops.preview" || s.action === "draft.add")!;
    expect(JSON.stringify(last.input)).not.toMatch(/"picks?"|start|Northwind's code|a1b2c3d4|\.sql"/);
    const kept = await page.evaluate(async () => {
      const all: string[] = [];
      for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) all.push(`${s.key(i)}=${s.getItem(s.key(i)!)}`);
      const caches_ = "caches" in window ? await caches.keys() : [];
      for (const k of caches_) for (const r of await (await caches.open(k)).keys()) all.push(r.url);
      const dbs = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name ?? "") : [];
      return [...all, ...dbs].join("\n");
    });
    expect(kept).not.toMatch(/SalesLine|dim\.Store|Gold|picked/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the draft editor: the same on a client change, and the saved draft keeps only the text", async () => {
    const { page, errors } = await freshPage(h, VIEW);
    const f = await openNew(page, "Northwind");
    await f.getByRole("radio", { name: "User Story" }).click();
    await f.locator("#nf-title").fill("Region view check");
    await f.getByRole("button", { name: "Save as draft" }).click();
    await expect.poll(() => f.count(), { timeout: 30_000 }).toBe(0);
    const load = async () => (await call<{ drafts: { id: number; title: string; clientKey: string; answers?: Record<string, string> | null }[] }>(page, "capture.load", {})).data.drafts.find((x) => x.title === "Region view check")!;
    const d = await load();
    await page.evaluate((i) => (location.hash = `#/inbox/item/d${i}`), d.id);
    await page.locator("li.ib4-row.open").getByRole("button", { name: "Edit draft" }).click({ timeout: 30_000 });
    const ed = page.locator(".draft-editor");
    await ed.waitFor();
    const box = whereBox(ed);
    await box.focus();
    await page.keyboard.type("Check dim.vst");
    await list(page).waitFor({ timeout: 30_000 });
    await downTo(page, "dim.vStoreRegion");
    await page.keyboard.type(" by hand");
    await expect(box.inputValue()).resolves.toBe("Check dim.vStoreRegion (view, Gold warehouse) by hand");
    await ed.getByRole("combobox", { name: "Client" }).selectOption("Atlas");
    await expect(box.inputValue()).resolves.toBe("Check by hand");
    const line = ed.locator("[data-where-picks]");
    await expect(line.getByRole("status").textContent()).resolves.toBe("Took out 1 name picked from Northwind's code.");
    await line.getByRole("button", { name: /^Undo/ }).click();
    await expect(box.inputValue()).resolves.toBe("Check dim.vStoreRegion (view, Gold warehouse) by hand");
    // UC-3 item 8: the client comes back with the name.
    await expect(line.getByRole("status").textContent()).resolves.toBe("Put back 1 name and the client, Northwind.");
    await expect(ed.getByRole("combobox", { name: "Client" }).inputValue()).resolves.toBe("Northwind");
    // A second change: the same again; then save. The draft's row holds the text only.
    await ed.getByRole("combobox", { name: "Client" }).selectOption("Harbor");
    await expect(box.inputValue()).resolves.toBe("Check by hand");
    await ed.getByRole("button", { name: /^Save/ }).first().click();
    await expect.poll(() => ed.count(), { timeout: 30_000 }).toBe(0);
    const after = await load();
    expect(after.clientKey).toBe("Harbor");
    expect(after.answers).toEqual({ where: "Check by hand", change: "", check: "" });
    expect(JSON.stringify(after)).not.toMatch(/vStoreRegion|Gold|Northwind's code|pick/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
