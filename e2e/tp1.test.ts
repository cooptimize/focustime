// TP-1b: three plain questions on the New form (this file was TP-1's; TP-1b rewrote it for what remains). Demo mode,
// the demo's own fake DevOps, no AI: a title-only create shows the same preview rows as before TP-1; the three answers
// reach the preview in plain words (the first two in the description, the third as acceptance) and the story card shows
// them as its description with no chip; Save as draft keeps them and the draft editor shows them; nothing of TP-1's
// (request type, chips, help marks, examples) on the form or the editor; the old Work templates addresses land safely;
// the phone puts the three boxes under More, at Default and the largest text size. Then a real-style session, not an
// admin: a draft TP-1 saved opens with nothing lost, and the old addresses land safely.
// Taken out with TP-1's screens: the request type's hints and examples on focus, the full example, the tag refusal and
// its retry, an admin's edit in Admin › Work templates, and Settings' read-only view of the templates.
// Edge cases are unit tests (plan/three-questions.test.ts, actions/devops-write.test.ts, actions/plan-actions.test.ts).
// FOCUSTIME_SHOTS: screenshots at 1440 × 900 and the phone, light and dark (docs/ux/tp1b/ for the PR).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";
import { phonePage } from "./mb1-helpers.ts";
import { appReady, liveBrowser, liveContext, NOW as LIVE_NOW, type LiveBrowser } from "./live.ts";
import { SETUP_STEPS } from "../plan/setup.ts";
import { aTp1Brief } from "../test/builders/index.ts";
import { planWithRaw, TP1_CARRIED } from "../test/tp1-drafts.ts";

let h: Harness;
const T = 240_000;
const VIEW = { width: 1440, height: 900 };
const call = <R = unknown>(page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: R; error?: string; status?: number }>;

