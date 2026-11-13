// QC-1 Create work quickly, the main paths in demo mode (the demo's own fake DevOps, no AI needed): Ahead's + New →
// title → Enter → the write preview → Create, the new item selected in Grid; New under an epic (a feature) and under a
// feature (a story); a level above epic (Cooptimize's Domain); the block panel's Add box "New feature: <text>" putting
// the created feature on the block; Capture → Draft feature → Ctrl+Enter → Create without opening the Inbox; a draft
// story's Create in DevOps from its row, staying on its block; no write PAT → the one line and Save as draft.
// Edge cases are unit tests (plan/quick-create.test.ts, actions/new-item-actions.test.ts, actions/devops-write.test.ts).
// FOCUSTIME_SHOTS: screenshots at 1440 × 900, light and dark (docs/ux/qc1/ for the PR).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";
import { appReady, liveBrowser, liveContext, liveTeam, type LiveBrowser } from "./live.ts";

let h: Harness;
const T = 180_000;
const VIEW = { width: 1440, height: 900 };
const call = <R = unknown>(page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: R; error?: string }>;

/** <name>-light.png and <name>-dark.png at 1440 × 900. */
async function shot(page: Page, name: string, keep?: Locator) {
  if (!SHOTS) return;
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    const was = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t === "light" ? "cooptimize-light" : "cooptimize-dark"), theme);
    await page.waitForTimeout(200);
    await keep?.scrollIntoViewIfNeeded().catch(() => undefined);
    await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png` });
    await page.evaluate((w) => (w ? document.documentElement.setAttribute("data-theme", w) : document.documentElement.removeAttribute("data-theme")), was);
  }
  await page.emulateMedia({ colorScheme: "light" });
}
const form = (page: Page) => page.getByRole("dialog", { name: /^New (in .*DevOps|work item)$/ });
const preview = (page: Page) => page.getByRole("dialog", { name: "Create a DevOps item" });
const posts = async (page: Page) => (await call<{ entries: { op: string; status: string; title: string; itemId: number | null }[] }>(page, "devops.log", {})).data.entries.filter((e) => e.op === "create" && e.status === "confirmed");
async function choose(page: Page, scope: Locator, label: string, option: string | RegExp) {
  await scope.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  const pop = page.locator(".cell-pop");
  const box = pop.getByRole("combobox");
  if (await box.count()) await box.fill(typeof option === "string" ? option : "");
  await pop.getByRole("option", { name: option }).first().click();
}
/** On a failure, a screenshot where QC1_DEBUG says (not committed anywhere). */
async function failShot(page: Page, name: string, run: () => Promise<void>) {
  try {
    await run();
  } catch (e) {
    if (process.env.QC1_DEBUG) await page.screenshot({ path: `${process.env.QC1_DEBUG}/${name}.png` }).catch(() => undefined);
    throw e;
  }
}
async function createFromForm(page: Page, title: string) {
  const f = form(page);
  await f.locator("#nf-title").fill(title);
  await f.locator("#nf-title").press("Enter");
  await preview(page).waitFor();
}

describe.skipIf(!CHROMIUM)("QC-1: one New form, straight to DevOps (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("Backlog: + New, Enter, the preview, Create; selected in Grid even when a filter would hide it; New under; a level above epic", async () => {
    const { page, errors } = await freshPage(h, VIEW);
    await failShot(page, "t0", async () => {
      await page.evaluate(() => (location.hash = "#/ahead"));
      const newBtn = page.locator(".ah-new");
      await newBtn.waitFor({ timeout: 30_000 });
      await newBtn.click();
      const f = form(page);
      await f.waitFor();
      await choose(page, f, "Client", "Northwind");
      // The feature tier, me, no parent: the defaults. Only the title is typed.
      await expect.poll(() => f.getByRole("radio", { name: "Feature" }).getAttribute("aria-checked")).toBe("true");
      await expect(f.getByRole("button", { name: /^Parent:/ }).textContent()).resolves.toContain("None");
      await shot(page, "qc1-form-ahead", f);
      await f.getByRole("button", { name: /More: description and size/ }).click();
      await shot(page, "qc1-form-more", f);
      await createFromForm(page, "Gift cards at checkout");
      const p = preview(page);
      await expect(p.textContent()).resolves.toContain("Gift cards at checkout");
      await expect(p.locator(".wd-where").textContent()).resolves.toContain("Northwind");
      await shot(page, "qc1-preview", p);
      const before = (await posts(page)).length;
      await p.getByRole("button", { name: "Create in DevOps" }).click();
      await expect.poll(async () => (await posts(page)).length).toBe(before + 1);
      // Ahead says so; the default People filter is mine, and a new item assigned to me shows.
      await expect.poll(() => page.locator(".ah-refreshed").textContent(), { timeout: 30_000 }).toMatch(/^Created #\d+/);
      await expect.poll(() => page.locator(".ah-grid, .ah-tree, main").first().textContent()).toContain("Gift cards at checkout");
      await shot(page, "qc1-created-in-ahead", page.locator("tr.ah-row.highlighted").first());

      // Assigned to nobody: Assigned to me would hide it; it shows until I leave, and says which filter hides it.
      await page.getByRole("group", { name: "People" }).getByRole("button", { name: "Mine", exact: true }).click();
      await newBtn.click();
      await choose(page, f, "Client", "Northwind");
      await choose(page, f, "Assigned to", "Unassigned");
      await createFromForm(page, "Loyalty export for nobody yet");
      await preview(page).getByRole("button", { name: "Create in DevOps" }).click();
      await expect.poll(() => page.locator(".ah-refreshed").textContent(), { timeout: 30_000 }).toMatch(/^Created #\d+\. Shown until you leave Backlog\. Hidden by: Assigned to me$/);
      await expect.poll(() => page.locator("main").first().textContent()).toContain("Loyalty export for nobody yet");
      // Selected in Grid: its row is the highlighted one.
      await expect.poll(() => page.locator("tr.ah-row.highlighted").first().textContent()).toContain("Loyalty export for nobody yet");

      // New under an epic: a feature, the epic as its parent.
      const epicRow = page.locator("tr.ah-row.tier-epic:not(.context)", { has: page.locator(".ah-new-under") }).first();
      await epicRow.hover();
      const under = epicRow.locator(".ah-new-under").first();
      await shot(page, "qc1-row-new-under", epicRow);
      await under.click();
      await f.waitFor();
      await expect.poll(() => f.getByRole("button", { name: /^Parent:/ }).textContent()).toMatch(/#\d+/);
      const level = await f.getByRole("radio", { checked: true }).textContent();
      expect(level).toBeTruthy();
      await shot(page, "qc1-form-from-row", f);
      await createFromForm(page, `Under this ${level}`);
      await expect(preview(page).textContent()).resolves.toMatch(/Parent#\d+/);
      await preview(page).getByRole("button", { name: "Create in DevOps" }).click();
      await expect.poll(() => page.locator(".ah-refreshed").textContent(), { timeout: 30_000 }).toMatch(/^Created #\d+/);

      // A level above epic: Cooptimize's process has Domains.
      await newBtn.click();
      await choose(page, f, "Client", "Cooptimize");
      await f.getByRole("radio", { name: "Domain" }).click();
      await expect(f.locator(".nf-parent").textContent()).resolves.toContain("at the top: no parent");
      await createFromForm(page, "Partner programs");
      await expect(preview(page).textContent()).resolves.toContain("Domain");
      await preview(page).getByRole("button", { name: "Create in DevOps" }).click();
      await expect.poll(async () => (await posts(page)).some((e) => e.title === "Partner programs")).toBe(true);
    });
    expect(errors).toEqual([]);
  }, T);

  it("the block panel's New feature lands on the block; a draft story's Create from its row stays on the block", async () => {
    const { page, errors } = await freshPage(h, VIEW);
    await failShot(page, "t1", async () => {
      await page.evaluate(() => (location.hash = "#/week"));
      const card = page.locator(`[data-drop^="2026-11-04:"]`, { has: page.locator(".card-client", { hasText: "Northwind" }) }).first();
      await card.waitFor({ timeout: 30_000 });
      await card.getByRole("button", { name: /Add/ }).first().click();
      const box = page.locator(".bp-addbox .bp-box");
      await box.waitFor();
      await box.fill("Store pickup");
      const row = page.locator(".bp-new", { hasText: /^\s*New (feature|.*): Store pickup/ }).filter({ hasText: /New (?!to-do|draft)/ });
      await row.first().waitFor();
      await shot(page, "qc1-panel-new-feature", page.locator(".bp-addbox"));
      await row.first().click();
      const f = form(page);
      await f.waitFor();
      await expect(f.locator("#nf-title").inputValue()).resolves.toBe("Store pickup");
      await shot(page, "qc1-form-from-panel", f);
      await f.locator("#nf-title").press("Enter");
      await preview(page).waitFor();
      await preview(page).getByRole("button", { name: "Create in DevOps" }).click();
      await expect.poll(async () => (await posts(page)).some((e) => e.title === "Store pickup")).toBe(true);
      // On the block: the created feature, no longer a draft.
      await expect.poll(() => card.textContent(), { timeout: 30_000 }).toContain("Store pickup");

      // A draft story from the Add box, then Create in DevOps on its row: straight to the preview; it stays on the block.
      await box.fill("Pickup slot picker");
      await page.locator(".bp-new", { hasText: "New draft story: Pickup slot picker" }).click();
      await expect.poll(() => card.textContent()).toContain("Pickup slot picker");
      // Its ⋯ on the block (right click works too): Create in DevOps first.
      const onCard = card.locator(".pr-title", { hasText: "Pickup slot picker" }).first();
      await onCard.click({ button: "right" });
      const create = page.getByRole("menuitem", { name: "Create in DevOps" });
      await create.waitFor();
      await shot(page, "qc1-draft-row-create", page.getByRole("menu").first());
      await create.click();
      await preview(page).waitFor();
      await preview(page).getByRole("button", { name: "Create in DevOps" }).click();
      await expect.poll(async () => (await posts(page)).some((e) => e.title === "Pickup slot picker")).toBe(true);
      await expect.poll(() => card.textContent()).toContain("Pickup slot picker");
    });
    expect(errors).toEqual([]);
  }, T);

  it("Capture: a draft feature, Ctrl+Enter, Create, without the Inbox", async () => {
    const { page, errors } = await freshPage(h, VIEW);
    await failShot(page, "t2", async () => {
      await page.evaluate(() => (location.hash = "#/today"));
      await page.keyboard.press("n");
      const cap = page.locator(".cap-dialog .cap-box textarea").first();
      await cap.waitFor({ timeout: 30_000 });
      await cap.fill("@Harbor feature: appointment reminders by text");
      await page.locator(".cap-dialog .cap-kinds [role=radio]", { hasText: "Draft feature" }).click();
      await cap.press("Control+Enter");
      const f = form(page);
      await f.waitFor();
      await expect.poll(() => f.locator("#nf-title").inputValue()).toMatch(/appointment reminders by text/i);
      await shot(page, "qc1-form-from-capture", f);
      await f.locator("#nf-title").press("Enter");
      await preview(page).waitFor();
      await preview(page).getByRole("button", { name: "Create in DevOps" }).click();
      await expect.poll(async () => (await posts(page)).some((e) => /appointment reminders by text/i.test(e.title))).toBe(true);
      expect(page.url()).not.toContain("#/inbox");

    });
    expect(errors).toEqual([]);
  }, T);
});

// The demo has a write PAT for every client and refuses PAT changes, so no write PAT is a real session on fake sources.
describe.skipIf(!CHROMIUM)("QC-1: no write PAT (browser, real session)", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);
  it("the one line with the way to add it; Save as draft is the main button and works", async () => {
    const app = await lb.start(await liveContext({ team: liveTeam() }));
    try {
      const page = await app.page();
      await page.setViewportSize(VIEW);
      const errors: string[] = [];
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
      await page.goto(app.url);
      await appReady(page);
      await failShot(page, "live", async () => {
        await page.keyboard.press("Shift+N");
        const f = form(page);
        await f.waitFor({ timeout: 30_000 });
        await choose(page, f, "Client", "Adatum");
        await expect.poll(() => f.locator(".nf-nopat").textContent(), { timeout: 30_000 }).toMatch(/^DevOps is read-only for Adatum until you add your own write PAT/);
        await expect(f.getByRole("button", { name: "Create in DevOps" }).count()).resolves.toBe(0);
        await f.locator("#nf-title").fill("Route planner for depots");
        await shot(page, "qc1-no-pat", f);
        // Enter saves as a draft here.
        await f.locator("#nf-title").press("Enter");
        await expect.poll(async () => (await call<{ drafts: { title: string; clientKey: string }[] }>(page, "capture.load", {})).data.drafts.some((d) => d.title === "Route planner for depots" && d.clientKey === "Adatum")).toBe(true);
      });
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  }, T);
});
