// RQ-1: needed fields asked before DevOps refuses. Demo mode with Northwind's process requiring a Target Date on new
// features and stories (FOCUSTIME_DEMO_DEVOPS_RULES=target, a rule the type's always-required list doesn't show).
// The New form at feature level: no three questions; Target date marked Needed as soon as the form has a client and a
// type, Create waits for it, then the one preview carries it. At story level: the three questions and the same Needed
// date. Break down: Review shows the needed Target Date with Use for all, Preview waits until every story has one, and
// each created story carries it. Edge cases are unit tests (actions/devops-write.test.ts, actions/story-actions.test.ts,
// plan/needed-levels.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";
import { onePreview } from "../one-preview.ts";

const T = 240_000;
const VIEW = { width: 1440, height: 900 };
const call = <R = unknown>(page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: R }>;
type Entry = { op: string; status: string; title: string | null; parentId: number | null; after: Record<string, string | null> };
const log = async (page: Page) => (await call<{ entries: Entry[] }>(page, "devops.log", {})).data.entries;
const form = (page: Page) => page.getByRole("dialog", { name: /^New (in .*DevOps|work item)$/ });

async function choose(page: Page, scope: Locator, label: string, option: string) {
  await scope.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  const pop = page.locator(".cell-pop");
  const box = pop.getByRole("combobox");
  if (await box.count()) await box.fill(option);
  await pop.getByRole("option", { name: option }).first().click();
}
async function pickDate(page: Page, scope: Locator, label: RegExp, day: string) {
  await scope.getByRole("button", { name: label }).first().click();
  await page.locator(".dp-pop input.dp-box").fill(day);
  await page.locator(".dp-pop input.dp-box").press("Enter");
  await page.locator(".dp-pop").waitFor({ state: "detached" });
}
async function openNew(page: Page) {
  await page.evaluate(() => (location.hash = "#/ahead"));
  await page.locator(".ah-new").waitFor({ timeout: 30_000 });
  await page.locator(".ah-new").click();
  const f = form(page);
  await f.waitFor();
  await choose(page, f, "Client", "Northwind");
  await expect.poll(() => f.getByRole("radio", { checked: true }).count(), { timeout: 30_000 }).toBe(1);
  return f;
}

describe.skipIf(!CHROMIUM)("RQ-1: needed fields before DevOps refuses (browser, demo mode)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", { FOCUSTIME_DEMO_DEVOPS_RULES: "target" }, "2026-11-02T10:00:00-05:00");
  }, T);
  afterAll(async () => h?.stop());

  it("the New form: Needed at feature and at story level, the three questions at story level only, Create waits", async () => {
    const { page, errors } = await freshPage(h, VIEW);
    const f = await openNew(page);
    await f.getByRole("radio", { name: "Feature" }).click();
    await f.locator("#nf-title").fill("Supplier self-service portal");
    // Asked when the form has a client and a type: the date is Needed, said why, and Create waits.
    await expect.poll(() => f.locator(".set-label", { hasText: "Target date" }).locator(".mtg-needed").count(), { timeout: 20_000 }).toBe(1);
    await expect(f.textContent()).resolves.toContain("Required by this client's process");
    await expect(f.locator(".nf-needed").textContent()).resolves.toMatch(/Target Date is needed: this client's process requires it on a new Feature/);
    const create = f.getByRole("button", { name: "Create in DevOps" });
    await expect(create.isDisabled()).resolves.toBe(true);
    // Above story level the three questions aren't asked.
    await expect(f.locator("textarea.tq-box").count()).resolves.toBe(0);
    await pickDate(page, f, /^Target date/, "2026-12-18");
    await expect.poll(() => create.isDisabled()).toBe(false);
    await expect(f.locator(".set-label", { hasText: "Target date" }).locator(".mtg-needed").count()).resolves.toBe(0);
    await create.click();
    const d = page.getByRole("dialog", { name: "Create a DevOps item" });
    await d.waitFor({ timeout: 20_000 });
    await expect(d.textContent()).resolves.toContain("2026-12-18");
    await d.getByRole("button", { name: "Create in DevOps" }).click();
    await expect.poll(async () => (await log(page)).some((e) => e.op === "create" && e.status === "confirmed" && e.title === "Supplier self-service portal"), { timeout: 30_000 }).toBe(true);

    // At story level: the three questions, and the same Needed date.
    const s = await openNew(page);
    await s.getByRole("radio", { name: "User Story" }).click();
    await expect(s.locator("textarea.tq-box").count()).resolves.toBe(3);
    await expect.poll(() => s.locator(".set-label", { hasText: "Target date" }).locator(".mtg-needed").count(), { timeout: 20_000 }).toBe(1);
    await s.locator("#nf-title").fill("Save a supplier draft");
    await expect(s.getByRole("button", { name: "Create in DevOps" }).isDisabled()).resolves.toBe(true);
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Break down: the needed Target Date with Use for all; Preview waits; every story carries it", async () => {
    const { page, errors } = await freshPage(h, VIEW);
    await page.evaluate(() => (location.hash = "#/backlog/attention"));
    await page.reload();
    const row = page.locator(".ah-grid tbody .ah-row:not(.context)", { hasText: "Supplier onboarding" }).first();
    await row.waitFor({ timeout: 30_000 });
    await row.getByRole("button", { name: /Break down/ }).first().click();
    const panel = page.getByRole("dialog", { name: /^Break down Feature: / });
    await panel.waitFor({ timeout: 15_000 });
    await panel.getByRole("button", { name: "Run" }).click();
    await panel.getByRole("listitem", { name: /^Card / }).first().waitFor({ timeout: 30_000 });
    const needs = panel.locator(".bd-needs");
    await needs.waitFor({ timeout: 20_000 });
    await expect(needs.textContent()).resolves.toContain("Target Date");
    const previewBtn = panel.getByRole("button", { name: /^Preview \d+ items/ });
    await expect(previewBtn.isDisabled()).resolves.toBe(true);
    await expect(panel.textContent()).resolves.toMatch(/5 stories need a value before the preview/);
    await pickDate(page, needs, /^Target Date for every story/, "2026-12-11");
    await needs.getByRole("button", { name: "Use for all" }).click();
    await expect.poll(() => previewBtn.isDisabled(), { timeout: 15_000 }).toBe(false);
    await expect(panel.locator(".bd-card-needs .mtg-needed").count()).resolves.toBe(0);
    const before = (await log(page)).length;
    await previewBtn.click();
    const d = onePreview(page);
    await d.waitFor({ timeout: 20_000 });
    const rows = await d.locator(".dw-row").count();
    await d.locator("button.commit").click();
    await d.waitFor({ state: "detached", timeout: 30_000 });
    await panel.getByText(/^Created \d+ items? under/).waitFor({ timeout: 30_000 });
    const made = (await log(page)).slice(0, (await log(page)).length - before);
    expect(made.filter((e) => e.op === "create" && e.status === "confirmed")).toHaveLength(rows);
    for (const e of made) expect(e.after["Target date"]).toBe("2026-12-11");
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
