// RB-3b: names picked from one client's code never travel into another client's item. Demo mode, the demo's invented
// repos (sources/demo/code.ts). Pick names for Northwind in "Where is it?", change the form's client, and create: the
// create carries only the words the person typed. The pick edge cases are unit tests (plan/where-picks.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

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
    await expect.poll(() => f.getByRole("radio", { checked: true }).count(), { timeout: 30_000 }).toBe(1);
    await f.locator("#nf-title").press("Control+Enter");
    await expect.poll(() => sentWhere(seen), { timeout: 30_000 }).not.toBeNull();
    const sent = sentWhere(seen)!;
    expect(sent.client).toBe("Atlas");
    expect(String(sent.where)).not.toMatch(/SalesLine|dim\.Store|Gold/);
    expect(sent.where).toBe("The totals and");
    await page.close();
  }, T);
});