/** <name>-light.png and <name>-dark.png at the page's size. */
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    const was = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t === "light" ? "cooptimize-light" : "cooptimize-dark"), theme);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png` });
    await page.evaluate((w) => (w ? document.documentElement.setAttribute("data-theme", w) : document.documentElement.removeAttribute("data-theme")), was);
  }
  await page.emulateMedia({ colorScheme: "light" });
}
const form = (page: Page) => page.getByRole("dialog", { name: /^New (in .*DevOps|work item)$/ });
const preview = (page: Page) => page.getByRole("dialog", { name: "Create a DevOps item" });
const created = async (page: Page) => (await call<{ entries: { op: string; status: string; title: string; itemId: number | null }[] }>(page, "devops.log", {})).data.entries.filter((e) => e.op === "create" && e.status === "confirmed");
const QUESTIONS = ["Where is it?", "What should change?", "How will we know it's right?"] as const;
const HINTS = ["The report and page, model, table or pipeline", "Before and after, or the rule", "One example and the answer it should give"];
const boxes = (scope: Locator) => scope.locator("textarea.tq-box");
const heading = (page: Page) => page.locator(".ps-head h2").first();
async function choose(page: Page, scope: Locator, label: string, option: string | RegExp) {
  await scope.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  const pop = page.locator(".cell-pop");
  const box = pop.getByRole("combobox");
  if (typeof option === "string" && (await box.count())) await box.fill(option);
  await pop.getByRole("option", { name: option }).first().click();
}
async function failShot(page: Page, name: string, run: () => Promise<void>) {
  try {
    await run();
  } catch (e) {
    if (process.env.TP1_DEBUG) await page.screenshot({ path: `${process.env.TP1_DEBUG}/${name}.png` }).catch(() => undefined);
    throw e;
  }
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
/** Nothing of TP-1's on a form or editor: no request type, choices, chips, help marks, examples or full example. */
async function noTp1(scope: Locator) {
  const text = (await scope.textContent()) ?? "";
  expect(text).not.toMatch(/Request type|four lines|full example|Environment|Touches|Checked by|Done when it is|Signed off by|Not without asking/);
  await expect(scope.locator(".chip-btn, .fl-help-btn, .fl-example, .fl-lines, .nf-example").count()).resolves.toBe(0);
}
/** The three boxes in order, each with its label and grey text. */
async function threeBoxes(scope: Locator) {
  const b = boxes(scope);
  await expect(b.count()).resolves.toBe(3);
  for (const [i, q] of QUESTIONS.entries()) {
    await expect(scope.getByLabel(q, { exact: true }).count()).resolves.toBe(1);
    await expect(b.nth(i).getAttribute("placeholder")).resolves.toBe(HINTS[i]);
  }
}
/** Confirms the open preview and waits for the create; the new item's id. */
async function confirmCreate(page: Page, title: string): Promise<number> {
  const before = (await created(page)).length;
  await preview(page).getByRole("button", { name: "Create in DevOps" }).click();
  await expect.poll(async () => (await created(page)).length, { timeout: 30_000 }).toBe(before + 1);
  return (await created(page)).find((e) => e.title === title)!.itemId!;
}
const rows = (p: Locator) => p.locator("tbody th[scope=row]").allTextContents();
const where = "The margin page of the sales report";
const change = "Margin percent is revenue minus cost, divided by revenue";
const check = "October, East region shows 31.2%";

describe.skipIf(!CHROMIUM)("TP-1b: three plain questions in the New form (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("title only is as before TP-1; the three answers reach the preview in plain words; the card shows them with no chip", async () => {
    const { page, errors } = await freshPage(h, VIEW);
    await failShot(page, "t0", async () => {
      // Empty: three quiet boxes under Title, nothing of TP-1's, and it fits 1440 × 900 without scrolling.
      let f = await openNew(page, "Northwind");
      await f.getByRole("radio", { name: "User Story" }).click();
      await threeBoxes(f);
      await noTp1(f);
      const fits = await f.evaluate((el) => ({ bottom: el.getBoundingClientRect().bottom, scroll: el.scrollHeight - el.clientHeight }));
      expect(fits.bottom).toBeLessThanOrEqual(900);
      expect(fits.scroll).toBeLessThanOrEqual(1);
      await f.locator("#nf-title").focus();
      await shot(page, "tp1b-form-empty");

      // Title only: Enter opens the same preview rows as before TP-1, with no answer's words, tag or heading.
      await f.locator("#nf-title").fill("Plain title only");
      await f.locator("#nf-title").press("Enter");
      let p = preview(page);
      await p.waitFor();
      expect(await rows(p)).toEqual(["Type", "Title", "Description", "Assigned to", "Area", "Iteration", "Parent"]);
      expect((await p.textContent()) ?? "").not.toMatch(/Where:|What should change|know it's right|Tags|type:/);
      await confirmCreate(page, "Plain title only");

      // Tab goes Title, then the three boxes in order; Ctrl+Enter from the last opens the preview.
      f = await openNew(page, "Northwind");
      await f.getByRole("radio", { name: "User Story" }).click();
      await f.locator("#nf-title").fill("Gross margin percent on the sales report");
      await f.locator("#nf-title").focus();
      for (const [i, text] of [where, change, check].entries()) {
        await page.keyboard.press("Tab");
        await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-question"))).toBe(["where", "change", "check"][i]);
        await page.keyboard.type(text);
      }
      // A longer answer grows its box (one line to start).
      const one = await boxes(f).nth(0).evaluate((e) => e.getBoundingClientRect().height);
      await boxes(f).nth(1).fill(`${change}\nTotals are recalculated, not averaged.\nBlank when revenue is zero.`);
      expect(await boxes(f).nth(1).evaluate((e) => e.getBoundingClientRect().height)).toBeGreaterThan(one * 1.8);
      await boxes(f).nth(1).fill(change);
      await page.mouse.move(1, 1);
      await shot(page, "tp1b-form-filled");
      await boxes(f).nth(2).press("Control+Enter");
      p = preview(page);
      await p.waitFor();
      const text = (await p.textContent()) ?? "";
      expect(text).toContain(`Where: ${where}`);
      expect(text).toContain(`What should change: ${change}`);
      expect(await rows(p)).toContain("Acceptance criteria");
      expect(text).toContain(check);
      expect(text).not.toMatch(/Tags|type:|What and where|How far and who signs off/);
      await shot(page, "tp1b-preview");
      const id = await confirmCreate(page, "Gross margin percent on the sales report");

      // The card: the description as DevOps has it (the two answers), the third as acceptance; no chip, no type.
      await page.evaluate((i) => (location.hash = `#/item/Northwind/${i}`), id);
      const desc = page.getByRole("region", { name: "Description" });
      await desc.waitFor({ timeout: 30_000 });
      await expect(desc.textContent()).resolves.toContain(`Where: ${where}`);
      await expect(desc.textContent()).resolves.toContain(`What should change: ${change}`);
      await expect(page.getByRole("region", { name: "Acceptance criteria" }).textContent()).resolves.toContain(check);
      await expect(page.locator(".sc-ready, .sc-reqtype, .sc-lines").count()).resolves.toBe(0);
      await shot(page, "tp1b-card");
      await page.keyboard.press("Escape");
    });
    expect(errors).toEqual([]);
  }, T);

  it("Save as draft keeps the answers; the draft editor shows and edits them; Create in DevOps writes them", async () => {
    const { page, errors } = await freshPage(h, VIEW);
    await failShot(page, "t1", async () => {
      const f = await openNew(page, "Northwind");
      await f.getByRole("radio", { name: "User Story" }).click();
      await f.locator("#nf-title").fill("Timesheet comments report");
      await boxes(f).nth(0).fill("The projects model, a new report page");
      await boxes(f).nth(2).fill("Last week's comments for one manager, newest first");
      await f.getByRole("button", { name: "Save as draft" }).click();
      await expect.poll(() => f.count(), { timeout: 30_000 }).toBe(0);
      const drafts = (await call<{ drafts: { id: number; title: string; answers?: Record<string, string> }[] }>(page, "capture.load", {})).data.drafts;
      const d = drafts.find((x) => x.title === "Timesheet comments report")!;
      expect(d.answers).toEqual({ where: "The projects model, a new report page", change: "", check: "Last week's comments for one manager, newest first" });

      // The draft editor: the same three boxes with the answers; an edit saves.
      await page.evaluate((i) => (location.hash = `#/inbox/item/d${i}`), d.id);
      await page.locator("li.ib4-row.open").getByRole("button", { name: "Edit draft" }).click({ timeout: 30_000 });
      const ed = page.locator(".draft-editor");
      await ed.waitFor();
      await threeBoxes(ed);
      await noTp1(ed);
      // The third question is the acceptance: no second, empty Acceptance criteria box beside it.
      await expect(ed.getByText(/^Acceptance criteria/).count()).resolves.toBe(0);
      await expect(boxes(ed).nth(0).inputValue()).resolves.toBe("The projects model, a new report page");
      await boxes(ed).nth(1).fill("A new page; nothing else changes");
      await page.mouse.move(1, 1);
      await shot(page, "tp1b-draft-editor");
      await ed.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(async () => (await call<{ drafts: { id: number; answers?: Record<string, string> }[] }>(page, "capture.load", {})).data.drafts.find((x) => x.id === d.id)?.answers?.change).toBe("A new page; nothing else changes");

      // Create in DevOps from the draft: the preview shows its answers in plain words.
      await page.evaluate((i) => (location.hash = `#/inbox/item/d${i}`), d.id);
      await page.locator("li.ib4-row.open").getByRole("button", { name: "Create in DevOps" }).first().click({ timeout: 30_000 });
      const pd = preview(page);
      await pd.waitFor({ timeout: 30_000 });
      await expect(pd.textContent()).resolves.toContain("Where: The projects model, a new report page");
      await expect(pd.textContent()).resolves.toContain("What should change: A new page; nothing else changes");
      await expect(pd.textContent()).resolves.toContain("Last week's comments for one manager, newest first");
      await pd.getByRole("button", { name: "Not now" }).click();
    });
    expect(errors).toEqual([]);
  }, T);

  it("the old Work templates addresses land on the section's first page, and nothing offers them", async () => {
    const { page, errors } = await freshPage(h, VIEW);
    await failShot(page, "t2", async () => {
      // The demo's person is an admin in their own demo: Admin's first page.
      await page.evaluate(() => (location.hash = "#/settings/admin-templates"));
      await expect.poll(() => heading(page).textContent(), { timeout: 30_000 }).toBe("Admin › Clients");
      await page.evaluate(() => (location.hash = "#/settings/planning/work-templates"));
      await expect.poll(() => heading(page).textContent(), { timeout: 30_000 }).not.toContain("Admin");
      await expect(page.locator('[data-setting="work-templates"]').count()).resolves.toBe(0);
      // Not in the rail, nor Settings' search, nor the command menu.
      await expect(page.getByRole("link", { name: "Work templates" }).count()).resolves.toBe(0);
      await page.locator(".ps-search input[type=search]").fill("work templates");
      await expect.poll(() => page.locator(".ps-hit").count()).toBe(0);
      await page.locator(".ps-search input[type=search]").fill("request type");
      await expect.poll(() => page.locator(".ps-hit").count()).toBe(0);
      await page.keyboard.press("Escape");
      await page.evaluate(() => (location.hash = "#/today"));
      await page.keyboard.press("Control+k");
      const cmd = page.getByRole("dialog", { name: "Command menu" });
      await cmd.waitFor({ timeout: 30_000 });
      await page.keyboard.type("templates");
      await expect.poll(() => cmd.textContent()).not.toMatch(/work templates/i);
      await page.keyboard.press("Escape");
    });
    expect(errors).toEqual([]);
  }, T);

  it("the phone: the three boxes under More, above Description, at Default and the largest text size", async () => {
    const page = await phonePage(h, 390);
    await failShot(page, "t3", async () => {
      for (const size of ["default", "larger"] as const) {
        expect((await call(page, "ui.set_text_size", { size })).ok).toBe(true);
        await page.reload();
        await page.locator(".topbar, .bottombar").first().waitFor({ timeout: 60_000 });
        await page.evaluate(() => (location.hash = "#/ahead"));
        await page.keyboard.press("Shift+N");
        const f = form(page);
        await f.waitFor({ timeout: 30_000 });
        await choose(page, f, "Client", "Northwind");
        await expect(boxes(f).count()).resolves.toBe(0);
        await noTp1(f);
        if (size === "default") await shot(page, "tp1b-phone-empty");
        await f.getByRole("button", { name: /More: details, description and size/ }).click();
        await threeBoxes(f);
        // Each box spans the form's width, and all three sit above Description.
        const boxRects = await boxes(f).evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ w: r.width, top: r.top })));
        const descTop = await f.locator("#nf-desc").evaluate((e) => e.getBoundingClientRect().top);
        for (const r of boxRects) {
          expect(r.w).toBeGreaterThan(280);
          expect(r.top).toBeLessThan(descTop);
        }
        await boxes(f).nth(0).fill(where);
        await boxes(f).nth(1).fill(change);
        await boxes(f).nth(2).fill(check);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await boxes(f).nth(0).scrollIntoViewIfNeeded();
        await shot(page, size === "default" ? "tp1b-phone" : "tp1b-phone-larger");
        await f.getByRole("button", { name: "Cancel" }).click();
      }
      expect((await call(page, "ui.set_text_size", { size: "default" })).ok).toBe(true);
    });
    await page.close();
  }, T);
});

describe.skipIf(!CHROMIUM)("TP-1b: a draft TP-1 saved, and someone who isn't an admin (browser, real session)", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);
  it("a TP-1 draft opens with every word (the answers, then the rest in its description); old addresses land safely", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ft-tp1b-"));
    const store = planWithRaw(() => Temporal.Instant.from(LIVE_NOW).toZonedDateTimeISO("America/New_York"), join(dir, "plan.db"));
    for (const s of SETUP_STEPS) await store.plan.setSetupStep(s, "done");
    const app = await lb.start(await liveContext({ extra: { plan: store.plan } }));
    try {
      const page = await app.page();
      await page.setViewportSize(VIEW);
      await page.goto(app.url);
      await appReady(page);
      if (await page.locator(".brand-stage").count()) await page.keyboard.press("Shift");
      await page.locator(".brand-stage").waitFor({ state: "detached", timeout: 30_000 });
      const r = await call<{ draft: { id: number } }>(page, "draft.add_story", { clientKey: "Cooptimize", parentItemId: null, title: "Gross margin percent", size: "M" });
      expect(r.ok, r.error).toBe(true);
      const id = r.data.draft.id;
      expect((await call(page, "draft.update", { id, description: "From the finance review." })).ok).toBe(true);
      const json = JSON.stringify(aTp1Brief());
      store.plantBrief(id, json);

      await page.evaluate((i) => (location.hash = `#/inbox/item/d${i}`), id);
      await page.locator("li.ib4-row.open").getByRole("button", { name: "Edit draft" }).click({ timeout: 30_000 });
      const ed = page.locator(".draft-editor");
      await ed.waitFor();
      await threeBoxes(ed);
      await noTp1(ed.locator(".tq"));
      expect(await boxes(ed).evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value))).toEqual(["The Sales model", "Gross margin percent", "October, East: 31.2%"]);
      await expect(ed.getByLabel("Description").inputValue()).resolves.toBe(`From the finance review.\n\n${TP1_CARRIED}`);
      await page.mouse.move(1, 1);
      await shot(page, "tp1b-tp1-draft");
      // Opening it changed nothing; closing without saving changes nothing.
      expect(store.briefOf(id)).toBe(json);
      await page.keyboard.press("Escape");
      await expect.poll(() => ed.count()).toBe(0);
      expect(store.briefOf(id)).toBe(json);

      // Not an admin: the retired Admin page lands on Settings' first page, the retired setting on its section's top.
      await page.evaluate(() => (location.hash = "#/settings/admin-templates"));
      await expect.poll(() => heading(page).textContent(), { timeout: 30_000 }).not.toMatch(/^Admin/);
      await expect(page.locator(".ps-body").textContent()).resolves.not.toContain("Admin is only for FocusTime admins");
      await page.evaluate(() => (location.hash = "#/settings/planning/work-templates"));
      await expect.poll(() => heading(page).textContent(), { timeout: 30_000 }).not.toMatch(/^Admin/);
      await expect(page.locator('[data-setting="work-templates"]').count()).resolves.toBe(0);
    } finally {
      await app.close();
    }
  }, T);
});
